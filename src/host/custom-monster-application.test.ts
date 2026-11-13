import { randomUUID, createHash, randomInt } from 'node:crypto';
import type * as NodeCrypto from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { beforeAll, expect, it, vi } from 'vitest';
import type { ActionKey } from '@generated/types/atlas.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { EnemyPatchStage, EnemyWorkflowRequest } from '@shared/enemy-authoring.js';
import { customMonsterProjectionValue } from '@shared/custom-monster-presentation.js';
import {
  enemyLibraryProjectionValue,
  enemyLibrarySelectionRequestValue,
} from '@shared/enemy-library.js';
import { createEnemyLibraryFixture } from '../../tests/fixtures/enemy-library.js';
import { loadNpcAuthoringSourceCatalog } from './npc-catalog.js';
import { loadEnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';
import { loadEnemySourceCatalog } from './enemy-catalog.js';
import { loadLocalCharacterExportBaseline } from './local-character-export.js';
import {
  createEnemyAuthoringApplication,
  validateEnemyAuthoringSource,
} from './enemy-authoring-application.js';
import {
  createEnemyLibraryApplication,
  validateEnemyLibrarySource,
} from './enemy-library-application.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import { openPersistenceDatabase } from '../persistence/database.js';
import { readGmRequestReviewSourceWith } from '../persistence/network-device-request.js';
import type { GmRequestReviewScope } from '../persistence/campaign-creation.js';
import type { CommandReceipt } from '@shared/wire-protocol.js';
import { migration0022 } from '../persistence/migrations/0022-custom-monster-v1.js';
import { migration0023 } from '../persistence/migrations/0023-enemy-template-versions.js';
import { sentientEnemyAuthoringProjectionValue } from '@shared/enemy-authoring.js';
import {
  createLocalGmContext,
  campaignCreationHash,
  readGmRequestReviewViewStateInTransaction,
  readActiveLocalGmContext,
  type CampaignPrivateOwnerValidator,
} from '../persistence/campaign-creation.js';
import { readGmRequestReviewSource } from '../persistence/network-device-request.js';
import { ENEMY_AUTHORING_SOURCE_SEALS } from './enemy-authoring-source-seals.js';

// Count actual sampler calls without changing the RNG implementation, source, ownership or SQL.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});

let baseline: Awaited<ReturnType<typeof loadLocalCharacterExportBaseline>>;
let librarySource: ReturnType<typeof loadEnemySourceCatalog>;
let catalog: ReturnType<typeof loadEnemyAuthoringSourceCatalog>;
let common: Awaited<ReturnType<typeof loadNpcAuthoringSourceCatalog>>;
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  librarySource = loadEnemySourceCatalog(process.cwd(), baseline);
  common = await loadNpcAuthoringSourceCatalog(process.cwd());
  catalog = loadEnemyAuthoringSourceCatalog(process.cwd(), common);
});
const identity = {
  name: '  Каменный зверь  ',
  description: 'Произвольный монстр',
  creatureType: 'CUSTOM_MONSTER',
};
const stats = {
  statMode: 'MANUAL',
  baseStats: { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 },
  massKg: 5.1,
  ageYears: 1,
  baseMaxHP: 7,
  rollReceiptOrNull: null,
};
const physics = {
  naturalArmorDefinition: { mode: 'PER_RESOLUTION_ROLL', dieSides: 20, multiplier: 2, bonus: 3 },
  anatomyMode: 'NONSTANDARD_TORSO_ONLY',
  normalizedHitRegion: 'TORSO',
  size: 'Небольшой',
  movement: 'Ходит',
  physicalTags: ['Каменная кожа'],
  metadataHasNoMechanicalEffect: true,
};
const attack = {
  category: 'MONSTER_ATTACK',
  distance: 'MELEE',
  actionCost: 1,
  additionalDamageDefinition: { mode: 'CONSTANT', value: 1.5 },
  penetrationDefinition: { mode: 'ZERO' },
};
function fixture(mode: 'AUTO' | 'MANUAL' = 'MANUAL', authoringCatalog = catalog) {
  const f = createEnemyLibraryFixture(librarySource, baseline, false, mode);
  const checked: typeof f.readCurrent = (observe) =>
    f.readCurrent((source, state) => {
      validateEnemyLibrarySource(source, state, librarySource, baseline);
      validateEnemyAuthoringSource(f.db, source, state, authoringCatalog, baseline);
      observe?.(source, state);
    });
  const app = () =>
    createEnemyAuthoringApplication({
      database: f.db,
      scope: f.scope,
      catalog: authoringCatalog,
      baseline,
      validateOwner: () => undefined,
      readCurrent: checked,
    });
  const library = () =>
    createEnemyLibraryApplication({
      database: f.db,
      scope: f.scope,
      catalog: librarySource,
      baseline,
      validateOwner: () => undefined,
      readCurrent: checked,
      readUsers: () => {
        let users: ReturnType<typeof validateEnemyAuthoringSource> = [];
        checked((source, state) => {
          users = validateEnemyAuthoringSource(f.db, source, state, authoringCatalog, baseline);
        });
        return users.map((row) => ({ ...row.identity, displayName: row.sheet.identity.name }));
      },
    });
  const nav = (actionKey: ActionKey) => {
    const cursor = f.readCurrent().cursor;
    return library().navigation({
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId: cursor.formId,
      expectedProjectionRevision: cursor.revisions.projectionRevision,
      actionKey,
    });
  };
  const selectTab = (activeTab: 'MONSTERS' | 'SENTIENT_ENEMIES') => {
    const view = f.readCurrent().viewOrNull ?? s.fail('UNAVAILABLE');
    return library().select({
      messageType: 'network.enemy-selection.replace',
      protocolVersion: 3,
      operationId: randomUUID(),
      contextId: f.scope.gmLocalContextId,
      campaignId: f.scope.campaignId,
      sourceFormId: 'ENM-001',
      activeTab,
      selectionOrNull: null,
      userSelectionOrNull: null,
      expectedRevisions: {
        stateRevision: view.stateRevision,
        projectionRevision: view.projectionRevision,
        actorVisibilityRevision: view.actorVisibilityRevision,
      },
    });
  };
  const request = (stage?: EnemyPatchStage, data?: JsonObject): EnemyWorkflowRequest => {
    const view = f.readCurrent().viewOrNull ?? s.fail('UNAVAILABLE'),
      attempt = view.enemyAuthoring?.attemptOrNull ?? s.fail('UNAVAILABLE');
    return {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      workflowCommandId:
        stage === undefined ? 'UI-CMD-ENEMY-COMMIT-V1' : 'UI-CMD-ENEMY-DRAFT-PATCH',
      expectedRevisions: {
        stateRevision: view.stateRevision,
        projectionRevision: view.projectionRevision,
        actorVisibilityRevision: view.actorVisibilityRevision,
      },
      payload: {
        campaignId: f.scope.campaignId,
        creationAttemptId: attempt.attemptId,
        expectedAttemptRevision: attempt.revision,
        ...(stage === undefined ? {} : { stage, data: data ?? {} }),
      },
    };
  };
  const patch = (stage: EnemyPatchStage, data: JsonObject) => {
    const req = request(stage, data);
    const result = app().command(req);
    return { request: req, result };
  };
  const projection = () => customMonsterProjectionValue(app().project().base.roleFilteredPayload);
  const begin = () => {
    selectTab('MONSTERS');
    nav('ENM-001::CTA::011');
    patch('MONSTER_IDENTITY', identity);
    patch('MONSTER_STATS', stats);
    patch('MONSTER_PHYSICS', physics);
    patch('MONSTER_ATTACK', attack);
  };
  const choice = (speciesKey: string, level: number): JsonObject => ({
    mode: 'ORDINARY',
    symbiont: {
      speciesKey,
      targetLevel: level,
      learnedNodeRefs: authoringCatalog.monster.development.nodes
        .filter((row) => row.speciesKey === speciesKey && row.level <= level)
        .map((row) => row.nodeRef),
      binding: { kind: 'NONE' },
    },
  });
  const preview = (selection: JsonObject) =>
    patch('MONSTER_SYMBIONT', { operation: 'PREVIEW', selection });
  const confirm = (previewCommandId: string, manualFacesOrNull: readonly number[] | null = null) =>
    patch('MONSTER_SYMBIONT', { operation: 'CONFIRM', previewCommandId, manualFacesOrNull });
  const finish = (previewCommandId: string, advisorSkills: JsonObject[] = []) =>
    patch('MONSTER_SYMBIONT', { operation: 'FINISH', previewCommandId, advisorSkills });
  const backStats = () => {
    if (f.readCurrent().cursor.formId === 'ENM-016') nav('ENM-016::CTA::003');
    nav('ENM-015::CTA::004');
    nav('ENM-014::CTA::003');
    nav('ENM-013::CTA::004');
  };
  return {
    ...f,
    get db() {
      return f.db;
    },
    app,
    library,
    nav,
    selectTab,
    request,
    patch,
    projection,
    begin,
    choice,
    preview,
    confirm,
    finish,
    backStats,
    checked,
  };
}

it('commits a closed manual NONE V1, retains literal definitions and full HP through physical reopen and exact replay', () => {
  const f = fixture('AUTO');
  try {
    const samples = vi.mocked(randomInt).mock.calls.length;
    f.begin();
    const preview = f.preview({ mode: 'NONE' });
    f.confirm(preview.request.commandId);
    f.finish(preview.request.commandId);
    const before = f.projection();
    expect(before.formId).toBe('ENM-016');
    expect(Object.hasOwn(before, 'versionConfigurationSummaryOrNull')).toBe(false);
    expect(before.sheetOrNull).toMatchObject({
      kind: 'CUSTOM_MONSTER',
      identity: { name: 'Каменный зверь' },
      stats,
      physics,
      attack,
      permanentStats: stats.baseStats,
      effectiveMaxHP: 7,
      currentHP: 7,
      symbiontOrNull: null,
      advisorOrNull: null,
      ruleFacts: [],
      artAssetKey: 'symbiosis_placeholder_monster',
    });
    expect(Object.keys(before.context.attemptOrNull!)).not.toContain('inventoryOrNull');
    const request = f.request(),
      saved = f.app().command(request);
    const original = f.projection();
    expect(original.formId).toBe('ENM-020');
    expect(original.versionConfigurationSummaryOrNull).toBeNull();
    expect(original.sheetOrNull).toEqual(before.sheetOrNull);
    expect(f.db.prepare('SELECT kind FROM campaign_enemy_template').all()).toEqual([
      { kind: 'CUSTOM_MONSTER' },
    ]);
    f.restartFromDisk();
    expect(f.db.memory).toBe(false);
    const bytes = f.db.serialize();
    expect(f.projection()).toEqual(original);
    expect(f.app().command(request)).toEqual({ replayed: true, receipt: saved.receipt });
    expect(f.db.serialize().equals(bytes)).toBe(true);
    f.nav('ENM-020::CTA::002');
    const library = enemyLibraryProjectionValue(f.library().project().base.roleFilteredPayload);
    expect(library.activeTab).toBe('MONSTERS');
    expect(library.currentUserTemplates).toHaveLength(1);
    expect(library.currentUserTemplates[0]?.kind).toBe('CUSTOM_MONSTER');
    const entry = library.currentUserTemplates[0];
    if (entry === undefined) throw Error('Actual saved monster row absent');
    const { displayName: _display, ...identity } = entry;
    f.selectTab('SENTIENT_ENEMIES');
    expect(
      enemyLibraryProjectionValue(f.library().project().base.roleFilteredPayload)
        .currentUserTemplates,
    ).toEqual([]);
    f.selectTab('MONSTERS');
    const current = enemyLibraryProjectionValue(f.library().project().base.roleFilteredPayload);
    const select = {
      messageType: 'network.enemy-selection.replace',
      protocolVersion: 3,
      operationId: randomUUID(),
      contextId: f.scope.gmLocalContextId,
      campaignId: f.scope.campaignId,
      sourceFormId: 'ENM-001',
      activeTab: 'MONSTERS',
      selectionOrNull: null,
      userSelectionOrNull: identity,
      expectedRevisions: {
        stateRevision: current.stateRevision,
        projectionRevision: current.projectionRevision,
        actorVisibilityRevision: current.actorVisibilityRevision,
      },
    };
    const beforeSelection = f.db.serialize();
    for (const wrong of [
      { ...select, activeTab: 'SENTIENT_ENEMIES' },
      { ...select, userSelectionOrNull: { ...identity, campaignId: randomUUID() } },
    ]) {
      expect(() => enemyLibrarySelectionRequestValue(wrong)).toThrow('INVALID_SHAPE');
      expect(f.db.serialize().equals(beforeSelection)).toBe(true);
    }
    f.library().select(enemyLibrarySelectionRequestValue(select));
    expect(
      enemyLibraryProjectionValue(f.library().project().base.roleFilteredPayload)
        .userSelectionOrNull,
    ).toEqual(identity);
    f.nav('ENM-001::CTA::007');
    expect(f.projection().sheetOrNull).toEqual(original.sheetOrNull);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM campaign_enemy_version').get()).toEqual({
      n: 1,
    });
    expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(samples);
  } finally {
    f.close();
  }
});

it('refuses a corrupted schema23 prefix missing mandatory22 after an unpatched monster NAV and cancelled attempt', () => {
  const f = fixture();
  try {
    f.selectTab('MONSTERS');
    f.nav('ENM-001::CTA::011');
    f.nav('ENM-011::CTA::003');
    f.nav('ENM-001::CTA::013');
    expect(f.checked().cursor.formId).toBe('GM-001');
    expect(
      f.db
        .prepare("SELECT COUNT(*) n FROM gm_request_queue_event WHERE kind='ENEMY_AUTHORING'")
        .get(),
    ).toEqual({ n: 0 });
    // With23 still present, deleting22 corrupts the contiguous prefix before the ENM-specific source guard.
    f.db.prepare('DELETE FROM schema_migration WHERE version=22').run();
    const bytes = f.db.serialize();
    expect(() => f.checked()).toThrow('network application storage: CORRUPT_STORAGE');
    expect(() => f.app().project()).toThrow('network application storage: CORRUPT_STORAGE');
    expect(f.db.serialize().equals(bytes)).toBe(true);
  } finally {
    f.close();
  }
});

it.each(['PATCH', 'CONFIRM', 'COMMIT', 'EXACT_CONFIRM_REPLAY', 'EXACT_COMMIT_REPLAY'] as const)(
  'refuses prebuilt monster %s after actual persisted current-GM loss without sampling, receipt disclosure or writes',
  (mode) => {
    const f = fixture('AUTO');
    try {
      let request: EnemyWorkflowRequest;
      if (mode === 'PATCH') {
        f.selectTab('MONSTERS');
        f.nav('ENM-001::CTA::011');
        request = f.request('MONSTER_IDENTITY', identity);
      } else {
        f.begin();
        const preview = f.preview(
          mode === 'CONFIRM' || mode === 'EXACT_CONFIRM_REPLAY'
            ? f.choice('ADVISER', 1)
            : { mode: 'NONE' },
        );
        if (mode === 'CONFIRM' || mode === 'EXACT_CONFIRM_REPLAY') {
          request = f.request('MONSTER_SYMBIONT', {
            operation: 'CONFIRM',
            previewCommandId: preview.request.commandId,
            manualFacesOrNull: null,
          });
          if (mode === 'EXACT_CONFIRM_REPLAY') {
            const beforeSampling = vi.mocked(randomInt).mock.calls.length;
            f.app().command(request);
            expect(vi.mocked(randomInt).mock.calls.length).toBe(beforeSampling + 2);
            for (const action of [
              'ENM-015::CTA::004',
              'ENM-014::CTA::003',
              'ENM-013::CTA::004',
              'ENM-012::CTA::006',
              'ENM-011::CTA::003',
              'ENM-001::CTA::013',
            ] as const)
              f.nav(action);
            f.restartFromDisk();
          }
        } else {
          f.confirm(preview.request.commandId);
          f.finish(preview.request.commandId);
          request = f.request();
          if (mode === 'EXACT_COMMIT_REPLAY') {
            f.app().command(request);
            f.nav('ENM-020::CTA::002');
            f.nav('ENM-001::CTA::013');
            f.restartFromDisk();
          }
        }
      }
      const masterProfileId = f.readCurrent().context.masterProfileId;
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
        readCurrent: f.checked,
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
      const before = f.db.serialize(),
        samples = vi.mocked(randomInt).mock.calls.length;
      expect(() => app.command(request)).toThrow('CORRUPT_STORAGE');
      expect(validated).toBeGreaterThan(0);
      expect(denied).toBe(1);
      expect(vi.mocked(randomInt).mock.calls.length).toBe(samples);
      expect(f.db.serialize().equals(before)).toBe(true);
    } finally {
      f.close();
    }
  },
);

it('rolls back all four V1 tables and the QUEUE when history insertion fails, and only then permits the original command once', () => {
  const f = fixture('AUTO');
  try {
    f.begin();
    const preview = f.preview({ mode: 'NONE' });
    f.confirm(preview.request.commandId);
    f.finish(preview.request.commandId);
    const request = f.request();
    expect(f.projection().validationErrors).toEqual([]);
    f.db.exec(
      "CREATE TRIGGER reject_monster_history BEFORE INSERT ON campaign_enemy_history BEGIN SELECT RAISE(ABORT,'monster-history-interrupted'); END",
    );
    const before = f.db.serialize(),
      samples = vi.mocked(randomInt).mock.calls.length;
    expect(() => f.app().command(request)).toThrow('monster-history-interrupted');
    expect(f.db.serialize().equals(before)).toBe(true);
    for (const table of [
      'campaign_enemy_template',
      'campaign_enemy_version',
      'campaign_enemy_history',
      'campaign_enemy_current_version',
    ])
      expect(f.db.prepare('SELECT COUNT(*) n FROM ' + table).get()).toEqual({ n: 0 });
    f.db.exec('DROP TRIGGER reject_monster_history');
    const receipt = f.app().command(request);
    expect(f.app().command(request)).toEqual({ ...receipt, replayed: true });
    const stable = f.db.serialize();
    expect(() =>
      f.app().command({
        ...request,
        payload: {
          ...request.payload,
          expectedAttemptRevision: request.payload.expectedAttemptRevision + 1,
        },
      }),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(f.db.serialize().equals(stable)).toBe(true);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(samples);
    expect(f.db.prepare('SELECT COUNT(*) n FROM campaign_enemy_version').get()).toEqual({ n: 1 });
  } finally {
    f.close();
  }
});

it('refuses stale, foreign campaign/attempt/graph and wrong-kind monster requests before sampling or partial writes', () => {
  const f = fixture('AUTO');
  try {
    f.begin();
    const preview = f.preview(f.choice('ADVISER', 1));
    const request = f.request('MONSTER_SYMBIONT', {
      operation: 'CONFIRM',
      previewCommandId: preview.request.commandId,
      manualFacesOrNull: null,
    });
    const bad = [
      {
        ...request,
        expectedRevisions: {
          ...request.expectedRevisions,
          projectionRevision: request.expectedRevisions.projectionRevision + 1,
        },
      },
      {
        ...request,
        payload: {
          ...request.payload,
          expectedAttemptRevision: request.payload.expectedAttemptRevision + 1,
        },
      },
      { ...request, payload: { ...request.payload, campaignId: randomUUID() } },
      { ...request, payload: { ...request.payload, creationAttemptId: randomUUID() } },
      { ...request, payload: { ...request.payload, stage: 'SENTIENT_SYMBIONTS' } },
      {
        ...request,
        payload: {
          ...request.payload,
          data: { operation: 'CONFIRM', previewCommandId: randomUUID(), manualFacesOrNull: null },
        },
      },
      f.request('MONSTER_SYMBIONT', {
        operation: 'PREVIEW',
        selection: {
          mode: 'ORDINARY',
          symbiont: {
            speciesKey: 'ADVISER',
            targetLevel: 1,
            learnedNodeRefs: ['SYM-047'],
            binding: { kind: 'NONE' },
          },
        },
      }),
    ];
    const before = f.db.serialize(),
      samples = vi.mocked(randomInt).mock.calls.length;
    for (const input of bad) {
      expect(() => f.app().command(input)).toThrow(
        input.payload.campaignId !== f.scope.campaignId ? 'FOREIGN_OWNER' : 'INVALID_INPUT',
      );
      expect(f.db.serialize().equals(before)).toBe(true);
      expect(vi.mocked(randomInt).mock.calls.length).toBe(samples);
    }
    const result = f.app().command(request);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(samples + 2);
    const acquired = f.projection();
    expect(acquired.context.attemptOrNull?.advisorCards[0]?.iwRolls).toHaveLength(2);
    expect(f.app().command(request)).toEqual({ ...result, replayed: true });
    expect(vi.mocked(randomInt).mock.calls.length).toBe(samples + 2);
  } finally {
    f.close();
  }
});

it('refuses an actual changed monster source before acquisition, then accepts the same request once after exact source restoration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'symbiosis-monster-source-fault-'));
  const artPath = 'generated/media/gm-entity-portraits/symbiosis_placeholder_monster.png';
  for (const source of [...Object.keys(ENEMY_AUTHORING_SOURCE_SEALS), artPath]) {
    const destination = join(directory, source);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(process.cwd(), source), destination);
  }
  const copied = loadEnemyAuthoringSourceCatalog(directory, common);
  const f = fixture('AUTO', copied);
  try {
    f.begin();
    const preview = f.preview(f.choice('ADVISER', 1));
    const request = f.request('MONSTER_SYMBIONT', {
      operation: 'CONFIRM',
      previewCommandId: preview.request.commandId,
      manualFacesOrNull: null,
    });
    const original = readFileSync(join(directory, artPath));
    expect(() => copied.assertMonsterCurrent()).not.toThrow();
    expect(f.projection().requiredRolls).toEqual(['ADVISER_I', 'ADVISER_W']);
    writeFileSync(join(directory, artPath), Buffer.concat([original, Buffer.from('changed')]));
    expect(() => copied.assertMonsterCurrent()).toThrow('changed monster placeholder');
    const bytes = f.db.serialize(),
      samples = vi.mocked(randomInt).mock.calls.length;
    expect(() => f.app().command(request)).toThrow('INVALID_INPUT');
    expect(() => f.app().project()).toThrow('CORRUPT_STORAGE');
    expect(f.db.serialize().equals(bytes)).toBe(true);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(samples);
    writeFileSync(join(directory, artPath), original);
    f.app().command(request);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(samples + 2);
    expect(f.projection().context.attemptOrNull?.advisorCards).toHaveLength(1);
  } finally {
    f.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('checks a fully rehashed foreign monster prefix after a later valid NONE V1, exit and physical reopen', () => {
  const f = fixture();
  try {
    f.begin();
    const species = catalog.monster.symbionts.species.find((row) => row.speciesKey === 'OWL');
    if (species === undefined) throw Error('Actual Owl source absent');
    const first = f.preview({
      mode: 'ORDINARY',
      symbiont: {
        speciesKey: species.speciesKey,
        targetLevel: 1,
        learnedNodeRefs: catalog.monster.development.nodes
          .filter((row) => row.speciesKey === species.speciesKey && row.level === 1)
          .map((row) => row.nodeRef),
        binding: { kind: species.bindingPolicy, side: 'LEFT' },
      },
    });
    const later = f.preview({ mode: 'NONE' });
    f.confirm(later.request.commandId);
    f.finish(later.request.commandId);
    f.app().command(f.request());
    f.nav('ENM-020::CTA::002');
    f.nav('ENM-001::CTA::013');
    expect(f.checked().cursor.formId).toBe('GM-001');
    const events = f.db
      .prepare<[], { event_id: string; record_json: string }>(
        'SELECT event_id,record_json FROM gm_request_queue_event ORDER BY event_index',
      )
      .all();
    let predecessor: string | null = null,
      changed = false;
    for (const row of events) {
      const event = JSON.parse(row.record_json) as JsonObject,
        mutation = event['mutation'] as JsonObject,
        view = event['view'] as JsonObject;
      if (row.event_id === first.request.commandId) {
        const cause = mutation['cause'] as JsonObject;
        const data = ((cause['request'] as JsonObject)['payload'] as JsonObject)[
          'data'
        ] as JsonObject;
        const prepared = (cause['preparedMonsterComposition'] as JsonObject)[
          'composition'
        ] as JsonObject;
        const attempt = (view['enemyAuthoring'] as JsonObject)['attemptOrNull'] as JsonObject;
        const composition = attempt['compositionOrNull'] as JsonObject;
        for (const selection of [
          data['selection'],
          prepared['selection'],
          composition['selection'],
        ])
          Reflect.set(
            (selection as JsonObject)['symbiont'] as JsonObject,
            'speciesKey',
            'FOREIGN_ORDINARY',
          );
        changed = true;
      }
      const { snapshotSha256: _snapshot, ...document } = view;
      Reflect.set(view, 'snapshotSha256', campaignCreationHash(document));
      Reflect.set(event, 'previousEventSha256OrNull', predecessor);
      predecessor = campaignCreationHash(event);
      f.db
        .prepare('UPDATE gm_request_queue_event SET record_json=?,record_sha256=? WHERE event_id=?')
        .run(s.canonical(event), predecessor, row.event_id);
    }
    expect(changed).toBe(true);
    f.restartFromDisk();
    expect(f.db.memory).toBe(false);
    const structural = f.db
      .transaction(() => readGmRequestReviewViewStateInTransaction(f.db, f.scope))
      .deferred();
    expect(structural.viewOrNull?.formId).toBe('GM-001');
    expect(
      structural.events.some(
        (event) =>
          event.view.enemyAuthoring?.attemptOrNull?.kind === 'CUSTOM_MONSTER' &&
          event.view.enemyAuthoring.attemptOrNull.compositionOrNull?.selection.mode ===
            'ORDINARY' &&
          event.view.enemyAuthoring.attemptOrNull.compositionOrNull.selection.symbiont
            .speciesKey === 'FOREIGN_ORDINARY',
      ),
    ).toBe(true);
    const bytes = f.db.serialize();
    expect(() => f.checked()).toThrow('CORRUPT_STORAGE');
    expect(() => f.app().project()).toThrow('CORRUPT_STORAGE');
    expect(() => f.app().command(first.request)).toThrow('INVALID_INPUT');
    expect(() => f.nav('GM-001::CTA::005')).toThrow('INVALID_INPUT');
    expect(f.db.serialize().equals(bytes)).toBe(true);
  } finally {
    f.close();
  }
});

it('binds Adviser losses to accepted graph/body changes, ignores speculative preview, and never resurrects or rerolls on restore', () => {
  const f = fixture();
  try {
    f.begin();
    const high = f.preview(f.choice('ADVISER', 6));
    const acquired = f.confirm(high.request.commandId, [1, 12]);
    const initialSkills = [
      { skillKey: 'LEARNING', targetBonus: 7 },
      { skillKey: 'ACROBATICS', targetBonus: 1 },
    ];
    f.finish(high.request.commandId, initialSkills);
    const full = f.projection();
    expect(full.sheetOrNull?.advisorOrNull).toMatchObject({ I: 15, W: 20, capacity: 10 });
    expect(full.sheetOrNull?.advisorOrNull?.skills.map((row) => row.skillKey)).toEqual([
      'LEARNING',
      'ACROBATICS',
    ]);
    f.nav('ENM-016::CTA::003');
    f.preview(f.choice('ADVISER', 1));
    f.backStats();
    f.patch('MONSTER_STATS', stats);
    f.patch('MONSTER_PHYSICS', physics);
    f.patch('MONSTER_ATTACK', attack);
    let attempt = f.projection().context.attemptOrNull;
    if (attempt?.kind !== 'CUSTOM_MONSTER') throw Error('Expected monster attempt');
    expect(attempt.advisorCards[0]?.knownSkills).toEqual(initialSkills);
    expect(attempt.advisorCards[0]?.confirmedChoice.targetLevel).toBe(6);
    const low = f.preview(f.choice('ADVISER', 1));
    f.confirm(low.request.commandId);
    const restored = f.preview(f.choice('ADVISER', 6));
    f.confirm(restored.request.commandId);
    f.finish(restored.request.commandId, [initialSkills[1]!]);
    expect(f.projection().sheetOrNull?.advisorOrNull?.skills.map((row) => row.skillKey)).toEqual([
      'ACROBATICS',
    ]);
    f.backStats();
    f.patch('MONSTER_STATS', { ...stats, baseStats: { ...stats.baseStats, D: 1 } });
    f.nav('ENM-013::CTA::004');
    f.patch('MONSTER_STATS', stats);
    f.patch('MONSTER_PHYSICS', physics);
    f.patch('MONSTER_ATTACK', attack);
    const final = f.preview(f.choice('ADVISER', 6));
    f.confirm(final.request.commandId);
    f.finish(final.request.commandId);
    attempt = f.projection().context.attemptOrNull;
    if (attempt?.kind !== 'CUSTOM_MONSTER') throw Error('Expected monster attempt');
    expect(attempt.advisorCards).toHaveLength(1);
    expect(attempt.advisorCards[0]?.initialSkillsOrNull).toEqual(initialSkills);
    expect(attempt.advisorCards[0]?.knownSkills).toEqual([]);
    expect(attempt.advisorCards[0]?.permanentLosses.map((row) => row.skillKey)).toEqual([
      'LEARNING',
      'ACROBATICS',
    ]);
    expect(attempt.advisorCards[0]?.iwRolls.map((row) => row.mechanical.rawFace)).toEqual([1, 12]);
    f.app().command(f.request());
    f.restartFromDisk();
    const bytes = f.db.serialize();
    expect(f.projection().sheetOrNull?.advisorOrNull?.skills).toEqual([]);
    expect(f.app().command(acquired.request)).toEqual({
      replayed: true,
      receipt: acquired.result.receipt,
    });
    expect(f.db.serialize().equals(bytes)).toBe(true);
  } finally {
    f.close();
  }
  // The complete source/SQLite Back/replay journey measured 27.985s under a 30s body deadline.
}, 60_000);

it('physically migrates genuine old257 composed SENTIENT V1 and open plan through23 and preserves all old bytes and original receipt', () => {
  const root = join(process.cwd(), 'tests/fixtures/enemy-composed-v1');
  const metadata = JSON.parse(readFileSync(join(root, 'metadata.json'), 'utf8')) as {
    sourceCommit: string;
    sourceTree: string;
    inflatedPreOpenSha256: string;
    gzipSha256: string;
    scope: GmRequestReviewScope;
    commitRequest: EnemyWorkflowRequest;
    commitResult: { replayed: boolean; receipt: CommandReceipt };
    savedVersionRecordSha256: string;
    openAttemptId: string;
    openPlanId: string;
  };
  expect(metadata.sourceCommit).toBe('c6820e9b258f7a743403ddba0ed55dcd23691036');
  expect(metadata.sourceTree).toBe('ab05f2fc5e408ac7cf47dc36acc665a7e423d852');
  expect(metadata.gzipSha256).toBe(
    'b4c726ec2fdae7a6be4c5d25013acf2206fdb5def0d2092ea235eddabaed4e52',
  );
  expect(metadata.inflatedPreOpenSha256).toBe(
    '3184d3810b723ecea8ac5b152bedfb8fb8cd2ac6904d03c8816a9325ba607b30',
  );
  const compressed = readFileSync(join(root, 'schema21-composed-v1.sqlite.gz'));
  expect(createHash('sha256').update(compressed).digest('hex')).toBe(metadata.gzipSha256);
  const bytes = gunzipSync(compressed);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.inflatedPreOpenSha256);
  const directory = mkdtempSync(join(tmpdir(), 'symbiosis-old257-through23-')),
    filename = join(directory, 'history.sqlite');
  writeFileSync(filename, bytes);
  const rows = (db: Database.Database): Record<string, unknown[]> =>
    Object.fromEntries(
      db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
        )
        .all()
        .map(
          ({ name }) =>
            [
              name,
              db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all(),
            ] as const,
        ),
    );
  let db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const original = rows(db);
    const registry = original['schema_migration'];
    if (registry === undefined) throw Error('Historical registry absent');
    expect(registry).toHaveLength(21);
    const expected = {
      ...original,
      schema_migration: [
        ...registry,
        {
          version: migration0022.version,
          name: migration0022.name,
          checksum_sha256: createHash('sha256').update(migration0022.sql).digest('hex'),
        },
        {
          version: migration0023.version,
          name: migration0023.name,
          checksum_sha256: createHash('sha256').update(migration0023.sql).digest('hex'),
        },
      ],
    };
    db.close();
    db = openPersistenceDatabase(filename);
    expect(db.memory).toBe(false);
    expect(rows(db)).toEqual(expected);
    // Actual source/history/owner bindings remain; only this fixture's password KDF verifier is bypassed.
    const checked = (
      observe: Parameters<typeof readGmRequestReviewSourceWith>[3] = () => undefined,
    ) =>
      readGmRequestReviewSourceWith(
        db,
        metadata.scope,
        () => undefined,
        (source, state) => {
          validateEnemyLibrarySource(source, state, librarySource, baseline);
          validateEnemyAuthoringSource(db, source, state, catalog, baseline);
          return observe(source, state);
        },
      ).source;
    const app = () =>
      createEnemyAuthoringApplication({
        database: db,
        scope: metadata.scope,
        catalog,
        baseline,
        validateOwner: () => undefined,
        readCurrent: checked,
      });
    const projection = sentientEnemyAuthoringProjectionValue(
      app().project().base.roleFilteredPayload,
    );
    expect(projection.formId).toBe('ENM-008');
    expect(projection.context.attemptOrNull?.attemptId).toBe(metadata.openAttemptId);
    expect(projection.context.attemptOrNull?.skillPlanState?.planOrNull?.planId).toBe(
      metadata.openPlanId,
    );
    const version = db.prepare('SELECT record_sha256 FROM campaign_enemy_version').get();
    expect(version).toEqual({ record_sha256: metadata.savedVersionRecordSha256 });
    expect(app().command(metadata.commitRequest)).toEqual({
      ...metadata.commitResult,
      replayed: true,
    });
    expect(rows(db)).toEqual(expected);
    db.close();
    db = openPersistenceDatabase(filename);
    const beforeReplay = db.serialize();
    expect(app().project().base.roleFilteredPayload).toEqual(projection);
    expect(app().command(metadata.commitRequest)).toEqual({
      ...metadata.commitResult,
      replayed: true,
    });
    expect(rows(db)).toEqual(expected);
    expect(db.serialize().equals(beforeReplay)).toBe(true);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
