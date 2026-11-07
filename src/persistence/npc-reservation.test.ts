import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, it } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import { loadNpcAuthoringSourceCatalog } from '../host/npc-catalog.js';
import { readNpcEditorDraft } from '../domain/rules/npc-authoring/staged-input.js';
import { configurePersistenceDatabase, openPersistenceDatabase } from './database.js';
import { bootstrapDeviceIdentity, loadDeviceId } from './device-identity.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import { npcIdentityInUse } from './npc-identities.js';
import { ensureLocalGmProfile } from './campaign-creation.js';
import {
  commitNewCampaignCheckpoint,
  commitNewLocalCharacterCheckpoint,
  createLocalCharacter,
} from './store.js';
import {
  npcAttemptValue,
  npcGmSourceValue,
  type NpcAttempt,
  type NpcDomainReaders,
  type NpcHistoricalSourceReader,
  type NpcRequestReader,
} from './npc-library-records.js';
import {
  saveNpcAttempt,
  readNpcRecoveryClosure,
  type NpcBoundary,
  type NpcTransactionIntegration,
} from './npc-library-store.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const root = fileURLToPath(new URL('../../', import.meta.url));
let catalogPromise: ReturnType<typeof loadNpcAuthoringSourceCatalog> | undefined;
const sources = () => (catalogPromise ??= loadNpcAuthoringSourceCatalog(root));
const unset = { kind: 'UNSET' } as const;
const fields = (keys: string) => Object.fromEntries(keys.split(' ').map((key) => [key, unset]));
const initial = () => ({
  schemaVersion: 1,
  identity: fields('name description affiliation campaignRole sex massKg artAssetKeyOrNull'),
  schema: fields('raceCode pureClassOrNull anatomyProfileId'),
  baseStats: fields('S D M Z I W C'),
  symbionts: unset,
  skills: unset,
  inventory: unset,
  initialState: fields(
    'currentHP effectInstanceIds traumaInstanceIds woundInstanceIds sourceSpecificStateFactIds deathConsequenceFactIdOrNull',
  ),
});
const impossible = (): never => {
  throw new Error(
    'Full version reader is deliberately unavailable in the technical-attempt fixture',
  );
};

/** Real attempt storage and closed editor inputs. This SQL source fixture is not the production GM queue. */
async function fixture(bytes?: Buffer) {
  const db = bytes === undefined ? openPersistenceDatabase(':memory:') : new Database(bytes);
  if (bytes !== undefined) configurePersistenceDatabase(db);
  const ownerDeviceId = bootstrapDeviceIdentity(db),
    scope = { ownerDeviceId, campaignId: uuid(1), gmLocalContextId: uuid(2) };
  if (bytes === undefined) {
    commitNewCampaignCheckpoint(db, scope.campaignId, (create) => create('PAUSED', '{}'));
    db.exec(
      'CREATE TABLE npc_test_source (id TEXT PRIMARY KEY, source_json TEXT NOT NULL, selection_json TEXT NOT NULL); CREATE TABLE npc_test_mirror (operation_id TEXT PRIMARY KEY, operation_sha256 TEXT NOT NULL)',
    );
  }
  const catalog = await sources();
  const readers: NpcDomainReaders & NpcRequestReader & NpcHistoricalSourceReader = {
    attempt(_stage, value) {
      return readNpcEditorDraft(
        { skills: catalog.skills, development: catalog.development },
        value,
      ) as unknown as JsonObject;
    },
    // This deliberately primitive fixture has no real campaign/lobby domain and cannot read any version.
    createReadContext: () => null,
    inspectStoredSnapshot: impossible,
    snapshot: impossible,
    requiredPreStartTime: impossible,
    publishedChildGraph: impossible,
    lifetimeFacts: impossible,
    validateVersion: impossible,
    validateAttemptOrigin(attempt, operation, base) {
      assert.equal(operation.kind, 'CREATE');
      assert.equal(base, null);
      assert.deepEqual(attempt.values, initial());
    },
    request(kind, value) {
      assert.ok(['CREATE', 'REPLACE', 'CANCEL'].includes(kind));
      const r = s.object(value, [
        'messageType',
        'protocolVersion',
        'navigationRequestId',
        'sourceFormId',
        'actionKey',
        'expectedProjectionRevision',
      ]);
      assert.equal(r['messageType'], 'navigation.form-action');
      assert.equal(r['protocolVersion'], 2);
      s.text(r['navigationRequestId']);
      s.text(r['actionKey']);
      s.integer(r['expectedProjectionRevision']);
      assert.ok(['NPC-001', 'NPC-002'].includes(s.text(r['sourceFormId'])));
      return r as JsonObject;
    },
    technicalBinding(_kind, r) {
      return {
        kind: 'FORM_ACTION',
        navigationRequestId: s.text(r['navigationRequestId']),
        sourceFormId: r['sourceFormId'] as 'NPC-001' | 'NPC-002',
        expectedProjectionRevision: s.integer(r['expectedProjectionRevision']),
      };
    },
    validateHistoricalGmSources(entries) {
      for (const { operation: o, event: e, previous } of entries) {
        const row = db
          .prepare('SELECT source_json,selection_json FROM npc_test_source WHERE id=?')
          .get(o.beforeGmSource.queuePrefix.eventId) as
          { source_json: string; selection_json: string } | undefined;
        assert.ok(row);
        assert.deepEqual(
          npcGmSourceValue(JSON.parse(row.source_json) as unknown),
          o.beforeGmSource,
        );
        assert.equal(s.sha(row.selection_json), o.beforeGmSource.sourceSnapshotSha256);
        assert.equal(
          s.sha(
            s.canonical({
              sourceFormId: o.beforeGmSource.sourceFormId,
              selectionJson: row.selection_json,
            }),
          ),
          o.beforeGmSource.queuePrefix.recordSha256,
        );
        assert.deepEqual(
          JSON.parse(row.selection_json) as unknown,
          previous === null
            ? null
            : { npcDraftId: previous.attempt.npcDraftId, revision: previous.attempt.revision },
        );
        assert.equal(e.operationId, o.operationId);
        assert.deepEqual(
          db
            .prepare('SELECT operation_sha256 FROM npc_test_mirror WHERE operation_id=?')
            .get(o.operationId),
          { operation_sha256: s.sha(s.canonical(o)) },
        );
      }
    },
  };
  let currentSourceId: string | undefined;
  const integration: NpcTransactionIntegration = {
    readCheckedGmSource(b) {
      assert.ok(db.inTransaction);
      assert.ok(currentSourceId);
      assert.equal(b.scope.campaignId, scope.campaignId);
      const row = db
        .prepare('SELECT source_json FROM npc_test_source WHERE id=?')
        .get(currentSourceId) as { source_json: string };
      return npcGmSourceValue(JSON.parse(row.source_json) as unknown);
    },
    validate(b, c) {
      assert.deepEqual(b.scope, scope);
      assert.equal(c.campaignId, scope.campaignId);
    },
    writeGmMirror(o) {
      db.prepare('INSERT INTO npc_test_mirror VALUES(?,?)').run(
        o.operationId,
        s.sha(s.canonical(o)),
      );
    },
  };
  const attempt = (candidateNpcUuid = uuid(4)): NpcAttempt => ({
    scope,
    npcDraftId: uuid(3),
    candidateNpcUuid,
    revision: 0,
    mode: 'CREATE_V1',
    targetOrNull: null,
    stage: 'NPC-002',
    status: 'OPEN',
    values: initial(),
  });
  const boundary = (
    kind: 'CREATE' | 'REPLACE' | 'CANCEL',
    n: number,
    previous: NpcAttempt | null,
  ): NpcBoundary => {
    const sourceFormId = kind === 'CREATE' ? 'NPC-001' : 'NPC-002',
      selectionJson = s.canonical(
        previous === null ? null : { npcDraftId: previous.npcDraftId, revision: previous.revision },
      );
    currentSourceId = `source-${n}`;
    const source = {
      sourceFormId,
      revisions: { stateRevision: n, projectionRevision: n + 9, actorVisibilityRevision: 0 },
      sourceSnapshotSha256: s.sha(selectionJson),
      queuePrefix: {
        eventId: currentSourceId,
        recordSha256: s.sha(s.canonical({ sourceFormId, selectionJson })),
      },
    };
    db.prepare('INSERT INTO npc_test_source VALUES(?,?,?)').run(
      currentSourceId,
      s.canonical(source),
      selectionJson,
    );
    const request = {
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: `navigation-${n}`,
      sourceFormId,
      actionKey: `${sourceFormId}::CTA::001`,
      expectedProjectionRevision: n + 9,
    };
    return {
      scope,
      kind,
      operationId: request.navigationRequestId,
      request,
      expectedAttemptRevisionOrNull: previous?.revision ?? null,
      expectedCurrentVersionOrNull: null,
    };
  };
  const save = (b: NpcBoundary, a: NpcAttempt, n: number) =>
    saveNpcAttempt(db, b, a, uuid(100 + n), '2026-11-06T00:00:00.000Z', readers, integration);
  return { db, scope, readers, integration, attempt, boundary, save };
}

describe('NPC host-reserved identity in actual candidate SQLite schema 15', () => {
  it('CREATE reserves a separate owner, exact replay and serialized reopen keep it without an entity', async () => {
    const f = await fixture();
    let reopened: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      const a = f.attempt(),
        b = f.boundary('CREATE', 1, null),
        first = f.save(b, a, 1);
      assert.equal(first.replayed, false);
      const before = f.db.serialize(),
        replay = f.save(b, { ...a, candidateNpcUuid: uuid(99) }, 99);
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.operation, first.operation);
      assert.ok(f.db.serialize().equals(before));
      reopened = await fixture(before);
      const c = readNpcRecoveryClosure(reopened.db, f.scope.campaignId, reopened.readers);
      assert.deepEqual(c.reservations, [
        {
          campaignId: f.scope.campaignId,
          npcDraftId: a.npcDraftId,
          candidateNpcUuid: a.candidateNpcUuid,
          createOperationId: b.operationId,
        },
      ]);
      assert.equal(c.attempts[0]?.attempt.candidateNpcUuid, a.candidateNpcUuid);
      assert.deepEqual(c.versions, []);
      assert.deepEqual(c.blocks, []);
      assert.equal(c.anchorOrNull, null);
      assert.deepEqual(reopened.db.prepare('SELECT * FROM npc_current_head').all(), []);
    } finally {
      reopened?.db.close();
      f.db.close();
    }
  });
  it('edit preserves candidate, cancel keeps reservation forever and old CREATE replay has no writes', async () => {
    const f = await fixture();
    try {
      const a = f.attempt(),
        b = f.boundary('CREATE', 1, null),
        first = f.save(b, a, 1);
      const changed = {
        ...a,
        revision: 1,
        values: {
          ...a.values,
          identity: {
            ...(a.values['identity'] as JsonObject),
            name: { kind: 'ENTERED', value: 'Saved technical name' },
          },
        },
      };
      f.save(f.boundary('REPLACE', 2, a), changed, 2);
      const cancelled = { ...changed, revision: 2, status: 'CANCELLED' as const };
      f.save(f.boundary('CANCEL', 3, changed), cancelled, 3);
      const closure = readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers);
      assert.equal(closure.reservations.length, 1);
      assert.equal(closure.attempts.at(-1)?.attempt.status, 'CANCELLED');
      assert.deepEqual(closure.versions, []);
      const before = f.db.serialize();
      assert.deepEqual(f.save(b, a, 1).operation, first.operation);
      assert.ok(f.db.serialize().equals(before));
      const next = { ...a, npcDraftId: uuid(30) },
        nextB = f.boundary('CREATE', 4, null),
        snapshot = f.db.serialize();
      assert.throws(() => f.save(nextB, next, 4));
      assert.ok(f.db.serialize().equals(snapshot));
    } finally {
      f.db.close();
    }
  });
  it('changed candidate, stale attempt, changed request, foreign owner and extra candidate field refuse byte-no-write', async () => {
    const f = await fixture();
    try {
      const a = f.attempt(),
        b = f.boundary('CREATE', 1, null);
      f.save(b, a, 1);
      const replace = f.boundary('REPLACE', 2, a),
        before = f.db.serialize();
      for (const run of [
        () => f.save(replace, { ...a, revision: 1, candidateNpcUuid: uuid(44) }, 2),
        () => f.save({ ...replace, expectedAttemptRevisionOrNull: 9 }, { ...a, revision: 1 }, 2),
        () => f.save({ ...b, request: { ...b.request, actionKey: 'changed' } }, a, 1),
        () =>
          f.save(
            { ...replace, scope: { ...f.scope, ownerDeviceId: uuid(90) } },
            { ...a, revision: 1 },
            2,
          ),
        () =>
          f.save(
            replace,
            { ...a, revision: 1, values: { ...a.values, candidateNpcUuid: uuid(44) } },
            2,
          ),
      ]) {
        assert.throws(run);
        assert.ok(f.db.serialize().equals(before));
      }
    } finally {
      f.db.close();
    }
  });
  it('rolls back event, head, reserve and receipt together when the mirror refuses', async () => {
    const f = await fixture();
    try {
      const a = f.attempt(),
        b = f.boundary('CREATE', 1, null),
        before = f.db.serialize();
      assert.throws(() =>
        saveNpcAttempt(f.db, b, a, uuid(101), 'stamp', f.readers, {
          ...f.integration,
          writeGmMirror() {
            throw new Error('injected owning mirror failure');
          },
        }),
      );
      assert.ok(f.db.serialize().equals(before));
      assert.deepEqual(f.db.prepare('SELECT * FROM npc_identity_reservation').all(), []);
    } finally {
      f.db.close();
    }
  });
  it('existing local checkpoint and device identity cannot become reserved NPC owners', async () => {
    const f = await fixture();
    try {
      commitNewLocalCharacterCheckpoint(f.db, uuid(40), uuid(41), (create) =>
        create('DRAFT', '{}'),
      );
      for (const [n, id] of [
        [1, uuid(41)],
        [2, f.scope.ownerDeviceId],
      ] as const) {
        const b = f.boundary('CREATE', n, null),
          before = f.db.serialize();
        assert.throws(() => f.save(b, f.attempt(id), n));
        assert.ok(f.db.serialize().equals(before));
      }
    } finally {
      f.db.close();
    }
  });
  it('reserved owner blocks actual legacy character, checkpoint, campaign and GM profile allocators', async () => {
    const f = await fixture();
    try {
      const a = f.attempt();
      f.save(f.boundary('CREATE', 1, null), a, 1);
      const id = a.candidateNpcUuid,
        before = f.db.serialize();
      const runs = [
        () => createLocalCharacter(f.db, id, 'DRAFT', '{}'),
        () =>
          commitNewLocalCharacterCheckpoint(f.db, uuid(80), id, (create) => create('DRAFT', '{}')),
        () => commitNewCampaignCheckpoint(f.db, id, (create) => create('PAUSED', '{}')),
        () =>
          ensureLocalGmProfile(
            f.db,
            { masterProfileId: id, ownerDeviceId: f.scope.ownerDeviceId },
            () => {
              assert.equal(loadDeviceId(f.db), f.scope.ownerDeviceId);
            },
          ),
      ];
      for (const run of runs) {
        assert.throws(run, /IDEMPOTENCY_CONFLICT|identity already/);
        assert.ok(f.db.serialize().equals(before));
      }
      assert.throws(() => s.assertUnused(f.db, id));
      assert.equal(npcIdentityInUse(f.db, id), true);
    } finally {
      f.db.close();
    }
  });
  it('reservation index corruption or removal refuses closure, even before the first version', async () => {
    for (const mutation of [
      'DELETE FROM npc_identity_reservation',
      'UPDATE npc_identity_reservation SET candidate_npc_uuid=?',
    ]) {
      const f = await fixture();
      try {
        f.save(f.boundary('CREATE', 1, null), f.attempt(), 1);
        if (mutation.includes('?')) f.db.prepare(mutation).run(uuid(88));
        else f.db.exec(mutation);
        const before = f.db.serialize();
        assert.throws(() => readNpcRecoveryClosure(f.db, f.scope.campaignId, f.readers));
        assert.throws(
          () => createLocalCharacter(f.db, f.attempt().candidateNpcUuid, 'DRAFT', '{}'),
          /identity already/,
        );
        assert.ok(f.db.serialize().equals(before));
      } finally {
        f.db.close();
      }
    }
  });
  it('APPEND owner is exactly the existing target and cannot allocate a second owner', async () => {
    const f = await fixture();
    try {
      const a = {
        ...f.attempt(),
        mode: 'APPEND_N_PLUS_ONE' as const,
        targetOrNull: { npcUuid: uuid(4), expectedCurrentVersion: 2 },
      };
      assert.deepEqual(npcAttemptValue(a, f.readers), a);
      assert.throws(() => npcAttemptValue({ ...a, candidateNpcUuid: uuid(5) }, f.readers));
      assert.throws(() => npcAttemptValue({ ...a, candidateNpcUuid: a.npcDraftId }, f.readers));
    } finally {
      f.db.close();
    }
  });
  it('legacy allocation refuses a missing or changed NPC migration identity', async () => {
    for (const sql of [
      'DELETE FROM schema_migration WHERE version=15',
      "UPDATE schema_migration SET checksum_sha256='" + '0'.repeat(64) + "' WHERE version=15",
    ]) {
      const f = await fixture();
      try {
        f.save(f.boundary('CREATE', 1, null), f.attempt(), 1);
        f.db.exec(sql);
        const before = f.db.serialize();
        assert.throws(
          () => createLocalCharacter(f.db, uuid(200), 'DRAFT', '{}'),
          /NPC identity namespace/,
        );
        assert.ok(f.db.serialize().equals(before));
      } finally {
        f.db.close();
      }
    }
  });
});
