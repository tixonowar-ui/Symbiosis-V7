# Состояние модулей

Честная карта: где готовый код, который трогать не надо, а где дыра.
Обновляется в каждом PR, меняющем состояние модуля.

## Application #171 — интеграция

Player-срез f9a6a539 локально объединён с разрешённой поставкой #177/lineage #190
на 5e929973. GM runtime, shared transport и client wiring ещё интегрируются;
полный #171 не готов к merge. Старые 3539 tests / 36 E2E не объявляются
результатом новой ветки. Полные итоговые проверки и фактический PR-size замер
будут выполнены после завершения GM journey.

## Source-снимок #177 — 2026-10-30

База `24c726c`: #190 смёржена через PR #193 после независимого полного
verify 150/3211, 34/34 production E2E без retry и зелёного CI на том же SHA.
Первый CI timeout старого AUTO Advisor не объявлен исправленным: локальная
парная диагностика прошла, один повтор CI без изменений дал 3211/3211 и 34/34.

Поставлен Atlas 1.6: 376 forms, 1688 transitions, 108 workflows, 2445 QA,
1252 CTA. NET-017 описывает отдельный preliminary request review; изменённые
NET-003/005 и CMP-006 согласованы с ним. NET-018–022/027 и конечный admission
сохранены. Новые JSON/Markdown guards защищают контракт и зеркала, прежние
семантические проверки сохранены. [ADR 0069](../adr/0069-device-request-review-atlas-amendment.md).

Это source/guard-поставка: GM queue/decisions не опубликованы в приложении,
draft PR #185 остаётся неполным до завершения #171. Проверки текущей поставки
фиксируются в PR и [handoff](handoff.md); перед merge обязательны независимый
полный verify/E2E окончательного committed SHA и зелёный CI.

## Исторический срез #190

База `fe5823d`: PR #189 (#184) и тестовый PR #192 (#191) смёржены. Политика
и native binary comparisons подтянуты в #185. Независимые проверки базы: 148 файлов /
3199 тестов, 34 production E2E без retry; CI зелёный. Ниже сохранён прежний
снимок инфраструктуры #182; прикладной #171 пока находится в отдельном draft.

В #190 loader/resolver отличает current baseline от запечатанного исторического
context B0/B1. Archive/candidate и read/replay сохранённой кампании сохраняют
исходные ID/bytes/receipts; проверяются manifests, 24 catalog inputs, tuple и
authority context. Точные filesystem freshness guards сохраняются. SQL/schema,
артефакты и опубликованные формы не меняются. [ADR 0068](../adr/0068-verified-artifact-baseline-lineage.md).

Поставка Atlas 1.6 #177 ещё не применена: её реальные bytes используются только
в проверяемом patch fixture. Application-only integration peer/SQL/discovery
остаётся в #171. Полные verify/E2E и независимый final-SHA review обязательны
до merge текущего среза; результаты фиксируются в PR и [handoff](handoff.md).

## Предыдущий снимок #182

- Снимок: `2026-10-30`, инфраструктурная предпосылка #182 для #171 поверх PR #180 (#179).
- Подтверждённая база `03bf13b`: 134 файла / 2499 Vitest-тестов и 34 Chrome E2E
  без retry; независимый final-SHA прогон и CI прошли перед merge.
- Текущий срез добавляет LAN parser/discovery, private installation keys,
  authenticated peer channel, FINAL evidence, current campaign reader и local tabs.
  NET UI, application request runtime и решения GM ещё не опубликованы.
  Полные проверки текущей подготовки фиксируются в [handoff](handoff.md).
- Артефакты и конвейер не менялись. Воспроизводимость проверяется отдельным
  CI-гейтом на чистом checkout.
- Vitest выполняет не более четырёх suites одновременно; причина и измерения
  native Atlas clone allocation — [issue #160](vitest-atlas-memory.md).

## Легенда

| Метка        | Значение                                          |
| ------------ | ------------------------------------------------- |
| **готов**    | работает, покрыт тестами, менять только по задаче |
| **частично** | работает не полностью, границы описаны ниже       |
| **заглушка** | файл или каталог есть, содержимого нет            |
| **не начат** | пусто                                             |

---

## tools/ — инструменты

| Модуль                        | Состояние    | Тесты    | Примечание                                                                                |
| ----------------------------- | ------------ | -------- | ----------------------------------------------------------------------------------------- |
| `tools/checksums`             | **готов**    | косвенно | SHA-256 манифест, гейт перед импортом. Проверен на срабатывание                           |
| `tools/import/lib`            | **готов**    | 18       | чтение xlsx и zip, fail-closed JSON, детерминированная запись, медиа по якорям OOXML      |
| `tools/import/atlas`          | **готов**    | 467      | Atlas v1.6; единственный полный `forms-by-id`; 1 252 actionKey/label, 3 renderer-индекса  |
| `tools/import/rules`          | **готов**    | 11       | 739 карточек, 699 активных, 40 tombstone                                                  |
| `tools/import/character`      | **готов**    | 12       | 1144 payload-сущности, 9 секций XP-контракта                                              |
| `tools/import/items`          | **готов**    | 11       | 64 типа предметов, 64 иконки в `generated/media`                                          |
| `tools/import/effects`        | **готов**    | 15       | 67 типов эффектов, 66 моделируемых                                                        |
| `tools/import/bestiary`       | **готов**    | 12       | 16 видов, 17 статблоков, 16 артов                                                         |
| `tools/import/sentient`       | **готов**    | 16       | 44 замороженных шаблона, 44 арта, Runtime Pack                                            |
| `tools/import/portraits`      | **готов**    | 9        | exact пакет из 6 портретов локального персонажа по ADR 0036                               |
| `tools/import/symbiont-media` | **готов**    | 16       | 23 SpeciesKey, 23 арта и 23 изображения деревьев; exact anchors и PNG bytes               |
| `tools/import/qna`            | **готов**    | 11       | 444 вопроса, 411 адресуемых кодов, алиас `Q-MON-089` по ADR 0017                          |
| `tools/import/seed`           | **готов**    | 5        | 114 таблиц, 20 302 строки, 9 паспортов; детерминизм на SQLite 3.53.4                      |
| `tools/validate`              | **готов**    | 376      | forms/QA и JSON/md guard-зеркала, raw guard, renderer-каталоги и кросс-реестровые ссылки. |
| `tools/traceability`          | **готов**    | 17       | детерминированная матрица ID, покрытия и расхождений из renderer-каталога форм            |
| `tools/reproducibility`       | **готов**    | 11       | два импорта, полный состав файлов и SHA-256, включая игнорируемые media и seed            |
| `tools/package`               | **не начат** | —        | portable-сборка под Windows x64. Веха M9                                                  |

Трассируемость, воспроизводимость и непустые тестовые прогоны проверяются в CI;
диагностика E2E сохраняется и после успешного retry. Порядок проверки и чтения
отчётов — [проверки CI](../process/ci-checks.md).

## src/ — приложение

Shared wire v1, exact v2 navigation/reconnect и exact v3 identity-draft готовы;
минимальный roll contract и каркас handler-реестров также готовы. Persistence
реализует первый V1-срез, web собирается в self-contained статику, а штатный
`npm start` замыкает подтверждённый presentation-путь
`APP-001 → APP-002 → CHR-001 → APP-004 → APP-002`. Первый срез identity-draft
подтверждает на host full replacement с nullable `MALE|FEMALE` sex и
восстанавливает outstanding update после reconnect того же mounted instance.
Подтверждённый Continue атомарно сохраняет exact десятиполевый первый checkpoint:
host отправляет terminal result/replay wire v1 перед exact `CHR-010` snapshot
wire v2, а reconnect и restart восстанавливают то же durable назначение. Локальная
библиотека читается при каждой проекции и получает отдельную runtime-ревизию,
поэтому сохранённый черновик виден в `APP-004` без перезапуска host. Web после
checkpoint замораживает идентичность, а `CHR-010::CTA::004..006` меняют только
client-local выбор расы без wire-трафика. `CHR-010`, `CHR-016` и `CHR-002`
получают host-signed каталоги последствий и до подтверждения сравнивают
source-backed race/mode/method facts; условные race modifiers остаются двумя
целыми ветвями `MANUAL|RANDOM`, `GrantedSkillRefs` показывается именованным
бесплатным навыком либо положительным отсутствием, а player payload не раскрывает
внутренний провенанс каталогов. `CHR-001` выбирает exact catalog
placeholder либо локальный PNG/JPEG по сигнатуре, допускает замену и снятие и
показывает host-отказ как ошибку поля. `SET-DECIDE` затем сохраняет три
append-only решения и проводит normal path через `CHR-016`, `CHR-036` до
initial `CHR-002`; `PURE` host-authoritatively минует `CHR-016`. Селекторы
метода на `CHR-002` local-only до подтверждения: оно атомарно создаёт первый
addressed set request и открывает `CHR-003`. Первый показ семи D20 и очередь
подтверждений натуральных `1/20` durable и необратимы. `CHR-005`–`CHR-008`
принимают набор либо открывают `CHR-028` поверх исходного screen: `CANCEL`
закрывает dialog presentation-only, а `CONFIRM` сохраняет abandonment и
следующую попытку либо point-buy. Ordered attempts сохраняют provenance;
пятая попытка `ALL_OR_NOTHING` допускает только принятие. `CHR-009` назначает
набор по индексам либо проверяет point-buy 90/85, сохраняя provenance каждого
критического штрафа. `UNITED` и `FREE` переходят прямо на read-only `CHR-012`,
а `PURE` сначала выбирает класс на `CHR-011`; host выводит обязательный навык и
пересчитывает base + race + class существующим domain-каталогом. Следующий
checkpoint фиксирует eligibility baseline и открывает очищенный каталог
`CHR-013`; его карточки и eligible options `CHR-015` дословно несут поставленную
область действия и явное наличие либо отсутствие штрафа без навыка. Addressable
`CHR-014` восстанавливает host-signed `skillId` после reconnect/restart, объясняет
failed requirements без internal IDs и добавляет навык только после явного
signed level. После partial add карточку следующего навыка можно открыть через
safe-return из `CHR-015/PARTIAL`, включая read-only ineligible навык; `NONE` и
`EXACT` этого safe-return не получают. Повторный `CHR-013::CTA::002` возвращает
в существующий `CHR-015/PARTIAL` без protocol-error и новых receipts; начальный
`NONE` требует пустой набор, а `EXACT` и пустой `PARTIAL` отклоняются.
`CHR-015` различает `NONE|PARTIAL|EXACT`: card add сохраняет полный canonical
набор и возвращает mutable partial presentation, а финальный durable checkpoint
по-прежнему требует exact-fill и остаётся actionless. Последовательные
добавления сохраняют обе card-add записи и восстанавливаются после
replay/restart. Классовый навык
учитывается один раз, бесплатный навык `UNITED` не занимает слот. Random slice
#135 продолжает путь: `CHR-017` публикует sanitized catalog и открывает `CHR-020`
с append-only physical records, duplicates, critical/monster outcomes и
binding-only commit. Random Advisor получает durable I/W и exact-fill через
`CHR-041`; read-only `CHR-019` показывает composition, interactions и
modifier-only breakdown без generic effective-stat engine.
Replay/refresh/reconnect/restart и historic recovery сохраняют
sequence/receipts без нового seed или sampler. Web рисует все четыре формы
random slice и local drafts. #147 добавляет отдельный будущий минимум
интеллекта: RANDOM records не изменились, MANUAL получил B-specific stage с
host-signed composition, двумя I/W и exact-fill навыков. Один addressed B
request/receipt восстанавливается после replay/refresh/reconnect/restart/SQLite
reopen без нового sampler; подтверждение навыков до B блокируется. Web строго
различает RANDOM/MANUAL и показывает назначение и результат без seed/RNG state.
B-specific fixture #147 сам по себе не был playable manual composition. #145
создаёт `manualCompositionStage` лениво на первом валидном add и добавляет
полные replacement checkpoints, addressable `CHR-018` с art/tree и bindings,
Advisor I/W/B/skills с continuity после remove/re-add и exact-diff `CHR-042`.
#146 добавляет стартовый armorBundle: атомарное подтверждение взаимодействий уже
с первой composition record, transactional rollback, RANDOM/MANUAL
safe-return/resume с persisted presentation validation и source-backed
read-only preview брони без внутренних Rule IDs. Bundle остаётся
`OWNED_NOT_EQUIPPED`. Локальное удаление не сохраняется как неполный
состав и сбрасывается после reconnect; presentation migration `0005` не хранит
вторую composition authority. Одиннадцать production Playwright-сценариев проходят
RANDOM FREE EEL и UNITED ADVISER, карточки `CHR-014`, ручной FREE
replacement/restart, UNITED Advisor, TROGR+ADVISER, а также MANUAL/UNITED/RANDOM
armorBundle через Fastify+WS/SQLite.
#151 продолжает этот путь на CHR-022: атомарно создаёт запрос качества оружия,
публикует совместимый с расой каталог типа/варианта и read-only требования.
Один D20 сохраняется навсегда, качество остаётся рекомендацией; safe-return к
броне и resume сохраняют оба результата. Старые armor checkpoints получают
явный entry без переписывания прежних receipts.
#152 публикует CHR-023/024/031 и атомарно связывает profile request с weapon
checkpoint. Проверка 22 формул требует один общий L/Lw/Ls, все независимые
значения дайсов и заявленные выходы без RNG. Полный эффективный профиль,
proof и свидетельства `PLAYER_WITNESS` сохраняются и пересчитываются при
загрузке; min/max не заменяют достижимость. PURE получает явный пустой состав
и pending броню на существующем финальном checkpoint навыков, а исторические
записи требуют явного reconfirm без замены старого receipt. Fixed-профиль
read-only. INVALID восстанавливает CHR-031 и подписанный возврат; safe-return
сохраняет броню, оружие и ввод. [ADR 0059](../adr/0059-weapon-profiles-and-pure-entry.md).
#153 публикует CHR-038: отдельный immutable D20 AUTO/MANUAL даёт только
рекомендацию достатка. Точная денежная шкала CORE-172 проверяется по источнику;
сумма не вычисляется, `gmFinalizationRequired=true` сохраняется. Новый profile
receipt атомарно связывает pending money request; у исторического профиля
адрес продолжения детерминирован и материализуется первым money roll без
повторного submit и без записи при чтении. Safe-return через CHR-022 и свою
ветвь профиля, replay и restart сохраняют результаты.
[ADR 0060](../adr/0060-starting-money.md).
#154 публикует CHR-037: ровно пять позиций с положительным целым количеством,
каждая с отдельным D20 и immutable receipt. Доступны 62 типа с явным разрешением
инвентаря и описательная категория GEN-010. Выбор остальных позиций остаётся
редактируемым после первого броска; уже зафиксированные не заменяются.
Safe-return к деньгам и SQLite reopen сохраняют весь набор.
[ADR 0061](../adr/0061-five-starting-positions.md).
#155 публикует CHR-032 с восемью физическими receipts и CHR-025 с вычисленными
blockers. Исправления связаны с текущим checkpoint и головой append-only
журнала; раса, класс, навыки и состав пересчитываются без повторного броска
принятой базы и без потери имущественных результатов. Активные механики,
постоянные grants и ledger обучения проверяются по источникам. Кэши RANDOM,
MANUAL и Советника восстанавливаются при переключениях. Финальный save
атомарно фиксирует snapshot, receipt и FINAL того же localCharacterId;
replay и SQLite reopen не создают второго персонажа.
[ADR 0062](../adr/0062-creation-validation-and-final-save.md).
#156 публикует финальный лист CHR-040: его механика и история создания
неизменны, локальные имя, описание и арт версионируются отдельно. CHR-026 и
APP-009 восстанавливают только доказанный полный checkpoint, включая его
подписанный экран и слой CHR-031. Диагностика повреждённого незавершённого
intent появляется после его фактического удаления. CHR-039 показывает
неизменяемые версии веток и возвращает к исходному шагу без активации ветки.
Подписанный выбор строки APP-004 связан с владельцем устройства; null в
публичном localOwnerIdOrNull обычной библиотеки сохраняется. APP-010 создаёт
вариант с новым UUID и только тремя полями метаданных либо экспортирует
канонические UTF-8 байты с baseline, provenance и SHA-256. Первый IDENTITY
checkpoint варианта проверяет birth receipt и инициализирует обычный DRAFT.
Post-save scope фиксирует конкретный вход; receipt cursor записывается
атомарно и закрывается следующим подтверждённым checkpoint. GM export
поддержан через отдельный доверенный архивный fixture; CMP-012 и campaign
runtime этим не реализованы.
[ADR 0063](../adr/0063-local-character-recovery-and-export.md) принят в PR #176.
Срез #170 реализует APP-011 и CMP-001–006: отдельный durable GM context,
черновик, write-only секрет, actual bind/baseline preflight и атомарный
CREATE. QR реально декодируется; восстановление сохраняет campaign/receipt.
Финальный допуск в кампанию, Start, игровой clock и сцены ещё не реализованы.

#182 слита в PR #183 и реализует технический фундамент: private installation identity
и peer channel, LAN discovery, immutable FINAL evidence и owner-bound local tab
entry/close. Source assertions NET-001–005/009–012 и CHR-027 не регистрируют формы
и не расширяют player authority. [ADR 0067](../adr/0067-private-campaign-network-foundation.md)
принят для APIs; прикладной [ADR 0066](../adr/0066-device-connection-and-admission-request.md)
остаётся предложенным.

В #171 рабочая ветка связывает этот фундамент с player NET UI, local/host
журналами и ограниченным peer executor. APP-002 и текущий FINAL CHR-040
дают явные входы. Адрес или QR заполняют ввод, OPEN подтверждает только
техническую сессию, SUBMIT передаёт один pinned batch из 1–3 собственных FINAL,
CANCEL требует подтверждённую локальную причину. Сессия и input lane не
являются campaign seat и не резервируют вместимость. Исходная контрольная
сумма механики отделена от контрольной суммы безопасного экспорта.
Resume использует известный opaque scope, сохраняет command ID и различает
immutable ACK от текущего состояния; неизвестный исход удерживает pending
команду. После подтверждённого выхода восстанавливается собственный APP-002
или CHR-040 без создания нового входа. Новые формы зарегистрированы только
в рабочей ветке; готовность полного #171 ещё не подтверждена.
Предварительные решения мастера, NET-017 и новые GM-команды не добавлены:
нужен [#177](https://github.com/tixonowar-ui/Symbiosis-V7/issues/177).

Текущая очередь — завершить #171, затем #172 → #173 → #174 → #113. Для #113
исходный арт подготовлен; мастерский runtime NPC/ENM/GM ещё не начат.
Остальные прикладные слои остаются частичными, заглушками или не начаты.

| Слой                         | Состояние    | Что нужно / реализовано                                                                         | Веха |
| ---------------------------- | ------------ | ----------------------------------------------------------------------------------------------- | ---- |
| `src/shared`                 | **частично** | прежние wire v1/v2/v3 готовы; closed NET projection/draft/resume contracts добавлены в WIP #171 | M4   |
| `src/domain/rules`           | **частично** | создание, итоговая механика, удержание навыков, постоянные grants и начальное runtime           | M3   |
| `src/domain/entities`        | **частично** | roll source/face/replay contract; lifecycle-переходов ещё нет                                   | M3   |
| `src/persistence`            | **частично** | character/post-save; local application/outbox и hosted request journals в WIP #171              | M2   |
| `src/persistence/migrations` | **частично** | `0001`–`0009` готовы; `0010` добавляет восемь NET sidecar-таблиц в WIP #171                     | M2   |
| `src/host`                   | **частично** | character/post-save, CREATE PAUSED; local NET coordinator и peer runtime в WIP #171             | M4   |
| `src/host/projections`       | **частично** | прежние APP/CHR/CMP; NET-001–005/011 и CHR-027 добавлены в WIP #171                             | M4   |
| `src/web`                    | **частично** | character/post-save/CMP; player NET UI и recovery в WIP #171, новый E2E ещё падает              | M5   |
| `src/web/renderer`           | **частично** | NET-001–005/011 и CHR-027 зарегистрированы в WIP #171; неизвестные формы fail-closed            | M5   |
| `src/web/forms`              | **частично** | character/CMP и player NET inputs, confirmed CANCEL_REASON, local QR decoder в WIP #171         | M6   |

### Новые модули #171 — рабочая ветка

| Модуль                                                                                                 | Текущее состояние                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/network-application*.ts`                                                                   | Закрытые public DTO и deep validator семи форм; NET draft/resume wire v3.                                                        |
| `src/persistence/network-local-application.ts`, `network-device-request.ts`                            | Local intent/outbox/ACK, pins и pinned FINAL batch; отдельные hosted sessions/requests/receipts.                                 |
| `src/host/campaign-network-endpoint.ts`, `campaign-network-executor.ts`, `campaign-network-runtime.ts` | Реальные held listeners, ограниченные transport leases и lifecycle сетевой кампании.                                             |
| `src/host/device-admission-peer-runtime.ts`, `device-admission-peer-response.ts`                       | OPEN/SUBMIT/CANCEL/RECOVER через authenticated Node channel, current view отдельно от immutable receipt.                         |
| `src/host/network-local-peer.ts`, `network-application.ts`                                             | Локальный coordinator, explicit entry/resume/exit, discovery/locator, проверка FINAL и восстановление outbox.                    |
| `src/host/projections/net-application.ts`                                                              | Собственная sanitized projection, точные route bindings и доступные source CTAs; 37 focused-тестов.                              |
| `src/web/forms/net`, `src/web/ws-client.ts`                                                            | Подтверждённые drafts, выбор FINAL, QR из локального изображения и recovery; 304 web-теста до последнего изменения action guard. |

Все строки этой таблицы относятся к незавершённому #171. Полный verify,
production E2E и независимая проверка окончательного SHA ещё требуются;
покрытие форм перегенерируется штатным traceability CLI после стабилизации.

## generated/ — вывод конвейера

| Каталог           | Состояние | В git | Объём                                    |
| ----------------- | --------- | ----- | ---------------------------------------- |
| `generated/spec`  | **готов** | да    | 129 JSON-файлов, 29,71 МиБ               |
| `generated/types` | **готов** | да    | 10 TS-файлов                             |
| `generated/media` | **готов** | нет   | 176 изображений, 73,16 МиБ               |
| `generated/seed`  | **готов** | нет   | 1 SQLite-файл, 22,39 МиБ; пересобирается |

## tests/

| Каталог             | Состояние    | Примечание                                                                                                           |
| ------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `tests/integration` | **не начат** | кросс-слойные тесты. Появятся с M2                                                                                   |
| `tests/e2e`         | **частично** | 34 прежних production-сценария; новый NET двух Node/SQLite и Chrome добавлен, CANCEL после общего restart ещё падает |
| `tests/fixtures`    | **частично** | source-backed fixtures, изолированный SQLite host harness; новый двухпроцессный NET harness в WIP #171               |

---

## Срезанные углы и осознанные упрощения

Это не недоработки — это решения. Не «чинить» без обсуждения.

| Что                                                             | Почему так                                                                                                                                                                                                                                             | Где записано                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 12 типов связи правил не нормализованы                          | `уточняет` и `Уточняет / имеет приоритет` выглядят синонимами, но склейка была бы придуманной эквивалентностью                                                                                                                                         | [ADR 0015](../adr/0015-import-pipeline-guarantees.md)                   |
| Тексты правил перенесены как данные                             | превращение «Итогового алгоритма» в код — это M3, там каждое правило требует своего решения                                                                                                                                                            | [ROADMAP](../ROADMAP.md)                                                |
| `16_Отбор_автоматизации` не сверяется с каталогом правил        | колонки содержат составные (`SYM-131#MI_MI_MI`) и многозначные (`SYM-084; SYM-085`) строки                                                                                                                                                             | комментарий в `tools/import/character.ts`                               |
| Колонки `Rule refs` в Effects не сверяются                      | многозначные и с диапазонами (`CORE-155–156; CQA-001`)                                                                                                                                                                                                 | комментарий в `tools/import/effects.ts`                                 |
| `10_Иммунитеты / Effect family` не сверяется                    | другой словарь (`POISON`, `FIRE`), а не `FamilyCode`; наивная сверка дала бы 14 ложных промахов из 20                                                                                                                                                  | комментарий в `tools/import/effects.ts`                                 |
| `00_Паспорт` Effects и `00_Сводка` Бестиария не импортируются   | дублирующиеся имена колонок в шапке                                                                                                                                                                                                                    | `meta.json` соответствующих разделов                                    |
| Wire v1 принимает последний member при повторённом имени в JSON | значение проходит полную проверку, encoder дублей не создаёт; запрет потребовал бы второй реализации грамматики. Формулировка «в v1» намеренная: это версия протокола, а не правка задачи                                                              | [ADR 0020](../adr/0020-wire-protocol-and-shared-contracts.md), раздел 1 |
| 15 полей `PLY-030` не типизированы на wire-границе              | их формирует host projector внутри opaque projection payload, а не клиентская мутация; wire защищает отдельно server-issued `returnContext` и не принимает client-supplied authority. Типизация в `src/shared` пригласила бы клиента их конструировать | [ADR 0020](../adr/0020-wire-protocol-and-shared-contracts.md), раздел 5 |

## Замечание по данным артефакта

`15_Иконки_предметов` в собственном описании называет два визуальных статуса,
но две строки (`RES-MAG-001`, `RES-MAG-002`) несут третий —
`PROVISIONAL_ENTITY`, не определённый ни в преамбуле, ни в справочнике.
Значение перенесено как есть. Если оно важно для UI — вопрос к автору
артефакта, не к коду.

В Q&A-реестре код `Q-MON-083` занят двумя несвязанными закрытыми вопросами —
строками №248 и №367. Строка №367 переносится дословно, но в индексе адресуется
как `Q-MON-089` по [ADR 0017](../adr/0017-qna-question-code-alias.md); область
алиаса намеренно ограничена этой строкой.
