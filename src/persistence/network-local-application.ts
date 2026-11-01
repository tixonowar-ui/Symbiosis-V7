import { createHash } from 'node:crypto';
import { types } from 'node:util';
import type Database from 'better-sqlite3';
import type { PublicCandidateRef } from '@shared/device-admission.js';
import type {
  NetworkPublicErrorCode,
  NetworkGmRequestDecisionReceipt,
} from '@shared/network-application.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import { loadDeviceId } from './device-identity.js';
import {
  readOwnedLocalNetworkTabAnchor as readOwnedLocalNetworkTab,
  readLocalNetworkTabEntryByCommandId,
  localAdmissionTabStorage,
  writeLocalNetworkTabApplicationState,
  type LocalNetworkTab,
} from './network-local-tab.js';
import { NETWORK_APPLICATION_TABLES } from './migrations/0010-network-application.js';
import { DEVICE_REQUEST_REVIEW_TABLES } from './migrations/0011-device-request-review.js';
import {
  CAMPAIGN_ADMISSION_IDENTITIES,
  CAMPAIGN_ADMISSION_TABLES,
} from './migrations/0012-campaign-admission.js';
import type { RevisionTriple } from './store.js';
import {
  assertLocalAdmissionTabMutable,
  validateLocalAdmissionNetworkEvent,
  createLocalAdmissionNetworkVerifier,
} from './local-campaign-admission.js';

export interface NetworkPublicIdentity {
  readonly schemaVersion: 1;
  readonly algorithm: 'ED25519';
  readonly ownerDeviceId: string;
  readonly publicKeySpkiBase64: string;
  readonly keyFingerprintSha256: string;
}
export interface NetworkCampaignProof {
  readonly campaignId: string;
  readonly revisions: RevisionTriple;
  readonly checkpointSha256: string;
}
export interface NetworkCandidateDescriptor {
  readonly sourceUuid: string;
  readonly sourceSnapshotId: string;
  readonly finalSnapshotVersion: number;
  readonly metadataRevision: number;
  readonly sourceChecksum: string;
  readonly exportChecksum: string;
  readonly exportBytesSha256: string;
  readonly baselineVersion: string;
}
export interface NetworkPreparedCandidate {
  readonly descriptor: NetworkCandidateDescriptor;
  readonly exportDocument: JsonObject;
  readonly canonicalWitnessText: string;
  readonly witnessSha256: string;
  readonly byteLength: number;
}
interface NetworkPreparedBatchBase {
  readonly requestId: string;
  readonly technicalSessionId: string;
  readonly connectionRevision: number;
  readonly campaignProof: NetworkCampaignProof;
  readonly candidates: readonly NetworkPreparedCandidate[];
  readonly batchSha256: string;
}
export type NetworkPreparedBatch = NetworkPreparedBatchBase &
  (
    | { readonly schemaVersion?: never; readonly localControllerSeatId?: never }
    | { readonly schemaVersion: 2; readonly localControllerSeatId: string }
  );
export type NetworkApplicationFormId =
  'NET-001' | 'NET-002' | 'NET-003' | 'NET-004' | 'NET-005' | 'NET-011' | 'CHR-027';
export interface LocalNetworkScope {
  readonly ownerDeviceId: string;
  readonly networkScopeId: string;
}
export interface LocalNetworkSource extends LocalNetworkScope {
  readonly expectedRevisions: RevisionTriple;
  readonly expectedDraftRevision: number;
}
export interface LocalNetworkHostPin {
  readonly ownerDeviceId: string;
  readonly campaignId: string;
  readonly identity: NetworkPublicIdentity;
  readonly initialCanonicalOrigin: string;
  readonly entryCommandId: string;
}
export interface NetworkSessionConfirmation {
  readonly technicalSessionId: string;
  readonly attemptId: string;
  readonly campaignProof: NetworkCampaignProof;
  readonly connectionRevision: number;
  readonly receiptId: string;
}
export interface NetworkRequestConfirmation {
  readonly requestId: string;
  readonly technicalSessionId: string;
  readonly submitCommandId: string;
  readonly submitReceiptId: string;
  readonly requestRevision: number;
  readonly status: 'PENDING';
  readonly batchSha256: string;
  readonly closureOrNull: null | {
    readonly commandId: string;
    readonly receiptId: string;
    readonly reason: string;
  };
}
export interface LocalNetworkApplication extends LocalNetworkScope, RevisionTriple {
  readonly schemaVersion: 1 | 2;
  /** Introduced only by an explicit review event; legacy serialized heads stay byte-exact. */
  readonly requestReviewOrNull?: VerifiedLocalRequestCurrent | null;
  readonly tabId: string;
  readonly formId: NetworkApplicationFormId;
  readonly draftRevision: number;
  readonly addressOrQrPayload: string;
  readonly cancelReason: string;
  readonly selectedCandidates: readonly PublicCandidateRef[];
  readonly selectedCampaignIdOrNull: string | null;
  readonly requestedControllerSeatOrNull: string | null;
  readonly plannedAttemptIdOrNull: string | null;
  readonly lastAttemptIdOrNull: string | null;
  readonly preparedBatchOrNull: NetworkPreparedBatch | null;
  readonly sessionOrNull: NetworkSessionConfirmation | null;
  readonly requestOrNull: NetworkRequestConfirmation | null;
  readonly pendingCommandIdOrNull: string | null;
  readonly diagnosticCodeOrNull: NetworkPublicErrorCode | null;
  readonly shellExitOrNull: {
    readonly navigationRequestId: string;
    readonly sourceUuid: string;
  } | null;
}
export type LocalNetworkIntent =
  | {
      readonly operation: 'OPEN';
      readonly commandId: string;
      readonly clientRequestJson: string;
      readonly attemptId: string;
      readonly canonicalOrigin: string;
      readonly campaignId: string;
      readonly semanticBodyJson: string;
    }
  | {
      readonly operation: 'SUBMIT';
      readonly commandId: string;
      readonly clientRequestJson: string;
      readonly requestId: string;
      readonly semanticBodyJson: string;
      readonly batch: NetworkPreparedBatch;
    }
  | {
      readonly operation: 'CANCEL';
      readonly commandId: string;
      readonly clientRequestJson: string;
      readonly requestId: string;
      readonly technicalSessionId: string;
      readonly requestRevision: number;
      readonly reason: string;
      readonly semanticBodyJson: string;
    };
export type LocalNetworkAcknowledgement =
  | {
      readonly operation: 'OPEN_FAILURE';
      readonly commandId: string;
      readonly semanticBodySha256: string;
      readonly attemptId: string;
      readonly code: NetworkPublicErrorCode;
      readonly proofKind: 'NOT_SENT' | 'FENCED_ABSENT';
      readonly verifiedReceipt: JsonObject;
    }
  | {
      readonly operation: 'OPEN';
      readonly commandId: string;
      readonly semanticBodySha256: string;
      readonly session: NetworkSessionConfirmation;
      readonly verifiedReceipt: JsonObject;
    }
  | {
      readonly operation: 'SUBMIT';
      readonly commandId: string;
      readonly semanticBodySha256: string;
      readonly request: NetworkRequestConfirmation;
      readonly verifiedReceipt: JsonObject;
    }
  | {
      readonly operation: 'CANCEL';
      readonly commandId: string;
      readonly semanticBodySha256: string;
      readonly request: NetworkRequestConfirmation;
      readonly verifiedReceipt: JsonObject;
    };
export interface LocalNetworkOutbox extends LocalNetworkScope {
  readonly intent: LocalNetworkIntent;
  readonly sourceRevisions: RevisionTriple;
  readonly semanticBodySha256: string;
  readonly acknowledgementOrNull: LocalNetworkAcknowledgement | null;
}
export type LocalNetworkMutation =
  | {
      readonly kind: 'ADMISSION_ADVANCE';
      readonly requestId: string;
      readonly ownerEventIdOrNull: string | null;
      readonly ownerSha256: string;
    }
  | {
      readonly kind: 'ADMISSION_RETURN';
      readonly requestId: string;
      readonly returnEventId: string;
      readonly returnEventSha256: string;
      readonly mode: 'RESELECT' | 'MENU';
    }
  | { readonly kind: 'LANE_BIND_INTENT'; readonly outbox: LocalRequestLaneBindingOutbox }
  | {
      readonly kind: 'LANE_BIND_ACK';
      readonly commandId: string;
      readonly receipt: PeerLaneBindingReceipt;
    }
  | { readonly kind: 'REQUEST_ADVANCE'; readonly proof: VerifiedRequestReviewProof }
  | {
      readonly kind: 'CANCEL_SETTLE';
      readonly commandId: string;
      readonly proof: VerifiedRequestReviewProof;
    }
  | { readonly kind: 'ADDRESS'; readonly addressOrQrPayload: string }
  | { readonly kind: 'CANCEL_REASON'; readonly cancelReason: string }
  | {
      readonly kind: 'SHELL_EXIT';
      readonly navigationRequestId: string;
      readonly sourceUuid: string;
    }
  | { readonly kind: 'SELECTION'; readonly selectedCandidates: readonly PublicCandidateRef[] }
  | {
      readonly kind: 'SINGLE_CANDIDATE';
      readonly selectedCampaignId: string | null;
      readonly requestedControllerSeat: string | null;
    }
  | {
      readonly kind: 'NAVIGATE';
      readonly targetFormId: NetworkApplicationFormId;
      readonly plannedAttemptIdOrNull: string | null;
      readonly singleCandidateOrNull: PublicCandidateRef | null;
    }
  | { readonly kind: 'PREPARE_BATCH'; readonly batch: NetworkPreparedBatch }
  | { readonly kind: 'INTENT'; readonly intent: LocalNetworkIntent }
  | { readonly kind: 'ACKNOWLEDGE'; readonly acknowledgement: LocalNetworkAcknowledgement }
  | {
      readonly kind: 'DIAGNOSTIC';
      readonly code: NetworkPublicErrorCode;
      readonly attemptIdOrNull?: string | null;
    };
export interface LocalNetworkMutationInput extends LocalNetworkSource {
  readonly eventId: string;
  readonly receiptId: string;
  readonly clientRequestJsonOrNull: string | null;
  readonly mutation: LocalNetworkMutation;
}
export interface LocalNetworkEventReceipt {
  readonly eventId: string;
  readonly receiptId: string;
  readonly networkScopeId: string;
  readonly changed: boolean;
  readonly revisions: RevisionTriple;
  readonly draftRevision: number;
  readonly formId: NetworkApplicationFormId;
}
export interface StoredLocalNetworkEvent {
  readonly input: LocalNetworkMutationInput;
  readonly receipt: LocalNetworkEventReceipt;
  readonly current: LocalNetworkApplication;
}
export interface LocalNetworkDeliverySnapshot {
  readonly current: LocalNetworkApplication;
  readonly outbox: LocalNetworkOutbox | null;
  readonly acknowledgementEvent: StoredLocalNetworkEvent | null;
  readonly requestCurrentOrNull: VerifiedLocalRequestCurrent | null;
  readonly cancelSettlementOrNull: LocalCancelSettlement | null;
}
export interface LocalCancelSettlement {
  readonly commandId: string;
  readonly requestId: string;
  readonly proof: VerifiedRequestReviewProof;
}
export type NetworkStoreGuard<T> = (source: T, phase: 'APPLY' | 'REPLAY') => void;

export interface DeviceRequestBindLane {
  readonly schemaVersion: 1;
  readonly operation: 'DEVICE_REQUEST_BIND_LANE';
  readonly commandId: string;
  readonly requestId: string;
  readonly technicalSessionId: string;
  readonly submitCommandId: string;
  readonly batchSha256: string;
  readonly localControllerSeatId: string;
}
export interface HostedRequestLaneBinding {
  readonly campaignId: string;
  readonly requestOwnerDeviceId: string;
  readonly requestId: string;
  readonly technicalSessionId: string;
  readonly submitCommandId: string;
  readonly batchSha256: string;
  readonly localControllerSeatId: string;
}
export interface PeerLaneBindingReceipt {
  readonly operation: 'BIND_LANE';
  readonly commandId: string;
  readonly receiptId: string;
  readonly semanticBodySha256: string;
  readonly binding: HostedRequestLaneBinding;
}
export interface LegacyRequestReceipt {
  readonly operation: 'SUBMIT' | 'CANCEL';
  readonly commandId: string;
  readonly receiptId: string;
  readonly semanticBodySha256: string;
  readonly request: NetworkRequestConfirmation;
}
export interface VerifiedRequestReviewProof {
  readonly submittedReceipt: LegacyRequestReceipt & { readonly operation: 'SUBMIT' };
  readonly cancelledReceiptOrNull: (LegacyRequestReceipt & { readonly operation: 'CANCEL' }) | null;
  readonly decisions: readonly NetworkGmRequestDecisionReceipt[];
  readonly laneProvenance:
    | {
        readonly kind: 'SUBMITTED_BATCH';
        readonly batchSha256: string;
        readonly localControllerSeatId: string;
      }
    | { readonly kind: 'BIND_LANE'; readonly receipt: PeerLaneBindingReceipt }
    | null;
}
export interface VerifiedLocalRequestCurrent {
  readonly proof: VerifiedRequestReviewProof;
  readonly requestStatus: 'PENDING' | 'IN_REVIEW' | 'REJECTED' | 'CANCELLED';
  readonly requestRevision: number;
}
export interface LocalRequestLaneOriginWitness extends LocalNetworkScope {
  readonly tabId: string;
  readonly entryCommandId: string;
  readonly entryReceiptId: string;
  readonly submitCommandId: string;
  readonly submitIntentEventId: string;
  readonly submitIntentEventReceiptId: string;
  readonly submitIntentEventSha256: string;
  readonly originalEntrySha256: string;
  readonly originEvidenceSha256: string;
}
export interface LocalRequestLaneBindingOutbox extends LocalNetworkScope {
  readonly requestId: string;
  readonly request: DeviceRequestBindLane;
  readonly semanticBodySha256: string;
  readonly origin: LocalRequestLaneOriginWitness;
  readonly receiptOrNull: PeerLaneBindingReceipt | null;
}
export interface LocalRequestLaneBindingDelivery {
  readonly outbox: LocalRequestLaneBindingOutbox;
  readonly current: LocalNetworkDeliverySnapshot;
}

/** Source closure is intentionally independent of browser projection/role claims. */
export function validateDeviceRequestBindLane(value: unknown): DeviceRequestBindLane {
  const row = object(value, [
    'schemaVersion',
    'operation',
    'commandId',
    'requestId',
    'technicalSessionId',
    'submitCommandId',
    'batchSha256',
    'localControllerSeatId',
  ]);
  if (row['schemaVersion'] !== 1 || row['operation'] !== 'DEVICE_REQUEST_BIND_LANE') return fail();
  const result = {
    schemaVersion: 1 as const,
    operation: 'DEVICE_REQUEST_BIND_LANE' as const,
    commandId: text(row['commandId']),
    requestId: uuid(row['requestId']),
    technicalSessionId: uuid(row['technicalSessionId']),
    submitCommandId: text(row['submitCommandId']),
    batchSha256: hash(row['batchSha256']),
    localControllerSeatId: uuid(row['localControllerSeatId']),
  };
  if (
    new Set([
      result.commandId,
      result.requestId,
      result.technicalSessionId,
      result.submitCommandId,
      result.localControllerSeatId,
    ]).size !== 5
  )
    return fail();
  return result;
}
export function validatePeerLaneBindingReceipt(value: unknown): PeerLaneBindingReceipt {
  const row = object(value, [
    'operation',
    'commandId',
    'receiptId',
    'semanticBodySha256',
    'binding',
  ]);
  if (row['operation'] !== 'BIND_LANE') return fail();
  const b = object(row['binding'], [
    'campaignId',
    'requestOwnerDeviceId',
    'requestId',
    'technicalSessionId',
    'submitCommandId',
    'batchSha256',
    'localControllerSeatId',
  ]);
  const binding: HostedRequestLaneBinding = {
    campaignId: uuid(b['campaignId']),
    requestOwnerDeviceId: uuid(b['requestOwnerDeviceId']),
    requestId: uuid(b['requestId']),
    technicalSessionId: uuid(b['technicalSessionId']),
    submitCommandId: text(b['submitCommandId']),
    batchSha256: hash(b['batchSha256']),
    localControllerSeatId: uuid(b['localControllerSeatId']),
  };
  const command = validateDeviceRequestBindLane({
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_BIND_LANE',
    commandId: text(row['commandId']),
    requestId: binding.requestId,
    technicalSessionId: binding.technicalSessionId,
    submitCommandId: binding.submitCommandId,
    batchSha256: binding.batchSha256,
    localControllerSeatId: binding.localControllerSeatId,
  });
  const receiptId = text(row['receiptId']);
  if (
    receiptId === command.commandId ||
    hash(row['semanticBodySha256']) !== sha(canonical(command))
  )
    return fail();
  return {
    operation: 'BIND_LANE',
    commandId: command.commandId,
    receiptId,
    semanticBodySha256: sha(canonical(command)),
    binding,
  };
}
export function validateLegacyRequestReceipt(value: unknown): LegacyRequestReceipt {
  const row = object(value, [
    'operation',
    'commandId',
    'receiptId',
    'semanticBodySha256',
    'request',
  ]);
  const operation = row['operation'];
  if (operation !== 'SUBMIT' && operation !== 'CANCEL') return fail();
  const header = request(row['request']),
    commandId = text(row['commandId']),
    receiptId = text(row['receiptId']);
  if (
    commandId === receiptId ||
    (operation === 'SUBMIT'
      ? header.requestRevision !== 0 ||
        header.closureOrNull !== null ||
        header.submitCommandId !== commandId ||
        header.submitReceiptId !== receiptId
      : header.requestRevision !== 1 ||
        header.closureOrNull?.commandId !== commandId ||
        header.closureOrNull.receiptId !== receiptId)
  )
    return fail();
  return {
    operation,
    commandId,
    receiptId,
    semanticBodySha256: hash(row['semanticBodySha256']),
    request: header,
  };
}
export function validateRequestReviewProof(
  value: unknown,
  expected: {
    readonly submittedReceipt: LegacyRequestReceipt;
    readonly batch: NetworkPreparedBatch;
    readonly requestOwnerDeviceId: string;
    readonly campaignId: string;
    readonly authoritativeGmActorId?: string;
  },
): VerifiedLocalRequestCurrent {
  const row = object(value, [
    'submittedReceipt',
    'cancelledReceiptOrNull',
    'decisions',
    'laneProvenance',
  ]);
  const submitted = validateLegacyRequestReceipt(row['submittedReceipt']);
  if (
    submitted.operation !== 'SUBMIT' ||
    !same(submitted, expected.submittedReceipt) ||
    expected.batch.requestId !== submitted.request.requestId ||
    expected.batch.technicalSessionId !== submitted.request.technicalSessionId ||
    expected.batch.batchSha256 !== submitted.request.batchSha256 ||
    expected.batch.campaignProof.campaignId !== expected.campaignId
  )
    return fail();
  uuid(expected.requestOwnerDeviceId);
  uuid(expected.campaignId);
  const rawDecisions = row['decisions'];
  if (!Array.isArray(rawDecisions) || rawDecisions.length > 2) return fail();
  let status: VerifiedLocalRequestCurrent['requestStatus'] = 'PENDING';
  let revision = 0;
  const decisions: NetworkGmRequestDecisionReceipt[] = [];
  const ids = new Set([
    submitted.commandId,
    submitted.receiptId,
    submitted.request.requestId,
    submitted.request.technicalSessionId,
    expected.requestOwnerDeviceId,
    expected.campaignId,
  ]);
  for (const value of rawDecisions) {
    const d = object(value, [
      'receiptId',
      'commandId',
      'workflowCommandId',
      'campaignId',
      'requestId',
      'requestOwnerDeviceId',
      'beforeRequestStatus',
      'afterRequestStatus',
      'beforeRequestRevision',
      'requestRevision',
      'decisionReasonOrNull',
      'candidateSnapshotChecksums',
      'authoritativeGmActorId',
      'timestamp',
    ]);
    const commandId = text(d['commandId']),
      receiptId = text(d['receiptId']);
    const accept = d['workflowCommandId'] === 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW';
    if (
      (!accept && d['workflowCommandId'] !== 'UI-CMD-DEVICE-REQUEST-REJECT') ||
      ids.has(commandId) ||
      ids.has(receiptId) ||
      commandId === receiptId ||
      commandId === d['authoritativeGmActorId'] ||
      receiptId === d['authoritativeGmActorId'] ||
      d['campaignId'] !== expected.campaignId ||
      d['requestId'] !== submitted.request.requestId ||
      d['requestOwnerDeviceId'] !== expected.requestOwnerDeviceId ||
      d['beforeRequestStatus'] !== status ||
      integer(d['beforeRequestRevision']) !== revision ||
      integer(d['requestRevision']) !== increment(revision) ||
      (status !== 'PENDING' && status !== 'IN_REVIEW') ||
      (accept && status !== 'PENDING') ||
      d['afterRequestStatus'] !== (accept ? 'IN_REVIEW' : 'REJECTED') ||
      !same(
        d['candidateSnapshotChecksums'],
        expected.batch.candidates.map((c) => c.descriptor.exportBytesSha256),
      ) ||
      (expected.authoritativeGmActorId !== undefined &&
        d['authoritativeGmActorId'] !== expected.authoritativeGmActorId)
    )
      return fail();
    text(d['authoritativeGmActorId']);
    text(d['timestamp']);
    if (
      accept
        ? d['decisionReasonOrNull'] !== null
        : text(d['decisionReasonOrNull']).trim().length === 0
    )
      return fail();
    ids.add(commandId);
    ids.add(receiptId);
    revision = increment(revision);
    status = accept ? 'IN_REVIEW' : 'REJECTED';
    decisions.push(d as unknown as NetworkGmRequestDecisionReceipt);
  }
  let cancelled: (LegacyRequestReceipt & { readonly operation: 'CANCEL' }) | null = null;
  if (row['cancelledReceiptOrNull'] !== null) {
    const c = validateLegacyRequestReceipt(row['cancelledReceiptOrNull']);
    if (
      c.operation !== 'CANCEL' ||
      decisions.length !== 0 ||
      ids.has(c.commandId) ||
      ids.has(c.receiptId) ||
      !same({ ...c.request, requestRevision: 0, closureOrNull: null }, submitted.request)
    )
      return fail();
    cancelled = { ...c, operation: 'CANCEL' };
    ids.add(c.commandId);
    ids.add(c.receiptId);
    revision = 1;
    status = 'CANCELLED';
  }
  let lane: VerifiedRequestReviewProof['laneProvenance'] = null;
  if (row['laneProvenance'] !== null) {
    const l = object(row['laneProvenance']);
    if (l['kind'] === 'SUBMITTED_BATCH') {
      object(l, ['kind', 'batchSha256', 'localControllerSeatId']);
      if (
        expected.batch.schemaVersion !== 2 ||
        l['batchSha256'] !== expected.batch.batchSha256 ||
        l['localControllerSeatId'] !== expected.batch.localControllerSeatId
      )
        return fail();
      lane = {
        kind: 'SUBMITTED_BATCH',
        batchSha256: expected.batch.batchSha256,
        localControllerSeatId: expected.batch.localControllerSeatId,
      };
    } else if (l['kind'] === 'BIND_LANE') {
      object(l, ['kind', 'receipt']);
      const receipt = validatePeerLaneBindingReceipt(l['receipt']);
      const b = receipt.binding;
      if (
        expected.batch.schemaVersion === 2 ||
        b.requestOwnerDeviceId !== expected.requestOwnerDeviceId ||
        b.campaignId !== expected.campaignId ||
        b.requestId !== submitted.request.requestId ||
        b.technicalSessionId !== submitted.request.technicalSessionId ||
        b.submitCommandId !== submitted.commandId ||
        b.batchSha256 !== expected.batch.batchSha256 ||
        ids.has(receipt.commandId) ||
        ids.has(receipt.receiptId)
      )
        return fail();
      lane = { kind: 'BIND_LANE', receipt };
    } else return fail();
  } else if (expected.batch.schemaVersion === 2) return fail();
  if (decisions.length !== 0 && lane === null) return fail();
  return {
    proof: {
      submittedReceipt: { ...submitted, operation: 'SUBMIT' },
      cancelledReceiptOrNull: cancelled,
      decisions,
      laneProvenance: lane,
    },
    requestStatus: status,
    requestRevision: revision,
  };
}
export type NetworkApplicationStoreCode =
  | 'INVALID_INPUT'
  | 'CORRUPT_STORAGE'
  | 'FOREIGN_OWNER'
  | 'OWNER_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STALE_REVISION'
  | 'REVISION_OVERFLOW'
  | 'SOURCE_CHANGED'
  | 'UNAVAILABLE'
  | 'KEY_CONFLICT'
  | 'CAPACITY_EXCEEDED';
export class NetworkApplicationStoreError extends Error {
  constructor(readonly code: NetworkApplicationStoreCode) {
    super(`network application storage: ${code}`);
  }
}

type Row = Record<string, unknown>;
const vectorKeys = ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const;
const stateKeys = [
  'shellExitOrNull',
  'schemaVersion',
  'ownerDeviceId',
  'networkScopeId',
  'tabId',
  'formId',
  'draftRevision',
  'addressOrQrPayload',
  'cancelReason',
  'selectedCandidates',
  'selectedCampaignIdOrNull',
  'requestedControllerSeatOrNull',
  'plannedAttemptIdOrNull',
  'lastAttemptIdOrNull',
  'preparedBatchOrNull',
  'sessionOrNull',
  'requestOrNull',
  'pendingCommandIdOrNull',
  'diagnosticCodeOrNull',
  ...vectorKeys,
] as const;
const forms = [
  'NET-001',
  'NET-002',
  'NET-003',
  'NET-004',
  'NET-005',
  'NET-011',
  'CHR-027',
] as const;
const publicErrorCodes = [
  'INVALID_ADDRESS',
  'CAMPAIGN_UNAVAILABLE',
  'AMBIGUOUS_CAMPAIGN',
  'INCOMPATIBLE_BASELINE',
  'HOST_IDENTITY_CHANGED',
  'PEER_UNAVAILABLE',
  'UNCONFIRMED_OUTCOME',
] as const satisfies readonly NetworkPublicErrorCode[];
function diagnosticCode(value: unknown): NetworkPublicErrorCode {
  return publicErrorCodes.some((code) => code === value)
    ? (value as NetworkPublicErrorCode)
    : fail();
}
const fail = (code: NetworkApplicationStoreCode = 'CORRUPT_STORAGE'): never => {
  throw new NetworkApplicationStoreError(code);
};
function object(value: unknown, keys?: readonly string[]): Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail();
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) return fail();
  const names = keys ?? Object.keys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== names.length ||
    names.some(
      (key) =>
        !Object.hasOwn(descriptors, key) ||
        !Object.hasOwn(descriptors[key]!, 'value') ||
        !descriptors[key]!.enumerable,
    )
  )
    return fail();
  return value as Row;
}
// A synchronous store operation repeatedly serializes the same immutable witness strings.
// Cache only primitive string encodings, never objects, validation or authority results.
// The 16 MiB memory budget is per operation and is discarded before control returns to a caller.
let canonicalStrings: { values: Map<string, string>; remaining: number } | null = null;
function canonical(value: unknown): string {
  if (typeof value === 'string') {
    const cache = canonicalStrings;
    if (cache === null || value.length < 1024) return JSON.stringify(value);
    const known = cache.values.get(value);
    if (known !== undefined) return known;
    const encoded = JSON.stringify(value);
    const bytes = (value.length + encoded.length) * 2;
    if (bytes <= cache.remaining) {
      cache.values.set(value, encoded);
      cache.remaining -= bytes;
    }
    return encoded;
  }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== value.length + 1 ||
      Array.from({ length: value.length }, (_, i) => descriptors[String(i)]).some(
        (d) => d === undefined || !Object.hasOwn(d, 'value') || !d.enumerable,
      )
    )
      return fail();
    return `[${Array.from({ length: value.length }, (_, i) => canonical(value[i])).join(',')}]`;
  }
  const row = object(value);
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
    .join(',')}}`;
}
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const text = (value: unknown): string =>
  typeof value === 'string' && value.length > 0 ? value : fail();
const uuid = (value: unknown): string =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(text(value))
    ? (value as string)
    : fail();
const hash = (value: unknown): string =>
  /^[0-9a-f]{64}$/u.test(text(value)) ? (value as string) : fail();
const integer = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
const nullableText = (value: unknown): string | null => (value === null ? null : text(value));
function vector(value: unknown): RevisionTriple {
  const row = object(value, vectorKeys);
  return {
    stateRevision: integer(row['stateRevision']),
    projectionRevision: integer(row['projectionRevision']),
    actorVisibilityRevision: integer(row['actorVisibilityRevision']),
  };
}
const vectorOf = (value: RevisionTriple): RevisionTriple => ({
  stateRevision: value.stateRevision,
  projectionRevision: value.projectionRevision,
  actorVisibilityRevision: value.actorVisibilityRevision,
});
const zero = (): RevisionTriple => ({
  stateRevision: 0,
  projectionRevision: 0,
  actorVisibilityRevision: 0,
});
const increment = (value: number): number =>
  value < Number.MAX_SAFE_INTEGER ? value + 1 : fail('REVISION_OVERFLOW');
function safe<T>(body: () => T): T {
  const outer = canonicalStrings;
  canonicalStrings ??= { values: new Map(), remaining: 16 * 1024 * 1024 };
  try {
    return body();
  } catch (error: unknown) {
    if (error instanceof NetworkApplicationStoreError) throw error;
    return fail();
  } finally {
    canonicalStrings = outer;
  }
}
function input<T>(body: () => T): T {
  try {
    return body();
  } catch {
    return fail('INVALID_INPUT');
  }
}
function schema(db: Database.Database): void {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row;
  if (row['version'] !== 10 && row['version'] !== 11 && row['version'] !== 12) return fail();
  for (const table of NETWORK_APPLICATION_TABLES)
    db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  if (row['version'] === 11 || row['version'] === 12)
    for (const table of DEVICE_REQUEST_REVIEW_TABLES)
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  if (row['version'] === 12)
    for (const table of CAMPAIGN_ADMISSION_TABLES)
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
}
function hasRequestReviewSchema(db: Database.Database): boolean {
  const version = (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)[
    'version'
  ];
  if (version !== 10 && version !== 11 && version !== 12) return fail();
  return version === 11 || version === 12;
}
function owner(db: Database.Database, id: string): void {
  uuid(id);
  let current: string;
  try {
    current = loadDeviceId(db);
  } catch {
    return fail('OWNER_UNAVAILABLE');
  }
  if (current !== id) return fail('FOREIGN_OWNER');
}
function read<T>(db: Database.Database, id: string, body: () => T): T {
  return safe(() => {
    const run = () => {
      schema(db);
      owner(db, id);
      return body();
    };
    return db.inTransaction ? run() : db.transaction(run).deferred();
  });
}
const at = (db: Database.Database, table: string, column: string, id: string): Row | undefined =>
  db.prepare(`SELECT * FROM ${table} WHERE ${column}=?`).get(id) as Row | undefined;
function checked(row: Row): unknown {
  const json = text(row['record_json']);
  if (sha(json) !== row['record_sha256']) return fail();
  const value: unknown = JSON.parse(json);
  if (canonical(value) !== json) return fail();
  return value;
}
/** The replayed value is authoritative; exact canonical bytes also prove stored JSON canonicality. */
function checkedEqual(row: Row, expected: unknown): boolean {
  const json = text(row['record_json']);
  if (sha(json) !== row['record_sha256']) return fail();
  return json === canonical(expected);
}
function changes(db: Database.Database): number {
  return integer((db.prepare('SELECT total_changes() AS n').get() as Row)['n']);
}
function consume(value: unknown): void {
  if (!types.isPromise(value)) return;
  try {
    void Promise.prototype.then.call(
      value,
      () => undefined,
      () => undefined,
    );
  } catch {
    /* Trusted callbacks only. */
  }
}
function guarded<T>(
  db: Database.Database,
  guard: NetworkStoreGuard<T>,
  source: T,
  phase: 'APPLY' | 'REPLAY',
): void {
  if (
    typeof guard !== 'function' ||
    Object.prototype.toString.call(guard) === '[object AsyncFunction]'
  )
    return fail('INVALID_INPUT');
  const stamp = () =>
    `${changes(db)}/${String(db.pragma('schema_version', { simple: true }))}/${String(db.pragma('user_version', { simple: true }))}`;
  const before = stamp(),
    sourceBefore = canonical(source);
  let returned: unknown;
  try {
    returned = guard(source, phase);
  } catch (error: unknown) {
    consume(error);
    return fail('INVALID_INPUT');
  }
  consume(returned);
  if (!db.inTransaction || before !== stamp() || canonical(source) !== sourceBefore)
    return fail('SOURCE_CHANGED');
  if (returned !== undefined) return fail('INVALID_INPUT');
}
function identity(value: unknown): NetworkPublicIdentity {
  const row = object(value, [
    'schemaVersion',
    'algorithm',
    'ownerDeviceId',
    'publicKeySpkiBase64',
    'keyFingerprintSha256',
  ]);
  if (row['schemaVersion'] !== 1 || row['algorithm'] !== 'ED25519') return fail();
  const bytes = Buffer.from(text(row['publicKeySpkiBase64']), 'base64');
  if (
    bytes.length === 0 ||
    bytes.toString('base64') !== row['publicKeySpkiBase64'] ||
    createHash('sha256').update(bytes).digest('hex') !== hash(row['keyFingerprintSha256'])
  )
    return fail();
  return {
    schemaVersion: 1,
    algorithm: 'ED25519',
    ownerDeviceId: uuid(row['ownerDeviceId']),
    publicKeySpkiBase64: row['publicKeySpkiBase64'],
    keyFingerprintSha256: row['keyFingerprintSha256'] as string,
  };
}
function campaignProof(value: unknown): NetworkCampaignProof {
  const row = object(value, ['campaignId', 'revisions', 'checkpointSha256']);
  return {
    campaignId: uuid(row['campaignId']),
    revisions: vector(row['revisions']),
    checkpointSha256: hash(row['checkpointSha256']),
  };
}
function descriptor(value: unknown): NetworkCandidateDescriptor {
  const row = object(value, [
    'sourceUuid',
    'sourceSnapshotId',
    'finalSnapshotVersion',
    'metadataRevision',
    'sourceChecksum',
    'exportChecksum',
    'exportBytesSha256',
    'baselineVersion',
  ]);
  return {
    sourceUuid: text(row['sourceUuid']),
    sourceSnapshotId: text(row['sourceSnapshotId']),
    finalSnapshotVersion: integer(row['finalSnapshotVersion']),
    metadataRevision: integer(row['metadataRevision']),
    sourceChecksum: hash(row['sourceChecksum']),
    exportChecksum: hash(row['exportChecksum']),
    exportBytesSha256: hash(row['exportBytesSha256']),
    baselineVersion: text(row['baselineVersion']),
  };
}
function candidate(value: unknown): NetworkPreparedCandidate {
  const row = object(value, [
    'descriptor',
    'exportDocument',
    'canonicalWitnessText',
    'witnessSha256',
    'byteLength',
  ]);
  const witness = text(row['canonicalWitnessText']);
  const doc = object(row['exportDocument']);
  canonical(doc);
  if (
    sha(witness) !== hash(row['witnessSha256']) ||
    Buffer.byteLength(witness, 'utf8') !== integer(row['byteLength'])
  )
    return fail();
  return {
    descriptor: descriptor(row['descriptor']),
    exportDocument: doc as JsonObject,
    canonicalWitnessText: witness,
    witnessSha256: row['witnessSha256'] as string,
    byteLength: row['byteLength'] as number,
  };
}
function batch(value: unknown): NetworkPreparedBatch {
  const batchRecord = object(value);
  const versioned = batchRecord['schemaVersion'] === 2;
  const row = object(value, [
    'requestId',
    'technicalSessionId',
    'connectionRevision',
    'campaignProof',
    'candidates',
    'batchSha256',
    ...(versioned ? ['schemaVersion', 'localControllerSeatId'] : []),
  ]);
  if (
    !Array.isArray(row['candidates']) ||
    row['candidates'].length < 1 ||
    row['candidates'].length > 3
  )
    return fail();
  const candidates = row['candidates'].map(candidate);
  if (new Set(candidates.map((c) => c.descriptor.sourceUuid)).size !== candidates.length)
    return fail();
  const body = {
    ...(versioned
      ? { schemaVersion: 2 as const, localControllerSeatId: uuid(row['localControllerSeatId']) }
      : {}),
    requestId: uuid(row['requestId']),
    technicalSessionId: uuid(row['technicalSessionId']),
    connectionRevision: integer(row['connectionRevision']),
    campaignProof: campaignProof(row['campaignProof']),
    candidates,
  };
  if (sha(canonical(body)) !== hash(row['batchSha256'])) return fail();
  return { ...body, batchSha256: row['batchSha256'] as string };
}
function refs(value: unknown, tabId: string): readonly PublicCandidateRef[] {
  if (!Array.isArray(value) || value.length > 3) return fail();
  const result = value.map((item) => {
    const row = object(item, [
      'sourceUuid',
      'finalSnapshotVersion',
      'metadataRevision',
      'candidateSnapshotChecksum',
      'requestedControllerSeat',
    ]);
    if (row['requestedControllerSeat'] !== tabId) return fail();
    return {
      sourceUuid: text(row['sourceUuid']),
      finalSnapshotVersion: integer(row['finalSnapshotVersion']),
      metadataRevision: integer(row['metadataRevision']),
      candidateSnapshotChecksum: hash(row['candidateSnapshotChecksum']),
      requestedControllerSeat: tabId,
    };
  });
  if (new Set(result.map((c) => c.sourceUuid)).size !== result.length) return fail();
  return result;
}
function session(value: unknown): NetworkSessionConfirmation {
  const row = object(value, [
    'technicalSessionId',
    'attemptId',
    'campaignProof',
    'connectionRevision',
    'receiptId',
  ]);
  return {
    technicalSessionId: uuid(row['technicalSessionId']),
    attemptId: text(row['attemptId']),
    campaignProof: campaignProof(row['campaignProof']),
    connectionRevision: integer(row['connectionRevision']),
    receiptId: text(row['receiptId']),
  };
}
function request(value: unknown): NetworkRequestConfirmation {
  const row = object(value, [
    'requestId',
    'technicalSessionId',
    'submitCommandId',
    'submitReceiptId',
    'requestRevision',
    'status',
    'batchSha256',
    'closureOrNull',
  ]);
  if (row['status'] !== 'PENDING') return fail();
  const close =
    row['closureOrNull'] === null
      ? null
      : object(row['closureOrNull'], ['commandId', 'receiptId', 'reason']);
  if (close !== null && text(close['reason']).trim() === '') return fail();
  return {
    requestId: uuid(row['requestId']),
    technicalSessionId: uuid(row['technicalSessionId']),
    submitCommandId: text(row['submitCommandId']),
    submitReceiptId: text(row['submitReceiptId']),
    requestRevision: integer(row['requestRevision']),
    status: 'PENDING',
    batchSha256: hash(row['batchSha256']),
    closureOrNull:
      close === null
        ? null
        : {
            commandId: text(close['commandId']),
            receiptId: text(close['receiptId']),
            reason: text(close['reason']),
          },
  };
}
function state(value: unknown): LocalNetworkApplication {
  const raw = object(value),
    version = raw['schemaVersion'];
  const row = object(value, [...stateKeys, ...(version === 2 ? ['requestReviewOrNull'] : [])]);
  const tabId = uuid(row['tabId']);
  if (
    (version !== 1 && version !== 2) ||
    !forms.some((form) => form === row['formId']) ||
    typeof row['addressOrQrPayload'] !== 'string' ||
    typeof row['cancelReason'] !== 'string'
  )
    return fail();
  const result = {
    ...row,
    ...vector(Object.fromEntries(vectorKeys.map((key) => [key, row[key]]))),
    schemaVersion: version,
    ownerDeviceId: uuid(row['ownerDeviceId']),
    networkScopeId: uuid(row['networkScopeId']),
    tabId,
    draftRevision: integer(row['draftRevision']),
    selectedCandidates: refs(row['selectedCandidates'], tabId),
    selectedCampaignIdOrNull:
      row['selectedCampaignIdOrNull'] === null ? null : uuid(row['selectedCampaignIdOrNull']),
    requestedControllerSeatOrNull: nullableText(row['requestedControllerSeatOrNull']),
    plannedAttemptIdOrNull:
      row['plannedAttemptIdOrNull'] === null ? null : text(row['plannedAttemptIdOrNull']),
    lastAttemptIdOrNull:
      row['lastAttemptIdOrNull'] === null ? null : text(row['lastAttemptIdOrNull']),
    preparedBatchOrNull:
      row['preparedBatchOrNull'] === null ? null : batch(row['preparedBatchOrNull']),
    sessionOrNull: row['sessionOrNull'] === null ? null : session(row['sessionOrNull']),
    requestOrNull: row['requestOrNull'] === null ? null : request(row['requestOrNull']),
    pendingCommandIdOrNull: nullableText(row['pendingCommandIdOrNull']),
    diagnosticCodeOrNull:
      row['diagnosticCodeOrNull'] === null ? null : diagnosticCode(row['diagnosticCodeOrNull']),
    shellExitOrNull: row['shellExitOrNull'] === null ? null : shellExit(row['shellExitOrNull']),
  } as unknown as LocalNetworkApplication;
  if (
    result.requestedControllerSeatOrNull !== null &&
    result.requestedControllerSeatOrNull !== tabId
  )
    return fail();
  return result;
}
function shellExit(value: unknown): NonNullable<LocalNetworkApplication['shellExitOrNull']> {
  const row = object(value, ['navigationRequestId', 'sourceUuid']);
  return {
    navigationRequestId: text(row['navigationRequestId']),
    sourceUuid: text(row['sourceUuid']),
  };
}
function initial(tab: LocalNetworkTab): LocalNetworkApplication {
  return {
    schemaVersion: 1,
    ownerDeviceId: tab.ownerDeviceId,
    networkScopeId: tab.networkScopeId,
    tabId: tab.tabId,
    ...zero(),
    formId: 'NET-001',
    draftRevision: 0,
    addressOrQrPayload: '',
    cancelReason: '',
    selectedCandidates: [],
    selectedCampaignIdOrNull: null,
    requestedControllerSeatOrNull: null,
    plannedAttemptIdOrNull: null,
    lastAttemptIdOrNull: null,
    preparedBatchOrNull: null,
    sessionOrNull: null,
    requestOrNull: null,
    pendingCommandIdOrNull: null,
    diagnosticCodeOrNull: null,
    shellExitOrNull: null,
  };
}

function semanticBody(value: unknown): string {
  const json = text(value);
  const parsed: unknown = JSON.parse(json);
  object(parsed);
  if (canonical(parsed) !== json) return fail();
  return json;
}
function intent(value: unknown): LocalNetworkIntent {
  const row = object(value);
  const operation = row['operation'];
  if (operation === 'OPEN') {
    object(row, [
      'operation',
      'commandId',
      'clientRequestJson',
      'attemptId',
      'canonicalOrigin',
      'campaignId',
      'semanticBodyJson',
    ]);
    return {
      operation,
      commandId: text(row['commandId']),
      clientRequestJson: semanticBody(row['clientRequestJson']),
      attemptId: text(row['attemptId']),
      canonicalOrigin: text(row['canonicalOrigin']),
      campaignId: uuid(row['campaignId']),
      semanticBodyJson: semanticBody(row['semanticBodyJson']),
    };
  }
  if (operation === 'SUBMIT') {
    object(row, [
      'operation',
      'commandId',
      'clientRequestJson',
      'requestId',
      'semanticBodyJson',
      'batch',
    ]);
    const prepared = batch(row['batch']);
    if (prepared.requestId !== row['requestId']) return fail();
    return {
      operation,
      commandId: text(row['commandId']),
      clientRequestJson: semanticBody(row['clientRequestJson']),
      requestId: prepared.requestId,
      semanticBodyJson: semanticBody(row['semanticBodyJson']),
      batch: prepared,
    };
  }
  if (operation !== 'CANCEL') return fail();
  object(row, [
    'operation',
    'commandId',
    'clientRequestJson',
    'requestId',
    'technicalSessionId',
    'requestRevision',
    'reason',
    'semanticBodyJson',
  ]);
  if (text(row['reason']).trim() === '') return fail();
  return {
    operation,
    commandId: text(row['commandId']),
    clientRequestJson: semanticBody(row['clientRequestJson']),
    requestId: uuid(row['requestId']),
    technicalSessionId: uuid(row['technicalSessionId']),
    requestRevision: integer(row['requestRevision']),
    reason: row['reason'] as string,
    semanticBodyJson: semanticBody(row['semanticBodyJson']),
  };
}
function acknowledgement(value: unknown): LocalNetworkAcknowledgement {
  const row = object(value);
  const operation = row['operation'];
  if (operation === 'OPEN_FAILURE') {
    object(row, [
      'operation',
      'commandId',
      'semanticBodySha256',
      'attemptId',
      'code',
      'proofKind',
      'verifiedReceipt',
    ]);
    if (row['proofKind'] !== 'NOT_SENT' && row['proofKind'] !== 'FENCED_ABSENT') return fail();
    const proof = object(row['verifiedReceipt']) as JsonObject;
    canonical(proof);
    return {
      operation,
      commandId: text(row['commandId']),
      semanticBodySha256: hash(row['semanticBodySha256']),
      attemptId: text(row['attemptId']),
      code: diagnosticCode(row['code']),
      proofKind: row['proofKind'],
      verifiedReceipt: proof,
    };
  }
  if (operation !== 'OPEN' && operation !== 'SUBMIT' && operation !== 'CANCEL') return fail();
  object(row, [
    'operation',
    'commandId',
    'semanticBodySha256',
    operation === 'OPEN' ? 'session' : 'request',
    'verifiedReceipt',
  ]);
  const common = {
    commandId: text(row['commandId']),
    semanticBodySha256: hash(row['semanticBodySha256']),
    verifiedReceipt: object(row['verifiedReceipt']) as JsonObject,
  };
  canonical(common.verifiedReceipt);
  return operation === 'OPEN'
    ? { ...common, operation, session: session(row['session']) }
    : { ...common, operation, request: request(row['request']) };
}
function mutation(value: unknown, tabId: string): LocalNetworkMutation {
  const row = object(value);
  switch (row['kind']) {
    case 'ADMISSION_ADVANCE':
      object(row, ['kind', 'requestId', 'ownerEventIdOrNull', 'ownerSha256']);
      return {
        kind: 'ADMISSION_ADVANCE',
        requestId: text(row['requestId']),
        ownerEventIdOrNull:
          row['ownerEventIdOrNull'] === null ? null : text(row['ownerEventIdOrNull']),
        ownerSha256: hash(row['ownerSha256']),
      };
    case 'ADMISSION_RETURN':
      object(row, ['kind', 'requestId', 'returnEventId', 'returnEventSha256', 'mode']);
      if (row['mode'] !== 'RESELECT' && row['mode'] !== 'MENU') return fail();
      return {
        kind: 'ADMISSION_RETURN',
        requestId: text(row['requestId']),
        returnEventId: text(row['returnEventId']),
        returnEventSha256: hash(row['returnEventSha256']),
        mode: row['mode'],
      };
    case 'LANE_BIND_INTENT':
      object(row, ['kind', 'outbox']);
      return { kind: 'LANE_BIND_INTENT', outbox: laneOutbox(row['outbox']) };
    case 'LANE_BIND_ACK':
      object(row, ['kind', 'commandId', 'receipt']);
      return {
        kind: 'LANE_BIND_ACK',
        commandId: text(row['commandId']),
        receipt: validatePeerLaneBindingReceipt(row['receipt']),
      };
    case 'REQUEST_ADVANCE':
      object(row, ['kind', 'proof']);
      return {
        kind: 'REQUEST_ADVANCE',
        proof: object(row['proof']) as unknown as VerifiedRequestReviewProof,
      };
    case 'CANCEL_SETTLE':
      object(row, ['kind', 'commandId', 'proof']);
      return {
        kind: 'CANCEL_SETTLE',
        commandId: text(row['commandId']),
        proof: object(row['proof']) as unknown as VerifiedRequestReviewProof,
      };
    case 'SHELL_EXIT': {
      object(row, ['kind', 'navigationRequestId', 'sourceUuid']);
      return {
        kind: 'SHELL_EXIT',
        navigationRequestId: text(row['navigationRequestId']),
        sourceUuid: text(row['sourceUuid']),
      };
    }
    case 'ADDRESS':
      object(row, ['kind', 'addressOrQrPayload']);
      if (typeof row['addressOrQrPayload'] !== 'string') return fail();
      return { kind: 'ADDRESS', addressOrQrPayload: row['addressOrQrPayload'] };
    case 'CANCEL_REASON':
      object(row, ['kind', 'cancelReason']);
      if (typeof row['cancelReason'] !== 'string') return fail();
      return { kind: 'CANCEL_REASON', cancelReason: row['cancelReason'] };
    case 'SELECTION':
      object(row, ['kind', 'selectedCandidates']);
      return { kind: 'SELECTION', selectedCandidates: refs(row['selectedCandidates'], tabId) };
    case 'SINGLE_CANDIDATE':
      object(row, ['kind', 'selectedCampaignId', 'requestedControllerSeat']);
      return {
        kind: 'SINGLE_CANDIDATE',
        selectedCampaignId:
          row['selectedCampaignId'] === null ? null : uuid(row['selectedCampaignId']),
        requestedControllerSeat:
          row['requestedControllerSeat'] === null ? null : uuid(row['requestedControllerSeat']),
      };
    case 'NAVIGATE':
      object(row, ['kind', 'targetFormId', 'plannedAttemptIdOrNull', 'singleCandidateOrNull']);
      if (!forms.some((form) => form === row['targetFormId'])) return fail();
      return {
        kind: 'NAVIGATE',
        targetFormId: row['targetFormId'] as NetworkApplicationFormId,
        plannedAttemptIdOrNull:
          row['plannedAttemptIdOrNull'] === null ? null : text(row['plannedAttemptIdOrNull']),
        singleCandidateOrNull:
          row['singleCandidateOrNull'] === null
            ? null
            : refs([row['singleCandidateOrNull']], tabId)[0]!,
      };
    case 'PREPARE_BATCH':
      object(row, ['kind', 'batch']);
      return { kind: 'PREPARE_BATCH', batch: batch(row['batch']) };
    case 'INTENT':
      object(row, ['kind', 'intent']);
      return { kind: 'INTENT', intent: intent(row['intent']) };
    case 'ACKNOWLEDGE':
      object(row, ['kind', 'acknowledgement']);
      return { kind: 'ACKNOWLEDGE', acknowledgement: acknowledgement(row['acknowledgement']) };
    case 'DIAGNOSTIC':
      object(
        row,
        Object.hasOwn(row, 'attemptIdOrNull')
          ? ['kind', 'code', 'attemptIdOrNull']
          : ['kind', 'code'],
      );
      return {
        kind: 'DIAGNOSTIC',
        code: diagnosticCode(row['code']),
        ...(Object.hasOwn(row, 'attemptIdOrNull')
          ? {
              attemptIdOrNull:
                row['attemptIdOrNull'] === null ? null : text(row['attemptIdOrNull']),
            }
          : {}),
      };
    default:
      return fail();
  }
}
function mutationInput(value: unknown, tabId: string): LocalNetworkMutationInput {
  const row = object(value, [
    'ownerDeviceId',
    'networkScopeId',
    'expectedRevisions',
    'expectedDraftRevision',
    'eventId',
    'receiptId',
    'clientRequestJsonOrNull',
    'mutation',
  ]);
  const eventId = text(row['eventId']),
    receiptId = text(row['receiptId']);
  if (eventId === receiptId) return fail();
  const change = mutation(row['mutation'], tabId);
  if (change.kind === 'LANE_BIND_INTENT' && change.outbox.request.commandId === receiptId)
    return fail();
  const client =
    row['clientRequestJsonOrNull'] === null ? null : semanticBody(row['clientRequestJsonOrNull']);
  if (
    ['ADDRESS', 'SELECTION', 'SINGLE_CANDIDATE', 'CANCEL_REASON', 'NAVIGATE', 'INTENT'].includes(
      change.kind,
    ) &&
    client === null &&
    !(
      change.kind === 'NAVIGATE' &&
      change.targetFormId === 'NET-011' &&
      change.plannedAttemptIdOrNull !== null &&
      change.singleCandidateOrNull === null
    )
  )
    return fail();
  if (change.kind === 'INTENT' && client !== change.intent.clientRequestJson) return fail();
  if (change.kind === 'SHELL_EXIT') {
    if (client === null || eventId !== `navigation:${change.navigationRequestId}`) return fail();
    const nav = object(JSON.parse(client) as unknown, [
      'messageType',
      'protocolVersion',
      'navigationRequestId',
      'sourceFormId',
      'actionKey',
      'expectedProjectionRevision',
    ]);
    if (
      nav['messageType'] !== 'navigation.form-action' ||
      nav['protocolVersion'] !== 2 ||
      nav['navigationRequestId'] !== change.navigationRequestId ||
      nav['sourceFormId'] !== 'CHR-027' ||
      nav['actionKey'] !== 'CHR-027::CTA::002' ||
      nav['expectedProjectionRevision'] !== vector(row['expectedRevisions']).projectionRevision
    )
      return fail();
  }
  return {
    ownerDeviceId: uuid(row['ownerDeviceId']),
    networkScopeId: uuid(row['networkScopeId']),
    expectedRevisions: vector(row['expectedRevisions']),
    expectedDraftRevision: integer(row['expectedDraftRevision']),
    eventId,
    receiptId,
    clientRequestJsonOrNull: client,
    mutation: change,
  };
}
function lifecycle(current: LocalNetworkApplication): LocalNetworkTab['lifecycleState'] {
  if (current.requestReviewOrNull !== undefined && current.requestReviewOrNull !== null)
    return ['PENDING', 'IN_REVIEW'].includes(current.requestReviewOrNull.requestStatus)
      ? 'PROVISIONAL'
      : 'UNBOUND';
  return current.requestOrNull !== null && current.requestOrNull.closureOrNull === null
    ? 'PROVISIONAL'
    : 'UNBOUND';
}
interface LocalReviewReplay {
  readonly lanes: Map<string, LocalRequestLaneBindingOutbox>;
  readonly currents: Map<
    string,
    { readonly current: VerifiedLocalRequestCurrent; readonly headEventId: string }
  >;
  readonly settlements: Map<string, LocalCancelSettlement>;
}
const emptyLocalReview = (): LocalReviewReplay => ({
  lanes: new Map(),
  currents: new Map(),
  settlements: new Map(),
});
function laneOrigin(value: unknown): LocalRequestLaneOriginWitness {
  const row = object(value, [
    'ownerDeviceId',
    'networkScopeId',
    'tabId',
    'entryCommandId',
    'entryReceiptId',
    'submitCommandId',
    'submitIntentEventId',
    'submitIntentEventReceiptId',
    'submitIntentEventSha256',
    'originalEntrySha256',
    'originEvidenceSha256',
  ]);
  const body = {
    ownerDeviceId: uuid(row['ownerDeviceId']),
    networkScopeId: uuid(row['networkScopeId']),
    tabId: uuid(row['tabId']),
    entryCommandId: text(row['entryCommandId']),
    entryReceiptId: text(row['entryReceiptId']),
    submitCommandId: text(row['submitCommandId']),
    submitIntentEventId: text(row['submitIntentEventId']),
    submitIntentEventReceiptId: text(row['submitIntentEventReceiptId']),
    submitIntentEventSha256: hash(row['submitIntentEventSha256']),
    originalEntrySha256: hash(row['originalEntrySha256']),
  };
  if (sha(canonical(body)) !== row['originEvidenceSha256']) return fail();
  return { ...body, originEvidenceSha256: hash(row['originEvidenceSha256']) };
}
function laneOutbox(value: unknown): LocalRequestLaneBindingOutbox {
  const row = object(value, [
    'ownerDeviceId',
    'networkScopeId',
    'requestId',
    'request',
    'semanticBodySha256',
    'origin',
    'receiptOrNull',
  ]);
  const request = validateDeviceRequestBindLane(row['request']),
    origin = laneOrigin(row['origin']);
  const result = {
    ownerDeviceId: uuid(row['ownerDeviceId']),
    networkScopeId: uuid(row['networkScopeId']),
    requestId: uuid(row['requestId']),
    request,
    semanticBodySha256: hash(row['semanticBodySha256']),
    origin,
    receiptOrNull:
      row['receiptOrNull'] === null ? null : validatePeerLaneBindingReceipt(row['receiptOrNull']),
  };
  if (
    result.requestId !== request.requestId ||
    result.ownerDeviceId !== origin.ownerDeviceId ||
    result.networkScopeId !== origin.networkScopeId ||
    request.submitCommandId !== origin.submitCommandId ||
    request.localControllerSeatId !== origin.tabId ||
    sha(canonical(request)) !== result.semanticBodySha256
  )
    return fail();
  return result;
}
type SubmitOutbox = LocalNetworkOutbox & {
  readonly intent: Extract<LocalNetworkIntent, { operation: 'SUBMIT' }>;
};
function localSubmit(
  outboxes: ReadonlyMap<string, LocalNetworkOutbox>,
  requestId: string,
): SubmitOutbox {
  const matches = [...outboxes.values()].filter(
    (o): o is SubmitOutbox => o.intent.operation === 'SUBMIT' && o.intent.requestId === requestId,
  );
  if (matches.length !== 1) return fail('NOT_FOUND');
  return matches[0]!;
}
/** This is a projection of the immutable acknowledged header, never a new receipt identity. */
function acknowledgedReceipt(outbox: LocalNetworkOutbox): LegacyRequestReceipt {
  const a = outbox.acknowledgementOrNull;
  if (
    a === null ||
    (a.operation !== 'SUBMIT' && a.operation !== 'CANCEL') ||
    a.operation !== outbox.intent.operation
  )
    return fail('UNAVAILABLE');
  return validateLegacyRequestReceipt({
    operation: a.operation,
    commandId: a.commandId,
    receiptId:
      a.operation === 'SUBMIT' ? a.request.submitReceiptId : a.request.closureOrNull?.receiptId,
    semanticBodySha256: a.semanticBodySha256,
    request: a.request,
  });
}
function localProof(
  current: LocalNetworkApplication,
  outboxes: ReadonlyMap<string, LocalNetworkOutbox>,
  proof: VerifiedRequestReviewProof,
): VerifiedLocalRequestCurrent {
  const submitted = validateLegacyRequestReceipt(object(proof)['submittedReceipt']);
  const outbox = localSubmit(outboxes, submitted.request.requestId),
    known = acknowledgedReceipt(outbox);
  if (
    known.operation !== 'SUBMIT' ||
    outbox.ownerDeviceId !== current.ownerDeviceId ||
    outbox.networkScopeId !== current.networkScopeId
  )
    return fail();
  const result = validateRequestReviewProof(proof, {
    submittedReceipt: { ...known, operation: 'SUBMIT' },
    batch: outbox.intent.batch,
    requestOwnerDeviceId: current.ownerDeviceId,
    campaignId: outbox.intent.batch.campaignProof.campaignId,
  });
  const cancelled = result.proof.cancelledReceiptOrNull;
  if (cancelled !== null) {
    const intent = outboxes.get(cancelled.commandId);
    if (
      intent?.intent.operation !== 'CANCEL' ||
      intent.intent.requestId !== submitted.request.requestId ||
      intent.intent.technicalSessionId !== submitted.request.technicalSessionId ||
      intent.intent.requestRevision !== 0 ||
      intent.intent.reason !== cancelled.request.closureOrNull?.reason ||
      intent.semanticBodySha256 !== cancelled.semanticBodySha256 ||
      (intent.acknowledgementOrNull !== null && !same(acknowledgedReceipt(intent), cancelled))
    )
      return fail();
  }
  return result;
}
function localReviewCurrent(
  current: LocalNetworkApplication,
  outboxes: ReadonlyMap<string, LocalNetworkOutbox>,
  review: LocalReviewReplay,
  requestId: string,
): VerifiedLocalRequestCurrent {
  const known = review.currents.get(requestId);
  if (known !== undefined) return known.current;
  const submit = localSubmit(outboxes, requestId),
    submitted = acknowledgedReceipt(submit);
  if (submitted.operation !== 'SUBMIT') return fail();
  const cancelled = [...outboxes.values()].filter(
    (o) =>
      o.intent.operation === 'CANCEL' &&
      o.intent.requestId === requestId &&
      o.acknowledgementOrNull !== null,
  );
  if (cancelled.length > 1) return fail();
  const receipt = cancelled[0] === undefined ? null : acknowledgedReceipt(cancelled[0]);
  if (receipt !== null && receipt.operation !== 'CANCEL') return fail();
  return localProof(current, outboxes, {
    submittedReceipt: { ...submitted, operation: 'SUBMIT' },
    cancelledReceiptOrNull: receipt === null ? null : { ...receipt, operation: 'CANCEL' },
    decisions: [],
    laneProvenance:
      submit.intent.batch.schemaVersion === 2
        ? {
            kind: 'SUBMITTED_BATCH',
            batchSha256: submit.intent.batch.batchSha256,
            localControllerSeatId: submit.intent.batch.localControllerSeatId,
          }
        : null,
  });
}
function originalLaneOrigin(
  db: Database.Database,
  tab: LocalNetworkTab,
  events: readonly EventRecord[],
  requestId: string,
): LocalRequestLaneOriginWitness {
  const matches = events.filter(
    (e) =>
      e.input.mutation.kind === 'INTENT' &&
      e.input.mutation.intent.operation === 'SUBMIT' &&
      e.input.mutation.intent.requestId === requestId,
  );
  if (matches.length !== 1) return fail('NOT_FOUND');
  const event = matches[0]!,
    change = event.input.mutation;
  if (change.kind !== 'INTENT' || change.intent.operation !== 'SUBMIT') return fail();
  // The caller has already replayed this owned tab's entire prefix; no active-tab pointer is read.
  const entry = at(db, 'local_network_tab_entry', 'entry_command_id', tab.entryCommandId) ?? fail();
  const requestJson = text(entry['request_json']),
    receiptJson = text(entry['receipt_json']);
  const request = object(JSON.parse(requestJson) as unknown),
    receipt = object(JSON.parse(receiptJson) as unknown);
  const originalEntrySha256 = sha(canonical({ request, receipt }));
  if (
    entry['owner_device_id'] !== tab.ownerDeviceId ||
    entry['network_scope_id'] !== tab.networkScopeId ||
    entry['tab_id'] !== tab.tabId ||
    entry['entry_receipt_id'] !== tab.entryReceiptId ||
    entry['journal_sha256'] !== originalEntrySha256 ||
    canonical(request) !== requestJson ||
    canonical(receipt) !== receiptJson ||
    request['tabId'] !== tab.tabId ||
    request['networkScopeId'] !== tab.networkScopeId ||
    event.input.ownerDeviceId !== tab.ownerDeviceId ||
    event.input.networkScopeId !== tab.networkScopeId
  )
    return fail();
  const body = {
    ownerDeviceId: tab.ownerDeviceId,
    networkScopeId: tab.networkScopeId,
    tabId: tab.tabId,
    entryCommandId: tab.entryCommandId,
    entryReceiptId: tab.entryReceiptId,
    submitCommandId: change.intent.commandId,
    submitIntentEventId: event.input.eventId,
    submitIntentEventReceiptId: event.input.receiptId,
    submitIntentEventSha256: sha(canonical(event)),
    originalEntrySha256,
  };
  return { ...body, originEvidenceSha256: sha(canonical(body)) };
}
function reduce(
  current: LocalNetworkApplication,
  change: LocalNetworkMutation,
  outboxes: Map<string, LocalNetworkOutbox>,
  review: LocalReviewReplay = emptyLocalReview(),
  origin: LocalRequestLaneOriginWitness | null = null,
  eventId = '',
): LocalNetworkApplication {
  const next = { ...current };
  if (current.shellExitOrNull !== null && change.kind !== 'NAVIGATE') return fail('UNAVAILABLE');
  let admissionAdvance = false,
    data = false,
    draft = false;
  const idle = () => {
    if (current.pendingCommandIdOrNull !== null || lifecycle(current) === 'PROVISIONAL')
      return fail('UNAVAILABLE');
  };
  switch (change.kind) {
    case 'ADMISSION_ADVANCE':
      // The immutable owner event is a local state change even when legacy fields stay equal.
      admissionAdvance = true;
      data = true;
      break;
    case 'ADMISSION_RETURN':
      if (
        current.pendingCommandIdOrNull !== null ||
        current.sessionOrNull === null ||
        current.requestOrNull?.requestId !== change.requestId ||
        current.requestReviewOrNull?.requestStatus !== 'IN_REVIEW'
      )
        return fail('UNAVAILABLE');
      next.requestOrNull = null;
      next.requestReviewOrNull = null;
      next.selectedCandidates = [];
      next.preparedBatchOrNull = null;
      next.cancelReason = '';
      next.diagnosticCodeOrNull = null;
      next.formId = 'NET-003';
      data = true;
      draft = true;
      break;
    case 'LANE_BIND_INTENT': {
      const o = change.outbox;
      if (
        origin === null ||
        !same(o.origin, origin) ||
        o.ownerDeviceId !== current.ownerDeviceId ||
        o.networkScopeId !== current.networkScopeId ||
        o.request.localControllerSeatId !== origin.tabId ||
        o.receiptOrNull !== null ||
        review.lanes.has(o.requestId)
      )
        return fail('INVALID_INPUT');
      const submit = localSubmit(outboxes, o.requestId);
      if (
        submit.intent.batch.schemaVersion === 2 ||
        submit.acknowledgementOrNull === null ||
        localReviewCurrent(current, outboxes, review, o.requestId).proof.laneProvenance !== null ||
        o.request.submitCommandId !== submit.intent.commandId ||
        o.request.technicalSessionId !== submit.intent.batch.technicalSessionId ||
        o.request.batchSha256 !== submit.intent.batch.batchSha256
      )
        return fail('INVALID_INPUT');
      review.lanes.set(o.requestId, o);
      break;
    }
    case 'LANE_BIND_ACK': {
      const receipt = change.receipt,
        o = review.lanes.get(receipt.binding.requestId) ?? fail('NOT_FOUND');
      if (
        origin === null ||
        !same(o.origin, origin) ||
        o.request.commandId !== change.commandId ||
        receipt.commandId !== change.commandId ||
        receipt.semanticBodySha256 !== o.semanticBodySha256 ||
        receipt.binding.localControllerSeatId !== origin.tabId
      )
        return fail('IDEMPOTENCY_CONFLICT');
      if (o.receiptOrNull !== null) {
        if (!same(o.receiptOrNull, receipt)) return fail('IDEMPOTENCY_CONFLICT');
        break;
      }
      const before = localReviewCurrent(current, outboxes, review, o.requestId);
      if (before.proof.laneProvenance !== null) return fail('IDEMPOTENCY_CONFLICT');
      const result = localProof(current, outboxes, {
        ...before.proof,
        laneProvenance: { kind: 'BIND_LANE', receipt },
      });
      review.lanes.set(o.requestId, { ...o, receiptOrNull: receipt });
      review.currents.set(o.requestId, { current: result, headEventId: eventId });
      next.schemaVersion = 2;
      next.requestReviewOrNull =
        current.requestOrNull?.requestId === o.requestId
          ? result
          : (current.requestReviewOrNull ?? null);
      data = true;
      break;
    }
    case 'REQUEST_ADVANCE':
    case 'CANCEL_SETTLE': {
      const result = localProof(current, outboxes, change.proof),
        id = result.proof.submittedReceipt.request.requestId;
      const before = localReviewCurrent(current, outboxes, review, id);
      if (
        !same(before.proof.laneProvenance, result.proof.laneProvenance) ||
        result.requestRevision < before.requestRevision ||
        (result.requestRevision === before.requestRevision && !same(before, result)) ||
        !same(
          result.proof.decisions.slice(0, before.proof.decisions.length),
          before.proof.decisions,
        ) ||
        (before.proof.cancelledReceiptOrNull !== null &&
          !same(before.proof.cancelledReceiptOrNull, result.proof.cancelledReceiptOrNull))
      )
        return fail('STALE_REVISION');
      if (change.kind === 'CANCEL_SETTLE') {
        const pending = outboxes.get(change.commandId) ?? fail('NOT_FOUND');
        if (
          pending.intent.operation !== 'CANCEL' ||
          pending.intent.requestId !== id ||
          pending.acknowledgementOrNull !== null ||
          current.pendingCommandIdOrNull !== change.commandId ||
          !['IN_REVIEW', 'REJECTED'].includes(result.requestStatus) ||
          pending.intent.requestRevision >= result.requestRevision
        )
          return fail('INVALID_INPUT');
        const settled = { commandId: change.commandId, requestId: id, proof: result.proof };
        const old = review.settlements.get(change.commandId);
        if (old !== undefined && !same(old, settled)) return fail('IDEMPOTENCY_CONFLICT');
        review.settlements.set(change.commandId, settled);
        next.pendingCommandIdOrNull = null;
      }
      if (same(before, result) && change.kind === 'REQUEST_ADVANCE') break;
      review.currents.set(id, { current: result, headEventId: eventId });
      next.schemaVersion = 2;
      next.requestReviewOrNull =
        current.requestOrNull?.requestId === id ? result : (current.requestReviewOrNull ?? null);
      data = true;
      break;
    }
    case 'SHELL_EXIT':
      idle();
      if (
        current.formId !== 'CHR-027' ||
        current.sessionOrNull === null ||
        current.selectedCandidates.length !== 1 ||
        current.selectedCandidates[0]!.sourceUuid !== change.sourceUuid
      )
        return fail('UNAVAILABLE');
      next.shellExitOrNull = {
        navigationRequestId: change.navigationRequestId,
        sourceUuid: change.sourceUuid,
      };
      break;
    case 'ADDRESS':
      idle();
      if (current.formId !== 'NET-002') return fail('UNAVAILABLE');
      next.addressOrQrPayload = change.addressOrQrPayload;
      data = true;
      draft = true;
      break;
    case 'CANCEL_REASON':
      if (
        current.formId !== 'NET-005' ||
        current.pendingCommandIdOrNull !== null ||
        current.requestOrNull === null ||
        current.requestOrNull.closureOrNull !== null ||
        (current.requestReviewOrNull != null &&
          current.requestReviewOrNull.requestStatus !== 'PENDING')
      )
        return fail('UNAVAILABLE');
      next.cancelReason = change.cancelReason;
      data = true;
      draft = true;
      break;
    case 'SELECTION':
      idle();
      if (current.formId !== 'NET-003') return fail('UNAVAILABLE');
      next.selectedCandidates = change.selectedCandidates;
      next.preparedBatchOrNull = null;
      data = true;
      draft = true;
      break;
    case 'SINGLE_CANDIDATE':
      idle();
      if (
        current.formId !== 'CHR-027' ||
        (change.requestedControllerSeat !== null &&
          change.requestedControllerSeat !== current.tabId)
      )
        return fail('UNAVAILABLE');
      next.selectedCampaignIdOrNull = change.selectedCampaignId;
      next.requestedControllerSeatOrNull = change.requestedControllerSeat;
      next.preparedBatchOrNull = null;
      data = true;
      draft = true;
      break;
    case 'NAVIGATE': {
      next.shellExitOrNull = null;
      if (change.targetFormId === 'NET-005') {
        if (current.requestOrNull === null || current.requestOrNull.closureOrNull !== null)
          return fail('UNAVAILABLE');
      } else idle();
      if (change.targetFormId === 'NET-003' && current.sessionOrNull === null)
        return fail('UNAVAILABLE');
      if (change.targetFormId === 'NET-004' && current.preparedBatchOrNull === null)
        return fail('UNAVAILABLE');
      if (change.plannedAttemptIdOrNull !== null) {
        idle();
        if (current.sessionOrNull !== null) return fail('UNAVAILABLE');
        if (!['NET-002', 'NET-011'].includes(change.targetFormId)) return fail();
        if (
          change.plannedAttemptIdOrNull === current.lastAttemptIdOrNull ||
          [...outboxes.values()].some(
            (o) =>
              o.intent.operation === 'OPEN' && o.intent.attemptId === change.plannedAttemptIdOrNull,
          )
        )
          return fail('UNAVAILABLE');
        next.plannedAttemptIdOrNull = change.plannedAttemptIdOrNull;
      }
      if (change.targetFormId === 'NET-002' && next.plannedAttemptIdOrNull === null) return fail();
      if (change.singleCandidateOrNull !== null) {
        if (change.targetFormId !== 'CHR-027') return fail();
        data =
          !same(current.selectedCandidates, [change.singleCandidateOrNull]) ||
          current.preparedBatchOrNull !== null;
        next.selectedCandidates = [change.singleCandidateOrNull];
        next.preparedBatchOrNull = null;
      }
      if (change.targetFormId === 'CHR-027' && next.selectedCandidates.length !== 1) return fail();
      next.formId = change.targetFormId;
      break;
    }
    case 'PREPARE_BATCH': {
      idle();
      if (!['NET-003', 'CHR-027'].includes(current.formId)) return fail('UNAVAILABLE');
      const s = current.sessionOrNull,
        b = change.batch;
      if (
        s === null ||
        (b.schemaVersion === 2 && b.localControllerSeatId !== current.tabId) ||
        s.technicalSessionId !== b.technicalSessionId ||
        s.connectionRevision !== b.connectionRevision ||
        s.campaignProof.campaignId !== b.campaignProof.campaignId
      )
        return fail('UNAVAILABLE');
      if (
        current.formId === 'CHR-027' &&
        (current.selectedCampaignIdOrNull !== b.campaignProof.campaignId ||
          current.requestedControllerSeatOrNull !== current.tabId)
      )
        return fail('UNAVAILABLE');
      const expected = b.candidates.map((c) => ({
        sourceUuid: c.descriptor.sourceUuid,
        finalSnapshotVersion: c.descriptor.finalSnapshotVersion,
        metadataRevision: c.descriptor.metadataRevision,
        candidateSnapshotChecksum: c.descriptor.sourceChecksum,
        requestedControllerSeat: current.tabId,
      }));
      if (!same(expected, current.selectedCandidates)) return fail('STALE_REVISION');
      if (
        [...outboxes.values()].some(
          (o) => o.intent.operation === 'SUBMIT' && o.intent.requestId === b.requestId,
        )
      )
        return fail('IDEMPOTENCY_CONFLICT');
      next.preparedBatchOrNull = b;
      next.formId = 'NET-004';
      data = true;
      break;
    }
    case 'INTENT': {
      const i = change.intent;
      if (current.pendingCommandIdOrNull !== null || outboxes.has(i.commandId))
        return fail('UNAVAILABLE');
      if (i.operation === 'OPEN') {
        idle();
        if (
          current.sessionOrNull !== null ||
          !['NET-002', 'NET-011'].includes(current.formId) ||
          i.attemptId !== current.plannedAttemptIdOrNull ||
          i.attemptId === current.lastAttemptIdOrNull ||
          [...outboxes.values()].some(
            (o) => o.intent.operation === 'OPEN' && o.intent.attemptId === i.attemptId,
          )
        )
          return fail('UNAVAILABLE');
        next.lastAttemptIdOrNull = i.attemptId;
      } else if (i.operation === 'SUBMIT') {
        idle();
        if (current.formId !== 'NET-004' || !same(i.batch, current.preparedBatchOrNull))
          return fail('UNAVAILABLE');
      } else {
        const r = current.requestOrNull;
        if (
          current.formId !== 'NET-005' ||
          r === null ||
          r.closureOrNull !== null ||
          (current.requestReviewOrNull != null &&
            current.requestReviewOrNull.requestStatus !== 'PENDING') ||
          r.requestId !== i.requestId ||
          r.technicalSessionId !== i.technicalSessionId ||
          r.requestRevision !== i.requestRevision ||
          i.reason !== current.cancelReason
        )
          return fail('STALE_REVISION');
      }
      outboxes.set(i.commandId, {
        ownerDeviceId: current.ownerDeviceId,
        networkScopeId: current.networkScopeId,
        intent: i,
        sourceRevisions: vectorOf(current),
        semanticBodySha256: sha(i.semanticBodyJson),
        acknowledgementOrNull: null,
      });
      next.pendingCommandIdOrNull = i.commandId;
      next.diagnosticCodeOrNull = null;
      data = true;
      break;
    }
    case 'ACKNOWLEDGE': {
      const a = change.acknowledgement,
        o = outboxes.get(a.commandId);
      if (
        o === undefined ||
        a.semanticBodySha256 !== o.semanticBodySha256 ||
        (a.operation === 'OPEN_FAILURE' ? 'OPEN' : a.operation) !== o.intent.operation
      )
        return fail('IDEMPOTENCY_CONFLICT');
      if (o.acknowledgementOrNull !== null) {
        if (!same(a, o.acknowledgementOrNull)) return fail('IDEMPOTENCY_CONFLICT');
        return current;
      }
      if (current.pendingCommandIdOrNull !== a.commandId) return fail('STALE_REVISION');
      if (a.operation === 'OPEN_FAILURE' && o.intent.operation === 'OPEN') {
        if (a.attemptId !== o.intent.attemptId) return fail();
        next.lastAttemptIdOrNull = a.attemptId;
        next.formId = 'NET-011';
        next.diagnosticCodeOrNull = a.code;
      } else if (a.operation === 'OPEN' && o.intent.operation === 'OPEN') {
        if (
          a.session.attemptId !== o.intent.attemptId ||
          a.session.campaignProof.campaignId !== o.intent.campaignId
        )
          return fail();
        next.sessionOrNull = a.session;
        next.formId = 'NET-003';
      } else if (a.operation === 'SUBMIT' && o.intent.operation === 'SUBMIT') {
        if (
          a.request.requestId !== o.intent.requestId ||
          a.request.technicalSessionId !== o.intent.batch.technicalSessionId ||
          a.request.batchSha256 !== o.intent.batch.batchSha256 ||
          a.request.submitCommandId !== a.commandId ||
          a.request.requestRevision !== 0 ||
          a.request.closureOrNull !== null
        )
          return fail();
        next.requestOrNull = a.request;
        if (next.schemaVersion === 2) next.requestReviewOrNull = null;
        next.formId = 'NET-005';
      } else if (a.operation === 'CANCEL' && o.intent.operation === 'CANCEL') {
        const old = current.requestOrNull;
        if (
          old === null ||
          a.request.requestId !== o.intent.requestId ||
          a.request.technicalSessionId !== o.intent.technicalSessionId ||
          a.request.requestRevision !== increment(o.intent.requestRevision) ||
          a.request.submitCommandId !== old.submitCommandId ||
          a.request.submitReceiptId !== old.submitReceiptId ||
          a.request.batchSha256 !== old.batchSha256 ||
          a.request.closureOrNull?.commandId !== a.commandId ||
          a.request.closureOrNull.reason !== o.intent.reason
        )
          return fail();
        next.requestOrNull = a.request;
        next.formId = 'NET-003';
        next.preparedBatchOrNull = null;
        next.cancelReason = '';
      } else return fail();
      outboxes.set(a.commandId, { ...o, acknowledgementOrNull: a });
      if (a.operation === 'CANCEL') {
        const known = review.currents.get(a.request.requestId);
        if (known !== undefined) {
          const cancelled = acknowledgedReceipt(outboxes.get(a.commandId)!);
          if (
            cancelled.operation !== 'CANCEL' ||
            !['PENDING', 'CANCELLED'].includes(known.current.requestStatus) ||
            (known.current.proof.cancelledReceiptOrNull !== null &&
              !same(known.current.proof.cancelledReceiptOrNull, cancelled))
          )
            return fail();
          const result = localProof(current, outboxes, {
            ...known.current.proof,
            cancelledReceiptOrNull: { ...cancelled, operation: 'CANCEL' },
          });
          review.currents.set(a.request.requestId, { current: result, headEventId: eventId });
          next.schemaVersion = 2;
          next.requestReviewOrNull = result;
        }
      }
      next.pendingCommandIdOrNull = null;
      if (a.operation !== 'OPEN_FAILURE') next.diagnosticCodeOrNull = null;
      data = true;
      break;
    }
    case 'DIAGNOSTIC':
      if (change.attemptIdOrNull != null) {
        idle();
        if (
          !['NET-002', 'NET-011'].includes(current.formId) ||
          change.attemptIdOrNull !== current.plannedAttemptIdOrNull
        )
          return fail('UNAVAILABLE');
        next.lastAttemptIdOrNull = change.attemptIdOrNull;
      }
      next.diagnosticCodeOrNull = change.code;
      if (current.requestOrNull === null || current.requestOrNull.closureOrNull !== null) {
        next.formId = 'NET-011';
        const pending =
          current.pendingCommandIdOrNull === null
            ? null
            : outboxes.get(current.pendingCommandIdOrNull);
        if (pending?.intent.operation === 'OPEN')
          next.lastAttemptIdOrNull = pending.intent.attemptId;
        else if (
          change.attemptIdOrNull == null &&
          (current.lastAttemptIdOrNull === null || current.formId === 'NET-002')
        )
          next.lastAttemptIdOrNull = current.plannedAttemptIdOrNull;
      }
      break;
  }
  if (same(current, next) && !admissionAdvance) return current;
  next.projectionRevision = increment(current.projectionRevision);
  if (data) next.stateRevision = increment(current.stateRevision);
  if (draft) next.draftRevision = increment(current.draftRevision);
  return state(next);
}
interface EventRecord {
  readonly input: LocalNetworkMutationInput;
  readonly receipt: LocalNetworkEventReceipt;
  readonly previousSha256: string;
  readonly nextSha256: string;
}
function receiptFor(
  before: LocalNetworkApplication,
  after: LocalNetworkApplication,
  i: LocalNetworkMutationInput,
): LocalNetworkEventReceipt {
  return {
    eventId: i.eventId,
    receiptId: i.receiptId,
    networkScopeId: i.networkScopeId,
    changed: !same(before, after),
    revisions: vectorOf(after),
    draftRevision: after.draftRevision,
    formId: after.formId,
  };
}
function readHistory(
  db: Database.Database,
  tab: LocalNetworkTab,
): {
  current: LocalNetworkApplication;
  events: EventRecord[];
  outboxes: Map<string, LocalNetworkOutbox>;
  attemptCount: number;
  review: LocalReviewReplay;
} {
  let current = initial(tab);
  const outboxes = new Map<string, LocalNetworkOutbox>();
  const events: EventRecord[] = [];
  const attempts = new Set<string>();
  const review = emptyLocalReview();
  const verifyAdmission = createLocalAdmissionNetworkVerifier(db);
  const rows = db
    .prepare(
      'SELECT * FROM local_network_application_event WHERE network_scope_id=? ORDER BY event_index',
    )
    .all(tab.networkScopeId) as Row[];
  for (const [index, row] of rows.entries()) {
    const value = object(checked(row), ['input', 'receipt', 'previousSha256', 'nextSha256']);
    const i = mutationInput(value['input'], tab.tabId);
    if (
      i.ownerDeviceId !== tab.ownerDeviceId ||
      i.networkScopeId !== tab.networkScopeId ||
      row['owner_device_id'] !== tab.ownerDeviceId ||
      row['event_id'] !== i.eventId ||
      row['receipt_id'] !== i.receiptId ||
      row['event_index'] !== index ||
      value['previousSha256'] !== sha(canonical(current)) ||
      !same(i.expectedRevisions, vectorOf(current)) ||
      i.expectedDraftRevision !== current.draftRevision
    )
      return fail();
    assertReviewPin(db, current, outboxes, i.mutation);
    if (i.mutation.kind === 'ADMISSION_RETURN' || i.mutation.kind === 'ADMISSION_ADVANCE')
      verifyAdmission(current, i);
    const origin = mutationOrigin(db, tab, events, i.mutation);
    const next = reduce(current, i.mutation, outboxes, review, origin, i.eventId),
      receipt = receiptFor(current, next, i);
    const nextSha256 = sha(canonical(next));
    if (next.lastAttemptIdOrNull !== null) attempts.add(next.lastAttemptIdOrNull);
    if (value['nextSha256'] !== nextSha256 || !same(value['receipt'], receipt)) return fail();
    events.push({ input: i, receipt, previousSha256: value['previousSha256'], nextSha256 });
    current = next;
  }
  const head = at(db, 'local_network_application', 'network_scope_id', tab.networkScopeId);
  if (events.length === 0) {
    if (head !== undefined || !same(vectorOf(tab), zero()) || tab.lifecycleState !== 'UNBOUND')
      return fail();
  } else if (
    head === undefined ||
    head['owner_device_id'] !== tab.ownerDeviceId ||
    head['head_event_id'] !== events.at(-1)!.input.eventId ||
    !checkedEqual(head, current)
  )
    return fail();
  if (!same(vectorOf(tab), vectorOf(current)) || tab.lifecycleState !== lifecycle(current))
    return fail();
  const stored = db
    .prepare('SELECT * FROM local_network_outbox WHERE network_scope_id=?')
    .all(tab.networkScopeId) as Row[];
  if (stored.length !== outboxes.size) return fail();
  for (const o of outboxes.values()) {
    const row = at(db, 'local_network_outbox', 'command_id', o.intent.commandId);
    if (
      row === undefined ||
      row['owner_device_id'] !== tab.ownerDeviceId ||
      row['network_scope_id'] !== tab.networkScopeId ||
      row['operation'] !== o.intent.operation ||
      row['object_id'] !==
        (o.intent.operation === 'OPEN' ? o.intent.attemptId : o.intent.requestId) ||
      row['acknowledged'] !== (o.acknowledgementOrNull === null ? 0 : 1) ||
      !checkedEqual(row, o)
    )
      return fail();
  }
  const version = (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)[
    'version'
  ];
  if (version === 11 || version === 12) {
    for (const [table, records, key] of [
      ['local_network_lane_binding', review.lanes, 'request_id'],
      ['local_network_request_current', review.currents, 'request_id'],
      ['local_network_cancel_settlement', review.settlements, 'command_id'],
    ] as const) {
      const stored = db
        .prepare(`SELECT * FROM ${table} WHERE network_scope_id=?`)
        .all(tab.networkScopeId) as Row[];
      if (stored.length !== records.size) return fail();
      for (const [id, value] of records) {
        const row = stored.find((r) => r[key] === id);
        if (
          row === undefined ||
          row['owner_device_id'] !== tab.ownerDeviceId ||
          !checkedEqual(row, value)
        )
          return fail();
        if (table === 'local_network_lane_binding') {
          const lane = review.lanes.get(id)!;
          if (
            row['command_id'] !== lane.request.commandId ||
            row['acknowledged'] !== (lane.receiptOrNull === null ? 0 : 1)
          )
            return fail();
        } else if (table === 'local_network_request_current') {
          if (row['head_event_id'] !== review.currents.get(id)!.headEventId) return fail();
        } else if (row['request_id'] !== review.settlements.get(id)!.requestId) return fail();
      }
    }
  } else if (review.lanes.size + review.currents.size + review.settlements.size !== 0)
    return fail();
  return { current, events, outboxes, attemptCount: attempts.size, review };
}
function mutationOrigin(
  db: Database.Database,
  tab: LocalNetworkTab,
  events: readonly EventRecord[],
  change: LocalNetworkMutation,
): LocalRequestLaneOriginWitness | null {
  if (change.kind === 'LANE_BIND_INTENT')
    return originalLaneOrigin(db, tab, events, change.outbox.requestId);
  if (change.kind === 'LANE_BIND_ACK')
    return originalLaneOrigin(db, tab, events, change.receipt.binding.requestId);
  return null;
}
function assertReviewPin(
  db: Database.Database,
  current: LocalNetworkApplication,
  outboxes: ReadonlyMap<string, LocalNetworkOutbox>,
  change: LocalNetworkMutation,
): void {
  const requestId =
    change.kind === 'LANE_BIND_INTENT'
      ? change.outbox.requestId
      : change.kind === 'LANE_BIND_ACK'
        ? change.receipt.binding.requestId
        : change.kind === 'REQUEST_ADVANCE' || change.kind === 'CANCEL_SETTLE'
          ? validateLegacyRequestReceipt(object(change.proof)['submittedReceipt']).request.requestId
          : null;
  if (requestId === null) return;
  const submit = localSubmit(outboxes, requestId),
    campaignId = submit.intent.batch.campaignProof.campaignId;
  const row = db
    .prepare('SELECT * FROM local_network_host_pin WHERE owner_device_id=? AND campaign_id=?')
    .get(current.ownerDeviceId, campaignId) as Row | undefined;
  if (row === undefined) return fail('UNAVAILABLE');
  const value = object(checked(row), [
      'ownerDeviceId',
      'campaignId',
      'identity',
      'initialCanonicalOrigin',
      'entryCommandId',
    ]),
    pin = identity(value['identity']);
  if (
    value['ownerDeviceId'] !== current.ownerDeviceId ||
    value['campaignId'] !== campaignId ||
    row['host_device_id'] !== pin.ownerDeviceId ||
    row['key_fingerprint'] !== pin.keyFingerprintSha256
  )
    return fail();
  text(value['initialCanonicalOrigin']);
  const entry =
    at(db, 'local_network_tab_entry', 'entry_command_id', text(value['entryCommandId'])) ?? fail();
  const requestJson = text(entry['request_json']),
    receiptJson = text(entry['receipt_json']),
    request = object(JSON.parse(requestJson) as unknown),
    receipt = object(JSON.parse(receiptJson) as unknown);
  if (
    entry['owner_device_id'] !== current.ownerDeviceId ||
    request['ownerDeviceId'] !== current.ownerDeviceId ||
    canonical(request) !== requestJson ||
    canonical(receipt) !== receiptJson ||
    sha(canonical({ request, receipt })) !== entry['journal_sha256']
  )
    return fail();
}
/** Counts actual recorded attempts, including a definite failure before OPEN outbox creation. */
export function readLocalNetworkAttemptCount(
  db: Database.Database,
  scope: LocalNetworkScope,
): number {
  return read(db, scope.ownerDeviceId, () => {
    const tab = readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId);
    if (tab === null) return fail('UNAVAILABLE');
    return readHistory(db, tab).attemptCount;
  });
}
export function validateNetworkPreparedBatch(value: unknown): NetworkPreparedBatch {
  return input(() => batch(value));
}
export function readLocalNetworkOpenOutboxByAttempt(
  db: Database.Database,
  scope: LocalNetworkScope,
  attemptId: string,
): LocalNetworkOutbox | null {
  return read(db, scope.ownerDeviceId, () => {
    const tab = readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId);
    if (tab === null) return fail('UNAVAILABLE');
    const history = readHistory(db, tab),
      matches = [...history.outboxes.values()].filter(
        (o) => o.intent.operation === 'OPEN' && o.intent.attemptId === text(attemptId),
      );
    if (matches.length > 1) return fail();
    const out = matches[0] ?? null;
    if (
      out !== null &&
      history.current.sessionOrNull?.attemptId === attemptId &&
      (out.acknowledgementOrNull?.operation !== 'OPEN' ||
        !same(out.acknowledgementOrNull.session, history.current.sessionOrNull))
    )
      return fail();
    return out;
  });
}
/** Called by the tab reader without recursively acquiring that reader again. */
export function validateNetworkTabApplicationState(
  db: Database.Database,
  tab: LocalNetworkTab,
): LocalNetworkApplication {
  return read(db, tab.ownerDeviceId, () => readHistory(db, tab).current);
}
export function assertNetworkTabApplicationCanClose(
  db: Database.Database,
  tab: LocalNetworkTab,
): void {
  const current = validateNetworkTabApplicationState(db, tab);
  if (current.pendingCommandIdOrNull !== null || lifecycle(current) !== 'UNBOUND')
    return fail('UNAVAILABLE');
}
export function readLocalNetworkApplication(
  db: Database.Database,
  scope: LocalNetworkScope,
): LocalNetworkApplication {
  return read(db, scope.ownerDeviceId, () => {
    const tab = readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId);
    if (tab === null) return fail('UNAVAILABLE');
    return readHistory(db, tab).current;
  });
}
export function readLocalNetworkApplicationEvent(
  db: Database.Database,
  scope: LocalNetworkScope,
  eventId: string,
): StoredLocalNetworkEvent | null {
  return read(db, scope.ownerDeviceId, () => {
    const row = at(db, 'local_network_application_event', 'event_id', text(eventId));
    if (row === undefined) return null;
    if (
      row['owner_device_id'] !== scope.ownerDeviceId ||
      row['network_scope_id'] !== scope.networkScopeId
    )
      return fail('FOREIGN_OWNER');
    const tab = readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId);
    if (tab === null) return fail('UNAVAILABLE');
    const h = readHistory(db, tab),
      event = h.events.find((e) => e.input.eventId === eventId) ?? fail();
    return { input: event.input, receipt: event.receipt, current: h.current };
  });
}
export function readLocalNetworkOutbox(
  db: Database.Database,
  scope: LocalNetworkScope,
  commandId: string,
): LocalNetworkOutbox | null {
  return read(db, scope.ownerDeviceId, () => {
    const row = at(db, 'local_network_outbox', 'command_id', text(commandId));
    if (row === undefined) return null;
    if (
      row['owner_device_id'] !== scope.ownerDeviceId ||
      row['network_scope_id'] !== scope.networkScopeId
    )
      return fail('FOREIGN_OWNER');
    const tab = readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId);
    if (tab === null) return fail('UNAVAILABLE');
    return readHistory(db, tab).outboxes.get(commandId) ?? fail();
  });
}
/** Recover the original local ACK identity instead of allocating a replacement on restart. */
export function readLocalNetworkAcknowledgementEvent(
  db: Database.Database,
  scope: LocalNetworkScope,
  commandId: string,
): StoredLocalNetworkEvent | null {
  return readLocalNetworkDeliverySnapshot(db, scope, commandId).acknowledgementEvent;
}
/** The current request identity comes only from the verified owned history. */
export function readLocalNetworkRequestDeliverySnapshot(
  db: Database.Database,
  scope: LocalNetworkScope,
): LocalNetworkDeliverySnapshot {
  return read(db, scope.ownerDeviceId, () => {
    const tab = readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId);
    if (tab === null) return fail('UNAVAILABLE');
    const history = readHistory(db, tab);
    return localDeliverySnapshot(history, history.current.requestOrNull?.submitCommandId ?? null);
  });
}
function localDeliverySnapshot(
  history: ReturnType<typeof readHistory>,
  commandId: string | null,
): LocalNetworkDeliverySnapshot {
  const outbox = commandId === null ? null : (history.outboxes.get(commandId) ?? null);
  const requestId =
    outbox?.intent.operation === 'SUBMIT' || outbox?.intent.operation === 'CANCEL'
      ? outbox.intent.requestId
      : history.current.requestOrNull?.requestId;
  const submitted =
    requestId === undefined
      ? undefined
      : [...history.outboxes.values()].find(
          (o) => o.intent.operation === 'SUBMIT' && o.intent.requestId === requestId,
        );
  const extra = {
    requestCurrentOrNull:
      requestId === undefined || submitted?.acknowledgementOrNull == null
        ? null
        : localReviewCurrent(history.current, history.outboxes, history.review, requestId),
    cancelSettlementOrNull:
      commandId === null ? null : (history.review.settlements.get(commandId) ?? null),
  };
  if (outbox === null) {
    return { current: history.current, outbox: null, acknowledgementEvent: null, ...extra };
  }
  const event = history.events.find(
    (e) =>
      e.input.mutation.kind === 'ACKNOWLEDGE' &&
      e.input.mutation.acknowledgement.commandId === commandId,
  );
  if (outbox.acknowledgementOrNull === null) {
    if (event !== undefined) return fail();
    return { current: history.current, outbox, acknowledgementEvent: null, ...extra };
  }
  if (
    event === undefined ||
    event.input.mutation.kind !== 'ACKNOWLEDGE' ||
    !same(event.input.mutation.acknowledgement, outbox.acknowledgementOrNull)
  )
    return fail();
  return {
    ...extra,
    current: history.current,
    outbox,
    acknowledgementEvent: {
      input: event.input,
      receipt: event.receipt,
      current: history.current,
    },
  };
}
/** Capture receipt history and the current view together; callers may reuse them only synchronously. */
export function readLocalNetworkDeliverySnapshot(
  db: Database.Database,
  scope: LocalNetworkScope,
  commandId: string,
): LocalNetworkDeliverySnapshot {
  return read(db, scope.ownerDeviceId, () => {
    const row = at(db, 'local_network_outbox', 'command_id', text(commandId));
    if (
      row !== undefined &&
      (row['owner_device_id'] !== scope.ownerDeviceId ||
        row['network_scope_id'] !== scope.networkScopeId)
    )
      return fail('FOREIGN_OWNER');
    const tab = readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId);
    if (tab === null) return fail('UNAVAILABLE');
    const history = readHistory(db, tab);
    if (row !== undefined && !history.outboxes.has(commandId)) return fail();
    return localDeliverySnapshot(history, commandId);
  });
}
export function readLocalNetworkShellExitByNavigationId(
  db: Database.Database,
  ownerDeviceId: string,
  navigationRequestId: string,
): StoredLocalNetworkEvent | null {
  return read(db, ownerDeviceId, () => {
    const id = `navigation:${text(navigationRequestId)}`,
      row = at(db, 'local_network_application_event', 'event_id', id);
    if (row === undefined) return null;
    if (row['owner_device_id'] !== ownerDeviceId) return fail('FOREIGN_OWNER');
    const event =
      readLocalNetworkApplicationEvent(
        db,
        { ownerDeviceId, networkScopeId: uuid(row['network_scope_id']) },
        id,
      ) ?? fail();
    return event.input.mutation.kind === 'SHELL_EXIT' ? event : null;
  });
}
function assertUnused(db: Database.Database, id: string): void {
  if (id === loadDeviceId(db)) return fail('IDEMPOTENCY_CONFLICT');
  for (const [table, columns] of [
    ['local_gm_profile', ['profile_id']],
    ['local_gm_context', ['context_id']],
    ['campaign_draft', ['draft_id']],
    ['campaign_draft_update', ['update_id']],
    ['campaign_draft_cancel', ['cancel_id']],
    ['campaign_creation_command', ['command_id', 'receipt_id']],
    ['local_network_application_event', ['event_id', 'receipt_id']],
    ['hosted_network_command', ['command_id', 'receipt_id']],
    ['local_network_tab_entry', ['entry_command_id', 'entry_receipt_id']],
    ['local_network_tab_close', ['close_command_id', 'close_receipt_id']],
    ['local_network_tab', ['network_scope_id', 'tab_id', 'owner_device_id']],
    ['hosted_technical_session', ['technical_session_id', 'attempt_id']],
    ['hosted_device_request', ['request_id']],
    ['local_character', ['local_character_id']],
    ['campaign', ['campaign_id']],
    ['campaign_character_copy', ['campaign_character_id']],
  ] as const)
    for (const column of columns)
      if (at(db, table, column, id) !== undefined) return fail('IDEMPOTENCY_CONFLICT');
  if (hasRequestReviewSchema(db))
    for (const [table, columns] of [
      ['hosted_device_request_decision', ['command_id', 'receipt_id']],
      ['hosted_device_request_lane_binding', ['command_id', 'receipt_id']],
      ['local_network_lane_binding', ['command_id']],
      ['gm_request_queue_event', ['event_id']],
    ] as const)
      for (const column of columns)
        if (at(db, table, column, id) !== undefined) return fail('IDEMPOTENCY_CONFLICT');
  if (
    (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)['version'] ===
    12
  )
    for (const [table, columns] of CAMPAIGN_ADMISSION_IDENTITIES)
      for (const column of columns)
        if (at(db, table, column, id) !== undefined) return fail('IDEMPOTENCY_CONFLICT');
}
function admissionMutationKind(value: unknown): unknown {
  return input(() => object(object(value)['mutation'])['kind']);
}
export function commitLocalNetworkMutation(
  db: Database.Database,
  value: LocalNetworkMutationInput,
  guard: NetworkStoreGuard<LocalNetworkApplication>,
): StoredLocalNetworkEvent {
  if (db.inTransaction) return fail('INVALID_INPUT');
  const kind = admissionMutationKind(value);
  if (kind === 'ADMISSION_RETURN' || kind === 'ADMISSION_ADVANCE') return fail('INVALID_INPUT');
  return safe(() => db.transaction(() => writeLocalNetworkMutation(db, value, guard)).immediate());
}
/** Only the owning admission transaction may append its verified terminal return. */
export function commitLocalAdmissionNetworkMutation(
  db: Database.Database,
  value: LocalNetworkMutationInput,
): StoredLocalNetworkEvent {
  if (!db.inTransaction) return fail('INVALID_INPUT');
  const kind = admissionMutationKind(value);
  if (kind !== 'ADMISSION_RETURN' && kind !== 'ADMISSION_ADVANCE') return fail('INVALID_INPUT');
  return writeLocalNetworkMutation(db, value, () => undefined);
}
function writeLocalNetworkMutation(
  db: Database.Database,
  value: LocalNetworkMutationInput,
  guard: NetworkStoreGuard<LocalNetworkApplication>,
): StoredLocalNetworkEvent {
  return safe(() =>
    db
      .transaction(() => {
        schema(db);
        owner(db, value.ownerDeviceId);
        const tab = readOwnedLocalNetworkTab(db, value.ownerDeviceId, value.networkScopeId);
        if (tab === null) return fail('UNAVAILABLE');
        const i = input(() => mutationInput(value, tab.tabId)),
          h = readHistory(db, tab);
        const old = at(db, 'local_network_application_event', 'event_id', i.eventId);
        if (old !== undefined) {
          const known = h.events.find((e) => e.input.eventId === i.eventId);
          if (known === undefined || !same(known.input, i)) return fail('IDEMPOTENCY_CONFLICT');
          guarded(db, guard, h.current, 'REPLAY');
          owner(db, i.ownerDeviceId);
          return { input: known.input, receipt: known.receipt, current: h.current };
        }
        if (i.mutation.kind === 'ADMISSION_RETURN' || i.mutation.kind === 'ADMISSION_ADVANCE')
          validateLocalAdmissionNetworkEvent(db, h.current, i);
        else assertLocalAdmissionTabMutable(db, tab);
        if (
          !same(i.expectedRevisions, vectorOf(h.current)) ||
          i.expectedDraftRevision !== h.current.draftRevision
        )
          return fail('STALE_REVISION');
        assertUnused(db, i.eventId);
        assertUnused(db, i.receiptId);
        if (i.mutation.kind === 'INTENT') {
          if (i.mutation.intent.commandId === i.receiptId) return fail('IDEMPOTENCY_CONFLICT');
          if (i.mutation.intent.commandId !== i.eventId)
            assertUnused(db, i.mutation.intent.commandId);
        }
        if (
          ['LANE_BIND_INTENT', 'LANE_BIND_ACK', 'REQUEST_ADVANCE', 'CANCEL_SETTLE'].includes(
            i.mutation.kind,
          ) &&
          !hasRequestReviewSchema(db)
        )
          return fail('UNAVAILABLE');
        if (
          i.mutation.kind === 'LANE_BIND_INTENT' &&
          i.mutation.outbox.request.commandId !== i.eventId
        )
          assertUnused(db, i.mutation.outbox.request.commandId);
        assertReviewPin(db, h.current, h.outboxes, i.mutation);
        const oldOutboxes = new Map(h.outboxes),
          oldLanes = new Map(h.review.lanes),
          oldCurrents = new Map(h.review.currents),
          oldSettlements = new Map(h.review.settlements),
          next = reduce(
            h.current,
            i.mutation,
            h.outboxes,
            h.review,
            mutationOrigin(db, tab, h.events, i.mutation),
            i.eventId,
          ),
          receipt = receiptFor(h.current, next, i);
        guarded(db, guard, h.current, 'APPLY');
        owner(db, i.ownerDeviceId);
        const event: EventRecord = {
          input: i,
          receipt,
          previousSha256: sha(canonical(h.current)),
          nextSha256: sha(canonical(next)),
        };
        const before = changes(db);
        let expected = 2;
        db.prepare('INSERT INTO local_network_application_event VALUES (?,?,?,?,?,?,?)').run(
          i.eventId,
          i.receiptId,
          i.networkScopeId,
          i.ownerDeviceId,
          h.events.length,
          canonical(event),
          sha(canonical(event)),
        );
        db.prepare(
          'INSERT INTO local_network_application VALUES (?,?,?,?,?) ON CONFLICT(network_scope_id) DO UPDATE SET head_event_id=excluded.head_event_id,record_json=excluded.record_json,record_sha256=excluded.record_sha256',
        ).run(i.networkScopeId, i.ownerDeviceId, i.eventId, canonical(next), sha(canonical(next)));
        for (const [id, o] of h.outboxes)
          if (!oldOutboxes.has(id) || !same(oldOutboxes.get(id), o)) {
            expected++;
            db.prepare(
              'INSERT INTO local_network_outbox VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(command_id) DO UPDATE SET acknowledged=excluded.acknowledged,record_json=excluded.record_json,record_sha256=excluded.record_sha256',
            ).run(
              id,
              i.networkScopeId,
              i.ownerDeviceId,
              o.intent.operation,
              o.intent.operation === 'OPEN' ? o.intent.attemptId : o.intent.requestId,
              o.acknowledgementOrNull === null ? 0 : 1,
              canonical(o),
              sha(canonical(o)),
            );
          }
        for (const [id, lane] of h.review.lanes)
          if (!same(oldLanes.get(id) ?? null, lane)) {
            expected++;
            db.prepare(
              'INSERT INTO local_network_lane_binding VALUES (?,?,?,?,?,?,?) ON CONFLICT(command_id) DO UPDATE SET acknowledged=excluded.acknowledged,record_json=excluded.record_json,record_sha256=excluded.record_sha256',
            ).run(
              lane.request.commandId,
              i.networkScopeId,
              i.ownerDeviceId,
              id,
              lane.receiptOrNull === null ? 0 : 1,
              canonical(lane),
              sha(canonical(lane)),
            );
          }
        for (const [id, record] of h.review.currents)
          if (!same(oldCurrents.get(id) ?? null, record)) {
            expected++;
            db.prepare(
              'INSERT INTO local_network_request_current VALUES (?,?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET head_event_id=excluded.head_event_id,record_json=excluded.record_json,record_sha256=excluded.record_sha256',
            ).run(
              id,
              i.networkScopeId,
              i.ownerDeviceId,
              record.headEventId,
              canonical(record),
              sha(canonical(record)),
            );
          }
        for (const [id, record] of h.review.settlements)
          if (!same(oldSettlements.get(id) ?? null, record)) {
            expected++;
            db.prepare('INSERT INTO local_network_cancel_settlement VALUES (?,?,?,?,?,?)').run(
              id,
              i.networkScopeId,
              i.ownerDeviceId,
              record.requestId,
              canonical(record),
              sha(canonical(record)),
            );
          }
        if (!same(vectorOf(tab), vectorOf(next)) || tab.lifecycleState !== lifecycle(next)) {
          const writeTab =
            i.mutation.kind === 'ADMISSION_ADVANCE' || i.mutation.kind === 'ADMISSION_RETURN'
              ? localAdmissionTabStorage.writeApplicationState
              : writeLocalNetworkTabApplicationState;
          writeTab(db, tab, vectorOf(next), lifecycle(next), i.eventId);
          expected++;
        }
        if (!db.inTransaction || changes(db) !== before + expected) return fail('SOURCE_CHANGED');
        if (i.mutation.kind === 'ADMISSION_ADVANCE' || i.mutation.kind === 'ADMISSION_RETURN') {
          // The owning owner-journal writer immediately verifies this complete history,
          // every mirror and every tab claim before its final guard in the same transaction.
          return { input: i, receipt, current: next };
        }
        const verified = readLocalNetworkApplicationEvent(db, i, i.eventId) ?? fail();
        if (!same(verified, { input: i, receipt, current: next })) return fail('SOURCE_CHANGED');
        guarded(db, guard, h.current, 'APPLY');
        owner(db, i.ownerDeviceId);
        return verified;
      })
      .immediate(),
  );
}

/** All lane identities come from the original journal; callers supply only a new command ID. */
export function prepareLocalRequestLaneBinding(
  db: Database.Database,
  scope: LocalNetworkScope,
  requestId: string,
  commandId: string,
  guard: NetworkStoreGuard<LocalNetworkApplication>,
): LocalRequestLaneBindingOutbox {
  const prepared = read(db, scope.ownerDeviceId, () => {
    const tab =
        readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId) ??
        fail('UNAVAILABLE'),
      h = readHistory(db, tab);
    const prior = h.review.lanes.get(uuid(requestId));
    if (prior !== undefined) {
      if (prior.request.commandId !== commandId) return fail('IDEMPOTENCY_CONFLICT');
      guarded(db, guard, h.current, 'REPLAY');
      return { kind: 'REPLAY' as const, prior };
    }
    const origin = originalLaneOrigin(db, tab, h.events, requestId),
      submit = localSubmit(h.outboxes, requestId);
    // This also requires the original SUBMIT ACK after a remote-commit/local-ACK crash gap.
    const current = localReviewCurrent(h.current, h.outboxes, h.review, requestId);
    if (submit.intent.batch.schemaVersion === 2 || current.proof.laneProvenance !== null)
      return fail('UNAVAILABLE');
    const request = validateDeviceRequestBindLane({
      schemaVersion: 1,
      operation: 'DEVICE_REQUEST_BIND_LANE',
      commandId: text(commandId),
      requestId,
      technicalSessionId: submit.intent.batch.technicalSessionId,
      submitCommandId: submit.intent.commandId,
      batchSha256: submit.intent.batch.batchSha256,
      localControllerSeatId: origin.tabId,
    });
    const outbox: LocalRequestLaneBindingOutbox = {
      ...scope,
      requestId,
      request,
      semanticBodySha256: sha(canonical(request)),
      origin,
      receiptOrNull: null,
    };
    return { kind: 'APPLY' as const, outbox, current: h.current };
  });
  if (prepared.kind === 'REPLAY') return prepared.prior;
  commitLocalNetworkMutation(
    db,
    {
      ...scope,
      expectedRevisions: vectorOf(prepared.current),
      expectedDraftRevision: prepared.current.draftRevision,
      eventId: commandId,
      receiptId: `lane-bind-intent:${commandId}`,
      clientRequestJsonOrNull: null,
      mutation: { kind: 'LANE_BIND_INTENT', outbox: prepared.outbox },
    },
    guard,
  );
  return readLocalRequestLaneBinding(db, scope, requestId) ?? fail();
}
export function readLocalRequestLaneBinding(
  db: Database.Database,
  scope: LocalNetworkScope,
  requestId: string,
): LocalRequestLaneBindingOutbox | null {
  return read(db, scope.ownerDeviceId, () => {
    const tab =
        readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId) ??
        fail('UNAVAILABLE'),
      h = readHistory(db, tab);
    localSubmit(h.outboxes, uuid(requestId));
    return h.review.lanes.get(requestId) ?? null;
  });
}
export function acknowledgeLocalRequestLaneBinding(
  db: Database.Database,
  scope: LocalNetworkScope,
  commandId: string,
  value: PeerLaneBindingReceipt,
  guard: NetworkStoreGuard<LocalNetworkApplication>,
): LocalRequestLaneBindingDelivery {
  const receipt = input(() => validatePeerLaneBindingReceipt(value));
  const found = read(db, scope.ownerDeviceId, () => {
    const tab =
        readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId) ??
        fail('UNAVAILABLE'),
      h = readHistory(db, tab);
    const outbox = h.review.lanes.get(receipt.binding.requestId) ?? fail('NOT_FOUND');
    if (outbox.request.commandId !== commandId || receipt.commandId !== commandId)
      return fail('IDEMPOTENCY_CONFLICT');
    if (outbox.receiptOrNull !== null) {
      if (!same(outbox.receiptOrNull, receipt)) return fail('IDEMPOTENCY_CONFLICT');
      guarded(db, guard, h.current, 'REPLAY');
    }
    return { outbox, current: h.current };
  });
  if (found.outbox.receiptOrNull === null)
    commitLocalNetworkMutation(
      db,
      {
        ...scope,
        expectedRevisions: vectorOf(found.current),
        expectedDraftRevision: found.current.draftRevision,
        eventId: `lane-bind-ack:${commandId}`,
        receiptId: `lane-bind-ack-receipt:${commandId}`,
        clientRequestJsonOrNull: null,
        mutation: { kind: 'LANE_BIND_ACK', commandId, receipt },
      },
      guard,
    );
  return {
    outbox: readLocalRequestLaneBinding(db, scope, receipt.binding.requestId) ?? fail(),
    current: readLocalNetworkDeliverySnapshot(db, scope, receipt.binding.submitCommandId),
  };
}
export function readLocalNetworkRequestCurrent(
  db: Database.Database,
  scope: LocalNetworkScope,
  requestId: string,
): VerifiedLocalRequestCurrent {
  return read(db, scope.ownerDeviceId, () => {
    const tab =
        readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId) ??
        fail('UNAVAILABLE'),
      h = readHistory(db, tab);
    return localReviewCurrent(h.current, h.outboxes, h.review, uuid(requestId));
  });
}
export function commitLocalNetworkRequestAdvance(
  db: Database.Database,
  source: LocalNetworkSource,
  value: {
    readonly eventId: string;
    readonly receiptId: string;
    readonly proof: VerifiedRequestReviewProof;
  },
  guard: NetworkStoreGuard<LocalNetworkApplication>,
): LocalNetworkDeliverySnapshot {
  const row = input(() => object(value, ['eventId', 'receiptId', 'proof']));
  const result = read(db, source.ownerDeviceId, () => {
    const tab =
        readOwnedLocalNetworkTab(db, source.ownerDeviceId, source.networkScopeId) ??
        fail('UNAVAILABLE'),
      h = readHistory(db, tab);
    const i = input(() =>
      mutationInput(
        {
          ...source,
          eventId: row['eventId'],
          receiptId: row['receiptId'],
          clientRequestJsonOrNull: null,
          mutation: { kind: 'REQUEST_ADVANCE', proof: row['proof'] },
        },
        tab.tabId,
      ),
    );
    if (i.mutation.kind !== 'REQUEST_ADVANCE') return fail();
    const saved = at(db, 'local_network_application_event', 'event_id', i.eventId);
    if (saved !== undefined) {
      const known = h.events.find((e) => e.input.eventId === i.eventId);
      if (known === undefined || !same(known.input, i)) return fail('IDEMPOTENCY_CONFLICT');
      guarded(db, guard, h.current, 'REPLAY');
      return {
        unchanged: true,
        input: i,
        submitCommandId: i.mutation.proof.submittedReceipt.commandId,
      };
    }
    assertUnused(db, i.eventId);
    assertUnused(db, i.receiptId);
    if (
      !same(i.expectedRevisions, vectorOf(h.current)) ||
      i.expectedDraftRevision !== h.current.draftRevision
    )
      return fail('STALE_REVISION');
    const proof = localProof(h.current, h.outboxes, i.mutation.proof),
      requestId = proof.proof.submittedReceipt.request.requestId;
    const current = localReviewCurrent(h.current, h.outboxes, h.review, requestId),
      equal = same(current, proof);
    if (equal) guarded(db, guard, h.current, 'REPLAY');
    return { unchanged: equal, input: i, submitCommandId: proof.proof.submittedReceipt.commandId };
  });
  if (!result.unchanged) commitLocalNetworkMutation(db, result.input, guard);
  return readLocalNetworkDeliverySnapshot(db, source, result.submitCommandId);
}
/** Recover exact settlement event identity before allocating IDs or retransmitting CANCEL. */
export function readLocalNetworkCancelSettlementEvent(
  db: Database.Database,
  scope: LocalNetworkScope,
  commandId: string,
): StoredLocalNetworkEvent | null {
  return read(db, scope.ownerDeviceId, () => {
    const id = text(commandId),
      row = at(db, 'local_network_outbox', 'command_id', id);
    if (
      row !== undefined &&
      (row['owner_device_id'] !== scope.ownerDeviceId ||
        row['network_scope_id'] !== scope.networkScopeId)
    )
      return fail('FOREIGN_OWNER');
    const tab =
        readOwnedLocalNetworkTab(db, scope.ownerDeviceId, scope.networkScopeId) ??
        fail('UNAVAILABLE'),
      h = readHistory(db, tab);
    const matches = h.events.filter(
      (e) => e.input.mutation.kind === 'CANCEL_SETTLE' && e.input.mutation.commandId === id,
    );
    if (matches.length > 1) return fail();
    const event = matches[0],
      settled = h.review.settlements.get(id);
    if (event === undefined) {
      if (settled !== undefined) return fail();
      return null;
    }
    if (
      settled === undefined ||
      event.input.mutation.kind !== 'CANCEL_SETTLE' ||
      !same(event.input.mutation.proof, settled.proof)
    )
      return fail();
    return { input: event.input, receipt: event.receipt, current: h.current };
  });
}
/** The old CANCEL intent remains unacknowledged; this separate proof stops retransmission. */
export function commitLocalNetworkCancelSettlement(
  db: Database.Database,
  source: LocalNetworkSource,
  value: {
    readonly eventId: string;
    readonly receiptId: string;
    readonly commandId: string;
    readonly proof: VerifiedRequestReviewProof;
  },
  guard: NetworkStoreGuard<LocalNetworkApplication>,
): LocalNetworkDeliverySnapshot {
  const row = input(() => object(value, ['eventId', 'receiptId', 'commandId', 'proof'])),
    commandId = input(() => text(row['commandId']));
  const i: LocalNetworkMutationInput = {
    ...source,
    eventId: input(() => text(row['eventId'])),
    receiptId: input(() => text(row['receiptId'])),
    clientRequestJsonOrNull: null,
    mutation: {
      kind: 'CANCEL_SETTLE',
      commandId,
      proof: row['proof'] as VerifiedRequestReviewProof,
    },
  };
  const known = readLocalNetworkCancelSettlementEvent(db, source, commandId);
  if (known !== null && !same(known.input, i)) return fail('IDEMPOTENCY_CONFLICT');
  // The general writer checks exact replay before CAS and rechecks every source in its transaction.
  commitLocalNetworkMutation(db, i, guard);
  return readLocalNetworkDeliverySnapshot(db, source, commandId);
}

function pinRecord(
  db: Database.Database,
  ownerId: string,
  campaignId: string,
  application = true,
): LocalNetworkHostPin | null {
  const row = db
    .prepare('SELECT * FROM local_network_host_pin WHERE owner_device_id=? AND campaign_id=?')
    .get(ownerId, campaignId) as Row | undefined;
  if (row === undefined) return null;
  const value = object(checked(row), [
    'ownerDeviceId',
    'campaignId',
    'identity',
    'initialCanonicalOrigin',
    'entryCommandId',
  ]);
  const pin = {
    ownerDeviceId: uuid(value['ownerDeviceId']),
    campaignId: uuid(value['campaignId']),
    identity: identity(value['identity']),
    initialCanonicalOrigin: text(value['initialCanonicalOrigin']),
    entryCommandId: text(value['entryCommandId']),
  };
  if (
    pin.ownerDeviceId !== ownerId ||
    pin.campaignId !== campaignId ||
    row['host_device_id'] !== pin.identity.ownerDeviceId ||
    row['key_fingerprint'] !== pin.identity.keyFingerprintSha256
  )
    return fail();
  if (
    (application
      ? readLocalNetworkTabEntryByCommandId(db, ownerId, pin.entryCommandId)
      : localAdmissionTabStorage.entryAnchor(db, ownerId, pin.entryCommandId)) === null
  )
    return fail();
  return pin;
}
export function readLocalNetworkHostPin(
  db: Database.Database,
  ownerDeviceId: string,
  campaignId: string,
): LocalNetworkHostPin | null {
  return read(db, ownerDeviceId, () => pinRecord(db, ownerDeviceId, uuid(campaignId)));
}
/** Admission verifies the original network history separately, avoiding an overlay read cycle. */
export function readLocalNetworkHostPinAnchor(
  db: Database.Database,
  ownerDeviceId: string,
  campaignId: string,
): LocalNetworkHostPin | null {
  return read(db, ownerDeviceId, () => pinRecord(db, ownerDeviceId, uuid(campaignId), false));
}
export function commitLocalNetworkHostPin(
  db: Database.Database,
  scope: LocalNetworkScope,
  value: LocalNetworkHostPin,
  guard: NetworkStoreGuard<LocalNetworkApplication>,
): LocalNetworkHostPin {
  if (db.inTransaction) return fail('INVALID_INPUT');
  return safe(() =>
    db
      .transaction(() => {
        schema(db);
        owner(db, scope.ownerDeviceId);
        const r = input(() =>
          object(value, [
            'ownerDeviceId',
            'campaignId',
            'identity',
            'initialCanonicalOrigin',
            'entryCommandId',
          ]),
        );
        const pin: LocalNetworkHostPin = input(() => ({
          ownerDeviceId: uuid(r['ownerDeviceId']),
          campaignId: uuid(r['campaignId']),
          identity: identity(r['identity']),
          initialCanonicalOrigin: text(r['initialCanonicalOrigin']),
          entryCommandId: text(r['entryCommandId']),
        }));
        if (pin.ownerDeviceId !== scope.ownerDeviceId) return fail('FOREIGN_OWNER');
        const entry = readLocalNetworkTabEntryByCommandId(
          db,
          scope.ownerDeviceId,
          pin.entryCommandId,
        );
        if (entry === null || entry.request.networkScopeId !== scope.networkScopeId)
          return fail('INVALID_INPUT');
        const current = readLocalNetworkApplication(db, scope),
          known = pinRecord(db, pin.ownerDeviceId, pin.campaignId);
        if (known !== null) {
          if (!same(known.identity, pin.identity)) return fail('KEY_CONFLICT');
          guarded(db, guard, current, 'REPLAY');
          return known;
        }
        const others = db
          .prepare('SELECT campaign_id FROM local_network_host_pin WHERE owner_device_id=?')
          .all(pin.ownerDeviceId) as Row[];
        for (const other of others) {
          const p = pinRecord(db, pin.ownerDeviceId, text(other['campaign_id'])) ?? fail();
          if (
            (p.identity.ownerDeviceId === pin.identity.ownerDeviceId ||
              p.identity.keyFingerprintSha256 === pin.identity.keyFingerprintSha256) &&
            !same(p.identity, pin.identity)
          )
            return fail('KEY_CONFLICT');
        }
        guarded(db, guard, current, 'APPLY');
        const before = changes(db);
        db.prepare('INSERT INTO local_network_host_pin VALUES (?,?,?,?,?,?)').run(
          pin.ownerDeviceId,
          pin.campaignId,
          pin.identity.ownerDeviceId,
          pin.identity.keyFingerprintSha256,
          canonical(pin),
          sha(canonical(pin)),
        );
        if (
          changes(db) !== before + 1 ||
          !same(pinRecord(db, pin.ownerDeviceId, pin.campaignId), pin)
        )
          return fail('SOURCE_CHANGED');
        guarded(db, guard, current, 'APPLY');
        owner(db, pin.ownerDeviceId);
        return pin;
      })
      .immediate(),
  );
}

/** Shared internal storage mechanics; the host supplies rules/crypto checks through guards. */
export const networkApplicationStorage = {
  deliverySnapshot: localDeliverySnapshot,
  admissionHistory(
    db: Database.Database,
    scope: LocalNetworkScope,
  ): ReturnType<typeof readHistory> {
    return read(db, scope.ownerDeviceId, () =>
      readHistory(
        db,
        localAdmissionTabStorage.historyAnchor(db, scope.ownerDeviceId, scope.networkScopeId),
      ),
    );
  },
  /** Internal admission composition: closed tabs keep their verified original request history. */
  deliveryHistory(
    db: Database.Database,
    scope: LocalNetworkScope,
    commandId: string,
  ): LocalNetworkDeliverySnapshot {
    return read(db, scope.ownerDeviceId, () => {
      const tab = localAdmissionTabStorage.historyAnchor(
        db,
        scope.ownerDeviceId,
        scope.networkScopeId,
      );
      return localDeliverySnapshot(readHistory(db, tab), commandId);
    });
  },
  fail,
  object,
  canonical,
  sha,
  same,
  text,
  uuid,
  hash,
  integer,
  vector,
  vectorOf,
  zero,
  increment,
  safe,
  input,
  schema,
  hasRequestReviewSchema,
  owner,
  read,
  at,
  checked,
  changes,
  guarded,
  identity,
  campaignProof,
  candidate,
  batch,
  assertUnused,
  semanticBody,
};
