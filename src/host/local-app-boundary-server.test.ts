import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import WebSocket, { type RawData } from 'ws';
import { bootstrapDeviceIdentity, openPersistenceDatabase } from '../persistence/index.js';
import type { RevisionVector } from '../shared/index.js';
import * as masterSecret from './campaign-secret.js';
import { createHost, startHost } from './server.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ZERO: RevisionVector = {
  stateRevision: 0,
  projectionRevision: 0,
  actorVisibilityRevision: 0,
};
const INPUT_SENTINEL = 'private-input-must-not-appear-in-refusal';
const REFUSAL = {
  messageType: 'protocol.refusal',
  protocolVersion: 1,
  relatedCommandId: null,
  refusal: { code: 'UNRECOGNIZED', path: '$.localAppConnection', value: null },
};
type Headers = Readonly<Record<string, string>>;

function text(data: RawData): string {
  return (
    Buffer.isBuffer(data)
      ? data
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : Buffer.concat(data)
  ).toString('utf8');
}

function httpGet(url: string, headers: Headers = {}) {
  return new Promise<{ status: number; cacheControl: string | undefined; body: string }>(
    (resolve, reject) => {
      const req = request(url, { method: 'GET', headers, agent: false }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            cacheControl: response.headers['cache-control'],
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      });
      req.on('error', reject);
      req.end();
    },
  );
}

function receive(socket: WebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('local boundary response timed out'));
    }, 5_000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onMessage = (data: RawData) => {
      messages.push(JSON.parse(text(data)) as unknown);
      if (messages.length === count) {
        cleanup();
        resolve(messages);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => onError(new Error('local boundary connection closed early'));
    socket.on('message', onMessage);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

describe('private local application boundary on a real TCP listener', () => {
  let app: FastifyInstance;
  let database: ReturnType<typeof openPersistenceDatabase>;
  let directory: string;
  let origin: string;
  let localhostOrigin: string;
  let deviceId: string;
  let revisions = { ...ZERO };
  let beforeBytes: Buffer;
  let prepare: MockInstance<typeof database.prepare>;
  const sockets = new Set<WebSocket>();
  const allocate = vi.fn(randomUUID);
  const readRevisions = vi.fn(() => revisions);
  const advanceRevisions = vi.fn(
    (impact: {
      stateChanged: boolean;
      projectionChanged: boolean;
      actorVisibilityChanged: boolean;
    }) => {
      revisions = {
        stateRevision: revisions.stateRevision + Number(impact.stateChanged),
        projectionRevision: revisions.projectionRevision + Number(impact.projectionChanged),
        actorVisibilityRevision:
          revisions.actorVisibilityRevision + Number(impact.actorVisibilityChanged),
      };
      return revisions;
    },
  );
  const sample = vi.fn(() => 10);
  const frameError = vi.fn<(error: unknown) => void>();
  const prepareSecret = vi.spyOn(masterSecret, 'prepareMasterSecret');
  const verifySecret = vi.spyOn(masterSecret, 'verifyMasterSecret');

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'symbiosis-local-boundary-'));
    await writeFile(join(directory, 'index.html'), '<main>public shell</main>', 'utf8');
    database = openPersistenceDatabase(join(directory, 'private.sqlite'));
    deviceId = bootstrapDeviceIdentity(database);
    app = await createHost({
      database,
      projectRoot: PROJECT_ROOT,
      staticRoot: directory,
      allocateContextId: allocate,
      allocateLocalCharacterId: allocate,
      allocateWizardCheckpointId: allocate,
      allocateCreationBranchUuid: allocate,
      allocateCreationRollRequestId: allocate,
      allocateReceiptId: allocate,
      readRevisions,
      advanceRevisions,
      sampleCreationD20: sample,
      onFrameError: frameError,
    });
    origin = new URL(await startHost(app, { interface: '127.0.0.1', port: 0 })).origin;
    localhostOrigin = `http://localhost:${new URL(origin).port}`;
    prepare = vi.spyOn(database, 'prepare');
  });

  beforeEach(() => {
    revisions = { ...ZERO };
    vi.clearAllMocks();
    beforeBytes = database.serialize();
  });

  afterAll(async () => {
    for (const socket of sockets) socket.terminate();
    await app.close();
    prepare.mockRestore();
    prepareSecret.mockRestore();
    verifySecret.mockRestore();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function open(headers: Headers = {}) {
    const socket = new WebSocket(origin.replace(/^http/u, 'ws') + '/state', { headers });
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    await once(socket, 'open');
    return socket;
  }

  function unchangedPrivateState() {
    expect(prepare).not.toHaveBeenCalled();
    expect(readRevisions).not.toHaveBeenCalled();
    expect(advanceRevisions).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
    expect(sample).not.toHaveBeenCalled();
    expect(prepareSecret).not.toHaveBeenCalled();
    expect(verifySecret).not.toHaveBeenCalled();
    expect(frameError).not.toHaveBeenCalled();
    expect(revisions).toEqual(ZERO);
    expect(database.serialize()).toEqual(beforeBytes);
  }

  function reconnectV1() {
    return {
      messageType: 'projection.reconnect',
      protocolVersion: 1,
      projectionRole: 'player',
      requestId: INPUT_SENTINEL,
      knownRevisions: ZERO,
      supportedWorkflowCommandIds: [],
      unacknowledgedCommandIds: [],
    };
  }
  function reconnectV2() {
    return {
      messageType: 'session.reconnect',
      protocolVersion: 2,
      deviceId,
      reconnectRequestId: INPUT_SENTINEL,
      knownRevisions: ZERO,
      supportedWorkflowCommandIds: [],
      unacknowledgedCommandIds: [],
    };
  }
  function input(kind: string): string | Buffer {
    switch (kind) {
      case 'v1':
        return JSON.stringify(reconnectV1());
      case 'v2':
        return JSON.stringify(reconnectV2());
      case 'v3 identity':
        return JSON.stringify({
          messageType: 'character.identity-draft.replace',
          protocolVersion: 3,
          draftUpdateId: INPUT_SENTINEL,
          expectedDraftRevision: 0,
          expectedRevisions: ZERO,
          scope: {
            characterDraftId: '11111111-1111-4111-8111-111111111111',
            contextId: '22222222-2222-4222-8222-222222222222',
            wizardCheckpointId: 'private-checkpoint',
            sourceFormId: 'CHR-001',
          },
          values: {
            name: INPUT_SENTINEL,
            description: INPUT_SENTINEL,
            age: 30,
            massKg: 70,
            sex: 'FEMALE',
            artAssetKeyOrLocalFile: {
              kind: 'asset-key',
              assetKey: 'symbiosis_placeholder_free_female',
            },
          },
        });
      case 'v3 secret':
        return JSON.stringify({
          messageType: 'campaign.draft.replace',
          protocolVersion: 3,
          variant: 'SECRET',
          draftUpdateId: INPUT_SENTINEL,
          expectedDraftRevision: 0,
          expectedRevisions: ZERO,
          scope: {
            gmLocalContextId: '22222222-2222-4222-8222-222222222222',
            campaignDraftId: '33333333-3333-4333-8333-333333333333',
            sourceFormId: 'CMP-003',
          },
          values: {
            masterTransferPassword: INPUT_SENTINEL,
            masterTransferPasswordConfirmation: INPUT_SENTINEL,
          },
        });
      case 'malformed':
        return `{"private":"${INPUT_SENTINEL}"`;
      case 'binary':
        return Buffer.from(INPUT_SENTINEL);
      default:
        throw new Error('unknown boundary test frame');
    }
  }

  async function assertRefused(headers: Headers, frame: string | Buffer) {
    const socket = await open(headers);
    const frames: string[] = [];
    socket.on('message', (data: RawData) => frames.push(text(data)));
    const closed = new Promise<readonly [number, Buffer]>((resolve, reject) => {
      socket.once('close', (code, reason) => resolve([code, reason]));
      socket.once('error', reject);
    });
    socket.send(frame);
    const [code, reason] = await closed;
    expect(code).toBe(1008);
    expect(reason).toEqual(Buffer.from('local app connection required'));
    expect(frames.map((frameText) => JSON.parse(frameText) as unknown)).toEqual([REFUSAL]);
    expect(frames.join('\n')).not.toContain(deviceId);
    expect(frames.join('\n')).not.toContain(INPUT_SENTINEL);
    unchangedPrivateState();
  }

  for (const untrusted of ['foreign', 'missing', 'null'] as const) {
    it.each(['v1', 'v2', 'v3 identity', 'v3 secret', 'malformed', 'binary'])(
      `refuses ${untrusted} Origin before decoding %s or reading private state`,
      async (kind) => {
        const headers =
          untrusted === 'missing'
            ? {}
            : { Origin: untrusted === 'null' ? 'null' : 'http://untrusted.invalid' };
        await assertRefused(headers, input(kind));
      },
    );
  }

  it.each(['foreign', 'missing', 'null'] as const)(
    'does not accept forged Host, forwarded Origin or peer headers with %s Origin',
    async (kind) => {
      const headers: Record<string, string> = {
        Host: new URL(origin).host,
        Forwarded: `for=127.0.0.1;host=${new URL(origin).host};proto=http`,
        'X-Forwarded-For': '127.0.0.1',
        'X-Forwarded-Host': new URL(origin).host,
        'X-Forwarded-Origin': origin,
        'X-Real-IP': '127.0.0.1',
        'X-Device-Id': deviceId,
        'X-Local-App': 'true',
      };
      if (kind !== 'missing')
        headers['Origin'] = kind === 'null' ? 'null' : 'http://untrusted.invalid';
      await assertRefused(headers, input('v2'));
    },
  );

  it.each(['foreign', 'null', 'wrong port', 'noncanonical path'])(
    'denies %s HTTP Origin without reading or disclosing device identity',
    async (kind) => {
      const badOrigin =
        kind === 'foreign'
          ? 'http://untrusted.invalid'
          : kind === 'null'
            ? 'null'
            : kind === 'wrong port'
              ? 'http://127.0.0.1:1'
              : `${origin}/`;
      const response = await httpGet(`${origin}/device-identity`, {
        Origin: badOrigin,
        Host: new URL(origin).host,
        'X-Forwarded-Origin': origin,
        'X-Forwarded-For': '127.0.0.1',
      });
      expect(response).toEqual({
        status: 403,
        cacheControl: 'no-store',
        body: '{"error":"LOCAL_APP_ONLY"}',
      });
      expect(response.body).not.toContain(deviceId);
      unchangedPrivateState();
    },
  );

  it.each(['numeric', 'localhost', 'absent'])(
    'serves the same stored identity to local read-only HTTP with %s Origin',
    async (kind) => {
      const headers =
        kind === 'absent' ? {} : { Origin: kind === 'numeric' ? origin : localhostOrigin };
      const response = await httpGet(`${origin}/device-identity`, headers);
      expect(response).toEqual({
        status: 200,
        cacheControl: 'no-store',
        body: JSON.stringify({ deviceId }),
      });
      expect(prepare).toHaveBeenCalled();
      expect(database.serialize()).toEqual(beforeBytes);
      expect(allocate).not.toHaveBeenCalled();
      expect(advanceRevisions).not.toHaveBeenCalled();
    },
  );

  it.each(['numeric', 'localhost'])(
    'allows actual local %s Origin through v1 and the v2 player library journey',
    async (kind) => {
      const headers = { Origin: kind === 'numeric' ? origin : localhostOrigin };
      const legacy = await open(headers);
      let response = receive(legacy, 1);
      legacy.send(JSON.stringify(reconnectV1()));
      expect(await response).toMatchObject([
        {
          messageType: 'projection.snapshot',
          protocolVersion: 1,
          projection: { formId: 'APP-001' },
        },
      ]);
      legacy.terminate();
      const socket = await open(headers);
      response = receive(socket, 2);
      socket.send(JSON.stringify(reconnectV2()));
      expect(await response).toMatchObject([
        { messageType: 'session.reconnect.capabilities', protocolVersion: 2 },
        { messageType: 'projection.snapshot', presentation: { base: { formId: 'APP-001' } } },
      ]);
      for (const [sourceFormId, actionKey, expectedProjectionRevision, target] of [
        ['APP-001', 'APP-001::CTA::001', 0, 'APP-002'],
        ['APP-002', 'APP-002::CTA::002', 1, 'APP-004'],
      ] as const) {
        response = receive(socket, 1);
        socket.send(
          JSON.stringify({
            messageType: 'navigation.form-action',
            protocolVersion: 2,
            navigationRequestId: randomUUID(),
            sourceFormId,
            actionKey,
            expectedProjectionRevision,
          }),
        );
        expect(await response).toMatchObject([
          { messageType: 'projection.snapshot', presentation: { base: { formId: target } } },
        ]);
      }
      expect(prepare).toHaveBeenCalled();
      expect(allocate).toHaveBeenCalledOnce();
      expect(advanceRevisions).toHaveBeenCalledTimes(2);
      expect(prepareSecret).not.toHaveBeenCalled();
      expect(verifySecret).not.toHaveBeenCalled();
      expect(frameError).not.toHaveBeenCalled();
      socket.terminate();
    },
  );
});
