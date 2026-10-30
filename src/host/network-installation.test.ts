import { describe, expect, it } from 'vitest';
import {
  bootstrapDeviceIdentity,
  ensureDeviceInstallationIdentity,
  openPersistenceDatabase,
  readDeviceInstallationIdentity,
  resetDeviceIdentity,
} from '../persistence/index.js';
import { generateDeviceInstallationIdentityMaterial } from './campaign-peer-identity.js';
import {
  initializeNetworkInstallation,
  loadNetworkInstallation,
  NetworkInstallationError,
} from './network-installation.js';

describe('explicit installation initialization and read-only network loading', () => {
  it('initializes only during explicit startup and preserves the exact key on later starts', () => {
    const db = openPersistenceDatabase(':memory:');
    try {
      const deviceId = bootstrapDeviceIdentity(db);
      const before = db.serialize();
      expect(() => loadNetworkInstallation(db)).toThrow(
        new NetworkInstallationError('NOT_INITIALIZED'),
      );
      expect(db.serialize().equals(before)).toBe(true);
      const first = initializeNetworkInstallation(db);
      expect(first.ownerDeviceId).toBe(deviceId);
      expect(readDeviceInstallationIdentity(db, deviceId)).toEqual(first);
      const afterStartup = db.serialize();
      expect(initializeNetworkInstallation(db)).toEqual(first);
      expect(loadNetworkInstallation(db)).toEqual(first);
      expect(db.serialize().equals(afterStartup)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('does not bootstrap a missing device identity for either operation', () => {
    const db = openPersistenceDatabase(':memory:');
    try {
      const before = db.serialize();
      for (const run of [loadNetworkInstallation, initializeNetworkInstallation])
        expect(() => run(db)).toThrow(new NetworkInstallationError('OWNER_UNAVAILABLE'));
      expect(db.serialize().equals(before)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('refuses a storage-valid but cryptographically mismatched pair without repair or key disclosure', () => {
    const db = openPersistenceDatabase(':memory:');
    try {
      const deviceId = bootstrapDeviceIdentity(db);
      const first = generateDeviceInstallationIdentityMaterial(deviceId);
      const second = generateDeviceInstallationIdentityMaterial(deviceId);
      // Seed corrupt opaque storage through persistence; production startup always validates the pair.
      ensureDeviceInstallationIdentity(
        db,
        { ...first, privateKeyPkcs8Base64: second.privateKeyPkcs8Base64 },
        () => undefined,
      );
      const before = db.serialize();
      for (const run of [loadNetworkInstallation, initializeNetworkInstallation]) {
        try {
          run(db);
          expect.fail('a corrupt persisted pair must not be repaired');
        } catch (error: unknown) {
          expect(error).toEqual(new NetworkInstallationError('INVALID_IDENTITY'));
          expect(error).not.toHaveProperty('cause');
          expect(String(error)).not.toContain(second.privateKeyPkcs8Base64);
        }
      }
      expect(db.serialize().equals(before)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('does not reassign the old installation key after device reset', () => {
    const db = openPersistenceDatabase(':memory:');
    try {
      bootstrapDeviceIdentity(db);
      const old = initializeNetworkInstallation(db);
      resetDeviceIdentity(db, () => undefined);
      expect(() => loadNetworkInstallation(db)).toThrow(
        new NetworkInstallationError('OWNER_UNAVAILABLE'),
      );
      const nextDevice = bootstrapDeviceIdentity(db);
      expect(nextDevice).not.toBe(old.ownerDeviceId);
      const beforeStartup = db.serialize();
      expect(() => loadNetworkInstallation(db)).toThrow(
        new NetworkInstallationError('NOT_INITIALIZED'),
      );
      expect(db.serialize().equals(beforeStartup)).toBe(true);
      const next = initializeNetworkInstallation(db);
      expect(next.ownerDeviceId).toBe(nextDevice);
      expect(next.keyFingerprintSha256).not.toBe(old.keyFingerprintSha256);
    } finally {
      db.close();
    }
  });
});
