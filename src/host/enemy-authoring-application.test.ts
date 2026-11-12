import { randomUUID, randomInt, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { openPersistenceDatabase } from '../persistence/database.js';
import { migration0022 } from '../persistence/migrations/0022-custom-monster-v1.js';
import type * as NodeCrypto from 'node:crypto';
import { createCampaignCreationRuntime } from './campaign-creation.js';
import { createCampaignBindManager } from './campaign-bind.js';
import { campaignEnemyIdentityInUse } from '../persistence/npc-identities.js';
import {
  validateSkillSelection,
  validateSkillSelectionDraft,
  calculateSkillSlotCost,
} from '../domain/rules/skill-stage/skills.js';
import { calculateSkillStageStats } from '../domain/rules/skill-stage/stats.js';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ENEMY_AUTHORING_SOURCE_SEALS } from './enemy-authoring-source-seals.js';
import type { ActionKey } from '@generated/types/atlas.js';
import { beforeAll, expect, it, vi } from 'vitest';
import { bootstrapDeviceIdentity, resetDeviceIdentity } from '../persistence/device-identity.js';
import { commitLocalNetworkTabEntry } from '../persistence/network-local-tab.js';
import {
  createPostSaveHead,
  commitPostSaveCommand,
  type PostSaveScope,
} from '../persistence/local-character-post-save.js';
import type { JsonObject, CommandReceipt } from '@shared/wire-protocol.js';
import type {
  EnemyAttempt,
  EnemyWorkflowRequest,
  EnemyPatchStage,
  EnemyAuthoringMutation,
  EnemyUserEntry,
} from '@shared/enemy-authoring.js';
import { commitEnemyAuthoring, readEnemyVersions } from '../persistence/enemy-authoring-store.js';
import { sentientEnemyAuthoringProjectionValue as enemyAuthoringProjectionValue } from '@shared/enemy-authoring.js';
import { emptyEnemySkillPlanState } from '@shared/enemy-skill-plan.js';
import { enemyLibraryProjectionValue } from '@shared/enemy-library.js';
import { BASELINE_LINEAGE_SEALS } from './baseline-lineage-seals.js';
import { resolveStoredLocalCharacterExportBaseline } from './local-character-export.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  commitGmRequestReviewNavigation,
  readGmRequestReviewSource,
  readGmRequestReviewSourceWith,
} from '../persistence/network-device-request.js';
import {
  campaignCreationHash,
  readGmRequestReviewViewStateInTransaction,
  createLocalGmContext,
  readActiveLocalGmContext,
  type CampaignPrivateOwnerValidator,
  type GmRequestReviewScope,
} from '../persistence/campaign-creation.js';
import {
  createEnemyLibraryApplication,
  validateEnemyLibrarySource,
} from './enemy-library-application.js';
import {
  enemyBaseStatsValue,
  enemyIdentityValue,
  deriveSentientEnemySheet,
} from '../domain/entities/enemy-template/sentient-authoring.js';
import { createEnemyLibraryFixture } from '../../tests/fixtures/enemy-library.js';
import { loadEnemySourceCatalog } from './enemy-catalog.js';
import { loadLocalCharacterExportBaseline } from './local-character-export.js';
import { loadNpcAuthoringSourceCatalog } from './npc-catalog.js';
import { loadEnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';
import {
  createEnemyAuthoringApplication,
  validateEnemyAuthoringSource,
} from './enemy-authoring-application.js';
import {
  loadCampaignCheckpoint,
  createLocalCharacter,
  commitNewLocalCharacterCheckpoint,
  commitNewCampaignCheckpoint,
} from '../persistence/store.js';

// Observe/fault technical UUID allocation and actual RNG calls; rules, ownership and SQL remain real.
vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof NodeCrypto>();
  return {
    ...original,
    randomUUID: vi.fn(original.randomUUID),
    randomInt: vi.fn(original.randomInt),
  };
});

let baseline: Awaited<ReturnType<typeof loadLocalCharacterExportBaseline>>;
let source: ReturnType<typeof loadEnemySourceCatalog>;
let catalog: ReturnType<typeof loadEnemyAuthoringSourceCatalog>;
let common: Awaited<ReturnType<typeof loadNpcAuthoringSourceCatalog>>;
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  source = loadEnemySourceCatalog(process.cwd(), baseline);
  common = await loadNpcAuthoringSourceCatalog(process.cwd());
  catalog = loadEnemyAuthoringSourceCatalog(process.cwd(), common);
});
const identity = {
  name: 'Страж',
  description: 'Полный лист V1',
  origin: 'Дозор',
  affiliation: 'Город',
  massKg: 80.1,
  anatomyProfileId: 'ORDINARY_SENTIENT',
};
const stats = { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 };
function fixture(authoringCatalog = catalog, enter = true, mode: 'AUTO' | 'MANUAL' = 'MANUAL') {
  const f = createEnemyLibraryFixture(source, baseline, false, mode);
  const checkedRead: typeof f.readCurrent = (observe) =>
    f.readCurrent((current, state) => {
      validateEnemyLibrarySource(current, state, source, baseline);
      validateEnemyAuthoringSource(f.db, current, state, authoringCatalog, baseline);
      observe?.(current, state);
    });
  const library = () =>
    createEnemyLibraryApplication({
      database: f.db,
      scope: f.scope,
      catalog: source,
      baseline,
      validateOwner: () => undefined,
      readCurrent: checkedRead,
      readUsers: () => {
        let users: EnemyUserEntry[] = [];
        checkedRead((current, state) => {
          users = validateEnemyAuthoringSource(
            f.db,
            current,
            state,
            authoringCatalog,
            baseline,
          ).map((version) => ({ ...version.identity, displayName: version.sheet.identity.name }));
        });
        return users;
      },
    });
  const nav = (actionKey: ActionKey) => {
    const cursor = f.readCurrent().cursor;
    const request = {
      messageType: 'navigation.form-action' as const,
      protocolVersion: 2 as const,
      navigationRequestId: randomUUID(),
      sourceFormId: cursor.formId,
      expectedProjectionRevision: cursor.revisions.projectionRevision,
      actionKey,
    };
    return actionKey.startsWith('ENM-') || actionKey === 'GM-001::CTA::005'
      ? library().navigation(request)
      : commitGmRequestReviewNavigation(
          f.db,
          f.scope,
          request,
          () => undefined,
          (current) => {
            if (!s.same(checkedRead(), current)) s.fail('SOURCE_CHANGED');
          },
        );
  };
  const app = () =>
    createEnemyAuthoringApplication({
      database: f.db,
      scope: f.scope,
      catalog: authoringCatalog,
      baseline,
      validateOwner: () => undefined,
      readCurrent: checkedRead,
    });
  const request = (stage: EnemyPatchStage, data: JsonObject): EnemyWorkflowRequest => {
    const p = app().project(),
      attempt = p.base.roleFilteredPayload['context'] as unknown as { attemptOrNull: EnemyAttempt };
    enemyAuthoringProjectionValue(p.base.roleFilteredPayload);
    return {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      workflowCommandId: 'UI-CMD-ENEMY-DRAFT-PATCH',
      role: 'gm',
      commandId: randomUUID(),
      expectedRevisions: p.revisions,
      payload: {
        campaignId: f.scope.campaignId,
        creationAttemptId: attempt.attemptOrNull.attemptId,
        expectedAttemptRevision: attempt.attemptOrNull.revision,
        stage,
        data,
      },
    };
  };
  const patch = (stage: EnemyPatchStage, data: JsonObject) => app().command(request(stage, data));
  if (enter) nav('ENM-001::CTA::003');
  const complete = (identityInput: JsonObject = identity) => {
    patch('SENTIENT_IDENTITY', identityInput);
    patch('SENTIENT_STATS', stats);
    patch('SENTIENT_BUILD', {
      raceCode: 'PURE',
      pureClassOrNull: 'SOLDIER',
      skillSelections: [{ skillKey: 'UNARMED', targetBonus: 7 }],
    });
    patch('SENTIENT_SYMBIONTS', {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
    });
    patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
  };
  const commitRequest = (): EnemyWorkflowRequest => {
    const p = app().project(),
      a = (p.base.roleFilteredPayload['context'] as unknown as { attemptOrNull: EnemyAttempt })
        .attemptOrNull;
    return {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      workflowCommandId: 'UI-CMD-ENEMY-COMMIT-V1',
      commandId: randomUUID(),
      expectedRevisions: p.revisions,
      payload: {
        campaignId: f.scope.campaignId,
        creationAttemptId: a.attemptId,
        expectedAttemptRevision: a.revision,
      },
    };
  };
  return {
    ...f,
    get db() {
      return f.db;
    },
    app,
    nav,
    library,
    checkedRead,
    request,
    patch,
    complete,
    commitRequest,
  };
}
function compositionBuild(
  f: ReturnType<typeof fixture>,
  raceCode: 'FREE' | 'UNITED',
  baseStats = stats,
) {
  f.patch('SENTIENT_IDENTITY', identity);
  f.patch('SENTIENT_STATS', baseStats);
  const { skillStageStats } = calculateSkillStageStats(common.skills, {
    baseStats,
    raceCode,
    classCode: null,
    creationMode: 'MANUAL',
  });
  const draft = validateSkillSelectionDraft(common.skills, {
    raceCode,
    classCode: null,
    skillStageStats,
    selectedSkills: [],
  });
  const budget = draft.remaining;
  const fixed = new Set<string>(draft.learnedSkills.map((row) => row.skillKey));
  const keys = [
    ...new Set([
      'UNARMED',
      'ACROBATICS',
      'STEALTH',
      ...common.skills.skills.map((row) => row.skillKey),
    ]),
  ].filter(
    (key) =>
      !fixed.has(key) &&
      common.skills.skills.some(
        (row) => row.skillKey === key && row.category === 'SELECTABLE_GENERAL',
      ) &&
      common.skills.requirements
        .filter((row) => row.skillKey === key)
        .every((row) => skillStageStats[row.statCode] >= row.minValue),
  );
  const selectedSkills: { skillKey: string; targetBonus: number }[] = [];
  if (budget > 0) {
    let bonus = 1;
    while (calculateSkillSlotCost(bonus + 1) <= budget) bonus++;
    selectedSkills.push({ skillKey: keys[0]!, targetBonus: bonus });
    const remaining = budget - calculateSkillSlotCost(bonus);
    if (remaining !== 0) selectedSkills.push({ skillKey: keys[1]!, targetBonus: remaining });
  }
  validateSkillSelection(common.skills, {
    raceCode,
    classCode: null,
    skillStageStats,
    selectedSkills,
  });
  f.patch('SENTIENT_BUILD', { raceCode, pureClassOrNull: null, skillSelections: selectedSkills });
  return skillStageStats;
}
function sourceCompositionChoice(speciesKey: string, targetLevel = 1) {
  const species = common.symbionts.species.find((row) => row.speciesKey === speciesKey)!;
  const kind = species.bindingPolicy;
  return {
    speciesKey,
    targetLevel,
    learnedNodeRefs: common.development.nodes
      .filter((row) => row.speciesKey === speciesKey && row.level <= targetLevel)
      .map((row) => row.nodeRef),
    binding: kind === 'OWL_EYE' || kind === 'EEL_ARM' ? { kind, side: 'LEFT' } : { kind },
  };
}
function projectedComposition(f: ReturnType<typeof fixture>) {
  const value = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
    .attemptOrNull?.compositionOrNull;
  if (value === null || value === undefined || !('schemaVersion' in value))
    throw Error('Actual composed state missing');
  return value;
}
function compositionStorageRows(
  f: Pick<ReturnType<typeof fixture>, 'db'>,
): Record<string, unknown[]> {
  const tables = f.db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => {
      const quoted = '"' + name.replaceAll('"', '""') + '"';
      const columns = f.db.prepare('PRAGMA table_info(' + quoted + ')').all() as { name: string }[];
      return [
        name,
        f.db
          .prepare(
            'SELECT * FROM ' +
              quoted +
              ' ORDER BY ' +
              columns.map(({ name }) => '"' + name.replaceAll('"', '""') + '"').join(','),
          )
          .all(),
      ] as const;
    }),
  );
}
function confirmComposition(f: ReturnType<typeof fixture>, selection: JsonObject) {
  const preview = f.request('SENTIENT_SYMBIONTS', {
    operation: 'PREVIEW',
    advisorRemovalConfirmed: false,
    selection,
  });
  f.app().command(preview);
  const confirm = f.request('SENTIENT_SYMBIONTS', {
    operation: 'CONFIRM',
    previewCommandId: preview.commandId,
    interactionsConfirmed: true,
    manualFacesOrNull: null,
  });
  const result = f.app().command(confirm);
  f.patch('SENTIENT_SYMBIONTS', {
    operation: 'FINISH',
    previewCommandId: preview.commandId,
    skills: { advisorSkills: [], dolphinSkills: [] },
  });
  return { preview, confirm, result };
}
it('ADR0092 verifies permanent START loss on Plague, keeps it forgotten on Chimera, and requires explicit same-input rebuild before relearning', () => {
  const f = fixture();
  try {
    const input = {
      baseStats: { ...stats, D: 11 },
      build: {
        raceCode: 'UNITED',
        pureClassOrNull: null,
        skillSelections: [
          { skillKey: 'UNARMED', targetBonus: 3 },
          { skillKey: 'LEARNING', targetBonus: 6 },
        ],
      },
    };
    f.patch('SENTIENT_IDENTITY', identity);
    f.patch('SENTIENT_STATS', input.baseStats);
    const initial = f.request('SENTIENT_BUILD', { operation: 'INITIALIZE', initialInput: input });
    const initialReceipt = f.app().command(initial);
    const monster = (speciesKey: string) => {
      const profile = common.development.levels.find(
        (row) => row.speciesKey === speciesKey && row.level === 1,
      )!;
      return {
        symbiontCompositionMode: 'SYMBIOTIC_MONSTER',
        ordinarySymbiontInstances: [],
        symbioticMonsterProfileIdOrNull: profile.levelProfileId,
        monsterOrNull: sourceCompositionChoice(speciesKey),
      };
    };
    confirmComposition(f, monster('PLAGUE_DOCTOR'));
    const inventory = f.request('SENTIENT_INVENTORY', {
      inventoryItems: [],
      armorCompatibilityReasonOrNull: null,
    });
    const inventoryReceipt = f.app().command(inventory);
    const first = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload);
    expect(first.sheetOrNull?.permanentStats).toMatchObject({ S: 8, D: 6 });
    expect(first.sheetOrNull?.skills.some((row) => row.skillKey === 'UNARMED')).toBe(false);
    expect(
      first.context.attemptOrNull?.skillPlanState?.planOrNull?.accountingOrNull?.permanentLosses,
    ).toContainEqual({
      skillKey: 'UNARMED',
      commandId: inventory.commandId,
      bonusBefore: 3,
      releasedStartSlots: 3,
      releasedDolphinSlots: 0,
    });
    f.restartFromDisk();
    expect(f.db.memory).toBe(false);
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::003');
    confirmComposition(f, monster('CHIMERA'));
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const restored = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload);
    expect(restored.sheetOrNull?.permanentStats.S).toBeGreaterThanOrEqual(9);
    expect(restored.sheetOrNull?.skills.some((row) => row.skillKey === 'UNARMED')).toBe(false);
    expect(restored.sheetOrNull?.skillSlots.used).toBe(7);
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::001');
    f.patch('SENTIENT_BUILD', {
      operation: 'PREVIEW_REBUILD',
      expectedPlanRevision: 1,
      initialInput: input,
    });
    const preview = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!;
    expect(preview.consequences.abandonedSkills.some((row) => row.skillKey === 'UNARMED')).toBe(
      false,
    );
    const confirm = f.request('SENTIENT_BUILD', {
      operation: 'CONFIRM_REBUILD',
      expectedPlanRevision: 1,
      previewCommandId: preview.previewCommandId,
      initialInput: input,
      displayedConsequences: preview.consequences as unknown as JsonObject,
    });
    const bytes = f.db.serialize();
    expect(() =>
      f.app().command({
        ...confirm,
        payload: {
          ...confirm.payload,
          data: {
            ...confirm.payload.data,
            displayedConsequences: {
              ...preview.consequences,
              invalidateInventory: !preview.consequences.invalidateInventory,
            },
          },
        },
      }),
    ).toThrow('INVALID_INPUT');
    expect(f.db.serialize().equals(bytes)).toBe(true);
    const confirmationReceipt = f.app().command(confirm);
    const rebuilt = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!;
    expect(rebuilt.compositionOrNull).toBeNull();
    expect(rebuilt.inventoryOrNull).toBeNull();
    expect(rebuilt.skillPlanState?.planOrNull?.revision).toBe(2);
    expect(rebuilt.skillPlanState?.planOrNull?.planId).toBe(confirm.commandId);
    confirmComposition(f, monster('CHIMERA'));
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).sheetOrNull?.skills,
    ).toContainEqual(expect.objectContaining({ skillKey: 'UNARMED', bonus: 3, slotCost: 3 }));
    const commit = f.commitRequest(),
      receipt = f.app().command(commit);
    f.restartFromDisk();
    const finalBytes = f.db.serialize();
    for (const [request, original] of [
      [initial, initialReceipt],
      [inventory, inventoryReceipt],
      [confirm, confirmationReceipt],
      [commit, receipt],
    ] as const)
      expect(f.app().command(request)).toEqual({ ...original, replayed: true });
    expect(f.db.serialize().equals(finalBytes)).toBe(true);
  } finally {
    f.close();
  }
});
it('CORE197 modern actual workflow permits provisional UNITED M0 repaired by real CHIMERA L4 and preserves the final floor', () => {
  const f = fixture();
  try {
    const basis = compositionBuild(f, 'UNITED', { ...stats, M: 10 });
    expect(basis.M).toBe(0);
    const profile = common.development.levels.find(
      (row) => row.speciesKey === 'CHIMERA' && row.level === 4,
    )!;
    confirmComposition(f, {
      symbiontCompositionMode: 'SYMBIOTIC_MONSTER',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: profile.levelProfileId,
      monsterOrNull: sourceCompositionChoice('CHIMERA', 4),
    });
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const sheet = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(sheet.skillStageStats.M).toBe(0);
    expect(sheet.permanentStats.M).toBe(25);
    expect(Object.values(sheet.permanentStats).every((value) => value >= 1)).toBe(true);
  } finally {
    f.close();
  }
});
it('ADR0092 retains actual mixed SYM166 charges through removal and reacquisition, then resets only after full explicit replacement', () => {
  const f = fixture();
  try {
    const input = {
      baseStats: stats,
      build: {
        raceCode: 'UNITED',
        pureClassOrNull: null,
        skillSelections: [
          { skillKey: 'UNARMED', targetBonus: 3 },
          { skillKey: 'LEARNING', targetBonus: 6 },
        ],
      },
    };
    f.patch('SENTIENT_IDENTITY', identity);
    f.patch('SENTIENT_STATS', stats);
    f.patch('SENTIENT_BUILD', { operation: 'INITIALIZE', initialInput: input });
    const dolphin = {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [sourceCompositionChoice('DOLPHIN', 6)],
      symbioticMonsterProfileIdOrNull: null,
      monsterOrNull: null,
    };
    const select = (
      selection: JsonObject,
      dolphinSkills: { skillKey: string; targetBonus: number }[],
    ) => {
      const preview = f.request('SENTIENT_SYMBIONTS', {
        operation: 'PREVIEW',
        selection,
        advisorRemovalConfirmed: false,
      });
      f.app().command(preview);
      f.patch('SENTIENT_SYMBIONTS', {
        operation: 'CONFIRM',
        previewCommandId: preview.commandId,
        interactionsConfirmed: true,
        manualFacesOrNull: null,
      });
      f.patch('SENTIENT_SYMBIONTS', {
        operation: 'FINISH',
        previewCommandId: preview.commandId,
        skills: { advisorSkills: [], dolphinSkills },
      });
    };
    const body = () =>
      f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    select(dolphin, [
      { skillKey: 'UNARMED', targetBonus: 5 },
      { skillKey: 'ACROBATICS', targetBonus: 3 },
    ]);
    body();
    const paid = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .sheetOrNull!.skillPlanState!.planOrNull!.accountingOrNull!.knownSkills;
    expect(paid.find((row) => row.skillKey === 'UNARMED')).toMatchObject({
      bonus: 5,
      startSlots: 3,
      dolphinSlots: 2,
    });
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::003');
    const chimera = common.development.levels.find(
      (row) => row.speciesKey === 'CHIMERA' && row.level === 1,
    )!;
    select(
      {
        symbiontCompositionMode: 'SYMBIOTIC_MONSTER',
        ordinarySymbiontInstances: [],
        symbioticMonsterProfileIdOrNull: chimera.levelProfileId,
        monsterOrNull: sourceCompositionChoice('CHIMERA'),
      },
      [],
    );
    body();
    const removed = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(removed.skillPlanState!.planOrNull!.accountingOrNull!.knownSkills).toEqual(paid);
    expect(removed.compositionFacts?.['dolphinSkillSlots']).toEqual({ capacity: 0, used: 5 });
    f.restartFromDisk();
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::003');
    select(dolphin, [{ skillKey: 'FENCING', targetBonus: 1 }]);
    const before = f.db.serialize();
    expect(() => body()).toThrow('INVALID_INPUT');
    expect(f.db.serialize().equals(before)).toBe(true);
    f.nav('ENM-009::CTA::003');
    f.nav('ENM-008::CTA::001');
    const replacement = {
      ...input,
      build: {
        ...input.build,
        skillSelections: [
          { skillKey: 'FENCING', targetBonus: 3 },
          { skillKey: 'LEARNING', targetBonus: 6 },
        ],
      },
    };
    f.patch('SENTIENT_BUILD', {
      operation: 'PREVIEW_REBUILD',
      expectedPlanRevision: 1,
      initialInput: replacement,
    });
    const preview = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!;
    expect(
      preview.consequences.abandonedSkills.find((row) => row.skillKey === 'UNARMED'),
    ).toMatchObject({ startSlots: 3, dolphinSlots: 2 });
    f.patch('SENTIENT_BUILD', {
      operation: 'CONFIRM_REBUILD',
      expectedPlanRevision: 1,
      previewCommandId: preview.previewCommandId,
      initialInput: replacement,
      displayedConsequences: preview.consequences as unknown as JsonObject,
    });
    select(dolphin, [{ skillKey: 'UNARMED', targetBonus: 5 }]);
    body();
    const rebuilt = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(
      rebuilt.skillPlanState!.planOrNull!.accountingOrNull!.knownSkills.find(
        (row) => row.skillKey === 'UNARMED',
      ),
    ).toMatchObject({ bonus: 5, startSlots: 0, dolphinSlots: 5 });
    expect(rebuilt.skills.some((row) => row.skillKey === 'ACROBATICS')).toBe(false);
    const commit = f.commitRequest(),
      receipt = f.app().command(commit);
    f.restartFromDisk();
    const bytes = f.db.serialize();
    expect(f.app().project().base.roleFilteredPayload['sheetOrNull']).toEqual(rebuilt);
    expect(f.app().command(commit)).toEqual({ ...receipt, replayed: true });
    expect(f.db.serialize().equals(bytes)).toBe(true);
  } finally {
    f.close();
  }
}, 60_000); // ADR0088: the full owning mixed-payment journey measured 23.325 s; finite case-only headroom.
it('ADR0092 keeps full Back editing from W20 to W10 and confirms the new exact initial budget', () => {
  const f = fixture();
  try {
    f.complete();
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::001');
    f.nav('ENM-007::CTA::005');
    const baseStats = { ...stats, W: 10 };
    f.patch('SENTIENT_STATS', baseStats);
    const input = {
      baseStats,
      build: {
        raceCode: 'FREE',
        pureClassOrNull: null,
        skillSelections: [{ skillKey: 'UNARMED', targetBonus: 5 }],
      },
    };
    const before = f.db.serialize();
    expect(() => f.patch('SENTIENT_BUILD', input.build)).toThrow('INVALID_INPUT');
    expect(f.db.serialize().equals(before)).toBe(true);
    f.patch('SENTIENT_BUILD', {
      operation: 'PREVIEW_REBUILD',
      expectedPlanRevision: 1,
      initialInput: input,
    });
    const preview = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!;
    f.patch('SENTIENT_BUILD', {
      operation: 'CONFIRM_REBUILD',
      expectedPlanRevision: 1,
      previewCommandId: preview.previewCommandId,
      initialInput: input,
      displayedConsequences: preview.consequences as unknown as JsonObject,
    });
    confirmComposition(f, {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
      monsterOrNull: null,
    });
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const sheet = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(sheet.build.raceCode).toBe('FREE');
    expect(sheet.skillSlots).toEqual({ capacity: 5, used: 5, remaining: 0, overflow: 0 });
    expect(sheet.skills).toContainEqual(
      expect.objectContaining({ skillKey: 'UNARMED', bonus: 5, slotCost: 5 }),
    );
  } finally {
    f.close();
  }
});
it('ADR0092 carries the actual signed FREE loss into a different basis without refund, repeat roll or an early floor repair', () => {
  const f = fixture();
  try {
    compositionBuild(f, 'FREE');
    const preview = f.request('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [
          sourceCompositionChoice('OWL'),
          sourceCompositionChoice('TICK'),
        ],
        symbioticMonsterProfileIdOrNull: null,
        monsterOrNull: null,
      },
    });
    f.app().command(preview);
    const confirm = f.request('SENTIENT_SYMBIONTS', {
      operation: 'CONFIRM',
      previewCommandId: preview.commandId,
      interactionsConfirmed: true,
      manualFacesOrNull: [3],
    });
    const receipt = f.app().command(confirm),
      acquisition = projectedComposition(f).acquisitions.freeSlotOrNull!,
      samples = vi.mocked(randomInt).mock.calls.length;
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'FINISH',
      previewCommandId: preview.commandId,
      skills: { advisorSkills: [], dolphinSkills: [] },
    });
    f.nav('ENM-009::CTA::001');
    f.nav('ENM-007::CTA::005');
    const baseStats = { ...stats, S: 3 };
    f.patch('SENTIENT_STATS', baseStats); // CORE006: new precomposition S1; the original signed R6 remains -3.
    const input = {
      baseStats,
      build: {
        raceCode: 'FREE',
        pureClassOrNull: null,
        skillSelections: [
          { skillKey: 'LEARNING', targetBonus: 6 },
          { skillKey: 'ACROBATICS', targetBonus: 3 },
        ],
      },
    };
    f.patch('SENTIENT_BUILD', {
      operation: 'PREVIEW_REBUILD',
      expectedPlanRevision: 1,
      initialInput: input,
    });
    const rebuild = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!;
    expect(rebuild.consequences.retainedRollReceiptIds).toEqual([acquisition.roll.rollReceiptId]);
    f.patch('SENTIENT_BUILD', {
      operation: 'CONFIRM_REBUILD',
      expectedPlanRevision: 1,
      previewCommandId: rebuild.previewCommandId,
      initialInput: input,
      displayedConsequences: rebuild.consequences as unknown as JsonObject,
    });
    confirmComposition(f, {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
      monsterOrNull: null,
    });
    const bytes = f.db.serialize();
    expect(() =>
      f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null }),
    ).toThrow('INVALID_INPUT');
    expect(f.db.serialize().equals(bytes)).toBe(true);
    f.nav('ENM-009::CTA::003');
    confirmComposition(f, {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [sourceCompositionChoice('TROGR')],
      symbioticMonsterProfileIdOrNull: null,
      monsterOrNull: null,
    });
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const sheet = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(sheet.permanentStats.S).toBe(4);
    expect(sheet.composition).toMatchObject({ acquisitions: { freeSlotOrNull: acquisition } });
    const commit = f.commitRequest();
    f.app().command(commit);
    f.restartFromDisk();
    const finalBytes = f.db.serialize();
    expect(f.app().command(confirm)).toEqual({ ...receipt, replayed: true });
    expect(f.db.serialize().equals(finalBytes)).toBe(true);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(samples);
  } finally {
    f.close();
  }
});
it('ADR0092 discards same-input and changed-input previews without resetting the plan, then refuses their stale confirmations with zero writes', () => {
  const f = fixture();
  try {
    f.complete();
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::001');
    const before = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
      .attemptOrNull!;
    const input = before.skillPlanState!.planOrNull!.initialInput;
    const previewRequest = f.request('SENTIENT_BUILD', {
      operation: 'PREVIEW_REBUILD',
      expectedPlanRevision: 1,
      initialInput: input as unknown as JsonObject,
    });
    const previewReceipt = f.app().command(previewRequest);
    const pending = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!;
    expect(pending.skillPlanState!.planOrNull).toEqual(before.skillPlanState!.planOrNull);
    expect(pending.compositionOrNull).toEqual(before.compositionOrNull);
    expect(pending.inventoryOrNull).toEqual(before.inventoryOrNull);
    const preview = pending.skillPlanState!.rebuildPreviewOrNull!;
    const stale = f.request('SENTIENT_BUILD', {
      operation: 'CONFIRM_REBUILD',
      expectedPlanRevision: 1,
      previewCommandId: preview.previewCommandId,
      initialInput: input as unknown as JsonObject,
      displayedConsequences: preview.consequences as unknown as JsonObject,
    });
    f.patch('SENTIENT_BUILD', {
      operation: 'DISCARD_REBUILD',
      previewCommandId: preview.previewCommandId,
    });
    const discarded = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!;
    expect(discarded.skillPlanState!.planOrNull).toEqual(before.skillPlanState!.planOrNull);
    expect(discarded.inventoryOrNull).toEqual(before.inventoryOrNull);
    expect(discarded.itemTemplateKeys).toEqual(before.itemTemplateKeys);
    let bytes = f.db.serialize();
    expect(() => f.app().command(stale)).toThrow('INVALID_INPUT');
    expect(f.db.serialize().equals(bytes)).toBe(true);
    const changed = {
      ...input,
      build: {
        raceCode: 'FREE',
        pureClassOrNull: null,
        skillSelections: [
          { skillKey: 'UNARMED', targetBonus: 7 },
          { skillKey: 'ACROBATICS', targetBonus: 1 },
        ],
      },
    };
    f.patch('SENTIENT_BUILD', {
      operation: 'PREVIEW_REBUILD',
      expectedPlanRevision: 1,
      initialInput: changed,
    });
    const changedPreview = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!;
    const staleChanged = f.request('SENTIENT_BUILD', {
      operation: 'CONFIRM_REBUILD',
      expectedPlanRevision: 1,
      previewCommandId: changedPreview.previewCommandId,
      initialInput: changed,
      displayedConsequences: changedPreview.consequences as unknown as JsonObject,
    });
    f.patch('SENTIENT_BUILD', {
      operation: 'DISCARD_REBUILD',
      previewCommandId: changedPreview.previewCommandId,
    });
    f.restartFromDisk();
    bytes = f.db.serialize();
    expect(() => f.app().command(staleChanged)).toThrow('INVALID_INPUT');
    expect(f.db.serialize().equals(bytes)).toBe(true);
    expect(f.app().command(previewRequest)).toEqual({ ...previewReceipt, replayed: true });
    expect(f.db.serialize().equals(bytes)).toBe(true);
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
        .attemptOrNull!.skillPlanState!.planOrNull,
    ).toEqual(before.skillPlanState!.planOrNull);
  } finally {
    f.close();
  }
});
it('ADR0092 rebuilds away from Advisor and reuses its original acquired card only after explicit new own choices, retaining fills and receipts on disk', () => {
  const f = fixture();
  try {
    const united = {
      baseStats: stats,
      build: {
        raceCode: 'UNITED',
        pureClassOrNull: null,
        skillSelections: [
          { skillKey: 'UNARMED', targetBonus: 3 },
          { skillKey: 'LEARNING', targetBonus: 6 },
        ],
      },
    };
    f.patch('SENTIENT_IDENTITY', identity);
    f.patch('SENTIENT_STATS', stats);
    f.patch('SENTIENT_BUILD', { operation: 'INITIALIZE', initialInput: united });
    const firstPreview = f.request('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [
          sourceCompositionChoice('ADVISER'),
          sourceCompositionChoice('TROGR', 2),
        ],
        symbioticMonsterProfileIdOrNull: null,
        monsterOrNull: null,
      },
    });
    f.app().command(firstPreview);
    const acquire = f.request('SENTIENT_SYMBIONTS', {
      operation: 'CONFIRM',
      previewCommandId: firstPreview.commandId,
      interactionsConfirmed: true,
      manualFacesOrNull: [12, 12, 20],
    });
    const acquireReceipt = f.app().command(acquire),
      originalCard = structuredClone(projectedComposition(f).acquisitions.advisorCards[0]!),
      calls = vi.mocked(randomInt).mock.calls.length;
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'FINISH',
      previewCommandId: firstPreview.commandId,
      skills: {
        advisorSkills: [
          { skillKey: 'UNARMED', targetBonus: 5 },
          { skillKey: 'FENCING', targetBonus: 5 },
        ],
        dolphinSkills: [],
      },
    });
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const fill = structuredClone(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
        .attemptOrNull!.skillPlanState!.advisorInitialFillHistory[0]!,
    );
    const rebuild = (input: JsonObject, revision: number) => {
      f.nav('ENM-010::CTA::005');
      f.nav('ENM-009::CTA::001');
      f.patch('SENTIENT_BUILD', {
        operation: 'PREVIEW_REBUILD',
        expectedPlanRevision: revision,
        initialInput: input,
      });
      const preview = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
        .context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!;
      f.patch('SENTIENT_BUILD', {
        operation: 'CONFIRM_REBUILD',
        expectedPlanRevision: revision,
        previewCommandId: preview.previewCommandId,
        initialInput: input,
        displayedConsequences: preview.consequences as unknown as JsonObject,
      });
    };
    rebuild(
      {
        baseStats: stats,
        build: {
          raceCode: 'PURE',
          pureClassOrNull: 'SOLDIER',
          skillSelections: [{ skillKey: 'UNARMED', targetBonus: 7 }],
        },
      },
      1,
    );
    confirmComposition(f, {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
      monsterOrNull: null,
    });
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).sheetOrNull?.build
        .raceCode,
    ).toBe('PURE');
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
        .attemptOrNull!.skillPlanState!.advisorInitialFillHistory,
    ).toEqual([fill]);
    rebuild(united, 2);
    const again = f.request('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [sourceCompositionChoice('ADVISER')],
        symbioticMonsterProfileIdOrNull: null,
        monsterOrNull: null,
      },
    });
    f.app().command(again);
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
        .compositionPreparation?.requiredRolls,
    ).toEqual([]);
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'CONFIRM',
      previewCommandId: again.commandId,
      interactionsConfirmed: true,
      manualFacesOrNull: null,
    });
    const card = projectedComposition(f).acquisitions.advisorCards[0]!;
    expect(card.cardId).toBe(originalCard.cardId);
    expect(card.symbiontInstanceId).toBe(originalCard.symbiontInstanceId);
    expect(card.iwRolls).toEqual(originalCard.iwRolls);
    expect(card.suppressionRollOrNull).toEqual(originalCard.suppressionRollOrNull);
    const bytes = f.db.serialize();
    expect(() =>
      f.patch('SENTIENT_SYMBIONTS', {
        operation: 'FINISH',
        previewCommandId: again.commandId,
        skills: { advisorSkills: [], dolphinSkills: [] },
      }),
    ).toThrow('INVALID_INPUT');
    expect(f.db.serialize().equals(bytes)).toBe(true);
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'FINISH',
      previewCommandId: again.commandId,
      skills: {
        advisorSkills: [
          { skillKey: 'UNARMED', targetBonus: 3 },
          { skillKey: 'LEARNING', targetBonus: 6 },
        ],
        dolphinSkills: [],
      },
    });
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const state = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
      .attemptOrNull!.skillPlanState!;
    expect(state.advisorInitialFillHistory).toHaveLength(2);
    expect(state.advisorInitialFillHistory[0]).toEqual(fill);
    expect(state.advisorKnowledge[0]?.knownSkills.map((skill) => skill.skillKey)).toEqual([
      'UNARMED',
      'LEARNING',
    ]);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(calls);
    const commit = f.commitRequest(),
      committed = f.app().command(commit);
    f.restartFromDisk();
    const finalBytes = f.db.serialize();
    expect(f.app().command(acquire)).toEqual({ ...acquireReceipt, replayed: true });
    expect(f.app().command(commit)).toEqual({ ...committed, replayed: true });
    expect(f.db.serialize().equals(finalBytes)).toBe(true);
  } finally {
    f.close();
  }
}, 60_000); // ADR0088: three real plans/card confirmations plus disk replay measured 23.153 s; no shared limit changes.
it('CORE216 runtime saves a real learned monster via embedded preparation, final CTA and physical restart with original receipts', () => {
  const f = fixture();
  try {
    const checkpoint = loadCampaignCheckpoint(f.db, f.scope.campaignId),
      basis = compositionBuild(f, 'UNITED');
    const member = sourceCompositionChoice('CHIMERA', 4),
      profile = common.development.levels.find(
        (row) => row.speciesKey === 'CHIMERA' && row.level === 4,
      )!;
    const preview = f.request('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection: {
        symbiontCompositionMode: 'SYMBIOTIC_MONSTER',
        ordinarySymbiontInstances: [],
        symbioticMonsterProfileIdOrNull: profile.levelProfileId,
        monsterOrNull: member,
      },
    });
    const previewReceipt = f.app().command(preview);
    expect(f.app().project().base.formId).toBe('ENM-008');
    expect(f.app().project().base.availableActionKeys).not.toContain('ENM-008::CTA::002');
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'CONFIRM',
      previewCommandId: preview.commandId,
      interactionsConfirmed: true,
      manualFacesOrNull: null,
    });
    expect(f.app().project().base.formId).toBe('ENM-008');
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'FINISH',
      previewCommandId: preview.commandId,
      skills: { advisorSkills: [], dolphinSkills: [] },
    });
    expect(f.app().project().base.formId).toBe('ENM-009');
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const sheet = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(sheet.permanentStats.M).toBe(basis.M + 10 + 15); // MON002 + learned MON016.
    expect(sheet.maxHP).toBe(common.passiveHealth.ordinaryBaseHP + 100); // learned MON012.
    expect(sheet.compositionFacts?.['specimens']).toMatchObject([
      {
        currentOE: 1600,
        maxOE: 1600,
        specialHistories: { devourings: [], companions: [], ratpack: [] },
      },
    ]);
    const commit = f.commitRequest(),
      receipt = f.app().command(commit),
      rows = compositionStorageRows(f);
    f.restartFromDisk();
    expect(f.db.memory).toBe(false);
    expect(compositionStorageRows(f)).toEqual(rows);
    expect(f.db.pragma('foreign_key_check')).toEqual([]);
    const bytes = f.db.serialize();
    expect(f.app().project().base.roleFilteredPayload['sheetOrNull']).toEqual(sheet);
    expect(f.app().command(commit)).toEqual({ ...receipt, replayed: true });
    expect(f.app().command(preview)).toEqual({ ...previewReceipt, replayed: true });
    expect(f.db.serialize().equals(bytes)).toBe(true);
    expect(loadCampaignCheckpoint(f.db, f.scope.campaignId)).toEqual(checkpoint);
  } finally {
    f.close();
  }
});
it('CORE216 runtime retains a real FREE acquisition through Back, new empty composition, COMMIT and physical exact replay without a second roll', () => {
  const f = fixture(catalog, true, 'AUTO');
  try {
    const basis = compositionBuild(f, 'FREE');
    const preview = f.request('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [
          sourceCompositionChoice('OWL'),
          sourceCompositionChoice('TICK'),
        ],
        symbioticMonsterProfileIdOrNull: null,
        monsterOrNull: null,
      },
    });
    f.app().command(preview);
    const confirm = f.request('SENTIENT_SYMBIONTS', {
      operation: 'CONFIRM',
      previewCommandId: preview.commandId,
      interactionsConfirmed: true,
      manualFacesOrNull: null,
    });
    const beforeCalls = vi.mocked(randomInt).mock.calls.length,
      original = f.app().command(confirm);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(beforeCalls + 1);
    const acquisition = projectedComposition(f).acquisitions.freeSlotOrNull!;
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'FINISH',
      previewCommandId: preview.commandId,
      skills: { advisorSkills: [], dolphinSkills: [] },
    });
    f.nav('ENM-009::CTA::003');
    const empty = f.request('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [],
        symbioticMonsterProfileIdOrNull: null,
        monsterOrNull: null,
      },
    });
    f.app().command(empty);
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'CONFIRM',
      previewCommandId: empty.commandId,
      interactionsConfirmed: true,
      manualFacesOrNull: null,
    });
    expect(projectedComposition(f).acquisitions.freeSlotOrNull).toEqual(acquisition);
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'FINISH',
      previewCommandId: empty.commandId,
      skills: { advisorSkills: [], dolphinSkills: [] },
    });
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const sheet = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(sheet.permanentStats.S).toBe(basis.S + acquisition.permanentStatConsequence.S);
    const commit = f.commitRequest(),
      result = f.app().command(commit),
      rows = compositionStorageRows(f);
    f.restartFromDisk();
    expect(f.db.memory).toBe(false);
    expect(compositionStorageRows(f)).toEqual(rows);
    expect(f.db.pragma('foreign_key_check')).toEqual([]);
    const bytes = f.db.serialize();
    expect(f.app().command(commit)).toEqual({ ...result, replayed: true });
    expect(f.app().command(confirm)).toEqual({ ...original, replayed: true });
    expect(f.db.serialize().equals(bytes)).toBe(true);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(beforeCalls + 1);
  } finally {
    f.close();
  }
});
it('CORE216 runtime defers provisional Skunk C0 to actual inventory, refusing no/unsealed/fake Nate and saving only real sealed equipped Nate', () => {
  const f = fixture();
  try {
    const baseStats = { ...stats, C: 10 };
    f.patch('SENTIENT_IDENTITY', identity);
    f.patch('SENTIENT_STATS', baseStats);
    f.patch('SENTIENT_BUILD', {
      operation: 'INITIALIZE',
      initialInput: {
        baseStats,
        build: {
          raceCode: 'UNITED',
          pureClassOrNull: null,
          skillSelections: [
            { skillKey: 'TEACHING', targetBonus: 3 },
            { skillKey: 'LEARNING', targetBonus: 6 },
          ],
        },
      },
    });
    const basis = calculateSkillStageStats(common.skills, {
      baseStats,
      raceCode: 'UNITED',
      classCode: null,
      creationMode: 'MANUAL',
    }).skillStageStats;
    const preview = f.request('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [sourceCompositionChoice('SKUNK')],
        symbioticMonsterProfileIdOrNull: null,
        monsterOrNull: null,
      },
    });
    f.app().command(preview);
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
        .compositionPreparation?.permanentStatsOrNull?.C,
    ).toBe(0);
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'CONFIRM',
      previewCommandId: preview.commandId,
      interactionsConfirmed: true,
      manualFacesOrNull: null,
    });
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'FINISH',
      previewCommandId: preview.commandId,
      skills: { advisorSkills: [], dolphinSkills: [] },
    });
    expect(f.app().project().base.formId).toBe('ENM-009');
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
        .attemptOrNull?.skillPlanState?.planOrNull?.accountingOrNull,
    ).toBeNull();
    const nate = {
      itemTypeId: 'ITM-ARM-005',
      quantity: 1,
      profile: { kind: 'CATALOG' },
      equipped: true,
      equippedSlots: ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'],
      bodyZone: null,
      gripMode: null,
      currentAmmo: null,
      shieldCurrentHP: null,
      broken: false,
      sealed: true,
      linkedSetInstanceId: null,
      componentRole: null,
      qualityRoll: null,
      coatingInstanceIds: [],
      issueReason: 'Реальный герметичный Натэ по CORE-053/SYM-174',
    };
    for (const inventory of [
      { inventoryItems: [], armorCompatibilityReasonOrNull: null },
      { inventoryItems: [{ ...nate, sealed: false }], armorCompatibilityReasonOrNull: null },
      {
        inventoryItems: [{ ...nate, equipped: false, equippedSlots: [] }],
        armorCompatibilityReasonOrNull: null,
      },
      { inventoryItems: [], armorCompatibilityReasonOrNull: null, equippedHermeticNate: true },
    ]) {
      const request = f.request('SENTIENT_INVENTORY', inventory),
        bytes = f.db.serialize();
      expect(() => f.app().command(request)).toThrow();
      expect(f.db.serialize().equals(bytes)).toBe(true);
      expect(f.app().project().base.formId).toBe('ENM-009');
    }
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [nate], armorCompatibilityReasonOrNull: null });
    const sheet = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(sheet.permanentStats.C).toBe(basis.C);
    expect(sheet.inventory.inventoryItems[0]).toMatchObject({
      itemTypeId: 'ITM-ARM-005',
      sealed: true,
      equipped: true,
    });
    const cached = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
      .attemptOrNull!;
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::003');
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'FINISH',
      previewCommandId: preview.commandId,
      skills: { advisorSkills: [], dolphinSkills: [] },
    });
    const returned = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!;
    expect(returned.inventoryOrNull).toEqual(cached.inventoryOrNull);
    expect(returned.itemTemplateKeys).toEqual(cached.itemTemplateKeys);
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [nate], armorCompatibilityReasonOrNull: null });
    const savedSheet = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(savedSheet.skills).toContainEqual(
      expect.objectContaining({ skillKey: 'TEACHING', bonus: 3, slotCost: 3 }),
    );
    expect(
      savedSheet.skillPlanState?.planOrNull?.accountingOrNull?.permanentLosses.some(
        (loss) => loss.skillKey === 'TEACHING',
      ),
    ).toBe(false);
    const request = f.commitRequest(),
      receipt = f.app().command(request);
    f.restartFromDisk();
    expect(f.app().project().base.roleFilteredPayload['sheetOrNull']).toEqual(savedSheet);
    const bytes = f.db.serialize();
    expect(f.app().command(request)).toEqual({ ...receipt, replayed: true });
    expect(f.db.serialize().equals(bytes)).toBe(true);
  } finally {
    f.close();
  }
});
it('CORE216 runtime reads genuine pre257 bytes and keeps a pending legacy upgrade editable until explicit confirmation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'symbiosis-enemy-legacy21-'));
  let db: ReturnType<typeof openPersistenceDatabase> | undefined;
  try {
    const root = join(process.cwd(), 'tests/fixtures/enemy-empty-v1');
    const metadata = JSON.parse(readFileSync(join(root, 'metadata.json'), 'utf8')) as {
      producerHead: string;
      producerTree: string;
      databaseSha256: string;
      scope: GmRequestReviewScope;
      originalCommitRequest: EnemyWorkflowRequest;
      originalCommitResult: { replayed: boolean; receipt: CommandReceipt };
    };
    const compressed = readFileSync(join(root, 'schema21-empty-v1.sqlite.gz'));
    expect(createHash('sha256').update(compressed).digest('hex')).toBe(
      '3ae110cac4aa6e89ae7b2d7d9027ed42a3df3e6558decc85cebca9871e8e9d41',
    );
    expect(metadata.producerHead).toBe('11fde3e35fe27de8ca718de57e5c6682c7e2cf86');
    expect(metadata.producerTree).toBe('0f01cd9a17a47a6643eae5a386df70de40086cad');
    const seed = gunzipSync(compressed);
    expect(createHash('sha256').update(seed).digest('hex')).toBe(metadata.databaseSha256);
    const filename = join(directory, 'legacy.sqlite');
    writeFileSync(filename, seed);
    const raw = new Database(filename, { readonly: true, fileMustExist: true });
    let rows: ReturnType<typeof compositionStorageRows>;
    try {
      rows = compositionStorageRows({ db: raw });
    } finally {
      raw.close();
    }
    const originalRegistry = rows['schema_migration'];
    if (!Array.isArray(originalRegistry)) throw Error('Historical migration registry absent');
    expect(originalRegistry).toHaveLength(21);
    const migratedRows = {
      ...rows,
      schema_migration: [
        ...originalRegistry,
        {
          version: migration0022.version,
          name: migration0022.name,
          checksum_sha256: createHash('sha256').update(migration0022.sql).digest('hex'),
        },
      ],
    };
    db = openPersistenceDatabase(filename);
    const database = () =>
      db ??
      (() => {
        throw Error('Closed fixture database');
      })();
    const readCurrent = (
      observe: Parameters<typeof readGmRequestReviewSourceWith>[3] = () => undefined,
    ) =>
      readGmRequestReviewSourceWith(
        database(),
        metadata.scope,
        () => undefined,
        (current, state) => {
          validateEnemyLibrarySource(current, state, source, baseline);
          validateEnemyAuthoringSource(database(), current, state, catalog, baseline);
          return observe(current, state);
        },
      ).source;
    const app = () =>
      createEnemyAuthoringApplication({
        database: database(),
        scope: metadata.scope,
        catalog,
        baseline,
        validateOwner: () => undefined,
        readCurrent,
      });
    expect(compositionStorageRows({ db: database() })).toEqual(migratedRows);
    expect(
      database().prepare('SELECT MAX(version) version,COUNT(*) count FROM schema_migration').get(),
    ).toEqual({ version: 22, count: 22 });
    expect(database().pragma('user_version', { simple: true })).toBe(0);
    const current = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
    expect(current.formId).toBe('ENM-009');
    expect(Object.hasOwn(current.context.attemptOrNull!, 'compositionAcquisitions')).toBe(false);
    expect(current.context.attemptOrNull?.compositionOrNull).toEqual({
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
    });
    expect(app().command(metadata.originalCommitRequest)).toEqual({
      ...metadata.originalCommitResult,
      replayed: true,
    });
    expect(compositionStorageRows({ db: database() })).toEqual(migratedRows);
    database().close();
    db = openPersistenceDatabase(filename);
    const bytes = database().serialize();
    expect(app().command(metadata.originalCommitRequest)).toEqual({
      ...metadata.originalCommitResult,
      replayed: true,
    });
    expect(database().serialize().equals(bytes)).toBe(true);
    expect(compositionStorageRows({ db: database() })).toEqual(migratedRows);
    expect(database().pragma('foreign_key_check')).toEqual([]);
    const nav = (actionKey: ActionKey) => {
      const projection = app().project();
      return commitGmRequestReviewNavigation(
        database(),
        metadata.scope,
        {
          messageType: 'navigation.form-action',
          protocolVersion: 2,
          navigationRequestId: randomUUID(),
          sourceFormId: projection.base.formId,
          expectedProjectionRevision: projection.revisions.projectionRevision,
          actionKey,
        },
        () => undefined,
        () => {
          readCurrent();
        },
      );
    };
    const request = (stage: EnemyPatchStage, data: JsonObject): EnemyWorkflowRequest => {
      const p = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload),
        attempt = p.context.attemptOrNull!;
      return {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        role: 'gm',
        commandId: randomUUID(),
        workflowCommandId: 'UI-CMD-ENEMY-DRAFT-PATCH',
        expectedRevisions: {
          stateRevision: p.stateRevision,
          projectionRevision: p.projectionRevision,
          actorVisibilityRevision: p.actorVisibilityRevision,
        },
        payload: {
          campaignId: p.campaignId,
          creationAttemptId: attempt.attemptId,
          expectedAttemptRevision: attempt.revision,
          stage,
          data,
        },
      };
    };
    nav('ENM-009::CTA::001');
    const old = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload).context
      .attemptOrNull!;
    const previewRequest = request('SENTIENT_BUILD', {
      operation: 'PREVIEW_REBUILD',
      expectedPlanRevision: 0,
      initialInput: {
        baseStats: old.baseStatsOrNull,
        build: old.buildOrNull,
      } as unknown as JsonObject,
    });
    const previewReceipt = app().command(previewRequest);
    const pending = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload).context
      .attemptOrNull!;
    expect(Object.hasOwn(pending, 'schemaVersion')).toBe(false);
    expect(Object.hasOwn(pending, 'skillPlanState')).toBe(false);
    expect(pending.legacySkillPlanPreview?.previewCommandId).toBe(previewRequest.commandId);
    expect(pending.buildOrNull).toEqual(old.buildOrNull);
    expect(pending.compositionOrNull).toEqual(old.compositionOrNull);
    database().close();
    db = openPersistenceDatabase(filename);
    const discard = request('SENTIENT_BUILD', {
      operation: 'DISCARD_REBUILD',
      previewCommandId: previewRequest.commandId,
    });
    app().command(discard);
    expect(
      Object.hasOwn(
        enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload).context
          .attemptOrNull!,
        'schemaVersion',
      ),
    ).toBe(false);
    nav('ENM-007::CTA::005');
    const changedBase = { ...old.baseStatsOrNull, W: 10 };
    app().command(request('SENTIENT_STATS', changedBase));
    const legacyBuild = {
      raceCode: 'FREE',
      pureClassOrNull: null,
      skillSelections: [{ skillKey: 'LEARNING', targetBonus: 5 }],
    };
    app().command(request('SENTIENT_BUILD', legacyBuild));
    expect(app().project().base.formId).toBe('ENM-008');
    app().command(
      request('SENTIENT_SYMBIONTS', {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [],
        symbioticMonsterProfileIdOrNull: null,
      }),
    );
    app().command(
      request('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null }),
    );
    const edited = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
    expect(edited.sheetOrNull?.skillSlots).toEqual({ capacity: 5, used: 5, remaining: 0 });
    expect(Object.hasOwn(edited.context.attemptOrNull!, 'skillPlanState')).toBe(false);
    expect(Object.hasOwn(edited.sheetOrNull!, 'skillPlanState')).toBe(false);
    nav('ENM-010::CTA::005');
    nav('ENM-009::CTA::001');
    app().command(
      request('SENTIENT_BUILD', {
        operation: 'PREVIEW_REBUILD',
        expectedPlanRevision: 0,
        initialInput: { baseStats: changedBase, build: legacyBuild },
      }),
    );
    const upgrade = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload).context
      .attemptOrNull!.legacySkillPlanPreview!;
    app().command(
      request('SENTIENT_BUILD', {
        operation: 'CONFIRM_REBUILD',
        expectedPlanRevision: 0,
        previewCommandId: upgrade.previewCommandId,
        initialInput: upgrade.initialInput as unknown as JsonObject,
        displayedConsequences: upgrade.consequences as unknown as JsonObject,
      }),
    );
    expect(
      enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload).context.attemptOrNull,
    ).toMatchObject({
      schemaVersion: 2,
      compositionOrNull: null,
      inventoryOrNull: null,
      skillPlanState: { planOrNull: { revision: 1 } },
    });
    database().close();
    db = openPersistenceDatabase(filename);
    const replayBytes = database().serialize();
    expect(app().command(previewRequest)).toEqual({ ...previewReceipt, replayed: true });
    expect(app().command(metadata.originalCommitRequest)).toEqual({
      ...metadata.originalCommitResult,
      replayed: true,
    });
    expect(database().serialize().equals(replayBytes)).toBe(true);
    const after = compositionStorageRows({ db: database() });
    for (const table of [
      'campaign_enemy_template',
      'campaign_enemy_version',
      'campaign_enemy_history',
      'campaign_enemy_current_version',
    ])
      expect(after[table]).toEqual(rows[table]);
    const oldEvents = rows['gm_request_queue_event'] as { event_id: string }[];
    expect(
      (after['gm_request_queue_event'] as { event_id: string }[]).filter((row) =>
        oldEvents.some((old) => old.event_id === row.event_id),
      ),
    ).toEqual(oldEvents);
  } finally {
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
it('CORE216 runtime refuses missing extra and out-of-range MANUAL acquisition faces without writes or AUTO sampling, then replays the real manual receipt', () => {
  const f = fixture();
  try {
    compositionBuild(f, 'FREE');
    const preview = f.request('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [
          sourceCompositionChoice('OWL'),
          sourceCompositionChoice('TICK'),
        ],
        symbioticMonsterProfileIdOrNull: null,
        monsterOrNull: null,
      },
    });
    f.app().command(preview);
    const confirm = f.request('SENTIENT_SYMBIONTS', {
      operation: 'CONFIRM',
      previewCommandId: preview.commandId,
      interactionsConfirmed: true,
      manualFacesOrNull: [3],
    });
    const calls = vi.mocked(randomInt).mock.calls.length;
    for (const faces of [null, [], [0], [7], [1, 2]]) {
      const invalid = {
          ...confirm,
          payload: {
            ...confirm.payload,
            data: { ...confirm.payload.data, manualFacesOrNull: faces },
          },
        },
        bytes = f.db.serialize();
      expect(() => f.app().command(invalid)).toThrow('INVALID_INPUT');
      expect(f.db.serialize().equals(bytes)).toBe(true);
      expect(vi.mocked(randomInt).mock.calls.length).toBe(calls);
    }
    const result = f.app().command(confirm);
    expect(projectedComposition(f).acquisitions.freeSlotOrNull?.roll).toMatchObject({
      modeSnapshot: 'MANUAL',
      mechanical: { dieSides: 6, rawFace: 3 },
    });
    const bytes = f.db.serialize();
    expect(f.app().command(confirm)).toEqual({ ...result, replayed: true });
    expect(f.db.serialize().equals(bytes)).toBe(true);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(calls);
  } finally {
    f.close();
  }
});
it('CORE216 runtime refuses invalid nonpositive FREE acquisition S/M/Z before sampling, preserving the pending draft without a stat buff', () => {
  const f = fixture(catalog, true, 'AUTO');
  try {
    compositionBuild(f, 'FREE', { ...stats, M: 3 }); // CORE006 gives skill-stageM1; Dragon then makes the provisional M negative.
    const preview = f.request('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [
          sourceCompositionChoice('DRAGON'),
          sourceCompositionChoice('OWL'),
        ],
        symbioticMonsterProfileIdOrNull: null,
        monsterOrNull: null,
      },
    });
    f.app().command(preview);
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
        .compositionPreparation?.permanentStatsOrNull?.M,
    ).toBeLessThan(1);
    const request = f.request('SENTIENT_SYMBIONTS', {
        operation: 'CONFIRM',
        previewCommandId: preview.commandId,
        interactionsConfirmed: true,
        manualFacesOrNull: null,
      }),
      calls = vi.mocked(randomInt).mock.calls.length,
      bytes = f.db.serialize();
    expect(() => f.app().command(request)).toThrow('INVALID_INPUT');
    expect(f.db.serialize().equals(bytes)).toBe(true);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(calls);
    expect(projectedComposition(f).acquisitions.freeSlotOrNull).toBeNull();
  } finally {
    f.close();
  }
});
it('CORE216 runtime preserves lower-W known skills and actual overflow, records permanent GROSS loss and never reissues the spent free grant', () => {
  const f = fixture();
  try {
    compositionBuild(f, 'UNITED'); // source manual S13,D20,W20: GROSS requires S14,D6.
    const selected = {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [sourceCompositionChoice('TROGR', 5)],
      symbioticMonsterProfileIdOrNull: null,
      monsterOrNull: null,
    };
    const first = confirmComposition(f, selected);
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    let sheet = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(sheet.skills.find((row) => row.skillKey === 'GROSS')).toMatchObject({
      bonus: 3,
      slotCost: 0,
      source: 'SYMBIONT_GRANTED',
    });
    expect(sheet.skills.find((row) => row.skillKey === 'UNARMED')).toMatchObject({
      bonus: 7,
      slotCost: 9,
    });
    expect(sheet.skillSlots).toEqual({ capacity: 1, used: 10, remaining: 0, overflow: 9 });
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::003');
    confirmComposition(f, { ...selected, ordinarySymbiontInstances: [] });
    expect(projectedComposition(f).acquisitions.grossGrantOrNull).toMatchObject({
      sourceCommandId: first.confirm.commandId,
      bonusBefore: 0,
      bonusAfter: 3,
      lostAtCommandIdOrNull: null,
    });
    const bodyLoss = f.request('SENTIENT_INVENTORY', {
      inventoryItems: [],
      armorCompatibilityReasonOrNull: null,
    });
    f.app().command(bodyLoss);
    sheet = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).sheetOrNull!;
    expect(sheet.skills.some((row) => row.skillKey === 'GROSS')).toBe(false);
    expect(sheet.compositionFacts?.['lostSkills']).toContain('GROSS');
    expect(sheet.skillPlanState?.planOrNull?.accountingOrNull?.permanentLosses).toContainEqual({
      skillKey: 'GROSS',
      commandId: bodyLoss.commandId,
      bonusBefore: 3,
      releasedStartSlots: 0,
      releasedDolphinSlots: 0,
    });
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::003');
    confirmComposition(f, selected);
    expect(projectedComposition(f).acquisitions.grossGrantOrNull?.lostAtCommandIdOrNull).toBe(
      bodyLoss.commandId,
    );
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    sheet = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).sheetOrNull!;
    expect(sheet.permanentStats.S).toBe(25);
    expect(sheet.skills.some((row) => row.skillKey === 'GROSS')).toBe(false);
    const request = f.commitRequest(),
      result = f.app().command(request);
    f.restartFromDisk();
    const bytes = f.db.serialize();
    expect(f.app().command(first.confirm)).toEqual({ ...first.result, replayed: true });
    expect(f.app().command(request)).toEqual({ ...result, replayed: true });
    expect(f.db.serialize().equals(bytes)).toBe(true);
  } finally {
    f.close();
  }
});
it('CORE216 runtime rejects a coherently rehashed foreign historical species hidden by later valid selection and exit after disk reopen', () => {
  const f = fixture();
  try {
    compositionBuild(f, 'UNITED');
    const selection = {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [sourceCompositionChoice('OWL')],
      symbioticMonsterProfileIdOrNull: null,
      monsterOrNull: null,
    };
    const original = f.request('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection,
    });
    f.app().command(original);
    f.patch('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection,
    });
    for (const key of [
      'ENM-008::CTA::001',
      'ENM-007::CTA::005',
      'ENM-006::CTA::001',
      'ENM-005::CTA::004',
      'ENM-001::CTA::013',
    ] as const)
      f.nav(key);
    const rows = f.db
      .prepare('SELECT event_id,record_json FROM gm_request_queue_event ORDER BY event_index')
      .all() as { event_id: string; record_json: string }[];
    let predecessor: string | null = null,
      active = false,
      changed = false;
    for (const row of rows) {
      const event = JSON.parse(row.record_json) as JsonObject,
        mutation = event['mutation'] as JsonObject,
        view = event['view'] as JsonObject;
      if (mutation['kind'] === 'ENEMY_AUTHORING') {
        const cause = mutation['cause'] as JsonObject,
          request = cause['request'] as JsonObject,
          payload = request['payload'] as JsonObject;
        if ((payload['data'] as JsonObject | undefined)?.['operation'] === 'PREVIEW') {
          active = !changed;
          if (active) {
            changed = true;
            const input = ((payload['data'] as JsonObject)['selection'] as JsonObject)[
              'ordinarySymbiontInstances'
            ] as JsonObject[];
            Object.assign(input[0]!, { speciesKey: 'FOREIGN_SPECIES' });
            Object.assign(
              (
                (cause['preparedComposition'] as JsonObject)[
                  'ordinarySymbiontInstances'
                ] as JsonObject[]
              )[0]!,
              { speciesKey: 'FOREIGN_SPECIES' },
            );
          }
        }
      }
      const attempt = (view['enemyAuthoring'] as JsonObject | undefined)?.['attemptOrNull'] as
        JsonObject | null | undefined;
      if (active && attempt?.['compositionOrNull'] != null)
        Object.assign(
          (
            (attempt['compositionOrNull'] as JsonObject)[
              'ordinarySymbiontInstances'
            ] as JsonObject[]
          )[0]!,
          { speciesKey: 'FOREIGN_SPECIES' },
        );
      const { snapshotSha256: _ignored, ...body } = view;
      Object.assign(view, { snapshotSha256: campaignCreationHash(body) });
      Object.assign(event, { previousEventSha256OrNull: predecessor });
      predecessor = campaignCreationHash(event);
      f.db
        .prepare('UPDATE gm_request_queue_event SET record_json=?,record_sha256=? WHERE event_id=?')
        .run(s.canonical(event), predecessor, row.event_id);
    }
    expect(changed).toBe(true);
    f.restartFromDisk();
    const structural = f.db
      .transaction(() => readGmRequestReviewViewStateInTransaction(f.db, f.scope))
      .deferred();
    expect(structural.viewOrNull?.formId).toBe('GM-001'); // A later clean cursor cannot stand in for every-history source proof.
    const bytes = f.db.serialize();
    expect(() => f.checkedRead()).toThrow('CORRUPT_STORAGE');
    expect(() => f.app().project()).toThrow('CORRUPT_STORAGE');
    // The unchanged store callback fence maps observation failures to this command refusal.
    expect(() => f.app().command(original)).toThrow('network application storage: INVALID_INPUT');
    expect(() => f.nav('GM-001::CTA::005')).toThrow('network application storage: INVALID_INPUT');
    expect(f.db.serialize().equals(bytes)).toBe(true);
  } finally {
    f.close();
  }
});
it.each([
  'CONFIRM',
  'COMMIT',
  'EXACT_COMMIT_REPLAY',
  'REBUILD_PREVIEW',
  'REBUILD_CONFIRM',
  'EXACT_REBUILD_REPLAY',
] as const)(
  'CORE216 runtime refuses new %s after actual persisted current-GM loss before sampling, mutation or receipt disclosure',
  (mode) => {
    const f = fixture(catalog, true, 'AUTO');
    try {
      let request: EnemyWorkflowRequest;
      if (
        mode === 'REBUILD_PREVIEW' ||
        mode === 'REBUILD_CONFIRM' ||
        mode === 'EXACT_REBUILD_REPLAY'
      ) {
        f.complete();
        f.nav('ENM-010::CTA::005');
        f.nav('ENM-009::CTA::001');
        const initialInput = enemyAuthoringProjectionValue(
          f.app().project().base.roleFilteredPayload,
        ).context.attemptOrNull!.skillPlanState!.planOrNull!.initialInput;
        const previewRequest = f.request('SENTIENT_BUILD', {
          operation: 'PREVIEW_REBUILD',
          expectedPlanRevision: 1,
          initialInput: initialInput as unknown as JsonObject,
        });
        if (mode === 'REBUILD_PREVIEW') request = previewRequest;
        else {
          f.app().command(previewRequest);
          const preview = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
            .context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!;
          request = f.request('SENTIENT_BUILD', {
            operation: 'CONFIRM_REBUILD',
            expectedPlanRevision: 1,
            previewCommandId: preview.previewCommandId,
            initialInput: initialInput as unknown as JsonObject,
            displayedConsequences: preview.consequences as unknown as JsonObject,
          });
          if (mode === 'EXACT_REBUILD_REPLAY') {
            f.app().command(request);
            for (const key of [
              'ENM-008::CTA::001',
              'ENM-007::CTA::005',
              'ENM-006::CTA::001',
              'ENM-005::CTA::004',
              'ENM-001::CTA::013',
            ] as const)
              f.nav(key);
            f.restartFromDisk();
          }
        }
      } else if (mode === 'CONFIRM') {
        compositionBuild(f, 'FREE');
        const preview = f.request('SENTIENT_SYMBIONTS', {
          operation: 'PREVIEW',
          advisorRemovalConfirmed: false,
          selection: {
            symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
            ordinarySymbiontInstances: [
              sourceCompositionChoice('OWL'),
              sourceCompositionChoice('TICK'),
            ],
            symbioticMonsterProfileIdOrNull: null,
            monsterOrNull: null,
          },
        });
        f.app().command(preview);
        request = f.request('SENTIENT_SYMBIONTS', {
          operation: 'CONFIRM',
          previewCommandId: preview.commandId,
          interactionsConfirmed: true,
          manualFacesOrNull: null,
        });
      } else {
        compositionBuild(f, 'UNITED');
        confirmComposition(f, {
          symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
          ordinarySymbiontInstances: [sourceCompositionChoice('OWL')],
          symbioticMonsterProfileIdOrNull: null,
          monsterOrNull: null,
        });
        f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
        request = f.commitRequest();
        if (mode === 'EXACT_COMMIT_REPLAY') {
          f.app().command(request);
          f.nav('ENM-020::CTA::002');
          f.nav('ENM-001::CTA::013');
          f.restartFromDisk();
        }
      }
      const masterProfileId = f.readCurrent().context.masterProfileId;
      let checked = 0,
        denied = 0;
      const validateOwner: CampaignPrivateOwnerValidator = (owner) => {
        checked++;
        const active = readActiveLocalGmContext(f.db, f.scope.ownerDeviceId);
        if (
          active?.gmLocalContextId !== f.scope.gmLocalContextId ||
          active.masterProfileId !== masterProfileId ||
          owner.ownerDeviceId !== f.scope.ownerDeviceId ||
          owner.campaignId !== f.scope.campaignId ||
          owner.masterProfileId !== masterProfileId
        ) {
          denied++;
          return s.fail('FOREIGN_OWNER');
        }
      };
      readGmRequestReviewSource(f.db, f.scope, validateOwner);
      expect(checked).toBeGreaterThan(0);
      const app = createEnemyAuthoringApplication({
        database: f.db,
        scope: f.scope,
        catalog,
        baseline,
        validateOwner,
        readCurrent: f.checkedRead,
      });
      const next = randomUUID();
      createLocalGmContext(
        f.db,
        { ownerDeviceId: f.scope.ownerDeviceId, masterProfileId, gmLocalContextId: next },
        () => undefined,
      );
      expect(readActiveLocalGmContext(f.db, f.scope.ownerDeviceId)?.gmLocalContextId).toBe(next);
      const bytes = f.db.serialize(),
        calls = vi.mocked(randomInt).mock.calls.length;
      expect(() => app.command(request)).toThrow('CORRUPT_STORAGE');
      expect(denied).toBe(1);
      expect(f.db.serialize().equals(bytes)).toBe(true);
      expect(vi.mocked(randomInt).mock.calls.length).toBe(calls);
    } finally {
      f.close();
    }
  },
);
it('ENM-005…010/020 atomically saves complete sexless SENTIENT V1 and exact replay survives later NAV/reopen without campaign mutation', () => {
  const f = fixture();
  try {
    const original = loadCampaignCheckpoint(f.db, f.scope.campaignId);
    f.complete();
    const preview = f.app().project();
    expect(preview.base.formId).toBe('ENM-010');
    expect(preview.base.roleFilteredPayload['validationErrors']).toEqual([]);
    expect(preview.base.roleFilteredPayload['sheetOrNull']).toMatchObject({
      identity,
      baseStats: stats,
      build: { raceCode: 'PURE' },
      skills: expect.arrayContaining([
        expect.objectContaining({ skillKey: 'UNARMED', bonus: 7 }),
      ]) as unknown,
      inventory: { inventoryItems: [] },
      artAssetKey: 'symbiosis_placeholder_sentient_enemy',
    });
    const request = f.commitRequest(),
      saved = f.app().command(request);
    expect(f.app().project().base.formId).toBe('ENM-020');
    for (const table of [
      'campaign_enemy_template',
      'campaign_enemy_version',
      'campaign_enemy_history',
      'campaign_enemy_current_version',
    ])
      expect(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({ n: 1 });
    const bytes = f.db.serialize();
    f.restart();
    expect(f.app().command(request)).toEqual({ ...saved, replayed: true });
    expect(f.db.serialize().equals(bytes)).toBe(true);
    expect(loadCampaignCheckpoint(f.db, f.scope.campaignId)).toEqual(original);
    f.nav('ENM-020::CTA::002');
    f.nav('ENM-001::CTA::013');
    expect(f.app().command(request)).toEqual({ ...saved, replayed: true });
    expect(() =>
      f.app().command({ ...request, payload: { ...request.payload, expectedAttemptRevision: 99 } }),
    ).toThrow();
    f.loseAuthority();
    expect(() => f.app().command(request)).toThrow();
  } finally {
    f.close();
  }
});
it('CORE-193 padded name is canonical in PATCH view, complete preview, saved version and exact receipt replay after reopen', () => {
  const f = fixture();
  try {
    const original = f.request('SENTIENT_IDENTITY', { ...identity, name: '  Страж  ' });
    const first = f.app().command(original);
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
        .attemptOrNull?.identityOrNull?.name,
    ).toBe('Страж');
    f.patch('SENTIENT_STATS', stats);
    f.patch('SENTIENT_BUILD', {
      raceCode: 'PURE',
      pureClassOrNull: 'SOLDIER',
      skillSelections: [{ skillKey: 'UNARMED', targetBonus: 7 }],
    });
    f.patch('SENTIENT_SYMBIONTS', {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
    });
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).sheetOrNull
        ?.identity.name,
    ).toBe('Страж');
    f.app().command(f.commitRequest());
    f.restart();
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).sheetOrNull
        ?.identity.name,
    ).toBe('Страж');
    expect(f.app().command(original)).toEqual({ ...first, replayed: true });
    f.nav('ENM-020::CTA::002');
    const users = enemyLibraryProjectionValue(
      f.library().project().base.roleFilteredPayload,
    ).currentUserTemplates;
    expect(users.map((user) => user.displayName)).toEqual(['Страж']);
  } finally {
    f.close();
  }
});
it.each(['PATCH', 'COMMIT', 'EXACT_COMMIT_REPLAY'] as const)(
  'refuses prebuilt %s after the actual persisted current GM context changes, before receipts or writes',
  (mode) => {
    const f = fixture();
    try {
      const masterProfileId = f.readCurrent().context.masterProfileId;
      if (mode !== 'PATCH') f.complete();
      const request =
        mode === 'PATCH' ? f.request('SENTIENT_IDENTITY', identity) : f.commitRequest();
      if (mode === 'EXACT_COMMIT_REPLAY') {
        f.app().command(request);
        f.nav('ENM-020::CTA::002');
        f.nav('ENM-001::CTA::013');
        f.restart();
      }
      let validated = 0,
        denied = 0;
      const validateOwner: CampaignPrivateOwnerValidator = (owner) => {
        validated++;
        const active = readActiveLocalGmContext(f.db, f.scope.ownerDeviceId);
        if (
          active?.gmLocalContextId !== f.scope.gmLocalContextId ||
          active.masterProfileId !== masterProfileId ||
          owner.ownerDeviceId !== f.scope.ownerDeviceId ||
          owner.campaignId !== f.scope.campaignId ||
          owner.masterProfileId !== masterProfileId
        ) {
          denied++;
          return s.fail('FOREIGN_OWNER');
        }
      };
      const app = createEnemyAuthoringApplication({
        database: f.db,
        scope: f.scope,
        catalog,
        baseline,
        validateOwner,
        readCurrent: f.checkedRead,
      });
      readGmRequestReviewSource(f.db, f.scope, validateOwner);
      expect(validated).toBeGreaterThan(0);
      validated = 0;
      const nextContext = randomUUID();
      createLocalGmContext(
        f.db,
        { ownerDeviceId: f.scope.ownerDeviceId, masterProfileId, gmLocalContextId: nextContext },
        () => undefined,
      );
      expect(readActiveLocalGmContext(f.db, f.scope.ownerDeviceId)?.gmLocalContextId).toBe(
        nextContext,
      );
      const before = f.db.serialize();
      expect(() => app.command(request)).toThrow('CORRUPT_STORAGE');
      expect(validated).toBeGreaterThan(0);
      expect(denied).toBe(1);
      expect(f.db.serialize().equals(before)).toBe(true);
    } finally {
      f.close();
    }
  },
);
it('CORE-197 permits final stats above35; CORE-164 refuses invalid permanent stats without any clamp', () => {
  const f = fixture();
  try {
    f.complete();
    const p = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload);
    // This delivered arithmetic regression deliberately uses the legacy grammar. Modern plan
    // binding and final-after-composition floor are exercised by the real workflows above.
    const legacy = structuredClone(p.context.attemptOrNull!);
    for (const key of ['schemaVersion', 'skillPlanState', 'compositionAcquisitions'])
      Reflect.deleteProperty(legacy, key);
    const attempt: EnemyAttempt = {
      ...legacy,
      compositionOrNull: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [],
        symbioticMonsterProfileIdOrNull: null,
      },
    };
    const maximum = deriveSentientEnemySheet(catalog, {
      ...attempt,
      baseStatsOrNull: { S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 },
      buildOrNull: {
        raceCode: 'PURE',
        pureClassOrNull: 'SOLDIER',
        skillSelections: [{ skillKey: 'UNARMED', targetBonus: 11 }],
      },
    });
    expect(maximum.baseStats.S).toBe(35);
    expect(maximum.permanentStats.S).toBe(40);
    expect(maximum.permanentStats.M).toBe(40);
    expect(() =>
      deriveSentientEnemySheet(catalog, {
        ...attempt,
        baseStatsOrNull: { ...stats, S: 1 },
        buildOrNull: { raceCode: 'UNITED', pureClassOrNull: null, skillSelections: [] },
      }),
    ).toThrow('ниже 1');
  } finally {
    f.close();
  }
});
it('CORE-016/054–056 preview retains actual armor/weapon deficits and class movement separately from stat modifiers', () => {
  const f = fixture();
  let seekerFixture: ReturnType<typeof fixture> | undefined;
  try {
    f.complete();
    const armor = {
      itemTypeId: 'ITM-ARM-008',
      quantity: 1,
      profile: { kind: 'CATALOG' as const },
      equipped: true,
      equippedSlots: ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'],
      bodyZone: null,
      gripMode: null,
      currentAmmo: null,
      shieldCurrentHP: null,
      broken: false,
      sealed: null,
      linkedSetInstanceId: null,
      componentRole: null,
      qualityRoll: null,
      coatingInstanceIds: [],
      issueReason: 'Доспех по CORE-056',
    };
    // Each full input establishes its own owning plan; changing an already bound DTO would
    // exercise a forged-plan refusal instead of the source equipment arithmetic.
    seekerFixture = fixture();
    seekerFixture.patch('SENTIENT_IDENTITY', identity);
    seekerFixture.patch('SENTIENT_STATS', { ...stats, S: 7, M: 1 });
    seekerFixture.patch('SENTIENT_BUILD', {
      raceCode: 'PURE',
      pureClassOrNull: 'SEEKER',
      skillSelections: [{ skillKey: 'UNARMED', targetBonus: 7 }],
    });
    seekerFixture.patch('SENTIENT_SYMBIONTS', {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
    });
    seekerFixture.patch('SENTIENT_INVENTORY', {
      inventoryItems: [armor],
      armorCompatibilityReasonOrNull: null,
    });
    const seeker = enemyAuthoringProjectionValue(
      seekerFixture.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    // SEEKER S7+2, CORE-056 S24 => deficit15 and penalty30; M1-5 computes at1.
    expect(seeker.permanentStats.S).toBe(9);
    expect(seeker.permanentStats.M).toBe(1);
    expect(seeker.effectiveStats.M).toBe(1);
    expect(seeker.requirementPenalties['armor']).toMatchObject({
      requiredStrength: 24,
      deficit: 15,
      penalty: 30,
    });
    expect(seeker.classMovementModifier).toBe(-15);
    f.nav('ENM-010::CTA::005');
    f.patch('SENTIENT_INVENTORY', {
      inventoryItems: [armor],
      armorCompatibilityReasonOrNull: null,
    });
    const soldier = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(soldier.classMovementModifier).toBe(0);
    expect(soldier.requirementPenalties['armor']).toMatchObject({ deficit: 0, penalty: 0 });
    const weapon = {
      ...armor,
      itemTypeId: 'ITM-WPN-013',
      equippedSlots: ['HAND_L', 'HAND_R'],
      profile: {
        kind: 'MASTER_WEAPON' as const,
        reason: 'Полная карта требований мастера',
        inputs: [
          {
            weaponVariantId: 'DEFAULT' as const,
            damageDefinition: { kind: 'RETAIN' as const },
            penetrationDefinition: { kind: 'RETAIN' as const },
            statRequirements: { S: 30, D: 25, I: 22 },
            instanceDamageOrNull: null,
            rangeMetersOrNull: null,
            accuracyBonusOrNull: null,
          },
        ],
      },
    };
    f.nav('ENM-010::CTA::005');
    f.patch('SENTIENT_INVENTORY', {
      inventoryItems: [weapon],
      armorCompatibilityReasonOrNull: null,
    });
    const armed = enemyAuthoringProjectionValue(
      f.app().project().base.roleFilteredPayload,
    ).sheetOrNull!;
    expect(armed.requirementPenalties['weapons']).toEqual([
      expect.objectContaining({ deficits: { S: 5, D: 3, I: 2 }, deficitTotal: 10, penalty: 20 }),
    ]);
  } finally {
    seekerFixture?.close();
    f.close();
  }
});
it('CORE-193/197 and ADR0077: mass bounds/precision, no sex, exact seven integers without sum limit', () => {
  for (const massKg of [30, 30.1, 499.9, 500])
    expect(enemyIdentityValue({ ...identity, massKg }).massKg).toBe(massKg);
  for (const massKg of [29.9, 500.1, 80.01, NaN, Infinity])
    expect(() => enemyIdentityValue({ ...identity, massKg })).toThrow();
  expect(() => enemyIdentityValue({ ...identity, sex: 'MALE' })).toThrow();
  expect(() => enemyIdentityValue({ ...identity, name: '\u200b' })).toThrow();
  expect(enemyIdentityValue({ ...identity, name: '  ' + identity.name + '  ' }).name).toBe(
    identity.name,
  );
  expect(enemyBaseStatsValue({ S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 })).toEqual({
    S: 35,
    D: 35,
    M: 35,
    Z: 35,
    I: 35,
    W: 35,
    C: 35,
  });
  for (const key of ['S', 'D', 'M', 'Z', 'I', 'W', 'C'])
    for (const value of [0, 36, 1.1])
      expect(() => enemyBaseStatsValue({ ...stats, [key]: value })).toThrow();
});
it('ENM-005 invalid PATCH rolls back the attempt, QUEUE and every catalogue table', () => {
  const f = fixture();
  try {
    const before = f.db.serialize();
    expect(() => f.patch('SENTIENT_IDENTITY', { ...identity, sex: 'FEMALE' })).toThrow();
    expect(f.db.serialize().equals(before)).toBe(true);
  } finally {
    f.close();
  }
});
it('CORE-214 audit binds the actual host master, operation, full before/after, provenance/art and explicit absent RNG atomically', () => {
  const f = fixture();
  try {
    f.complete();
    const actorId = f.readCurrent().context.masterProfileId,
      preview = enemyAuthoringProjectionValue(
        f.app().project().base.roleFilteredPayload,
      ).sheetOrNull;
    const committed = f.app().command(f.commitRequest());
    const row = f.db.prepare('SELECT record_json FROM campaign_enemy_history').get() as {
      record_json: string;
    };
    const audit = JSON.parse(row.record_json) as JsonObject;
    expect(audit).toMatchObject({
      operation: 'CREATE_SENTIENT_ENEMY_TEMPLATE',
      actorId,
      campaignId: f.scope.campaignId,
      timestamp: committed.receipt.result['timestamp'],
      before: null,
      after: { sheet: preview },
      revisions: committed.receipt.revisions,
      provenance: { sourceBaselineVersion: baseline.baselineVersion },
      art: { assetKey: 'symbiosis_placeholder_sentient_enemy', sha256: catalog.art.sha256 },
      rngReceiptOrNull: null,
    });
    const bytes = f.db.serialize();
    f.restart();
    expect(f.app().project().base.formId).toBe('ENM-020');
    expect(f.db.serialize().equals(bytes)).toBe(true);
  } finally {
    f.close();
  }
});
it('checks actual file freshness at first tentative authoring entry/current view and after historical PATCH outside ENM, preserving rollback', () => {
  const root = mkdtempSync(join(tmpdir(), 'enemy-authoring-source-'));
  let f: ReturnType<typeof fixture> | undefined;
  try {
    for (const path of [
      ...Object.keys(ENEMY_AUTHORING_SOURCE_SEALS),
      'generated/media/gm-entity-portraits/symbiosis_placeholder_monster.png',
    ]) {
      const to = join(root, path);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(join(process.cwd(), path)));
    }
    const issued = loadEnemyAuthoringSourceCatalog(root, common);
    let checks = 0;
    f = fixture(
      {
        ...issued,
        assertCurrent: () => {
          checks++;
          issued.assertCurrent();
        },
      },
      false,
    );
    f.checkedRead();
    expect(checks).toBe(0);
    // Compact only the fault fixture: SQLite does not journal unused freelist leaves (§7.3).
    f.db.exec('VACUUM');
    expect(f.db.pragma('freelist_count', { simple: true })).toBe(0);
    const path = join(root, 'generated/spec/character/skills.json'),
      original = readFileSync(path),
      before = f.db.serialize();
    writeFileSync(path, '[]');
    expect(() => f!.nav('ENM-001::CTA::003')).toThrow();
    expect(checks).toBeGreaterThan(0);
    expect(f.db.serialize().equals(before)).toBe(true);
    writeFileSync(path, original);
    f.nav('ENM-001::CTA::003');
    rmSync(path);
    const current = f.db.serialize();
    expect(() => f!.app().project()).toThrow();
    expect(f.db.serialize().equals(current)).toBe(true);
    writeFileSync(path, original);
    f.patch('SENTIENT_IDENTITY', identity);
    f.nav('ENM-006::CTA::001');
    f.nav('ENM-005::CTA::004');
    f.nav('ENM-001::CTA::013');
    const outside = f.db.serialize();
    writeFileSync(path, '[]');
    expect(() => f!.checkedRead()).toThrow('CORRUPT_STORAGE');
    expect(f.db.serialize().equals(outside)).toBe(true);
  } finally {
    f?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
it('CORE-112/MON-072 clothing uses explicit source-backed coverage/quality without armor or Nate protection, and survives V1/restart', () => {
  const f = fixture();
  try {
    f.complete();
    f.nav('ENM-010::CTA::005');
    const clothing = {
      itemTypeId: 'RES-EQP-001',
      quantity: 1,
      profile: { kind: 'CATALOG' },
      equipped: true,
      equippedSlots: ['TORSO', 'ARM_L'],
      bodyZone: null,
      gripMode: null,
      currentAmmo: null,
      shieldCurrentHP: null,
      broken: false,
      sealed: null,
      linkedSetInstanceId: null,
      componentRole: null,
      qualityRoll: null,
      coatingInstanceIds: [],
      issueReason: 'Одежда дозорного',
      qualityTier: 'GOOD',
      clothingProperties: {
        coveredRegionIds: ['TORSO', 'ARM_L'],
        hermetic: false,
        flammability: 'COMBUSTIBLE',
      },
    };
    const before = f.db.serialize();
    expect(() =>
      f.patch('SENTIENT_INVENTORY', {
        inventoryItems: [
          {
            ...clothing,
            clothingProperties: { ...clothing.clothingProperties, coveredRegionIds: [] },
          },
        ],
        armorCompatibilityReasonOrNull: null,
      }),
    ).toThrow();
    expect(f.db.serialize().equals(before)).toBe(true);
    f.patch('SENTIENT_INVENTORY', {
      inventoryItems: [clothing],
      armorCompatibilityReasonOrNull: null,
    });
    const p = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload),
      sheet = p.sheetOrNull!;
    expect(p.catalog['inventoryMetadata']).toMatchObject({
      qualityTiers: expect.arrayContaining([{ value: 'GOOD', label: 'Хорошее' }]) as unknown,
      clothingRegions: expect.arrayContaining(['TORSO', 'ARM_L']) as unknown,
    });
    expect(sheet.inventory.inventoryItems[0]).toMatchObject(clothing);
    expect(sheet.armor['pieces']).toEqual([]);
    expect(sheet.effectiveStats).toEqual(sheet.permanentStats);
    for (const field of ['name', 'equippedSlots'] as const) {
      const malformed = structuredClone(p) as unknown as JsonObject,
        item = ((malformed['sheetOrNull'] as JsonObject)['items'] as JsonObject[])[0]!;
      Reflect.set(item, field, field === 'name' ? 'Чужой предмет' : ['UNKNOWN_SLOT']);
      expect(() => enemyAuthoringProjectionValue(malformed)).toThrow();
    }
    f.app().command(f.commitRequest());
    const bytes = f.db.serialize();
    f.restart();
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).sheetOrNull,
    ).toEqual(sheet);
    expect(f.db.serialize().equals(bytes)).toBe(true);
  } finally {
    f.close();
  }
});
it('cancelled attempt item allocations remain occupied for all old allocators and cannot become a later command identity', () => {
  const f = fixture();
  try {
    f.complete();
    f.nav('ENM-010::CTA::005');
    const item = {
      itemTypeId: 'RES-CUR-003',
      quantity: 3,
      profile: { kind: 'CATALOG' },
      equipped: false,
      equippedSlots: [],
      bodyZone: null,
      gripMode: null,
      currentAmmo: null,
      shieldCurrentHP: null,
      broken: false,
      sealed: null,
      linkedSetInstanceId: null,
      componentRole: null,
      qualityRoll: null,
      coatingInstanceIds: [],
      issueReason: 'Монеты',
    };
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [item], armorCompatibilityReasonOrNull: null });
    const key = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
      .attemptOrNull!.itemTemplateKeys[0]!;
    for (const action of [
      'ENM-010::CTA::005',
      'ENM-009::CTA::001',
      'ENM-007::CTA::005',
      'ENM-006::CTA::001',
      'ENM-005::CTA::004',
    ] as const)
      f.nav(action);
    expect(campaignEnemyIdentityInUse(f.db, key)).toBe(true);
    expect(() => s.assertUnused(f.db, key)).toThrow('IDEMPOTENCY_CONFLICT');
    f.nav('ENM-001::CTA::003');
    const request = f.request('SENTIENT_IDENTITY', identity),
      before = f.db.serialize();
    expect(() => f.app().command({ ...request, commandId: key })).toThrow('IDEMPOTENCY_CONFLICT');
    expect(f.db.serialize().equals(before)).toBe(true);
    expect(f.db.prepare('SELECT COUNT(*) n FROM campaign_enemy_template').get()).toEqual({ n: 0 });
  } finally {
    f.close();
  }
});
it.each(['SAVED', 'CANCELLED', 'COMPOSED_SAVED', 'COMPOSED_CANCELLED'] as const)(
  '%s enemy identities cannot be reused by actual local character/checkpoint/campaign, post-save, tab or device allocators',
  (mode) => {
    const f = fixture();
    try {
      if (mode.startsWith('COMPOSED_')) {
        compositionBuild(f, 'UNITED');
        const preview = f.request('SENTIENT_SYMBIONTS', {
          operation: 'PREVIEW',
          advisorRemovalConfirmed: false,
          selection: {
            symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
            ordinarySymbiontInstances: [sourceCompositionChoice('ADVISER')],
            symbioticMonsterProfileIdOrNull: null,
            monsterOrNull: null,
          },
        });
        f.app().command(preview);
        f.patch('SENTIENT_SYMBIONTS', {
          operation: 'CONFIRM',
          previewCommandId: preview.commandId,
          interactionsConfirmed: true,
          manualFacesOrNull: [12, 12],
        });
        f.patch('SENTIENT_SYMBIONTS', {
          operation: 'FINISH',
          previewCommandId: preview.commandId,
          skills: {
            advisorSkills: [
              { skillKey: 'UNARMED', targetBonus: 7 },
              { skillKey: 'ACROBATICS', targetBonus: 1 },
            ],
            dolphinSkills: [],
          },
        });
        f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
      } else f.complete();
      f.nav('ENM-010::CTA::005');
      f.patch('SENTIENT_INVENTORY', {
        inventoryItems: [
          {
            itemTypeId: 'RES-CUR-003',
            quantity: 1,
            profile: { kind: 'CATALOG' },
            equipped: false,
            equippedSlots: [],
            bodyZone: null,
            gripMode: null,
            currentAmmo: null,
            shieldCurrentHP: null,
            broken: false,
            sealed: null,
            linkedSetInstanceId: null,
            componentRole: null,
            qualityRoll: null,
            coatingInstanceIds: [],
            issueReason: 'Монеты',
          },
        ],
        armorCompatibilityReasonOrNull: null,
      });
      const ids = [
        enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
          .attemptOrNull!.itemTemplateKeys[0]!,
      ];
      if (mode.startsWith('COMPOSED_')) {
        const composition = projectedComposition(f);
        ids.push(...composition.instanceIds, composition.advisorCardIdOrNull!);
      }
      const patch = f.db
        .prepare(
          "SELECT record_json FROM gm_request_queue_event WHERE kind='ENEMY_AUTHORING' ORDER BY event_index DESC LIMIT 1",
        )
        .get() as { record_json: string };
      const cause = ((JSON.parse(patch.record_json) as JsonObject)['mutation'] as JsonObject)[
        'cause'
      ] as JsonObject;
      ids.push(cause['receiptId'] as string);
      if (mode.endsWith('SAVED')) {
        f.app().command(f.commitRequest());
        const saved = f.db.prepare('SELECT record_json FROM campaign_enemy_version').get() as {
          record_json: string;
        };
        const version = JSON.parse(saved.record_json) as JsonObject,
          identity = version['identity'] as JsonObject;
        ids.push(
          identity['templateId'] as string,
          identity['versionId'] as string,
          version['historyId'] as string,
        );
      } else
        for (const action of [
          'ENM-010::CTA::005',
          'ENM-009::CTA::001',
          'ENM-007::CTA::005',
          'ENM-006::CTA::001',
          'ENM-005::CTA::004',
        ] as const)
          f.nav(action);
      const characterId = randomUUID(),
        checkpointId = randomUUID(),
        created = commitNewLocalCharacterCheckpoint(
          f.db,
          characterId,
          checkpointId,
          (create) => create('FINAL', '{"source":"immutable-final"}'),
          { bindOwnerToDeviceId: f.scope.ownerDeviceId },
        );
      const scope: PostSaveScope = {
        scopeId: randomUUID(),
        entityKind: 'LOCAL_FINAL',
        entityId: characterId,
        ownerContext: 'PLAYER_LOCAL',
        ownerDeviceId: f.scope.ownerDeviceId,
        baseSnapshotSha256: created.checkpoint.snapshotSha256,
        baseRevisions: { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 },
        sourceBinding: {
          kind: 'FINAL',
          checkpointId,
          checkpointRevision: created.checkpoint.checkpointRevision,
        },
      };
      const validate = () => {
        expect(
          f.db
            .prepare('SELECT payload_json FROM local_character WHERE local_character_id=?')
            .get(characterId),
        ).toEqual({ payload_json: '{"source":"immutable-final"}' });
      };
      createPostSaveHead(f.db, scope, { formId: 'CHR-040' }, validate);
      let applied = 0;
      const exportCommand = (commandId: string, receiptId: string) =>
        commitPostSaveCommand(
          f.db,
          {
            scope,
            commandId,
            receiptId,
            commandKind: 'UI-CMD-CHAR-EXPORT',
            expectedRevisions: scope.baseRevisions,
            request: {},
            impact: {
              stateChanged: false,
              projectionChanged: false,
              actorVisibilityChanged: false,
            },
          },
          validate,
          () => {
            applied++;
            return { commandId, receiptId, revisions: { ...scope.baseRevisions } };
          },
        );
      const tabEntry = (entryCommandId: string, entryReceiptId: string) =>
        commitLocalNetworkTabEntry(
          f.db,
          {
            ownerDeviceId: f.scope.ownerDeviceId,
            entryCommandId,
            entryReceiptId,
            sourceContextId: randomUUID(),
            sourceRevisions: scope.baseRevisions,
            tabId: randomUUID(),
            networkScopeId: randomUUID(),
          },
          () => undefined,
        );
      for (const id of ids) {
        const before = f.db.serialize();
        const attempts = [
          () => createLocalCharacter(f.db, id, 'DRAFT', '{}'),
          () =>
            commitNewLocalCharacterCheckpoint(f.db, randomUUID(), id, (create) =>
              create('DRAFT', '{}'),
            ),
          () => commitNewCampaignCheckpoint(f.db, id, (create) => create('PAUSED', '{}')),
          () =>
            createPostSaveHead(f.db, { ...scope, scopeId: id }, { formId: 'CHR-040' }, validate),
          () => exportCommand(id, randomUUID()),
          () => exportCommand(randomUUID(), id),
        ];
        for (const allocate of attempts) {
          expect(allocate).toThrow('enemy template/version');
          expect(f.db.serialize().equals(before)).toBe(true);
          expect(applied).toBe(0);
        }
        for (const allocate of [
          () => tabEntry(id, randomUUID()),
          () => tabEntry(randomUUID(), id),
        ]) {
          expect(allocate).toThrow('IDEMPOTENCY_CONFLICT');
          expect(f.db.serialize().equals(before)).toBe(true);
        }
      }
      const fresh = randomUUID();
      expect(createLocalCharacter(f.db, fresh, 'DRAFT', '{}').localCharacterId).toBe(fresh);
      expect(exportCommand(randomUUID(), randomUUID()).replayed).toBe(false);
      expect(applied).toBe(1);
      expect(tabEntry(randomUUID(), randomUUID()).currentTab).not.toBeNull();
      resetDeviceIdentity(f.db, () => undefined);
      const before = f.db.serialize();
      for (const id of ids) {
        vi.mocked(randomUUID).mockReturnValueOnce(id as ReturnType<typeof randomUUID>);
        expect(() => bootstrapDeviceIdentity(f.db)).toThrow('enemy template/version');
        expect(f.db.serialize().equals(before)).toBe(true);
      }
      expect(ids).not.toContain(bootstrapDeviceIdentity(f.db));
    } finally {
      vi.mocked(randomUUID).mockReset();
      f.close();
    }
  },
);
it.each(['ENM-005', 'ENM-010', 'ENM-020'] as const)(
  'owning creation.project delegates restored %s to the real enemy projector without rewriting immutable campaign bytes',
  async (form) => {
    const f = fixture(),
      bind = createCampaignBindManager({ readShellListener: () => null });
    try {
      if (form !== 'ENM-005') f.complete();
      if (form === 'ENM-020') f.app().command(f.commitRequest());
      f.restart();
      const expected = f.app().project(),
        before = f.db.serialize();
      expect(expected.base.formId).toBe(form);
      const runtime = createCampaignCreationRuntime({
        database: f.db,
        projectRoot: process.cwd(),
        baseline,
        bind,
        requestReview: {
          project: () => Promise.resolve(f.app().project()),
          withLifecycle: (_connection, view) => view,
          receipt: () => null,
          refreshConnectionPresentation: () => undefined,
        },
      });
      await expect(
        runtime.project({
          gmLocalContextId: f.scope.gmLocalContextId,
          executableCreate: false,
          trusted: () => true,
        }),
      ).resolves.toEqual(expected);
      expect(f.db.serialize().equals(before)).toBe(true);
    } finally {
      await bind.close();
      f.close();
    }
  },
);
it('rejects a known-but-wrong saved baseline rehashed with matching audit provenance while the immutable COMMIT cause stays exact', () => {
  const f = fixture();
  try {
    f.complete();
    const request = f.commitRequest();
    f.app().command(request);
    f.nav('ENM-020::CTA::002');
    f.nav('ENM-001::CTA::013');
    const wrong = BASELINE_LINEAGE_SEALS.initialPoisonBaselineVersion;
    expect(wrong).not.toBe(baseline.baselineVersion);
    expect(() => resolveStoredLocalCharacterExportBaseline(baseline, wrong)).not.toThrow();
    for (const table of ['campaign_enemy_version', 'campaign_enemy_history']) {
      const row = f.db.prepare(`SELECT rowid,record_json FROM ${table}`).get() as {
        rowid: number;
        record_json: string;
      };
      const value = JSON.parse(row.record_json) as JsonObject;
      if (table === 'campaign_enemy_version') Reflect.set(value, 'sourceBaselineVersion', wrong);
      else Reflect.set(value['provenance'] as JsonObject, 'sourceBaselineVersion', wrong);
      const record = s.canonical(value);
      f.db
        .prepare(`UPDATE ${table} SET record_json=?,record_sha256=? WHERE rowid=?`)
        .run(record, s.sha(record), row.rowid);
    }
    f.restart();
    expect(f.readCurrent().viewOrNull?.formId).toBe('GM-001');
    expect(
      f.db
        .transaction(() =>
          readEnemyVersions(
            f.db,
            f.scope,
            readGmRequestReviewViewStateInTransaction(f.db, f.scope).events,
          ),
        )
        .deferred(),
    ).toHaveLength(1);
    const damaged = f.db.serialize();
    expect(() => f.checkedRead()).toThrow();
    expect(() => f.app().project()).toThrow();
    expect(() => f.app().command(request)).toThrow();
    expect(() => f.nav('GM-001::CTA::005')).toThrow();
    expect(f.db.serialize().equals(damaged)).toBe(true);
  } finally {
    f.close();
  }
});
it('project refuses a foreign owning scope, and published catalog/art records cannot mutate the issued source catalog', () => {
  const f = fixture();
  try {
    const before = f.db.serialize();
    const foreign = createEnemyAuthoringApplication({
      database: f.db,
      scope: { ...f.scope, campaignId: randomUUID() },
      catalog,
      baseline,
      validateOwner: () => undefined,
      readCurrent: f.readCurrent,
    });
    expect(() => foreign.project()).toThrow();
    expect(f.db.serialize().equals(before)).toBe(true);
    const first = f.app().project(),
      raw = first.base.roleFilteredPayload;
    expect(raw['catalog']).not.toBe(catalog.choices);
    expect(raw['art']).not.toBe(catalog.art);
    expect(Object.isFrozen(catalog.choices)).toBe(true);
    expect(Object.isFrozen(catalog.art)).toBe(true);
    Reflect.set(raw['art'] as JsonObject, 'sha256', 'foreign-art');
    Reflect.set(
      ((raw['catalog'] as JsonObject)['races'] as JsonObject[])[0]!,
      'name',
      'foreign-race',
    );
    const next = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload);
    expect(next.art.sha256).toBe(catalog.art.sha256);
    expect(JSON.stringify(next.catalog)).not.toContain('foreign-race');
  } finally {
    f.close();
  }
});
for (const fault of ['stale', 'foreignCampaign', 'foreignAttempt', 'kind', 'sex'] as const)
  it(`ENM-005 ${fault} refuses before any partial write`, () => {
    const f = fixture();
    try {
      const request = f.request('SENTIENT_IDENTITY', identity);
      let bad: unknown = request;
      if (fault === 'stale')
        bad = {
          ...request,
          expectedRevisions: {
            ...request.expectedRevisions,
            projectionRevision: request.expectedRevisions.projectionRevision - 1,
          },
        };
      if (fault === 'foreignCampaign')
        bad = { ...request, payload: { ...request.payload, campaignId: randomUUID() } };
      if (fault === 'foreignAttempt')
        bad = { ...request, payload: { ...request.payload, creationAttemptId: randomUUID() } };
      if (fault === 'kind' || fault === 'sex')
        bad = {
          ...request,
          payload: {
            ...request.payload,
            data: { ...identity, [fault]: fault === 'kind' ? 'CUSTOM_MONSTER' : 'MALE' },
          },
        };
      const before = f.db.serialize();
      expect(() => f.app().command(bad)).toThrow();
      expect(f.db.serialize().equals(before)).toBe(true);
    } finally {
      f.close();
    }
  });
it('validates actual historical prepared payments against their own input after full reseal, later valid state and physical exit/reopen', () => {
  const f = fixture();
  try {
    f.complete();
    for (const key of [
      'ENM-010::CTA::005',
      'ENM-009::CTA::001',
      'ENM-007::CTA::005',
      'ENM-006::CTA::001',
      'ENM-005::CTA::004',
      'ENM-001::CTA::013',
    ] as const)
      f.nav(key);
    const rows = f.db
      .prepare('SELECT event_id,record_json FROM gm_request_queue_event ORDER BY event_index')
      .all() as { event_id: string; record_json: string }[];
    let predecessor: string | null = null,
      changed = false;
    let original: EnemyWorkflowRequest | undefined;
    for (const row of rows) {
      const event = JSON.parse(row.record_json) as JsonObject,
        mutation = event['mutation'] as JsonObject,
        view = event['view'] as JsonObject;
      if (!changed && mutation['kind'] === 'ENEMY_AUTHORING') {
        const cause = mutation['cause'] as JsonObject,
          request = cause['request'] as unknown as EnemyWorkflowRequest;
        if (request.payload.stage === 'SENTIENT_BUILD') {
          original = structuredClone(request);
          const state = cause['preparedSkillState'] as JsonObject,
            plan = state['planOrNull'] as JsonObject;
          const payments = plan['initialSkills'] as JsonObject[];
          const selected = payments.find((skill) => skill['source'] === 'SELECTED')!,
            mandatory = payments.find((skill) => skill['source'] === 'CLASS_MANDATORY')!;
          expect(selected['startSlots']).toBe(9);
          expect(mandatory['startSlots']).toBe(1);
          Reflect.set(selected, 'startSlots', 8);
          Reflect.set(mandatory, 'startSlots', 2); // Same known skills/bonuses/capacity: source cost, not shape, is wrong.
          Reflect.set(
            ((view['enemyAuthoring'] as JsonObject)['attemptOrNull'] as JsonObject)[
              'skillPlanState'
            ] as JsonObject,
            'planOrNull',
            structuredClone(plan),
          );
          changed = true;
        }
      }
      const { snapshotSha256: _ignored, ...body } = view;
      Reflect.set(view, 'snapshotSha256', campaignCreationHash(body));
      Reflect.set(event, 'previousEventSha256OrNull', predecessor);
      predecessor = campaignCreationHash(event);
      f.db
        .prepare('UPDATE gm_request_queue_event SET record_json=?,record_sha256=? WHERE event_id=?')
        .run(s.canonical(event), predecessor, row.event_id);
    }
    expect(changed).toBe(true);
    expect(original).toBeDefined();
    f.restartFromDisk();
    expect(f.db.memory).toBe(false);
    const structural = f.db
      .transaction(() => readGmRequestReviewViewStateInTransaction(f.db, f.scope))
      .deferred();
    expect(structural.viewOrNull?.formId).toBe('GM-001');
    const lastAttempt = structural.events.findLast(
      (event) => event.view.enemyAuthoring?.attemptOrNull != null,
    )?.view.enemyAuthoring?.attemptOrNull;
    if (lastAttempt?.kind !== 'SENTIENT') throw Error('Expected historical SENTIENT attempt');
    expect(
      lastAttempt?.skillPlanState?.planOrNull?.initialSkills.find(
        (skill) => skill.source === 'SELECTED',
      )?.startSlots,
    ).toBe(9);
    const bytes = f.db.serialize();
    expect(() => f.checkedRead()).toThrow('network application storage: SOURCE_CHANGED');
    expect(() => f.app().project()).toThrow('network application storage: SOURCE_CHANGED');
    expect(() => f.app().command(original)).toThrow('network application storage: INVALID_INPUT');
    expect(() => f.nav('GM-001::CTA::005')).toThrow('network application storage: INVALID_INPUT');
    expect(f.db.serialize().equals(bytes)).toBe(true);
  } finally {
    f.close();
  }
});
it('validates every historical build and prepared plan after a foreign skill is fully rehashed and hidden by a later valid rebuild/COMMIT/exit/restart', () => {
  const f = fixture();
  try {
    f.complete();
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::001');
    const input = {
      baseStats: stats,
      build: {
        raceCode: 'PURE',
        pureClassOrNull: 'SEEKER',
        skillSelections: [{ skillKey: 'UNARMED', targetBonus: 7 }],
      },
    };
    f.patch('SENTIENT_BUILD', {
      operation: 'PREVIEW_REBUILD',
      expectedPlanRevision: 1,
      initialInput: input,
    });
    const preview = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!;
    f.patch('SENTIENT_BUILD', {
      operation: 'CONFIRM_REBUILD',
      expectedPlanRevision: 1,
      previewCommandId: preview.previewCommandId,
      initialInput: input,
      displayedConsequences: preview.consequences as unknown as JsonObject,
    });
    confirmComposition(f, {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
      monsterOrNull: null,
    });
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const commit = f.commitRequest();
    f.app().command(commit);
    f.nav('ENM-020::CTA::002');
    f.nav('ENM-001::CTA::013');
    const rows = f.db
      .prepare('SELECT event_id,record_json FROM gm_request_queue_event ORDER BY event_index')
      .all() as { event_id: string; record_json: string }[];
    let changed = false,
      predecessor: string | null = null;
    const badBuild = {
      raceCode: 'PURE',
      pureClassOrNull: 'SOLDIER',
      skillSelections: [{ skillKey: 'FOREIGN_SKILL', targetBonus: 7 }],
    };
    expect(() =>
      validateSkillSelection(catalog.skills, {
        raceCode: 'PURE',
        classCode: 'SOLDIER',
        skillStageStats: calculateSkillStageStats(catalog.skills, {
          baseStats: stats,
          raceCode: 'PURE',
          classCode: 'SOLDIER',
          creationMode: 'MANUAL',
        }).skillStageStats,
        selectedSkills: badBuild.skillSelections,
      }),
    ).toThrow(/unknown SkillKey/);
    const paid = (value: unknown) => {
      if (!Array.isArray(value)) throw Error('Expected an actual prepared payment list');
      for (const candidate of value) {
        const raw: unknown = candidate;
        if (
          raw !== null &&
          typeof raw === 'object' &&
          !Array.isArray(raw) &&
          Reflect.get(raw, 'skillKey') === 'UNARMED'
        )
          Reflect.set(raw, 'skillKey', 'FOREIGN_SKILL');
      }
    };
    const corruptPlan = (value: JsonObject | undefined) => {
      const plan = value?.['planOrNull'] as JsonObject | null | undefined;
      if (plan?.['revision'] !== 1) return false;
      Reflect.set(plan['initialInput'] as JsonObject, 'build', badBuild);
      paid(plan['initialSkills']);
      const accounting = plan['accountingOrNull'] as JsonObject | null;
      if (accounting !== null) {
        paid(accounting['knownSkills']);
        paid(accounting['permanentLosses']);
      }
      const pending = value?.['rebuildPreviewOrNull'] as JsonObject | null;
      if (pending !== null) paid((pending['consequences'] as JsonObject)['abandonedSkills']);
      return true;
    };
    for (const row of rows) {
      const event = JSON.parse(row.record_json) as JsonObject,
        mutation = event['mutation'] as JsonObject,
        view = event['view'] as JsonObject;
      if (mutation['kind'] === 'ENEMY_AUTHORING') {
        const cause = mutation['cause'] as JsonObject,
          request = cause['request'] as JsonObject,
          payload = request['payload'] as JsonObject;
        if (payload['stage'] === 'SENTIENT_BUILD') {
          if (!changed) {
            Reflect.set(payload, 'data', badBuild);
            changed = true;
          } else if ((payload['data'] as JsonObject)['operation'] === 'CONFIRM_REBUILD')
            paid(
              ((payload['data'] as JsonObject)['displayedConsequences'] as JsonObject)[
                'abandonedSkills'
              ],
            );
        }
        corruptPlan(cause['preparedSkillState'] as JsonObject | undefined);
      }
      const context = view['enemyAuthoring'] as JsonObject | undefined;
      const attempt = context?.['attemptOrNull'] as JsonObject | null | undefined;
      if (attempt != null && corruptPlan(attempt['skillPlanState'] as JsonObject | undefined))
        Reflect.set(attempt, 'buildOrNull', badBuild);
      const { snapshotSha256: _ignored, ...document } = view;
      Reflect.set(view, 'snapshotSha256', campaignCreationHash(document));
      Reflect.set(event, 'previousEventSha256OrNull', predecessor);
      predecessor = campaignCreationHash(event);
      f.db
        .prepare('UPDATE gm_request_queue_event SET record_json=?,record_sha256=? WHERE event_id=?')
        .run(s.canonical(event), predecessor, row.event_id);
    }
    expect(changed).toBe(true);
    f.restart();
    expect(f.readCurrent().viewOrNull?.formId).toBe('GM-001');
    const damaged = f.db.serialize();
    expect(() => f.checkedRead()).toThrow('CORRUPT_STORAGE');
    expect(() => f.app().project()).toThrow();
    expect(() => f.app().command(commit)).toThrow();
    expect(() => f.nav('GM-001::CTA::005')).toThrow();
    expect(f.db.serialize().equals(damaged)).toBe(true);
  } finally {
    f.close();
  }
});
it('ENM-006 Back changes W, invalidates dependent confirmation and rebuilds a different exact skill budget before V1', () => {
  const f = fixture();
  try {
    f.complete();
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::001');
    f.nav('ENM-007::CTA::005');
    f.patch('SENTIENT_STATS', { ...stats, W: 10 });
    expect(f.app().project().base.roleFilteredPayload['context']).toMatchObject({
      attemptOrNull: {
        buildOrNull: null,
        compositionOrNull: null,
        inventoryOrNull: null,
        itemTemplateKeys: [],
      },
    });
    const input = {
      baseStats: { ...stats, W: 10 },
      build: {
        raceCode: 'PURE',
        pureClassOrNull: 'SOLDIER',
        skillSelections: [{ skillKey: 'UNARMED', targetBonus: 4 }],
      },
    };
    f.patch('SENTIENT_BUILD', {
      operation: 'PREVIEW_REBUILD',
      expectedPlanRevision: 1,
      initialInput: input,
    });
    const preview = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!;
    f.patch('SENTIENT_BUILD', {
      operation: 'CONFIRM_REBUILD',
      expectedPlanRevision: 1,
      previewCommandId: preview.previewCommandId,
      initialInput: input,
      displayedConsequences: preview.consequences as unknown as JsonObject,
    });
    confirmComposition(f, {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
      monsterOrNull: null,
    });
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    expect(f.app().project().base.roleFilteredPayload['sheetOrNull']).toMatchObject({
      baseStats: { W: 10 },
      skillSlots: { capacity: 5, used: 5, remaining: 0 },
    });
    f.app().command(f.commitRequest());
    expect(f.app().project().base.formId).toBe('ENM-020');
  } finally {
    f.close();
  }
});
for (const table of [
  'campaign_enemy_template',
  'campaign_enemy_version',
  'campaign_enemy_history',
  'campaign_enemy_current_version',
])
  it(`CORE-194 fault at ${table} leaves zero partial template/version/history/pointer rows`, () => {
    const f = fixture();
    try {
      f.complete();
      f.db.exec(
        `CREATE TRIGGER fail_enemy BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected storage fault'); END;`,
      );
      if (table === 'campaign_enemy_history' || table === 'campaign_enemy_current_version') {
        // SQLite does not journal unused freelist leaves (atomiccommit.html §7.3).
        // Compact this affected fault fixture before preserving every byte assertion.
        f.db.exec('VACUUM');
        expect(f.db.pragma('freelist_count', { simple: true })).toBe(0);
      }
      const before = f.db.serialize();
      expect(() => f.app().command(f.commitRequest())).toThrow();
      expect(f.db.serialize().equals(before)).toBe(true);
      for (const table of [
        'campaign_enemy_template',
        'campaign_enemy_version',
        'campaign_enemy_history',
        'campaign_enemy_current_version',
      ])
        expect(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({ n: 0 });
    } finally {
      f.close();
    }
  });
it('CORE-193 duplicate names create two distinct immutable template/version identities', () => {
  const f = fixture();
  try {
    f.complete();
    f.app().command(f.commitRequest());
    f.nav('ENM-020::CTA::002');
    f.nav('ENM-001::CTA::003');
    f.complete();
    f.app().command(f.commitRequest());
    const rows = f.db.prepare('SELECT record_json FROM campaign_enemy_version').all() as {
      record_json: string;
    }[];
    expect(rows).toHaveLength(2);
    const versions = rows.map(
      (row) =>
        JSON.parse(row.record_json) as {
          identity: { templateId: string; versionId: string };
          sheet: { identity: { name: string } };
        },
    );
    expect(new Set(versions.map((v) => v.identity.templateId)).size).toBe(2);
    expect(new Set(versions.map((v) => v.identity.versionId)).size).toBe(2);
    expect(versions.map((v) => v.sheet.identity.name)).toEqual(['Страж', 'Страж']);
  } finally {
    f.close();
  }
});
it('CORE194 readonly preparation positive control commits a valid modern identity exactly once', () => {
  const f = fixture();
  try {
    const request = f.request('SENTIENT_IDENTITY', identity);
    const mutation: EnemyAuthoringMutation = {
      authorMasterProfileId: f.readCurrent().context.masterProfileId,
      request,
      itemTemplateKeys: [],
      committedVersionOrNull: null,
      receiptId: randomUUID(),
      timestamp: '2026-11-10T00:00:00.000Z',
      sourceBaselineVersion: baseline.baselineVersion,
      preparedSkillState: emptyEnemySkillPlanState(),
    };
    let calls = 0;
    const result = commitEnemyAuthoring(f.db, f.scope, request, () => undefined, {
      observe: () => {
        f.checkedRead();
      },
      prepare: () => {
        calls++;
        return { mutation, versionOrNull: null };
      },
    });
    expect(calls).toBe(1);
    expect(result.replayed).toBe(false);
    expect(f.app().project().base.formId).toBe('ENM-006');
    expect(
      enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload).context
        .attemptOrNull?.identityOrNull,
    ).toEqual(identity);
    expect(
      f.db
        .prepare('SELECT COUNT(*) n FROM gm_request_queue_event WHERE event_id=?')
        .get(request.commandId),
    ).toEqual({ n: 1 });
    expect(f.db.prepare('SELECT COUNT(*) n FROM campaign_enemy_version').get()).toEqual({ n: 0 });
  } finally {
    f.close();
  }
});
for (const mode of [
  'SQL',
  'SCHEMA',
  'USER_VERSION',
  'SOURCE',
  'GETTER',
  'PROMISE',
  'ASYNC',
] as const)
  it(`CORE-194 prepare callback is read-only, synchronous and fenced through detachment: ${mode}`, () => {
    const f = fixture();
    try {
      f.db.exec('CREATE TABLE preparation_probe (value INTEGER) STRICT');
      if (mode === 'SCHEMA') {
        // SQLite does not journal unused freelist leaves (atomiccommit.html §7.3).
        f.db.exec('VACUUM');
        expect(f.db.pragma('freelist_count', { simple: true })).toBe(0);
      }
      const request = f.request('SENTIENT_IDENTITY', identity),
        before = f.db.serialize();
      let calls = 0;
      const mutation: EnemyAuthoringMutation = {
        authorMasterProfileId: f.readCurrent().context.masterProfileId,
        request,
        itemTemplateKeys: [],
        committedVersionOrNull: null,
        receiptId: randomUUID(),
        timestamp: '2026-11-10T00:00:00.000Z',
        sourceBaselineVersion: baseline.baselineVersion,
        preparedSkillState: emptyEnemySkillPlanState(),
      };
      const prepare = (source: ReturnType<typeof f.readCurrent>) => {
        calls++;
        if (mode === 'SQL') f.db.exec('INSERT INTO preparation_probe VALUES (1)');
        if (mode === 'SCHEMA') f.db.exec('CREATE TABLE forbidden_preparation(value INTEGER)');
        if (mode === 'USER_VERSION') f.db.pragma('user_version=123');
        if (mode === 'SOURCE') Reflect.set(source.scope, 'campaignId', randomUUID());
        if (mode === 'GETTER')
          return {
            get mutation() {
              f.db.exec('INSERT INTO preparation_probe VALUES (1)');
              return mutation;
            },
            versionOrNull: null,
          };
        return { mutation, versionOrNull: null };
      };
      const integration = {
        observe: () => undefined,
        prepare:
          mode === 'ASYNC'
            ? async () => {
                calls++;
                await Promise.resolve();
                return { mutation, versionOrNull: null };
              }
            : mode === 'PROMISE'
              ? () => Promise.resolve({ mutation, versionOrNull: null })
              : prepare,
      };
      expect(() => {
        const result: unknown = Reflect.apply(commitEnemyAuthoring, undefined, [
          f.db,
          f.scope,
          request,
          () => undefined,
          integration,
        ]);
        return result;
      }).toThrow();
      expect(f.db.serialize().equals(before)).toBe(true);
      expect(f.db.prepare('SELECT COUNT(*) n FROM preparation_probe').get()).toEqual({ n: 0 });
      if (mode === 'ASYNC') expect(calls).toBe(0);
      else if (mode !== 'PROMISE') expect(calls).toBe(1);
    } finally {
      f.close();
    }
  });
