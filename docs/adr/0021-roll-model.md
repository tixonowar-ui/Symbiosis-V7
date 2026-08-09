# ADR 0021 — Модель броска AUTO и MANUAL

- **Статус:** принято
- **Дата:** 2026-08-09

## Контекст

Symbiosis V7 поддерживает автоматический бросок приложения и ручной ввод
результата физического кубика. Это не два набора правил: поле `rollSource` в
XP-контракте обязательно, принимает `AUTO|MANUAL` и прямо говорит «Источник
броска не меняет результат». До первого handler'а проверки нужна одна модель,
которая сохраняет происхождение для аудита, но не даёт ему изменить механику.

Нормативные источники уже задают почти всю модель:

- `REQ-039`, `REQ-040`, `REQ-066`;
- формы `CMB-032`, `CMB-033`, `CMB-034`, `CMB-035`, `CMP-004`, `CHR-036`;
- lifecycle `rollRequest`;
- XP-поле `rollSource` с Rule IDs `CORE-229`, `SYM-021` и
  `USR-2026-07-30-XP-001`;
- [ADR 0009](0009-roll-request-queue-per-command.md) и
  [ADR 0020](0020-wire-protocol-and-shared-contracts.md).

Открыты только источник случайности AUTO, воспроизведение random receipt и
проверяемая граница, на которой оба источника становятся одним механическим
результатом. Форма запроса, каталог дайсов, фиксация режима и критические
цепочки не проектируются заново.

## Решение

### 1. Один submit-контракт и буквальные конверты Atlas

AUTO и MANUAL используют одну workflow-команду `UI-CMD-ROLL-SUBMIT`. Отдельных
команд по режимам нет. `UI-CMD-ROLL-PACKAGE-CREATE` создаёт ускоренный пакет
той же команды, а не третий способ броска.

У `CMB-032` ровно 29 required-field literals, у `CMB-033` — 27. После
нормализации только значения `modeSnapshot` совпадают 26 literals:

- `rollRequestId`, `commandId`;
- `requestContext=INITIAL_INITIATIVE|REINFORCEMENT|COMBAT_ACTION|PEACE_CHECK|PEACE_ITEM|PEACE_PHARMA|PEACE_ABILITY`;
- `originRollKind=ORIGINAL_D20|CRIT_SUCCESS_CONFIRMATION|CRIT_FAILURE_CONFIRMATION|SUBSTITUTION|DAMAGE|PENETRATION|OTHER`;
- `rollPurpose`, `dieSides=4|6|12|20`, `modeSnapshot`;
- `ownerActorId`, `ownerControllerSeat`;
- `seriesIdOrNull`, `currentEntryIndexOrNull`, `criticalChainIdOrNull`;
- `criticalEligible`, `symbiontXpEligible`, `characteristicMarkEligible`;
- `originRollIdOrNull`, `parentOriginRollIdOrNull`;
- `returnResolverFormId(server-signed)`;
- `sceneContext=PEACE|COMBAT`, `projectionRole=PLAYER|GM`,
  `underlayFormIdOrNull`;
- `stateRevision`, `projectionRevision`;
- `status=PENDING|SUBMITTED|CONSUMED`;
- `submissionReceiptIdOrNull`, `commandIdempotencyKey`.

Различия сохраняются буквально:

| Контракт        | `CMB-032` AUTO                        | `CMB-033` MANUAL                      |
| --------------- | ------------------------------------- | ------------------------------------- |
| Snapshot        | `modeSnapshot=AUTO`                   | `modeSnapshot=MANUAL`                 |
| Поле грани      | `rawFaceOrNull`                       | `rawFace integer 1..dieSides or null` |
| Только в режиме | `randomReceipt`, `shownAtLeastMs=500` | —                                     |

Имена полей грани не унифицируются. `dieSides` — закрытый union `4|6|12|20`;
d8, d10 и произвольное число граней отклоняются.

MANUAL проверяет raw face до отправки. Нецелое значение либо значение вне
`1..dieSides` остаётся в состоянии формы `INVALID_RANGE` и не становится wire
command. `INVALID_RANGE` не добавляется как новый refusal code ADR 0020.

Состояния `RESOLVED` также остаются разными:

- AUTO: `Result persisted once; reconnect does not reroll.`;
- MANUAL: `Result persisted once; repeat returns receipt.`.

Общий reconnect-инвариант `REQ-039` действует на оба режима: committed command
восстанавливается по `commandId` с тем же receipt/random result и без повторного
эффекта.

### 2. Режим фиксируется при создании запроса

Lifecycle `rollRequest` перечисляет состояния `CREATED`, `MODE_SNAPSHOT`,
`ROLLED`, `CONFIRMING_CRIT`, `RESOLVED`, `REPLAY_RECEIPT`. В соответствии с
ADR 0018 порядок массива не объявляется порядком переходов или начальным
состоянием. После фиксации в `MODE_SNAPSHOT` конкретного запроса его
`modeSnapshot` неизменяем.

`CMP-004.defaultFutureRollMode` влияет только на будущие запросы;
`openRollRequestsUnaffected=true`. Уже открытые snapshots не переписываются.

В создании персонажа один `CHR-036.diceInputMode` применяется ко всем creation
rolls. После первого показанного результата изменение режима отклоняется как
`LOCKED_AFTER_RESULT`.

Чистый domain-контракт хранит только неизменяемый source-selection slice
`RollSourceSnapshot`: `rollRequestId`, `originatingCommandId`, `dieSides`,
`modeSnapshot`. Это не полная реализация 29/27 полей или lifecycle.

Внутренние имена намеренно различают две связи: `originatingCommandId`
принадлежит запросу броска по ADR 0009, а `submitCommandId` — opaque
`command.request.commandId` команды `UI-CMD-ROLL-SUBMIT` по ADR 0020. Это не
новые wire-поля и не переименование Atlas; будущий host adapter отвечает за
отображение существующего envelope без смешения двух идентичностей.

### 3. AUTO использует host-side `node:crypto.randomInt`

Host adapter получает грань синхронным вызовом
`randomInt(1, dieSides + 1)`. Нижняя граница включена, верхняя исключена.
Domain принимает узкую инъекцию `sampleFace(dieSides)` и повторно проверяет,
что результат — integer в `1..dieSides`. `Math.random` и fallback на другой
генератор запрещены.

Порядок обработки сохраняет ADR 0020:

1. exact decode;
2. lookup по `commandId` и сравнение с сохранённым нормализованным request;
3. для совпавшего command — возврат сохранённого результата;
4. для того же ID с другим request — `IDEMPOTENCY_CONFLICT`;
5. только новый request проходит authority, owner, revisions, guards, связь
   `rollRequestId` с одной командой по ADR 0009 и проверку `modeSnapshot`;
6. только после всех проверок AUTO вызывает RNG ровно один раз.

MANUAL не вызывает RNG. Replay, reconnect, conflict, чужой `rollRequestId`, уже
resolved request и invalid request также не вызывают RNG.

`randomReceipt` — immutable JSON-object, связывающий `rollRequestId`,
`originatingCommandId`, `submitCommandId`, `modeSnapshot=AUTO`, `dieSides` и
`rawFace`. Отдельные seed, algorithm version, timestamp, signature или второй
`receiptId` не вводятся. Host помещает этот object в result существующего
`CommandReceipt` ADR 0020.

Для нового AUTO command host в одной SQLite transaction сохраняет
`randomReceipt`, `rawFace`, переход `rollRequest`, command result и вызванные
эффекты. Ошибка RNG или commit даёт zero committed write; повторный RNG как
fallback запрещён. Отображение infrastructure failure в transport остаётся
за будущим host task: этот ADR не добавляет refusal code и не меняет закрытый
wire-контракт ADR 0020. После commit-before-ack и при reconnect читается
сохранённый receipt — RNG не запускается заново.

### 4. Источник отделён от механического результата

После проверки оба режима дают один `MechanicalRoll`:

```ts
interface MechanicalRoll {
  readonly dieSides: 4 | 6 | 12 | 20;
  readonly rawFace: number;
}
```

`rollSource` и `randomReceipt` остаются provenance/audit. Будущий rules handler
получает `MechanicalRoll`, а не весь provenance object. Поэтому AUTO и MANUAL с
одинаковыми `dieSides` и `rawFace` физически входят в правило одинаковым
значением, и ветвиться по источнику правилу не на чем.

Unit test сравнивает mechanical result AUTO и MANUAL на обеих границах каждого
из d4, d6, d12 и d20. Это доказывает текущую source-neutral boundary. Каждый
будущий handler проверки всё равно обязан иметь парный AUTO/MANUAL test: этот
ADR не объявляет ещё не написанные правила покрытыми.

### 5. Критические цепочки переносятся без расширения

`CMB-034` начинает success-chain только для `criticalEligible` ORIGINAL D20 с
`rawFace=20`; chain хранит `originalRawFace=20`. `CMB-035` симметрично начинает
failure-chain только для `criticalEligible` ORIGINAL D20 с `rawFace=1` и хранит
`originalRawFace=1`.

D4/D6/D12, confirmation и substitution не создают новую critical chain и не
начисляют XP. Продолжение использует существующие `criticalChainId`,
`parentOriginRollId` и исходный domain context. У каждого следующего
confirmation request собственный
`pendingConfirmationModeSnapshot=AUTO|MANUAL|null`; он не наследуется задним
числом из нового campaign default.

`criticalOutcome` и его формулы эти формы не задают. ADR не вводит их — это
работа будущих rule handlers.

## Обоснование

Модель максимально переносит Atlas: единственное новое решение — источник AUTO
и способ сделать его идемпотентным. Сохранение результата надёжнее повторного
вычисления: reconnect зависит от journal/transaction, а не от возможности
воспроизвести внутреннее состояние RNG.

Source-neutral `MechanicalRoll` делает норму `rollSource.Purpose` структурной.
Provenance остаётся доступным для обязательного XP/audit поля, но не попадает в
механический вход handler'а.

### Проверенное поведение инструмента

Проверено 2026-08-09 на требуемом runtime Node.js `24.19.0`, npm `11.17.0`:

- для каждого из d4, d6, d12 и d20 выполнено 100 000 вызовов
  `randomInt(1, dieSides + 1)`;
- каждый результат был integer в `1..dieSides`; для каждого дайса наблюдались
  обе границы и все допустимые faces;
- fractional bound дал `TypeError / ERR_INVALID_ARG_TYPE`;
- равные или обратные bounds дали `RangeError / ERR_OUT_OF_RANGE`;
- runtime/API contract подтверждает inclusive `min`, exclusive `max` и
  реализацию без modulo bias.

Прогон проверяет диапазон и интеграционную сигнатуру, но не пытается
статистически доказать равномерность. Unit test поэтому использует
детерминированный injected sampler и проверяет точное число вызовов.

### Отвергнутые альтернативы

| Вариант                                  | Причина отказа                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Math.random()`                          | Не является выбранным cryptographic source и создаёт второй, более слабый путь                |
| `randomBytes(1)[0] % dieSides`           | Даёт modulo bias для d6, d12 и d20; ручной sampler дублирует готовый API                      |
| Seed/HMAC от `commandId`                 | Предсказуем без отдельного секрета; секрет, rotation и unbiased mapping создают лишнюю модель |
| Повторить RNG при replay/reconnect       | Противоречит `REQ-039`, AUTO `RESOLVED` и ADR 0020                                            |
| Глобальный пул предварительных бросков   | Противоречит ADR 0009 и позволяет выбрать результат для другой команды                        |
| Отдельные AUTO/MANUAL commands           | Противоречит единственному `UI-CMD-ROLL-SUBMIT` Atlas                                         |
| Унифицировать имена raw-face fields      | Было бы ручной правкой нормативного конверта Atlas                                            |
| Передать `rollSource` в rules handler    | Удваивает rule paths и нарушает «Источник броска не меняет результат»                         |
| Реализовать critical/XP engine в этом PR | Выходит за ADR и минимальный контракт; формулы принадлежат issue #8 и последующим rule tasks  |

## Последствия

- `src/domain/entities/roll-request` получает минимальный чистый контракт, но
  не полную entity state machine и не rules engine.
- Host обязан реализовать `randomInt` adapter, journal lookup до RNG и atomic
  persistence до первой AUTO-проверки.
- Persistence хранит random receipt как часть неизменяемого command result;
  replay не создаёт новый receipt или эффект.
- Строгая валидация не допускает d8/d10, coercion MANUAL input или invalid RNG
  face.
- Contract tests ломаются при drift 29/27 полей, разных `RESOLVED`,
  `REQ-039`, mode locks, critical-chain guards, lifecycle или `rollSource`.
- Формы и critical/XP effects остаются не реализованы; тесты в этом PR
  фиксируют их нормативный Atlas contract, а не объявляют движок готовым.
