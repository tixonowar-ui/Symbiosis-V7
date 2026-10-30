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
  type HostedNetworkPrincipal,
  type HostedNetworkInput,
  type HostedNetworkCommand,
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
    requestId: value.requestId,
    technicalSessionId: value.technicalSessionId,
    connectionRevision: value.connectionRevision,
    campaignProof: value.campaignProof,
    candidates: value.candidates,
  };
  return { ...body, batchSha256: sha(canonical(body)) };
}
const open = (filename = ':memory:') => {
  const db = openPersistenceDatabase(filename);
  databases.push(db);
  return db;
};
function setup(filename = ':memory:') {
  const db = open(filename),
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
  _p: ReturnType<typeof setup>,
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
    expect(p.db.serialize()).toEqual(before);
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
    expect(p.db.serialize()).toEqual(before);
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
    expect(p.db.serialize()).toEqual(after);
    expect(() =>
      commitHostedNetworkCommand(
        p.db,
        p.principal,
        { ...opened.input, commandId: randomUUID(), receiptId: randomUUID() },
        allow,
        allow,
      ),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(p.db.serialize()).toEqual(after);
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
    expect(p.db.serialize()).toEqual(bytes);
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
      expect(p.db.serialize()).toEqual(before);
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
      expect(p.db.serialize()).toEqual(before);
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
      expect(p.db.serialize()).toEqual(before);
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
      expect(p.db.serialize()).toEqual(before);
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
    expect(p.db.serialize()).toEqual(before);
    resetDeviceIdentity(p.db, allow);
    bootstrapDeviceIdentity(p.db);
    expect(() =>
      readHostedNetworkCommand(p.db, p.principal, opening.input.commandId, allow),
    ).toThrow('FOREIGN_OWNER');
  });
});
