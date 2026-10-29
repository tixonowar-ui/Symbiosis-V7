# Передача контекста — 2026-10-30

Срез issue #170, ветка `codex/170-paused-campaign-create`.
База — `752d288cb73768407286037508e784c224ed9975`: PR #176 слит,
issue #156 закрыта. Независимый прогон базы подтвердил 121 файл /
2198 Vitest-тестов и 30 production E2E. Это не проверка текущего среза.

## Что реализовано в #170

- APP-001 → APP-011 доступен локальному мастеру по реальному TCP peer,
  bound listener и точному Origin. Role/device/URL/Host/proxy header не дают
  полномочий. Проверка повторяется перед каждым GM чтением, записью и KDF.
- Durable profile/context и точный active-context pointer сохраняют владельца
  устройства. Новая вкладка через явный Master переиспользует context;
  автоматический resume возвращает тот же draft или CMP-006 без выбора
  «последней» строки. Reset не перепривязывает чужие данные.
- CMP-001–004 сохраняют метаданные, реальный интерфейс/порт, вместимость,
  секрет передачи и MANUAL/AUTO. Нормативные CTA не подменяются CREATE.
  Каждый этап имеет закрытый v3 DTO под прежней protocolVersion.
- Секрет write-only: сохраняется только scrypt-верификатор с отдельной солью.
  Exact replay проверяет proof конкретного update, KEEP не создаёт новую
  соль. Пароль/confirmation очищаются из DOM и не попадают в journal,
  read projection, receipt, QR или протокольную диагностику.
- CMP-005 проверяет baseline, source revisions и фактический bind. Порт
  удерживается через commit; совпадающий реальный UI listener может дать
  общую lease, чужой занятый порт даёт явный отказ. Ошибка закрывает только
  собственную reservation, сохраняя подтверждённый draft.
- CREATE атомарно записывает кампанию PAUSED, полный checkpoint при нуле
  копий PC, private credential, неизменяемый receipt и destination cursor.
  Same ID/payload повторяет результат; иной payload отвергается. Ответ,
  потерянный после commit, не создаёт второй campaign ID, QR или checkpoint.
- CMP-006 публикует настоящий QR публичного locator. CreatedAt — исходная
  аудиторская UTC-метка; игровые часы, сцены, группы и Start не создаются.
  Восстановление занятого endpoint даёт диагностику при сохранённой PAUSED.
- Cancel атомарно закрывает draft и удаляет private proofs. Его durable
  повтор возвращает текущий подписанный экран без отката нового draft.

Технические решения — [ADR 0064](../adr/0064-paused-campaign-creation.md).
Forward-only миграция `0007` дополняет `0001`–`0006`; старые schema guards
обновлены явно. Данные в `artifacts/` и importer не меняются. Добавлены
`qrcode-generator` и dev-only `jsqr`: обе библиотеки без install scripts и
транзитивных зависимостей; причина выбора зафиксирована в ADR.

## Проверки и ревью

- `npm run import` прошёл; tracked generated-данные не изменились.
- Полный `npm run verify` прошёл: **132 файла / 2464 Vitest-теста**, типы,
  ESLint, Prettier, трассируемость, контрольные суммы и валидация.
  Лог: `reports/170-verify-root-final.log`.
- Полная production-сборка и **34/34 Chrome E2E** прошли без retry: прежние
  30 сценариев и четыре новых campaign create/cancel/recovery/failure.
  Лог: `reports/170-e2e-root-final.log`.
- Проверены MANUAL/AUTO, очистка секрета, cancel, actual QR decode, exact
  CREATE replay, SQLite restart, новый вход без ticket и занятый порт.
- Независимое чтение выявило и помогло исправить обход player role boundary,
  потерю доступа без browser ticket, cleanup до commit, KDF replay allocation,
  смешение concurrent view/revisions и неизвестный pending CREATE.
- Независимый actual TCP probe удержал завершение настоящего scrypt и
  подтвердил отказ второго устаревшего Master launch. Чужой Origin не получил
  GM CTA или resume. Проверка: `reports/170-independent-tcp-probe.log`.
- Прочитан весь новый production code и изменённые integration paths;
  тестовые сценарии — выборочно. Код превышает измеренную границу чтения
  в 6000 строк, поэтому полного построчного чтения всего test diff не заявляем.
- Полные результаты `verify`/E2E, свежий независимый прогон окончательного
  commit и CI фиксируются перед merge. Целевые проверки их не заменяют.

## Следующие задачи

1. Закончить обязательные проверки #170, merge и отдельно проверить закрытие.
2. #171 → #172 → #173 → #174: подключение, допуск персонажей, Start и базовый
   lifecycle кампании. #172 использует уже слитый экспорт #156.
   Для #171 найден конфликт preliminary review и финальных admission-команд:
   [#177](https://github.com/tixonowar-ui/Symbiosis-V7/issues/177).
   Поправка источника ожидает решения владельца; runtime этих решений не начат.
3. #113: мастерский NPC/ENM/GM и нормативная поставка арта. Разрешены шесть
   портретов НПС; заглушка чудовища получена, арт мыслящего врага сгенерирован.
   Изображения ещё должны войти в поставку и importer, временные отчёты
   не заменяют эту работу. Runtime #113 пока не начат.

Пользователь разрешил последовательные merge до закрытия всех issues.
Перед каждым merge обязательны независимое ревью и свежие `verify`/E2E
на окончательном HEAD; закрытие issue проверяется отдельно после merge.
