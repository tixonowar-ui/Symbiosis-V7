# ADR 0038 — Удаление избыточного массива форм атласа

- **Статус:** принято
- **Дата:** 2026-08-19
- **Частично заменяет:** раздел «Признанная избыточность» и последствие
  «На M5 пересмотреть содержимое `generated/spec/atlas`» в
  [ADR 0016](0016-what-generated-is-committed.md)
- **Уточняет:** только источник записей форм и имя файла в диагностике стражей
  [ADR 0037 §3](0037-atlas-v1-3-character-sex-and-mass-bounds.md#3-form-qa-и-guard-mirrors)

## Контекст

Артефакт Atlas v1.3 объявляет 376 форм одним массивом `forms`. Импорт сейчас
сохраняет каждую полную запись дважды:

- `generated/spec/atlas/forms.json` — массив, 8 607 492 байта;
- `generated/spec/atlas/forms-by-id.json` — объект по `id`, 8 611 589 байт.

Оба файла содержат одни и те же записи. `renderer/forms-by-id.json` размером
1 242 478 байт не является полной копией: это сокращённая Web-проекция. До
изменения весь `generated/spec/atlas` занимает 21 689 719 байт.

Текущее построение видно в `importAtlas`: массив читается непосредственно из
`root.forms`, duplicate `id` отклоняется, а та же запись присваивается
`formsById[id]`. Затем рядом испускаются массив, полный индекс и renderer-index
([`tools/import/atlas.ts`](../../tools/import/atlas.ts)). Общий `writeJson`
сортирует object keys, сохраняет порядок массивов, использует LF и не добавляет
run metadata ([`tools/import/lib/emit.ts`](../../tools/import/lib/emit.ts)).

Проход по TypeScript на момент решения находит четыре группы, зависящие от
`forms.json`:

1. producer и описание покрытия секции forms в `tools/import/atlas.ts`;
2. четыре проверки каталога, индекса, graph closure и распределения доменов в
   [`tools/import/atlas.test.ts`](../../tools/import/atlas.test.ts);
3. загрузку массива в `tools/validate/index.ts` и диагностический литерал
   `FORMS_FILE` стражей зеркал в
   [`tools/validate/atlas.ts`](../../tools/validate/atlas.ts);
4. generic seed catalogue: array автоматически становится таблицей
   `atlas_forms`; totals зафиксированы в
   [`tools/import/seed.ts`](../../tools/import/seed.ts) и его тесте.

Runtime уже не читает массив. Host загружает полный `forms-by-id.json`, Web —
сокращённый renderer-index. Seed, напротив, косвенно копирует все 376 records,
хотя полный object-index намеренно числится в `SKIPPED_INDEX_PATHS`. Поэтому
избыточность ADR 0016 пережила generic renderer и повторилась в SQLite seed.

## Решение

### 1. Единственная полная generated-запись форм — индекс по ID

`tools/import` перестаёт испускать `generated/spec/atlas/forms.json`. После
успешной записи всех сохранённых Atlas outputs и types, но до возврата и запуска
seed, он удаляет exact legacy path с `force:true`: import сам не очищает
spec-каталоги. Ранний failed emit сохраняет прежний output; успешный не оставляет
stale-файл для validator и seed. Артефакт не меняется, generated не правится вручную.

`generated/spec/atlas/forms-by-id.json` остаётся детерминированным полным
каталогом. Его key — exact `form.id`, value — вся запись формы без сокращения
или преобразования состава. Existing duplicate/non-empty/type checks импорта
остаются fail-closed. Сортировка ключей сериализатором остаётся частью общей
гарантии ADR 0015.

Состав и shapes `forms-by-id.json`, `renderer/forms-by-id.json`,
`renderer/primary-actions-by-form-id.json` и
`renderer/transitions-by-form-and-trigger.json` не меняются. Решение удаляет
только одно из двух полных представлений.

### 2. Эквивалентность доказывается от артефакта

Четыре assertions импорта сохраняют предмет проверки, но источником ожидаемого
каталога становится `clonedForms()`, то есть `forms` самого поставленного
артефакта, а не второй generated-файл.

Проверка строит expected object как пары `[form.id, form]` из `clonedForms()` и
глубоко сравнивает его с `forms-by-id.json`, доказывая полноту, exact keys и
содержимое. Graph closure сверяет transitions с source IDs; распределение по
доменам — значения полного индекса с source forms.

Renderer projection по-прежнему выводится и проверяется относительно полного
`forms-by-id.json`: она имеет другой намеренный shape, поэтому не заменяет
artifact-to-full-index proof.

### 3. Стражи ADR 0037 читают тот же record через Object.values

`tools/validate/index.ts` уже загружает `atlas/forms-by-id.json` для проверки
замкнутости ключей. В этот же объект передаётся
`Object.values(detailedFormsById)` вместо отдельного массива `forms.json`.

Purpose/fields/acceptance, QA и десять identity guards ADR 0037 §3 сохраняются.
Verdict не зависит от порядка: формы ищутся по `id`.
Только diagnostic `row N` для malformed value без `id` теперь отражает
лексикографический порядок keys `writeJson`, а не raw Atlas order.

Константа источника и все относящиеся к ней ошибки теперь называют
`atlas/forms-by-id.json`. Это согласованное изменение diagnostic provenance,
не ослабление правила. Existing key-closure guard дополнительно доказывает,
что каждый key полного индекса объявлен renderer-каталогом и наоборот.

### 4. Seed больше не хранит третью копию записей форм

Удаление array input убирает таблицу `atlas_forms`; замены не создаётся.
`forms-by-id.json` теперь единственный полный каталог, а не lookup copy, но
остаётся в `SKIPPED_INDEX_PATHS`: repo consumer таблицы `atlas_forms` нет, seed
материализует только arrays, а object потребовал бы нового keyed-table и order
contract. Totals меняются ровно на этот input: JSON files `129→128`, array
tables `115→114`, rows `20 655→20 279`; остальные tables и metadata неизменны.

### 5. Исторические ссылки не сохраняют удалённый путь

Принятые ADR 0031, 0032, 0033, 0034 и 0036 ссылаются на отдельные записи
`forms.json`. Их решения не меняются: evidence re-anchored на exact те же
записи в `forms-by-id.json`. Такая правка ссылки является механической
поддержкой доступности свидетельства, а не редактированием решения по существу.

## Обоснование

Полный индекс сохраняет обе полезные свойства ADR 0016: машинный diff поставки
и сборку без обязательного импорта. Artifact-to-index deep equality сильнее
старого generated-array-to-generated-index сравнения: expected side теперь не
может повторить одну и ту же ошибку двух emit branches.

Удаление массива убирает 8 607 492 байта из git-представления Atlas без
изменения runtime contract. Страж зеркал получает те же полные записи, а
renderer продолжает читать свою узкую проекцию; уменьшать её или переносить в
runtime полный каталог для этой задачи не требуется.

## Отвергнутые варианты

| Вариант                                 | Почему отклонён                                                      |
| --------------------------------------- | -------------------------------------------------------------------- |
| Оставить оба полных файла               | Сохраняет доказанную побайтовую избыточность без отдельного consumer |
| Удалить `forms-by-id.json`              | Ломает адресацию Host и лишает validator exact full records          |
| Питать validator renderer-index         | Узкая проекция не содержит purpose, acceptance и guard structures    |
| Читать raw artifact из `tools/validate` | Смешивает generated-validation с повторным artifact import path      |
| Снять четыре теста и mirror guard       | Теряет целостность вместо равносильной смены представления           |
| Заменить `atlas_forms` object-таблицей  | Нет consumer; вводит новый keyed-table/order contract                |

## Последствия

- После `npm run import` `forms.json` отсутствует; повтор оставляет tree чистым.
- При неизменных остальных outputs `generated/spec/atlas` уменьшается с
  21 689 719 до 13 082 227 байт.
- Runtime и Web bundle не получают `forms.json`; размер до/после фиксируется в PR.
- Traceability scan дедуплицирует IDs через `Set`; его output остаётся byte-identical.
- Full и renderer indexes остаются в git и показывают дифф поставки.
- Seed содержит 114 array tables, 20 279 rows и 9 metadata rows; исчезает
  только дублирующая `atlas_forms`.
- Новая форма или drift зеркал останавливают import либо validate; fallback нет.
- Политика ADR 0016 не меняется вне временного хранения второго полного массива.
