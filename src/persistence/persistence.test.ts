import { migration0015, NPC_TABLES } from './migrations/0015-persistent-npc.js';
import { migration0016 } from './migrations/0016-npc-wound-identities.js';
import { migration0017 } from './migrations/0017-npc-linked-sets.js';
import { migration0018 } from './migrations/0018-npc-custom-profile-identities.js';
import { networkApplicationStorage } from './network-local-application.js';
import { bootstrapDeviceIdentity } from './device-identity.js';
import { readDeviceInstallationIdentity } from './network-installation-identity.js';
import { readActiveLocalNetworkTab } from './network-local-tab.js';
import { retirePostSaveRestoreCursor } from './local-character-post-save.js';
import { migration0002 } from './migrations/0002-local-character-checkpoint.js';
import { migration0003 } from './migrations/0003-device-identity.js';
import { migration0004 } from './migrations/0004-skill-presentation.js';
import { migration0005 } from './migrations/0005-symbiont-presentation.js';
import { migration0006 } from './migrations/0006-local-character-post-save.js';
import { migration0007 } from './migrations/0007-campaign-creation.js';
import { migration0008 } from './migrations/0008-network-installation-identity.js';
import { migration0009 } from './migrations/0009-device-admission.js';
import {
  migration0010,
  NETWORK_APPLICATION_TABLES,
} from './migrations/0010-network-application.js';
import {
  migration0011,
  DEVICE_REQUEST_REVIEW_TABLES,
} from './migrations/0011-device-request-review.js';
import { migration0012, CAMPAIGN_ADMISSION_TABLES } from './migrations/0012-campaign-admission.js';
import { migration0013, CAMPAIGN_LOBBY_TABLES } from './migrations/0013-campaign-lobby.js';
import { migration0014, CAMPAIGN_LIFECYCLE_TABLES } from './migrations/0014-campaign-lifecycle.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openPersistenceDatabase } from './database.js';
import { migration0001, sqlStringLiteral, V1_LIFECYCLE_STATES } from './migrations/0001-initial.js';
import {
  applyMigrations,
  applyMigrationSequence,
  readAppliedMigrationVersion,
} from './migrations/index.js';
import {
  advanceRevisions,
  commitCampaignCheckpoint,
  loadCampaignCheckpoint,
  readRevisions,
} from './store.js';

const lifecyclesJson = JSON.parse(
  readFileSync(new URL('../../generated/spec/atlas/lifecycles.json', import.meta.url), 'utf8'),
) as unknown;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const artifactStates = (entity: string): string[] => {
  if (!Array.isArray(lifecyclesJson)) {
    throw new Error('atlas lifecycles must be an array');
  }
  const lifecycle = (lifecyclesJson as unknown[]).find(
    (value) => isRecord(value) && value['entity'] === entity,
  );
  if (!isRecord(lifecycle)) {
    throw new Error(`atlas lifecycle ${JSON.stringify(entity)} not found`);
  }
  const states = lifecycle['states'];
  if (!Array.isArray(states) || !states.every((state) => typeof state === 'string')) {
    throw new Error(`atlas lifecycle ${JSON.stringify(entity)} has invalid states`);
  }
  return states;
};

const databases: Database.Database[] = [];
const memoryDatabase = (): Database.Database => {
  const database = openPersistenceDatabase(':memory:');
  databases.push(database);
  return database;
};

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

const insertCampaign = (
  database: Database.Database,
  campaignId: string,
  state = 'DRAFT',
  payloadJson = '{}',
): void => {
  database
    .prepare(
      `INSERT INTO campaign (campaign_id, lifecycle_state, payload_json)
       VALUES (?, ?, ?)`,
    )
    .run(campaignId, state, payloadJson);
};

const insertCopy = (
  database: Database.Database,
  campaignCharacterId: string,
  campaignId: string,
  sourceUuid: string,
  state = 'CANDIDATE',
  payloadJson = '{}',
): void => {
  database
    .prepare(
      `INSERT INTO campaign_character_copy (
         campaign_character_id, campaign_id, source_uuid, lifecycle_state, payload_json
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(campaignCharacterId, campaignId, sourceUuid, state, payloadJson);
};

const impact = (
  stateChanged: boolean,
  projectionChanged: boolean,
  actorVisibilityChanged: boolean,
) => ({
  stateChanged,
  projectionChanged,
  actorVisibilityChanged,
});
const revisions = (
  stateRevision: number,
  projectionRevision: number,
  actorVisibilityRevision: number,
) => ({ stateRevision, projectionRevision, actorVisibilityRevision });
const revisionNames = ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const;

describe('persistence schema', () => {
  it('migrates an empty database to the current version and reapplies as a no-op', () => {
    const database = memoryDatabase();
    const tables = database
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all()
      .map(({ name }) => name);
    expect(tables).toEqual([
      'campaign',
      'campaign_admission_batch',
      'campaign_admission_checkpoint_event',
      'campaign_admission_controller',
      'campaign_admission_copy',
      'campaign_admission_event',
      'campaign_admission_gm_decision',
      'campaign_admission_group',
      'campaign_admission_head',
      'campaign_admission_identity',
      'campaign_admission_inventory',
      'campaign_admission_player_decision',
      'campaign_character_copy',
      'campaign_checkpoint',
      'campaign_creation_command',
      'campaign_creation_cursor',
      'campaign_disconnect_retry',
      'campaign_draft',
      'campaign_draft_cancel',
      'campaign_draft_update',
      'campaign_lifecycle_event',
      'campaign_lifecycle_head',
      'campaign_lobby_event',
      'campaign_lobby_head',
      'campaign_peace_scene',
      'campaign_private_owner',
      'device_identity',
      'device_installation_identity',
      'gm_admission_view',
      'gm_admission_view_event',
      'gm_request_queue_event',
      'gm_request_queue_view',
      'hosted_device_request',
      'hosted_device_request_decision',
      'hosted_device_request_lane_binding',
      'hosted_network_command',
      'hosted_network_peer',
      'hosted_technical_session',
      'local_admission_event',
      'local_admission_publication',
      'local_campaign_connection_event',
      'local_campaign_connection_head',
      'local_character',
      'local_character_checkpoint',
      'local_character_metadata_revision',
      'local_character_owner',
      'local_character_post_save_command',
      'local_character_post_save_cursor',
      'local_character_post_save_head',
      'local_character_skill_presentation',
      'local_character_symbiont_presentation',
      'local_character_write_intent',
      'local_gm_active_context',
      'local_gm_context',
      'local_gm_profile',
      'local_network_active_tab',
      'local_network_application',
      'local_network_application_event',
      'local_network_cancel_settlement',
      'local_network_host_pin',
      'local_network_lane_binding',
      'local_network_outbox',
      'local_network_request_current',
      'local_network_tab',
      'local_network_tab_close',
      'local_network_tab_entry',
      'npc_art',
      'npc_attempt_event',
      'npc_attempt_head',
      'npc_child_identity',
      'npc_current_head',
      'npc_identity_reservation',
      'npc_library_checkpoint',
      'npc_operation',
      'npc_version',
      'schema_migration',
    ]);
    for (const table of ['local_character', 'campaign', 'campaign_checkpoint']) {
      const columns = database
        .prepare<[string], { name: string }>('SELECT name FROM pragma_table_info(?) ORDER BY cid')
        .all(table)
        .map(({ name }) => name);
      expect(columns).toEqual(expect.arrayContaining([...revisionNames]));
    }
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.pragma('synchronous', { simple: true })).toBe(2);
    expect(database.pragma('journal_mode', { simple: true })).toBe('memory');

    insertCampaign(database, 'preserved');
    expect(applyMigrations(database)).toBe(19);
    expect(
      database.prepare('SELECT payload_json FROM campaign WHERE campaign_id = ?').get('preserved'),
    ).toEqual({ payload_json: '{}' });
    expect(database.prepare('SELECT count(*) AS count FROM schema_migration').get()).toEqual({
      count: 19,
    });

    database
      .prepare('UPDATE schema_migration SET checksum_sha256 = ? WHERE version = 1')
      .run('0'.repeat(64));
    expect(() => applyMigrations(database)).toThrow(/migration history mismatch/);
  });

  it('applies every migration while bootstrapping an empty database', () => {
    const database = new Database(':memory:');
    databases.push(database);
    const probe = {
      version: 2,
      name: 'probe',
      sql: 'CREATE TABLE probe_table (id INTEGER) STRICT;',
    } as const;

    expect(applyMigrationSequence(database, [migration0001, probe])).toBe(2);
    expect(
      database.prepare('SELECT version, name FROM schema_migration ORDER BY version').all(),
    ).toEqual([
      { version: 1, name: 'initial' },
      { version: 2, name: 'probe' },
    ]);
    expect(database.prepare('SELECT * FROM probe_table').all()).toEqual([]);
  });

  it('rolls back the registry and schema when the first migration fails', () => {
    const database = new Database(':memory:');
    databases.push(database);
    const failing = {
      version: 1,
      name: 'failing',
      sql: 'CREATE TABLE partial_table (id INTEGER) STRICT; THIS IS NOT SQL;',
    } as const;

    expect(() => applyMigrationSequence(database, [failing])).toThrow(/near "THIS"/);
    expect(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
        .all(),
    ).toEqual([]);
  });

  it('freezes artifact lifecycle states and rejects every unknown state', () => {
    const database = memoryDatabase();
    expect(sqlStringLiteral("STATE_'_1")).toBe("'STATE_''_1'");
    expect(() => sqlStringLiteral('STATE\0')).toThrow(/contains NUL/);
    expect([...V1_LIFECYCLE_STATES.localCharacter]).toEqual(artifactStates('localCharacter'));
    expect([...V1_LIFECYCLE_STATES.campaignCharacterCopy]).toEqual(
      artifactStates('campaignCharacterCopy'),
    );
    expect([...V1_LIFECYCLE_STATES.campaign]).toEqual(artifactStates('campaign'));

    for (const [index, state] of artifactStates('localCharacter').entries()) {
      database
        .prepare(
          'INSERT INTO local_character (local_character_id, lifecycle_state, payload_json) VALUES (?, ?, ?)',
        )
        .run(`local-${index}`, state, '{}');
    }
    for (const [index, state] of artifactStates('campaign').entries()) {
      insertCampaign(database, `campaign-${index}`, state);
    }
    insertCampaign(database, 'copy-owner');
    for (const [index, state] of artifactStates('campaignCharacterCopy').entries()) {
      insertCopy(database, `copy-${index}`, 'copy-owner', `source-${index}`, state);
    }

    const unknown = 'NOT_IN_LIFECYCLES';
    expect(Object.values(V1_LIFECYCLE_STATES).flat()).not.toContain(unknown);
    expect(() => insertCampaign(database, 'invalid-campaign', unknown)).toThrow(
      /CHECK constraint failed/,
    );
    expect(() =>
      database
        .prepare(
          'INSERT INTO local_character (local_character_id, lifecycle_state, payload_json) VALUES (?, ?, ?)',
        )
        .run('invalid-local', unknown, '{}'),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      insertCopy(database, 'invalid-copy', 'copy-owner', 'invalid-source', unknown),
    ).toThrow(/CHECK constraint failed/);
    expect(() => insertCampaign(database, 'non-object', 'DRAFT', '[]')).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('allows an empty campaign and one independent copy per source and campaign', () => {
    const database = memoryDatabase();
    insertCampaign(database, 'campaign-a');
    insertCampaign(database, 'campaign-b');
    expect(database.prepare('SELECT count(*) AS count FROM campaign_character_copy').get()).toEqual(
      { count: 0 },
    );
    insertCopy(database, 'copy-a', 'campaign-a', 'source');
    expect(() => insertCopy(database, 'copy-a-duplicate', 'campaign-a', 'source')).toThrow(
      /UNIQUE constraint failed/,
    );
    insertCopy(database, 'copy-b', 'campaign-b', 'source');
    database
      .prepare('UPDATE campaign_character_copy SET payload_json=? WHERE campaign_character_id=?')
      .run('{"independent":true}', 'copy-a');
    expect(
      database
        .prepare('SELECT payload_json FROM campaign_character_copy ORDER BY campaign_id')
        .all(),
    ).toEqual([{ payload_json: '{"independent":true}' }, { payload_json: '{}' }]);
    expect(() => insertCopy(database, 'orphan', 'missing-campaign', 'source')).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });
});

describe('revisions and checkpoints', () => {
  it('advances only the revision dimensions declared by the ADR', () => {
    const database = memoryDatabase();
    database
      .prepare(
        'INSERT INTO local_character (local_character_id, lifecycle_state, payload_json) VALUES (?, ?, ?)',
      )
      .run('local', 'DRAFT', '{}');
    insertCampaign(database, 'campaign');

    expect(
      Object.keys(readRevisions(database, { entity: 'campaign', entityId: 'campaign' })),
    ).toEqual([...revisionNames]);

    expect(
      advanceRevisions(
        database,
        { entity: 'localCharacter', entityId: 'local' },
        impact(true, false, false),
      ),
    ).toEqual(revisions(1, 0, 0));
    expect(
      advanceRevisions(
        database,
        { entity: 'campaign', entityId: 'campaign' },
        impact(false, true, false),
      ),
    ).toEqual(revisions(0, 1, 0));
    const campaignScope = { entity: 'campaign', entityId: 'campaign' } as const;
    expect(advanceRevisions(database, campaignScope, impact(false, false, false))).toEqual(
      revisions(0, 1, 0),
    );
    expect(advanceRevisions(database, campaignScope, impact(false, true, true))).toEqual(
      revisions(0, 2, 1),
    );
    expect(() => advanceRevisions(database, campaignScope, impact(false, false, true))).toThrow(
      /cannot advance without projectionRevision/,
    );
    expect(() =>
      advanceRevisions(database, campaignScope, { stateChanged: true } as never),
    ).toThrow(/must contain exactly/);
    expect(() =>
      advanceRevisions(database, campaignScope, {
        stateChanged: false,
        projectionChanged: false,
        actorVisibilityChanged: false,
        extra: false,
      } as never),
    ).toThrow(/must contain exactly/);
    expect(advanceRevisions(database, campaignScope, impact(true, true, true))).toEqual(
      revisions(1, 3, 2),
    );
  });

  it('commits a complete checkpoint or rolls back every partial write', async () => {
    const database = memoryDatabase();
    insertCampaign(database, 'campaign');
    insertCopy(database, 'copy', 'campaign', 'source');
    const initial = commitCampaignCheckpoint(database, 'campaign', () => 'initial');
    expect(initial.result).toBe('initial');
    expect(commitCampaignCheckpoint(database, 'campaign', () => undefined).checkpoint).toEqual(
      initial.checkpoint,
    );
    const asyncWrite = async (): Promise<void> => {
      await Promise.resolve();
      database
        .prepare('UPDATE campaign SET payload_json=? WHERE campaign_id=?')
        .run('{"async":true}', 'campaign');
    };
    expect(() => commitCampaignCheckpoint(database, 'campaign', asyncWrite as never)).toThrow(
      /must be synchronous/,
    );
    await Promise.resolve();
    expect(database.prepare('SELECT payload_json FROM campaign').get()).toEqual({
      payload_json: '{}',
    });

    const committed = commitCampaignCheckpoint(database, 'campaign', () => {
      database
        .prepare('UPDATE campaign_character_copy SET payload_json=? WHERE campaign_character_id=?')
        .run('{"fixture":1}', 'copy');
      advanceRevisions(
        database,
        { entity: 'campaign', entityId: 'campaign' },
        impact(true, true, false),
      );
    }).checkpoint;
    expect(loadCampaignCheckpoint(database, 'campaign')).toEqual(committed);

    database.exec(`CREATE TEMP TRIGGER interrupt_checkpoint
      BEFORE UPDATE ON campaign_checkpoint
      BEGIN SELECT RAISE(ABORT, 'interrupted checkpoint'); END;`);
    expect(() =>
      commitCampaignCheckpoint(database, 'campaign', () => {
        database
          .prepare(
            'UPDATE campaign_character_copy SET payload_json=? WHERE campaign_character_id=?',
          )
          .run('{"fixture":2}', 'copy');
        advanceRevisions(
          database,
          { entity: 'campaign', entityId: 'campaign' },
          impact(true, false, false),
        );
      }),
    ).toThrow(/interrupted checkpoint/);
    database.exec('DROP TRIGGER interrupt_checkpoint');

    expect(
      database
        .prepare('SELECT payload_json FROM campaign_character_copy WHERE campaign_character_id = ?')
        .get('copy'),
    ).toEqual({ payload_json: '{"fixture":1}' });
    expect(loadCampaignCheckpoint(database, 'campaign')).toEqual(committed);

    database
      .prepare('UPDATE campaign_character_copy SET payload_json=? WHERE campaign_character_id=?')
      .run('{"fixture":"tampered"}', 'copy');
    expect(() =>
      commitCampaignCheckpoint(database, 'campaign', () => {
        throw new Error('stale checkpoint callback unexpectedly ran');
      }),
    ).toThrow(/checkpoint is already stale/);
    expect(() => loadCampaignCheckpoint(database, 'campaign')).toThrow(
      /checkpoint does not match current state/,
    );
  });
});

const legacyMigrations14 = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
  migration0013,
  migration0014,
] as const;
describe('forward NPC wound identity migration', () => {
  it('preserves populated schema 15 children and self references through 16 and reopen', () => {
    const db = new Database(':memory:');
    databases.push(db);
    db.pragma('foreign_keys=ON');
    expect(applyMigrationSequence(db, [...legacyMigrations14, migration0015])).toBe(15);
    insertCampaign(db, 'wound-migration', 'PAUSED', '{ "retained": [3,1] }');
    const record = '{ "untouched": true }',
      hash = networkApplicationStorage.sha(record);
    const oldKinds = [
      'ITEM',
      'WEAPON_PROFILE_VERSION',
      'EFFECT_INSTANCE',
      'TRAUMA_INSTANCE',
      'SYMBIONT_INSTANCE',
    ] as const;
    for (const [index, kind] of oldKinds.entries()) {
      db.prepare('INSERT INTO npc_attempt_event VALUES(?,?,?,?,?,?)').run(
        'wound-migration',
        'draft',
        index,
        'origin-' + index,
        record,
        hash,
      );
      db.prepare('INSERT INTO npc_child_identity VALUES(?,?,?,?,?,?,?,?,?)').run(
        'child-' + index,
        'wound-migration',
        'npc',
        'draft',
        'origin-' + index,
        1,
        kind,
        kind === 'WEAPON_PROFILE_VERSION' ? 'child-0' : null,
        kind === 'WEAPON_PROFILE_VERSION' ? 'DEFAULT' : null,
      );
    }
    const tables = allTableNames(db).filter((t) => t !== 'schema_migration'),
      before = tableRows(db, tables);
    const registry = db.prepare('SELECT * FROM schema_migration ORDER BY version').all();
    expect(applyMigrationSequence(db, [...legacyMigrations14, migration0015, migration0016])).toBe(
      16,
    );
    expect(tableRows(db, tables)).toEqual(before);
    expect(
      db.prepare('SELECT * FROM schema_migration WHERE version<=15 ORDER BY version').all(),
    ).toEqual(registry);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    db.prepare('INSERT INTO npc_attempt_event VALUES(?,?,?,?,?,?)').run(
      'wound-migration',
      'draft',
      5,
      'wound-origin',
      record,
      hash,
    );
    db.prepare('INSERT INTO npc_child_identity VALUES(?,?,?,?,?,?,?,?,?)').run(
      'wound-child',
      'wound-migration',
      'npc',
      'draft',
      'wound-origin',
      1,
      'WOUND_INSTANCE',
      null,
      null,
    );
    expect(() =>
      db
        .prepare('UPDATE npc_child_identity SET item_instance_id=? WHERE child_id=?')
        .run('child-0', 'wound-child'),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare('UPDATE npc_child_identity SET item_instance_id=? WHERE child_id=?')
        .run('missing', 'child-1'),
    ).toThrow(/FOREIGN KEY/);
    const migrated = db.serialize();
    expect(applyMigrationSequence(db, [...legacyMigrations14, migration0015, migration0016])).toBe(
      16,
    );
    expect(db.serialize().equals(migrated)).toBe(true);
    const reopened = new Database(migrated);
    databases.push(reopened);
    reopened.pragma('foreign_keys=ON');
    expect(
      applyMigrationSequence(reopened, [...legacyMigrations14, migration0015, migration0016]),
    ).toBe(16);
    expect(reopened.serialize().equals(migrated)).toBe(true);
    expect(tableRows(reopened, tables)).toEqual(tableRows(db, tables));
    expect(reopened.pragma('foreign_key_check')).toEqual([]);
    expect(reopened.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });
});
describe('forward NPC linked set migration', () => {
  it('preserves every existing child kind through 16 to 17 and a real file reopen', () => {
    const tempRoot = resolve(tmpdir());
    const directory = mkdtempSync(join(tempRoot, 'symbiosis-schema17-'));
    if (dirname(resolve(directory)) !== tempRoot) throw Error('Temporary path escaped its root');
    const file = join(directory, 'migration.sqlite');
    let db = new Database(file);
    try {
      db.pragma('foreign_keys=ON');
      expect(
        applyMigrationSequence(db, [...legacyMigrations14, migration0015, migration0016]),
      ).toBe(16);
      insertCampaign(db, 'linked-migration', 'PAUSED', '{ "unchanged": 1 }');
      const record = '{ "unchanged": [2,1] }',
        hash = networkApplicationStorage.sha(record);
      const oldKinds = [
        'ITEM',
        'WEAPON_PROFILE_VERSION',
        'EFFECT_INSTANCE',
        'TRAUMA_INSTANCE',
        'SYMBIONT_INSTANCE',
        'WOUND_INSTANCE',
      ] as const;
      for (const [index, kind] of oldKinds.entries()) {
        db.prepare('INSERT INTO npc_attempt_event VALUES(?,?,?,?,?,?)').run(
          'linked-migration',
          'draft',
          index,
          'origin-' + index,
          record,
          hash,
        );
        db.prepare('INSERT INTO npc_child_identity VALUES(?,?,?,?,?,?,?,?,?)').run(
          'child-' + index,
          'linked-migration',
          'npc',
          'draft',
          'origin-' + index,
          1,
          kind,
          kind === 'WEAPON_PROFILE_VERSION' ? 'child-0' : null,
          kind === 'WEAPON_PROFILE_VERSION' ? 'DEFAULT' : null,
        );
      }
      const tables = allTableNames(db).filter((name) => name !== 'schema_migration');
      const oldRows = tableRows(db, tables),
        oldRegistry = db.prepare('SELECT * FROM schema_migration ORDER BY version').all();
      expect(
        applyMigrationSequence(db, [
          ...legacyMigrations14,
          migration0015,
          migration0016,
          migration0017,
        ]),
      ).toBe(17);
      expect(tableRows(db, tables)).toEqual(oldRows);
      expect(
        db.prepare('SELECT * FROM schema_migration WHERE version<=16 ORDER BY version').all(),
      ).toEqual(oldRegistry);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      db.prepare('INSERT INTO npc_attempt_event VALUES(?,?,?,?,?,?)').run(
        'linked-migration',
        'draft',
        6,
        'set-origin',
        record,
        hash,
      );
      db.prepare('INSERT INTO npc_child_identity VALUES(?,?,?,?,?,?,?,?,?)').run(
        'set-id',
        'linked-migration',
        'npc',
        'draft',
        'set-origin',
        1,
        'LINKED_SET',
        null,
        null,
      );
      expect(() =>
        db
          .prepare('UPDATE npc_child_identity SET item_instance_id=? WHERE child_id=?')
          .run('child-0', 'set-id'),
      ).toThrow(/CHECK/);
      expect(() =>
        db
          .prepare('UPDATE npc_child_identity SET item_instance_id=? WHERE child_id=?')
          .run('missing', 'child-1'),
      ).toThrow(/FOREIGN KEY/);
      const migrated = db.serialize(),
        rows = tableRows(db, tables);
      expect(
        applyMigrationSequence(db, [
          ...legacyMigrations14,
          migration0015,
          migration0016,
          migration0017,
        ]),
      ).toBe(17);
      expect(db.serialize().equals(migrated)).toBe(true);
      db.close();
      db = new Database(file);
      db.pragma('foreign_keys=ON');
      expect(
        applyMigrationSequence(db, [
          ...legacyMigrations14,
          migration0015,
          migration0016,
          migration0017,
        ]),
      ).toBe(17);
      expect(db.serialize().equals(migrated)).toBe(true);
      expect(tableRows(db, tables)).toEqual(rows);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    } finally {
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
describe('forward NPC custom profile identity migration', () => {
  it('preserves populated 17 rows and self-references through 18, new item-bound kinds and file reopen', () => {
    const tempRoot = resolve(tmpdir());
    const directory = mkdtempSync(join(tempRoot, 'symbiosis-schema18-'));
    if (dirname(resolve(directory)) !== tempRoot) throw Error('Temporary path escaped its root');
    const file = join(directory, 'migration.sqlite');
    let db = new Database(file);
    try {
      db.pragma('foreign_keys=ON');
      expect(
        applyMigrationSequence(db, [
          ...legacyMigrations14,
          migration0015,
          migration0016,
          migration0017,
        ]),
      ).toBe(17);
      insertCampaign(db, 'custom-migration', 'PAUSED', '{ "unchanged": [3,1] }');
      const record = '{ "unchanged": [2,1] }',
        hash = networkApplicationStorage.sha(record);
      const oldKinds = [
        'ITEM',
        'WEAPON_PROFILE_VERSION',
        'EFFECT_INSTANCE',
        'TRAUMA_INSTANCE',
        'SYMBIONT_INSTANCE',
        'WOUND_INSTANCE',
        'LINKED_SET',
      ] as const;
      for (const [index, kind] of oldKinds.entries()) {
        db.prepare('INSERT INTO npc_attempt_event VALUES(?,?,?,?,?,?)').run(
          'custom-migration',
          'draft',
          index,
          'origin-' + index,
          record,
          hash,
        );
        db.prepare('INSERT INTO npc_child_identity VALUES(?,?,?,?,?,?,?,?,?)').run(
          'child-' + index,
          'custom-migration',
          'npc',
          'draft',
          'origin-' + index,
          1,
          kind,
          kind === 'WEAPON_PROFILE_VERSION' ? 'child-0' : null,
          kind === 'WEAPON_PROFILE_VERSION' ? 'DEFAULT' : null,
        );
      }
      const tables = allTableNames(db).filter((name) => name !== 'schema_migration'),
        oldRows = tableRows(db, tables),
        oldRegistry = db.prepare('SELECT * FROM schema_migration ORDER BY version').all();
      expect(
        applyMigrationSequence(db, [
          ...legacyMigrations14,
          migration0015,
          migration0016,
          migration0017,
          migration0018,
        ]),
      ).toBe(18);
      expect(readAppliedMigrationVersion(db)).toBe(18);
      expect(tableRows(db, tables)).toEqual(oldRows);
      expect(
        db.prepare('SELECT * FROM schema_migration WHERE version<=17 ORDER BY version').all(),
      ).toEqual(oldRegistry);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      db.prepare('INSERT INTO npc_attempt_event VALUES(?,?,?,?,?,?)').run(
        'custom-migration',
        'draft',
        7,
        'profile-origin',
        record,
        hash,
      );
      for (const [index, kind] of ['CUSTOM_PROFILE', 'CUSTOM_PROFILE_VERSION'].entries()) {
        const id = 'custom-' + index;
        db.prepare('INSERT INTO npc_child_identity VALUES(?,?,?,?,?,?,?,?,?)').run(
          id,
          'custom-migration',
          'npc',
          'draft',
          'profile-origin',
          index + 1,
          kind,
          'child-0',
          null,
        );
        const beforeRefusals = db.serialize();
        expect(() =>
          db
            .prepare('UPDATE npc_child_identity SET item_instance_id=NULL WHERE child_id=?')
            .run(id),
        ).toThrow(/CHECK/);
        expect(() =>
          db
            .prepare('UPDATE npc_child_identity SET weapon_variant_id=? WHERE child_id=?')
            .run('DEFAULT', id),
        ).toThrow(/CHECK/);
        expect(() =>
          db
            .prepare('UPDATE npc_child_identity SET item_instance_id=? WHERE child_id=?')
            .run(id, id),
        ).toThrow(/CHECK/);
        expect(() =>
          db
            .prepare('UPDATE npc_child_identity SET item_instance_id=? WHERE child_id=?')
            .run('missing', id),
        ).toThrow(/FOREIGN KEY/);
        expect(db.serialize().equals(beforeRefusals)).toBe(true);
      }
      expect(() =>
        db.prepare('DELETE FROM npc_child_identity WHERE child_id=?').run('child-0'),
      ).toThrow(/FOREIGN KEY/);
      expect(() =>
        db
          .prepare('UPDATE npc_child_identity SET kind=? WHERE child_id=?')
          .run('UNKNOWN', 'custom-0'),
      ).toThrow(/CHECK/);
      const migrated = db.serialize(),
        rows = tableRows(db, tables);
      expect(
        applyMigrationSequence(db, [
          ...legacyMigrations14,
          migration0015,
          migration0016,
          migration0017,
          migration0018,
        ]),
      ).toBe(18);
      expect(db.serialize().equals(migrated)).toBe(true);
      db.close();
      db = new Database(file);
      db.pragma('foreign_keys=ON');
      expect(
        applyMigrationSequence(db, [
          ...legacyMigrations14,
          migration0015,
          migration0016,
          migration0017,
          migration0018,
        ]),
      ).toBe(18);
      expect(db.serialize().equals(migrated)).toBe(true);
      expect(tableRows(db, tables)).toEqual(rows);
      expect(
        db.prepare('SELECT * FROM schema_migration WHERE version<=17 ORDER BY version').all(),
      ).toEqual(oldRegistry);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    } finally {
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
describe('forward NPC coating identity migration', () => {
  it('preserves populated 18 rows and item references through 19, refusals and file reopen', () => {
    const tempRoot = resolve(tmpdir());
    const directory = mkdtempSync(join(tempRoot, 'symbiosis-schema19-'));
    if (dirname(resolve(directory)) !== tempRoot) throw Error('Temporary path escaped its root');
    const file = join(directory, 'migration.sqlite');
    let db = new Database(file);
    try {
      db.pragma('foreign_keys=ON');
      expect(
        applyMigrationSequence(db, [
          ...legacyMigrations14,
          migration0015,
          migration0016,
          migration0017,
          migration0018,
        ]),
      ).toBe(18);
      insertCampaign(db, 'coating-migration', 'PAUSED', '{ "unchanged": [3,1] }');
      const record = '{ "unchanged": [2,1] }',
        hash = networkApplicationStorage.sha(record);
      const oldKinds = [
        'ITEM',
        'WEAPON_PROFILE_VERSION',
        'EFFECT_INSTANCE',
        'TRAUMA_INSTANCE',
        'SYMBIONT_INSTANCE',
        'WOUND_INSTANCE',
        'LINKED_SET',
        'CUSTOM_PROFILE',
        'CUSTOM_PROFILE_VERSION',
      ] as const;
      for (const [index, kind] of oldKinds.entries()) {
        db.prepare('INSERT INTO npc_attempt_event VALUES(?,?,?,?,?,?)').run(
          'coating-migration',
          'draft',
          index,
          'origin-' + index,
          record,
          hash,
        );
        db.prepare('INSERT INTO npc_child_identity VALUES(?,?,?,?,?,?,?,?,?)').run(
          'child-' + index,
          'coating-migration',
          'npc',
          'draft',
          'origin-' + index,
          1,
          kind,
          kind === 'WEAPON_PROFILE_VERSION' ||
            kind === 'CUSTOM_PROFILE' ||
            kind === 'CUSTOM_PROFILE_VERSION'
            ? 'child-0'
            : null,
          kind === 'WEAPON_PROFILE_VERSION' ? 'DEFAULT' : null,
        );
      }
      const tables = allTableNames(db).filter((name) => name !== 'schema_migration'),
        oldRows = tableRows(db, tables),
        oldRegistry = db.prepare('SELECT * FROM schema_migration ORDER BY version').all();
      expect(applyMigrations(db)).toBe(19);
      expect(readAppliedMigrationVersion(db)).toBe(19);
      expect(tableRows(db, tables)).toEqual(oldRows);
      expect(
        db.prepare('SELECT * FROM schema_migration WHERE version<=18 ORDER BY version').all(),
      ).toEqual(oldRegistry);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      db.prepare('INSERT INTO npc_attempt_event VALUES(?,?,?,?,?,?)').run(
        'coating-migration',
        'draft',
        9,
        'coating-origin',
        record,
        hash,
      );
      db.prepare('INSERT INTO npc_child_identity VALUES(?,?,?,?,?,?,?,?,?)').run(
        'coating',
        'coating-migration',
        'npc',
        'draft',
        'coating-origin',
        1,
        'COATING_INSTANCE',
        'child-0',
        null,
      );
      const beforeRefusals = db.serialize();
      expect(() =>
        db
          .prepare('UPDATE npc_child_identity SET item_instance_id=NULL WHERE child_id=?')
          .run('coating'),
      ).toThrow(/CHECK/);
      expect(() =>
        db
          .prepare('UPDATE npc_child_identity SET item_instance_id=? WHERE child_id=?')
          .run('coating', 'coating'),
      ).toThrow(/CHECK/);
      expect(() =>
        db
          .prepare('UPDATE npc_child_identity SET item_instance_id=? WHERE child_id=?')
          .run('missing', 'coating'),
      ).toThrow(/FOREIGN KEY/);
      expect(() =>
        db
          .prepare('UPDATE npc_child_identity SET weapon_variant_id=? WHERE child_id=?')
          .run('DEFAULT', 'coating'),
      ).toThrow(/CHECK/);
      expect(() =>
        db
          .prepare('UPDATE npc_child_identity SET kind=? WHERE child_id=?')
          .run('UNKNOWN', 'coating'),
      ).toThrow(/CHECK/);
      expect(() =>
        db.prepare('DELETE FROM npc_child_identity WHERE child_id=?').run('child-0'),
      ).toThrow(/FOREIGN KEY/);
      expect(db.serialize().equals(beforeRefusals)).toBe(true);
      const migrated = db.serialize(),
        rows = tableRows(db, tables);
      expect(applyMigrations(db)).toBe(19);
      expect(db.serialize().equals(migrated)).toBe(true);
      db.close();
      db = new Database(file);
      db.pragma('foreign_keys=ON');
      expect(applyMigrations(db)).toBe(19);
      expect(db.serialize().equals(migrated)).toBe(true);
      expect(tableRows(db, tables)).toEqual(rows);
      expect(
        db.prepare('SELECT * FROM schema_migration WHERE version<=18 ORDER BY version').all(),
      ).toEqual(oldRegistry);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    } finally {
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
function legacy14() {
  const db = new Database(':memory:');
  databases.push(db);
  db.pragma('foreign_keys=ON');
  expect(applyMigrationSequence(db, legacyMigrations14)).toBe(14);
  return db;
}
function tableRows(db: Database.Database, names: readonly string[]) {
  return Object.fromEntries(
    names.map((name) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]),
  );
}
function allTableNames(db: Database.Database): string[] {
  return db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}
function readableLegacyFamilies(db: Database.Database, owner: string) {
  networkApplicationStorage.schema(db);
  expect(readDeviceInstallationIdentity(db, owner)).toBeNull();
  expect(readActiveLocalNetworkTab(db, owner)).toBeNull();
  db.transaction(() =>
    retirePostSaveRestoreCursor(db, '00000000-0000-4000-8000-000000000099'),
  ).immediate();
}
describe('migration 15 closed compatibility', () => {
  it('preserves every old table row and migration seal, including rebuilt cursor/queue record bytes', () => {
    const db = legacy14();
    const json = '{ "verbatim": "old SQL-boundary fixture", "order": [2,1] }',
      hash = 'a'.repeat(64);
    // Deliberately noncanonical structural fixture: migration must copy bytes, not replay domain state.
    insertCampaign(db, 'preserved-campaign', 'PAUSED', json);
    db.prepare(
      'INSERT INTO local_character(local_character_id,lifecycle_state,payload_json) VALUES(?,?,?)',
    ).run('preserved-character', 'DRAFT', json);
    db.prepare('INSERT INTO local_gm_profile VALUES(?,?,?,?)').run('profile', 'owner', json, hash);
    db.prepare('INSERT INTO local_gm_context VALUES(?,?,?,?)').run(
      'context',
      'profile',
      json,
      hash,
    );
    db.prepare('INSERT INTO campaign_creation_cursor VALUES(?,?,?,?,?,?)').run(
      'context',
      'QUEUE',
      'preserved-campaign',
      'NET-017',
      json,
      hash,
    );
    db.prepare('INSERT INTO gm_request_queue_event VALUES(?,?,?,?,?,?,?,?)').run(
      'event',
      'context',
      'preserved-campaign',
      'owner',
      0,
      'NAV',
      json,
      hash,
    );
    db.prepare('INSERT INTO gm_request_queue_view VALUES(?,?,?,?,?,?)').run(
      'context',
      'preserved-campaign',
      'owner',
      'event',
      json,
      hash,
    );
    const tables = allTableNames(db).filter((t) => t !== 'schema_migration'),
      before = tableRows(db, tables),
      registry = db.prepare('SELECT * FROM schema_migration ORDER BY version').all();
    expect(applyMigrations(db)).toBe(19);
    expect(readAppliedMigrationVersion(db)).toBe(19);
    expect(tableRows(db, tables)).toEqual(before);
    expect(
      db.prepare('SELECT * FROM schema_migration WHERE version<=14 ORDER BY version').all(),
    ).toEqual(registry);
    expect(allTableNames(db)).toEqual([...tables, 'schema_migration', ...NPC_TABLES].sort());
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const migrated = db.serialize();
    expect(applyMigrations(db)).toBe(19);
    expect(db.serialize().equals(migrated)).toBe(true);
    const reopened = new Database(migrated);
    databases.push(reopened);
    expect(applyMigrations(reopened)).toBe(19);
    expect(tableRows(reopened, tables)).toEqual(before);
    expect(() => db.prepare('UPDATE campaign_creation_cursor SET kind=?').run('NPC')).toThrow(
      /CHECK/,
    );
    expect(() =>
      db.prepare('UPDATE campaign_creation_cursor SET kind=?,form_id=?').run('QUEUE', 'NPC-016'),
    ).not.toThrow();
    expect(() =>
      db.prepare('UPDATE gm_request_queue_event SET kind=?').run('NPC_SELECTION'),
    ).not.toThrow();
    expect(() => db.prepare('UPDATE gm_request_queue_event SET kind=?').run('NPC_UNKNOWN')).toThrow(
      /CHECK/,
    );
  });
  it('rolls back all new tables and rebuilt families when migration 15 fails', () => {
    const db = legacy14();
    insertCampaign(db, 'rollback-campaign', 'PAUSED', '{ "preserve": [2,1] }');
    const originalBytes = db.serialize(),
      encodedPageSize = originalBytes.readUInt16BE(16);
    const pageSize = encodedPageSize === 1 ? 65536 : encodedPageSize;
    const trunks = new Set<number>(),
      leaves = new Set<number>();
    // Freeze the BEFORE freelist before masking; corrupted AFTER pointers must never choose ignored bytes.
    for (let trunk = originalBytes.readUInt32BE(32); trunk !== 0;) {
      expect(trunk).toBeGreaterThan(1);
      expect(trunk).toBeLessThanOrEqual(originalBytes.length / pageSize);
      expect(trunks.has(trunk)).toBe(false);
      trunks.add(trunk);
      const offset = (trunk - 1) * pageSize,
        count = originalBytes.readUInt32BE(offset + 4);
      expect(count).toBeLessThanOrEqual(pageSize / 4 - 2);
      for (let i = 0; i < count; i++) {
        const leaf = originalBytes.readUInt32BE(offset + 8 + i * 4);
        expect(leaf).toBeGreaterThan(1);
        expect(leaf).toBeLessThanOrEqual(originalBytes.length / pageSize);
        expect(leaves.has(leaf)).toBe(false);
        leaves.add(leaf);
      }
      trunk = originalBytes.readUInt32BE(offset);
    }
    for (const leaf of leaves) expect(trunks.has(leaf)).toBe(false);
    expect(trunks.size + leaves.size).toBe(originalBytes.readUInt32BE(36));
    const informationPages = (bytes: Buffer) => {
      const masked = Buffer.from(bytes);
      expect(masked.length).toBe(originalBytes.length);
      // SQLite does not journal unused leaf payload; the same BEFORE set masks both copies only.
      // https://www.sqlite.org/fileformat.html#the_rollback_journal
      for (const leaf of leaves) masked.fill(0, (leaf - 1) * pageSize, leaf * pageSize);
      return masked;
    };
    const readState = () => ({
      schema: db.prepare('SELECT * FROM sqlite_schema ORDER BY type,name').all(),
      rows: tableRows(db, allTableNames(db)),
      pragmas: Object.fromEntries(
        ['schema_version', 'user_version', 'page_count', 'freelist_count', 'foreign_keys'].map(
          (name) => [name, db.pragma(name, { simple: true })],
        ),
      ),
      inTransaction: db.inTransaction,
      informationPages: informationPages(db.serialize()),
    });
    const before = readState();
    expect(() =>
      applyMigrationSequence(db, [
        ...legacyMigrations14,
        { ...migration0015, sql: migration0015.sql + '; THIS IS NOT SQL;' },
      ]),
    ).toThrow(/syntax|near/);
    expect(readState()).toEqual(before);
    expect(db.inTransaction).toBe(false);
    expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(readAppliedMigrationVersion(db)).toBe(14);
    expect(allTableNames(db).filter((t) => t.startsWith('npc_'))).toEqual([]);
  });
  it('keeps the same empty legacy family reads at 14 and 19 without creating NPC state', () => {
    const db = legacy14(),
      owner = bootstrapDeviceIdentity(db);
    readableLegacyFamilies(db, owner);
    expect(applyMigrations(db)).toBe(19);
    const before = db.serialize();
    readableLegacyFamilies(db, owner);
    expect(db.serialize().equals(before)).toBe(true);
    for (const name of NPC_TABLES) expect(db.prepare(`SELECT * FROM ${name}`).all()).toEqual([]);
  });
  it('rejects a registered future version 20 before migration or reader writes', () => {
    const db = memoryDatabase(),
      owner = bootstrapDeviceIdentity(db);
    db.prepare('INSERT INTO schema_migration VALUES(?,?,?)').run(20, 'future', 'f'.repeat(64));
    const before = db.serialize();
    for (const read of [
      () => applyMigrations(db),
      () => readAppliedMigrationVersion(db),
      () => networkApplicationStorage.schema(db),
      () => readDeviceInstallationIdentity(db, owner),
      () => readActiveLocalNetworkTab(db, owner),
      () => db.transaction(() => retirePostSaveRestoreCursor(db, 'unused')).immediate(),
    ]) {
      expect(read).toThrow();
      expect(db.serialize().equals(before)).toBe(true);
    }
  });
  it.each([
    'local_network_tab',
    'local_network_application',
    'gm_request_queue_event',
    'campaign_admission_batch',
    'campaign_lobby_head',
    'campaign_lifecycle_head',
    ...NPC_TABLES,
  ])('refuses missing %s in schema 19 and preserves the damaged bytes', (table) => {
    const db = memoryDatabase(),
      owner = bootstrapDeviceIdentity(db);
    db.pragma('foreign_keys=OFF');
    db.exec(`DROP TABLE ${table}`);
    db.pragma('foreign_keys=ON');
    const before = db.serialize();
    // Installation and post-save retain every older family check and require all new NPC tables.
    expect(() => readDeviceInstallationIdentity(db, owner)).toThrow();
    expect(() =>
      db.transaction(() => retirePostSaveRestoreCursor(db, 'unused')).immediate(),
    ).toThrow();
    expect(db.serialize().equals(before)).toBe(true);
  });
});

describe('network schema probes against live SQLite', () => {
  const tables = [
    ...CAMPAIGN_LOBBY_TABLES,
    ...CAMPAIGN_LIFECYCLE_TABLES,
    ...NPC_TABLES,
    ...NETWORK_APPLICATION_TABLES,
    ...DEVICE_REQUEST_REVIEW_TABLES,
    ...CAMPAIGN_ADMISSION_TABLES,
  ];
  it.each([10, 11, 12, 13, 14, 19])(
    'accepts the actual empty migration %s prefix without adding state',
    (version) => {
      const db = new Database(':memory:');
      databases.push(db);
      db.pragma('foreign_keys=ON');
      if (version === 19) expect(applyMigrations(db)).toBe(version);
      else expect(applyMigrationSequence(db, legacyMigrations14.slice(0, version))).toBe(version);
      const present = new Set(allTableNames(db));
      for (const table of tables.filter((name) => present.has(name)))
        expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
      const before = db.serialize();
      expect(() => networkApplicationStorage.schema(db)).not.toThrow();
      expect(() =>
        db.transaction(() => networkApplicationStorage.schema(db)).deferred(),
      ).not.toThrow();
      expect(db.serialize().equals(before)).toBe(true);
      expect(db.inTransaction).toBe(false);
    },
  );
  it('refuses every missing current table, preserves damaged bytes and reads again after rollback', () => {
    const db = memoryDatabase(),
      original = db.serialize(),
      rollback = new Error('rollback schema damage');
    expect(new Set(tables).size).toBe(tables.length);
    for (const table of tables) {
      expect(() =>
        db.transaction(() => {
          db.exec(`DROP TABLE ${table}`);
          const damaged = db.serialize();
          expect(() => networkApplicationStorage.schema(db)).toThrow(`no such table: ${table}`);
          expect(db.serialize().equals(damaged)).toBe(true);
          throw rollback;
        })(),
      ).toThrow(rollback);
      expect(db.serialize().equals(original)).toBe(true);
      expect(() => networkApplicationStorage.schema(db)).not.toThrow();
    }
  });
  it('steps a late table probe even when earlier tables are empty and propagates the real read error', () => {
    const db = memoryDatabase(),
      failure = new Error('schema probe execution failure');
    let reads = 0;
    db.function('schema_probe_read_failure', () => {
      reads++;
      throw failure;
    });
    // This intentionally damaged view distinguishes stepping the SELECT from preparing its names.
    db.exec('DROP TABLE gm_admission_view_event');
    db.exec(
      'CREATE VIEW gm_admission_view_event AS SELECT 1 AS value WHERE schema_probe_read_failure()',
    );
    const before = db.serialize();
    for (let attempt = 1; attempt <= 2; attempt++) {
      expect(() => networkApplicationStorage.schema(db)).toThrow(failure);
      expect(reads).toBe(attempt);
      expect(db.serialize().equals(before)).toBe(true);
    }
    db.function('schema_probe_read_failure', () => {
      reads++;
      return 1;
    });
    expect(() => networkApplicationStorage.schema(db)).not.toThrow();
    expect(reads).toBe(3);
    expect(db.serialize().equals(before)).toBe(true);
  });
  it('keeps consumed metadata numeric checks and does not carry a schema result to another database', () => {
    const db = memoryDatabase();
    expect(() => networkApplicationStorage.schema(db)).not.toThrow();
    const before = db.serialize();
    db.defaultSafeIntegers(true);
    expect(() => networkApplicationStorage.schema(db)).toThrow();
    db.defaultSafeIntegers(false);
    expect(() => networkApplicationStorage.schema(db)).not.toThrow();
    expect(db.serialize().equals(before)).toBe(true);
    const other = memoryDatabase();
    other.exec('DROP TABLE npc_art');
    const damaged = other.serialize();
    expect(() => networkApplicationStorage.schema(other)).toThrow('no such table: npc_art');
    expect(other.serialize().equals(damaged)).toBe(true);
    expect(() => networkApplicationStorage.schema(db)).not.toThrow();
    expect(db.serialize().equals(before)).toBe(true);
  });
});
