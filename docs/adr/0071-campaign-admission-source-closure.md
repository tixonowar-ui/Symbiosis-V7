# ADR 0071 — Источник финального допуска и рабочих копий

- **Статус:** принято; предложения A и B issue #199 одобрены владельцем
- **Дата:** 2026-11-01
- **Дополняет:** ADR 0067, 0068, 0069 и 0070
- **Граница:** новая поставка Atlas и её совместимость; runtime — issue #172

## Основание

В Atlas 1.6 обычная заявка IN_REVIEW не могла открыть рабочую копию до
публикации PROPOSED. NET-007 и GM-020 требовали поля редактора эффектов;
player ACCEPT вёл сразу в PLY-001. Для #172 также отсутствовали адресация
оружейной правки до campaignCharacterId и предложение новой группы до её
создания. Подменять эти источники неявными условиями реализации нельзя.

Владелец одобрил предложение A 2026-10-31 и предложение B 2026-11-01.
Поставляется Atlas **1.7**, дата **2026-11-01**, с прежними schemaVersion 1.2.0
и legacy filenames v1.2. Состав: **376 форм, 1694 перехода, 109 workflow,
2446 QA и 1258 CTA**. Предметные реестры, Runtime Pack и остальные двадцать
artifact paths неизменны. Исторические semantic graphDigest/contentDigest
сохраняются по ADR 0037/0049; новые байты удостоверяет SHA-256 манифест.

## Рабочая копия и границы коммитов

`UI-CMD-ADMISSION-REVIEW-OPEN` создаёт отдельный durable workspace GM_REVIEW
для текущей IN_REVIEW заявки с неизменными FINAL источниками. Он выдаёт
admissionBatchId и стабильные reviewCopyIds, но не campaignCharacterId,
PROPOSED, место, резерв вместимости или полномочия игрока. Повтор возвращает
первоначальную квитанцию отдельно от текущей проекции. Старые команды
предварительного рассмотрения и их квитанции остаются неизменными.

Закрытые составные поля, guards, payload и receipts заданы в acceptanceCriteria
затронутых форм. Неизвестные поля и устаревшие ревизии отклоняются. Каждое
изменение рабочего draft проверяет текущего GM, кампанию, заявку, GM_REVIEW
и отсутствие опубликованного proposal в одной транзакции. Preliminary reject
закрывает доступ к workspace, сохраняя историю. Открытый ранее диалог не
обходит эту проверку.

GM-ACCEPT атомарно публикует весь набор, стабильные campaignCharacterIds,
профили оружия, полный diff и checksum. После публикации draft неизменен.
Player ACCEPT/DECLINE относится только ко всему набору. Новое решение
допускается лишь для pending proposal. Terminal proposal открывается read-only;
новая или противоположная команда не пишет ничего. Exact replay возвращает
первоначальную квитанцию без повторных копий, групп, мест и controller bindings.

Сохранён `J-GM-IMPORT-ADMISSION`: импортированная PROPOSED копия после
NET-028 owner claim остаётся доступной GM для review до публикации финального
diff. `IMPORTED_REVIEW` использует реальные candidate/claim/copy и proposal
revision; ordinary requestId/reviewCopyId/reviewRevision не фабрикуются.
`PUBLISHED_COPY` означает уже опубликованный финальный diff и read-only для
обоих origins. После публикации владельцем импортированной копии считается
подтверждённый claimant, а не несуществующий submitter. Nullable ordinary IDs
в diff/blockers не теряют настоящую candidate/copy provenance. Runtime master
import этим ADR и #172 не добавляется.

## Допустимые правки

- AQ2-002: постоянные мастерские поправки к принятой базе и разрешённые
  начальные навыки. Свободные расовые/классовые grants и исходные натуральные
  броски неизменны. Навык хранит skillKey и targetBonus; CORE-165 определяет
  стоимость слотов, требования и вместимость.
- AQA-010: положительная масса с точностью 0,1; PENDING_MASTER_APPROVAL либо
  APPROVED, без придуманного диапазона массы PC.
- AQ2-004: явно завершённые имущество и деньги либо явное ожидание проверки.
  Деньги выражены RES-CUR-000, нулевая сумма допустима; нет новой валюты или
  придуманного пересчёта D20. Количество предметов — INTEGER ≥1; ноль означает
  отсутствие позиции. Descriptive quality сама не даёт механического бонуса.
- AQ2-005 / Q-CHAR-019: CustomItem bonus действует только в рюкзаке. Он
  пересчитывается отдельно от постоянной поправки и не записывается в базу.

GM-019 сохраняет PATCH_EXISTING существующего экземпляра и REQUEST_REVIEW.
`weaponReviewInputOrNull=null` разрешён только для PATCH_EXISTING. Для
REQUEST_REVIEW существуют закрытые варианты VALIDATED_REQUEST и, исключительно
в admission draft, ADMISSION_GRANT. Первый сохраняет точную исходную заявку
и OP-REQ-VALIDATE receipt. Второй адресует новый reviewItemId, каталоговый тип,
причину и полный canonical template либо GM-defined typed profile, проверенный
по CORE-183/187/188/190. У него нет вымышленного player request или validation
receipt; operationId=null означает подготовку draft, а не вызов OP-REQ-GM или
общей выдачи живого инвентаря. Полный профиль материализуется при GM-ACCEPT.

AQ2-004 / Q-CORE-052 разрешают заменить стартовое оружие другим каталоговым
типом. Это новая предложенная позиция, не изменение itemType старого instance.
Исходная заявка и её решение сохраняются; незавершённую типизированную заявку
нельзя молча удалить заменой инвентаря. NET-019 имеет отдельный вход выдачи,
а успешная staged правка возвращает GM в NET-019. Готовое оружие UNEQUIPPED.

## Полный diff: AdmissionMechanicalSheetV1

Это закрытая техническая проекция, а не новый набор игровых правил. Обе стороны
сравнения имеют `schemaVersion=1` и одинаковый набор обязательных разделов:

| Раздел                                          | Содержимое                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| identity                                        | name, age, sex, massKg; исходные имя/пол/возраст без admission-редактирования                                                                           |
| race, classOrNull, creationMode                 | код и публичное имя из точного источника; отсутствие класса явно null                                                                                   |
| stats                                           | acceptedBase, permanentGmAdjustments, backpackItemAdjustments, skillStageStats, effectiveStats и statProof для всех S/D/M/Z/I/W/C                       |
| skills                                          | все skillKey/label/source/bonus/slotCost, включая неизменные бесплатные grants; maxSlots, usedSlots, remainingSlots и результат проверки требований     |
| symbionts                                       | acceptedIndex, speciesKey/label, status, level, maxOe/currentOe, xp, effectsEnabled, xpEligible, learnedNodes(label/level), binding(kind/side)          |
| advisorOrNull                                   | intelligence, wisdom, suppressionBonusOrNull и полные skills; отсутствие явно null                                                                      |
| permanentGrants, trainingSlotLedger             | исходные once-only grants и maxPermanentWisdom/everIssued, без повторной выдачи                                                                         |
| runtime                                         | весь существующий публичный initialRuntime: HP/maxHP, ресурсы, состояния тела и прочие его поля; изменения производных рассчитываются теми же правилами |
| massReview                                      | статус согласования и масса; источник не объявляется согласованным без решения                                                                          |
| inventoryReview                                 | статус, все позиции/количества/качество, полные типизированные weapon profiles, equipment state и явно незавершённые исходные позиции                   |
| moneyReview                                     | статус и amountOrNull в RES-CUR-000                                                                                                                     |
| groupAssignmentOrNull, locationAssignmentOrNull | закрытые варианты Atlas; у исходного локального листа оба null                                                                                          |

Базовые разделы используют существующую owner-visible механическую проекцию
`local-character-export` на main 10eb5b1. Её публичные nested shapes сохраняются
с перечисленными дополнениями; произвольный JsonObject вместо закрытой схемы
не допустим. Runtime #172 обязан закрепить поля TS-контрактом и проверкой
неизвестных ключей. Natural rolls/receipts показываются отдельным неизменным
источником и не подменяют beforeSheet. Private replay witness, ключи, внутренние
Rule ID и GM-private review metadata в owner diff не включаются.

Сервер строит beforeSheet из проверенного FINAL, afterSheet из полного
проверенного draft и заново вычисляет производные. Изменения содержат section,
fieldPath, beforeValue и afterValue; тип значения соответствует конкретному
полю закрытой схемы. Удаление навыка/предмета, новая характеристика оружия,
HP/maxHP, стоимость слотов и изменившийся бонус показываются явно. Неизменные
разделы остаются в обеих сторонах. Клиент не присылает готовый diff. Checksum
связывает весь упорядоченный batch, ревизию, mappings, листы и blockers.

## Вместимость, назначение и лобби

По решению B PROPOSED не занимает место. После принятия всего набора каждый
персонаж занимает одно место, даже если неподтверждённые масса или имущество
оставляют его в лобби. Поэтому occupiedCampaignPlaceCount отделён от activePcCount;
fresh capacity и единственный controller проверяются атомарно при ACCEPT.
Структурная ошибка не превращается в допустимый lobby blocker.

EXISTING ссылается на реальную группу. NEW использует стабильный batch-scoped
groupDraftId, а не совпадение имён. START ссылается на единственную стартовую
группу кампании. Финальные groupIds и назначения создаются либо переиспользуются
атомарно при player ACCEPT. Start в #173 использует эти идентичности повторно.
Location/subLocation — явно введённые GM метки; они не создают сцену, координаты,
clock или marker.

ACCEPT в PAUSED ведёт в owner-only NET-006 с явными blockers и без Ready/Start.
GM_REJECTED с настоящей причиной и PLAYER_DECLINED без вымышленной причины
ведут в NET-007. При живой technical session возможен новый выбор NET-003;
выход APP-002 не удаляет историю. Preliminary reject по-прежнему ведёт NET-005.

Для MASTER_IMPORT сохраняется подписанный return envelope NET-028: удалённый
claimant возвращается APP-002, LOCAL_HANDOFF — только через PLY-030. Server-held
GM context не попадает в player payload. Новый retry NET-003 доступен лишь
DEVICE_REQUEST и не отправляет импортированного кандидата как обычную заявку.

## Совместимость и проверка

B0 — точная поставка Atlas 1.5, B1 — 1.6, B2 — данная 1.7. Разрешены только
точные пары B0→B1, B0→B2, B1→B2 и тождественное чтение. Будущая версия,
обратное обновление, дрейф любого из двадцати остальных источников или 24
механических replay inputs не совместимы автоматически. Старые snapshot bytes,
baseline IDs и receipts не переписываются; текущая поставка проверяется заново.

Прежние guards сохраняются; только явно затронутые A/B literals и object seals
обновляются по этому ADR. Дополнительный guard закрепляет целые затронутые
формы, workflow, journey, requirement, QA и global/out/in переходы. Markdown
проверяется отдельно. Mutation tests должны ловить ранние final IDs/authority,
эффектные поля, stale edits, неполный diff, потерю typed grant и обход terminal
decision. Отдельные проверки на реальных байтах подтверждают B0/B1/B2 replay.

Эта поставка не реализует runtime #172 и не закрывает его. Приёмка runtime
требует самостоятельного независимого ревью, полного прогона и зелёного CI.
