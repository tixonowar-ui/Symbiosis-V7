# Однократные характеристики произвольного монстра — #260

Дата авторского состояния: 2026-11-14. Это WIP от поставленного #259/PR292:
main `fe61e291635f30cf0f5437e9692d8f92f896104f`, tree `bfee221e7a2ce1b319bbf9f34a2e9c365eaea5c5`.
#260 ещё открыта; окончательный committed SHA, независимый clean five-stage,
полный CI, protected merge и actual delivery пока не выполнены.
#188/#113 открыты, #261 не начата. Предыдущая #259 действительно закрыта COMPLETED;
её clean5/CI и52 E2E не являются результатами текущей #260.

## Пользовательский контракт и источник

[ADR0077](../adr/0077-gm-entity-source-closure.md), CORE-200/201/214 и
поставленный Atlas1.22/B17 задают один `UI-CMD-MONSTER-STATS-ROLL-ONCE`.
Мастер получает семь независимых натуральных R20 в порядке S,D,M,Z,I,W,C,
без критических цепочек и независимо от режима ручного/автоматического ввода.
После броска базы можно править в пределах1–35. Масса, возраст и базовый HP
не генерируются; действительно не введённые поля остаются пустыми.

Creation:012/005 →018/002 →012;012/002 →019/001 →012 показывает квитанцию.
N+1:017/006 →018/005 →017;017/007 →019/002 →017 показывает свою квитанцию.
Возвраты018/001,003 относятся к012,018/004,006 — к017 и не бросают кубики.
Навигация не может выбрать чужой destination по клиентскому returnForm.
Начальная012 допускает открытие018 с семью пустыми базами. Opening017 копирует
фактическую массу/возраст/HP принятой версии; бросок меняет только семь баз.

ENM018 показывает доступность once-right, диапазоны, текущий ввод и host audit
nonce `generationSeed`. Это непрогнозируемая техническая привязка операции,
не обещание воспроизведения PRNG из seed. Семь `rollGroupId` различны.
ENM019 read-only показывает исходные faces/исходные характеристики отдельно от
текущих исправлений и метаданных. Возврат, просмотр и replay их не подменяют.
Нет PC XP/crit полей или другого RNG workflow.

Только ручное создание CUSTOM_MONSTER и его N+1 получают этот канал.
SENTIENT, включая фактический SYMBIOTIC_MONSTER, SYSTEM и чужие/stale/PLAYER
запросы его не получают. Art upload/clear, боевые экземпляры, XP и генератор
групп остаются за пределами #260.

## Принятый body, pending ввод и квитанция

`monster-stat-roll` shared/domain kernel и host preparation переиспользуют
существующий enemy application/store, sealed ENEMY_AUTHORING causes и QUEUE.
`randomReceiptId` равен существующему owning `receiptId`; второй UUID ledger
не создаётся. Actor/campaign/attempt/origin/revisions и N+1 template/current
version проверяются до свежей генерации/записи. Seed/group strings — audit
привязки, а не публичные entity identities.

Технический nullable draft не становится принятым body автоматически.
Семь bases, масса, возраст и HP валидируются по источнику; нет clamp или
подставленных defaults. Низкий provisional ввод не забывает знания Советника.
Принятие source-valid полного MONSTER_STATS остаётся отдельным действием и
может иметь обычные source-ruled последствия. В частности D1 не объявлен
запрещённым: подтверждённое принятие такого body может забыть ACROBATICS.
До принятия pending D1,019/reopen и отказ зависимых команд знания не меняют.

Один общий predicate сравнивает pending draft с фактически принятыми четырьмя
группами inputs. Открытие018/возврат без изменений не блокирует сохранение
копии. Реальное отличие не позволяет сохранить версию или согласовать состав
до принятия body. Staging/view не могут очистить nonnull draft; только успешный
MONSTER_STATS очищает pending ввод, сохраняя квитанцию/seed/использованное право.
CUSTOM configuration own-choice preview/confirm его не очищает.

Accepted body сохраняет прежнюю закрытую grammar MANUAL/null; origin ROLL_ONCE
живёт отдельно в owning attempt ledger. Никакие поля не добавлены в старые
accepted version/receipt JSON. Новая N+1 попытка копирует механические inputs,
но начинает без материализованного seed и без spent right/receipt предыдущей.
Свой новый seed появляется после открытия018. Отмена не меняет currentVersion
и сохраняет исходную квитанцию в истории попытки.

Known command replay выполняется до fresh prepare. Ответ ROLL содержит сам
исходный семикомпонентный RandomStatsReceipt, даже после Cancel/дальнейшей
навигации. Live/историческая проверка использует фактический earlier prefix,
а не кандидат как собственное доказательство. Saved020 связывает generation
с prefix именно выбранной версии, не с поздней отменённой попыткой.

Migration0024 расширяет child cursor CHECK значениями018/019, не переписывая
applied001–23 или accepted ledger/version rows. Новый context/cause требует
полный настоящий registered24 prefix/name/checksum; удалённая24 не превращает
его в старый schema23. Настоящие исторические21/22/23 остаются читаемыми.

## Целевые доказательства и их пределы

Пакеты и исходные логи находятся во внешнем `evidence-260`, вне репозитория.
Root последовательно прочитал pinned core/context/host/owning/projection/client
и test-only oracle deltas. Ни один промежуточный PASS не переносится на другой
полный набор или новые bytes автоматически.

- Domain/migration:31 tests/2 files; closed aliases/порядок/groups/original faces,
  metadata/null semantics и реальный registry-trigger rollback.
- Shared pending predicate:13 tests. Целевой AUTO owning case сохраняет V1/V2,
  открывает distinct V3/cancel, проверяет14 вызовов native `randomInt(1,21)`,
  ноль на replay/view/reopen и selected V2/V1 prefix после отмены V3.
  MANUAL/negative результаты сохранены отдельно на своих source scopes.
- Creation negative/fault case проверяет strict stale/foreign/origin/return,
  missing24 и достигнутые ledger/cursor SQL markers. При двух fault attempts
  sampler вызывается по семь раз, запись откатывается целиком; следующий
  успешный вызов даёт ещё семь, exact replay — ноль. Это не21 committed faces.
- Дополнительные3 owning cases проверяют реальный SENTIENT symbiotic monster,
  текущий system detail, isolated skills/PNG drift, active local-GM context loss
  и pending D1 с настоящей картой Советника. Context loss не назван сменой роли.
- Genuine delivered259/schema23 fixtures содержат настоящие S/C V1→V2,
  history/current/open attempt и original commands/receipts. Producer работал
  на прежнем5c/treebfee без0024; consumer отдельно проверяет readonly23 inspection,
  append24, physical reopen и exact old receipt replay без RNG. Это не synthetic
  relabel и не LAN/KDF proof; canonical gzip отличается от отдельного physical
  witness только в честно описанной producer области.
- Client proofs используют actual Node host-issued snapshots, actual App и
  ws-client с MockSocket: обе origin controls, invalid36→no-send/сохранённый текст,
  corrected35→closed PATCH, malformed child refusal и6 coherent metadata tamper
  vectors. Это module/intent proof, а не реальная доставка LAN ACK.
- Latest registry cleanup:393 whole-file tests/9 persistence files; отдельно
  11 selected owning tests/6 files и3 selected web tests/2 files. Реальные старые
  fixture bytes/rows/receipts сохранены; explicit23 отличается от latest24 и
  unknown25 после целого1–24 prefix. Полный BIND/lostACK/restart chain выполнен,
  не только его MAX assertion. Current scoped TSC/lint/format прошли.

### Chrome01 — сохранённый отказ

Свежий production build и один two-origin case завершились FAILED:
Playwright duration363,114с, wrapper382,693с, body budget360с.
Оба броска/исправления019/restart и V1 были достигнуты; V2/PLAYER/финальные tails
ещё не были достигнуты. После принятия изменённого MONSTER_STATS существующий
reducer снял composition confirmation. Host вернул ENM017 с `symbiont stage not
confirmed`, а тест пропустил штатное повторное подтверждение NONE.
Ожидание отсутствующего CTA004 началось09:04:40.858Z и длилось277,939с.
Client/host errors пусты, cleanup82,740мс. Это неполный тестовый поток, а не
доказательство медленного успешного NEW или основание увеличить бюджет.

Сохранены весь report/trace/wire,4 PNG и failure screenshot. Исправлены только
действия теста: существующие preview/confirm/FINISH состава и validationErrors[]
перед NEW. Production, assertions прежних проверок, body360с и defaults сохранены.

### Chrome02 — один case, два полных потока

Свежая production сборка539мс. Actual Playwright case125,333с, wrapper131,906с,
одна попытка без retry. Один setup проходит оба origins: реальные пустые семь
баз creation, собственный новый N+1 seed/right, два lost ACK с обычным browser
resume/reconnect,14 raw input checks до ручных35, direct019/return, physical
restart с сохранением правок, V1 и V2, immutable oldV1 rows/receipt и историю.

Фазы: host setup4,006с; initial opening/back17,071с; creation flow33,555с;
version flow42,216с; history/restart/PLAYER16,971с; held raw probes10,332с;
cleanup0,516с. Фазы не являются exclusive CPU time или гарантией4-worker/CI.
360с — конечная индивидуальная аналогия с прежними78,880/100,907с #259 cases;
теперь собственное измерение приведено отдельно. Общие hooks/defaults/workers,
local retry0/CI retry1, job150мин и production timeouts не менялись.

Raw HTML содержит58 intermediate matcher comparisons внутри15 успешных poll
groups и0 вне них; восемь completion tails выполнены по одному разу.
Два обычных ROLL intents равны исходным запросам; каждая обычная reconnect
квитанция совпадает с original. После возврата мастера на GM001 два отдельных
raw probes получают exact receipts и две разные UUID-correlated currentGM001
projections. Эти ответы удержаны harness: это server receipt/current-projection
proof, не применение normal client unsolicited replies. Последние четыре raw
frames в точности равны held replies и отделены от90 обычных frames.

PLAYER:8 реальных frames,4 generic command refusals для двух PATCH и двух ROLL,
отдельный navigation refusal. Восемнадцать проверяемых private values отсутствуют
в доставленных wire/DOM/actual `body.ariaSnapshot()`; это не отдельный axe/a11y audit.
Host/client errors пусты. Root независимо проверил raw/steps/source и4 PNG:
`root-chrome-review22.json`, SHA `e650da3c04ad056f03e4bdcab8d8000120e61d64eba6fba8501efef8d6148f12`.

Две ошибки внешних artifact readers сохранены отдельно с before/diff/hash:
первый считал все raw replays обычными, второй ожидал отдельный ariaSnapshot
step и неверное имя refusal. Коррекции используют доказанный exact held suffix,
actual source call и18 passed comparisons; E2E ради readers не повторялся.

## Что ещё требуется перед поставкой

Официальная traceability, актуальные scoped format/checksums/static bindings и
итоговый размер фиксируются до freeze. Полный авторский verify не запускался.
После независимого полного source review окончательному committed SHA нужны
отдельный чистый `npm ci → import → verify → import:verify → test:e2e`, полный
CI, protected merge и сверка actual main tree/closure. Эти результаты пока
ожидаются. Artifacts/CHECKSUMS/generated, принятые ADR и CI не менялись.
