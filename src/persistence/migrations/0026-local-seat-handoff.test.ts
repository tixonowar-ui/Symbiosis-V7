import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { LEGACY_SCHEMA_21_MIGRATIONS } from '../../../tests/fixtures/legacy-schema-21.js';
import { configurePersistenceDatabase } from '../database.js';
import { loadDeviceId } from '../device-identity.js';
import {
  ordinaryHandoffPresentAtStartup,
  readOrdinarySeatHandoff,
  readOrdinarySeatRoster,
} from '../local-seat-handoff.js';
import { migration0022 } from './0022-custom-monster-v1.js';
import { migration0023 } from './0023-enemy-template-versions.js';
import { migration0024 } from './0024-monster-stat-roll-once.js';
import { migration0025 } from './0025-enemy-art-upload.js';
import { applyMigrationSequence, applyMigrations } from './index.js';

it('adds an empty ordinary handoff journal to populated schema 25 and rolls back its whole migration on failure', () => {
  const db = new Database(
    gunzipSync(readFileSync('tests/fixtures/enemy-custom-v1/schema22-custom-v1.sqlite.gz')),
  );
  try {
    configurePersistenceDatabase(db);
    expect(
      applyMigrationSequence(db, [
        ...LEGACY_SCHEMA_21_MIGRATIONS,
        migration0022,
        migration0023,
        migration0024,
        migration0025,
      ]),
    ).toBe(25);
    expect(ordinaryHandoffPresentAtStartup(db)).toBe(false);
    const versions = db.prepare('SELECT * FROM campaign_enemy_version ORDER BY rowid');
    const originals = versions.all();
    expect(originals.length).toBeGreaterThan(0);
    db.exec(
      "CREATE TRIGGER reject_registry26 BEFORE INSERT ON schema_migration WHEN NEW.version=26 BEGIN SELECT RAISE(ABORT,'REACHED_REGISTRY_26'); END",
    );
    const before = db.serialize();
    expect(() => applyMigrations(db)).toThrow('REACHED_REGISTRY_26');
    expect(db.serialize().equals(before)).toBe(true);
    db.exec('DROP TRIGGER reject_registry26');
    expect(applyMigrations(db)).toBe(26);
    const migrated = db.serialize();
    expect(ordinaryHandoffPresentAtStartup(db)).toBe(false);
    const owner = loadDeviceId(db);
    expect(readOrdinarySeatRoster(db, owner)).toEqual([]);
    expect(readOrdinarySeatHandoff(db, owner)).toEqual({
      revision: 0,
      activeSeatIdOrNull: null,
      rosterOrNull: null,
      pendingOrNull: null,
    });
    expect(versions.all()).toEqual(originals);
    expect(applyMigrations(db)).toBe(26);
    expect(db.serialize().equals(migrated)).toBe(true);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    db.close();
  }
});

it('allows startup before device identity exists and rejects an isolated journal object', () => {
  const db = new Database(':memory:');
  try {
    expect(ordinaryHandoffPresentAtStartup(db)).toBe(false);
    db.exec('CREATE TABLE local_seat_handoff_head(owner_device_id TEXT PRIMARY KEY)');
    expect(() => ordinaryHandoffPresentAtStartup(db)).toThrow();
  } finally {
    db.close();
  }
});
