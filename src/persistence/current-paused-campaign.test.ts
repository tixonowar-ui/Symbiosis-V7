import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampaignDraftFormId } from '../shared/campaign-creation.js';
import type { JsonObject } from '../shared/wire-protocol.js';
import {
  CampaignCreationStoreError,
  campaignCreationHash,
  ensureLocalGmProfile,
  createLocalGmContext,
  createCampaignDraft,
  readCampaignDraft,
  commitCampaignDraftUpdate,
  navigateCampaignDraft,
  commitCampaignCreation,
  readPausedCampaign,
  readCampaignPrivateOwner,
  readCampaignCreationCommand,
  readHostedCampaignCreationOrigin,
  readCampaignCreationOrigin,
  type CampaignPrivateOwner,
  type RedactedCampaignDraftRequest,
} from './campaign-creation.js';
import {
  readOwnedCurrentPausedCampaign,
  readHostedCurrentPausedCampaign,
} from './current-paused-campaign.js';
import { openPersistenceDatabase } from './database.js';
import { bootstrapDeviceIdentity, resetDeviceIdentity } from './device-identity.js';
import { advanceRevisions, commitCampaignCheckpoint, loadCampaignCheckpoint } from './store.js';

const databases: Database.Database[] = [];
const directories: string[] = [];
const open = (path = ':memory:') => {
  const db = openPersistenceDatabase(path);
  databases.push(db);
  return db;
};
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const allow = () => undefined;
const proof: JsonObject = { privateVerifier: 'must-never-serialize', salt: 'private-salt' };
const validate = (owner: CampaignPrivateOwner): void => {
  expect(owner.verifier).toEqual(proof);
  expect(owner.verifierSha256).toBe(campaignCreationHash(proof));
};
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
function setup(filename = ':memory:') {
  const db = open(filename);
  const device = bootstrapDeviceIdentity(db);
  ensureLocalGmProfile(db, { ownerDeviceId: device, masterProfileId: 'profile' }, allow);
  createLocalGmContext(
    db,
    { ownerDeviceId: device, masterProfileId: 'profile', gmLocalContextId: 'context' },
    allow,
  );
  createCampaignDraft(
    db,
    { gmLocalContextId: 'context', campaignDraftId: 'draft', expectedRevisions: zero },
    allow,
  );
  const stages: readonly {
    form: CampaignDraftFormId;
    variant: RedactedCampaignDraftRequest['variant'];
    values: JsonObject;
  }[] = [
    {
      form: 'CMP-001',
      variant: 'METADATA',
      values: { title: 'Exact published campaign', description: 'Private description', art: null },
    },
    {
      form: 'CMP-002',
      variant: 'HOST',
      values: {
        activePlayerCapacity: 5,
        hostAddress: '127.0.0.1',
        hostPort: 31770,
        networkInterface: 'loopback',
      },
    },
    { form: 'CMP-003', variant: 'SECRET', values: { secretProvided: true } },
    { form: 'CMP-004', variant: 'MODE', values: { defaultFutureRollMode: 'AUTO' } },
  ];
  const triple = (value: typeof zero) => ({
    stateRevision: value.stateRevision,
    projectionRevision: value.projectionRevision,
    actorVisibilityRevision: value.actorVisibilityRevision,
  });
  for (const stage of stages) {
    let draft = readCampaignDraft(db, 'context', 'draft');
    if (draft.formId !== stage.form) {
      navigateCampaignDraft(
        db,
        {
          gmLocalContextId: 'context',
          campaignDraftId: 'draft',
          expectedDraftRevision: draft.draftRevision,
          expectedRevisions: triple(draft),
          sourceFormId: draft.formId,
          targetFormId: stage.form,
        },
        allow,
      );
      draft = readCampaignDraft(db, 'context', 'draft');
    }
    const request = {
      messageType: 'campaign.draft.replace',
      protocolVersion: 3,
      draftUpdateId: `update-${stage.variant}`,
      scope: { gmLocalContextId: 'context', campaignDraftId: 'draft', sourceFormId: draft.formId },
      expectedDraftRevision: draft.draftRevision,
      expectedRevisions: triple(draft),
      variant: stage.variant,
      values: stage.values,
    } as RedactedCampaignDraftRequest;
    commitCampaignDraftUpdate(
      db,
      {
        request,
        ...(stage.variant === 'SECRET'
          ? { secretUpdate: { kind: 'REPLACE' as const, preparedVerifier: proof } }
          : {}),
      },
      allow,
    );
  }
  let draft = readCampaignDraft(db, 'context', 'draft');
  navigateCampaignDraft(
    db,
    {
      gmLocalContextId: 'context',
      campaignDraftId: 'draft',
      expectedDraftRevision: draft.draftRevision,
      expectedRevisions: triple(draft),
      sourceFormId: draft.formId,
      targetFormId: 'CMP-005',
    },
    allow,
  );
  draft = readCampaignDraft(db, 'context', 'draft');
  const command = commitCampaignCreation(
    db,
    {
      campaignId: 'campaign',
      receiptId: 'receipt',
      createdAt: '2026-10-30T10:00:00.000Z',
      qrPayload: 'http://127.0.0.1:31770/?campaignId=campaign',
      baselineVersion: 'baseline',
      request: {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
        role: 'gm',
        commandId: 'create',
        expectedRevisions: triple(draft),
        payload: {
          stage: 'CAMPAIGN_CREATE',
          sourceFormId: 'CMP-005',
          gmLocalContextId: 'context',
          campaignDraftId: 'draft',
          draftRevision: draft.draftRevision,
          preflightLeaseId: 'lease',
        },
      },
    },
    allow,
  );
  return { db, device, command };
}
function copy(db: Database.Database, id: string, lifecycle = 'ACTIVE') {
  db.prepare('INSERT INTO campaign_character_copy VALUES (?,?,?,?,?)').run(
    id,
    'campaign',
    `source-${id}`,
    lifecycle,
    JSON.stringify({ privateHero: id, controllingDeviceStatus: 'DISCONNECTED' }),
  );
}
function change(db: Database.Database, write: () => void, projectionChanged = true) {
  return commitCampaignCheckpoint(db, 'campaign', () => {
    write();
    advanceRevisions(
      db,
      { entity: 'campaign', entityId: 'campaign' },
      { stateChanged: true, projectionChanged, actorVisibilityChanged: false },
    );
  }).checkpoint;
}
const read = (db: Database.Database) => readHostedCurrentPausedCampaign(db, 'campaign', validate);
const expectCode = (
  run: () => unknown,
  code: CampaignCreationStoreError['code'] = 'CORRUPT_STORAGE',
) => expect(run).toThrowError(new CampaignCreationStoreError(code));

describe('owned current PAUSED campaign source', () => {
  it('separates birth receipt0 from current nonzero roster and preserves the old zero-only readers', () => {
    const { db, command } = setup();
    const origin = readHostedCampaignCreationOrigin(db, 'campaign', validate);
    expect(read(db)).toMatchObject({ ...zero, activePcCount: 0 });
    const states = [
      'CANDIDATE',
      'GM_REVIEW',
      'PROPOSED',
      'ACTIVE',
      'ACTIVE',
      'DECLINED',
      'ARCHIVED',
    ];
    const checkpoint = change(db, () => states.forEach((state, i) => copy(db, `copy-${i}`, state)));
    const before = db.serialize();
    const result = read(db);
    expect(result).toEqual({
      campaignId: 'campaign',
      title: 'Exact published campaign',
      status: 'PAUSED',
      activePlayerCapacity: 5,
      activePcCount: 2,
      checkpointSha256: createHash('sha256').update(checkpoint.snapshotJson).digest('hex'),
      baselineVersion: 'baseline',
      bindConfiguration: {
        hostAddress: '127.0.0.1',
        hostPort: 31770,
        networkInterface: 'loopback',
      },
      stateRevision: 1,
      projectionRevision: 1,
      actorVisibilityRevision: 0,
    });
    expect(
      readOwnedCurrentPausedCampaign(
        db,
        { gmLocalContextId: 'context', campaignId: 'campaign' },
        validate,
      ),
    ).toEqual(result);
    expect(readHostedCampaignCreationOrigin(db, 'campaign', validate)).toEqual(origin);
    expect(origin.command).toEqual(command);
    expect(origin.command.receipt.revisions).toEqual(zero);
    expectCode(() => readPausedCampaign(db, 'context', 'campaign'));
    expectCode(() => readCampaignPrivateOwner(db, 'context', 'campaign'));
    expectCode(() => readCampaignCreationCommand(db, 'context', 'create'));
    expect(JSON.stringify(result)).not.toMatch(
      /private|salt|verifier|context|profile|source-copy|DISCONNECTED|description|commandId|receiptId/iu,
    );
    expect(db.serialize()).toEqual(before);
  });

  it('reads generic campaign vectors rather than draft-only revision rules', () => {
    const { db } = setup();
    change(db, () => copy(db, 'active'), false);
    expect(read(db)).toMatchObject({
      stateRevision: 1,
      projectionRevision: 0,
      actorVisibilityRevision: 0,
    });
    const previous = read(db);
    commitCampaignCheckpoint(db, 'campaign', () =>
      advanceRevisions(
        db,
        { entity: 'campaign', entityId: 'campaign' },
        { stateChanged: false, projectionChanged: true, actorVisibilityChanged: true },
      ),
    );
    expect(read(db)).toMatchObject({
      ...previous,
      projectionRevision: 1,
      actorVisibilityRevision: 1,
    });
    expect(read(db).checkpointSha256).toBe(previous.checkpointSha256);
  });

  it('reopens the same exact campaign and never chooses a different current GM context', () => {
    const directory = mkdtempSync(join(tmpdir(), 'current-campaign-'));
    directories.push(directory);
    const filename = join(directory, 'campaign.sqlite');
    const { db, device } = setup(filename);
    change(db, () => copy(db, 'active'));
    const expected = read(db);
    createLocalGmContext(
      db,
      { gmLocalContextId: 'new-menu-context', masterProfileId: 'profile', ownerDeviceId: device },
      allow,
    );
    db.close();
    const reopened = open(filename);
    expect(read(reopened)).toEqual(expected);
    expectCode(
      () =>
        readOwnedCurrentPausedCampaign(
          reopened,
          { gmLocalContextId: 'new-menu-context', campaignId: 'campaign' },
          validate,
        ),
      'FOREIGN_OWNER',
    );
    expectCode(
      () => readHostedCurrentPausedCampaign(reopened, 'other-campaign', validate),
      'NOT_FOUND',
    );
  });

  it('rejects old campaign ownership after reset instead of rebinding it to the new device', () => {
    const { db } = setup();
    resetDeviceIdentity(db, allow);
    bootstrapDeviceIdentity(db);
    const before = db.serialize();
    expectCode(() => read(db), 'FOREIGN_OWNER');
    expect(db.serialize()).toEqual(before);
  });

  it('rejects extra scope claims and accessors without evaluating them', () => {
    const { db } = setup();
    const getter = vi.fn(() => 'context');
    const scope = { gmLocalContextId: 'context', campaignId: 'campaign' };
    Object.defineProperty(scope, 'gmLocalContextId', { get: getter });
    expectCode(() => readOwnedCurrentPausedCampaign(db, scope, validate), 'INVALID_INPUT');
    expect(getter).not.toHaveBeenCalled();
    const extra = { gmLocalContextId: 'context', campaignId: 'campaign', role: 'gm' };
    expectCode(() => readOwnedCurrentPausedCampaign(db, extra, validate), 'INVALID_INPUT');
  });

  it.each([
    'owner-hash',
    'proof-hash',
    'journal-hash',
    'journal-receipt',
    'sealed-draft',
    'stale-root',
    'stale-copy',
    'checkpoint',
  ] as const)(
    'refuses corrupted %s without exposing private diagnostics or changing rows',
    (damage) => {
      const { db } = setup();
      change(db, () => copy(db, 'active'));
      if (damage === 'owner-hash')
        db.prepare('UPDATE campaign_private_owner SET record_sha256=?').run('0'.repeat(64));
      if (damage === 'proof-hash')
        db.prepare('UPDATE campaign_private_owner SET verifier_sha256=?').run('0'.repeat(64));
      if (damage === 'journal-hash')
        db.prepare('UPDATE campaign_creation_command SET journal_sha256=?').run('0'.repeat(64));
      if (damage === 'journal-receipt') {
        const row = db
          .prepare<[], { request_json: string; receipt_json: string }>(
            'SELECT request_json,receipt_json FROM campaign_creation_command',
          )
          .get()!;
        const receipt = JSON.parse(row.receipt_json) as { revisions: typeof zero };
        receipt.revisions.stateRevision = 1;
        db.prepare('UPDATE campaign_creation_command SET receipt_json=?,journal_sha256=?').run(
          canonical(receipt),
          campaignCreationHash({ request: JSON.parse(row.request_json) as unknown, receipt }),
        );
      }
      if (damage === 'sealed-draft') {
        const row = db
          .prepare<[], { record_json: string }>('SELECT record_json FROM campaign_draft')
          .get()!;
        const draft = JSON.parse(row.record_json) as {
          draftRevision: number;
          stateRevision: number;
          projectionRevision: number;
        };
        draft.draftRevision += 1;
        draft.stateRevision += 1;
        draft.projectionRevision += 1;
        db.prepare('UPDATE campaign_draft SET record_json=?,record_sha256=?').run(
          canonical(draft),
          campaignCreationHash(draft),
        );
      }
      if (damage === 'stale-root') db.prepare("UPDATE campaign SET payload_json='{}'").run();
      if (damage === 'stale-copy')
        db.prepare("UPDATE campaign_character_copy SET payload_json='{}'").run();
      if (damage === 'checkpoint')
        db.prepare("UPDATE campaign_checkpoint SET snapshot_json='{}'").run();
      const before = db.serialize();
      expectCode(() => read(db));
      expect(db.serialize()).toEqual(before);
    },
  );

  it.each(['HOSTING', 'COMPLETED', 'IMMUTABLE_ARCHIVE', 'DRAFT', 'PREFLIGHT'])(
    'rejects coherent unsupported campaign state %s',
    (state) => {
      const { db } = setup();
      change(db, () => db.prepare('UPDATE campaign SET lifecycle_state=?').run(state));
      expectCode(() => read(db));
    },
  );

  it('rejects a coherent changed setting instead of rewriting the immutable creation proof', () => {
    const { db } = setup();
    const origin = readHostedCampaignCreationOrigin(db, 'campaign', validate);
    change(db, () =>
      db.prepare('UPDATE campaign SET payload_json=?').run(
        canonical({
          ...origin.payload,
          host: { ...origin.payload.host, activePlayerCapacity: 4 },
        }),
      ),
    );
    expectCode(() => read(db));
    expect(readHostedCampaignCreationOrigin(db, 'campaign', validate)).toEqual(origin);
  });

  it('refuses unknown CPC lifecycle and capacity overflow without silently counting them as zero', () => {
    const { db } = setup();
    db.pragma('ignore_check_constraints = ON');
    change(db, () => copy(db, 'unknown', 'ACTIVE_PENDING_BLOCKERS'));
    db.pragma('ignore_check_constraints = OFF');
    expectCode(() => read(db));
    change(db, () => {
      db.prepare('DELETE FROM campaign_character_copy').run();
      for (let i = 0; i < 6; i += 1) copy(db, `overflow-${i}`);
    });
    expectCode(() => read(db));
  });

  it('uses one read snapshot while another SQLite connection commits a new roster', () => {
    const directory = mkdtempSync(join(tmpdir(), 'current-campaign-snapshot-'));
    directories.push(directory);
    const filename = join(directory, 'campaign.sqlite');
    const { db } = setup(filename);
    const second = open(filename);
    const old = read(db);
    const result = readHostedCurrentPausedCampaign(db, 'campaign', (owner) => {
      validate(owner);
      expect(db.inTransaction).toBe(true);
      // Fault scheduling: the independent writer commits after the reader snapshot is pinned.
      change(second, () => copy(second, 'concurrent'));
    });
    expect(result).toEqual(old);
    expect(read(db)).toMatchObject({ activePcCount: 1, stateRevision: 1, projectionRevision: 1 });
  });

  it('participates in an existing transaction without committing caller writes', () => {
    const { db } = setup();
    db.exec('CREATE TABLE caller_marker(id TEXT)');
    const before = db.serialize();
    expect(() =>
      db
        .transaction(() => {
          db.prepare('INSERT INTO caller_marker VALUES (?)').run('pending');
          expect(read(db).activePcCount).toBe(0);
          expect(db.inTransaction).toBe(true);
          throw new Error('caller rollback');
        })
        .immediate(),
    ).toThrow('caller rollback');
    expect(db.serialize()).toEqual(before);
    expect(loadCampaignCheckpoint(db, 'campaign').stateRevision).toBe(0);
  });

  it.each(['write', 'schema', 'pragma', 'COMMIT', 'ROLLBACK'] as const)(
    'refuses a trusted validator contract violation (%s)',
    (kind) => {
      const { db } = setup();
      const before = db.serialize();
      expectCode(
        () =>
          readHostedCurrentPausedCampaign(db, 'campaign', () => {
            if (kind === 'write') db.prepare("UPDATE campaign SET payload_json='{}'").run();
            else if (kind === 'schema') db.exec('CREATE TABLE forbidden(id TEXT)');
            else if (kind === 'pragma') db.pragma('user_version = 99');
            else db.exec(kind);
          }),
        'SOURCE_CHANGED',
      );
      expect(db.serialize()).toEqual(before);
    },
  );

  it('sanitizes invalid callback results and rejected native Promises without leaking private reasons', async () => {
    const { db } = setup();
    const before = db.serialize();
    const then = vi.fn(() => {
      throw new Error('private-salt');
    });
    const thenable = Object.defineProperty({}, 'then', { get: then });
    const callbacks: unknown[] = [
      () => Promise.reject(new Error('private-salt')),
      () => {
        const rejected: unknown = Promise.reject(new Error('private-salt'));
        throw rejected;
      },
      () => thenable,
      () => {
        throw new Error('private-salt');
      },
    ];
    for (const callback of callbacks)
      expectCode(
        () => Reflect.apply(readHostedCurrentPausedCampaign, undefined, [db, 'campaign', callback]),
        'INVALID_INPUT',
      );
    await setImmediate();
    expect(then).not.toHaveBeenCalled();
    expect(db.serialize()).toEqual(before);
    expect(
      readCampaignCreationOrigin(db, 'context', 'campaign', validate).command.receipt.revisions,
    ).toEqual(zero);
  });
});
