# ADR 0064 — Локальное создание paused-кампании

- **Статус:** принято; issue #170
- **Дата:** 2026-10-30
- **Дополняет:** ADR 0001, 0010, 0012, 0018, 0020, 0027, 0030, 0031 и 0063

## Контекст

J-CAMPAIGN-CREATE и CMP-001–006 задают metadata, вместимость/host,
секрет передачи мастера, default будущих бросков, preflight и атомарный
CREATE. Ноль PC разрешён, результат — PAUSED. Ни сцены, ни группы, ни игровое
время, ни admission/Start в этом срезе не создаются. Единственный workflow
UI-CMD-CAMPAIGN-CREATE принадлежит CMP-005; промежуточные CTA нормативные.

Атлас не определяет SQL/transport черновика, local GM bootstrap, алгоритм
хранения секрета, bind lease или формат QR. Ниже — технические решения,
а не новые игровые значения. Принятые артефакты остаются неизменны.

## 1. Подтверждённый локальный GM context

Мастерская ветвь доступна только соединению с этого host computer. Хост
проверяет фактические TCP local/remote addresses и точный HTTP Origin своего
интерфейса/порта; client deviceId, role, URL, Host или proxy headers не служат
доказательством. Loopback и соединение host с собственным адресом допускаются;
посторонний сетевой peer и чужой Origin не получают GM launch CTA или данные.

Origin строится из фактического bound listener и явно поддержанных локальных
адресов, не из request Host/X-Forwarded-*. Missing/null Origin отвергается.
IP нормализуются, включая IPv4-mapped IPv6; local/Origin proof проверяется
на resume, навигации, записи и CREATE до private reads/KDF. Ticket — locator.

Явный APP-001::CTA::002 подтверждает выбор local master profile, привязанного
к реальному storedDeviceId. Его private context ID назначает хост и сохраняет
отдельно от player-local context и campaign authority. Для нового profile
ревизия authority начинается с технического нуля. Это не master transfer,
takeover, пароль игрока или право удалённого устройства.

Profile хранит точный active-context pointer. Повторный явный вход с новой
вкладки переиспользует этот context, а не выбирает «последний» draft/campaign
сканированием. Первый ответ остаётся source-backed APP-011; следующий
автоматический GM resume восстанавливает сохранённый cursor без записи.
Поэтому потеря sessionStorage ticket не делает durable данные недоступными.
Resume разрешён свежему соединению либо тому же подтверждённому GM context;
поверх установленной player projection он отвергается до смены роли.

APP-011 публикует только hostDeviceId и безопасные состояния своей библиотеки
и authority. Из его ещё не реализованных действий доступно только создание
кампании и нормативный возврат в APP-001. Старые device-owner bindings после
reset не присваиваются новой identity. GM archive fixture ADR 0063 остаётся
отдельным trusted adapter и не выдаёт общую мастерскую власть.

## 2. Transport без новой protocolVersion

В существующую wire v3 добавляются закрытые campaign message types:

- `campaign.local-context.resume`: server-issued context ID, request ID,
  supported capabilities и unacknowledged IDs. Host-local proof и persisted
  owner проверяются заново; ответ — прежняя paired v2 capabilities/snapshot
  с exact correlation RECONNECT.
  Неизвестный pending command ID получает явный безопасный отказ до пары;
  отсутствие команды не превращается в новый CREATE.
- `campaign.draft.replace`: update ID, scope context/draft/sourceForm,
  expected draft/vector revisions и exact values только текущего этапа.
  Результат/отказ v3 содержит только безопасную GM presentation и ревизии.

Промежуточные записи не притворяются CREATE или character WIZARD. Новая
outer protocolVersion не вводится. Identity v3 сохраняет прежнюю закрытую
схему. Campaign create остаётся существующим workflow wire v1.

Один host runtime последовательно исполняет GM frames всех transport-сессий.
Асинхронные KDF/bind/preflight не позволяют другому GM frame использовать
промежуточный lease или смешать payload с более новой тройкой ревизий.
Обычные player frames в эту очередь не входят. SQL-транзакции остаются
синхронными и повторно проверяют owner/source/revisions после подготовки.

Клиент хранит только непривилегированный GM context ticket в sessionStorage
своей вкладки. Он восстанавливает ранее выбранную ветвь, но не заменяет
host-local/owner proof. GM resume отдельно пересогласовывает capabilities;
обычный player reconnect не получает CREATE или GM draft. При явном выходе
из мастерской ветви клиент очищает её pending state, секрет и ticket.

SessionStorage — необязательное хранилище locator. При его отсутствии либо
стандартных SecurityError/QuotaExceededError context остаётся в памяти
соединения; новый явный вход восстановит серверный active-context pointer.
Неожиданная ошибка сохраняет диагностику. Пароль в storage не записывается.

Ошибки campaign write не отражают исходные значения. Ошибка синтаксиса JSON
также не переносит фрагмент входа из JavaScript SyntaxError в wire/log.
Проверки сохраняют отказ и адрес поля, но не публикуют secret/confirmation.
Redaction действует и при неверной protocolVersion, направленной в прежний
decoder: публичный protocol refusal не отражает исходный input value.

## 3. Отдельный черновик и маршруты

Forward migration 0007 вводит owner/profile/context, campaign draft,
redacted journal, private verifier и exact cursor. Настоящей campaign row
до CREATE нет. campaignDraftId — отдельный UUID; отмена не создаёт campaign
ID, campaign checkpoint или creation receipt.

В source route `:campaignId` для CMP-001–005 связывается server-assigned
значением `draft:<campaignDraftId>`. DTO явно помечает draft namespace.
CMP-006 получает настоящий campaignId. Alias не является игровой сущностью
и не даёт authority по browser URL.

Каждый этап имеет exact allowlist: metadata; capacity/address/port/interface;
write-only secret/confirmation; MANUAL/AUTO. playerPassword и rulesetSelection
отсутствуют. Неполный подтверждённый draft не получает continue. Некорректное
значение даёт адресуемый отказ без частичной записи.

## 4. Ревизии, транзакции и recovery

Черновик владеет своей initial тройкой 0/0/0 и draftRevision=0; shell-тройка
не копируется и не берётся через max. Изменение подтверждённых данных даёт
state+1/projection+1/draft+1, visibility+0. Навигация меняет только
projection+1. Canonical no-op, отказ и exact replay не повышают ревизии.

Draft result разделяет immutable event facts (changed и applied revisions)
и текущую подтверждённую presentation того же draft. Для changed=false
event вектор и draftRevision равны ожидаемым; request ID всё равно связан
с redacted journal, чтобы changed repeat не стал новой записью. На exact
replay event неизменен, текущий draft/view может быть новее. Нельзя вернуть
сырой secret или восстановить старые данные поверх следующего подтверждения.

Отмена сохраняет tombstone и exact retry, закрывает cursor и уничтожает
private secret material; старый ID не оживляет draft. CREATE одним
BEGIN IMMEDIATE создаёт PAUSED row, private binding, creation journal,
нулевой полный campaign checkpoint без copies и exact CMP-006 cursor.
Draft становится COMMITTED в той же транзакции.

Новый узкий commitNewCampaignCheckpoint принимает только отсутствующий
campaign/checkpoint, PAUSED и нулевую тройку; callback синхронный и one-shot.
Existing update writer и его матрица ADR 0018 не ослабляются. Journal/cursor
ошибка, trigger side effect или stale owner/revision откатывают весь create.
Schema-version guard восстановления персонажа явно расширяется до 0007;
неизвестная версия или отсутствие обязательной таблицы по-прежнему — отказ.

Create receipt связывает исходный draft/vector и настоящий campaign target
0/0/0. Только ожидающая команда принимает этот scope transition. Повтор
commandId проверяет request до allocation/bind и возвращает тот же
campaignId/receipt/createdAt/QR. Changed payload даёт zero-write conflict.
createdAt — сохранённое UTC-время технического commit, не игровое время.

Refresh/reconnect/restart читает exact persisted MENU/DRAFT/CAMPAIGN cursor
с owner, target ID, hash, revisions и form. Нет first/latest scan или выбора
по URL/client-known vector. Повреждение даёт diagnostic, не новый campaign.
Последующие записи обновляют source и cursor в одной транзакции.

## 5. Секрет передачи мастера

Техническая local policy: 12–128 Unicode code points, без управляющих
символов Unicode Cc и одиночных UTF-16 surrogates; secret не trim/normalize.
Confirmation должна совпасть побайтово и проверяется также на replay.
Это strength policy приложения, не правило игры. Отдельного player password нет.

Node crypto.scrypt хранит только verifier: случайная salt 32 bytes,
key 64 bytes, N=32768/r=8/p=1, maxmem=64 MiB. Salt/verifier/параметры находятся
в private storage, никогда в read DTO, summary, receipt, QR или log. Raw secret
и confirmation не записываются в request journal; confirmation не сохраняется.
Для secret update replay хост сравнивает nonsecret request и проверяет
кандидат через сохранённый proof именно данного update ID, даже после
следующей замены секрета, а не fast hash пароля или plaintext.
Неизвестные KDF/параметры не получают fallback.

Hashing выполняется вне синхронной SQL transaction, затем внутри повторно
проверяются owner, scope, revisions и journal/update-ID race. Если другой
запрос уже записал тот же ID со своей salt, кандидат асинхронно проверяется
по победившему immutable proof и затем повторно проверяется ownership/journal;
различие подготовленных salts не считается changed payload. На cancel все
per-update private proofs уничтожаются; старые secret updates после tombstone
отклоняются, exact retry отмены не оживляет draft.
После подтверждения raw input очищается; back/unmount/role exit также удаляют
значения и клиентские ссылки. Повторный вход показывает только «секрет задан»;
сохранять старый verifier разрешено без повторного ввода, новая замена явная.

Campaign art — optional local PNG/JPEG с проверенной сигнатурой, canonical
base64 и лимитом 12 MiB; checksum считается по bytes. Это технический предел
изображения, не игровые данные и не навязанный character portrait.

## 6. Bind preflight и PAUSED

Address/interface проверяются по реальным интерфейсам host, port — целое
1..65535. Wildcard не становится advertised address. Никакого автоматического
выбора чужого адреса или другого порта после отказа.
IPv6 URI использует brackets; link-local/zone address, не поддержанный
WHATWG URL/браузером, получает явный unsupported-interface отказ.

Preflight получает lease реального exclusive bind. Если endpoint уже
принадлежит текущему HTTP shell, проверяется server instance и используется
его lease; он не объявляется чужим occupied port. Иной endpoint удерживается
сервисной reservation до commit, закрывается при back/refusal/rollback.
Проверка bind→close→commit с окном захвата запрещена.

Shell lease проверяет живой server instance и покрытие именно выбранного
адреса/порта (включая явно bound wildcard), не просто совпавший port.

Async prepare идёт до SQL transaction; owner/draft/config/baseline и живой
lease проверяются заново внутри. После create lease принадлежит сохранённой
кампании. Это транспортная reservation, без scene/admission/Start. Таким
образом source CMP-006 HOST_NOT_STARTED и status PAUSED не подменяются
запуском пустого игрового host. Shutdown освобождает owned listener; recovery
проверяет или восстанавливает тот же endpoint, не создаёт второй campaign.
Если endpoint занят после restart, сохраняется PAUSED entity и явный
diagnostic; адрес/QR/receipt не заменяются выдуманными.

Baseline/catalog compatibility проверяется по фактическим поставленным
checksums/runtime contracts, не по client PASS. Fail не создаёт новые campaign,
campaign credential/checkpoint/cursor или lease; уже подтверждённые draft,
verifier и draft cursor сохраняются. HTTP locator нового reserved endpoint
до #171 не обещает действующую campaign page или admission.

## 7. QR и ограничение capabilities

qrPayload — стабильный публичный HTTP locator сохранённых address/port и
campaign UUID, без secret или authority token. Формат и bytes задаются
однократно create; replay/recovery их сохраняют. QR не даёт admission.
Точный locator строится WHATWG URL как `http://<address>:<port>/?campaignId=<UUID>`:
IPv6 в brackets, default port 80 канонически опускается, query содержит только
campaignId. URL — обнаружение выбранной кампании, не admission/role claim.

Добавляются точные зависимости: qrcode-generator 2.0.4 (MIT), bundled runtime,
и jsqr 1.4.0 (Apache-2.0), только dev decoder тестов. Обе — JavaScript без
зависимостей и install scripts; allowScripts не расширяется. QR строится
офлайн, проходит реальное декодирование; CDN/service/imagegen не используется.
Источники: [encoder](https://github.com/kazuhikoarase/qrcode-generator),
[decoder](https://github.com/cozmo/jsQR),
[scrypt Node 24](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).

CMP-006 terminal actionless: единственная source CTA ведёт в исключённый
CMP-007. APP-005, CMP-007, NET-001+, NET-016 и Start не публикуются ради
видимости. Следующие срезы — #171–174; NPC/GM runtime и packaging не вводятся.

## Проверки

Обязательны real SQLite rollback/reopen, stale/cross-owner/context/replay,
технические secrets scan по storage/reads/receipts/logs/DOM после очистки,
реальные occupied-port и bind leases, decode QR, ноль PC и отрицательная
player projection. Production E2E проходит create/cancel/recovery/failure.
Перед merge — независимый свежий verify/E2E на окончательном commit и CI.
