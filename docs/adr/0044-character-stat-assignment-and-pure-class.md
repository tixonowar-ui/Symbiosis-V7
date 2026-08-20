# ADR 0044 — Распределение характеристик и класс Чистого

- **Статус:** Принято
- **Дата:** 2026-08-20
- **Дополняет:** целочисленный `StatMap` [ADR 0024](0024-stat-map-integer-values.md),
  durable checkpoint [ADR 0025](0025-character-draft-checkpoint-scope.md),
  form authority [ADR 0026](0026-form-authority-and-navigation-wire.md) и
  фиксацию ветвей [ADR 0041](0041-character-wizard-set-decide.md)
- **Частично заменяет:** будущую assignment-границу
  [ADR 0042 §7](0042-character-creation-stats-and-rolls.md) и actionless
  `CHR-009`-границу [ADR 0043](0043-character-set-decision-and-abandonment.md)

## Контекст и источники

Atlas объединяет `CHR-009`, `CHR-011` и `CHR-012` в journey-state
`STAT_ASSIGNMENT`: [`journeys.json`, строки 207–215](../../generated/spec/atlas/journeys.json#L207-L215).
Состояние принимает rolled bijection либо point-buy, при необходимости выбирает
класс Чистого и заканчивается skill-stage характеристиками.

Exact form-контракты находятся в renderer mirror:

- [`CHR-009`, строки 1890–1962](../../generated/spec/atlas/renderer/forms-by-id.json#L1890-L1962);
- [`CHR-011`, строки 2042–2113](../../generated/spec/atlas/renderer/forms-by-id.json#L2042-L2113);
- [`CHR-012`, строки 2115–2180](../../generated/spec/atlas/renderer/forms-by-id.json#L2115-L2180).

Все три формы имеют type `screen`, role `player` и inherited route binding
`localCharacterId`. `CHR-009` требует семь полей `S,D,M,Z,I,W,C`,
`assignmentMode`, source receipt, proof, validation и checkpoint authority.
`CHR-011` требует `pureClass`, последствия класса и обязательный навык.
`CHR-012` требует breakdown `base + race + class = skill-stage` и exact
`symbiontModifiersExcluded=true`.

Forward transitions exact:

- `CHR-009` подписывает `CHR-011` для `PURE` и `CHR-012` для `UNITED|FREE`;
- `CHR-011` подписывает `CHR-012` после atomic class decision;
- `CHR-012` ведёт в `CHR-013`, который не входит в этот slice.

Источники переходов:
[`transitions.json`, строки 9481–9534](../../generated/spec/atlas/transitions.json#L9481-L9534).
Три выбора класса являются same-form `local-draft-command`:
[`transitions.json`, строки 11567–11585](../../generated/spec/atlas/transitions.json#L11567-L11585).

`UI-CMD-CHAR-WIZARD-CHECKPOINT` перечисляет `CHR-009` и `CHR-012`, а
`UI-CMD-CHAR-CREATION-SET-DECIDE` — `CHR-011`. Общие записи требуют whole-stage
atomicity, current revisions, closed decision domain и signed destination, но
не задают stage-specific JSON:
[`workflow-commands.json`, строки 936–997](../../generated/spec/atlas/workflow-commands.json#L936-L997).

Поставка задаёт canonical StatCode order `S,D,M,Z,I,W,C`, player base bounds и
целочисленность:
[`stats.json`, строки 1–100](../../generated/spec/character/stats.json#L1-L100).
ADR 0042 уже требует назначать пару `(setEntryIndex,StatCode)`, а не только
сравнивать multiset: одинаковые натуральные значения иначе теряют отдельный
`creationCriticalPenalty`.

Race `ClassPolicy` является authoritative routing source: `PURE` имеет
`REQUIRED_PURE_CLASS`, `FREE|UNITED` — `NO_CLASS`:
[`races.json`, строки 1–50](../../generated/spec/character/races.json#L1-L50).
Три класса, mandatory skill key и slot cost заданы каталогом:
[`classes.json`, строки 1–40](../../generated/spec/character/classes.json#L1-L40).

Skill-stage применяет только modifier rows с `ApplicationStage="SKILL_STAGE"`.
`CORE-006` прямо задаёт для `FREE + RANDOM` отсутствие расовой поправки, а для
`FREE + MANUAL` — `S−2,M−2,Z−2`:
[`rule-trace.json`, строки 44–56](../../generated/spec/character/rule-trace.json#L44-L56).
Это zero applied rows, а не отсутствующее игровое значение.

Atlas не задаёт JSON-shape `bijectionProofOrExactSum`, `assignmentValidation`,
`classConsequences`, modifier breakdown и initial nullable fields. Ниже они
фиксируются как project-owned serialization уже поставленной механики. Они не
создают новые игровые числа, значения enum либо modifiers.

## Решение

### 1. Граница slice и гипотезы

Runtime этого PR:

1. публикует initial и local-draft состояния `CHR-009`;
2. исполняет `UI-CMD-CHAR-WIZARD-CHECKPOINT` для exact assignment;
3. подписывает `CHR-011` для `PURE` либо `CHR-012` для `UNITED|FREE`;
4. публикует `CHR-011`, три client-local class selector и class confirm;
5. исполняет `UI-CMD-CHAR-CREATION-SET-DECIDE` для `CHR-011`;
6. публикует derived actionless `CHR-012` для всех трёх рас.

Гипотезы получают verdict:

- H1 подтверждена с provenance-уточнением: `CHR-012` не имеет отдельной
  durable стадии или empty commit, но всегда выводится из validated durable
  records, поэтому переживает restart;
- H2 подтверждена как project choice: mandatory class skill сохраняется в
  class fact, а skill draft не создаётся;
- H3 подтверждена как project choice: assignment mode и source receipt выводит
  host, client их не повторяет;
- H4 подтверждена как project choice: rolled command передаёт перестановку
  set indices, а не values.

Safe-return и следующий skill slice исключены. Это не разрешает частичный
runtime, placeholder destination либо client-authoritative calculation.

### 2. Exact initial `CHR-009` projection

Host выводит `assignmentMode`, `sourceSetReceiptIdOrNull` и `raceChoice` только
из validated durable checkpoint:

- accepted set даёт `ROLLED_BIJECTION` и non-null accepted set receipt;
- confirmed `CLASSIC_TO_90` даёт `POINT_BUY_90` и source `null`;
- confirmed `ADVENTUROUS_TO_85` даёт `POINT_BUY_85` и source `null`;
- `raceChoice` берётся из committed race decision.

`raceChoice` — project-owned signed routing context сверх Atlas requiredFields.
Он нужен, чтобы материализовать ровно один forward action `CTA::001|002`; это
не новый client input и не ослабление exact screen contract.

Canonical `StatMap` shape во всех новых payload — object с exact keys
`{S,D,M,Z,I,W,C}`. Initial `S..C` равны JSON `null`: silent assignment set order
к StatCode уже выбрал бы владельца critical penalty, а default point-buy
придумал бы игровые значения.

Rolled proof exact:

```text
{kind:"ROLLED_BIJECTION",
 sourceEntries:[{setEntryIndex:0..6,value,creationCriticalPenaltyOrNull},...exact seven],
 assignedSetEntryIndexByStat:null}
```

`sourceEntries` упорядочен по возрастающему `setEntryIndex`. `value` является
resolved value immutable accepted attempt: обычная face либо terminal critical
outcome. `creationCriticalPenaltyOrNull` принадлежит тому же index и равен
`null` либо exact negative grade `-1..-5`. Никакой сортировки по value нет.

Point-buy proof exact:
`{kind:"EXACT_SUM",requiredTotal:90|85,actualTotal:null}`.

Atlas-literal `eachValueRange=1..20 when point-buy` материализуется application
key `eachValueRange`:

JSON `null`

для rolled либо:

object `{minimum:1,maximum:20}`

для point-buy. `assignmentValidation` initial равен `null`. `wizardCheckpointId`
и `draftRevision` берутся из current checkpoint; `commandId=null`.

Initial form state — `ASSIGNMENT_INVALID`: отсутствие выбора ещё не является
ошибкой durable state. Web держит `S..C`, chosen index map или point values,
derived proof total и validation только в local draft. При complete valid draft
состояние становится `READY_TO_CHECKPOINT`; local edit не создаёт wire,
receipt или revision. Refresh восстанавливает exact initial server projection,
а не неподтверждённый local draft.

Player projection не содержит raw RNG state, seed, Rule ID, abandoned attempt
values, GM trace или authority-only destination.

### 3. Exact `CHR-009` command

Existing wire v1 не меняется. `UI-CMD-CHAR-WIZARD-CHECKPOINT` получает
recursively exact union с stage `STAT_ASSIGNMENT`.

Rolled variant:

```text
{stage:"STAT_ASSIGNMENT",sourceFormId:"CHR-009",characterDraftId,
 wizardCheckpointId,draftRevision,setEntryIndexByStat:{S,D,M,Z,I,W,C}}
```

Каждое value `setEntryIndexByStat` — safe integer `0..6`; семь values образуют
exact permutation без duplicate или gap.

Point-buy variant:

```text
{stage:"STAT_ASSIGNMENT",sourceFormId:"CHR-009",characterDraftId,
 wizardCheckpointId,draftRevision,pointBuyStats:{S,D,M,Z,I,W,C}}
```

Каждое point-buy value — safe integer `1..20`; сумма exact `90` либо `85`,
выведенная host из durable mode. Client не отправляет `assignmentMode`, source
receipt, race, source values, penalties, proof kind/total, validation,
destination или ClassPolicy. Он также не смешивает обе command variants.

Host до allocation/write:

1. проверяет exact keys, owner, current draft/checkpoint/revisions;
2. выводит terminal assignment source из immutable decision record ADR 0043;
3. для rolled требует current accepted attempt и exact accepted receipt;
4. строит effective value и penalty каждого index из set/outcomes;
5. строит `baseStats` и index-to-StatCode provenance по permutation;
6. для point-buy проверяет range и durable exact total;
7. вызывает existing `assignBaseStats` с host-derived mode и accepted values;
8. сравнивает результат с построенным exact `baseStats`;
9. выводит destination из catalog `ClassPolicy`.

Values-only multiset не считается provenance. Missing/extra/mixed key,
duplicate index, client mode/source, stale receipt, abandoned set, changed
source value либо несовпадающий domain result даёт typed refusal и zero write.

### 4. Durable assignment record и destination

Успех добавляет append-only `assignmentRecord`
`{request,derived:{assignmentMode,sourceSetReceiptIdOrNull,raceChoice,baseStats,rolledAssignmentsOrNull},receipt,nextStageEnvelope}`.

Rolled provenance exact и canonical StatCode-ordered:

```text
rolledAssignmentsOrNull:[
 {statCode:"S",setEntryIndex,value,creationCriticalPenaltyOrNull},
 ...D,M,Z,I,W...,
 {statCode:"C",setEntryIndex,value,creationCriticalPenaltyOrNull}]
```

Для point-buy `rolledAssignmentsOrNull=null`; `baseStats` является достаточным
exact assignment. Receipt result повторяет derived facts вместе с existing
checkpoint/revision authority fields и signed `nextFormId`.

Destination равен `CHR-011` только когда catalog row текущей расы имеет
`ClassPolicy="REQUIRED_PURE_CLASS"`; при `NO_CLASS` он равен `CHR-012`.
Свободный guard text, client route и сравнение literal `raceChoice` вместо
catalog policy не являются authoritative routing.

Validator пересчитывает source, permutation, values, penalties, `baseStats`,
ClassPolicy и destination. Record переживает restart внутри whole checkpoint;
две одинаковые единицы остаются различимы по index. Переписать assignment,
переназначить penalty или сослаться на rejected attempt запрещено.

Commit даёт `draftRevision/stateRevision/projectionRevision/checkpointRevision +1`,
`actorVisibilityRevision +0` и shell/library revisions `+0`.

Exact replay возвращает тот же receipt/destination. Refusal, stale/conflict,
changed replay, reconnect и rollback дают `+0`.

### 5. Initial `CHR-011` и class options

`CHR-011` достижим только из durable assignment с `raceChoice="PURE"` и
`ClassPolicy="REQUIRED_PURE_CLASS"`. Initial form state — `UNSELECTED`.

Exact initial values:
`{characterDraftId,raceChoice:"PURE",pureClass:null,classConsequences:null,mandatoryClassSkill:null,classOptions,wizardCheckpointId,draftRevision,commandId:null}`.

Оба `null` и `pureClass:null` являются project representation отсутствия
local selection, а не новыми Atlas enum values. Keys не опускаются.
`classOptions` — host-owned signed array в exact order
`SEEKER,STALKER,SOLDIER`. Option exact:
`{pureClass,classConsequences:{statModifiers:[{statCode,delta},...]},mandatoryClassSkill:{skillKey,bonus,slotCost}}`.

Modifier array sparse: содержит только фактически применяемые
`SKILL_STAGE/PURE_CLASS` rows и сохраняет порядок `appliedModifierIds`, то есть
validated catalog/source order. Zero rows не синтезируются.

Mandatory skill pairing exact:

| `pureClass` | `skillKey`     | `bonus` | `slotCost` |
| ----------- | -------------- | ------: | ---------: |
| `SEEKER`    | `PURE_SEEKER`  |       5 |          1 |
| `STALKER`   | `PURE_STALKER` |       4 |          1 |
| `SOLDIER`   | `PURE_SOLDIER` |       3 |          1 |

Skill bonus берётся из validated skill catalog, slot cost — из class row;
player projection не получает source Rule IDs.

`CHR-011::CTA::003..005` изменяют только client-local `pureClass`, selected
`classConsequences`, `mandatoryClassSkill` и state `READY_TO_CHECKPOINT`. Они не
пересекают wire, не создают command journal entry и дают revisions `+0`.

### 6. Exact class confirm и durable class fact

`UI-CMD-CHAR-CREATION-SET-DECIDE` расширяется exact variant:
`{stage:"STAT_ASSIGNMENT",sourceFormId:"CHR-011",characterDraftId,wizardCheckpointId,draftRevision,pureClass:"SEEKER"|"STALKER"|"SOLDIER"}`.

Client не отправляет consequences, modifier IDs, mandatory skill, bonus,
slot cost, race, ClassPolicy или destination. Host повторно загружает validated
catalog, требует PURE class policy и выводит весь option по `pureClass`.

`validateSkillSelection` на `CHR-011` запрещён. Эта функция проверяет exact-fill
полного skill draft и тем самым преждевременно открыла бы `CHR-013`–`CHR-015`.
Host здесь проверяет только class row, mandatory skill row, fixed bonus/slot
cost и modifier rows.

Один atomic commit сохраняет class decision record
`{request,derived:{pureClass,classConsequences,mandatoryClassSkill},receipt,nextStageEnvelope:{formId:"CHR-012",...}}`.

Mandatory skill является immutable fact выбранного класса. Он ещё не является
entry в skill-selection draft, не расходует и не считает общий набор стартовых
слотов в этом slice. Будущий skill stage обязан включить этот fact один раз.

Receipt result повторяет class facts, current authority/revisions и exact
`nextFormId="CHR-012"`. Commit использует те же revision deltas, что assignment
commit в §4. Replay возвращает тот же record; другой class под тем же command ID
даёт idempotency conflict и zero write.

### 7. `CHR-012` как derived projection

`CHR-012` не создаёт durable record при входе и не выполняет empty commit.
UNITED/FREE projection выводится после assignment receipt; PURE — после class
receipt. Signed destination предыдущего record является restart provenance.

Exact application values:
`{characterDraftId,baseStats:{S,D,M,Z,I,W,C},raceModifiers:[{statCode,delta},...],classModifiersOrNull:null|[{statCode,delta},...],skillStageStats:{S,D,M,Z,I,W,C},symbiontModifiersExcluded:true,mandatoryClassSkillOrNull:null|{skillKey,bonus,slotCost},wizardCheckpointId,draftRevision,commandId:null}`.

Host вызывает `calculateSkillStageStats` с durable `baseStats`, race, class и
creation mode. Для `UNITED|FREE` `creationMode` равен durable acquisition mode
из `CHR-016`.

Для `PURE` durable acquisition равен `null` и состояние
`NOT_APPLICABLE`. Host не придумывает mode и ничего не сохраняет: он вызывает
`calculateSkillStageStats` отдельно с `MANUAL` и `RANDOM` и принимает projection
только если оба полных result побайтово равны. Расхождение означает corruption
либо дрейф catalog и fail-closed.

`raceModifiers` и `classModifiersOrNull` строятся lookup каждого
`appliedModifierId` из domain result. Допустимы только rows с
`ApplicationStage="SKILL_STAGE"`, `SourceType="RACE"|"PURE_CLASS"` и source,
совпадающим с durable race/class. Порядок — exact domain applied-ID order;
representation sparse, без synthesized zero.

Pairing:

- `PURE`: `raceModifiers=[]`, class array non-null, mandatory skill non-null;
- `UNITED`: race array по durable `MANUAL|RANDOM`, class `null`, skill `null`;
- `FREE + MANUAL`: exact three CORE-006 rows, class/skill `null`;
- `FREE + RANDOM`: `raceModifiers=[]`, class/skill `null` по CORE-006.

Symbiont source, `CHECK_CONTEXT` row, неизвестный modifier ID, duplicate applied
ID, wrong source либо неравный пересчёту `skillStageStats` означает corruption.
Поле `symbiontModifiersExcluded` всегда boolean `true`; значение `false`,
omission либо silent включение symbiont delta запрещены.

### 8. Capabilities, safe return и privacy

В этом slice `CHR-012` terminal и actionless. Capability исключает:

- `CHR-009::CTA::003` → `CHR-010`;
- `CHR-011::CTA::002` → `CHR-009`;
- `CHR-012::CTA::002` → `CHR-011`;
- `CHR-012::CTA::003` → `CHR-009`;
- `CHR-012::CTA::001` → future `CHR-013`.

Первые четыре требуют reverse durable invalidation race-dependent class,
skills, symbionts и property, которой ещё нет. Последний открывает skill draft,
который не входит в slice. Executable/bound action state, target и parameter
data отсутствуют из runtime player projection, DOM, a11y tree, hotkeys и
presentation cache. Static Atlas identity/label может остаться в renderer
catalogue, а connection capability token — в cache как negotiated intersection;
ни то ни другое не даёт разрешения вне current form guard.

Direct form-action получает `NAVIGATION_UNAVAILABLE`; valid-looking direct
workflow command получает `GUARD_REJECTED`. Оба пути дают zero allocation,
write и revision. Client history/URL не выбирает destination.

Все projections role-filtered. RNG state, seed, Rule ID, availability trace,
abandoned set mechanics и internal modifier predicates не сериализуются.

### 9. Compatibility, validation и command lookup

Persistence schema не меняется: local checkpoint продолжает opaque exact JSON
whole-snapshot replacement. Assignment/class records входят в existing durable
envelope; top-level receipt и next-stage envelope совпадают с latest mutation.

Validator пересчитывает records от предыдущего cursor, проверяет exact JSON,
catalog tuple, canonical order, source receipts, modifier lookup, revisions и
signed destination. `commandId` ищется во всех local-character checkpoints;
дубликат между envelopes есть corruption. Receipt и allocated IDs проверяются
против всех IDs адресованного durable envelope и process-local successful IDs;
collision fail-closed.

ADR 0042 сохраняет roll/critical model, attempt index, immutable source values,
no-reroll boundary, locks и `CORE-164` на `CHR-025`. Заменяется только §7:
assignment boundary теперь исполняется и сохраняет index-to-StatCode provenance.

ADR 0043 сохраняет ordered attempts, acceptance/abandonment provenance и
point-buy source. Заменяется только terminal actionless `CHR-009` boundary:
signed destination теперь публикуется и принимает exact assignment command.

### 10. Отвергнутые альтернативы

Отвергнуты: отправка client-derived mode/source/race; value-only multiset;
сортировка одинаковых results; silent initial assignment; default point-buy;
omitted initial keys; generic proof string; dense synthesized modifier maps;
Rule IDs в player breakdown; routing по guard prose; class consequences от
client; вызов full skill exact-fill на `CHR-011`; создание skill draft вместе с
class fact; empty `CHR-012` commit; выбор fictitious PURE creation mode;
применение `CHECK_CONTEXT` или symbiont modifiers; ранний `CORE-164`; memory-only
assignment; safe-return без reverse durable contract.

## Последствия

- Каждый accepted rolled result сохраняет identity `setEntryIndex` вплоть до
  assigned StatCode и permanent critical penalty, включая duplicate values.
- Point-buy `90/85` валидируется host по durable mode, exact range и sum.
- PURE проходит обязательный class step; UNITED/FREE обходят его по catalog
  ClassPolicy, а не по client route.
- Mandatory class skill становится durable class fact, не открывая skill draft.
- `CHR-012` одинаково восстанавливается после restart для всех трёх рас и
  показывает source-backed sparse breakdown без симбионтных поправок.
- Следующий slice начинает `CHR-013`; safe-return и финальный minimum остаются
  отдельными контрактами.
