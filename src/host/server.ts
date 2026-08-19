import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RawData, WebSocket } from 'ws';

import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';
import {
  decodeClientMessage,
  decodeClientMessageV2,
  decodeClientMessageV3,
  encodeHostMessage,
  encodeHostMessageV2,
  encodeHostMessageV3,
  WIRE_PROTOCOL_VERSION,
  WIRE_PROTOCOL_V2_VERSION,
  WIRE_PROTOCOL_V3_VERSION,
} from '@shared/index.js';
import type {
  ClientToHostMessage,
  ClientToHostV2Message,
  CommandRefusalMessage,
  CommandReceipt,
  CommandReplayMessage,
  CommandResultMessage,
  FormActionIntentV2Message,
  FormActionRefusalV2Message,
  HostToClientMessage,
  HostToClientV2Message,
  HostToClientV3Message,
  IdentityDraftRefusalV3Message,
  IdentityDraftReplaceV3Message,
  IdentityDraftResultV3Message,
  IdentityDraftScope,
  ProjectionSnapshotV2Message,
  ProtocolVocabulary,
  PresentedBaseForm,
  RevisionVector,
  WireV2Vocabulary,
  WireV3Vocabulary,
  WorkflowCommandId,
} from '@shared/index.js';

import { listLocalCharacters, loadDeviceId, readLocalCharacter } from '../persistence/index.js';
import type { RevisionImpact } from '../persistence/index.js';
import { createIdentityDraftRuntime } from './identity-draft.js';
import type { IdentityDraftRuntime } from './identity-draft.js';
import {
  commitCreationSetDecide,
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  CreationSetDecideApplicationError,
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  normalizeCreationSetDecideRequest,
} from './creation-set-decide.js';
import type {
  CreationSetDecideCommandRequest,
  DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  commitIdentityCheckpoint,
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  IdentityCheckpointApplicationError,
  normalizeIdentityCheckpointRequest,
  validateIdentityCheckpointRequest,
} from './identity-checkpoint.js';
import type {
  DurableIdentityCheckpoint,
  IdentityCheckpointCommandRequest,
} from './identity-checkpoint.js';
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
  CHR_001_CHECKPOINT_ACTION_KEYS,
  CHR_001_FORM_ID,
  CHR_001_INITIAL_ACTION_KEYS,
  CHR_001_ROUTE,
  CHR_002_FORM_ID,
  CHR_002_INITIAL_ACTION_KEYS,
  CHR_002_ROUTE,
  CHR_010_FORM_ID,
  CHR_010_INITIAL_ACTION_KEYS,
  CHR_010_ROUTE,
  CHR_016_FORM_ID,
  CHR_016_INITIAL_ACTION_KEYS,
  CHR_016_ROUTE,
  CHR_036_FORM_ID,
  CHR_036_INITIAL_ACTION_KEYS,
  CHR_036_ROUTE,
  projectChr001,
  projectInitialChr001,
  projectInitialChr002,
  projectInitialChr010,
  projectInitialChr016,
  projectInitialChr036,
} from './projections/chr.js';

export interface HostServerConfig {
  readonly advanceRevisions: (impact: RevisionImpact) => RevisionVector;
  readonly allocateContextId: () => string;
  readonly allocateLocalCharacterId: () => string;
  readonly allocateReceiptId: () => string;
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
type HostVocabulary = ProtocolVocabulary & WireV3Vocabulary;
type FormActionTerminal = FormActionRefusalV2Message | ProjectionSnapshotV2Message;
type CommandTerminal = CommandRefusalMessage | CommandResultMessage;
interface CommandJournalEntry {
  readonly durableCharacterId?: string;
  readonly request: CommandRequest;
  readonly terminal: CommandTerminal;
}
type CommandJournal = Map<string, CommandJournalEntry>;
interface ConfirmedNavigationContext {
  readonly contextId: string | null;
  readonly deviceId: string;
  readonly entityLocalCharacterId: string | null;
  readonly entityRevisions: RevisionVector | null;
  readonly formId:
    | 'APP-001'
    | 'APP-002'
    | 'APP-004'
    | typeof CHR_002_FORM_ID
    | typeof CHR_001_FORM_ID
    | typeof CHR_010_FORM_ID
    | typeof CHR_016_FORM_ID
    | typeof CHR_036_FORM_ID;
  readonly identityDraftScope: IdentityDraftScope | null;
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
  executableWorkflowCommandIds: ReadonlySet<WorkflowCommandId>;
  sessionEstablished: boolean;
}
interface LibraryRevisionRuntime {
  readonly commitIncrement: () => number;
  readonly preflightIncrement: () => void;
  readonly read: () => number;
}
interface NavigationDependencies {
  readonly advanceRevisions: HostServerConfig['advanceRevisions'];
  readonly allocateContextId: HostServerConfig['allocateContextId'];
  readonly allocateLocalCharacterId: HostServerConfig['allocateLocalCharacterId'];
  readonly allocateReceiptId: HostServerConfig['allocateReceiptId'];
  readonly allocateWizardCheckpointId: HostServerConfig['allocateWizardCheckpointId'];
  readonly catalog: AppProjectionCatalog;
  readonly database: HostServerConfig['database'];
  readonly journal: NavigationJournal;
  readonly identityDraft: IdentityDraftRuntime;
  readonly identitySessions: Map<string, ConfirmedNavigationContext>;
  readonly libraryRevision: LibraryRevisionRuntime;
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

function allocatedReceiptId(
  allocator: () => string,
  request: CreationSetDecideCommandRequest | IdentityCheckpointCommandRequest,
): string {
  const value: unknown = allocator();
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value === 'NONE' ||
    value === ZERO_UUID
  ) {
    throw new Error(
      `command receipt allocator returned ${JSON.stringify(value)}, expected a real opaque ID`,
    );
  }
  if (
    value === request.commandId ||
    value === request.payload.characterDraftId ||
    value === request.payload.wizardCheckpointId
  ) {
    throw new Error('command receipt allocator reused a command, character, or checkpoint ID');
  }
  return value;
}

function creationRequestMatchesCheckpoint(
  request: CreationSetDecideCommandRequest,
  checkpoint: DurableCreationWizardCheckpoint,
): boolean {
  const identity = checkpoint.identityStage.request.payload;
  return (
    request.payload.sourceFormId !== CHR_002_FORM_ID &&
    checkpoint.nextStageEnvelope.formId === request.payload.sourceFormId &&
    request.payload.characterDraftId === identity.characterDraftId &&
    request.payload.wizardCheckpointId === identity.wizardCheckpointId &&
    request.payload.draftRevision === checkpoint.receipt.result.draftRevision &&
    isDeepStrictEqual(request.expectedRevisions, checkpoint.receipt.revisions)
  );
}

function preflightCreationDecision(checkpoint: DurableCreationWizardCheckpoint): void {
  const revisions = checkpoint.receipt.revisions;
  if (
    checkpoint.receipt.result.draftRevision === Number.MAX_SAFE_INTEGER ||
    checkpoint.checkpoint.checkpointRevision === Number.MAX_SAFE_INTEGER ||
    revisions.projectionRevision === Number.MAX_SAFE_INTEGER ||
    revisions.stateRevision === Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError('creation decision revisions cannot advance past MAX_SAFE_INTEGER');
  }
}

function createLibraryRevisionRuntime(): LibraryRevisionRuntime {
  let revision = 0;
  const preflightIncrement = (): void => {
    if (revision === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('localCharacterLibraryRevision cannot advance past MAX_SAFE_INTEGER');
    }
  };
  return {
    commitIncrement: () => {
      preflightIncrement();
      revision += 1;
      return revision;
    },
    preflightIncrement,
    read: () => revision,
  };
}

function preflightProjectionAdvance(revisions: RevisionVector): void {
  if (revisions.projectionRevision === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('shell projectionRevision cannot advance past MAX_SAFE_INTEGER');
  }
}

function advanceProjection(
  before: RevisionVector,
  writer: HostServerConfig['advanceRevisions'],
): RevisionVector {
  preflightProjectionAdvance(before);
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
  reason: ProjectionSnapshotV2Message['presentation']['assignment']['reason'] = 'FORM_ACTION',
): ProjectionSnapshotV2Message {
  return {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: { correlationId, reason },
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
  const active = dependencies.identitySessions.get(current.deviceId)?.identityDraftScope;
  return (
    current.contextId !== null &&
    deviceIdentityMatches(dependencies, current.deviceId) &&
    (current.identityDraftScope === null || isDeepStrictEqual(active, current.identityDraftScope))
  );
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
    nextContext: {
      ...current,
      entityLocalCharacterId: null,
      entityRevisions: null,
      formId: 'APP-002',
      identityDraftScope: null,
    },
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
    libraryEntries: listLocalCharacters(dependencies.database),
    localCharacterLibraryRevision: dependencies.libraryRevision.read(),
    projectionRevision: after.projectionRevision,
    stateRevision: after.stateRevision,
  });
  if (!projected.ok) throw new Error(`APP-004 refused: ${JSON.stringify(projected.refusal)}`);
  return {
    nextContext: {
      ...current,
      entityLocalCharacterId: null,
      entityRevisions: null,
      formId: 'APP-004',
      identityDraftScope: null,
    },
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
  const identityDraftScope = {
    characterDraftId,
    contextId: current.contextId,
    sourceFormId: CHR_001_FORM_ID,
    wizardCheckpointId,
  } as const satisfies IdentityDraftScope;
  dependencies.identityDraft.registerScope(identityDraftScope);
  return {
    nextContext: {
      ...current,
      entityLocalCharacterId: null,
      entityRevisions: null,
      formId: CHR_001_FORM_ID,
      identityDraftScope,
    },
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

function currentNavigationRevisions(
  connection: ConnectionNavigation,
  dependencies: NavigationDependencies,
): RevisionVector {
  const current = connection.current;
  if (current === null || current.entityLocalCharacterId === null) {
    return checkedRevisions(dependencies.readRevisions());
  }
  const localCharacter = readLocalCharacter(dependencies.database, current.entityLocalCharacterId);
  return checkedRevisions({
    actorVisibilityRevision: localCharacter.actorVisibilityRevision,
    projectionRevision: localCharacter.projectionRevision,
    stateRevision: localCharacter.stateRevision,
  });
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

function sendCheckedV3(
  socket: WebSocket,
  message: HostToClientV3Message,
  vocabulary: WireV3Vocabulary,
): void {
  const encoded = encodeHostMessageV3(message, vocabulary);
  if (!encoded.ok) {
    throw new Error(`host produced an invalid wire v3 message: ${JSON.stringify(encoded.refusal)}`);
  }
  socket.send(encoded.text);
}

function adoptNavigationContext(
  connection: ConnectionNavigation,
  dependencies: NavigationDependencies,
  next: ConfirmedNavigationContext,
): void {
  if (
    next.identityDraftScope !== null &&
    dependencies.identityDraft.readScope(next.identityDraftScope) === null
  )
    return;
  const previous = connection.current?.identityDraftScope ?? null;
  const saved = dependencies.identitySessions.get(next.deviceId)?.identityDraftScope ?? null;
  if (next.identityDraftScope !== null) {
    if (saved !== null && !isDeepStrictEqual(saved, next.identityDraftScope))
      dependencies.identityDraft.unregisterScope(saved);
  } else if (previous !== null && isDeepStrictEqual(saved, previous)) {
    dependencies.identityDraft.unregisterScope(previous);
    dependencies.identitySessions.delete(next.deviceId);
  }
  connection.current = next;
  if (
    next.identityDraftScope !== null ||
    next.formId === CHR_010_FORM_ID ||
    next.formId === CHR_016_FORM_ID ||
    next.formId === CHR_036_FORM_ID ||
    next.formId === CHR_002_FORM_ID
  ) {
    dependencies.identitySessions.set(next.deviceId, next);
  }
}

function identityDraftBase(
  scope: IdentityDraftScope,
  draftRevision: number,
  values: Parameters<typeof projectChr001>[3],
  checkpointCapabilityAvailable: boolean,
): PresentedBaseForm {
  const checkpointEligible =
    checkpointCapabilityAvailable &&
    values.name !== null &&
    values.age !== null &&
    values.sex !== null &&
    values.massKg !== null;
  return {
    availableActionKeys: checkpointEligible
      ? CHR_001_CHECKPOINT_ACTION_KEYS
      : CHR_001_INITIAL_ACTION_KEYS,
    formId: CHR_001_FORM_ID,
    formType: 'screen',
    roleFilteredPayload: projectChr001(
      scope.characterDraftId,
      scope.wizardCheckpointId,
      draftRevision,
      values,
    ),
    routeBindings: [
      { parameterIndex: 0, source: 'executor-allocated', value: scope.characterDraftId },
    ],
    routeTemplate: CHR_001_ROUTE,
  };
}

function identityCheckpointBase(checkpoint: DurableIdentityCheckpoint): PresentedBaseForm {
  const { result } = checkpoint.receipt;
  return {
    availableActionKeys: CHR_010_INITIAL_ACTION_KEYS,
    formId: CHR_010_FORM_ID,
    formType: 'screen',
    roleFilteredPayload: projectInitialChr010(
      result.characterDraftId,
      result.checkpointId,
      result.draftRevision,
    ),
    routeBindings: [{ parameterIndex: 0, source: 'inherited', value: result.characterDraftId }],
    routeTemplate: CHR_010_ROUTE,
  };
}

function creationWizardBase(checkpoint: DurableCreationWizardCheckpoint): PresentedBaseForm {
  const { characterDraftId, wizardCheckpointId } = checkpoint.identityStage.request.payload;
  const draftRevision = checkpoint.receipt.result.draftRevision;
  const routeBindings = checkpoint.nextStageEnvelope.routeBindings;
  switch (checkpoint.nextStageEnvelope.formId) {
    case CHR_010_FORM_ID:
      return {
        availableActionKeys: CHR_010_INITIAL_ACTION_KEYS,
        formId: CHR_010_FORM_ID,
        formType: 'screen',
        roleFilteredPayload: projectInitialChr010(
          characterDraftId,
          wizardCheckpointId,
          draftRevision,
        ),
        routeBindings,
        routeTemplate: CHR_010_ROUTE,
      };
    case CHR_016_FORM_ID: {
      const raceChoice = checkpoint.raceAndMethodStage?.race?.value;
      if (raceChoice !== 'UNITED' && raceChoice !== 'FREE') {
        throw new Error(`durable CHR-016 destination has raceChoice ${JSON.stringify(raceChoice)}`);
      }
      return {
        availableActionKeys: CHR_016_INITIAL_ACTION_KEYS,
        formId: CHR_016_FORM_ID,
        formType: 'screen',
        roleFilteredPayload: projectInitialChr016(
          characterDraftId,
          wizardCheckpointId,
          draftRevision,
          raceChoice,
        ),
        routeBindings,
        routeTemplate: CHR_016_ROUTE,
      };
    }
    case CHR_036_FORM_ID:
      return {
        availableActionKeys: CHR_036_INITIAL_ACTION_KEYS,
        formId: CHR_036_FORM_ID,
        formType: 'screen',
        roleFilteredPayload: projectInitialChr036(
          characterDraftId,
          wizardCheckpointId,
          draftRevision,
        ),
        routeBindings,
        routeTemplate: CHR_036_ROUTE,
      };
    case CHR_002_FORM_ID:
      return {
        availableActionKeys: CHR_002_INITIAL_ACTION_KEYS,
        formId: CHR_002_FORM_ID,
        formType: 'screen',
        roleFilteredPayload: projectInitialChr002(
          characterDraftId,
          wizardCheckpointId,
          draftRevision,
        ),
        routeBindings,
        routeTemplate: CHR_002_ROUTE,
      };
    case 'CHR-003':
      throw new Error('CHR-003 destination is outside the implemented SET-DECIDE vertical');
  }
}

function handleIdentityDraftReplace(
  socket: WebSocket,
  message: IdentityDraftReplaceV3Message,
  connection: ConnectionNavigation,
  dependencies: NavigationDependencies,
): void {
  let revisions: RevisionVector | null = null;
  const currentRevisions = () => (revisions ??= checkedRevisions(dependencies.readRevisions()));
  const outcome = dependencies.identityDraft.apply(message, {
    advanceProjectionRevision: () =>
      advanceProjection(currentRevisions(), dependencies.advanceRevisions),
    capabilityAvailable: connection.executableWorkflowCommandIds.has(
      IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
    ),
    currentRevisions,
    currentScope: () => {
      const current = connection.sessionEstablished ? connection.current : null;
      if (current === null || current.identityDraftScope === null) return null;
      const saved = dependencies.identitySessions.get(current.deviceId)?.identityDraftScope;
      return isDeepStrictEqual(saved, current.identityDraftScope) &&
        deviceIdentityMatches(dependencies, current.deviceId)
        ? current.identityDraftScope
        : null;
    },
  });
  let terminal: IdentityDraftRefusalV3Message | IdentityDraftResultV3Message;
  if (outcome.kind === 'refused') {
    terminal = {
      draftUpdateId: outcome.draftUpdateId,
      messageType: 'character.identity-draft.refusal',
      presentationUnchanged: true,
      protocolVersion: WIRE_PROTOCOL_V3_VERSION,
      refusal: outcome.refusal,
      revisions: outcome.revisions,
      scope: outcome.scope,
    };
  } else {
    terminal = {
      draftRevision: outcome.draftRevision,
      draftUpdateId: outcome.draftUpdateId,
      messageType: 'character.identity-draft.result',
      presentation: {
        base: identityDraftBase(
          outcome.scope,
          outcome.draftRevision,
          outcome.values,
          outcome.checkpointEligible,
        ),
        layers: [],
      },
      projectionRole: 'player',
      protocolVersion: WIRE_PROTOCOL_V3_VERSION,
      revisions: outcome.revisions,
      scope: outcome.scope,
    };
  }
  sendCheckedV3(socket, terminal, dependencies.vocabulary);
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
      if (
        known.nextContext !== undefined &&
        isDeepStrictEqual(known.terminal.revisions, checkedRevisions(dependencies.readRevisions()))
      )
        adoptNavigationContext(connection, dependencies, known.nextContext);
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
    if (nextContext !== undefined) adoptNavigationContext(connection, dependencies, nextContext);
    sendCheckedV2(socket, terminal, dependencies.vocabulary);
  };
  const revisions = currentNavigationRevisions(connection, dependencies);
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
        {
          contextId,
          deviceId: current.deviceId,
          entityLocalCharacterId: null,
          entityRevisions: null,
          formId: 'APP-001',
          identityDraftScope: null,
        },
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

function commandResult(receipt: CommandReceipt): CommandResultMessage {
  return {
    lifecycleState: 'COMMITTED',
    messageType: 'command.result',
    protocolVersion: WIRE_PROTOCOL_VERSION,
    receipt,
  };
}

function commandReplay(receipt: CommandResultMessage['receipt']): CommandReplayMessage {
  return {
    lifecycleState: 'IDEMPOTENT_REPLAY',
    messageType: 'command.replay',
    protocolVersion: WIRE_PROTOCOL_VERSION,
    receipt,
  };
}

function normalizeJsonNegativeZero(value: unknown): unknown {
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map((item) => normalizeJsonNegativeZero(item));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeJsonNegativeZero(item)]),
    );
  }
  return value;
}

function commandRequestsMatch(saved: CommandRequest, incoming: CommandRequest): boolean {
  if (
    saved.commandKind === 'workflow-command' &&
    saved.workflowCommandId === IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID
  ) {
    try {
      return isDeepStrictEqual(
        normalizeIdentityCheckpointRequest(saved),
        normalizeIdentityCheckpointRequest(incoming),
      );
    } catch (error: unknown) {
      if (error instanceof IdentityCheckpointApplicationError) {
        return isDeepStrictEqual(
          normalizeJsonNegativeZero(saved),
          normalizeJsonNegativeZero(incoming),
        );
      }
      throw error;
    }
  }
  if (
    saved.commandKind === 'workflow-command' &&
    saved.workflowCommandId === CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID
  ) {
    try {
      return isDeepStrictEqual(
        normalizeCreationSetDecideRequest(saved),
        normalizeCreationSetDecideRequest(incoming),
      );
    } catch (error: unknown) {
      if (error instanceof CreationSetDecideApplicationError) {
        return isDeepStrictEqual(
          normalizeJsonNegativeZero(saved),
          normalizeJsonNegativeZero(incoming),
        );
      }
      throw error;
    }
  }
  return isDeepStrictEqual(saved, incoming);
}

function knownCommandById(
  commandId: string,
  commandJournal: CommandJournal,
  dependencies: NavigationDependencies,
): CommandJournalEntry | undefined {
  const inMemory = commandJournal.get(commandId);
  if (inMemory !== undefined) return inMemory;
  const durableCommand = loadCreationWizardCommandByCommandId(dependencies.database, commandId);
  if (durableCommand === null) return undefined;
  const entry = {
    durableCharacterId: durableCommand.durableCheckpoint.localCharacter.localCharacterId,
    request: durableCommand.request,
    terminal: commandResult(durableCommand.receipt),
  };
  commandJournal.set(commandId, entry);
  return entry;
}

function checkpointRequestMatchesDraft(
  request: IdentityCheckpointCommandRequest,
  scope: IdentityDraftScope,
  draft: NonNullable<ReturnType<IdentityDraftRuntime['readScope']>>,
): boolean {
  return isDeepStrictEqual(request.payload, {
    age: draft.values.age,
    artAssetKeyOrLocalFile: draft.values.artAssetKeyOrLocalFile,
    characterDraftId: scope.characterDraftId,
    description: draft.values.description,
    draftRevision: draft.draftRevision,
    massKg: draft.values.massKg,
    name: draft.values.name,
    sex: draft.values.sex,
    stage: 'IDENTITY',
    wizardCheckpointId: scope.wizardCheckpointId,
  });
}

function checkpointContext(
  connection: ConnectionNavigation,
  dependencies: NavigationDependencies,
  checkpoint: DurableIdentityCheckpoint,
): ConfirmedNavigationContext {
  return {
    contextId: connection.current?.contextId ?? null,
    deviceId: loadDeviceId(dependencies.database),
    entityLocalCharacterId: checkpoint.localCharacter.localCharacterId,
    entityRevisions: { ...checkpoint.receipt.revisions },
    formId: CHR_010_FORM_ID,
    identityDraftScope: null,
  };
}

function sendCheckpointDestination(
  socket: WebSocket,
  checkpoint: DurableIdentityCheckpoint,
  dependencies: NavigationDependencies,
  correlationId: string,
  reason: 'COMMAND_DESTINATION' | 'RECONNECT',
): void {
  sendCheckedV2(
    socket,
    projectionSnapshot(
      correlationId,
      identityCheckpointBase(checkpoint),
      'player',
      checkpoint.receipt.revisions,
      reason,
    ),
    dependencies.vocabulary,
  );
}

function creationWizardContext(
  connection: ConnectionNavigation,
  dependencies: NavigationDependencies,
  checkpoint: DurableCreationWizardCheckpoint,
): ConfirmedNavigationContext {
  const formId = checkpoint.nextStageEnvelope.formId;
  if (formId === 'CHR-003') {
    throw new Error('CHR-003 context is outside the implemented SET-DECIDE vertical');
  }
  const deviceId = loadDeviceId(dependencies.database);
  const contextId =
    connection.current?.contextId ??
    dependencies.identitySessions.get(deviceId)?.contextId ??
    allocatedId(dependencies.allocateContextId, 'player context', UUID_V4_PATTERN);
  return {
    contextId,
    deviceId,
    entityLocalCharacterId: checkpoint.localCharacter.localCharacterId,
    entityRevisions: { ...checkpoint.receipt.revisions },
    formId,
    identityDraftScope: null,
  };
}

function sendCreationWizardDestination(
  socket: WebSocket,
  checkpoint: DurableCreationWizardCheckpoint,
  dependencies: NavigationDependencies,
  correlationId: string,
  reason: 'COMMAND_DESTINATION' | 'RECONNECT',
): void {
  sendCheckedV2(
    socket,
    projectionSnapshot(
      correlationId,
      creationWizardBase(checkpoint),
      'player',
      checkpoint.receipt.revisions,
      reason,
    ),
    dependencies.vocabulary,
  );
}

function handleCommandRequest(
  socket: WebSocket,
  message: CommandRequest,
  connection: ConnectionNavigation,
  dependencies: NavigationDependencies,
  commandJournal: CommandJournal,
): void {
  const known = knownCommandById(message.commandId, commandJournal, dependencies);
  if (known !== undefined) {
    if (!commandRequestsMatch(known.request, message)) {
      sendChecked(
        socket,
        commandRefusal(
          message.commandId,
          {
            code: 'IDEMPOTENCY_CONFLICT',
            commandId: message.commandId,
            detail: 'PAYLOAD_MISMATCH',
          },
          currentNavigationRevisions(connection, dependencies),
        ),
        dependencies.vocabulary,
      );
      return;
    }
    if (known.terminal.messageType === 'command.refusal') {
      sendChecked(socket, known.terminal, dependencies.vocabulary);
      return;
    }
    if (known.durableCharacterId === undefined) {
      throw new Error('committed character command journal entry has no durable character');
    }
    const latestCheckpoint = loadCreationWizardCheckpoint(
      dependencies.database,
      known.durableCharacterId,
    );
    // The durable boundary destroys the CHR-001 authority before any transport
    // delivery. A failed terminal send must not leave a parallel old scope mutable.
    adoptNavigationContext(
      connection,
      dependencies,
      creationWizardContext(connection, dependencies, latestCheckpoint),
    );
    sendChecked(socket, commandReplay(known.terminal.receipt), dependencies.vocabulary);
    sendCreationWizardDestination(
      socket,
      latestCheckpoint,
      dependencies,
      message.commandId,
      'COMMAND_DESTINATION',
    );
    return;
  }

  const revisions = currentNavigationRevisions(connection, dependencies);
  const finishRefusal = (
    request: CommandRequest,
    refusal: CommandRefusalMessage['refusal'],
  ): void => {
    const terminal = commandRefusal(request.commandId, refusal, revisions);
    commandJournal.set(request.commandId, { request, terminal });
    sendChecked(socket, terminal, dependencies.vocabulary);
  };

  if (message.commandKind === 'operation-command') {
    finishRefusal(message, {
      code: 'UNRECOGNIZED',
      path: '$.transition',
      value: { ...message.transition },
    });
    return;
  }
  if (message.workflowCommandId === CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID) {
    let request: CreationSetDecideCommandRequest;
    try {
      request = normalizeCreationSetDecideRequest(message);
    } catch (error: unknown) {
      if (!(error instanceof CreationSetDecideApplicationError)) throw error;
      finishRefusal(message, error.refusal);
      return;
    }
    const current = connection.sessionEstablished ? connection.current : null;
    if (
      current === null ||
      current.identityDraftScope !== null ||
      current.entityLocalCharacterId !== request.payload.characterDraftId ||
      current.formId !== request.payload.sourceFormId ||
      !confirmedPlayerContext(current, dependencies) ||
      !connection.executableWorkflowCommandIds.has(CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID)
    ) {
      finishRefusal(request, { code: 'GUARD_REJECTED' });
      return;
    }
    if (!isDeepStrictEqual(request.expectedRevisions, revisions)) {
      finishRefusal(request, {
        actual: revisions,
        code: 'STALE_REVISION',
        expected: request.expectedRevisions,
      });
      return;
    }
    let durableCheckpoint = loadCreationWizardCheckpoint(
      dependencies.database,
      current.entityLocalCharacterId,
    );
    if (!creationRequestMatchesCheckpoint(request, durableCheckpoint)) {
      finishRefusal(request, { code: 'GUARD_REJECTED' });
      return;
    }
    try {
      preflightCreationDecision(durableCheckpoint);
    } catch (error: unknown) {
      if (!(error instanceof RangeError)) throw error;
      finishRefusal(request, { code: 'GUARD_REJECTED' });
      return;
    }
    const receiptId = allocatedReceiptId(dependencies.allocateReceiptId, request);

    const finalRevisions = currentNavigationRevisions(connection, dependencies);
    durableCheckpoint = loadCreationWizardCheckpoint(
      dependencies.database,
      current.entityLocalCharacterId,
    );
    if (
      !isDeepStrictEqual(finalRevisions, revisions) ||
      !confirmedPlayerContext(current, dependencies) ||
      !connection.executableWorkflowCommandIds.has(CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID) ||
      !creationRequestMatchesCheckpoint(request, durableCheckpoint)
    ) {
      finishRefusal(request, { code: 'GUARD_REJECTED' });
      return;
    }
    try {
      durableCheckpoint = commitCreationSetDecide(dependencies.database, request, receiptId);
    } catch (error: unknown) {
      if (!(error instanceof CreationSetDecideApplicationError)) throw error;
      finishRefusal(request, error.refusal);
      return;
    }
    const terminal = commandResult(durableCheckpoint.receipt);
    commandJournal.set(request.commandId, {
      durableCharacterId: durableCheckpoint.localCharacter.localCharacterId,
      request,
      terminal,
    });
    adoptNavigationContext(
      connection,
      dependencies,
      creationWizardContext(connection, dependencies, durableCheckpoint),
    );
    sendChecked(socket, terminal, dependencies.vocabulary);
    sendCreationWizardDestination(
      socket,
      durableCheckpoint,
      dependencies,
      request.commandId,
      'COMMAND_DESTINATION',
    );
    return;
  }
  let request: IdentityCheckpointCommandRequest;
  try {
    request = normalizeIdentityCheckpointRequest(message);
  } catch (error: unknown) {
    if (!(error instanceof IdentityCheckpointApplicationError)) throw error;
    finishRefusal(message, error.refusal);
    return;
  }

  const current = connection.sessionEstablished ? connection.current : null;
  const scope = current?.identityDraftScope ?? null;
  if (
    current === null ||
    scope === null ||
    current.formId !== CHR_001_FORM_ID ||
    !confirmedPlayerContext(current, dependencies) ||
    !connection.executableWorkflowCommandIds.has(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID)
  ) {
    finishRefusal(request, { code: 'GUARD_REJECTED' });
    return;
  }
  if (!isDeepStrictEqual(request.expectedRevisions, revisions)) {
    finishRefusal(request, {
      actual: revisions,
      code: 'STALE_REVISION',
      expected: request.expectedRevisions,
    });
    return;
  }
  try {
    request = validateIdentityCheckpointRequest(request);
  } catch (error: unknown) {
    if (!(error instanceof IdentityCheckpointApplicationError)) throw error;
    finishRefusal(request, error.refusal);
    return;
  }
  const draft = dependencies.identityDraft.readScope(scope);
  if (draft === null || !checkpointRequestMatchesDraft(request, scope, draft)) {
    finishRefusal(request, { code: 'GUARD_REJECTED' });
    return;
  }
  try {
    dependencies.libraryRevision.preflightIncrement();
    preflightProjectionAdvance(revisions);
  } catch (error: unknown) {
    if (!(error instanceof RangeError)) throw error;
    finishRefusal(request, { code: 'GUARD_REJECTED' });
    return;
  }
  const receiptId = allocatedReceiptId(dependencies.allocateReceiptId, request);

  const finalRevisions = currentNavigationRevisions(connection, dependencies);
  const finalDraft = dependencies.identityDraft.readScope(scope);
  if (
    !isDeepStrictEqual(finalRevisions, revisions) ||
    finalDraft === null ||
    !confirmedPlayerContext(current, dependencies) ||
    !connection.executableWorkflowCommandIds.has(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID) ||
    !checkpointRequestMatchesDraft(request, scope, finalDraft)
  ) {
    finishRefusal(request, { code: 'GUARD_REJECTED' });
    return;
  }

  const durableCheckpoint = commitIdentityCheckpoint(dependencies.database, request, receiptId);
  const terminal = commandResult(durableCheckpoint.receipt);
  commandJournal.set(request.commandId, {
    durableCharacterId: durableCheckpoint.localCharacter.localCharacterId,
    request,
    terminal,
  });
  // Durability ends the pre-commit scope even if a later runtime-axis update or
  // transport write fails. Recovery is then driven by the stored receipt.
  adoptNavigationContext(
    connection,
    dependencies,
    checkpointContext(connection, dependencies, durableCheckpoint),
  );
  dependencies.libraryRevision.commitIncrement();
  advanceProjection(revisions, dependencies.advanceRevisions);
  sendChecked(socket, terminal, dependencies.vocabulary);
  sendCheckpointDestination(
    socket,
    durableCheckpoint,
    dependencies,
    request.commandId,
    'COMMAND_DESTINATION',
  );
}

function replayUnacknowledgedCommands(
  socket: WebSocket,
  commandIds: readonly string[],
  revisions: RevisionVector,
  vocabulary: ProtocolVocabulary,
  commandJournal: CommandJournal,
  dependencies: NavigationDependencies,
): readonly DurableCreationWizardCheckpoint[] {
  const destinations: DurableCreationWizardCheckpoint[] = [];
  for (const [index, commandId] of commandIds.entries()) {
    const known = knownCommandById(commandId, commandJournal, dependencies);
    if (known !== undefined) {
      if (known.terminal.messageType === 'command.result') {
        sendChecked(socket, commandReplay(known.terminal.receipt), vocabulary);
        if (known.durableCharacterId !== undefined) {
          destinations.push(
            loadCreationWizardCheckpoint(dependencies.database, known.durableCharacterId),
          );
        }
      } else {
        sendChecked(socket, known.terminal, vocabulary);
      }
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
  return destinations;
}

function handleReconnect(
  socket: WebSocket,
  message: Extract<ClientToHostMessage, { readonly messageType: 'projection.reconnect' }>,
  dependencies: NavigationDependencies,
  commandJournal: CommandJournal,
): void {
  if (message.projectionRole !== 'player') {
    sendProtocolRefusal(socket, dependencies.vocabulary, {
      code: 'UNRECOGNIZED',
      path: '$.projectionRole',
      value: message.projectionRole,
    });
    return;
  }

  const revisions = checkedRevisions(dependencies.readRevisions());
  replayUnacknowledgedCommands(
    socket,
    message.unacknowledgedCommandIds,
    revisions,
    dependencies.vocabulary,
    commandJournal,
    dependencies,
  );

  const projected = projectAppForm(dependencies.catalog, 'player', 'APP-001');
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
    dependencies.vocabulary,
  );
}

function handleReconnectV2(
  socket: WebSocket,
  message: Extract<ClientToHostV2Message, { readonly messageType: 'session.reconnect' }>,
  dependencies: NavigationDependencies,
  commandJournal: CommandJournal,
  connection: ConnectionNavigation,
): void {
  const deviceId = loadDeviceId(dependencies.database);
  if (message.deviceId !== deviceId) {
    sendProtocolRefusal(socket, dependencies.vocabulary, {
      code: 'UNRECOGNIZED',
      path: '$.deviceId',
      value: message.deviceId,
    });
    return;
  }

  const shellRevisions = checkedRevisions(dependencies.readRevisions());
  const replayDestinations = replayUnacknowledgedCommands(
    socket,
    message.unacknowledgedCommandIds,
    shellRevisions,
    dependencies.vocabulary,
    commandJournal,
    dependencies,
  );
  const executableWorkflowCommandIds = [
    ...new Set(
      message.supportedWorkflowCommandIds.filter((commandId): commandId is WorkflowCommandId =>
        dependencies.vocabulary.isWorkflowCommandId(commandId),
      ),
    ),
  ];
  const executableSet = new Set(executableWorkflowCommandIds);
  const restored = dependencies.identitySessions.get(deviceId);
  let replayDestination: DurableCreationWizardCheckpoint | undefined;
  for (const destination of replayDestinations) {
    if (
      replayDestination !== undefined &&
      replayDestination.localCharacter.localCharacterId !==
        destination.localCharacter.localCharacterId
    ) {
      throw new Error('reconnect contains multiple durable character wizard destinations');
    }
    if (
      replayDestination === undefined ||
      destination.checkpoint.checkpointRevision > replayDestination.checkpoint.checkpointRevision
    ) {
      replayDestination = destination;
    }
  }
  let base: PresentedBaseForm;
  let nextContext: ConfirmedNavigationContext;
  let projectionRole: 'player' | null;
  let revisions: RevisionVector;
  if (replayDestination !== undefined) {
    base = creationWizardBase(replayDestination);
    nextContext = creationWizardContext(connection, dependencies, replayDestination);
    projectionRole = 'player';
    revisions = replayDestination.receipt.revisions;
  } else if (
    restored?.entityLocalCharacterId !== null &&
    restored?.entityLocalCharacterId !== undefined &&
    (restored.formId === CHR_010_FORM_ID ||
      restored.formId === CHR_016_FORM_ID ||
      restored.formId === CHR_036_FORM_ID ||
      restored.formId === CHR_002_FORM_ID)
  ) {
    const checkpoint = loadCreationWizardCheckpoint(
      dependencies.database,
      restored.entityLocalCharacterId,
    );
    base = creationWizardBase(checkpoint);
    nextContext = creationWizardContext(connection, dependencies, checkpoint);
    projectionRole = 'player';
    revisions = checkpoint.receipt.revisions;
  } else if (restored !== undefined && restored.identityDraftScope !== null) {
    const draft = dependencies.identityDraft.readScope(restored.identityDraftScope);
    if (draft === null) throw new Error('identity session points to an unavailable runtime draft');
    base = identityDraftBase(
      restored.identityDraftScope,
      draft.draftRevision,
      draft.values,
      executableSet.has(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID),
    );
    nextContext = restored;
    projectionRole = 'player';
    revisions = shellRevisions;
  } else {
    base = {
      availableActionKeys: APP_001_ACTION_KEYS,
      formId: 'APP-001',
      formType: 'screen',
      roleFilteredPayload: projectApp001Bootstrap(dependencies.catalog),
      routeBindings: [],
      routeTemplate: '/',
    };
    nextContext = {
      contextId: null,
      deviceId,
      entityLocalCharacterId: null,
      entityRevisions: null,
      formId: 'APP-001',
      identityDraftScope: null,
    };
    projectionRole = null;
    revisions = shellRevisions;
  }
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
      base,
      layers: [],
    },
    projectionRole,
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions,
  } as const satisfies HostToClientV2Message;

  sendCheckedV2(socket, capabilities, dependencies.vocabulary);
  sendCheckedV2(socket, snapshot, dependencies.vocabulary);
  adoptNavigationContext(connection, dependencies, nextContext);
  connection.executableWorkflowCommandIds = executableSet;
  connection.sessionEstablished = true;
}

function handleClientMessage(
  socket: WebSocket,
  message: ClientToHostMessage,
  dependencies: NavigationDependencies,
  commandJournal: CommandJournal,
  connection: ConnectionNavigation,
): void {
  switch (message.messageType) {
    case 'projection.reconnect':
      handleReconnect(socket, message, dependencies, commandJournal);
      return;
    case 'command.request':
      handleCommandRequest(socket, message, connection, dependencies, commandJournal);
      return;
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
          revisions: currentNavigationRevisions(connection, dependencies),
        },
        dependencies.vocabulary,
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
      handleReconnectV2(socket, message, dependencies, commandJournal, connection);
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

function handleClientMessageV3(
  socket: WebSocket,
  message: IdentityDraftReplaceV3Message,
  dependencies: NavigationDependencies,
  connection: ConnectionNavigation,
): void {
  handleIdentityDraftReplace(socket, message, connection, dependencies);
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
  if (messageProtocolVersion(source) === WIRE_PROTOCOL_V3_VERSION) {
    const decoded = decodeClientMessageV3(source, dependencies.vocabulary);
    if (!decoded.ok) {
      sendProtocolRefusal(socket, dependencies.vocabulary, decoded.refusal);
      return;
    }
    handleClientMessageV3(socket, decoded.value, dependencies, connection);
    return;
  }
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
  handleClientMessage(socket, decoded.value, dependencies, commandJournal, connection);
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
    allocateReceiptId: config.allocateReceiptId,
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
    allocateReceiptId: config.allocateReceiptId,
    allocateWizardCheckpointId: config.allocateWizardCheckpointId,
    catalog,
    database: config.database,
    identityDraft: createIdentityDraftRuntime(new Set(LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS)),
    identitySessions: new Map(),
    journal: new Map(),
    libraryRevision: createLibraryRevisionRuntime(),
    onFrameError: config.onFrameError,
    readRevisions: config.readRevisions,
    vocabulary,
  };
  await app.register(websocket);

  app.get('/state', { websocket: true }, (socket) => {
    const connection: ConnectionNavigation = {
      current: null,
      executableWorkflowCommandIds: new Set(),
      sessionEstablished: false,
    };
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
