import type Database from 'better-sqlite3';
import type { RevisionTriple } from './store.js';
import {
  readHostedCurrentPausedCampaign,
  type CurrentPausedCampaignHeader,
} from './current-paused-campaign.js';
import {
  readHostedCampaignCreationOrigin,
  readLocalGmProfile,
  type CampaignPrivateOwnerValidator,
} from './campaign-creation.js';
import { loadDeviceId } from './device-identity.js';
import { loadCampaignCheckpoint } from './store.js';
import { V1_LIFECYCLE_STATES } from './migrations/0001-initial.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import type {
  NetworkCampaignProof,
  NetworkPreparedBatch,
  NetworkPublicIdentity,
  NetworkStoreGuard,
} from './network-local-application.js';

export interface HostedNetworkPrincipal {
  readonly hostOwnerDeviceId: string;
  readonly campaignId: string;
  readonly peerIdentity: NetworkPublicIdentity;
}
export interface HostedTechnicalSession extends RevisionTriple {
  readonly schemaVersion: 1;
  readonly principal: HostedNetworkPrincipal;
  readonly technicalSessionId: string;
  readonly attemptId: string;
  readonly commandId: string;
  readonly receiptId: string;
  readonly connectionRevision: number;
  readonly campaignProof: NetworkCampaignProof;
}
export interface HostedDeviceRequest extends RevisionTriple {
  readonly schemaVersion: 1;
  readonly principal: HostedNetworkPrincipal;
  readonly requestId: string;
  readonly technicalSessionId: string;
  readonly submitCommandId: string;
  readonly submitReceiptId: string;
  readonly requestRevision: number;
  readonly status: 'PENDING';
  readonly batch: NetworkPreparedBatch;
  readonly closureOrNull: null | {
    readonly commandId: string;
    readonly receiptId: string;
    readonly reason: string;
  };
}
export type HostedNetworkInput =
  | {
      readonly operation: 'OPEN';
      readonly commandId: string;
      readonly receiptId: string;
      readonly attemptId: string;
      readonly technicalSessionId: string;
      readonly campaignProof: NetworkCampaignProof;
      readonly semanticBodyJson: string;
    }
  | {
      readonly operation: 'SUBMIT';
      readonly commandId: string;
      readonly receiptId: string;
      readonly requestId: string;
      readonly technicalSessionId: string;
      readonly expectedConnectionRevision: number;
      readonly batch: NetworkPreparedBatch;
      readonly semanticBodyJson: string;
    }
  | {
      readonly operation: 'CANCEL';
      readonly commandId: string;
      readonly receiptId: string;
      readonly requestId: string;
      readonly technicalSessionId: string;
      readonly expectedRequestRevision: number;
      readonly reason: string;
      readonly semanticBodyJson: string;
    };
export type HostedNetworkReceipt =
  | {
      readonly operation: 'OPEN';
      readonly commandId: string;
      readonly receiptId: string;
      readonly semanticBodySha256: string;
      readonly session: HostedTechnicalSession;
    }
  | {
      readonly operation: 'SUBMIT' | 'CANCEL';
      readonly commandId: string;
      readonly receiptId: string;
      readonly semanticBodySha256: string;
      readonly request: HostedDeviceRequest;
    };
export interface HostedNetworkCommand {
  readonly principal: HostedNetworkPrincipal;
  readonly input: HostedNetworkInput;
  readonly receipt: HostedNetworkReceipt;
  readonly current: HostedTechnicalSession | HostedDeviceRequest;
}
export interface HostedNetworkSource {
  readonly principal: HostedNetworkPrincipal;
  readonly campaign: CurrentPausedCampaignHeader;
  readonly sessionOrNull: HostedTechnicalSession | null;
  readonly requestOrNull: HostedDeviceRequest | null;
}
export type HostedNetworkSourceGuard = NetworkStoreGuard<HostedNetworkSource>;

type Row = Record<string, unknown>;
const principalKeys = ['hostOwnerDeviceId', 'campaignId', 'peerIdentity'] as const;
function principal(value: unknown): HostedNetworkPrincipal {
  const row = s.object(value, principalKeys);
  return {
    hostOwnerDeviceId: s.uuid(row['hostOwnerDeviceId']),
    campaignId: s.uuid(row['campaignId']),
    peerIdentity: s.identity(row['peerIdentity']),
  };
}
function input(value: unknown): HostedNetworkInput {
  const row = s.object(value),
    operation = row['operation'];
  const common = {
    commandId: s.text(row['commandId']),
    receiptId: s.text(row['receiptId']),
    semanticBodyJson: s.semanticBody(row['semanticBodyJson']),
  };
  if (common.commandId === common.receiptId) return s.fail();
  if (operation === 'OPEN') {
    s.object(row, [
      'operation',
      'commandId',
      'receiptId',
      'attemptId',
      'technicalSessionId',
      'campaignProof',
      'semanticBodyJson',
    ]);
    return {
      ...common,
      operation,
      attemptId: s.text(row['attemptId']),
      technicalSessionId: s.uuid(row['technicalSessionId']),
      campaignProof: s.campaignProof(row['campaignProof']),
    };
  }
  if (operation === 'SUBMIT') {
    s.object(row, [
      'operation',
      'commandId',
      'receiptId',
      'requestId',
      'technicalSessionId',
      'expectedConnectionRevision',
      'batch',
      'semanticBodyJson',
    ]);
    const batch = s.batch(row['batch']);
    if (
      batch.requestId !== row['requestId'] ||
      batch.technicalSessionId !== row['technicalSessionId'] ||
      batch.connectionRevision !== row['expectedConnectionRevision']
    )
      return s.fail();
    return {
      ...common,
      operation,
      requestId: batch.requestId,
      technicalSessionId: batch.technicalSessionId,
      expectedConnectionRevision: batch.connectionRevision,
      batch,
    };
  }
  if (operation !== 'CANCEL') return s.fail();
  s.object(row, [
    'operation',
    'commandId',
    'receiptId',
    'requestId',
    'technicalSessionId',
    'expectedRequestRevision',
    'reason',
    'semanticBodyJson',
  ]);
  if (s.text(row['reason']).trim() === '') return s.fail();
  return {
    ...common,
    operation,
    requestId: s.uuid(row['requestId']),
    technicalSessionId: s.uuid(row['technicalSessionId']),
    expectedRequestRevision: s.integer(row['expectedRequestRevision']),
    reason: row['reason'] as string,
  };
}
function source(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  validate: CampaignPrivateOwnerValidator,
): CurrentPausedCampaignHeader {
  s.owner(db, p.hostOwnerDeviceId);
  return readHostedCurrentPausedCampaign(db, p.campaignId, validate);
}
function rawCommand(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  id: string,
): Omit<HostedNetworkCommand, 'current'> | null {
  const row = s.at(db, 'hosted_network_command', 'command_id', id);
  if (row === undefined) return null;
  const value = s.object(s.checked(row), ['principal', 'input', 'receipt']);
  const bound = principal(value['principal']),
    i = input(value['input']);
  if (
    !s.same(bound, p) ||
    row['host_owner_device_id'] !== p.hostOwnerDeviceId ||
    row['campaign_id'] !== p.campaignId ||
    row['peer_device_id'] !== p.peerIdentity.ownerDeviceId
  )
    return s.fail('FOREIGN_OWNER');
  if (i.commandId !== id || row['receipt_id'] !== i.receiptId || row['operation'] !== i.operation)
    return s.fail();
  const receipt = value['receipt'] as HostedNetworkReceipt;
  s.object(receipt, [
    'operation',
    'commandId',
    'receiptId',
    'semanticBodySha256',
    i.operation === 'OPEN' ? 'session' : 'request',
  ]);
  if (
    receipt.operation !== i.operation ||
    receipt.commandId !== i.commandId ||
    receipt.receiptId !== i.receiptId ||
    receipt.semanticBodySha256 !== s.sha(i.semanticBodyJson)
  )
    return s.fail();
  return { principal: bound, input: i, receipt };
}
function sessionFor(
  p: HostedNetworkPrincipal,
  i: Extract<HostedNetworkInput, { operation: 'OPEN' }>,
): HostedTechnicalSession {
  if (i.campaignProof.campaignId !== p.campaignId) return s.fail();
  return {
    schemaVersion: 1,
    principal: p,
    technicalSessionId: i.technicalSessionId,
    attemptId: i.attemptId,
    commandId: i.commandId,
    receiptId: i.receiptId,
    connectionRevision: 0,
    campaignProof: i.campaignProof,
    ...s.zero(),
  };
}
function requestFor(
  p: HostedNetworkPrincipal,
  i: Extract<HostedNetworkInput, { operation: 'SUBMIT' }>,
): HostedDeviceRequest {
  if (i.batch.campaignProof.campaignId !== p.campaignId) return s.fail();
  return {
    schemaVersion: 1,
    principal: p,
    requestId: i.requestId,
    technicalSessionId: i.technicalSessionId,
    submitCommandId: i.commandId,
    submitReceiptId: i.receiptId,
    requestRevision: 0,
    status: 'PENDING',
    batch: i.batch,
    closureOrNull: null,
    ...s.zero(),
  };
}
function cancelled(
  previous: HostedDeviceRequest,
  i: Extract<HostedNetworkInput, { operation: 'CANCEL' }>,
): HostedDeviceRequest {
  if (
    previous.closureOrNull !== null ||
    previous.requestRevision !== i.expectedRequestRevision ||
    previous.requestId !== i.requestId ||
    previous.technicalSessionId !== i.technicalSessionId
  )
    return s.fail('STALE_REVISION');
  return {
    ...previous,
    requestRevision: s.increment(previous.requestRevision),
    stateRevision: s.increment(previous.stateRevision),
    projectionRevision: s.increment(previous.projectionRevision),
    closureOrNull: { commandId: i.commandId, receiptId: i.receiptId, reason: i.reason },
  };
}
function peer(db: Database.Database, p: HostedNetworkPrincipal): boolean {
  const row = db
    .prepare('SELECT * FROM hosted_network_peer WHERE host_owner_device_id=? AND peer_device_id=?')
    .get(p.hostOwnerDeviceId, p.peerIdentity.ownerDeviceId) as Row | undefined;
  if (row === undefined) return false;
  const value = s.object(s.checked(row), ['hostOwnerDeviceId', 'identity']);
  if (
    value['hostOwnerDeviceId'] !== p.hostOwnerDeviceId ||
    row['key_fingerprint'] !== p.peerIdentity.keyFingerprintSha256 ||
    !s.same(s.identity(value['identity']), p.peerIdentity)
  )
    return s.fail('KEY_CONFLICT');
  return true;
}
function readSession(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  id: string,
): HostedTechnicalSession {
  if (!peer(db, p)) return s.fail('NOT_FOUND');
  const row = s.at(db, 'hosted_technical_session', 'technical_session_id', id);
  if (row === undefined) return s.fail('NOT_FOUND');
  if (
    row['host_owner_device_id'] !== p.hostOwnerDeviceId ||
    row['campaign_id'] !== p.campaignId ||
    row['peer_device_id'] !== p.peerIdentity.ownerDeviceId
  )
    return s.fail('FOREIGN_OWNER');
  const command = rawCommand(db, p, s.text(row['opening_command_id'])) ?? s.fail();
  if (command.input.operation !== 'OPEN' || command.receipt.operation !== 'OPEN') return s.fail();
  const expected = sessionFor(p, command.input);
  if (
    expected.technicalSessionId !== id ||
    row['attempt_id'] !== expected.attemptId ||
    !s.same(s.checked(row), expected) ||
    !s.same(command.receipt.session, expected)
  )
    return s.fail();
  return expected;
}
function readRequest(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  id: string,
): HostedDeviceRequest {
  const row = s.at(db, 'hosted_device_request', 'request_id', id);
  if (row === undefined) return s.fail('NOT_FOUND');
  if (
    row['host_owner_device_id'] !== p.hostOwnerDeviceId ||
    row['campaign_id'] !== p.campaignId ||
    row['peer_device_id'] !== p.peerIdentity.ownerDeviceId
  )
    return s.fail('FOREIGN_OWNER');
  const submit = rawCommand(db, p, s.text(row['submit_command_id'])) ?? s.fail();
  if (submit.input.operation !== 'SUBMIT' || submit.receipt.operation !== 'SUBMIT') return s.fail();
  let expected = requestFor(p, submit.input);
  readSession(db, p, expected.technicalSessionId);
  if (
    !s.same(submit.receipt.request, expected) ||
    row['technical_session_id'] !== expected.technicalSessionId ||
    expected.requestId !== id
  )
    return s.fail();
  const value = s.object(s.checked(row));
  const close = value['closureOrNull'];
  if (close !== null) {
    const closure = s.object(close, ['commandId', 'receiptId', 'reason']);
    const cancellation = rawCommand(db, p, s.text(closure['commandId'])) ?? s.fail();
    if (cancellation.input.operation !== 'CANCEL' || cancellation.receipt.operation !== 'CANCEL')
      return s.fail();
    expected = cancelled(expected, cancellation.input);
    if (!s.same(cancellation.receipt.request, expected)) return s.fail();
  }
  if (row['closed'] !== (close === null ? 0 : 1) || !s.same(value, expected)) return s.fail();
  return expected;
}
function command(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  id: string,
): HostedNetworkCommand | null {
  const saved = rawCommand(db, p, id);
  if (saved === null) return null;
  let current: HostedTechnicalSession | HostedDeviceRequest;
  if (saved.input.operation === 'OPEN')
    current = readSession(db, p, saved.input.technicalSessionId);
  else current = readRequest(db, p, saved.input.requestId);
  // A cancellation receipt is the current terminal snapshot; SUBMIT keeps its original snapshot.
  if (
    saved.input.operation === 'CANCEL' &&
    saved.receipt.operation === 'CANCEL' &&
    !s.same(saved.receipt.request, current)
  )
    return s.fail();
  return { ...saved, current };
}
function ownedRead<T>(
  db: Database.Database,
  value: HostedNetworkPrincipal,
  validate: CampaignPrivateOwnerValidator,
  read: (p: HostedNetworkPrincipal) => T,
): T {
  const p = s.input(() => principal(value));
  return s.read(db, p.hostOwnerDeviceId, () => {
    source(db, p, validate);
    // Missing command IDs are not proof of absence for a changed installation key.
    peer(db, p);
    return read(p);
  });
}
export function readHostedNetworkCommand(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  commandId: string,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): HostedNetworkCommand | null {
  return ownedRead(db, p, validatePrivateOwner, (bound) => command(db, bound, s.text(commandId)));
}
export function readHostedTechnicalSession(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  technicalSessionId: string,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): HostedTechnicalSession {
  return ownedRead(db, p, validatePrivateOwner, (bound) =>
    readSession(db, bound, s.uuid(technicalSessionId)),
  );
}
export function readHostedDeviceRequest(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  requestId: string,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): HostedDeviceRequest {
  return ownedRead(db, p, validatePrivateOwner, (bound) =>
    readRequest(db, bound, s.uuid(requestId)),
  );
}
export function readHostedConnectionAttempt(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  attemptId: string,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): HostedNetworkCommand | null {
  return ownedRead(db, p, validatePrivateOwner, (bound) => {
    const rows = db
      .prepare('SELECT * FROM hosted_technical_session WHERE attempt_id=?')
      .all(s.text(attemptId)) as Row[];
    if (rows.length === 0) return null;
    if (rows.length !== 1) return s.fail();
    const row = rows[0]!;
    if (
      row['host_owner_device_id'] !== bound.hostOwnerDeviceId ||
      row['campaign_id'] !== bound.campaignId ||
      row['peer_device_id'] !== bound.peerIdentity.ownerDeviceId
    )
      return s.fail('FOREIGN_OWNER');
    return command(db, bound, s.text(row['opening_command_id'])) ?? s.fail();
  });
}
function exactCampaign(proof: NetworkCampaignProof, current: CurrentPausedCampaignHeader): void {
  if (
    proof.campaignId !== current.campaignId ||
    proof.checkpointSha256 !== current.checkpointSha256 ||
    !s.same(proof.revisions, s.vectorOf(current))
  )
    return s.fail('STALE_REVISION');
}
function unusedObject(db: Database.Database, id: string): void {
  for (const [table, columns] of [
    ['hosted_technical_session', ['technical_session_id', 'attempt_id']],
    ['hosted_device_request', ['request_id']],
    ['local_network_tab', ['network_scope_id', 'tab_id']],
  ] as const)
    for (const column of columns)
      if (s.at(db, table, column, id) !== undefined) return s.fail('IDEMPOTENCY_CONFLICT');
  s.assertUnused(db, id);
}
export function commitHostedNetworkCommand(
  db: Database.Database,
  value: HostedNetworkPrincipal,
  request: HostedNetworkInput,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
  guard: HostedNetworkSourceGuard,
): HostedNetworkCommand {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const p = s.input(() => principal(value)),
    i = s.input(() => input(request));
  return s.safe(() =>
    db
      .transaction(() => {
        s.schema(db);
        const campaign = source(db, p, validatePrivateOwner);
        const known = command(db, p, i.commandId);
        const base: HostedNetworkSource = {
          principal: p,
          campaign,
          sessionOrNull: null,
          requestOrNull: null,
        };
        if (known !== null) {
          if (!s.same(known.input, i)) return s.fail('IDEMPOTENCY_CONFLICT');
          const replaySource: HostedNetworkSource =
            known.receipt.operation === 'OPEN'
              ? { ...base, sessionOrNull: known.current as HostedTechnicalSession }
              : {
                  ...base,
                  sessionOrNull: readSession(
                    db,
                    p,
                    (known.current as HostedDeviceRequest).technicalSessionId,
                  ),
                  requestOrNull: known.current as HostedDeviceRequest,
                };
          s.guarded(db, guard, replaySource, 'REPLAY');
          s.owner(db, p.hostOwnerDeviceId);
          return known;
        }
        s.assertUnused(db, i.commandId);
        s.assertUnused(db, i.receiptId);
        let current: HostedTechnicalSession | HostedDeviceRequest;
        let sessionOrNull: HostedTechnicalSession | null = null,
          requestOrNull: HostedDeviceRequest | null = null;
        let addPeer = false;
        if (i.operation === 'OPEN') {
          exactCampaign(i.campaignProof, campaign);
          unusedObject(db, i.attemptId);
          unusedObject(db, i.technicalSessionId);
          if (
            new Set([
              i.commandId,
              i.receiptId,
              i.attemptId,
              i.technicalSessionId,
              p.campaignId,
              p.peerIdentity.ownerDeviceId,
            ]).size !== 6
          )
            return s.fail('INVALID_INPUT');
          addPeer = !peer(db, p);
          if (addPeer) {
            const existing = db
              .prepare(
                'SELECT peer_device_id FROM hosted_network_peer WHERE host_owner_device_id=? AND key_fingerprint=?',
              )
              .get(p.hostOwnerDeviceId, p.peerIdentity.keyFingerprintSha256);
            if (existing !== undefined) return s.fail('KEY_CONFLICT');
          }
          current = sessionFor(p, i);
        } else {
          sessionOrNull = readSession(db, p, i.technicalSessionId);
          if (i.operation === 'SUBMIT') {
            if (sessionOrNull.connectionRevision !== i.expectedConnectionRevision)
              return s.fail('STALE_REVISION');
            exactCampaign(i.batch.campaignProof, campaign);
            unusedObject(db, i.requestId);
            if (
              i.requestId === i.commandId ||
              i.requestId === i.receiptId ||
              i.requestId === i.technicalSessionId
            )
              return s.fail('INVALID_INPUT');
            if (i.batch.candidates.length > campaign.activePlayerCapacity - campaign.activePcCount)
              return s.fail('CAPACITY_EXCEEDED');
            if (
              i.batch.candidates.some(
                (c) => c.descriptor.baselineVersion !== campaign.baselineVersion,
              )
            )
              return s.fail('UNAVAILABLE');
            const existing = db
              .prepare(
                "SELECT request_id FROM hosted_device_request WHERE technical_session_id=? OR json_extract(record_json,'$.technicalSessionId')=?",
              )
              .all(i.technicalSessionId, i.technicalSessionId) as Row[];
            const currentRequests = existing.map((row) =>
              readRequest(db, p, s.text(row['request_id'])),
            );
            if (currentRequests.some((r) => r.closureOrNull === null)) return s.fail('UNAVAILABLE');
            current = requestFor(p, i);
          } else {
            requestOrNull = readRequest(db, p, i.requestId);
            current = cancelled(requestOrNull, i);
          }
        }
        const proof: HostedNetworkSource = { ...base, sessionOrNull, requestOrNull };
        s.guarded(db, guard, proof, 'APPLY');
        s.owner(db, p.hostOwnerDeviceId);
        const receipt: HostedNetworkReceipt =
          i.operation === 'OPEN'
            ? {
                operation: 'OPEN',
                commandId: i.commandId,
                receiptId: i.receiptId,
                semanticBodySha256: s.sha(i.semanticBodyJson),
                session: current as HostedTechnicalSession,
              }
            : {
                operation: i.operation,
                commandId: i.commandId,
                receiptId: i.receiptId,
                semanticBodySha256: s.sha(i.semanticBodyJson),
                request: current as HostedDeviceRequest,
              };
        const record = { principal: p, input: i, receipt };
        const before = s.changes(db);
        let expected = 2;
        if (addPeer) {
          expected++;
          const identity = { hostOwnerDeviceId: p.hostOwnerDeviceId, identity: p.peerIdentity };
          db.prepare('INSERT INTO hosted_network_peer VALUES (?,?,?,?,?)').run(
            p.hostOwnerDeviceId,
            p.peerIdentity.ownerDeviceId,
            p.peerIdentity.keyFingerprintSha256,
            s.canonical(identity),
            s.sha(s.canonical(identity)),
          );
        }
        db.prepare('INSERT INTO hosted_network_command VALUES (?,?,?,?,?,?,?,?)').run(
          i.commandId,
          i.receiptId,
          p.hostOwnerDeviceId,
          p.campaignId,
          p.peerIdentity.ownerDeviceId,
          i.operation,
          s.canonical(record),
          s.sha(s.canonical(record)),
        );
        if (i.operation === 'OPEN')
          db.prepare('INSERT INTO hosted_technical_session VALUES (?,?,?,?,?,?,?,?)').run(
            i.technicalSessionId,
            p.hostOwnerDeviceId,
            p.campaignId,
            p.peerIdentity.ownerDeviceId,
            i.attemptId,
            i.commandId,
            s.canonical(current),
            s.sha(s.canonical(current)),
          );
        else if (i.operation === 'SUBMIT')
          db.prepare('INSERT INTO hosted_device_request VALUES (?,?,?,?,?,?,?,?,?)').run(
            i.requestId,
            p.hostOwnerDeviceId,
            p.campaignId,
            p.peerIdentity.ownerDeviceId,
            i.technicalSessionId,
            i.commandId,
            0,
            s.canonical(current),
            s.sha(s.canonical(current)),
          );
        else {
          const updated = db
            .prepare(
              'UPDATE hosted_device_request SET closed=1,record_json=?,record_sha256=? WHERE request_id=? AND closed=0',
            )
            .run(s.canonical(current), s.sha(s.canonical(current)), i.requestId);
          if (updated.changes !== 1) return s.fail('SOURCE_CHANGED');
        }
        if (!db.inTransaction || s.changes(db) !== before + expected)
          return s.fail('SOURCE_CHANGED');
        const verified = command(db, p, i.commandId) ?? s.fail();
        if (
          !s.same(verified, { ...record, current }) ||
          !s.same(source(db, p, validatePrivateOwner), campaign)
        )
          return s.fail('SOURCE_CHANGED');
        s.guarded(db, guard, proof, 'APPLY');
        s.owner(db, p.hostOwnerDeviceId);
        return verified;
      })
      .immediate(),
  );
}

/** CREATE is the explicit publication choice; enumerate every owned binding, never choose latest. */
export function readHostedPausedCampaignIds(
  db: Database.Database,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): readonly string[] {
  return s.safe(() => {
    const ownerDeviceId = loadDeviceId(db);
    return s.read(db, ownerDeviceId, () => {
      const profile = readLocalGmProfile(db, ownerDeviceId);
      const rows = db
        .prepare(
          'SELECT campaign_id FROM campaign_private_owner UNION SELECT campaign_id FROM campaign_creation_command ORDER BY campaign_id',
        )
        .all() as Row[];
      const result: string[] = [];
      for (const index of rows) {
        const id = s.text(index['campaign_id']);
        const row = s.at(db, 'campaign_private_owner', 'campaign_id', id) ?? s.fail();
        const record = s.object(s.checked(row), [
          'campaignId',
          'gmLocalContextId',
          'masterProfileId',
          'ownerDeviceId',
          'verifierSha256',
        ]);
        const creation = s.at(db, 'campaign_creation_command', 'campaign_id', id) ?? s.fail();
        const draftRow =
          s.at(db, 'campaign_draft', 'draft_id', s.text(creation['draft_id'])) ?? s.fail();
        const draft = s.object(s.checked(draftRow));
        if (
          record['ownerDeviceId'] !== ownerDeviceId &&
          row['profile_id'] !== profile?.masterProfileId &&
          draft['ownerDeviceId'] !== ownerDeviceId
        )
          continue;
        readHostedCampaignCreationOrigin(db, id, validatePrivateOwner);
        const root = s.at(db, 'campaign', 'campaign_id', id) ?? s.fail();
        const lifecycle = root['lifecycle_state'];
        if (!V1_LIFECYCLE_STATES.campaign.some((state) => state === lifecycle)) return s.fail();
        if (lifecycle === 'PAUSED') {
          readHostedCurrentPausedCampaign(db, id, validatePrivateOwner);
          result.push(id);
        } else loadCampaignCheckpoint(db, id);
      }
      return result;
    });
  });
}
