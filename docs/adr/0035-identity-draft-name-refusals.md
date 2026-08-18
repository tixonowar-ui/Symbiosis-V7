# ADR 0035 — Отказы валидации имени identity draft

- **Статус:** принято
- **Дата:** 2026-08-18
- **Частично заменяет:** name refusal branch в
  [ADR 0033 §1](0033-chr-001-identity-input-contract.md#1-runtime-draft-и-additive-wire-v2)
  и соответствующее отображение name validation в
  [ADR 0033 §2](0033-chr-001-identity-input-contract.md#2-canonical-values-ordering-и-revisions)

## Контекст

ADR 0033 запрещает в `name` C0/C1 controls и unpaired surrogate и требует от
одного до 64 видимых grapheme clusters. Однако закрытая ветвь
`INVALID_FIELD.error` для `name` содержит только `BLANK_AFTER_TRIM` и
`TOO_LONG`. Host не может точно объяснить три уже запрещённых класса input, не
нарушив closed union или не выдав неверную причину.

### Что следует из источников и принятого решения

Q-CHAR-001 требует обязательное имя, которое после удаления пробелов по краям
содержит 1–64 видимых символа:

- [`$.registryCoverage.qna[296]`, ключ `Q-CHAR-001`, строки 264088–264104](../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json#L264088-L264104);
- [`questions.json[296]`, ключ `Q-CHAR-001`, строки 2997–3004](../../generated/spec/qna/questions.json#L2997-L3004).

Источник не определяет Unicode counting unit, control/surrogate policy,
refusal taxonomy или precedence. ADR 0033 выбрал grapheme clusters, ECMAScript
`trim()`, запрет C0/C1 и unpaired surrogate, но его reason union не покрывает
собственную canonical validation.

На базовой ревизии `81960ca`, до реализации #97, shared-протокол ещё не содержит
ни сообщений `character.identity-draft.*`, ни старого или нового name reason
union. Следовательно, несовместимого deployed decoder нет; #97 обязан
реализовать уточнённый union сразу. Этот исторический факт не меняется после
добавления сообщений в том же PR.

## Решение

### 1. Exact reason union

Только name branch из ADR 0033 §1 заменяется на:

```text
{field:"name",reason:
  "BLANK_AFTER_TRIM" |
  "CONTROL_CHARACTER" |
  "UNPAIRED_SURROGATE" |
  "NO_VISIBLE_GRAPHEME" |
  "TOO_LONG"}
```

Три новых discriminators имеют разные причины исправления:

| Reason                | Значение и действие пользователя                             |
| --------------------- | ------------------------------------------------------------ |
| `CONTROL_CHARACTER`   | удалить C0/C1 control character                              |
| `UNPAIRED_SURROGATE`  | заменить повреждённую UTF-16 последовательность              |
| `NO_VISIBLE_GRAPHEME` | ввести хотя бы один видимый grapheme вместо одних ignorables |

`BLANK_AFTER_TRIM` и `TOO_LONG` сохраняют прежние значения. Все другие
application refusal branches ADR 0033 остаются без изменений.

### 2. Детерминированная validation и precedence

Host применяет шаги строго в следующем порядке; первый failed шаг определяет
единственный reason:

1. Вычислить ECMAScript `trim()` без Unicode normalization. Если результат —
   пустая строка, вернуть `BLANK_AFTER_TRIM`.
2. В trimmed string найти любой C0 code point `U+0000..U+001F` либо C1
   `U+007F..U+009F`; вернуть `CONTROL_CHARACTER`. Characters, уже удалённые
   `trim()`, до этого шага не доходят.
3. Проверить UTF-16 pairing. High surrogate `U+D800..U+DBFF` без следующего low
   surrogate и low surrogate `U+DC00..U+DFFF` без непосредственно
   предшествующего high дают `UNPAIRED_SURROGATE`.
4. Сегментировать `new Intl.Segmenter("und", {granularity:"grapheme"})`.
   Grapheme видим, если содержит хотя бы один Unicode code point, который не
   имеет свойство `White_Space` и не имеет
   `Default_Ignorable_Code_Point`. Если видимых graphemes нет, вернуть
   `NO_VISIBLE_GRAPHEME`.
5. Если видимых graphemes больше 64, вернуть `TOO_LONG`.
6. Иначе canonical name — trimmed string; validation успешна.

Invisible graphemes рядом с видимыми не увеличивают счётчик, но C0/C1 и
unpaired surrogate всегда отклоняются раньше. Grapheme, содержащий и visible,
и default-ignorable code points, считается одним видимым grapheme.

Обязательные boundary examples:

| Input после `trim()`                                      | Результат             |
| --------------------------------------------------------- | --------------------- |
| `"A"` — 1 visible grapheme                                | valid                 |
| ровно 64 visible graphemes                                | valid                 |
| ровно 65 visible graphemes                                | `TOO_LONG`            |
| только `U+200B ZERO WIDTH SPACE`                          | `NO_VISIBLE_GRAPHEME` |
| только `U+00AD SOFT HYPHEN`                               | `NO_VISIBLE_GRAPHEME` |
| любой оставшийся C0 `U+0000..U+001F`                      | `CONTROL_CHARACTER`   |
| любой C1 `U+007F..U+009F`                                 | `CONTROL_CHARACTER`   |
| unpaired high surrogate `U+D800..U+DBFF`                  | `UNPAIRED_SURROGATE`  |
| unpaired low surrogate `U+DC00..U+DFFF`                   | `UNPAIRED_SURROGATE`  |
| empty после `trim()`, даже если исходная строка не пустая | `BLANK_AFTER_TRIM`    |

### 3. Wire и handler ordering

Message discriminator `character.identity-draft.refusal`, `protocolVersion:2`
и additive wire-v2 extension ADR 0033 не меняются. Новые значения расширяют
только ещё не реализованный nested `error.reason` branch. Host и Web decoder
добавляют все три одновременно; unknown reason по-прежнему отвергается
fail-closed.

Lookup/idempotency и handler ordering ADR 0033 сохраняются дословно: exact
request comparison выполняется до scope/stale/field validation, а field
validation остаётся до overflow preflight и buffer replacement. Refusal не
меняет draft или revision и exact replay возвращает тот же reason.

## Совместимость с принятыми ADR

- **ADR 0020.** Closed decoding сохраняется; новый message type не добавлен,
  protocol version не изменён.
- **ADR 0028.** Additive v2 discriminator из ADR 0033 остаётся тем же; старый
  peer по-прежнему fail-closed отвергает неизвестный message discriminator.
- **ADR 0029.** `name:null` до input остаётся допустимым initial value и не
  проходит string validation.
- **ADR 0033.** Canonical trim/grapheme/control/surrogate policy, ordering,
  idempotency и revision matrix сохраняются. Заменены только неполный name
  reason union и его exact mapping.

## Обоснование

Одна общая ошибка `INVALID_NAME` скрыла бы разные действия пользователя и
затруднила бы отрицательные тесты. Три reason codes соответствуют трём
непересекающимся remediation: удалить control, исправить некорректную UTF-16
последовательность либо добавить видимый grapheme.

Явная precedence делает ответ независимым от реализации regex/Segmenter и
стабилизирует idempotent replay для строк, нарушающих несколько условий.

## Отвергнутые альтернативы

| Вариант                               | Причина отказа                                             |
| ------------------------------------- | ---------------------------------------------------------- |
| Оставить два reason                   | Невозможно честно кодировать три уже запрещённых класса    |
| Всё свести к `BLANK_AFTER_TRIM`       | Control/surrogate input может быть непустым                |
| Всё свести к `TOO_LONG`               | Даёт неверное исправление и ломает boundary semantics      |
| Один новый `INVALID_CHARACTER`        | Смешивает control, malformed UTF-16 и invisible-only input |
| Unicode normalization перед проверкой | ADR 0033 её прямо не вводит; меняется exact request/value  |
| Считать UTF-16 code units             | Противоречит принятому grapheme interpretation             |
| Изменить protocol version             | Message ещё не реализован; меняется только nested union    |

## Последствия

- #97 обязан добавить три reason literals в host и Web codecs одновременно.
- Негативные тесты покрывают C0, C1, обе стороны surrogate pair, `U+200B`,
  `U+00AD` и границы 1/64/65 visible graphemes.
- До реализации #97 ни один runtime handler не распознаёт новые reasons и host
  не должен их отправлять.
- Description/art/mass refusal branches и все revision/idempotency правила
  остаются прежними.
