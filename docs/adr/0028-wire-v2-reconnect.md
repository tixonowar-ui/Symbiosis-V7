# ADR 0028 — Инициация reconnect в wire v2

- **Статус:** Принято
- **Дата:** 2026-08-16

## Контекст

ADR 0020 задаёт reconnect wire v1: `projection.reconnect` несёт revisions, role,
workflow capability и неподтверждённые command IDs, а host отвечает полным
`projection.snapshot`.

ADR 0026 вводит wire v2 для form-action и addressable-route intent. Успех, host
event, command destination и reconnect публикуют full snapshot с presentation,
payload и revisions. Но v2-контракт не определяет запрос первого или
восстановленного snapshot.

Возможны v1-request с v2-response, unsolicited snapshot или симметричный
v2-request. Одновременно `ProjectionSnapshotV2Message.projectionRole` требует
`InteractiveRole`, хотя bootstrap context ADR 0026 role-neutral.

### Факт до adoption

Владелец репозитория проверил `main` на commit `4aeaae3`: v2 protocol и codec
не импортируются host или web runtime, а развёрнутых v2 peers нет. Поэтому
разрешена одна pre-adoption правка v2 под отсутствующий reconnect-контракт.

Это разрешение не отменяет versioning ADR 0020. Ниже определяется проверяемая
граница adoption, после которой v2 замораживается, и исчерпывающий объём
разового исключения.

## Решение

### 1. Reconnect инициирует симметричный v2-request

Client отправляет третье сообщение wire v2 с discriminator
`session.reconnect`. Будущий TypeScript-контракт называется
`SessionReconnectV2Message` и входит в `ClientToHostV2Message`.

Имя намеренно не совпадает с v1 `projection.reconnect`. Request синхронизирует
v2 projection/presentation и capability/recovery команд, чьи lifecycle messages
остаются на wire v1.

Первое подключение использует тот же request с нулевыми revisions и пустым
unacknowledged list; implicit WebSocket handshake либо v1 negotiation нет.

После exact-valid request host:

1. возвращает по одному сохранённому v1 `command.pending`, terminal
   `command.refusal` либо `command.replay` для каждого unacknowledged ID;
2. строит capability-intersection и full safe snapshot из одного заново
   проверенного состояния;
3. отправляет ровно один v2 `session.reconnect.capabilities` непосредственно
   перед ровно одним полным `ProjectionSnapshotV2Message`.

Replay, чей signed receipt задаёт destination, предшествует паре из пункта 3.
Взаимный порядок остальных recovery frames не задаётся. Равные revisions не
разрешают patch, acknowledgement без snapshot либо отсутствие snapshot.

### 2. Поля `session.reconnect`

Request содержит exact обязательные поля:

| Поле                          | Источник и семантика                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| `messageType`                 | literal `session.reconnect`                                      |
| `protocolVersion`             | literal `2`                                                      |
| `reconnectRequestId`          | correlation одной попытки reconnect                              |
| `deviceId`                    | canonical lowercase UUID v4 identity ADR 0027; locator, не proof |
| `knownRevisions`              | последний server-confirmed `RevisionVector` либо нулевая тройка  |
| `supportedWorkflowCommandIds` | capability tokens workflow-команд v1 по ADR 0020                 |
| `unacknowledgedCommandIds`    | v1 command IDs без полученного terminal result/replay            |

`deviceId` проверяется exact и не выдаёт role, authority, seat или recovery.
Valid unknown ID получает лишь safe role-neutral bootstrap/diagnostic; context,
seat и receipts требуют unique server-confirmed binding без first-match.
Missing/malformed identity не заменяется временным UUID.

Request не содержит `projectionRole`, form/URL/history, `contextId`,
`controllerSeat` или destination. Host выводит context/presentation из bindings,
pending context, receipt либо checkpoint ADR 0026/0027; IDs не являются proof.

Host staging message `SessionReconnectCapabilitiesV2Message` содержит exact
`messageType='session.reconnect.capabilities'`, `protocolVersion=2`,
`reconnectRequestId`, `revisions` и vocabulary-checked
`executableWorkflowCommandIds`.

### 3. Судьба пяти полей v1-reconnect

Каждое поле `ProjectionReconnectMessage` получает явное решение:

| Поле v1                       | Решение в v2                                              |
| ----------------------------- | --------------------------------------------------------- |
| `knownRevisions`              | сохраняется без изменения смысла                          |
| `projectionRole`              | удаляется из request; actual role возвращает host         |
| `requestId`                   | сохраняется как точный `reconnectRequestId`               |
| `supportedWorkflowCommandIds` | сохраняется для capability-пересечения командной линии v1 |
| `unacknowledgedCommandIds`    | сохраняется для terminal replay командной линии v1        |

`knownRevisions` описывает последний confirmed cache, не precondition/authority;
успешный reconnect всегда возвращает фактические revisions в full snapshot.

`executableWorkflowCommandIds` — точное пересечение request capability и host
vocabulary, а не permission или результат guard. Host фильтрует каждый
последующий v2 snapshot и workflow CTA ещё и по authority/state. CTA без exact
workflow ID либо без ID в активном пересечении не исполним; выводить ID из
`availableActionKeys`, label или guard запрещено.

Client только stages capability frame. Он одним локальным commit устанавливает
пересечение и matching snapshot, если frame ровно один, стоит непосредственно
перед snapshot, `reconnectRequestId` совпадает с
`assignment.correlationId`, `reason=RECONNECT`, а revisions равны. Пустое
пересечение не отменяет обязательный frame.

Missing, duplicate, mismatch, unknown `executableWorkflowCommandId`, новый
attempt либо disconnect между парой отбрасывает staging: прежние cache и
capability set остаются неизменными read-only. Frame сам не подтверждает
reconnect, не меняет UI/authority и не разрешает command; единственный
observable terminal commit — full snapshot.
Snapshot с другой assignment reason использует пересечение последнего успешного
reconnect без precursor, поэтому его принятая семантика ADR 0026 не меняется.

`reconnectRequestId` — только correlation и становится assignment
`correlationId` с `reason=RECONNECT`. Retry может сохранить ID, но host заново
revalidate-ит state: ID не адресует journal/cached replay. Новый reconnect
получает новый ID.

Два command-поля не превращают lifecycle messages в v2. Unknown либо
несовместимый unacknowledged ID даёт v1 refusal, не новую команду; существующий
master-predicate/handoff recovery остаётся контрактом ADR 0020. Параллельный v1
`projection.reconnect` не отправляется.

### 4. Bootstrap role выражается `null` в общем snapshot

`ProjectionSnapshotV2Message.projectionRole` меняется до adoption с
`InteractiveRole` на `InteractiveRole | null`; key остаётся обязательным, а
остальные значения codec отклоняет. `null` iff host подтвердил role-neutral
bootstrap context (сейчас `APP-001`) и применил отдельный least-privilege
filter. Это не unknown, unfiltered payload, `system`, error или fallback.

Player-local context без campaign admission имеет `projectionRole='player'`:
поле описывает filter, но не доказывает admission/authority. Admitted player и
gm context используют подтверждённую role; host/system event не вводит
`system`. Client поле не присваивает.

Nullability не распространяется на `contextId`, `deviceId`, `controllerSeat`
или payload: ими управляют exact form contract и ADR 0027. Несовместимость role
и context блокирует публикацию; `null` не является permissive fallback.

Отдельный bootstrap snapshot type не вводится: это значение той же оси
assignment. Один message сохраняет общие presentation, revisions, correlation
и atomic replacement semantics.

### 5. Запрет понижения относится к операции

Один client может отправлять на одном transport сообщения v1 и v2, потому что
command routes ADR 0020 не мигрируют этой задачей. `protocolVersion` остаётся
свойством exact message envelope, а не выбранным раз и навсегда режимом socket.

Запрет ADR 0026 означает:

- `session.reconnect`, form-action и addressable-route intent нельзя выражать
  через v1 `projection.reconnect`, `read.request` или `command.request`;
- при unsupported v2, version mismatch или unknown v2 discriminator client
  отказывает fail-closed и не повторяет ту же операцию сообщением v1;
- настоящий workflow/operation/read request продолжает использовать свой
  принятый v1 message, пока отдельный ADR не мигрирует именно эту операцию.

Последний пункт не является downgrade: client не начал v2-операцию и не
подменил её v1 discriminator. Наличие command capability/replay полей внутри
`session.reconnect` также не меняет version самих command frames.

### 6. Граница pre-adoption исключения

**Adoption wire v2** — монотонное репозиторное событие. Оно наступает, когда
первый commit становится достижим из `main` и production path host, web/client
либо local shell:

1. прямо или транзитивно ссылается на v2 export, включая value import,
   production type-only import, barrel, adapter либо dynamic import; или
2. без такого импорта создаёт, кодирует, декодирует, маршрутизирует, отправляет
   либо принимает frame grammar/semantics wire v2.

Production path определяется достижимостью из production entry point либо
включением в поставляемый artifact, а не именем каталога. Поэтому скопированный
structural type, generic dispatcher или непрямой adapter не обходят границу.

Не считаются adoption:

- определения, codec и чистый re-export внутри shared;
- unit/integration/e2e tests, fixtures и docs;
- static-check/build tooling, которое само не является peer и не делает
  production artifact способным говорить wire v2.

Tool, который сам выступает v2 peer либо генерирует/пакует v2 production path,
считается на общих основаниях. Shared barrel сам по себе не adoption, но
production consumer любого v2 export через него — adoption. Production
type-only reference закрывает окно.

Граница намеренно репозиторная, а не deployment-based: adoption фиксируется при
попадании commit в `main`, до первого запуска или deployment. Она необратима;
удаление imports, rollback, feature flag и последующее отсутствие peer не
возвращают pre-adoption.

После adoption существующие shapes, discriminators, value domains и semantics
v2 заморожены, а разовое исключение этого ADR недоступно. Дальнейшие изменения
оцениваются только по explicit versioning rules ADR 0020 и обычному ADR-process.
Этот ADR не добавляет автоматический version-bump для нового message type вне
перечня ADR 0020; такая extension требует собственного рассмотренного решения,
но не может ссылаться на отсутствие peers или это исключение.

Разовое исключение разрешает только:

1. добавить exact `session.reconnect`, `session.reconnect.capabilities` и их
   union/codec cases;
2. ввести описанный paired staging/commit и его negative/round-trip tests;
3. расширить `ProjectionSnapshotV2Message.projectionRole` ровно до
   `InteractiveRole | null` с описанной семантикой и tests.

Оно не разрешает менять два navigation intent, refusals, presentation shape
кроме указанного role field, revision semantics или существующие
discriminators. Contract/codec implementation исключения должна попасть в
`main` раньше первого adoption commit; commit, который одновременно меняет v2
и вводит production use, исключением не покрыт. Оно исчерпывается при merge этой
implementation либо при более раннем adoption. Отсутствие peers на `4aeaae3` —
необходимое фактическое основание только этого owner decision, а не достаточный
прецедент. Любая следующая pre-adoption правка требует отдельного решения
владельца.

## Обоснование

Симметричный request сохраняет correlation, revisions, capability и replay без
скрытой transport-семантики. Staged capability frame сохраняет общий atomic
snapshot shape, не превращаясь во второй observable result. Host-owned nullable
role устраняет bootstrap placeholder без второго snapshot contract.

Pre-adoption исключение безопасно только до первого runtime use: проверенный
commit не имеет v2 peers, поэтому менять совместимость не с кем. Репозиторная
граница и исчерпывающий список превращают этот факт в одно решение, а не в
повторяемую лазейку.

## Отвергнутые альтернативы

| Вариант                                 | Причина отказа                                                       |
| --------------------------------------- | -------------------------------------------------------------------- |
| V1 reconnect request, v2 snapshot       | Нет negotiation; v2-операция зависит от v1 semantic request          |
| Unsolicited v2 snapshot                 | Нет correlation, known revisions, capability и command replay input  |
| Назвать request `projection.reconnect`  | Переиспользует v1 discriminator для другой exact grammar             |
| Передавать role в v2 request            | Client выбирает authority-bearing context вместо host revalidation   |
| Отдельный bootstrap snapshot            | Дублирует один atomic cache-replacement contract                     |
| Подставить `player` для bootstrap       | Role-neutral `APP-001` получает ложную interactive role              |
| Capability list в existing snapshot     | Вторая breaking-правка его shape сверх названной bootstrap-дыры      |
| Выводить workflow ID из action/label    | В Atlas нет exact однозначного join; inference запрещён              |
| Считать socket только v1 либо только v2 | Ломает немигрировавшие command routes без отдельного ADR             |
| Разрешать правки до deployment          | Неаудируемая граница и вечная совместимость «пока peers не замечены» |

## Последствия

- Следующая contract-задача меняет shared v2 protocol/codec/tests; paired client
  commit реализуется при host/web adoption, навсегда закрывающей окно.
- Wire v1 messages, codec и semantics не меняются.
- Reconnect всегда заканчивается full safe v2 snapshot; patch/no-op response не
  появляется.
- Bootstrap snapshot явно несёт `projectionRole=null`; role-bearing snapshot —
  только подтверждённую host role.
- Command requests/results остаются v1, но их capability и replay continuity
  обслуживает единственный `session.reconnect` v2.
- `deviceId`, revisions и command IDs являются input revalidation, а не proof
  authority или client-selected destination.
- ADR дополняет 0020, 0026 и применяет identity-контракт 0027, не заменяя их и
  не меняя принятое решение о host-owned atomic presentation.
