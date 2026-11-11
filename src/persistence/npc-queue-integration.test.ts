import { openLegacySchema19Database } from '../../tests/fixtures/legacy-schema-19.js';
import {
  openLegacySchema20Database,
  LEGACY_SCHEMA_20_MIGRATIONS,
} from '../../tests/fixtures/legacy-schema-20.js';
import { applyMigrations, applyMigrationSequence } from './migrations/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNpcCalendarContextInTransaction } from './campaign-admission-decision.js';
import { npcAttemptReadContext } from './npc-child-identities.js';
import {
  readNpcCampaignCheckpointLedgerInTransaction,
  verifyNpcCampaignCheckpointHistory,
} from './npc-campaign-checkpoints.js';
import { readHostedCurrentPausedCampaign } from './current-paused-campaign.js';
import { commitCampaignLobbyCommand, readCampaignLobby } from './campaign-lobby.js';
import { readCampaignAdmissionAvailability } from './campaign-admission-decision.js';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ActionKey } from '@generated/types/atlas.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { FormActionIntentV2Message } from '@shared/wire-v2-protocol.js';
import {
  NPC_NAV_TARGETS,
  npcTechnicalRequestValue,
  type NpcEditorReplaceRequest,
} from '@shared/npc-command.js';
import {
  applyNpcStageInput,
  createEmptyNpcEditorDraft,
  readNpcEditorDraft,
  readNpcStageInput,
} from '../domain/rules/npc-authoring/staged-input.js';
import { loadNpcAuthoringSourceCatalog } from '../host/npc-catalog.js';
import { configurePersistenceDatabase, openPersistenceDatabase } from './database.js';
import { bootstrapDeviceIdentity, loadDeviceId } from './device-identity.js';
import { loadCampaignCheckpoint } from './store.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import {
  appendNpcGmSourceInTransaction,
  commitCampaignCreation,
  commitCampaignDraftUpdate,
  createCampaignDraft,
  createLocalGmContext,
  ensureLocalGmProfile,
  navigateCampaignDraft,
  readActiveLocalGmContext,
  readCampaignCreationCursor,
  readCampaignDraft,
  readCampaignPrivateOwner,
  readGmRequestReviewViewStateInTransaction,
  readNpcGmSourceInTransaction,
  validateNpcHistoricalGmSourcesInTransaction,
  validateNpcPreparationInTransaction,
  type CampaignPrivateOwnerValidator,
  type RedactedCampaignDraftRequest,
} from './campaign-creation.js';
import {
  commitGmRequestReviewNavigation,
  readGmRequestReviewView,
} from './network-device-request.js';
import {
  saveNpcAttempt,
  saveNpcAttemptPrepared,
  readNpcRecoveryClosure,
  type NpcAttemptPreparationContext,
  type NpcAttemptPreparationSource,
  type NpcAttemptPreparer,
  type NpcPreparedAttempt,
  type NpcPreparationIntegration,
  type NpcBoundary,
  type NpcTransactionIntegration,
} from './npc-library-store.js';
import type {
  NpcAttempt,
  NpcDomainReaders,
  NpcHistoricalSourceReader,
  NpcRequestReader,
  NpcScope,
  NpcStage,
} from './npc-library-records.js';

const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
});
let catalog: Pick<
  Awaited<ReturnType<typeof loadNpcAuthoringSourceCatalog>>,
  'skills' | 'development'
>;
beforeAll(async () => {
  const source = await loadNpcAuthoringSourceCatalog(process.cwd());
  catalog = { skills: source.skills, development: source.development };
});
const json = (value: unknown): JsonObject => JSON.parse(s.canonical(value)) as JsonObject;
const absentVersion = (): never => {
  throw new Error(
    'Full NPC version mechanics deliberately unavailable in technical queue integration',
  );
};
const verifier = { fixtureVerifier: 'private campaign creation proof' };
const timestamp = '2026-11-06T00:00:00.000Z';

function navValue(value: unknown): FormActionIntentV2Message {
  const r = s.object(value, [
    'messageType',
    'protocolVersion',
    'navigationRequestId',
    'sourceFormId',
    'actionKey',
    'expectedProjectionRevision',
  ]);
  expect(r['messageType']).toBe('navigation.form-action');
  expect(r['protocolVersion']).toBe(2);
  const actionKey = s.text(r['actionKey']);
  expect(Object.hasOwn(NPC_NAV_TARGETS, actionKey)).toBe(true);
  expect(actionKey.split('::')[0]).toBe(r['sourceFormId']);
  s.text(r['navigationRequestId']);
  s.integer(r['expectedProjectionRevision']);
  return r as unknown as FormActionIntentV2Message;
}

/** Actual campaign birth and GM queue; no opaque replacement source/mirror tables. */
function fixture(
  restored?: { bytes: Buffer; scope: NpcScope; profileId: string },
  initialDatabase?: Database.Database,
) {
  const db =
    initialDatabase ??
    (restored === undefined ? openPersistenceDatabase(':memory:') : new Database(restored.bytes));
  databases.push(db);
  if (restored !== undefined) configurePersistenceDatabase(db);
  const ownerDeviceId = bootstrapDeviceIdentity(db),
    scope = restored?.scope ?? {
      ownerDeviceId,
      gmLocalContextId: randomUUID(),
      campaignId: randomUUID(),
    },
    profileId = restored?.profileId ?? randomUUID();
  const validateOwner: CampaignPrivateOwnerValidator = (owner) => {
    expect([
      owner.ownerDeviceId,
      owner.gmLocalContextId,
      owner.campaignId,
      owner.masterProfileId,
    ]).toEqual([scope.ownerDeviceId, scope.gmLocalContextId, scope.campaignId, profileId]);
    expect(owner.verifier).toEqual(verifier);
  };
  if (restored === undefined) {
    // Campaign validators are the existing persistence fixture boundary, not a claimed password/WS test.
    const trusted = () => {
      expect(loadDeviceId(db)).toBe(ownerDeviceId);
    };
    ensureLocalGmProfile(db, { ownerDeviceId, masterProfileId: profileId }, trusted);
    createLocalGmContext(
      db,
      { ownerDeviceId, masterProfileId: profileId, gmLocalContextId: scope.gmLocalContextId },
      trusted,
    );
    const campaignDraftId = randomUUID();
    createCampaignDraft(
      db,
      { gmLocalContextId: scope.gmLocalContextId, campaignDraftId, expectedRevisions: s.zero() },
      trusted,
    );
    for (const stage of [
      {
        form: 'CMP-001',
        variant: 'METADATA',
        values: { title: 'NPC queue fixture', description: null, art: null },
      },
      {
        form: 'CMP-002',
        variant: 'HOST',
        values: {
          activePlayerCapacity: 5,
          hostAddress: '127.0.0.1',
          hostPort: 30111,
          networkInterface: 'loopback',
        },
      },
      { form: 'CMP-003', variant: 'SECRET', values: { secretProvided: true } },
      { form: 'CMP-004', variant: 'MODE', values: { defaultFutureRollMode: 'AUTO' } },
    ] as const) {
      let draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
      if (draft.formId !== stage.form) {
        navigateCampaignDraft(
          db,
          {
            gmLocalContextId: scope.gmLocalContextId,
            campaignDraftId,
            expectedDraftRevision: draft.draftRevision,
            expectedRevisions: s.vectorOf(draft),
            sourceFormId: draft.formId,
            targetFormId: stage.form,
          },
          trusted,
        );
        draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
      }
      const request = {
        messageType: 'campaign.draft.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        scope: {
          gmLocalContextId: scope.gmLocalContextId,
          campaignDraftId,
          sourceFormId: draft.formId,
        },
        expectedDraftRevision: draft.draftRevision,
        expectedRevisions: s.vectorOf(draft),
        variant: stage.variant,
        values: stage.values,
      } as RedactedCampaignDraftRequest;
      commitCampaignDraftUpdate(
        db,
        {
          request,
          ...(stage.variant === 'SECRET'
            ? { secretUpdate: { kind: 'REPLACE' as const, preparedVerifier: verifier } }
            : {}),
        },
        trusted,
      );
    }
    let draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
    navigateCampaignDraft(
      db,
      {
        gmLocalContextId: scope.gmLocalContextId,
        campaignDraftId,
        expectedDraftRevision: draft.draftRevision,
        expectedRevisions: s.vectorOf(draft),
        sourceFormId: draft.formId,
        targetFormId: 'CMP-005',
      },
      trusted,
    );
    draft = readCampaignDraft(db, scope.gmLocalContextId, campaignDraftId);
    commitCampaignCreation(
      db,
      {
        campaignId: scope.campaignId,
        receiptId: randomUUID(),
        createdAt: timestamp,
        qrPayload: `http://127.0.0.1:30111/?campaignId=${scope.campaignId}`,
        baselineVersion: 'technical-queue-fixture',
        request: {
          messageType: 'command.request',
          protocolVersion: 1,
          commandKind: 'workflow-command',
          workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
          role: 'gm',
          commandId: randomUUID(),
          expectedRevisions: s.vectorOf(draft),
          payload: {
            stage: 'CAMPAIGN_CREATE',
            sourceFormId: 'CMP-005',
            gmLocalContextId: scope.gmLocalContextId,
            campaignDraftId,
            draftRevision: draft.draftRevision,
            preflightLeaseId: randomUUID(),
          },
        },
      },
      trusted,
    );
  }
  const view = () => readGmRequestReviewView(db, scope, validateOwner);
  const ordinaryNav = (actionKey: ActionKey) => {
    const current = view(),
      cursor = readCampaignCreationCursor(db, scope.gmLocalContextId);
    return commitGmRequestReviewNavigation(
      db,
      scope,
      {
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId: randomUUID(),
        sourceFormId: cursor.formId,
        actionKey,
        expectedProjectionRevision:
          current?.projectionRevision ?? cursor.revisions.projectionRevision,
      },
      validateOwner,
      (source) => {
        expect(source.scope).toEqual(scope);
      },
    );
  };
  if (restored === undefined) {
    ordinaryNav('CMP-006::CTA::001');
    ordinaryNav('CMP-007::CTA::004');
    ordinaryNav('GM-001::CTA::004');
  }
  const apply = (previous: JsonObject, stage: NpcStage, input: JsonObject) =>
    json(applyNpcStageInput(catalog, previous, stage, input));
  const readers: NpcDomainReaders & NpcRequestReader & NpcHistoricalSourceReader = {
    attempt(_stage, value) {
      return json(readNpcEditorDraft(catalog, value));
    },
    createReadContext(campaignId) {
      expect(campaignId).toBe(scope.campaignId);
      return readNpcCalendarContextInTransaction(db, scope, validateOwner, {
        verifyInitial: absentVersion,
        reduce: absentVersion,
        buildProposal: absentVersion,
      });
    },
    inspectStoredSnapshot: absentVersion,
    snapshot: absentVersion,
    requiredPreStartTime: absentVersion,
    publishedChildGraph: absentVersion,
    lifetimeFacts: absentVersion,
    validateVersion: absentVersion,
    validateAttemptOrigin(attempt, operation, base) {
      expect(operation.kind).toBe('CREATE');
      expect(base).toBeNull();
      expect(attempt.values).toEqual(json(createEmptyNpcEditorDraft()));
    },
    request(kind, value) {
      expect(['CREATE', 'REPLACE', 'CANCEL']).toContain(kind);
      const r = s.object(value);
      if (r['messageType'] === 'navigation.form-action') return json(navValue(value));
      const parsed = npcTechnicalRequestValue(value);
      expect(kind).toBe('REPLACE');
      expect(parsed.messageType).toBe('network.npc-editor.replace');
      return json(parsed);
    },
    technicalBinding(_kind, request) {
      if (request['messageType'] === 'navigation.form-action') {
        const r = navValue(request);
        return {
          kind: 'FORM_ACTION',
          navigationRequestId: r.navigationRequestId,
          sourceFormId: r.sourceFormId as NpcStage | 'NPC-001',
          expectedProjectionRevision: r.expectedProjectionRevision,
        };
      }
      const r = npcTechnicalRequestValue(request);
      if (r.messageType !== 'network.npc-editor.replace')
        throw new Error('Expected editor request');
      return {
        kind: 'DRAFT_REPLACE',
        operationId: r.operationId,
        campaignId: r.campaignId,
        npcDraftId: r.npcDraftId,
        expectedAttemptRevision: r.expectedAttemptRevision,
        expectedRevisions: r.expectedRevisions,
      };
    },
    validateHistoricalGmSources(entries) {
      validateNpcHistoricalGmSourcesInTransaction(db, entries, apply);
    },
  };
  const integration: NpcTransactionIntegration = {
    readCheckedGmSource(boundary) {
      return readNpcGmSourceInTransaction(db, boundary.scope);
    },
    validate(boundary, checkpoint) {
      expect(db.inTransaction).toBe(true);
      expect(boundary.scope).toEqual(scope);
      expect(checkpoint.campaignId).toBe(scope.campaignId);
      expect(readActiveLocalGmContext(db, scope.ownerDeviceId)?.gmLocalContextId).toBe(
        scope.gmLocalContextId,
      );
      validateOwner(readCampaignPrivateOwner(db, scope.gmLocalContextId, scope.campaignId));
    },
    writeGmMirror(operation) {
      appendNpcGmSourceInTransaction(db, scope, operation);
    },
  };
  const action = (actionKey: keyof typeof NPC_NAV_TARGETS): FormActionIntentV2Message => {
    const current = view();
    if (current === null) throw new Error('Expected actual GM queue');
    return {
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId: current.formId,
      actionKey,
      expectedProjectionRevision: current.projectionRevision,
    };
  };
  const boundary = (
    kind: 'CREATE' | 'REPLACE' | 'CANCEL',
    request: FormActionIntentV2Message | NpcEditorReplaceRequest,
    previous: NpcAttempt | null,
  ): NpcBoundary => ({
    scope,
    kind,
    operationId:
      request.messageType === 'navigation.form-action'
        ? request.navigationRequestId
        : request.operationId,
    request: json(request),
    expectedAttemptRevisionOrNull: previous?.revision ?? null,
    expectedCurrentVersionOrNull: null,
  });
  const save = (b: NpcBoundary, attempt: NpcAttempt, selectedIntegration = integration) =>
    saveNpcAttempt(db, b, attempt, randomUUID(), timestamp, readers, selectedIntegration);
  const create = () => {
    const attempt: NpcAttempt = {
      scope,
      npcDraftId: randomUUID(),
      candidateNpcUuid: randomUUID(),
      revision: 0,
      mode: 'CREATE_V1',
      targetOrNull: null,
      stage: 'NPC-002',
      status: 'OPEN',
      values: json(createEmptyNpcEditorDraft()),
    };
    const b = boundary('CREATE', action('NPC-001::CTA::001'), null),
      result = save(b, attempt);
    return { attempt, boundary: b, result };
  };
  const replace = (previous: NpcAttempt, values: JsonObject) => {
    const current = view();
    if (current === null) throw new Error('Missing GM view');
    const request: NpcEditorReplaceRequest = {
      messageType: 'network.npc-editor.replace',
      protocolVersion: 3,
      operationId: randomUUID(),
      campaignId: scope.campaignId,
      sourceFormId: previous.stage,
      expectedRevisions: s.vectorOf(current),
      npcDraftId: previous.npcDraftId,
      expectedAttemptRevision: previous.revision,
      values,
    };
    return {
      boundary: boundary('REPLACE', request, previous),
      attempt: {
        ...previous,
        revision: previous.revision + 1,
        values: apply(previous.values, previous.stage, values),
      },
    };
  };
  const navigate = (
    previous: NpcAttempt,
    actionKey: keyof typeof NPC_NAV_TARGETS,
    stage: NpcStage,
  ) => {
    const b = boundary('REPLACE', action(actionKey), previous),
      attempt = { ...previous, revision: previous.revision + 1, stage };
    const result = save(b, attempt);
    return { boundary: b, attempt, result };
  };
  return {
    db,
    scope,
    profileId,
    readers,
    integration,
    action,
    boundary,
    save,
    create,
    replace,
    navigate,
    ordinaryNav,
    view,
  };
}

describe('technical NPC attempt and actual GM queue transaction integration', () => {
  it('upgrades a populated legacy-v1 schema19 campaign, NPC/QUEUE history and exact receipts to20 without rewriting old bytes, then reopens the file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'enemy-library-migration-'));
    try {
      const path = join(directory, 'legacy.sqlite'),
        f = fixture(undefined, openLegacySchema19Database(path));
      expect(f.db.prepare('SELECT MAX(version) AS version FROM schema_migration').get()).toEqual({
        version: 19,
      });
      const created = f.create(),
        input = readNpcEditorDraft(catalog, created.attempt.values).identity;
      const edit = f.replace(
        created.attempt,
        json({ ...input, name: { kind: 'ENTERED', value: 'Legacy19 NPC' } }),
      );
      const edited = f.save(edit.boundary, edit.attempt);
      const tables = (
        f.db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migration' ORDER BY name",
          )
          .all() as { name: string }[]
      ).map((x) => x.name);
      const rows = (db: Database.Database) =>
        Object.fromEntries(
          tables.map((table) => [
            table,
            db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(),
          ]),
        );
      const before = rows(f.db),
        registry = f.db.prepare('SELECT * FROM schema_migration ORDER BY version').all();
      const source = readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers),
        viewBefore = f.view();
      expect(applyMigrationSequence(f.db, LEGACY_SCHEMA_20_MIGRATIONS)).toBe(20);
      expect(rows(f.db)).toEqual(before);
      expect(
        f.db.prepare('SELECT * FROM schema_migration WHERE version<=19 ORDER BY version').all(),
      ).toEqual(registry);
      expect(f.db.pragma('foreign_key_check')).toEqual([]);
      const bytes = f.db.serialize();
      f.db.close();
      const reopened = fixture(
        { bytes, scope: f.scope, profileId: f.profileId },
        openLegacySchema20Database(path),
      );
      expect(readNpcRecoveryClosure(reopened.db, f.scope.campaignId, reopened.readers)).toEqual(
        source,
      );
      expect(reopened.view()).toEqual(viewBefore);
      expect(rows(reopened.db)).toEqual(before);
      const current = reopened.db.serialize();
      expect(reopened.save(edit.boundary, edit.attempt)).toEqual({
        operation: edited.operation,
        replayed: true,
      });
      expect(reopened.db.serialize().equals(current)).toBe(true);
      expect(reopened.db.pragma('foreign_key_check')).toEqual([]);
      reopened.db.close();
    } finally {
      for (const db of databases) if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('upgrades populated legacy-v1 schema20 NPC/QUEUE histories and original receipts to21 without old-row writes, then reopens SQLite and exactly replays', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sentient-enemy-migration-'));
    try {
      const path = join(directory, 'legacy20.sqlite'),
        f = fixture(undefined, openLegacySchema20Database(path));
      expect(f.db.prepare('SELECT MAX(version) version FROM schema_migration').get()).toEqual({
        version: 20,
      });
      const birth = f.db.prepare('SELECT payload_json FROM campaign').get() as {
        payload_json: string;
      };
      expect(JSON.parse(birth.payload_json)).toMatchObject({ schemaVersion: 1 });
      expect(JSON.parse(birth.payload_json)).not.toHaveProperty('defaultSentientCatalogVersion');
      const created = f.create(),
        input = readNpcEditorDraft(catalog, created.attempt.values).identity;
      const edit = f.replace(
          created.attempt,
          json({ ...input, name: { kind: 'ENTERED', value: 'Legacy20 NPC' } }),
        ),
        edited = f.save(edit.boundary, edit.attempt);
      const tables = (
        f.db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migration' ORDER BY name",
          )
          .all() as { name: string }[]
      ).map((row) => row.name);
      const rows = (db: Database.Database) =>
        Object.fromEntries(
          tables.map((table) => [
            table,
            db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(),
          ]),
        );
      const before = rows(f.db),
        registry = f.db.prepare('SELECT * FROM schema_migration ORDER BY version').all(),
        source = readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers),
        view = f.view();
      expect(applyMigrations(f.db)).toBe(21);
      expect(rows(f.db)).toEqual(before);
      expect(
        f.db.prepare('SELECT * FROM schema_migration WHERE version<=20 ORDER BY version').all(),
      ).toEqual(registry);
      expect(f.db.pragma('foreign_key_check')).toEqual([]);
      for (const table of [
        'campaign_enemy_template',
        'campaign_enemy_version',
        'campaign_enemy_history',
        'campaign_enemy_current_version',
      ])
        expect(f.db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
      const bytes = f.db.serialize();
      f.db.close();
      const reopened = fixture(
        { bytes, scope: f.scope, profileId: f.profileId },
        openPersistenceDatabase(path),
      );
      expect(readNpcRecoveryClosure(reopened.db, f.scope.campaignId, reopened.readers)).toEqual(
        source,
      );
      expect(reopened.view()).toEqual(view);
      expect(rows(reopened.db)).toEqual(before);
      const stable = reopened.db.serialize();
      expect(reopened.save(edit.boundary, edit.attempt)).toEqual({
        operation: edited.operation,
        replayed: true,
      });
      expect(reopened.db.serialize()).toEqual(stable);
      expect(reopened.db.pragma('foreign_key_check')).toEqual([]);
      expect(reopened.db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      reopened.db.close();
    } finally {
      for (const db of databases) if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('passes detached plain technical values to the actual closed stage reader', () => {
    const name = { kind: 'ENTERED', value: 'Before caller mutation' };
    const values = { ...createEmptyNpcEditorDraft().identity, name };
    const request = {
      messageType: 'network.npc-editor.replace',
      protocolVersion: 3,
      operationId: randomUUID(),
      campaignId: randomUUID(),
      expectedRevisions: s.zero(),
      sourceFormId: 'NPC-002',
      npcDraftId: randomUUID(),
      expectedAttemptRevision: 0,
      values,
    };
    const parsed = npcTechnicalRequestValue(request);
    if (parsed.messageType !== 'network.npc-editor.replace') throw new Error('Expected editor');
    expect(Object.getPrototypeOf(parsed.values)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(parsed.values['name'])).toBe(Object.prototype);
    expect(parsed.values).not.toBe(values);
    expect(parsed.values['name']).not.toBe(name);
    name.value = 'After caller mutation';
    expect(readNpcStageInput(catalog, 'NPC-002', parsed.values).name).toEqual({
      kind: 'ENTERED',
      value: 'Before caller mutation',
    });
    for (const invalid of [null, [], 42, 'text'])
      expect(() => npcTechnicalRequestValue({ ...request, values: invalid })).toThrow();
  });

  it('keeps actual CREATE, partial edit, back navigation and CANCEL mirrors across replay and SQLite reopen', () => {
    const f = fixture(),
      initialCheckpoint = loadCampaignCheckpoint(f.db, f.scope.campaignId);
    const created = f.create();
    expect(f.view()?.formId).toBe('NPC-002');
    const draft = readNpcEditorDraft(catalog, created.attempt.values);
    const edit = f.replace(
      created.attempt,
      json({
        ...draft.identity,
        name: { kind: 'ENTERED', value: 'Remembered NPC' },
        massKg: { kind: 'ENTERED', value: -0.5 },
      }),
    );
    const edited = f.save(edit.boundary, edit.attempt);
    const forward = f.navigate(edit.attempt, 'NPC-002::CTA::001', 'NPC-011');
    const back = f.navigate(forward.attempt, 'NPC-011::CTA::002', 'NPC-002');
    const cancel = f.boundary('CANCEL', f.action('NPC-002::CTA::003'), back.attempt);
    f.save(cancel, { ...back.attempt, revision: back.attempt.revision + 1, status: 'CANCELLED' });
    expect(f.view()?.formId).toBe('NPC-001');
    expect(f.view()?.npc?.attemptOrNull).toBeNull();
    const closure = readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers);
    expect(closure.attempts).toHaveLength(5);
    expect(closure.operations).toHaveLength(5);
    expect(closure.versions).toEqual([]);
    expect(closure.blocks).toEqual([]);
    expect(closure.anchorOrNull).toBeNull();
    expect(closure.reservations).toHaveLength(1);
    expect(
      readNpcEditorDraft(catalog, closure.attempts[4]?.attempt.values).identity.massKg,
    ).toEqual({ kind: 'ENTERED', value: -0.5 });
    expect(loadCampaignCheckpoint(f.db, f.scope.campaignId)).toEqual(initialCheckpoint);
    expect(f.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual([]);
    expect(f.db.prepare('SELECT * FROM npc_current_head').all()).toEqual([]);
    expect(
      f.db.prepare("SELECT * FROM gm_request_queue_event WHERE kind='NPC_SOURCE'").all(),
    ).toHaveLength(5);
    const bytes = f.db.serialize();
    expect(f.save(created.boundary, created.attempt)).toEqual({
      operation: created.result.operation,
      replayed: true,
    });
    expect(f.db.serialize().equals(bytes)).toBe(true);
    const restarted = fixture({ bytes, scope: f.scope, profileId: f.profileId });
    expect(readNpcRecoveryClosure(restarted.db, f.scope.campaignId, restarted.readers)).toEqual(
      closure,
    );
    expect(restarted.view()).toEqual(f.view());
    const restartedBytes = restarted.db.serialize();
    expect(restarted.save(edit.boundary, edit.attempt)).toEqual({
      operation: edited.operation,
      replayed: true,
    });
    expect(restarted.db.serialize().equals(restartedBytes)).toBe(true);
  });

  it.each(['stale-attempt', 'stale-view', 'foreign-owner', 'changed-replay'] as const)(
    'refuses %s without changing any campaign, NPC or queue bytes',
    (fault) => {
      const f = fixture(),
        created = f.create(),
        current = readNpcEditorDraft(catalog, created.attempt.values);
      const edit = f.replace(created.attempt, json(current.identity));
      let b = edit.boundary;
      if (fault === 'stale-attempt') b = { ...b, expectedAttemptRevisionOrNull: 1 };
      else if (fault === 'stale-view')
        b = { ...b, request: { ...b.request, expectedRevisions: json(s.zero()) } };
      else if (fault === 'foreign-owner')
        b = { ...b, scope: { ...b.scope, ownerDeviceId: randomUUID() } };
      else
        b = {
          ...created.boundary,
          request: { ...created.boundary.request, actionKey: 'NPC-001::CTA::003' },
        };
      const before = f.db.serialize();
      expect(() => f.save(b, edit.attempt)).toThrow();
      expect(f.db.inTransaction).toBe(false);
      expect(f.db.serialize().equals(before)).toBe(true);
    },
  );

  it.each(['queue-trigger', 'missing-mirror'] as const)(
    'rolls back technical rows and reservations when %s interrupts the shared transaction',
    (fault) => {
      const f = fixture();
      if (fault === 'queue-trigger')
        f.db.exec(
          "CREATE TEMP TRIGGER interrupt_npc_queue BEFORE INSERT ON gm_request_queue_event WHEN NEW.kind='NPC_SOURCE' BEGIN SELECT RAISE(ABORT,'interrupted NPC mirror'); END",
        );
      const attempt: NpcAttempt = {
        scope: f.scope,
        npcDraftId: randomUUID(),
        candidateNpcUuid: randomUUID(),
        revision: 0,
        mode: 'CREATE_V1',
        targetOrNull: null,
        stage: 'NPC-002',
        status: 'OPEN',
        values: json(createEmptyNpcEditorDraft()),
      };
      const b = f.boundary('CREATE', f.action('NPC-001::CTA::001'), null),
        bytes = f.db.serialize();
      const integration =
        fault === 'missing-mirror'
          ? { ...f.integration, writeGmMirror: () => undefined }
          : f.integration;
      expect(() => f.save(b, attempt, integration)).toThrow();
      expect(f.db.inTransaction).toBe(false);
      expect(f.db.serialize().equals(bytes)).toBe(true);
      expect(readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers).operations).toEqual([]);
    },
  );

  it('refuses unpaired primitive history after a confirmed CREATE instead of reading an opaque source substitute', () => {
    const f = fixture();
    f.create();
    f.db.prepare("DELETE FROM gm_request_queue_event WHERE kind='NPC_SOURCE'").run();
    const damaged = f.db.serialize();
    expect(() => readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers)).toThrow();
    expect(() =>
      f.db.transaction(() => readGmRequestReviewViewStateInTransaction(f.db, f.scope)).immediate(),
    ).toThrow();
    expect(f.db.serialize().equals(damaged)).toBe(true);
  });
});

describe('NPC aggregate history ancestry before a supported full version exists', () => {
  it('reads actual technical attempts through header and authoritative history without a version fallback', () => {
    const f = fixture(),
      checkpoint = loadCampaignCheckpoint(f.db, f.scope.campaignId);
    const validate: CampaignPrivateOwnerValidator = (owner) => {
      expect(owner.verifier).toEqual(verifier);
    };
    const originalHeader = readHostedCurrentPausedCampaign(f.db, f.scope.campaignId, validate);
    f.create();
    const bytes = f.db.serialize();
    const ledger = f.db
      .transaction(() => readNpcCampaignCheckpointLedgerInTransaction(f.db, f.scope.campaignId))
      .deferred();
    expect(ledger.operations).toHaveLength(1);
    expect(ledger.commits).toEqual([]);
    expect(ledger.anchorOrNull).toBeNull();
    verifyNpcCampaignCheckpointHistory(ledger, new Map([[0, checkpoint]]), checkpoint);
    expect(readHostedCurrentPausedCampaign(f.db, f.scope.campaignId, validate)).toEqual(
      originalHeader,
    );
    expect(
      readCampaignAdmissionAvailability(f.db, f.scope, validate, {
        verifyInitial: absentVersion,
        reduce: absentVersion,
        buildProposal: absentVersion,
        npc: f.readers,
      }),
    ).toMatchObject({ campaignRevision: 0, activePcCount: 0, occupiedCampaignPlaceCount: 0 });
    expect(f.db.serialize().equals(bytes)).toBe(true);
    const restored = fixture({ bytes, scope: f.scope, profileId: f.profileId });
    expect(
      restored.db
        .transaction(() =>
          readNpcCampaignCheckpointLedgerInTransaction(restored.db, f.scope.campaignId),
        )
        .deferred(),
    ).toEqual(ledger);
    expect(readHostedCurrentPausedCampaign(restored.db, f.scope.campaignId, validate)).toEqual(
      originalHeader,
    );
  });

  it('refuses a checksum-valid technical receipt pointing at a checkpoint outside actual history', () => {
    const f = fixture(),
      created = f.create(),
      checkpoint = loadCampaignCheckpoint(f.db, f.scope.campaignId);
    const operation = {
      ...created.result.operation,
      beforeCheckpoint: { ...checkpoint, stateRevision: 1 },
      afterCheckpoint: { ...checkpoint, stateRevision: 1 },
    };
    const text = s.canonical(operation);
    f.db
      .prepare('UPDATE npc_operation SET record_json=?,record_sha256=? WHERE operation_id=?')
      .run(text, s.sha(text), operation.operationId);
    const bytes = f.db.serialize();
    const ledger = f.db
      .transaction(() => readNpcCampaignCheckpointLedgerInTransaction(f.db, f.scope.campaignId))
      .deferred();
    expect(() =>
      verifyNpcCampaignCheckpointHistory(ledger, new Map([[0, checkpoint]]), checkpoint),
    ).toThrow();
    expect(f.db.serialize().equals(bytes)).toBe(true);
  });

  it.each([
    'attempt-head',
    'reservation',
    'orphan-block',
    'orphan-art',
    'identity-collision',
  ] as const)(
    'refuses %s instead of treating an absent aggregate anchor as an empty NPC journal',
    (fault) => {
      const f = fixture();
      f.create();
      if (fault === 'attempt-head')
        f.db.prepare('UPDATE npc_attempt_head SET record_sha256=?').run('0'.repeat(64));
      else if (fault === 'reservation') f.db.exec('DELETE FROM npc_identity_reservation');
      else if (fault === 'identity-collision') {
        const raw = f.db.prepare('SELECT record_json FROM npc_operation').get() as {
          record_json: string;
        };
        const value = s.object(JSON.parse(raw.record_json) as unknown);
        const draft = f.db.prepare('SELECT draft_id FROM npc_attempt_head').get() as {
          draft_id: string;
        };
        const text = s.canonical({ ...value, receiptId: draft.draft_id });
        f.db
          .prepare('UPDATE npc_operation SET record_json=?,record_sha256=?,receipt_id=?')
          .run(text, s.sha(text), draft.draft_id);
      } else if (fault === 'orphan-block') {
        const block = {
          format: 'NPC_LIBRARY_RECOVERY_V1',
          campaignId: f.scope.campaignId,
          libraryRevision: 1,
          checkpointId: randomUUID(),
          versions: [],
          heads: [],
          artSha256s: [],
          initialTimeLockOrNull: null,
        };
        const text = s.canonical(block);
        f.db
          .prepare('INSERT INTO npc_library_checkpoint VALUES (?,?,?,?,?)')
          .run(f.scope.campaignId, 1, block.checkpointId, text, s.sha(text));
      } else {
        const content = Buffer.from('orphan bytes'),
          sha256 = s.sha(content.toString());
        const art = { mediaType: 'image/png', sha256, bytesBase64: content.toString('base64') },
          text = s.canonical(art);
        f.db
          .prepare('INSERT INTO npc_art VALUES (?,?,?,?)')
          .run(f.scope.campaignId, sha256, text, s.sha(text));
      }
      const bytes = f.db.serialize();
      expect(() =>
        f.db
          .transaction(() => readNpcCampaignCheckpointLedgerInTransaction(f.db, f.scope.campaignId))
          .deferred(),
      ).toThrow();
      expect(f.db.serialize().equals(bytes)).toBe(true);
    },
  );
});

function preparedIntegration(f: ReturnType<typeof fixture>): NpcPreparationIntegration {
  return {
    ...f.integration,
    validatePreparation(context) {
      validateNpcPreparationInTransaction(f.db, context);
    },
  };
}
function freshPrepared(context: NpcAttemptPreparationContext): NpcPreparedAttempt {
  expect(context.source.kind).toBe('CREATE');
  expect(context.previousOrNull).toBeNull();
  expect(context.baseVersionOrNull).toBeNull();
  return {
    next: {
      scope: context.boundary.scope,
      npcDraftId: randomUUID(),
      candidateNpcUuid: randomUUID(),
      revision: 0,
      mode: 'CREATE_V1',
      targetOrNull: null,
      stage: 'NPC-002',
      status: 'OPEN',
      values: json(createEmptyNpcEditorDraft()),
    },
    receiptId: randomUUID(),
    committedAt: timestamp,
  };
}

describe('lazy NPC preparation behind actual current GM queue and replay guards', () => {
  it('allocates only on fresh CREATE/edit and retains the original receipt on replay and SQLite reopen', () => {
    const f = fixture(),
      b = f.boundary('CREATE', f.action('NPC-001::CTA::001'), null);
    let calls = 0;
    let created: NpcPreparedAttempt | undefined;
    const result = saveNpcAttemptPrepared(
      f.db,
      b,
      { kind: 'CREATE' },
      (context) => {
        calls++;
        expect(Object.isFrozen(context)).toBe(true);
        expect(Object.isFrozen(context.boundary.scope)).toBe(true);
        expect(context.beforeGmSource.sourceFormId).toBe('NPC-001');
        return (created = freshPrepared(context));
      },
      f.readers,
      preparedIntegration(f),
    );
    if (created === undefined) throw new Error('Missing prepared attempt');
    expect(calls).toBe(1);
    expect(result.replayed).toBe(false);
    expect(f.view()?.npc?.attemptOrNull?.candidateNpcUuid).toBe(created.next.candidateNpcUuid);
    const edit = f.replace(
      created.next,
      json({
        ...createEmptyNpcEditorDraft().identity,
        name: { kind: 'ENTERED', value: 'Prepared once' },
      }),
    );
    const edited = saveNpcAttemptPrepared(
      f.db,
      edit.boundary,
      { kind: 'EXISTING', npcDraftId: created.next.npcDraftId },
      (context) => {
        calls++;
        expect(context.previousOrNull?.attempt).toEqual(created?.next);
        expect(Object.isFrozen(context.previousOrNull?.attempt.values)).toBe(true);
        return { next: edit.attempt, receiptId: randomUUID(), committedAt: timestamp };
      },
      f.readers,
      preparedIntegration(f),
    );
    expect(calls).toBe(2);
    const closure = readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers);
    expect(closure.reservations).toHaveLength(1);
    expect(closure.operations).toHaveLength(2);
    expect(closure.versions).toEqual([]);
    const bytes = f.db.serialize(),
      restored = fixture({ bytes, scope: f.scope, profileId: f.profileId });
    const poisoned = Object.defineProperty({}, 'kind', {
      enumerable: true,
      get() {
        throw new Error('Replay must not inspect factory source');
      },
    }) as NpcAttemptPreparationSource;
    const noFactory: NpcAttemptPreparer = () => {
      calls++;
      throw new Error('Repeated preparation');
    };
    for (const target of [f, restored]) {
      const before = target.db.serialize();
      expect(
        saveNpcAttemptPrepared(
          target.db,
          b,
          poisoned,
          noFactory,
          target.readers,
          preparedIntegration(target),
        ),
      ).toEqual({ operation: result.operation, replayed: true });
      expect(
        saveNpcAttemptPrepared(
          target.db,
          edit.boundary,
          poisoned,
          noFactory,
          target.readers,
          preparedIntegration(target),
        ),
      ).toEqual({ operation: edited.operation, replayed: true });
      expect(target.db.serialize().equals(before)).toBe(true);
    }
    expect(calls).toBe(2);
    expect(readNpcRecoveryClosure(restored.db, f.scope.campaignId, restored.readers)).toEqual(
      closure,
    );
  });

  it.each([
    'stale-attempt',
    'stale-view',
    'foreign-owner',
    'changed-replay',
    'missing-attempt',
    'wrong-request-draft',
    'wrong-current-stage',
    'occupied-create',
  ] as const)('does not enter preparation for %s and preserves every database byte', (fault) => {
    const f = fixture(),
      created = f.create();
    const edit = f.replace(created.attempt, json(createEmptyNpcEditorDraft().identity));
    let b = edit.boundary;
    let source: NpcAttemptPreparationSource = {
      kind: 'EXISTING',
      npcDraftId: created.attempt.npcDraftId,
    };
    if (fault === 'stale-attempt') b = { ...b, expectedAttemptRevisionOrNull: 1 };
    else if (fault === 'stale-view')
      b = { ...b, request: { ...b.request, expectedRevisions: json(s.zero()) } };
    else if (fault === 'foreign-owner')
      b = { ...b, scope: { ...b.scope, ownerDeviceId: randomUUID() } };
    else if (fault === 'changed-replay')
      b = {
        ...created.boundary,
        request: { ...created.boundary.request, actionKey: 'NPC-001::CTA::003' },
      };
    else if (fault === 'missing-attempt') source = { kind: 'EXISTING', npcDraftId: randomUUID() };
    else if (fault === 'wrong-request-draft')
      b = { ...b, request: { ...b.request, npcDraftId: randomUUID() } };
    else if (fault === 'wrong-current-stage') {
      const next = f.navigate(created.attempt, 'NPC-002::CTA::001', 'NPC-011');
      const current = f.view();
      if (current === null) throw new Error('Missing queue');
      b = {
        ...b,
        expectedAttemptRevisionOrNull: next.attempt.revision,
        request: {
          ...b.request,
          expectedAttemptRevision: next.attempt.revision,
          expectedRevisions: json(s.vectorOf(current)),
        },
      };
    } else if (fault === 'occupied-create') {
      source = { kind: 'CREATE' };
      b = f.boundary('CREATE', { ...f.action('NPC-001::CTA::001'), sourceFormId: 'NPC-001' }, null);
    }
    let calls = 0;
    const before = f.db.serialize();
    expect(() =>
      saveNpcAttemptPrepared(
        f.db,
        b,
        source,
        () => {
          calls++;
          return { next: edit.attempt, receiptId: randomUUID(), committedAt: timestamp };
        },
        f.readers,
        preparedIntegration(f),
      ),
    ).toThrow();
    expect(calls).toBe(0);
    expect(f.db.inTransaction).toBe(false);
    expect(f.db.serialize().equals(before)).toBe(true);
  });

  it('refuses the cancelled previous attempt while another actual attempt is selected', () => {
    const f = fixture(),
      old = f.create();
    const cancel = f.boundary('CANCEL', f.action('NPC-002::CTA::003'), old.attempt);
    f.save(cancel, { ...old.attempt, revision: 1, status: 'CANCELLED' });
    const current = f.create();
    expect(f.view()?.npc?.attemptOrNull?.npcDraftId).toBe(current.attempt.npcDraftId);
    const edit = f.replace(
      { ...old.attempt, revision: 1 },
      json(createEmptyNpcEditorDraft().identity),
    );
    let calls = 0;
    const bytes = f.db.serialize();
    expect(() =>
      saveNpcAttemptPrepared(
        f.db,
        edit.boundary,
        { kind: 'EXISTING', npcDraftId: old.attempt.npcDraftId },
        () => {
          calls++;
          throw new Error('Wrong current attempt');
        },
        f.readers,
        preparedIntegration(f),
      ),
    ).toThrow();
    expect(calls).toBe(0);
    expect(f.db.serialize().equals(bytes)).toBe(true);
  });

  it('refuses preparation while NET-016 owns the exact suspended initial-time child', () => {
    const f = fixture();
    let a = f.create().attempt;
    for (const [actionKey, stage] of [
      ['NPC-002::CTA::001', 'NPC-011'],
      ['NPC-011::CTA::001', 'NPC-012'],
      ['NPC-012::CTA::001', 'NPC-013'],
      ['NPC-013::CTA::001', 'NPC-014'],
      ['NPC-014::CTA::001', 'NPC-015'],
      ['NPC-015::CTA::001', 'NPC-016'],
      ['NPC-016::CTA::004', 'NPC-016'],
    ] as const)
      a = f.navigate(a, actionKey, stage).attempt;
    expect(f.view()?.formId).toBe('NET-016');
    expect(f.view()?.npc?.initialTimeReturnContextOrNull?.npcDraftId).toBe(a.npcDraftId);
    const edit = f.replace(
      a,
      json({ input: readNpcEditorDraft(catalog, a.values).initialState, currentOeChanges: [] }),
    );
    let calls = 0;
    const bytes = f.db.serialize();
    expect(() =>
      saveNpcAttemptPrepared(
        f.db,
        edit.boundary,
        { kind: 'EXISTING', npcDraftId: a.npcDraftId },
        () => {
          calls++;
          throw new Error('Suspended');
        },
        f.readers,
        preparedIntegration(f),
      ),
    ).toThrow();
    expect(calls).toBe(0);
    expect(f.db.serialize().equals(bytes)).toBe(true);
  });

  it.each(['queue-trigger', 'missing-mirror', 'prepare-write', 'preflight-write'] as const)(
    'rolls back actual shared rows/reservation after %s',
    (fault) => {
      const f = fixture();
      if (fault === 'queue-trigger')
        f.db.exec(
          "CREATE TEMP TRIGGER lazy_queue_failure BEFORE INSERT ON gm_request_queue_event WHEN NEW.kind='NPC_SOURCE' BEGIN SELECT RAISE(ABORT,'lazy queue fault'); END",
        );
      const b = f.boundary('CREATE', f.action('NPC-001::CTA::001'), null);
      let calls = 0;
      const integration: NpcPreparationIntegration = {
        ...preparedIntegration(f),
        ...(fault === 'missing-mirror' ? { writeGmMirror: () => undefined } : {}),
        ...(fault === 'preflight-write'
          ? {
              validatePreparation(context: NpcAttemptPreparationContext) {
                validateNpcPreparationInTransaction(f.db, context);
                f.db
                  .prepare(
                    "UPDATE campaign SET payload_json=json_set(payload_json,'$.lazyGuardProbe',?)",
                  )
                  .run('Unexpected preflight write');
              },
            }
          : {}),
      };
      const bytes = f.db.serialize();
      expect(() =>
        saveNpcAttemptPrepared(
          f.db,
          b,
          { kind: 'CREATE' },
          (context) => {
            calls++;
            if (fault === 'prepare-write')
              f.db
                .prepare(
                  "UPDATE campaign SET payload_json=json_set(payload_json,'$.lazyGuardProbe',?)",
                )
                .run('Unexpected factory write');
            return freshPrepared(context);
          },
          f.readers,
          integration,
        ),
      ).toThrow();
      expect(calls).toBe(fault === 'preflight-write' ? 0 : 1);
      expect(f.db.inTransaction).toBe(false);
      expect(f.db.serialize().equals(bytes)).toBe(true);
      expect(readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers).operations).toEqual([]);
      expect(f.db.prepare('SELECT * FROM npc_identity_reservation').all()).toEqual([]);
    },
  );

  it.each([
    'source-getter',
    'source-extra',
    'source-symbol',
    'source-nonenumerable',
    'source-unknown',
    'validator-getter',
    'validator-missing',
  ] as const)('rejects %s without executing hostile accessors or preparation', (fault) => {
    const f = fixture(),
      b = f.boundary('CREATE', f.action('NPC-001::CTA::001'), null);
    let reads = 0,
      calls = 0;
    const source: Record<string | symbol, unknown> = { kind: 'CREATE' };
    const integration: NpcPreparationIntegration = preparedIntegration(f);
    if (fault === 'source-getter')
      Object.defineProperty(source, 'kind', {
        enumerable: true,
        get() {
          reads++;
          return 'CREATE';
        },
      });
    else if (fault === 'source-extra') source['authority'] = 'gm';
    else if (fault === 'source-symbol') source[Symbol('authority')] = true;
    else if (fault === 'source-nonenumerable')
      Object.defineProperty(source, 'hidden', { value: true });
    else if (fault === 'source-unknown') source['kind'] = 'EXISTING_OR_CREATE';
    else if (fault === 'validator-getter')
      Object.defineProperty(integration, 'validatePreparation', {
        get() {
          reads++;
          return () => undefined;
        },
      });
    else Reflect.deleteProperty(integration, 'validatePreparation');
    const bytes = f.db.serialize();
    expect(() =>
      saveNpcAttemptPrepared(
        f.db,
        b,
        source as NpcAttemptPreparationSource,
        (context) => {
          calls++;
          return freshPrepared(context);
        },
        f.readers,
        integration,
      ),
    ).toThrow();
    expect([reads, calls]).toEqual([0, 0]);
    expect(f.db.serialize().equals(bytes)).toBe(true);
  });

  it.each([
    'factory',
    'bound-factory',
    'validator',
    'bound-validator',
    'tagged-bound-factory',
    'tagged-bound-validator',
  ] as const)(
    'refuses native async %s before its body and subsequent microtask can write',
    async (fault) => {
      const f = fixture(),
        b = f.boundary('CREATE', f.action('NPC-001::CTA::001'), null);
      let entered = 0,
        late = 0,
        tagReads = 0;
      const asyncCallback = async () => {
        entered++;
        await Promise.resolve();
        late++;
        f.db
          .prepare("UPDATE campaign SET payload_json=json_set(payload_json,'$.lazyGuardProbe',?)")
          .run('Must never run');
        throw new Error('Async preparation was entered');
      };
      const callback = fault.includes('bound') ? asyncCallback.bind(null) : asyncCallback;
      if (fault.startsWith('tagged'))
        Object.defineProperty(callback, Symbol.toStringTag, {
          get() {
            tagReads++;
            return 'Function';
          },
        });
      const integration = preparedIntegration(f);
      if (fault.endsWith('validator'))
        Object.defineProperty(integration, 'validatePreparation', { value: callback });
      const prepare = fault.endsWith('factory')
        ? (callback as unknown as NpcAttemptPreparer)
        : freshPrepared;
      const bytes = f.db.serialize();
      expect(() =>
        saveNpcAttemptPrepared(f.db, b, { kind: 'CREATE' }, prepare, f.readers, integration),
      ).toThrow();
      await Promise.resolve();
      expect([entered, late, tagReads]).toEqual([0, 0, 0]);
      expect(f.db.serialize().equals(bytes)).toBe(true);
    },
  );

  it.each([
    'then-getter',
    'output-getter',
    'nested-getter',
    'context-mutation',
    'foreign-result',
    'receipt-collision',
  ] as const)(
    'rejects %s after one factory entry without executing output code or committing',
    (fault) => {
      const f = fixture(),
        b = f.boundary('CREATE', f.action('NPC-001::CTA::001'), null);
      let calls = 0,
        reads = 0;
      const bytes = f.db.serialize();
      const prepare: NpcAttemptPreparer = (context) => {
        calls++;
        const result = freshPrepared(context);
        if (fault === 'then-getter')
          return Object.defineProperty({}, 'then', {
            enumerable: true,
            get() {
              reads++;
              return () => undefined;
            },
          }) as NpcPreparedAttempt;
        if (fault === 'output-getter')
          return Object.defineProperty(result, 'receiptId', {
            enumerable: true,
            get() {
              reads++;
              return randomUUID();
            },
          });
        if (fault === 'nested-getter')
          return {
            ...result,
            next: Object.defineProperty({ ...result.next }, 'scope', {
              enumerable: true,
              get() {
                reads++;
                return f.scope;
              },
            }),
          };
        if (fault === 'context-mutation')
          Object.defineProperty(context.boundary.scope, 'ownerDeviceId', { value: randomUUID() });
        if (fault === 'foreign-result')
          return {
            ...result,
            next: { ...result.next, scope: { ...f.scope, ownerDeviceId: randomUUID() } },
          };
        if (fault === 'receipt-collision') return { ...result, receiptId: result.next.npcDraftId };
        return result;
      };
      expect(() =>
        saveNpcAttemptPrepared(
          f.db,
          b,
          { kind: 'CREATE' },
          prepare,
          f.readers,
          preparedIntegration(f),
        ),
      ).toThrow();
      expect([calls, reads]).toEqual([1, 0]);
      expect(f.db.serialize().equals(bytes)).toBe(true);
    },
  );
});

/** Zero-PC is intentional: callback entry distinguishes the NPC child fence from normal Start preflight. */
describe('actual NPC initial-time child versus ordinary lobby command entry', () => {
  it('blocks fresh child Start before its guard but retains TIME, replay and the exact safe return path', () => {
    const f = fixture();
    const validate: CampaignPrivateOwnerValidator = (owner) => {
      expect([
        owner.ownerDeviceId,
        owner.gmLocalContextId,
        owner.campaignId,
        owner.masterProfileId,
      ]).toEqual([
        f.scope.ownerDeviceId,
        f.scope.gmLocalContextId,
        f.scope.campaignId,
        f.profileId,
      ]);
      expect(owner.verifier).toEqual(verifier);
    };
    const rules = {
      verifyInitial: absentVersion,
      reduce: absentVersion,
      buildProposal: absentVersion,
      npc: f.readers,
    };
    const authority = {
      kind: 'GM' as const,
      ownerDeviceId: f.scope.ownerDeviceId,
      gmLocalContextId: f.scope.gmLocalContextId,
    };
    let attempt = f.create().attempt;
    // This fixture proves technical navigation/binding only; no complete mechanical NPC is invented.
    for (const [key, stage] of [
      ['NPC-002::CTA::001', 'NPC-011'],
      ['NPC-011::CTA::001', 'NPC-012'],
      ['NPC-012::CTA::001', 'NPC-013'],
      ['NPC-013::CTA::001', 'NPC-014'],
      ['NPC-014::CTA::001', 'NPC-015'],
      ['NPC-015::CTA::001', 'NPC-016'],
      ['NPC-016::CTA::004', 'NPC-016'],
    ] as const)
      attempt = f.navigate(attempt, key, stage).attempt;
    const bound = f.view()?.npc?.initialTimeReturnContextOrNull;
    expect(bound).toEqual({
      campaignId: f.scope.campaignId,
      npcDraftId: attempt.npcDraftId,
      attemptRevision: attempt.revision,
      editMode: 'CREATE_V1',
      versionBindingOrNull: null,
      returnFormId: 'NPC-016',
    });
    const freshStart = (expectedCalls: number) => {
      const lobby = readCampaignLobby(f.db, f.scope, validate, rules);
      expect(lobby.preflight).toBe('ZERO_ACTIVE_PLAYERS');
      const request = {
        workflowCommandId: 'UI-CMD-CAMPAIGN-START' as const,
        commandId: randomUUID(),
        campaignId: f.scope.campaignId,
        expectedLobbySnapshotRevision: lobby.lobbySnapshotRevision,
        expectedReadinessRevision: lobby.readinessRevision,
      };
      let guardCalls = 0;
      const before = f.db.serialize();
      expect(() =>
        commitCampaignLobbyCommand(
          f.db,
          f.scope,
          authority,
          request,
          {
            receiptId: randomUUID(),
            committedAt: timestamp,
            sceneIdOrNull: randomUUID(),
            checkpointIdOrNull: randomUUID(),
          },
          validate,
          rules,
          () => {
            guardCalls++;
          },
        ),
      ).toThrow();
      expect(guardCalls).toBe(expectedCalls);
      expect(f.db.serialize().equals(before)).toBe(true);
      expect(f.db.inTransaction).toBe(false);
      expect(f.db.prepare('SELECT * FROM campaign_peace_scene').all()).toEqual([]);
    };
    freshStart(0);
    const beforeTime = readCampaignLobby(f.db, f.scope, validate, rules);
    const request = {
      workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET' as const,
      commandId: randomUUID(),
      campaignId: f.scope.campaignId,
      expectedLobbySnapshotRevision: beforeTime.lobbySnapshotRevision,
      dayNumber: 1,
      hour: 0,
      minute: 7,
    };
    const allocations = {
      receiptId: randomUUID(),
      committedAt: timestamp,
      sceneIdOrNull: null,
      checkpointIdOrNull: null,
    };
    const confirmed = commitCampaignLobbyCommand(
      f.db,
      f.scope,
      authority,
      request,
      allocations,
      validate,
      rules,
      () => undefined,
    );
    expect(confirmed).toMatchObject({
      replayed: false,
      receipt: {
        workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
        initialCampaignTime: { dayNumber: 1, hour: 0, minute: 7, campaignTimestamp: 7 },
      },
    });
    expect(f.view()?.npc?.initialTimeReturnContextOrNull).toEqual(bound);
    expect(
      readCampaignLobby(f.db, f.scope, validate, rules).initialCampaignTimeOrNull
        ?.campaignTimestamp,
    ).toBe(7);
    f.ordinaryNav('NET-016::CTA::001');
    expect(f.view()?.formId).toBe('CMP-007');
    expect(f.view()?.npc?.initialTimeReturnContextOrNull).toEqual(bound);
    f.ordinaryNav('CMP-007::CTA::001');
    expect(f.view()?.formId).toBe('NET-016');
    freshStart(0);
    f.ordinaryNav('NET-016::CTA::005');
    expect(f.view()?.formId).toBe('NPC-016');
    expect(f.view()?.npc?.initialTimeReturnContextOrNull).toBeNull();
    expect(f.view()?.npc?.attemptOrNull).toMatchObject({
      npcDraftId: attempt.npcDraftId,
      revision: attempt.revision,
      stage: 'NPC-016',
    });
    for (const [key, stage] of [
      ['NPC-016::CTA::002', 'NPC-015'],
      ['NPC-015::CTA::002', 'NPC-014'],
      ['NPC-014::CTA::002', 'NPC-013'],
      ['NPC-013::CTA::002', 'NPC-012'],
      ['NPC-012::CTA::002', 'NPC-011'],
      ['NPC-011::CTA::002', 'NPC-002'],
    ] as const)
      attempt = f.navigate(attempt, key, stage).attempt;
    f.save(f.boundary('CANCEL', f.action('NPC-002::CTA::003'), attempt), {
      ...attempt,
      revision: attempt.revision + 1,
      status: 'CANCELLED',
    });
    f.ordinaryNav('NPC-001::CTA::003');
    f.ordinaryNav('GM-001::CTA::013');
    f.ordinaryNav('CMP-007::CTA::001');
    expect(f.view()?.npc?.initialTimeReturnContextOrNull).toBeNull();
    expect(f.view()?.npc?.attemptOrNull).toBeNull();
    // Same real campaign and zero PCs: ordinary NET016 reaches the guard, then existing zero-PC preflight refuses.
    freshStart(1);
    const bytes = f.db.serialize();
    expect(
      commitCampaignLobbyCommand(
        f.db,
        f.scope,
        authority,
        request,
        { ...allocations, receiptId: randomUUID() },
        validate,
        rules,
        () => undefined,
      ),
    ).toEqual({ receipt: confirmed.receipt, replayed: true });
    expect(f.db.serialize().equals(bytes)).toBe(true);
    const closure = readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers);
    expect(closure.versions).toEqual([]);
    expect(closure.blocks).toEqual([]);
    expect(closure.anchorOrNull).toBeNull();
  });
});

describe('one-read NPC historical GM batch boundary', () => {
  const entries = (h: ReturnType<typeof fixture>) => {
    const closure = readNpcRecoveryClosure(h.db, h.scope.campaignId, h.readers);
    const previous = new Map<string, (typeof closure.attempts)[number]>();
    return closure.attempts.map((event) => {
      const operation = closure.operations.find((o) => o.operationId === event.operationId);
      if (operation === undefined) throw new Error('Missing exact source operation');
      const prior = previous.get(event.attempt.npcDraftId) ?? null;
      const item = {
        operation,
        event,
        previous: prior,
        readContext: npcAttemptReadContext(
          event.attempt,
          event.operationId,
          closure.children,
          null,
        ),
        previousReadContextOrNull:
          prior === null
            ? null
            : npcAttemptReadContext(prior.attempt, prior.operationId, closure.children, null),
      };
      previous.set(event.attempt.npcDraftId, event);
      return item;
    });
  };
  const apply = (previous: JsonObject, stage: NpcStage, input: JsonObject) =>
    json(applyNpcStageInput(catalog, previous, stage, input));
  it('rechecks the actual QUEUE when called twice inside one transaction', () => {
    const h = fixture();
    h.create();
    const proof = entries(h),
      before = h.db.serialize();
    expect(() =>
      h.db
        .transaction(() => {
          validateNpcHistoricalGmSourcesInTransaction(h.db, proof, apply);
          h.db.prepare('UPDATE gm_request_queue_view SET record_sha256=?').run('0'.repeat(64));
          expect(() => validateNpcHistoricalGmSourcesInTransaction(h.db, proof, apply)).toThrow();
          throw new Error('ROLLBACK_BETWEEN_READS');
        })
        .immediate(),
    ).toThrow('ROLLBACK_BETWEEN_READS');
    expect(h.db.serialize().equals(before)).toBe(true);
  });
  it('does not reuse a campaign proof for a different exact owner scope', () => {
    const h = fixture();
    h.create();
    const proof = entries(h),
      before = h.db.serialize();
    const first = proof[0];
    if (first === undefined) throw new Error('Missing entry');
    const forged = {
      ...first,
      operation: {
        ...first.operation,
        scope: { ...first.operation.scope, gmLocalContextId: randomUUID() },
      },
    };
    expect(() =>
      h.db
        .transaction(() =>
          validateNpcHistoricalGmSourcesInTransaction(h.db, [first, forged], apply),
        )
        .deferred(),
    ).toThrow();
    expect(h.db.serialize().equals(before)).toBe(true);
  });
  it.each(['ASYNC', 'BOUND_ASYNC', 'PROMISE', 'DML', 'SOURCE_MUTATION'] as const)(
    'refuses %s in the required batch callback with exact rollback',
    (mode) => {
      const h = fixture();
      h.create();
      const before = h.db.serialize();
      let invoked = 0;
      const asyncReader = async () => {
        invoked += 1;
        await Promise.resolve();
      };
      const candidate: unknown =
        mode === 'ASYNC'
          ? asyncReader
          : mode === 'BOUND_ASYNC'
            ? asyncReader.bind(null)
            : (values: Parameters<NpcHistoricalSourceReader['validateHistoricalGmSources']>[0]) => {
                invoked += 1;
                if (mode === 'PROMISE') return Promise.resolve();
                if (mode === 'DML')
                  h.db
                    .prepare('UPDATE campaign_private_owner SET record_sha256=?')
                    .run('0'.repeat(64));
                if (mode === 'SOURCE_MUTATION')
                  Object.defineProperty(values[0]!.operation, 'committedAt', {
                    value: 'changed',
                    enumerable: true,
                  });
                return undefined;
              };
      expect(() =>
        readNpcRecoveryClosure(h.db, h.scope.campaignId, {
          ...h.readers,
          validateHistoricalGmSources:
            candidate as NpcHistoricalSourceReader['validateHistoricalGmSources'],
        }),
      ).toThrow();
      expect(h.db.serialize().equals(before)).toBe(true);
      expect(invoked).toBe(mode === 'ASYNC' || mode === 'BOUND_ASYNC' ? 0 : 1);
    },
  );
});

describe('phase zero NPC calendar evidence before any domain version', () => {
  it('distinguishes two confirmed times at the same campaign revision by exact GM prefix and survives restart', () => {
    const f = fixture();
    const validate: CampaignPrivateOwnerValidator = (owner) => {
      expect([
        owner.ownerDeviceId,
        owner.gmLocalContextId,
        owner.campaignId,
        owner.masterProfileId,
      ]).toEqual([
        f.scope.ownerDeviceId,
        f.scope.gmLocalContextId,
        f.scope.campaignId,
        f.profileId,
      ]);
      expect(owner.verifier).toEqual(verifier);
    };
    const rules = {
      verifyInitial: absentVersion,
      reduce: absentVersion,
      buildProposal: absentVersion,
      npc: f.readers,
    };
    let attempt = f.create().attempt;
    const createId = readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers).operations[0]!
      .operationId;
    for (const [key, stage] of [
      ['NPC-002::CTA::001', 'NPC-011'],
      ['NPC-011::CTA::001', 'NPC-012'],
      ['NPC-012::CTA::001', 'NPC-013'],
      ['NPC-013::CTA::001', 'NPC-014'],
      ['NPC-014::CTA::001', 'NPC-015'],
      ['NPC-015::CTA::001', 'NPC-016'],
    ] as const)
      attempt = f.navigate(attempt, key, stage).attempt;
    const time = (minute: number) => {
      attempt = f.navigate(attempt, 'NPC-016::CTA::004', 'NPC-016').attempt;
      const lobby = readCampaignLobby(f.db, f.scope, validate, rules);
      const request = {
        workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET' as const,
        commandId: randomUUID(),
        campaignId: f.scope.campaignId,
        expectedLobbySnapshotRevision: lobby.lobbySnapshotRevision,
        dayNumber: 1,
        hour: 0,
        minute,
      };
      const result = commitCampaignLobbyCommand(
        f.db,
        f.scope,
        {
          kind: 'GM',
          ownerDeviceId: f.scope.ownerDeviceId,
          gmLocalContextId: f.scope.gmLocalContextId,
        },
        request,
        {
          receiptId: randomUUID(),
          committedAt: timestamp,
          sceneIdOrNull: null,
          checkpointIdOrNull: null,
        },
        validate,
        rules,
        () => undefined,
      );
      expect(result.replayed).toBe(false);
      f.ordinaryNav('NET-016::CTA::005');
      // A real following NPC transition records the source prefix after this TIME receipt.
      const saved = f.navigate(attempt, 'NPC-016::CTA::002', 'NPC-015');
      attempt = saved.attempt;
      const operationId = saved.result.operation.operationId;
      attempt = f.navigate(attempt, 'NPC-015::CTA::001', 'NPC-016').attempt;
      return { operationId, commandId: request.commandId };
    };
    const first = time(7),
      before = readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers);
    const original = before.calendarContext;
    expect(original).not.toBeNull();
    expect(original?.currentClock.campaignTimestampOrNull).toBe(7);
    expect(Object.isFrozen(original)).toBe(true);
    expect(Object.isFrozen(original?.operations)).toBe(true);
    const second = time(11),
      after = readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers);
    const context = after.calendarContext;
    expect(context?.checkpoint).toEqual(original?.checkpoint);
    expect(context?.currentClock.campaignTimestampOrNull).toBe(11);
    expect(original?.currentClock.campaignTimestampOrNull).toBe(7);
    expect(
      context?.operations.find((o) => o.operationId === createId)?.clock.campaignTimestampOrNull,
    ).toBeNull();
    for (const [saved, minute] of [
      [first, 7],
      [second, 11],
    ] as const) {
      const proof = context?.operations.find((o) => o.operationId === saved.operationId);
      expect(proof?.clock).toMatchObject({
        phase: 'PRE_START',
        campaignTimestampOrNull: minute,
        sourceOrNull: { kind: 'INITIAL_TIME', commandId: saved.commandId },
      });
      const operation = after.operations.find((o) => o.operationId === saved.operationId)!;
      expect(proof?.operationSha256).toBe(s.sha(s.canonical(operation)));
      expect(proof?.beforeGmSource).toEqual(operation.beforeGmSource);
      expect(proof?.beforeCheckpointSha256).toBe(s.sha(s.canonical(operation.beforeCheckpoint)));
    }
    expect(after.blocks).toEqual([]);
    expect(after.versions).toEqual([]);
    const bytes = f.db.serialize(),
      restored = fixture({ bytes, scope: f.scope, profileId: f.profileId });
    expect(
      readNpcRecoveryClosure(restored.db, restored.scope.campaignId, restored.readers)
        .calendarContext,
    ).toEqual(context);
    expect(restored.db.serialize().equals(bytes)).toBe(true);
  });
  it.each(['missing', 'promise', 'write', 'foreign', 'checkpoint', 'omitted proof'] as const)(
    'refuses %s phase zero evidence without retaining a write',
    (fault) => {
      const f = fixture();
      f.create();
      const original = f.readers.createReadContext;
      const before = f.db.serialize();
      const create =
        fault === 'missing'
          ? undefined
          : fault === 'promise'
            ? () => Promise.resolve(null)
            : (campaignId: string) => {
                const context = original(campaignId);
                if (context === null) throw new Error('Actual campaign proof is required');
                if (fault === 'write') {
                  f.db.prepare('UPDATE schema_migration SET name=name WHERE version=15').run();
                  return context;
                }
                if (fault === 'foreign')
                  return { ...context, scope: { ...context.scope, campaignId: randomUUID() } };
                if (fault === 'checkpoint')
                  return {
                    ...context,
                    checkpoint: {
                      ...context.checkpoint,
                      stateRevision: context.checkpoint.stateRevision + 1,
                    },
                  };
                return { ...context, operations: [] };
              };
      Object.defineProperty(f.readers, 'createReadContext', { value: create });
      expect(() => readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers)).toThrow();
      expect(f.db.serialize().equals(before)).toBe(true);
      expect(f.db.inTransaction).toBe(false);
    },
  );
});
