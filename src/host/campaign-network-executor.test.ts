import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCampaignLanAddress } from './campaign-lan-address.js';
import {
  acceptCampaignPeerChannel,
  connectCampaignPeerChannel,
  CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
  type CampaignPeerServerChannel,
} from './campaign-peer-channel.js';
import {
  campaignPeerPublicIdentity,
  generateDeviceInstallationIdentityMaterial,
} from './campaign-peer-identity.js';
import { canonicalPostSaveJson } from './local-character-export.js';
import {
  decodeDeviceAdmissionPeerCommand,
  encodeDeviceAdmissionPeerCommand,
} from './device-admission-peer-commands.js';
import {
  createCampaignNetworkExecutor,
  CampaignNetworkExecutorError,
  type CampaignNetworkExecutionScope,
  type CampaignNetworkExecutorOptions,
} from './campaign-network-executor.js';

const HOST = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';
const TRANSFER = '66666666-6666-4666-8666-666666666666';
const host = generateDeviceInstallationIdentityMaterial(HOST);
const device = generateDeviceInstallationIdentityMaterial(DEVICE);
const limits = {
  handshakeTimeoutMs: 2000,
  rpcTimeoutMs: 2000,
  maxQueuedFrames: 8,
  maxQueuedBytes: 1024 * 1024,
  maxPendingCalls: 4,
};
const commandLimits = {
  maxSubmitBodyBytes: 1024 * 1024,
  maxWitnessBytes: 1024 * 1024,
  maxChunkBytes: 1024,
};
const cleaners: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of cleaners.splice(0).reverse()) await close();
});
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function actualChannels(campaignId = CAMPAIGN) {
  const http = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
    perMessageDeflate: false,
  });
  const waiters: ReturnType<typeof deferred<CampaignPeerServerChannel>>[] = [];
  const servers: CampaignPeerServerChannel[] = [];
  const clients: Awaited<ReturnType<typeof connectCampaignPeerChannel>>[] = [];
  const failures: unknown[] = [];
  http.on('upgrade', (request, socket, head) =>
    wss.handleUpgrade(request, socket, head, (peer) => {
      const pending = waiters.shift();
      void acceptCampaignPeerChannel(peer, request, {
        limits,
        resolveCampaign: (id) =>
          id !== campaignId
            ? null
            : {
                hostMaterial: host,
                campaign: {
                  campaignId,
                  title: 'Executor transport test',
                  status: 'PAUSED',
                  activePlayerCapacity: 3,
                  activePcCount: 0,
                  checkpointSha256: 'a'.repeat(64),
                  baselineVersion: `sha256:${'b'.repeat(64)}`,
                  revisions: {
                    stateRevision: 0,
                    projectionRevision: 0,
                    actorVisibilityRevision: 0,
                  },
                },
              },
      }).then(
        (server) => {
          servers.push(server);
          pending?.resolve(server);
        },
        (error: unknown) => {
          failures.push(error);
          pending?.reject(error);
        },
      );
    }),
  );
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  if (address === null || typeof address === 'string') throw new Error('TCP endpoint required');
  const target = parseCampaignLanAddress(`http://127.0.0.1:${String(address.port)}`);
  cleaners.push(async () => {
    for (const client of clients) client.close();
    for (const server of servers) server.close();
    for (const peer of wss.clients) peer.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
    expect(failures).toEqual([]);
  });
  return {
    connect: async () => {
      const pending = deferred<CampaignPeerServerChannel>();
      waiters.push(pending);
      const client = await connectCampaignPeerChannel({
        target,
        campaignId,
        deviceMaterial: device,
        hostTrust: { kind: 'PINNED', identity: campaignPeerPublicIdentity(host) },
        limits,
      });
      clients.push(client);
      return { client, server: await pending.promise };
    },
  };
}
const scope: CampaignNetworkExecutionScope = { kind: 'SESSION', id: SESSION };
function executor(
  options: CampaignNetworkExecutorOptions = { maxScopes: 1024, maxScopeBytes: 8 * 1024 * 1024 },
) {
  const result = createCampaignNetworkExecutor(options);
  cleaners.push(() => result.close());
  return result;
}

describe('campaign application queue and RAM transport generations', () => {
  it.each([
    null,
    {},
    { maxScopes: 0, maxScopeBytes: 1 },
    { maxScopes: 1, maxScopeBytes: -1 },
    { maxScopes: 1.5, maxScopeBytes: 1 },
    { maxScopes: 1, maxScopeBytes: Number.MAX_SAFE_INTEGER + 1 },
    { maxScopes: 1, maxScopeBytes: 1, extra: true },
  ])('rejects invalid or nonclosed explicit scope budgets: %j', (value) => {
    expect(() => createCampaignNetworkExecutor(value as CampaignNetworkExecutorOptions)).toThrow(
      'campaign network executor: INVALID_CONFIG',
    );
  });

  it('bounds scope count without evicting a live recovery barrier and resets only after every old handle closes', async () => {
    const transport = await actualChannels(),
      a = await transport.connect(),
      b = await transport.connect(),
      ex = executor({ maxScopes: 1, maxScopeBytes: 8 * 1024 * 1024 }),
      one = ex.registerChannel(a.server),
      two = ex.registerChannel(b.server),
      old = ex.bindScope(one, scope),
      fresh = ex.recoverScope(two, scope);
    expect(fresh.generation).toBe(2);
    expect(() => ex.bindScope(two, { kind: 'ATTEMPT', id: 'another' })).toThrow(
      'campaign network executor: SCOPE_LIMIT',
    );
    ex.assertCurrent(fresh);
    expect(ex.recoverScope(two, scope)).toBe(fresh);
    ex.closeChannel(two);
    expect(() => ex.recoverScope(one, scope)).toThrow(
      'campaign network executor: STALE_GENERATION',
    );
    expect(() => ex.bindScope(one, { kind: 'ATTEMPT', id: 'another' })).toThrow(
      'campaign network executor: SCOPE_LIMIT',
    );
    ex.closeChannel(one);
    expect(() => ex.assertCurrent(old)).toThrow(CampaignNetworkExecutorError);
    const c = await transport.connect(),
      next = ex.registerChannel(c.server);
    expect(ex.bindScope(next, { kind: 'ATTEMPT', id: 'another' }).generation).toBe(1);
  });

  it('counts exact UTF-8 key bytes and refuses a new scope before any partial allocation', async () => {
    const transport = await actualChannels(),
      a = await transport.connect(),
      id = 'И🧪',
      bytes = Buffer.byteLength(
        JSON.stringify([CAMPAIGN, DEVICE, device.keyFingerprintSha256, 'ATTEMPT', id]),
        'utf8',
      ),
      ex = executor({ maxScopes: 10, maxScopeBytes: bytes }),
      channel = ex.registerChannel(a.server);
    expect(() => ex.bindScope(channel, { kind: 'ATTEMPT', id: id + 'x' })).toThrow(
      'campaign network executor: SCOPE_LIMIT',
    );
    const lease = ex.bindScope(channel, { kind: 'ATTEMPT', id });
    expect(lease.generation).toBe(1);
    expect(() => ex.bindScope(channel, scope)).toThrow('campaign network executor: SCOPE_LIMIT');
    ex.assertCurrent(lease);
  });

  it('registers actual proved channels as frozen opaque handles and rejects structural counterfeits', async () => {
    const transport = await actualChannels();
    const a = await transport.connect();
    const ex = executor();
    const handle = ex.registerChannel(a.server);
    expect(handle).toEqual({
      campaignId: CAMPAIGN,
      peerDeviceId: DEVICE,
      peerKeyFingerprintSha256: device.keyFingerprintSha256,
    });
    expect(ex.registerChannel(a.server)).toBe(handle);
    expect(Object.isFrozen(handle)).toBe(true);
    const lease = ex.bindScope(handle, scope);
    expect(Object.isFrozen(lease.scope)).toBe(true);
    expect(lease.generation).toBe(1);
    expect(() => ex.assertCurrent({ ...lease })).toThrow(CampaignNetworkExecutorError);
    expect(() => ex.bindScope({ ...handle }, scope)).toThrow(CampaignNetworkExecutorError);
    expect(JSON.stringify(lease)).not.toContain(host.privateKeyPkcs8Base64);
    expect(JSON.stringify(lease)).not.toContain(device.privateKeyPkcs8Base64);
  });

  it('serializes campaigns across real channels but does not serialize an unrelated campaign', async () => {
    const transport = await actualChannels();
    const other = await actualChannels(OTHER);
    const a = await transport.connect(),
      b = await transport.connect(),
      c = await other.connect();
    const ex = executor();
    const one = ex.registerChannel(a.server),
      two = ex.registerChannel(b.server),
      three = ex.registerChannel(c.server);
    const begun = deferred(),
      gate = deferred();
    const order: string[] = [];
    const first = ex.run(one, async () => {
      order.push('one:start');
      begun.resolve();
      await gate.promise;
      order.push('one:end');
    });
    await begun.promise;
    const second = ex.run(two, () => {
      order.push('two');
    });
    await ex.run(three, () => {
      order.push('other');
    });
    expect(order).toEqual(['one:start', 'other']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['one:start', 'other', 'one:end', 'two']);
  });

  it('a failed operation does not poison the campaign queue or leak its private exception', async () => {
    const transport = await actualChannels();
    const a = await transport.connect();
    const ex = executor(),
      channel = ex.registerChannel(a.server);
    const failed = ex.run(channel, () => {
      throw new Error('PRIVATE_COMMAND_BODY');
    });
    const error: unknown = await failed.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CampaignNetworkExecutorError);
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('PRIVATE_COMMAND_BODY');
    await expect(ex.run(channel, () => 7)).resolves.toBe(7);
    const result = ex.run(channel, () => Promise.reject(new Error('PRIVATE_ASYNC_BODY')));
    await expect(result).rejects.toThrow('campaign network executor: EXECUTION_FAILED');
  });

  it('recovery retires only the same ATTEMPT/SESSION scope and the old channel cannot reacquire it', async () => {
    const transport = await actualChannels();
    const a = await transport.connect(),
      b = await transport.connect();
    const ex = executor();
    const one = ex.registerChannel(a.server),
      two = ex.registerChannel(b.server);
    const old = ex.bindScope(one, scope);
    const another = ex.bindScope(one, { kind: 'SESSION', id: 'another-real-session' });
    const attempt = ex.bindScope(one, { kind: 'ATTEMPT', id: SESSION });
    const revoke = vi.fn();
    ex.trackTransfer(old, TRANSFER, revoke);
    expect(() => ex.bindScope(two, scope)).toThrow(CampaignNetworkExecutorError);
    const fresh = ex.recoverScope(two, scope);
    expect(fresh.generation).toBe(2);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(ex.recoverScope(two, scope)).toBe(fresh);
    expect(() => ex.assertCurrent(old)).toThrow(CampaignNetworkExecutorError);
    expect(() => ex.bindScope(one, scope)).toThrow(CampaignNetworkExecutorError);
    expect(() => ex.recoverScope(one, scope)).toThrow(CampaignNetworkExecutorError);
    ex.assertCurrent(fresh);
    ex.assertCurrent(another);
    ex.assertCurrent(attempt);
    expect(a.server.closed).toBe(false);
  });

  it('real TCP late COMMIT after new-channel NOT_FOUND cannot create a request and does not free immutable outbox', async () => {
    const transport = await actualChannels();
    const a = await transport.connect(),
      b = await transport.connect();
    const ex = executor();
    const one = ex.registerChannel(a.server),
      two = ex.registerChannel(b.server),
      old = ex.bindScope(one, scope);
    let staged = true,
      writes = 0;
    ex.trackTransfer(old, TRANSFER, () => {
      staged = false;
    });
    const outbox = Object.freeze({
      requestId: OTHER,
      submitCommandId: 'same-submit',
      bodyBytes: 'original immutable bytes',
      status: 'UNRESOLVED',
    });
    const oldOutbox = JSON.stringify(outbox);
    const recovery = (async () => {
      const request = await b.server.receiveRequest();
      const command = decodeDeviceAdmissionPeerCommand(request.bodyJson, commandLimits);
      expect(command.operation).toBe('DEVICE_REQUEST_RECOVER');
      await ex.run(two, () => {
        ex.recoverScope(two, scope);
      });
      await b.server.respond(
        request.sequenceNumber,
        canonicalPostSaveJson({ result: 'NOT_FOUND' }),
      );
    })();
    const negative = await b.client.call(
      encodeDeviceAdmissionPeerCommand(
        {
          schemaVersion: 1,
          operation: 'DEVICE_REQUEST_RECOVER',
          requestId: OTHER,
          technicalSessionId: SESSION,
          submitCommandId: 'same-submit',
        },
        commandLimits,
      ),
    );
    expect(JSON.parse(negative)).toEqual({ result: 'NOT_FOUND' });
    await recovery;
    expect(staged).toBe(false);
    // The old physical channel remains real/live: the stale scope guard, not queue timing, refuses it.
    const commit = (async () => {
      const request = await a.server.receiveRequest();
      const command = decodeDeviceAdmissionPeerCommand(request.bodyJson, commandLimits);
      expect(command.operation).toBe('DEVICE_REQUEST_COMMIT');
      let result = 'REFUSED';
      try {
        await ex.run(one, () => {
          ex.assertCurrent(old);
          writes++;
        });
        result = 'COMMITTED';
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(CampaignNetworkExecutorError);
      }
      await a.server.respond(request.sequenceNumber, canonicalPostSaveJson({ result }));
    })();
    const reply = await a.client.call(
      encodeDeviceAdmissionPeerCommand(
        { schemaVersion: 1, operation: 'DEVICE_REQUEST_COMMIT', transferId: TRANSFER },
        commandLimits,
      ),
    );
    expect(JSON.parse(reply)).toEqual({ result: 'REFUSED' });
    await commit;
    expect(writes).toBe(0);
    expect(JSON.stringify(outbox)).toBe(oldOutbox);
  });

  it('rechecks an old generation after asynchronous validation before the final synchronous writer', async () => {
    const transport = await actualChannels();
    const a = await transport.connect(),
      b = await transport.connect();
    const ex = executor();
    const one = ex.registerChannel(a.server),
      two = ex.registerChannel(b.server),
      old = ex.bindScope(one, scope);
    const validation = deferred();
    let writes = 0;
    const pending = (async () => {
      await validation.promise;
      ex.assertCurrent(old);
      writes++;
    })();
    const refused = expect(pending).rejects.toBeInstanceOf(CampaignNetworkExecutorError);
    await ex.run(two, () => {
      ex.recoverScope(two, scope);
    });
    validation.resolve();
    await refused;
    expect(writes).toBe(0);
  });

  it('fences an old real channel even when its first scope binding was still delayed', async () => {
    const transport = await actualChannels(),
      a = await transport.connect(),
      b = await transport.connect(),
      ex = executor();
    const old = ex.registerChannel(a.server),
      fresh = ex.registerChannel(b.server);
    const other = ex.bindScope(old, { kind: 'SESSION', id: 'different-logical-session' });
    const recovered = ex.recoverScope(fresh, scope);
    const ready = (async () => {
      const request = await b.server.receiveRequest();
      await b.server.respond(
        request.sequenceNumber,
        canonicalPostSaveJson({
          outcome: 'NOT_FOUND',
          fenced: true,
          generation: recovered.generation,
        }),
      );
    })();
    expect(
      JSON.parse(await b.client.call(canonicalPostSaveJson({ operation: 'TEST_RECOVER' }))),
    ).toMatchObject({ outcome: 'NOT_FOUND', fenced: true });
    await ready;
    expect(() => ex.bindScope(old, scope)).toThrow(CampaignNetworkExecutorError);
    expect(() => ex.recoverScope(old, scope)).toThrow(CampaignNetworkExecutorError);
    ex.assertCurrent(other);
    const c = await transport.connect(),
      newTransport = ex.registerChannel(c.server);
    expect(ex.recoverScope(newTransport, scope).generation).toBe(recovered.generation + 1);
  });

  it('transfer cleanup is exact, duplicate-safe and a stale disposer cannot erase a replacement', async () => {
    const transport = await actualChannels();
    const a = await transport.connect(),
      b = await transport.connect();
    const ex = executor();
    const one = ex.registerChannel(a.server),
      two = ex.registerChannel(b.server),
      old = ex.bindScope(one, scope);
    const revoke = vi.fn();
    const stale = ex.trackTransfer(old, TRANSFER, revoke);
    expect(() => ex.trackTransfer(old, TRANSFER, revoke)).toThrow(CampaignNetworkExecutorError);
    stale();
    ex.trackTransfer(old, TRANSFER, revoke);
    stale();
    ex.recoverScope(two, scope);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(() => ex.trackTransfer(old, 'another', revoke)).toThrow(CampaignNetworkExecutorError);
  });

  it('does not interpret an ordinary synchronous cleanup return as a failure status', async () => {
    const transport = await actualChannels();
    const a = await transport.connect(),
      b = await transport.connect();
    const ex = executor();
    const one = ex.registerChannel(a.server),
      two = ex.registerChannel(b.server),
      old = ex.bindScope(one, scope);
    const staged = new Map([[TRANSFER, 'bytes']]);
    ex.trackTransfer(old, TRANSFER, () => staged.delete(TRANSFER));
    ex.recoverScope(two, scope);
    expect(staged.size).toBe(0);
  });

  it.each(['throw', 'reject', 'thrown-promise', 'then-getter'] as const)(
    'contains %s revocation callbacks while fencing every old transfer',
    async (mode) => {
      const transport = await actualChannels();
      const a = await transport.connect(),
        b = await transport.connect();
      const ex = executor();
      const one = ex.registerChannel(a.server),
        two = ex.registerChannel(b.server),
        old = ex.bindScope(one, scope);
      const getter = vi.fn();
      ex.trackTransfer(old, TRANSFER, () => {
        if (mode === 'throw') throw new Error('PRIVATE_BYTES');
        if (mode === 'reject') return Promise.reject(new Error('PRIVATE_BYTES'));
        if (mode === 'thrown-promise') {
          const rejected: unknown = Promise.reject(new Error('PRIVATE_BYTES'));
          throw rejected;
        }
        return Object.defineProperty({}, 'then', { get: getter });
      });
      const other = vi.fn();
      ex.trackTransfer(old, 'other-transfer', other);
      expect(() => ex.recoverScope(two, scope)).toThrow(
        'campaign network executor: REVOCATION_FAILED',
      );
      expect(other).toHaveBeenCalledTimes(1);
      expect(getter).not.toHaveBeenCalled();
      expect(() => ex.assertCurrent(old)).toThrow(CampaignNetworkExecutorError);
    },
  );

  it('rejects thenable execution results without executing getters or reflecting input', async () => {
    const transport = await actualChannels();
    const a = await transport.connect();
    const ex = executor();
    const channel = ex.registerChannel(a.server),
      getter = vi.fn();
    await expect(
      ex.run(channel, () => Object.defineProperty({}, 'then', { get: getter })),
    ).rejects.toThrow('campaign network executor: EXECUTION_FAILED');
    expect(getter).not.toHaveBeenCalled();
  });

  it('close revokes active/queued work and RAM transfers idempotently and a new executor cannot reuse old leases', async () => {
    const transport = await actualChannels();
    const a = await transport.connect();
    const ex = executor();
    const channel = ex.registerChannel(a.server),
      lease = ex.bindScope(channel, scope),
      revoke = vi.fn();
    ex.trackTransfer(lease, TRANSFER, revoke);
    ex.closeChannel(channel);
    ex.closeChannel(channel);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(() => ex.assertCurrent(lease)).toThrow(CampaignNetworkExecutorError);
    ex.close();
    ex.close();
    await expect(
      ex.run(channel, () => {
        throw new Error('must not execute');
      }),
    ).rejects.toThrow('campaign network executor: CLOSED');
    const next = executor();
    expect(() => next.assertCurrent(lease)).toThrow(CampaignNetworkExecutorError);
    expect(() => next.bindScope(channel, scope)).toThrow(CampaignNetworkExecutorError);
  });

  it('shutdown refuses queued callbacks and the mandatory guard stops an already preparing writer', async () => {
    const transport = await actualChannels();
    const a = await transport.connect();
    const ex = executor(),
      channel = ex.registerChannel(a.server),
      lease = ex.bindScope(channel, scope);
    const preparing = deferred(),
      finish = deferred();
    let writes = 0;
    const active = ex.run(channel, async () => {
      preparing.resolve();
      await finish.promise;
      ex.assertCurrent(lease);
      writes++;
    });
    const activeOutcome = active.catch((error: unknown) => error);
    await preparing.promise;
    const queued = ex.run(channel, () => {
      writes++;
    });
    const queuedOutcome = queued.catch((error: unknown) => error);
    ex.close();
    finish.resolve();
    expect(await activeOutcome).toBeInstanceOf(CampaignNetworkExecutorError);
    expect(await queuedOutcome).toBeInstanceOf(CampaignNetworkExecutorError);
    expect(writes).toBe(0);
  });

  it('rejects malformed scopes and an already closed actual channel', async () => {
    const transport = await actualChannels();
    const a = await transport.connect();
    const ex = executor();
    const channel = ex.registerChannel(a.server);
    for (const value of [
      null,
      {},
      { kind: 'ROLE', id: SESSION },
      { kind: 'SESSION', id: '' },
      { kind: 'SESSION', id: SESSION, role: 'gm' },
    ])
      expect(() => ex.bindScope(channel, value as CampaignNetworkExecutionScope)).toThrow(
        CampaignNetworkExecutorError,
      );
    a.server.close();
    expect(() => ex.registerChannel(a.server)).toThrow(CampaignNetworkExecutorError);
  });
});
