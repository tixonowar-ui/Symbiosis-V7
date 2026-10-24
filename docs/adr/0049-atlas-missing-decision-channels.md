# ADR 0049 — Atlas v1.4: каналы пяти решений персонажа

- **Статус:** принято
- **Дата:** 2026-08-21
- **Дополняет:** маршруты и checkpoint-контракты
  [ADR 0020](0020-wire-protocol-and-shared-contracts.md),
  [ADR 0025](0025-character-draft-checkpoint-scope.md),
  [ADR 0026](0026-form-authority-and-navigation-wire.md),
  [ADR 0042](0042-character-creation-stats-and-rolls.md) и
  [ADR 0046](0046-character-starting-skills.md); версионирование поставки
  [ADR 0037](0037-atlas-v1-3-character-sex-and-mass-bounds.md) и
  [ADR 0039](0039-atlas-markdown-companion-v1-3.md)
- **Узко заменяет:** общее правило form-action из ADR 0026 только для
  `CHR-013::CTA::001` и `CHR-017::CTA::001`

## Контекст и источники

Issue #138 зафиксировал пять мест, в которых Atlas содержал данные решения, но не
давал игроку действия: карточки навыка и симбионта не имели адресуемого
параметра, Советник не имел выбора обязательных навыков, а случайная ветвь не
имела выбора стороны Совы/Угря и вида симбиотического чудовища. Владелец
санкционировал точечную правку JSON и Markdown Atlas и этот ADR. Реализация,
`src/**`, acceptance-документы и другие артефакты в санкцию не входят.

Нормативные основания уже поставлены:

- `CHR-013.selectedSkillIdOrNull` и обязательный `CHR-014.skillId`;
- `CHR-017.selectedSpeciesOrNull`, обязательные `CHR-018.speciesKey` и
  `artAndTreePreview`;
- `Q-CHAR-006`: Советник обязан заполнить `ceil(W/2)` стартовых слотов; проверка
  использует собственные I/W Советника и текущие S/D/M/Z/C тела носителя;
- `Q-CHAR-010`: сторона Совы/Угря выбирается, правые стороны являются
  умолчанием, привязки Клеща, Паука и Богомола фиксированы;
- `CORE-170` и `Q-CHAR-004`: сохранённый крит Единого открывает выбор Химеры,
  Кукловода или Чумного доктора; изменение выбора до финала допустимо.

Wire v2 уже содержит `navigation.addressable-route` с client-selected bindings.
ADR 0026 разрешает такой route только при точном `role-state-reachability`
ребре. ADR 0020 отправляет `local-draft-command` только в client draft, а
`UI-CMD-CHAR-CREATION-ROLL-COMMIT` и `UI-CMD-CHAR-WIZARD-CHECKPOINT` уже
сохраняют адресованный результат либо целый stage атомарно. Следовательно,
новые игровые значения, отдельная команда и новый outer `protocolVersion` не
нужны.

## Решение

### 1. Content release v1.4

Оба legacy-файла `Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.*` становятся content
release **1.4** с `releaseDate=2026-08-21`. `$schema` и `schemaVersion=1.2.0`
не меняются: меняется содержание, а не JSON structure. Имя файла также не
меняется.

Новая версия отличает эту поставку от v1.3: добавляются routes и четыре CTA;
с учётом замен число transition records увеличивается на восемь. Итоговые
значения: 376 forms, **1680 transitions** и **1246 action keys**. `sourceRefs`, provenance origin, `changeControl` и
author-supplied base-v1.2 `graphDigest`/`contentDigest` сохраняются; алгоритмы
semantic digest по-прежнему не поставлены. Byte integrity обеспечивается
пересчитанным `artifacts/CHECKSUMS.sha256`, а не подменой semantic digest SHA
всего файла.

### 2. Адресуемые карточки навыка и симбионта

Exact routes:

```text
/player/characters/:localCharacterId/create/chr-014/:skillId
/player/characters/:localCharacterId/create/chr-018/:speciesKey
```

`localCharacterId` наследуется из подтверждённого context. `skillId` и
`speciesKey` — client-selected opaque bindings, которые host повторно проверяет
против текущего eligible/inspectable domain. Unknown, missing, extra или
недопустимый binding отклоняется; URL, первый элемент и cache не являются
fallback.

Сохранённые CTA `CHR-013::CTA::001` и `CHR-017::CTA::001` сохраняют прежние
labels, `normative` action records и guards. Только их способ исполнения
уточняется: выбор параметризованной карточки использует существующий
addressable-route intent, а не form-action без payload. Это узкое исключение из
общей классификации ADR 0026, а не изменение wire shape или semantics
discriminator.

Для route-open добавляются exact `role-state-reachability` рёбра и их три
структурных зеркала (`transitionsOut`, `transitionsIn`, top-level `transitions`):

```text
CHR-013 → CHR-014
role=player; все entryConditions и guardStates целевой формы выполнены; skillId exists in current eligible or inspectable catalog

CHR-017 → CHR-018
role=player; все entryConditions и guardStates целевой формы выполнены; speciesKey is compatible with race/manual composition
```

Общий trigger остаётся `Адресуемый route либо server/system event текущей роли`
и не становится пользовательской командой. Assigned presentation хранит route
template и bindings, поэтому карточка восстанавливается через существующий
host-confirmed context/`resumeFormId`, а не через authority browser URL.

### 3. Manual и random Советник: CHR-018 → CHR-041 → CHR-019

`CHR-018::CTA::001` сохраняет label «Добавить симбионта в ручной состав» и kind
`workflow-command`, но получает same-form target `CHR-018`. Существующий
`UI-CMD-CHAR-WIZARD-CHECKPOINT` атомарно сохраняет composition и server-signed
next stage. Два последующих exact system events разделяют пути:

- non-Advisor: `CHR-018 → CHR-019`, trigger
  `Dispatch persisted manual non-Advisor composition`; composition и
  species/binding provenance сохраняются, Advisor I/W requests не создаются;
- Advisor: `CHR-018 → CHR-041`, trigger
  `Dispatch persisted manual Advisor branch`; сохраняются Advisor draft и два
  addressed pending `iwRollRequestIds[2]`, но ни face, ни receipt, ни sampler
  ещё не существует.

`UI-CMD-CHAR-CREATION-ROLL-COMMIT` не выполняется на `CHR-018` и не добавляется
в его form list. Поэтому manual composition не смешивает checkpoint с броском:
два request IDs создаются в whole-stage snapshot, а сами броски выполняются
следующей командой на `CHR-041`. Random `CHR-020` по-прежнему передаёт уже
созданные два I/W results на `CHR-041`.

`CHR-041` привязан одновременно к `ROLL-COMMIT` и `WIZARD-CHECKPOINT` во всех
references, availability sources, workflow availability, обоих coverage action
steps и workflow QA. `ROLL-COMMIT.formIds` и QA scenario получают `CHR-041`
между `CHR-020` и `CHR-021`. `WIZARD-CHECKPOINT.formIds` сохраняет `CHR-041`
между `CHR-018` и `CHR-019`.

Pending manual projection получает `IW_ROLLS_REQUIRED` и честные application
fields: `iwRollRequestIds[2]`, `iwRollReceiptIds[2]OrNull`,
`advisorIPlus8OrNull`, `advisorWPlus8OrNull` и `commandId`. До коммита receipts
и I/W равны `null`; обязательные слоты нельзя подтвердить. Random projection
имеет непустые request/receipt IDs и I/W. Required fields и QA mirror совпадают
дословно.

Новый `CHR-041::CTA::003` имеет exact label **«Зафиксировать броски I и W
Советника»**, same-form target и kind `workflow-command`:

```text
UI-CMD-CHAR-CREATION-ROLL-COMMIT exactly two addressed pending Advisor I/W requests in I,W order; no existing I/W receipts; no critical chain, creation penalty or XP
```

Один такой `ROLL-COMMIT` фиксирует один stage result из двух упорядоченных
бросков I→W с двумя immutable roll receipts и одним command receipt. AUTO
вызывает sampler ровно дважды после guards; MANUAL принимает ровно два D20 без
sampler. `Q-CHAR-006` запрещает critical chain, creation penalty и XP — новые
правила здесь не вводятся. Exact replay возвращает тот же receipt; changed
payload получает idempotency conflict, replacement request не создаётся.

После receipts доступен `CHR-041::CTA::002` с guard
`iwRollReceiptIds present; selection remains within Advisor-eligible skills and
mutable Advisor slot draft`. Add/remove остаётся client-local и не создаёт wire,
receipt, durable stage или revision. `CHR-041::CTA::001` подтверждает обязательный
набор через `WIZARD-CHECKPOINT` и ведёт в `CHR-019` с прежними exact label и
guard. Старый label заменён во всех 9 JSON и 8 Markdown occurrences.

Так capability-правило владельца получает реальное ребро, а не только фильтр:
меню публикуется и при ручном, и при случайном Советнике, причём non-Advisor
путь `CHR-018 → CHR-019` сохраняется без захода на `CHR-041`.

### 4. Pre-COMMITTED BINDING и сторона Совы/Угря

`CHR-020::CTA::003` сохраняет exact label «Выбрать допустимую сторону Совы или
Угря» и получает guard:

```text
randomStatus=NOT_STARTED|PENDING|BINDING and bindingKind=OWL_EYE|EEL_ARM and selected side eligible
```

Правый глаз/правая рука остаются исходным умолчанием Q-CHAR-010, но local
selector позволяет изменить сторону на этом экране. Клещ, Паук и Богомол не
получают selector и сохраняют фиксированные привязки.

`randomStatus` теперь различает `NOT_STARTED|PENDING|BINDING|COMMITTED`. После
всех требуемых бросков форма входит в `BINDING`: отображённые faces/results уже
immutable, но exact side snapshot ещё не зафиксирован. Для FREE эта фаза
наступает после первого committed display, поэтому отсутствие later roll не
мешает выбору. `COMMITTED` наступает только после binding-only коммита; оба
system dispatch требуют `randomStatus=COMMITTED and binding snapshot committed`.

Тот же `CHR-020::CTA::002` в фазе `BINDING` использует **fresh commandId** и
binding-only variant существующего `ROLL-COMMIT`. Request ссылается на
`randomSequenceId` и сохранённые roll/result receipts и содержит exact side
snapshot. Он не содержит `pendingRollRequestId` и не создаёт новый request,
face, sampler или random receipt. Клещ/Паук/Богомол включаются host-derived
fixed bindings; Owl/Eel используют выбранную или default правую сторону.

Binding-only коммит сохраняет snapshot, один command receipt и next-state
`COMMITTED` атомарно. Exact replay с тем же commandId/payload возвращает тот же
receipt; changed payload получает idempotency conflict и не вызывает sampler.
Refresh/reconnect до коммита восстанавливает последний durable roll и теряет
неподтверждённый local side draft, после коммита — тот же binding result.
Повторный roll, replacement request и изменение immutable результата запрещены.

Generic `ROLL-COMMIT.guards/atomicity` и обе QA expected строки различают roll
variants, Advisor I/W и binding-only. Это stage-specific application variants
существующего command, а не новый command ID или outer `protocolVersion`.

### 5. Вид симбиотического чудовища на CHR-020

Добавляется same-form `local-draft-command`:

```text
actionKey: CHR-020::CTA::004
label: Выбрать вид симбиотического чудовища
guard: saved UNITED critical unlocks symbiotic monster choice; selection remains within eligible monster species and mutable draft
```

Выбор доступен только после того, как сохранённый крит Единого открыл его, и
включается snapshot в `ROLL-COMMIT` **именно подтверждения этого крита**. Host
проверяет unlock и принадлежность выбора к поставленному набору из трёх видов;
client не объявляет новый random result. Первый обычный бросок не получает
преждевременный monster payload. Выбор фиксируется до перехода в `BINDING`;
финальный binding-only commit не заменяет его и не создаёт новый крит.

Изменение уже подтверждённого вида до финала остаётся отдельным контрактом
`CHR-025` и в эту поставку не входит.

### 6. Вердикты гипотез

- **H1 опровергнута.** Nullable ID и подробный вид над каталогом потребовали бы
  либо менять смысл карточки, либо заранее доставлять арт и дерево всех видов.
  Адресуемый route загружает тяжёлое содержимое только выбранной карточки.
- **H2 подтверждена с manual transport уточнением.** `CHR-041` сохраняет
  local add/remove и whole-stage checkpoint, но manual Advisor сначала получает
  два pending request на `CHR-018` и затем фиксирует I/W через `ROLL-COMMIT`.
  Non-Advisor минует `CHR-041`.
- **H3 подтверждена с отдельным pre-COMMITTED binding variant, а не дословно.**
  Local-draft недостаточен для передачи стороны в уже committed display, поэтому
  существующий `ROLL-COMMIT` получает binding-only variant после display. Он
  использует fresh commandId и сохранённый результат без нового броска, а не
  повторяет roll или создаёт отдельную команду.

Конкретные future application JSON keys остаются project-owned serialization
реализации; Atlas задаёт каналы, guards и snapshot boundaries, не новый gameplay
catalog.

### 7. Зеркала и fail-closed guards

Для каждого CTA синхронизированы exact `visible`, полный `allowed` array,
`ctaAvailabilityByAction`, source/target transition mirrors, top-level
`transitions`, Markdown, `REQ-002` и `REQ-063` action steps, применимые form и
workflow QA. `CHR-020::CTA::002` различает roll и binding-only, а
`CHR-041::CTA::003` требует два pending I/W requests. `BINDING` и
`IW_ROLLS_REQUIRED` присутствуют в form states и всех четырёх terminal-state
зеркалах.

`CHR-020.references.qnaIds` включает `Q-CHAR-004`, `Q-CHAR-010` и
`Q-CORE-054`. `CHR-020` также добавлен в `AQA-004` и соответствующие formIds и
QA scenario/MD records. `Q-CHAR-010.laterAuthorOverride` сохраняет исходный
answer именно для `CHR-020`, не меняя его текста.

`tools/import` получает именованный ADR 0049 guard для routes, actions,
transitions, bindings, coverage, workflow и Q&A. Полный `allowed` и полный QA
scenario сравниваются дословно, поэтому retired label не может быть добавлен
даже рядом с текущим. Guard падает при отсутствии, дубликате или drift, а тесты
удаляют либо изменяют каждое зеркало и каждую Q&A-ссылку независимо.

`tools/validate` дополнительно проверяет конечный список exact Markdown
литералов и их cardinality. Общий Markdown parser не вводится; importer по-
прежнему не читает Markdown и `generated/**` создаётся только прогоном import.

## Отвергнутые альтернативы

| Вариант                                         | Причина отказа                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Navigation payload с `skillId`/`speciesKey`     | Меняет exact form-action envelope и потребовал бы новый `protocolVersion`; существующий addressable-route уже несёт bindings |
| Nullable ID и card-over-catalog                 | Меняет обязательный field contract и вынуждает доставлять тяжёлый art/tree всех видов                                        |
| Отдельные команды для local selectors           | Противоречит ADR 0020: local-draft не идёт в wire; durable mutation нужна только на последующем commit                       |
| Durable write на каждый add/remove или selector | Создаёт receipts/revisions без необходимости и ломает существующую local-draft семантику                                     |
| Monster snapshot в первом броске                | Крит ещё не открыл выбор; snapshot относится к подтверждению крита                                                           |
| Side snapshot в roll до display или later roll  | До display вид неизвестен, а у FREE later roll отсутствует; нужен binding-only commit после display                          |
| Прямой `CHR-018 → CHR-019` для manual Advisor   | Минует обязательные I/W и навыки Советника; нужен exact dispatch на `CHR-041`                                                |
| I/W броски внутри `WIZARD-CHECKPOINT`           | `ROLL-COMMIT` владеет roll results; checkpoint создаёт только addressed pending requests                                     |
| Изменение чудовища до финала в этом срезе       | Это отдельный `CHR-025` contract, явно исключённый владельцем                                                                |
| Оставить content version 1.3                    | Скрывает новый класс поставки с routes, CTA и изменённым transition count                                                    |
| Пересчитать semantic digests                    | Алгоритм не поставлен; file SHA не доказан как тот же digest                                                                 |
| Generic Markdown parser                         | Atlas не поставляет grammar; конечный exact registry проверяем без ложной полноты                                            |

## Последствия

- Поставлены только каналы и их спецификация; runtime формы этим ADR не
  объявляются реализованными.
- Следующие implementation-задачи получают addressable card routes и существующие
  command boundaries без нового outer protocol.
- Import и validation останавливаются при потере или расхождении новых записей.
- `generated/**` изменяется только прогоном import; контрольные суммы
  пересчитываются до него, затем выполняется полный verify.
