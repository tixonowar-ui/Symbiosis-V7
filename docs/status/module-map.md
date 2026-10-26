# Состояние модулей

Честная карта: где готовый код, который трогать не надо, а где дыра.
Обновляется в каждом PR, меняющем состояние модуля.

- Снимок: `2026-10-27`
- Тестов: 1472 Vitest + 5 Playwright, все зелёные
- `npm run verify` — проходит; `npm run build && npm run test:e2e` — 5/5

## Легенда

| Метка        | Значение                                          |
| ------------ | ------------------------------------------------- |
| **готов**    | работает, покрыт тестами, менять только по задаче |
| **частично** | работает не полностью, границы описаны ниже       |
| **заглушка** | файл или каталог есть, содержимого нет            |
| **не начат** | пусто                                             |

---

## tools/ — инструменты

| Модуль                        | Состояние    | Тесты    | Примечание                                                                                |
| ----------------------------- | ------------ | -------- | ----------------------------------------------------------------------------------------- |
| `tools/checksums`             | **готов**    | косвенно | SHA-256 манифест, гейт перед импортом. Проверен на срабатывание                           |
| `tools/import/lib`            | **готов**    | 18       | чтение xlsx и zip, fail-closed JSON, детерминированная запись, медиа по якорям OOXML      |
| `tools/import/atlas`          | **готов**    | 164      | Atlas v1.5; единственный полный `forms-by-id`; 1 247 actionKey/label, 3 renderer-индекса  |
| `tools/import/rules`          | **готов**    | 11       | 739 карточек, 699 активных, 40 tombstone                                                  |
| `tools/import/character`      | **готов**    | 12       | 1144 payload-сущности, 9 секций XP-контракта                                              |
| `tools/import/items`          | **готов**    | 11       | 64 типа предметов, 64 иконки в `generated/media`                                          |
| `tools/import/effects`        | **готов**    | 15       | 67 типов эффектов, 66 моделируемых                                                        |
| `tools/import/bestiary`       | **готов**    | 12       | 16 видов, 17 статблоков, 16 артов                                                         |
| `tools/import/sentient`       | **готов**    | 16       | 44 замороженных шаблона, 44 арта, Runtime Pack                                            |
| `tools/import/portraits`      | **готов**    | 9        | exact пакет из 6 портретов локального персонажа по ADR 0036                               |
| `tools/import/symbiont-media` | **готов**    | 16       | 23 SpeciesKey, 23 арта и 23 изображения деревьев; exact anchors и PNG bytes               |
| `tools/import/qna`            | **готов**    | 11       | 444 вопроса, 411 адресуемых кодов, алиас `Q-MON-089` по ADR 0017                          |
| `tools/import/seed`           | **готов**    | 5        | 114 таблиц, 20 288 строк, 9 паспортов; детерминизм на SQLite 3.53.4                       |
| `tools/validate`              | **готов**    | 130      | forms/QA и JSON/md guard-зеркала, raw guard, renderer-каталоги и кросс-реестровые ссылки. |
| `tools/traceability`          | **готов**    | 17       | детерминированная матрица ID, покрытия и расхождений из renderer-каталога форм            |
| `tools/package`               | **не начат** | —        | portable-сборка под Windows x64. Веха M9                                                  |

## src/ — приложение

Shared wire v1, exact v2 navigation/reconnect и exact v3 identity-draft готовы;
минимальный roll contract и каркас handler-реестров также готовы. Persistence
реализует первый V1-срез, web собирается в self-contained статику, а штатный
`npm start` замыкает подтверждённый presentation-путь
`APP-001 → APP-002 → CHR-001 → APP-004 → APP-002`. Первый срез identity-draft
подтверждает на host full replacement с nullable `MALE|FEMALE` sex и
восстанавливает outstanding update после reconnect того же mounted instance.
Подтверждённый Continue атомарно сохраняет exact десятиполевый первый checkpoint:
host отправляет terminal result/replay wire v1 перед exact `CHR-010` snapshot
wire v2, а reconnect и restart восстанавливают то же durable назначение. Локальная
библиотека читается при каждой проекции и получает отдельную runtime-ревизию,
поэтому сохранённый черновик виден в `APP-004` без перезапуска host. Web после
checkpoint замораживает идентичность, а `CHR-010::CTA::004..006` меняют только
client-local выбор расы без wire-трафика. `CHR-010`, `CHR-016` и `CHR-002`
получают host-signed каталоги последствий и до подтверждения сравнивают
source-backed race/mode/method facts; условные race modifiers остаются двумя
целыми ветвями `MANUAL|RANDOM`, `GrantedSkillRefs` показывается именованным
бесплатным навыком либо положительным отсутствием, а player payload не раскрывает
внутренний провенанс каталогов. `CHR-001` выбирает exact catalog
placeholder либо локальный PNG/JPEG по сигнатуре, допускает замену и снятие и
показывает host-отказ как ошибку поля. `SET-DECIDE` затем сохраняет три
append-only решения и проводит normal path через `CHR-016`, `CHR-036` до
initial `CHR-002`; `PURE` host-authoritatively минует `CHR-016`. Селекторы
метода на `CHR-002` local-only до подтверждения: оно атомарно создаёт первый
addressed set request и открывает `CHR-003`. Первый показ семи D20 и очередь
подтверждений натуральных `1/20` durable и необратимы. `CHR-005`–`CHR-008`
принимают набор либо открывают `CHR-028` поверх исходного screen: `CANCEL`
закрывает dialog presentation-only, а `CONFIRM` сохраняет abandonment и
следующую попытку либо point-buy. Ordered attempts сохраняют provenance;
пятая попытка `ALL_OR_NOTHING` допускает только принятие. `CHR-009` назначает
набор по индексам либо проверяет point-buy 90/85, сохраняя provenance каждого
критического штрафа. `UNITED` и `FREE` переходят прямо на read-only `CHR-012`,
а `PURE` сначала выбирает класс на `CHR-011`; host выводит обязательный навык и
пересчитывает base + race + class существующим domain-каталогом. Следующий
checkpoint фиксирует eligibility baseline и открывает очищенный каталог
`CHR-013`; его карточки и eligible options `CHR-015` дословно несут поставленную
область действия и явное наличие либо отсутствие штрафа без навыка. Addressable
`CHR-014` восстанавливает host-signed `skillId` после reconnect/restart, объясняет
failed requirements без internal IDs и добавляет навык только после явного
signed level. После partial add карточку следующего навыка можно открыть через
safe-return из `CHR-015/PARTIAL`, включая read-only ineligible навык; `NONE` и
`EXACT` этого safe-return не получают. `CHR-015` различает
`NONE|PARTIAL|EXACT`: card add сохраняет полный canonical набор и возвращает
mutable partial presentation, а финальный durable checkpoint по-прежнему требует
exact-fill и остаётся actionless. Последовательные добавления сохраняют обе
card-add записи и восстанавливаются после replay/restart. Классовый навык
учитывается один раз, бесплатный навык `UNITED` не занимает слот. Random slice
#135 продолжает путь: `CHR-017` публикует sanitized catalog и открывает `CHR-020`
с append-only physical records, duplicates, critical/monster outcomes и
binding-only commit. Random Advisor получает durable I/W и exact-fill через
`CHR-041`; read-only `CHR-019` показывает composition, interactions и
modifier-only breakdown без generic effective-stat engine.
Replay/refresh/reconnect/restart и historic recovery сохраняют
sequence/receipts без нового seed или sampler. Web рисует все четыре формы
random slice и local drafts; пять реальных Playwright-сценариев подтверждают
FREE EEL, UNITED ADVISER, eligible/ineligible `CHR-014` и повторное открытие
карточки с двумя canonical добавлениями через production dist и Fastify+WS.
#147 добавляет отдельный будущий минимум интеллекта: RANDOM records
не изменились, MANUAL получил B-specific stage с host-signed composition, двумя
I/W и exact-fill навыков. Один addressed B request/receipt восстанавливается
после replay/refresh/reconnect/restart/SQLite reopen без нового sampler;
подтверждение навыков до B блокируется. Web строго различает RANDOM/MANUAL и
показывает назначение и результат без seed/RNG state. Host+SQLite fixture не
является playable manual composition: editor, `CHR-018`, `CHR-042`, I/W transport
и exact-fill skill transport остаются в #145, equipment — в #146.
Остальные прикладные слои остаются частичными, заглушками или не начаты.

| Слой                         | Состояние    | Что нужно / реализовано                                                                                 | Веха |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- | ---- |
| `src/shared`                 | **готов**    | wire v1 + exact v2 navigation/reconnect + v3 identity-draft                                             | M4   |
| `src/domain/rules`           | **частично** | rolls, stats, skills, random sequence/composition/Advisor                                               | M3   |
| `src/domain/entities`        | **частично** | roll source/face/replay contract; lifecycle-переходов ещё нет                                           | M3   |
| `src/persistence`            | **частично** | CRUD, wizard/roll/skills/random checkpoint, library, identity                                           | M2   |
| `src/persistence/migrations` | **готов**    | forward-only `0001`–`0004`: checkpoint, device identity, skill presentation                             | M2   |
| `src/host`                   | **частично** | identity и creation journey до actionless CHR-019 random slice; MANUAL B fixture, не composition editor | M4   |
| `src/host/projections`       | **частично** | APP-001/002/004, CHR-001–017/019/020/028/036/041 exact slice                                            | M4   |
| `src/web`                    | **частично** | recovery, stats, skills, random symbiont UI, MANUAL B decoder/presentation и 5 Playwright-сценариев     | M5   |
| `src/web/renderer`           | **частично** | 33 формы: 11 APP и 22 CHR; остальные fail-closed                                                        | M5   |
| `src/web/forms`              | **частично** | APP domain; публикация APP-001/002/004 и двадцати двух CHR                                              | M6   |

## generated/ — вывод конвейера

| Каталог           | Состояние | В git | Объём                                    |
| ----------------- | --------- | ----- | ---------------------------------------- |
| `generated/spec`  | **готов** | да    | 129 JSON-файлов, 29,71 МиБ               |
| `generated/types` | **готов** | да    | 10 TS-файлов                             |
| `generated/media` | **готов** | нет   | 176 изображений, 73,16 МиБ               |
| `generated/seed`  | **готов** | нет   | 1 SQLite-файл, 22,39 МиБ; пересобирается |

## tests/

| Каталог             | Состояние    | Примечание                                                                                                       |
| ------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `tests/integration` | **не начат** | кросс-слойные тесты. Появятся с M2                                                                               |
| `tests/e2e`         | **частично** | 5 сценариев: FREE EEL, UNITED ADVISER, eligible/ineligible CHR-014 и повторный open с двумя add; production + WS |
| `tests/fixtures`    | **частично** | source-backed domain fixtures и изолированный temp-SQLite host harness                                           |

---

## Срезанные углы и осознанные упрощения

Это не недоработки — это решения. Не «чинить» без обсуждения.

| Что                                                             | Почему так                                                                                                                                                                                                                                             | Где записано                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 12 типов связи правил не нормализованы                          | `уточняет` и `Уточняет / имеет приоритет` выглядят синонимами, но склейка была бы придуманной эквивалентностью                                                                                                                                         | [ADR 0015](../adr/0015-import-pipeline-guarantees.md)                   |
| Тексты правил перенесены как данные                             | превращение «Итогового алгоритма» в код — это M3, там каждое правило требует своего решения                                                                                                                                                            | [ROADMAP](../ROADMAP.md)                                                |
| `16_Отбор_автоматизации` не сверяется с каталогом правил        | колонки содержат составные (`SYM-131#MI_MI_MI`) и многозначные (`SYM-084; SYM-085`) строки                                                                                                                                                             | комментарий в `tools/import/character.ts`                               |
| Колонки `Rule refs` в Effects не сверяются                      | многозначные и с диапазонами (`CORE-155–156; CQA-001`)                                                                                                                                                                                                 | комментарий в `tools/import/effects.ts`                                 |
| `10_Иммунитеты / Effect family` не сверяется                    | другой словарь (`POISON`, `FIRE`), а не `FamilyCode`; наивная сверка дала бы 14 ложных промахов из 20                                                                                                                                                  | комментарий в `tools/import/effects.ts`                                 |
| `00_Паспорт` Effects и `00_Сводка` Бестиария не импортируются   | дублирующиеся имена колонок в шапке                                                                                                                                                                                                                    | `meta.json` соответствующих разделов                                    |
| Wire v1 принимает последний member при повторённом имени в JSON | значение проходит полную проверку, encoder дублей не создаёт; запрет потребовал бы второй реализации грамматики. Формулировка «в v1» намеренная: это версия протокола, а не правка задачи                                                              | [ADR 0020](../adr/0020-wire-protocol-and-shared-contracts.md), раздел 1 |
| 15 полей `PLY-030` не типизированы на wire-границе              | их формирует host projector внутри opaque projection payload, а не клиентская мутация; wire защищает отдельно server-issued `returnContext` и не принимает client-supplied authority. Типизация в `src/shared` пригласила бы клиента их конструировать | [ADR 0020](../adr/0020-wire-protocol-and-shared-contracts.md), раздел 5 |

## Замечание по данным артефакта

`15_Иконки_предметов` в собственном описании называет два визуальных статуса,
но две строки (`RES-MAG-001`, `RES-MAG-002`) несут третий —
`PROVISIONAL_ENTITY`, не определённый ни в преамбуле, ни в справочнике.
Значение перенесено как есть. Если оно важно для UI — вопрос к автору
артефакта, не к коду.

В Q&A-реестре код `Q-MON-083` занят двумя несвязанными закрытыми вопросами —
строками №248 и №367. Строка №367 переносится дословно, но в индексе адресуется
как `Q-MON-089` по [ADR 0017](../adr/0017-qna-question-code-alias.md); область
алиаса намеренно ограничена этой строкой.
