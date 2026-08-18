import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RawData, WebSocket } from 'ws';

import {
  decodeClientMessage,
  decodeClientMessageV2,
  encodeHostMessage,
  encodeHostMessageV2,
  WIRE_PROTOCOL_VERSION,
  WIRE_PROTOCOL_V2_VERSION,
} from '@shared/index.js';
import type {
  ClientToHostMessage,
  ClientToHostV2Message,
  CommandRefusalMessage,
  FormActionIntentV2Message,
  FormActionRefusalV2Message,
  HostToClientMessage,
  HostToClientV2Message,
  ProjectionSnapshotV2Message,
  ProtocolVocabulary,
  PresentedBaseForm,
  RevisionVector,
  WireV2Vocabulary,
  WorkflowCommandId,
} from '@shared/index.js';

import { listLocalCharacters, loadDeviceId } from '../persistence/index.js';
import type { LocalCharacter, RevisionImpact } from '../persistence/index.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import {
  APP_001_ACTION_KEYS,
  APP_001_PLAYER_ACTION_KEY,
  APP_002_CREATE_CHARACTER_ACTION_KEY,
  APP_002_LOCAL_CHARACTERS_ACTION_KEY,
  APP_002_VERTICAL_ACTION_KEYS,
  APP_002_ROUTE,
  APP_004_CREATE_CHARACTER_ACTION_KEY,
  APP_004_RETURN_TO_PLAYER_MENU_ACTION_KEY,
  APP_004_ROUTE,
  APP_004_VERTICAL_ACTION_KEYS,
  loadAppProjectionCatalog,
  projectApp001Bootstrap,
  projectApp002,
  projectApp004,
  projectAppForm,
} from './projections/app.js';
import type { AppProjectionCatalog } from './projections/app.js';
import {
  CHR_001_CANCEL_ACTION_KEY,
  CHR_001_FORM_ID,
  CHR_001_INITIAL_ACTION_KEYS,
  CHR_001_ROUTE,
  projectInitialChr001,
} from './projections/chr.js';

export interface HostServerConfig {
  readonly advanceRevisions: (impact: RevisionImpact) => RevisionVector;
  readonly allocateContextId: () => string;
  readonly allocateLocalCharacterId: () => string;
  readonly allocateWizardCheckpointId: () => string;
  readonly database: Parameters<typeof loadDeviceId>[0];
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
type HostVocabulary = ProtocolVocabulary & WireV2Vocabulary;
type FormActionTerminal = FormActionRefusalV2Message | ProjectionSnapshotV2Message;
type CommandJournal = Map<
  string,
  { readonly refusal: CommandRefusalMessage; readonly request: CommandRequest }
>;
interface ConfirmedNavigationContext {
  readonly contextId: string | null;
  readonly deviceId: string;
  readonly formId: 'APP-001' | 'APP-002' | 'APP-004' | typeof CHR_001_FORM_ID;
}
type ConfirmedPlayerContext = ConfirmedNavigationContext & { readonly contextId: string };
type NavigationJournal = Map<
  string,
  {
    readonly nextContext: ConfirmedNavigationContext | undefined;
    readonly request: FormActionIntentV2Message;
    readonly terminal: FormActionTerminal;
  }
>;
interface ConnectionNavigation {
  current: ConfirmedNavigationContext | null;
  sessionEstablished: boolean;
}
interface NavigationDependencies {
  readonly advanceRevisions: HostServerConfig['advanceRevisions'];
  readonly allocateContextId: HostServerConfig['allocateContextId'];
  readonly allocateLocalCharacterId: HostServerConfig['allocateLocalCharacterId'];
  readonly allocateWizardCheckpointId: HostServerConfig['allocateWizardCheckpointId'];
  readonly catalog: AppProjectionCatalog;
  readonly database: HostServerConfig['database'];
  readonly journal: NavigationJournal;
  readonly libraryEntries: readonly LocalCharacter[];
  readonly onFrameError: HostServerConfig['onFrameError'];
  readonly readRevisions: HostServerConfig['readRevisions'];
  readonly vocabulary: HostVocabulary;
}
interface NavigationSuccess {
  readonly nextContext: ConfirmedNavigationContext;
  readonly snapshot: ProjectionSnapshotV2Message;
}

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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

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

function allocatedId(allocator: () => string, label: string, pattern = UUID_PATTERN): string {
  const value: unknown = allocator();
  if (typeof value !== 'string' || !pattern.test(value) || value === ZERO_UUID) {
    throw new Error(`${label} allocator returned ${JSON.stringify(value)}, expected a UUID`);
  }
  return value;
}

function allocatedWizardCheckpointId(allocator: () => string, characterDraftId: string): string {
  const value: unknown = allocator();
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value === 'NONE' ||
    value === ZERO_UUID
  ) {
    throw new Error(
      `wizard checkpoint allocator returned ${JSON.stringify(value)}, expected a real opaque ID`,
    );
  }
  if (value === characterDraftId) {
    throw new Error('wizard checkpoint allocator reused the character draft ID');
  }
  return value;
}

function advanceProjection(
  before: RevisionVector,
  writer: HostServerConfig['advanceRevisions'],
): RevisionVector {
  const after = checkedRevisions(
    writer({ actorVisibilityChanged: false, projectionChanged: true, stateChanged: false }),
  );
  if (
    after.stateRevision !== before.stateRevision ||
    after.projectionRevision !== before.projectionRevision + 1 ||
    after.actorVisibilityRevision !== before.actorVisibilityRevision
  ) {
    throw new Error(
      `projection-only revision writer returned ${JSON.stringify(after)} after ${JSON.stringify(before)}`,
    );
  }
  return after;
}

function projectionSnapshot(
  correlationId: string,
  base: PresentedBaseForm,
  projectionRole: 'player' | null,
  revisions: RevisionVector,
): ProjectionSnapshotV2Message {
  return {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: { correlationId, reason: 'FORM_ACTION' },
      base,
      layers: [],
    },
    projectionRole,
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions,
  };
}

function confirmedPlayerContext(
  current: ConfirmedNavigationContext,
  dependencies: NavigationDependencies,
): current is ConfirmedPlayerContext {
  return current.contextId !== null && deviceIdentityMatches(dependencies, current.deviceId);
}

function app002Navigation(
  message: FormActionIntentV2Message,
  current: ConfirmedPlayerContext,
  before: RevisionVector,
  dependencies: NavigationDependencies,
): NavigationSuccess {
  const after = advanceProjection(before, dependencies.advanceRevisions);
  const projected = projectApp002(dependencies.catalog, 'player', {
    contextId: current.contextId,
    deviceId: current.deviceId,
    projectionRevision: after.projectionRevision,
    stateRevision: after.stateRevision,
  });
  if (!projected.ok) throw new Error(`APP-002 refused: ${JSON.stringify(projected.refusal)}`);
  return {
    nextContext: { ...current, formId: 'APP-002' },
    snapshot: projectionSnapshot(
      message.navigationRequestId,
      {
        availableActionKeys: APP_002_VERTICAL_ACTION_KEYS,
        formId: 'APP-002',
        formType: 'screen',
        roleFilteredPayload: projected.projection,
        routeBindings: [],
        routeTemplate: APP_002_ROUTE,
      },
      'player',
      after,
    ),
  };
}

function app004Navigation(
  message: FormActionIntentV2Message,
  current: ConfirmedPlayerContext,
  before: RevisionVector,
  dependencies: NavigationDependencies,
): NavigationSuccess {
  const after = advanceProjection(before, dependencies.advanceRevisions);
  const projected = projectApp004(dependencies.catalog, 'player', {
    libraryEntries: dependencies.libraryEntries,
    localCharacterLibraryRevision: 0,
    projectionRevision: after.projectionRevision,
    stateRevision: after.stateRevision,
  });
  if (!projected.ok) throw new Error(`APP-004 refused: ${JSON.stringify(projected.refusal)}`);
  return {
    nextContext: { ...current, formId: 'APP-004' },
    snapshot: projectionSnapshot(
      message.navigationRequestId,
      {
        availableActionKeys: APP_004_VERTICAL_ACTION_KEYS,
        formId: 'APP-004',
        formType: 'screen',
        roleFilteredPayload: projected.projection,
        routeBindings: [],
        routeTemplate: APP_004_ROUTE,
      },
      'player',
      after,
    ),
  };
}

function chr001Navigation(
  message: FormActionIntentV2Message,
  current: ConfirmedPlayerContext,
  before: RevisionVector,
  dependencies: NavigationDependencies,
): NavigationSuccess {
  const characterDraftId = allocatedId(dependencies.allocateLocalCharacterId, 'local character');
  const wizardCheckpointId = allocatedWizardCheckpointId(
    dependencies.allocateWizardCheckpointId,
    characterDraftId,
  );
  const after = advanceProjection(before, dependencies.advanceRevisions);
  return {
    nextContext: { ...current, formId: CHR_001_FORM_ID },
    snapshot: projectionSnapshot(
      message.navigationRequestId,
      {
        availableActionKeys: CHR_001_INITIAL_ACTION_KEYS,
        formId: CHR_001_FORM_ID,
        formType: 'screen',
        roleFilteredPayload: projectInitialChr001(characterDraftId, wizardCheckpointId),
        routeBindings: [
          { parameterIndex: 0, source: 'executor-allocated', value: characterDraftId },
        ],
        routeTemplate: CHR_001_ROUTE,
      },
      'player',
      after,
    ),
  };
}

function formActionRefusal(
  message: FormActionIntentV2Message,
  refusal: FormActionRefusalV2Message['refusal'],
  revisions: RevisionVector,
): FormActionRefusalV2Message {
  return {
    messageType: 'navigation.form-action.refusal',
    navigationRequestId: message.navigationRequestId,
    presentationUnchanged: true,
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    refusal,
    revisions,
  };
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

function sendCheckedV2(
  socket: WebSocket,
  message: HostToClientV2Message,
  vocabulary: WireV2Vocabulary,
): void {
  const encoded = encodeHostMessageV2(message, vocabulary);
  if (!encoded.ok) {
    throw new Error(`host produced an invalid wire v2 message: ${JSON.stringify(encoded.refusal)}`);
  }
  socket.send(encoded.text);
}

function handleFormAction(
  socket: WebSocket,
  message: FormActionIntentV2Message,
  connection: ConnectionNavigation,
  dependencies: NavigationDependencies,
): void {
  const known = dependencies.journal.get(message.navigationRequestId);
  if (known !== undefined) {
    if (isDeepStrictEqual(known.request, message)) {
      if (!connection.sessionEstablished) {
        sendCheckedV2(
          socket,
          formActionRefusal(
            message,
            { code: 'NAVIGATION_UNAVAILABLE' },
            checkedRevisions(dependencies.readRevisions()),
          ),
          dependencies.vocabulary,
        );
        return;
      }
      if (
        known.nextContext !== undefined &&
        !deviceIdentityMatches(dependencies, known.nextContext.deviceId)
      ) {
        sendCheckedV2(
          socket,
          formActionRefusal(
            message,
            { code: 'NAVIGATION_UNAVAILABLE' },
            checkedRevisions(dependencies.readRevisions()),
          ),
          dependencies.vocabulary,
        );
        return;
      }
      if (known.nextContext !== undefined) connection.current = known.nextContext;
      sendCheckedV2(socket, known.terminal, dependencies.vocabulary);
    } else {
      const revisions = checkedRevisions(dependencies.readRevisions());
      sendCheckedV2(
        socket,
        formActionRefusal(
          message,
          { code: 'IDEMPOTENCY_CONFLICT', detail: 'PAYLOAD_MISMATCH' },
          revisions,
        ),
        dependencies.vocabulary,
      );
    }
    return;
  }

  const finish = (terminal: FormActionTerminal, nextContext?: ConfirmedNavigationContext): void => {
    dependencies.journal.set(message.navigationRequestId, {
      nextContext,
      request: message,
      terminal,
    });
    if (nextContext !== undefined) connection.current = nextContext;
    sendCheckedV2(socket, terminal, dependencies.vocabulary);
  };
  const revisions = checkedRevisions(dependencies.readRevisions());
  if (message.expectedProjectionRevision !== revisions.projectionRevision) {
    finish(
      formActionRefusal(
        message,
        {
          actualProjectionRevision: revisions.projectionRevision,
          code: 'STALE_PROJECTION',
          expectedProjectionRevision: message.expectedProjectionRevision,
        },
        revisions,
      ),
    );
    return;
  }

  const current = connection.current;
  const action = dependencies.catalog.actions.get(message.actionKey);
  if (
    current === null ||
    current.formId !== message.sourceFormId ||
    action?.from !== message.sourceFormId
  ) {
    finish(formActionRefusal(message, { code: 'NAVIGATION_UNAVAILABLE' }, revisions));
    return;
  }
  let success: NavigationSuccess | undefined;
  switch (message.actionKey) {
    case APP_001_PLAYER_ACTION_KEY: {
      if (
        action.to !== 'APP-002' ||
        current.formId !== 'APP-001' ||
        dependencies.catalog.app001.bootState !== 'READY' ||
        !deviceIdentityMatches(dependencies, current.deviceId)
      ) {
        break;
      }
      const contextId = allocatedId(
        dependencies.allocateContextId,
        'player-local context',
        UUID_V4_PATTERN,
      );
      if (contextId === current.deviceId) {
        throw new Error('player-local context allocator reused the durable device ID');
      }
      success = app002Navigation(
        message,
        { contextId, deviceId: current.deviceId, formId: 'APP-001' },
        revisions,
        dependencies,
      );
      break;
    }
    case APP_002_LOCAL_CHARACTERS_ACTION_KEY:
      if (
        action.to === 'APP-004' &&
        current.formId === 'APP-002' &&
        confirmedPlayerContext(current, dependencies)
      ) {
        success = app004Navigation(message, current, revisions, dependencies);
      }
      break;
    case APP_002_CREATE_CHARACTER_ACTION_KEY:
      if (
        action.to === CHR_001_FORM_ID &&
        current.formId === 'APP-002' &&
        confirmedPlayerContext(current, dependencies)
      ) {
        success = chr001Navigation(message, current, revisions, dependencies);
      }
      break;
    case CHR_001_CANCEL_ACTION_KEY:
      if (
        action.to === 'APP-004' &&
        current.formId === CHR_001_FORM_ID &&
        confirmedPlayerContext(current, dependencies)
      ) {
        success = app004Navigation(message, current, revisions, dependencies);
      }
      break;
    case APP_004_CREATE_CHARACTER_ACTION_KEY:
      if (
        action.to === CHR_001_FORM_ID &&
        current.formId === 'APP-004' &&
        confirmedPlayerContext(current, dependencies)
      ) {
        success = chr001Navigation(message, current, revisions, dependencies);
      }
      break;
    case APP_004_RETURN_TO_PLAYER_MENU_ACTION_KEY:
      if (
        action.to === 'APP-002' &&
        current.formId === 'APP-004' &&
        confirmedPlayerContext(current, dependencies)
      ) {
        success = app002Navigation(message, current, revisions, dependencies);
      }
      break;
    default:
      break;
  }
  if (success !== undefined) {
    finish(success.snapshot, success.nextContext);
    return;
  }
  finish(formActionRefusal(message, { code: 'NAVIGATION_UNAVAILABLE' }, revisions));
}

function deviceIdentityMatches(
  dependencies: NavigationDependencies,
  expectedDeviceId: string,
): boolean {
  try {
    const actualDeviceId = loadDeviceId(dependencies.database);
    if (actualDeviceId === expectedDeviceId) return true;
    dependencies.onFrameError(
      new Error('durable device identity no longer matches the confirmed navigation context'),
    );
    return false;
  } catch (error: unknown) {
    dependencies.onFrameError(error);
    return false;
  }
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

function replayUnacknowledgedCommands(
  socket: WebSocket,
  commandIds: readonly string[],
  revisions: RevisionVector,
  vocabulary: ProtocolVocabulary,
  commandJournal: CommandJournal,
): void {
  for (const [index, commandId] of commandIds.entries()) {
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
  replayUnacknowledgedCommands(
    socket,
    message.unacknowledgedCommandIds,
    revisions,
    vocabulary,
    commandJournal,
  );

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

function handleReconnectV2(
  socket: WebSocket,
  message: Extract<ClientToHostV2Message, { readonly messageType: 'session.reconnect' }>,
  catalog: AppProjectionCatalog,
  vocabulary: HostVocabulary,
  database: HostServerConfig['database'],
  readRevisions: HostServerConfig['readRevisions'],
  commandJournal: CommandJournal,
  connection: ConnectionNavigation,
): void {
  const deviceId = loadDeviceId(database);
  if (message.deviceId !== deviceId) {
    sendProtocolRefusal(socket, vocabulary, {
      code: 'UNRECOGNIZED',
      path: '$.deviceId',
      value: message.deviceId,
    });
    return;
  }

  const revisions = checkedRevisions(readRevisions());
  replayUnacknowledgedCommands(
    socket,
    message.unacknowledgedCommandIds,
    revisions,
    vocabulary,
    commandJournal,
  );
  const executableWorkflowCommandIds = [
    ...new Set(
      message.supportedWorkflowCommandIds.filter((commandId): commandId is WorkflowCommandId =>
        vocabulary.isWorkflowCommandId(commandId),
      ),
    ),
  ];
  const capabilities = {
    executableWorkflowCommandIds,
    messageType: 'session.reconnect.capabilities',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    reconnectRequestId: message.reconnectRequestId,
    revisions,
  } as const satisfies HostToClientV2Message;
  const snapshot = {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: {
        correlationId: message.reconnectRequestId,
        reason: 'RECONNECT',
      },
      base: {
        availableActionKeys: APP_001_ACTION_KEYS,
        formId: 'APP-001',
        formType: 'screen',
        roleFilteredPayload: projectApp001Bootstrap(catalog),
        routeBindings: [],
        routeTemplate: '/',
      },
      layers: [],
    },
    projectionRole: null,
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions,
  } as const satisfies HostToClientV2Message;

  sendCheckedV2(socket, capabilities, vocabulary);
  sendCheckedV2(socket, snapshot, vocabulary);
  connection.current = { contextId: null, deviceId, formId: 'APP-001' };
  connection.sessionEstablished = true;
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

function handleClientMessageV2(
  socket: WebSocket,
  message: ClientToHostV2Message,
  dependencies: NavigationDependencies,
  commandJournal: CommandJournal,
  connection: ConnectionNavigation,
): void {
  switch (message.messageType) {
    case 'session.reconnect':
      handleReconnectV2(
        socket,
        message,
        dependencies.catalog,
        dependencies.vocabulary,
        dependencies.database,
        dependencies.readRevisions,
        commandJournal,
        connection,
      );
      return;
    case 'navigation.form-action':
      handleFormAction(socket, message, connection, dependencies);
      return;
    case 'navigation.addressable-route':
      throw new Error(
        `wire v2 ${message.messageType} is unavailable in the implemented navigation slice`,
      );
  }
}

function messageProtocolVersion(source: string): unknown {
  try {
    const parsed: unknown = JSON.parse(source);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return (parsed as Readonly<Record<string, unknown>>)['protocolVersion'];
    }
  } catch {
    // The v1 codec below owns the canonical malformed-JSON diagnostic.
  }
  return undefined;
}

function handleFrame(
  socket: WebSocket,
  data: RawData,
  isBinary: boolean,
  dependencies: NavigationDependencies,
  commandJournal: CommandJournal,
  connection: ConnectionNavigation,
): void {
  if (isBinary) {
    sendProtocolRefusal(socket, dependencies.vocabulary, {
      actualType: 'object',
      code: 'INVALID_SHAPE',
      expected: 'text application frame',
      path: '$',
    });
    return;
  }
  const source = rawDataText(data);
  if (messageProtocolVersion(source) === WIRE_PROTOCOL_V2_VERSION) {
    const decoded = decodeClientMessageV2(source, dependencies.vocabulary);
    if (!decoded.ok) {
      sendProtocolRefusal(socket, dependencies.vocabulary, decoded.refusal);
      return;
    }
    handleClientMessageV2(socket, decoded.value, dependencies, commandJournal, connection);
    return;
  }
  const decoded = decodeClientMessage(source, dependencies.vocabulary);
  if (!decoded.ok) {
    sendProtocolRefusal(socket, dependencies.vocabulary, decoded.refusal);
    return;
  }
  handleClientMessage(
    socket,
    decoded.value,
    dependencies.catalog,
    dependencies.vocabulary,
    dependencies.readRevisions,
    commandJournal,
  );
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

function errorDiagnostic(error: unknown): string {
  if (error instanceof Error) return error.message;
  const encoded = JSON.stringify(error);
  return encoded === undefined ? String(error) : encoded;
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
  for (const [name, value] of Object.entries({
    advanceRevisions: config.advanceRevisions,
    allocateContextId: config.allocateContextId,
    allocateLocalCharacterId: config.allocateLocalCharacterId,
    allocateWizardCheckpointId: config.allocateWizardCheckpointId,
    readRevisions: config.readRevisions,
  })) {
    if (typeof value !== 'function')
      throw new TypeError(`host ${name} configuration must be a function`);
  }
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
  const dependencies: NavigationDependencies = {
    advanceRevisions: config.advanceRevisions,
    allocateContextId: config.allocateContextId,
    allocateLocalCharacterId: config.allocateLocalCharacterId,
    allocateWizardCheckpointId: config.allocateWizardCheckpointId,
    catalog,
    database: config.database,
    journal: new Map(),
    libraryEntries: listLocalCharacters(config.database),
    onFrameError: config.onFrameError,
    readRevisions: config.readRevisions,
    vocabulary,
  };
  await app.register(websocket);

  app.get('/state', { websocket: true }, (socket) => {
    const connection: ConnectionNavigation = { current: null, sessionEstablished: false };
    socket.on('message', (data: RawData, isBinary: boolean) => {
      try {
        handleFrame(socket, data, isBinary, dependencies, commandJournal, connection);
      } catch (error: unknown) {
        config.onFrameError(error);
        socket.close(1011, 'host frame processing failed');
      }
    });
  });

  app.get('/health', async (_request, reply) => {
    await reply.code(204).send();
  });
  app.get('/device-identity', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    let deviceId: ReturnType<typeof loadDeviceId>;
    try {
      deviceId = loadDeviceId(config.database);
    } catch (error: unknown) {
      await reply.code(503).send({
        error: `device identity unavailable: ${errorDiagnostic(error)}`,
      });
      return;
    }
    await reply.send({ deviceId });
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
