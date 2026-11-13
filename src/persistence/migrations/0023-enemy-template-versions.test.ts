import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { configurePersistenceDatabase } from '../database.js';
import { applyMigrationSequence } from './index.js';
import { migration0022 } from './0022-custom-monster-v1.js';
import { migration0023 } from './0023-enemy-template-versions.js';
import { LEGACY_SCHEMA_21_MIGRATIONS } from '../../../tests/fixtures/legacy-schema-21.js';

const previous = [...LEGACY_SCHEMA_21_MIGRATIONS, migration0022];
const sequence = [...previous, migration0023];
function rows(db: Database.Database) {
  const tables = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
    )
    .all();
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all(),
    ]),
  );
}

it.each([
  [
    'genuine #256 empty V1',
    'enemy-empty-v1/schema21-empty-v1.sqlite.gz',
    '58a390078a12b0ff8d52eae518dc479cda988887d307e736a027fe086b258f4b',
  ],
  [
    'genuine #257 composed V1 and open plan',
    'enemy-composed-v1/schema21-composed-v1.sqlite.gz',
    '3184d3810b723ecea8ac5b152bedfb8fb8cd2ac6904d03c8816a9325ba607b30',
  ],
])(
  '0023 preserves every schema22 row/JSON/hash from %s through disk reopen',
  (_, fixture, digest) => {
    const bytes = gunzipSync(readFileSync(join('tests/fixtures', fixture)));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
    const directory = mkdtempSync(join(tmpdir(), 'symbiosis-migration23-'));
    const filename = join(directory, 'old.sqlite');
    writeFileSync(filename, bytes);
    let db = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      // The canonical producer data is read before any owning configure/open can rewrite it.
      const original = rows(db);
      db.close();
      db = new Database(filename, { fileMustExist: true });
      configurePersistenceDatabase(db);
      expect(applyMigrationSequence(db, previous)).toBe(22);
      const before = rows(db);
      expect(before['schema_migration']).toHaveLength(22);
      const originalWithoutRegistry = { ...original };
      const beforeWithoutRegistry = { ...before };
      delete originalWithoutRegistry['schema_migration'];
      delete beforeWithoutRegistry['schema_migration'];
      expect(JSON.stringify(beforeWithoutRegistry)).toBe(JSON.stringify(originalWithoutRegistry));
      expect(applyMigrationSequence(db, sequence)).toBe(23);
      const after = rows(db);
      expect(after['schema_migration']).toHaveLength(23);
      expect(after['schema_migration']?.slice(0, 22)).toEqual(before['schema_migration']);
      expect(after['schema_migration']?.[22]).toMatchObject({
        version: 23,
        name: 'enemy-template-versions',
      });
      delete after['schema_migration'];
      expect(JSON.stringify(after)).toBe(JSON.stringify(originalWithoutRegistry));
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      db.close();
      db = new Database(filename, { fileMustExist: true });
      configurePersistenceDatabase(db);
      const snapshot = db.serialize();
      expect(applyMigrationSequence(db, sequence)).toBe(23);
      expect(db.serialize().equals(snapshot)).toBe(true);
      const reopened = rows(db);
      delete reopened['schema_migration'];
      expect(JSON.stringify(reopened)).toBe(JSON.stringify(originalWithoutRegistry));
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it('0023 permits ordered positive version numbers with one row per template/number and keeps future forms closed', () => {
  const bytes = gunzipSync(
    readFileSync('tests/fixtures/enemy-composed-v1/schema21-composed-v1.sqlite.gz'),
  );
  const db = new Database(bytes);
  try {
    configurePersistenceDatabase(db);
    applyMigrationSequence(db, sequence);
    const cursor = db
      .prepare<[], { sql: string }>(
        "SELECT sql FROM sqlite_schema WHERE name='campaign_creation_cursor'",
      )
      .get()?.sql;
    expect(cursor).toContain("'ENM-017'");
    for (const future of ['ENM-018', 'ENM-019']) expect(cursor).not.toContain("'" + future + "'");
    const original = db.prepare('SELECT * FROM campaign_enemy_version WHERE version=1').all();
    expect(original).toHaveLength(1);
    // Deliberately schema-only: the copied JSON is not an owning N+1 command or provenance proof.
    const insert = db.prepare(`INSERT INTO campaign_enemy_version
      SELECT ?,template_id,campaign_id,?,record_json,record_sha256
      FROM campaign_enemy_version WHERE version=1`);
    insert.run('00000000-0000-4000-8000-000000000259', 2);
    expect(() => insert.run('00000000-0000-4000-8000-000000000260', 2)).toThrow(
      'UNIQUE constraint failed',
    );
    expect(() => insert.run('00000000-0000-4000-8000-000000000261', 0)).toThrow(
      'CHECK constraint failed',
    );
    expect(db.prepare('SELECT version FROM campaign_enemy_version ORDER BY version').all()).toEqual(
      [{ version: 1 }, { version: 2 }],
    );
    expect(db.prepare('SELECT * FROM campaign_enemy_version WHERE version=1').all()).toEqual(
      original,
    );
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%_next'").all()).toEqual([]);
  } finally {
    db.close();
  }
});
