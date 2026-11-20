import { createHash, randomInt } from 'node:crypto';
import type * as NodeCrypto from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { beforeAll, expect, it, vi } from 'vitest';
import { enemyCompositionReaders as r } from '@shared/enemy-composition-codec.js';
import {
  enemyAuthoringProjectionValue,
  enemyVersionIdentityValue,
} from '@shared/enemy-authoring.js';
import { loadLocalCharacterExportBaseline } from './local-character-export.js';
import { loadNpcAuthoringSourceCatalog } from './npc-catalog.js';
import { loadEnemySourceCatalog } from './enemy-catalog.js';
import { loadEnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';
import {
  createEnemyAuthoringApplication,
  validateEnemyAuthoringSource,
} from './enemy-authoring-application.js';
import { validateEnemyLibrarySource } from './enemy-library-application.js';
import { openPersistenceDatabase } from '../persistence/database.js';
import { readGmRequestReviewSourceWith } from '../persistence/network-device-request.js';
import { readAppliedMigrationVersion } from '../persistence/migrations/index.js';
import { migration0024 } from '../persistence/migrations/0024-monster-stat-roll-once.js';
import { migration0025 } from '../persistence/migrations/0025-enemy-art-upload.js';

vi.mock('node:crypto', async (original) => {
  const actual = await original<typeof NodeCrypto>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});
let baseline: Awaited<ReturnType<typeof loadLocalCharacterExportBaseline>>;
let library: ReturnType<typeof loadEnemySourceCatalog>;
let catalog: ReturnType<typeof loadEnemyAuthoringSourceCatalog>;
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  const common = await loadNpcAuthoringSourceCatalog(process.cwd());
  library = loadEnemySourceCatalog(process.cwd(), baseline);
  catalog = loadEnemyAuthoringSourceCatalog(process.cwd(), common);
});
const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
function rows(db: Database.Database) {
  return Object.fromEntries(
    db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
      )
      .all()
      .map(({ name }) => [
        name,
        db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all(),
      ]),
  );
}
for (const [kind, gzipSha256, inflatedSha256] of [
  [
    'SENTIENT',
    '4ab26fff36c815cae60ac65f94ba1f6aae1a932f99465d1e813f7de79b6bad33',
    '8d066575ad1f20dd55741e514b376e9208a65c7e69272ec224b02c3f08ecae06',
  ],
  [
    'CUSTOM_MONSTER',
    'e4786563f5fbaae747cd25f938c99c8f07643dc0fd62ab16772391b522209fbb',
    'bf668fce4379cd3b941279065dabd000bd07c9ef4634dd235fb77cfa4d49fe93',
  ],
] as const)
  it(`preserves genuine delivered259 ${kind} schema23 V1/V2/open attempt and exact original receipts through25 and physical reopen`, () => {
    const root = join(process.cwd(), 'tests/fixtures/enemy-versioned-v2'),
      metadata = r.record(
        JSON.parse(readFileSync(join(root, 'metadata.json'), 'utf8')),
        '$.metadata',
      );
    expect(metadata['schemaVersion']).toBe(23);
    expect(metadata['producerHead']).toBe('5c875e6108312cbe37356a2894fac5a8feea9a53');
    expect(metadata['deliveredMainEquivalent']).toBe('fe61e291635f30cf0f5437e9692d8f92f896104f');
    expect(metadata['producerTree']).toBe('bfee221e7a2ce1b319bbf9f34a2e9c365eaea5c5');
    const fixtures = r
      .list(metadata['fixtures'], '$.fixtures')
      .map((f) => r.record(f, '$.fixture'));
    expect(fixtures.map((f) => f['kind']).sort()).toEqual(['CUSTOM_MONSTER', 'SENTIENT']);
    const matches = fixtures.filter((f) => f['kind'] === kind);
    expect(matches).toHaveLength(1);
    const f = matches[0];
    if (f === undefined) throw new Error('Missing exact historical kind');
    const gzip = readFileSync(join(root, r.text(f['file'], '$.file'))),
      canonical = gunzipSync(gzip);
    expect(f['gzipSha256']).toBe(gzipSha256);
    expect(f['inflatedPreOpenSha256']).toBe(inflatedSha256);
    expect(hash(gzip)).toBe(gzipSha256);
    expect(hash(canonical)).toBe(inflatedSha256);
    const savedScope = r.record(f['scope'], '$.scope'),
      scope = {
        ownerDeviceId: r.uuid(savedScope['ownerDeviceId'], '$.owner'),
        gmLocalContextId: r.uuid(savedScope['gmLocalContextId'], '$.context'),
        campaignId: r.uuid(savedScope['campaignId'], '$.campaign'),
      };
    const directory = mkdtempSync(join(tmpdir(), 'symbiosis-genuine259-')),
      filename = join(directory, 'historical.sqlite');
    let db: Database.Database | undefined;
    try {
      writeFileSync(filename, canonical);
      const raw = new Database(filename, { readonly: true, fileMustExist: true });
      let before: ReturnType<typeof rows>;
      try {
        expect(readAppliedMigrationVersion(raw)).toBe(23);
        before = rows(raw);
      } finally {
        raw.close();
      }
      expect(before['schema_migration']).toHaveLength(23);
      expect(before['campaign_enemy_version']).toHaveLength(2);
      const expected = {
        ...before,
        campaign_enemy_art_upload: [],
        schema_migration: [
          ...(before['schema_migration'] ?? []),
          {
            version: migration0024.version,
            name: migration0024.name,
            checksum_sha256: hash(migration0024.sql),
          },
          {
            version: migration0025.version,
            name: migration0025.name,
            checksum_sha256: hash(migration0025.sql),
          },
        ],
      };
      vi.mocked(randomInt).mockClear();
      db = openPersistenceDatabase(filename);
      const database = () => {
        if (db === undefined) throw new Error('Historical database is closed');
        return db;
      };
      const readCurrent = (
        observe: Parameters<typeof readGmRequestReviewSourceWith>[3] = () => undefined,
      ) =>
        readGmRequestReviewSourceWith(
          database(),
          scope,
          () => undefined,
          (source, state) => {
            validateEnemyLibrarySource(source, state, library, baseline);
            validateEnemyAuthoringSource(database(), source, state, catalog, baseline);
            return observe(source, state);
          },
        ).source;
      const app = () =>
        createEnemyAuthoringApplication({
          database: database(),
          scope,
          catalog,
          baseline,
          readCurrent,
          validateOwner: () => undefined,
        });
      expect(readAppliedMigrationVersion(database())).toBe(25);
      expect(rows(database())).toEqual(expected);
      const originalResult = r.record(f['originalCommitResult'], '$.originalResult'),
        newResult = r.record(f['newVersionResult'], '$.newResult');
      const identity = enemyVersionIdentityValue(f['currentVersion']);
      expect(identity.kind).toBe(kind);
      expect(identity.version).toBe(2);
      const record = r.record(f['originalV1Record'], '$.oldV1');
      const original = () =>
        database()
          .prepare('SELECT record_json,record_sha256 FROM campaign_enemy_version WHERE version=1')
          .get();
      const pointer = () =>
        database()
          .prepare('SELECT version_id FROM campaign_enemy_current_version WHERE template_id=?')
          .get(identity.templateId);
      expect(original()).toEqual(record);
      expect(pointer()).toEqual({ version_id: identity.versionId });
      const view = structuredClone(readCurrent().viewOrNull);
      expect(view?.formId).toBe('ENM-017');
      expect(view?.enemyAuthoring).toEqual(f['openAttempt']);
      expect(view?.enemyAuthoring?.monsterStatRoll).toBeUndefined();
      const projected = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
      expect(projected.formId).toBe('ENM-017');
      expect(projected.context.attemptOrNull?.kind).toBe(kind);
      expect(projected.versionEditor?.currentVersion).toEqual(identity);
      const replay = () => {
        const first = app().command(f['originalCommitRequest']),
          second = app().command(f['newVersionRequest']);
        expect(first).toEqual({ ...originalResult, replayed: true });
        expect(second).toEqual({ ...newResult, replayed: true });
        expect(Object.hasOwn(first.receipt.result, 'randomStatsReceipt')).toBe(false);
        expect(Object.hasOwn(second.receipt.result, 'randomStatsReceipt')).toBe(false);
        expect(readCurrent().viewOrNull).toEqual(view);
        expect(original()).toEqual(record);
        expect(pointer()).toEqual({ version_id: identity.versionId });
        expect(rows(database())).toEqual(expected);
        expect(database().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(database().pragma('integrity_check', { simple: true })).toBe('ok');
        expect(randomInt).not.toHaveBeenCalled();
      };
      replay();
      const afterRead = database().serialize();
      app().project();
      readCurrent();
      expect(database().serialize()).toEqual(afterRead);
      database().close();
      db = undefined;
      db = openPersistenceDatabase(filename);
      replay();
    } finally {
      if (db?.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
