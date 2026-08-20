# ADR 0045 — Структурные последствия первых решений персонажа

- **Статус:** Принято
- **Дата:** 2026-08-20
- **Частично заменяет:** два утверждения
  [ADR 0041 §1](0041-character-wizard-set-decide.md) в пределах четырёх форм
  journey-state `RACE_AND_METHOD`
- **Дополняет:** host-signed application context
  [ADR 0044 §2 и §5](0044-character-stat-assignment-and-pure-class.md)

## Контекст и граница замены

ADR 0041 принимался до реализации механики характеристик и её source-backed
catalog view. Atlas называл consequence-поля, но не задавал их JSON-domain.
Поэтому единственной точной player-facing строкой была подпись selector.

Теперь host загружает и валидирует поставленные race/stat/modifier tables, а
методы создания представлены закрытой domain-таблицей. Прежнее решение не было
ошибкой: перестало выполняться условие, при котором оно было единственным
fail-closed вариантом.

Этот ADR дословно заменяет утверждение ADR 0041 §1:

> Текстовое consequence поле для выбранного значения равно exact selector
> label из Atlas, а не придуманному описанию механики:

В `CHR-010`, `CHR-016` и `CHR-002` selected consequence теперь является
структурой из source-backed значений. Запрет на придуманное описание механики
остаётся полностью в силе: prose из Rule/Q&A, пересказ правила и client-owned
числа в consequence не появляются.

ADR также узко заменяет часть следующего утверждения ADR 0041 §1:

> Missing key, omission вместо `null`, extra key и другой literal отклоняются.

Только слова `extra key` больше не означают, что формы `CHR-010`, `CHR-016`,
`CHR-036`, `CHR-002` навсегда ограничены ключами, перечисленными ADR 0041.
Later ADR может добавить exact host-signed application context сверх Atlas
`requiredFields`. Этот ADR добавляет ровно три ключа:
`raceConsequenceOptions`, `modeConsequenceOptions`,
`methodConsequenceOptions`; у `CHR-036` новых ключей нет. Любой другой extra,
missing option key, omission target `null` или неизвестный literal по-прежнему
отклоняется.

Это третье применение практики ADR 0044: `raceChoice` в §2 и `classOptions` в
§5 уже являются host-signed application context сверх Atlas required fields.
Screen contract продолжает сверять exact Atlas `requiredFields`; runtime
projection проверяется по более узкой полной application shape.

Одноимённые строки внутри durable `RACE_AND_METHOD` decision records являются
существующей audit/replay metadata, а не player form field. Они и exact command,
receipt, revision, lock и forward contracts ADR 0041 §2–§7 не меняются.

## Источники

Безусловные race facts находятся в
[`races.json`, строки 1–50](../../generated/spec/character/races.json#L1-L50):
`BaseSymbiontSlots`, `ClassPolicy`, два XP multiplier,
`SymbiontXPPolicy`, `SymbioticMonsterAllowed` и `Название`.

Подписи характеристик и canonical order находятся в
[`stats.json`, строки 1–100](../../generated/spec/character/stats.json#L1-L100).
Race modifier rows `SKILL_STAGE` находятся в
[`modifiers.json`, строки 1–131](../../generated/spec/character/modifiers.json#L1-L131).
Поставка отдельно фиксирует, что `FREE + RANDOM` означает отсутствие race
modifier, а не missing data:
[`rule-trace.json`, строки 44–56](../../generated/spec/character/rule-trace.json#L44-L56).

Число попыток, terminal alternative и обязательность пятого набора выводятся
из `CREATION_STAT_SET_DECISION_RULES` и
`deriveCreationStatAbandonment`, которые реализуют `CORE-160/161/162`.
Новых gameplay sources и числовых констант этот ADR не вводит.

## Решение

### 1. Initial projection и host-signed options

Target fields до selector остаются exact JSON `null`:

- `CHR-010.raceConsequencesPreview=null`;
- `CHR-016.modeConsequences=null`;
- `CHR-002.methodConsequences=null`.

Initial projection одновременно содержит полный option array, поэтому игрок
видит и сравнивает последствия **до** необратимого confirm:

- `CHR-010.raceConsequenceOptions` — exact order `UNITED,FREE,PURE`;
- `CHR-016.modeConsequenceOptions` — exact order `MANUAL,RANDOM` для committed
  `UNITED|FREE`;
- `CHR-002.methodConsequenceOptions` — exact order
  `CLASSIC,ADVENTUROUS,ALL_OR_NOTHING`.

Каждый array element является exact pair `{choice, consequence}` по именам
конкретной формы. Target consequence после client-local selector побайтово
равен вложенному consequence выбранного host option. Web не достраивает поля,
не вычисляет delta/total и не импортирует gameplay catalog. Choice enum в
confirm остаётся единственным client input.

Отвергнут полиморфный target field: array до выбора и один object после выбора
сэкономил бы три keys, но потребовал бы union в каждом decoder, отменил exact
initial `null` и сломал симметрию с `CHR-011.classOptions`.

### 2. Общие projection primitives

Структура modifier effect является exact union:

```text
{kind:"NO_STAT_MODIFIERS"}
|
{kind:"ADDITIVE_STAT_MODIFIERS",
 entries:[{statCode:"S"|"D"|"M"|"Z"|"I"|"W"|"C",
           statLabel:<stats.json Название>,delta:<safe integer>},...]}
```

`entries` sparse и canonical `stats.json.Порядок`. `NO_STAT_MODIFIERS`
является положительным фактом; empty array, loading sentinel и synthesized
zero rows запрещены. Для additive variant `entries` non-empty, StatCode unique,
а `delta` равен catalog modifier `Value`.

Player projection никогда не содержит `Rule ID`, `ModifierID`, `SourceType`,
`SourceID`, `ContextPredicate`, `ApplicationStage`, stack policy, source
question ID либо availability trace. Host строит allowlist object, а не spread
catalog row.

### 3. `raceConsequencesPreview` и условность `CHR-010`

Один `raceConsequenceOptions` element имеет exact shape
`{raceChoice,raceConsequencesPreview}`, где preview равен:

```text
{raceLabel:<races.json Название>,
 baseSymbiontSlots:<catalog integer>,
 classPolicy:"REQUIRED_PURE_CLASS"|"NO_CLASS",
 allocationXpMultiplier:<catalog integer>,
 directXpMultiplier:<catalog integer>,
 symbiontXpPolicy:"STANDARD_XP_AWARD"|"XP_AWARD_X2",
 symbioticMonsterAllowed:<catalog boolean>,
 raceStatModifiersByAcquisitionMode:
   {kind:"NOT_APPLICABLE"}
   |
   {kind:"DEPENDS_ON_SYMBIONT_ACQUISITION_MODE",
    alternatives:[<MANUAL mode option>,<RANDOM mode option>]}}
```

`PURE` использует `NOT_APPLICABLE`, потому что host route пропускает `CHR-016`.
Имя ключа намеренно ограничивает утверждение race modifiers: class modifiers
Чистого на том же `SKILL_STAGE` не объявляются неприменимыми.
`UNITED|FREE` используют второй variant. Условность выражена discriminator и
двумя полными alternatives, а не подписью, min/max или независимыми ranges.
Поэтому Web не может принять одну alternative за уже действующую.

H1 частично отвергнута. Безусловные race facts показываются на `CHR-010`, но
диапазон conditional modifiers запрещён: он потерял бы корреляцию одного mode
с целым набором delta и визуально допустил бы невозможные смешанные сочетания.
Обе exact alternatives являются истинными условными утверждениями при любом
последующем выборе.

### 4. `modeConsequences`

Один `modeConsequenceOptions` element имеет exact shape
`{symbiontAcquisitionMode,modeConsequences}`. Вложенный consequence, который
также повторён в race preview alternative, равен:

```text
{raceChoice:"UNITED"|"FREE",
 raceLabel:<races.json Название>,
 baseSymbiontSlots:<catalog integer>,
 statModifiers:<modifier effect>}
```

`modeConsequenceOptions` строится только для committed race и relationally
совпадает с двумя alternatives ранее опубликованного race option. Это не
durable link между presentations: обе projections независимо выводятся из
одного startup-loaded catalog.

`FREE + RANDOM` exact равен `statModifiers:{kind:"NO_STAT_MODIFIERS"}`.
Остальные три сочетания получают только matching `RACE + SKILL_STAGE +
creationMode` rows. `CHECK_CONTEXT`, PURE class и symbiont rows исключены.

### 5. `methodConsequences`

Один `methodConsequenceOptions` element имеет exact shape
`{statMethod,methodConsequences}`, где consequence равен:

```text
{maximumAttempts:1|2|5,
 rejectedSet:{irreversible:true,setValuesDiscarded:true,
              creationCriticalConsequencesDiscarded:true},
 terminalRule:
   {kind:"POINT_BUY_AFTER_REJECTION",afterAttempt:1|2,exactTotal:90|85}
   |
   {kind:"MANDATORY_ACCEPT",attemptIndex:5}}
```

Host группирует existing decision rows по method, требует один общий
`maximumAttempts`, проходит все rejectable attempts через existing abandonment
derivation и выводит terminal rule. Missing/duplicate attempt, другое total,
необязательный fifth либо несогласованные discard flags дают startup failure.
H3 подтверждена с этим уточнением: используются существующая table и её
existing derivation, новых source values нет.

### 6. Каталог, провенанс и локализация

Host startup catalog читает `races.json` и `stats.json`, сверяет exact code set
и order с validated skill-stage catalog и берёт modifier rows только из этого
catalog. Method options выводятся из existing domain decision table. В
production projection code нет gameplay чисел из таблиц выше.

Host передаёт:

- source-owned `raceLabel` и `statLabel`;
- все enum, booleans и числа механики;
- структурные связи condition/alternative/terminal rule.

Набор race facts здесь является scoped preview issue #127, а не заявлением о
полноте всей race-механики. `GrantedSkillRefs`, `CounterPointMultiplier` и
прочие не перечисленные постановкой факты не сериализуются и не объявляются
отсутствующими.

Web владеет только ADR-owned interface nouns и форматированием: заголовками
полей, `Да/Нет`, знаками `−` и `×`, table/card layout. Selector names остаются
Atlas labels из renderer registry. Эти labels не добавляют механику: Web не
переводит enum в delta, не выбирает alternative и не вычисляет multiplier,
attempt либо point-buy total.

### 7. Local draft, wire и совместимость

H2 подтверждена. Selector заменяет только client-local choice/consequence,
wire и durable write отсутствуют, `draftRevision` и entity revision vector
не меняются. Refresh теряет неподтверждённый выбор и снова публикует target
`null` с полным host-signed option array. Confirm request/receipt остаются
contract ADR 0041 без consequence payload.

H4 подтверждена. Три arrays находятся внутри opaque application
`roleFilteredPayload`; outer wire grammar, mandatory message fields,
discriminator и их semantics не меняются. По ADR 0020 §2 новый
`protocolVersion` не требуется. Старый decoder fail-closed отвергнет exact
application shape, которую не поддерживает.

### 8. Проверки

Тесты обязаны доказать:

1. три target fields initial exact `null`, а options доступны и отрисованы до
   selector;
2. `UNITED|FREE × MANUAL|RANDOM` совпадают между CHR-010 alternatives и
   CHR-016 options; ни одно число не меняет meaning после следующего выбора;
3. `FREE + RANDOM` имеет explicit `NO_STAT_MODIFIERS`;
4. все race/stat values получены из загруженного catalog, а method summary —
   из domain decision rows; drift/malformed source fail startup;
5. serialized player payload рекурсивно не содержит internal IDs, source
   fields, question IDs или trace;
6. selector каждого option даёт zero frame/write/revision и exact local copy;
7. strict decoder отклоняет missing/extra/malformed option, неверный order,
   смешанную condition branch и нарушение внутренних связей; подлинность
   игровых чисел доказывает catalog loader на host, Web её не дублирует;
8. три существующих `assertScreenContract` продолжают срабатывать по Atlas
   required fields.

## Последствия

Игрок сравнивает source-backed цену до необратимого confirm. CHR-010 не
утверждает будущий mode и не скрывает его цену; CHR-016 показывает exact
выбранную ветвь; CHR-002 объясняет attempts и terminal alternative без prose.

Цена решения — три supplemental arrays и строгая дублирующая валидация host и
Web. Дублирование двух mode alternatives между CHR-010 и CHR-016 намеренно:
оно сохраняет zero-wire local selectors и даёт relational acceptance proof.
