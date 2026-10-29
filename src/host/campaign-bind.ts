import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type {
  CampaignBindPreflight,
  CampaignHostValues,
  CampaignNetworkInterface,
} from '@shared/campaign-creation.js';
import { normalizedHostIp } from './local-master-trust.js';

export interface CampaignShellListener {
  readonly address: string;
  readonly port: number;
}
export interface CampaignBindOptions {
  /** Must read the actual app.server and return null whenever it is not listening. */
  readonly readShellListener: () => CampaignShellListener | null;
  readonly readNetworkInterfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  readonly allocateLeaseId?: () => string;
}
export interface CampaignBindRecovery {
  readonly status: 'RESERVED' | 'UNAVAILABLE';
  readonly reasonCode: null | 'PORT_UNAVAILABLE' | 'BIND_FAILED';
}
interface Config extends CampaignHostValues {
  readonly hostAddress: string;
  readonly hostPort: number;
  readonly networkInterface: string;
  readonly activePlayerCapacity: number | null;
}
interface Lease {
  readonly id: string;
  readonly config: Config;
  readonly fingerprint: string;
  readonly server: Server | null;
  readonly borrowedListener: CampaignShellListener | null;
  readonly sourceDraftId: string | null;
  failed: boolean;
  closePromise?: Promise<void>;
}
interface Flight {
  readonly fingerprint: string;
  cancelled: boolean;
  promise: Promise<CampaignBindPreflight>;
}
const failure = (
  reasonCode: NonNullable<CampaignBindPreflight['reasonCode']>,
): CampaignBindPreflight => ({ status: 'FAIL', reasonCode, leaseIdOrNull: null });
const unchecked = (): CampaignBindPreflight => ({
  status: 'NOT_CHECKED',
  reasonCode: null,
  leaseIdOrNull: null,
});
const passed = (lease: Lease): CampaignBindPreflight => ({
  status: 'PASS',
  reasonCode: null,
  leaseIdOrNull: lease.id,
});
const idAt = (id: string): string => {
  if (typeof id !== 'string' || id.length === 0)
    throw new TypeError('Campaign bind owner ID is required');
  return id;
};
const fingerprint = (config: Config): string =>
  JSON.stringify([
    config.hostAddress,
    config.hostPort,
    config.networkInterface,
    config.activePlayerCapacity,
  ]);
const unavailableCode = (error: unknown): 'PORT_UNAVAILABLE' | 'BIND_FAILED' =>
  error !== null && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE'
    ? 'PORT_UNAVAILABLE'
    : 'BIND_FAILED';
const unsupportedAddress = (ip: string): boolean =>
  ip === '0.0.0.0' || ip === '::' || /^fe[89ab][0-9a-f]:/u.test(ip);

/** Reservations hold real listeners, but never accept a player or start a campaign host. */
export function createCampaignBindManager(options: CampaignBindOptions) {
  const readInterfaces = options.readNetworkInterfaces ?? networkInterfaces;
  const allocateLeaseId = options.allocateLeaseId ?? randomUUID;
  const leases = new Map<string, Lease>();
  const flights = new Map<string, Flight>();
  let closed = false;

  function interfaces(): readonly CampaignNetworkInterface[] {
    const result: CampaignNetworkInterface[] = [];
    const seen = new Set<string>();
    for (const [name, records] of Object.entries(readInterfaces())) {
      for (const record of records ?? []) {
        if (record.family !== 'IPv4' && record.family !== 'IPv6')
          throw new TypeError('Unrecognized host network interface family');
        const ip = normalizedHostIp(record.address);
        if (ip === null || unsupportedAddress(ip) || ('scopeid' in record && record.scopeid !== 0))
          continue;
        const family = ip.includes(':') ? 'IPv6' : 'IPv4';
        const key = JSON.stringify([name, ip, family]);
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ networkInterface: name, hostAddress: ip, family });
        }
      }
    }
    return result.sort((a, b) => {
      const left = JSON.stringify([a.networkInterface, a.family, a.hostAddress]);
      const right = JSON.stringify([b.networkInterface, b.family, b.hostAddress]);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  function configAt(value: CampaignHostValues, checkInterfaces = true): Config | null {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(' ') !==
        'activePlayerCapacity hostAddress hostPort networkInterface' ||
      typeof value.hostAddress !== 'string' ||
      typeof value.networkInterface !== 'string' ||
      typeof value.hostPort !== 'number' ||
      !Number.isSafeInteger(value.hostPort) ||
      value.hostPort < 1 ||
      value.hostPort > 65535 ||
      (value.activePlayerCapacity !== null && !Number.isSafeInteger(value.activePlayerCapacity))
    )
      return null;
    const ip = normalizedHostIp(value.hostAddress);
    if (
      ip === null ||
      ip !== value.hostAddress ||
      (checkInterfaces &&
        !interfaces().some(
          (row) => row.networkInterface === value.networkInterface && row.hostAddress === ip,
        ))
    )
      return null;
    return {
      hostAddress: ip,
      hostPort: value.hostPort,
      networkInterface: value.networkInterface,
      activePlayerCapacity: value.activePlayerCapacity,
    };
  }
  function borrowed(config: Config): CampaignShellListener | null {
    const shell = options.readShellListener();
    if (shell === null || shell.port !== config.hostPort) return null;
    const address = normalizedHostIp(shell.address);
    // The injected app.server uses Node's default dual-stack mode for an unspecified IPv6 address.
    if (
      address === config.hostAddress ||
      address === '::' ||
      (address === '0.0.0.0' && !config.hostAddress.includes(':'))
    )
      return { address, port: shell.port };
    return null;
  }
  function live(lease: Lease): boolean {
    if (closed || lease.failed || configAt(lease.config) === null) return false;
    if (lease.server !== null) return lease.server.listening;
    const shell = borrowed(lease.config);
    return (
      shell !== null &&
      shell.address === lease.borrowedListener?.address &&
      shell.port === lease.borrowedListener.port
    );
  }
  function closeLease(lease: Lease): Promise<void> {
    if (lease.closePromise !== undefined) return lease.closePromise;
    lease.failed = true;
    const server = lease.server;
    lease.closePromise =
      server === null
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (
                error === undefined ||
                (error as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING'
              )
                resolve();
              else reject(error);
            });
          });
    return lease.closePromise;
  }
  async function acquire(
    config: Config,
    leaseId: string,
    sourceDraftId: string | null,
  ): Promise<Lease> {
    const shell = borrowed(config);
    const lease: Lease = {
      id: leaseId,
      config,
      fingerprint: fingerprint(config),
      server: null,
      borrowedListener: shell,
      sourceDraftId,
      failed: false,
    };
    if (shell !== null) return lease;
    const server = createServer((socket) => socket.destroy());
    const owned: Lease = { ...lease, server };
    server.on('error', () => {
      owned.failed = true;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => {
          server.off('listening', ready);
          reject(error);
        };
        const ready = () => {
          server.off('error', failed);
          resolve();
        };
        server.once('error', failed);
        server.once('listening', ready);
        server.listen({
          host: config.hostAddress,
          port: config.hostPort,
          exclusive: true,
          ipv6Only: config.hostAddress.includes(':'),
        });
      });
      return owned;
    } catch (error) {
      await closeLease(owned);
      throw error;
    }
  }
  function describe(draftId: string, host: CampaignHostValues): CampaignBindPreflight {
    const config = configAt(host);
    if (config === null) return failure('INVALID_INTERFACE');
    const lease = leases.get(`draft:${idAt(draftId)}`);
    if (lease === undefined) return unchecked();
    return lease.fingerprint === fingerprint(config) && live(lease)
      ? passed(lease)
      : failure('LEASE_EXPIRED');
  }
  async function releaseKey(key: string): Promise<void> {
    const flight = flights.get(key);
    if (flight !== undefined) flight.cancelled = true;
    const lease = leases.get(key);
    leases.delete(key);
    await Promise.all([
      ...(lease === undefined ? [] : [closeLease(lease)]),
      ...(flight === undefined ? [] : [flight.promise.then(() => {})]),
    ]);
  }
  function reserve(
    key: string,
    config: Config,
    sourceDraftId: string | null,
    leaseId: () => string,
  ): Promise<CampaignBindPreflight> {
    if (closed) return Promise.resolve(failure('LEASE_EXPIRED'));
    const mark = fingerprint(config);
    const existing = leases.get(key);
    if (existing !== undefined && existing.fingerprint === mark && live(existing))
      return Promise.resolve(passed(existing));
    const previous = flights.get(key);
    if (previous !== undefined && !previous.cancelled && previous.fingerprint === mark)
      return previous.promise;
    if (previous !== undefined) previous.cancelled = true;
    leases.delete(key);
    const flight: Flight = {
      fingerprint: mark,
      cancelled: false,
      promise: Promise.resolve(unchecked()),
    };
    flights.set(key, flight);
    flight.promise = (async () => {
      try {
        await Promise.all([
          ...(existing === undefined ? [] : [closeLease(existing)]),
          ...(previous === undefined ? [] : [previous.promise.then(() => {})]),
        ]);
        if (closed || flight.cancelled) return failure('LEASE_EXPIRED');
        const lease = await acquire(config, idAt(leaseId()), sourceDraftId);
        if (closed || flight.cancelled || !live(lease)) {
          await closeLease(lease);
          return failure('LEASE_EXPIRED');
        }
        leases.set(key, lease);
        return passed(lease);
      } catch (error) {
        return failure(unavailableCode(error));
      } finally {
        if (flights.get(key) === flight) flights.delete(key);
      }
    })();
    return flight.promise;
  }
  return {
    interfaces,
    describe,
    validate: (leaseId: string, draftId: string, host: CampaignHostValues): boolean => {
      const current = describe(draftId, host);
      return current.status === 'PASS' && current.leaseIdOrNull === leaseId;
    },
    prepare: async (draftId: string, host: CampaignHostValues): Promise<CampaignBindPreflight> => {
      const key = `draft:${idAt(draftId)}`;
      const config = configAt(host);
      if (config === null) {
        await releaseKey(key);
        return failure('INVALID_INTERFACE');
      }
      return reserve(key, config, draftId, allocateLeaseId);
    },
    release: (draftId: string): Promise<void> => releaseKey(`draft:${idAt(draftId)}`),
    releaseIf: async (
      leaseId: string,
      draftId: string,
      host: CampaignHostValues,
    ): Promise<void> => {
      // Cleanup of an earlier async operation must not cancel a newer prepare or depend on liveness.
      const config = configAt(host, false);
      if (config === null) return;
      const key = `draft:${idAt(draftId)}`;
      const lease = leases.get(key);
      if (lease === undefined || lease.id !== leaseId || lease.fingerprint !== fingerprint(config))
        return;
      leases.delete(key);
      await closeLease(lease);
    },
    retainForCampaign: (draftId: string, campaignId: string): void => {
      const key = `draft:${idAt(draftId)}`,
        target = `campaign:${idAt(campaignId)}`;
      const prior = leases.get(target);
      if (prior !== undefined) {
        if (prior.sourceDraftId === draftId && !leases.has(key)) return;
        throw new Error('Campaign already owns another bind lease');
      }
      const lease = leases.get(key);
      if (lease === undefined || !live(lease))
        throw new Error('Campaign bind lease is no longer live');
      leases.delete(key);
      leases.set(target, lease);
    },
    recover: async (
      campaignId: string,
      host: CampaignHostValues,
    ): Promise<CampaignBindRecovery> => {
      const key = `campaign:${idAt(campaignId)}`;
      const config = configAt(host);
      if (config === null) return { status: 'UNAVAILABLE', reasonCode: 'BIND_FAILED' };
      const existing = leases.get(key);
      if (existing !== undefined && existing.fingerprint !== fingerprint(config))
        return { status: 'UNAVAILABLE', reasonCode: 'BIND_FAILED' };
      const result = await reserve(key, config, null, () => `recovery:${campaignId}`);
      return result.status === 'PASS'
        ? { status: 'RESERVED', reasonCode: null }
        : {
            status: 'UNAVAILABLE',
            reasonCode:
              result.reasonCode === 'PORT_UNAVAILABLE' ? 'PORT_UNAVAILABLE' : 'BIND_FAILED',
          };
    },
    close: async (): Promise<void> => {
      closed = true;
      await Promise.all([...new Set([...leases.keys(), ...flights.keys()])].map(releaseKey));
    },
  };
}
export type CampaignBindManager = ReturnType<typeof createCampaignBindManager>;
