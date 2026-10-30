# Передача контекста — 2026-10-30

Подготовка issue #171, ветка `codex/171-device-admission-request`.
База — `03bf13b5b3d56ea04f81659bda7a53aef8e00742`: PR #178 и #180 слиты,
issues #170 и #179 фактически CLOSED/COMPLETED. Независимые проверки базы:
134 файла / 2499 Vitest-тестов и 34 production E2E без retry; CI тоже зелёный.
Это не утверждение готовности нового NET runtime.

## Текущая подготовка #171

- Held `net.Server` передаёт actual sockets campaign handler без close/rebind.
  Owned attachments уничтожают sockets при detach/release/shutdown; borrowed
  listener остаётся под управлением local shell.
- Strict LAN locator принимает IP-only HTTP QR #170 и ручной адрес. DNS,
  runtime Internet, необычные IPv4 encodings и двусмысленный query запрещены.
- Миграция 0008 хранит owner-bound private installation identity отдельно от
  campaign/checkpoint/export. Reset не присваивает старый ключ; повреждение
  вызывает отказ. Транзакционный validator получает выбранную сохранённую пару.
- Host primitives проверяют реальный Ed25519 keypair, canonical DER/Base64,
  transcript с обеими сторонами/campaign/nonces/sequence/body hash. Private key
  не входит в публичную identity. Это possession proof, не GM authority или
  аттестация честности runtime; отдельного player password нет.
- Буквальные assertions охватывают NET-001–005/009–012, CHR-027 и player-menu
  ingress. Они не публикуют UI и не создают request/campaign copy/seat.
- [ADR 0066](../adr/0066-device-connection-and-admission-request.md) предложен,
  не принят. Discovery, peer endpoint/codec, lanes/outbox/request stores,
  candidate witness, actual NET flow и production E2E двух устройств ещё нужны.

#171 остаётся открытой; подготовку нельзя считать её выполнением или мержить
как готовый сквозной срез. #177 требует явного нормативного решения владельца.
Original private candidate witness и точное применение existing creation replay
проработаны в `reports/171-candidate-evidence-audit.md`; safe export validator
сам по себе не доказывает механическую корректность rechecksummed remote DTO.

Точные результаты новых полных проверок фиксируются в описании draft PR и
`reports/171-phase-a-verify.log` / `171-phase-a-e2e.log` после заморозки diff.
Частичные focused-прогоны не подменяют критерии готовности всей #171.

## История слитого prerequisite #179

Ниже доказательства исходного изменения PR #180; его независимый прогон на
`224552bec313b7753103ed4967a3f9cd85826d4b` подтвердил 134 файла / 2499 тестов
и 34/34 E2E без retry, чистое дерево до/между/после. Merge tree идентичен этому
SHA. Непрерывный новый LAN runtime #171 этим не проверялся.

## Что исправлено в #179

Перед #171 реальный TCP reproducer прошёл с чужим Origin через public
`/device-identity` и обычный `/state` до host-local APP-004. UUID устройства
работал как locator без доказательства права читать локальный namespace.
GM-specific proof уже действовал; обычный player path требовал общей границы.

- `/state` проверяет действительный TCP peer/local endpoint, живой listener и
  канонический Origin до каждого frame всех версий, JSON decode, private
  reads, replay, ID allocation, KDF и mutation. GM authority и owner/revision
  проверки сохраняются отдельно.
- Неподтверждённый frame получает только protocol refusal с null input value
  и закрытие 1008. Role/device ID, Host/proxy headers и URL не дают обхода.
- `/device-identity` отказывает HTTP 403/no-store до чтения store. Переданный
  Origin строгий. Origin-less read-only HTTP GET разрешён только реальному
  host-local TCP peer; это не исключение для WebSocket.
- Статика, поставленные media и health остаются публичными. Будущий campaign
  transport #171 использует отдельный закрытый handler и собственные proofs.
- Все 55 simulated private WS connections в семи integration suites заменены
  настоящими TCP/Origin connections. HTTP identity проверяется fetch.
  Production authority adapters, test flags и fake peer metadata не добавлены.

[ADR 0065](../adr/0065-host-local-app-transport-boundary.md) принят.
SQLite schema, artifacts/generated, зависимости, CI и конфигурация проверок
не меняются. Переход на реальный transport сохраняет игровые assertions.

## Проверки

- До fix exact TCP probe: HTTP 200, APP-001/002/004 доступны чужому Origin.
  После fix: HTTP 403, один protocol refusal, опубликованных форм нет.
  Логи: `reports/179-local-player-exposure-before.log` и `-after.log`.
- Семь real-TCP host suites: **94/94 теста**, исходные assertions поведения
  сохранены; отрицательный GM case выделен в отдельное чужое соединение.
- Новый actual TCP/HTTP/WS suite: **30/30**, все wire versions, malformed и
  binary input, missing/null/foreign Origin, поддельные Host/proxy headers,
  безопасный отказ и zero private SQL/revision/ID/RNG/KDF effects.
- Чистые proof predicates: **7/7** вместе с прежним master trust suite.
- Полный `npm run verify` прошёл: **134 файла / 2499 Vitest-тестов**, типы,
  ESLint, Prettier, checksums, traceability и validate.
  Лог: `reports/179-verify-root.log`.
- Production-сборка и **34/34 Chrome E2E** прошли без retry;
  Node replay fixtures тоже передают настоящий Origin своего listener.
  Лог: `reports/179-e2e-root.log`. После уточнения этих двух fixture headers
  общий typecheck повторно прошёл: `reports/179-final-typecheck.log`.
- Независимый final-SHA прогон и CI прошли перед merge PR #180:
  134 файла / 2499 тестов и 34/34 E2E без retry; tree squash совпал с проверенным.

## Дальнейшая очередь

#171 имеет отдельный source blocker [#177](https://github.com/tixonowar-ui/Symbiosis-V7/issues/177):
заявленное предварительное GM review противоречит финальным admission-командам
поставленного Atlas. Предложены две отдельные request-команды и IN_REVIEW,
без copies/seats; решение владельца ожидается, нормативные файлы не изменены.

Read-only подготовка #171 сохранена в reports: source audit, topology/trust
и store API proposal. Выбранная для обсуждения архитектура — собственный local
Node/SQLite устройства и отдельный bridge к единственному campaign writer.
Provisional input controllerSeat из ADR 0027/0030 отделён от admitted seats и
campaign capacity. Технические primitives перечислены выше; полный flow не готов.

После #171 идут #172 → #173 → #174. #113 требует отдельной санкции source
поставки и явной границы runtime; вопросы о массе/поле/переиспользовании
портретов и недостающем enemy art уже решены, повторять их не нужно.
Подготовленные арты ещё должны войти в manifest/importer.

Пользователь разрешил последовательные merge до закрытия всех issues.
Перед каждым merge обязательны независимое ревью и свежие verify/E2E
на окончательном HEAD; фактическое закрытие issue проверяется отдельно.
