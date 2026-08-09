# ADR 0022 — Раздельные реестры handler'ов операций и правил

- **Статус:** принято
- **Дата:** 2026-08-09

## Контекст

Перед первым конкретным handler'ом движку нужен механизм регистрации и
диспетчеризации. Выбор одного общего ключа был бы архитектурным решением, а не
технической деталью: поставленные каталоги описывают разные идентичности.

- Executable Rules содержит 739 `RuleId`: 699 активных и 40 tombstone.
- Atlas содержит 106 `UI-CMD-*`; на wire-границе они уже типизированы ADR 0020.
- Character и Items содержат 45 ID с префиксом `OP-*` — 16 и 29
  соответственно. Их строки задают actor, command, context, inputs,
  preconditions, источники правил, переход/result и ошибки.
- Effects содержит ещё 25 `EffectOperationId` без префикса `OP-` и с другим
  набором колонок. Все 70 operation ID уникальны, типизированы generated-union'ами
  и встречаются в `forms-by-id.json.references.operationIds`.

Правило не является точкой входа один-к-одному. Из 699 активных правил формы
упоминают 198, а 501 не упоминают ни разу. Одна операция при этом может
использовать несколько правил, а одно правило — несколько операций.

Дополнительные границы исходных данных:

- Character использует шесть actor-строк: `PLAYER`, `PLAYER_OR_SYSTEM`,
  `SYSTEM`, `PLAYER_OR_GM`, `GM`, `SYSTEM_WITH_GM_CONFIRMATION`;
- Items использует семь других строк: `Игрок`, `Система`, `Мастер`,
  `Игрок/мастер`, `Игрок/НПС`, `Система/мастер`, `Игрок/мастер НПС`;
- три Atlas role — `player`, `gm`, `system` — не задают эквивалентность этим
  13 значениям;
- точное разбиение Character/Items `Rule IDs / source` только по `;` даёт 82
  уникальных raw-токена. Ровно 11 из них не являются одним активным `RuleId`:
  `Q-CORE-024`, `Q-CORE-051`, `Q-CORE-061`, `Q-APP-001`, `Q-APP-002`,
  `Q-GM-XP-001`, `Q-ENEMY-B14`, `USR-2026-07-30-XP-001`,
  `USR-2026-07-30-WEB-001`, `Manifest v1.2` и составной raw-токен
  `CQA-009\nCORE-204` с настоящим переносом строки;
- 16 Character operations уже определяют 51 уникальный `ERR_*`. Items и
  Effects описывают отказ другими схемами, поэтому это не общий словарь всех
  операций.

## Решение

### 1. Два реестра с разными обязанностями

В domain существуют два отдельных реестра.

`OperationHandlerRegistry` ключуется типом:

```ts
type OperationId = CharacterOperationId | ItemOperationId | EffectOperationId;
```

Он диспетчеризирует атомарную или оркестрирующую domain-операцию. Объединяется
только идентичность ключа; разные схемы actor, inputs, отказов и результата не
нормализуются в общий descriptor.

`RuleHandlerRegistry` ключуется `RuleId`. Он хранит переиспользуемые
механические вычисления. Operation-handler может вызвать ноль или несколько
rule-handler'ов; полнота operation-реестра не означает 699 placeholder-регистраций.

Оба типа ID импортируются из `generated/types/*`. Значение вне каталога не
принимается методом `register` на этапе компиляции. Литералы каталогов в source
не копируются.

### 2. Active и tombstone различаются до поиска handler'а

`RuleHandlerRegistry` классифицирует ID по generated-массивам
`TOMBSTONE_RULE_IDS` и `ACTIVE_RULE_IDS`, проверяя tombstone первым.

- handler для tombstone зарегистрировать нельзя;
- вызов tombstone отвечает, что правило существует и не автоматизируется;
- вызов активного правила без handler'а отвечает, что активный handler не
  зарегистрирован;
- эти отказы представлены разными типами ошибок;
- повторная регистрация operation или active rule отклоняется до замены уже
  зарегистрированного handler'а.

Tombstone тем самым присутствует в каталоге диспетчеризации, но не получает
исполняемый placeholder-handler. Это сохраняет смысл ADR 0011.

### 3. Registry не переопределяет transport и игровые отказы

`UI-CMD-*` не становится ключом domain-реестра. ADR 0020 остаётся без
изменений: workflow-command несёт `workflowCommandId`, а 11
`operation-command` идентифицируются на wire точным tuple
`{ from, to, kind, trigger }`. `operationId` в wire не добавляется и из текста
guard не извлекается. Будущий host adapter будет отображать уже проверенный
command reference в domain-operation отдельной задачей.

Registry не переводит 13 actor-строк в `AtlasRole`, не разбирает operation
payload и не вводит новых `ERR_*`. Ошибки duplicate/unregistered/tombstone —
типы инфраструктуры реестра, а не игровые operation error codes. Конкретный
handler в будущей задаче обязан сохранить error vocabulary своего артефакта.

Если будущая проверка разбирает `Rule IDs / source` по `;`, разрешены ровно 11
перечисленных raw-исключений. Любой двенадцатый токен должен дать отказ. Если
grammar отдельно разрешит перенос строки, это потребует явного решения, а не
permissive split.

### 4. Чистая и закрытая диспетчеризация

Handler получает caller-owned generic input и возвращает caller-owned output.
Порты, включая источник случайности ADR 0021, передаются вызывающей стороной в
этом input или замыкании handler'а. Registry не использует `fs`, сеть, SQL или
генерацию случайности.

Диспетчеризация не содержит `default:`, `??`-fallback, проглоченного `catch`,
catch-all handler или молчаливого no-op. Неизвестное всегда называет точный ID.

## Обоснование

Два реестра сохраняют две реальные семантики. Operation — спецификация use
case или атомарного изменения; rule — переиспользуемая механика. Отдельная
граница правил нужна также ADR 0021: будущий handler получает
source-neutral `MechanicalRoll`, а не transport/provenance envelope.

Численные утверждения проверены на committed `generated/spec` и закреплены
contract-тестом рядом с реестром:

- 16 + 29 + 25 = 70 уникальных operation ID, ровно тот же каталог, что в
  ссылках форм;
- 699 active, 40 tombstone, 198 упомянутых и 501 не упомянутых формами active
  rules;
- два несводимых actor-словаря 6 + 7;
- 82 raw source-токена и точный allowlist из 11 исключений;
- точный набор 51 Character `ERR_*`.

Compile-time fixtures с `@ts-expect-error` отдельно доказывают, что ID вне
generated-union не регистрируется. Runtime-тесты различают все виды отказа.

### Отвергнутые альтернативы

| Вариант                                           | Причина отказа                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Только `RuleId`                                   | Смешивает 739 карточек механик с 70 операциями; 501 active rule не имеет form entry point, а одна операция использует несколько правил                          |
| Только operation ID                               | Теряется переиспользуемая rule-boundary и требуемое ADR 0011 различие tombstone с незарегистрированным active rule                                              |
| Один реестр `RuleId \| OperationId \| UI-CMD-*`   | Пространства имеют разные источники, обязанности и виды отказа; union создаёт ложную взаимозаменяемость                                                         |
| Ключ `UI-CMD-*`                                   | Это transport vocabulary ADR 0020; у operation-command на wire идентичность — transition tuple, а не `operationId`                                              |
| Три operation-реестра по workbook                 | Привязывает runtime topology к форме поставки; формы используют единое поле `operationIds`, а source-specific descriptors можно сохранить без трёх dispatch API |
| Ограничить operation-реестр 45 `OP-*`             | Оставляет вне заявленного operation API 25 типизированных Effect operations, на которые прямо ссылаются формы                                                   |
| Нормализовать actor в три `AtlasRole`             | Артефакты не определяют такую эквивалентность                                                                                                                   |
| Зарегистрировать 699 placeholder-handler'ов       | Делает отсутствие реализации похожим на рабочий путь и создаёт фактический fallback                                                                             |
| Считать tombstone отсутствующим handler'ом        | Уничтожает различие, зафиксированное ADR 0011                                                                                                                   |
| Считать каждый `Rule IDs / source` одним `RuleId` | 11 точных raw-токенов не являются одним active `RuleId`; permissive parsing скроет drift                                                                        |

## Последствия

- `src/domain/rules` получает типизированный каркас, но ни одного конкретного
  operation- или rule-handler'а.
- Новая operation-группа расширяет generated union и становится доступна
  реестру без ручного каталога в domain source.
- Tombstone и незарегистрированное active rule различимы программно и в
  сообщении отказа.
- Конкретные input/output, actor authorization, operation error results и
  mapping из ADR 0020 остаются отдельными задачами.
- Изменение каталогов, actor vocabulary, source exceptions или Character
  error codes намеренно ломает contract-тест и требует пересмотра границы.
