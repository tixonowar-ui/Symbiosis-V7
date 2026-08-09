import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, parse } from 'node:path';

import { expectCount, fail, ImportError } from './lib/fail.js';
import { SEED_DIR, SPEC_DIR } from './lib/paths.js';

const WHERE = 'seed';
const META_TABLE = 'spec_meta';
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'binary');

/** ADR 0019 pins the byte-reproducibility contract to better-sqlite3 13.0.3. */
export const EXPECTED_SQLITE_VERSION = '3.53.4';
export const EXPECTED_SQLITE_VERSION_NUMBER = 3_053_004;

export const SPEC_META_PATHS = [
  'atlas/meta.json',
  'bestiary/meta.json',
  'character/meta.json',
  'effects/meta.json',
  'items/meta.json',
  'qna/meta.json',
  'rules/meta.json',
  'sentient/meta.json',
] as const;

/**
 * These objects are lookup copies of the source arrays, not additional data.
 * A future query path may add real SQLite indexes; storing them as tables here
 * would create a third copy of the same 376 forms and 444 questions.
 */
export const SKIPPED_INDEX_PATHS = [
  'atlas/forms-by-id.json',
  'qna/questions-by-code.json',
] as const;

/** Measured from generated/spec for issue #6 and recorded by ADR 0019. */
const EXPECTED = {
  files: 122,
  arrayFiles: 112,
  rows: 20_535,
  metadataFiles: 8,
  skippedIndexes: 2,
} as const;

type JsonObject = Record<string, unknown>;

interface ArraySpec {
  readonly path: string;
  readonly rows: readonly JsonObject[];
  readonly table: string;
}

interface MetadataSpec {
  readonly path: string;
  readonly payload: JsonObject;
}

interface SeedCatalogue {
  readonly arrays: readonly ArraySpec[];
  readonly metadata: readonly MetadataSpec[];
  readonly rows: number;
}

export interface SeedBuild {
  readonly arrayTables: number;
  readonly bytesWritten: number;
  readonly file: string;
  readonly metadataRows: number;
  readonly rows: number;
  readonly skippedIndexes: number;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : JSON.stringify(error);

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asObject = (value: unknown, specPath: string): JsonObject => {
  if (!isObject(value)) {
    fail(WHERE, `${specPath} must contain a JSON object`);
  }
  return value;
};

export const asSeedRows = (value: unknown, specPath: string): JsonObject[] => {
  if (!Array.isArray(value)) {
    fail(WHERE, `${specPath} must contain a JSON array`);
  }
  return value.map((row, rowIndex) => {
    if (!isObject(row)) {
      fail(WHERE, `${specPath}[${String(rowIndex)}] must be a JSON object`);
    }
    return row;
  });
};

export const tableNameForSpecPath = (specPath: string): string => {
  if (!specPath.endsWith('.json') || specPath.includes('\\')) {
    fail(WHERE, `cannot derive a table name from ${JSON.stringify(specPath)}`);
  }
  const table = specPath.slice(0, -'.json'.length).replaceAll(/[/-]/gu, '_');
  if (!/^[a-z][a-z0-9_]*$/u.test(table)) {
    fail(
      WHERE,
      `table name ${JSON.stringify(table)} derived from ${JSON.stringify(specPath)} is not safe`,
    );
  }
  return table;
};

export const deriveTableNames = (specPaths: readonly string[]): Map<string, string> => {
  const sourcesByTable = new Map<string, string>();
  const tablesBySource = new Map<string, string>();
  for (const specPath of [...specPaths].sort(compareText)) {
    const table = tableNameForSpecPath(specPath);
    if (table === META_TABLE) {
      fail(WHERE, `${JSON.stringify(specPath)} collides with reserved table ${META_TABLE}`);
    }
    const previous = sourcesByTable.get(table);
    if (previous !== undefined) {
      fail(
        WHERE,
        `table name collision: ${JSON.stringify(previous)} and ${JSON.stringify(specPath)} both map to ${JSON.stringify(table)}`,
      );
    }
    sourcesByTable.set(table, specPath);
    tablesBySource.set(specPath, table);
  }
  return tablesBySource;
};

const listSpecFiles = (specDir: string): { file: string; path: string }[] => {
  const files: { file: string; path: string }[] = [];
  const visit = (directory: string, prefix: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
        compareText(left.name, right.name),
      );
    } catch (error) {
      fail(WHERE, `cannot read ${JSON.stringify(directory)}: ${errorMessage(error)}`);
    }
    for (const entry of entries) {
      const specPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(file, specPath);
      } else if (entry.isFile() && specPath === '.gitkeep') {
        // The placeholder keeps generated/spec present before its first import;
        // it is pipeline scaffolding, not one of the 122 JSON inputs.
        continue;
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push({ file, path: specPath });
      } else {
        fail(WHERE, `unexpected entry in generated/spec: ${JSON.stringify(specPath)}`);
      }
    }
  };
  visit(specDir, '');
  return files;
};

const readJson = (file: string, specPath: string): unknown => {
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch (error) {
    fail(WHERE, `cannot read ${JSON.stringify(specPath)}: ${errorMessage(error)}`);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    fail(WHERE, `cannot parse ${JSON.stringify(specPath)}: ${errorMessage(error)}`);
  }
};

const loadCatalogue = (specDir: string): SeedCatalogue => {
  const files = listSpecFiles(specDir);
  const metadataPaths = new Set<string>(SPEC_META_PATHS);
  const skippedPaths = new Set<string>(SKIPPED_INDEX_PATHS);
  const arrayInputs: { path: string; rows: JsonObject[] }[] = [];
  const metadata: MetadataSpec[] = [];
  let skippedIndexes = 0;

  for (const { file, path } of files) {
    const value = readJson(file, path);
    if (metadataPaths.has(path)) {
      metadata.push({ path, payload: asObject(value, path) });
    } else if (skippedPaths.has(path)) {
      asObject(value, path);
      skippedIndexes += 1;
    } else if (Array.isArray(value)) {
      arrayInputs.push({ path, rows: asSeedRows(value, path) });
    } else if (isObject(value)) {
      fail(
        WHERE,
        `unexpected object file ${JSON.stringify(path)}; only section meta and indexes are known`,
      );
    } else {
      fail(WHERE, `${path} must contain a JSON array or object`);
    }
  }

  const rows = arrayInputs.reduce((total, input) => total + input.rows.length, 0);
  expectCount(WHERE, 'JSON files', files.length, EXPECTED.files);
  expectCount(WHERE, 'array files', arrayInputs.length, EXPECTED.arrayFiles);
  expectCount(WHERE, 'array rows', rows, EXPECTED.rows);
  expectCount(WHERE, 'metadata files', metadata.length, EXPECTED.metadataFiles);
  expectCount(WHERE, 'skipped index files', skippedIndexes, EXPECTED.skippedIndexes);

  const tableNames = deriveTableNames(arrayInputs.map(({ path }) => path));
  const arrays = arrayInputs.map(({ path, rows: inputRows }) => ({
    path,
    rows: inputRows,
    table: tableNames.get(path)!,
  }));
  return { arrays, metadata, rows };
};

const quoteIdentifier = (identifier: string): string => `"${identifier}"`;

const arrayTableSql = (table: string): string => `CREATE TABLE ${quoteIdentifier(table)} (
  row_index INTEGER NOT NULL PRIMARY KEY,
  payload_json TEXT NOT NULL
    CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object')
) STRICT`;

const metadataTableSql = `CREATE TABLE ${META_TABLE} (
  spec_path TEXT NOT NULL PRIMARY KEY,
  payload_json TEXT NOT NULL
    CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object')
) STRICT`;

const jsonText = (value: JsonObject, location: string): string => {
  const text = JSON.stringify(value);
  if (text === undefined) {
    fail(WHERE, `${location} could not be serialized as JSON`);
  }
  return text;
};

const configureDatabase = (database: Database.Database): void => {
  const version = database
    .prepare<[], { version: string }>('SELECT sqlite_version() AS version')
    .get()?.version;
  if (version !== EXPECTED_SQLITE_VERSION) {
    fail(
      WHERE,
      `SQLite version is ${JSON.stringify(version)}, expected ${JSON.stringify(EXPECTED_SQLITE_VERSION)}; update the pinned version contract and rebuild seed because the file header bytes will change`,
    );
  }
  const journalMode = database.pragma('journal_mode = DELETE', { simple: true });
  if (journalMode !== 'delete') {
    fail(WHERE, `journal_mode is ${JSON.stringify(journalMode)}, expected "delete"`);
  }
};

const writeCatalogue = (database: Database.Database, catalogue: SeedCatalogue): void => {
  const write = database.transaction(() => {
    database.exec(metadataTableSql);
    const insertMetadata = database.prepare<[string, string]>(
      `INSERT INTO ${META_TABLE} (spec_path, payload_json) VALUES (?, ?)`,
    );
    for (const { path, payload } of catalogue.metadata) {
      insertMetadata.run(path, jsonText(payload, path));
    }

    for (const { path, rows, table } of catalogue.arrays) {
      database.exec(arrayTableSql(table));
      const insert = database.prepare<[number, string]>(
        `INSERT INTO ${quoteIdentifier(table)} (row_index, payload_json) VALUES (?, ?)`,
      );
      for (const [rowIndex, row] of rows.entries()) {
        insert.run(rowIndex, jsonText(row, `${path}[${String(rowIndex)}]`));
      }
    }
  });
  write.exclusive();
};

const databaseFamily = (file: string): string[] => [
  file,
  `${file}-journal`,
  `${file}-shm`,
  `${file}-wal`,
];

const removeDatabaseFamily = (file: string): void => {
  for (const path of databaseFamily(file)) {
    rmSync(path, { force: true });
  }
};

const assertNoSidecars = (file: string): void => {
  const sidecars = databaseFamily(file).slice(1).filter(existsSync);
  if (sidecars.length > 0) {
    fail(WHERE, `unexpected SQLite sidecar files: ${sidecars.join(', ')}`);
  }
};

const assertHeaderVersion = (file: string): void => {
  const header = readFileSync(file).subarray(0, 100);
  if (header.length < 100 || !header.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) {
    fail(WHERE, `${JSON.stringify(file)} does not have a SQLite format 3 header`);
  }
  const version = header.readUInt32BE(96);
  if (version !== EXPECTED_SQLITE_VERSION_NUMBER) {
    fail(
      WHERE,
      `SQLite header version is ${String(version)}, expected ${String(EXPECTED_SQLITE_VERSION_NUMBER)}; rebuild seed with SQLite ${EXPECTED_SQLITE_VERSION}`,
    );
  }
};

const temporaryDatabasePath = (outputFile: string): string => {
  const output = parse(outputFile);
  return join(output.dir, `${output.name}.tmp.sqlite`);
};

export const buildSeed = (outputFile: string, specDir = SPEC_DIR): SeedBuild => {
  const catalogue = loadCatalogue(specDir);
  const temporaryFile = temporaryDatabasePath(outputFile);
  mkdirSync(dirname(outputFile), { recursive: true });
  removeDatabaseFamily(temporaryFile);

  let database: Database.Database | undefined;
  try {
    database = new Database(temporaryFile);
    configureDatabase(database);
    writeCatalogue(database, catalogue);
    database.close();
    database = undefined;

    assertNoSidecars(temporaryFile);
    assertHeaderVersion(temporaryFile);
    assertNoSidecars(outputFile);
    // Keeping the last-good destination until this call means a transient
    // Windows lock can fail the import without first destroying usable output.
    renameSync(temporaryFile, outputFile);
    assertNoSidecars(outputFile);

    return {
      arrayTables: catalogue.arrays.length,
      bytesWritten: statSync(outputFile).size,
      file: outputFile,
      metadataRows: catalogue.metadata.length,
      rows: catalogue.rows,
      skippedIndexes: SKIPPED_INDEX_PATHS.length,
    };
  } catch (error) {
    if (database?.open === true) {
      database.close();
    }
    if (error instanceof ImportError) {
      throw error;
    }
    fail(WHERE, `could not build ${JSON.stringify(outputFile)}: ${errorMessage(error)}`);
  } finally {
    removeDatabaseFamily(temporaryFile);
  }
};

export const importSeed = (): SeedBuild => buildSeed(join(SEED_DIR, 'seed.sqlite'));
