# Передача контекста — 2026-11-01

## #172 — runtime финального допуска

Ветка `codex/172-campaign-copy-admission` от main `d87d02b` после merge
source prerequisite #199 / PR #200. Предложение A и правило B владельцем
согласованы. Поручение ограничено завершением #172 до merge и остановкой;
Ready/Start и следующий backlog не входят в него.

Добавлены отдельные review/proposal/copy/receipt journals, forward0012,
source-backed пересчёт, GM review/edit/weapon/publish/reject, owner whole-batch
ACCEPT/DECLINE, подготовка реальных вкладок и восстановление. Исходные FINAL,
старые миграции, артефакты и конфигурация проверок не меняются.
Сводка решений — [ADR 0072](../adr/0072-campaign-copy-admission-runtime.md).

Независимое ревью нашло и помогло
исправить публикацию после commit, MENU/receipt recovery, корреляцию draft,
same-vector GM/owner изменения и отдельные revision guards. Production
браузерный прогон выявил неверный OPEN revision delta, сравнение JSON по
порядку полей и устаревшую live capacity после GM publication. Исправления
проверяются теми же воспроизводителями. Отдельно прочитаны backend authority
и storage, игровая механика и browser/host корреляция. Области чтения и
окончательные результаты прогонов публикуются в PR. Прежние прогоны #199/#171
не заменяют проверки runtime #172.

Перед merge обязательны полный авторский verify/import:verify/fresh build/
все E2E, независимое ревью с явными границами и отдельный полный прогон
финального committed SHA, зелёный CI и совпадение дерева merge с проверенным.
Размер всего diff, включая новые файлы, проверяется тем же классификатором
CI. Исключение PR #185 на эту задачу не распространяется.
Владелец отдельно согласовал #201: только runtime PR #202 получает пределы
20000 добавленных строк и 55 файлов кода. Процессный PR меняет лишь это
исключение; финальные SHA, независимые заключения и результаты всех gates
фиксируются в [PR #202](https://github.com/tixonowar-ui/Symbiosis-V7/pull/202).

Полный браузерный прогон также выявил сохранение новых GM capabilities при
выходе в APP-001 после отмены кампании. Выход снимает весь GM-набор, а
запрет GM capabilities в обычном shell сохранён и проверяется для каждого ID.

Независимый полный прогон `9399f7b` прошёл verify (4556 тестов) и воспроизводимость
319 файлов, но E2E дал 41/42: повторный SUBMIT после REJECT не доставил NET-005
за 5 секунд. CI того же SHA отдельно дал шесть превышений времени; эти результаты
не считаются финальным допуском. Trace подтвердил запись заявки и локального ACK.
Фазовый замер следующего повтора: 4413 мс на SUBMIT, включая 235 мс повторного
чтения admission overlay перед отправкой. Квитанция и overlay теперь используют
одну полностью проверенную историю в той же SQL-транзакции; такой же повтор убран
из owner poll. Проверки целостности, порядок публикации и сетевые дедлайны сохранены.
Этого недостаточно для обещания доставки за 5 секунд: повторные traces показали
задержку и до локального ACK. Два ожидания удалённого результата в прежнем GM E2E
используют существующий бюджет операции (transfer 30 с + RPC 10 с, ADR 0066),
сохраняя все проверки исходных receipts и состояния. Это не гарантия времени отклика.
После этого исправления обязательны новые полные gates окончательного SHA.

## #199 — source prerequisite финального допуска #172

Текущая ветка `codex/199-admission-source-closure`, база main `10eb5b1` после
merge #185. Владелец одобрил #199 A полностью и B: PROPOSED не занимает места;
принятый персонаж с неподтверждённой массой/имуществом занимает место в лобби.
Новая поставка Atlas 1.7 и ADR 0071 закрывают источники без изменения правил,
Runtime Pack и прочих двадцати артефактов. Generated пересобран импортом.

Пройдены import и validate: 376 форм, 1694 перехода, 109 workflow, 2446 QA,
1258 CTA, 20 310 seed rows. Добавлены полные object/Markdown seals, mutation
tests и точная совместимость B0→B1, B0→B2, B1→B2. Реальные fixture patches
восстанавливают каждую из трёх поставок без подмены механических каталогов.
Независимое чтение исправило границу MASTER_IMPORT, typed weapon grant,
полный diff и зеркала нового OPEN. Окончательный source-кандидат не имеет
обнаруженных блокеров ревью. Runtime #172 этой поставкой не закрывается.

Промежуточный full verify: 4238/4242, одно несогласованное workflow/transition
зеркало и три превышения прежнего 5-секундного лимита (FREE AUTO/EEL,
campaign recovery, connection facts). Зеркало исправлено. Два host reproducers
прошли в повторных suites; campaign recovery отдельно прошёл за 4772 ms,
что не доказывает устранение разброса. Настройки/таймауты не менялись.
Новые mutation tests сохраняют полный реальный Atlas, копируя только
мутируемые rows; последнее узкое source-подтверждение — 31/31. Эти результаты
сохранены как история и не заменяют обязательный окончательный полный gate.

Следующий full verify: 4242/4243, остался campaign recovery 5346 ms. Фазовый
замер изолированного случая: подготовка настоящих B0 файлов 1929 ms,
суммарно до последней проверки 4723 ms. Для двух Atlas-delivery случаев
только создание отдельной файловой fixture вынесено в beforeEach. Загрузчики,
обновление B0→B1, CREATE/reopen/replay, SQL snapshots и точные receipts
остались внутри it; таймауты, workers и реальные источники не изменены.
Независимый reviewer подтвердил сохранение всех проверяемых границ.

Обязательные gates: полный verify, import:verify, все 38 production E2E;
отдельное независимое чтение и полный прогон окончательного SHA, затем CI
и squash merge #199. Их итоговые SHA, counts и CI фиксируются в PR поставки.
После него — сквозная реализация #172 с такими же gates.
Старые снимки ниже сохранены как история, их результаты не являются gates
для текущего изменения. Несвязанная отложенная работа #186 не затронута.

## Полный сценарий #171 / PR #185 — перед финальными gates

Ветка `codex/171-device-request-flow` интегрирована с main `7568488a13`:
#190, Atlas 1.6 / #177 и shared source contracts #195 слиты. Старые migrations
0009/0010 сохранены. Подключены полный player NET-контур, GM queue
CMP-006↔NET-017, отдельный draft, preliminary decisions, owner-only delivery,
restart/replay и forward0011. Campaign birth, original SUBMIT receipts,
local FINAL и исторические baseline IDs не переписываются. Copies, seats,
capacity reservations, final admission и Start не создаются.

На промежуточном ca2a7e2 авторские normal verify (165 файлов / 4209 tests)
и все38 production E2E прошли без retry. Независимый verify завершился
4207/4209: approved-Atlas recovery занял5245 ms и новый connection-facts test
5634 ms при прежних лимитах5000 ms. CI того же SHA завершился зелёным только
после одного E2E retry: первый GM run не доставил owner REJECT за5 s. Это
не принято за достаточный gate. Логи, trace и durable-status сохранены.
Контрольная пара полного campaign suite прошла14/14 на main756 и ca2;
причина разброса старого Atlas test не объявлена устранённой.

Убраны доказанные повторные чтения уже проверенной request/key строки внутри
одной синхронной операции и тройная сериализация materialized history tails.
Последние по-прежнему требуют SHA исходных байтов и точного совпадения с
каноническим результатом полного replay. Все события, ownership, индексы,
CAS и post-write guards сохранены. На одинаковых116 чтениях истории три
сравнения заняли1938→595 ms; общий разброс времени не приписан целиком этой
замене. Пятнадцать проверок на реальных независимых SQLite copies охватывают
все пять tail-таблиц: rehashed noncanonical/extra-field JSON и неверный SHA
отклоняются без записи.

Отдельно исправлена потеря owner update после сбоя отправки или доставки
другому собственному соединению. Для каждого соединения хранится только
последнее успешно отправленное публичное представление NET-005, связанное
с его scope/context. Точный token меняется после успешного send; тихий poll
повторяет недоставленное состояние без нового receipt/SQL события. Свежий
проверенный v2 bundle используется синхронно, через await передаётся только
boolean; legacy/BIND и missing-channel recovery сохраняют полный путь.
Actual regression подтверждает два собственных context и один failed send
с неизменными обеими SQLite, SUBMIT receipt и reconnect count.

После этих исправлений node/web types, scoped lint,31 store cases и три
owner-publication cases прошли. Обычный fresh-build browser run прошёл все
четыре NET сценария без retry: manual/restart37.7 s, полный GM46.4 s,
selected-CANCEL25.2 s, QR/batch26.4 s. Предыдущий plain GM failure на ACCEPT
и последующие диагностические запуски также сохранены в reports; они не
заменяют финальные gates. Последний committed SHA требует normal full
verify, всех38 E2E, отдельного независимого прогона и зелёного CI. Таймауты,
workers, byte assertions и реальные fixtures не ослаблялись.

Первая полная проверка c1aa195 прошла types/lint/format и 4198 из 4204 tests.
Шесть failures были сверены с новым контрактом: три старых migration consumers
ожидали10 вместо forward11, три CMP-006 проверки использовали прежний action
helper/нулевой current vector. Исправления сохраняют прежние rows/bytes,
exact zero CREATE birth и отдельный current view. Исходный полный лог сохранён
в `reports/171-integration`; следующий final SHA требует нового полного прогона.

Окончательный бюджет от main `7568488a13` и проверяемый SHA записываются в
`reports/171-integration/budget-final.json`. Владелец разрешил 20000 additions
кода только для PR #185 (смёрженный PR #198 / #197); прочие оси неизменны.
После успешного merge #185 работа останавливается. #186 и backlog не продолжаются.

Ниже сохранена история зависимостей. Её старые будущие шаги не отменяют
остановку после #185 и не описывают актуальную полноту реализации.

## Текущее указание владельца и процессный срез #197

Владелец разрешил 20000 добавленных строк кода **только для PR #185** и
потребовал остановиться после его успешного merge. #197 материализует это
смёрженным PR #198; default15000, остальные семь порогов и все проверки
сохранены. Это не завершение #171 и не разрешение merge частичной реализации.

#195 фактически закрыта после PR #196, squash `f7e6ade`; дерево совпало с
проверенным `9e4aab0`. Author и отдельный independent verify прошли 151/3774,
все34 production E2E прошли без retry; CI первой попытки зелёный. Первоначальный
независимый timeout старого campaign recovery сохранён: после 28/28 парных
main/PR cases новый полный независимый прогон прошёл. Причина разброса времени
не объявлена исправленной; runtime/fixtures/timeouts/workers не ослаблялись.

Полный #185 интегрировал source contracts. Независимые HOST/persistence/WEB
read maps и исправления реальных recovery/GM/client defects сохраняются в
reports. Окончательные авторские и независимые full verify/E2E и CI требуются
на последнем committed SHA; прежние результаты относятся к своим версиям.

Незавершённая #186 сохранена в ветке `codex/186-npc-enemy-source-delivery`,
точечном stash `3a880f351943e72a8449b119bfa3579d3651d8a9` и ignored reports.
Там нет полного import/verify и устранения source QA mirror finding; это
не поставка. Продолжение #186 и следующих issues после #185 не разрешено
текущим указанием. Следующие разделы — исторические снимки подготовки.

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
