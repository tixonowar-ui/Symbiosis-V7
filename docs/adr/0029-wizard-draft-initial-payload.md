# ADR 0029 — Начальный payload wizard-черновика

- **Статус:** Принято
- **Дата:** 2026-08-17

## Контекст

`CHR-001` должна быть опубликована до первого пользовательского ввода, но её
`requiredFields` перечисляет уже одиннадцать полей. Для `name`, `age`, `massKg`,
необязательных description/art и служебных значений Atlas не задаёт начальное
JSON-представление.

Проблема шире одной формы. Точный scan `forms[*].requiredFields`
[сырого Atlas][atlas]
даёт:

- bare `wizardCheckpointId` в 32 формах;
- bare `draftRevision` в 52 формах;
- bare `commandId` в 146 формах;
- 48 полей с суффиксом `(required)` в 45 формах;
- 12 полей с суффиксом `(optional)` в 9 формах.

ADR 0020 оставляет form payload непрозрачным JSON для shared codec. ADR 0026
публикует payload, presentation и доступные действия атомарно, но не определяет
application schema полей. ADR 0025 фиксирует checkpoint identity и отделяет её
revision от `draftRevision`. ADR 0027 запрещает заменять отсутствие пустой
строкой, zero UUID, `NONE` или malformed ID.

Нужно определить только начальное состояние полей wizard/form draft и момент
появления двух служебных идентичностей. Точные домены введённых впоследствии
значений, widget state и сама команда checkpoint остаются вне этого ADR.

## Решение

### 1. Отсутствующее пользовательское значение

**Вывод из источников.** `CHR-001.requiredFields` одновременно требует
`name(required)`, `age(required)` и положительную `massKg` с шагом 0,1. Форма
при этом достижима до ввода этих значений. Atlas не задаёт пустую строку, ноль,
отсутствующий key или иной placeholder как начальное значение.

**Проектный выбор.** Каждое ещё не введённое пользовательское поле присутствует
в initial role-filtered payload со значением JSON `null`. Для `CHR-001` это:

- `name: null`;
- `age: null`;
- `massKg: null`.

`null` означает только «пользователь ещё не предоставил значение». Это не
валидное доменное значение и не удовлетворяет guard, validation или command
precondition. После ввода key содержит фактическое значение своего
form-specific domain; этот ADR не придумывает его тип или дополнительные
границы.

Пустая строка не заменяет отсутствующее имя. Числовой `0` не заменяет
отсутствующие возраст или массу; в частности, для `massKg` он прямо нарушает
`number>0`. Клиент не нормализует `null` в правдоподобный default.

### 2. `wizardCheckpointId` существует до первого snapshot

**Вывод из источников.** ADR 0025 §2 называет `wizardCheckpointId` стабильной
domain-owned identity checkpoint-потока, отличной от `local_character_id`, и
говорит, что первый commit закрепляет её. §5 сохраняет тот же ID под именем
`lastCompleteCheckpointId` после первого полного commit. Следовательно, commit
не может выбрать другую identity задним числом.

ADR 0026 уже допускает executor-allocated identity в host-confirmed assignment
до persistence commit: exact retry navigation получает то же назначение, а
незакоммиченная allocation не становится durable recovery key.

**Проектный выбор.** Executor выделяет один реальный непрозрачный domain-owned
`wizardCheckpointId` после успешной проверки открытия нового draft flow и до
построения первого snapshot `CHR-001`. Initial payload всегда несёт этот ID как
non-null value.

ID сохраняется при обычной навигации внутри того же wizard, повторной
публикации и exact replay того же назначения. Первый полный checkpoint обязан
записать ровно этот ID как `checkpoint_id`; последующий mismatch owner/ID
отклоняется по ADR 0025.

ID обязан отличаться от `characterDraftId`/`localCharacterId` по ADR 0025. Он
не взаимозаменяем с `commandId`, но этот ADR не требует глобального строкового
неравенства разных typed namespaces. Обычный transport disconnect и reconnect
сохраняют ID, пока живо то же host-confirmed assignment.

До первого commit ID живёт только в этом assignment. Если flow явно отменён,
host перезапущен либо pre-commit assignment потерян, ADR 0026 возвращает safe
`APP-004`, а ID забрасывается и никогда не переиспользуется. Только новое явное
открытие draft flow получает новую identity; URL, browser history и cached form
не восстанавливают старую.

Если allocator не может выдать valid identity, `CHR-001` не публикуется:
остаётся предыдущая safe presentation либо source-owned diagnostic. `null`,
пустая строка, zero UUID и `NONE` для `wizardCheckpointId` запрещены.

ADR не доопределяет lexical format ID: ADR 0025 гарантирует stable opaque
identity, но не объявляет её UUID. Выбирать UUID grammar по аналогии с другим
ID было бы новым неподтверждённым контрактом.

### 3. `commandId` возникает вместе с конкретной командой

**Вывод из источников.** ADR 0020 связывает `commandId` с одним exact
нормализованным mutation request, его pending/terminal lifecycle и receipt.
Повтор того же ID и request возвращает прежний результат; другой payload с тем
же ID даёт idempotency conflict. До выбора действия и фиксации request такой
команды ещё нет.

Cross-form scan также отвергает standing command slot: bare `commandId` есть
только у 28 из 32 форм с `wizardCheckpointId`; кроме того, executable action
availability и bare `commandId` встречаются друг без друга в обе стороны.

**Проектный выбор.** Initial payload формы, чья form-specific application schema
объявляет bare `commandId`, содержит `commandId: null`. ADR не добавляет этот
key формам без него и не переопределяет source fields вида `commandIdOrNull`.
Spare ID не создаётся только ради заполнения формы.

Инициатор exact mutation request создаёт непрозрачный non-null `commandId`
после фиксации конкретных command kind, reference, expected revisions и payload,
но до первого checked send. После этого ID сохраняется для retry, pending,
reconnect и terminal replay только этого request. Новая команда получает новый
ID.

`null` разрешён лишь внутри application payload как отсутствие текущей
команды. Поле `commandId` в самом `command.request` остаётся обязательным
non-null ID по ADR 0020; shared message shape и codec не меняются. Представление
pending/terminal command в последующих form payload этот ADR не задаёт.

### 4. Начальная `draftRevision`

**Вывод из источников.** ADR 0025 §2 задаёт первому полному checkpoint
`checkpoint_revision = 0`, а §2 и §5 прямо запрещают отображать этот счётчик на
`draftRevision`. Atlas требует bare `draftRevision`, но не задаёт её старт или
инкременты.

**Проектный выбор.** Первый опубликованный экземпляр draft имеет
`draftRevision: 0`. Это реальная версия существующего logical draft с уже
назначенными identities и начальными значениями, а не представление отсутствия.

`draftRevision` является отдельной payload-axis. Совпадение её начального нуля
с первым `checkpoint_revision` не создаёт равенства, формулы или общего
счётчика. Первый durable checkpoint сохраняет domain-confirmed current
`draftRevision`, которая не обязана оставаться нулевой, а его собственная
checkpoint revision всё равно начинается с 0.

Этот ADR не определяет, какое будущее принятое изменение draft увеличивает
`draftRevision`: такого источника нет, а сохранение является отдельной
mutation-задачей. Будущий контракт обязан задать trigger и idempotency явно и
не выводить их из checkpoint/root revisions.

### 5. `(required)` и `(optional)` изменяют validation, не shape

**Вывод из источников.** Оба суффикса встречаются внутри массива
`requiredFields`. У `CHR-001` в одном списке находятся `name(required)` и
`description(optional)`. Atlas не говорит, что optional key можно удалить из
projection, и не задаёт отдельную sparse wire-схему.

**Проектный выбор.** Для всех 48 `(required)` и 12 `(optional)` entries действует
одно правило: в role/direction projection, к которой относится Atlas entry,
разрешённый form-specific contract key обязателен. `(optional)` никогда не
разрешает omission. Суффикс определяет допустимость `null` при переходе или
commit:

- `(required)` — `null` допустим до ввода, но блокирует зависимые action/command;
- `(optional)` — `null` является окончательным честным отсутствием и само по
  себе не блокирует action/command.

Поэтому initial `CHR-001` несёт `description: null` и
`artAssetKeyOrLocalFile: null`, а не опускает keys. Когда значение есть, key
несёт фактическое form-owned значение. Missing governed key, пустая строка как
отсутствие и строковый sentinel отклоняются application decoder.

Аннотация сама по себе не материализует aggregate `requiredFields` во всех
projection states и направлениях. Иная shape допустима только при explicit
source/form-specific контракте другого state или направления. Он же определяет
имя key: composite source literals с `/` нельзя механически разделять. Правило
не превращает все `requiredFields` Atlas в одну глобальную wire schema.

Суффиксы не являются полным словарём validation: например, обязательность
`massKg` задаёт отдельный guard без `(required)`. Такие literals и guards
остаются старшим form-specific контрактом. Поля, чьи source names уже содержат
`OrNull`, также не переопределяются этим общим правилом по аналогии.

### 6. `IDENTITY_INCOMPLETE` — отрицательное пространство action

**Вывод из источников.** `CHR-001.states.IDENTITY_INCOMPLETE` буквально говорит:
`Continue is absent until name/age/positive 0.1kg mass validate`. Continue —
`CHR-001::CTA::001`; его per-action guard требует эти значения, а
`whenGuardFalse` удаляет действие из player/effective-controller payload, DOM,
accessibility tree, hotkeys и cache.

ADR 0026 требует, чтобы snapshot содержал только доступные actions одной
`projectionRevision`; target, label или локальная догадка клиента не заменяют
host-filtered action vocabulary.

**Нормативное следствие, не новый проектный выбор.** Отдельный
`identityIncomplete`, state literal или boolean в payload не вводится. Пока
guard Continue ложен,
`presentation.base.availableActionKeys` не содержит `CHR-001::CTA::001`.
Остальные actions, включая cancel, оцениваются независимо собственными guards.

Когда отдельный form-specific контракт подтверждает новые значения,
authoritative action projector повторно проверяет весь guard в текущих
revisions. Только успешная проверка добавляет exact action key в новый atomic
snapshot. Transport, widget buffer и save этой проверки данный ADR не задаёт.
Renderer не получает disabled/hidden Continue и не восстанавливает его из Atlas
самостоятельно.

### 7. Начальный срез `CHR-001`

Initial role-filtered payload имеет следующие значения:

| Поле                     | Начальное значение                                        |
| ------------------------ | --------------------------------------------------------- |
| `characterDraftId`       | уже назначенный immutable ID из контракта формы           |
| `name`                   | `null`                                                    |
| `description`            | `null`                                                    |
| `artAssetKeyOrLocalFile` | `null`                                                    |
| `age`                    | `null`                                                    |
| `massKg`                 | `null`                                                    |
| `massApprovalStatus`     | literal `PENDING_GM`                                      |
| `anatomyProfile`         | literal `STANDARD_HUMANOID`                               |
| `wizardCheckpointId`     | реальный pre-commit opaque ID текущего wizard flow        |
| `draftRevision`          | integer `0`, первая существующая версия                   |
| `commandId`              | `null`, потому что concrete command request ещё не создан |

Metavalue «уже назначенный ID» в таблице не является wire-строкой или
placeholder: snapshot несёт фактическое значение. Continue action key в
initial `availableActionKeys` отсутствует; это состояние публикуется атомарно с
payload и `draftRevision: 0`.

## Совместимость с принятыми решениями

| Контракт    | Почему решение его сохраняет                                                         |
| ----------- | ------------------------------------------------------------------------------------ |
| ADR 0025 §2 | ID выделяется раньше, но первый commit закрепляет тот же `wizardCheckpointId`        |
| ADR 0025 §5 | wizard/recovery используют один ID; `draftRevision` не равна checkpoint revision     |
| ADR 0026    | payload и отфильтрованные actions устанавливаются одним atomic snapshot              |
| ADR 0027 §7 | применена та же fail-closed discipline: нет empty/zero UUID/`NONE`; identity реальна |
| ADR 0020    | `commandId=null` не попадает в request; concrete request всегда имеет real ID        |

JSON `null` здесь не sentinel: codec сохраняет отдельный JSON type, который не
пересекается с допустимым string/number/identity domain. Число 0 у
`draftRevision` также не означает отсутствие: draft уже существует и это его
первая версия. Для `massKg` число 0, напротив, не используется вовсе.

## Обоснование

Явный `null` даёт exact стабильную shape до и после ввода и не смешивает
«значение отсутствует» с невалидным значением подходящего scalar type.
Различие required/optional остаётся в validation, где оно наблюдаемо, а не в
наличии key.

Ранний `wizardCheckpointId` следует его семантике identity потока: persistence
не создаёт новую identity, а атомарно закрепляет уже показанную. Поздний
`commandId` следует другой семантике — identity одного frozen request. Их
одновременная генерация по аналогии смешала бы lifetime и replay contracts.

Отдельная `draftRevision` позволяет назвать начальный draft до первого
checkpoint, не превращая persistence counter в domain revision. Отсутствие
Continue остаётся проверяемым negative-space contract Atlas и не дублируется
вторым state field.

## Отвергнутые альтернативы

| Вариант                                 | Причина отказа                                                      |
| --------------------------------------- | ------------------------------------------------------------------- |
| Опускать незаполненный key              | Нарушает выбранную exact initial shape                              |
| Пустая строка, zero UUID или `NONE`     | In-band отсутствие и прямо запрещённые ADR 0027 placeholders        |
| Числовой `0` как отсутствие             | Это domain value: invalid для mass и реальная версия для draft      |
| `wizardCheckpointId: null` до save      | Поток уже назначен; persistence пришлось бы тайно сменить identity  |
| Генерировать новый wizard ID при retry  | Ломает stable flow и exact replay                                   |
| Заранее выдавать spare `commandId`      | ID ещё не к чему привязать; lifetime form и request различаются     |
| Приравнять `draftRevision` к checkpoint | ADR 0025 прямо сохраняет независимые axes                           |
| Удалять optional keys                   | Создаёт вторую sparse shape без источника                           |
| Добавить поле `IDENTITY_INCOMPLETE`     | Дублирует отсутствие exact action и создаёт два источника состояния |
| Показывать Continue disabled на клиенте | Guard-false action запрещён в payload, DOM, a11y, hotkeys и cache   |

## Последствия и пересмотр

- Реализация `CHR-001` получает полную initial application schema без изменения
  shared v2 message shape: `roleFilteredPayload` остаётся opaque `JsonObject`.
- Host/domain должен выделить wizard identity до первой публикации и не писать
  checkpoint до отдельной mutation-команды.
- Web application decoder обязан различать JSON `null`, фактическое значение и
  missing governed key; defaults и inference запрещены.
- Командный codec ADR 0020 не принимает `null`: ID создаётся до первого send и
  затем участвует в существующем journal/replay contract.
- `draftRevision` можно показать сразу, но её будущие increment triggers должны
  быть определены отдельным domain/mutation контрактом.
- `availableActionKeys` остаётся единственным wire-выражением
  `IDENTITY_INCOMPLETE`; renderer и payload не вводят копию state.
- ADR не задаёт save/checkpoint command, widget buffer, форматы введённых
  значений, lexical grammar opaque ID или поля вне названного initial-draft
  scope.
- Пересмотр нужен, если старший источник поставит explicit nullability/key
  omission, lexical ID grammar либо lifecycle `draftRevision`; менять это по
  аналогии в реализации нельзя.

[atlas]: ../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json
