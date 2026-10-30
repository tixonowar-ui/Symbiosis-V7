# Изменения

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).
Проект не версионируется публично — записи группируются по вехам.

Каждый PR добавляет запись в раздел «Не выпущено».

## Не выпущено

### Добавлено

- **2026-10-30, issue #195:** отдельная shared библиотека закрытых player
  network DTO и GM NET-017 draft/queue/decision contracts по Atlas 1.6.
  Standalone codecs проверяют поля, ревизии и receipt consistency, сохраняя
  отдельные player/GM vocabularies. Core wire dispatch и приложение ещё не
  публикуют эти families; полный сценарий остаётся в #171 / PR #185.
  [ADR 0070](docs/adr/0070-network-request-source-contracts.md).

- **2026-10-30, issue #177:** разрешённая поставка Atlas 1.6 задаёт адресную
  очередь NET-017 и отдельные предварительные ACCEPT-TO-REVIEW / REJECT.
  IN_REVIEW не создаёт campaign copies, seats или capacity reservations;
  CANCELLED сохраняет историю, но исключается из текущей очереди. Узкий вход
  CMP-006 доступен GM собственной PAUSED кампании, NET-005 получает owner-only
  результат и безопасный возврат. JSON/Markdown зеркала защищены отдельными
  importer/validator guards и mutation tests; финальный admission сохранён.
  Прикладной GM runtime остаётся в #171/#172.
  [ADR 0069](docs/adr/0069-device-request-review-atlas-amendment.md).
  В обязательных проверках 33 оставшихся полных SQLite byte assertions
  используют native `Buffer.equals`: длина и все байты, прежние fixtures,
  структурные проверки и лимиты сохранены. Это убирает дорогую универсальную
  deep comparison, не меняя runtime или исходные данные.

- **2026-10-30, issue #190, предпосылка #177:** проверенная lineage конкретных
  поставок B0/B1 сохраняет исходные baseline ID, export/archive/candidate bytes
  и campaign receipts. Запечатаны исторический manifest, разрешённый successor,
  24 replay catalog inputs и tuple; исторический context выдаёт только loader.
  Current filesystem freshness остаётся точной, SQL/история не переписываются.
  Прикладные peer/SQL/discovery callers интегрируются отдельно в #171.
  [ADR 0068](docs/adr/0068-verified-artifact-baseline-lineage.md).

- **2026-10-30, issue #182, предпосылка #171:** закрытые installation keys,
  LAN locator/discovery и подписанный peer channel с ограниченными очередями.
  FINAL candidates проверяются полным existing creation replay и точным DTO,
  private history не возвращается в проекции. Current campaign reader отделяет
  immutable CREATE от текущего checkpoint; прежние zero-copy guards сохранены.
  Миграции 0008/0009 добавляют private identity и аудируемые local input tabs:
  entry/close, exact replay, owner reset, явный recovery pointer и предел 0–3.
  Listener передаёт sockets без close/rebind, standalone codecs не публикуют
  NET forms или application request runtime. #171 остаётся открытой, решения
  мастера требуют нормативного #177.
  [ADR 0067](docs/adr/0067-private-campaign-network-foundation.md);
  [ADR 0066](docs/adr/0066-device-connection-and-admission-request.md) предложен.

- **2026-10-30, issue #179:** private HTTP identity и локальный `/state`
  проверяют реальные TCP endpoint/listener и Origin до чтения store,
  decode, replay и выделения ID. Чужой transport получает безопасный отказ
  без локальных форм; обычный same-origin HTTP GET работает без Origin.
  Семь integration suites переведены с simulated sockets на настоящий TCP
  без authority adapters. [ADR 0065](docs/adr/0065-host-local-app-transport-boundary.md).

- **2026-10-30, issue #170:** локальный мастерский вход APP-011 и создание
  кампании CMP-001–006. Метаданные, выбранные интерфейс/порт, вместимость,
  секрет передачи и режим будущих бросков сохраняются в отдельном черновике.
  Scrypt-верификатор не попадает в read DTO, receipt или QR. Хост проверяет
  реальный локальный peer/Origin, baseline и удерживаемый bind lease; CREATE
  атомарно создаёт PAUSED при нуле персонажей. Replay, отмена, потеря ответа,
  SQLite reopen и новый вход без browser ticket сохраняют подтверждённые ID.
  QR содержит публичный locator, игровые часы и Start не создаются.
  [ADR 0064](docs/adr/0064-paused-campaign-creation.md).

- **2026-10-30, issue #156:** локальный контур после сохранения персонажа.
  CHR-026 и APP-009 восстанавливают единственный проверенный полный checkpoint;
  повреждённый незавершённый intent удаляется только подтверждённой командой.
  CHR-039 показывает неизменяемые версии веток, CHR-040 — финальную механику
  и отдельные локальные имя, описание и арт. APP-010 создаёт вариант с новым
  UUID и только этими тремя полями либо выгружает канонический UTF-8 JSON
  с baseline, provenance и контрольными суммами. Подписанный выбор строки
  библиотеки проверяет владельца; первый IDENTITY checkpoint варианта
  отдельно доказывает его происхождение. Recovery receipt и cursor сохраняются
  атомарно, последующий checkpoint закрывает прежний cursor. Архивный GM export
  проверяется через отдельный доверенный fixture без реализации CMP-012.
  [ADR 0063](docs/adr/0063-local-character-recovery-and-export.md).

- **2026-10-29, issue #155:** CHR-032 проверяет восемь независимых
  имущественных receipts, CHR-025 вычисляет типизированные blockers из
  нормативных данных. Подписанные исправления идентичности, расы, класса,
  навыков и состава сохраняют принятую базу, историю бросков и имущество;
  ветки и Советник восстанавливаются из кэша. Финальный save атомарно
  сохраняет immutable mechanics snapshot, receipt и FINAL того же персонажа.
  Replay и SQLite reopen сохраняют результат; после save CHR-025 доступен
  только для чтения. [ADR 0062](docs/adr/0062-creation-validation-and-final-save.md).

- **2026-10-29, issue #154:** пять произвольных позиций CHR-037. Каждая
  получает отдельный D20 AUTO/MANUAL и immutable receipt; выбранное количество
  сохраняется при любом результате. Описательный предмет занимает одну из
  пяти позиций и не создаёт механику из текста. Уже брошенные позиции
  неизменны, оставшиеся доступны для редактирования. Safe-return к деньгам,
  replay и SQLite reopen сохраняют результаты. После checkpoint CHR-037
  actionless, CHR-032 подписан и ещё не публикуется.
  [ADR 0061](docs/adr/0061-five-starting-positions.md).

- **2026-10-29, issue #153:** стартовые деньги CHR-038. Один отдельный D20
  AUTO/MANUAL даёт рекомендацию по точной шкале достатка; итоговая сумма не
  вычисляется и обязательно остаётся мастеру. Новый профиль атомарно связывает
  pending money request, исторический профиль продолжается по стабильному
  адресу без записи при чтении и повторной отправки профиля. Safe-return к
  оружию, replay и restart сохраняют грань и receipts. После checkpoint
  CHR-038 actionless, CHR-037 подписан и ещё не публикуется.
  [ADR 0060](docs/adr/0060-starting-money.md).

- **2026-10-29, issue #152:** профили оружия CHR-023/024 и диалог отказа
  CHR-031. Точная проверка 22 формул использует один введённый witness L/Lw/Ls,
  независимые значения дайсов и все заявленные выходы; RNG и крафт не
  выполняются. Полный эффективный профиль и доказательство сохраняются
  неизменно, фиксированный профиль PURE доступен только для чтения.
  Существующий финальный checkpoint навыков атомарно сохраняет явный пустой
  состав PURE и pending броню; исторические записи продолжаются явным
  подтверждением без выделения ID при чтении. После отправки CHR-038 подписан,
  текущий профиль actionless; деньги и согласование мастером остаются вне среза.
  [ADR 0059](docs/adr/0059-weapon-profiles-and-pure-entry.md).

- **2026-10-29, issue #151:** стартовое оружие CHR-022 после подтверждённой
  брони. Точный source-backed тип/вариант, preview требований и один immutable
  D20 качества; AUTO/MANUAL, safe-return/resume, replay и restart сохраняют
  оба имущественных результата. Старые armor checkpoints продолжаются явной
  командой без замены прежнего receipt. Recommendation не меняет механику,
  владение остаётся `OWNED_NOT_EQUIPPED`; профили CHR-023/024 не публикуются.
  [ADR 0058](docs/adr/0058-starting-weapon.md).

- **2026-10-28, issue #146:** стартовый armorBundle CHR-021 после завершённого
  random/manual состава. Один D20 качества на весь bundle (AUTO — один sampler
  в транзакции, MANUAL — одна грань), bundle всегда `OWNED_NOT_EQUIPPED`,
  `qualityRecommendation` — не механический модификатор и не final qualityTier.
  Девятый production E2E-сценарий; [ADR 0055](docs/adr/0055-starting-armor-bundle.md).
  Публикуется CHR-021; после checkpoint actionless `CHR-021/CHECKPOINTED` с
  host-signed `CHR-022`, который renderer не публикует.

### Исправлено

- **2026-10-30, issue #191:** 19 сравнений полного SQLite snapshot в тестах
  current campaign и installation identity используют native `Buffer.equals`.
  Проверка всех байтов и длины сохранена вместе с rollback, corruption,
  restart и authority assertions. Парный прогон тех же 77 тестов сократился
  с 33,84 до 2,74 с; данные Advisor, workers и таймауты не менялись.
  Замер подтверждает стоимость сравнений, но не единственную причину
  прежнего CI-таймаута Advisor.

- **2026-10-28, issue #146:** RANDOM checkpoint после safe-return/resume
  сохраняет результирующую presentation revision и проходит полную persisted
  validation. Подтверждение взаимодействий работает уже для первой composition
  record через empty-before preview. Внутренние идентификаторы вроде `CORE-151`
  удалены из player preview и DOM без потери смысла ограничений.
  [ADR 0057](docs/adr/0057-armor-initial-interactions-and-presentation-recovery.md).
- **2026-10-28, issue #146:** `CHR-042::CTA::001` подтверждает exact interaction
  diff и атомарно создаёт armorBundle через SET-DECIDE; прямой вход при pending
  diff запрещён. Post-write validation выполняется внутри SQLite-транзакции,
  а команды прежних стадий отклоняются без изменения payload. Safe-return/resume
  работает для RANDOM и MANUAL без новых IDs и reload. MANUAL-грань требует
  явного ввода, выбранный предмет и его source-backed характеристики видны до
  необратимой фиксации. [ADR 0056](docs/adr/0056-armor-interaction-confirmation-and-recovery.md).
- **2026-10-27:** `AGENTS.md` актуализирован после PR #161 и #163:
  команды и гейты CI, бюджет Vitest и диагностика E2E. Добавлен текущий
  [handoff](docs/status/handoff.md) с подтверждённой базой и границами результата.
- **2026-10-27, issue #162:** CI проверяет трассируемость и побайтовую
  воспроизводимость всего `generated/` двумя импортами, включая изображения
  и SQLite; отдельный гейт по-прежнему требует актуального вывода в Git.
  Пустые Vitest, coverage и E2E-прогоны завершаются ошибкой. E2E сохраняет
  trace первой неудачной попытки, screenshot и HTML-отчёт даже при успешном
  повторе; диагностика доступна в Actions 14 дней.
- **2026-10-27, issue #160:** штатный Vitest ограничен четырьмя параллельными
  workers (и доступным числом CPU). Измерение на Windows 8 CPU / 16 GiB
  воспроизвело native `DataCloneError` настоящего Atlas при семи workers;
  ограничение уменьшает совокупный пик памяти, сохраняя Atlas, все suites,
  guards и timeouts. Scheduler-регрессия ловит возврат к прежнему параллелизму;
  [измерения и границы результата](docs/status/vitest-atlas-memory.md).
- **2026-10-27, issue #157:** strict decoder перехода `CHR-013 → CHR-015`
  больше не отклоняет существующий `PARTIAL` как начальный `NONE`. Повторный
  вход из каталога восстанавливает canonical `selectedSkills`, `draftRevision`
  и host-signed presentation без protocol-error или новых receipts. Начальный
  `NONE` по-прежнему требует пустой набор, а `EXACT` и пустой `PARTIAL`
  отклоняются. Regression-покрытие включает decoder, UI и production browser
  с повторным входом, двумя добавлениями, read-only карточкой и restart.
- Потолок добавлений кода в гейте объёма PR поднят с `5500` до `7000`.
  Это первая калибровка авансом, а не по замеру, и записана как решение
  владельца: в потолок никто не упирался (максимум после четвёртого раунда —
  #130 с 4284 строками, 78 %), но круг Кодекса на крупной фиче с новым доменом
  стоит дороже запаса в пороге. Остальные семь порогов не изменились.
  Обязательство ревьюера называть в вердикте PR, который не удалось прочитать
  целиком, при этом становится тяжелее: 7000 строк кода плюс неограниченные
  тесты выходят за измеренную границу внимательного чтения.
- Матрица трассируемости больше не считает форму реализованной по упоминанию её
  ID. Раньше засчитывался любой строковый литерал в нетестовом `src/`, поэтому
  форма попадала в счёт как подписанное будущее назначение или как значение
  чужого поля: на момент правки матрица показывала 29 реализованных форм при 20
  фактически опубликованных, завышая `APP-` с 3 до 11. Источником стал
  `PRESENTED_FORM_IDS`, разбираемый тем же TypeScript AST и fail-closed при
  пропаже, пустоте, дубликате или не-литерале. Покрытие тестами по-прежнему
  считается по ссылке и может опережать реализацию — это осмысленно.
- Чеклист ревью получил раздел «Продуктовые дыры»: контракт выполнен формально,
  а пользы для игрока нет. Единственный класс дефектов, который не ловит ни один
  гейт, — `assertScreenContract` проверяет наличие поля, а не осмысленность
  значения.
- Четвёртая калибровка гейта объёма PR. Замер четырнадцати последних merge
  плюс #121 показал два PR подряд на 92–97 % бюджета добавлений по коду и
  впервые нагруженные удаления — 614 из 800, приходящие от обобщения, которое
  постановка заказывает явно. Добавления кода подняты до `5500` при
  наблюдаемых `3866`, удаления — до `1500` при наблюдаемых `614`. Потолок на
  добавление тестов снят: отдельный бюджет уже мешает тестам вытеснять код, а
  оставшийся лимит только заставлял взвешивать, влезет ли тест к исправлению.
  Лимит на удаление тестов сохранён — он ловит удаление теста ради зелёного CI.
- Гейт объёма PR измеряет диф от merge base, а не от вершины базовой ветки.
  Двухточечное сравнение засчитывало ветке как удаления всё, что `main` получил
  после ответвления: PR калибровки был отклонён собственным гейтом за «удаление»
  3686 строк, смерженных в это время в #121.
- Host при загрузке каталога теперь сверяет `CHR-002`, `CHR-010`, `CHR-016` и
  `CHR-036` с Atlas по точным `requiredFields`, маршруту, типу и роли игрока;
  негативный тест доказывает отказ при дрейфе любого ожидаемого литерала.
- Markdown-компаньон Atlas точечно приведён к content release v1.3: `CHR-001`
  показывает обязательный пол, `CHR-025` — границы массы по расе и полу, а
  `Q-CHAR-010` — later author override вместо отдельного отрицания границ.
  Raw-text guard проверяет отсутствие трёх старых prose-литералов и exact
  cardinality `4 / 3 / 1` новых, не объявляя общий Markdown parser.
- Atlas importer больше не хранит вторую дословную выгрузку 376 форм:
  `forms-by-id.json` остаётся единственным полным generated-каталогом,
  validator читает те же записи через индекс, а seed больше не создаёт
  дублирующую таблицу `atlas_forms`. Import удаляет legacy `forms.json` только
  после успешной записи оставшихся outputs.
- Гейт объёма PR перестал ограничивать работу вместо переписывания: замер
  четырнадцати последних merge показал, что два PR из шести упёрлись в потолок
  по добавлениям (у #102 остался запас в 12 строк кода и 5 строк тестов), тогда
  как удаления ни разу не подошли к своему пределу. Добавления подняты до
  `4000` для кода и `3000` для тестов, удаления — до `800` и `400`, файлов кода
  до `40`. `artifacts/` вынесен из бюджета кода в собственный суммарный порог
  `2000`: поставленный артефакт санкционирует владелец, и объём его диффа
  ничего не говорит о риске ревью.
- Компактный индекс форм рендерера теперь несёт `actionKey` и `label`, поэтому
  web-клиент больше не встраивает полный `forms-by-id.json` ради CTA; гейты
  трассируемости и валидации переведены на тот же индекс с равносильными
  проверками ключей, счётчика и замкнутости графа.
- Гейт объёма PR раздельно ограничивает добавления и удаления кода (`1500/400`)
  и тестов (`1200/200`); документация по-прежнему считается суммарно, а лимиты
  файлов не изменились.
- Поставка Web UI Atlas v1.2 открывает меню и библиотеку персонажей игрока до
  кампании: `APP-002` больше не требует места и соединения, а `APP-004` явно
  разделяет device-owned и owner-bound режимы без ослабления host handoff.
- Гейт трассируемости больше не зависит от даты ещё не существующего коммита:
  дата удалена из побайтово сравниваемого тела `docs/TRACEABILITY.md`, а проверка
  покрытия, списка ID и расхождений осталась точной.
- **`AGENTS.md` расходился с репозиторием в шести местах и вводил агентов в
  заблуждение.** Числа: артефактов 13, а не 12; ADR 22, а не 16. Состояния:
  `tools/traceability` описан как пустой, хотя это работающий модуль и второй
  шаг `npm run verify`; `src/` описан как «практически пустой» после трёх
  закрытых задач. Цепочка `verify` в `AGENTS.md` и `CLAUDE.md` не упоминала
  `traceability:verify`, а `CLAUDE.md` — ещё и `validate`. В таблицы команд
  добавлен `npm run build`, появившийся с точкой входа веб-клиента
- **Два файла с исходным кодом содержали сырой байт `0x00` и считались
  двоичными.** `git diff` показывал «Binary files differ», `rg` и `grep` молча
  пропускали их, а слияние с изменением с двух сторон дало бы неразрешимый
  конфликт. В `tools/validate/index.ts` байт попал в сторож `' nested'` по
  ошибке; в `tools/import/lib/media.ts` NUL осмысленно разделяет два поля и
  теперь записан escape-последовательностью через `FIELD_SEPARATOR`.
  Поведение обоих не изменилось. Добавлен тест, падающий при появлении `0x00`
  в любом `*.ts` под `tools/` и `src/`
- **`npm ci` требовал Visual Studio Build Tools и Python.** У `better-sqlite3`
  есть `binding.gyp`, и npm по умолчанию собирает такие пакеты через
  `node-gyp rebuild`, игнорируя готовый бинарник в тарболе. Сборка запрещена
  поимённо через `allowScripts` в `package.json`
- `engines` в `package.json` ничего не обеспечивал: npm игнорирует поле без
  `engine-strict=true`. Флаг добавлен в `.npmrc`
- ADR 0002 утверждал, что достаточно `engines.npm >= 11`. Утверждение было
  неверным и исправлено
- CI проверяет, что `better-sqlite3` не собирался из исходников. Раннер несёт
  цепочку сборки, поэтому зелёная сборка скрывала проблему
- CI останавливается на зависимости с install-скриптом, по которой нет решения
  в `allowScripts`. Глобальный `ignore-scripts` пропускал бы такой скрипт молча

### Добавлено

- **2026-10-27, issue #145, ADR 0054:** реализован playable ручной путь
  `CHR-017 → CHR-018 → CHR-019 / CHR-041` с exact FREE/UNITED composition,
  полными replacement checkpoints, art/tree для всех 23 видов и привязками по
  `Q-CHAR-010`. Локальное удаление и binding draft сохраняются только между
  projection-only переходами и сбрасываются к host baseline после reconnect.
  Advisor сохраняет identity, два I/W, обязательный отдельный B с roll-time
  составом и exact-fill навыков после remove/re-add и recovery. Немутирующий
  `CHR-042` показывает before/after, interactions и slot/stat/OE diff. Forward-only
  `0005` восстанавливает только presentation; Atlas, `src/shared`, outer protocol
  и RANDOM records не изменены. Добавлены три production Playwright-сценария —
  всего восемь; renderer публикует 35 форм (11 APP + 24 CHR). Equipment,
  `CHR-021+`, final save и готовность V1 остаются вне этого среза.
- **2026-10-27, issue #144, ADR 0053:** исправлено повторное открытие
  `CHR-014` после `open A → add A → open B`. Существующий
  `CHR-015::CTA::002` теперь разрешён только для `PARTIAL`; `NONE` и `EXACT`
  сохраняют прежние ограничения. Последовательные `add A → add B` сохраняют
  полный canonical набор и обе card-add записи, восстанавливаемые после
  replay/restart. Проверка исторических уровней отделена от вариантов на
  оставшуюся paid capacity; read-only ineligible B не очищает выбор. Пятый
  production Playwright-сценарий проходит этот маршрут через Fastify+WS/SQLite
  без изменения outer protocol, Atlas sources или SQL migrations.
- **2026-10-26, issue #147, ADR 0052:** `TROGR + ADVISER` получает отдельный
  durable `TROGR_SUPPRESSION_B` и в RANDOM, и в MANUAL. `B=floor(R20/4+0,5)`
  определяет будущий неснижаемый остаток интеллекта: `1+B`, либо `4+B` после
  поглощения Учителя. Это не текущий I, не третий I/W и не общий
  `EFFECTIVE_STATS` или финальный clamp. Два I/W и exact-fill навыков
  сохраняются; pending B блокирует подтверждение навыков, после receipt оно
  снова не предлагается. Replay/refresh/reconnect/restart/SQLite reopen
  восстанавливают те же addressed request/receipt без replacement request или
  нового sampler.
- **Atlas content release 1.5:** добавлен `CHR-041::CTA::004` с existing
  `UI-CMD-CHAR-CREATION-ROLL-COMMIT`, синхронизированы JSON, Markdown,
  transitions, coverage и QA. Итоговые счётчики — 376 форм, 1681 transitions,
  1247 action keys. RANDOM records не переписывались; MANUAL получил отдельный
  B-specific checkpoint stage, strict decoder и accessible presentation с
  native `<dl>`/headings и без лишних ARIA/live regions. `src/shared`, outer
  protocol и SQL migrations не менялись. Полный manual composition, `CHR-018`,
  `CHR-042`, I/W transport и equipment остаются задачами #145 → #146.
- **2026-10-26, issue #139, импорт поставки:** mapping-книги из #143 теперь
  проходят через `tools/import/symbiont-media`. Importer связывает по точному
  `SpeciesKey` 23 арта и 23 изображения деревьев с 20 ordinary и 3 monster
  видами, проверяет полноту anchors/media, безопасные имена и PNG-сигнатуры.
  `generated/spec/symbiont-media/manifest.json` фиксирует соответствие, а
  `generated/media/symbionts` и `generated/media/development-trees` получают
  исходные PNG-байты и пересобираются детерминированно. ADR 0051 сохраняет
  изображения presentation-only и не меняет sealed Delivery Manifest v1.2,
  `development-nodes.json` или runtime. `CHR-018`, #147, #145 и #146 остаются
  отдельными задачами.
- **2026-10-26, issue #144:** `CHR-013` открывает `CHR-014` по exact
  addressable route с client-selected `skillId`. Карточка показывает требования,
  текущие значения и host-signed уровни без внутренних registry/rule IDs;
  недоступный навык остаётся read-only. Добавление требует явного уровня,
  сохраняет полный canonical набор и возвращает mutable `CHR-015/PARTIAL`, не
  подписывая `CHR-017`; финальный exact-fill по-прежнему принадлежит только
  `CHR-015`. Safe-return не меняет selection. Host-signed presentation,
  forward-only `0004` и flat receipt history восстанавливают карточку и partial
  набор после reload/reconnect/restart без новых receipts. Два новых production
  Playwright-сценария проверяют обе карточки и recovery через Fastify+WS/SQLite.
- **2026-10-25, issue #139, поставка исходных материалов:**
  `artifacts/symbiont-media/` получил
  `Symbiosis_V7_Symbiont_Art_Mapping_v1.0.xlsx` и
  `Symbiosis_V7_Symbiont_Development_Tree_Mapping_v1.0.xlsx`. В них 23 арта и
  23 изображения деревьев с явными SpeciesKey, source variant и PDF page.
  Обычные виды поставлены исходным ZIP, чудовища и деревья извлечены из PDF;
  41 исходный PNG уменьшен до UI-копии не более 1600 px без изменения архива.
  Оба XLSX прошли проверку строк, embedded media и formula/static gate. Импорт,
  ADR и закрытие #139 остаются отдельной работой. `artifacts/CHECKSUMS.sha256`
  покрывает 22 файла; изображения не становятся источником правил или структуры
  деревьев.
- **2026-10-25, issue #135:** добавлен random symbiont slice
  `CHR-017 → CHR-020 → CHR-041 → CHR-019`: sanitized catalog, append-only
  physical records, duplicates, critical/monster outcomes, binding-only commit,
  Advisor I/W и exact-fill, read-only composition/interactions/modifier
  breakdown. Durable replay, refresh, reconnect, restart и historic recovery
  сохраняют sequence и receipts без нового seed или sampler; player projections
  не раскрывают внутренние catalog/rule/RNG данные. Web получил реальные экраны
  и local drafts для MANUAL, Owl/Eel side, monster и Advisor skills. Два реальных
  Playwright-сценария — FREE EEL с LEFT binding и UNITED ADVISER с exact-fill —
  проходят через production dist, Fastify+WS и изолированную SQLite. Ручная
  `CHR-018`, `CHR-021+`, весь V1 и готовность продукта этим срезом не заявляются.
- Поставка Atlas v1.4 добавляет пять недостающих каналов решений: адресуемые
  карточки навыка и симбионта с `:skillId`/`:speciesKey`, manual/random путь
  `CHR-018 → CHR-041 → CHR-019` с двумя addressed I/W requests и отдельным
  `ROLL-COMMIT`, local-draft навыки Советника, выбор стороны Совы/Угря и вида
  симбиотического чудовища. `CHR-020` получает pre-COMMITTED `BINDING`: fresh
  commandId фиксирует сторону после display без нового request, face, sampler
  или random receipt. ADR 0049 и fail-closed guards закрепляют exact
  transition/coverage/QA/Q&A-зеркала и Markdown-литералы без нового outer
  protocol. Runtime-реализация в эту поставку не входит.
- `CHR-010` теперь показывает разрешённый `GrantedSkillRefs` как именованный
  бесплатный расовый навык и положительное отсутствие у двух остальных рас.
  `CHR-013` и eligible options `CHR-015` передают дословный
  `BonusDomain / Scope` и явный вариант наличия `MissingSkillPenalty`; source
  text не переводится, внутренние ID не раскрываются, команды и ревизии не
  меняются.
- `CHR-013` и `CHR-015` доводят все три расы до выбора стартовых навыков.
  Host фиксирует проверяемый skill-stage baseline, публикует очищенный каталог с
  названиями, требованиями, текущими значениями и ценой каждого уровня, а web
  ведёт add/remove только в локальном черновике. Финальный checkpoint повторно
  проверяет весь набор через доменное правило точного заполнения, учитывает
  обязательный классовый навык ровно один раз и не расходует слот на бесплатный
  `UNITED/FOLLOWING_PAIN`; после коммита runtime остаётся actionless на
  `CHR-015/CHECKPOINTED`, не публикуя будущую `CHR-017`.
- `CHR-010`, `CHR-016` и `CHR-002` теперь до необратимого подтверждения
  показывают host-signed структурные последствия всех вариантов. Race и mode
  facts выводятся из startup-каталога поставленных races/stats/modifiers, а
  число попыток и terminal rule метода — из существующей domain-таблицы;
  `UNITED|FREE` сравнивают две явно условные ветви `MANUAL|RANDOM`, включая
  явное отсутствие поправок у `FREE + RANDOM`. Web только рендерит переданные
  данные и сохраняет выбранную структуру в local draft без wire и ревизий;
  Rule/Modifier/Source/question IDs в player payload не попадают.
- `CHR-009` теперь принимает rolled bijection по индексам исходного набора либо
  point-buy 90/85 и сохраняет canonical assignment вместе с provenance
  критического штрафа. Обобщённый `UI-CMD-CHAR-WIZARD-CHECKPOINT` ведёт
  `UNITED` и `FREE` прямо на read-only `CHR-012`, а `PURE` — через выбор класса
  `CHR-011`; host выводит обязательный классовый навык и на `CHR-012`
  пересчитывает base + race + class существующим domain-каталогом, не включая
  будущие поправки симбионтов. Все три расы проходят путь до `CHR-012`, а
  исключённые safe-return и skill-stage CTA остаются fail-closed с zero write.
- Четыре формы решения о наборе характеристик (`CHR-005`–`CHR-008`) теперь
  публикуются из одной exact таблицы с отдельным контрактом `CHR-005`, а
  `CHR-028` открывается как dialog layer над исходной формой. `CONFIRM`
  необратимо сохраняет singleton abandonment и полную историю попыток,
  `CANCEL` оставляет checkpoint неизменным и закрывает слой только
  presentation-переходом. `CLASSIC` ведёт к набору либо point-buy 90,
  `ADVENTUROUS` — через две попытки к набору либо point-buy 85, а
  `ALL_OR_NOTHING` — через максимум пять наборов с обязательным принятием
  пятого. Принятие подписывает `CHR-009`, не публикуя её в этом срезе.
- `UI-CMD-CHAR-CREATION-ROLL-COMMIT` атомарно фиксирует первый показ набора из
  семи D20 и по одному подтверждению натуральной критической цепочки. Метод на
  `CHR-002` создаёт адресованные branch/set request и ведёт на `CHR-003`;
  `AUTO` использует host RNG, `MANUAL` принимает только exact D20, а restart,
  reconnect, replay, refresh, Back и смена ветви не создают новый результат.
  Срез завершается actionless на `CHR-003` без критов либо на `CHR-004` после
  всей очереди; формы решения `CHR-005`–`CHR-009` остаются fail-closed.
- `UI-CMD-CHAR-CREATION-SET-DECIDE` атомарно фиксирует выбор расы, способ
  получения симбионтов и режим ввода кубов в append-only checkpoint envelope,
  повышает только entity/checkpoint revisions и подписывает точную следующую
  форму. Web сохраняет selectors client-local и показывает только подходящий
  capability-gated confirm. Обычная ветвь проходит
  `CHR-010 → CHR-016 → CHR-036 → CHR-002`, а `PURE` доказуемо пропускает
  `CHR-016` без synthetic receipt. Метод характеристик на `CHR-002` остаётся
  local-only до атомарного среза `CHR-003` с первым addressed set request.
- `CHR-001` заменяет ручной ввод ключа арта точным списком шести заглушек и
  файловым выбором PNG/JPEG: тип выводится из сигнатуры, bytes уходят как
  canonical padded base64, повторный выбор заменяет арт, а снятие возвращает
  `null`. Host-отказы показываются как ошибка поля без внутренних Rule ID.
  ADR 0040 задаёт явную таблицу `race + sex → assetKey` только для будущего
  atomic final save `CHR-025`; post-save изменение остаётся за `CHR-040`.
- Первый durable checkpoint идентичности атомарно сохраняет exact десятиполевый
  `command.request`, закрытый envelope и receipt, после чего host отправляет
  terminal wire v1 перед `COMMAND_DESTINATION` snapshot `CHR-010` в wire v2;
  replay восстанавливает то же назначение после reconnect и restart. `APP-004`
  читает локальную библиотеку при проекции и видит новый черновик без перезапуска
  host с отдельной runtime-ревизией библиотеки. Web замораживает подтверждённую
  идентичность, exact-декодирует initial `CHR-010`, а три выбора расы держит в
  client-local draft без wire-трафика.
- Поставка Atlas v1.3 добавляет обязательный `CHR-001.sex` с закрытым доменом
  `MALE|FEMALE`, переносит identity-draft на `protocolVersion=3` и задаёт
  границы массы создания `CHR-025` по расе и полу. Import/validate fail-closed
  сверяют четыре записи формы и все названные guard-зеркала; исторические
  `graphDigest`/`contentDigest` остаются author-supplied, а целостность поставки
  закреплена `CHECKSUMS.sha256`.
- Первый законченный срез ввода идентичности `CHR-001`: три additive wire v2
  сообщения передают exact full replacement, host канонизирует и журналирует
  runtime-черновик, а web сохраняет dirty-buffer и повторяет outstanding update
  после reconnect того же mounted instance; новый instance принимает CHR-001
  read-only. Continue не публикуется до checkpoint-среза. ADR 0034–0036
  закрывают initial `CHR-010`, Unicode-отказы имени и exact каталог из шести
  поставленных портретов; importer воспроизводит его spec, типы и media.
- ADR 0033 задаёт host-confirmed full replacement для значений идентичности
  `CHR-001`: additive wire v2 messages, отдельную `draftRevision`, точную
  проверку массы и durable checkpoint receipt без SQLite-строки для pre-commit
  draft; успешный переход в `CHR-010` ждёт exact initial values двух обязательных полей.
- Штатный `npm start` поднимает host из явной npm-конфигурации на стабильной
  базе в `LOCALAPPDATA`, отказывает с подсказкой при отсутствии `dist/web` и
  использует runtime shell-тройку ADR 0031. Player-путь теперь замкнут через
  `APP-001 → APP-002 → CHR-001 → APP-004 → APP-002`; ADR 0032 фиксирует
  отдельную runtime-ревизию локальной библиотеки и lifecycle buckets её
  device-owned проекции.
- ADR 0031 назначает shell-тройку одному runtime-агрегату на host instance:
  scope начинает с `0/0/0`, переживает смену context и transport reconnect, но
  завершается при host restart; entity snapshot переключает source на
  независимую тройку `local_character` либо `campaign` без SQLite
  singleton и копирования чисел между scopes.
- Первый сквозной путь создания персонажа проходит по подтверждённой host
  presentation `APP-001 → APP-002 → CHR-001`: form-action wire v2 сохраняет
  exact replay и ревизии, initial identity payload следует ADR 0029 без записи
  `local_character`, а web показывает только присланные хостом доступные CTA.
- ADR 0029 задаёт initial payload wizard-черновика: незаполненные и optional
  значения и отсутствующая текущая команда выражаются JSON `null` при
  обязательном key, `wizardCheckpointId` выделяется до первого snapshot,
  `draftRevision` начинается с 0, а `IDENTITY_INCOMPLETE` существует только как
  отсутствие Continue в `availableActionKeys`.
- Первый production adoption wire v2: host отдаёт durable `deviceId` через
  same-origin `no-store` endpoint, повторно сверяет locator при
  `session.reconnect` и публикует обязательную пару capabilities → role-neutral
  `APP-001`; web применяет пару одним commit только при точном
  correlation/reason/revisions. Командные и read-маршруты wire v1 сохранены,
  pre-adoption окно ADR 0028 закрыто.
- `src/shared` кодирует exact `session.reconnect` и staged capability frame wire
  v2: device identity проверяется как canonical UUID v4, executable command IDs
  — словарём, bootstrap role допускает явный `null`; контракт попал в main до
  первого production adoption.
- ADR 0028 задаёт симметричный `session.reconnect` wire v2, staged capability
  pair для команд v1, nullable bootstrap role и одноразовую pre-adoption
  границу, после которой v2 замораживается.
- Device-local identity store сохраняет один canonical lowercase UUID v4 в
  SQLite через forward-миграцию `0003`: bootstrap отличает первую инициализацию
  от missing/malformed состояния, а explicit reset сначала инвалидирует
  известные bindings и не создаёт новый ID сам.
- ADR 0027 фиксирует shell context; `APP-002` требует identity/seat subsystems.
- `src/shared` получил отдельный exact codec wire v2 для form-action и
  addressable-route intents, составной presentation snapshot и двух закрытых
  typed refusal; wire v1 остаётся без изменений сообщений и семантики.
- Импортёр атласа выводит точный `ActionKey` union из всех 1 242 строк
  `ctaAvailabilityByAction` в исходном порядке и fail-closed отклоняет
  отсутствующие, нестроковые и глобально дублирующиеся ключи.
- ADR 0026 разделяет выбор доступного form action и подтверждённое назначение
  составной presentation: server-backed навигация получает exact intent и full
  snapshot только в wire v2, direct URL проходит host validation, signed
  recovery destination не становится client choice, а device-local settings
  остаются вне campaign projection.
- Первый checkpoint черновика персонажа теперь может атомарно создать строку
  `local_character` и собственную строку checkpoint одним `BEGIN IMMEDIATE`:
  начальная корневая тройка проверяется как `0/0/0`, точные байты payload входят
  в snapshot, а любая ошибка откатывает обе записи.
- Полнота импорта атласа закреплена явными вердиктами для всех 24 корневых
  секций, 8 `globalContracts` и 10 подразделов `registryCoverage`: неизвестный
  ключ теперь останавливает импорт, а все 21 контрольное значение `counts`
  сверяется с источником. Восемь нормативных глобальных контрактов выгружаются
  без потерь и входят в seed как данные; смешанные кросс-ссылки реестров
  сознательно не дублируют старшие источники ADR 0003
- Forward-миграция `0002` и синхронное хранилище checkpoint черновика
  персонажа: стабильная identity, вычисляемая revision, SHA-256 точных байтов
  snapshot и атомарная запись `local_character` с независимой проверкой
  checksum, builder-снимка и корневой тройки при восстановлении
- Структурированная выгрузка 106 контрактов workflow-команд атласа с
  раздельными `commandId`, `title`, `formIds`, `guards`, `atomicity`,
  `reconnect` и `qa`. Импорт отклоняет дрейф формы, пустые поля, дубликаты,
  расхождение исходного счётчика и несовпадение текста связанного QA-сценария;
  массив входит в seed как данные, увеличивая его до 113 таблиц и 20 641 строки
- ADR 0025 определяет общий recovery-контракт и отдельное хранение checkpoint
  черновика персонажа: собственные ID/revision и checksum, полное отображение
  статусов восстановления, границу opaque payload и будущую forward-миграцию
  `0002-local-character-checkpoint`, не меняющую campaign checkpoint
- Синхронное хранилище строк `local_character`: создание и чтение явно
  отклоняют дубликаты, отсутствующие строки, неизвестные lifecycle-состояния и
  payload не в форме JSON-object; обновление payload/lifecycle и объявленной
  вызывающим слоем тройки ревизий выполняется одной транзакцией
- Три производных индекса атласа для web-рендерера: проекция 11 читаемых полей
  формы по ID, `primaryActions` по форме и точный переход по паре
  `(from, trigger)`. Полные `forms.json`, `forms-by-id.json`,
  `requirements.json` и `transitions.json` сохранены для остальных
  потребителей; новые представления строятся детерминированно и проверяются на
  полноту относительно исходных выгрузок
- Чистые правила критов создания для `CHR-004`: последовательность
  подтверждений по `CORE-083`/`CORE-084` даёт градацию 0..5, а `CORE-163`
  повышает подтверждённую 20 до `20 + grade` и сохраняет значение
  подтверждённой 1, возвращая отдельный непривязанный
  `creationCriticalPenalty`. Грани приходят извне; XP, `eventPoints` и счётчики
  развития не вычисляются
- ADR 0024 определяет значения неопределённого в поставке `StatMap` как целые:
  бросковая ветвь выводит инвариант из модели броска и `CORE-163`, а point buy
  применяет fail-closed. `assignBaseStats` и прямой `calculateSkillStageStats`
  требуют safe-integer входы без верхнего игрового cap и без переноса финального
  минимума `CORE-164`
- Чистое присвоение базовых характеристик для `CHR-009`: принятый набор
  проверяется как биекция мультимножества без point-buy cap, а ручные режимы
  требуют точных сумм 90/85 и диапазона 1..20. Результат — неизменяемый
  `baseStats`, напрямую совместимый с `calculateSkillStageStats`; броски,
  receipts и критические штрафы остаются за пределами этого среза
- Чистые правила `skillStageStats`: проверяемый каталог загружает семь
  характеристик, расы, классы, навыки, требования и модификаторы из
  `generated/spec`; точная пара `SourceType` + `SourceID` по ADR 0023 применяет
  расовые и классовые поправки без разыменования висячих ссылок. Стартовые
  навыки валидируются по всем требованиям, обязательным и выдаваемым навыкам,
  формуле слотов `CORE-081` и стоимости уровней `CORE-165`, а неизвестные и
  дрейфующие значения отклоняются fail-closed
- [ADR 0023](docs/adr/0023-stat-modifier-source-key.md) — модификаторы
  характеристик выбираются точной парой `SourceType` + `SourceID`, висячие
  `StatModifierProfileID` и `ContextModifierRefs` в поставке v1.2 не
  разыменовываются, а пустая расовая группа разрешена только для `PURE` с
  обязательным классом. Неизвестные source-типы и ID отклоняются fail-closed
- Точка входа web-клиента: self-contained Vite-сборка подключается к host
  `/state`, отправляет проверенный `projection.reconnect`, декодирует
  `projection.snapshot` контрактами `src/shared` и монтирует `APP-001`. Четыре
  обязательных поля отображаются только из host projection; ожидание
  снапшота, отказ хоста, ошибка wire v1 и обрыв связи показаны раздельно, без
  значений по умолчанию
- Host-shell V1: Fastify обслуживает настроенную HTTP/static-поверхность, а
  `ws` передаёт только проверенные сообщения wire v1 из `src/shared`. Хост
  формирует полную `player`-проекцию `APP-001` с тремя фактическими ревизиями и
  boot-данными из проверяемых источников; projector явно отклоняет
  `APP-002`…`APP-011` с недостающими полями. Негативные тесты проверяют
  фактически отправленный payload на отсутствие GM-only данных
- Минимальный generic-рендерер для всех 11 форм `APP-`: идентичность, метаданные,
  состояния, required fields, QA-сценарии и объявленные слоты читаются из
  `generated/spec`; CTA берутся только из `actionSteps[].primaryActions`, а
  назначения — из точного совпадения перехода по `from` и `trigger`. Поддержаны
  типы `screen` и `dialog`; неизвестные формы, остальные четыре типа,
  конфликтующие action steps и неоднозначные переходы отклоняются fail-closed.
  `APP-005` без `actionSteps` показывает явное состояние без придуманных CTA
- [ADR 0022](docs/adr/0022-operation-and-rule-handler-registries.md) и чистый
  каркас двух handler-реестров: 70 generated operation ID отделены от 739
  `RuleId`, duplicate/unregistered отказы fail-closed, а tombstone отличается
  от незарегистрированного active rule без новых игровых `ERR_*`
- [ADR 0021](docs/adr/0021-roll-model.md) и чистый контракт броска: буквальные
  конверты AUTO/MANUAL из Atlas, закрытый каталог d4/d6/d12/d20,
  source-neutral результат, host-side `node:crypto.randomInt` и replay
  сохранённого random receipt без повторного RNG
- [ADR 0020](docs/adr/0020-wire-protocol-and-shared-contracts.md) и
  fail-closed контракты `src/shared`: шесть маршрутов команд Atlas,
  типизированные request/result/refusal/replay, три reconnect-ревизии,
  идемпотентные receipts и блокирующий мастерский предикат `GM-029`
- `npm run import` собирает самостоятельный SQLite seed из всех 113 массивов
  `generated/spec`: 20 641 строка, восемь паспортов разделов и отдельная
  проверка побайтовой воспроизводимости на SQLite 3.53.4
- [ADR 0018](docs/adr/0018-current-state-storage-and-checkpoints.md) и миграция
  `0001`: current-state схема для `localCharacter`, `campaignCharacterCopy` и
  `campaign`, три ревизии reconnect-контракта и атомарный checkpoint кампании
- All Questions and Answers Registry v1.2 импортируется в
  `generated/spec/qna` и `generated/types/qna.ts`: 444 строки, 411 адресуемых
  кодов; алиас `Q-MON-089` защищён ADR 0017, ссылки старших реестров проверяются
  `npm run validate`
- [ADR 0017](docs/adr/0017-qna-question-code-alias.md) — Q&A-реестр v1.2
  помечает строку №367 кодом `Q-MON-083`, который уже занят несвязанным
  вопросом; Executable Rules v1.7 адресует то же решение как `Q-MON-089`.
  Строка адресуется кодом из старшего реестра, поправка живёт в индексе,
  строки переносятся дословно
- `AGENTS.md` — контракт для агента, открывшего репозиторий впервые
- CI на Windows: суммы, типы, линтер, формат, импорт, воспроизводимость
  вывода, тесты, кросс-реестровая валидация
- Guard по объёму PR и проверка маркеров незавершённого кода
- `npm run validate` — кросс-реестровая валидация `generated/spec`:
  формат ID, дубликаты, разрешимость ссылок, осиротевшие записи
- `docs/status/module-map.md` — честное состояние модулей
- `docs/process/review.md`, `docs/process/setup-checklist.md`
- `docs/backlog/` — семь подготовленных задач
- Шаблоны PR и issue, `CODEOWNERS`
- ADR 0015 — гарантии конвейера импорта
- ADR 0016 — что из `generated/` хранится в git
- `generated/spec/atlas/forms-by-id.json` — индекс 376 форм атласа по ID
- `npm run traceability` — детерминированный генератор матрицы по ID из
  `generated/spec`, ссылкам в `src/` и прикладных тестах

### Изменено

- **2026-10-30, issue #184:** по явному решению владельца PR-size допускает
  15000 добавленных строк кода и 90 файлов. Остальные лимиты и классификация
  сохранены; независимое чтение с явными границами и полные проверки перед
  merge остаются обязательными. Это запас для завершения #171, а не приёмка
  его частичного player-среза.

- ADR 0030 заменяет отменённые поставкой Atlas предпосылки `APP-002`: форма
  больше не требует `controllerSeat` и `connectionState`, а остальные решения
  ADR 0027 о величинах и fail-closed дисциплине остаются в силе.
- Decoder'ы wire v1 разделены на именованные проверки без изменения контракта;
  отдельные тесты покрывают каждый вариант сообщения, opaque handoff/reconnect,
  порядок fail-closed отказов и значения JSON, которые нельзя безопасно
  сериализовать или представить как ревизию
- [ADR 0019](docs/adr/0019-seed-is-rebuilt-not-committed.md) заменяет строку
  ADR 0016 про `generated/seed`: файл не хранится в git, а пересобирается
  импортом — как `generated/media`. Пробная сборка дала 30,3 МБ двоичного
  файла, который не диффится и не нужен для сборки, но побайтово
  воспроизводим. Заодно снято расхождение: `.gitignore` уже исключал
  `*.sqlite`, вопреки прежней формулировке

- **Guard объёма PR считает тесты отдельно от кода.** Три содержательные задачи
  подряд — #13, #17, #20 — упёрлись в общий лимит 900 строк, причём тем сильнее,
  чем лучше было покрытие: строка теста стоила столько же, сколько строка
  реализации. Пороги откалиброваны по замеру (реализация 566–662, тесты
  193–331), а не назначены: код 900, тесты 700
- `npm run verify` дополнительно прогоняет `validate`
- `npm run verify` проверяет, что `docs/TRACEABILITY.md` не устарел и не содержит
  неизвестных source-ID
- `npm run validate` сверяет ключи индекса форм с каталогом `forms.json`

## M1 — Конвейер импорта

Веха завершена 2026-08-09: все четыре категории вывода `generated/`
производятся импортом.

### Добавлено

- `tools/import` — `artifacts/` → `generated/`, девять модулей
- Гейт контрольных сумм перед чтением артефактов
- Детерминизм: одинаковый вход даёт побайтово одинаковый выход
- Атлас v1.2: 376 форм, 1672 перехода, 66 journeys, 91 requirement,
  2440 QA-сценариев
- Executable Rules v1.7: 739 карточек, 699 активных, 40 tombstone
- Character / Skills / Symbionts v1.2: 1144 payload-сущности,
  9 секций XP-контракта
- Items v1.6: 64 типа предметов, 64 иконки в `generated/media`
- Effects and Diseases v1.2: 67 типов эффектов, 66 моделируемых
- Canonical Bestiary v1.4: 16 видов, 17 статблоков, 16 артов
- Default Sentient Enemy v1.2 и Runtime Pack: 44 замороженных шаблона,
  44 арта, сверка реестра с пакетом по SHA-256
- All Questions and Answers v1.2: 444 вопроса, 411 адресуемых кодов
- `generated/seed/seed.sqlite`: 112 таблиц массивов, 20 535 строк и восемь
  паспортов; файл пересобирается и не хранится в git по ADR 0019
- `generated/types` — типы, выведенные из артефактов: `FormId` (376),
  `RuleId` (739), `EffectTypeId` (67), `ItemTypeId` (64) и другие
- Стражи ADR в импорте: 0004, 0007, 0011 сверяются с источником
- ADR 0004–0014 — решения аудита перенесены в ADR

### Исправлено

- `.gitattributes`: без него свежий клон на Windows получал CRLF, из-за чего
  менялся SHA-256 текстовых артефактов и `checksums:verify` падал после клона

## M0 — Каркас

### Добавлено

- Структура репозитория, Node 24 LTS, TypeScript strict
- ESLint, Prettier, vitest, Playwright
- `artifacts/` разложены и покрыты `CHECKSUMS.sha256`
- `tools/checksums` — генерация и проверка манифеста
- ADR 0001–0003, корневой `CLAUDE.md` и по слоям
