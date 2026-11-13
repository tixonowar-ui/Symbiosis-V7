import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import type { EnemyWorkflowRequest } from '@shared/enemy-authoring.js';
import type { CommandReceipt } from '@shared/wire-protocol.js';
import { enemyAuthoringProjectionValue } from '@shared/enemy-authoring.js';
import { openPersistenceDatabase } from '../persistence/database.js';
import { migration0022 } from '../persistence/migrations/0022-custom-monster-v1.js';
import { migration0023 } from '../persistence/migrations/0023-enemy-template-versions.js';
import type { GmRequestReviewScope } from '../persistence/campaign-creation.js';
import { readGmRequestReviewSourceWith } from '../persistence/network-device-request.js';
import { loadLocalCharacterExportBaseline } from './local-character-export.js';
import { loadNpcAuthoringSourceCatalog } from './npc-catalog.js';
import { loadEnemySourceCatalog } from './enemy-catalog.js';
import { loadEnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';
import {
  createEnemyAuthoringApplication,
  validateEnemyAuthoringSource,
} from './enemy-authoring-application.js';
import { validateEnemyLibrarySource } from './enemy-library-application.js';
import { BASELINE_FIXTURE_IDS } from '../../tests/fixtures/baseline-lineage.js';

function rows(db: Database.Database) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return tables.map(({ name }) => {
    const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    const columns = (
      db.prepare('PRAGMA table_info(' + quote(name) + ')').all() as { name: string }[]
    ).map(({ name }) => quote(name));
    return {
      name,
      rows: db.prepare('SELECT * FROM ' + quote(name) + ' ORDER BY ' + columns.join(',')).all(),
    };
  });
}
it('physically opens genuine B15 schema21 empty V1 and open attempt under B17 and replays the original receipt without rewriting any old row', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'symbiosis-b15-b17-empty-v1-'));
  let db: ReturnType<typeof openPersistenceDatabase> | undefined;
  try {
    const fixture = join(process.cwd(), 'tests/fixtures/enemy-empty-v1');
    const metadata = JSON.parse(readFileSync(join(fixture, 'metadata.json'), 'utf8')) as {
      producerHead: string;
      producerTree: string;
      databaseSha256: string;
      scope: GmRequestReviewScope;
      originalCommitRequest: EnemyWorkflowRequest;
      originalCommitResult: { replayed: boolean; receipt: CommandReceipt };
    };
    const compressed = readFileSync(join(fixture, 'schema21-empty-v1.sqlite.gz'));
    expect(createHash('sha256').update(compressed).digest('hex')).toBe(
      '3ae110cac4aa6e89ae7b2d7d9027ed42a3df3e6558decc85cebca9871e8e9d41',
    );
    expect(metadata.producerHead).toBe('11fde3e35fe27de8ca718de57e5c6682c7e2cf86');
    expect(metadata.producerTree).toBe('0f01cd9a17a47a6643eae5a386df70de40086cad');
    const seed = gunzipSync(compressed),
      filename = join(directory, 'historical.sqlite');
    expect(createHash('sha256').update(seed).digest('hex')).toBe(
      '58a390078a12b0ff8d52eae518dc479cda988887d307e736a027fe086b258f4b',
    );
    writeFileSync(filename, seed);
    const raw = new Database(filename, { readonly: true, fileMustExist: true });
    let before: ReturnType<typeof rows>;
    try {
      before = rows(raw);
    } finally {
      raw.close();
    }
    expect(before.find((table) => table.name === 'schema_migration')?.rows).toHaveLength(21);
    const expectedRows = before.map((table) =>
      table.name !== 'schema_migration'
        ? table
        : {
            ...table,
            rows: [
              ...table.rows,
              {
                version: migration0022.version,
                name: migration0022.name,
                checksum_sha256: createHash('sha256').update(migration0022.sql).digest('hex'),
              },
              {
                version: migration0023.version,
                name: migration0023.name,
                checksum_sha256: createHash('sha256').update(migration0023.sql).digest('hex'),
              },
            ],
          },
    );
    db = openPersistenceDatabase(filename);
    const database = () => {
      if (db === undefined) throw Error('Historical database is closed');
      return db;
    };
    const baseline = await loadLocalCharacterExportBaseline(process.cwd());
    expect(baseline.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B17);
    const common = await loadNpcAuthoringSourceCatalog(process.cwd());
    const catalog = loadEnemyAuthoringSourceCatalog(process.cwd(), common),
      library = loadEnemySourceCatalog(process.cwd(), baseline);
    let storedBaselines: readonly string[] = [];
    // The source/proof/SQLite boundary is real. Password KDF is bypassed by this unit fixture, not claimed as network authority evidence.
    const readCurrent = (
      observe: Parameters<typeof readGmRequestReviewSourceWith>[3] = () => undefined,
    ) =>
      readGmRequestReviewSourceWith(
        database(),
        metadata.scope,
        () => undefined,
        (source, state) => {
          validateEnemyLibrarySource(source, state, library, baseline);
          storedBaselines = validateEnemyAuthoringSource(
            database(),
            source,
            state,
            catalog,
            baseline,
          ).map((version) => version.sourceBaselineVersion);
          return observe(source, state);
        },
      ).source;
    const app = () =>
      createEnemyAuthoringApplication({
        database: database(),
        scope: metadata.scope,
        catalog,
        baseline,
        validateOwner: () => undefined,
        readCurrent,
      });
    expect(rows(database())).toEqual(expectedRows); // Only the explicit0022/0023 registry appends differ from the raw pre-open snapshot.
    expect(database().memory).toBe(false);
    expect(
      database().prepare('SELECT MAX(version) version,COUNT(*) count FROM schema_migration').get(),
    ).toEqual({ version: 23, count: 23 });
    expect(database().pragma('user_version', { simple: true })).toBe(0);
    const view = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
    expect(storedBaselines).toEqual([BASELINE_FIXTURE_IDS.B15]);
    expect(view.formId).toBe('ENM-009');
    expect(view.context.attemptOrNull?.compositionOrNull).toEqual({
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
    });
    expect(Object.hasOwn(view.context.attemptOrNull!, 'initialSkillPlan')).toBe(false);
    expect(Object.hasOwn(view.context.attemptOrNull!, 'compositionAcquisitions')).toBe(false);
    expect(app().command(metadata.originalCommitRequest)).toEqual({
      ...metadata.originalCommitResult,
      replayed: true,
    });
    expect(rows(database())).toEqual(expectedRows);
    database().close();
    db = openPersistenceDatabase(filename);
    const bytes = database().serialize();
    expect(app().project().base.roleFilteredPayload).toEqual(view);
    expect(app().command(metadata.originalCommitRequest)).toEqual({
      ...metadata.originalCommitResult,
      replayed: true,
    });
    expect(rows(database())).toEqual(expectedRows);
    expect(database().serialize().equals(bytes)).toBe(true);
    expect(database().pragma('foreign_key_check')).toEqual([]);
  } finally {
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
