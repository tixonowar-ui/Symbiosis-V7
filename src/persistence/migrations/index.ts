import { createHash } from 'node:crypto';

import type Database from 'better-sqlite3';

import { migration0001 } from './0001-initial.js';
import { migration0002 } from './0002-local-character-checkpoint.js';
import { migration0003 } from './0003-device-identity.js';

interface SchemaObjectRow {
  name: string;
  type: string;
}

interface AppliedMigrationRow {
  version: number;
  name: string;
  checksum_sha256: string;
}

export type Migration = Readonly<{ version: number; name: string; sql: string }>;

const MIGRATIONS: readonly Migration[] = [migration0001, migration0002, migration0003];

const CREATE_MIGRATION_REGISTRY_SQL = `CREATE TABLE schema_migration (
  version INTEGER NOT NULL PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
  checksum_sha256 TEXT NOT NULL
    CHECK (
      length(checksum_sha256) = 64
      AND checksum_sha256 = lower(checksum_sha256)
      AND checksum_sha256 NOT GLOB '*[^0-9a-f]*'
    )
) STRICT;`;

const checksum = (sql: string): string => createHash('sha256').update(sql, 'utf8').digest('hex');

const schemaObjects = (database: Database.Database): SchemaObjectRow[] =>
  database
    .prepare<[], SchemaObjectRow>(
      `SELECT type, name
       FROM sqlite_schema
       WHERE type IN ('table', 'view', 'trigger')
         AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all();

const insertMigration = (database: Database.Database, migration: Migration): void => {
  database.exec(migration.sql);
  database
    .prepare(
      `INSERT INTO schema_migration (version, name, checksum_sha256)
       VALUES (?, ?, ?)`,
    )
    .run(migration.version, migration.name, checksum(migration.sql));
};

const validateRegistry = (
  database: Database.Database,
  migrations: readonly Migration[],
): number => {
  const applied = database
    .prepare<[], AppliedMigrationRow>(
      `SELECT version, name, checksum_sha256
       FROM schema_migration
       ORDER BY version`,
    )
    .all();

  if (applied.length === 0) {
    throw new Error('schema_migration exists but contains no applied migration');
  }
  if (applied.length > migrations.length) {
    throw new Error(
      `database schema version ${applied.at(-1)?.version ?? 'unknown'} is newer than supported version ${migrations.length}`,
    );
  }

  for (const [index, row] of applied.entries()) {
    const expected = migrations[index];
    if (
      expected === undefined ||
      row.version !== expected.version ||
      row.name !== expected.name ||
      row.checksum_sha256 !== checksum(expected.sql)
    ) {
      throw new Error(
        `migration history mismatch at version ${row.version}: expected ${expected?.version ?? index + 1} ${JSON.stringify(expected?.name)}, got ${JSON.stringify(row.name)}`,
      );
    }
  }

  return applied.length;
};

export const applyMigrationSequence = (
  database: Database.Database,
  migrations: readonly Migration[],
): number => {
  if (migrations.length === 0) {
    throw new Error('migration sequence must contain at least one migration');
  }
  for (const [index, migration] of migrations.entries()) {
    if (migration.version !== index + 1) {
      throw new Error(
        `migration registry is not contiguous: expected ${index + 1}, got ${migration.version}`,
      );
    }
  }

  const objects = schemaObjects(database);
  const hasRegistry = objects.some(
    ({ type, name }) => type === 'table' && name === 'schema_migration',
  );

  if (!hasRegistry) {
    if (objects.length > 0) {
      throw new Error(
        `cannot bootstrap migrations over existing schema objects: ${objects.map(({ type, name }) => `${type} ${name}`).join(', ')}`,
      );
    }
  }

  const appliedCount = hasRegistry ? validateRegistry(database, migrations) : 0;
  for (const [index, migration] of migrations.slice(appliedCount).entries()) {
    database
      .transaction(() => {
        if (!hasRegistry && index === 0) {
          database.exec(CREATE_MIGRATION_REGISTRY_SQL);
        }
        insertMigration(database, migration);
      })
      .immediate();
  }
  return migrations.at(-1)?.version ?? 0;
};

export const applyMigrations = (database: Database.Database): number =>
  applyMigrationSequence(database, MIGRATIONS);
