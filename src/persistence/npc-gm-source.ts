import { types } from 'node:util';
import type Database from 'better-sqlite3';
import { verifyNpcLifeRollFactBinding, type NpcLifeStateRollFact } from './npc-life-facts.js';
import type { DiseaseId } from '@generated/types/effects.js';
import {
  npcEventAllocations,
  npcLinkedSetBindingValue,
  npcRuntimeEffectAllocationSource,
  type NpcLinkedSetBinding,
  type NpcRuntimeEffectSource,
  type NpcChildAllocation,
  type NpcAttemptReadContext,
  type NpcCustomProfileBinding,
} from './npc-child-identities.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { FormActionIntentV2Message } from '@shared/wire-v2-protocol.js';
import {
  NPC_NAV_TARGETS,
  npcTechnicalRequestValue,
  npcWorkflowCommandRequestValue,
  type NpcSelectionReplaceRequest,
  type NpcEditorReplaceRequest,
  type NpcPreparationRequest,
} from '@shared/npc-command.js';
import {
  networkApplicationStorage as s,
  NetworkApplicationStoreError,
} from './network-local-application.js';
import {
  NPC_STAGES,
  npcGmSourceValue,
  npcAttemptEventEnvelopeValue,
  npcFrozenAttemptEventEnvelopeText,
  npcEventOrdinaryFact,
  npcEventLifeStateFact,
  verifyNpcOrdinaryFactBinding,
  type NpcOrdinaryAuthoringFact,
  npcOperationValue,
  npcScopeValue,
  npcSynchronousValidator,
  npcPendingCommitEvidenceValue,
  type NpcAttempt,
  type NpcAttemptEvent,
  type NpcGmSource,
  type NpcOperation,
  type NpcRequestReader,
  type NpcScope,
  type NpcStage,
  type NpcTarget,
  type NpcVersionRef,
  type NpcPendingCommitEvidence,
} from './npc-library-records.js';
import {
  readLocalGmContext,
  type GmRequestReviewView,
  type StoredGmRequestQueueEvent,
} from './campaign-creation.js';
import type {
  NpcAttemptPreparationContext,
  NpcCommitPreparationContext,
} from './npc-library-store.js';

type Row = Record<string, unknown>;
const operationHashStatements = new WeakMap<Database.Database, Database.Statement>();
/** Only TEXT hashes: connection integer defaults cannot alter a valid result. Rows remain fresh. */
function operationHashStatement(db: Database.Database): Database.Statement {
  let statement = operationHashStatements.get(db);
  // Preserve the native prepare error before evaluating a get argument on a closed connection.
  if (statement === undefined || !db.open) {
    statement = db.prepare('SELECT record_sha256 FROM npc_operation WHERE operation_id=?');
    operationHashStatements.set(db, statement);
  }
  return statement;
}
const digest = (value: unknown) => s.sha(s.canonical(value));
const equal = (a: unknown, b: unknown): void => {
  if (!s.same(a, b)) return s.fail();
};
export interface NpcGmAttemptRef {
  readonly npcDraftId: string;
  readonly candidateNpcUuid: string;
  readonly revision: number;
  readonly mode: 'CREATE_V1' | 'APPEND_N_PLUS_ONE';
  readonly targetOrNull: NpcTarget | null;
  readonly stage: NpcStage;
}
export interface NpcGmSelection {
  readonly npcUuid: string;
  readonly displayedVersion: number;
  readonly currentVersion: number;
}
export interface NpcInitialTimeReturnContext {
  readonly campaignId: string;
  readonly npcDraftId: string;
  readonly attemptRevision: number;
  readonly editMode: NpcGmAttemptRef['mode'];
  readonly versionBindingOrNull: NpcTarget | null;
  readonly returnFormId: 'NPC-016';
}
/** Absent before the first NPC entry; never synthesize this object in an old queue document. */
export interface NpcGmContext {
  readonly selectedNpcOrNull: NpcGmSelection | null;
  readonly attemptOrNull: NpcGmAttemptRef | null;
  readonly initialTimeReturnContextOrNull: NpcInitialTimeReturnContext | null;
}
export interface NpcSourceCause {
  readonly operationId: string;
  readonly recordSha256: string;
}
function target(value: unknown): NpcTarget | null {
  if (value === null) return null;
  const r = s.object(value, ['npcUuid', 'expectedCurrentVersion']);
  const version = s.integer(r['expectedCurrentVersion']);
  if (version < 1) return s.fail();
  return { npcUuid: s.uuid(r['npcUuid']), expectedCurrentVersion: version };
}
function attemptRef(value: unknown): NpcGmAttemptRef {
  const r = s.object(value, [
    'npcDraftId',
    'candidateNpcUuid',
    'revision',
    'mode',
    'targetOrNull',
    'stage',
  ]);
  const mode = r['mode'];
  if (mode !== 'CREATE_V1' && mode !== 'APPEND_N_PLUS_ONE') return s.fail();
  const ref: NpcGmAttemptRef = {
    npcDraftId: s.uuid(r['npcDraftId']),
    candidateNpcUuid: s.uuid(r['candidateNpcUuid']),
    revision: s.integer(r['revision']),
    mode,
    targetOrNull: target(r['targetOrNull']),
    stage: NPC_STAGES.find((stage) => stage === r['stage']) ?? s.fail(),
  };
  if (
    ref.npcDraftId === ref.candidateNpcUuid ||
    (mode === 'CREATE_V1'
      ? ref.targetOrNull !== null
      : ref.targetOrNull?.npcUuid !== ref.candidateNpcUuid)
  )
    return s.fail();
  return ref;
}
function selection(value: unknown): NpcGmSelection | null {
  if (value === null) return null;
  const r = s.object(value, ['npcUuid', 'displayedVersion', 'currentVersion']);
  const displayedVersion = s.integer(r['displayedVersion']),
    currentVersion = s.integer(r['currentVersion']);
  if (displayedVersion < 1 || displayedVersion > currentVersion) return s.fail();
  return { npcUuid: s.uuid(r['npcUuid']), displayedVersion, currentVersion };
}
export function npcGmContextValue(value: unknown): NpcGmContext {
  const r = s.object(value, [
    'selectedNpcOrNull',
    'attemptOrNull',
    'initialTimeReturnContextOrNull',
  ]);
  const attemptOrNull = r['attemptOrNull'] === null ? null : attemptRef(r['attemptOrNull']);
  let time: NpcInitialTimeReturnContext | null = null;
  if (r['initialTimeReturnContextOrNull'] !== null) {
    const t = s.object(r['initialTimeReturnContextOrNull'], [
      'campaignId',
      'npcDraftId',
      'attemptRevision',
      'editMode',
      'versionBindingOrNull',
      'returnFormId',
    ]);
    if (
      attemptOrNull === null ||
      attemptOrNull.stage !== 'NPC-016' ||
      t['returnFormId'] !== 'NPC-016'
    )
      return s.fail();
    time = {
      campaignId: s.uuid(t['campaignId']),
      npcDraftId: s.uuid(t['npcDraftId']),
      attemptRevision: s.integer(t['attemptRevision']),
      editMode: attemptOrNull.mode,
      versionBindingOrNull: target(t['versionBindingOrNull']),
      returnFormId: 'NPC-016',
    };
    equal(
      [time.npcDraftId, time.attemptRevision, t['editMode'], time.versionBindingOrNull],
      [
        attemptOrNull.npcDraftId,
        attemptOrNull.revision,
        attemptOrNull.mode,
        attemptOrNull.targetOrNull,
      ],
    );
  }
  return {
    selectedNpcOrNull: selection(r['selectedNpcOrNull']),
    attemptOrNull,
    initialTimeReturnContextOrNull: time,
  };
}
export function npcSourceCauseValue(value: unknown): NpcSourceCause {
  const r = s.object(value, ['operationId', 'recordSha256']);
  return { operationId: s.text(r['operationId']), recordSha256: s.hash(r['recordSha256']) };
}
export function npcSourceEventId(scope: NpcScope, cause: NpcSourceCause): string {
  return `gm-npc-source:${digest({ scope: npcScopeValue(scope), cause: npcSourceCauseValue(cause) })}`;
}
export function npcSelectionValue(value: unknown): NpcSelectionReplaceRequest {
  const r = npcTechnicalRequestValue(value);
  if (r.messageType !== 'network.npc-selection.replace') return s.fail('INVALID_INPUT');
  return r;
}
function nav(value: unknown): FormActionIntentV2Message {
  const r = s.object(value, [
    'messageType',
    'protocolVersion',
    'actionKey',
    'expectedProjectionRevision',
    'navigationRequestId',
    'sourceFormId',
  ]);
  const key = s.text(r['actionKey']) as keyof typeof NPC_NAV_TARGETS;
  if (
    r['messageType'] !== 'navigation.form-action' ||
    r['protocolVersion'] !== 2 ||
    !Object.hasOwn(NPC_NAV_TARGETS, key) ||
    key.split('::')[0] !== r['sourceFormId']
  )
    return s.fail('INVALID_INPUT');
  s.text(r['navigationRequestId']);
  s.integer(r['expectedProjectionRevision']);
  return r as unknown as FormActionIntentV2Message;
}
type NpcStoredDraftMutation = NpcEditorReplaceRequest | NpcPreparationRequest;
function draftMutation(value: unknown): NpcStoredDraftMutation {
  const r = npcTechnicalRequestValue(value);
  if (r.messageType === 'network.npc-editor.replace') return r;
  if (r.messageType === 'network.npc-preparation.request') return r;
  // The capability-specific writer and historical reader remain mandatory.
  return s.fail('UNAVAILABLE');
}
/** Closed request grammar only; host/domain stage applicability is a separate mandatory proof. */
export const NPC_GM_REQUEST_READERS: NpcRequestReader = {
  request(kind, value) {
    if (kind === 'OPEN' || kind === 'COMMIT' || kind === 'COMMIT_V1')
      return npcWorkflowCommandRequestValue(value) as unknown as JsonObject;
    const r = s.object(value);
    if (r['messageType'] === 'navigation.form-action') return nav(value) as unknown as JsonObject;
    const parsed = draftMutation(value);
    if (kind !== 'REPLACE') return s.fail('INVALID_INPUT');
    return parsed as unknown as JsonObject;
  },
  technicalBinding(kind, value) {
    if (value['messageType'] === 'navigation.form-action') {
      const r = nav(value);
      if (!['NPC-001', ...NPC_STAGES].some((form) => form === r.sourceFormId)) return s.fail();
      return {
        kind: 'FORM_ACTION',
        navigationRequestId: r.navigationRequestId,
        sourceFormId: r.sourceFormId as NpcGmSource['sourceFormId'],
        expectedProjectionRevision: r.expectedProjectionRevision,
      };
    }
    const r = draftMutation(value);
    if (kind !== 'REPLACE') return s.fail();
    return {
      kind: 'DRAFT_REPLACE',
      operationId: r.operationId,
      campaignId: r.campaignId,
      npcDraftId: r.npcDraftId,
      expectedAttemptRevision: r.expectedAttemptRevision,
      expectedRevisions: r.expectedRevisions,
    };
  },
};

interface AttemptHeader {
  readonly ordinaryFactOrNull: NpcOrdinaryAuthoringFact | null;
  readonly lifeStateFactOrNull: NpcLifeStateRollFact | null;
  readonly childAllocations: readonly NpcChildAllocation[];
  readonly operationId: string;
  readonly previousSha256OrNull: string | null;
  readonly ref: NpcGmAttemptRef;
  readonly scope: NpcScope;
  readonly status: 'OPEN' | 'CANCELLED' | 'COMMITTED';
  readonly values: JsonObject;
  readonly sha256: string;
}
function checkedText(row: Row | undefined): string {
  if (row === undefined) return s.fail('NOT_FOUND');
  const text = s.text(row['record_json']);
  if (s.sha(text) !== s.hash(row['record_sha256'])) return s.fail();
  return text;
}
function checked(row: Row | undefined): Row {
  return s.parseCanonicalObject(checkedText(row));
}
function attemptHeader(
  row: Row | undefined,
  scope: NpcScope,
  envelope = npcAttemptEventEnvelopeValue(checked(row)),
): AttemptHeader {
  const e = s.object(envelope);
  const a = s.object(e['attempt'], [
    'scope',
    'npcDraftId',
    'candidateNpcUuid',
    'revision',
    'mode',
    'targetOrNull',
    'stage',
    'status',
    'values',
  ]);
  const ref = attemptRef({
    npcDraftId: a['npcDraftId'],
    candidateNpcUuid: a['candidateNpcUuid'],
    revision: a['revision'],
    mode: a['mode'],
    targetOrNull: a['targetOrNull'],
    stage: a['stage'],
  });
  const own = npcScopeValue(a['scope']);
  equal(own, scope);
  const status = a['status'];
  if (status !== 'OPEN' && status !== 'CANCELLED' && status !== 'COMMITTED') return s.fail();
  const operationId = s.text(e['operationId']);
  equal(
    [row?.['campaign_id'], row?.['draft_id'], row?.['revision'], row?.['operation_id']],
    [scope.campaignId, ref.npcDraftId, ref.revision, operationId],
  );
  return {
    operationId,
    previousSha256OrNull:
      e['previousSha256OrNull'] === null ? null : s.hash(e['previousSha256OrNull']),
    ref,
    scope: own,
    childAllocations: npcEventAllocations(envelope),
    ordinaryFactOrNull: npcEventOrdinaryFact(envelope),
    lifeStateFactOrNull: npcEventLifeStateFact(envelope),
    status,
    values: s.object(a['values']) as JsonObject,
    sha256: s.hash(row?.['record_sha256']),
  };
}
interface CheckedAttemptRow {
  readonly row: Row;
  readonly envelope: NpcAttemptEvent;
  readonly header: AttemptHeader;
}
function checkedAttemptRow(row: Row, scope: NpcScope): CheckedAttemptRow {
  const envelope = npcFrozenAttemptEventEnvelopeText(checkedText(row));
  return freezeEvidence({ row: { ...row }, envelope, header: attemptHeader(row, scope, envelope) });
}
function liveAttemptHeader(
  row: Row | undefined,
  scope: NpcScope,
  checkedRow: CheckedAttemptRow | null | undefined,
): AttemptHeader {
  // A parsed header is reusable only when every freshly read SQL column still matches.
  if (
    checkedRow !== null &&
    checkedRow !== undefined &&
    samePrimitiveRow(row, checkedRow.row) &&
    s.same(scope, checkedRow.header.scope)
  )
    return checkedRow.header;
  return attemptHeader(row, scope);
}
type NpcGmPrimitiveProof = {
  operation: NpcOperation;
  event: AttemptHeader;
  previous: AttemptHeader | null;
};
interface PrimitiveCauseRows {
  operation: Row | undefined;
  event: Row | undefined;
  previous: Row | undefined;
  version: Row | undefined;
}
/** A read-only calculation may reuse a private result only inside an unchanged transaction. */
export function readNpcCalculationMutationStamp(db: Database.Database): string {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const changes = s.integer(s.object(db.prepare('SELECT total_changes() AS n').get())['n']);
  return (
    String(changes) +
    '/' +
    String(db.pragma('schema_version', { simple: true })) +
    '/' +
    String(db.pragma('user_version', { simple: true }))
  );
}
const NUMERIC_CAUSE_SQL = {
  event: 'SELECT * FROM npc_attempt_event WHERE operation_id=?',
  previous: 'SELECT * FROM npc_attempt_event WHERE campaign_id=? AND draft_id=? AND revision=?',
  version: 'SELECT * FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version=?',
} as const;
type NumericCauseQuery = keyof typeof NUMERIC_CAUSE_SQL;
type NumericCauseSlots = Record<
  NumericCauseQuery,
  [Database.Statement | undefined, Database.Statement | undefined]
>;
const numericCauseStatements = new WeakMap<Database.Database, NumericCauseSlots>();
function numericCauseStatement(db: Database.Database, kind: NumericCauseQuery): Database.Statement {
  // Each local lazy query observes the current connection default at its first use.
  // Request decoding may change that default between the operation and event reads.
  const witness = s.object(db.prepare('SELECT 1 AS n').get())['n'];
  if (witness !== 1 && witness !== 1n) return s.fail();
  const mode = witness === 1n ? 1 : 0;
  let slots = numericCauseStatements.get(db);
  if (slots === undefined) {
    slots = {
      event: [undefined, undefined],
      previous: [undefined, undefined],
      version: [undefined, undefined],
    };
    numericCauseStatements.set(db, slots);
  }
  let statement = slots[kind][mode];
  if (statement === undefined) {
    statement = db.prepare(NUMERIC_CAUSE_SQL[kind]).safeIntegers(mode === 1);
    slots[kind][mode] = statement;
  }
  return statement;
}
function causeQueries(db: Database.Database) {
  const statements = new Map<string, Database.Statement>();
  const row = (sql: string, ...args: (string | number)[]): Row | undefined => {
    let statement = statements.get(sql);
    if (statement === undefined) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement.get(...args) as Row | undefined;
  };
  let eventQuery: Database.Statement | undefined;
  let previousQuery: Database.Statement | undefined;
  let versionQuery: Database.Statement | undefined;
  return {
    operation: (id: string) => row('SELECT * FROM npc_operation WHERE operation_id=?', id),
    event: (id: string) =>
      (eventQuery ??= numericCauseStatement(db, 'event')).get(id) as Row | undefined,
    previous: (campaign: string, draft: string, revision: number) =>
      (previousQuery ??= numericCauseStatement(db, 'previous')).get(campaign, draft, revision) as
        Row | undefined,
    version: (campaign: string, npc: string, version: number) =>
      (versionQuery ??= numericCauseStatement(db, 'version')).get(campaign, npc, version) as
        Row | undefined,
  };
}
function samePrimitiveRow(a: Row | undefined, b: Row | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  );
}
const NPC_GM_CAUSE_SESSION_ISSUER = Symbol('NPC_GM_CAUSE_SESSION_ISSUER');
class NpcGmCauseReadSession {
  readonly #db: Database.Database;
  readonly #scope: NpcScope;
  #queries: ReturnType<typeof causeQueries> | undefined;
  readonly #changes: Database.Statement;
  readonly #schemaVersion: Database.Statement;
  readonly #userVersion: Database.Statement;
  readonly #cache = new Map<
    string,
    { hash: string; proof: NpcGmPrimitiveProof; rows: PrimitiveCauseRows }
  >();
  #open = true;
  #stamp: string;
  static owns(value: unknown): value is NpcGmCauseReadSession {
    return value !== null && typeof value === 'object' && #db in value;
  }
  constructor(db: Database.Database, scope: NpcScope, issuer: typeof NPC_GM_CAUSE_SESSION_ISSUER) {
    if (issuer !== NPC_GM_CAUSE_SESSION_ISSUER)
      throw new NetworkApplicationStoreError('INVALID_INPUT');
    this.#db = db;
    // Existing GM queues use opaque context strings and may predate NPC tables.
    // NPC-only UUID and SQL requirements belong to an actual NPC cause read.
    const row = s.object(scope, ['campaignId', 'gmLocalContextId', 'ownerDeviceId']);
    this.#scope = Object.freeze({
      campaignId: s.text(row['campaignId']),
      gmLocalContextId: s.text(row['gmLocalContextId']),
      ownerDeviceId: s.text(row['ownerDeviceId']),
    });
    this.#changes = db.prepare('SELECT total_changes() AS n');
    this.#schemaVersion = db.prepare('PRAGMA schema_version').pluck();
    this.#userVersion = db.prepare('PRAGMA user_version').pluck();
    this.#stamp = this.stamp();
  }
  private stamp(): string {
    if (!this.#db.inTransaction) return s.fail('INVALID_INPUT');
    const changes = this.#changes.get() as Row;
    return (
      String(changes['n']) +
      '/' +
      String(this.#schemaVersion.get()) +
      '/' +
      String(this.#userVersion.get())
    );
  }
  close(): void {
    this.#open = false;
    this.#cache.clear();
  }
  read(db: Database.Database, scope: NpcScope, cause: NpcSourceCause): NpcGmPrimitiveProof {
    if (!this.#open || db !== this.#db || !db.inTransaction) return s.fail('INVALID_INPUT');
    const own = npcScopeValue(scope),
      c = npcSourceCauseValue(cause);
    equal(own, this.#scope);
    const queries = (this.#queries ??= causeQueries(db));
    const stamp = this.stamp();
    if (stamp !== this.#stamp) {
      this.#cache.clear();
      this.#stamp = stamp;
    }
    const cached = this.#cache.get(c.operationId);
    if (cached !== undefined && cached.hash === c.recordSha256) {
      const { event, operation } = cached.proof;
      const rows: PrimitiveCauseRows = {
        operation: queries.operation(c.operationId),
        event: queries.event(c.operationId),
        previous:
          event.ref.revision === 0
            ? undefined
            : queries.previous(own.campaignId, event.ref.npcDraftId, event.ref.revision - 1),
        version:
          operation.versionOrNull === null
            ? undefined
            : queries.version(
                own.campaignId,
                operation.versionOrNull.npcUuid,
                operation.versionOrNull.version,
              ),
      };
      // The fence alone is insufficient: every hit still compares all live SQL columns and bytes.
      if (
        (['operation', 'event', 'previous', 'version'] as const).every((key) =>
          samePrimitiveRow(rows[key], cached.rows[key]),
        )
      )
        return cached.proof;
    }
    this.#cache.delete(c.operationId);
    const checked = verifyNpcGmPrimitiveCause(db, own, c, queries);
    const proof = freezeEvidence(checked.proof);
    this.#cache.set(c.operationId, { hash: c.recordSha256, proof, rows: checked.rows });
    return proof;
  }
}
Object.freeze(NpcGmCauseReadSession.prototype);
Object.freeze(NpcGmCauseReadSession);
/** Opaque, invocation-owned proof reader; never serialized or retained in a public history. */
export type NpcGmPrimitiveReadSession = NpcGmCauseReadSession;
export function withNpcGmPrimitiveReadSession<T>(
  db: Database.Database,
  scope: NpcScope,
  run: (session: NpcGmPrimitiveReadSession) => T,
): T {
  if (
    typeof run !== 'function' ||
    types.isProxy(run) ||
    types.isAsyncFunction(run) ||
    types.isGeneratorFunction(run) ||
    /\{\s*\[native code\]\s*\}$/u.test(Function.prototype.toString.call(run))
  )
    return s.fail('INVALID_INPUT');
  const session = new NpcGmCauseReadSession(db, scope, NPC_GM_CAUSE_SESSION_ISSUER);
  Object.freeze(session);
  try {
    const result = run(session);
    if (types.isPromise(result)) {
      void Promise.prototype.then.call(
        result,
        () => undefined,
        () => undefined,
      );
      return s.fail('INVALID_INPUT');
    }
    if (!db.inTransaction) return s.fail('SOURCE_CHANGED');
    return result;
  } finally {
    session.close();
  }
}
/** Independent calls retain full validation; only a live owning read can reuse an exact proof. */
export function readNpcGmPrimitiveCause(
  db: Database.Database,
  scope: NpcScope,
  cause: NpcSourceCause,
  session?: NpcGmPrimitiveReadSession,
): NpcGmPrimitiveProof {
  if (session === undefined)
    return verifyNpcGmPrimitiveCause(db, scope, cause, causeQueries(db)).proof;
  if (types.isProxy(session) || !NpcGmCauseReadSession.owns(session))
    return s.fail('INVALID_INPUT');
  return NpcGmCauseReadSession.prototype.read.call(session, db, scope, cause);
}
/** Metadata/row-integrity proof. This deliberately does not claim that an opaque sheet is domain-valid. */
function verifyNpcGmPrimitiveCause(
  db: Database.Database,
  scope: NpcScope,
  cause: NpcSourceCause,
  queries: ReturnType<typeof causeQueries>,
  checkedEvents?: Readonly<{ current: CheckedAttemptRow; previous: CheckedAttemptRow | null }>,
) {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const c = npcSourceCauseValue(cause),
    own = npcScopeValue(scope);
  const row = queries.operation(c.operationId);
  const operation = npcOperationValue(checked(row), NPC_GM_REQUEST_READERS);
  equal(
    [
      row?.['campaign_id'],
      row?.['kind'],
      row?.['receipt_id'],
      row?.['record_sha256'],
      operation.operationId,
      operation.scope,
    ],
    [own.campaignId, operation.kind, operation.receiptId, c.recordSha256, c.operationId, own],
  );
  const eventRow = queries.event(c.operationId);
  const event = liveAttemptHeader(eventRow, own, checkedEvents?.current);
  equal(event.sha256, operation.attemptEventSha256);
  verifyNpcOrdinaryFactBinding(event.ordinaryFactOrNull, operation, {
    stage: event.ref.stage,
    status: event.status,
  });
  verifyNpcLifeRollFactBinding(event.lifeStateFactOrNull, operation, {
    stage: event.ref.stage,
    status: event.status,
  });
  const previousRow =
    event.ref.revision === 0
      ? undefined
      : queries.previous(own.campaignId, event.ref.npcDraftId, event.ref.revision - 1);
  const previous =
    event.ref.revision === 0 ? null : liveAttemptHeader(previousRow, own, checkedEvents?.previous);
  let versionRow: Row | undefined;
  equal(event.previousSha256OrNull, previous?.sha256 ?? null);
  if (previous !== null) {
    equal(
      [event.ref.npcDraftId, event.ref.candidateNpcUuid, event.ref.mode, event.ref.targetOrNull],
      [
        previous.ref.npcDraftId,
        previous.ref.candidateNpcUuid,
        previous.ref.mode,
        previous.ref.targetOrNull,
      ],
    );
    if (previous.status !== 'OPEN') return s.fail();
  }
  if (operation.kind === 'CREATE' || operation.kind === 'OPEN') {
    if (
      previous !== null ||
      event.status !== 'OPEN' ||
      event.ref.stage !== 'NPC-002' ||
      (operation.kind === 'CREATE') !== (event.ref.mode === 'CREATE_V1')
    )
      return s.fail();
  } else if (
    previous === null ||
    (operation.kind === 'REPLACE'
      ? event.status !== 'OPEN'
      : operation.kind === 'CANCEL'
        ? event.status !== 'CANCELLED'
        : event.status !== 'COMMITTED')
  )
    return s.fail();
  const committed = operation.kind === 'COMMIT' || operation.kind === 'COMMIT_V1';
  if (
    committed !== (operation.versionOrNull !== null) ||
    committed !== (operation.anchorOrNull !== null)
  )
    return s.fail();
  if (!committed) equal(operation.beforeCheckpoint, operation.afterCheckpoint);
  else {
    const ref = operation.versionOrNull ?? s.fail();
    if (operation.afterCheckpoint.stateRevision !== operation.beforeCheckpoint.stateRevision + 1)
      return s.fail();
    versionRow = queries.version(own.campaignId, ref.npcUuid, ref.version);
    const v = s.object(checked(versionRow), [
      'scope',
      'npcUuid',
      'version',
      'libraryRevision',
      'operationId',
      'npcDraftId',
      'attemptRevision',
      'previousVersionSha256OrNull',
      'snapshot',
      'lifetimeFacts',
      'art',
      'committedAt',
    ]);
    equal(
      [
        versionRow?.['record_sha256'],
        versionRow?.['operation_id'],
        versionRow?.['library_revision'],
        v['npcUuid'],
        v['version'],
        v['libraryRevision'],
        v['operationId'],
        v['npcDraftId'],
        v['attemptRevision'],
        v['committedAt'],
        npcScopeValue(v['scope']),
      ],
      [
        ref.sha256,
        operation.operationId,
        operation.anchorOrNull?.libraryRevision,
        event.ref.candidateNpcUuid,
        ref.version,
        operation.anchorOrNull?.libraryRevision,
        operation.operationId,
        event.ref.npcDraftId,
        event.ref.revision,
        operation.committedAt,
        own,
      ],
    );
  }
  return {
    proof: { operation, event, previous },
    rows: { operation: row, event: eventRow, previous: previousRow, version: versionRow },
  };
}
function sourceAt(
  view: GmRequestReviewView,
  events: readonly StoredGmRequestQueueEvent[],
): NpcGmSource {
  const last = events.at(-1) ?? s.fail();
  equal(last.view, view);
  return npcGmSourceValue({
    sourceFormId: view.formId,
    revisions: s.vectorOf(view),
    sourceSnapshotSha256: view.snapshotSha256,
    queuePrefix: { eventId: last.eventId, recordSha256: last.recordSha256 },
  });
}
/** Pre-write counterpart of NPC_SOURCE: no allocator or sampler may run on another queue context. */
export function validateNpcGmPreparation(
  view: GmRequestReviewView,
  events: readonly StoredGmRequestQueueEvent[],
  input: NpcAttemptPreparationContext,
): void {
  const { boundary: b, source, previousOrNull: previous } = input;
  equal(
    [view.ownerDeviceId, view.gmLocalContextId, view.campaignId],
    [b.scope.ownerDeviceId, b.scope.gmLocalContextId, b.scope.campaignId],
  );
  equal(input.beforeGmSource, sourceAt(view, events));
  const context = npcGmContextValue(view.npc ?? s.fail());
  if (context.initialTimeReturnContextOrNull !== null) return s.fail('UNAVAILABLE');
  if (previous === null) {
    if (context.attemptOrNull !== null) return s.fail('UNAVAILABLE');
  } else {
    const a = previous.attempt;
    equal(context.attemptOrNull, {
      npcDraftId: a.npcDraftId,
      candidateNpcUuid: a.candidateNpcUuid,
      revision: a.revision,
      mode: a.mode,
      targetOrNull: a.targetOrNull,
      stage: a.stage,
    });
  }
  if (source.kind === 'CREATE') {
    const r = nav(b.request);
    if (b.kind !== 'CREATE' || view.formId !== 'NPC-001' || r.actionKey !== 'NPC-001::CTA::001')
      return s.fail('UNAVAILABLE');
    equal(
      [r.sourceFormId, r.navigationRequestId, r.expectedProjectionRevision],
      [view.formId, b.operationId, view.projectionRevision],
    );
    return;
  }
  if (source.kind === 'OPEN') {
    const r = npcWorkflowCommandRequestValue(b.request);
    if (
      b.kind !== 'OPEN' ||
      r.workflowCommandId !== 'UI-CMD-NPC-NEW-VERSION' ||
      r.payload.phase !== 'OPEN' ||
      !['NPC-003', 'NPC-007'].includes(view.formId)
    )
      return s.fail('UNAVAILABLE');
    const selected = context.selectedNpcOrNull ?? s.fail('UNAVAILABLE');
    equal(
      [
        r.commandId,
        r.payload.campaignId,
        r.expectedRevisions,
        r.payload.npcUuid,
        r.payload.expectedCurrentVersion,
        source.target,
        input.baseVersionOrNull?.npcUuid,
        input.baseVersionOrNull?.version,
      ],
      [
        b.operationId,
        b.scope.campaignId,
        s.vectorOf(view),
        selected.npcUuid,
        selected.currentVersion,
        { npcUuid: selected.npcUuid, expectedCurrentVersion: selected.currentVersion },
        selected.npcUuid,
        selected.currentVersion,
      ],
    );
    return;
  }
  if (
    previous === null ||
    previous.attempt.stage !== view.formId ||
    (b.kind !== 'REPLACE' && b.kind !== 'CANCEL')
  )
    return s.fail('UNAVAILABLE');
  if (b.request['messageType'] === 'navigation.form-action') {
    const r = nav(b.request),
      destination = NPC_NAV_TARGETS[r.actionKey as keyof typeof NPC_NAV_TARGETS];
    equal(
      [r.sourceFormId, r.navigationRequestId, r.expectedProjectionRevision],
      [view.formId, b.operationId, view.projectionRevision],
    );
    if (b.kind === 'CANCEL') {
      if (r.actionKey !== 'NPC-002::CTA::003' || destination !== 'NPC-001')
        return s.fail('UNAVAILABLE');
    } else if (destination === 'NET-016') {
      if (r.actionKey !== 'NPC-016::CTA::004') return s.fail('UNAVAILABLE');
    } else if (!NPC_STAGES.some((stage) => stage === destination)) return s.fail('UNAVAILABLE');
    return;
  }
  const r = draftMutation(b.request);
  if (b.kind !== 'REPLACE') return s.fail('UNAVAILABLE');
  equal(
    [
      r.sourceFormId,
      r.operationId,
      r.campaignId,
      r.npcDraftId,
      r.expectedAttemptRevision,
      r.expectedRevisions,
    ],
    [
      view.formId,
      b.operationId,
      b.scope.campaignId,
      previous.attempt.npcDraftId,
      previous.attempt.revision,
      s.vectorOf(view),
    ],
  );
}
/** Exact current COMMIT binding, before the lazy host allocates a receipt or item identities. */
export function validateNpcGmCommitPreparation(
  view: GmRequestReviewView,
  events: readonly StoredGmRequestQueueEvent[],
  input: NpcCommitPreparationContext,
): void {
  const {
    boundary: b,
    previous: { attempt: a },
  } = input;
  equal(
    [view.ownerDeviceId, view.gmLocalContextId, view.campaignId],
    [b.scope.ownerDeviceId, b.scope.gmLocalContextId, b.scope.campaignId],
  );
  equal(input.beforeGmSource, sourceAt(view, events));
  const context = npcGmContextValue(view.npc ?? s.fail());
  if (
    context.initialTimeReturnContextOrNull !== null ||
    view.formId !== 'NPC-017' ||
    a.stage !== 'NPC-017' ||
    a.status !== 'OPEN'
  )
    return s.fail('UNAVAILABLE');
  equal(context.attemptOrNull, {
    npcDraftId: a.npcDraftId,
    candidateNpcUuid: a.candidateNpcUuid,
    revision: a.revision,
    mode: a.mode,
    targetOrNull: a.targetOrNull,
    stage: a.stage,
  });
  const request = npcWorkflowCommandRequestValue(b.request);
  equal(
    [request.commandId, request.payload.campaignId, request.expectedRevisions],
    [b.operationId, b.scope.campaignId, s.vectorOf(view)],
  );
  if (b.kind === 'COMMIT_V1') {
    if (
      request.workflowCommandId !== 'UI-CMD-NPC-COMMIT-V1' ||
      a.mode !== 'CREATE_V1' ||
      input.previousVersionOrNull !== null ||
      b.expectedCurrentVersionOrNull !== null
    )
      return s.fail('UNAVAILABLE');
    equal(
      [request.payload.npcDraftId, request.payload.expectedAttemptRevision],
      [a.npcDraftId, a.revision],
    );
    return;
  }
  if (
    b.kind !== 'COMMIT' ||
    request.workflowCommandId !== 'UI-CMD-NPC-NEW-VERSION' ||
    request.payload.phase !== 'COMMIT' ||
    a.mode !== 'APPEND_N_PLUS_ONE' ||
    input.previousVersionOrNull === null
  )
    return s.fail('UNAVAILABLE');
  equal(
    [
      request.payload.npcDraftId,
      request.payload.expectedAttemptRevision,
      request.payload.expectedCurrentVersion,
      b.expectedCurrentVersionOrNull,
      a.targetOrNull?.npcUuid,
      a.targetOrNull?.expectedCurrentVersion,
    ],
    [
      a.npcDraftId,
      a.revision,
      input.previousVersionOrNull.version,
      input.previousVersionOrNull.version,
      a.candidateNpcUuid,
      input.previousVersionOrNull.version,
    ],
  );
}
function versionFromPrefix(
  db: Database.Database,
  scope: NpcScope,
  events: readonly StoredGmRequestQueueEvent[],
  npcUuid: string,
  wanted?: number,
  session?: NpcGmPrimitiveReadSession,
): NpcGmSelection {
  const refs: NpcVersionRef[] = [];
  for (const event of events) {
    if (event.mutation.kind !== 'NPC_SOURCE') continue;
    const ref = readNpcGmPrimitiveCause(db, scope, event.mutation.cause, session).operation
      .versionOrNull;
    if (ref !== null && ref.npcUuid === npcUuid) {
      if (ref.version !== (refs.at(-1)?.version ?? 0) + 1) return s.fail();
      refs.push(ref);
    }
  }
  const current = refs.at(-1) ?? s.fail('NOT_FOUND');
  const version = wanted ?? current.version;
  const ref = refs.find((r) => r.version === version) ?? s.fail('NOT_FOUND');
  const row = db
    .prepare('SELECT * FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version=?')
    .get(scope.campaignId, npcUuid, version) as Row | undefined;
  const record = checked(row);
  equal(
    [row?.['record_sha256'], record['npcUuid'], record['version'], npcScopeValue(record['scope'])],
    [ref.sha256, npcUuid, version, scope],
  );
  if (version < 1 || version > current.version) return s.fail();
  return { npcUuid, displayedVersion: version, currentVersion: current.version };
}
export function reduceNpcSelection(
  db: Database.Database,
  scope: NpcScope,
  old: GmRequestReviewView,
  events: readonly StoredGmRequestQueueEvent[],
  value: NpcSelectionReplaceRequest,
  session?: NpcGmPrimitiveReadSession,
): NpcGmContext {
  const r = npcSelectionValue(value),
    context = npcGmContextValue(old.npc ?? s.fail());
  if (
    r.campaignId !== scope.campaignId ||
    r.sourceFormId !== old.formId ||
    !s.same(r.expectedRevisions, s.vectorOf(old))
  )
    return s.fail('STALE_REVISION');
  if (r.sourceFormId === 'NPC-001')
    return {
      ...context,
      selectedNpcOrNull:
        r.npcUuidOrNull === null
          ? null
          : versionFromPrefix(db, scope, events, r.npcUuidOrNull, undefined, session),
    };
  if (context.selectedNpcOrNull?.npcUuid !== r.npcUuid) return s.fail('FOREIGN_OWNER');
  return {
    ...context,
    selectedNpcOrNull: versionFromPrefix(db, scope, events, r.npcUuid, r.version, session),
  };
}
export function reduceNpcSource(
  db: Database.Database,
  scope: NpcScope,
  old: GmRequestReviewView,
  events: readonly StoredGmRequestQueueEvent[],
  cause: NpcSourceCause,
  session?: NpcGmPrimitiveReadSession,
): { formId: GmRequestReviewView['formId']; npc: NpcGmContext } {
  const { operation: o, event: e, previous } = readNpcGmPrimitiveCause(db, scope, cause, session);
  equal(o.beforeGmSource, sourceAt(old, events));
  const context = npcGmContextValue(old.npc ?? s.fail());
  if (context.initialTimeReturnContextOrNull !== null) return s.fail();
  if (previous === null) {
    if (context.attemptOrNull !== null) return s.fail('UNAVAILABLE');
  } else equal(context.attemptOrNull, previous.ref);
  if (o.kind === 'CREATE') {
    const request = nav(o.request);
    if (old.formId !== 'NPC-001' || request.actionKey !== 'NPC-001::CTA::001') return s.fail();
    equal(
      [request.navigationRequestId, request.expectedProjectionRevision],
      [o.operationId, old.projectionRevision],
    );
  } else if (o.kind === 'OPEN') {
    const r = npcWorkflowCommandRequestValue(o.request);
    if (
      r.workflowCommandId !== 'UI-CMD-NPC-NEW-VERSION' ||
      r.payload.phase !== 'OPEN' ||
      !['NPC-003', 'NPC-007'].includes(old.formId)
    )
      return s.fail();
    const selected = context.selectedNpcOrNull ?? s.fail();
    equal(
      [
        r.commandId,
        r.payload.campaignId,
        r.expectedRevisions,
        r.payload.npcUuid,
        r.payload.expectedCurrentVersion,
        e.ref.targetOrNull,
      ],
      [
        o.operationId,
        scope.campaignId,
        s.vectorOf(old),
        selected.npcUuid,
        selected.currentVersion,
        { npcUuid: selected.npcUuid, expectedCurrentVersion: selected.currentVersion },
      ],
    );
  } else if (o.kind === 'REPLACE' || o.kind === 'CANCEL') {
    if (previous === null || previous.ref.stage !== old.formId) return s.fail();
    if (o.request['messageType'] === 'navigation.form-action') {
      const r = nav(o.request),
        targetForm = NPC_NAV_TARGETS[r.actionKey as keyof typeof NPC_NAV_TARGETS];
      equal(
        [r.sourceFormId, r.navigationRequestId, r.expectedProjectionRevision],
        [old.formId, o.operationId, old.projectionRevision],
      );
      equal(e.values, previous.values);
      if (o.kind === 'CANCEL') {
        if (
          r.actionKey !== 'NPC-002::CTA::003' ||
          targetForm !== 'NPC-001' ||
          e.ref.stage !== previous.ref.stage
        )
          return s.fail();
        return {
          formId: 'NPC-001',
          npc: { ...context, attemptOrNull: null, initialTimeReturnContextOrNull: null },
        };
      }
      if (targetForm === 'NET-016') {
        if (r.actionKey !== 'NPC-016::CTA::004' || e.ref.stage !== 'NPC-016') return s.fail();
        return {
          formId: 'NET-016',
          npc: {
            ...context,
            attemptOrNull: e.ref,
            initialTimeReturnContextOrNull: {
              campaignId: scope.campaignId,
              npcDraftId: e.ref.npcDraftId,
              attemptRevision: e.ref.revision,
              editMode: e.ref.mode,
              versionBindingOrNull: e.ref.targetOrNull,
              returnFormId: 'NPC-016',
            },
          },
        };
      }
      if (targetForm !== e.ref.stage) return s.fail();
    } else {
      const r = draftMutation(o.request);
      if (o.kind !== 'REPLACE') return s.fail();
      if (r.messageType === 'network.npc-preparation.request') {
        if (r.preparation.kind === 'ITEM_RESERVE') {
          if (
            old.formId !== 'NPC-015' ||
            e.childAllocations.length !== 1 ||
            e.childAllocations[0]?.kind !== 'ITEM'
          )
            return s.fail();
        } else if (r.preparation.kind === 'ITEM_RESTORE') {
          if (
            old.formId !== 'NPC-015' ||
            e.ref.mode !== 'APPEND_N_PLUS_ONE' ||
            e.childAllocations.length !== 0
          )
            return s.fail();
        } else if (
          r.preparation.kind === 'CUSTOM_ITEM_RESERVE' ||
          r.preparation.kind === 'CUSTOM_MODIFIER_RESERVE' ||
          r.preparation.kind === 'CUSTOM_PROFILE_VERSION_RESERVE'
        ) {
          if (old.formId !== 'NPC-015') return s.fail();
          const request = r.preparation,
            facts = e.childAllocations;
          if (request.kind === 'CUSTOM_PROFILE_VERSION_RESERVE') {
            const version = facts[0];
            if (
              facts.length !== 1 ||
              version?.kind !== 'CUSTOM_PROFILE_VERSION' ||
              version.itemInstanceId !== request.itemInstanceId ||
              version.profileId !== request.profileId ||
              version.previousVersionIdOrNull !== request.expectedProfileVersionId
            )
              return s.fail();
          } else {
            const offset = request.kind === 'CUSTOM_ITEM_RESERVE' ? 1 : 0,
              profile = facts[offset],
              version = facts[offset + 1];
            if (
              facts.length !== offset + 2 ||
              (offset === 1 && facts[0]?.kind !== 'ITEM') ||
              profile?.kind !== 'CUSTOM_PROFILE' ||
              version?.kind !== 'CUSTOM_PROFILE_VERSION'
            )
              return s.fail();
            const itemId =
              request.kind === 'CUSTOM_ITEM_RESERVE' ? facts[0]!.id : request.itemInstanceId;
            equal(
              [
                profile.itemInstanceId,
                profile.profileKind,
                version.itemInstanceId,
                version.profileId,
                version.version,
                version.previousVersionIdOrNull,
              ],
              [
                itemId,
                offset === 1 ? 'CAMPAIGN_CUSTOM_PROFILE' : 'CATALOG_CUSTOM_MODIFIER',
                itemId,
                profile.id,
                1,
                null,
              ],
            );
          }
        } else if (r.preparation.kind === 'EQUIPMENT_COMPATIBILITY_CONFIRM') {
          if (old.formId !== 'NPC-015' || e.childAllocations.length !== 0) return s.fail();
        } else if (r.preparation.kind === 'COMPOSITE_ITEM_RESERVE') {
          const [set, first, second] = e.childAllocations;
          if (
            old.formId !== 'NPC-015' ||
            e.childAllocations.length !== 3 ||
            set?.kind !== 'LINKED_SET' ||
            set.itemTypeId !== r.preparation.input.itemTypeId ||
            first?.kind !== 'ITEM' ||
            second?.kind !== 'ITEM'
          )
            return s.fail();
        } else if (
          r.preparation.kind === 'ALCOHOL_PREPARE' ||
          r.preparation.kind === 'HP_MODE_PREPARE' ||
          r.preparation.kind === 'FORMAL_CONTROL_SET'
        ) {
          const fact = e.childAllocations[0],
            requested =
              r.preparation.kind === 'ALCOHOL_PREPARE'
                ? 'ALCOHOL'
                : r.preparation.kind === 'HP_MODE_PREPARE'
                  ? 'HP_MODE'
                  : 'FORMAL_CONTROL';
          if (
            old.formId !== 'NPC-016' ||
            (requested === 'HP_MODE'
              ? e.childAllocations.length !== 1
              : e.childAllocations.length > 1)
          )
            return s.fail();
          if (
            fact !== undefined &&
            (fact.kind !== 'EFFECT_INSTANCE' ||
              !('sourceKind' in fact) ||
              fact.sourceKind !== requested)
          )
            return s.fail();
          if (
            fact?.kind === 'EFFECT_INSTANCE' &&
            'sourceKind' in fact &&
            fact.sourceKind === 'FORMAL_CONTROL' &&
            r.preparation.kind === 'FORMAL_CONTROL_SET' &&
            fact.controlKind !== r.preparation.input.controlKind
          )
            return s.fail();
        } else if (r.preparation.kind === 'POISON_MODE_SET') {
          const fact = e.childAllocations[0];
          if (
            old.formId !== 'NPC-016' ||
            e.childAllocations.length !== 1 ||
            fact?.kind !== 'EFFECT_INSTANCE' ||
            !('sourceKind' in fact) ||
            fact.sourceKind !== 'POISON_MODE' ||
            fact.sourceInstanceId !== r.preparation.input.sourceInstanceId
          )
            return s.fail();
        } else if (r.preparation.kind === 'POISON_COATING_PREPARE') {
          const fact = e.childAllocations[0];
          if (
            old.formId !== 'NPC-015' ||
            e.childAllocations.length !== 1 ||
            fact?.kind !== 'COATING_INSTANCE' ||
            fact.sourceInstanceId !== r.preparation.input.sourceInstanceId ||
            fact.itemInstanceId !== r.preparation.input.targetItemInstanceId
          )
            return s.fail();
        } else if (r.preparation.kind === 'POISON_COATING_REMOVE') {
          if (old.formId !== 'NPC-015' || e.childAllocations.length !== 0) return s.fail();
        } else if (r.preparation.kind === 'WEAVER_STATE_PREPARE') {
          const fact = e.childAllocations[0];
          if (
            old.formId !== 'NPC-016' ||
            e.childAllocations.length !== 1 ||
            fact?.kind !== 'EFFECT_INSTANCE' ||
            !('sourceKind' in fact) ||
            fact.sourceKind !== 'WEAVER_STATE' ||
            fact.branch !== r.preparation.input.branch ||
            fact.sourceInstanceId !== r.preparation.input.sourceInstanceId
          )
            return s.fail();
        } else if (r.preparation.kind === 'WEAVER_STATE_REMOVE') {
          if (old.formId !== 'NPC-016' || e.childAllocations.length !== 0) return s.fail();
        } else if (r.preparation.kind === 'LIFE_STATE_ROLL') {
          if (
            old.formId !== 'NPC-016' ||
            e.childAllocations.length !== 0 ||
            e.lifeStateFactOrNull === null
          )
            return s.fail();
        } else if (r.preparation.kind === 'LIFE_STATE_SET') {
          if (old.formId !== 'NPC-016' || e.childAllocations.length > 1) return s.fail();
          const life = e.childAllocations[0];
          if (
            life !== undefined &&
            (life.kind !== 'EFFECT_INSTANCE' ||
              !('sourceKind' in life) ||
              life.sourceKind !== 'LIFE_TIMER' ||
              r.preparation.input.lifeKind !== 'SEVERELY_WOUNDED')
          )
            return s.fail();
        } else if (r.preparation.kind === 'DISEASE_RESERVE') {
          const fact = e.childAllocations[0];
          if (
            old.formId !== 'NPC-016' ||
            e.childAllocations.length !== 1 ||
            fact?.kind !== 'EFFECT_INSTANCE' ||
            !('diseaseId' in fact) ||
            fact.diseaseId !== r.preparation.diseaseId
          )
            return s.fail();
        } else if (r.preparation.kind === 'TRAUMA_RESERVE') {
          if (
            old.formId !== 'NPC-016' ||
            e.childAllocations.length !== 1 ||
            e.childAllocations[0]?.kind !== 'TRAUMA_INSTANCE'
          )
            return s.fail();
        } else if (r.preparation.kind === 'WOUND_PREPARE') {
          if (
            old.formId !== 'NPC-016' ||
            e.childAllocations.length !== 1 ||
            e.childAllocations[0]?.kind !== 'WOUND_INSTANCE'
          )
            return s.fail();
        } else if (r.preparation.kind === 'SYMBIONT_RESERVE') {
          if (
            old.formId !== 'NPC-013' ||
            e.childAllocations.length !== 1 ||
            e.childAllocations[0]?.kind !== 'SYMBIONT_INSTANCE'
          )
            return s.fail();
        } else if (
          r.preparation.kind === 'COMPOSITION_CONFIRM' ||
          r.preparation.kind === 'COMPOSITION_RESOLVE'
        ) {
          if (
            old.formId !== 'NPC-013' ||
            e.childAllocations.length !== 0 ||
            e.ordinaryFactOrNull === null
          )
            return s.fail();
        } else if (old.formId !== 'NPC-002' || e.childAllocations.length !== 0) return s.fail();
      }
      equal(
        [
          r.sourceFormId,
          r.operationId,
          r.campaignId,
          r.npcDraftId,
          r.expectedAttemptRevision,
          r.expectedRevisions,
          e.ref.stage,
        ],
        [
          old.formId,
          o.operationId,
          scope.campaignId,
          previous.ref.npcDraftId,
          previous.ref.revision,
          s.vectorOf(old),
          previous.ref.stage,
        ],
      );
    }
  } else {
    if (previous === null || old.formId !== 'NPC-017' || e.ref.stage !== 'NPC-017') return s.fail();
    const r = npcWorkflowCommandRequestValue(o.request),
      version = o.versionOrNull ?? s.fail();
    equal(
      [r.commandId, r.payload.campaignId, r.expectedRevisions, version.npcUuid],
      [o.operationId, scope.campaignId, s.vectorOf(old), e.ref.candidateNpcUuid],
    );
    if (o.kind === 'COMMIT_V1') {
      if (
        r.workflowCommandId !== 'UI-CMD-NPC-COMMIT-V1' ||
        e.ref.mode !== 'CREATE_V1' ||
        version.version !== 1
      )
        return s.fail();
      equal(
        [r.payload.npcDraftId, r.payload.expectedAttemptRevision],
        [previous.ref.npcDraftId, previous.ref.revision],
      );
    } else {
      if (
        r.workflowCommandId !== 'UI-CMD-NPC-NEW-VERSION' ||
        r.payload.phase !== 'COMMIT' ||
        e.ref.mode !== 'APPEND_N_PLUS_ONE'
      )
        return s.fail();
      equal(
        [
          r.payload.npcDraftId,
          r.payload.expectedAttemptRevision,
          r.payload.expectedCurrentVersion,
          version.version,
        ],
        [
          previous.ref.npcDraftId,
          previous.ref.revision,
          e.ref.targetOrNull?.expectedCurrentVersion,
          (e.ref.targetOrNull?.expectedCurrentVersion ?? s.fail()) + 1,
        ],
      );
    }
    return {
      formId: 'NPC-003',
      npc: {
        selectedNpcOrNull: {
          npcUuid: version.npcUuid,
          displayedVersion: version.version,
          currentVersion: version.version,
        },
        attemptOrNull: null,
        initialTimeReturnContextOrNull: null,
      },
    };
  }
  return { formId: e.ref.stage, npc: { ...context, attemptOrNull: e.ref } };
}

/** Ordinary navigation cannot bypass the NPC operation writer for authoring stages. */
export function npcContextAfterNavigation(
  db: Database.Database,
  scope: NpcScope,
  old: GmRequestReviewView,
  events: readonly StoredGmRequestQueueEvent[],
  request: FormActionIntentV2Message,
  targetForm: GmRequestReviewView['formId'],
  session?: NpcGmPrimitiveReadSession,
): NpcGmContext | undefined {
  if (old.npc === undefined) {
    if (
      request.actionKey === 'GM-001::CTA::004' &&
      old.formId === 'GM-001' &&
      targetForm === 'NPC-001'
    )
      return { selectedNpcOrNull: null, attemptOrNull: null, initialTimeReturnContextOrNull: null };
    if (request.sourceFormId.startsWith('NPC-') || String(targetForm).startsWith('NPC-'))
      return s.fail();
    return undefined;
  }
  const context = npcGmContextValue(old.npc);
  if (request.actionKey === 'NET-016::CTA::005') {
    const t = context.initialTimeReturnContextOrNull ?? s.fail('UNAVAILABLE');
    if (old.formId !== 'NET-016' || targetForm !== 'NPC-016' || t.campaignId !== scope.campaignId)
      return s.fail();
    return { ...context, initialTimeReturnContextOrNull: null };
  }
  if (NPC_STAGES.some((stage) => stage === old.formId || stage === targetForm))
    return s.fail('UNAVAILABLE');
  if (targetForm === 'NPC-003' || targetForm === 'NPC-007') {
    const selected = context.selectedNpcOrNull ?? s.fail('NOT_FOUND');
    return {
      ...context,
      selectedNpcOrNull: versionFromPrefix(
        db,
        scope,
        events,
        selected.npcUuid,
        request.actionKey === 'NPC-007::CTA::003' ? undefined : selected.displayedVersion,
        session,
      ),
    };
  }
  // Ordinary safe exit suspends the exact child. Re-entering NET-016 exposes its existing CTA005.
  // Clearing this binding here would orphan the retained stage-016 attempt and its return route.
  return context;
}

/** Both directions, including orphan mirrors/operations. Pending is internal append scope only. */
export function verifyNpcGmMirrorCoverage(
  db: Database.Database,
  scope: NpcScope,
  events: readonly StoredGmRequestQueueEvent[],
  pending?: NpcSourceCause,
  session?: NpcGmPrimitiveReadSession,
): void {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const present = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='npc_operation'")
    .get();
  const mirrors = events.filter((e) => e.mutation.kind === 'NPC_SOURCE');
  if (present === undefined) {
    if (mirrors.length !== 0 || pending !== undefined) return s.fail();
    return;
  }
  const operations = db
    .prepare('SELECT * FROM npc_operation WHERE campaign_id=?')
    .all(scope.campaignId) as Row[];
  const expected = new Map<string, NpcSourceCause>();
  for (const row of operations) {
    const record = checked(row),
      own = npcScopeValue(record['scope']);
    if (own.campaignId !== scope.campaignId) return s.fail();
    if (
      own.gmLocalContextId !== scope.gmLocalContextId ||
      own.ownerDeviceId !== scope.ownerDeviceId
    )
      continue;
    const cause = {
      operationId: s.text(row['operation_id']),
      recordSha256: s.hash(row['record_sha256']),
    };
    readNpcGmPrimitiveCause(db, scope, cause, session);
    if (expected.has(cause.operationId)) return s.fail();
    expected.set(cause.operationId, cause);
  }
  for (const event of mirrors) {
    if (event.mutation.kind !== 'NPC_SOURCE') return s.fail();
    const cause = event.mutation.cause;
    equal(expected.get(cause.operationId), cause);
    equal(event.eventId, npcSourceEventId(scope, cause));
    expected.delete(cause.operationId);
  }
  if (pending !== undefined) {
    equal(expected.get(pending.operationId), npcSourceCauseValue(pending));
    const operation = readNpcGmPrimitiveCause(db, scope, pending, session).operation;
    const old = events.at(-1)?.view ?? s.fail();
    equal(operation.beforeGmSource, sourceAt(old, events));
    expected.delete(pending.operationId);
  }
  if (expected.size !== 0) return s.fail();
}
export function captureNpcGmSource(
  view: GmRequestReviewView,
  events: readonly StoredGmRequestQueueEvent[],
): NpcGmSource {
  return sourceAt(view, events);
}
export type NpcItemReservationApply = (
  previous: JsonObject,
  input: JsonObject,
  itemInstanceId: string,
  previousContext: NpcAttemptReadContext,
  operationId: string,
) => JsonObject;
export type NpcDiseaseReservationApply = (
  previous: JsonObject,
  diseaseId: DiseaseId,
  effectInstanceId: string,
  previousContext: NpcAttemptReadContext,
  operationId: string,
) => JsonObject;
export type NpcTraumaReservationApply = (
  previous: JsonObject,
  traumaInstanceId: string,
  previousContext: NpcAttemptReadContext,
  operationId: string,
) => JsonObject;
export type NpcSymbiontReservationApply = NpcItemReservationApply;
export type NpcWoundPreparationApply = NpcItemReservationApply;
export type NpcCompositeItemReservationApply = (
  previous: JsonObject,
  input: unknown,
  binding: NpcLinkedSetBinding,
  previousContext: NpcAttemptReadContext,
  operationId: string,
) => JsonObject;
export type NpcCompositionAuthoringApply = (
  operation: NpcOperation,
  event: NpcAttemptEvent,
  previous: NpcAttemptEvent,
  previousContext: NpcAttemptReadContext,
) => JsonObject;
export type NpcArtPreparationApply = (
  previous: JsonObject,
  preparation: JsonObject,
  previousContext: NpcAttemptReadContext,
) => JsonObject;
export type NpcStageApply = (
  previous: JsonObject,
  stage: NpcStage,
  input: JsonObject,
  context?: NpcAttemptReadContext | null,
) => JsonObject;
/** Called under the NPC store's existing guarded callback. It never reads the current full NPC closure. */
export function validateNpcHistoricalGmSource(
  db: Database.Database,
  events: readonly StoredGmRequestQueueEvent[],
  operation: NpcOperation,
  event: NpcAttemptEvent,
  previous: NpcAttemptEvent | null,
  applyEditorStage: NpcStageApply,
  reservation?: Readonly<{
    previousContext: NpcAttemptReadContext;
    apply: NpcItemReservationApply;
  }>,
  previousContext?: NpcAttemptReadContext | null,
  applyArt?: NpcArtPreparationApply,
  applyDisease?: NpcDiseaseReservationApply,
  applyTrauma?: NpcTraumaReservationApply,
  applySymbiont?: NpcSymbiontReservationApply,
  applyComposition?: NpcCompositionAuthoringApply,
  applyWound?: NpcWoundPreparationApply,
  applyEquipment?: NpcArtPreparationApply,
  applyComposite?: NpcCompositeItemReservationApply,
  applyRuntimeEffect?: NpcCompositionAuthoringApply,
  applyCustomItem?: NpcCompositionAuthoringApply,
  applyLifeState?: NpcCompositionAuthoringApply,
  applyItemRestore?: NpcCompositionAuthoringApply,
  applyWeaverState?: NpcCompositionAuthoringApply,
  applyPoison?: NpcCompositionAuthoringApply,
): void {
  const index = events.findIndex((e) => e.eventId === operation.beforeGmSource.queuePrefix.eventId);
  if (index < 0) return s.fail();
  const prefix = events.slice(0, index + 1),
    view = prefix.at(-1)?.view ?? s.fail();
  equal(operation.beforeGmSource, sourceAt(view, prefix));
  const cause = { operationId: operation.operationId, recordSha256: digest(operation) };
  const raw = readNpcGmPrimitiveCause(db, operation.scope, cause);
  equal(
    [digest(event), previous === null ? null : digest(previous)],
    [raw.event.sha256, raw.previous?.sha256 ?? null],
  );
  const reduced = reduceNpcSource(db, operation.scope, view, prefix, cause);
  const mirror = events[index + 1] ?? s.fail();
  if (mirror.mutation.kind !== 'NPC_SOURCE') return s.fail();
  equal(
    [mirror.eventId, mirror.mutation.cause, mirror.view.formId, mirror.view.npc],
    [npcSourceEventId(operation.scope, cause), cause, reduced.formId, reduced.npc],
  );
  if (
    operation.kind === 'REPLACE' &&
    operation.request['messageType'] === 'network.npc-editor.replace'
  ) {
    const r = npcTechnicalRequestValue(operation.request);
    if (
      r.messageType !== 'network.npc-editor.replace' ||
      previous === null ||
      typeof applyEditorStage !== 'function'
    )
      return s.fail();
    equal(
      npcSynchronousValidator(applyEditorStage)(
        previous.attempt.values,
        r.sourceFormId,
        r.values,
        previousContext,
      ),
      event.attempt.values,
    );
  } else if (operation.request['messageType'] === 'network.npc-preparation.request') {
    const r = draftMutation(operation.request),
      fact = raw.event.childAllocations[0];
    if (
      operation.kind !== 'REPLACE' ||
      r.messageType !== 'network.npc-preparation.request' ||
      previous === null
    )
      return s.fail();
    if (r.sourceFormId === 'NPC-013') {
      if (previousContext == null) return s.fail();
      equal(
        [
          previousContext.scope,
          previousContext.npcDraftId,
          previousContext.revision,
          previousContext.pendingItemOrNull,
          previousContext.pendingEffectOrNull,
          previousContext.pendingTraumaOrNull,
          previousContext.pendingSymbiontOrNull,
        ],
        [
          previous.attempt.scope,
          previous.attempt.npcDraftId,
          previous.attempt.revision,
          null,
          null,
          null,
          null,
        ],
      );
      if (r.preparation.kind === 'SYMBIONT_RESERVE') {
        if (
          raw.event.childAllocations.length !== 1 ||
          fact?.kind !== 'SYMBIONT_INSTANCE' ||
          applySymbiont === undefined
        )
          return s.fail();
        equal(
          npcSynchronousValidator(applySymbiont)(
            previous.attempt.values,
            r.preparation.values,
            fact.id,
            previousContext,
            operation.operationId,
          ),
          event.attempt.values,
        );
      } else {
        if (
          raw.event.childAllocations.length !== 0 ||
          applyComposition === undefined ||
          raw.event.ordinaryFactOrNull === null
        )
          return s.fail();
        equal(
          npcSynchronousValidator(applyComposition)(operation, event, previous, previousContext),
          event.attempt.values,
        );
      }
      return;
    }
    if (r.sourceFormId === 'NPC-002') {
      if (
        raw.event.childAllocations.length !== 0 ||
        previousContext == null ||
        applyArt === undefined
      )
        return s.fail();
      equal(
        [
          previousContext.scope,
          previousContext.npcDraftId,
          previousContext.revision,
          previousContext.pendingItemOrNull,
          previousContext.pendingEffectOrNull,
          previousContext.pendingTraumaOrNull,
          previousContext.pendingSymbiontOrNull,
        ],
        [
          previous.attempt.scope,
          previous.attempt.npcDraftId,
          previous.attempt.revision,
          null,
          null,
          null,
          null,
        ],
      );
      equal(
        npcSynchronousValidator(applyArt)(previous.attempt.values, r.preparation, previousContext),
        event.attempt.values,
      );
      return;
    }
    if (r.preparation.kind === 'DISEASE_RESERVE') {
      if (
        raw.event.childAllocations.length !== 1 ||
        fact?.kind !== 'EFFECT_INSTANCE' ||
        !('diseaseId' in fact) ||
        fact.diseaseId !== r.preparation.diseaseId ||
        previousContext == null ||
        applyDisease === undefined
      )
        return s.fail();
      equal(
        [
          previousContext.scope,
          previousContext.npcDraftId,
          previousContext.revision,
          previousContext.pendingItemOrNull,
          previousContext.pendingEffectOrNull,
          previousContext.pendingTraumaOrNull,
          previousContext.pendingSymbiontOrNull,
        ],
        [
          previous.attempt.scope,
          previous.attempt.npcDraftId,
          previous.attempt.revision,
          null,
          null,
          null,
          null,
        ],
      );
      equal(
        npcSynchronousValidator(applyDisease)(
          previous.attempt.values,
          r.preparation.diseaseId,
          fact.id,
          previousContext,
          operation.operationId,
        ),
        event.attempt.values,
      );
      return;
    }
    if (
      r.preparation.kind === 'ALCOHOL_PREPARE' ||
      r.preparation.kind === 'HP_MODE_PREPARE' ||
      r.preparation.kind === 'FORMAL_CONTROL_SET'
    ) {
      if (previousContext == null || applyRuntimeEffect === undefined) return s.fail();
      equal(
        npcSynchronousValidator(applyRuntimeEffect)(operation, event, previous, previousContext),
        event.attempt.values,
      );
      return;
    }
    if (
      r.preparation.kind === 'WEAVER_STATE_PREPARE' ||
      r.preparation.kind === 'WEAVER_STATE_REMOVE'
    ) {
      if (previousContext == null || applyWeaverState === undefined) return s.fail();
      equal(
        npcSynchronousValidator(applyWeaverState)(operation, event, previous, previousContext),
        event.attempt.values,
      );
      return;
    }
    if (
      r.preparation.kind === 'POISON_MODE_SET' ||
      r.preparation.kind === 'POISON_COATING_PREPARE' ||
      r.preparation.kind === 'POISON_COATING_REMOVE'
    ) {
      if (previousContext == null || applyPoison === undefined) return s.fail();
      equal(
        npcSynchronousValidator(applyPoison)(operation, event, previous, previousContext),
        event.attempt.values,
      );
      return;
    }
    if (r.preparation.kind === 'LIFE_STATE_ROLL' || r.preparation.kind === 'LIFE_STATE_SET') {
      if (previousContext == null || applyLifeState === undefined) return s.fail();
      equal(
        npcSynchronousValidator(applyLifeState)(operation, event, previous, previousContext),
        event.attempt.values,
      );
      return;
    }
    if (r.preparation.kind === 'ITEM_RESTORE') {
      if (
        previousContext == null ||
        applyItemRestore === undefined ||
        raw.event.childAllocations.length !== 0
      )
        return s.fail();
      equal(
        npcSynchronousValidator(applyItemRestore)(operation, event, previous, previousContext),
        event.attempt.values,
      );
      return;
    }
    if (
      r.preparation.kind === 'CUSTOM_ITEM_RESERVE' ||
      r.preparation.kind === 'CUSTOM_MODIFIER_RESERVE' ||
      r.preparation.kind === 'CUSTOM_PROFILE_VERSION_RESERVE'
    ) {
      if (previousContext == null || applyCustomItem === undefined) return s.fail();
      equal(
        npcSynchronousValidator(applyCustomItem)(operation, event, previous, previousContext),
        event.attempt.values,
      );
      return;
    }
    if (r.preparation.kind === 'COMPOSITE_ITEM_RESERVE') {
      const [set, first, second] = raw.event.childAllocations;
      if (
        previousContext == null ||
        applyComposite === undefined ||
        raw.event.childAllocations.length !== 3 ||
        set?.kind !== 'LINKED_SET' ||
        first?.kind !== 'ITEM' ||
        second?.kind !== 'ITEM'
      )
        return s.fail();
      const binding = npcLinkedSetBindingValue({
        linkedSetInstanceId: set.id,
        itemTypeId: set.itemTypeId,
        components: [
          {
            itemInstanceId: first.id,
            componentRole: set.itemTypeId === 'ITM-WPN-026' ? 'SWORD' : 'RAPIER',
          },
          { itemInstanceId: second.id, componentRole: 'SHIELD' },
        ],
      });
      equal(
        npcSynchronousValidator(applyComposite)(
          previous.attempt.values,
          r.preparation.input,
          binding,
          previousContext,
          operation.operationId,
        ),
        event.attempt.values,
      );
      return;
    }
    if (r.preparation.kind === 'EQUIPMENT_COMPATIBILITY_CONFIRM') {
      if (
        raw.event.childAllocations.length !== 0 ||
        previousContext == null ||
        applyEquipment === undefined
      )
        return s.fail();
      equal(
        [previousContext.scope, previousContext.npcDraftId, previousContext.revision],
        [previous.attempt.scope, previous.attempt.npcDraftId, previous.attempt.revision],
      );
      equal(
        npcSynchronousValidator(applyEquipment)(
          previous.attempt.values,
          r.preparation.input,
          previousContext,
        ),
        event.attempt.values,
      );
      return;
    }
    if (r.preparation.kind === 'WOUND_PREPARE') {
      if (
        raw.event.childAllocations.length !== 1 ||
        fact?.kind !== 'WOUND_INSTANCE' ||
        previousContext == null ||
        applyWound === undefined
      )
        return s.fail();
      equal(
        [
          previousContext.scope,
          previousContext.npcDraftId,
          previousContext.revision,
          previousContext.pendingWoundOrNull,
        ],
        [previous.attempt.scope, previous.attempt.npcDraftId, previous.attempt.revision, null],
      );
      equal(
        npcSynchronousValidator(applyWound)(
          previous.attempt.values,
          r.preparation.input,
          fact.id,
          previousContext,
          operation.operationId,
        ),
        event.attempt.values,
      );
      return;
    }
    if (r.preparation.kind === 'TRAUMA_RESERVE') {
      if (
        raw.event.childAllocations.length !== 1 ||
        fact?.kind !== 'TRAUMA_INSTANCE' ||
        previousContext == null ||
        applyTrauma === undefined
      )
        return s.fail();
      equal(
        [
          previousContext.scope,
          previousContext.npcDraftId,
          previousContext.revision,
          previousContext.pendingItemOrNull,
          previousContext.pendingEffectOrNull,
          previousContext.pendingTraumaOrNull,
          previousContext.pendingSymbiontOrNull,
        ],
        [
          previous.attempt.scope,
          previous.attempt.npcDraftId,
          previous.attempt.revision,
          null,
          null,
          null,
          null,
        ],
      );
      equal(
        npcSynchronousValidator(applyTrauma)(
          previous.attempt.values,
          fact.id,
          previousContext,
          operation.operationId,
        ),
        event.attempt.values,
      );
      return;
    }
    if (
      reservation === undefined ||
      raw.event.childAllocations.length !== 1 ||
      fact?.kind !== 'ITEM'
    )
      return s.fail();
    equal(
      [
        reservation.previousContext.scope,
        reservation.previousContext.npcDraftId,
        reservation.previousContext.revision,
        reservation.previousContext.pendingItemOrNull,
        reservation.previousContext.pendingEffectOrNull,
        reservation.previousContext.pendingTraumaOrNull,
        reservation.previousContext.pendingSymbiontOrNull,
      ],
      [
        previous.attempt.scope,
        previous.attempt.npcDraftId,
        previous.attempt.revision,
        null,
        null,
        null,
        null,
      ],
    );
    equal(
      npcSynchronousValidator(reservation.apply)(
        previous.attempt.values,
        r.preparation.kind === 'ITEM_RESERVE' ? r.preparation.values : s.fail(),
        fact.id,
        reservation.previousContext,
        operation.operationId,
      ),
      event.attempt.values,
    );
  }
}

export interface NpcDiseaseReservationEvidence {
  readonly effectInstanceId: string;
  readonly diseaseId: DiseaseId;
  readonly operationId: string;
  readonly npcDraftId: string;
  readonly attemptRevision: number;
  readonly eventSha256: string;
  readonly origin: NpcVersionDerivationEvidence;
}
/**
 * The reservation's real draft determines its only possible materialization COMMIT. Reading a
 * candidate snapshot's claimed origin would allow a retained effect to acquire a new startsAt.
 * This proves primitive ownership only; the caller must check final selection and calendar proof.
 */
export function readNpcDiseaseReservationEvidenceInTransaction(
  db: Database.Database,
  scope: NpcScope,
  npcUuid: string,
  effectInstanceId: string,
  pending: NpcPendingCommitEvidence | null = null,
): NpcDiseaseReservationEvidence {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const own = npcScopeValue(scope),
    owner = s.uuid(npcUuid),
    id = s.uuid(effectInstanceId);
  const row = s.object(db.prepare('SELECT * FROM npc_child_identity WHERE child_id=?').get(id), [
    'child_id',
    'campaign_id',
    'owner_npc_uuid',
    'origin_draft_id',
    'origin_operation_id',
    'ordinal',
    'kind',
    'item_instance_id',
    'weapon_variant_id',
  ]);
  equal(
    [
      row['child_id'],
      row['campaign_id'],
      row['owner_npc_uuid'],
      row['kind'],
      row['item_instance_id'],
      row['weapon_variant_id'],
      row['ordinal'],
    ],
    [id, own.campaignId, owner, 'EFFECT_INSTANCE', null, null, 1],
  );
  const reservationId = s.uuid(row['origin_operation_id']),
    draftId = s.uuid(row['origin_draft_id']);
  const operationRow = operationHashStatement(db).get(reservationId) as Row | undefined;
  const reservation = readNpcGmPrimitiveCause(db, own, {
    operationId: reservationId,
    recordSha256: s.hash(operationRow?.['record_sha256']),
  });
  const fact = reservation.event.childAllocations[0],
    request = draftMutation(reservation.operation.request);
  if (
    reservation.operation.kind !== 'REPLACE' ||
    reservation.event.status !== 'OPEN' ||
    reservation.event.ref.stage !== 'NPC-016' ||
    reservation.event.childAllocations.length !== 1 ||
    fact?.kind !== 'EFFECT_INSTANCE' ||
    !('diseaseId' in fact) ||
    request.messageType !== 'network.npc-preparation.request' ||
    request.sourceFormId !== 'NPC-016' ||
    request.preparation.kind !== 'DISEASE_RESERVE'
  )
    return s.fail();
  equal(
    [
      reservation.event.ref.npcDraftId,
      reservation.event.ref.candidateNpcUuid,
      fact.id,
      fact.diseaseId,
    ],
    [draftId, owner, id, request.preparation.diseaseId],
  );
  const headRow = db
    .prepare('SELECT * FROM npc_attempt_head WHERE campaign_id=? AND draft_id=?')
    .get(own.campaignId, draftId) as Row | undefined;
  if (headRow === undefined) return s.fail();
  const head = attemptHeader(
    db
      .prepare(
        'SELECT * FROM npc_attempt_event WHERE campaign_id=? AND draft_id=? ORDER BY revision DESC LIMIT 1',
      )
      .get(own.campaignId, draftId) as Row | undefined,
    own,
  );
  equal(
    [
      headRow['campaign_id'],
      headRow['draft_id'],
      headRow['revision'],
      headRow['record_sha256'],
      head.ref.candidateNpcUuid,
    ],
    [own.campaignId, draftId, head.ref.revision, head.sha256, owner],
  );
  if (head.ref.revision < reservation.event.ref.revision || head.ref.stage !== 'NPC-017')
    return s.fail();
  let originTarget: NpcDerivationTarget;
  if (head.status === 'COMMITTED') {
    const finalRow = operationHashStatement(db).get(head.operationId) as Row | undefined;
    const final = readNpcGmPrimitiveCause(db, own, {
      operationId: head.operationId,
      recordSha256: s.hash(finalRow?.['record_sha256']),
    });
    equal(final.event, head);
    if (final.operation.kind !== 'COMMIT' && final.operation.kind !== 'COMMIT_V1') return s.fail();
    const version = final.operation.versionOrNull ?? s.fail();
    originTarget = {
      scope: own,
      npcUuid: owner,
      npcDraftId: draftId,
      openAttemptRevision: head.ref.revision - 1,
      commitOperationId: final.operation.operationId,
      targetVersion: version.version,
    };
  } else if (head.status === 'OPEN' && pending !== null) {
    const boundary = npcPendingCommitEvidenceValue(pending);
    equal(
      [boundary.scope, boundary.npcUuid, boundary.npcDraftId, boundary.attemptRevision],
      [own, owner, draftId, head.ref.revision + 1],
    );
    const version =
      head.ref.targetOrNull === null ? 1 : head.ref.targetOrNull.expectedCurrentVersion + 1;
    equal(boundary.version, version);
    originTarget = {
      scope: own,
      npcUuid: owner,
      npcDraftId: draftId,
      openAttemptRevision: head.ref.revision,
      commitOperationId: boundary.operationId,
      targetVersion: version,
    };
  } else return s.fail();
  // The full metadata prefix proves the head/root/COMMIT relation without calling any domain reader.
  const origin = readNpcVersionDerivationEvidenceInTransaction(db, originTarget);
  return {
    effectInstanceId: id,
    diseaseId: fact.diseaseId,
    operationId: reservationId,
    npcDraftId: draftId,
    attemptRevision: reservation.event.ref.revision,
    eventSha256: reservation.event.sha256,
    origin,
  };
}

export interface NpcTraumaReservationEvidence {
  readonly traumaInstanceId: string;
  readonly operationId: string;
  readonly npcDraftId: string;
  readonly attemptRevision: number;
  readonly eventSha256: string;
  readonly origin: NpcVersionDerivationEvidence;
}
/**
 * The reservation's real draft determines its only possible materialization COMMIT. Reading a
 * candidate snapshot's claimed origin would allow retained trauma facts to acquire a new source.
 * This proves primitive ownership only; the caller must check final selection and calendar proof.
 */
function readNpcReservedChildOrigin(
  db: Database.Database,
  scope: NpcScope,
  npcUuid: string,
  childId: string,
  kind:
    | 'TRAUMA_INSTANCE'
    | 'SYMBIONT_INSTANCE'
    | 'WOUND_INSTANCE'
    | 'EFFECT_INSTANCE'
    | 'COATING_INSTANCE',
  pending: NpcPendingCommitEvidence | null = null,
) {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const own = npcScopeValue(scope),
    owner = s.uuid(npcUuid),
    id = s.uuid(childId);
  const row = s.object(db.prepare('SELECT * FROM npc_child_identity WHERE child_id=?').get(id), [
    'child_id',
    'campaign_id',
    'owner_npc_uuid',
    'origin_draft_id',
    'origin_operation_id',
    'ordinal',
    'kind',
    'item_instance_id',
    'weapon_variant_id',
  ]);
  equal(
    [
      row['child_id'],
      row['campaign_id'],
      row['owner_npc_uuid'],
      row['kind'],
      row['item_instance_id'],
      row['weapon_variant_id'],
      row['ordinal'],
    ],
    [
      id,
      own.campaignId,
      owner,
      kind,
      kind === 'COATING_INSTANCE' ? s.uuid(row['item_instance_id']) : null,
      null,
      1,
    ],
  );
  const reservationId = s.uuid(row['origin_operation_id']),
    draftId = s.uuid(row['origin_draft_id']);
  const operationRow = operationHashStatement(db).get(reservationId) as Row | undefined;
  const reservation = readNpcGmPrimitiveCause(db, own, {
    operationId: reservationId,
    recordSha256: s.hash(operationRow?.['record_sha256']),
  });
  const fact = reservation.event.childAllocations[0],
    request = draftMutation(reservation.operation.request);
  if (
    reservation.operation.kind !== 'REPLACE' ||
    reservation.event.status !== 'OPEN' ||
    reservation.event.ref.stage !==
      (kind === 'SYMBIONT_INSTANCE'
        ? 'NPC-013'
        : kind === 'COATING_INSTANCE'
          ? 'NPC-015'
          : 'NPC-016') ||
    reservation.event.childAllocations.length !== 1 ||
    fact?.kind !== kind ||
    request.messageType !== 'network.npc-preparation.request' ||
    request.sourceFormId !==
      (kind === 'SYMBIONT_INSTANCE'
        ? 'NPC-013'
        : kind === 'COATING_INSTANCE'
          ? 'NPC-015'
          : 'NPC-016') ||
    request.preparation.kind !==
      (kind === 'TRAUMA_INSTANCE'
        ? 'TRAUMA_RESERVE'
        : kind === 'WOUND_INSTANCE'
          ? 'WOUND_PREPARE'
          : kind === 'COATING_INSTANCE'
            ? 'POISON_COATING_PREPARE'
            : kind === 'EFFECT_INSTANCE' && fact?.kind === 'EFFECT_INSTANCE' && 'sourceKind' in fact
              ? fact.sourceKind === 'ALCOHOL'
                ? 'ALCOHOL_PREPARE'
                : fact.sourceKind === 'HP_MODE'
                  ? 'HP_MODE_PREPARE'
                  : fact.sourceKind === 'LIFE_TIMER'
                    ? 'LIFE_STATE_SET'
                    : fact.sourceKind === 'WEAVER_STATE'
                      ? 'WEAVER_STATE_PREPARE'
                      : fact.sourceKind === 'POISON_MODE'
                        ? 'POISON_MODE_SET'
                        : 'FORMAL_CONTROL_SET'
              : 'SYMBIONT_RESERVE')
  )
    return s.fail();
  equal(
    [reservation.event.ref.npcDraftId, reservation.event.ref.candidateNpcUuid, fact.id],
    [draftId, owner, id],
  );
  if (fact.kind === 'COATING_INSTANCE') {
    if (request.preparation.kind !== 'POISON_COATING_PREPARE') return s.fail();
    equal(
      [fact.itemInstanceId, fact.sourceInstanceId],
      [row['item_instance_id'], request.preparation.input.sourceInstanceId],
    );
    equal(fact.itemInstanceId, request.preparation.input.targetItemInstanceId);
  }
  const headRow = db
    .prepare('SELECT * FROM npc_attempt_head WHERE campaign_id=? AND draft_id=?')
    .get(own.campaignId, draftId) as Row | undefined;
  if (headRow === undefined) return s.fail();
  const head = attemptHeader(
    db
      .prepare(
        'SELECT * FROM npc_attempt_event WHERE campaign_id=? AND draft_id=? ORDER BY revision DESC LIMIT 1',
      )
      .get(own.campaignId, draftId) as Row | undefined,
    own,
  );
  equal(
    [
      headRow['campaign_id'],
      headRow['draft_id'],
      headRow['revision'],
      headRow['record_sha256'],
      head.ref.candidateNpcUuid,
    ],
    [own.campaignId, draftId, head.ref.revision, head.sha256, owner],
  );
  if (head.ref.revision < reservation.event.ref.revision || head.ref.stage !== 'NPC-017')
    return s.fail();
  let originTarget: NpcDerivationTarget;
  if (head.status === 'COMMITTED') {
    const finalRow = operationHashStatement(db).get(head.operationId) as Row | undefined;
    const final = readNpcGmPrimitiveCause(db, own, {
      operationId: head.operationId,
      recordSha256: s.hash(finalRow?.['record_sha256']),
    });
    equal(final.event, head);
    if (final.operation.kind !== 'COMMIT' && final.operation.kind !== 'COMMIT_V1') return s.fail();
    const version = final.operation.versionOrNull ?? s.fail();
    originTarget = {
      scope: own,
      npcUuid: owner,
      npcDraftId: draftId,
      openAttemptRevision: head.ref.revision - 1,
      commitOperationId: final.operation.operationId,
      targetVersion: version.version,
    };
  } else if (head.status === 'OPEN' && pending !== null) {
    const boundary = npcPendingCommitEvidenceValue(pending);
    equal(
      [boundary.scope, boundary.npcUuid, boundary.npcDraftId, boundary.attemptRevision],
      [own, owner, draftId, head.ref.revision + 1],
    );
    const version =
      head.ref.targetOrNull === null ? 1 : head.ref.targetOrNull.expectedCurrentVersion + 1;
    equal(boundary.version, version);
    originTarget = {
      scope: own,
      npcUuid: owner,
      npcDraftId: draftId,
      openAttemptRevision: head.ref.revision,
      commitOperationId: boundary.operationId,
      targetVersion: version,
    };
  } else return s.fail();
  // The full metadata prefix proves the head/root/COMMIT relation without calling any domain reader.
  const origin = readNpcVersionDerivationEvidenceInTransaction(db, originTarget);
  return {
    childId: id,
    operationId: reservationId,
    npcDraftId: draftId,
    attemptRevision: reservation.event.ref.revision,
    eventSha256: reservation.event.sha256,
    origin,
  };
}

export function readNpcTraumaReservationEvidenceInTransaction(
  db: Database.Database,
  scope: NpcScope,
  npcUuid: string,
  traumaInstanceId: string,
  pending: NpcPendingCommitEvidence | null = null,
): NpcTraumaReservationEvidence {
  const { childId, ...evidence } = readNpcReservedChildOrigin(
    db,
    scope,
    npcUuid,
    traumaInstanceId,
    'TRAUMA_INSTANCE',
    pending,
  );
  return { traumaInstanceId: childId, ...evidence };
}
export function readNpcSymbiontReservationEvidenceInTransaction(
  db: Database.Database,
  scope: NpcScope,
  npcUuid: string,
  symbiontInstanceId: string,
  pending: NpcPendingCommitEvidence | null = null,
) {
  const { childId, ...evidence } = readNpcReservedChildOrigin(
    db,
    scope,
    npcUuid,
    symbiontInstanceId,
    'SYMBIONT_INSTANCE',
    pending,
  );
  return { symbiontInstanceId: childId, ...evidence };
}
export function readNpcWoundReservationEvidenceInTransaction(
  db: Database.Database,
  scope: NpcScope,
  npcUuid: string,
  woundInstanceId: string,
  pending: NpcPendingCommitEvidence | null = null,
) {
  const { childId, ...evidence } = readNpcReservedChildOrigin(
    db,
    scope,
    npcUuid,
    woundInstanceId,
    'WOUND_INSTANCE',
    pending,
  );
  return { woundInstanceId: childId, ...evidence };
}
export function readNpcRuntimeEffectReservationEvidenceInTransaction(
  db: Database.Database,
  scope: NpcScope,
  npcUuid: string,
  effectInstanceId: string,
  pending: NpcPendingCommitEvidence | null = null,
) {
  const { childId, ...evidence } = readNpcReservedChildOrigin(
    db,
    scope,
    npcUuid,
    effectInstanceId,
    'EFFECT_INSTANCE',
    pending,
  );
  const fact =
    evidence.origin.current.runtimeEffectReservations.find(
      (row) => row.effectInstanceId === childId,
    ) ?? s.fail();
  equal(
    [fact.operationId, fact.npcDraftId, fact.attemptRevision, fact.eventSha256],
    [evidence.operationId, evidence.npcDraftId, evidence.attemptRevision, evidence.eventSha256],
  );
  return { ...fact, origin: evidence.origin };
}
export function readNpcCoatingReservationEvidenceInTransaction(
  db: Database.Database,
  scope: NpcScope,
  npcUuid: string,
  coatingInstanceId: string,
  pending: NpcPendingCommitEvidence | null = null,
) {
  const { childId, ...evidence } = readNpcReservedChildOrigin(
    db,
    scope,
    npcUuid,
    coatingInstanceId,
    'COATING_INSTANCE',
    pending,
  );
  const operation =
    evidence.origin.current.poisonOperations.find(
      (row) => row.operation.operationId === evidence.operationId,
    ) ?? s.fail();
  const request = npcTechnicalRequestValue(operation.operation.request);
  if (
    request.messageType !== 'network.npc-preparation.request' ||
    request.preparation.kind !== 'POISON_COATING_PREPARE'
  )
    return s.fail();
  return {
    coatingInstanceId: childId,
    ...evidence,
    request: { ...request, preparation: request.preparation },
  };
}
/** Primitive effect ownership/source only; no submitted snapshot or current draft can supply it. */
export function readNpcEffectAllocationInTransaction(
  db: Database.Database,
  scope: NpcScope,
  npcUuid: string,
  effectInstanceId: string,
) {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const own = npcScopeValue(scope),
    owner = s.uuid(npcUuid),
    id = s.uuid(effectInstanceId);
  const row = s.object(db.prepare('SELECT * FROM npc_child_identity WHERE child_id=?').get(id));
  equal(
    [
      row['child_id'],
      row['campaign_id'],
      row['owner_npc_uuid'],
      row['kind'],
      row['ordinal'],
      row['item_instance_id'],
      row['weapon_variant_id'],
    ],
    [id, own.campaignId, owner, 'EFFECT_INSTANCE', 1, null, null],
  );
  const operationId = s.uuid(row['origin_operation_id']);
  const operation = operationHashStatement(db).get(operationId) as Row | undefined;
  const cause = readNpcGmPrimitiveCause(db, own, {
    operationId,
    recordSha256: s.hash(operation?.['record_sha256']),
  });
  const allocation = cause.event.childAllocations[0];
  if (
    allocation?.kind !== 'EFFECT_INSTANCE' ||
    cause.event.childAllocations.length !== 1 ||
    cause.operation.kind !== 'REPLACE' ||
    cause.event.ref.stage !== 'NPC-016' ||
    cause.event.ref.candidateNpcUuid !== owner ||
    allocation.id !== id ||
    cause.event.ref.npcDraftId !== row['origin_draft_id']
  )
    return s.fail();
  return allocation;
}

/** Read the actual custom reservation chain, never a reference asserted by the candidate sheet. */
export function readNpcCustomProfileReservationEvidenceInTransaction(
  db: Database.Database,
  scope: NpcScope,
  npcUuid: string,
  profileVersionId: string,
) {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const own = npcScopeValue(scope),
    owner = s.uuid(npcUuid);
  function child(id: string) {
    const row = s.object(
      db.prepare('SELECT * FROM npc_child_identity WHERE child_id=?').get(s.uuid(id)),
    );
    const operationId = s.uuid(row['origin_operation_id']),
      operation = operationHashStatement(db).get(operationId) as Row | undefined;
    const cause = readNpcGmPrimitiveCause(db, own, {
        operationId,
        recordSha256: s.hash(operation?.['record_sha256']),
      }),
      ordinal = s.integer(row['ordinal']);
    const allocation = cause.event.childAllocations[ordinal - 1];
    if (
      allocation === undefined ||
      (allocation.kind !== 'ITEM' &&
        allocation.kind !== 'CUSTOM_PROFILE' &&
        allocation.kind !== 'CUSTOM_PROFILE_VERSION') ||
      ordinal < 1 ||
      allocation.id !== id ||
      cause.operation.kind !== 'REPLACE' ||
      cause.event.ref.stage !== 'NPC-015' ||
      cause.event.ref.candidateNpcUuid !== owner
    )
      return s.fail();
    equal(
      [
        row['child_id'],
        row['campaign_id'],
        row['owner_npc_uuid'],
        row['origin_draft_id'],
        row['kind'],
        row['item_instance_id'],
        row['weapon_variant_id'],
      ],
      [
        id,
        own.campaignId,
        owner,
        cause.event.ref.npcDraftId,
        allocation.kind,
        'itemInstanceId' in allocation ? allocation.itemInstanceId : null,
        null,
      ],
    );
    return { allocation, cause };
  }
  const source = child(profileVersionId),
    version = source.allocation;
  if (version.kind !== 'CUSTOM_PROFILE_VERSION') return s.fail();
  const profile = child(version.profileId).allocation;
  if (profile.kind !== 'CUSTOM_PROFILE' || profile.itemInstanceId !== version.itemInstanceId)
    return s.fail();
  if (child(version.itemInstanceId).allocation.kind !== 'ITEM') return s.fail();
  let current = version;
  const visited = new Set<string>();
  while (current.previousVersionIdOrNull !== null) {
    if (visited.has(current.id)) return s.fail();
    visited.add(current.id);
    const prior = child(current.previousVersionIdOrNull).allocation;
    if (prior.kind !== 'CUSTOM_PROFILE_VERSION') return s.fail();
    equal(
      [prior.itemInstanceId, prior.profileId, s.increment(prior.version)],
      [version.itemInstanceId, version.profileId, current.version],
    );
    current = prior;
  }
  if (current.version !== 1) return s.fail();
  const binding: NpcCustomProfileBinding = {
    itemInstanceId: version.itemInstanceId,
    reference: {
      kind: profile.profileKind,
      profileId: profile.id,
      profileVersionId: version.id,
      version: version.version,
      reservationOperationId: source.cause.operation.operationId,
    },
    confirmedContentOrNull: null,
  };
  return {
    binding,
    operationId: source.cause.operation.operationId,
    npcDraftId: source.cause.event.ref.npcDraftId,
    attemptRevision: source.cause.event.ref.revision,
    eventSha256: source.cause.event.sha256,
  };
}

/** Metadata for one prospective or already recorded COMMIT; never a client authority token. */
export interface NpcDerivationTarget {
  readonly scope: NpcScope;
  readonly npcUuid: string;
  readonly npcDraftId: string;
  readonly openAttemptRevision: number;
  readonly commitOperationId: string;
  readonly targetVersion: number;
}
export type NpcAttemptDerivationTarget = Omit<NpcDerivationTarget, 'commitOperationId'> &
  Readonly<{ stage: 'NPC-016' | 'NPC-017' }>;
/** An open, checked attempt; no prospective command is reserved or claimed by this read. */
export interface NpcAttemptDerivationEvidence {
  readonly target: NpcAttemptDerivationTarget;
  readonly current: NpcDerivationPrefix;
  readonly initialOrNull: NpcStoredDerivationVersion | null;
  readonly previousOrNull: NpcStoredDerivationVersion | null;
}
export interface NpcDerivationPrefix {
  readonly poisonOperations: readonly Readonly<{
    operation: NpcOperation;
    event: NpcAttemptEvent;
    previous: NpcAttempt;
  }>[];
  readonly itemRestorations: readonly Readonly<{
    operation: NpcOperation;
    event: NpcAttemptEvent;
    previous: NpcAttempt;
    previousOperationId: string;
  }>[];
  readonly customProfileReservations: readonly Readonly<{
    profileVersionId: string;
    operationId: string;
    npcDraftId: string;
    attemptRevision: number;
    eventSha256: string;
  }>[];
  readonly compositeReservations: readonly Readonly<{
    binding: NpcLinkedSetBinding;
    operationId: string;
    npcDraftId: string;
    attemptRevision: number;
    eventSha256: string;
  }>[];
  readonly runtimeEffectReservations: readonly (NpcRuntimeEffectSource &
    Readonly<{
      effectInstanceId: string;
      operationId: string;
      npcDraftId: string;
      attemptRevision: number;
      eventSha256: string;
      input: JsonObject;
    }>)[];
  readonly runtimeEffectOperations: readonly string[];
  readonly equipmentConfirmations: readonly string[];
  readonly woundReservations: readonly Readonly<{
    woundInstanceId: string;
    operationId: string;
    npcDraftId: string;
    attemptRevision: number;
    eventSha256: string;
    input: JsonObject;
  }>[];
  readonly symbiontReservations: readonly Readonly<{
    symbiontInstanceId: string;
    operationId: string;
    npcDraftId: string;
    attemptRevision: number;
    eventSha256: string;
  }>[];
  readonly ordinaryFacts: readonly Readonly<{
    operation: NpcOperation;
    event: NpcAttemptEvent;
    previous: NpcAttempt;
    baseStatsConfirmation: NpcDerivationPrefix['baseStatsConfirmationOrNull'];
    fact: NpcOrdinaryAuthoringFact;
  }>[];
  readonly lifeStateRollFacts: readonly Readonly<{
    operation: NpcOperation;
    event: NpcAttemptEvent;
    previous: NpcAttempt;
    fact: NpcLifeStateRollFact;
  }>[];
  readonly lifeStateOperations: readonly Readonly<{
    operation: NpcOperation;
    event: NpcAttemptEvent;
    previous: NpcAttempt;
  }>[];
  readonly rootOperationId: string;
  readonly openOperationId: string;
  readonly openAttempt: NpcAttempt;
  readonly masterProfileId: string;
  /** Only original upload requests in this exact attempt prefix; bytes are never copied into later draft events. */
  readonly artUploads: readonly Readonly<{
    operationId: string;
    attemptRevision: number;
    file: JsonObject;
  }>[];
  readonly baseStatsConfirmationOrNull: Readonly<{
    operationId: string;
    attemptRevision: number;
    values: JsonObject;
  }> | null;
  readonly skillConfirmation: Readonly<{
    operationId: string;
    attemptRevision: number;
    values: JsonObject;
  }>;
  readonly inventoryConfirmationOrNull: Readonly<{
    operationId: string;
    attemptRevision: number;
    values: JsonObject;
  }> | null;
  readonly initialStateConfirmationOrNull: Readonly<{
    operationId: string;
    attemptRevision: number;
    values: JsonObject;
  }> | null;
  readonly traumaReservations: readonly Readonly<{
    traumaInstanceId: string;
    operationId: string;
    npcDraftId: string;
    attemptRevision: number;
    eventSha256: string;
  }>[];
  readonly diseaseReservations: readonly Readonly<{
    effectInstanceId: string;
    diseaseId: DiseaseId;
    operationId: string;
    npcDraftId: string;
    attemptRevision: number;
    eventSha256: string;
  }>[];
  readonly itemReservations: readonly Readonly<{
    itemInstanceId: string;
    operationId: string;
    npcDraftId: string;
    attemptRevision: number;
    eventSha256: string;
  }>[];
}
/** Opaque mechanics are intentionally not typed as a domain-validated NpcVersion. */
export interface NpcStoredDerivationVersion {
  readonly operation: NpcOperation;
  readonly record: JsonObject;
  readonly prefix: NpcDerivationPrefix;
  readonly art: JsonObject;
}
export interface NpcVersionDerivationEvidence {
  readonly target: NpcDerivationTarget;
  readonly current: NpcDerivationPrefix;
  readonly committedOrNull: NpcStoredDerivationVersion | null;
  readonly initialOrNull: NpcStoredDerivationVersion | null;
  readonly previousOrNull: NpcStoredDerivationVersion | null;
}
function derivationTarget(value: unknown): NpcDerivationTarget {
  const r = s.object(value, [
    'scope',
    'npcUuid',
    'npcDraftId',
    'openAttemptRevision',
    'commitOperationId',
    'targetVersion',
  ]);
  const targetVersion = s.integer(r['targetVersion']);
  if (targetVersion < 1) return s.fail();
  return {
    scope: npcScopeValue(r['scope']),
    npcUuid: s.uuid(r['npcUuid']),
    npcDraftId: s.uuid(r['npcDraftId']),
    openAttemptRevision: s.integer(r['openAttemptRevision']),
    commitOperationId: s.uuid(r['commitOperationId']),
    targetVersion,
  };
}
function headerAttempt(value: AttemptHeader): NpcAttempt {
  return { scope: value.scope, ...value.ref, status: value.status, values: value.values };
}
type NpcCompositionDerivationPrefix = Omit<NpcDerivationPrefix, 'skillConfirmation'> &
  Readonly<{ skillConfirmation: NpcDerivationPrefix['skillConfirmation'] | null }>;
function readDerivationPrefix(
  db: Database.Database,
  t: Omit<NpcDerivationTarget, 'commitOperationId'>,
  expectedStage: NpcStage,
): NpcCompositionDerivationPrefix {
  const rows = db
    .prepare(
      'SELECT * FROM npc_attempt_event WHERE campaign_id=? AND draft_id=? AND revision<=? ORDER BY revision',
    )
    .all(t.scope.campaignId, t.npcDraftId, t.openAttemptRevision) as Row[];
  if (rows.length !== t.openAttemptRevision + 1) return s.fail();
  let root: string | null = null,
    last: AttemptHeader | null = null;
  let skillConfirmation: NpcDerivationPrefix['skillConfirmation'] | null = null;
  let baseStatsConfirmationOrNull: NpcDerivationPrefix['baseStatsConfirmationOrNull'] = null;
  let inventoryConfirmationOrNull: NpcDerivationPrefix['inventoryConfirmationOrNull'] = null;
  const itemReservations: Array<NpcDerivationPrefix['itemReservations'][number]> = [];
  const itemRestorations: Array<NpcDerivationPrefix['itemRestorations'][number]> = [];
  const diseaseReservations: Array<NpcDerivationPrefix['diseaseReservations'][number]> = [];
  const traumaReservations: Array<NpcDerivationPrefix['traumaReservations'][number]> = [];
  const woundReservations: Array<NpcDerivationPrefix['woundReservations'][number]> = [];
  const symbiontReservations: Array<NpcDerivationPrefix['symbiontReservations'][number]> = [];
  const ordinaryFacts: Array<NpcDerivationPrefix['ordinaryFacts'][number]> = [];
  const lifeStateRollFacts: Array<NpcDerivationPrefix['lifeStateRollFacts'][number]> = [];
  const lifeStateOperations: Array<NpcDerivationPrefix['lifeStateOperations'][number]> = [];
  let initialStateConfirmationOrNull: NpcDerivationPrefix['initialStateConfirmationOrNull'] = null;
  const artUploads: Array<NpcDerivationPrefix['artUploads'][number]> = [];
  const equipmentConfirmations: string[] = [];
  const compositeReservations: Array<NpcDerivationPrefix['compositeReservations'][number]> = [];
  const customProfileReservations: Array<NpcDerivationPrefix['customProfileReservations'][number]> =
    [];
  const runtimeEffectReservations: Array<NpcDerivationPrefix['runtimeEffectReservations'][number]> =
    [];
  const runtimeEffectOperations: string[] = [];
  const poisonOperations: Array<NpcDerivationPrefix['poisonOperations'][number]> = [];
  // The two parsed event witnesses live only in this call; cause verification still rereads SQL.
  const queries = causeQueries(db);
  let previousCheckedRow: CheckedAttemptRow | null = null;
  let operationHashQuery: Database.Statement | undefined;
  for (const [revision, row] of rows.entries()) {
    const checkedRow = checkedAttemptRow(row, t.scope);
    const event = checkedRow.header;
    equal(
      [event.ref.npcDraftId, event.ref.candidateNpcUuid, event.ref.revision, event.status],
      [t.npcDraftId, t.npcUuid, revision, 'OPEN'],
    );
    equal(event.previousSha256OrNull, last?.sha256 ?? null);
    const operationRow = (operationHashQuery ??= operationHashStatement(db)).get(
      event.operationId,
    ) as Row | undefined;
    const cause = verifyNpcGmPrimitiveCause(
      db,
      t.scope,
      {
        operationId: event.operationId,
        recordSha256: s.hash(operationRow?.['record_sha256']),
      },
      queries,
      { current: checkedRow, previous: previousCheckedRow },
    ).proof;
    // An identical deeply frozen header already passed the fresh SQL row and scope check.
    // A separately decoded header still requires the original complete equality check.
    if (cause.event !== event) equal(cause.event, event);
    if (event.ordinaryFactOrNull !== null) {
      if (last === null) return s.fail();
      ordinaryFacts.push({
        operation: cause.operation,
        event: checkedRow.envelope,
        previous: headerAttempt(last),
        baseStatsConfirmation: baseStatsConfirmationOrNull,
        fact: event.ordinaryFactOrNull,
      });
    }
    if (event.lifeStateFactOrNull !== null) {
      if (last === null || lifeStateRollFacts.length !== 0) return s.fail();
      lifeStateRollFacts.push({
        operation: cause.operation,
        event: checkedRow.envelope,
        previous: headerAttempt(last),
        fact: event.lifeStateFactOrNull,
      });
    }
    if (cause.operation.request['messageType'] === 'network.npc-preparation.request') {
      const request = npcTechnicalRequestValue(cause.operation.request);
      if (
        request.messageType === 'network.npc-preparation.request' &&
        (request.preparation.kind === 'POISON_MODE_SET' ||
          request.preparation.kind === 'POISON_COATING_PREPARE' ||
          request.preparation.kind === 'POISON_COATING_REMOVE')
      ) {
        if (last === null) return s.fail();
        poisonOperations.push({
          operation: cause.operation,
          event: checkedRow.envelope,
          previous: headerAttempt(last),
        });
      }
      if (
        request.messageType === 'network.npc-preparation.request' &&
        request.preparation.kind === 'EQUIPMENT_COMPATIBILITY_CONFIRM'
      )
        equipmentConfirmations.push(event.operationId);
      if (
        request.messageType === 'network.npc-preparation.request' &&
        (request.preparation.kind === 'ALCOHOL_PREPARE' ||
          request.preparation.kind === 'HP_MODE_PREPARE' ||
          request.preparation.kind === 'FORMAL_CONTROL_SET')
      )
        runtimeEffectOperations.push(event.operationId);
      if (
        request.messageType === 'network.npc-preparation.request' &&
        (request.preparation.kind === 'LIFE_STATE_ROLL' ||
          request.preparation.kind === 'LIFE_STATE_SET')
      ) {
        if (last === null) return s.fail();
        lifeStateOperations.push({
          operation: cause.operation,
          event: checkedRow.envelope,
          previous: headerAttempt(last),
        });
      }
      if (
        request.messageType === 'network.npc-preparation.request' &&
        request.preparation.kind === 'ITEM_RESTORE'
      ) {
        if (last === null || event.ref.stage !== 'NPC-015' || event.childAllocations.length !== 0)
          return s.fail();
        itemRestorations.push({
          operation: cause.operation,
          event: checkedRow.envelope,
          previous: headerAttempt(last),
          previousOperationId: last.operationId,
        });
      }
    }
    if (revision === 0) {
      root = event.operationId;
      equal(cause.operation.kind, t.targetVersion === 1 ? 'CREATE' : 'OPEN');
    } else if (cause.operation.kind !== 'REPLACE') return s.fail();
    if (
      cause.operation.request['messageType'] === 'navigation.form-action' &&
      cause.operation.request['sourceFormId'] === 'NPC-012' &&
      event.ref.stage === 'NPC-013' &&
      ['NPC-012::CTA::001', 'NPC-012::CTA::003'].includes(
        s.text(cause.operation.request['actionKey']),
      )
    )
      baseStatsConfirmationOrNull = {
        operationId: event.operationId,
        attemptRevision: revision,
        values: event.values,
      };
    if (
      cause.operation.request['messageType'] === 'navigation.form-action' &&
      cause.operation.request['sourceFormId'] === 'NPC-014' &&
      event.ref.stage === 'NPC-015' &&
      ['NPC-014::CTA::001', 'NPC-014::CTA::003'].includes(
        s.text(cause.operation.request['actionKey']),
      )
    ) {
      skillConfirmation = {
        operationId: event.operationId,
        attemptRevision: revision,
        values: event.values,
      };
    }
    if (
      cause.operation.request['messageType'] === 'navigation.form-action' &&
      cause.operation.request['sourceFormId'] === 'NPC-015' &&
      event.ref.stage === 'NPC-016' &&
      ['NPC-015::CTA::001', 'NPC-015::CTA::003'].includes(
        s.text(cause.operation.request['actionKey']),
      )
    )
      inventoryConfirmationOrNull = {
        operationId: event.operationId,
        attemptRevision: revision,
        values: event.values,
      };
    if (
      cause.operation.request['messageType'] === 'navigation.form-action' &&
      cause.operation.request['sourceFormId'] === 'NPC-016' &&
      event.ref.stage === 'NPC-017' &&
      ['NPC-016::CTA::001', 'NPC-016::CTA::003'].includes(
        s.text(cause.operation.request['actionKey']),
      )
    )
      initialStateConfirmationOrNull = {
        operationId: event.operationId,
        attemptRevision: revision,
        values: event.values,
      };
    if (cause.operation.request['messageType'] === 'network.npc-preparation.request') {
      const request = draftMutation(cause.operation.request);
      if (request.messageType !== 'network.npc-preparation.request') return s.fail();
      if (request.sourceFormId === 'NPC-002' && request.preparation.kind === 'ART_UPLOAD')
        artUploads.push({
          operationId: event.operationId,
          attemptRevision: revision,
          file: request.preparation.file,
        });
    }
    for (const fact of event.childAllocations)
      if (fact.kind === 'ITEM')
        itemReservations.push({
          itemInstanceId: fact.id,
          operationId: event.operationId,
          npcDraftId: event.ref.npcDraftId,
          attemptRevision: revision,
          eventSha256: event.sha256,
        });
      else if (fact.kind === 'CUSTOM_PROFILE_VERSION')
        customProfileReservations.push({
          profileVersionId: fact.id,
          operationId: event.operationId,
          npcDraftId: event.ref.npcDraftId,
          attemptRevision: revision,
          eventSha256: event.sha256,
        });
      else if (fact.kind === 'LINKED_SET') {
        const parts = event.childAllocations.filter((c) => c.kind === 'ITEM');
        if (parts.length !== 2) return s.fail();
        compositeReservations.push({
          binding: npcLinkedSetBindingValue({
            linkedSetInstanceId: fact.id,
            itemTypeId: fact.itemTypeId,
            components: parts.map((part, index) => ({
              itemInstanceId: part.id,
              componentRole:
                index === 1 ? 'SHIELD' : fact.itemTypeId === 'ITM-WPN-026' ? 'SWORD' : 'RAPIER',
            })),
          }),
          operationId: event.operationId,
          npcDraftId: event.ref.npcDraftId,
          attemptRevision: revision,
          eventSha256: event.sha256,
        });
      } else if (fact.kind === 'SYMBIONT_INSTANCE')
        symbiontReservations.push({
          symbiontInstanceId: fact.id,
          operationId: event.operationId,
          npcDraftId: event.ref.npcDraftId,
          attemptRevision: revision,
          eventSha256: event.sha256,
        });
      else if (fact.kind === 'TRAUMA_INSTANCE')
        traumaReservations.push({
          traumaInstanceId: fact.id,
          operationId: event.operationId,
          npcDraftId: event.ref.npcDraftId,
          attemptRevision: revision,
          eventSha256: event.sha256,
        });
      else if (fact.kind === 'WOUND_INSTANCE') {
        const request = draftMutation(cause.operation.request);
        if (
          request.messageType !== 'network.npc-preparation.request' ||
          request.preparation.kind !== 'WOUND_PREPARE'
        )
          return s.fail();
        woundReservations.push({
          woundInstanceId: fact.id,
          operationId: event.operationId,
          npcDraftId: event.ref.npcDraftId,
          attemptRevision: revision,
          eventSha256: event.sha256,
          input: request.preparation.input,
        });
      } else if (fact.kind === 'EFFECT_INSTANCE' && 'sourceKind' in fact) {
        const request = draftMutation(cause.operation.request);
        if (
          request.messageType !== 'network.npc-preparation.request' ||
          (request.preparation.kind !== 'ALCOHOL_PREPARE' &&
            request.preparation.kind !== 'HP_MODE_PREPARE' &&
            request.preparation.kind !== 'FORMAL_CONTROL_SET' &&
            request.preparation.kind !== 'LIFE_STATE_SET' &&
            request.preparation.kind !== 'WEAVER_STATE_PREPARE' &&
            request.preparation.kind !== 'POISON_MODE_SET')
        )
          return s.fail();
        runtimeEffectReservations.push({
          effectInstanceId: fact.id,
          ...npcRuntimeEffectAllocationSource(fact),
          operationId: event.operationId,
          npcDraftId: event.ref.npcDraftId,
          attemptRevision: revision,
          eventSha256: event.sha256,
          input: JSON.parse(s.canonical(request.preparation.input)) as JsonObject,
        });
      } else if (fact.kind === 'EFFECT_INSTANCE' && 'diseaseId' in fact)
        diseaseReservations.push({
          effectInstanceId: fact.id,
          diseaseId: fact.diseaseId,
          operationId: event.operationId,
          npcDraftId: event.ref.npcDraftId,
          attemptRevision: revision,
          eventSha256: event.sha256,
        });
    last = event;
    previousCheckedRow = checkedRow;
  }
  if (root === null || last === null || last.ref.stage !== expectedStage) return s.fail();
  equal(
    [last.ref.mode, last.ref.targetOrNull],
    t.targetVersion === 1
      ? ['CREATE_V1', null]
      : ['APPEND_N_PLUS_ONE', { npcUuid: t.npcUuid, expectedCurrentVersion: t.targetVersion - 1 }],
  );
  const gm = readLocalGmContext(db, t.scope.gmLocalContextId);
  equal(gm.ownerDeviceId, t.scope.ownerDeviceId);
  return {
    rootOperationId: root,
    equipmentConfirmations,
    compositeReservations,
    customProfileReservations,
    runtimeEffectReservations,
    poisonOperations,
    runtimeEffectOperations,
    openOperationId: last.operationId,
    openAttempt: headerAttempt(last),
    skillConfirmation,
    baseStatsConfirmationOrNull,
    masterProfileId: gm.masterProfileId,
    inventoryConfirmationOrNull,
    itemReservations,
    diseaseReservations,
    traumaReservations,
    woundReservations,
    symbiontReservations,
    ordinaryFacts,
    lifeStateRollFacts,
    lifeStateOperations,
    itemRestorations,
    initialStateConfirmationOrNull,
    artUploads,
  };
}
function derivationPrefix(
  db: Database.Database,
  t: Omit<NpcDerivationTarget, 'commitOperationId'>,
  expectedStage: 'NPC-016' | 'NPC-017' = 'NPC-017',
): NpcDerivationPrefix {
  const result = readDerivationPrefix(db, t, expectedStage);
  if (result.skillConfirmation === null) return s.fail();
  return { ...result, skillConfirmation: result.skillConfirmation };
}
/** Exact immutable early-stage prefix; current authority is still the caller's checked writer/read boundary. */
export function readNpcEquipmentCompatibilityEvidenceInTransaction(
  db: Database.Database,
  scope: NpcScope,
  npcUuid: string,
  operationId: string,
) {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const row = operationHashStatement(db).get(s.uuid(operationId)) as Row | undefined;
  const cause = readNpcGmPrimitiveCause(db, npcScopeValue(scope), {
    operationId,
    recordSha256: s.hash(row?.['record_sha256']),
  });
  const request = npcTechnicalRequestValue(cause.operation.request);
  if (
    cause.operation.kind !== 'REPLACE' ||
    cause.event.ref.stage !== 'NPC-015' ||
    cause.event.status !== 'OPEN' ||
    cause.event.ref.candidateNpcUuid !== s.uuid(npcUuid) ||
    cause.event.childAllocations.length !== 0 ||
    request.messageType !== 'network.npc-preparation.request' ||
    request.preparation.kind !== 'EQUIPMENT_COMPATIBILITY_CONFIRM' ||
    cause.event.ref.revision < 1
  )
    return s.fail();
  const previous = attemptHeader(
    db
      .prepare('SELECT * FROM npc_attempt_event WHERE campaign_id=? AND draft_id=? AND revision=?')
      .get(scope.campaignId, cause.event.ref.npcDraftId, cause.event.ref.revision - 1) as
      Row | undefined,
    scope,
  );
  equal(previous.sha256, cause.event.previousSha256OrNull);
  equal(
    [previous.ref.stage, previous.ref.candidateNpcUuid, previous.values],
    ['NPC-015', npcUuid, cause.event.values],
  );
  const evidence = readNpcCompositionDerivationEvidenceInTransaction(db, headerAttempt(previous));
  return freezeEvidence({ operationId, input: request.preparation.input, evidence });
}
export function readNpcCompositionDerivationEvidenceInTransaction(
  db: Database.Database,
  attempt: NpcAttempt,
) {
  if (!db.inTransaction || attempt.status !== 'OPEN') return s.fail('INVALID_INPUT');
  const target = {
    scope: npcScopeValue(attempt.scope),
    npcUuid: s.uuid(attempt.candidateNpcUuid),
    npcDraftId: s.uuid(attempt.npcDraftId),
    openAttemptRevision: s.integer(attempt.revision),
    targetVersion:
      attempt.targetOrNull === null ? 1 : attempt.targetOrNull.expectedCurrentVersion + 1,
  };
  const current = readDerivationPrefix(db, target, attempt.stage);
  equal(current.openAttempt, attempt);
  const { initialOrNull, previousOrNull } = derivationOrigins(db, target, current, null);
  return freezeEvidence({ target, current, initialOrNull, previousOrNull });
}
/** A life reference names an actual NPC016 SET, never an editable candidate history object. */
export function readNpcLifeStatePreparationEvidenceInTransaction(
  db: Database.Database,
  scopeValue: NpcScope,
  npcUuidValue: string,
  operationIdValue: string,
) {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const scope = npcScopeValue(scopeValue),
    npcUuid = s.uuid(npcUuidValue),
    operationId = s.uuid(operationIdValue);
  const row = operationHashStatement(db).get(operationId) as Row | undefined;
  const cause = readNpcGmPrimitiveCause(db, scope, {
    operationId,
    recordSha256: s.hash(row?.['record_sha256']),
  });
  const request = npcTechnicalRequestValue(cause.operation.request);
  if (
    cause.operation.kind !== 'REPLACE' ||
    cause.event.ref.stage !== 'NPC-016' ||
    cause.event.status !== 'OPEN' ||
    cause.event.ref.candidateNpcUuid !== npcUuid ||
    cause.event.ref.revision < 1 ||
    request.messageType !== 'network.npc-preparation.request' ||
    request.sourceFormId !== 'NPC-016' ||
    request.preparation.kind !== 'LIFE_STATE_SET'
  )
    return s.fail();
  const previous = attemptHeader(
    db
      .prepare('SELECT * FROM npc_attempt_event WHERE campaign_id=? AND draft_id=? AND revision=?')
      .get(scope.campaignId, cause.event.ref.npcDraftId, cause.event.ref.revision - 1) as
      Row | undefined,
    scope,
  );
  equal(previous.sha256, cause.event.previousSha256OrNull);
  equal([previous.ref.stage, previous.ref.candidateNpcUuid], ['NPC-016', npcUuid]);
  const evidence = readNpcCompositionDerivationEvidenceInTransaction(db, headerAttempt(previous));
  const lifeRequest = { ...request, preparation: request.preparation };
  return freezeEvidence({
    operation: cause.operation,
    event: cause.event,
    request: lifeRequest,
    evidence,
  });
}
/** Weaver histories are reconstructed from their real PREPARE predecessor, never submitted data. */
export function readNpcWeaverStatePreparationEvidenceInTransaction(
  db: Database.Database,
  scopeValue: NpcScope,
  npcUuidValue: string,
  operationIdValue: string,
) {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const scope = npcScopeValue(scopeValue),
    npcUuid = s.uuid(npcUuidValue),
    operationId = s.uuid(operationIdValue);
  const row = operationHashStatement(db).get(operationId) as Row | undefined;
  const cause = readNpcGmPrimitiveCause(db, scope, {
    operationId,
    recordSha256: s.hash(row?.['record_sha256']),
  });
  const request = npcTechnicalRequestValue(cause.operation.request);
  if (
    cause.operation.kind !== 'REPLACE' ||
    cause.event.ref.stage !== 'NPC-016' ||
    cause.event.status !== 'OPEN' ||
    cause.event.ref.candidateNpcUuid !== npcUuid ||
    cause.event.ref.revision < 1 ||
    request.messageType !== 'network.npc-preparation.request' ||
    request.sourceFormId !== 'NPC-016' ||
    request.preparation.kind !== 'WEAVER_STATE_PREPARE'
  )
    return s.fail();
  const previous = attemptHeader(
    db
      .prepare('SELECT * FROM npc_attempt_event WHERE campaign_id=? AND draft_id=? AND revision=?')
      .get(scope.campaignId, cause.event.ref.npcDraftId, cause.event.ref.revision - 1) as
      Row | undefined,
    scope,
  );
  equal(previous.sha256, cause.event.previousSha256OrNull);
  equal([previous.ref.stage, previous.ref.candidateNpcUuid], ['NPC-016', npcUuid]);
  return freezeEvidence({
    operation: cause.operation,
    event: cause.event,
    request: { ...request, preparation: request.preparation },
    evidence: readNpcCompositionDerivationEvidenceInTransaction(db, headerAttempt(previous)),
  });
}
/** Mode/coating anchors come from the original checked operation and its exact predecessor. */
export function readNpcPoisonPreparationEvidenceInTransaction(
  db: Database.Database,
  scopeValue: NpcScope,
  npcUuidValue: string,
  operationIdValue: string,
) {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const scope = npcScopeValue(scopeValue),
    npcUuid = s.uuid(npcUuidValue),
    operationId = s.uuid(operationIdValue);
  const row = operationHashStatement(db).get(operationId) as Row | undefined;
  const cause = readNpcGmPrimitiveCause(db, scope, {
    operationId,
    recordSha256: s.hash(row?.['record_sha256']),
  });
  const request = npcTechnicalRequestValue(cause.operation.request);
  if (
    cause.operation.kind !== 'REPLACE' ||
    cause.event.status !== 'OPEN' ||
    cause.event.ref.candidateNpcUuid !== npcUuid ||
    cause.event.ref.revision < 1 ||
    request.messageType !== 'network.npc-preparation.request' ||
    (request.preparation.kind !== 'POISON_MODE_SET' &&
      request.preparation.kind !== 'POISON_COATING_PREPARE' &&
      request.preparation.kind !== 'POISON_COATING_REMOVE')
  )
    return s.fail();
  const form = request.preparation.kind === 'POISON_MODE_SET' ? 'NPC-016' : 'NPC-015';
  equal([request.sourceFormId, cause.event.ref.stage], [form, form]);
  const previous = attemptHeader(
    db
      .prepare('SELECT * FROM npc_attempt_event WHERE campaign_id=? AND draft_id=? AND revision=?')
      .get(scope.campaignId, cause.event.ref.npcDraftId, cause.event.ref.revision - 1) as
      Row | undefined,
    scope,
  );
  equal(previous.sha256, cause.event.previousSha256OrNull);
  equal([previous.ref.stage, previous.ref.candidateNpcUuid], [form, npcUuid]);
  return freezeEvidence({
    operation: cause.operation,
    event: cause.event,
    request: { ...request, preparation: request.preparation },
    evidence: readNpcCompositionDerivationEvidenceInTransaction(db, headerAttempt(previous)),
  });
}
function storedDerivationVersion(
  db: Database.Database,
  scope: NpcScope,
  npcUuid: string,
  version: number,
): NpcStoredDerivationVersion {
  const row = db
    .prepare('SELECT * FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version=?')
    .get(scope.campaignId, npcUuid, version) as Row | undefined;
  const record = checked(row);
  const op = operationHashStatement(db).get(record['operationId']) as Row | undefined;
  const cause = readNpcGmPrimitiveCause(db, scope, {
    operationId: s.uuid(record['operationId']),
    recordSha256: s.hash(op?.['record_sha256']),
  });
  equal(
    [
      row?.['campaign_id'],
      row?.['npc_uuid'],
      row?.['version'],
      record['npcUuid'],
      record['version'],
    ],
    [scope.campaignId, npcUuid, version, npcUuid, version],
  );
  if (
    cause.operation.kind !== (version === 1 ? 'COMMIT_V1' : 'COMMIT') ||
    cause.event.status !== 'COMMITTED' ||
    cause.event.ref.revision < 1
  )
    return s.fail();
  const prefix = derivationPrefix(db, {
    scope,
    npcUuid,
    npcDraftId: cause.event.ref.npcDraftId,
    openAttemptRevision: cause.event.ref.revision - 1,
    targetVersion: version,
  });
  equal(headerAttempt(cause.event), {
    ...prefix.openAttempt,
    revision: prefix.openAttempt.revision + 1,
    status: 'COMMITTED',
  });
  const artRef = s.object(record['art'], ['assetKey', 'sha256']);
  const artRow = db
    .prepare('SELECT * FROM npc_art WHERE campaign_id=? AND asset_sha256=?')
    .get(scope.campaignId, s.hash(artRef['sha256'])) as Row | undefined;
  const art = checked(artRow);
  equal(
    [artRow?.['campaign_id'], artRow?.['asset_sha256'], art['sha256']],
    [scope.campaignId, artRef['sha256'], artRef['sha256']],
  );
  return {
    operation: cause.operation,
    record: record as JsonObject,
    prefix,
    art: { ...art, assetKey: s.text(artRef['assetKey']) },
  };
}
function freezeEvidence<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeEvidence(child);
    Object.freeze(value);
  }
  return value;
}
/**
 * Inventory revisions need the actual complete NPC prefix, including versions in which an
 * item was absent. Looking only at the current head would manufacture a new provenance when
 * the same physical item returns. This reader proves SQL/cause references, not game mechanics.
 */
export function readNpcInventoryHistoryEvidenceInTransaction(
  db: Database.Database,
  scopeValue: NpcScope,
  npcUuidValue: string,
  throughVersionValue: number,
): readonly Readonly<{ version: NpcVersionRef; stored: NpcStoredDerivationVersion }>[] {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const scope = npcScopeValue(scopeValue),
    npcUuid = s.uuid(npcUuidValue),
    throughVersion = s.integer(throughVersionValue);
  if (throughVersion < 1) return s.fail('INVALID_INPUT');
  const rows = db
    .prepare(
      'SELECT version, record_sha256 FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version<=? ORDER BY version',
    )
    .all(scope.campaignId, npcUuid, throughVersion) as Row[];
  if (rows.length !== throughVersion) return s.fail();
  let previousSha256: string | null = null;
  const history = rows.map((row, index) => {
    const version = index + 1;
    equal(row['version'], version);
    const stored = storedDerivationVersion(db, scope, npcUuid, version),
      sha256 = s.hash(row['record_sha256']);
    equal(digest(stored.record), sha256);
    equal(stored.record['scope'], scope);
    equal(stored.operation.versionOrNull, { npcUuid, version, sha256 });
    equal(
      [
        stored.record['operationId'],
        stored.record['npcDraftId'],
        stored.record['attemptRevision'],
        stored.record['committedAt'],
      ],
      [
        stored.operation.operationId,
        stored.prefix.openAttempt.npcDraftId,
        stored.prefix.openAttempt.revision + 1,
        stored.operation.committedAt,
      ],
    );
    equal(stored.record['previousVersionSha256OrNull'], previousSha256);
    previousSha256 = sha256;
    return { version: { npcUuid, version, sha256 }, stored };
  });
  return freezeEvidence(history);
}
function derivationOrigins(
  db: Database.Database,
  target: Omit<NpcDerivationTarget, 'commitOperationId'>,
  current: NpcCompositionDerivationPrefix,
  committedOrNull: NpcStoredDerivationVersion | null,
) {
  const initialOrNull =
    target.targetVersion === 1
      ? committedOrNull
      : storedDerivationVersion(db, target.scope, target.npcUuid, 1);
  const initialPrefix = initialOrNull?.prefix ?? current;
  const reservation = db
    .prepare('SELECT * FROM npc_identity_reservation WHERE campaign_id=? AND draft_id=?')
    .get(target.scope.campaignId, initialPrefix.openAttempt.npcDraftId) as Row | undefined;
  equal(
    [reservation?.['candidate_npc_uuid'], reservation?.['create_operation_id']],
    [target.npcUuid, initialPrefix.rootOperationId],
  );
  const previousOrNull =
    target.targetVersion === 1
      ? null
      : target.targetVersion === 2
        ? initialOrNull
        : storedDerivationVersion(db, target.scope, target.npcUuid, target.targetVersion - 1);
  return { initialOrNull, previousOrNull };
}
function assertOpenDerivationFrontier(
  db: Database.Database,
  target: Omit<NpcDerivationTarget, 'commitOperationId'>,
  current: NpcDerivationPrefix,
): void {
  const head = db
    .prepare('SELECT * FROM npc_attempt_head WHERE campaign_id=? AND draft_id=?')
    .get(target.scope.campaignId, target.npcDraftId) as Row | undefined;
  const event = db
    .prepare(
      'SELECT * FROM npc_attempt_event WHERE campaign_id=? AND draft_id=? ORDER BY revision DESC LIMIT 1',
    )
    .get(target.scope.campaignId, target.npcDraftId) as Row | undefined;
  const checkedHead = attemptHeader(event, target.scope);
  equal(headerAttempt(checkedHead), current.openAttempt);
  equal(
    [head?.['revision'], head?.['record_sha256']],
    [target.openAttemptRevision, checkedHead.sha256],
  );
  if (
    db
      .prepare('SELECT 1 FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version>=?')
      .get(target.scope.campaignId, target.npcUuid, target.targetVersion) !== undefined
  )
    return s.fail();
  const versionHead = db
    .prepare('SELECT * FROM npc_current_head WHERE campaign_id=? AND npc_uuid=?')
    .get(target.scope.campaignId, target.npcUuid) as Row | undefined;
  if (target.targetVersion === 1) {
    if (versionHead !== undefined) return s.fail();
  } else {
    const prior = db
      .prepare(
        'SELECT record_sha256 FROM npc_version WHERE campaign_id=? AND npc_uuid=? AND version=?',
      )
      .get(target.scope.campaignId, target.npcUuid, target.targetVersion - 1) as Row | undefined;
    equal(
      [versionHead?.['version'], versionHead?.['record_sha256']],
      [target.targetVersion - 1, s.hash(prior?.['record_sha256'])],
    );
  }
}
/**
 * Bounded immutable SQL proof, called inside the owning NPC transaction after its required
 * historical GM batch. It never invokes domain callbacks or rebuilds the full NPC closure.
 * A missing COMMIT is allowed only at the exact current OPEN frontier, not in a historical hole.
 */
export function readNpcVersionDerivationEvidenceInTransaction(
  db: Database.Database,
  value: NpcDerivationTarget,
): NpcVersionDerivationEvidence {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const target = derivationTarget(value);
  const operation = db
    .prepare('SELECT operation_id FROM npc_operation WHERE operation_id=?')
    .get(target.commitOperationId);
  let committedOrNull: NpcStoredDerivationVersion | null = null;
  let current: NpcDerivationPrefix;
  if (operation !== undefined) {
    committedOrNull = storedDerivationVersion(
      db,
      target.scope,
      target.npcUuid,
      target.targetVersion,
    );
    // The stored version has already checked this exact immutable prefix. Match every
    // caller coordinate before using it, without folding the same journal a second time.
    current = committedOrNull.prefix;
    equal(
      {
        scope: current.openAttempt.scope,
        npcUuid: current.openAttempt.candidateNpcUuid,
        npcDraftId: current.openAttempt.npcDraftId,
        openAttemptRevision: current.openAttempt.revision,
        commitOperationId: committedOrNull.operation.operationId,
        targetVersion: committedOrNull.record['version'],
      },
      target,
    );
  } else {
    current = derivationPrefix(db, target);
    assertOpenDerivationFrontier(db, target, current);
  }
  const { initialOrNull, previousOrNull } = derivationOrigins(db, target, current, committedOrNull);
  return freezeEvidence({ target, current, committedOrNull, initialOrNull, previousOrNull });
}

/** Actual NPC-016 validation/017 display after the same full GM/NPC closure check as the version writer. */
export function readNpcAttemptDerivationEvidenceInTransaction(
  db: Database.Database,
  value: NpcAttemptDerivationTarget,
): NpcAttemptDerivationEvidence {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const r = s.object(value, [
    'scope',
    'npcUuid',
    'npcDraftId',
    'openAttemptRevision',
    'targetVersion',
    'stage',
  ]);
  if (r['stage'] !== 'NPC-016' && r['stage'] !== 'NPC-017') return s.fail();
  const target: NpcAttemptDerivationTarget = {
    scope: npcScopeValue(r['scope']),
    npcUuid: s.uuid(r['npcUuid']),
    npcDraftId: s.uuid(r['npcDraftId']),
    openAttemptRevision: s.integer(r['openAttemptRevision']),
    targetVersion: s.integer(r['targetVersion']),
    stage: r['stage'],
  };
  if (target.targetVersion < 1) return s.fail();
  const current = derivationPrefix(db, target, target.stage);
  assertOpenDerivationFrontier(db, target, current);
  const { initialOrNull, previousOrNull } = derivationOrigins(db, target, current, null);
  return freezeEvidence({ target, current, initialOrNull, previousOrNull });
}
