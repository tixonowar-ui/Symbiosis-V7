import { randomInt, randomUUID } from 'node:crypto';
import type * as NodeCrypto from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, expect, it, vi } from 'vitest';
import type { ActionKey } from '@generated/types/atlas.js';
import {
  enemyWorkflowRequestValue,
  enemyVersionIdentityValue,
  enemyAuthoringProjectionValue,
} from '@shared/enemy-authoring.js';
import { monsterStatRollReceiptValue } from '@shared/monster-stat-roll.js';
import { wireCodecPrimitives as w } from '@shared/wire-codec.js';
import { createEnemyLibraryFixture } from '../../tests/fixtures/enemy-library.js';
import { loadLocalCharacterExportBaseline } from './local-character-export.js';
import { loadNpcAuthoringSourceCatalog } from './npc-catalog.js';
import { loadEnemySourceCatalog } from './enemy-catalog.js';
import { loadEnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';
import {
  createEnemyAuthoringApplication,
  validateEnemyAuthoringSource,
} from './enemy-authoring-application.js';
import {
  createEnemyLibraryApplication,
  validateEnemyLibrarySource,
} from './enemy-library-application.js';
import { campaignEnemyIdentityInUse } from '../persistence/npc-identities.js';
import { readAppliedMigrationVersion } from '../persistence/migrations/index.js';
import { ENEMY_AUTHORING_SOURCE_SEALS } from './enemy-authoring-source-seals.js';
import {
  createLocalGmContext,
  readActiveLocalGmContext,
} from '../persistence/campaign-creation.js';
import { networkApplicationStorage as storage } from '../persistence/network-local-application.js';
import { calculateSkillStageStats } from '../domain/rules/skill-stage/stats.js';
import {
  calculateSkillSlotCost,
  validateSkillSelection,
  validateSkillSelectionDraft,
} from '../domain/rules/skill-stage/skills.js';

vi.mock('node:crypto', async (original) => {
  const actual = await original<typeof NodeCrypto>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});
let baseline: Awaited<ReturnType<typeof loadLocalCharacterExportBaseline>>;
let librarySource: ReturnType<typeof loadEnemySourceCatalog>;
let catalog: ReturnType<typeof loadEnemyAuthoringSourceCatalog>;
let common: Awaited<ReturnType<typeof loadNpcAuthoringSourceCatalog>>;
beforeAll(async () => {
  const started = performance.now(),
    phases: Record<string, number> = {};
  let previous = started;
  const mark = (name: string) => {
    const now = performance.now();
    phases[name] = now - previous;
    previous = now;
  };
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  mark('baselineMs');
  common = await loadNpcAuthoringSourceCatalog(process.cwd());
  mark('commonCatalogMs');
  librarySource = loadEnemySourceCatalog(process.cwd(), baseline);
  mark('libraryCatalogMs');
  catalog = loadEnemyAuthoringSourceCatalog(process.cwd(), common);
  mark('authoringCatalogMs');
  console.info('monster-stat-roll catalog setup', {
    ...phases,
    totalMs: performance.now() - started,
  });
});
const json = (v: unknown) => structuredClone(w.jsonObject(v, '$.unit'));
const edited = {
  statMode: 'MANUAL',
  baseStats: { S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 },
  massKg: 5.1,
  ageYears: 17,
  baseMaxHP: 42,
  rollReceiptOrNull: null,
};
const physics = {
  naturalArmorDefinition: { mode: 'ZERO' },
  anatomyMode: 'NONSTANDARD_TORSO_ONLY',
  normalizedHitRegion: 'TORSO',
  size: null,
  movement: null,
  physicalTags: [],
  metadataHasNoMechanicalEffect: true,
};
const attack = {
  category: 'MONSTER_ATTACK',
  distance: 'MELEE',
  actionCost: 1,
  additionalDamageDefinition: { mode: 'CONSTANT', value: 1 },
  penetrationDefinition: { mode: 'ZERO' },
};
function fixture(mode: 'AUTO' | 'MANUAL', authoringCatalog = catalog) {
  const f = createEnemyLibraryFixture(librarySource, baseline, false, mode);
  const read: typeof f.readCurrent = (observe) =>
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
      readCurrent: read,
    });
  const versions = () => {
    let rows: ReturnType<typeof validateEnemyAuthoringSource> = [];
    read((source, state) => {
      rows = validateEnemyAuthoringSource(f.db, source, state, authoringCatalog, baseline);
    });
    return rows;
  };
  const lib = () =>
    createEnemyLibraryApplication({
      database: f.db,
      scope: f.scope,
      catalog: librarySource,
      baseline,
      validateOwner: () => undefined,
      readCurrent: read,
      readUsers: () => {
        const rows = versions();
        return rows
          .filter(
            (row) =>
              !rows.some(
                (other) =>
                  other.identity.templateId === row.identity.templateId &&
                  other.identity.version > row.identity.version,
              ),
          )
          .map((row) => ({ ...row.identity, displayName: row.sheet.identity.name }));
      },
    });
  const view = () =>
    read().viewOrNull ??
    (() => {
      throw new Error('Missing owning view');
    })();
  const nav = (actionKey: ActionKey) =>
    lib().navigation({
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId: view().formId,
      expectedProjectionRevision: view().projectionRevision,
      actionKey,
    });
  const request = (workflowCommandId: string, payload: object = {}) => {
    const current = view(),
      attempt = current.enemyAuthoring?.attemptOrNull;
    if (attempt == null) throw new Error('Missing owning attempt');
    return enemyWorkflowRequestValue({
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      workflowCommandId,
      expectedRevisions: {
        stateRevision: current.stateRevision,
        projectionRevision: current.projectionRevision,
        actorVisibilityRevision: current.actorVisibilityRevision,
      },
      payload: {
        campaignId: f.scope.campaignId,
        creationAttemptId: attempt.attemptId,
        expectedAttemptRevision: attempt.revision,
        ...payload,
      },
    });
  };
  const patch = (stage: string, data: unknown) =>
    app().command(request('UI-CMD-ENEMY-DRAFT-PATCH', { stage, data: json(data) }));
  const select = (identity: ReturnType<typeof enemyVersionIdentityValue> | null) => {
    const current = view();
    return lib().select({
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
    });
  };
  const open = (sourceActionKey: string, draftOrNull: unknown = null) =>
    patch('MONSTER_STAT_DRAFT', { sourceActionKey, draftOrNull });
  const rollRequest = () => {
    const binding = view().enemyAuthoring?.monsterStatRoll?.binding;
    if (binding === undefined) throw new Error('Missing actual owning roll binding');
    return request('UI-CMD-MONSTER-STATS-ROLL-ONCE', {
      attemptId: binding.attemptId,
      monsterDraftId: binding.attemptId,
      originFormId: binding.originFormId,
      returnFormId: binding.originFormId,
      versionBindingOrNull: binding.versionBindingOrNull,
    });
  };
  const begin = () => {
    select(null);
    nav('ENM-001::CTA::011');
    patch('MONSTER_IDENTITY', {
      name: 'Реальный одноразовый монстр',
      description: null,
      creatureType: 'CUSTOM_MONSTER',
    });
  };
  return {
    f,
    read,
    view,
    app,
    lib,
    nav,
    request,
    patch,
    select,
    open,
    rollRequest,
    begin,
    versions,
  };
}

for (const mode of ['MANUAL', 'AUTO'] as const)
  it(`owns exactly seven natural R20 in ${mode}, preserves edits and receipts across physical restart, and gives a distinct version attempt its own right`, () => {
    const started = performance.now(),
      phases: Record<string, number> = {};
    let previous = started;
    const mark = (name: string) => {
      const now = performance.now();
      phases[name] = now - previous;
      previous = now;
    };
    const h = fixture(mode),
      { f } = h;
    mark('campaignSetupMs');
    try {
      h.begin();
      const project = () => {
        const value = enemyAuthoringProjectionValue(h.app().project().base.roleFilteredPayload);
        if (value.kind !== 'CUSTOM_MONSTER_AUTHORING')
          throw new Error('Missing actual monster projection');
        return value;
      };
      expect(project().statGeneration?.candidateStats.baseStats).toEqual({
        S: null,
        D: null,
        M: null,
        Z: null,
        I: null,
        W: null,
        C: null,
      });
      expect(readAppliedMigrationVersion(f.db)).toBe(24);
      const initial = h.view().enemyAuthoring?.attemptOrNull;
      expect(initial?.kind === 'CUSTOM_MONSTER' && initial.statsOrNull).toBeNull();
      vi.mocked(randomInt).mockClear();
      h.open('ENM-012::CTA::005');
      const seed = h.view().enemyAuthoring?.monsterStatRoll?.generationSeed;
      expect(h.view().formId).toBe('ENM-018');
      expect(project().statGeneration?.generationSeed).toBe(seed);
      expect(h.app().project().base.availableActionKeys).toEqual([
        'ENM-018::CTA::001',
        'ENM-018::CTA::002',
        'ENM-018::CTA::003',
      ]);
      h.nav('ENM-018::CTA::003');
      expect(randomInt).not.toHaveBeenCalled();
      h.open('ENM-012::CTA::005');
      expect(h.view().enemyAuthoring?.monsterStatRoll?.generationSeed).toBe(seed);
      const rollRequest = h.rollRequest(),
        rolled = h.app().command(rollRequest);
      expect(randomInt).toHaveBeenCalledTimes(7);
      expect(vi.mocked(randomInt).mock.calls).toEqual(Array.from({ length: 7 }, () => [1, 21]));
      const receipt = monsterStatRollReceiptValue(rolled.receipt.result.randomStatsReceipt);
      mark('creationOpenRollMs');
      expect(receipt.randomReceiptId).toBe(rolled.receipt.receiptId);
      expect(receipt.operationId).toBe(rollRequest.commandId);
      expect(receipt.dieFaces).toHaveLength(7);
      expect(h.view().formId).toBe('ENM-012');
      expect(project().statGeneration?.candidateStats.baseStats).toEqual(
        receipt.originalGeneratedStats,
      );
      expect(h.view().enemyAuthoring?.monsterStatRoll?.draftOrNull?.massKg).toBeNull();
      const pendingBytes = f.db.serialize();
      expect(() => h.open('ENM-012::CTA::002', null)).toThrow('INVALID_INPUT');
      expect(f.db.serialize()).toEqual(pendingBytes);
      expect(randomInt).toHaveBeenCalledTimes(7);
      const draft = {
        baseStats: edited.baseStats,
        massKg: edited.massKg,
        ageYears: edited.ageYears,
        baseMaxHP: edited.baseMaxHP,
      };
      h.open('ENM-012::CTA::002', draft);
      expect(h.view().formId).toBe('ENM-019');
      const receiptView = project();
      expect(receiptView.statGeneration?.randomReceiptOrNull).toEqual(receipt);
      expect(receiptView.statGeneration?.candidateStats).toEqual(draft);
      expect(receiptView.sheetOrNull).toBeNull();
      expect(h.app().project().base.availableActionKeys).toEqual(['ENM-019::CTA::001']);
      for (const tamper of [
        {
          ...receiptView,
          statGeneration: { ...receiptView.statGeneration, attemptId: randomUUID() },
        },
        {
          ...receiptView,
          statGeneration: {
            ...receiptView.statGeneration,
            candidateStats: { ...draft, massKg: 5.2 },
          },
        },
        {
          ...receiptView,
          statGeneration: { ...receiptView.statGeneration, generationSeed: '0'.repeat(64) },
        },
        {
          ...receiptView,
          statGeneration: {
            ...receiptView.statGeneration,
            eligibleStatRanges: {
              ...receiptView.statGeneration?.eligibleStatRanges,
              S: { min: 1, max: 20 },
            },
          },
        },
      ])
        expect(() => enemyAuthoringProjectionValue(tamper)).toThrow();
      h.nav('ENM-019::CTA::001');
      expect(h.view().enemyAuthoring?.monsterStatRoll?.draftOrNull).toEqual(draft);
      f.restartFromDisk();
      expect(h.view().enemyAuthoring?.monsterStatRoll?.draftOrNull).toEqual(draft);
      expect(randomInt).toHaveBeenCalledTimes(7);
      h.patch('MONSTER_STATS', edited);
      h.patch('MONSTER_PHYSICS', physics);
      h.patch('MONSTER_ATTACK', attack);
      h.patch('MONSTER_SYMBIONT', { operation: 'PREVIEW', selection: { mode: 'NONE' } });
      const preview = h.view().enemyAuthoring?.attemptOrNull;
      if (preview?.kind !== 'CUSTOM_MONSTER' || preview.compositionOrNull === null)
        throw new Error('Missing actual NONE preview');
      h.patch('MONSTER_SYMBIONT', {
        operation: 'CONFIRM',
        previewCommandId: preview.compositionOrNull.previewCommandId,
        manualFacesOrNull: null,
      });
      h.patch('MONSTER_SYMBIONT', {
        operation: 'FINISH',
        previewCommandId: preview.compositionOrNull.previewCommandId,
        advisorSkills: [],
      });
      const commitRequest = h.request('UI-CMD-ENEMY-COMMIT-V1');
      const committed = h.app().command(commitRequest);
      mark('editReceiptReopenAcceptV1Ms');
      const identity = enemyVersionIdentityValue(committed.receipt.result.committedVersionOrNull);
      let oldRows = f.db.prepare('SELECT * FROM campaign_enemy_version ORDER BY rowid').all();
      const chain = [identity];
      const originalReplay = h.app().command(rollRequest);
      expect(originalReplay.replayed).toBe(true);
      expect(originalReplay.receipt).toEqual(rolled.receipt);
      expect(h.view().formId).toBe('ENM-020');
      expect(project().statGeneration?.randomReceiptOrNull).toEqual(receipt);
      expect(project().statGeneration?.candidateStats).toEqual(draft);
      expect(project().statGeneration?.requiresBodyAcceptance).toBe(false);
      const savedProjection = project();
      expect(() =>
        enemyAuthoringProjectionValue({
          ...savedProjection,
          statGeneration: {
            ...savedProjection.statGeneration,
            candidateStats: { ...draft, massKg: 5.2 },
          },
        }),
      ).toThrow();
      expect(randomInt).toHaveBeenCalledTimes(7);
      h.nav('ENM-020::CTA::002');
      h.select(identity);
      h.nav('ENM-001::CTA::008');
      expect(h.view().enemyAuthoring?.monsterStatRoll).toBeUndefined();
      const copied = h.view().enemyAuthoring?.attemptOrNull;
      expect(copied?.kind === 'CUSTOM_MONSTER' && copied.statsOrNull).toEqual(edited);
      h.open('ENM-017::CTA::006');
      expect(h.view().enemyAuthoring?.monsterStatRoll?.rollOnceStatus).toBe('NOT_ROLLED');
      if (mode === 'AUTO') {
        // Merely viewing018 must not make an unchanged, already accepted body require repair.
        const cached = structuredClone(h.view().enemyAuthoring?.monsterStatRoll);
        h.nav('ENM-018::CTA::006');
        expect(h.view().enemyAuthoring?.monsterStatRoll).toEqual(cached);
        h.patch('VERSION_CONFIGURATION', {
          operation: 'SET_REASON',
          reason: 'Полная неизменная копия после возврата без броска',
        });
        const state = h.view().enemyAuthoring?.versionAttempt;
        if (state === undefined) throw new Error('Missing actual version state');
        const copiedVersion = h
          .app()
          .command(h.request('UI-CMD-ENEMY-NEW-VERSION', { reason: state.reason }));
        const nextIdentity = enemyVersionIdentityValue(
          copiedVersion.receipt.result.committedVersionOrNull,
        );
        expect(nextIdentity.version).toBe(2);
        chain.push(nextIdentity);
        expect(
          f.db
            .prepare('SELECT * FROM campaign_enemy_version WHERE version_id=?')
            .get(identity.versionId),
        ).toEqual(oldRows[0]);
        const saved = h.versions().find((v) => v.identity.versionId === nextIdentity.versionId);
        expect(saved?.attempt.kind === 'CUSTOM_MONSTER' && saved.attempt.statsOrNull).toEqual(
          edited,
        );
        expect(randomInt).toHaveBeenCalledTimes(7);
        oldRows = f.db.prepare('SELECT * FROM campaign_enemy_version ORDER BY rowid').all();
        h.nav('ENM-020::CTA::002');
        h.select(nextIdentity);
        h.nav('ENM-001::CTA::008');
        h.open('ENM-017::CTA::006');
      }
      const validVersionRequest = h.rollRequest(),
        binding = validVersionRequest.payload.versionBindingOrNull;
      if (binding == null) throw new Error('Missing actual version binding');
      if (mode === 'AUTO')
        for (const changed of [
          { ...binding, templateId: randomUUID() },
          { ...binding, expectedCurrentVersion: binding.expectedCurrentVersion - 1 },
        ]) {
          const before = f.db.serialize();
          expect(() =>
            h.app().command({
              ...validVersionRequest,
              payload: { ...validVersionRequest.payload, versionBindingOrNull: changed },
            }),
          ).toThrow('INVALID_INPUT');
          expect(f.db.serialize()).toEqual(before);
          expect(randomInt).toHaveBeenCalledTimes(7);
        }
      const versionRollRequest = validVersionRequest,
        versionRoll = h.app().command(versionRollRequest);
      expect(randomInt).toHaveBeenCalledTimes(14);
      expect(vi.mocked(randomInt).mock.calls).toEqual(Array.from({ length: 14 }, () => [1, 21]));
      const versionReceipt = monsterStatRollReceiptValue(
        versionRoll.receipt.result.randomStatsReceipt,
      );
      expect(versionReceipt.creationAttemptId).not.toBe(receipt.creationAttemptId);
      expect(versionReceipt.randomReceiptId).not.toBe(receipt.randomReceiptId);
      expect(h.view().enemyAuthoring?.monsterStatRoll?.draftOrNull).toMatchObject({
        massKg: 5.1,
        ageYears: 17,
        baseMaxHP: 42,
      });
      h.nav('ENM-017::CTA::005');
      expect(h.view().formId).toBe('ENM-020');
      expect(f.db.prepare('SELECT * FROM campaign_enemy_version ORDER BY rowid').all()).toEqual(
        oldRows,
      );
      expect(h.versions().map((v) => v.identity)).toEqual(chain);
      expect(campaignEnemyIdentityInUse(f.db, versionReceipt.randomReceiptId)).toBe(true);
      f.restartFromDisk();
      expect(h.app().command(versionRollRequest)).toEqual({
        replayed: true,
        receipt: versionRoll.receipt,
      });
      expect(h.app().command(rollRequest)).toEqual({ replayed: true, receipt: rolled.receipt });
      expect(h.app().command(commitRequest)).toEqual({
        replayed: true,
        receipt: committed.receipt,
      });
      expect(randomInt).toHaveBeenCalledTimes(14);
      expect(h.view().formId).toBe('ENM-020');
      if (mode === 'AUTO') {
        const current = project();
        expect(current.context.selectedVersionOrNull).toEqual(chain[1]);
        expect(current.statGeneration?.rollOnceStatus).toBe('NOT_ROLLED');
        expect(current.statGeneration?.randomReceiptOrNull).toBeNull();
        expect(current.statGeneration?.candidateStats).toEqual(draft);
        const view = h.view();
        h.lib().select({
          messageType: 'network.enemy-selection.replace',
          protocolVersion: 3,
          operationId: randomUUID(),
          contextId: f.scope.gmLocalContextId,
          campaignId: f.scope.campaignId,
          sourceFormId: 'ENM-020',
          activeTab: 'MONSTERS',
          expectedRevisions: {
            stateRevision: view.stateRevision,
            projectionRevision: view.projectionRevision,
            actorVisibilityRevision: view.actorVisibilityRevision,
          },
          selectionOrNull: null,
          userSelectionOrNull: identity,
        });
        const historical = project();
        expect(historical.context.selectedVersionOrNull).toEqual(identity);
        expect(historical.versionHistory?.current).toEqual(chain[1]);
        expect(historical.statGeneration?.randomReceiptOrNull).toEqual(receipt);
        expect(historical.statGeneration?.candidateStats).toEqual(draft);
        expect(randomInt).toHaveBeenCalledTimes(14);
      }
      expect(f.db.prepare('SELECT * FROM campaign_enemy_version ORDER BY rowid').all()).toEqual(
        oldRows,
      );
      mark('versionCancelReopenReplayMs');
    } finally {
      f.close();
      mark('cleanupMs');
      console.info('monster-stat-roll owning phases', {
        mode,
        ...phases,
        totalMs: performance.now() - started,
      });
    }
  }, 120_000);

it('refuses stale and foreign AUTO requests before native RNG, rolls back reached ledger/cursor faults, and requires24 for persisted roll history', () => {
  const h = fixture('AUTO'),
    { f } = h;
  try {
    h.begin();
    h.open('ENM-012::CTA::005');
    const good = h.rollRequest();
    vi.mocked(randomInt).mockClear();
    const before = f.db.serialize(),
      foreignAttemptId = randomUUID();
    // Public store guards intentionally normalize failures from preparation callbacks.
    for (const [caseIndex, [value, code]] of (
      [
        [{ ...good, payload: { ...good.payload, campaignId: randomUUID() } }, 'FOREIGN_OWNER'],
        [
          {
            ...good,
            payload: {
              ...good.payload,
              creationAttemptId: foreignAttemptId,
              attemptId: foreignAttemptId,
              monsterDraftId: foreignAttemptId,
            },
          },
          'INVALID_INPUT',
        ],
        [{ ...good, payload: { ...good.payload, monsterDraftId: randomUUID() } }, 'UNRECOGNIZED'],
        [{ ...good, payload: { ...good.payload, expectedAttemptRevision: 0 } }, 'INVALID_INPUT'],
        [
          {
            ...good,
            expectedRevisions: {
              ...good.expectedRevisions,
              projectionRevision: good.expectedRevisions.projectionRevision - 1,
            },
          },
          'INVALID_INPUT',
        ],
        [
          {
            ...good,
            payload: {
              ...good.payload,
              originFormId: 'ENM-017',
              returnFormId: 'ENM-017',
              versionBindingOrNull: { templateId: randomUUID(), expectedCurrentVersion: 1 },
            },
          },
          'INVALID_INPUT',
        ],
        [{ ...good, payload: { ...good.payload, returnFormId: 'ENM-017' } }, 'UNRECOGNIZED'],
      ] as const
    ).entries()) {
      expect(() => h.app().command(value), 'negative-vector-' + caseIndex).toThrow(code);
      expect(f.db.serialize()).toEqual(before);
      expect(randomInt).not.toHaveBeenCalled();
    }
    h.nav('ENM-018::CTA::003');
    const wrongSource = h.rollRequest(),
      parentBytes = f.db.serialize();
    expect(() => h.app().command(wrongSource)).toThrow('INVALID_INPUT');
    expect(f.db.serialize()).toEqual(parentBytes);
    expect(randomInt).not.toHaveBeenCalled();
    h.open('ENM-012::CTA::005');
    const command = h.rollRequest();
    const rows = () =>
      Object.fromEntries(
        f.db
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
          )
          .all()
          .map(({ name }) => [
            name,
            f.db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all(),
          ]),
      );
    const schema = () =>
      f.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
    let expectedCalls = 0;
    for (const [table, operation, marker, when] of [
      [
        'gm_request_queue_event',
        'INSERT',
        'MONSTER_ROLL_LEDGER_REACHED',
        " WHEN NEW.kind='ENEMY_AUTHORING' AND json_extract(NEW.record_json,'$.mutation.cause.request.workflowCommandId')='UI-CMD-MONSTER-STATS-ROLL-ONCE'",
      ],
      ['campaign_creation_cursor', 'UPDATE', 'MONSTER_ROLL_CURSOR_REACHED', ''],
    ] as const) {
      f.db.exec(
        'CREATE TRIGGER reject_monster_roll BEFORE ' +
          operation +
          ' ON ' +
          table +
          when +
          " BEGIN SELECT RAISE(ABORT,'" +
          marker +
          "'); END",
      );
      const logicalBefore = rows(),
        schemaBefore = schema();
      // Byte-exact test precondition only; never compact production or alter logical state.
      if (Number(f.db.pragma('freelist_count', { simple: true })) !== 0) f.db.exec('VACUUM');
      expect(f.db.pragma('freelist_count', { simple: true })).toBe(0);
      expect(rows()).toEqual(logicalBefore);
      expect(schema()).toEqual(schemaBefore);
      const bytes = f.db.serialize(),
        view = structuredClone(h.view());
      expect(() => h.app().command(command)).toThrow(marker);
      expectedCalls += 7;
      expect(randomInt).toHaveBeenCalledTimes(expectedCalls);
      expect(f.db.inTransaction).toBe(false);
      expect(f.db.serialize()).toEqual(bytes);
      expect(rows()).toEqual(logicalBefore);
      expect(schema()).toEqual(schemaBefore);
      expect(h.view()).toEqual(view);
      expect(h.view().enemyAuthoring?.monsterStatRoll?.rollOnceStatus).toBe('NOT_ROLLED');
      expect(h.view().enemyAuthoring?.monsterStatRoll?.randomReceiptOrNull).toBeNull();
      expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(f.db.pragma('integrity_check', { simple: true })).toBe('ok');
      f.db.exec('DROP TRIGGER reject_monster_roll');
    }
    // The failed transactions committed no operation/receipt; retry samples one new seven-face set.
    const committed = h.app().command(command);
    expectedCalls += 7;
    expect(randomInt).toHaveBeenCalledTimes(expectedCalls);
    expect(vi.mocked(randomInt).mock.calls).toEqual(
      Array.from({ length: expectedCalls }, () => [1, 21]),
    );
    const receipt = monsterStatRollReceiptValue(committed.receipt.result.randomStatsReceipt);
    expect(receipt.randomReceiptId).toBe(committed.receipt.receiptId);
    expect(h.app().command(command)).toEqual({ replayed: true, receipt: committed.receipt });
    expect(randomInt).toHaveBeenCalledTimes(expectedCalls);
    const replayBytes = f.db.serialize();
    expect(() =>
      h.app().command({
        ...command,
        payload: {
          ...command.payload,
          expectedAttemptRevision: command.payload.expectedAttemptRevision + 1,
        },
      }),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(f.db.serialize()).toEqual(replayBytes);
    expect(randomInt).toHaveBeenCalledTimes(expectedCalls);
    f.db.prepare('DELETE FROM schema_migration WHERE version=24').run();
    expect(readAppliedMigrationVersion(f.db)).toBe(23);
    const missing24 = f.db.serialize();
    expect(() => h.read()).toThrow('network application storage: SOURCE_CHANGED');
    expect(() => h.app().command(command)).toThrow('network application storage: INVALID_INPUT');
    expect(f.db.serialize()).toEqual(missing24);
    expect(randomInt).toHaveBeenCalledTimes(expectedCalls);
  } finally {
    f.close();
  }
}, 120_000);

it('refuses the channel for a real SENTIENT symbiotic monster and a currently selected system detail before RNG or writes', () => {
  const h = fixture('AUTO'),
    { f } = h;
  try {
    h.nav('ENM-001::CTA::003');
    h.patch('SENTIENT_IDENTITY', {
      name: 'Разумный носитель Химеры',
      description: null,
      origin: 'Дозор',
      affiliation: 'Город',
      massKg: 80.1,
      anatomyProfileId: 'ORDINARY_SENTIENT',
    });
    const baseStats = { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 };
    h.patch('SENTIENT_STATS', baseStats);
    const basis = calculateSkillStageStats(catalog.skills, {
      baseStats,
      raceCode: 'UNITED',
      classCode: null,
      creationMode: 'MANUAL',
    }).skillStageStats;
    const draft = validateSkillSelectionDraft(catalog.skills, {
      raceCode: 'UNITED',
      classCode: null,
      skillStageStats: basis,
      selectedSkills: [],
    });
    const fixed = new Set(draft.learnedSkills.map((row) => row.skillKey));
    const keys = catalog.skills.skills
      .filter(
        (row) =>
          row.category === 'SELECTABLE_GENERAL' &&
          !fixed.has(row.skillKey) &&
          catalog.skills.requirements
            .filter((req) => req.skillKey === row.skillKey)
            .every((req) => basis[req.statCode] >= req.minValue),
      )
      .map((row) => row.skillKey);
    const selectedSkills: { skillKey: string; targetBonus: number }[] = [];
    if (draft.remaining > 0) {
      let bonus = 1;
      while (calculateSkillSlotCost(bonus + 1) <= draft.remaining) bonus++;
      const first = keys[0];
      if (first === undefined) throw new Error('No actual selectable START skill');
      selectedSkills.push({ skillKey: first, targetBonus: bonus });
      const remaining = draft.remaining - calculateSkillSlotCost(bonus);
      if (remaining > 0) {
        const second = keys[1];
        if (second === undefined) throw new Error('No second actual START skill');
        selectedSkills.push({ skillKey: second, targetBonus: remaining });
      }
    }
    validateSkillSelection(catalog.skills, {
      raceCode: 'UNITED',
      classCode: null,
      skillStageStats: basis,
      selectedSkills,
    });
    h.patch('SENTIENT_BUILD', {
      raceCode: 'UNITED',
      pureClassOrNull: null,
      skillSelections: selectedSkills,
    });
    const species = catalog.composition.symbionts.species.find(
      (row) => row.speciesKey === 'CHIMERA',
    );
    const profile = catalog.composition.development.levels.find(
      (row) => row.speciesKey === 'CHIMERA' && row.level === 4,
    );
    if (species === undefined || profile === undefined)
      throw new Error('Actual Chimerа source absent');
    expect(species.kind).toBe('SYMBIOTIC_MONSTER');
    const preview = h.request('UI-CMD-ENEMY-DRAFT-PATCH', {
      stage: 'SENTIENT_SYMBIONTS',
      data: {
        operation: 'PREVIEW',
        advisorRemovalConfirmed: false,
        selection: {
          symbiontCompositionMode: 'SYMBIOTIC_MONSTER',
          ordinarySymbiontInstances: [],
          symbioticMonsterProfileIdOrNull: profile.levelProfileId,
          monsterOrNull: {
            speciesKey: species.speciesKey,
            targetLevel: 4,
            learnedNodeRefs: catalog.composition.development.nodes
              .filter((row) => row.speciesKey === species.speciesKey && row.level <= 4)
              .map((row) => row.nodeRef),
            binding: { kind: species.bindingPolicy },
          },
        },
      },
    });
    h.app().command(preview);
    h.patch('SENTIENT_SYMBIONTS', {
      operation: 'CONFIRM',
      previewCommandId: preview.commandId,
      interactionsConfirmed: true,
      manualFacesOrNull: null,
    });
    h.patch('SENTIENT_SYMBIONTS', {
      operation: 'FINISH',
      previewCommandId: preview.commandId,
      skills: { advisorSkills: [], dolphinSkills: [] },
    });
    h.patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const projected = enemyAuthoringProjectionValue(h.app().project().base.roleFilteredPayload);
    if (projected.kind !== 'SENTIENT_ENEMY_AUTHORING')
      throw new Error('Missing actual SENTIENT sheet');
    expect(projected.context.attemptOrNull?.compositionOrNull).toMatchObject({
      symbiontCompositionMode: 'SYMBIOTIC_MONSTER',
      monsterOrNull: { speciesKey: 'CHIMERA', targetLevel: 4 },
      symbioticMonsterProfileIdOrNull: profile.levelProfileId,
    });
    expect(projected.sheetOrNull?.compositionFacts?.['specimens']).toMatchObject([
      { speciesKey: 'CHIMERA', targetLevel: 4, currentOE: 1600, maxOE: 1600 },
    ]);
    const attempt = projected.context.attemptOrNull;
    if (attempt === null) throw new Error('Missing owning SENTIENT attempt');
    const forbidden = h.request('UI-CMD-MONSTER-STATS-ROLL-ONCE', {
      attemptId: attempt.attemptId,
      monsterDraftId: attempt.attemptId,
      originFormId: 'ENM-012',
      returnFormId: 'ENM-012',
      versionBindingOrNull: null,
    });
    vi.mocked(randomInt).mockClear();
    const before = f.db.serialize();
    expect(() => h.app().command(forbidden)).toThrow('network application storage: INVALID_INPUT');
    expect(() => h.open('ENM-012::CTA::005')).toThrow('network application storage: INVALID_INPUT');
    expect(f.db.serialize()).toEqual(before);
    expect(randomInt).not.toHaveBeenCalled();
    for (const action of [
      'ENM-010::CTA::005',
      'ENM-009::CTA::001',
      'ENM-007::CTA::005',
      'ENM-006::CTA::003',
      'ENM-005::CTA::004',
    ] as const)
      h.nav(action);
    const system = librarySource.systemTemplates[0];
    if (system === undefined) throw new Error('No actual system template');
    const current = h.view();
    h.lib().select({
      messageType: 'network.enemy-selection.replace',
      protocolVersion: 3,
      operationId: randomUUID(),
      contextId: f.scope.gmLocalContextId,
      campaignId: f.scope.campaignId,
      sourceFormId: 'ENM-001',
      activeTab: 'SENTIENT_ENEMIES',
      selectionOrNull: {
        origin: system.origin,
        templateId: system.templateId,
        catalogVersion: system.catalogVersion,
        artAssetKey: system.artAssetKey,
      },
      userSelectionOrNull: null,
      expectedRevisions: {
        stateRevision: current.stateRevision,
        projectionRevision: current.projectionRevision,
        actorVisibilityRevision: current.actorVisibilityRevision,
      },
    });
    h.nav('ENM-001::CTA::004');
    expect(h.view().formId).toBe('ENM-003');
    expect(h.view().enemyAuthoring?.attemptOrNull ?? null).toBeNull();
    expect(h.lib().project().base.roleFilteredPayload['cardOrNull']).toMatchObject({
      template: { templateId: system.templateId, origin: 'SYSTEM_DEFAULT_SENTIENT' },
    });
    const systemView = h.view(),
      alias = randomUUID();
    const systemRequest = enemyWorkflowRequestValue({
      ...forbidden,
      commandId: randomUUID(),
      expectedRevisions: {
        stateRevision: systemView.stateRevision,
        projectionRevision: systemView.projectionRevision,
        actorVisibilityRevision: systemView.actorVisibilityRevision,
      },
      payload: {
        campaignId: f.scope.campaignId,
        creationAttemptId: alias,
        expectedAttemptRevision: 0,
        attemptId: alias,
        monsterDraftId: alias,
        originFormId: 'ENM-012',
        returnFormId: 'ENM-012',
        versionBindingOrNull: null,
      },
    });
    const systemBytes = f.db.serialize();
    expect(() => h.app().command(systemRequest)).toThrow(
      'network application storage: INVALID_INPUT',
    );
    expect(f.db.serialize()).toEqual(systemBytes);
    expect(randomInt).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
}, 120_000);

it('refuses isolated skills and PNG source drift and a real active-GM-context revocation before the fresh seven-face operation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'symbiosis-monster-stat-source-'));
  const artPaths = [
    'generated/media/gm-entity-portraits/symbiosis_placeholder_monster.png',
    'generated/media/gm-entity-portraits/symbiosis_placeholder_sentient_enemy.png',
  ];
  try {
    for (const file of [...Object.keys(ENEMY_AUTHORING_SOURCE_SEALS), ...artPaths]) {
      const destination = join(directory, file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(process.cwd(), file), destination);
    }
    const isolatedCatalog = loadEnemyAuthoringSourceCatalog(directory, common),
      h = fixture('AUTO', isolatedCatalog),
      { f } = h;
    try {
      h.begin();
      h.open('ENM-012::CTA::005');
      const command = h.rollRequest();
      vi.mocked(randomInt).mockClear();
      for (const file of ['generated/spec/character/skills.json', artPaths[0]!]) {
        const filename = join(directory, file),
          original = readFileSync(filename),
          before = f.db.serialize();
        try {
          writeFileSync(filename, Buffer.concat([original, Buffer.from([10])]));
          expect(() => h.app().command(command)).toThrow(
            'network application storage: INVALID_INPUT',
          );
          expect(() => h.app().project()).toThrow('network application storage: CORRUPT_STORAGE');
          expect(f.db.serialize()).toEqual(before);
          expect(randomInt).not.toHaveBeenCalled();
        } finally {
          writeFileSync(filename, original);
        }
        expect(readFileSync(filename)).toEqual(original);
        expect(() => isolatedCatalog.assertCurrent()).not.toThrow();
        expect(() => isolatedCatalog.assertMonsterCurrent()).not.toThrow();
        expect(h.app().project().base.formId).toBe('ENM-018');
      }
      const masterProfileId = h.read().context.masterProfileId;
      let denied = 0;
      const authorized = createEnemyAuthoringApplication({
        database: f.db,
        scope: f.scope,
        catalog: isolatedCatalog,
        baseline,
        readCurrent: h.read,
        validateOwner: (owner) => {
          const active = readActiveLocalGmContext(f.db, f.scope.ownerDeviceId);
          if (
            active?.gmLocalContextId !== f.scope.gmLocalContextId ||
            active.masterProfileId !== masterProfileId ||
            owner.ownerDeviceId !== f.scope.ownerDeviceId ||
            owner.campaignId !== f.scope.campaignId ||
            owner.masterProfileId !== masterProfileId
          ) {
            denied++;
            return storage.fail('FOREIGN_OWNER');
          }
        },
      });
      expect(authorized.project().base.formId).toBe('ENM-018');
      createLocalGmContext(
        f.db,
        { ownerDeviceId: f.scope.ownerDeviceId, masterProfileId, gmLocalContextId: randomUUID() },
        () => undefined,
      );
      const revoked = f.db.serialize();
      expect(() => authorized.command(command)).toThrow(
        'network application storage: CORRUPT_STORAGE',
      );
      expect(denied).toBe(1);
      expect(f.db.serialize()).toEqual(revoked);
      expect(randomInt).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);

it('keeps a real Adviser card and knowledge unchanged while a low rolled version candidate views019, reopens and refuses acceptance-dependent commands', () => {
  const h = fixture('MANUAL'),
    { f } = h;
  try {
    h.begin();
    h.patch('MONSTER_STATS', edited);
    h.patch('MONSTER_PHYSICS', physics);
    h.patch('MONSTER_ATTACK', attack);
    const species = catalog.monster.symbionts.species.find((row) => row.speciesKey === 'ADVISER');
    if (species === undefined) throw new Error('No actual Adviser source');
    const preview = h.request('UI-CMD-ENEMY-DRAFT-PATCH', {
      stage: 'MONSTER_SYMBIONT',
      data: {
        operation: 'PREVIEW',
        selection: {
          mode: 'ORDINARY',
          symbiont: {
            speciesKey: species.speciesKey,
            targetLevel: 6,
            learnedNodeRefs: catalog.monster.development.nodes
              .filter((row) => row.speciesKey === species.speciesKey && row.level <= 6)
              .map((row) => row.nodeRef),
            binding: { kind: species.bindingPolicy },
          },
        },
      },
    });
    h.app().command(preview);
    h.patch('MONSTER_SYMBIONT', {
      operation: 'CONFIRM',
      previewCommandId: preview.commandId,
      manualFacesOrNull: [1, 12],
    });
    const initialSkills = [
      { skillKey: 'LEARNING', targetBonus: 7 },
      { skillKey: 'ACROBATICS', targetBonus: 1 },
    ];
    h.patch('MONSTER_SYMBIONT', {
      operation: 'FINISH',
      previewCommandId: preview.commandId,
      advisorSkills: initialSkills,
    });
    const original = h.view().enemyAuthoring?.attemptOrNull;
    if (original?.kind !== 'CUSTOM_MONSTER') throw new Error('No actual monster card');
    expect(original.advisorCards[0]?.initialSkillsOrNull).toEqual(initialSkills);
    expect(original.advisorCards[0]?.knownSkills).toEqual(initialSkills);
    const identity = enemyVersionIdentityValue(
      h.app().command(h.request('UI-CMD-ENEMY-COMMIT-V1')).receipt.result.committedVersionOrNull,
    );
    const oldRows = f.db.prepare('SELECT * FROM campaign_enemy_version ORDER BY rowid').all();
    h.nav('ENM-020::CTA::002');
    h.select(identity);
    h.nav('ENM-001::CTA::008');
    h.patch('VERSION_CONFIGURATION', {
      operation: 'SET_REASON',
      reason: 'Непринятый низкий черновик не забывает знания',
    });
    vi.mocked(randomInt).mockClear();
    h.open('ENM-017::CTA::006');
    const rolled = h.app().command(h.rollRequest()),
      receipt = monsterStatRollReceiptValue(rolled.receipt.result.randomStatsReceipt);
    expect(randomInt).toHaveBeenCalledTimes(7);
    const low = {
      baseStats: { ...edited.baseStats, D: 1 },
      massKg: edited.massKg,
      ageYears: edited.ageYears,
      baseMaxHP: edited.baseMaxHP,
    };
    h.open('ENM-017::CTA::007', low);
    const project = () => {
      const value = enemyAuthoringProjectionValue(h.app().project().base.roleFilteredPayload);
      if (value.kind !== 'CUSTOM_MONSTER_AUTHORING')
        throw new Error('No actual monster projection');
      return value;
    };
    expect(project().formId).toBe('ENM-019');
    expect(project().statGeneration?.randomReceiptOrNull).toEqual(receipt);
    expect(project().statGeneration?.candidateStats).toEqual(low);
    f.restartFromDisk();
    expect(project().statGeneration?.candidateStats).toEqual(low);
    h.nav('ENM-019::CTA::002');
    const pending = project();
    expect(pending.formId).toBe('ENM-017');
    expect(pending.validationErrors.length).toBeGreaterThan(0);
    expect(pending.sheetOrNull).toBeNull();
    expect(pending.advisorPreparationOrNull).toBeNull();
    expect(pending.context.attemptOrNull?.statsOrNull).toEqual(edited);
    expect(pending.context.attemptOrNull?.advisorCards).toEqual(original.advisorCards);
    const before = f.db.serialize();
    const reason = pending.context.versionAttempt?.reason;
    if (reason === undefined) throw new Error('No actual saved reason');
    expect(() => h.app().command(h.request('UI-CMD-ENEMY-NEW-VERSION', { reason }))).toThrow(
      'network application storage: INVALID_INPUT',
    );
    expect(() =>
      h.patch('MONSTER_SYMBIONT', { operation: 'PREVIEW', selection: { mode: 'NONE' } }),
    ).toThrow('network application storage: INVALID_INPUT');
    expect(f.db.serialize()).toEqual(before);
    expect(project().context.attemptOrNull?.advisorCards).toEqual(original.advisorCards);
    expect(randomInt).toHaveBeenCalledTimes(7);
    expect(f.db.prepare('SELECT * FROM campaign_enemy_version ORDER BY rowid').all()).toEqual(
      oldRows,
    );
  } finally {
    f.close();
  }
}, 180_000); // Finite scenario-only headroom: prior owning Adviser72s plus roll/reopen/projection work; no shared limit change or cohort guarantee.
