import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { hasStoredIdentity } from './identity-existence.js';

function database() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE example (id TEXT PRIMARY KEY, other_id TEXT)');
  db.prepare('INSERT INTO example VALUES (?,?)').run('a', 'b');
  return db;
}

it('reuses compilation but observes every binding, write and both integer modes', () => {
  const db = database();
  const prepare = vi.spyOn(db, 'prepare');
  try {
    for (let index = 0; index < 1_000; index++)
      expect(hasStoredIdentity(db, 'example', 'id', index % 2 ? 'a' : 'missing')).toBe(
        Boolean(index % 2),
      );
    expect(prepare.mock.calls.length).toBeLessThan(10);
    for (const mode of [true, false, true, false]) {
      db.defaultSafeIntegers(mode);
      expect(db.prepare('SELECT 1 AS n').get()).toEqual({ n: mode ? 1n : 1 });
      expect(hasStoredIdentity(db, 'example', 'id', 'a')).toBe(true);
      expect(hasStoredIdentity(db, 'example', 'id', 'b')).toBe(false);
      expect(hasStoredIdentity(db, 'example', 'other_id', 'b')).toBe(true);
    }
    db.exec("DELETE FROM example WHERE id='a'");
    expect(hasStoredIdentity(db, 'example', 'id', 'a')).toBe(false);
    db.exec("INSERT INTO example VALUES ('a','changed')");
    expect(hasStoredIdentity(db, 'example', 'id', 'a')).toBe(true);
    expect(hasStoredIdentity(db, 'example', 'other_id', 'b')).toBe(false);
    expect(hasStoredIdentity(db, 'example', 'other_id', 'changed')).toBe(true);
  } finally {
    prepare.mockRestore();
    db.close();
  }
});

it('keeps rollback, isolated connections, restart and schema failures visible', () => {
  const first = database();
  const second = new Database(':memory:');
  second.exec('CREATE TABLE example (id TEXT PRIMARY KEY, other_id TEXT)');
  let restarted: Database.Database | undefined;
  try {
    expect(hasStoredIdentity(first, 'example', 'id', 'a')).toBe(true);
    expect(hasStoredIdentity(second, 'example', 'id', 'a')).toBe(false);
    expect(() =>
      first.transaction(() => {
        first.exec("DELETE FROM example WHERE id='a'");
        expect(hasStoredIdentity(first, 'example', 'id', 'a')).toBe(false);
        throw new Error('rollback');
      })(),
    ).toThrow('rollback');
    expect(hasStoredIdentity(first, 'example', 'id', 'a')).toBe(true);
    restarted = new Database(first.serialize());
    first.close();
    expect(() => hasStoredIdentity(first, 'example', 'id', 'a')).toThrow();
    expect(hasStoredIdentity(restarted, 'example', 'id', 'a')).toBe(true);
    restarted.exec('ALTER TABLE example ADD COLUMN added TEXT');
    expect(hasStoredIdentity(restarted, 'example', 'id', 'a')).toBe(true);
    restarted.exec('DROP TABLE example');
    expect(() => hasStoredIdentity(restarted!, 'example', 'id', 'a')).toThrow('no such table');
    restarted.exec('CREATE TABLE example (wrong_id TEXT)');
    expect(() => hasStoredIdentity(restarted!, 'example', 'id', 'a')).toThrow('no such column');
  } finally {
    if (first.open) first.close();
    second.close();
    restarted?.close();
  }
});

it('observes a replaced preparation boundary instead of reusing an older query', () => {
  const db = database();
  try {
    hasStoredIdentity(db, 'example', 'id', 'a');
    const prepare = vi.spyOn(db, 'prepare').mockImplementation(() => {
      throw new Error('prepare boundary fault');
    });
    try {
      expect(() => hasStoredIdentity(db, 'example', 'id', 'a')).toThrow('prepare boundary fault');
    } finally {
      prepare.mockRestore();
    }
    expect(hasStoredIdentity(db, 'example', 'id', 'a')).toBe(true);
  } finally {
    db.close();
  }
});
