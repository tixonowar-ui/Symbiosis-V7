import type Database from 'better-sqlite3';
import { types } from 'node:util';
import type { WorkflowCommandRequestMessage } from '@shared/wire-protocol.js';
import {
  admissionReviewIntentValue,
  admissionReviewMutationValue,
  admissionReviewStateValue,
  admissionGmClientBindingValue,
  admissionGmClientValue,
  type AdmissionGmViewReplaceV3Message,
  type AdmissionGmViewValues,
  type AdmissionReviewIntent,
  type AdmissionReviewMutation,
  type AdmissionReviewOpenPayload,
  type AdmissionReviewOpenReceipt,
  type AdmissionReviewState,
} from '@shared/campaign-admission-review.js';
import {
  readGmRequestReviewViewStateInTransaction,
  readGmAdmissionViewStateInTransaction,
  appendGmAdmissionViewEventInTransaction,
  appendGmAdmissionSourceInTransaction,
  assertGmAdmissionClientViewInTransaction,
  CampaignCreationStoreError,
  returnGmAdmissionViewInTransaction,
  admissionNavigation,
  readCampaignCreationCursor,
  type GmRequestReviewScope,
  type CampaignPrivateOwnerValidator,
} from './campaign-creation.js';
import {
  readGmRequestReviewSource,
  type GmRequestReviewSource,
  type HostedRequestReviewCurrent,
} from './network-device-request.js';
import {
  networkApplicationStorage as s,
  type NetworkStoreGuard,
} from './network-local-application.js';
import { CAMPAIGN_ADMISSION_TABLES } from './migrations/0012-campaign-admission.js';
import type { FormActionIntentV2Message } from '../shared/wire-v2-protocol.js';

export type AdmissionReviewOpenRequest = WorkflowCommandRequestMessage<
  'UI-CMD-ADMISSION-REVIEW-OPEN',
  AdmissionReviewOpenPayload
>;
export interface StoredAdmissionReviewOpen {
  readonly scope: GmRequestReviewScope;
  readonly request: AdmissionReviewOpenRequest;
  readonly receipt: AdmissionReviewOpenReceipt;
  readonly submittedBatchSha256: string;
  readonly initialState: AdmissionReviewState;
}
export interface AdmissionReviewEditRequest {
  readonly commandId: string;
  readonly admissionBatchId: string;
  readonly expectedReviewRevision: number;
  readonly intent: AdmissionReviewIntent;
}
export interface StoredAdmissionReviewEvent {
  readonly request: AdmissionReviewEditRequest;
  readonly clientRequestJsonOrNull: string | null;
  readonly mutation: AdmissionReviewMutation;
  readonly receiptId: string;
  readonly authoritativeGmActorId: string;
  readonly timestamp: string;
  readonly beforeStateSha256: string;
  readonly afterStateSha256: string;
  readonly reviewRevision: number;
}
export interface AdmissionReviewRead {
  readonly source: GmRequestReviewSource;
  readonly request: HostedRequestReviewCurrent;
  readonly open: StoredAdmissionReviewOpen;
  readonly events: readonly StoredAdmissionReviewEvent[];
  readonly current: AdmissionReviewState;
  readonly editable: boolean;
}
export interface AdmissionReviewRules {
  readonly verifyInitial: (
    request: HostedRequestReviewCurrent,
    initial: AdmissionReviewState,
  ) => void;
  readonly reduce: (
    request: HostedRequestReviewCurrent,
    before: AdmissionReviewState,
    mutation: AdmissionReviewMutation,
    receiptId: string,
  ) => AdmissionReviewState;
}
type Row = Record<string, unknown>;
/** Inspect the actual host callback before a guard wrapper can hide an AsyncFunction. */
function callSynchronous<Args extends readonly unknown[], Result>(
  callback: (...args: Args) => Result,
  ...args: Args
): Result {
  if (
    typeof callback !== 'function' ||
    Object.prototype.toString.call(callback) !== '[object Function]'
  )
    return s.fail('INVALID_INPUT');
  const result = callback(...args);
  if (types.isPromise(result)) {
    // Consume only native promises. Assimilating an arbitrary thenable would execute
    // its then() after rollback, outside this command's transaction.
    void Promise.prototype.then.call(
      result,
      () => undefined,
      () => undefined,
    );
    return s.fail('INVALID_INPUT');
  }
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    'then' in result
  ) {
    return s.fail('INVALID_INPUT');
  }
  return result;
}
function schema(db: Database.Database): void {
  s.schema(db);
  if (
    (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)['version'] !==
    12
  )
    return s.fail();
  for (const table of CAMPAIGN_ADMISSION_TABLES) db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
}
function openRequest(value: unknown): AdmissionReviewOpenRequest {
  const row = s.object(value, [
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
    row['messageType'] !== 'command.request' ||
    row['protocolVersion'] !== 1 ||
    row['commandKind'] !== 'workflow-command' ||
    row['role'] !== 'gm' ||
    row['workflowCommandId'] !== 'UI-CMD-ADMISSION-REVIEW-OPEN'
  )
    return s.fail();
  s.text(row['commandId']);
  s.vector(row['expectedRevisions']);
  const p = s.object(row['payload'], ['campaignId', 'requestId', 'requestRevision']);
  s.uuid(p['campaignId']);
  s.uuid(p['requestId']);
  s.integer(p['requestRevision']);
  return row as unknown as AdmissionReviewOpenRequest;
}
function editRequest(value: unknown): AdmissionReviewEditRequest {
  const row = s.object(value, [
    'commandId',
    'admissionBatchId',
    'expectedReviewRevision',
    'intent',
  ]);
  s.text(row['commandId']);
  s.uuid(row['admissionBatchId']);
  s.integer(row['expectedReviewRevision']);
  admissionReviewIntentValue(row['intent']);
  return row as unknown as AdmissionReviewEditRequest;
}
function intentOf(mutation: AdmissionReviewMutation): AdmissionReviewIntent {
  if (mutation.kind === 'ALLOCATE_ITEM')
    return { kind: mutation.kind, reviewCopyId: mutation.reviewCopyId };
  if (mutation.kind === 'ALLOCATE_GROUP') return { kind: mutation.kind };
  return mutation;
}
function verifyClientEditFields(
  request: AdmissionReviewEditRequest,
  json: string | null,
  before: AdmissionReviewState,
): void {
  if (json === null) return;
  const binding = admissionGmClientBindingValue(JSON.parse(json) as unknown),
    intent = request.intent,
    form = binding.sourceFormId;
  if (intent.kind === 'ALLOCATE_GROUP') {
    if (form !== 'NET-020') return s.fail('INVALID_INPUT');
  } else if (intent.kind === 'ALLOCATE_ITEM') {
    if (form !== 'NET-019') return s.fail('INVALID_INPUT');
  } else if (intent.kind === 'EDIT' && form !== 'NET-019') {
    const copy =
      before.copies.find((copy) => copy.reviewCopyId === intent.reviewCopyId) ?? s.fail();
    const untouched =
      form === 'GM-020'
        ? { ...intent.inputs, startingSkills: copy.inputs.startingSkills }
        : form === 'NET-020'
          ? {
              ...intent.inputs,
              groupAssignmentOrNull: copy.inputs.groupAssignmentOrNull,
              locationAssignmentOrNull: copy.inputs.locationAssignmentOrNull,
            }
          : s.fail('INVALID_INPUT');
    if (!s.same(untouched, copy.inputs)) return s.fail('INVALID_INPUT');
  }
}
function currentRequest(
  source: GmRequestReviewSource,
  requestId: string,
): HostedRequestReviewCurrent {
  return (
    source.queue.requests.find((q) => q.submittedRequest.requestId === requestId) ??
    s.fail('NOT_FOUND')
  );
}
function receipt(
  request: AdmissionReviewOpenRequest,
  source: GmRequestReviewSource,
  current: HostedRequestReviewCurrent,
  state: AdmissionReviewState,
  receiptId: string,
  timestamp: string,
): AdmissionReviewOpenReceipt {
  return {
    receiptId,
    commandId: request.commandId,
    workflowCommandId: 'UI-CMD-ADMISSION-REVIEW-OPEN',
    campaignId: source.scope.campaignId,
    requestId: request.payload.requestId,
    requestOwnerDeviceId: current.submittedRequest.principal.peerIdentity.ownerDeviceId,
    admissionBatchId: state.admissionBatchId,
    reviewCopies: state.copies.map((copy) => ({
      reviewCopyId: copy.reviewCopyId,
      sourceUuid: copy.sourceUuid,
      sourceSnapshotId: copy.sourceSnapshotId,
      snapshotChecksum: copy.snapshotChecksum,
    })),
    reviewRevision: 0,
    authoritativeGmActorId: source.privateOwner.masterProfileId,
    timestamp,
  };
}
function runInitial(
  db: Database.Database,
  rules: AdmissionReviewRules,
  request: HostedRequestReviewCurrent,
  state: AdmissionReviewState,
): void {
  s.guarded(
    db,
    () => callSynchronous(rules.verifyInitial, request, state),
    { request, state },
    'REPLAY',
  );
}
function runReduce(
  db: Database.Database,
  rules: AdmissionReviewRules,
  request: HostedRequestReviewCurrent,
  before: AdmissionReviewState,
  mutation: AdmissionReviewMutation,
  receiptId: string,
): AdmissionReviewState {
  let result: string | null = null;
  s.guarded(
    db,
    () => {
      result = s.canonical(callSynchronous(rules.reduce, request, before, mutation, receiptId));
    },
    { request, before, mutation, receiptId },
    'REPLAY',
  );
  const state = admissionReviewStateValue(JSON.parse(s.text(result)) as unknown);
  if (
    state.admissionBatchId !== before.admissionBatchId ||
    state.requestId !== before.requestId ||
    state.reviewRevision !== s.increment(before.reviewRevision) ||
    state.copies.length !== before.copies.length ||
    state.copies.some((copy, index) => {
      const old = before.copies[index]!;
      return (
        copy.reviewCopyId !== old.reviewCopyId ||
        copy.sourceUuid !== old.sourceUuid ||
        copy.sourceSnapshotId !== old.sourceSnapshotId ||
        copy.snapshotChecksum !== old.snapshotChecksum
      );
    })
  )
    return s.fail();
  return state;
}
interface IdentityRecord {
  readonly identityId: string;
  readonly kind: 'REVIEW_COPY' | 'REVIEW_ITEM' | 'GROUP_DRAFT';
  readonly reviewCopyIdOrNull: string | null;
}
function identities(state: AdmissionReviewState): readonly IdentityRecord[] {
  const result: IdentityRecord[] = state.copies.flatMap((copy) => [
    { identityId: copy.reviewCopyId, kind: 'REVIEW_COPY' as const, reviewCopyIdOrNull: null },
    ...copy.reviewItemIdentities.map((item) => ({
      identityId: item.reviewItemId,
      kind: 'REVIEW_ITEM' as const,
      reviewCopyIdOrNull: copy.reviewCopyId,
    })),
  ]);
  result.push(
    ...state.groupDraftIds.map((identityId) => ({
      identityId,
      kind: 'GROUP_DRAFT' as const,
      reviewCopyIdOrNull: null,
    })),
  );
  if (new Set(result.map((r) => r.identityId)).size !== result.length) return s.fail();
  return result;
}
function writeIdentities(
  db: Database.Database,
  state: AdmissionReviewState,
  old: readonly IdentityRecord[],
): number {
  const all = identities(state);
  if (old.some((identity) => !all.some((next) => s.same(next, identity))))
    return s.fail('SOURCE_CHANGED');
  const added = all.filter(
    (identity) => !old.some((previous) => previous.identityId === identity.identityId),
  );
  for (const identity of added) {
    s.assertUnused(db, identity.identityId);
    const record = { admissionBatchId: state.admissionBatchId, ...identity },
      json = s.canonical(record);
    db.prepare('INSERT INTO campaign_admission_identity VALUES (?,?,?,?,?)').run(
      identity.identityId,
      state.admissionBatchId,
      identity.kind,
      json,
      s.sha(json),
    );
  }
  return added.length;
}
function verifyIdentities(db: Database.Database, state: AdmissionReviewState): void {
  const rows = db
      .prepare('SELECT * FROM campaign_admission_identity WHERE admission_batch_id=?')
      .all(state.admissionBatchId) as Row[],
    expected = identities(state);
  if (rows.length !== expected.length) return s.fail();
  for (const identity of expected) {
    const row = rows.find((r) => r['identity_id'] === identity.identityId) ?? s.fail();
    if (
      row['kind'] !== identity.kind ||
      !s.same(s.checked(row), { admissionBatchId: state.admissionBatchId, ...identity })
    )
      return s.fail();
  }
}
function readInTransaction(
  db: Database.Database,
  source: GmRequestReviewSource,
  batchId: string,
  rules: AdmissionReviewRules,
): AdmissionReviewRead {
  schema(db);
  const row =
      s.at(db, 'campaign_admission_batch', 'admission_batch_id', s.uuid(batchId)) ??
      s.fail('NOT_FOUND'),
    raw = s.object(s.checked(row), [
      'scope',
      'request',
      'receipt',
      'submittedBatchSha256',
      'initialState',
    ]);
  if (
    !s.same(raw['scope'], source.scope) ||
    row['owner_device_id'] !== source.scope.ownerDeviceId ||
    row['context_id'] !== source.scope.gmLocalContextId ||
    row['campaign_id'] !== source.scope.campaignId
  )
    return s.fail('FOREIGN_OWNER');
  const request = openRequest(raw['request']),
    initial = admissionReviewStateValue(raw['initialState']),
    q = currentRequest(source, request.payload.requestId),
    r = s.object(raw['receipt']);
  if (
    request.payload.campaignId !== source.scope.campaignId ||
    request.payload.requestId !== initial.requestId ||
    row['request_id'] !== initial.requestId ||
    row['open_command_id'] !== request.commandId ||
    row['open_receipt_id'] !== r['receiptId'] ||
    initial.admissionBatchId !== batchId ||
    initial.reviewRevision !== 0 ||
    raw['submittedBatchSha256'] !== q.submittedRequest.batch.batchSha256
  )
    return s.fail();
  const expectedReceipt = receipt(
    request,
    source,
    q,
    initial,
    s.uuid(r['receiptId']),
    s.text(r['timestamp']),
  );
  if (!s.same(r, expectedReceipt)) return s.fail();
  const accepted = q.proof.decisions.find(
    (d) => d.requestRevision === request.payload.requestRevision,
  );
  if (accepted?.afterRequestStatus !== 'IN_REVIEW') return s.fail();
  const views = readGmRequestReviewViewStateInTransaction(db, source.scope).events;
  if (
    !views.some(
      (event) =>
        event.view.formId === 'NET-017' &&
        event.view.values.selectedRequestIdOrNull === request.payload.requestId &&
        s.same(s.vectorOf(event.view), request.expectedRevisions),
    )
  )
    return s.fail();
  const candidates = q.submittedRequest.batch.candidates;
  if (
    initial.copies.length !== candidates.length ||
    initial.copies.some(
      (c, i) =>
        c.sourceUuid !== candidates[i]!.descriptor.sourceUuid ||
        c.sourceSnapshotId !== candidates[i]!.descriptor.sourceSnapshotId ||
        c.snapshotChecksum !== candidates[i]!.descriptor.sourceChecksum,
    )
  )
    return s.fail();
  runInitial(db, rules, q, initial);
  let current = initial,
    head = request.commandId;
  const events: StoredAdmissionReviewEvent[] = [];
  const rows = db
    .prepare(
      'SELECT * FROM campaign_admission_event WHERE admission_batch_id=? ORDER BY event_index',
    )
    .all(batchId) as Row[];
  for (const [index, eventRow] of rows.entries()) {
    const rawEvent = s.object(s.checked(eventRow), [
        'request',
        'clientRequestJsonOrNull',
        'mutation',
        'receiptId',
        'authoritativeGmActorId',
        'timestamp',
        'beforeStateSha256',
        'afterStateSha256',
        'reviewRevision',
      ]),
      edit = editRequest(rawEvent['request']),
      mutation = admissionReviewMutationValue(rawEvent['mutation']),
      id = s.uuid(rawEvent['receiptId']);
    s.text(rawEvent['timestamp']);
    if (
      eventRow['event_index'] !== index + 1 ||
      eventRow['command_id'] !== edit.commandId ||
      eventRow['receipt_id'] !== id ||
      eventRow['kind'] !== mutation.kind ||
      edit.admissionBatchId !== batchId ||
      edit.expectedReviewRevision !== current.reviewRevision ||
      !s.same(edit.intent, intentOf(mutation)) ||
      rawEvent['authoritativeGmActorId'] !== source.privateOwner.masterProfileId ||
      rawEvent['beforeStateSha256'] !== s.sha(s.canonical(current))
    )
      return s.fail();
    verifyClientEditFields(
      edit,
      rawEvent['clientRequestJsonOrNull'] === null
        ? null
        : s.text(rawEvent['clientRequestJsonOrNull']),
      current,
    );
    current = runReduce(db, rules, q, current, mutation, id);
    if (
      rawEvent['afterStateSha256'] !== s.sha(s.canonical(current)) ||
      rawEvent['reviewRevision'] !== current.reviewRevision
    )
      return s.fail();
    events.push(rawEvent as unknown as StoredAdmissionReviewEvent);
    head = edit.commandId;
  }
  const cached = s.at(db, 'campaign_admission_head', 'admission_batch_id', batchId) ?? s.fail();
  if (
    cached['head_command_id'] !== head ||
    cached['event_index'] !== events.length ||
    !s.same(s.checked(cached), current)
  )
    return s.fail();
  verifyIdentities(db, current);
  const terminal = s.at(db, 'campaign_admission_gm_decision', 'admission_batch_id', batchId);
  if (
    cached['terminal_command_id'] !== (terminal?.['command_id'] ?? null) ||
    cached['terminal_record_sha256'] !== (terminal?.['record_sha256'] ?? null)
  )
    return s.fail();
  return {
    source,
    request: q,
    open: {
      scope: source.scope,
      request,
      receipt: expectedReceipt,
      submittedBatchSha256: q.submittedRequest.batch.batchSha256,
      initialState: initial,
    },
    events,
    current,
    editable:
      q.requestStatus === 'IN_REVIEW' &&
      q.requestRevision === request.payload.requestRevision &&
      terminal === undefined,
  };
}

/** Terminal storage composes the verified immutable working prefix in its own transaction. */
export const admissionReviewStorage = {
  assertClientView,
  callSynchronous,
  readInTransaction,
  openInTransaction,
  /** The owning write verified all unchanged source rows; its checkpoint is not sealed yet. */
  withCurrentPresentation(db: Database.Database, review: AdmissionReviewRead): AdmissionReviewRead {
    const scope = review.open.scope;
    const state = readGmRequestReviewViewStateInTransaction(db, scope);
    readGmAdmissionViewStateInTransaction(db, scope);
    return {
      ...review,
      source: {
        ...review.source,
        viewOrNull: state.viewOrNull,
        connectionFactsSha256OrNull: state.connectionFactsSha256OrNull,
        cursor: readCampaignCreationCursor(db, scope.gmLocalContextId),
      },
    };
  },
};
function assertClientView(
  db: Database.Database,
  scope: GmRequestReviewScope,
  json: string | null,
): void {
  try {
    assertGmAdmissionClientViewInTransaction(db, scope, json);
  } catch (error: unknown) {
    if (error instanceof CampaignCreationStoreError) {
      if (
        error.code === 'STALE_REVISION' ||
        error.code === 'FOREIGN_OWNER' ||
        error.code === 'INVALID_INPUT'
      )
        return s.fail(error.code);
      if (error.code === 'DRAFT_UNAVAILABLE') return s.fail('UNAVAILABLE');
    }
    throw error;
  }
}
export function readAdmissionReview(
  db: Database.Database,
  scope: GmRequestReviewScope,
  batchId: string,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionReviewRules,
): AdmissionReviewRead {
  return s.read(db, scope.ownerDeviceId, () =>
    readInTransaction(db, readGmRequestReviewSource(db, scope, validate), batchId, rules),
  );
}
function openInTransaction(
  db: Database.Database,
  scope: GmRequestReviewScope,
  value: {
    readonly request: AdmissionReviewOpenRequest;
    readonly receiptId: string;
    readonly timestamp: string;
  },
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionReviewRules,
  prepare: (request: HostedRequestReviewCurrent) => AdmissionReviewState,
  guard: NetworkStoreGuard<GmRequestReviewSource>,
): Readonly<{ kind: 'CREATED' | 'REPLAYED' | 'RECOVERED'; review: AdmissionReviewRead }> {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const input = s.input(() => s.object(value, ['request', 'receiptId', 'timestamp'])),
    request = s.input(() => openRequest(JSON.parse(s.canonical(input['request'])) as unknown)),
    receiptValue = input['receiptId'],
    timestampValue = input['timestamp'];
  return s.safe(() => {
    schema(db);
    const source = readGmRequestReviewSource(db, scope, validate),
      knownCommand = s.at(db, 'campaign_admission_batch', 'open_command_id', request.commandId);
    if (knownCommand !== undefined) {
      const review = readInTransaction(
        db,
        source,
        s.text(knownCommand['admission_batch_id']),
        rules,
      );
      if (!s.same(review.open.request, request)) return s.fail('IDEMPOTENCY_CONFLICT');
      s.guarded(db, guard, source, 'REPLAY');
      return { kind: 'REPLAYED' as const, review };
    }
    // A new OPEN may recover an existing workspace, but it cannot reuse another command's ID.
    s.assertUnused(db, request.commandId);
    const view = source.viewOrNull,
      q = currentRequest(source, request.payload.requestId);
    if (
      request.payload.campaignId !== scope.campaignId ||
      source.cursor.kind !== 'QUEUE' ||
      source.cursor.targetId !== scope.campaignId ||
      view?.formId !== 'NET-017' ||
      view.values.selectedRequestIdOrNull !== request.payload.requestId ||
      !s.same(request.expectedRevisions, s.vectorOf(view)) ||
      q.requestStatus !== 'IN_REVIEW' ||
      q.requestRevision !== request.payload.requestRevision ||
      q.proof.laneProvenance === null
    )
      return s.fail('STALE_REVISION');
    const existing = s.at(db, 'campaign_admission_batch', 'request_id', request.payload.requestId);
    if (existing !== undefined) {
      const review = readInTransaction(db, source, s.text(existing['admission_batch_id']), rules);
      if (!review.editable) return s.fail('STALE_REVISION');
      s.guarded(db, guard, source, 'REPLAY');
      return { kind: 'RECOVERED' as const, review };
    }
    s.guarded(db, guard, source, 'APPLY');
    let prepared: string | null = null;
    s.guarded(
      db,
      () => {
        prepared = s.canonical(callSynchronous(prepare, q));
      },
      q,
      'APPLY',
    );
    const initial = admissionReviewStateValue(JSON.parse(s.text(prepared)) as unknown),
      receiptId = s.uuid(receiptValue),
      timestamp = s.text(timestampValue);
    if (initial.requestId !== request.payload.requestId || initial.reviewRevision !== 0)
      return s.fail('INVALID_INPUT');
    runInitial(db, rules, q, initial);
    const all = [
      request.commandId,
      receiptId,
      initial.admissionBatchId,
      ...identities(initial).map((identity) => identity.identityId),
    ];
    if (new Set(all).size !== all.length) return s.fail('IDEMPOTENCY_CONFLICT');
    for (const id of all) s.assertUnused(db, id);
    const record: StoredAdmissionReviewOpen = {
        scope,
        request,
        receipt: receipt(request, source, q, initial, receiptId, timestamp),
        submittedBatchSha256: q.submittedRequest.batch.batchSha256,
        initialState: initial,
      },
      json = s.canonical(record),
      stateJson = s.canonical(initial),
      before = s.changes(db);
    db.prepare('INSERT INTO campaign_admission_batch VALUES (?,?,?,?,?,?,?,?,?)').run(
      initial.admissionBatchId,
      scope.campaignId,
      request.payload.requestId,
      scope.ownerDeviceId,
      scope.gmLocalContextId,
      request.commandId,
      receiptId,
      json,
      s.sha(json),
    );
    const count = writeIdentities(db, initial, []);
    db.prepare('INSERT INTO campaign_admission_head VALUES (?,?,?,?,?,?,?)').run(
      initial.admissionBatchId,
      request.commandId,
      0,
      null,
      null,
      stateJson,
      s.sha(stateJson),
    );
    if (!db.inTransaction || s.changes(db) !== before + count + 2) return s.fail('SOURCE_CHANGED');
    const after = readGmRequestReviewSource(db, scope, validate),
      review = readInTransaction(db, after, initial.admissionBatchId, rules);
    s.guarded(db, guard, after, 'APPLY');
    return { kind: 'CREATED' as const, review };
  });
}
/** Public callers retain a top-level transaction; UI composition uses the same guarded writer. */
export function commitAdmissionReviewOpen(
  ...args: Parameters<typeof openInTransaction>
): ReturnType<typeof openInTransaction> {
  const [db] = args;
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  return s.safe(() => db.transaction(() => openInTransaction(...args)).immediate());
}
/** The first workspace and its presentation cursor are one atomic owner operation. */
export function commitAdmissionReviewOpenWithView(...args: Parameters<typeof openInTransaction>) {
  const [db, scope, value, validate, rules, prepare, guard] = args;
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const input = s.input(() => s.object(value, ['request', 'receiptId', 'timestamp'])),
    request = s.input(() => openRequest(JSON.parse(s.canonical(input['request'])) as unknown)),
    receiptValue = input['receiptId'],
    timestampValue = input['timestamp'],
    eventId = `gm-admission-enter:${request.commandId}`;
  return s.safe(() =>
    db
      .transaction(() => {
        const state = readGmAdmissionViewStateInTransaction(db, scope),
          known = state.events.find((event) => event.eventId === eventId);
        if (known !== undefined) {
          if (
            known.mutation.kind !== 'ENTER' ||
            known.mutation.clientRequestJson !== s.canonical(request)
          )
            return s.fail('IDEMPOTENCY_CONFLICT');
          const source = readGmRequestReviewSource(db, scope, validate),
            review = readInTransaction(db, source, known.mutation.admissionBatchId, rules);
          s.guarded(db, guard, source, 'REPLAY');
          return {
            kind: 'REPLAYED' as const,
            review,
            viewOrNull: state.viewOrNull,
            entryOrNull: known,
          };
        }
        const opened = openInTransaction(
          db,
          scope,
          { request, receiptId: s.text(receiptValue), timestamp: s.text(timestampValue) },
          validate,
          rules,
          prepare,
          guard,
        );
        // An older standalone OPEN is a receipt replay, not permission to move the current cursor.
        if (opened.kind === 'REPLAYED')
          return { ...opened, viewOrNull: state.viewOrNull, entryOrNull: null };
        const queue = readGmRequestReviewViewStateInTransaction(db, scope),
          prefix = queue.events.at(-1) ?? s.fail();
        const saved = appendGmAdmissionViewEventInTransaction(db, scope, {
          eventId,
          mutation: {
            kind: 'ENTER',
            admissionBatchId: opened.review.current.admissionBatchId,
            clientRequestJson: s.canonical(request),
            receiptId: s.uuid(receiptValue),
            timestamp: s.text(timestampValue),
            queuePrefix: { eventId: prefix.eventId, recordSha256: prefix.recordSha256 },
          },
        });
        const source = readGmRequestReviewSource(db, scope, validate),
          review = readInTransaction(db, source, opened.review.current.admissionBatchId, rules);
        s.guarded(db, guard, source, 'APPLY');
        return { kind: opened.kind, review, viewOrNull: saved.current, entryOrNull: saved.event };
      })
      .immediate(),
  );
}
/** Browser VALUES bind the batch as well as the technical view, including old exact replays. */
function detachedGmScope(value: GmRequestReviewScope): GmRequestReviewScope {
  return s.input(() => {
    const row = s.object(value, ['ownerDeviceId', 'gmLocalContextId', 'campaignId']);
    return {
      ownerDeviceId: s.uuid(row['ownerDeviceId']),
      gmLocalContextId: s.uuid(row['gmLocalContextId']),
      campaignId: s.uuid(row['campaignId']),
    };
  });
}
export function commitAdmissionViewValues(
  db: Database.Database,
  scopeValue: GmRequestReviewScope,
  value: AdmissionGmViewReplaceV3Message,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionReviewRules,
  validateValues: (review: AdmissionReviewRead, values: AdmissionGmViewValues) => void,
  guard: NetworkStoreGuard<AdmissionReviewRead>,
) {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const scope = detachedGmScope(scopeValue);
  const request = s.input(() => admissionGmClientValue(JSON.parse(s.canonical(value)) as unknown));
  if (
    request.messageType !== 'network.admission-view.replace' ||
    request.contextId !== scope.gmLocalContextId ||
    request.campaignId !== scope.campaignId
  )
    return s.fail('FOREIGN_OWNER');
  return s.safe(() =>
    db
      .transaction(() => {
        const state = readGmAdmissionViewStateInTransaction(db, scope),
          known = state.events.find((event) => event.eventId === request.draftUpdateId),
          boundView = known?.view ?? state.viewOrNull;
        if (boundView?.admissionBatchId !== request.admissionBatchId)
          return s.fail('FOREIGN_OWNER');
        if (
          known === undefined &&
          (!boundView.active ||
            boundView.formId !== request.sourceFormId ||
            !s.same(s.vectorOf(boundView), request.expectedRevisions))
        )
          return s.fail('STALE_REVISION');
        const before = readInTransaction(
          db,
          readGmRequestReviewSource(db, scope, validate),
          request.admissionBatchId,
          rules,
        );
        const mutation = {
          kind: 'VALUES' as const,
          updateId: request.draftUpdateId,
          sourceFormId: request.sourceFormId,
          expectedRevisions: request.expectedRevisions,
          values: request.values,
        };
        if (known !== undefined && !s.same(known.mutation, mutation))
          return s.fail('IDEMPOTENCY_CONFLICT');
        if (known === undefined) {
          const validation = {
            review: structuredClone(before),
            values: structuredClone(request.values),
          };
          s.guarded(
            db,
            () => callSynchronous(validateValues, validation.review, validation.values),
            validation,
            'APPLY',
          );
        }
        s.guarded(db, guard, before, known === undefined ? 'APPLY' : 'REPLAY');
        const saved = appendGmAdmissionViewEventInTransaction(db, scope, {
          eventId: request.draftUpdateId,
          mutation: {
            kind: 'VALUES',
            updateId: request.draftUpdateId,
            sourceFormId: request.sourceFormId,
            expectedRevisions: request.expectedRevisions,
            values: request.values,
          },
        });
        const after = readInTransaction(
          db,
          readGmRequestReviewSource(db, scope, validate),
          request.admissionBatchId,
          rules,
        );
        s.guarded(db, guard, after, saved.replayed ? 'REPLAY' : 'APPLY');
        return { ...saved, review: after };
      })
      .immediate(),
  );
}
/** Durable NAV and return bridges use the same full source guard as review commands. */
export function commitAdmissionViewNavigation(
  db: Database.Database,
  scopeValue: GmRequestReviewScope,
  request: FormActionIntentV2Message,
  returnToQueue: boolean,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionReviewRules,
  guard: NetworkStoreGuard<AdmissionReviewRead>,
) {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const scope = detachedGmScope(scopeValue);
  const input = s.input(() => admissionNavigation(JSON.parse(s.canonical(request)) as unknown));
  return s.safe(() =>
    db
      .transaction(() => {
        const state = readGmAdmissionViewStateInTransaction(db, scope),
          known = state.events.find((event) => event.eventId === input.navigationRequestId),
          batchId = (known?.view ?? state.viewOrNull)?.admissionBatchId ?? s.fail('UNAVAILABLE');
        if (
          known !== undefined &&
          (known.mutation.kind !== (returnToQueue ? 'RETURN' : 'NAV') ||
            !('request' in known.mutation) ||
            !s.same(known.mutation.request, input))
        )
          return s.fail('IDEMPOTENCY_CONFLICT');
        const before = readInTransaction(
          db,
          readGmRequestReviewSource(db, scope, validate),
          batchId,
          rules,
        );
        s.guarded(db, guard, before, known === undefined ? 'APPLY' : 'REPLAY');
        const saved = returnToQueue
          ? returnGmAdmissionViewInTransaction(db, scope, input)
          : appendGmAdmissionViewEventInTransaction(db, scope, {
              eventId: input.navigationRequestId,
              mutation: { kind: 'NAV', request: input },
            });
        const after = readInTransaction(
          db,
          readGmRequestReviewSource(db, scope, validate),
          batchId,
          rules,
        );
        s.guarded(db, guard, after, saved.replayed ? 'REPLAY' : 'APPLY');
        return { event: saved.event, replayed: saved.replayed, review: after };
      })
      .immediate(),
  );
}
export function commitAdmissionReviewEdit(
  db: Database.Database,
  scope: GmRequestReviewScope,
  value: {
    readonly request: AdmissionReviewEditRequest;
    readonly receiptId: string;
    readonly timestamp: string;
    readonly clientRequestJsonOrNull?: string | null;
  },
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionReviewRules,
  prepareMutation: (intent: AdmissionReviewIntent) => AdmissionReviewMutation,
  guard: NetworkStoreGuard<AdmissionReviewRead>,
): Readonly<{ event: StoredAdmissionReviewEvent; review: AdmissionReviewRead; replayed: boolean }> {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const input = s.input(() =>
      s.object(value, [
        'request',
        'receiptId',
        'timestamp',
        ...('clientRequestJsonOrNull' in value ? ['clientRequestJsonOrNull'] : []),
      ]),
    ),
    request = s.input(() => editRequest(JSON.parse(s.canonical(input['request'])) as unknown)),
    receiptValue = input['receiptId'],
    timestampValue = input['timestamp'],
    clientRequestJsonOrNull = s.input(() => {
      const raw = input['clientRequestJsonOrNull'];
      if (raw === undefined || raw === null) return null;
      const json = s.text(raw),
        parsed: unknown = JSON.parse(json),
        binding = admissionGmClientBindingValue(parsed);
      if (
        s.canonical(parsed) !== json ||
        binding.commandId !== request.commandId ||
        binding.contextId !== scope.gmLocalContextId ||
        binding.campaignId !== scope.campaignId ||
        binding.admissionBatchId !== request.admissionBatchId ||
        binding.reviewRevision !== request.expectedReviewRevision ||
        binding.decisionOrNull !== null ||
        !s.same(binding.intentOrNull, request.intent)
      )
        return s.fail('INVALID_INPUT');
      return json;
    });
  return s.safe(() =>
    db
      .transaction(() => {
        const source = readGmRequestReviewSource(db, scope, validate),
          review = readInTransaction(db, source, request.admissionBatchId, rules),
          known = review.events.find((event) => event.request.commandId === request.commandId);
        if (known !== undefined) {
          if (
            !s.same(known.request, request) ||
            known.clientRequestJsonOrNull !== clientRequestJsonOrNull
          )
            return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, review, 'REPLAY');
          return { event: known, review, replayed: true };
        }
        if (!review.editable || request.expectedReviewRevision !== review.current.reviewRevision)
          return s.fail('STALE_REVISION');
        assertClientView(db, scope, clientRequestJsonOrNull);
        verifyClientEditFields(request, clientRequestJsonOrNull, review.current);
        s.guarded(db, guard, review, 'APPLY');
        let prepared: string | null = null;
        s.guarded(
          db,
          () => {
            prepared = s.canonical(callSynchronous(prepareMutation, request.intent));
          },
          request,
          'APPLY',
        );
        const mutation = admissionReviewMutationValue(JSON.parse(s.text(prepared)) as unknown),
          receiptId = s.uuid(receiptValue),
          timestamp = s.text(timestampValue);
        if (!s.same(intentOf(mutation), request.intent)) return s.fail('INVALID_INPUT');
        s.assertUnused(db, request.commandId);
        s.assertUnused(db, receiptId);
        if (request.commandId === receiptId) return s.fail('IDEMPOTENCY_CONFLICT');
        const current = runReduce(db, rules, review.request, review.current, mutation, receiptId),
          record: StoredAdmissionReviewEvent = {
            request,
            clientRequestJsonOrNull,
            mutation,
            receiptId,
            timestamp,
            authoritativeGmActorId: source.privateOwner.masterProfileId,
            beforeStateSha256: s.sha(s.canonical(review.current)),
            afterStateSha256: s.sha(s.canonical(current)),
            reviewRevision: current.reviewRevision,
          },
          json = s.canonical(record),
          stateJson = s.canonical(current),
          before = s.changes(db);
        db.prepare('INSERT INTO campaign_admission_event VALUES (?,?,?,?,?,?,?)').run(
          request.commandId,
          receiptId,
          request.admissionBatchId,
          review.events.length + 1,
          mutation.kind,
          json,
          s.sha(json),
        );
        const count = writeIdentities(db, current, identities(review.current));
        const update = db
          .prepare(
            'UPDATE campaign_admission_head SET head_command_id=?,event_index=?,record_json=?,record_sha256=? WHERE admission_batch_id=? AND event_index=?',
          )
          .run(
            request.commandId,
            review.events.length + 1,
            stateJson,
            s.sha(stateJson),
            request.admissionBatchId,
            review.events.length,
          );
        if (update.changes !== 1 || !db.inTransaction || s.changes(db) !== before + count + 2)
          return s.fail('SOURCE_CHANGED');
        appendGmAdmissionSourceInTransaction(db, scope, {
          kind: 'REVIEW_EDIT',
          admissionBatchId: request.admissionBatchId,
          commandId: request.commandId,
          recordSha256: s.sha(json),
        });
        const fresh = readInTransaction(
          db,
          readGmRequestReviewSource(db, scope, validate),
          request.admissionBatchId,
          rules,
        );
        s.guarded(db, guard, fresh, 'APPLY');
        return { event: record, review: fresh, replayed: false };
      })
      .immediate(),
  );
}
