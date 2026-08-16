import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

declare const deviceIdBrand: unique symbol;

export type DeviceId = string & { readonly [deviceIdBrand]: 'DeviceId' };

export type DeviceBindingsInvalidator<T = void> = (
  deviceId: DeviceId,
) => T & (T extends PromiseLike<unknown> ? never : unknown);

interface DeviceIdentityRow {
  identity_slot: unknown;
  device_id: unknown;
  initialized: unknown;
}

type DeviceIdentityState = { status: 'uninitialized' } | { status: 'assigned'; deviceId: DeviceId };

const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const describe = (value: unknown): string => {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
};

const deviceIdFrom = (value: unknown, source: string): DeviceId => {
  if (typeof value !== 'string' || !DEVICE_ID_PATTERN.test(value)) {
    throw new Error(`${source} is ${describe(value)}, expected a canonical lowercase UUID v4`);
  }
  return value as DeviceId;
};

const readDeviceIdentityState = (database: Database.Database): DeviceIdentityState => {
  const rows = database
    .prepare<[], DeviceIdentityRow>(
      `SELECT identity_slot, device_id, initialized
       FROM device_identity
       ORDER BY identity_slot`,
    )
    .all();
  if (rows.length !== 1) {
    throw new Error(
      `device identity storage must contain exactly one singleton row, found ${rows.length}`,
    );
  }

  const row = rows[0];
  if (row === undefined || row.identity_slot !== 1) {
    throw new Error(
      `device identity storage has invalid identity_slot ${describe(row?.identity_slot)}`,
    );
  }
  if (row.initialized === 0) {
    if (row.device_id !== null) {
      throw new Error(
        `uninitialized device identity contains unexpected deviceId ${describe(row.device_id)}`,
      );
    }
    return { status: 'uninitialized' };
  }
  if (row.initialized !== 1) {
    throw new Error(
      `device identity storage has invalid initialized flag ${describe(row.initialized)}`,
    );
  }
  return {
    status: 'assigned',
    deviceId: deviceIdFrom(row.device_id, 'stored deviceId'),
  };
};

const requireTopLevelWrite = (
  database: Database.Database,
  operation: 'bootstrap' | 'reset',
): void => {
  if (database.inTransaction) {
    throw new Error(`device identity ${operation} requires a top-level transaction`);
  }
};

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  value !== null &&
  (typeof value === 'object' || typeof value === 'function') &&
  'then' in value &&
  typeof value.then === 'function';

export const loadDeviceId = (database: Database.Database): DeviceId => {
  const state = readDeviceIdentityState(database);
  if (state.status === 'uninitialized') {
    throw new Error('device identity is not initialized');
  }
  return state.deviceId;
};

export const bootstrapDeviceIdentity = (database: Database.Database): DeviceId => {
  requireTopLevelWrite(database, 'bootstrap');
  return database
    .transaction(() => {
      const state = readDeviceIdentityState(database);
      if (state.status === 'assigned') {
        return state.deviceId;
      }

      const deviceId = deviceIdFrom(randomUUID(), 'node:crypto randomUUID()');
      const result = database
        .prepare(
          `UPDATE device_identity
           SET device_id = ?, initialized = 1
           WHERE identity_slot = 1 AND device_id IS NULL AND initialized = 0`,
        )
        .run(deviceId);
      if (result.changes !== 1) {
        throw new Error(
          `device identity bootstrap changed ${result.changes} rows, expected exactly one`,
        );
      }
      return deviceId;
    })
    .immediate();
};

export const resetDeviceIdentity = <T>(
  database: Database.Database,
  invalidateBindings: DeviceBindingsInvalidator<T>,
): void => {
  requireTopLevelWrite(database, 'reset');
  if (typeof invalidateBindings !== 'function') {
    throw new TypeError('device identity reset requires a binding invalidator function');
  }
  if (Object.prototype.toString.call(invalidateBindings) === '[object AsyncFunction]') {
    throw new TypeError('device identity binding invalidation must be synchronous');
  }

  database
    .transaction(() => {
      const deviceId = loadDeviceId(database);
      const invalidationResult = invalidateBindings(deviceId);
      if (isPromiseLike(invalidationResult)) {
        throw new TypeError('device identity binding invalidation must be synchronous');
      }

      const result = database
        .prepare(
          `UPDATE device_identity
           SET device_id = NULL, initialized = 0
           WHERE identity_slot = 1 AND device_id = ? AND initialized = 1`,
        )
        .run(deviceId);
      if (result.changes !== 1) {
        throw new Error(
          `device identity reset changed ${result.changes} rows, expected exactly one`,
        );
      }
    })
    .immediate();
};
