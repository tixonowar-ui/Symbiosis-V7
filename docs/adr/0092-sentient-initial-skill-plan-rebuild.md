# ADR 0092 — Явная пересборка начального плана навыков до V1

- **Статус:** принято владельцем, вариант A issue #284, 2026-11-11
- **Дата:** 2026-11-11
- **Дополняет:** ADR 0077, 0089–0091; NPC-scoped ADR 0082 не переносится на SENTIENT
- **Поставка:** Atlas 1.21/B16; runtime относится к #257, родители #188/#113 открыты

## Контекст

CORE-194 отделяет техническую попытку от создаваемой атомарно immutable V1.
CORE-196 переиспользует создание персонажа, CORE-197 заменяет только получение
базы, CORE-216 задаёт начальный состав без PC XP и накопленных special histories.
CORE-165 определяет цену навыка, CORE-166 — permanent loss, temporary availability
и сохранение известного при снижении вместимости. SYM-166 добавляет пять слотов.
ENM-007 задаёт полный initial input, а ADR 0091 сохраняет Back с изменением базы
и новым точным бюджетом; это не интерфейс только incremental purchases.

Подтверждённый пример: UNITED raw20 имеет precomposition S13/D20/M10/Z10/I20/W20/C20
и START10. UNARMED+3 стоит3, LEARNING+6 стоит7. DOLPHIN L6
`LVL-DOLPHIN-6`, узлы SYM-162→163→164→165→SYM-161#ABSOLUTE_MEMORY→166,
оплачивает UNARMED3→5 за2 и ACROBATICS+3 за3. Полный новый initial input
FENCING+3/LEARNING+6 убирает прежние START3. Источник не выбирал между
неоплаченным bonus gap, переписыванием прежнего charge и ограничением Back.
Issue #284 локализовала пробел; владелец явно выбрал полный pre-V1 rebuild A
и разрешил отдельную Atlas/ADR/mirrors/guards/compatibility/CHECKSUMS поставку.

## Решение

### План и явная граница

До первого V1 SENTIENT имеет технический initial skill plan с закрытым version
discriminator и host-bound revision. Это не actor, gameplay history или новый
template.status. Первый полный ENM-007 устанавливает начальный выбор; последующая
полная пересборка требует отдельного явного подтверждения GM внутри ENM-007
под существующим UI-CMD-ENEMY-DRAFT-PATCH/SENTIENT_BUILD. Новая глобальная CTA,
route, workflow или GM оболочка не вводится. UI показывает реальные последствия
и сохраняет полный race/class/skill input с обычными требованиями/точным бюджетом.

Rebuild доступен и при изменённом, и при том же полном input. Изменение базы
ENM-006 с последующим ENM-007 также требует явного rebuild. Обычный NAV/Back,
сохранение идентичного input и exact replay не меняют plan. При изменении базы
dependent confirmation теряет актуальность, но это не стирает учёт/обязательные
факты прежнего плана и не разрешает loss по неподтверждённому body.
Подтверждённый R6 не запирает safe wizard Back ENM-010→009→008 и далее
ENM-008→007→006: same-plan composition edit и явный rebuild остаются достижимы.
Права Cancel и границы других kinds этим не расширяются.

Confirmation связывается с actual attempt, текущей plan revision, полным input
и показанными последствиями. Rebuild атомарно делает прежнюю deterministic
derivation неактивной, инвалидирует cached composition/inventory/current
own-skill selections и устанавливает новый полный план. Последующие extra choices
подтверждаются заново. Нельзя перенести старый бонус с неоплаченной START-частью,
выдать free promotion/refund или переписать фактическую цену прежнего расхода.
Stale/foreign/role-loss/error не выполняет частичного reset или allocation.

### Acquisition facts и текущие choices

Обязательные уже выполненные случайности не являются пересобираемым выбором:
FREE хранит исходный R6 и фактический **signed fixed** loss S/M/Z. Новый basis
не пересчитывает эту дельту, не возвращает потери и не применяет новый clamp.
Итоговый постоянный floor проверяется на настоящем полном листе; низкую новую
базу нельзя сделать допустимой refund старой потери или скрытым повышением до1.

Advisor сохраняет card identity, первоначальные I/W/suppression, acquisition,
initial-fill facts и исходные receipts. Rebuild инвалидирует текущие own-skill
choices, но не историю карты. GM не обязан заново заполнять abandoned prior
plan/card ради полной смены race/build на вариант без Advisor, monster или PURE.
Same-card reselect не создаёт новую карту и не перебрасывает I/W/suppression.
Если новая текущая композиция использует эту карту, её новые choices явно
подтверждаются; actual replacement card требует собственной исходной границы,
а не возникает автоматически из Back/rebuild. Старые facts не переписываются.

Для нового initial плана SYM-079 рассчитывается заново ровно один раз по
актуальному initial skill basis без stacking прежнего grant. Старые результаты
остаются историческими расчётами прежнего технического плана. Это явная
разрешённая граница A, а не NPC stronger-lineage или выдача опыта.

### Учёт внутри неизменённого плана

Изменение состава/removal/reacquisition само не пересобирает plan. Известные
навыки, их actual START/SYM-166 charges и permanent losses сохраняются. Потеря
источника SYM-166 меняет capacity, включая0/overflow, но не стирает оплату и не
выдаёт вторую пятёрку при возврате. Lower W не удаляет известное; permanent
requirement loss забывает навык и освобождает только его actual charges,
включая смешанную оплату. Возвращение характеристики/источника не воскрешает
START/GROSS/own Advisor skill автоматически. Полный явный rebuild — отдельная
граница с новым initial input и повторным подтверждением extra choices.

### Настоящий body и момент разрешения требований

Успешный SENTIENT_INVENTORY/fullsheet на ENM-009 атомарно разрешает actual
permanent requirements/skill charges. ENM-008 показывает provisional результат:
Skunk C0 до выбранного имущества не фиксирует irreversible loss. Фактический
source sealed/equipped Nate применяется до решения о permanent loss.
Armor M — temporary availability: не забывает навык и не освобождает оплату.

Initial own Advisor acquisition/fill отдельно проверяет actual body/effective M.
После подтверждения permanent loss сохраняет фактический остаток, а temporary
impairment только отключает бонус и не заставляет заново exact-fill/reallocate.
Final permanent stats >=1 без нового clamp; >35 законны. Неуспешный loadout не
фиксирует частичный inventory, loss, charge release или plan transition.
ENM-010 показывает полный осмысленный лист/учёт до атомарного COMMIT.

### Старые данные и V1

Старые empty V1, открытые attempts, FINAL/snapshots и исходные receipts читаются
и exact replay выполняется побайтно без новых полей/нормализации. Legacy plan
ABSENT остаётся ABSENT в immutable bytes. Legacy editing сохраняет прежний смысл
до явного перехода в новый plan. Nullable projection summaries объясняют эту
границу, а не создают фиктивный plan/UUID. Неизвестный discriminator/version
отказывает; historical prefix проверяется на собственном immutable cause.

COMMIT сохраняет полностью подтверждённый plan/body/choices и acquisition facts
в одной V1. После V1 этого rebuild нет. Read-only ENM-020/reconnect/restart не
выдают новые RNG, slots или SYM-079 и не переписывают прежний baseline/receipt.
N+1, NPC TRAINING/maxW/lifetime journal, gameplay acquisition history, placement,
сцены/бой/PC XP и активное применение способностей не входят в эту поставку.

## Обоснование

Явная граница сохраняет полный принятый Back и точный новый initial budget,
устраняя неоплаченную смешанную разницу без скрытого repricing. Внутри одного
плана действует CORE-166; между техническими кандидатами действует явно
утверждённый rebuild. Mandatory acquisition facts отделены от current choices,
поэтому respec не превращается в reroll. Verified-body sequencing применяет
фактические общие правила предметов, а не выдумывает будущую экипировку.

Источники: Rules v1.7 «Реестр правил» CORE-165/166/167/194/196/216, SYM-079/166;
Character v1.2 «04_Навыки», «05_Требования_навыков», «06_Модификаторы_персонажа»,
«07_Симбионты», «08_Уровни_симбионтов», «09_Узлы_развития»; AQA-005/006,
AQ2-015/023; отдельное решение владельца A в #284 от2026-11-11.

## Последствия и проверка поставки

Atlas JSON/Markdown изменяются локально: ENM-006–010/020, соответствующие QA,
existing PATCH workflow и scoped pre-V1 safe-boundary witness journey. CTA,
routes/transitions, другие kinds/стадии, Runtime Pack44/arts, XLSX и non-Atlas
bytes неизменны. Whole-object/MD guards закрепляют новую точную поставку;
negative mutations запрещают implicit reset, reroll/refund и charge repricing.
Generated получается только официальным import; CHECKSUMS обновляет инструмент.

Предыдущий полный B15 manifest копируется побайтно в atlas-v1.20.checksums.sha256.
B16 получает только явные проверенные пары B0–B15→B16 и identity. Старые seals,
non-Atlas bytes, replay inputs и runtime tuple остаются прежними. Реальные Git
forward/reverse oracles и fresh-process B15→B16 replay дополняются настоящим
старым #256 disk fixture без rewrite при owning open/read/original replay.

Это нормативный prerequisite #284, не runtime acceptance #257/#188/#113.
Реальные controls, ledger/body/source-prefix closure, lost reply и physical
restart нового workflow доказываются отдельно в #257 после поставки источников.
Независимое ревью, отдельный clean five-stage cycle и полный CI окончательного
committed SHA учитываются отдельно; ещё не выполненные gates не объявлены PASS.
