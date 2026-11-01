import { Buffer } from 'node:buffer';
import {
  admissionPlayerDecisionRequestValue,
  type AdmissionPlayerDecisionRequest,
} from '@shared/campaign-admission-proposal.js';
import type { AdmissionPlayerAbsenceProof } from '../persistence/local-campaign-admission.js';
import {
  CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
  assertCampaignPeerRpcBodyFits,
} from './campaign-peer-channel.js';
import { canonicalPostSaveJson, postSaveSha256 } from './local-character-export.js';
import { validatePeerCampaignHeader, type PeerCampaignHeader } from './campaign-peer-handshake.js';

export interface AdmissionCapacityCommand {
  readonly schemaVersion: 1;
  readonly operation: 'ADMISSION_CAPACITY_READ';
  readonly technicalSessionId: string;
}
export type AdmissionCapacityResponse = AdmissionCapacityCommand &
  (
    | {
        readonly outcome: 'CAPACITY';
        readonly campaign: PeerCampaignHeader;
        readonly occupiedCampaignPlaceCount: number;
        readonly alreadyImportedSourceUuids: readonly string[];
      }
    | { readonly outcome: 'REFUSED'; readonly code: AdmissionPeerRefusal }
  );

export interface AdmissionPeerScope {
  readonly requestId: string;
  readonly technicalSessionId: string;
  readonly submitCommandId: string;
}
export interface AdmissionPeerLimits {
  readonly maxPublicationBytes: number;
  readonly maxChunkBytes: number;
}
export const ADMISSION_PEER_OPERATIONS = [
  'ADMISSION_PUBLICATION_BEGIN',
  'ADMISSION_PUBLICATION_CHUNK',
  'ADMISSION_PLAYER_DECIDE',
  'ADMISSION_PLAYER_RECOVER',
] as const;
type Operation = (typeof ADMISSION_PEER_OPERATIONS)[number];
export type AdmissionPeerCommand = AdmissionPeerScope & { readonly schemaVersion: 1 } & (
    | { readonly operation: 'ADMISSION_PUBLICATION_BEGIN' }
    | {
        readonly operation: 'ADMISSION_PUBLICATION_CHUNK';
        readonly transferId: string;
        readonly publicationChecksum: string;
        readonly chunkIndex: number;
      }
    | {
        readonly operation: 'ADMISSION_PLAYER_DECIDE';
        readonly decision: AdmissionPlayerDecisionRequest;
      }
    | {
        readonly operation: 'ADMISSION_PLAYER_RECOVER';
        readonly commandId: string;
        readonly admissionBatchId: string;
        readonly semanticBodySha256: string;
      }
  );
export const ADMISSION_PEER_REFUSALS = [
  'UNAVAILABLE',
  'IDEMPOTENCY_CONFLICT',
  'STALE_REVISION',
  'CAPACITY_EXCEEDED',
  'FOREIGN_OWNER',
  'INVALID_INPUT',
  'TRANSFER_UNAVAILABLE',
  'TRANSFER_LIMIT',
  'STALE_GENERATION',
] as const;
export type AdmissionPeerRefusal = (typeof ADMISSION_PEER_REFUSALS)[number];
export type AdmissionPeerResponse = AdmissionPeerScope & { readonly schemaVersion: 1 } & (
    | { readonly operation: 'ADMISSION_PUBLICATION_BEGIN'; readonly outcome: 'NOT_READY' }
    | {
        readonly operation: 'ADMISSION_PUBLICATION_BEGIN';
        readonly outcome: 'MANIFEST';
        readonly transferId: string;
        readonly publicationChecksum: string;
        readonly bodySha256: string;
        readonly byteLength: number;
        readonly chunkBytes: number;
        readonly chunkCount: number;
        readonly campaignRevision: number;
      }
    | {
        readonly operation: 'ADMISSION_PUBLICATION_CHUNK';
        readonly outcome: 'CHUNK';
        readonly transferId: string;
        readonly publicationChecksum: string;
        readonly chunkIndex: number;
        readonly bytesBase64: string;
      }
    | {
        readonly operation: 'ADMISSION_PLAYER_DECIDE' | 'ADMISSION_PLAYER_RECOVER';
        readonly outcome: 'DECIDED';
        readonly receiptCanonicalJson: string;
        readonly receiptSha256: string;
      }
    | {
        readonly operation: 'ADMISSION_PLAYER_RECOVER';
        readonly outcome: 'NOT_APPLIED';
        readonly proof: AdmissionPlayerAbsenceProof;
      }
    | {
        readonly operation: Operation;
        readonly outcome: 'REFUSED';
        readonly code: AdmissionPeerRefusal;
      }
  );
export class AdmissionPeerCodecError extends Error {
  constructor() {
    super('campaign admission peer: INVALID_MESSAGE');
  }
}
const fail = (): never => {
  throw new AdmissionPeerCodecError();
};
const text = (v: unknown): string => (typeof v === 'string' && v.length !== 0 ? v : fail());
const integer = (v: unknown): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : fail();
const positive = (v: unknown): number => (integer(v) > 0 ? integer(v) : fail());
const uuid = (v: unknown): string =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(text(v))
    ? text(v)
    : fail();
const hash = (v: unknown): string => (/^[0-9a-f]{64}$/u.test(text(v)) ? text(v) : fail());
type Row = Record<string, unknown>;
function object(value: unknown, keys?: readonly string[]): Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail();
  const row = value as Row;
  if (
    keys !== undefined &&
    (Object.keys(row).length !== keys.length || keys.some((k) => !Object.hasOwn(row, k)))
  )
    return fail();
  return row;
}
/** Inspect descriptors before the shared semantic parsers can observe an accessor or sparse array. */
function detached(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fail();
  if (typeof value !== 'object') return fail();
  const array = Array.isArray(value),
    proto: unknown = Object.getPrototypeOf(value),
    d = Object.getOwnPropertyDescriptors(value);
  if (
    (!array && proto !== Object.prototype && proto !== null) ||
    (array && proto !== Array.prototype) ||
    Object.getOwnPropertySymbols(value).length !== 0
  )
    return fail();
  const keys = Object.keys(d).filter((k) => !array || k !== 'length');
  if (array && (keys.length !== value.length || keys.some((k, i) => k !== String(i))))
    return fail();
  const entries = keys.map((key) => {
    const descriptor = d[key]!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return fail();
    return [key, detached(descriptor.value)] as const;
  });
  return array ? entries.map((entry) => entry[1]) : Object.fromEntries(entries);
}
function safe<T>(body: () => T): T {
  try {
    return body();
  } catch {
    return fail();
  }
}
function bounded(value: unknown): string {
  const result = canonicalPostSaveJson(value);
  if (Buffer.byteLength(result, 'utf8') > CAMPAIGN_PEER_CHANNEL_MAX_BYTES) return fail();
  assertCampaignPeerRpcBodyFits(result);
  return result;
}
function parsed(source: unknown): Row {
  if (
    typeof source !== 'string' ||
    Buffer.byteLength(source, 'utf8') > CAMPAIGN_PEER_CHANNEL_MAX_BYTES
  )
    return fail();
  const value: unknown = JSON.parse(source);
  if (canonicalPostSaveJson(value) !== source) return fail();
  return object(value);
}
function limitsAt(value: AdmissionPeerLimits): AdmissionPeerLimits {
  const row = object(detached(value), ['maxPublicationBytes', 'maxChunkBytes']);
  return {
    maxPublicationBytes: positive(row['maxPublicationBytes']),
    maxChunkBytes: positive(row['maxChunkBytes']),
  };
}
function capacityCommand(row: Row): AdmissionCapacityCommand {
  if (row['schemaVersion'] !== 1 || row['operation'] !== 'ADMISSION_CAPACITY_READ') return fail();
  return {
    schemaVersion: 1,
    operation: 'ADMISSION_CAPACITY_READ',
    technicalSessionId: uuid(row['technicalSessionId']),
  };
}
export function encodeAdmissionCapacityCommand(value: AdmissionCapacityCommand): string {
  return safe(() =>
    bounded(
      capacityCommand(
        object(detached(value), ['schemaVersion', 'operation', 'technicalSessionId']),
      ),
    ),
  );
}
export function decodeAdmissionCapacityCommand(source: unknown): AdmissionCapacityCommand | null {
  return safe(() => {
    const row = parsed(source);
    return row['operation'] === 'ADMISSION_CAPACITY_READ'
      ? capacityCommand(object(row, ['schemaVersion', 'operation', 'technicalSessionId']))
      : null;
  });
}
function capacityResponse(row: Row): AdmissionCapacityResponse {
  const base = capacityCommand(row);
  if (row['outcome'] === 'REFUSED') {
    object(row, ['schemaVersion', 'operation', 'technicalSessionId', 'outcome', 'code']);
    if (!ADMISSION_PEER_REFUSALS.some((code) => code === row['code'])) return fail();
    return { ...base, outcome: 'REFUSED', code: row['code'] as AdmissionPeerRefusal };
  }
  object(row, [
    'schemaVersion',
    'operation',
    'technicalSessionId',
    'outcome',
    'campaign',
    'occupiedCampaignPlaceCount',
    'alreadyImportedSourceUuids',
  ]);
  if (row['outcome'] !== 'CAPACITY') return fail();
  const campaign = validatePeerCampaignHeader(row['campaign']),
    occupied = integer(row['occupiedCampaignPlaceCount']);
  if (
    occupied < campaign.activePcCount ||
    occupied > campaign.activePlayerCapacity ||
    !Array.isArray(row['alreadyImportedSourceUuids'])
  )
    return fail();
  const ids = row['alreadyImportedSourceUuids'].map(text);
  if (new Set(ids).size !== ids.length) return fail();
  return {
    ...base,
    outcome: 'CAPACITY',
    campaign,
    occupiedCampaignPlaceCount: occupied,
    alreadyImportedSourceUuids: ids,
  };
}
export function encodeAdmissionCapacityResponse(value: AdmissionCapacityResponse): string {
  return safe(() => bounded(capacityResponse(object(detached(value)))));
}
export function decodeAdmissionCapacityResponse(source: unknown): AdmissionCapacityResponse {
  return safe(() => capacityResponse(parsed(source)));
}
const scopeKeys = [
  'schemaVersion',
  'operation',
  'requestId',
  'technicalSessionId',
  'submitCommandId',
];
function header(row: Row) {
  if (row['schemaVersion'] !== 1 || !ADMISSION_PEER_OPERATIONS.some((v) => v === row['operation']))
    return fail();
  return {
    schemaVersion: 1 as const,
    operation: row['operation'] as Operation,
    requestId: uuid(row['requestId']),
    technicalSessionId: uuid(row['technicalSessionId']),
    submitCommandId: text(row['submitCommandId']),
  };
}
function command(row: Row): AdmissionPeerCommand {
  const base = header(row),
    operation = base.operation;
  switch (operation) {
    case 'ADMISSION_PUBLICATION_BEGIN':
      object(row, scopeKeys);
      return { ...base, operation };
    case 'ADMISSION_PUBLICATION_CHUNK':
      object(row, [...scopeKeys, 'transferId', 'publicationChecksum', 'chunkIndex']);
      return {
        ...base,
        operation,
        transferId: uuid(row['transferId']),
        publicationChecksum: hash(row['publicationChecksum']),
        chunkIndex: integer(row['chunkIndex']),
      };
    case 'ADMISSION_PLAYER_DECIDE':
      object(row, [...scopeKeys, 'decision']);
      return { ...base, operation, decision: admissionPlayerDecisionRequestValue(row['decision']) };
    case 'ADMISSION_PLAYER_RECOVER':
      object(row, [...scopeKeys, 'commandId', 'admissionBatchId', 'semanticBodySha256']);
      return {
        ...base,
        operation,
        commandId: text(row['commandId']),
        admissionBatchId: uuid(row['admissionBatchId']),
        semanticBodySha256: hash(row['semanticBodySha256']),
      };
  }
}
export function encodeAdmissionPeerCommand(value: AdmissionPeerCommand): string {
  return safe(() => bounded(command(object(detached(value)))));
}
/** A null result delegates an unrelated operation to the existing closed peer codec. */
export function decodeAdmissionPeerCommand(source: unknown): AdmissionPeerCommand | null {
  return safe(() => {
    const row = parsed(source);
    return ADMISSION_PEER_OPERATIONS.some((v) => v === row['operation']) ? command(row) : null;
  });
}
function response(row: Row, limits: AdmissionPeerLimits): AdmissionPeerResponse {
  const base = header(row),
    operation = base.operation,
    outcome = row['outcome'];
  const closed = (...keys: string[]) => object(row, [...scopeKeys, 'outcome', ...keys]);
  if (outcome === 'REFUSED') {
    closed('code');
    if (!ADMISSION_PEER_REFUSALS.some((v) => v === row['code'])) return fail();
    return { ...base, outcome, code: row['code'] as AdmissionPeerRefusal };
  }
  if (operation === 'ADMISSION_PUBLICATION_BEGIN' && outcome === 'NOT_READY') {
    closed();
    return { ...base, operation, outcome };
  }
  if (operation === 'ADMISSION_PUBLICATION_BEGIN' && outcome === 'MANIFEST') {
    closed(
      'transferId',
      'publicationChecksum',
      'bodySha256',
      'byteLength',
      'chunkBytes',
      'chunkCount',
      'campaignRevision',
    );
    const byteLength = positive(row['byteLength']),
      chunkBytes = positive(row['chunkBytes']),
      chunkCount = positive(row['chunkCount']);
    if (
      byteLength > limits.maxPublicationBytes ||
      chunkBytes > limits.maxChunkBytes ||
      chunkCount !== Math.ceil(byteLength / chunkBytes)
    )
      return fail();
    return {
      ...base,
      operation,
      outcome,
      transferId: uuid(row['transferId']),
      publicationChecksum: hash(row['publicationChecksum']),
      bodySha256: hash(row['bodySha256']),
      byteLength,
      chunkBytes,
      chunkCount,
      campaignRevision: integer(row['campaignRevision']),
    };
  }
  if (operation === 'ADMISSION_PUBLICATION_CHUNK' && outcome === 'CHUNK') {
    closed('transferId', 'publicationChecksum', 'chunkIndex', 'bytesBase64');
    const bytesBase64 = text(row['bytesBase64']);
    if (bytesBase64.length > CAMPAIGN_PEER_CHANNEL_MAX_BYTES) return fail();
    const bytes = Buffer.from(bytesBase64, 'base64');
    if (
      bytes.length === 0 ||
      bytes.length > limits.maxChunkBytes ||
      bytes.toString('base64') !== bytesBase64
    )
      return fail();
    return {
      ...base,
      operation,
      outcome,
      transferId: uuid(row['transferId']),
      publicationChecksum: hash(row['publicationChecksum']),
      chunkIndex: integer(row['chunkIndex']),
      bytesBase64,
    };
  }
  if (
    (operation === 'ADMISSION_PLAYER_DECIDE' || operation === 'ADMISSION_PLAYER_RECOVER') &&
    outcome === 'DECIDED'
  ) {
    closed('receiptCanonicalJson', 'receiptSha256');
    const receiptCanonicalJson = text(row['receiptCanonicalJson']),
      receiptSha256 = hash(row['receiptSha256']);
    // Semantic binding to the complete publication remains mandatory on the receiving installation.
    parsed(receiptCanonicalJson);
    if (postSaveSha256(receiptCanonicalJson) !== receiptSha256) return fail();
    return { ...base, operation, outcome, receiptCanonicalJson, receiptSha256 };
  }
  if (operation === 'ADMISSION_PLAYER_RECOVER' && outcome === 'NOT_APPLIED') {
    closed('proof');
    const proof = object(row['proof'], [
      'operation',
      'commandId',
      'semanticBodySha256',
      'campaignId',
      'admissionBatchId',
      'campaignRevision',
      'requestId',
      'submitCommandId',
      'technicalSessionId',
      'fenced',
      'generation',
      'code',
    ]);
    if (
      proof['operation'] !== 'ADMISSION_PLAYER_DECISION_ABSENT' ||
      proof['fenced'] !== true ||
      proof['code'] !== 'NOT_APPLIED' ||
      proof['requestId'] !== base.requestId ||
      proof['submitCommandId'] !== base.submitCommandId ||
      proof['technicalSessionId'] !== base.technicalSessionId
    )
      return fail();
    return {
      ...base,
      operation,
      outcome,
      proof: {
        operation: 'ADMISSION_PLAYER_DECISION_ABSENT',
        commandId: text(proof['commandId']),
        semanticBodySha256: hash(proof['semanticBodySha256']),
        campaignId: uuid(proof['campaignId']),
        admissionBatchId: uuid(proof['admissionBatchId']),
        campaignRevision: integer(proof['campaignRevision']),
        requestId: base.requestId,
        technicalSessionId: base.technicalSessionId,
        submitCommandId: base.submitCommandId,
        fenced: true,
        generation: positive(proof['generation']),
        code: 'NOT_APPLIED',
      },
    };
  }
  return fail();
}
export function encodeAdmissionPeerResponse(
  value: AdmissionPeerResponse,
  limits: AdmissionPeerLimits,
): string {
  return safe(() => bounded(response(object(detached(value)), limitsAt(limits))));
}
export function decodeAdmissionPeerResponse(
  source: unknown,
  limits: AdmissionPeerLimits,
): AdmissionPeerResponse {
  return safe(() => response(parsed(source), limitsAt(limits)));
}
