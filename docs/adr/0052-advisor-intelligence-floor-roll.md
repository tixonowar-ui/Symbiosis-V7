# ADR 0052 — Отдельный бросок неснижаемого остатка интеллекта Советника

- **Статус:** принято
- **Дата:** 2026-10-26
- **Дополняет:** [ADR 0048](0048-random-symbiont-draw.md) и
  [ADR 0049](0049-atlas-missing-decision-channels.md)
- **Реализует:** issue #147

## Контекст и нормативные источники

При `TROGR + ADVISER` носителю нужен отдельный бросок будущего неснижаемого
остатка интеллекта. RANDOM уже выполнял `TROGR_SUPPRESSION_B`, но MANUAL не имел
законного канала: `CHR-018` не бросает куб, `CHR-042` использует `SET-DECIDE`, а
`CHR-041` принимал только два I/W. Подмена результата текущим I, скрытый третий
I/W или постоянный нулевой бонус не реализует обязательное правило.

Нормативная основа:

- `Q-SYM-005`: дробный результат округляется до ближайшего целого, ровно 0,5 —
  вверх;
- `Q-SYM-073`: при начале подавления один раз определяется `B=R20/4`; итоговый
  минимум I равен `1+B`, а после поглощения Учителя Трогром — `4+B`;
- `Q-SYM-073` и ADR 0048 §8–9: оба независимых I/W и обязательные навыки
  Советника сохраняются даже при подавлении его эффектов;
- ADR 0049 §3 и §7: pending requests создаются отдельно от последующего roll
  commit, а новые каналы и все зеркала проверяются fail-closed.

## Решение

### 1. Точная формула и отличие от текущего I

Для каждой грани `1..20` вычисляется:

```text
B = floor(rawD20 / 4 + 0.5)
futureMinimumI = teacherAbsorbed ? 4 + B : 1 + B
```

Последовательность B для граней 1–20:

```text
0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5
```

Грань 1 законно даёт `B=0`; это результат формулы, а не подставленное
умолчание. Нельзя заменять бросок таким умолчанием. `futureMinimumI` не равен
текущему I Советника, не выводится из I/W, не является окончательным clamp по
`CORE-164` и не создаёт общий runtime `EFFECTIVE_STATS`.

Бросок не запускает critical chain, creation penalty, XP или третий I/W.
Проверяемые примеры: raw 2 даёт `B=1`, минимум 2, а после поглощения Учителя —
минимум 5.

### 2. Один addressed результат на сущность

Для `advisorInstanceDraftId` допускается ровно один отдельный
`TROGR_SUPPRESSION_B` с отдельными `rollRequestId`, `rollReceiptId` и
`commandId`. Pending ID существует до броска и не заменяется после него. Он не
совпадает с I/W request/receipt IDs или receipt подтверждения навыков.

Используется существующий `UI-CMD-CHAR-CREATION-ROLL-COMMIT` с
`sourceFormId='CHR-041'` и `variant='TROGR_SUPPRESSION_B'`, а не `SET-DECIDE`,
`WIZARD-CHECKPOINT` или новый outer command. AUTO вызывает sampler один раз,
MANUAL принимает одну грань без sampler.

Same ID/same payload возвращает прежний receipt. Changed payload, stale
`compositionDraftRevision`, неверный pending ID и повторный B отклоняются до
записи и sampling. Replay, refresh, reconnect, restart и SQLite reopen не создают
replacement request и не вызывают sampler повторно.

### 3. Отдельный MANUAL durable stage

В whole-checkpoint JSON добавлен optional `advisorIntelligenceFloorStage` с:

- host-signed composition, `compositionDraftRevision`, `diceInputModeSnapshot` и
  `advisorInstanceDraftId`;
- двумя независимыми I/W request/receipt IDs и результатами;
- exact-fill skill facts;
- `pendingRollRequestIdOrNull` и не более одного B `rollRecordOrNull`.

Это не `randomSymbiontStage` и не полноценный `manualCompositionStage` из #145.
`randomSequenceId` отсутствует, RANDOM и MANUAL stage не смешиваются. Отсутствие
подавления не создаёт B; подавление требует pending или committed B и запрещает
подтверждение навыков до B receipt.

`commitLocalCharacterCheckpoint` атомарно сохраняет physical roll, request,
receipt, B/minimum и `nextStageEnvelope='CHR-041'`. Strict history пересчитывает
composition, teacher fact, I/W, exact-fill, уникальность ID, revision continuity
и AUTO random-receipt provenance. Изменённая или неполная история отклоняется.
Старые payload без optional stage остаются валидными и не получают synthetic
`null` при следующей записи. SQL migration и изменение `src/shared` не нужны.

Host+SQLite fixture заранее поставляет подписанный MANUAL composition, два I/W
и exact-fill навыки. Его вход из `SKILLS` проходит один checkpoint/state advance
без выдуманного receipt или draft advance. Сам fixture не является production
manual composition bootstrap или editor.

### 4. RANDOM сохраняется без переписывания

RANDOM physical records, их порядок и durable semantics не изменяются. Его B
уже выполнен до `CHR-041`, поэтому новый CTA ему не публикуется. В player
projection добавлены только разрешённые `rollPurpose`,
`rollRequestIdOrNull` и `rollReceiptIdOrNull` внутри существующего
`trogrSuppressionState`, раскрывающие именно future minimum.

Существующее RANDOM recovery доказало replay, refresh, reconnect и restart без
изменения sampler или physical records. Общий RANDOM `EFFECTIVE_STATS` не
вводится.

### 5. Atlas content release 1.5 и зеркала

Legacy JSON/Markdown filenames остаются неизменными, content release — **1.5**,
`releaseDate=2026-10-26`. Добавлен `CHR-041::CTA::004` с label
**«Зафиксировать бросок неснижаемого остатка интеллекта»**, same-form
`workflow-command` и существующим `UI-CMD-CHAR-CREATION-ROLL-COMMIT`.

Синхронизированы visible/allowed, `ctaAvailabilityByAction`, source/target
transition mirrors, top-level transitions, `REQ-002`/`REQ-063`,
`QA-FORM-CHR-041`, workflow guards/atomicity/reconnect/QA и Markdown.
Top-level `requiredFields` не расширяются: новые allowlisted поля остаются
внутри существующего `trogrSuppressionState`; новая game state не выдумывается.
Итог — 376 форм, **1681 transitions**, **1247 action keys**.

`assertAdr0052AdvisorIntelligenceFloor` и конечный Markdown literal registry
останавливают потерю или drift каждого канала. Негативные import/validation
тесты проверяют каждое зеркало независимо. `generated/**` производится только
importer; разрешённые Atlas source-файлы и `artifacts/CHECKSUMS.sha256` не
разрешают побочных изменений других артефактов.

### 6. Проекция и клиент

Web различает RANDOM и MANUAL projection по host-полям и отклоняет смешанные
варианты, лишние поля, synthetic `randomSequenceId`, неполный B и неуникальные
I/W IDs. CTA004 отправляет exact addressed payload без `randomSequenceId`.
После commit или при отсутствии подавления новый B action отсутствует.

MANUAL dice mode определяет необходимость одной локальной грани. Она передаётся
через существующий `requestFormAction`; в AUTO вместо неё отправляется `null`.
Terminal decoder и snapshot matcher проверяют receipt, ревизии, B/minimum и
неизменность I/W, карточки и exact skills. `commandId` всегда принадлежит
фактической B command, а не receipt навыка.

Текст игрока — **«Будущий неснижаемый остаток интеллекта носителя»**.
Используются существующие headings, `<dl>`, связанный `<label>` и native
constraints для D20. Новых redundant ARIA/live regions нет. Клиент не вычисляет
игровой minimum и не получает raw Rule IDs, seed/RNG state, availability trace
или raw catalog rows.

### 7. Граница задачи

Реализованы отдельный B channel, его durable/host transport и web presentation.
Ручной add/remove composition, `CHR-018`, `CHR-042`, собственный I/W transport и
сохранение exact-fill MANUAL Advisor skills относятся к **#145**. Стартовый
`armorBundle` и equipment относятся к **#146** после #145. `CHR-021+`, общий
runtime `EFFECTIVE_STATS`, финальный `CORE-164`, уровни/деревья/OE-progression
и XP не входят в этот ADR.

Наличие B-specific stage и его fixture не объявляет полный manual composition,
его skill transport или V1 завершёнными.

## Обоснование

Отдельный addressed roll выражает обязательную игровую операцию, не смешивая её
с независимыми I/W или с checkpoint фактов. Whole-checkpoint persistence даёт
атомарность без новой схемы SQLite или протокола. Strict replay повторно выводит
результат из host-signed истории, поэтому damaged payload не может молча стать
допустимым новым броском.

Проверки включают все 20 граней, teacher absorption, AUTO/MANUAL, ID uniqueness,
refusal before sampling/writes, replay/refresh/reconnect/restart/SQLite reopen,
player privacy, strict decoder и production browser recovery. На момент решения
всего **1464 Vitest-теста в 69 файлах** и **4 Playwright-сценария** проходят;
реальный host+SQLite fixture подтверждает отсутствие нового sampler после
восстановления.

## Отвергнутые альтернативы

| Вариант                                                                 | Причина отказа                                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Постоянный `B=0`, текущий I, скрытый третий I/W                         | Не выполняет отдельный обязательный бросок и теряет различие future minimum                             |
| `SET-DECIDE` или `WIZARD-CHECKPOINT` как B-roll                         | Эти каналы хранят решения/facts, а не отдельный D20; roll принадлежит `ROLL-COMMIT`                     |
| Новый outer command или SQL migration                                   | Существующие command и whole-checkpoint уже покрывают атомарную операцию                                |
| Generic `EFFECTIVE_STATS` или финальный clamp                           | Future minimum не является текущим effective I или `CORE-164`; это отдельные последующие контракты      |
| Replacement request или reroll при replay/reconnect                     | Результат привязан к сущности и должен быть идемпотентным                                               |
| Перезапись RANDOM records или новый sampler                             | RANDOM уже содержит отдельный законный B; нужны только presentation semantics и доказательства recovery |
| Ручной editor, `CHR-018`, `CHR-042`, I/W transport, equipment здесь     | Это #145 → #146; B-specific fixture не разрешает объявить их реализованными                             |
| Client-side minimum или поддельный `randomSequenceId`                   | Игровой результат и идентичность принадлежат хосту; RANDOM и MANUAL не смешиваются                      |
| Новая game state или generic Markdown parser                            | Достаточно существующих Advisor/pending states и конечных fail-closed mirror registries                 |
| Raw Rule IDs, seed/RNG state, availability trace или raw catalog игроку | Нарушает player privacy и не требуется для понимания назначения/результата                              |

## Последствия

- `TROGR + ADVISER` получает ровно один восстанавливаемый отдельный B-roll в
  RANDOM и MANUAL, а другие составы не получают лишнего броска.
- I/W и обязательные навыки сохраняются; pending B блокирует подтверждение
  навыков, после receipt появляется только разрешённый дальнейший путь.
- Atlas, host, web и traceability имеют согласованный канал, не требующий нового
  outer protocol, SQL migration или изменения `src/shared`.
- #145 использует этот канал и сохранённый результат; #146 следует после #145.
  Их незавершённость остаётся явной и не закрывается этим ADR.
