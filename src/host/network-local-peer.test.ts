import { randomUUID } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { openPersistenceDatabase, bootstrapDeviceIdentity } from '../persistence/index.js';
import { commitLocalNetworkTabEntry } from '../persistence/network-local-tab.js';
import {
  commitLocalNetworkMutation,
  readLocalNetworkApplication,
  readLocalNetworkHostPin,
  type LocalRequestLaneBindingOutbox,
} from '../persistence/network-local-application.js';
import { initializeNetworkInstallation } from './network-installation.js';
import {
  generateDeviceInstallationIdentityMaterial,
  campaignPeerPublicIdentity,
} from './campaign-peer-identity.js';
import {
  acceptCampaignPeerChannel,
  CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
  type CampaignPeerServerChannel,
} from './campaign-peer-channel.js';
import { parseCampaignLanAddress } from './campaign-lan-address.js';
import {
  canonicalPostSaveJson,
  postSaveSha256,
  loadLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import {
  loadNetworkApplicationConfig,
  type NetworkApplicationConfig,
} from './network-application-config.js';
import {
  createLocalNetworkPeer,
  readManualCampaignLocator,
  LocalNetworkPeerError,
} from './network-local-peer.js';
import type { PeerCampaignHeader } from './campaign-peer-handshake.js';

const cleaners: (() => void | Promise<void>)[] = [];
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const campaignId = randomUUID(),
  hostId = randomUUID();
let baseline: LocalCharacterExportBaseline, config: NetworkApplicationConfig;
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(resolve('.'));
  config = await loadNetworkApplicationConfig(resolve('.'));
});
afterEach(async () => {
  for (const clean of cleaners.splice(0).reverse()) await clean();
});
const header = (): PeerCampaignHeader => ({
  campaignId,
  title: 'Public directory fixture',
  status: 'PAUSED',
  activePlayerCapacity: 3,
  activePcCount: 0,
  checkpointSha256: 'a'.repeat(64),
  baselineVersion: baseline.baselineVersion,
  revisions: zero,
});
async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  host = '127.0.0.1',
) {
  const server = createServer(handler);
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, host, done);
  });
  cleaners.push(
    () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing real TCP address');
  return {
    server,
    target: parseCampaignLanAddress(
      `http://${host.includes(':') ? `[${host}]` : host}:${String(address.port)}`,
    ),
  };
}

describe('manual private campaign locator over actual HTTP', () => {
  it.each(['127.0.0.1', '::1'])(
    'reads the sole public campaign on %s without Origin or a browser redirect',
    async (host) => {
      let origin: string | undefined, path: string | undefined;
      const { target } = await listen((req, res) => {
        origin = req.headers.origin;
        path = req.url;
        res.end(canonicalPostSaveJson({ protocolVersion: 3, campaigns: [header()] }));
      }, host);
      expect(await readManualCampaignLocator(target, 1500)).toBe(campaignId);
      expect(origin).toBeUndefined();
      expect(path).toBe('/campaign-locator');
    },
  );
  it('refuses zero, multiple and duplicate campaigns instead of picking a first/latest target', async () => {
    for (const campaigns of [
      [],
      [header(), { ...header(), campaignId: randomUUID() }],
      [header(), header()],
    ]) {
      const { target } = await listen((_req, res) =>
        res.end(canonicalPostSaveJson({ protocolVersion: 3, campaigns })),
      );
      await expect(readManualCampaignLocator(target, 1500)).rejects.toBeInstanceOf(
        LocalNetworkPeerError,
      );
    }
  });
  it('refuses aliases, wrong schema, private additions and a combined directory over the byte budget', async () => {
    for (const body of [
      '{"protocolVersion":3,"protocolVersion":3,"campaigns":[]}',
      canonicalPostSaveJson({ protocolVersion: 4, campaigns: [header()] }),
      canonicalPostSaveJson({
        protocolVersion: 3,
        campaigns: [header()],
        privateKeyPkcs8Base64: 'private-marker',
      }),
      ' '.repeat(CAMPAIGN_PEER_CHANNEL_MAX_BYTES + 1),
    ]) {
      const { target } = await listen((_req, res) => res.end(body));
      let failure: unknown;
      try {
        await readManualCampaignLocator(target, 1500);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(LocalNetworkPeerError);
      expect((failure as Error).cause).toBeUndefined();
    }
  });
  it('never follows a remote redirect or reflects its diagnostic body', async () => {
    let destinationReads = 0;
    const destination = await listen((_req, res) => {
      destinationReads++;
      res.end('private-marker');
    });
    const { target } = await listen((_req, res) => {
      res.writeHead(302, { Location: destination.target.canonicalOrigin });
      res.end('private-marker');
    });
    let failure: unknown;
    try {
      await readManualCampaignLocator(target, 1500);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LocalNetworkPeerError);
    expect(JSON.stringify(failure)).not.toContain('private-marker');
    expect(destinationReads).toBe(0);
  });
});

function keyServer(
  server: Server,
  material: ReturnType<typeof generateDeviceInstallationIdentityMaterial>,
  onRequest?: () => void,
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: CAMPAIGN_PEER_CHANNEL_MAX_BYTES });
  const channels: CampaignPeerServerChannel[] = [];
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      void acceptCampaignPeerChannel(ws, request, {
        limits: config.channel,
        resolveCampaign: (id) =>
          id === campaignId ? { hostMaterial: material, campaign: header() } : null,
      }).then(
        (channel) => {
          channels.push(channel);
          if (onRequest !== undefined)
            void channel.receiveRequest().then(
              () => onRequest(),
              () => undefined,
            );
        },
        () => undefined,
      );
    });
  });
  cleaners.push(async () => {
    for (const channel of channels) channel.close();
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((done) => wss.close(() => done()));
  });
}

function localPeerFixture() {
  const database = openPersistenceDatabase(':memory:');
  cleaners.push(() => {
    database.close();
  });
  const ownerDeviceId = bootstrapDeviceIdentity(database);
  initializeNetworkInstallation(database);
  const scope = { ownerDeviceId, networkScopeId: randomUUID() };
  commitLocalNetworkTabEntry(
    database,
    {
      ...scope,
      sourceContextId: randomUUID(),
      sourceRevisions: zero,
      entryCommandId: randomUUID(),
      entryReceiptId: randomUUID(),
      tabId: randomUUID(),
    },
    () => undefined,
  );
  const peer = createLocalNetworkPeer({ database, baseline, config });
  cleaners.push(() => peer.close());
  return { database, scope, peer };
}

it('aborts a pending actual HTTP locator and releases its socket when the local peer closes', async () => {
  const { database, scope, peer } = localPeerFixture();
  let arrived!: () => void, disconnected!: () => void;
  const requestArrived = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const socketClosed = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  const { target } = await listen((request) => {
    request.socket.once('close', disconnected);
    arrived();
  });
  const before = database.serialize();
  const result = peer
    .open(scope, target.canonicalOrigin, null, () => undefined)
    .catch((error: unknown) => error);
  await requestArrived;
  peer.close();
  expect(await result).toBeInstanceOf(LocalNetworkPeerError);
  await socketClosed;
  expect(database.serialize().equals(before)).toBe(true);
  expect(peer.current(scope.networkScopeId)).toBeNull();
});

it('aborts a pending actual WS handshake on scope close before host pin or SQL mutation', async () => {
  const { database, scope, peer } = localPeerFixture();
  const { server, target } = await listen((_request, response) => response.end());
  const wss = new WebSocketServer({ noServer: true });
  cleaners.push(async () => {
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
  let arrived!: () => void, disconnected!: () => void;
  const helloArrived = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const socketClosed = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (channel) => {
      channel.once('message', arrived);
      channel.once('close', disconnected);
    });
  });
  const before = database.serialize();
  const result = peer
    .open(scope, target.canonicalOrigin, campaignId, () => undefined)
    .catch((error: unknown) => error);
  await helloArrived;
  peer.closeScope(scope.networkScopeId);
  expect(await result).toBeInstanceOf(LocalNetworkPeerError);
  await socketClosed;
  expect(database.serialize().equals(before)).toBe(true);
  expect(readLocalNetworkHostPin(database, scope.ownerDeviceId, campaignId)).toBeNull();
});

it('persists the real host pin before RPC and refuses a changed key even at another origin without changing SQLite', async () => {
  const db = openPersistenceDatabase(':memory:');
  cleaners.push(() => {
    db.close();
  });
  const ownerDeviceId = bootstrapDeviceIdentity(db);
  initializeNetworkInstallation(db);
  const input = {
    entryCommandId: randomUUID(),
    entryReceiptId: randomUUID(),
    ownerDeviceId,
    sourceContextId: randomUUID(),
    sourceRevisions: zero,
    tabId: randomUUID(),
    networkScopeId: randomUUID(),
  };
  commitLocalNetworkTabEntry(db, input, () => undefined);
  const source = readLocalNetworkApplication(db, input);
  commitLocalNetworkMutation(
    db,
    {
      ownerDeviceId,
      networkScopeId: input.networkScopeId,
      expectedRevisions: zero,
      expectedDraftRevision: 0,
      eventId: randomUUID(),
      receiptId: randomUUID(),
      clientRequestJsonOrNull: canonicalPostSaveJson({ messageType: 'navigation.form-action' }),
      mutation: {
        kind: 'NAVIGATE',
        targetFormId: 'NET-002',
        plannedAttemptIdOrNull: randomUUID(),
        singleCandidateOrNull: null,
      },
    },
    () => {
      expect(source.ownerDeviceId).toBe(ownerDeviceId);
    },
  );
  const material = generateDeviceInstallationIdentityMaterial(hostId);
  const good = await listen((_req, res) =>
    res.end(canonicalPostSaveJson({ protocolVersion: 3, campaigns: [header()] })),
  );
  keyServer(good.server, material);
  const peer = createLocalNetworkPeer({ database: db, baseline, config });
  cleaners.push(() => peer.close());
  const channel = await peer.open(input, good.target.canonicalOrigin, campaignId, (current) => {
    expect(current.formId).toBe('NET-002');
    expect(current.ownerDeviceId).toBe(ownerDeviceId);
  });
  expect(channel.needsHostPin).toBe(false);
  expect(readLocalNetworkHostPin(db, ownerDeviceId, campaignId)?.identity).toEqual(
    campaignPeerPublicIdentity(material),
  );
  const before = db.serialize();
  const other = await listen((_req, res) =>
    res.end(canonicalPostSaveJson({ protocolVersion: 3, campaigns: [header()] })),
  );
  keyServer(other.server, generateDeviceInstallationIdentityMaterial(hostId));
  await expect(
    peer.reconnect(input, other.target.canonicalOrigin, campaignId),
  ).rejects.toBeInstanceOf(LocalNetworkPeerError);
  expect(db.serialize().equals(before)).toBe(true);
  expect(readLocalNetworkHostPin(db, ownerDeviceId, campaignId)?.identity).toEqual(
    campaignPeerPublicIdentity(material),
  );
});

it('refuses a forged lane outbox before RPC even on an authenticated live channel', async () => {
  const { database, scope, peer } = localPeerFixture();
  let requests = 0;
  const { server, target } = await listen((_request, response) => response.end());
  keyServer(server, generateDeviceInstallationIdentityMaterial(hostId), () => {
    requests++;
  });
  await peer.open(scope, target.canonicalOrigin, campaignId, () => undefined);
  const app = readLocalNetworkApplication(database, scope),
    requestId = randomUUID(),
    technicalSessionId = randomUUID();
  const command = {
    schemaVersion: 1 as const,
    operation: 'DEVICE_REQUEST_BIND_LANE' as const,
    commandId: 'bind-without-intent',
    requestId,
    technicalSessionId,
    submitCommandId: 'missing-original-submit',
    batchSha256: 'a'.repeat(64),
    localControllerSeatId: app.tabId,
  };
  const forged: LocalRequestLaneBindingOutbox = {
    ...scope,
    requestId,
    request: command,
    semanticBodySha256: postSaveSha256(canonicalPostSaveJson(command)),
    receiptOrNull: null,
    origin: {
      ...scope,
      tabId: app.tabId,
      entryCommandId: 'missing-entry',
      entryReceiptId: 'missing-entry-receipt',
      submitCommandId: command.submitCommandId,
      submitIntentEventId: 'missing-intent',
      submitIntentEventReceiptId: 'missing-intent-receipt',
      submitIntentEventSha256: 'b'.repeat(64),
      originalEntrySha256: 'c'.repeat(64),
      originEvidenceSha256: 'd'.repeat(64),
    },
  };
  const before = database.serialize();
  await expect(peer.deliverLaneBinding(scope, forged)).rejects.toThrow();
  await expect(peer.recoverLaneBinding(scope, forged)).rejects.toThrow();
  expect(requests).toBe(0);
  expect(database.serialize().equals(before)).toBe(true);
});
