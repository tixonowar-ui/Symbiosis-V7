# NPC disease cleanup — проверка #257

## Исходный отказ

Первый independent clean verify кандидата
`fc7b4be0909f33815d08678a3d26a2a02cc1b45a`, tree
`f5f4be2ee4520a72af3790bc8bb533d64de854a6`, завершился 7412 PASS / 1 FAIL
из 7413 тестов и 296 PASS / 1 FAIL из 297 файлов. Vitest: 5252,86 с;
полный verify wrapper: 5471,129 с. Единственный отказ — `Hook timed out in
30000ms` в `setupNpcCommitFixture` afterEach, native `db.close()` loop,
`tests/fixtures/npc-commit-integration-scenarios.ts:148–149`.

Случай `removes the active effect without unlocking time or freeing its identity,
and permits only a newly reserved later assignment` имеет исходный body budget
300000 мс. Reported case total 189484 мс включает неразделённые фазы; это не
доказательство body timeout или exclusive close duration. Длительность native close
внутри исходного hook не измерена; причина задержки hook не установлена.
Мгновенные memory snapshots этого не меняют.

Полный исходный log сохранён во внешнем `clean-evidence257`; SHA256:
`dba5639cd1e3dcd25ad5ae094a159106266f1e04587ed6a7e9c7b612d09341e9`.
Root отдельно сохранил result, stage journal и `clean-failure257-audit.json`.
До этого push/PR не выполнялись.

## Ограниченная сравнительная пара

Исходный fixture blob `751f1a645864a67526100c287b365e43b8e9eb8a` одинаков на
доставленном base `54f1bfd` и кандидате `fc7b4be`. Две отдельные копии прошли
собственные npm ci/import; root последовательно выполнил один exact case на
каждой. Source overlay и default limits одинаковы: body 300 с, afterEach 30 с,
штатные workers/retries. Overlay только измеряет фазы, не входит в поставку.

| Источник     | Marked body, мс | Native close, мс |
| ------------ | --------------: | ---------------: |
| base54f      |      85936,9296 |         442,5461 |
| candidatefc7 |      85899,2480 |         409,5050 |

На каждой копии: 1 выбранный PASS, 37 filtered, все 66 markers, финальные
assertions и cleanup завершены; owned PIDs после запуска отсутствуют. Это не
all38 PASS и не повтор полного verify. Original afterEach failure не воспроизведён.
Probe overhead включён, CPU/process memory не дают exclusive phase peak или
причину исходного отказа. Root audit: `diagnostic257-base-audit.json` и
`diagnostic257-candidate-audit.json`. Raw log SHA256 соответственно:
`f2055acaabcfeb3440eb5c1dcb8aeb2a1d7ff4a58e3b1d9cb81f188db2c420b5`
и `77d4f3295b0f15877c9ae5cc955fddcb6d6792816aefac6016bdc430cb2062ea`.

## Узкая правка владения success cleanup

Shared seed producer сериализует bytes и закрывает свой handle в beforeAll.
`restoredTimed()` создаёт отдельный `new Database(bytes)`; handle регистрируется
в существующем списке cleanup. Все операции/assertions именованного случая
синхронны. Последнее обращение к БД — финальный recovery/time-lock assertion;
после него нет callback, которому нужен этот handle. Единственный onTestFailed
в файле относится к другому poison-тесту; hostile microtask также другой случай.

Только после последнего существующего assertion добавлен `h.db.close()`.
Успешный close учитывается внутри уже существующего 300-секундного body budget.
Общий afterEach loop и его 30 секунд неизменны: он по-прежнему закрывает открытый
handle при более раннем отказе, а закрытый success handle пропускает. Нет нового
try/finally, заменяющего исходную ошибку, новых reads/serialize/GC, переноса
assertions, сокращения реального workflow или изменения других тестов.

Это изменение границы учёта bounded owned cleanup, не ускорение SQLite и не
устранение установленной причины. Достаточность бюджета/поведение native close
в исходных условиях не обещаются. Production source, artifacts/generated,
общие hooks/defaults/workers/retries/CI и принятые ADR не меняются.

Обычный author `npc-close-case01` без diagnostic overlay завершился 1 PASS / 37
filtered из 38, reported case total 87246 мс, Vitest duration 103,35 с. Before/after
source hashes совпали, fixture SHA256
`d7ef53df88caa376bcd2f2a28526864b5f842aea04f3620ee280f2a36283da2f`.
Exclusive close duration в этом прогоне отдельно не измерялась. Это один случай,
не all38 PASS, не performance/root-cause proof и не полный gate.

Targeted и scoped static результаты сохраняются отдельно с source hashes/env;
полная приёмка нового committed SHA
требует независимого fresh clean five-stage и CI. Старый failed gate и все
diagnostic evidence остаются неизменны; #257/#188/#113 пока открыты.
