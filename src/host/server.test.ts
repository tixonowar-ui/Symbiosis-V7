import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawData, WebSocket } from 'ws';

import { decodeHostMessage, encodeClientMessage, WIRE_PROTOCOL_VERSION } from '@shared/index.js';
import type {
  ClientToHostMessage,
  HostToClientMessage,
  ProjectionReconnectMessage,
  ProtocolVocabulary,
  RevisionVector,
} from '@shared/index.js';

import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { loadAppProjectionCatalog } from './projections/app.js';
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

function clientText(message: ClientToHostMessage, vocabulary: ProtocolVocabulary): string {
  const encoded = encodeClientMessage(message, vocabulary);
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

describe('configured Fastify and ws host shell', () => {
  let app: FastifyInstance;
  let currentRevisions: RevisionVector = ACTUAL_REVISIONS;
  const frameErrors: unknown[] = [];
  let gmOnlyFields: readonly string[];
  let staticRoot: string;
  let vocabulary: ProtocolVocabulary;

  beforeAll(async () => {
    staticRoot = await mkdtemp(join(tmpdir(), 'symbiosis-host-static-'));
    await Promise.all([
      writeFile(join(staticRoot, 'index.html'), '<main data-form="APP-001">shell</main>', 'utf8'),
      writeFile(join(staticRoot, 'app.js'), 'globalThis.symbiosis = true;', 'utf8'),
    ]);
    vocabulary = await loadProtocolVocabulary(PROJECT_ROOT);
    const catalog = await loadAppProjectionCatalog(PROJECT_ROOT);
    gmOnlyFields = (['APP-005', 'APP-011'] as const).flatMap((formId) => {
      const form = catalog.forms.get(formId);
      if (form === undefined) throw new Error(`missing APP contract ${formId}`);
      return form.requiredFields.map((field) => field.replace(/(?:\[\]|=.*)$/u, ''));
    });
    app = await createHost({
      onFrameError: (error) => frameErrors.push(error),
      projectRoot: PROJECT_ROOT,
      readRevisions: () => currentRevisions,
      staticRoot,
    });
    await startHost(app, { interface: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await app.close();
    await rm(staticRoot, { force: true, recursive: true });
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
