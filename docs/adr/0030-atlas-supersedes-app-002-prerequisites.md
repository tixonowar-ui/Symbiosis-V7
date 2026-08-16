# ADR 0030 — `APP-002` не требует `controllerSeat` и `connectionState`

- **Статус:** принято
- **Дата:** 2026-08-17
- **Заменяет:** привязку `controllerSeat` и `connectionState` к `APP-002` в
  [ADR 0027](0027-local-shell-context.md), весь его раздел 6 и оговорку
  «в `APP-002` запрещён» в строке `controllerSeat` таблицы раздела 7

## Контекст

### Вывод из источников

[Поставка атласа в PR #79][pr-79] изменила две формы. Новая запись `APP-002`
прямо говорит, что active `controllerSeat` и campaign authority не являются prerequisites в
[`$.forms[1].inputOwner`][atlas]. Её required fields теперь ровно
`contextId`, `stateRevision`, `projectionRevision`, `deviceId` в
[`$.forms[1].requiredFields[0..3]`][atlas]. `controllerSeat` и
`connectionState` там отсутствуют; это повторяет [`$.qaScenarios[42].scenario`][atlas].

`APP-004` подтверждает device-owned режим при `localOwnerIdOrNull=null` и
owner-bound режим при non-null значении в [`$.forms[3].purpose`][atlas] и
[`$.forms[3].inputOwner`][atlas]; exact shape дана в
[`$.forms[3].requiredFields[0..10]`][atlas].

Scan нового [`$.forms[0..375].requiredFields`][atlas] даёт:

- bare `controllerSeat` — 9 форм: `NET-003`, `NET-012`, `NET-017`, `CMP-009`,
  `GM-002`, `CMB-018`, `CMB-019`, `SYS-029`, `NET-028`;
- bare `connectionState` — 7 форм: `NET-002`, `NET-003`, `NET-005`, `NET-012`,
  `NET-017`, `CMP-009`, `GM-002`.

До поставки множества содержали 10 и 8 форм. Diff PR #79 удалил из обоих только
`APP-002`; lifecycle и записи оставшихся форм не изменены.

### Проектный выбор

ADR 0027 не редактируется и сохраняет историческое основание. Этот ADR заменяет
только его `APP-002`-specific утверждения о seat/connection. Отсутствие полей у
формы не переносится по аналогии и не меняет семантику величин.

## Решение

### 1. Разделы 1–3 ADR 0027 остаются в силе

**Вывод из источников.** Новый `APP-002` по-прежнему требует `contextId` и
`deviceId` в [`$.forms[1].requiredFields[0]`][atlas] и
[`$.forms[1].requiredFields[3]`][atlas]. Поставка не приравняла четыре величины.

**Проектный выбор.** Раздел 1 о четырёх независимых величинах, раздел 2 о
`contextId` и раздел 3 о durable `deviceId` действуют полностью. В частности,
`deviceId` остаётся locator, а не proof authority; именно так его применяет
[ADR 0028](0028-wire-v2-reconnect.md).

### 2. Разделы 4–5 сохраняют величины, но больше не применяют их к `APP-002`

**Вывод из источников.** Bare `controllerSeat` и `connectionState` остаются у
перечисленных выше 9 и 7 форм. Lifecycle `deviceAndLocalSeat` остаётся в
[`$.entityLifecycles[3]`][atlas]. Новый `APP-002.inputOwner`, напротив, явно
снимает seat prerequisite.

**Проектный выбор.** Entity, lifecycle и правила `controllerSeat` из раздела 4
остаются в силе для своих потребителей. Закрытый enum `connectionState` из
раздела 5 остаётся в силе для форм, перечисляющих это поле. Отменяются только:

- толкование старого `APP-002.inputOwner` через active local seat;
- применение `controllerSeat` к snapshot `APP-002`;
- фраза о `NO_TECHNICAL_SESSION` как начальном значении именно `APP-002`.

`APP-002` не передаёт эти keys как `null` или sentinel: она их не проецирует,
потому что их нет в новой required shape.

### 3. Раздел 6 ADR 0027 заменён целиком

**Вывод из источников.** Новый `inputOwner` снимает seat prerequisite, а
[`$.forms[1].transitionsIn[5].guard`][atlas] по-прежнему возвращает из `NET-002` при
`no technical session created`. Четыре поля формы заданы артефактом напрямую.

**Проектный выбор.** Больше не действуют ни список требований atomic snapshot
из раздела 6, ни запрет создавать presentation без заранее provisioned seat, ни
вывод о недостижимости пути и обязательном пересоставлении #62.
Отсутствие seat или NET connection само по себе не является основанием для
`NAVIGATION_UNAVAILABLE`.

Текущая shape всё равно обязана содержать четыре source-owned поля из
`$.forms[1].requiredFields[0..3]`: это новое основание, а не уцелевшая часть §6.

### 4. В разделе 7 заменена ровно одна оговорка; раздел 8 действует

**Вывод из источников.** Новый `APP-002` не объявляет bare `controllerSeat`,
поэтому Atlas больше не ставит для этой формы вопрос о nullability такого key.
Seat-related optional literals из раздела 7 остаются в
[`$.forms[127].requiredFields[2]`][atlas] и
[`$.forms[127].requiredFields[4]`][atlas].

**Проектный выбор.** В строке `controllerSeat` таблицы раздела 7 отменены только
слова «в `APP-002` запрещён». Остальная строка, запрет empty/zero UUID/`NONE`,
обязательность объявленного key и общий fail-closed принцип остаются в силе.
Именно эту дисциплину продолжает применять [ADR 0029][adr-0029].

Отсутствие key у `APP-002` не означает `controllerSeat=null` и не доказывает
отсутствие seat entity. Раздел 8 о границе wire и хранения остаётся в силе.

## Обоснование

### Вывод из источников

Изменение локально: diff удалил два поля у одной формы и добавил device-owned
режим соседней библиотеки. Определения, owners и lifetimes четырёх величин не
изменились; оставшиеся 9/7 bare-field consumers сохранены.

### Проектный выбор

Частичная замена сохраняет решения, на которые уже опираются ADR 0028 и 0029,
но не оставляет в силе ни одной предпосылки, снова блокирующей новый контракт
`APP-002`. Это уже не косметическая поправка текста: источник высшей текущей
версии формы теперь допускает путь, который раздел 6 запрещал.

## Отвергнутые варианты

**Вывод из источников.** Фактический delta не требует ни одного из расширений
ниже. **Проектный выбор.** Они не входят в точную частичную замену:

| Вариант                         | Почему отклонён                                                   |
| ------------------------------- | ----------------------------------------------------------------- |
| Отредактировать ADR 0027        | Принятое решение и его историческое основание должны сохраниться  |
| Оставить вывод раздела 6        | Он продолжил бы блокировать путь на отменённой предпосылке        |
| Отменить весь ADR 0027          | Поставка не меняла четыре величины и их владельцев                |
| Разрешить `controllerSeat=null` | Новая shape вообще не содержит key; null создал бы новый контракт |
| Убрать поля у остальных форм    | Только `APP-002` потеряла seat/connection fields                  |

## Последствия

### Вывод из источников

`APP-002` теперь достижима без seat и NET connection, но только с exact
`contextId`, revisions и valid durable `deviceId`. `APP-004` продолжает
device-owned путь отдельно от fail-closed owner-bound режима.

### Проектный выбор

- #62 больше не заблокирована разделом 6 ADR 0027; другие prerequisites задачи
  этим ADR не решаются.
- Реализация не должна создавать seat, `connectionState`, placeholder или
  скрытую mutation ради публикации `APP-002`.
- Любое дальнейшее изменение четырёх величин, их владельцев либо оставшихся
  форм требует отдельного решения, а не расширения этой отмены.

[adr-0029]: 0029-wizard-draft-initial-payload.md
[atlas]: ../../artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json
[pr-79]: https://github.com/tixonowar-ui/Symbiosis-V7/pull/79
