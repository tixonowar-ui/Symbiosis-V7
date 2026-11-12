# Произвольный монстр V1 — runtime #258

Дата: 2026-11-12. Авторский кандидат от поставленного #257, main `44c5dd8`,
tree `ab05f2fc`. Issue #258 ещё открыта; #188/#113 остаются открытыми.
Независимый clean five-stage, CI, protected merge и сверка main tree ожидаются.

Первый clean verify `9fe631e` остановлен FAILED после выявленных fixture
несоответствий schema22 и rollback byte preconditions. Точные reproductions,
page-level доказательство, узкие test-only исправления и новые scoped результаты
сохранены в [разборе](fixture-rollback-258.md). Production source и budgets не менялись;
новому SHA предстоит полный gate заново.

## Продукт и источник

Настоящий GM входит из PAUSED CMP-007 через GM-001 в раздел «Монстры» ENM-001.
CTA011 открывает ENM-011–016: identity, семь ручных характеристик, масса,
возраст, базовый максимум HP, физика, атака, NONE либо один ordinary symbiont,
полный лист и atomic V1 → ENM-020. Используются прежние GM shell, QUEUE,
workflow commands и receipts; новых глобальных CTA или оболочки нет.

Закрытая kind `CUSTOM_MONSTER` отделена от SENTIENT. Creature type только
отражает эту kind; нового игрового enum источник не задаёт. CORE-193/194,
CORE-199–205/207/210/211/226, MON-090/091, ADR0077 и ENM-011–016 задают контракт.
Базовые характеристики — целые 1–35, масса 5–10000 кг с шагом 0,1, возраст
целый ≥1, baseMaxHP целый ≥1 без игрового потолка. Итоговые характеристики
могут превышать 35, но не опускаться ниже 1; общего clamp/округления нет.

CORE-205 представлен закрытыми 11 определениями естественной брони, урона и
пробития. CONSTANT допускает положительное конечное значение; X положительный
целый. R20*2+X сохраняет один будущий R20 с множителем, а не два броска.
Authoring не вычисляет эти определения и не получает RNG receipts для них.
Анатомия фиксирована NONSTANDARD_TORSO_ONLY/TORSO; MONSTER_ATTACK/MELEE/1 action
read-only. Размер, движение и теги не дают механических модификаторов.

Ordinary использует настоящий source graph, mandatory L1, prerequisites,
AND/OR/XOR, target level, функциональную привязку и native OE. Max HP складывает
введённый максимум и только реальные learned contributions; NPC base HP=100,
раса, класс, inventory, equipment и host skills не переносятся. Тело рождается
живым, в сознании, с полными HP/OE и пустыми wounds/effects/cooldowns/initiative.

SYM076/AQA005 ограничивают Trogr caps предикатами UNITED/FREE. У CUSTOM_MONSTER
нет этих рас, поэтому S35 + Trogr L1 =41; это отсутствие ложного race predicate,
а не новый cap. Явные минимумы I/W/C и именованные Teacher W20/Dolphin I30
сохраняются. Advisor имеет отдельную обязательную личность: реальные два R20+8,
own skills, требования и фактические charges. Принятый CONFIRM либо изменение
manual body фиксирует permanent losses по последнему принятому графу; PREVIEW
сам не забывает знания. Возврат уровня/характеристик не воскрешает навыки и не
перебрасывает исходную карточку. Host skills монстру не выдаются.

## Хранение и границы

Миграция 0022 добавляет шесть форм и новую kind, копируя старые JSON/hash,
QUEUE records и identities без нормализации. Старые schema21 SENTIENT prefixes
остаются явно допустимыми. Любой CUSTOM prefix, включая NAV011 → cancel без
PATCH после выхода из ENM, требует настоящую запись 0022. Исторические
prepared composition/knowledge проверяются против своего исходного prefix,
а не только последнего выбора. Source/placeholder freshness проверяется при
реальном monster use/history. Catalog loader один раз читает monster PNG при
загрузке; unrelated NPC/SENTIENT reads не получают дополнительную безусловную
переоценку monster body или повторное чтение PNG для freshness.

V1 атомарно сохраняет template/version/history/current pointer вместе с QUEUE
и receipt. Nested instance/card identities резервируются в общей namespace.
User rows разделены по kind/tab; request decoder, context и projection одинаково
проверяют эту связь. Старые 44 system templates, canonical 16 species/17 statblocks,
Runtime Pack, FINAL и прежние receipts не меняются. Арт — поставленный
`symbiosis_placeholder_monster`, без upload или произвольного fallback.

N+1, archive/delete, filters, instantiation, placement, combat, attack resolution,
loot, PC XP и ROLL_ONCE не реализованы. Однократная генерация явно недоступна;
нет скрытого executable no-op. Артефакты/CHECKSUMS, generated, CI и общие
настройки проверок не меняются. Нового игрового решения или source gap не найдено.

## Целевые доказательства и ограничения

Внешние raw logs/started/result и immutable snapshots сохранены в `evidence-258`:

- `node-monster-final01`: 96 PASS / 5 полных новых файлов, Vitest 90,09 с,
  стандартный parallelism. Все 13 owning cases, grammar/domain и SQL compatibility
  прошли. Stale/foreign/kind/source отказываются без writes/RNG; hidden coherently
  rehashed prefix выявляется после later NONE V1, выхода и физического reopen.
  Реальный current-GM loss блокирует новые PATCH/CONFIRM/COMMIT и exact replay;
  fault rollback сохраняет все четыре V1 таблицы и QUEUE.
- Genuine #256 empty V1 и #257 COMPOSED V1/open plan читаются через owning runtime
  после физической миграции/reopen. Raw rows снимаются до owning open; допускается
  только добавление registry0022. Прежние record bytes/receipts, replay, FK и integrity
  проверены. #257 gzip произведён старым `c6820e9b`/tree `ab05f2fc`, не новым runtime.
  Его canonical pre-open bytes и physical post-replay witness имеют разные роли,
  описанные в fixture README. KDF verifier в этих unit harness обходится явно.
- `web-project01`: 929 PASS / 33 файла до последней локальной Unicode поправки.
  `web-monster-unicode02`: оба затронутых custom cases прошли на новых bytes;
  real textarea принимает 2000 code points, отказывает 2001 и снова принимает 2000.
  Own-card controls показывают требования, source limits и цену/занятую ёмкость.
  Malformed/foreign-kind packets проходят настоящий ws-client с mock Socket и
  сохраняют last confirmed view; это не доказательство сетевого транспорта.
- `browser02`: один настоящий production Chrome/WS/SQLite case, 52,1 с,
  1 attempt, 0 retry/flaky/skip/attempt/global errors. HTML-аудит подтвердил все
  восемь final assertions; 12 промежуточных comparison errors лежат внутри шести
  успешных poll groups, вне их ошибок нет. Пройдены lost COMMIT ACK, reconnect,
  explicit custom row selection, физический host restart, full profile/art и
  delayed exact replay после выхода в GM-001. Настоящий PLAYER-сеанс той же
  установки получает отказы на новый NAV011/PATCH/COMMIT; payload/DOM/a11y не
  раскрывают private data. Этот run предшествует Unicode-only widget поправке;
  его результат не переносится как проверка новых bytes. Финальный clean E2E
  должен проверить окончательный SHA.

Сохранены первоначальные failures: stale renderer tally94 вместо source100;
foreign-owner category expectation; latest21 expectation при actual22; первый
browser user-selection отказ. Последний выявил реальный SENTIENT-only predicate
в request decoder: исправлен kind/tab guard, owning regression и causal browser02
прошли без ослабления assertions/waits. Ранний browser01 не дошёл до restart/tails.

Только длинный именованный Advisor owning case получает body60 с по ADR0088:
первое измерение 27,985 с при прежних 30 с. Это конечный запас для полного
Back/loss/replay workflow, не установленная timeout/performance причина.
Два индивидуальных source-backed web bodies имеют 30 с; shared hooks/defaults,
workers/retries и существующее отдельное разрешение hook группы #257 не меняются.
Авторские scoped проверки не являются полным merge gate и не закрывают issue.
