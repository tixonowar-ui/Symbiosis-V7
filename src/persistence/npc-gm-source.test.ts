import { npcAttemptReadContext, type NpcChildAllocation } from './npc-child-identities.js';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { FormActionIntentV2Message } from '@shared/wire-v2-protocol.js';
import type { NpcSelectionReplaceRequest } from '@shared/npc-command.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import type { GmRequestReviewView, StoredGmRequestQueueEvent } from './campaign-creation.js';
import type {
  NpcAttemptEvent,
  NpcOperation,
  NpcScope,
  NpcStage,
  NpcVersion,
} from './npc-library-records.js';
import {
  NPC_GM_REQUEST_READERS,
  captureNpcGmSource,
  npcContextAfterNavigation,
  npcGmContextValue,
  npcSourceEventId,
  readNpcGmPrimitiveCause,
  withNpcGmPrimitiveReadSession,
  type NpcGmPrimitiveReadSession,
  reduceNpcSelection,
  reduceNpcSource,
  validateNpcHistoricalGmSource,
  verifyNpcGmMirrorCoverage,
  type NpcGmContext,
} from './npc-gm-source.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (value: unknown) => s.sha(s.canonical(value));
const scope: NpcScope = { campaignId: id(1), gmLocalContextId: id(2), ownerDeviceId: id(3) };
const empty: NpcGmContext = {
  selectedNpcOrNull: null,
  attemptOrNull: null,
  initialTimeReturnContextOrNull: null,
};
const stamp = '2026-11-06T00:00:00.000Z';
const vector = { stateRevision: 4, projectionRevision: 6, actorVisibilityRevision: 2 };
const nav = (form: string, key: string, requestId = 'opaque-nav') =>
  ({
    messageType: 'navigation.form-action',
    protocolVersion: 2,
    sourceFormId: form,
    actionKey: `${form}::CTA::${key}`,
    expectedProjectionRevision: vector.projectionRevision,
    navigationRequestId: requestId,
  }) as FormActionIntentV2Message;
const view = (formId: GmRequestReviewView['formId'], npc?: NpcGmContext): GmRequestReviewView => ({
  schemaVersion: 1,
  ...scope,
  ...vector,
  formId,
  requestQueueRevision: 0,
  values: { selectedRequestIdOrNull: null, decisionReason: '' },
  returnContext: {
    originFormId: 'CMP-006',
    campaignId: scope.campaignId,
    creationReceiptId: id(4),
  },
  ...(npc === undefined ? {} : { npc }),
  snapshotSha256: hash({ formId, npc: npc ?? null }),
});
// These fixtures prove primitive SQL links, not a complete domain-valid NPC sheet or GM queue.
const prefix = (v: GmRequestReviewView): StoredGmRequestQueueEvent[] => [
  {
    schemaVersion: 1,
    eventId: 'prior-gm-event',
    scope,
    eventIndex: 0,
    previousEventSha256OrNull: null,
    mutation: { kind: 'NAV', request: nav('GM-001', '004'), initialQueueOrNull: null },
    view: v,
    changed: true,
    recordSha256: hash(v),
  },
];
const checkpoint = (revision = 0) => ({
  campaignId: scope.campaignId,
  snapshotJson: s.canonical({
    campaign: { campaignId: scope.campaignId, lifecycleState: 'PAUSED', payloadJson: '{}' },
    campaignCharacterCopies: [],
  }),
  stateRevision: revision,
  projectionRevision: revision,
  actorVisibilityRevision: 0,
});

describe('NPC GM primitive source and existing QUEUE bridge', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE npc_operation(operation_id TEXT PRIMARY KEY,campaign_id TEXT,kind TEXT,receipt_id TEXT,record_json TEXT,record_sha256 TEXT);
      CREATE TABLE npc_attempt_event(operation_id TEXT PRIMARY KEY,campaign_id TEXT,draft_id TEXT,revision INTEGER,record_json TEXT,record_sha256 TEXT);
      CREATE TABLE npc_version(campaign_id TEXT,npc_uuid TEXT,version INTEGER,operation_id TEXT,library_revision INTEGER,record_json TEXT,record_sha256 TEXT);`);
    db.exec('BEGIN IMMEDIATE');
  });
  afterEach(() => {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.close();
  });

  function putEvent(e: NpcAttemptEvent) {
    db.prepare('INSERT INTO npc_attempt_event VALUES (?,?,?,?,?,?)').run(
      e.operationId,
      e.attempt.scope.campaignId,
      e.attempt.npcDraftId,
      e.attempt.revision,
      s.canonical(e),
      hash(e),
    );
  }
  function putOperation(o: NpcOperation) {
    db.prepare('INSERT INTO npc_operation VALUES (?,?,?,?,?,?)').run(
      o.operationId,
      o.scope.campaignId,
      o.kind,
      o.receiptId,
      s.canonical(o),
      hash(o),
    );
  }
  function save(input: {
    old: GmRequestReviewView;
    events?: readonly StoredGmRequestQueueEvent[];
    kind?: NpcOperation['kind'];
    previous?: NpcAttemptEvent;
    stage?: NpcStage;
    request?: JsonObject;
    operationId?: string;
    values?: JsonObject;
    version?: number;
    candidate?: string;
    draft?: string;
    childAllocations?: readonly NpcChildAllocation[];
  }) {
    const kind = input.kind ?? 'CREATE',
      previous = input.previous ?? null;
    const operationId = input.operationId ?? (kind === 'CREATE' ? 'create-nav' : id(20));
    const candidate = input.candidate ?? previous?.attempt.candidateNpcUuid ?? id(10);
    const committed = kind === 'COMMIT' || kind === 'COMMIT_V1';
    const e: NpcAttemptEvent = {
      ...(input.childAllocations === undefined
        ? {}
        : { format: 'NPC_ATTEMPT_EVENT_V2' as const, childAllocations: input.childAllocations }),
      operationId,
      previousSha256OrNull: previous === null ? null : hash(previous),
      attempt: {
        scope,
        npcDraftId: input.draft ?? previous?.attempt.npcDraftId ?? id(11),
        candidateNpcUuid: candidate,
        revision: previous === null ? 0 : previous.attempt.revision + 1,
        mode: previous?.attempt.mode ?? (kind === 'OPEN' ? 'APPEND_N_PLUS_ONE' : 'CREATE_V1'),
        targetOrNull:
          previous?.attempt.targetOrNull ??
          (kind === 'OPEN' ? { npcUuid: candidate, expectedCurrentVersion: 1 } : null),
        stage: input.stage ?? previous?.attempt.stage ?? 'NPC-002',
        status: committed ? 'COMMITTED' : kind === 'CANCEL' ? 'CANCELLED' : 'OPEN',
        values: input.values ?? previous?.attempt.values ?? { opaque: 'domain-bound-elsewhere' },
      },
    };
    let versionOrNull: NpcOperation['versionOrNull'] = null;
    if (committed) {
      const v: NpcVersion = {
        scope,
        npcUuid: candidate,
        version: input.version ?? 1,
        libraryRevision: input.version ?? 1,
        operationId,
        npcDraftId: e.attempt.npcDraftId,
        attemptRevision: e.attempt.revision,
        previousVersionSha256OrNull: null,
        snapshot: { opaque: 'not-a-domain-reader' },
        lifetimeFacts: {},
        art: { assetKey: 'test-art', sha256: hash('test-art') },
        committedAt: stamp,
      };
      db.prepare('INSERT INTO npc_version VALUES (?,?,?,?,?,?,?)').run(
        scope.campaignId,
        candidate,
        v.version,
        operationId,
        v.libraryRevision,
        s.canonical(v),
        hash(v),
      );
      versionOrNull = { npcUuid: candidate, version: v.version, sha256: hash(v) };
    }
    const events = input.events ?? prefix(input.old);
    const o: NpcOperation = {
      operationId,
      receiptId: id(99),
      kind,
      scope,
      request: input.request ?? (nav('NPC-001', '001', operationId) as unknown as JsonObject),
      attemptEventSha256: hash(e),
      versionOrNull,
      anchorOrNull: committed
        ? {
            libraryRevision: input.version ?? 1,
            checkpointId: id(90),
            checkpointSha256: hash('library'),
          }
        : null,
      beforeGmSource: captureNpcGmSource(input.old, events),
      beforeCheckpoint: checkpoint(),
      afterCheckpoint: checkpoint(committed ? 1 : 0),
      committedAt: stamp,
    };
    putEvent(e);
    putOperation(o);
    return { e, o, cause: { operationId, recordSha256: hash(o) }, events };
  }
  function context(e: NpcAttemptEvent): NpcGmContext {
    const { npcDraftId, candidateNpcUuid, revision, mode, targetOrNull, stage } = e.attempt;
    return {
      ...empty,
      attemptOrNull: { npcDraftId, candidateNpcUuid, revision, mode, targetOrNull, stage },
    };
  }
  function mirror(
    old: readonly StoredGmRequestQueueEvent[],
    saved: ReturnType<typeof save>,
  ): StoredGmRequestQueueEvent {
    const source =
      old.at(-1) ??
      (() => {
        throw new Error('fixture has no prefix');
      })();
    const reduced = reduceNpcSource(db, scope, source.view, old, saved.cause);
    return {
      ...source,
      eventId: npcSourceEventId(scope, saved.cause),
      eventIndex: old.length,
      previousEventSha256OrNull: source.recordSha256,
      mutation: { kind: 'NPC_SOURCE', cause: saved.cause },
      view: view(reduced.formId, reduced.npc),
      recordSha256: hash(saved.cause),
      changed: true,
    };
  }
  function unchanged(run: () => unknown) {
    const before = db.serialize();
    expect(run).toThrow();
    expect(db.serialize().equals(before)).toBe(true);
  }
  function command(
    kind: 'COMMIT_V1' | 'OPEN' | 'COMMIT',
    operationId: string,
    previous?: NpcAttemptEvent,
  ): JsonObject {
    return {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: operationId,
      workflowCommandId: kind === 'COMMIT_V1' ? 'UI-CMD-NPC-COMMIT-V1' : 'UI-CMD-NPC-NEW-VERSION',
      expectedRevisions: vector,
      payload:
        kind === 'OPEN'
          ? {
              phase: 'OPEN',
              campaignId: scope.campaignId,
              npcUuid: id(10),
              expectedCurrentVersion: 1,
            }
          : {
              ...(kind === 'COMMIT' ? { phase: 'COMMIT', expectedCurrentVersion: 1 } : {}),
              campaignId: scope.campaignId,
              npcDraftId: previous?.attempt.npcDraftId ?? id(11),
              expectedAttemptRevision: previous?.attempt.revision ?? 0,
            },
    };
  }

  it('preserves absent NPC data in old navigation and initializes only existing GM ingress', () => {
    expect(
      npcContextAfterNavigation(db, scope, view('CMP-007'), [], nav('CMP-007', '001'), 'NET-016'),
    ).toBeUndefined();
    expect(
      npcContextAfterNavigation(db, scope, view('GM-001'), [], nav('GM-001', '004'), 'NPC-001'),
    ).toEqual(empty);
    unchanged(() =>
      npcContextAfterNavigation(db, scope, view('NPC-001'), [], nav('NPC-001', '002'), 'NPC-003'),
    );
  });
  it('retains the exact stage-016 child across safe exit and ordinary reentry, then consumes explicit return', () => {
    const a = save({ old: view('NPC-001', empty) }).e;
    const c = {
      ...context(a),
      attemptOrNull: { ...context(a).attemptOrNull!, stage: 'NPC-016' as const },
    };
    const bound: NpcGmContext = {
      ...c,
      initialTimeReturnContextOrNull: {
        campaignId: scope.campaignId,
        npcDraftId: a.attempt.npcDraftId,
        attemptRevision: a.attempt.revision,
        editMode: a.attempt.mode,
        versionBindingOrNull: null,
        returnFormId: 'NPC-016',
      },
    };
    const exited = npcContextAfterNavigation(
      db,
      scope,
      view('NET-016', bound),
      [],
      nav('NET-016', '003'),
      'CMP-007',
    );
    expect(exited).toEqual(bound);
    const returned = npcContextAfterNavigation(
      db,
      scope,
      view('CMP-007', exited),
      [],
      nav('CMP-007', '001'),
      'NET-016',
    );
    expect(returned).toEqual(bound);
    expect(
      npcContextAfterNavigation(
        db,
        scope,
        view('NET-016', returned),
        [],
        nav('NET-016', '005'),
        'NPC-016',
      ),
    ).toEqual({ ...bound, initialTimeReturnContextOrNull: null });
    unchanged(() =>
      npcContextAfterNavigation(
        db,
        scope,
        view('NET-016', empty),
        [],
        nav('NET-016', '005'),
        'NPC-016',
      ),
    );
  });
  it.each(['attemptRevision', 'npcDraftId', 'editMode', 'versionBindingOrNull'] as const)(
    'refuses mismatched child binding %s',
    (field) => {
      const a = save({ old: view('NPC-001', empty) }).e;
      const c = {
        ...context(a),
        attemptOrNull: { ...context(a).attemptOrNull!, stage: 'NPC-016' as const },
        initialTimeReturnContextOrNull: {
          campaignId: scope.campaignId,
          npcDraftId: id(11),
          attemptRevision: 0,
          editMode: 'CREATE_V1',
          versionBindingOrNull: null,
          returnFormId: 'NPC-016',
        },
      };
      const corrupt = {
        ...c,
        initialTimeReturnContextOrNull: {
          ...c.initialTimeReturnContextOrNull,
          [field]:
            field === 'attemptRevision'
              ? 1
              : field === 'npcDraftId'
                ? id(12)
                : field === 'editMode'
                  ? 'APPEND_N_PLUS_ONE'
                  : { npcUuid: id(10), expectedCurrentVersion: 1 },
        },
      };
      unchanged(() => npcGmContextValue(corrupt));
    },
  );
  it('replays the same primitive CREATE without minting IDs or changing bytes', () => {
    const old = view('NPC-001', empty),
      saved = save({ old }),
      bytes = db.serialize();
    const one = reduceNpcSource(db, scope, old, saved.events, saved.cause);
    expect(one).toEqual({ formId: 'NPC-002', npc: context(saved.e) });
    expect(reduceNpcSource(db, scope, old, saved.events, saved.cause)).toEqual(one);
    expect(db.serialize().equals(bytes)).toBe(true);
  });
  it('reads a changed valid primitive row after a warm read in one text calculation scope', () => {
    const witness = 'actual primitive row payload '.repeat(100);
    const saved = save({ old: view('NPC-001', empty), values: { opaque: witness } });
    const storedJson = db
      .prepare('SELECT record_json FROM npc_attempt_event WHERE operation_id=?')
      .pluck()
      .get(saved.e.operationId);
    expect(s.text(storedJson).length).toBeGreaterThanOrEqual(1024);
    s.withCanonicalCalculations(() => {
      const first = readNpcGmPrimitiveCause(db, scope, saved.cause);
      expect(first.event.values).toEqual({ opaque: witness });
      const changedEvent = {
        ...saved.e,
        attempt: { ...saved.e.attempt, values: { opaque: witness + 'updated' } },
      };
      const changedOperation = { ...saved.o, attemptEventSha256: hash(changedEvent) };
      expect(
        db
          .prepare(
            'UPDATE npc_attempt_event SET record_json=?,record_sha256=? WHERE operation_id=?',
          )
          .run(s.canonical(changedEvent), hash(changedEvent), saved.e.operationId).changes,
      ).toBe(1);
      expect(
        db
          .prepare('UPDATE npc_operation SET record_json=?,record_sha256=? WHERE operation_id=?')
          .run(s.canonical(changedOperation), hash(changedOperation), saved.o.operationId).changes,
      ).toBe(1);
      const changedBytes = db.serialize();
      unchanged(() => readNpcGmPrimitiveCause(db, scope, saved.cause));
      const second = readNpcGmPrimitiveCause(db, scope, {
        operationId: saved.o.operationId,
        recordSha256: hash(changedOperation),
      });
      expect(second.event.values).toEqual({ opaque: witness + 'updated' });
      expect(second).not.toBe(first);
      expect(first.event.values).toEqual({ opaque: witness });
      expect(db.serialize().equals(changedBytes)).toBe(true);
    });
  });
  it.each(['ROW_HASH', 'NONCANONICAL_TEXT', 'FOREIGN_METADATA', 'MISSING_ROW'] as const)(
    'refuses changed %s after a warm SQL read inside one text calculation scope',
    (fault) => {
      const saved = save({
        old: view('NPC-001', empty),
        values: { opaque: 'actual row integrity input '.repeat(100) },
      });
      const storedJson = db
        .prepare('SELECT record_json FROM npc_attempt_event WHERE operation_id=?')
        .pluck()
        .get(saved.e.operationId);
      expect(s.text(storedJson).length).toBeGreaterThanOrEqual(1024);
      s.withCanonicalCalculations(() => {
        expect(readNpcGmPrimitiveCause(db, scope, saved.cause).event.values).toEqual(
          saved.e.attempt.values,
        );
        let cause = saved.cause;
        if (fault === 'ROW_HASH')
          expect(
            db
              .prepare('UPDATE npc_attempt_event SET record_sha256=? WHERE operation_id=?')
              .run('0'.repeat(64), saved.e.operationId).changes,
          ).toBe(1);
        if (fault === 'NONCANONICAL_TEXT') {
          const json = JSON.stringify(saved.e, null, 2);
          const changedOperation = { ...saved.o, attemptEventSha256: s.sha(json) };
          expect(
            db
              .prepare(
                'UPDATE npc_attempt_event SET record_json=?,record_sha256=? WHERE operation_id=?',
              )
              .run(json, s.sha(json), saved.e.operationId).changes,
          ).toBe(1);
          expect(
            db
              .prepare(
                'UPDATE npc_operation SET record_json=?,record_sha256=? WHERE operation_id=?',
              )
              .run(s.canonical(changedOperation), hash(changedOperation), saved.o.operationId)
              .changes,
          ).toBe(1);
          // The row and parent hashes are correct; only noncanonical stored text is invalid.
          cause = { operationId: saved.o.operationId, recordSha256: hash(changedOperation) };
        }
        if (fault === 'FOREIGN_METADATA')
          expect(
            db
              .prepare('UPDATE npc_attempt_event SET campaign_id=? WHERE operation_id=?')
              .run(id(88), saved.e.operationId).changes,
          ).toBe(1);
        if (fault === 'MISSING_ROW')
          expect(
            db
              .prepare('DELETE FROM npc_attempt_event WHERE operation_id=?')
              .run(saved.e.operationId).changes,
          ).toBe(1);
        unchanged(() => readNpcGmPrimitiveCause(db, scope, cause));
      });
    },
  );
  it('keeps opaque legacy queues without NPC tables readable while refusing actual NPC causes', () => {
    const legacy = new Database(':memory:'),
      opaqueScope = {
        campaignId: 'campaign',
        gmLocalContextId: 'context',
        ownerDeviceId: 'device',
      },
      cause = { operationId: id(20), recordSha256: hash({ cause: 'unavailable' }) };
    legacy.exec('BEGIN');
    try {
      const bytes = legacy.serialize();
      expect(
        withNpcGmPrimitiveReadSession(legacy, opaqueScope, (session) => {
          expect(() => readNpcGmPrimitiveCause(legacy, opaqueScope, cause, session)).toThrow();
          expect(() => readNpcGmPrimitiveCause(legacy, scope, cause, session)).toThrow();
          return 'legacy queue unchanged';
        }),
      ).toBe('legacy queue unchanged');
      expect(legacy.serialize().equals(bytes)).toBe(true);
      expect(
        legacy.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'npc_%'").all(),
      ).toEqual([]);
    } finally {
      if (legacy.inTransaction) legacy.exec('ROLLBACK');
      legacy.close();
    }
  });
  it('reuses only exact live rows inside one issued session and never exposes mutable proof', () => {
    const saved = save({ old: view('NPC-001', empty) }),
      bytes = db.serialize();
    let escaped: NpcGmPrimitiveReadSession | undefined;
    const first = withNpcGmPrimitiveReadSession(db, scope, (session) => {
      escaped = session;
      const proof = readNpcGmPrimitiveCause(db, scope, saved.cause, session);
      expect(readNpcGmPrimitiveCause(db, scope, saved.cause, session)).toBe(proof);
      expect(Object.isFrozen(proof.event.values)).toBe(true);
      expect(() => Object.assign(proof.event.values, { forged: true })).toThrow();
      expect(readNpcGmPrimitiveCause(db, scope, saved.cause, session).event.values).toEqual(
        saved.e.attempt.values,
      );
      withNpcGmPrimitiveReadSession(db, scope, (nested) => {
        expect(nested).not.toBe(session);
        const independentlyChecked = readNpcGmPrimitiveCause(db, scope, saved.cause, nested);
        expect(independentlyChecked).toEqual(proof);
        expect(independentlyChecked).not.toBe(proof);
      });
      expect(readNpcGmPrimitiveCause(db, scope, saved.cause, session)).toBe(proof);
      return proof;
    });
    expect(readNpcGmPrimitiveCause(db, scope, saved.cause)).toEqual(first);
    expect(readNpcGmPrimitiveCause(db, scope, saved.cause)).not.toBe(first);
    expect(escaped).toBeDefined();
    unchanged(() => readNpcGmPrimitiveCause(db, scope, saved.cause, escaped));
    expect(db.serialize().equals(bytes)).toBe(true);
  });
  it('refuses an escaped constructor without the private invocation issuer', () => {
    let escapedConstructor: unknown;
    withNpcGmPrimitiveReadSession(db, scope, (session) => {
      const prototype: unknown = Object.getPrototypeOf(session);
      if (prototype === null || typeof prototype !== 'object') throw new Error('missing prototype');
      const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
      escapedConstructor = constructor;
    });
    if (typeof escapedConstructor !== 'function') throw new Error('missing constructor');
    const constructor = escapedConstructor;
    expect(Object.isFrozen(constructor)).toBe(true);
    unchanged(() => Reflect.construct(constructor, [db, scope]));
    unchanged(() =>
      Reflect.construct(constructor, [db, scope, Symbol('NPC_GM_CAUSE_SESSION_ISSUER')]),
    );
  });

  it.each([
    'OPERATION_METADATA',
    'EVENT_METADATA',
    'PREVIOUS_MISSING',
    'VERSION_METADATA',
    'VERSION_MISSING',
    'HASH_VALID_EVENT',
    'HASH_VALID_OPERATION',
  ] as const)(
    'revalidates changed %s after warm primitive proof without any reader write',
    (fault) => {
      const initial = save({ old: view('NPC-001', empty) });
      const staged: NpcAttemptEvent = {
        operationId: 'prior-stage',
        previousSha256OrNull: hash(initial.e),
        attempt: { ...initial.e.attempt, revision: 1, stage: 'NPC-017' },
      };
      putEvent(staged);
      const saved = save({
        old: view('NPC-017', context(staged)),
        kind: 'COMMIT_V1',
        previous: staged,
        request: command('COMMIT_V1', id(20), staged),
      });
      withNpcGmPrimitiveReadSession(db, scope, (session) => {
        const first = readNpcGmPrimitiveCause(db, scope, saved.cause, session);
        expect(readNpcGmPrimitiveCause(db, scope, saved.cause, session)).toBe(first);
        if (fault === 'OPERATION_METADATA')
          db.prepare('UPDATE npc_operation SET receipt_id=? WHERE operation_id=?').run(
            id(88),
            saved.o.operationId,
          );
        if (fault === 'EVENT_METADATA')
          db.prepare('UPDATE npc_attempt_event SET draft_id=? WHERE operation_id=?').run(
            id(88),
            saved.o.operationId,
          );
        if (fault === 'PREVIOUS_MISSING')
          db.prepare('DELETE FROM npc_attempt_event WHERE operation_id=?').run(staged.operationId);
        if (fault === 'VERSION_METADATA')
          db.prepare('UPDATE npc_version SET library_revision=99 WHERE operation_id=?').run(
            saved.o.operationId,
          );
        if (fault === 'VERSION_MISSING')
          db.prepare('DELETE FROM npc_version WHERE operation_id=?').run(saved.o.operationId);
        if (fault === 'HASH_VALID_EVENT') {
          const changed = { ...saved.e, attempt: { ...saved.e.attempt, values: { forged: true } } };
          db.prepare(
            'UPDATE npc_attempt_event SET record_json=?,record_sha256=? WHERE operation_id=?',
          ).run(s.canonical(changed), hash(changed), saved.o.operationId);
        }
        if (fault === 'HASH_VALID_OPERATION') {
          const changed = { ...saved.o, committedAt: '2026-11-06T00:01:00.000Z' };
          db.prepare(
            'UPDATE npc_operation SET record_json=?,record_sha256=? WHERE operation_id=?',
          ).run(s.canonical(changed), hash(changed), saved.o.operationId);
        }
        unchanged(() => readNpcGmPrimitiveCause(db, scope, saved.cause, session));
        unchanged(() => readNpcGmPrimitiveCause(db, scope, saved.cause));
      });
    },
  );
  it('invalidates a warm proof after an unrelated write or schema/user metadata change', () => {
    const saved = save({ old: view('NPC-001', empty) });
    withNpcGmPrimitiveReadSession(db, scope, (session) => {
      let previous = readNpcGmPrimitiveCause(db, scope, saved.cause, session);
      for (const sql of [
        'UPDATE npc_operation SET kind=kind',
        'PRAGMA user_version=7',
        'CREATE TABLE unrelated_evidence(n INTEGER)',
      ]) {
        db.exec(sql);
        const before = db.serialize(),
          fresh = readNpcGmPrimitiveCause(db, scope, saved.cause, session);
        expect(fresh).toEqual(previous);
        expect(fresh).not.toBe(previous);
        expect(db.serialize().equals(before)).toBe(true);
        previous = fresh;
      }
    });
  });
  it('refuses forged/proxy/foreign sessions and closes a throwing invocation', () => {
    const saved = save({ old: view('NPC-001', empty) });
    let escaped: NpcGmPrimitiveReadSession | undefined,
      traps = 0;
    const other = new Database(':memory:');
    try {
      expect(() =>
        withNpcGmPrimitiveReadSession(db, scope, (session) => {
          escaped = session;
          unchanged(() =>
            readNpcGmPrimitiveCause(db, scope, saved.cause, {} as NpcGmPrimitiveReadSession),
          );
          const prototype: unknown = Object.getPrototypeOf(session);
          if (prototype === null || typeof prototype !== 'object')
            throw Error('Missing session prototype');
          const forged = Object.create(prototype) as NpcGmPrimitiveReadSession;
          unchanged(() => readNpcGmPrimitiveCause(db, scope, saved.cause, forged));
          unchanged(() =>
            readNpcGmPrimitiveCause(
              db,
              scope,
              saved.cause,
              new Proxy(session, {
                getPrototypeOf() {
                  traps++;
                  throw Error('proxy');
                },
              }),
            ),
          );
          unchanged(() =>
            readNpcGmPrimitiveCause(db, { ...scope, ownerDeviceId: id(88) }, saved.cause, session),
          );
          unchanged(() => readNpcGmPrimitiveCause(other, scope, saved.cause, session));
          throw Error('closing the owning read');
        }),
      ).toThrow('closing the owning read');
      expect(traps).toBe(0);
      expect(escaped).toBeDefined();
      unchanged(() => readNpcGmPrimitiveCause(db, scope, saved.cause, escaped));
    } finally {
      other.close();
    }
  });
  it.each(['ASYNC', 'BOUND_ASYNC', 'GENERATOR', 'PROMISE'] as const)(
    'refuses %s session callbacks and closes every issued token',
    (kind) => {
      let calls = 0,
        escaped: NpcGmPrimitiveReadSession | undefined;
      const body = (session: NpcGmPrimitiveReadSession) => {
        calls++;
        escaped = session;
      };
      const asyncBody = async (session: NpcGmPrimitiveReadSession) => {
        body(session);
        await Promise.resolve();
      };
      const callback: unknown =
        kind === 'ASYNC'
          ? asyncBody
          : kind === 'BOUND_ASYNC'
            ? asyncBody.bind(null)
            : kind === 'GENERATOR'
              ? function* (session: NpcGmPrimitiveReadSession) {
                  body(session);
                  yield null;
                }
              : (session: NpcGmPrimitiveReadSession) => {
                  body(session);
                  return Promise.reject(Error('not awaited'));
                };
      unchanged(() =>
        withNpcGmPrimitiveReadSession(
          db,
          scope,
          callback as (session: NpcGmPrimitiveReadSession) => unknown,
        ),
      );
      expect(calls).toBe(kind === 'PROMISE' ? 1 : 0);
      if (escaped !== undefined) {
        const saved = save({ old: view('NPC-001', empty) });
        unchanged(() => readNpcGmPrimitiveCause(db, scope, saved.cause, escaped));
      }
    },
  );
  it('requires the exact before-GM prefix even when source revisions match', () => {
    const old = view('NPC-001', empty),
      saved = save({ old });
    const altered = saved.events.map((e) => ({ ...e, recordSha256: hash('other-prefix') }));
    unchanged(() => reduceNpcSource(db, scope, old, altered, saved.cause));
  });
  it.each(['hash', 'campaign', 'candidate', 'eventHash'] as const)(
    'refuses corrupt primitive %s with no writes',
    (fault) => {
      const saved = save({ old: view('NPC-001', empty) });
      if (fault === 'hash')
        db.prepare('UPDATE npc_operation SET record_sha256=?').run(hash('wrong'));
      if (fault === 'campaign') db.prepare('UPDATE npc_operation SET campaign_id=?').run(id(80));
      if (fault === 'candidate') {
        const changed = {
          ...saved.e,
          attempt: { ...saved.e.attempt, candidateNpcUuid: saved.e.attempt.npcDraftId },
        };
        db.prepare('UPDATE npc_attempt_event SET record_json=?,record_sha256=?').run(
          s.canonical(changed),
          hash(changed),
        );
      }
      if (fault === 'eventHash')
        db.prepare('UPDATE npc_attempt_event SET record_sha256=?').run(hash('wrong'));
      unchanged(() => readNpcGmPrimitiveCause(db, scope, saved.cause));
    },
  );
  it('requires a transaction and refuses a foreign owner scope', () => {
    const saved = save({ old: view('NPC-001', empty) });
    unchanged(() => readNpcGmPrimitiveCause(db, { ...scope, ownerDeviceId: id(80) }, saved.cause));
    db.exec('COMMIT');
    unchanged(() => readNpcGmPrimitiveCause(db, scope, saved.cause));
  });
  it('permits only one exact newly appended cause during mirror construction', () => {
    const old = view('NPC-001', empty),
      saved = save({ old });
    unchanged(() => verifyNpcGmMirrorCoverage(db, scope, saved.events));
    expect(() => verifyNpcGmMirrorCoverage(db, scope, saved.events, saved.cause)).not.toThrow();
    unchanged(() =>
      verifyNpcGmMirrorCoverage(db, scope, saved.events, {
        ...saved.cause,
        recordSha256: hash('foreign'),
      }),
    );
    const sealed = [...saved.events, mirror(saved.events, saved)];
    expect(() => verifyNpcGmMirrorCoverage(db, scope, sealed)).not.toThrow();
    unchanged(() => verifyNpcGmMirrorCoverage(db, scope, sealed, saved.cause));
    unchanged(() => verifyNpcGmMirrorCoverage(db, scope, [...sealed, sealed[1]!]));
  });
  it('refuses an orphan mirror and a second unmirrored operation', () => {
    const old = view('NPC-001', empty),
      saved = save({ old });
    const full = [...saved.events, mirror(saved.events, saved)];
    db.prepare('DELETE FROM npc_operation').run();
    unchanged(() => verifyNpcGmMirrorCoverage(db, scope, full));
    putOperation(saved.o);
    save({ old, operationId: 'second-create', candidate: id(12), draft: id(13) });
    unchanged(() => verifyNpcGmMirrorCoverage(db, scope, saved.events, saved.cause));
  });
  it('navigates the same attempt without changing values and refuses forged navigation values', () => {
    const created = save({ old: view('NPC-001', empty) }),
      old = view('NPC-002', context(created.e));
    const saved = save({
      old,
      kind: 'REPLACE',
      previous: created.e,
      stage: 'NPC-011',
      request: nav('NPC-002', '001', id(20)) as unknown as JsonObject,
    });
    expect(reduceNpcSource(db, scope, old, saved.events, saved.cause).formId).toBe('NPC-011');
    const forged = { ...saved.e, attempt: { ...saved.e.attempt, values: { fabricated: true } } };
    const op = { ...saved.o, attemptEventSha256: hash(forged) };
    db.prepare(
      'UPDATE npc_attempt_event SET record_json=?,record_sha256=? WHERE operation_id=?',
    ).run(s.canonical(forged), hash(forged), op.operationId);
    db.prepare('UPDATE npc_operation SET record_json=?,record_sha256=? WHERE operation_id=?').run(
      s.canonical(op),
      hash(op),
      op.operationId,
    );
    unchanged(() =>
      reduceNpcSource(db, scope, old, saved.events, {
        operationId: op.operationId,
        recordSha256: hash(op),
      }),
    );
    unchanged(() =>
      npcContextAfterNavigation(db, scope, old, saved.events, nav('NPC-002', '001'), 'NPC-011'),
    );
  });
  it('cancels only through the original NPC-002 CTA and preserves the candidate in old history', () => {
    const created = save({ old: view('NPC-001', empty) }),
      old = view('NPC-002', context(created.e));
    const saved = save({
      old,
      kind: 'CANCEL',
      previous: created.e,
      request: nav('NPC-002', '003', id(20)) as unknown as JsonObject,
    });
    expect(reduceNpcSource(db, scope, old, saved.events, saved.cause)).toEqual({
      formId: 'NPC-001',
      npc: empty,
    });
    expect(readNpcGmPrimitiveCause(db, scope, created.cause).event.ref.candidateNpcUuid).toBe(
      id(10),
    );
  });
  it('validates exact historical editor result through the mandatory stage adapter', () => {
    const created = save({ old: view('NPC-001', empty) }),
      old = view('NPC-002', context(created.e));
    const request: JsonObject = {
      messageType: 'network.npc-editor.replace',
      protocolVersion: 3,
      operationId: id(20),
      campaignId: scope.campaignId,
      sourceFormId: 'NPC-002',
      npcDraftId: id(11),
      expectedAttemptRevision: 0,
      expectedRevisions: vector,
      values: { technicalChoice: 'entered' },
    };
    const saved = save({
      old,
      kind: 'REPLACE',
      previous: created.e,
      request,
      values: { preserved: true, technicalChoice: 'entered' },
    });
    const full = [...saved.events, mirror(saved.events, saved)];
    let calls = 0;
    validateNpcHistoricalGmSource(db, full, saved.o, saved.e, created.e, (before, stage, input) => {
      calls++;
      expect(before).toEqual(created.e.attempt.values);
      expect(stage).toBe('NPC-002');
      expect(input).toEqual(request['values']);
      return saved.e.attempt.values;
    });
    expect(calls).toBe(1);
    let entered = false;
    const asyncAdapter = async () => {
      entered = true;
      await Promise.resolve();
      return saved.e.attempt.values;
    };
    unchanged(() =>
      validateNpcHistoricalGmSource(
        db,
        full,
        saved.o,
        saved.e,
        created.e,
        asyncAdapter as unknown as () => JsonObject,
      ),
    );
    expect(entered).toBe(false);
    unchanged(() =>
      validateNpcHistoricalGmSource(
        db,
        full,
        saved.o,
        saved.e,
        created.e,
        () => created.e.attempt.values,
      ),
    );
    unchanged(() =>
      validateNpcHistoricalGmSource(
        db,
        saved.events,
        saved.o,
        saved.e,
        created.e,
        () => saved.e.attempt.values,
      ),
    );
    const interrupted = [...saved.events, { ...saved.events[0]!, eventId: 'interposed' }, full[1]!];
    unchanged(() =>
      validateNpcHistoricalGmSource(
        db,
        interrupted,
        saved.o,
        saved.e,
        created.e,
        () => saved.e.attempt.values,
      ),
    );
  });

  it('replays a trauma reservation only through its mandatory exact historical adapter', () => {
    let previous = save({ old: view('NPC-001', empty) }).e;
    const stages = [
      'NPC-002',
      'NPC-011',
      'NPC-012',
      'NPC-013',
      'NPC-014',
      'NPC-015',
      'NPC-016',
    ] as const;
    for (let i = 0; i < stages.length - 1; i++) {
      const form = stages[i]!,
        target = stages[i + 1]!,
        operationId = id(40 + i);
      previous = save({
        old: view(form, context(previous)),
        kind: 'REPLACE',
        previous,
        stage: target,
        operationId,
        request: nav(form, '001', operationId) as unknown as JsonObject,
      }).e;
    }
    const old = view('NPC-016', context(previous)),
      request: JsonObject = {
        messageType: 'network.npc-preparation.request',
        protocolVersion: 3,
        operationId: id(60),
        campaignId: scope.campaignId,
        sourceFormId: 'NPC-016',
        npcDraftId: previous.attempt.npcDraftId,
        expectedAttemptRevision: previous.attempt.revision,
        expectedRevisions: vector,
        preparation: { kind: 'TRAUMA_RESERVE' },
      },
      saved = save({
        old,
        kind: 'REPLACE',
        previous,
        operationId: id(60),
        request,
        childAllocations: [{ kind: 'TRAUMA_INSTANCE', id: id(61) }],
        values: { ...previous.attempt.values, preparedTrauma: id(61) },
      }),
      full = [...saved.events, mirror(saved.events, saved)],
      previousContext = npcAttemptReadContext(previous.attempt, saved.o.operationId, [], null);
    const unused = (): never => {
      throw Error('Unrelated stage adapter must not run');
    };
    const run = (
      apply?: (
        value: JsonObject,
        traumaInstanceId: string,
        context: typeof previousContext,
        operationId: string,
      ) => JsonObject,
      contextValue = previousContext,
    ) =>
      validateNpcHistoricalGmSource(
        db,
        full,
        saved.o,
        saved.e,
        previous,
        unused,
        undefined,
        contextValue,
        undefined,
        undefined,
        apply,
      );
    let calls = 0;
    run((value, traumaInstanceId, ctx, operationId) => {
      calls++;
      expect([value, traumaInstanceId, ctx, operationId]).toEqual([
        previous.attempt.values,
        id(61),
        previousContext,
        id(60),
      ]);
      return saved.e.attempt.values;
    });
    expect(calls).toBe(1);
    unchanged(() => run());
    unchanged(() => run(() => previous.attempt.values));
    unchanged(() =>
      run(() => saved.e.attempt.values, {
        ...previousContext,
        pendingTraumaOrNull: {
          traumaInstanceId: id(61),
          operationId: id(60),
          npcDraftId: previous.attempt.npcDraftId,
        },
      }),
    );
    let entered = false;
    const asynchronous = async () => {
      entered = true;
      await Promise.resolve();
      return saved.e.attempt.values;
    };
    unchanged(() => run(asynchronous as unknown as () => JsonObject));
    expect(entered).toBe(false);
  });
  it('uses the explicit workflow OPEN selection, not a client-controlled candidate', () => {
    const old = view('NPC-007', {
      ...empty,
      selectedNpcOrNull: { npcUuid: id(10), displayedVersion: 1, currentVersion: 1 },
    });
    const saved = save({ old, kind: 'OPEN', request: command('OPEN', id(20)) });
    expect(
      reduceNpcSource(db, scope, old, saved.events, saved.cause).npc.attemptOrNull
        ?.candidateNpcUuid,
    ).toBe(id(10));
    const changed = {
      ...old,
      npc: {
        ...old.npc!,
        selectedNpcOrNull: { npcUuid: id(12), displayedVersion: 1, currentVersion: 1 },
      },
    };
    unchanged(() => reduceNpcSource(db, scope, changed, prefix(changed), saved.cause));
  });
  it.each(['COMMIT_V1', 'COMMIT'] as const)(
    'commits %s to the reserved/target identity with no invented payload NPC UUID',
    (kind) => {
      const initial =
        kind === 'COMMIT_V1'
          ? save({ old: view('NPC-001', empty) })
          : save({
              old: view('NPC-003', {
                ...empty,
                selectedNpcOrNull: { npcUuid: id(10), displayedVersion: 1, currentVersion: 1 },
              }),
              kind: 'OPEN',
              request: command('OPEN', id(21)),
              operationId: id(21),
            });
      const staged: NpcAttemptEvent = {
        operationId: 'prior-stage',
        previousSha256OrNull: hash(initial.e),
        attempt: { ...initial.e.attempt, revision: 1, stage: 'NPC-017' },
      };
      putEvent(staged);
      const old = view('NPC-017', context(staged));
      const saved = save({
        old,
        kind,
        previous: staged,
        request: command(kind, id(20), staged),
        version: kind === 'COMMIT_V1' ? 1 : 2,
      });
      expect(reduceNpcSource(db, scope, old, saved.events, saved.cause)).toEqual({
        formId: 'NPC-003',
        npc: {
          ...empty,
          selectedNpcOrNull: {
            npcUuid: id(10),
            displayedVersion: kind === 'COMMIT_V1' ? 1 : 2,
            currentVersion: kind === 'COMMIT_V1' ? 1 : 2,
          },
        },
      });
      // A valid outer hash must not conceal a different embedded library revision.
      const row = db
        .prepare('SELECT record_json FROM npc_version WHERE operation_id=?')
        .get(saved.o.operationId) as { record_json: string };
      const altered = {
        ...(JSON.parse(row.record_json) as Record<string, unknown>),
        libraryRevision: 99,
      };
      const changed = {
        ...saved.o,
        versionOrNull: { ...saved.o.versionOrNull!, sha256: hash(altered) },
      };
      db.prepare('UPDATE npc_version SET record_json=?,record_sha256=? WHERE operation_id=?').run(
        s.canonical(altered),
        hash(altered),
        saved.o.operationId,
      );
      db.prepare('UPDATE npc_operation SET record_json=?,record_sha256=? WHERE operation_id=?').run(
        s.canonical(changed),
        hash(changed),
        saved.o.operationId,
      );
      unchanged(() =>
        readNpcGmPrimitiveCause(db, scope, {
          operationId: saved.o.operationId,
          recordSha256: hash(changed),
        }),
      );
    },
  );
  it('refuses future command fields and added authority in stored requests', () => {
    const request = command('OPEN', id(20));
    unchanged(() => NPC_GM_REQUEST_READERS.request('OPEN', { ...request, authority: 'gm' }));
    unchanged(() =>
      NPC_GM_REQUEST_READERS.request('OPEN', {
        ...request,
        workflowCommandId: ['UI', 'CMD', 'NPC', 'FUTURE'].join('-'),
      }),
    );
  });
  it('keeps historical selection at its committed prefix when a newer version already exists', () => {
    const created = save({ old: view('NPC-001', empty) });
    const previous: NpcAttemptEvent = {
      operationId: 'stage-17',
      previousSha256OrNull: hash(created.e),
      attempt: { ...created.e.attempt, revision: 1, stage: 'NPC-017' },
    };
    putEvent(previous);
    const firstOld = view('NPC-017', context(previous));
    const first = save({
      old: firstOld,
      kind: 'COMMIT_V1',
      previous,
      request: command('COMMIT_V1', id(20), previous),
    });
    const committedPrefix = [...first.events, mirror(first.events, first)];
    const selected = { npcUuid: id(10), displayedVersion: 1, currentVersion: 1 };
    const openOld = view('NPC-003', { ...empty, selectedNpcOrNull: selected });
    const opened = save({
      old: openOld,
      kind: 'OPEN',
      operationId: id(21),
      draft: id(12),
      request: command('OPEN', id(21)),
    });
    const secondPrevious: NpcAttemptEvent = {
      operationId: 'next-stage-17',
      previousSha256OrNull: hash(opened.e),
      attempt: { ...opened.e.attempt, revision: 1, stage: 'NPC-017' },
    };
    putEvent(secondPrevious);
    const secondOld = view('NPC-017', context(secondPrevious));
    const second = save({
      old: secondOld,
      kind: 'COMMIT',
      operationId: id(22),
      previous: secondPrevious,
      request: command('COMMIT', id(22), secondPrevious),
      version: 2,
    });
    const secondMirror = mirror(second.events, second);
    const old = view('NPC-001', empty);
    const request: NpcSelectionReplaceRequest = {
      messageType: 'network.npc-selection.replace',
      protocolVersion: 3,
      operationId: id(23),
      campaignId: scope.campaignId,
      sourceFormId: 'NPC-001',
      expectedRevisions: vector,
      npcUuidOrNull: id(10),
    };
    expect(reduceNpcSelection(db, scope, old, committedPrefix, request).selectedNpcOrNull).toEqual(
      selected,
    );
    const currentPrefix = [...committedPrefix, secondMirror];
    expect(reduceNpcSelection(db, scope, old, currentPrefix, request).selectedNpcOrNull).toEqual({
      ...selected,
      displayedVersion: 2,
      currentVersion: 2,
    });
    const history = view('NPC-007', {
      ...empty,
      selectedNpcOrNull: { ...selected, displayedVersion: 2, currentVersion: 2 },
    });
    const historyRequest: NpcSelectionReplaceRequest = {
      messageType: 'network.npc-selection.replace',
      protocolVersion: 3,
      operationId: id(24),
      campaignId: scope.campaignId,
      sourceFormId: 'NPC-007',
      expectedRevisions: vector,
      npcUuid: id(10),
      version: 1,
    };
    expect(
      reduceNpcSelection(db, scope, history, currentPrefix, historyRequest).selectedNpcOrNull,
    ).toEqual({ ...selected, currentVersion: 2 });
    unchanged(() =>
      reduceNpcSelection(db, scope, history, committedPrefix, { ...historyRequest, version: 2 }),
    );
  });
  it('selects null only on NPC-001 and refuses stale/history foreign selections', () => {
    const old = view('NPC-001', empty);
    const request: NpcSelectionReplaceRequest = {
      messageType: 'network.npc-selection.replace',
      protocolVersion: 3,
      operationId: id(20),
      campaignId: scope.campaignId,
      sourceFormId: 'NPC-001',
      expectedRevisions: vector,
      npcUuidOrNull: null,
    };
    expect(reduceNpcSelection(db, scope, old, prefix(old), request)).toEqual(empty);
    unchanged(() =>
      reduceNpcSelection(db, scope, old, prefix(old), {
        ...request,
        expectedRevisions: { ...vector, stateRevision: 3 },
      }),
    );
    unchanged(() =>
      reduceNpcSelection(db, scope, old, prefix(old), { ...request, campaignId: id(80) }),
    );
    unchanged(() =>
      reduceNpcSelection(db, scope, view('NPC-007', empty), [], {
        messageType: 'network.npc-selection.replace',
        protocolVersion: 3,
        operationId: id(20),
        campaignId: scope.campaignId,
        sourceFormId: 'NPC-007',
        expectedRevisions: vector,
        npcUuid: id(10),
        version: 1,
      }),
    );
  });
});
