import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import type { EnemyWorkflowRequest } from '@shared/enemy-authoring.js';
import type { CommandReceipt } from '@shared/wire-protocol.js';
import { customMonsterProjectionValue } from '@shared/custom-monster-presentation.js';
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

it.each([
  {
    folder: 'enemy-composed-v1',
    kind: 'SENTIENT',
    file: 'schema21-composed-v1.sqlite.gz',
    schema: 21,
    form: 'ENM-008',
    gzip: 'b4c726ec2fdae7a6be4c5d25013acf2206fdb5def0d2092ea235eddabaed4e52',
    raw: '3184d3810b723ecea8ac5b152bedfb8fb8cd2ac6904d03c8816a9325ba607b30',
    head: 'c6820e9b258f7a743403ddba0ed55dcd23691036',
    tree: 'ab05f2fc5e408ac7cf47dc36acc665a7e423d852',
  },
  {
    folder: 'enemy-custom-v1',
    kind: 'CUSTOM_MONSTER',
    file: 'schema22-custom-v1.sqlite.gz',
    schema: 22,
    form: 'ENM-013',
    gzip: '50678d9abf89b1a3c04199d53b9066ae0dfc937b52a3c53f0dc158933d9f17d2',
    raw: '61f6e340d3236059f8dd3488e91e1f97c0aaf6eab2fb8874d85a25dea8d9fe19',
    head: '4bfe9ed4c7ad9a021b3b39cc7daa3ba0180c8ebd',
    tree: 'b1920a574092fa6d18852d36b6d0a4fbd8541da6',
  },
] as const)(
  'physically preserves genuine old $kind V1, open attempt and original receipt under B17 without a configuration upgrade',
  async (fixture) => {
    const directory = mkdtempSync(join(tmpdir(), 'symbiosis-b16-b17-enemy-'));
    let db: ReturnType<typeof openPersistenceDatabase> | undefined;
    try {
      const folder = join(process.cwd(), 'tests/fixtures', fixture.folder);
      const metadata = JSON.parse(readFileSync(join(folder, 'metadata.json'), 'utf8')) as {
        producerHead?: string;
        sourceCommit?: string;
        producerTree?: string;
        sourceTree?: string;
        scope: GmRequestReviewScope;
        commitRequest: EnemyWorkflowRequest;
        commitResult: { replayed: boolean; receipt: CommandReceipt };
        savedVersionRecordSha256: string;
        openAttemptId?: string;
        openPlanId?: string;
        openAttempt?: { attemptId: string };
      };
      expect(metadata.producerHead ?? metadata.sourceCommit).toBe(fixture.head);
      expect(metadata.producerTree ?? metadata.sourceTree).toBe(fixture.tree);
      const gzip = readFileSync(join(folder, fixture.file)),
        seed = gunzipSync(gzip);
      const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
      expect(hash(gzip)).toBe(fixture.gzip);
      expect(hash(seed)).toBe(fixture.raw);
      const filename = join(directory, 'historical.sqlite');
      writeFileSync(filename, seed);
      const raw = new Database(filename, { readonly: true, fileMustExist: true });
      let before: ReturnType<typeof rows>;
      try {
        before = rows(raw);
      } finally {
        raw.close();
      }
      expect(before.find((table) => table.name === 'schema_migration')?.rows).toHaveLength(
        fixture.schema,
      );
      const expected = before.map((table) =>
        table.name !== 'schema_migration'
          ? table
          : {
              ...table,
              rows: [
                ...table.rows,
                ...[migration0022, migration0023]
                  .filter((migration) => migration.version > fixture.schema)
                  .map((migration) => ({
                    version: migration.version,
                    name: migration.name,
                    checksum_sha256: createHash('sha256').update(migration.sql).digest('hex'),
                  })),
              ],
            },
      );
      db = openPersistenceDatabase(filename);
      const database = () => {
        if (db === undefined) throw Error('Historical database closed');
        return db;
      };
      const baseline = await loadLocalCharacterExportBaseline(process.cwd());
      expect(baseline.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B17);
      const common = await loadNpcAuthoringSourceCatalog(process.cwd());
      const catalog = loadEnemyAuthoringSourceCatalog(process.cwd(), common),
        library = loadEnemySourceCatalog(process.cwd(), baseline);
      let storedBaselines: readonly string[] = [];
      // Real source/store/physical SQLite proof; this fixture bypasses password KDF and does not claim LAN/WS coverage.
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
      expect(rows(database())).toEqual(expected);
      expect(database().memory).toBe(false);
      const project = () => {
        const payload = app().project().base.roleFilteredPayload;
        return fixture.kind === 'SENTIENT'
          ? enemyAuthoringProjectionValue(payload)
          : customMonsterProjectionValue(payload);
      };
      const view = project();
      expect(view.formId).toBe(fixture.form);
      expect(storedBaselines).toEqual([BASELINE_FIXTURE_IDS.B16]);
      const attempt = view.context.attemptOrNull;
      expect(attempt?.kind).toBe(fixture.kind);
      expect(attempt?.attemptId).toBe(metadata.openAttemptId ?? metadata.openAttempt?.attemptId);
      if (attempt?.kind === 'SENTIENT')
        expect(attempt.skillPlanState?.planOrNull?.planId).toBe(metadata.openPlanId);
      else expect(attempt).toEqual(metadata.openAttempt);
      expect(Object.hasOwn(view, 'versionConfigurationSummaryOrNull')).toBe(false);
      const saved = () =>
        database()
          .prepare('SELECT record_sha256 FROM campaign_enemy_version WHERE campaign_id=?')
          .get(metadata.scope.campaignId);
      expect(saved()).toEqual({ record_sha256: metadata.savedVersionRecordSha256 });
      expect(app().command(metadata.commitRequest)).toEqual({
        ...metadata.commitResult,
        replayed: true,
      });
      expect(rows(database())).toEqual(expected);
      database().close();
      db = openPersistenceDatabase(filename);
      const bytes = database().serialize();
      expect(project()).toEqual(view);
      expect(app().command(metadata.commitRequest)).toEqual({
        ...metadata.commitResult,
        replayed: true,
      });
      expect(rows(database())).toEqual(expected);
      expect(database().serialize().equals(bytes)).toBe(true);
      expect(saved()).toEqual({ record_sha256: metadata.savedVersionRecordSha256 });
      expect(database().pragma('foreign_key_check')).toEqual([]);
      expect(database().pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      if (db?.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
