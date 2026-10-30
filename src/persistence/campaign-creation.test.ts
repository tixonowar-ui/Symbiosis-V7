import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampaignDraftFormId, CampaignCreateRequest } from '../shared/campaign-creation.js';
import type { JsonObject } from '../shared/wire-protocol.js';
import { openPersistenceDatabase } from './database.js';
import { bootstrapDeviceIdentity, resetDeviceIdentity } from './device-identity.js';
import { loadCampaignCheckpoint } from './store.js';
import { CAMPAIGN_CREATION_TABLES } from './migrations/0007-campaign-creation.js';
import {
  campaignCreationHash,
  readGmRequestReviewViewStateInTransaction,
  appendGmRequestReviewEventInTransaction,
  type GmRequestReviewDraftRequest,
  ensureLocalGmProfile,
  readLocalGmProfile,
  createLocalGmContext,
  readLocalGmContext,
  readActiveLocalGmContext,
  readCampaignCreationLibraryState,
  readPausedCampaign,
  createCampaignDraft,
  readCampaignDraft,
  readCampaignCreationCursor,
  commitCampaignDraftUpdate,
  navigateCampaignDraft,
  cancelCampaignDraft,
  readCampaignDraftUpdate,
  readCampaignDraftCancellation,
  commitCampaignCreation,
  readCampaignCreationCommand,
  readCampaignPrivateOwner,
  readCampaignCreationOrigin,
  readHostedCampaignCreationOrigin,
  type StoredCampaignDraft,
  type RedactedCampaignDraftRequest,
  type CampaignSecretUpdate,
  type CampaignDraftCancelInput,
  type CampaignSourceValidator,
} from './campaign-creation.js';

const databases: Database.Database[] = [];
const dirs: string[] = [];
const open = (path = ':memory:') => {
  const db = openPersistenceDatabase(path);
  databases.push(db);
  return db;
};
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const allow = () => undefined;
const triple = (draft: StoredCampaignDraft) => ({
  stateRevision: draft.stateRevision,
  projectionRevision: draft.projectionRevision,
  actorVisibilityRevision: draft.actorVisibilityRevision,
});
const proofA: JsonObject = { opaqueKdf: 'fixture', salt: 'A', verifier: 'private-verifier-A' };
const proofB: JsonObject = { opaqueKdf: 'fixture', salt: 'B', verifier: 'private-verifier-B' };
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en')))
      : item,
  );
function setup(path = ':memory:') {
  const db = open(path);
  const device = bootstrapDeviceIdentity(db);
  const profile = ensureLocalGmProfile(
    db,
    { ownerDeviceId: device, masterProfileId: 'profile' },
    allow,
  );
  createLocalGmContext(
    db,
    {
      gmLocalContextId: 'context',
      masterProfileId: profile.masterProfileId,
      ownerDeviceId: device,
    },
    allow,
  );
  createCampaignDraft(
    db,
    { gmLocalContextId: 'context', campaignDraftId: 'draft', expectedRevisions: zero },
    allow,
  );
  return { db, device };
}
function current(db: Database.Database) {
  return readCampaignDraft(db, 'context', 'draft');
}
function request(
  db: Database.Database,
  id: string,
  variant: 'METADATA' | 'HOST' | 'SECRET' | 'MODE',
  values: JsonObject,
): RedactedCampaignDraftRequest {
  const draft = current(db);
  return {
    messageType: 'campaign.draft.replace',
    protocolVersion: 3,
    draftUpdateId: id,
    expectedDraftRevision: draft.draftRevision,
    expectedRevisions: triple(draft),
    scope: { gmLocalContextId: 'context', campaignDraftId: 'draft', sourceFormId: draft.formId },
    variant,
    values,
  } as RedactedCampaignDraftRequest;
}
function update(
  db: Database.Database,
  id: string,
  variant: 'METADATA' | 'HOST' | 'SECRET' | 'MODE',
  values: JsonObject,
  secretUpdate?: CampaignSecretUpdate,
) {
  const req = request(db, id, variant, values);
  return commitCampaignDraftUpdate(
    db,
    { request: req, ...(secretUpdate === undefined ? {} : { secretUpdate }) },
    allow,
  );
}
function nav(db: Database.Database, targetFormId: CampaignDraftFormId) {
  const draft = current(db);
  return navigateCampaignDraft(
    db,
    {
      gmLocalContextId: 'context',
      campaignDraftId: 'draft',
      expectedDraftRevision: draft.draftRevision,
      expectedRevisions: triple(draft),
      sourceFormId: draft.formId,
      targetFormId,
    },
    allow,
  );
}
function ready(db: Database.Database) {
  update(db, 'metadata', 'METADATA', {
    title: 'Test campaign',
    description: 'Description',
    art: null,
  });
  nav(db, 'CMP-002');
  update(db, 'host', 'HOST', {
    activePlayerCapacity: 5,
    hostAddress: '127.0.0.1',
    hostPort: 31770,
    networkInterface: 'loopback',
  });
  nav(db, 'CMP-003');
  update(
    db,
    'secret-A',
    'SECRET',
    { secretProvided: true },
    { kind: 'REPLACE', preparedVerifier: proofA },
  );
  nav(db, 'CMP-004');
  update(db, 'mode', 'MODE', { defaultFutureRollMode: 'AUTO' });
  nav(db, 'CMP-005');
  return current(db);
}
function creationInput(db: Database.Database) {
  const draft = current(db);
  const request: CampaignCreateRequest = {
    messageType: 'command.request',
    protocolVersion: 1,
    commandId: 'create',
    commandKind: 'workflow-command',
    workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
    role: 'gm',
    expectedRevisions: triple(draft),
    payload: {
      stage: 'CAMPAIGN_CREATE',
      sourceFormId: 'CMP-005',
      gmLocalContextId: 'context',
      campaignDraftId: 'draft',
      draftRevision: draft.draftRevision,
      preflightLeaseId: 'lease',
    },
  };
  return {
    request,
    campaignId: 'campaign',
    receiptId: 'receipt',
    createdAt: '2026-10-30T10:00:00.000Z',
    qrPayload: 'http://127.0.0.1:31770/?campaignId=campaign',
    baselineVersion: 'baseline',
  };
}
function cancellation(db: Database.Database): CampaignDraftCancelInput {
  const draft = current(db);
  return {
    cancelRequestId: 'cancel',
    gmLocalContextId: 'context',
    campaignDraftId: 'draft',
    expectedDraftRevision: draft.draftRevision,
    expectedRevisions: triple(draft),
    sourceFormId: 'CMP-001',
  };
}
function snapshot(db: Database.Database) {
  return Object.fromEntries(
    [...CAMPAIGN_CREATION_TABLES, 'campaign', 'campaign_checkpoint', 'campaign_character_copy'].map(
      (table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()],
    ),
  );
}
function fileSetup() {
  const dir = mkdtempSync(join(tmpdir(), 'symbiosis-campaign-create-'));
  dirs.push(dir);
  const path = join(dir, 'store.sqlite');
  return { ...setup(path), path };
}

describe('device-owned campaign draft aggregate', () => {
  it('reads exact immutable CREATE origin without returning the private credential', () => {
    const { db, device } = setup();
    ready(db);
    const input = creationInput(db);
    const command = commitCampaignCreation(db, input, allow);
    const before = snapshot(db);
    const validate = vi.fn((owner) => {
      expect(db.inTransaction).toBe(true);
      expect(owner).toMatchObject({
        campaignId: 'campaign',
        ownerDeviceId: device,
        verifier: proofA,
      });
    });
    const origin = readCampaignCreationOrigin(db, 'context', 'campaign', validate);
    expect(origin).toEqual({ payload: readPausedCampaign(db, 'context', 'campaign'), command });
    expect(readHostedCampaignCreationOrigin(db, 'campaign', validate)).toEqual(origin);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(origin)).not.toMatch(/private-verifier|opaqueKdf|verifierSha256|"salt"/u);
    expect(snapshot(db)).toEqual(before);
  });

  it('keeps an exact checksummed active context pointer, rejects corruption and does not rebind after reset', () => {
    const p = setup();
    expect(readActiveLocalGmContext(p.db, p.device)?.gmLocalContextId).toBe('context');
    expect(readCampaignCreationLibraryState(p.db, 'context')).toEqual({
      draftCount: 1,
      pausedCampaignCount: 0,
    });
    createLocalGmContext(
      p.db,
      { gmLocalContextId: 'active-second', masterProfileId: 'profile', ownerDeviceId: p.device },
      allow,
    );
    expect(readActiveLocalGmContext(p.db, p.device)?.gmLocalContextId).toBe('active-second');
    expect(readCampaignCreationCursor(p.db, 'context').targetId).toBe('draft');
    p.db.prepare('UPDATE local_gm_active_context SET context_id=?').run('context');
    expect(() => readActiveLocalGmContext(p.db, p.device)).toThrow('CORRUPT_STORAGE');
    resetDeviceIdentity(p.db, allow);
    const next = bootstrapDeviceIdentity(p.db);
    expect(readActiveLocalGmContext(p.db, next)).toBeNull();
    expect(() => readActiveLocalGmContext(p.db, p.device)).toThrow('FOREIGN_OWNER');
  });
  it('rolls back a new context and cursor when its active-pointer write fails', () => {
    const p = setup();
    const before = snapshot(p.db);
    p.db.exec(
      "CREATE TRIGGER reject_active BEFORE INSERT ON local_gm_active_context BEGIN SELECT RAISE(ABORT,'active pointer failed'); END",
    );
    expect(() =>
      createLocalGmContext(
        p.db,
        {
          gmLocalContextId: 'rollback-context',
          masterProfileId: 'profile',
          ownerDeviceId: p.device,
        },
        allow,
      ),
    ).toThrow('active pointer failed');
    expect(snapshot(p.db)).toEqual(before);
  });
  it('keeps source MENU and target draft revisions separate and restores the exact cursor among two contexts', () => {
    const p = fileSetup();
    expect(readLocalGmContext(p.db, 'context')).toMatchObject({
      stateRevision: 0,
      projectionRevision: 1,
      actorVisibilityRevision: 0,
    });
    expect(current(p.db)).toMatchObject({
      ...zero,
      draftRevision: 0,
      status: 'DRAFT',
      currentVerifier: null,
    });
    createLocalGmContext(
      p.db,
      { gmLocalContextId: 'second', masterProfileId: 'profile', ownerDeviceId: p.device },
      allow,
    );
    createCampaignDraft(
      p.db,
      { gmLocalContextId: 'second', campaignDraftId: 'other', expectedRevisions: zero },
      allow,
    );
    update(p.db, 'title', 'METADATA', { title: 'Only first', description: null, art: null });
    const expected = readCampaignCreationCursor(p.db, 'context');
    p.db.close();
    const db = open(p.path);
    expect(readCampaignCreationCursor(db, 'context')).toEqual(expected);
    expect(readCampaignCreationCursor(db, 'second')).toMatchObject({
      targetId: 'other',
      revisions: zero,
    });
    expect(readLocalGmProfile(db, p.device)).toMatchObject({
      masterProfileId: 'profile',
      masterAuthorityRevision: 0,
    });
  });
  it('never rebinds an old profile/context after device reset', () => {
    const p = setup();
    const before = snapshot(p.db);
    resetDeviceIdentity(p.db, allow);
    const next = bootstrapDeviceIdentity(p.db);
    expect(next).not.toEqual(p.device);
    expect(() => readLocalGmProfile(p.db, p.device)).toThrow('FOREIGN_OWNER');
    expect(() => readLocalGmContext(p.db, 'context')).toThrow('FOREIGN_OWNER');
    expect(readLocalGmProfile(p.db, next)).toBeNull();
    ensureLocalGmProfile(p.db, { masterProfileId: 'new-profile', ownerDeviceId: next }, allow);
    expect(snapshot(p.db)['campaign_draft']).toEqual(before['campaign_draft']);
  });
  it('records canonical no-ops with zero revisions, data changes once, and navigation only P+1', () => {
    const { db } = setup();
    const noop = update(db, 'noop', 'METADATA', { title: null, description: null, art: null });
    expect(noop.update.event).toEqual({
      changed: false,
      appliedDraftRevision: 0,
      appliedRevisions: zero,
    });
    const changed = update(db, 'changed', 'METADATA', {
      title: 'Campaign',
      description: null,
      art: null,
    });
    expect(changed.update.event).toEqual({
      changed: true,
      appliedDraftRevision: 1,
      appliedRevisions: { ...zero, stateRevision: 1, projectionRevision: 1 },
    });
    expect(nav(db, 'CMP-002')).toMatchObject({
      draftRevision: 1,
      stateRevision: 1,
      projectionRevision: 2,
    });
    const before = snapshot(db);
    const replay = commitCampaignDraftUpdate(db, { request: changed.update.request }, allow);
    expect(replay.kind).toBe('REPLAYED');
    expect(replay.update.event).toEqual(changed.update.event);
    expect(replay.currentDraft.formId).toBe('CMP-002');
    expect(snapshot(db)).toEqual(before);
  });
  it('rejects stale, foreign, changed same-ID and wrong-step writes without modifying any row', () => {
    const { db } = setup();
    const stale = request(db, 'stale', 'METADATA', { title: 'Old', description: null, art: null });
    const result = update(db, 'first', 'METADATA', {
      title: 'Current',
      description: null,
      art: null,
    });
    const before = snapshot(db);
    const bad = [
      stale,
      { ...result.update.request, values: { title: 'Changed', description: null, art: null } },
      { ...stale, scope: { ...stale.scope, gmLocalContextId: 'absent' } },
      {
        ...stale,
        draftUpdateId: 'wrong',
        variant: 'HOST',
        values: {
          activePlayerCapacity: 2,
          hostAddress: null,
          hostPort: null,
          networkInterface: null,
        },
      },
    ];
    for (const req of bad)
      expect(() =>
        commitCampaignDraftUpdate(db, { request: req as RedactedCampaignDraftRequest }, allow),
      ).toThrow();
    expect(snapshot(db)).toEqual(before);
    expect(() =>
      navigateCampaignDraft(
        db,
        {
          gmLocalContextId: 'context',
          campaignDraftId: 'draft',
          expectedDraftRevision: 1,
          expectedRevisions: triple(current(db)),
          sourceFormId: 'CMP-001',
          targetFormId: 'CMP-005',
        },
        allow,
      ),
    ).toThrow();
    expect(snapshot(db)).toEqual(before);
  });
  it.each(['context', 'draft', 'cursor'] as const)(
    'rejects checksum corruption of %s without a fallback lookup',
    (kind) => {
      const { db } = setup();
      const table = {
        context: 'local_gm_context',
        draft: 'campaign_draft',
        cursor: 'campaign_creation_cursor',
      }[kind];
      db.prepare(`UPDATE ${table} SET record_sha256=?`).run('0'.repeat(64));
      expect(() => readCampaignCreationCursor(db, 'context')).toThrow('CORRUPT_STORAGE');
    },
  );
  it('fails overflow before writing a draft or its cursor', () => {
    const { db } = setup();
    const row = db.prepare('SELECT record_json FROM campaign_draft').get() as {
      record_json: string;
    };
    const document = JSON.parse(row.record_json) as Record<string, unknown>;
    document['draftRevision'] = Number.MAX_SAFE_INTEGER;
    document['stateRevision'] = Number.MAX_SAFE_INTEGER;
    document['projectionRevision'] = Number.MAX_SAFE_INTEGER;
    const encoded = canonicalJson(document);
    db.prepare('UPDATE campaign_draft SET record_json=?,record_sha256=?').run(
      encoded,
      campaignCreationHash(document),
    );
    const cursorRow = db.prepare('SELECT record_json FROM campaign_creation_cursor').get() as {
      record_json: string;
    };
    const cursor = JSON.parse(cursorRow.record_json) as Record<string, unknown>;
    cursor['targetSha256'] = campaignCreationHash(document);
    cursor['revisions'] = {
      stateRevision: Number.MAX_SAFE_INTEGER,
      projectionRevision: Number.MAX_SAFE_INTEGER,
      actorVisibilityRevision: 0,
    };
    db.prepare('UPDATE campaign_creation_cursor SET record_json=?,record_sha256=?').run(
      canonicalJson(cursor),
      campaignCreationHash(cursor),
    );
    const before = snapshot(db);
    expect(() =>
      update(db, 'overflow', 'METADATA', { title: 'Overflow', description: null, art: null }),
    ).toThrow('REVISION_OVERFLOW');
    expect(snapshot(db)).toEqual(before);
  });
  it('rejects nested, async, thenable and mutating trusted validators with transaction rollback', () => {
    const { db } = setup();
    const input = {
      request: request(db, 'reject', 'METADATA', { title: 'X', description: null, art: null }),
    };
    const before = snapshot(db);
    expect(() => db.transaction(() => commitCampaignDraftUpdate(db, input, allow))()).toThrow(
      'INVALID_INPUT',
    );
    const asyncValidator = async () => {
      await Promise.resolve();
    };
    expect(() =>
      commitCampaignDraftUpdate(db, input, asyncValidator as unknown as CampaignSourceValidator),
    ).toThrow('INVALID_INPUT');
    expect(() => commitCampaignDraftUpdate(db, input, () => ({ then: () => undefined }))).toThrow(
      'INVALID_INPUT',
    );
    expect(() =>
      commitCampaignDraftUpdate(db, input, () => {
        db.prepare('UPDATE campaign_draft SET status=status').run();
      }),
    ).toThrow('SOURCE_CHANGED');
    expect(snapshot(db)).toEqual(before);
  });
  it('rolls back draft and journal when a cursor trigger aborts after the state update', () => {
    const { db } = setup();
    const before = snapshot(db);
    db.exec(
      "CREATE TRIGGER reject_cursor BEFORE UPDATE ON campaign_creation_cursor BEGIN SELECT RAISE(ABORT,'cursor failed'); END",
    );
    expect(() =>
      update(db, 'rollback', 'METADATA', {
        title: 'Never committed',
        description: null,
        art: null,
      }),
    ).toThrow('cursor failed');
    expect(snapshot(db)).toEqual(before);
  });
});

describe('private secret update journal', () => {
  function atSecret(db: Database.Database) {
    nav(db, 'CMP-002');
    nav(db, 'CMP-003');
  }
  it('pins replay to each update proof after A→B and preserves the newer current draft', () => {
    const p = fileSetup();
    atSecret(p.db);
    const a = update(
      p.db,
      'secret-A',
      'SECRET',
      { secretProvided: true },
      { kind: 'REPLACE', preparedVerifier: proofA },
    );
    const b = update(
      p.db,
      'secret-B',
      'SECRET',
      { secretProvided: true },
      { kind: 'REPLACE', preparedVerifier: proofB },
    );
    p.db.close();
    const db = open(p.path);
    const before = snapshot(db);
    expect(
      commitCampaignDraftUpdate(
        db,
        {
          request: a.update.request,
          secretUpdate: {
            kind: 'REPLACE',
            preparedVerifier: { ...proofA, salt: 'fresh-race-salt' },
          },
        },
        allow,
      ).kind,
    ).toBe('NEEDS_SECRET_VERIFICATION');
    expect(
      commitCampaignDraftUpdate(
        db,
        { request: a.update.request, verifiedReplayProofSha256: campaignCreationHash(proofB) },
        allow,
      ).kind,
    ).toBe('NEEDS_SECRET_VERIFICATION');
    const replay = commitCampaignDraftUpdate(
      db,
      { request: a.update.request, verifiedReplayProofSha256: campaignCreationHash(proofA) },
      allow,
    );
    expect(replay.kind).toBe('REPLAYED');
    expect(replay.update).toEqual(a.update);
    expect(replay.currentDraft).toEqual(b.currentDraft);
    expect(snapshot(db)).toEqual(before);
    const stored = db
      .prepare('SELECT request_json,event_json FROM campaign_draft_update WHERE update_id=?')
      .get('secret-A');
    expect(JSON.stringify(stored)).not.toContain('private-verifier');
    expect(JSON.stringify(stored)).not.toContain('masterTransferPassword');
  });
  it('copies the current proof into a KEEP no-op so replay remains verifiable after replacement', () => {
    const { db } = setup();
    atSecret(db);
    update(
      db,
      'secret-A',
      'SECRET',
      { secretProvided: true },
      { kind: 'REPLACE', preparedVerifier: proofA },
    );
    const before = current(db);
    const noop = update(
      db,
      'keep',
      'SECRET',
      { secretProvided: true },
      { kind: 'KEEP', expectedCurrentVerifierSha256: campaignCreationHash(proofA) },
    );
    expect(noop.currentDraft).toEqual(before);
    expect(noop.update.event.changed).toBe(false);
    expect(noop.update.verifier).toEqual(proofA);
    update(
      db,
      'secret-B',
      'SECRET',
      { secretProvided: true },
      { kind: 'REPLACE', preparedVerifier: proofB },
    );
    expect(
      commitCampaignDraftUpdate(
        db,
        { request: noop.update.request, verifiedReplayProofSha256: campaignCreationHash(proofA) },
        allow,
      ),
    ).toMatchObject({ kind: 'REPLAYED', currentDraft: { currentVerifier: proofB } });
  });
  it('rejects plaintext fields and stale KEEP without saving any secret or journal row', () => {
    const { db } = setup();
    atSecret(db);
    const before = snapshot(db);
    const raw = request(db, 'raw', 'SECRET', {
      masterTransferPassword: 'must-not-persist',
      masterTransferPasswordConfirmation: 'must-not-persist',
    });
    expect(() =>
      commitCampaignDraftUpdate(
        db,
        { request: raw, secretUpdate: { kind: 'REPLACE', preparedVerifier: proofA } },
        allow,
      ),
    ).toThrow();
    expect(() =>
      update(
        db,
        'stale-keep',
        'SECRET',
        { secretProvided: true },
        { kind: 'KEEP', expectedCurrentVerifierSha256: 'unknown' },
      ),
    ).toThrow('STALE_DRAFT');
    const hidden = request(db, 'hidden', 'SECRET', { secretProvided: true });
    const hiddenRevisions = {
      ...hidden.expectedRevisions,
      masterTransferPassword: 'must-not-persist',
    };
    expect(() =>
      commitCampaignDraftUpdate(
        db,
        {
          request: { ...hidden, expectedRevisions: hiddenRevisions },
          secretUpdate: { kind: 'REPLACE', preparedVerifier: proofA },
        },
        allow,
      ),
    ).toThrow();
    expect(snapshot(db)).toEqual(before);
  });
  it('cancels atomically, wipes every proof, retains redacted events and supports exact tombstone retry', () => {
    const p = fileSetup();
    atSecret(p.db);
    const a = update(
      p.db,
      'secret-A',
      'SECRET',
      { secretProvided: true },
      { kind: 'REPLACE', preparedVerifier: proofA },
    );
    update(
      p.db,
      'secret-B',
      'SECRET',
      { secretProvided: true },
      { kind: 'REPLACE', preparedVerifier: proofB },
    );
    const journals = p.db
      .prepare(
        'SELECT update_id,request_json,event_json FROM campaign_draft_update ORDER BY update_id',
      )
      .all();
    nav(p.db, 'CMP-002');
    nav(p.db, 'CMP-001');
    const req = cancellation(p.db);
    const source = current(p.db);
    const cancelled = cancelCampaignDraft(p.db, req, allow);
    expect(cancelled.appliedDraftRevision).toBe(source.draftRevision + 1);
    expect(cancelled.appliedRevisions).toEqual({
      stateRevision: source.stateRevision + 1,
      projectionRevision: source.projectionRevision + 1,
      actorVisibilityRevision: 0,
    });
    expect(readCampaignCreationCursor(p.db, 'context')).toMatchObject({
      kind: 'MENU',
      formId: 'APP-011',
      revisions: { ...zero, projectionRevision: 2 },
    });
    expect(
      p.db
        .prepare(
          'SELECT update_id,request_json,event_json FROM campaign_draft_update ORDER BY update_id',
        )
        .all(),
    ).toEqual(journals);
    expect(
      p.db.prepare('SELECT verifier_json,verifier_sha256 FROM campaign_draft_update').all(),
    ).toEqual([
      { verifier_json: null, verifier_sha256: null },
      { verifier_json: null, verifier_sha256: null },
    ]);
    p.db.close();
    const db = open(p.path);
    const before = snapshot(db);
    expect(cancelCampaignDraft(db, req, allow)).toEqual(cancelled);
    expect(readCampaignDraftCancellation(db, 'context', 'draft', 'cancel')).toEqual(cancelled);
    expect(() =>
      commitCampaignDraftUpdate(
        db,
        { request: a.update.request, verifiedReplayProofSha256: campaignCreationHash(proofA) },
        allow,
      ),
    ).toThrow('DRAFT_UNAVAILABLE');
    expect(snapshot(db)).toEqual(before);
    createCampaignDraft(
      db,
      {
        gmLocalContextId: 'context',
        campaignDraftId: 'next',
        expectedRevisions: {
          stateRevision: 0,
          projectionRevision: readLocalGmContext(db, 'context').projectionRevision,
          actorVisibilityRevision: 0,
        },
      },
      allow,
    );
    const nextCursor = readCampaignCreationCursor(db, 'context');
    expect(cancelCampaignDraft(db, req, allow)).toEqual(cancelled);
    expect(readCampaignCreationCursor(db, 'context')).toEqual(nextCursor);
  });
  it('restores all private proofs and the exact cursor if cancellation fails after proof erasure', () => {
    const { db } = setup();
    atSecret(db);
    update(
      db,
      'secret',
      'SECRET',
      { secretProvided: true },
      { kind: 'REPLACE', preparedVerifier: proofA },
    );
    nav(db, 'CMP-002');
    nav(db, 'CMP-001');
    const before = snapshot(db);
    db.exec(
      "CREATE TRIGGER reject_cancel BEFORE INSERT ON campaign_draft_cancel BEGIN SELECT RAISE(ABORT,'cancel failed'); END",
    );
    expect(() => cancelCampaignDraft(db, cancellation(db), allow)).toThrow('cancel failed');
    expect(snapshot(db)).toEqual(before);
  });
});

describe('atomic paused campaign creation', () => {
  it('creates one PAUSED zero-copy full checkpoint at zero, seals the draft, keeps only campaign credentials and reopens exact receipt/cursor', () => {
    const p = fileSetup();
    const draft = ready(p.db);
    const input = creationInput(p.db);
    const journal = p.db
      .prepare(
        'SELECT update_id,request_json,event_json FROM campaign_draft_update ORDER BY update_id',
      )
      .all();
    const validateSource = vi.fn(allow);
    const created = commitCampaignCreation(p.db, input, validateSource);
    expect(validateSource).toHaveBeenCalledWith(
      draft,
      readLocalGmContext(p.db, 'context'),
      'APPLY',
    );
    expect(created.receipt.revisions).toEqual(zero);
    expect(created.receipt.result.sourceRevisions).toEqual(triple(draft));
    expect(created.receipt.result.targetRevisions).toEqual(zero);
    expect(current(p.db)).toMatchObject({
      status: 'COMMITTED',
      committedCampaignId: 'campaign',
      currentVerifier: null,
      draftRevision: draft.draftRevision + 1,
      stateRevision: draft.stateRevision + 1,
      projectionRevision: draft.projectionRevision + 1,
    });
    const checkpoint = loadCampaignCheckpoint(p.db, 'campaign');
    expect(checkpoint).toMatchObject(zero);
    expect(p.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual([]);
    expect(checkpoint.snapshotJson).not.toContain('private-verifier');
    expect(checkpoint.snapshotJson).not.toContain('verifier');
    expect(readCampaignPrivateOwner(p.db, 'context', 'campaign').verifier).toEqual(proofA);
    expect(readPausedCampaign(p.db, 'context', 'campaign')).toMatchObject({
      kind: 'PAUSED_CAMPAIGN',
      status: 'PAUSED',
      campaignId: 'campaign',
    });
    expect(readCampaignCreationLibraryState(p.db, 'context')).toEqual({
      draftCount: 0,
      pausedCampaignCount: 1,
    });
    expect(
      p.db
        .prepare(
          'SELECT update_id,request_json,event_json FROM campaign_draft_update ORDER BY update_id',
        )
        .all(),
    ).toEqual(journal);
    expect(readCampaignDraftUpdate(p.db, 'context', 'draft', 'secret-A')?.verifier).toBeNull();
    p.db.close();
    const db = open(p.path);
    const before = snapshot(db);
    expect(readCampaignCreationCursor(db, 'context')).toMatchObject({
      kind: 'CAMPAIGN',
      targetId: 'campaign',
      formId: 'CMP-006',
      revisions: zero,
    });
    expect(readCampaignCreationCommand(db, 'context', 'create')).toEqual(created);
    const replay = vi.fn(
      (_draft: StoredCampaignDraft, _context: unknown, _phase: 'APPLY' | 'REPLAY') => undefined,
    );
    expect(
      commitCampaignCreation(
        db,
        { ...input, campaignId: 'unused-id', receiptId: 'unused-receipt', createdAt: 'not used' },
        replay,
      ),
    ).toEqual(created);
    expect(replay.mock.calls[0]?.[2]).toBe('REPLAY');
    expect(snapshot(db)).toEqual(before);
  });
  it.each([
    'campaign',
    'campaign_checkpoint',
    'campaign_private_owner',
    'campaign_creation_command',
    'campaign_creation_cursor',
  ] as const)('rolls every aggregate back if %s insertion fails', (table) => {
    const { db } = setup();
    ready(db);
    const before = snapshot(db);
    db.exec(
      `CREATE TRIGGER fail_creation BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'creation failed'); END`,
    );
    expect(() => commitCampaignCreation(db, creationInput(db), allow)).toThrow('creation failed');
    expect(snapshot(db)).toEqual(before);
  });
  it('refuses missing source facts, conflicting ID, changed retry and lost trusted authority without writes', () => {
    const { db } = setup();
    const before = snapshot(db);
    expect(() => commitCampaignCreation(db, creationInput(db), allow)).toThrow();
    expect(snapshot(db)).toEqual(before);
    ready(db);
    const input = creationInput(db);
    const complete = snapshot(db);
    expect(() =>
      commitCampaignCreation(db, { ...input, receiptId: input.campaignId }, allow),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(() =>
      commitCampaignCreation(db, input, () => {
        throw new Error('authority lost');
      }),
    ).toThrow('authority lost');
    expect(snapshot(db)).toEqual(complete);
    commitCampaignCreation(db, input, allow);
    const final = snapshot(db);
    expect(() =>
      commitCampaignCreation(
        db,
        {
          ...input,
          request: {
            ...input.request,
            payload: { ...input.request.payload, preflightLeaseId: 'different' },
          },
        },
        allow,
      ),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(snapshot(db)).toEqual(final);
  });
  it('rejects durable private proof or receipt corruption even when the other aggregate remains intact', () => {
    const { db } = setup();
    ready(db);
    commitCampaignCreation(db, creationInput(db), allow);
    db.prepare('UPDATE campaign_private_owner SET verifier_sha256=?').run('0'.repeat(64));
    expect(() => readCampaignCreationCursor(db, 'context')).toThrow();
    expect(() => readCampaignCreationCommand(db, 'context', 'create')).toThrow();
  });
});

describe('GM queue structural journal and cursor boundary', () => {
  const emptyQueue = () => ({
    requestQueueRevision: 0,
    requestFacts: [],
    visibleRequestIds: [],
    queueEvidenceSha256: campaignCreationHash([]),
  });
  function queuedSetup(path = ':memory:') {
    const p = setup(path);
    ready(p.db);
    const creation = commitCampaignCreation(p.db, creationInput(p.db), allow);
    return {
      ...p,
      creation,
      scope: { ownerDeviceId: p.device, gmLocalContextId: 'context', campaignId: 'campaign' },
    };
  }
  const state = (p: ReturnType<typeof queuedSetup>) =>
    p.db.transaction(() => readGmRequestReviewViewStateInTransaction(p.db, p.scope)).deferred();
  function enter(p: ReturnType<typeof queuedSetup>, id = 'queue-entry') {
    const cursor = readCampaignCreationCursor(p.db, 'context');
    const input = {
      eventId: id,
      mutation: {
        kind: 'NAV' as const,
        request: {
          messageType: 'navigation.form-action' as const,
          protocolVersion: 2 as const,
          navigationRequestId: id,
          actionKey: 'CMP-006::CTA::002' as const,
          sourceFormId: 'CMP-006' as const,
          expectedProjectionRevision: cursor.revisions.projectionRevision,
        },
        initialQueueOrNull: emptyQueue(),
      },
    };
    return {
      input,
      delivery: p.db
        .transaction(() => appendGmRequestReviewEventInTransaction(p.db, p.scope, input))
        .immediate(),
    };
  }
  function back(p: ReturnType<typeof queuedSetup>, id = 'queue-back') {
    const current = state(p).viewOrNull!;
    return p.db
      .transaction(() =>
        appendGmRequestReviewEventInTransaction(p.db, p.scope, {
          eventId: id,
          mutation: {
            kind: 'NAV',
            request: {
              messageType: 'navigation.form-action',
              protocolVersion: 2,
              navigationRequestId: id,
              actionKey: 'NET-017::CTA::009',
              sourceFormId: 'NET-017',
              expectedProjectionRevision: current.projectionRevision,
            },
            initialQueueOrNull: null,
          },
        }),
      )
      .immediate();
  }
  it('preserves birth/checkpoint bytes and keeps QUEUE revisions through safe return and exact entry replay', () => {
    const p = queuedSetup();
    const old = {
      campaign: p.db.prepare('SELECT * FROM campaign').all(),
      checkpoint: p.db.prepare('SELECT * FROM campaign_checkpoint').all(),
      creation: p.db.prepare('SELECT * FROM campaign_creation_command').all(),
      draft: p.db.prepare('SELECT * FROM campaign_draft').all(),
    };
    const entry = enter(p);
    expect(entry.delivery.view).toMatchObject({
      formId: 'NET-017',
      stateRevision: 0,
      projectionRevision: 1,
      requestQueueRevision: 0,
    });
    expect(entry.delivery.rowWrites).toBe(3);
    const returned = back(p);
    expect(readCampaignCreationCursor(p.db, 'context')).toMatchObject({
      kind: 'QUEUE',
      formId: 'CMP-006',
      revisions: { ...zero, projectionRevision: 2 },
    });
    const before = p.db.serialize();
    const replay = p.db
      .transaction(() => appendGmRequestReviewEventInTransaction(p.db, p.scope, entry.input))
      .immediate();
    expect(replay.event).toEqual(entry.delivery.event);
    expect(replay.view).toEqual(returned.view);
    expect(replay.rowWrites).toBe(0);
    expect(p.db.serialize().equals(before)).toBe(true);
    expect({
      campaign: p.db.prepare('SELECT * FROM campaign').all(),
      checkpoint: p.db.prepare('SELECT * FROM campaign_checkpoint').all(),
      creation: p.db.prepare('SELECT * FROM campaign_creation_command').all(),
      draft: p.db.prepare('SELECT * FROM campaign_draft').all(),
    }).toEqual(old);
    expect(p.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual([]);
    expect(readCampaignCreationCommand(p.db, 'context', 'create')).toEqual(p.creation);
  });
  it('journals an exact no-op draft without advancing the view and refuses an unavailable selection', () => {
    const p = queuedSetup();
    const { delivery } = enter(p);
    const request: GmRequestReviewDraftRequest = {
      messageType: 'network.gm-request-draft.replace',
      protocolVersion: 3,
      draftUpdateId: 'queue-draft',
      scope: { gmLocalContextId: 'context', campaignId: 'campaign', sourceFormId: 'NET-017' },
      expectedRevisions: {
        stateRevision: delivery.view.stateRevision,
        projectionRevision: delivery.view.projectionRevision,
        actorVisibilityRevision: delivery.view.actorVisibilityRevision,
      },
      expectedRequestQueueRevision: 0,
      values: { selectedRequestIdOrNull: null, decisionReason: '' },
    };
    const saved = p.db
      .transaction(() =>
        appendGmRequestReviewEventInTransaction(p.db, p.scope, {
          eventId: request.draftUpdateId,
          mutation: { kind: 'DRAFT', request },
        }),
      )
      .immediate();
    expect(saved.event.changed).toBe(false);
    expect(saved.view).toEqual(delivery.view);
    const before = p.db.serialize();
    expect(() =>
      p.db
        .transaction(() =>
          appendGmRequestReviewEventInTransaction(p.db, p.scope, {
            eventId: 'bad-selection',
            mutation: {
              kind: 'DRAFT',
              request: {
                ...request,
                draftUpdateId: 'bad-selection',
                values: {
                  selectedRequestIdOrNull: 'absent-request',
                  decisionReason: 'not applied',
                },
              },
            },
          }),
        )
        .immediate(),
    ).toThrow();
    expect(p.db.serialize().equals(before)).toBe(true);
  });
  it('refuses changed same-ID envelopes and stale navigation before writes', () => {
    const p = queuedSetup();
    const entry = enter(p);
    const before = p.db.serialize();
    for (const input of [
      {
        ...entry.input,
        mutation: {
          ...entry.input.mutation,
          request: { ...entry.input.mutation.request, expectedProjectionRevision: 2 },
        },
      },
      {
        eventId: 'stale-entry',
        mutation: {
          ...entry.input.mutation,
          request: { ...entry.input.mutation.request, navigationRequestId: 'stale-entry' },
          initialQueueOrNull: null,
        },
      },
    ])
      expect(() =>
        p.db
          .transaction(() => appendGmRequestReviewEventInTransaction(p.db, p.scope, input))
          .immediate(),
      ).toThrow();
    expect(p.db.serialize().equals(before)).toBe(true);
  });
  it('restores the exact selected QUEUE after SQLite close/reopen without selecting a newer context', () => {
    const p = fileSetup();
    ready(p.db);
    commitCampaignCreation(p.db, creationInput(p.db), allow);
    const scope = { ownerDeviceId: p.device, gmLocalContextId: 'context', campaignId: 'campaign' };
    const q = { ...p, scope, creation: readCampaignCreationCommand(p.db, 'context', 'create')! };
    enter(q);
    const returned = back(q);
    createLocalGmContext(
      p.db,
      { gmLocalContextId: 'other-context', masterProfileId: 'profile', ownerDeviceId: p.device },
      allow,
    );
    p.db.close();
    const db = open(p.path);
    const reopened = db
      .transaction(() => readGmRequestReviewViewStateInTransaction(db, scope))
      .deferred();
    expect(reopened.viewOrNull).toEqual(returned.view);
    expect(readCampaignCreationCursor(db, 'context').kind).toBe('QUEUE');
    expect(readCampaignCreationCursor(db, 'other-context').kind).toBe('MENU');
  });
  it.each(['view', 'event', 'pointer'] as const)(
    'rejects checksum-valid %s corruption without repairing history',
    (kind) => {
      const p = queuedSetup();
      enter(p);
      const table =
        kind === 'view'
          ? 'gm_request_queue_view'
          : kind === 'event'
            ? 'gm_request_queue_event'
            : 'campaign_creation_cursor';
      const row = p.db.prepare(`SELECT record_json FROM ${table}`).get() as { record_json: string };
      const value = JSON.parse(row.record_json) as Record<string, unknown>;
      if (kind === 'view') value['projectionRevision'] = 50;
      else if (kind === 'event')
        (value['view'] as Record<string, unknown>)['projectionRevision'] = 50;
      else (value['revisions'] as Record<string, unknown>)['projectionRevision'] = 50;
      p.db
        .prepare(`UPDATE ${table} SET record_json=?,record_sha256=?`)
        .run(canonicalJson(value), campaignCreationHash(value));
      const before = p.db.serialize();
      expect(() => readCampaignCreationCursor(p.db, 'context')).toThrow();
      expect(p.db.serialize().equals(before)).toBe(true);
    },
  );
  it('rolls back the journal, head and cursor when a trigger changes the campaign after the view write', () => {
    const p = queuedSetup();
    enter(p);
    p.db.exec(
      "CREATE TRIGGER sabotage_queue AFTER UPDATE ON gm_request_queue_view BEGIN UPDATE campaign SET payload_json='{}' WHERE campaign_id='campaign'; END",
    );
    const before = p.db.serialize();
    expect(() => back(p)).toThrow();
    expect(p.db.serialize().equals(before)).toBe(true);
    expect(readCampaignCreationCursor(p.db, 'context')).toMatchObject({
      kind: 'QUEUE',
      formId: 'NET-017',
    });
  });
  it('requires an existing transaction and actual current installation ownership', () => {
    const p = queuedSetup();
    expect(() => readGmRequestReviewViewStateInTransaction(p.db, p.scope)).toThrow();
    enter(p);
    resetDeviceIdentity(p.db, allow);
    bootstrapDeviceIdentity(p.db);
    const before = p.db.serialize();
    expect(() => state(p)).toThrow();
    expect(p.db.serialize().equals(before)).toBe(true);
  });
  it('advances connection presentation only and does not turn a refresh into a browser NAV', () => {
    const p = queuedSetup();
    const { delivery } = enter(p);
    const changed = p.db
      .transaction(() =>
        appendGmRequestReviewEventInTransaction(p.db, p.scope, {
          eventId: 'connection-refresh',
          mutation: {
            kind: 'CONNECTION_REFRESH',
            connectionFactsSha256: campaignCreationHash([
              { owner: 'peer', connectionState: 'DISCONNECTED' },
            ]),
          },
        }),
      )
      .immediate();
    expect(changed.view).toMatchObject({
      formId: 'NET-017',
      stateRevision: delivery.view.stateRevision,
      projectionRevision: delivery.view.projectionRevision + 1,
      requestQueueRevision: 0,
    });
    expect(changed.event.mutation.kind).toBe('CONNECTION_REFRESH');
  });
});
