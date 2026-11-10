# ADR 0090 — Закреплённый каталог и курсор библиотеки врагов кампании

- **Статус:** техническая реализация принятого CORE-191 в issue #255
- **Дата:** 2026-11-10
- **Дополняет:** ADR 0068, 0071, 0077, 0089; игровые правила не меняются
- **Граница:** ENM-001/003 через прежний GM ingress; #188/#113 остаются открытыми

## Pin при создании и неизменная история

CORE-191 требует `campaign.defaultSentientCatalogVersion` при CREATE.
Появляется закрытая birth-форма `PAUSED_CAMPAIGN schemaVersion=2` с обязательной
версией из проверенного Runtime Pack. Тот же pin и явный
`campaignBirthSchemaVersion=2` входят в immutable result CREATE. CMP-005
публикует подтверждённый host pin; браузер связывает с ним результат.
Payload, result, исходный draft, birth revisions и checkpoint проверяются вместе.
Удалённый pin, несовпадение, неизвестная версия или чужой каталог отказываются.
`creationOrigin` и `queueBase` реконструируют birth из первоначальной квитанции,
а не из поздних settings или текущего checkpoint.

Legacy `schemaVersion=1` имеет строго прежние поля. Старые result/receipts,
checkpoint и FINAL не переписываются и не дополняются при чтении/replay.
Для такой кампании версия библиотеки доказывается её исходным полным baseline:
resolver допускает только точную доверенную lineage, включая неизменные байты
Runtime Pack. Loader сверяет его metadata и все 44 payloads с поставленными
реестрами/импортом. Это доказательство конкретного birth source, а не версия
startup по умолчанию, диапазон версий или назначение pin при первом OPEN.

## Две вкладки и настоящий выбор

Прежний CMP-007 → GM-001 → ENM-001 получает вкладки `SENTIENT_ENEMIES`
и `MONSTERS`. Первая содержит 44 `SYSTEM_DEFAULT_SENTIENT`, вторая —
16 видов/17 статблоков `CANONICAL_BESTIARY`. Пользовательские шаблоны этой
кампании пока отсутствуют: создание и версии относятся к следующим задачам.
Постоянные NPC и боевые экземпляры в эти списки не включаются.

Selected identity содержит origin, настоящий template ID, catalog version
и art key; принадлежность вкладке проверяет host. Массив, route или prefix ID
не доказывает происхождение. Связи SENT/ART-SENT берутся из Runtime Pack
и реестра; CBT/SPC/ART-CB — из собственного канонического реестра.

ENM-003 по ADR 0089 и своему art-контракту читает только 44 системных мыслящих.
CORE-191 не назначает каноническим статблокам эту карточку: они остаются
различимыми read-only строками MONSTERS с собственными фактами/identities.
Canonical selection не получает CTA 002/004; forged вход в 003 отказывает.
Его JPEG, пользовательская заглушка или upload не подменяют Runtime Pack PNG.

## Единственный существующий курсор GM

Миграция 0020 расширяет CHECK прежнего campaign cursor ровно ENM-001/003
и CHECK прежнего QUEUE ledger техническим `ENEMY_SELECTION`. Старые строки
копируются без изменения JSON/хешей. Новых GM shell, contexts, actor/template
сущностей или таблиц версий нет. В том же курсоре сохраняются вкладка,
выбор и ревизии. Изменение выбора — технический event, не игровая запись.
Само чтение не меняет campaign checkpoint, roster, RNG или gameplay state.

Каждый исторический selection проверяется по реальному закреплённому source,
даже если последующий выбор/null скрыл его из текущего view. Общие GM
projection/reconnect и writer guards используют тот же синхронный source
observer независимо от текущей формы; в persistence нет host loader.
Структурный reader сам по себе не удостоверяет игровую source identity.
Для NAV новые APPLY-предусловия отделены от точного REPLAY: старый переход
проверяется по своему immutable префиксу и возвращает текущий безопасный view.

ACK технического выбора не меняет подтверждённый UI. Нужна correlated
source-проекция с теми же scope/tab/identity и допустимыми revisions.
При обрыве до/после ACK reconnect читает сохранённый курсор без нового выбора.
Read-only поля листа передаются как JSON values, не как строки для позднего
JSON.parse в React; неизвестные/повреждённые поля отклоняются до render.

## Доказательства и предел

Source tests сверяют все 44 payload hashes/арты с настоящим Runtime Pack.
Host tests проверяют source/origin/tab/authority/revisions, rehash скрытой
порчи истории, pin-v2 и legacy-v1, delayed exact NAV replay и zero write.
Миграционный case проходит populated 19→20 с NPC/QUEUE history, прежними
квитанциями, всеми старыми строками, FK, file reopen и точным replay.
Production browser проверяет CTA, вкладки, выбор, Back, обе границы потери
ACK, process/SQLite restart, исходный PNG и PLAYER payload/DOM/a11y privacy.

Placement/group/location/marker/scene/combat поля отсутствуют. Просмотр
не создаёт actor, clone, template, version, save или RNG. Фильтры ENM-002,
instantiation, enemy authoring, archive/delete, генератор, группы и бой
не входят в исполняемые capabilities этого среза. Все artifacts/CHECKSUMS,
44 payloads, Runtime Pack и существующие ADR сохраняются. Полная приёмка
точного SHA следует ADR 0088 отдельно от авторских targeted результатов.
