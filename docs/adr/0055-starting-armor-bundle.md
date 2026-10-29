# ADR 0055 — Стартовый armorBundle (CHR-021)

- **Статус:** принято
- **Дата:** 2026-10-28
- **Дополняет:** [ADR 0021](0021-local-character-creation.md),
  [ADR 0025](0025-creation-ui-wire.md),
  [ADR 0048](0048-random-symbiont-draw.md),
  [ADR 0054](0054-manual-symbiont-composition.md)
- **Реализует:** issue #146

## Контекст

После завершённого random (#135) или manual (#145/#154) состава симбионтов
мастер создаёт персонажа с вещами. Нормативная основа: `Q-CHAR-017` и
`Q-CHAR-018` (стартовый комплект брони и его качество), Atlas `CHR-019`,
`CHR-021`, `CHR-022`, реестры `catalogue.json`, `armor-profiles.json` и
`dictionaries.json` (восемь `ITM-ARM-001..008`, `BODY_ZONE` из шести зон,
шкала `QUALITY` 1–4 / 5–9 / 10–14 / 15–18 / 19 / 20).

Существующие stage-контракты (ADR 0048, ADR 0052, ADR 0054) хранят
request/receipt в durable payload и фиксируют next stage host-подписью.
armorBundle не должен становиться новым authority: клиент не вычисляет
качество, не решает механику и не видит ни GM-данных, ни сырых строк
реестра. `CHR-022`, общий инвентарь и экипировка в этот срез не входят.

## Решение

### 1. Optional armorBundleStage в whole-checkpoint

`armorBundleStage` живёт в существующем durable payload и сосуществует
только с завершённой random/manual стадией; в `symbiontStageCount` не
входит. Стадия содержит `anatomyProfile=STANDARD_HUMANOID`, snapshot режима
кубиков, entry request/receipt, один addressed `qualityRollRequestId`,
необязательные записи quality roll и checkpoint. `parseArmorBundleStage`
восстанавливает всё детерминированно, без sampler.

### 2. Entry, roll, checkpoint

- **Entry** (`CHR-019::CTA::001`, `UI-CMD-CHAR-WIZARD-CHECKPOINT`): один
  `armorBundleId` и один `qualityRollRequestId`; переход на `CHR-021`.
  Публикуется только когда состав завершён, раса не `PURE` и брони ещё
  нет; обходной инициализации для `PURE` нет.
- **Quality roll** (`UI-CMD-CHAR-CREATION-ROLL-COMMIT`, variant
  `ARMOR_BUNDLE_QUALITY`): один D20 на весь bundle. `AUTO` — один sampler
  внутри транзакции после guards, `MANUAL` — одна грань без sampler.
  Невалидный выбор (0/7 элементов, дубль или пересечение зон, полный костюм
  с другим покрытием, неизвестный предмет, подделанная зона) отклоняется до
  записи и до sampler. Выбор фиксируется записью и далее неизменен.
- **Checkpoint** (`ARMOR_BUNDLE_CHECKPOINT`): после roll ровно один раз;
  next stage host-signed `CHR-022`. Presentation остаётся на actionless
  `CHR-021/CHECKPOINTED`; `CHR-022` не публикуется.

### 3. Один зональный предмет и полный костюм

Один зональный armor item может занимать несколько разных body zones;
запрет источника относится к дублю/пересечению зон, а не к уникальности
`itemId`. Полный костюм занимает все шесть зон и не сочетается ни с чем.

### 4. Рекомендация качества — не механика

`qualityRecommendation` отражает грань броска по шкале
`MISSING_OR_UNFIT | POOR | ORDINARY | GOOD | EXCEPTIONAL | RARE` с русскими
labels из dictionaries. Она не меняет предметы, количество, equipped,
параметры и не является окончательным `qualityTier`. Bundle всегда
`OWNED_NOT_EQUIPPED`. Грани 1 и 20 не запускают crit/XP и не меняют
mechanical profile.

### 5. Приватность и safe-return

Player payload: id, имена из каталога, покрытие, зоны, recommendation и
receipt ids; без Rule IDs, `Источник`, availability trace, raw rows и
GM finalization data. `CHR-021::CTA::002` возвращает на `CHR-019` без
пересоздания request: меняется только projectionRevision. Локальный выбор
до первого committed roll не durable: reconnect/refresh восстанавливает
host baseline.

## Последствия

- `docs/TRACEABILITY.md` обновляется импортом; новые Vitest и девятый
  production E2E-сценарий фиксируют контракты.
- Следующие срезы (`CHR-022+`, оружие, деньги, инвентарь, финальное
  сохранение) переиспользуют этот stage-контракт, но не изменяют его
  по существу.
