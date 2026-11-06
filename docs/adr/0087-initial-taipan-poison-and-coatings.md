# ADR 0087 — Исходный режим Тайпана и приготовленные покрытия NPC

- **Статус:** принято владельцем, issue #240
- **Дата:** 2026-11-07
- **Основание:** предложение принято целиком вместе с поставкой источников
- **Дополняет:** ADR 0071, 0077, 0084–0086; прежние ADR не переписываются
- **Поставка:** Atlas 1.19/B14; runtime входит в #187

## Подтверждённая граница источников

NPC-015 требует полные предметные профили. Items/07 `activeCoatings`, OP-COAT,
SYM-183, SYM-039/042/045 и Effects GAP-011 задают тип покрытия, источник и
расходование. SYM-183 использует активного Тайпана и его действующий вид яда.
SYM-181 задаёт смену режима; Effects `EFF-SYMBIONT-POISON_MODE` хранит
`activePoisonType`. Эти источники не задают отдельную процедуру formal
initial-state assignment для нового NPC без сыгранной истории.

Числовой `currentAmmo` не является идентичностью отдельного отравленного
снаряда. Items/01 не формализует совместимость болтов; из количества патронов
нельзя вывести магазин, загруженный projectile ID или конкретное попадание.
Горючая слюна требует combat turns. Эти пробелы не заполняются аналогией.

CQA-002/Q-SYM-006 разделяет исходный факт и текущие параметры отделённого
эффекта: ещё не вычисленная величина использует текущий L доступного
источника; при его гибели, удалении или недоступности остаётся последнее
доказанное доступное значение. Поэтому original source snapshot покрытия
нельзя считать вечной заморозкой силы в момент подготовки.

## Принятое решение

В существующем wizard NPC-015/016 разрешается формально задать одну уже
приготовленную дозу. Это отдельный контракт исходного состояния, а не
сыгранное OP-COAT, боевое действие, атака, употребление или отравление.
OE, RNG, immunity и secondary consequences не исполняются.

Для каждого **нового экземпляра** Тайпана GM отдельно выбирает initial
`activePoisonType` из реально изученных SYM-039/042/045. Default отсутствует;
выбор нужен и без покрытий. Это не утверждение о прошедшем часе или сыгранной
смене SYM-181. Retained экземпляр в N+1 сохраняет независимо доказанные
`activePoisonType` и прежние pending mode/timer/anchor, если они были.
OPEN, новая версия и экран покрытия не активируют pending тип и не сбрасывают
его таймер. Изменение существующего режима остаётся SYM-181 с его временем;
новая команда сыгранного переключения здесь не добавляется.

Недоказанный режим не угадывается по последнему покрытию. Для новой дозы
нужен actual active, unsuppressed source instance Тайпана. Тип дозы обязан
совпадать с его независимо доказанным сохранённым активным режимом и изученным
профилем. Выбор другого профиля только в форме покрытия запрещён.

### Носитель и физическая identity

Первый закрытый набор носителей:

- конкретный source-подтверждённый melee weapon attack component;
- отдельный настоящий RES-AMM-001/002 с `quantity=1`;
- настоящий custom пищевой предмет с явными `isFood=true`,
  `canReceivePoison=true` и `quantity=1`.

GM отдельно подтверждает применимость actual поверхности. Это не меняет
template flags других вещей. Одна доза не размножается по linked components
или ammunition stack. Quantity больше 1 требует отдельно составленной
физической строки; скрытые split, расход и остаток не создаются.

Непосредственное покрытие ranged weapon и связывание с числовыми слотами
`currentAmmo` остаются недоступными. Допустим отдельно выбранный настоящий
снаряд, но не выдуманная связь с будущим выстрелом. Это принятое ограничение
initial authoring, а не утверждение, что OP-COAT вообще означает только melee.

На actual surface/physical projectile допускается не больше одной дозы.
Host создаёт отдельный coating UUID только по настоящей immutable preparation;
его домен не пересекается с item/profile/component IDs. Замена требует
отдельного явного подтверждения, новой identity и `replacesCoatingId`.
Снятие требует явной причины. Из пользовательского массива UUID нельзя
вывести скрытую замену. Payload и source binding восстанавливаются из
настоящей операции, actual item graph и original COMMIT.

### Профиль и время

Профиль хранит `effectFamily=POISON`, `poisonSourceKind=SYMBIOTIC`, source
instance, learned rule/profile ID, original source snapshot, typed carrier
и surface, `deliveryKind=COATING`. R20 урона, ослабления и длительности,
Z и anatomy будущей цели явно ABSENT; нули и fake rolls не подставляются.

Подготовленная доза хранит исходную формулу. Половина на оружии/снаряде
либо полный профиль в пище применяется только при будущем delivery:
SYM-045 — длительность, SYM-042 — K, SYM-039 — periodic damage.
До delivery числовой результат не вычисляется; halving не выполняется
заранее и повторно. Новый delivery resolver этот срез не добавляет.

До новой подготовки GM подтверждает виртуальную минуту T. `appliedAt=T`
сохраняется как факт исходного состояния без timezone или Date.now.
Неиспользованная доза не получает выдуманного календарного expiry.
`consumeCondition=FIRST_SUCCESSFUL_HIT` для melee/projectile либо `INGESTION`
для пищи; промах не расходует. CombatId, turn и reaction window отсутствуют.
Первый COMMIT с таким календарным фактом закрепляет начальную минуту по
существующему правилу. Изменение T до save делает preparation stale и не
переподтверждает её автоматически.

### Current/frozen source и immutable история

N+1 сохраняет coating ID, original source snapshot, appliedAt, consume
condition и историю дозы. Отдельный current/frozen source context подтверждён
реальными history/event references. Пока source доступен, будущее вычисление
ещё не рассчитанной величины использует текущий L. После гибели, удаления
или нечитаемости source ещё не вычисленные параметры закрепляются на
последнем доказанном доступном значении. Original snapshot не переписывается.

Недоказанный last-available L нельзя заменить initial preparation или
уровнем другого нового Тайпана. Отключённый, но читаемый источник не становится
недоступным только из-за отключения. Отделённое физическое покрытие не
удаляется автоматически вместе с источником; прямое правило способности
сильнее общего. Новая доза по-прежнему требует актуального active source
и его действующего режима.

PREPARED связывает actual preparation, не будущий COMMIT. COMMITTED связывает
реальный owning COMMIT/version/time. Host независимо восстанавливает origins;
candidate references не доказывают себя. Sole current authenticated campaign
GM, campaign/NPC/attempt/version, physical graph и clock повторно проверяются
на COMMIT. Changed/stale/foreign request даёт zero write. Exact replay
возвращает прежний receipt/IDs, restart не наносит и не расходует дозу.
Старые snapshots, FINAL, receipts и legacy отсутствие полей не переписываются.

## Controls и конечная граница

NPC-015/016 получают реальные controls: source, mode, target, surface,
причина, prepare, отдельное подтверждение замены и явное remove. Pending,
blocked и retained состояние показаны с причиной. Новый mode выбирается
явно; retained mode/pending timer read-only. NPC-015 допускает завершение
mode в NPC-016; уже выбранная доза требует доказанного активного режима.
Final PREVIEW/COMMIT проверяет весь состав, режимы и покрытия совместно.

NPC-017, NPC-003 и NPC-007 показывают original profile/source отдельно
от current/frozen context, carrier/current dose, appliedAt/consume condition
и фактическую историю расходования. Чужие листы и GM-private metadata
игроку не раскрываются. Пустые `activeCoatings[]` явны. Read-only итог
не заменяет controls; новой оболочки NPC не создаётся.

Не включаются freeform ORDINARY/NATURAL/ARTIFICIAL смеси, чужой canonical
poison без source, UNKNOWN магазины, горючая слюна с combat turns,
выдуманная пища/container. CustomMonster без inventory не получает его
ради покрытия (CORE-204). Будущие передача, атака, употребление, mode switch,
combat tick и delivery resolver не являются частью initial authoring.

## Поставка и совместимость

Atlas JSON/Markdown 1.19/B14, required fields, states, CTA/transitions,
COMMIT-only workflow, journey, requirements и QA mirrors обновляются вместе.
Новый guard закрепляет целые объекты и Markdown; существующие predicates
сохраняются, пересекающиеся точные literals/seals пересчитываются по
поставленному source. Generated производится только импортом.

B13 manifest фиксируется отдельно. B14 добавляет только точные forward
пары B0–B13→B14 и B14 identity по ADR 0071, не меняя прежние пары/patches.
CHECKSUMS пересчитывается штатным инструментом после применения согласованной
поставки. Предметные XLSX, Runtime Pack, другие non-Atlas артефакты,
существующие ADR, saved snapshots/receipts/FINAL неизменны.
Source review, author verify, отдельный clean5 и CI точного SHA являются
отдельными доказательствами; source поставка не объявляет runtime #187/#240
завершённым.
