# Передача контекста — 2026-10-30

Текущая работа — **issue #171, WIP**, ветка `codex/171-device-request-flow`.
База `c30ee6b894c77d71b80b261985a2b2814ac90f0f`: PR #183 слит,
prerequisite #182 закрыта. Открыт [draft PR #185](https://github.com/tixonowar-ui/Symbiosis-V7/pull/185),
полного готового #171, merge и закрытия #171 ещё нет. Ниже сначала текущий статус; прежние снимки и их доказательства
сохранены в истории.

## Текущий срез #171

В рабочей ветке собственная player Node/SQLite-установка подключается к
кампании по authenticated peer channel. Локальный `/state` сохраняет прежнюю
проверку реального transport/Origin; данные браузера не дают сетевой или
мастерской authority.

- APP-002 и текущий FINAL CHR-040 открывают новый явный вход. NET-001–005/011
  и CHR-027 зарегистрированы в рабочей ветке; остальные NET-формы не добавлены.
- Discovery и ручной locator используют заданные бюджеты. Локальный QR image
  decoder заполняет адрес; подключение требует отдельного OPEN.
- Local outbox сохраняет intent до remote side effect. Immutable receipt,
  текущая проекция и локальный revision vector проверяются раздельно;
  replay/recovery удерживают тот же command ID. Неизвестный исход остаётся
  pending до подтверждения.
- SUBMIT передаёт pinned batch из 1–3 собственных FINAL с проверяемым исходным
  свидетельством. Исходный checksum механики отделён от checksum безопасного
  экспорта. Preview не перечитывает изменившиеся метаданные как новый batch.
- Техническая сессия, real input lane и campaign seat различаются. Сессия
  и заявка не создают campaign copy, seat или резерв вместимости. Три logical
  input tabs учитываются на установку, четвёртый вход отклоняется.
- CANCEL выполняется только явно после подтверждения локального CANCEL_REASON.
  Close/exit, intent и ACK аудируются. Известный opaque scope восстанавливает
  собственный NET-контекст либо подтверждённый выход в APP-002/CHR-040 без
  создания нового входа. При отсутствии ticket обычный v2 bootstrap сохраняет
  обычный local flow; среди чужих или нескольких namespaces выбор не угадывается.
- Миграция 0010 добавляет восемь сетевых sidecar-таблиц отдельно от creation
  checkpoints. Endpoint, executor, local coordinator, peer runtime, projector
  и web связаны в текущем worktree; проверка полного сценария продолжается.

### Нормативная граница и оставшаяся работа

[#177](https://github.com/tixonowar-ui/Symbiosis-V7/issues/177) остаётся
source blocker: поставленные admission-команды создают campaign copies,
а заказанный preliminary GM review не должен их создавать. Решение владельца
ещё не получено. Новые GM-команды, `IN_REVIEW`, preliminary accept/reject и
NET-017 не реализованы. [ADR 0066](../adr/0066-device-connection-and-admission-request.md)
остаётся предложенным; ADR 0067 принят для уже слитого фундамента #182.

Два новых production Chrome E2E запускают две настоящие Node-установки с
отдельными SQLite и прошли без retry: `reports/171-network-e2e-player-final.log`,
2/2. Проверены ручной адрес, SUBMIT, restart обеих сторон и CANCEL, а также
настоящий GM QR screenshot, локальный decoder и batch трёх разных FINAL.
Дополненный первый сценарий проверил новый вход CHR-040 → CHR-027, возврат,
а затем повторный вход в тот же retained scope после CANCEL:
`reports/171-network-final-entry-e2e-second.log`, 1/1, без retry.

Прежняя задержка CANCEL исправлена удалением повторного чтения одного полного
журнала в синхронной фазе: измерено 6355 → 3769 ms, без изменения production
таймаутов. Предыдущие неудачные E2E и их trace сохранены отдельно в `reports/`.
Для трёх полных source histories новый тест ждёт в пределах фактических
transfer/RPC budgets конфигурации; сами budgets не увеличены.

Находка независимого fault probe в окне между durable entry и первым NAV
исправлена: первый commit сохраняет исходные browser envelope и UUID FINAL.
Неизменённый independent reproducer после SQLite reopen отклоняет подмену
envelope без NAV/write и восстанавливает исходный FINAL A даже при shell B;
entry/tab остаются по одному. Отчёт повторной проверки —
`reports/171-independent-entry-crash-gap-rereview.md`; авторские регрессии —
73/73 в `reports/171-entry-binding-tests.log`. Schema9 bytes не менялись.

[#184](https://github.com/tixonowar-ui/Symbiosis-V7/issues/184) фиксирует
превышение двух осей PR-size: неизменённый CI-гейт для `0416d63` измерил
+10884/−55 строк кода в 36 файлах и 72 файла всего при лимитах 10000/60;
тесты +10657/−77, документация 386 строк. Предложено отдельным процессным PR
изменить только потолки добавлений кода и общего числа файлов на 15000/90.
Решение владельца не получено, гейт не менялся; полный #171 потребует нового замера.

Весь требуемый #171 ещё не готов. Авторский полный `npm run verify`
прошёл: 163 файла / 3539 тестов, плюс все остальные гейты, в
`reports/171-verify-author-player-final.log`. После разрешения source/size blockers
нужны независимое ревью и свежий прогон на окончательном committed
SHA, затем CI/merge и проверка фактического закрытия issue. Полный авторский
production E2E прошёл: 36/36 без retry, `reports/171-e2e-author-all.log`.
Независимый полный прогон на точном `0416d6351a6f6d91dc93dd07798064439c8b4304`
также прошёл: 163 файла / 3539 тестов и 36/36 production E2E без retry;
HEAD и отслеживаемое дерево проверены до, между и после команд. Evidence —
`reports/171-independent-full-checks-0416d63.md` и соответствующие verify/E2E/revision логи.
Это проверка технического player-среза, а не заключение о полном #171.

Первый CI `41016176184` прошёл checksums, types, lint, format, воспроизводимость
импорта и traceability; один прежний post-save crash-recovery тест превысил
неизменённые 5000 ms (5790 ms), остальные 3538 прошли. CI E2E не запускался.
Исходный failure сохранён в `reports/185-ci-verify-0416d63-failed.log`.
Тест и его fixtures не менялись относительно main. Десять глубоких JS-сравнений
полных SQLite Buffer в новом `network-device-request.test.ts` заменены точным
`Buffer.equals`: сравниваются все байты и длина, snapshots и остальные assertions
сохранены. Один и тот же paired-запуск 28 тестов до/после прошёл: сетевой suite
26192 → 1706 ms, вся команда 26,80 → 6,40 s. Старый crash-recovery тест прошёл
за 1449 → 1273 ms; исходный CI-тайм-аут в этом локальном запуске не воспроизвёлся.
Замер доказывает снижение стоимости матчера, но не единственную причину CI failure.
Логи и JSON — `reports/185-buffer-{baseline,after}.{log,json}`.
Новые source/test изменения требуют свежих полных прогонов на новом SHA. Текущие результаты
не являются разрешением merge или основанием закрыть #171.

### Проверенные части текущего worktree

Это отдельные прогоны разных рабочих снимков, их числа не суммируются в
результат полного verify. Новые изменения после указанного прогона требуют
общего интеграционного гейта.

| Проверка                                     | Фактический результат и evidence                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Local coordinator + projector, ранний снимок | 45/45 в двух suites; `reports/171-network-coordinator-focused.log`, 08:04.                 |
| Projector после уточнений guards             | 37/37; `reports/171-net-projector-focused.log`, 08:07.                                     |
| Core storage/runtime                         | 88/88 в трёх suites; `reports/171-local-runtime-freeze.log`.                               |
| Peer/channel/server lifecycle                | 89/89 в трёх suites; `reports/171-network-lifecycle-focused.log`, 08:08.                   |
| Web, включая source-backed entry и recovery  | 343/343 в семи suites; `reports/171-web-final-entry-regression.log`.                       |
| Production build                             | Прошёл; `reports/171-network-build.log`. Два новых E2E прошли на описанном рабочем снимке. |
| Полный авторский verify                      | 163 файла / 3539 тестов и все гейты PASS; `reports/171-verify-author-player-final.log`.    |
| Полный авторский production E2E              | 36/36 PASS без retry; `reports/171-e2e-author-all.log`.                                    |

Ранний независимый wiring pass находится в
`reports/171-independent-wiring-review.md`: три finding исправлены в
прочитанном scope; исходный shutdown reproducer и отдельный pending WS probe
повторены. Полного независимого verify/E2E и вердикта APPROVE #171 этот
проход не даёт. Авторский полный verify относится к player-контуру;
отсутствующие GM preliminary decisions и source delivery он не заменяет.

После #171 очередь остаётся #172 → #173 → #174 → #113. Арт для #113
подготовлен, прежние ответы владельца о портретах и недостающем арте сохраняются.
Пользователь разрешил последовательные merge; перед каждым merge нужен
независимый прогон и отдельная проверка закрытия выполненной issue.

## История подготовки #182 до merge PR #183

Срез issue #182, ветка `codex/182-campaign-network-foundation`.
База — `03bf13b5b3d56ea04f81659bda7a53aef8e00742`: PR #178 и #180 слиты,
issues #170 и #179 фактически CLOSED/COMPLETED. Независимые проверки базы:
134 файла / 2499 Vitest-тестов и 34 production E2E без retry; CI тоже зелёный.
Это не утверждение готовности нового NET runtime.

### Самостоятельный контракт #182 на этапе подготовки

Инфраструктурная предпосылка отделена от прикладной #171 по контракту:
собственная установка/SQLite и private authenticated Node channel. Критерии
#171 не изменены, её player/GM journey остаётся отдельной прикладной работой.
Черновик PR #181 содержит только прежнюю Phase A; его сменяет отдельный
инфраструктурный PR для issue #182.

- Installation identity и явный startup initializer; network loading read-only,
  без bootstrap/repair в отказавшей команде.
- Actual TCP private handshake/RPC с canonical JSON, обеими identities/nonces,
  точным pinned key, sequence, bounds, deadlines и безопасными ошибками.
- Actual UDP discovery с явной конфигурацией, correlation, duplicates/conflicts,
  byte/offer limits и диагностикой; manual IPv6 locator поддержан отдельно.
- Actual owned FINAL evidence: original checkpoint strings, полный existing replay,
  metadata0 baseline и exact safe DTO; старые pinned metadata сохраняются после edits.
- Immutable campaign birth proof отдельно от current checkpoint/ACTIVE count.
- Миграция 0009: UNBOUND entry/close, immutable receipts, audited retirement,
  TARGET/NONE pointer, known command preflight и 0–3 живых logical tabs.
- Closed standalone client/application codecs, без регистрации NET форм/routes.

[ADR 0067](../adr/0067-private-campaign-network-foundation.md) фиксирует
фундамент; ADR 0066 остаётся предложенным. Application peer executor/carrier,
distributed outbox/request journals, NET UI, GM decisions и полноценный production
сценарий двух browser contexts не реализованы. Это следующий срез #171.

Полный текущий verify/E2E, независимый повтор на committed SHA и CI должны
подтвердиться перед merge инфраструктурного PR; focused-прогоны этого не заменяют.

## История предыдущей Phase A #171

### Состояние на `e5b7f17`

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

## Историческая очередь после #179

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
