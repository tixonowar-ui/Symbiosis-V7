# ADR 0040 — Заглушка портрета назначается при финальном сохранении

- **Статус:** принято
- **Дата:** 2026-08-19
- **Частично заменяет:** в
  [ADR 0036 §6](0036-local-character-portrait-catalog.md#6-автоматический-выбор-отложен)
  запрет автоматического выбора и отсутствие mapping; initial `null` на
  `CHR-001` и запрет выводить семантику из filenames остаются в силе
- **Частично заменяет:** в
  [ADR 0037 §7](0037-atlas-v1-3-character-sex-and-mass-bounds.md#7-portrait-mapping-остаётся-отложенным)
  отложенный статус `race + sex → portrait` и фразу о будущем решении owner;
  последний тезис об initial `CHR-001.artAssetKeyOrLocalFile` остаётся в силе

## Контекст

Каталог ADR 0036 поставляет шесть exact asset keys, но намеренно не приписывает
словам `free`, `pure`, `unified`, `female`, `male` предметную семантику.
ADR 0037 добавил обязательный `sex=MALE|FEMALE`, но сохранил mapping
отложенным, потому что `raceChoice` появляется только после `CHR-001`.

Atlas подтверждает эту временную границу. `CHR-010` выбирает exact
`raceChoice=UNITED|FREE|PURE` в
[`$.forms[60].requiredFields[1]`, строка 54919][atlas-chr-010]. `CHR-025`
имеет frozen sex, race-and-sex final validation, `finalSaveStatus` и единое
атомарное финальное сохранение в
[`$.forms[89].requiredFields/components`, строки 69403–69424][atlas-chr-025].
Именно на этой форме одновременно известны оба входа.

Решением владельца от 2026-08-19 установлено:

- до финального сохранения игрок может выбрать и заменить собственное
  изображение;
- если к финальному сохранению арт не выбран, приложение назначает заглушку по
  выбранным расе и полу;
- соответствие шести пар шести ключам является авторским решением, а не
  выводом из имён файлов.

После сохранения Atlas оставляет механику и creation provenance read-only, но
разрешает владельцу версионно менять локальные `name`, `description` и `art`
на `CHR-040` в
[`$.forms[92].purpose/requiredFields/actions`, строки 71157–71210][atlas-chr-040].
Команда для этой mutation — `UI-CMD-CHAR-LOCAL-METADATA-PATCH`.

## Решение

### 1. Mapping задаётся только явной таблицей

На `CHR-025` используется следующая полная таблица exact входов и exact asset
keys:

| `raceChoice` | frozen `sex` | `assetKey`                             |
| ------------ | ------------ | -------------------------------------- |
| `UNITED`     | `MALE`       | `symbiosis_placeholder_unified_male`   |
| `UNITED`     | `FEMALE`     | `symbiosis_placeholder_unified_female` |
| `FREE`       | `MALE`       | `symbiosis_placeholder_free_male`      |
| `FREE`       | `FEMALE`     | `symbiosis_placeholder_free_female`    |
| `PURE`       | `MALE`       | `symbiosis_placeholder_pure_male`      |
| `PURE`       | `FEMALE`     | `symbiosis_placeholder_pure_female`    |

Эти шесть строк — весь mapping. Реализация обязана делать exact table lookup.
Запрещены concatenation, lowercase/normalization, substring matching,
`UNITED → unified`, разбор filename, порядок manifest и случайный выбор.

Пара вне таблицы не получает первый key, `null` или похожую заглушку. Она не
соответствует закрытым доменам и должна остановить финальное сохранение без
частичного commit; новый reason code этим ADR не вводится.

### 2. Подстановка принадлежит только atomic final save `CHR-025`

До `CHR-025` автоматической подстановки нет:

- initial `CHR-001.artAssetKeyOrLocalFile` остаётся `null`;
- выбор пола, identity checkpoint и первый вход в `CHR-010` не назначают арт;
- выбор или перевыбор расы на `CHR-010` не назначает и не меняет арт;
- промежуточный draft не получает скрытый default.

При действии «Сохранить финального персонажа» на `CHR-025` host проверяет
current art один раз внутри той же atomic final-save boundary:

1. Если `artAssetKeyOrLocalFile === null`, host берёт current selected
   `raceChoice` и frozen identity `sex`, находит exact строку §1 и сохраняет
   `{kind:"asset-key",assetKey}` как арт финального локального персонажа.
2. Если значение non-null, host сохраняет его без обращения к таблице §1.

Подстановка не является отдельным checkpoint, предварительной mutation или
best-effort post-processing. Если `CHR-025` не совершил final commit, заглушка
не должна остаться подтверждённым изменением. Exact replay финального
сохранения не выполняет второе назначение и возвращает прежний результат по
общей idempotency-семантике формы.

### 3. Явный выбор игрока имеет приоритет

Non-null catalog value и non-null custom local file одинаково блокируют
автоподстановку. В частности, для

```text
{kind:"local-file",mediaType:"image/png"|"image/jpeg",bytesBase64}
```

таблица §1 не вызывается, содержимое не преобразуется в asset key, а раса и пол
не меняют выбранное изображение. Действующие canonical base64, signature,
media type и size contracts ADR 0033 сохраняются; этот ADR не добавляет новый
value variant, wire message, предел или refusal.

До финального сохранения игрок может заменить non-null арт другим валидным
catalog key либо local file. Явное снятие возвращает draft к `null`; если он
остаётся `null` в момент успешного final save, применяется §2.

### 4. После final save арт меняется только как metadata `CHR-040`

Назначенный на `CHR-025` asset key и сохранённый custom local file не становятся
неизменяемой механикой. После final save владелец может версионно заменить арт
только действием «Сохранить локальные имя, описание или арт» на `CHR-040`, то
есть командой `UI-CMD-CHAR-LOCAL-METADATA-PATCH` через
[`CHR-040::CTA::004`, строки 71447–71478][atlas-chr-040-cta].

Команда требует current metadata revision и допускает различие только локальных
name/description/art fields. Она атомарно добавляет одну metadata revision, не
меняя mechanics checksum, creation receipts, final snapshot, candidate
snapshots или campaign copies; replay возвращает ту же metadata version, а
stale revision ничего не меняет. Exact contract записан в
[`registryCoverage.workflowCommands`, строки 258190–258198][atlas-command].

Mapping §1 на `CHR-040` не запускается: это правило только initial final save
на `CHR-025`, а не постоянный fallback локального metadata editor. Payload и
runtime `CHR-040` остаются предметом будущего среза; этот ADR не достраивает их
по аналогии.

### 5. Граница текущего PR

Этот PR принимает mapping и момент его применения, но не реализует
автоподстановку. `CHR-025`, final-save runtime и `CHR-040` ещё не входят в
текущий presentation slice. Критерии исполнения §1–4 принадлежат будущим
задачам этих форм.

Ручной catalog/local-file выбор на `CHR-001` не получает скрытого вызова
будущей логики. Домены art values и существующие причины отказа ADR 0033,
0035 и 0036 не меняются.

## Совместимость с принятыми ADR

- **ADR 0033 и 0035.** Full replacement, `null`, asset-key/local-file union,
  canonical validation, ordering, revisions и refusal taxonomy сохраняются.
- **ADR 0036.** Exact каталог и opaque keys сохраняются. Заменены только
  отложенность automatic selection и отсутствие owner-supplied mapping в §6;
  отвергнутая нормализация `unified→UNITED` остаётся запрещённой.
- **ADR 0037.** Frozen `sex`, выбор race позже identity и принадлежность final
  race/sex predicate форме `CHR-025` сохраняются. Заменена только отсрочка
  portrait mapping в §7; автоматический выбор на `CHR-001` не разрешён.

## Обоснование

`CHR-001` знает пол, но ещё не знает расу; `CHR-010` получает расу позже, а
`CHR-025` является первой final boundary, где оба exact значения уже доступны.
Поэтому назначение на `CHR-025` исполняет owner decision без предсказания
будущего выбора и без преждевременной mutation draft.

Таблица сохраняет различие между author decision и алгоритмом. Особенно важно,
что supplied stem `unified` не совпадает с Atlas enum `UNITED`: шесть явных
строк разрешают это соответствие, не превращая похожие имена в общее правило.

## Отвергнутые альтернативы

| Вариант                                  | Причина отказа                                                 |
| ---------------------------------------- | -------------------------------------------------------------- |
| Подставлять на `CHR-001`                 | Race ещё не выбрана                                            |
| Подставлять при выборе race на `CHR-010` | Это раньше final save и перезаписало бы hidden draft metadata  |
| Строить key из race/sex строкой          | Изобретает запрещённый semantic alias `UNITED→unified`         |
| Заменять custom local file заглушкой     | Противоречит явному выбору игрока и решению владельца          |
| Оставлять final art `null`               | Противоречит owner decision об обязательной заглушке           |
| Повторять mapping на `CHR-040`           | Atlas задаёт versioned metadata patch, а не final-save default |

## Последствия

- У будущего `CHR-025` есть полный fail-closed lookup без filename heuristics.
- `CHR-001` продолжает честно сохранять `null`, пока игрок не выбрал арт.
- Custom local file и ручной catalog key переживают final save без замены.
- Только final save заменяет оставшийся `null` одним из шести exact asset keys.
- После сохранения арт изменяется через versioned metadata contract `CHR-040`,
  а механика и creation provenance остаются неизменными.
- Текущий PR не реализует ни `CHR-025`, ни `CHR-040`, ни mapping runtime.

[atlas-chr-010]: ../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54888-L54923
[atlas-chr-025]: ../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L69374-L69424
[atlas-chr-040]: ../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L71144-L71210
[atlas-chr-040-cta]: ../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L71447-L71478
[atlas-command]: ../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L258190-L258198
