# ADR 0069 — Предварительное рассмотрение заявки устройства в Atlas

- **Статус:** принято; явное разрешение владельца от 2026-10-30, issue #177
- **Дата:** 2026-10-30
- **Дополняет:** ADR 0037, 0049, 0052, 0067 и 0068
- **Граница:** поставленный UI/source contract; runtime остаётся в #171/#172

## Контекст

Задача #171 требует принять заявку устройства к рассмотрению без создания
копии персонажа в кампании. В Atlas 1.5 конечный `UI-CMD-ADMISSION-GM-ACCEPT`
принадлежит NET-021 и атомарно публикует PROPOSED copies, а конечный
`UI-CMD-ADMISSION-GM-REJECT` принадлежит NET-022. Использовать их для
предварительного решения означало бы выполнить другой контракт. NET-017
при этом содержал поля effect editor вместо адресной очереди заявок.

Владелец явно разрешил узкую новую поставку #177. Согласование не является
реализацией GM runtime и не разрешает закрыть #171 неполным player-срезом.
Для сохранения исходных baseline сохранённых данных сначала поставляется
проверенная совместимость ADR 0068 / #190.

## Решение

### Поставка и паспорт

Поставляются JSON и Markdown Atlas **1.6**, дата **2026-10-30**. Legacy filenames
`Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.*` и schemaVersion **1.2.0** сохранены.
Counts: **376 forms, 1688 transitions, 108 workflow commands, 2445 QA, 1252 CTA**.
Семь новых переходов, два workflow и пять QA добавляют 14 строк в seed:
**20 302** вместо 20 288 при прежних 114 array tables и девяти metadata rows.
Замороженный Runtime Pack, предметные реестры и остальные 20 artifact paths
не меняются. Изменяются NET-003/005/017 и CMP-006, связанные requirement,
journey, action, workflow, QA и переходные зеркала.

Сохраняется процесс amendments ADR 0037/0049/0052: авторские semantic
`graphDigest`/`contentDigest` base 1.2 не пересчитываются по придуманному
алгоритму. Паспорт Markdown явно называет их историческими. Точную новую
поставку удостоверяет санкционированный `artifacts/CHECKSUMS.sha256`,
а совместимость старого baseline отдельно доказывает ADR 0068.

### Предварительные решения

NET-017 получает самостоятельные команды:

- `UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW`: PENDING → IN_REVIEW;
- `UI-CMD-DEVICE-REQUEST-REJECT`: PENDING либо IN_REVIEW → REJECTED,
  с обязательной непустой причиной.

Авторитет имеет только текущий GM соответствующей кампании. Решение связано
с точными campaignId, requestId и requestRevision. Payload и receipt закрыты;
неизвестные поля отклоняются. Повтор исходной команды возвращает её исходную
неизменную квитанцию, отдельно от последующего текущего состояния заявки.
При конкурирующих решениях и owner CANCEL побеждает одна транзакция.
Owner CANCEL допускается только из PENDING и переводит заявку в CANCELLED.

Эти команды не создают campaign copy, campaignCharacterId, seat, capacity
reservation, Ready или player authority в кампании. IN_REVIEW обозначает
принятую к рассмотрению заявку и не подменяет рабочую review copy из #172.
NET-018–022/027 и конечные admission workflows с QA сохраняются.

### Очередь и навигация

Effect fields NET-017 заменяются закрытой очередью: request identity,
owner/status/revision/connection, неизменные summaries 1–3 собственных FINAL
кандидатов, decision reason/receipt, queue revision и return context.
Capacity отражает фактическую кампанию; предварительное решение не резервирует
место и не меняет счётчики принятых персонажей.

CANCELLED остаётся в durable history и receipts, но исключается из текущего
`requests[]`. Исчезнувший `selectedRequestId` сбрасывается в null с обновлением
queue projection; reconnect/replay не восстанавливает исчезнувший выбор.
REJECTED остаётся показываемым. Player получает только результат собственной
заявки в NET-005 и не получает чужую GM очередь.

Новый узкий вход: sole GM собственной PAUSED кампании переходит
CMP-006 → NET-017 и возвращается в тот же CMP-006. PAUSED относится именно
к этому ingress/return, а не становится новым глобальным ограничением всех
будущих отдельно реализованных путей NET-017. Для REJECTED в NET-005 предусмотрен
безопасный возврат NET-003 при действующей technical session.

Составные поля, payload и receipt contracts помещены в существующие
`acceptanceCriteria` формы NET-017. Новые top-level/schema keys не вводятся:
полная форма уже импортируется в `forms-by-id`, поэтому нормативные строки
попадают в generated и остаются доступны последующей реализации.

### Проверки поставки

Новые JSON guards фиксируют изменённые адресные контракты, целые новые CTA
и workflow rows, семь переходов во всех global/out/in зеркалах, requirements,
journeys, QA, закрытые composites и request/final границу. Неизменённые конечные
admission объекты дополнительно защищены каноническими hashes отдельных JSON
объектов: это внутренний guard, а не новый semantic digest Atlas.

Markdown guards проверяют согласованные нормативные строки и паспорт.
У четырёх затронутых форм отдельно закрепляются roles, route, inputOwner,
entryConditions, guardStates, projection, contexts и actions.prohibited:
сохранение имён полей само по себе не защищает GM-only границу очереди.
Предыдущие ADR guards сохраняются; новые проверки вызываются и importer,
и отдельным validator. Mutation tests должны отвергать потерю зеркала,
ослабление guard, unknown composite fields, восстановление CANCELLED selection
и изменение защищённого конечного admission.

## Последствия

Поставка устраняет источник противоречия для завершения #171 и сохраняет
отдельный конечный admission #172. Сам runtime, его миграции, GM decisions,
конкуренция команд и two-installation recovery проверяются в соответствующих
application PR. Импорт новой формы не объявляет её опубликованной в приложении.

Следующая поставка #186 строится поверх Atlas 1.6, сохраняя новые NET контракты.
Добавление новых art paths требует собственного явного обоснования lineage:
совместимость равного набора путей B0/B1 из ADR 0068 не расширяется молча.

Перед merge нужны import/import:verify, чистый tracked generated output,
полный verify, build, все production E2E, независимое чтение с честной границей
scope и отдельный полный verify/E2E на окончательном committed SHA, зелёный CI.
