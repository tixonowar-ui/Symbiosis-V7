# Передача контекста — 2026-10-30

## Текущая поставка #177

Ветка `codex/177-request-review-atlas`, база
`24c726c91ffe760802c690ad382c21e84782f923`. PR #193 смёржен; #190 фактически
CLOSED/COMPLETED. Squash tree совпал с независимо проверенным `6736692`.
Независимый verify 150/3211 и 34/34 production E2E без retry прошли на точном
SHA. Первый CI timeout неизменного AUTO Advisor разобран без ослабления
проверок; paired 280/280 main/PR прошёл, один повтор CI дал 3211/3211 и 34/34.
Единственная причина первого таймаута не доказана; логи обеих попыток сохранены.

Разрешённые JSON/Markdown Atlas 1.6 материализованы побайтово из проверенного
кандидата #177. SHA совпадают с successor pins ADR 0068; 20 non-Atlas файлов
не меняются. Паспорт: 2026-10-30, schema 1.2.0, 376/1688/108/2445 и 1252 CTA.
Исторические author semantic digests сохранены по прежним ADR, фактическая
целостность задаётся санкционированными checksums.

Новый [ADR 0069](../adr/0069-device-request-review-atlas-amendment.md) разделяет
preliminary request review #171 и final admission #172. Новые importer и
standalone Markdown guards защищают точные изменённые контракты, все зеркала,
закрытые composites, CANCELLED selection-clear и узкую PAUSED ingress policy.
Финальные NET-018–022/027/workflows/QA сохранены. Generated пересобирается
только importer; результаты import/reproducibility/focused/full/independent
проверок записываются в PR и `reports/177-*`.

Авторский import и import:verify прошли: 319 файлов с одинаковыми путями/SHA,
включая media и seed 114/20302/9. Focused Atlas/Markdown/seed/lineage проверки
прошли 835/835. Независимый authority probe выявил и после исправления отверг
32/32 подмены roles/route/authority четырёх форм; source bytes не менялись.
Полный final-SHA verify/E2E и CI всё ещё обязательны перед merge этой поставки.

После полного прогона source expectations NET-005/общих counts обновлены точно
по поставке; 86/86 mirror cases прошли. Реальный CREATE hot-swap timeout
5070/5000 ms исследован без изменения лимита: приватное повторное использование
одной сверенной Atlas byte pair в test fixture сократило целевой case в парном
измерении 3276→2468 ms (оба campaign набора 14/14). Полные данные и production
reloads сохранены, фактические исходные/итоговые SHA проверяются каждый раз;
каталоги не кэшируются. Цена пары около 45 MiB Buffer data, peak RSS не измерен.
Новый warm-cache corruption refusal и cold-process replay прошли 11/11.
Единственная причина исходного timeout этим не объявляется доказанной.

Коммит поставки `37c7c38` прошёл author verify 150/3739 и CI с 34 E2E, но
независимый verify получил два старых timeout: server closed-command 5049 ms
и local-tab closure/replay 6937 ms. Этот failed gate сохранён; E2E после него
не запускался. Все 33 оставшихся `serialize().toEqual(Buffer)` заменены
эквивалентным native `.equals` в четырёх test files: 176 expect и 65 serialize
сохранены, обратная замена byte-identical. Парные реальные наборы 124/124
прошли за 59.87→37.17 s, отдельные 4/4 — 4.90→0.65 s; local-tab suite
59.17→0.88 s, целевой closure case 2711→154 ms. Причина отдельного server
timeout не объявляется доказанной. Перед merge нужны новый committed SHA,
свежие author/independent verify, все production E2E и CI этого нового SHA.

PR #185 `f9a6a53` имеет зелёный CI (3539 tests, 36 E2E), но остаётся draft:
не реализован GM runtime и не интегрированы application-only callers #190.
Никаких новых решений владельца для продолжения не требуется. После merge
#177 подтянуть обе предпосылки, завершить GM journey и повторить независимые
полные проверки final SHA; только затем закрывать #171. Далее #172 → #173 →
#174 и source/runtime цепочка #186 → #187 → #188 для полного #113.

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
