# ADR 0066 — Подключение установки и адресованная заявка устройства

- **Статус:** предложено; полная проверка runtime #171 ещё не завершена
- **Дата:** 2026-10-30
- **Дополняет:** ADR 0018, 0027, 0030, 0032, 0063, 0064, 0065, 0068 и 0069

## Контекст и граница готовности

#171 требует подключения другого устройства, выбора 1–3 собственных FINAL,
одной отменяемой заявки и восстановления после перезапуска двух установок.
Техническое соединение не создаёт campaign copy, место в кампании или права
менять её состояние. `sourceUuid` может отсутствовать в локальной библиотеке
GM-хоста — это прямо предусмотрено ADR 0018.

Этот ADR фиксирует технические решения, не новые игровые правила. Его статус
остаётся «предложено», пока сквозная реализация и независимые проверки не
завершены. Наличие файла, SQL-таблицы или source assertion само по себе не
означает готовность NET-форм. Принятая поставка #177 / ADR 0069 задаёт
отдельные preliminary GM accept/reject и IN_REVIEW. Существующие команды
NET-021/022 относятся к final admission и не переиспользуются для этой заявки.

## Две установки и один писатель кампании

На каждом устройстве работает собственная local Node shell со своей SQLite.
Browser подключается к своему локальному `/state`, защищённому ADR 0065.
Его локальная библиотека, installation identity и outbox принадлежат этому
устройству. Player browser не подключается к приватному `/state` GM-хоста.

Соединение кампании обслуживает отдельный закрытый канал `/campaign-state`.
Локальный Node bridge передаёт только явно разрешённые сетевые операции.
Этот канал не принимает grammar локального shell, local/GM context tickets,
произвольный proxy payload или назначение role/controllerSeat клиентом.
GM-хост остаётся единственным писателем campaign state и её requests.

`deviceId`, projection context, attemptId, technicalSessionId, requestId,
commandId, receiptId, sourceUuid, input lane и fingerprint ключа — разные
идентичности. Совпадение IP, имени персонажа, URL или присланного UUID не
доказывает владение. Установка без текущего stored device ID не получает
новую identity в результате отказавшей команды или сетевого handshake.

## Ключ установки и подписи

Installation identity — owner-bound пара Ed25519 средствами `node:crypto`.
Публичный ключ хранится как канонический DER SPKI/Base64, приватный — DER
PKCS8/Base64. Fingerprint — lowercase SHA-256 публичных DER bytes. При чтении
проверяются закрытая shape, каноническое кодирование, алгоритм, обратный DER
export и соответствие публичного ключа приватному. Неизвестная или повреждённая
запись вызывает отказ, а не молчаливую генерацию другой пары.

Миграция 0008 хранит материал отдельно от campaign checkpoint и любых DTO.
Первый подтверждённый ключ текущего owner выигрывает. Повторная подготовка
не вращает уже сохранённый ключ. После reset device ID старая запись не
перепривязывается; уникальный fingerprint запрещает присвоить её новому owner.
Проверка выбранной пары повторяется синхронно в транзакции. Production callback
имеет контракт доверенного read-only validator: без SQL writes, async work или
подмены selected record. Guard проверяет сохранение транзакции, total changes,
schema и user version; нарушения откатываются до дальнейшей записи ключа.
Это защита от ошибочного validator, а не SQL sandbox для произвольного кода,
способного самостоятельно выполнить write + COMMIT или изменить connection PRAGMA.

Приватный ключ не передаётся в browser, LAN payload, экспорт персонажа,
проекцию, диагностическое сообщение или receipt. Он не зашифрован отдельным
player password: такого пароля в V1 нет. Доступ к локальному SQLite остаётся
границей установки; ключ не является аттестацией её программы. Временные
Buffer приватного DER затираются после импорта; неизменяемые JS strings не
выдаются за гарантированно стираемую память.

Технический transcript имеет версию схемы 1 и domain prefix
`SYMBIOSIS_CAMPAIGN_PEER_TRANSCRIPT_V1\n`. Подпись Ed25519 использует `null`
algorithm в Node и закрытый набор полей:

- purpose: HOST_CHALLENGE, DEVICE_PROOF, RPC_REQUEST или RPC_RESPONSE;
- host device/fingerprint, campaign ID, device ID/fingerprint;
- два независимых свежих 32-byte nonce: device и host;
- sequenceNumber: 0 для handshake, положительный safe integer для RPC;
- SHA-256 точного семантического тела сообщения.

Поля сериализуются в code-unit порядке ключей без locale. Каждый purpose
подписывает только соответствующий principal: host challenge/response — host,
device proof/request — device. Подпись связывает обе стороны, кампанию,
challenge, sequence и тело; она не переносится между purposes или соединениями.
Новый physical reconnect получает свежий challenge. Auth envelope не входит
в семантический command journal: прежняя команда восстанавливается с новым
транспортным доказательством, сохраняя прежние command/request/receipt IDs.

Proof exchange имеет отдельные состояния WAIT_DEVICE_PROOF, READY,
AWAIT_RESPONSE и CLOSED. Подтверждённый request sequence потребляется до
вызова executor; пока не подписан один соответствующий response, другая
команда этого соединения не исполняется. Reflection, changed challenge/body,
duplicate/out-of-order sequence и неверное состояние закрывают exchange.
После максимального safe integer он закрывается до инкремента. Этот объект
не реализует persistent command replay, key pinning или payload authorization.

Криптографическая проверка подтверждает владение ключом и целостность тела.
Она не доказывает честность чужого runtime, правдивость manual dice или факт
прохождения игроком собственного UI. Первый явный CONNECT связывает locator
с публичным ключом хоста; последующая смена ключа требует явного решения,
а не автоматического перепривязывания. QR из #170 остаётся публичным locator,
а не паролем или доказательством подлинности при первом подключении. Подписи
не обещают конфиденциальность незашифрованного LAN-трафика.

Основания формата: [Node 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptosignalgorithm-data-key-callback),
[RFC 8032](https://www.rfc-editor.org/rfc/rfc8032.html#section-7.1),
[RFC 8410](https://www.rfc-editor.org/rfc/rfc8410.html#section-7).
RFC8032 TEST1 служит независимым вектором проверки ключа и подписи в тестах.

## LAN locator и удерживаемый listener

Разбор адреса выполняет Node до сетевого обращения. Поддержаны только IP:
loopback, RFC1918, IPv4 link-local, IPv6 ULA/link-local. Публичные адреса,
DNS, unspecified/multicast, zone IDs, userinfo, fragment, обратный слеш,
неизвестный protocol и URL redirects не допускаются. Это технический
allowlist offline LAN, не игровое ограничение кампании.

QR имеет точный формат #170 `http://IP[:port]/?campaignId=<UUIDv4>`.
Он не несёт authority. Ручной ввод принимает HTTP IP с необязательным `/`
или bare IP с обязательным портом; IPv6 в скобках. У HTTP отсутствующий порт
означает стандартный 80, как у существующего QR builder. Bare ввод без порта
не получает угаданный игровой endpoint. Сокращённые, integer, octal/hex и
leading-zero IPv4 отвергаются до нормализации URL. IPv4-mapped IPv6 допустим
лишь для разрешённого вложенного IPv4 и нормализуется к нему.

У ручного ввода можно убрать только внешние пробелы; control characters,
непарные суррогаты и внутренние пробелы отвергаются. QR с query принимается
буквально: одна campaignId, без extra/encoded/duplicate query keys. Парсер
возвращает canonical origin, host, port и campaignId либо явный typed отказ.
Он не выбирает первую/последнюю кампанию на endpoint с неоднозначным target.

Held endpoint из #170 превращается в campaign HTTP/WS handler на том же
`net.Server`: actual sockets передаются обработчику без close/rebind. До
attachment и после detach новые sockets закрываются. Shutdown, release и
ошибка lease сначала уничтожают уже переданные sockets, затем закрывают
listener. Старый detach не удаляет новый handler. Если endpoint заимствован
у local shell, manager возвращает явный BORROWED_SHELL: handler регистрируется
в существующем HTTP server, его listener не захватывается и не закрывается.

## FINAL и input lanes

Selection читает только FINAL текущей installation identity. Локальный bridge
проверяет owned character, durable checkpoint/history, FINAL_SAVE receipt,
связь metadata с исходным final и совместимый baseline. Он фиксирует immutable
candidate bytes и их provenance. Повтор известного request возвращает эти
bytes, даже если metadata библиотеки позднее изменились. Нельзя пересобрать
исторический request из текущего имени или artwork.

Bare `controllerSeat` NET-003 и `requestedControllerSeat` CHR-027 остаются
реальной технической input lane по ADR 0027. UNBOUND → PROVISIONAL считается
в device limit 0–3. Это не admitted/active campaign seat и не capacity
reservation. Нельзя подставить deviceId/sessionId/null, создать campaign copy
или опубликовать J-LOCAL-SEATS вместо этого узкого lifecycle.

Новый технический выбор provisioning trigger: явный вход из player menu в
логическую player NET tab создаёт или восстанавливает одну настоящую UNBOUND
entity **до первой попытки CONNECT**. Поэтому и NET-011 имеет реальную input
lane после неуспешного соединения. Это отдельный подтверждённый entry commit;
сам CONNECT или отказ не создаёт её попутно. Logical tab не равна каждому
browser tab, projection context или выбранному candidate. После restart новый
context привязывается к прежней durable entity; reconnect не увеличивает счётчик.

Candidate batch 1–3 — отдельный draft/request: добавление candidate не создаёт
seat, как и требует APP-003. Отправка заявки переводит существующую input lane
в PROVISIONAL; отмена или отказ возвращает UNBOUND. Один такой input tab не
даёт права одновременно управлять несколькими PC. Создание/назначение admitted
campaign seats остаётся за последующим срезом. Это уточнение проектного выбора
ADR 0027, а не якобы уже заданная в Atlas формула «candidate = browser tab».

Remote host использует `validateFinalAdmissionCandidate` из принятого ADR 0067:
исходные checkpoint strings, snapshot SHA, точный persistence builder и полный
существующий creation replay заново строят safe export и descriptor. Приватный
witness не публикуется в browser/GM queue/readback. Подпись не аттестует честность
чужого runtime или manual dice; checksum-valid произвольный JSON не становится
проверенным листом. Новый rules engine и усечённая история не вводятся.

## Durable recovery и представление

Одна транзакция не охватывает SQLite двух устройств. Сначала player-local
outbox фиксирует точное намерение и candidate bytes; затем remote host
фиксирует один request/receipt; после этого player сохраняет подтверждение.
Потерянный ответ восстанавливается по прежним IDs после нового handshake.
Повтор не выделяет новый request, source snapshot, lane или capacity.

Campaign checkpoint и исходные локальные листы при connect/submit/cancel
не изменяются. Request/session имеют свои revisions и отдельный owner.
Отказ, read, rollback и exact replay не увеличивают counters. Новая команда
проверяет текущие revisions; неизменяемый receipt старой команды не подменяет
текущее подтверждённое представление более позднего request state.

Физический reconnect восстанавливает именно подтверждённый owning NET-005
по session/request, без нового SUBMIT. Это техническое восстановление cursor,
а не выдуманный игровой переход NET-009 → NET-010: NET-010 требует конкретный
PEACE/COMBAT/LOCAL_HANDOFF, неприменимый к pending request. NET-012 требует
конкретный effect и для технического обрыва тоже не публикуется. Новый отказ
CONNECT использует применимый NET-011; подробности invalid transport не
отражают raw input, ключ или private store в browser.

## Что ещё требуется до принятия

- Закрытый peer message codec без новой outer protocolVersion; replay/challenge
  consumption и persisted peer-key binding после первого CONNECT.
- Input lanes, local attempt/outbox, remote sessions/requests/receipts и их
  atomic writers; точный candidate validation contract.
- Discovery, локальные NET projections/forms и источник допустимого GM ingress.
- Полное исполнение предварительных GM решений по поставленному ADR 0069.
- Два настоящих Node/SQLite и browser contexts; fault injection до/после remote
  commit; reset/foreign owner/key/stale payload; ноль copies/capacity mutation;
  независимый полный verify и production E2E на итоговом committed SHA.

Ни один пункт этого списка не объявлен реализованным только на основании ADR.

## Уточнения прикладной реализации после #182

Этот раздел уточняет технический контракт player runtime. Нормативные
preliminary GM commands и IN_REVIEW теперь поставлены отдельно в ADR 0069;
готовность их приложения подтверждается проверками полного #171.

До подтверждённого OPEN параметр Atlas route `:campaignId` несёт отдельный
executor-assigned namespace `unbound:<networkScopeId>`. Он не является campaign
ID или строкой БД. `campaignIdOrNull=null` остаётся явным фактом payload; QR и
discovery hint его не меняют. После OPEN route содержит actual campaign ID,
проверенный через session. Узкие host/web guards проверяют kind, форму и точное
равенство привязки payload. CHR-027 всегда адресует actual owned source UUID.

Новый явный вход APP-002::CTA::003 создаёт отдельную counted UNBOUND tab;
exact replay не создаёт вторую и не переставляет active pointer. NET resume
получает точный opaque scope из owning browser ticket, затем проверяет его
owner, полный журнал и retirement proof в SQLite. Обычный shell reconnect без
NET ticket сохраняет прежнюю семью local wizard/post-save/GM: несколько
независимых cursor не дают права выбирать первый, последний или NET TARGET
автоматически. Новый browser без ticket не восстанавливает NET cursor сам;
reload и restart того же browser восстанавливают его по сохранённому ticket.
Audited TARGET/NONE служит явным выбором уже существующей tab, когда вызывающий
путь запрашивает этот выбор. Использовать `active ?? create` для нового
входа нельзя: это скрывает четвёртую попытку за автоматическим resume. Вход из
CHR-040 создаёт такой же явный local input scope и сохраняет точную source ref;
новый candidate не создаёт actor seat. NET-003 → NET-004 фиксирует request ID
и immutable prepared batch до SUBMIT. Поздняя metadata edit его не подменяет.

Первый entry commit схемы 0010 сохраняет необязательный applicationEntry в
существующем журнале: точный canonical browser envelope и исходный UUID FINAL
либо null для APP-002. Поэтому сбой до отдельного первого NAV не разрешает
переиспользовать ID для другого входа или выбрать текущий чужой cursor вместо
исходного FINAL. Replay сверяет envelope до binding/IO и заново проверяет
сохранённый собственный source. Старые schema9 entries остаются побайтово
неизменными; отсутствие application binding не восстанавливается догадкой.

Миграция 0010 добавляет application companion/event/outbox/pin и hosted
peer/session/request/command. Локальным triple по-прежнему владеет tab:
изменённый editable draft повышает S/P/draft на один; navigation повышает P;
первый CHR-040 → CHR-027 одновременно фиксирует выбранный source candidate и
повышает S/P до 1/1 при draftRevision=0. Поэтому его новый namespace не обязан
иметь нулевой S или P>S. Возврат из FINAL в retained confirmed scope использует
существующие ревизии этой NET entity, а не ревизии финального листа;
новый INTENT и первый ACK повышают S/P каждый на один. Visibility остаётся 0.
Read, no-op и replay не повышают counters. PREPARE_BATCH фиксирует semantic
data и повышает S/P, а draftRevision не меняет. Remote request/session vectors
никогда не копируются в local vector. Old immutable receipt возвращается
вместе с отдельным актуальным представлением, без отката cursor.

Возврат CHR-027 к FINAL при подтверждённом UNBOUND scope не удаляет input
identity или technical session. Application event сохраняет точный SHELL_EXIT
с исходным navigation ID и собственным source UUID; это изменение только P.
Потерянный ответ восстанавливается в тот же FINAL по этому событию. Новый явный
NET ingress очищает exit marker. Повтор старого выхода после более новой
локальной навигации не вправе переставить shell cursor: same-transport replay
проверяет точное последнее exit assignment, context и vector. Cold resume
допускает восстановление адресованного выхода до появления другого shell context.

В пределах одной синхронной фазы delivery reader возвращает current, outbox
и исходный ACK event из одного полного проверенного журнала. Это не cache между
`await` или транзакциями: после сетевого ожидания источник проверяется заново,
а writer сохраняет полный transactional replay и final guards. Неизменяемый
receipt и актуальная проекция используют разные части этого проверенного снимка.

NET-005 `cancelReason` — собственный локальный editable input. Закрытый v3
`CANCEL_REASON` сохраняет его до пересчёта availability: CTA отмены появляется
только после подтверждённой непустой причины. Сохранение input не исполняет
отмену и не передаёт её GM. CANCEL остаётся отдельной явной workflow-командой.
Неподтверждённый SUBMIT/CANCEL outbox блокирует закрытие ещё UNBOUND tab: remote
commit мог произойти до потерянного ACK. NOT_FOUND не очищает outbox и не даёт
новые semantic IDs. Внутри общего campaign executor recovery отзывает прежнюю
opaque ATTEMPT/SESSION lease и RAM transfers до ответа; финальный SQL guard
повторно проверяет lease. Одна очередь без generation fence недостаточна для
позднего старого COMMIT после нового NOT_FOUND. Другие logical sessions того
же peer не отзываются. Restart уничтожает все прежние physical channels и RAM
transfers; новое соединение получает свежий proof.

Host pin имеет ключ ownerDeviceId+campaignId, независимо от введённого origin.
Редактирование адреса не сбрасывает известный ключ. First-use pin фиксируется
до `confirmHostPin` и первого RPC. Immutable campaign birth baseline, текущий
artifact manifest и pinned candidate baseline остаются разными фактами;
неизвестная смена baseline отклоняется. Совместимость конкретной B0/B1 пары
разрешает только loader-owned resolver ADR 0068 с полным source seal;
SQL callback синхронно проверяет обе сохранённые версии. Browser не выдаёт
compatibility boolean, исходные birth/bytes не переписываются.

Публикация CREATE с host configuration является явным выбором этого owner
размещать кампанию. После restart перечисляются все actual owner-valid PAUSED
кампании с проверенным CREATE proof; для каждой восстанавливается её held bind.
Это технический выбор восстановления, не выбор первой/последней campaign.
Corruption не скрывается, занятый endpoint не выдаётся за успешный. Discovery
рекламирует только действительно опубликованные live endpoints.

Discovery group/port заданы deployment-конфигурацией `package.json`:
`239.255.77.7:47777`, administratively scoped UDP4 с TTL 1. Это технический
канал приложения, не игровой параметр. Scan ограничен 1200 ms, 64 offers и
4096 bytes на packet; обрезанный список отмечается явно. Channel deadlines
составляют 10 s; inbox — 16 кадров/512 KiB, pending calls — 8. Private frame
сохраняет предел ADR 0067 128 KiB. Carrier использует chunks до 64 KiB, witness
до 16 MiB, полный submit до 64 MiB, до 8 RAM transfers/128 MiB суммарно и
30 s deadline. Превышение даёт отказ, без усечения evidence или нового RNG.
Одновременно runtime обслуживает до 64 private channels. Бюджет 128 MiB
относится к staged bytes, а не обещает верхнюю границу всего RSS процесса.
Private endpoint ограничивает 64 ещё не завершивших handshake соединения до
upgrade. Executor ограничивает таблицу scoped recovery fences 1024 записями
и 8 MiB суммарных UTF-8 ключей до добавления новой записи. Живые tombstones не
вытесняются ради освобождения бюджета: иначе старый transport вернётся после
NOT_FOUND. После отзыва всех прежних физических principals возможно безопасно
убрать только уже недостижимые fence records. Это не постоянный запрет peer
когда-либо снова использовать ID: honest local outbox проверяется повторно
после handshake и непосредственно перед RPC, в том числе после recovery.

Outgoing locator и ещё не завершённый WS handshake принадлежат тому же local
scope, что и готовый channel. Close, closeScope и замена попытки отменяют их
через scope-owned AbortController, сохраняя прежний deadline. Поздний ответ не
фиксирует pin или intent после отзыва scope; проверка owner и cancellation
повторяется до синхронной записи. Закрытие приложения не ждёт чужого timeout,
чтобы освободить незавершённый исходящий transport.
До durable commit кодирует также будущий short ACK: неизменяемый receipt и
current view вместе обязаны уместиться в 128 KiB. Большая причина отмены или
корреляция не усекутся и не создадут commit, которому невозможно ответить.
Эти engineering budgets ограничивают память/ожидание; они не меняют лимиты
персонажей, capacity, правила игры или состав исходных артефактов.

QR из локального файла декодируется существующим `jsqr` 1.4.0, который теперь
используется в self-contained runtime bundle. Новый пакет или install script
не добавляется. Декодирование ограничено 12 MiB файла и 4096 pixels по стороне:
это бюджет чтения изображения, не правило арта. Bitmap закрывается и поздний
результат после unmount отбрасывается. QR только заполняет собственный draft;
OPEN остаётся отдельным действием, Origin/history browser не меняются.

## Предварительное GM review и технический QUEUE cursor

Atlas 1.6 / ADR 0069 задаёт две отдельные команды: ACCEPT-TO-REVIEW переводит
PENDING → IN_REVIEW; REJECT переводит PENDING или IN_REVIEW → REJECTED с
непустой причиной. Отмена владельцем допустима только из PENDING. Порядок
транзакций решает гонку CANCEL и GM decision: проигравшая команда получает
отказ и актуальное состояние, а не поддельную квитанцию успешной отмены.
Решение не создаёт campaign copy, admitted seat, reservation или Start.

Forward migration 0011 не меняет bytes 0009/0010, CREATE или SUBMIT. Она
добавляет отдельные журналы GM view, решений, lane provenance и local current.
Существующий campaign cursor получает закрытый kind QUEUE для NET-017 и
его safe return CMP-006. Это технический view head, а не новый campaign
checkpoint: birth CREATE receipt, campaign rows и revisions остаются прежними.
Первый вход проверяет собственную PAUSED campaign по её actual CREATE origin;
этот узкий ingress не вводит универсальное игровое правило для всех решений.

QUEUE проверяется по последовательности NAV, DRAFT, REQUEST_REFRESH и
CONNECTION_REFRESH. NAV и connection refresh повышают только P; изменение
confirmed selection/reason и новое решение повышают S/P. Request queue revision
отдельно учитывает SUBMIT, CANCEL, decision и однократное legacy lane enrichment.
Исторические NAV/draft/decision receipts возвращаются с текущим head без rewind.
Перед явной публикацией reconnect/command/NAV/draft host отдельно фиксирует
изменившийся authenticated connection snapshot как P-only event, даже если
браузерный watcher отсутствовал. Сам read-only projector ничего не записывает;
неизменный snapshot не создаёт новый event или revision.
CANCELLED исключается из текущих строк, очищает selected request и reason,
но сохраняет всю историю. Смена выбранной заявки тоже очищает прежнюю причину.
Если пользователь уже ввёл новую причину до подтверждения смены выбора,
клиент сначала сохраняет выбор с пустой причиной, затем отдельным draft
сохраняет этот новый текст. Принятие или отклонение автоматически не запускается.
После подтверждённого STALE_REVISION только из-за роста P допускается один
повтор неподтверждённого draft с новым ID: свежий reconnect должен подтвердить
те же S/A, campaign/context и requestQueueRevision. Иная гонка или повторный
stale требуют нового явного ввода; прежний envelope не переписывается.

Authority связывает exact owning local GM context, installation owner,
master profile/revision, private campaign owner и CREATE proof. Последний
active context pointer не заменяет эту связь. Campaign runtime, GM commands,
NAV и технический refresh используют одну host очередь; после каждого await
контекст и владение проверяются заново. Transaction callbacks синхронны,
read-only и обязаны вернуть undefined; false, Promise, SQL write или изменение
source отклоняются. Request/candidate доказательства перепроверяются до commit,
включая полный creation replay и строгий baseline resolver, а current checkpoint
проверяется отдельно от неизменяемого birth anchor.

NET-017 имеет ровно 12 source fields и отдельный GM transport scope с
campaignId + gmLocalContextId; фиктивные player context/controllerSeat в него
не добавляются. Каждая batch summary показывает checksum точных canonical
export bytes, включая checksum member и завершающий LF: descriptor.exportBytesSha256.
Приватный witness, ключ, verifier и internal rules в projection не передаются.
Решение имеет закрытый 14-field receipt; original applied facts отделены от
current request/view. Прежде чем transaction завершится, будущие browser и
private peer ответы кодируются целиком с действующими byte limits.

## Legacy input lane и доставка владельцу

Новый prepared batch schemaVersion 2 хранит actual owned local tab ID вместе
с исходной заявкой. Старый SUBMIT остаётся побайтово неизменным. Для него
добавлена восьмая закрытая private operation DEVICE_REQUEST_BIND_LANE в
существующем private schema 1, без новой outer protocolVersion. Local bridge
доказывает origin через исходные retained applicationEntry и SUBMIT INTENT;
текущий browser tab после crash gap не заменяет исходную lane. Если этот
origin недоказуем, применяется явный отказ, а не придуманный UUID.

BIND получает отдельные durable intent/receipt и sidecar ACK. Receiver проверяет
тот же authenticated key, owner, campaign, session, original SUBMIT и batch
hash. Это owner-host attestation; receiver не заявляет доступ к чужой SQLite.
Один request связывается с одной lane: иная повторная привязка запрещена.
Request revision при enrichment не меняется. При одинаковой request revision
решения обязаны совпадать точно; единственное отдельное продвижение provenance
null → BIND_LANE допускается только через matching original local BIND ACK.
Generic current refresh не имеет такого исключения. Потерянный первый ACK
восстанавливает исходные IDs; поздний ACK после CANCEL не оживляет заявку.

Private RECOVER остаётся read-only по семантике заявки и возвращает immutable
SUBMIT/CANCEL receipt отдельно от verified current proof. Local REQUEST_ADVANCE
и CANCEL_SETTLE сверяют полный event identity до no-op/replay; другое proof,
event/receipt ID или expected vector не подменяет известный event. Если CANCEL
проиграл решению, original outbox сохраняется, explicit settlement завершает
его без fake CANCEL ACK. Более позднее состояние применяется отдельным событием.

Хост использует actual authenticated registered channels для connection status;
одного совпадения device UUID недостаточно. Bounded periodic recovery доставляет
изменение только владельцу текущей NET-005. Browser получает existing v2 snapshot
с отдельными network-owner-view / network-gm-view correlations, без NAV и без
новой authority. Push сохраняет pending commands/drafts. Явные решения идут
через v1 workflow envelope, editable GM draft — отдельный закрытый v3 message.
Reconnect повторяет исходный неподтверждённый intent, а original receipt всегда
сопровождается актуальным verified view. Выход, потеря доверия и shutdown
отзывают subscription; protocol errors не раскрывают приватные source values.

Owner polling повторно разбирает owned history после каждого private await.
Один полученный до или после await bundle используется лишь в своей синхронной
фазе; он не заменяет повторную проверку source/CAS после ожидания. Живой
аутентифицированный канал повторно не подключается перед каждым SUBMIT/CANCEL.
При его отсутствии новый канал сначала восстанавливает существующую логическую
сессию и заявку, включая pending outbox; затем перечитывается актуальный исход.
Явный resume по-прежнему обновляет подключение.

Подписка owner polling следует только успешно отправленной host NET-005.
Публикация другой формы снимает её до следующего queued tick; browser не
назначает эту подписку. Tick всё равно заново проверяет owner, scope, context,
форму и отсутствие pending mutation. Для новой inline-lane заявки подтверждённый
ACK и destination строятся из одного свежего post-commit bundle синхронно.
Сбой построения или частичной доставки закрывает транспорт без противоречивого
отказа после результата; reconnect возвращает тот же durable receipt.
