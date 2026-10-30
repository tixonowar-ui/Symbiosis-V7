# ADR 0067 — Закрытый сетевой фундамент установки

- **Статус:** принято; issue #182, предпосылка #171
- **Дата:** 2026-10-30
- **Дополняет:** ADR 0018, 0027, 0030, 0063 и 0065
- **Граница:** технические APIs; прикладной сценарий ADR 0066 остаётся предложенным

## Контекст

Устройство игрока владеет своей SQLite и FINAL. Читать вместо неё локальную
библиотеку GM-хоста нельзя. ADR 0065 отделил приватный `/state`; для #171 нужен
отдельный Node-to-Node канал. Его владение ключом не даёт GM authority, campaign
copy, допуска или места. Предварительные решения GM требуют нормативного #177.

Issue #182 реализует и проверяет самостоятельный инфраструктурный контракт.
Регистрация сетевых forms/routes, discovery в UI, distributed outbox, заявки,
решения GM и сквозной сценарий двух browser contexts остаются в #171. Наличие
этих библиотечных APIs не объявляет NET journey готовым.

## Installation identity

Установка хранит owner-bound Ed25519 SPKI/PKCS8 DER в каноническом Base64;
fingerprint — SHA-256 публичных DER bytes. Миграция 0008 отделяет запись от
campaign state. Реальный ключ проверяется по алгоритму, DER round trip и
соответствию private/public. Existing запись выигрывает без rotation; corrupt
record вызывает отказ, reset device ID не присваивает прежний ключ новому owner.

`initializeNetworkInstallation` вызывается только при явном старте приложения,
после штатного device bootstrap и до открытия transport. Чтение во время
сетевого запроса использует `loadNetworkInstallation`: оно не создаёт identity,
не ремонтирует и не вращает ключ. Так отказавшая команда не становится скрытым
bootstrap. В key DTO, ошибках и receipts нет private material; временные DER
Buffer затираются. JS strings не объявляются гарантированно стираемой памятью.

## Закрытый канал

Private control/RPC использует outer version **3**, отдельные `network.peer.*`
families и canonical JSON. Неизвестные поля/типы, duplicate members, aliases,
binary frames и переполнение границ отклоняются. Максимум control frame —
128 KiB UTF-8: это технический предел, не игровой параметр.

HELLO адресует конкретную campaign ID и public identity устройства. HOST_CHALLENGE
подписывает публичные факты кампании и transcript с обеими installation IDs и
fingerprints, двумя свежими 32-byte nonce, campaign ID, purpose, sequence и body
SHA-256. DEVICE_PROOF отвечает на точный challenge. RPC_REQUEST/RPC_RESPONSE
имеют отдельные purposes и последовательность от 1; request потребляется до
передачи executor, один response завершает этот sequence. Повтор transport sequence,
конкурентный неподтверждённый response и reflection закрывают exchange. Перед overflow safe
integer соединение закрывается.

Сервер принимает действительные LAN TCP endpoints, отсутствие Origin и точный
private path. Browser Origin, Host/proxy headers и client role не выдают proof.
С начала handshake работает одна ограниченная inbox: proof и первый RPC в одном
TCP receive не теряются при переходе между Promise continuations. Очереди,
handshake/RPC deadlines и их размеры задаёт caller. Нарушение закрывает канал;
ошибки не сохраняют raw input, callback message/cause или ключ.

Client PINNED проверяет прежнюю public identity. FIRST_EXPLICIT_CONNECT требует
от caller сначала durably закрепить полученный host key и только затем подтвердить
pin перед первым RPC. `confirmHostPin` — контракт caller, не доказательство SQL
commit. Подпись не аттестует честность runtime, не аутентифицирует первое знакомство
против активного relay и не шифрует LAN-трафик.

Private WSS caller задаёт `maxPayload` 128 KiB. Если передан socket чужого shared
WSS с большей границей, channel гарантирует отказ после receive, но не обещает
перенастроить его allocator; private поля библиотеки `ws` не изменяются.

RPC transport не исполняет body. Отдельный закрытый application codec разрешает
только OPEN/RECOVER/CANCEL и технические BEGIN/CHUNK/COMMIT. Caller всё равно
проверяет principal/session/owner, domain proof, revisions и transaction. Крупная
заявка передаётся будущим прикладным carrier с обязательными configured limits,
не одним безграничным frame. Этот ADR не объявляет carrier/outbox реализованным.

## Discovery и endpoint

Locator parser принимает private/loopback/link-local IP, HTTP address или точный
QR #170; DNS, public Internet, credentials, неоднозначные query и необычные IPv4
encodings запрещены. Bare address требует порт. IPv6 поддержан в manual/QR;
discovery service использует UDP4 с явно заданными interface/address/port.

Multicast ограничен configured administratively scoped IPv4 group и TTL 1.
Каждый scan получает новый query ID, window и предел уникальных offers/bytes.
Дубликаты одинаковых facts объединяются, противоречивый target исключается с
явной диагностикой; новый first/latest target не выбирается. Переполнение помечает
результат как truncated. Datagram budget задаёт caller, максимум 60 KiB. Discovery
даёт публичный locator, не trust или admission; hardware multicast не подменяется
прошедшими loopback UDP tests.

Discovery source/diagnostic callbacks синхронны. Возвращённый или брошенный
native Promise получает безопасный rejection handler и отзывает responder до
следующего datagram. Обычный синхронный return наблюдателя не интерпретируется
как статус. Это не sandbox для произвольных Promise constructors.

Held campaign listener передаёт actual sockets HTTP/WS handler без close/rebind.
Detach/release/shutdown закрывает переданные sockets; borrowed shell возвращается
явно и остаётся под управлением своего listener. Это не регистрация нового route.

## Immutable FINAL evidence

Producer читает actual device owner, row/checkpoint/presentations и metadata chain
в coherent read transaction. Private canonical witness сохраняет исходные строки
payloadJson/snapshotJson и два actual presentation значения. Receiver проверяет
snapshot SHA, точный persistence builder и vectors, затем использует существующий
полный creation replay и точное повторное построение safe export/descriptor.
Новый rules engine или отбрасывание истории не вводятся.

Metadata revision 0 совпадает с original final identity. Поздняя metadata version
проверяется producer; receiver не обещает аттестацию удалённой metadata history.
Old pinned bytes продолжают проверяться после новых локальных metadata edits.
Внутренняя согласованность истории не доказывает честность manual dice.

Witness может содержать прежние собственные имена/арт и opaque INVALID inputs;
он приватен Node-to-Node и не возвращается в projections/readback/errors. В receiver
result остаются только descriptor и проверенный safe DTO. Caller обязательно
задаёт byte limit; слишком большая история отклоняется без truncation или нового RNG.

## Current campaign и локальная input tab

Immutable CREATE proof проверяется отдельно от current checkpoint. Новый reader
считает literal ACTIVE PC, возвращает только безопасный header и не ослабляет
прежние zero-copy/zero-vector creation APIs. Pending/PROPOSED не резервируют capacity;
disconnected ACTIVE продолжает считаться. Будущий mapping blocked lobby copies
не угадывается через synthetic lifecycle state.

Миграция 0009 создаёт owner-bound logical input tab и её immutable entry/close
journals. UNBOUND/PROVISIONAL считаются в device limit 0–3 по ADR 0010/0027;
ни одно из них не является admitted campaign seat. Явный entry создаёт tab до
CONNECT, чтобы failure NET-011 имел реальную input lane. Один draft batch может
ссылаться на эту lane при выборе 1–3 FINAL; это не разрешение управлять тремя PC.

Close допустим только для UNBOUND; pending PROVISIONAL сначала требует настоящую
отмену. Domain entity удаляется логически, audit anchor хранит последнюю UNBOUND,
close proof и невозобновляемые IDs. CurrentTab=null допустим только при проверенной
retirement receipt. Active pointer имеет явный TARGET/NONE; неизвестный/missing
pointer при существующей истории не заменяется первым/последним tab. Exact replay
не переписывает receipt, не открывает tab и не перемещает current pointer назад.

SQL callbacks — доверенные синхронные read-only validators, не sandbox для
произвольного JavaScript/SQL. Guard проверяет transaction lifetime и изменения;
возвращённый/брошенный native rejected Promise получает безопасный handler без
await. Его отказ не отменяет уже запланированную работу ошибочного callback.

## Проверка

Используются actual TCP/UDP, отдельные SQLite, reopen/fault/owner-reset probes и
source-backed FREE/PURE/UNITED AUTO/MANUAL FINAL. Итоговый SHA требует полного
verify, production E2E и независимого повторного прогона перед merge #182.
Эти тесты не являются сквозным admission E2E #171.

Технические основания: [Node crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html),
[Node dgram](https://github.com/nodejs/node/blob/v24.19.0/doc/api/dgram.md),
[RFC 8032](https://www.rfc-editor.org/rfc/rfc8032.html),
[RFC 8410](https://www.rfc-editor.org/rfc/rfc8410.html).
