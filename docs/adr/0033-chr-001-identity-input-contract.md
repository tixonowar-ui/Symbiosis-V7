# ADR 0033 — Ввод идентичности CHR-001 подтверждается хостом до checkpoint

- **Статус:** Принято
- **Дата:** 2026-08-18
- **Дополняет:** [ADR 0020](0020-wire-protocol-and-shared-contracts.md),
  [ADR 0025](0025-character-draft-checkpoint-scope.md),
  [ADR 0028 §6](0028-wire-v2-reconnect.md) и оставленные открытыми transport и
  `draftRevision` в [ADR 0029 §§4, 6](0029-wizard-draft-initial-payload.md)

## Контекст

`CHR-001::CTA::001` существует только при валидных `name`, `age`, `massKg`, но ложный guard удаляет его из payload и UI.
Host должен узнать значения до публикации CTA; existing wire не переносит form values. Значения только внутри
checkpoint-команды образовали бы цикл: отсутствующая CTA не авторизует собственную команду.

## Что следует из источников и принятых решений

`CHR-001` — `$.forms[59]`. `inputOwner` называет actor context, `dataSources` —
четыре статических источника, а exact application fields перечислены отдельно:
[`$.forms[59].inputOwner/dataSources[0..3]/requiredFields[0..10]`, строки 54444–54484](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54444-L54484),
[`forms-by-id.json["CHR-001"].requiredFields[0..10]`, строки 10135–10146](../../generated/spec/atlas/forms-by-id.json#L10135-L10146); transport не задан.

Runtime CTA существует только пока собственный guard истинен:
[`$.forms[59].actions.availabilityContract.visibleSemantics`, строки 54514–54516](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54514-L54516).
Guard требует present `name`/`age`, массу `>0` на шаге 0,1 и committed immutable
draft UUID; authority — `SERVER_ROUTE_AND_GUARD_EVALUATOR`:
[`$.forms[59].actions.ctaAvailabilityByAction[0].guard/authoritativeSource`, строки 54562–54594](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54562-L54594).
Ложный guard удаляет CTA из player payload, DOM, a11y, hotkeys и cache:
[`$.forms[59].actions.ctaAvailabilityByAction[0].whenGuardFalse`, строка 54608](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54608),
[`forms-by-id.json["CHR-001"].actions.ctaAvailabilityByAction[0]`, строки 9864–9921](../../generated/spec/atlas/forms-by-id.json#L9864-L9921).

Глобальный contract считает отсутствующие actions negative space и требует
повторно проверить guards непосредственно перед первой записью:
[`$.globalContracts.availableActions.negativeSpace/commitBoundary`, строки 156–158](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L156-L158),
[`global-contracts.json[2].value`, строки 28, 46–47](../../generated/spec/atlas/global-contracts.json#L28-L47).
`invalidation` и action `recomputeTriggers` не содержат local field input:
[`$.globalContracts.availableActions.invalidation`, строка 157](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L157),
[`$.forms[59].actions.ctaAvailabilityByAction[0].recomputeTriggers[0..9]`, строки 54596–54606](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54596-L54606).
Это пробел transport/trigger, а не иной visibility guard.

`parameterDomains` и `mandatoryChoices` — **server output** channels:
[`$.globalContracts.availableActions.outputChannels[0..7]`, строки 146–154](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L146-L154),
[`global-contracts.json[2].value.outputChannels[0..7]`, строки 48–56](../../generated/spec/atlas/global-contracts.json#L48-L56).
Первый материализуется рядом с eligible/selected targets в
[`$.forms[118].requiredFields[3..6]`, строки 84057–84060](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L84057-L84060)
и [`$.forms[268].requiredFields[5..8]`, строки 163297–163300](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L163297-L163300),
а SYS-029 называет его normative contract разрешённых actions/targets/
parameters: [`$.forms[346].purpose/components[0..4]`, строки 199524–199575](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L199524-L199575).
`mandatoryChoices` имеет лишь отдельный reactions/mandatory output channel;
schema и input transport не определены. К CHR-001 оба канала не относятся.

Состояния формы задают смыслы: `submitting` — отправлена ровно одна команда,
`validationError` не меняет state, `CHECKPOINTED` означает durable identity:
[`$.forms[59].states`, строки 54732–54745](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54732-L54745),
[`forms-by-id.json["CHR-001"].states`, строки 10153–10165](../../generated/spec/atlas/forms-by-id.json#L10153-L10165).
`QA-FORM` и `QA-CHANGE` требуют literal semantics, но не input event:
[`$.qaScenarios[146..147]`, строки 228030–228039](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L228030-L228039),
[`qa-scenarios.json[146..147]`, строки 880–888](../../generated/spec/atlas/qa-scenarios.json#L880-L888).
`QA-REQ-002` перечисляет `IDENTITY_INCOMPLETE`, `READY_TO_CHECKPOINT`, `CHECKPOINTED` и
invalid/stale/disconnect/replay, но не событие перехода:
[`$.qaScenarios[722]`, строки 231486–231489](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L231486-L231489),
[`qa-scenarios.json[722]`, строки 4335–4338](../../generated/spec/atlas/qa-scenarios.json#L4335-L4338).
Workflow QA требует whole snapshot, next signed stage, branch-cache hash и
receipt вместе: [`$.qaScenarios[1703]`, строки 237372–237375](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L237372-L237375),
[`qa-scenarios.json[1703]`, строки 10221–10224](../../generated/spec/atlas/qa-scenarios.json#L10221-L10224).

У CHR-001 только checkpoint в CHR-010 и cancel в APP-004:
[`$.transitions[1261..1262]`, строки 224274–224286](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L224274-L224286),
[`transitions.json[1261..1262]`, строки 8830–8841](../../generated/spec/atlas/transitions.json#L8830-L8841).
Atlas умеет same-form workflow commit: `CHR-040 → CHR-040` в
[`$.transitions[1664]`, строки 227096–227100](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L227096-L227100).

Соседние команды явно патчат один stage: combat проверяет sequential stage и
`draftRevision`, enemy — DRAFT/stage/`draftRevision`; character сохраняет whole
stage, next signed stage, branch hash и receipt:
[`$.registryCoverage.workflowCommands[11]`, строки 257302–257316](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L257302-L257316),
[`$.registryCoverage.workflowCommands[58]`, строки 257837–257854](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L257837-L257854),
[`$.registryCoverage.workflowCommands[82]`, строки 258114–258135](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L258114-L258135).
Generated entries совпадают:
[`workflow-commands.json[11]`, строки 125–139](../../generated/spec/atlas/workflow-commands.json#L125-L139),
[`workflow-commands.json[58]`, строки 660–677](../../generated/spec/atlas/workflow-commands.json#L660-L677),
[`workflow-commands.json[82]`, строки 937–958](../../generated/spec/atlas/workflow-commands.json#L937-L958).
Фраза `[11]` «advance its checkpoint once» относится к checkpoint, не к
`draftRevision`; raw/generated не задают start/increment/idempotency matrix
этой оси. Scan registry XLSX также не нашёл такой trigger.

`OP-CHAR-CREATE` на CHR-001 — preparation, а executable только на CHR-025:
[`$.registryCoverage.operations[16].formModes`, строки 255412–255457](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L255412-L255457),
[`$.forms[59].references`, строки 54848–54855](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54848-L54855),
[`$.coverageRequirements[1].actionSteps[34]`, строки 12275–12292](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L12275-L12292),
[`requirements.json[1].actionSteps[34]`, строки 497–515](../../generated/spec/atlas/requirements.json#L497-L515).
Полнотекстовый scan raw Atlas и всего `generated/spec` по camel/snake/kebab/
spaced и русским вариантам field/input value, widget buffer, form/identity/
draft patch, update/change/onChange механизма не нашёл.

### Проверка гипотез

- **H1 подтверждена:** host обязан получить значения до snapshot с Continue.
- **H2 подтверждена:** источник задаёт поля/guards/result, но не transport; механизм — проектный выбор.
- **H3 опровергнута:** `commitBoundary` повторяет safety-check, а pre-publication visibility использует тот же guard.
- **H4 опровергнута для CHR-001:** exact edge ведёт в CHR-010; `CHECKPOINTED` не разрешает остаться на форме.

## Решение — проектный выбор

### 1. Runtime draft и additive wire v2

Host хранит pre-commit identity draft exact scope
`{sourceFormId:"CHR-001",contextId,characterDraftId,wizardCheckpointId}`. Он живёт в host instance,
переживает transport reconnect/replay и заканчивается при cancel, утрате
assignment, successful checkpoint или restart. SQLite row до checkpoint нет.

Wire v2 получает три новых discriminator с recursively exact keys:

```text
replace={protocolVersion:2,messageType:"character.identity-draft.replace",
 draftUpdateId,scope,expectedDraftRevision,expectedRevisions,values}
result={protocolVersion:2,messageType:"character.identity-draft.result",
 draftUpdateId,scope,draftRevision,revisions,projectionRole:"player",
 presentation:{base,layers}}
refusal={protocolVersion:2,messageType:"character.identity-draft.refusal",
 draftUpdateId,scope,revisions,presentationUnchanged:true,refusal}
```

`expectedRevisions` — полная текущая shell-тройка. `values` имеет exact shape:

```text
{name:string|null,description:string|null,
 artAssetKeyOrLocalFile:null|{kind:"asset-key",assetKey:string}|
   {kind:"local-file",mediaType:"image/png"|"image/jpeg",bytesBase64:string},
 age:number|null,massKg:number|null}
```

`draftUpdateId` — новый non-empty opaque ID replacement; UUID grammar не
вводится. Result содержит полный current `CHR-001` base, весь layer set, exact
confirmed values, совпадающий payload `draftRevision` и exhaustive actions.
Это atomic cache replacement внутри прежнего assignment, не новый assignment.

Closed application refusal:

```text
{code:"INVALID_FIELD",error:
  {field:"name",reason:"BLANK_AFTER_TRIM"|"TOO_LONG"} |
  {field:"description",reason:"EMPTY_NOT_NULL"|"TOO_LONG"} |
  {field:"artAssetKeyOrLocalFile",reason:"EMPTY_ASSET_KEY"|"ASSET_NOT_FOUND"|
    "NON_CANONICAL_BASE64"|"MEDIA_SIGNATURE_MISMATCH"|"FILE_TOO_LARGE"} |
  {field:"massKg",reason:"NOT_POSITIVE"|"STEP_MISMATCH"}}
{code:"STALE_DRAFT",expected,actual}
{code:"STALE_REVISION",expected,actual}
{code:"IDEMPOTENCY_CONFLICT",detail:"PAYLOAD_MISMATCH"} | {code:"DRAFT_UNAVAILABLE"}
{code:"REVISION_OVERFLOW",axis:"draftRevision"|"projectionRevision"}
```

Missing/extra/type/unknown получает existing `protocol.refusal` до handler.
Для `STALE_REVISION` top-level `revisions=actual`; отказ не раскрывает authority/existence probe или Rule IDs/trace.

Existing v2 messages/value domains не меняются. Это рассмотренное additive extension по ADR 0028 §6: old peer
fail-closed отвергает discriminator, response получает только его отправитель, `protocolVersion=2`.
Расширение existing snapshot/reason потребовало бы v3 и здесь запрещено.

### 2. Canonical values, ordering и revisions

- `name` хранится после ECMAScript `trim()`, без Unicode normalization. `new Intl.Segmenter('und',{granularity:'grapheme'})` считает
  1–64 clusters, содержащих не только `White_Space`/`Default_Ignorable_Code_Point`; C0/C1 controls и unpaired surrogate
  запрещены. `description` не trim'ится, non-null непустое и не длиннее 2000 code points. Source limits:
  [`$.registryCoverage.qna[296]`, строки 264088–264104](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L264088-L264104),
  [`questions.json[296]`, строки 2997–3004](../../generated/spec/qna/questions.json#L2997-L3004).
- `age` — `null` либо finite JSON number. Source не задаёт sign, integer,
  range или rounding, и ADR их не добавляет.
- `massKg` — `null` либо finite number `>0`, где `Number.isInteger(x)||Number.isInteger(x*10)`; epsilon, clamp,
  rounding и domain upper bound отсутствуют.
- Asset key непуст и exact-resolved catalog'ом. Local file — canonical padded
  RFC 4648 base64, PNG/JPEG signature совпадает с `mediaType`, decoded size не
  более `12*1024*1024` bytes. Перевод source «12 МБ» в bytes — явный technical
  choice, не новый игровой предел.

Idempotency сравнивает exact decoded request после normalization object-key order
и JSON-number `-0 → 0`, но до canonicalization strings: тот же ID с `" Bob "` и
`"Bob"` конфликтует; новый ID после trim может стать no-op. Host: exact decode →
journal lookup → exact request comparison → scope/owner/assignment/revisions →
field validation → overflow preflight → buffer replacement/publication.
Lookup всегда раньше stale checks: тот же ID/request возвращает сохранённый terminal result/refusal, другой request
даёт `IDEMPOTENCY_CONFLICT`. Journal живёт до конца host instance.

Client держит не больше одного unacknowledged update на scope; следующие
keystrokes coalesce локально. Result применяется только если ID outstanding,
scope всё ещё current и ни `draftRevision`, ни одна revision coordinate не ниже
confirmed cache; иначе response только terminal-ack/ignore. Reconnect нужен лишь
без newer full snapshot current cache. При dirty/in-flight Web в одном local
commit удаляет `CHR-001::CTA::001` из executable action cache, DOM/a11y/hotkeys;
inert confirmed baseline хранится отдельно, cancel остаётся из host result.

Eligible result обновляет confirmed baseline. Если widget ещё равен request — он
rendered; иначе newer coalesced values остаются actionless и сразу отправляются
с новым ID/axes результата. `INVALID_FIELD` не восстанавливает actions: если
widget уже изменён, replacement отправляется сразу, иначе ждёт исправления.

После reconnect client пересылает outstanding request только если fresh snapshot
имеет CHR-001 и те же character/checkpoint IDs; это не authority или proof
`contextId`, host проверяет saved scope и при mismatch даёт `DRAFT_UNAVAILABLE`.
Иначе client делает discard. Restart/new context не восстанавливает draft по IDs.

Changed accepted replacement даёт:

| Axis                              | Delta |
| --------------------------------- | ----: |
| exact draft `draftRevision`       |  `+1` |
| shell `projectionRevision`        |  `+1` |
| shell state/actor visibility      |   `0` |
| checkpoint/root/library revisions |   `0` |

Canonical no-op, refusal, reconnect, rollback, checkpoint/replay дают draft
`+0`. Overflow любой требуемой оси отказывает до mutation/publication.

Для availability source literal «immutable draft UUID committed» означает
host-confirmed immutable pre-commit assignment ADR 0029, а не уже существующую
SQLite row; иначе guard неразрешимо цикличен. Checkpoint делает тот же ID
durable. Continue появляется только после eligible result, когда current scope/
revisions валидны, required values проходят guard и capability intersection
содержит `UI-CMD-CHAR-WIZARD-CHECKPOINT`. Disabled/optimistic CTA не вводится.

Event mapping — проектный выбор: incomplete result означает
`IDENTITY_INCOMPLETE`; valid guard — `READY_TO_CHECKPOINT`; один command send —
`submitting`; field/guard refusal не меняет confirmed state; durable receipt —
`CHECKPOINTED`, после чего следует signed destination.

### 3. Checkpoint, durable envelope и replay

Continue использует existing wire v1 exact request:

```text
{protocolVersion:1,messageType:"command.request",commandId,
 commandKind:"workflow-command",workflowCommandId:"UI-CMD-CHAR-WIZARD-CHECKPOINT",
 expectedRevisions:<current shell vector>,role:"player",
 payload:{stage:"IDENTITY",characterDraftId,wizardCheckpointId,draftRevision,
          name,description,artAssetKeyOrLocalFile,age,massKg}}
```

Payload обязан совпасть с current confirmed draft. Host сам выводит
`massApprovalStatus="PENDING_GM"`, `anatomyProfile="STANDARD_HUMANOID"` и
destination. До первой записи: decode → lookup `commandId` → saved request
comparison → authority/current form/owner/capability/revisions → full guard →
preflight только shell projection/library axes, которым предстоит `+1`. Затем
`BEGIN IMMEDIATE` создаёт DRAFT `local_character` и checkpoint через ADR 0025.
Entity/checkpoint начинают с `{0,0,0}`/`0`, draft даёт `+0`, library `+1`, shell projection — conditional `+1` ADR 0031.
Guard/capability/overflow failure возвращает existing `GUARD_REJECTED`, stale — `STALE_REVISION`; оба дают zero-write.

IDENTITY-only `local_character.payload_json` — exact object; request сохраняется
один раз и уже содержит identity values:

```text
{lastCompleteStage:{request:<exact normalized command.request>,
                    derived:{massApprovalStatus:"PENDING_GM",
                             anatomyProfile:"STANDARD_HUMANOID"}},
 branchCacheEntries:[],selectedBranchUuidOrNull:null,randomReceiptIds:[],
 branchCacheHash:<HASH>,
 nextStageEnvelope:{formId:"CHR-010",routeBindings:[
   {parameterIndex:0,source:"inherited",value:<characterDraftId>}]},
 receipt:<exact CommandReceipt below>}
```

`HASH=sha256(lowercase hex, UTF-8 bytes exact string "[]")` =
`4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.
Это узкое дополнение ADR 0025 §6 только для пустого IDENTITY branch cache;
непустой tuple/algorithm следующих stages не решается.

Receipt имеет exact result:

```text
{stage:"IDENTITY",characterDraftId,checkpointOwnerId:characterDraftId,
 checkpointId:wizardCheckpointId,checkpointRevision:0,draftRevision,
 branchCacheHash:HASH,nextFormId:"CHR-010"}
```

Generic `CommandReceipt` добавляет `commandId`, `receiptId` и фактическую новую
entity-owned тройку `{0,0,0}`; она не копирует shell/library axes. Exact request
и receipt сохраняются вместе, поэтому lookup после restart сравнивает request до
stale и возвращает прежний checkpoint/receipt. Другой payload с тем же ID —
conflict; disconnect до commit — zero-write, после commit — exact replay.
`wizardCheckpointId` становится `checkpoint_id`, первая revision равна 0.

«Signed next stage» здесь означает host-owned immutable envelope/receipt,
проверяемые вместе с checkpoint checksum ADR 0025; source не задаёт отдельный
signature/MAC field или algorithm, и #97 не вправе его придумать. Restore
проверяет allowlisted CHR-010 и binding value = row `local_character_id`.
Application decoder также сверяет request/receipt `commandId`, row/checkpoint IDs и draft revision; пересчитанный hash
exact `[]` — с top-level/receipt hash; envelope form — с `nextFormId`; receipt revisions — с checkpoint/root triple.
Lookup `commandId` по durable rows обязан дать ровно одну запись; duplicate означает corruption/fail-closed, none — unknown.
DRAFT membership увеличивает `localCharacterLibraryRevision` на 1 по ADR 0032;
shell projection для других library contexts меняется по ADR 0031. Оба предела
проверяются до commit. `OP-CHAR-CREATE` здесь не исполняется.

### 4. Переход в CHR-010 и граница реализации

Commit и delivery разделены только для recovery: durable receipt → terminal
`command.result|replay` → full CHR-010 snapshot из signed destination. Это одна
успешная операция; бесконечно оставлять CHR-001 в `CHECKPOINTED` нельзя.

Но source не задаёт exact first CHR-010 projection: required fields не дают
initial shape/default для `raceConsequencesPreview` и `choiceLockStatus`:
[`$.forms[60].requiredFields[0..7]`, строки 54916–54924](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54916-L54924),
[`forms.json[60].requiredFields[0..7]`, строки 27750–27758](../../generated/spec/atlas/forms.json#L27750-L27758).
`UNSELECTED` обещает три выбора, но их CTA guards уже требуют выбранный
`raceChoice` и guard-false omission:
[`$.forms[60].actions.ctaAvailabilityByAction[3..5]/states.UNSELECTED`, строки 55193–55378, 55443](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L55193-L55443).
Safe-return `CTA::003` при сохранённом identity checkpoint ведёт назад в уже
durable CHR-001: [`forms-by-id.json["CHR-010"].actions.ctaAvailabilityByAction[2]`, строки 13999–14058](../../generated/spec/atlas/forms-by-id.json#L13999-L14058).

Следовательно, #97 не может честно добавить «minimal CHR-010 без действий»:
это нарушит literal `UNSELECTED`/safe-return, а возврат требует отдельного
контракта persisted identity editing и повторного checkpoint. До нового ADR о
CHR-010 initial input/actions/return successful checkpoint #97 **blocked**.
#97 не публикует Continue без executable checkpoint+destination capability;
отдельный меньший slice может реализовать только draft replace/result/refusal.

## Совместимость

- **ADR 0020:** v1 command/idempotency/receipt order сохранён; новый v2 discriminator не переосмысляет existing message.
- **ADR 0025:** ID/revision независимы; §6 уточнён лишь для empty IDENTITY cache и durable request/receipt.
- **ADR 0026:** host подтверждает payload/actions; command result предшествует target snapshot, browser не выбирает его.
- **ADR 0027:** IDs не дают authority; current player-local assignment проверен.
- **ADR 0028:** reconnect pair не меняется; outstanding update хранит client.
- **ADR 0029:** initial null/IDs/revision/negative space сохранены; закрыты открытые transport/increment trigger.
- **ADR 0031/0032:** pre-commit draft без SQLite shell row; first commit меняет owner и library membership.

## Обоснование

Full replacement делает confirmed draft полным и сравнимым, а отдельная `draftRevision` не смешивает runtime input с
checkpoint/root axes. Host result одним событием обновляет значения и exhaustive actions; additive v2 cases не меняют
ни existing intents, ни assignment reason, ни snapshot semantics.

## Отвергнутые альтернативы

| Вариант                                 | Причина отказа                                    |
| --------------------------------------- | ------------------------------------------------- |
| Values только в checkpoint              | CTA deadlock из guard/negative space              |
| Client сам показывает Continue          | Второй authority, обход server evaluator          |
| Выдумать wizard field-patch command     | Такого Atlas capability нет                       |
| Sparse patch/каждый keystroke           | Ordering и число increments неоднозначны          |
| Расширить navigation/snapshot           | Меняет adopted exact v2 shape/value domain        |
| Поднять весь wire до v3                 | Additive correlated cases не меняют old semantics |
| Связать draft/checkpoint/root revisions | Нарушает независимые axes ADR 0025/0029           |
| Округлить массу или ввести max          | Источник требует exact step и запрещает max       |
| Остаться на CHR-001 после commit        | Exact transition ведёт в CHR-010                  |
| Пустая CHR-010 как заглушка             | Скрывает unresolved input/actions/safe-return     |

## Последствия

- #97 получает exact identity-draft transport/envelope, но successful checkpoint заблокирован границей CHR-010;
  placeholder запрещён.
- Новый age/art/input contract либо непустой branch cache требует отдельного ADR; decoder не расширяется по аналогии.
