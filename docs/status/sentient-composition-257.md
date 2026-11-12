# Композиция SENTIENT — #257

## Контракт и результат

Основание — CORE-196/216, AQA-005/006, SYM acquisition rules и поставленные
ADR0092 / Atlas1.21/B16 (#284). Технический ADR0093 закрывает durable generation,
план навыков и prefix proof, не меняя игровые правила.

В настоящем ENM-008 GM выбирает ordinary symbionts либо разрешённый UNITED
monster profile, реальные уровни/nodes/bindings. Сервер проверяет species,
capacity, distinctness, L1/prerequisites и финальный effective target level.
PREVIEW и CONFIRM остаются техническими controls; CTA002 переходит к ENM-009
только после FINISH. Отображаются actual interactions/victims/survivors,
подтверждённые rolls и последствия. Нельзя подтвердить старый server selection,
пока controls показывают локально изменённый состав.

Состав даёт source-backed семь постоянных характеристик, maxHP, passives, skills
и inventory consequences. Допустимые learned manual nodes сохраняются как
неисполняемые source facts. Живые surviving specimens начинают с полных ОЭ;
special histories пусты. Monster combat-turn effects не становятся pre-Start
defaults. Итог >35 допустим; итог <1 отказывается, без ручного clamp.

## Начальный план и обязательные факты

ENM-007 задаёт полный initial input с точным заполнением START. Обычное сохранение
идентичного выбора не меняет план. Намеренный полный rebuild того же либо
изменённого input требует явного preview/confirmation. Простой Back/NAV,
discard и replay ничего не пересобирают. Полный rebuild
инвалидирует текущие skills/payments, cached composition/inventory/own choices;
новый initial input оплачивается полностью. UI показывает реальные abandoned
skills/bonuses/charges, прежние состав/предметы, сохраняемые signed FREE losses
и исходные Adviser roll/card facts.

В одном плане START/SYM-166 charges сохраняются при removal/reacquisition,
capacity0 даёт overflow, а не новую пятёрку. Permanent requirement loss освобождает
actual charges и не воскресает после возврата характеристики. GROSS выдаётся
один раз по текущему initial basis, permanent loss фиксируется на actual body;
новый план пересчитывает выдачу без stacking. Lower W само не забывает известное.

FREE сохраняет исходный R6 и actual signed S/M/Z loss между планами; новая база
не возвращает потерю. Advisor сохраняет card/I/W/suppression/initial-fill history,
но current own choices после rebuild подтверждаются отдельно, если карта снова
используется. Можно уйти в PURE/monster/без Advisor без заполнения abandoned card.
Same-card reselect/replay/restart не пересэмплируют rolls.

Resolution point — успешный ENM-009 с настоящим loadout. Поэтому provisional
Skunk C0 может быть исправлен actual sealed/equipped Nate, а UNITED pre-M0 —
source composition. Permanent floor проверяется на полном листе; временная
armor M влияет на availability, не забывает знания и не освобождает charges.
Первое own Advisor fill использует actual body; поздняя temporary impairment
не заставляет повторно exact-fill.

## Хранение, authority и совместимость

Server-only fresh NAV cause несёт closed attempt generation2. planId ссылается
на accepted BUILD command; нового namespace allocator для него нет. Preparation
синхронна, detached и закрыта внутри существующего SQL/schema/source read-only
fence. Каждый historical prepared state заново выводится из собственного prefix,
request и source; поздний чистый cursor не скрывает foreign input или coherently
rehashed подмену actual payment split.

Текущая GM authority обязательна и при known replay. Source/stale/foreign/fault
отказы не записывают partial attempt/template/version/rolls. Player не получает
private state: production probe проверяет forged PATCH/COMMIT/NAV/rebuild,
server payload, DOM и accessibility, включая actual plan/preview/roll identities.

Настоящий #256 fixture взят с прежнего runtime, не создан новым кодом. Тест читает
raw tables до owning open, проверяет physical reopen, original COMMIT replay,
старую ABSENT grammar и неизменные old version/event rows. Legacy preview/discard
не включает modern generation; явный CONFIRM upgrade отделён от обычного старого
редактирования. Current nullable projection summaries не переписывают storage.

## Авторские проверки и пределы

Первый независимый clean verify `fc7b4be` завершился 7412/7413 PASS,
296/297 файлов PASS; единственный отказ — существующий NPC afterEach 30 с,
не body 300 с. [Разбор success cleanup](npc-close-257.md) сохраняет исходный
отказ и ограниченные сравнительные измерения. Уточняется только владение
success close одного теста; runtime, общие hooks/лимиты и старые данные не меняются.
Свежие полные gates/CI нового SHA учитываются отдельно.

Внешний evidence root: `evidence-257-after284`. Logs/started/result сохраняют
HEAD/tree, dirty roster и SHA каждого changed/untracked файла до/после; результат
не приписывается одному HEAD без этих bytes. Ошибочные/прерванные попытки сохранены.

Whole owning suite `host-authoring-whole01` завершился 63 PASS / 1 FAIL из 64:
старый armor test обходил новый explicit-plan contract. Test-only correction
проверена отдельным реальным owning workflow; combined current all64 PASS не
заявлен. Mixed и Advisor cases имеют только отдельные 60-секундные body budgets
по измеренным whole reported totals 23,325/23,153 с и ADR0088. Это headroom,
не исправление таймаута/производительности и не обещание CI достаточности.

Whole web `web-project-06` — 927 PASS / 32 файла с исходными defaults. Новый client
fixture держит настоящие source/SQLite/host derivations и mock Socket boundary;
он не доказывает физическую сеть. Два прежних setup timeouts 10 с сохранены. Убраны
только лишний full projection при construction request и duplicate outer source
validator adapter; owning command/project callbacks не менялись. Один standalone
profile каждого состояния: 9,003→7,697→5,557 с, readFileSync 1924→1464→728 calls,
1,187→0,898→0,471 с измеренного synchronous read time. Wrapper overhead включён;
async I/O/SQL/CPU не измерены, условия не равны CI, исходная slow phase неизвестна.
Sandbox tsx ENOMEM до fixture execution сохранён отдельно как tooling startup.

Production `browser-plan-01` — 3 PASS / 2 файла / 3 attempts, 0 retry/skip/flaky,
0 attempt/global errors.
Strict HTML audit подтвердил 19 final assertions; 34 nested comparison errors
находятся в 17 успешных poll groups, 0 outside. Ordinary path делает actual node
clicks OWL2+DOLPHIN6, mixed UNARMED7→8(cost2)+ACRO1→4(cost3), explicit same-input
rebuild, настоящий EMPTY confirmation, OWL2+TICK1 без нового R6, lost reply,
physical restart и private PLAYER tail. Monster path проходит CHIMERA4 и lost
COMMIT reply. Прежний empty V1 production path также выполнен. Полный discovery
даёт 49 cases / 19 specs; author полный E2E/verify не запускал.

Финальные source/static результаты, независимый review, committed SHA, clean
five-stage и CI учитываются отдельно. #257/#188/#113 здесь не объявлены закрытыми.
N+1, upload, instantiation/placement/combat, PC XP, NPC journal/TRAINING/maxW,
игровое время/сцена и следующие дети исключены. artifacts/generated/RuntimePack44
и исходный art не изменяются.
