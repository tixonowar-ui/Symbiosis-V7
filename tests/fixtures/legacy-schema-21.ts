import Database from 'better-sqlite3';
import { LEGACY_SCHEMA_20_MIGRATIONS } from './legacy-schema-20.js';
import { configurePersistenceDatabase } from '../../src/persistence/database.js';
import { applyMigrationSequence } from '../../src/persistence/migrations/index.js';
import { migration0021 } from '../../src/persistence/migrations/0021-sentient-enemy-v1.js';

export const LEGACY_SCHEMA_21_MIGRATIONS = [...LEGACY_SCHEMA_20_MIGRATIONS, migration0021] as const;
export function openLegacySchema21Database(path = ':memory:') {
  const db = new Database(path);
  try {
    configurePersistenceDatabase(db);
    applyMigrationSequence(db, LEGACY_SCHEMA_21_MIGRATIONS);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
