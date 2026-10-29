import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { createHost, startHost } from '../../src/host/server.js';
import {
  bootstrapDeviceIdentity,
  openPersistenceDatabase,
  readCampaignDraft,
} from '../../src/persistence/index.js';
import { loadCampaignCheckpoint } from '../../src/persistence/store.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
function receive(socket: WebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const result: unknown[] = [];
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('campaign replay timed out'));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('message', message);
      socket.off('error', error);
    };
    const error = (reason: Error) => {
      cleanup();
      reject(reason);
    };
    const message = (data: WebSocket.RawData) => {
      const bytes = Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Buffer.concat(data);
      result.push(JSON.parse(bytes.toString('utf8')) as unknown);
      if (result.length === count) {
        cleanup();
        resolve(result);
      }
    };
    socket.on('message', message);
    socket.on('error', error);
  });
}

/** Uses the normal local TCP/Origin proof and a real disk database; no authority adapter. */
export async function createCampaignBrowserHost() {
  const directory = await mkdtemp(join(tmpdir(), 'symbiosis-campaign-e2e-'));
  const databasePath = join(directory, 'campaign.sqlite');
  let db = openPersistenceDatabase(databasePath),
    app: FastifyInstance | undefined;
  bootstrapDeviceIdentity(db);
  let baseURL = '',
    listenPort = 0,
    receipts = 0;
  let revisions = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
  const errors: string[] = [];
  const listen = async () => {
    app = await createHost({
      database: db,
      projectRoot: ROOT,
      staticRoot: join(ROOT, 'dist/web'),
      allocateContextId: randomUUID,
      allocateLocalCharacterId: randomUUID,
      allocateWizardCheckpointId: randomUUID,
      allocateCreationBranchUuid: randomUUID,
      allocateCreationRollRequestId: randomUUID,
      allocateReceiptId: () => {
        receipts += 1;
        return randomUUID();
      },
      readRevisions: () => revisions,
      advanceRevisions: (impact) => {
        revisions = {
          stateRevision: revisions.stateRevision + Number(impact.stateChanged),
          projectionRevision: revisions.projectionRevision + Number(impact.projectionChanged),
          actorVisibilityRevision:
            revisions.actorVisibilityRevision + Number(impact.actorVisibilityChanged),
        };
        return revisions;
      },
      sampleCreationD20: () => {
        throw new Error('campaign creation must not sample gameplay dice');
      },
      onFrameError: (error: unknown) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
    });
    baseURL = await startHost(app, { interface: '127.0.0.1', port: listenPort });
    listenPort = Number(new URL(baseURL).port);
  };
  try {
    await listen();
  } catch (error) {
    if (app) await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const campaignRows = () =>
    db
      .prepare<[], { campaign_id: string; lifecycle_state: string; payload_json: string }>(
        'SELECT campaign_id, lifecycle_state, payload_json FROM campaign ORDER BY campaign_id',
      )
      .all();
  return {
    get baseURL() {
      return baseURL;
    },
    errors,
    receiptAllocations: () => receipts,
    campaigns: campaignRows,
    persistenceCounts: () => ({
      campaigns: (db.prepare('SELECT count(*) AS n FROM campaign').get() as { n: number }).n,
      checkpoints: (
        db.prepare('SELECT count(*) AS n FROM campaign_checkpoint').get() as { n: number }
      ).n,
      credentials: (
        db.prepare('SELECT count(*) AS n FROM campaign_private_owner').get() as { n: number }
      ).n,
    }),
    drafts: () =>
      db
        .prepare<[], { draft_id: string; context_id: string }>(
          'SELECT draft_id, context_id FROM campaign_draft ORDER BY rowid',
        )
        .all()
        .map((row) => readCampaignDraft(db, row.context_id, row.draft_id)),
    checkpoint: () => {
      const row = campaignRows()[0];
      if (!row) throw new Error('campaign does not exist');
      return loadCampaignCheckpoint(db, row.campaign_id);
    },
    committedCommands: () =>
      db
        .prepare<[], { command_id: string; receipt_json: string }>(
          'SELECT command_id, receipt_json FROM campaign_creation_command ORDER BY rowid',
        )
        .all(),
    containsPlaintext: (secret: string) =>
      [
        'campaign_draft',
        'campaign_draft_update',
        'campaign_private_owner',
        'campaign_creation_command',
        'campaign',
        'campaign_checkpoint',
      ].some((table) =>
        JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()).includes(secret),
      ),
    restart: async () => {
      await app!.close();
      db.close();
      db = openPersistenceDatabase(databasePath);
      await listen();
    },
    replay: async (resumeText: string, commandText: string) => {
      const socket = new WebSocket(baseURL.replace(/^http/u, 'ws') + '/state', {
        origin: new URL(baseURL).origin,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once('open', resolve);
          socket.once('error', reject);
        });
        const ready = receive(socket, 2);
        socket.send(resumeText);
        await ready;
        const response = receive(socket, 2);
        socket.send(commandText);
        return await response;
      } finally {
        socket.terminate();
      }
    },
    close: async () => {
      try {
        await app!.close();
      } finally {
        if (db.open) db.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
