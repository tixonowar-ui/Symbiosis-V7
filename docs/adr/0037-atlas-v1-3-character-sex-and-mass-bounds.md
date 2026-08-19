# ADR 0037 — Atlas v1.3: пол персонажа и границы массы

- **Статус:** принято
- **Дата:** 2026-08-19
- **Частично заменяет:** действующий Atlas и digest-утверждение
  [ADR 0003](0003-source-of-truth-order.md); freeze ADR 0028 §6 только для
  снятия трёх identity-draft v2 cases; initial fields ADR 0029 §§1, 7 и вывод о
  неизменном shared-v2 shape; exact identity-draft wire ADR 0033 §1,
  checkpoint payload ADR 0033 §3 и связанные compatibility/rationale/
  alternatives; version statements ADR 0035 §3 и compatibility; mass domain
  ADR 0033 §2; первую отсутствующую предпосылку auto-selection
  [ADR 0036](0036-local-character-portrait-catalog.md)
- **Дополняет:** versioning [ADR 0020](0020-wire-protocol-and-shared-contracts.md),
  checkpoint [ADR 0025](0025-character-draft-checkpoint-scope.md) и generated
  policy [ADR 0016](0016-what-generated-is-committed.md)

## Контекст

Поставленный Atlas v1.2 не содержит пола персонажа. `CHR-001` перечисляет
ровно одиннадцать required fields, а её purpose, acceptance criterion и
`QA-FORM-CHR-001` повторяют тот же контракт:

- [`$.forms[59].purpose/requiredFields[0..10]`, строки 54457–54485](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54457-L54485);
- [`$.forms[59].acceptanceCriteria[4]`, строка 54877](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54877);
- [`$.qaScenarios[146]`, `QA-FORM-CHR-001`, строки 228030–228033](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L228030-L228033).

Owner поставил более позднее решение: пол обязателен при локальном создании,
имеет два значения, изменяется пока открыт identity draft и замораживается
после checkpoint. То же решение задаёт двенадцать конечных границ массы по
расе и полу. Раса выбирается только на `CHR-010`, поэтому эти границы нельзя
честно проверить на более ранней `CHR-001`.

Старый Q&A утверждает, что приложение не вводит придуманных minimum/maximum:
[`$.registryCoverage.qna[305]`, `Q-CHAR-010`, строки 264253–264270](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L264253-L264270).
Он ниже Atlas и ADR по ADR 0003; переписывать исходный answer нельзя, потому
что у Q&A есть отдельный `laterAuthorOverride`. Прецедент непустого override —
[`$.registryCoverage.qna[267]`, `Q-SYM-092`, строки 263492–263507](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L263492-L263507).

### Печатные зеркала guard-прозы

Состав обязательных identity fields повторён не только в четырёх form/QA
местах. Entry formula имеет пять зеркал:

1. `$.journeys[1].steps[0].guards`, `J-CHAR-CREATE/DRAFT_IDENTITY`;
2. `APP-004::CTA::001.guard`;
3. `APP-004.transitionsOut`, exact `APP-004→CHR-001` subflow;
4. `CHR-001.transitionsIn`, тот же exact subflow;
5. `$.transitions[2]`, тот же exact tuple.

Checkpoint formula имеет четыре зеркала:

1. `CHR-001::CTA::001.guard`;
2. `CHR-001.transitionsOut`, exact `CHR-001→CHR-010` workflow command;
3. `CHR-010.transitionsIn`, тот же exact workflow command;
4. `$.transitions[1261]`, тот же exact tuple.

Raw anchors: [`journeys[1]`, строка 1983](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L1983),
[`APP-004`, строки 29687–29693 и 30226–30232](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L29687-L30232),
[`CHR-001/CHR-010`, строки 54560–55464](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54560-L55464),
[`transitions[2]`, строка 215465](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L215465) и
[`transitions[1261]`, строка 224278](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L224278).
`CHR-001.states.IDENTITY_INCOMPLETE` — десятое enumerative зеркало.

## Что следует из источников и что является проектным выбором

Из owner delivery дословно следуют два значения пола, обязательность и
двенадцать endpoints массы. Из текущего Atlas следует, что `CHR-001` принимает
положительную массу с шагом 0,1 и оставляет approval мастеру, а `CHR-025`
владеет final `identityAndMassStatus`:
[`$.forms[59].requiredFields[5..7]`, строки 54479–54481](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54479-L54481),
[`$.forms[89].requiredFields[0..2]`, строки 69402–69405](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L69402-L69405).

Источники не задают английское имя JSON field, enum codes, transport
versioning перехода, способ проверки свободной guard-прозы или алгоритмы
`graphDigest`/`contentDigest`. Следующие разделы называют эти места проектным
выбором, а не выводом из похожего поля.

## Решение

### 1. Exact поле пола

В `CHR-001.requiredFields` после `age(required)` добавляется exact literal:

```text
sex(required; MALE|FEMALE; mutable until IDENTITY checkpoint, immutable after)
```

JSON key — exact `sex`. Closed domain — exact uppercase strings `MALE` и
`FEMALE`; case-fold, aliases, boolean и numeric codes запрещены. Initial
runtime draft несёт `sex:null`, пока пользователь не сделал выбор. `null` не
валиден для Continue, но остаётся честным состоянием незаполненного required
input по ADR 0029.

Изменение `sex` внутри того же draft — обычный full replacement ADR 0033:
оно участвует в exact request identity, dirty/coalescing, увеличивает
`draftRevision` и shell `projectionRevision` один раз при изменившемся
confirmed value. No-op и exact replay дают `+0`. После successful IDENTITY
checkpoint runtime scope заканчивается; durable identity содержит выбранный
code, а последующая mutation пола запрещена.

Missing `sex`, extra key или неверный JSON type получает existing
`protocol.refusal` до handler. Строка вне `MALE|FEMALE` получает
`UNRECOGNIZED` с path `$.values.sex` и exact непризнанным value. Новый
application `INVALID_FIELD` reason не вводится.

Пол не становится общим player profile, race field, portrait selector rule
или полем другой формы. `CHR-025.identityAndMassStatus` использует frozen
identity value, но отдельного `sex` required field или payload там не
появляется.

### 2. Границы массы принадлежат final проверке CHR-025

`CHR-001.massKg` сохраняет прежний input contract: finite число `>0` с exact
шагом 0,1. Ни race, ни final minimum/maximum на этой форме не проверяются;
`massApprovalStatus=PENDING_GM` и `anatomyProfile=STANDARD_HUMANOID`
сохраняются.

`CHR-025.requiredFields[1]` заменяется следующим exact literal; его дословное
QA mirror обновляется вместе с form:

```text
identityAndMassStatus(sex=MALE|FEMALE frozen after IDENTITY checkpoint; inclusive creation massKg bounds by race/sex: PURE/MALE=60..400kg, PURE/FEMALE=40..350kg, UNITED/MALE=30..150kg, UNITED/FEMALE=25..120kg, FREE/MALE=40..200kg, FREE/FEMALE=30..160kg; massApprovalStatus=PENDING_GM after range validation)
```

Тем самым сам field contract, а не только ADR prose, проверяет frozen sex,
выбранную race и следующие endpoints:

| Race enum | `MALE`, кг | `FEMALE`, кг |
| --------- | ---------- | ------------ |
| `PURE`    | 60–400     | 40–350       |
| `UNITED`  | 30–150     | 25–120       |
| `FREE`    | 40–200     | 30–160       |

Это inclusive final creation bounds, не справочные средние. Никакое
rounding, дополнительный step, fallback или число за пределами таблицы не
вводится. Границы не применяются к NPC, ENM или уже существующим персонажам.
`PENDING_GM` после range-check сохраняется: range отсекает невозможное, GM
подтверждает правдоподобие.

Абсолютная фраза ADR 0033 §2 «domain upper bound отсутствует» заменяется:
upper bound отсутствует на pre-race `CHR-001` transport, но появляется как
race-and-sex-specific final predicate `CHR-025`. Runtime этого PR не реализует
`CHR-025`; он только принимает и переносит новый identity field.

### 3. Form, QA и guard mirrors

Purpose `CHR-001`, её required fields, acceptance literal и
`QA-FORM-CHR-001.scenario` обновляются согласованно. Component становится
`Name/age/sex`; `IDENTITY_INCOMPLETE` перечисляет `name/age/sex/mass`.

Exact `IDENTITY_INCOMPLETE` literal:

```text
Continue is absent until name/age/sex/positive 0.1kg mass validate.
```

Entry mirrors сохраняют authored enumerative prose и получают exact строку:

```text
Новый immutable UUID; обязательны имя, возраст, пол и положительная massKg 0,1; описание/арт необязательны.
```

Continue mirrors получают exact строку:

```text
UI-CMD-CHAR-WIZARD-CHECKPOINT stage=IDENTITY; name/age/sex present; massKg>0 at step 0.1; immutable draft UUID committed
```

`tools/validate` получает две раздельные fail-closed проверки:

1. для каждой Atlas form exact `purpose` и `requiredFields.join(', ')`
   присутствуют в единственном `QA-FORM-<id>.scenario`, а acceptance содержит
   ровно один exact `Назначение реализовано буквально: <purpose>`. Expected QA
   id встречается ровно один раз в `form.qaScenarioIds`, ровно одна QA row имеет
   этот `qaId`, её `scope === form.id`, а scenario содержит exact
   `Поля: ${requiredFields.join(', ')}.`;
2. десять структурно найденных identity mirrors целиком равны трём exact
   литералам этого раздела: пяти entry, четырём Continue и одному
   `IDENTITY_INCOMPLETE`.

Guard rows находятся по form/journey/action/transition IDs и tuple, не по
array index. Проверка ловит одиночный drift и синхронную замену всех копий на
другую строку, потому что сравнивает их с ADR-owned literals.

Validator намеренно не пытается выводить смысл произвольной guard-прозы и не
объявляет generic parser: Atlas не задаёт её grammar, а в каталоге есть
законные action/transition guards с разной формулировкой. Поэтому новые
семантически похожие mirrors нельзя обнаружить по эвристике; будущая поставка
обязана явно расширить структурный список ADR. Это названная граница проверки,
а не молчаливый пробел.

### 4. Q-CHAR-010

Исходные `question` и `answer` Q&A не редактируются. Для `Q-CHAR-010`:

- `CHR-001` добавляется в `formIds`;
- `coverageType` становится `MATERIALIZED_WITH_LATER_AUTHOR_OVERRIDE`;
- `laterAuthorOverride` получает exact значение ниже;
- связанный QA row синхронизирует form list.

```text
Later author decision 2026-08-18 applies only to local character creation: CHR-001 requires sex=MALE|FEMALE, mutable until the IDENTITY checkpoint and immutable after it, while its massKg input remains any positive value at the existing exact 0.1kg step. CHR-025 validates inclusive creation massKg bounds by race/sex: PURE/MALE=60..400kg, PURE/FEMALE=40..350kg, UNITED/MALE=30..150kg, UNITED/FEMALE=25..120kg, FREE/MALE=40..200kg, FREE/FEMALE=30..160kg; massApprovalStatus=PENDING_GM remains after range validation. These bounds are not reference race averages. For CHR-025 this override replaces only the conflicting no-minimum/maximum statement; the original approval and anatomy semantics remain effective. The original answer remains effective for CHR-018, CHR-033, NET-019, NET-021, NPC-011 and ENM-013.
```

Так более поздний авторский override видим рядом с исходным ответом и следует
прецеденту `Q-SYM-092`, не переписывая младший источник задним числом.

### 5. Atlas v1.3, provenance, counts и digests

Физический санкционированный файл сохраняет имя
`Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json`, но его `atlasVersion` становится
`1.3`, а `releaseDate` — `2026-08-18`. `$schema=...:1.2` и
`schemaVersion=1.2.0` остаются: JSON structure не меняется, меняется content.
Markdown v1.2 не входит в санкцию и остаётся историческим companion.

`sourceRefs` остаётся без изменений: нового physical source file с проверяемыми
`sha256` и `sizeBytes` не поставлено; owner decision поднято в этот ADR, а не
маскируется под artifact file. `changeControl` также остаётся без изменений:
это partition относительно legacy v1.1, а не release log; `APP-004`,
`CHR-001`, `CHR-010` и `CHR-025` уже находятся в
`materiallyRedefinedLegacyFormIds`.

Все 21 declared count остаются прежними. Не добавляются forms, transitions,
journeys, QA rows, Q&A rows, actions или origin labels; меняется только их
content. В частности, `counts.byType.component` считает forms типа component,
а не элементы `forms[*].components`. `CURRENT_ATLAS_FORM_ORIGIN` остаётся
`v1.2-web`, потому что это provenance 21 форм, введённых тем выпуском.

Алгоритмы semantic `graphDigest` и `contentDigest` не поставлены. Проектный
выбор — не пересчитывать и не подменять их SHA-256 всего файла: оба значения
остаются author-supplied digests базового графа/content v1.2. Тест сохраняет
литералы, но явно называет их historical base-v1.2 digests. Такой же выбор уже
зафиксирован при owner-authorized правке Atlas в PR #79.

Актуальную byte integrity v1.3 JSON обеспечивает пересчитанный
`artifacts/CHECKSUMS.sha256`. `atlasVersion`/`releaseDate` отличают amendment,
а ADR запрещает выдавать исторические semantic digests за hash новых bytes.

### 6. Identity-draft переходит на protocolVersion 3

Путь same-v2 pre-adoption закрыт. Wire v2 принят в `main` PR #87, а три
identity-draft discriminator вошли в production path PR #102. По ADR 0028 §6
adoption — репозиторное, необратимое событие, не deployment-факт. Кроме того,
`npm start` может обслуживать ранее собранный `dist/web`, а открытая старая
вкладка может reconnect к новому host; атомарная co-delivery не гарантирована.
Отсутствие SQLite checkpoint rows не возвращает pre-adoption window.

Три exact envelope получают `protocolVersion:3`:

- `character.identity-draft.replace` с шестиключевым `values`, включая `sex`;
- `character.identity-draft.result` с тем же confirmed field в presentation;
- `character.identity-draft.refusal`, коррелированный с v3 request.

`protocolVersion` продолжает обозначать generation grammar и semantics exact
envelope, а не единственную версию WebSocket connection. Соединение уже
совмещает v1 command и v2 session/navigation; теперь оно также допускает v3
identity-draft. Unchanged v1 command, v2 reconnect, navigation и generic
`projection.snapshot` остаются на своих версиях.

`projection.snapshot` сохраняет v2 envelope shape: form-specific
`roleFilteredPayload` остаётся generic JSON object, а его exact CHR-001 catalog
contract обновляется Atlas v1.3. Старый client, не знающий `sex`, отвергает
такой form payload fail-closed и сохраняет последнюю confirmed projection; это
catalog incompatibility, не permissive use unknown field.

ADR 0037 узко заменяет freeze ADR 0028 §6 только для снятия трёх уже принятых
identity-draft v2 cases; остальные v2 discriminator, shape, value domains и
semantics не меняются. V2 codec больше не считает
`character.identity-draft.replace|result|refusal` известными cases:

- старый five-key replace получает checked v1 `protocol.refusal` с
  `{code:"UNRECOGNIZED",path:"$.messageType",value:"character.identity-draft.replace"}`;
- если новый Web получит v2 result/refusal, он отвечает тем же checked refusal
  с exact discriminator в `value`, не применяет frame и закрывает mutation
  path;
- peer, не понимающий `protocolVersion:3`, отказывается по своей existing
  version check. Negotiation или permissive fallback не добавляются.

V3 missing/unknown handling остаётся exact. Merge реализации #105 является
необратимой adoption boundary этих v3 shapes; следующее изменение
обязательного поля снова требует новой версии.

Durable migration не нужна: production #102 хранит identity draft и journal
только в памяти host instance, а checkpoint command остаётся не реализован.

Future v1 checkpoint `command.request` сохраняет generic wire-v1 envelope, но
его exact application payload из ADR 0033 §3 заменяется на:

```text
{stage:"IDENTITY",characterDraftId,wizardCheckpointId,draftRevision,
 name,description,artAssetKeyOrLocalFile,age,sex,massKg}
```

`sex` в нём обязан совпасть с current confirmed frozen-ready draft; host не
выводит его из portrait key, race или другого поля.

### 7. Portrait mapping остаётся отложенным

Этот ADR заменяет только утверждение ADR 0036 §6, что sex input отсутствует.
Он не вводит `race + sex → portrait`: race выбирается позже на `CHR-010`, initial
`raceChoice` там `null`, а owner оставил mapping задачам V2/V4. Initial art на
`CHR-001` остаётся `null` либо явным пользовательским выбором.

## Совместимость с принятыми ADR

| ADR    | Совместимость                                                                                |
| ------ | -------------------------------------------------------------------------------------------- |
| `0003` | Source order сохранён; текущий JSON amendment v1.3 заменяет только паспорт/digest scope v1.2 |
| `0016` | Generated spec/types остаются выводом importer; media/seed policy не меняется                |
| `0018` | Revision triples и safe-integer boundary не меняются                                         |
| `0020` | Правило mandatory-field version bump исполнено через v3                                      |
| `0025` | Future exact durable request включает frozen sex; существующих rows нет                      |
| `0029` | Initial null сохраняется; exact CHR-001 field set дополнен sex                               |
| `0031` | Sex replacement меняет только прежние draft/shell projection axes                            |
| `0032` | Library projection не меняется до будущего durable checkpoint                                |
| `0033` | Full replacement/order/refusals сохранены; v2 shape и absolute mass statement заменены       |
| `0034` | `raceChoice:null` сохраняет границу между ранним mass input и final validation               |
| `0036` | Catalog/manual selection сохраняются; только premise об отсутствии sex заменена              |

## Обоснование

Пол принадлежит identity draft, потому что owner сделал его обязательной и
после checkpoint неизменяемой частью идентичности. Final mass predicate
принадлежит `CHR-025`, потому что только там уже известны и race, и frozen sex.
Так ранний input не угадывает будущую race, а final validation получает все
два входа.

V3 сохраняет смысл `protocolVersion` и fail-closed поведение при реально
возможном skew host/web. Исторические semantic digests честнее оставить с
явным scope, чем фабриковать неизвестный алгоритм; checksum решает другую,
байтовую задачу.

Точный validator registry делает нынешние free-text mirrors проверяемыми без
ложного обещания универсально понимать человеческую guard-прозу.

## Отвергнутые альтернативы

| Вариант                                              | Причина отказа                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Same-v2 как pre-adoption                             | V2 уже принят repo-wide; old `dist/web`/tab против нового host возможны      |
| Объявить `protocolVersion` версией всего socket      | Уже сосуществуют v1 command и v2 session; это расширило бы unrelated grammar |
| Проверять final bounds на CHR-001                    | Race ещё не выбрана                                                          |
| Применить bounds к NPC/ENM                           | Owner ограничил решение локальным созданием                                  |
| Добавить averages, rounding или соседние test values | Источник даёт только двенадцать endpoints                                    |
| Пересчитать semantic digests                         | Алгоритм отсутствует; file SHA не доказан как тот же contract                |
| Обнулить/удалить digests                             | Меняет schema и теряет provenance base v1.2 без необходимости                |
| Добавить ADR/issue в `sourceRefs`                    | Это не physical artifact с digest/size; ADR уже выше по source order         |
| Переписать Q&A answer                                | Для позднего решения существует `laterAuthorOverride`                        |
| Generic parser guard-прозы                           | Atlas не задаёт grammar; heuristic дала бы ложную полноту                    |
| Автовыбрать портрет                                  | Mapping отложен, race ещё не известна на CHR-001                             |

## Последствия

- Atlas JSON становится content release v1.3 внутри прежнего санкционированного
  physical path; Markdown v1.2 остаётся историческим.
- CHR-001 host/web/shared contract переносит required `sex`; unknown value
  отказывается с exact path/value.
- CHR-025 source contract получает только двенадцать supplied endpoints;
  runtime final validation остаётся будущей реализацией формы.
- Identity-draft v3 заменяет три v2 discriminator; остальные wire generations
  не меняются.
- Validate закрывает четыре form/QA repeats и десять известных guard mirrors;
  будущая новая prose location требует явного расширения registry.
- `Q-CHAR-010` сохраняет исходный answer и показывает later author override.
- До checkpoint нет durable migration; остаток #97 обязан сохранять уже
  шестиполевый v3 request.
- Race/sex portrait mapping, Continue, checkpoint и CHR-010 runtime не входят
  в этот PR.
