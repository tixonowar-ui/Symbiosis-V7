# ADR 0080 — Источник аварийного восстановления единственной GM authority

- **Статус:** принято владельцем; source-поставка #221, часть 3
- **Дата:** 2026-11-05
- **Дополняет:** ADR 0071, 0073, 0075, 0077, 0078 и 0079
- **Граница:** source-поставка B8; runtime — #215

## Контекст

Q-CAMP-009 предписывает аварийный failover из точного checkpoint, в том
числе с замороженной незавершённой операцией. Прежние NET-024/026 требуют
sole current GM даже при конфликте или недоступности прежнего host.
Обычная передача по ADR 0079 сохраняет этот current-GM guard и сама
по себе не даёт права восстановить authority без доступного старого GM.

Владелец отдельно принял frozen recovery с текущим паролем GM и проверенным
полным checkpoint, совместимым с подтверждёнными receipts. Эта поставка
завершает source-части #221 после B6/B7. Она не завершает runtime #215
и не разрешает продолжать игру при произвольном разделении сети.

## Решение

### Ограниченный вход и доказательство состояния

NET-008 имеет явный control входа в NET-026 при недоступном old host;
конфликт authority также ведёт в NET-026. Новый frozen context предоставляет
только evidence и blockers восстановления. Route, системная роль,
наличие локального checkpoint и знание пароля не являются GM authority.

Оператор проверяет полный checkpoint, его provenance и совместимость
со всеми принятыми receipts. NET-024 приватно проверяет текущий пароль
GM и выбранное paired/authenticated устройство преемника. Предварительно
выданный отдельный recovery token не требуется. Полученный UNLOCK token
остаётся bound capability конкретной попытки и также не выдаёт authority.

CMP-010 допускает только scoped FROZEN_RECOVERY_READ_ONLY для evidence;
обычный GM-вариант и его guards сохраняются. Recovery view не открывает
игровые mutations, посторонние GM-private данные, пароль или private keys.
Выбор checkpoint в форме не объявляет его нормативным без проверки.

### Отказ вместо выбора истории

Противоречащие друг другу receipts или checkpoint histories автоматически
не выбираются и не сливаются. Недостаточная полнота, несовместимые committed
операции или unresolved authority fencing сохраняют freeze. Пароль без
доказанного состояния недостаточен. Нельзя утратить committed receipt,
принять старого host как второго мастера или разрешить unilateral recovery
только потому, что связь с ним отсутствует.

Обычная передача сохраняет свои safe-boundary/pending-operation guards.
В recovery незавершённая операция может быть частью полного frozen checkpoint:
она остаётся на точном подтверждённом этапе. Новый conflicting in-flight write
запрещён. Уже показанные броски и receipts не повторяются, подтверждённые
расходы не списываются вновь. Новые clock, scene, actors и игровые результаты
из самого факта восстановления не создаются.

### Преемник и общий commit

Recovery использует тот же successor-side ACK, новый successor-local
credential и common COMMIT, что ADR 0079. Pre-existing GM role и PC у
выбранного paired/authenticated устройства не требуются. Оно явно
принимает точный checkpoint; до общего commit игровые GM capabilities
отсутствуют. Смена target/revision не переиспользует прежний token или ACK.

Различается право инициатора: вместо недоступного sole GM действует
проверенный оператор scoped frozen recovery. Оно ограничено этой процедурой.
Общий commit допустим лишь когда можно доказать единственность новой
authority и сохранение всей подтверждённой истории. Иначе freeze продолжается.
ACK, пароль, checkpoint selection и навигация сами по себе grant не создают.

После доказанного commit новый host использует собственную installation
identity, новый credential и тот же проверенный checkpoint. Обычный запрет
подмены pinned identity сохраняется. Проверенное уведомление и явный
transfer reconnect работают по ADR 0079, без нового admission, copies,
повторных gameplay receipts или копирования private key старого host.

### Выход, replay и restart

CANCEL до общего commit инвалидирует pending transfer и подтверждения,
возвращая в тот же recovery context. Возврат в NET-026 или к потерянному
соединению сохраняет freeze и не направляет неавторизованного оператора
в GM-001. DECLINE преемника также не активирует authority.
Для frozen инициатора после DECLINE/CANCEL terminal receipt есть отдельный
bound возврат в NET-026; role-neutral APP-001 не подменяет этот recovery exit.

Exact authenticated replay возвращает receipt своей фазы. Changed/stale/
foreign запрос и invalid proof не пишут ничего. Restart восстанавливает
подтверждённый этап и blockers; потеря ACK не создаёт повторный grant.
Terminal receipt доступен только связанному аутентифицированному участнику,
а дальнейший маршрут определяется подтверждённой current role.

## Поставка и совместимость

Это отдельная source-поставка B8 с обычным лимитом размера. Она дополняет
NET-008/024/025/026, scoped CMP-010 и соответствующие graph/workflow,
journey/requirement/QA/Q&A mirrors; общие команды ADR 0079 переиспользуются.
Параметры принятого источника, byte seals и CHECKSUMS приведены ниже.
Фактический импорт и приёмочные проверки подтверждаются отдельно. Другие
реестры, Runtime Pack, арт и механические правила этим решением не меняются.

Совместимость остаётся точной по ADR 0071: старые manifests и ранее принятые
пары сохраняются; добавляются только явные B0–B7 → B8 и тождественное чтение.
Для B0–B4 остаются только три точных art paths по ADR 0077; B5–B7 → B8
не добавляет paths. 24 mechanical replay inputs, runtime tuple и остальные
артефакты сохраняются. Неизвестные/обратные версии или иной drift отклоняются.
Saved snapshots, FINAL, checkpoints, receipts и baseline IDs не переписываются.

Generated обновляется только импортом. Источник проходит отдельные
независимое ревью, чистый полный gate, CI окончательного SHA и squash merge
с проверкой дерева main. #221 закрывается после фактической приёмки всех
трёх source-поставок; runtime #215 остаётся открытой до собственной реализации
и полной проверки.

## Параметры поставки и проверка

База B7 определена точными файлами
Atlas JSON `2a31ca54a27096f0b8a704c59a38e7c16cbf585def5211e7a3700a0db8799deb`,
Markdown `53be8e781e116e9467f3a90fedd240884f4875884c2de7056a1bda0ee411d1ea`
и CHECKSUMS `00cf6b3773528c767d3e1b05488a521497745b2e8d6a7d0c5ab1667b7424bacc`.
Git-база после squash PR #223: `6323eb00d2f95b9246d6fefd58e83c3e0e145ad6`,
проверенное дерево `fd81358a845451f2fd9d5c1531d010dea52dc486`. B8 импортирован
из этой основы; clean gate и CI подтверждаются отдельно. Принятое продуктовое
решение не является результатом приёмочных проверок.

| Свидетель                                     | Источник                                                         |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Atlas / дата                                  | 1.13 / 2026-11-05                                                |
| Forms / transitions / journeys / requirements | 376 / 1721 / 66 / 91                                             |
| Workflow / QA / CTA                           | 115 / 2452 / 1283                                                |
| Atlas JSON SHA-256                            | 7ba06a64842204b0df1e1ca5e21403093d66beb702a8bb156ea6b2f34a0695e8 |
| Atlas Markdown SHA-256                        | e9d130077f6d3178a15d0054394b387dff4c892a10f79644e52f2dc539bcbc77 |
| CHECKSUMS SHA-256                             | 2f47b6aca09e5826fe502a6fc12661e415e5fae2fcecea1a3aaf1ebfd39bf8f7 |
| Seed rows после импорта                       | 20357 = 20353 B7 + 4 transitions                                 |

Авторский импорт подтверждает 115 array tables, 20357 seed rows и 10 metadata.
Прибавка четырёх строк соответствует `atlas/transitions.json`: 1717 → 1721.
Длины journeys, requirements, QA, workflows, lifecycles и diagrams сохранены;
globalContracts не меняется, lookup objects не становятся seed array rows.
Импорт завершился с exit 0; это авторское доказательство, а не полный clean gate.
CHECKSUMS обновляет только две Atlas строки; остальные 23 строки побайтно
совпадают с принятой основой B7.

Player coverage сохраняется из B7 без изменения: 205 означает 204 формы
обычной player-навигации плюс адресованный cross-principal вход/terminal
role change NET-025 по ADR 0079. Это не утверждение, что role-filtered обход
от APP-002 посещает 205 форм, и не доказательство runtime-доставки. Recovery
не вводит новых player-navigation прав и не превращает system role в GM
полномочия.
