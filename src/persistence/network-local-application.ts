import { createHash } from 'node:crypto';
import { types } from 'node:util';
import type Database from 'better-sqlite3';
import type { PublicCandidateRef } from '@shared/device-admission.js';
import type { NetworkPublicErrorCode } from '@shared/network-application.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import { loadDeviceId } from './device-identity.js';
import {
  readOwnedLocalNetworkTabAnchor as readOwnedLocalNetworkTab,
  readLocalNetworkTabEntryByCommandId,
  writeLocalNetworkTabApplicationState,
  type LocalNetworkTab,
} from './network-local-tab.js';
import { NETWORK_APPLICATION_TABLES } from './migrations/0010-network-application.js';
import type { RevisionTriple } from './store.js';

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
export interface NetworkPreparedBatch {
  readonly requestId: string;
  readonly technicalSessionId: string;
  readonly connectionRevision: number;
  readonly campaignProof: NetworkCampaignProof;
  readonly candidates: readonly NetworkPreparedCandidate[];
  readonly batchSha256: string;
}
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
  readonly schemaVersion: 1;
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
}
export type NetworkStoreGuard<T> = (source: T, phase: 'APPLY' | 'REPLAY') => void;
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
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
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
  try {
    return body();
  } catch (error: unknown) {
    if (error instanceof NetworkApplicationStoreError) throw error;
    return fail();
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
  if (row['version'] !== 10) return fail();
  for (const table of NETWORK_APPLICATION_TABLES)
    db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
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
  const row = object(value, [
    'requestId',
    'technicalSessionId',
    'connectionRevision',
    'campaignProof',
    'candidates',
    'batchSha256',
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
  const row = object(value, stateKeys);
  const tabId = uuid(row['tabId']);
  if (
    row['schemaVersion'] !== 1 ||
    !forms.some((form) => form === row['formId']) ||
    typeof row['addressOrQrPayload'] !== 'string' ||
    typeof row['cancelReason'] !== 'string'
  )
    return fail();
  const result = {
    ...row,
    ...vector(Object.fromEntries(vectorKeys.map((key) => [key, row[key]]))),
    schemaVersion: 1,
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
  return current.requestOrNull !== null && current.requestOrNull.closureOrNull === null
    ? 'PROVISIONAL'
    : 'UNBOUND';
}
function reduce(
  current: LocalNetworkApplication,
  change: LocalNetworkMutation,
  outboxes: Map<string, LocalNetworkOutbox>,
): LocalNetworkApplication {
  const next = { ...current };
  if (current.shellExitOrNull !== null && change.kind !== 'NAVIGATE') return fail('UNAVAILABLE');
  let data = false,
    draft = false;
  const idle = () => {
    if (current.pendingCommandIdOrNull !== null || lifecycle(current) === 'PROVISIONAL')
      return fail('UNAVAILABLE');
  };
  switch (change.kind) {
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
        current.requestOrNull.closureOrNull !== null
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
  if (same(current, next)) return current;
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
} {
  let current = initial(tab);
  const outboxes = new Map<string, LocalNetworkOutbox>();
  const events: EventRecord[] = [];
  const attempts = new Set<string>();
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
    const next = reduce(current, i.mutation, outboxes),
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
    !same(checked(head), current)
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
      !same(checked(row), o)
    )
      return fail();
  }
  return { current, events, outboxes, attemptCount: attempts.size };
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
  return safe(() => readHistory(db, tab).current);
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
    const history = readHistory(db, tab),
      outbox = history.outboxes.get(commandId) ?? null;
    if (outbox === null) {
      if (row !== undefined) return fail();
      return { current: history.current, outbox: null, acknowledgementEvent: null };
    }
    const event = history.events.find(
      (e) =>
        e.input.mutation.kind === 'ACKNOWLEDGE' &&
        e.input.mutation.acknowledgement.commandId === commandId,
    );
    if (outbox.acknowledgementOrNull === null) {
      if (event !== undefined) return fail();
      return { current: history.current, outbox, acknowledgementEvent: null };
    }
    if (
      event === undefined ||
      event.input.mutation.kind !== 'ACKNOWLEDGE' ||
      !same(event.input.mutation.acknowledgement, outbox.acknowledgementOrNull)
    )
      return fail();
    return {
      current: history.current,
      outbox,
      acknowledgementEvent: {
        input: event.input,
        receipt: event.receipt,
        current: history.current,
      },
    };
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
  for (const [table, columns] of [
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
}
export function commitLocalNetworkMutation(
  db: Database.Database,
  value: LocalNetworkMutationInput,
  guard: NetworkStoreGuard<LocalNetworkApplication>,
): StoredLocalNetworkEvent {
  if (db.inTransaction) return fail('INVALID_INPUT');
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
        const oldOutboxes = new Map(h.outboxes),
          next = reduce(h.current, i.mutation, h.outboxes),
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
        if (!same(vectorOf(tab), vectorOf(next)) || tab.lifecycleState !== lifecycle(next)) {
          writeLocalNetworkTabApplicationState(db, tab, vectorOf(next), lifecycle(next), i.eventId);
          expected++;
        }
        if (!db.inTransaction || changes(db) !== before + expected) return fail('SOURCE_CHANGED');
        const verified = readLocalNetworkApplicationEvent(db, i, i.eventId) ?? fail();
        if (!same(verified, { input: i, receipt, current: next })) return fail('SOURCE_CHANGED');
        guarded(db, guard, h.current, 'APPLY');
        owner(db, i.ownerDeviceId);
        return verified;
      })
      .immediate(),
  );
}

function pinRecord(
  db: Database.Database,
  ownerId: string,
  campaignId: string,
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
  if (readLocalNetworkTabEntryByCommandId(db, ownerId, pin.entryCommandId) === null) return fail();
  return pin;
}
export function readLocalNetworkHostPin(
  db: Database.Database,
  ownerDeviceId: string,
  campaignId: string,
): LocalNetworkHostPin | null {
  return read(db, ownerDeviceId, () => pinRecord(db, ownerDeviceId, uuid(campaignId)));
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
