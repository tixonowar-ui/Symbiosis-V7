# Источник полной конфигурации N+1 — #288

Дата: 2026-11-13 (Москва). Источник основан на явном ответе владельца A по #288,
предложение02 SHA-256 `e32d3e08b7bcdd0d51631c8885fa4e16a6654cbce1039c28c2f1b252ae011f8a`.
Runtime #259 остаётся заблокированным до фактической поставки этого источника;
#188/#113 сохраняют полный объём и остаются открытыми.

## Контракт и границы

Atlas1.22/B17 и [ADR0094](../adr/0094-enemy-version-configuration-replacement.md)
разделяют неизменную копию, обычное редактирование текущего плана и явную полную
замену конфигурации N+1. PATCH на ENM017 готовит/подтверждает candidate; единственный
NEW-VERSION атомарно публикует полный payload с reason/diff и актуальной baseVersion.
Новых CTA, маршрутов, workflows, NPC OPEN или игровых чисел нет.

Неизменная копия сохраняет реальные навыки, смешанные START/SYM166 payments и
permanent losses. Только связанное с точными input/consequences/revisions явное
подтверждение заменяет текущие choices; обычный NAV/save/replay этого не делает.
GROSS считается один раз от новой исходной базы. Фактический signed FREE R6,
карта Advisor, I/W, initial fill и исходные receipts не стираются; SENTIENT
suppression fact сохраняется и при неактивном predicate. Для CUSTOM нет START,
race/class/host skills или suppression. Подтверждённые mandatory facts ищутся в
owning template-bound prefix, включая позднее отменённые version attempts.
Первое фактически отсутствующее acquisition использует прежний kind-specific
контракт; существующая карта не заменяется и не перебрасывается.
CORE201/ENM018–019 и новый monster RNG #260 не реализуются этой поставкой.

## Источники и совместимость

Изменены только три формы ENM007/017/020, два существующих workflow contracts,
семь QA, связанный journey и метаданные Atlas. Per-command PATCH availability
имеет собственный authoritative workflow ID; preview/rename не требуют будущего
consent, явная замена требует. JSON и независимый Markdown проверяются точными
seals и отрицательными cases. Importer по-прежнему требует для каждого workflow
QA.expected точное равенство atomicity + пробел + reconnect.

Текущий B17 manifest: `17910b701eb50d0e659fc2845f45bb510ac66398c75fa08f71db4a4520490111`.
Замороженный B16 manifest сохранён точно: 3177байт,
`73c143c90f588da5a1166b1456991aa8aafd4cde4101fac839a2967c27e68a11`.
Разрешены только явно перечисленные B0–B16→B17 пары; неизвестные и обратные
переходы отвергаются. Non-Atlas bytes/path set, 24 replay catalog seals и frozen
runtime tuple неизменны. Patch288 проверяется реальным Git в обоих направлениях.

Runtime-совместимость ограничена текущей ENM020 projection: host выдаёт literal
null в versionConfigurationSummaryOrNull, closed decoders принимают только null
и только на020. Необязательное отсутствие сохраняет прежний wire grammar;
никакого plan/UUID или summary object не создаётся. Read-only текст объясняет,
что сохранённая версия не имеет отдельного подтверждения конфигурации N+1.
Stored attempts/V1/FINAL/receipts не получают новых полей, политика259 отсутствует.

## Scoped доказательства и сохранённые отказы

- Official import03 прошёл после конкретной синхронизации двух QA.expected;
  import02 со строгим equality refusal сохранён. CHECKSUMS пересчитаны только
  официальным инструментом; generated создан только import.
- Source contracts: 519/3 PASS до одной type-only аннотации; свежий lineage
  contract02 — 154/4 PASS, включая новый negative contract и 34 реальных Git
  forward/reverse cases. TSC03/04 PASS. Первоначальный TSC02 TS7053 сохранён.
- Lineage01 отказал из-за декоративного Git hunk-header suffix. Только suffixes
  нового patch288 удалены; все38 hunk bodies и остальные bytes идентичны,
  строгий parser не менялся. Lineage02 проверил весь выбранный набор заново.
- Historical01: 5 PASS / 2 FAIL / 100 отфильтрованы. Один новый test ошибочно
  ожидал ENM009 вместо указанной старым producer ENM008; второй дочерний tsx
  остановился до product code на uv_os_get_passwd ENOMEM. Это не доказательство
  нехватки памяти приложения. Historical02 в owning Windows context дал
  2 PASS / 27 отфильтрованы для этих двух cases; это не один all107 PASS.
- Реальные старые #256 empty V1/B15, #257 composed V1+B16 open plan и #258 CUSTOM
  NONE V1+B16 open attempt проходят physical SQLite reopen, исходный exact receipt
  replay и сравнение всех таблиц с raw readonly baseline ДО первого owning open.
  Для schema21 разрешён только прежний0022 registry append; schema22 не меняется.
  JSON/hash, FK/integrity и serialized bytes через повторное чтение/replay сохранены.
- Два затронутых web-модуля: 37/2 PASS. Проверены actual saved host null/render,
  отказ non-null/foreign-form summary, сохранение предыдущего confirmed view в
  настоящем ws-client с MockSocket/fetch. Это module proof, не LAN/WS/E2E.

Исторические producers используют прежние owning функции, но обходят password
KDF; #258 fixture MANUAL/NONE не доказывает Advisor/RNG. Canonical gzip содержит
исходные serialized bytes; отдельный post-replay physical witness отличается
только SQLite header и остаётся во внешнем evidence. Новая миграция23 не включена.
Все failed logs и intermediate source manifests сохранены отдельно. Финальные
committed SHA, независимый clean5 и CI ещё ожидаются; scoped PASS не заменяет их.
