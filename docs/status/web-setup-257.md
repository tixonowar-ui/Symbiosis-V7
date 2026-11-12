# Подготовка web-группы #257: локальный бюджет

## Отказ и область изменения

Полный независимый clean verify кандидата
`1dcda8b9c0876a8ae2323b3c423ccc598ca56e19` завершился:
7395 PASS / 18 skipped из 7413 тестов, 296 PASS / 1 failed suite из 297 файлов.
Единственная ошибка — `Hook timed out in 10000ms` в beforeAll группы
`source-backed composition controls and confirmed wire boundary`,
`src/web/forms/enm/enemy-authoring.test.tsx:417`. Отдельных упавших assertions нет.
Vitest — 5173,43 с; весь wrapper — 5390,437 с. Исправленный NPC cleanup case
и его файл входят в прошедшие тесты; прежний NPC-отказ сохранён отдельно.

Исходный log SHA-256:
`33e0472b67c8413a6f0dd3549f14bbc3bffc2fc6440801971a60257c8a0f32db`.
Внешний аудит — `clean-failure257-r2-audit.json`; исходные logs/result сохранены
в `clean-evidence257-r2/20261112T030918563Z-3ed7e46d4cd54cf685c4d7239950d666`.

Владелец явно ответил: «Разрешить локальный hook 30 с (рекомендуется)».
Утверждённый внешний proposal `proposal257-web-setup-hook.md` имеет SHA-256
`292030905fdbd51644a55ff92427b58794c0a46402ae855fbd07687006189c98`.
Это отдельное исключение по ADR0088, пункт 3: hook обслуживает 18 тестов,
поэтому прежнее разрешение на индивидуальные case budgets к нему не применялось.

Меняется одна строка: explicit `30_000` у этого beforeAll вместо inherited 10 с.
В файле остаются все 33 теста, исходные assertions и cleanup. Factory, 10 реальных
PATCH, 4 внешних NAV, все 7 настоящих project/decode captures, production guards,
данные, остальные hooks и общие defaults, workers, retries, CI и runtime не меняются.
Receipt-chain и удаление двух captures не применяются.

## Ограниченные измерения

На двух свежих изолированных копиях точного кандидата root выполнил по одному
standalone профилю неизменённой factory с измерительным overlay. Независимые
аудиты `review257-web-profile-run01.json` и `review257-web-fine-profile01.json`
подтвердили source bindings, порядок всех 71/111 меток, завершение и отсутствие
оставшихся owned процессов. Factory заняла 5580,6251 / 5582,1348 мс.
Первый профиль: 728 synchronous reads, суммарно 477,0565 мс внутри readFileSync;
фаза вызова `f.close()` с overhead наблюдения — 75,7719 мс; это не отдельное
измерение exclusive native SQLite close.

Второй профиль разделяет metadata и command: metadata всех 10 PATCH занимает
122,9277 мс без synchronous reads; настоящие commands — 2401,6114 мс и 460 reads.
Два неиспользуемых captures занимают 193,5353 мс. Их суммарное исключение даёт
не более примерно 5,7% до overhead замены и не доказывает достаточный запас.
Проверки source/history/authority не сокращались.

Первый log / measurement SHA-256:
`9693db876752c2e007e9e089f6d9058bed490387ba29952a2bdc2b84ed2f4fad` /
`cad312eaa0c910d55fe68baee5ef2464b73820e5e9ce83e5bdc364e69f0a242d`.
Второй log / measurement SHA-256:
`ee993b5711b5b898bd92483f9a13cb482034f789f0fe0379c5a480838a23fe67` /
`80615c7089448eb7bdad3a35dd326853bceba579cf79524cd0e53ffc00223de6`.
Пакеты находятся во внешнем `evidence-257-after284/web-setup-r2-prep` и
`web-setup-r2-fine-prep`; первый пакет и его копия не перезаписывались.

Профили учитывают observer overhead, но не воспроизводят Vitest/jsdom или
нагрузку полного набора. Сумма readFileSync не измеряет весь I/O, SQL и CPU.
Причина исходного timeout и его exclusive slow phase не установлены.

30 с — конечный тройной запас относительно прежнего deadline, а не latency SLA,
ускорение или исправление причины. Его достаточность для полной проверки ещё
должна подтвердиться новыми clean five-stage/CI на окончательном SHA.
Исходный отказ не переименован в PASS; другие бюджеты этим решением не изменены.

## Целевая проверка разрешённой правки

Один обычный `npm test -- --project web` без diagnostic overlay завершился:
927 PASS / 32 файла, без skips и ошибок; Vitest — 51,90 с. Исходники до/после
совпадают, test source SHA-256:
`ab4adf3f33c780f907d00f580410d7cf4d83e02a5abb4364e2b36d2d28504414`.
Log SHA-256:
`3fb406a1c06d1ac875d0ff062245ad6c179185fa661e926b12cebe61e3a93491`.
Внешний пакет — `evidence-257-after284/web-hook-owner-checks`, record
`web-project-hook30-01`; он сохраняет argv/env и 43 source/control hashes.
Typecheck, scoped ESLint, формат четырёх путей, checksums (25 файлов) и
traceability verify также завершились exit0. Это dirty scoped evidence;
новый committed SHA, independent clean five-stage и CI пока не приняты.
