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
  JsonObject,
  ProjectionSnapshotV2Message,
  ProtocolVocabulary,
  PresentedBaseForm,
  PresentedLayerForm,
  RevisionVector,
  WireV2Vocabulary,
  WireV3Vocabulary,
  WorkflowCommandId,
} from '@shared/index.js';

import { listLocalCharacters, loadDeviceId, readLocalCharacter } from '../persistence/index.js';
import type { RevisionImpact } from '../persistence/index.js';
import { createIdentityDraftRuntime } from './identity-draft.js';
import type { IdentityDraftRuntime } from './identity-draft.js';
import { loadCreationDecisionConsequenceCatalog } from './creation-decision-consequence-catalog.js';
import {
  deriveChr009AssignmentView,
  deriveChr011ClassView,
  deriveChr012StatsView,
} from './creation-stat-assignment.js';
import {
  commitCreationRoll,
  CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  CreationRollCommitApplicationError,
  normalizeCreationRollCommitRequest,
  preflightCreationRoll,
} from './creation-roll-commit.js';
import type { CreationRollCommitCommandRequest } from './creation-set-decide.js';
import {
  advanceCreationWizardProjection,
  commitCreationSetDecide,
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  currentCreationWizardRevisions,
  currentStatRollAttempt,
  deriveCreationSetAbandonmentDialogContext,
  CreationSetDecideApplicationError,
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  normalizeCreationSetDecideRequest,
  preflightCreationSetDecide,
} from './creation-set-decide.js';
import type {
  CreationSetAbandonmentDialogContext,
  CreationSetDecideCommandRequest,
  DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import { IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID } from './identity-checkpoint.js';
import type { IdentityCheckpointCommandRequest } from './identity-checkpoint.js';
import {
  commitCreationWizardCheckpoint,
  CreationWizardCheckpointApplicationError,
  normalizeCreationWizardCheckpointRequest,
  preflightCreationWizardCheckpoint,
} from './creation-wizard-checkpoint.js';
import type { CreationWizardCheckpointCommandRequest } from './creation-wizard-checkpoint.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { loadSkillStageCatalog } from './skill-stage-catalog.js';
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
  CHR_003_FORM_ID,
  CHR_003_COMMITTED_ACTION_KEYS,
  CHR_003_REQUEST_ACTION_KEYS,
  CHR_003_ROUTE,
  CHR_004_FORM_ID,
  CHR_004_COMPLETE_ACTION_KEYS,
  CHR_004_PENDING_ACTION_KEYS,
  CHR_004_ROUTE,
  CHR_005_FORM_ID,
  CHR_006_FORM_ID,
  CHR_007_FORM_ID,
  CHR_008_FORM_ID,
  CHR_009_FORM_ID,
  CHR_009_ROUTE,
  CHR_010_FORM_ID,
  CHR_010_INITIAL_ACTION_KEYS,
  CHR_010_ROUTE,
  CHR_016_FORM_ID,
  CHR_016_INITIAL_ACTION_KEYS,
  CHR_016_ROUTE,
  CHR_011_FORM_ID,
  CHR_011_INITIAL_ACTION_KEYS,
  CHR_011_ROUTE,
  CHR_012_ACTION_KEYS,
  CHR_012_FORM_ID,
  CHR_012_ROUTE,
  CHR_028_FORM_ID,
  CHR_036_FORM_ID,
  CHR_036_INITIAL_ACTION_KEYS,
  CHR_036_ROUTE,
  projectChr001,
  projectChr003,
  projectChr004,
  projectChr028,
  projectCreationSetDecision,
  CREATION_SET_DECISION_FORMS,
  CHR_028_ROUTE,
  CHR_028_WARNING_ACTION_KEYS,
  creationSetDecisionFormContract,
  creationSetDecisionPendingActionKeys,
  chr009CheckpointActionKeys,
  projectInitialChr001,
  projectInitialChr002,
  projectInitialChr009,
  projectInitialChr010,
  projectInitialChr011,
  projectInitialChr016,
  projectInitialChr036,
  projectChr012,
} from './projections/chr.js';

export interface HostServerConfig {
  readonly advanceRevisions: (impact: RevisionImpact) => RevisionVector;
  readonly allocateCreationBranchUuid: () => string;
  readonly allocateCreationRollRequestId: () => string;
  readonly allocateContextId: () => string;
  readonly allocateLocalCharacterId: () => string;
  readonly allocateReceiptId: () => string;
  readonly allocateWizardCheckpointId: () => string;
  readonly database: Parameters<typeof loadDeviceId>[0];
  readonly onFrameError: (error: unknown) => void;
  readonly projectRoot: string;
  readonly readRevisions: () => RevisionVector;
  readonly sampleCreationD20: () => number;
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
interface ActiveCreationLayer {
  /** Non-null only while CHR-028 is the reversible, command-capable warning. */
  readonly dialogContext: CreationSetAbandonmentDialogContext | null;
  readonly presented: PresentedLayerForm;
}
interface CreationWizardCapabilities {
  readonly checkpoint: boolean;
  readonly rollCommit: boolean;
  readonly setDecide: boolean;
}
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
    | typeof CHR_003_FORM_ID
    | typeof CHR_004_FORM_ID
    | typeof CHR_005_FORM_ID
    | typeof CHR_006_FORM_ID
    | typeof CHR_007_FORM_ID
    | typeof CHR_008_FORM_ID
    | typeof CHR_009_FORM_ID
    | typeof CHR_011_FORM_ID
    | typeof CHR_012_FORM_ID
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
    readonly nextLayer: ActiveCreationLayer | undefined;
    readonly request: FormActionIntentV2Message;
    readonly terminal: FormActionTerminal;
  }
>;
interface ConnectionNavigation {
  activeLayer: ActiveCreationLayer | null;
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
  readonly allocateCreationBranchUuid: HostServerConfig['allocateCreationBranchUuid'];
  readonly allocateCreationRollRequestId: HostServerConfig['allocateCreationRollRequestId'];
  readonly allocateContextId: HostServerConfig['allocateContextId'];
  readonly allocateLocalCharacterId: HostServerConfig['allocateLocalCharacterId'];
  readonly allocateReceiptId: HostServerConfig['allocateReceiptId'];
  readonly allocateWizardCheckpointId: HostServerConfig['allocateWizardCheckpointId'];
  readonly catalog: AppProjectionCatalog;
  readonly creationDecisionConsequenceCatalog: Awaited<
    ReturnType<typeof loadCreationDecisionConsequenceCatalog>
  >;
  readonly database: HostServerConfig['database'];
  readonly journal: NavigationJournal;
  readonly identityDraft: IdentityDraftRuntime;
  readonly identitySessions: Map<string, ConfirmedNavigationContext>;
  readonly libraryRevision: LibraryRevisionRuntime;
  readonly onFrameError: HostServerConfig['onFrameError'];
  readonly readRevisions: HostServerConfig['readRevisions'];
  readonly sampleCreationD20: HostServerConfig['sampleCreationD20'];
  readonly skillStageCatalog: Awaited<ReturnType<typeof loadSkillStageCatalog>>;
  readonly vocabulary: HostVocabulary;
}
interface NavigationSuccess {
  readonly nextLayer?: ActiveCreationLayer;
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

function creationWizardCapabilities(
  workflowCommandIds: ReadonlySet<WorkflowCommandId>,
): CreationWizardCapabilities {
  return {
    checkpoint: workflowCommandIds.has(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID),
    rollCommit: workflowCommandIds.has(CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID),
    setDecide: workflowCommandIds.has(CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID),
  };
}

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
  request:
    | CreationRollCommitCommandRequest
    | CreationSetDecideCommandRequest
    | CreationWizardCheckpointCommandRequest,
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

function assertProcessLocalIdUnused(
  value: string,
  allocatorLabel: string,
  commandJournal: CommandJournal,
): string {
  for (const [commandId, { terminal }] of commandJournal) {
    if (
      commandId === value ||
      (terminal.messageType === 'command.result' && terminal.receipt.receiptId === value)
    ) {
      throw new Error(
        `${allocatorLabel} reused process-local command/receipt ID ${JSON.stringify(value)}`,
      );
    }
  }
  return value;
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
  layers: readonly PresentedLayerForm[] = [],
): ProjectionSnapshotV2Message {
  return {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: { correlationId, reason },
      base,
      layers,
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
  connection.activeLayer = null;
  if (
    next.identityDraftScope !== null ||
    next.formId === CHR_010_FORM_ID ||
    next.formId === CHR_016_FORM_ID ||
    next.formId === CHR_036_FORM_ID ||
    next.formId === CHR_002_FORM_ID ||
    next.formId === CHR_003_FORM_ID ||
    next.formId === CHR_004_FORM_ID ||
    next.formId === CHR_005_FORM_ID ||
    next.formId === CHR_006_FORM_ID ||
    next.formId === CHR_007_FORM_ID ||
    next.formId === CHR_008_FORM_ID ||
    next.formId === CHR_009_FORM_ID ||
    next.formId === CHR_011_FORM_ID ||
    next.formId === CHR_012_FORM_ID
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

function creationStatRollStage(checkpoint: DurableCreationWizardCheckpoint) {
  const stage = checkpoint.statRollStage;
  if (stage === null) {
    throw new Error(
      `durable ${checkpoint.nextStageEnvelope.formId} destination has no statRollStage`,
    );
  }
  return stage;
}

function creationCurrentStatRollAttempt(checkpoint: DurableCreationWizardCheckpoint) {
  const stage = creationStatRollStage(checkpoint);
  const attempt = currentStatRollAttempt(stage);
  if (attempt === null) {
    throw new Error(
      `durable ${checkpoint.nextStageEnvelope.formId} destination has no current stat-roll attempt`,
    );
  }
  return { attempt, stage };
}

function creationChr003Base(
  checkpoint: DurableCreationWizardCheckpoint,
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
  routeBindings: DurableCreationWizardCheckpoint['nextStageEnvelope']['routeBindings'],
  capabilityAvailable: boolean,
): PresentedBaseForm {
  const { attempt, stage } = creationCurrentStatRollAttempt(checkpoint);
  if (attempt.state !== 'REQUEST_READY' && attempt.state !== 'DECISION_READY') {
    throw new Error(`durable CHR-003 destination has stat roll state ${attempt.state}`);
  }
  const setResult = attempt.setRecord?.receipt.result ?? null;
  return {
    availableActionKeys:
      attempt.state === 'REQUEST_READY' && capabilityAvailable
        ? CHR_003_REQUEST_ACTION_KEYS
        : CHR_003_COMMITTED_ACTION_KEYS,
    formId: CHR_003_FORM_ID,
    formType: 'screen',
    roleFilteredPayload: projectChr003({
      attemptIndex: attempt.attemptIndex,
      branchUuid: stage.branchUuid,
      characterDraftId,
      diceInputModeSnapshot: stage.diceInputModeSnapshot,
      draftRevision,
      facesOrManualInputs: setResult?.faces ?? [null, null, null, null, null, null, null],
      naturalCriticalQueue: attempt.naturalCriticalQueue.map(({ originFace, setEntryIndex }) => ({
        originFace,
        setEntryIndex,
      })),
      setRollReceiptId: setResult?.setRollReceiptId ?? null,
      setRollRequestId: attempt.setRollRequestId,
      shownResultLocked: setResult?.shownResultLocked ?? false,
      statMethod: stage.statMethod,
      wizardCheckpointId,
    }),
    routeBindings,
    routeTemplate: CHR_003_ROUTE,
  };
}

function creationChr004Base(
  checkpoint: DurableCreationWizardCheckpoint,
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
  routeBindings: DurableCreationWizardCheckpoint['nextStageEnvelope']['routeBindings'],
  capabilityAvailable: boolean,
): PresentedBaseForm {
  const { attempt, stage } = creationCurrentStatRollAttempt(checkpoint);
  const setRollReceiptId = attempt.setRecord?.receipt.result.setRollReceiptId;
  if (setRollReceiptId === undefined) {
    throw new Error('durable CHR-004 destination has no committed set receipt');
  }
  let criticalQueueIndex: number;
  let originFace: 1 | 20;
  let confirmationRollRequestId: string;
  let confirmationFace: number | null;
  let confirmationReceiptId: string | null;
  if (attempt.state === 'CRITICALS_PENDING') {
    const index = attempt.criticalQueueIndexOrNull;
    const requestId = attempt.confirmationRollRequestIdOrNull;
    const queueItem = index === null ? undefined : attempt.naturalCriticalQueue[index];
    if (index === null || requestId === null || queueItem === undefined) {
      throw new Error('durable CHR-004 pending state has no current critical request');
    }
    criticalQueueIndex = index;
    originFace = queueItem.originFace;
    confirmationRollRequestId = requestId;
    confirmationFace = null;
    confirmationReceiptId = null;
  } else if (attempt.state === 'CHAIN_COMPLETE') {
    const last = attempt.confirmationRecords.at(-1)?.receipt.result;
    if (last === undefined) {
      throw new Error('durable CHR-004 complete state has no confirmation receipt');
    }
    criticalQueueIndex = last.criticalQueueIndex;
    originFace = last.originFace;
    confirmationRollRequestId = last.confirmationRollRequestId;
    confirmationFace = last.confirmationFace;
    confirmationReceiptId = last.confirmationReceiptId;
  } else {
    throw new Error(`durable CHR-004 destination has stat roll state ${attempt.state}`);
  }
  return {
    availableActionKeys:
      attempt.state === 'CRITICALS_PENDING' && capabilityAvailable
        ? CHR_004_PENDING_ACTION_KEYS
        : CHR_004_COMPLETE_ACTION_KEYS,
    formId: CHR_004_FORM_ID,
    formType: 'screen',
    roleFilteredPayload: projectChr004({
      branchUuid: stage.branchUuid,
      characterDraftId,
      confirmationFace,
      confirmationReceiptId,
      confirmationRollRequestId,
      criticalQueueIndex,
      diceInputModeSnapshot: stage.diceInputModeSnapshot,
      draftRevision,
      originFace,
      returnDecisionFormId: attempt.returnDecisionFormId,
      setRollReceiptId,
      wizardCheckpointId,
    }),
    routeBindings,
    routeTemplate: CHR_004_ROUTE,
  };
}

function creationDecisionAttempt(checkpoint: DurableCreationWizardCheckpoint) {
  const stage = creationStatRollStage(checkpoint);
  const attempt = currentStatRollAttempt(stage);
  if (attempt === null || attempt.setRecord === null) {
    throw new Error('durable set-decision presentation has no committed set attempt');
  }
  if (checkpoint.nextStageEnvelope.formId !== attempt.returnDecisionFormId) {
    throw new Error(
      `durable ${checkpoint.nextStageEnvelope.formId} destination cannot present ${attempt.returnDecisionFormId}`,
    );
  }
  return { attempt, stage };
}

function creationSetDecisionBase(
  checkpoint: DurableCreationWizardCheckpoint,
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
  setDecideCapabilityAvailable: boolean,
): PresentedBaseForm {
  const { attempt } = creationDecisionAttempt(checkpoint);
  const setRecord = attempt.setRecord;
  if (setRecord === null) throw new Error('set-decision presentation lost its set record');
  const record = attempt.decisionRecordOrNull;
  const contract = creationSetDecisionFormContract(attempt.returnDecisionFormId);
  return {
    availableActionKeys:
      record === null && setDecideCapabilityAvailable
        ? creationSetDecisionPendingActionKeys(attempt.returnDecisionFormId, attempt.attemptIndex)
        : [],
    formId: attempt.returnDecisionFormId,
    formType: 'screen',
    roleFilteredPayload: projectCreationSetDecision({
      attemptIndex: attempt.attemptIndex,
      characterDraftId,
      commandId: record?.request.commandId ?? null,
      decision: record?.derived.decision ?? 'PENDING',
      decisionReceiptIdOrNull: record?.receipt.receiptId ?? null,
      draftRevision,
      formId: attempt.returnDecisionFormId,
      setReceiptId: setRecord.receipt.receiptId,
      wizardCheckpointId,
    }),
    routeBindings: [{ parameterIndex: 0, source: 'inherited', value: characterDraftId }],
    routeTemplate: contract.route,
  };
}

function creationWarningLayer(
  context: CreationSetAbandonmentDialogContext,
  attemptIndex: number,
): ActiveCreationLayer {
  return {
    dialogContext: context,
    presented: {
      availableActionKeys: CHR_028_WARNING_ACTION_KEYS,
      formId: CHR_028_FORM_ID,
      formType: 'dialog',
      roleFilteredPayload: projectChr028({
        ...context,
        attemptIndex,
        commandId: null,
        decision: null,
        decisionReceiptIdOrNull: null,
      }),
      routeBindings: [],
      routeTemplate: CHR_028_ROUTE,
    },
  };
}

function creationWarningNavigation(
  message: FormActionIntentV2Message,
  current: ConfirmedPlayerContext,
  before: RevisionVector,
  connection: ConnectionNavigation,
  dependencies: NavigationDependencies,
): NavigationSuccess | undefined {
  const contract = CREATION_SET_DECISION_FORMS.find(
    ({ warningActionKey }) => warningActionKey === message.actionKey,
  );
  if (
    contract === undefined ||
    current.formId !== contract.formId ||
    current.entityLocalCharacterId === null ||
    connection.activeLayer !== null ||
    !connection.executableWorkflowCommandIds.has(CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID)
  ) {
    return undefined;
  }
  let checkpoint = loadCreationWizardCheckpoint(
    dependencies.database,
    current.entityLocalCharacterId,
    dependencies.skillStageCatalog,
  );
  if (!isDeepStrictEqual(currentCreationWizardRevisions(checkpoint), before)) return undefined;
  let dialogContext: CreationSetAbandonmentDialogContext;
  try {
    dialogContext = deriveCreationSetAbandonmentDialogContext(checkpoint);
  } catch (error: unknown) {
    if (error instanceof CreationSetDecideApplicationError) return undefined;
    throw error;
  }
  if (
    dialogContext.originDecisionFormId !== contract.formId ||
    connection.current !== current ||
    !confirmedPlayerContext(current, dependencies) ||
    !connection.executableWorkflowCommandIds.has(CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID)
  ) {
    return undefined;
  }
  checkpoint = advanceCreationWizardProjection(
    dependencies.database,
    dialogContext.characterDraftId,
    dialogContext.wizardCheckpointId,
    dependencies.skillStageCatalog,
  );
  const after = currentCreationWizardRevisions(checkpoint);
  if (
    after.actorVisibilityRevision !== before.actorVisibilityRevision ||
    after.stateRevision !== before.stateRevision ||
    after.projectionRevision !== before.projectionRevision + 1
  ) {
    throw new Error('CHR-028 warning open did not produce an exact projection-only revision');
  }
  const currentAttempt = currentStatRollAttempt(creationStatRollStage(checkpoint));
  const advancedContext = deriveCreationSetAbandonmentDialogContext(checkpoint);
  if (currentAttempt === null || !isDeepStrictEqual(advancedContext, dialogContext)) {
    throw new Error('CHR-028 warning context changed during its projection-only open');
  }
  const nextLayer = creationWarningLayer(dialogContext, currentAttempt.attemptIndex);
  const base = creationWizardBase(
    checkpoint,
    creationWizardCapabilities(connection.executableWorkflowCommandIds),
    dependencies.skillStageCatalog,
    dependencies.creationDecisionConsequenceCatalog,
  );
  const nextContext = creationWizardContext(connection, dependencies, checkpoint);
  return {
    nextContext,
    nextLayer,
    snapshot: projectionSnapshot(
      message.navigationRequestId,
      base,
      'player',
      after,
      'FORM_ACTION',
      [nextLayer.presented],
    ),
  };
}

function creationWizardBase(
  checkpoint: DurableCreationWizardCheckpoint,
  capabilities: CreationWizardCapabilities,
  skillStageCatalog: NavigationDependencies['skillStageCatalog'],
  consequenceCatalog: NavigationDependencies['creationDecisionConsequenceCatalog'],
): PresentedBaseForm {
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
          consequenceCatalog,
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
          consequenceCatalog,
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
          consequenceCatalog,
        ),
        routeBindings,
        routeTemplate: CHR_002_ROUTE,
      };
    case CHR_003_FORM_ID:
      return creationChr003Base(
        checkpoint,
        characterDraftId,
        wizardCheckpointId,
        draftRevision,
        routeBindings,
        capabilities.rollCommit,
      );
    case CHR_004_FORM_ID:
      return creationChr004Base(
        checkpoint,
        characterDraftId,
        wizardCheckpointId,
        draftRevision,
        routeBindings,
        capabilities.rollCommit,
      );
    case CHR_005_FORM_ID:
    case CHR_006_FORM_ID:
    case CHR_007_FORM_ID:
    case CHR_008_FORM_ID:
      return creationSetDecisionBase(
        checkpoint,
        characterDraftId,
        wizardCheckpointId,
        draftRevision,
        capabilities.setDecide,
      );
    case CHR_009_FORM_ID: {
      const view = deriveChr009AssignmentView(checkpoint, skillStageCatalog);
      let roleFilteredPayload: JsonObject;
      if (view.assignmentMode === 'ROLLED_BIJECTION') {
        if (view.sourceEntries === undefined || view.sourceSetReceiptIdOrNull === null) {
          throw new Error('durable rolled CHR-009 view lacks its source entries or receipt');
        }
        roleFilteredPayload = projectInitialChr009({
          ...view,
          assignmentMode: view.assignmentMode,
          sourceEntries: view.sourceEntries,
          sourceSetReceiptIdOrNull: view.sourceSetReceiptIdOrNull,
        });
      } else {
        if (view.sourceEntries !== undefined || view.sourceSetReceiptIdOrNull !== null) {
          throw new Error('durable point-buy CHR-009 view contains rolled source provenance');
        }
        roleFilteredPayload = projectInitialChr009({
          ...view,
          assignmentMode: view.assignmentMode,
          sourceSetReceiptIdOrNull: null,
        });
      }
      return {
        availableActionKeys: chr009CheckpointActionKeys(view.raceChoice, capabilities.checkpoint),
        formId: CHR_009_FORM_ID,
        formType: 'screen',
        roleFilteredPayload,
        routeBindings,
        routeTemplate: CHR_009_ROUTE,
      };
    }
    case CHR_011_FORM_ID:
      return {
        availableActionKeys: CHR_011_INITIAL_ACTION_KEYS,
        formId: CHR_011_FORM_ID,
        formType: 'screen',
        roleFilteredPayload: projectInitialChr011(
          deriveChr011ClassView(checkpoint, skillStageCatalog),
        ),
        routeBindings,
        routeTemplate: CHR_011_ROUTE,
      };
    case CHR_012_FORM_ID:
      return {
        availableActionKeys: CHR_012_ACTION_KEYS,
        formId: CHR_012_FORM_ID,
        formType: 'screen',
        roleFilteredPayload: projectChr012(deriveChr012StatsView(checkpoint, skillStageCatalog)),
        routeBindings,
        routeTemplate: CHR_012_ROUTE,
      };
    default:
      throw new Error(
        `durable creation wizard destination ${JSON.stringify(checkpoint.nextStageEnvelope.formId)} is not publishable`,
      );
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
      const actual = currentNavigationRevisions(connection, dependencies);
      if (known.nextLayer !== undefined && !isDeepStrictEqual(known.terminal.revisions, actual)) {
        sendCheckedV2(
          socket,
          formActionRefusal(message, { code: 'NAVIGATION_UNAVAILABLE' }, actual),
          dependencies.vocabulary,
        );
        return;
      }
      if (known.nextContext !== undefined && isDeepStrictEqual(known.terminal.revisions, actual)) {
        adoptNavigationContext(connection, dependencies, known.nextContext);
        if (known.nextLayer !== undefined) connection.activeLayer = known.nextLayer;
      }
      sendCheckedV2(socket, known.terminal, dependencies.vocabulary);
    } else {
      const revisions = currentNavigationRevisions(connection, dependencies);
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

  const finish = (
    terminal: FormActionTerminal,
    nextContext?: ConfirmedNavigationContext,
    nextLayer?: ActiveCreationLayer,
  ): void => {
    dependencies.journal.set(message.navigationRequestId, {
      nextContext,
      nextLayer,
      request: message,
      terminal,
    });
    if (nextContext !== undefined) {
      adoptNavigationContext(connection, dependencies, nextContext);
      if (nextLayer !== undefined) connection.activeLayer = nextLayer;
    }
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
  const interactiveFormId = connection.activeLayer?.presented.formId ?? current?.formId;
  const action = dependencies.catalog.actions.get(message.actionKey);
  if (
    current === null ||
    interactiveFormId !== message.sourceFormId ||
    action?.from !== message.sourceFormId
  ) {
    finish(formActionRefusal(message, { code: 'NAVIGATION_UNAVAILABLE' }, revisions));
    return;
  }
  let success: NavigationSuccess | undefined;
  if (
    CREATION_SET_DECISION_FORMS.some(
      ({ warningActionKey }) => warningActionKey === message.actionKey,
    )
  ) {
    if (action.to === CHR_028_FORM_ID && confirmedPlayerContext(current, dependencies)) {
      success = creationWarningNavigation(message, current, revisions, connection, dependencies);
    }
    if (success !== undefined) {
      finish(success.snapshot, success.nextContext, success.nextLayer);
    } else {
      finish(formActionRefusal(message, { code: 'NAVIGATION_UNAVAILABLE' }, revisions));
    }
    return;
  }
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
    finish(success.snapshot, success.nextContext, success.nextLayer);
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
        normalizeCreationWizardCheckpointRequest(saved),
        normalizeCreationWizardCheckpointRequest(incoming),
      );
    } catch (error: unknown) {
      if (error instanceof CreationWizardCheckpointApplicationError) {
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
  if (
    saved.commandKind === 'workflow-command' &&
    saved.workflowCommandId === CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID
  ) {
    try {
      return isDeepStrictEqual(
        normalizeCreationRollCommitRequest(saved),
        normalizeCreationRollCommitRequest(incoming),
      );
    } catch (error: unknown) {
      if (error instanceof CreationRollCommitApplicationError) {
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
  const durableCommand = loadCreationWizardCommandByCommandId(
    dependencies.database,
    commandId,
    dependencies.skillStageCatalog,
  );
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

function creationWizardContext(
  connection: ConnectionNavigation,
  dependencies: NavigationDependencies,
  checkpoint: DurableCreationWizardCheckpoint,
): ConfirmedNavigationContext {
  const deviceId = loadDeviceId(dependencies.database);
  const contextId =
    connection.current?.contextId ??
    dependencies.identitySessions.get(deviceId)?.contextId ??
    allocatedId(dependencies.allocateContextId, 'player context', UUID_V4_PATTERN);
  return {
    contextId,
    deviceId,
    entityLocalCharacterId: checkpoint.localCharacter.localCharacterId,
    entityRevisions: currentCreationWizardRevisions(checkpoint),
    formId: checkpoint.nextStageEnvelope.formId,
    identityDraftScope: null,
  };
}

function sendCreationWizardDestination(
  socket: WebSocket,
  checkpoint: DurableCreationWizardCheckpoint,
  dependencies: NavigationDependencies,
  connection: ConnectionNavigation,
  correlationId: string,
  reason: 'COMMAND_DESTINATION' | 'RECONNECT',
): void {
  sendCheckedV2(
    socket,
    projectionSnapshot(
      correlationId,
      creationWizardBase(
        checkpoint,
        creationWizardCapabilities(connection.executableWorkflowCommandIds),
        dependencies.skillStageCatalog,
        dependencies.creationDecisionConsequenceCatalog,
      ),
      'player',
      currentCreationWizardRevisions(checkpoint),
      reason,
    ),
    dependencies.vocabulary,
  );
  connection.activeLayer = null;
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
      dependencies.skillStageCatalog,
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
      connection,
      message.commandId,
      'COMMAND_DESTINATION',
    );
    return;
  }

  const revisions = currentNavigationRevisions(connection, dependencies);
  if (
    [...commandJournal.values()].some(
      ({ terminal }) =>
        terminal.messageType === 'command.result' &&
        terminal.receipt.receiptId === message.commandId,
    )
  ) {
    sendChecked(
      socket,
      commandRefusal(message.commandId, { code: 'GUARD_REJECTED' }, revisions),
      dependencies.vocabulary,
    );
    return;
  }
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
  if (message.workflowCommandId === CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID) {
    let request: CreationRollCommitCommandRequest;
    try {
      request = normalizeCreationRollCommitRequest(message);
    } catch (error: unknown) {
      if (!(error instanceof CreationRollCommitApplicationError)) throw error;
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
      !connection.executableWorkflowCommandIds.has(CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID)
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
      preflightCreationRoll(dependencies.database, request);
    } catch (error: unknown) {
      if (!(error instanceof CreationRollCommitApplicationError)) throw error;
      finishRefusal(request, error.refusal);
      return;
    }
    const receiptId = allocatedReceiptId(dependencies.allocateReceiptId, request);
    assertProcessLocalIdUnused(receiptId, 'command receipt allocator', commandJournal);
    const finalRevisions = currentNavigationRevisions(connection, dependencies);
    if (
      !isDeepStrictEqual(finalRevisions, revisions) ||
      !connection.sessionEstablished ||
      connection.current !== current ||
      !confirmedPlayerContext(current, dependencies) ||
      !connection.executableWorkflowCommandIds.has(CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID)
    ) {
      finishRefusal(request, { code: 'GUARD_REJECTED' });
      return;
    }
    try {
      preflightCreationRoll(dependencies.database, request);
    } catch (error: unknown) {
      if (!(error instanceof CreationRollCommitApplicationError)) throw error;
      finishRefusal(request, error.refusal);
      return;
    }
    let durableCheckpoint: DurableCreationWizardCheckpoint;
    try {
      durableCheckpoint = commitCreationRoll(dependencies.database, request, receiptId, {
        allocateRollRequestId: () =>
          assertProcessLocalIdUnused(
            dependencies.allocateCreationRollRequestId(),
            'creation roll-request allocator',
            commandJournal,
          ),
        sampleD20: dependencies.sampleCreationD20,
      });
    } catch (error: unknown) {
      if (!(error instanceof CreationRollCommitApplicationError)) throw error;
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
      connection,
      request.commandId,
      'COMMAND_DESTINATION',
    );
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
    const interactiveFormId = connection.activeLayer?.presented.formId ?? current?.formId;
    const dialogContext =
      request.payload.sourceFormId === CHR_028_FORM_ID
        ? (connection.activeLayer?.dialogContext ?? undefined)
        : undefined;
    if (
      current === null ||
      current.identityDraftScope !== null ||
      current.entityLocalCharacterId !== request.payload.characterDraftId ||
      interactiveFormId !== request.payload.sourceFormId ||
      (request.payload.sourceFormId === CHR_028_FORM_ID && dialogContext === undefined) ||
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
    try {
      preflightCreationSetDecide(
        dependencies.database,
        request,
        dialogContext,
        dependencies.skillStageCatalog,
      );
    } catch (error: unknown) {
      if (!(error instanceof CreationSetDecideApplicationError)) throw error;
      finishRefusal(request, error.refusal);
      return;
    }
    const receiptId = allocatedReceiptId(dependencies.allocateReceiptId, request);
    assertProcessLocalIdUnused(receiptId, 'command receipt allocator', commandJournal);

    const finalRevisions = currentNavigationRevisions(connection, dependencies);
    if (
      !isDeepStrictEqual(finalRevisions, revisions) ||
      connection.current !== current ||
      (connection.activeLayer?.presented.formId ?? current.formId) !==
        request.payload.sourceFormId ||
      (request.payload.sourceFormId === CHR_028_FORM_ID &&
        !isDeepStrictEqual(connection.activeLayer?.dialogContext, dialogContext)) ||
      !confirmedPlayerContext(current, dependencies) ||
      !connection.executableWorkflowCommandIds.has(CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID)
    ) {
      finishRefusal(request, { code: 'GUARD_REJECTED' });
      return;
    }
    try {
      preflightCreationSetDecide(
        dependencies.database,
        request,
        dialogContext,
        dependencies.skillStageCatalog,
      );
    } catch (error: unknown) {
      if (!(error instanceof CreationSetDecideApplicationError)) throw error;
      finishRefusal(request, error.refusal);
      return;
    }
    let execution: ReturnType<typeof commitCreationSetDecide>;
    try {
      execution = commitCreationSetDecide(
        dependencies.database,
        request,
        receiptId,
        {
          allocateBranchUuid: () =>
            assertProcessLocalIdUnused(
              dependencies.allocateCreationBranchUuid(),
              'creation branch allocator',
              commandJournal,
            ),
          allocateRollRequestId: () =>
            assertProcessLocalIdUnused(
              dependencies.allocateCreationRollRequestId(),
              'creation roll-request allocator',
              commandJournal,
            ),
        },
        dialogContext,
        dependencies.skillStageCatalog,
      );
    } catch (error: unknown) {
      if (!(error instanceof CreationSetDecideApplicationError)) throw error;
      finishRefusal(request, error.refusal);
      return;
    }
    if (execution.kind === 'TRANSIENT_CANCEL') {
      const closedCheckpoint = advanceCreationWizardProjection(
        dependencies.database,
        request.payload.characterDraftId,
        request.payload.wizardCheckpointId,
        dependencies.skillStageCatalog,
      );
      const terminal = commandResult(execution.receipt);
      commandJournal.set(request.commandId, {
        durableCharacterId: closedCheckpoint.localCharacter.localCharacterId,
        request,
        terminal,
      });
      adoptNavigationContext(
        connection,
        dependencies,
        creationWizardContext(connection, dependencies, closedCheckpoint),
      );
      sendChecked(socket, terminal, dependencies.vocabulary);
      sendCreationWizardDestination(
        socket,
        closedCheckpoint,
        dependencies,
        connection,
        request.commandId,
        'COMMAND_DESTINATION',
      );
      return;
    }
    const durableCheckpoint = execution.durableCheckpoint;
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
      connection,
      request.commandId,
      'COMMAND_DESTINATION',
    );
    return;
  }
  let checkpointRequest: CreationWizardCheckpointCommandRequest;
  try {
    checkpointRequest = normalizeCreationWizardCheckpointRequest(message);
  } catch (error: unknown) {
    if (!(error instanceof CreationWizardCheckpointApplicationError)) {
      throw error;
    }
    finishRefusal(message, error.refusal);
    return;
  }

  if (checkpointRequest.payload.stage === 'STAT_ASSIGNMENT') {
    const request = checkpointRequest;
    const current = connection.sessionEstablished ? connection.current : null;
    if (
      current === null ||
      current.identityDraftScope !== null ||
      current.entityLocalCharacterId !== request.payload.characterDraftId ||
      current.formId !== CHR_009_FORM_ID ||
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
      preflightCreationWizardCheckpoint(
        dependencies.database,
        request,
        dependencies.skillStageCatalog,
      );
    } catch (error: unknown) {
      if (!(error instanceof CreationWizardCheckpointApplicationError)) throw error;
      finishRefusal(request, error.refusal);
      return;
    }
    const receiptId = allocatedReceiptId(dependencies.allocateReceiptId, request);
    assertProcessLocalIdUnused(receiptId, 'command receipt allocator', commandJournal);

    const finalRevisions = currentNavigationRevisions(connection, dependencies);
    if (
      !isDeepStrictEqual(finalRevisions, revisions) ||
      connection.current !== current ||
      !confirmedPlayerContext(current, dependencies) ||
      !connection.executableWorkflowCommandIds.has(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID)
    ) {
      finishRefusal(request, { code: 'GUARD_REJECTED' });
      return;
    }
    try {
      preflightCreationWizardCheckpoint(
        dependencies.database,
        request,
        dependencies.skillStageCatalog,
      );
    } catch (error: unknown) {
      if (!(error instanceof CreationWizardCheckpointApplicationError)) throw error;
      finishRefusal(request, error.refusal);
      return;
    }
    let durableCheckpoint: DurableCreationWizardCheckpoint;
    try {
      durableCheckpoint = commitCreationWizardCheckpoint(
        dependencies.database,
        request,
        receiptId,
        dependencies.skillStageCatalog,
      );
    } catch (error: unknown) {
      if (!(error instanceof CreationWizardCheckpointApplicationError)) throw error;
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
      connection,
      request.commandId,
      'COMMAND_DESTINATION',
    );
    return;
  }

  const request = checkpointRequest as IdentityCheckpointCommandRequest;
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
  const draft = dependencies.identityDraft.readScope(scope);
  if (draft === null || !checkpointRequestMatchesDraft(request, scope, draft)) {
    finishRefusal(request, { code: 'GUARD_REJECTED' });
    return;
  }
  try {
    preflightCreationWizardCheckpoint(
      dependencies.database,
      request,
      dependencies.skillStageCatalog,
    );
  } catch (error: unknown) {
    if (!(error instanceof CreationWizardCheckpointApplicationError)) throw error;
    finishRefusal(request, error.refusal);
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
  assertProcessLocalIdUnused(receiptId, 'command receipt allocator', commandJournal);

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

  try {
    preflightCreationWizardCheckpoint(
      dependencies.database,
      request,
      dependencies.skillStageCatalog,
    );
  } catch (error: unknown) {
    if (!(error instanceof CreationWizardCheckpointApplicationError)) throw error;
    finishRefusal(request, error.refusal);
    return;
  }
  let durableCheckpoint: DurableCreationWizardCheckpoint;
  try {
    durableCheckpoint = commitCreationWizardCheckpoint(
      dependencies.database,
      request,
      receiptId,
      dependencies.skillStageCatalog,
    );
  } catch (error: unknown) {
    if (!(error instanceof CreationWizardCheckpointApplicationError)) throw error;
    finishRefusal(request, error.refusal);
    return;
  }
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
    creationWizardContext(connection, dependencies, durableCheckpoint),
  );
  dependencies.libraryRevision.commitIncrement();
  advanceProjection(revisions, dependencies.advanceRevisions);
  sendChecked(socket, terminal, dependencies.vocabulary);
  sendCreationWizardDestination(
    socket,
    durableCheckpoint,
    dependencies,
    connection,
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
            loadCreationWizardCheckpoint(
              dependencies.database,
              known.durableCharacterId,
              dependencies.skillStageCatalog,
            ),
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

  const warningContext = connection.activeLayer?.dialogContext ?? null;
  if (warningContext !== null) {
    advanceCreationWizardProjection(
      dependencies.database,
      warningContext.characterDraftId,
      warningContext.wizardCheckpointId,
      dependencies.skillStageCatalog,
    );
    connection.activeLayer = null;
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
  const creationCapabilities = creationWizardCapabilities(executableSet);
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
    base = creationWizardBase(
      replayDestination,
      creationCapabilities,
      dependencies.skillStageCatalog,
      dependencies.creationDecisionConsequenceCatalog,
    );
    nextContext = creationWizardContext(connection, dependencies, replayDestination);
    projectionRole = 'player';
    revisions = currentCreationWizardRevisions(replayDestination);
  } else if (
    restored?.entityLocalCharacterId !== null &&
    restored?.entityLocalCharacterId !== undefined &&
    (restored.formId === CHR_010_FORM_ID ||
      restored.formId === CHR_016_FORM_ID ||
      restored.formId === CHR_036_FORM_ID ||
      restored.formId === CHR_002_FORM_ID ||
      restored.formId === CHR_003_FORM_ID ||
      restored.formId === CHR_004_FORM_ID ||
      restored.formId === CHR_005_FORM_ID ||
      restored.formId === CHR_006_FORM_ID ||
      restored.formId === CHR_007_FORM_ID ||
      restored.formId === CHR_008_FORM_ID ||
      restored.formId === CHR_009_FORM_ID ||
      restored.formId === CHR_011_FORM_ID ||
      restored.formId === CHR_012_FORM_ID)
  ) {
    const checkpoint = loadCreationWizardCheckpoint(
      dependencies.database,
      restored.entityLocalCharacterId,
      dependencies.skillStageCatalog,
    );
    base = creationWizardBase(
      checkpoint,
      creationCapabilities,
      dependencies.skillStageCatalog,
      dependencies.creationDecisionConsequenceCatalog,
    );
    nextContext = creationWizardContext(connection, dependencies, checkpoint);
    projectionRole = 'player';
    revisions = currentCreationWizardRevisions(checkpoint);
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
  connection.activeLayer = null;
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
    allocateCreationBranchUuid: config.allocateCreationBranchUuid,
    allocateCreationRollRequestId: config.allocateCreationRollRequestId,
    allocateContextId: config.allocateContextId,
    allocateLocalCharacterId: config.allocateLocalCharacterId,
    allocateReceiptId: config.allocateReceiptId,
    allocateWizardCheckpointId: config.allocateWizardCheckpointId,
    readRevisions: config.readRevisions,
    sampleCreationD20: config.sampleCreationD20,
  })) {
    if (typeof value !== 'function')
      throw new TypeError(`host ${name} configuration must be a function`);
  }
  if (typeof config.onFrameError !== 'function')
    throw new TypeError('host onFrameError configuration must be a function');
  const projectRoot = resolve(config.projectRoot);
  const staticRoot = await realpath(resolve(config.staticRoot));
  const [catalog, skillStageCatalog, vocabulary] = await Promise.all([
    loadAppProjectionCatalog(projectRoot),
    loadSkillStageCatalog(projectRoot),
    loadProtocolVocabulary(projectRoot),
  ]);
  const creationDecisionConsequenceCatalog = await loadCreationDecisionConsequenceCatalog(
    projectRoot,
    skillStageCatalog,
  );

  const app = Fastify({ logger: false });
  const commandJournal: CommandJournal = new Map();
  const dependencies: NavigationDependencies = {
    advanceRevisions: config.advanceRevisions,
    allocateCreationBranchUuid: config.allocateCreationBranchUuid,
    allocateCreationRollRequestId: config.allocateCreationRollRequestId,
    allocateContextId: config.allocateContextId,
    allocateLocalCharacterId: config.allocateLocalCharacterId,
    allocateReceiptId: config.allocateReceiptId,
    allocateWizardCheckpointId: config.allocateWizardCheckpointId,
    catalog,
    creationDecisionConsequenceCatalog,
    database: config.database,
    identityDraft: createIdentityDraftRuntime(new Set(LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS)),
    identitySessions: new Map(),
    journal: new Map(),
    libraryRevision: createLibraryRevisionRuntime(),
    onFrameError: config.onFrameError,
    readRevisions: config.readRevisions,
    sampleCreationD20: config.sampleCreationD20,
    skillStageCatalog,
    vocabulary,
  };
  await app.register(websocket);

  app.get('/state', { websocket: true }, (socket) => {
    const connection: ConnectionNavigation = {
      activeLayer: null,
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
