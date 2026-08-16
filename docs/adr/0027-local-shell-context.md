# ADR 0027 — Контекст локальной оболочки

- **Статус:** принято
- **Дата:** 2026-08-16

## Контекст

### Что следует из источников

`APP-002` имеет context `local-app` в
[`$.forms[1].contexts[0]`][atlas], владельца ввода `active controllerSeat/GM
context according to roles` в [`$.forms[1].inputOwner`][atlas] и шесть
обязательных полей в [`$.forms[1].requiredFields[0..5]`][atlas]: `contextId`,
две revision, `deviceId`, `controllerSeat`, `connectionState`.

Форма достижима без campaign admission и technical session:
[`$.forms[1].transitionsIn[0]`][atlas] ведёт из pre-seat `APP-001`,
[`$.forms[1].transitionsIn[5]`][atlas] — из `NET-002` без созданной session,
[`$.forms[1].transitionsIn[8]`][atlas] допускает `activeRole=NONE` и ноль
admitted seats, а [`$.forms[1].transitionsIn[11]`][atlas] возвращает до
admission request и session.

`APP-003` требует `deviceId` в [`$.forms[2].requiredFields[0]`][atlas] и имеет
состояние `ZERO_SEATS` в [`$.forms[2].states.ZERO_SEATS`][atlas]. `NET-002`
отделяет transport от authority: состояние `CONNECTED_TECHNICAL` в
[`$.forms[17].states.CONNECTED_TECHNICAL`][atlas] означает technical session
без player admission. Команда `UI-CMD-CONNECTION-OPEN` требует уже известную
local device identity в
[`$.registryCoverage.workflowCommands[70].guards`][atlas].

`NET-009` повторно проверяет device/session identity и seat binding в
[`$.forms[24].requiredFields[0..11]`][atlas]. `J-RECONNECT` восстанавливает
seat и snapshot в [`$.journeys[24].steps[1..3]`][atlas]. `Q-CAMP-006` в
[`$[293].Ответ`][qna] запрещает удалять персонажа либо выбирать действие из-за
disconnect, а `Q-GM-022` в [`$[328].Ответ`][qna] сохраняет постоянное
назначение устройства.

Lifecycle `deviceAndLocalSeat` перечисляет `UNBOUND`, `PROVISIONAL`, `ADMITTED`,
`ACTIVE`, `HANDOFF`, `DISCONNECTED`, `RESTORED` в
[`$.entityLifecycles[3].states[0..6]`][atlas]. Он связан с `J-LOCAL-SEATS` и
`J-RECONNECT` в [`$.entityLifecycles[3].journeyIds[0..1]`][atlas], но не задаёт
переходы между состояниями и не связывает `APP-002` с конкретным состоянием.
`J-LOCAL-SEATS` допускает 0–3 local player tabs в
[`$.journeys[7].steps[0].guards`][atlas]. ADR 0010 отдаёт проверку этого предела
именно lifecycle `deviceAndLocalSeat`.

`Q-CAMP-001` в [`$[289].Ответ`][qna] отделяет campaign capacity от
обязательного состава. `Q-CAMP-002` в [`$[290].Ответ`][qna] передаёт device
identifier в admission request, но до решения GM не даёт устройству campaign
authority и не занимает место.

Четыре дополнительно проверенных среза не дают field-level контракта:

- [`$.forms[1].dataSources`][atlas], [`$.forms[2].dataSources`][atlas],
  [`$.forms[17].dataSources`][atlas] и [`$.forms[24].dataSources`][atlas]
  описывают provenance формы;
- scan [`$.forms[0..375].projection`][atlas] даёт общий filtering contract, а
  не JSON shape четырёх полей;
- `contexts` перечисляет namespace, но не определяет `contextId`;
- базовые `states` описывают UI state machine, но не словарь
  `connectionState`.

QA [`$[41]`][qa], [`$[43]`][qa], [`$[68]`][qa] и [`$[81]`][qa] повторяет
required fields соответствующих `APP-002`, `APP-003`, `NET-002`, `NET-009`.

### Что источники не решают

Точный scan raw и generated `forms[0..375].requiredFields` даёт 116 форм с bare
`contextId`, 14 с bare `deviceId`, 10 с bare `controllerSeat` и 8 с bare
`connectionState`. Другие формы задают только отдельные литералы: `LOST` в
[`$.forms[23].requiredFields[4]`][atlas], `UNAVAILABLE` в
[`$.forms[26].requiredFields[8]`][atlas] и `DISCONNECTED|RECONNECTED` в
[`$.forms[261].requiredFields[3]`][atlas].

Case-insensitive поиск по raw JSON, raw Markdown и всему `generated/spec/**`
проверил camelCase, snake/kebab/spaced English, `identifier`/`status` и русские
варианты. Нет `contextIdOrNull`, `deviceIdOrNull`, format/lifetime-контрактов и
nullability bare `controllerSeat` именно для `APP-002`. У других форм есть
`selectedControllerSeatOrNull` в
[`$.forms[39].requiredFields[1]`][atlas] и `selfControllerSeatOrNull` в
[`$.forms[265].requiredFields[15]`][atlas] и
[`$.forms[272].requiredFields[12]`][atlas].

Ни input owner, ни bare required field сами по себе не выбирают `null` или
строку. `connectionState=` встречается лишь у названных литералов и guard
`LOST`; значение для `APP-002` не задано. Формат идентичностей, allocator,
время жизни и представление отсутствия поэтому являются проектным выбором.

## Решение

### 1. Четыре независимые величины

**Вывод из источников.** ADR 0026 разделяет bootstrap, player-local и admitted
context. `NET-002` отдельно показывает technical connection без admission.
Lifecycle объединяет device и local seat, но не приравнивает их ID. Источники
не объявляют четыре поля взаимозаменяемыми.

**Проектный выбор.** Принимаются четыре разные величины:

| Поле              | Значение                                                     | Владелец                                  |
| ----------------- | ------------------------------------------------------------ | ----------------------------------------- |
| `contextId`       | identity текущего executor-owned projection context          | host либо exact device-local executor     |
| `deviceId`        | стабильная identity установленной локальной оболочки         | device-local identity service             |
| `controllerSeat`  | identity local player tab как entity `deviceAndLocalSeat`    | domain/host owner lifecycle               |
| `connectionState` | фаза NET session для указанного subject, не local shell wire | host по подтверждённым NET/session events |

Первые три значения — разные semantic types: canonical lowercase UUID v4
(`8-4-4-4-12`, 36 ASCII symbols), попарно различные. Они не являются authority
и не подменяют session/campaign/actor/request ID; host проверяет binding отдельно.

### 2. `contextId`

**Вывод из источников.** Во всех 116 формах bare `contextId` входит в revision
header. ADR 0026 назначает presentation внутри bootstrap, player-local либо
admitted context и заменяет context при смене authority namespace.

**Проектный выбор.** `contextId` идентифицирует экземпляр executor-owned
projection context, а не форму. Executor создаёт ID до первой atomic publication
этого context; обычная навигация и смена base/layers его сохраняют.

Новый ID создаётся при замене bootstrap на player-local, при campaign admission,
owner/seat handoff и после host restart. Transport reconnect внутри живого host
context сохраняет ID. Client URL, history и cached payload его не назначают.

Context исчезает при подтверждённой замене другим context либо завершении
runtime. Старый ID не переиспользуется и не является recovery key. Durable
device/seat binding после restart создаёт новый context с новым ID.

### 3. `deviceId`

**Вывод из источников.** `APP-003.ZERO_SEATS` и `NET-002` требуют device identity
до seat admission. `Q-CAMP-002` использует её в admission request, но не даёт
authority до решения GM. `NET-009` повторно использует identity при reconnect.

**Проектный выбор.** Device-local identity service создаёт либо загружает
`deviceId` во время installation/local-shell bootstrap, до того как `APP-001`
предложит переход в player context. Все tabs одной установки используют один
ID.

ID переживает закрытие tabs, перезапуск приложения, transport disconnect и host
reconnect. Он не выводится из MAC/IP, Windows name, browser fingerprint или
campaign и не меняется при смене роли.

ID исчезает только при явном reset local identity либо удалении local profile.
Reset сначала инвалидирует известные bindings. Missing или malformed сохранённое
значение блокирует player-local projection с диагностикой; per-run UUID и тихая
ротация запрещены.

### 4. `controllerSeat`

**Вывод из источников.** `APP-002.inputOwner` называет active
`controllerSeat`, тогда как входящие transitions допускают отсутствие admitted
campaign seat. Lifecycle содержит семь состояний, но не объясняет их переходы
или значение слова `active` в свободном тексте input owner. ADR 0010 отдаёт
правило 0–3 player tabs entity `deviceAndLocalSeat`.

**Проектный выбор.** `controllerSeat` — ID реальной `deviceAndLocalSeat` entity
для одной local player tab. Отдельного pre-commit shell handle нет. Только
domain/host owner lifecycle создаёт seat, проверяет 0–3 и изменяет состояние.

Открытие player tab создаёт entity в `UNBOUND`. Admission request переводит её
в `PROVISIONAL`; отказ GM возвращает `UNBOUND`, принятие — `ADMITTED`. Только
admitted seat, выбранная для campaign control, становится `ACTIVE`; снятие
выбора возвращает `ADMITTED`.

Слово active в `APP-002.inputOwner` означает текущую local input lane, не
lifecycle literal: выбранная `UNBOUND` или `PROVISIONAL` seat владеет local
формой без смены state. `HANDOFF`, `DISCONNECTED` и `RESTORED` применяются при
одноимённых подтверждённых событиях, затем seat возвращается к последнему
подтверждённому non-transient state.

Seat считается в лимите 0–3 с создания `UNBOUND`, но не занимает campaign
capacity до `ADMITTED`. Navigation journal хранит только result/binding уже
существующей seat и не становится вторым owner либо allocator.

Навигация, disconnect и host restart не удаляют identity. При закрытии
never-admitted tab pending request сначала отменяется, state возвращается в
`UNBOUND`, затем owner удаляет entity; deletion — граница entity, не новый
lifecycle state, и ID не используется повторно. Admitted seat при disconnect
остаётся `DISCONNECTED`; удалить её может только explicit audited unbind/removal.
Recovery revalidates тот же ID и не заменяет ошибку новой identity.

### 5. `connectionState`

**Вывод из источников.** `NET-002.CONNECTED_TECHNICAL` существует до admission,
а `APP-002` достижима до создания technical session. Atlas отдельно фиксирует
`LOST`, `UNAVAILABLE`, `DISCONNECTED` и `RECONNECTED`. Он не определяет общий
enum и не говорит, что local shell WebSocket является этой connection.

**Проектный выбор.** `connectionState` описывает NET technical session
projection subject. В player projection subject — указанные `deviceId` и
`controllerSeat`; в GM/system projection — устройство, seat либо request,
которые эта projection явно описывает, а не автоматически GM shell.

Поле является закрытым string enum:

| Значение               | Семантика                                                               |
| ---------------------- | ----------------------------------------------------------------------- |
| `NO_TECHNICAL_SESSION` | NET session не создана; начальное значение `APP-002`                    |
| `CONNECTING`           | один fresh connection attempt находится в работе                        |
| `CONNECTED_TECHNICAL`  | session подтверждена, admitted seat binding ещё нет                     |
| `CONNECTED_ADMITTED`   | session и admitted seat binding подтверждены                            |
| `LOST`                 | ранее подтверждённый transport потерян, итог ещё не установлен          |
| `UNAVAILABLE`          | попытка connect/reconnect не достигла host                              |
| `DISCONNECTED`         | host подтвердил отсутствие controller session, durable binding сохранён |
| `RECONNECTED`          | transport вернулся, binding/snapshot/safe boundary ещё revalidate       |

После revalidation non-admitted session становится `CONNECTED_TECHNICAL`, а
session admitted player seat — `CONNECTED_ADMITTED`. GM authority сама не
выбирает state: live GM NET session без player binding остаётся
`CONNECTED_TECHNICAL`, bundled host без NET session — `NO_TECHNICAL_SESSION`.
`RESTORED` остаётся lifecycle/form state. Unknown/client-only state отклоняется.

Поле возникает при публикации формы, перечисляющей его в `requiredFields`, и
всегда вычисляется из подтверждённого состояния subject. Закрытие/forget NET
session возвращает sentinel; required key не исчезает.

### 6. Проекция `APP-002` и граница #62

**Вывод из источников.** `APP-002` должна быть достижима до campaign admission и
до NET technical session. Источник требует bare `controllerSeat`, но не задаёт
его nullability. Переход `APP-001 → APP-002` не повышает authority по
[`$.journeys[0].steps[1].guards`][atlas].

**Проектный выбор.** Atomic snapshot `APP-002` требует:

1. загруженный persistent `deviceId`;
2. non-null `controllerSeat` domain-owned tab в lifecycle state текущего exact
   guard; initial `APP-001` path требует `UNBOUND`;
3. новый player-local `contextId`, связанный с device и seat;
4. `connectionState=NO_TECHNICAL_SESSION`, если NET session отсутствует;
5. фактические `stateRevision` и `projectionRevision`.

Form intent `APP-001 → APP-002` не создаёт seat скрытой domain mutation. Host
сначала проверяет seat, принадлежащую source device; без неё отвечает
`NAVIGATION_UNAVAILABLE`, сохраняя прежнюю presentation и не раскрывая причину.
Atlas и wire не задают trigger provisioning: требуется новое product-решение о
V1 flow. До него путь недостижим; одной реализации seat subsystem недостаточно.

Следствие для #62 намеренное: `APP-002` не требует NET connection или campaign
admission, но требует device identity service и подсистему
`deviceAndLocalSeat`. Прежний host/web-only срез не может дойти до формы и
должен быть пересоставлен владельцем репозитория. Placeholder, `null` или
второй session-only seat ради разблокировки запрещены.

### 7. Отсутствие и fail-closed

**Вывод из источников.** Atlas умеет явно называть optional seat, например
`confirmedGmAuthorityOrNull` и `activeSeatOrNull` в
[`$.forms[127].requiredFields[2]`][atlas] и
[`$.forms[127].requiredFields[4]`][atlas]. Для bare `controllerSeat` `APP-002`
такого контракта нет. QA требует буквальное наличие required fields.

**Проектный выбор.** Required key не опускается. Пустая строка, zero UUID,
`NONE`, первый найденный seat и malformed ID запрещены.

| Поле              | Представление и смысл отсутствия                                                      |
| ----------------- | ------------------------------------------------------------------------------------- |
| `contextId`       | `null` запрещён; без assigned context зависимая form недоступна                       |
| `deviceId`        | `null` запрещён; без valid local identity player-local form недоступна                |
| `controllerSeat`  | `null` только в GM/system/role-neutral context без player owner; в `APP-002` запрещён |
| `connectionState` | отсутствие NET session — `NO_TECHNICAL_SESSION`, не missing/null                      |

Если identity недоступна, target form не публикуется; сохраняется предыдущая
safe presentation либо source-owned diagnostic form. Форма, не перечисляющая
поле в `requiredFields`, просто не проецирует key: это не доказывает отсутствие
entity.

### 8. Граница wire и хранения

**Вывод из источников.** ADR 0020 оставляет form payload opaque, а ADR 0026
публикует payload атомарно с presentation и revisions. Reconnect wire v2 и
persistence schema этих полей не заданы.

**Проектный выбор.** Этот ADR не меняет wire и не добавляет TypeScript schema.
Будущая schema/codec обязана воспроизвести контракт exact и fail-closed.

`deviceId` принадлежит device-local identity store, `controllerSeat` —
`deviceAndLocalSeat` owner/storage, `contextId` — runtime executor, а
`connectionState` — подтверждённому NET/session state. Ни projector, ни client
payload не являются allocator или authority этих значений.

Wire v2 reconnect остаётся задачей #73. Revalidation может подтвердить seat и
создать новый context, но старые IDs сами по себе не являются proof.

## Обоснование

### Что следует из источников

Atlas независимо показывает local menu до NET/admission, device identity до
seat, active input owner, отдельные NET literals и lifecycle local seat. Он не
связывает `APP-002` с `PROVISIONAL` и не сводит эти факты в nullable connection.

### Проектный выбор

Одна domain-owned local seat выполняет контракт input ownership и сохраняет
единственного владельца лимита ADR 0010. Persistent device ID поддерживает
admission/reconnect; ephemeral context ID не становится authority; закрытый
connection enum разделяет transport phase и admission binding.

Цена решения — реальная identity/seat infrastructure до `APP-002`. Она лучше
явного stop V1 flow, чем второй owner и четыре значения-placeholder.

## Отвергнутые варианты

### Что следует из источников

Переходы без admission/session, `APP-003.ZERO_SEATS`,
`NET-002.CONNECTED_TECHNICAL`, lifecycle и explicit `OrNull` vocabulary не дают
одного source-derived fallback для четырёх полей.

### Проектный выбор

| Вариант                                       | Почему отклонён                                            |
| --------------------------------------------- | ---------------------------------------------------------- |
| Передать `controllerSeat=null` в `APP-002`    | Не даёт выбранного player input owner                      |
| Создать pre-commit handle вне domain          | Дублирует owner и лимит `deviceAndLocalSeat` из ADR 0010   |
| Создать seat внутри navigation intent         | Скрывает domain mutation в presentation assignment         |
| Ждать campaign admission                      | Противоречит входам `APP-002` без admission                |
| Ждать NET technical session                   | Противоречит входам с `no technical session created`       |
| Вывести `deviceId` из hardware/network        | Нестабильно, раскрывает fingerprint и не задано источником |
| Считать shell WebSocket `connectionState`     | Смешивает delivery channel с NET session                   |
| Кодировать отсутствие connection missing/null | Required field требует explicit fail-closed sentinel       |
| Создать placeholder UUID в projector #62      | Обходит identity owner, lifecycle и лимит                  |

## Последствия и пересмотр

### Что следует из источников

Реализация должна сохранить буквальные поля `APP-002`, лимит 0–3 tabs,
отсутствие campaign authority до GM admission и seat identity при disconnect.

### Проектный выбор

- Владелец V1 flow выделяет prerequisite для device identity и provisioning
  `deviceAndLocalSeat`; прежний состав #62 не расширяется молча.
- `APP-002` доступна до NET/admission, но не до valid device, local seat и
  player-local context.
- Unknown/missing values блокируют target payload вместо placeholder.

Новый ADR нужен при field-level source, другом nullability/ID format,
tab/seat relation, `connectionState`, durable `contextId` либо изменении
`deviceAndLocalSeat`, Q&A или названных форм. До пересмотра неизвестная связь
отклоняется.

[atlas]: ../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json
[qa]: ../../generated/spec/atlas/qa-scenarios.json
[qna]: ../../generated/spec/qna/questions.json
