import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  asSeedRows,
  buildSeed,
  deriveTableNames,
  EXPECTED_SQLITE_VERSION,
  EXPECTED_SQLITE_VERSION_NUMBER,
  tableNameForSpecPath,
} from './seed.js';
import { SEED_DIR, SPEC_DIR } from './lib/paths.js';

const SEED_FILE = join(SEED_DIR, 'seed.sqlite');
const EXPECTED_META_PATHS = [
  'atlas/meta.json',
  'bestiary/meta.json',
  'character/meta.json',
  'effects/meta.json',
  'items/meta.json',
  'local-character-portraits/meta.json',
  'qna/meta.json',
  'rules/meta.json',
  'sentient/meta.json',
] as const;
const EXPECTED_INDEX_PATHS = [
  'atlas/forms-by-id.json',
  'atlas/renderer/forms-by-id.json',
  'atlas/renderer/primary-actions-by-form-id.json',
  'atlas/renderer/transitions-by-form-and-trigger.json',
  'qna/questions-by-code.json',
] as const;

type JsonObject = Record<string, unknown>;

interface SourceArray {
  readonly path: string;
  readonly rows: readonly JsonObject[];
  readonly table: string;
}

interface SourceMetadata {
  readonly path: string;
  readonly payload: JsonObject;
}

interface SourceCatalogue {
  readonly arrays: readonly SourceArray[];
  readonly files: number;
  readonly indexes: readonly string[];
  readonly metadata: readonly SourceMetadata[];
  readonly rows: number;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const listJson = (directory: string, prefix = ''): { file: string; path: string }[] => {
  const files: { file: string; path: string }[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    compareText(left.name, right.name),
  )) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJson(file, path));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push({ file, path });
    }
  }
  return files;
};

const expectedTableName = (path: string): string =>
  path.slice(0, -'.json'.length).replaceAll(/[/-]/gu, '_');

const sourceCatalogue = (): SourceCatalogue => {
  const files = listJson(SPEC_DIR);
  const metadataPaths = new Set<string>(EXPECTED_META_PATHS);
  const indexPaths = new Set<string>(EXPECTED_INDEX_PATHS);
  const arrays: SourceArray[] = [];
  const metadata: SourceMetadata[] = [];
  const indexes: string[] = [];

  for (const { file, path } of files) {
    const value = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (metadataPaths.has(path)) {
      if (!isObject(value)) throw new Error(`${path} is not an object`);
      metadata.push({ path, payload: value });
    } else if (indexPaths.has(path)) {
      if (!isObject(value)) throw new Error(`${path} is not an object`);
      indexes.push(path);
    } else {
      if (!Array.isArray(value)) throw new Error(`${path} is not an array`);
      const rows = value.map((row, index) => {
        if (!isObject(row)) throw new Error(`${path}[${String(index)}] is not an object`);
        return row;
      });
      arrays.push({ path, rows, table: expectedTableName(path) });
    }
  }

  return {
    arrays,
    files: files.length,
    indexes,
    metadata,
    rows: arrays.reduce((total, array) => total + array.rows.length, 0),
  };
};

const requireSeed = (): string => {
  if (!existsSync(SEED_FILE)) {
    throw new Error(`generated seed is missing at ${SEED_FILE}; run npm run import before tests`);
  }
  return SEED_FILE;
};

const hash = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

const sidecars = (file: string): string[] =>
  [`${file}-journal`, `${file}-shm`, `${file}-wal`].filter(existsSync);

describe('generated SQLite seed', () => {
  it('stores every source array and section passport without duplicating JSON indexes', () => {
    const source = sourceCatalogue();
    expect(source.files).toBe(128);
    expect(source.arrays).toHaveLength(114);
    expect(source.rows).toBe(20_279);
    expect(source.arrays.map(({ path }) => path)).toContain('atlas/global-contracts.json');
    expect(source.metadata.map(({ path }) => path)).toEqual(EXPECTED_META_PATHS);
    expect(source.indexes).toEqual(EXPECTED_INDEX_PATHS);

    const database = new Database(requireSeed(), { fileMustExist: true, readonly: true });
    try {
      const tables = database
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_schema
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        )
        .all()
        .map(({ name }) => name);
      const expectedTables = [...source.arrays.map(({ table }) => table), 'spec_meta'].sort(
        compareText,
      );
      expect(tables).toEqual(expectedTables);
      expect(tables).not.toContain('atlas_forms');
      expect(tables).not.toContain('atlas_forms_by_id');
      expect(tables).not.toContain('atlas_renderer_forms_by_id');
      expect(tables).not.toContain('atlas_renderer_primary_actions_by_form_id');
      expect(tables).not.toContain('atlas_renderer_transitions_by_form_and_trigger');
      expect(tables).not.toContain('qna_questions_by_code');
      expect(tables).toContain('atlas_workflow_commands');

      let actualRows = 0;
      for (const input of source.arrays) {
        const schema = database
          .prepare<[string], { sql: string }>(
            `SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?`,
          )
          .get(input.table)?.sql;
        if (
          schema === undefined ||
          !schema.includes('row_index INTEGER NOT NULL PRIMARY KEY') ||
          !schema.includes(
            "CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object')",
          ) ||
          !schema.endsWith('STRICT')
        ) {
          throw new Error(`${input.table} does not have the required STRICT JSON schema`);
        }

        let rowIndex = 0;
        const rows = database
          .prepare<[], { payload_json: string; row_index: number }>(
            `SELECT row_index, payload_json FROM "${input.table}" ORDER BY row_index`,
          )
          .iterate();
        for (const row of rows) {
          const expectedPayload = JSON.stringify(input.rows[rowIndex]);
          if (row.row_index !== rowIndex || row.payload_json !== expectedPayload) {
            throw new Error(`${input.path}[${String(rowIndex)}] differs from the seed row`);
          }
          rowIndex += 1;
        }
        if (rowIndex !== input.rows.length) {
          throw new Error(
            `${input.table} contains ${String(rowIndex)} rows, expected ${String(input.rows.length)}`,
          );
        }
        actualRows += rowIndex;
      }
      expect(actualRows).toBe(20_279);

      const actualMetadata = database
        .prepare<[], { payload_json: string; spec_path: string }>(
          'SELECT spec_path, payload_json FROM spec_meta ORDER BY spec_path',
        )
        .all();
      expect(actualMetadata).toEqual(
        source.metadata.map(({ path, payload }) => ({
          payload_json: JSON.stringify(payload),
          spec_path: path,
        })),
      );
    } finally {
      database.close();
    }
    expect(sidecars(SEED_FILE)).toEqual([]);
  }, 60_000);

  it('rebuilds byte for byte with the pinned SQLite library', () => {
    const productionFile = requireSeed();
    const database = new Database(productionFile, { fileMustExist: true, readonly: true });
    try {
      const version = database
        .prepare<[], { version: string }>('SELECT sqlite_version() AS version')
        .get()?.version;
      if (version !== EXPECTED_SQLITE_VERSION) {
        throw new Error(
          `SQLite version is ${JSON.stringify(version)}, expected ${JSON.stringify(EXPECTED_SQLITE_VERSION)}; rebuild the seed after updating better-sqlite3 because header bytes 96-99 change`,
        );
      }
    } finally {
      database.close();
    }

    const header = readFileSync(productionFile).subarray(0, 100);
    expect(header.subarray(0, 16).toString('binary')).toBe('SQLite format 3\0');
    expect(header.readUInt32BE(96)).toBe(EXPECTED_SQLITE_VERSION_NUMBER);

    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'symbiosis-seed-'));
    temporaryDirectories.push(temporaryDirectory);
    const rebuiltFile = join(temporaryDirectory, 'seed.sqlite');
    buildSeed(rebuiltFile);

    expect(statSync(rebuiltFile).size).toBe(statSync(productionFile).size);
    expect(hash(rebuiltFile)).toBe(hash(productionFile));
    expect(sidecars(productionFile)).toEqual([]);
    expect(sidecars(rebuiltFile)).toEqual([]);

    const writable = new Database(rebuiltFile);
    try {
      const insert = writable.prepare(
        'INSERT INTO rules_rules (row_index, payload_json) VALUES (999999, ?)',
      );
      expect(() => insert.run('{')).toThrow(/CHECK constraint failed/u);
      expect(() => insert.run('[]')).toThrow(/CHECK constraint failed/u);
    } finally {
      writable.close();
    }
  }, 60_000);
});

describe('seed input guards', () => {
  it('derives stable table names from nested paths', () => {
    expect(tableNameForSpecPath('rules/rules.json')).toBe('rules_rules');
    expect(tableNameForSpecPath('character/xp-runtime/event-points.json')).toBe(
      'character_xp_runtime_event_points',
    );
  });

  it('rejects table-name collisions instead of inventing a suffix', () => {
    expect(() => deriveTableNames(['a-b/c.json', 'a/b-c.json'])).toThrow(/table name collision/u);
  });

  it('rejects every non-object array row with its source position', () => {
    expect(() => asSeedRows([{}], 'valid.json')).not.toThrow();
    expect(() => asSeedRows([null], 'invalid.json')).toThrow(
      /invalid\.json\[0\] must be a JSON object/u,
    );
  });
});
