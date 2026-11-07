import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { describe, it } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import { npcWorkflowCommandRequestValue } from '@shared/npc-command.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import {
  npcGmSourceValue,
  npcCalendarReadContextValue,
  npcSynchronousValidator,
  npcOperationValue,
  npcAttemptEventValue,
  verifyNpcRequestBinding,
  type NpcAttemptEvent,
  type NpcGmSource,
  type NpcOperation,
  type NpcOperationKind,
  type NpcRequestReader,
  type NpcTechnicalBinding,
} from './npc-library-records.js';

const uuid = (last: number): string => `00000000-0000-4000-8000-${String(last).padStart(12, '0')}`;
const scope = { campaignId: uuid(1), gmLocalContextId: uuid(2), ownerDeviceId: uuid(3) };
const draftId = uuid(4),
  npcId = uuid(5),
  commandId = uuid(6);
const revisions = { stateRevision: 12, projectionRevision: 19, actorVisibilityRevision: 3 };
const source = (sourceFormId: NpcGmSource['sourceFormId']): NpcGmSource => ({
  sourceFormId,
  revisions: { ...revisions },
  sourceSnapshotSha256: 'a'.repeat(64),
  queuePrefix: { eventId: 'prior-navigation-4', recordSha256: 'b'.repeat(64) },
});

describe('NPC original validator capture before guarded invocation', () => {
  const run = (
    db: Database.Database,
    owner: { readonly validate: (value: { count: number }) => unknown },
    value: { count: number },
  ): void => {
    db.transaction(() =>
      s.guarded(
        db,
        () => {
          const validate = npcSynchronousValidator(owner.validate);
          return validate.call(owner, value);
        },
        value,
        'APPLY',
      ),
    ).immediate();
  };
  const database = (): Database.Database => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE callback_probe(n INTEGER NOT NULL)');
    return db;
  };
  const rows = (db: Database.Database): unknown[] =>
    db.prepare('SELECT n FROM callback_probe').all();
  for (const purpose of ['historical source', 'historical version', 'new version', 'boundary'])
    it(`rejects native async ${purpose} validator before its first statement and delayed SQL`, async () => {
      const db = database();
      let entered = false,
        continued = false;
      const owner = {
        async validate(_value: { count: number }): Promise<void> {
          entered = true;
          await Promise.resolve();
          continued = true;
          db.exec('INSERT INTO callback_probe VALUES(1)');
        },
      };
      try {
        assert.throws(() => run(db, owner, { count: 1 }));
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(entered, false);
        assert.equal(continued, false);
        assert.deepEqual(rows(db), []);
      } finally {
        db.close();
      }
    });
  it('rejects bound native async validators and async functions with a forged display tag', async () => {
    const db = database();
    let entered = 0;
    const native = async (_value: { count: number }): Promise<void> => {
      entered += 1;
      await Promise.resolve();
    };
    try {
      assert.throws(() => run(db, { validate: native.bind(null) }, { count: 1 }));
      Object.defineProperty(native, Symbol.toStringTag, { value: 'Function' });
      assert.throws(() => run(db, { validate: native }, { count: 1 }));
      await Promise.resolve();
      assert.equal(entered, 0);
    } finally {
      db.close();
    }
  });
  it('captures once under guard and preserves the original receiver for synchronous validators', () => {
    const db = database();
    let calls = 0,
      accesses = 0;
    const owner = {
      label: 'actual-owner',
      get validate() {
        accesses += 1;
        return function (this: { label: string }, value: { count: number }): void {
          assert.equal(this.label, 'actual-owner');
          assert.equal(value.count, 1);
          calls += 1;
        };
      },
    };
    try {
      run(db, owner, { count: 1 });
      assert.equal(calls, 1);
      assert.equal(accesses, 1);
      assert.deepEqual(rows(db), []);
    } finally {
      db.close();
    }
  });
  it('still rejects and rolls back live SQL writes from an ordinary validator', () => {
    const db = database();
    try {
      assert.throws(() =>
        run(
          db,
          {
            validate: () => {
              db.exec('INSERT INTO callback_probe VALUES(1)');
            },
          },
          { count: 1 },
        ),
      );
      assert.deepEqual(rows(db), []);
    } finally {
      db.close();
    }
  });
  it('keeps callback-property reads inside the SQL guard', () => {
    const db = database();
    const owner = {
      get validate() {
        db.exec('INSERT INTO callback_probe VALUES(2)');
        return (): void => undefined;
      },
    };
    try {
      assert.throws(() => run(db, owner, { count: 1 }));
      assert.deepEqual(rows(db), []);
    } finally {
      db.close();
    }
  });
  it('still rejects argument mutation, non-void return, Promise return and absent callback', async () => {
    const db = database();
    try {
      const value = { count: 1 };
      assert.throws(() =>
        run(
          db,
          {
            validate: (v) => {
              v.count += 1;
            },
          },
          value,
        ),
      );
      assert.equal(value.count, 2); // The guard detects mutation; it does not promise object restoration.
      assert.throws(() => run(db, { validate: () => 1 }, { count: 1 }));
      assert.throws(() => run(db, { validate: () => Promise.resolve() }, { count: 1 }));
      assert.throws(() =>
        run(db, { validate: undefined as unknown as (v: { count: number }) => void }, { count: 1 }),
      );
      await Promise.resolve();
      assert.deepEqual(rows(db), []);
    } finally {
      db.close();
    }
  });
});
const checkpoint = {
  campaignId: scope.campaignId,
  stateRevision: 2,
  projectionRevision: 4,
  actorVisibilityRevision: 1,
  snapshotJson: JSON.stringify({
    campaign: { campaignId: scope.campaignId, lifecycleState: 'PAUSED', payloadJson: '{}' },
    campaignCharacterCopies: [],
  }),
};
const workflow = (kind: 'OPEN' | 'COMMIT' | 'COMMIT_V1'): JsonObject => ({
  messageType: 'command.request',
  protocolVersion: 1,
  commandKind: 'workflow-command',
  role: 'gm',
  commandId,
  workflowCommandId: kind === 'COMMIT_V1' ? 'UI-CMD-NPC-COMMIT-V1' : 'UI-CMD-NPC-NEW-VERSION',
  expectedRevisions: { ...revisions },
  payload:
    kind === 'OPEN'
      ? { phase: 'OPEN', campaignId: scope.campaignId, npcUuid: npcId, expectedCurrentVersion: 1 }
      : kind === 'COMMIT'
        ? {
            phase: 'COMMIT',
            campaignId: scope.campaignId,
            npcDraftId: draftId,
            expectedAttemptRevision: 2,
            expectedCurrentVersion: 1,
          }
        : { campaignId: scope.campaignId, npcDraftId: draftId, expectedAttemptRevision: 2 },
});
const nav = (form: NpcGmSource['sourceFormId']): JsonObject => ({
  messageType: 'navigation.form-action',
  protocolVersion: 2,
  navigationRequestId: 'navigation-existing-v2-text',
  sourceFormId: form,
  actionKey: `${form}::CTA::001`,
  expectedProjectionRevision: revisions.projectionRevision,
});
// Bounded fixture binding: the real adapter must additionally prove exact CTA/selection/transition.
const readers: NpcRequestReader = {
  request(kind, value) {
    if (kind === 'OPEN' || kind === 'COMMIT' || kind === 'COMMIT_V1')
      return npcWorkflowCommandRequestValue(value) as unknown as JsonObject;
    const row = s.object(value, [
      'messageType',
      'protocolVersion',
      'navigationRequestId',
      'sourceFormId',
      'actionKey',
      'expectedProjectionRevision',
    ]);
    assert.equal(row['messageType'], 'navigation.form-action');
    assert.equal(row['protocolVersion'], 2);
    s.text(row['navigationRequestId']);
    s.text(row['sourceFormId']);
    s.text(row['actionKey']);
    s.integer(row['expectedProjectionRevision']);
    return row as JsonObject;
  },
  technicalBinding(_kind, request) {
    return {
      kind: 'FORM_ACTION',
      navigationRequestId: s.text(request['navigationRequestId']),
      sourceFormId: request['sourceFormId'] as NpcGmSource['sourceFormId'],
      expectedProjectionRevision: s.integer(request['expectedProjectionRevision']),
    };
  },
};
function pair(
  kind: NpcOperationKind,
  form?: NpcGmSource['sourceFormId'],
): { event: NpcAttemptEvent; operation: NpcOperation } {
  const technical = kind === 'CREATE' || kind === 'REPLACE' || kind === 'CANCEL';
  const request = technical
    ? nav(form ?? (kind === 'CREATE' ? 'NPC-001' : 'NPC-011'))
    : workflow(kind);
  const operationId = technical ? s.text(request['navigationRequestId']) : commandId;
  const event: NpcAttemptEvent = {
    operationId,
    previousSha256OrNull: null,
    attempt: {
      scope,
      npcDraftId: draftId,
      candidateNpcUuid: npcId,
      revision: kind === 'CREATE' || kind === 'OPEN' ? 0 : 3,
      mode: kind === 'OPEN' || kind === 'COMMIT' ? 'APPEND_N_PLUS_ONE' : 'CREATE_V1',
      targetOrNull:
        kind === 'OPEN' || kind === 'COMMIT' ? { npcUuid: npcId, expectedCurrentVersion: 1 } : null,
      stage: kind === 'COMMIT' || kind === 'COMMIT_V1' ? 'NPC-017' : 'NPC-002',
      status:
        kind === 'CANCEL'
          ? 'CANCELLED'
          : kind === 'COMMIT' || kind === 'COMMIT_V1'
            ? 'COMMITTED'
            : 'OPEN',
      values: {},
    },
  };
  const operation: NpcOperation = {
    operationId,
    receiptId: uuid(7),
    kind,
    scope,
    request,
    beforeGmSource: source(
      form ??
        (kind === 'CREATE'
          ? 'NPC-001'
          : kind === 'OPEN'
            ? 'NPC-003'
            : technical
              ? 'NPC-011'
              : 'NPC-017'),
    ),
    beforeCheckpoint: checkpoint,
    afterCheckpoint: checkpoint,
    attemptEventSha256: 'c'.repeat(64),
    versionOrNull: null,
    anchorOrNull: null,
    committedAt: '2026-11-06T00:00:00.000Z',
  };
  return { event, operation };
}
const verify = (value: ReturnType<typeof pair>, selectedReaders = readers): void =>
  verifyNpcRequestBinding(value.event, value.operation, selectedReaders);
const draftBinding = (): NpcTechnicalBinding => ({
  kind: 'DRAFT_REPLACE',
  operationId: 'navigation-existing-v2-text',
  campaignId: scope.campaignId,
  npcDraftId: draftId,
  expectedAttemptRevision: 2,
  expectedRevisions: { ...revisions },
});
const withBinding = (binding: unknown): NpcRequestReader => ({
  ...readers,
  technicalBinding: () => binding as NpcTechnicalBinding,
});

describe('NPC GM source closed record', () => {
  it('round trips detached source with its own presentation vector and opaque prefix event ID', () => {
    const input = source('NPC-017'),
      result = npcGmSourceValue(input);
    assert.deepEqual(result, input);
    assert.notEqual(result.revisions, input.revisions);
    assert.notEqual(result.queuePrefix, input.queuePrefix);
  });
  it('rejects every missing source field and unknown/campaign fallback fields', () => {
    for (const key of Object.keys(source('NPC-017'))) {
      const input: Record<string, unknown> = { ...source('NPC-017') };
      delete input[key];
      assert.throws(() => npcGmSourceValue(input), key);
    }
    assert.throws(() => npcGmSourceValue(checkpoint));
    assert.throws(() => npcGmSourceValue({ ...source('NPC-017'), campaignId: scope.campaignId }));
  });
  it('rejects unknown form, malformed hash, absent/foreign-shaped prefix and malformed revision tuples', () => {
    for (const change of [
      { sourceFormId: 'GM-001' },
      { sourceSnapshotSha256: 'bad' },
      { queuePrefix: null },
      { queuePrefix: { eventId: '', recordSha256: 'b'.repeat(64) } },
      { queuePrefix: { eventId: 'x', recordSha256: 'bad' } },
      { revisions: { ...revisions, actorVisibilityRevision: 13 } },
      { revisions: { ...revisions, projectionRevision: 11 } },
      { revisions: { ...revisions, stateRevision: -1 } },
      { revisions: { ...revisions, extra: 1 } },
    ])
      assert.throws(() => npcGmSourceValue({ ...source('NPC-017'), ...change }));
  });
  it('rejects accessor/symbol hidden fields without reading getters', () => {
    let invoked = false;
    const value = Object.defineProperty({ ...source('NPC-017') }, 'sourceFormId', {
      get() {
        invoked = true;
        return 'NPC-017';
      },
      enumerable: true,
    });
    assert.throws(() => npcGmSourceValue(value));
    assert.equal(invoked, false);
    assert.throws(() => npcGmSourceValue({ ...source('NPC-017'), [Symbol('hidden')]: true }));
  });
  it('operation record requires persisted source and preserves non-UUID technical operation IDs', () => {
    const p = pair('CREATE');
    assert.deepEqual(npcOperationValue(p.operation, readers), p.operation);
    const noSource: Record<string, unknown> = { ...p.operation };
    delete noSource['beforeGmSource'];
    assert.throws(() => npcOperationValue(noSource, readers));
    const read = npcAttemptEventValue(p.event, {
      attempt: (_stage, value) => {
        s.object(value, []);
        return {};
      },
      requiredPreStartTime: () => {
        throw Error('unused full snapshot time requirement');
      },
      inspectStoredSnapshot: () => {
        throw Error('unused full snapshot inspection');
      },
      publishedChildGraph: () => {
        throw Error('unused full snapshot');
      },
      snapshot: () => {
        throw Error('unused');
      },
      lifetimeFacts: () => {
        throw Error('unused');
      },
      validateVersion: () => {
        throw Error('unused');
      },
      validateAttemptOrigin: () => {
        throw Error('origin belongs to the owning store, not this primitive codec');
      },
    });
    assert.equal(read.operationId, 'navigation-existing-v2-text');
    assert.equal(read.attempt.npcDraftId, draftId);
    assert.throws(() =>
      npcAttemptEventValue(
        { ...p.event, attempt: { ...p.event.attempt, npcDraftId: 'client-id' } },
        {
          attempt: () => {
            throw Error('not reached');
          },
          requiredPreStartTime: () => {
            throw Error('unused full snapshot time requirement');
          },
          inspectStoredSnapshot: () => {
            throw Error('unused full snapshot inspection');
          },
          publishedChildGraph: () => {
            throw Error('unused full snapshot');
          },
          snapshot: () => {
            throw Error('unused');
          },
          lifetimeFacts: () => {
            throw Error('unused');
          },
          validateVersion: () => {
            throw Error('unused');
          },
          validateAttemptOrigin: () => {
            throw Error('origin belongs to the owning store, not this primitive codec');
          },
        },
      ),
    );
  });
});

describe('NPC intrinsic workflow source binding', () => {
  for (const kind of ['OPEN', 'COMMIT_V1', 'COMMIT'] as const) {
    it(`${kind} accepts current presentation revisions even when campaign revisions differ`, () =>
      verify(pair(kind)));
    for (const field of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const)
      it(`${kind} rejects stale ${field}`, () => {
        const p = pair(kind);
        p.operation = {
          ...p.operation,
          request: {
            ...p.operation.request,
            expectedRevisions: { ...revisions, [field]: revisions[field] + 1 },
          },
        };
        assert.throws(() => verify(p));
      });
    it(`${kind} rejects wrong source form even with a matching vector`, () =>
      assert.throws(() => verify(pair(kind, 'NPC-001'))));
  }
  it('OPEN accepts both source-defined detail/history forms', () => {
    verify(pair('OPEN', 'NPC-003'));
    verify(pair('OPEN', 'NPC-007'));
  });
  it('does not replace stored source with a later/current campaign presentation', () => {
    const p = pair('COMMIT_V1');
    verify(p);
    const bytes = s.canonical(p.operation);
    const newerCampaign = {
      ...checkpoint,
      stateRevision: 20,
      projectionRevision: 30,
      actorVisibilityRevision: 4,
    };
    verify({
      ...p,
      operation: {
        ...p.operation,
        beforeCheckpoint: newerCampaign,
        afterCheckpoint: newerCampaign,
      },
    });
    assert.equal(s.canonical(p.operation), bytes);
    // Pure binding has no current view input. Actual replay lookup/zero writes remain owning SQLite tests.
  });
  it('retains exact workflow UUID, command/campaign/draft/version and phase guards', () => {
    const p = pair('COMMIT');
    for (const request of [
      { ...p.operation.request, commandId: 'navigation-text' },
      { ...p.operation.request, commandId: uuid(8) },
      {
        ...p.operation.request,
        payload: {
          phase: 'COMMIT',
          campaignId: uuid(8),
          npcDraftId: draftId,
          expectedAttemptRevision: 2,
          expectedCurrentVersion: 1,
        },
      },
      workflow('OPEN'),
    ])
      assert.throws(() => verify({ ...p, operation: { ...p.operation, request } }));
    assert.throws(() =>
      verify({ ...p, event: { ...p.event, attempt: { ...p.event.attempt, npcDraftId: uuid(9) } } }),
    );
    assert.throws(() =>
      verify({
        ...p,
        event: {
          ...p.event,
          attempt: {
            ...p.event.attempt,
            targetOrNull: { npcUuid: npcId, expectedCurrentVersion: 2 },
          },
        },
      }),
    );
  });
});

describe('existing form-action versus draft replace', () => {
  for (const kind of ['CREATE', 'REPLACE', 'CANCEL'] as const)
    it(`${kind} accepts only actual NAV echoes without a client-assigned draftId`, () => {
      const p = pair(kind);
      assert.equal(Object.hasOwn(p.operation.request, 'npcDraftId'), false);
      verify(p);
    });
  it('CREATE rejects an attempt to add draftId to the exact existing form-action envelope', () => {
    const p = pair('CREATE');
    assert.throws(() =>
      npcOperationValue(
        { ...p.operation, request: { ...p.operation.request, npcDraftId: draftId } },
        readers,
      ),
    );
  });
  it('FORM_ACTION refuses old projection, foreign source form/id and extra binding fields', () => {
    const p = pair('REPLACE');
    const binding = readers.technicalBinding('REPLACE', p.operation.request);
    for (const b of [
      { ...binding, expectedProjectionRevision: 18 },
      { ...binding, sourceFormId: 'NPC-012' },
      { ...binding, navigationRequestId: 'different' },
      { ...binding, npcDraftId: draftId },
    ])
      assert.throws(() => verify(p, withBinding(b)));
  });
  it('DRAFT_REPLACE retains full real attempt scope/revision and all presentation revisions', () =>
    verify(pair('REPLACE'), withBinding(draftBinding())));
  it('DRAFT_REPLACE cannot impersonate CREATE or CANCEL', () => {
    assert.throws(() => verify(pair('CREATE'), withBinding(draftBinding())));
    assert.throws(() => verify(pair('CANCEL'), withBinding(draftBinding())));
  });
  it('DRAFT_REPLACE rejects foreign campaign/draft, stale attempt and each stale presentation field', () => {
    const b = draftBinding();
    for (const changed of [
      { ...b, campaignId: uuid(8) },
      { ...b, npcDraftId: uuid(8) },
      { ...b, expectedAttemptRevision: 1 },
      ...(['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).map(
        (field) => ({ ...b, expectedRevisions: { ...revisions, [field]: revisions[field] + 1 } }),
      ),
    ])
      assert.throws(() => verify(pair('REPLACE'), withBinding(changed)));
  });
  it('rejects unknown binding variants, wrong CREATE form, and forged event/scope', () => {
    const p = pair('CREATE');
    assert.throws(() => verify(p, withBinding({ kind: 'NAV' })));
    assert.throws(() => verify(pair('CREATE', 'NPC-003')));
    assert.throws(() => verify({ ...p, event: { ...p.event, operationId: 'changed' } }));
    assert.throws(() =>
      verify({
        ...p,
        event: {
          ...p.event,
          attempt: { ...p.event.attempt, scope: { ...scope, campaignId: uuid(9) } },
        },
      }),
    );
  });
});

describe('closed ephemeral lobby anchor in NPC calendar context', () => {
  const base = () => ({
    format: 'NPC_CALENDAR_READ_V1',
    scope,
    checkpoint: {
      campaignId: scope.campaignId,
      snapshotJson: s.canonical({
        campaign: { campaignId: scope.campaignId, lifecycleState: 'PAUSED', payloadJson: '{}' },
        campaignCharacterCopies: [],
      }),
      ...revisions,
    },
    currentQueuePrefixOrNull: null,
    currentClock: { phase: 'PRE_START', campaignTimestampOrNull: null, sourceOrNull: null },
    operations: [],
  });
  it('preserves legacy absence and exact explicit null or checked SHA without aliasing source seals', () => {
    const legacy = base();
    assert.deepEqual(npcCalendarReadContextValue(legacy), legacy);
    assert.equal(
      Object.hasOwn(
        npcCalendarReadContextValue(legacy).currentClock,
        'lobbySnapshotRevisionOrNull',
      ),
      false,
    );
    for (const value of [null, 'c'.repeat(64)]) {
      const current = {
        ...legacy,
        currentClock: { ...legacy.currentClock, lobbySnapshotRevisionOrNull: value },
      };
      assert.deepEqual(npcCalendarReadContextValue(current), current);
    }
  });
  it('rejects undefined, aliases, unknown keys and accessors without running a getter', () => {
    for (const value of [undefined, 1, 'SHA/1', 'A'.repeat(64)])
      assert.throws(() =>
        npcCalendarReadContextValue({
          ...base(),
          currentClock: { ...base().currentClock, lobbySnapshotRevisionOrNull: value },
        }),
      );
    assert.throws(() =>
      npcCalendarReadContextValue({
        ...base(),
        currentClock: { ...base().currentClock, lobbyRevision: 'a'.repeat(64) },
      }),
    );
    let calls = 0;
    const clock = { ...base().currentClock };
    Object.defineProperty(clock, 'lobbySnapshotRevisionOrNull', {
      enumerable: true,
      get() {
        calls++;
        return 'a'.repeat(64);
      },
    });
    assert.throws(() => npcCalendarReadContextValue({ ...base(), currentClock: clock }));
    assert.equal(calls, 0);
  });
});
