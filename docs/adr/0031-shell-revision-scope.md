# ADR 0031 — Ревизиями оболочки владеет runtime-агрегат хоста

- **Статус:** принято
- **Дата:** 2026-08-18
- **Частично заменяет:** исчерпывающее прочтение первого абзаца раздела
  «Область и инкременты ревизий» [ADR 0018](0018-current-state-storage-and-checkpoints.md):
  к перечисленным там persistent aggregate roots добавляется один
  неперсистентный aggregate оболочки; остальные утверждения раздела не
  заменяются

## Контекст

[PRODUCT-PLAN §1.4](../PRODUCT-PLAN.md#14-живой-группы-пока-нет-будет-позже)
требует заканчивать вертикальные срезы играбельным результатом.
После APP-001 → APP-002 → CHR-001 приложение уже проходит первый сквозной путь,
но штатная точка запуска #93 не может собрать `readRevisions` до привязки
проекции к `local_character` или `campaign`: принятые решения не называют
владельца этой ранней тройки.

### Что выводится из источников и принятых решений

Обе стартовые формы находятся в одном namespace `local-app`:
[`$.forms[0].contexts[0]`, строки 27754–27755](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L27754-L27755)
и
[`$.forms[1].contexts[0]`, строки 28184–28185](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L28184-L28185).
Их обязательные payload при этом различаются:

- APP-001 требует только build/baseline/integrity/boot в
  [`$.forms[0].requiredFields[0..3]`, строки 27773–27778](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L27773-L27778);
- APP-002 требует `contextId`, `stateRevision`, `projectionRevision` и
  `deviceId` в
  [`$.forms[1].requiredFields[0..3]`, строки 28202–28207](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L28202-L28207).

Эту разницу повторяют
[`$.qaScenarios[39..42].qaId/scenario`, строки 227388–227409](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L227388-L227409).
Однако APP-001 не существует совсем вне revision contract: её общий contract
доступности перечисляет всю тройку в
[`$.forms[0].actions.availabilityContract.availabilityInputs[7..9]`, строки 27818–27820](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L27818-L27820).

Есть и прямой контрпример обратной связи. APP-011 находится в `local-app` и
проверяет актуальность state/projection revisions, но не публикует ни
`contextId`, ни revisions в required fields:
[`$.forms[355].contexts[0]/guardStates[0]/requiredFields[0..2]`, строки 204546–204578](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L204546-L204578).

Переходы из APP-001 выбирают player или GM branch, но не создают, не сбрасывают
и не сохраняют revision owner:
[`$.transitions[0..1].from/to/guard`, строки 215447–215459](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L215447-L215459).
Обратные переходы требуют удалить весь прежний role namespace и прямо говорят
`no game data mutation`, но тоже молчат о счётчике:
[`$.transitions[529..530].from/to/guard`, строки 219151–219162](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L219151-L219162).

Atlas допускает GM context и до трёх player seats одновременно в
[`$.globalContracts.authorityPrivacy.hostDevice`, строки 161–165](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L161-L165),
но journey требует ровно один active input context в
[`$.journeys[7].steps[0,3,4].guards`, строки 2717–2769](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L2717-L2769).
Обе модели storage с этим совместимы; cardinality владельца не задана.

Полный список из 19 lifecycle не содержит shell/context revision entity;
`localCharacter`, `campaign` и `deviceAndLocalSeat` уже имеют другие значения:
[`$.entityLifecycles[0..18].entity`, строки 1536–1848](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L1536-L1848).
`atomicityReconnect` требует server-confirmed recovery, но не назначает owner,
scope или lifetime:
[`$.globalContracts.atomicityReconnect.commandIds/randomness/offline`, строки 167–170](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L167-L170).

Generated-представление семантически совпадает с raw Atlas для:

- [`forms-by-id.json["APP-001"].requiredFields[0..3]`, строки 4143–4148](../../generated/spec/atlas/forms-by-id.json#L4143-L4148),
  [`forms-by-id.json["APP-002"].requiredFields[0..3]`, строки 4848–4853](../../generated/spec/atlas/forms-by-id.json#L4848-L4853);
- [`transitions.json[0..1].from/to/guard`, строки 2–15](../../generated/spec/atlas/transitions.json#L2-L15);
- [`global-contracts.json[4].contractId/value`, строки 69–75](../../generated/spec/atlas/global-contracts.json#L69-L75);
- [`lifecycles.json[0..18].entity`, строки 1–313](../../generated/spec/atlas/lifecycles.json#L1-L313).

[ADR 0018](0018-current-state-storage-and-checkpoints.md#область-и-инкременты-ревизий)
назначает persistent тройку `local_character` и `campaign`;
`campaign_checkpoint` только повторяет тройку кампании. Он также задаёт
диапазон, начальное значение, overflow refusal и матрицу инкрементов.
[ADR 0026](0026-form-authority-and-navigation-wire.md) требует валидировать
intent против текущей подтверждённой ревизии и публиковать navigation
атомарно. [ADR 0027 §2](0027-local-shell-context.md#2-contextid) назначает
executor владельцем `contextId` и создаёт новый context после host restart, но
не связывает с ним RevisionVector. [ADR 0028 §3](0028-wire-v2-reconnect.md#3-судьба-пяти-полей-v1-reconnect)
определяет `knownRevisions` как описание последнего confirmed cache, а не
authority или precondition.

### Чего источники не решают

Case-insensitive поиск по raw `artifacts/atlas/*.json` и
`generated/spec/atlas/*.json` проверил camel/snake/kebab и раздельные варианты
`shell/context/process/runtime revision owner/scope/lifetime/reset/map`, а
также русские эквиваленты. Ни один не назначает shell owner, cardinality или
restart semantics.

**Проверка H1:** асимметрия APP-001/APP-002 совместима с context-owned
счётчиком, но не доказывает его; APP-001 уже участвует в revision inputs, а
APP-011 нарушает предполагаемую обратную связь `contextId ↔ revisions`.
Следовательно, H1 как вывод из источника отвергается.

**Проверка H2:** ни Atlas, ни принятые ADR не назначают владельца ранней
shell-тройки. H2 подтверждается. Всё дальнейшее в этом документе — новый
проектный выбор, а не восстановление пропущенного требования источника.

## Решение

### 1. Владелец и scope

**Проектный выбор.** Вводится `host shell runtime aggregate`. Один его
экземпляр создаётся на один успешно запущенный host и живёт от завершения
bootstrap до закрытия этого host instance.

- Host instance владеет aggregate и его единственным RevisionVector.
- Aggregate охватывает все выполняемые host unbound shell presentations:
  role-neutral bootstrap, player-local и GM-local до привязки к exact
  `local_character` или `campaign`.
- Несколько shell contexts одного host разделяют одну тройку.
- Два host instances в одном OS process имеют разные aggregates.
- Scope не является lifecycle entity, persistent root, SQLite row, checkpoint,
  connection, form, `deviceId`, device settings или module-global переменной.

`contextId` идентифицирует presentation/executor context, а shell
RevisionVector — объемлющий runtime aggregate хоста. Смена `contextId` внутри
этого aggregate не создаёт, не копирует и не сбрасывает тройку. Новый
`contextId` после host restart и новый RevisionVector возникают вместе только
потому, что прежний host aggregate завершился; один не владеет другим.

### 2. Начальное значение и матрица инкрементов

Bootstrap host aggregate создаёт
`{ stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 }` до
первой confirmed publication. Создание baseline не считается изменением и не
превращает первое публикуемое значение в `1`. APP-001 внутренне использует этот
baseline, даже если конкретная shape формы не публикует revision keys.

В этом ADR authoritative shell state — закрытая startup-тройка
`baselineCompatibility`, `integrityStatus` и `bootState` из APP-001;
`buildVersion` фиксируется при создании host. Изменение persistent entity
принадлежит её root. Обновление derived library/actions в APP-002 или APP-011
двигает только shell projection. Новый shell-owned state требует отдельного
решения, а неизвестный state-change flag отклоняется.

Каждое значение — safe integer от `0` до `Number.MAX_SAFE_INTEGER`.
Требуемый инкремент на верхней границе отклоняет всё логическое событие до
изменения aggregate или publication snapshot.

В одном живом host shell aggregate действует матрица:

| Результат одного confirmed события                                                                                 | `stateRevision` |                                   `projectionRevision` | `actorVisibilityRevision` |
| ------------------------------------------------------------------------------------------------------------------ | --------------: | -----------------------------------------------------: | ------------------------: |
| Изменилась startup-тройка shell                                                                                    |            `+1` | `+1`, если изменилась сериализованная shell projection |                       `0` |
| Изменилась только presentation, available actions, active context или role-filtered projection                     |             `0` |                                                   `+1` |                       `0` |
| Read или reconnect без изменения state/projection, refusal, validation failure, exact replay либо idempotent/no-op |             `0` |                                                    `0` |                       `0` |
| Rollback до confirmed publication                                                                                  |             `0` |                                                    `0` |                       `0` |

Переходы APP-001 → APP-002/APP-011 и APP-002/APP-011 → APP-001 меняют
presentation/role namespace без game-state mutation и поэтому дают только
`projectionRevision +1`. Новый `contextId` внутри того же aggregate также не
задаёт baseline: если его публикация меняет сериализованную presentation,
применяется projection-only строка матрицы.

До entity owner у shell aggregate нет observer × actor visibility state.
`actorVisibilityRevision` остаётся `0`, а
`actorVisibilityChanged=true` отклоняется вместо молчаливого no-op. Будущая
потребность в shell visibility требует отдельного решения.

### 3. Поведение при host restart

- Transport reconnect и смена shell context сохраняют aggregate и числовую ось
  без reset; изменившаяся publication применяет матрицу §2.
- Graceful close, crash или restart завершают этот runtime aggregate.
- Следующий host instance создаёт новый aggregate с `0/0/0`.
- Старый vector не восстанавливается по `deviceId`, client cache, navigation
  journal, последнему `contextId` или максимальному ранее виденному числу.
- SQLite row и migration для shell revisions не создаются.

Reset обоснован lifetime назначенного владельца, а не только способностью
клиента пережить меньшее число. После завершения host instance прежнего
aggregate больше нет; сохранять его vector без владельца означало бы ввести
новый durable root.

### 4. Переход к entity-owned revisions

Источник revisions меняется только на atomic boundary, где confirmed
presentation привязывается к одному exact `local_character` или `campaign`.
Само выделение ID, наличие строки в БД или показ элемента в библиотеке owner не
меняют.

- `expectedProjectionRevision` intent проверяется против
  `projectionRevision` текущего source owner.
- Если binding удаляет unbound context или меняет serialized library/actions,
  shell aggregate один раз применяет projection-only строку своей матрицы.
- На owner boundary атомарно меняется revision source и публикуется full target
  snapshot.
- `contextId` следует ADR 0026/0027 независимо: обычная навигация к local
  character сохраняет его, а campaign admission или handoff меняет только на
  уже установленных там границах.
- Target snapshot получает фактическую persistent тройку exact root по
  ADR 0018; она не обязана начинаться с нуля.
- `campaign_checkpoint` не становится owner: он повторяет campaign vector.
- Числа source и target не копируются, не складываются, не сравниваются через
  `max` и не продолжают друг друга.
- Сам binding не требует искусственного инкремента target entity vector;
  дальнейшие entity events следуют матрице ADR 0018.

Host shell aggregate продолжает жить для других или будущих unbound contexts.
Возврат в shell берёт текущий, а не нулевой shell vector и применяет
`projectionRevision +1` за новую assignment; сам revision-owner switch не
требует нового `contextId`. Только завершение host сбрасывает aggregate.

### 5. Совместимость с reconnect

`knownRevisions` сохраняет смысл ADR 0028: последняя server-confirmed тройка
client cache, не identity scope, proof of authority или precondition.

- Reconnect к тому же живому shell host возвращает текущую aggregate-wide
  тройку.
- Reconnect после host restart возвращает current vector нового shell
  aggregate, изначально `0/0/0`; другие события нового host уже могли его
  продвинуть.
- Entity-bound recovery возвращает persistent vector exact
  `local_character` или `campaign`.
- Старый client vector может быть численно больше нового; cross-scope порядок
  чисел не определён.
- Host выводит актуального owner из confirmed state и всегда возвращает full
  snapshot; client не выбирает owner своим `knownRevisions`.
- Совпавшее число прежнего scope не авторизует intent: действуют current
  presentation, action contract и source owner.

Full replacement доказывает wire-совместимость reset, но право на reset следует
из owner/lifetime, принятых в §1 и §3.

## Совместимость с принятыми ADR

- **ADR 0018.** Частично заменяется только исчерпывающий перечень owners в
  начале раздела «Область и инкременты ревизий»: добавляется неперсистентный
  host shell aggregate. `local_character`, `campaign`, checkpoint, диапазон,
  initial `0`, overflow refusal и persistent matrix остаются без изменений.
- **ADR 0026.** `expectedProjectionRevision` сверяется с
  `projectionRevision` текущего source owner. Navigation внутри shell
  aggregate двигает projection revision; owner boundary атомарно меняет source
  revisions и full presentation. Journal остаётся отдельно.
- **ADR 0027.** Executor ownership и runtime lifetime `contextId` не меняются.
  Этот ADR прямо отклоняет H1: revision source может смениться без нового
  `contextId`. После restart оба значения новые только из-за конца host.
- **ADR 0028.** Wire shapes, paired capability/snapshot commit и смысл
  `knownRevisions` не меняются. ADR 0031 определяет только фактический источник
  тройки и законный restart reset.

## Обоснование

### Что выводится из источников и принятых решений

Atlas требует revisions и server-confirmed reconnect, но не задаёт cardinality
или связь vector 1:1 с `contextId`. ADR 0018 уже использует aggregate-wide
vector для campaign и её дочерних данных.

### Проектный выбор

Host runtime aggregate сохраняет эту aggregate-wide модель и continuity
APP-001 → APP-002: роль и presentation меняются, owner и числовая ось — нет.
Он даёт restart reset причинное основание без фиктивной SQLite identity.

Coarse vector консервативен: изменение shell projection одного context может
вызвать лишний refusal/full refresh другого, но не примет request по устаревшей
serialized shell projection или available actions. Это цена liveness, а не
нарушение authority или privacy.

Для V1 эта цена ограничена: план требует одно устройство без сети. Перед V2,
где появляются 0–3 player tabs и отдельная GM tab
([PRODUCT-PLAN V2, строки 168–181](../PRODUCT-PLAN.md#v2--стол)), решение следует
пересмотреть только если независимый прогресс contexts или лишние refresh
становятся продуктовым требованием. Источник сам такой независимости не
обещает.

## Отвергнутые альтернативы

| Вариант                                       | Причина отказа                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Считать H1 готовым выводом Atlas              | Co-occurrence полей и `local-app` namespace не задают ownership; APP-011 даёт контрпример                              |
| Отдельный vector на exact projection context  | Допустим, но не source-required; сбрасывает ось при обычной смене context и усложняет V1 без текущего correctness gain |
| SQLite singleton или фиктивный entity root    | Создаёт durable root без source-owned identity, lifecycle и recovery state                                             |
| Module- или process-global vector             | Переживает закрытие host и смешивает несколько host instances одного процесса                                          |
| Vector на connection, form или `deviceId`     | Transport/form lifecycle рвёт continuity; durable locator смешивает contexts                                           |
| Копировать или продолжать predecessor vector  | Делает числа независимых scopes ложно сопоставимыми                                                                    |
| Восстановить owner/vector из `knownRevisions` | Client cache не authority; ADR 0028 требует server-derived full snapshot                                               |
| Обосновать reset только reconnect tolerance   | Объясняет реакцию client, но не назначает owner или lifetime                                                           |

## Последствия

- #93 создаёт один in-memory revision tracker внутри каждого host instance; это
  не module-global singleton и не persistence row.
- Одна shell projection mutation может консервативно инвалидировать другой
  context. Equality guard откажет лишний request, а не примет устаревшие
  presentation/actions.
- Реализация #93 должна покрыть initial `0`, APP-001 → APP-002 projection
  increment, same-host reconnect и restart reset.
- Будущая реализация entity boundary должна отдельно покрыть source validation,
  независимость `contextId`, отсутствие copy/max и возврат к shell vector.
- Если V2 потребует независимый прогресс simultaneous contexts, новый ADR может
  разделить aggregate; это не скрытая настройка API.
