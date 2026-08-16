import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { bootstrapDeviceIdentity, loadDeviceId, resetDeviceIdentity } from './device-identity.js';
import { configurePersistenceDatabase, openPersistenceDatabase } from './database.js';
import { migration0001 } from './migrations/0001-initial.js';
import { migration0002 } from './migrations/0002-local-character-checkpoint.js';
import { applyMigrations, applyMigrationSequence } from './migrations/index.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface RawDeviceIdentity {
  device_id: string | null;
  initialized: number;
}

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

const rawIdentity = (database: Database.Database): RawDeviceIdentity | undefined =>
  database
    .prepare<[], RawDeviceIdentity>(
      `SELECT device_id, initialized
       FROM device_identity
       WHERE identity_slot = 1`,
    )
    .get();

const overwriteIdentity = (
  database: Database.Database,
  deviceId: string | null,
  initialized = 1,
): void => {
  database.pragma('ignore_check_constraints = ON');
  try {
    database
      .prepare(
        `UPDATE device_identity
         SET device_id = ?, initialized = ?
         WHERE identity_slot = 1`,
      )
      .run(deviceId, initialized);
  } finally {
    database.pragma('ignore_check_constraints = OFF');
  }
};

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe('device identity migration', () => {
  it('upgrades version 2 to 3 without changing existing persistence rows', () => {
    const database = rawMemoryDatabase();
    expect(applyMigrationSequence(database, [migration0001, migration0002])).toBe(2);
    database
      .prepare(
        `INSERT INTO local_character (local_character_id, lifecycle_state, payload_json)
         VALUES (?, ?, ?)`,
      )
      .run('preserved', 'DRAFT', '{ "source": "v2" }');

    expect(applyMigrations(database)).toBe(3);
    expect(
      database.prepare('SELECT version, name FROM schema_migration ORDER BY version').all(),
    ).toEqual([
      { version: 1, name: 'initial' },
      { version: 2, name: 'local-character-checkpoint' },
      { version: 3, name: 'device-identity' },
    ]);
    expect(
      database
        .prepare(
          'SELECT lifecycle_state, payload_json FROM local_character WHERE local_character_id = ?',
        )
        .get('preserved'),
    ).toEqual({ lifecycle_state: 'DRAFT', payload_json: '{ "source": "v2" }' });
    expect(rawIdentity(database)).toEqual({ device_id: null, initialized: 0 });

    const columns = database
      .prepare<[], { name: string; type: string; notnull: number; pk: number }>(
        `SELECT name, type, "notnull", pk
         FROM pragma_table_info('device_identity')
         ORDER BY cid`,
      )
      .all();
    expect(columns).toEqual([
      { name: 'identity_slot', type: 'INTEGER', notnull: 1, pk: 1 },
      { name: 'device_id', type: 'TEXT', notnull: 0, pk: 0 },
      { name: 'initialized', type: 'INTEGER', notnull: 1, pk: 0 },
    ]);
  });

  it('enforces the singleton state and canonical UUID v4 shape in SQLite', () => {
    const database = memoryDatabase();

    expect(() =>
      database
        .prepare(
          `INSERT INTO device_identity (identity_slot, device_id, initialized)
           VALUES (2, NULL, 0)`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);

    for (const invalid of [
      '',
      'NONE',
      '00000000-0000-0000-0000-000000000000',
      'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      'aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase(),
    ]) {
      expect(() =>
        database
          .prepare(
            `UPDATE device_identity
             SET device_id = ?, initialized = 1
             WHERE identity_slot = 1`,
          )
          .run(invalid),
      ).toThrow(/CHECK constraint failed/);
      expect(rawIdentity(database)).toEqual({ device_id: null, initialized: 0 });
    }
  });
});

describe('device identity store', () => {
  it('creates one canonical UUID v4 and returns it to every caller on the same carrier', () => {
    const firstDatabase = memoryDatabase();
    expect(() => loadDeviceId(firstDatabase)).toThrow(/not initialized/);

    const firstBootstrap = bootstrapDeviceIdentity(firstDatabase);
    expect(firstBootstrap).toMatch(UUID_V4_PATTERN);
    expect(rawIdentity(firstDatabase)).toEqual({ device_id: firstBootstrap, initialized: 1 });

    const carrier = firstDatabase.serialize();
    firstDatabase.close();
    databases.splice(databases.indexOf(firstDatabase), 1);
    const restartedDatabase = new Database(carrier);
    configurePersistenceDatabase(restartedDatabase);
    expect(applyMigrations(restartedDatabase)).toBe(3);
    databases.push(restartedDatabase);

    expect(bootstrapDeviceIdentity(restartedDatabase)).toBe(firstBootstrap);
    expect(loadDeviceId(restartedDatabase)).toBe(firstBootstrap);
    expect(loadDeviceId(restartedDatabase)).toBe(firstBootstrap);
  });

  it('refuses a missing singleton row on every bootstrap instead of rotating the ID', () => {
    const database = memoryDatabase();
    bootstrapDeviceIdentity(database);
    database.prepare('DELETE FROM device_identity WHERE identity_slot = 1').run();

    expect(() => bootstrapDeviceIdentity(database)).toThrow(
      /must contain exactly one singleton row, found 0/,
    );
    expect(() => bootstrapDeviceIdentity(database)).toThrow(
      /must contain exactly one singleton row, found 0/,
    );
    expect(database.prepare('SELECT count(*) AS count FROM device_identity').get()).toEqual({
      count: 0,
    });
  });

  it('diagnoses malformed stored values byte-for-byte and never replaces them', () => {
    for (const malformed of [
      '',
      'NONE',
      '00000000-0000-0000-0000-000000000000',
      'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      'aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase(),
      ' aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      null,
    ]) {
      const database = memoryDatabase();
      bootstrapDeviceIdentity(database);
      overwriteIdentity(database, malformed);

      const diagnostic =
        malformed === null
          ? /stored deviceId is null, expected a canonical lowercase UUID v4/
          : new RegExp(
              `stored deviceId is ${JSON.stringify(malformed)}, expected a canonical lowercase UUID v4`,
            );
      expect(() => loadDeviceId(database)).toThrow(diagnostic);
      expect(() => bootstrapDeviceIdentity(database)).toThrow(diagnostic);
      expect(() => bootstrapDeviceIdentity(database)).toThrow(diagnostic);
      expect(rawIdentity(database)).toEqual({ device_id: malformed, initialized: 1 });
    }
  });

  it('invalidates known bindings before removing the assigned identity', () => {
    const database = memoryDatabase();
    const deviceId = bootstrapDeviceIdentity(database);
    database.exec(`CREATE TABLE known_device_binding (
      device_id TEXT NOT NULL PRIMARY KEY
    ) STRICT;`);
    database.prepare('INSERT INTO known_device_binding (device_id) VALUES (?)').run(deviceId);
    database.exec(`CREATE TEMP TRIGGER require_binding_invalidation
      BEFORE UPDATE OF initialized ON device_identity
      WHEN OLD.initialized = 1 AND NEW.initialized = 0
      BEGIN
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM known_device_binding WHERE device_id = OLD.device_id
        ) THEN RAISE(ABORT, 'known bindings remain') END;
      END;`);

    let invalidatedDeviceId: string | undefined;
    resetDeviceIdentity(database, (assignedDeviceId) => {
      invalidatedDeviceId = assignedDeviceId;
      expect(loadDeviceId(database)).toBe(deviceId);
      database
        .prepare('DELETE FROM known_device_binding WHERE device_id = ?')
        .run(assignedDeviceId);
    });

    expect(invalidatedDeviceId).toBe(deviceId);
    expect(database.prepare('SELECT count(*) AS count FROM known_device_binding').get()).toEqual({
      count: 0,
    });
    expect(rawIdentity(database)).toEqual({ device_id: null, initialized: 0 });
    expect(() => loadDeviceId(database)).toThrow(/not initialized/);

    const replacement = bootstrapDeviceIdentity(database);
    expect(replacement).toMatch(UUID_V4_PATTERN);
    expect(replacement).not.toBe(deviceId);
  });

  it('rolls back binding invalidation and preserves the ID when reset fails', () => {
    const database = memoryDatabase();
    const deviceId = bootstrapDeviceIdentity(database);
    database.exec(`CREATE TABLE known_device_binding (
      device_id TEXT NOT NULL PRIMARY KEY
    ) STRICT;`);
    database.prepare('INSERT INTO known_device_binding (device_id) VALUES (?)').run(deviceId);

    expect(() =>
      resetDeviceIdentity(database, (assignedDeviceId) => {
        database
          .prepare('DELETE FROM known_device_binding WHERE device_id = ?')
          .run(assignedDeviceId);
        throw new Error('binding invalidation failed');
      }),
    ).toThrow(/binding invalidation failed/);

    expect(loadDeviceId(database)).toBe(deviceId);
    expect(database.prepare('SELECT device_id FROM known_device_binding').all()).toEqual([
      { device_id: deviceId },
    ]);
  });

  it('rejects asynchronous invalidators and nested writes without changing identity', () => {
    const database = memoryDatabase();
    const deviceId = bootstrapDeviceIdentity(database);
    database.exec(`CREATE TABLE known_device_binding (
      device_id TEXT NOT NULL PRIMARY KEY
    ) STRICT;`);
    database.prepare('INSERT INTO known_device_binding (device_id) VALUES (?)').run(deviceId);
    let asyncCallbackRan = false;
    const asyncInvalidator = async (): Promise<void> => {
      asyncCallbackRan = true;
      await Promise.resolve();
    };

    expect(() => resetDeviceIdentity(database, asyncInvalidator as never)).toThrow(
      /must be synchronous/,
    );
    expect(asyncCallbackRan).toBe(false);
    const promiseInvalidator = (): Promise<void> => {
      database.prepare('DELETE FROM known_device_binding WHERE device_id = ?').run(deviceId);
      return Promise.resolve();
    };
    expect(() => resetDeviceIdentity(database, promiseInvalidator as never)).toThrow(
      /must be synchronous/,
    );
    expect(database.prepare('SELECT device_id FROM known_device_binding').all()).toEqual([
      { device_id: deviceId },
    ]);
    expect(loadDeviceId(database)).toBe(deviceId);

    database
      .transaction(() => {
        expect(() => bootstrapDeviceIdentity(database)).toThrow(/requires a top-level transaction/);
        expect(() => resetDeviceIdentity(database, () => undefined)).toThrow(
          /requires a top-level transaction/,
        );
      })
      .immediate();
    expect(loadDeviceId(database)).toBe(deviceId);
  });
});
