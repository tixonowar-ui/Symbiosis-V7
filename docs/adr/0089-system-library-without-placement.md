# ADR 0089 — Системная карточка библиотеки без размещения

- **Статус:** принято владельцем, issue #244
- **Дата:** 2026-11-09; решение владельца принято 2026-11-08
- **Дополняет:** ADR 0068, 0071, 0077; прежние решения не переписываются
- **Поставка:** Atlas 1.20/B15; runtime относится к #255, родитель #188/#113 остаётся открытым

## Подтверждённая граница

CORE-191/192 и ADR 0077 требуют read-only данные системного каталога.
В Atlas 1.19 ENM-003 и QA-FORM-ENM-003 требовали groupId,
location/subLocation и markerRevision. До первого Start настоящая PAUSED
кампания через CMP-007 → GM-001 → ENM-001 не имеет placement/боевой сцены.
Общий empty/negative-space контракт не отменяет обязательные ready-поля.
Владелец принял отдельную source-поставку #244 для устранения противоречия.

## Решение

SYSTEM_LIBRARY — контекст просмотра фактически выбранного системного шаблона
из закреплённой в кампании версии каталога. Это не новый template.status,
сохранённая сущность или runtime actor. ENM-003 разрешён в PAUSED до Start
через прежний ingress, без создания размещённого экземпляра.

Из requiredFields ENM-003 убираются ровно groupId, location/subLocation и
markerRevision. В SYSTEM_LIBRARY они ABSENT; группы, координаты, marker,
combat state, фиктивная сцена, нули и пустые UUID не создаются.
Остаются contextId, stateRevision/projectionRevision, системный art key,
campaignId/status. Host подтверждает actual selected systemTemplateId,
catalogVersion и art identity, реальную кампанию и sole current GM.
Missing, foreign, corrupt identity, stale authority/revision дают отказ
без default. Браузер не назначает себе source identity или полномочия.

Для 44 системных мыслящих используется только исходный арт закреплённого
Runtime Pack по настоящей привязке шаблона. Payloads, hashes,
NO_XP_PROGRESSION, системные арты и канонический бестиарий не меняются.
Пользовательская заглушка, file picker и upload системной карточке недоступны.

ENM-001 → ENM-003, единственный ENM-003::CTA::001 → ENM-001 и все
существующие переходы/CTA/guards сохраняются. Read-only/reconnect не меняет
каталог, не создаёт template/version/runtime clone, RNG или placement.
Новых routes, команд, групп, карты, disposition или боя нет.

## Поставка, guards и совместимость

Изменяются только два Atlas-файла: версия/дата, ENM-003 requiredFields и
acceptance witnesses, соответствующие QA scenario/expected и Markdown.
Непересекающиеся contracts и mirrors структурно или побайтно неизменны.
Whole-object/Markdown guards по ADR 0077 сохраняются и закрепляют новые
точные объекты/секции; predicates других ADR не ослабляются. Негативные
регрессии возвращают каждое placement-поле, меняют арт/CTA/identity witness.
Generated пересобирается только npm run import. CHECKSUMS обновляет штатный
инструмент в рамках санкционированной поставки.

Предыдущий полный B14 manifest сохраняется как atlas-v1.19.checksums.sha256.
B15 разрешает только явные forward пары B0–B14→B15 и B15 identity по
ADR 0068/0071; предыдущие пары неизменны. Полные manifest/Atlas seals,
23 non-Atlas bytes, replay inputs и runtime tuple проверяются прежним
механизмом. Реальный patch #244 проверяется независимым Git apply в обоих
направлениях и полными release seals; B14→B15 replay использует новые
Node-процессы и реальные сохранённые FINAL/DRAFT/archive/candidate bytes.
Старые snapshots, receipts, baseline IDs и история не переписываются.

## Точка остановки

Это нормативная source-поставка. Runtime #255 отдельно доказывает настоящий
проход, отсутствие placement в payload/DOM/a11y, Back/reconnect и GM privacy.
Source/import/guard проверки не являются runtime acceptance #188/#113.
Независимое ревью, чистый пятиэтапный gate и полный CI окончательного SHA
фиксируются отдельно по ADR 0088; успешность ещё не выполненных gates
не заявляется.
