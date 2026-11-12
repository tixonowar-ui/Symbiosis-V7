import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { configurePersistenceDatabase } from '../database.js';
import { applyMigrationSequence } from './index.js';
import { migration0022 } from './0022-custom-monster-v1.js';
import { LEGACY_SCHEMA_21_MIGRATIONS } from '../../../tests/fixtures/legacy-schema-21.js';

const sequence = [...LEGACY_SCHEMA_21_MIGRATIONS, migration0022];
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
    'genuine #257 composed V1 and open skill plan',
    'enemy-composed-v1/schema21-composed-v1.sqlite.gz',
    '3184d3810b723ecea8ac5b152bedfb8fb8cd2ac6904d03c8816a9325ba607b30',
  ],
])(
  '0022 SQL preserves every previous row/JSON/hash from %s through physical reopen',
  (_label, fixture, digest) => {
    const bytes = gunzipSync(readFileSync(join('tests/fixtures', fixture)));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
    const directory = mkdtempSync(join(tmpdir(), 'symbiosis-migration22-'));
    const filename = join(directory, 'old.sqlite');
    writeFileSync(filename, bytes);
    let db = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      // Read the canonical pre-open fixture before any owning configure/migration can write it.
      const original = rows(db);
      db.close();
      db = new Database(filename, { fileMustExist: true });
      configurePersistenceDatabase(db);
      expect(applyMigrationSequence(db, sequence)).toBe(22);
      const migrated = rows(db);
      const beforeRegistry = original['schema_migration'];
      const afterRegistry = migrated['schema_migration'];
      expect(beforeRegistry).toHaveLength(21);
      expect(afterRegistry).toHaveLength(22);
      expect(afterRegistry?.slice(0, 21)).toEqual(beforeRegistry);
      expect(afterRegistry?.[21]).toMatchObject({ version: 22, name: 'custom-monster-v1' });
      delete original['schema_migration'];
      delete migrated['schema_migration'];
      // Long immutable JSON is compared as exact text, never normalized or rehashed by the test.
      expect(JSON.stringify(migrated)).toBe(JSON.stringify(original));
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      db.close();
      db = new Database(filename, { fileMustExist: true });
      configurePersistenceDatabase(db);
      const snapshot = db.serialize();
      expect(applyMigrationSequence(db, sequence)).toBe(22);
      expect(db.serialize().equals(snapshot)).toBe(true);
      const reopened = rows(db);
      delete reopened['schema_migration'];
      expect(JSON.stringify(reopened)).toBe(JSON.stringify(original));
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it('0022 extends only the closed manual monster forms/kind and retains existing enemy table structure', () => {
  const db = new Database(':memory:');
  try {
    configurePersistenceDatabase(db);
    applyMigrationSequence(db, sequence);
    const source = db.prepare<[string], { sql: string }>(
      "SELECT sql FROM sqlite_schema WHERE type='table' AND name=?",
    );
    const cursor = source.get('campaign_creation_cursor')?.sql;
    for (const form of ['ENM-011', 'ENM-012', 'ENM-013', 'ENM-014', 'ENM-015', 'ENM-016'])
      expect(cursor).toContain("'" + form + "'");
    for (const future of ['ENM-017', 'ENM-018', 'ENM-019'])
      expect(cursor).not.toContain("'" + future + "'");
    expect(source.get('campaign_enemy_template')?.sql).toContain(
      "CHECK(kind IN ('SENTIENT','CUSTOM_MONSTER'))",
    );
    expect(source.get('campaign_enemy_version')?.sql).toContain('CHECK(version=1)');
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%_next'").all()).toEqual([]);
  } finally {
    db.close();
  }
});
