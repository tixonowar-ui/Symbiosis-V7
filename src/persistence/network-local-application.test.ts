import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPersistenceDatabase } from './database.js';
import { bootstrapDeviceIdentity, resetDeviceIdentity } from './device-identity.js';
import {
  commitLocalNetworkTabClose,
  commitLocalNetworkTabEntry,
  readOwnedLocalNetworkTab,
} from './network-local-tab.js';
import {
  commitLocalNetworkHostPin,
  commitLocalNetworkMutation,
  readLocalNetworkApplication,
  readLocalNetworkApplicationEvent,
  readLocalNetworkHostPin,
  readLocalNetworkOutbox,
  readLocalNetworkAcknowledgementEvent,
  readLocalNetworkDeliverySnapshot,
  readLocalNetworkRequestDeliverySnapshot,
  readLocalNetworkShellExitByNavigationId,
  prepareLocalRequestLaneBinding,
  acknowledgeLocalRequestLaneBinding,
  readLocalRequestLaneBinding,
  readLocalNetworkRequestCurrent,
  commitLocalNetworkRequestAdvance,
  commitLocalNetworkCancelSettlement,
  readLocalNetworkCancelSettlementEvent,
  type VerifiedRequestReviewProof,
  type PeerLaneBindingReceipt,
  type LocalNetworkMutation,
  type LocalNetworkApplication,
  type NetworkPreparedBatch,
  type LocalNetworkMutationInput,
  type NetworkPublicIdentity,
  type NetworkStoreGuard,
} from './network-local-application.js';

const dbs: Database.Database[] = [];
const directories: string[] = [];
const allow = () => undefined;
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function withBatchHash(value: Omit<NetworkPreparedBatch, 'batchSha256'>): NetworkPreparedBatch {
  const body = {
    requestId: value.requestId,
    technicalSessionId: value.technicalSessionId,
    connectionRevision: value.connectionRevision,
    campaignProof: value.campaignProof,
    candidates: value.candidates,
  };
  return { ...body, batchSha256: sha(canonical(body)) };
}
const vector = (s: typeof zero) => ({
  stateRevision: s.stateRevision,
  projectionRevision: s.projectionRevision,
  actorVisibilityRevision: s.actorVisibilityRevision,
});
const open = (filename = ':memory:') => {
  const db = openPersistenceDatabase(filename);
  dbs.push(db);
  return db;
};
function setup(filename = ':memory:') {
  const db = open(filename),
    ownerDeviceId = bootstrapDeviceIdentity(db),
    networkScopeId = randomUUID(),
    tabId = randomUUID();
  const entry = commitLocalNetworkTabEntry(
    db,
    {
      ownerDeviceId,
      networkScopeId,
      tabId,
      entryCommandId: randomUUID(),
      entryReceiptId: randomUUID(),
      sourceContextId: randomUUID(),
      sourceRevisions: zero,
    },
    allow,
  );
  return { db, scope: { ownerDeviceId, networkScopeId }, tabId, entry };
}
function update(
  db: Database.Database,
  current: LocalNetworkApplication,
  mutation: LocalNetworkMutation,
) {
  const input: LocalNetworkMutationInput = {
    ownerDeviceId: current.ownerDeviceId,
    networkScopeId: current.networkScopeId,
    expectedRevisions: vector(current),
    expectedDraftRevision: current.draftRevision,
    eventId: randomUUID(),
    receiptId: randomUUID(),
    clientRequestJsonOrNull:
      mutation.kind === 'INTENT'
        ? mutation.intent.clientRequestJson
        : ['ACKNOWLEDGE', 'DIAGNOSTIC', 'PREPARE_BATCH'].includes(mutation.kind)
          ? null
          : canonical({ contextId: 'fixture-context', mutation }),
    mutation,
  };
  return commitLocalNetworkMutation(db, input, allow);
}
function connected(p: ReturnType<typeof setup>) {
  const planned = randomUUID(),
    campaignId = randomUUID();
  let state = readLocalNetworkApplication(p.db, p.scope);
  state = update(p.db, state, {
    kind: 'NAVIGATE',
    targetFormId: 'NET-002',
    plannedAttemptIdOrNull: planned,
    singleCandidateOrNull: null,
  }).current;
  state = update(p.db, state, { kind: 'ADDRESS', addressOrQrPayload: '127.0.0.1:30111' }).current;
  const commandId = randomUUID(),
    body = canonical({ operation: 'CONNECTION_OPEN', attemptId: planned, commandId });
  state = update(p.db, state, {
    kind: 'INTENT',
    intent: {
      operation: 'OPEN',
      clientRequestJson: canonical({ contextId: 'fixture-context', sourceFormId: 'NET-002' }),
      commandId,
      attemptId: planned,
      canonicalOrigin: 'http://127.0.0.1:30111',
      campaignId,
      semanticBodyJson: body,
    },
  }).current;
  state = update(p.db, state, {
    kind: 'ACKNOWLEDGE',
    acknowledgement: {
      operation: 'OPEN',
      commandId,
      semanticBodySha256: sha(body),
      session: {
        technicalSessionId: randomUUID(),
        attemptId: planned,
        campaignProof: { campaignId, revisions: zero, checkpointSha256: 'a'.repeat(64) },
        connectionRevision: 0,
        receiptId: randomUUID(),
      },
      verifiedReceipt: { kind: 'verified-open-fixture' },
    },
  }).current;
  return state;
}
function prepared(p: ReturnType<typeof setup>) {
  let state = connected(p);
  const sourceUuid = randomUUID(),
    sourceChecksum = 'b'.repeat(64);
  state = update(p.db, state, {
    kind: 'SELECTION',
    selectedCandidates: [
      {
        sourceUuid,
        finalSnapshotVersion: 1,
        metadataRevision: 0,
        candidateSnapshotChecksum: sourceChecksum,
        requestedControllerSeat: p.tabId,
      },
    ],
  }).current;
  const witness = canonical({ kind: 'already-verified-host-fixture' });
  const candidates = [
    {
      descriptor: {
        sourceUuid,
        sourceSnapshotId: 'snapshot',
        finalSnapshotVersion: 1,
        metadataRevision: 0,
        sourceChecksum,
        exportChecksum: 'c'.repeat(64),
        exportBytesSha256: 'd'.repeat(64),
        baselineVersion: 'baseline',
      },
      exportDocument: { name: 'Immutable Alice' },
      canonicalWitnessText: witness,
      witnessSha256: sha(witness),
      byteLength: Buffer.byteLength(witness),
    },
  ];
  const batch = withBatchHash({
    requestId: randomUUID(),
    technicalSessionId: state.sessionOrNull!.technicalSessionId,
    connectionRevision: 0,
    campaignProof: state.sessionOrNull!.campaignProof,
    candidates,
  });
  state = update(p.db, state, { kind: 'PREPARE_BATCH', batch }).current;
  return { state, batch };
}
function close(p: ReturnType<typeof setup>, state: LocalNetworkApplication) {
  return commitLocalNetworkTabClose(
    p.db,
    {
      ...p.scope,
      closeCommandId: randomUUID(),
      closeReceiptId: randomUUID(),
      expectedRevisions: vector(state),
    },
    allow,
  );
}
function publicIdentity(): NetworkPublicIdentity {
  const key = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
  return {
    schemaVersion: 1,
    algorithm: 'ED25519',
    ownerDeviceId: randomUUID(),
    publicKeySpkiBase64: key.toString('base64'),
    keyFingerprintSha256: sha(key),
  };
}
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.open) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function submittedForReview(p: ReturnType<typeof setup>) {
  const preparedValue = prepared(p),
    batch = preparedValue.batch,
    commandId = randomUUID(),
    body = canonical({ commandId, requestId: batch.requestId });
  let current = update(p.db, preparedValue.state, {
    kind: 'INTENT',
    intent: {
      operation: 'SUBMIT',
      commandId,
      requestId: batch.requestId,
      batch,
      semanticBodyJson: body,
      clientRequestJson: canonical({ contextId: 'fixture-context', sourceFormId: 'NET-004' }),
    },
  }).current;
  current = update(p.db, current, {
    kind: 'ACKNOWLEDGE',
    acknowledgement: {
      operation: 'SUBMIT',
      commandId,
      semanticBodySha256: sha(body),
      request: {
        requestId: batch.requestId,
        technicalSessionId: batch.technicalSessionId,
        submitCommandId: commandId,
        submitReceiptId: randomUUID(),
        requestRevision: 0,
        status: 'PENDING',
        batchSha256: batch.batchSha256,
        closureOrNull: null,
      },
      verifiedReceipt: { verified: true },
    },
  }).current;
  const identity = publicIdentity();
  commitLocalNetworkHostPin(
    p.db,
    p.scope,
    {
      ownerDeviceId: p.scope.ownerDeviceId,
      campaignId: batch.campaignProof.campaignId,
      identity,
      initialCanonicalOrigin: 'http://127.0.0.1:30111',
      entryCommandId: p.entry.request.entryCommandId,
    },
    allow,
  );
  return { batch, commandId, current };
}
function bindingReceipt(
  p: ReturnType<typeof setup>,
  outbox: ReturnType<typeof prepareLocalRequestLaneBinding>,
): PeerLaneBindingReceipt {
  const request = outbox.request,
    submit = readLocalNetworkOutbox(p.db, p.scope, request.submitCommandId)!;
  if (submit.intent.operation !== 'SUBMIT') throw new Error('fixture submit');
  return {
    operation: 'BIND_LANE',
    commandId: request.commandId,
    receiptId: randomUUID(),
    semanticBodySha256: outbox.semanticBodySha256,
    binding: {
      campaignId: submit.intent.batch.campaignProof.campaignId,
      requestOwnerDeviceId: p.scope.ownerDeviceId,
      requestId: request.requestId,
      technicalSessionId: request.technicalSessionId,
      submitCommandId: request.submitCommandId,
      batchSha256: request.batchSha256,
      localControllerSeatId: request.localControllerSeatId,
    },
  };
}
function decisionProof(
  p: ReturnType<typeof setup>,
  batch: NetworkPreparedBatch,
  reject = false,
): VerifiedRequestReviewProof {
  const current = readLocalNetworkRequestCurrent(p.db, p.scope, batch.requestId);
  return {
    ...current.proof,
    decisions: [
      ...current.proof.decisions,
      {
        receiptId: randomUUID(),
        commandId: randomUUID(),
        workflowCommandId: reject
          ? 'UI-CMD-DEVICE-REQUEST-REJECT'
          : 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
        campaignId: batch.campaignProof.campaignId,
        requestId: batch.requestId,
        requestOwnerDeviceId: p.scope.ownerDeviceId,
        beforeRequestStatus: current.requestStatus,
        afterRequestStatus: reject ? 'REJECTED' : 'IN_REVIEW',
        beforeRequestRevision: current.requestRevision,
        requestRevision: current.requestRevision + 1,
        decisionReasonOrNull: reject ? 'Нужны исправления' : null,
        candidateSnapshotChecksums: batch.candidates.map((c) => c.descriptor.exportBytesSha256),
        authoritativeGmActorId: 'gm-profile',
        timestamp: '2026-10-30T12:00:00.000Z',
      },
    ] as VerifiedRequestReviewProof['decisions'],
  };
}
function advanceReview(p: ReturnType<typeof setup>, proof: VerifiedRequestReviewProof) {
  const current = readLocalNetworkApplication(p.db, p.scope);
  return commitLocalNetworkRequestAdvance(
    p.db,
    {
      ...p.scope,
      expectedRevisions: vector(current),
      expectedDraftRevision: current.draftRevision,
    },
    { eventId: randomUUID(), receiptId: randomUUID(), proof },
    allow,
  );
}
describe('owner request review enrichment and delivery', () => {
  it('derives the active request bundle from the same owned history and refuses corrupt outbox bytes without writes', () => {
    const p = setup();
    expect(readLocalNetworkRequestDeliverySnapshot(p.db, p.scope).outbox).toBeNull();
    const submitted = submittedForReview(p),
      before = p.db.serialize();
    expect(readLocalNetworkRequestDeliverySnapshot(p.db, p.scope)).toEqual(
      readLocalNetworkDeliverySnapshot(p.db, p.scope, submitted.commandId),
    );
    expect(p.db.serialize().equals(before)).toBe(true);
    p.db
      .prepare('UPDATE local_network_outbox SET record_sha256=? WHERE command_id=?')
      .run('0'.repeat(64), submitted.commandId);
    const corrupt = p.db.serialize();
    expect(() => readLocalNetworkRequestDeliverySnapshot(p.db, p.scope)).toThrow();
    expect(p.db.serialize().equals(corrupt)).toBe(true);
  });
  it('binds the retained original tab, preserves old ACK bytes, and survives reopen with newer decisions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-review-'));
    directories.push(dir);
    const file = join(dir, 'db.sqlite'),
      p = setup(file),
      s = submittedForReview(p);
    const oldAck = readLocalNetworkAcknowledgementEvent(p.db, p.scope, s.commandId)!,
      oldOutbox = readLocalNetworkOutbox(p.db, p.scope, s.commandId);
    const oldRow = p.db
      .prepare('SELECT * FROM local_network_application_event WHERE event_id=?')
      .get(oldAck.input.eventId);
    const lane = prepareLocalRequestLaneBinding(
        p.db,
        p.scope,
        s.batch.requestId,
        randomUUID(),
        allow,
      ),
      receipt = bindingReceipt(p, lane);
    expect(lane.origin.tabId).toBe(p.tabId);
    expect(lane.origin.submitCommandId).toBe(s.commandId);
    expect(lane.origin.submitIntentEventId).not.toBe(lane.request.commandId);
    const bound = acknowledgeLocalRequestLaneBinding(
      p.db,
      p.scope,
      lane.request.commandId,
      receipt,
      allow,
    );
    expect(bound.current.requestCurrentOrNull).toMatchObject({
      requestRevision: 0,
      requestStatus: 'PENDING',
    });
    const accepted = advanceReview(p, decisionProof(p, s.batch));
    expect(accepted.requestCurrentOrNull?.requestStatus).toBe('IN_REVIEW');
    const rejected = advanceReview(p, decisionProof(p, s.batch, true));
    expect(rejected.requestCurrentOrNull?.requestStatus).toBe('REJECTED');
    expect(
      readOwnedLocalNetworkTab(p.db, p.scope.ownerDeviceId, p.scope.networkScopeId)?.lifecycleState,
    ).toBe('UNBOUND');
    const before = p.db.serialize(),
      late = acknowledgeLocalRequestLaneBinding(
        p.db,
        p.scope,
        lane.request.commandId,
        receipt,
        allow,
      );
    expect(late.current.requestCurrentOrNull).toEqual(rejected.requestCurrentOrNull);
    expect(p.db.serialize().equals(before)).toBe(true);
    expect(readLocalNetworkOutbox(p.db, p.scope, s.commandId)).toEqual(oldOutbox);
    expect(
      p.db
        .prepare('SELECT * FROM local_network_application_event WHERE event_id=?')
        .get(oldAck.input.eventId),
    ).toEqual(oldRow);
    p.db.close();
    const db = open(file);
    expect(readLocalNetworkRequestCurrent(db, p.scope, s.batch.requestId)).toEqual(
      rejected.requestCurrentOrNull,
    );
    expect(readLocalRequestLaneBinding(db, p.scope, s.batch.requestId)?.receiptOrNull).toEqual(
      receipt,
    );
  });
  it('refuses generic same-revision lane enrichment, altered proof and unknown origin without writes', () => {
    const p = setup(),
      s = submittedForReview(p),
      lane = prepareLocalRequestLaneBinding(p.db, p.scope, s.batch.requestId, randomUUID(), allow),
      receipt = bindingReceipt(p, lane);
    const original = readLocalNetworkRequestCurrent(p.db, p.scope, s.batch.requestId).proof;
    const before = p.db.serialize();
    expect(() =>
      advanceReview(p, { ...original, laneProvenance: { kind: 'BIND_LANE', receipt } }),
    ).toThrow('STALE_REVISION');
    expect(p.db.serialize().equals(before)).toBe(true);
    const foreign = setup();
    const foreignBefore = foreign.db.serialize();
    expect(() =>
      prepareLocalRequestLaneBinding(
        foreign.db,
        foreign.scope,
        s.batch.requestId,
        randomUUID(),
        allow,
      ),
    ).toThrow('NOT_FOUND');
    expect(foreign.db.serialize().equals(foreignBefore)).toBe(true);
    acknowledgeLocalRequestLaneBinding(p.db, p.scope, lane.request.commandId, receipt, allow);
    const proof = decisionProof(p, s.batch),
      accepted = advanceReview(p, proof);
    const stable = p.db.serialize();
    expect(() =>
      advanceReview(p, {
        ...proof,
        decisions: proof.decisions.map((d) => ({ ...d, timestamp: '2026-10-31T00:00:00.000Z' })),
      }),
    ).toThrow('STALE_REVISION');
    expect(p.db.serialize().equals(stable)).toBe(true);
    const guard = vi.fn(allow),
      current = accepted.current;
    commitLocalNetworkRequestAdvance(
      p.db,
      {
        ...p.scope,
        expectedRevisions: vector(current),
        expectedDraftRevision: current.draftRevision,
      },
      { eventId: 'unused', receiptId: 'also-unused', proof },
      guard,
    );
    expect(guard).toHaveBeenCalled();
    expect(p.db.serialize().equals(stable)).toBe(true);
  });
  it('settles a losing CANCEL without rewriting or acknowledging its original intent', () => {
    const p = setup(),
      s = submittedForReview(p),
      lane = prepareLocalRequestLaneBinding(p.db, p.scope, s.batch.requestId, randomUUID(), allow);
    acknowledgeLocalRequestLaneBinding(
      p.db,
      p.scope,
      lane.request.commandId,
      bindingReceipt(p, lane),
      allow,
    );
    let current = readLocalNetworkApplication(p.db, p.scope);
    current = update(p.db, current, { kind: 'CANCEL_REASON', cancelReason: 'Отмена' }).current;
    const commandId = randomUUID(),
      body = canonical({ commandId, reason: 'Отмена' });
    current = update(p.db, current, {
      kind: 'INTENT',
      intent: {
        operation: 'CANCEL',
        commandId,
        requestId: s.batch.requestId,
        technicalSessionId: s.batch.technicalSessionId,
        requestRevision: 0,
        reason: 'Отмена',
        semanticBodyJson: body,
        clientRequestJson: canonical({ sourceFormId: 'NET-005' }),
      },
    }).current;
    const pending = readLocalNetworkOutbox(p.db, p.scope, commandId),
      proof = decisionProof(p, s.batch);
    const source = {
        ...p.scope,
        expectedRevisions: vector(current),
        expectedDraftRevision: current.draftRevision,
      },
      settlementInput = { eventId: randomUUID(), receiptId: randomUUID(), commandId, proof };
    expect(readLocalNetworkCancelSettlementEvent(p.db, p.scope, commandId)).toBeNull();
    const settled = commitLocalNetworkCancelSettlement(p.db, source, settlementInput, allow);
    expect(settled.current.pendingCommandIdOrNull).toBeNull();
    expect(settled.acknowledgementEvent).toBeNull();
    expect(settled.cancelSettlementOrNull?.commandId).toBe(commandId);
    expect(settled.requestCurrentOrNull?.requestStatus).toBe('IN_REVIEW');
    expect(readLocalNetworkOutbox(p.db, p.scope, commandId)).toEqual(pending);
    const before = p.db.serialize();
    const event = readLocalNetworkCancelSettlementEvent(p.db, p.scope, commandId)!;
    expect(event.input.eventId).toBe(settlementInput.eventId);
    expect(event.receipt.receiptId).toBe(settlementInput.receiptId);
    const replay = commitLocalNetworkCancelSettlement(p.db, source, settlementInput, allow);
    expect(replay).toEqual(settled);
    expect(p.db.serialize().equals(before)).toBe(true);
    for (const change of [
      { eventId: randomUUID() },
      { receiptId: randomUUID() },
      {
        proof: {
          ...proof,
          decisions: proof.decisions.map((d) => ({ ...d, timestamp: '2026-10-31T00:00:00.000Z' })),
        },
      },
    ]) {
      expect(() =>
        commitLocalNetworkCancelSettlement(p.db, source, { ...settlementInput, ...change }, allow),
      ).toThrow('IDEMPOTENCY_CONFLICT');
      expect(p.db.serialize().equals(before)).toBe(true);
    }
    const rejected = advanceReview(p, decisionProof(p, s.batch, true)),
      after = p.db.serialize();
    const oldEvent = readLocalNetworkCancelSettlementEvent(p.db, p.scope, commandId)!;
    expect(oldEvent.input).toEqual(event.input);
    expect(oldEvent.receipt).toEqual(event.receipt);
    expect(oldEvent.current).toEqual(rejected.current);
    const laterReplay = commitLocalNetworkCancelSettlement(p.db, source, settlementInput, allow);
    expect(laterReplay.current).toEqual(rejected.current);
    expect(laterReplay.cancelSettlementOrNull).toEqual(settled.cancelSettlementOrNull);
    expect(p.db.serialize().equals(after)).toBe(true);
    expect(readLocalNetworkOutbox(p.db, p.scope, commandId)).toEqual(pending);
    const foreign = setup();
    expect(() => readLocalNetworkCancelSettlementEvent(p.db, foreign.scope, commandId)).toThrow(
      'FOREIGN_OWNER',
    );
    expect(p.db.serialize().equals(after)).toBe(true);
  });
  it('checks exact advance event identity before equal-proof shortcuts and preserves old replay facts', () => {
    const p = setup(),
      s = submittedForReview(p),
      lane = prepareLocalRequestLaneBinding(p.db, p.scope, s.batch.requestId, randomUUID(), allow);
    acknowledgeLocalRequestLaneBinding(
      p.db,
      p.scope,
      lane.request.commandId,
      bindingReceipt(p, lane),
      allow,
    );
    const current = readLocalNetworkApplication(p.db, p.scope),
      source = {
        ...p.scope,
        expectedRevisions: vector(current),
        expectedDraftRevision: current.draftRevision,
      },
      input = { eventId: randomUUID(), receiptId: randomUUID(), proof: decisionProof(p, s.batch) };
    const accepted = commitLocalNetworkRequestAdvance(p.db, source, input, allow);
    const event = readLocalNetworkApplicationEvent(p.db, p.scope, input.eventId)!;
    const rejectedProof = decisionProof(p, s.batch, true),
      rejected = advanceReview(p, rejectedProof),
      before = p.db.serialize();
    const freshSource = {
      ...p.scope,
      expectedRevisions: vector(rejected.current),
      expectedDraftRevision: rejected.current.draftRevision,
    };
    for (const bad of [
      { ...input, proof: rejectedProof },
      { ...input, receiptId: randomUUID(), proof: rejectedProof },
      { eventId: '', receiptId: randomUUID(), proof: rejectedProof },
      { eventId: randomUUID(), receiptId: '', proof: rejectedProof },
      { eventId: randomUUID(), receiptId: input.receiptId, proof: rejectedProof },
    ]) {
      expect(() => commitLocalNetworkRequestAdvance(p.db, freshSource, bad, allow)).toThrow();
      expect(p.db.serialize().equals(before)).toBe(true);
    }
    const replay = commitLocalNetworkRequestAdvance(p.db, source, input, allow);
    expect(replay.current).toEqual(rejected.current);
    expect(replay.requestCurrentOrNull).toEqual(rejected.requestCurrentOrNull);
    const saved = readLocalNetworkApplicationEvent(p.db, p.scope, input.eventId)!;
    expect(saved.receipt).toEqual(event.receipt);
    expect(saved.input).toEqual(event.input);
    expect(saved.receipt.revisions).toEqual(vector(accepted.current));
    expect(p.db.serialize().equals(before)).toBe(true);
    const noOp = commitLocalNetworkRequestAdvance(
      p.db,
      freshSource,
      { eventId: randomUUID(), receiptId: randomUUID(), proof: rejectedProof },
      allow,
    );
    expect(noOp.current).toEqual(rejected.current);
    expect(p.db.serialize().equals(before)).toBe(true);
  });
  it('rejects a direct BIND command/local receipt alias before writes without bypassing the origin proof', () => {
    const p = setup(),
      s = submittedForReview(p),
      snapshot = p.db.serialize();
    const template = prepareLocalRequestLaneBinding(
      p.db,
      p.scope,
      s.batch.requestId,
      randomUUID(),
      allow,
    );
    // Clone the actual pre-BIND SQLite snapshot: all original entry/SUBMIT/pin rows are retained.
    const db = new Database(snapshot);
    db.pragma('foreign_keys=ON');
    dbs.push(db);
    const current = readLocalNetworkApplication(db, p.scope),
      commandId = randomUUID();
    const request = { ...template.request, commandId };
    const outbox = { ...template, request, semanticBodySha256: sha(canonical(request)) };
    const value: LocalNetworkMutationInput = {
      ...p.scope,
      expectedRevisions: vector(current),
      expectedDraftRevision: current.draftRevision,
      eventId: randomUUID(),
      receiptId: commandId,
      clientRequestJsonOrNull: null,
      mutation: { kind: 'LANE_BIND_INTENT', outbox },
    };
    const before = db.serialize();
    expect(() => commitLocalNetworkMutation(db, value, allow)).toThrow('INVALID_INPUT');
    expect(db.serialize().equals(before)).toBe(true);
    commitLocalNetworkMutation(db, { ...value, receiptId: randomUUID() }, allow);
    expect(readLocalRequestLaneBinding(db, p.scope, s.batch.requestId)?.request).toEqual(request);
  });
  it('preserves a confirmed CANCEL when the first BIND acknowledgement arrives only after reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-bind-late-first-'));
    directories.push(dir);
    const file = join(dir, 'db.sqlite'),
      p = setup(file),
      s = submittedForReview(p);
    const lane = prepareLocalRequestLaneBinding(
        p.db,
        p.scope,
        s.batch.requestId,
        randomUUID(),
        allow,
      ),
      receipt = bindingReceipt(p, lane);
    let current = readLocalNetworkApplication(p.db, p.scope);
    current = update(p.db, current, {
      kind: 'CANCEL_REASON',
      cancelReason: 'Отмена до BIND ACK',
    }).current;
    const commandId = randomUUID(),
      body = canonical({ commandId, reason: 'Отмена до BIND ACK' });
    current = update(p.db, current, {
      kind: 'INTENT',
      intent: {
        operation: 'CANCEL',
        commandId,
        requestId: s.batch.requestId,
        technicalSessionId: s.batch.technicalSessionId,
        requestRevision: 0,
        reason: 'Отмена до BIND ACK',
        semanticBodyJson: body,
        clientRequestJson: canonical({ sourceFormId: 'NET-005' }),
      },
    }).current;
    const request = {
      ...current.requestOrNull!,
      requestRevision: 1,
      closureOrNull: { commandId, receiptId: randomUUID(), reason: 'Отмена до BIND ACK' },
    };
    current = update(p.db, current, {
      kind: 'ACKNOWLEDGE',
      acknowledgement: {
        operation: 'CANCEL',
        commandId,
        semanticBodySha256: sha(body),
        request,
        verifiedReceipt: { verified: true },
      },
    }).current;
    const submit = readLocalNetworkOutbox(p.db, p.scope, s.commandId),
      cancel = readLocalNetworkOutbox(p.db, p.scope, commandId),
      before = readLocalNetworkRequestCurrent(p.db, p.scope, s.batch.requestId);
    expect(before.requestStatus).toBe('CANCELLED');
    expect(readLocalRequestLaneBinding(p.db, p.scope, s.batch.requestId)?.receiptOrNull).toBeNull();
    p.db.close();
    const db = open(file);
    const acknowledged = acknowledgeLocalRequestLaneBinding(
      db,
      p.scope,
      lane.request.commandId,
      receipt,
      allow,
    );
    expect(acknowledged.current.requestCurrentOrNull).toEqual({
      ...before,
      proof: { ...before.proof, laneProvenance: { kind: 'BIND_LANE', receipt } },
    });
    expect(acknowledged.current.current.formId).toBe(current.formId);
    expect(acknowledged.current.current.pendingCommandIdOrNull).toBeNull();
    expect(
      readOwnedLocalNetworkTab(db, p.scope.ownerDeviceId, p.scope.networkScopeId)?.lifecycleState,
    ).toBe('UNBOUND');
    expect(readLocalNetworkOutbox(db, p.scope, s.commandId)).toEqual(submit);
    expect(readLocalNetworkOutbox(db, p.scope, commandId)).toEqual(cancel);
    const stable = db.serialize();
    acknowledgeLocalRequestLaneBinding(db, p.scope, lane.request.commandId, receipt, allow);
    expect(db.serialize().equals(stable)).toBe(true);
  });
  it('rolls back lane/current/view together when the trusted callback returns a value or writes', () => {
    const p = setup(),
      s = submittedForReview(p);
    for (const guard of [
      () => false,
      () => Promise.resolve(),
      () => {
        p.db.prepare("UPDATE local_network_tab SET lifecycle_state='PROVISIONAL'").run();
      },
    ] as NetworkStoreGuard<LocalNetworkApplication>[]) {
      const before = p.db.serialize();
      expect(() =>
        prepareLocalRequestLaneBinding(p.db, p.scope, s.batch.requestId, randomUUID(), guard),
      ).toThrow();
      expect(p.db.serialize().equals(before)).toBe(true);
    }
  });
});

describe('local network application/outbox aggregate', () => {
  it('binds a retained shell exit to the exact navigation and rejects forged source/route before writing', () => {
    const p = setup();
    let s = connected(p);
    const ref = {
      sourceUuid: 'existing-final-source',
      finalSnapshotVersion: 1,
      metadataRevision: 0,
      candidateSnapshotChecksum: 'a'.repeat(64),
      requestedControllerSeat: p.tabId,
    };
    s = update(p.db, s, {
      kind: 'NAVIGATE',
      targetFormId: 'CHR-027',
      plannedAttemptIdOrNull: null,
      singleCandidateOrNull: ref,
    }).current;
    const navigationRequestId = randomUUID(),
      nav = {
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId,
        sourceFormId: 'CHR-027',
        actionKey: 'CHR-027::CTA::002',
        expectedProjectionRevision: s.projectionRevision,
      };
    const input: LocalNetworkMutationInput = {
      ...p.scope,
      eventId: `navigation:${navigationRequestId}`,
      receiptId: randomUUID(),
      expectedRevisions: vector(s),
      expectedDraftRevision: s.draftRevision,
      clientRequestJsonOrNull: canonical(nav),
      mutation: { kind: 'SHELL_EXIT', navigationRequestId, sourceUuid: ref.sourceUuid },
    };
    const before = p.db.serialize();
    expect(() =>
      commitLocalNetworkMutation(
        p.db,
        {
          ...input,
          mutation: { kind: 'SHELL_EXIT', navigationRequestId, sourceUuid: 'another-final' },
        },
        allow,
      ),
    ).toThrow('UNAVAILABLE');
    expect(() =>
      commitLocalNetworkMutation(
        p.db,
        {
          ...input,
          clientRequestJsonOrNull: canonical({ ...nav, actionKey: 'CHR-027::CTA::001' }),
        },
        allow,
      ),
    ).toThrow('INVALID_INPUT');
    expect(p.db.serialize().equals(before)).toBe(true);
    const saved = commitLocalNetworkMutation(p.db, input, allow);
    expect(
      readLocalNetworkShellExitByNavigationId(p.db, p.scope.ownerDeviceId, navigationRequestId),
    ).toEqual(saved);
    expect(saved.current.shellExitOrNull).toEqual({
      navigationRequestId,
      sourceUuid: ref.sourceUuid,
    });
    expect(vector(saved.current)).toEqual({
      ...vector(s),
      projectionRevision: s.projectionRevision + 1,
    });
    expect(
      readOwnedLocalNetworkTab(p.db, p.scope.ownerDeviceId, p.scope.networkScopeId)?.lifecycleState,
    ).toBe('UNBOUND');
    expect(commitLocalNetworkMutation(p.db, input, allow).receipt).toEqual(saved.receipt);
    const resumed = update(p.db, saved.current, {
      kind: 'NAVIGATE',
      targetFormId: 'CHR-027',
      plannedAttemptIdOrNull: null,
      singleCandidateOrNull: ref,
    }).current;
    expect(resumed.shellExitOrNull).toBeNull();
    expect(resumed.sessionOrNull).toEqual(s.sessionOrNull);
    expect(resumed.stateRevision).toBe(s.stateRevision);
  });
  it('rejects changed original browser context/source payload for the same event before replay', () => {
    const p = setup(),
      saved = update(p.db, readLocalNetworkApplication(p.db, p.scope), {
        kind: 'NAVIGATE',
        targetFormId: 'NET-002',
        plannedAttemptIdOrNull: 'opaque-attempt',
        singleCandidateOrNull: null,
      });
    const before = p.db.serialize(),
      guard = vi.fn(allow);
    for (const clientRequestJsonOrNull of [
      canonical({ contextId: 'other' }),
      canonical({ contextId: 'fixture-context', sourceFormId: 'CHR-027' }),
    ]) {
      expect(() =>
        commitLocalNetworkMutation(p.db, { ...saved.input, clientRequestJsonOrNull }, guard),
      ).toThrow('IDEMPOTENCY_CONFLICT');
    }
    expect(guard).not.toHaveBeenCalled();
    expect(p.db.serialize().equals(before)).toBe(true);
  });
  it.each(['NOT_SENT', 'FENCED_ABSENT'] as const)(
    'persists exact OPEN_FAILURE %s, keeps the session unconfirmed, and enables only explicit fresh retry',
    (proofKind) => {
      const p = setup();
      let state = readLocalNetworkApplication(p.db, p.scope);
      const campaignId = randomUUID();
      const attemptId = 'opaque-existing-attempt',
        commandId = randomUUID(),
        semanticBodyJson = canonical({ attemptId, commandId });
      state = update(p.db, state, {
        kind: 'NAVIGATE',
        targetFormId: 'NET-002',
        plannedAttemptIdOrNull: attemptId,
        singleCandidateOrNull: null,
      }).current;
      state = update(p.db, state, {
        kind: 'INTENT',
        intent: {
          operation: 'OPEN',
          clientRequestJson: canonical({ contextId: 'fixture-context', sourceFormId: 'NET-002' }),
          commandId,
          attemptId,
          canonicalOrigin: 'http://127.0.0.1:30111',
          campaignId,
          semanticBodyJson,
        },
      }).current;
      const failed = update(p.db, state, {
        kind: 'ACKNOWLEDGE',
        acknowledgement: {
          operation: 'OPEN_FAILURE',
          commandId,
          attemptId,
          semanticBodySha256: sha(semanticBodyJson),
          code: 'PEER_UNAVAILABLE',
          proofKind,
          verifiedReceipt: { fenced: proofKind === 'FENCED_ABSENT', attemptId },
        },
      });
      expect(failed.current).toMatchObject({
        formId: 'NET-011',
        lastAttemptIdOrNull: attemptId,
        plannedAttemptIdOrNull: attemptId,
        pendingCommandIdOrNull: null,
        diagnosticCodeOrNull: 'PEER_UNAVAILABLE',
        sessionOrNull: null,
      });
      expect(readLocalNetworkAcknowledgementEvent(p.db, p.scope, commandId)?.receipt).toEqual(
        failed.receipt,
      );
      const before = p.db.serialize();
      expect(commitLocalNetworkMutation(p.db, failed.input, allow)).toEqual(failed);
      expect(p.db.serialize().equals(before)).toBe(true);
      expect(() =>
        update(p.db, failed.current, {
          kind: 'INTENT',
          intent: {
            operation: 'OPEN',
            clientRequestJson: canonical({ contextId: 'fixture-context', sourceFormId: 'NET-011' }),
            commandId: randomUUID(),
            attemptId,
            canonicalOrigin: 'http://127.0.0.1:30111',
            campaignId,
            semanticBodyJson,
          },
        }),
      ).toThrow('UNAVAILABLE');
      expect(p.db.serialize().equals(before)).toBe(true);
      const retryAttemptId = randomUUID();
      const retry = update(p.db, failed.current, {
        kind: 'NAVIGATE',
        targetFormId: 'NET-011',
        plannedAttemptIdOrNull: retryAttemptId,
        singleCandidateOrNull: null,
      });
      expect(retry.current).toMatchObject({
        formId: 'NET-011',
        lastAttemptIdOrNull: attemptId,
        plannedAttemptIdOrNull: retryAttemptId,
        stateRevision: failed.current.stateRevision,
        projectionRevision: failed.current.projectionRevision + 1,
        draftRevision: failed.current.draftRevision,
      });
      const retryCommandId = randomUUID();
      const retryIntent = update(p.db, retry.current, {
        kind: 'INTENT',
        intent: {
          operation: 'OPEN',
          clientRequestJson: canonical({ contextId: 'fixture-context', sourceFormId: 'NET-011' }),
          commandId: retryCommandId,
          attemptId: retryAttemptId,
          canonicalOrigin: 'http://127.0.0.1:30111',
          campaignId,
          semanticBodyJson: canonical({ commandId: retryCommandId, attemptId: retryAttemptId }),
        },
      });
      expect(retryIntent.current.lastAttemptIdOrNull).toBe(retryAttemptId);
      const pendingSnapshot = p.db.serialize();
      expect(() =>
        update(p.db, retryIntent.current, {
          kind: 'NAVIGATE',
          targetFormId: 'NET-011',
          plannedAttemptIdOrNull: randomUUID(),
          singleCandidateOrNull: null,
        }),
      ).toThrow('UNAVAILABLE');
      for (const event of [failed, retry]) {
        expect(commitLocalNetworkMutation(p.db, event.input, allow)).toEqual({
          ...event,
          current: retryIntent.current,
        });
      }
      expect(p.db.serialize().equals(pendingSnapshot)).toBe(true);
      expect(readLocalNetworkApplication(p.db, p.scope)).toEqual(retryIntent.current);
      expect(readLocalNetworkAcknowledgementEvent(p.db, p.scope, commandId)?.receipt).toEqual(
        failed.receipt,
      );
    },
  );
  it('records a failed planned attempt before OPEN and preserves it when preparing NET-011 retry', () => {
    const p = setup(),
      attemptId = randomUUID();
    const planned = update(p.db, readLocalNetworkApplication(p.db, p.scope), {
      kind: 'NAVIGATE',
      targetFormId: 'NET-002',
      plannedAttemptIdOrNull: attemptId,
      singleCandidateOrNull: null,
    });
    const failure = update(p.db, planned.current, { kind: 'DIAGNOSTIC', code: 'INVALID_ADDRESS' });
    expect(failure.current).toMatchObject({
      formId: 'NET-011',
      lastAttemptIdOrNull: attemptId,
      plannedAttemptIdOrNull: attemptId,
      pendingCommandIdOrNull: null,
    });
    const before = p.db.serialize();
    expect(() =>
      update(p.db, failure.current, {
        kind: 'NAVIGATE',
        targetFormId: 'NET-011',
        plannedAttemptIdOrNull: attemptId,
        singleCandidateOrNull: null,
      }),
    ).toThrow('UNAVAILABLE');
    expect(p.db.serialize().equals(before)).toBe(true);
    const retryAttemptId = randomUUID();
    const retry = update(p.db, failure.current, {
      kind: 'NAVIGATE',
      targetFormId: 'NET-011',
      plannedAttemptIdOrNull: retryAttemptId,
      singleCandidateOrNull: null,
    });
    const repeatedDiagnostic = update(p.db, retry.current, {
      kind: 'DIAGNOSTIC',
      code: 'INVALID_ADDRESS',
    });
    expect(repeatedDiagnostic.current.lastAttemptIdOrNull).toBe(attemptId);
    expect(repeatedDiagnostic.current.plannedAttemptIdOrNull).toBe(retryAttemptId);
  });
  it('retains a confirmed technical session through offline presentation and refuses a new OPEN plan', () => {
    const p = setup(),
      confirmed = connected(p);
    const offline = update(p.db, confirmed, { kind: 'DIAGNOSTIC', code: 'PEER_UNAVAILABLE' });
    expect(offline.current).toMatchObject({
      formId: 'NET-011',
      sessionOrNull: confirmed.sessionOrNull,
      plannedAttemptIdOrNull: confirmed.plannedAttemptIdOrNull,
      lastAttemptIdOrNull: confirmed.lastAttemptIdOrNull,
    });
    const before = p.db.serialize();
    for (const targetFormId of ['NET-011', 'NET-002'] as const) {
      expect(() =>
        update(p.db, offline.current, {
          kind: 'NAVIGATE',
          targetFormId,
          plannedAttemptIdOrNull: randomUUID(),
          singleCandidateOrNull: null,
        }),
      ).toThrow('UNAVAILABLE');
      expect(p.db.serialize().equals(before)).toBe(true);
    }
    const address = update(p.db, offline.current, {
      kind: 'NAVIGATE',
      targetFormId: 'NET-002',
      plannedAttemptIdOrNull: null,
      singleCandidateOrNull: null,
    });
    expect(address.current.plannedAttemptIdOrNull).toBe(confirmed.plannedAttemptIdOrNull);
    const recovered = update(p.db, address.current, {
      kind: 'NAVIGATE',
      targetFormId: 'NET-003',
      plannedAttemptIdOrNull: null,
      singleCandidateOrNull: null,
    });
    expect(recovered.current.sessionOrNull).toEqual(confirmed.sessionOrNull);
    expect(recovered.current.stateRevision).toBe(confirmed.stateRevision);
    close(p, recovered.current);
    expect(
      readOwnedLocalNetworkTab(p.db, p.scope.ownerDeviceId, p.scope.networkScopeId),
    ).toBeNull();
  });
  it('derives initial state without writes and commits coherent draft/navigation revisions with immutable replay', () => {
    const p = setup(),
      before = p.db.serialize(),
      initial = readLocalNetworkApplication(p.db, p.scope);
    expect(initial).toMatchObject({
      ...zero,
      formId: 'NET-001',
      draftRevision: 0,
      plannedAttemptIdOrNull: null,
      lastAttemptIdOrNull: null,
    });
    expect(p.db.serialize().equals(before)).toBe(true);
    const first = update(p.db, initial, {
      kind: 'NAVIGATE',
      targetFormId: 'NET-002',
      plannedAttemptIdOrNull: randomUUID(),
      singleCandidateOrNull: null,
    });
    const edit = update(p.db, first.current, {
      kind: 'ADDRESS',
      addressOrQrPayload: '127.0.0.1:30111',
    });
    expect(edit.current).toMatchObject({
      stateRevision: 1,
      projectionRevision: 2,
      actorVisibilityRevision: 0,
      draftRevision: 1,
    });
    const noOp = update(p.db, edit.current, {
      kind: 'ADDRESS',
      addressOrQrPayload: edit.current.addressOrQrPayload,
    });
    expect(noOp.receipt.changed).toBe(false);
    expect(noOp.current).toEqual(edit.current);
    const saved = p.db.serialize();
    expect(commitLocalNetworkMutation(p.db, first.input, allow)).toEqual({
      ...first,
      current: noOp.current,
    });
    expect(p.db.serialize().equals(saved)).toBe(true);
    expect(() =>
      commitLocalNetworkMutation(
        p.db,
        { ...first.input, mutation: { kind: 'DIAGNOSTIC', code: 'PEER_UNAVAILABLE' } },
        allow,
      ),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(p.db.serialize().equals(saved)).toBe(true);
  });
  it('pins selected bytes before SUBMIT and blocks UNBOUND closure while remote outcome is unknown', () => {
    const p = setup(),
      { state, batch } = prepared(p),
      commandId = randomUUID();
    const semanticBodyJson = canonical({
      operation: 'SUBMIT',
      requestId: batch.requestId,
      commandId,
    });
    const sent = update(p.db, state, {
      kind: 'INTENT',
      intent: {
        operation: 'SUBMIT',
        clientRequestJson: canonical({ contextId: 'fixture-context', sourceFormId: 'NET-004' }),
        commandId,
        requestId: batch.requestId,
        semanticBodyJson,
        batch,
      },
    });
    expect(
      readOwnedLocalNetworkTab(p.db, p.scope.ownerDeviceId, p.scope.networkScopeId)?.lifecycleState,
    ).toBe('UNBOUND');
    const before = p.db.serialize();
    expect(() => close(p, sent.current)).toThrow('CLOSE_UNAVAILABLE');
    expect(p.db.serialize().equals(before)).toBe(true);
    expect(readLocalNetworkOutbox(p.db, p.scope, commandId)).toMatchObject({
      acknowledgementOrNull: null,
      intent: { batch },
    });
    // No NOT_FOUND mutation exists: a diagnostic keeps the exact unresolved command/bytes.
    const lost = update(p.db, sent.current, {
      kind: 'DIAGNOSTIC',
      code: 'UNCONFIRMED_OUTCOME',
    }).current;
    expect(lost.pendingCommandIdOrNull).toBe(commandId);
    expect(readLocalNetworkOutbox(p.db, p.scope, commandId)?.intent).toEqual(
      sent.input.mutation.kind === 'INTENT' ? sent.input.mutation.intent : null,
    );
    expect(() => close(p, lost)).toThrow();
  });
  it('durably acknowledges SUBMIT and explicit confirmed CANCEL, preserves original bytes, and reopens without RAM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'network-app-'));
    directories.push(dir);
    const filename = join(dir, 'state.sqlite'),
      p = setup(filename),
      preparedValue = prepared(p);
    const batch = preparedValue.batch,
      submitId = randomUUID(),
      submitBody = canonical({ commandId: submitId, requestId: batch.requestId });
    let state = update(p.db, preparedValue.state, {
      kind: 'INTENT',
      intent: {
        operation: 'SUBMIT',
        clientRequestJson: canonical({ contextId: 'fixture-context', sourceFormId: 'NET-004' }),
        commandId: submitId,
        requestId: batch.requestId,
        semanticBodyJson: submitBody,
        batch,
      },
    }).current;
    const confirmed = {
      requestId: batch.requestId,
      technicalSessionId: batch.technicalSessionId,
      submitCommandId: submitId,
      submitReceiptId: randomUUID(),
      requestRevision: 0,
      status: 'PENDING' as const,
      batchSha256: batch.batchSha256,
      closureOrNull: null,
    };
    state = update(p.db, state, {
      kind: 'ACKNOWLEDGE',
      acknowledgement: {
        operation: 'SUBMIT',
        commandId: submitId,
        semanticBodySha256: sha(submitBody),
        request: confirmed,
        verifiedReceipt: { verified: true },
      },
    }).current;
    expect(
      readOwnedLocalNetworkTab(p.db, p.scope.ownerDeviceId, p.scope.networkScopeId)?.lifecycleState,
    ).toBe('PROVISIONAL');
    const originalSubmitAck = readLocalNetworkAcknowledgementEvent(p.db, p.scope, submitId)!;
    expect(originalSubmitAck.input.mutation.kind).toBe('ACKNOWLEDGE');
    expect(() => close(p, state)).toThrow();
    state = update(p.db, state, {
      kind: 'CANCEL_REASON',
      cancelReason: 'Выбрал другой состав',
    }).current;
    const cancelId = randomUUID(),
      cancelBody = canonical({ commandId: cancelId, reason: state.cancelReason });
    state = update(p.db, state, {
      kind: 'INTENT',
      intent: {
        operation: 'CANCEL',
        clientRequestJson: canonical({ contextId: 'fixture-context', sourceFormId: 'NET-005' }),
        commandId: cancelId,
        requestId: batch.requestId,
        technicalSessionId: batch.technicalSessionId,
        requestRevision: 0,
        reason: state.cancelReason,
        semanticBodyJson: cancelBody,
      },
    }).current;
    const cancelled = update(p.db, state, {
      kind: 'ACKNOWLEDGE',
      acknowledgement: {
        operation: 'CANCEL',
        commandId: cancelId,
        semanticBodySha256: sha(cancelBody),
        request: {
          ...confirmed,
          requestRevision: 1,
          closureOrNull: {
            commandId: cancelId,
            receiptId: randomUUID(),
            reason: state.cancelReason,
          },
        },
        verifiedReceipt: { cancelled: true },
      },
    });
    expect(cancelled.current).toMatchObject({
      formId: 'NET-003',
      cancelReason: '',
      pendingCommandIdOrNull: null,
      preparedBatchOrNull: null,
    });
    const original = readLocalNetworkOutbox(p.db, p.scope, submitId);
    p.db.close();
    const reopened = open(filename);
    expect(readLocalNetworkApplication(reopened, p.scope)).toEqual(cancelled.current);
    expect(readLocalNetworkOutbox(reopened, p.scope, submitId)).toEqual(original);
    expect(readLocalNetworkAcknowledgementEvent(reopened, p.scope, submitId)).toEqual({
      ...originalSubmitAck,
      current: cancelled.current,
    });
    const delivery = readLocalNetworkDeliverySnapshot(reopened, p.scope, submitId);
    expect(delivery).toEqual({
      current: cancelled.current,
      outbox: original,
      acknowledgementEvent: { ...originalSubmitAck, current: cancelled.current },
      requestCurrentOrNull: {
        requestStatus: 'CANCELLED',
        requestRevision: 1,
        proof: {
          submittedReceipt: {
            operation: 'SUBMIT',
            commandId: submitId,
            receiptId: confirmed.submitReceiptId,
            semanticBodySha256: sha(submitBody),
            request: confirmed,
          },
          cancelledReceiptOrNull: {
            operation: 'CANCEL',
            commandId: cancelId,
            receiptId: cancelled.current.requestOrNull!.closureOrNull!.receiptId,
            semanticBodySha256: sha(cancelBody),
            request: cancelled.current.requestOrNull,
          },
          decisions: [],
          laneProvenance: null,
        },
      },
      cancelSettlementOrNull: null,
    });
    expect(delivery.acknowledgementEvent!.receipt.revisions).not.toEqual(vector(delivery.current));
    expect(() =>
      readLocalNetworkDeliverySnapshot(
        reopened,
        { ...p.scope, networkScopeId: randomUUID() },
        submitId,
      ),
    ).toThrow('FOREIGN_OWNER');
    expect(commitLocalNetworkMutation(reopened, cancelled.input, allow)).toEqual(cancelled);
    expect(
      readOwnedLocalNetworkTab(reopened, p.scope.ownerDeviceId, p.scope.networkScopeId)
        ?.lifecycleState,
    ).toBe('UNBOUND');
  });
  it('binds host identity to campaign independently of address and rejects changed key/reset ownership', () => {
    const p = setup(),
      identity = publicIdentity(),
      campaignId = randomUUID();
    const pin = {
      ownerDeviceId: p.scope.ownerDeviceId,
      campaignId,
      identity,
      initialCanonicalOrigin: 'http://127.0.0.1:30111',
      entryCommandId: p.entry.request.entryCommandId,
    };
    commitLocalNetworkHostPin(p.db, p.scope, pin, allow);
    const before = p.db.serialize();
    expect(
      commitLocalNetworkHostPin(
        p.db,
        p.scope,
        { ...pin, initialCanonicalOrigin: 'http://192.168.1.10:30111' },
        allow,
      ),
    ).toEqual(pin);
    expect(p.db.serialize().equals(before)).toBe(true);
    expect(() =>
      commitLocalNetworkHostPin(p.db, p.scope, { ...pin, identity: publicIdentity() }, allow),
    ).toThrow('KEY_CONFLICT');
    expect(p.db.serialize().equals(before)).toBe(true);
    resetDeviceIdentity(p.db, allow);
    const newOwner = bootstrapDeviceIdentity(p.db);
    expect(readLocalNetworkHostPin(p.db, newOwner, campaignId)).toBeNull();
    expect(() => readLocalNetworkHostPin(p.db, p.scope.ownerDeviceId, campaignId)).toThrow(
      'FOREIGN_OWNER',
    );
  });
  it.each(['record', 'journal', 'next-hash', 'vector', 'missing-head'] as const)(
    'rejects %s corruption even with recalculated row checksums',
    (damage) => {
      const p = setup();
      connected(p);
      if (damage === 'missing-head') p.db.prepare('DELETE FROM local_network_application').run();
      else {
        const table =
          damage === 'journal' || damage === 'next-hash'
            ? 'local_network_application_event'
            : damage === 'vector'
              ? 'local_network_tab'
              : 'local_network_application';
        const row = p.db.prepare(`SELECT rowid,record_json FROM ${table} LIMIT 1`).get() as {
          rowid: number;
          record_json: string;
        };
        const value = JSON.parse(row.record_json) as Record<string, unknown>;
        if (damage === 'journal') value['previousSha256'] = 'f'.repeat(64);
        else if (damage === 'next-hash') value['nextSha256'] = 'f'.repeat(64);
        else if (damage === 'vector') value['stateRevision'] = 123;
        else value['addressOrQrPayload'] = 'changed';
        const text = canonical(value);
        p.db
          .prepare(`UPDATE ${table} SET record_json=?,record_sha256=? WHERE rowid=?`)
          .run(text, sha(text), row.rowid);
      }
      const before = p.db.serialize();
      expect(() => readLocalNetworkApplication(p.db, p.scope)).toThrow();
      expect(() => readLocalNetworkDeliverySnapshot(p.db, p.scope, 'unknown-command')).toThrow();
      expect(() =>
        readOwnedLocalNetworkTab(p.db, p.scope.ownerDeviceId, p.scope.networkScopeId),
      ).toThrow();
      expect(p.db.serialize().equals(before)).toBe(true);
    },
  );
  it.each(['trigger', 'late-guard'] as const)(
    'rolls back event, cursor, vector, and outbox after %s failure',
    (fault) => {
      const p = setup(),
        initial = readLocalNetworkApplication(p.db, p.scope);
      const first = update(p.db, initial, {
        kind: 'NAVIGATE',
        targetFormId: 'NET-002',
        plannedAttemptIdOrNull: randomUUID(),
        singleCandidateOrNull: null,
      });
      const next = {
        ...first.input,
        eventId: randomUUID(),
        receiptId: randomUUID(),
        expectedRevisions: vector(first.current),
        mutation: { kind: 'ADDRESS' as const, addressOrQrPayload: '127.0.0.1:30112' },
      };
      if (fault === 'trigger')
        p.db.exec(
          "CREATE TRIGGER fail_application AFTER UPDATE ON local_network_tab BEGIN SELECT RAISE(ABORT,'private fixture'); END",
        );
      const before = p.db.serialize();
      let calls = 0;
      expect(() =>
        commitLocalNetworkMutation(p.db, next, () => {
          if (fault === 'late-guard' && ++calls === 2) throw new Error('expired delivery lease');
        }),
      ).toThrow();
      expect(p.db.serialize().equals(before)).toBe(true);
    },
  );
  it.each(['promise', 'throw-promise', 'commit', 'write'] as const)(
    'rejects trusted guard %s without leaked event or unhandled rejection',
    async (fault) => {
      const p = setup(),
        current = readLocalNetworkApplication(p.db, p.scope);
      const input: LocalNetworkMutationInput = {
        ...p.scope,
        clientRequestJsonOrNull: canonical({ contextId: 'fixture-context' }),
        eventId: randomUUID(),
        receiptId: randomUUID(),
        expectedRevisions: zero,
        expectedDraftRevision: 0,
        mutation: {
          kind: 'NAVIGATE',
          targetFormId: 'NET-002',
          plannedAttemptIdOrNull: randomUUID(),
          singleCandidateOrNull: null,
        },
      };
      const before = p.db.serialize(),
        guard = vi.fn(() => {
          if (fault === 'promise') return Promise.reject(new Error('private marker'));
          // Deliberately malformed trusted callback exercises thrown native-Promise handling.
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          if (fault === 'throw-promise') throw Promise.reject(new Error('private marker'));
          if (fault === 'commit') p.db.exec('COMMIT');
          else p.db.prepare('DELETE FROM local_network_active_tab').run();
          return undefined;
        });
      expect(() =>
        commitLocalNetworkMutation(
          p.db,
          input,
          guard as unknown as NetworkStoreGuard<LocalNetworkApplication>,
        ),
      ).toThrow();
      await setImmediate();
      expect(p.db.serialize().equals(before)).toBe(true);
      expect(readLocalNetworkApplication(p.db, p.scope)).toEqual(current);
    },
  );
  it('refuses stale updates and foreign event reads before callbacks and never exposes a stored private message', () => {
    const p = setup(),
      first = update(p.db, readLocalNetworkApplication(p.db, p.scope), {
        kind: 'NAVIGATE',
        targetFormId: 'NET-002',
        plannedAttemptIdOrNull: randomUUID(),
        singleCandidateOrNull: null,
      }),
      before = p.db.serialize(),
      guard = vi.fn(allow);
    expect(() =>
      commitLocalNetworkMutation(
        p.db,
        { ...first.input, eventId: randomUUID(), receiptId: randomUUID() },
        guard,
      ),
    ).toThrow('STALE_REVISION');
    expect(guard).not.toHaveBeenCalled();
    expect(p.db.serialize().equals(before)).toBe(true);
    expect(() =>
      readLocalNetworkApplicationEvent(
        p.db,
        { ...p.scope, networkScopeId: randomUUID() },
        first.input.eventId,
      ),
    ).toThrow('FOREIGN_OWNER');
    expect(() =>
      update(p.db, first.current, {
        kind: 'DIAGNOSTIC',
        code: 'private peer error',
      } as unknown as LocalNetworkMutation),
    ).toThrow('INVALID_INPUT');
  });
});
