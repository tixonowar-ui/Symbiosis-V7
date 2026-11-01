import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openPersistenceDatabase } from './database.js';
import { commitNewCampaignCheckpoint, type CampaignCheckpointCreator } from './index.js';
import { loadCampaignCheckpoint } from './store.js';

const databases: Database.Database[] = [];
const directories: string[] = [];
const open = (path = ':memory:') => {
  const database = openPersistenceDatabase(path);
  databases.push(database);
  return database;
};
afterEach(() => {
  for (const database of databases.splice(0)) if (database.open) database.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };

/** These tables model caller-owned journal/cursor writes without anticipating migration 0007. */
function addTransactionParticipants(database: Database.Database) {
  database.exec(`
    CREATE TABLE test_campaign_receipt (
      command_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
      receipt_id TEXT NOT NULL UNIQUE
    ) STRICT;
    CREATE TABLE test_campaign_cursor (
      device_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id)
    ) STRICT;
  `);
}
function writeParticipants(database: Database.Database) {
  database
    .prepare('INSERT INTO test_campaign_receipt VALUES (?, ?, ?)')
    .run('create-command', 'campaign', 'create-receipt');
  database.prepare('INSERT INTO test_campaign_cursor VALUES (?, ?)').run('device', 'campaign');
}
function expectEmpty(database: Database.Database) {
  for (const table of ['campaign', 'campaign_checkpoint', 'campaign_character_copy'])
    expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
}
function expectParticipantsEmpty(database: Database.Database) {
  expectEmpty(database);
  expect(database.prepare('SELECT * FROM test_campaign_receipt').all()).toEqual([]);
  expect(database.prepare('SELECT * FROM test_campaign_cursor').all()).toEqual([]);
}

describe('first PAUSED campaign checkpoint on disk', () => {
  let database: Database.Database, path: string;
  beforeEach(() => {
    const directory = mkdtempSync(join(tmpdir(), 'campaign-checkpoint-'));
    directories.push(directory);
    path = join(directory, 'campaign.sqlite');
    database = open(path);
    addTransactionParticipants(database);
  });
  it('atomically creates one zero-copy baseline and related receipt/cursor, then reopens the exact full checkpoint', () => {
    const payloadJson = '{ "title": "Zero players", "activePlayerCapacity": 5 }';
    const saved = commitNewCampaignCheckpoint(
      database,
      'campaign',
      (create) => {
        expect(database.inTransaction).toBe(true);
        const created = create('PAUSED', payloadJson);
        expect(created).toEqual({
          campaignId: 'campaign',
          lifecycleState: 'PAUSED',
          payloadJson,
          ...zero,
        });
        writeParticipants(database);
        return { receiptId: 'create-receipt' };
      },
      (result, checkpoint) => {
        expect(database.inTransaction).toBe(true);
        expect(result).toEqual({ receiptId: 'create-receipt' });
        expect(loadCampaignCheckpoint(database, 'campaign')).toEqual(checkpoint);
      },
    );
    expect(saved.checkpoint).toEqual({
      campaignId: 'campaign',
      ...zero,
      snapshotJson: JSON.stringify({
        campaign: { campaignId: 'campaign', lifecycleState: 'PAUSED', payloadJson },
        campaignCharacterCopies: [],
      }),
    });
    database.close();
    const reopened = open(path);
    expect(loadCampaignCheckpoint(reopened, 'campaign')).toEqual(saved.checkpoint);
    expect(reopened.prepare('SELECT * FROM test_campaign_receipt').all()).toEqual([
      { command_id: 'create-command', campaign_id: 'campaign', receipt_id: 'create-receipt' },
    ]);
    expect(reopened.prepare('SELECT * FROM test_campaign_cursor').all()).toEqual([
      { device_id: 'device', campaign_id: 'campaign' },
    ]);
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM campaign_character_copy').get()).toEqual(
      { count: 0 },
    );
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM campaign_checkpoint').get()).toEqual({
      count: 1,
    });
  });
});

describe('first PAUSED campaign checkpoint', () => {
  it.each([false, true])(
    'rejects a pre-existing campaign before invoking the callback (checkpoint=%s)',
    (withCheckpoint) => {
      const database = open();
      if (withCheckpoint)
        commitNewCampaignCheckpoint(database, 'campaign', (create) => create('PAUSED', '{}'));
      else
        database
          .prepare(
            "INSERT INTO campaign (campaign_id,lifecycle_state,payload_json) VALUES ('campaign','DRAFT','{}')",
          )
          .run();
      const before = database.prepare('SELECT * FROM campaign').all();
      const checkpoints = database.prepare('SELECT * FROM campaign_checkpoint').all();
      const write = vi.fn();
      expect(() => commitNewCampaignCheckpoint(database, 'campaign', write)).toThrow(
        /already exists/,
      );
      expect(write).not.toHaveBeenCalled();
      expect(database.prepare('SELECT * FROM campaign').all()).toEqual(before);
      expect(database.prepare('SELECT * FROM campaign_checkpoint').all()).toEqual(checkpoints);
    },
  );

  it('requires the creator and forbids adopting a row inserted directly by the callback', () => {
    const database = open();
    expect(() => commitNewCampaignCheckpoint(database, 'campaign', () => undefined)).toThrow(
      /was not created/,
    );
    expect(() =>
      commitNewCampaignCheckpoint(database, 'campaign', () => {
        database
          .prepare(
            "INSERT INTO campaign (campaign_id,lifecycle_state,payload_json) VALUES ('campaign','PAUSED','{}')",
          )
          .run();
      }),
    ).toThrow(/was not created/);
    expectEmpty(database);
  });

  it.each(['DRAFT', 'PREFLIGHT', 'HOSTING', 'COMPLETED', 'IMMUTABLE_ARCHIVE', 'UNKNOWN'])(
    'refuses %s as an initial creation state',
    (state) => {
      const database = open();
      expect(() =>
        commitNewCampaignCheckpoint(database, 'campaign', (create) =>
          create(state as 'PAUSED', '{}'),
        ),
      ).toThrow(/requires PAUSED/);
      expectEmpty(database);
    },
  );

  it.each(['{broken', '[]', 'null', '1', '"title"'])(
    'rejects a non-object payload %s before creating durable state',
    (payload) => {
      const database = open();
      expect(() =>
        commitNewCampaignCheckpoint(database, 'campaign', (create) => create('PAUSED', payload)),
      ).toThrow(/payloadJson/);
      expectEmpty(database);
    },
  );

  it.each(['stateRevision', 'projectionRevision', 'actorVisibilityRevision'])(
    'rejects a nonzero initial %s and rolls back every participant',
    (revision) => {
      const database = open();
      addTransactionParticipants(database);
      expect(() =>
        commitNewCampaignCheckpoint(database, 'campaign', (create) => {
          create('PAUSED', '{}');
          writeParticipants(database);
          database.exec(`UPDATE campaign SET ${revision}=1 WHERE campaign_id='campaign'`);
        }),
      ).toThrow(/initial revisions must be 0/);
      expectParticipantsEmpty(database);
    },
  );

  it.each([
    "UPDATE campaign SET lifecycle_state='HOSTING' WHERE campaign_id='campaign'",
    "UPDATE campaign SET payload_json='{\"changed\":true}' WHERE campaign_id='campaign'",
    "INSERT INTO campaign_character_copy VALUES ('copy','campaign','source','CANDIDATE','{}')",
  ])('refuses campaign mutations after the one-shot creation: %s', (sql) => {
    const database = open();
    addTransactionParticipants(database);
    expect(() =>
      commitNewCampaignCheckpoint(database, 'campaign', (create) => {
        create('PAUSED', '{}');
        writeParticipants(database);
        database.exec(sql);
      }),
    ).toThrow(/changed after creation/);
    expectParticipantsEmpty(database);
  });

  it('rolls back receipt/cursor and the campaign when either callback fails', () => {
    for (const failInValidation of [false, true]) {
      const database = open();
      addTransactionParticipants(database);
      expect(() =>
        commitNewCampaignCheckpoint(
          database,
          'campaign',
          (create) => {
            create('PAUSED', '{}');
            writeParticipants(database);
            if (!failInValidation) throw new Error('caller failure');
          },
          () => {
            throw new Error('caller failure');
          },
        ),
      ).toThrow('caller failure');
      expectParticipantsEmpty(database);
    }
  });

  it.each([
    'BEFORE INSERT ON campaign_checkpoint BEGIN SELECT RAISE(IGNORE); END',
    "BEFORE INSERT ON campaign_checkpoint BEGIN SELECT RAISE(ABORT, 'interrupted checkpoint'); END",
    "AFTER INSERT ON campaign_checkpoint BEGIN UPDATE campaign_checkpoint SET snapshot_json='{}' WHERE campaign_id=NEW.campaign_id; END",
    'AFTER INSERT ON campaign_checkpoint BEGIN UPDATE campaign SET payload_json=\'{"changed":true}\' WHERE campaign_id=NEW.campaign_id; END',
    'AFTER INSERT ON campaign BEGIN UPDATE campaign SET projectionRevision=1 WHERE campaign_id=NEW.campaign_id; END',
  ])('rolls back trigger failure or tampering: %s', (trigger) => {
    const database = open();
    addTransactionParticipants(database);
    database.exec(`CREATE TEMP TRIGGER sabotage ${trigger};`);
    expect(() =>
      commitNewCampaignCheckpoint(database, 'campaign', (create) => {
        create('PAUSED', '{}');
        writeParticipants(database);
      }),
    ).toThrow();
    expectParticipantsEmpty(database);
  });

  it('revalidates after the validator and does not trust a coherently replaced row and checkpoint', () => {
    const database = open();
    addTransactionParticipants(database);
    expect(() =>
      commitNewCampaignCheckpoint(
        database,
        'campaign',
        (create) => {
          create('PAUSED', '{}');
          writeParticipants(database);
        },
        (_result, checkpoint) => {
          const replacement = '{"tampered":true}';
          const snapshot = JSON.stringify({
            campaign: {
              campaignId: 'campaign',
              lifecycleState: 'PAUSED',
              payloadJson: replacement,
            },
            campaignCharacterCopies: [],
          });
          database.prepare('UPDATE campaign SET payload_json=?').run(replacement);
          database.prepare('UPDATE campaign_checkpoint SET snapshot_json=?').run(snapshot);
          checkpoint.snapshotJson = snapshot;
        },
      ),
    ).toThrow(/changed after creation/);
    expectParticipantsEmpty(database);
  });

  it('rejects async/thenable callbacks and nested execution before leaving any partial state', async () => {
    const database = open();
    const asyncWrite = vi.fn(async (_create: CampaignCheckpointCreator) => {
      await Promise.resolve();
    });
    // A wrapper preserves the native async function tag checked before invoking the callback.
    const nativeAsyncWrite = async (create: CampaignCheckpointCreator) => {
      await asyncWrite(create);
    };
    expect(() =>
      commitNewCampaignCheckpoint(database, 'campaign', nativeAsyncWrite as never),
    ).toThrow(/synchronous/);
    expect(asyncWrite).not.toHaveBeenCalled();
    const create = vi.fn((creator: CampaignCheckpointCreator) => creator('PAUSED', '{}'));
    const asyncValidate = async () => {
      await Promise.resolve();
    };
    expect(() =>
      commitNewCampaignCheckpoint(database, 'campaign', create, asyncValidate as never),
    ).toThrow(/synchronous/);
    expect(create).not.toHaveBeenCalled();
    expect(() =>
      database
        .transaction(() => commitNewCampaignCheckpoint(database, 'campaign', create))
        .immediate(),
    ).toThrow(/top-level/);
    expect(create).not.toHaveBeenCalled();
    expect(() =>
      commitNewCampaignCheckpoint(database, 'campaign', (creator) => {
        creator('PAUSED', '{}');
        return { then: () => undefined };
      }),
    ).toThrow(/synchronous/);
    expect(() =>
      commitNewCampaignCheckpoint(database, 'campaign', create, () => ({ then: () => undefined })),
    ).toThrow(/synchronous/);
    await Promise.resolve();
    expectEmpty(database);
  });

  it('poisons swallowed repeated creator calls and disarms a saved creator after commit or rollback', () => {
    const database = open();
    let saved: CampaignCheckpointCreator | undefined;
    expect(() =>
      commitNewCampaignCheckpoint(database, 'campaign', (create) => {
        saved = create;
        create('PAUSED', '{}');
        try {
          create('PAUSED', '{}');
        } catch {
          /* Swallowing a creator error cannot permit commit. */
        }
      }),
    ).toThrow(/creator is no longer active/);
    expect(() => saved?.('PAUSED', '{}')).toThrow(/creator is no longer active/);
    expectEmpty(database);
    expect(() =>
      commitNewCampaignCheckpoint(
        database,
        'campaign',
        (create) => {
          saved = create;
          create('PAUSED', '{}');
        },
        () => {
          try {
            saved?.('PAUSED', '{}');
          } catch {
            /* A validator cannot reuse the creator either. */
          }
        },
      ),
    ).toThrow(/creator is no longer active/);
    expectEmpty(database);
    const first = commitNewCampaignCheckpoint(database, 'campaign', (create) => {
      saved = create;
      return create('PAUSED', '{}');
    });
    expect(() => saved?.('PAUSED', '{"late":true}')).toThrow(/creator is no longer active/);
    expect(loadCampaignCheckpoint(database, 'campaign')).toEqual(first.checkpoint);
  });
});
