# ADR 0053 — Повторное открытие карточки после частичного выбора навыков

- **Статус:** принято
- **Дата:** 2026-10-27
- **Дополняет:** [ADR 0046](0046-character-starting-skills.md) и
  [ADR 0050](0050-addressable-skill-card.md)
- **Узко заменяет:** исключение `CHR-015::CTA::002` из ADR 0050 §1 только для
  `CHR-015/PARTIAL`
- **Реализует:** уточнение issue #144 по ревью PR #150

## Контекст и нормативные источники

ADR 0050 разрешил добавление навыка через `CHR-014` и возврат в mutable
`CHR-015/PARTIAL`, но сохранил полное исключение `CHR-015::CTA::002`. В результате
после `open A → add A` игрок не имел законного browser-пути к следующей карточке:
повторный `open B` отклонялся, а канонический набор нельзя было продолжить через
`add A → add B`.

Нормативная основа не меняется:

- Atlas `CHR-013`, `CHR-014`, `CHR-015`, `CHR-015::CTA::002` с guard
  `selection draft checkpointed`, journey `SKILLS`, `REQ-002`,
  `QA-FORM-CHR-014` и `QA-CHANGE-CHR-014`;
- ADR 0046 §2–4 и §8–10: host-signed levels, единая selection authority,
  `selectionRevision=draftRevision` и projection-only safe-return;
- ADR 0050 §1–6: exact addressable route, canonical current+new набор,
  `NONE|PARTIAL|EXACT`, append-only card-add history и host-signed recovery;
- `skills.json`, `skill-requirements.json`, `CORE-081`, `CORE-165` и `CORE-167`.

Ревью PR #150 является уточнением продуктового маршрута, а не новой игровой
механикой. Issue #144 остаётся единственной задачей; дубликат не создаётся.

## Решение

### 1. Safe-return разрешён только из PARTIAL

Существующий `CHR-015::CTA::002` возвращает в `CHR-013` через существующий
`navigation.form-action`, если durable selection является `PARTIAL` от card-add
с `sourceFormId="CHR-014"`. Для такой проекции публикуются только `CTA::003`
для local draft и `CTA::002` для возврата в каталог.

Для `NONE` остаётся только local-draft `CTA::003`; `EXACT` остаётся actionless.
`CHR-013::CTA::003` не публикуется, финальный `CHR-015::CTA::001` по-прежнему
выводится только для exact-fill и только он подписывает переход в `CHR-017`.
Safe-return не меняет selection, draft/state/checkpoint/actor-visibility
revisions и использует только существующую `projectionRevision`.

### 2. Повторный open сохраняет все authority guards

Тот же exact route `/player/characters/:localCharacterId/create/chr-014/:skillId`
разрешён из начального `CHR-013` и из подписанного `CHR-015/PARTIAL`.
Допустимые durable состояния исчерпываются начальным `CHR-013` без selection и
`CHR-015` с partial card-add. Финальная selection и произвольная форма не дают
общего права навигации.

Host повторно проверяет character/checkpoint identity, оба route bindings,
`skillId`, inspectable catalog, eligibility, presentation и текущие revisions.
Unknown, stale, foreign или changed route отклоняется без game/presentation
mutation. Browser URL, history, cache и первый элемент каталога не становятся
fallback или authority.

Ineligible B открывается по тем же правилам в `INELIGIBLE_READ_ONLY`: add
отсутствует в available actions, payload, DOM/a11y и client draft. Уже
сохранённый canonical набор при этом не очищается.

### 3. Каждое добавление остаётся отдельной canonical записью

`add A → add B` отправляет полный canonical current+new набор на существующую
selection authority. Каждый card-add сохраняет собственные
request/receipt/nextStageEnvelope в flat append-only `cardAdditionRecords`.
Exact replay возвращает прежний receipt без нового навыка, receipt или перехода
в `CHR-017`; changed payload получает idempotency conflict.

Refresh, reconnect, replay, restart и SQLite reopen восстанавливают обе записи,
текущий canonical набор и host-signed presentation. Повторный open, safe-return
и восстановление не создают новых игровых записей.

### 4. Исторические уровни отделены от оставшейся вместимости

`CHR-014.levelsAndBonuses` по-прежнему описывает варианты следующего выбора на
оставшуюся paid capacity. Он не используется как источник для проверки уже
совершённых `selectedSkills`: исторические пары `{targetBonus,slotCost}`
проверяются против host-signed вариантов на исходную paid capacity.

После добавления A варианты B фильтруются по фактическому остатку слотов.
Стоимость по-прежнему определяется `CORE-165`, вместимость — `CORE-081`, а
требования — `CORE-167`; web использует общую domain-формулу только для
проверки signed projection и не принимает игрового решения.

### 5. Никакого расширения поставки или протокола

`src/shared`, outer protocol, Atlas source-файлы, SQL migrations и игровые
значения не меняются. Не добавляются generic addressable routes, generic
fallback, новая selection authority или отдельная durable revision axis.
Существующая таблица skill presentation хранит только навигационное состояние и
не становится второй selection authority.

## Обоснование и проверки

Без этого узкого уточнения ADR 0050 формально разрешал partial add, но не давал
реального способа продолжить набор через следующую карточку. Разрешение только
для `PARTIAL` восстанавливает связность поставленного journey, не открывая
safe-return там, где выбор ещё не checkpointed или уже финально подтверждён.

Regression-проверки сначала воспроизвели `GUARD_REJECTED`,
`NAVIGATION_UNAVAILABLE` и отсутствие browser safe-return. Итоговые host+WS,
strict decoder, UI и production Playwright проверки покрывают:

- `open A → add A → open B`, включая read-only ineligible B;
- `add A → add B`, две canonical card-add записи и replay/restart recovery;
- запрет safe-return для `NONE` и `EXACT`;
- неизменные identity, bindings, eligibility, revisions и sanitized payload;
- отличие исторических уровней от вариантов на оставшуюся вместимость.

## Отвергнутые альтернативы

| Вариант                                                        | Причина отказа                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Разрешить `CHR-015::CTA::002` для всех selection states        | Открывает возврат без partial checkpoint или после финального exact-fill      |
| Открывать `CHR-014` из любой формы или по browser URL          | Обход host-signed presentation, bindings и revision guards                    |
| Считать первый partial add финальным exact-fill                | Преждевременно подписывает `CHR-017` и теряет продолжение canonical набора    |
| Перезаписывать прежний card-add при добавлении B               | Теряет независимую receipt history и идемпотентный replay                     |
| Проверять исторические уровни по оставшейся paid capacity      | Ошибочно отклоняет уже сохранённый выбор после уменьшения остатка             |
| Новый outer command, SQL migration или generic route fallback  | Существующие navigation/checkpoint/presentation уже покрывают точечный случай |
| Изменить `CHR-013::CTA::003` или финальный `CHR-015::CTA::001` | Это отдельные сохранённые контракты, не причина блокера                       |

## Последствия

- Игрок может последовательно добавить несколько навыков через `CHR-014`, не
  теряя partial selection и не обходя host authority.
- `NONE` и `EXACT` сохраняют прежние ограничения; финальная authority остаётся
  у `CHR-015`, а переход в `CHR-017` не ускоряется.
- Card-add history и presentation восстанавливаются после replay/restart без
  повторной игровой работы.
- Объём изменения ограничен навигацией `CHR-013`–`CHR-015`, строгой проекцией,
  regression-тестами и документацией; готовность последующих форм и всего V1
  этим не объявляется.
