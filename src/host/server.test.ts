import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RawData, WebSocket } from 'ws';

import {
  decodeHostMessage,
  decodeHostMessageV2,
  encodeClientMessage,
  encodeClientMessageV2,
  WIRE_PROTOCOL_VERSION,
  WIRE_PROTOCOL_V2_VERSION,
} from '@shared/index.js';
import type {
  ClientToHostMessage,
  ClientToHostV2Message,
  FormActionIntentV2Message,
  HostToClientMessage,
  HostToClientV2Message,
  IdentityDraftReplaceV2Message,
  ProjectionReconnectMessage,
  ProtocolVocabulary,
  RevisionVector,
  SessionReconnectV2Message,
  WireV2Vocabulary,
} from '@shared/index.js';

import { openPersistenceDatabase } from '../persistence/database.js';
import {
  bootstrapDeviceIdentity,
  loadDeviceId,
  resetDeviceIdentity,
} from '../persistence/index.js';
import type { RevisionImpact } from '../persistence/index.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { loadAppProjectionCatalog, projectApp001Bootstrap } from './projections/app.js';
import type { App001Projection } from './projections/app.js';
import { createHost, startHost } from './server.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ACTUAL_REVISIONS = {
  actorVisibilityRevision: 3,
  projectionRevision: 7,
  stateRevision: 5,
} as const satisfies RevisionVector;
const CLIENT_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;

function reconnect(
  overrides: Partial<ProjectionReconnectMessage> = {},
): ProjectionReconnectMessage {
  return {
    knownRevisions: CLIENT_REVISIONS,
    messageType: 'projection.reconnect',
    projectionRole: 'player',
    protocolVersion: WIRE_PROTOCOL_VERSION,
    requestId: 'reconnect-1',
    supportedWorkflowCommandIds: [],
    unacknowledgedCommandIds: [],
    ...overrides,
  };
}

function reconnectV2(
  deviceId: string,
  overrides: Partial<SessionReconnectV2Message> = {},
): SessionReconnectV2Message {
  return {
    deviceId,
    knownRevisions: CLIENT_REVISIONS,
    messageType: 'session.reconnect',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    reconnectRequestId: 'reconnect-v2-1',
    supportedWorkflowCommandIds: [],
    unacknowledgedCommandIds: [],
    ...overrides,
  };
}

function formAction(
  navigationRequestId: string,
  sourceFormId: FormActionIntentV2Message['sourceFormId'],
  actionKey: FormActionIntentV2Message['actionKey'],
  expectedProjectionRevision: number,
): FormActionIntentV2Message {
  return {
    actionKey,
    expectedProjectionRevision,
    messageType: 'navigation.form-action',
    navigationRequestId,
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    sourceFormId,
  };
}

function clientText(message: ClientToHostMessage, vocabulary: ProtocolVocabulary): string {
  const encoded = encodeClientMessage(message, vocabulary);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.refusal));
  return encoded.text;
}

function clientTextV2(message: ClientToHostV2Message, vocabulary: WireV2Vocabulary): string {
  const encoded = encodeClientMessageV2(message, vocabulary);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.refusal));
  return encoded.text;
}

function receiveFrames(socket: WebSocket, count: number): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    const result: string[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${String(count)} websocket frame(s)`));
    }, 5_000);
    const onMessage = (data: RawData): void => {
      result.push(rawDataText(data));
      if (result.length === count) {
        cleanup();
        resolve(result);
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (code: number): void => {
      cleanup();
      reject(new Error(`websocket closed with code ${String(code)}`));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    socket.on('message', onMessage);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

async function receiveSettledFrames(
  socket: WebSocket,
  minimumCount: number,
): Promise<readonly string[]> {
  const result: string[] = [];
  const collect = (data: RawData): void => {
    result.push(rawDataText(data));
  };
  socket.on('message', collect);
  try {
    await receiveFrames(socket, minimumCount);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return result;
  } finally {
    socket.off('message', collect);
  }
}

function rawDataText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  throw new TypeError('test received an unsupported RawData representation');
}

function hostMessage(text: string, vocabulary: ProtocolVocabulary): HostToClientMessage {
  const decoded = decodeHostMessage(text, vocabulary);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.refusal));
  return decoded.value;
}

function hostMessageV2(text: string, vocabulary: WireV2Vocabulary): HostToClientV2Message {
  const decoded = decodeHostMessageV2(text, vocabulary);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.refusal));
  return decoded.value;
}

describe('configured Fastify and ws host shell', () => {
  let app: FastifyInstance;
  let app001Bootstrap: App001Projection;
  let contextIdOverride: string | null = null;
  let currentRevisions: RevisionVector = ACTUAL_REVISIONS;
  let database: ReturnType<typeof openPersistenceDatabase>;
  let deviceId: string;
  const frameErrors: unknown[] = [];
  let gmOnlyFields: readonly string[];
  let localCharacterIdOverride: string | null = null;
  const revisionWrites: RevisionImpact[] = [];
  let revisionReads = 0;
  let staticRoot: string;
  let uuidSequence = 0;
  let vocabulary: ProtocolVocabulary & WireV2Vocabulary;
  let wizardCheckpointIdOverride: string | null = null;
  let wizardSequence = 0;

  beforeAll(async () => {
    staticRoot = await mkdtemp(join(tmpdir(), 'symbiosis-host-static-'));
    await Promise.all([
      writeFile(join(staticRoot, 'index.html'), '<main data-form="APP-001">shell</main>', 'utf8'),
      writeFile(join(staticRoot, 'app.js'), 'globalThis.symbiosis = true;', 'utf8'),
    ]);
    database = openPersistenceDatabase(':memory:');
    deviceId = bootstrapDeviceIdentity(database);
    vocabulary = await loadProtocolVocabulary(PROJECT_ROOT);
    const catalog = await loadAppProjectionCatalog(PROJECT_ROOT);
    app001Bootstrap = projectApp001Bootstrap(catalog);
    gmOnlyFields = (['APP-005', 'APP-011'] as const).flatMap((formId) => {
      const form = catalog.forms.get(formId);
      if (form === undefined) throw new Error(`missing APP contract ${formId}`);
      return form.requiredFields.map((field) => field.replace(/(?:\[\]|=.*)$/u, ''));
    });
    app = await createHost({
      advanceRevisions: (impact) => {
        revisionWrites.push(impact);
        currentRevisions = {
          actorVisibilityRevision:
            currentRevisions.actorVisibilityRevision + Number(impact.actorVisibilityChanged),
          projectionRevision:
            currentRevisions.projectionRevision + Number(impact.projectionChanged),
          stateRevision: currentRevisions.stateRevision + Number(impact.stateChanged),
        };
        return currentRevisions;
      },
      allocateContextId: () =>
        contextIdOverride ?? `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`,
      allocateLocalCharacterId: () =>
        localCharacterIdOverride ??
        `10000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`,
      allocateWizardCheckpointId: () =>
        wizardCheckpointIdOverride ?? `opaque-wizard-${String(++wizardSequence)}`,
      database,
      onFrameError: (error) => frameErrors.push(error),
      projectRoot: PROJECT_ROOT,
      readRevisions: () => {
        revisionReads += 1;
        return currentRevisions;
      },
      staticRoot,
    });
    await startHost(app, { interface: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await app.close();
    database.close();
    await rm(staticRoot, { force: true, recursive: true });
  });

  afterEach(() => {
    contextIdOverride = null;
    localCharacterIdOverride = null;
    wizardCheckpointIdOverride = null;
  });

  it('listens on the configured interface and port and serves HTTP/static files', async () => {
    const address = app.server.address();
    expect(address).not.toBeNull();
    expect(typeof address).not.toBe('string');
    if (address === null || typeof address === 'string') throw new Error('host has no TCP address');
    expect(address.address).toBe('127.0.0.1');
    expect(address.port).toBeGreaterThan(0);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(204);
    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(200);
    expect(index.headers['content-type']).toContain('text/html');
    expect(index.body).toContain('data-form="APP-001"');
    const script = await app.inject({ method: 'GET', url: '/app.js' });
    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    const missing = await app.inject({ method: 'GET', url: '/not-built.js' });
    expect(missing.statusCode).toBe(404);
  });

  it('serves the persisted device identity without caching or rotating it', async () => {
    const first = await app.inject({ method: 'GET', url: '/device-identity' });
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(first.body)).toEqual({ deviceId });

    const second = await app.inject({ method: 'GET', url: '/device-identity' });
    expect(second.statusCode).toBe(200);
    expect(second.headers['cache-control']).toBe('no-store');
    expect(second.body).toBe(first.body);
    expect(loadDeviceId(database)).toBe(deviceId);
  });

  it('diagnoses an unavailable device identity without silently bootstrapping it', async () => {
    const uninitializedDatabase = openPersistenceDatabase(':memory:');
    const endpointErrors: unknown[] = [];
    const uninitializedHost = await createHost({
      advanceRevisions: () => CLIENT_REVISIONS,
      allocateContextId: () => '00000000-0000-4000-8000-000000000001',
      allocateLocalCharacterId: () => '10000000-0000-4000-8000-000000000001',
      allocateWizardCheckpointId: () => 'opaque-wizard-uninitialized',
      database: uninitializedDatabase,
      onFrameError: (error) => endpointErrors.push(error),
      projectRoot: PROJECT_ROOT,
      readRevisions: () => CLIENT_REVISIONS,
      staticRoot,
    });
    try {
      const response = await uninitializedHost.inject({
        method: 'GET',
        url: '/device-identity',
      });
      expect(response.statusCode).toBe(503);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(response.body)).toEqual({
        error: 'device identity unavailable: device identity is not initialized',
      });
      expect(endpointErrors).toEqual([]);
      expect(() => loadDeviceId(uninitializedDatabase)).toThrow('not initialized');
      expect(
        uninitializedDatabase
          .prepare<[], { device_id: string | null; initialized: number }>(
            'SELECT device_id, initialized FROM device_identity WHERE identity_slot = 1',
          )
          .get(),
      ).toEqual({ device_id: null, initialized: 0 });
    } finally {
      await uninitializedHost.close();
      uninitializedDatabase.close();
    }
  });

  it('rejects invalid network configuration before listening', async () => {
    await expect(startHost(app, { interface: '', port: 0 })).rejects.toThrow(
      'interface configuration',
    );
    await expect(startHost(app, { interface: '127.0.0.1', port: 65_536 })).rejects.toThrow(
      'port configuration',
    );
  });

  it('closes fail-closed when visibility revision exceeds projection revision', async () => {
    const socket = await app.injectWS('/state');
    const closed = new Promise<number>((resolve) => {
      socket.once('close', (code: number) => resolve(code));
    });
    currentRevisions = { ...ACTUAL_REVISIONS, actorVisibilityRevision: 8 };
    try {
      socket.send(clientText(reconnect({ requestId: 'invalid-revisions' }), vocabulary));
      await expect(closed).resolves.toBe(1011);
      expect(frameErrors.at(-1)).toEqual(
        new Error('actorVisibilityRevision cannot exceed projectionRevision'),
      );
    } finally {
      currentRevisions = ACTUAL_REVISIONS;
      socket.terminate();
    }
  });

  it('sends a checked APP-001 player snapshot with host revisions', async () => {
    const socket = await app.injectWS('/state');
    const response = receiveFrames(socket, 1);
    socket.send(clientText(reconnect(), vocabulary));
    const [text] = await response;
    if (text === undefined) throw new Error('missing websocket response');
    const message = hostMessage(text, vocabulary);
    expect(message.messageType).toBe('projection.snapshot');
    if (message.messageType !== 'projection.snapshot') {
      throw new Error(`unexpected message ${message.messageType}`);
    }
    expect(message.requestId).toBe('reconnect-1');
    expect(message.projectionRole).toBe('player');
    expect(message.revisions).toEqual(ACTUAL_REVISIONS);
    expect(message.executableWorkflowCommandIds).toEqual([]);
    expect(message.projection['formId']).toBe('APP-001');
    expect(message.projection['bootState']).toBe('READY');
    expect(message.projection['buildVersion']).toBe('0.0.0');
    expect(Object.keys(message.projection).sort()).toEqual([
      'baselineCompatibility',
      'bootState',
      'buildVersion',
      'formId',
      'integrityStatus',
    ]);

    for (const forbidden of ['APP-005', 'APP-011', ...gmOnlyFields]) {
      expect(text).not.toContain(forbidden);
    }
    socket.terminate();
  });

  it('answers v2 reconnect with exactly one adjacent empty-capabilities and APP-001 pair', async () => {
    const socket = await app.injectWS('/state');
    currentRevisions = CLIENT_REVISIONS;
    revisionReads = 0;
    try {
      const response = receiveSettledFrames(socket, 2);
      socket.send(clientTextV2(reconnectV2(deviceId), vocabulary));
      const texts = await response;
      expect(texts).toHaveLength(2);
      const messages = texts.map((text) => hostMessageV2(text, vocabulary));
      expect(messages[0]).toEqual({
        executableWorkflowCommandIds: [],
        messageType: 'session.reconnect.capabilities',
        protocolVersion: 2,
        reconnectRequestId: 'reconnect-v2-1',
        revisions: CLIENT_REVISIONS,
      });
      expect(messages[1]).toEqual({
        messageType: 'projection.snapshot',
        presentation: {
          assignment: {
            correlationId: 'reconnect-v2-1',
            reason: 'RECONNECT',
          },
          base: {
            availableActionKeys: [
              'APP-001::CTA::001',
              'APP-001::CTA::002',
              'APP-001::CTA::003',
              'APP-001::CTA::004',
            ],
            formId: 'APP-001',
            formType: 'screen',
            roleFilteredPayload: app001Bootstrap,
            routeBindings: [],
            routeTemplate: '/',
          },
          layers: [],
        },
        projectionRole: null,
        protocolVersion: 2,
        revisions: CLIENT_REVISIONS,
      });
      expect(revisionReads).toBe(1);
      for (const forbidden of ['APP-005', 'APP-011', ...gmOnlyFields]) {
        expect(texts.join('\n')).not.toContain(forbidden);
      }
    } finally {
      currentRevisions = ACTUAL_REVISIONS;
      socket.terminate();
    }
  });

  it('navigates the full APP-001 to APP-002 to CHR-001 to APP-004 to APP-002 path', async () => {
    let socket = await app.injectWS('/state');
    currentRevisions = CLIENT_REVISIONS;
    revisionWrites.length = 0;
    try {
      let response = receiveFrames(socket, 2);
      socket.send(
        clientTextV2(reconnectV2(deviceId, { reconnectRequestId: 'nav-reconnect' }), vocabulary),
      );
      await response;

      const openPlayer = formAction('navigation-player', 'APP-001', 'APP-001::CTA::001', 0);
      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(openPlayer, vocabulary));
      const app002Text = (await response)[0] ?? '';
      const app002 = hostMessageV2(app002Text, vocabulary);
      expect(app002).toMatchObject({
        messageType: 'projection.snapshot',
        presentation: {
          assignment: { correlationId: 'navigation-player', reason: 'FORM_ACTION' },
          base: {
            availableActionKeys: ['APP-002::CTA::002', 'APP-002::CTA::007'],
            formId: 'APP-002',
            routeBindings: [],
            routeTemplate: '/player',
          },
          layers: [],
        },
        projectionRole: 'player',
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 1 },
      });
      if (app002.messageType !== 'projection.snapshot') throw new Error('missing APP-002 snapshot');
      const projectedContextId = app002.presentation.base.roleFilteredPayload['contextId'];
      if (typeof projectedContextId !== 'string') throw new Error('missing APP-002 contextId');
      expect(projectedContextId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(app002.presentation.base.roleFilteredPayload).toEqual({
        contextId: projectedContextId,
        deviceId,
        projectionRevision: 1,
        stateRevision: 0,
      });

      const createCharacter = formAction('navigation-character', 'APP-002', 'APP-002::CTA::007', 1);
      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(createCharacter, vocabulary));
      const chr001Text = (await response)[0] ?? '';
      const chr001 = hostMessageV2(chr001Text, vocabulary);
      if (chr001.messageType !== 'projection.snapshot') throw new Error('missing CHR-001 snapshot');
      const payload = chr001.presentation.base.roleFilteredPayload;
      expect(chr001).toMatchObject({
        presentation: {
          assignment: { correlationId: 'navigation-character', reason: 'FORM_ACTION' },
          base: {
            availableActionKeys: ['CHR-001::CTA::002'],
            formId: 'CHR-001',
            routeTemplate: '/player/characters/:localCharacterId/create/chr-001',
          },
        },
        projectionRole: 'player',
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 2 },
      });
      expect(Object.keys(payload).sort()).toEqual([
        'age',
        'anatomyProfile',
        'artAssetKeyOrLocalFile',
        'characterDraftId',
        'commandId',
        'description',
        'draftRevision',
        'massApprovalStatus',
        'massKg',
        'name',
        'wizardCheckpointId',
      ]);
      expect(payload).toMatchObject({
        age: null,
        anatomyProfile: 'STANDARD_HUMANOID',
        artAssetKeyOrLocalFile: null,
        commandId: null,
        description: null,
        draftRevision: 0,
        massApprovalStatus: 'PENDING_GM',
        massKg: null,
        name: null,
      });
      expect(chr001.presentation.base.routeBindings).toEqual([
        { parameterIndex: 0, source: 'executor-allocated', value: payload['characterDraftId'] },
      ]);
      expect(payload['wizardCheckpointId']).toMatch(/^opaque-wizard-/u);
      expect(payload['wizardCheckpointId']).not.toBe(payload['characterDraftId']);
      expect(revisionWrites).toEqual([
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
      ]);
      expect(database.prepare('SELECT count(*) AS count FROM local_character').get()).toEqual({
        count: 0,
      });

      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(createCharacter, vocabulary));
      expect((await response)[0]).toBe(chr001Text);
      expect(revisionWrites).toHaveLength(2);

      response = receiveFrames(socket, 1);
      socket.send(clientTextV2({ ...createCharacter, expectedProjectionRevision: 2 }, vocabulary));
      expect(hostMessageV2((await response)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'navigation.form-action.refusal',
        refusal: { code: 'IDEMPOTENCY_CONFLICT', detail: 'PAYLOAD_MISMATCH' },
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 2 },
      });
      expect(revisionWrites).toHaveLength(2);

      const scope = {
        characterDraftId: payload['characterDraftId'] as string,
        contextId: projectedContextId,
        sourceFormId: 'CHR-001',
        wizardCheckpointId: payload['wizardCheckpointId'] as string,
      } as const;
      const identityRequest = {
        draftUpdateId: 'identity-valid',
        expectedDraftRevision: 0,
        expectedRevisions: { ...CLIENT_REVISIONS, projectionRevision: 2 },
        messageType: 'character.identity-draft.replace',
        protocolVersion: 2,
        scope,
        values: {
          age: 24,
          artAssetKeyOrLocalFile: {
            kind: 'asset-key',
            assetKey: 'symbiosis_placeholder_free_female',
          },
          description: null,
          massKg: 70.1,
          name: '  Alice  ',
        },
      } as const satisfies IdentityDraftReplaceV2Message;
      response = receiveFrames(socket, 1);
      socket.send(
        clientTextV2(
          {
            ...identityRequest,
            draftUpdateId: 'identity-invalid',
            values: { ...identityRequest.values, name: '\u200B' },
          },
          vocabulary,
        ),
      );
      expect(hostMessageV2((await response)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'character.identity-draft.refusal',
        refusal: { code: 'INVALID_FIELD', error: { field: 'name', reason: 'NO_VISIBLE_GRAPHEME' } },
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 2 },
      });
      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(identityRequest, vocabulary));
      const identityText = (await response)[0] ?? '';
      const identityResult = hostMessageV2(identityText, vocabulary);
      expect(identityResult).toMatchObject({
        draftRevision: 1,
        messageType: 'character.identity-draft.result',
        presentation: {
          base: {
            availableActionKeys: ['CHR-001::CTA::002'],
            roleFilteredPayload: { age: 24, draftRevision: 1, massKg: 70.1, name: 'Alice' },
          },
        },
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 3 },
      });
      expect(revisionWrites).toHaveLength(3);

      socket.terminate();
      socket = await app.injectWS('/state');
      response = receiveFrames(socket, 2);
      socket.send(
        clientTextV2(
          reconnectV2(deviceId, { reconnectRequestId: 'identity-reconnect' }),
          vocabulary,
        ),
      );
      const reconnectFrames = await response;
      expect(hostMessageV2(reconnectFrames[1] ?? '', vocabulary)).toMatchObject({
        messageType: 'projection.snapshot',
        presentation: {
          base: { formId: 'CHR-001', roleFilteredPayload: { draftRevision: 1, name: 'Alice' } },
        },
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 3 },
      });
      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(identityRequest, vocabulary));
      expect((await response)[0]).toBe(identityText);
      expect(revisionWrites).toHaveLength(3);

      const cancelDraft = formAction('navigation-library', 'CHR-001', 'CHR-001::CTA::002', 3);
      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(cancelDraft, vocabulary));
      const app004Text = (await response)[0] ?? '';
      const app004 = hostMessageV2(app004Text, vocabulary);
      expect(app004).toMatchObject({
        messageType: 'projection.snapshot',
        presentation: {
          assignment: { correlationId: 'navigation-library', reason: 'FORM_ACTION' },
          base: {
            availableActionKeys: ['APP-004::CTA::001', 'APP-004::CTA::007'],
            formId: 'APP-004',
            routeBindings: [],
            routeTemplate: '/player/characters',
          },
          layers: [],
        },
        projectionRole: 'player',
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 4 },
      });
      if (app004.messageType !== 'projection.snapshot') throw new Error('missing APP-004 snapshot');
      expect(app004.presentation.base.roleFilteredPayload).toEqual({
        campaignAuthority: false,
        draftCharacterIds: [],
        finalCharacterIds: [],
        handoffIdOrNull: null,
        handoffReceiptIdOrNull: null,
        launchContext: 'PLAYER_MENU',
        localCharacterLibraryRevision: 0,
        localOwnerIdOrNull: null,
        projectionRevision: 4,
        returnContext: 'PLAYER_MENU',
        stateRevision: 0,
      });

      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(cancelDraft, vocabulary));
      expect((await response)[0]).toBe(app004Text);
      expect(revisionWrites).toHaveLength(4);

      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(createCharacter, vocabulary));
      expect((await response)[0]).toBe(chr001Text);

      const createAgain = formAction(
        'navigation-character-again',
        'APP-004',
        'APP-004::CTA::001',
        4,
      );
      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(createAgain, vocabulary));
      expect(hostMessageV2((await response)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'projection.snapshot',
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 5 },
      });
      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(cancelDraft, vocabulary));
      expect((await response)[0]).toBe(app004Text);
      const cancelAgain = formAction('navigation-library-again', 'CHR-001', 'CHR-001::CTA::002', 5);
      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(cancelAgain, vocabulary));
      expect(hostMessageV2((await response)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'projection.snapshot',
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 6 },
      });

      const returnToMenu = formAction('navigation-menu', 'APP-004', 'APP-004::CTA::007', 6);
      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(returnToMenu, vocabulary));
      const returned = hostMessageV2((await response)[0] ?? '', vocabulary);
      expect(returned).toMatchObject({
        messageType: 'projection.snapshot',
        presentation: {
          assignment: { correlationId: 'navigation-menu', reason: 'FORM_ACTION' },
          base: {
            availableActionKeys: ['APP-002::CTA::002', 'APP-002::CTA::007'],
            formId: 'APP-002',
            routeBindings: [],
            routeTemplate: '/player',
          },
        },
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 7 },
      });
      if (returned.messageType !== 'projection.snapshot') {
        throw new Error('missing returned APP-002 snapshot');
      }
      expect(returned.presentation.base.roleFilteredPayload).toEqual({
        contextId: projectedContextId,
        deviceId,
        projectionRevision: 7,
        stateRevision: 0,
      });
      expect(revisionWrites).toEqual(
        Array.from({ length: 7 }, () => ({
          actorVisibilityChanged: false,
          projectionChanged: true,
          stateChanged: false,
        })),
      );
    } finally {
      currentRevisions = ACTUAL_REVISIONS;
      socket.terminate();
    }
  });

  it('opens APP-004 from the menu and starts a fresh CHR-001 subflow', async () => {
    const socket = await app.injectWS('/state');
    currentRevisions = CLIENT_REVISIONS;
    revisionWrites.length = 0;
    try {
      let response = receiveFrames(socket, 2);
      socket.send(
        clientTextV2(
          reconnectV2(deviceId, { reconnectRequestId: 'library-direct-reconnect' }),
          vocabulary,
        ),
      );
      await response;

      response = receiveFrames(socket, 1);
      socket.send(
        clientTextV2(
          formAction('library-direct-player', 'APP-001', 'APP-001::CTA::001', 0),
          vocabulary,
        ),
      );
      const app002 = hostMessageV2((await response)[0] ?? '', vocabulary);
      if (app002.messageType !== 'projection.snapshot') throw new Error('missing APP-002 snapshot');
      const contextId = app002.presentation.base.roleFilteredPayload['contextId'];
      if (typeof contextId !== 'string') throw new Error('missing APP-002 contextId');

      response = receiveFrames(socket, 1);
      socket.send(
        clientTextV2(
          formAction('library-direct-open', 'APP-002', 'APP-002::CTA::002', 1),
          vocabulary,
        ),
      );
      const app004 = hostMessageV2((await response)[0] ?? '', vocabulary);
      expect(app004).toMatchObject({
        messageType: 'projection.snapshot',
        presentation: {
          base: {
            availableActionKeys: ['APP-004::CTA::001', 'APP-004::CTA::007'],
            formId: 'APP-004',
            routeBindings: [],
            routeTemplate: '/player/characters',
          },
        },
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 2 },
      });

      for (const [index, actionKey] of (
        [
          'APP-004::CTA::002',
          'APP-004::CTA::003',
          'APP-004::CTA::004',
          'APP-004::CTA::005',
          'APP-004::CTA::006',
          'APP-004::CTA::008',
        ] as const
      ).entries()) {
        response = receiveFrames(socket, 1);
        socket.send(
          clientTextV2(
            formAction(`library-omitted-${String(index)}`, 'APP-004', actionKey, 2),
            vocabulary,
          ),
        );
        const refusalText = (await response)[0] ?? '';
        expect(hostMessageV2(refusalText, vocabulary)).toMatchObject({
          messageType: 'navigation.form-action.refusal',
          refusal: { code: 'NAVIGATION_UNAVAILABLE' },
          revisions: { ...CLIENT_REVISIONS, projectionRevision: 2 },
        });
        expect(refusalText).not.toContain('characterDraftId');
      }
      expect(revisionWrites).toHaveLength(2);

      response = receiveFrames(socket, 1);
      socket.send(
        clientTextV2(
          formAction('library-direct-create', 'APP-004', 'APP-004::CTA::001', 2),
          vocabulary,
        ),
      );
      const chr001 = hostMessageV2((await response)[0] ?? '', vocabulary);
      expect(chr001).toMatchObject({
        messageType: 'projection.snapshot',
        presentation: {
          assignment: { correlationId: 'library-direct-create', reason: 'FORM_ACTION' },
          base: {
            availableActionKeys: ['CHR-001::CTA::002'],
            formId: 'CHR-001',
            routeTemplate: '/player/characters/:localCharacterId/create/chr-001',
          },
        },
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 3 },
      });
      if (chr001.messageType !== 'projection.snapshot') throw new Error('missing CHR-001 snapshot');
      const payload = chr001.presentation.base.roleFilteredPayload;
      expect(chr001.presentation.base.routeBindings).toEqual([
        { parameterIndex: 0, source: 'executor-allocated', value: payload['characterDraftId'] },
      ]);
      expect(payload['characterDraftId']).not.toBe(contextId);
      expect(payload['wizardCheckpointId']).not.toBe(payload['characterDraftId']);
      expect(revisionWrites).toHaveLength(3);
      response = receiveFrames(socket, 1);
      socket.send(
        clientTextV2(
          formAction('library-direct-cancel', 'CHR-001', 'CHR-001::CTA::002', 3),
          vocabulary,
        ),
      );
      await response;
    } finally {
      currentRevisions = ACTUAL_REVISIONS;
      socket.terminate();
    }
  });

  it('requires session.reconnect before replaying a navigation result on a new transport', async () => {
    const firstSocket = await app.injectWS('/state');
    currentRevisions = CLIENT_REVISIONS;
    revisionWrites.length = 0;
    const action = formAction('transport-replay-action', 'APP-001', 'APP-001::CTA::001', 0);
    let originalSnapshot: string;
    try {
      let response = receiveFrames(firstSocket, 2);
      firstSocket.send(
        clientTextV2(
          reconnectV2(deviceId, { reconnectRequestId: 'transport-first-reconnect' }),
          vocabulary,
        ),
      );
      await response;
      response = receiveFrames(firstSocket, 1);
      firstSocket.send(clientTextV2(action, vocabulary));
      originalSnapshot = (await response)[0] ?? '';
    } finally {
      firstSocket.terminate();
    }

    const replaySocket = await app.injectWS('/state');
    try {
      let response = receiveFrames(replaySocket, 1);
      replaySocket.send(clientTextV2(action, vocabulary));
      expect(hostMessageV2((await response)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'navigation.form-action.refusal',
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        presentationUnchanged: true,
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 1 },
      });

      response = receiveFrames(replaySocket, 2);
      replaySocket.send(
        clientTextV2(
          reconnectV2(deviceId, { reconnectRequestId: 'transport-second-reconnect' }),
          vocabulary,
        ),
      );
      await response;
      response = receiveFrames(replaySocket, 1);
      replaySocket.send(clientTextV2(action, vocabulary));
      expect((await response)[0]).toBe(originalSnapshot);
      response = receiveFrames(replaySocket, 1);
      replaySocket.send(
        clientTextV2(
          formAction('transport-replay-library', 'APP-002', 'APP-002::CTA::002', 1),
          vocabulary,
        ),
      );
      expect(hostMessageV2((await response)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'projection.snapshot',
        presentation: { base: { formId: 'APP-004' } },
      });
      expect(revisionWrites).toEqual([
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
      ]);
    } finally {
      currentRevisions = ACTUAL_REVISIONS;
      replaySocket.terminate();
    }
  });

  it('rejects a player-local context allocator that reuses the durable device identity', async () => {
    const socket = await app.injectWS('/state');
    currentRevisions = CLIENT_REVISIONS;
    revisionWrites.length = 0;
    contextIdOverride = deviceId;
    const errorCount = frameErrors.length;
    try {
      const response = receiveFrames(socket, 2);
      socket.send(
        clientTextV2(
          reconnectV2(deviceId, { reconnectRequestId: 'duplicate-context-reconnect' }),
          vocabulary,
        ),
      );
      await response;

      const closed = new Promise<number>((resolve) => {
        socket.once('close', (code: number) => resolve(code));
      });
      socket.send(
        clientTextV2(
          formAction('duplicate-context-action', 'APP-001', 'APP-001::CTA::001', 0),
          vocabulary,
        ),
      );

      await expect(closed).resolves.toBe(1011);
      expect(frameErrors.slice(errorCount).map(String)).toEqual([
        'Error: player-local context allocator reused the durable device ID',
      ]);
      expect(currentRevisions).toEqual(CLIENT_REVISIONS);
      expect(revisionWrites).toEqual([]);
    } finally {
      currentRevisions = ACTUAL_REVISIONS;
      socket.terminate();
    }
  });

  it.each([
    {
      expectedError: 'local character allocator returned',
      localCharacterId: '00000000-0000-0000-0000-000000000000',
      requestId: 'zero-local-id',
      wizardCheckpointId: 'unused-wizard',
    },
    {
      expectedError: 'expected a real opaque ID',
      localCharacterId: '20000000-0000-4000-8000-000000000001',
      requestId: 'blank-wizard-id',
      wizardCheckpointId: '   ',
    },
    {
      expectedError: 'expected a real opaque ID',
      localCharacterId: '20000000-0000-4000-8000-000000000002',
      requestId: 'none-wizard-id',
      wizardCheckpointId: 'NONE',
    },
    {
      expectedError: 'expected a real opaque ID',
      localCharacterId: '20000000-0000-4000-8000-000000000003',
      requestId: 'zero-wizard-id',
      wizardCheckpointId: '00000000-0000-0000-0000-000000000000',
    },
    {
      expectedError: 'reused the character draft ID',
      localCharacterId: '20000000-0000-4000-8000-000000000004',
      requestId: 'reused-wizard-id',
      wizardCheckpointId: '20000000-0000-4000-8000-000000000004',
    },
  ])(
    'rejects invalid pre-commit allocator output: $requestId',
    async ({ expectedError, localCharacterId, requestId, wizardCheckpointId }) => {
      const socket = await app.injectWS('/state');
      currentRevisions = CLIENT_REVISIONS;
      revisionWrites.length = 0;
      localCharacterIdOverride = localCharacterId;
      wizardCheckpointIdOverride = wizardCheckpointId;
      const errorCount = frameErrors.length;
      try {
        let response = receiveFrames(socket, 2);
        socket.send(
          clientTextV2(
            reconnectV2(deviceId, { reconnectRequestId: `${requestId}-reconnect` }),
            vocabulary,
          ),
        );
        await response;
        response = receiveFrames(socket, 1);
        socket.send(
          clientTextV2(
            formAction(`${requestId}-player`, 'APP-001', 'APP-001::CTA::001', 0),
            vocabulary,
          ),
        );
        await response;

        const closed = new Promise<number>((resolve) => {
          socket.once('close', (code: number) => resolve(code));
        });
        socket.send(
          clientTextV2(
            formAction(`${requestId}-character`, 'APP-002', 'APP-002::CTA::007', 1),
            vocabulary,
          ),
        );

        await expect(closed).resolves.toBe(1011);
        expect(String(frameErrors[errorCount])).toContain(expectedError);
        expect(currentRevisions).toEqual({ ...CLIENT_REVISIONS, projectionRevision: 1 });
        expect(revisionWrites).toEqual([
          { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
        ]);
        expect(database.prepare('SELECT count(*) AS count FROM local_character').get()).toEqual({
          count: 0,
        });
      } finally {
        currentRevisions = ACTUAL_REVISIONS;
        socket.terminate();
      }
    },
  );

  it('refuses APP-002 when the durable device identity disappears after reconnect', async () => {
    const socket = await app.injectWS('/state');
    currentRevisions = CLIENT_REVISIONS;
    revisionWrites.length = 0;
    const errorCount = frameErrors.length;
    try {
      let response = receiveFrames(socket, 2);
      socket.send(
        clientTextV2(
          reconnectV2(deviceId, { reconnectRequestId: 'missing-device-reconnect' }),
          vocabulary,
        ),
      );
      await response;
      resetDeviceIdentity(database, () => undefined);

      response = receiveFrames(socket, 1);
      socket.send(
        clientTextV2(
          formAction('missing-device-action', 'APP-001', 'APP-001::CTA::001', 0),
          vocabulary,
        ),
      );
      expect(hostMessageV2((await response)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'navigation.form-action.refusal',
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        presentationUnchanged: true,
        revisions: CLIENT_REVISIONS,
      });
      expect(currentRevisions).toEqual(CLIENT_REVISIONS);
      expect(revisionWrites).toEqual([]);
      expect(frameErrors.slice(errorCount).map(String)).toEqual([
        'Error: device identity is not initialized',
      ]);
    } finally {
      deviceId = bootstrapDeviceIdentity(database);
      currentRevisions = ACTUAL_REVISIONS;
      socket.terminate();
    }
  });

  it('does not replay a player-local snapshot after its durable device identity is reset', async () => {
    const socket = await app.injectWS('/state');
    currentRevisions = CLIENT_REVISIONS;
    revisionWrites.length = 0;
    const errorCount = frameErrors.length;
    try {
      let response = receiveFrames(socket, 2);
      socket.send(
        clientTextV2(
          reconnectV2(deviceId, { reconnectRequestId: 'replay-reset-reconnect' }),
          vocabulary,
        ),
      );
      await response;

      const action = formAction('replay-reset-action', 'APP-001', 'APP-001::CTA::001', 0);
      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(action, vocabulary));
      expect(hostMessageV2((await response)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'projection.snapshot',
        presentation: { base: { formId: 'APP-002' } },
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 1 },
      });
      resetDeviceIdentity(database, () => undefined);

      response = receiveFrames(socket, 1);
      socket.send(clientTextV2(action, vocabulary));
      expect(hostMessageV2((await response)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'navigation.form-action.refusal',
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        presentationUnchanged: true,
        revisions: { ...CLIENT_REVISIONS, projectionRevision: 1 },
      });
      expect(revisionWrites).toEqual([
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
      ]);
      expect(frameErrors.slice(errorCount).map(String)).toEqual([
        'Error: device identity is not initialized',
      ]);
    } finally {
      deviceId = bootstrapDeviceIdentity(database);
      currentRevisions = ACTUAL_REVISIONS;
      socket.terminate();
    }
  });

  it('refuses stale, unavailable, unknown, and foreign-form actions without advancing revisions', async () => {
    const socket = await app.injectWS('/state');
    currentRevisions = CLIENT_REVISIONS;
    revisionWrites.length = 0;
    try {
      let response = receiveFrames(socket, 2);
      socket.send(
        clientTextV2(
          reconnectV2(deviceId, { reconnectRequestId: 'refusal-reconnect' }),
          vocabulary,
        ),
      );
      await response;

      response = receiveFrames(socket, 1);
      socket.send(
        clientTextV2(formAction('stale-action', 'APP-001', 'APP-001::CTA::001', 1), vocabulary),
      );
      expect(hostMessageV2((await response)[0] ?? '', vocabulary)).toMatchObject({
        refusal: {
          actualProjectionRevision: 0,
          code: 'STALE_PROJECTION',
          expectedProjectionRevision: 1,
        },
        presentationUnchanged: true,
        revisions: CLIENT_REVISIONS,
      });

      response = receiveFrames(socket, 1);
      socket.send(
        clientTextV2(formAction('gm-action', 'APP-001', 'APP-001::CTA::002', 0), vocabulary),
      );
      const unavailableText = (await response)[0] ?? '';
      expect(hostMessageV2(unavailableText, vocabulary)).toMatchObject({
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        presentationUnchanged: true,
        revisions: CLIENT_REVISIONS,
      });
      expect(unavailableText).not.toContain('contextId');
      expect(unavailableText).not.toContain('characterDraftId');
      expect(unavailableText).not.toContain('APP-002');
      expect(unavailableText).not.toContain('CHR-001');

      for (const [requestId, actionKey] of [
        ['unknown-action', 'APP-001::CTA::999'],
        ['foreign-action', 'APP-002::CTA::007'],
      ] as const) {
        response = receiveFrames(socket, 1);
        socket.send(
          JSON.stringify({
            ...formAction(requestId, 'APP-001', 'APP-001::CTA::001', 0),
            actionKey,
          }),
        );
        expect(hostMessage((await response)[0] ?? '', vocabulary)).toMatchObject({
          messageType: 'protocol.refusal',
          refusal: { code: 'UNRECOGNIZED', path: '$.actionKey', value: actionKey },
        });
      }
      expect(currentRevisions).toEqual(CLIENT_REVISIONS);
      expect(revisionWrites).toEqual([]);
    } finally {
      currentRevisions = ACTUAL_REVISIONS;
      socket.terminate();
    }
  });

  it('refuses a different valid device locator without publishing a v2 pair', async () => {
    const socket = await app.injectWS('/state');
    revisionReads = 0;
    try {
      const response = receiveSettledFrames(socket, 1);
      const foreignDeviceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      socket.send(clientTextV2(reconnectV2(foreignDeviceId), vocabulary));
      const texts = await response;
      expect(texts).toHaveLength(1);
      expect(hostMessage(texts[0] ?? '', vocabulary)).toEqual({
        messageType: 'protocol.refusal',
        protocolVersion: 1,
        refusal: {
          code: 'UNRECOGNIZED',
          path: '$.deviceId',
          value: foreignDeviceId,
        },
        relatedCommandId: null,
      });
      expect(texts[0]).not.toContain(deviceId);
      expect(revisionReads).toBe(0);
    } finally {
      socket.terminate();
    }
  });

  it('returns a checked protocol refusal for malformed JSON', async () => {
    const socket = await app.injectWS('/state');
    const response = receiveFrames(socket, 1);
    socket.send('{');
    const [text] = await response;
    if (text === undefined) throw new Error('missing websocket response');
    const message = hostMessage(text, vocabulary);
    expect(message).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { code: 'MALFORMED_JSON', path: '$' },
      relatedCommandId: null,
    });
    socket.terminate();
  });

  it('does not let a client claim the GM projection or receive GM data', async () => {
    const socket = await app.injectWS('/state');
    const response = receiveFrames(socket, 1);
    socket.send(clientText(reconnect({ projectionRole: 'gm', requestId: 'gm-claim' }), vocabulary));
    const [text] = await response;
    if (text === undefined) throw new Error('missing websocket response');
    expect(hostMessage(text, vocabulary)).toEqual({
      messageType: 'protocol.refusal',
      protocolVersion: 1,
      refusal: { code: 'UNRECOGNIZED', path: '$.projectionRole', value: 'gm' },
      relatedCommandId: null,
    });
    for (const forbidden of gmOnlyFields) {
      expect(text).not.toContain(forbidden);
    }
    socket.terminate();
  });

  it('refuses each unknown unacknowledged command before the fresh snapshot', async () => {
    const socket = await app.injectWS('/state');
    const response = receiveFrames(socket, 2);
    socket.send(
      clientText(
        reconnect({ requestId: 'with-unknown-command', unacknowledgedCommandIds: ['unknown-1'] }),
        vocabulary,
      ),
    );
    const texts = await response;
    const messages = texts.map((text) => hostMessage(text, vocabulary));
    expect(messages[0]).toMatchObject({
      commandId: 'unknown-1',
      messageType: 'command.refusal',
      refusal: {
        code: 'UNRECOGNIZED',
        path: '$.unacknowledgedCommandIds[0]',
        value: 'unknown-1',
      },
      revisions: ACTUAL_REVISIONS,
    });
    expect(messages[1]).toMatchObject({
      messageType: 'projection.snapshot',
      requestId: 'with-unknown-command',
      revisions: ACTUAL_REVISIONS,
    });
    socket.terminate();
  });

  it('names an unimplemented host-read transition in a checked read refusal', async () => {
    const message = {
      commandKind: 'read-only-command',
      knownRevisions: CLIENT_REVISIONS,
      messageType: 'read.request',
      parameters: {},
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: 'read-1',
      role: 'player',
      transition: {
        from: 'CMP-012',
        kind: 'read-only-command',
        to: 'CMP-012',
        trigger: 'Открыть архив read-only',
      },
    } as const satisfies ClientToHostMessage;
    const socket = await app.injectWS('/state');
    const response = receiveFrames(socket, 1);
    socket.send(clientText(message, vocabulary));
    const [text] = await response;
    if (text === undefined) throw new Error('missing websocket response');
    expect(hostMessage(text, vocabulary)).toMatchObject({
      messageType: 'read.refusal',
      refusal: { code: 'UNRECOGNIZED', path: '$.transition', value: message.transition },
      requestId: 'read-1',
      revisions: ACTUAL_REVISIONS,
    });
    socket.terminate();
  });

  it.each([
    {
      message: {
        commandId: 'workflow-1',
        commandKind: 'workflow-command',
        expectedRevisions: CLIENT_REVISIONS,
        messageType: 'command.request',
        payload: {},
        protocolVersion: WIRE_PROTOCOL_VERSION,
        role: 'player',
        workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
      } as const satisfies ClientToHostMessage,
      path: '$.workflowCommandId',
      value: 'UI-CMD-CAMPAIGN-CREATE',
    },
    {
      message: {
        commandId: 'operation-1',
        commandKind: 'operation-command',
        expectedRevisions: CLIENT_REVISIONS,
        messageType: 'command.request',
        payload: {},
        protocolVersion: WIRE_PROTOCOL_VERSION,
        role: 'player',
        transition: {
          from: 'PLY-021',
          kind: 'operation-command',
          to: 'PLY-021',
          trigger: 'Взять допустимое количество',
        },
      } as const satisfies ClientToHostMessage,
      path: '$.transition',
      value: {
        from: 'PLY-021',
        kind: 'operation-command',
        to: 'PLY-021',
        trigger: 'Взять допустимое количество',
      },
    },
  ])('names the unimplemented command reference at $path', async ({ message, path, value }) => {
    const socket = await app.injectWS('/state');
    const response = receiveFrames(socket, 1);
    socket.send(clientText(message, vocabulary));
    const [text] = await response;
    if (text === undefined) throw new Error('missing websocket response');
    expect(hostMessage(text, vocabulary)).toMatchObject({
      commandId: message.commandId,
      lastLifecycleState: null,
      messageType: 'command.refusal',
      refusal: { code: 'UNRECOGNIZED', path, value },
      revisions: ACTUAL_REVISIONS,
    });
    socket.terminate();
  });

  it('replays a terminal command refusal and detects command ID conflicts', async () => {
    const message = {
      commandId: 'idempotent-refusal-1',
      commandKind: 'workflow-command',
      expectedRevisions: CLIENT_REVISIONS,
      messageType: 'command.request',
      payload: {},
      protocolVersion: WIRE_PROTOCOL_VERSION,
      role: 'player',
      workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
    } as const satisfies ClientToHostMessage;
    const socket = await app.injectWS('/state');

    let response = receiveFrames(socket, 1);
    socket.send(clientText(message, vocabulary));
    const [firstText] = await response;
    if (firstText === undefined) throw new Error('missing initial refusal');

    response = receiveFrames(socket, 1);
    socket.send(clientText(message, vocabulary));
    expect((await response)[0]).toBe(firstText);

    response = receiveFrames(socket, 1);
    socket.send(clientText({ ...message, payload: { changed: true } }, vocabulary));
    const conflictText = (await response)[0];
    if (conflictText === undefined) throw new Error('missing idempotency conflict');
    expect(hostMessage(conflictText, vocabulary)).toMatchObject({
      commandId: message.commandId,
      messageType: 'command.refusal',
      refusal: {
        code: 'IDEMPOTENCY_CONFLICT',
        commandId: message.commandId,
        detail: 'PAYLOAD_MISMATCH',
      },
    });
    socket.terminate();

    const reconnectSocket = await app.injectWS('/state');
    const reconnectResponse = receiveFrames(reconnectSocket, 2);
    reconnectSocket.send(
      clientText(reconnect({ unacknowledgedCommandIds: [message.commandId] }), vocabulary),
    );
    const [replayedText, snapshotText] = await reconnectResponse;
    expect(replayedText).toBe(firstText);
    if (snapshotText === undefined) throw new Error('missing reconnect snapshot');
    expect(hostMessage(snapshotText, vocabulary)).toMatchObject({
      messageType: 'projection.snapshot',
      requestId: 'reconnect-1',
      revisions: ACTUAL_REVISIONS,
    });
    reconnectSocket.terminate();
  });

  it('rejects binary application frames through the shared refusal contract', async () => {
    const socket = await app.injectWS('/state');
    const response = receiveFrames(socket, 1);
    socket.send(Buffer.from('{}', 'utf8'));
    const [text] = await response;
    if (text === undefined) throw new Error('missing websocket response');
    expect(hostMessage(text, vocabulary)).toEqual({
      messageType: 'protocol.refusal',
      protocolVersion: 1,
      refusal: {
        actualType: 'object',
        code: 'INVALID_SHAPE',
        expected: 'text application frame',
        path: '$',
      },
      relatedCommandId: null,
    });
    socket.terminate();
  });
});
