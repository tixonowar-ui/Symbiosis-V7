# Передача контекста — 2026-10-29

Срез issue #152, ветка `codex/152-weapon-profiles`.
База — `main`, коммит `bf70c0f7de9b1bcf20344efbf3c3d2a80b5decaa`:
PR #166 со стартовым оружием слит. Выполненные issues #146 и #151 закрыты.

## Что реализовано

- `CHR-023/024/031`: формульная заявка, фиксированный профиль PURE и диалог
  отказа. Каталог проверяет 27 типов / 29 пар: 22 формульные пары и семь fixed
  пар шести типов. [ADR 0059](../adr/0059-weapon-profiles-and-pure-entry.md).
- Domain проверяет предоставленный общий witness `L/Lw/Ls`, независимые дайсы
  и все заявленные выходы одной формулы. Соблюдаются точные вычисления,
  округление, минимумы и варианты. Min/max — только ранний отказ; генерации,
  автоматического поиска witness, производственных бросков и крафта нет.
- Новый weapon checkpoint атомарно создаёт один profile request, связанный
  с его receipt. Исторический checkpoint продолжается явной командой без
  замены прежнего receipt. Read/reconnect/restart не выделяют ID.
- Успех сохраняет полный эффективный профиль, proof с formula version и
  `PLAYER_WITNESS` receipts. Поля вне выходов формулы остаются шаблонными.
  Fixed-профиль read-only; canonical версия — `ITEM_REGISTRY_V1.2` из поля
  реестра, независимо от v1.6 в имени workbook. История заново проверяется при
  загрузке, post-write validation выполняется внутри транзакции.
- INVALID остаётся `DRAFT`, сохраняет попытку для replay без частичного
  профиля и восстанавливает `CHR-031` с подписанным возвратом на `CHR-023`.
  Safe-return/resume сохраняет прежние weapon/armor records. Публичные факты
  и восстановленный ввод проходят allowlist, включая текст с внутренними ID.
- Расширен вход PURE по существующему финальному `CHR-015::CTA::001`:
  exact-fill навыки, явный пустой состав и pending armor request сохраняются
  атомарно. `CHR-017::CTA::004` остаётся навигацией; `NOT_APPLICABLE` не
  подменяется MANUAL. Исторический skill checkpoint требует явного reconfirm
  тех же навыков, исходный receipt сохраняется. Safe-return брони ведёт на
  read-only пустой `CHR-019`.
- После успеха формульная заявка имеет `PENDING_GM`; fixed acknowledge не
  выполняет согласование мастером. Владение остаётся `OWNED_NOT_EQUIPPED`,
  D20 качества сохраняются. `CHR-038` подписан, но не опубликован; текущий
  профиль actionless. Деньги, inventory creation/equip и final save вне среза.

## Проверки и ревью

- Targeted domain/catalog: 83 теста прошли на момент подготовки handoff.
- Добавлены проверки durable binding, rollback, replay, fixed tampering,
  восстановления SQLite, player projections и web terminal contracts.
  Production E2E расширен формульным сценарием с INVALID/recovery и PURE.
- Независимое чтение core проверило contract/history/replay/allocator пути.
  В projection найдено отражение сырых полей INVALID; оно заменено allowlist
  известных числовых полей. Decoder web исправлен для source-backed `Lw.min`
  0 или 1; round-trip расширен на все 29 пар.
- `npm run verify`: успешно — TypeScript, ESLint, Prettier, traceability,
  **97 файлов / 1798 Vitest-тестов** и кросс-реестровая валидация.
- `npm run test:e2e`: production build и **15/15 Chrome E2E без retry**.
  Новый WS-сценарий дополнительно проверяет submit, точный replay и stale refusal.
- Первый `npm run import` прошёл. Дополнительный `import:verify` выполнил
  первый импорт, но второй остановился на локальном `UNKNOWN: open` для
  `generated/spec/atlas/forms-by-id.json`. Повтор обычного импорта встретил
  ту же ошибку. Tracked generated-вывод не изменён; локальная воспроизводимость
  не подтверждена. Отдельный CI-гейт проверяет её на чистом checkout.
- Независимые ревью прочитали domain/catalog, durable core/history, PURE entry
  и контракты player projection/web. Общий diff превышает 6000 строк кода и
  тестов; один ревьюер не прочитал всё изменение целиком.
- Статус CI проверяется отдельно для конкретного HEAD PR перед merge.
- Артефакты, importer, зависимости, outer protocol, SQL-схема, CI и
  конфигурация проверок этим срезом не изменяются. TRACEABILITY перегенерирована
  после регистрации форм.

## Следующие задачи

1. #153 — стартовые деньги `CHR-038`.
2. #154 — пять произвольных позиций `CHR-037`.
3. #155 — итог восьми имущественных операций и финальная валидация/сохранение.
4. #156 — восстановление, кэш веток, финальный лист, варианты и экспорт.

Это продолжение V1 «Локальный персонаж». Campaign/combat runtime, мастерские
сущности, звук и portable Windows-поставка остаются последующими срезами.
#113 заблокирована будущей поставкой изображений и отдельным решением
владельца; она не является ближайшей доступной задачей.
