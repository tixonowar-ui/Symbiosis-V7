import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, get, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { campaignQrPayload } from '../shared/campaign-creation.js';
import {
  bootstrapDeviceIdentity,
  loadDeviceId,
  openPersistenceDatabase,
} from '../persistence/index.js';
import {
  ensureLocalGmProfile,
  readLocalGmProfile,
  createLocalGmContext,
  createCampaignDraft,
  readCampaignDraft,
  navigateCampaignDraft,
  commitCampaignDraftUpdate,
  commitCampaignCreation,
  type RedactedCampaignDraftRequest,
} from '../persistence/campaign-creation.js';
import { readHostedCurrentPausedCampaign } from '../persistence/current-paused-campaign.js';
import { loadCampaignCheckpoint } from '../persistence/store.js';
import { createCampaignBindManager } from './campaign-bind.js';
import { createCampaignNetworkRuntime } from './campaign-network-runtime.js';
import { loadNetworkApplicationConfig } from './network-application-config.js';
import { initializeNetworkInstallation, loadNetworkInstallation } from './network-installation.js';
import { campaignPeerPublicIdentity } from './campaign-peer-identity.js';
import { connectCampaignPeerChannel } from './campaign-peer-channel.js';
import { parseCampaignLanAddress } from './campaign-lan-address.js';
import { encodeDeviceAdmissionPeerCommand } from './device-admission-peer-commands.js';
import { decodeDeviceAdmissionPeerResponse } from './device-admission-peer-response.js';
import { prepareMasterSecret, validateMasterSecretVerifier } from './campaign-secret.js';
import { loadLocalCharacterExportBaseline } from './local-character-export.js';

let baseline: Awaited<ReturnType<typeof loadLocalCharacterExportBaseline>>;
let config: Awaited<ReturnType<typeof loadNetworkApplicationConfig>>;
let secret: Awaited<ReturnType<typeof prepareMasterSecret>>;
const SECRET = 'Coordinator private fixture secret';
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const vector = (v: typeof zero) => ({
  stateRevision: v.stateRevision,
  projectionRevision: v.projectionRevision,
  actorVisibilityRevision: v.actorVisibilityRevision,
});
const cleaners: (() => Promise<void>)[] = [];
const directories: string[] = [];
beforeAll(async () => {
  [baseline, config, secret] = await Promise.all([
    loadLocalCharacterExportBaseline(process.cwd()),
    loadNetworkApplicationConfig(process.cwd()),
    prepareMasterSecret(SECRET, SECRET),
  ]);
});
afterEach(async () => {
  for (const close of cleaners.splice(0).reverse()) await close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const portOf = (server: Server) => {
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Actual TCP endpoint required');
  return address.port;
};
async function closeHttp(server: Server) {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function freeTcpPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = portOf(server);
  await closeHttp(server);
  return port;
}
async function freeUdpPort() {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise<void>((resolve) => socket.close(resolve));
  return port;
}
async function portOccupied(port: number) {
  const server = createNetServer();
  return new Promise<boolean>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      error.code === 'EADDRINUSE' ? resolve(true) : reject(error),
    );
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () =>
      server.close(() => resolve(false)),
    );
  });
}
function locator(port: number, origin?: string) {
  return new Promise<{ status: number; text: string; cache: string | undefined }>(
    (resolve, reject) => {
      const request = get(
        {
          host: '127.0.0.1',
          port,
          path: '/campaign-locator',
          agent: false,
          ...(origin === undefined ? {} : { headers: { Origin: origin } }),
        },
        (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (part: string) => {
            text += part;
          });
          response.once('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              text,
              cache: response.headers['cache-control'],
            }),
          );
        },
      );
      request.once('error', reject);
    },
  );
}
function upgradeStatus(port: number, path: string, origin?: string) {
  const socket = new WebSocket(
    `ws://127.0.0.1:${String(port)}${path}`,
    origin === undefined ? {} : { origin },
  );
  socket.on('error', () => {});
  return new Promise<number>((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      socket.terminate();
      resolve(response.statusCode ?? 0);
    });
    socket.once('open', () => {
      socket.terminate();
      reject(new Error('Unexpected upgrade'));
    });
  });
}

/** Real stored CREATE proof, actual OS interface and a still-held exclusive bind lease. */
async function host(options: { path?: string; shellPort?: number; discoveryPort?: number } = {}) {
  const db = openPersistenceDatabase(options.path ?? ':memory:');
  bootstrapDeviceIdentity(db);
  initializeNetworkInstallation(db);
  const holder: { runtime?: ReturnType<typeof createCampaignNetworkRuntime> } = {};
  const http = createServer((request, response) => {
    if (holder.runtime?.servePublicLocator(request, response)) return;
    response.end('own local shell');
  });
  await new Promise<void>((resolve) => http.listen(options.shellPort ?? 0, '127.0.0.1', resolve));
  const shellPort = portOf(http);
  const bind = createCampaignBindManager({
    readShellListener: () => (http.listening ? { address: '127.0.0.1', port: shellPort } : null),
  });
  const loopback = bind.interfaces().find((i) => i.hostAddress === '127.0.0.1');
  if (loopback === undefined) throw new Error('Actual loopback interface unavailable');
  const networkInterface = loopback.networkInterface;
  const settings = { ...config, discoveryPort: options.discoveryPort ?? (await freeUdpPort()) };
  const runtime = createCampaignNetworkRuntime({
    database: db,
    baseline,
    bind,
    shellServer: http,
    config: settings,
  });
  holder.runtime = runtime;
  const peers: Awaited<ReturnType<typeof connectCampaignPeerChannel>>[] = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const peer of peers) peer.close();
    await runtime.close();
    await bind.close();
    await closeHttp(http);
    if (db.open) db.close();
  };
  cleaners.push(close);
  const ownerDeviceId = loadDeviceId(db);
  const owned = () => {
    if (!http.listening || loadDeviceId(db) !== ownerDeviceId)
      throw new Error('Real owner unavailable');
  };
  async function save(kind: 'BORROWED_SHELL' | 'OWNED_RESERVATION') {
    const campaignId = randomUUID(),
      gmLocalContextId = randomUUID(),
      campaignDraftId = randomUUID(),
      port = kind === 'BORROWED_SHELL' ? shellPort : await freeTcpPort();
    ensureLocalGmProfile(db, { ownerDeviceId, masterProfileId: randomUUID() }, owned);
    const profile = readLocalGmProfile(db, ownerDeviceId);
    if (profile === null) throw new Error('Actual owner profile unavailable');
    createLocalGmContext(
      db,
      { ownerDeviceId, masterProfileId: profile.masterProfileId, gmLocalContextId },
      owned,
    );
    createCampaignDraft(db, { gmLocalContextId, campaignDraftId, expectedRevisions: zero }, owned);
    for (const stage of [
      {
        form: 'CMP-001',
        variant: 'METADATA',
        values: { title: `Stored ${kind}`, description: 'PRIVATE_DESCRIPTION', art: null },
      },
      {
        form: 'CMP-002',
        variant: 'HOST',
        values: {
          hostAddress: '127.0.0.1',
          hostPort: port,
          networkInterface,
          activePlayerCapacity: 3,
        },
      },
      { form: 'CMP-003', variant: 'SECRET', values: { secretProvided: true } },
      { form: 'CMP-004', variant: 'MODE', values: { defaultFutureRollMode: 'AUTO' } },
    ] as const) {
      let draft = readCampaignDraft(db, gmLocalContextId, campaignDraftId);
      if (draft.formId !== stage.form) {
        navigateCampaignDraft(
          db,
          {
            gmLocalContextId,
            campaignDraftId,
            expectedDraftRevision: draft.draftRevision,
            expectedRevisions: vector(draft),
            sourceFormId: draft.formId,
            targetFormId: stage.form,
          },
          owned,
        );
        draft = readCampaignDraft(db, gmLocalContextId, campaignDraftId);
      }
      commitCampaignDraftUpdate(
        db,
        {
          request: {
            messageType: 'campaign.draft.replace',
            protocolVersion: 3,
            draftUpdateId: randomUUID(),
            scope: { gmLocalContextId, campaignDraftId, sourceFormId: stage.form },
            expectedDraftRevision: draft.draftRevision,
            expectedRevisions: vector(draft),
            variant: stage.variant,
            values: stage.values,
          } as RedactedCampaignDraftRequest,
          ...(stage.variant === 'SECRET'
            ? { secretUpdate: { kind: 'REPLACE' as const, preparedVerifier: { ...secret } } }
            : {}),
        },
        owned,
      );
    }
    let draft = readCampaignDraft(db, gmLocalContextId, campaignDraftId);
    navigateCampaignDraft(
      db,
      {
        gmLocalContextId,
        campaignDraftId,
        expectedDraftRevision: draft.draftRevision,
        expectedRevisions: vector(draft),
        sourceFormId: draft.formId,
        targetFormId: 'CMP-005',
      },
      owned,
    );
    draft = readCampaignDraft(db, gmLocalContextId, campaignDraftId);
    const lease = await bind.prepare(campaignDraftId, draft.values.host);
    if (lease.status !== 'PASS' || lease.leaseIdOrNull === null)
      throw new Error('Actual bind unavailable');
    commitCampaignCreation(
      db,
      {
        campaignId,
        receiptId: randomUUID(),
        createdAt: '2026-10-30T12:00:00.000Z',
        baselineVersion: baseline.baselineVersion,
        qrPayload: campaignQrPayload('127.0.0.1', port, campaignId),
        request: {
          protocolVersion: 1,
          messageType: 'command.request',
          commandKind: 'workflow-command',
          workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
          role: 'gm',
          commandId: randomUUID(),
          expectedRevisions: vector(draft),
          payload: {
            stage: 'CAMPAIGN_CREATE',
            sourceFormId: 'CMP-005',
            gmLocalContextId,
            campaignDraftId,
            draftRevision: draft.draftRevision,
            preflightLeaseId: lease.leaseIdOrNull,
          },
        },
      },
      (fresh, context) => {
        owned();
        if (
          context.ownerDeviceId !== ownerDeviceId ||
          fresh.currentVerifier === null ||
          !bind.validate(lease.leaseIdOrNull!, campaignDraftId, fresh.values.host)
        )
          throw new Error('Actual CREATE source changed');
        validateMasterSecretVerifier(fresh.currentVerifier);
      },
    );
    bind.retainForCampaign(campaignDraftId, campaignId);
    return { campaignId, port, gmLocalContextId, campaignDraftId };
  }
  const validate = (value: Parameters<typeof validateMasterSecretVerifier>[0]): void => {
    validateMasterSecretVerifier(value);
  };
  const header = (id: string) =>
    readHostedCurrentPausedCampaign(db, id, (value) => validate(value.verifier));
  async function connect(campaignId: string, port: number) {
    const device = openPersistenceDatabase(':memory:');
    bootstrapDeviceIdentity(device);
    const material = initializeNetworkInstallation(device);
    device.close();
    const peer = await connectCampaignPeerChannel({
      target: parseCampaignLanAddress(`http://127.0.0.1:${String(port)}`),
      campaignId,
      deviceMaterial: material,
      hostTrust: {
        kind: 'PINNED',
        identity: campaignPeerPublicIdentity(loadNetworkInstallation(db)),
      },
      limits: settings.channel,
    });
    peers.push(peer);
    return peer;
  }
  return { db, http, bind, runtime, settings, shellPort, save, header, connect, close };
}

describe('actual saved-campaign network coordinator', () => {
  it('starts with no saved campaign without creating a profile, campaign or private publication', async () => {
    const h = await host(),
      before = h.db.serialize();
    await h.runtime.start();
    const response = await locator(h.shellPort);
    expect(JSON.parse(response.text)).toEqual({ protocolVersion: 3, campaigns: [] });
    expect(h.db.serialize().equals(before)).toBe(true);
    expect(await upgradeStatus(h.shellPort, '/campaign-state')).toBe(403);
  });

  it.each(['BORROWED_SHELL', 'OWNED_RESERVATION'] as const)(
    'publishes a saved %s through actual TCP/Ed25519 and closes only its own network surfaces',
    async (kind) => {
      const h = await host(),
        saved = await h.save(kind),
        initial = loadCampaignCheckpoint(h.db, saved.campaignId),
        before = h.db.serialize();
      const starting = h.runtime.start();
      expect(h.runtime.start()).toBe(starting);
      await starting;
      expect(h.bind.endpointForCampaign(saved.campaignId)).toMatchObject({
        kind,
        address: '127.0.0.1',
        port: saved.port,
      });
      const response = await locator(saved.port);
      expect(response.status).toBe(200);
      expect(response.cache).toBe('no-store');
      const directory = JSON.parse(response.text) as { campaigns: { campaignId: string }[] };
      expect(directory.campaigns.map((c) => c.campaignId)).toEqual([saved.campaignId]);
      expect(h.db.serialize().equals(before)).toBe(true);
      const peer = await h.connect(saved.campaignId, saved.port);
      const result = decodeDeviceAdmissionPeerResponse(
        await peer.call(
          encodeDeviceAdmissionPeerCommand(
            {
              schemaVersion: 1,
              operation: 'CONNECTION_OPEN',
              commandId: 'actual-coordinator-open',
              attemptId: 'actual-coordinator-attempt',
              campaignCheckpointSha256: h.header(saved.campaignId).checkpointSha256,
            },
            {
              maxSubmitBodyBytes: h.settings.transfer.maxSubmitBodyBytes,
              maxWitnessBytes: h.settings.transfer.maxWitnessBytes,
              maxChunkBytes: h.settings.transfer.maxChunkBytes,
            },
          ),
        ),
      );
      expect(result).toMatchObject({ outcome: 'ACK', receipt: { operation: 'OPEN' } });
      expect(loadCampaignCheckpoint(h.db, saved.campaignId)).toEqual(initial);
      expect(h.db.prepare('SELECT count(*) AS n FROM campaign_character_copy').get()).toEqual({
        n: 0,
      });
      expect(h.db.prepare('SELECT count(*) AS n FROM local_character').get()).toEqual({ n: 0 });
      expect(await locator(saved.port, `http://127.0.0.1:${String(saved.port)}`)).toMatchObject({
        status: 403,
      });
      expect(
        await upgradeStatus(
          saved.port,
          '/campaign-state',
          `http://127.0.0.1:${String(saved.port)}`,
        ),
      ).toBe(403);
      if (kind === 'OWNED_RESERVATION') expect(await upgradeStatus(saved.port, '/state')).toBe(404);
      const closing = h.runtime.close();
      expect(h.runtime.close()).toBe(closing);
      await closing;
      await vi.waitFor(() => expect(peer.closed).toBe(true));
      expect(h.http.listening).toBe(true);
      expect(await portOccupied(saved.port)).toBe(true);
      await expect(h.runtime.start()).rejects.toThrow('CLOSED');
      await expect(h.runtime.publishCampaign(saved.campaignId)).rejects.toThrow('CLOSED');
    },
  );

  it('publishes every saved campaign instead of choosing a first/latest row and preserves zero PCs', async () => {
    const h = await host(),
      one = await h.save('BORROWED_SHELL'),
      two = await h.save('BORROWED_SHELL'),
      owned = await h.save('OWNED_RESERVATION');
    await h.runtime.start();
    const borrowed = JSON.parse((await locator(h.shellPort)).text) as {
      campaigns: { campaignId: string; activePcCount: number }[];
    };
    expect(borrowed.campaigns.map((c) => c.campaignId).sort()).toEqual(
      [one.campaignId, two.campaignId].sort(),
    );
    expect(borrowed.campaigns.every((c) => c.activePcCount === 0)).toBe(true);
    expect(
      (
        JSON.parse((await locator(owned.port)).text) as { campaigns: { campaignId: string }[] }
      ).campaigns.map((c) => c.campaignId),
    ).toEqual([owned.campaignId]);
  });

  it('publishes a newly committed CREATE after an already empty startup without reallocating its held socket or source IDs', async () => {
    const h = await host();
    await h.runtime.start();
    const saved = await h.save('OWNED_RESERVATION'),
      before = h.db.serialize(),
      bound = h.bind.endpointForCampaign(saved.campaignId);
    expect(await h.runtime.publishCampaign(saved.campaignId)).toMatchObject({ status: 'RESERVED' });
    expect(await h.runtime.publishCampaign(saved.campaignId)).toMatchObject({ status: 'RESERVED' });
    expect(h.bind.endpointForCampaign(saved.campaignId)).toEqual(bound);
    expect(h.db.serialize().equals(before)).toBe(true);
    const response = JSON.parse((await locator(saved.port)).text) as {
      campaigns: { campaignId: string }[];
    };
    expect(response.campaigns.map((c) => c.campaignId)).toEqual([saved.campaignId]);
    expect((await h.connect(saved.campaignId, saved.port)).campaign.campaignId).toBe(
      saved.campaignId,
    );
  });

  it('recovers exact saved borrowed and owned endpoints after a complete listener/SQLite restart without new IDs or source writes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'coordinator-restart-'));
    directories.push(directory);
    const path = join(directory, 'host.sqlite'),
      first = await host({ path }),
      borrowed = await first.save('BORROWED_SHELL'),
      owned = await first.save('OWNED_RESERVATION');
    await first.runtime.start();
    const original = [borrowed, owned].map((s) => loadCampaignCheckpoint(first.db, s.campaignId)),
      identity = loadNetworkInstallation(first.db),
      shellPort = first.shellPort;
    await first.close();
    const fresh = await host({ path, shellPort });
    const before = fresh.db.serialize();
    await fresh.runtime.start();
    expect(fresh.db.serialize().equals(before)).toBe(true);
    expect(loadNetworkInstallation(fresh.db)).toEqual(identity);
    for (const [index, saved] of [borrowed, owned].entries()) {
      expect(loadCampaignCheckpoint(fresh.db, saved.campaignId)).toEqual(original[index]);
      expect(fresh.bind.endpointForCampaign(saved.campaignId)).toMatchObject({
        address: '127.0.0.1',
        port: saved.port,
      });
      expect((await locator(saved.port)).status).toBe(200);
      expect((await fresh.connect(saved.campaignId, saved.port)).campaign.campaignId).toBe(
        saved.campaignId,
      );
    }
    expect(fresh.db.prepare('SELECT count(*) AS n FROM campaign').get()).toEqual({ n: 2 });
    expect(fresh.db.prepare('SELECT count(*) AS n FROM hosted_technical_session').get()).toEqual({
      n: 0,
    });
  });

  it('reports an occupied saved endpoint after restart while publishing another campaign and retaining immutable source bytes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'coordinator-occupied-'));
    directories.push(directory);
    const path = join(directory, 'host.sqlite'),
      first = await host({ path }),
      owned = await first.save('OWNED_RESERVATION'),
      borrowed = await first.save('BORROWED_SHELL'),
      shellPort = first.shellPort;
    await first.close();
    const blocker = createNetServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => blocker.listen(owned.port, '127.0.0.1', resolve));
    cleaners.push(async () => {
      if (blocker.listening) await new Promise<void>((resolve) => blocker.close(() => resolve()));
    });
    const fresh = await host({ path, shellPort }),
      before = fresh.db.serialize();
    await fresh.runtime.start();
    expect(fresh.bind.endpointForCampaign(owned.campaignId)).toBeNull();
    expect(fresh.bind.endpointForCampaign(borrowed.campaignId)).toMatchObject({ port: shellPort });
    expect(fresh.runtime.diagnostics()).toContain('PUBLICATION_UNAVAILABLE');
    expect(fresh.db.serialize().equals(before)).toBe(true);
    expect(
      (
        JSON.parse((await locator(shellPort)).text) as { campaigns: { campaignId: string }[] }
      ).campaigns.map((c) => c.campaignId),
    ).toEqual([borrowed.campaignId]);
  });

  it('refuses a corrupt saved owner proof at startup instead of silently dropping the campaign or repairing SQLite', async () => {
    const h = await host(),
      saved = await h.save('BORROWED_SHELL');
    h.db
      .prepare('UPDATE campaign_private_owner SET record_sha256=? WHERE campaign_id=?')
      .run('0'.repeat(64), saved.campaignId);
    const before = h.db.serialize(),
      error: unknown = await h.runtime.start().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(h.db.serialize().equals(before)).toBe(true);
    expect(JSON.parse((await locator(h.shellPort)).text)).toEqual({
      protocolVersion: 3,
      campaigns: [],
    });
    expect(await upgradeStatus(h.shellPort, '/campaign-state')).toBe(403);
  });

  it('revokes a now-corrupt publication and returns a fixed unavailable locator without exposing private proof data', async () => {
    const h = await host(),
      saved = await h.save('BORROWED_SHELL');
    await h.runtime.start();
    const peer = await h.connect(saved.campaignId, saved.port);
    h.db
      .prepare('UPDATE campaign_private_owner SET record_sha256=? WHERE campaign_id=?')
      .run('0'.repeat(64), saved.campaignId);
    const before = h.db.serialize(),
      response = await locator(saved.port);
    expect(response).toMatchObject({ status: 503, text: '{"error":"LOCATOR_UNAVAILABLE"}' });
    expect(await h.runtime.publishCampaign(saved.campaignId)).toEqual({
      status: 'UNAVAILABLE',
      reasonCode: 'BIND_FAILED',
    });
    await vi.waitFor(() => expect(peer.closed).toBe(true));
    expect(h.runtime.diagnostics()).toContain('PUBLICATION_UNAVAILABLE');
    expect(h.db.serialize().equals(before)).toBe(true);
  });

  it('discovers actual public-only campaign offers and aborts pending discovery during shutdown', async () => {
    const h = await host(),
      saved = await h.save('BORROWED_SHELL');
    await h.runtime.start();
    const before = h.db.serialize(),
      result = await h.runtime.discover();
    expect(result.offers.map((o) => o.campaign.campaignId)).toEqual([saved.campaignId]);
    const bytes = Buffer.from(JSON.stringify(result));
    for (const privateValue of [
      SECRET,
      'PRIVATE_DESCRIPTION',
      'verifier',
      'privateKey',
      'gmLocalContextId',
      'campaignDraftId',
      'canonicalWitnessText',
      'gmQueue',
    ])
      expect(bytes.toString('utf8')).not.toContain(privateValue);
    expect(h.db.serialize().equals(before)).toBe(true);
    const pending = h.runtime.discover();
    await h.runtime.close();
    await pending;
    await expect(h.runtime.discover()).rejects.toThrow('CLOSED');
  });
});

it('reads connection snapshots through the actual coordinator and rejects unknown stored requests without writes', async () => {
  const h = await host(),
    saved = await h.save('BORROWED_SHELL');
  await h.runtime.start();
  const before = h.db.serialize(),
    empty = h.runtime.requestConnectionFacts(saved.campaignId, []);
  expect(empty).toEqual([]);
  expect(Object.isFrozen(empty)).toBe(true);
  expect(() => h.runtime.requestConnectionFacts(saved.campaignId, [randomUUID()])).toThrow();
  expect(() => h.runtime.requestConnectionFacts(randomUUID(), [])).toThrow();
  expect(h.db.serialize().equals(before)).toBe(true);
});
