import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';

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
  CommandResultMessage,
  FormActionIntentV2Message,
  HostToClientMessage,
  HostToClientV2Message,
  ProtocolVocabulary,
  RevisionVector,
  SessionReconnectV2Message,
  WireV2Vocabulary,
} from '@shared/index.js';

import type { SymbiontCatalog } from '../domain/index.js';
import { openPersistenceDatabase } from '../persistence/database.js';
import { bootstrapDeviceIdentity } from '../persistence/index.js';
import type { RevisionImpact } from '../persistence/index.js';
import {
  commitCreationRoll,
  CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
} from './creation-roll-commit.js';
import {
  advanceCreationSkillSelectionProjection,
  creationWizardDurableIds,
  commitCreationSetDecide,
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  currentCreationWizardRevisions,
  currentStatRollAttempt,
  loadCreationWizardCheckpoint,
  validateDurableCreationWizardCheckpoint,
  type CreationRollCommitCommandRequest,
  type CreationSetDecideCommandRequest,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import type { SelectedSkillCommandInput } from './creation-skill-selection.js';
import { IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID } from './identity-checkpoint.js';
import { commitIdentityCheckpoint } from './identity-checkpoint.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { createHost, startHost } from './server.js';
import { loadSymbiontCatalog } from './symbiont-stage-catalog.js';
import { commitCreationWizardCheckpoint } from './creation-wizard-checkpoint.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ZERO_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;
const ALL_CREATION_WORKFLOW_COMMAND_IDS = [
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
] as const;
const WITHOUT_ROLL_COMMIT = [
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
] as const;
const WITHOUT_WIZARD_CHECKPOINT = [
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
] as const;
const IDENTITY_INDEX_MAP = { S: 0, D: 1, M: 2, Z: 3, I: 4, W: 5, C: 6 } as const;

type WorkflowRequest = Extract<
  ClientToHostMessage,
  { readonly commandKind: 'workflow-command'; readonly messageType: 'command.request' }
>;
type Snapshot = Extract<HostToClientV2Message, { readonly messageType: 'projection.snapshot' }>;

interface RevisionRuntime {
  readonly advance: (impact: RevisionImpact) => RevisionVector;
  readonly read: () => RevisionVector;
  readonly writes: readonly RevisionImpact[];
}

interface CommittedRandomSetup {
  readonly characterDraftId: string;
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly database: Database.Database;
  readonly deviceId: string;
  readonly selectionRequest: WorkflowRequest;
  readonly wizardCheckpointId: string;
}

interface RandomHost extends CommittedRandomSetup {
  readonly app: FastifyInstance;
  readonly prefix: string;
  readonly receiptAllocations: () => number;
  readonly rollRequestAllocations: () => number;
  readonly runtime: RevisionRuntime;
  readonly sampleCalls: () => number;
  readonly socket: WebSocket;
}

interface RandomCommandOutcome {
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly destination: Snapshot;
  readonly request: WorkflowRequest;
  readonly result: CommandResultMessage;
}

const databases: Database.Database[] = [];
const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
const temporaryDirectories: string[] = [];
let catalog: SymbiontCatalog;
let staticRoot: string;
let vocabulary: ProtocolVocabulary & WireV2Vocabulary;

function revisionRuntime(): RevisionRuntime {
  let revisions: RevisionVector = ZERO_REVISIONS;
  const writes: RevisionImpact[] = [];
  return {
    advance: (impact) => {
      writes.push(impact);
      revisions = {
        actorVisibilityRevision:
          revisions.actorVisibilityRevision + Number(impact.actorVisibilityChanged),
        projectionRevision: revisions.projectionRevision + Number(impact.projectionChanged),
        stateRevision: revisions.stateRevision + Number(impact.stateChanged),
      };
      return revisions;
    },
    read: () => revisions,
    writes,
  };
}

function rawDataText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  throw new TypeError('test received an unsupported RawData representation');
}

function receiveFrames(socket: WebSocket, count: number): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    const frames: string[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${String(count)} websocket frame(s)`));
    }, 5_000);
    const onMessage = (data: RawData): void => {
      frames.push(rawDataText(data));
      if (frames.length === count) {
        cleanup();
        resolve(frames);
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

function clientText(message: ClientToHostMessage): string {
  const encoded = encodeClientMessage(message, vocabulary);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.refusal));
  return encoded.text;
}

function clientTextV2(message: ClientToHostV2Message): string {
  const encoded = encodeClientMessageV2(message, vocabulary);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.refusal));
  return encoded.text;
}

function hostMessage(text: string): HostToClientMessage {
  const decoded = decodeHostMessage(text, vocabulary);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.refusal));
  return decoded.value;
}

function hostMessageV2(text: string): HostToClientV2Message {
  const decoded = decodeHostMessageV2(text, vocabulary);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.refusal));
  return decoded.value;
}

function snapshot(message: HostToClientV2Message): Snapshot {
  if (message.messageType !== 'projection.snapshot') {
    throw new Error(`expected projection.snapshot, got ${message.messageType}`);
  }
  return message;
}

function committedResult(message: HostToClientMessage): CommandResultMessage {
  if (message.messageType !== 'command.result') {
    throw new Error(`expected command.result, got ${message.messageType}`);
  }
  return message;
}

function resultRevision(result: CommandResultMessage, key: string): number {
  const value = result.receipt.result[key];
  if (typeof value !== 'number') throw new Error(`missing numeric receipt result ${key}`);
  return value;
}

function reconnect(
  host: RandomHost,
  requestId: string,
  unacknowledgedCommandIds: readonly string[],
  supportedWorkflowCommandIds: SessionReconnectV2Message['supportedWorkflowCommandIds'],
): SessionReconnectV2Message {
  return {
    deviceId: host.deviceId,
    knownRevisions: ZERO_REVISIONS,
    messageType: 'session.reconnect',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    reconnectRequestId: requestId,
    supportedWorkflowCommandIds,
    unacknowledgedCommandIds,
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

async function sendV2(
  socket: WebSocket,
  message: ClientToHostV2Message,
): Promise<HostToClientV2Message> {
  const frames = receiveFrames(socket, 1);
  socket.send(clientTextV2(message));
  return hostMessageV2((await frames)[0] ?? '');
}

async function sendCommand(
  socket: WebSocket,
  message: WorkflowRequest,
): Promise<readonly [HostToClientMessage, Snapshot]> {
  const frames = receiveFrames(socket, 2);
  socket.send(clientText(message));
  const values = await frames;
  return [hostMessage(values[0] ?? ''), snapshot(hostMessageV2(values[1] ?? ''))];
}

async function sendCommandRefusal(
  socket: WebSocket,
  message: WorkflowRequest,
): Promise<HostToClientMessage> {
  const frames = receiveFrames(socket, 1);
  socket.send(clientText(message));
  return hostMessage((await frames)[0] ?? '');
}

async function openSocket(app: FastifyInstance): Promise<WebSocket> {
  const socket = await app.injectWS('/state');
  sockets.push(socket);
  return socket;
}

async function reconnectOn(
  socket: WebSocket,
  host: RandomHost,
  requestId: string,
  unacknowledgedCommandIds: readonly string[] = [],
  supportedWorkflowCommandIds: SessionReconnectV2Message['supportedWorkflowCommandIds'] = ALL_CREATION_WORKFLOW_COMMAND_IDS,
): Promise<readonly string[]> {
  const frames = receiveFrames(socket, unacknowledgedCommandIds.length + 2);
  socket.send(
    clientTextV2(reconnect(host, requestId, unacknowledgedCommandIds, supportedWorkflowCommandIds)),
  );
  return frames;
}

function decision(
  previous: DurableCreationWizardCheckpoint,
  commandId: string,
  payload: CreationSetDecideCommandRequest['payload'],
): CreationSetDecideCommandRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(previous),
    messageType: 'command.request',
    payload,
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  };
}

function durableDecision(
  database: Database.Database,
  request: CreationSetDecideCommandRequest,
  receiptId: string,
  allocators?: {
    readonly allocateBranchUuid: () => string;
    readonly allocateRollRequestId: () => string;
  },
): DurableCreationWizardCheckpoint {
  const result = commitCreationSetDecide(database, request, receiptId, allocators);
  if (result.kind !== 'DURABLE') throw new Error('test expected a durable decision');
  return result.durableCheckpoint;
}

function exactSelectedSkills(
  checkpoint: DurableCreationWizardCheckpoint,
): readonly SelectedSkillCommandInput[] {
  const derived = checkpoint.skillEligibilityStage?.derived;
  if (derived === undefined) throw new Error('test expected skill eligibility');
  let remaining = derived.requiredSlotCount - (derived.mandatoryClassSkillOrNull?.slotCost ?? 0);
  const selected: SelectedSkillCommandInput[] = [];
  for (const skillId of derived.eligibleSkillIds) {
    if (remaining === 0) break;
    const targetBonus = Math.min(5, remaining);
    selected.push({ skillId, targetBonus });
    remaining -= targetBonus;
  }
  if (remaining !== 0) throw new Error('test catalog could not fill exact skill slots');
  return selected;
}

function setupCommittedRandom(
  prefix: string,
  raceChoice: 'FREE' | 'UNITED',
  diceInputMode: 'AUTO' | 'MANUAL',
  databasePath = ':memory:',
): CommittedRandomSetup {
  const database = openPersistenceDatabase(databasePath);
  databases.push(database);
  const deviceId = bootstrapDeviceIdentity(database);
  const characterDraftId = `${prefix}-character`;
  const wizardCheckpointId = `${prefix}-wizard`;
  commitIdentityCheckpoint(
    database,
    {
      commandId: `${prefix}-identity-command`,
      commandKind: 'workflow-command',
      expectedRevisions: ZERO_REVISIONS,
      messageType: 'command.request',
      payload: {
        age: 31,
        artAssetKeyOrLocalFile: null,
        characterDraftId,
        description: null,
        draftRevision: 0,
        massKg: 75,
        name: prefix,
        sex: 'FEMALE',
        stage: 'IDENTITY',
        wizardCheckpointId,
      },
      protocolVersion: WIRE_PROTOCOL_VERSION,
      role: 'player',
      workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
    },
    `${prefix}-identity-receipt`,
  );
  let current = loadCreationWizardCheckpoint(
    database,
    characterDraftId,
    catalog.skillStage,
    catalog,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-race-command`, {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      raceChoice,
      sourceFormId: 'CHR-010',
      stage: 'RACE_AND_METHOD',
      wizardCheckpointId,
    }),
    `${prefix}-race-receipt`,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-acquisition-command`, {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: 'CHR-016',
      stage: 'RACE_AND_METHOD',
      symbiontAcquisitionMode: 'RANDOM',
      wizardCheckpointId,
    }),
    `${prefix}-acquisition-receipt`,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-dice-command`, {
      characterDraftId,
      diceInputMode,
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: 'CHR-036',
      stage: 'RACE_AND_METHOD',
      wizardCheckpointId,
    }),
    `${prefix}-dice-receipt`,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-method-command`, {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: 'CHR-002',
      stage: 'RACE_AND_METHOD',
      statMethod: 'CLASSIC',
      wizardCheckpointId,
    }),
    `${prefix}-method-receipt`,
    {
      allocateBranchUuid: () => `${prefix}-stat-branch`,
      allocateRollRequestId: () => `${prefix}-set-request`,
    },
  );
  const setRollRequestId = currentStatRollAttempt(current.statRollStage!)!.setRollRequestId;
  const setRequest: CreationRollCommitCommandRequest = {
    commandId: `${prefix}-set-command`,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      branchUuid: current.statRollStage!.branchUuid,
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      manualFacesOrNull: diceInputMode === 'MANUAL' ? [19, 19, 19, 19, 19, 19, 19] : null,
      setRollRequestId,
      sourceFormId: 'CHR-003',
      stage: 'STAT_ROLLS',
      wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  };
  current = commitCreationRoll(database, setRequest, `${prefix}-set-receipt`, {
    allocateRollRequestId: () => `${prefix}-unused-confirmation-request`,
    sampleD20: () => 19,
  });
  current = durableDecision(
    database,
    decision(current, `${prefix}-accept-command`, {
      characterDraftId,
      decision: 'ACCEPT_SET',
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: currentStatRollAttempt(current.statRollStage!)!.returnDecisionFormId,
      stage: 'STAT_ROLLS',
      wizardCheckpointId,
    }),
    `${prefix}-accept-receipt`,
  );
  current = commitCreationWizardCheckpoint(
    database,
    {
      commandId: `${prefix}-assignment-command`,
      commandKind: 'workflow-command',
      expectedRevisions: currentCreationWizardRevisions(current),
      messageType: 'command.request',
      payload: {
        characterDraftId,
        draftRevision: current.receipt.result.draftRevision,
        setEntryIndexByStat: IDENTITY_INDEX_MAP,
        sourceFormId: 'CHR-009',
        stage: 'STAT_ASSIGNMENT',
        wizardCheckpointId,
      },
      protocolVersion: WIRE_PROTOCOL_VERSION,
      role: 'player',
      workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
    },
    `${prefix}-assignment-receipt`,
    catalog,
  );
  commitCreationWizardCheckpoint(
    database,
    {
      commandId: `${prefix}-eligibility-command`,
      commandKind: 'workflow-command',
      expectedRevisions: currentCreationWizardRevisions(current),
      messageType: 'command.request',
      payload: {
        characterDraftId,
        draftRevision: current.receipt.result.draftRevision,
        sourceFormId: 'CHR-012',
        stage: 'SKILLS',
        wizardCheckpointId,
      },
      protocolVersion: WIRE_PROTOCOL_VERSION,
      role: 'player',
      workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
    },
    `${prefix}-eligibility-receipt`,
    catalog,
  );
  current = advanceCreationSkillSelectionProjection(
    database,
    characterDraftId,
    wizardCheckpointId,
    catalog.skillStage,
  );
  const selectionRequest: WorkflowRequest = {
    commandId: `${prefix}-selection-command`,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      selectedSkills: exactSelectedSkills(current),
      sourceFormId: 'CHR-015',
      stage: 'SKILLS',
      wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  };
  current = commitCreationWizardCheckpoint(
    database,
    selectionRequest,
    `${prefix}-selection-receipt`,
    catalog,
    () => `${prefix}-random-sequence`,
  );
  expect(current.nextStageEnvelope.formId).toBe('CHR-017');
  expect(current.randomSymbiontStage?.rollRecords).toEqual([]);
  return {
    characterDraftId,
    checkpoint: current,
    database,
    deviceId,
    selectionRequest,
    wizardCheckpointId,
  };
}

async function createRandomHost(
  setup: CommittedRandomSetup,
  sampleFaces: readonly number[],
  namespace = 'live',
  options: {
    readonly onSample?: (count: number) => void;
    readonly rollRequestIdForCount?: (count: number) => string;
  } = {},
): Promise<RandomHost> {
  const runtime = revisionRuntime();
  let receiptAllocations = 0;
  let rollRequestAllocations = 0;
  let sampleCalls = 0;
  const app = await createHost({
    advanceRevisions: runtime.advance,
    allocateCreationBranchUuid: () => `${setup.selectionRequest.commandId}-${namespace}-branch`,
    allocateCreationRollRequestId: () => {
      rollRequestAllocations += 1;
      return (
        options.rollRequestIdForCount?.(rollRequestAllocations) ??
        `${setup.selectionRequest.commandId}-${namespace}-roll-request-${String(rollRequestAllocations)}`
      );
    },
    allocateContextId: () => '10000000-0000-4000-8000-000000000001',
    allocateLocalCharacterId: () => '20000000-0000-4000-8000-000000000001',
    allocateReceiptId: () =>
      `${setup.selectionRequest.commandId}-${namespace}-receipt-${String(++receiptAllocations)}`,
    allocateWizardCheckpointId: () => `${setup.selectionRequest.commandId}-${namespace}-wizard`,
    database: setup.database,
    onFrameError: (error) => {
      throw error;
    },
    projectRoot: PROJECT_ROOT,
    readRevisions: runtime.read,
    sampleCreationD20: () => {
      sampleCalls += 1;
      options.onSample?.(sampleCalls);
      return sampleFaces[sampleCalls - 1] ?? 10;
    },
    staticRoot,
  });
  apps.push(app);
  await startHost(app, { interface: '127.0.0.1', port: 0 });
  const socket = await openSocket(app);
  return {
    ...setup,
    app,
    prefix: namespace,
    receiptAllocations: () => receiptAllocations,
    rollRequestAllocations: () => rollRequestAllocations,
    runtime,
    sampleCalls: () => sampleCalls,
    socket,
  };
}

async function stopRandomHost(host: RandomHost): Promise<void> {
  host.socket.terminate();
  await host.app.close();
  const index = apps.indexOf(host.app);
  if (index >= 0) apps.splice(index, 1);
}

function loadCurrent(host: RandomHost): DurableCreationWizardCheckpoint {
  return loadCreationWizardCheckpoint(
    host.database,
    host.characterDraftId,
    catalog.skillStage,
    catalog,
  );
}

function randomRollRequest(
  host: RandomHost,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  manualFaceOrNull: number | null,
  selectedMonsterSpeciesKeyOrNull: 'CHIMERA' | 'PUPPETEER' | 'PLAGUE_DOCTOR' | null = null,
): WorkflowRequest {
  const stage = current.randomSymbiontStage;
  if (stage === null) throw new Error('random stage is missing');
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      characterDraftId: host.characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      manualFaceOrNull,
      pendingRollRequestIdOrNull: stage.pendingRollRequestOrNull?.rollRequestId ?? null,
      randomSequenceId: stage.randomSequenceId,
      selectedMonsterSpeciesKeyOrNull,
      sourceFormId: 'CHR-020',
      stage: 'SYMBIONTS',
      variant: 'ROLL',
      wizardCheckpointId: host.wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  };
}

async function commitRoll(
  host: RandomHost,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  manualFaceOrNull: number | null,
  selectedMonsterSpeciesKeyOrNull: 'CHIMERA' | 'PUPPETEER' | 'PLAGUE_DOCTOR' | null = null,
): Promise<RandomCommandOutcome> {
  const request = randomRollRequest(
    host,
    current,
    commandId,
    manualFaceOrNull,
    selectedMonsterSpeciesKeyOrNull,
  );
  const [terminal, destination] = await sendCommand(host.socket, request);
  return {
    checkpoint: loadCurrent(host),
    destination,
    request,
    result: committedResult(terminal),
  };
}

function bindingRequest(
  host: RandomHost,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  selectedBindings: readonly {
    readonly speciesKey: 'OWL' | 'EEL';
    readonly side: 'LEFT' | 'RIGHT';
  }[],
): WorkflowRequest {
  const stage = current.randomSymbiontStage;
  if (stage === null) throw new Error('random stage is missing');
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      characterDraftId: host.characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      physicalRollReceiptIds: stage.rollRecords.map((record) => record.physicalRoll.rollReceiptId),
      randomSequenceId: stage.randomSequenceId,
      selectedBindings,
      sourceFormId: 'CHR-020',
      stage: 'SYMBIONTS',
      variant: 'BINDING',
      wizardCheckpointId: host.wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  };
}

async function commitBinding(
  host: RandomHost,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  selectedBindings: readonly {
    readonly speciesKey: 'OWL' | 'EEL';
    readonly side: 'LEFT' | 'RIGHT';
  }[] = [],
): Promise<RandomCommandOutcome> {
  const request = bindingRequest(host, current, commandId, selectedBindings);
  const [terminal, destination] = await sendCommand(host.socket, request);
  return {
    checkpoint: loadCurrent(host),
    destination,
    request,
    result: committedResult(terminal),
  };
}

function advisorRequest(
  host: RandomHost,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  selectedSkills: readonly SelectedSkillCommandInput[],
): WorkflowRequest {
  const stage = current.randomSymbiontStage;
  if (stage?.advisorInstanceDraftIdOrNull == null) throw new Error('Advisor identity is missing');
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      advisorInstanceDraftId: stage.advisorInstanceDraftIdOrNull,
      characterDraftId: host.characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      randomSequenceId: stage.randomSequenceId,
      selectedSkills,
      sourceFormId: 'CHR-041',
      stage: 'SYMBIONTS',
      wizardCheckpointId: host.wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  };
}

async function commitAdvisor(
  host: RandomHost,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  selectedSkills: readonly SelectedSkillCommandInput[],
): Promise<RandomCommandOutcome> {
  const request = advisorRequest(host, current, commandId, selectedSkills);
  const [terminal, destination] = await sendCommand(host.socket, request);
  return {
    checkpoint: loadCurrent(host),
    destination,
    request,
    result: committedResult(terminal),
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function advisorSelectionFromProjection(
  destination: Snapshot,
): readonly SelectedSkillCommandInput[] {
  const slots = recordValue(
    destination.presentation.base.roleFilteredPayload['advisorSlotsAndSkills'],
  );
  if (slots === null) throw new Error('Advisor slots projection is missing');
  const required = slots['requiredSlotCount'];
  const options = slots['skillOptions'];
  if (typeof required !== 'number' || !Array.isArray(options)) {
    throw new Error('Advisor skill options are malformed');
  }
  let remaining = required;
  const selected: SelectedSkillCommandInput[] = [];
  for (const candidateValue of options) {
    const candidate = recordValue(candidateValue);
    if (candidate === null) continue;
    const skillId = candidate['skillId'];
    const levels = candidate['levelOptions'];
    if (typeof skillId !== 'string' || !Array.isArray(levels)) continue;
    let level: Record<string, unknown> | undefined;
    for (const entry of levels) {
      const option = recordValue(entry);
      const slotCost = option?.['slotCost'];
      if (option !== null && typeof slotCost === 'number' && slotCost <= remaining) level = option;
    }
    const targetBonus = level?.['targetBonus'];
    const slotCost = level?.['slotCost'];
    if (typeof targetBonus !== 'number' || typeof slotCost !== 'number') continue;
    selected.push({ skillId, targetBonus });
    remaining -= slotCost;
    if (remaining === 0) break;
  }
  if (remaining !== 0) throw new Error('Advisor projection could not fill exact slots');
  return selected;
}

function expectPlayerSafe(destination: Snapshot, formId: string): void {
  expect(destination.presentation.base.formId).toBe(formId);
  const encoded = JSON.stringify(destination.presentation.base.roleFilteredPayload);
  expect(encoded).not.toMatch(
    /SKL-|CORE-|REQ-|Q-|EFFECTIVE_STATS|effectiveStats|rngState|sampler/iu,
  );
  expect(encoded).not.toContain('branchCacheHash');
  expect(encoded).not.toContain('branchUuid');
}

function expectPayloadCorruption(
  checkpoint: DurableCreationWizardCheckpoint,
  label: string,
  mutate: (payload: Record<string, unknown>) => void,
): void {
  const payload = structuredClone(checkpoint.durablePayload) as unknown as Record<string, unknown>;
  mutate(payload);
  expect(
    () =>
      validateDurableCreationWizardCheckpoint(
        { ...checkpoint.localCharacter, payloadJson: JSON.stringify(payload) },
        checkpoint.checkpoint,
        catalog.skillStage,
        catalog,
      ),
    label,
  ).toThrow();
}

async function startRandomSequence(
  host: RandomHost,
  current: DurableCreationWizardCheckpoint,
  requestId: string,
): Promise<{
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly destination: Snapshot;
}> {
  const destination = snapshot(
    await sendV2(
      host.socket,
      formAction(
        requestId,
        'CHR-017',
        'CHR-017::CTA::003',
        currentCreationWizardRevisions(current).projectionRevision,
      ),
    ),
  );
  return { checkpoint: loadCurrent(host), destination };
}

beforeAll(async () => {
  staticRoot = await mkdtemp(join(tmpdir(), 'symbiosis-random-host-'));
  await writeFile(join(staticRoot, 'index.html'), '<main>random symbionts</main>', 'utf8');
  catalog = await loadSymbiontCatalog(PROJECT_ROOT);
  vocabulary = await loadProtocolVocabulary(PROJECT_ROOT);
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const app of apps.splice(0)) await app.close();
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true, maxRetries: 5, retryDelay: 20 });
  }
});

afterAll(async () => {
  await rm(staticRoot, { force: true, recursive: true });
});

describe('RANDOM symbiont host journey', () => {
  it('commits FREE AUTO through EEL binding with replay, refresh, and restart recovery', async () => {
    const setup = setupCommittedRandom('free-auto', 'FREE', 'AUTO');
    const host = await createRandomHost(setup, [15]);
    const initial = await reconnectOn(host.socket, host, 'free-auto-initial', [
      setup.selectionRequest.commandId,
    ]);
    expect(hostMessage(initial[0] ?? '')).toMatchObject({
      lifecycleState: 'IDEMPOTENT_REPLAY',
      receipt: setup.checkpoint.receipt,
    });
    const chr017 = snapshot(hostMessageV2(initial[2] ?? ''));
    expectPlayerSafe(chr017, 'CHR-017');
    expect(chr017.presentation.base).toMatchObject({
      availableActionKeys: ['CHR-017::CTA::003'],
      roleFilteredPayload: {
        characterDraftId: setup.characterDraftId,
        raceChoice: 'FREE',
        symbiontAcquisitionModeOrNull: 'RANDOM',
      },
    });

    const beforeStart = loadCurrent(host);
    const started = await startRandomSequence(host, beforeStart, 'free-auto-start');
    expectPlayerSafe(started.destination, 'CHR-020');
    expect(started.destination.presentation.base).toMatchObject({
      availableActionKeys: ['CHR-020::CTA::002'],
      roleFilteredPayload: {
        pendingRollRequestIdOrNull: null,
        randomSequenceId: 'free-auto-random-sequence',
        randomStatus: 'NOT_STARTED',
      },
    });
    expect(started.destination.revisions).toEqual({
      ...currentCreationWizardRevisions(beforeStart),
      projectionRevision: currentCreationWizardRevisions(beforeStart).projectionRevision + 1,
    });
    expect(started.checkpoint.randomSymbiontStage).toEqual(beforeStart.randomSymbiontStage);
    expect(started.checkpoint.checkpoint.checkpointRevision).toBe(
      beforeStart.checkpoint.checkpointRevision,
    );
    expect(started.checkpoint.receipt.result.draftRevision).toBe(
      beforeStart.receipt.result.draftRevision,
    );
    expect(host.receiptAllocations()).toBe(0);
    expect(host.rollRequestAllocations()).toBe(0);
    expect(host.sampleCalls()).toBe(0);

    const beforeExcluded = loadCurrent(host);
    for (const [sourceFormId, actionKey] of [
      ['CHR-020', 'CHR-020::CTA::001'],
      ['CHR-017', 'CHR-017::CTA::002'],
      ['CHR-018', 'CHR-018::CTA::001'],
      ['CHR-021', 'CHR-021::CTA::001'],
    ] as const) {
      const refusal = await sendV2(
        host.socket,
        formAction(
          `free-auto-excluded-${actionKey}`,
          sourceFormId,
          actionKey,
          currentCreationWizardRevisions(started.checkpoint).projectionRevision,
        ),
      );
      expect(refusal).toMatchObject({
        messageType: 'navigation.form-action.refusal',
        presentationUnchanged: true,
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
      });
    }
    expect(loadCurrent(host)).toEqual(beforeExcluded);
    expect(host.receiptAllocations()).toBe(0);
    expect(host.sampleCalls()).toBe(0);

    const limitedSocket = await openSocket(host.app);
    const limitedFrames = await reconnectOn(
      limitedSocket,
      host,
      'free-auto-without-roll',
      [],
      WITHOUT_ROLL_COMMIT,
    );
    const limited = snapshot(hostMessageV2(limitedFrames[1] ?? ''));
    expect(limited.presentation.base.formId).toBe('CHR-020');
    expect(limited.presentation.base.availableActionKeys).not.toContain('CHR-020::CTA::002');
    const forged = randomRollRequest(host, started.checkpoint, 'free-auto-forged-roll', null);
    const refusal = await sendCommandRefusal(limitedSocket, forged);
    expect(refusal).toMatchObject({
      commandId: forged.commandId,
      messageType: 'command.refusal',
      refusal: { code: 'GUARD_REJECTED' },
    });
    expect(loadCurrent(host)).toEqual(started.checkpoint);
    expect(host.receiptAllocations()).toBe(0);
    expect(host.sampleCalls()).toBe(0);

    const rolled = await commitRoll(host, started.checkpoint, 'free-auto-eel-roll', null);
    expect(rolled.result.receipt).toMatchObject({
      result: {
        nextFormId: 'CHR-020',
        randomStatus: 'BINDING',
        variant: 'ROLL',
        physicalRoll: { kind: 'SPECIES_ORIGIN', mechanical: { dieSides: 20, rawFace: 15 } },
      },
    });
    expectPlayerSafe(rolled.destination, 'CHR-020');
    expect(rolled.destination.presentation.base.roleFilteredPayload).toMatchObject({
      drawnSpeciesAndBindings: [
        { acceptedIndex: 0, speciesKey: 'EEL', binding: { kind: 'EEL_ARM', side: 'RIGHT' } },
      ],
      randomStatus: 'BINDING',
    });
    expect(rolled.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull).toBeNull();
    expect(host.sampleCalls()).toBe(1);
    expect(host.receiptAllocations()).toBe(1);

    const replay = await sendCommand(host.socket, rolled.request);
    expect(replay[0]).toMatchObject({
      lifecycleState: 'IDEMPOTENT_REPLAY',
      receipt: rolled.result.receipt,
    });
    expectPlayerSafe(replay[1], 'CHR-020');
    expect(host.receiptAllocations()).toBe(1);
    expect(host.sampleCalls()).toBe(1);

    const refreshSocket = await openSocket(host.app);
    const refreshedFrames = await reconnectOn(refreshSocket, host, 'free-auto-refresh');
    const refreshed = snapshot(hostMessageV2(refreshedFrames[1] ?? ''));
    expectPlayerSafe(refreshed, 'CHR-020');
    expect(refreshed.revisions).toEqual(rolled.result.receipt.revisions);
    expect(refreshed.presentation.base.roleFilteredPayload).toMatchObject({
      randomStatus: 'BINDING',
      commandId: rolled.request.commandId,
    });

    const samplesBeforeBinding = host.sampleCalls();
    const bound = await commitBinding(host, rolled.checkpoint, 'free-auto-eel-binding', [
      { speciesKey: 'EEL', side: 'LEFT' },
    ]);
    expect(host.sampleCalls()).toBe(samplesBeforeBinding);
    expect(bound.result.receipt).toMatchObject({
      result: {
        advisorBranch: false,
        nextFormId: 'CHR-019',
        randomStatus: 'COMMITTED',
        variant: 'BINDING',
      },
    });
    expectPlayerSafe(bound.destination, 'CHR-019');
    expect(bound.destination.presentation.base).toMatchObject({
      availableActionKeys: [],
      roleFilteredPayload: {
        compositionValidation: 'VALID',
        irreversibleBoundaryStatus: 'CROSSED',
        speciesKeys: ['EEL'],
        bindings: [
          { acceptedIndex: 0, speciesKey: 'EEL', binding: { kind: 'EEL_ARM', side: 'LEFT' } },
        ],
      },
    });

    const recoveredSocket = await openSocket(host.app);
    const recoveredFrames = await reconnectOn(recoveredSocket, host, 'free-auto-new-socket');
    expectPlayerSafe(snapshot(hostMessageV2(recoveredFrames[1] ?? '')), 'CHR-019');

    await stopRandomHost(host);
    const restarted = await createRandomHost(setup, [], 'restart');
    const restartedFrames = await reconnectOn(restarted.socket, restarted, 'free-auto-restart', [
      bound.request.commandId,
    ]);
    expect(hostMessage(restartedFrames[0] ?? '')).toMatchObject({
      lifecycleState: 'IDEMPOTENT_REPLAY',
      receipt: bound.result.receipt,
    });
    expectPlayerSafe(snapshot(hostMessageV2(restartedFrames[2] ?? '')), 'CHR-019');
    const durableReplay = await sendCommand(restarted.socket, bound.request);
    expect(durableReplay[0]).toMatchObject({
      lifecycleState: 'IDEMPOTENT_REPLAY',
      receipt: bound.result.receipt,
    });
    expectPlayerSafe(durableReplay[1], 'CHR-019');
    expect(restarted.receiptAllocations()).toBe(0);
    expect(restarted.sampleCalls()).toBe(0);
  });
});

describe('RANDOM critical host recovery', () => {
  it('persists duplicates and a later critical chain through a mid-sequence restart', async () => {
    const setup = setupCommittedRandom('united-critical', 'UNITED', 'AUTO');
    const host = await createRandomHost(setup, [2, 2, 20, 15]);
    await reconnectOn(host.socket, host, 'united-critical-initial', [
      setup.selectionRequest.commandId,
    ]);
    let current = (await startRandomSequence(host, setup.checkpoint, 'united-critical-start'))
      .checkpoint;

    const first = await commitRoll(host, current, 'united-critical-origin-1', null);
    const firstPending = first.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull;
    expect(firstPending).toMatchObject({ kind: 'SPECIES_ORIGIN' });
    expect(firstPending?.rollRequestId).toEqual(expect.any(String));
    current = first.checkpoint;

    const duplicate = await commitRoll(host, current, 'united-critical-duplicate', null);
    expect(duplicate.request.payload).toMatchObject({
      pendingRollRequestIdOrNull: firstPending?.rollRequestId,
    });
    expect(duplicate.checkpoint.randomSymbiontStage?.rollRecords[1]?.physicalRoll).toMatchObject({
      rollRequestId: firstPending?.rollRequestId,
      mechanical: { rawFace: 2 },
    });
    expect(duplicate.destination.presentation.base.roleFilteredPayload).toMatchObject({
      duplicateRerollReceipts: [
        {
          rollReceiptId: duplicate.result.receipt.receiptId,
          speciesKey: 'TAIPAN',
          duplicateOfAcceptedIndex: 0,
        },
      ],
      randomStatus: 'PENDING',
    });
    current = duplicate.checkpoint;

    const criticalOrigin = await commitRoll(host, current, 'united-critical-origin-20', null);
    expect(criticalOrigin.destination.presentation.base).toMatchObject({
      availableActionKeys: ['CHR-020::CTA::002'],
      roleFilteredPayload: { randomStatus: 'PENDING' },
    });
    expect(criticalOrigin.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull).toMatchObject({
      kind: 'CRITICAL_CONFIRMATION',
      originRollRequestIdOrNull:
        criticalOrigin.checkpoint.randomSymbiontStage?.rollRecords[2]?.physicalRoll.rollRequestId,
    });
    current = criticalOrigin.checkpoint;

    const criticalSuccess = await commitRoll(host, current, 'united-critical-confirm-15', null);
    expect(criticalSuccess.result.receipt.result).toMatchObject({
      physicalRoll: {
        kind: 'CRITICAL_CONFIRMATION',
        selectedMonsterSpeciesKeyOrNull: null,
        mechanical: { rawFace: 15 },
      },
      randomStatus: 'PENDING',
    });
    expect(criticalSuccess.checkpoint.randomSymbiontStage?.rollRecords).toHaveLength(4);
    expect(criticalSuccess.checkpoint.randomSymbiontStage?.bindingRecordOrNull).toBeNull();

    await stopRandomHost(host);
    const restarted = await createRandomHost(setup, [14, 3, 4], 'critical-restart');
    const recoveredFrames = await reconnectOn(
      restarted.socket,
      restarted,
      'united-critical-restart',
      [criticalSuccess.request.commandId],
    );
    expect(hostMessage(recoveredFrames[0] ?? '')).toMatchObject({
      lifecycleState: 'IDEMPOTENT_REPLAY',
      receipt: criticalSuccess.result.receipt,
    });
    const recovered = snapshot(hostMessageV2(recoveredFrames[2] ?? ''));
    expectPlayerSafe(recovered, 'CHR-020');
    expect(recovered.presentation.base.roleFilteredPayload).toMatchObject({
      pendingRollRequestIdOrNull:
        criticalSuccess.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull?.rollRequestId,
      randomStatus: 'PENDING',
    });

    const criticalMiss = await commitRoll(
      restarted,
      loadCurrent(restarted),
      'united-critical-confirm-14',
      null,
    );
    expect(criticalMiss.result.receipt.result).toMatchObject({
      physicalRoll: {
        kind: 'CRITICAL_CONFIRMATION',
        selectedMonsterSpeciesKeyOrNull: null,
        mechanical: { rawFace: 14 },
      },
    });
    expect(criticalMiss.destination.presentation.base.roleFilteredPayload).toMatchObject({
      drawnSpeciesAndBindings: [
        { acceptedIndex: 0, speciesKey: 'TAIPAN' },
        { acceptedIndex: 1, speciesKey: 'SKUNK' },
      ],
    });

    const owl = await commitRoll(restarted, criticalMiss.checkpoint, 'united-critical-owl', null);
    const teacher = await commitRoll(restarted, owl.checkpoint, 'united-critical-teacher', null);
    expect(teacher.checkpoint.randomSymbiontStage?.rollRecords).toHaveLength(7);
    expect(teacher.destination.presentation.base.roleFilteredPayload).toMatchObject({
      randomStatus: 'BINDING',
      duplicateRerollReceipts: [{ speciesKey: 'TAIPAN' }],
    });
    const requestIds = teacher.checkpoint.randomSymbiontStage?.rollRecords.map(
      (record) => record.physicalRoll.rollRequestId,
    );
    expect(new Set(requestIds).size).toBe(7);

    const samplesBeforeBinding = restarted.sampleCalls();
    const bound = await commitBinding(restarted, teacher.checkpoint, 'united-critical-binding', [
      { speciesKey: 'OWL', side: 'LEFT' },
    ]);
    expect(restarted.sampleCalls()).toBe(samplesBeforeBinding);
    expectPlayerSafe(bound.destination, 'CHR-019');
    expect(bound.destination.presentation.base.roleFilteredPayload).toMatchObject({
      speciesKeys: ['TAIPAN', 'SKUNK', 'OWL', 'TEACHER'],
      duplicatePolicy: {
        kind: 'REROLL_WITH_SEPARATE_RECEIPTS',
        receipts: [{ speciesKey: 'TAIPAN', duplicateOfAcceptedIndex: 0 }],
      },
      bindings: [
        { acceptedIndex: 0, speciesKey: 'TAIPAN', binding: { kind: 'NONE' } },
        { acceptedIndex: 1, speciesKey: 'SKUNK', binding: { kind: 'NONE' } },
        { acceptedIndex: 2, speciesKey: 'OWL', binding: { kind: 'OWL_EYE', side: 'LEFT' } },
        { acceptedIndex: 3, speciesKey: 'TEACHER', binding: { kind: 'NONE' } },
      ],
    });
    const randomReceiptIds = bound.checkpoint.durablePayload.randomReceiptIds;
    for (const record of bound.checkpoint.randomSymbiontStage?.rollRecords ?? []) {
      expect(randomReceiptIds).toContain(record.receipt.receiptId);
    }
  });

  it('stops a first UNITED critical at the selected monster without another origin roll', async () => {
    const setup = setupCommittedRandom('united-monster', 'UNITED', 'AUTO');
    const host = await createRandomHost(setup, [20, 15, 14]);
    await reconnectOn(host.socket, host, 'united-monster-initial', [
      setup.selectionRequest.commandId,
    ]);
    const started = await startRandomSequence(host, setup.checkpoint, 'united-monster-start');
    const origin = await commitRoll(host, started.checkpoint, 'united-monster-origin', null);
    expect(origin.destination.presentation.base.availableActionKeys).toContain('CHR-020::CTA::004');
    expect(origin.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull).toMatchObject({
      kind: 'CRITICAL_CONFIRMATION',
    });

    const intermediate = await commitRoll(
      host,
      origin.checkpoint,
      'united-monster-confirm-15',
      null,
      'CHIMERA',
    );
    expect(intermediate.checkpoint.randomSymbiontStage?.rollRecords[1]?.physicalRoll).toMatchObject(
      {
        kind: 'CRITICAL_CONFIRMATION',
        selectedMonsterSpeciesKeyOrNull: null,
        mechanical: { rawFace: 15 },
      },
    );
    expect(intermediate.checkpoint.randomSymbiontStage?.bindingRecordOrNull).toBeNull();

    const terminal = await commitRoll(
      host,
      intermediate.checkpoint,
      'united-monster-confirm-14',
      null,
      'CHIMERA',
    );
    expect(terminal.checkpoint.randomSymbiontStage?.rollRecords[2]?.physicalRoll).toMatchObject({
      kind: 'CRITICAL_CONFIRMATION',
      selectedMonsterSpeciesKeyOrNull: 'CHIMERA',
      mechanical: { rawFace: 14 },
    });
    expect(terminal.destination.presentation.base.roleFilteredPayload).toMatchObject({
      randomStatus: 'BINDING',
      drawnSpeciesAndBindings: [{ acceptedIndex: 0, speciesKey: 'CHIMERA' }],
    });
    expect(host.sampleCalls()).toBe(3);

    const bound = await commitBinding(host, terminal.checkpoint, 'united-monster-binding');
    expect(host.sampleCalls()).toBe(3);
    expectPlayerSafe(bound.destination, 'CHR-019');
    expect(bound.destination.presentation.base.roleFilteredPayload).toMatchObject({
      speciesKeys: ['CHIMERA'],
      slotUsageAndCapacity: { used: 4, capacity: 4 },
      symbiontInstancesDraft: [{ acceptedIndex: 0, speciesKey: 'CHIMERA', slotCost: 4 }],
    });
    expect(bound.checkpoint.randomSymbiontStage?.rollRecords).toHaveLength(3);
  });

  it('keeps an unconfirmed first FREE critical ordinary and forbids a monster choice', async () => {
    const setup = setupCommittedRandom('free-unconfirmed', 'FREE', 'AUTO');
    const host = await createRandomHost(setup, [20, 14]);
    await reconnectOn(host.socket, host, 'free-unconfirmed-initial', [
      setup.selectionRequest.commandId,
    ]);
    const started = await startRandomSequence(host, setup.checkpoint, 'free-unconfirmed-start');
    const origin = await commitRoll(host, started.checkpoint, 'free-unconfirmed-origin', null);
    expect(origin.destination.presentation.base.availableActionKeys).not.toContain(
      'CHR-020::CTA::004',
    );

    const beforeForged = loadCurrent(host);
    const forged = randomRollRequest(
      host,
      origin.checkpoint,
      'free-unconfirmed-forged-monster',
      null,
      'CHIMERA',
    );
    const refusal = await sendCommandRefusal(host.socket, forged);
    expect(refusal).toMatchObject({
      messageType: 'command.refusal',
      refusal: { code: 'GUARD_REJECTED' },
    });
    expect(loadCurrent(host)).toEqual(beforeForged);
    expect(host.sampleCalls()).toBe(1);

    const confirmed = await commitRoll(host, origin.checkpoint, 'free-unconfirmed-confirm', null);
    expect(confirmed.result.receipt.result).toMatchObject({
      physicalRoll: {
        kind: 'CRITICAL_CONFIRMATION',
        selectedMonsterSpeciesKeyOrNull: null,
        mechanical: { rawFace: 14 },
      },
      randomStatus: 'BINDING',
    });
    const bound = await commitBinding(host, confirmed.checkpoint, 'free-unconfirmed-binding');
    expectPlayerSafe(bound.destination, 'CHR-019');
    expect(bound.destination.presentation.base.roleFilteredPayload).toMatchObject({
      speciesKeys: ['SKUNK'],
      slotUsageAndCapacity: { used: 1, capacity: 1 },
    });
  });
});

describe('RANDOM Advisor host journey', () => {
  it('commits Advisor I/W and exact skills without RNG in MANUAL mode', async () => {
    const setup = setupCommittedRandom('free-advisor', 'FREE', 'MANUAL');
    const host = await createRandomHost(setup, []);
    await reconnectOn(host.socket, host, 'free-advisor-initial', [
      setup.selectionRequest.commandId,
    ]);
    const started = await startRandomSequence(host, setup.checkpoint, 'free-advisor-start');

    const origin = await commitRoll(host, started.checkpoint, 'free-advisor-origin', 9);
    expect(origin.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull).toMatchObject({
      kind: 'ADVISOR_I',
      advisorAcceptedIndexOrNull: 0,
    });
    expect(origin.checkpoint.randomSymbiontStage?.advisorInstanceDraftIdOrNull).toEqual(
      expect.any(String),
    );
    const advisorI = await commitRoll(host, origin.checkpoint, 'free-advisor-i', 1);
    expect(advisorI.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull).toMatchObject({
      kind: 'ADVISOR_W',
      advisorAcceptedIndexOrNull: 0,
    });
    expect(advisorI.destination.presentation.base.roleFilteredPayload).toMatchObject({
      randomStatus: 'PENDING',
    });

    const advisorW = await commitRoll(host, advisorI.checkpoint, 'free-advisor-w', 20);
    const advisorIRecord = advisorW.checkpoint.randomSymbiontStage?.rollRecords[1];
    const advisorWRecord = advisorW.checkpoint.randomSymbiontStage?.rollRecords[2];
    expect(advisorW.destination.presentation.base.roleFilteredPayload).toMatchObject({
      advisorBranch: true,
      randomStatus: 'BINDING',
    });
    expect(advisorIRecord?.physicalRoll).toMatchObject({
      kind: 'ADVISOR_I',
      mechanical: { rawFace: 1 },
    });
    expect(advisorWRecord?.physicalRoll).toMatchObject({
      kind: 'ADVISOR_W',
      mechanical: { rawFace: 20 },
    });

    const bound = await commitBinding(host, advisorW.checkpoint, 'free-advisor-binding');
    expectPlayerSafe(bound.destination, 'CHR-041');
    expect(bound.destination.presentation.base).toMatchObject({
      availableActionKeys: ['CHR-041::CTA::001', 'CHR-041::CTA::002'],
      roleFilteredPayload: {
        acknowledged: false,
        advisorCard: { speciesKey: 'ADVISER', effectsActive: true },
        advisorIPlus8OrNull: 9,
        advisorWPlus8OrNull: 28,
        iwRollRequestIds: [
          advisorIRecord?.physicalRoll.rollRequestId,
          advisorWRecord?.physicalRoll.rollRequestId,
        ],
        iwRollReceiptIds: [advisorIRecord?.receipt.receiptId, advisorWRecord?.receipt.receiptId],
        trogrSuppressionState: { kind: 'NOT_SUPPRESSED' },
        advisorSlotsAndSkills: {
          selectionValidation: { kind: 'UNDERFILLED' },
        },
      },
    });
    expect(resultRevision(bound.result, 'draftRevision')).toBe(
      resultRevision(advisorW.result, 'draftRevision') + 1,
    );
    const selectedSkills = advisorSelectionFromProjection(bound.destination);
    expect(selectedSkills.length).toBeGreaterThan(0);
    expect(host.sampleCalls()).toBe(0);

    const limitedSocket = await openSocket(host.app);
    const limitedFrames = await reconnectOn(
      limitedSocket,
      host,
      'free-advisor-without-checkpoint',
      [],
      WITHOUT_WIZARD_CHECKPOINT,
    );
    const limited = snapshot(hostMessageV2(limitedFrames[1] ?? ''));
    expect(limited.presentation.base).toMatchObject({
      formId: 'CHR-041',
      availableActionKeys: ['CHR-041::CTA::002'],
    });
    const forged = advisorRequest(
      host,
      bound.checkpoint,
      'free-advisor-forged-checkpoint',
      selectedSkills,
    );
    const refusal = await sendCommandRefusal(limitedSocket, forged);
    expect(refusal).toMatchObject({
      messageType: 'command.refusal',
      refusal: { code: 'GUARD_REJECTED' },
    });
    expect(loadCurrent(host)).toEqual(bound.checkpoint);

    const underfilled = advisorRequest(host, bound.checkpoint, 'free-advisor-underfilled', []);
    const underfilledRefusal = await sendCommandRefusal(host.socket, underfilled);
    expect(underfilledRefusal).toMatchObject({
      messageType: 'command.refusal',
      refusal: { code: 'GUARD_REJECTED' },
    });
    expect(loadCurrent(host)).toEqual(bound.checkpoint);

    const advisor = await commitAdvisor(
      host,
      bound.checkpoint,
      'free-advisor-checkpoint',
      selectedSkills,
    );
    expectPlayerSafe(advisor.destination, 'CHR-019');
    expect(resultRevision(advisor.result, 'usedSlotCount')).toBe(
      resultRevision(advisor.result, 'requiredSlotCount'),
    );
    expect(advisor.result.receipt.result).toMatchObject({
      advisorInstanceDraftId: bound.checkpoint.randomSymbiontStage?.advisorInstanceDraftIdOrNull,
      effectsActive: true,
      nextFormId: 'CHR-019',
      selectedSkills,
      stage: 'SYMBIONTS',
    });
    expect(advisor.result.receipt.result['learnedSkills']).toHaveLength(selectedSkills.length);
    expect(advisor.checkpoint.randomSymbiontStage?.advisorSkillRecordOrNull).toMatchObject({
      selectedSkills,
      nextStageEnvelope: { formId: 'CHR-019' },
    });
    expect(host.sampleCalls()).toBe(0);

    await stopRandomHost(host);
    const restarted = await createRandomHost(setup, [], 'advisor-restart');
    const recoveredFrames = await reconnectOn(restarted.socket, restarted, 'free-advisor-restart', [
      advisor.request.commandId,
    ]);
    expect(hostMessage(recoveredFrames[0] ?? '')).toMatchObject({
      lifecycleState: 'IDEMPOTENT_REPLAY',
      receipt: advisor.result.receipt,
    });
    expectPlayerSafe(snapshot(hostMessageV2(recoveredFrames[2] ?? '')), 'CHR-019');
    expect(restarted.receiptAllocations()).toBe(0);
    expect(restarted.sampleCalls()).toBe(0);
  });

  it('persists Trogr suppression B and projects Advisor modifiers as inactive', async () => {
    const setup = setupCommittedRandom('united-suppression', 'UNITED', 'MANUAL');
    const host = await createRandomHost(setup, []);
    await reconnectOn(host.socket, host, 'united-suppression-initial', [
      setup.selectionRequest.commandId,
    ]);
    let current = (await startRandomSequence(host, setup.checkpoint, 'united-suppression-start'))
      .checkpoint;

    const trogr = await commitRoll(host, current, 'united-suppression-trogr', 7);
    const origin = await commitRoll(host, trogr.checkpoint, 'united-suppression-advisor', 9);
    const advisorI = await commitRoll(host, origin.checkpoint, 'united-suppression-i', 8);
    const advisorW = await commitRoll(host, advisorI.checkpoint, 'united-suppression-w', 8);
    expect(advisorW.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull).toMatchObject({
      kind: 'TROGR_SUPPRESSION_B',
      advisorAcceptedIndexOrNull: 1,
    });

    const suppression = await commitRoll(host, advisorW.checkpoint, 'united-suppression-b', 2);
    expect(suppression.checkpoint.randomSymbiontStage?.rollRecords[4]?.physicalRoll).toMatchObject({
      kind: 'TROGR_SUPPRESSION_B',
      advisorAcceptedIndex: 1,
      mechanical: { rawFace: 2 },
    });
    expect(suppression.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull).toMatchObject({
      kind: 'SPECIES_ORIGIN',
    });
    const taipan = await commitRoll(host, suppression.checkpoint, 'united-suppression-taipan', 2);
    const owl = await commitRoll(host, taipan.checkpoint, 'united-suppression-owl', 3);
    expect(owl.destination.presentation.base.roleFilteredPayload).toMatchObject({
      advisorBranch: true,
      randomStatus: 'BINDING',
    });

    const bound = await commitBinding(host, owl.checkpoint, 'united-suppression-binding', [
      { speciesKey: 'OWL', side: 'RIGHT' },
    ]);
    expectPlayerSafe(bound.destination, 'CHR-041');
    expect(bound.destination.presentation.base.roleFilteredPayload).toMatchObject({
      advisorCard: { effectsActive: false },
      advisorIPlus8OrNull: 16,
      advisorWPlus8OrNull: 16,
      trogrSuppressionState: {
        kind: 'SUPPRESSED',
        suppressionBOrNull: 1,
        minimumIOrNull: 2,
      },
    });
    current = bound.checkpoint;
    const advisor = await commitAdvisor(
      host,
      current,
      'united-suppression-checkpoint',
      advisorSelectionFromProjection(bound.destination),
    );
    expectPlayerSafe(advisor.destination, 'CHR-019');
    expect(advisor.result.receipt.result).toMatchObject({
      effectsActive: false,
      nextFormId: 'CHR-019',
    });
    expect(advisor.destination.presentation.base.roleFilteredPayload).toMatchObject({
      speciesKeys: ['TROGR', 'ADVISER', 'TAIPAN', 'OWL'],
      symbiontModifierBreakdown: {
        bySpecies: [
          { speciesKey: 'TROGR' },
          { speciesKey: 'ADVISER', effect: { kind: 'INACTIVE' } },
          { speciesKey: 'TAIPAN' },
          { speciesKey: 'OWL' },
        ],
      },
    });
    expect(advisor.checkpoint.randomSymbiontStage?.rollRecords).toHaveLength(7);
    expect(host.sampleCalls()).toBe(0);
  });
});

describe('RANDOM persistence negatives', () => {
  it('fails closed on union, pending, physical, receipt, and revision corruption', async () => {
    const setup = setupCommittedRandom('corruption', 'FREE', 'MANUAL');
    const host = await createRandomHost(setup, []);
    await reconnectOn(host.socket, host, 'corruption-initial', [setup.selectionRequest.commandId]);
    const started = await startRandomSequence(host, setup.checkpoint, 'corruption-start');
    const rolled = await commitRoll(host, started.checkpoint, 'corruption-roll', 2);
    const valid = rolled.checkpoint;
    expect(() =>
      validateDurableCreationWizardCheckpoint(
        valid.localCharacter,
        valid.checkpoint,
        catalog.skillStage,
        catalog,
      ),
    ).not.toThrow();

    const cases: readonly (readonly [string, (payload: Record<string, unknown>) => void])[] = [
      [
        'top-level exact union',
        (payload) => {
          payload['unexpectedStage'] = null;
        },
      ],
      [
        'random-stage exact union',
        (payload) => {
          const stage = recordValue(payload['randomSymbiontStage']);
          if (stage === null) throw new Error('missing random stage');
          stage['seed'] = 'forbidden';
        },
      ],
      [
        'manual face and physical record',
        (payload) => {
          const stage = recordValue(payload['randomSymbiontStage']);
          const records = stage?.['rollRecords'];
          if (!Array.isArray(records)) throw new Error('missing roll records');
          const record = recordValue(records[0]);
          const request = recordValue(record?.['request']);
          const requestPayload = recordValue(request?.['payload']);
          if (requestPayload === null) throw new Error('missing request payload');
          requestPayload['manualFaceOrNull'] = 3;
        },
      ],
      [
        'request exact union',
        (payload) => {
          const stage = recordValue(payload['randomSymbiontStage']);
          const records = stage?.['rollRecords'];
          if (!Array.isArray(records)) throw new Error('missing roll records');
          const record = recordValue(records[0]);
          const request = recordValue(record?.['request']);
          if (request === null) throw new Error('missing request');
          request['unexpectedField'] = true;
        },
      ],
      [
        'terminal pending descriptor',
        (payload) => {
          const stage = recordValue(payload['randomSymbiontStage']);
          if (stage === null) throw new Error('missing random stage');
          stage['pendingRollRequestOrNull'] = {
            advisorAcceptedIndexOrNull: null,
            kind: 'SPECIES_ORIGIN',
            originRollRequestIdOrNull: null,
            rollRequestId: stage['randomSequenceId'],
          };
        },
      ],
      [
        'physical receipt agreement',
        (payload) => {
          const stage = recordValue(payload['randomSymbiontStage']);
          const records = stage?.['rollRecords'];
          if (!Array.isArray(records)) throw new Error('missing roll records');
          const record = recordValue(records[0]);
          const receipt = recordValue(record?.['receipt']);
          const result = recordValue(receipt?.['result']);
          const physical = recordValue(result?.['physicalRoll']);
          const mechanical = recordValue(physical?.['mechanical']);
          if (mechanical === null) throw new Error('missing physical receipt');
          mechanical['rawFace'] = 4;
        },
      ],
    ];
    for (const [label, mutate] of cases) {
      const payload = structuredClone(valid.durablePayload) as unknown as Record<string, unknown>;
      mutate(payload);
      expect(
        () =>
          validateDurableCreationWizardCheckpoint(
            { ...valid.localCharacter, payloadJson: JSON.stringify(payload) },
            valid.checkpoint,
            catalog.skillStage,
            catalog,
          ),
        label,
      ).toThrow();
    }

    expect(() =>
      validateDurableCreationWizardCheckpoint(
        {
          ...started.checkpoint.localCharacter,
          projectionRevision: started.checkpoint.localCharacter.projectionRevision + 1,
        },
        {
          ...started.checkpoint.checkpoint,
          projectionRevision: started.checkpoint.checkpoint.projectionRevision + 1,
        },
        catalog.skillStage,
        catalog,
      ),
    ).toThrow(/latest receipt revisions/u);
    expect(loadCurrent(host)).toEqual(valid);
  });

  it('rolls back an ID collision before RNG and rejects changed-payload replay', async () => {
    const setup = setupCommittedRandom('collision', 'FREE', 'AUTO');
    const host = await createRandomHost(setup, [2], 'live', {
      rollRequestIdForCount: (count) =>
        count === 1 ? 'collision-random-sequence' : `collision-roll-request-${String(count)}`,
    });
    await reconnectOn(host.socket, host, 'collision-initial', [setup.selectionRequest.commandId]);
    const started = await startRandomSequence(host, setup.checkpoint, 'collision-start');
    const colliding = randomRollRequest(host, started.checkpoint, 'collision-command', null);
    const refusal = await sendCommandRefusal(host.socket, colliding);
    expect(refusal).toMatchObject({
      commandId: colliding.commandId,
      messageType: 'command.refusal',
      refusal: { code: 'GUARD_REJECTED' },
    });
    expect(loadCurrent(host)).toEqual(started.checkpoint);
    expect(host.sampleCalls()).toBe(0);
    expect(host.rollRequestAllocations()).toBe(1);
    expect(host.receiptAllocations()).toBe(1);

    const rolled = await commitRoll(host, started.checkpoint, 'collision-valid-command', null);
    expect(rolled.checkpoint.randomSymbiontStage?.rollRecords).toHaveLength(1);
    expect(host.sampleCalls()).toBe(1);
    const beforeConflict = loadCurrent(host);
    const changed = randomRollRequest(host, started.checkpoint, rolled.request.commandId, 3);
    const conflict = await sendCommandRefusal(host.socket, changed);
    expect(conflict).toMatchObject({
      commandId: rolled.request.commandId,
      messageType: 'command.refusal',
      refusal: { code: 'IDEMPOTENCY_CONFLICT', detail: 'PAYLOAD_MISMATCH' },
    });
    expect(loadCurrent(host)).toEqual(beforeConflict);
    expect(host.receiptAllocations()).toBe(2);
    expect(host.sampleCalls()).toBe(1);
  });
});

describe('RANDOM catalog startup', () => {
  it('fails closed instead of accepting an incomplete symbiont catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'symbiosis-random-catalog-'));
    try {
      const characterRoot = join(root, 'generated', 'spec', 'character');
      await mkdir(characterRoot, { recursive: true });
      const files = [
        'classes.json',
        'dictionaries.json',
        'incompatibilities.json',
        'modifiers.json',
        'races.json',
        'skill-requirements.json',
        'skills.json',
        'stats.json',
        'symbionts.json',
      ] as const;
      await Promise.all(
        files.map((file) =>
          copyFile(
            join(PROJECT_ROOT, 'generated', 'spec', 'character', file),
            join(characterRoot, file),
          ),
        ),
      );
      await writeFile(join(characterRoot, 'symbionts.json'), '[]\n', 'utf8');
      await expect(loadSymbiontCatalog(root)).rejects.toThrow(/symbionts/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe('RANDOM pre-RNG ID reservations', () => {
  it.each([
    { prefix: 'advisor-id-collision', collisionAt: 2 },
    { prefix: 'next-pending-collision', collisionAt: 3 },
  ])(
    'rejects $prefix before sampling and preserves the durable checkpoint',
    async ({ prefix, collisionAt }) => {
      const setup = setupCommittedRandom(prefix, 'FREE', 'AUTO');
      const host = await createRandomHost(setup, [9], 'live', {
        rollRequestIdForCount: (count) =>
          count === collisionAt
            ? `${prefix}-random-sequence`
            : `${prefix}-reserved-roll-request-${String(count)}`,
      });
      await reconnectOn(host.socket, host, `${prefix}-initial`, [setup.selectionRequest.commandId]);
      const started = await startRandomSequence(host, setup.checkpoint, `${prefix}-start`);
      const request = randomRollRequest(host, started.checkpoint, `${prefix}-command`, null);

      const refusal = await sendCommandRefusal(host.socket, request);
      expect(refusal).toMatchObject({
        commandId: request.commandId,
        messageType: 'command.refusal',
        refusal: { code: 'GUARD_REJECTED' },
        revisions: currentCreationWizardRevisions(started.checkpoint),
      });
      expect(host.sampleCalls()).toBe(0);
      expect(host.rollRequestAllocations()).toBe(collisionAt);
      expect(host.receiptAllocations()).toBe(1);
      expect(loadCurrent(host)).toEqual(started.checkpoint);
    },
  );
});

describe('RANDOM strict durable history validation', () => {
  it('rejects wrong kind, origin, and Advisor index on otherwise valid pending descriptors', async () => {
    const originSetup = setupCommittedRandom('pending-origin', 'UNITED', 'MANUAL');
    const originHost = await createRandomHost(originSetup, []);
    await reconnectOn(originHost.socket, originHost, 'pending-origin-initial', [
      originSetup.selectionRequest.commandId,
    ]);
    const originStarted = await startRandomSequence(
      originHost,
      originSetup.checkpoint,
      'pending-origin-start',
    );
    const origin = await commitRoll(originHost, originStarted.checkpoint, 'pending-origin-roll', 2);
    expect(origin.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull).toMatchObject({
      kind: 'SPECIES_ORIGIN',
      originRollRequestIdOrNull: null,
      advisorAcceptedIndexOrNull: null,
    });
    expectPayloadCorruption(origin.checkpoint, 'wrong pending kind', (payload) => {
      const stage = recordValue(payload['randomSymbiontStage']);
      const pending = recordValue(stage?.['pendingRollRequestOrNull']);
      if (pending === null) throw new Error('missing pending descriptor');
      pending['kind'] = 'ADVISOR_I';
    });

    const critical = await commitRoll(originHost, origin.checkpoint, 'pending-critical-roll', 20);
    const criticalPending = critical.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull;
    expect(criticalPending?.kind).toBe('CRITICAL_CONFIRMATION');
    expect(typeof criticalPending?.originRollRequestIdOrNull).toBe('string');
    expectPayloadCorruption(critical.checkpoint, 'wrong pending origin', (payload) => {
      const stage = recordValue(payload['randomSymbiontStage']);
      const pending = recordValue(stage?.['pendingRollRequestOrNull']);
      if (pending === null) throw new Error('missing pending descriptor');
      pending['originRollRequestIdOrNull'] = 'not-the-origin-request';
    });

    const advisorSetup = setupCommittedRandom('pending-advisor', 'FREE', 'MANUAL');
    const advisorHost = await createRandomHost(advisorSetup, []);
    await reconnectOn(advisorHost.socket, advisorHost, 'pending-advisor-initial', [
      advisorSetup.selectionRequest.commandId,
    ]);
    const advisorStarted = await startRandomSequence(
      advisorHost,
      advisorSetup.checkpoint,
      'pending-advisor-start',
    );
    const advisor = await commitRoll(
      advisorHost,
      advisorStarted.checkpoint,
      'pending-advisor-roll',
      9,
    );
    expect(advisor.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull).toMatchObject({
      kind: 'ADVISOR_I',
      advisorAcceptedIndexOrNull: 0,
    });
    expectPayloadCorruption(advisor.checkpoint, 'wrong pending Advisor index', (payload) => {
      const stage = recordValue(payload['randomSymbiontStage']);
      const pending = recordValue(stage?.['pendingRollRequestOrNull']);
      if (pending === null) throw new Error('missing pending descriptor');
      pending['advisorAcceptedIndexOrNull'] = 1;
    });
  });

  it('requires the terminal monster record to exactly match the request payload', async () => {
    const setup = setupCommittedRandom('monster-mismatch', 'UNITED', 'MANUAL');
    const host = await createRandomHost(setup, []);
    await reconnectOn(host.socket, host, 'monster-mismatch-initial', [
      setup.selectionRequest.commandId,
    ]);
    const started = await startRandomSequence(host, setup.checkpoint, 'monster-mismatch-start');
    const origin = await commitRoll(host, started.checkpoint, 'monster-mismatch-origin', 20);
    const intermediate = await commitRoll(
      host,
      origin.checkpoint,
      'monster-mismatch-intermediate',
      15,
      'CHIMERA',
    );
    const terminal = await commitRoll(
      host,
      intermediate.checkpoint,
      'monster-mismatch-terminal',
      14,
      'CHIMERA',
    );
    expect(terminal.checkpoint.randomSymbiontStage?.rollRecords[2]?.physicalRoll).toMatchObject({
      selectedMonsterSpeciesKeyOrNull: 'CHIMERA',
    });

    expectPayloadCorruption(terminal.checkpoint, 'request/record monster mismatch', (payload) => {
      const stage = recordValue(payload['randomSymbiontStage']);
      const records = stage?.['rollRecords'];
      if (!Array.isArray(records)) throw new Error('missing roll records');
      const record = recordValue(records[2]);
      const physical = recordValue(record?.['physicalRoll']);
      if (physical === null) throw new Error('missing physical record');
      physical['selectedMonsterSpeciesKeyOrNull'] = 'PUPPETEER';

      const receipt = recordValue(record?.['receipt']);
      const result = recordValue(receipt?.['result']);
      const receiptPhysical = recordValue(result?.['physicalRoll']);
      if (receiptPhysical === null) throw new Error('missing physical receipt');
      receiptPhysical['selectedMonsterSpeciesKeyOrNull'] = 'PUPPETEER';

      const topResult = recordValue(recordValue(payload['receipt'])?.['result']);
      const topPhysical = recordValue(topResult?.['physicalRoll']);
      if (topPhysical === null) throw new Error('missing top-level physical receipt');
      topPhysical['selectedMonsterSpeciesKeyOrNull'] = 'PUPPETEER';
    });
  });
});

describe('RANDOM transport and storage recovery', () => {
  it('resumes an acknowledged CHR-019 with empty unack after reopening SQLite and host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'symbiosis-random-reopen-'));
    temporaryDirectories.push(root);
    const databasePath = join(root, 'random.sqlite');
    const setup = setupCommittedRandom('acknowledged-reopen', 'FREE', 'AUTO', databasePath);
    const host = await createRandomHost(setup, [2]);
    await reconnectOn(host.socket, host, 'acknowledged-reopen-initial', [
      setup.selectionRequest.commandId,
    ]);
    const started = await startRandomSequence(host, setup.checkpoint, 'acknowledged-reopen-start');
    const rolled = await commitRoll(host, started.checkpoint, 'acknowledged-reopen-roll', null);
    const bound = await commitBinding(host, rolled.checkpoint, 'acknowledged-reopen-binding');
    expectPlayerSafe(bound.destination, 'CHR-019');
    const expected = bound.checkpoint;

    await stopRandomHost(host);
    setup.database.close();
    const closedIndex = databases.indexOf(setup.database);
    if (closedIndex >= 0) databases.splice(closedIndex, 1);
    const reopened = openPersistenceDatabase(databasePath);
    databases.push(reopened);
    const reopenedSetup: CommittedRandomSetup = {
      ...setup,
      checkpoint: loadCreationWizardCheckpoint(
        reopened,
        setup.characterDraftId,
        catalog.skillStage,
        catalog,
      ),
      database: reopened,
    };
    const restarted = await createRandomHost(reopenedSetup, [], 'acknowledged-restarted');
    const recoveredFrames = await reconnectOn(
      restarted.socket,
      restarted,
      'acknowledged-reopen-empty-unack',
    );
    expect(recoveredFrames).toHaveLength(2);
    const recovered = snapshot(hostMessageV2(recoveredFrames[1] ?? ''));
    expectPlayerSafe(recovered, 'CHR-019');
    expect(recovered.revisions).toEqual(currentCreationWizardRevisions(expected));
    expect(recovered.presentation.base.roleFilteredPayload).toMatchObject({
      speciesKeys: ['TAIPAN'],
      randomReceiptIds: expected.durablePayload.randomReceiptIds,
    });
    expect(loadCurrent(restarted)).toEqual(expected);
    expect(restarted.receiptAllocations()).toBe(0);
    expect(restarted.sampleCalls()).toBe(0);
  });

  it('recovers one committed roll after an in-flight disconnect before client ack', async () => {
    const setup = setupCommittedRandom('disconnect-before-commit', 'FREE', 'AUTO');
    const host = await createRandomHost(setup, [2], 'live', {
      onSample: () => {
        expect(loadCurrent(host)).toEqual(started.checkpoint);
        host.socket.terminate();
      },
    });
    await reconnectOn(host.socket, host, 'disconnect-before-commit-initial', [
      setup.selectionRequest.commandId,
    ]);
    const started = await startRandomSequence(
      host,
      setup.checkpoint,
      'disconnect-before-commit-start',
    );
    const request = randomRollRequest(
      host,
      started.checkpoint,
      'disconnect-before-commit-roll',
      null,
    );
    const received: string[] = [];
    host.socket.on('message', (data: RawData) => {
      received.push(rawDataText(data));
    });
    const closed = new Promise<void>((resolve) => {
      host.socket.once('close', () => {
        resolve();
      });
    });
    host.socket.send(clientText(request));
    await closed;

    expect(received).toEqual([]);
    const committed = loadCurrent(host);
    expect(committed.randomSymbiontStage?.rollRecords).toHaveLength(1);
    expect(committed.receipt.result).toMatchObject({
      physicalRoll: { mechanical: { rawFace: 2 } },
    });
    expect(host.sampleCalls()).toBe(1);

    const recoverySocket = await openSocket(host.app);
    const recoveredFrames = await reconnectOn(
      recoverySocket,
      host,
      'disconnect-before-commit-replay',
      [request.commandId],
    );
    expect(hostMessage(recoveredFrames[0] ?? '')).toMatchObject({
      lifecycleState: 'IDEMPOTENT_REPLAY',
      receipt: committed.receipt,
    });
    expectPlayerSafe(snapshot(hostMessageV2(recoveredFrames[2] ?? '')), 'CHR-020');
    expect(loadCurrent(host)).toEqual(committed);
    expect(host.sampleCalls()).toBe(1);
  });

  it('uses durable replay after commit when the first command result is dropped before ack', async () => {
    const setup = setupCommittedRandom('commit-before-ack', 'FREE', 'AUTO');
    const host = await createRandomHost(setup, [2]);
    await reconnectOn(host.socket, host, 'commit-before-ack-initial', [
      setup.selectionRequest.commandId,
    ]);
    const started = await startRandomSequence(host, setup.checkpoint, 'commit-before-ack-start');
    const request = randomRollRequest(host, started.checkpoint, 'commit-before-ack-roll', null);
    const serverSocket = [
      ...(
        host.app as unknown as {
          readonly websocketServer: { readonly clients: ReadonlySet<WebSocket> };
        }
      ).websocketServer.clients,
    ][0];
    if (serverSocket === undefined) throw new Error('missing server-side websocket');
    const originalSend = serverSocket.send.bind(serverSocket);
    let dropped = 0;
    serverSocket.send = function (this: WebSocket, data: unknown, ...args: unknown[]): void {
      if (typeof data === 'string' && data.includes('"messageType":"command.result"')) {
        dropped += 1;
        return;
      }
      Reflect.apply(originalSend, serverSocket, [data, ...args]);
    } as WebSocket['send'];

    let destination: Snapshot;
    try {
      const frames = receiveFrames(host.socket, 1);
      host.socket.send(clientText(request));
      destination = snapshot(hostMessageV2((await frames)[0] ?? ''));
    } finally {
      serverSocket.send = originalSend;
    }
    expect(dropped).toBe(1);
    expectPlayerSafe(destination, 'CHR-020');
    const committed = loadCurrent(host);
    expect(committed.randomSymbiontStage?.rollRecords).toHaveLength(1);
    expect(host.sampleCalls()).toBe(1);

    await stopRandomHost(host);
    const restarted = await createRandomHost(setup, [], 'commit-before-ack-restart');
    const recoveredFrames = await reconnectOn(
      restarted.socket,
      restarted,
      'commit-before-ack-replay',
      [request.commandId],
    );
    expect(hostMessage(recoveredFrames[0] ?? '')).toMatchObject({
      lifecycleState: 'IDEMPOTENT_REPLAY',
      receipt: committed.receipt,
    });
    expectPlayerSafe(snapshot(hostMessageV2(recoveredFrames[2] ?? '')), 'CHR-020');
    expect(loadCurrent(restarted)).toEqual(committed);
    expect(restarted.sampleCalls()).toBe(0);
  });
});

describe('RANDOM critical preallocation boundary', () => {
  it('reserves the next origin after a terminal fifth confirmation of a later critical', async () => {
    const setup = setupCommittedRandom('fifth-later-critical', 'UNITED', 'AUTO');
    const host = await createRandomHost(setup, [2, 20, 15, 16, 17, 18, 19]);
    await reconnectOn(host.socket, host, 'fifth-later-critical-initial', [
      setup.selectionRequest.commandId,
    ]);
    let current = (await startRandomSequence(host, setup.checkpoint, 'fifth-later-critical-start'))
      .checkpoint;
    const accepted = await commitRoll(host, current, 'fifth-later-critical-accepted', null);
    const origin = await commitRoll(host, accepted.checkpoint, 'fifth-later-critical-origin', null);
    current = origin.checkpoint;
    for (const [index, face] of [15, 16, 17, 18, 19].entries()) {
      const confirmation = await commitRoll(
        host,
        current,
        `fifth-later-critical-confirmation-${String(index + 1)}`,
        null,
      );
      current = confirmation.checkpoint;
      expect(confirmation.result.receipt.result).toMatchObject({
        physicalRoll: {
          kind: 'CRITICAL_CONFIRMATION',
          selectedMonsterSpeciesKeyOrNull: null,
          mechanical: { rawFace: face },
        },
      });
    }
    expect(current.randomSymbiontStage?.rollRecords).toHaveLength(7);
    expect(current.randomSymbiontStage?.pendingRollRequestOrNull).toMatchObject({
      kind: 'SPECIES_ORIGIN',
      originRollRequestIdOrNull: null,
      advisorAcceptedIndexOrNull: null,
    });
    expect(current.receipt.result).toMatchObject({
      nextPendingRollRequestIdOrNull:
        current.randomSymbiontStage?.pendingRollRequestOrNull?.rollRequestId,
      randomStatus: 'PENDING',
    });
    expect(host.sampleCalls()).toBe(7);
  });
});

describe('RANDOM conservative pending reservations', () => {
  it('continues FREE AUTO 20 to 15 with a confirmation pending and drops later unused IDs', async () => {
    const setup = setupCommittedRandom('free-critical-reservation', 'FREE', 'AUTO');
    const host = await createRandomHost(setup, [20, 15, 14]);
    await reconnectOn(host.socket, host, 'free-critical-reservation-initial', [
      setup.selectionRequest.commandId,
    ]);
    const started = await startRandomSequence(
      host,
      setup.checkpoint,
      'free-critical-reservation-start',
    );
    const origin = await commitRoll(
      host,
      started.checkpoint,
      'free-critical-reservation-origin',
      null,
    );
    expect(origin.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull).toMatchObject({
      kind: 'CRITICAL_CONFIRMATION',
    });

    const intermediate = await commitRoll(
      host,
      origin.checkpoint,
      'free-critical-reservation-intermediate',
      null,
    );
    const intermediatePending =
      intermediate.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull;
    expect(intermediatePending).toMatchObject({
      kind: 'CRITICAL_CONFIRMATION',
      originRollRequestIdOrNull:
        origin.checkpoint.randomSymbiontStage?.rollRecords[0]?.physicalRoll.rollRequestId,
    });
    expect(intermediate.result.receipt.result).toMatchObject({
      nextPendingRollRequestIdOrNull: intermediatePending?.rollRequestId,
      randomStatus: 'PENDING',
    });

    const terminal = await commitRoll(
      host,
      intermediate.checkpoint,
      'free-critical-reservation-terminal',
      null,
    );
    expect(terminal.result.receipt.result).toMatchObject({
      nextPendingRollRequestIdOrNull: null,
      randomStatus: 'BINDING',
    });
    expect(terminal.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull).toBeNull();
    const durableIds = creationWizardDurableIds(terminal.checkpoint);
    const reservedId = (count: number): string =>
      `${setup.selectionRequest.commandId}-live-roll-request-${String(count)}`;
    expect(durableIds).not.toContain(reservedId(2));
    expect(durableIds).not.toContain(reservedId(5));
    expect(durableIds).toContain(reservedId(3));
    expect(durableIds).toContain(reservedId(4));
    expect(host.sampleCalls()).toBe(3);
  });

  it('continues UNITED Advisor I/W without suppression into SPECIES_ORIGIN pending', async () => {
    const setup = setupCommittedRandom('united-advisor-origin', 'UNITED', 'AUTO');
    const host = await createRandomHost(setup, [9, 1, 20]);
    await reconnectOn(host.socket, host, 'united-advisor-origin-initial', [
      setup.selectionRequest.commandId,
    ]);
    const started = await startRandomSequence(
      host,
      setup.checkpoint,
      'united-advisor-origin-start',
    );
    const origin = await commitRoll(host, started.checkpoint, 'united-advisor-origin-roll', null);
    const advisorI = await commitRoll(host, origin.checkpoint, 'united-advisor-origin-i', null);
    const advisorW = await commitRoll(host, advisorI.checkpoint, 'united-advisor-origin-w', null);
    const pending = advisorW.checkpoint.randomSymbiontStage?.pendingRollRequestOrNull;
    expect(pending).toMatchObject({
      kind: 'SPECIES_ORIGIN',
      originRollRequestIdOrNull: null,
      advisorAcceptedIndexOrNull: null,
    });
    expect(advisorW.result.receipt.result).toMatchObject({
      nextPendingRollRequestIdOrNull: pending?.rollRequestId,
      randomStatus: 'PENDING',
    });
    expect(advisorW.checkpoint.randomSymbiontStage?.rollRecords).toHaveLength(3);
    expect(creationWizardDurableIds(advisorW.checkpoint)).toContain(
      `${setup.selectionRequest.commandId}-live-roll-request-5`,
    );
    expect(host.sampleCalls()).toBe(3);
  });
});

describe('RANDOM multi-draft reconnect', () => {
  it('returns APP-001 without selecting a character, closing, sampling, or allocating IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'symbiosis-random-multi-draft-'));
    temporaryDirectories.push(root);
    const databasePath = join(root, 'random.sqlite');
    const first = setupCommittedRandom('multi-draft-first', 'FREE', 'AUTO', databasePath);
    const second = setupCommittedRandom('multi-draft-second', 'UNITED', 'AUTO', databasePath);
    second.database.close();
    const secondIndex = databases.indexOf(second.database);
    if (secondIndex >= 0) databases.splice(secondIndex, 1);

    const host = await createRandomHost(first, []);
    const recoveredFrames = await reconnectOn(host.socket, host, 'multi-draft-empty-unack');
    expect(recoveredFrames).toHaveLength(2);
    const recovered = snapshot(hostMessageV2(recoveredFrames[1] ?? ''));
    expect(recovered).toMatchObject({
      projectionRole: null,
      presentation: { base: { formId: 'APP-001' } },
    });
    expect(host.socket.readyState).toBe(WebSocket.OPEN);
    expect(loadCurrent(host)).toEqual(first.checkpoint);
    expect(
      loadCreationWizardCheckpoint(
        first.database,
        second.characterDraftId,
        catalog.skillStage,
        catalog,
      ),
    ).toEqual(second.checkpoint);
    expect(host.receiptAllocations()).toBe(0);
    expect(host.rollRequestAllocations()).toBe(0);
    expect(host.sampleCalls()).toBe(0);
  });
});

describe('RANDOM disconnect before processing', () => {
  it('does no work and reports the closed-connection command as UNRECOGNIZED', async () => {
    const setup = setupCommittedRandom('disconnect-before-processing', 'FREE', 'AUTO');
    const host = await createRandomHost(setup, []);
    await reconnectOn(host.socket, host, 'disconnect-before-processing-initial', [
      setup.selectionRequest.commandId,
    ]);
    const started = await startRandomSequence(
      host,
      setup.checkpoint,
      'disconnect-before-processing-start',
    );
    const commandSocket = await openSocket(host.app);
    await reconnectOn(commandSocket, host, 'disconnect-before-processing-session');
    const request = randomRollRequest(
      host,
      started.checkpoint,
      'disconnect-before-processing-roll',
      null,
    );

    const closed = new Promise<void>((resolve) => {
      commandSocket.once('close', () => {
        resolve();
      });
    });
    commandSocket.terminate();
    await closed;
    expect(commandSocket.readyState).toBe(WebSocket.CLOSED);
    const sendError = await new Promise<unknown>((resolve) => {
      try {
        commandSocket.send(clientText(request), (error) => {
          resolve(error);
        });
      } catch (error) {
        resolve(error);
      }
    });
    expect(sendError).toBeInstanceOf(Error);
    expect(loadCurrent(host)).toEqual(started.checkpoint);
    expect(host.receiptAllocations()).toBe(0);
    expect(host.rollRequestAllocations()).toBe(0);
    expect(host.sampleCalls()).toBe(0);

    const recoverySocket = await openSocket(host.app);
    const recoveredFrames = await reconnectOn(
      recoverySocket,
      host,
      'disconnect-before-processing-replay',
      [request.commandId],
    );
    expect(recoveredFrames).toHaveLength(3);
    expect(hostMessage(recoveredFrames[0] ?? '')).toMatchObject({
      commandId: request.commandId,
      messageType: 'command.refusal',
      refusal: {
        code: 'UNRECOGNIZED',
        path: '$.unacknowledgedCommandIds[0]',
        value: request.commandId,
      },
    });
    expectPlayerSafe(snapshot(hostMessageV2(recoveredFrames[2] ?? '')), 'CHR-020');
    expect(loadCurrent(host)).toEqual(started.checkpoint);
    expect(host.receiptAllocations()).toBe(0);
    expect(host.rollRequestAllocations()).toBe(0);
    expect(host.sampleCalls()).toBe(0);
  });
});
