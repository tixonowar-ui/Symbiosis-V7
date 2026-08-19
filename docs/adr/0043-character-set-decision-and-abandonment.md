# ADR 0043 — Решение о наборе и необратимый отказ

- **Статус:** Принято
- **Дата:** 2026-08-20
- **Дополняет:** фиксацию ветвей [ADR 0041](0041-character-wizard-set-decide.md)
- **Частично заменяет:** actionless-границу, single-attempt envelope и запрет
  нового set request из [ADR 0042](0042-character-creation-stats-and-rolls.md)

## Контекст и источники

ADR 0042 довёл `STAT_ROLLS` до immutable набора и завершённой очереди его
натуральных критов. Runtime останавливался в `CHR-003/DECISION_READY` либо
`CHR-004/CHAIN_COMPLETE`, не публиковал формы решения и не создавал следующую
попытку. Atlas продолжает тот же journey-state формами `CHR-005`–`CHR-008` и
dialog `CHR-028`:
[`journeys.json`, строки 194–205](../../generated/spec/atlas/journeys.json#L194-L205).
`CHR-009`, `CHR-011` и `CHR-012` уже принадлежат следующему состоянию
`STAT_ASSIGNMENT`:
[`journeys.json`, строки 207–215](../../generated/spec/atlas/journeys.json#L207-L215).

Exact form-контракты: [`CHR-005`, строки 11666–12065](../../generated/spec/atlas/forms-by-id.json#L11666-L12065),
[`CHR-006`, 12066–12466](../../generated/spec/atlas/forms-by-id.json#L12066-L12466),
[`CHR-007`, 12467–12867](../../generated/spec/atlas/forms-by-id.json#L12467-L12867),
[`CHR-008`, 12868–13269](../../generated/spec/atlas/forms-by-id.json#L12868-L13269) и
[`CHR-028`, 23316–23774](../../generated/spec/atlas/forms-by-id.json#L23316-L23774).

Общая команда требует decision receipt, server-signed destination, сохранение
provenance и explicit confirmation до необратимой границы:
[`workflow-commands.json`, строки 977–997](../../generated/spec/atlas/workflow-commands.json#L977-L997).
Однако её фраза `cancel before commit changes nothing` не говорит, является ли
сам `CANCEL` durable decision. Form-specific контракт уточняет её: состояние
`CANCELLED` возвращает к signed origin `with no state change`, cancel guards не
требуют committed `decisionReceiptId`, а source set остаётся current и
immutable
([`forms-by-id.json`, строки 23659–23662, 23723–23758](../../generated/spec/atlas/forms-by-id.json#L23659-L23758)).

Игровая механика закрыта поставкой: `CLASSIC` имеет один набор и point-buy `90`
после отказа ([`rule-trace.json`, строки 255–267](../../generated/spec/character/rule-trace.json#L255-L267));
`ADVENTUROUS` — до двух и point-buy `85` после второго
([строки 271–283](../../generated/spec/character/rule-trace.json#L271-L283));
`ALL_OR_NOTHING` — до пяти с обязательным пятым
([строки 287–299](../../generated/spec/character/rule-trace.json#L287-L299)).
Отказ полностью исключает values и critical consequences текущего набора из
active mechanics
([`questions.json`, строки 487–495](../../generated/spec/qna/questions.json#L487-L495)).

Atlas не задаёт JSON-shape `irreversibleConsequences`, cardinality/order для
`abandonedSetReceiptIds[]` и initial `decision` состояния `WARNING`. Это не
пробел игрового значения: отказ, его две категории последствий, точный
destination и числа `90`, `85`, `2`, `5` определены выше. Как ADR 0042
зафиксировал сериализацию `naturalCriticalQueue[]`, не меняя механику, это
решение фиксирует только закрытое представление уже поставленных фактов.

## Решение

### 1. Граница vertical slice

Runtime публикует exact `CHR-005`–`CHR-008` после terminal roll/critical chain,
исполняет `ACCEPT_SET`, открывает `CHR-028/WARNING` form intent, исполняет его
`CONFIRM|CANCEL` и после confirmed next-attempt создаёт новый
`CHR-003/REQUEST_READY`. Цикл покрывает все разрешённые попытки, включая
обязательное принятие пятого набора `ALL_OR_NOTHING`.

Срез заканчивается после `CHR-028`, на границе journey-state `STAT_ROLLS`.
Успешное принятие набора и подтверждённый переход в point-buy сохраняют
server-signed `nextFormId="CHR-009"`, но `CHR-009` не публикуется и её
`UI-CMD-CHAR-WIZARD-CHECKPOINT` не исполняется. Rolled acceptance остаётся в
actionless `SET_ACCEPTED` исходной decision form. Point-buy confirmation
остаётся в actionless `CHR-028/COMMITTED`. Это явная runtime-граница, а не
same-form destination: durable envelope уже подписывает `CHR-009`.

`CHR-011|012`, `StatCode`, modifiers, skills, property и `CORE-164` исключены.

### 2. Таблица четырёх decision forms

Утверждение, что формы различаются ровно четырьмя значениями, опровергнуто.
Кроме method, attempt, alternate decision и transition kind, их exact payload
различается ключом set receipt и наличием attempt/fifth-attempt полей.
Параметризованная реализация обязана владеть всей таблицей:

| Form      | Method           | Attempt | Set receipt field      | Alternate decision | Transition kind         | Extra field                   |
| --------- | ---------------- | ------: | ---------------------- | ------------------ | ----------------------- | ----------------------------- |
| `CHR-005` | `CLASSIC`        |       1 | `acceptedSetReceiptId` | `USE_POINT_BUY_90` | `CLASSIC_TO_90`         | attempt field отсутствует     |
| `CHR-006` | `ADVENTUROUS`    |       1 | `setReceiptId`         | `GO_ATTEMPT_2`     | `ADVENTUROUS_TO_SECOND` | exact `attemptIndex=1`        |
| `CHR-007` | `ADVENTUROUS`    |       2 | `setReceiptId`         | `USE_POINT_BUY_85` | `ADVENTUROUS_TO_85`     | exact `attemptIndex=2`        |
| `CHR-008` | `ALL_OR_NOTHING` |     1–5 | `setReceiptId`         | `GO_NEXT_ATTEMPT`  | `ALL_OR_NOTHING_NEXT`   | `fifthAttemptMandatoryAccept` |

У всех четырёх accepted decision равен exact `ACCEPT_SET`. Initial decision
равен `PENDING`, `decisionReceiptIdOrNull=null`, `commandId=null`. Alternate
decision не записывается при открытии dialog: underlay остаётся `PENDING`, пока
`CHR-028::CTA::001` не пересечёт irreversible boundary.

Таблица определяет projector, actions, decoder, routing и guard; её поля не
выводятся из похожести payload либо свободного guard-текста.

### 3. Exact command payload

Wire v1 и outer `command.request` не меняются. Для этого среза
`UI-CMD-CHAR-CREATION-SET-DECIDE` принимает recursively exact union:

```text
{stage:"STAT_ROLLS",sourceFormId:CHR-005|CHR-006|CHR-007|CHR-008,
 characterDraftId,wizardCheckpointId,draftRevision,
 decision:"ACCEPT_SET"}
```

либо:

```text
{stage:"STAT_ROLLS",sourceFormId:"CHR-028",
 characterDraftId,wizardCheckpointId,draftRevision,
 decision:"CONFIRM"|"CANCEL"}
```

Client не отправляет current branch/set receipt, origin form, transition kind,
consequences, next attempt, point total, roll request или destination. Host
берёт их из validated durable stage/current attempt и подписанного dialog
context. Missing, extra, mixed либо unknown key/value получает exact refusal до
allocation/write.

`ACCEPT_SET` допустим только из exact current decision form таблицы.
`CONFIRM|CANCEL` требует `CHR-028/WARNING` верхним layer и совпадение его
origin/current set/revision с durable stage.

### 4. Ordered durable attempts

Один набор ADR 0042 заменяется ordered non-empty `attempts[]`. Общие authority
поля не дублируются в элементах:

```text
statRollStage:{
 branchUuid,statMethod,diceInputModeSnapshot,
 attempts:[{
   attemptIndex,setRollRequestId,setRecord,
   naturalCriticalQueue,criticalQueueIndexOrNull,
   confirmationRollRequestIdOrNull,confirmationRecords,outcomes,
   returnDecisionFormId,decisionRecordOrNull,state}],
 currentAttemptIndexOrNull}
```

`attempts[0].attemptIndex=1`; индексы возрастают ровно на один, без gap и
duplicate. Element сохраняет exact roll/confirmation shape ADR 0042. Method
задаёт closed maximum: `1` для `CLASSIC`, `2` для `ADVENTUROUS`, `5` для
`ALL_OR_NOTHING`. `returnDecisionFormId` каждого элемента совпадает с таблицей
ADR 0042: `CHR-005`, `CHR-006`, `CHR-007` или `CHR-008`.

`decisionRecordOrNull` является append-only exact record
`{request,derived,receipt,nextStageEnvelope}`. Для acceptance `derived`
содержит `decision="ACCEPT_SET"`, accepted set receipt и
`assignmentMode="ROLLED_BIJECTION"`. Для abandonment он содержит signed
`originDecisionFormId`, exact alternate decision из таблицы,
`transitionKind`, singleton abandoned set IDs, consequences и destination.
`CANCEL` record здесь не создаётся.

Validated current view выбирается только через `currentAttemptIndexOrNull`:

- до terminal decision он указывает на последний element;
- после confirmed next-attempt abandonment в той же транзакции указывает на
  новый последний element;
- после `ACCEPT_SET` остаётся на accepted element;
- после confirmed point-buy становится `null`, потому что ни один rolled set
  больше не входит в active mechanics.

Все elements до нового current обязаны иметь committed abandonment record.
После acceptance либо point-buy новые elements запрещены. Receipt решения
обязан ссылаться на set receipt того же element. Set/confirmation/decision
command ID lookup сканирует каждый element; duplicate ID в любых двух records,
неверный current pointer, лишний tail или несовпадающий derived value означает
corruption и fail-closed.

Отброшенный element не удаляется: set/confirmation receipts, faces, queue и
outcomes остаются audit provenance. Он исключается из active mechanics целиком,
включая `creationCriticalPenalty`, как требует `Q-CORE-049`.

### 5. H1 и создание следующей попытки

H1 подтверждена как project invariant ADR 0042, не registry fact. Следующая
попытка не является новой wizard branch: она сохраняет `branchUuid`,
`statMethod`, `diceInputModeSnapshot`,
`wizardCheckpointId`, character/checkpoint owner, все прежние receipts и
monotonic random provenance.

Только confirmed `ADVENTUROUS_TO_SECOND` либо `ALL_OR_NOTHING_NEXT` атомарно:

1. добавляет abandonment decision record к current attempt;
2. создаёт `attemptIndex=current+1`;
3. один раз выделяет новый `setRollRequestId`;
4. добавляет новый `REQUEST_READY` element;
5. подписывает `nextStageEnvelope` и command result с `nextFormId="CHR-003"`.

Новый branch UUID, новый method/mode/checkpoint, предварительный set result или
roll request до `CONFIRM` запрещены. Replay возвращает сохранённый request;
refresh/reconnect не выделяет замену.

### 6. CHR-028 как dialog layer и H3

H3 подтверждена с revision-уточнением. Четыре alternate CTA имеют kind
`normative`, поэтому по ADR 0026 это `navigation.form-action`, не workflow
command. Host повторно проверяет action/owner/revision/current attempt и
публикует full snapshot:

```text
presentation:{
 base:<unchanged CHR-005|CHR-006|CHR-007|CHR-008>,
 layers:[<CHR-028 dialog>]}
```

Origin screen сохраняет inherited `localCharacterId` route binding. Route
`@dialog/chr-028` не содержит параметра, поэтому layer имеет exact
`routeBindings:[]`. `characterDraftId` находится в role-filtered payload и
сверяется с underlay/durable context; отсутствие route parameter не делает его
client-selected binding. Верхний interactive layer `CHR-028` является source
последующих form actions.

Открытие пишет только navigation journal terminal текущего host process и даёт
presentation-only `projectionRevision +1`. `draftRevision`, `stateRevision`,
`actorVisibilityRevision` и `checkpointRevision` не меняются; decision record,
receipt, request, seed/RNG и top-level durable envelope не создаются.

Validator допускает `projectionRevision` gaps от presentation-only переходов;
state/visibility/draft/checkpoint остаются exact. Command guard сравнивает
expected revisions с current entity vector, не с projection последнего receipt.

`WARNING` projection exact:

```text
{characterDraftId,originDecisionFormId,transitionKind,
 abandonedSetReceiptIds:[currentSetReceiptId],
 irreversibleConsequences,decision:null,decisionReceiptIdOrNull:null,
 wizardCheckpointId,draftRevision,commandId:null}
```

`originDecisionFormId`, `transitionKind`, singleton set ID и consequences
подписывает host. Initial `decision:null` — project representation состояния до
выбора, а не новое значение Atlas enum.

### 7. H4 и exact consequences

H4 подтверждена только в prospective части. В `WARNING` current set ещё не
отброшен, поэтому `abandonedSetReceiptIds` показывает то, что будет отброшено
при `CONFIRM`. Но объяснение plural накоплением прежних наборов отвергнуто:
Atlas говорит `Exact abandoned set`, каждый переход отбрасывает ровно current
set, а прежние attempts уже доступны в durable provenance.

Во всех состояниях dialog поле является exact singleton
`[currentSetReceiptId]`. После `CONFIRM` тот же singleton сохраняется в одном
abandonment decision record. Старые set receipts не копируются в новый dialog
list; они остаются в прежних attempt elements.

`irreversibleConsequences` — closed JSON object без пользовательского текста:

```text
{setValuesDiscarded:true,
 creationCriticalConsequencesDiscarded:true,
 nextAttemptIndexOrNull:null|2|3|4|5,
 exactPointBuyTotalOrNull:null|90|85}
```

Допустимы только pairing:

| Transition kind         | `nextAttemptIndexOrNull` | `exactPointBuyTotalOrNull` |
| ----------------------- | -----------------------: | -------------------------: |
| `CLASSIC_TO_90`         |                   `null` |                       `90` |
| `ADVENTUROUS_TO_SECOND` |                      `2` |                     `null` |
| `ADVENTUROUS_TO_85`     |                   `null` |                       `85` |
| `ALL_OR_NOTHING_NEXT`   |       `attemptIndex + 1` |                     `null` |

Для последней строки current attempt обязан быть `1..4`, поэтому derived next
равен `2..5`. Оба discard boolean всегда `true`: частичный отказ только от
values либо только от critical consequences запрещён. Имена JSON keys являются
project-owned serialization; их значения дословно следуют `Q-CORE-049` и
transition table, а не вводят новую механику или prose.

### 8. CANCEL и H2

H2 в варианте durable receipt/revision опровергнута. `CANCEL` является
успешным workflow-command terminal на wire, но не committed abandonment
decision.

Host создаёт обычный wire `CommandReceipt` с unchanged command revision vector
и result, содержащим `decision="CANCEL"`, signed `originDecisionFormId`,
`nextFormId=originDecisionFormId` и `decisionReceiptIdOrNull=null`. Exact replay
с тем же command ID/payload в текущем host process возвращает тот же wire
receipt; changed payload даёт `IDEMPOTENCY_CONFLICT`.

Wire receipt хранится только в existing in-memory command journal. `CANCEL` не
добавляет durable record, не меняет current attempt, checkpoint payload,
top-level receipt/envelope или random IDs, даёт
`draftRevision/stateRevision/checkpointRevision +0` и оставляет durable
`decisionReceiptIdOrNull=null`.

После terminal result host снимает dialog layer и отдельным presentation-only
шагом публикует signed origin/current set: `projectionRevision +1`, остальные
revisions `+0`. Закрытие окна без команды также не является `CANCEL`: оно не
создаёт даже wire receipt, а reconnect выводит presentation из durable current
attempt.

Host restart завершает неперсистентный command journal, поэтому cancel receipt
после restart не восстанавливается: `commandId` больше не связан с checkpoint и
получает `UNRECOGNIZED`. Recovery либо возвращает current set по более ранней
durable command, либо ведёт в `APP-001`, не изобретая receipt и decision. В том же
host process origin восстанавливается из session. Durable mechanics не менялась,
abandonment не состоялся, а cancel без signed dialog context guard-rejected.

### 9. CONFIRM, acceptance и H5

H5 подтверждена. `ACCEPT_SET` всегда сохраняет
`assignmentMode="ROLLED_BIJECTION"`, non-null current set receipt и signed
`nextFormId="CHR-009"`.

`POINT_BUY_90` и `POINT_BUY_85` достижимы только через committed
`CHR-028/CONFIRM` с `CLASSIC_TO_90` либо `ADVENTUROUS_TO_85`. Receipt сохраняет
exact total `90` или `85`, `sourceSetReceiptIdOrNull=null` для будущей
assignment projection и signed `nextFormId="CHR-009"`.

Actual `ACCEPT_SET` и `CONFIRM` commit дают одинаковые durable deltas:

| Axis                                      | Delta |
| ----------------------------------------- | ----: |
| `draftRevision`                           |  `+1` |
| local-character `stateRevision`           |  `+1` |
| local-character `projectionRevision`      |  `+1` |
| local-character `actorVisibilityRevision` |   `0` |
| `checkpointRevision`                      |  `+1` |
| shell/library revisions                   |   `0` |

Transaction сохраняет record и, при переходе, новый attempt/request вместе;
top-level receipt/envelope совпадают с latest record. Guards и allocation
preflight до записи; replay/refusal/stale/conflict/rollback дают `+0`.

### 10. Attempt 5 и monotonic locks

`fifthAttemptMandatoryAccept` — server-derived projection boolean:

```text
fifthAttemptMandatoryAccept =
  statMethod === "ALL_OR_NOTHING" && currentAttemptIndexOrNull === 5
```

При `false` и attempt `1..4` `CHR-008` публикует accept и normative warning
actions. При `true` публикуется только accept; alternate CTA, target data и
dialog preview отсутствуют из payload/DOM/a11y/hotkeys/cache. Forged opening
intent получает `NAVIGATION_UNAVAILABLE`; forged `CHR-028/CONFIRM` без current
dialog context и любая попытка создать attempt 6 получают `GUARD_REJECTED` с
zero write/allocation.

Locks ADR 0042 monotonic: отказ не меняет branch и не разблокирует acquisition,
dice input или stat method. Они остаются `LOCKED_AFTER_RESULT`. PURE acquisition
остаётся `NOT_APPLICABLE`; race остаётся `UNLOCKED` до отдельного
branch-change/final-save contract. Новая попытка использует locked snapshots,
а не повторно выбирает method/mode.

## Проверка гипотез и отвергнутые альтернативы

| Гипотеза | Verdict               | Причина                                                                 |
| -------- | --------------------- | ----------------------------------------------------------------------- |
| H1       | подтверждена          | attempt не является branch; меняются только index/request               |
| H2       | опровергнута          | cancel имеет wire receipt, но zero durable write; close projection-only |
| H3       | подтверждена          | normative form intent публикует dialog layer без checkpoint mutation    |
| H4       | частично опровергнута | current singleton prospective; cumulative list источником не задан      |
| H5       | подтверждена          | rolled acceptance и оба point-buy имеют разные exact provenance paths   |

Отвергнуты: четыре дублированных handler/projector/decoder; неполная таблица
без receipt-key/attempt fields; mutable single `setRecord`; удаление либо
resurrection rejected provenance; cumulative dialog list; пользовательский
текст consequences; новый branch/method/mode/checkpoint; request до confirm;
durable cancel mutation; трактовка close/disconnect как decision; attempt 6;
unlock после отказа; публикация неполной `CHR-009`.

## Совместимость и частичная замена ADR 0042

Persistence schema не меняется: checkpoint сохраняет opaque exact JSON и whole
snapshot replacement. Wire v1 command/result/replay и wire v2 composed
presentation остаются прежними. Новые JSON fields находятся внутри versioned
application payload.

ADR 0042 сохраняет модель одного set/confirmation roll, queue order,
no-reroll boundary, indexed critical outcomes, source values, locks и revision
deltas. Заменяются только следующие terminal ограничения:

- empty-queue set receipt и final confirmation receipt подписывают exact
  `returnDecisionFormId` как `nextFormId` и top-level envelope; промежуточные
  roll receipts сохраняют destinations ADR 0042;
- `statRollStage` больше не single-attempt object: roll fields живут в ordered
  attempt elements;
- запрет нового set request получает единственное исключение — atomic request,
  созданный после committed abandonment для transition kind next-attempt;
- validator и command lookup охватывают все attempts/decision records;
- `CHR-009` остаётся непубликуемой, но теперь имеет signed terminal envelope.

Safe return, non-empty branch cache/hash и восстановление иной branch не
определены; отказ внутри locked method не является branch switching.

## Последствия

Все methods достигают terminal decision; attempts сохраняются без потери.
Warning reversible до `CONFIRM`, а `CANCEL` имеет process-local replay. Rejected
sets остаются только provenance; player не получает RNG/Rule ID или authority
destination. Следующий срез начинает `STAT_ASSIGNMENT` с `CHR-009` validation и
checkpoint в `CHR-011|CHR-012`.
