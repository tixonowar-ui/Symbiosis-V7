import Database from 'better-sqlite3';
import { LEGACY_SCHEMA_19_MIGRATIONS } from './legacy-schema-19.js';
import { configurePersistenceDatabase } from '../../src/persistence/database.js';
import { applyMigrationSequence } from '../../src/persistence/migrations/index.js';
import { migration0020 } from '../../src/persistence/migrations/0020-enemy-library.js';

export const LEGACY_SCHEMA_20_MIGRATIONS = [...LEGACY_SCHEMA_19_MIGRATIONS, migration0020] as const;
export function openLegacySchema20Database(path = ':memory:') {
  const db = new Database(path);
  try {
    configurePersistenceDatabase(db);
    applyMigrationSequence(db, LEGACY_SCHEMA_20_MIGRATIONS);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
