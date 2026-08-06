# src/domain — правила слоя

Читать вместе с корневым [CLAUDE.md](../../CLAUDE.md).

Здесь живут игровые правила: движок, реестр handler'ов и жизненные циклы
сущностей. Слой **чистый** — без Fastify, без ws, без SQLite, без `fs`.
Всё внешнее приходит параметрами и уходит возвращаемым значением.

## Что откуда берётся

| Что                | Источник                                                    |
| ------------------ | ----------------------------------------------------------- |
| Правила и формулы  | `artifacts/registries/…Executable_Rules_Registry_v1.7.xlsx` |
| Навыки, симбионты  | `…Character_Skills_Symbionts_Registry_v1.2.xlsx`            |
| Предметы           | `…Item_Registry_v1.6_with_icons.xlsx`                       |
| Эффекты и болезни  | `…Effects_and_Diseases_Registry_v1.2.xlsx`                  |
| Бестиарий          | `…Canonical_Bestiary_Registry_v1.4.xlsx`                    |
| Разумный противник | `…Default_Sentient_Enemy_Registry_v1.2.xlsx`                |

Атлас (`artifacts/atlas/`) — источник по UI, **не** по механикам. Если правило
не найдено в реестре — остановиться и спросить, а не вывести из формы.

## rules/

Движок + реестр handler'ов. Атлас насчитывает **699 активных правил**,
**40 tombstone-правил**, **70 операций** и **106 workflow-команд**.

- Tombstone-правило — это явный отказ, а не отсутствие правила. Оно
  регистрируется и отклоняет вызов с указанием причины.
- Неизвестная команда или операция **отклоняется** (fail-closed). Реестр
  handler'ов не имеет ветки по умолчанию.

## entities/

19 жизненных циклов из `entityLifecycles` атласа. Одна папка — один цикл:

| Папка                              | entityLifecycle                 |
| ---------------------------------- | ------------------------------- |
| `local-character`                  | `localCharacter`                |
| `campaign-character-copy`          | `campaignCharacterCopy`         |
| `campaign`                         | `campaign`                      |
| `device-and-local-seat`            | `deviceAndLocalSeat`            |
| `group`                            | `group`                         |
| `npc`                              | `npc`                           |
| `enemy-template`                   | `enemyTemplate`                 |
| `item`                             | `item`                          |
| `symbiont`                         | `symbiont`                      |
| `effect`                           | `effect`                        |
| `long-rest`                        | `longRest`                      |
| `combat`                           | `combat`                        |
| `combat-actor`                     | `combatActor`                   |
| `roll-request`                     | `rollRequest`                   |
| `command`                          | `command`                       |
| `soundtrack-context`               | `soundtrackContext`             |
| `guardian-host-capture`            | `guardianHostCapture`           |
| `chimera-devouring`                | `chimeraDevouring`              |
| `plague-doctor-infection-registry` | `plagueDoctorInfectionRegistry` |

Переход состояния, не описанный в цикле, — ошибка, а не разрешённый случай.

## Тесты

`src/domain/**/*.test.ts`, рядом с кодом. Тест на правило ссылается на его ID из
Executable Rules Registry; тест на форму — на ID формы из атласа.
