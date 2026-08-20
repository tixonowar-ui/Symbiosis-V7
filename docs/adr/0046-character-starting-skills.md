# ADR 0046 — Каталог и стартовый выбор навыков персонажа

- **Статус:** Принято
- **Дата:** 2026-08-21
- **Узко заменяет:** actionless-запрет для `CHR-012::CTA::001` из
  [ADR 0044 §8](0044-character-stat-assignment-and-pure-class.md#8-capabilities-safe-return-и-privacy)
- **Дополняет:** маршрутизацию `local-draft-command` из
  [ADR 0020 §2](0020-wire-protocol-and-shared-contracts.md#2-шесть-видов-команд-и-их-маршруты),
  checkpoint черновика [ADR 0025](0025-character-draft-checkpoint-scope.md) и
  player-facing allowlist [ADR 0045](0045-character-decision-consequences.md)

## Контекст и источники

Journey-state `SKILLS` содержит `CHR-013`, `CHR-014`, `CHR-015` и завершается
только после заполнения всех стартовых слотов:
[`journeys.json`, строки 217–225](../../generated/spec/atlas/journeys.json#L217-L225).
В этом срезе публикуются каталог `CHR-013` и выбор `CHR-015`. Карточка
`CHR-014` вместе с `CHR-013::CTA::001` отложена в
[#129](https://github.com/tixonowar-ui/Symbiosis-V7/issues/129): exact
`navigation.form-action` не несёт выбранный навык
([`wire-v2-protocol.ts`, строки 64–69](../../src/shared/wire-v2-protocol.ts#L64-L69)),
а `CHR-014.skillId` обязателен
([`forms-by-id.json`, строки 16310–16320](../../generated/spec/atlas/forms-by-id.json#L16310-L16320)).

`CHR-013` не имеет workflow command и объявляет read-only поля каталога,
включая `eligibleSkillIds[]` и `skillCardSummaries[]`:
[`forms-by-id.json`, строки 15611–15624, 15916–15924](../../generated/spec/atlas/forms-by-id.json#L15611-L15624).
Его exact доступный переход в этом срезе — `CHR-013::CTA::002` в `CHR-015`
при current skill-stage revision
([строки 15713–15764](../../generated/spec/atlas/forms-by-id.json#L15713-L15764)).

У `CHR-015` намеренно две разные механики. `CTA::003` — same-form
`local-draft-command`
([`transitions.json`, строки 11587–11593](../../generated/spec/atlas/transitions.json#L11587-L11593));
по ADR 0020 он не попадает в wire, а host видит только последующее подтверждение.
`CTA::001` — `UI-CMD-CHAR-WIZARD-CHECKPOINT`, guard которого требует валидности
всех обязательных стартовых слотов и подписывает `CHR-017`
([`forms-by-id.json`, строки 16442–16497](../../generated/spec/atlas/forms-by-id.json#L16442-L16497)).
Общая команда атомарно сохраняет целый stage snapshot, следующий подписанный
этап и receipt; reconnect восстанавливает последний полный stage
([`workflow-commands.json`, строки 936–958](../../generated/spec/atlas/workflow-commands.json#L936-L958)).

Механика уже принадлежит domain. `CORE-081` задаёт `ceil(W/2)`, `CORE-165` —
стоимость target bonus, `CORE-167` — требования, а
`validateSkillSelection` включает class/race facts и требует exact fill:
[`skills.ts`, строки 58–81, 84–105, 107–201](../../src/domain/rules/skill-stage/skills.ts#L58-L201).
Selectable skill обязательно имеет один requirement set, формулу `CORE-165` и
не имеет ruled upper limit
([`catalog.ts`, строки 419–451](../../src/domain/rules/skill-stage/catalog.ts#L419-L451)).
`OP-CHAR-CREATE` подтверждает порядок проверки и заполнение всех стартовых
слотов
([`operations.json`, строки 2–12](../../generated/spec/character/operations.json#L2-L12)).

Hostile-проверка обнаружила два недостающих в literal Atlas representation
поля, но не пробел игровой механики. `selectedSkillIds[]` не выражает
`targetBonus`, хотя domain принимает пару `{skillKey,targetBonus}`
([`skills.ts`, строки 22–37](../../src/domain/rules/skill-stage/skills.ts#L22-L37)),
а каталог обязан показывать bonus/slot cost. Кроме того, `CHR-013` недостижим из
текущей actionless `CHR-012`, пока не включён её exact checkpoint edge. ADR 0045
прямо разрешает более позднему ADR добавить exact host-signed application
context сверх Atlas `requiredFields`
([`ADR 0045`, строки 32–48](0045-character-decision-consequences.md#L32-L48)).
Поэтому оба места закрываются project representation ниже, без новых игровых
значений и без изменения `src/shared` либо `src/domain`.

## Решение

### 1. Граница среза и две durable стадии

Срез публикует `CHR-013` и `CHR-015`, исполняет `CHR-012::CTA::001` и
`CHR-015::CTA::001`, а заканчивается actionless на
`CHR-015/CHECKPOINTED`. `CHR-017` и следующие формы не публикуются.

Запрет ADR 0044 §8 узко снимается только с `CHR-012::CTA::001`. Сам ADR 0044
объяснял прежнее исключение тем, что action открывает skill draft, не входивший
в тот slice
([`ADR 0044`, строки 332–348](0044-character-stat-assignment-and-pure-class.md#L332-L348));
теперь этот reason больше не выполняется. Exact Atlas edge является workflow
checkpoint с guard `seven skill-stage values fixed`
([`forms-by-id.json`, строки 15955–15960](../../generated/spec/atlas/forms-by-id.json#L15955-L15960)).

Durable payload получает две последовательные записи:

```text
skillEligibilityStage:{request,derived,receipt,nextStageEnvelope(CHR-013)}
skillSelectionStage:null|{request,derived,receipt,nextStageEnvelope(CHR-017)}
```

`skillEligibilityStage` фиксирует cross-validated derived baseline:
`skillStageStats`, `requiredSlotCount`, class/race slot facts и canonical
eligible skill IDs. Его validator заново выводит их из
`statAssignmentStage`, optional `pureClassStage` и validated catalog; stored
baseline не становится вторым источником механики. Поэтому checkpoint больше
не является empty commit.

`skillSelectionStage` появляется только после успешного `CHR-015` checkpoint и
сохраняет canonical selected entries и полный domain result. Top-level receipt
и `nextStageEnvelope` всегда совпадают с последней durable записью; обе записи
находятся в существующем opaque whole-checkpoint JSON без SQL migration.

### 2. Exact checkpoint requests и единственный selection authority

`UI-CMD-CHAR-WIZARD-CHECKPOINT` получает два recursively exact variant:

```text
{stage:"SKILLS",sourceFormId:"CHR-012",
 characterDraftId,wizardCheckpointId,draftRevision}
```

```text
{stage:"SKILLS",sourceFormId:"CHR-015",
 characterDraftId,wizardCheckpointId,draftRevision,
 selectedSkills:[{skillId,targetBonus},...]}
```

Application `skillId` равен validated `SkillKey`. Host переводит его в domain
`skillKey`; client не отправляет raw registry row, slot cost, label,
requirements, eligibility, class/race fact, capacity, validation, learned
result или destination. `targetBonus` — положительный safe integer. Entries
уникальны и идут в canonical order validated `skills.json`; empty array
разрешён, потому что у `PURE` обязательный class skill может один заполнить всю
ёмкость.

На `CHR-015` web держит `selectedSkills` только в local draft. Add/remove не
создаёт command journal entry, receipt, durable stage либо revision и теряется
при refresh/reconnect. Единственный durable источник выбранного набора —
`skillSelectionStage`; host создаёт его целиком на confirm после повторной
валидации. Будущая реализация `CHR-014::CTA::001` вправе записывать только эту же
стадию, но её payload и переход остаются решением #129.

### 3. Sanitized skill catalog и signed level options

Host строит отдельный player-facing allowlist из raw generated rows и
cross-validates его с `SkillStageCatalog`, по образцу
`creation-decision-consequence-catalog.ts`
([строки 201–241](../../src/host/creation-decision-consequence-catalog.ts#L201-L241)).
Все 41 `SELECTABLE_GENERAL` skill идут в source order; requirements одного skill
идут в canonical stat order из `stats.json`. Public `skillId` равен validated
`SkillKey`, `skillLabel` и `statLabel` берутся только из столбца `Название`.

```text
{skillId,skillLabel,
 eligibility:"ELIGIBLE"|"REQUIREMENTS_NOT_MET",
 requirements:[{statCode,statLabel,minValue,currentValue,satisfied},...],
 levelOptions:[{targetBonus,slotCost},...]}
```

`eligibleSkillIds[]` — canonical subset summary IDs, для которых
`validateSkillRequirements` успешно прошла на fixed skill-stage values.
`skillCardSummaries[]` содержит и доступные, и недоступные rows: первые имеют
add affordance, вторые остаются read-only объяснением.

Для каждого selectable skill `levelOptions` содержит возрастающие
`targetBonus` от `1` до последнего, чей `calculateSkillSlotCost` помещается в
максимальную selectable paid capacity текущего персонажа после единственного
class slot. Хотя registry не задаёт общий верхний bonus, этот конечный список
lossless для стартового выбора: option дороже всей текущей ёмкости не может
войти ни в один валидный exact-fill набор. Slot cost всегда выводит host через
`calculateSkillSlotCost`; это не новая игровая таблица.

Player payload не содержит raw `SkillID`, `RequirementID`,
`RequirementSetID`, Rule ID, source question ID, evaluation stage,
`BeforeSymbiontBonuses`, availability trace, internal predicate или spread
source row. Обязательны два негативных serialized-payload теста: на sanitized
catalog и на фактические `CHR-013|015` projections, как в прецеденте #128
([`catalog test`, строки 189–214](../../src/host/creation-decision-consequence-catalog.test.ts#L189-L214),
[`projection test`, строки 372–380](../../src/host/projections/chr.test.ts#L372-L380)).

### 4. Объяснение недоступности без internal rule trace

`StatCode`, `Название`, `MinValue` и current skill-stage value являются
player-facing игровыми данными. `satisfied` и summary `eligibility` —
host-derived booleans, а не failed predicate trace. Поэтому недоступность
объясняется строками вида «характеристика / текущее / требуется» без
`CORE-167`, Requirement ID или свободного пересказа правила.

Host строит эти строки напрямую из validated catalog requirements и stat label
allowlist, затем сверяет итоговую eligibility с
`validateSkillRequirements`. Расхождение между row comparison и domain
validator означает catalog/code drift и fail-closed; текст domain exception
никогда не сериализуется игроку.

### 5. Class skill учитывается ровно один раз

Для `PURE` immutable `mandatoryClassSkill` из ADR 0044 §6 переводится в
`mandatoryClassSkillOrNull` с public `skillId`, label, fixed bonus и
`slotCost=1`. Он:

- добавляется domain через `classCode`, а не через `selectedSkills`;
- входит в `paidSlotUsage` ровно один раз;
- отсутствует из `selectedSkillIds[]`, `selectedSkills[]` и
  `eligibleSkillIds[]`;
- не может быть добавлен либо удалён local-draft CTA.

Для `UNITED|FREE` поле exact `null`. Class row и fixed skill pairing уже
защищены catalog validator
([`catalog.ts`, строки 460–478](../../src/domain/rules/skill-stage/catalog.ts#L460-L478)).

### 6. Бесплатный race skill

`UNITED` получает singleton `racialFreeSkillIds=["FOLLOWING_PAIN"]`; у
`PURE|FREE` массив пуст. Значение является public `skillId`, то есть validated
`SkillKey`. Domain добавляет его с source `RACE_GRANTED` и `slotCost=0`
([`skills.ts`, строки 139–147](../../src/domain/rules/skill-stage/skills.ts#L139-L147)).
Он не входит в `selectedSkills`, не увеличивает `paidSlotUsage` и не уменьшает
`requiredSlotCount`. Catalog validator доказывает singleton/empty cardinality и
`FIXED_0`
([`catalog.ts`, строки 480–495](../../src/domain/rules/skill-stage/catalog.ts#L480-L495)).

### 7. `CHR-015` local projection и exact-fill confirm

Atlas `selectedSkillIds[]` сохраняется, но недостаточный literal дополняется
application key:

```text
selectedSkills:[{skillId,targetBonus,slotCost},...]
```

`selectedSkillIds[]` всегда побайтово равен проекции
`selectedSkills.map(skillId)` в том же canonical order. До confirm эти поля,
`paidSlotUsage` и `selectionValidation` являются local overlay над signed
initial projection; каждое `{targetBonus,slotCost}` обязано совпасть с одним
host-signed `levelOptions` element.

`paidSlotUsage` равен class slot плюс сумма selected slot costs. Race-free skill
в него не входит. `requiredSlotCount=ceil(W/2)`. Exact `selectionValidation`:

```text
{kind:"UNDERFILLED",requiredSlotCount,usedSlotCount,missingSlotCount}
| {kind:"EXACT",requiredSlotCount,usedSlotCount}
| {kind:"OVERFILLED",requiredSlotCount,usedSlotCount,excessSlotCount}
```

Это состояние формы, а не wire refusal: игрок может исправить local draft.
`CHR-015::CTA::001` публикуется только для `EXACT` и negotiated capability.
Host не доверяет local diagnostic, пересчитывает slot costs и вызывает
`validateSkillSelection` над всем набором. Underfill, overfill, duplicate,
fixed/ineligible skill или forged target bonus дают bare `GUARD_REJECTED` и
zero write. Разные under/over diagnostics доказываются projection/local-draft
тестами, а не расширением player-facing refusal.

ADR 0020 оставляет `GUARD_REJECTED` exact `{code:"GUARD_REJECTED"}` без
diagnostic или failed predicate
([`ADR 0020`, строки 136–144](0020-wire-protocol-and-shared-contracts.md#L136-L144));
`src/shared` не меняется.

### 8. `CHR-013` read-only и revision scope

`CHR-013` не создаёт собственной durable стадии, record или revision axis и не
меняет selection. Он проецируется из validated `skillEligibilityStage` и
sanitized catalog; validator этой baseline заново читает
`statAssignmentStage` и optional `pureClassStage`.

Сам projector даёт `+0` к state, draft, checkpoint и actor-visibility
ревизиям. Existing presentation assignment либо normative переход в `CHR-015`
может изменить только существующую `projectionRevision` по общему navigation
contract; это не stage mutation и не новая `selectionRevision`. Refresh после
неподтверждённых `CHR-015` edits возвращает последнюю durable baseline, а не
client-local набор.

### 9. `selectionRevision`, safe returns и cut `CHR-014`

`selectionRevision` не является новой durable осью. Для будущей `CHR-014` это
form-local имя current wizard `draftRevision` на момент открытия карточки; add
обязан отвергнуть карточку, если durable revision изменилась. Initial value,
lifetime и increment matrix отдельной оси не вводятся. В этом PR поле не
сериализуется и не хранится, потому что `CHR-014` не публикуется.

`CHR-014::CTA::002` с guard `no selection mutation`
([`forms-by-id.json`, строки 16119–16172](../../generated/spec/atlas/forms-by-id.json#L16119-L16172))
сам по себе не требует reverse durable invalidation. Тем не менее action
исключён: после разреза его source form не публикуется и нельзя отдельно
включить недостижимый return. #129 вправе включить его вместе с карточкой.
Остальные safe-return `CHR-013::CTA::003` и `CHR-015::CTA::002` остаются
исключены по ADR 0044 §8; их action/target data отсутствуют из executable
player projection, DOM, a11y, hotkeys и cache.

### 10. Actionless committed boundary, refusals и revisions

Успешный `CHR-015::CTA::001` сохраняет `skillSelectionStage`, подписывает
`nextFormId="CHR-017"`, но публикует committed source presentation
`CHR-015/CHECKPOINTED` с exact selected set, receipt `commandId` и пустым
`availableActionKeys`. Это runtime-граница, не same-form destination. Тот же
приём уже принят для signed future destination в ADR 0043 §1
([`ADR 0043`, строки 64–70](0043-character-set-decision-and-abandonment.md#L64-L70)).
Replay и reconnect возвращают тот же receipt и actionless presentation; они не
публикуют `CHR-017` раньше следующего slice.

Оба successful checkpoint дают
`draftRevision/stateRevision/projectionRevision/checkpointRevision +1`,
`actorVisibilityRevision +0`. Local edit, refusal, replay и reconnect дают
state/draft/checkpoint `+0`; обычная presentation assignment сохраняет свою
существующую projection-only семантику.

Критерий о «прямом вызове `CHR-015::CTA::001`» означает adversarial
valid-looking command при false guard: wrong current form/stage, incomplete or
invalid selection, unavailable skill, missing capability либо locked
`CHECKPOINTED`. Он получает `GUARD_REJECTED` и zero write. Current exact valid
command, напротив, обязан commit; запрещено превращать включённый CTA в
безусловно недоступный. Direct исключённого form-action получает
`NAVIGATION_UNAVAILABLE`; malformed и stale request сохраняют свои exact
`INVALID_SHAPE|UNRECOGNIZED|STALE_REVISION` контракты.

### 11. Уточнение `currentAttemptIndexOrNull`

ADR 0043 §4 требует выбирать **active** rolled attempt только через
`currentAttemptIndexOrNull`: после acceptance pointer остаётся на принятом
элементе, после point-buy становится `null`
([`ADR 0043`, строки 155–169](0043-character-set-decision-and-abandonment.md#L155-L169)).
Это правило не запрещает terminal projection читать последний исторический
attempt после завершённого decision.

Поэтому `terminalAssignmentSource` законно использует последний element:
accepted branch проверяет его `SET_ACCEPTED` и receipt, а point-buy branch
обязан работать при null current pointer
([`creation-stat-assignment.ts`, строки 450–507](../../src/host/creation-stat-assignment.ts#L450-L507)).
`currentAttemptIndexOrNull` адресует active mechanics; terminal projection
после `ACCEPT_SET` или point-buy адресует завершивший branch tail и повторно
проверяет terminal record. Использовать `.at(-1)` как замену active pointer в
любом другом месте по-прежнему запрещено.

`creationChr004Base` также сначала получает attempt через pointer, а для
terminal `CHAIN_COMPLETE` читает последний `confirmationRecord` уже внутри него
([`server.ts`, строки 755–763](../../src/host/server.ts#L755-L763),
[`816–849`](../../src/host/server.ts#L816-L849)); это не выбор последней попытки.

## Враждебная проверка вопросов и гипотез

1. **Две механики:** разведены. `CHR-015` add/remove только local; confirm
   сохраняет whole selection. Future durable card add может писать лишь ту же
   `skillSelectionStage`.
2. **`selectionRevision`:** alias `draftRevision`, не новая ось; runtime
   implementation отложена вместе с `CHR-014`.
3. **Каталог:** allowlist shape и signed level options зафиксированы; raw IDs и
   provenance запрещены.
4. **Недоступность:** объясняется safe requirement rows и current values, не
   Rule ID или domain exception.
5. **Class skill:** domain `classCode` включает его ровно один раз в paid usage;
   selectable arrays его не содержат.
6. **Race skill:** только `UNITED/FOLLOWING_PAIN`, cost zero и вне paid usage.
7. **Exact fill:** structured local state различает under/exact/over; только
   host-validated exact set commits.
8. **`CHR-013`:** собственной стадии/записи нет, но исходная гипотеза о трёх
   источниках неполна из-за required durable eligibility baseline.
9. **`CHR-014::CTA::002`:** reverse contract не нужен, но action исключён вместе
   с source form до #129.

Вердикты гипотез:

- **H1 опровергнута.** Единственный durable selection authority подтверждён,
  но current slice не создаёт его первым add: add/remove local, а stage создаёт
  whole-set checkpoint. `CHR-014` ничего не пишет, потому что вырезана.
- **H2 опровергнута как неполная.** `CHR-013` действительно ничего не пишет,
  но восстанавливается из `skillEligibilityStage`, которая cross-validates
  `statAssignmentStage + pureClassStage + catalog`; пропуск baseline нарушил бы
  exact `CHR-012` workflow edge и reconnect contract.
- **H3 подтверждена как deferred representation constraint.** Это alias
  `draftRevision`, не отдельная ось; никакого current payload/storage для неё
  нет.
- **H4 подтверждена.** `StatCode`, stat label, `MinValue`, current value и
  boolean результата достаточны; `CORE-167` и requirement provenance игроку не
  нужны.

Stop-contract не обнаружен. Supplemental `selectedSkills` и signed
`levelOptions` восстанавливают информацию, уже обязательную для
`CORE-165`/domain input, и разрешены расширением ADR 0045; они не вводят
значения сверх поставленной формулы и current slot capacity.

## Последствия

- `CHR-013` и `CHR-015` становятся достижимым связным срезом для всех трёх рас.
- Host повторно проверяет весь набор на единственной durable границе; local UI
  не становится authority.
- Durable validator получает две SKILLS records и fail-closed cross-check
  catalog-derived baseline/result без новой SQL migration.
- Player видит названия, требования, current values и цены уровней, но не
  внутреннюю трассировку реестра.
- `CHR-014`, её add и безопасный возврат остаются явно отложены в #129; ADR не
  придумывает отсутствующий navigation parameter.
- `CHR-017` уже подписана receipt, но до следующего slice runtime намеренно
  остаётся actionless на `CHR-015/CHECKPOINTED`.

## Отвергнутые альтернативы

- Durable mutation на каждый `CHR-015` add/remove — противоречит
  `local-draft-command` и ADR 0020.
- Хранить только `selectedSkillIds[]` с implicit `targetBonus=1` — значение
  отсутствует в источнике и ломает `CORE-165`.
- Доверять присланному `slotCost`, eligibility либо requirement diagnostic —
  отдаёт игровую authority клиенту.
- Ввести отдельную `selectionRevision` — Atlas не задаёт owner, lifetime или
  increment matrix; существующей `draftRevision` достаточно.
- Показать domain exception/Rule ID в refusal — нарушает privacy ADR 0020 и не
  помогает local CTA, которого в wire нет.
- Считать `CHR-012::CTA::001` navigation-only без checkpoint — нарушает exact
  workflow kind, atomicity и reconnect.
- Публиковать `CHR-017` либо изображать `CHR-015` same-form destination — выходит
  за slice и противоречит подписанному envelope.
- Включить `CHR-014::CTA::002` отдельно — у action нет опубликованной source
  form после разрешённого разреза.
