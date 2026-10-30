import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPersistenceDatabase } from './database.js';
import { bootstrapDeviceIdentity, resetDeviceIdentity } from './device-identity.js';
import { applyMigrations, applyMigrationSequence } from './migrations/index.js';
import { migration0001 } from './migrations/0001-initial.js';
import { migration0002 } from './migrations/0002-local-character-checkpoint.js';
import { migration0003 } from './migrations/0003-device-identity.js';
import { migration0004 } from './migrations/0004-skill-presentation.js';
import { migration0005 } from './migrations/0005-symbiont-presentation.js';
import { migration0006 } from './migrations/0006-local-character-post-save.js';
import { migration0007 } from './migrations/0007-campaign-creation.js';
import { migration0008 } from './migrations/0008-network-installation-identity.js';
import { migration0009 } from './migrations/0009-device-admission.js';
import { migration0010 } from './migrations/0010-network-application.js';
import { DEVICE_REQUEST_REVIEW_TABLES } from './migrations/0011-device-request-review.js';
import {
  ensureLocalGmProfile,
  createLocalGmContext,
  readCampaignCreationCursor,
} from './campaign-creation.js';
import { LOCAL_NETWORK_TAB_TABLES } from './migrations/0009-device-admission.js';
import {
  commitLocalNetworkTabEntry,
  commitLocalNetworkTabClose,
  readOwnedLocalNetworkTab,
  readActiveLocalNetworkTab,
  readLocalNetworkTabEntryByCommandId,
  readLocalNetworkTabCloseByCommandId,
  readLocalNetworkTabClosure,
  LocalNetworkTabStoreError,
  type LocalNetworkTab,
  type LocalNetworkTabEntryInput,
  type LocalNetworkTabStoreCode,
  type LocalNetworkTabCloseInput,
  type StoredLocalNetworkTabEntry,
} from './network-local-tab.js';

const databases: Database.Database[] = [];
const directories: string[] = [];
const allow = () => undefined;
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
const open = (filename = ':memory:') => {
  const db = openPersistenceDatabase(filename);
  databases.push(db);
  return db;
};
const file = () => {
  const directory = mkdtempSync(join(tmpdir(), 'network-tab-'));
  directories.push(directory);
  return join(directory, 'local.sqlite');
};
function request(ownerDeviceId: string): LocalNetworkTabEntryInput {
  return {
    entryCommandId: randomUUID(),
    entryReceiptId: randomUUID(),
    ownerDeviceId,
    sourceContextId: randomUUID(),
    sourceRevisions: { stateRevision: 2, projectionRevision: 4, actorVisibilityRevision: 1 },
    tabId: randomUUID(),
    networkScopeId: randomUUID(),
  };
}
function legacyDatabase(version: 8 | 9 | 10): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  databases.push(db);
  applyMigrationSequence(db, [
    migration0001,
    migration0002,
    migration0003,
    migration0004,
    migration0005,
    migration0006,
    migration0007,
    migration0008,
    ...(version >= 9 ? [migration0009] : []),
    ...(version === 10 ? [migration0010] : []),
  ]);
  return db;
}
function setup(filename = ':memory:', legacy = false) {
  const db = legacy ? legacyDatabase(9) : open(filename),
    device = bootstrapDeviceIdentity(db);
  return { db, device, input: request(device) };
}
function expectCode(run: () => unknown, code: LocalNetworkTabStoreCode) {
  expect(run).toThrowError(new LocalNetworkTabStoreError(code));
}
function writeCurrentFixture(db: Database.Database, tab: LocalNetworkTab) {
  const record = { ...tab, retirementCommandIdOrNull: null };
  db.prepare(
    'UPDATE local_network_tab SET lifecycle_state=?,record_json=?,record_sha256=? WHERE network_scope_id=?',
  ).run(tab.lifecycleState, canonical(record), sha(canonical(record)), tab.networkScopeId);
}
function live(entry: StoredLocalNetworkTabEntry): LocalNetworkTab {
  expect(entry.currentTab).not.toBeNull();
  return entry.currentTab!;
}
function closeInput(entry: StoredLocalNetworkTabEntry): LocalNetworkTabCloseInput {
  const tab = live(entry);
  return {
    closeCommandId: randomUUID(),
    closeReceiptId: randomUUID(),
    ownerDeviceId: tab.ownerDeviceId,
    networkScopeId: tab.networkScopeId,
    expectedRevisions: {
      stateRevision: tab.stateRevision,
      projectionRevision: tab.projectionRevision,
      actorVisibilityRevision: tab.actorVisibilityRevision,
    },
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('durable local network tab entry', () => {
  it('binds the exact application entry and source FINAL before the first application event and preserves it after reopen', () => {
    const path = file(),
      { db, device, input } = setup(path);
    const client = {
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: input.entryCommandId,
      sourceFormId: 'CHR-040',
      actionKey: 'CHR-040::CTA::002',
      expectedProjectionRevision: input.sourceRevisions.projectionRevision,
    };
    const request: LocalNetworkTabEntryInput = {
      ...input,
      applicationEntry: {
        schemaVersion: 1,
        clientRequestJson: canonical(client),
        sourceFinalUuidOrNull: 'final-source-a',
      },
    };
    const saved = commitLocalNetworkTabEntry(db, request, allow);
    expect(db.prepare('SELECT COUNT(*) AS n FROM local_network_application_event').get()).toEqual({
      n: 0,
    });
    db.close();
    const reopened = open(path);
    expect(readLocalNetworkTabEntryByCommandId(reopened, device, input.entryCommandId)).toEqual(
      saved,
    );
    const before = reopened.serialize();
    expect(commitLocalNetworkTabEntry(reopened, request, allow)).toEqual(saved);
    for (const applicationEntry of [
      { ...request.applicationEntry!, sourceFinalUuidOrNull: 'final-source-b' },
      {
        ...request.applicationEntry!,
        sourceFinalUuidOrNull: null,
        clientRequestJson: canonical({
          ...client,
          sourceFormId: 'APP-002',
          actionKey: 'APP-002::CTA::003',
        }),
      },
    ])
      expectCode(
        () => commitLocalNetworkTabEntry(reopened, { ...request, applicationEntry }, allow),
        'IDEMPOTENCY_CONFLICT',
      );
    expect(reopened.serialize().equals(before)).toBe(true);
  });
  it('rejects app entry metadata on real schema9 and preserves the original optional-free entry bytes', () => {
    const { db, device, input } = setup(':memory:', true);
    const before = db.serialize();
    expectCode(
      () =>
        commitLocalNetworkTabEntry(
          db,
          {
            ...input,
            applicationEntry: {
              schemaVersion: 1,
              sourceFinalUuidOrNull: null,
              clientRequestJson: canonical({
                messageType: 'navigation.form-action',
                protocolVersion: 2,
                navigationRequestId: input.entryCommandId,
                sourceFormId: 'APP-002',
                actionKey: 'APP-002::CTA::003',
                expectedProjectionRevision: input.sourceRevisions.projectionRevision,
              }),
            },
          },
          allow,
        ),
      'INVALID_INPUT',
    );
    expect(db.serialize().equals(before)).toBe(true);
    const saved = commitLocalNetworkTabEntry(db, input, allow);
    expect(saved.request).not.toHaveProperty('applicationEntry');
    expect(db.prepare('SELECT request_json FROM local_network_tab_entry').get()).toEqual({
      request_json: canonical(input),
    });
    expect(readLocalNetworkTabEntryByCommandId(db, device, input.entryCommandId)).toEqual(saved);
  });
  it('does not allocate on read and atomically writes UNBOUND, entry receipt and an exact active pointer', () => {
    const { db, device, input } = setup();
    const before = db.serialize();
    expect(readActiveLocalNetworkTab(db, device)).toBeNull();
    expectCode(() => readOwnedLocalNetworkTab(db, device, input.networkScopeId), 'NOT_FOUND');
    expect(readLocalNetworkTabEntryByCommandId(db, device, input.entryCommandId)).toBeNull();
    expect(db.serialize().equals(before)).toBe(true);
    const guard = vi.fn((phase) => {
      expect(phase).toBe('APPLY');
      expect(db.inTransaction).toBe(true);
      expect(readActiveLocalNetworkTab(db, device)).toBeNull();
    });
    const result = commitLocalNetworkTabEntry(db, input, guard);
    expect(guard).toHaveBeenCalledOnce();
    expect(result.request).toEqual(input);
    expect(result.currentTab).toEqual({
      schemaVersion: 1,
      ownerDeviceId: device,
      tabId: input.tabId,
      networkScopeId: input.networkScopeId,
      entryCommandId: input.entryCommandId,
      entryReceiptId: input.entryReceiptId,
      lifecycleState: 'UNBOUND',
      ...zero,
    });
    expect(result.receipt).toEqual({
      entryCommandId: input.entryCommandId,
      entryReceiptId: input.entryReceiptId,
      sourceContextId: input.sourceContextId,
      sourceRevisions: input.sourceRevisions,
      tabId: input.tabId,
      networkScopeId: input.networkScopeId,
      revisions: zero,
    });
    expect(readActiveLocalNetworkTab(db, device)).toEqual(result.currentTab);
    expect(readOwnedLocalNetworkTab(db, device, input.networkScopeId)).toEqual(result.currentTab);
    for (const table of [
      'campaign',
      'campaign_character_copy',
      'local_character',
      'device_installation_identity',
      'local_gm_context',
    ])
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
  });

  it('counts all three owned UNBOUND/PROVISIONAL tabs and rejects a fourth without writes', () => {
    const { db, device, input } = setup(undefined, true);
    const first = commitLocalNetworkTabEntry(db, input, allow);
    writeCurrentFixture(db, {
      ...live(first),
      lifecycleState: 'PROVISIONAL',
      stateRevision: 1,
      projectionRevision: 1,
    });
    commitLocalNetworkTabEntry(db, request(device), allow);
    const third = commitLocalNetworkTabEntry(db, request(device), allow);
    const before = db.serialize();
    expectCode(() => commitLocalNetworkTabEntry(db, request(device), allow), 'TAB_LIMIT');
    expect(db.serialize().equals(before)).toBe(true);
    expect(readActiveLocalNetworkTab(db, device)).toEqual(third.currentTab);
    expect(db.prepare('SELECT count(*) AS n FROM local_network_tab').get()).toEqual({ n: 3 });
  });

  it('replays immutable entry receipt with the advanced current tab and never rotates a newer active pointer', () => {
    const { db, device, input } = setup(undefined, true);
    const first = commitLocalNetworkTabEntry(db, input, allow);
    const advanced: LocalNetworkTab = {
      ...live(first),
      lifecycleState: 'PROVISIONAL',
      stateRevision: 2,
      projectionRevision: 5,
      actorVisibilityRevision: 1,
    };
    writeCurrentFixture(db, advanced);
    const second = commitLocalNetworkTabEntry(db, request(device), allow);
    const before = db.serialize(),
      guard = vi.fn(allow);
    expect(commitLocalNetworkTabEntry(db, input, guard)).toEqual({
      ...first,
      currentTab: advanced,
    });
    expect(guard).toHaveBeenCalledExactlyOnceWith('REPLAY');
    expect(readLocalNetworkTabEntryByCommandId(db, device, input.entryCommandId)).toEqual({
      ...first,
      currentTab: advanced,
    });
    expect(readActiveLocalNetworkTab(db, device)).toEqual(second.currentTab);
    expect(db.serialize().equals(before)).toBe(true);
  });

  it('does not hide an owned inactive tab from the count when its duplicated owner index is corrupt', () => {
    const { db, device, input } = setup();
    commitLocalNetworkTabEntry(db, input, allow);
    const active = commitLocalNetworkTabEntry(db, request(device), allow);
    db.prepare('UPDATE local_network_tab SET owner_device_id=? WHERE network_scope_id=?').run(
      randomUUID(),
      input.networkScopeId,
    );
    const before = db.serialize();
    expect(readActiveLocalNetworkTab(db, device)).toEqual(active.currentTab);
    expectCode(() => commitLocalNetworkTabEntry(db, request(device), allow), 'FOREIGN_OWNER');
    expect(db.serialize().equals(before)).toBe(true);
  });

  it('reopens the exact pointer and reconciles the winning journal from another connection', () => {
    const filename = file(),
      { db, device, input } = setup(filename);
    const second = open(filename);
    expect(readLocalNetworkTabEntryByCommandId(db, device, input.entryCommandId)).toBeNull();
    const saved = commitLocalNetworkTabEntry(second, input, allow);
    const guard = vi.fn(allow);
    expect(commitLocalNetworkTabEntry(db, input, guard)).toEqual(saved);
    expect(guard).toHaveBeenCalledExactlyOnceWith('REPLAY');
    db.close();
    second.close();
    const reopened = open(filename),
      before = reopened.serialize();
    expect(readActiveLocalNetworkTab(reopened, device)).toEqual(saved.currentTab);
    expect(readLocalNetworkTabEntryByCommandId(reopened, device, input.entryCommandId)).toEqual(
      saved,
    );
    expect(reopened.serialize().equals(before)).toBe(true);
  });

  it.each([
    'entryReceiptId',
    'sourceContextId',
    'tabId',
    'networkScopeId',
    'sourceRevisions',
  ] as const)('rejects changed same-command %s before invoking the source guard', (field) => {
    const { db, input } = setup();
    commitLocalNetworkTabEntry(db, input, allow);
    const before = db.serialize(),
      guard = vi.fn(allow);
    const changed = { ...input, [field]: field === 'sourceRevisions' ? zero : randomUUID() };
    expectCode(() => commitLocalNetworkTabEntry(db, changed, guard), 'IDEMPOTENCY_CONFLICT');
    expect(guard).not.toHaveBeenCalled();
    expect(db.serialize().equals(before)).toBe(true);
  });

  it.each(['entryCommandId', 'entryReceiptId', 'tabId', 'networkScopeId'] as const)(
    'rejects reuse of a durable %s by another entry without partial allocation',
    (field) => {
      const { db, device, input } = setup();
      commitLocalNetworkTabEntry(db, input, allow);
      const before = db.serialize();
      expectCode(
        () => commitLocalNetworkTabEntry(db, { ...request(device), [field]: input[field] }, allow),
        'IDEMPOTENCY_CONFLICT',
      );
      expect(db.serialize().equals(before)).toBe(true);
    },
  );

  it('keeps old-owner tabs inaccessible after reset and does not count or rebind them for the new device', () => {
    const { db, device, input } = setup();
    commitLocalNetworkTabEntry(db, input, allow);
    resetDeviceIdentity(db, allow);
    expectCode(() => readActiveLocalNetworkTab(db, device), 'OWNER_UNAVAILABLE');
    const next = bootstrapDeviceIdentity(db),
      before = db.serialize();
    expect(readActiveLocalNetworkTab(db, next)).toBeNull();
    expectCode(() => readOwnedLocalNetworkTab(db, next, input.networkScopeId), 'FOREIGN_OWNER');
    expectCode(
      () => readLocalNetworkTabEntryByCommandId(db, next, input.entryCommandId),
      'FOREIGN_OWNER',
    );
    expectCode(() => commitLocalNetworkTabEntry(db, input, allow), 'FOREIGN_OWNER');
    expect(db.serialize().equals(before)).toBe(true);
    const fresh = commitLocalNetworkTabEntry(db, request(next), allow);
    expect(readActiveLocalNetworkTab(db, next)).toEqual(fresh.currentTab);
    expect(db.prepare('SELECT count(*) AS n FROM local_network_tab').get()).toEqual({ n: 2 });
  });

  it('rejects malformed or colliding input identities and revisions before writes', () => {
    const { db, input } = setup();
    const before = db.serialize(),
      guard = vi.fn(allow);
    for (const change of [
      { tabId: 'not-uuid' },
      { networkScopeId: input.ownerDeviceId },
      { tabId: input.sourceContextId },
      { networkScopeId: input.tabId },
      { entryCommandId: '' },
      { entryReceiptId: input.entryCommandId },
      { sourceRevisions: { ...zero, stateRevision: Number.MAX_SAFE_INTEGER + 1 } },
      { sourceRevisions: { ...zero, projectionRevision: -1 } },
      { unexpected: true },
    ])
      expectCode(
        () => commitLocalNetworkTabEntry(db, { ...input, ...change }, guard),
        'INVALID_INPUT',
      );
    const getter = vi.fn(() => input.tabId),
      forged = { ...input };
    Object.defineProperty(forged, 'tabId', { get: getter });
    expectCode(() => commitLocalNetworkTabEntry(db, forged, guard), 'INVALID_INPUT');
    expect(getter).not.toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
    expect(db.serialize().equals(before)).toBe(true);
  });

  it.each([
    'tab-hash',
    'tab-index',
    'journal-hash',
    'receipt-vector',
    'request-extra',
    'pointer-hash',
    'pointer-missing',
    'pointer-index',
    'current-overflow',
  ] as const)('fails closed on durable %s corruption', (damage) => {
    const { db, device, input } = setup();
    const saved = commitLocalNetworkTabEntry(db, input, allow);
    if (damage === 'tab-hash')
      db.prepare('UPDATE local_network_tab SET record_sha256=?').run('0'.repeat(64));
    if (damage === 'tab-index')
      db.prepare("UPDATE local_network_tab SET lifecycle_state='PROVISIONAL'").run();
    if (damage === 'journal-hash')
      db.prepare('UPDATE local_network_tab_entry SET journal_sha256=?').run('0'.repeat(64));
    if (damage === 'receipt-vector' || damage === 'request-extra') {
      const request = damage === 'request-extra' ? { ...input, unexpected: true } : input;
      const receipt =
        damage === 'receipt-vector'
          ? { ...saved.receipt, revisions: { ...zero, projectionRevision: 1 } }
          : saved.receipt;
      db.prepare(
        'UPDATE local_network_tab_entry SET request_json=?,receipt_json=?,journal_sha256=?',
      ).run(canonical(request), canonical(receipt), sha(canonical({ request, receipt })));
    }
    if (damage === 'pointer-hash')
      db.prepare('UPDATE local_network_active_tab SET record_sha256=?').run('0'.repeat(64));
    if (damage === 'pointer-missing') db.prepare('DELETE FROM local_network_active_tab').run();
    if (damage === 'pointer-index') {
      const second = commitLocalNetworkTabEntry(db, request(device), allow);
      db.prepare('UPDATE local_network_active_tab SET network_scope_id=?').run(
        input.networkScopeId,
      );
      expect(live(second).networkScopeId).not.toBe(input.networkScopeId);
    }
    if (damage === 'current-overflow')
      writeCurrentFixture(db, {
        ...live(saved),
        projectionRevision: Number.MAX_SAFE_INTEGER + 1,
      });
    const before = db.serialize();
    expectCode(() => readActiveLocalNetworkTab(db, device), 'CORRUPT_STORAGE');
    if (!damage.startsWith('pointer')) {
      expectCode(
        () => readOwnedLocalNetworkTab(db, device, input.networkScopeId),
        'CORRUPT_STORAGE',
      );
      expectCode(() => commitLocalNetworkTabEntry(db, input, allow), 'CORRUPT_STORAGE');
    }
    expectCode(() => commitLocalNetworkTabEntry(db, request(device), allow), 'CORRUPT_STORAGE');
    expect(db.serialize().equals(before)).toBe(true);
  });

  it.each(['abort-entry', 'mutate-tab', 'extra-write'] as const)(
    'rolls back %s after a partial insert, including the old active pointer',
    (fault) => {
      const { db, device, input } = setup();
      const first = commitLocalNetworkTabEntry(db, input, allow);
      const body =
        fault === 'abort-entry'
          ? "SELECT RAISE(ABORT,'private-trigger-marker')"
          : fault === 'mutate-tab'
            ? "UPDATE local_network_tab SET lifecycle_state='PROVISIONAL' WHERE network_scope_id=NEW.network_scope_id"
            : "INSERT INTO campaign(campaign_id,lifecycle_state,payload_json) VALUES('unexpected','PAUSED','{}')";
      db.exec(
        `CREATE TRIGGER reject_entry AFTER INSERT ON local_network_tab_entry BEGIN ${body}; END`,
      );
      const before = db.serialize();
      expectCode(
        () => commitLocalNetworkTabEntry(db, request(device), allow),
        fault === 'abort-entry' ? 'CORRUPT_STORAGE' : 'SOURCE_CHANGED',
      );
      expect(db.serialize().equals(before)).toBe(true);
      expect(readActiveLocalNetworkTab(db, device)).toEqual(first.currentTab);
    },
  );

  it.each(['DML', 'DDL', 'PRAGMA', 'COMMIT', 'ROLLBACK'] as const)(
    'refuses read-only guard violation %s before creating a tab',
    (fault) => {
      const { db, device, input } = setup();
      const before = db.serialize();
      expectCode(
        () =>
          commitLocalNetworkTabEntry(db, input, () => {
            if (fault === 'DML')
              db.prepare(
                "INSERT INTO campaign(campaign_id,lifecycle_state,payload_json) VALUES('forbidden','PAUSED','{}')",
              ).run();
            else if (fault === 'DDL') db.exec('CREATE TABLE forbidden(id TEXT)');
            else if (fault === 'PRAGMA') db.pragma('user_version=99');
            else db.exec(fault);
          }),
        'SOURCE_CHANGED',
      );
      expect(readActiveLocalNetworkTab(db, device)).toBeNull();
      expect(db.serialize().equals(before)).toBe(true);
    },
  );

  it('rejects nested and asynchronous guards, consumes native rejection, and never reads unknown thenables', async () => {
    const { db, input } = setup();
    const before = db.serialize();
    expectCode(
      () => db.transaction(() => commitLocalNetworkTabEntry(db, input, allow)).immediate(),
      'INVALID_INPUT',
    );
    const getter = vi.fn(() => {
      throw new Error('private-marker');
    });
    const thenable = Object.defineProperty({}, 'then', { get: getter });
    const callbacks: unknown[] = [
      () => Promise.reject(new Error('private-marker')),
      () => {
        const rejected: unknown = Promise.reject(new Error('private-marker'));
        throw rejected;
      },
      () => thenable,
      vi.fn(async () => {
        await Promise.resolve();
        throw new Error('private-marker');
      }),
    ];
    for (const callback of callbacks)
      expectCode(
        () => Reflect.apply(commitLocalNetworkTabEntry, undefined, [db, input, callback]),
        'INVALID_INPUT',
      );
    await setImmediate();
    expect(getter).not.toHaveBeenCalled();
    expect(db.serialize().equals(before)).toBe(true);
  });

  it('upgrades actual schema8 without rewriting rows or allocating a tab', () => {
    const db = legacyDatabase(8),
      device = bootstrapDeviceIdentity(db);
    db.prepare(
      "INSERT INTO campaign(campaign_id,lifecycle_state,payload_json) VALUES('preserved','PAUSED','{}')",
    ).run();
    const registry = db.prepare('SELECT * FROM schema_migration ORDER BY version').all(),
      campaign = db.prepare('SELECT * FROM campaign').all();
    expect(applyMigrations(db)).toBe(11);
    expect(
      db.prepare('SELECT * FROM schema_migration WHERE version<=8 ORDER BY version').all(),
    ).toEqual(registry);
    expect(db.prepare('SELECT * FROM campaign').all()).toEqual(campaign);
    expect(readActiveLocalNetworkTab(db, device)).toBeNull();
    for (const table of LOCAL_NETWORK_TAB_TABLES)
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
  });
  it('upgrades a real schema9 entry/close history to10 without modifying those receipts or allocating application state', () => {
    const db = legacyDatabase(9),
      device = bootstrapDeviceIdentity(db);
    const first = commitLocalNetworkTabEntry(db, request(device), allow);
    const second = commitLocalNetworkTabEntry(db, request(device), allow);
    const closed = commitLocalNetworkTabClose(db, closeInput(first), allow);
    const entries = db
      .prepare('SELECT * FROM local_network_tab_entry ORDER BY entry_command_id')
      .all();
    const closes = db.prepare('SELECT * FROM local_network_tab_close').all();
    expect(applyMigrations(db)).toBe(11);
    expect(
      db.prepare('SELECT * FROM local_network_tab_entry ORDER BY entry_command_id').all(),
    ).toEqual(entries);
    expect(db.prepare('SELECT * FROM local_network_tab_close').all()).toEqual(closes);
    expect(
      readLocalNetworkTabEntryByCommandId(db, device, first.request.entryCommandId),
    ).toMatchObject({ currentTab: null, closureReceiptOrNull: closed.receipt });
    expect(readActiveLocalNetworkTab(db, device)).toEqual(second.currentTab);
    expect(db.prepare('SELECT * FROM local_network_application').all()).toEqual([]);
  });

  it.each([
    'missing-tab',
    'missing-entry',
    'missing-close',
    'missing-pointer',
    'missing-review-table',
    'old-version',
    'future-version',
  ] as const)('refuses %s without creating fallback storage', (fault) => {
    const { db, device, input } = setup();
    if (fault === 'missing-tab') db.exec('DROP TABLE local_network_tab');
    else if (fault === 'missing-entry') db.exec('DROP TABLE local_network_tab_entry');
    else if (fault === 'missing-close') db.exec('DROP TABLE local_network_tab_close');
    else if (fault === 'missing-pointer') db.exec('DROP TABLE local_network_active_tab');
    else if (fault === 'missing-review-table') db.exec('DROP TABLE gm_request_queue_event');
    else if (fault === 'old-version')
      db.prepare('DELETE FROM schema_migration WHERE version>=9').run();
    else db.prepare('UPDATE schema_migration SET version=12 WHERE version=11').run();
    const before = db.serialize();
    expectCode(() => readActiveLocalNetworkTab(db, device), 'CORRUPT_STORAGE');
    expectCode(() => commitLocalNetworkTabEntry(db, input, allow), 'CORRUPT_STORAGE');
    expect(db.serialize().equals(before)).toBe(true);
  });
});

describe('audited closure of a never-admitted network tab', () => {
  it('atomically binds an application exit and recovers the exact target after reopen', () => {
    const path = file(),
      { db, device, input } = setup(path);
    const entry = commitLocalNetworkTabEntry(db, input, allow);
    expect(readLocalNetworkTabClosure(db, device, input.networkScopeId)).toBeNull();
    const close: LocalNetworkTabCloseInput = {
      ...closeInput(entry),
      applicationExit: {
        schemaVersion: 1,
        clientRequestJson: canonical({
          navigationRequestId: 'exit-original',
          sourceFormId: 'NET-001',
        }),
        target: { kind: 'PLAYER_MENU' },
      },
    };
    const saved = commitLocalNetworkTabClose(db, close, allow);
    db.close();
    const reopened = open(path);
    expect(readLocalNetworkTabClosure(reopened, device, input.networkScopeId)).toEqual(saved);
    expect(readOwnedLocalNetworkTab(reopened, device, input.networkScopeId)).toBeNull();
    expect(commitLocalNetworkTabClose(reopened, close, allow)).toEqual(saved);
    const before = reopened.serialize();
    expectCode(
      () =>
        commitLocalNetworkTabClose(
          reopened,
          {
            ...close,
            applicationExit: {
              ...close.applicationExit!,
              target: { kind: 'LOCAL_FINAL', sourceUuid: 'changed-source' },
            },
          },
          allow,
        ),
      'IDEMPOTENCY_CONFLICT',
    );
    expect(reopened.serialize().equals(before)).toBe(true);
  });
  it('refuses application exit metadata in actual schema9 without altering old closure journals', () => {
    const { db, device, input } = setup(':memory:', true),
      entry = commitLocalNetworkTabEntry(db, input, allow);
    const old = closeInput(entry),
      before = db.serialize();
    expectCode(
      () =>
        commitLocalNetworkTabClose(
          db,
          {
            ...old,
            applicationExit: {
              schemaVersion: 1,
              clientRequestJson: '{}',
              target: { kind: 'PLAYER_MENU' },
            },
          },
          allow,
        ),
      'INVALID_INPUT',
    );
    expect(db.serialize().equals(before)).toBe(true);
    const saved = commitLocalNetworkTabClose(db, old, allow);
    expect(saved.request).not.toHaveProperty('applicationExit');
    expect(readLocalNetworkTabClosure(db, device, input.networkScopeId)).toEqual(saved);
  });
  it('releases capacity, persists explicit NONE, reopens the receipt and never reselects or reuses a retired tab', () => {
    const filename = file(),
      { db, device, input } = setup(filename);
    const first = commitLocalNetworkTabEntry(db, input, allow);
    commitLocalNetworkTabEntry(db, request(device), allow);
    const selected = commitLocalNetworkTabEntry(db, request(device), allow);
    const close = closeInput(selected),
      guard = vi.fn(allow);
    expect(readLocalNetworkTabCloseByCommandId(db, device, close.closeCommandId)).toBeNull();
    const closed = commitLocalNetworkTabClose(db, close, guard);
    expect(guard).toHaveBeenCalledExactlyOnceWith('APPLY');
    expect(closed.receipt).toEqual({
      closeCommandId: close.closeCommandId,
      closeReceiptId: close.closeReceiptId,
      ownerDeviceId: device,
      tabId: selected.request.tabId,
      networkScopeId: selected.request.networkScopeId,
      sourceRevisions: zero,
      revisions: { stateRevision: 1, projectionRevision: 1, actorVisibilityRevision: 0 },
      activePointerCleared: true,
      result: 'CLOSED',
    });
    expect(readActiveLocalNetworkTab(db, device)).toBeNull();
    expect(readOwnedLocalNetworkTab(db, device, close.networkScopeId)).toBeNull();
    const closedEntry = { ...selected, currentTab: null, closureReceiptOrNull: closed.receipt };
    expect(commitLocalNetworkTabEntry(db, selected.request, allow)).toEqual(closedEntry);
    expect(db.prepare('SELECT count(*) AS n FROM local_network_tab').get()).toEqual({ n: 3 });
    expect(db.prepare('SELECT count(*) AS n FROM local_network_tab_entry').get()).toEqual({ n: 3 });
    db.close();
    const reopened = open(filename),
      before = reopened.serialize();
    expect(readActiveLocalNetworkTab(reopened, device)).toBeNull();
    expect(
      readLocalNetworkTabEntryByCommandId(reopened, device, selected.request.entryCommandId),
    ).toEqual(closedEntry);
    expect(readLocalNetworkTabCloseByCommandId(reopened, device, close.closeCommandId)).toEqual(
      closed,
    );
    expect(reopened.serialize().equals(before)).toBe(true);
    const next = commitLocalNetworkTabEntry(reopened, request(device), allow);
    const replayGuard = vi.fn(allow),
      afterEntry = reopened.serialize();
    expect(commitLocalNetworkTabClose(reopened, close, replayGuard)).toEqual(closed);
    expect(replayGuard).toHaveBeenCalledExactlyOnceWith('REPLAY');
    expect(commitLocalNetworkTabEntry(reopened, selected.request, allow)).toEqual(closedEntry);
    expect(readActiveLocalNetworkTab(reopened, device)).toEqual(next.currentTab);
    expect(reopened.serialize().equals(afterEntry)).toBe(true);
    commitLocalNetworkTabClose(reopened, closeInput(first), allow);
    const afterOtherClose = reopened.serialize();
    expectCode(
      () =>
        commitLocalNetworkTabEntry(
          reopened,
          { ...request(device), networkScopeId: close.networkScopeId },
          allow,
        ),
      'IDEMPOTENCY_CONFLICT',
    );
    expect(reopened.serialize().equals(afterOtherClose)).toBe(true);
  });

  it('closing a nonselected tab preserves the exact pointer and later NONE is never inferred from first/latest', () => {
    const { db, device, input } = setup();
    const first = commitLocalNetworkTabEntry(db, input, allow);
    const selected = commitLocalNetworkTabEntry(db, request(device), allow);
    const pointer = db.prepare('SELECT * FROM local_network_active_tab').get();
    const closed = commitLocalNetworkTabClose(db, closeInput(first), allow);
    expect(closed.receipt.activePointerCleared).toBe(false);
    expect(db.prepare('SELECT * FROM local_network_active_tab').get()).toEqual(pointer);
    expect(readActiveLocalNetworkTab(db, device)).toEqual(selected.currentTab);
    commitLocalNetworkTabClose(db, closeInput(selected), allow);
    expect(readActiveLocalNetworkTab(db, device)).toBeNull();
    db.prepare('DELETE FROM local_network_active_tab').run();
    expectCode(() => readActiveLocalNetworkTab(db, device), 'CORRUPT_STORAGE');
    expectCode(() => commitLocalNetworkTabEntry(db, request(device), allow), 'CORRUPT_STORAGE');
  });

  it('refuses PROVISIONAL, stale vectors, unknown scopes and fresh commands for a retired tab', () => {
    const { db, device, input } = setup(undefined, true);
    const saved = commitLocalNetworkTabEntry(db, input, allow),
      originalClose = closeInput(saved);
    writeCurrentFixture(db, {
      ...live(saved),
      lifecycleState: 'PROVISIONAL',
      stateRevision: 1,
      projectionRevision: 1,
    });
    const before = db.serialize(),
      guard = vi.fn(allow);
    expectCode(
      () =>
        commitLocalNetworkTabClose(
          db,
          {
            ...originalClose,
            expectedRevisions: { ...zero, stateRevision: 1, projectionRevision: 1 },
          },
          guard,
        ),
      'CLOSE_UNAVAILABLE',
    );
    expect(guard).not.toHaveBeenCalled();
    expect(db.serialize().equals(before)).toBe(true);
    // This read fixture models a later separately confirmed cancellation; this API cannot cancel.
    writeCurrentFixture(db, { ...live(saved), stateRevision: 2, projectionRevision: 2 });
    expectCode(() => commitLocalNetworkTabClose(db, originalClose, guard), 'STALE_REVISION');
    expectCode(
      () =>
        commitLocalNetworkTabClose(db, { ...originalClose, networkScopeId: randomUUID() }, guard),
      'NOT_FOUND',
    );
    const current = readLocalNetworkTabEntryByCommandId(db, device, input.entryCommandId)!;
    const closed = commitLocalNetworkTabClose(db, closeInput(current), allow);
    const after = db.serialize();
    expectCode(
      () =>
        commitLocalNetworkTabClose(
          db,
          { ...closed.request, closeCommandId: randomUUID(), closeReceiptId: randomUUID() },
          allow,
        ),
      'CLOSE_UNAVAILABLE',
    );
    expect(db.serialize().equals(after)).toBe(true);
  });

  it.each(['stateRevision', 'projectionRevision'] as const)(
    'rejects %s overflow before any close write',
    (key) => {
      const { db, device, input } = setup(undefined, true);
      const saved = commitLocalNetworkTabEntry(db, input, allow);
      writeCurrentFixture(db, { ...live(saved), [key]: Number.MAX_SAFE_INTEGER });
      const current = readLocalNetworkTabEntryByCommandId(db, device, input.entryCommandId)!;
      const before = db.serialize();
      expectCode(
        () => commitLocalNetworkTabClose(db, closeInput(current), allow),
        'REVISION_OVERFLOW',
      );
      expect(db.serialize().equals(before)).toBe(true);
    },
  );

  it('preserves visibility revision and rejects changed close payload and foreign owner after reset', () => {
    const { db, device, input } = setup(undefined, true);
    const saved = commitLocalNetworkTabEntry(db, input, allow);
    writeCurrentFixture(db, {
      ...live(saved),
      projectionRevision: 8,
      actorVisibilityRevision: Number.MAX_SAFE_INTEGER,
    });
    const current = readLocalNetworkTabEntryByCommandId(db, device, input.entryCommandId)!;
    const closed = commitLocalNetworkTabClose(db, closeInput(current), allow);
    expect(closed.receipt.revisions).toEqual({
      stateRevision: 1,
      projectionRevision: 9,
      actorVisibilityRevision: Number.MAX_SAFE_INTEGER,
    });
    const before = db.serialize();
    expectCode(
      () =>
        commitLocalNetworkTabClose(db, { ...closed.request, closeReceiptId: randomUUID() }, allow),
      'IDEMPOTENCY_CONFLICT',
    );
    expectCode(
      () => commitLocalNetworkTabClose(db, { ...closed.request, expectedRevisions: zero }, allow),
      'IDEMPOTENCY_CONFLICT',
    );
    expect(db.serialize().equals(before)).toBe(true);
    resetDeviceIdentity(db, allow);
    const nextOwner = bootstrapDeviceIdentity(db);
    expect(readActiveLocalNetworkTab(db, nextOwner)).toBeNull();
    expectCode(
      () => readLocalNetworkTabCloseByCommandId(db, nextOwner, closed.request.closeCommandId),
      'FOREIGN_OWNER',
    );
    expectCode(() => readOwnedLocalNetworkTab(db, device, input.networkScopeId), 'FOREIGN_OWNER');
  });

  it.each([
    'marker',
    'journal-hash',
    'target-vector',
    'cleared-flag',
    'missing-close',
    'hidden-owner',
  ] as const)(
    'refuses corrupted retirement %s instead of treating the entity as free capacity',
    (fault) => {
      const { db, device, input } = setup();
      const saved = commitLocalNetworkTabEntry(db, input, allow);
      const closed = commitLocalNetworkTabClose(db, closeInput(saved), allow);
      if (fault === 'marker') {
        const record = {
          ...live(saved),
          ...closed.receipt.revisions,
          retirementCommandIdOrNull: null,
        };
        db.prepare('UPDATE local_network_tab SET record_json=?,record_sha256=?').run(
          canonical(record),
          sha(canonical(record)),
        );
      } else if (fault === 'journal-hash')
        db.prepare('UPDATE local_network_tab_close SET journal_sha256=?').run('0'.repeat(64));
      else if (fault === 'target-vector' || fault === 'cleared-flag') {
        const receipt = {
          ...closed.receipt,
          ...(fault === 'cleared-flag'
            ? { activePointerCleared: false }
            : { revisions: { ...zero, stateRevision: 2, projectionRevision: 2 } }),
        };
        db.prepare('UPDATE local_network_tab_close SET receipt_json=?,journal_sha256=?').run(
          canonical(receipt),
          sha(canonical({ request: closed.request, receipt })),
        );
      } else if (fault === 'hidden-owner')
        db.prepare('UPDATE local_network_tab_close SET owner_device_id=?').run(randomUUID());
      else {
        db.pragma('foreign_keys=OFF');
        db.prepare('DELETE FROM local_network_tab_close').run();
        db.pragma('foreign_keys=ON');
      }
      const before = db.serialize();
      expectCode(
        () => readActiveLocalNetworkTab(db, device),
        fault === 'hidden-owner' ? 'FOREIGN_OWNER' : 'CORRUPT_STORAGE',
      );
      expectCode(
        () => commitLocalNetworkTabEntry(db, request(device), allow),
        fault === 'hidden-owner' ? 'FOREIGN_OWNER' : 'CORRUPT_STORAGE',
      );
      expect(db.serialize().equals(before)).toBe(true);
    },
  );

  it.each(['abort', 'extra-write'] as const)(
    'rolls back close journal, anchor and pointer on %s after the row update',
    (fault) => {
      const { db, device, input } = setup();
      const saved = commitLocalNetworkTabEntry(db, input, allow),
        close = closeInput(saved);
      const body =
        fault === 'abort'
          ? "SELECT RAISE(ABORT,'private-close-marker')"
          : "INSERT INTO campaign(campaign_id,lifecycle_state,payload_json) VALUES('forbidden-close','PAUSED','{}')";
      db.exec(
        `CREATE TRIGGER close_failure AFTER UPDATE ON local_network_tab WHEN NEW.retirement_command_id IS NOT NULL BEGIN ${body}; END`,
      );
      const before = db.serialize();
      expectCode(
        () => commitLocalNetworkTabClose(db, close, allow),
        fault === 'abort' ? 'CORRUPT_STORAGE' : 'SOURCE_CHANGED',
      );
      expect(db.serialize().equals(before)).toBe(true);
      expect(readOwnedLocalNetworkTab(db, device, input.networkScopeId)).toEqual(saved.currentTab);
      expect(readLocalNetworkTabCloseByCommandId(db, device, close.closeCommandId)).toBeNull();
      expect(readActiveLocalNetworkTab(db, device)).toEqual(saved.currentTab);
    },
  );

  it('guards close APPLY and REPLAY without promise diagnostics, source writes or nested commits', async () => {
    const { db, input } = setup();
    const saved = commitLocalNetworkTabEntry(db, input, allow),
      close = closeInput(saved);
    const before = db.serialize();
    expectCode(
      () => db.transaction(() => commitLocalNetworkTabClose(db, close, allow)).immediate(),
      'INVALID_INPUT',
    );
    expectCode(
      () =>
        Reflect.apply(commitLocalNetworkTabClose, undefined, [
          db,
          close,
          () => Promise.reject(new Error('private-close')),
        ]),
      'INVALID_INPUT',
    );
    expectCode(
      () => commitLocalNetworkTabClose(db, close, () => db.exec('COMMIT')),
      'SOURCE_CHANGED',
    );
    await setImmediate();
    expect(db.serialize().equals(before)).toBe(true);
    const closed = commitLocalNetworkTabClose(db, close, allow),
      after = db.serialize();
    expectCode(
      () => commitLocalNetworkTabClose(db, close, () => db.pragma('user_version=123')),
      'SOURCE_CHANGED',
    );
    expect(db.serialize().equals(after)).toBe(true);
    expect(commitLocalNetworkTabClose(db, close, allow)).toEqual(closed);
  });
});

describe('forward request-review migration', () => {
  it('upgrades a real schema10 and preserves every previous cursor, entry and migration byte', () => {
    const db = legacyDatabase(10);
    const device = bootstrapDeviceIdentity(db);
    const profile = ensureLocalGmProfile(
      db,
      { ownerDeviceId: device, masterProfileId: 'migration-profile' },
      allow,
    );
    createLocalGmContext(
      db,
      {
        gmLocalContextId: 'migration-context',
        masterProfileId: profile.masterProfileId,
        ownerDeviceId: device,
      },
      allow,
    );
    const input = request(device);
    const entry = commitLocalNetworkTabEntry(db, input, allow);
    const before = {
      cursor: db.prepare('SELECT * FROM campaign_creation_cursor').all(),
      entry: db.prepare('SELECT * FROM local_network_tab_entry').all(),
      registry: db.prepare('SELECT * FROM schema_migration ORDER BY version').all(),
    };
    expect(applyMigrations(db)).toBe(11);
    expect(db.prepare('SELECT * FROM campaign_creation_cursor').all()).toEqual(before.cursor);
    expect(db.prepare('SELECT * FROM local_network_tab_entry').all()).toEqual(before.entry);
    expect(
      db.prepare('SELECT * FROM schema_migration WHERE version<=10 ORDER BY version').all(),
    ).toEqual(before.registry);
    expect(readCampaignCreationCursor(db, 'migration-context').kind).toBe('MENU');
    expect(readLocalNetworkTabEntryByCommandId(db, device, input.entryCommandId)).toEqual(entry);
    for (const table of DEVICE_REQUEST_REVIEW_TABLES)
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    const stable = db.serialize();
    expect(applyMigrations(db)).toBe(11);
    expect(db.serialize().equals(stable)).toBe(true);
  });
});
