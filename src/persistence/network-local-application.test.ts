import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import type Database from 'better-sqlite3';
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
  readLocalNetworkShellExitByNavigationId,
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
