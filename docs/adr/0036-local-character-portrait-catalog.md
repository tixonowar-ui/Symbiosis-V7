# ADR 0036 — Каталог портретов локального персонажа

- **Статус:** принято
- **Дата:** 2026-08-18
- **Дополняет:** asset-key branch
  [ADR 0033](0033-chr-001-identity-input-contract.md) и generated media policy
  [ADR 0016](0016-what-generated-is-committed.md)

## Контекст

ADR 0033 разрешил `CHR-001.artAssetKeyOrLocalFile` содержать exact
`{kind:"asset-key",assetKey:string}` и потребовал разрешать ключ каталогом, но
в проекте не было owner и physical source такого каталога. В поставку добавлены
шесть отдельных PNG-портретов и manifest. Нужно провести их через
детерминированный import, не превращая filename в неявное игровое правило.

### Что следует из источников и принятых решений

Atlas объявляет art optional полем `CHR-001`, но не задаёт каталог или
автоматический выбор. ADR 0029 §5 требует присутствующий optional key с честным
`null` и запрещает механически разбирать composite source literals. ADR 0033
задаёт exact asset-key/local-file union и application reasons
`EMPTY_ASSET_KEY` и `ASSET_NOT_FOUND`.

Существующий sentient precedent разделяет manifest-like registry и physical
bytes. Registry называет `ArtAssetID`, runtime filename и SHA-256, importer
проверяет соответствие до byte copy:

- [`tools/import/sentient.ts`, строки 1–10](../../tools/import/sentient.ts#L1-L10);
- [`tools/import/sentient.ts`, строки 261–309](../../tools/import/sentient.ts#L261-L309).

Archive в sentient — свойство frozen Runtime Pack ADR 0007, а не необходимая
часть manifest/bytes pattern. В этой поставке owner авторизовал семь напрямую
видимых файлов — manifest и шесть PNG — с отдельным SHA-256 каждого файла в
`artifacts/CHECKSUMS.sha256`.

Названия файлов внешне содержат слова `free`, `pure`, `unified`, `female` и
`male`, но manifest намеренно не объявляет race/gender semantics. Filename и
пиксели не являются правилом выбора. Atlas также не задаёт default, random
selection, момент перевыбора или связь `unified` с enum `UNITED`.

## Решение

### 1. Physical source

Каталог — direct artifact package без archive:

```text
artifacts/local-character-portraits/
  manifest.json
  media/
    symbiosis_placeholder_free_female.png
    symbiosis_placeholder_free_male.png
    symbiosis_placeholder_pure_female.png
    symbiosis_placeholder_pure_male.png
    symbiosis_placeholder_unified_female.png
    symbiosis_placeholder_unified_male.png
```

Каждый из семи файлов — самостоятельный source artifact и отдельная запись
`artifacts/CHECKSUMS.sha256`. PNG не переносится в `src`, `public` или
`generated` вручную. Zip/tar и второй registry workbook не создаются.

### 2. Exact manifest

Поставленный [`manifest.json`, строки 1–32](../../artifacts/local-character-portraits/manifest.json#L1-L32)
— JSON array ровно из шести recursively exact objects:

```text
{assetKey:string,file:string,sha256:string}
```

Extra/missing keys запрещены. Строки расположены возрастающе по exact
case-sensitive `assetKey` простым сравнением без locale. Exact key равен stem
exact original filename:

| `assetKey`                             | `file`                                     |
| -------------------------------------- | ------------------------------------------ |
| `symbiosis_placeholder_free_female`    | `symbiosis_placeholder_free_female.png`    |
| `symbiosis_placeholder_free_male`      | `symbiosis_placeholder_free_male.png`      |
| `symbiosis_placeholder_pure_female`    | `symbiosis_placeholder_pure_female.png`    |
| `symbiosis_placeholder_pure_male`      | `symbiosis_placeholder_pure_male.png`      |
| `symbiosis_placeholder_unified_female` | `symbiosis_placeholder_unified_female.png` |
| `symbiosis_placeholder_unified_male`   | `symbiosis_placeholder_unified_male.png`   |

`sha256` — lowercase 64-hex digest exact supplied original bytes. Manifest не
получает `race`, `gender`, `sex`, label, weight, default или aliases.
`unified` остаётся частью opaque case-sensitive asset key; importer и runtime
не заменяют его на `UNITED` и не создают такой alias.

### 3. Fail-closed import

Новый importer читает manifest и `media/` только после общего checksum gate.
До записи output он атомарно проверяет:

1. top-level array, recursively exact object shape и ровно шесть rows;
2. source order, exact шесть keys/files из §2 и отсутствие duplicate keys или
   filenames;
3. `file` — безопасный basename без `/`, `\`, `.`/`..`, NUL или drive prefix,
   заканчивающийся exact lowercase `.png`;
4. stem `file` дословно равен `assetKey`; trim, case-fold и Unicode
   normalization не выполняются;
5. bijection: каждый row называет ровно один существующий файл, каждый файл
   `media/` назван ровно один раз; missing и extra files отказывают импорт;
6. фактические bytes начинаются exact PNG signature
   `89 50 4e 47 0d 0a 1a 0a`;
7. SHA-256 bytes дословно равен manifest digest.

Import не resize, recompress, strip metadata, rename или transcode PNG. Он
копирует exact bytes. Любое расхождение называет row/key/file и прекращает весь
portrait import без частичного output.

Повторный import создаёт побайтово те же spec, types и media. Tests фиксируют
negative missing/extra, duplicate, traversal, signature и hash paths.

### 4. Generated contract

Importer создаёт:

- `generated/spec/local-character-portraits/catalog.json` — шесть exact manifest
  rows в source order;
- `generated/spec/local-character-portraits/meta.json` — exact object
  `{assets:6,totalBytes,source:"artifacts/local-character-portraits/manifest.json",mediaDir:"generated/media/local-character-portraits"}`;
- `generated/media/local-character-portraits/<exact original filename>` — шесть
  byte copies;
- `generated/types/local-character-portraits.ts` — sorted string union
  `LocalCharacterPortraitAssetKey` ровно из шести `assetKey` §2.

По ADR 0016 spec и types коммитятся, media не коммитится и восстанавливается
`npm run import`. `totalBytes` — сумма фактических шести source file sizes;
manifest не дублирует её и importer не принимает заявленное число на веру.

### 5. Runtime scope: только CHR-001

В текущем срезе каталог разрешает только value
`CHR-001.artAssetKeyOrLocalFile={kind:"asset-key",assetKey}`:

- пустой `assetKey` проходит exact decoder, затем получает существующий
  `INVALID_FIELD` / `EMPTY_ASSET_KEY`;
- непустой key, которого нет в generated union/catalog, получает существующий
  `INVALID_FIELD` / `ASSET_NOT_FOUND`;
- unknown `kind`, missing или extra object key и неверный JSON type не доходят
  до catalog lookup и получают existing `protocol.refusal`;
- exact известный key сохраняется без normalization; file path не входит в
  command payload или persistence.

Local-file branch ADR 0033 остаётся отдельным и не разрешается этим каталогом.
Unknown catalog key не заменяется первым портретом, `null` или local file.

Решение не создаёт generic parser для Atlas literals с `/`. В частности,
`GRP`/`CMB` V2/V4 и остальные 15 composite literals остаются opaque согласно
ADR 0029 §5. Формы с `artAssetKey/filePickerState` также не получают этот union
по совпадению подстроки.

### 6. Автоматический выбор отложен

Initial `CHR-001.artAssetKeyOrLocalFile` остаётся `null`, пока пользователь явно
не выбрал catalog key либо local file. Ни filename, ни порядок manifest не
задают default.

Автоматический выбор запрещён до появления **ровно двух** отсутствующих
предпосылок:

1. В `CHR-001` и identity-draft contract нет sex/gender input. Его нельзя
   вывести из имени, выбранного portrait key или изображения.
2. `raceChoice` отсутствует в `CHR-001`, а при первом входе в `CHR-010` ещё
   равен `null` по ADR 0034; раса становится известна только после local selector
   на следующей форме. Её нельзя предсказать на identity stage.

Владение `raceChoice` следующей формой подтверждают
[`$.forms[60].requiredFields[0..7]`, строки 54916–54924](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54916-L54924)
и [`forms-by-id.json["CHR-010"].requiredFields[0..7]`, строки 14407–14416](../../generated/spec/atlas/forms-by-id.json#L14407-L14416).

Этот ADR не вводит mapping, в особенности не сопоставляет substring `unified`
с race enum `UNITED`.

## Совместимость с принятыми ADR

| ADR    | Совместимость                                                            |
| ------ | ------------------------------------------------------------------------ |
| `0015` | Source проверяется до deterministic output                               |
| `0016` | Spec/types коммитятся, media пересобирается                              |
| `0029` | Optional key/initial `null` и opaque composite literals сохраняются      |
| `0033` | Добавлен только catalog lookup; wire, local-file и revisions не меняются |
| `0034` | `raceChoice:null` не получает скрытый portrait default                   |

## Обоснование

Direct package сохраняет ровно ту physical boundary, которую поставил owner:
manifest плюс шесть видимых PNG с per-file checksums. Archive не добавляет
семантики, но скрыл бы отдельные source files за ещё одним контейнером.

Filename-stem key делает связь проверяемой без второго registry, сохраняя
значения поставки дословно. Отсутствие semantic columns важнее кажущейся
понятности имён: приложение не получает право выводить пол или расу из строки.

## Отвергнутые альтернативы

| Вариант                                    | Причина отказа                                              |
| ------------------------------------------ | ----------------------------------------------------------- |
| Упаковать семь files в zip                 | Owner поставил direct files; archive не даёт новой проверки |
| Коммитить PNG в `src`/`public`             | Обходит checksum/import boundary и дублирует source         |
| Нормализовать keys или `unified→UNITED`    | Меняет exact supplied identity и изобретает semantic alias  |
| Вывести race/gender из filename            | Manifest таких полей не объявляет                           |
| Автовыбрать по manifest order или случайно | Нет двух prerequisites §6                                   |
| Fallback unknown key к первому/`null`      | Скрывает corruption/drift вместо `ASSET_NOT_FOUND`          |
| Применить union ко всем art-like literals  | Нарушает form-specific и opaque-composite границы ADR 0029  |

## Последствия

- Issue #97 получает конечный exact catalog для ручного asset-key выбора в
  `CHR-001` и может реализовать `ASSET_NOT_FOUND` без heuristic lookup.
- Artifact delivery состоит из семи checksum-tracked файлов; изменение любого
  PNG требует новой подтверждённой поставки, manifest digest и CHECKSUMS.
- После клона `npm run import` обязателен для шести generated media files.
- Никакая другая форма и ни один composite literal не получают новый domain.
- Автоматическая подстановка запрещена до закрытия обеих предпосылок §6;
  mapping нельзя задним числом вывести из filenames.
