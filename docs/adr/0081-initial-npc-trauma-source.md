# ADR 0081 — Исходные травмы постоянного NPC

- **Статус:** принято владельцем, source #228
- **Дата:** 2026-11-06
- **Основание:** issue #228, выбранное владельцем «Принять исходное состояние и поставку»
- **Дополняет:** ADR 0077 и 0078; прежние принятые ADR не переписываются
- **Граница:** источник NPC-016/017; runtime — отдельная реализация #187
- **Поставка:** Atlas 1.14/B9; результаты импорта и окончательных проверок фиксируются в PR

## Контекст и источники

NPC-016 задаёт исходные HP и типизированное состояние до сохранения постоянного
NPC. Effects/12 определяет TraumaInstance ровно из трёх полей:
`traumaInstanceId`, `regionId`, `traumaValue`. В этой записи нет доказательства
прошлого урона, расходования одноразового штрафа или времени оглушения.

CORE-119 и Q-CORE-033 складывают травмы одной конечности; при сумме >6
конечность не действует и даёт один общий штраф −5. COMB-029/030 сохраняют
раздельность зон; COMB-031 определяет композицию травмы с онемением и
независимость их снятия.

CORE-120 и Q-CORE-034 применяют штраф головы к первой следующей проверке,
включая защиту и реакцию. Действие без проверочного броска штраф не расходует.
При injury>6 возникает оглушение: пропуск следующего хода в бою либо пять
минут вне боя. CORE-121 при новом применении травмы корпуса один раз
дополнительно уменьшает HP. Эти правила не определяли, означает ли запись
на NPC-016 уже существующее состояние или новое сыгранное применение травмы.

TIME-004 требует точных календарных отметок. Q-CORE-063 сохраняет точный
остаток без округления; округление для отображения предстоящих ходов не
меняет сохранённый остаток. ADR 0078 связывает первое успешное сохранение
календарного состояния до Start с подтверждённым initial time.

## Принятое игровое решение

NPC-016 вводит **текущее исходное состояние**, не выполняет сыгранную
APPLY_TRAUMA. Мастер явно задаёт зону, resolved traumaValue и причину.
Фиктивные damageEventId, результаты R20/R12 и combat events не создаются.

Травмы конечностей сохраняют отдельные identities и штатную композицию
CORE-119/COMB-029..031. Введённый currentHP уже является итоговым исходным HP:
TORSO=3 при currentHP=7 сохраняет 7. Подготовка, preview, COMMIT, recovery и
N+1 не вычитают эти три HP повторно.

Для каждой HEAD мастер явно выбирает PENDING или CONSUMED одноразового
штрафа и отдельно ABSENT или ACTIVE оглушения. Значения по умолчанию не
выбираются. ACTIVE допускается только при traumaValue>6 и явном точном
остатке `0 < r <= 5` минут с действительной календарной привязкой. Для
traumaValue от0 до6 допустимы оба состояния штрафа, но только ABSENT
оглушения. При >6 допустимы все четыре сочетания; состояние штрафа не
выводится из состояния оглушения. Исходный CONSUMED не требует выдуманной
прошлой проверки.

GM-014 и новое применение травмы существующему actor сохраняют прежние
полномочия, guards и последствия CORE-117/119/120/121. Это решение не
изменяет боевую механику или право мастера и не превращает source Rule ID в
новый executable workflow.

## Закрытый технический ввод

Следующие имена и варианты — техническое представление принятого решения,
не новые игровые правила. `currentTraumas[]` сохраняет трёхпольную схему.
`traumaAuthoringChoices[]` содержит ровно одну запись на каждую заявленную
initial-trauma identity; дубли, foreign и orphan ссылки отвергаются.

```ts
type TraumaChoice = {
  traumaInstanceId: string;
  reason: string;
  consequence:
    | { kind: 'LIMB' }
    | { kind: 'TORSO'; hpInterpretation: 'CURRENT_HP_ALREADY_FINAL' }
    | {
        kind: 'HEAD';
        penalty: 'PENDING' | 'CONSUMED';
        stun: { status: 'ABSENT' } | { status: 'ACTIVE'; remainingMinutes: string };
      };
};
```

Каждый объект закрыт: отсутствующие, дополнительные, скрытые и accessor
поля не принимаются. `kind` согласуется с regionId. Идентификатор реально
выделен хостом и связан с владельцем/NPC; client не создаёт identity.
Причина обязательна и не состоит только из пробелов; она не заменяется
молчаливым default. Для ABSENT нет таймера; для LIMB/TORSO нет HEAD полей.
Маркер TORSO фиксирует интерпретацию HP и явно показан в UI.

В technical draft незаполненные поля остаются UNSET, введённые — ENTERED.
Частичный draft можно сохранить как ввод, но он не является валидным полным
исходным состоянием и блокирует forward/COMMIT с объяснением. Draft не
получает будущий COMMIT ID, audit timestamp или календарный origin fact.

### Точный десятичный остаток

`remainingMinutes` — canonical decimal string, не JSON number. Грамматика
полной строки: `(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?`. Знак, exponent,
пробелы, Unicode digits, ведущие нули и завершающие нули дробной части не
допускаются. JavaScript full-match вариант, исключающий final newline:

```js
/^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?(?![\s\S])/u;
```

После grammar check: `n` — целое из склеенных integer/fraction digits,
`d = 10^fractionLength`; ACTIVE требует `0 < n <= 5*d`. Проверка и
календарная арифметика точные рациональные, без Number/parseFloat и без
JSON float arithmetic. Допустимы `"0.5"`, `"1"`, `"5"`;
`"0"`, `"5.0000000000000000001"` и строки с newline отвергаются.
`"1.50"` неканонична, но её точное значение допустимо как `"1.5"`.
Это канонизация представления, не новый игровой шаг/минимальная доля минуты.
Существующие технические ограничения размера транспорта не меняются.

## Immutable authoring fact и readback

Полный source-linked fact хранится отдельно от TraumaInstance и не требует
нового общего snapshot format для каждой комбинации исходного состояния:

```ts
type InitialTraumaFact = {
  format: 'NPC_INITIAL_TRAUMA_V1';
  originKind: 'INITIAL_STATE_AUTHORING';
  scope: { campaignId: string; gmLocalContextId: string; ownerDeviceId: string };
  npcUuid: string;
  origin: {
    commitOperationId: string;
    sourceOperationId: string;
    version: number;
    committedAt: string;
  };
  trauma: { traumaInstanceId: string; regionId: string; traumaValue: number };
  reason: string;
  consequence: SealedConsequence;
};

type CalendarAnchor =
  | { kind: 'PRE_START_INITIAL'; campaignTimestamp: number; lobbySnapshotRevision: string }
  | { kind: 'CURRENT_CAMPAIGN'; campaignTimestamp: number; stateRevision: number };

type SealedConsequence =
  | { kind: 'LIMB' }
  | { kind: 'TORSO'; hpInterpretation: 'CURRENT_HP_ALREADY_FINAL' }
  | {
      kind: 'HEAD';
      penalty: 'PENDING' | 'CONSUMED';
      stun:
        | { status: 'ABSENT' }
        | { status: 'ACTIVE'; remainingMinutes: string; calendarAnchor: CalendarAnchor };
    };
```

Scope/author подтверждается сохранённой GM authority и настоящей operation,
а не значениями candidate. `sourceOperationId` указывает фактический
подтверждённый NPC-016 input в immutable attempt prefix. Origin COMMIT,
version и canonical UTC committedAt совпадают с реальной квитанцией.
Trauma и reason совпадают с подтверждённым вводом; неизвестные/изменённые
внутренние поля отвергаются. Canonical JSON/hash сами не доказывают authority.
Для ссылки достаточно пары `(commitOperationId, traumaInstanceId)`;
дополнительный случайный UUID этого fact не требуется.

PRE_START_INITIAL.lobbySnapshotRevision — SHA-256 string существующего
подтверждённого lobby snapshot. CURRENT_CAMPAIGN.stateRevision — числовая
GM presentation revision действующего codec, не checkpointRevision.

Только ACTIVE содержит обязательный calendarAnchor. При первоначальном
успешном COMMIT он равен фактической проверенной календарной привязке этого
COMMIT. Anchor обозначает время, **на которое заявлен остаток**, не момент
прошлого удара. Математический deadline равен `T+r` с точной рациональной
арифметикой; он не является независимо редактируемым полем.

Fresh writer использует отдельное checked pending evidence после реального
выделения audit. Историческое чтение принимает только committed operation;
будущий COMMIT не изображается уже записанным. При N+1 неизменённая trauma
identity сохраняет исходный fact, выбранное состояние и original anchor;
его origin не заменяется новым COMMIT и срок не начинается заново. Снятие
текущей травмы не удаляет исторические версии/facts или initial-time lock.

Если runtime представляет active stun в currentEffects, этот authoring fact
не заменяет полный Effects/12 EffectInstance: обязательны отдельный typed
codec, реальные identity/owner/source/time связи и source-backed capability
composition. Эта поставка не объявляет отсутствующий handler реализованным.

## UI, guards и атомарность

NPC-016 показывает настоящие controls зоны, resolved значения, причины,
penalty, stun и условного точного остатка. При ACTIVE показывается
подтверждённое время; никакой Number-конвертации дробного текста до проверки.
NPC-017 показывает введённое и итоговое HP, суммы конечностей, PENDING/CONSUMED,
таймер и ошибки каждого обязательного поля. Неполный ввод не скрывается
read-only summary или generic JSON editor.

Forward NPC-016→NPC-017 и COMMIT-V1/NEW-VERSION phase=COMMIT проверяют полный
закрытый ввод, current authority и attempt/version/calendar bindings.
Смена времени/ревизии требует нового preview; stale/foreign/changed request
даёт zero write. Уже сохранённый receipt-return и phase=OPEN не получают
требования заново заполненного input. Workflow IDs, source IDs и маршруты
не меняются; новой команды APPLY_TRAUMA этот авторинг не создаёт.

По ADR 0078 ACTIVE до Start создаёт фиксацию времени только при успешном
COMMIT. Draft, OPEN, cancel и отказ lock не создают. ABSENT и один pending
head penalty сами не требуют календарного lock; остальные состояния
проверяются по своим источникам. После Start используется текущий campaign
clock. Preview/replay/recovery/N+1 не повторяют урон корпуса, не восстанавливают
CONSUMED penalty и не перезапускают таймер. Старые FINAL, snapshots, receipts
и combat pins неизменны.

## Поставка и проверки

Atlas **1.14**, дата **2026-11-06**, сохраняет schemaVersion 1.2.0 и legacy
filenames v1.2. Состав: 376 forms, 1721 transitions, 66 journeys,
91 requirements, 115 workflows, 2452 QA и 1283 CTA. Исторические producer
graphDigest/contentDigest, workflow/source IDs и exact GM-014 сохранены.
CORE119/120/121 остаются system-only handlers, commandExposed=false.

| Свидетель      | SHA-256                                                          |
| -------------- | ---------------------------------------------------------------- |
| Atlas JSON     | badcb72c2667fd12ece51e782ab932600189ceeb0e3969b757a90717f112a47a |
| Atlas Markdown | 8b9438fcc70c37e2a0091de408403f689696f1b3a9b314b37816b1d36446d387 |
| CHECKSUMS / B9 | d19b288a208943da83b2e25569adfa96fc7ef7722d5539e776509ff19d4719b2 |

B8 manifest сохранён как `src/host/baselines/atlas-v1.13.checksums.sha256`.
По ADR 0071 добавляются только явные B0–B8→B9 и identity вместе со старыми
forward-парами. Для B0–B4 остаётся точное исключение трёх art paths ADR0077;
B5–B8→B9 не добавляет paths. 23 non-Atlas файла, Runtime Pack, игровые xlsx,
арт, 24 mechanical replay inputs и runtime tuple неизменны. Неизвестные,
обратные или повреждённые поставки отказывают. Старые FINAL, snapshots,
receipts, baseline IDs, восемь lineage patches и manifests не переписываются.
Девятый patch получен настоящим Git diff; generated создаётся только import.

Ожидаемый состав seed остаётся 115 tables / 20357 rows / 10 metadata,
поскольку массивы поставки не меняют длину. Это статическое ожидание,
а не заявление о выполненном импорте. Окончательные результаты author runs,
независимого exact-SHA review, чистых пяти стадий, CI и protected merge
фиксируются в PR. Source-поставка не завершает runtime #187/#113.

Отрицательные source guards должны ловить потерю обязательного выбора,
ACTIVE при value6/r=0/r>5/нет anchor, hidden ABSENT timer, округление/Number,
повторный урон TORSO и сброс original anchor/CONSUMED, изменение GM-014 или
зеркального guard. Runtime #187 отдельно доказывает реальные reservations,
COMMIT/replay/restart/N+1/time lock и foreign/stale/hash-valid tampering
настоящими writers/readers; source-поставка не заменяет эти проверки.
