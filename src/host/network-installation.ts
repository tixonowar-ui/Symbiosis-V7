import type Database from 'better-sqlite3';
import {
  ensureDeviceInstallationIdentity,
  loadDeviceId,
  readDeviceInstallationIdentity,
  type DeviceInstallationIdentityMaterial,
} from '../persistence/index.js';
import {
  generateDeviceInstallationIdentityMaterial,
  validateDeviceInstallationIdentityMaterial,
} from './campaign-peer-identity.js';

export type NetworkInstallationErrorCode =
  'OWNER_UNAVAILABLE' | 'NOT_INITIALIZED' | 'INVALID_IDENTITY' | 'INITIALIZATION_FAILED';
export class NetworkInstallationError extends Error {
  constructor(readonly code: NetworkInstallationErrorCode) {
    super(`network installation: ${code}`);
  }
}
const fail = (code: NetworkInstallationErrorCode): never => {
  throw new NetworkInstallationError(code);
};
function owner(db: Database.Database): string {
  try {
    return loadDeviceId(db);
  } catch {
    return fail('OWNER_UNAVAILABLE');
  }
}
function stored(db: Database.Database, ownerDeviceId: string) {
  try {
    return readDeviceInstallationIdentity(db, ownerDeviceId);
  } catch {
    return fail('INVALID_IDENTITY');
  }
}
function valid(value: unknown): DeviceInstallationIdentityMaterial {
  try {
    return validateDeviceInstallationIdentityMaterial(value);
  } catch {
    return fail('INVALID_IDENTITY');
  }
}

/** Read-only network handlers never bootstrap, rotate or repair an installation key. */
export function loadNetworkInstallation(db: Database.Database): DeviceInstallationIdentityMaterial {
  const selected = stored(db, owner(db));
  return selected === null ? fail('NOT_INITIALIZED') : valid(selected);
}

/** Explicit application startup follows device bootstrap, before any transport request. */
export function initializeNetworkInstallation(
  db: Database.Database,
): DeviceInstallationIdentityMaterial {
  const ownerDeviceId = owner(db);
  const existing = stored(db, ownerDeviceId);
  if (existing !== null) return valid(existing);
  if (db.inTransaction) return fail('INITIALIZATION_FAILED');
  try {
    const prepared = generateDeviceInstallationIdentityMaterial(ownerDeviceId);
    return ensureDeviceInstallationIdentity(db, prepared, (selected) => {
      validateDeviceInstallationIdentityMaterial(selected);
    });
  } catch {
    return fail('INITIALIZATION_FAILED');
  }
}
