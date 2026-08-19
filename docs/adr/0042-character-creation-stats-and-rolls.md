# ADR 0042 — Наборы характеристик и необратимая граница броска

- **Статус:** принято
- **Дата:** 2026-08-19
- **Дополняет:** модель броска [ADR 0021](0021-roll-model.md), durable checkpoint
  [ADR 0025](0025-character-draft-checkpoint-scope.md), form authority
  [ADR 0026](0026-form-authority-and-navigation-wire.md) и фиксацию выбора
  [ADR 0041](0041-character-wizard-set-decide.md)
- **Частично заменяет:** runtime-границу `CHR-002 → CHR-003` и будущую
  блокировку результата из [ADR 0041 §4–5](0041-character-wizard-set-decide.md)

## Контекст и источники

Atlas выделяет формы `CHR-003`–`CHR-008` и `CHR-028` в journey-state
`STAT_ROLLS`: [`journeys.json`, строки 194–206](../../generated/spec/atlas/journeys.json#L194-L206).
В этом состоянии каждый показанный результат сохраняется, натуральные `1/20`
подтверждаются до решения о наборе, а отказ от набора необратим.

Exact screen-контракты находятся в
[`forms-by-id.json["CHR-003"]`, строки 10862–11522](../../generated/spec/atlas/forms-by-id.json#L10862-L11522)
и [`CHR-004`, строки 11523–11923](../../generated/spec/atlas/forms-by-id.json#L11523-L11923).
Первая форма содержит один `setRollRequestId`, один
`setRollReceiptIdOrNull` и `faces[7]OrManualInputs[7]`; вторая содержит один
`confirmationRollRequestId`, один `confirmationFaceOrNull` и один
`confirmationReceiptIdOrNull`. Exact переходы находятся в
[`transitions.json`, строки 4833–4895 и 9404–9424](../../generated/spec/atlas/transitions.json#L4833-L4895).

`UI-CMD-CHAR-CREATION-ROLL-COMMIT` требует атомарно сохранить ровно один
адресованный face/result, receipt и resulting next-state pointer. Первый показ
пересекает no-reroll boundary; Back, refresh, branch switch и replay не могут
его отменить. Exact replay возвращает сохранённый результат, изменённый payload
с тем же ID отказывается без нового request:
[`workflow-commands.json`, строки 960–975](../../generated/spec/atlas/workflow-commands.json#L960-L975).
Команда также перечисляет `CHR-020`, `CHR-021`, `CHR-022`, `CHR-037` и
`CHR-038`, но это решение их не обобщает.

Старшие игровые правила находятся в
[`rules.json`, строки 15179–15335](../../generated/spec/rules/rules.json#L15179-L15335),
а уточнения — в
[`questions.json`, строки 13–18 и 477–505](../../generated/spec/qna/questions.json#L13-L18):

- `CLASSIC` (`CORE-160`) — ровно один набор из семи независимых D20. После
  просмотра игрок либо принимает его, либо безвозвратно переходит к point-buy
  ровно `90`; каждое point-buy значение — целое `1..20`;
- `ADVENTUROUS` (`CORE-161`) — до двух наборов из семи D20. Отказ от первого
  открывает второй; отказ от второго открывает point-buy ровно `85`, каждое
  значение `1..20`;
- `ALL_OR_NOTHING` (`CORE-162`) — до пяти наборов из семи D20. Наборы 1–4
  можно принять или безвозвратно сменить, пятый обязателен; point-buy нет;
- отказ удаляет набор и все его критические последствия из active mechanics,
  но immutable receipts остаются audit provenance;
- натуральные грани создания — исходные D20 `1` и `20` (`CORE-163`).
  Подтверждённая `20` даёт `20+grade`, подтверждённая `1` оставляет значение
  `1` и отдельный постоянный `creationCriticalPenalty=-grade`; grade равен
  числу последовательных подтверждений, максимум `5`. Диапазоны подтверждения
  — `15..20` для исходной `20` и `1..5` для исходной `1`;
- confirmation roll не создаёт новую critical chain и не пишет обычные
  progression counters. AUTO и MANUAL дают одинаковый `MechanicalRoll`
  `{dieSides:20,rawFace}` по ADR 0021.

Atlas не задаёт JSON-shape элемента `naturalCriticalQueue[]` и не называет
порядок обработки одинаковых натуральных граней. Он также использует singular
`face/result` в общей команде, хотя `CHR-003` владеет одним seven-result request.
Это не пробел игрового числа: granularity уже задают один set request, один set
receipt и массив из семи граней. Ниже фиксируется только сериализация и
детерминированный порядок этой поставленной механики.

## Решение

### 1. Граница vertical slice

Runtime этого PR включает:

1. атомарный `CHR-002 → CHR-003`: четвёртая строка таблицы ADR 0041 фиксирует
   `statMethod` и создаёт первый addressed set request;
2. initial и committed проекции `CHR-003`;
3. один set-level `UI-CMD-CHAR-CREATION-ROLL-COMMIT` для семи граней;
4. переход к `CHR-004`, если очередь натуральных граней непуста;
5. все confirmation rolls текущей очереди и terminal `CHAIN_COMPLETE`.

Формы решения `CHR-005`–`CHR-008`, dialog `CHR-028` и назначение `CHR-009`
остаются следующим slice. Когда set не содержит натуральных граней, runtime
остаётся в actionless `CHR-003/DECISION_READY`. После завершения очереди он
остаётся в actionless `CHR-004/CHAIN_COMPLETE`. Direct action/command будущего
system-event получает `GUARD_REJECTED` или `NAVIGATION_UNAVAILABLE` и zero
write; same-form placeholder target не вводится.

Так сохраняется уже committed result и server-derived exact future
`returnDecisionFormId`, но не публикуется форма, контракт которой не реализован.
Следующий slice исполнит system-event без нового броска или receipt.

### 2. Фиксация метода и первый request

`CHR-002::CTA::001` становится executable только после client-local выбора
`statMethod` и при capability `UI-CMD-CHAR-CREATION-SET-DECIDE`. Exact payload
остаётся вариантом ADR 0041:

```text
{stage:"RACE_AND_METHOD",sourceFormId:"CHR-002",characterDraftId,
 wizardCheckpointId,draftRevision,
 statMethod:"CLASSIC"|"ADVENTUROUS"|"ALL_OR_NOTHING"}
```

Успешная транзакция одновременно:

- добавляет immutable method decision record;
- устанавливает `statMethod.choiceLockStatus="UNLOCKED"`;
- создаёт новый non-empty `branchUuid` и новый non-empty `setRollRequestId`;
- фиксирует `attemptIndex=1` и immutable ранее выбранный
  `diceInputModeSnapshot=AUTO|MANUAL`;
- создаёт `statRollStage` в состоянии `REQUEST_READY`;
- подписывает `nextFormId="CHR-003"`.

Method receipt result дополняется exact `branchUuid` и `setRollRequestId`.
Method commit без обоих ID, с другим destination или отдельная запись request
запрещены. IDs принадлежат этому draft/checkpoint/stage/branch и не могут
совпадать с command, receipt, character или checkpoint ID.

Initial `CHR-003` application payload exact:

```text
{characterDraftId,statMethod,attemptIndex:1,diceInputModeSnapshot,
 setRollRequestId,facesOrManualInputs:[null,null,null,null,null,null,null],
 setRollReceiptId:null,naturalCriticalQueue:[],shownResultLocked:false,
 branchUuid,wizardCheckpointId,draftRevision,commandId:null}
```

`facesOrManualInputs` — application key Atlas-literal
`faces[7]OrManualInputs[7]`; ограничение длины не становится частью JSON key.
`CHR-003::CTA::002` доступен для AUTO сразу. Для MANUAL Web хранит ровно семь
client-local slots и материализует CTA только когда каждый slot — integer
`1..20`; ввод не создаёт wire, receipt или revision. Host повторяет exact
проверку. Disabled/optimistic authority не вводится.

### 3. Exact ROLL-COMMIT request

Existing wire v1 не меняется. Payload — recursively exact union с Atlas stage
literal `STAT_ROLLS`.

Set variant:

```text
{stage:"STAT_ROLLS",sourceFormId:"CHR-003",characterDraftId,
 wizardCheckpointId,draftRevision,branchUuid,setRollRequestId,
 manualFacesOrNull:null|[face0,face1,face2,face3,face4,face5,face6]}
```

Confirmation variant:

```text
{stage:"STAT_ROLLS",sourceFormId:"CHR-004",characterDraftId,
 wizardCheckpointId,draftRevision,branchUuid,setRollReceiptId,
 criticalQueueIndex,confirmationRollRequestId,manualFaceOrNull:null|face}
```

При immutable mode AUTO manual field обязан быть `null`, и host получает raw
faces через injected cryptographic sampler. При MANUAL set variant обязан
содержать ровно семь safe integers `1..20`, confirmation variant — один safe
integer `1..20`. Client не отправляет mode, die sides, attempt, origin,
destination, grade, queue или lock. Missing/extra/mixed keys, aliases,
lower-case, unknown stage/form, неверная длина и любое значение вне domain
отклоняются до sampler, allocator и write.

Для `CHR-003` «один result» общей atomicity-команды — exact seven-face vector
одного `setRollRequestId`; каждый элемент преобразуется в обычный source-neutral
`MechanicalRoll`. Семь отдельных command/receipt не создаются. Для `CHR-004`
один result — один confirmation face.

Command receipt ID одновременно является `setRollReceiptId` либо
`confirmationReceiptId`. Отдельный псевдо-RNG receipt не создаётся. Для AUTO
этот ID добавляется в append-only `randomReceiptIds`; для MANUAL — нет.

### 4. Set result и natural queue

Set commit в одном `BEGIN IMMEDIATE` сохраняет семь raw faces, request, receipt,
immutable mode/attempt/branch и `shownResultLocked=true`. Очередь строится
только из set entries с `rawFace=1|20` и имеет exact item:

```text
{setEntryIndex:0|1|2|3|4|5|6,originFace:1|20}
```

Порядок — возрастающий исходный `setEntryIndex`, то есть порядок поставленного
массива, без сортировки по face или polarity. `criticalQueueIndex` — zero-based
индекс в этой очереди. Это сохраняет identity одинаковых значений: future
`ROLLED_BIJECTION` обязан назначать `(setEntryIndex,StatCode)`, а не только
сравнивать multiset, иначе две единицы потеряют принадлежность отдельного
`creationCriticalPenalty`.

Set receipt result exact содержит общие checkpoint/revision IDs, `branchUuid`,
`setRollRequestId`, `setRollReceiptId`, `diceInputModeSnapshot`, семь `faces`,
очередь, `shownResultLocked:true` и `nextFormId`. При непустой очереди host в
той же транзакции создаёт первый `confirmationRollRequestId` и ставит
`nextFormId="CHR-004"`; при пустой — `nextFormId="CHR-003"` и состояние
`DECISION_READY` без CTA.

Stable committed `CHR-003` projection содержит те же семь faces, receipt,
queue и lock. Player projection не содержит RNG state, seed, Rule ID или
availability trace.

### 5. CHR-004 и завершение chain

Host заранее выводит immutable `returnDecisionFormId`:

| Method / attempt        | Destination |
| ----------------------- | ----------- |
| `CLASSIC / 1`           | `CHR-005`   |
| `ADVENTUROUS / 1`       | `CHR-006`   |
| `ADVENTUROUS / 2`       | `CHR-007`   |
| `ALL_OR_NOTHING / 1..5` | `CHR-008`   |

В этом slice создаётся только attempt 1, но validator принимает таблицу как
closed future invariant и не выводит destination из client payload.

Pending `CHR-004` projection exact:

```text
{characterDraftId,setRollReceiptId,criticalQueueIndex,originFace,
 confirmationRollRequestId,diceInputModeSnapshot,confirmationFace:null,
 confirmationReceiptId:null,returnDecisionFormId,branchUuid,
 wizardCheckpointId,draftRevision,commandId:null}
```

AUTO CTA доступен сразу; MANUAL CTA появляется после одного local integer
`1..20`. Каждая успешная command транзакция добавляет immutable confirmation
record. Face в соответствующем confirmation band увеличивает grade. При grade
`<5` создаётся следующий request того же queue item. Первый miss либо grade 5
terminal: host вычисляет `resolveCreationCritical`, запрещает любой tail/new
request этого item и переходит к следующему queue item. После последнего item
`statRollStage` становится `CHAIN_COMPLETE`; новый request не создаётся,
`CHR-004::CTA::001` отсутствует, а future decision destination остаётся
server-signed, но не исполняется.

Confirmation receipt result содержит текущие IDs/index/origin/face,
`returnDecisionFormId`, exact outcome либо `null`,
`nextConfirmationRollRequestIdOrNull` и `nextFormId="CHR-004"`. Outcome exact:

```text
{setEntryIndex,value,criticalGrade,criticalPolarity,
 creationCriticalPenaltyOrNull}
```

Натуральная confirmation face не создаёт новый queue item. Empty chain,
receipt после miss/cap, пропуск index, duplicate request/receipt или outcome,
не совпадающий с сохранёнными faces, означает corruption и fail-closed.

### 6. Durable envelope, lock и revisions

`identityStage` и `raceAndMethodStage.decisionRecords` ADR 0041 остаются
append-only. Post-method payload добавляет один exact `statRollStage` с
immutable branch/method/mode/attempt/request, optional set record, ordered
queue, confirmation records и derived outcomes. Top-level latest
`receipt/nextStageEnvelope` совпадают с последней actual mutation; latest
request остаётся внутри соответствующего immutable record, откуда его выводит
validated view. Lookup command ID сканирует IDENTITY, decision records, set
record и все confirmation records; duplicate в разных местах — corruption.

`branchCacheEntries`, `selectedBranchUuidOrNull` и `branchCacheHash` остаются
exact empty contract ADR 0033/0041: этот slice не определяет non-empty cache
tuple/hash и не притворяется branch-cache implementation. Active authority
живёт в `statRollStage.branchUuid`; branch switching и abandoned branches
закрыты guard. `randomReceiptIds` меняется только перечисленным AUTO receipt.

Первый set commit, а не transport delivery/ack, атомарно переводит:

- acquisition и dice input в `LOCKED_AFTER_RESULT`;
- stat method в `LOCKED_AFTER_RESULT`;
- race оставляет `UNLOCKED` до будущего branch-change/final-save contract;
- PURE acquisition оставляет `NOT_APPLICABLE`.

После commit новый set request, смена method/mode, safe return, подмена branch
или receipt запрещены. Ошибка отправки после commit означает recovery/replay,
а не rollback.

Method commit и каждый фактический roll/confirmation дают одинаковые дельты:

| Axis                                      | Delta |
| ----------------------------------------- | ----: |
| `draftRevision`                           |  `+1` |
| local-character `stateRevision`           |  `+1` |
| local-character `projectionRevision`      |  `+1` |
| local-character `actorVisibilityRevision` |   `0` |
| `checkpointRevision`                      |  `+1` |
| shell/library revisions                   |   `0` |

Все требуемые increments, IDs и payload guards preflight до sampling/write.
Exact replay, refusal, stale/conflict, refresh, reconnect и rollback дают
`+0`. Sampler не вызывается для MANUAL, invalid request или exact replay.

Тесты доказывают no-reroll отдельно для пяти путей: forged Back после первого
display, browser refresh/new connection, transport reconnect, exact command
replay и branch-switch attempt. Каждый путь обязан вернуть те же faces/receipt,
не вызвать sampler и не увеличить ни одну revision.

### 7. Safe return и следующая assignment-граница

`CHR-003::CTA::001` в этом PR capability-excluded даже до результата. До
первого display он механически безопасен, но полезный возврат требует exact
reverse contract: что происходит с committed method decision и уже созданным
pending request, как новый method получает новый branch/request и как refresh
восстанавливает возврат. Atlas не задаёт эту durable форму, а обычная
navigation journal не переживает restart. Поэтому direct CTA получает
`NAVIGATION_UNAVAILABLE` и zero write. После результата source guard
`setRollReceiptId absent` дополнительно ложен. Следующий ADR может добавить
append-only pre-result supersession, не переписывая старый receipt.

`CHR-009 → CHR-011|CHR-012` выбирает тот же тип границы, что ADR 0041 §5.
Будущий assignment checkpoint обязан сохранить exact assignment, source set
receipt и index-to-StatCode provenance, затем подписать `CHR-011` для PURE либо
`CHR-012` для UNITED/FREE. Runtime этого PR не публикует CHR-009 и не исполняет
эту строку: valid-looking request получает `GUARD_REJECTED` и zero write.
Initial CHR-011/012 не добавляются, потому что они открывают class/skill slice,
который явно не входит в задачу.

### 8. Поправки и минимум

`CORE-159` задаёт строгий порядок: получить/распределить семь базовых значений;
затем применить race и PURE-class modifiers; затем перейти к skill slots;
позже применить symbiont modifiers; только после всех постоянных поправок
финально проверить `CORE-164`.

Поэтому CHR-003/004 сохраняют только raw/base result и creation-critical
outcomes. Race и PURE class здесь не применяются. `CHR-009` проверит только
rolled bijection либо point-buy `90/85` с каждым значением `1..20`. Финальное
«все `S,D,M,Z,I,W,C ≥1`» принадлежит `CHR-025.sevenStatsMinOne` после всех
постоянных поправок; перенос этой проверки раньше запрещён. Единственный clamp
случайного symbiont modifier также не относится к этому slice.

## Совместимость и отвергнутые альтернативы

Persistence schema не меняется: checkpoint по-прежнему хранит opaque exact
JSON и атомарную whole-snapshot replacement. Wire использует существующие
command request/result/replay/refusal. ADR 0021 остаётся единственной моделью
одной D20 грани; set result только группирует семь таких граней под одним
Atlas-owned request/receipt.

Отвергнуты: семь set receipts; один бросок, размноженный на семь полей;
`Math.random`; доверие manual client; reroll после send failure; новый result
при replay; сортировка критов по polarity; потеря set index при одинаковых
значениях; recursive critical от confirmation roll; применение race/class до
CHR-009; ранний final-min check; silent переход в несуществующую decision form;
safe return только в памяти; non-empty branch cache без hash contract; формы
бросков симбионтов/имущества в generic handler.

## Последствия

- `CHR-002` впервые исполняет четвёртую строку ADR 0041 и атомарно создаёт
  первый addressed set request.
- AUTO/MANUAL получают один durable, replayable set result; первая публикация
  навсегда закрывает method/mode и сам request.
- Все натуральные `1/20` обрабатываются последовательно и сохраняют provenance
  исходного set index; completed queue не создаёт новый roll.
- Игрок останавливается на `CHR-003/DECISION_READY` либо
  `CHR-004/CHAIN_COMPLETE` до следующего slice форм решения.
- Отказы от наборов, point-buy, assignment, PURE class, skills, symbionts,
  property и final validation этим решением не реализуются.
