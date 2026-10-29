# ADR 0063 — Восстановление, локальный лист, варианты и экспорт

- **Статус:** Принято
- **Дата:** 2026-10-30
- **Дополняет:** ADR 0012, 0018, 0025, 0030, 0032, 0033, 0042 и 0062

## Контекст и нормативные границы

CHR-026, APP-009, CHR-039, CHR-040 и APP-010 завершают локальный контур
J-CHAR-CREATE. Workflow-команды LOCAL-CHECKPOINT-RESTORE,
CHAR-LOCAL-METADATA-PATCH, CHAR-VARIANT-CREATE и CHAR-EXPORT уже поставлены.
AQA-015 разрешает после финала менять только имя, описание и арт; вариант
получает новый UUID и копирует только эти три поля. DGM-CHARACTER содержит
путь FINAL → VARIANT → DRAFT. Исходный FINAL при создании варианта не меняется.

ADR 0025 хранит одну полную версию checkpoint, а не историю для отката.
Повреждение полного snapshot, его SHA, builder equality или текущей строки
означает UNRECOVERABLE. CHR-039 предоставляет только просмотр и четыре
подписанных возврата; команды активации ветки на нём нет. APP-009 не
восстанавливает финальный лист CHR-040 как незавершённый мастер создания.

Далее явно принимаются технические решения для пробелов хранения, формата
и выбора записи. Они не приписываются поставленному атласу и не вводят
игровых величин, нового outer protocol или campaign runtime.

## 1. Владелец и выбор записи

Обычная библиотека сохраняет `APP-004.localOwnerIdOrNull=null` по ADR 0030/0032.
Её настоящий владелец — tagged key `{kind:"device",id:storedDeviceId}`.
Private binding фиксируется при создании native/variant строки; существующие
строки связываются только с уже сохранённой identity устройства. Если строки
есть, а identity ещё не инициализирована, автоматическое присвоение запрещено.
Reset устройства не перепривязывает прежние данные новому device ID.

Для PLAYER_LOCAL в APP-010 `activeLocalOwnerId` представляет scalar ID этого
эффективного device-owner. Это не acknowledged localOwner, HOST_LOCAL_CANDIDATE
handoff или campaign authority. Guards проверяют tagged owner, сохранённую
привязку и подтверждённый player-local context; клиентский UUID сам по себе
прав не даёт. Настоящая acknowledged-owner ветвь остаётся за своим handoff.

В APP-004 нет отдельной CTA открытия существующей строки. Новый технический
путь использует существующий addressable-route intent с выбором ID из
подписанного списка записей. Хост проверяет текущую библиотеку, владельца,
ревизию и lifecycle, затем назначает CHR-026, CHR-040 либо CHR-001 для
provisional варианта. Это не переиспользование create CTA и не URL authority.
Новые primary action IDs не создаются. Контекст cache inspection также
связан с текущим draft/checkpoint и одним допустимым origin/return.

Scope также фиксирует correlation ID конкретного входа (command/navigation),
поэтому просмотр кэша и последующее сохранение того же игрового checkpoint
не смешивают свои presentation revisions. Повтор того же входа использует
его прежний scope; refresh выбирает точный persisted cursor.

## 2. Изолированный post-save aggregate

FINAL `local_character`, creation payload, checkpoint, тройка ревизий и все
creation/random receipts остаются побайтово неизменны. Metadata хранится
отдельным append-only рядом версий. Ревизия 0 выводится из проверенного
финального snapshot; каждая правка сохраняет ровно следующую версию и
ссылку на предыдущий hash. Допустимы только name/description/art.

Post-save имеет собственный persisted revision/presentation scope с
tagged binding: DRAFT связывает owner/character/checkpoint ID, revision и SHA;
FINAL — owner/character/final snapshot ID/version/SHA; VARIANT — owner/UUID
и birth receipt/hash. Диагностический DRAFT binding содержит только реально
прочитанные headers, nullable checkpoint facts и их fingerprint, явно
не является valid snapshot и не разрешает restore. Он владеет ревизиями
metadata, local variant/export/recovery journal и подписанным назначением
026/039/040/APP-009/APP-010. Навигация не меняет game state. Export не меняет
источник. Journal связывает exact request, owner/source context, receipt и
точный результат для replay. Overflow и stale revision отвергаются до записи.

Head начинает с проверенной base-тройки. Metadata patch и создание варианта
дают state+1/projection+1, visibility+0 в этой области. Export, SAVE_VALID_DRAFT
и RESTORE не меняют тройку: последняя команда удаляет только доказанный
незавершённый intent и возвращает точный creation vector. Навигация меняет
только projection+1. Exact replay, отказ и rollback
не меняют ни одну ревизию; canonical no-op metadata patch отклоняется.
Library revision повышается только при действительном изменении состава
или metadata отображаемых записей; replay и просмотр дают +0.

Для metadata имени/описания/арта отображаемой записи это явно заменяет
metadata-only строку матрицы ADR 0032: обновление видимого содержания даёт
library revision +1 даже без смены bucket. Прочие изменения payload внутри
того же bucket сохраняют прежнее правило +0.

Restore receipt связывает исходные scope ID/revisions/binding, target
owner/entity, checkpoint ID/revision/SHA, resume form и точную target
creation revision vector. Только совпавший pending restore принимает один
такой receipt, затем ровно его destination snapshot и закрывает старую
область. Replay/reconnect сначала возвращает тот же receipt, затем snapshot.
Непрошенный snapshot, чужой receipt, другая correlation, target или вектор
не разрешают смену scope. Обычный stale/out-of-order guard не получает
общего исключения для меньших ревизий.

Точный cursor может ссылаться на committed RESTORE command. Его запись,
квитанция и удаление intent входят в один SQL commit. Поэтому обрыв до
доставки или потеря клиентской RAM не оставляют cursor со старым tail hash.
Каждый следующий действительный checkpoint/triple update атомарно закрывает
этот receipt cursor; read/no-op не закрывает. Reconnect сначала доказывает
целостность cursor/journal и целевого полного checkpoint, затем публикует
его подписанный экран, включая только подтверждённые слои (CHR-031).

## 3. Provisional вариант и первый IDENTITY checkpoint

Одна транзакция создаёт настоящий `local_character` со state VARIANT,
новым UUID, тройкой 0/0/0 и exact tagged pre-identity envelope. В нём только
скопированные name/description/art и ссылка на immutable birth receipt.
Возраст, пол, масса, характеристики, навыки, симбионты, имущество, броски,
checkpoint и creation skill/symbiont presentation отсутствуют. Отдельный
post-save navigation scope допустим только с точным birth binding и
атомарно закрывается при инициализации. Библиотека продолжает читать
настоящие persistent rows, как требует ADR 0032.

Это узкое дополнение ADR 0033 к отсутствию SQLite row до IDENTITY и явная
замена матрицы ADR 0018 только на этой границе инициализации:
provisional row резервирует идентичность, но ещё не является полным игровым
черновиком. Специальный initializer доказывает state VARIANT, exact envelope,
birth journal/owner/hash, нулевую тройку и отсутствие checkpoint/creation presentation.
Затем в одном BEGIN IMMEDIATE он создаёт обычный DRAFT IDENTITY payload и
первый checkpoint revision 0 с исходной тройкой 0/0/0. Начальная игровая
ревизия определяется этой инициализацией; birth journal остаётся отдельно.

Обычный first-create по-прежнему требует отсутствующую строку. Обычный
DRAFT update по-прежнему увеличивает stateRevision. Специальный initializer
не принимает настоящий созданный draft или другой lifecycle, повторное
потребление либо чужой birth receipt. Exact replay завершённого IDENTITY
возвращается через прежний identity receipt.

## 4. Последняя полная версия и отдельный intent

Recovery inspector сначала проверяет единственный полный checkpoint через
persistence и domain proof; подписанный resume берётся из этой версии.
Отсутствие или повреждение даёт diagnostic без выдуманных ID/destination.
Ни первая ветка, ни URL, ни последняя строка массива не выбирают authority.

Положительный corrupt-tail сценарий получает отдельный non-authoritative
intent envelope с owner/checkpoint/base revision/base SHA и intent SHA.
API позволяет сохранить его после preflight до основной транзакции и
удалить вместе с успешным commit. В этом срезе producer подключён только
к явному recovery fixture; штатные wizard writers продолжают сохранять
атомарные целые checkpoints без отдельного intent. После
обрыва inspector доказывает совпадение base с полной версией и отсутствие
committed receipt для intent. Restore атомарно исключает такой хвост и
публикует один receipt. Только эта граница даёт corruptTailIgnored=true.
Неизвестный owner, mismatch base или corrupt full version хвостом не считаются.
SQLite/WAL не интерпретируются как журнал незавершённых игровых команд.

До commit preview остаётся READY с corruptTailIgnored=false. Receipt после
фактического удаления повреждённого intent несёт corruptTailIgnored=true и
restoreStatus=CORRUPT согласно отображению CORRUPT_TAIL_IGNORED из ADR 0025;
это диагностический успешный restore целого checkpoint. Без такого хвоста
receipt несёт RESTORED/false. Повторная доставка проверяет immutable receipt
и тот же полный checkpoint, а не требует заново наличия уже удалённого tail.

## 5. Неизменяемые версии кэша

Legacy branchCacheEntries/hash в исторических receipts не меняются.
Новый manifest выводится из проверенной истории, включая branch states
ADR 0062 и их подтверждённые версии. Каждая entry связывает owner,
логическую ветку, immutable payload/hash, принадлежащие ей receipts и
реальную savedAtRevision. Изменившееся содержимое получает новую version
identity; прежний UUID не обещает вечный hash изменяемого объекта.

`savedAtRevision` — `receipt.result.draftRevision` первой подтверждённой
записи данной версии, не индекс массива и не presentation revision.
Payload фиксируется после domain-валидации исходного receipt/replay.
UUID версии — UUIDv8 из первых 16 bytes SHA-256 canonical JSON
`["SYMBIOSIS_CACHE_ENTRY_V1",ownerId,logicalBranchId,payloadHash,savedAtRevision]`
с установленными version/variant bits. Порядок manifest: logicalBranchId,
savedAtRevision, UUID; строки сравниваются по UTF-16 code units.
Hash manifest покрывает canonical JSON
`{schemaVersion:1,characterId,entries}` с domain separator
`SYMBIOSIS_CACHE_MANIFEST_V1\n`.

Просмотр не выделяет случайные ID, не пишет игровой кэш и не вызывает sampler.
Manifest hash отделён от checksum полного checkpoint и от legacy hash.
Selected entry определяется подписанным origin/current branch и проверенной
версией. CHR-039 не активирует entry и не меняет её payload/receipts.

## 6. Версионированный файл и безопасная проекция

Export имеет `format:"SYMBIOSIS_CHARACTER_EXPORT"`, `schemaVersion:1`.
`baselineVersion="sha256:" + SHA256` точных bytes проверенного
`artifacts/CHECKSUMS.sha256`; это content-addressed версия реального
поставленного baseline. Provenance дополнительно содержит проверенные
registryVersion/catalogVersion/builtAgainstTuple из runtime contracts,
source UUID/snapshot ID, metadata revision и source checksum, без Rule IDs.
Export/variant source привязан к конкретному
final snapshot и metadata revision; устаревший envelope отвергается.

Это правило относится к новой команде. Exact известный commandId сохраняет
свою immutable receipt, прежний UUID варианта или bytes экспорта даже после
следующей metadata-версии. Для доставки хост строит временное read-only
представление из receipt и проверенной версии metadata history с её прежней
тройкой/form. Durable head и текущий cursor не откатываются. Подписанный safe
return открывает новый scope с актуальной metadata; новая команда из старого
envelope проходит обычные stale guards и не получает исключения replay.

Player DTO строится по явному allowlist: identity, механика, именованные
навыки/симбионты/узлы, имущество, runtime и собственные receipt facts.
Внутренний checkpoint, Rule IDs, learnedNodeRefs и source/availability trace
не пересылаются целиком. Candidate/campaign copy IDs не выдумываются.

DTO содержит format/schemaVersion/baselineVersion, sourceUuid,
sourceSnapshotId, sourceKind, ownerContext, metadataRevision, metadata,
mechanicsSnapshot, creationRandomReceipts, provenance и checksum.
Canonical JSON рекурсивно сортирует object keys по UTF-16 code units,
сохраняет порядок массивов, применяет JSON.stringify без пробелов;
нефинитные числа и undefined отвергаются, -0 записывается как 0.
Checksum — SHA-256 UTF-8 canonical DTO без единственного верхнего checksum.
Download bytes — UTF-8 canonical DTO с checksum и одним завершающим LF,
без BOM; их отдельный SHA хранится в receipt. Нет fresh timestamp/UUID.
Клиент скачивает точные UTF-8
bytes/text, не пересериализует объект и не инициирует второй download на replay.

## 7. Отдельный GM archive export fixture

PLAYER_LOCAL/LOCAL_FINAL и GM_ARCHIVE_EXPORT/COMPLETED_CAMPAIGN_COPY —
закрытый union. Для GM требуются настоящий persisted IMMUTABLE_ARCHIVE,
ARCHIVED copy, проверенный snapshot и trusted sole-GM authority reader.
Origin/return CMP-012 не меняют роль. Вариант GM-ветви недоступен.

Issue #156 явно разрешает export fixture: production E2E проверяет этот
adapter на реальном SQLite source и тестовом trusted reader. Campaign runtime
не создаётся. Без настоящего reader/source/capability runtime CTA отсутствует.
Неизвестное opaque campaign payload не объявляется валидным snapshot.

Технический exchange envelope fixture в payload копии имеет ровно
`{kind:"COMPLETED_CHARACTER_EXPORT_SNAPSHOT",schemaVersion:1,exportDocument}`.
Вложенный документ проверяется по закрытой безопасной схеме, baseline,
canonical checksum и lineage исходного UUID. Реальные campaign/copy IDs,
IMMUTABLE_ARCHIVE/ARCHIVED, полный aggregate checkpoint и текущая sole-GM
authority независимо проверяются перед чтением, commit и replay. Это не
общая схема campaign runtime: неизвестный opaque JSON не принимается.
Snapshot ID экспорта копии — `sha256:` от реальных bytes campaign checkpoint,
source UUID — настоящий ID копии; lineage локального финала остаётся отдельным
provenance. Пока CMP-012 не реализован, fixture публикует только export CTA.

## Проверка решения

Обязательны cross-owner/context/stale/reset negatives, transaction rollback,
exact replay, настоящий SQLite reopen, byte-stable export, immutable source
comparison и production browser scenarios обоих owner contexts. Перед merge —
независимое ревью и свежие verify/E2E на окончательном commit.
