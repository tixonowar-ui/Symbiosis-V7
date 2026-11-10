import { randomUUID } from 'node:crypto';
import type * as NodeCrypto from 'node:crypto';
import { createCampaignCreationRuntime } from './campaign-creation.js';
import { createCampaignBindManager } from './campaign-bind.js';
import { campaignEnemyIdentityInUse } from '../persistence/npc-identities.js';
import { validateSkillSelection } from '../domain/rules/skill-stage/skills.js';
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
import type { JsonObject } from '@shared/wire-protocol.js';
import type {
  EnemyAttempt,
  EnemyWorkflowRequest,
  EnemyPatchStage,
  EnemyAuthoringMutation,
  EnemyUserEntry,
} from '@shared/enemy-authoring.js';
import { commitEnemyAuthoring, readEnemyVersions } from '../persistence/enemy-authoring-store.js';
import { enemyAuthoringProjectionValue } from '@shared/enemy-authoring.js';
import { enemyLibraryProjectionValue } from '@shared/enemy-library.js';
import { BASELINE_LINEAGE_SEALS } from './baseline-lineage-seals.js';
import { resolveStoredLocalCharacterExportBaseline } from './local-character-export.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  commitGmRequestReviewNavigation,
  readGmRequestReviewSource,
} from '../persistence/network-device-request.js';
import {
  campaignCreationHash,
  readGmRequestReviewViewStateInTransaction,
  createLocalGmContext,
  readActiveLocalGmContext,
  type CampaignPrivateOwnerValidator,
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

// Fault only technical UUID allocation; source, ownership, SQL and callbacks remain real.
vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof NodeCrypto>();
  return { ...original, randomUUID: vi.fn(original.randomUUID) };
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
function fixture(authoringCatalog = catalog, enter = true) {
  const f = createEnemyLibraryFixture(source, baseline);
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
    const p = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload),
      attempt = p.context.attemptOrNull!;
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
  try {
    f.complete();
    const attempt = enemyAuthoringProjectionValue(f.app().project().base.roleFilteredPayload)
      .context.attemptOrNull!;
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
    const key = randomUUID();
    const seeker = deriveSentientEnemySheet(catalog, {
      ...attempt,
      baseStatsOrNull: { ...stats, S: 7, M: 1 },
      buildOrNull: {
        raceCode: 'PURE',
        pureClassOrNull: 'SEEKER',
        skillSelections: [{ skillKey: 'UNARMED', targetBonus: 7 }],
      },
      inventoryOrNull: { inventoryItems: [armor], armorCompatibilityReasonOrNull: null },
      itemTemplateKeys: [key],
    });
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
    const soldier = deriveSentientEnemySheet(catalog, {
      ...attempt,
      inventoryOrNull: { inventoryItems: [armor], armorCompatibilityReasonOrNull: null },
      itemTemplateKeys: [key],
    });
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
    const armed = deriveSentientEnemySheet(catalog, {
      ...attempt,
      inventoryOrNull: { inventoryItems: [weapon], armorCompatibilityReasonOrNull: null },
      itemTemplateKeys: [key],
    });
    expect(armed.requirementPenalties['weapons']).toEqual([
      expect.objectContaining({ deficits: { S: 5, D: 3, I: 2 }, deficitTotal: 10, penalty: 20 }),
    ]);
  } finally {
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
    for (const path of Object.keys(ENEMY_AUTHORING_SOURCE_SEALS)) {
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
it.each(['SAVED', 'CANCELLED'] as const)(
  '%s enemy identities cannot be reused by actual local character/checkpoint/campaign, post-save, tab or device allocators',
  (mode) => {
    const f = fixture();
    try {
      f.complete();
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
      const patch = f.db
        .prepare(
          "SELECT record_json FROM gm_request_queue_event WHERE kind='ENEMY_AUTHORING' ORDER BY event_index DESC LIMIT 1",
        )
        .get() as { record_json: string };
      const cause = ((JSON.parse(patch.record_json) as JsonObject)['mutation'] as JsonObject)[
        'cause'
      ] as JsonObject;
      ids.push(cause['receiptId'] as string);
      if (mode === 'SAVED') {
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
it('validates every historical build after a foreign skill is fully rehashed and hidden by a later valid build/COMMIT/exit/restart', () => {
  const f = fixture();
  try {
    f.complete();
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::001');
    f.patch('SENTIENT_BUILD', {
      raceCode: 'PURE',
      pureClassOrNull: 'SEEKER',
      skillSelections: [{ skillKey: 'UNARMED', targetBonus: 7 }],
    });
    f.patch('SENTIENT_SYMBIONTS', {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
    });
    f.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const commit = f.commitRequest();
    f.app().command(commit);
    f.nav('ENM-020::CTA::002');
    f.nav('ENM-001::CTA::013');
    const rows = f.db
      .prepare('SELECT event_id,record_json FROM gm_request_queue_event ORDER BY event_index')
      .all() as { event_id: string; record_json: string }[];
    let badActive = false,
      changed = false,
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
            badActive = true;
          } else badActive = false;
        }
      }
      const context = view['enemyAuthoring'] as JsonObject | undefined;
      if (
        badActive &&
        context?.['attemptOrNull'] !== null &&
        context?.['attemptOrNull'] !== undefined
      )
        Reflect.set(context['attemptOrNull'] as JsonObject, 'buildOrNull', badBuild);
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
    f.patch('SENTIENT_BUILD', {
      raceCode: 'PURE',
      pureClassOrNull: 'SOLDIER',
      skillSelections: [{ skillKey: 'UNARMED', targetBonus: 4 }],
    });
    f.patch('SENTIENT_SYMBIONTS', {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
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
