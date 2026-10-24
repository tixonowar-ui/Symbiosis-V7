# ADR 0048 — Случайное получение симбионтов

- **Статус:** принято
- **Дата:** 2026-10-25
- **Дополняет:** модель броска [ADR 0021](0021-roll-model.md), необратимую границу
  [ADR 0042](0042-character-creation-stats-and-rolls.md), структурные projections
  [ADR 0045](0045-character-decision-consequences.md), стартовые навыки
  [ADR 0046](0046-character-starting-skills.md) и каналы решений
  [ADR 0049](0049-atlas-missing-decision-channels.md)
- **Узко заменяет:** запрет обобщения `ROLL-COMMIT` на `CHR-020` из
  [ADR 0042 §1](0042-character-creation-stats-and-rolls.md) и actionless-границу
  `CHR-015/CHECKPOINTED` из [ADR 0046 §10](0046-character-starting-skills.md)

## Контекст и источники

Issue #135 реализует только случайную ветвь `SYMBIONTS`: `CHR-017` открывает
`CHR-020`, случайный Советник проходит `CHR-041`, а срез заканчивается read-only
`CHR-019`. Ручная ветвь, branch cache и следующий checkpoint в имущество не
входят в задачу. ADR 0049 поставил каналы выбора стороны, вида чудовища и два
разных пути бросков Советника; этот ADR закрепляет их durable и domain
семантику, не меняя Atlas.

Механика задана следующими источниками:

- `CORE-168`–`CORE-171`: [`rules.json`, строки 2582–2688](../../generated/spec/rules/rules.json#L2582-L2688);
- `CORE-164`: [`rule-trace.json`, строки 317–329](../../generated/spec/character/rule-trace.json#L317-L329);
- виды, расы, стоимость слотов и профили:
  [`symbionts.json`](../../generated/spec/character/symbionts.json),
  [`races.json`](../../generated/spec/character/races.json);
- 14 profile modifiers: [`modifiers.json`, строки 408–603](../../generated/spec/character/modifiers.json#L408-L603);
- взаимодействия: [`incompatibilities.json`](../../generated/spec/character/incompatibilities.json),
  `SYM-075/076`, `Q-SYM-005/016/021/031/032/073`;
- принятые результаты, отсутствие refill и начальные ОЭ:
  [`questions.json`, строки 3058–3075](../../generated/spec/qna/questions.json#L3058-L3075);
- Советник: `Q-CHAR-006`, `Q-SYM-040`, `SYM-095/096` и ADR 0049 §3;
- привязки: `Q-CHAR-010` и ADR 0049 §4;
- exact form fields: `CHR-017`, `CHR-019`, `CHR-020`, `CHR-041` в
  [`forms-by-id.json`](../../generated/spec/atlas/forms-by-id.json).

`Q-CHAR-004` разрешает изменять уже открытый вид чудовища до финала. ADR 0049
перенёс канал первоначального выбора на `CHR-020`, а изменение подтверждённого
вида оставил отдельному `CHR-025`. Настоящий срез реализует только первый
snapshot и не реализует последующее изменение.

## Решение

### 1. Граница среза и исполняемые каналы

В полном PR #135:

1. `CHR-015::CTA::001` подписывает `CHR-017`; каталог публикует sanitized
   `eligibleSymbiontSpecies[]` и `slotCapacity`;
2. `CHR-017::CTA::003` открывает random sequence на `CHR-020`;
3. `CHR-020` исполняет roll variants и отдельный binding-only variant существующего
   `UI-CMD-CHAR-CREATION-ROLL-COMMIT`;
4. random Advisor проходит `CHR-041` с уже сохранёнными I/W receipts, заполняет
   свои стартовые слоты и подтверждает их существующим
   `UI-CMD-CHAR-WIZARD-CHECKPOINT`;
5. `CHR-019` показывает фактический random composition и остаётся actionless.
   Его `CHR-019::CTA::001` в `CHR-021` capability-excluded.

`CHR-041::CTA::003` относится к manual Advisor: random Advisor уже имеет оба I/W
receipt и не получает повторный roll CTA. Manual Advisor, manual composition и
`CHR-018` этим PR не публикуются. Каналы ADR 0049 сохраняются для их отдельной
реализации и не трактуются как разрешение смешать random и manual durable stages.

### 2. Единая durable sequence и append-only физические записи

На черновик существует не более одной активной `randomSymbiontStage` на
`randomSequenceId`. Её project-owned serialization:

```text
{randomSequenceId,raceChoice:"FREE"|"UNITED",
 symbiontAcquisitionMode:"RANDOM",diceInputModeSnapshot:"AUTO"|"MANUAL",
 pendingRollRequestOrNull:null|{
   rollRequestId,kind,originRollRequestIdOrNull,advisorAcceptedIndexOrNull},
 physicalRolls:[...append-only...],
 bindingRecordOrNull:null|{bindings,request,receipt,nextStageEnvelope}}
```

`randomStatus`, `pendingRollRequestIdOrNull`, `drawnSpeciesAndBindings[]`,
`duplicateRerollReceipts[]`, accepted composition и modifier breakdown являются
validated derived views, а не второй изменяемой копией тех же фактов. Persisted
`physicalRolls[]` содержит пять closed kinds:

```text
SPECIES_ORIGIN
CRITICAL_CONFIRMATION(originRollRequestId,selectedMonsterSpeciesKeyOrNull)
ADVISOR_I(advisorAcceptedIndex)
ADVISOR_W(advisorAcceptedIndex)
TROGR_SUPPRESSION_B(advisorAcceptedIndex)
```

Каждая запись содержит собственные non-empty `rollRequestId`,
`rollReceiptId` и source-neutral D20 `{dieSides:20,rawFace}`. Critical record
адресует уже сохранённый origin. Advisor и suppression records адресуют accepted
index Советника. IDs не пересекаются между собой и с `randomSequenceId`; повтор
либо подмена identity означает corruption и fail-closed.

`selectedMonsterSpeciesKeyOrNull=null` во всех промежуточных подтверждениях и
подтверждениях без права на чудовище. Terminal confirmation первого eligible
крита Единого сохраняет выбранный вид именно в этой записи, как требует ADR
0049 §5. Local draft выбора до commit не является физическим результатом.

Host создаёт не более одного pending descriptor следующего требуемого kind. При
`AUTO` после всех guards вызывается существующий cryptographic sampler ровно
один раз для нового D20; при `MANUAL` принимается ровно одна грань `1..20` без
sampler. Commit результата и всей производной sequence атомарен. Первый
committed display, а не transport ack, необратим.

`NOT_STARTED` означает отсутствие и pending descriptor, и physical records.
Создание первого pending descriptor переводит host projection в `PENDING` ещё до
первого face. Чистый domain статус описывает только committed sequence и поэтому
в этой точке ещё возвращает `NOT_STARTED`; host накладывает свой pending
descriptor, не изменяя domain records. После всех обязательных physical records
наступает `BINDING`, после binding record — `COMMITTED`.

Replay, refresh, reconnect и restart читают сохранённые records и receipts.
Они не создают seed, replacement request или новый sampler call. Exact replay
возвращает прежний command result; changed payload получает idempotency
conflict и zero write/sample. Roll source остаётся provenance и не меняет чистый
результат.

### 3. Дубликат — отдельный физический бросок

Каждый переброс дубликата получает новый addressed request и receipt. Прежняя
грань, её receipt и provenance не заменяются. Derived
`duplicateRerollReceipts[]` содержит по одному элементу на физический duplicate:

```text
{rollRequestId,rollReceiptId,speciesKey,duplicateOfAcceptedIndex}
```

`attemptIndex` не вводится: осью provenance является позиция append-only
`physicalRolls[]`, а accepted index существует только у принятых видов.
Подтверждения крита и вспомогательные броски Советника также имеют собственные
records и не маскируются под duplicate receipt.

### 4. Accepted count, остановка и невозможность «no free species»

`FREE` завершает обычные броски после одного accepted ordinary. `UNITED` — после
четырёх accepted ordinary, если раньше не получено чудовище. Duplicate не
увеличивает accepted count. Вид остаётся в accepted history даже после
поглощения либо гибели, поэтому повтор такого вида также является duplicate.

После каждого accepted ordinary немедленно разрешаются взаимодействия.
Поглощение и проигрыш дуэли расходуют accepted result, но не открывают
компенсационный бросок. Это прямое правило `Q-CHAR-007`, а не попытка заново
заполнить фактически освободившиеся слоты. Добровольно оставить пустой слот
без такого взаимодействия нельзя.

Ветка `CORE-171` «нет свободного допустимого вида» в этом срезе недостижима.
Перед четвёртым accepted ordinary у Единого не более трёх разных accepted
видов из двадцати; у Вольного перед единственным результатом accepted history
пуста. Взаимодействия не расширяют эту history сверх четырёх. Поэтому domain
не создаёт fictitious `NO_FREE_SPECIES` outcome; нарушение closed catalog
инварианта является ошибкой, а не игровым пустым заражением.

### 5. Крит и чудовище

Каждый origin D20 с натуральной `1|20` получает существующую confirmation chain
с диапазонами `1..5` и `15..20`, первым miss либо grade cap `5`.
Подтверждение само не начинает новую цепочку. Source-neutral helper возвращает
только grade/polarity; stat value и `creationCriticalPenalty` остаются в adapter
`CHR-004` и не переносятся на симбионтов.

Подтверждённый крит является monster-eligible только для `UNITED` на первом
обрабатываемом origin, пока accepted ordinary history пуста. Обе polarity дают
право на один выбранный `CHIMERA|PUPPETEER|PLAGUE_DOCTOR`. Terminal confirmation
сохраняет выбор, табличный ordinary результат заменяется, чудовище занимает
четыре слота и останавливает последовательность. Grade `0` использует обычную
таблицу `CORE-169`.

Для monster-eligible confirmation host проверяет наличие и допустимость текущего
local monster choice до sampler. После получения raw face host пересчитывает
terminal по сохранённой цепочке и новой грани. В промежуточную physical record
он сохраняет `selectedMonsterSpeciesKeyOrNull=null`, а в terminal — выбор из той
же command payload. Так отсутствие либо подмена выбора отклоняются до RNG, а
изменение local choice между подтверждениями не становится durable до terminal.

После первого accepted ordinary любой поздний confirmed crit также использует
обычную таблицу; monster payload запрещён. Это остаётся истинным, если ранний
ordinary уже поглощён или уничтожен: право определяется accepted history, а не
временным active composition. Для `FREE` чудовище недоступно при любом крите.
XP и другие progression outcomes этот контракт не создаёт.

### 6. Привязки и binding-only ROLL-COMMIT

После завершения всех обязательных физических бросков `randomStatus=BINDING`.
Показанные faces, accepted history и monster snapshot уже immutable. До commit
Web вправе менять только local side draft Совы/Угря; refresh восстанавливает
durable default, а не неподтверждённый draft.

`Q-CHAR-010` задаёт closed binding table:

| Вид                       | Binding                                          |
| ------------------------- | ------------------------------------------------ |
| Сова                      | `OWL_EYE`, `RIGHT` по умолчанию, допустимы `LEFT | RIGHT` |
| Угорь                     | `EEL_ARM`, `RIGHT` по умолчанию, допустимы `LEFT | RIGHT` |
| Клещ                      | fixed `TICK_RIGHT_HAND`                          |
| Паук                      | fixed `SPIDER_BOTH_WRISTS`                       |
| Богомол                   | fixed `MANTIS_BOTH_FOREARMS`                     |
| Остальные виды и чудовища | positive `NONE`                                  |

Host выводит fixed и `NONE`; client передаёт только side selections для фактически
выпавших Совы/Угря. Selector для другого вида, unknown/duplicate species,
unknown side, missing/extra key и изменение fixed binding отклоняются. Binding
snapshot охватывает accepted history, включая consumed результаты; active
composition не используется как его замена.

`CHR-020::CTA::002` в `BINDING` принимает fresh `commandId`, `randomSequenceId`,
ссылки на сохранённые roll/result receipts и exact side snapshot. Вариант не
содержит `pendingRollRequestId`, не вызывает sampler и не создаёт physical roll,
random receipt или replacement request. Один atomic commit сохраняет binding
snapshot, command receipt и `randomStatus=COMMITTED`. Replay/refusal/reconnect
не меняет результат. Только после него разрешены system dispatch в `CHR-041`
либо `CHR-019`.

### 7. Взаимодействия, фактические слоты и ОЭ

Composition вычисляется из accepted history, а не накопительно перезаписывается
прошлым итогом. Каждый новый ordinary начинает на L1 с полным currentOE своего
профиля. В этом срезе ОЭ используются только для поставленной дуэли и её
provenance; generic progression, деревья, XP и уровневый движок не создаются.

Поддерживаются ровно строки `incompatibilities.json`:

- `TROGR-CONSUMES-TEACHER-DOLPHIN`: активный Трогр немедленно поглощает оба
  присутствующих вида без проверки. Его slotCost становится `2` после одного и
  `3` после обоих; поглощённые записи остаются в accepted/interaction history и
  не восстанавливаются. Поглощение Дельфина не пополняет currentOE: исходные
  `1000` не заменяются на `5000`.
- `TROGR-VS-KEEPER`: сравниваются текущие ОЭ. Строго больший выживает и теряет
  ОЭ жертвы; при равенстве выживают оба без списания. Свежие L1 Трогр и
  Хранитель входят с `1000` и `100`; уже понесённые потери сохраняются.
- `TROGR-SUPPRESSES-ADVISER` и `TROGR-SUPPRESSES-PENGUIN`: вид остаётся в
  composition и занимает слот, но его эффекты неактивны. Данные Советника не
  удаляются. Пингвин не получает fictitious XP outcome в этом срезе.
- `TOAD-SUPPRESSES-TAIPAN`: Тайпан остаётся, его profile effects неактивны;
  уже существующие чужие яды относятся к runtime и здесь не моделируются.
- `OWL-SUPPRESSES-DOUBLE-FOCUS`: подавляется только named ability Хамелеона,
  а не вид целиком. Сова и её активный profile modifier не затрагиваются.

Destroyed/absorbed instances не занимают слоты; suppressed занимают. Slot usage
равен сумме фактических slotCost присутствующих instances. Capacity остаётся
race catalog value `1|4`; чудовище является единственным accepted result и
занимает `4`. Выход за capacity, duplicate accepted index/species, смешение
чудовища с ordinary либо unknown interaction — corruption/fail-closed, а не
автоматический repair.

### 8. Два независимых I/W и навыки Советника

При первом accepted `ADVISER` выполняются отдельные D20 в порядке I затем W;
значения равны `rawD20+8`. Natural `1|20` здесь не запускает critical chain,
creation penalty или XP. Random sequence сохраняет оба physical record до
binding-only commit и передаёт их request/receipt IDs и значения на `CHR-041`.

Random `CHR-020` создаёт и закрывает I/W requests сам. Manual `CHR-018` в
будущем manual slice создаёт только два pending IDs; `CHR-041::CTA::003` одним
`ROLL-COMMIT` фиксирует два результата I→W с двумя roll receipts и одним command
receipt. Эти transport boundaries не смешиваются, но чистый результат общий.

Для навыков Advisor использует собственные I/W и текущие `S/D/M/Z/C` тела.
`ceil(W/2)` получается существующим `calculateStartSkillSlots`, требования —
`validateSkillRequirements`, стоимость — `calculateSkillSlotCost`. Advisor-specific
exact-fill не добавляет race/class skills носителя и не дублирует формулы.
Underfill, overfill, duplicate, fixed/unknown/ineligible skill и forged bonus
отклоняются. Подтверждение сохраняет полный набор через `CHR-041` checkpoint.

### 9. Подавленный Советник и отдельный B

Подавление не отменяет обязательные I/W и навыки: карточка сохраняется с
`effectsActive=false`, но без потери данных. Начало подавления требует отдельный
durable D20 `TROGR_SUPPRESSION_B`; random sequence выполняет его после I/W,
либо сразу при появлении Трогра, если I/W уже существовали.

`B=floor(rawD20/4+1/2)` реализует математическое округление `R20/4` с `0,5`
вверх по `Q-SYM-005`; это не crit и не новый XP event. Минимум I равен `1+B`,
либо `4+B`, если Трогр поглотил Учителя. Повторный бросок при replay, reconnect,
refresh, restart либо восстановлении той же карточки запрещён. Отсутствие B при
активном подавлении означает pending request, а не нулевое значение.

### 10. Read-only `CHR-019` и положительные пустые структуры

Для random ветки `symbiontInstancesDraft[]` является committed derived view,
а не manual editor. `speciesKeys[]` и `bindings[]` совпадают с accepted/binding
history. `slotUsageAndCapacity` содержит фактические значения после
взаимодействий.

`interactionGraph` содержит уже исполненные suppression/destruction/absorption/
duel facts в accepted order. При их отсутствии используется positive
`{kind:"NO_INTERACTIONS"}`, а не loading/null. `duplicatePolicy` сообщает
`REROLL_WITH_SEPARATE_RECEIPTS` и адресованные receipts; при отсутствии
дубликатов receipts пусты, но policy не исчезает.
`suppressionDestructionAbsorptionPreview` является фактическим consequence
summary; при отсутствии таких последствий — positive `NONE`. Pending manual
confirmation не создаётся. `compositionValidation=VALID` следует из построения;
`irreversibleBoundaryStatus=CROSSED`.

`CHR-042` не применяется к random по собственному guard, `CHR-030` не нужен
валидному по построению composition. Read-only projection не публикует local
add/remove, пятый вид или refill.

### 11. Modifier-only breakdown и sanitized projections

Domain загружает ровно 14 `SYMBIONT_PROFILE` rows, требуя
`EFFECTIVE_STATS`, `ADD`, `STAT` и `ADD_ONCE_PER_ACTIVE_SPECIES`. Поскольку
accepted duplicate вида невозможен, stack policy в этом срезе означает ровно
одно применение каждой активной species row; общий stacking engine не нужен.

Projection содержит per-species breakdown и суммарный additive breakdown только
от симбионтов. Для active вида без rows используется `NO_STAT_MODIFIERS`; для
suppressed — `INACTIVE`; destroyed/absorbed не вносят delta. `SKUNK` учитывает
closed predicate `NOT equippedHermeticNate`; в creation до имущества context
равен `false`. Другие predicates не угадываются.

Это **не** общий `EFFECTIVE_STATS`: нельзя создавать generic
`calculateEffectiveStats`, durable effective-stat map, применять race/class,
устранять minimum или объявлять готовый runtime слой. `CORE-164`, его random
clamp и окончательное durable применение остаются на `CHR-025`.

Player objects строятся explicit allowlist из `speciesKey`, source label, kind,
slot/binding facts, статусов, stat code/label/delta и interaction facts. Они не
содержат `ProfileRuleID`, `ModifierID`, `Rule IDs`, `Источник`, source question
IDs, context predicate, seed, RNG state, availability trace или raw catalog row.
Отсутствие modifiers и interactions выражается положительными variants.

### 12. Исключения и отвергнутые альтернативы

Не входят в #135:

- `CHR-018`, ручной composition и `CHR-017::CTA::001/002`;
- `CHR-042` и `CHR-030` по их exact guards;
- `CHR-017::CTA::005`/`CHR-029` и non-empty branch cache;
- `CHR-017::CTA::004`, `CHR-019::CTA::001`, `CHR-021+` и `CHR-025`;
- все safe-return без отдельного reverse durable контракта;
- изменение подтверждённого монстра после `CHR-020`;
- уровни/деревья/OE-progression/XP сверх необходимых initial OE и duel facts;
- общий runtime `EFFECTIVE_STATS`, финальный clamp и durable effective values.

Отвергнуты: перезапись duplicate в том же receipt; accepted count по активным
слотам; refill после взаимодействия; monster на позднем крите; hidden random
binding; новая binding command; sampler при binding-only/replay; общий seed;
один I/W бросок вместо двух; race/class skills в наборе Советника; удаление
suppressed Advisor card; refill ОЭ после поглощения Дельфина; превращение
modifier-only projection в generic effective-stat engine.

## Обоснование

Append-only records сохраняют физический порядок и доказывают provenance без
попытки воспроизвести RNG. Отдельная accepted history нужна потому, что
`Q-CHAR-007` отличает четыре израсходованных результата от итогового числа
активных слотов. Немедленные взаимодействия и сохранение currentOE воспроизводят
`Q-CHAR-008`, включая отсутствие восстановления после роста максимума Трогра.

Разделение binding snapshot и physical rolls прямо реализует ADR 0049: у FREE
нет later roll, на котором можно было бы сохранить сторону, поэтому нужен
самостоятельный commit без броска. Advisor helpers используют существующие
skill primitives и не смешивают два разных Atlas transport пути.

## Последствия

- Domain получает fail-closed mixed-source catalog, source-neutral critical
  helper, чистую sequence/composition/Advisor API и sanitized modifier-only
  projections. Domain не выполняет I/O и не выделяет host IDs.
- Host следующего инкремента сохраняет opaque exact sequence в существующем
  whole-checkpoint JSON; SQL migration и новый outer protocol не требуются.
- Host обязан атомарно связать pending descriptor, physical record, receipts и
  derived stage, проверить replay перед sampler и выполнить отдельные host tests
  refresh/reconnect/restart/replay. Чистые domain tests сами по себе не
  доказывают transport recovery.
- `CHR-015` больше не является terminal boundary полного PR; signed `CHR-017`
  исполняется. `CHR-019` становится новой actionless границей random slice.
- Ручная ветвь, final validation и следующие journey states сохраняют прежние
  ограничения и требуют отдельных решений.
