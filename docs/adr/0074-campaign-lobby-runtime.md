# ADR 0074 — Журнал Ready и атомарный первый Start

- **Статус:** реализация принятого контракта #173 / ADR 0073
- **Дата:** 2026-11-02
- **Дополняет:** ADR 0067–0073
- **Граница:** первый Start и неподвижная мирная сцена; управление сессией — #174

## Авторитет и сохранение

Миграция 0013 добавляет журнал `campaign_lobby_event`, его проверяемую голову
и одну запись `campaign_peace_scene` на кампанию. Существующие admission
журналы, исходные FINAL, receipts и campaign birth не переписываются.
Чтение воспроизводит весь admission prefix и каждое событие Ready/времени;
проверяются зеркала GM, checkpoint и сохранённая сцена. Неизвестная версия
схемы по-прежнему запрещена; новые пути явно принимают 12 или 13.

Состав выводится из committed admission: все ACTIVE с валидной механикой
и controller bindings. PROPOSED с blockers видны в лобби и исключены из
сцены. Хеш snapshot включает упорядоченный состав, механику, назначения,
controllers и подтверждённое начальное время. Ready хранит точный ACTIVE-набор
аутентифицированного устройства. Изменение чужого Ready меняет только
readiness revision и не отменяет остальные подтверждения.

Start в одной транзакции проверяет GM authority, pre-start PAUSED, snapshot,
readiness revision, непустой ACTIVE-состав, Ready всех включённых устройств,
явное время и отсутствие конфликтующей операции. Затем сохраняет один
PEACE context, checkpoint и receipt, переводит кампанию в HOSTING и продвигает
существующую GM-проекцию. Replay возвращает исходный receipt; новые scene,
checkpoint и game timestamp не выделяются. Ошибочная команда не меняет
авторитетную БД. Wall-clock `committedAt` — аудит команды, не игровое время.

Виртуальная минута, STOPPED и DAY/NIGHT следуют ADR 0073. Автоматического
хода времени, ADVANCE_TIME, новых групп, markers, координат, боевых сущностей
или localLighting этот срез не создаёт.

## Транспорт и локальное восстановление

Ready и чтение owner lobby используют существующий authenticated campaign
peer, executor, ограниченный chunk transport и его общий бюджет. Нового
listener, controller allocation или очереди команд нет. Identity из payload
браузера не принимается: устройство доказано peer session, вкладка —
сохранённым admission binding.

На установке игрока новые события `LOBBY_OBSERVATION`, `READY_INTENT`,
`READY_ACK`, `READY_REFUSED` продолжают прежний owner admission journal
и его `ADMISSION_ADVANCE` зеркала. Перед отправкой сохраняется полный
исходный запрос. Неопределённая доставка сохраняет pending; только receipt
либо отказ с подтверждённым generation fence завершает намерение.

Сохранённый ACK не превращает старое наблюдение в актуальное. Пока
`readinessRevision` наблюдения выбранной вкладки меньше revision ACK,
проекция сохраняет ожидание, а controls недоступны. После получения
свежего наблюдения background publication доставляет исходный receipt
перед новым snapshot. Prepared tabs используют доказанный исходный transport
и общий журнал; они не создают второй technical session. Ожидающие
результат браузерные подписки обслуживаются перед пассивными вкладками
в той же последовательной очереди. После сетевого ожидания заново
проверяются доверие, исходный context и scope до публикации снимка.
Terminal доставляется только connection, отправившей команду или заявившей
её в `unacknowledgedCommandIds` при любом поддержанном reconnect. Пассивное
наблюдение чужого pending не подписывает вкладку на его receipt. Потерянный
ACCEPT ACK также возвращается отдельным replay перед закрытым LOBBY snapshot.

## Проекции и controls

NET-006 показывает ACTIVE и blocked героев устройства отдельно, объясняет
состав Ready и предоставляет «Готов» / «Отменить готовность». NET-016 даёт
три пустых поля календаря, отдельное сохранение времени и Start только при
выполненных guards. Это обычные Atlas CTA, а не скрытые команды.

CMP-007, NET-016, GM-001 и GRP-001 продолжают существующий GM context,
cursor и queue, включая вход с нулём PC. Общая оболочка доступна дальнейшей
#187; NPC, редактирование групп/карты и будущие capabilities не открываются.
Read-only арт выводится по проверенному checksum существующего asset.
После Start legacy owner review использует доказанный текущий HOSTING;
сохранённое наблюдение Start сильнее старого capacity cache. Поздний CANCEL
ожидающей заявки перечитывает статус перед NET-003. Новые selection/submit
controls в HOSTING закрыты, replay прежних результатов остаётся доступным.
NET-003/NET-004 передают текущий `campaignStatus` в закрытой технической
обёртке; прежние сохранённые snapshots и receipts не переписываются.

PLY-001 содержит только лист выбранного admitted персонажа, его runtime,
группу/локацию, controller и сохранённые время/сцену. Нет combat/turn/reaction
или притворного markerRevision=0. Постоянные состояния остаются в механике,
temporaryEffects берутся из initialRuntime. Техническая обёртка содержит
собственные requestId, admissionBatchId, network scope, controller seat и
revision vector: они доказывают продолжение NET-005/NET-027, включая поздний
ответ и восстановление. Чужие листы и GM-private metadata не передаются.

Закрытый browser decoder проверяет эти связи, точный selected copy при
переходе в PEACE и неизменность уже подтверждённой мирной сцены после
reconnect. Переход напрямую от старого NET-005 к текущей проекции допустим
только для той же заявки, кампании, устройства и controller seat.

## Проверка

Storage проверки покрывают атомарность/rollback, singleton Start, replay,
отказы, time invalidation и подмену зеркал/сцены. Host/peer проверки используют
реальные SQLite и authenticated transport, включая потерю ACK и observation.
Production E2E проходит реальные controls и рестарт обеих установок.
Фактические результаты окончательного SHA, независимого ревью, чистого
полного прогона и CI фиксируются в PR; наличие ADR их не заменяет.
