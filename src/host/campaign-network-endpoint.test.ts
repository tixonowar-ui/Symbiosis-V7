import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createServer, get, type IncomingMessage, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createCampaignBindManager } from './campaign-bind.js';
import {
  acceptCampaignPeerChannel,
  CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
} from './campaign-peer-channel.js';
import { generateDeviceInstallationIdentityMaterial } from './campaign-peer-identity.js';
import { isTrustedLocalMasterConnection } from './local-master-trust.js';
import type { PeerCampaignHeader } from './campaign-peer-handshake.js';
import {
  createCampaignNetworkEndpoint,
  CampaignNetworkEndpointError,
  type CampaignNetworkEndpointOptions,
} from './campaign-network-endpoint.js';

const cleaners: (() => Promise<void>)[] = [];
const clients: WebSocket[] = [];
const PUBLIC_CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const publicHeader = (campaignId: string): PeerCampaignHeader => ({
  campaignId,
  title: 'Published campaign',
  status: 'PAUSED',
  activePlayerCapacity: 3,
  activePcCount: 0,
  checkpointSha256: 'a'.repeat(64),
  baselineVersion: `sha256:${'b'.repeat(64)}`,
  revisions: { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 },
});
function locatorResponse(port: number, origin?: string, path = '/campaign-locator') {
  return new Promise<{ status: number; body: string; cache: string | undefined }>(
    (resolve, reject) => {
      const request = get(
        {
          host: '127.0.0.1',
          port,
          path,
          agent: false,
          ...(origin === undefined ? {} : { headers: { Origin: origin } }),
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (text: string) => {
            body += text;
          });
          response.once('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              body,
              cache: response.headers['cache-control'],
            }),
          );
        },
      );
      request.once('error', reject);
    },
  );
}
const body = (data: RawData) =>
  Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
const portOf = (server: Server) => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('TCP address required');
  return address.port;
};
async function closeHttp(server: Server) {
  server.closeAllConnections();
  if (server.listening)
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e === undefined ? resolve() : reject(e))),
    );
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = portOf(server);
  await closeHttp(server);
  return port;
}
async function occupied(port: number) {
  const server = createNetServer();
  return new Promise<boolean>((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) =>
      e.code === 'EADDRINUSE' ? resolve(true) : reject(e),
    );
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(false)));
  });
}
async function connect(port: number, path = '/campaign-state', origin?: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`, {
    ...(origin === undefined ? {} : { origin }),
    perMessageDeflate: false,
  });
  clients.push(ws);
  ws.on('error', () => {});
  await once(ws, 'open');
  return ws;
}
function closed(ws: WebSocket): Promise<void> {
  return ws.readyState === WebSocket.CLOSED
    ? Promise.resolve()
    : new Promise((resolve) => ws.once('close', () => resolve()));
}
async function refused(port: number, path: string, origin?: string) {
  const ws = new WebSocket(
    `ws://127.0.0.1:${String(port)}${path}`,
    origin === undefined ? {} : { origin },
  );
  clients.push(ws);
  ws.on('error', () => {});
  return new Promise<number>((resolve, reject) => {
    ws.once('unexpected-response', (_request, response) => {
      response.resume();
      ws.terminate();
      resolve(response.statusCode ?? 0);
    });
    ws.once('open', () => reject(new Error('Unexpected upgrade')));
  });
}
function httpStatus(port: number, path: string) {
  return new Promise<number>((resolve, reject) => {
    const request = get({ host: '127.0.0.1', port, path, agent: false }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
  });
}
async function setup(
  kind: 'BORROWED_SHELL' | 'OWNED_RESERVATION',
  accept?: CampaignNetworkEndpointOptions['accept'],
  observer?: CampaignNetworkEndpointOptions['onError'],
  locator?: {
    readonly campaignId: string;
    readonly read?: CampaignNetworkEndpointOptions['readPublicCampaignHeaders'];
  },
  maxConnections = 64,
) {
  const endpointHolder: { value?: ReturnType<typeof createCampaignNetworkEndpoint> } = {};
  const shell = createServer((request, response) => {
    if (endpointHolder.value?.servePublicLocator(request, response)) return;
    response.end('local shell');
  });
  await new Promise<void>((resolve) => shell.listen(0, '127.0.0.1', resolve));
  const shellPort = portOf(shell);
  const bind = createCampaignBindManager({
    readShellListener: () => (shell.listening ? { address: '127.0.0.1', port: shellPort } : null),
  });
  const loopback = bind.interfaces().find((item) => item.hostAddress === '127.0.0.1');
  if (loopback === undefined) throw new Error('Real loopback interface missing');
  const port = kind === 'BORROWED_SHELL' ? shellPort : await freePort();
  const errors: CampaignNetworkEndpointError[] = [];
  const accepted: { request: IncomingMessage; ids: readonly string[] }[] = [];
  const endpoint = createCampaignNetworkEndpoint({
    shellServer: shell,
    bind,
    maxConnections,
    readPublicCampaignHeaders: locator?.read ?? ((ids) => ids.map(publicHeader)),
    onError: (error) => {
      errors.push(error);
      return observer?.(error);
    },
    accept: (peer, request, ids) => {
      accepted.push({ request, ids });
      if (accept !== undefined) return accept(peer, request, ids);
      peer.on('message', (data) => peer.send(String(body(data).length)));
    },
  });
  endpointHolder.value = endpoint;
  const local = new WebSocketServer({
    server: endpoint.localUpgradeServer,
    maxPayload: 16 * 1024 * 1024,
    perMessageDeflate: false,
  });
  local.on('connection', (peer, request) => {
    peer.on('error', () => {});
    if (
      request.url !== '/state' ||
      !isTrustedLocalMasterConnection({
        remoteAddress: request.socket.remoteAddress,
        localAddress: request.socket.localAddress,
        origin: request.headers.origin,
        listener: { address: '127.0.0.1', port: shellPort },
      })
    ) {
      peer.close(1008);
      return;
    }
    peer.on('message', (data) => peer.send(`local:${String(body(data).length)}`));
  });
  const config = {
    activePlayerCapacity: 3,
    hostAddress: '127.0.0.1',
    hostPort: port,
    networkInterface: loopback.networkInterface,
  };
  expect((await bind.prepare('draft', config)).status).toBe('PASS');
  bind.retainForCampaign('draft', locator?.campaignId ?? 'campaign');
  cleaners.push(async () => {
    await endpoint.close();
    for (const peer of local.clients) peer.terminate();
    await new Promise<void>((resolve) => local.close(() => resolve()));
    await bind.close();
    await closeHttp(shell);
  });
  return { shell, shellPort, bind, config, port, endpoint, local, errors, accepted };
}
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  for (const close of cleaners.splice(0).reverse()) await close();
});

describe('actual private campaign endpoints', () => {
  it.each(['BORROWED_SHELL', 'OWNED_RESERVATION'] as const)(
    'bounds stalled private handshakes on %s before proof without spending the local shell budget',
    async (kind) => {
      const material = generateDeviceInstallationIdentityMaterial(
        '22222222-2222-4222-8222-222222222222',
      );
      const active: { peer?: WebSocket } = {};
      const p = await setup(
        kind,
        async (peer, request) => {
          active.peer = peer;
          const channel = await acceptCampaignPeerChannel(peer, request, {
            limits: {
              handshakeTimeoutMs: 2000,
              rpcTimeoutMs: 2000,
              maxQueuedFrames: 8,
              maxQueuedBytes: 512 * 1024,
              maxPendingCalls: 4,
            },
            resolveCampaign: (id) =>
              id === PUBLIC_CAMPAIGN
                ? { hostMaterial: material, campaign: publicHeader(PUBLIC_CAMPAIGN) }
                : null,
          });
          channel.close();
        },
        undefined,
        { campaignId: PUBLIC_CAMPAIGN },
        1,
      );
      p.endpoint.publishCampaign(PUBLIC_CAMPAIGN);
      const first = await connect(p.port);
      expect(p.accepted).toHaveLength(1);
      expect(await refused(p.port, '/campaign-state')).toBe(503);
      expect(p.accepted).toHaveLength(1);
      // This is a real unproven Ed25519 peer; it has sent no HELLO at all.
      expect(first.readyState).toBe(WebSocket.OPEN);
      const local = await connect(p.shellPort, '/state', `http://127.0.0.1:${String(p.shellPort)}`),
        message = once(local, 'message');
      local.send('x');
      expect(String((await message)[0])).toBe('local:1');
      const serverClosed = once(active.peer!, 'close');
      first.terminate();
      await serverClosed;
      expect((await connect(p.port)).readyState).toBe(WebSocket.OPEN);
      expect(p.accepted).toHaveLength(2);
    },
  );

  it.each(['BORROWED_SHELL', 'OWNED_RESERVATION'] as const)(
    'serves the same bounded public locator on %s using actual TCP registry IDs',
    async (kind) => {
      const p = await setup(kind, undefined, undefined, { campaignId: PUBLIC_CAMPAIGN });
      p.endpoint.publishCampaign(PUBLIC_CAMPAIGN);
      const result = await locatorResponse(p.port);
      expect(result.status).toBe(200);
      expect(result.cache).toBe('no-store');
      expect(JSON.parse(result.body)).toEqual({
        protocolVersion: 3,
        campaigns: [publicHeader(PUBLIC_CAMPAIGN)],
      });
      expect(p.accepted).toEqual([]);
      expect(result.body).not.toContain('masterProfile');
      expect((await locatorResponse(p.port, 'http://foreign.invalid')).status).toBe(403);
    },
  );

  it('public locator keeps zero and multiple campaigns explicit instead of choosing a first or latest target', async () => {
    const p = await setup('BORROWED_SHELL', undefined, undefined, { campaignId: PUBLIC_CAMPAIGN });
    expect(JSON.parse((await locatorResponse(p.port)).body)).toEqual({
      protocolVersion: 3,
      campaigns: [],
    });
    const other = '22222222-2222-4222-8222-222222222222';
    await p.bind.prepare('other-public', p.config);
    p.bind.retainForCampaign('other-public', other);
    p.endpoint.publishCampaign(PUBLIC_CAMPAIGN);
    p.endpoint.publishCampaign(other);
    expect(JSON.parse((await locatorResponse(p.port)).body)).toEqual({
      protocolVersion: 3,
      campaigns: [publicHeader(PUBLIC_CAMPAIGN), publicHeader(other)],
    });
  });

  it.each(['extra', 'foreign', 'throw', 'native-promise'] as const)(
    'public locator rejects %s source data with fixed503 and no private cause',
    async (mode) => {
      const read: CampaignNetworkEndpointOptions['readPublicCampaignHeaders'] = () => {
        if (mode === 'throw') throw new Error('PRIVATE_OWNER_VERIFIER');
        if (mode === 'native-promise')
          return Promise.reject(
            new Error('PRIVATE_OWNER_VERIFIER'),
          ) as unknown as readonly PeerCampaignHeader[];
        if (mode === 'foreign') return [publicHeader('22222222-2222-4222-8222-222222222222')];
        return [{ ...publicHeader(PUBLIC_CAMPAIGN), privateVerifier: 'PRIVATE_OWNER_VERIFIER' }];
      };
      const p = await setup('OWNED_RESERVATION', undefined, undefined, {
        campaignId: PUBLIC_CAMPAIGN,
        read,
      });
      p.endpoint.publishCampaign(PUBLIC_CAMPAIGN);
      const result = await locatorResponse(p.port);
      expect(result.status).toBe(503);
      expect(result.cache).toBe('no-store');
      expect(result.body).toBe('{"error":"LOCATOR_UNAVAILABLE"}');
      expect(p.accepted).toEqual([]);
    },
  );

  it('refuses an oversized public directory without truncating the registered campaign list', async () => {
    const p = await setup('BORROWED_SHELL', undefined, undefined, {
      campaignId: PUBLIC_CAMPAIGN,
      read: (ids) => ids.map((id) => ({ ...publicHeader(id), title: 'x'.repeat(70 * 1024) })),
    });
    p.endpoint.publishCampaign(PUBLIC_CAMPAIGN);
    const other = '22222222-2222-4222-8222-222222222222';
    await p.bind.prepare('oversize-public', p.config);
    p.bind.retainForCampaign('oversize-public', other);
    p.endpoint.publishCampaign(other);
    const result = await locatorResponse(p.port);
    expect(result.status).toBe(503);
    expect(result.body).toBe('{"error":"LOCATOR_UNAVAILABLE"}');
  });
  it.each(['BORROWED_SHELL', 'OWNED_RESERVATION'] as const)(
    'publishes %s with actual TCP request and exact endpoint campaign IDs',
    async (kind) => {
      const p = await setup(kind);
      expect(p.endpoint.localUpgradeServer.listening).toBe(false);
      expect(p.endpoint.publishCampaign('campaign')).toEqual({
        kind,
        address: '127.0.0.1',
        port: p.port,
      });
      const peer = await connect(p.port);
      const reply = once(peer, 'message');
      peer.send('frame');
      expect(body((await reply)[0] as RawData).toString()).toBe('5');
      expect(p.accepted).toHaveLength(1);
      expect(p.accepted[0]!.ids).toEqual(['campaign']);
      expect(p.accepted[0]!.request.socket.localPort).toBe(p.port);
      expect(p.accepted[0]!.request.socket.remoteAddress).toMatch(/127\.0\.0\.1/);
      expect(p.accepted[0]!.request.url).toBe('/campaign-state');
      expect(p.accepted[0]!.request.headers.origin).toBeUndefined();
      expect(Object.isFrozen(p.accepted[0]!.ids)).toBe(true);
      expect(await occupied(p.port)).toBe(true);
      expect(p.errors).toEqual([]);
    },
  );

  it.each(['BORROWED_SHELL', 'OWNED_RESERVATION'] as const)(
    'bounds %s private allocator at128KiB and refuses larger frames',
    async (kind) => {
      const p = await setup(kind);
      p.endpoint.publishCampaign('campaign');
      const peer = await connect(p.port);
      const reply = once(peer, 'message');
      peer.send(Buffer.alloc(CAMPAIGN_PEER_CHANNEL_MAX_BYTES, 65), { binary: false });
      expect(body((await reply)[0] as RawData).toString()).toBe(
        String(CAMPAIGN_PEER_CHANNEL_MAX_BYTES),
      );
      const ended = closed(peer);
      peer.send(Buffer.alloc(CAMPAIGN_PEER_CHANNEL_MAX_BYTES + 1, 65), { binary: false });
      await ended;
      expect(peer.readyState).toBe(WebSocket.CLOSED);
    },
  );

  it('forwards actual local upgrades separately with existing physical Origin gate and12MiB allowance', async () => {
    const p = await setup('BORROWED_SHELL');
    p.endpoint.publishCampaign('campaign');
    const local = await connect(p.shellPort, '/state', `http://127.0.0.1:${String(p.shellPort)}`);
    const reply = once(local, 'message');
    local.send(Buffer.alloc(12 * 1024 * 1024, 65), { binary: false });
    expect(body((await reply)[0] as RawData).toString()).toBe(`local:${String(12 * 1024 * 1024)}`);
    expect(p.accepted).toEqual([]);
    const foreign = await connect(p.shellPort, '/state', 'http://foreign.invalid');
    await closed(foreign);
    expect(p.accepted).toEqual([]);
    await p.endpoint.close();
    const stillLocal = once(local, 'message');
    local.send('still here');
    expect(body((await stillLocal)[0] as RawData).toString()).toBe('local:10');
    expect(p.shell.listening).toBe(true);
    expect(await httpStatus(p.shellPort, '/')).toBe(200);
  });

  it.each(['BORROWED_SHELL', 'OWNED_RESERVATION'] as const)(
    'rejects %s Browser Origin/private aliases before accepting a peer',
    async (kind) => {
      const p = await setup(kind);
      p.endpoint.publishCampaign('campaign');
      expect(await refused(p.port, '/campaign-state', 'http://127.0.0.1')).toBe(403);
      expect(await refused(p.port, '/campaign-state?campaignId=claimed')).toBe(
        kind === 'OWNED_RESERVATION' ? 404 : 403,
      );
      expect(p.accepted).toEqual([]);
    },
  );

  it('owned adapter exposes no shell/identity/unknown paths or SPA fallback', async () => {
    const p = await setup('OWNED_RESERVATION');
    p.endpoint.publishCampaign('campaign');
    for (const path of ['/', '/state', '/device-identity', '/campaign-state', '/unknown'])
      expect(await httpStatus(p.port, path)).toBe(404);
    for (const path of ['/state', '/device-identity', '/unknown'])
      expect(await refused(p.port, path)).toBe(404);
    expect(p.accepted).toEqual([]);
  });

  it('unpublication/republication revokes old sockets and preserves the held port', async () => {
    const p = await setup('OWNED_RESERVATION');
    p.endpoint.publishCampaign('campaign');
    const old = await connect(p.port);
    const ended = closed(old);
    p.endpoint.unpublishCampaign('campaign');
    await ended;
    expect(await occupied(p.port)).toBe(true);
    p.endpoint.publishCampaign('campaign');
    const fresh = await connect(p.port);
    const reply = once(fresh, 'message');
    fresh.send('fresh');
    expect(body((await reply)[0] as RawData).toString()).toBe('5');
    expect(old.readyState).toBe(WebSocket.CLOSED);
  });

  it('recovers attachment after the manager retires a held socket at the same address and port', async () => {
    const p = await setup('OWNED_RESERVATION');
    p.endpoint.publishCampaign('campaign');
    const old = await connect(p.port);
    expect(
      (await p.bind.recover('campaign', { ...p.config, networkInterface: 'missing-interface' }))
        .status,
    ).toBe('UNAVAILABLE');
    await closed(old);
    expect((await p.bind.recover('campaign', p.config)).status).toBe('RESERVED');
    p.endpoint.publishCampaign('campaign');
    const fresh = await connect(p.port);
    const reply = once(fresh, 'message');
    fresh.send('recovered');
    expect(body((await reply)[0] as RawData).toString()).toBe('9');
  });

  it('borrowed multiple campaigns receive only the live endpoint allowlist and unpublishing preserves local transport', async () => {
    const p = await setup('BORROWED_SHELL');
    await p.bind.prepare('draft-two', p.config);
    p.bind.retainForCampaign('draft-two', 'other-campaign');
    p.endpoint.publishCampaign('campaign');
    p.endpoint.publishCampaign('other-campaign');
    const old = await connect(p.port);
    expect(p.accepted[0]!.ids).toEqual(['campaign', 'other-campaign']);
    const ended = closed(old);
    p.endpoint.unpublishCampaign('campaign');
    await ended;
    await connect(p.port);
    expect(p.accepted[1]!.ids).toEqual(['other-campaign']);
    expect(p.shell.listening).toBe(true);
  });

  it('refuses unregistered/expired endpoints and publication after idempotent shutdown without closing shell/bind', async () => {
    const p = await setup('OWNED_RESERVATION');
    expect(() => p.endpoint.publishCampaign('unknown')).toThrow(CampaignNetworkEndpointError);
    p.endpoint.publishCampaign('campaign');
    const active = await connect(p.port);
    const ended = closed(active);
    const first = p.endpoint.close();
    expect(p.endpoint.close()).toBe(first);
    await first;
    await ended;
    expect(() => p.endpoint.publishCampaign('campaign')).toThrow(CampaignNetworkEndpointError);
    expect(p.shell.listening).toBe(true);
    expect(await occupied(p.port)).toBe(true);
  });

  it('refuses a publication whose actual bind manager no longer owns a listener', async () => {
    const p = await setup('OWNED_RESERVATION');
    p.endpoint.publishCampaign('campaign');
    const old = await connect(p.port);
    await p.bind.close();
    await closed(old);
    expect(() => p.endpoint.publishCampaign('campaign')).toThrow(
      'campaign network endpoint: ENDPOINT_UNAVAILABLE',
    );
  });

  it('rejects an existing upgrade listener rather than adding a competing consumer', async () => {
    const p = await setup('BORROWED_SHELL');
    expect(() =>
      createCampaignNetworkEndpoint({
        shellServer: p.shell,
        bind: p.bind,
        maxConnections: 64,
        readPublicCampaignHeaders: () => [],
        accept: () => {},
        onError: () => {},
      }),
    ).toThrow(CampaignNetworkEndpointError);
    expect(p.shell.listenerCount('upgrade')).toBe(1);
  });

  it.each(['thrown', 'rejected'] as const)(
    'contains %s accept errors without private cause or unhandled rejection',
    async (mode) => {
      const p = await setup('OWNED_RESERVATION', () => {
        if (mode === 'thrown') throw new Error('PRIVATE_KEY_OR_BODY');
        return Promise.reject(new Error('PRIVATE_KEY_OR_BODY'));
      });
      p.endpoint.publishCampaign('campaign');
      const peer = await connect(p.port);
      await closed(peer);
      expect(p.errors.map((e) => e.code)).toEqual(['ACCEPT_FAILED']);
      expect(JSON.stringify(p.errors)).not.toContain('PRIVATE_KEY_OR_BODY');
      expect(p.errors[0]!.cause).toBeUndefined();
    },
  );

  it.each(['return', 'throw'] as const)(
    'contains %s native-Promise diagnostic callbacks and closes private publication',
    async (mode) => {
      const p = await setup(
        'OWNED_RESERVATION',
        () => {
          throw new Error('PRIVATE_ACCEPT');
        },
        () => {
          const rejected: unknown = Promise.reject(new Error('PRIVATE_DIAGNOSTIC'));
          if (mode === 'throw') throw rejected;
          return rejected;
        },
      );
      p.endpoint.publishCampaign('campaign');
      const peer = await connect(p.port);
      await closed(peer);
      expect(() => p.endpoint.publishCampaign('campaign')).toThrow(
        'campaign network endpoint: CLOSED',
      );
      expect(JSON.stringify(p.errors)).not.toContain('PRIVATE_');
      expect(p.shell.listening).toBe(true);
    },
  );
});
