# Vitest и память Atlas — issue #160

## Причина и исправление

На Windows 10 x64 `10.0.19045`, Node `24.19.0`, npm `11.17.0`, Vitest
`4.1.10`, 8 logical CPU и 17 079 521 280 байтах RAM полный запуск с семью
параллельными suites воспроизводит отказ native allocation в `structuredClone`
настоящего Atlas. Ограничение `maxWorkers` четырьмя уменьшает совокупный пик
памяти, сохраняя все suites и исходные проверки.

Фактический resolved pool — `forks`, isolation включена. Без явного
`maxWorkers` установленный Vitest выбирает `availableParallelism() - 1`, здесь
семь. Исправление задаёт `Math.min(4, Math.max(availableParallelism() - 1, 1))`,
сохраняя меньший стандартный предел на машинах с 1–4 CPU. Includes, guards, timeouts,
dependencies, heap flags, исходный Atlas и все вызовы `structuredClone` сохранены.

## Измерения 2026-10-27

База — `03e33eb4607f2e217506420c140994e5586bac91`, после `npm run import`.
Последовательно выполнены команды, разворачиваемые штатным `npm test`, с
единственным отличием во втором запуске — `--maxWorkers=4`:

```powershell
node node_modules/vitest/vitest.mjs run --passWithNoTests
node node_modules/vitest/vitest.mjs run --passWithNoTests --maxWorkers=4
```

Диагностический preload записывал `process.memoryUsage()` и
`v8.getHeapStatistics().heap_size_limit` перед/после native clone и при отказе,
передавая исходные аргументы настоящему `structuredClone` и повторно выбрасывая
исходную ошибку. Внешний монитор каждые 500 ms снимал RSS/private bytes дерева
процессов и Windows `GetPerformanceInfo` (commit, commit limit, physical memory).
Принудительного GC, custom heap и удержания клонов монитором нет. Значения ниже
в десятичных GB/MB; краткие transient allocation между снимками не измерены.

| Метрика                              | Исходные 7 workers |    4 workers |
| ------------------------------------ | -----------------: | -----------: |
| Результат полного набора             |    прерван, exit 1 |    1514/1514 |
| Atlas `DataCloneError`               |                  3 |            0 |
| Пик private bytes дерева             |           2,797 GB |     2,000 GB |
| Пик RSS дерева                       |           2,281 GB |     1,705 GB |
| Начальный системный commit           |          29,815 GB |    29,976 GB |
| Пик sampled системного commit        |          32,672 GB |    31,977 GB |
| Минимальный sampled запас commit     |           338,8 MB |    1033,9 MB |
| Пик Atlas heapUsed                   |           312,0 MB |     309,8 MB |
| Пик Atlas external                   |           2,818 MB |     2,813 MB |
| Клоны полного Atlas / forms / global |       122 / 13 / 5 | 122 / 13 / 5 |

Три ошибки клона полного Atlas зафиксированы в `16:45:35.307–35.344 MSK`,
первые два вызова — при heapUsed 48,95/50,23 MB и heap limit 4496,29 MB.
Это не достижение лимита JS heap самим Atlas. Системный commit limit —
33,010 GB; накопленный Windows CommitPeak во время прогона — 33,006 GB.
Ближайший sampled commit отстоит от ошибки на 163–200 ms, поэтому точное
мгновенное исчерпание commit не заявляется. Отказ worker и host timeouts
сопровождали исходный запуск; они отсутствуют в сравнительном запуске с четырьмя.
Проверенный Windows job не задаёт process/job memory limits.

Текст `Data cannot be cloned, out of memory` соответствует неудаче расширения
native serialization buffer в
[V8 этой версии Node](https://github.com/nodejs/node/blob/v24.19.0/deps/v8/src/objects/value-serializer.cc).
[Node wrapper](https://github.com/nodejs/node/blob/v24.19.0/src/node_messaging.cc)
сериализует и десериализует объект. Ошибка не свидетельствует о неподдерживаемом
значении в Atlas. Увеличение JS heap этим местом отказа не обосновано и может
увеличить совокупную нагрузку; такой эксперимент не выполнялся.

Гипотеза накопления клонов проверена отдельно: обычный Node без Vitest выполнил
160 клонов полного исходного Atlas и 160 клонов его `forms`, без GC/heap flags.
Клон не выходил из функции итерации; проверялись число форм, начальное глубокое
равенство и независимость вложенной мутации. Все 320 вызовов завершились;
heapUsed достигал 274,0 MB, RSS 436,0 MB, external 2,24 MB. Последний heapUsed —
154,1 MB. Наблюдаемого монотонного накопления нет. В полных A/B-прогонах память
самого Atlas также почти одинакова; различается совокупная нагрузка workers.

## Регрессия и границы результата

`tools/testing/vitest-workers.test.ts` загружает настоящую конфигурацию и
запускает настоящий scheduler Vitest на девяти найденных node/web suites,
включая Atlas. Лёгкий `PoolWorker` измеряет одновременную выдачу работ без
запуска второго тяжёлого набора внутри теста. Каждый выбранный suite должен
быть выдан ровно один раз; peak concurrency не должен превышать четыре.
До исправления получено **RED: `expected 7 to be less than or equal to 4`**.
Это детерминированная регрессия причины избыточного параллелизма; native OOM
подтверждён отдельным исходным полным запуском, а не искусственным исчерпанием
памяти внутри обычного unit test.

Четыре — проверенный бюджет этого набора на указанной машине, а не универсальная
гарантия отсутствия OOM. Фоновая нагрузка, размер будущих suites и память другой
машины могут изменить результат. При повторении сбоя следует сопоставлять
native/system commit с heap и число одновременно выполняемых suites; один
зелёный rerun не доказывает причину.

## Итоговая локальная проверка

Пять последовательных штатных `npm test` на исходной Windows-машине, без
`NODE_OPTIONS`, `VITEST_MAX_WORKERS`, дополнительных CLI flags или retry:

| Запуск | Начало, MSK | Vitest duration | Результат                    |
| ------ | ----------- | --------------- | ---------------------------- |
| 1      | 16:55:22    | 62,46 s         | 79 файлов, 1515/1515, exit 0 |
| 2      | 16:56:26    | 60,88 s         | 79 файлов, 1515/1515, exit 0 |
| 3      | 16:57:28    | 59,04 s         | 79 файлов, 1515/1515, exit 0 |
| 4      | 16:58:28    | 62,10 s         | 79 файлов, 1515/1515, exit 0 |
| 5      | 16:59:32    | 62,71 s         | 79 файлов, 1515/1515, exit 0 |

`DataCloneError`, OOM, worker exit, skipped tests и unhandled errors не было.
Добавленный один тест — scheduler-регрессия; 164 исходных Atlas tests не менялись.
Их отдельный запуск также завершился 164/164 за 9,14 s.

`npm run verify` — exit 0: checksums, traceability, types, lint, format,
79 файлов / 1515 тестов и cross-registry validation. `artifacts/` и tracked
`generated/` после импорта неизменны; покрытие форм в TRACEABILITY не менялось.

`npm run test:e2e` — exit 0: production Vite build и восемь настоящих
Playwright-сценариев в системном Chrome, 8/8 за 28,7 s. Финальные GitHub checks
`verify`, `markers`, `size` фиксируются ссылками в PR этого исправления.
