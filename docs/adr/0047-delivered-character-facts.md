# ADR 0047 — Поставленные факты выбора расы и навыков

- **Статус:** Принято
- **Дата:** 2026-08-21
- **Частично заменяет:** границу race facts
  [ADR 0045 §6](0045-character-decision-consequences.md) и exact shape
  `skillCardSummaries[]` [ADR 0046 §3](0046-character-starting-skills.md)
- **Дополняет:** `raceConsequencesPreview` [ADR 0045 §3](0045-character-decision-consequences.md)
  и `CHR-013|015` projections [ADR 0046 §3 и §7](0046-character-starting-skills.md)

## Контекст

После ADR 0045 игрок сравнивает структурные последствия выбора расы на
`CHR-010`, но не видит один уже поставленный race fact. `races.json` задаёт
`GrantedSkillRefs="FOLLOWING_PAIN"` для `UNITED`; у `PURE|FREE` поле
отсутствует. Ссылка означает бесплатный навык «Идущий вслед за болью». Она уже
валидируется skill-stage catalog как единственный `FIXED_RACE_PASSIVE` с
`FIXED_0`, но не входит в race preview.

После ADR 0046 игрок видит на `CHR-013` название навыка, требования,
доступность и цены уровней, а на `CHR-015` — соответствующий eligible subset.
При этом `skills.json` содержит ещё два player-facing факта:

- `BonusDomain / Scope` — непустой source text у всех 45 навыков;
- `MissingSkillPenalty` — signed integer у 15 навыков и отсутствие property у
  остальных 30.

На 41 `SELECTABLE_GENERAL` skill приходится 15 present и 26 absent
`MissingSkillPenalty`. Отсутствие является поставленным фактом, а не loading,
не неизвестным значением и не нулём.

Новые поля не являются игровой механикой. Host не вычисляет effect, не
применяет штраф и не добавляет правило в domain: он переносит разрешённые
source facts в player-facing allowlist и продолжает доверять существующим
domain validators для identity и joins.

## Первая узкая замена: граница ADR 0045 §6

ADR 0045 §6 дословно утверждает:

> Набор race facts здесь является scoped preview issue #127, а не заявлением о
> полноте всей race-механики. `GrantedSkillRefs`, `CounterPointMultiplier` и
> прочие не перечисленные постановкой факты не сериализуются и не объявляются
> отсутствующими.

Это решение было верным. В issue #127 player-facing skill catalog ещё не был
опубликован. Сериализовать raw `GrantedSkillRefs` означало бы либо раскрыть
внутреннюю ссылку без понятной игроку подписи, либо сочинить label и
представление вне подтверждённого каталога. Scoped preview честно не заявлял
полноту race-механики.

После #130 перестала выполняться именно эта предпосылка. ADR 0046 и
`CreationSkillCatalog` теперь дают cross-validated public `skillId`, label из
`skills.json.Название` и fail-closed join с `SkillStageCatalog`. Ссылка может
быть разрешена в player-facing object без raw `SkillID`, spread строки или
придуманной прозы.

По прецеденту issue #127 и ADR 0045 прежнее решение не объявляется ошибкой и
не переписывается задним числом. Этот ADR заменяет только слова о
`GrantedSkillRefs`: теперь этот один race fact сериализуется и его отсутствие
выражается положительно.

Остальная граница процитированного абзаца сохраняется. В частности,
`CounterPointMultiplier` и любые другие ранее не опубликованные и не названные
этой задачей race facts не добавляются и не объявляются отсутствующими.
Существующие поля ADR 0045, включая `allocationXpMultiplier`, остаются без
изменений; это не новые факты данного ADR.

## Вторая узкая замена: умолчание ADR 0046 §3

ADR 0046 §3 дословно задаёт exact shape:

```text
{skillId,skillLabel,
 eligibility:"ELIGIBLE"|"REQUIREMENTS_NOT_MET",
 requirements:[{statCode,statLabel,minValue,currentValue,satisfied},...],
 levelOptions:[{targetBonus,slotCost},...]}
```

Этот закрытый shape не содержит `BonusDomain / Scope` и
`MissingSkillPenalty`, поэтому current strict projection законно их не
принимает. Однако ADR 0046 не называл их исключёнными, не обсуждал их
player-facing ценность и не устанавливал privacy-запрет. Его explicit
exclusion list относится к raw identity и provenance: `SkillID`, requirement и
Rule IDs, source question, evaluation stage, predicates и trace.

Следовательно, отсутствие двух полей было умолчанием ограниченного slice, а не
решением скрывать содержание навыка. Этот ADR дословно заменяет приведённый
shape расширенным exact shape ниже. Остальные поля и их semantics остаются
прежними.

## Решение

### 1. Бесплатные race skills на `CHR-010`

Каждый `raceConsequencesPreview` получает обязательное поле exact union:

```text
grantedSkills:
  {kind:"NO_GRANTED_SKILLS"}
  |
  {kind:"GRANTED_SKILLS",
   entries:[{skillId,skillLabel}]}
```

Вариант `GRANTED_SKILLS` имеет non-empty `entries`. В текущей поставке его
получает только `UNITED`, и массив содержит ровно один элемент для
`FOLLOWING_PAIN`. `PURE|FREE` получают exact
`{kind:"NO_GRANTED_SKILLS"}`. Empty `entries`, `null`, omission и generic
`UNKNOWN` запрещены.

`skillId` равен validated public `SkillKey`; `skillLabel` побайтово берётся из
`skills.json.Название`. Raw `SkillID`, `Категория`, `SlotCostMode`, `MaxBonus`,
bonus и slot cost в этот object не входят. Поле сообщает ровно разрешённый
`GrantedSkillRefs` и понятное игроку имя, а не содержание всей referenced
skill row.

`grantedSkills` является частью каждого host-signed
`raceConsequenceOptions[].raceConsequencesPreview`. После client-local выбора
target `raceConsequencesPreview` остаётся exact copy вложенного option, как
требует ADR 0045 §1. Web не выполняет второй join и не достраивает отсутствие.

Host сопоставляет `SkillStageCatalog.races[].grantedSkillRefs` с уже
санитизированным `CreationSkillCatalog.skillLabels`. Unknown, duplicate,
несовпадающая cardinality, несуществующий public skill либо потерянный label
дают startup failure. Production projection не содержит literals текущего
`FOLLOWING_PAIN` label.

### 2. Расширенный selectable skill summary

Каждый из 41 элементов `CHR-013.skillCardSummaries[]` получает exact shape:

```text
{skillId,skillLabel,
 bonusDomainScope:<exact non-empty skills.json "BonusDomain / Scope">,
 missingSkillPenalty:
   {kind:"NO_MISSING_SKILL_PENALTY"}
   |
   {kind:"MISSING_SKILL_PENALTY",value:<source signed safe integer>},
 eligibility:"ELIGIBLE"|"REQUIREMENTS_NOT_MET",
 requirements:[{statCode,statLabel,minValue,currentValue,satisfied},...],
 levelOptions:[{targetBonus,slotCost},...]}
```

Имена `bonusDomainScope`, `missingSkillPenalty`, обоих `kind` и `value` —
project-owned serialization nouns. Они не являются новыми source columns или
domain terms.

`bonusDomainScope` равен исходной строке целиком. Host проверяет только string
type и non-empty value, но не переводит, не пересказывает, не сокращает, не
нормализует язык и не меняет пунктуацию. Английские строки в поставке остаются
английскими. Web может добавить только собственный heading/layout вокруг
строки, но не заменить её содержимое.

Если raw row имеет own property `MissingSkillPenalty`, host требует signed
safe integer, сверяет его с `SkillStageCatalog.missingSkillPenalty` и публикует
`{kind:"MISSING_SKILL_PENALTY",value}`. Знак сохраняется; Web не превращает
значение в абсолютную величину и не добавляет второй минус. Текущая поставка
содержит только отрицательные значения, но их знак не становится application
invariant: согласованное source/domain значение `0` или больше также
переносится дословно.

Если own property отсутствует и domain value также отсутствует, host публикует
`{kind:"NO_MISSING_SKILL_PENALTY"}`. Explicit `null`, omission union из player
payload, zero по умолчанию и empty object запрещены. Расхождение presence либо
value между raw source и validated catalog означает drift и fail-closed.

Production code не содержит список `-2|-3|-5|-10`: текущие значения являются
данными поставки, а не закрытой application enum. Source substitution test
обязан доказать, что другое signed safe integer из согласованного fixture
проходит в allowlist без переписывания projection code.

### 3. `CHR-015` получает exact eligible copy

`CHR-015.skillOptions[]` остаётся canonical eligible subset соответствующих
`CHR-013.skillCardSummaries[]`. Каждый option сохраняет существующие
`skillId`, `skillLabel`, `levelOptions` и дополнительно получает exact
`bonusDomainScope` и `missingSkillPenalty` того же catalog entry.

Для одного `skillId` эти четыре source-owned поля обязаны быть глубоко равны
между `CHR-013` card и `CHR-015` option. Web decoder проверяет exact shape и
subset order; он не копирует content из предыдущего mounted screen и не
восстанавливает его из cache. Refresh/reconnect получает те же значения от
host catalog.

Недоступные skills остаются видимыми с content на `CHR-013`, но не появляются
в eligible-only `CHR-015.skillOptions`. Это прежняя availability semantics ADR
0046, не новая фильтрация.

Четыре fixed skills не входят в `skillCardSummaries` или `skillOptions`.
`mandatoryClassSkillOrNull`, `racialFreeSkills` и другие fixed source objects
этим ADR не расширяются content/penalty fields. `FOLLOWING_PAIN` показывается
на `CHR-010` только согласованным §1 именем.

### 4. Privacy и allowlist

Host по-прежнему конструирует новые objects явным allowlist. Запрещён spread
raw race, skill или requirement row. Player payload не содержит:

- raw `SkillID`, `RequirementID`, `RequirementSetID`;
- Rule ID, source question ID, evaluation stage и trace;
- `Категория`, `OwnerScopeAllowed`, `CheckTags`;
- `GrantedSkillRefs` как raw string;
- `CounterPointMultiplier` и другие неназванные race facts.

`skillId` не является raw `SkillID`: это уже принятый ADR 0046 public alias
validated `SkillKey`. `bonusDomainScope` является разрешённым целым source
text, а не возможностью сериализовать соседние columns.

Serialized-payload tests обязательны отдельно для `CHR-010` и skill
projections. Проверка должна проходить рекурсивный JSON и доказывать отсутствие
internal keys/IDs в фактическом player payload, а не только в TypeScript type.

### 5. Domain, shared wire и revisions

Domain не меняется. `grantedSkillRefs` и optional `missingSkillPenalty` уже
загружены и валидируются `SkillStageCatalog`; `BonusDomain / Scope` является
presentation text. Новые resolver, gameplay rule либо fallback в `src/domain`
не нужны.

Shared wire не меняется. Все поля находятся внутри opaque application
`roleFilteredPayload`; message discriminator, required wire fields и
`protocolVersion` прежние. Strict old decoder законно отвергнет неизвестный
application shape, но новая версия outer protocol не требуется.

Новые facts сами по себе дают `+0` ко всем revision axes и не создают command,
receipt, checkpoint или durable stage:

- `CHR-010` selector продолжает менять только client-local choice и exact
  selected option copy;
- `CHR-013` остаётся read-only catalog projection;
- `CHR-015` add/remove остаются client-local, а host options immutable.

Это нулевая **дополнительная** дельта данного ADR. Existing normative
`CHR-013 → CHR-015` presentation advance по ADR 0046 может дать только
`projectionRevision +1`, а successful selection confirm сохраняет прежние
durable deltas. Этот ADR не отменяет, не добавляет и не переопределяет их.

### 6. Exact forms и renderer

Меняются application shapes только трёх уже опубликованных forms:
`CHR-010`, `CHR-013`, `CHR-015`. Их Atlas `requiredFields`, route, form type и
actions не меняются. Существующие `assertScreenContract` продолжают проверять
поставленный screen contract; host/web decoders дополнительно проверяют более
узкий ADR-owned shape.

Web рендерит host facts. Он не импортирует gameplay catalog, не переводит
`SkillKey` в label, не решает presence penalty и не выбирает race variant.
DOM, a11y text и local projection должны использовать те же exact values,
которые прошли decoder.

## Проверки

Тесты обязаны доказать:

1. `UNITED` получает exact singleton `GRANTED_SKILLS`, а `PURE|FREE` —
   `NO_GRANTED_SKILLS` без empty/null fallback;
2. изменение source `Название` в согласованном fixture доходит до `CHR-010`;
3. все 41 `CHR-013` cards несут non-empty exact `bonusDomainScope`;
4. source text с английским языком и пунктуацией приходит без изменения;
5. 15 present penalties получают value variant, а 26 absent selectable rows —
   positive no-penalty variant;
6. source substitution text и signed penalty проходят в catalog/projection;
7. `CHR-015.skillOptions` является exact eligible subset и relational copy
   source-owned content `CHR-013`;
8. malformed union, null, omission, extra key, неверный value type и mixed
   variant fail closed с exact path;
9. serialized `CHR-010`, `CHR-013` и `CHR-015` payload не содержит internal
   identity, provenance и неназванные race facts;
10. selector/local edit не создаёт frame, write или revision, а существующие
    navigation/confirm deltas не меняются;
11. `assertScreenContract` продолжает срабатывать на всех трёх forms.

## Границы

- `artifacts/**` read-only; `generated/**` вручную не меняется.
- Добавляется ровно разрешение `GrantedSkillRefs`; другие новые race facts не
  входят.
- Mechanics выбора расы и навыков, slots, requirements, exact-fill, commands,
  locks, receipts и reconnect contract не меняются.
- `CHR-014`, её content card, actions и весь #129 исключены.
- Fixed skill content вне §1 label не публикуется.
- Перевод и редактура `BonusDomain / Scope` требуют нового source, а не
  client-side локализации этого ADR.

## Совместимость и последствия

ADR 0045 сохраняет structural race preview, conditional mode alternatives и
local selector semantics. ADR 0046 сохраняет eligibility, requirement
explanation, level options, fixed sources и единственный durable exact-fill
confirm. Изменяются только allowlisted facts внутри их projections.

Игрок до выбора расы видит наличие бесплатного навыка, а до выбора навыка —
его поставленное назначение и цену отсутствия. Отсутствующие penalty/race grant
не выглядят как незагруженные данные. Host остаётся единственным владельцем
catalog join, а Web — только renderer.

## Отвергнутые альтернативы

- Raw `GrantedSkillRefs` либо `SkillID` — раскрывают внутреннюю identity без
  player label.
- Empty array или `null` для отсутствия — не отличают поставленное «нет» от
  omission/loading.
- Bonus/slot в `CHR-010.grantedSkills` — расширяют часть 1 сверх разрешённого
  ref и label.
- `MissingSkillPenalty:null` либо подставленный `0` при absent source property —
  смешивает absence с механическим значением; явный source `0` остаётся
  разрешённым value variant.
- Hard-coded penalty enum — превращает текущую population в application rule.
- Перевод или пересказ `BonusDomain / Scope` — создаёт строку без source.
- Content только на `CHR-013` — оставляет actual selector `CHR-015` без тех же
  facts; content только на `CHR-015` скрывает его из catalog summary.
- Обогащение fixed skills, `CHR-014` или других race facts — выходит за
  разрешённую границу.
