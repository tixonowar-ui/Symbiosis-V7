# 0006 — Реестры handler'ов операций и правил, каркас

- Веха: **M3**
- Размер: средняя
- ADR: **0022**
- Метки: `task`, `M3`

## Контекст

`src/domain/rules/` пуст. Нужен каркас регистрации и диспетчеризации, **без
реализации конкретных правил**.

Ключевое свойство — реестр не имеет ветки по умолчанию. Неизвестное
отклоняется с указанием точного ID.

## Чем ключуется реестр

Первоначальное требование регистрировать handler по `RuleId` не подтверждается
артефактами. Решение принимает [ADR 0022](../adr/0022-operation-and-rule-handler-registries.md).

| Пространство           |                     Количество | Назначение                               |
| ---------------------- | -----------------------------: | ---------------------------------------- |
| `RuleId`               | 739: 699 active + 40 tombstone | карточки механик                         |
| `UI-CMD-*`             |                            106 | transport-намерения ADR 0020             |
| Character/Items `OP-*` |                    45: 16 + 29 | prefixed operation specifications        |
| Effects operation IDs  |                             25 | operation specifications с другой схемой |

Все 70 operation ID типизированы generated-union'ами и встречаются в ссылках
форм. Из 699 активных правил формы упоминают 198; 501 не имеет form entry
point. Поэтому ADR 0022 разделяет operation-dispatch и переиспользуемые
rule-handler'ы.

Operation-строка уже задаёт спецификацию handler'а. Например,
`OP-CHAR-CREATE` содержит actor `PLAYER`, command `CREATE_CHARACTER`, context,
inputs, preconditions, применяемые правила, state transition и существующие
коды ошибок.

## Границы исходных словарей

### Actor

Character использует шесть значений:

`PLAYER`, `PLAYER_OR_SYSTEM`, `SYSTEM`, `PLAYER_OR_GM`, `GM`,
`SYSTEM_WITH_GM_CONFIRMATION`.

Items использует семь других:

`Игрок`, `Система`, `Мастер`, `Игрок/мастер`, `Игрок/НПС`, `Система/мастер`,
`Игрок/мастер НПС`.

Три роли Atlas (`player`, `gm`, `system`) не задают отображение этих 13 строк.
Склеивать словари нельзя.

### `Rule IDs / source`

Точное разделение только по `;` даёт 82 unique raw-токена. Ровно 11 не
являются одним active `RuleId`:

- `Q-CORE-024`
- `Q-CORE-051`
- `Q-CORE-061`
- `Q-APP-001`
- `Q-APP-002`
- `Q-GM-XP-001`
- `Q-ENEMY-B14`
- `USR-2026-07-30-XP-001`
- `USR-2026-07-30-WEB-001`
- `Manifest v1.2`
- одна запись с переносом строки `CQA-009` / `CORE-204`

Allowlist точный: любой новый raw-токен обязан ронять проверку.

### Коды ошибок

Character operations уже определяют 51 уникальный `ERR_*`. Новые коды
registry не придумывает. Items и Effects описывают failure другим форматом;
унифицировать их без отдельного решения нельзя.

## Tombstone

40 tombstone-правил выгружены как `TOMBSTONE_RULE_IDS`; active — как
`ACTIVE_RULE_IDS`. Tombstone — не пробел, а явный отказ: «правило существует и
не автоматизируется». Это иной результат, чем «active handler не
зарегистрирован», по [ADR 0011](../adr/0011-not-modeled-stays-tombstone.md).

Статус и режим реализации совпадают 1:1: 699 `Активно` / `Реализовать в
игровом ядре` и 40 `Не автоматизируется` / `Не реализовывать в
Windows-приложении`. Третьей категории нет.

## Критерии приёмки

- [ ] ADR 0022 принят; ключи и отвергнутые альтернативы записаны
- [ ] Operation-handler регистрируется по union generated operation ID
- [ ] Rule-handler регистрируется по `RuleId` из generated types
- [ ] ID вне generated-каталога — ошибка компиляции
- [ ] Регистрация handler'а на tombstone — отказ
- [ ] Вызов незарегистрированного active rule — отказ с ID
- [ ] Вызов tombstone — иной отказ: правило существует и не автоматизируется
- [ ] Двойная регистрация — отказ без замены первого handler'а
- [ ] Ветки `default:` и fallback отсутствуют
- [ ] Actor-словари и failure schemas не склеены
- [ ] Слой чистый: без `fs`, сети, SQL и генерации случайности
- [ ] Тесты покрывают успешную диспетчеризацию и все виды отказа

## Чего касаться нельзя

- `artifacts/**`, `generated/**`
- конкретные правила и operation payloads
- ADR 0011, 0020, 0021
- mapping wire transition tuple в domain operation

## Как проверяется результат

```bash
npm run verify
```

## Источники

- `generated/types/rules.ts`
- `generated/types/character.ts`
- `generated/types/items.ts`
- `generated/types/effects.ts`
- `generated/spec/character/operations.json`
- `generated/spec/items/operations.json`
- `generated/spec/effects/operations.json`
- `generated/spec/atlas/forms-by-id.json`
