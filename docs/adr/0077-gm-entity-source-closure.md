# ADR 0077 — Источник полных NPC и пользовательских шаблонов врагов

- **Статус:** принято владельцем: A/B/C/D и арт issue #186
- **Дата:** 2026-11-04
- **Дополняет:** ADR 0036, 0040, 0049, 0068, 0071, 0073 и 0075
- **Граница:** поставка источника и точная совместимость; runtime — #187/#188

## Основание и состав

[Issue #186](https://github.com/tixonowar-ui/Symbiosis-V7/issues/186) принята
полностью 2026-10-30: поправки пола/массы/арта, technical attempt и квитанции,
двухфазная новая версия NPC и отдельное право броска новой версии монстра.
Последующая очередь владельца сохраняет эту поставку после #174, затем #204,
#187 и #188. Историческое предложение готовилось к Atlas 1.6; фактическая база
этой поставки — 1.9/B4 после PR #217. Старый целый Atlas не подставляется.

Поставляется Atlas **1.10**, дата **2026-11-04**, прежние schemaVersion 1.2.0
и legacy filenames v1.2. Состав: **376 форм, 1706 переходов, 112 workflow,
2449 QA и 1270 CTA**. Шесть новых CTA замыкают monster version child и возвраты;
новой команды RNG или новой формы нет. Исторические producer graphDigest и
contentDigest сохранены по ADR 0037/0049; SHA-256 удостоверяет текущие байты.

## A: пол, масса и арт

У NPC обязателен MALE/FEMALE. Масса — точный шаг 0,1 кг, включительные границы:

| Раса   | MALE   | FEMALE |
| ------ | ------ | ------ |
| PURE   | 60–400 | 40–350 |
| UNITED | 30–150 | 25–120 |
| FREE   | 40–200 | 30–160 |

Пользовательский SENTIENT не получает поле пола; масса 30–500 кг независимо
от расы. CUSTOM_MONSTER не получает пол или расу; масса 5–10 000 кг.
Проверка действует до сохранения v1/N+1, без изменения прежних версий или
44 замороженных системных шаблонов. Пределы возраста/HP не добавляются.
CHR-only неизменность пола после checkpoint не переносится на NPC.

Первоначальный answer Q-CHAR-010 сохранён дословно; GM-уточнение записано
отдельным laterAuthorOverride. CHR-контракт и AQA-010 в NET-019 сохраняют свою
область: новые NPC-диапазоны не ограничивают массу PC, а pending approval
по-прежнему блокирует ACTIVE/Ready/сцену/Start.

В `artifacts/gm-entity-portraits/manifest.json` задано восемь закрытых mappings.
Шесть NPC-портретов используют прежние local-character keys/bytes; UNITED→unified
задан явной таблицей. Две новые PNG поставляются побайтно:

| Kind / assetKey                                 | SHA-256                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| SENTIENT / symbiosis_placeholder_sentient_enemy | 5da7ee70db7c47dabfa92522e5bc8c9855c8a0c7596764d00b8b24cebd570a3f |
| CUSTOM_MONSTER / symbiosis_placeholder_monster  | 563c23e0190bff9b5498bc0ec46830f9209fa1d181fe163e3ea76edbab7e7e86 |

Валидный пользовательский арт имеет приоритет. При явном отсутствии выбора
успешный save закрепляет нужную заглушку; N+1 наследует выбор, пока мастер
явно не заменил или очистил его. Неизвестный ключ или плохой upload отказывает,
а не заменяется заглушкой. Просмотр/reconnect не пересчитывает сохранённый арт.
CORE-193/AQA-001 сохраняет PNG/JPEG ≤12 MB с существующим byte interpretation.
Реализация upload/save и controls относится к #187/#188.

Импорт проверяет закрытые поля, порядок, mappings, exact basenames, реальные
PNG bytes и все hashes до своего вывода. Новый каталог хранит entity kind,
nullable race/sex, key, digest и проверенный generated media path. Шесть файлов
не дублируются; импорт копирует только две новые PNG. Generated — только вывод
конвейера. Новый каталог является представлением арта, не источником механики.

## B: попытка и квитанция

По CORE-194/195 enemyTemplate не получает persisted DRAFT/ARCHIVED/RUNTIME_CLONE
status. VERSIONED — классификация; изменяемые данные до commit принадлежат
technical attempt. ENM-019 показывает attempt/operation-bound квитанцию семи
R20 без посторонних XP-полей и без mutation/RNG action.

CORE-200 разрешает вручную менять candidate base stats в пределах 1–35 после
броска. Неизменны первоначальные грани и RandomStatsReceipt. States, components
и QA больше не объявляют весь candidate фиксированным результатом.

## C: OPEN и COMMIT полной новой версии NPC

`UI-CMD-NPC-NEW-VERSION phase=OPEN` доступна из NPC-003/007 для текущего
npcUuid/currentVersion. Она сохраняет только связанную полную попытку и
квитанцию фазы, не изменяя сущность, currentVersion или историю.

Host-bound editMode различает CREATE_V1 и APPEND_N_PLUS_ONE во всех восьми
этапах. Он не выбирается клиентским флагом. Переход NPC-016→017 только открывает
итоговую проверку. Кнопка «Сохранить NPC атомарно» на NPC-017 исполняет COMMIT-V1
для CREATE_V1 либо NEW-VERSION phase=COMMIT для APPEND_N_PLUS_ONE.

COMMIT повторно проверяет current GM, campaign/NPC binding, ожидаемые ревизии
попытки и currentVersion, полный лист, sex/race/mass и арт; атомарно добавляет
полную N+1/history того же UUID. Старые версии и combat pins неизменны.
OPEN/cancel не создаёт версию. Exact replay возвращает первоначальную квитанцию
своей фазы отдельно от текущей проекции; OPEN→COMMIT с тем же commandId —
изменённый request и отказ без записи. Нового обязательного NPC reason нет.

## D: бросок версии CUSTOM_MONSTER

ENM-017 открывает ENM-018 только для текущей CUSTOM_MONSTER attempt. Связанный
контекст содержит attemptId/revision, campaign, templateId/expectedCurrentVersion
и originFormId=ENM-017. Для SENTIENT monsterRollContextOrNull=null и child CTA
отсутствуют; его обычная полная N+1 остаётся разрешённой по прежним guards.
Исторические имена monsterDraftId/creationAttemptId — aliases одного attemptId,
а не независимые идентичности проверки и выдачи квитанции.

Единственный host RNG остаётся на ENM-018: семь независимых натуральных R20
в порядке S,D,M,Z,I,W,C, без critical chain, независимо от MANUAL/AUTO input mode.
Одна distinct create/version attempt имеет одно право; новый operation в уже
использованной попытке отказывает, exact replay сохраняет прежнюю квитанцию.
Новая distinct version attempt получает собственное право по CORE-201.

После броска ENM-017 имеет отдельный read-only путь в ENM-019. Все возвраты
ENM-018/019 выбирает host-bound origin: ENM-012 для создания, ENM-017 для версии.
Child return после броска сохраняет attempt, spent right и последующие ручные
правки; не отменяет случайность и не копирует исходные грани поверх candidate.
Это точное исключение для child return, не общее ослабление safe boundaries.
Cancel версии оставляет прежнюю currentVersion и не стирает использованный receipt.

## B5: точная совместимость и границы

| Поставленные байты    | SHA-256                                                          |
| --------------------- | ---------------------------------------------------------------- |
| Atlas JSON            | a4f23d8282acecdf1e8209b53cc8fab196c169db14d9b31af4d504666b45003a |
| Atlas Markdown        | 8b66f22b88eda02345ad3e0933d218467da533c801f8781f2d349a4260aae558 |
| Новый art manifest    | 30b4df3f3bc7ffeff017fc28538dcf09f98c1e032ff94cd1e9cfc141c4714554 |
| Полный CHECKSUMS / B5 | 8487957025cf3bb29f892f057b924d7f44c5db214e8ea3fda427132e78e0f40c |

Путь поставки увеличен с 22 до 25 файлов: два Atlas меняют байты; добавлены
только art manifest и две PNG. Прежние двадцать non-Atlas paths, Runtime Pack,
24 механических replay inputs и runtime tuple сохраняются точно.

Разрешены только явные B0/B1/B2/B3/B4→B5 и тождественное чтение, вместе с
ранее принятыми forward-парами. У каждого старого baseline остаётся его manifest;
B4 сохранён как `src/host/baselines/atlas-v1.9.checksums.sha256`. Единственное
новое различие набора путей — три exact sealed art paths. Это отдельное решение
для B5, не обобщение Atlas-only исключения ADR 0068 на произвольные новые файлы.
Обратные/неизвестные версии, другие пути/байты, изменённые каталоги или tuple
не получают совместимости автоматически. FINAL/checkpoints/receipts и их
исходные baseline IDs не переписываются.

Literals/object seals JSON и независимые Markdown mirrors сохраняют прежние
защищённые NET/CHR положения. Новая проверка охватывает полные изменённые формы,
workflow, journeys, requirements, QA, global/out/in переходы, Q&A и lifecycle.
Негативные mutations, физические image bytes и реальные old→new process fixtures
проверяют эти границы. Ни source-поставка, ни её импорт не завершают runtime
#187/#188 или родительскую #113; единую CMP-007/GM-001 оболочку они переиспользуют.
