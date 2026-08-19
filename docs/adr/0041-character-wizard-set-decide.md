# ADR 0041 — Фиксация первых развилок мастера персонажа

- **Статус:** принято
- **Дата:** 2026-08-19
- **Частично заменяет:** initial `choiceLockStatus: null` и оставленную
  открытой selected projection в [ADR 0034 §1](0034-chr-010-initial-projection.md)
- **Дополняет:** wire routing [ADR 0020 §2](0020-wire-protocol-and-shared-contracts.md),
  checkpoint envelope [ADR 0025](0025-character-draft-checkpoint-scope.md) и
  IDENTITY stage [ADR 0033 §3](0033-chr-001-identity-input-contract.md)

## Контекст

После IDENTITY checkpoint host публикует `CHR-010`, но три race selector
остаются `local-draft-command`: они не пересекают wire. Для продолжения нужен
один host-authoritative commit `UI-CMD-CHAR-CREATION-SET-DECIDE`, который
фиксирует выбранное значение и подписывает следующий этап.

Atlas объединяет `CHR-010`, `CHR-016`, `CHR-036` и `CHR-002` в journey-state
`RACE_AND_METHOD`:
[`journeys.json`, строки 183–191](../../generated/spec/atlas/journeys.json#L183-L191).
Exact form contracts находятся в
[`forms-by-id.json["CHR-010"]`, строки 13803–14496](../../generated/spec/atlas/forms-by-id.json#L13803-L14496),
[`CHR-016`, строки 16860–17384](../../generated/spec/atlas/forms-by-id.json#L16860-L17384),
[`CHR-036`, строки 25918–26501](../../generated/spec/atlas/forms-by-id.json#L25918-L26501)
и [`CHR-002`, строки 10237–10829](../../generated/spec/atlas/forms-by-id.json#L10237-L10829).

Команда требует один durable decision receipt и server-signed next branch;
cancel до commit ничего не меняет, reconnect восстанавливает то же решение и
destination:
[`workflow-commands.json`, строки 977–999](../../generated/spec/atlas/workflow-commands.json#L977-L999).
Exact forward transitions:
[`transitions.json`, строки 9347–9409](../../generated/spec/atlas/transitions.json#L9347-L9409).

Источники задают дословно только четыре закрытых domain:

- `raceChoice=UNITED|FREE|PURE`;
- `symbiontAcquisitionMode=MANUAL|RANDOM`;
- `diceInputMode=AUTO|MANUAL`;
- `statMethod=CLASSIC|ADVENTUROUS|ALL_OR_NOTHING`.

Alias `acquisitionMode`, старые `virtual|physical`, lower-case и соседние
значения недопустимы. Поля `raceConsequencesPreview`, `modeConsequences`,
`methodConsequences` и `choiceLockStatus` перечислены, но их JSON-domain и
initial values Atlas не задаёт. Это проектный пробел, а не скрытая enum.

## Решение

### 1. Initial projection и локальный selector

Host публикует следующие initial application values:

| Form      | Choice и производное значение                                                      | `choiceLockStatus`                          | Initial action keys |
| --------- | ---------------------------------------------------------------------------------- | ------------------------------------------- | ------------------- |
| `CHR-010` | `raceChoice:null`, `ancientOptionSerialized:false`, `raceConsequencesPreview:null` | `UNLOCKED`                                  | `004,005,006`       |
| `CHR-016` | committed `raceChoice=UNITED                                                       | FREE`, mode `null`, `modeConsequences:null` | `UNLOCKED`          | `003,004` |
| `CHR-036` | `diceInputMode:null`, `appliesToAllCreationRolls:true`                             | `UNLOCKED`                                  | `004,005`           |
| `CHR-002` | `statMethod:null`, `methodConsequences:null`                                       | `UNLOCKED`                                  | `003,004,005`       |

Каждая projection также содержит exact `characterDraftId`,
`wizardCheckpointId`, current `draftRevision` и `commandId:null`. Missing key,
omission вместо `null`, extra key и другой literal отклоняются.

`choiceLockStatus` имеет закрытый domain
`UNLOCKED | LOCKED_AFTER_RESULT | NOT_APPLICABLE`. Это application status, не
имя form state. Тем самым ADR 0034 initial `null` заменяется exact
`UNLOCKED`; строка `UNSELECTED` сюда не переносится.

Selector меняет только client-local draft и form state `SELECTED_UNLOCKED`;
wire, receipt, revision и durable write отсутствуют. Текстовое consequence
поле для выбранного значения равно exact selector label из Atlas, а не
придуманному описанию механики:

| Form      | Enum             | Exact local/derived text                 |
| --------- | ---------------- | ---------------------------------------- |
| `CHR-010` | `UNITED`         | `Выбрать Единого`                        |
| `CHR-010` | `FREE`           | `Выбрать Вольного`                       |
| `CHR-010` | `PURE`           | `Выбрать Чистого`                        |
| `CHR-016` | `MANUAL`         | `Выбрать ручное получение симбионтов`    |
| `CHR-016` | `RANDOM`         | `Выбрать случайное получение симбионтов` |
| `CHR-002` | `CLASSIC`        | `Выбрать классический метод`             |
| `CHR-002` | `ADVENTUROUS`    | `Выбрать авантюристский метод`           |
| `CHR-002` | `ALL_OR_NOTHING` | `Выбрать «Всё или ничего»`               |

Это только source-backed preview выбранной ветви. Дополнительные правила,
числа или последствия из соседних реестров этот PR не сериализует.

Host не знает client-local value до команды. Поэтому Web может материализовать
только соответствующий confirmation CTA из exact таблицы Atlas, если host
опубликовал capability `UI-CMD-CHAR-CREATION-SET-DECIDE`:

- `CHR-010 UNITED|FREE → CTA::001`, `PURE → CTA::002`;
- `CHR-016 MANUAL|RANDOM → CTA::001`;
- `CHR-036 AUTO|MANUAL → CTA::001`.

Confirm располагается перед selector keys по order
`ctaAvailabilityByAction`. Остальные host CTA клиент не выводит. Host заново
проверяет owner, current form, history, revisions, enum и destination; local
draft не даёт authority.

### 2. Exact command application payload

Existing wire v1 `command.request` не меняется. Для
`workflowCommandId=UI-CMD-CHAR-CREATION-SET-DECIDE` payload является recursively
exact union. Общие keys:

```text
{stage:"RACE_AND_METHOD",sourceFormId,characterDraftId,
 wizardCheckpointId,draftRevision,<one decision field>}
```

Разрешены ровно четыре варианта:

| `sourceFormId` | Единственный decision key | Domain   |
| -------------- | ------------------------- | -------- |
| `CHR-010`      | `raceChoice`              | `UNITED  | FREE        | PURE`           |
| `CHR-016`      | `symbiontAcquisitionMode` | `MANUAL  | RANDOM`     |
| `CHR-036`      | `diceInputMode`           | `AUTO    | MANUAL`     |
| `CHR-002`      | `statMethod`              | `CLASSIC | ADVENTUROUS | ALL_OR_NOTHING` |

Client не отправляет consequence text, lock status, fixed boolean или target.
Host выводит их из exact variant. Unknown command, `stage`, `sourceFormId`,
enum, смешанные decision keys, missing/extra key и неверный type получают явный
отказ с exact path/value. Другой workflow command и любой другой stage не
попадают в generic fallback.

### 3. Durable envelope и revisions

IDENTITY-only payload ADR 0033 §3 остаётся exact и неизменным. Первый
SET-DECIDE commit атомарно преобразует его в post-IDENTITY envelope:

```text
{identityStage:{request,derived,receipt,nextStageEnvelope},
 raceAndMethodStage:{
   race:{value,consequences,choiceLockStatus}|null,
   symbiontAcquisition:{value,consequences,choiceLockStatus},
   diceInput:{value,choiceLockStatus}|null,
   statMethod:{value,consequences,choiceLockStatus}|null,
   decisionRecords:[{request,derived,receipt,nextStageEnvelope}]},
 branchCacheEntries:[],selectedBranchUuidOrNull:null,randomReceiptIds:[],
 branchCacheHash:<HASH>,nextStageEnvelope:<latest>,receipt:<latest>}
```

`identityStage` навсегда сохраняет exact IDENTITY request, frozen identity
values, derived `PENDING_GM`/`STANDARD_HUMANOID`, receipt и `CHR-010`
destination. `decisionRecords` append-only и содержит каждый фактический
SET-DECIDE request, host-derived consequence/status, immutable receipt и его
signed destination. Top-level receipt/envelope обязаны совпадать с последней
actual record. Duplicate stage, command ID, receipt ID, gap либо mismatch
означает corruption и fail-closed.

`PURE` создаёт
`symbiontAcquisition={value:null,consequences:null,choiceLockStatus:"NOT_APPLICABLE"}`
в той же race transaction. Synthetic CHR-016 command/receipt не создаётся.
Для `UNITED|FREE` initial acquisition record имеет `value:null`, consequence
`null`, status `UNLOCKED` до собственного commit.

Branch cache и hash остаются exact empty значением ADR 0033, потому что эти
deterministic decisions не создают seed, roll или branch payload. Library
revision не меняется: DRAFT membership прежнее.

Каждый изменившийся actual decision даёт:

| Axis                                      | Delta |
| ----------------------------------------- | ----: |
| `draftRevision`                           |  `+1` |
| local-character `stateRevision`           |  `+1` |
| local-character `projectionRevision`      |  `+1` |
| local-character `actorVisibilityRevision` |   `0` |
| `checkpointRevision`                      |  `+1` |
| shell/library revisions                   |   `0` |

Все пределы preflight проверяются до `BEGIN IMMEDIATE`. Request несёт current
pre-commit `draftRevision` и persistent entity triple; receipt — post-commit
значения. Replay, refusal, stale, conflict, disconnect до commit и rollback
дают `+0`. Lookup `commandId` идёт до stale/guard checks и ищет IDENTITY плюс
все decision records; exact request возвращает прежний receipt, другой payload
даёт `IDEMPOTENCY_CONFLICT`.

### 4. Forward table, PURE и lock

| Decision            | Durable result                                          | Signed next form                            |
| ------------------- | ------------------------------------------------------- | ------------------------------------------- |
| Race `UNITED        | FREE`                                                   | race record; acquisition initial `UNLOCKED` | `CHR-016` |
| Race `PURE`         | race record; acquisition exact `NOT_APPLICABLE`         | `CHR-036`                                   |
| Acquisition `MANUAL | RANDOM`                                                 | acquisition record                          | `CHR-036` |
| Dice `AUTO          | MANUAL`                                                 | dice record                                 | `CHR-002` |
| Stat method         | method record + first addressed set request, atomically | `CHR-003`                                   |

Правило PURE живёт в обоих местах. Guard отказывает CHR-016 request, если
durable race не `UNITED|FREE`, а host routing для committed `PURE` подписывает
сразу `CHR-036`. CHR-016 payload, presentation и receipt при PURE отсутствуют.

SET-DECIDE переводит текущую form в `CHECKPOINTED`, но сам receipt неизменяем,
а `choiceLockStatus` остаётся `UNLOCKED` до result boundary. Будущая первая
committed/displayed set receipt переводит acquisition, dice и method в
`LOCKED_AFTER_RESULT`; после этого новая decision и safe return запрещены.
Race остаётся `UNLOCKED` до будущего final-save: её изменение требует нового
branch-change contract с сохранением provenance, а не перезаписи receipt.
`NOT_APPLICABLE` не является альтернативным выбором игрока.

В текущем срезе reverse branch change и первый result отсутствуют. Поэтому
повторная decision того же stage/active branch отклоняется и не переписывает
append-only record. Это negative lock invariant текущей реализации.

### 5. Граница `CHR-002 → CHR-003`

Atlas связывает `CHR-002::CTA::001` не только с method commit, но и с созданием
первого addressed set request и exact target `CHR-003`
([`transitions.json`, строки 9404–9409](../../generated/spec/atlas/transitions.json#L9404-L9409)).
Отделить receipt, остаться на `CHR-002` или подписать другой target нельзя.

Поэтому ADR определяет четвёртую строку durable table, но runtime этого PR
заканчивается на initial `CHR-002`. Её три selector работают local-only;
confirmation CTA capability исключена, а direct valid-looking CHR-002 command
получает `GUARD_REJECTED` с zero write. Реализация строки разрешена только
вместе с будущими CHR-003 request/projection и roll boundary.

Safe-return CTA четырёх форм также capability-excluded: reverse durable edit,
branch abandonment и signed recovery ещё не определены. Это явная граница, не
изменение Atlas guard.

## Совместимость и отвергнутые альтернативы

Selectors сохраняют ADR 0020, confirmation использует existing wire v1.
Один checkpoint ID, latest whole snapshot и checksum сохраняют ADR 0025 без
SQL migration. Persistent revisions остаются entity-owned по ADR 0031;
immutable IDENTITY stage сохраняет provenance ADR 0033. У ADR 0034 заменены
только status domain и selected/confirmation bridge, initial choice и
consequence остаются `null`.

Отвергнуты `choiceLockStatus:null` и form state вместо application status;
wire-трафик selector; оба confirm CTA одновременно; client-owned
target/status/consequences; только latest request без replay старых IDs;
synthetic CHR-016 для PURE; method commit без CHR-003 или с same-form target;
safe return без отдельного reverse/abandonment contract.

Exact Atlas IDs и labels закрывают client-local bridge без разбора свободной
guard-прозы. Append-only records сохраняют replay и provenance, а guard плюс
routing делают PURE проверяемым даже против forged client payload.

## Последствия

- Три durable SET-DECIDE commits проводят обычную и PURE ветви до initial
  `CHR-002`; четвёртый payload распознаётся, но остаётся guard-closed.
- Reconnect/replay восстанавливает latest signed form без повторной записи и
  сохраняет все прежние receipts.
- Первый future result обязан атомарно установить `LOCKED_AFTER_RESULT`; до
  него нельзя молча считать status locked.
- CHR-003, броски, характеристики, CHR-025, mass bounds и portrait mapping не
  входят в это решение.
