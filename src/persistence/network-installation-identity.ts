import { createHash } from 'node:crypto';
import { types } from 'node:util';
import type Database from 'better-sqlite3';
import type { JsonObject } from '../shared/wire-protocol.js';
import { loadDeviceId } from './device-identity.js';
import { LOCAL_NETWORK_TAB_TABLES } from './migrations/0009-device-admission.js';

/** Private installation material; it is never a player projection or campaign role. */
export interface DeviceInstallationIdentityMaterial extends JsonObject {
  readonly schemaVersion: 1;
  readonly algorithm: 'ED25519';
  readonly ownerDeviceId: string;
  readonly publicKeySpkiBase64: string;
  readonly privateKeyPkcs8Base64: string;
  readonly keyFingerprintSha256: string;
}

export type NetworkInstallationIdentityStoreCode =
  | 'INVALID_INPUT'
  | 'CORRUPT_STORAGE'
  | 'FOREIGN_OWNER'
  | 'OWNER_UNAVAILABLE'
  | 'KEY_CONFLICT'
  | 'SOURCE_CHANGED'
  | 'VALIDATION_FAILED';

export class NetworkInstallationIdentityStoreError extends Error {
  constructor(readonly code: NetworkInstallationIdentityStoreCode) {
    // Raw SQLite/callback errors can contain private key material; do not retain their cause.
    super(`network installation identity storage: ${code}`);
  }
}

type Row = Record<string, unknown>;
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const KEYS = [
  'schemaVersion',
  'algorithm',
  'ownerDeviceId',
  'publicKeySpkiBase64',
  'privateKeyPkcs8Base64',
  'keyFingerprintSha256',
] as const;
const fail = (code: NetworkInstallationIdentityStoreCode): never => {
  throw new NetworkInstallationIdentityStoreError(code);
};
const sha = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const ignorePromiseSettlement = () => undefined;
function consumeNativePromiseRejection(value: unknown): void {
  if (!types.isPromise(value)) return;
  // A mistaken synchronous validator may return/throw a rejected native Promise, including
  // one from another realm. Never read an arbitrary thenable's properties or assimilate it.
  try {
    void Promise.prototype.then.call(value, ignorePromiseSettlement, ignorePromiseSettlement);
  } catch {
    // The validator is trusted code, not a sandbox for adversarial Promise constructors.
    // Keep any constructor/species diagnostic out of the sanitized storage error.
  }
}
function safe<T>(read: () => T): T {
  try {
    return read();
  } catch (error: unknown) {
    if (error instanceof NetworkInstallationIdentityStoreError) throw error;
    return fail('CORRUPT_STORAGE');
  }
}
function owner(db: Database.Database, ownerDeviceId: unknown): asserts ownerDeviceId is string {
  if (typeof ownerDeviceId !== 'string' || !DEVICE_ID.test(ownerDeviceId))
    return fail('INVALID_INPUT');
  let current: string;
  try {
    current = loadDeviceId(db);
  } catch {
    return fail('OWNER_UNAVAILABLE');
  }
  if (current !== ownerDeviceId) return fail('FOREIGN_OWNER');
}
function canonicalBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  const bytes = Buffer.from(value, 'base64');
  try {
    return bytes.toString('base64') === value;
  } finally {
    bytes.fill(0);
  }
}
function material(
  value: unknown,
  code: NetworkInstallationIdentityStoreCode,
): DeviceInstallationIdentityMaterial {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== KEYS.length ||
    KEYS.some(
      (key) => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key]!, 'value'),
    )
  )
    return fail(code);
  const row = value as Row;
  if (
    row['schemaVersion'] !== 1 ||
    row['algorithm'] !== 'ED25519' ||
    typeof row['ownerDeviceId'] !== 'string' ||
    !DEVICE_ID.test(row['ownerDeviceId']) ||
    !canonicalBase64(row['publicKeySpkiBase64']) ||
    !canonicalBase64(row['privateKeyPkcs8Base64']) ||
    typeof row['keyFingerprintSha256'] !== 'string' ||
    !SHA256.test(row['keyFingerprintSha256']) ||
    sha(Buffer.from(row['publicKeySpkiBase64'], 'base64')) !== row['keyFingerprintSha256']
  )
    return fail(code);
  return Object.freeze({
    schemaVersion: 1,
    algorithm: 'ED25519',
    ownerDeviceId: row['ownerDeviceId'],
    publicKeySpkiBase64: row['publicKeySpkiBase64'],
    privateKeyPkcs8Base64: row['privateKeyPkcs8Base64'],
    keyFingerprintSha256: row['keyFingerprintSha256'],
  });
}
function encoded(value: DeviceInstallationIdentityMaterial): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]]),
    ),
  );
}
function requireSchema(db: Database.Database): void {
  const row = db
    .prepare<[], { version: unknown }>('SELECT MAX(version) AS version FROM schema_migration')
    .get();
  if (row?.version !== 8 && row?.version !== 9) return fail('CORRUPT_STORAGE');
  if (row.version === 9) {
    for (const table of LOCAL_NETWORK_TAB_TABLES)
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  }
}
function read(
  db: Database.Database,
  ownerDeviceId: string,
): DeviceInstallationIdentityMaterial | null {
  const row = db
    .prepare<[string], Row>(
      'SELECT owner_device_id, key_fingerprint_sha256, record_json, record_sha256 FROM device_installation_identity WHERE owner_device_id=?',
    )
    .get(ownerDeviceId);
  if (row === undefined) return null;
  const json = row['record_json'];
  if (typeof json !== 'string' || sha(json) !== row['record_sha256'])
    return fail('CORRUPT_STORAGE');
  const selected = material(JSON.parse(json) as unknown, 'CORRUPT_STORAGE');
  if (
    encoded(selected) !== json ||
    selected.ownerDeviceId !== ownerDeviceId ||
    row['owner_device_id'] !== selected.ownerDeviceId ||
    row['key_fingerprint_sha256'] !== selected.keyFingerprintSha256
  )
    return fail('CORRUPT_STORAGE');
  return selected;
}

export function readDeviceInstallationIdentity(
  db: Database.Database,
  ownerDeviceId: string,
): DeviceInstallationIdentityMaterial | null {
  return safe(() => {
    requireSchema(db);
    owner(db, ownerDeviceId);
    return read(db, ownerDeviceId);
  });
}

function totalChanges(db: Database.Database): number {
  const row = db.prepare<[], { changes: number }>('SELECT total_changes() AS changes').get();
  if (row === undefined || !Number.isSafeInteger(row.changes)) return fail('CORRUPT_STORAGE');
  return row.changes;
}
function validationGuard(db: Database.Database): string {
  // These checks detect accidental transactional writes, not arbitrary SQL sandboxing.
  // The trusted crypto validator must not commit/rollback or alter connection pragmas.
  return JSON.stringify([
    totalChanges(db),
    db.pragma('schema_version', { simple: true }),
    db.pragma('user_version', { simple: true }),
  ]);
}

export function ensureDeviceInstallationIdentity(
  db: Database.Database,
  preparedMaterial: DeviceInstallationIdentityMaterial,
  validateMaterial: (selectedMaterial: DeviceInstallationIdentityMaterial) => void,
): DeviceInstallationIdentityMaterial {
  if (
    db.inTransaction ||
    typeof validateMaterial !== 'function' ||
    Object.prototype.toString.call(validateMaterial) === '[object AsyncFunction]'
  )
    return fail('INVALID_INPUT');
  return safe(() => {
    const prepared = material(preparedMaterial, 'INVALID_INPUT');
    return db
      .transaction(() => {
        requireSchema(db);
        owner(db, prepared.ownerDeviceId);
        const existing = read(db, prepared.ownerDeviceId);
        const selected = existing ?? prepared;
        const guard = validationGuard(db);
        let validationResult: unknown;
        try {
          validationResult = validateMaterial(selected);
        } catch (error: unknown) {
          consumeNativePromiseRejection(error);
          return fail('VALIDATION_FAILED');
        }
        consumeNativePromiseRejection(validationResult);
        // A callback can end a read-only transaction without changing SQLite's write counter.
        // Never let the subsequent initializer escape into autocommit after that violation.
        if (!db.inTransaction) return fail('SOURCE_CHANGED');
        if (validationResult !== undefined) return fail('INVALID_INPUT');
        if (validationGuard(db) !== guard) return fail('SOURCE_CHANGED');
        owner(db, prepared.ownerDeviceId);
        if (existing !== null) return selected;
        const conflict = db
          .prepare<[string], Row>(
            'SELECT owner_device_id FROM device_installation_identity WHERE key_fingerprint_sha256=?',
          )
          .get(selected.keyFingerprintSha256);
        if (conflict !== undefined) return fail('KEY_CONFLICT');
        const json = encoded(selected);
        const before = totalChanges(db);
        const result = db
          .prepare(
            'INSERT INTO device_installation_identity(owner_device_id,key_fingerprint_sha256,record_json,record_sha256) VALUES(?,?,?,?)',
          )
          .run(selected.ownerDeviceId, selected.keyFingerprintSha256, json, sha(json));
        if (result.changes !== 1 || totalChanges(db) !== before + 1) return fail('SOURCE_CHANGED');
        owner(db, selected.ownerDeviceId);
        const persisted = read(db, selected.ownerDeviceId);
        if (persisted === null || encoded(persisted) !== json) return fail('SOURCE_CHANGED');
        return persisted;
      })
      .immediate();
  });
}
