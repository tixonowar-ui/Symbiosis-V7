# Полные новые версии enemy — #259

Дата авторского состояния: 2026-11-14. Это незавершённый runtime-кандидат от
поставленных source #288/PR289 и process #290/PR291. Текущая база main —
`3a35f5229a6a581333454cc666e1db5a33cfc330`, tree `cfd598d6`;
Atlas1.22/B17 и [ADR0094](../adr/0094-enemy-version-configuration-replacement.md).
#259, #188 и #113 остаются открытыми. Первый runtime commit `de06e696` получил
FAILED в независимом clean01; исправления пока проверены только целевым набором
на WIP. Новый окончательный SHA, его независимый clean5, полный CI, protected
merge и подтверждение delivery ещё ожидаются.

## Пользовательский контракт и пределы

Мастер начинает ENM017 из существующего каталога ENM001/CTA008, редактирует полную
копию текущей SENTIENT или CUSTOM_MONSTER версии, указывает причину и видит
содержательные различия либо явно показанное отсутствие полевых изменений.
Обычная копия сохраняет навыки, оплату и потери.
Отдельная замена конфигурации показывает точный новый ввод и последствия;
согласие связано с preview, actual NAV/base/template/campaign и revisions.
Локальное редактирование снимает согласие, в том числе после возврата к прежнему
значению. Смена причины не может незаметно отбросить подготовленный выбор.

Сохранение должно атомарно добавить N+1/history и передвинуть current pointer.
Отмена не добавляет версию; история ENM020 не передвигает current. Выбор V1 в
истории и последующее возвращение к редактированию берут фактическую текущую V2.
Прежние V1/FINAL/record JSON/hash, исходные receipts, ID и арт неизменяемы.
Арта upload/clear, боевых экземпляров и реальных combat pins здесь нет.
ENM018/019 и новые семь monster R20 остаются недоступными до отдельной поставки.

Требуемый контракт охватывает оба kinds. CUSTOM не получает START,
расу/класс, навыки владельца, inventory или SENTIENT suppression. Это не NPC OPEN,
NPC lifetime journal, TRAINING, XP, maxW, игровое время или сцена по умолчанию.

## Учёт, mandatory facts и источник

Хост разрешает source из авторитетного более раннего owning prefix. Candidate
или поздний NAV не могут доказать собственное происхождение. Копия/обычные правки
сохраняют START/SYM166 mixed payments, известные навыки и постоянные потери;
сброс текущего выбора допускается только отдельным подтверждением ADR0094.
GROSS применяется однократно к новому initial basis, без stacking. Сначала
проверяется реальный полный body/loadout, затем необратимые требования/потери;
значения выше35 допустимы, ниже1 — нет. Временное оборудование не забывает навыки.

FREE хранит фактическую signed R6 delta; она не пересчитывается от новой основы,
не clamp/refund. Карта, I/W, настоящее initial fill и применимый исторический
SENTIENT suppression сохраняются в owning template prefix, включая отменённые
попытки. Неактивный исторический SENTIENT suppression не активирует бонус и не даёт
повторного броска; сохранённая signed FREE delta при этом не исчезает.
SENTIENT FINISH до успешного inventory не объявляется реальным initial fill;
CUSTOM имеет собственную подтверждённую body/FINISH границу. Не приобретённой
карте доступны только прежние source-backed acquisition controls. Уже
приобретённая, но ни разу не заполненная карта сохраняет право первого заполнения;
отброшенную неактивную карту не требуется заполнять ради NONE.

Legacy ABSENT остаётся отсутствием в старых records. Обычное копирование без
новых применимых effects не создаёт plan/discriminator. В частности actual zero
FREE delta при неактивном PURE составе не принуждает upgrade, а активный FREE
slot effect должен быть представим и проверен. Новое явное подтверждение не
переписывает старые версии или receipts.

## Проверено в ограниченных scopes

Сохранены отдельные source-bound журналы pure/shared, NAV/store, real old256/257/258
physical read/replay, обеих own-card ветвей, истории, механики, отказов и SQL faults.
Это разные bytes/scopes; их результаты не складываются в вымышленный общий PASS.

- Механический N+1 owning case проверяет mixed START/SYM166, capacity0/reacquire,
  отсутствие resurrection/refund, SYM079 once-from-new-basis, invalid loadout
  zero partial loss, final stored accounting/GROSS после физического reopen.
- Fresh prepare spies отделяют реальные stale/foreign/changed replay и local-GM
  context/owner validator от исторической rederivation. MANUAL randomInt0 не
  объявляется доказательством отсутствия AUTO sampling; новый live latest gate
  не выдаётся за достижимую вторую GM context.
- Три конкретных SQL RAISE markers доказали достижение version/history/pointer
  fault sites, точный rollback rows/schema/cursor/receipt/bytes и последующий
  once/replay/reopen. Локальный fixture freelist0 — предусловие byte oracle, не
  production compaction и не диагноз WAL по статье о rollback-journal mode.
- Source/registry группа: 4 PASS, 13 отфильтрованы. PNG копируются как полный
  положительный loader input; actual drift исполняется только на skills.json.
  Проверены foreign input.kind, source drift, недоступные roll/system controls,
  rehashed SQL mirror с будущим NAV и независимый более ранний prepared QUEUE
  summary после later NAV/reopen, обязательная23 даже после NAV/cancel без PATCH.
- Schema fixtures: 343 PASS в восьми целых Node files; renderer — 24 PASS,
  точные101 screens/10 dialogs. Реальные исторические14/22 и v1 batch отказ на22
  сохранены;23 добавлена отдельно. Неизвестная24 вставляется после целой1..23;
  отказ сохраняет прежние registry rows и данные/bytes. Typecheck, scoped lint и format этой группы прошли.

KDF bypass и MockSocket/fetch — ограничения owning/client-module fixtures, не
LAN proof. MockSocket actual catalog→UUID NAV→correlated ENM017 прошёл1 selected /
40 filtered на прежних bytes. Отдельный настоящий App/WS-client case прошёл1/41
filtered: локально изменённая причина не отправляет workflow, возврат к сохранённой
причине отправляет NEW с точными host reason/attempt/revisions. Этот case подаёт
capabilities через MockSocket и не доказывает реальный host negotiation. Отдельный
owning resume case прошёл1/15 filtered: NEW доступен только при включённом enemy
host и предложенной клиентом команде; отключённый host или отсутствие NEW в
предложении её исключают. Typecheck, scoped lint и format обеих коррекций прошли.
Реальный двухвидовой Chrome proof приведён ниже; owning Advisor tests обоих kinds
не подменяют его. Новых a11y assertions в этих сценариях нет.

## Сохранённые Chrome отказы и незакрытая публикация

Новые два Chrome cases имеют ограниченный body360s; общие hooks/defaults,
workers/retries/CI/production deadlines не менялись. Первый запуск остановился
до host startup на sandbox tsx/os.userInfo `uv_os_get_passwd ENOMEM`; это не
доказательство нехватки памяти. Та же команда под владельцем сохранила
source/build scope и выявила ошибочные тестовые race locator и null-prototype
adapter. Следующий запуск дошёл до NAV и обнаружил UUID omission для
library-owned CTA008; добавлен ровно этот переход в существующий UUID predicate,
строгий domain grammar не ослаблен. Тестовый разбор отдельно валидирует и снимает
только существующий lifecycle envelope, как штатный WS-клиент.

После этого оба kinds сохраняют настоящий V1, но NAV017 завершается WS1011.
Одиночная согласованная SENTIENT-диагностика сохранила полный host stderr:
`encodeSnapshot` отклонил `$.presentation.base` / ENM017 как UNRECOGNIZED, поскольку
host protocol vocabulary ещё не регистрирует этот экран. Это не повод увеличить
wait. `host.errors` содержит12 stderr chunks одного frame error, не12 ошибок.
Все HTML, trace, скриншоты, raw attempts и исходники failed runs сохранены.

Минимальная регистрация017 и codec regression применены и прошли12 целевых
codec tests, typecheck, scoped lint/format и проверку официальной traceability.
Последующие реальные попытки05/06 сохранили две отдельные ingress ошибки:
финальная CTA004 ошибочно попадала в PATCH dispatch и не передавала host reason;
после её исправления реальный resume ещё не объявлял NEW в capabilities. Во втором
случае UI явно сообщал «Команда недоступна», NEW не отправлялся, host/page errors
отсутствовали. Исправлены точный017/004 dispatch с guard локального ввода,
reason из проверенного host context и ровно NEW в прежнем enabled/client-offered
фильтре host resume. Старые отчёты, исходники и ошибки внешних readers сохранены.

Авторский production07 прошёл оба полных случая с первой попытки:2 cases,
2 attempts,0 retries/flaky/skips/attempt/global errors. Свежая официальная сборка,
системный Chrome,1 worker, прежние body360s и все ожидания/assertions сохранены.
SENTIENT реально заменяет начальные навыки и подтверждает полный body; CUSTOM
меняет manual body и текущие навыки той же Advisor card с прежними I/W/initial fill.
Оба проходят reason/diff/consent и локальное edit-away/back снятие согласия,
потерянный NEW ACK/reconnect, V1/V2 history без сдвига current, новый edit от V2,
physical restart и PLAYER wire/DOM. После возврата мастера на GM-001 обе исходные
receipts V1/NEW воспроизводятся точно, обе correlated projections остаются GM001,
прежние строки V1/history/template не меняются. Эти финальные raw probes проверяют
серверные receipts и текущую проекцию: harness удерживает ответы, обычный клиент
не применяет unsolicited replay. Обычный lost NEW ACK и browser reconnect выше —
отдельный положительный клиентский путь. Сохранены настоящие preview/history PNG
каждого kind.
HTML содержит130 промежуточных comparison errors внутри32 успешных polls,
вне успешных polls ошибок нет; все8 final assertion sites выполнены в обоих cases.
Повторённый GM assert HTML объединяет в один step с count2; внешний reader
исправлен с независимой проверкой обеих raw correlated projections, без нового
запуска тестов. Root независимо проверил весь scoped отчёт, raw replay/projection
witnesses, polls/tails и реальные изображения: review259-browser07 — PASS.
Это только два dirty production cases; полный clean5/CI окончательного committed
SHA не заявляется.

Общий предел42 явно утверждён владельцем и отдельно поставлен
[process #290 / PR291](https://github.com/tixonowar-ui/Symbiosis-V7/pull/291):
main `3a35f5229a6a581333454cc666e1db5a33cfc330`, tree `cfd598d6`.
Прежнее предложение41 заменено решением42; остальные оси, классификатор,
исторические исключения, workers/retries/timeouts сохранены. Runtime diff не
включает CI/AGENTS. Интеграция выполнена через полный внешний backup68/index/diff,
именованный retained stash, FF-only и stash apply без pop/reset/clean.
Все63 файла кода/тестов восстановлены побайтово; обе CHANGELOG записи сохранены.
Scoped результаты выше сохраняют исходные source-bound scopes. Полные clean5/CI
процессного PR не переносятся на #259. Первый runtime clean01 и последующая
ограниченная коррекция описаны ниже; новый окончательный SHA и его независимые
full gates ещё ожидаются.

## Сохранённый clean01 и целевая коррекция

Независимый `npm run verify` на неизменённом `de06e696` завершился exit1:
7592 PASS / 15 FAIL из7607 tests,303 PASS /9 FAIL из312 files;
Vitest5756,31с, весь verify5980,7305с. Полные log/result/start и исходники
сохранены; это FAILED, а не частичный зелёный clean5. Финальный лог не содержит
отдельных unhandled async error blocks. Типы, lint и format до unit tests прошли,
последующий validate этим отказавшим verify не исполнялся.

Восемь прямых oracle failures относились к устаревшим registry expectations
после0023, ожидаемому resume capability list без NEW и смешанному legacy frame:
отсутствие summary при наличии B17 history намеренно не принимается codec.
Для настоящей старой формы отдельно проверяется отсутствие и summary, и history.
Настоящие старые fixture bytes/hashes, все старые строки и receipt/replay
assertions сохранены; ожидаемая0023 берётся из production migration.

Отдельный negative удаляет обязательную22, оставляя23, что нарушает полный
migration prefix. Ошибка полной проверки на приватной read-границе
классифицируется точно как `network application storage: CORRUPT_STORAGE`.
Оба строгих read/project отказа и byte-exact no-write assertion сохранены;
production error не нормализовался ради прежнего ожидания SOURCE_CHANGED.

NET lost-first-BIND-ACK case завершился terminal assertion: NET011 /
UNCONFIRMED_OUTCOME вместо NET005. В его beforeNextDeliver после реального
forward migration находился устаревший MAX22 oracle; изменено только ожидание23.
Новый целевой запуск прошёл весь исходный schema10/forward-migration/BIND/lostACK/
restart/original-receipt chain за9,457с. Это scoped proof данной цепочки,
не новый production fix и не общий вывод о сетевой задержке.

Пять остальных отказов — body timeouts в конкретных N+1 cases. Четыре заголовка
сгруппированы reporter под одним сообщением300000ms; оно не заменяет фактические
source budgets60/120/180/300с каждого случая. Пятый standalone timeout явно60с.
Ни duration marker, ни группировка не доказывают ресурсную причину.

Один согласованный целевой запуск текущего WIP: ровно15 PASS в9 files,
252 отфильтрованы из267 collected; Vitest446,90с, wrapper455,506с.
Exact escaped terminal-title roster соответствует всем15 исходным отказам
с двумя актуальными переименованиями. Все76 source pins и controls до/после
совпадают. Затем последовательно прошли node/web typecheck83,010с,
scoped ESLint по9 изменённым test/fixture paths52,786с, Prettier check4,193с
и diffcheck. Это не полный прогон файлов и не PASS нового committed SHA;
независимые full clean5/CI/E2E ещё требуются. Родители #188/#113 открыты,
260/261 остаются следующими отдельными поставками.

## Именованные body budgets

После подтверждённых clean01 body timeouts изменены ровно пять именных budgets.
Округлённый конечный запас1,5x взят от cohort marker, а не от предположения
о причине задержки. Тот же default максимум4 workers сохранён; целевой набор
не воспроизводит полный312-file cohort.

| Именной case                       | Прежний body, с | clean01 marker, с | Новый body, с | Длительность целевого сценария, с |
| ---------------------------------- | --------------: | ----------------: | ------------: | --------------------------------: |
| SENTIENT MECHANICAL                |             300 |           572,129 |           900 |                           163,209 |
| CUSTOM COPY                        |              60 |            67,141 |           120 |                            22,026 |
| CUSTOM canceled card               |             120 |           191,543 |           300 |                            85,450 |
| SENTIENT canceled card             |             180 |           391,571 |           600 |                           114,575 |
| SENTIENT displayed-summary refusal |              60 |           235,630 |           360 |                            49,540 |

SENTIENT COPY и второй SENTIENT historical-summary остаются60с; REGISTRY60с,
canceled FREE/zero120с, NEGATIVE/SOURCE180с, FAULTS120с также не меняются.
Старые scoped измерения162,117/164,548с MECHANICAL,49,810с FREE,
72,004с CUSTOM card и88,249с SENTIENT card сохранены в своих scopes.
Ни новый запас, ни целевой PASS не являются performance fix, SLA,
доказательством resource cause или гарантией final CI.
Прежний отдельно одобренный beforeAll30s относится только к прежней группе18
web composition cases; новые cases не расширяют это разрешение.
