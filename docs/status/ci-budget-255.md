# Локальные integration budgets после CI #255

## Отказ и границы измерения

CI run `42774082585` на `e407ff5ab4f49c5f182cb3b027372031a737431b`
завершил Tests с 7263 PASS и двумя timeout. Tests занял 4136,38 с, job —
около 74 минут при общем deadline 150 минут: это не отмена job по времени.
Полный локальный clean того же SHA ранее прошёл, включая 7265/290, repro324
и production E2E46 с отдельными HTML error/completion audit. CI остаётся
непройденным; локальный результат его не заменяет.

Raw CI и предыдущий #244 сохранены вне Git в `ci-evidence282-r4` и
`ci-evidence281`. Локальные exact repro и временное измерение фаз —
`evidence-255/ci-budget-*-unchanged01.*` и `ci-budget-owner-phase01.*`.
Последний добавлял только timing, вызывал настоящие действия и восстановил
исходные bytes обоих файлов; SHA до/после записаны отдельно.

| Измерение                          | Reported case, с | File aggregate, с | Run wall, с | Exclusive owner.submit, с |
| ---------------------------------- | ---------------: | ----------------: | ----------: | ------------------------: |
| Weapon, unchanged local            |            0,932 |              1,03 |        5,86 |                         — |
| Owner rollback, unchanged local    |           12,642 |             21,46 |       25,32 |                не измерен |
| Owner rollback, timing-only local  |           12,602 |             18,38 |       21,80 |                 2,8053409 |
| Weapon, предыдущий CI #244         |            0,635 |             6,582 |           — |                         — |
| Owner rollback, предыдущий CI #244 |           16,544 |           553,923 |           — |                неизвестен |
| Weapon, failed CI e407ff5          |           36,632 |            41,544 |           — |                         — |
| Owner rollback, failed CI e407ff5  |           46,144 |           499,891 |           — |                неизвестен |

Case duration может включать hooks/cleanup; это **не exclusive body/hook**.
Local file aggregate взят из footer `tests` одного выбранного case вместе с
beforeAll; CI file aggregate относится ко всем 20/219 case соответственно.
Точный CI stack доказывает BODY30s у weapon и HOOK30s в `ownerPreparation.submit`,
а не точную exclusive длительность этих фаз. В частности, 46,144 с нельзя
называть временем одного submit. Его 2,8053409 с измерены только локально.

Локальный submit завершился и выполнил реальные SELECTION, PREPARE_BATCH,
INTENT, ACKNOWLEDGE, pin и request advance. Assertions не выявили иной ошибки.
Доказательств устойчивой новой #255-стоимости в этих путях не получено;
конкретная причина CI-выброса не установлена. IO/CPU stall не объявляется
доказанным, и больший timeout не называется performance fix.

## Только два именованных бюджета

Основание полномочий — [ADR 0088, пункт 3](../adr/0088-verification-throughput-and-integration-budgets.md),
AGENTS 121–128 и [правила CI](../process/ci-checks.md#обоснованный-бюджет-отдельного-интеграционного-сценария).
Разрешены тело конкретного case и связанные только с ним локальные hooks.
Общий `beforeEach` расширять нельзя.

- В `creation-weapon-profile.test.ts` только
  `recovers safe-return, resume and accepted profiles after closing and reopening SQLite`
  получает BODY60s вместо стандартных 30s. Наблюдавшийся reported case 36,632 с
  укладывается с запасом 23,368 с; это граница наблюдения, не гарантия будущего CI.
- В `device-admission-candidate.test.ts` только
  `rolls back extra closures and both journals if the final owner guard fails`
  выполняет тот же `ownerPreparation.submit()` в guarded hook60s. Прежний
  shared hook30s пропускает работу только для этого имени. Следующий guarded
  hook делает submit только для него, до прежних publication/preparation hooks.
  Все остальные actual submit остаются в исходном hook30s. Один constant
  используется в test title и обоих взаимоисключающих guards; counter сбрасывается
  на каждом case, а обязательный `=== 1` guard запрещает stale owner и duplicate
  submission до публикации. Данные, порядок, SQLite isolation и assertions сохранены.

60s — конечный локальный запас для наблюдавшихся ограниченных timeout;
CI exclusive submit неизвестен, поэтому 46,144 с не используется как его
измерение. Для этого hook выбран двукратный запас к прежним 30s, также выше
наблюдавшегося reported whole case46,144s; это не оценка exclusive фазы.
Другие hooks, body остальных case, defaults, workers/retries, CI и
production timeouts не меняются. Зависание, resource failure или отсутствие
завершения по-прежнему блокируют принятие. Универсальная достаточность 60s
не заявляется; новый SHA требует полного clean и полного CI.

Проверка коррекции охватывает оба whole affected файла, включая все остальные
real owner fixtures и exactly-once guard: PASS239/2, run397,02s со штатным
параллелизмом. Reported weapon/owner cases — 0,423/12,627s, не exclusive фазы.
Авторский targeted прогон не заменяет
новую root-приёмку точного committed SHA.
