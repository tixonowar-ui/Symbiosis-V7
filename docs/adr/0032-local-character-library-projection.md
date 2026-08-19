# ADR 0032 — Ревизия и lifecycle-проекция локальной библиотеки

- **Статус:** принято
- **Дата:** 2026-08-18
- **Дополняет:** [ADR 0018](0018-current-state-storage-and-checkpoints.md)
  для derived-проекции нескольких `local_character` и
  [ADR 0031](0031-shell-revision-scope.md) для новой runtime-оси оболочки

## Контекст

APP-004 публикует библиотеку локальных персонажей. Atlas требует в payload
`localCharacterLibraryRevision`, `draftCharacterIds[]` и
`finalCharacterIds[]`, но не назначает владельца библиотечной ревизии и не
сопоставляет шесть lifecycle-состояний двум массивам.

Issue #93 должна замкнуть путь APP-001 → APP-002 → CHR-001 → APP-004 →
APP-002. Значения этих полей нужны до следующего среза, который начнёт
сохранять черновик, поэтому неопределённость нельзя закрыть константой без
контракта на дальнейшие изменения.

### Что следует из источников и принятых решений

APP-004 — `$.forms[3]`. Её purpose, input owner и guards задают две ветви
владения содержимым библиотеки:

- при `localOwnerIdOrNull=null` библиотека принадлежит `deviceId`, а проверка
  совпадения local owner не применяется;
- non-null owner обязан совпадать с active acknowledged local owner, а на
  host-компьютере дополнительно требует committed
  `HOST_LOCAL_CANDIDATE` handoff receipt.

Источник: [`$.forms[3].purpose/inputOwner/entryConditions/guardStates`, строки
29584–29595](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L29584-L29595).

Точная shape перечислена в
[`$.forms[3].requiredFields[0..10]`, строки 29602–29613](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L29602-L29613).
Generated-представление повторяет её в
[`forms-by-id.json["APP-004"].requiredFields[0..10]`, строки 6217–6229](../../generated/spec/atlas/forms-by-id.json#L6217-L6229).

Lifecycle `localCharacter` содержит только названия шести состояний и journeys,
но не библиотечные buckets:
[`$.entityLifecycles[0]`, строки 1537–1551](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L1537-L1551),
[`lifecycles.json[0]`, строки 1–17](../../generated/spec/atlas/lifecycles.json#L1-L17).

Дополнительные записи дают направление, но не полную таблицу:

- character diagram содержит `FINAL → EXPORTED` и
  `FINAL → VARIANT → DRAFT` в
  [`$.diagrams[1].source`, строки 1856–1860](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L1856-L1860)
  и [`diagrams.json[1]`, строки 8–12](../../generated/spec/atlas/diagrams.json#L8-L12);
- variant command создаёт новый draft UUID в
  [`$.registryCoverage.workflowCommands[25]`, строки 257463–257471](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L257463-L257471)
  и [`workflow-commands.json[25]`, строки 285–294](../../generated/spec/atlas/workflow-commands.json#L285-L294).

Текущий срез входит из player menu и возвращается туда:
[`$.forms[1].actions.ctaAvailabilityByAction[1]`, строки 28336–28340](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L28336-L28340),
[`$.forms[59].actions.ctaAvailabilityByAction[1]`, строки 54622–54626](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54622-L54626)
и
[`$.forms[3].actions.ctaAvailabilityByAction[6]`, строки 30025–30029](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L30025-L30029).

[ADR 0018](0018-current-state-storage-and-checkpoints.md) назначает отдельную
тройку каждому persistent `local_character`, но не collection projection.
[ADR 0031](0031-shell-revision-scope.md) назначает host shell runtime aggregate
и прямо требует отдельного решения для нового shell-owned state.

### Что источники не решают

Ни raw Atlas, ни generated-представления не определяют:

- owner, lifetime, initial value или increment matrix
  `localCharacterLibraryRevision`;
- связь этого числа с тройкой отдельного `local_character` либо shell
  `RevisionVector`;
- распределение `DRAFT`, `VALID`, `FINAL`, `EXPORTED`, `VARIANT`, `DELETED`
  между двумя массивами;
- порядок ID внутри массивов.

Следующие разделы — проектный выбор, а не вывод скрытого требования.

## Решение

### 1. Владелец и scope библиотечной ревизии

Содержимое библиотеки принадлежит owner, заданному Atlas: `deviceId` для
null-ветви либо exact confirmed local owner для non-null ветви.

`localCharacterLibraryRevision` — отдельная runtime-ось библиотечной проекции
внутри `host shell runtime aggregate` ADR 0031:

- один host instance имеет одну такую ось;
- она живёт через navigation, смену `contextId` и transport reconnect;
- она завершается вместе с host instance;
- это не SQLite row, persistent aggregate, lifecycle entity или четвёртая
  координата `RevisionVector`;
- это не alias, `max`, сумма или продолжение ревизий отдельных персонажей и не
  shell `projectionRevision`.

Начальное значение — `0`. При старте host текущее подтверждённое содержимое
библиотеки становится baseline revision `0`, даже если оно непусто.

Значение — safe integer от `0` до `Number.MAX_SAFE_INTEGER`. Требуемый
инкремент на верхней границе отклоняет логическое событие до commit и
publication.

### 2. Каноническая библиотечная проекция

Каноническое значение, изменения которого версионирует ось, состоит из:

1. фактического tagged owner key: `{ kind: "device", id: deviceId }` для
   null-ветви либо `{ kind: "localOwner", id: localOwnerId }` для non-null;
2. `draftCharacterIds`;
3. `finalCharacterIds`.

В массивы входят только confirmed persistent строки `local_character`.
Выделенный до commit `characterDraftId`, navigation journal, URL и client cache
членство не создают.

Каждый ID сохраняется дословно, встречается не более одного раза и находится
ровно в одном массиве. Массивы сортируются возрастающим простым сравнением
строк без locale-зависимости. Неизвестный lifecycle отклоняет всю проекцию с
указанием значения, а не молча исключается.

### 3. Lifecycle buckets

| `localCharacter` lifecycle | Библиотечная проекция |
| -------------------------- | --------------------- |
| `DRAFT`                    | `draftCharacterIds`   |
| `VALID`                    | `draftCharacterIds`   |
| `VARIANT`                  | `draftCharacterIds`   |
| `FINAL`                    | `finalCharacterIds`   |
| `EXPORTED`                 | `finalCharacterIds`   |
| `DELETED`                  | ни один массив        |

`VALID` ещё не является `FINAL`. `VARIANT` остаётся редактируемой ветвью, а
variant command создаёт новый draft UUID. `EXPORTED` сохраняет финальную
семантику исходного локального листа. `DELETED` остаётся tombstone, но не
показывается как доступный персонаж.

### 4. Матрица инкрементов

| Результат одного confirmed события                                                           | `localCharacterLibraryRevision` |
| -------------------------------------------------------------------------------------------- | ------------------------------: |
| Создана persistent строка, добавляющая ID                                                    |                            `+1` |
| ID перешёл между draft/final buckets либо в `DELETED`                                        |                            `+1` |
| Сменился effective library owner                                                             |                            `+1` |
| Несколько изменений одной транзакции дали один новый итоговый canonical snapshot             |                            `+1` |
| Lifecycle изменился внутри того же bucket либо изменился payload без изменения двух массивов |                             `0` |
| Navigation, read, reconnect, refusal, exact replay, no-op или rollback                       |                             `0` |

Сравнивается итоговый canonical snapshot, поэтому промежуточные изменения одной
атомарной операции не создают несколько increments.

RevisionVector отдельного персонажа следует ADR 0018 независимо. Shell
`projectionRevision` следует ADR 0031: navigation может изменить только его;
изменение библиотечного snapshot меняет его лишь тогда, когда меняется текущая
serialized shell projection или available actions. Равенство двух осей не
гарантируется.

### 5. Restart и reconnect

- Reconnect к тому же live host возвращает текущую library revision.
- Restart создаёт новый baseline `0` и full snapshot фактического содержимого.
- Старое число может быть больше нового; порядок между host scopes не задан.
- `deviceId`, client cache, navigation journal, `knownRevisions` и дочерние
  entity revisions не восстанавливают эту ось.

Reset разрешён lifetime владельца, принятого в §1, а не только терпимостью
клиента. Full snapshot делает новый baseline совместимым с reconnect.

### 6. Текущий V1-срез issue #93

В реализуемом пути active library — device-owned null-ветвь до кампании.
Handoff не выполнялся. Если confirmed persistent строки `local_character`
отсутствуют, APP-004 публикует:

```json
{
  "localOwnerIdOrNull": null,
  "localCharacterLibraryRevision": 0,
  "draftCharacterIds": [],
  "finalCharacterIds": [],
  "launchContext": "PLAYER_MENU",
  "handoffIdOrNull": null,
  "handoffReceiptIdOrNull": null,
  "returnContext": "PLAYER_MENU",
  "campaignAuthority": false
}
```

`stateRevision` и `projectionRevision` добавляются из текущей shell-тройки.
`campaignAuthority=false` — фактическое состояние этого pre-campaign пути, а
не default для любой будущей player-menu проекции.

`HOST_LOCAL_CANDIDATE` в #93 не реализуется: ей нужны real non-null owner и
committed non-null handoff ID/receipt. Смешанная пара, пустая строка, zero UUID
или fallback к device-owned ветви запрещены.

## Совместимость с принятыми ADR

- **ADR 0018.** Persistent revisions каждого `local_character` не меняются.
  Библиотечная ось версионирует derived membership двух массивов и не заменяет
  entity-owned triple.
- **ADR 0026.** APP-002, APP-004 и local CHR остаются одним player-local
  context. Navigation intent по-прежнему сверяется с shell
  `projectionRevision`, не с library revision.
- **ADR 0027.** В V1 действует device-owned null-ветвь; non-null owner требует
  уже принятой handoff boundary и не выводится из URL или клиента.
- **ADR 0029.** Выделенный CHR-001 draft ID до первого confirmed persistence
  commit не становится членом библиотеки.
- **ADR 0031.** Host lifetime, restart reset и shell projection matrix
  сохраняются. Новый scalar является отдельной осью внутри того же runtime
  aggregate, как и требовал открытый пункт ADR 0031.

## Обоснование

Runtime-ось сохраняет полный snapshot как источник истины и не создаёт
фиктивный persistent root без source-owned identity, lifecycle или recovery
state. Отдельный scalar нужен, потому что navigation и membership имеют разные
матрицы: shell projection может двигаться при неизменной библиотеке.

Buckets проводят проверяемую границу между редактируемыми и финальными
персонажами. Решение не притворяется прямой расшифровкой Atlas: `VALID`,
`VARIANT`, `EXPORTED` и порядок ID назначены здесь явно.

## Отвергнутые альтернативы

| Вариант                                     | Причина отказа                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Persistent SQLite aggregate                 | Источник не задаёт его identity, lifecycle или recovery; V1 он не нужен |
| Приравнять к shell `projectionRevision`     | Navigation и библиотечное membership имеют разные increment matrix      |
| `max` дочерних revisions                    | Пропускает создание root с revision `0` и изменение другого персонажа   |
| Сумма или count дочерних roots              | Коллизии, неверная семантика bucket move и отдельный overflow           |
| Владение числом через `deviceId`            | Device identity — locator содержимого, но не lifetime runtime-счётчика  |
| Сбрасывать при navigation или смене context | Рвёт live-host continuity ADR 0031                                      |
| Всегда публиковать `0`                      | Не версионирует библиотеку после первой persistent записи               |
| Молча пропускать неизвестный lifecycle      | Fail-open скрывает данные и дрейф source/schema                         |

## Последствия

- Issue #93 читает confirmed device-owned строки через узкий persistence API и
  публикует их по buckets §3; на свежей V1-базе это точный пустой baseline с
  library revision `0`.
- SQLite migration и строка для library revision не создаются.
- Следующий срез, создающий persistent local character, обязан атомарно
  подключить matrix §4 и классификацию §3.
- Host получает перечисление хранилища через persistence, а не пишет SQL.
- Non-null owner branch остаётся fail-closed до реализации owner partition и
  committed handoff.
