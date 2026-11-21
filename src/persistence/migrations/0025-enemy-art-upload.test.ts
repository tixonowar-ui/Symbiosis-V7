import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { LEGACY_SCHEMA_21_MIGRATIONS } from '../../../tests/fixtures/legacy-schema-21.js';
import { configurePersistenceDatabase } from '../database.js';
import { applyMigrationSequence } from './index.js';
import { migration0025 } from './0025-enemy-art-upload.js';
import { migration0022 } from './0022-custom-monster-v1.js';
import { migration0023 } from './0023-enemy-template-versions.js';
import { migration0024 } from './0024-monster-stat-roll-once.js';

it('0025 preserves the existing enemy version and receipts and rolls back the upload table on a registry fault', () => {
  const directory = mkdtempSync(join(tmpdir(), 'symbiosis-migration25-'));
  const filename = join(directory, 'campaign.sqlite');
  writeFileSync(
    filename,
    gunzipSync(readFileSync('tests/fixtures/enemy-custom-v1/schema22-custom-v1.sqlite.gz')),
  );
  const db = new Database(filename, { fileMustExist: true });
  try {
    configurePersistenceDatabase(db);
    expect(
      applyMigrationSequence(db, [
        ...LEGACY_SCHEMA_21_MIGRATIONS,
        migration0022,
        migration0023,
        migration0024,
      ]),
    ).toBe(24);
    const versions = db.prepare('SELECT * FROM campaign_enemy_version ORDER BY rowid');
    const events = db.prepare('SELECT * FROM gm_request_queue_event ORDER BY rowid');
    const beforeVersions = versions.all(),
      beforeEvents = events.all();
    expect(beforeVersions.length).toBeGreaterThan(0);
    db.exec(
      "CREATE TRIGGER reject_registry25 BEFORE INSERT ON schema_migration WHEN NEW.version=25 BEGIN SELECT RAISE(ABORT,'REACHED_REGISTRY_25'); END",
    );
    const through25 = [
      ...LEGACY_SCHEMA_21_MIGRATIONS,
      migration0022,
      migration0023,
      migration0024,
      migration0025,
    ];
    expect(() => applyMigrationSequence(db, through25)).toThrow('REACHED_REGISTRY_25');
    expect(
      db.prepare("SELECT 1 FROM sqlite_schema WHERE name='campaign_enemy_art_upload'").get(),
    ).toBeUndefined();
    db.exec('DROP TRIGGER reject_registry25');
    expect(applyMigrationSequence(db, through25)).toBe(25);
    expect(db.prepare('SELECT * FROM campaign_enemy_art_upload').all()).toEqual([]);
    expect(versions.all()).toEqual(beforeVersions);
    expect(events.all()).toEqual(beforeEvents);
    expect(applyMigrationSequence(db, through25)).toBe(25);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
