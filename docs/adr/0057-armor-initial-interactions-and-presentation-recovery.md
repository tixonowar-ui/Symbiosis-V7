# ADR 0057 — Начальные взаимодействия и восстановление presentation armorBundle

- **Статус:** принято
- **Дата:** 2026-10-28
- **Дополняет:** [ADR 0056](0056-armor-interaction-confirmation-and-recovery.md)
- **Реализует:** issue #146, follow-up review PR #165

## Контекст

После ADR 0056 ревью подтвердило три оставшихся дефекта. RANDOM safe-return/resume
с последующим bundle checkpoint записывал pre-checkpoint `compositionDraftRevision`,
поэтому следующий loader отклонял durable state. Guard подтверждения требовал
вторую composition record и пропускал ABSORPTION уже в первой сохранённой записи.
Preview копировал внутренний `CORE-151` из текста ограничения трёх видов брони в
player payload и DOM.

Ни Atlas `CHR-019/INTERACTIONS_PENDING`, ни entry guard не предусматривают
исключения для первой записи. Значит, authoritative preview обязан существовать и
для неё, а persisted presentation должен проверяться вместе с остальным checkpoint.

## Решение

### 1. Результирующая RANDOM revision и полная validation

`rewriteArmorPresentation` получает `draftRevision` из нового receipt. Для RANDOM
она используется как `compositionDraftRevision`; MANUAL сохраняет стабильную
compositionDraftRevision. После записи checkpoint armor commits загружают всё
persisted state через `loadCreationWizardCheckpoint`, включая presentation row,
а не только payload snapshot. Несогласованная revision теперь отклоняется до commit.

### 2. Empty-before для первой composition record

`manualInteractionPreview` использует последнюю composition record как `after` и
предыдущую как `before`. При первой записи `before` — пустой исходный состав с
пустыми bindings. `deriveManualInteractionPreview` обрабатывает такой `before`
через существующие composition/binding primitives, сохраняя полную валидацию
`after`. Никаких игровых значений по умолчанию и synthetic records нет.

`manualInteractionConfirmationRequired` и доступность preview зависят только от
фактических `irreversibleOperationIds`, а не от количества records. Первый
ABSORPTION поэтому скрывает и server-rejects direct entry, а exact-diff
`CHR-042::CTA::001` работает по тому же контракту, что и для последующих записей.

### 3. Player-safe текст ограничений

Player-visible строки preview нормализуются при загрузке: внутренние ID-токены
удаляются, пробелы и пунктуация приводятся к читаемому виду. Смысл ограничения,
включая разрешение слоёв и подтверждение совместимости мастером, сохраняется.
Правило не меняет игровые значения и не добавляет клиентскую фильтрацию: host
остаётся единственным authority. `Rule ID`, `PDF, с.`, `Источник`, availability
trace и внутренние идентификаторы вроде `CORE-151` в projection и DOM не попадают.

## Обоснование

- RANDOM regression проходит entry → quality roll → safe-return → resume →
  checkpoint → loader → повторное открытие SQLite. Presentation revision равна
  revision нового receipt, receipt/request IDs не меняются.
- Первая UNITED composition `TROGR, TEACHER, WEAVER, CRICKET` получает
  `ABSORPTION` preview, запрещает direct entry и успешно принимает exact-diff
  SET-DECIDE. Последующие replacements используют прежний before/after контракт.
- Каталог и реальный React DOM содержат текст о разрешении слоёв и
  подтверждении совместимости мастером, но не `CORE-151`.
- Полный Vitest прогон содержит 1603 теста; RANDOM production сценарий проходит
  reload и host restart.

## Отвергнутые альтернативы

| Вариант                                 | Причина отказа                                         |
| --------------------------------------- | ------------------------------------------------------ |
| Хранить pre-checkpoint revision         | Оставляет durable state нечитаемым после commit        |
| Пропускать первую composition record    | Даёт обход обязательного подтверждения                 |
| Synthetic предыдущая composition record | Создаёт ложную authority вместо empty-before           |
| Отсутствие preview для первой записи    | Нарушает Atlas и блокирует нормативный путь            |
| Verbatim internal IDs в preview         | Нарушает приватность player payload и ADR 0056         |
| Фильтрация правил в клиенте             | Клиент не является authority и не должен менять данные |

## Последствия

- RANDOM и MANUAL recovery остаются presentation-only до bundle checkpoint;
  `CHR-022` по-прежнему не публикуется.
- Initial preview использует те же domain primitives и strict decoders, без
  нового outer protocol и без изменения `src/shared`.
- Следующие задачи #151–#156 не начинаются этим решением. Общий инвентарь,
  equipment engine и final qualityTier остаются вне среза.
