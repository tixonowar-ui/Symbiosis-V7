# ADR 0066 — Подключение установки и адресованная заявка устройства

- **Статус:** предложено; issue #171, нормативный конфликт #177 остаётся открытым
- **Дата:** 2026-10-30
- **Дополняет:** ADR 0018, 0027, 0030, 0032, 0063, 0064 и 0065

## Контекст и граница готовности

#171 требует подключения другого устройства, выбора 1–3 собственных FINAL,
одной отменяемой заявки и восстановления после перезапуска двух установок.
Техническое соединение не создаёт campaign copy, место в кампании или права
менять её состояние. `sourceUuid` может отсутствовать в локальной библиотеке
GM-хоста — это прямо предусмотрено ADR 0018.

Этот ADR фиксирует технические решения, не новые игровые правила. Его статус
остаётся «предложено», пока сквозная реализация и независимые проверки не
завершены. Наличие файла, SQL-таблицы или source assertion само по себе не
означает готовность NET-форм. Публикация preliminary GM accept/reject и нового
статуса заявки требует решения #177: существующие команды относятся к
NET-021/022 и публикуют campaign copies, запрещённые срезом #171.

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

Remote host отдельно валидирует закрытый candidate schema, baseline,
provenance, checksum, catalog references и согласованность доступных фактов.
Подпись/checksum не заменяют эту проверку и не выдаются за полный replay
всей удалённой creation history. Конкретный witness/recompute contract должен
быть зафиксирован до публикации SUBMIT; этот предложенный ADR не разрешает
принять произвольный rechecksummed JSON как проверенный лист.

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
- Решение #177 и нормативная поставка preliminary GM decisions.
- Два настоящих Node/SQLite и browser contexts; fault injection до/после remote
  commit; reset/foreign owner/key/stale payload; ноль copies/capacity mutation;
  независимый полный verify и production E2E на итоговом committed SHA.

Ни один пункт этого списка не объявлен реализованным только на основании ADR.
