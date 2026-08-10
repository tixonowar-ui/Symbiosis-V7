import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RawData, WebSocket } from 'ws';

import { decodeClientMessage, encodeHostMessage, WIRE_PROTOCOL_VERSION } from '@shared/index.js';
import type {
  ClientToHostMessage,
  CommandRefusalMessage,
  HostToClientMessage,
  ProtocolVocabulary,
  RevisionVector,
} from '@shared/index.js';

import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { loadAppProjectionCatalog, projectAppForm } from './projections/app.js';
import type { AppProjectionCatalog } from './projections/app.js';

export interface HostServerConfig {
  readonly onFrameError: (error: unknown) => void;
  readonly projectRoot: string;
  readonly readRevisions: () => RevisionVector;
  readonly staticRoot: string;
}

export interface HostNetworkConfig {
  readonly interface: string;
  readonly port: number;
}

type CommandRequest = Extract<ClientToHostMessage, { readonly messageType: 'command.request' }>;
type CommandJournal = Map<
  string,
  { readonly refusal: CommandRefusalMessage; readonly request: CommandRequest }
>;

const STATIC_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function checkedRevisions(value: RevisionVector): RevisionVector {
  const keys = Object.keys(value);
  const expected = ['actorVisibilityRevision', 'projectionRevision', 'stateRevision'];
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`revision source must contain exactly: ${expected.join(', ')}`);
  }
  for (const key of expected) {
    const revision = value[key as keyof RevisionVector];
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error(
        `${key} is ${JSON.stringify(revision)}, expected a non-negative safe integer`,
      );
    }
  }
  if (value.actorVisibilityRevision > value.projectionRevision) {
    throw new Error('actorVisibilityRevision cannot exceed projectionRevision');
  }
  return { ...value };
}

function sendChecked(
  socket: WebSocket,
  message: HostToClientMessage,
  vocabulary: ProtocolVocabulary,
): void {
  const encoded = encodeHostMessage(message, vocabulary);
  if (!encoded.ok) {
    throw new Error(`host produced an invalid wire v1 message: ${JSON.stringify(encoded.refusal)}`);
  }
  socket.send(encoded.text);
}

function sendProtocolRefusal(
  socket: WebSocket,
  vocabulary: ProtocolVocabulary,
  refusal: Extract<HostToClientMessage, { readonly messageType: 'protocol.refusal' }>['refusal'],
): void {
  sendChecked(
    socket,
    {
      messageType: 'protocol.refusal',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      refusal,
      relatedCommandId: null,
    },
    vocabulary,
  );
}

function commandRefusal(
  commandId: string,
  refusal: CommandRefusalMessage['refusal'],
  revisions: RevisionVector,
): CommandRefusalMessage {
  return {
    commandId,
    lastLifecycleState: null,
    messageType: 'command.refusal',
    protocolVersion: WIRE_PROTOCOL_VERSION,
    refusal,
    revisions,
  };
}

function handleReconnect(
  socket: WebSocket,
  message: Extract<ClientToHostMessage, { readonly messageType: 'projection.reconnect' }>,
  catalog: AppProjectionCatalog,
  vocabulary: ProtocolVocabulary,
  readRevisions: HostServerConfig['readRevisions'],
  commandJournal: CommandJournal,
): void {
  if (message.projectionRole !== 'player') {
    sendProtocolRefusal(socket, vocabulary, {
      code: 'UNRECOGNIZED',
      path: '$.projectionRole',
      value: message.projectionRole,
    });
    return;
  }

  const revisions = checkedRevisions(readRevisions());
  for (const [index, commandId] of message.unacknowledgedCommandIds.entries()) {
    const known = commandJournal.get(commandId);
    if (known !== undefined) {
      sendChecked(socket, known.refusal, vocabulary);
      continue;
    }
    sendChecked(
      socket,
      commandRefusal(
        commandId,
        {
          code: 'UNRECOGNIZED',
          path: `$.unacknowledgedCommandIds[${String(index)}]`,
          value: commandId,
        },
        revisions,
      ),
      vocabulary,
    );
  }

  const projected = projectAppForm(catalog, 'player', 'APP-001');
  if (!projected.ok) throw new Error(`APP-001 refused: ${JSON.stringify(projected.refusal)}`);
  sendChecked(
    socket,
    {
      executableWorkflowCommandIds: [],
      messageType: 'projection.snapshot',
      projection: projected.projection,
      projectionRole: 'player',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: message.requestId,
      revisions,
    },
    vocabulary,
  );
}

function handleClientMessage(
  socket: WebSocket,
  message: ClientToHostMessage,
  catalog: AppProjectionCatalog,
  vocabulary: ProtocolVocabulary,
  readRevisions: HostServerConfig['readRevisions'],
  commandJournal: CommandJournal,
): void {
  switch (message.messageType) {
    case 'projection.reconnect':
      handleReconnect(socket, message, catalog, vocabulary, readRevisions, commandJournal);
      return;
    case 'command.request': {
      const known = commandJournal.get(message.commandId);
      if (known !== undefined) {
        if (isDeepStrictEqual(known.request, message))
          sendChecked(socket, known.refusal, vocabulary);
        else
          sendChecked(
            socket,
            commandRefusal(
              message.commandId,
              {
                code: 'IDEMPOTENCY_CONFLICT',
                commandId: message.commandId,
                detail: 'PAYLOAD_MISMATCH',
              },
              checkedRevisions(readRevisions()),
            ),
            vocabulary,
          );
        return;
      }
      const refusal = commandRefusal(
        message.commandId,
        message.commandKind === 'workflow-command'
          ? {
              code: 'UNRECOGNIZED',
              path: '$.workflowCommandId',
              value: message.workflowCommandId,
            }
          : {
              code: 'UNRECOGNIZED',
              path: '$.transition',
              value: { ...message.transition },
            },
        checkedRevisions(readRevisions()),
      );
      commandJournal.set(message.commandId, { refusal, request: message });
      sendChecked(socket, refusal, vocabulary);
      return;
    }
    case 'read.request':
      sendChecked(
        socket,
        {
          messageType: 'read.refusal',
          protocolVersion: WIRE_PROTOCOL_VERSION,
          refusal: {
            code: 'UNRECOGNIZED',
            path: '$.transition',
            value: { ...message.transition },
          },
          requestId: message.requestId,
          revisions: checkedRevisions(readRevisions()),
        },
        vocabulary,
      );
      return;
    case 'protocol.refusal':
      socket.close(1002, 'peer refused wire v1 frame');
      return;
  }
}

function handleFrame(
  socket: WebSocket,
  data: RawData,
  isBinary: boolean,
  catalog: AppProjectionCatalog,
  vocabulary: ProtocolVocabulary,
  readRevisions: HostServerConfig['readRevisions'],
  commandJournal: CommandJournal,
): void {
  if (isBinary) {
    sendProtocolRefusal(socket, vocabulary, {
      actualType: 'object',
      code: 'INVALID_SHAPE',
      expected: 'text application frame',
      path: '$',
    });
    return;
  }
  const decoded = decodeClientMessage(rawDataText(data), vocabulary);
  if (!decoded.ok) {
    sendProtocolRefusal(socket, vocabulary, decoded.refusal);
    return;
  }
  handleClientMessage(socket, decoded.value, catalog, vocabulary, readRevisions, commandJournal);
}

function rawDataText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  throw new TypeError('ws text frame has an unsupported RawData representation');
}

function notFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}

async function sendStaticFile(
  staticRoot: string,
  requestedPath: string,
  reply: FastifyReply,
): Promise<void> {
  if (requestedPath.includes('\\') || requestedPath.includes('\0')) {
    await reply.code(400).send({ error: 'invalid static path' });
    return;
  }
  const path = resolve(staticRoot, requestedPath);
  const fromRoot = relative(staticRoot, path);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    await reply.code(400).send({ error: 'static path escapes configured root' });
    return;
  }

  let realPath: string;
  try {
    realPath = await realpath(path);
  } catch (error: unknown) {
    if (!notFound(error)) throw error;
    await reply.code(404).send({ error: `static file ${JSON.stringify(requestedPath)} not found` });
    return;
  }
  const realFromRoot = relative(staticRoot, realPath);
  if (realFromRoot === '..' || realFromRoot.startsWith(`..${sep}`) || isAbsolute(realFromRoot)) {
    await reply.code(400).send({ error: 'static path resolves outside configured root' });
    return;
  }
  const metadata = await stat(realPath);
  if (!metadata.isFile()) {
    await reply
      .code(404)
      .send({ error: `static path ${JSON.stringify(requestedPath)} is not a file` });
    return;
  }
  const extension = extname(realPath).toLowerCase();
  const contentType = STATIC_CONTENT_TYPES[extension];
  if (contentType === undefined) {
    await reply
      .code(415)
      .send({ error: `static extension ${JSON.stringify(extension)} is unsupported` });
    return;
  }
  reply.type(contentType).send(await readFile(realPath));
}

export async function createHost(config: HostServerConfig): Promise<FastifyInstance> {
  if (typeof config.readRevisions !== 'function')
    throw new TypeError('host readRevisions configuration must be a function');
  if (typeof config.onFrameError !== 'function')
    throw new TypeError('host onFrameError configuration must be a function');
  const projectRoot = resolve(config.projectRoot);
  const staticRoot = await realpath(resolve(config.staticRoot));
  const [catalog, vocabulary] = await Promise.all([
    loadAppProjectionCatalog(projectRoot),
    loadProtocolVocabulary(projectRoot),
  ]);

  const app = Fastify({ logger: false });
  const commandJournal: CommandJournal = new Map();
  await app.register(websocket);

  app.get('/state', { websocket: true }, (socket) => {
    socket.on('message', (data: RawData, isBinary: boolean) => {
      try {
        handleFrame(
          socket,
          data,
          isBinary,
          catalog,
          vocabulary,
          config.readRevisions,
          commandJournal,
        );
      } catch (error: unknown) {
        config.onFrameError(error);
        socket.close(1011, 'host frame processing failed');
      }
    });
  });

  app.get('/health', async (_request, reply) => {
    await reply.code(204).send();
  });
  app.get('/', async (_request, reply) => {
    await sendStaticFile(staticRoot, 'index.html', reply);
  });
  app.get<{ Params: { '*': string } }>('/*', async (request, reply) => {
    await sendStaticFile(staticRoot, request.params['*'], reply);
  });
  return app;
}

export async function startHost(app: FastifyInstance, network: HostNetworkConfig): Promise<string> {
  if (typeof network.interface !== 'string' || network.interface.trim().length === 0) {
    throw new TypeError('host interface configuration must be a non-empty string');
  }
  if (!Number.isInteger(network.port) || network.port < 0 || network.port > 65_535) {
    throw new TypeError('host port configuration must be an integer from 0 through 65535');
  }
  return app.listen({ host: network.interface, port: network.port });
}
