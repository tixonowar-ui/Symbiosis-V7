import { createHash } from 'node:crypto';
import { types } from 'node:util';
import type Database from 'better-sqlite3';
import type {
  CampaignCreateRequest,
  CampaignCreateResult,
  CampaignDraftFormId,
  CampaignDraftReplaceV3Message,
  CampaignFutureRollMode,
  CampaignMetadataValues,
  CampaignPublicDraftValues,
} from '../shared/campaign-creation.js';
import type { CommandReceipt, JsonObject } from '../shared/wire-protocol.js';
import { loadDeviceId } from './device-identity.js';
import type { FormActionIntentV2Message } from '../shared/wire-v2-protocol.js';
import type {
  NetworkGmRequestDraftValues,
  NetworkGmRequestReturnContext,
} from '../shared/network-application.js';
import { DEVICE_REQUEST_REVIEW_TABLES } from './migrations/0011-device-request-review.js';
import {
  commitNewCampaignCheckpoint,
  loadCampaignCheckpoint,
  type CampaignCheckpoint,
  type RevisionTriple,
} from './store.js';

export interface LocalGmProfile {
  readonly masterProfileId: string;
  readonly ownerDeviceId: string;
  readonly masterAuthorityRevision: 0;
}
export interface LocalGmContext extends RevisionTriple {
  readonly gmLocalContextId: string;
  readonly masterProfileId: string;
  readonly ownerDeviceId: string;
}
export interface StoredCampaignDraft extends RevisionTriple {
  readonly campaignDraftId: string;
  readonly gmLocalContextId: string;
  readonly ownerDeviceId: string;
  readonly status: 'DRAFT' | 'CANCELLED' | 'COMMITTED';
  readonly formId: CampaignDraftFormId;
  readonly draftRevision: number;
  readonly values: CampaignPublicDraftValues;
  readonly currentVerifier: JsonObject | null;
  readonly currentVerifierSha256: string | null;
  readonly committedCampaignId: string | null;
  readonly snapshotSha256: string;
}
export type CampaignCreationCursor = {
  readonly gmLocalContextId: string;
  readonly ownerDeviceId: string;
  readonly revisions: RevisionTriple;
  readonly targetSha256: string;
} & (
  | { readonly kind: 'MENU'; readonly formId: 'APP-011'; readonly targetId: string }
  | { readonly kind: 'DRAFT'; readonly formId: CampaignDraftFormId; readonly targetId: string }
  | { readonly kind: 'CAMPAIGN'; readonly formId: 'CMP-006'; readonly targetId: string }
  | { readonly kind: 'QUEUE'; readonly formId: 'NET-017' | 'CMP-006'; readonly targetId: string }
);
export type RedactedCampaignDraftRequest =
  | Exclude<CampaignDraftReplaceV3Message, { variant: 'SECRET' }>
  | (Omit<Extract<CampaignDraftReplaceV3Message, { variant: 'SECRET' }>, 'values'> & {
      readonly values: { readonly secretProvided: true };
    });
export interface CampaignDraftUpdateEvent {
  readonly changed: boolean;
  readonly appliedDraftRevision: number;
  readonly appliedRevisions: RevisionTriple;
}
export interface StoredCampaignDraftUpdate {
  readonly request: RedactedCampaignDraftRequest;
  readonly event: CampaignDraftUpdateEvent;
  readonly verifier: JsonObject | null;
  readonly verifierSha256: string | null;
}
export type CampaignSecretUpdate =
  | { readonly kind: 'KEEP'; readonly expectedCurrentVerifierSha256: string }
  | { readonly kind: 'REPLACE'; readonly preparedVerifier: JsonObject };
export interface CampaignDraftUpdateInput {
  readonly request: RedactedCampaignDraftRequest;
  readonly secretUpdate?: CampaignSecretUpdate;
  /** Host has asynchronously checked the candidate against this exact per-update proof. */
  readonly verifiedReplayProofSha256?: string;
}
export type CampaignDraftUpdateOutcome =
  | {
      readonly kind: 'APPLIED' | 'REPLAYED';
      readonly update: StoredCampaignDraftUpdate;
      readonly currentDraft: StoredCampaignDraft;
    }
  | {
      readonly kind: 'NEEDS_SECRET_VERIFICATION';
      readonly update: StoredCampaignDraftUpdate;
      readonly currentDraft: StoredCampaignDraft;
    };
export interface CampaignDraftNavigationInput {
  readonly gmLocalContextId: string;
  readonly campaignDraftId: string;
  readonly expectedDraftRevision: number;
  readonly expectedRevisions: RevisionTriple;
  readonly sourceFormId: CampaignDraftFormId;
  readonly targetFormId: CampaignDraftFormId;
}
export interface CampaignDraftCancelInput {
  readonly cancelRequestId: string;
  readonly gmLocalContextId: string;
  readonly campaignDraftId: string;
  readonly expectedDraftRevision: number;
  readonly expectedRevisions: RevisionTriple;
  readonly sourceFormId: 'CMP-001';
}
export interface StoredCampaignCancellation {
  readonly request: CampaignDraftCancelInput;
  readonly appliedDraftRevision: number;
  readonly appliedRevisions: RevisionTriple;
}
export interface StoredPausedCampaign extends JsonObject {
  readonly kind: 'PAUSED_CAMPAIGN';
  readonly schemaVersion: 1;
  readonly campaignId: string;
  readonly sourceCampaignDraftId: string;
  readonly metadata: CampaignMetadataValues & { readonly title: string };
  readonly host: JsonObject & {
    readonly activePlayerCapacity: number;
    readonly hostAddress: string;
    readonly hostPort: number;
    readonly networkInterface: string;
  };
  readonly defaultFutureRollMode: CampaignFutureRollMode;
  readonly status: 'PAUSED';
  readonly createdAt: string;
  readonly qrPayload: string;
  readonly baselineVersion: string;
  readonly creationCommandId: string;
  readonly creationReceiptId: string;
}
export interface CampaignCreationInput {
  readonly request: CampaignCreateRequest;
  readonly campaignId: string;
  readonly receiptId: string;
  readonly createdAt: string;
  readonly qrPayload: string;
  readonly baselineVersion: string;
}
export interface StoredCampaignCreationCommand {
  readonly request: CampaignCreateRequest;
  readonly receipt: CommandReceipt<CampaignCreateResult>;
}
export interface CampaignPrivateOwner {
  readonly campaignId: string;
  readonly gmLocalContextId: string;
  readonly masterProfileId: string;
  readonly ownerDeviceId: string;
  readonly verifier: JsonObject;
  readonly verifierSha256: string;
}
export type CampaignPrivateOwnerValidator = (owner: CampaignPrivateOwner) => void;
export interface CampaignCreationOrigin {
  readonly payload: StoredPausedCampaign;
  readonly command: StoredCampaignCreationCommand;
}
export type CampaignSourceValidator = (
  draft: StoredCampaignDraft,
  context: LocalGmContext,
  phase: 'APPLY' | 'REPLAY',
) => void;
export type CampaignTrustedValidator = () => void;
export class CampaignCreationStoreError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'CORRUPT_STORAGE'
      | 'FOREIGN_OWNER'
      | 'NOT_FOUND'
      | 'STALE_DRAFT'
      | 'STALE_REVISION'
      | 'IDEMPOTENCY_CONFLICT'
      | 'DRAFT_UNAVAILABLE'
      | 'REVISION_OVERFLOW'
      | 'SOURCE_CHANGED',
  ) {
    super(`campaign creation storage: ${code}`);
  }
}

type Row = Record<string, unknown>;
type StoreCode = CampaignCreationStoreError['code'];
const zero = (): RevisionTriple => ({
  stateRevision: 0,
  projectionRevision: 0,
  actorVisibilityRevision: 0,
});
const fail = (code: StoreCode = 'CORRUPT_STORAGE'): never => {
  throw new CampaignCreationStoreError(code);
};
const text = (value: unknown): string =>
  typeof value === 'string' && value.length > 0 ? value : fail();
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
const forms: readonly CampaignDraftFormId[] = [
  'CMP-001',
  'CMP-002',
  'CMP-003',
  'CMP-004',
  'CMP-005',
];
const form = (value: unknown): CampaignDraftFormId =>
  forms.includes(value as CampaignDraftFormId) ? (value as CampaignDraftFormId) : fail();
const object = (value: unknown, keys?: readonly string[]): Row => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail();
  const result = value as Row;
  if (
    keys !== undefined &&
    (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key)))
  )
    return fail();
  return result;
};
const canonical = (value: unknown): string => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = object(value);
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
};
const shaText = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
export const campaignCreationHash = (value: unknown): string => shaText(canonical(value));
const same = (left: unknown, right: unknown): boolean => canonical(left) === canonical(right);
const parse = (value: unknown): Row => {
  try {
    return object(JSON.parse(text(value)) as unknown);
  } catch {
    return fail();
  }
};
function checkedJson(row: Row, jsonField = 'record_json', hashField = 'record_sha256'): Row {
  const encoded = text(row[jsonField]);
  if (shaText(encoded) !== row[hashField]) return fail();
  const result = parse(encoded);
  if (canonical(result) !== encoded) return fail();
  return result;
}
const revisionKeys = ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const;
const revisions = (value: unknown): RevisionTriple => {
  const row = object(value);
  const result = {
    stateRevision: count(row['stateRevision']),
    projectionRevision: count(row['projectionRevision']),
    actorVisibilityRevision: count(row['actorVisibilityRevision']),
  };
  if (result.actorVisibilityRevision !== 0 || result.projectionRevision < result.stateRevision)
    return fail();
  return result;
};
const exactRevisions = (value: unknown): RevisionTriple => revisions(object(value, revisionKeys));
const next = (value: number): number =>
  value === Number.MAX_SAFE_INTEGER ? fail('REVISION_OVERFLOW') : value + 1;
function assertExpected(
  draft: StoredCampaignDraft,
  expectedDraftRevision: number,
  expected: RevisionTriple,
): void {
  if (draft.draftRevision !== expectedDraftRevision) return fail('STALE_DRAFT');
  if (!same(revisions(draft), exactRevisions(expected))) return fail('STALE_REVISION');
}
function synchronous(value: unknown): void {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  )
    return fail('INVALID_INPUT');
}
function validate(db: Database.Database, callback: () => unknown): void {
  if (Object.prototype.toString.call(callback) === '[object AsyncFunction]')
    return fail('INVALID_INPUT');
  const before = db.prepare('SELECT total_changes() AS changes').get() as Row;
  synchronous(callback());
  const after = db.prepare('SELECT total_changes() AS changes').get() as Row;
  if (before['changes'] !== after['changes']) return fail('SOURCE_CHANGED');
}
function transaction<T>(db: Database.Database, body: () => T): T {
  if (db.inTransaction) return fail('INVALID_INPUT');
  return db.transaction(body).immediate();
}
const owner = (db: Database.Database, value: string): void => {
  if (loadDeviceId(db) !== value) fail('FOREIGN_OWNER');
};
const rowAt = (db: Database.Database, table: string, key: string, id: string): Row | undefined =>
  db.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(text(id)) as Row | undefined;
function proofAt(row: Row): { verifier: JsonObject | null; verifierSha256: string | null } {
  if (row['verifier_json'] === null && row['verifier_sha256'] === null)
    return { verifier: null, verifierSha256: null };
  const verifier = checkedJson(row, 'verifier_json', 'verifier_sha256') as JsonObject;
  return { verifier, verifierSha256: text(row['verifier_sha256']) };
}
function publicValues(value: unknown): CampaignPublicDraftValues {
  const input = object(value, ['metadata', 'host', 'defaultFutureRollMode']);
  const metadata = object(input['metadata'], ['title', 'description', 'art']);
  for (const field of ['title', 'description'])
    if (metadata[field] !== null && typeof metadata[field] !== 'string') return fail();
  if (metadata['art'] !== null) {
    const art = object(metadata['art'], ['kind', 'mediaType', 'bytesBase64']);
    if (
      art['kind'] !== 'local-file' ||
      !['image/png', 'image/jpeg'].includes(art['mediaType'] as string) ||
      typeof art['bytesBase64'] !== 'string'
    )
      return fail();
  }
  const host = object(input['host'], [
    'activePlayerCapacity',
    'hostAddress',
    'hostPort',
    'networkInterface',
  ]);
  for (const field of ['hostAddress', 'networkInterface'])
    if (host[field] !== null && typeof host[field] !== 'string') return fail();
  for (const field of ['activePlayerCapacity', 'hostPort'])
    if (
      host[field] !== null &&
      (typeof host[field] !== 'number' || !Number.isSafeInteger(host[field]))
    )
      return fail();
  if (
    input['defaultFutureRollMode'] !== null &&
    input['defaultFutureRollMode'] !== 'AUTO' &&
    input['defaultFutureRollMode'] !== 'MANUAL'
  )
    return fail();
  return parse(canonical(input)) as CampaignPublicDraftValues;
}
const emptyValues = (): CampaignPublicDraftValues => ({
  metadata: { title: null, description: null, art: null },
  host: { activePlayerCapacity: null, hostAddress: null, hostPort: null, networkInterface: null },
  defaultFutureRollMode: null,
});
function profileRow(db: Database.Database, row: Row): LocalGmProfile {
  const parsed = object(checkedJson(row), [
    'masterProfileId',
    'ownerDeviceId',
    'masterAuthorityRevision',
  ]);
  const result = {
    masterProfileId: text(parsed['masterProfileId']),
    ownerDeviceId: text(parsed['ownerDeviceId']),
    masterAuthorityRevision: 0 as const,
  };
  if (
    parsed['masterAuthorityRevision'] !== 0 ||
    row['profile_id'] !== result.masterProfileId ||
    row['owner_device_id'] !== result.ownerDeviceId
  )
    return fail();
  owner(db, result.ownerDeviceId);
  return result;
}
export function readLocalGmProfile(
  db: Database.Database,
  ownerDeviceId: string,
): LocalGmProfile | null {
  owner(db, ownerDeviceId);
  const row = rowAt(db, 'local_gm_profile', 'owner_device_id', ownerDeviceId);
  return row === undefined ? null : profileRow(db, row);
}
export function ensureLocalGmProfile(
  db: Database.Database,
  input: Omit<LocalGmProfile, 'masterAuthorityRevision'>,
  validateTrusted: CampaignTrustedValidator,
): LocalGmProfile {
  return transaction(db, () => {
    validate(db, validateTrusted);
    owner(db, input.ownerDeviceId);
    const existing = readLocalGmProfile(db, input.ownerDeviceId);
    if (existing !== null) return existing;
    assertUnusedId(db, input.masterProfileId);
    const profile = {
      masterProfileId: text(input.masterProfileId),
      ownerDeviceId: input.ownerDeviceId,
      masterAuthorityRevision: 0 as const,
    };
    db.prepare('INSERT INTO local_gm_profile VALUES (?,?,?,?)').run(
      profile.masterProfileId,
      profile.ownerDeviceId,
      canonical(profile),
      campaignCreationHash(profile),
    );
    return readLocalGmProfile(db, input.ownerDeviceId) ?? fail();
  });
}
export function readLocalGmContext(
  db: Database.Database,
  gmLocalContextId: string,
): LocalGmContext {
  const row = rowAt(db, 'local_gm_context', 'context_id', gmLocalContextId);
  if (row === undefined) return fail('NOT_FOUND');
  const parsed = object(checkedJson(row), [
    'gmLocalContextId',
    'masterProfileId',
    'ownerDeviceId',
    ...revisionKeys,
  ]);
  const result = {
    gmLocalContextId: text(parsed['gmLocalContextId']),
    masterProfileId: text(parsed['masterProfileId']),
    ownerDeviceId: text(parsed['ownerDeviceId']),
    ...revisions(parsed),
  };
  if (
    result.gmLocalContextId !== gmLocalContextId ||
    row['profile_id'] !== result.masterProfileId ||
    result.stateRevision !== 0
  )
    return fail();
  const profile = readLocalGmProfile(db, result.ownerDeviceId);
  if (profile?.masterProfileId !== result.masterProfileId) return fail('FOREIGN_OWNER');
  return result;
}
export function readActiveLocalGmContext(
  db: Database.Database,
  ownerDeviceId: string,
): LocalGmContext | null {
  owner(db, ownerDeviceId);
  const row = rowAt(db, 'local_gm_active_context', 'owner_device_id', ownerDeviceId);
  if (row === undefined) return null;
  const record = object(checkedJson(row), ['ownerDeviceId', 'gmLocalContextId']);
  if (record['ownerDeviceId'] !== ownerDeviceId || record['gmLocalContextId'] !== row['context_id'])
    return fail();
  const context = readLocalGmContext(db, text(record['gmLocalContextId']));
  if (context.ownerDeviceId !== ownerDeviceId) return fail('FOREIGN_OWNER');
  return context;
}
function writeContext(db: Database.Database, context: LocalGmContext): void {
  db.prepare('UPDATE local_gm_context SET record_json=?,record_sha256=? WHERE context_id=?').run(
    canonical(context),
    campaignCreationHash(context),
    context.gmLocalContextId,
  );
}
function writeCursor(db: Database.Database, cursor: CampaignCreationCursor): void {
  db.prepare(
    `INSERT INTO campaign_creation_cursor VALUES (?,?,?,?,?,?) ON CONFLICT(context_id) DO UPDATE SET
    kind=excluded.kind,target_id=excluded.target_id,form_id=excluded.form_id,record_json=excluded.record_json,record_sha256=excluded.record_sha256`,
  ).run(
    cursor.gmLocalContextId,
    cursor.kind,
    cursor.targetId,
    cursor.formId,
    canonical(cursor),
    campaignCreationHash(cursor),
  );
}
function menuCursor(context: LocalGmContext): CampaignCreationCursor {
  return {
    gmLocalContextId: context.gmLocalContextId,
    ownerDeviceId: context.ownerDeviceId,
    kind: 'MENU',
    formId: 'APP-011',
    targetId: context.gmLocalContextId,
    revisions: revisions(context),
    targetSha256: campaignCreationHash(context),
  };
}
export function createLocalGmContext(
  db: Database.Database,
  input: Pick<LocalGmContext, 'gmLocalContextId' | 'masterProfileId' | 'ownerDeviceId'>,
  validateTrusted: CampaignTrustedValidator,
): LocalGmContext {
  return transaction(db, () => {
    validate(db, validateTrusted);
    const profile = readLocalGmProfile(db, input.ownerDeviceId);
    if (profile?.masterProfileId !== input.masterProfileId) return fail('FOREIGN_OWNER');
    assertUnusedId(db, input.gmLocalContextId);
    const context = { ...input, ...zero() };
    db.prepare('INSERT INTO local_gm_context VALUES (?,?,?,?)').run(
      context.gmLocalContextId,
      context.masterProfileId,
      canonical(context),
      campaignCreationHash(context),
    );
    writeCursor(db, menuCursor(context));
    const active = {
      ownerDeviceId: context.ownerDeviceId,
      gmLocalContextId: context.gmLocalContextId,
    };
    db.prepare(
      `INSERT INTO local_gm_active_context VALUES (?,?,?,?) ON CONFLICT(owner_device_id) DO UPDATE SET context_id=excluded.context_id,record_json=excluded.record_json,record_sha256=excluded.record_sha256`,
    ).run(
      context.ownerDeviceId,
      context.gmLocalContextId,
      canonical(active),
      campaignCreationHash(active),
    );
    readCampaignCreationCursor(db, context.gmLocalContextId);
    if (!same(readActiveLocalGmContext(db, context.ownerDeviceId), context))
      return fail('SOURCE_CHANGED');
    return readLocalGmContext(db, context.gmLocalContextId);
  });
}

function assertUnusedId(db: Database.Database, id: string): void {
  text(id);
  if (id === loadDeviceId(db)) return fail('IDEMPOTENCY_CONFLICT');
  for (const [table, column] of [
    ['local_gm_profile', 'profile_id'],
    ['local_gm_context', 'context_id'],
    ['campaign_draft', 'draft_id'],
    ['campaign_draft_update', 'update_id'],
    ['campaign_draft_cancel', 'cancel_id'],
    ['campaign_creation_command', 'command_id'],
    ['campaign_creation_command', 'receipt_id'],
    ['campaign', 'campaign_id'],
    ['local_character', 'local_character_id'],
  ])
    if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(id) !== undefined)
      return fail('IDEMPOTENCY_CONFLICT');
  const version = (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)[
    'version'
  ];
  // An older campaign writer must not reuse identities already committed by a network family.
  const network =
    version === 10 || version === 11
      ? ([
          ['local_network_application_event', ['event_id', 'receipt_id']],
          ['hosted_network_command', ['command_id', 'receipt_id']],
          ['local_network_tab_entry', ['entry_command_id', 'entry_receipt_id']],
          ['local_network_tab_close', ['close_command_id', 'close_receipt_id']],
          ['local_network_tab', ['network_scope_id', 'tab_id']],
          ['hosted_technical_session', ['technical_session_id', 'attempt_id']],
          ['hosted_device_request', ['request_id']],
        ] as const)
      : [];
  const review =
    version === 11
      ? ([
          ['hosted_device_request_decision', ['command_id', 'receipt_id']],
          ['hosted_device_request_lane_binding', ['command_id', 'receipt_id']],
          ['local_network_lane_binding', ['command_id']],
          ['gm_request_queue_event', ['event_id']],
        ] as const)
      : [];
  for (const [table, columns] of [...network, ...review])
    for (const column of columns)
      if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(id) !== undefined)
        return fail('IDEMPOTENCY_CONFLICT');
}
function draftDocument(
  draft: Omit<StoredCampaignDraft, 'snapshotSha256'> | StoredCampaignDraft,
): Row {
  return {
    campaignDraftId: draft.campaignDraftId,
    gmLocalContextId: draft.gmLocalContextId,
    ownerDeviceId: draft.ownerDeviceId,
    status: draft.status,
    formId: draft.formId,
    draftRevision: draft.draftRevision,
    values: draft.values,
    currentVerifierSha256: draft.currentVerifierSha256,
    committedCampaignId: draft.committedCampaignId,
    ...revisions(draft),
  };
}
function writeDraft(
  db: Database.Database,
  draft: Omit<StoredCampaignDraft, 'snapshotSha256'> | StoredCampaignDraft,
  insert = false,
): void {
  const document = draftDocument(draft);
  if (
    (draft.currentVerifier === null) !== (draft.currentVerifierSha256 === null) ||
    (draft.currentVerifier !== null &&
      campaignCreationHash(draft.currentVerifier) !== draft.currentVerifierSha256)
  )
    return fail();
  const args = [
    draft.campaignDraftId,
    draft.gmLocalContextId,
    draft.status,
    canonical(document),
    campaignCreationHash(document),
    draft.currentVerifier === null ? null : canonical(draft.currentVerifier),
    draft.currentVerifierSha256,
  ];
  if (insert) db.prepare('INSERT INTO campaign_draft VALUES (?,?,?,?,?,?,?)').run(...args);
  else
    db.prepare(
      'UPDATE campaign_draft SET context_id=?,status=?,record_json=?,record_sha256=?,verifier_json=?,verifier_sha256=? WHERE draft_id=?',
    ).run(...args.slice(1), draft.campaignDraftId);
}
export function readCampaignDraft(
  db: Database.Database,
  gmLocalContextId: string,
  campaignDraftId: string,
): StoredCampaignDraft {
  const context = readLocalGmContext(db, gmLocalContextId);
  const row = rowAt(db, 'campaign_draft', 'draft_id', campaignDraftId);
  if (row === undefined) return fail('NOT_FOUND');
  const parsed = object(checkedJson(row), [
    'campaignDraftId',
    'gmLocalContextId',
    'ownerDeviceId',
    'status',
    'formId',
    'draftRevision',
    'values',
    'currentVerifierSha256',
    'committedCampaignId',
    ...revisionKeys,
  ]);
  const proof = proofAt(row);
  const result: StoredCampaignDraft = {
    campaignDraftId: text(parsed['campaignDraftId']),
    gmLocalContextId: text(parsed['gmLocalContextId']),
    ownerDeviceId: text(parsed['ownerDeviceId']),
    status: parsed['status'] as StoredCampaignDraft['status'],
    formId: form(parsed['formId']),
    draftRevision: count(parsed['draftRevision']),
    values: publicValues(parsed['values']),
    currentVerifier: proof.verifier,
    currentVerifierSha256: proof.verifierSha256,
    committedCampaignId:
      parsed['committedCampaignId'] === null ? null : text(parsed['committedCampaignId']),
    snapshotSha256: text(row['record_sha256']),
    ...revisions(parsed),
  };
  if (
    row['context_id'] !== gmLocalContextId ||
    result.gmLocalContextId !== gmLocalContextId ||
    result.ownerDeviceId !== context.ownerDeviceId
  )
    return fail('FOREIGN_OWNER');
  if (
    result.campaignDraftId !== campaignDraftId ||
    row['status'] !== result.status ||
    !['DRAFT', 'CANCELLED', 'COMMITTED'].includes(result.status) ||
    result.draftRevision !== result.stateRevision ||
    parsed['currentVerifierSha256'] !== proof.verifierSha256 ||
    (result.status === 'COMMITTED') !== (result.committedCampaignId !== null) ||
    (result.status !== 'DRAFT' && proof.verifier !== null)
  )
    return fail();
  return result;
}
const draftCursor = (draft: StoredCampaignDraft): CampaignCreationCursor => ({
  gmLocalContextId: draft.gmLocalContextId,
  ownerDeviceId: draft.ownerDeviceId,
  kind: 'DRAFT',
  targetId: draft.campaignDraftId,
  formId: draft.formId,
  revisions: revisions(draft),
  targetSha256: draft.snapshotSha256,
});

export function readCampaignCreationCursor(
  db: Database.Database,
  gmLocalContextId: string,
): CampaignCreationCursor {
  const context = readLocalGmContext(db, gmLocalContextId);
  const row = rowAt(db, 'campaign_creation_cursor', 'context_id', gmLocalContextId);
  if (row === undefined) return fail('NOT_FOUND');
  const parsed = object(checkedJson(row), [
    'gmLocalContextId',
    'ownerDeviceId',
    'kind',
    'targetId',
    'formId',
    'revisions',
    'targetSha256',
  ]);
  const cursor = {
    ...parsed,
    revisions: exactRevisions(parsed['revisions']),
  } as unknown as CampaignCreationCursor;
  if (
    cursor.gmLocalContextId !== gmLocalContextId ||
    cursor.ownerDeviceId !== context.ownerDeviceId
  )
    return fail('FOREIGN_OWNER');
  if (
    cursor.kind !== row['kind'] ||
    cursor.targetId !== row['target_id'] ||
    cursor.formId !== row['form_id']
  )
    return fail();
  if (cursor.kind === 'MENU') {
    if (!same(cursor, menuCursor(context))) return fail();
  } else if (cursor.kind === 'DRAFT') {
    const draft = readCampaignDraft(db, gmLocalContextId, cursor.targetId);
    if (draft.status !== 'DRAFT' || !same(cursor, draftCursor(draft))) return fail();
  } else if (cursor.kind === 'CAMPAIGN') {
    const privateOwner = readCampaignPrivateOwner(db, gmLocalContextId, cursor.targetId);
    const checkpoint = loadCampaignCheckpoint(db, cursor.targetId);
    if (
      privateOwner.gmLocalContextId !== gmLocalContextId ||
      cursor.formId !== 'CMP-006' ||
      !same(cursor.revisions, revisions(checkpoint)) ||
      cursor.targetSha256 !== campaignCreationHash(checkpoint)
    )
      return fail();
  } else if (cursor.kind === 'QUEUE') {
    const state = readOriginTransaction(db, () =>
      readGmRequestReviewViewStateInTransaction(db, {
        ownerDeviceId: context.ownerDeviceId,
        gmLocalContextId,
        campaignId: cursor.targetId,
      }),
    );
    if (state.viewOrNull === null || !same(cursor, queueCursor(state.viewOrNull))) return fail();
  } else return fail();
  return cursor;
}
function activeDraft(
  db: Database.Database,
  contextId: string,
  draftId: string,
): StoredCampaignDraft {
  const draft = readCampaignDraft(db, contextId, draftId);
  if (draft.status !== 'DRAFT') return fail('DRAFT_UNAVAILABLE');
  const cursor = readCampaignCreationCursor(db, contextId);
  if (cursor.kind !== 'DRAFT' || cursor.targetId !== draftId) return fail('DRAFT_UNAVAILABLE');
  return draft;
}
function sourceGuard(
  db: Database.Database,
  callback: CampaignSourceValidator,
  draft: StoredCampaignDraft,
  context: LocalGmContext,
  phase: 'APPLY' | 'REPLAY',
): void {
  if (Object.prototype.toString.call(callback) === '[object AsyncFunction]')
    return fail('INVALID_INPUT');
  validate(db, () => callback(draft, context, phase));
}
export function createCampaignDraft(
  db: Database.Database,
  input: {
    readonly gmLocalContextId: string;
    readonly campaignDraftId: string;
    readonly expectedRevisions: RevisionTriple;
  },
  validateTrusted: CampaignTrustedValidator,
): StoredCampaignDraft {
  return transaction(db, () => {
    validate(db, validateTrusted);
    const context = readLocalGmContext(db, input.gmLocalContextId);
    const cursor = readCampaignCreationCursor(db, input.gmLocalContextId);
    if (cursor.kind !== 'MENU') return fail('DRAFT_UNAVAILABLE');
    if (!same(revisions(context), exactRevisions(input.expectedRevisions)))
      return fail('STALE_REVISION');
    assertUnusedId(db, input.campaignDraftId);
    writeContext(db, { ...context, projectionRevision: next(context.projectionRevision) });
    writeDraft(
      db,
      {
        campaignDraftId: input.campaignDraftId,
        gmLocalContextId: context.gmLocalContextId,
        ownerDeviceId: context.ownerDeviceId,
        status: 'DRAFT',
        formId: 'CMP-001',
        draftRevision: 0,
        values: emptyValues(),
        currentVerifier: null,
        currentVerifierSha256: null,
        committedCampaignId: null,
        ...zero(),
      },
      true,
    );
    const draft = readCampaignDraft(db, context.gmLocalContextId, input.campaignDraftId);
    writeCursor(db, draftCursor(draft));
    readCampaignCreationCursor(db, context.gmLocalContextId);
    return draft;
  });
}

function storedRequest(value: unknown): RedactedCampaignDraftRequest {
  const request = object(value, [
    'messageType',
    'protocolVersion',
    'draftUpdateId',
    'expectedDraftRevision',
    'expectedRevisions',
    'variant',
    'scope',
    'values',
  ]);
  if (request['messageType'] !== 'campaign.draft.replace' || request['protocolVersion'] !== 3)
    return fail('INVALID_INPUT');
  text(request['draftUpdateId']);
  count(request['expectedDraftRevision']);
  object(request['expectedRevisions'], revisionKeys);
  exactRevisions(request['expectedRevisions']);
  const scope = object(request['scope'], ['gmLocalContextId', 'campaignDraftId', 'sourceFormId']);
  text(scope['gmLocalContextId']);
  text(scope['campaignDraftId']);
  const variant = request['variant'];
  const variantForm = {
    METADATA: 'CMP-001',
    HOST: 'CMP-002',
    SECRET: 'CMP-003',
    MODE: 'CMP-004',
  } as const;
  if (
    typeof variant !== 'string' ||
    !Object.hasOwn(variantForm, variant) ||
    variantForm[variant as keyof typeof variantForm] !== scope['sourceFormId']
  )
    return fail('INVALID_INPUT');
  if (variant === 'SECRET') {
    if (object(request['values'], ['secretProvided'])['secretProvided'] !== true)
      return fail('INVALID_INPUT');
  } else {
    const base = emptyValues();
    if (variant === 'METADATA') publicValues({ ...base, metadata: request['values'] });
    if (variant === 'HOST') publicValues({ ...base, host: request['values'] });
    if (variant === 'MODE')
      publicValues({ ...base, ...object(request['values'], ['defaultFutureRollMode']) });
  }
  return parse(canonical(request)) as unknown as RedactedCampaignDraftRequest;
}
function updateRow(
  db: Database.Database,
  row: Row,
  contextId: string,
  draftId: string,
): StoredCampaignDraftUpdate {
  const draft = readCampaignDraft(db, contextId, draftId);
  const request = storedRequest(parse(row['request_json']));
  const eventRow = object(parse(row['event_json']), [
    'changed',
    'appliedDraftRevision',
    'appliedRevisions',
  ]);
  if (typeof eventRow['changed'] !== 'boolean') return fail();
  const event = {
    changed: eventRow['changed'],
    appliedDraftRevision: count(eventRow['appliedDraftRevision']),
    appliedRevisions: exactRevisions(eventRow['appliedRevisions']),
  };
  const proof = proofAt(row);
  if (
    campaignCreationHash({ request, event, verifierSha256: proof.verifierSha256 }) !==
      row['journal_sha256'] ||
    row['update_id'] !== request.draftUpdateId ||
    row['draft_id'] !== draftId ||
    request.scope.campaignDraftId !== draftId ||
    request.scope.gmLocalContextId !== contextId ||
    event.appliedDraftRevision !== request.expectedDraftRevision + Number(event.changed) ||
    event.appliedRevisions.stateRevision !==
      request.expectedRevisions.stateRevision + Number(event.changed) ||
    event.appliedRevisions.projectionRevision !==
      request.expectedRevisions.projectionRevision + Number(event.changed) ||
    event.appliedDraftRevision > draft.draftRevision ||
    event.appliedRevisions.stateRevision !== event.appliedDraftRevision ||
    (request.variant !== 'SECRET' && proof.verifier !== null) ||
    (draft.status === 'DRAFT' && request.variant === 'SECRET' && proof.verifier === null) ||
    (draft.status !== 'DRAFT' && proof.verifier !== null)
  )
    return fail();
  return { request, event, ...proof };
}
export function readCampaignDraftUpdate(
  db: Database.Database,
  gmLocalContextId: string,
  campaignDraftId: string,
  draftUpdateId: string,
): StoredCampaignDraftUpdate | null {
  readCampaignDraft(db, gmLocalContextId, campaignDraftId);
  const row = rowAt(db, 'campaign_draft_update', 'update_id', draftUpdateId);
  if (row === undefined) return null;
  if (row['draft_id'] !== campaignDraftId) return fail('IDEMPOTENCY_CONFLICT');
  return updateRow(db, row, gmLocalContextId, campaignDraftId);
}
export function commitCampaignDraftUpdate(
  db: Database.Database,
  input: CampaignDraftUpdateInput,
  validateSource: CampaignSourceValidator,
): CampaignDraftUpdateOutcome {
  const request = storedRequest(input.request);
  return transaction(db, () => {
    const draft = activeDraft(db, request.scope.gmLocalContextId, request.scope.campaignDraftId);
    const context = readLocalGmContext(db, draft.gmLocalContextId);
    const known = readCampaignDraftUpdate(
      db,
      draft.gmLocalContextId,
      draft.campaignDraftId,
      request.draftUpdateId,
    );
    if (known !== null) {
      sourceGuard(db, validateSource, draft, context, 'REPLAY');
      if (!same(known.request, request)) return fail('IDEMPOTENCY_CONFLICT');
      if (request.variant === 'SECRET' && input.verifiedReplayProofSha256 !== known.verifierSha256)
        return { kind: 'NEEDS_SECRET_VERIFICATION', update: known, currentDraft: draft };
      return { kind: 'REPLAYED', update: known, currentDraft: draft };
    }
    sourceGuard(db, validateSource, draft, context, 'APPLY');
    assertUnusedId(db, request.draftUpdateId);
    assertExpected(draft, request.expectedDraftRevision, request.expectedRevisions);
    if (draft.formId !== request.scope.sourceFormId) return fail('DRAFT_UNAVAILABLE');
    let values = draft.values;
    let verifier = draft.currentVerifier;
    let verifierSha256 = draft.currentVerifierSha256;
    let changed: boolean;
    if (request.variant === 'SECRET') {
      if (input.secretUpdate === undefined) return fail('INVALID_INPUT');
      if (input.secretUpdate.kind === 'KEEP') {
        if (
          verifier === null ||
          verifierSha256 !== input.secretUpdate.expectedCurrentVerifierSha256
        )
          return fail('STALE_DRAFT');
        changed = false;
      } else if (input.secretUpdate.kind === 'REPLACE') {
        verifier = object(input.secretUpdate.preparedVerifier) as JsonObject;
        verifierSha256 = campaignCreationHash(verifier);
        changed = verifierSha256 !== draft.currentVerifierSha256;
      } else return fail('INVALID_INPUT');
    } else {
      if (input.secretUpdate !== undefined || input.verifiedReplayProofSha256 !== undefined)
        return fail('INVALID_INPUT');
      if (request.variant === 'METADATA')
        values = publicValues({ ...values, metadata: request.values });
      if (request.variant === 'HOST') values = publicValues({ ...values, host: request.values });
      if (request.variant === 'MODE')
        values = publicValues({
          ...values,
          defaultFutureRollMode: request.values.defaultFutureRollMode,
        });
      changed = !same(values, draft.values);
    }
    const updated = {
      ...draft,
      values,
      currentVerifier: verifier,
      currentVerifierSha256: verifierSha256,
      draftRevision: changed ? next(draft.draftRevision) : draft.draftRevision,
      stateRevision: changed ? next(draft.stateRevision) : draft.stateRevision,
      projectionRevision: changed ? next(draft.projectionRevision) : draft.projectionRevision,
    };
    if (changed) writeDraft(db, updated);
    const currentDraft = readCampaignDraft(db, draft.gmLocalContextId, draft.campaignDraftId);
    if (
      !same(draftDocument(currentDraft), draftDocument(updated)) ||
      !same(currentDraft.currentVerifier, verifier)
    )
      return fail('SOURCE_CHANGED');
    const event = {
      changed,
      appliedDraftRevision: currentDraft.draftRevision,
      appliedRevisions: revisions(currentDraft),
    };
    const journalProof = request.variant === 'SECRET' ? verifier : null;
    const journalSha = request.variant === 'SECRET' ? verifierSha256 : null;
    db.prepare('INSERT INTO campaign_draft_update VALUES (?,?,?,?,?,?,?)').run(
      request.draftUpdateId,
      draft.campaignDraftId,
      canonical(request),
      canonical(event),
      campaignCreationHash({ request, event, verifierSha256: journalSha }),
      journalProof === null ? null : canonical(journalProof),
      journalSha,
    );
    writeCursor(db, draftCursor(currentDraft));
    readCampaignCreationCursor(db, draft.gmLocalContextId);
    const storedUpdate =
      readCampaignDraftUpdate(
        db,
        draft.gmLocalContextId,
        draft.campaignDraftId,
        request.draftUpdateId,
      ) ?? fail();
    if (
      !same(readCampaignDraft(db, draft.gmLocalContextId, draft.campaignDraftId), currentDraft) ||
      !same(readLocalGmContext(db, context.gmLocalContextId), context) ||
      !same(storedUpdate, { request, event, verifier: journalProof, verifierSha256: journalSha })
    )
      return fail('SOURCE_CHANGED');
    return { kind: 'APPLIED', update: storedUpdate, currentDraft };
  });
}

export function navigateCampaignDraft(
  db: Database.Database,
  input: CampaignDraftNavigationInput,
  validateSource: CampaignSourceValidator,
): StoredCampaignDraft {
  return transaction(db, () => {
    const draft = activeDraft(db, input.gmLocalContextId, input.campaignDraftId);
    const context = readLocalGmContext(db, input.gmLocalContextId);
    sourceGuard(db, validateSource, draft, context, 'APPLY');
    assertExpected(draft, input.expectedDraftRevision, input.expectedRevisions);
    if (
      draft.formId !== input.sourceFormId ||
      Math.abs(
        forms.indexOf(form(input.sourceFormId)) - forms.indexOf(form(input.targetFormId)),
      ) !== 1
    )
      return fail('DRAFT_UNAVAILABLE');
    const updated = {
      ...draft,
      formId: input.targetFormId,
      projectionRevision: next(draft.projectionRevision),
    };
    writeDraft(db, updated);
    const current = readCampaignDraft(db, input.gmLocalContextId, input.campaignDraftId);
    if (!same(draftDocument(current), draftDocument(updated))) return fail('SOURCE_CHANGED');
    writeCursor(db, draftCursor(current));
    readCampaignCreationCursor(db, input.gmLocalContextId);
    if (
      !same(readCampaignDraft(db, input.gmLocalContextId, input.campaignDraftId), current) ||
      !same(readLocalGmContext(db, context.gmLocalContextId), context)
    )
      return fail('SOURCE_CHANGED');
    return current;
  });
}
function cancelRequest(value: unknown): CampaignDraftCancelInput {
  const result = object(value, [
    'cancelRequestId',
    'gmLocalContextId',
    'campaignDraftId',
    'expectedDraftRevision',
    'expectedRevisions',
    'sourceFormId',
  ]);
  for (const key of ['cancelRequestId', 'gmLocalContextId', 'campaignDraftId']) text(result[key]);
  count(result['expectedDraftRevision']);
  exactRevisions(result['expectedRevisions']);
  if (result['sourceFormId'] !== 'CMP-001') return fail('INVALID_INPUT');
  return parse(canonical(result)) as unknown as CampaignDraftCancelInput;
}
export function readCampaignDraftCancellation(
  db: Database.Database,
  gmLocalContextId: string,
  campaignDraftId: string,
  cancelRequestId: string,
): StoredCampaignCancellation | null {
  const draft = readCampaignDraft(db, gmLocalContextId, campaignDraftId);
  const row = rowAt(db, 'campaign_draft_cancel', 'cancel_id', cancelRequestId);
  if (row === undefined) return null;
  if (row['draft_id'] !== campaignDraftId) return fail('IDEMPOTENCY_CONFLICT');
  const request = cancelRequest(parse(row['request_json']));
  const event = object(parse(row['event_json']), ['appliedDraftRevision', 'appliedRevisions']);
  const appliedDraftRevision = count(event['appliedDraftRevision']);
  const appliedRevisions = exactRevisions(event['appliedRevisions']);
  if (
    row['cancel_id'] !== request.cancelRequestId ||
    request.gmLocalContextId !== gmLocalContextId ||
    request.campaignDraftId !== campaignDraftId ||
    campaignCreationHash({ request, event }) !== row['journal_sha256'] ||
    draft.status !== 'CANCELLED' ||
    draft.formId !== 'CMP-001' ||
    appliedDraftRevision !== request.expectedDraftRevision + 1 ||
    appliedDraftRevision !== draft.draftRevision ||
    !same(appliedRevisions, revisions(draft)) ||
    appliedRevisions.stateRevision !== request.expectedRevisions.stateRevision + 1 ||
    appliedRevisions.projectionRevision !== request.expectedRevisions.projectionRevision + 1
  )
    return fail();
  return { request, appliedDraftRevision, appliedRevisions };
}
export function readCampaignDraftCancellationById(
  db: Database.Database,
  gmLocalContextId: string,
  cancelRequestId: string,
): StoredCampaignCancellation | null {
  readLocalGmContext(db, gmLocalContextId);
  const row = rowAt(db, 'campaign_draft_cancel', 'cancel_id', cancelRequestId);
  return row === undefined
    ? null
    : readCampaignDraftCancellation(db, gmLocalContextId, text(row['draft_id']), cancelRequestId);
}
/** Only private replay proofs are erased. Redacted request/event bytes remain immutable. */
function eraseDraftProofs(db: Database.Database, draft: StoredCampaignDraft): void {
  const rows = db
    .prepare('SELECT * FROM campaign_draft_update WHERE draft_id=? ORDER BY update_id')
    .all(draft.campaignDraftId) as Row[];
  const updates = rows.map((row) =>
    updateRow(db, row, draft.gmLocalContextId, draft.campaignDraftId),
  );
  for (const update of updates) {
    if (update.verifier !== null)
      db.prepare(
        'UPDATE campaign_draft_update SET verifier_json=NULL,verifier_sha256=NULL,journal_sha256=? WHERE update_id=?',
      ).run(
        campaignCreationHash({
          request: update.request,
          event: update.event,
          verifierSha256: null,
        }),
        update.request.draftUpdateId,
      );
  }
}
function sealDraft(
  db: Database.Database,
  draft: StoredCampaignDraft,
  status: 'CANCELLED' | 'COMMITTED',
  campaignId: string | null,
): StoredCampaignDraft {
  eraseDraftProofs(db, draft);
  const sealed = {
    ...draft,
    status,
    committedCampaignId: campaignId,
    currentVerifier: null,
    currentVerifierSha256: null,
    draftRevision: next(draft.draftRevision),
    stateRevision: next(draft.stateRevision),
    projectionRevision: next(draft.projectionRevision),
  };
  writeDraft(db, sealed);
  const read = readCampaignDraft(db, draft.gmLocalContextId, draft.campaignDraftId);
  if (!same(draftDocument(read), draftDocument(sealed))) return fail('SOURCE_CHANGED');
  for (const row of db
    .prepare('SELECT * FROM campaign_draft_update WHERE draft_id=?')
    .all(draft.campaignDraftId) as Row[])
    updateRow(db, row, draft.gmLocalContextId, draft.campaignDraftId);
  return read;
}
export function cancelCampaignDraft(
  db: Database.Database,
  input: CampaignDraftCancelInput,
  validateSource: CampaignSourceValidator,
): StoredCampaignCancellation {
  const request = cancelRequest(input);
  return transaction(db, () => {
    const draft = readCampaignDraft(db, request.gmLocalContextId, request.campaignDraftId);
    const context = readLocalGmContext(db, request.gmLocalContextId);
    const known = readCampaignDraftCancellation(
      db,
      request.gmLocalContextId,
      request.campaignDraftId,
      request.cancelRequestId,
    );
    if (known !== null) {
      sourceGuard(db, validateSource, draft, context, 'REPLAY');
      if (!same(known.request, request)) return fail('IDEMPOTENCY_CONFLICT');
      return known;
    }
    activeDraft(db, request.gmLocalContextId, request.campaignDraftId);
    sourceGuard(db, validateSource, draft, context, 'APPLY');
    assertExpected(draft, request.expectedDraftRevision, request.expectedRevisions);
    if (draft.formId !== 'CMP-001') return fail('DRAFT_UNAVAILABLE');
    assertUnusedId(db, request.cancelRequestId);
    const sealed = sealDraft(db, draft, 'CANCELLED', null);
    const event = {
      appliedDraftRevision: sealed.draftRevision,
      appliedRevisions: revisions(sealed),
    };
    db.prepare('INSERT INTO campaign_draft_cancel VALUES (?,?,?,?,?)').run(
      request.cancelRequestId,
      draft.campaignDraftId,
      canonical(request),
      canonical(event),
      campaignCreationHash({ request, event }),
    );
    const menu = { ...context, projectionRevision: next(context.projectionRevision) };
    writeContext(db, menu);
    if (!same(readLocalGmContext(db, context.gmLocalContextId), menu))
      return fail('SOURCE_CHANGED');
    writeCursor(db, menuCursor(menu));
    readCampaignCreationCursor(db, context.gmLocalContextId);
    return (
      readCampaignDraftCancellation(
        db,
        request.gmLocalContextId,
        request.campaignDraftId,
        request.cancelRequestId,
      ) ?? fail()
    );
  });
}
function createRequest(value: unknown): CampaignCreateRequest {
  const request = object(value, [
    'messageType',
    'protocolVersion',
    'commandId',
    'commandKind',
    'workflowCommandId',
    'expectedRevisions',
    'payload',
    'role',
  ]);
  if (
    request['messageType'] !== 'command.request' ||
    request['protocolVersion'] !== 1 ||
    request['commandKind'] !== 'workflow-command' ||
    request['workflowCommandId'] !== 'UI-CMD-CAMPAIGN-CREATE' ||
    request['role'] !== 'gm'
  )
    return fail('INVALID_INPUT');
  text(request['commandId']);
  exactRevisions(request['expectedRevisions']);
  const payload = object(request['payload'], [
    'stage',
    'sourceFormId',
    'gmLocalContextId',
    'campaignDraftId',
    'draftRevision',
    'preflightLeaseId',
  ]);
  if (payload['stage'] !== 'CAMPAIGN_CREATE' || payload['sourceFormId'] !== 'CMP-005')
    return fail('INVALID_INPUT');
  for (const key of ['gmLocalContextId', 'campaignDraftId', 'preflightLeaseId']) text(payload[key]);
  count(payload['draftRevision']);
  return parse(canonical(request)) as unknown as CampaignCreateRequest;
}
function pausedPayload(value: unknown): StoredPausedCampaign {
  const parsed = object(value, [
    'kind',
    'schemaVersion',
    'campaignId',
    'sourceCampaignDraftId',
    'metadata',
    'host',
    'defaultFutureRollMode',
    'status',
    'createdAt',
    'qrPayload',
    'baselineVersion',
    'creationCommandId',
    'creationReceiptId',
  ]);
  if (
    parsed['kind'] !== 'PAUSED_CAMPAIGN' ||
    parsed['schemaVersion'] !== 1 ||
    parsed['status'] !== 'PAUSED'
  )
    return fail();
  const values = publicValues({
    metadata: parsed['metadata'],
    host: parsed['host'],
    defaultFutureRollMode: parsed['defaultFutureRollMode'],
  });
  if (
    values.metadata.title === null ||
    values.metadata.title.trim().length === 0 ||
    values.host.activePlayerCapacity === null ||
    values.host.activePlayerCapacity < 1 ||
    values.host.activePlayerCapacity > 5 ||
    values.host.hostPort === null ||
    values.host.hostPort < 1 ||
    values.host.hostPort > 65535 ||
    values.host.hostAddress === null ||
    values.host.hostAddress.length === 0 ||
    values.host.networkInterface === null ||
    values.host.networkInterface.length === 0 ||
    values.defaultFutureRollMode === null
  )
    return fail('INVALID_INPUT');
  for (const key of [
    'campaignId',
    'sourceCampaignDraftId',
    'createdAt',
    'qrPayload',
    'baselineVersion',
    'creationCommandId',
    'creationReceiptId',
  ])
    text(parsed[key]);
  return parse(canonical(parsed)) as StoredPausedCampaign;
}
function campaignPayload(
  db: Database.Database,
  campaignId: string,
): { checkpoint: CampaignCheckpoint; payload: StoredPausedCampaign } {
  const checkpoint = loadCampaignCheckpoint(db, campaignId);
  const root = rowAt(db, 'campaign', 'campaign_id', campaignId) ?? fail('NOT_FOUND');
  const payload = pausedPayload(parse(root['payload_json']));
  if (
    root['lifecycle_state'] !== 'PAUSED' ||
    payload.campaignId !== campaignId ||
    !same(revisions(checkpoint), zero())
  )
    return fail();
  // The full checkpoint reader compares the actual root and every copy to its snapshot.
  if (
    db
      .prepare('SELECT 1 FROM campaign_character_copy WHERE campaign_id=? LIMIT 1')
      .get(campaignId) !== undefined
  )
    return fail();
  return { checkpoint, payload };
}
function readCampaignOwnerBinding(
  db: Database.Database,
  gmLocalContextId: string,
  campaignId: string,
): CampaignPrivateOwner {
  const context = readLocalGmContext(db, gmLocalContextId);
  const row = rowAt(db, 'campaign_private_owner', 'campaign_id', campaignId) ?? fail('NOT_FOUND');
  const record = object(checkedJson(row), [
    'campaignId',
    'gmLocalContextId',
    'masterProfileId',
    'ownerDeviceId',
    'verifierSha256',
  ]);
  const proof = proofAt(row);
  if (
    proof.verifier === null ||
    proof.verifierSha256 === null ||
    record['campaignId'] !== campaignId ||
    record['gmLocalContextId'] !== gmLocalContextId ||
    record['masterProfileId'] !== context.masterProfileId ||
    record['ownerDeviceId'] !== context.ownerDeviceId ||
    record['verifierSha256'] !== proof.verifierSha256 ||
    row['context_id'] !== gmLocalContextId ||
    row['profile_id'] !== context.masterProfileId
  )
    return fail('FOREIGN_OWNER');
  return {
    campaignId,
    gmLocalContextId,
    masterProfileId: context.masterProfileId,
    ownerDeviceId: context.ownerDeviceId,
    verifier: proof.verifier,
    verifierSha256: proof.verifierSha256,
  };
}
export function readCampaignPrivateOwner(
  db: Database.Database,
  gmLocalContextId: string,
  campaignId: string,
): CampaignPrivateOwner {
  const privateOwner = readCampaignOwnerBinding(db, gmLocalContextId, campaignId);
  const { payload } = campaignPayload(db, campaignId);
  const draft = readCampaignDraft(db, gmLocalContextId, payload.sourceCampaignDraftId);
  if (
    draft.status !== 'COMMITTED' ||
    draft.committedCampaignId !== campaignId ||
    !same(draft.values, {
      metadata: payload.metadata,
      host: payload.host,
      defaultFutureRollMode: payload.defaultFutureRollMode,
    })
  )
    return fail();
  return privateOwner;
}
function validateCreationJournal(
  row: Row,
  request: CampaignCreateRequest,
  receipt: CommandReceipt<CampaignCreateResult>,
  payload: StoredPausedCampaign,
  draft: StoredCampaignDraft,
): void {
  if (
    row['campaign_id'] !== payload.campaignId ||
    draft.status !== 'COMMITTED' ||
    draft.committedCampaignId !== payload.campaignId ||
    row['command_id'] !== request.commandId ||
    row['draft_id'] !== draft.campaignDraftId ||
    row['receipt_id'] !== receipt.receiptId ||
    receipt.commandId !== request.commandId ||
    receipt.receiptId !== payload.creationReceiptId ||
    payload.creationCommandId !== request.commandId ||
    payload.sourceCampaignDraftId !== draft.campaignDraftId ||
    !same(receipt.result, createResult(request, payload)) ||
    !same(receipt.revisions, zero()) ||
    draft.draftRevision !== request.payload.draftRevision + 1 ||
    draft.stateRevision !== request.expectedRevisions.stateRevision + 1 ||
    draft.projectionRevision !== request.expectedRevisions.projectionRevision + 1 ||
    draft.formId !== 'CMP-005' ||
    campaignCreationHash({ request, receipt }) !== row['journal_sha256']
  )
    return fail();
}
export function readCampaignCreationCommand(
  db: Database.Database,
  gmLocalContextId: string,
  commandId: string,
): StoredCampaignCreationCommand | null {
  readLocalGmContext(db, gmLocalContextId);
  const row = rowAt(db, 'campaign_creation_command', 'command_id', commandId);
  if (row === undefined) return null;
  const request = createRequest(parse(row['request_json']));
  const receipt = object(parse(row['receipt_json']), [
    'commandId',
    'receiptId',
    'result',
    'revisions',
  ]) as unknown as CommandReceipt<CampaignCreateResult>;
  if (request.payload.gmLocalContextId !== gmLocalContextId) return fail('FOREIGN_OWNER');
  const campaignId = text(row['campaign_id']);
  readCampaignPrivateOwner(db, gmLocalContextId, campaignId);
  const { payload } = campaignPayload(db, campaignId);
  const draft = readCampaignDraft(db, gmLocalContextId, request.payload.campaignDraftId);
  validateCreationJournal(row, request, receipt, payload, draft);
  return { request, receipt };
}

function consumeNativePromise(value: unknown): void {
  if (!types.isPromise(value)) return;
  try {
    void Promise.prototype.then.call(
      value,
      () => undefined,
      () => undefined,
    );
  } catch {
    // Trusted validators are not a sandbox for adversarial Promise species constructors.
  }
}
function validateOriginOwner(
  db: Database.Database,
  privateOwner: CampaignPrivateOwner,
  callback: CampaignPrivateOwnerValidator,
): void {
  if (
    typeof callback !== 'function' ||
    Object.prototype.toString.call(callback) === '[object AsyncFunction]'
  )
    return fail('INVALID_INPUT');
  const guard = () =>
    canonical([
      db.prepare('SELECT total_changes() AS changes').get(),
      db.pragma('schema_version', { simple: true }),
      db.pragma('user_version', { simple: true }),
    ]);
  const before = guard();
  let result: unknown;
  try {
    result = callback(privateOwner);
  } catch (error: unknown) {
    consumeNativePromise(error);
    return fail('INVALID_INPUT');
  }
  consumeNativePromise(result);
  // An empty COMMIT/ROLLBACK does not alter total_changes; check before any further read.
  if (!db.inTransaction || guard() !== before) return fail('SOURCE_CHANGED');
  if (result !== undefined) return fail('INVALID_INPUT');
}
function readOriginTransaction<T>(db: Database.Database, body: () => T): T {
  try {
    return db.inTransaction ? body() : db.transaction(body).deferred();
  } catch (error: unknown) {
    if (error instanceof CampaignCreationStoreError) throw error;
    // SQLite and device-identity diagnostics must not escape this private source boundary.
    return fail();
  }
}
function creationOrigin(
  db: Database.Database,
  gmLocalContextId: string,
  campaignId: string,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): CampaignCreationOrigin {
  const privateOwner = readCampaignOwnerBinding(db, gmLocalContextId, campaignId);
  const row =
    rowAt(db, 'campaign_creation_command', 'campaign_id', campaignId) ?? fail('NOT_FOUND');
  const request = createRequest(parse(row['request_json']));
  if (request.payload.gmLocalContextId !== gmLocalContextId) return fail('FOREIGN_OWNER');
  const receipt = object(parse(row['receipt_json']), [
    'commandId',
    'receiptId',
    'result',
    'revisions',
  ]) as unknown as CommandReceipt<CampaignCreateResult>;
  const result = object(receipt.result);
  const draft = readCampaignDraft(db, gmLocalContextId, request.payload.campaignDraftId);
  // Birth facts are reconstructed from immutable CREATE/sealed-draft evidence, never from
  // a later campaign vector or roster. Settings changes require a future explicit contract.
  const payload = pausedPayload({
    kind: 'PAUSED_CAMPAIGN',
    schemaVersion: 1,
    campaignId,
    sourceCampaignDraftId: draft.campaignDraftId,
    ...draft.values,
    status: 'PAUSED',
    createdAt: result['createdAt'],
    qrPayload: result['qrPayload'],
    baselineVersion: result['baselineVersion'],
    creationCommandId: request.commandId,
    creationReceiptId: receipt.receiptId,
  });
  validateCreationJournal(row, request, receipt, payload, draft);
  validateOriginOwner(db, privateOwner, validatePrivateOwner);
  return { payload, command: { request, receipt } };
}
/** Validates the immutable first CREATE independently of the current campaign checkpoint. */
export function readCampaignCreationOrigin(
  db: Database.Database,
  gmLocalContextId: string,
  campaignId: string,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): CampaignCreationOrigin {
  return readOriginTransaction(db, () =>
    creationOrigin(db, text(gmLocalContextId), text(campaignId), validatePrivateOwner),
  );
}
/** Host-system lookup by exact published campaign; no peer-supplied GM context or scan. */
export function readHostedCampaignCreationOrigin(
  db: Database.Database,
  campaignId: string,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): CampaignCreationOrigin {
  return readOriginTransaction(db, () => {
    const row =
      rowAt(db, 'campaign_private_owner', 'campaign_id', text(campaignId)) ?? fail('NOT_FOUND');
    return creationOrigin(db, text(row['context_id']), campaignId, validatePrivateOwner);
  });
}
export function readPausedCampaign(
  db: Database.Database,
  gmLocalContextId: string,
  campaignId: string,
): StoredPausedCampaign {
  readCampaignPrivateOwner(db, gmLocalContextId, campaignId);
  return campaignPayload(db, campaignId).payload;
}
export function readCampaignCreationLibraryState(
  db: Database.Database,
  gmLocalContextId: string,
): { draftCount: number; pausedCampaignCount: number } {
  readLocalGmContext(db, gmLocalContextId);
  const drafts = db
    .prepare('SELECT draft_id FROM campaign_draft WHERE context_id=? ORDER BY draft_id')
    .all(gmLocalContextId) as Row[];
  const campaigns = db
    .prepare(
      'SELECT campaign_id FROM campaign_private_owner WHERE context_id=? ORDER BY campaign_id',
    )
    .all(gmLocalContextId) as Row[];
  const draftCount = drafts.filter(
    (row) => readCampaignDraft(db, gmLocalContextId, text(row['draft_id'])).status === 'DRAFT',
  ).length;
  for (const row of campaigns) readPausedCampaign(db, gmLocalContextId, text(row['campaign_id']));
  return { draftCount, pausedCampaignCount: campaigns.length };
}
function createResult(
  request: CampaignCreateRequest,
  payload: StoredPausedCampaign,
): CampaignCreateResult {
  return {
    stage: 'CAMPAIGN_CREATE',
    gmLocalContextId: request.payload.gmLocalContextId,
    campaignDraftId: request.payload.campaignDraftId,
    campaignId: payload.campaignId,
    status: 'PAUSED',
    createdAt: payload.createdAt,
    creationReceiptId: payload.creationReceiptId,
    sourceDraftRevision: request.payload.draftRevision,
    sourceRevisions: { ...request.expectedRevisions },
    targetRevisions: { ...zero() },
    hostAddress: payload.host.hostAddress,
    hostPort: payload.host.hostPort,
    networkInterface: payload.host.networkInterface,
    activePlayerCapacity: payload.host.activePlayerCapacity,
    defaultFutureRollMode: payload.defaultFutureRollMode,
    qrPayload: payload.qrPayload,
    baselineVersion: payload.baselineVersion,
  };
}
export function commitCampaignCreation(
  db: Database.Database,
  input: CampaignCreationInput,
  validateSource: CampaignSourceValidator,
): StoredCampaignCreationCommand {
  if (db.inTransaction) return fail('INVALID_INPUT');
  const request = createRequest(input.request);
  const known = readCampaignCreationCommand(
    db,
    request.payload.gmLocalContextId,
    request.commandId,
  );
  const replayKnown = () =>
    transaction(db, () => {
      const replay =
        readCampaignCreationCommand(db, request.payload.gmLocalContextId, request.commandId) ??
        fail();
      if (!same(replay.request, request)) return fail('IDEMPOTENCY_CONFLICT');
      sourceGuard(
        db,
        validateSource,
        readCampaignDraft(db, request.payload.gmLocalContextId, request.payload.campaignDraftId),
        readLocalGmContext(db, request.payload.gmLocalContextId),
        'REPLAY',
      );
      return replay;
    });
  if (known !== null) return replayKnown();
  let expectedVerifierSha256: string | null = null;
  try {
    return commitNewCampaignCheckpoint(
      db,
      input.campaignId,
      (create) => {
        const draft = activeDraft(
          db,
          request.payload.gmLocalContextId,
          request.payload.campaignDraftId,
        );
        const context = readLocalGmContext(db, draft.gmLocalContextId);
        sourceGuard(db, validateSource, draft, context, 'APPLY');
        assertExpected(draft, request.payload.draftRevision, request.expectedRevisions);
        if (
          draft.formId !== 'CMP-005' ||
          draft.currentVerifier === null ||
          draft.currentVerifierSha256 === null
        )
          return fail('DRAFT_UNAVAILABLE');
        expectedVerifierSha256 = draft.currentVerifierSha256;
        const ids = [request.commandId, input.campaignId, input.receiptId];
        if (new Set(ids).size !== ids.length) return fail('IDEMPOTENCY_CONFLICT');
        for (const id of ids) assertUnusedId(db, id);
        const payload = pausedPayload({
          kind: 'PAUSED_CAMPAIGN',
          schemaVersion: 1,
          campaignId: input.campaignId,
          sourceCampaignDraftId: draft.campaignDraftId,
          ...draft.values,
          status: 'PAUSED',
          createdAt: input.createdAt,
          qrPayload: input.qrPayload,
          baselineVersion: input.baselineVersion,
          creationCommandId: request.commandId,
          creationReceiptId: input.receiptId,
        });
        create('PAUSED', canonical(payload));
        const privateOwner = {
          campaignId: input.campaignId,
          gmLocalContextId: draft.gmLocalContextId,
          masterProfileId: context.masterProfileId,
          ownerDeviceId: context.ownerDeviceId,
          verifierSha256: draft.currentVerifierSha256,
        };
        db.prepare('INSERT INTO campaign_private_owner VALUES (?,?,?,?,?,?,?)').run(
          input.campaignId,
          context.gmLocalContextId,
          context.masterProfileId,
          canonical(privateOwner),
          campaignCreationHash(privateOwner),
          canonical(draft.currentVerifier),
          draft.currentVerifierSha256,
        );
        sealDraft(db, draft, 'COMMITTED', input.campaignId);
        const receipt: CommandReceipt<CampaignCreateResult> = {
          commandId: request.commandId,
          receiptId: input.receiptId,
          result: createResult(request, payload),
          revisions: zero(),
        };
        db.prepare('INSERT INTO campaign_creation_command VALUES (?,?,?,?,?,?,?)').run(
          request.commandId,
          input.campaignId,
          draft.campaignDraftId,
          input.receiptId,
          canonical(request),
          canonical(receipt),
          campaignCreationHash({ request, receipt }),
        );
        return { request, receipt };
      },
      (command, checkpoint) => {
        const context = readLocalGmContext(db, request.payload.gmLocalContextId);
        const expected = readCampaignCreationCommand(
          db,
          context.gmLocalContextId,
          request.commandId,
        );
        if (!same(expected, command)) return fail('SOURCE_CHANGED');
        writeCursor(db, {
          gmLocalContextId: context.gmLocalContextId,
          ownerDeviceId: context.ownerDeviceId,
          kind: 'CAMPAIGN',
          formId: 'CMP-006',
          targetId: input.campaignId,
          revisions: zero(),
          targetSha256: campaignCreationHash(checkpoint),
        });
        readCampaignCreationCursor(db, context.gmLocalContextId);
        if (
          !same(
            readCampaignCreationCommand(db, context.gmLocalContextId, request.commandId),
            command,
          ) ||
          readCampaignPrivateOwner(db, context.gmLocalContextId, input.campaignId)
            .verifierSha256 !== expectedVerifierSha256
        )
          return fail('SOURCE_CHANGED');
      },
    ).result;
  } catch (error) {
    // Another writer may win after the optimistic read but before BEGIN IMMEDIATE.
    // Only its exact durable command can turn this failed initialization into a replay.
    if (
      readCampaignCreationCommand(db, request.payload.gmLocalContextId, request.commandId) !== null
    )
      return replayKnown();
    throw error;
  }
}

export interface GmRequestReviewScope {
  readonly ownerDeviceId: string;
  readonly gmLocalContextId: string;
  readonly campaignId: string;
}
/** Structural alias of the frozen v3 envelope; public wire codecs remain in shared. */
export interface GmRequestReviewDraftRequest {
  readonly messageType: 'network.gm-request-draft.replace';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly scope: {
    readonly gmLocalContextId: string;
    readonly campaignId: string;
    readonly sourceFormId: 'NET-017';
  };
  readonly expectedRevisions: RevisionTriple;
  readonly expectedRequestQueueRevision: number;
  readonly values: NetworkGmRequestDraftValues;
}
export interface GmRequestReviewView extends GmRequestReviewScope, RevisionTriple {
  readonly schemaVersion: 1;
  readonly formId: 'NET-017' | 'CMP-006';
  readonly requestQueueRevision: number;
  readonly values: NetworkGmRequestDraftValues;
  readonly returnContext: Extract<NetworkGmRequestReturnContext, { originFormId: 'CMP-006' }>;
  readonly snapshotSha256: string;
}
export interface GmRequestQueueFact {
  readonly requestId: string;
  readonly submitCommandId: string;
  readonly cancelCommandIdOrNull: string | null;
  readonly decisionCommandIds: readonly string[];
  readonly laneBindingCommandIdOrNull: string | null;
}
export interface GmRequestQueueEvidence {
  readonly requestQueueRevision: number;
  readonly requestFacts: readonly GmRequestQueueFact[];
  readonly visibleRequestIds: readonly string[];
  readonly queueEvidenceSha256: string;
}
export type GmRequestReviewMutation =
  | {
      readonly kind: 'NAV';
      readonly request: FormActionIntentV2Message;
      readonly initialQueueOrNull: GmRequestQueueEvidence | null;
    }
  | { readonly kind: 'DRAFT'; readonly request: GmRequestReviewDraftRequest }
  | {
      readonly kind: 'REQUEST_REFRESH';
      readonly causeCommandId: string;
      readonly causeReceiptId: string;
      readonly queue: GmRequestQueueEvidence;
    }
  | { readonly kind: 'CONNECTION_REFRESH'; readonly connectionFactsSha256: string };
export interface StoredGmRequestQueueEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly scope: GmRequestReviewScope;
  readonly eventIndex: number;
  readonly previousEventSha256OrNull: string | null;
  readonly mutation: GmRequestReviewMutation;
  readonly view: GmRequestReviewView;
  readonly changed: boolean;
  readonly recordSha256: string;
}
export interface GmRequestReviewViewState {
  readonly viewOrNull: GmRequestReviewView | null;
  readonly queueOrNull: GmRequestQueueEvidence | null;
  readonly connectionFactsSha256OrNull: string | null;
  readonly events: readonly StoredGmRequestQueueEvent[];
}

const queueScopeKeys = ['ownerDeviceId', 'gmLocalContextId', 'campaignId'] as const;
function queueObject(value: unknown, keys: readonly string[]): Row {
  const result = object(value, keys);
  const prototype: unknown = Object.getPrototypeOf(result);
  if (prototype !== Object.prototype && prototype !== null) return fail('INVALID_INPUT');
  if (Reflect.ownKeys(result).length !== keys.length) return fail('INVALID_INPUT');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(result, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value'))
      return fail('INVALID_INPUT');
  }
  return result;
}
const queueHash = (value: unknown): string => {
  const result = text(value);
  return /^[0-9a-f]{64}$/.test(result) ? result : fail();
};
function queueScope(value: unknown): GmRequestReviewScope {
  const row = queueObject(value, queueScopeKeys);
  return {
    ownerDeviceId: text(row['ownerDeviceId']),
    gmLocalContextId: text(row['gmLocalContextId']),
    campaignId: text(row['campaignId']),
  };
}
function queueValues(value: unknown): NetworkGmRequestDraftValues {
  const row = queueObject(value, ['selectedRequestIdOrNull', 'decisionReason']);
  if (typeof row['decisionReason'] !== 'string') return fail('INVALID_INPUT');
  return {
    selectedRequestIdOrNull:
      row['selectedRequestIdOrNull'] === null ? null : text(row['selectedRequestIdOrNull']),
    decisionReason: row['decisionReason'],
  };
}
function queueEvidence(value: unknown): GmRequestQueueEvidence {
  const row = queueObject(value, [
    'requestQueueRevision',
    'requestFacts',
    'visibleRequestIds',
    'queueEvidenceSha256',
  ]);
  if (!Array.isArray(row['requestFacts']) || !Array.isArray(row['visibleRequestIds']))
    return fail();
  const ids = new Set<string>();
  const commands = new Set<string>();
  let requestQueueRevision = 0;
  const requestFacts = row['requestFacts'].map((entry: unknown): GmRequestQueueFact => {
    const fact = queueObject(entry, [
      'requestId',
      'submitCommandId',
      'cancelCommandIdOrNull',
      'decisionCommandIds',
      'laneBindingCommandIdOrNull',
    ]);
    if (!Array.isArray(fact['decisionCommandIds']) || fact['decisionCommandIds'].length > 2)
      return fail();
    const requestId = text(fact['requestId']);
    if (ids.has(requestId)) return fail();
    ids.add(requestId);
    const result = {
      requestId,
      submitCommandId: text(fact['submitCommandId']),
      cancelCommandIdOrNull:
        fact['cancelCommandIdOrNull'] === null ? null : text(fact['cancelCommandIdOrNull']),
      decisionCommandIds: fact['decisionCommandIds'].map((id: unknown) => text(id)),
      laneBindingCommandIdOrNull:
        fact['laneBindingCommandIdOrNull'] === null
          ? null
          : text(fact['laneBindingCommandIdOrNull']),
    };
    if (result.cancelCommandIdOrNull !== null && result.decisionCommandIds.length !== 0)
      return fail();
    for (const id of [
      result.submitCommandId,
      result.cancelCommandIdOrNull,
      ...result.decisionCommandIds,
      result.laneBindingCommandIdOrNull,
    ]) {
      if (id === null) continue;
      if (commands.has(id)) return fail();
      commands.add(id);
      requestQueueRevision = next(requestQueueRevision);
    }
    return result;
  });
  if (
    !same(
      requestFacts.map((fact) => fact.requestId),
      [...ids].sort(),
    )
  )
    return fail();
  const visibleRequestIds = requestFacts
    .filter((fact) => fact.cancelCommandIdOrNull === null)
    .map((fact) => fact.requestId);
  const queueEvidenceSha256 = campaignCreationHash(requestFacts);
  if (
    count(row['requestQueueRevision']) !== requestQueueRevision ||
    !same(row['visibleRequestIds'], visibleRequestIds) ||
    row['queueEvidenceSha256'] !== queueEvidenceSha256
  )
    return fail();
  return { requestQueueRevision, requestFacts, visibleRequestIds, queueEvidenceSha256 };
}
function queueNav(value: unknown): FormActionIntentV2Message {
  const row = queueObject(value, [
    'messageType',
    'protocolVersion',
    'actionKey',
    'expectedProjectionRevision',
    'navigationRequestId',
    'sourceFormId',
  ]);
  if (
    row['messageType'] !== 'navigation.form-action' ||
    row['protocolVersion'] !== 2 ||
    !(
      (row['sourceFormId'] === 'CMP-006' && row['actionKey'] === 'CMP-006::CTA::002') ||
      (row['sourceFormId'] === 'NET-017' && row['actionKey'] === 'NET-017::CTA::009')
    )
  )
    return fail('INVALID_INPUT');
  text(row['navigationRequestId']);
  count(row['expectedProjectionRevision']);
  return row as unknown as FormActionIntentV2Message;
}
function queueDraft(value: unknown): GmRequestReviewDraftRequest {
  const row = queueObject(value, [
    'messageType',
    'protocolVersion',
    'draftUpdateId',
    'scope',
    'expectedRevisions',
    'expectedRequestQueueRevision',
    'values',
  ]);
  const scope = queueObject(row['scope'], ['gmLocalContextId', 'campaignId', 'sourceFormId']);
  if (
    row['messageType'] !== 'network.gm-request-draft.replace' ||
    row['protocolVersion'] !== 3 ||
    scope['sourceFormId'] !== 'NET-017'
  )
    return fail('INVALID_INPUT');
  return {
    messageType: 'network.gm-request-draft.replace',
    protocolVersion: 3,
    draftUpdateId: text(row['draftUpdateId']),
    scope: {
      gmLocalContextId: text(scope['gmLocalContextId']),
      campaignId: text(scope['campaignId']),
      sourceFormId: 'NET-017',
    },
    expectedRevisions: exactRevisions(row['expectedRevisions']),
    expectedRequestQueueRevision: count(row['expectedRequestQueueRevision']),
    values: queueValues(row['values']),
  };
}
function queueMutation(value: unknown): GmRequestReviewMutation {
  const record = queueObject(value, Object.keys(object(value)));
  if (record['kind'] === 'NAV') {
    const row = queueObject(value, ['kind', 'request', 'initialQueueOrNull']);
    return {
      kind: 'NAV',
      request: queueNav(row['request']),
      initialQueueOrNull:
        row['initialQueueOrNull'] === null ? null : queueEvidence(row['initialQueueOrNull']),
    };
  }
  if (record['kind'] === 'DRAFT') {
    const row = queueObject(value, ['kind', 'request']);
    return { kind: 'DRAFT', request: queueDraft(row['request']) };
  }
  if (record['kind'] === 'REQUEST_REFRESH') {
    const row = queueObject(value, ['kind', 'causeCommandId', 'causeReceiptId', 'queue']);
    return {
      kind: 'REQUEST_REFRESH',
      causeCommandId: text(row['causeCommandId']),
      causeReceiptId: text(row['causeReceiptId']),
      queue: queueEvidence(row['queue']),
    };
  }
  const row = queueObject(value, ['kind', 'connectionFactsSha256']);
  if (row['kind'] !== 'CONNECTION_REFRESH') return fail('INVALID_INPUT');
  return {
    kind: 'CONNECTION_REFRESH',
    connectionFactsSha256: queueHash(row['connectionFactsSha256']),
  };
}
function queueView(
  scope: GmRequestReviewScope,
  value: Omit<GmRequestReviewView, 'snapshotSha256'>,
): GmRequestReviewView {
  if (
    !same(
      queueScope(scope),
      queueScope({
        ownerDeviceId: value.ownerDeviceId,
        gmLocalContextId: value.gmLocalContextId,
        campaignId: value.campaignId,
      }),
    )
  )
    return fail('FOREIGN_OWNER');
  return { ...value, snapshotSha256: campaignCreationHash(value) };
}
function queueViewDocument(
  value: GmRequestReviewView,
): Omit<GmRequestReviewView, 'snapshotSha256'> {
  const { snapshotSha256: _ignored, ...document } = value;
  return document;
}
function queueBase(
  db: Database.Database,
  scope: GmRequestReviewScope,
): { cursor: CampaignCreationCursor; receiptId: string } {
  const context = readLocalGmContext(db, scope.gmLocalContextId);
  if (context.ownerDeviceId !== scope.ownerDeviceId) return fail('FOREIGN_OWNER');
  const privateOwner = readCampaignOwnerBinding(db, scope.gmLocalContextId, scope.campaignId);
  const row =
    rowAt(db, 'campaign_creation_command', 'campaign_id', scope.campaignId) ?? fail('NOT_FOUND');
  const request = createRequest(parse(row['request_json']));
  const receipt = queueObject(parse(row['receipt_json']), [
    'commandId',
    'receiptId',
    'result',
    'revisions',
  ]) as unknown as CommandReceipt<CampaignCreateResult>;
  const draft = readCampaignDraft(db, scope.gmLocalContextId, request.payload.campaignDraftId);
  const result = object(receipt.result);
  const payload = pausedPayload({
    kind: 'PAUSED_CAMPAIGN',
    schemaVersion: 1,
    campaignId: scope.campaignId,
    sourceCampaignDraftId: draft.campaignDraftId,
    ...draft.values,
    status: 'PAUSED',
    createdAt: result['createdAt'],
    qrPayload: result['qrPayload'],
    baselineVersion: result['baselineVersion'],
    creationCommandId: request.commandId,
    creationReceiptId: receipt.receiptId,
  });
  validateCreationJournal(row, request, receipt, payload, draft);
  if (
    request.payload.gmLocalContextId !== scope.gmLocalContextId ||
    privateOwner.ownerDeviceId !== scope.ownerDeviceId
  )
    return fail('FOREIGN_OWNER');
  const checkpoint: CampaignCheckpoint = {
    campaignId: scope.campaignId,
    snapshotJson: JSON.stringify({
      campaign: {
        campaignId: scope.campaignId,
        lifecycleState: 'PAUSED',
        payloadJson: canonical(payload),
      },
      campaignCharacterCopies: [],
    }),
    ...zero(),
  };
  return {
    cursor: {
      gmLocalContextId: scope.gmLocalContextId,
      ownerDeviceId: scope.ownerDeviceId,
      kind: 'CAMPAIGN',
      formId: 'CMP-006',
      targetId: scope.campaignId,
      revisions: zero(),
      targetSha256: campaignCreationHash(checkpoint),
    },
    receiptId: receipt.receiptId,
  };
}
function assertQueueDelta(
  before: GmRequestQueueEvidence,
  after: GmRequestQueueEvidence,
  cause: string,
): void {
  if (after.requestQueueRevision !== next(before.requestQueueRevision)) return fail();
  const changed = after.requestFacts.filter(
    (fact) =>
      !same(fact, before.requestFacts.find((old) => old.requestId === fact.requestId) ?? null),
  );
  if (
    changed.length !== 1 ||
    before.requestFacts.some(
      (old) => !after.requestFacts.some((fact) => fact.requestId === old.requestId),
    )
  )
    return fail();
  const fact = changed[0] ?? fail();
  const previous = before.requestFacts.find((old) => old.requestId === fact.requestId);
  if (previous === undefined) {
    if (
      fact.submitCommandId !== cause ||
      fact.cancelCommandIdOrNull !== null ||
      fact.decisionCommandIds.length !== 0 ||
      fact.laneBindingCommandIdOrNull !== null
    )
      return fail();
    return;
  }
  const expected =
    fact.cancelCommandIdOrNull === cause && previous.cancelCommandIdOrNull === null
      ? { ...previous, cancelCommandIdOrNull: cause }
      : fact.laneBindingCommandIdOrNull === cause && previous.laneBindingCommandIdOrNull === null
        ? { ...previous, laneBindingCommandIdOrNull: cause }
        : { ...previous, decisionCommandIds: [...previous.decisionCommandIds, cause] };
  if (!same(expected, fact)) return fail();
}
interface QueueReduced {
  readonly view: GmRequestReviewView;
  readonly queue: GmRequestQueueEvidence;
  readonly connectionFactsSha256OrNull: string | null;
  readonly changed: boolean;
}
function reduceQueue(
  scope: GmRequestReviewScope,
  initial: ReturnType<typeof queueBase>,
  state: GmRequestReviewViewState,
  mutation: GmRequestReviewMutation,
): QueueReduced {
  const old = state.viewOrNull;
  if (old === null) {
    if (
      mutation.kind !== 'NAV' ||
      mutation.initialQueueOrNull === null ||
      mutation.request.sourceFormId !== 'CMP-006' ||
      mutation.request.expectedProjectionRevision !== initial.cursor.revisions.projectionRevision
    )
      return fail('STALE_REVISION');
    const queue = mutation.initialQueueOrNull;
    const view = queueView(scope, {
      schemaVersion: 1,
      ...scope,
      formId: 'NET-017',
      ...initial.cursor.revisions,
      projectionRevision: next(initial.cursor.revisions.projectionRevision),
      requestQueueRevision: queue.requestQueueRevision,
      values: { selectedRequestIdOrNull: null, decisionReason: '' },
      returnContext: {
        originFormId: 'CMP-006',
        campaignId: scope.campaignId,
        creationReceiptId: initial.receiptId,
      },
    });
    return { view, queue, connectionFactsSha256OrNull: null, changed: true };
  }
  let queue = state.queueOrNull ?? fail();
  let connectionFactsSha256OrNull = state.connectionFactsSha256OrNull;
  let document = queueViewDocument(old);
  let changed = true;
  if (mutation.kind === 'NAV') {
    if (
      mutation.initialQueueOrNull !== null ||
      mutation.request.sourceFormId !== old.formId ||
      mutation.request.expectedProjectionRevision !== old.projectionRevision
    )
      return fail('STALE_REVISION');
    document = {
      ...document,
      formId: old.formId === 'CMP-006' ? 'NET-017' : 'CMP-006',
      projectionRevision: next(old.projectionRevision),
    };
  } else if (mutation.kind === 'DRAFT') {
    const request = mutation.request;
    if (
      old.formId !== 'NET-017' ||
      request.scope.gmLocalContextId !== scope.gmLocalContextId ||
      request.scope.campaignId !== scope.campaignId
    )
      return fail('DRAFT_UNAVAILABLE');
    if (
      !same(request.expectedRevisions, revisions(old)) ||
      request.expectedRequestQueueRevision !== old.requestQueueRevision
    )
      return fail('STALE_REVISION');
    if (
      request.values.selectedRequestIdOrNull !== null &&
      !queue.visibleRequestIds.includes(request.values.selectedRequestIdOrNull)
    )
      return fail('INVALID_INPUT');
    const values =
      request.values.selectedRequestIdOrNull === old.values.selectedRequestIdOrNull
        ? request.values
        : { selectedRequestIdOrNull: request.values.selectedRequestIdOrNull, decisionReason: '' };
    changed = !same(values, old.values);
    document = {
      ...document,
      values,
      stateRevision: changed ? next(old.stateRevision) : old.stateRevision,
      projectionRevision: changed ? next(old.projectionRevision) : old.projectionRevision,
    };
  } else if (mutation.kind === 'REQUEST_REFRESH') {
    assertQueueDelta(queue, mutation.queue, mutation.causeCommandId);
    queue = mutation.queue;
    const values =
      old.values.selectedRequestIdOrNull !== null &&
      !queue.visibleRequestIds.includes(old.values.selectedRequestIdOrNull)
        ? { selectedRequestIdOrNull: null, decisionReason: '' }
        : old.values;
    document = {
      ...document,
      values,
      requestQueueRevision: queue.requestQueueRevision,
      stateRevision: next(old.stateRevision),
      projectionRevision: next(old.projectionRevision),
    };
  } else {
    changed = state.connectionFactsSha256OrNull !== mutation.connectionFactsSha256;
    connectionFactsSha256OrNull = mutation.connectionFactsSha256;
    document = {
      ...document,
      projectionRevision: changed ? next(old.projectionRevision) : old.projectionRevision,
    };
  }
  return { view: queueView(scope, document), queue, connectionFactsSha256OrNull, changed };
}
function queueSchema(db: Database.Database): void {
  if (!db.inTransaction) return fail('INVALID_INPUT');
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row;
  if (row['version'] !== 11) return fail();
  for (const table of DEVICE_REQUEST_REVIEW_TABLES)
    db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
}
/** Structural journal reader. Public request-store readers additionally verify every referenced request prefix. */
export function readGmRequestReviewViewStateInTransaction(
  db: Database.Database,
  value: GmRequestReviewScope,
): GmRequestReviewViewState {
  queueSchema(db);
  const scope = queueScope(value);
  owner(db, scope.ownerDeviceId);
  const initial = queueBase(db, scope);
  const rows = db
    .prepare(
      'SELECT * FROM gm_request_queue_event WHERE context_id=? AND campaign_id=? ORDER BY event_index',
    )
    .all(scope.gmLocalContextId, scope.campaignId) as Row[];
  const head = db
    .prepare('SELECT * FROM gm_request_queue_view WHERE context_id=? AND campaign_id=?')
    .get(scope.gmLocalContextId, scope.campaignId) as Row | undefined;
  let state: GmRequestReviewViewState = {
    viewOrNull: null,
    queueOrNull: null,
    connectionFactsSha256OrNull: null,
    events: [],
  };
  const events: StoredGmRequestQueueEvent[] = [];
  for (const [eventIndex, row] of rows.entries()) {
    const saved = queueObject(checkedJson(row), [
      'schemaVersion',
      'eventId',
      'scope',
      'eventIndex',
      'previousEventSha256OrNull',
      'mutation',
      'view',
      'changed',
    ]);
    const eventId = text(saved['eventId']);
    const mutation = queueMutation(saved['mutation']);
    if (
      saved['schemaVersion'] !== 1 ||
      saved['eventIndex'] !== eventIndex ||
      row['event_index'] !== eventIndex ||
      row['event_id'] !== eventId ||
      row['owner_device_id'] !== scope.ownerDeviceId ||
      row['kind'] !== mutation.kind ||
      !same(queueScope(saved['scope']), scope) ||
      saved['previousEventSha256OrNull'] !== (events.at(-1)?.recordSha256 ?? null)
    )
      return fail();
    if (
      (mutation.kind === 'NAV' && eventId !== mutation.request.navigationRequestId) ||
      (mutation.kind === 'DRAFT' && eventId !== mutation.request.draftUpdateId) ||
      (mutation.kind === 'REQUEST_REFRESH' &&
        eventId !==
          gmRequestReviewRefreshEventId(scope, mutation.causeCommandId, mutation.causeReceiptId))
    )
      return fail();
    const reduced = reduceQueue(scope, initial, state, mutation);
    if (!same(saved['view'], reduced.view) || saved['changed'] !== reduced.changed) return fail();
    const event: StoredGmRequestQueueEvent = {
      schemaVersion: 1,
      eventId,
      scope,
      eventIndex,
      previousEventSha256OrNull: events.at(-1)?.recordSha256 ?? null,
      mutation,
      view: reduced.view,
      changed: reduced.changed,
      recordSha256: text(row['record_sha256']),
    };
    events.push(event);
    state = {
      viewOrNull: reduced.view,
      queueOrNull: reduced.queue,
      connectionFactsSha256OrNull: reduced.connectionFactsSha256OrNull,
      events,
    };
  }
  if (head === undefined) {
    if (events.length !== 0) return fail();
  } else if (
    head['owner_device_id'] !== scope.ownerDeviceId ||
    head['head_event_id'] !== events.at(-1)?.eventId ||
    !same(checkedJson(head), state.viewOrNull)
  )
    return fail();
  return state;
}
export function gmRequestReviewRefreshEventId(
  scope: GmRequestReviewScope,
  causeCommandId: string,
  causeReceiptId: string,
): string {
  return `gm-request-refresh:${campaignCreationHash({ scope: queueScope(scope), causeCommandId: text(causeCommandId), causeReceiptId: text(causeReceiptId) })}`;
}
function queueCursor(view: GmRequestReviewView): CampaignCreationCursor {
  return {
    gmLocalContextId: view.gmLocalContextId,
    ownerDeviceId: view.ownerDeviceId,
    kind: 'QUEUE',
    formId: view.formId,
    targetId: view.campaignId,
    revisions: revisions(view),
    targetSha256: view.snapshotSha256,
  };
}
/** Called only by the full request writer, inside its IMMEDIATE transaction after source/ID guards. */
export function appendGmRequestReviewEventInTransaction(
  db: Database.Database,
  value: GmRequestReviewScope,
  input: { readonly eventId: string; readonly mutation: GmRequestReviewMutation },
): {
  readonly event: StoredGmRequestQueueEvent;
  readonly view: GmRequestReviewView;
  readonly rowWrites: number;
} {
  queueSchema(db);
  queueObject(input, ['eventId', 'mutation']);
  const scope = queueScope(value);
  const eventId = text(input.eventId);
  const mutation = queueMutation(input.mutation);
  if (
    (mutation.kind === 'NAV' && eventId !== mutation.request.navigationRequestId) ||
    (mutation.kind === 'DRAFT' && eventId !== mutation.request.draftUpdateId) ||
    (mutation.kind === 'REQUEST_REFRESH' &&
      eventId !==
        gmRequestReviewRefreshEventId(scope, mutation.causeCommandId, mutation.causeReceiptId))
  )
    return fail('INVALID_INPUT');
  const state = readGmRequestReviewViewStateInTransaction(db, scope);
  const known = state.events.find((event) => event.eventId === eventId);
  if (known !== undefined) {
    if (!same(known.mutation, mutation)) return fail('IDEMPOTENCY_CONFLICT');
    return { event: known, view: state.viewOrNull ?? fail(), rowWrites: 0 };
  }
  if (
    db.prepare('SELECT 1 FROM gm_request_queue_event WHERE event_id=?').get(eventId) !== undefined
  )
    return fail('IDEMPOTENCY_CONFLICT');
  const cursor = readCampaignCreationCursor(db, scope.gmLocalContextId);
  const initial = queueBase(db, scope);
  if (state.viewOrNull === null) {
    if (!same(cursor, initial.cursor)) return fail('STALE_REVISION');
  } else if (
    (mutation.kind === 'NAV' || mutation.kind === 'DRAFT') &&
    !same(cursor, queueCursor(state.viewOrNull))
  )
    return fail('DRAFT_UNAVAILABLE');
  const reduced = reduceQueue(scope, initial, state, mutation);
  const document = {
    schemaVersion: 1 as const,
    eventId,
    scope,
    eventIndex: state.events.length,
    previousEventSha256OrNull: state.events.at(-1)?.recordSha256 ?? null,
    mutation,
    view: reduced.view,
    changed: reduced.changed,
  };
  const event: StoredGmRequestQueueEvent = {
    ...document,
    recordSha256: campaignCreationHash(document),
  };
  const before = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  db.prepare('INSERT INTO gm_request_queue_event VALUES (?,?,?,?,?,?,?,?)').run(
    eventId,
    scope.gmLocalContextId,
    scope.campaignId,
    scope.ownerDeviceId,
    event.eventIndex,
    mutation.kind,
    canonical(document),
    event.recordSha256,
  );
  db.prepare(
    'INSERT INTO gm_request_queue_view VALUES (?,?,?,?,?,?) ON CONFLICT(context_id,campaign_id) DO UPDATE SET owner_device_id=excluded.owner_device_id,head_event_id=excluded.head_event_id,record_json=excluded.record_json,record_sha256=excluded.record_sha256',
  ).run(
    scope.gmLocalContextId,
    scope.campaignId,
    scope.ownerDeviceId,
    eventId,
    canonical(reduced.view),
    campaignCreationHash(reduced.view),
  );
  const selected =
    state.viewOrNull === null || (cursor.kind === 'QUEUE' && cursor.targetId === scope.campaignId);
  if (selected) writeCursor(db, queueCursor(reduced.view));
  const rowWrites = selected ? 3 : 2;
  if (
    !db.inTransaction ||
    (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n !== before + rowWrites
  )
    return fail('SOURCE_CHANGED');
  const saved = readGmRequestReviewViewStateInTransaction(db, scope);
  if (!same(saved.viewOrNull, reduced.view) || !same(saved.events.at(-1), event))
    return fail('SOURCE_CHANGED');
  if (
    selected &&
    !same(readCampaignCreationCursor(db, scope.gmLocalContextId), queueCursor(reduced.view))
  )
    return fail('SOURCE_CHANGED');
  return { event, view: reduced.view, rowWrites };
}
