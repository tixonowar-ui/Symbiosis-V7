# Starting Armor Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать issue #146 — playable `CHR-021` «Стартовый armorBundle» после подтверждённого random/manual composition, с одним D20 качества и остановкой на actionless `CHR-021/CHECKPOINTED`.

**Architecture:** Новый optional `armorBundleStage` живёт в существующем whole-checkpoint JSON и сосуществует только с завершённым random/manual composition. Чистый domain принимает sanitized armor catalog и валидирует 1–6 непересекающихся зон; host владеет ID, request/receipt, replay и next stage; web хранит только pre-roll local draft и отправляет полный состав в одном `ROLL-COMMIT`. `CHR-022+`, общий инвентарь и экипировка не создаются.

**Tech Stack:** TypeScript strict/ESM, Node 24, better-sqlite3, Fastify+WS, React/Vite, Vitest, Playwright.

**Spec:** GitHub issue #146 (`https://github.com/tixonowar-ui/Symbiosis-V7/issues/146`); ADR 0021, ADR 0025, ADR 0048 §12, ADR 0054; источники `generated/spec/items/catalogue.json`, `armor-profiles.json`, `dictionaries.json`, `instance-model.json`, Q&A `Q-CHAR-017/018`, Atlas `CHR-019/021/022/042`.

## Global Constraints

- Не изменять `artifacts/**`, `generated/**` вручную, `.github/**`, `vitest.config.ts`, `src/shared`, outer protocol, RANDOM/MANUAL composition semantics или принятые ADR по существу.
- Код, ветки, коммиты и PR — английский; продуктовая документация и ADR — русский.
- Игровые значения только из источников: восемь `ITM-ARM-001..008`, `BODY_ZONE=HEAD|TORSO|ARM_L|ARM_R|LEG_L|LEG_R`, `QUALITY=1–4|5–9|10–14|15–18|19|20`, `Q-CHAR-017/018`.
- `CHR-021` публикуется; `CHR-022` не публикуется. После bundle checkpoint next stage host-signed `CHR-022`, но renderer остаётся fail-closed.
- Один D20 на весь bundle; AUTO — один sampler после guards, MANUAL — одна грань без sampler; crit/XP/creation penalty нет.
- Bundle всегда `OWNED_NOT_EQUIPPED`; recommendation не меняет предметы, количество, equipped, параметры и не является final `qualityTier`.
- PURE не получает обходной инициализации; только race `FREE|UNITED` с завершённым composition checkpoint.
- Player payload fail-closed и sanitized: без Rule IDs, `Источник`, availability trace, raw rows, GM finalization data, seed/RNG state.

## Review Focus

- Empty/full-suit overlap: `FULL_SUIT` занимает все шесть зон и не сочетается ни с каким вторым покрытием.
- Pre-roll local draft: выбор до первого committed display не durable; reconnect/refresh восстанавливает пустой host baseline, не частичный выбор.
- Replay/restart: тот же `armorBundleId`, `qualityRollRequestId`, receipt, выбранные элементы и recommendation без нового sampler/request.
- Safe-return: `CHR-021::CTA::002` возвращает в `CHR-019` без пересоздания request и без потери composition/receipt.
- Recommendation boundary: `1–4` сохраняет тот же bundle; natural `1|20` не запускает crit/XP и не меняет mechanical profile.

---

### Task 0: Baseline and branch

**Files:**

- Modify: branch `codex/146-starting-armor-bundle`

**Interfaces:**

- Consumes: `main=45f6f23d07324f455c50b4a8495aeb4ab2b16834`.
- Produces: чистая рабочая ветка и подтверждённый baseline.

- [ ] **Step 1: Verify clean tree and create branch**

Run: `git status --short --branch && git switch -c codex/146-starting-armor-bundle`
Expected: clean `main`, затем новая ветка от `45f6f23`.

- [ ] **Step 2: Run baseline verify**

Run: `npm run verify`
Expected: 80 files / 1526 Vitest, validate, typecheck, lint, format и traceability green.

- [ ] **Step 3: Commit plan and record baseline**

```bash
git add docs/superpowers/plans/2026-10-27-starting-armor-bundle.md
git commit -m "docs: plan starting armor bundle (#146)"
```

### Task 1: Pure armor bundle rules

**Files:**

- Create: `src/domain/rules/item-stage/armor-bundle.ts`
- Create: `src/domain/rules/item-stage/armor-bundle.test.ts`
- Modify: `src/domain/rules/item-stage/index.ts`

**Interfaces:**

- Consumes: catalog entries `{itemId,name,coverageModel}` из host loader, где `coverageModel` — `ZONE_ELEMENT|FULL_SUIT`.
- Produces: `ArmorBodyZone`, `ArmorBundleSelection`, `ArmorQualityRecommendationKind`, `recommendArmorQuality(rawFace)`, `validateArmorBundle(catalog, selections)`, `validateArmorQualityFace(rawFace)`.

- [ ] **Step 1: Write failing pure-rule tests**

Cover exact eight canonical IDs, 1 and 6 accepted, 0/7 rejected, duplicate item/zone rejected, unknown/non-armor item rejected, forged zone rejected, full-suit six-zone exclusivity, and quality boundary table `1,4,5,9,10,14,15,18,19,20`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/rules/item-stage/armor-bundle.test.ts`
Expected: RED — module missing.

- [ ] **Step 3: Implement pure validators and recommendation mapping**

One D20 maps source ranges to `MISSING_OR_UNFIT|POOR|ORDINARY|GOOD|EXCEPTIONAL|RARE`; input remains immutable.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/domain/rules/item-stage && npm run typecheck`
Expected: all domain item-stage tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/rules/item-stage
git commit -m "feat(domain): validate starting armor bundle (#146)"
```

### Task 2: Host item catalog and armor stage contract

**Files:**

- Create: `src/host/armor-bundle-catalog.ts`
- Create: `src/host/armor-bundle-catalog.test.ts`
- Create: `src/host/creation-armor-bundle-contract.ts`
- Create: `src/host/creation-armor-bundle-contract.test.ts`

**Interfaces:**

- Consumes: `generated/spec/items/catalogue.json`, `armor-profiles.json`, `dictionaries.json`; pure Task 1 API.
- Produces: `loadArmorBundleCatalog(projectRoot)`, `ArmorBundleCatalog`, `normalizeArmorBundleQualityRollRequest`, `normalizeArmorBundleCheckpointRequest`, `parseArmorBundleStage`, `armorBundleStageIds`.

- [ ] **Step 1: Write failing loader and contract tests**

Assert exactly eight canonical rows, raw/open catalogue excluded, zone/quality dictionaries exact, strict request payload keys, malformed/unknown variants rejected.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/host/armor-bundle-catalog.test.ts src/host/creation-armor-bundle-contract.test.ts`
Expected: RED — modules missing.

- [ ] **Step 3: Implement loader and strict normalizers**

Host loader читает generated only; contract использует existing `CreationSymbiontApplicationError` style и не расширяет wire envelope.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run src/host/armor-bundle-catalog.test.ts src/host/creation-armor-bundle-contract.test.ts && npm run typecheck`
Expected: GREEN.

- [ ] **Step 5: Commit**

```bash
git add src/host/armor-bundle-catalog.ts src/host/armor-bundle-catalog.test.ts src/host/creation-armor-bundle-contract.ts src/host/creation-armor-bundle-contract.test.ts
git commit -m "feat(host): define armor bundle contract (#146)"
```

### Task 3: Durable entry, quality roll and bundle checkpoint

**Files:**

- Create: `src/host/creation-armor-bundle.ts`
- Create: `src/host/creation-armor-bundle.test.ts`
- Modify: `src/host/creation-set-decide.ts`
- Modify: `src/host/creation-wizard-checkpoint.ts`

**Interfaces:**

- Consumes: Task 1 validators; Task 2 contract/catalog; existing `commitLocalCharacterCheckpoint`, `creationWizardDurableIds`, symbiont stage parsers.
- Produces: `commitArmorBundleEntry`, `commitArmorBundleQualityRoll`, `commitArmorBundleCheckpoint`, `ArmorBundleStage` in `CreationWizardSymbiontPayload`.

- [ ] **Step 1: Write failing durable tests**

Entry from valid random/manual `CHR-019`; PURE rejected; repeated entry rejected; quality AUTO one sample/MANUAL no sample; invalid selection zero writes; changed payload/stale/replay/restart preserve IDs/receipt/recommendation; checkpoint transitions to host-signed `CHR-022`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/host/creation-armor-bundle.test.ts`
Expected: RED — module/dispatcher missing.

- [ ] **Step 3: Implement stage and command commits**

Entry создаёт `armorBundleId` и один addressed `qualityRollRequestId`; roll atomically фиксирует выбранные элементы, physical roll, recommendation и receipt; final checkpoint меняет только durable state и next envelope.

- [ ] **Step 4: Run durable and adjacent suites**

Run: `npx vitest run src/host/creation-armor-bundle.test.ts src/host/creation-manual-composition.test.ts src/host/creation-symbiont-server.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/host/creation-armor-bundle.ts src/host/creation-armor-bundle.test.ts src/host/creation-set-decide.ts src/host/creation-wizard-checkpoint.ts
git commit -m "feat(host): persist starting armor bundle (#146)"
```

### Task 4: CHR-021 projection and navigation

**Files:**

- Create: `src/host/projections/chr-armor-bundle.ts`
- Create: `src/host/projections/chr-armor-bundle.test.ts`
- Modify: `src/host/projections/app.ts`
- Modify: `src/host/projections/app.test.ts`
- Modify: `src/host/protocol-vocabulary.ts`
- Modify: `src/host/protocol-vocabulary.test.ts`
- Modify: `src/host/server.ts`

**Interfaces:**

- Consumes: `ArmorBundleStage`, loader catalog, existing app navigation/action registry.
- Produces: `CHR_021_FORM_ID`, `CHR_021_ROUTE`, `CHR_021_REQUIRED_FIELDS`, `projectChr021`, screen contract, safe-return `CHR-021::CTA::002` navigation.

- [ ] **Step 1: Write failing projection/server tests**

Assert exact title/route/requiredFields, action subset `CTA::003` pre-roll and `CTA::001/002` post-roll, no `CTA001` before receipt, sanitized catalog/payload, safe-return changes only projectionRevision, reconnect/restart restores `CHR-021`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/host/projections/chr-armor-bundle.test.ts src/host/projections/app.test.ts src/host/protocol-vocabulary.test.ts src/host/creation-armor-bundle-server.test.ts`
Expected: RED — `CHR-021` not publishable.

- [ ] **Step 3: Implement projection, action registry and server seams**

Register `CHR-021` in presented/inherited forms and renderer allowlists, add safe-return navigation, dispatch existing commands by variant/sourceFormId.

- [ ] **Step 4: Run host suites**

Run: `npx vitest run src/host/projections/chr-armor-bundle.test.ts src/host/projections/app.test.ts src/host/protocol-vocabulary.test.ts src/host/creation-armor-bundle-server.test.ts src/host/creation-symbiont-server.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/host/projections src/host/protocol-vocabulary.ts src/host/protocol-vocabulary.test.ts src/host/server.ts
git commit -m "feat(host): publish starting armor bundle (#146)"
```

### Task 5: Web decoder, local draft and request path

**Files:**

- Create: `src/web/forms/chr/armor-bundle.ts`
- Create: `src/web/forms/chr/armor-bundle.test.ts`
- Modify: `src/web/forms/chr/index.ts`
- Modify: `src/web/forms/index.ts`
- Modify: `src/web/forms/index.test.ts`
- Modify: `src/web/ws-client.ts`
- Modify: `src/web/ws-client.test.ts`

**Interfaces:**

- Consumes: Task 4 projection; existing `requestFormAction`, pending command/receipt matching.
- Produces: `Chr021Projection`, `armorBundleDraftFromSnapshot`, selection helpers, `armorBundleQualityPayload`, terminal/snapshot matchers, `replaceArmorBundleSelection`.

- [ ] **Step 1: Write failing strict decoder/draft tests**

Accept exact form/action variants; reject private fields, invalid zones/items, 0/7 pieces, overlap/full-suit mixing, forged receipt/revision; verify local draft survives projection-only safe-return and resets on reconnect/revision change.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/web/forms/chr/armor-bundle.test.ts src/web/ws-client.test.ts src/web/forms/index.test.ts`
Expected: RED — decoder/module missing.

- [ ] **Step 3: Implement decoder, local draft and command payload**

Client не вычисляет recommendation и не решает механику; отправляет exact `armorPieces` plus `manualFaceOrNull` в existing `ROLL-COMMIT`.

- [ ] **Step 4: Run web suites**

Run: `npx vitest run src/web/forms/chr/armor-bundle.test.ts src/web/ws-client.test.ts src/web/forms/index.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/forms/chr/armor-bundle.ts src/web/forms/chr/armor-bundle.test.ts src/web/forms/chr/index.ts src/web/forms/index.ts src/web/forms/index.test.ts src/web/ws-client.ts src/web/ws-client.test.ts
git commit -m "feat(web): decode starting armor bundle (#146)"
```

### Task 6: Accessible CHR-021 UI

**Files:**

- Create: `src/web/forms/chr/armor-bundle-fields.tsx`
- Create: `src/web/forms/chr/armor-bundle-fields.test.tsx`
- Modify: `src/web/app.tsx`
- Modify: `src/web/app.test.tsx`

**Interfaces:**

- Consumes: Task 5 projection/draft/request helpers.
- Produces: accessible `ArmorBundleFields` and `ManualArmorQualityFields`; generic Atlas buttons hide only exact false-CTA `CHR-021::CTA::003`.

- [ ] **Step 1: Write failing UI tests**

Assert labelled controls, empty/positive states, full-suit disables other coverage, AUTO no face input/MANUAL one face, no `CHR-022`, no recommendation-as-modifier language, local edit creates zero wire frames.

- [ ] **Step 2: Run UI tests to verify they fail**

Run: `npx vitest run src/web/forms/chr/armor-bundle-fields.test.tsx src/web/app.test.tsx`
Expected: RED — component missing.

- [ ] **Step 3: Implement minimal accessible UI**

Use existing Atlas labels and native controls; show immutable committed bundle and receipt after roll; submit exact command through `requestFormAction`.

- [ ] **Step 4: Run UI and full web suites**

Run: `npx vitest run src/web/forms/chr/armor-bundle-fields.test.tsx src/web/app.test.tsx && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/forms/chr/armor-bundle-fields.tsx src/web/forms/chr/armor-bundle-fields.test.tsx src/web/app.tsx src/web/app.test.tsx
git commit -m "feat(web): present starting armor bundle (#146)"
```

### Task 7: Production browser journey

**Files:**

- Create: `tests/e2e/armor-bundle.spec.ts`
- Modify: `tests/fixtures/manual-symbiont-e2e.ts` or create `tests/fixtures/armor-bundle-e2e.ts`

**Interfaces:**

- Consumes: real host/SQLite fixture from composition, production `dist/web`.
- Produces: ninth production Playwright journey covering FREE/MANUAL armor path and recovery.

- [ ] **Step 1: Write failing Playwright journey**

Cover open `CHR-021`, select 1–6 valid pieces, MANUAL/AUTO D20, safe-return, restart, final actionless `CHR-021/CHECKPOINTED`; assert no `CHR-022` UI.

- [ ] **Step 2: Run journey to verify it fails**

Run: `npm run test:e2e -- tests/e2e/armor-bundle.spec.ts`
Expected: RED — journey/form unavailable.

- [ ] **Step 3: Implement fixture and journey**

Reuse existing manual composition fixture and real Fastify/WS/SQLite; no mocked projection.

- [ ] **Step 4: Run full E2E**

Run: `npm run test:e2e`
Expected: 9/9 Playwright PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/armor-bundle.spec.ts tests/fixtures
git commit -m "test(e2e): cover starting armor bundle (#146)"
```

### Task 8: ADR, traceability, docs and final acceptance

**Files:**

- Create: `docs/adr/0055-starting-armor-bundle.md`
- Modify: `docs/adr/README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/status/module-map.md`
- Modify: `docs/status/handoff.md`
- Modify: `AGENTS.md` if E2E count changes
- Regenerate only: `docs/TRACEABILITY.md`

**Interfaces:**

- Consumes: final test totals, actual diff, CI-facing behavior.
- Produces: accepted ADR 0055 and current project docs.

- [ ] **Step 1: Write ADR 0055 and update project docs**

Record stage authority, entry/roll/checkpoint boundaries, quality recommendation semantics, privacy, safe-return, exclusions and actual counts.

- [ ] **Step 2: Run traceability and complete acceptance**

Run: `npm run format:check && npm run checksums && npm run import && npm run traceability && npm run import:verify && npm run verify && npm run build && npm run test:e2e && git diff --check`
Expected: deterministic output, current traceability, actual test totals and all E2E green.

- [ ] **Step 3: Commit docs**

```bash
git add docs/adr docs/status CHANGELOG.md AGENTS.md docs/TRACEABILITY.md
git commit -m "docs(adr): record starting armor bundle (#146)"
```

- [ ] **Step 4: Review whole diff and prepare PR**

Review complete branch diff, measure PR size, update PR template with RED/GREEN/test evidence, push branch, open PR and wait for required CI. Do not merge without separate owner approval.
