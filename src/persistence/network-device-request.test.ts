import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPersistenceDatabase, configurePersistenceDatabase } from './database.js';
import { applyMigrationSequence, applyMigrations } from './migrations/index.js';
import { migration0001 } from './migrations/0001-initial.js';
import { migration0002 } from './migrations/0002-local-character-checkpoint.js';
import { migration0003 } from './migrations/0003-device-identity.js';
import { migration0004 } from './migrations/0004-skill-presentation.js';
import { migration0005 } from './migrations/0005-symbiont-presentation.js';
import { migration0006 } from './migrations/0006-local-character-post-save.js';
import { migration0007 } from './migrations/0007-campaign-creation.js';
import { migration0008 } from './migrations/0008-network-installation-identity.js';
import { migration0009 } from './migrations/0009-device-admission.js';
import { migration0010 } from './migrations/0010-network-application.js';
import { bootstrapDeviceIdentity, resetDeviceIdentity } from './device-identity.js';
import {
  ensureLocalGmProfile,
  createLocalGmContext,
  createCampaignDraft,
  readCampaignDraft,
  commitCampaignDraftUpdate,
  navigateCampaignDraft,
  commitCampaignCreation,
  type RedactedCampaignDraftRequest,
} from './campaign-creation.js';
import { readHostedCurrentPausedCampaign } from './current-paused-campaign.js';
import {
  commitHostedNetworkCommand,
  readHostedNetworkCommand,
  readHostedDeviceRequest,
  readHostedConnectionAttempt,
  readHostedPausedCampaignIds,
  readHostedDeviceRequestCurrent,
  readGmDeviceRequestQueue,
  readGmRequestReviewView,
  commitGmRequestReviewNavigation,
  commitGmRequestReviewDraft,
  commitGmRequestReviewConnectionRefresh,
  commitGmDeviceRequestDecision,
  commitHostedRequestLaneBinding,
  type HostedNetworkPrincipal,
  type HostedNetworkInput,
  type HostedNetworkCommand,
  type NetworkGmDecisionRequest,
  type HostedCandidateBaselineGuard,
} from './network-device-request.js';
import type { NetworkPreparedBatch } from './network-local-application.js';

const databases: Database.Database[] = [],
  directories: string[] = [];
const allow = () => undefined;
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const vector = (v: typeof zero) => ({
  stateRevision: v.stateRevision,
  projectionRevision: v.projectionRevision,
  actorVisibilityRevision: v.actorVisibilityRevision,
});
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function withBatchHash(value: Omit<NetworkPreparedBatch, 'batchSha256'>): NetworkPreparedBatch {
  const body = {
    ...(value.schemaVersion === 2
      ? { schemaVersion: 2 as const, localControllerSeatId: value.localControllerSeatId! }
      : {}),
    requestId: value.requestId,
    technicalSessionId: value.technicalSessionId,
    connectionRevision: value.connectionRevision,
    campaignProof: value.campaignProof,
    candidates: value.candidates,
  };
  return { ...body, batchSha256: sha(canonical(body)) };
}
const open = (filename = ':memory:', legacy = false) => {
  const db = legacy ? new Database(filename) : openPersistenceDatabase(filename);
  if (legacy) {
    configurePersistenceDatabase(db);
    applyMigrationSequence(db, [
      migration0001,
      migration0002,
      migration0003,
      migration0004,
      migration0005,
      migration0006,
      migration0007,
      migration0008,
      migration0009,
      migration0010,
    ]);
  }
  databases.push(db);
  return db;
};
function setup(filename = ':memory:', legacy = false) {
  const db = open(filename, legacy),
    owner = bootstrapDeviceIdentity(db),
    campaignId = randomUUID();
  ensureLocalGmProfile(db, { ownerDeviceId: owner, masterProfileId: 'profile' }, allow);
  createLocalGmContext(
    db,
    { ownerDeviceId: owner, masterProfileId: 'profile', gmLocalContextId: 'context' },
    allow,
  );
  createCampaignDraft(
    db,
    { gmLocalContextId: 'context', campaignDraftId: 'draft', expectedRevisions: zero },
    allow,
  );
  for (const stage of [
    {
      form: 'CMP-001',
      variant: 'METADATA',
      values: { title: 'Published', description: null, art: null },
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
    let d = readCampaignDraft(db, 'context', 'draft');
    if (d.formId !== stage.form) {
      navigateCampaignDraft(
        db,
        {
          gmLocalContextId: 'context',
          campaignDraftId: 'draft',
          expectedDraftRevision: d.draftRevision,
          expectedRevisions: vector(d),
          sourceFormId: d.formId,
          targetFormId: stage.form,
        },
        allow,
      );
      d = readCampaignDraft(db, 'context', 'draft');
    }
    const request = {
      messageType: 'campaign.draft.replace',
      protocolVersion: 3,
      draftUpdateId: `update-${stage.variant}`,
      scope: { gmLocalContextId: 'context', campaignDraftId: 'draft', sourceFormId: d.formId },
      expectedDraftRevision: d.draftRevision,
      expectedRevisions: vector(d),
      variant: stage.variant,
      values: stage.values,
    } as RedactedCampaignDraftRequest;
    commitCampaignDraftUpdate(
      db,
      {
        request,
        ...(stage.variant === 'SECRET'
          ? {
              secretUpdate: {
                kind: 'REPLACE' as const,
                preparedVerifier: { privateVerifier: 'not-network-data' },
              },
            }
          : {}),
      },
      allow,
    );
  }
  let d = readCampaignDraft(db, 'context', 'draft');
  navigateCampaignDraft(
    db,
    {
      gmLocalContextId: 'context',
      campaignDraftId: 'draft',
      expectedDraftRevision: d.draftRevision,
      expectedRevisions: vector(d),
      sourceFormId: d.formId,
      targetFormId: 'CMP-005',
    },
    allow,
  );
  d = readCampaignDraft(db, 'context', 'draft');
  commitCampaignCreation(
    db,
    {
      campaignId,
      receiptId: 'creation-receipt',
      createdAt: '2026-10-30T10:00:00.000Z',
      qrPayload: `http://127.0.0.1:30111/?campaignId=${campaignId}`,
      baselineVersion: 'baseline',
      request: {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
        role: 'gm',
        commandId: 'create',
        expectedRevisions: vector(d),
        payload: {
          stage: 'CAMPAIGN_CREATE',
          sourceFormId: 'CMP-005',
          gmLocalContextId: 'context',
          campaignDraftId: 'draft',
          draftRevision: d.draftRevision,
          preflightLeaseId: 'lease',
        },
      },
    },
    allow,
  );
  const key = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
  const principal: HostedNetworkPrincipal = {
    hostOwnerDeviceId: owner,
    campaignId,
    peerIdentity: {
      schemaVersion: 1,
      algorithm: 'ED25519',
      ownerDeviceId: randomUUID(),
      publicKeySpkiBase64: key.toString('base64'),
      keyFingerprintSha256: sha(key),
    },
  };
  return { db, principal };
}
const snapshot = (db: Database.Database) =>
  [
    'campaign',
    'campaign_checkpoint',
    'campaign_character_copy',
    'campaign_private_owner',
    'local_character',
  ].map((table) => db.prepare(`SELECT * FROM ${table}`).all());
function connect(p: ReturnType<typeof setup>): HostedNetworkCommand {
  const c = readHostedCurrentPausedCampaign(p.db, p.principal.campaignId, allow),
    commandId = randomUUID(),
    attemptId = randomUUID();
  return commitHostedNetworkCommand(
    p.db,
    p.principal,
    {
      operation: 'OPEN',
      commandId,
      receiptId: randomUUID(),
      attemptId,
      technicalSessionId: randomUUID(),
      campaignProof: {
        campaignId: c.campaignId,
        revisions: vector(c),
        checkpointSha256: c.checkpointSha256,
      },
      semanticBodyJson: canonical({ operation: 'CONNECTION_OPEN', commandId, attemptId }),
    },
    allow,
    allow,
  );
}
function submission(
  p: ReturnType<typeof setup>,
  opening: HostedNetworkCommand,
  count = 1,
): Extract<HostedNetworkInput, { operation: 'SUBMIT' }> {
  if (opening.receipt.operation !== 'OPEN') throw new Error('fixture opening');
  const session = opening.receipt.session,
    requestId = randomUUID(),
    commandId = randomUUID();
  const candidates = Array.from({ length: count }, () => {
    const witness = canonical({ private: 'verified witness fixture', id: randomUUID() });
    return {
      descriptor: {
        sourceUuid: randomUUID(),
        sourceSnapshotId: randomUUID(),
        finalSnapshotVersion: 1,
        metadataRevision: 0,
        sourceChecksum: 'a'.repeat(64),
        exportChecksum: 'b'.repeat(64),
        exportBytesSha256: 'c'.repeat(64),
        baselineVersion: 'baseline',
      },
      exportDocument: { name: 'Verified fixture' },
      canonicalWitnessText: witness,
      witnessSha256: sha(witness),
      byteLength: Buffer.byteLength(witness),
    };
  });
  const batch = withBatchHash({
    ...((
      p.db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as {
        version: number;
      }
    ).version === 11
      ? { schemaVersion: 2 as const, localControllerSeatId: randomUUID() }
      : {}),
    requestId,
    technicalSessionId: session.technicalSessionId,
    connectionRevision: 0,
    campaignProof: session.campaignProof,
    candidates,
  });
  return {
    operation: 'SUBMIT',
    commandId,
    receiptId: randomUUID(),
    requestId,
    technicalSessionId: session.technicalSessionId,
    expectedConnectionRevision: 0,
    batch,
    semanticBodyJson: canonical({ requestId, commandId, candidates }),
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const gmScope = (p: ReturnType<typeof setup>) => ({
  ownerDeviceId: p.principal.hostOwnerDeviceId,
  gmLocalContextId: 'context',
  campaignId: p.principal.campaignId,
});
function enterQueue(p: ReturnType<typeof setup>) {
  const old = readGmRequestReviewView(p.db, gmScope(p), allow);
  return commitGmRequestReviewNavigation(
    p.db,
    gmScope(p),
    {
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId: 'CMP-006',
      actionKey: 'CMP-006::CTA::002',
      expectedProjectionRevision: old?.projectionRevision ?? 0,
    },
    allow,
    allow,
  );
}
function selectRequest(p: ReturnType<typeof setup>, requestId: string, reason = '') {
  let view = readGmRequestReviewView(p.db, gmScope(p), allow)!;
  const replace = () =>
    commitGmRequestReviewDraft(
      p.db,
      gmScope(p),
      {
        messageType: 'network.gm-request-draft.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        scope: {
          gmLocalContextId: 'context',
          campaignId: p.principal.campaignId,
          sourceFormId: 'NET-017',
        },
        expectedRevisions: vector(view),
        expectedRequestQueueRevision: view.requestQueueRevision,
        values: { selectedRequestIdOrNull: requestId, decisionReason: reason },
      },
      allow,
      allow,
    );
  view = replace().current;
  if (reason !== '' && view.values.decisionReason === '') view = replace().current;
  return view;
}
function decisionInput(p: ReturnType<typeof setup>, requestId: string, reject = false) {
  const view = readGmRequestReviewView(p.db, gmScope(p), allow)!,
    current = readHostedDeviceRequestCurrent(p.db, p.principal, requestId, allow);
  const common = {
    messageType: 'command.request' as const,
    protocolVersion: 1 as const,
    commandKind: 'workflow-command' as const,
    role: 'gm' as const,
    commandId: randomUUID(),
    expectedRevisions: vector(view),
  };
  const payload = {
    campaignId: p.principal.campaignId,
    requestId,
    requestRevision: current.requestRevision,
  };
  const request: NetworkGmDecisionRequest = reject
    ? {
        ...common,
        workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
        payload: { ...payload, reason: view.values.decisionReason },
      }
    : { ...common, workflowCommandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW', payload };
  return { request, receiptId: randomUUID(), timestamp: '2026-10-30T12:00:00.000Z' };
}
describe('GM request review persistence', () => {
  it('reads the owned current from the fully verified queue and refuses another pinned owner', () => {
    const p = setup(),
      opening = connect(p),
      input = submission(p, opening);
    commitHostedNetworkCommand(p.db, p.principal, input, allow, allow);
    enterQueue(p);
    selectRequest(p, input.requestId);
    commitGmDeviceRequestDecision(
      p.db,
      gmScope(p),
      decisionInput(p, input.requestId),
      allow,
      allow,
    );
    const before = p.db.serialize();
    expect(readHostedDeviceRequestCurrent(p.db, p.principal, input.requestId, allow)).toEqual(
      readGmDeviceRequestQueue(p.db, gmScope(p), allow).requests[0],
    );
    const key = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
    const foreign = {
      db: p.db,
      principal: {
        ...p.principal,
        peerIdentity: {
          ...p.principal.peerIdentity,
          ownerDeviceId: randomUUID(),
          publicKeySpkiBase64: key.toString('base64'),
          keyFingerprintSha256: sha(key),
        },
      },
    };
    connect(foreign);
    const pinned = p.db.serialize();
    expect(() =>
      readHostedDeviceRequestCurrent(p.db, foreign.principal, input.requestId, allow),
    ).toThrow('FOREIGN_OWNER');
    expect(() => readHostedDeviceRequestCurrent(p.db, p.principal, randomUUID(), allow)).toThrow(
      'NOT_FOUND',
    );
    expect(p.db.serialize().equals(pinned)).toBe(true);
    expect(pinned.equals(before)).toBe(false);
    p.db.prepare('UPDATE gm_request_queue_event SET record_sha256=?').run('0'.repeat(64));
    const corrupt = p.db.serialize();
    expect(() =>
      readHostedDeviceRequestCurrent(p.db, p.principal, input.requestId, allow),
    ).toThrow();
    expect(p.db.serialize().equals(corrupt)).toBe(true);
  });
  it('reports a technical view race as STALE_REVISION before any draft write', () => {
    const p = setup(),
      entry = enterQueue(p);
    commitGmRequestReviewConnectionRefresh(
      p.db,
      gmScope(p),
      { eventId: randomUUID(), connectionFactsSha256: sha('connected') },
      allow,
      allow,
    );
    const before = p.db.serialize();
    expect(() =>
      commitGmRequestReviewDraft(
        p.db,
        gmScope(p),
        {
          protocolVersion: 3,
          messageType: 'network.gm-request-draft.replace',
          draftUpdateId: randomUUID(),
          scope: {
            gmLocalContextId: 'context',
            campaignId: p.principal.campaignId,
            sourceFormId: 'NET-017',
          },
          expectedRevisions: vector(entry.current),
          expectedRequestQueueRevision: entry.current.requestQueueRevision,
          values: { selectedRequestIdOrNull: null, decisionReason: '' },
        },
        allow,
        allow,
      ),
    ).toThrow('STALE_REVISION');
    expect(p.db.serialize().equals(before)).toBe(true);
  });
  it('persists connection presentation separately and refuses cross-family no-op IDs', () => {
    const p = setup(),
      entry = enterQueue(p),
      input = { eventId: randomUUID(), connectionFactsSha256: sha(canonical({ connected: [] })) };
    const observed: { hash: string | null; projectionRevision: number }[] = [];
    const result = commitGmRequestReviewConnectionRefresh(
      p.db,
      gmScope(p),
      input,
      allow,
      (source) => {
        observed.push({
          hash: source.connectionFactsSha256OrNull,
          projectionRevision: source.viewOrNull!.projectionRevision,
        });
      },
    );
    expect(observed).toEqual([
      { hash: null, projectionRevision: entry.current.projectionRevision },
      {
        hash: input.connectionFactsSha256,
        projectionRevision: entry.current.projectionRevision + 1,
      },
    ]);
    expect(result.current.stateRevision).toBe(entry.current.stateRevision);
    expect(result.current.projectionRevision).toBe(entry.current.projectionRevision + 1);
    expect(result.current.requestQueueRevision).toBe(0);
    const before = p.db.serialize();
    expect(commitGmRequestReviewConnectionRefresh(p.db, gmScope(p), input, allow, allow)).toEqual(
      result,
    );
    expect(p.db.serialize().equals(before)).toBe(true);
    expect(() =>
      commitGmRequestReviewConnectionRefresh(
        p.db,
        gmScope(p),
        { ...input, eventId: 'creation-receipt' },
        allow,
        allow,
      ),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(p.db.serialize().equals(before)).toBe(true);
    const deniedHash = sha('new authenticated connection snapshot');
    expect(() =>
      commitGmRequestReviewConnectionRefresh(
        p.db,
        gmScope(p),
        { eventId: randomUUID(), connectionFactsSha256: deniedHash },
        allow,
        (source) => {
          if (source.connectionFactsSha256OrNull === deniedHash)
            throw new Error('postwrite encoding refused');
        },
      ),
    ).toThrow();
    expect(p.db.serialize().equals(before)).toBe(true);
  });
  it('refuses existing CREATE identities and a corrupt current checkpoint before queue writes', () => {
    const p = setup(),
      opening = connect(p),
      input = submission(p, opening);
    commitHostedNetworkCommand(p.db, p.principal, input, allow, allow);
    const before = p.db.serialize();
    expect(() =>
      commitGmRequestReviewNavigation(
        p.db,
        gmScope(p),
        {
          messageType: 'navigation.form-action',
          protocolVersion: 2,
          navigationRequestId: 'create',
          sourceFormId: 'CMP-006',
          actionKey: 'CMP-006::CTA::002',
          expectedProjectionRevision: 0,
        },
        allow,
        allow,
      ),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(p.db.serialize().equals(before)).toBe(true);
    enterQueue(p);
    selectRequest(p, input.requestId);
    const selected = p.db.serialize();
    expect(() =>
      commitGmDeviceRequestDecision(
        p.db,
        gmScope(p),
        { ...decisionInput(p, input.requestId), receiptId: 'creation-receipt' },
        allow,
        allow,
      ),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(p.db.serialize().equals(selected)).toBe(true);
    const decision = decisionInput(p, input.requestId);
    p.db.prepare("UPDATE campaign_checkpoint SET snapshot_json='{}'").run();
    const corrupt = p.db.serialize();
    expect(() => readGmDeviceRequestQueue(p.db, gmScope(p), allow)).toThrow();
    expect(() => readGmRequestReviewView(p.db, gmScope(p), allow)).toThrow();
    expect(() => commitGmDeviceRequestDecision(p.db, gmScope(p), decision, allow, allow)).toThrow();
    expect(p.db.serialize().equals(corrupt)).toBe(true);
  });
  it('persists accept/reject separately, keeps SUBMIT and campaign birth bytes, and replays current after restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gm-review-'));
    directories.push(dir);
    const file = join(dir, 'db.sqlite'),
      p = setup(file),
      opening = connect(p),
      input = submission(p, opening);
    const original = commitHostedNetworkCommand(p.db, p.principal, input, allow, allow),
      birth = snapshot(p.db);
    const submitRow = p.db
      .prepare('SELECT * FROM hosted_network_command WHERE command_id=?')
      .get(input.commandId);
    const entry = enterQueue(p);
    selectRequest(p, input.requestId);
    const accept = decisionInput(p, input.requestId),
      accepted = commitGmDeviceRequestDecision(p.db, gmScope(p), accept, allow, allow);
    expect(accepted.command.receipt.result).toMatchObject({
      beforeRequestStatus: 'PENDING',
      afterRequestStatus: 'IN_REVIEW',
      requestRevision: 1,
      candidateSnapshotChecksums: input.batch.candidates.map((c) => c.descriptor.exportBytesSha256),
    });
    expect(snapshot(p.db)).toEqual(birth);
    expect(
      p.db.prepare('SELECT * FROM hosted_network_command WHERE command_id=?').get(input.commandId),
    ).toEqual(submitRow);
    selectRequest(p, input.requestId, 'Нужны исправления');
    const reject = decisionInput(p, input.requestId, true);
    const rejected = commitGmDeviceRequestDecision(p.db, gmScope(p), reject, allow, allow);
    expect(rejected.command.receipt.result.afterRequestStatus).toBe('REJECTED');
    const before = p.db.serialize(),
      replay = commitGmDeviceRequestDecision(p.db, gmScope(p), accept, allow, allow);
    expect(replay.command).toEqual(accepted.command);
    expect(replay.current).toEqual(rejected.current);
    expect(p.db.serialize().equals(before)).toBe(true);
    p.db.close();
    const reopened = { ...p, db: open(file) };
    expect(
      readHostedDeviceRequestCurrent(reopened.db, p.principal, input.requestId, allow)
        .requestStatus,
    ).toBe('REJECTED');
    expect(
      readHostedNetworkCommand(reopened.db, p.principal, input.commandId, allow)?.receipt,
    ).toEqual(original.receipt);
    const nav = commitGmRequestReviewNavigation(
      reopened.db,
      gmScope(p),
      entry.event.request as Parameters<typeof commitGmRequestReviewNavigation>[2],
      allow,
      allow,
    );
    expect(nav.event).toEqual(entry.event);
    expect(nav.current).toEqual(rejected.current);
    expect(snapshot(reopened.db)).toEqual(birth);
  });
  it('refuses network command and receipt identities in older GM context and draft writers without any write', () => {
    const p = setup(),
      opening = connect(p),
      input = submission(p, opening);
    commitHostedNetworkCommand(p.db, p.principal, input, allow, allow);
    const entry = enterQueue(p);
    selectRequest(p, input.requestId);
    const decision = commitGmDeviceRequestDecision(
      p.db,
      gmScope(p),
      decisionInput(p, input.requestId),
      allow,
      allow,
    );
    createLocalGmContext(
      p.db,
      {
        ownerDeviceId: p.principal.hostOwnerDeviceId,
        masterProfileId: 'profile',
        gmLocalContextId: 'another-context',
      },
      allow,
    );
    createCampaignDraft(
      p.db,
      {
        gmLocalContextId: 'another-context',
        campaignDraftId: 'another-draft',
        expectedRevisions: zero,
      },
      allow,
    );
    const draft = readCampaignDraft(p.db, 'another-context', 'another-draft'),
      before = p.db.serialize();
    if (entry.event.request.messageType !== 'navigation.form-action')
      throw new Error('Expected queue NAV');
    for (const id of [
      input.commandId,
      input.receiptId,
      decision.command.receipt.commandId,
      decision.command.receipt.receiptId,
      entry.event.request.navigationRequestId,
    ]) {
      expect(() =>
        createLocalGmContext(
          p.db,
          {
            ownerDeviceId: p.principal.hostOwnerDeviceId,
            masterProfileId: 'profile',
            gmLocalContextId: id,
          },
          allow,
        ),
      ).toThrow('IDEMPOTENCY_CONFLICT');
      expect(() =>
        commitCampaignDraftUpdate(
          p.db,
          {
            request: {
              messageType: 'campaign.draft.replace',
              protocolVersion: 3,
              draftUpdateId: id,
              scope: {
                gmLocalContextId: 'another-context',
                campaignDraftId: 'another-draft',
                sourceFormId: 'CMP-001',
              },
              expectedDraftRevision: draft.draftRevision,
              expectedRevisions: vector(draft),
              variant: 'METADATA',
              values: { title: 'Changed', description: null, art: null },
            },
          },
          allow,
        ),
      ).toThrow('IDEMPOTENCY_CONFLICT');
      expect(p.db.serialize().equals(before)).toBe(true);
    }
  });
  it.each(['CANCEL', 'DECISION'] as const)(
    'serializes the %s winner and does not write the losing action',
    (winner) => {
      const p = setup(),
        opening = connect(p),
        input = submission(p, opening);
      commitHostedNetworkCommand(p.db, p.principal, input, allow, allow);
      enterQueue(p);
      selectRequest(p, input.requestId);
      const decision = decisionInput(p, input.requestId),
        cancel: Extract<HostedNetworkInput, { operation: 'CANCEL' }> = {
          operation: 'CANCEL',
          commandId: randomUUID(),
          receiptId: randomUUID(),
          requestId: input.requestId,
          technicalSessionId: input.technicalSessionId,
          expectedRequestRevision: 0,
          reason: 'Отмена',
          semanticBodyJson: canonical({ reason: 'Отмена' }),
        };
      if (winner === 'CANCEL') commitHostedNetworkCommand(p.db, p.principal, cancel, allow, allow);
      else commitGmDeviceRequestDecision(p.db, gmScope(p), decision, allow, allow);
      const before = p.db.serialize();
      expect(() =>
        winner === 'CANCEL'
          ? commitGmDeviceRequestDecision(p.db, gmScope(p), decision, allow, allow)
          : commitHostedNetworkCommand(p.db, p.principal, cancel, allow, allow),
      ).toThrow('STALE_REVISION');
      expect(p.db.serialize().equals(before)).toBe(true);
      const queue = readGmDeviceRequestQueue(p.db, gmScope(p), allow);
      expect(queue.requestQueueRevision).toBe(2);
      if (winner === 'CANCEL')
        expect(readGmRequestReviewView(p.db, gmScope(p), allow)?.values).toEqual({
          selectedRequestIdOrNull: null,
          decisionReason: '',
        });
    },
  );
  it('enriches an actual schema10 SUBMIT after forward migration and refuses changed binding', () => {
    const p = setup(':memory:', true),
      opening = connect(p),
      input = submission(p, opening),
      saved = commitHostedNetworkCommand(p.db, p.principal, input, allow, allow);
    const original = p.db
      .prepare('SELECT * FROM hosted_network_command WHERE command_id=?')
      .get(input.commandId);
    applyMigrations(p.db);
    enterQueue(p);
    selectRequest(p, input.requestId);
    const before = p.db.serialize();
    expect(() =>
      commitGmDeviceRequestDecision(
        p.db,
        gmScope(p),
        decisionInput(p, input.requestId),
        allow,
        allow,
      ),
    ).toThrow('STALE_REVISION');
    expect(p.db.serialize().equals(before)).toBe(true);
    const request = {
      schemaVersion: 1 as const,
      operation: 'DEVICE_REQUEST_BIND_LANE' as const,
      commandId: randomUUID(),
      requestId: input.requestId,
      technicalSessionId: input.technicalSessionId,
      submitCommandId: input.commandId,
      batchSha256: input.batch.batchSha256,
      localControllerSeatId: randomUUID(),
    };
    const binding = commitHostedRequestLaneBinding(
      p.db,
      p.principal,
      { request, receiptId: randomUUID() },
      allow,
      allow,
    );
    expect(binding.current.requestRevision).toBe(0);
    expect(readGmDeviceRequestQueue(p.db, gmScope(p), allow).requestQueueRevision).toBe(2);
    expect(
      p.db.prepare('SELECT * FROM hosted_network_command WHERE command_id=?').get(input.commandId),
    ).toEqual(original);
    expect(readHostedNetworkCommand(p.db, p.principal, input.commandId, allow)?.receipt).toEqual(
      saved.receipt,
    );
    const bound = p.db.serialize();
    expect(() =>
      commitHostedRequestLaneBinding(
        p.db,
        p.principal,
        { request: { ...request, localControllerSeatId: randomUUID() }, receiptId: randomUUID() },
        allow,
        allow,
      ),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(p.db.serialize().equals(bound)).toBe(true);
    expect(
      commitGmDeviceRequestDecision(
        p.db,
        gmScope(p),
        decisionInput(p, input.requestId),
        allow,
        allow,
      ).command.receipt.result.afterRequestStatus,
    ).toBe('IN_REVIEW');
  });
  it.each(['false', 'promise', 'write'] as const)(
    'rejects %s from the trusted baseline guard without committing',
    (kind) => {
      const p = setup(),
        opening = connect(p),
        original = submission(p, opening),
        input = {
          ...original,
          batch: withBatchHash({
            ...original.batch,
            candidates: original.batch.candidates.map((c) => ({
              ...c,
              descriptor: { ...c.descriptor, baselineVersion: 'historic-approved' },
            })),
          }),
        };
      const before = p.db.serialize();
      const guard: HostedCandidateBaselineGuard =
        kind === 'false'
          ? () => false
          : kind === 'promise'
            ? () => Promise.resolve()
            : () => {
                p.db.prepare("UPDATE campaign SET lifecycle_state='PAUSED'").run();
              };
      expect(() =>
        commitHostedNetworkCommand(p.db, p.principal, input, allow, allow, guard),
      ).toThrow();
      expect(p.db.serialize().equals(before)).toBe(true);
      expect(() => commitHostedNetworkCommand(p.db, p.principal, input, allow, allow)).toThrow(
        'UNAVAILABLE',
      );
      expect(p.db.serialize().equals(before)).toBe(true);
    },
  );
  it('uses the explicit synchronous baseline resolver on apply and replay', () => {
    const p = setup(),
      opening = connect(p),
      original = submission(p, opening),
      input = {
        ...original,
        batch: withBatchHash({
          ...original.batch,
          candidates: original.batch.candidates.map((c) => ({
            ...c,
            descriptor: { ...c.descriptor, baselineVersion: 'historic-approved' },
          })),
        }),
      };
    const guard = vi.fn<HostedCandidateBaselineGuard>((source) => {
      if (
        source.campaign.baselineVersion !== 'baseline' ||
        source.candidateBaselineVersion !== 'historic-approved'
      )
        throw new Error('unapproved');
    });
    const saved = commitHostedNetworkCommand(p.db, p.principal, input, allow, allow, guard);
    expect(guard).toHaveBeenCalled();
    const before = p.db.serialize();
    expect(commitHostedNetworkCommand(p.db, p.principal, input, allow, allow, guard)).toEqual(
      saved,
    );
    expect(p.db.serialize().equals(before)).toBe(true);
    expect(guard.mock.calls.some(([, phase]) => phase === 'REPLAY')).toBe(true);
  });
  it('rolls back a decision and all queue heads if a trigger mutates campaign state', () => {
    const p = setup(),
      opening = connect(p),
      input = submission(p, opening);
    commitHostedNetworkCommand(p.db, p.principal, input, allow, allow);
    enterQueue(p);
    selectRequest(p, input.requestId);
    p.db.exec(
      "CREATE TRIGGER review_sabotage AFTER INSERT ON hosted_device_request_decision BEGIN UPDATE campaign SET payload_json='{}'; END",
    );
    const before = p.db.serialize();
    expect(() =>
      commitGmDeviceRequestDecision(
        p.db,
        gmScope(p),
        decisionInput(p, input.requestId),
        allow,
        allow,
      ),
    ).toThrow();
    expect(p.db.serialize().equals(before)).toBe(true);
  });
});

describe('hosted network session and addressed request journal', () => {
  it('accepts an existing opaque attempt identity and rejects a hidden pending row before a second submit', () => {
    const p = setup(),
      header = readHostedCurrentPausedCampaign(p.db, p.principal.campaignId, allow);
    const opening = commitHostedNetworkCommand(
      p.db,
      p.principal,
      {
        operation: 'OPEN',
        commandId: 'opaque-open',
        receiptId: 'opaque-receipt',
        attemptId: 'legacy:attempt-id',
        technicalSessionId: randomUUID(),
        campaignProof: {
          campaignId: header.campaignId,
          revisions: vector(header),
          checkpointSha256: header.checkpointSha256,
        },
        semanticBodyJson: canonical({ attemptId: 'legacy:attempt-id' }),
      },
      allow,
      allow,
    );
    expect(readHostedConnectionAttempt(p.db, p.principal, 'legacy:attempt-id', allow)).toEqual(
      opening,
    );
    const first = submission(p, opening);
    commitHostedNetworkCommand(p.db, p.principal, first, allow, allow);
    p.db
      .prepare('UPDATE hosted_device_request SET closed=1 WHERE request_id=?')
      .run(first.requestId);
    const before = p.db.serialize(),
      guard = vi.fn(allow);
    expect(() =>
      commitHostedNetworkCommand(p.db, p.principal, submission(p, opening), allow, guard),
    ).toThrow('CORRUPT_STORAGE');
    expect(guard).not.toHaveBeenCalled();
    expect(p.db.serialize().equals(before)).toBe(true);
  });
  it('checks existing peer continuity before returning absent commands or attempts', () => {
    const p = setup(),
      unknownCommandId = randomUUID(),
      unknownAttemptId = randomUUID();
    expect(readHostedNetworkCommand(p.db, p.principal, unknownCommandId, allow)).toBeNull();
    expect(readHostedConnectionAttempt(p.db, p.principal, unknownAttemptId, allow)).toBeNull();
    connect(p);
    const key = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
    const changed: HostedNetworkPrincipal = {
      ...p.principal,
      peerIdentity: {
        ...p.principal.peerIdentity,
        publicKeySpkiBase64: key.toString('base64'),
        keyFingerprintSha256: sha(key),
      },
    };
    const before = p.db.serialize();
    expect(() => readHostedNetworkCommand(p.db, changed, unknownCommandId, allow)).toThrow(
      'KEY_CONFLICT',
    );
    expect(() => readHostedConnectionAttempt(p.db, changed, unknownAttemptId, allow)).toThrow(
      'KEY_CONFLICT',
    );
    expect(readHostedNetworkCommand(p.db, p.principal, unknownCommandId, allow)).toBeNull();
    expect(readHostedConnectionAttempt(p.db, p.principal, unknownAttemptId, allow)).toBeNull();
    expect(p.db.serialize().equals(before)).toBe(true);
  });
  it('opens at most one session, restores the same attempt and never alters the campaign aggregate', () => {
    const p = setup(),
      before = snapshot(p.db),
      opened = connect(p),
      after = p.db.serialize();
    expect(opened.receipt).toMatchObject({
      operation: 'OPEN',
      session: { ...zero, connectionRevision: 0 },
    });
    expect(
      readHostedConnectionAttempt(
        p.db,
        p.principal,
        opened.input.operation === 'OPEN' ? opened.input.attemptId : 'bad',
        allow,
      ),
    ).toEqual(opened);
    expect(commitHostedNetworkCommand(p.db, p.principal, opened.input, allow, allow)).toEqual(
      opened,
    );
    expect(p.db.serialize().equals(after)).toBe(true);
    expect(() =>
      commitHostedNetworkCommand(
        p.db,
        p.principal,
        { ...opened.input, commandId: randomUUID(), receiptId: randomUUID() },
        allow,
        allow,
      ),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(p.db.serialize().equals(after)).toBe(true);
    expect(snapshot(p.db)).toEqual(before);
  });
  it('captures immutable PENDING, cancels exactly once, and replays original SUBMIT alongside current closed request after reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hosted-request-'));
    directories.push(directory);
    const filename = join(directory, 'host.sqlite'),
      p = setup(filename),
      opening = connect(p),
      input = submission(p, opening),
      before = snapshot(p.db);
    const submitted = commitHostedNetworkCommand(p.db, p.principal, input, allow, allow);
    const cancel: HostedNetworkInput = {
      operation: 'CANCEL',
      commandId: randomUUID(),
      receiptId: randomUUID(),
      requestId: input.requestId,
      technicalSessionId: input.technicalSessionId,
      expectedRequestRevision: 0,
      reason: 'Changed selection',
      semanticBodyJson: canonical({ cancel: input.requestId }),
    };
    const cancelled = commitHostedNetworkCommand(p.db, p.principal, cancel, allow, allow);
    expect(cancelled.current).toMatchObject({
      stateRevision: 1,
      projectionRevision: 1,
      actorVisibilityRevision: 0,
      requestRevision: 1,
      closureOrNull: { reason: 'Changed selection' },
    });
    const bytes = p.db.serialize();
    expect(commitHostedNetworkCommand(p.db, p.principal, cancel, allow, allow)).toEqual(cancelled);
    expect(p.db.serialize().equals(bytes)).toBe(true);
    expect(snapshot(p.db)).toEqual(before);
    p.db.close();
    const db = open(filename);
    const replay = commitHostedNetworkCommand(db, p.principal, input, allow, allow);
    expect(replay.receipt).toEqual(submitted.receipt);
    expect(replay.current).toEqual(cancelled.current);
    expect(readHostedDeviceRequest(db, p.principal, input.requestId, allow)).toEqual(
      cancelled.current,
    );
    expect(() =>
      commitHostedNetworkCommand(
        db,
        p.principal,
        { ...cancel, commandId: randomUUID(), receiptId: randomUUID() },
        allow,
        allow,
      ),
    ).toThrow('STALE_REVISION');
  });
  it('does not reserve capacity for two separate pending batches that each fit the same ACTIVE forecast', () => {
    const p = setup(),
      source = snapshot(p.db),
      a = connect(p),
      b = connect(p);
    commitHostedNetworkCommand(p.db, p.principal, submission(p, a, 3), allow, allow);
    commitHostedNetworkCommand(p.db, p.principal, submission(p, b, 3), allow, allow);
    expect(p.db.prepare('SELECT count(*) AS n FROM hosted_device_request').get()).toEqual({ n: 2 });
    expect(readHostedCurrentPausedCampaign(p.db, p.principal.campaignId, allow).activePcCount).toBe(
      0,
    );
    expect(snapshot(p.db)).toEqual(source);
  });
  it.each(['stale', 'hash', 'baseline', 'four', 'duplicate', 'foreign', 'key'] as const)(
    'rejects %s before mutation or source callback',
    (kind) => {
      const p = setup(),
        opening = connect(p),
        valid = submission(p, opening);
      let request = valid,
        principal = p.principal;
      if (kind === 'stale')
        request = {
          ...valid,
          expectedConnectionRevision: 1,
          batch: { ...valid.batch, connectionRevision: 1 },
        };
      else if (kind === 'hash')
        request = {
          ...valid,
          batch: {
            ...valid.batch,
            campaignProof: { ...valid.batch.campaignProof, checkpointSha256: 'f'.repeat(64) },
          },
        };
      else if (kind === 'baseline') {
        const candidates = valid.batch.candidates.map((c) => ({
          ...c,
          descriptor: { ...c.descriptor, baselineVersion: 'other' },
        }));
        request = {
          ...valid,
          batch: withBatchHash({ ...valid.batch, candidates }),
        };
      } else if (kind === 'four') request = submission(p, opening, 4);
      else if (kind === 'duplicate') {
        const candidates = [valid.batch.candidates[0]!, valid.batch.candidates[0]!];
        request = {
          ...valid,
          batch: withBatchHash({ ...valid.batch, candidates }),
        };
      } else if (kind === 'foreign')
        principal = {
          ...principal,
          peerIdentity: { ...principal.peerIdentity, ownerDeviceId: randomUUID() },
        };
      else {
        const other = generateKeyPairSync('ed25519').publicKey.export({
          format: 'der',
          type: 'spki',
        });
        principal = {
          ...principal,
          peerIdentity: {
            ...principal.peerIdentity,
            publicKeySpkiBase64: other.toString('base64'),
            keyFingerprintSha256: sha(other),
          },
        };
      }
      const before = p.db.serialize(),
        guard = vi.fn(allow);
      expect(() => commitHostedNetworkCommand(p.db, principal, request, allow, guard)).toThrow();
      expect(guard).not.toHaveBeenCalled();
      expect(p.db.serialize().equals(before)).toBe(true);
    },
  );
  it.each(['trigger', 'revoked-generation', 'promise'] as const)(
    'rolls back all request/journal writes for %s',
    async (fault) => {
      const p = setup(),
        opening = connect(p),
        request = submission(p, opening);
      let calls = 0;
      if (fault === 'trigger')
        p.db.exec(
          "CREATE TRIGGER prevent_network AFTER INSERT ON hosted_device_request BEGIN SELECT RAISE(ABORT,'private'); END",
        );
      const before = p.db.serialize();
      expect(() =>
        // Deliberately violate the trusted synchronous-callback contract at the JS boundary.
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        commitHostedNetworkCommand(p.db, p.principal, request, allow, () => {
          calls++;
          if (fault === 'revoked-generation' && calls === 2)
            throw new Error('retired physical lease');
          if (fault === 'promise') return Promise.reject(new Error('secret internal marker'));
          return undefined;
        }),
      ).toThrow();
      await setImmediate();
      expect(p.db.serialize().equals(before)).toBe(true);
    },
  );
  it.each(['request', 'receipt', 'peer-index'] as const)(
    'refuses checksum-valid %s corruption without repairing it',
    (kind) => {
      const p = setup(),
        opening = connect(p),
        input = submission(p, opening);
      commitHostedNetworkCommand(p.db, p.principal, input, allow, allow);
      if (kind === 'peer-index')
        p.db.prepare('UPDATE hosted_network_peer SET key_fingerprint=?').run('f'.repeat(64));
      else {
        const table = kind === 'request' ? 'hosted_device_request' : 'hosted_network_command',
          column = kind === 'request' ? 'request_id' : 'command_id',
          id = kind === 'request' ? input.requestId : input.commandId;
        const row = p.db.prepare(`SELECT record_json FROM ${table} WHERE ${column}=?`).get(id) as {
          record_json: string;
        };
        const value = JSON.parse(row.record_json) as Record<string, unknown>;
        if (kind === 'request') value['requestRevision'] = 5;
        else (value['receipt'] as Record<string, unknown>)['semanticBodySha256'] = 'f'.repeat(64);
        const json = canonical(value);
        p.db
          .prepare(`UPDATE ${table} SET record_json=?,record_sha256=? WHERE ${column}=?`)
          .run(json, sha(json), id);
      }
      const before = p.db.serialize();
      expect(() => readHostedNetworkCommand(p.db, p.principal, input.commandId, allow)).toThrow();
      expect(p.db.serialize().equals(before)).toBe(true);
    },
  );
  it.each(['hash', 'missing-owner'] as const)(
    'enumerates owned publications and refuses %s instead of silently omitting a campaign',
    (damage) => {
      const p = setup();
      expect(readHostedPausedCampaignIds(p.db, allow)).toEqual([p.principal.campaignId]);
      if (damage === 'hash')
        p.db.prepare('UPDATE campaign_private_owner SET record_sha256=?').run('f'.repeat(64));
      else p.db.prepare('DELETE FROM campaign_private_owner').run();
      const before = p.db.serialize();
      expect(() => readHostedPausedCampaignIds(p.db, allow)).toThrow();
      expect(p.db.serialize().equals(before)).toBe(true);
    },
  );
  it('does not let a reset device or changed semantic payload claim historical receipts', () => {
    const p = setup(),
      opening = connect(p),
      before = p.db.serialize();
    expect(() =>
      commitHostedNetworkCommand(
        p.db,
        p.principal,
        { ...opening.input, semanticBodyJson: canonical({ different: true }) },
        allow,
        allow,
      ),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(p.db.serialize().equals(before)).toBe(true);
    resetDeviceIdentity(p.db, allow);
    bootstrapDeviceIdentity(p.db);
    expect(() =>
      readHostedNetworkCommand(p.db, p.principal, opening.input.commandId, allow),
    ).toThrow('FOREIGN_OWNER');
  });
});
