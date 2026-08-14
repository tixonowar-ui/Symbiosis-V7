# ADR 0025 — checkpoint черновика персонажа и область восстановления

- **Статус:** Принято
- **Дата:** 2026-08-14
- **Область:** поставка v1.2
- **Источники:** Web UI Screen Atlas v1.2 — `REQ-053`,
  `J-AUTOSAVE-RECOVERY-EXIT`, формы `APP-009`, `CHR-001`, `CHR-026`,
  `CHR-039`, `CHR-040`, команды `UI-CMD-CHAR-WIZARD-CHECKPOINT` и
  `UI-CMD-LOCAL-CHECKPOINT-RESTORE`; All Questions and Answers Registry v1.2 —
  `Q-CAMP-009`, `Q-CHAR-002`; [ADR 0018](0018-current-state-storage-and-checkpoints.md)

## Контекст

[ADR 0018](0018-current-state-storage-and-checkpoints.md) задаёт один
`campaign_checkpoint`: `campaign_id` является PK/FK, а builder сохраняет снимок
с точной тройкой. Применённая
[`0001-initial`](../../src/persistence/migrations/0001-initial.ts) не даёт строке
отдельной идентичности или checksum.

`Q-CHAR-002.Ответ` в [`Реестр вопросов!G299`][qna] требует после подтверждения
атомарно сохранять черновик и восстанавливать random без reroll; сеть не нужна.
`G299` сохраняет не противоречащую поправке часть; `H299:I299` дают статус и
ссылку на последующий ответ.

Атлас объединяет `Q-CHAR-002` и `Q-CAMP-009` в
[`coverageRequirements[52]` (`REQ-053`)][atlas] и в
[`journeys[27]` (`J-AUTOSAVE-RECOVERY-EXIT`)][atlas];
[`forms[6]` (`APP-009`)][atlas] применяет recovery к `CHARACTER_DRAFT`,
`CAMPAIGN` и `LOCAL_OPERATION`. ADR 0018 реализовал только campaign-вариант.

Нормативные `guards`, `atomicity` и `reconnect` находятся в raw Atlas,
[`registryCoverage.workflowCommands[82]` и `[85]`][atlas].
QA-проекция сохраняет ID в `scope`, формы в `scenario` и склеенные
`atomicity + reconnect` в `expected` для
[`QA-WORKFLOW-UI-CMD-CHAR-WIZARD-CHECKPOINT`][qa] и
[`QA-WORKFLOW-UI-CMD-LOCAL-CHECKPOINT-RESTORE`][qa],
но не отдельные `guards`, `title` и структуру. Их импорт —
[issue #56](https://github.com/tixonowar-ui/Symbiosis-V7/issues/56); ADR цитирует
raw Atlas напрямую.

## Решение

### 1. Область механизма

**Вывод из источников.** `APP-009.purpose` и литерал
`checkpointEntityKind=CHARACTER_DRAFT|CAMPAIGN|LOCAL_OPERATION` в
[`forms[6].requiredFields`][atlas] задают один recovery-контракт для трёх видов.
Guard [`registryCoverage.workflowCommands[85]`][atlas] требует совпадения owner
и kind; общий протокол не делает владельцев взаимозаменяемыми.

`characterDraftId=characterUuid(immutable)` в [`forms[59].requiredFields`][atlas],
route [`forms[90]`][atlas] с `:localCharacterId` и `localCharacterUuid` в
[`forms[92].requiredFields`][atlas] связывают черновик с `local_character`.

**Проектный выбор.** Общими являются tagged API и dispatcher, но не таблица:

- `CAMPAIGN` продолжает использовать неизменённую `campaign_checkpoint`;
- `CHARACTER_DRAFT` получает `local_character_checkpoint` с внешним ключом на
  `local_character`;
- `LOCAL_OPERATION` распознаётся, но отклоняется до появления owner/FK;
- любое неизвестное `checkpointEntityKind` отклоняется с именем значения.

### 2. Идентичность и хранение версий

**Вывод из источников.** [`forms[6].requiredFields`][atlas] требует ID и
`checkpointRevision`, а [`forms[90].requiredFields`][atlas] — ID и
`lastCompleteCheckpointRevision`. Reconnect
[`workflowCommands[82]`][atlas] возвращает тот же checkpoint и выбирает
последний полный; retention, генерация ID и связь revision не заданы.

**Проектный выбор.** У черновика есть один стабильный непрозрачный
`checkpoint_id`: domain-owned `wizardCheckpointId` из payload, отличный от
`local_character_id`. Первый commit закрепляет его; дальнейший mismatch ID/owner
отклоняется. Хранится одна последняя полная версия, без истории.

Первый полный checkpoint имеет собственную `checkpoint_revision = 0`. Каждый
новый `snapshot_json` даёт `+1` внутри транзакции; caller не передаёт следующее
значение, overflow отклоняется, replay того же snapshot даёт `+0`. Оба имени
revision обозначают этот счётчик; он не равен `draftRevision` или корневой
тройке.

Tagged API для `CHARACTER_DRAFT` публикует `local_character_id` как
`checkpointOwnerId`, стабильный ID как `lastCompleteCheckpointId`, счётчик как
`checkpointRevision`. Для `CAMPAIGN` это соответственно `campaign_id`,
`campaign_id`, `stateRevision`; последний версионирует content, но вся скрытая
тройка всё равно проверяется. ID всегда используется вместе с kind.

Command receipt в payload сохраняет возвращённые ID/revision: старый `commandId`
возвращает ту же пару, не переписывая latest-row и не восстанавливая историю.

### 3. Контрольная сумма

**Вывод из источников.** `AUTOSAVE.result` в [`journeys[27]`][atlas] требует
whole-version snapshot с checksum. Guard [`workflowCommands[85]`][atlas]
проверяет `integrity/hash`, а forms отдельно называют `branchCacheHash`; это
разные хеши.

**Проектный выбор.** `local_character_checkpoint.snapshot_sha256` хранит
SHA-256 точных UTF-8 bytes `snapshot_json` в lowercase hex. Snapshot содержит
только object `localCharacter` с ID, lifecycle и исходной строкой payload без
parse/re-stringify; checksum не входит в preimage, ID/revision и тройка остаются
колонками.

Persistence строит строку и checksum в транзакции; restore проверяет hash,
builder equality и тройку независимо. `campaign_checkpoint` сохраняет ADR 0018
без новой колонки. Checksum проверяет целостность, но не authentication/MAC.

### 4. Corrupt tail и состояния восстановления

**Вывод из источников.** [`journeys[27]`][atlas] различает последний полный
snapshot и optional uncommitted intent; power loss оставляет старую или новую
версию, не смесь. [`workflowCommands[82]` и `[85]`][atlas] отбрасывают tail, а
при corrupt/missing full checkpoint дают только diagnostic и safe return.
Значит, tail находится вне `BEGIN IMMEDIATE`, а не внутри SQLite/WAL/snapshot;
валидная полная версия восстанавливается без reroll или partial restore.

**Проектный выбор.** Три литерала `restoreStatus` из
[`forms[6].requiredFields`][atlas] не отображены на пять состояний
[`coverageRequirements[52].expectedStateDeltas.terminalStatesByForm.APP-009`][atlas].
Принимается полное fail-closed отображение:

| Состояние `APP-009`    | `restoreStatus` | Семантика                                              |
| ---------------------- | --------------- | ------------------------------------------------------ |
| `CHECKING`             | `CORRUPT`       | Непроверенный кандидат не даёт CTA или destination     |
| `READY`                | `READY`         | Все persistence- и domain-проверки прошли              |
| `RESTORED`             | `RESTORED`      | Опубликованы та же receipt и подписанный destination   |
| `CORRUPT_TAIL_IGNORED` | `CORRUPT`       | Полный checkpoint валиден, tail отброшен               |
| `UNRECOVERABLE`        | `CORRUPT`       | Валидной полной версии нет; partial mutation запрещена |

`CORRUPT` в `CHECKING` — deny, не диагноз; authority определяется state.
`corruptTailIgnored=true` ставится только при реально отброшенном tail. Mismatch
запрошенных owner/kind/ID/revision даёт validation/conflict с zero-write;
missing или integrity failure сохранённой версии — `UNRECOVERABLE`. При missing
обычные поля не получают placeholder: публикуется diagnostic projection с
`CORRUPT`, safe return и без destination/mutation.

### 5. Два имени checkpoint ID

**Вывод из источников.** В [`forms[*].requiredFields`][atlas]
`wizardCheckpointId` входит в 32 формы, а `lastCompleteCheckpointId` — только в
`APP-009` и `CHR-026`; пересечения нет. Guards [`workflowCommands[82]` и
`[85]`][atlas] проверяют соответственно текущий wizard ID и revision последнего
полного checkpoint, но не задают равенство ID.

**Проектный выбор.** Оба имени обозначают стабильный `checkpoint_id` одного
черновика: wizard использует identity потока, recovery публикует её после
первого полного commit вместе с `checkpoint_revision`. `draftRevision` остаётся
payload-полем без отображения на persistence-счётчик.

### 6. Snapshot и игровое содержимое

**Вывод из источников.** `Q-CHAR-002.Ответ` в [`Реестр вопросов!G299`][qna]
перечисляет режимы, попытки, натуральные результаты, подтверждения критов,
принятый набор, назначения и случайные результаты. Guards/atomicity
wizard-команды в [`registryCoverage.workflowCommands[82]`][atlas]
требуют валидировать принадлежность receipts и lock результата, затем одним
commit сохранить целый этап, подписанный следующий этап, branch-cache hash и
receipt. Atomicity restore-команды в
[`registryCoverage.workflowCommands[85]`][atlas] запрещает mutation финального
листа.

**Проектный выбор.** Domain/host владеют game fields, locks, receipts,
`resumeFormId` и `branchCacheHash` внутри `local_character.payload_json`.
Persistence видит opaque JSON-object и владеет envelope, FK, ID/revisions,
checksum, builder и атомарной заменой.

До `READY` domain доказывает, что owner — незавершённый draft; final/deleted или
unknown отклоняется. Явное удаление атомарно удаляет checkpoint до FK и создаёт
новые character/checkpoint ID.

Литерал `branchCacheEntries[]` в [`forms[91].requiredFields`][atlas] задаёт tuple
`(branchUuid, branchKind, payloadHash, randomReceiptIds[], savedAtRevision)`, но
не алгоритм/SQL-схему. Checkpoint хранит payload/hash непрозрачно; кэш остаётся
отдельной задачей и не блокирует схему.

### Предписанная forward-миграция и транзакция

Будущая реализация добавляет `0002-local-character-checkpoint`. Она только
создаёт `local_character_checkpoint` со следующей оболочкой:

- `checkpoint_id TEXT PRIMARY KEY`;
- `local_character_id TEXT NOT NULL UNIQUE` с FK на `local_character` и
  `ON DELETE RESTRICT`;
- `checkpoint_revision INTEGER NOT NULL` в safe-integer диапазоне от нуля;
- `snapshot_json TEXT NOT NULL` с проверкой JSON-object;
- `snapshot_sha256 TEXT NOT NULL` с проверкой 64 lowercase hex символов;
- точная неотрицательная safe-integer тройка `stateRevision`,
  `projectionRevision`, `actorVisibilityRevision`.

Колонок для wizard-полей, branch cache, receipts или `resumeFormId` не
добавляется. В одном синхронном `BEGIN IMMEDIATE` выполняются подтверждённая
запись `local_character`, один флаговый advance корневой тройки, вычисленный
persistence advance `checkpoint_revision` и сборка snapshot/checksum. Первая
версия вставляется, следующие обновляют строку только при совпавших owner и
`checkpoint_id`; несовпадение и любая ошибка откатывают всё.

Решение не изменяет `0001`, структуру или поведение `campaign_checkpoint` и
контракт корневых ревизий из ADR 0018. Pure checkpoint refresh и idempotent
replay не увеличивают корневую тройку.

## Обоснование

Entity-specific таблица сохраняет настоящий FK без полиморфной ссылки или
придуманного owner для `LOCAL_OPERATION`. Стабильный ID и вычисляемая revision
дают оба поля Atlas без истории. Builder, checksum и транзакция оставляют
полный checkpoint единственной авторитетной границей.

Разделение envelope и payload повторяет ADR 0018, не отдаёт persistence игровые
guards и не заставляет domain собирать доверенную JSON-строку.

## Отвергнутые варианты

| Вариант                                     | Почему отклонён                                            |
| ------------------------------------------- | ---------------------------------------------------------- |
| Одна polymorphic checkpoint-таблица         | Нет entity-specific FK и owner для `LOCAL_OPERATION`       |
| Переиспользовать `campaign_checkpoint`      | FK требует несуществующую у черновика кампанию             |
| Изменить `0001` или campaign-строку         | Применённая миграция и ADR 0018 остаются неизменными       |
| Хранить историю всех checkpoint             | Источник требует последний полный, но не задаёт retention  |
| Новый checkpoint ID для каждой версии       | Пара ID + revision уже различает поток и версию            |
| Приравнять revision к `draftRevision`       | Такого отображения в источнике нет                         |
| Принимать готовый snapshot от domain        | Stale payload можно связать с текущей ревизией             |
| Использовать `branchCacheHash` как checksum | Атлас называет оба значения раздельно                      |
| Считать tail частью SQLite-строки или WAL   | Атомарный commit оставляет старую либо новую полную версию |
| Разложить game payload по колонкам          | Схему кэша/игровых полей пришлось бы придумать             |
| Блокировать решение до реализации `CHR-039` | Opaque payload сохраняет уже требуемые hash и receipts     |
| Реализовать `LOCAL_OPERATION` без owner     | Нарушило бы fail-closed и выдумало связь                   |

## Последствия и пересмотр

- Черновик получает независимый от кампании offline checkpoint; цена — ещё
  одна таблица и дублирование текущего состояния.
- История версий отсутствует: повреждение единственной полной версии даёт
  `UNRECOVERABLE`, а не неоговорённый откат на более старую.
- End-to-end переход в `READY` требует domain-проверок branch cache и receipts;
  этот ADR задаёт их атомарное хранение, но не реализацию `CHR-039`.
- `LOCAL_OPERATION` и неизвестный kind не получают fallback.

Решение действует только для поставки v1.2. Новый ADR обязателен, если новая
поставка определит другую identity/revision связь, checksum preimage, историю
версий, структуру branch cache, owner/storage для `LOCAL_OPERATION` или изменит
`Q-CHAR-002`, `Q-CAMP-009`, `REQ-053`, `APP-009`, `CHR-026` либо обе workflow-
команды. До пересмотра незнакомое значение или связь отклоняется, а не
подгоняется под этот контракт.

[atlas]: ../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json
[qna]: ../../artifacts/registries/Symbiosis_V7_All_Questions_and_Answers_Registry_v1.2.xlsx
[qa]: ../../generated/spec/atlas/qa-scenarios.json
