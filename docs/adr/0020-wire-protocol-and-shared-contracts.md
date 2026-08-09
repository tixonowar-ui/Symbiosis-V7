# ADR 0020 — Wire-протокол и контракты `src/shared`

- **Статус:** принято
- **Дата:** 2026-08-09

## Контекст

Symbiosis V7 — offline-first LAN-приложение с единственным авторитетным
хостом. Web-клиент не подтверждает игровое состояние сам: он передаёт
намерение, а хост повторно проверяет authority, controller seat, guards и
ревизии. Поэтому граница `host` ↔ `web` должна типизированно отличать намерение
от подтверждённого результата, отказа, ожидания человеческого ответа и
идемпотентного повтора.

Нормативные источники этого решения:

- Web UI Screen Atlas v1.2: 106 `UI-CMD-*`, шесть command-kind в
  `transitions.json`, command lifecycle в `lifecycles.json`, все
  `offlineReconnectAssertions`, `REQ-029`, формы `GM-029`, `PLY-026`,
  `PLY-029`–`PLY-031` и `SYS-028`;
- Q&A v1.2: связанные с `REQ-029` решения, в том числе `Q-SYM-097`,
  `Q-APP-001`, `Q-MON-088`, `Q-SYM-085`;
- [ADR 0008](0008-hidden-actor-visibility.md),
  [ADR 0009](0009-roll-request-queue-per-command.md),
  [ADR 0010](0010-local-seat-limit.md) и
  [ADR 0018](0018-current-state-storage-and-checkpoints.md).

Atlas задаёт lifecycle команды как
`DECLARED → PENDING_CONSENT → REVALIDATING → COMMITTED → REJECTED_STALE →
IDEMPOTENT_REPLAY`. Все 91 требования повторяют три reconnect-инварианта:

1. незакоммиченный локальный ввод может восстановиться только как draft;
2. закоммиченная команда восстанавливается по `commandId` с тем же receipt и
   random result, без повторного эффекта;
3. свежая серверная проекция заново вычисляет CTA/targets и не содержит
   запрещённые данные в payload, DOM, a11y, hotkeys или cache.

`REQ-029` и `GM-029` добавляют мастерский предикат. Мастер сообщает факт мира,
которого нет у приложения, но не подменяет правило и не выбирает результат.
Пока факта нет, операция заблокирована и ничего не резервирует. Решений ровно
два — `YES` и `NO`; состояний четыре — `PENDING_PREDICATE`, `YES_RECORDED`,
`NO_RECORDED`, `UNKNOWN_OR_CLOSED`.

## Решение

### 1. Кодирование и граница слоя

Wire v1 — один JSON-object в одном текстовом application frame. Каждый object
имеет `protocolVersion: 1` и закрытый discriminator `messageType`. Корневой
массив, частично разобранный object и неизвестные поля не являются сообщением
v1.

`src/shared` содержит:

- закрытые unions `ClientToHostMessage` и `HostToClientMessage`;
- типы request, result, receipt, pending, replay и refusal;
- `decodeClientMessage` / `decodeHostMessage`, принимающие текст как `unknown`
  после `JSON.parse`;
- симметричные checked encoders;
- runtime vocabulary, построенный потребителем из generated Atlas.

Слой импортирует только `generated/types/atlas.ts` и только как type-only
dependency. Импорты из `domain`, `persistence`, `host` и `web` запрещены и
проверяются рекурсивным AST-тестом. `AtlasRole`, `GuardState`, `FormId`,
`TransitionKind` и словарь workflow-команд не переобъявляются. Тип
`WorkflowCommandId` выводится из generated `QaScenarioId` с префиксом
`QA-WORKFLOW-`; contract test сверяет результат со всеми 106 командами Atlas.

Decoder проверяет exact key set, literals, runtime vocabulary, JSON-safe
payload и неотрицательные safe-integer ревизии. Он возвращает
`{ ok: false, refusal }`, а не domain exception и не частичный object. Encoder
прогоняет ту же проверку до `JSON.stringify`.

Exact key set относится к object-модели после нативного `JSON.parse`. Wire v1
фиксирует его last-member semantics для повторённого имени: semantic value
последнего member проходит полную проверку, а checked encoder повторённые имена
не создаёт. Отдельный текстовый JSON-parser только для запрета дублей в v1 не
вводится.

### 2. Шесть видов команд и их маршруты

Таксономия не вводится протоколом: используются ровно значения поля `kind` из
Atlas.

| `kind`                  | Маршрут             | Представление                                                 |
| ----------------------- | ------------------- | ------------------------------------------------------------- |
| `workflow-command`      | host mutation       | `command.request` с `workflowCommandId`                       |
| `operation-command`     | host mutation       | `command.request` с точным transition tuple                   |
| `read-only-command`     | host read           | `read.request`; без commit receipt                            |
| `local-or-read-command` | local или host read | local, если хватает проекции; иначе `read.request`            |
| `local-command`         | только клиент       | в wire не попадает                                            |
| `local-draft-command`   | только client draft | в wire не попадает; host видит лишь последующее подтверждение |

У одиннадцати `operation-command` нет отдельного структурированного ID в
Atlas. Извлекать `OP-*` из свободного текста guard или придумывать
`operationId` запрещено. Поэтому идентичность операции — точный tuple
`{ from, to, kind, trigger }`, проверенный по `transitions.json` через runtime
vocabulary. Пара известных `FormId` и произвольный trigger не принимаются.

Workflow- и operation-request несут собственный opaque `commandId`,
`expectedRevisions`, interactive role claim и JSON payload. Роль claim не даёт
authority: хост сверяет её с admitted session. `system` по архитектуре означает
серверные handler'ы и неинтерактивные триггеры, поэтому client-to-host допускает
только `InteractiveRole = Exclude<AtlasRole, 'system'>`.

### 3. Ответы, отказы и lifecycle

Host обрабатывает mutation в следующем порядке:

1. exact decode и проверка runtime vocabulary;
2. поиск `commandId` в журнале команд;
3. для известного ID — сравнение с сохранённым нормализованным request;
4. тот же request возвращает прежний pending, terminal refusal или receipt;
   другой payload, command reference либо expected revisions дают
   `IDEMPOTENCY_CONFLICT`;
5. только новый ID проходит authority, revision и guard revalidation, затем
   atomic commit.

Idempotency lookup идёт до stale-проверки: иначе retry уже committed-команды
ошибочно стал бы `STALE_REVISION` вместо replay.

Формы host-ответа различны:

- `command.result` существует только после atomic commit; его immutable receipt
  содержит `commandId`, `receiptId`, result и фактические ревизии;
- `command.replay` несёт тот же receipt без нового эффекта и имеет lifecycle
  `IDEMPOTENT_REPLAY`;
- `command.pending` для мастерского предиката несёт `PENDING_CONSENT` /
  `PENDING_PREDICATE` и `noReservation: true`;
- `command.refusal` означает, что исходная mutation не committed;
- `read.result` и `read.refusal` относятся к `requestId`, не создают receipt и
  не считаются результатом команды;
- `protocol.refusal` означает, что application message не было понято и оно не
  исполнялось.

`UNRECOGNIZED` обязательно сообщает `path` и фактическое `value`.
`INVALID_SHAPE` сообщает `path`, ожидаемую форму и runtime type.
`MALFORMED_JSON` сообщает безопасную parse diagnostic. Command-refusal отдельно
различает `STALE_REVISION`, `GUARD_REJECTED`, `IDEMPOTENCY_CONFLICT` и
`MASTER_PREDICATE_DENIED`.

Player-facing `GUARD_REJECTED` не несёт свободный diagnostic, failed predicate,
actor ID или внутренний guard. Такие сведения остаются в GM/QA trace по ADR 0008. Для неизвестного wire-значения, напротив, значение обязательно: без него
невозможно исправить несовместимость.

### 4. Три ревизии и reconnect

`RevisionVector` всегда содержит:

- `stateRevision`;
- `projectionRevision`;
- `actorVisibilityRevision`.

Их смысл и матрица инкрементов принадлежат ADR 0018; wire их не меняет.
Mutation-request использует `expectedRevisions`, read/reconnect —
`knownRevisions`, host-result/refusal/snapshot — фактические `revisions`.
`masterAuthorityRevision` — отдельная величина формы `GM-029`, она не является
четвёртым элементом `RevisionVector`.

При подключении и reconnect клиент отправляет:

- известный `RevisionVector` и interactive projection role;
- `supportedWorkflowCommandIds`;
- `unacknowledgedCommandIds`.

Host строит полную свежую role projection и возвращает
`projection.snapshot`. Snapshot атомарно заменяет client cache; patch поверх
старой проекции в v1 нет. Поле `executableWorkflowCommandIds` содержит только
команды из capability-пересечения и проходит vocabulary-check клиента. Любой
workflow CTA в opaque projection payload исполним только если его ID есть в этом
поле.
Запрещённые и устаревшие CTA/targets, как и скрытый actor, отсутствуют в
payload, а не маскируются renderer'ом.

Для каждого неподтверждённого `commandId` host возвращает сохранённый
`command.pending`, terminal refusal либо `command.replay` с прежним receipt.
Unknown ID даёт явный отказ и не создаёт новую команду. Disconnect до commit —
zero write; disconnect после commit до acknowledgement — тот же receipt и тот
же random result.

### 5. Мастерский предикат

`PENDING_PREDICATE` — специализация общей lifecycle-фазы `PENDING_CONSENT`.
Host создаёт один linked request и отправляет мастеру
`master-predicate.request` со следующими данными:

- `predicateRequestId`, `linkedActionRequestId`, `predicateType`;
- `requestingCharacterId`, `predicateQuestion`;
- `masterAuthorityRevision`, current `RevisionVector`;
- `returnContext`, `noReservation: true`;
- literal audience `gm`, guard `consent/masterPredicate`, command state
  `PENDING_CONSENT`, predicate state `PENDING_PREDICATE`.

`GM-029.requiredFields` — агрегат формы, а не одна wire-схема. Поэтому
`decision` отсутствует в host → GM request и присутствует в отдельном GM → host
response. Response — специализированная ветка `command.request` с
`workflowCommandId = UI-CMD-MASTER-PREDICATE-RESPOND`, собственной instance
`commandId`, ролью только `gm` и exact payload:

- `predicateRequestId`, `linkedActionRequestId`;
- `decision: YES | NO`;
- `masterAuthorityRevision`;
- server-issued `returnContext`;
- `noReservation: true`.

`predicateRequestId`, `linkedActionRequestId`, response `commandId` и
originating command ID — разные идентичности и не взаимозаменяются.
`returnContext` непрозрачен для клиента и сам по себе не даёт authority; host
сверяет его с выданным контекстом.

Результаты:

- `YES` записывается как `YES_RECORDED` и только разрешает полный переход в
  `REVALIDATING`; мастер не выбирает effect или result;
- `NO` записывается как `NO_RECORDED`; response-команда получает собственный
  receipt, а originating action завершается `MASTER_PREDICATE_DENIED` без
  расхода action, OE, item, dose или другого ресурса;
- тот же response `commandId` и payload возвращает тот же receipt;
- противоположный ответ с тем же `commandId` даёт idempotency conflict.

`UNKNOWN_OR_CLOSED`, close, timeout и disconnect не являются третьим решением,
не создают response/receipt и не разрешают originating action. Висящий request
остаётся blocked и unreserved; reconnect восстанавливает тот же request и
owner. Только новая попытка после явного закрытия прежней получает новый
`predicateRequestId`.

Privacy handoff следует `PLY-030`: до GM projection предыдущая seat projection
удаляется, GM получает только свой контекст без секретов чужого seat, а linked
response и return receipt фиксируются до возврата initiator projection.
Незавершённый handoff восстанавливается без чужой проекции и без смены owner.
Это правило проекций; отдельную форму всех 376 projection payload этот ADR не
вводит. Обязательные поля `PLY-030` формирует host projector внутри opaque
projection payload, а не client mutation. Wire отдельно защищает только
server-issued `returnContext`: GM возвращает его без изменений, host сравнивает
его с сохранённым контекстом и не принимает client-supplied authority из этого
object.

### 6. Неизвестное сообщение и совместимость

Получив frame, который он не понимает, peer:

1. не применяет ни одного поля, receipt или revision из frame;
2. блокирует зависящую от него mutation;
3. возвращает `protocol.refusal`, если correlation можно сделать безопасно;
4. сохраняет только последнюю server-confirmed projection как read-only до
   успешного reconnect.

Молчаливый ignore и permissive fallback запрещены.

`protocolVersion` версионирует grammar и семантику envelope, но не весь каталог
Atlas. Добавление `UI-CMD-*`, использующей существующий generic
workflow-envelope, не меняет версию:

`supportedWorkflowCommandIds` содержит синтаксически валидные capability-токены,
а не запросы на исполнение. Неизвестный peer токен инертен и отбрасывается при
пересечении; direct command и executable ID в snapshot по-прежнему требуют
точного локального vocabulary.

- новый клиент добавляет ID в `supportedWorkflowCommandIds`;
- host вычисляет пересечение и не сериализует executable command старому
  клиенту;
- старый host отвечает `UNRECOGNIZED` на прямую новую команду;
- старый клиент fail-closed отклоняет snapshot, если host нарушил пересечение и
  прислал неизвестный executable ID.

Удаление/переименование ID, изменение обязательных полей существующего message,
новый исход master predicate либо изменение семантики discriminator требует
нового `protocolVersion`. Неизвестные поля нельзя использовать как механизм
forward compatibility.

Capability-пересечение v1 распространяется только на `workflow-command`.
Добавление или изменение host-bound tuple `from/to/kind/trigger` для
`operation-command`, `read-only-command` или `local-or-read-command` требует
нового `protocolVersion`: старый peer должен отказаться до применения opaque
projection, а не угадывать смысл нового CTA.

### 7. Граница с бросками

Receipt/result остаётся JSON-object и не мешает будущему результату `AUTO` или
`MANUAL`, но `rollRequest`, очередь и модель броска здесь не определяются. Они
принадлежат issue #26 / ADR 0021. ADR 0009 остаётся в силе: будущий запрос
броска связывается с originating command и не становится глобальной очередью.

## Обоснование

Closed discriminated unions дают exhaustiveness в TypeScript, а runtime codec
закрывает границу, где типы уже стёрты. Раздельные result/refusal/pending/replay
не позволяют принять отказ за подтверждённое состояние. Full replacement
projection выполняет reconnect-требования и ADR 0008 ценой небольшого лишнего
LAN-трафика.

Точный transition tuple для operation/read сохраняет таксономию Atlas без
нового каталога. Capability-пересечение позволяет добавить workflow-команду без
permissive parser и без обязательного version bump всего протокола.

### Проверенное поведение инструментов

Проверено 2026-08-09 в отдельном временном каталоге без файлов проекта:

- Node.js `24.19.0`, npm `11.17.0`, TypeScript `6.0.3`, Vitest `4.1.10`;
- `JSON.parse` принимает синтаксически корректный object с неизвестным
  discriminator, неверными runtime types и `null` revisions — он не заменяет
  schema validation;
- `JSON.parse('{"decision":"YES","decision":"NO"}').decision` возвращает
  `NO`, то есть нативный parser оставляет последний member с повторённым именем;
- `JSON.stringify({ detail: undefined })` удаляет поле, а `NaN` превращает в
  `null`;
- число `9007199254740993` разбирается как `9007199254740992`, после чего
  `Number.isSafeInteger` возвращает `false`;
- negative fixture с `@ts-expect-error` проходит при обязательном поле, но при
  ослаблении поля до optional даёт `TS2578`; fresh object с лишним полем под
  `satisfies` даёт `TS2353`;
- Vitest сообщает `--typecheck ... (default: false)`.

Следствия проверки: wire читается из `unknown`, revisions проверяются через
`Number.isSafeInteger`, encoder валидирует до stringify. Compile-time fixtures
защищает `npm run typecheck`; обычный `npm test` сам их не заменяет. Runtime
формы и fail-closed отказы проверяет Vitest.

### Отвергнутые альтернативы

| Вариант                                                | Причина отказа                                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Только TypeScript types и `JSON.parse(...) as Message` | Типы стёрты на network boundary; `JSON.parse` проверяет лишь синтаксис                                                |
| Один response с nullable `result`, `error` и `pending` | Допускает противоречивые состояния и смешивает commit с отказом                                                       |
| Отказ как exception или закрытие socket                | Теряется correlation и сохранённый idempotency status                                                                 |
| Молчаливо игнорировать неизвестное                     | Старый peer продолжит работу по неполному контракту                                                                   |
| Разрешать неизвестные поля для forward compatibility   | Старый decoder не знает их семантику; breaking shape требует версии                                                   |
| Второй JSON-parser только для повторённых имён         | Создаёт ещё одну реализацию grammar; v1 фиксирует поведение нативного parser, а encoder выдаёт однозначный object     |
| Передавать все шесть kind как mutation                 | Local draft, asset test и picker не являются shared mutation                                                          |
| Извлечь `operationId` из текста guard                  | В Atlas нет такого структурированного поля; это новый придуманный каталог                                             |
| Описать 106 отдельных top-level messages               | Дублирует общий envelope и превращает каждую команду в protocol change                                                |
| Client-authoritative optimistic commit                 | Нарушает single-host authority и reconnect idempotency                                                                |
| Резервировать ресурс до ответа мастера                 | Прямо противоречит `REQ-029`, `GM-029` и `PLY-026`                                                                    |
| GM override результата                                 | Мастер перестаёт быть источником факта и подменяет правила                                                            |
| Считать close/timeout/disconnect ответом               | Atlas определяет их как no decision                                                                                   |
| Ввести третье решение `UNKNOWN`                        | Четыре состояния не означают три решения; допустимы только `YES/NO`                                                   |
| Delta reconnect поверх старого cache                   | Запрещённое или скрытое поле может пережить reconnect                                                                 |
| Сразу добавить Ajv, Zod или Protobuf                   | Новая dependency/generator создаёт второй источник схемы; текущий closed vocabulary мал и проверяется без зависимости |

## Последствия

- Host и web получают один публичный контракт и обязаны использовать checked
  codec на wire-границе.
- Host хранит нормализованный request, lifecycle status и receipt по
  `commandId`; клиент хранит неподтверждённые ID до terminal acknowledgement.
- Host строит projection по authority и capability одновременно; capability не
  является разрешением выполнить команду.
- Strict exact decoding делает изменение message shape намеренно заметным и
  требует дисциплины `protocolVersion`.
- Полный reconnect snapshot больше delta, зато атомарно очищает stale и
  forbidden cache.
- Master predicate может оставаться pending без implicit timeout decision; это
  нормативная блокировка, а не подтверждённый отказ.
- `src/shared` не реализует host, renderer, persistence, form schemas или roll
  model.
- Contract tests ломаются при drift generated roles, guards, lifecycle,
  command kinds, 106 workflow IDs и `GM-029.requiredFields`, а также при
  зависимости `src/shared` от другого слоя.
