import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
} from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPersistenceDatabase } from './database.js';
import { bootstrapDeviceIdentity, resetDeviceIdentity } from './device-identity.js';
import { applyMigrations } from './migrations/index.js';
import {
  ensureDeviceInstallationIdentity,
  NetworkInstallationIdentityStoreError,
  readDeviceInstallationIdentity,
  type DeviceInstallationIdentityMaterial,
  type NetworkInstallationIdentityStoreCode,
} from './network-installation-identity.js';

const databases: Database.Database[] = [];
const directories: string[] = [];
const allow = () => undefined;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]]),
    ),
  );
function open(path = ':memory:') {
  const db = openPersistenceDatabase(path);
  databases.push(db);
  return db;
}
function path() {
  const directory = mkdtempSync(join(tmpdir(), 'symbiosis-installation-key-'));
  directories.push(directory);
  return join(directory, 'private.sqlite');
}
function prepared(ownerDeviceId: string): DeviceInstallationIdentityMaterial {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' });
  return {
    schemaVersion: 1,
    algorithm: 'ED25519',
    ownerDeviceId,
    publicKeySpkiBase64: publicKey.toString('base64'),
    privateKeyPkcs8Base64: pair.privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64'),
    keyFingerprintSha256: sha(publicKey),
  };
}
function setup() {
  const db = open();
  const device = bootstrapDeviceIdentity(db);
  return { db, device, input: prepared(device) };
}
function raw(db: Database.Database) {
  return db.prepare('SELECT * FROM device_installation_identity ORDER BY owner_device_id').all();
}
function expectCode(run: () => unknown, code: NetworkInstallationIdentityStoreCode) {
  expect(run).toThrowError(new NetworkInstallationIdentityStoreError(code));
}
function corruptJson(db: Database.Database, value: Record<string, unknown>) {
  const json = canonical(value);
  db.prepare('UPDATE device_installation_identity SET record_json=?,record_sha256=?').run(
    json,
    sha(json),
  );
}
function validateRealKeyPair(selected: DeviceInstallationIdentityMaterial): void {
  const privateKey = createPrivateKey({
    key: Buffer.from(selected.privateKeyPkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  if (publicKey.toString('base64') !== selected.publicKeySpkiBase64)
    throw new Error('invalid key pair');
}

afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('durable private installation identity', () => {
  it('keeps the explicit schema8 key contract while schema9 requires its actual tab tables', () => {
    const { db, device, input } = setup();
    db.exec(
      'DROP TABLE local_network_active_tab; DROP TABLE local_network_tab_close; DROP TABLE local_network_tab_entry; DROP TABLE local_network_tab',
    );
    db.prepare('DELETE FROM schema_migration WHERE version=9').run();
    ensureDeviceInstallationIdentity(db, input, validateRealKeyPair);
    expect(readDeviceInstallationIdentity(db, device)).toEqual(input);
    const before = raw(db);
    expect(applyMigrations(db)).toBe(9);
    expect(raw(db)).toEqual(before);
    expect(readDeviceInstallationIdentity(db, device)).toEqual(input);
  });

  it('does not create credentials on read and atomically stores exactly the validated material', () => {
    const { db, device, input } = setup();
    expect(readDeviceInstallationIdentity(db, device)).toBeNull();
    expect(raw(db)).toEqual([]);
    const validate = vi.fn((selected: DeviceInstallationIdentityMaterial) => {
      expect(db.inTransaction).toBe(true);
      expect(selected).toEqual(input);
      expect(Object.isFrozen(selected)).toBe(true);
      validateRealKeyPair(selected);
      expect(raw(db)).toEqual([]);
    });
    expect(ensureDeviceInstallationIdentity(db, input, validate)).toEqual(input);
    expect(validate).toHaveBeenCalledOnce();
    expect(readDeviceInstallationIdentity(db, device)).toEqual(input);
    expect(raw(db)).toEqual([
      {
        owner_device_id: device,
        key_fingerprint_sha256: input.keyFingerprintSha256,
        record_json: canonical(input),
        record_sha256: sha(canonical(input)),
      },
    ]);
    for (const table of [
      'campaign',
      'campaign_character_copy',
      'campaign_checkpoint',
      'local_character',
      'local_gm_context',
    ])
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
  });

  it('reopens the same private identity and never rotates it for a newly prepared key', () => {
    const filename = path();
    const first = open(filename);
    const device = bootstrapDeviceIdentity(first);
    const selected = prepared(device);
    ensureDeviceInstallationIdentity(first, selected, validateRealKeyPair);
    first.close();
    const reopened = open(filename);
    expect(readDeviceInstallationIdentity(reopened, device)).toEqual(selected);
    const before = reopened.serialize();
    const validate = vi.fn(validateRealKeyPair);
    expect(ensureDeviceInstallationIdentity(reopened, prepared(device), validate)).toEqual(
      selected,
    );
    expect(validate).toHaveBeenCalledExactlyOnceWith(selected);
    expect(reopened.serialize()).toEqual(before);
  });

  it('selects the winner committed by another SQLite connection before validating a prepared loser', () => {
    const filename = path();
    const first = open(filename);
    const device = bootstrapDeviceIdentity(first);
    const firstPrepared = prepared(device);
    expect(readDeviceInstallationIdentity(first, device)).toBeNull();
    const second = open(filename);
    const winner = prepared(device);
    ensureDeviceInstallationIdentity(second, winner, validateRealKeyPair);
    const before = raw(second);
    const validate = vi.fn(validateRealKeyPair);
    expect(ensureDeviceInstallationIdentity(first, firstPrepared, validate)).toEqual(winner);
    expect(validate).toHaveBeenCalledExactlyOnceWith(winner);
    expect(raw(second)).toEqual(before);
  });

  it('makes old credentials inaccessible after reset and rejects the old public key for the new owner', () => {
    const { db, device, input } = setup();
    ensureDeviceInstallationIdentity(db, input, allow);
    resetDeviceIdentity(db, allow);
    expectCode(() => readDeviceInstallationIdentity(db, device), 'OWNER_UNAVAILABLE');
    const nextDevice = bootstrapDeviceIdentity(db);
    const before = raw(db);
    const validate = vi.fn(allow);
    expectCode(() => readDeviceInstallationIdentity(db, device), 'FOREIGN_OWNER');
    expectCode(() => ensureDeviceInstallationIdentity(db, input, validate), 'FOREIGN_OWNER');
    expect(validate).not.toHaveBeenCalled();
    expect(readDeviceInstallationIdentity(db, nextDevice)).toBeNull();
    expectCode(
      () => ensureDeviceInstallationIdentity(db, { ...input, ownerDeviceId: nextDevice }, allow),
      'KEY_CONFLICT',
    );
    expect(raw(db)).toEqual(before);
    const nextKey = prepared(nextDevice);
    ensureDeviceInstallationIdentity(db, nextKey, validateRealKeyPair);
    expect(readDeviceInstallationIdentity(db, nextDevice)).toEqual(nextKey);
    expect(raw(db)).toHaveLength(2);
    expectCode(() => readDeviceInstallationIdentity(db, device), 'FOREIGN_OWNER');
  });

  it.each([
    ['schemaVersion', 2],
    ['algorithm', 'RSA'],
    ['ownerDeviceId', 'invalid-device'],
    ['publicKeySpkiBase64', 'dGVzdA'],
    ['privateKeyPkcs8Base64', 'dGVz dA=='],
    ['privateKeyPkcs8Base64', ''],
    ['keyFingerprintSha256', 'f'.repeat(64)],
    ['extra', 'private marker'],
  ])('rejects invalid input field %s before callback or writes', (field, value) => {
    const { db, input } = setup();
    const before = db.serialize();
    const validate = vi.fn(allow);
    expectCode(
      () => ensureDeviceInstallationIdentity(db, { ...input, [field]: value }, validate),
      'INVALID_INPUT',
    );
    expect(validate).not.toHaveBeenCalled();
    expect(db.serialize()).toEqual(before);
  });

  it('rejects accessor input without evaluating a private material getter', () => {
    const { db, input } = setup();
    const getter = vi.fn(() => input.privateKeyPkcs8Base64);
    const forged = { ...input };
    Object.defineProperty(forged, 'privateKeyPkcs8Base64', { get: getter });
    expectCode(() => ensureDeviceInstallationIdentity(db, forged, allow), 'INVALID_INPUT');
    expect(getter).not.toHaveBeenCalled();
    expect(raw(db)).toEqual([]);
  });

  it.each([
    'checksum',
    'unknown-key',
    'algorithm',
    'private-base64',
    'owner',
    'fingerprint-index',
    'noncanonical-json',
  ])('fails on known storage corruption (%s) without replacing it with a new key', (damage) => {
    const { db, device, input } = setup();
    ensureDeviceInstallationIdentity(db, input, allow);
    if (damage === 'checksum')
      db.prepare('UPDATE device_installation_identity SET record_sha256=?').run('0'.repeat(64));
    else if (damage === 'fingerprint-index')
      db.prepare('UPDATE device_installation_identity SET key_fingerprint_sha256=?').run(
        '0'.repeat(64),
      );
    else if (damage === 'noncanonical-json') {
      const json = JSON.stringify(input, null, 2);
      db.prepare('UPDATE device_installation_identity SET record_json=?,record_sha256=?').run(
        json,
        sha(json),
      );
    } else
      corruptJson(db, {
        ...input,
        ...(damage === 'unknown-key'
          ? { privateUnknown: input.privateKeyPkcs8Base64 }
          : damage === 'algorithm'
            ? { algorithm: 'RSA' }
            : damage === 'owner'
              ? { ownerDeviceId: randomUUID() }
              : { privateKeyPkcs8Base64: 'bad base64!' }),
      });
    const before = raw(db);
    const validate = vi.fn(allow);
    expectCode(() => readDeviceInstallationIdentity(db, device), 'CORRUPT_STORAGE');
    expectCode(
      () => ensureDeviceInstallationIdentity(db, prepared(device), validate),
      'CORRUPT_STORAGE',
    );
    expect(validate).not.toHaveBeenCalled();
    expect(raw(db)).toEqual(before);
  });

  it('requires the host to verify the selected existing key pair and sanitizes callback errors', () => {
    const { db, device, input } = setup();
    ensureDeviceInstallationIdentity(db, input, validateRealKeyPair);
    const unrelated = prepared(device);
    corruptJson(db, { ...input, privateKeyPkcs8Base64: unrelated.privateKeyPkcs8Base64 });
    const before = raw(db);
    expectCode(
      () => ensureDeviceInstallationIdentity(db, unrelated, validateRealKeyPair),
      'VALIDATION_FAILED',
    );
    const errors: unknown[] = [];
    try {
      ensureDeviceInstallationIdentity(db, unrelated, (selected) => {
        throw new Error(selected.privateKeyPkcs8Base64);
      });
    } catch (error: unknown) {
      errors.push(error);
    }
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toBe(
      'Error: network installation identity storage: VALIDATION_FAILED',
    );
    expect(Object.hasOwn(errors[0] as object, 'cause')).toBe(false);
    expect(JSON.stringify(errors[0])).not.toContain(unrelated.privateKeyPkcs8Base64);
    expect(raw(db)).toEqual(before);
  });

  it.each(['first', 'existing'] as const)(
    'rolls back callback SQL writes even when restored (%s)',
    (mode) => {
      const { db, input } = setup();
      if (mode === 'existing') ensureDeviceInstallationIdentity(db, input, allow);
      const before = db.serialize();
      expectCode(
        () =>
          ensureDeviceInstallationIdentity(db, input, () => {
            db.prepare(
              "INSERT INTO campaign(campaign_id,lifecycle_state,payload_json) VALUES('forbidden','PAUSED','{}')",
            ).run();
            db.prepare("DELETE FROM campaign WHERE campaign_id='forbidden'").run();
          }),
        'SOURCE_CHANGED',
      );
      expect(db.serialize()).toEqual(before);
    },
  );

  it.each(['schema', 'pragma', 'owner'] as const)(
    'rejects callback %s changes and rolls them back',
    (kind) => {
      const { db, input } = setup();
      const before = db.serialize();
      expectCode(
        () =>
          ensureDeviceInstallationIdentity(db, input, () => {
            if (kind === 'schema') db.exec('CREATE TABLE forbidden_callback(id TEXT)');
            else if (kind === 'pragma') db.pragma('user_version = 91');
            else db.prepare('UPDATE device_identity SET device_id=?').run(randomUUID());
          }),
        'SOURCE_CHANGED',
      );
      expect(db.serialize()).toEqual(before);
    },
  );

  it('rejects nested, asynchronous and thenable-returning validation without committing', () => {
    const { db, input } = setup();
    const before = db.serialize();
    const validate = vi.fn(allow);
    expectCode(
      () => db.transaction(() => ensureDeviceInstallationIdentity(db, input, validate)).immediate(),
      'INVALID_INPUT',
    );
    expect(validate).not.toHaveBeenCalled();
    let called = false;
    const asynchronous = async () => {
      called = true;
      await Promise.resolve();
    };
    // Exercise JavaScript callers that do not obey the synchronous TypeScript callback contract.
    const invokeUntyped = (callback: unknown): void => {
      Reflect.apply(ensureDeviceInstallationIdentity, undefined, [db, input, callback]);
    };
    expectCode(() => invokeUntyped(asynchronous), 'INVALID_INPUT');
    expect(called).toBe(false);
    expectCode(() => invokeUntyped(() => Promise.resolve()), 'INVALID_INPUT');
    expect(db.serialize()).toEqual(before);
  });

  it.each(['ordinary', 'mocked', 'mocked-async', 'cross-realm'] as const)(
    'sanitizes a returned rejected native Promise (%s) without writes or unhandled rejection',
    async (kind) => {
      const { db, input } = setup();
      const before = db.serialize();
      const reason = new Error(input.privateKeyPkcs8Base64);
      const rejected = () => Promise.reject(reason);
      const callback: unknown =
        kind === 'ordinary'
          ? rejected
          : kind === 'mocked'
            ? vi.fn(rejected)
            : kind === 'mocked-async'
              ? vi.fn(async () => {
                  await Promise.resolve();
                  throw reason;
                })
              : runInNewContext('() => Promise.reject(reason)', { reason });
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        expectCode(
          () => Reflect.apply(ensureDeviceInstallationIdentity, undefined, [db, input, callback]),
          'INVALID_INPUT',
        );
        await setImmediate();
        expect(unhandled).not.toHaveBeenCalled();
        expect(db.inTransaction).toBe(false);
        expect(db.serialize()).toEqual(before);
        expect(raw(db)).toEqual([]);
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    },
  );

  it.each(['ordinary', 'cross-realm'] as const)(
    'sanitizes a thrown rejected native Promise (%s) without writes or unhandled rejection',
    async (kind) => {
      const { db, input } = setup();
      const before = db.serialize();
      const reason = new Error(input.privateKeyPkcs8Base64);
      const callback: unknown =
        kind === 'ordinary'
          ? () => {
              const rejected: unknown = Promise.reject(reason);
              throw rejected;
            }
          : runInNewContext('() => { throw Promise.reject(reason); }', { reason });
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        expectCode(
          () => Reflect.apply(ensureDeviceInstallationIdentity, undefined, [db, input, callback]),
          'VALIDATION_FAILED',
        );
        await setImmediate();
        expect(unhandled).not.toHaveBeenCalled();
        expect(db.inTransaction).toBe(false);
        expect(db.serialize()).toEqual(before);
        expect(raw(db)).toEqual([]);
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    },
  );

  it('refuses unknown thenables without reading or invoking their then property', () => {
    const { db, input } = setup();
    const before = db.serialize();
    const then = vi.fn(() => {
      throw new Error(input.privateKeyPkcs8Base64);
    });
    const thenable = Object.defineProperty({}, 'then', { get: then });
    expectCode(() => ensureDeviceInstallationIdentity(db, input, () => thenable), 'INVALID_INPUT');
    expect(then).not.toHaveBeenCalled();
    expect(db.serialize()).toEqual(before);
  });

  it.each(['COMMIT', 'ROLLBACK'] as const)(
    'refuses callback %s before the initializer can write outside its transaction',
    (endTransaction) => {
      const { db, device, input } = setup();
      const before = db.serialize();
      expectCode(
        () => ensureDeviceInstallationIdentity(db, input, () => db.exec(endTransaction)),
        'SOURCE_CHANGED',
      );
      expect(db.inTransaction).toBe(false);
      expect(raw(db)).toEqual([]);
      expect(readDeviceInstallationIdentity(db, device)).toBeNull();
      expect(db.serialize()).toEqual(before);
      // Rejection did not poison normal later initialization or replace a prior identity.
      ensureDeviceInstallationIdentity(db, input, validateRealKeyPair);
      const known = db.serialize();
      expectCode(
        () => ensureDeviceInstallationIdentity(db, prepared(device), () => db.exec(endTransaction)),
        'SOURCE_CHANGED',
      );
      expect(readDeviceInstallationIdentity(db, device)).toEqual(input);
      expect(db.serialize()).toEqual(known);
    },
  );

  it.each(['abort', 'mutate-inserted', 'mutate-source'] as const)(
    'rolls back trigger %s and does not expose private SQL diagnostics',
    (kind) => {
      const { db, input } = setup();
      const body =
        kind === 'abort'
          ? `SELECT RAISE(ABORT, '${input.privateKeyPkcs8Base64}')`
          : kind === 'mutate-inserted'
            ? "UPDATE device_installation_identity SET record_sha256=printf('%064d',0)"
            : "INSERT INTO campaign(campaign_id,lifecycle_state,payload_json) VALUES('forbidden','PAUSED','{}')";
      db.exec(
        `CREATE TRIGGER reject_identity AFTER INSERT ON device_installation_identity BEGIN ${body}; END`,
      );
      const before = db.serialize();
      expectCode(
        () => ensureDeviceInstallationIdentity(db, input, allow),
        kind === 'abort' ? 'CORRUPT_STORAGE' : 'SOURCE_CHANGED',
      );
      expect(db.serialize()).toEqual(before);
      expect(raw(db)).toEqual([]);
    },
  );

  it.each([
    'missing-table',
    'missing-network-tab-table',
    'missing-close-table',
    'older-schema',
    'future-schema',
  ] as const)('refuses %s instead of generating a fallback identity', (kind) => {
    const { db, device, input } = setup();
    if (kind === 'missing-table') db.exec('DROP TABLE device_installation_identity');
    else if (kind === 'missing-network-tab-table') db.exec('DROP TABLE local_network_active_tab');
    else if (kind === 'missing-close-table') db.exec('DROP TABLE local_network_tab_close');
    else if (kind === 'older-schema')
      db.prepare('DELETE FROM schema_migration WHERE version>=8').run();
    else db.prepare('UPDATE schema_migration SET version=10 WHERE version=9').run();
    const before = db.serialize();
    const validate = vi.fn(allow);
    expectCode(() => readDeviceInstallationIdentity(db, device), 'CORRUPT_STORAGE');
    expectCode(() => ensureDeviceInstallationIdentity(db, input, validate), 'CORRUPT_STORAGE');
    expect(validate).not.toHaveBeenCalled();
    expect(db.serialize()).toEqual(before);
  });

  it('upgrades version 7 without rewriting prior migrations or creating identity, roles or game rows', () => {
    const db = open();
    const device = bootstrapDeviceIdentity(db);
    db.exec(
      'DROP TABLE local_network_active_tab; DROP TABLE local_network_tab_close; DROP TABLE local_network_tab_entry; DROP TABLE local_network_tab',
    );
    db.exec('DROP TABLE device_installation_identity');
    db.prepare('DELETE FROM schema_migration WHERE version>=8').run();
    db.prepare(
      "INSERT INTO local_character(local_character_id,lifecycle_state,payload_json) VALUES('preserved-local','DRAFT','{\"source\":7}')",
    ).run();
    db.prepare(
      "INSERT INTO campaign(campaign_id,lifecycle_state,payload_json) VALUES('preserved-campaign','PAUSED','{\"source\":7}')",
    ).run();
    const oldRegistry = db.prepare('SELECT * FROM schema_migration ORDER BY version').all();
    const local = db.prepare('SELECT * FROM local_character').all();
    const campaign = db.prepare('SELECT * FROM campaign').all();
    expect(applyMigrations(db)).toBe(9);
    expect(
      db.prepare('SELECT * FROM schema_migration WHERE version<8 ORDER BY version').all(),
    ).toEqual(oldRegistry);
    expect(db.prepare('SELECT * FROM local_character').all()).toEqual(local);
    expect(db.prepare('SELECT * FROM campaign').all()).toEqual(campaign);
    expect(readDeviceInstallationIdentity(db, device)).toBeNull();
    for (const table of ['campaign_character_copy', 'campaign_checkpoint', 'local_gm_context'])
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    const before = db.serialize();
    expect(applyMigrations(db)).toBe(9);
    expect(db.serialize()).toEqual(before);
  });
});
