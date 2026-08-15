import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openPersistenceDatabase } from './database.js';
import { MAX_SAFE_REVISION, migration0001 } from './migrations/0001-initial.js';
import { applyMigrations, applyMigrationSequence } from './migrations/index.js';
import {
  commitLocalCharacterCheckpoint,
  createLocalCharacter,
  loadLocalCharacterCheckpoint,
  readLocalCharacter,
  readRevisions,
  type LocalCharacterCheckpointWriter,
  type RevisionTriple,
} from './store.js';

const databases: Database.Database[] = [];

const memoryDatabase = (): Database.Database => {
  const database = openPersistenceDatabase(':memory:');
  databases.push(database);
  return database;
};

const rawMemoryDatabase = (): Database.Database => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  databases.push(database);
  return database;
};

const impact = (
  stateChanged: boolean,
  projectionChanged: boolean,
  actorVisibilityChanged: boolean,
) => ({ stateChanged, projectionChanged, actorVisibilityChanged });

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const createDraft = (
  database: Database.Database,
  localCharacterId: string,
  payloadJson = '{}',
): void => {
  createLocalCharacter(database, localCharacterId, 'DRAFT', payloadJson);
};

interface CheckpointInsert extends RevisionTriple {
  checkpointId: string;
  localCharacterId: string;
  checkpointRevision: number;
  snapshotJson: string;
  snapshotSha256: string;
}

const insertCheckpoint = (
  database: Database.Database,
  overrides: Partial<CheckpointInsert> = {},
): void => {
  const row: CheckpointInsert = {
    checkpointId: 'checkpoint',
    localCharacterId: 'character',
    checkpointRevision: 0,
    snapshotJson: '{}',
    snapshotSha256: sha256('{}'),
    stateRevision: 0,
    projectionRevision: 0,
    actorVisibilityRevision: 0,
    ...overrides,
  };
  database
    .prepare<CheckpointInsert>(
      `INSERT INTO local_character_checkpoint (
         checkpoint_id, local_character_id, checkpoint_revision,
         snapshot_json, snapshot_sha256, stateRevision,
         projectionRevision, actorVisibilityRevision
       ) VALUES (
         @checkpointId, @localCharacterId, @checkpointRevision,
         @snapshotJson, @snapshotSha256, @stateRevision,
         @projectionRevision, @actorVisibilityRevision
       )`,
    )
    .run(row);
};

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe('local character checkpoint migration', () => {
  it('upgrades version 1 to 2 without changing the existing local character row', () => {
    const database = rawMemoryDatabase();
    expect(applyMigrationSequence(database, [migration0001])).toBe(1);
    createDraft(database, 'preserved', '{ "source": "v1" }');

    expect(applyMigrations(database)).toBe(2);
    expect(
      database.prepare('SELECT version, name FROM schema_migration ORDER BY version').all(),
    ).toEqual([
      { version: 1, name: 'initial' },
      { version: 2, name: 'local-character-checkpoint' },
    ]);
    expect(readLocalCharacter(database, 'preserved').payloadJson).toBe('{ "source": "v1" }');

    const columns = database
      .prepare<[], { name: string; type: string; notnull: number; pk: number }>(
        `SELECT name, type, "notnull", pk
         FROM pragma_table_info('local_character_checkpoint')
         ORDER BY cid`,
      )
      .all();
    expect(columns).toEqual([
      { name: 'checkpoint_id', type: 'TEXT', notnull: 1, pk: 1 },
      { name: 'local_character_id', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'checkpoint_revision', type: 'INTEGER', notnull: 1, pk: 0 },
      { name: 'snapshot_json', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'snapshot_sha256', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'stateRevision', type: 'INTEGER', notnull: 1, pk: 0 },
      { name: 'projectionRevision', type: 'INTEGER', notnull: 1, pk: 0 },
      { name: 'actorVisibilityRevision', type: 'INTEGER', notnull: 1, pk: 0 },
    ]);
    expect(
      database
        .prepare<[], { table: string; from: string; to: string; on_delete: string }>(
          `SELECT "table", "from", "to", on_delete
           FROM pragma_foreign_key_list('local_character_checkpoint')`,
        )
        .get(),
    ).toEqual({
      table: 'local_character',
      from: 'local_character_id',
      to: 'local_character_id',
      on_delete: 'RESTRICT',
    });
  });

  it('enforces owner, revision, JSON-object, checksum, and delete constraints', () => {
    const database = memoryDatabase();
    createDraft(database, 'character');
    createDraft(database, 'other-character');
    insertCheckpoint(database);

    expect(() =>
      insertCheckpoint(database, {
        checkpointId: 'other-checkpoint',
        localCharacterId: 'character',
      }),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      insertCheckpoint(database, {
        checkpointId: 'orphan-checkpoint',
        localCharacterId: 'missing-character',
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      database.prepare('DELETE FROM local_character WHERE local_character_id = ?').run('character'),
    ).toThrow(/FOREIGN KEY constraint failed/);

    for (const overrides of [
      { checkpointId: 'negative-checkpoint', checkpointRevision: -1 },
      { checkpointId: 'negative-state', stateRevision: -1 },
      { checkpointId: 'array-snapshot', snapshotJson: '[]', snapshotSha256: sha256('[]') },
      { checkpointId: 'short-hash', snapshotSha256: '0'.repeat(63) },
      { checkpointId: 'uppercase-hash', snapshotSha256: 'A'.repeat(64) },
      { checkpointId: 'non-hex-hash', snapshotSha256: 'g'.repeat(64) },
    ] satisfies Partial<CheckpointInsert>[]) {
      expect(() =>
        insertCheckpoint(database, {
          localCharacterId: 'other-character',
          ...overrides,
        }),
      ).toThrow(/CHECK constraint failed/);
    }

    const schema = database
      .prepare<[], { sql: string }>(
        `SELECT sql FROM sqlite_schema
         WHERE type = 'table' AND name = 'local_character_checkpoint'`,
      )
      .get();
    expect(schema?.sql.match(new RegExp(`BETWEEN 0 AND ${MAX_SAFE_REVISION}`, 'g'))).toHaveLength(
      4,
    );
  });
});

describe('local character checkpoint store', () => {
  it('commits revision zero with the exact noncanonical payload string and SHA-256', () => {
    const database = memoryDatabase();
    const payloadJson = '{  "z":1, "a" : [ 2, 3 ] }';
    createDraft(database, 'character', payloadJson);
    const snapshotJson = JSON.stringify({
      localCharacter: {
        localCharacterId: 'character',
        lifecycleState: 'DRAFT',
        payloadJson,
      },
    });

    const committed = commitLocalCharacterCheckpoint(
      database,
      'character',
      'checkpoint',
      () => 'saved',
    );
    expect(committed.result).toBe('saved');
    expect(committed.checkpoint).toEqual({
      checkpointId: 'checkpoint',
      localCharacterId: 'character',
      checkpointRevision: 0,
      snapshotJson,
      snapshotSha256: '57a72b8b8c0a7170f30d9fc60cd4aa6174aa8e1c81221a89b3eff67be652dcfb',
      stateRevision: 0,
      projectionRevision: 0,
      actorVisibilityRevision: 0,
    });
    expect(committed.checkpoint.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(loadLocalCharacterCheckpoint(database, 'character')).toEqual(committed.checkpoint);
  });

  it('increments only for a new snapshot and keeps root revisions still on replay and refresh', () => {
    const database = memoryDatabase();
    createDraft(database, 'character', '{"version":1}');
    const first = commitLocalCharacterCheckpoint(
      database,
      'character',
      'checkpoint',
      () => undefined,
    ).checkpoint;

    const changed = commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', (update) =>
      update({ payloadJson: '{"version":2}' }, impact(true, false, false)),
    ).checkpoint;
    expect(changed.checkpointRevision).toBe(1);
    expect(changed.stateRevision).toBe(1);
    expect(changed.snapshotJson).not.toBe(first.snapshotJson);

    const replayed = commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', (update) =>
      update({ payloadJson: '{"version":2}' }, impact(false, false, false)),
    ).checkpoint;
    expect(replayed).toEqual(changed);

    const refreshed = commitLocalCharacterCheckpoint(
      database,
      'character',
      'checkpoint',
      () => undefined,
    ).checkpoint;
    expect(refreshed).toEqual(changed);
    expect(readRevisions(database, { entity: 'localCharacter', entityId: 'character' })).toEqual({
      stateRevision: 1,
      projectionRevision: 0,
      actorVisibilityRevision: 0,
    });
  });

  it('rejects reused identities in either direction before invoking the callback', () => {
    const database = memoryDatabase();
    createDraft(database, 'character-a');
    createDraft(database, 'character-b');
    commitLocalCharacterCheckpoint(database, 'character-a', 'checkpoint-a', () => undefined);
    let callbackInvoked = false;
    const write = (): void => {
      callbackInvoked = true;
    };

    expect(() =>
      commitLocalCharacterCheckpoint(database, 'character-a', 'checkpoint-b', write),
    ).toThrow(/checkpoint is fixed as "checkpoint-a", not "checkpoint-b"/);
    expect(() =>
      commitLocalCharacterCheckpoint(database, 'character-b', 'checkpoint-a', write),
    ).toThrow(/belongs to "character-a", not "character-b"/);
    expect(() =>
      commitLocalCharacterCheckpoint(database, 'character-b', 'character-b', write),
    ).toThrow(/checkpointId must differ from localCharacterId/);
    expect(callbackInvoked).toBe(false);
    expect(
      database.prepare('SELECT count(*) AS count FROM local_character_checkpoint').get(),
    ).toEqual({ count: 1 });
  });

  it('keeps the callback synchronous, top-level, and transaction-scoped', async () => {
    const database = memoryDatabase();
    createDraft(database, 'character', '{"version":1}');

    const nested = database.transaction(() =>
      commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', () => undefined),
    );
    expect(() => nested.immediate()).toThrow(/requires a top-level transaction/);

    const asyncWrite = async (_update: LocalCharacterCheckpointWriter): Promise<void> => {
      await Promise.resolve();
    };
    expect(() =>
      commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', asyncWrite as never),
    ).toThrow(/must be synchronous/);
    await Promise.resolve();

    let leakedWriter: LocalCharacterCheckpointWriter | undefined;
    commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', (update) => {
      leakedWriter = update;
    });
    expect(leakedWriter).toBeDefined();
    expect(() =>
      leakedWriter?.({ payloadJson: '{"leaked":true}' }, impact(true, false, false)),
    ).toThrow(/writer is no longer active/);

    expect(() =>
      commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', (update) => {
        update({ payloadJson: '{"version":2}' }, impact(true, false, false));
        update({ payloadJson: '{"version":2}' }, impact(false, true, false));
      }),
    ).toThrow(/writer is no longer active/);
    expect(readLocalCharacter(database, 'character').payloadJson).toBe('{"version":1}');
  });

  it('rolls back a thenable callback after its synchronous local character write', () => {
    const database = memoryDatabase();
    createDraft(database, 'character', '{"version":1}');

    expect(() =>
      commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', (update) => {
        update({ payloadJson: '{"version":2}' }, impact(true, false, false));
        return { then: (): void => undefined };
      }),
    ).toThrow(/must be synchronous/);
    expect(readLocalCharacter(database, 'character')).toMatchObject({
      payloadJson: '{"version":1}',
      stateRevision: 0,
    });
    expect(() => loadLocalCharacterCheckpoint(database, 'character')).toThrow(/has no checkpoint/);
  });

  it('rolls back the row, revisions, and previous checkpoint when checkpoint storage fails', () => {
    const database = memoryDatabase();
    createDraft(database, 'character', '{"version":1}');
    const previous = commitLocalCharacterCheckpoint(
      database,
      'character',
      'checkpoint',
      () => undefined,
    ).checkpoint;
    database.exec(`CREATE TEMP TRIGGER interrupt_local_character_checkpoint
      BEFORE UPDATE ON local_character_checkpoint
      BEGIN SELECT RAISE(ABORT, 'interrupted local character checkpoint'); END;`);

    expect(() =>
      commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', (update) =>
        update({ payloadJson: '{"version":2}' }, impact(true, true, false)),
      ),
    ).toThrow(/interrupted local character checkpoint/);
    database.exec('DROP TRIGGER interrupt_local_character_checkpoint');

    expect(readLocalCharacter(database, 'character')).toMatchObject({
      payloadJson: '{"version":1}',
      stateRevision: 0,
      projectionRevision: 0,
      actorVisibilityRevision: 0,
    });
    expect(loadLocalCharacterCheckpoint(database, 'character')).toEqual(previous);
  });

  it('rejects checkpoint revision overflow and rolls back the new snapshot', () => {
    const database = memoryDatabase();
    createDraft(database, 'character', '{"version":1}');
    commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', () => undefined);
    database
      .prepare(
        `UPDATE local_character_checkpoint
         SET checkpoint_revision = ?
         WHERE local_character_id = ?`,
      )
      .run(MAX_SAFE_REVISION, 'character');

    expect(() =>
      commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', (update) =>
        update({ payloadJson: '{"version":2}' }, impact(true, false, false)),
      ),
    ).toThrow(/revision overflow/);
    expect(readLocalCharacter(database, 'character')).toMatchObject({
      payloadJson: '{"version":1}',
      stateRevision: 0,
    });
    expect(loadLocalCharacterCheckpoint(database, 'character').checkpointRevision).toBe(
      MAX_SAFE_REVISION,
    );
  });

  it('rejects a snapshot change without its root state revision and rolls it back', () => {
    const database = memoryDatabase();
    createDraft(database, 'character', '{"version":1}');
    commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', () => undefined);

    expect(() =>
      commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', (update) =>
        update({ payloadJson: '{"version":2}' }, impact(false, false, false)),
      ),
    ).toThrow(/stateRevision and snapshot change disagree/);
    expect(readLocalCharacter(database, 'character').payloadJson).toBe('{"version":1}');

    expect(() =>
      commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', (update) =>
        update({ payloadJson: '{"version":1}' }, impact(true, false, false)),
      ),
    ).toThrow(/stateRevision and snapshot change disagree/);
    expect(readLocalCharacter(database, 'character').stateRevision).toBe(0);
  });

  it('loads fail-closed when the stored checksum is corrupt', () => {
    const database = memoryDatabase();
    createDraft(database, 'character');
    commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', () => undefined);
    database
      .prepare('UPDATE local_character_checkpoint SET snapshot_sha256 = ?')
      .run('0'.repeat(64));

    expect(() => loadLocalCharacterCheckpoint(database, 'character')).toThrow(
      /checksum does not match its snapshot/,
    );
  });

  it('loads fail-closed when a validly hashed snapshot differs from the builder', () => {
    const database = memoryDatabase();
    createDraft(database, 'character');
    commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', () => undefined);
    const snapshotJson = '{"localCharacter":{"tampered":true}}';
    database
      .prepare(
        `UPDATE local_character_checkpoint
         SET snapshot_json = ?, snapshot_sha256 = ?`,
      )
      .run(snapshotJson, sha256(snapshotJson));

    expect(() => loadLocalCharacterCheckpoint(database, 'character')).toThrow(
      /snapshot does not match current state/,
    );
  });

  it('loads fail-closed when the stored revision triple differs from the owner', () => {
    const database = memoryDatabase();
    createDraft(database, 'character');
    commitLocalCharacterCheckpoint(database, 'character', 'checkpoint', () => undefined);
    database.prepare('UPDATE local_character_checkpoint SET projectionRevision = 1').run();

    expect(() => loadLocalCharacterCheckpoint(database, 'character')).toThrow(
      /revisions do not match current state/,
    );
  });
});
