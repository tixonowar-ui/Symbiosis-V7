# ADR 0079 — Источник обычной передачи мастера и доверия преемнику

- **Статус:** принято владельцем, решения 4–5 issue #221
- **Дата:** 2026-11-05
- **Дополняет:** ADR 0068, 0071, 0073, 0075, 0077 и 0078
- **Граница:** поставка Atlas и точная совместимость B7; runtime — #215

## Контекст

Q-CAMP-009 требует безопасную передачу единственной GM authority. В прежнем
Atlas target должен быть выбран до unlock, но selector расположен позднее.
Принятие роли на устройстве без GM authority и собственного PC не замкнуто.
NET-009 по ADR 0075 доверяет только прежней pinned host identity, поэтому
смена installation требует отдельного доказанного перехода. Новый секрет
преемника также не был задан.

Владелец принял эти решения 2026-11-05. Эта часть #221 материализует обычную
передачу при доступном current sole GM. Аварийный recovery и право frozen
оператора остаются отдельной следующей поставкой; эта часть не закрывает
#221 или runtime #215. Обычный лимит artifacts применяется отдельно:
источники разделены по контракту, без исключения размера и без сокращения
проверок.

## Решение

### Выбор и unlock

NET-024 показывает selector явно сопряжённых и аутентифицированных
LAN-устройств до `UI-CMD-MASTER-TRANSFER-UNLOCK`. Собственный или допущенный
PC преемнику не требуется. Current sole GM приватно подтверждает текущий
пароль. Команда проверяет safe boundary, отсутствие pending operation,
полный checkpoint, совместимость подтверждённых receipts и точные revisions.

Unlock связывает campaign, инициатора, выбранную installation identity,
selection revision и checkpoint с одним transfer token. Authority не меняется.
Пока token действителен, target нельзя незаметно заменить: сначала
подтверждённый CANCEL, затем новый выбор и UNLOCK. Существующее истечение
token сохраняется; новое числовое TTL этим ADR не назначается.

### Отдельное принятие роли

NET-025 имеет INITIATOR, SUCCESSOR_ACK и TERMINAL_RECEIPT. На выбранное
устройство приходит адресованное приглашение с точным checkpoint.
Это технический context без игровых GM capabilities. Отдельные controls
отправляют `UI-CMD-MASTER-TRANSFER-ACK` с ACCEPT или DECLINE.

ACCEPT требует явного подтверждения checkpoint и нового пароля GM с
подтверждением. Verifier хранится только на installation преемника;
ACK связывает checkpoint с подтверждением готовности нового credential,
не раскрывая пароль или verifier другим устройствам. DECLINE закрывает
pending transfer и не требует нового пароля. ACK не выдаёт authority.

Инициатор имеет `UI-CMD-MASTER-TRANSFER-CANCEL` до общего commit.
Подтверждённая отмена инвалидирует pending token и ACK, сохраняет старую
authority и возвращает в тот же NET-024. Выходы после DECLINE/CANCEL
не дают новых полномочий. После commit отмена передачи отклоняется.

### Общий commit и роли

Существующий `UI-CMD-MASTER-TRANSFER-COMMIT` требует current sole GM,
точный token, successor ACK, checkpoint, подтверждённую готовность нового
credential и неизменные revisions. Старую authority необходимо исключить
до grant новой. Один durable common commit отзывает старую authority,
активирует единственного преемника с новым credential и сохраняет receipt.
Неопределённость, conflicting history или невозможность доказать исключение
старой authority оставляют одну подтверждённую authority либо freeze.

Новый host использует собственную installation identity. Private key старого
host не копируется. Прежний GM становится player и сохраняет назначенных
ему персонажей, как уже предписывает Q-CAMP-009. Terminal view доступен
только аутентифицированному участнику своего подтверждённого receipt:
consumed token не обязан оставаться активным. Current role определяет
доступный выход в GM-001 или APP-002; старый GM не получает маршрут GM
только вследствие прежней роли.

Только подтверждённый COMMIT на стороне authority формирует terminal
`participantReturnContext`: `GM_PANEL` для преемника и `PLAYER_MENU` для
прежнего GM. DECLINE/CANCEL сохраняют захваченный исходный context; клиент
не выбирает и не меняет эту привязку.

DECLINE сначала показывает terminal receipt. Дальнейший выход связан с
подтверждённой current role и сохранённым локальным context участника,
который не является присланным клиентом route. Существующий GM возвращается
в разрешённую GM-001, player — в разрешённую APP-002. APP-001 доступен только
для прежнего role-neutral boot: техническое приглашение закрыто, launch-mode
ещё не выбран, player/GM session и игровых полномочий нет. Существующая
session не сбрасывается ради удовлетворения APP-001 entry guard.

### Явный переход доверия

NET-009 сохраняет обычный reconnect к прежней pinned identity. Отдельное
проверенное уведомление содержит continuity proof common transfer,
campaign/checkpoint и новую installation identity. Только явный control
`UI-CMD-MASTER-TRANSFER-RECONNECT` разрешает локальный переход доверия
после проверки proof и аутентификации именно этого successor endpoint.
Изменение адреса само по себе не разрешает другую identity.

NET-010 затем сверяет прежние bindings и состояние. Новый admission,
новые copies и повтор gameplay receipts не создаются. Откладывание перехода,
неполный или чужой proof сохраняют прежний pin. Новый пароль, verifier,
private keys и GM-private metadata отсутствуют в уведомлении и player payload.

## Replay, поставка и совместимость

UNLOCK, ACK/DECLINE, CANCEL, COMMIT и transfer reconnect имеют отдельные
mutation boundaries и receipts. Exact authenticated replay возвращает
первоначальный receipt без повторного эффекта. Changed/stale/foreign запрос,
неподтверждённый proof или повторное использование commandId с другим
содержимым не пишет ничего. Restart и потеря ACK не создают второго grant.

JSON/Markdown, CTA/workflow/transitions, journeys, requirements, Q&A mapping
и QA mirrors поставляются вместе. Новых форм или второй GM оболочки нет.
Состав и точные байты B7 зафиксированы ниже. Исторические manifests и
исходные Atlas patches сохраняются; generated производится импортом.

По ADR 0071 сохраняются старые manifests, исходные bytes и уже принятые
forward-пары. Для B7 добавляются только явные B0–B6 → B7 и
тождественное чтение. Для B0–B4 сохраняется прежнее точное исключение трёх
art paths по ADR 0077; B5/B6 → B7 новых paths не добавляет. Остальные
артефакты, Runtime Pack, 24 mechanical replay inputs и runtime tuple
не меняются. Неизвестные/обратные версии и иной drift отклоняются.
Saved snapshots, FINAL, checkpoints, receipts и baseline IDs не переписываются.

Generated производится только импортом. Перед source merge обязательны
независимое ревью окончательного SHA, отдельный чистый полный gate,
зелёный CI того же SHA и совпадение merged main tree с проверенным.
Эти source guarantees не объявляют runtime #215 выполненным.

## Поставленные байты B7 и пределы счётчиков

Таблица закрепляет Atlas 1.12/B7 поверх неизменного дерева B6 из PR #222.
Окончательные committed SHA, независимое ревью, clean gate и CI фиксируются
в PR. Эта поставка не объявляет runtime #215 выполненным.

| Свидетель                                     | Поставка                                                         |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Atlas / дата                                  | 1.12 / 2026-11-05                                                |
| Forms / transitions / journeys / requirements | 376 / 1717 / 66 / 91                                             |
| Workflow / QA / CTA                           | 115 / 2452 / 1279                                                |
| Atlas JSON SHA-256                            | 2a31ca54a27096f0b8a704c59a38e7c16cbf585def5211e7a3700a0db8799deb |
| Atlas Markdown SHA-256                        | 53be8e781e116e9467f3a90fedd240884f4875884c2de7056a1bda0ee411d1ea |
| CHECKSUMS SHA-256                             | 00cf6b3773528c767d3e1b05488a521497745b2e8d6a7d0c5ab1667b7424bacc |
| Ожидаемые seed rows                           | 20353 = 20338 + 9 transitions + 3 workflows + 3 QA               |

Player coverage 205 состоит из 204 forms обычного player-navigation и одной
адресованной technical/terminal формы NET-025. Ограниченный role-only обход
от APP-002 сам по себе даёт 204: вход NET-024 → NET-025 является уже принятым
cross-principal system-event с точным successor/device/checkpoint binding,
а COMMIT меняет подтверждённую роль участника. Это не обычный player route
через GM-only NET-024 и не свидетельство runtime-доставки. Число membership
`roles` не выдаётся за результат такого ограниченного обхода. Entry guards
APP-001/APP-002 и отсутствие GM authority до common COMMIT сохраняются.
