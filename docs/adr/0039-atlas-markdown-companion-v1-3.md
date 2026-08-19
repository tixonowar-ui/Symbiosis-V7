# ADR 0039 — Markdown-компаньон Atlas v1.3

- **Статус:** принято
- **Дата:** 2026-08-19
- **Частично заменяет:** в [ADR 0037 §5](0037-atlas-v1-3-character-sex-and-mass-bounds.md#5-atlas-v13-provenance-counts-и-digests)
  предложение «Markdown v1.2 не входит в санкцию и остаётся историческим
  companion» и в его разделе «Последствия» пункт «Markdown v1.2 остаётся
  историческим»
- **Дополняет:** границу стражей [ADR 0037 §3](0037-atlas-v1-3-character-sex-and-mass-bounds.md#3-form-qa-и-guard-mirrors)
- **Уточняет:** отвергнутый raw-artifact вариант
  [ADR 0038](0038-remove-redundant-atlas-forms-array.md) только для нового
  Markdown consumer; generated form validation не возвращается к raw JSON

## Контекст

ADR 0037 и поставка #106 привели JSON Atlas к content release v1.3, но
одноимённый Markdown-файл остался снимком v1.2. Он продолжал показывать
`CHR-001` без обязательного пола, старые Continue guards и `CHR-025` без
границ массы по расе и полу.

В строке `Q-CHAR-010` исходный answer отрицает automatic minimum/maximum, а
пустой `laterAuthorOverride` скрывает более позднее решение именно там, где
человек ищет правило массы.

Owner разрешил четвёртое исключение из read-only policy: точечно изменить
`artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md` и пересчитать
`artifacts/CHECKSUMS.sha256`. Санкция не распространяется на JSON Atlas,
другие артефакты или полную перегенерацию Markdown.

JSON и Markdown не являются побайтовыми представлениями друг друга. JSON
содержит пять entry mirrors и четыре Continue mirrors ADR 0037; Markdown
схлопывает top-level transition с form transition и печатает:

| Литерал ADR 0037 §3   | JSON | Markdown |
| --------------------- | ---: | -------: |
| Entry                 |    5 |        4 |
| Continue              |    4 |        3 |
| `IDENTITY_INCOMPLETE` |    1 |        1 |

Подстрока `massKg(number>0` встречается в Markdown шесть раз: по два раза для
`CHR-001`, `ENM-005` и `ENM-012` — form record и QA mirror. Решение owner
относится только к локальному персонажу; четыре enemy occurrences не меняются.

## Решение

### 1. Markdown становится content companion v1.3

Legacy physical filename `Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md`
сохраняется. H1 и поле паспорта «Версия атласа» получают `1.3`, release date —
`2026-08-18`.

`schemaVersion=1.2.0`, source refs, counts и имя файла не меняются. Оба
semantic digest остаются author-supplied значениями базового v1.2; новую byte
integrity Markdown закрепляет `CHECKSUMS.sha256`.

Записи `CHR-001` и `QA-FORM-CHR-001` получают exact purpose, required `sex`,
component `Name/age/sex`, acceptance и поля из JSON v1.3. Записи `CHR-025` и
`QA-FORM-CHR-025` получают exact `identityAndMassStatus` с двенадцатью
inclusive endpoints ADR 0037 §2. Markdown table escaping `\|` не меняет
отрендеренный literal.

`Q-CHAR-010` получает `CHR-001` в form list, exact
`MATERIALIZED_WITH_LATER_AUTHOR_OVERRIDE` и exact override ADR 0037 §4.
`QA-QNA-Q-CHAR-010-ROW-306` получает тот же дополненный form list. Исходные
`question` и `answer` не переписываются.

### 2. Три prose-кластера обновляются дословно

Entry literal во всех четырёх Markdown render locations:

```text
Новый immutable UUID; обязательны имя, возраст, пол и положительная massKg 0,1; описание/арт необязательны.
```

Continue literal во всех трёх locations:

```text
UI-CMD-CHAR-WIZARD-CHECKPOINT stage=IDENTITY; name/age/sex present; massKg>0 at step 0.1; immutable draft UUID committed
```

Единственный incomplete-state literal:

```text
Continue is absent until name/age/sex/positive 0.1kg mass validate.
```

Во всём файле не остаётся ни одного exact вхождения трёх прежних вариантов:

```text
Новый immutable UUID; обязательны имя, возраст и положительная massKg 0,1; описание/арт необязательны.
UI-CMD-CHAR-WIZARD-CHECKPOINT stage=IDENTITY; name/age present; massKg>0 at step 0.1; immutable draft UUID committed
Continue is absent until name/age/positive 0.1kg mass validate.
```

### 3. `tools/validate` читает companion как raw text

`tools/validate/index.ts` читает exact `ARTIFACT.atlasMd` как UTF-8 и передаёт
полный текст отдельной pure validation function. Для каждого из трёх
литералов проверяются два независимых условия:

1. retired literal встречается ровно `0` раз;
2. current literal встречается ровно `4`, `3` или `1` раз соответственно.

Отсутствующий либо нечитаемый файл создаёт явную diagnostic problem. Одиночный
drift уменьшает current cardinality; синхронная замена всех копий обнуляет её.

Страж не зависит от сдвигающихся номеров строк, не разбирает Markdown tables и
не восстанавливает JSON structure: контракт — exact occurrences во всём файле.

### 4. Граница стража явная и конечная

Новый guard покрывает только три prose literals ADR 0037 §3 и их шесть
retired/current variants. Он не доказывает:

- полное равенство JSON и Markdown;
- соответствие остальных form, QA, Q&A, transition или journey records;
- верность произвольной guard-прозы или semantic digests;
- отсутствие новых семантически похожих мест.

Purpose, fields, `identityAndMassStatus` и Q&A синхронизируются этой
санкционированной поставкой, но не объявляются generic Markdown schema.
Будущая поставка, добавляющая ещё одно зеркало одного из трёх literals, обязана
явно изменить cardinality в новом ADR и тестах. Новый вид prose требует нового
именованного literal, а не heuristic matching.

### 5. Generated и граница ADR 0038

`npm run import` по-прежнему читает JSON Atlas и не читает Markdown. Поэтому
эта поставка не меняет `generated/**`; неизменность generated после import —
обязательное доказательство границы.

ADR 0038 отверг чтение raw artifact как замену generated `forms-by-id.json`
для form/QA и структурных identity guards. Это решение не возвращает такой
путь: существующие проверки продолжают читать generated records. Новый raw
consumer проверяет отдельный физический Markdown, для которого importer не
имеет и не должен создавать generated-представление.

## Совместимость с принятыми ADR

- **ADR 0003.** Source order не меняется; ADR 0037/0039 выше старого Q&A
  answer, а актуальный companion показывает override рядом с ним.
- **ADR 0016 и 0019.** Generated policy сохраняется; import не создаёт новый
  output и не меняет committed spec/types либо rebuilt media/seed.
- **ADR 0037.** Exact mechanics, three literals, v1.3 passport и historical
  semantic digests сохраняются. Заменяется только статус Markdown и
  дополняется проверяемая render-cardinality.
- **ADR 0038.** Полный form catalogue остаётся generated
  `forms-by-id.json`; raw JSON не становится validator source.

## Обоснование

Точечная синхронизация исправляет источник, который реально читают люди, и
сохраняет обозримый diff. Удаление `atlasMd` из paths либо объявление файла
историческим только в коде не исправило бы поставленный текст и оставило бы
отменённое правило массы наиболее доступным ответом.

## Отвергнутые варианты

| Вариант                              | Причина отказа                                                         |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Перегенерировать Markdown            | Diff в десятки тысяч строк разрушает ревью и превышает artifact budget |
| Сравнивать JSON и Markdown побайтово | Форматы имеют разную структуру и число render locations                |
| Построить общий Markdown parser      | Atlas не поставляет grammar или render contract                        |
| Удалить `atlasMd` из paths           | Убирает будущий consumer, но не исправляет читаемый артефакт           |
| Обновить enemy/NPC записи            | Owner ограничил решение локальным созданием персонажа                  |
| Пересчитать semantic digests         | Их алгоритм не поставлен; byte checksum решает другую задачу           |

## Последствия

- Markdown в legacy path становится content companion Atlas v1.3; H1,
  passport, `CHR-001`, `CHR-025` и обе строки `Q-CHAR-010` показывают ADR 0037.
- `atlasMd` получает первый реальный consumer в `tools/validate`, но не в
  `tools/import`.
- Три prose clusters защищены raw-text cardinality `4 / 3 / 1`; весь остальной
  Markdown не объявляется автоматически проверенным.
- `generated/**` после import остаётся byte-identical.
- Любая будущая поставка с новым mirror location обязана расширить конечный
  список отдельным решением; автоматического обнаружения нет.
