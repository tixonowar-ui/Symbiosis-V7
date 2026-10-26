# ADR 0050 — Адресуемая карточка навыка CHR-014

- **Статус:** принято
- **Дата:** 2026-10-26
- **Дополняет:** [ADR 0025](0025-character-draft-checkpoint-scope.md),
  [ADR 0026](0026-form-authority-and-navigation-wire.md),
  [ADR 0044](0044-character-stat-assignment-and-pure-class.md),
  [ADR 0046](0046-character-starting-skills.md) и
  [ADR 0049](0049-atlas-missing-decision-channels.md)
- **Узко заменяет:** предположение ADR 0046 об отсутствии новой SQL-миграции
  только для host-signed presentation `CHR-013`–`CHR-015`; игровой selection
  checkpoint и его opaque whole-checkpoint JSON не меняются

## Контекст и источники

Issue #144 закрывает отложенную ADR 0046 карточку навыка. Каталог `CHR-013`
показывал требования и уровни, но игрок не мог открыть отдельную `CHR-014`,
проверить их и явно выбрать уровень перед добавлением. `CHR-013::CTA::001` уже
получил exact addressable channel в ADR 0049; вопрос был в application
representation, partial selection и восстановлении, а не в новой игровой
механике.

Нормативные основания:

- Atlas `CHR-013`, `CHR-014`, `CHR-015`, journeys `SKILLS`, `REQ-002`,
  `QA-FORM-CHR-014` и `QA-CHANGE-CHR-014`;
- `skills.json`, `skill-requirements.json`, `stats.json` и существующие формулы
  `CORE-081`, `CORE-165`, `CORE-167`;
- ADR 0046 §2–4 и §8–10: единственная selection authority, sanitized catalog,
  signed levels, `selectionRevision=draftRevision` и safe-return;
- ADR 0049 §2: exact addressable route и host-signed bindings;
- ADR 0025: атомарный checkpoint и восстановление без повторной игровой работы;
- ADR 0044 §8: сохранённые исключения `CHR-013::CTA::003` и
  `CHR-015::CTA::002`.

`validateDraftCheckpointAdvance` требует `stateRevision +1` при изменении opaque
snapshot. Route-open и safe-return обязаны быть projection-only и не менять
`draftRevision`, поэтому presentation нельзя добавить в game payload как будто
это игровое состояние.

## Решение

### 1. Exact route и граница клиентского выбора

Единственный разрешённый addressable route:

```text
/player/characters/:localCharacterId/create/chr-014/:skillId
```

`localCharacterId` наследуется из подтверждённого player context. Клиент
отправляет ровно один `client-selected` binding с `parameterIndex=1`; host
повторно проверяет его против inspectable catalog. Assigned presentation хранит
оба bindings в порядке индексов. Unknown, missing, extra, duplicate, foreign или
stale binding отклоняется без presentation/game mutation.

`CHR-013::CTA::001` исполняется только этим route. Он не обобщается на другие
формы. `CHR-013::CTA::003` и `CHR-015::CTA::002` остаются исключены.

### 2. Санитизированная карточка и negative space

Player projection содержит все девять Atlas requiredFields:

```text
characterDraftId, skillId, requirements, skillStageValues,
levelsAndBonuses, slotCost, freeSources, eligibility, selectionRevision
```

Допускаются только project-owned `skillLabel`, `wizardCheckpointId`,
`bonusDomainScope`, `missingSkillPenalty`, `eligibleSkillIds`, `selectedSkills`
и `slotSources`. Raw registry rows, `SkillID`, Requirement/Rule/source IDs,
`BeforeSymbiontBonuses` и availability trace не публикуются.

`levelsAndBonuses` состоит из host-signed пар `{targetBonus,slotCost}` на
оставшуюся paid capacity. `slotCost=null` до явного локального выбора уровня;
стоимость берётся из выбранной signed pair и не передаётся клиентом в checkpoint.
`freeSources` имеет exact положительное отсутствие `{kind:"NO_FREE_SOURCE"}` и
не присваивает бесплатность обычному навыку.

Для невыполненных требований проекция показывает безопасные requirement rows и
`INELIGIBLE_READ_ONLY`; add отсутствует из available actions, payload, DOM/a11y
и клиентского draft. Eligible add появляется только после явного выбора signed
level.

### 3. Partial add не является финальным exact-fill

`CHR-014::CTA::001` использует существующий
`UI-CMD-CHAR-WIZARD-CHECKPOINT` и отправляет полный canonical current+new набор
с `sourceFormId="CHR-014"`. Host повторно проверяет route identity, eligibility,
ровно одно добавление, signed level, доступные слоты и текущую revision.

Domain получает `validateSkillSelectionDraft` для underfilled/exact partial
наборов; существующий `validateSkillSelection` сохраняет прежнее exact-fill
требование только для финального `CHR-015`. Стоимость по-прежнему вычисляется
через `CORE-165`, capacity через `CORE-081`, requirements через `CORE-167`.

Card add всегда подписывает `nextFormId="CHR-015"`, даже если слоты заполнены
ровно. Он не подписывает `CHR-017`. Application `selectionCheckpoint` различает:

- `NONE` — durable selection ещё нет;
- `PARTIAL` — есть card-add checkpoint, набор можно продолжить на `CHR-015`;
- `EXACT` — финальный `CHR-015` checkpoint, projection остаётся actionless.

Наличие `commandId` больше не служит признаком финальности: оно есть и у partial
receipt. Финальный переход в `CHR-017` выполняет только `CHR-015`.

### 4. Receipt history и revision

`selectionRevision` — form-local alias текущей `draftRevision`, а не новая ось.
Route-open и safe-return изменяют только существующую `projectionRevision`;
selection, draft/state/checkpoint/actor-visibility revisions не меняются.

`skillSelectionStage.cardAdditionRecords` — flat append-only история card-add
request/receipt/nextStageEnvelope. Финальный `CHR-015` сохраняет её, а raw/typed
command и collision indexes включают все записи. Exact replay возвращает прежний
receipt без нового навыка, receipt или destination `CHR-017`; changed payload
получает idempotency conflict.

### 5. Host-signed presentation recovery

Forward-only миграция `0004-skill-presentation` создаёт
`local_character_skill_presentation` с FK на `local_character` и opaque
`presentation_json`. Отдельная таблица хранит только:

```text
{formId,projectionRevision,routeBindings,routeTemplate,selectionRevision}
```

`formId` ограничен `CHR-013|CHR-014|CHR-015`; для `CHR-014` обязательны exact
route и два bindings. Чтение и запись строго валидируются, запись происходит в
той же SQLite-транзакции, что связанная projection/game операция. Таблица не
становится второй selection authority и не меняет opaque game snapshot.

Reconnect/restart восстанавливает ту же карточку и `skillId` либо подписанную
`CHR-015` из этой записи и durable checkpoint. Browser URL, первый элемент
каталога, cache и history не являются authority или fallback.

### 6. Web contract

Web decoder принимает только exact форму, route, bindings и allowlisted payload.
`pendingAddressableRoute` имеет отдельные checked snapshot/refusal/reconnect
переходы. URL строится substitution всех bindings по `parameterIndex` и
`replaceState` происходит только после confirmed snapshot.

`skillCardDraft` хранит только явно выбранный `targetBonus`. Add использует
существующий checkpoint request и полный canonical набор; `slotCost` клиент не
назначает. `CHR-015` разрешает local edits для `NONE|PARTIAL` и запрещает их для
`EXACT`.

## Обоснование

Решение использует уже поставленные channel, command и domain authority, не
создавая второго способа выбрать навык. Отдельная presentation table необходима
именно потому, что навигация не является game mutation: попытка спрятать её в
opaque checkpoint либо нарушила бы revision invariant, либо потребовала бы
фиктивного `stateRevision +1`.

Проверки покрывают contract/privacy, invalid bindings и zero-write refusals,
eligible/ineligible cards, explicit signed level, partial add, safe-return,
replay, reconnect и host+SQLite restart. Production Playwright проходит через
собранный `dist/web`, Fastify+WS и изолированную SQLite без mocked projection.

## Отвергнутые альтернативы

| Вариант                                                              | Причина отказа                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| URL, первый навык, cache или browser history как fallback            | Подменяют явный client-selected binding и host authority                  |
| Implicit `targetBonus` или клиентский `slotCost`                     | Нарушает explicit choice и отдаёт клиенту формулу `CORE-165`              |
| Маскировка card add под финальный exact-fill                         | Публикует `CHR-017` преждевременно и ломает partial recovery              |
| Стирание card-add history после `CHR-015`                            | Теряет durable idempotency и делает replay новой работой                  |
| Presentation в `localCharacter.payloadJson` без миграции             | Требует фиктивного game `stateRevision +1` для projection-only navigation |
| Новый outer `protocolVersion` или payload у `navigation.form-action` | Существующие addressable-route и checkpoint уже покрывают контракт        |
| Generic addressable routes для других форм                           | Выходит за точечную scope `CHR-014`                                       |
| Публикация `CHR-013::CTA::003` или `CHR-015::CTA::002`               | Противоречит сохранённым исключениям ADR 0044/0046                        |

## Последствия

- `CHR-014` становится addressable экраном просмотра и явного добавления;
  `CHR-015` продолжает partial selection и одна финальная authority остаётся у
  неё.
- Существующие базы применяют `0004` вперёд; прежние миграции и game payload не
  переписываются. Цена решения — одна отдельная таблица для navigation recovery.
- Player payload остаётся sanitized, а shared wire и артефакты не меняются.
- Следующие ручные формы, другие addressable routes, импорт поставленных
  symbiont-media и готовность всего V1 этим решением не объявляются.
