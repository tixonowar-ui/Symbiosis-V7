# ADR 0056 — Подтверждение взаимодействий и восстановление armorBundle

- **Статус:** принято
- **Дата:** 2026-10-28
- **Дополняет:** [ADR 0054](0054-manual-symbiont-composition.md) и
  [ADR 0055](0055-starting-armor-bundle.md)
- **Реализует:** issue #146, замечания ревью PR #165

## Контекст

ADR 0054 §6 оставил `CHR-042::CTA::001` следующему equipment срезу. Первичная
реализация #146 опубликовала `CHR-019::CTA::001` и при наличии обязательного
exact diff, позволяя войти в броню без подтверждения. Ревью также воспроизвело:
запись прежней стадии из второго WS-соединения, отказ после сохранения payload,
неработающий RANDOM safe-return, расхождение snapshot/context после MANUAL
safe-return, MANUAL-грань по умолчанию и неразличимость выбранного предмета.

Atlas требует `CHR-042::CTA::001 / UI-CMD-CHAR-CREATION-SET-DECIDE` с guard
«exact interaction diff committed with composition» и target `CHR-021`.
Следовательно, подтверждение и создание armor stage должны быть одной атомарной
операцией, а не двумя независимыми командами. ADR 0054/0055 по существу не
переписываются; этот ADR фиксирует их применение на границе equipment.

## Решение

### 1. Откат любой невалидной записи и запрет прежних стадий

`commitLocalCharacterCheckpoint` принимает optional synchronous validator и
вызывает его после записи checkpoint, но до завершения `.immediate()`. Ошибка
validator откатывает payload, presentation, revisions и checkpoint в той же
SQLite-транзакции. Post-write validation больше не является внешней по отношению
к транзакции проверкой.

Общий symbiont guard по умолчанию отклоняет любые команды прежних стадий при
существующем `armorBundleStage`. Только addressed quality roll и bundle checkpoint
получают явное исключение. Entry и все random/manual/Advisor mutations до entry
этого исключения не имеют. Проверки повторяются внутри `BEGIN IMMEDIATE`.

### 2. Атомарный CHR-042 SET-DECIDE

Новый вариант `SYMBIONTS / MANUAL_INTERACTION_CONFIRMATION` существующего
`UI-CMD-CHAR-CREATION-SET-DECIDE` содержит exact player-safe `interactionDiff`:
before/after composition, interaction graph, consequences, slot/stat/OE diff и
`irreversibleOperationIds`. Host заново вычисляет diff из двух последних
composition records и сравнивает его глубоко. Изменённый, устаревший или
отсутствующий diff отклоняется до выделения ID и записи.

При pending diff обычный `CHR-019` entry скрыт и server-rejected. Успешный
`CHR-042::CTA::001` в одной транзакции создаёт `armorBundleId`, один addressed
`qualityRollRequestId`, receipt и `armorBundleStage` с host-signed `CHR-021`.
`ArmorBundleStage.entryRequest/entryReceipt` — discriminated union обычного
`CHR-019 / ARMOR_BUNDLE_ENTRY` и `CHR-042 / MANUAL_INTERACTION_CONFIRMATION`.
Синтетических CHR-019 requests нет. Parser, history validation, replay,
reconnect и SQLite restart используют реальный CHR-042 request и тот же diff.

### 3. Safe-return и resume для RANDOM и MANUAL

`CHR-021::CTA::002` и повторный вход из `CHR-019` в существующий bundle — это
presentation-only навигация для обоих acquisition modes. Она меняет только
`projectionRevision`, composition и все request/receipt IDs сохраняются.
Snapshot, signed presentation и confirmed context обязаны совпадать.

`CHR-019` получает host-signed `armorBundleEntryMode=INITIAL|RESUME|null`.
Initial entry остаётся `WIZARD-CHECKPOINT`; `RESUME` использует существующий
`navigation.form-action` и не создаёт command, receipt, bundle или quality request.
До bundle checkpoint signed `CHR-019|CHR-021` имеет приоритет; после него
presentation остаётся actionless на `CHR-021`, а `CHR-022` не публикуется.

### 4. Явный выбор игрока и read-only preview

MANUAL-грань начинается пустой и требует явно введённого integer `1..20`.
Неизменённая форма не может отправить значение по умолчанию. До immutable roll
каждая selected row показывает название предмета рядом с зоной или полным
костюмом.

Каталог публикует read-only `decisionPreview` только из `armor-profiles.json`:
выражение брони, требование S, M/акробатика/бег/уклонение, защиты,
условие/ограничение и флаги герметичности/слоёв/физической брони. Это не
mechanical modifier и не equipment engine. Raw rows, Rule ID, `PDF, с.`,
`Источник`, availability trace и GM finalization data в player payload не
попадают. Preview остаётся в catalog projection и не записывается в immutable
armor pieces.

## Обоснование

- Issue #146 требует exact-diff confirmation, safe-return без нового request,
  replay/reconnect/restart и отсутствие обходного PURE/equipment runtime.
- Atlas `CHR-042` задаёт SET-DECIDE и target `CHR-021`; разделение confirmation
  и entry в две команды создало бы промежуточное несогласованное состояние.
- Двухсессионный regression доказывает, что отказ не меняет durable state и
  персонаж снова загружается. Persistence regression доказывает rollback при
  ошибке validator.
- Production Chrome проверяет MANUAL round-trip без reload, UNITED/ABSORPTION
  exact diff и RANDOM safe-return/resume. React-проверки запрещают untouched
  MANUAL submit и различают Нэйт/Гленхейм и leather/brigandine HEAD.
- Каталог и decoder принимают только source-backed allowlisted preview;
  негативные тесты отклоняют unknown/extra/private fields.

## Отвергнутые альтернативы

| Вариант                                 | Причина отказа                                                     |
| --------------------------------------- | ------------------------------------------------------------------ |
| Прямой CHR-019 entry при pending diff   | Обязательное подтверждение последствий обходится                   |
| Две команды: подтверждение, затем entry | Между ними возможны stale state, второй request и частичный commit |
| Post-commit validation вне транзакции   | Отказ оставляет повреждённый durable payload                       |
| Общий manual-only safe-return           | RANDOM получает `NAVIGATION_UNAVAILABLE`                           |
| Reload вместо согласованного context    | Скрывает рассинхронизацию snapshot/context и не даёт round trip    |
| Предзаполненная грань 10                | Фиктивный MANUAL-результат без физического ввода                   |
| Raw armor profiles в player payload     | Раскрывает служебные поля и смешивает preview с durable mechanics  |
| Equipment/effective-stat engine         | Выходит за границу #146; bundle остаётся `OWNED_NOT_EQUIPPED`      |

## Последствия

- Новые discriminated entry records обратносовместимы с существующими CHR-019
  records и не меняют `src/shared` или outer protocol.
- `CHR-022`, оружие, деньги, произвольные позиции, общий инвентарь и финальное
  сохранение остаются отдельными задачами. Recommendation по-прежнему не
  final `qualityTier`.
- CHANGELOG, TRACEABILITY, module-map и handoff фиксируют фактический объём
  проверок. Следующая очередь #151–#156 не начинается автоматически этим ADR.
