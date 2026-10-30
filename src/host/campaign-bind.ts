import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
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
export interface CampaignNetworkEndpoint {
  readonly kind: 'BORROWED_SHELL' | 'OWNED_RESERVATION';
  readonly address: string;
  readonly port: number;
}
export type CampaignSocketAttachment =
  | (CampaignNetworkEndpoint & { readonly kind: 'BORROWED_SHELL' })
  | (CampaignNetworkEndpoint & { readonly kind: 'OWNED_RESERVATION'; readonly detach: () => void });
interface SocketHandler {
  readonly handler: (socket: Socket) => void;
  readonly onError: (error: unknown) => void;
  readonly sockets: Set<Socket>;
  readonly outcome: CampaignSocketAttachment & { readonly kind: 'OWNED_RESERVATION' };
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
  socketHandler: SocketHandler | null;
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

/** Held listeners and optional socket handlers never grant player admission by themselves. */
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
  function detachHandler(lease: Lease, attachment: SocketHandler): void {
    if (lease.socketHandler === attachment) lease.socketHandler = null;
    for (const socket of attachment.sockets) socket.destroy();
  }
  function clearHandler(lease: Lease): void {
    if (lease.socketHandler !== null) detachHandler(lease, lease.socketHandler);
  }
  function reportSocketError(lease: Lease, attachment: SocketHandler, error: unknown): void {
    try {
      attachment.onError(error);
    } catch {
      // A throwing observer must revoke the endpoint, not escape an untrusted socket event.
      if (lease.socketHandler === attachment) lease.failed = true;
      detachHandler(lease, attachment);
    }
  }
  function closeLease(lease: Lease): Promise<void> {
    if (lease.closePromise !== undefined) return lease.closePromise;
    lease.failed = true;
    clearHandler(lease);
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
      socketHandler: null,
      failed: false,
    };
    if (shell !== null) return lease;
    const server = createServer((socket) => {
      const attachment = owned.socketHandler;
      if (attachment === null) {
        socket.destroy();
        return;
      }
      const socketError = (error: Error): void => {
        socket.destroy();
        reportSocketError(owned, attachment, error);
      };
      attachment.sockets.add(socket);
      socket.on('error', socketError);
      socket.once('close', () => {
        attachment.sockets.delete(socket);
        socket.off('error', socketError);
      });
      try {
        if (!live(owned)) {
          clearHandler(owned);
          socket.destroy();
          return;
        }
        void Promise.resolve(attachment.handler(socket)).catch((error: unknown) => {
          socket.destroy();
          reportSocketError(owned, attachment, error);
        });
      } catch (error) {
        socket.destroy();
        reportSocketError(owned, attachment, error);
      }
    });
    const owned: Lease = { ...lease, server };
    server.on('error', (error) => {
      owned.failed = true;
      const attachment = owned.socketHandler;
      clearHandler(owned);
      if (attachment !== null) reportSocketError(owned, attachment, error);
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
  function campaignLease(campaignId: string): Lease | null {
    const lease = leases.get(`campaign:${idAt(campaignId)}`);
    if (lease === undefined) return null;
    if (live(lease)) return lease;
    clearHandler(lease);
    return null;
  }
  function endpoint(lease: Lease): CampaignNetworkEndpoint {
    return {
      kind: lease.server === null ? 'BORROWED_SHELL' : 'OWNED_RESERVATION',
      address: lease.config.hostAddress,
      port: lease.config.hostPort,
    };
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
    endpointForCampaign: (campaignId: string): CampaignNetworkEndpoint | null => {
      const lease = campaignLease(campaignId);
      return lease === null ? null : endpoint(lease);
    },
    attachCampaignSocketHandler: (
      campaignId: string,
      handler: (socket: Socket) => void,
      onError: (error: unknown) => void,
    ): CampaignSocketAttachment => {
      if (typeof handler !== 'function' || typeof onError !== 'function')
        throw new TypeError('Campaign socket handler and error observer are required');
      const lease = campaignLease(campaignId);
      if (lease === null) throw new Error('Campaign bind lease is unknown or expired');
      const current = endpoint(lease);
      if (current.kind === 'BORROWED_SHELL') return { ...current, kind: 'BORROWED_SHELL' };
      if (lease.socketHandler !== null) {
        if (lease.socketHandler.handler !== handler)
          throw new Error('Campaign bind lease already has another socket handler');
        return lease.socketHandler.outcome;
      }
      const attachment: SocketHandler = {
        handler,
        onError,
        sockets: new Set(),
        outcome: {
          ...current,
          kind: 'OWNED_RESERVATION',
          detach: () => detachHandler(lease, attachment),
        },
      };
      lease.socketHandler = attachment;
      return attachment.outcome;
    },
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
      const existing = leases.get(key);
      if (
        config === null ||
        (existing !== undefined && existing.fingerprint !== fingerprint(config))
      ) {
        if (existing !== undefined) clearHandler(existing);
        return { status: 'UNAVAILABLE', reasonCode: 'BIND_FAILED' };
      }
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
