# Передача контекста — 2026-10-29

Срез issue #153, ветка `codex/153-starting-money`.
База — `main`, коммит `c5c53b8b9e7e761c2e64834fb5b5214a47ccae2c`:
PR #167 с профилями оружия слит, issue #152 закрыта. Предыдущие #146 и #151
также закрыты по проверенным реализациям.

## Что реализовано

- `CHR-038`: один отдельный D20 рекомендации достатка после завершённого
  формульного либо fixed профиля оружия. [ADR 0060](../adr/0060-starting-money.md).
- Шкала CORE-172/Q-CORE-052: 1–4 «нет денег», 5–9 «малая сумма», 10–14
  «обычная», 15–18 «крупная», 19 «исключительная», 20 «редкое состояние».
  Каталог сверяет источник; domain не содержит RNG и не вычисляет сумму.
  `gmFinalizationRequired=true` остаётся явным ограничением; нет master approval,
  critical chain, creation penalty, XP или изменения валюты.
- Новый успешный profile commit атомарно связывает один pending money request
  с profile/weapon receipts. Это техническая связь продолжения: денежный
  бросок и рекомендация ещё не выполняются. INVALID не создаёт money stage.
- Для исторического profile receipt адрес запроса детерминирован: namespace
  `symbiosis.starting-money.v1`, character ID и profile receipt ID хешируются
  SHA-256. Read/reconnect не записывают stage и не вызывают allocator/RNG.
  Первый money roll атомарно материализует stage. Повторный submit/acknowledge
  профиля и изменение старого receipt не используются.
- AUTO вызывает sampler один раз после guards в транзакции; MANUAL принимает
  явную грань. После committed display request, face и receipt immutable.
  AUTO money receipt входит в `randomReceiptIds`, formula witness receipts
  остаются вне истории физических бросков.
- Safe-return ведёт строго `CHR-038 → CHR-022`, далее через подписанную ветвь
  `CHR-023/024` возвращается тот же money stage. Меняется только presentation.
  Старый initial terminal profile отличается от явного safe-return по signed
  projection revision; restart сохраняет выбранное представление.
- Loader проверяет profile binding, режим, physical roll, рекомендацию,
  историю и уникальность IDs. Post-write validation выполняется внутри
  SQLite-транзакции. Checkpoint подписывает `CHR-037`, текущий `CHR-038`
  actionless; пять произвольных позиций и итоговые деньги вне среза.

## Проверки и ревью

- Targeted domain/catalog: **41/41** тест. Focused money core: **27/27**.
  Регрессии предыдущих weapon/profile: **30/30**. Production E2E: **17/17**;
  WebSocket AUTO/MANUAL: **2/2**.
- `npm run verify` прошёл: TypeScript, ESLint, Prettier, traceability,
  **102 файла / 1880 Vitest-тестов** и кросс-реестровая валидация.
  Production build и **17/17 Chrome E2E** прошли без retry.
- Независимое чтение money contract/core и atomic profile linkage выявило два
  пограничных дефекта: пустой receipt ID мог расходовать AUTO sampler до отказа,
  а allocated ID `null` ошибочно подменялся derived адресом. Оба исправлены
  проверкой до использования и покрыты регрессиями. Прочитанные пути включают
  durable corruption, legacy address, immutable terminal history и binding.
- `npm run import` прошёл. Дополнительный `import:verify` выполнил первый
  импорт, но второй вновь остановился на локальном
  `UNKNOWN: open generated/spec/atlas/forms-by-id.json`, как на базе #152.
  Tracked generated-вывод не изменён; локальная воспроизводимость не
  подтверждена. Отдельный CI-гейт проверяет её на чистом checkout.
- CI проверяется отдельно на конкретном HEAD PR перед merge.
- Артефакты, importer, зависимости, outer protocol, SQL-схема, CI и
  конфигурация проверок не меняются. TRACEABILITY перегенерирована,
  AGENTS обновлён после регистрации формы.

## Следующие задачи

1. #154 — пять произвольных позиций `CHR-037`.
2. #155 — итог восьми имущественных операций и финальная валидация/сохранение.
3. #156 — восстановление, кэш веток, финальный лист, варианты и экспорт.

Это продолжение V1 «Локальный персонаж». Campaign/combat runtime, мастерские
сущности, звук и portable Windows-поставка остаются последующими срезами.
#113 заблокирована будущей поставкой изображений и отдельным решением
владельца; она не является ближайшей доступной задачей.
