# Schema22: тестовые данные и byte-exact rollback — #258

Дата: 2026-11-12. Первый независимый clean verify кандидата
`9fe631ed5f0a952209ad834af4cbf512a3d99942` / tree `2efde6d5` завершён
контролируемой остановкой с FAILED/exit -1 после обнаруженных assertions.
Wrapper работал 896,397 с; полного успешного Vitest summary нет.
Исходники clean checkout до/после неизменны. Raw log SHA-256:
`4969fa20c8320c2066704a0050f8e78484d84d110a292ced6159c9413df078c5`.
Это не timeout и не успешный полный gate; исходный журнал и stop metadata сохранены.

## Установленные причины

Точные unchanged-budget reproductions на том же frozen clean checkout показали:

- Общий `submission()` в `network-device-request.test.ts` создавал batch v2
  только для schema11–21. На actual22 он выдавал старый v1; runtime правильно
  отказывал INVALID_INPUT до исследуемых guards. Исправлен только известный
  test-fixture prefix22; legacy branches и runtime-проверка v2 сохранены.
- Старый authoring freshness fixture копировал прежние source seals, но пропускал
  уже поставленный PNG монстра, который обновлённый loader теперь читает при загрузке.
  Stack показал ENOENT до freshness exercise. Добавлена копия настоящего PNG;
  сами source seals и freshness checks не ослаблены.
- Canonical MONSTERS test ожидал только CTA013, хотя #258 добавляет настоящий
  CTA011. Exact equality сохранена с обоими поставленными действиями.
- Остальные воспроизведённые rollback assertions получали правильный отказ
  SOURCE_CHANGED либо ожидаемый throw, а затем падали только на сравнении
  `db.serialize()` bytes. Ни guards, ни исходные byte/row assertions не удалены.

`diagnostic-failure01`, `diagnostic-library02`, `diagnostic-remaining04` и
`diagnostic-paused05` содержат полные stacks, args, env и clean source bindings.
В remaining04 regex не выбрал current-paused schema case; он отдельно воспроизведён
один раз в paused05. Это ограничение selection сохранено, а не выдано за PASS.

## Измерение SQLite pages

Один внешний `diagnostic-pages03` вызвал настоящий tab readonly guard с одинаковой
DDL-ошибкой на свежих schema21 и22. Он не менял production source, assertions,
бюджеты или defaults. Все 68 candidate source hashes до/после совпали.

Schema21: freelist пуст, SOURCE_CHANGED, serialized bytes полностью равны.
Schema22: до операции есть один freelist trunk и 11 leaves; после правильного
SOURCE_CHANGED отличаются ровно четыре байта на странице235, которая уже была
свободным leaf ДО вызова. Все строки всех таблиц, schema и PRAGMAs совпадают;
после маскирования только заранее прочитанного BEFORE leaf set значимые pages
равны. FK пусты, integrity=ok. Полные before/after SQLite bytes и states сохранены;
raw log SHA `570e85ce8140afb27e4a3a7e8d6a6f7f93937838cf45315e995293a0c3b3ac16`.

SQLite не журналирует неинформативное содержимое freelist leaves (§7.3 atomic
commit). В репозитории уже есть локальный VACUUM перед таким byte-exact snapshot
в network request fault test и отдельная проверка BEFORE freelist в migration test.
Тот же precondition применён только к затронутым изолированным fault fixtures:
VACUUM и обязательный `freelist_count=0` выполняются ДО ошибки и захвата bytes.
Все прежние отказы, реальные действия, triggers, row checks и точные byte
assertions сохраняются. Production migration0022, guards и пользовательские БД
не получают compaction или иной новой операции. Это исправление тестового
precondition, не performance fix и не утверждение универсальной latency.

## Проверки после исправления

Один полный набор шести affected owning files со стандартными workers и прежними
бюджетами собрал 308 tests: 306 PASS / 2 FAIL, Vitest334,50 с, wrapper339,895 с.
Оба оставшихся network случая прежде маскировались неверным batch fixture;
теперь их stacks показали только Buffer equality после ожидаемого отказа.
Этот failed run сохранён (`owning-fixtures01`, log SHA
`506919cb5c6e5706a541d1151cae279faba3e9f40c33c58757a79215b1e011be`).

После двух дополнительных локальных preconditions весь network-файл прошёл:
78 PASS, Vitest26,59 с, wrapper27,459 с (`owning-network02`, log SHA
`5993875b4a7067e5f99c6b9db6a02f813bc1fc17c6e99739967cc849c3264991`).
Остальные пять файлов не менялись и сохраняют привязанные 230 PASS первого
набора. Это два разных source-bound запуска, а не один новый all308 PASS.

## Второй clean verify и NPC mirror rollback

Независимый clean verify `c05811326441c887ca323b40b6f892ebf88a22b1` / tree
`d5e976fb` контролируемо остановлен FAILED/exit -1 через 3885,866 с после отказа
существующего NPC source-capture case. Полного успешного summary нет; clean
исходники до/после неизменны. Raw log SHA-256:
`00ca41dedc6a6c13066524e2e9a07070f23e8e6f52a219bcd570d194b38934f5`.
Это assertion failure, не timeout: native async `writeGmMirror` с поддельным
display tag правильно отклонён с INVALID_INPUT, bodyCalls/delayedWrites равны
нулю, транзакция закрыта. Падает только прежнее точное сравнение Buffer.

Unchanged case отдельно воспроизведён в `diagnostic-source-capture06`. Один
последующий measurement-only запуск `diagnostic-source-pages07` сохранил все
исходные assertions и снова завершился FAIL на Buffer. В before было десять
freelist pages: trunk272 и девять leaves. Отличаются 7697 байт только на заранее
свободных leaves260/261/264 (3580/3617/500 байт). Все строки, schema, PRAGMAs и
значимые pages совпадают; bodyCalls/delayedWrites остаются нулевыми.
Raw buffers SHA-256 до/после:
`3ba552d5c0911e5798244181b0cae59d1221a9449aa6c536a1f6b901c8e16fe3` /
`31b5e0dd50f9ebb752dc9c6ad65df0478fc3a98319f4c15dedc7dcf99c30ba4b`;
measurement log SHA
`874bab2e7108800f3fd1bd608623ff9fc148595810894f75493aa9a024ea92b6`.
Временная instrumentation удалена; fixture восстановлен побайтно к исходному
SHA `d7ef53df88caa376bcd2f2a28526864b5f842aea04f3620ee280f2a36283da2f`
до исправления. Frozen clean checkout не изменялся.

Тот же локальный precondition добавлен только ветке `method=writeGmMirror`
этого именованного теста, перед исходным byte snapshot. Ранний source-reader
случай, общий fixture, callbacks, все assertions и бюджеты неизменны.
Один bounded набор `npc-fault-group08` выбрал 18 существующих cases в шести
registry wrappers: source-capture4, lazy preparation8, поздний item rollback1,
поздний disease rollback1, неподтверждённый editor input1 и checked closure3.
Все 18 PASS; ещё 78 cases отфильтрованы. Vitest38,90 с, wrapper39,850 с,
log SHA `4a42cf0cc43c30533b5c26787fd5dddead298a59e5cf2a6176c3d439e4a71373`.
Это выбранный fault group, не шесть полных suites и не full verify.

Относительно failed9fe/c058 нет budget/hook/default/worker/retry/CI изменений.
Новый committed SHA ещё требует независимые clean five-stage, полный CI,
protected merge и actual closure/tree proof. Старые failed gates и прежние dirty
browser результаты не переносятся как full PASS нового кандидата;
#258/#188/#113 пока открыты.
