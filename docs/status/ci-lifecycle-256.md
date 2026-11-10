# #256 — два локальных ожидания LIFECYCLE

CI `42859375721` кандидата `c265e9f001cc30dd1b69160e7240c414a62931c2`
(tree `786efadaa6716596e87131ec7f9cc22f930e1784`) завершил Vitest 7321/292,
но LIFECYCLE отказал в обеих разрешённых попытках; остальные 46 E2E прошли.
Полный локальный clean gate этого SHA прошёл ранее. Эти результаты относятся
только к прежнему кандидату, не к последующей правке теста.

В `tests/e2e/network-application.spec.ts` случай
`NET final admission LIFECYCLE preserves the source and restores the whole decision on both installations`
дважды упёрся в matcher budget 5000 мс:

- первая попытка — enabled selector NET-020 после Save: browser API 5009,336 мс,
  wrapper 5025,970 мс; edit отправлен, matching result до catch отсутствует;
- retry — accepted-review text PLAYER: browser API 5005,146 мс, wrapper
  5011,505 мс. After-snapshot через 2,324 мс после API failure уже содержит
  точный текст; raw wire к catch содержит ACCEPT receipt и IN_REVIEW projection.

Это не body/hook/job timeout. Точная исходная send→result latency неизвестна:
wire не имел timestamps. Завершение первой CI edit после catch и её конечное
состояние SQLite не доказаны: временная база удалена штатным cleanup.
Причина вариативности нагрузки CI не установлена; больший wait её не исправляет.

## Конечная диагностика

В двух новых изолированных копиях exact base `efeb31a…` и candidate `c265e9f…`
выполнено ровно по одному LIFECYCLE: production Chrome/host/WS/disk SQLite,
1 worker, 0 retry, одинаковый диагностический overlay. Только два указанных
wait получили 30000 мс; body 360000 мс и все assertions/restart/cleanup сохранены.
Read-only SQL snapshots сняты вне измеряемых фаз. Original bytes, diff/file
hashes, executable/argv/env, npm ci/import/build и traces сохранены внешне.

Base initial metadata не записала NODE_OPTIONS: сохранено только явно позднее
наблюдение launcher environment. У candidate это поле записано до запуска;
одинаковость всех переменных в исходный момент base этим не доказана.

| Метрика, мс                               |     Base | Candidate |
| ----------------------------------------- | -------: | --------: |
| Весь case с fixture/restart/cleanup       |   276370 |    267363 |
| PLAYER accepted-text wait                 | 2904,895 |  2903,067 |
| ACCEPT send → matching receipt            |  894,557 |   885,733 |
| ACCEPT send → PLAYER IN_REVIEW projection | 2709,385 |  2412,744 |
| NET-020 edit → matching result            | 1168,352 |  1199,591 |
| NET-020 enabled wait                      | 1346,130 |  1342,418 |

Оба случая завершены со всеми шестью конечными Expect-позициями и без ошибок
вне успешных poll. Root независимо проверил оба archived HTML, source/diff pins,
raw frameIndex/correlation и SQLite: reviewRevision/eventIndex 3, три events,
START/«Лагерь», после физических restart одна ACTIVE copy и terminal own receipt,
ошибки процессов пусты. n=1 на источник не является статистическим сравнением
или воспроизведением CI load; устойчивое замедление #256 не показано. Профиль
CPU/IO этой парой не снимался; runtime guards/source checks не меняются.

Внешний `evidence-256/ci-lifecycle-diagnosis` сохраняет исходные CI-derived
attachments, `pair-comparison.json`, `diagnosis-final.md`, два `*-run01` и
`diagnostic256-lifecycle-{base,candidate}-{report,artifacts}`. Отдельный первый
npm launcher завершился `No tests found`: это 0 cases, не PASS и не фактический
сценарий; затем direct Node CLI прошёл exact-one discovery.

| Источник  | HTML SHA-256                                                       | Trace ZIP SHA-256                                                  |
| --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Base      | `928f03b9c38eae8bca53b92213c29166fe36955f02aed0dd8bfeeb7c6a5bc917` | `012e201a14ccd3a570b1e58f0f9ef24e3f80997779ba3d4e825b6dfffea0c3c7` |
| Candidate | `b79798b7aecc1f0f4528540f36edacd046cc12f112fda252b62cf735c06378b9` | `4b6fb47f6a4671d647b21f6a6314e4d0b9eefb2428caec6dfc725bf2f440e8d7` |

## Узкая правка

По ADR 0088 §3–5 и текущим AGENTS/process правилам только эти два waits получают
условный `outcome === 'LIFECYCLE'` timeout 30000 мс. Это конечный запас над
наблюдённым CI 5-секундным обрывом, ниже существующего fixture operation window
40000 мс; это не SLA и не доказанная latency исходного CI. Остальные outcomes
сохраняют default 5000 мс, body остаётся 360000 мс. Assertions, данные, actions,
hooks, production, workers/retries/defaults/config и artifacts не меняются.
Диагностическая instrumentation в исходный spec не переносится.

Один целевой uninstrumented сценарий после свежей build проверяет окончательную
правку; его external report отдельно привязывается к dirty source. Затем новый
committed SHA требует независимого review, одного полного отдельного clean gate
и нового CI. Старый c265 PASS и diagnostic overlay PASS их не заменяют.

Фактический uninstrumented targeted run после свежей build завершился за
269572 мс: exact 1 case/1 attempt, retry 0, все шесть финальных Expect-позиций
733/734/745/753/754/755 выполнены, attempt/global/outside-poll errors 0.
Spec SHA до/после `e9fcb8d24d291353b64bb6b6a1af4ca0fde6abb3629c801c0e92057507604b8e`;
fixture не менялся. Внешние `fixed-lifecycle-test01.*`, `fixed-lifecycle-audit.json`
и `fixed-lifecycle-{report,artifacts}` сохраняют dirty fingerprint и raw report.
HTML SHA `f3c57674589fa694eadd0df5319529d7e7dab983c93d51562670dd25b056af5b`,
trace ZIP SHA `f39224f00e93e90f85561308f28e14f5a8d1690e29c0ea04b49d7c1cd1d0fcc3`.
Это авторский targeted proof изменённого spec, не новый полный clean gate.
