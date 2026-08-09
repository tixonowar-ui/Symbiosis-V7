import Database from 'better-sqlite3';

import { applyMigrations } from './migrations/index.js';

const pragmaString = (value: unknown, name: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`PRAGMA ${name} returned ${JSON.stringify(value)}, expected a string`);
  }
  return value;
};

const pragmaNumber = (value: unknown, name: string): number => {
  if (typeof value !== 'number') {
    throw new Error(`PRAGMA ${name} returned ${JSON.stringify(value)}, expected a number`);
  }
  return value;
};

export const configurePersistenceDatabase = (database: Database.Database): void => {
  const journalMode = pragmaString(
    database.pragma('journal_mode = WAL', { simple: true }),
    'journal_mode',
  );
  const expectedJournalMode = database.memory ? 'memory' : 'wal';
  if (journalMode !== expectedJournalMode) {
    throw new Error(
      `PRAGMA journal_mode is ${JSON.stringify(journalMode)}, expected ${JSON.stringify(expectedJournalMode)}`,
    );
  }

  database.pragma('foreign_keys = ON');
  if (pragmaNumber(database.pragma('foreign_keys', { simple: true }), 'foreign_keys') !== 1) {
    throw new Error('PRAGMA foreign_keys did not remain enabled');
  }

  database.pragma('synchronous = FULL');
  if (pragmaNumber(database.pragma('synchronous', { simple: true }), 'synchronous') !== 2) {
    throw new Error('PRAGMA synchronous did not remain FULL');
  }
};

export const openPersistenceDatabase = (filename: string): Database.Database => {
  const database = new Database(filename);
  try {
    configurePersistenceDatabase(database);
    applyMigrations(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
};
