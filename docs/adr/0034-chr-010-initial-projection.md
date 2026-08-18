# ADR 0034 — Начальная проекция CHR-010

- **Статус:** принято
- **Дата:** 2026-08-18
- **Дополняет:** [ADR 0029](0029-wizard-draft-initial-payload.md) для
  начального wizard payload и
  [ADR 0033](0033-chr-001-identity-input-contract.md) для доставки после
  identity checkpoint

## Контекст

После первого durable identity checkpoint host обязан доставить полный snapshot
`CHR-010`. Atlas требует восемь form-specific полей, но не задаёт начальные
значения `raceConsequencesPreview` и `choiceLockStatus`. Без exact shape host и
Web могли бы независимо выбрать несовместимые placeholder values.

Тот же первый snapshot обязан исчерпывающе назвать доступные действия. Guard
safe-return `CHR-010::CTA::003` после identity checkpoint истинен, однако
возврат ведёт к редактированию уже persistent identity. Такой lifecycle в
принятых решениях отсутствует.

### Что следует из источников и принятых решений

`CHR-010` — `$.forms[60]`. Atlas перечисляет exact required keys, но для двух
спорных полей даёт только имена:

- [`$.forms[60].requiredFields[0..7]`, строки 54916–54924](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L54916-L54924);
- [`forms.json[60].requiredFields[0..7]`, строки 27750–27758](../../generated/spec/atlas/forms.json#L27750-L27758).

Начальное состояние формы называется `UNSELECTED`, а `SELECTED_UNLOCKED`
появляется после выбора и показывает последствия до первого результата:

- [`$.forms[60].states.UNSELECTED/SELECTED_UNLOCKED`, строки 55443–55445](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L55443-L55445);
- [`forms.json[60].states.UNSELECTED/SELECTED_UNLOCKED`, строки 27764–27767](../../generated/spec/atlas/forms.json#L27764-L27767).

QA также требует показать последствия расы до продолжения, но не определяет
initial preview shape:

- [`$.qaScenarios[148]`, ключ `QA-FORM-CHR-010`, строки 228042–228045](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L228042-L228045);
- [`qa-scenarios.json[148]`, ключ `QA-FORM-CHR-010`, строки 891–894](../../generated/spec/atlas/qa-scenarios.json#L891-L894).

Три same-form selector transition имеют kind `local-draft-command` и выбирают
ровно `UNITED`, `FREE` либо `PURE`:

- [`$.transitions[1638..1640]`, строки 226913–226932](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L226913-L226932);
- [`transitions.json[1638..1640]`, строки 11469–11488](../../generated/spec/atlas/transitions.json#L11469-L11488).

Safe-return tuple однозначен: target `CHR-001`, guard `first creation result
absent; identity checkpoint preserved`, kind `safe-return`:

- [`$.forms[60].actions.ctaAvailabilityByAction[2]`, строки 55131–55136](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L55131-L55136);
- [`forms.json[60].actions.ctaAvailabilityByAction[2]`, строки 27342–27402](../../generated/spec/atlas/forms.json#L27342-L27402);
- [`$.transitions[1337]`, строки 224806–224811](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L224806-L224811);
- [`transitions.json[1337]`, строки 9361–9367](../../generated/spec/atlas/transitions.json#L9361-L9367).

`CTA::001/002` требуют committed race и ведут в `CHR-016`/`CHR-036`:

- [`$.forms[60].actions.ctaAvailabilityByAction[0..1]`, строки 55006–55074](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L55006-L55074);
- [`forms.json[60].actions.ctaAvailabilityByAction[0..1]`, строки 27217–27340](../../generated/spec/atlas/forms.json#L27217-L27340).

[ADR 0029](0029-wizard-draft-initial-payload.md) задаёт `null` для ещё не
введённого `raceChoice` и отсутствие текущей команды. [ADR 0033](0033-chr-001-identity-input-contract.md)
переносит в receipt текущий `draftRevision`, IDs draft/checkpoint и завершает
pre-commit runtime draft при successful checkpoint. [ADR 0026](0026-form-authority-and-navigation-wire.md)
требует host-owned action filtering и не позволяет клиенту выводить target из
известного tuple.

### Что источники не решают

Raw и generated Atlas не задают:

- JSON type, shape или default для `raceConsequencesPreview`;
- value domain и initial value для `choiceLockStatus`;
- восстановление durable identity в редактируемый `CHR-001` draft;
- revision, checkpoint, cancel, reconnect и replay semantics повторной записи
  identity stage.

Следующий раздел — проектный выбор, а не расшифровка скрытого source enum.

## Решение

### 1. Exact initial payload

Первый full snapshot `CHR-010`, доставленный после terminal identity checkpoint
result/replay, содержит все восемь ключей:

| Поле                      | Exact initial value                                       |
| ------------------------- | --------------------------------------------------------- |
| `characterDraftId`        | exact ID из checkpoint receipt                            |
| `raceChoice`              | JSON `null`                                               |
| `ancientOptionSerialized` | boolean `false`                                           |
| `raceConsequencesPreview` | JSON `null`                                               |
| `choiceLockStatus`        | JSON `null`                                               |
| `wizardCheckpointId`      | exact checkpoint ID из receipt                            |
| `draftRevision`           | current confirmed value из receipt; не сбрасывается в `0` |
| `commandId`               | JSON `null`                                               |

Оба новых `null` означают отсутствие производного значения до выбора расы.
Keys присутствуют: omission, `{}`, `[]`, пустая строка, `"UNSELECTED"` и
`"UNLOCKED"` запрещены. `UNSELECTED` остаётся именем состояния формы; этот ADR
не приравнивает его к value domain `choiceLockStatus`.

Initial payload публикуется как state `UNSELECTED`. После selector action
начальные `null` уже не являются default для selected projection; exact preview
и lock value следующего состояния должны происходить из отдельного контракта,
а не из fallback этого ADR.

### 2. Exact initial actions

Начальный `presentation.base.availableActionKeys` содержит ровно и в source
order:

```text
["CHR-010::CTA::004","CHR-010::CTA::005","CHR-010::CTA::006"]
```

Это client-local selectors ADR 0020. Нажатие выбирает local `raceChoice` и не
создаёт wire message host.

`CHR-010::CTA::001/002` отсутствуют: их guards требуют committed choice, а их
targets `CHR-016` и `CHR-036` не входят в executable capability этого среза.

`CHR-010::CTA::003` также отсутствует, хотя source guard истинен. Причина —
явная implementation boundary **persisted identity re-entry**: ADR 0033
заканчивает pre-commit draft при successful checkpoint, а повторное
редактирование durable identity и re-checkpoint не определены.

Это capability exclusion текущего среза, не переопределение guard и не удаление
action из Atlas. Intent с current projection revision и `CTA::003` отклоняется
как `NAVIGATION_UNAVAILABLE`; stale intent раньше отклоняется как
`STALE_PROJECTION` по порядку ADR 0026. В обоих случаях прежние presentation и
browser history сохраняются, payload `CHR-001` не публикуется.

Safe-return можно включить только после отдельного решения, которое целиком
задаст durable draft reconstruction, replacement write, revision matrix,
checkpoint identity/replay, cancel и reconnect. Простая навигация в read-only
`CHR-001` либо повтор первого checkpoint по аналогии запрещены.

## Совместимость с принятыми ADR

- **ADR 0020.** Selector actions остаются client-only и не расширяют wire.
- **ADR 0025.** IDs и checkpoint revision не создаются повторно при delivery.
- **ADR 0026.** Host публикует только capability-supported actions; direct
  unavailable intent не раскрывает target payload.
- **ADR 0029.** Явные `null` и отсутствие standing command сохраняются.
- **ADR 0033.** Delivery использует exact receipt IDs/current draft revision;
  lifetime pre-commit draft не продлевается после checkpoint.

## Обоснование

`null` сохраняет стабильную required-key shape и честно выражает отсутствие
производного значения. Любой object/array/string потребовал бы придумать
неизвестный source domain. Отдельные action keys уже однозначно показывают, что
три выбора разблокированы, поэтому `choiceLockStatus` не должен дублировать это
неподтверждённым enum.

Исключение safe-return меньше по смыслу, чем фиктивный repeat-checkpoint:
первое честно называет неготовую capability, второе создало бы новый persistence
и replay contract без владельца revisions.

## Отвергнутые альтернативы

| Вариант                                        | Причина отказа                                                 |
| ---------------------------------------------- | -------------------------------------------------------------- |
| Опустить два неизвестных key                   | Нарушает exact required payload shape                          |
| `{}`/`[]` для preview                          | Source не задаёт структуру или семантику элементов             |
| `choiceLockStatus="UNSELECTED"`                | Смешивает form state с неописанным payload domain              |
| `choiceLockStatus="UNLOCKED"`                  | Изобретает отсутствующий source literal                        |
| Публиковать safe-return как обычную navigation | Обходит durable edit/re-checkpoint boundary                    |
| Повторить первый checkpoint тем же контрактом  | Первый контракт создаёт row; update/replay revisions не заданы |
| Молча убрать `CTA::003`                        | Скрывает истинный source guard и причину capability exclusion  |

## Последствия

- Issue #97 получает exact decodable destination snapshot без placeholder.
- Начальный `CHR-010` показывает три selector CTA и не отправляет их host.
- Target-only payload `CHR-001`, `CHR-016` и `CHR-036` в этом состоянии
  отсутствует.
- Persisted identity нельзя редактировать из `CHR-010` до отдельного ADR;
  попытка прямого intent безопасно отклоняется.
- Этот ADR не определяет selected/confirmed race projection и не создаёт
  workflow-command для следующего этапа.
