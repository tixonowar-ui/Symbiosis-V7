import type Database from 'better-sqlite3';
import type { CommandReceipt, WorkflowCommandRequestMessage } from '@shared/wire-protocol.js';
import type { FormActionIntentV2Message } from '@shared/wire-v2-protocol.js';
import type {
  NetworkGmAcceptToReviewPayload,
  NetworkGmRejectRequestPayload,
  NetworkGmRequestDecisionReceipt,
} from '@shared/network-application.js';
import type { RevisionTriple } from './store.js';
import {
  readHostedCurrentPausedCampaign,
  type CurrentPausedCampaignHeader,
} from './current-paused-campaign.js';
import {
  readHostedCampaignCreationOrigin,
  readLocalGmProfile,
  readLocalGmContext,
  readCampaignOwnerBinding,
  readCampaignCreationCursor,
  readGmRequestReviewViewStateInTransaction,
  readGmAdmissionViewStateInTransaction,
  verifyGmAdmissionSourceMirrorsInTransaction,
  appendGmRequestReviewEventInTransaction,
  gmRequestReviewRefreshEventId,
  type GmRequestReviewScope,
  type GmRequestReviewView,
  type GmRequestQueueEvidence,
  type GmRequestReviewDraftRequest,
  type StoredGmRequestQueueEvent,
  type CampaignPrivateOwnerValidator,
} from './campaign-creation.js';
import { loadDeviceId } from './device-identity.js';
import { loadCampaignCheckpoint } from './store.js';
import { V1_LIFECYCLE_STATES } from './migrations/0001-initial.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import {
  validateLegacyRequestReceipt,
  validateDeviceRequestBindLane,
  validatePeerLaneBindingReceipt,
  validateRequestReviewProof,
} from './network-local-application.js';
import {
  assertNoCampaignAdmissionEvidence,
  readCampaignAdmissionAvailability,
  type AdmissionPublicationRules,
} from './campaign-admission-decision.js';
import type {
  NetworkCampaignProof,
  NetworkPreparedBatch,
  NetworkPublicIdentity,
  NetworkStoreGuard,
  LegacyRequestReceipt,
  DeviceRequestBindLane,
  PeerLaneBindingReceipt,
  VerifiedRequestReviewProof,
  VerifiedLocalRequestCurrent,
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
export type HostedCandidateBaselineGuard = NetworkStoreGuard<{
  readonly campaign: CurrentPausedCampaignHeader;
  readonly candidateBaselineVersion: string;
}>;
export interface HostedRequestReviewCurrent extends VerifiedLocalRequestCurrent {
  readonly submittedRequest: HostedDeviceRequest;
}
export type NetworkGmDecisionRequest =
  | WorkflowCommandRequestMessage<
      'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      NetworkGmAcceptToReviewPayload
    >
  | WorkflowCommandRequestMessage<'UI-CMD-DEVICE-REQUEST-REJECT', NetworkGmRejectRequestPayload>;
export interface StoredGmRequestDecision {
  readonly request: NetworkGmDecisionRequest;
  readonly receipt: CommandReceipt<NetworkGmRequestDecisionReceipt>;
}
export interface VerifiedGmRequestQueue {
  readonly campaignId: string;
  readonly requestQueueRevision: number;
  readonly requests: readonly HostedRequestReviewCurrent[];
}
export interface GmRequestReviewSource {
  readonly scope: GmRequestReviewScope;
  readonly context: ReturnType<typeof readLocalGmContext>;
  readonly privateOwner: ReturnType<typeof readCampaignOwnerBinding>;
  readonly creationOrigin: ReturnType<typeof readHostedCampaignCreationOrigin>;
  readonly cursor: ReturnType<typeof readCampaignCreationCursor>;
  readonly viewOrNull: GmRequestReviewView | null;
  readonly connectionFactsSha256OrNull: string | null;
  readonly queue: VerifiedGmRequestQueue;
}
export interface GmRequestDecisionDelivery {
  readonly command: StoredGmRequestDecision;
  readonly current: GmRequestReviewView;
  readonly queue: VerifiedGmRequestQueue;
}
export interface StoredGmRequestViewEvent {
  readonly request: FormActionIntentV2Message | GmRequestReviewDraftRequest;
  readonly changed: boolean;
  readonly appliedRevisions: RevisionTriple;
  readonly appliedRequestQueueRevision: number;
}
export interface GmRequestViewDelivery {
  readonly event: StoredGmRequestViewEvent;
  readonly current: GmRequestReviewView;
  readonly queue: VerifiedGmRequestQueue;
}
function deliveredViewEvent(event: StoredGmRequestQueueEvent): StoredGmRequestViewEvent {
  if (event.mutation.kind !== 'NAV' && event.mutation.kind !== 'DRAFT') return s.fail();
  return {
    request: event.mutation.request,
    changed: event.changed,
    appliedRevisions: s.vectorOf(event.view),
    appliedRequestQueueRevision: event.view.requestQueueRevision,
  };
}

function decisionRequest(value: unknown): NetworkGmDecisionRequest {
  const r = s.object(value, [
    'messageType',
    'protocolVersion',
    'commandId',
    'commandKind',
    'expectedRevisions',
    'payload',
    'role',
    'workflowCommandId',
  ]);
  if (
    r['messageType'] !== 'command.request' ||
    r['protocolVersion'] !== 1 ||
    r['commandKind'] !== 'workflow-command' ||
    r['role'] !== 'gm'
  )
    return s.fail();
  const accept = r['workflowCommandId'] === 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW';
  if (!accept && r['workflowCommandId'] !== 'UI-CMD-DEVICE-REQUEST-REJECT') return s.fail();
  const p = s.object(r['payload'], [
    'campaignId',
    'requestId',
    'requestRevision',
    ...(accept ? [] : ['reason']),
  ]);
  s.uuid(p['campaignId']);
  s.uuid(p['requestId']);
  s.integer(p['requestRevision']);
  if (!accept && s.text(p['reason']).trim() === '') return s.fail();
  s.text(r['commandId']);
  s.vector(r['expectedRevisions']);
  return r as unknown as NetworkGmDecisionRequest;
}
function legacyReceipt(record: Omit<HostedNetworkCommand, 'current'>): LegacyRequestReceipt {
  const r = record.receipt;
  if (r.operation === 'OPEN') return s.fail();
  const q = r.request;
  return validateLegacyRequestReceipt({
    operation: r.operation,
    commandId: r.commandId,
    receiptId: r.receiptId,
    semanticBodySha256: r.semanticBodySha256,
    request: {
      requestId: q.requestId,
      technicalSessionId: q.technicalSessionId,
      submitCommandId: q.submitCommandId,
      submitReceiptId: q.submitReceiptId,
      requestRevision: q.requestRevision,
      status: q.status,
      batchSha256: q.batch.batchSha256,
      closureOrNull: q.closureOrNull,
    },
  });
}
function reviewSchema(db: Database.Database): void {
  s.schema(db);
  const r = db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row;
  if (r['version'] !== 11 && r['version'] !== 12) return s.fail();
}
function rawDecision(
  db: Database.Database,
  scope: GmRequestReviewScope,
  id: string,
): StoredGmRequestDecision | null {
  const row = s.at(db, 'hosted_device_request_decision', 'command_id', id);
  if (row === undefined) return null;
  const r = s.object(s.checked(row), ['scope', 'request', 'receipt']);
  if (
    !s.same(r['scope'], scope) ||
    row['host_owner_device_id'] !== scope.ownerDeviceId ||
    row['campaign_id'] !== scope.campaignId
  )
    return s.fail('FOREIGN_OWNER');
  const request = decisionRequest(r['request']);
  const wrapper = s.object(r['receipt'], ['commandId', 'receiptId', 'result', 'revisions']);
  const result = s.object(wrapper['result']);
  if (
    request.commandId !== id ||
    wrapper['commandId'] !== id ||
    wrapper['receiptId'] !== row['receipt_id'] ||
    result['commandId'] !== id ||
    result['receiptId'] !== wrapper['receiptId'] ||
    result['requestId'] !== row['request_id'] ||
    result['requestRevision'] !== row['request_revision'] ||
    result['requestOwnerDeviceId'] !== row['peer_device_id'] ||
    request.payload.campaignId !== scope.campaignId ||
    request.payload.requestId !== row['request_id'] ||
    request.payload.requestRevision !== result['beforeRequestRevision'] ||
    request.workflowCommandId !== result['workflowCommandId'] ||
    (request.workflowCommandId === 'UI-CMD-DEVICE-REQUEST-REJECT' &&
      request.payload.reason !== result['decisionReasonOrNull'])
  )
    return s.fail();
  const revisions = s.vector(wrapper['revisions']);
  if (
    !s.same(revisions, {
      ...request.expectedRevisions,
      stateRevision: s.increment(request.expectedRevisions.stateRevision),
      projectionRevision: s.increment(request.expectedRevisions.projectionRevision),
    })
  )
    return s.fail();
  return {
    request,
    receipt: {
      commandId: id,
      receiptId: s.text(wrapper['receiptId']),
      result: result as unknown as NetworkGmRequestDecisionReceipt,
      revisions,
    },
  };
}
function readCurrentRequest(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  id: string,
): HostedRequestReviewCurrent {
  const { request: base, submit } = readRequestRecord(db, p, id);
  if (submit.input.operation !== 'SUBMIT' || submit.receipt.operation !== 'SUBMIT') return s.fail();
  const ownerRow = s.at(db, 'campaign_private_owner', 'campaign_id', p.campaignId) ?? s.fail();
  const ownerRecord = s.object(s.checked(ownerRow));
  const scope: GmRequestReviewScope = {
    ownerDeviceId: p.hostOwnerDeviceId,
    gmLocalContextId: s.text(ownerRecord['gmLocalContextId']),
    campaignId: p.campaignId,
  };
  const privateOwner = readCampaignOwnerBinding(db, scope.gmLocalContextId, scope.campaignId);
  if (privateOwner.ownerDeviceId !== p.hostOwnerDeviceId) return s.fail('FOREIGN_OWNER');
  const rows = db
    .prepare(
      'SELECT command_id FROM hosted_device_request_decision WHERE request_id=? ORDER BY request_revision',
    )
    .all(id) as Row[];
  const decisions = rows.map(
    (r) => (rawDecision(db, scope, s.text(r['command_id'])) ?? s.fail()).receipt.result,
  );
  const laneRow = s.at(db, 'hosted_device_request_lane_binding', 'request_id', id);
  let lane: VerifiedRequestReviewProof['laneProvenance'] = null;
  if (laneRow !== undefined) {
    const stored = s.object(s.checked(laneRow), ['principal', 'request', 'receipt']);
    if (
      !s.same(stored['principal'], p) ||
      laneRow['campaign_id'] !== p.campaignId ||
      laneRow['host_owner_device_id'] !== p.hostOwnerDeviceId ||
      laneRow['peer_device_id'] !== p.peerIdentity.ownerDeviceId
    )
      return s.fail('FOREIGN_OWNER');
    if (laneRow['kind'] === 'SUBMITTED_BATCH') {
      if (
        !s.same(stored['request'], submit.input) ||
        !s.same(stored['receipt'], submit.receipt) ||
        laneRow['command_id'] !== submit.input.commandId ||
        laneRow['receipt_id'] !== submit.input.receiptId ||
        base.batch.schemaVersion !== 2
      )
        return s.fail();
      lane = {
        kind: 'SUBMITTED_BATCH',
        batchSha256: base.batch.batchSha256,
        localControllerSeatId: base.batch.localControllerSeatId,
      };
    } else if (laneRow['kind'] === 'BIND_LANE') {
      const request = validateDeviceRequestBindLane(stored['request']),
        receipt = validatePeerLaneBindingReceipt(stored['receipt']);
      if (
        request.requestId !== id ||
        receipt.commandId !== request.commandId ||
        receipt.commandId !== laneRow['command_id'] ||
        receipt.receiptId !== laneRow['receipt_id'] ||
        receipt.semanticBodySha256 !== s.sha(s.canonical(request))
      )
        return s.fail();
      lane = { kind: 'BIND_LANE', receipt };
    } else return s.fail();
  }
  const core = legacyReceipt(submit);
  const current = validateRequestReviewProof(
    {
      submittedReceipt: core,
      cancelledReceiptOrNull:
        base.closureOrNull === null
          ? null
          : legacyReceipt(rawCommand(db, p, base.closureOrNull.commandId) ?? s.fail()),
      decisions,
      laneProvenance: lane,
    },
    {
      submittedReceipt: core,
      batch: submit.input.batch,
      requestOwnerDeviceId: p.peerIdentity.ownerDeviceId,
      campaignId: p.campaignId,
      authoritativeGmActorId: privateOwner.masterProfileId,
    },
  );
  return { ...current, submittedRequest: submit.receipt.request };
}
export function readHostedDeviceRequestCurrent(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  requestId: string,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): HostedRequestReviewCurrent {
  return ownedRead(db, p, validatePrivateOwner, (bound) => {
    reviewSchema(db);
    const id = s.uuid(requestId),
      owner = s.object(
        s.checked(s.at(db, 'campaign_private_owner', 'campaign_id', bound.campaignId) ?? s.fail()),
      );
    const scope = {
      ownerDeviceId: bound.hostOwnerDeviceId,
      gmLocalContextId: s.text(owner['gmLocalContextId']),
      campaignId: bound.campaignId,
    };
    if (!s.same(requestPrincipal(db, scope, id), bound)) return s.fail('FOREIGN_OWNER');
    // The complete queue fold already verifies this request and its historical GM view bindings.
    const source = gmSource(db, scope, validatePrivateOwner);
    return source.queue.requests.find((r) => r.submittedRequest.requestId === id) ?? s.fail();
  });
}
function gmScope(value: unknown): GmRequestReviewScope {
  const r = s.object(value, ['ownerDeviceId', 'gmLocalContextId', 'campaignId']);
  return {
    ownerDeviceId: s.uuid(r['ownerDeviceId']),
    gmLocalContextId: s.text(r['gmLocalContextId']),
    campaignId: s.uuid(r['campaignId']),
  };
}
function requestPrincipal(
  db: Database.Database,
  scope: GmRequestReviewScope,
  requestId: string,
): HostedNetworkPrincipal {
  const row = s.at(db, 'hosted_device_request', 'request_id', requestId) ?? s.fail('NOT_FOUND');
  if (
    row['host_owner_device_id'] !== scope.ownerDeviceId ||
    row['campaign_id'] !== scope.campaignId
  )
    return s.fail('FOREIGN_OWNER');
  const pRow = db
    .prepare('SELECT * FROM hosted_network_peer WHERE host_owner_device_id=? AND peer_device_id=?')
    .get(scope.ownerDeviceId, s.uuid(row['peer_device_id'])) as Row | undefined;
  if (pRow === undefined) return s.fail();
  const p = s.object(s.checked(pRow), ['hostOwnerDeviceId', 'identity']);
  const result = {
    hostOwnerDeviceId: scope.ownerDeviceId,
    campaignId: scope.campaignId,
    peerIdentity: s.identity(p['identity']),
  };
  if (!peer(db, result)) return s.fail();
  return result;
}
function queueEvidence(queue: VerifiedGmRequestQueue): GmRequestQueueEvidence {
  const requestFacts = queue.requests.map((r) => ({
    requestId: r.submittedRequest.requestId,
    submitCommandId: r.submittedRequest.submitCommandId,
    cancelCommandIdOrNull: r.proof.cancelledReceiptOrNull?.commandId ?? null,
    decisionCommandIds: r.proof.decisions.map((d) => d.commandId),
    laneBindingCommandIdOrNull:
      r.proof.laneProvenance?.kind === 'BIND_LANE'
        ? r.proof.laneProvenance.receipt.commandId
        : null,
  }));
  return {
    requestQueueRevision: queue.requestQueueRevision,
    requestFacts,
    visibleRequestIds: queue.requests
      .filter((r) => r.requestStatus !== 'CANCELLED')
      .map((r) => r.submittedRequest.requestId),
    queueEvidenceSha256: s.sha(s.canonical(requestFacts)),
  };
}
function queueInTransaction(
  db: Database.Database,
  scope: GmRequestReviewScope,
): VerifiedGmRequestQueue {
  const rows = db
    .prepare('SELECT request_id FROM hosted_device_request WHERE campaign_id=? ORDER BY request_id')
    .all(scope.campaignId) as Row[];
  const requests = rows.map((r) => {
    const id = s.uuid(r['request_id']);
    return readCurrentRequest(db, requestPrincipal(db, scope, id), id);
  });
  let revision = 0;
  for (const r of requests) {
    revision = s.increment(revision);
    if (r.proof.cancelledReceiptOrNull !== null) revision = s.increment(revision);
    for (const _decision of r.proof.decisions) revision = s.increment(revision);
    if (r.proof.laneProvenance?.kind === 'BIND_LANE') revision = s.increment(revision);
  }
  return { campaignId: scope.campaignId, requestQueueRevision: revision, requests };
}
function verifyEvidencePrefix(
  evidence: GmRequestQueueEvidence,
  queue: VerifiedGmRequestQueue,
): void {
  for (const f of evidence.requestFacts) {
    const current =
      queue.requests.find((r) => r.submittedRequest.requestId === f.requestId) ?? s.fail();
    if (
      f.submitCommandId !== current.submittedRequest.submitCommandId ||
      (f.cancelCommandIdOrNull !== null &&
        f.cancelCommandIdOrNull !== current.proof.cancelledReceiptOrNull?.commandId) ||
      f.decisionCommandIds.length > current.proof.decisions.length ||
      f.decisionCommandIds.some((id, i) => id !== current.proof.decisions[i]?.commandId) ||
      (f.cancelCommandIdOrNull !== null && f.decisionCommandIds.length !== 0) ||
      (f.laneBindingCommandIdOrNull !== null &&
        (current.proof.laneProvenance?.kind !== 'BIND_LANE' ||
          f.laneBindingCommandIdOrNull !== current.proof.laneProvenance.receipt.commandId))
    )
      return s.fail();
  }
}
function gmSource(
  db: Database.Database,
  value: GmRequestReviewScope,
  validate: CampaignPrivateOwnerValidator,
): GmRequestReviewSource {
  reviewSchema(db);
  const scope = gmScope(value);
  s.owner(db, scope.ownerDeviceId);
  const context = readLocalGmContext(db, scope.gmLocalContextId),
    privateOwner = readCampaignOwnerBinding(db, scope.gmLocalContextId, scope.campaignId);
  if (
    context.ownerDeviceId !== scope.ownerDeviceId ||
    privateOwner.ownerDeviceId !== scope.ownerDeviceId ||
    context.masterProfileId !== privateOwner.masterProfileId
  )
    return s.fail('FOREIGN_OWNER');
  const creationOrigin = readHostedCampaignCreationOrigin(db, scope.campaignId, validate);
  // Current foundation supports PAUSED campaigns; birth0 remains a separate immutable anchor.
  readHostedCurrentPausedCampaign(db, scope.campaignId, validate);
  const state = readGmRequestReviewViewStateInTransaction(db, scope),
    queue = queueInTransaction(db, scope);
  if (db.prepare('SELECT 1 FROM schema_migration WHERE version=12').get() !== undefined) {
    readGmAdmissionViewStateInTransaction(db, scope);
    verifyGmAdmissionSourceMirrorsInTransaction(db, scope);
  }
  for (const event of state.events) {
    const m = event.mutation;
    if (m.kind === 'NAV' && m.initialQueueOrNull !== null)
      verifyEvidencePrefix(m.initialQueueOrNull, queue);
    if (m.kind === 'REQUEST_REFRESH') {
      verifyEvidencePrefix(m.queue, queue);
      const related =
        queue.requests.find(
          (r) =>
            r.submittedRequest.submitCommandId === m.causeCommandId ||
            r.proof.cancelledReceiptOrNull?.commandId === m.causeCommandId ||
            r.proof.decisions.some((d) => d.commandId === m.causeCommandId) ||
            (r.proof.laneProvenance?.kind === 'BIND_LANE' &&
              r.proof.laneProvenance.receipt.commandId === m.causeCommandId),
        ) ?? s.fail();
      const receiptId =
        related.submittedRequest.submitCommandId === m.causeCommandId
          ? related.submittedRequest.submitReceiptId
          : related.proof.cancelledReceiptOrNull?.commandId === m.causeCommandId
            ? related.proof.cancelledReceiptOrNull.receiptId
            : (related.proof.decisions.find((d) => d.commandId === m.causeCommandId)?.receiptId ??
              (related.proof.laneProvenance?.kind === 'BIND_LANE'
                ? related.proof.laneProvenance.receipt.receiptId
                : null));
      if (receiptId !== m.causeReceiptId) return s.fail();
    }
  }
  for (const current of queue.requests)
    for (const decision of current.proof.decisions) {
      const stored = rawDecision(db, scope, decision.commandId) ?? s.fail();
      const index = state.events.findIndex(
        (e) =>
          e.eventId ===
          gmRequestReviewRefreshEventId(scope, decision.commandId, decision.receiptId),
      );
      const event = state.events[index],
        before = state.events[index - 1]?.view;
      if (
        event === undefined ||
        before === undefined ||
        before.formId !== 'NET-017' ||
        before.values.selectedRequestIdOrNull !== decision.requestId ||
        !s.same(stored.request.expectedRevisions, s.vectorOf(before)) ||
        !s.same(stored.receipt.revisions, s.vectorOf(event.view)) ||
        (stored.request.workflowCommandId === 'UI-CMD-DEVICE-REQUEST-REJECT' &&
          stored.request.payload.reason !== before.values.decisionReason)
      )
        return s.fail();
    }
  if (state.queueOrNull !== null && !s.same(state.queueOrNull, queueEvidence(queue)))
    return s.fail();
  return {
    scope,
    context,
    privateOwner,
    creationOrigin,
    cursor: readCampaignCreationCursor(db, scope.gmLocalContextId),
    viewOrNull: state.viewOrNull,
    connectionFactsSha256OrNull: state.connectionFactsSha256OrNull,
    queue,
  };
}
/** One verified read for synchronous projection/guard work; never retain it across await or writes. */
export function readGmRequestReviewSource(
  db: Database.Database,
  scope: GmRequestReviewScope,
  validate: CampaignPrivateOwnerValidator,
): GmRequestReviewSource {
  return s.read(db, scope.ownerDeviceId, () => gmSource(db, scope, validate));
}
export function readGmDeviceRequestQueue(
  db: Database.Database,
  scope: GmRequestReviewScope,
  validate: CampaignPrivateOwnerValidator,
): VerifiedGmRequestQueue {
  return readGmRequestReviewSource(db, scope, validate).queue;
}
export function readGmRequestReviewView(
  db: Database.Database,
  scope: GmRequestReviewScope,
  validate: CampaignPrivateOwnerValidator,
): GmRequestReviewView | null {
  return readGmRequestReviewSource(db, scope, validate).viewOrNull;
}
export function readGmDeviceRequestDecision(
  db: Database.Database,
  scope: GmRequestReviewScope,
  id: string,
  validate: CampaignPrivateOwnerValidator,
): StoredGmRequestDecision | null {
  return s.read(db, scope.ownerDeviceId, () => {
    const source = gmSource(db, scope, validate),
      known = rawDecision(db, source.scope, s.text(id));
    if (known !== null) {
      const state = readGmRequestReviewViewStateInTransaction(db, scope),
        event =
          state.events.find(
            (e) =>
              e.eventId ===
              gmRequestReviewRefreshEventId(
                scope,
                known.request.commandId,
                known.receipt.receiptId,
              ),
          ) ?? s.fail();
      if (!s.same(s.vectorOf(event.view), known.receipt.revisions)) return s.fail();
    }
    return known;
  });
}
function refreshViews(
  db: Database.Database,
  campaignId: string,
  commandId: string,
  receiptId: string,
  validate: CampaignPrivateOwnerValidator,
): number {
  const rows = db
    .prepare(
      'SELECT context_id,owner_device_id FROM gm_request_queue_view WHERE campaign_id=? ORDER BY context_id',
    )
    .all(campaignId) as Row[];
  let writes = 0;
  for (const r of rows) {
    const scope = gmScope({
      ownerDeviceId: r['owner_device_id'],
      gmLocalContextId: r['context_id'],
      campaignId,
    });
    const eventId = gmRequestReviewRefreshEventId(scope, commandId, receiptId);
    s.assertUnused(db, eventId);
    const result = appendGmRequestReviewEventInTransaction(db, scope, {
      eventId,
      mutation: {
        kind: 'REQUEST_REFRESH',
        causeCommandId: commandId,
        causeReceiptId: receiptId,
        queue: queueEvidence(queueInTransaction(db, scope)),
      },
    });
    writes += result.rowWrites;
    gmSource(db, scope, validate);
  }
  return writes;
}
function verifyViews(
  db: Database.Database,
  campaignId: string,
  validate: CampaignPrivateOwnerValidator,
): void {
  for (const r of db
    .prepare('SELECT context_id,owner_device_id FROM gm_request_queue_view WHERE campaign_id=?')
    .all(campaignId) as Row[])
    gmSource(
      db,
      gmScope({
        ownerDeviceId: r['owner_device_id'],
        gmLocalContextId: r['context_id'],
        campaignId,
      }),
      validate,
    );
}
function viewMutation(
  db: Database.Database,
  scope: GmRequestReviewScope,
  request: FormActionIntentV2Message | GmRequestReviewDraftRequest,
  validate: CampaignPrivateOwnerValidator,
  guard: NetworkStoreGuard<GmRequestReviewSource>,
): GmRequestViewDelivery {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  return s.safe(() =>
    db
      .transaction(() => {
        const source = gmSource(db, scope, validate),
          state = readGmRequestReviewViewStateInTransaction(db, scope);
        const navigation = request.messageType === 'navigation.form-action';
        const eventId = navigation ? request.navigationRequestId : request.draftUpdateId;
        const old = state.events.find((e) => e.eventId === eventId);
        const mutation = navigation
          ? {
              kind: 'NAV' as const,
              request,
              initialQueueOrNull: state.viewOrNull === null ? queueEvidence(source.queue) : null,
            }
          : { kind: 'DRAFT' as const, request };
        if (old !== undefined) {
          // The initial queue is historical; only the exact client envelope is replayed.
          if (
            (old.mutation.kind !== 'NAV' && old.mutation.kind !== 'DRAFT') ||
            !s.same(old.mutation.request, request)
          )
            return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, source, 'REPLAY');
          return {
            event: deliveredViewEvent(old),
            current: source.viewOrNull ?? s.fail(),
            queue: source.queue,
          };
        }
        s.assertUnused(db, eventId);
        s.guarded(db, guard, source, 'APPLY');
        // The outer store owns its public stale result; the structural cursor reader uses another error family.
        if (
          !navigation &&
          source.viewOrNull !== null &&
          (!s.same(request.expectedRevisions, {
            stateRevision: source.viewOrNull.stateRevision,
            projectionRevision: source.viewOrNull.projectionRevision,
            actorVisibilityRevision: source.viewOrNull.actorVisibilityRevision,
          }) ||
            request.expectedRequestQueueRevision !== source.viewOrNull.requestQueueRevision)
        )
          return s.fail('STALE_REVISION');
        const before = s.changes(db),
          added = appendGmRequestReviewEventInTransaction(db, scope, { eventId, mutation });
        if (s.changes(db) !== before + added.rowWrites) return s.fail('SOURCE_CHANGED');
        const verified = gmSource(db, scope, validate);
        s.guarded(db, guard, verified, 'APPLY');
        return {
          event: deliveredViewEvent(added.event),
          current: verified.viewOrNull ?? s.fail(),
          queue: verified.queue,
        };
      })
      .immediate(),
  );
}
export function commitGmRequestReviewNavigation(
  db: Database.Database,
  scope: GmRequestReviewScope,
  request: FormActionIntentV2Message,
  validate: CampaignPrivateOwnerValidator,
  guard: NetworkStoreGuard<GmRequestReviewSource>,
) {
  return viewMutation(db, scope, request, validate, guard);
}
export function commitGmRequestReviewDraft(
  db: Database.Database,
  scope: GmRequestReviewScope,
  request: GmRequestReviewDraftRequest,
  validate: CampaignPrivateOwnerValidator,
  guard: NetworkStoreGuard<GmRequestReviewSource>,
) {
  return viewMutation(db, scope, request, validate, guard);
}
/** Socket facts are trusted host input; the synchronous guard must recheck their source. */
export function commitGmRequestReviewConnectionRefresh(
  db: Database.Database,
  scope: GmRequestReviewScope,
  value: { readonly eventId: string; readonly connectionFactsSha256: string },
  validate: CampaignPrivateOwnerValidator,
  guard: NetworkStoreGuard<GmRequestReviewSource>,
): {
  readonly changed: boolean;
  readonly current: GmRequestReviewView;
  readonly queue: VerifiedGmRequestQueue;
} {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const input = s.input(() => {
    const row = s.object(value, ['eventId', 'connectionFactsSha256']);
    return {
      eventId: s.text(row['eventId']),
      connectionFactsSha256: s.hash(row['connectionFactsSha256']),
    };
  });
  return s.safe(() =>
    db
      .transaction(() => {
        const source = gmSource(db, scope, validate),
          state = readGmRequestReviewViewStateInTransaction(db, scope);
        if (state.viewOrNull === null) return s.fail('UNAVAILABLE');
        const mutation = {
            kind: 'CONNECTION_REFRESH' as const,
            connectionFactsSha256: input.connectionFactsSha256,
          },
          old = state.events.find((e) => e.eventId === input.eventId);
        if (old !== undefined) {
          if (!s.same(old.mutation, mutation)) return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, source, 'REPLAY');
          return { changed: old.changed, current: state.viewOrNull, queue: source.queue };
        }
        s.assertUnused(db, input.eventId);
        if (state.connectionFactsSha256OrNull === input.connectionFactsSha256) {
          s.guarded(db, guard, source, 'REPLAY');
          return { changed: false, current: state.viewOrNull, queue: source.queue };
        }
        s.guarded(db, guard, source, 'APPLY');
        const before = s.changes(db),
          saved = appendGmRequestReviewEventInTransaction(db, scope, {
            eventId: input.eventId,
            mutation,
          });
        if (!db.inTransaction || s.changes(db) !== before + saved.rowWrites)
          return s.fail('SOURCE_CHANGED');
        const verified = gmSource(db, scope, validate);
        s.guarded(db, guard, verified, 'APPLY');
        return {
          changed: saved.event.changed,
          current: verified.viewOrNull ?? s.fail(),
          queue: verified.queue,
        };
      })
      .immediate(),
  );
}

export function commitGmDeviceRequestDecision(
  db: Database.Database,
  scope: GmRequestReviewScope,
  value: {
    readonly request: NetworkGmDecisionRequest;
    readonly receiptId: string;
    readonly timestamp: string;
  },
  validate: CampaignPrivateOwnerValidator,
  guard: NetworkStoreGuard<GmRequestReviewSource>,
): GmRequestDecisionDelivery {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const input = s.object(value, ['request', 'receiptId', 'timestamp']),
    request = s.input(() => decisionRequest(input['request']));
  return s.safe(() =>
    db
      .transaction(() => {
        const source = gmSource(db, scope, validate),
          known = rawDecision(db, scope, request.commandId);
        if (known !== null) {
          if (!s.same(known.request, request)) return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, source, 'REPLAY');
          return { command: known, current: source.viewOrNull ?? s.fail(), queue: source.queue };
        }
        const view = source.viewOrNull ?? s.fail('UNAVAILABLE');
        if (
          view.formId !== 'NET-017' ||
          source.cursor.kind !== 'QUEUE' ||
          source.cursor.targetId !== scope.campaignId ||
          request.payload.campaignId !== scope.campaignId ||
          !s.same(request.expectedRevisions, s.vectorOf(view)) ||
          view.values.selectedRequestIdOrNull !== request.payload.requestId
        )
          return s.fail('STALE_REVISION');
        const current =
          source.queue.requests.find(
            (r) => r.submittedRequest.requestId === request.payload.requestId,
          ) ?? s.fail('NOT_FOUND');
        // A final admission decision owns the next boundary. An old NET-017 dialog
        // cannot retract its immutable proposal or reopen a terminal rejection.
        if (
          db.prepare('SELECT 1 FROM schema_migration WHERE version=12').get() !== undefined &&
          db
            .prepare(
              `SELECT 1 FROM campaign_admission_batch b
            JOIN campaign_admission_gm_decision d USING(admission_batch_id)
            WHERE b.request_id=?`,
            )
            .get(request.payload.requestId) !== undefined
        )
          return s.fail('STALE_REVISION');
        const accept = request.workflowCommandId === 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW';
        if (
          current.proof.laneProvenance === null ||
          current.requestRevision !== request.payload.requestRevision ||
          (accept
            ? current.requestStatus !== 'PENDING'
            : current.requestStatus !== 'PENDING' && current.requestStatus !== 'IN_REVIEW')
        )
          return s.fail('STALE_REVISION');
        if (!accept && request.payload.reason !== view.values.decisionReason)
          return s.fail('STALE_REVISION');
        const receiptId = s.text(input['receiptId']),
          timestamp = s.text(input['timestamp']);
        s.assertUnused(db, request.commandId);
        s.assertUnused(db, receiptId);
        if (receiptId === request.commandId) return s.fail('IDEMPOTENCY_CONFLICT');
        const result = {
          receiptId,
          commandId: request.commandId,
          workflowCommandId: request.workflowCommandId,
          campaignId: scope.campaignId,
          requestId: request.payload.requestId,
          requestOwnerDeviceId: current.submittedRequest.principal.peerIdentity.ownerDeviceId,
          beforeRequestStatus: current.requestStatus,
          afterRequestStatus: accept ? 'IN_REVIEW' : 'REJECTED',
          beforeRequestRevision: current.requestRevision,
          requestRevision: s.increment(current.requestRevision),
          decisionReasonOrNull: accept ? null : request.payload.reason,
          candidateSnapshotChecksums: current.submittedRequest.batch.candidates.map(
            (c) => c.descriptor.exportBytesSha256,
          ),
          authoritativeGmActorId: source.privateOwner.masterProfileId,
          timestamp,
        } as NetworkGmRequestDecisionReceipt;
        validateRequestReviewProof(
          { ...current.proof, decisions: [...current.proof.decisions, result] },
          {
            submittedReceipt: current.proof.submittedReceipt,
            batch: current.submittedRequest.batch,
            requestOwnerDeviceId: result.requestOwnerDeviceId,
            campaignId: scope.campaignId,
            authoritativeGmActorId: source.privateOwner.masterProfileId,
          },
        );
        const receipt: CommandReceipt<NetworkGmRequestDecisionReceipt> = {
          commandId: request.commandId,
          receiptId,
          result,
          revisions: {
            ...s.vectorOf(view),
            stateRevision: s.increment(view.stateRevision),
            projectionRevision: s.increment(view.projectionRevision),
          },
        };
        const record = { scope, request, receipt };
        s.guarded(db, guard, source, 'APPLY');
        const before = s.changes(db);
        db.prepare('INSERT INTO hosted_device_request_decision VALUES (?,?,?,?,?,?,?,?,?)').run(
          request.commandId,
          receiptId,
          scope.ownerDeviceId,
          scope.campaignId,
          request.payload.requestId,
          result.requestOwnerDeviceId,
          result.requestRevision,
          s.canonical(record),
          s.sha(s.canonical(record)),
        );
        const writes =
          1 + refreshViews(db, scope.campaignId, request.commandId, receiptId, validate);
        if (!db.inTransaction || s.changes(db) !== before + writes) return s.fail('SOURCE_CHANGED');
        const verified = gmSource(db, scope, validate);
        if (!s.same(s.vectorOf(verified.viewOrNull ?? s.fail()), receipt.revisions))
          return s.fail('SOURCE_CHANGED');
        s.guarded(db, guard, verified, 'APPLY');
        return {
          command: { request, receipt },
          current: verified.viewOrNull ?? s.fail(),
          queue: verified.queue,
        };
      })
      .immediate(),
  );
}
export function commitHostedRequestLaneBinding(
  db: Database.Database,
  value: HostedNetworkPrincipal,
  valueInput: { readonly request: DeviceRequestBindLane; readonly receiptId: string },
  validate: CampaignPrivateOwnerValidator,
  guard: HostedNetworkSourceGuard,
): { readonly receipt: PeerLaneBindingReceipt; readonly current: HostedRequestReviewCurrent } {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const p = s.input(() => principal(value)),
    i = s.object(valueInput, ['request', 'receiptId']),
    request = s.input(() => validateDeviceRequestBindLane(i['request']));
  return s.safe(() =>
    db
      .transaction(() => {
        reviewSchema(db);
        const campaign = source(db, p, validate),
          current = readCurrentRequest(db, p, request.requestId);
        const proof: HostedNetworkSource = {
          principal: p,
          campaign,
          sessionOrNull: readSession(db, p, request.technicalSessionId),
          requestOrNull: readRequest(db, p, request.requestId),
        };
        if (
          current.submittedRequest.batch.schemaVersion === 2 ||
          request.submitCommandId !== current.submittedRequest.submitCommandId ||
          request.technicalSessionId !== current.submittedRequest.technicalSessionId ||
          request.batchSha256 !== current.submittedRequest.batch.batchSha256
        )
          return s.fail('IDEMPOTENCY_CONFLICT');
        const prior = s.at(
          db,
          'hosted_device_request_lane_binding',
          'request_id',
          request.requestId,
        );
        if (prior !== undefined) {
          const record = s.object(s.checked(prior), ['principal', 'request', 'receipt']);
          if (!s.same(record['principal'], p) || !s.same(record['request'], request))
            return s.fail('IDEMPOTENCY_CONFLICT');
          const receipt = validatePeerLaneBindingReceipt(record['receipt']);
          s.guarded(db, guard, proof, 'REPLAY');
          return { receipt, current };
        }
        const receiptId = s.text(i['receiptId']);
        s.assertUnused(db, request.commandId);
        s.assertUnused(db, receiptId);
        if (receiptId === request.commandId) return s.fail('IDEMPOTENCY_CONFLICT');
        const receipt = validatePeerLaneBindingReceipt({
          operation: 'BIND_LANE',
          commandId: request.commandId,
          receiptId,
          semanticBodySha256: s.sha(s.canonical(request)),
          binding: {
            campaignId: p.campaignId,
            requestOwnerDeviceId: p.peerIdentity.ownerDeviceId,
            requestId: request.requestId,
            technicalSessionId: request.technicalSessionId,
            submitCommandId: request.submitCommandId,
            batchSha256: request.batchSha256,
            localControllerSeatId: request.localControllerSeatId,
          },
        });
        s.guarded(db, guard, proof, 'APPLY');
        verifyViews(db, p.campaignId, validate);
        const before = s.changes(db),
          record = { principal: p, request, receipt };
        db.prepare('INSERT INTO hosted_device_request_lane_binding VALUES (?,?,?,?,?,?,?,?,?)').run(
          request.requestId,
          p.hostOwnerDeviceId,
          p.campaignId,
          p.peerIdentity.ownerDeviceId,
          request.commandId,
          receiptId,
          'BIND_LANE',
          s.canonical(record),
          s.sha(s.canonical(record)),
        );
        const writes = 1 + refreshViews(db, p.campaignId, request.commandId, receiptId, validate);
        if (!db.inTransaction || s.changes(db) !== before + writes) return s.fail('SOURCE_CHANGED');
        const verified = readCurrentRequest(db, p, request.requestId);
        s.guarded(db, guard, proof, 'APPLY');
        s.owner(db, p.hostOwnerDeviceId);
        return { receipt, current: verified };
      })
      .immediate(),
  );
}

function candidateBaselineGuard(
  db: Database.Database,
  campaign: CurrentPausedCampaignHeader,
  batch: NetworkPreparedBatch,
  phase: 'APPLY' | 'REPLAY',
  validate: HostedCandidateBaselineGuard | undefined,
): void {
  for (const candidate of batch.candidates) {
    const source = { campaign, candidateBaselineVersion: candidate.descriptor.baselineVersion };
    if (validate === undefined) {
      if (source.candidateBaselineVersion !== campaign.baselineVersion)
        return s.fail('UNAVAILABLE');
    } else s.guarded(db, validate, source, phase);
  }
}

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
  return readRequestRecord(db, p, id).request;
}
function readRequestRecord(
  db: Database.Database,
  p: HostedNetworkPrincipal,
  id: string,
): { request: HostedDeviceRequest; submit: Omit<HostedNetworkCommand, 'current'> } {
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
  return { request: expected, submit };
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
  validateCandidateBaseline?: HostedCandidateBaselineGuard,
  admissionRules?: AdmissionPublicationRules,
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
          if (i.operation === 'SUBMIT')
            candidateBaselineGuard(db, campaign, i.batch, 'REPLAY', validateCandidateBaseline);
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
            const schemaVersion = (
              db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row
            )['version'];
            if ((schemaVersion === 11 || schemaVersion === 12) && i.batch.schemaVersion !== 2)
              return s.fail('INVALID_INPUT');
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
            let occupied = campaign.activePcCount;
            const released = new Set<string>();
            if (schemaVersion === 12) {
              if (admissionRules === undefined) assertNoCampaignAdmissionEvidence(db);
              else {
                const origin = readHostedCampaignCreationOrigin(
                    db,
                    p.campaignId,
                    validatePrivateOwner,
                  ),
                  availability = readCampaignAdmissionAvailability(
                    db,
                    {
                      ownerDeviceId: p.hostOwnerDeviceId,
                      campaignId: p.campaignId,
                      gmLocalContextId: origin.command.request.payload.gmLocalContextId,
                    },
                    validatePrivateOwner,
                    admissionRules,
                  );
                occupied = availability.occupiedCampaignPlaceCount;
                // AQA-018 / Q-CAMP-004: even a subsequently DECLINED copy consumes this source UUID's single import.
                if (
                  i.batch.candidates.some((candidate) =>
                    availability.importedSources.some(
                      (copy) => copy.sourceUuid === candidate.descriptor.sourceUuid,
                    ),
                  )
                )
                  return s.fail('IDEMPOTENCY_CONFLICT');
                for (const id of availability.releasedRequestIds) released.add(id);
              }
            }
            if (i.batch.candidates.length > campaign.activePlayerCapacity - occupied)
              return s.fail('CAPACITY_EXCEEDED');
            candidateBaselineGuard(db, campaign, i.batch, 'APPLY', validateCandidateBaseline);
            const existing = db
              .prepare(
                "SELECT request_id FROM hosted_device_request WHERE technical_session_id=? OR json_extract(record_json,'$.technicalSessionId')=?",
              )
              .all(i.technicalSessionId, i.technicalSessionId) as Row[];
            const currentRequests = existing.map((row) =>
              readRequest(db, p, s.text(row['request_id'])),
            );
            if (
              currentRequests.some((r) =>
                schemaVersion === 11 || schemaVersion === 12
                  ? !released.has(r.requestId) &&
                    ['PENDING', 'IN_REVIEW'].includes(
                      readCurrentRequest(db, p, r.requestId).requestStatus,
                    )
                  : r.closureOrNull === null,
              )
            )
              return s.fail('UNAVAILABLE');
            current = requestFor(p, i);
          } else {
            requestOrNull = readRequest(db, p, i.requestId);
            if (
              s.hasRequestReviewSchema(db) &&
              readCurrentRequest(db, p, i.requestId).requestStatus !== 'PENDING'
            )
              return s.fail('STALE_REVISION');
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
        if (s.hasRequestReviewSchema(db)) verifyViews(db, p.campaignId, validatePrivateOwner);
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
        if (i.operation === 'SUBMIT' && i.batch.schemaVersion === 2) {
          const binding = { principal: p, request: i, receipt };
          db.prepare(
            'INSERT INTO hosted_device_request_lane_binding VALUES (?,?,?,?,?,?,?,?,?)',
          ).run(
            i.requestId,
            p.hostOwnerDeviceId,
            p.campaignId,
            p.peerIdentity.ownerDeviceId,
            i.commandId,
            i.receiptId,
            'SUBMITTED_BATCH',
            s.canonical(binding),
            s.sha(s.canonical(binding)),
          );
          expected++;
        }
        if (i.operation !== 'OPEN' && s.hasRequestReviewSchema(db))
          expected += refreshViews(
            db,
            p.campaignId,
            i.commandId,
            i.receiptId,
            validatePrivateOwner,
          );
        if (!db.inTransaction || s.changes(db) !== before + expected)
          return s.fail('SOURCE_CHANGED');
        const verified = command(db, p, i.commandId) ?? s.fail();
        if (
          !s.same(verified, { ...record, current }) ||
          !s.same(source(db, p, validatePrivateOwner), campaign)
        )
          return s.fail('SOURCE_CHANGED');
        s.guarded(db, guard, proof, 'APPLY');
        if (i.operation === 'SUBMIT')
          candidateBaselineGuard(db, campaign, i.batch, 'APPLY', validateCandidateBaseline);
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
