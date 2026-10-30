import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import WebSocket, { WebSocketServer, type ClientOptions, type RawData } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptCampaignPeerChannel,
  connectCampaignPeerChannel,
  CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
  CampaignPeerChannelError,
  type CampaignPeerChannelLimits,
  type CampaignPeerServerChannel,
} from './campaign-peer-channel.js';
import {
  authenticateCampaignPeerChallenge,
  campaignPeerChallengeBodySha256,
  decodeCampaignPeerHandshakeMessage,
  encodeCampaignPeerHandshakeMessage,
  type CampaignPeerChallenge,
  type CampaignPeerHello,
  type PeerCampaignHeader,
} from './campaign-peer-handshake.js';
import {
  allocateCampaignPeerNonce,
  campaignPeerPublicIdentity,
  generateDeviceInstallationIdentityMaterial,
  signCampaignPeerTranscript,
} from './campaign-peer-identity.js';
import { createCampaignPeerProofExchange } from './campaign-peer-proof-exchange.js';
import { canonicalPostSaveJson, postSaveSha256 } from './local-character-export.js';
import { parseCampaignLanAddress } from './campaign-lan-address.js';

const HOST = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const PRIVATE = 'private-input-must-not-appear';
const host = generateDeviceInstallationIdentityMaterial(HOST);
const device = generateDeviceInstallationIdentityMaterial(DEVICE);
const config: CampaignPeerChannelLimits = {
  handshakeTimeoutMs: 1500,
  rpcTimeoutMs: 1500,
  maxQueuedFrames: 8,
  maxQueuedBytes: CAMPAIGN_PEER_CHANNEL_MAX_BYTES * 4,
  maxPendingCalls: 4,
};
const header: PeerCampaignHeader = {
  campaignId: CAMPAIGN,
  title: 'Тихая гавань',
  status: 'PAUSED',
  activePlayerCapacity: 3,
  activePcCount: 0,
  checkpointSha256: 'a'.repeat(64),
  baselineVersion: `sha256:${'b'.repeat(64)}`,
  revisions: { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 },
};
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const captured = async <T>(promise: Promise<T>): Promise<Outcome<T>> => {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
};
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function success<T>(result: Outcome<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  return result.value;
}
function rejected(result: Outcome<unknown>, code?: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected channel failure');
  expect(result.error).toBeInstanceOf(CampaignPeerChannelError);
  const error = result.error as CampaignPeerChannelError;
  if (code !== undefined) expect(error.code).toBe(code);
  expect(error.message).toBe(`campaign peer channel: ${error.code}`);
  expect(error.cause).toBeUndefined();
  for (const marker of [PRIVATE, host.privateKeyPkcs8Base64, device.privateKeyPkcs8Base64]) {
    expect(error.message).not.toContain(marker);
    expect(JSON.stringify(error)).not.toContain(marker);
  }
}
const cleaners: (() => Promise<void> | void)[] = [];
const rawText = (data: RawData): string =>
  (Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.isBuffer(data)
      ? data
      : Buffer.from(data)
  ).toString('utf8');
afterEach(async () => {
  for (const close of cleaners.splice(0).reverse()) await close();
});

/** All authority inputs below come from a real HTTP upgrade and its actual TCP socket. */
async function listener(
  onPeer: (socket: WebSocket, request: IncomingMessage) => Promise<void> | void,
  maxPayload = CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
) {
  const http = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const ws = new WebSocketServer({ noServer: true, maxPayload, perMessageDeflate: false });
  const requests: IncomingMessage[] = [];
  const frames: string[] = [];
  const handlerErrors: unknown[] = [];
  http.on('upgrade', (request, socket, head) => {
    ws.handleUpgrade(request, socket, head, (peer) => {
      requests.push(request);
      peer.on('error', () => undefined);
      peer.on('message', (value: RawData) => frames.push(rawText(value)));
      void Promise.resolve(onPeer(peer, request)).catch((error: unknown) =>
        handlerErrors.push(error),
      );
    });
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const bound = http.address();
  if (bound === null || typeof bound === 'string') throw new Error('Expected TCP listener');
  const origin = `http://127.0.0.1:${String(bound.port)}`;
  cleaners.push(async () => {
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
    expect(handlerErrors).toEqual([]);
  });
  return { origin, requests, frames };
}
function rawInbox(socket: WebSocket) {
  const buffered: string[] = [];
  let waiter: ((text: string) => void) | null = null;
  socket.on('message', (data: RawData) => {
    const text = rawText(data);
    if (waiter !== null) {
      const resolve = waiter;
      waiter = null;
      resolve(text);
    } else buffered.push(text);
  });
  return async (): Promise<string> => {
    const text = buffered.shift();
    if (text !== undefined) return text;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test peer frame deadline')), 2500);
      waiter = (frame) => {
        clearTimeout(timer);
        resolve(frame);
      };
    });
  };
}
async function rawPeer(origin: string, options: ClientOptions = {}, path = '/campaign-state') {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + path, options);
  socket.on('error', () => undefined);
  const next = rawInbox(socket);
  const opened = captured(once(socket, 'open'));
  cleaners.push(() => socket.terminate());
  await opened;
  return { socket, next };
}
function hello(): CampaignPeerHello {
  return {
    protocolVersion: 3,
    messageType: 'network.peer.hello',
    targetCampaignId: CAMPAIGN,
    deviceIdentity: campaignPeerPublicIdentity(device),
    deviceNonceBase64: allocateCampaignPeerNonce(),
  };
}
function hostChallenge(
  greeting: CampaignPeerHello,
  campaign = header,
  nonce = greeting.deviceNonceBase64,
) {
  const exchange = createCampaignPeerProofExchange(
    host,
    campaign.campaignId,
    greeting.deviceIdentity,
    nonce,
    campaignPeerChallengeBodySha256(campaignPeerPublicIdentity(host), campaign),
  );
  const challenge: CampaignPeerChallenge = {
    protocolVersion: 3,
    messageType: 'network.peer.challenge',
    hostIdentity: campaignPeerPublicIdentity(host),
    campaign,
    signed: exchange.challenge(),
  };
  return { challenge, exchange };
}
function proof(challenge: CampaignPeerChallenge): string {
  const transcript = { ...challenge.signed.transcript, purpose: 'DEVICE_PROOF' as const };
  return encodeCampaignPeerHandshakeMessage({
    protocolVersion: 3,
    messageType: 'network.peer.proof',
    signed: { transcript, signatureBase64: signCampaignPeerTranscript(device, transcript) },
  });
}
function requestFrame(
  challenge: CampaignPeerChallenge,
  bodyJson: string,
  sequenceNumber = 1,
): string {
  const transcript = {
    ...challenge.signed.transcript,
    purpose: 'RPC_REQUEST' as const,
    sequenceNumber,
    bodySha256: postSaveSha256(bodyJson),
  };
  return canonicalPostSaveJson({
    protocolVersion: 3,
    messageType: 'network.peer.rpc.request',
    bodyJson,
    signed: { transcript, signatureBase64: signCampaignPeerTranscript(device, transcript) },
  });
}
const connect = (origin: string, limits = config) =>
  connectCampaignPeerChannel({
    target: parseCampaignLanAddress(origin),
    campaignId: CAMPAIGN,
    deviceMaterial: device,
    hostTrust: { kind: 'PINNED', identity: campaignPeerPublicIdentity(host) },
    limits,
  });
async function standard(configOverride = config, maxPayload = CAMPAIGN_PEER_CHANNEL_MAX_BYTES) {
  const accepted = deferred<Outcome<CampaignPeerServerChannel>>();
  const resolver = vi.fn((campaignId: string) =>
    campaignId === CAMPAIGN ? { hostMaterial: host, campaign: header } : null,
  );
  const net = await listener((socket, request) => {
    accepted.resolve(
      captured(
        acceptCampaignPeerChannel(socket, request, {
          limits: configOverride,
          resolveCampaign: resolver,
        }),
      ),
    );
  }, maxPayload);
  return { ...net, accepted: accepted.promise, resolver };
}
async function pair(clientLimits = config, serverLimits = config) {
  const net = await standard(serverLimits);
  const client = await connect(net.origin, clientLimits);
  const server = success(await net.accepted);
  cleaners.push(() => client.close());
  cleaners.push(() => server.close());
  return { ...net, client, server };
}
async function rawAuthenticated(net: Awaited<ReturnType<typeof standard>>) {
  const peer = await rawPeer(net.origin);
  const greeting = hello();
  peer.socket.send(encodeCampaignPeerHandshakeMessage(greeting));
  const frame = decodeCampaignPeerHandshakeMessage(await peer.next());
  if (frame.messageType !== 'network.peer.challenge') throw new Error('Expected challenge');
  const challenge = authenticateCampaignPeerChallenge(
    greeting,
    frame,
    campaignPeerPublicIdentity(host),
  );
  return { ...peer, greeting, challenge };
}

describe('actual Node campaign peer channel', () => {
  it('authenticates on real TCP without Origin and serializes bounded calls without executing their bodies', async () => {
    const p = await pair();
    const one = p.client.call('{"operation":"not-executed-here"}');
    const two = p.client.call('{"order":2}');
    const first = await p.server.receiveRequest();
    expect(first).toEqual({ sequenceNumber: 1, bodyJson: '{"operation":"not-executed-here"}' });
    expect(p.requests[0]?.headers.origin).toBeUndefined();
    expect(p.frames.filter((x) => x.includes('network.peer.rpc.request'))).toHaveLength(1);
    await p.server.respond(1, '{"accepted":false}');
    expect(await one).toBe('{"accepted":false}');
    expect(await p.server.receiveRequest()).toEqual({ sequenceNumber: 2, bodyJson: '{"order":2}' });
    await p.server.respond(2, '{"result":2}');
    expect(await two).toBe('{"result":2}');
    expect(p.client.hostIdentity).toEqual(campaignPeerPublicIdentity(host));
    expect(p.server.deviceIdentity).toEqual(campaignPeerPublicIdentity(device));
    expect(p.client.campaign).toEqual(header);
    expect(p.client.needsHostPin).toBe(false);
    for (const value of [JSON.stringify(p.client), JSON.stringify(p.server), ...p.frames]) {
      expect(value).not.toContain(host.privateKeyPkcs8Base64);
      expect(value).not.toContain(device.privateKeyPkcs8Base64);
    }
    expect(Object.keys(p.client)).not.toContain('socket');
    expect(Object.keys(p.server)).not.toContain('socket');
  });

  it('retains proof and first RPC delivered in the same TCP write through handshake handoff', async () => {
    const net = await standard();
    const raw = await rawAuthenticated(net);
    const chunks: Buffer[] = [];
    net.requests[0]!.socket.on('data', (data: Buffer) => chunks.push(Buffer.from(data)));
    const transport = (raw.socket as unknown as { _socket: Socket })._socket;
    transport.cork();
    raw.socket.send(proof(raw.challenge));
    raw.socket.send(requestFrame(raw.challenge, '{"first":true}'));
    transport.uncork();
    const server = success(await net.accepted);
    expect(await server.receiveRequest()).toEqual({
      sequenceNumber: 1,
      bodyJson: '{"first":true}',
    });
    expect(chunks).toHaveLength(1);
    await server.respond(1, '{"received":true}');
    expect(await raw.next()).toContain('network.peer.rpc.response');
    server.close();
  });

  it('gates first explicit CONNECT until the trusted caller acknowledges the actual durable host pin', async () => {
    const net = await standard();
    const client = await connectCampaignPeerChannel({
      target: parseCampaignLanAddress(net.origin),
      campaignId: CAMPAIGN,
      deviceMaterial: device,
      hostTrust: { kind: 'FIRST_EXPLICIT_CONNECT' },
      limits: config,
    });
    const server = success(await net.accepted);
    expect(client.needsHostPin).toBe(true);
    client.confirmHostPin(campaignPeerPublicIdentity(host));
    expect(client.needsHostPin).toBe(false);
    const pending = client.call('null');
    const request = await server.receiveRequest();
    await server.respond(request.sequenceNumber, 'false');
    expect(await pending).toBe('false');
    client.close();
    rejected(await captured(client.call('null')), 'CLOSED');
  });

  it('does not send an RPC when first-connect pin acknowledgement is missing', async () => {
    const net = await standard();
    const client = await connectCampaignPeerChannel({
      target: parseCampaignLanAddress(net.origin),
      campaignId: CAMPAIGN,
      deviceMaterial: device,
      hostTrust: { kind: 'FIRST_EXPLICIT_CONNECT' },
      limits: config,
    });
    success(await net.accepted);
    rejected(await captured(client.call('null')), 'INVALID_STATE');
    expect(net.frames.some((text) => text.includes('network.peer.rpc.request'))).toBe(false);
  });

  it('rejects a wrong durable host pin without exposing either private key', async () => {
    const net = await standard();
    const wrong = campaignPeerPublicIdentity(generateDeviceInstallationIdentityMaterial(HOST));
    rejected(
      await captured(
        connectCampaignPeerChannel({
          target: parseCampaignLanAddress(net.origin),
          campaignId: CAMPAIGN,
          deviceMaterial: device,
          hostTrust: { kind: 'PINNED', identity: wrong },
          limits: config,
        }),
      ),
      'INVALID_HANDSHAKE',
    );
    rejected(await net.accepted);
  });

  it.each(['campaign', 'nonce', 'signature'])(
    'rejects a validly shaped challenge with wrong %s',
    async (change) => {
      const net = await listener(async (socket) => {
        const next = rawInbox(socket);
        const first = decodeCampaignPeerHandshakeMessage(await next());
        if (first.messageType !== 'network.peer.hello') throw new Error('Expected hello');
        const { challenge, exchange } = hostChallenge(
          first,
          change === 'campaign' ? { ...header, campaignId: OTHER } : header,
          change === 'nonce' ? allocateCampaignPeerNonce() : first.deviceNonceBase64,
        );
        const bytes = Buffer.from(challenge.signed.signatureBase64, 'base64');
        bytes[0] = bytes[0]! ^ 1;
        socket.send(
          encodeCampaignPeerHandshakeMessage(
            change === 'signature'
              ? {
                  ...challenge,
                  signed: { ...challenge.signed, signatureBase64: bytes.toString('base64') },
                }
              : challenge,
          ),
        );
        exchange.close();
      });
      rejected(await captured(connect(net.origin)), 'INVALID_HANDSHAKE');
    },
  );

  it.each(['proof replay', 'wrong nonce', 'wrong signature'])(
    'rejects %s during device proof',
    async (change) => {
      const net = await standard();
      const raw = await rawAuthenticated(net);
      let text: string;
      if (change === 'proof replay') {
        const foreign = hostChallenge(raw.greeting);
        text = proof(foreign.challenge);
        foreign.exchange.close();
      } else {
        const transcript = {
          ...raw.challenge.signed.transcript,
          purpose: 'DEVICE_PROOF' as const,
          ...(change === 'wrong nonce' ? { hostNonceBase64: allocateCampaignPeerNonce() } : {}),
        };
        const signature = signCampaignPeerTranscript(change === 'wrong signature' ? host : device, {
          ...transcript,
          ...(change === 'wrong signature'
            ? { deviceId: HOST, deviceKeyFingerprintSha256: host.keyFingerprintSha256 }
            : {}),
        });
        text = encodeCampaignPeerHandshakeMessage({
          protocolVersion: 3,
          messageType: 'network.peer.proof',
          signed: { transcript, signatureBase64: signature },
        });
      }
      raw.socket.send(text);
      rejected(await net.accepted, 'INVALID_HANDSHAKE');
    },
  );

  it.each(['http://foreign.invalid', 'null', ''])(
    'rejects any present Origin %j despite spoofed Host/proxy headers',
    async (origin) => {
      const net = await standard();
      await rawPeer(net.origin, {
        headers: {
          Origin: origin,
          Host: new URL(net.origin).host,
          'X-Forwarded-For': '127.0.0.1',
          'X-Forwarded-Host': new URL(net.origin).host,
        },
      });
      rejected(await net.accepted, 'INVALID_CONNECTION');
      expect(net.resolver).not.toHaveBeenCalled();
    },
  );

  it('uses the actual private TCP endpoints instead of trusting or deriving authority from Host', async () => {
    const net = await standard();
    const raw = await rawPeer(net.origin, {
      headers: { Host: 'unrelated.invalid', 'X-Forwarded-For': '203.0.113.1' },
    });
    raw.socket.send(encodeCampaignPeerHandshakeMessage(hello()));
    const challenge = decodeCampaignPeerHandshakeMessage(await raw.next());
    if (challenge.messageType !== 'network.peer.challenge') throw new Error('Expected challenge');
    raw.socket.send(proof(challenge));
    const server = success(await net.accepted);
    expect(net.requests[0]?.socket.remoteAddress).toBe('127.0.0.1');
    server.close();
  });

  it.each([
    '/state',
    '/campaign-state/',
    '/campaign-state?campaignId=' + CAMPAIGN,
    '//campaign-state',
  ])('rejects path alias %s before reading campaign state', async (path) => {
    const net = await standard();
    await rawPeer(net.origin, {}, path);
    rejected(await net.accepted, 'INVALID_CONNECTION');
    expect(net.resolver).not.toHaveBeenCalled();
  });

  it('rejects inconsistent locator hints and forged origins before creating a TCP connection', async () => {
    const net = await standard();
    for (const target of [
      { ...parseCampaignLanAddress(net.origin), campaignId: OTHER },
      { ...parseCampaignLanAddress(net.origin), canonicalOrigin: 'http://203.0.113.1:1234' },
      { ...parseCampaignLanAddress(net.origin), host: '192.168.1.5' },
    ])
      rejected(
        await captured(
          connectCampaignPeerChannel({
            target,
            campaignId: CAMPAIGN,
            deviceMaterial: device,
            hostTrust: { kind: 'PINNED', identity: campaignPeerPublicIdentity(host) },
            limits: config,
          }),
        ),
      );
    expect(net.requests).toHaveLength(0);
  });

  it.each([0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid required technical limit %s before connect',
    async (value) => {
      const net = await standard();
      for (const key of Object.keys(config))
        rejected(
          await captured(connect(net.origin, { ...config, [key]: value })),
          'INVALID_CONFIG',
        );
      expect(net.requests).toHaveLength(0);
    },
  );

  it('times out a silent handshake and an unanswered authenticated RPC with fixed errors', async () => {
    const silent = await listener(() => undefined);
    rejected(
      await captured(connect(silent.origin, { ...config, handshakeTimeoutMs: 150 })),
      'TIMEOUT',
    );
    const p = await pair({ ...config, rpcTimeoutMs: 150 });
    const response = captured(p.client.call('null'));
    expect((await p.server.receiveRequest()).sequenceNumber).toBe(1);
    rejected(await response, 'TIMEOUT');
  });

  it('times out server proof wait and closes pending readers when the peer disconnects', async () => {
    const net = await standard({ ...config, handshakeTimeoutMs: 150 });
    await rawAuthenticated(net);
    rejected(await net.accepted, 'TIMEOUT');
    const p = await pair();
    const request = captured(p.server.receiveRequest());
    p.client.close();
    rejected(await request, 'CLOSED');
  });

  it('bounds queued client calls including the currently unanswered call', async () => {
    const p = await pair({ ...config, maxPendingCalls: 1 });
    const first = captured(p.client.call('null'));
    const second = captured(p.client.call('true'));
    rejected(await first, 'QUEUE_OVERFLOW');
    rejected(await second, 'QUEUE_OVERFLOW');
    expect(p.client.closed).toBe(true);
  });

  it('rejects a second unanswered server request instead of buffering application work', async () => {
    const net = await standard();
    const raw = await rawAuthenticated(net);
    raw.socket.send(proof(raw.challenge));
    const server = success(await net.accepted);
    raw.socket.send(requestFrame(raw.challenge, 'null'));
    await server.receiveRequest();
    raw.socket.send(requestFrame(raw.challenge, 'false', 2));
    await vi.waitFor(() => expect(server.closed).toBe(true));
    rejected(await captured(server.respond(1, 'null')), 'INVALID_STATE');
  });

  it('rejects replayed RPC sequence after a completed response', async () => {
    const net = await standard();
    const raw = await rawAuthenticated(net);
    raw.socket.send(proof(raw.challenge));
    const server = success(await net.accepted);
    const text = requestFrame(raw.challenge, 'null');
    raw.socket.send(text);
    await server.receiveRequest();
    await server.respond(1, 'false');
    await raw.next();
    const next = captured(server.receiveRequest());
    raw.socket.send(text);
    rejected(await next, 'INVALID_RPC');
  });

  it.each([
    'hash',
    'signature',
    'out of order',
    'binary',
    'extra property',
    'duplicate property',
    'noncanonical body',
  ])('rejects malformed authenticated request: %s', async (change) => {
    const net = await standard();
    const raw = await rawAuthenticated(net);
    raw.socket.send(proof(raw.challenge));
    const server = success(await net.accepted);
    let text = requestFrame(
      raw.challenge,
      change === 'noncanonical body' ? '{ "x":1}' : 'null',
      change === 'out of order' ? 2 : 1,
    );
    if (change === 'hash') text = text.replace('"bodyJson":"null"', '"bodyJson":"true"');
    if (change === 'signature') {
      const signature = signCampaignPeerTranscript(device, {
        ...raw.challenge.signed.transcript,
        purpose: 'RPC_REQUEST',
        sequenceNumber: 1,
        bodySha256: postSaveSha256('null'),
      });
      const damaged = Buffer.from(signature, 'base64');
      damaged[0] = damaged[0]! ^ 1;
      text = text.replace(signature, damaged.toString('base64'));
    }
    if (change === 'extra property') text = text.replace('{', `{"${PRIVATE}":"${PRIVATE}",`);
    if (change === 'duplicate property')
      text = text.replace('"protocolVersion":3', '"protocolVersion":3,"protocolVersion":3');
    const pending = captured(server.receiveRequest());
    raw.socket.send(change === 'binary' ? Buffer.from(text) : text);
    rejected(await pending, 'INVALID_RPC');
  });

  it('checks both body and encoded outer byte limits', async () => {
    for (const body of [
      canonicalPostSaveJson({ data: 'x'.repeat(CAMPAIGN_PEER_CHANNEL_MAX_BYTES) }),
      canonicalPostSaveJson('"'.repeat(40_000)),
    ]) {
      const p = await pair();
      rejected(await captured(p.client.call(body)), 'INVALID_RPC');
      expect(p.client.closed).toBe(true);
    }
  });

  it('enforces the post-receive frame guard even when the caller supplies a larger WebSocket server', async () => {
    const net = await standard(config, CAMPAIGN_PEER_CHANNEL_MAX_BYTES * 2);
    const raw = await rawAuthenticated(net);
    raw.socket.send(proof(raw.challenge));
    const server = success(await net.accepted);
    const pending = captured(server.receiveRequest());
    raw.socket.send('x'.repeat(CAMPAIGN_PEER_CHANNEL_MAX_BYTES + 1));
    rejected(await pending, 'INVALID_RPC');
  });

  it('closes on ws maxPayload rejection without an unhandled websocket error', async () => {
    const net = await standard();
    const raw = await rawAuthenticated(net);
    raw.socket.send(proof(raw.challenge));
    const server = success(await net.accepted);
    const pending = captured(server.receiveRequest());
    raw.socket.send('x'.repeat(CAMPAIGN_PEER_CHANNEL_MAX_BYTES + 1));
    rejected(await pending, 'TRANSPORT_ERROR');
  });

  it.each(['frames', 'bytes'])(
    'bounds queued %s across a coalesced handshake frame burst',
    async (bound) => {
      const net = await standard({
        ...config,
        ...(bound === 'frames' ? { maxQueuedFrames: 1 } : { maxQueuedBytes: 1 }),
      });
      const raw = await rawAuthenticated(net);
      const transport = (raw.socket as unknown as { _socket: Socket })._socket;
      transport.cork();
      raw.socket.send(proof(raw.challenge));
      raw.socket.send(requestFrame(raw.challenge, 'null'));
      raw.socket.send(requestFrame(raw.challenge, 'false', 2));
      transport.uncork();
      rejected(await net.accepted, 'QUEUE_OVERFLOW');
    },
  );

  it('rejects duplicate receive/respond use and clears pending client calls on explicit close', async () => {
    const p = await pair();
    const pending = captured(p.client.call('null'));
    await p.server.receiveRequest();
    rejected(await captured(p.server.receiveRequest()), 'INVALID_STATE');
    rejected(await pending);
    const other = await pair();
    const response = captured(other.client.call('null'));
    await other.server.receiveRequest();
    rejected(await captured(other.server.respond(2, 'false')), 'INVALID_STATE');
    rejected(await response);
  });

  it('redacts callback, parser and transport errors', async () => {
    const accepted = deferred<Outcome<CampaignPeerServerChannel>>();
    const net = await listener((socket, request) => {
      accepted.resolve(
        captured(
          acceptCampaignPeerChannel(socket, request, {
            limits: config,
            resolveCampaign: () => {
              throw new Error(PRIVATE + host.privateKeyPkcs8Base64);
            },
          }),
        ),
      );
    });
    rejected(await captured(connect(net.origin)));
    rejected(await accepted.promise, 'INVALID_HANDSHAKE');
    const p = await pair();
    rejected(await captured(p.client.call('{' + PRIVATE)), 'INVALID_RPC');
    const broken = await pair();
    const pending = captured(broken.client.call('null'));
    broken.requests[0]!.socket.destroy(new Error(PRIVATE));
    rejected(await pending);
  });

  it('reconstructs a callback typed error without retaining its message, cause or private fields', async () => {
    const accepted = deferred<Outcome<CampaignPeerServerChannel>>();
    const net = await listener((socket, request) => {
      accepted.resolve(
        captured(
          acceptCampaignPeerChannel(socket, request, {
            limits: config,
            resolveCampaign: () => {
              const error = new CampaignPeerChannelError('INVALID_HANDSHAKE');
              error.message = PRIVATE;
              error.cause = host.privateKeyPkcs8Base64;
              Object.assign(error, { secret: device.privateKeyPkcs8Base64 });
              throw error;
            },
          }),
        ),
      );
    });
    rejected(await captured(connect(net.origin)));
    rejected(await accepted.promise, 'INVALID_HANDSHAKE');
  });

  it.each(['signature', 'sequence', 'nonce', 'reflection', 'body hash'])(
    'rejects a host RPC response with wrong %s',
    async (change) => {
      const net = await listener(async (socket) => {
        const next = rawInbox(socket);
        const greeting = decodeCampaignPeerHandshakeMessage(await next());
        if (greeting.messageType !== 'network.peer.hello') throw new Error('Expected hello');
        const { challenge, exchange } = hostChallenge(greeting);
        socket.send(encodeCampaignPeerHandshakeMessage(challenge));
        const received = decodeCampaignPeerHandshakeMessage(await next());
        if (received.messageType !== 'network.peer.proof') throw new Error('Expected proof');
        exchange.acceptDeviceProof(received.signed.transcript, received.signed.signatureBase64);
        await next();
        const transcript = {
          ...challenge.signed.transcript,
          purpose: 'RPC_RESPONSE' as const,
          sequenceNumber: change === 'sequence' ? 2 : 1,
          bodySha256: postSaveSha256('false'),
          ...(change === 'nonce' ? { deviceNonceBase64: allocateCampaignPeerNonce() } : {}),
        };
        let signatureBase64 = signCampaignPeerTranscript(host, transcript);
        if (change === 'signature') {
          const bytes = Buffer.from(signatureBase64, 'base64');
          bytes[0] = bytes[0]! ^ 1;
          signatureBase64 = bytes.toString('base64');
        }
        if (change === 'reflection') {
          const requestTranscript = { ...transcript, purpose: 'RPC_REQUEST' as const };
          signatureBase64 = signCampaignPeerTranscript(device, requestTranscript);
          socket.send(
            canonicalPostSaveJson({
              protocolVersion: 3,
              messageType: 'network.peer.rpc.response',
              bodyJson: 'false',
              signed: { transcript: requestTranscript, signatureBase64 },
            }),
          );
        } else
          socket.send(
            canonicalPostSaveJson({
              protocolVersion: 3,
              messageType: 'network.peer.rpc.response',
              bodyJson: change === 'body hash' ? 'true' : 'false',
              signed: { transcript, signatureBase64 },
            }),
          );
        exchange.close();
      });
      const client = await connect(net.origin);
      rejected(await captured(client.call('null')), 'INVALID_RPC');
    },
  );

  it('closes on an unsolicited signed response without authorizing application work', async () => {
    const ready = deferred<() => void>();
    const net = await listener(async (socket) => {
      const next = rawInbox(socket);
      const greeting = decodeCampaignPeerHandshakeMessage(await next());
      if (greeting.messageType !== 'network.peer.hello') throw new Error('Expected hello');
      const { challenge, exchange } = hostChallenge(greeting);
      socket.send(encodeCampaignPeerHandshakeMessage(challenge));
      await next();
      ready.resolve(() => {
        const transcript = {
          ...challenge.signed.transcript,
          purpose: 'RPC_RESPONSE' as const,
          sequenceNumber: 1,
          bodySha256: postSaveSha256('null'),
        };
        socket.send(
          canonicalPostSaveJson({
            protocolVersion: 3,
            messageType: 'network.peer.rpc.response',
            bodyJson: 'null',
            signed: { transcript, signatureBase64: signCampaignPeerTranscript(host, transcript) },
          }),
        );
        exchange.close();
      });
    });
    const client = await connect(net.origin);
    (await ready.promise)();
    await vi.waitFor(() => expect(client.closed).toBe(true));
    rejected(await captured(client.call('null')), 'INVALID_RPC');
  });
});
