# Передача контекста — 2026-10-30

## Application integration #171 / PR #185 — рабочий снимок

Ветка `codex/171-device-request-flow` интегрирована с main `f7e6ade3d0`:
#190, Atlas 1.6 / #177 и shared source contracts #195 слиты. Старые migrations
0009/0010 сохранены. Подключены полный player NET-контур, GM queue
CMP-006↔NET-017, отдельный draft, preliminary decisions, owner-only delivery,
restart/replay и forward0011. Campaign birth, original SUBMIT receipts,
local FINAL и исторические baseline IDs не переписываются. Copies, seats,
capacity reservations, final admission и Start не создаются.

Авторские node/web typecheck проходят. Focused проверены реальные SQLite/TCP
review, CANCEL race и старый schema10 SUBMIT→forward11→lost-first-BIND-ACK.
Последний request-store/peer run — 57/57; client — 64/64. Production browser
проходит исходный manual-address→restart→CANCEL, QR batch, а также owner CANCEL
с очищением выбранной строки/причины GM. Новый GM accept→restart→reject→safe
return→повторный SUBMIT прошёл полностью (55.3 s на весь сценарий). Устранены
повторные synchronous folds одной уже проверенной операции; подписка owner
polling теперь следует успешно опубликованной NET-005 и снимается после выхода.
Проверки source/CAS после private await сохранены. Полный verify/E2E и
независимые финальные gates на окончательном committed SHA ещё требуются.
Таймауты, workers, byte assertions и fixtures не ослаблялись. Raw traces,
phase measurements и пределы выводов сохранены в `reports/171-integration`.

Текущий замер тем же CI classifier от `f7e6ade3d0`: code37 +16195/−91,
tests34 +14472/−59, docs428, artifacts0, всего77. Это промежуточные числа,
финальные измеряются после исправлений. Владелец разрешил **20000 additions
кода только для PR #185**; исключение закреплено смёрженным PR #198 / #197, прочие
пороги сохраняются. По последнему прямому указанию пользователя после успешного
merge #185 работа останавливается. #186 и дальнейший backlog сейчас не продолжаются.

Ниже сохранён исторический source-contract handoff #195; актуальная runtime
готовность описана выше. Его старые будущие шаги не отменяют остановку после #185.

## Текущий срез #195

База `ecd398458cbbc9eb4a146953930b452cb7579406`: #190 / PR #193 и #177 /
PR #194 смёржены, обе issues фактически CLOSED/COMPLETED. Exact tested source
SHA #177 — `5e929973078314cfeff2cd5ab81eea045ff753b5`; squash tree совпал.
Независимый verify 150/3739 и все 34 production E2E без retry прошли на этом
SHA. Финальный CI зелёный; исходные неудачные попытки с таймаутами прежних
SQLite suites сохранены. Причина разброса времени не объявлена доказанной,
проверки/fixtures/таймауты/workers не ослаблялись.

Поставка Atlas 1.6 имеет 376/1688/108/2445 и 1252 CTA; seed 114/20302/9.
Exact current baseline B1 —
`sha256:0fb6bf63fa399d7715fa75ae251dce83d3cdff670688bb025228756a2478343f`.
Исторический B0 и его bytes/receipts сохраняются по ADR 0068; 20 non-Atlas
artifact paths и Runtime Pack не менялись. Preliminary request decisions
отделены от final admission ADR 0069.

#195 выделяет самостоятельную библиотеку shared DTO/standalone codecs перед
runtime #171. Точные player network projections, самостоятельная 12-полевая
GM NET-017 projection, drafts, applied/current envelopes, payloads и закрытые
14-полевые receipts соответствуют source. GM summary checksum означает все
canonical export bytes (checksum+LF); player candidate checksum сохраняет
FINAL sourceChecksum. [ADR 0070](../adr/0070-network-request-source-contracts.md).

Core wire v3 families, executable capabilities, host/routes, SQL/migrations и
приложение в #195 не включаются. Source-only tests проверяют строгую форму,
согласование, изоляцию player/GM и отказ прежнего core decoder от новых families.
Результаты author/independent проверок и точный SHA фиксируются в PR и
`reports/195-*`; перед merge требуются полные verify/E2E и зелёный CI.

Первый author verify прошёл 151/3773. Независимое чтение выявило отражение
неизвестного приватного имени поля при отказе encoder JSON prewalk на
не-JSON значении. Узкое исправление сохраняет отказ и переносит его путь на
`$`; регрессия охватывает четыре encoders и пять типов значений. После
исправления нужны новые полные проверки окончательного committed SHA.

PR #185 остаётся draft до завершения полного #171. #177 и #190 больше не
блокируют реализацию; source contracts #195 интегрируются до финальных проверок.
Нужно закончить GM queue/decisions, actual owner recovery, two-installation
journey и независимо проверить окончательный committed SHA. Частичный player
срез не закрывает #171. Новых решений владельца сейчас не требуется.

Далее #172 → #173 → #174. Для полного #113 цепочка #186 → #187 → #188:
ребазировать source delivery на Atlas 1.6 с сохранением NET contracts, затем
полные NPC/ENM формы и общий GM ingress. Арт уже подготовлен; source approvals
не означают готовность runtime.

## Исторический срез #190

Ветка `codex/190-verified-baseline-lineage`, база
`fe5823d960a2f0bd4aec70203d0415917e2606b4`. PR #189 (#184) смёржен после полного
независимого чтения, 24 classifier probes, verify 148/3199 и 34 production E2E
без retry; CI зелёный. Политика 15000/90 применена в draft #185 коммитом
`975bb6b`, его авторский verify 163/3539 и actual size gate прошли, #184 закрыта.

PR #192 (#191) также смёржен после независимого полного verify 148/3199,
34/34 E2E без retry и зелёного CI. Ровно 19 binary assertions заменены на native
с сохранением всех байтов/длины, остальных checks и таймаутов. Парный набор
77/77 прошёл до/после, 33,84 → 2,74 s; единственная причина исходного CI timeout
не объявлена доказанной. Правка подтянута в #185 коммитом `f9a6a53`, его новый
авторский verify 163/3539 прошёл; #191 закрыта. Final application checks остаются
обязательными после завершения GM runtime и source/lineage integration.

Source audit #177 выявил необходимость #190: полный manifest ID меняется даже
при Atlas-only поправке. Новый loader-owned исторический context сохраняет
старые bytes и baseline ID, проверяя конкретную разрешённую пару B0/B1,
полный набор путей, 20 non-Atlas строк, 24 catalog source inputs и PASS tuple.
Нельзя разрешить исторический B0 через произвольный будущий B2, структурный
clone context или изменённую механику. Собственные current документы B2
сохраняют прежний current validation path.
[ADR 0068](../adr/0068-verified-artifact-baseline-lineage.md) описывает
контракт; current filesystem/TOCTOU остаются точными, SQL migration не нужна.

Постоянный fixture воспроизводит точные старые/новые Atlas bytes компактным
patch и проверяет SHA. Cold Node-процессы проверяют old export/archive/candidate
и SQLite replay; отдельные campaign регрессии сохраняют CREATE receipt после
reopen и запрещают hot-swap после preflight. Результаты focused/full/independent
проверок записываются в `reports/190-*` и PR; перед merge требуются полный
verify, все production E2E, отдельный независимый прогон на committed SHA и CI.

Артефакты в main остаются Atlas 1.5; готовый кандидат 1.6 для разрешённого #177
сохранён в `reports/issue-177-delivery` (artifact diff 1022 строки). После #190
нужны его новая guard-поставка и импорт; application-only peer/SQL/discovery
callers интегрируются при завершении #171. Approval #177/#184/#113 и полный
срез 31 формы подтверждены владельцем; повторное согласование не требуется.

На CI #185 коммита 975bb6b один прежний AUTO Advisor test превысил 5000 ms,
остальные 3538 прошли, E2E не запускались. Исходный лог —
`reports/185-ci-975bb6b-failed.log`; диагностика остаётся в #171. Это не failure
принятого process PR #189 и не разрешение merge неполного application PR.

Далее: #190 → #177 → завершить #171 → #172 → #173 → #174. Мастерский срез
#113 разбит на #186 → #187 → #188, с общим CMP-007/GM-001 ingress; его source
поставка выполняется поверх #177 и не наследует Atlas-only compatibility
для новых art artifacts автоматически. Ни partial #185, ни asset delivery
не закрывают соответствующих родительских issues.

## Исторический снимок инфраструктуры #182

Срез issue #182, ветка `codex/182-campaign-network-foundation`.
База — `03bf13b5b3d56ea04f81659bda7a53aef8e00742`: PR #178 и #180 слиты,
issues #170 и #179 фактически CLOSED/COMPLETED. Независимые проверки базы:
134 файла / 2499 Vitest-тестов и 34 production E2E без retry; CI тоже зелёный.
Это не утверждение готовности нового NET runtime.

## Текущий самостоятельный контракт #182

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
