import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';
import type { CampaignHostValues } from '@shared/campaign-creation.js';
import {
  createCampaignBindManager,
  type CampaignBindManager,
  type CampaignShellListener,
} from './campaign-bind.js';

const managers: CampaignBindManager[] = [];
const servers: Server[] = [];
const ipv4 = (address: string): NetworkInterfaceInfo => ({
  address,
  family: 'IPv4',
  internal: true,
  netmask: '255.0.0.0',
  mac: '00:00:00:00:00:00',
  cidr: `${address}/8`,
});
const testInterfaces = () => ({ local: [ipv4('127.0.0.1')] });
const manager = (
  options: Parameters<typeof createCampaignBindManager>[0] = { readShellListener: () => null },
): CampaignBindManager => {
  const result = createCampaignBindManager({ readNetworkInterfaces: testInterfaces, ...options });
  managers.push(result);
  return result;
};
const config = (port: number, values: Partial<CampaignHostValues> = {}): CampaignHostValues => ({
  activePlayerCapacity: 3,
  hostAddress: '127.0.0.1',
  hostPort: port,
  networkInterface: 'local',
  ...values,
});
const listen = async (port = 0, host = '127.0.0.1'): Promise<Server> => {
  const server = createServer((socket) => socket.destroy());
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host, exclusive: true }, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
};
const portOf = (server: Server): number => {
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Test server has no TCP address');
  return address.port;
};
const closeServer = async (server: Server): Promise<void> => {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
};
const unusedPort = async (): Promise<number> => {
  const probe = await listen();
  const port = portOf(probe);
  await closeServer(probe);
  return port;
};
const occupied = async (port: number): Promise<boolean> => {
  try {
    await closeServer(await listen(port));
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') return true;
    throw error;
  }
};
afterEach(async () => {
  await Promise.all(managers.splice(0).map((item) => item.close()));
  await Promise.all(servers.splice(0).map(closeServer));
});

describe('campaign bind reservations (ADR 0064)', () => {
  it('enumerates actual OS addresses by default and canonicalizes only usable unicast interface values', () => {
    const real = createCampaignBindManager({ readShellListener: () => null });
    managers.push(real);
    expect(real.interfaces().some((row) => row.hostAddress === '127.0.0.1')).toBe(true);
    const six = (address: string, scopeid = 0): NetworkInterfaceInfo => ({
      address,
      family: 'IPv6',
      scopeid,
      internal: false,
      netmask: 'ffff:ffff:ffff:ffff::',
      mac: '00:00:00:00:00:00',
      cidr: `${address}/64`,
    });
    const m = manager({
      readShellListener: () => null,
      readNetworkInterfaces: () => ({
        local: [
          ipv4('0.0.0.0'),
          ipv4('127.0.0.1'),
          ipv4('127.0.0.1'),
          six('::'),
          six('fe80::1'),
          six('fe80::1%4', 4),
          six('2001:db8::1', 2),
          six('0:0:0:0:0:0:0:1'),
          six('::ffff:127.0.0.1'),
        ],
      }),
    });
    expect(m.interfaces()).toEqual([
      { networkInterface: 'local', hostAddress: '127.0.0.1', family: 'IPv4' },
      { networkInterface: 'local', hostAddress: '::1', family: 'IPv6' },
    ]);
  });
  it('holds an exclusive real TCP bind until release, with stable same-config reuse and exact binding', async () => {
    let allocations = 0;
    const m = manager({
      readShellListener: () => null,
      allocateLeaseId: () => `lease-${++allocations}`,
    });
    const port = await unusedPort();
    const host = config(port);
    const proof = await m.prepare('draft', host);
    expect(proof).toEqual({ status: 'PASS', reasonCode: null, leaseIdOrNull: 'lease-1' });
    expect(await occupied(port)).toBe(true);
    expect(await m.prepare('draft', host)).toEqual(proof);
    expect(allocations).toBe(1);
    expect(m.validate('lease-1', 'draft', host)).toBe(true);
    expect(m.validate('other', 'draft', host)).toBe(false);
    expect(m.validate('lease-1', 'other-draft', host)).toBe(false);
    expect(m.validate('lease-1', 'draft', config(port, { activePlayerCapacity: 4 }))).toBe(false);
    expect(m.describe('draft', config(port + (port === 65535 ? -1 : 1)))).toMatchObject({
      status: 'FAIL',
      reasonCode: 'LEASE_EXPIRED',
    });
    await m.release('draft');
    expect(m.describe('draft', host)).toEqual({
      status: 'NOT_CHECKED',
      reasonCode: null,
      leaseIdOrNull: null,
    });
    expect(await occupied(port)).toBe(false);
  });
  it('rejects a genuinely occupied port and unknown/mismatched interfaces without borrowing an unrelated shell', async () => {
    const shell = await listen();
    const port = portOf(shell);
    const m = manager({
      readShellListener: () => ({
        address: '127.0.0.1',
        port: port === 65535 ? port - 1 : port + 1,
      }),
    });
    expect(await m.prepare('draft', config(port))).toEqual({
      status: 'FAIL',
      reasonCode: 'PORT_UNAVAILABLE',
      leaseIdOrNull: null,
    });
    for (const patch of [
      { networkInterface: 'foreign' },
      { hostAddress: '127.0.0.2' },
      { hostAddress: '0.0.0.0' },
      { hostAddress: '::' },
      { hostAddress: 'fe80::1%4' },
      { hostPort: 0 },
      { hostPort: 65536 },
      { hostPort: 3.2 },
    ])
      expect(await m.prepare('draft', config(port, patch))).toEqual({
        status: 'FAIL',
        reasonCode: 'INVALID_INTERFACE',
        leaseIdOrNull: null,
      });
    expect(shell.listening).toBe(true);
  });
  it('borrows the real shell only while its exact listener remains live and never closes it', async () => {
    const shell = await listen();
    const port = portOf(shell);
    let visible = true;
    const readShellListener = (): CampaignShellListener | null => {
      const address = shell.address();
      return !visible || !shell.listening || address === null || typeof address === 'string'
        ? null
        : { address: address.address, port: address.port };
    };
    const m = manager({ readShellListener });
    const proof = await m.prepare('draft', config(port));
    expect(proof.status).toBe('PASS');
    expect(m.validate(proof.leaseIdOrNull!, 'draft', config(port))).toBe(true);
    visible = false;
    expect(m.validate(proof.leaseIdOrNull!, 'draft', config(port))).toBe(false);
    visible = true;
    await m.release('draft');
    expect(shell.listening).toBe(true);
    const again = await m.prepare('draft', config(port));
    await closeServer(shell);
    expect(m.validate(again.leaseIdOrNull!, 'draft', config(port))).toBe(false);
    await m.close();
  });
  it('does not treat the same port on a different bound address as borrowed coverage', async () => {
    const blocker = await listen();
    const port = portOf(blocker);
    const m = manager({ readShellListener: () => ({ address: '127.0.0.2', port }) });
    expect(await m.prepare('draft', config(port))).toMatchObject({
      status: 'FAIL',
      reasonCode: 'PORT_UNAVAILABLE',
    });
  });
  it('borrows actual wildcard IPv4 coverage without closing the shell', async () => {
    const shell = await listen(0, '0.0.0.0');
    const port = portOf(shell);
    const m = manager({
      readShellListener: () => (shell.listening ? { address: '0.0.0.0', port } : null),
    });
    expect((await m.prepare('draft', config(port))).status).toBe('PASS');
    await m.close();
    expect(shell.listening).toBe(true);
  });
  it('shares concurrent equal prepares and cancels an in-flight bind without leaking a listener', async () => {
    let allocations = 0;
    const m = manager({
      readShellListener: () => null,
      allocateLeaseId: () => `race-${++allocations}`,
    });
    const port = await unusedPort();
    const [one, two] = await Promise.all([
      m.prepare('draft', config(port)),
      m.prepare('draft', config(port)),
    ]);
    expect(one.status).toBe('PASS');
    expect(two).toEqual(one);
    expect(allocations).toBe(1);
    await m.release('draft');
    const pending = m.prepare('cancelled', config(port));
    const releasing = m.release('cancelled');
    expect(await pending).toMatchObject({ status: 'FAIL', reasonCode: 'LEASE_EXPIRED' });
    await releasing;
    expect(await occupied(port)).toBe(false);
  });
  it('replaces a changed config only after releasing the earlier reservation', async () => {
    const m = manager();
    const port = await unusedPort();
    const first = await m.prepare('draft', config(port));
    const updated = await m.prepare('draft', config(port, { activePlayerCapacity: 4 }));
    expect(updated.status).toBe('PASS');
    expect(updated.leaseIdOrNull).not.toBe(first.leaseIdOrNull);
    expect(m.validate(first.leaseIdOrNull!, 'draft', config(port))).toBe(false);
    expect(
      m.validate(updated.leaseIdOrNull!, 'draft', config(port, { activePlayerCapacity: 4 })),
    ).toBe(true);
  });
  it('supersedes an unfinished prepare and releases an owned lease when the replacement configuration is invalid', async () => {
    const m = manager();
    const port = await unusedPort();
    const first = m.prepare('draft', config(port));
    const replacement = m.prepare('draft', config(port, { activePlayerCapacity: 4 }));
    expect(await first).toMatchObject({ status: 'FAIL', reasonCode: 'LEASE_EXPIRED' });
    const held = await replacement;
    expect(held.status).toBe('PASS');
    expect(await occupied(port)).toBe(true);
    expect(await m.prepare('draft', config(port, { networkInterface: 'foreign' }))).toMatchObject({
      status: 'FAIL',
      reasonCode: 'INVALID_INTERFACE',
    });
    expect(await occupied(port)).toBe(false);
    expect(
      m.validate(held.leaseIdOrNull!, 'draft', config(port, { activePlayerCapacity: 4 })),
    ).toBe(false);
  });
  it('rechecks actual interface availability synchronously before commit', async () => {
    let present = true;
    const m = manager({
      readShellListener: () => null,
      readNetworkInterfaces: () => (present ? testInterfaces() : {}),
    });
    const port = await unusedPort();
    const proof = await m.prepare('draft', config(port));
    present = false;
    expect(m.validate(proof.leaseIdOrNull!, 'draft', config(port))).toBe(false);
    await m.release('draft');
    expect(await occupied(port)).toBe(false);
  });
  it('conditionally releases only the recorded lease, including one whose interface has disappeared', async () => {
    let present = true;
    const m = manager({
      readShellListener: () => null,
      readNetworkInterfaces: () => (present ? testInterfaces() : {}),
    });
    const port = await unusedPort();
    const host = config(port);
    const original = await m.prepare('draft', host);
    await m.releaseIf('other-id', 'draft', host);
    await m.releaseIf(original.leaseIdOrNull!, 'other-draft', host);
    await m.releaseIf(original.leaseIdOrNull!, 'draft', config(port, { activePlayerCapacity: 4 }));
    expect(m.validate(original.leaseIdOrNull!, 'draft', host)).toBe(true);
    expect(await occupied(port)).toBe(true);
    const updatedHost = config(port, { activePlayerCapacity: 4 });
    const updated = await m.prepare('draft', updatedHost);
    await m.releaseIf(original.leaseIdOrNull!, 'draft', host);
    expect(m.validate(updated.leaseIdOrNull!, 'draft', updatedHost)).toBe(true);
    present = false;
    expect(m.validate(updated.leaseIdOrNull!, 'draft', updatedHost)).toBe(false);
    await m.releaseIf(updated.leaseIdOrNull!, 'draft', updatedHost);
    expect(await occupied(port)).toBe(false);
  });
  it('does not cancel an unfinished prepare when no recorded lease matches conditional cleanup', async () => {
    const m = manager();
    const port = await unusedPort();
    const pending = m.prepare('draft', config(port));
    await m.releaseIf('expired-lease', 'draft', config(port));
    expect((await pending).status).toBe('PASS');
    expect(await occupied(port)).toBe(true);
  });
  it('transfers a committed lease without rebinding and recovers idempotently without allocating IDs', async () => {
    let allocations = 0;
    const m = manager({
      readShellListener: () => null,
      allocateLeaseId: () => `owned-${++allocations}`,
    });
    const port = await unusedPort();
    const host = config(port);
    expect((await m.prepare('draft', host)).status).toBe('PASS');
    m.retainForCampaign('draft', 'campaign');
    m.retainForCampaign('draft', 'campaign');
    await m.release('draft');
    expect(await occupied(port)).toBe(true);
    expect(await m.recover('campaign', host)).toEqual({ status: 'RESERVED', reasonCode: null });
    expect(await m.recover('campaign', host)).toEqual({ status: 'RESERVED', reasonCode: null });
    expect(allocations).toBe(1);
    expect(await m.recover('campaign', config(port, { activePlayerCapacity: 4 }))).toEqual({
      status: 'UNAVAILABLE',
      reasonCode: 'BIND_FAILED',
    });
    await m.close();
    expect(await occupied(port)).toBe(false);
    const reopened = manager({
      readShellListener: () => null,
      allocateLeaseId: () => {
        throw new Error('Recovery must not allocate');
      },
    });
    expect(await reopened.recover('campaign', host)).toEqual({
      status: 'RESERVED',
      reasonCode: null,
    });
    expect(await reopened.recover('campaign', host)).toEqual({
      status: 'RESERVED',
      reasonCode: null,
    });
    expect(await occupied(port)).toBe(true);
  });
  it('returns a diagnostic when the saved endpoint is occupied after restart and closes all reservations on shutdown', async () => {
    const blocker = await listen();
    const m = manager();
    const host = config(portOf(blocker));
    expect(await m.recover('campaign', host)).toEqual({
      status: 'UNAVAILABLE',
      reasonCode: 'PORT_UNAVAILABLE',
    });
    expect(blocker.listening).toBe(true);
    const port = await unusedPort();
    const pending = m.prepare('draft', config(port));
    await m.close();
    expect(await pending).toMatchObject({ status: 'FAIL' });
    expect(await occupied(port)).toBe(false);
    expect(await m.prepare('after-close', config(port))).toMatchObject({
      status: 'FAIL',
      reasonCode: 'LEASE_EXPIRED',
    });
  });
});
