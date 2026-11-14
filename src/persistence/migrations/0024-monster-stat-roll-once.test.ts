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
import { migration0024 } from './0024-monster-stat-roll-once.js';
import { LEGACY_SCHEMA_21_MIGRATIONS } from '../../../tests/fixtures/legacy-schema-21.js';

const previous = [...LEGACY_SCHEMA_21_MIGRATIONS, migration0022, migration0023];
const sequence = [...previous, migration0024];
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
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
function withoutRegistry(value: ReturnType<typeof rows>) {
  const result = { ...value };
  delete result['schema_migration'];
  return result;
}

it.each([
  [
    'genuine256',
    'enemy-empty-v1/schema21-empty-v1.sqlite.gz',
    '58a390078a12b0ff8d52eae518dc479cda988887d307e736a027fe086b258f4b',
  ],
  [
    'genuine257',
    'enemy-composed-v1/schema21-composed-v1.sqlite.gz',
    '3184d3810b723ecea8ac5b152bedfb8fb8cd2ac6904d03c8816a9325ba607b30',
  ],
  [
    'genuine258',
    'enemy-custom-v1/schema22-custom-v1.sqlite.gz',
    '61f6e340d3236059f8dd3488e91e1f97c0aaf6eab2fb8874d85a25dea8d9fe19',
  ],
])(
  '0024 preserves all original %s rows/JSON/hashes through actual23,24 and physical reopen',
  (_, fixture, expectedHash) => {
    const originalBytes = gunzipSync(readFileSync(join('tests/fixtures', fixture)));
    expect(sha(originalBytes)).toBe(expectedHash);
    const directory = mkdtempSync(join(tmpdir(), 'symbiosis-migration24-'));
    const filename = join(directory, 'old.sqlite');
    writeFileSync(filename, originalBytes);
    let db = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      const original = rows(db);
      db.close();
      db = new Database(filename, { fileMustExist: true });
      configurePersistenceDatabase(db);
      expect(applyMigrationSequence(db, previous)).toBe(23);
      const before = rows(db);
      expect(before['schema_migration']).toHaveLength(23);
      expect(JSON.stringify(withoutRegistry(before))).toBe(
        JSON.stringify(withoutRegistry(original)),
      );
      const ledgerSql = db
        .prepare("SELECT sql FROM sqlite_schema WHERE name='gm_request_queue_event'")
        .get();
      expect(applyMigrationSequence(db, sequence)).toBe(24);
      const after = rows(db);
      expect(after['schema_migration']).toHaveLength(24);
      expect(after['schema_migration']?.slice(0, 23)).toEqual(before['schema_migration']);
      expect(after['schema_migration']?.[23]).toEqual({
        version: 24,
        name: migration0024.name,
        checksum_sha256: sha(migration0024.sql),
      });
      expect(JSON.stringify(withoutRegistry(after))).toBe(
        JSON.stringify(withoutRegistry(original)),
      );
      expect(
        db.prepare("SELECT sql FROM sqlite_schema WHERE name='gm_request_queue_event'").get(),
      ).toEqual(ledgerSql);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%_next'").all()).toEqual(
        [],
      );
      db.close();
      db = new Database(filename, { fileMustExist: true });
      configurePersistenceDatabase(db);
      const bytes = db.serialize();
      expect(applyMigrationSequence(db, sequence)).toBe(24);
      expect(db.serialize().equals(bytes)).toBe(true);
      expect(JSON.stringify(withoutRegistry(rows(db)))).toBe(
        JSON.stringify(withoutRegistry(original)),
      );
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it('0024 opens only the two child cursor CHECK values without changing the accepted ledger/version schema', () => {
  const db = new Database(
    gunzipSync(readFileSync('tests/fixtures/enemy-custom-v1/schema22-custom-v1.sqlite.gz')),
  );
  try {
    configurePersistenceDatabase(db);
    applyMigrationSequence(db, previous);
    const schema = db
      .prepare<[], { name: string; sql: string }>(
        "SELECT name,sql FROM sqlite_schema WHERE type='table' AND name!='campaign_creation_cursor' ORDER BY name",
      )
      .all();
    const cursor = db
      .prepare<[], { context_id: string }>(
        'SELECT context_id FROM campaign_creation_cursor LIMIT 1',
      )
      .get();
    if (cursor === undefined) throw new Error('Genuine fixture cursor is missing');
    for (const form of ['ENM-018', 'ENM-019'])
      expect(() =>
        db
          .prepare('UPDATE campaign_creation_cursor SET form_id=? WHERE context_id=?')
          .run(form, cursor.context_id),
      ).toThrow('CHECK constraint failed');
    applyMigrationSequence(db, sequence);
    expect(
      db
        .prepare<[], { name: string; sql: string }>(
          "SELECT name,sql FROM sqlite_schema WHERE type='table' AND name!='campaign_creation_cursor' ORDER BY name",
        )
        .all(),
    ).toEqual(schema);
    const before = rows(db);
    for (const form of ['ENM-018', 'ENM-019']) {
      // Schema-only witness: this intentionally does not pretend the old row JSON is an owning NAV.
      const marker = 'MIGRATION24_CURSOR_REACHED_' + form;
      expect(() =>
        db.transaction(() => {
          expect(
            db
              .prepare('UPDATE campaign_creation_cursor SET form_id=? WHERE context_id=?')
              .run(form, cursor.context_id).changes,
          ).toBe(1);
          throw new Error(marker);
        })(),
      ).toThrow(marker);
      expect(rows(db)).toEqual(before);
    }
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db.close();
  }
});

it('0024 rolls back its reached final registry insertion, cursor DDL and every prior row atomically', () => {
  const db = new Database(
    gunzipSync(readFileSync('tests/fixtures/enemy-custom-v1/schema22-custom-v1.sqlite.gz')),
  );
  try {
    configurePersistenceDatabase(db);
    applyMigrationSequence(db, previous);
    db.exec(
      "CREATE TRIGGER reject_registry24 BEFORE INSERT ON schema_migration WHEN NEW.version=24 BEGIN SELECT RAISE(ABORT,'MIGRATION24_FINAL_REGISTRY_REACHED'); END",
    );
    // Local byte-oracle precondition only, not production migration compaction.
    db.exec('VACUUM');
    expect(db.prepare('PRAGMA freelist_count').get()).toEqual({ freelist_count: 0 });
    const beforeRows = rows(db),
      beforeSchema = db.prepare('SELECT * FROM sqlite_schema ORDER BY type,name').all(),
      beforeBytes = db.serialize();
    expect(() => applyMigrationSequence(db, sequence)).toThrow(
      'MIGRATION24_FINAL_REGISTRY_REACHED',
    );
    expect(rows(db)).toEqual(beforeRows);
    expect(db.prepare('SELECT * FROM sqlite_schema ORDER BY type,name').all()).toEqual(
      beforeSchema,
    );
    expect(db.serialize().equals(beforeBytes)).toBe(true);
    expect(db.inTransaction).toBe(false);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.exec('DROP TRIGGER reject_registry24');
    expect(applyMigrationSequence(db, sequence)).toBe(24);
  } finally {
    db.close();
  }
});
