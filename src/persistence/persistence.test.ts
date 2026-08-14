import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openPersistenceDatabase } from './database.js';
import { migration0001, sqlStringLiteral, V1_LIFECYCLE_STATES } from './migrations/0001-initial.js';
import { applyMigrations, applyMigrationSequence } from './migrations/index.js';
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
      'campaign_character_copy',
      'campaign_checkpoint',
      'local_character',
      'local_character_checkpoint',
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
    expect(applyMigrations(database)).toBe(2);
    expect(
      database.prepare('SELECT payload_json FROM campaign WHERE campaign_id = ?').get('preserved'),
    ).toEqual({ payload_json: '{}' });
    expect(database.prepare('SELECT count(*) AS count FROM schema_migration').get()).toEqual({
      count: 2,
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
