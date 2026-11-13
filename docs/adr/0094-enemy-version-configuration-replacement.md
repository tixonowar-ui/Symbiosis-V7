# ADR 0094 — Явная замена конфигурации новой версии врага

- **Статус:** принято владельцем, вариант A issue #288
- **Дата:** 2026-11-13
- **Дополняет:** ADR0077/0092/0093; прежний pre-V1 контракт не переписывается
- **Поставка:** Atlas1.22/B17; runtime — отдельная #259, родители #188/#113 открыты

## Контекст

CORE195 требует полного N+1 payload при неизменных template kind/campaign и
baseVersion=current. CORE216 прямо применяется к созданию **или новой версии**
SentientEnemyTemplateVersion: валидные уровни/деревья без XP, fullOE и пустые
накопленные special histories. Версия шаблона не является живым NPC/экземпляром.
Однако разрешение полного payload само не выбирает судьбу смешанной оплаты.
ADR0092 разрешил полную замену initial skill plan только до V1 и оставил N+1
за границей своей поставки. Issue #288 локализовала и вынесла этот выбор владельцу.

V1 UNITED raw20: START10 = UNARMED+3 (цена3) и LEARNING+6 (цена7).
DOLPHIN6, цепь SYM162→163→164→165→SYM161#ABSOLUTE_MEMORY→166, оплачивает
UNARMED3→5 двумя SYM166 slots и ACROBATICS+3 ещё тремя. Замена initial input
на FENCING+3/LEARNING+6 убирает прежнюю START3. Нельзя молча сохранить
UNARMED+5 с неоплаченной частью, переписать charge или решить reset именем DTO.

У CUSTOM_MONSTER отдельная Advisor personality card также имеет current choices.
Например I20/W20, own capacity10, initial UNARMED+3/LEARNING+6 (3+7): при
постоянном падении bodyD ниже11 UNARMED теряется. Новая версия с допустимым
body и полным FENCING+3/LEARNING+6 требует явно разрешить замену current own
choices. Это не START/race/class и не контейнер навыков тела монстра.

## Решение

### Полная копия и явная граница на ENM017

Открытие technical version attempt копирует весь подтверждённый current candidate:
полный лист, actual extra choices/payments/known skills/losses и исходные
acquisition witnesses. Attempt связан с campaign/template/baseVersion и
собственными revisions. Его происхождение доказывается actual base/owning NAV,
а не самим candidate. Никакого NPC OPEN или нового template.status нет.

Обычный NAV/Back, одинаковый SAVE, exact replay и просмотр ничего не сбрасывают.
Изменение имени или другого независимого поля не выдаёт новую пятёрку/grant.
Для полной смены SENTIENT base/race/class/initial skills либо current own-card
choices **любого kind** GM отдельно подтверждает version-configuration replacement.
Доступна и намеренная замена того же полного input, но не implicit reset.

Внутренние preview/confirmation controls на ENM017 используют существующий
UI-CMD-ENEMY-DRAFT-PATCH, расширенный только на host-bound version candidate.
Не добавляются global CTA/routes/workflow или NPC phases. Preview связан с
actual attempt/revision, template/current baseVersion, полным kind-specific input
и показанными последствиями. Он показывает прежние bonuses/START+SYM166 charges
только SENTIENT, own-card choices/цены/losses обоих kinds и сбрасываемые
composition/inventory confirmations. Локальное изменение input снимает consent.
Reason и содержательный diff обязательны при финальном NEW-VERSION.
Обычные edits и подготовка preview не требуют ещё не данного consent и не
выполняют replacement. Только confirmation требует отдельного явного consent,
связанного с exact preview/input/показанными последствиями/revisions.

Confirmation атомарно заменяет только новую конфигурацию. Cached composition,
inventory и current own choices инвалидируются и подтверждаются заново в своих
применимых kind boundaries. Stale/foreign/authority loss/error не выполняют
partial reset/allocation. Сохранённые предыдущие версии и их оплата не меняются.

### SENTIENT accounting и оба own-card paths

Новая явно подтверждённая SENTIENT конфигурация получает полный новый initial
basis, обычный точный START budget и явно выбранные extra allocations. В примере
новые FENCING START3/LEARNING START7 принадлежат V2; прежние UNARMED/ACROBATICS
и платежи остаются immutable V1. При выбранном DOLPHIN6 V2 может явно заполнить
свои пять slots. Это разрешённая новая конфигурация, не refund старой версии.

SYM079 вычисляется для нового initial basis ровно один раз. Прежний derived
grant не используется как новый basis и не stacks. Одинаковый PATCH/replay не
выдаёт grant; даже deliberate replacement того же input считает результат из
полного initial input, а не из прежнего enhanced bonus.

Без replacement same-plan composition/removal/reacquisition сохраняют known
skills, actual payments и permanent losses. Capacity0 не обнуляет spent SYM166,
возврат stats/source не воскрешает забытое. CORE166 permanent requirement loss
и temporary availability различаются. Для SENTIENT настоящие inventory/loadout
и source Nate проверяются до irreversible body loss; final floor >=1 без repair.
Итоговые значения выше 35 допустимы. Неуспешный loadout не фиксирует partial
loss/charge release.

Для обоих kinds replacement current own-card choices является отдельным явным
выбором. Новые choices проходят actual body/own I/W/capacity, source requirements,
цены и нормальное начальное заполнение. Прежние known/loss states сохраняются
в immutable предыдущей версии; автоматического resurrection нет. Initial-fill
facts реальной карты не заменяются новым current choice. CUSTOM_MONSTER при этом
не получает START/race/class, host skills, inventory или suppression.

### Неизменяемые mandatory facts

Actual prior mandatory facts разрешаются по owning template-bound authoritative
prefix, включая подтверждённые acquisitions в впоследствии отменённых version
attempts того же шаблона. Current baseVersion сама по себе не доказывает ABSENT:
новая N+1 attempt не получает повторный R6/карту, если actual fact уже есть в
собственном immutable NAV/cause/receipt prefix. Unrelated template/campaign
facts не заимствуются. Это technical mandatory provenance, не NPC lifetime
journal. Отдельное CORE201 право семи R20 каждой distinct monster attempt
сохраняет свою область и не переносится на эти mandatory acquisition facts.

Унаследованный FREE fact хранит original R6 и **actual fixed signed** S/M/Z loss.
Даже FREE→PURE или смена базы не стирают эту дельту, не пересчитывают её по новой
базе, не возвращают потерю и не добавляют clamp. Final floor проверяется на
настоящем новом полном листе. Если PURE→FREE и actual prior R6 отсутствует,
первое acquisition использует существующий применимый #257 R6 control с own
command/attempt receipt/provenance. Отсутствие не заменяется нулевым fact.

Существующая Advisor card обоих kinds сохраняет cardId, первоначальные I/W,
initial-fill/source facts и исходные receipts. Historical SENTIENT suppression
fact также сохраняется неизменным, даже если текущая race/composition/body делает
его неактивным или Advisor отсутствует. Predicate управляет **применимостью**, а
не удалением fact или восстановлением права броска. CUSTOM не получает этого
поля/броска/правила. При отказе от Advisor abandoned card не требует fill.

Если карты ещё нет, её первое acquisition использует уже поставленный для kind
path #257/#258 с двумя natural R20 и source +8; отдельный suppression control
действует только при применимом SENTIENT условии. Новые facts привязаны к actual
card/attempt/command. Same-card reselect, Back, copy и N+1 не перебрасывают карту.
Замена уже приобретённой карты на новую ради других I/W **не разрешена** этой
поставкой; соответствующий control недоступен с понятной причиной.

Эти mandatory composition acquisitions — reuse существующих правил, не новый
канал семи monster base-stat R20. ENM018/019 и CORE201 runtime остаются #260;
их ранее поставленные source context/aliases/return guards не изменяются.
Art наследуется по ADR0077; upload/clear runtime остаются #261.

### Commit, история и старые данные

UI-CMD-ENEMY-NEW-VERSION остаётся единственным append: повторно проверяются
sole current GM, campaign/template/kind/current baseVersion, actual source,
attempt revisions, подтверждённый полный candidate, diff/reason и resolved art.
Version/history/current pointer/receipt сохраняются атомарно. Cancel не создаёт
версии и не стирает acquisition receipts. Exact replay возвращает original receipt
отдельно от текущей проекции, без нового reset/RNG/grant; исторический prefix
проверяется на своей actual причине, не по последнему будущему состоянию.

Legacy ABSENT обоих kind grammars остаётся ABSENT в immutable bytes. Копия не
создаёт fictional plan/UUID или SENTIENT keys в CUSTOM. Только явная confirmation
новой конфигурации вводит соответствующий closed kind-specific discriminator в
новом candidate/version. Старые V1/open attempts/FINAL/snapshots/receipts и hashes
не нормализуются. ENM020 выбирает read-only историю, не меняя currentVersion;
nullable technical summary может объяснять legacy absence без implicit upgrade.

## Обоснование

Владелец явно выбрал полный replacement A в #288 после независимого review
proposal02. Альтернатива continuity-only оставляла бы недоступным полный edit
из примеров и требовала отдельного ограничения #259. Принятое решение отделяет
current choices новой конфигурации от обязательных неизменных acquisition facts
и не выдаёт NPC TRAINING/maxW/lifetime journal, XP или gameplay time.

## Последствия и проверка источника

Atlas JSON/Markdown меняются локально: ENM017/020, граница007, existing PATCH и
NEW-VERSION, owning QA/journey witnesses. Новых CTA/routes/workflow нет.
Accepted0092/0093 не переписываются. Whole-object и независимые MD guards вместе
с negative mutations закрепляют kind/confirmation/payment/fact boundaries.

Реальный B16 manifest заморожен побайтно как atlas-v1.21.checksums.sha256.
B17 допускает только явно sealed B0–B16→B17 и identity; прежние edges, manifests,
non-Atlas mechanics/art bytes, replay inputs и frozen Runtime tuple сохраняются.
Проверки включают реальные Git forward/reverse oracles и genuine OLD256/257/258
physical read/original replay с raw rows до первого owning open. Generated только
официальный import; CHECKSUMS пересчитывается инструментом в этой source-поставке.

Source288 не является runtime acceptance259 и не закрывает #188/#113. Runtime
зависимого editor возобновляется после фактического merge/closure/tree proof этой
поставки; exact-SHA independent review, clean five-stage и полный CI обязательны.
