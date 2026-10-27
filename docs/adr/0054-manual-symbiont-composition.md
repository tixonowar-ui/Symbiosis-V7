# ADR 0054 — Ручной состав симбионтов и предпросмотр взаимодействий

- **Статус:** принято
- **Дата:** 2026-10-27
- **Дополняет:** [ADR 0048](0048-random-symbiont-draw.md),
  [ADR 0049](0049-atlas-missing-decision-channels.md),
  [ADR 0051](0051-symbiont-art-and-tree-delivery.md) и
  [ADR 0052](0052-advisor-intelligence-floor-roll.md)
- **Реализует:** issue #145

## Контекст

Random slice #135 сохраняет физический порядок бросков и получает состав из
него. Ручной путь `CHR-017 → CHR-018 → CHR-019 / CHR-041` не имеет таких
бросков: игрок выбирает вид, привязку и полный следующий состав. Использовать
`randomSymbiontStage`, synthetic receipt или refill для ручного выбора нельзя.
При этом уже поставлены exact media mapping #139, addressable route из ADR
0049 и отдельный B-roll Советника из ADR 0052.

Нормативная основа остаётся в первичных источниках:

- `Q-CHAR-004`–`Q-CHAR-010`: получение, состав, взаимодействия и привязки;
  в частности, `Q-CHAR-010` задаёт `OWL_EYE`/`EEL_ARM` со сторонами
  `LEFT|RIGHT`, fixed bindings Клеща/Паука/Богомола и `NONE` остальных видов;
- `Q-SYM-073` и ADR 0048 §8–9: подавление не отменяет I/W и обязательные
  навыки Советника; поглощение Учителя влияет на будущий минимум I;
- `Q-SYM-005` и ADR 0052: отдельный B-roll и его округление не заменяются
  текущим I, скрытым третьим I/W или постоянным значением;
- `symbionts.json`, `races.json`, `incompatibilities.json` и
  `development-nodes.json`: игровые значения и связи; изображения деревьев
  остаются только представлением по ADR 0051;
- Atlas `CHR-017`, `CHR-018`, `CHR-019`, `CHR-041`, `CHR-042`: существующие
  route, CTA и transport boundaries. Этот ADR не выпускает новую редакцию
  Atlas.

## Решение

### 1. Ленивый отдельный manual stage

`manualCompositionStage` создаётся только первой валидной командой
`CHR-018::CTA::001`. До неё `CHR-017`, пустой ручной draft и addressable
`CHR-018/:speciesKey` выводятся из существующего skill checkpoint. Просмотр
каталога или карточки не создаёт composition stage, RNG, request или receipt.

Stage хранит полную accepted/binding историю ручных replacement, текущий
производный состав, `compositionDraftRevision`, снимок dice mode и отдельные
Advisor facts. `randomSymbiontStage`, полноценный `manualCompositionStage` и
legacy `advisorIntelligenceFloorStage` взаимно исключительны. Их нельзя
объединять в одном checkpoint или заполнять один из другого.

RANDOM physical records, duplicate/critical semantics, порядок receipts и его
проекции не переписываются. Ручной режим не создаёт `SPECIES_ORIGIN`, random
sequence, duplicate reroll или monster-critical snapshot.

### 2. Полный валидный replacement вместо инкрементальных удалений

Каждый ручной commit содержит весь следующий accepted order, индексы
`0..n-1` и полный binding snapshot. Host заново выводит состав существующими
domain primitives: Вольный получает ровно одного ordinary; Единый — четырёх
разных ordinary либо одного monster на четыре слота. Полная замена уже
заполненного состава разрешена до необратимой границы этого среза.

Unknown, missing, extra или foreign species/binding, duplicate, overcap,
monster+ordinary, несовместимый вид и изменение fixed binding отклоняются до
durable write и sampling. Чистое удаление, оставляющее неполный состав, не
сохраняется. `CHR-030` для client-owned invalid composition не создаётся.

`CHR-017::CTA::001` использует exact addressable route; host повторно
проверяет `speciesKey`, race, текущий draft и media. URL, первый элемент и
cache не являются fallback. Карточка получает только явно сопоставленные art
и tree: каталог проверяет все 23 `SpeciesKey` и 46 файлов, а missing, extra
или mismatched media останавливает публикацию. Изображение не поставляет
правила или структуру развития.

### 3. Локальная граница удаления и изменения привязки

Отдельного remove-CTA или нового outer command нет. Поле включения вида —
редактируемое состояние формы в React, а не самостоятельная игровая команда.
`CHR-018::CTA::003` меняет только local binding draft. Следующий
`CHR-018::CTA::001` фиксирует полный валидный replacement через существующий
`UI-CMD-CHAR-WIZARD-CHECKPOINT`.

Неподтверждённые поля сохраняются при projection-only переходах между
`CHR-017`, `CHR-018`, `CHR-019` и `CHR-042` в том же mounted client. Refresh,
reconnect и restart сбрасывают их к host baseline. Safe-return не объявляет
локальное редактирование сохранённым и не меняет game state.

`CHR-018` восстанавливается по host-signed route: `localCharacterId`
наследуется из подтверждённого context, `speciesKey` остаётся client-selected
binding. Для карточки не требуется `wizardCheckpointId`, которого нет в её
required fields; browser URL сам по себе полномочий не даёт.

### 4. Presentation-only migration 0005

Forward-only migration `0005-symbiont-presentation` добавляет
`local_character_symbiont_presentation`. Её JSON содержит только exact
`formId`, route template/bindings, `compositionDraftRevision` и
`projectionRevision` для `CHR-017|018|019|041|042`.

Таблица не хранит игровой состав, RNG state, physical rolls или второй selection
authority. Она восстанавливает назначение формы после reconnect/restart, а
composition по-прежнему выводится из whole-checkpoint history. Навигация
меняет только `projectionRevision`; game/draft/state/checkpoint и
actor-visibility revisions не двигаются. Upgrade с `0004` не переписывает
skill presentation.

### 5. Непрерывная идентичность Советника и roll-time B

При первом принятом Advisor host создаёт `advisorInstanceDraftId` и ровно два
addressed pending I/W IDs без face, receipt или sampler. Последующие
remove/re-add и full replacement сохраняют эту идентичность, pending IDs, I/W,
B и skill records. Наличие незавершённой Advisor работы определяется текущим
составом, а не одним лишь существованием старого ID.

`CHR-041::CTA::003` использует существующий `ROLL-COMMIT`: AUTO после guards
вызывает sampler ровно дважды в порядке I→W, MANUAL принимает две грани без
sampler. Один command receipt связывает два physical rolls и два roll
receipts. Critical chain, creation penalty и XP не запускаются.

При `TROGR + ADVISER` обязательные I/W и навыки выполняются даже при
подавлении эффектов. До I/W допустим `SUPPRESSED` без выдуманного B pending
ID или minimum. После I/W отдельный pending B адресуется через канал ADR
0052; AUTO делает один sample, MANUAL принимает одну грань. Exact-fill
навыков запрещён до обязательного B receipt.

B и будущий минимум вычисляются из состава **на момент броска** и сохраняются
с его receipt. Более поздний replacement, включая поглощение Учителя после
броска, не пересчитывает прошлый результат. Replay, reconnect и restart
возвращают прежние ID и receipts без replacement request или повторного
sampling.

После composition/I/W/B/skills wizard revision может быть новее composition
revision. Следующая форма выбирается по незавершённой Advisor работе, а receipt
использует сохранённый `nextStageEnvelope.formId`; более поздняя запись не
подменяет назначение прежнего receipt.

### 6. Немутирующий `CHR-042`

Preview сравнивает две последние сохранённые composition records: предыдущий
и текущий полный replacement. Чистый domain расчёт возвращает before/after,
interaction graph, suppression/destruction/absorption, slot/stat/OE diff и
безопасные operation kinds. Он использует существующие composition,
interaction и modifier primitives, а не второй игровой движок.

Показ `CHR-042` не исполняет последствия заранее, не создаёт commit, roll,
receipt или durable effective stats и не меняет состав. Наличие локального
несохранённого draft не делает его host authority для preview. Safe-return
в `CHR-019` остаётся presentation-only. `CHR-042::CTA::001` и его
`SET-DECIDE` не публикуются: подтверждение необратимого результата принадлежит
следующему equipment срезу.

### 7. Строгая проекция и клиент

Host строит player payload явным allowlist; web повторно проверяет exact
variants, revisions, request/receipt identity и terminal snapshots. Unknown
или лишние поля, смешанные RANDOM/MANUAL facts и неполные rolls отклоняются.
Raw registry rows, `ProfileRuleID`, `ModifierID`, Rule/source/question IDs,
`Источник`, seed/RNG state и availability trace не попадают в player
payload, DOM, accessibility tree или client cache.

UI использует существующие Atlas labels, связанные controls и native
constraints. Адресуемые route, local binding и native I/W submit не
дублируются ложными generic form-action кнопками.

### 8. Граница решения

Не реализуются `CHR-021+`, equipment, `CHR-019::CTA::001`,
`CHR-042::CTA::001`, `CHR-025`, final save и `CORE-164`. `CHR-020`, RANDOM
sequence, `CHR-029`/non-empty branch cache и смена подтверждённого random
monster остаются вне среза. Общий runtime `EFFECTIVE_STATS`, уровни, деревья,
OE-progression и XP не создаются.

`artifacts/**`, Atlas content release, `src/shared`, outer protocol и
существующие RANDOM records не изменяются. `generated/**` по-прежнему
производится только importer. Этот ADR не объявляет завершёнными #146,
следующие equipment/final-save задачи или V1 целиком.

## Обоснование

Whole-composition checkpoint соответствует ручному выбору и позволяет host
проверить итоговый состав атомарно, не сохраняя промежуточный невалидный
результат. Полная history нужна для replay, before/after preview и
восстановления Advisor facts; derived current composition не заменяет её.

Ленивое создание stage отделяет просмотр от игрового решения. Отдельная
presentation таблица закрывает восстановление route, не дублируя composition
authority и не расширяя общий wire protocol. Явная rollback-граница local
draft делает reconnect безопасным: подтверждённым считается только host
baseline.

Сохранение Advisor identity устраняет повторные броски после редактирования
состава. Привязка B к roll-time composition отделяет необратимый физический
результат от последующих решений игрока. Немутирующий preview показывает
последствия через те же чистые правила, которыми проверяется состав, без
второго источника механики.

## Отвергнутые альтернативы

| Вариант                                                           | Причина отказа                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Использовать `randomSymbiontStage` или synthetic random receipts  | Ручной выбор не имеет физической random sequence и не должен её имитировать   |
| Создавать stage при открытии каталога                             | Просмотр не является игровым решением и не должен порождать receipt/RNG       |
| Отдельная durable remove-команда или сохранение неполного состава | Нарушает exact cardinality и существующую границу `CHR-018::CTA::001`         |
| Хранить копию состава в presentation migration                    | Создаёт вторую authority и допускает расхождение с checkpoint history         |
| Новые Advisor ID или reroll после remove/re-add/replay            | Теряет идентичность сущности и повторяет необратимый результат                |
| Пересчитывать B по последнему составу                             | Подменяет roll-time факт более поздним решением                               |
| Preview через предварительный commit или новый outer protocol     | Нарушает немутируемость просмотра и существующие transport boundaries         |
| Читать механику из tree PNG или отдавать raw registry игроку      | Изображение не источник правил, а внутренние поля не являются player contract |
| Добавить equipment/final save или общий effective-stat engine     | Это самостоятельные следующие срезы, а не необходимость ручного состава       |

## Последствия

- Ручной путь получает playable `CHR-017 → CHR-018 → CHR-019 / CHR-041`,
  включая art/tree, bindings, Advisor I/W, отдельный B, exact skills и
  read-only `CHR-042` там, где есть confirmation-required interactions.
- Persistence использует forward-only migrations `0001`–`0005`; recovery
  разделяет composition history и presentation route. Renderer публикует 35
  форм: 11 APP и 24 CHR; остальные формы остаются fail-closed.
- Проверяются invalid replacement, все binding variants и 23 media mappings,
  Advisor continuity, roll-time B, replay/reconnect/restart, privacy и три
  новых production browser journey в дополнение к пяти существующим.
- #146 остаётся следующей задачей. Отсутствие equipment, финального сохранения
  и runtime progression по-прежнему явно; готовность V1 этим решением не
  заявляется.
