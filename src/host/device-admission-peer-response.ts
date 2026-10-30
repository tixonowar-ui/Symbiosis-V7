import { Buffer } from 'node:buffer';
import type {
  NetworkSessionConfirmation,
  NetworkRequestConfirmation,
  PeerLaneBindingReceipt,
  VerifiedRequestReviewProof,
} from '../persistence/network-local-application.js';
import type { NetworkGmRequestDecisionReceipt } from '../shared/network-application.js';
import type { DeviceAdmissionPeerCommand } from './device-admission-peer-commands.js';
import { CAMPAIGN_PEER_CHANNEL_MAX_BYTES } from './campaign-peer-channel.js';
import { canonicalPostSaveJson, postSaveSha256 } from './local-character-export.js';

export type PeerSessionHeader = NetworkSessionConfirmation;
export type PeerRequestHeader = NetworkRequestConfirmation;
export type PeerRequestReviewHeader = Omit<PeerRequestHeader, 'status'> & {
  readonly status: 'PENDING' | 'IN_REVIEW' | 'REJECTED' | 'CANCELLED';
};
export type DeviceAdmissionPeerReceipt =
  | PeerLaneBindingReceipt
  | {
      readonly operation: 'OPEN';
      readonly commandId: string;
      readonly receiptId: string;
      readonly semanticBodySha256: string;
      readonly session: PeerSessionHeader;
    }
  | {
      readonly operation: 'SUBMIT' | 'CANCEL';
      readonly commandId: string;
      readonly receiptId: string;
      readonly semanticBodySha256: string;
      readonly request: PeerRequestHeader;
    };
export type DeviceAdmissionPeerCurrent =
  | { readonly kind: 'SESSION'; readonly session: PeerSessionHeader }
  | { readonly kind: 'REQUEST'; readonly request: PeerRequestHeader }
  | {
      readonly kind: 'REQUEST_REVIEW';
      readonly request: PeerRequestReviewHeader;
      readonly proof: VerifiedRequestReviewProof;
    };
export const DEVICE_ADMISSION_PEER_REFUSAL_CODES = [
  'INVALID_COMMAND',
  'UNAVAILABLE',
  'IDEMPOTENCY_CONFLICT',
  'STALE_REVISION',
  'CAPACITY_EXCEEDED',
  'INCOMPATIBLE_BASELINE',
  'INVALID_CANDIDATE',
  'TRANSFER_UNAVAILABLE',
  'TRANSFER_LIMIT',
  'STALE_GENERATION',
] as const;
export type DeviceAdmissionPeerRefusalCode = (typeof DEVICE_ADMISSION_PEER_REFUSAL_CODES)[number];
type Operation = DeviceAdmissionPeerCommand['operation'];
export type DeviceAdmissionPeerResponse = { readonly schemaVersion: 1 } & (
  | {
      readonly operation: Exclude<Operation, 'DEVICE_REQUEST_CHUNK'>;
      readonly outcome: 'ACK';
      readonly delivery: 'COMMITTED' | 'REPLAY' | 'RECOVERED';
      readonly receipt: DeviceAdmissionPeerReceipt;
      readonly current: DeviceAdmissionPeerCurrent;
    }
  | {
      readonly operation: 'CONNECTION_RECOVER';
      readonly outcome: 'NOT_FOUND';
      readonly commandId: string;
      readonly attemptId: string;
      readonly semanticBodySha256: string;
      readonly fenced: true;
      readonly generation: number;
    }
  | {
      readonly operation: 'DEVICE_REQUEST_RECOVER';
      readonly outcome: 'NOT_FOUND';
      readonly requestId: string;
      readonly technicalSessionId: string;
      readonly submitCommandId: string;
      readonly fenced: true;
      readonly generation: number;
    }
  | {
      readonly operation: 'DEVICE_REQUEST_BEGIN';
      readonly outcome: 'TRANSFER_READY';
      readonly transferId: string;
      readonly nextChunkIndex: number;
      readonly receivedBytes: number;
    }
  | {
      readonly operation: 'DEVICE_REQUEST_CHUNK';
      readonly outcome: 'CHUNK_ACCEPTED';
      readonly transferId: string;
      readonly chunkIndex: number;
      readonly nextChunkIndex: number;
      readonly receivedBytes: number;
    }
  | {
      readonly operation: Operation;
      readonly outcome: 'REFUSED';
      readonly code: DeviceAdmissionPeerRefusalCode;
    }
);
export class DeviceAdmissionPeerResponseError extends Error {
  readonly code = 'INVALID_RESPONSE';
  constructor() {
    super('device admission peer response: INVALID_RESPONSE');
  }
}
const fail = (): never => {
  throw new DeviceAdmissionPeerResponseError();
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const operations: readonly Operation[] = [
  'CONNECTION_OPEN',
  'CONNECTION_RECOVER',
  'DEVICE_REQUEST_CANCEL',
  'DEVICE_REQUEST_RECOVER',
  'DEVICE_REQUEST_BEGIN',
  'DEVICE_REQUEST_CHUNK',
  'DEVICE_REQUEST_COMMIT',
  'DEVICE_REQUEST_BIND_LANE',
];
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail();
  const proto: unknown = Object.getPrototypeOf(value),
    d = Object.getOwnPropertyDescriptors(value);
  if (
    (proto !== Object.prototype && proto !== null) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((k) => d[k] === undefined || !d[k].enumerable || !Object.hasOwn(d[k], 'value'))
  )
    return fail();
  return Object.fromEntries(keys.map((k) => [k, d[k]!.value as unknown]));
}
const text = (v: unknown): string => (typeof v === 'string' && v.length > 0 ? v : fail());
const uuid = (v: unknown): string => (UUID.test(text(v)) ? (v as string) : fail());
const hash = (v: unknown): string => (SHA.test(text(v)) ? (v as string) : fail());
const integer = (v: unknown): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : fail();
function proof(value: unknown): PeerSessionHeader['campaignProof'] {
  const p = record(value, ['campaignId', 'revisions', 'checkpointSha256']),
    r = record(p['revisions'], ['stateRevision', 'projectionRevision', 'actorVisibilityRevision']);
  return Object.freeze({
    campaignId: uuid(p['campaignId']),
    checkpointSha256: hash(p['checkpointSha256']),
    revisions: Object.freeze({
      stateRevision: integer(r['stateRevision']),
      projectionRevision: integer(r['projectionRevision']),
      actorVisibilityRevision: integer(r['actorVisibilityRevision']),
    }),
  });
}
function session(value: unknown): PeerSessionHeader {
  const s = record(value, [
    'technicalSessionId',
    'attemptId',
    'campaignProof',
    'connectionRevision',
    'receiptId',
  ]);
  return Object.freeze({
    technicalSessionId: uuid(s['technicalSessionId']),
    attemptId: text(s['attemptId']),
    campaignProof: proof(s['campaignProof']),
    connectionRevision: integer(s['connectionRevision']),
    receiptId: text(s['receiptId']),
  });
}
function request(value: unknown): PeerRequestHeader {
  const r = record(value, [
    'requestId',
    'technicalSessionId',
    'submitCommandId',
    'submitReceiptId',
    'requestRevision',
    'status',
    'batchSha256',
    'closureOrNull',
  ]);
  if (r['status'] !== 'PENDING') return fail();
  let closureOrNull: PeerRequestHeader['closureOrNull'] = null;
  if (r['closureOrNull'] !== null) {
    const c = record(r['closureOrNull'], ['commandId', 'receiptId', 'reason']),
      reason = text(c['reason']);
    if (reason.trim().length === 0) return fail();
    for (const character of reason)
      if (/[\p{Cc}\ud800-\udfff]/u.test(character) && !['\n', '\r', '\t'].includes(character))
        return fail();
    closureOrNull = Object.freeze({
      commandId: text(c['commandId']),
      receiptId: text(c['receiptId']),
      reason,
    });
  }
  return Object.freeze({
    requestId: uuid(r['requestId']),
    technicalSessionId: uuid(r['technicalSessionId']),
    submitCommandId: text(r['submitCommandId']),
    submitReceiptId: text(r['submitReceiptId']),
    requestRevision: integer(r['requestRevision']),
    status: 'PENDING',
    batchSha256: hash(r['batchSha256']),
    closureOrNull,
  });
}
function list(value: unknown, minimum: number, maximum: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < minimum ||
    value.length > maximum
  )
    return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== value.length + 1) return fail();
  return Array.from({ length: value.length }, (_, index) => {
    const item = descriptors[String(index)];
    if (item === undefined || !item.enumerable || !Object.hasOwn(item, 'value')) return fail();
    return item.value as unknown;
  });
}
function laneReceipt(value: unknown): PeerLaneBindingReceipt {
  const r = record(value, ['operation', 'commandId', 'receiptId', 'semanticBodySha256', 'binding']);
  if (r['operation'] !== 'BIND_LANE') return fail();
  const b = record(r['binding'], [
    'campaignId',
    'requestOwnerDeviceId',
    'requestId',
    'technicalSessionId',
    'submitCommandId',
    'batchSha256',
    'localControllerSeatId',
  ]);
  const binding = Object.freeze({
    campaignId: uuid(b['campaignId']),
    requestOwnerDeviceId: uuid(b['requestOwnerDeviceId']),
    requestId: uuid(b['requestId']),
    technicalSessionId: uuid(b['technicalSessionId']),
    submitCommandId: text(b['submitCommandId']),
    batchSha256: hash(b['batchSha256']),
    localControllerSeatId: uuid(b['localControllerSeatId']),
  });
  const commandId = text(r['commandId']),
    receiptId = text(r['receiptId']);
  const command = {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_BIND_LANE',
    commandId,
    requestId: binding.requestId,
    technicalSessionId: binding.technicalSessionId,
    submitCommandId: binding.submitCommandId,
    batchSha256: binding.batchSha256,
    localControllerSeatId: binding.localControllerSeatId,
  };
  if (
    new Set([
      commandId,
      binding.requestId,
      binding.technicalSessionId,
      binding.submitCommandId,
      binding.localControllerSeatId,
    ]).size !== 5 ||
    commandId === receiptId ||
    hash(r['semanticBodySha256']) !== postSaveSha256(canonicalPostSaveJson(command))
  )
    return fail();
  return Object.freeze({
    operation: 'BIND_LANE',
    commandId,
    receiptId,
    semanticBodySha256: hash(r['semanticBodySha256']),
    binding,
  });
}
function reviewRequest(value: unknown): PeerRequestReviewHeader {
  const r = record(value, [
    'requestId',
    'technicalSessionId',
    'submitCommandId',
    'submitReceiptId',
    'requestRevision',
    'status',
    'batchSha256',
    'closureOrNull',
  ]);
  const status = r['status'];
  if (
    status !== 'PENDING' &&
    status !== 'IN_REVIEW' &&
    status !== 'REJECTED' &&
    status !== 'CANCELLED'
  )
    return fail();
  return Object.freeze({ ...request({ ...r, status: 'PENDING' }), status });
}
function reviewProof(
  value: unknown,
): Extract<DeviceAdmissionPeerCurrent, { kind: 'REQUEST_REVIEW' }> {
  const p = record(value, [
    'submittedReceipt',
    'cancelledReceiptOrNull',
    'decisions',
    'laneProvenance',
  ]);
  const submitted = receipt(p['submittedReceipt']);
  if (submitted.operation !== 'SUBMIT' || submitted.request.requestRevision !== 0) return fail();
  const used = new Set([submitted.commandId, submitted.receiptId]);
  if (used.size !== 2) return fail();
  let status: PeerRequestReviewHeader['status'] = 'PENDING',
    revision = 0;
  const decisions: NetworkGmRequestDecisionReceipt[] = [];
  // #177 has at most ACCEPT-TO-REVIEW followed by REJECT; neither creates admission.
  for (const item of list(p['decisions'], 0, 2)) {
    const d = record(item, [
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
    const accept = d['workflowCommandId'] === 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW';
    const commandId = text(d['commandId']),
      receiptId = text(d['receiptId']);
    const snapshots = list(d['candidateSnapshotChecksums'], 1, 3).map(hash);
    uuid(d['campaignId']);
    uuid(d['requestOwnerDeviceId']);
    text(d['authoritativeGmActorId']);
    text(d['timestamp']);
    if (
      (!accept && d['workflowCommandId'] !== 'UI-CMD-DEVICE-REQUEST-REJECT') ||
      used.has(commandId) ||
      used.has(receiptId) ||
      commandId === receiptId ||
      d['requestId'] !== submitted.request.requestId ||
      d['beforeRequestStatus'] !== status ||
      integer(d['beforeRequestRevision']) !== revision ||
      integer(d['requestRevision']) !== revision + 1 ||
      (status !== 'PENDING' && status !== 'IN_REVIEW') ||
      (accept && status !== 'PENDING') ||
      d['afterRequestStatus'] !== (accept ? 'IN_REVIEW' : 'REJECTED') ||
      (accept
        ? d['decisionReasonOrNull'] !== null
        : text(d['decisionReasonOrNull']).trim().length === 0)
    )
      return fail();
    if (decisions.length !== 0) {
      const first = decisions[0]!;
      if (
        d['campaignId'] !== first.campaignId ||
        d['requestOwnerDeviceId'] !== first.requestOwnerDeviceId ||
        canonicalPostSaveJson(snapshots) !== canonicalPostSaveJson(first.candidateSnapshotChecksums)
      )
        return fail();
    }
    used.add(commandId);
    used.add(receiptId);
    revision++;
    status = accept ? 'IN_REVIEW' : 'REJECTED';
    decisions.push(
      Object.freeze({
        ...d,
        candidateSnapshotChecksums: Object.freeze(snapshots),
      }) as unknown as NetworkGmRequestDecisionReceipt,
    );
  }
  let cancelled: VerifiedRequestReviewProof['cancelledReceiptOrNull'] = null;
  if (p['cancelledReceiptOrNull'] !== null) {
    const c = receipt(p['cancelledReceiptOrNull']);
    if (
      c.operation !== 'CANCEL' ||
      decisions.length !== 0 ||
      c.request.requestRevision !== 1 ||
      used.has(c.commandId) ||
      used.has(c.receiptId) ||
      c.commandId === c.receiptId ||
      canonicalPostSaveJson({ ...c.request, requestRevision: 0, closureOrNull: null }) !==
        canonicalPostSaveJson(submitted.request)
    )
      return fail();
    cancelled = Object.freeze({ ...c, operation: 'CANCEL' });
    used.add(c.commandId);
    used.add(c.receiptId);
    status = 'CANCELLED';
    revision = 1;
  }
  let lane: VerifiedRequestReviewProof['laneProvenance'] = null;
  if (p['laneProvenance'] !== null) {
    const raw = p['laneProvenance'];
    const kind =
      raw !== null && typeof raw === 'object'
        ? (Object.getOwnPropertyDescriptor(raw, 'kind')?.value as unknown)
        : null;
    if (kind === 'SUBMITTED_BATCH') {
      const l = record(raw, ['kind', 'batchSha256', 'localControllerSeatId']);
      if (hash(l['batchSha256']) !== submitted.request.batchSha256) return fail();
      lane = Object.freeze({
        kind,
        batchSha256: hash(l['batchSha256']),
        localControllerSeatId: uuid(l['localControllerSeatId']),
      });
    } else if (kind === 'BIND_LANE') {
      const l = record(raw, ['kind', 'receipt']),
        bound = laneReceipt(l['receipt']),
        b = bound.binding;
      if (
        b.requestId !== submitted.request.requestId ||
        b.technicalSessionId !== submitted.request.technicalSessionId ||
        b.submitCommandId !== submitted.commandId ||
        b.batchSha256 !== submitted.request.batchSha256 ||
        used.has(bound.commandId) ||
        used.has(bound.receiptId)
      )
        return fail();
      for (const d of decisions)
        if (d.campaignId !== b.campaignId || d.requestOwnerDeviceId !== b.requestOwnerDeviceId)
          return fail();
      lane = Object.freeze({ kind, receipt: bound });
    } else return fail();
  }
  if (decisions.length !== 0 && lane === null) return fail();
  const proof: VerifiedRequestReviewProof = Object.freeze({
    submittedReceipt: Object.freeze({ ...submitted, operation: 'SUBMIT' }),
    cancelledReceiptOrNull: cancelled,
    decisions: Object.freeze(decisions),
    laneProvenance: lane,
  });
  return Object.freeze({
    kind: 'REQUEST_REVIEW',
    proof,
    request: Object.freeze({
      ...submitted.request,
      status,
      requestRevision: revision,
      closureOrNull: cancelled?.request.closureOrNull ?? null,
    }),
  });
}
/** Codec-only derivation; the caller still verifies the original owner, batch and authenticated channel. */
export function deviceAdmissionRequestReviewCurrent(
  proof: VerifiedRequestReviewProof,
): Extract<DeviceAdmissionPeerCurrent, { kind: 'REQUEST_REVIEW' }> {
  return reviewProof(proof);
}

function receipt(value: unknown): DeviceAdmissionPeerReceipt {
  if (value === null || typeof value !== 'object') return fail();
  const operation: unknown = Object.getOwnPropertyDescriptor(value, 'operation')?.value;
  if (operation === 'BIND_LANE') return laneReceipt(value);
  if (operation === 'OPEN') {
    const r = record(value, [
        'operation',
        'commandId',
        'receiptId',
        'semanticBodySha256',
        'session',
      ]),
      s = session(r['session']);
    if (s.receiptId !== r['receiptId']) return fail();
    return Object.freeze({
      operation,
      commandId: text(r['commandId']),
      receiptId: text(r['receiptId']),
      semanticBodySha256: hash(r['semanticBodySha256']),
      session: s,
    });
  }
  if (operation !== 'SUBMIT' && operation !== 'CANCEL') return fail();
  const r = record(value, ['operation', 'commandId', 'receiptId', 'semanticBodySha256', 'request']),
    q = request(r['request']);
  if (
    operation === 'SUBMIT' &&
    (q.submitCommandId !== r['commandId'] ||
      q.submitReceiptId !== r['receiptId'] ||
      q.closureOrNull !== null)
  )
    return fail();
  if (
    operation === 'CANCEL' &&
    (q.closureOrNull === null ||
      q.closureOrNull.commandId !== r['commandId'] ||
      q.closureOrNull.receiptId !== r['receiptId'])
  )
    return fail();
  return Object.freeze({
    operation,
    commandId: text(r['commandId']),
    receiptId: text(r['receiptId']),
    semanticBodySha256: hash(r['semanticBodySha256']),
    request: q,
  });
}
function current(value: unknown): DeviceAdmissionPeerCurrent {
  if (value === null || typeof value !== 'object') return fail();
  const kind: unknown = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
  if (kind === 'SESSION') {
    const r = record(value, ['kind', 'session']);
    return Object.freeze({ kind, session: session(r['session']) });
  }
  if (kind === 'REQUEST_REVIEW') {
    const r = record(value, ['kind', 'request', 'proof']),
      parsed = reviewProof(r['proof']);
    if (
      canonicalPostSaveJson(reviewRequest(r['request'])) !== canonicalPostSaveJson(parsed.request)
    )
      return fail();
    return parsed;
  }
  if (kind === 'REQUEST') {
    const r = record(value, ['kind', 'request']);
    return Object.freeze({ kind, request: request(r['request']) });
  }
  return fail();
}
function paired(
  operation: Operation,
  r: DeviceAdmissionPeerReceipt,
  c: DeviceAdmissionPeerCurrent,
): void {
  if (operation === 'CONNECTION_OPEN' || operation === 'CONNECTION_RECOVER') {
    if (
      r.operation !== 'OPEN' ||
      c.kind !== 'SESSION' ||
      canonicalPostSaveJson(r.session) !== canonicalPostSaveJson(c.session)
    )
      return fail();
    return;
  }
  if (operation === 'DEVICE_REQUEST_BIND_LANE' || r.operation === 'BIND_LANE') {
    if (
      operation !== 'DEVICE_REQUEST_BIND_LANE' ||
      r.operation !== 'BIND_LANE' ||
      c.kind !== 'REQUEST_REVIEW' ||
      c.proof.laneProvenance?.kind !== 'BIND_LANE' ||
      canonicalPostSaveJson(c.proof.laneProvenance.receipt) !== canonicalPostSaveJson(r)
    )
      return fail();
    return;
  }
  if (r.operation === 'OPEN' || c.kind === 'SESSION' || operation === 'DEVICE_REQUEST_CHUNK')
    return fail();
  if ((operation === 'DEVICE_REQUEST_CANCEL') !== (r.operation === 'CANCEL')) return fail();
  const previous = r.request,
    latest = c.request;
  for (const key of [
    'requestId',
    'technicalSessionId',
    'submitCommandId',
    'submitReceiptId',
    'batchSha256',
  ] as const)
    if (previous[key] !== latest[key]) return fail();
  if (latest.requestRevision < previous.requestRevision) return fail();
  if (c.kind === 'REQUEST_REVIEW') {
    const original =
      r.operation === 'SUBMIT' ? c.proof.submittedReceipt : c.proof.cancelledReceiptOrNull;
    if (canonicalPostSaveJson(original) !== canonicalPostSaveJson(r)) return fail();
  } else if (
    r.operation === 'CANCEL' &&
    canonicalPostSaveJson(previous) !== canonicalPostSaveJson(latest)
  )
    return fail();
}
function response(value: unknown): DeviceAdmissionPeerResponse {
  if (value === null || typeof value !== 'object') return fail();
  const d = Object.getOwnPropertyDescriptors(value),
    operation: unknown = d['operation']?.value,
    outcome: unknown = d['outcome']?.value;
  if (d['schemaVersion']?.value !== 1 || !operations.includes(operation as Operation))
    return fail();
  const op = operation as Operation,
    base = { schemaVersion: 1 as const, operation: op };
  const exact = (...keys: string[]) =>
    record(value, ['schemaVersion', 'operation', 'outcome', ...keys]);
  if (outcome === 'REFUSED') {
    const r = exact('code');
    if (!DEVICE_ADMISSION_PEER_REFUSAL_CODES.includes(r['code'] as DeviceAdmissionPeerRefusalCode))
      return fail();
    return Object.freeze({ ...base, outcome, code: r['code'] as DeviceAdmissionPeerRefusalCode });
  }
  if (outcome === 'ACK') {
    const r = exact('delivery', 'receipt', 'current'),
      delivery = r['delivery'];
    if (
      op === 'DEVICE_REQUEST_CHUNK' ||
      !['COMMITTED', 'REPLAY', 'RECOVERED'].includes(delivery as string)
    )
      return fail();
    if (
      (op === 'CONNECTION_RECOVER' || op === 'DEVICE_REQUEST_RECOVER') !==
      (delivery === 'RECOVERED')
    )
      return fail();
    if (op === 'DEVICE_REQUEST_BEGIN' && delivery !== 'REPLAY') return fail();
    const saved = receipt(r['receipt']),
      fresh = current(r['current']);
    paired(op, saved, fresh);
    return Object.freeze({
      ...base,
      operation: op,
      outcome,
      delivery: delivery as 'COMMITTED' | 'REPLAY' | 'RECOVERED',
      receipt: saved,
      current: fresh,
    });
  }
  if (outcome === 'NOT_FOUND') {
    if (op !== 'CONNECTION_RECOVER' && op !== 'DEVICE_REQUEST_RECOVER') return fail();
    const r =
      op === 'CONNECTION_RECOVER'
        ? exact('commandId', 'attemptId', 'semanticBodySha256', 'fenced', 'generation')
        : exact('requestId', 'technicalSessionId', 'submitCommandId', 'fenced', 'generation');
    const generation = integer(r['generation']);
    if (r['fenced'] !== true || generation === 0) return fail();
    if (op === 'CONNECTION_RECOVER')
      return Object.freeze({
        ...base,
        operation: op,
        outcome,
        commandId: text(r['commandId']),
        attemptId: text(r['attemptId']),
        semanticBodySha256: hash(r['semanticBodySha256']),
        fenced: true,
        generation,
      });
    return Object.freeze({
      ...base,
      operation: op,
      outcome,
      requestId: uuid(r['requestId']),
      technicalSessionId: uuid(r['technicalSessionId']),
      submitCommandId: text(r['submitCommandId']),
      fenced: true,
      generation,
    });
  }
  if (outcome === 'TRANSFER_READY' && op === 'DEVICE_REQUEST_BEGIN') {
    const r = exact('transferId', 'nextChunkIndex', 'receivedBytes');
    return Object.freeze({
      ...base,
      operation: op,
      outcome,
      transferId: uuid(r['transferId']),
      nextChunkIndex: integer(r['nextChunkIndex']),
      receivedBytes: integer(r['receivedBytes']),
    });
  }
  if (outcome === 'CHUNK_ACCEPTED' && op === 'DEVICE_REQUEST_CHUNK') {
    const r = exact('transferId', 'chunkIndex', 'nextChunkIndex', 'receivedBytes'),
      chunkIndex = integer(r['chunkIndex']),
      nextChunkIndex = integer(r['nextChunkIndex']),
      receivedBytes = integer(r['receivedBytes']);
    if (
      chunkIndex === Number.MAX_SAFE_INTEGER ||
      nextChunkIndex !== chunkIndex + 1 ||
      receivedBytes === 0
    )
      return fail();
    return Object.freeze({
      ...base,
      operation: op,
      outcome,
      transferId: uuid(r['transferId']),
      chunkIndex,
      nextChunkIndex,
      receivedBytes,
    });
  }
  return fail();
}
export function encodeDeviceAdmissionPeerResponse(value: DeviceAdmissionPeerResponse): string {
  try {
    const text = canonicalPostSaveJson(response(value));
    if (Buffer.byteLength(text, 'utf8') > CAMPAIGN_PEER_CHANNEL_MAX_BYTES) return fail();
    return text;
  } catch {
    return fail();
  }
}
export function decodeDeviceAdmissionPeerResponse(source: unknown): DeviceAdmissionPeerResponse {
  try {
    if (
      typeof source !== 'string' ||
      Buffer.byteLength(source, 'utf8') > CAMPAIGN_PEER_CHANNEL_MAX_BYTES
    )
      return fail();
    const value: unknown = JSON.parse(source),
      parsed = response(value);
    if (canonicalPostSaveJson(parsed) !== source) return fail();
    return parsed;
  } catch {
    return fail();
  }
}

/** Semantic journal identity only; DEVICE_REQUEST_SUBMIT is not an additional transport operation. */
export function deviceAdmissionSubmitSemanticBody(commandId: string, batchSha256: string): string {
  try {
    return canonicalPostSaveJson({
      schemaVersion: 1,
      operation: 'DEVICE_REQUEST_SUBMIT',
      commandId: text(commandId),
      batchSha256: hash(batchSha256),
    });
  } catch {
    return fail();
  }
}
