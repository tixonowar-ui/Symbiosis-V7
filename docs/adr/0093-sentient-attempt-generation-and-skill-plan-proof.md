# ADR 0093 — Версия попытки и доказательство начального плана SENTIENT

- **Статус:** техническая реализация принятого ADR0092 в #257
- **Дата:** 2026-11-12
- **Дополняет:** ADR0090/0091/0092; игровых решений не меняет

## Контекст

Atlas 1.21/B16 и ADR0092 поставлены отдельно в #284. Тот же B16 мог обслуживать
прежний runtime #256: baseline не отличает старую попытку от новой. Изменение
default при replay старого NAV добавило бы новые поля старым snapshots и receipt
inputs. Одного optional поля плана также недостаточно для монотонности новой
попытки: его отсутствие нельзя автоматически считать разрешением legacy-ветки.

Полная пересборка и обязательные acquisition facts имеют разные границы.
Показ preview не является подтверждением нового плана. В частности, он не
должен запирать прежнюю попытку в новых требованиях, если GM отказался от перехода.

## Решение

### Серверная версия и прежняя грамматика

Новый owning NAV-cause ENM-001→005 содержит закрытый серверный
`enemyAuthoringSchemaVersion: 2`. Клиентский NAV envelope не расширяется.
Поле допустимо только у этого входа; неизвестная версия отказывает.
Reducer создаёт attempt `schemaVersion: 2` с закрытым `skillPlanState`.
Отсутствующий marker у исторического NAV воспроизводит прежнюю попытку без
новых ключей. Ни baseline, ни startup catalogue не подставляют ей version/plan.

В новой попытке полный первый ENM-007 создаёт план. Существующий полный raw
BUILD input остаётся совместимым первым вводом; новый UI явно обозначает
INITIALIZE. Для уже существующего плана идентичный SAVE сохраняет его identity,
revision и фактическую оплату. Полностью другой ввод и явная пересборка того же
ввода проходят PREVIEW_REBUILD→CONFIRM_REBUILD под прежним PATCH/SENTIENT_BUILD.
Идентификатор нового плана — actual accepted BUILD commandId, уже занятый QUEUE,
а не новый независимый allocator.

Legacy editing остаётся прежним до подтверждённого перехода. Его новый preview
хранится только как `legacySkillPlanPreview`: активный plan и generation2 не
возникают. DISCARD_REBUILD закрывает конкретный preview, оставаясь на ENM-007;
обычный legacy PATCH также оставляет прежний смысл редактирования. Для modern
attempt discard не меняет существующий план, cached body или charges.
Это встроенные technical controls, не новые global CTA/routes/workflows.

### Полный ввод и показанные последствия

Preview содержит actual attempt/revision, actual plan identity/revision, полный
base/race/class/skills input и показанные последствия: прежние навыки с реальными
START/SYM-166 платежами, сброс cached composition/inventory/current own choices,
идентичности сохраняемых RNG receipts. UI восстанавливает поля из подтверждённого
host preview, показывает имена/бонусы/платежи, реальный cached состав/имущество,
fixed signed R6 и исходные броски Advisor I/W/suppression. Скрытых JSON editors нет.
Изменение локального ввода снимает подтверждение; применять старый preview к
новым полям нельзя. CONFIRM связывает полный input и displayed consequences с
own preview и текущим prefix; ошибка/stale/foreign не выполняют частичный reset.

### Учёт и настоящее тело

Внутри плана хранится thin creation accounting: известный bonus, actual START и
SYM-166 части оплаты, permanent losses и один deterministic GROSS grant этого
плана. Цена известного bonus не вычисляется заново для refund. Потеря источника
оставляет известное и оплату, в том числе при capacity0/overflow. Последующий
возврат источника не выдаёт вторую пятёрку. Полный новый план начинает собственный
полный initial input и требует нового подтверждения extra choices.

Успешный SENTIENT_INVENTORY вычисляет реальное имущество/экипировку и постоянные
характеристики, разрешает permanent requirements, loss и actual charge release,
затем публикует полный лист атомарно. До этого 008 — provisional: разрешённая
композиция может исправить precomposition M0, а настоящий sealed/equipped Nate —
Skunk C0. Final permanent floor остаётся >=1, без нового clamp; >35 допустимо.
Временная доступность по effective stats — отдельный read и ничего не забывает.

Advisor current knowledge отделено от initial-fill history реальной карты и
плана. Первое заполнение проверяет настоящий body и собственные I/W. Поздняя
permanent loss оставляет фактический остаток; temporary impairment не заставляет
повторно exact-fill. Rebuild инвалидирует current choices, сохраняет исходные
roll/card/initial-fill facts и не требует заполнять abandoned card для варианта
без Advisor. Same-card reselect использует прежние I/W/suppression.

Это не NPC lifetime journal, TRAINING/maxW, actor status или gameplay history.
Общие source-backed topology/stat/skill/item validators используются без
заимствования NPC identity и initial-state semantics.

### Причина, replay и наблюдение

Host сохраняет preparedSkillState в собственной mutation. Store detachment и
closed shape/binding validation остаются внутри синхронного read-only fence.
Modern reducer не принимает mutation без modern preparation; legacy branches
не дополняются новыми nullable defaults. Каждая историческая preparation заново
вычисляется по собственному предыдущему attempt, исходному request и source.
Поздний чистый cursor/другой план не скрывает повреждённый прежний prefix.

Первоначальные mandatory rolls и их receipts не пересэмплируются при чтении,
rebuild/replay/restart. Текущая owning authority проверяется и перед возвратом
известной квитанции. После V1 эта пересборка недоступна; N+1 относится к другой
задаче. Прежние FINAL/snapshots/receipts/baselines остаются неизменны.

## Проверка и границы результата

Pure source-backed tests проверяют actual mixed payments, capacity0/reacquire,
permanent loss без resurrection, полный новый initial input, Advisor knowledge
и настоящий CHIMERA L4 при provisional M0. Owning tests используют SQL/QUEUE,
genuine #256 fixture, physical close/open, original replay и zero-write refusals.
Client tests закрывают все новые rendered nested records до publish и сохраняют
last confirmed view при malformed host packet. Production browser отдельно
проверяет реальные controls/nodes, confirmation, lost reply, private PLAYER
boundary и physical host restart.

Dirty targeted evidence, окончательный committed SHA, независимое чтение,
отдельный clean five-stage cycle и CI учитываются раздельно. Этот ADR не
объявляет ещё не выполненные проверки пройденными и не закрывает #188/#113.

Два новых многосоставных owning-сценария mixed payment и Advisor имеют отдельный
конечный body budget 60 с по ADR0088: в whole-file прогоне reported case totals
составили 23,325 и 23,153 с при прежнем default 30 с. Это запас двух конкретных тестов,
не исправление производительности/таймаута и не измерение отдельной production
фазы. Их assertions, fixture isolation и cleanup сохранены; остальные бюджеты,
hooks/workers/retries/CI/runtime не меняются. Поведение CI с этим запасом ещё
проверяется отдельно на окончательном SHA.
