# ADR 0026 — Назначение формы и навигация на проводе

- **Статус:** Принято
- **Дата:** 2026-08-16

## Контекст

Wire v1 различает шесть командных `kind`, но не выражает открытие формы.
В Atlas v1.2 есть 1 672 перехода семнадцати видов. ADR 0020 маршрутизирует
245 переходов шести командных видов; ещё 1 427 переходов одиннадцати видов
остались без транспортного решения.

Из-за этого `projection.reconnect` может запросить свежую role projection, но
не форму и не параметры маршрута. Текущий хост публикует только `APP-001`.
Вертикаль персонажа требует обычного пути к `CHR-001`, безопасного возврата и
восстановления подписанного destination, не смешивая их с командой сохранения.

Ниже `$` означает корень
`artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json`.

### Что следует из источников

- `$.globalContracts.platform.sharedState` сырого Atlas называет host
  авторитетом campaign, battle, clock, seats и shared runtime state, а browser
  clients — проекциями. Current form в этом перечне не названа.
- `$.globalContracts.platform.transport` разделяет HTTP для
  shell/assets/snapshots и WebSocket для revisions, prompts, handoffs и
  reconnect-aware events, но не описывает обычный CTA-переход.
- `$.globalContracts.availableActions.outputChannels` включает
  `selectableActions`, `eligibleTargetsByAction` и `parameterDomains`.
  `$.globalContracts.availableActions.negativeSpace` запрещает присутствие
  недоступных actions, targets и parameter values в network projection и
  client cache.
- `$.coverageRequirements[0].preconditions[2]` требует, чтобы player
  projection содержала только CTA с истинным per-action guard.
- `$.coverageRequirements[0..90].expectedStateDeltas.mutationBoundary` называет
  все некомандные routes
  navigation/read-only.
- `$.forms[0..375].actions.availabilityContract.visibleSemantics` называет
  `ctaAvailabilityByAction` исчерпывающим runtime словарём route/command
  actions.
- Обычный переход `APP-002 → APP-004` описан одновременно в
  `$.transitions[531]` и
  `$.forms[1].actions.ctaAvailabilityByAction[1]`. Последняя запись содержит
  уникальный `actionKey`, `targetFormId`, `kind`, guard и
  `authoritativeSource.service=SERVER_ROUTE_AND_GUARD_EVALUATOR`.
- `generated/spec/qna/questions.json[293,295]` запрещает автоматический выбор
  при disconnect и описывает checkpoint/failover, но не current form. Записи
  `[342..343]` относятся к мирным способностям, а не навигации.

### Что источники не решают

В raw JSON, raw Markdown и `generated/spec/atlas/**` нет `currentFormId`,
`activeFormId`, `selectedFormId`, `assignedFormId`, их вариантов с `_`, `-` и
пробелами и русских вариантов «текущая/выбранная/назначенная форма». Результат
получен отдельными case-insensitive поисками по обоим представлениям.

`$.forms[0..375].route` задаёт 376 routes, но не объект route parameters, их
binding или allocator. Например, `$.forms[59].route` требует
`:localCharacterId`, а три
действия `$.forms[3].actions.ctaAvailabilityByAction[0,4,5]` задают только
`targetFormId=CHR-001` и разные guards.

Следовательно, утверждения «обычный CTA немедленно меняет URL на клиенте» и
«host всегда назначает единственную текущую форму» не выводятся из поставки.

## Решение

### Что следует из источников

Host фильтрует server-backed actions и guards; user выбирает CTA. Explicit
device-local actions и signed recovery имеют отдельные точные контракты.

### Проектный выбор

Мы вводим различие между выбором действия и назначением presentation.
Пользователь выбирает доступное действие. Авторитетный для данного namespace
исполнитель перепроверяет его и назначает подтверждённую presentation.
Client не трактует label, URL или `targetFormId` как подтверждение перехода.
Для bootstrap, player-local и shared/role projection исполнитель — host. Для
явно device-local settings исполнитель — local shell; они не идут на host wire.
Это уже не исходная сильная гипотеза «client ничего не выбирает».

## Термины и границы

### Что следует из источников

Atlas различает 244 `screen`, 45 `dialog`, 30 `overlay`, 25 `banner`,
20 `component` и 12 `specification` в `$.counts.byType`.
Из 1 427 целей рассматриваемых переходов только 988 имеют тип `screen`.
`$.transitions[554]` ведёт из `SET-001` в `SET-004`, для которого
`$.forms[13].route="@overlay/set-004"`. Состояние
`$.forms[13].states.QUICK_AUDIO_OPEN` сохраняет вызывающую сцену активной.
`$.transitions[1614]` закрывает `PLY-023`, оставляя `underlayFormId`, resolver и
turn mounted и неизменными.

### Проектный выбор

**Presentation assignment** — не scalar `currentFormId`, а подтверждённая
композиция:

1. одна base/underlay form с разрешёнными route bindings;
2. упорядоченные dialog/overlay/banner/component/specification layers;
3. источник/correlation назначения и role-filtered payload с actions.

Form ID верхнего интерактивного layer определяет источник form action. Снятие
layer не обязано менять base form. `specification` и render-only component не
становятся отдельным browser route только из-за наличия transition edge.

Host projection и device-local namespace раздельны. Full host snapshot заменяет
только host projection; local preferences не становятся campaign state.

## Владелец назначения

### Что следует из источников

`$.forms[0].inputOwner` называет role-neutral local shell до появления seat или
master authority. `$.journeys[0].steps[1].guards` говорит, что выбор «Игрок» не
повышает authority. `$.forms[1].purpose` называет `APP-002` локальной
библиотекой, а `$.forms[3].entryConditions[1]` и
`$.forms[3].guardStates[2]` допускают player shell без campaign authority.
`$.transitions[535,546,553,554]` имеют guard `always local`, а
`$.transitions[375,377,379,380]` — settings local to this computer.
`$.journeys[20].errorOfflineReconnect[0]` защищает local volume от host.

### Проектный выбор

- Host-процесс назначает все не-device-local presentation в трёх раздельных
  context: role-neutral bootstrap (`APP-001`), player-local без campaign
  authority (`APP-002`, `APP-004`, локальные `CHR-`) и admitted campaign role.
- Выбор «Игрок» заменяет bootstrap на player-local context, не выдавая campaign
  authority. Local здесь означает область данных, а не client execution.
- Form intents во всех трёх context пересекают client ↔ host wire v2. Только
  буквальные `always local` и device-local settings исполняет local shell.
- Browser URL/history отражает уже подтверждённую presentation. Оно не является
  authority и не восстанавливает destination самостоятельно.

## Идентичность действия и намерение клиента

### Что следует из источников

`$.forms[3].actions.ctaAvailabilityByAction[0,4,5]` содержит три разных
`actionKey` с одинаковым label открытия `CHR-001`; label не идентифицирует
действие.
Все 79 `journey` используют `J-*` trigger, отличный от CTA label. Например,
`$.transitions[15]` и `$.forms[16].actions.ctaAvailabilityByAction[1]`
описывают один source/target context разными строками.
Нет общего однозначного join по label, trigger или `{from,to,kind,guard}`;
transition tuple ADR 0020 нельзя переносить на навигацию по аналогии.

### Проектный выбор

Client form intent адресует действие tuple `{navigationRequestId, sourceFormId,
actionKey, expectedProjectionRevision}` и не несёт authority-bearing target,
route, trigger или journey ID. Host находит action только в подтверждённом
bootstrap, player-local либо admitted context, повторно проверяет role, owner,
guards и revisions, а затем сам выводит target и presentation из action record.

Host ищет `navigationRequestId` в journal до проверки current source/context.
Exact replay возвращает прежний terminal result с bindings через смену context
и transport reconnect; другой payload даёт conflict. Host restart journal
завершает.

Command kinds из ADR 0020 не проходят через form intent. Их существующие
`command.request`, `read.request` и client-local маршруты остаются неизменными.

## Параметры маршрута

### Что следует из источников

Route templates находятся в `$.forms[0..375].route`. Пер-action схемы binding в
Atlas нет. `$.globalContracts.availableActions.outputChannels` разрешает
host проецировать `eligibleTargetsByAction` и `parameterDomains`.

Recovery отличается от обычного route: `$.transitions[684..689]` требуют
`returnFormId(server-signed)`, а `$.transitions[1262]` безопасно возвращает
`CHR-001 → APP-004` и требует новый UUID для следующего draft. Контракт
`$.registryCoverage.workflowCommands[85].atomicity` требует точный signed
`resumeFormId` и запрещает client route выбирать destination.

### Проектный выбор

Route bindings входят в assignment, а не считаются доверенным URL. Для каждого
параметра допустим ровно один источник:

- **inherited** — значение уже есть в подтверждённом session/context;
- **executor-allocated** — action contract явно создаёт новую identity;
- **client-selected** — opaque value выбрано только из спроецированного
  `eligibleTargetsByAction` или `parameterDomains`.

Client-selected value повторно проверяется host. Unknown, missing, extra или не
входящий в domain binding отклоняется без fallback к URL, первому либо cache.

Для `$.transitions[2]` host-исполнитель один раз на `navigationRequestId`
вызывает shared/domain UUID contract ADR 0018 и назначает `localCharacterId`,
ещё не создавая строку. Exact retry возвращает тот же binding. Первый commit
пишет его как `local_character_id`/`checkpointOwnerId`, но отдельный
`checkpoint_id` равен payload-полю `wizardCheckpointId` по ADR 0025 §2.

До commit allocation недолговечна: restart возвращает `APP-004`, ввод может
сохраниться лишь как draft без identity, прежний UUID заброшен. После commit
signed recovery восстанавливает IDs из checkpoint.

Signed `resumeFormId`, `returnFormId` и `originFormId` никогда не переводятся в
client-selected binding. Client может только подтвердить спроецированное
действие; destination берётся из подписанного context.

## Addressable route

### Что следует из источников

`$.transitions[1588..1602]` вида `role-state-reachability` имеют общий trigger
«Адресуемый route либо server/system event текущей роли», role guard и полный
набор entry/guard conditions, но не имеют CTA/actionKey.
`$.transitions[1427]` отдельно открывает addressable form/system state как
`system-event`.

### Проектный выбор

Direct URL не подделывает CTA. Wire v2 route-open intent несёт стабильный
`navigationRequestId`, route template identity, недоверенные bindings и
ожидаемую projection revision.

Host принимает route только при точном `role-state-reachability` edge и после
всех target entry conditions. Успех публикует full snapshot; отказ сохраняет
presentation. URL меняется только после успеха.

`role-state-reachability` остаётся reachability contract, а не action catalog.
Его generic trigger не пересылается как пользовательская команда.

## Классификация одиннадцати видов

### Что следует из источников

| `kind`                    | Edges | CTA rows | Точный edge-level факт                                               |
| ------------------------- | ----: | -------: | -------------------------------------------------------------------- |
| `system-event`            |   392 |        0 | server/recovery/render lifecycle смешаны; CTA нет                    |
| `normative`               |   316 |      316 | exhaustive CTA actions, включая четыре `always local`                |
| `subflow`                 |   216 |      203 | CTA и journey/reconnect/local edges смешаны                          |
| `subflow-return`          |   205 |      193 | все source/target edges имеют action context                         |
| `safe-return`             |   198 |      198 | обычные и signed return context смешаны                              |
| `journey`                 |    79 |       79 | каждый edge имеет runtime action, trigger всегда `J-*`               |
| `role-state-reachability` |    15 |        0 | addressable route либо server/system event                           |
| `role-branch`             |     2 |        2 | user нажимает `Игрок` либо `Мастер`                                  |
| `form-selection`          |     2 |        2 | same-form selection; один guard говорит `no target/command reserved` |
| `form-preview`            |     1 |        1 | same-form preview                                                    |
| `overlay-dismiss`         |     1 |        1 | underlay остаётся mounted и unchanged                                |

`system-event` неоднороден: `$.transitions[609,707]` — recovery dispatch,
`$.transitions[866]` — automatic publication, а
`$.transitions[643,1436,1586,1587]` — same-form/no-route lifecycle.

### Проектный выбор

- CTA-backed `normative`, `subflow`, `subflow-return`, `safe-return`, `journey`
  и `role-branch` являются form intents и пересекают host wire, кроме exact
  device-local actions.
- `journey` action исполняется в runtime, но `$.journeys[0..65]` остаётся
  coverage/provenance metadata и на wire не сериализуется.
- `system-event` является runtime lifecycle, но не client form intent. Host-owned
  event публикует snapshot только при изменении projection/presentation;
  render-only lifecycle остаётся local. `no route` сохраняет base, не каждый
  layer.
- `role-state-reachability` не является самостоятельным event. Оно разрешает
  отдельный validated route-open либо exact system event.
- `form-selection`, `form-preview` и `overlay-dismiss` не меняют base form.
  Для host projection они отправляют same-form intent и получают snapshot;
  для exact device-local namespace остаются local presentation actions.

Ни один route не выбирается только по `kind`. Всегда требуется exact action,
route edge или system-event context.

## Wire version и атомарная публикация

### Что следует из источников

ADR 0020 фиксирует v1 как exact object с закрытым `messageType`. Изменение
обязательных полей либо семантики discriminator требует нового
`protocolVersion`; unknown fields не являются forward compatibility.

`projection.snapshot` v1 атомарно заменяет host projection cache, но семантически
является ответом reconnect. `projection.reconnect`, `read.request` и
`command.request` не могут выразить form intent или route-open без изменения
их принятого смысла.

### Проектный выбор

Wire v1 остаётся замороженным. Навигация вводится только в wire v2:

- exact client → host form-action и addressable-route intents с единым
  стабильным `navigationRequestId`;
- typed refusal для каждого intent;
- full `projection.snapshot` v2 как единственный успешный результат;
- host-originated snapshot после host-owned system event, command destination или
  reconnect с явной причиной/correlation.

Assigned presentation лежит внутри role-filtered snapshot; presentation и
payload публикуются атомарно. Точную TypeScript shape и codec фиксирует
отдельная implementation-задача.
V1 peer не получает v2 action и не пытается угадать navigation. V2 peer не
понижает request до v1 `read.request`, `command.request` или reconnect. Version
mismatch и unknown action fail closed.

## Reconnect, recovery и command destination

### Что следует из источников

ADR 0020 требует свежий полный snapshot и повторную фильтрацию CTA/targets.
ADR 0025 §6 сохраняет host/domain-owned signed `resumeFormId` для recovery.
`$.transitions[707,838]` прямо запрещают client history/URL/cache выбирать
destination. `$.registryCoverage.workflowCommands[85].reconnect` требует при
missing/corrupt checkpoint diagnostic и role-safe local return.

### Проектный выбор

Reconnect не отправляет client current form как authority и всегда получает
full safe snapshot. Host выводит presentation из текущего подтверждённого
context, pending context, committed receipt либо checkpoint. Missing/corrupt
recovery публикует diagnostic и role-safe local presentation; browser history
не становится fallback. Typed refusal относится к отдельному navigation intent.
Команда и form intent остаются разными событиями. Команда сначала достигает
terminal result/replay. Если receipt содержит подписанный next/return/resume
context, host затем атомарно публикует соответствующую presentation. Client не
переходит по target из собственного payload.

## Отказы и инварианты

### Что следует из источников

`$.globalContracts.availableActions.commitBoundary` требует повторной проверки
signed action envelope перед первой записью. Навигация/read-only ничего не
пишет, но stale projection всё равно может раскрыть уже недоступный target.

### Проектный выбор

- Source form, actionKey, role, owner/context, projection revision, target
  entry conditions и bindings проверяются до публикации target payload.
- Navigation refusal сохраняет прежнюю presentation и browser URL/history.
- Forbidden target payload отсутствует и в refusal.
- Snapshot, presentation assignment и available actions относятся к одной
  `projectionRevision`.

## Обоснование

### Что следует из источников

Обычный CTA, signed recovery, system dispatch, same-form preview и local
settings имеют разные точные guards. Универсальная интерпретация одного
`TransitionKind` потеряла бы эти различия.

### Проектный выбор

Action identity сохраняет user choice, не отдавая client authority результата.
Составная presentation хранит underlay/layers, а full snapshot исключает новую
форму со старым payload. V2 применяет versioning ADR 0020, не меняя v1.

## Отвергнутые альтернативы

### Что следует из источников

Recovery-only доказательства не описывают ordinary CTA, а label/trigger не дают
однозначного action join. Local settings не являются shared campaign state.

### Проектный выбор

| Вариант                                           | Причина отказа                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Host выбирает form без user action                | Противоречит явным selectable CTA и role-branch click                                |
| Client сразу следует `targetFormId`               | Обходит повторную guard/revision проверку и signed returns                           |
| Использовать label или transition trigger         | Неуникальные labels и несовпадающие `J-*` triggers                                   |
| Передавать `{from,to,kind,trigger}` как operation | Для form action нет общего однозначного join; дублирует ADR 0020 неверной семантикой |
| Scalar `currentFormId`                            | Теряет underlay, overlay, dialog, component и render-only lifecycle                  |
| Любой `system-event` меняет form                  | `$.transitions[643,1436,1586,1587]` говорят обратное                                 |
| Любой `kind` получает один wire route             | `subflow`, `safe-return` и `system-event` неоднородны                                |
| Использовать reconnect как navigation request     | V1 shape не несёт action/route/bindings и имеет другой смысл                         |
| Добавить unknown fields в v1                      | Запрещено exact decoding и versioning ADR 0020                                       |
| Host snapshot заменяет local settings             | Противоречит device-local guards и offline contract                                  |

## Последствия

### Что следует из источников

Реализация должна продолжать брать IDs, routes, kinds, actionKey, guards и
target form из Atlas, а не из per-screen switch. Командные маршруты ADR 0020,
checkpoint ADR 0018/0025 и source priority не меняются.

### Проектный выбор

- Следующая задача вводит wire v2 codec/vocabulary, не меняя v1.
- Host публикует presentation и actionKey одной revision.
- Web разделяет host/local presentation и не навигирует optimistically.
- Direct URL становится validated intent, а не authority shortcut.
- Вертикаль `CHR-` может открыть `CHR-001` по actionKey и получить assigned
  `localCharacterId`; запись персонажа остаётся отдельной командой.
- Тесты покрывают duplicate labels, stale/hidden action, bindings, signed
  return, system no-route, underlay, local settings, reconnect и version mismatch.
- ADR не определяет widget schema, lifecycle mapping, owner storage или
  persistence query; эти контракты остаются в своих задачах.
