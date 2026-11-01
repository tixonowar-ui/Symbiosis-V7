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
import {
  ADMISSION_GM_VIEW_FORM_IDS,
  admissionGmViewValuesValue,
  admissionGmClientBindingValue,
  admissionReviewStateValue,
  type AdmissionGmViewFormId,
  type AdmissionGmViewValues,
  type AdmissionGmClientBinding,
} from '../shared/campaign-admission-review.js';
import type {
  NetworkGmRequestDraftValues,
  NetworkGmRequestReturnContext,
} from '../shared/network-application.js';
import { DEVICE_REQUEST_REVIEW_TABLES } from './migrations/0011-device-request-review.js';
import {
  CAMPAIGN_ADMISSION_IDENTITIES,
  CAMPAIGN_ADMISSION_TABLES,
} from './migrations/0012-campaign-admission.js';
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
  | {
      readonly kind: 'ADMISSION';
      readonly formId: AdmissionGmViewFormId;
      readonly targetId: string;
    }
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
/** Admission can change visibility; creation/draft receipts still require their original A=0. */
const presentationRevisions = (value: unknown): RevisionTriple => {
  const row = object(value);
  const result = {
    stateRevision: count(row['stateRevision']),
    projectionRevision: count(row['projectionRevision']),
    actorVisibilityRevision: count(row['actorVisibilityRevision']),
  };
  if (
    result.projectionRevision < result.stateRevision ||
    result.actorVisibilityRevision > result.stateRevision
  )
    return fail();
  return result;
};
const exactPresentationRevisions = (value: unknown): RevisionTriple =>
  presentationRevisions(object(value, revisionKeys));
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
    version === 10 || version === 11 || version === 12
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
    version === 11 || version === 12
      ? ([
          ['hosted_device_request_decision', ['command_id', 'receipt_id']],
          ['hosted_device_request_lane_binding', ['command_id', 'receipt_id']],
          ['local_network_lane_binding', ['command_id']],
          ['gm_request_queue_event', ['event_id']],
        ] as const)
      : [];
  const admission = version === 12 ? CAMPAIGN_ADMISSION_IDENTITIES : [];
  for (const [table, columns] of [...network, ...review, ...admission])
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
    revisions:
      parsed['kind'] === 'QUEUE' || parsed['kind'] === 'ADMISSION'
        ? exactPresentationRevisions(parsed['revisions'])
        : exactRevisions(parsed['revisions']),
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
    if (db.prepare('SELECT 1 FROM schema_migration WHERE version=12').get() !== undefined)
      readOriginTransaction(db, () =>
        readGmAdmissionViewStateInTransaction(db, {
          ownerDeviceId: context.ownerDeviceId,
          gmLocalContextId,
          campaignId: cursor.targetId,
        }),
      );
  } else if (cursor.kind === 'ADMISSION') {
    const state = readOriginTransaction(db, () =>
      readGmAdmissionViewStateInTransaction(db, {
        ownerDeviceId: context.ownerDeviceId,
        gmLocalContextId,
        campaignId: cursor.targetId,
      }),
    );
    if (state.viewOrNull?.active !== true || !same(cursor, admissionCursor(state.viewOrNull)))
      return fail();
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
/** Ownership evidence only; current readers must also verify CREATE origin and current checkpoint. */
export function readCampaignOwnerBinding(
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
const admissionCauseTables = {
  REVIEW_EDIT: 'campaign_admission_event',
  GM_DECISION: 'campaign_admission_gm_decision',
  PLAYER_DECISION: 'campaign_admission_player_decision',
} as const;
export interface GmAdmissionSourceCause {
  readonly kind: keyof typeof admissionCauseTables;
  readonly admissionBatchId: string;
  readonly commandId: string;
  readonly recordSha256: string;
}
function admissionCause(value: unknown): GmAdmissionSourceCause {
  const row = queueObject(value, ['kind', 'admissionBatchId', 'commandId', 'recordSha256']);
  const kind = row['kind'];
  if (kind !== 'REVIEW_EDIT' && kind !== 'GM_DECISION' && kind !== 'PLAYER_DECISION') return fail();
  return {
    kind,
    admissionBatchId: text(row['admissionBatchId']),
    commandId: text(row['commandId']),
    recordSha256: queueHash(row['recordSha256']),
  };
}
function admissionCauseEventId(scope: GmRequestReviewScope, cause: GmAdmissionSourceCause): string {
  return `gm-admission-source:${campaignCreationHash({ scope, cause })}`;
}
/** Immutable source-row proof only: the owning writer may not have sealed its checkpoint yet. */
function verifyAdmissionCause(
  db: Database.Database,
  scope: GmRequestReviewScope,
  cause: GmAdmissionSourceCause,
) {
  admissionBatchAnchor(db, scope, cause.admissionBatchId);
  const row = rowAt(db, admissionCauseTables[cause.kind], 'command_id', cause.commandId) ?? fail();
  const saved = checkedJson(row),
    request = object(saved['request']);
  const client =
    cause.kind === 'PLAYER_DECISION'
      ? null
      : admissionClientBinding(saved['clientRequestJsonOrNull']);
  if (
    client !== null &&
    (client.commandId !== cause.commandId ||
      client.contextId !== scope.gmLocalContextId ||
      client.campaignId !== scope.campaignId ||
      client.admissionBatchId !== cause.admissionBatchId ||
      (cause.kind === 'REVIEW_EDIT'
        ? client.reviewRevision !== request['expectedReviewRevision'] ||
          !same(client.intentOrNull, request['intent']) ||
          client.decisionOrNull !== null
        : !same(client.decisionOrNull, request) || client.intentOrNull !== null))
  )
    return fail();
  if (
    row['admission_batch_id'] !== cause.admissionBatchId ||
    row['record_sha256'] !== cause.recordSha256 ||
    request['commandId'] !== cause.commandId ||
    request['admissionBatchId'] !== cause.admissionBatchId
  )
    return fail();
  if (cause.kind === 'REVIEW_EDIT') {
    const revision = count(saved['reviewRevision']);
    if (
      revision !== row['event_index'] ||
      revision !== next(count(request['expectedReviewRevision'])) ||
      saved['receiptId'] !== row['receipt_id']
    )
      return fail();
    return {
      client,
      actorVisibilityChanged: false,
      reviewRevision: revision,
      checkpointRevisionOrNull: null,
    };
  }
  const receipt = object(saved['receipt']);
  if (
    !same(queueScope(saved['scope']), scope) ||
    row['campaign_id'] !== scope.campaignId ||
    request['campaignId'] !== scope.campaignId ||
    receipt['commandId'] !== cause.commandId ||
    receipt['receiptId'] !== row['receipt_id'] ||
    receipt['admissionBatchId'] !== cause.admissionBatchId ||
    receipt['campaignId'] !== scope.campaignId ||
    request['decision'] !== row['decision'] ||
    receipt['decision'] !== request['decision']
  )
    return fail();
  const accepted = request['decision'] === 'ACCEPT';
  if (!accepted && request['decision'] !== (cause.kind === 'GM_DECISION' ? 'REJECT' : 'DECLINE'))
    return fail();
  const actorVisibilityChanged = cause.kind === 'PLAYER_DECISION' || accepted;
  let checkpointRevisionOrNull: number | null = null;
  if (actorVisibilityChanged) {
    const checkpoint =
      rowAt(db, 'campaign_admission_checkpoint_event', 'command_id', cause.commandId) ?? fail();
    const proof = checkedJson(checkpoint);
    const kind =
      cause.kind === 'GM_DECISION' ? 'GM_ACCEPT' : accepted ? 'PLAYER_ACCEPT' : 'PLAYER_DECLINE';
    checkpointRevisionOrNull = next(count(request['expectedCampaignRevision']));
    if (
      checkpoint['campaign_id'] !== scope.campaignId ||
      proof['campaignId'] !== scope.campaignId ||
      checkpoint['admission_batch_id'] !== cause.admissionBatchId ||
      proof['admissionBatchId'] !== cause.admissionBatchId ||
      checkpoint['kind'] !== kind ||
      proof['kind'] !== kind ||
      proof['commandId'] !== cause.commandId ||
      proof['receiptId'] !== receipt['receiptId'] ||
      checkpoint['state_revision'] !== checkpointRevisionOrNull ||
      proof['stateRevision'] !== checkpointRevisionOrNull
    )
      return fail();
  }
  return {
    client,
    actorVisibilityChanged,
    reviewRevision: cause.kind === 'GM_DECISION' ? count(request['reviewRevision']) : null,
    checkpointRevisionOrNull,
  };
}
export type GmRequestReviewMutation =
  | { readonly kind: 'SOURCE_ADVANCE'; readonly cause: GmAdmissionSourceCause }
  | {
      readonly kind: 'ADMISSION_RETURN';
      readonly viewEventId: string;
      readonly viewEventSha256: string;
      readonly queuePrefix: AdmissionQueuePrefix;
      readonly revisions: RevisionTriple;
    }
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
    expectedRevisions: exactPresentationRevisions(row['expectedRevisions']),
    expectedRequestQueueRevision: count(row['expectedRequestQueueRevision']),
    values: queueValues(row['values']),
  };
}
function queueMutation(value: unknown): GmRequestReviewMutation {
  const record = queueObject(value, Object.keys(object(value)));
  if (record['kind'] === 'SOURCE_ADVANCE') {
    const row = queueObject(value, ['kind', 'cause']);
    return { kind: 'SOURCE_ADVANCE', cause: admissionCause(row['cause']) };
  }
  if (record['kind'] === 'ADMISSION_RETURN') {
    const row = queueObject(value, [
      'kind',
      'viewEventId',
      'viewEventSha256',
      'queuePrefix',
      'revisions',
    ]);
    return {
      kind: 'ADMISSION_RETURN',
      viewEventId: text(row['viewEventId']),
      viewEventSha256: queueHash(row['viewEventSha256']),
      queuePrefix: admissionPrefix(row['queuePrefix']),
      revisions: exactPresentationRevisions(row['revisions']),
    };
  }
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
  db: Database.Database,
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
  if (mutation.kind === 'SOURCE_ADVANCE') {
    const proof = verifyAdmissionCause(db, scope, mutation.cause);
    document = {
      ...document,
      stateRevision: next(old.stateRevision),
      projectionRevision: next(old.projectionRevision),
      actorVisibilityRevision: proof.actorVisibilityChanged
        ? next(old.actorVisibilityRevision)
        : old.actorVisibilityRevision,
    };
  } else if (mutation.kind === 'ADMISSION_RETURN') {
    const last = state.events.at(-1);
    if (
      last?.eventId !== mutation.queuePrefix.eventId ||
      last.recordSha256 !== mutation.queuePrefix.recordSha256 ||
      mutation.revisions.projectionRevision <= old.projectionRevision ||
      mutation.revisions.stateRevision < old.stateRevision ||
      mutation.revisions.actorVisibilityRevision < old.actorVisibilityRevision
    )
      return fail();
    document = { ...document, formId: 'NET-017', ...mutation.revisions };
  } else if (mutation.kind === 'NAV') {
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
      !same(request.expectedRevisions, presentationRevisions(old)) ||
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
  if (row['version'] !== 11 && row['version'] !== 12) return fail();
  for (const table of DEVICE_REQUEST_REVIEW_TABLES)
    db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  if (row['version'] === 12)
    for (const table of CAMPAIGN_ADMISSION_TABLES)
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
}
/** Structural journal reader. Public request-store readers additionally verify every referenced request prefix. */
export function readGmRequestReviewViewStateInTransaction(
  db: Database.Database,
  value: GmRequestReviewScope,
  pendingAdmissionReturnId?: string,
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
    if (
      mutation.kind === 'SOURCE_ADVANCE' &&
      eventId !== admissionCauseEventId(scope, mutation.cause)
    )
      return fail();
    const reduced = reduceQueue(db, scope, initial, state, mutation);
    if (mutation.kind === 'ADMISSION_RETURN')
      verifyAdmissionReturnBridge(db, scope, eventId, mutation, pendingAdmissionReturnId);
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
/** Closed row/hash coverage; never calls the full admission reader back into gmSource. */
export function verifyGmAdmissionSourceMirrorsInTransaction(
  db: Database.Database,
  value: GmRequestReviewScope,
): void {
  if (!db.inTransaction) return fail('INVALID_INPUT');
  const scope = queueScope(value);
  const events = readGmRequestReviewViewStateInTransaction(db, scope).events;
  const actual = new Map<string, GmAdmissionSourceCause>();
  for (const kind of Object.keys(admissionCauseTables) as (keyof typeof admissionCauseTables)[]) {
    const rows = db
      .prepare(
        `SELECT e.* FROM ${admissionCauseTables[kind]} e JOIN campaign_admission_batch b ON b.admission_batch_id=e.admission_batch_id WHERE b.campaign_id=?`,
      )
      .all(scope.campaignId) as Row[];
    for (const row of rows) {
      const cause: GmAdmissionSourceCause = {
        kind,
        admissionBatchId: text(row['admission_batch_id']),
        commandId: text(row['command_id']),
        recordSha256: queueHash(row['record_sha256']),
      };
      verifyAdmissionCause(db, scope, cause);
      if (actual.has(cause.commandId)) return fail();
      actual.set(cause.commandId, cause);
    }
  }
  const batches = new Map<string, { reviewRevision: number; gm: boolean; player: boolean }>();
  let checkpointRevision = 0;
  for (const event of events) {
    if (event.mutation.kind !== 'SOURCE_ADVANCE') continue;
    const cause = event.mutation.cause;
    if (!actual.has(cause.commandId) || !same(actual.get(cause.commandId), cause)) return fail();
    actual.delete(cause.commandId);
    const proof = verifyAdmissionCause(db, scope, cause);
    if (
      proof.client !== null &&
      db
        .prepare(
          'SELECT 1 FROM gm_admission_view_event WHERE event_id=? AND context_id=? AND campaign_id=? AND owner_device_id=?',
        )
        .get(
          `gm-admission-view-source:${event.eventId}`,
          scope.gmLocalContextId,
          scope.campaignId,
          scope.ownerDeviceId,
        ) === undefined
    )
      return fail();
    const batch = batches.get(cause.admissionBatchId) ?? {
      reviewRevision: 0,
      gm: false,
      player: false,
    };
    if (cause.kind === 'REVIEW_EDIT') {
      if (batch.gm || batch.player || proof.reviewRevision !== next(batch.reviewRevision))
        return fail();
      batch.reviewRevision = proof.reviewRevision;
    } else if (cause.kind === 'GM_DECISION') {
      if (batch.gm || batch.player || proof.reviewRevision !== batch.reviewRevision) return fail();
      batch.gm = true;
    } else {
      if (!batch.gm || batch.player) return fail();
      batch.player = true;
    }
    if (proof.checkpointRevisionOrNull !== null) {
      if (proof.checkpointRevisionOrNull !== next(checkpointRevision)) return fail();
      checkpointRevision = proof.checkpointRevisionOrNull;
    }
    batches.set(cause.admissionBatchId, batch);
  }
  if (actual.size !== 0) return fail();
}
/** Called after the domain rows are sealed and before the owning transaction may return. */
export function appendGmAdmissionSourceInTransaction(
  db: Database.Database,
  scope: GmRequestReviewScope,
  value: GmAdmissionSourceCause,
): void {
  const cause = admissionCause(admissionViewInput(value));
  verifyAdmissionCause(db, scope, cause);
  appendGmRequestReviewEventInTransaction(db, scope, {
    eventId: admissionCauseEventId(scope, cause),
    mutation: { kind: 'SOURCE_ADVANCE', cause },
  });
  verifyGmAdmissionSourceMirrorsInTransaction(db, scope);
}
function queueCursor(view: GmRequestReviewView): CampaignCreationCursor {
  return {
    gmLocalContextId: view.gmLocalContextId,
    ownerDeviceId: view.ownerDeviceId,
    kind: 'QUEUE',
    formId: view.formId,
    targetId: view.campaignId,
    revisions: presentationRevisions(view),
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
  const state = readGmRequestReviewViewStateInTransaction(
    db,
    scope,
    mutation.kind === 'ADMISSION_RETURN' ? mutation.viewEventId : undefined,
  );
  const known = state.events.find((event) => event.eventId === eventId);
  if (known !== undefined) {
    if (!same(known.mutation, mutation)) return fail('IDEMPOTENCY_CONFLICT');
    return { event: known, view: state.viewOrNull ?? fail(), rowWrites: 0 };
  }
  if (
    db.prepare('SELECT 1 FROM gm_request_queue_event WHERE event_id=?').get(eventId) !== undefined
  )
    return fail('IDEMPOTENCY_CONFLICT');
  const cursor =
    mutation.kind === 'ADMISSION_RETURN'
      ? admissionReturnCursor(db, scope, mutation)
      : readCampaignCreationCursor(db, scope.gmLocalContextId);
  const initial = queueBase(db, scope);
  if (state.viewOrNull === null) {
    if (!same(cursor, initial.cursor)) return fail('STALE_REVISION');
  } else if (
    (mutation.kind === 'NAV' || mutation.kind === 'DRAFT') &&
    !same(cursor, queueCursor(state.viewOrNull))
  )
    return fail('DRAFT_UNAVAILABLE');
  if (
    mutation.kind === 'SOURCE_ADVANCE' &&
    eventId !== admissionCauseEventId(scope, mutation.cause)
  )
    return fail('INVALID_INPUT');
  const admissionBefore =
    (mutation.kind === 'SOURCE_ADVANCE' || mutation.kind === 'REQUEST_REFRESH') &&
    db.prepare('SELECT 1 FROM schema_migration WHERE version=12').get() !== undefined
      ? readGmAdmissionViewStateInTransaction(db, scope)
      : null;
  const reduced = reduceQueue(db, scope, initial, state, mutation);
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
    mutation.kind === 'ADMISSION_RETURN' ||
    state.viewOrNull === null ||
    (cursor.kind === 'QUEUE' && cursor.targetId === scope.campaignId);
  if (selected) writeCursor(db, queueCursor(reduced.view));
  let rowWrites = selected ? 3 : 2;
  if (
    !db.inTransaction ||
    (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n !== before + rowWrites
  )
    return fail('SOURCE_CHANGED');
  if (admissionBefore?.viewOrNull !== null && admissionBefore !== null)
    rowWrites += appendAdmissionSourceView(db, scope, admissionBefore, event, cursor);
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

export interface GmAdmissionView extends GmRequestReviewScope, RevisionTriple {
  readonly schemaVersion: 1;
  readonly admissionBatchId: string;
  readonly formId: AdmissionGmViewFormId;
  readonly values: AdmissionGmViewValues;
  readonly active: boolean;
  readonly snapshotSha256: string;
}
function admissionClientBinding(value: unknown): AdmissionGmClientBinding | null {
  if (value === null) return null;
  const json = text(value),
    parsed: unknown = JSON.parse(json);
  if (canonical(parsed) !== json) return fail();
  return admissionGmClientBindingValue(parsed);
}
function assertAdmissionClientView(
  scope: GmRequestReviewScope,
  view: GmAdmissionView | null,
  client: AdmissionGmClientBinding,
): void {
  if (
    view === null ||
    !view.active ||
    client.contextId !== scope.gmLocalContextId ||
    client.campaignId !== scope.campaignId ||
    client.admissionBatchId !== view.admissionBatchId ||
    client.sourceFormId !== view.formId ||
    !same(client.expectedRevisions, presentationRevisions(view))
  )
    return fail('STALE_REVISION');
  const intent = client.intentOrNull;
  if (
    intent !== null &&
    intent.kind !== 'ALLOCATE_GROUP' &&
    intent.reviewCopyId !== view.values.selectedReviewCopyId
  )
    return fail('FOREIGN_OWNER');
  if (intent?.kind === 'WEAPON' && !same(intent.input, view.values.weaponDraftOrNull))
    return fail('STALE_REVISION');
  if (
    client.decisionOrNull?.decision === 'REJECT' &&
    client.decisionOrNull.reasonOrNull !== view.values.rejectionReason
  )
    return fail('STALE_REVISION');
}
/** Fresh browser commands require the selected durable view; historical replay uses its source mirror. */
export function assertGmAdmissionClientViewInTransaction(
  db: Database.Database,
  scope: GmRequestReviewScope,
  json: string | null,
): void {
  if (!db.inTransaction) return fail('INVALID_INPUT');
  const client = admissionClientBinding(json);
  if (client === null) return;
  const view = readGmAdmissionViewStateInTransaction(db, scope).viewOrNull;
  assertAdmissionClientView(scope, view, client);
  if (
    view === null ||
    !same(readCampaignCreationCursor(db, scope.gmLocalContextId), admissionCursor(view))
  )
    return fail('DRAFT_UNAVAILABLE');
}
interface AdmissionQueuePrefix {
  readonly eventId: string;
  readonly recordSha256: string;
}
export type GmAdmissionViewMutation =
  | { readonly kind: 'SOURCE_ADVANCE'; readonly queuePrefix: AdmissionQueuePrefix }
  | {
      readonly kind: 'ENTER_PUBLISHED';
      readonly admissionBatchId: string;
      readonly selectedReviewCopyId: string;
      readonly request: FormActionIntentV2Message;
      readonly publicationRecordSha256: string;
      readonly queuePrefix: AdmissionQueuePrefix;
    }
  | {
      readonly kind: 'ENTER';
      readonly admissionBatchId: string;
      readonly clientRequestJson: string;
      readonly receiptId: string;
      readonly timestamp: string;
      readonly queuePrefix: AdmissionQueuePrefix;
    }
  | { readonly kind: 'NAV'; readonly request: FormActionIntentV2Message }
  | {
      readonly kind: 'VALUES';
      readonly updateId: string;
      readonly sourceFormId: AdmissionGmViewFormId;
      readonly expectedRevisions: RevisionTriple;
      readonly values: AdmissionGmViewValues;
    }
  | {
      readonly kind: 'RETURN';
      readonly request: FormActionIntentV2Message;
      readonly queuePrefix: AdmissionQueuePrefix;
    };
export interface StoredGmAdmissionViewEvent {
  readonly eventId: string;
  readonly scope: GmRequestReviewScope;
  readonly eventIndex: number;
  readonly previousSha256OrNull: string | null;
  readonly mutation: GmAdmissionViewMutation;
  readonly view: GmAdmissionView;
  readonly recordSha256: string;
}
const admissionNavTargets: Readonly<Record<string, AdmissionGmViewFormId | 'NET-017'>> = {
  'NET-018::CTA::001': 'NET-017',
  'NET-018::CTA::002': 'NET-019',
  'NET-018::CTA::003': 'NET-020',
  'NET-018::CTA::004': 'NET-021',
  'NET-019::CTA::001': 'NET-017',
  'NET-019::CTA::002': 'NET-018',
  'NET-019::CTA::004': 'GM-019',
  'NET-019::CTA::005': 'GM-019',
  'NET-020::CTA::001': 'NET-017',
  'NET-020::CTA::002': 'NET-018',
  'NET-021::CTA::001': 'NET-017',
  'NET-021::CTA::002': 'NET-022',
  'NET-021::CTA::003': 'GM-020',
  'NET-021::CTA::004': 'NET-017',
  'NET-022::CTA::001': 'NET-021',
  'NET-022::CTA::002': 'NET-017',
  'GM-019::CTA::004': 'NET-019',
  'GM-020::CTA::001': 'NET-021',
};
function admissionForm(value: unknown): AdmissionGmViewFormId {
  const found = ADMISSION_GM_VIEW_FORM_IDS.find((form) => form === value);
  return found ?? fail('INVALID_INPUT');
}
/** Only JSON data crosses the presentation writer, before any shared parser reads its properties. */
function admissionViewInput(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || types.isProxy(value) || seen.has(value))
    return fail('INVALID_INPUT');
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype) &&
    Object.getPrototypeOf(value) !== null
  )
    return fail('INVALID_INPUT');
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value),
    result: Row = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (array && key === 'length') continue;
    const descriptor = typeof key === 'string' ? descriptors[key] : undefined;
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      return fail('INVALID_INPUT');
    Object.defineProperty(result, key, {
      value: admissionViewInput(descriptor.value, seen),
      enumerable: true,
    });
  }
  seen.delete(value);
  if (!array) return result;
  const length = count(descriptors['length']?.value);
  if (Object.keys(result).length !== length) return fail('INVALID_INPUT');
  return Array.from({ length }, (_, i) =>
    Object.hasOwn(result, String(i)) ? result[String(i)] : fail('INVALID_INPUT'),
  );
}
function admissionPrefix(value: unknown): AdmissionQueuePrefix {
  const row = queueObject(value, ['eventId', 'recordSha256']);
  return { eventId: text(row['eventId']), recordSha256: queueHash(row['recordSha256']) };
}
export function admissionNavigation(value: unknown): FormActionIntentV2Message {
  const row = queueObject(value, [
    'messageType',
    'protocolVersion',
    'navigationRequestId',
    'sourceFormId',
    'actionKey',
    'expectedProjectionRevision',
  ]);
  if (row['messageType'] !== 'navigation.form-action' || row['protocolVersion'] !== 2)
    return fail('INVALID_INPUT');
  const sourceFormId = admissionForm(row['sourceFormId']),
    actionKey = text(row['actionKey']);
  if (
    !actionKey.startsWith(sourceFormId + '::CTA::') ||
    admissionNavTargets[actionKey] === undefined
  )
    return fail('INVALID_INPUT');
  return {
    messageType: 'navigation.form-action',
    protocolVersion: 2,
    navigationRequestId: text(row['navigationRequestId']),
    sourceFormId,
    actionKey: actionKey as FormActionIntentV2Message['actionKey'],
    expectedProjectionRevision: count(row['expectedProjectionRevision']),
  };
}
function admissionMutation(value: unknown): GmAdmissionViewMutation {
  const row = object(admissionViewInput(value));
  if (row['kind'] === 'ENTER_PUBLISHED') {
    queueObject(row, [
      'kind',
      'admissionBatchId',
      'selectedReviewCopyId',
      'request',
      'publicationRecordSha256',
      'queuePrefix',
    ]);
    return {
      kind: 'ENTER_PUBLISHED',
      admissionBatchId: text(row['admissionBatchId']),
      selectedReviewCopyId: text(row['selectedReviewCopyId']),
      request: publishedAdmissionNavigation(row['request']),
      publicationRecordSha256: queueHash(row['publicationRecordSha256']),
      queuePrefix: admissionPrefix(row['queuePrefix']),
    };
  }
  if (row['kind'] === 'SOURCE_ADVANCE') {
    queueObject(row, ['kind', 'queuePrefix']);
    return { kind: 'SOURCE_ADVANCE', queuePrefix: admissionPrefix(row['queuePrefix']) };
  }
  if (row['kind'] === 'ENTER') {
    queueObject(row, [
      'kind',
      'admissionBatchId',
      'clientRequestJson',
      'receiptId',
      'timestamp',
      'queuePrefix',
    ]);
    admissionEnterRequest(text(row['clientRequestJson']));
    return {
      kind: 'ENTER',
      admissionBatchId: text(row['admissionBatchId']),
      clientRequestJson: text(row['clientRequestJson']),
      receiptId: text(row['receiptId']),
      timestamp: text(row['timestamp']),
      queuePrefix: admissionPrefix(row['queuePrefix']),
    };
  }
  if (row['kind'] === 'NAV' || row['kind'] === 'RETURN') {
    queueObject(
      row,
      row['kind'] === 'NAV' ? ['kind', 'request'] : ['kind', 'request', 'queuePrefix'],
    );
    const request = admissionNavigation(row['request']);
    return row['kind'] === 'NAV'
      ? { kind: 'NAV', request }
      : { kind: 'RETURN', request, queuePrefix: admissionPrefix(row['queuePrefix']) };
  }
  queueObject(row, ['kind', 'updateId', 'sourceFormId', 'expectedRevisions', 'values']);
  if (row['kind'] !== 'VALUES') return fail('INVALID_INPUT');
  return {
    kind: 'VALUES',
    updateId: text(row['updateId']),
    sourceFormId: admissionForm(row['sourceFormId']),
    expectedRevisions: exactPresentationRevisions(row['expectedRevisions']),
    values: admissionGmViewValuesValue(row['values']),
  };
}
function admissionEnterRequest(json: string) {
  const row = queueObject(parse(json), [
    'messageType',
    'protocolVersion',
    'commandKind',
    'workflowCommandId',
    'commandId',
    'role',
    'expectedRevisions',
    'payload',
  ]);
  if (
    canonical(row) !== json ||
    row['messageType'] !== 'command.request' ||
    row['protocolVersion'] !== 1 ||
    row['commandKind'] !== 'workflow-command' ||
    row['workflowCommandId'] !== 'UI-CMD-ADMISSION-REVIEW-OPEN' ||
    row['role'] !== 'gm'
  )
    return fail('INVALID_INPUT');
  const payload = queueObject(row['payload'], ['campaignId', 'requestId', 'requestRevision']);
  return {
    commandId: text(row['commandId']),
    expectedRevisions: exactPresentationRevisions(row['expectedRevisions']),
    campaignId: text(payload['campaignId']),
    requestId: text(payload['requestId']),
    requestRevision: count(payload['requestRevision']),
  };
}
const publishedAdmissionTargets = {
  'NET-017::CTA::001': 'NET-018',
  'NET-017::CTA::002': 'NET-019',
  'NET-017::CTA::003': 'NET-020',
  'NET-017::CTA::004': 'NET-021',
} as const;
function publishedAdmissionNavigation(value: unknown): FormActionIntentV2Message {
  const row = queueObject(value, [
    'messageType',
    'protocolVersion',
    'navigationRequestId',
    'sourceFormId',
    'actionKey',
    'expectedProjectionRevision',
  ]);
  if (
    row['messageType'] !== 'navigation.form-action' ||
    row['protocolVersion'] !== 2 ||
    row['sourceFormId'] !== 'NET-017' ||
    typeof row['actionKey'] !== 'string' ||
    !Object.hasOwn(publishedAdmissionTargets, row['actionKey'])
  )
    return fail('INVALID_INPUT');
  text(row['navigationRequestId']);
  count(row['expectedProjectionRevision']);
  return row as unknown as FormActionIntentV2Message;
}
function publishedAdmissionAnchor(
  db: Database.Database,
  scope: GmRequestReviewScope,
  mutation: Extract<GmAdmissionViewMutation, { kind: 'ENTER_PUBLISHED' }>,
): AdmissionGmViewFormId {
  const row =
    rowAt(db, 'campaign_admission_gm_decision', 'admission_batch_id', mutation.admissionBatchId) ??
    fail();
  const saved = checkedJson(row),
    request = object(saved['request']);
  if (
    row['decision'] !== 'ACCEPT' ||
    request['decision'] !== 'ACCEPT' ||
    !same(queueScope(saved['scope']), scope) ||
    row['record_sha256'] !== mutation.publicationRecordSha256 ||
    row['campaign_id'] !== scope.campaignId ||
    request['admissionBatchId'] !== mutation.admissionBatchId ||
    request['commandId'] !== row['command_id']
  )
    return fail();
  const cause: GmAdmissionSourceCause = {
    kind: 'GM_DECISION',
    admissionBatchId: mutation.admissionBatchId,
    commandId: text(row['command_id']),
    recordSha256: mutation.publicationRecordSha256,
  };
  verifyAdmissionCause(db, scope, cause);
  const prefix =
    rowAt(db, 'gm_request_queue_event', 'event_id', mutation.queuePrefix.eventId) ?? fail();
  const causeIndex = (value: GmAdmissionSourceCause): number => {
    verifyAdmissionCause(db, scope, value);
    const id = admissionCauseEventId(scope, value);
    const mirror = rowAt(db, 'gm_request_queue_event', 'event_id', id) ?? fail();
    const document = checkedJson(mirror);
    if (
      document['eventId'] !== id ||
      !same(queueScope(document['scope']), scope) ||
      !same(document['mutation'], { kind: 'SOURCE_ADVANCE', cause: value })
    )
      return fail();
    return count(mirror['event_index']);
  };
  const prefixIndex = count(prefix['event_index']);
  if (causeIndex(cause) > prefixIndex) return fail();
  if (!Array.isArray(saved['copies'])) return fail();
  const copies = saved['copies'].map((copy: unknown) => object(copy));
  let eligible = copies;
  // Only the immutable queue prefix defines the ingress lifecycle. A later player writer
  // may currently be between its domain row and companion append in this same transaction.
  const playerMirrors = db
    .prepare(
      "SELECT * FROM gm_request_queue_event WHERE context_id=? AND campaign_id=? AND event_index<=? AND kind='SOURCE_ADVANCE' AND json_extract(record_json,'$.mutation.cause.kind')='PLAYER_DECISION' AND json_extract(record_json,'$.mutation.cause.admissionBatchId')=?",
    )
    .all(scope.gmLocalContextId, scope.campaignId, prefixIndex, mutation.admissionBatchId) as Row[];
  if (playerMirrors.length > 1) return fail();
  if (playerMirrors.length === 1) {
    const priorCause = queueMutation(checkedJson(playerMirrors[0]!)['mutation']);
    if (priorCause.kind !== 'SOURCE_ADVANCE' || causeIndex(priorCause.cause) > prefixIndex)
      return fail();
    const player =
      rowAt(
        db,
        'campaign_admission_player_decision',
        'admission_batch_id',
        mutation.admissionBatchId,
      ) ?? fail();
    if (
      row['player_command_id'] !== player['command_id'] ||
      row['player_record_sha256'] !== player['record_sha256']
    )
      return fail();
    const receipt = object(checkedJson(player)['receipt']);
    if (!Array.isArray(receipt['copies'])) return fail();
    const results = receipt['copies'].map((copy: unknown) => object(copy));
    eligible = copies.filter((copy) =>
      results.some(
        (result) =>
          result['campaignCharacterId'] === copy['campaignCharacterId'] &&
          result['lifecycleState'] === 'PROPOSED',
      ),
    );
  }
  if (eligible[0]?.['reviewCopyId'] !== mutation.selectedReviewCopyId) return fail();
  return publishedAdmissionTargets[
    mutation.request.actionKey as keyof typeof publishedAdmissionTargets
  ];
}
function admissionQueueAnchor(
  db: Database.Database,
  scope: GmRequestReviewScope,
  prefix: AdmissionQueuePrefix,
): GmRequestReviewView {
  const row = rowAt(db, 'gm_request_queue_event', 'event_id', prefix.eventId) ?? fail();
  const event = object(checkedJson(row));
  if (
    row['record_sha256'] !== prefix.recordSha256 ||
    event['eventId'] !== prefix.eventId ||
    !same(queueScope(event['scope']), scope) ||
    row['context_id'] !== scope.gmLocalContextId ||
    row['campaign_id'] !== scope.campaignId ||
    row['owner_device_id'] !== scope.ownerDeviceId
  )
    return fail();
  const view = event['view'] as GmRequestReviewView;
  if (view.formId !== 'NET-017' || !same(view, queueView(scope, queueViewDocument(view))))
    return fail();
  exactPresentationRevisions(presentationRevisions(view));
  return view;
}
function admissionBatchAnchor(db: Database.Database, scope: GmRequestReviewScope, id: string) {
  const row = rowAt(db, 'campaign_admission_batch', 'admission_batch_id', id) ?? fail();
  const saved = object(checkedJson(row)),
    initial = admissionReviewStateValue(saved['initialState']),
    request = admissionEnterRequest(canonical(saved['request']));
  if (
    initial.admissionBatchId !== id ||
    initial.reviewRevision !== 0 ||
    !same(queueScope(saved['scope']), scope) ||
    row['context_id'] !== scope.gmLocalContextId ||
    row['campaign_id'] !== scope.campaignId ||
    row['owner_device_id'] !== scope.ownerDeviceId ||
    row['request_id'] !== initial.requestId ||
    request.requestId !== initial.requestId ||
    request.campaignId !== scope.campaignId ||
    row['open_command_id'] !== request.commandId
  )
    return fail();
  return { ...initial, requestRevision: request.requestRevision };
}
function admissionView(
  scope: GmRequestReviewScope,
  value: Omit<GmAdmissionView, 'snapshotSha256'>,
): GmAdmissionView {
  if (
    !same(
      queueScope({
        ownerDeviceId: value.ownerDeviceId,
        gmLocalContextId: value.gmLocalContextId,
        campaignId: value.campaignId,
      }),
      scope,
    )
  )
    return fail('FOREIGN_OWNER');
  return { ...value, snapshotSha256: campaignCreationHash(value) };
}
function reduceAdmissionView(
  db: Database.Database,
  scope: GmRequestReviewScope,
  old: GmAdmissionView | null,
  mutation: GmAdmissionViewMutation,
): GmAdmissionView {
  if (mutation.kind === 'SOURCE_ADVANCE') {
    if (old === null) return fail();
    const proof = admissionQueueAdvance(db, scope, mutation.queuePrefix);
    if (proof.client !== null) assertAdmissionClientView(scope, old, proof.client);
    const weaponCommitted = proof.client?.intentOrNull?.kind === 'WEAPON';
    const { snapshotSha256: _hash, ...previous } = old;
    return admissionView(scope, {
      ...previous,
      formId: weaponCommitted ? 'NET-019' : previous.formId,
      values: weaponCommitted ? { ...previous.values, weaponDraftOrNull: null } : previous.values,
      stateRevision: next(old.stateRevision),
      projectionRevision: next(old.projectionRevision),
      actorVisibilityRevision: proof.actorVisibilityChanged
        ? next(old.actorVisibilityRevision)
        : old.actorVisibilityRevision,
    });
  }
  if (mutation.kind === 'ENTER' || mutation.kind === 'ENTER_PUBLISHED') {
    if (old?.active === true) return fail('DRAFT_UNAVAILABLE');
    const queue = admissionQueueAnchor(db, scope, mutation.queuePrefix),
      batch = admissionBatchAnchor(db, scope, mutation.admissionBatchId);
    if (queue.values.selectedRequestIdOrNull !== batch.requestId) return fail('STALE_REVISION');
    let formId: AdmissionGmViewFormId = 'NET-018';
    let selectedReviewCopyId = batch.copies[0]!.reviewCopyId;
    if (mutation.kind === 'ENTER') {
      const request = admissionEnterRequest(mutation.clientRequestJson);
      if (
        request.campaignId !== scope.campaignId ||
        request.requestId !== batch.requestId ||
        request.requestRevision !== batch.requestRevision ||
        !same(request.expectedRevisions, presentationRevisions(queue))
      )
        return fail('STALE_REVISION');
    } else {
      if (mutation.request.expectedProjectionRevision !== queue.projectionRevision)
        return fail('STALE_REVISION');
      formId = publishedAdmissionAnchor(db, scope, mutation);
      selectedReviewCopyId = mutation.selectedReviewCopyId;
    }
    return admissionView(scope, {
      schemaVersion: 1,
      ...scope,
      admissionBatchId: batch.admissionBatchId,
      formId,
      active: true,
      values: {
        selectedReviewCopyId,
        rejectionReason: '',
        weaponDraftOrNull: null,
      },
      stateRevision: Math.max(queue.stateRevision, old?.stateRevision ?? 0),
      projectionRevision: next(Math.max(queue.projectionRevision, old?.projectionRevision ?? 0)),
      actorVisibilityRevision: Math.max(
        queue.actorVisibilityRevision,
        old?.actorVisibilityRevision ?? 0,
      ),
    });
  }
  if (old === null || !old.active) return fail('DRAFT_UNAVAILABLE');
  const { snapshotSha256: _hash, ...previous } = old;
  if (mutation.kind === 'VALUES') {
    if (
      old.formId !== mutation.sourceFormId ||
      !same(presentationRevisions(old), mutation.expectedRevisions)
    )
      return fail('STALE_REVISION');
    const batch = admissionBatchAnchor(db, scope, old.admissionBatchId);
    if (!batch.copies.some((copy) => copy.reviewCopyId === mutation.values.selectedReviewCopyId))
      return fail('FOREIGN_OWNER');
    if (old.formId !== 'NET-022' && old.values.rejectionReason !== mutation.values.rejectionReason)
      return fail('INVALID_INPUT');
    if (
      old.formId !== 'GM-019' &&
      !same(old.values.weaponDraftOrNull, mutation.values.weaponDraftOrNull) &&
      !(
        old.values.selectedReviewCopyId !== mutation.values.selectedReviewCopyId &&
        mutation.values.weaponDraftOrNull === null
      )
    )
      return fail('INVALID_INPUT');
    const changed = !same(old.values, mutation.values);
    return admissionView(scope, {
      ...previous,
      values: mutation.values,
      stateRevision: changed ? next(old.stateRevision) : old.stateRevision,
      projectionRevision: changed ? next(old.projectionRevision) : old.projectionRevision,
    });
  }
  const request = mutation.request,
    target = admissionNavTargets[request.actionKey];
  if (
    request.sourceFormId !== old.formId ||
    request.expectedProjectionRevision !== old.projectionRevision
  )
    return fail('STALE_REVISION');
  if (mutation.kind === 'RETURN') {
    if (target !== 'NET-017') return fail('INVALID_INPUT');
    const queue = admissionQueueAnchor(db, scope, mutation.queuePrefix);
    return admissionView(scope, {
      ...previous,
      active: false,
      stateRevision: Math.max(old.stateRevision, queue.stateRevision),
      projectionRevision: next(Math.max(old.projectionRevision, queue.projectionRevision)),
      actorVisibilityRevision: Math.max(old.actorVisibilityRevision, queue.actorVisibilityRevision),
    });
  }
  if (target === undefined || target === 'NET-017') return fail('INVALID_INPUT');
  return admissionView(scope, {
    ...previous,
    formId: target,
    projectionRevision: next(old.projectionRevision),
  });
}
function admissionCursor(view: GmAdmissionView): CampaignCreationCursor {
  return {
    kind: 'ADMISSION',
    gmLocalContextId: view.gmLocalContextId,
    ownerDeviceId: view.ownerDeviceId,
    targetId: view.campaignId,
    formId: view.formId,
    revisions: presentationRevisions(view),
    targetSha256: view.snapshotSha256,
  };
}
/** Leaf structural fold: no cursor or full gameplay reader may be called from this function. */
export function readGmAdmissionViewStateInTransaction(
  db: Database.Database,
  value: GmRequestReviewScope,
): { viewOrNull: GmAdmissionView | null; events: readonly StoredGmAdmissionViewEvent[] } {
  return readAdmissionViewState(db, value);
}
function readAdmissionViewState(
  db: Database.Database,
  value: GmRequestReviewScope,
  pendingReturnEventId?: string,
): { viewOrNull: GmAdmissionView | null; events: readonly StoredGmAdmissionViewEvent[] } {
  if (!db.inTransaction) return fail('INVALID_INPUT');
  const scope = queueScope(value);
  owner(db, scope.ownerDeviceId);
  const rows = db
    .prepare(
      'SELECT * FROM gm_admission_view_event WHERE context_id=? AND campaign_id=? ORDER BY event_index',
    )
    .all(scope.gmLocalContextId, scope.campaignId) as Row[];
  const head = db
    .prepare('SELECT * FROM gm_admission_view WHERE context_id=? AND campaign_id=?')
    .get(scope.gmLocalContextId, scope.campaignId) as Row | undefined;
  let view: GmAdmissionView | null = null;
  const events: StoredGmAdmissionViewEvent[] = [];
  for (const [index, row] of rows.entries()) {
    const saved = queueObject(checkedJson(row), [
      'eventId',
      'scope',
      'eventIndex',
      'previousSha256OrNull',
      'mutation',
      'view',
    ]);
    const mutation = admissionMutation(saved['mutation']),
      eventId = text(saved['eventId']);
    const openCommandId =
      mutation.kind === 'ENTER'
        ? admissionEnterRequest(mutation.clientRequestJson).commandId
        : null;
    if (
      row['open_command_id'] !== openCommandId ||
      row['open_receipt_id'] !== (mutation.kind === 'ENTER' ? mutation.receiptId : null) ||
      (openCommandId !== null && eventId !== `gm-admission-enter:${openCommandId}`)
    )
      return fail();
    if (mutation.kind === 'ENTER') {
      const batch =
        rowAt(db, 'campaign_admission_batch', 'admission_batch_id', mutation.admissionBatchId) ??
        fail();
      const originalReceipt = object(checkedJson(batch)['receipt']);
      if (
        mutation.receiptId === openCommandId ||
        (batch['open_command_id'] === openCommandId
          ? mutation.receiptId !== batch['open_receipt_id'] ||
            mutation.timestamp !== originalReceipt['timestamp']
          : mutation.receiptId === batch['open_receipt_id'])
      )
        return fail();
    }
    if (
      saved['eventIndex'] !== index ||
      row['event_index'] !== index ||
      row['event_id'] !== eventId ||
      row['kind'] !== mutation.kind ||
      row['owner_device_id'] !== scope.ownerDeviceId ||
      !same(queueScope(saved['scope']), scope) ||
      saved['previousSha256OrNull'] !== (events.at(-1)?.recordSha256 ?? null)
    )
      return fail();
    if (
      mutation.kind !== 'ENTER' &&
      mutation.kind !== 'SOURCE_ADVANCE' &&
      eventId !==
        (mutation.kind === 'VALUES' ? mutation.updateId : mutation.request.navigationRequestId)
    )
      return fail();
    if (
      mutation.kind === 'SOURCE_ADVANCE' &&
      eventId !== `gm-admission-view-source:${mutation.queuePrefix.eventId}`
    )
      return fail();
    view = reduceAdmissionView(db, scope, view, mutation);
    if (!same(view, saved['view'])) return fail();
    events.push({
      eventId,
      scope,
      eventIndex: index,
      previousSha256OrNull: events.at(-1)?.recordSha256 ?? null,
      mutation,
      view,
      recordSha256: text(row['record_sha256']),
    });
  }
  if (
    head === undefined
      ? events.length !== 0
      : head['owner_device_id'] !== scope.ownerDeviceId ||
        head['head_event_id'] !== events.at(-1)?.eventId ||
        !same(checkedJson(head), view)
  )
    return fail();
  for (const event of events) {
    if (event.mutation.kind !== 'RETURN') continue;
    const mirrorId = `gm-admission-return:${event.eventId}`,
      mirrors = db
        .prepare(
          "SELECT * FROM gm_request_queue_event WHERE event_id=? OR json_extract(record_json,'$.mutation.viewEventId')=?",
        )
        .all(mirrorId, event.eventId) as Row[];
    if (
      mirrors.length === 0 &&
      event.eventId === pendingReturnEventId &&
      event.eventIndex === events.length - 1
    ) {
      // Only the owning synchronous RETURN writer may observe its last unpaired append.
      const previous = events[event.eventIndex - 1]?.view,
        cursor = rowAt(db, 'campaign_creation_cursor', 'context_id', scope.gmLocalContextId);
      if (
        previous?.active !== true ||
        cursor === undefined ||
        !same(checkedJson(cursor), admissionCursor(previous))
      )
        return fail();
      continue;
    }
    if (mirrors.length !== 1) return fail();
    const mirror = mirrors[0]!,
      document = object(checkedJson(mirror)),
      mutation = queueMutation(document['mutation']);
    if (
      mirror['event_id'] !== mirrorId ||
      document['eventId'] !== mirrorId ||
      mirror['kind'] !== 'ADMISSION_RETURN' ||
      mirror['context_id'] !== scope.gmLocalContextId ||
      mirror['campaign_id'] !== scope.campaignId ||
      mirror['owner_device_id'] !== scope.ownerDeviceId ||
      !same(queueScope(document['scope']), scope) ||
      mutation.kind !== 'ADMISSION_RETURN' ||
      mutation.viewEventId !== event.eventId ||
      mutation.viewEventSha256 !== event.recordSha256 ||
      !same(mutation.queuePrefix, event.mutation.queuePrefix) ||
      !same(mutation.revisions, presentationRevisions(event.view)) ||
      document['previousEventSha256OrNull'] !== event.mutation.queuePrefix.recordSha256
    )
      return fail();
  }
  const first = events[0];
  if (first !== undefined) {
    if (first.mutation.kind !== 'ENTER' && first.mutation.kind !== 'ENTER_PUBLISHED') return fail();
    const firstPrefix = first.mutation.queuePrefix;
    const queueRows = db
      .prepare(
        'SELECT * FROM gm_request_queue_event WHERE context_id=? AND campaign_id=? ORDER BY event_index',
      )
      .all(scope.gmLocalContextId, scope.campaignId) as Row[];
    const prefixIndex = queueRows.findIndex((row) => row['event_id'] === firstPrefix.eventId);
    if (prefixIndex < 0 || queueRows[prefixIndex]?.['record_sha256'] !== firstPrefix.recordSha256)
      return fail();
    const advances = queueRows
      .slice(prefixIndex + 1)
      .filter((row) => row['kind'] === 'SOURCE_ADVANCE' || row['kind'] === 'REQUEST_REFRESH');
    const mirrors = events.filter((event) => event.mutation.kind === 'SOURCE_ADVANCE');
    if (
      advances.length !== mirrors.length ||
      advances.some((row, index) => {
        const mutation = mirrors[index]?.mutation;
        return (
          mutation?.kind !== 'SOURCE_ADVANCE' ||
          mutation.queuePrefix.eventId !== row['event_id'] ||
          mutation.queuePrefix.recordSha256 !== row['record_sha256']
        );
      })
    )
      return fail();
  }
  return { viewOrNull: view, events };
}
/** True only for an actual campaign visibility transition; queue refreshes never invent one. */
function admissionQueueAdvance(
  db: Database.Database,
  scope: GmRequestReviewScope,
  prefix: AdmissionQueuePrefix,
) {
  const row = rowAt(db, 'gm_request_queue_event', 'event_id', prefix.eventId) ?? fail();
  const saved = checkedJson(row),
    mutation = queueMutation(saved['mutation']);
  if (
    row['record_sha256'] !== prefix.recordSha256 ||
    row['context_id'] !== scope.gmLocalContextId ||
    row['campaign_id'] !== scope.campaignId ||
    row['owner_device_id'] !== scope.ownerDeviceId ||
    saved['eventId'] !== prefix.eventId ||
    !same(queueScope(saved['scope']), scope) ||
    row['kind'] !== mutation.kind
  )
    return fail();
  if (mutation.kind === 'REQUEST_REFRESH') return { actorVisibilityChanged: false, client: null };
  if (
    mutation.kind !== 'SOURCE_ADVANCE' ||
    prefix.eventId !== admissionCauseEventId(scope, mutation.cause)
  )
    return fail();
  return verifyAdmissionCause(db, scope, mutation.cause);
}
/** Both queue and admission appends are private halves of the same synchronous source write. */
function appendAdmissionSourceView(
  db: Database.Database,
  scope: GmRequestReviewScope,
  before: ReturnType<typeof readGmAdmissionViewStateInTransaction>,
  queueEvent: StoredGmRequestQueueEvent,
  cursor: CampaignCreationCursor,
): number {
  const previous = before.viewOrNull ?? fail();
  const eventId = `gm-admission-view-source:${queueEvent.eventId}`;
  assertUnusedId(db, eventId);
  const mutation: GmAdmissionViewMutation = {
    kind: 'SOURCE_ADVANCE',
    queuePrefix: { eventId: queueEvent.eventId, recordSha256: queueEvent.recordSha256 },
  };
  const view = reduceAdmissionView(db, scope, previous, mutation);
  const document = {
    eventId,
    scope,
    eventIndex: before.events.length,
    previousSha256OrNull: before.events.at(-1)?.recordSha256 ?? null,
    mutation,
    view,
  };
  const beforeWrites = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  db.prepare('INSERT INTO gm_admission_view_event VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    eventId,
    scope.gmLocalContextId,
    scope.campaignId,
    scope.ownerDeviceId,
    before.events.length,
    mutation.kind,
    null,
    null,
    canonical(document),
    campaignCreationHash(document),
  );
  db.prepare(
    'UPDATE gm_admission_view SET head_event_id=?,record_json=?,record_sha256=? WHERE context_id=? AND campaign_id=?',
  ).run(
    eventId,
    canonical(view),
    campaignCreationHash(view),
    scope.gmLocalContextId,
    scope.campaignId,
  );
  const selected = cursor.kind === 'ADMISSION' && cursor.targetId === scope.campaignId;
  if (selected) {
    if (!same(cursor, admissionCursor(previous))) return fail();
    writeCursor(db, admissionCursor(view));
  }
  const writes = selected ? 3 : 2;
  if (
    !db.inTransaction ||
    (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n !== beforeWrites + writes
  )
    return fail('SOURCE_CHANGED');
  const fresh = readGmAdmissionViewStateInTransaction(db, scope);
  if (
    !same(fresh.viewOrNull, view) ||
    fresh.events.at(-1)?.recordSha256 !== campaignCreationHash(document)
  )
    return fail('SOURCE_CHANGED');
  return writes;
}
/** Internal companion of the full source-owning transaction; it never changes gameplay state. */
export function appendGmAdmissionViewEventInTransaction(
  db: Database.Database,
  value: GmRequestReviewScope,
  input: { readonly eventId: string; readonly mutation: GmAdmissionViewMutation },
) {
  if (!db.inTransaction) return fail('INVALID_INPUT');
  queueObject(input, ['eventId', 'mutation']);
  const scope = queueScope(value),
    eventId = text(input.eventId),
    mutation = admissionMutation(input.mutation),
    state = readGmAdmissionViewStateInTransaction(db, scope);
  // Source companions can only be created by the queue writer after its guarded source mutation.
  if (mutation.kind === 'SOURCE_ADVANCE') return fail('INVALID_INPUT');
  const old = state.events.find((event) => event.eventId === eventId);
  if (old !== undefined) {
    if (!same(old.mutation, mutation)) return fail('IDEMPOTENCY_CONFLICT');
    return { event: old, current: state.viewOrNull ?? fail(), replayed: true };
  }
  assertUnusedId(db, eventId);
  const openCommandId =
    mutation.kind === 'ENTER' ? admissionEnterRequest(mutation.clientRequestJson).commandId : null;
  if (mutation.kind === 'ENTER') {
    if (eventId !== `gm-admission-enter:${String(openCommandId)}`) return fail('INVALID_INPUT');
    const batch =
      rowAt(db, 'campaign_admission_batch', 'admission_batch_id', mutation.admissionBatchId) ??
      fail();
    if (batch['open_command_id'] !== openCommandId) assertUnusedId(db, text(openCommandId));
    if (batch['open_command_id'] !== openCommandId) assertUnusedId(db, mutation.receiptId);
  }
  const cursor = readCampaignCreationCursor(db, scope.gmLocalContextId);
  if (mutation.kind === 'ENTER' || mutation.kind === 'ENTER_PUBLISHED') {
    const queue = readGmRequestReviewViewStateInTransaction(db, scope);
    if (
      queue.viewOrNull === null ||
      !same(cursor, queueCursor(queue.viewOrNull)) ||
      !same(mutation.queuePrefix, {
        eventId: queue.events.at(-1)?.eventId,
        recordSha256: queue.events.at(-1)?.recordSha256,
      })
    )
      return fail('STALE_REVISION');
  } else if (state.viewOrNull?.active !== true || !same(cursor, admissionCursor(state.viewOrNull)))
    return fail('DRAFT_UNAVAILABLE');
  if (mutation.kind === 'RETURN') {
    const queue = readGmRequestReviewViewStateInTransaction(db, scope);
    if (
      !same(mutation.queuePrefix, {
        eventId: queue.events.at(-1)?.eventId,
        recordSha256: queue.events.at(-1)?.recordSha256,
      })
    )
      return fail('STALE_REVISION');
  }
  const view = reduceAdmissionView(db, scope, state.viewOrNull, mutation),
    document = {
      eventId,
      scope,
      eventIndex: state.events.length,
      previousSha256OrNull: state.events.at(-1)?.recordSha256 ?? null,
      mutation,
      view,
    },
    recordSha256 = campaignCreationHash(document),
    beforeWrites = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  db.prepare('INSERT INTO gm_admission_view_event VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    eventId,
    scope.gmLocalContextId,
    scope.campaignId,
    scope.ownerDeviceId,
    state.events.length,
    mutation.kind,
    openCommandId,
    mutation.kind === 'ENTER' ? mutation.receiptId : null,
    canonical(document),
    recordSha256,
  );
  db.prepare(
    'INSERT INTO gm_admission_view VALUES (?,?,?,?,?,?) ON CONFLICT(context_id,campaign_id) DO UPDATE SET owner_device_id=excluded.owner_device_id,head_event_id=excluded.head_event_id,record_json=excluded.record_json,record_sha256=excluded.record_sha256',
  ).run(
    scope.gmLocalContextId,
    scope.campaignId,
    scope.ownerDeviceId,
    eventId,
    canonical(view),
    campaignCreationHash(view),
  );
  if (mutation.kind !== 'RETURN') writeCursor(db, admissionCursor(view));
  if (
    !db.inTransaction ||
    (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n !==
      beforeWrites + (mutation.kind === 'RETURN' ? 2 : 3)
  )
    return fail('SOURCE_CHANGED');
  const verified = readAdmissionViewState(
    db,
    scope,
    mutation.kind === 'RETURN' ? eventId : undefined,
  );
  if (!same(verified.viewOrNull, view) || verified.events.at(-1)?.recordSha256 !== recordSha256)
    return fail('SOURCE_CHANGED');
  return { event: { ...document, recordSha256 }, current: view, replayed: false };
}
function verifyAdmissionReturnBridge(
  db: Database.Database,
  scope: GmRequestReviewScope,
  eventId: string,
  mutation: Extract<GmRequestReviewMutation, { kind: 'ADMISSION_RETURN' }>,
  pendingReturnEventId?: string,
) {
  const state = readAdmissionViewState(db, scope, pendingReturnEventId),
    event = state.events.find((entry) => entry.eventId === mutation.viewEventId);
  if (
    event?.mutation.kind !== 'RETURN' ||
    event.recordSha256 !== mutation.viewEventSha256 ||
    eventId !== `gm-admission-return:${event.eventId}` ||
    !same(event.mutation.queuePrefix, mutation.queuePrefix) ||
    !same(presentationRevisions(event.view), mutation.revisions)
  )
    return fail();
  return { state, event };
}
function admissionReturnCursor(
  db: Database.Database,
  scope: GmRequestReviewScope,
  mutation: Extract<GmRequestReviewMutation, { kind: 'ADMISSION_RETURN' }>,
): CampaignCreationCursor {
  const { state, event } = verifyAdmissionReturnBridge(
      db,
      scope,
      `gm-admission-return:${mutation.viewEventId}`,
      mutation,
      mutation.viewEventId,
    ),
    previous = state.events[event.eventIndex - 1]?.view;
  if (
    state.events.at(-1)?.eventId !== event.eventId ||
    previous?.active !== true ||
    state.viewOrNull?.active !== false
  )
    return fail();
  const row = rowAt(db, 'campaign_creation_cursor', 'context_id', scope.gmLocalContextId) ?? fail();
  const expected = admissionCursor(previous);
  if (
    row['kind'] !== expected.kind ||
    row['target_id'] !== expected.targetId ||
    row['form_id'] !== expected.formId ||
    !same(checkedJson(row), expected)
  )
    return fail();
  return expected;
}
/** Both histories and the cursor change together; exact replay must never select a dormant view. */
export function returnGmAdmissionViewInTransaction(
  db: Database.Database,
  scope: GmRequestReviewScope,
  value: FormActionIntentV2Message,
) {
  if (!db.inTransaction) return fail('INVALID_INPUT');
  const request = admissionNavigation(admissionViewInput(value)),
    view = readGmAdmissionViewStateInTransaction(db, scope),
    known = view.events.find((event) => event.eventId === request.navigationRequestId);
  if (known !== undefined) {
    if (known.mutation.kind !== 'RETURN' || !same(known.mutation.request, request))
      return fail('IDEMPOTENCY_CONFLICT');
    const queue = readGmRequestReviewViewStateInTransaction(db, scope);
    const mirror = queue.events.find(
      (event) => event.eventId === `gm-admission-return:${known.eventId}`,
    );
    if (mirror?.mutation.kind !== 'ADMISSION_RETURN') return fail();
    verifyAdmissionReturnBridge(db, scope, mirror.eventId, mirror.mutation);
    return { event: known, current: queue.viewOrNull ?? fail(), replayed: true };
  }
  const queue = readGmRequestReviewViewStateInTransaction(db, scope),
    prefix = queue.events.at(-1) ?? fail();
  const saved = appendGmAdmissionViewEventInTransaction(db, scope, {
    eventId: request.navigationRequestId,
    mutation: {
      kind: 'RETURN',
      request,
      queuePrefix: { eventId: prefix.eventId, recordSha256: prefix.recordSha256 },
    },
  });
  const returned = appendGmRequestReviewEventInTransaction(db, scope, {
    eventId: `gm-admission-return:${saved.event.eventId}`,
    mutation: {
      kind: 'ADMISSION_RETURN',
      viewEventId: saved.event.eventId,
      viewEventSha256: saved.event.recordSha256,
      queuePrefix: { eventId: prefix.eventId, recordSha256: prefix.recordSha256 },
      revisions: presentationRevisions(saved.current),
    },
  });
  return { event: saved.event, current: returned.view, replayed: false };
}
