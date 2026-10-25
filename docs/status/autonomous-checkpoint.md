# Автономный checkpoint — 2026-10-25

> Это фиксация локального результата, **не финальный статус и не приёмка релиза**.
> Продукт и issue #135 не готовы окончательно. PR, CI и merge ещё pending; merge
> выполняет только владелец репозитория.

## 1. Текущая точка

| Параметр                   | Зафиксированное значение                                          |
| -------------------------- | ----------------------------------------------------------------- |
| Дата                       | 2026-10-25                                                        |
| Ветка                      | `codex/135-random-symbiont-draw`                                  |
| HEAD                       | `3851b96 feat(host): implement random symbiont journey`           |
| Domain + host commits      | `a80a255`, `3851b96`                                              |
| Merge-base с `origin/main` | `657431300b11a9ed0d56f5777d03ec26810a00b7`                        |
| Web/E2E                    | Изменения staged интегратором; index не сбрасывался               |
| PR / CI / merge            | **pending**, не заявляются выполненными                           |
| PR #141                    | Отдельный PR только для CI `MAX_CODE_ADDED=10000`; CI ещё pending |
| Runtime                    | Node `v24.21.0`                                                   |

## 2. Фактически выполненные проверки

- `npm run traceability` — матрица перезаписана; `npm run traceability:verify` —
  **traceability matrix is current**, расхождений нет. Структурные индикаторы:
  24/376 forms implemented и 46/376 tested; они не являются приёмкой остального Atlas.
- `npm run import` — успешно: 20 артефактов, 699 active + 40 tombstone,
  1144 character payload entities, 376 forms, 411 адресуемых Q-кодов.
- `npm run verify` — **успешно без retry**: checksums, traceability, typecheck,
  ESLint, Prettier, **66 файлов / 1345 тестов**, validate. Штатные 5s timeouts не
  изменялись; дополнительный прогон с `maxWorkers=4` не потребовался.
- `npm run build && npm run test:e2e` — production build успешен, **2/2** реальных
  Playwright-сценария в системном Chrome. `page.reload()` проверен на nested route.
- `npx vitest run src/host/server.test.ts` — **28/28**, включая static fallback и
  missing-asset 404.
- Проверка процессов после прогонов — оставшихся project Node/Chrome процессов нет.

## 3. Подтверждённый срез #135

- `CHR-017` публикует sanitized catalog и `slotCapacity`; random CTA ведёт на
  `CHR-020`. Ручная `CHR-018` и исключённые CTA не публикуются.
- `CHR-020` хранит append-only physical records, duplicates, critical/monster
  outcomes и binding-only commit без нового sampler/seed/replacement request.
- Random Advisor проходит `CHR-041` с durable I/W и exact-fill; read-only
  `CHR-019` показывает composition/interactions/modifier-only breakdown без
  generic effective-stat engine или финального clamp.
- Replay/refresh/reconnect/restart и historic recovery сохраняют sequence и
  receipts; player projections не раскрывают внутренние catalog/rule/RNG данные.
- Browser evidence: FREE EEL с RIGHT→LEFT local side и UNITED ADVISER со
  `STEALTH +6` / `THIEVERY +1` exact-fill 8/8, затем durable `CHR-019` после reload.

## 4. Неподтверждённые критерии и ограничения

- Для `CHR-017` нет отдельных host journeys для `PURE` и `MANUAL` acquisition.
  Domain/UI fixtures подтверждают empty catalog и отсутствие CTA, но не полный
  host path этих ветвей. Поэтому срез остаётся **В РАБОТЕ**, а не ГОТОВО.
- PR, CI и merge pending; локальные зелёные команды не заменяют их.
- Полные Windows/LAN, двухролевые и portable проверки не выполнялись. Весь V1 и
  остальные journeys не объявляются завершёнными.
- Ручная `CHR-018`, `CHR-021+`, `CHR-025`/`CORE-164`, общий runtime
  `EFFECTIVE_STATS` и product completion намеренно остаются вне этого среза.

## 5. Размер текущего diff через merge-base

`generated/**` и `package-lock.json` исключены по правилам size gate.

| Категория      | Фактически |      Лимит |
| -------------- | ---------: | ---------: |
| Code files     |         25 |         40 |
| Code added     |       9244 |      10000 |
| Code deleted   |        138 |       1500 |
| Test files     |         15 |          — |
| Test added     |       6242 | без лимита |
| Test deleted   |         21 |        400 |
| Doc lines      |        668 |       3000 |
| Artifact lines |          0 |       2000 |
| Total files    |         47 |         60 |

PR #141 меняет только CI-потолок и не является merge evidence. Окончательная
готовность не объявляется ни по размеру, ни по локальным тестам.
