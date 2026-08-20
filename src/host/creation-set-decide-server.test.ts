import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawData, WebSocket } from 'ws';

import {
  decodeHostMessage,
  decodeHostMessageV2,
  decodeHostMessageV3,
  encodeClientMessage,
  encodeClientMessageV2,
  encodeClientMessageV3,
  WIRE_PROTOCOL_VERSION,
  WIRE_PROTOCOL_V2_VERSION,
  WIRE_PROTOCOL_V3_VERSION,
} from '@shared/index.js';
import type {
  ClientToHostMessage,
  ClientToHostV2Message,
  CommandResultMessage,
  FormActionIntentV2Message,
  HostToClientMessage,
  HostToClientV2Message,
  HostToClientV3Message,
  IdentityDraftReplaceV3Message,
  ProtocolVocabulary,
  RevisionVector,
  SessionReconnectV2Message,
  WireV2Vocabulary,
  WireV3Vocabulary,
} from '@shared/index.js';

import { openPersistenceDatabase } from '../persistence/database.js';
import { bootstrapDeviceIdentity, resetDeviceIdentity } from '../persistence/index.js';
import type { RevisionImpact } from '../persistence/index.js';
import { loadCreationDecisionConsequenceCatalog } from './creation-decision-consequence-catalog.js';
import {
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  loadCreationWizardCheckpoint,
} from './creation-set-decide.js';
import { CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID } from './creation-roll-commit.js';
import { IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID } from './identity-checkpoint.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { createHost, startHost } from './server.js';
import { loadSkillStageCatalog } from './skill-stage-catalog.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ZERO_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;

type WorkflowRequest = Extract<
  ClientToHostMessage,
  { readonly commandKind: 'workflow-command'; readonly messageType: 'command.request' }
>;

interface RevisionRuntime {
  readonly advance: (impact: RevisionImpact) => RevisionVector;
  readonly read: () => RevisionVector;
  readonly writes: readonly RevisionImpact[];
}

interface JourneyHarness {
  readonly app: FastifyInstance;
  readonly characterDraftId: string;
  readonly checkpointResult: CommandResultMessage;
  readonly database: ReturnType<typeof openPersistenceDatabase>;
  readonly deviceId: string;
  readonly identityCommand: WorkflowRequest;
  readonly receiptAllocations: () => number;
  readonly rollRequestAllocations: () => number;
  readonly runtime: RevisionRuntime;
  readonly sampleCalls: () => number;
  readonly socket: WebSocket;
  readonly wizardCheckpointId: string;
}

interface Chr003Journey {
  readonly branchUuid: string;
  readonly destination: HostToClientV2Message;
  readonly methodRequest: WorkflowRequest;
  readonly methodResult: CommandResultMessage;
  readonly setRollRequestId: string;
  readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
}

interface CommittedNonCriticalSet extends Chr003Journey {
  readonly setDestination: HostToClientV2Message;
  readonly setRequest: WorkflowRequest;
  readonly setResult: CommandResultMessage;
}

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

const WITHOUT_SET_DECIDE = [
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
] as const;

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

function clientTextV3(
  message: IdentityDraftReplaceV3Message,
  vocabulary: WireV3Vocabulary,
): string {
  const encoded = encodeClientMessageV3(message, vocabulary);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.refusal));
  return encoded.text;
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

function hostMessageV3(text: string, vocabulary: WireV3Vocabulary): HostToClientV3Message {
  const decoded = decodeHostMessageV3(text, vocabulary);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.refusal));
  return decoded.value;
}

function reconnect(
  deviceId: string,
  requestId: string,
  unacknowledgedCommandIds: readonly string[] = [],
  supportedWorkflowCommandIds: SessionReconnectV2Message['supportedWorkflowCommandIds'] = ALL_CREATION_WORKFLOW_COMMAND_IDS,
): SessionReconnectV2Message {
  return {
    deviceId,
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
  vocabulary: WireV2Vocabulary,
): Promise<HostToClientV2Message> {
  const frames = receiveFrames(socket, 1);
  socket.send(clientTextV2(message, vocabulary));
  return hostMessageV2((await frames)[0] ?? '', vocabulary);
}

async function sendCommand(
  socket: WebSocket,
  message: WorkflowRequest,
  vocabulary: ProtocolVocabulary & WireV2Vocabulary,
): Promise<readonly [HostToClientMessage, HostToClientV2Message]> {
  const frames = receiveFrames(socket, 2);
  socket.send(clientText(message, vocabulary));
  const values = await frames;
  return [hostMessage(values[0] ?? '', vocabulary), hostMessageV2(values[1] ?? '', vocabulary)];
}

function setDecideRequest(
  commandId: string,
  sourceFormId: 'CHR-002' | 'CHR-010' | 'CHR-016' | 'CHR-036',
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
  expectedRevisions: RevisionVector,
  decision:
    | { readonly raceChoice: 'FREE' | 'PURE' | 'UNITED' }
    | { readonly symbiontAcquisitionMode: 'MANUAL' | 'RANDOM' }
    | { readonly diceInputMode: 'AUTO' | 'MANUAL' }
    | { readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC' },
): WorkflowRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions,
    messageType: 'command.request',
    payload: {
      characterDraftId,
      draftRevision,
      sourceFormId,
      stage: 'RACE_AND_METHOD',
      wizardCheckpointId,
      ...decision,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  };
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

function resultString(result: CommandResultMessage, key: string): string {
  const value = result.receipt.result[key];
  if (typeof value !== 'string') throw new Error(`missing string receipt result ${key}`);
  return value;
}

function resultNullableString(result: CommandResultMessage, key: string): string | null {
  const value = result.receipt.result[key];
  if (value !== null && typeof value !== 'string') {
    throw new Error(`missing nullable string receipt result ${key}`);
  }
  return value;
}

async function createJourneyHarness(
  staticRoot: string,
  vocabulary: ProtocolVocabulary & WireV3Vocabulary,
  suffix: string,
  sampleFaces: readonly number[] = [],
  options: {
    readonly onFrameError?: (error: unknown) => void;
    readonly onReceiptAllocation?: (
      database: ReturnType<typeof openPersistenceDatabase>,
      count: number,
    ) => void;
    readonly receiptIdForCount?: (count: number) => string;
    readonly rollRequestIdForCount?: (count: number) => string;
  } = {},
): Promise<JourneyHarness> {
  const database = openPersistenceDatabase(':memory:');
  const deviceId = bootstrapDeviceIdentity(database);
  const runtime = revisionRuntime();
  let idSequence = 0;
  let receiptAllocations = 0;
  let rollRequestAllocations = 0;
  let sampleCalls = 0;
  const app = await createHost({
    advanceRevisions: runtime.advance,
    allocateCreationBranchUuid: () =>
      `30000000-0000-4000-8000-${String(++idSequence).padStart(12, '0')}`,
    allocateCreationRollRequestId: () => {
      rollRequestAllocations += 1;
      return (
        options.rollRequestIdForCount?.(rollRequestAllocations) ??
        `roll-request-${suffix}-${String(++idSequence)}`
      );
    },
    allocateContextId: () => `10000000-0000-4000-8000-${String(++idSequence).padStart(12, '0')}`,
    allocateLocalCharacterId: () =>
      `20000000-0000-4000-8000-${String(++idSequence).padStart(12, '0')}`,
    allocateReceiptId: () => {
      receiptAllocations += 1;
      options.onReceiptAllocation?.(database, receiptAllocations);
      return (
        options.receiptIdForCount?.(receiptAllocations) ??
        `receipt-${suffix}-${String(receiptAllocations)}`
      );
    },
    allocateWizardCheckpointId: () => `wizard-${suffix}-${String(++idSequence)}`,
    database,
    onFrameError:
      options.onFrameError ??
      ((error) => {
        throw error;
      }),
    projectRoot: PROJECT_ROOT,
    readRevisions: runtime.read,
    sampleCreationD20: () => sampleFaces[sampleCalls++] ?? 10,
    staticRoot,
  });
  await startHost(app, { interface: '127.0.0.1', port: 0 });
  const socket = await app.injectWS('/state');

  let frames = receiveFrames(socket, 2);
  socket.send(clientTextV2(reconnect(deviceId, `${suffix}-reconnect`), vocabulary));
  const reconnectFrames = await frames;
  expect(hostMessageV2(reconnectFrames[0] ?? '', vocabulary)).toMatchObject({
    executableWorkflowCommandIds: [
      IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
      CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
      CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
    ],
  });

  const app002 = await sendV2(
    socket,
    formAction(`${suffix}-player`, 'APP-001', 'APP-001::CTA::001', 0),
    vocabulary,
  );
  if (app002.messageType !== 'projection.snapshot') throw new Error('missing APP-002');
  const chr001 = await sendV2(
    socket,
    formAction(
      `${suffix}-draft`,
      'APP-002',
      'APP-002::CTA::007',
      app002.revisions.projectionRevision,
    ),
    vocabulary,
  );
  if (chr001.messageType !== 'projection.snapshot') throw new Error('missing CHR-001');
  const characterDraftId = chr001.presentation.base.roleFilteredPayload['characterDraftId'];
  const wizardCheckpointId = chr001.presentation.base.roleFilteredPayload['wizardCheckpointId'];
  const contextId = app002.presentation.base.roleFilteredPayload['contextId'];
  if (
    typeof characterDraftId !== 'string' ||
    typeof wizardCheckpointId !== 'string' ||
    typeof contextId !== 'string'
  ) {
    throw new Error('missing character wizard identity');
  }
  const values = {
    age: 27,
    artAssetKeyOrLocalFile: null,
    description: `journey ${suffix}`,
    massKg: 72,
    name: `Player ${suffix}`,
    sex: 'FEMALE',
  } as const;
  const identityReplace = {
    draftUpdateId: `${suffix}-identity`,
    expectedDraftRevision: 0,
    expectedRevisions: chr001.revisions,
    messageType: 'character.identity-draft.replace',
    protocolVersion: WIRE_PROTOCOL_V3_VERSION,
    scope: { characterDraftId, contextId, sourceFormId: 'CHR-001', wizardCheckpointId },
    values,
  } as const satisfies IdentityDraftReplaceV3Message;
  frames = receiveFrames(socket, 1);
  socket.send(clientTextV3(identityReplace, vocabulary));
  const identityResult = hostMessageV3((await frames)[0] ?? '', vocabulary);
  if (identityResult.messageType !== 'character.identity-draft.result') {
    throw new Error('identity draft was not confirmed');
  }
  const identityCommand = {
    commandId: `${suffix}-identity-checkpoint`,
    commandKind: 'workflow-command',
    expectedRevisions: identityResult.revisions,
    messageType: 'command.request',
    payload: {
      ...values,
      characterDraftId,
      draftRevision: identityResult.draftRevision,
      stage: 'IDENTITY',
      wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  } as const satisfies WorkflowRequest;
  const [checkpointTerminal, chr010] = await sendCommand(socket, identityCommand, vocabulary);
  const checkpointResult = committedResult(checkpointTerminal);
  expect(chr010).toMatchObject({
    presentation: {
      base: {
        availableActionKeys: ['CHR-010::CTA::004', 'CHR-010::CTA::005', 'CHR-010::CTA::006'],
        formId: 'CHR-010',
        roleFilteredPayload: {
          characterDraftId,
          choiceLockStatus: 'UNLOCKED',
          draftRevision: 1,
          raceChoice: null,
          raceConsequencesPreview: null,
          wizardCheckpointId,
        },
      },
    },
  });
  return {
    app,
    characterDraftId,
    checkpointResult,
    database,
    deviceId,
    identityCommand,
    receiptAllocations: () => receiptAllocations,
    rollRequestAllocations: () => rollRequestAllocations,
    runtime,
    sampleCalls: () => sampleCalls,
    socket,
    wizardCheckpointId,
  };
}

async function advanceToChr003(
  harness: JourneyHarness,
  vocabulary: ProtocolVocabulary & WireV2Vocabulary,
  prefix: string,
  statMethod: Chr003Journey['statMethod'] = 'CLASSIC',
  raceChoice: 'FREE' | 'PURE' | 'UNITED' = 'UNITED',
  acquisitionMode: 'MANUAL' | 'RANDOM' = 'MANUAL',
): Promise<Chr003Journey> {
  const raceRequest = setDecideRequest(
    `${prefix}-race`,
    'CHR-010',
    harness.characterDraftId,
    harness.wizardCheckpointId,
    resultRevision(harness.checkpointResult, 'draftRevision'),
    harness.checkpointResult.receipt.revisions,
    { raceChoice },
  );
  const [raceTerminal] = await sendCommand(harness.socket, raceRequest, vocabulary);
  const raceResult = committedResult(raceTerminal);
  let previousResult = raceResult;
  if (raceChoice !== 'PURE') {
    const acquisitionRequest = setDecideRequest(
      `${prefix}-acquisition`,
      'CHR-016',
      harness.characterDraftId,
      harness.wizardCheckpointId,
      resultRevision(raceResult, 'draftRevision'),
      raceResult.receipt.revisions,
      { symbiontAcquisitionMode: acquisitionMode },
    );
    const [acquisitionTerminal] = await sendCommand(harness.socket, acquisitionRequest, vocabulary);
    previousResult = committedResult(acquisitionTerminal);
  }
  const diceRequest = setDecideRequest(
    `${prefix}-dice`,
    'CHR-036',
    harness.characterDraftId,
    harness.wizardCheckpointId,
    resultRevision(previousResult, 'draftRevision'),
    previousResult.receipt.revisions,
    { diceInputMode: 'AUTO' },
  );
  const [diceTerminal] = await sendCommand(harness.socket, diceRequest, vocabulary);
  const diceResult = committedResult(diceTerminal);
  const methodRequest = setDecideRequest(
    `${prefix}-method`,
    'CHR-002',
    harness.characterDraftId,
    harness.wizardCheckpointId,
    resultRevision(diceResult, 'draftRevision'),
    diceResult.receipt.revisions,
    { statMethod },
  );
  const [methodTerminal, destination] = await sendCommand(
    harness.socket,
    methodRequest,
    vocabulary,
  );
  const methodResult = committedResult(methodTerminal);
  const branchUuid = resultString(methodResult, 'branchUuid');
  const setRollRequestId = resultString(methodResult, 'setRollRequestId');
  expect(destination).toMatchObject({
    presentation: {
      base: {
        availableActionKeys: ['CHR-003::CTA::002'],
        formId: 'CHR-003',
        roleFilteredPayload: {
          branchUuid,
          facesOrManualInputs: [null, null, null, null, null, null, null],
          setRollReceiptId: null,
          setRollRequestId,
          shownResultLocked: false,
        },
      },
    },
    revisions: methodResult.receipt.revisions,
  });
  return { branchUuid, destination, methodRequest, methodResult, setRollRequestId, statMethod };
}

function statSetRollRequest(
  commandId: string,
  harness: JourneyHarness,
  journey: Chr003Journey,
  overrides: {
    readonly branchUuid?: string;
    readonly draftRevision?: number;
    readonly expectedRevisions?: RevisionVector;
  } = {},
): WorkflowRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: overrides.expectedRevisions ?? journey.methodResult.receipt.revisions,
    messageType: 'command.request',
    payload: {
      branchUuid: overrides.branchUuid ?? journey.branchUuid,
      characterDraftId: harness.characterDraftId,
      draftRevision:
        overrides.draftRevision ?? resultRevision(journey.methodResult, 'draftRevision'),
      manualFacesOrNull: null,
      setRollRequestId: journey.setRollRequestId,
      sourceFormId: 'CHR-003',
      stage: 'STAT_ROLLS',
      wizardCheckpointId: harness.wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  };
}

function confirmationRollRequest(
  commandId: string,
  harness: JourneyHarness,
  journey: Chr003Journey,
  previousResult: CommandResultMessage,
  setRollReceiptId: string,
  criticalQueueIndex: number,
  confirmationRollRequestId: string,
): WorkflowRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: previousResult.receipt.revisions,
    messageType: 'command.request',
    payload: {
      branchUuid: journey.branchUuid,
      characterDraftId: harness.characterDraftId,
      confirmationRollRequestId,
      criticalQueueIndex,
      draftRevision: resultRevision(previousResult, 'draftRevision'),
      manualFaceOrNull: null,
      setRollReceiptId,
      sourceFormId: 'CHR-004',
      stage: 'STAT_ROLLS',
      wizardCheckpointId: harness.wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  };
}

async function commitNonCriticalSet(
  harness: JourneyHarness,
  vocabulary: ProtocolVocabulary & WireV2Vocabulary,
  prefix: string,
  statMethod: Chr003Journey['statMethod'] = 'CLASSIC',
  raceChoice: 'FREE' | 'PURE' | 'UNITED' = 'UNITED',
  acquisitionMode: 'MANUAL' | 'RANDOM' = 'MANUAL',
): Promise<CommittedNonCriticalSet> {
  const journey = await advanceToChr003(
    harness,
    vocabulary,
    prefix,
    statMethod,
    raceChoice,
    acquisitionMode,
  );
  const setRequest = statSetRollRequest(`${prefix}-set`, harness, journey);
  const [setTerminal, setDestination] = await sendCommand(harness.socket, setRequest, vocabulary);
  const setResult = committedResult(setTerminal);
  const decisionFormId =
    statMethod === 'CLASSIC' ? 'CHR-005' : statMethod === 'ADVENTUROUS' ? 'CHR-006' : 'CHR-008';
  expect(setResult).toMatchObject({
    receipt: {
      result: {
        confirmationRollRequestIdOrNull: null,
        faces: [10, 10, 10, 10, 10, 10, 10],
        naturalCriticalQueue: [],
        nextFormId: decisionFormId,
        setRollReceiptId: setResult.receipt.receiptId,
        shownResultLocked: true,
        sourceFormId: 'CHR-003',
      },
    },
  });
  expect(setDestination).toMatchObject({
    presentation: {
      base: {
        availableActionKeys: [`${decisionFormId}::CTA::001`, `${decisionFormId}::CTA::002`],
        formId: decisionFormId,
        roleFilteredPayload: {
          [statMethod === 'CLASSIC' ? 'acceptedSetReceiptId' : 'setReceiptId']:
            setResult.receipt.receiptId,
          decision: 'PENDING',
          decisionReceiptIdOrNull: null,
          statMethod,
        },
      },
    },
    revisions: setResult.receipt.revisions,
  });
  expect(harness.sampleCalls()).toBe(7);
  return { ...journey, setDestination, setRequest, setResult };
}

type DecisionFormId = 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008';

function statDecisionRequest(
  commandId: string,
  harness: JourneyHarness,
  sourceFormId: DecisionFormId | 'CHR-028',
  decision: 'ACCEPT_SET' | 'CANCEL' | 'CONFIRM',
  draftRevision: number,
  expectedRevisions: RevisionVector,
): WorkflowRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions,
    messageType: 'command.request',
    payload: {
      characterDraftId: harness.characterDraftId,
      decision,
      draftRevision,
      sourceFormId,
      stage: 'STAT_ROLLS',
      wizardCheckpointId: harness.wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  };
}

const CANONICAL_SET_ENTRY_INDEX_BY_STAT = {
  C: 6,
  D: 1,
  I: 4,
  M: 2,
  S: 0,
  W: 5,
  Z: 3,
} as const;
type TestStatMap = Readonly<Record<'C' | 'D' | 'I' | 'M' | 'S' | 'W' | 'Z', number>>;

function statAssignmentRequest(
  commandId: string,
  harness: JourneyHarness,
  draftRevision: number,
  expectedRevisions: RevisionVector,
  assignment:
    { readonly pointBuyStats: TestStatMap } | { readonly setEntryIndexByStat: TestStatMap },
): WorkflowRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions,
    messageType: 'command.request',
    payload: {
      characterDraftId: harness.characterDraftId,
      draftRevision,
      sourceFormId: 'CHR-009',
      stage: 'STAT_ASSIGNMENT',
      wizardCheckpointId: harness.wizardCheckpointId,
      ...assignment,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  };
}

function pureClassDecisionRequest(
  commandId: string,
  harness: JourneyHarness,
  pureClass: 'SEEKER' | 'SOLDIER' | 'STALKER',
  draftRevision: number,
  expectedRevisions: RevisionVector,
): WorkflowRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions,
    messageType: 'command.request',
    payload: {
      characterDraftId: harness.characterDraftId,
      draftRevision,
      pureClass,
      sourceFormId: 'CHR-011',
      stage: 'STAT_ASSIGNMENT',
      wizardCheckpointId: harness.wizardCheckpointId,
    },
    protocolVersion: WIRE_PROTOCOL_VERSION,
    role: 'player',
    workflowCommandId: CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  };
}

async function openWarning(
  harness: JourneyHarness,
  vocabulary: ProtocolVocabulary & WireV2Vocabulary,
  committed: CommittedNonCriticalSet,
  requestId: string,
): Promise<Extract<HostToClientV2Message, { readonly messageType: 'projection.snapshot' }>> {
  const sourceFormId = committed.setResult.receipt.result['nextFormId'];
  if (
    sourceFormId !== 'CHR-005' &&
    sourceFormId !== 'CHR-006' &&
    sourceFormId !== 'CHR-007' &&
    sourceFormId !== 'CHR-008'
  ) {
    throw new Error('set result did not reach a decision form');
  }
  const expectedProjectionRevision =
    committed.setDestination.messageType === 'projection.snapshot'
      ? committed.setDestination.revisions.projectionRevision
      : committed.setResult.receipt.revisions.projectionRevision;
  const opened = await sendV2(
    harness.socket,
    formAction(
      requestId,
      sourceFormId,
      `${sourceFormId}::CTA::002` as FormActionIntentV2Message['actionKey'],
      expectedProjectionRevision,
    ),
    vocabulary,
  );
  if (opened.messageType !== 'projection.snapshot') throw new Error('CHR-028 did not open');
  return opened;
}

function nextAttemptJourney(
  previous: CommittedNonCriticalSet,
  result: CommandResultMessage,
  destination: HostToClientV2Message,
): Chr003Journey {
  return {
    branchUuid: previous.branchUuid,
    destination,
    methodRequest: previous.methodRequest,
    methodResult: result,
    setRollRequestId: resultString(result, 'nextSetRollRequestIdOrNull'),
    statMethod: previous.statMethod,
  };
}

describe('durable character creation decisions', () => {
  let consequenceCatalog: Awaited<ReturnType<typeof loadCreationDecisionConsequenceCatalog>>;
  let skillCatalog: Awaited<ReturnType<typeof loadSkillStageCatalog>>;
  let staticRoot: string;
  let vocabulary: ProtocolVocabulary & WireV3Vocabulary;

  beforeAll(async () => {
    staticRoot = await mkdtemp(join(tmpdir(), 'symbiosis-set-decide-host-'));
    await writeFile(join(staticRoot, 'index.html'), '<main>set decide</main>', 'utf8');
    skillCatalog = await loadSkillStageCatalog(PROJECT_ROOT);
    consequenceCatalog = await loadCreationDecisionConsequenceCatalog(PROJECT_ROOT, skillCatalog);
    vocabulary = await loadProtocolVocabulary(PROJECT_ROOT);
  });

  afterAll(async () => {
    await rm(staticRoot, { force: true, recursive: true });
  });

  it('traverses CHR-001 → CHR-010 → CHR-016 → CHR-036 → CHR-002 → CHR-003 and restores the pending set', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'normal');
    let app = harness.app;
    let socket = harness.socket;
    let frames: Promise<readonly string[]>;
    try {
      const raceRequest = setDecideRequest(
        'normal-race',
        'CHR-010',
        harness.characterDraftId,
        harness.wizardCheckpointId,
        resultRevision(harness.checkpointResult, 'draftRevision'),
        harness.checkpointResult.receipt.revisions,
        { raceChoice: 'UNITED' },
      );
      const [raceTerminal, chr016] = await sendCommand(socket, raceRequest, vocabulary);
      const raceResult = committedResult(raceTerminal);
      expect(raceResult).toMatchObject({
        receipt: {
          result: {
            checkpointRevision: 1,
            draftRevision: 2,
            nextFormId: 'CHR-016',
            raceChoice: 'UNITED',
            sourceFormId: 'CHR-010',
            stage: 'RACE_AND_METHOD',
          },
          revisions: { ...ZERO_REVISIONS, projectionRevision: 1, stateRevision: 1 },
        },
      });
      expect(chr016).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-016::CTA::003', 'CHR-016::CTA::004'],
            formId: 'CHR-016',
            roleFilteredPayload: {
              choiceLockStatus: 'UNLOCKED',
              draftRevision: 2,
              modeConsequenceOptions: consequenceCatalog.modeConsequenceOptionsByRace.UNITED,
              modeConsequences: null,
              raceChoice: 'UNITED',
              symbiontAcquisitionMode: null,
            },
          },
        },
        revisions: raceResult.receipt.revisions,
      });

      const modeRequest = setDecideRequest(
        'normal-mode',
        'CHR-016',
        harness.characterDraftId,
        harness.wizardCheckpointId,
        resultRevision(raceResult, 'draftRevision'),
        raceResult.receipt.revisions,
        { symbiontAcquisitionMode: 'MANUAL' },
      );
      const [modeTerminal, chr036] = await sendCommand(socket, modeRequest, vocabulary);
      const modeResult = committedResult(modeTerminal);
      expect(modeResult).toMatchObject({
        receipt: {
          result: {
            checkpointRevision: 2,
            draftRevision: 3,
            nextFormId: 'CHR-036',
            sourceFormId: 'CHR-016',
            symbiontAcquisitionMode: 'MANUAL',
          },
          revisions: { ...ZERO_REVISIONS, projectionRevision: 2, stateRevision: 2 },
        },
      });
      expect(chr036).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-036::CTA::004', 'CHR-036::CTA::005'],
            formId: 'CHR-036',
            roleFilteredPayload: {
              appliesToAllCreationRolls: true,
              choiceLockStatus: 'UNLOCKED',
              diceInputMode: null,
              draftRevision: 3,
            },
          },
        },
        revisions: modeResult.receipt.revisions,
      });

      const diceRequest = setDecideRequest(
        'normal-dice',
        'CHR-036',
        harness.characterDraftId,
        harness.wizardCheckpointId,
        resultRevision(modeResult, 'draftRevision'),
        modeResult.receipt.revisions,
        { diceInputMode: 'AUTO' },
      );
      const [diceTerminal, chr002] = await sendCommand(socket, diceRequest, vocabulary);
      const diceResult = committedResult(diceTerminal);
      expect(diceResult).toMatchObject({
        receipt: {
          result: {
            checkpointRevision: 3,
            diceInputMode: 'AUTO',
            draftRevision: 4,
            nextFormId: 'CHR-002',
            sourceFormId: 'CHR-036',
          },
          revisions: { ...ZERO_REVISIONS, projectionRevision: 3, stateRevision: 3 },
        },
      });
      expect(chr002).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-002::CTA::003', 'CHR-002::CTA::004', 'CHR-002::CTA::005'],
            formId: 'CHR-002',
            roleFilteredPayload: {
              choiceLockStatus: 'UNLOCKED',
              draftRevision: 4,
              methodConsequenceOptions: consequenceCatalog.methodConsequenceOptions,
              methodConsequences: null,
              statMethod: null,
            },
          },
        },
        revisions: diceResult.receipt.revisions,
      });

      const methodRequest = setDecideRequest(
        'normal-method',
        'CHR-002',
        harness.characterDraftId,
        harness.wizardCheckpointId,
        resultRevision(diceResult, 'draftRevision'),
        diceResult.receipt.revisions,
        { statMethod: 'CLASSIC' },
      );
      const [methodTerminal, chr003] = await sendCommand(socket, methodRequest, vocabulary);
      const methodResult = committedResult(methodTerminal);
      expect(methodResult).toMatchObject({
        receipt: {
          result: {
            checkpointRevision: 4,
            draftRevision: 5,
            nextFormId: 'CHR-003',
            sourceFormId: 'CHR-002',
            stage: 'RACE_AND_METHOD',
            statMethod: 'CLASSIC',
          },
          revisions: { ...ZERO_REVISIONS, projectionRevision: 4, stateRevision: 4 },
        },
      });
      expect(methodResult.receipt.result['branchUuid']).toEqual(expect.any(String));
      expect(methodResult.receipt.result['setRollRequestId']).toEqual(expect.any(String));
      expect(chr003).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-003::CTA::002'],
            formId: 'CHR-003',
            roleFilteredPayload: {
              attemptIndex: 1,
              branchUuid: methodResult.receipt.result['branchUuid'],
              characterDraftId: harness.characterDraftId,
              diceInputModeSnapshot: 'AUTO',
              draftRevision: 5,
              facesOrManualInputs: [null, null, null, null, null, null, null],
              naturalCriticalQueue: [],
              setRollReceiptId: null,
              setRollRequestId: methodResult.receipt.result['setRollRequestId'],
              shownResultLocked: false,
              statMethod: 'CLASSIC',
              wizardCheckpointId: harness.wizardCheckpointId,
            },
          },
        },
        revisions: methodResult.receipt.revisions,
      });

      socket.terminate();
      await app.close();
      const restartRuntime = revisionRuntime();
      let restartReceipts = 0;
      app = await createHost({
        advanceRevisions: restartRuntime.advance,
        allocateCreationBranchUuid: () => '50000000-0000-4000-8000-000000000001',
        allocateCreationRollRequestId: () => 'restart-roll-request',
        allocateContextId: () => '30000000-0000-4000-8000-000000000001',
        allocateLocalCharacterId: () => '40000000-0000-4000-8000-000000000001',
        allocateReceiptId: () => `restart-receipt-${String(++restartReceipts)}`,
        allocateWizardCheckpointId: () => 'restart-wizard',
        database: harness.database,
        onFrameError: (error) => {
          throw error;
        },
        projectRoot: PROJECT_ROOT,
        readRevisions: restartRuntime.read,
        sampleCreationD20: () => 10,
        staticRoot,
      });
      await startHost(app, { interface: '127.0.0.1', port: 0 });
      socket = await app.injectWS('/state');
      frames = receiveFrames(socket, 7);
      socket.send(
        clientTextV2(
          reconnect(harness.deviceId, 'normal-restart', [
            harness.identityCommand.commandId,
            raceRequest.commandId,
            modeRequest.commandId,
            diceRequest.commandId,
            methodRequest.commandId,
          ]),
          vocabulary,
        ),
      );
      const recovered = await frames;
      expect(recovered.slice(0, 5).map((text) => hostMessage(text, vocabulary))).toEqual([
        {
          lifecycleState: 'IDEMPOTENT_REPLAY',
          messageType: 'command.replay',
          protocolVersion: 1,
          receipt: harness.checkpointResult.receipt,
        },
        {
          lifecycleState: 'IDEMPOTENT_REPLAY',
          messageType: 'command.replay',
          protocolVersion: 1,
          receipt: raceResult.receipt,
        },
        {
          lifecycleState: 'IDEMPOTENT_REPLAY',
          messageType: 'command.replay',
          protocolVersion: 1,
          receipt: modeResult.receipt,
        },
        {
          lifecycleState: 'IDEMPOTENT_REPLAY',
          messageType: 'command.replay',
          protocolVersion: 1,
          receipt: diceResult.receipt,
        },
        {
          lifecycleState: 'IDEMPOTENT_REPLAY',
          messageType: 'command.replay',
          protocolVersion: 1,
          receipt: methodResult.receipt,
        },
      ]);
      expect(hostMessageV2(recovered[6] ?? '', vocabulary)).toMatchObject({
        presentation: {
          assignment: { correlationId: 'normal-restart', reason: 'RECONNECT' },
          base: { formId: 'CHR-003', roleFilteredPayload: { draftRevision: 5 } },
        },
        revisions: methodResult.receipt.revisions,
      });

      frames = receiveFrames(socket, 2);
      socket.send(clientText(raceRequest, vocabulary));
      const oldDirectReplay = await frames;
      expect(hostMessage(oldDirectReplay[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'command.replay',
        receipt: raceResult.receipt,
      });
      expect(hostMessageV2(oldDirectReplay[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          assignment: { correlationId: raceRequest.commandId, reason: 'COMMAND_DESTINATION' },
          base: { formId: 'CHR-003' },
        },
        revisions: methodResult.receipt.revisions,
      });
      expect(restartReceipts).toBe(0);
    } finally {
      socket.terminate();
      await app.close();
      harness.database.close();
    }
  });

  it('keeps the first displayed set immutable when Back is forged', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'no-reroll-back');
    try {
      const committed = await commitNonCriticalSet(harness, vocabulary, 'no-reroll-back');
      const checkpoint = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      const sampleCalls = harness.sampleCalls();
      const receiptAllocations = harness.receiptAllocations();
      const shellWrites = harness.runtime.writes.length;

      const refusal = await sendV2(
        harness.socket,
        formAction(
          'no-reroll-back-action',
          'CHR-003',
          'CHR-003::CTA::001',
          committed.setResult.receipt.revisions.projectionRevision,
        ),
        vocabulary,
      );
      expect(refusal).toMatchObject({
        messageType: 'navigation.form-action.refusal',
        navigationRequestId: 'no-reroll-back-action',
        presentationUnchanged: true,
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        revisions: committed.setResult.receipt.revisions,
      });
      expect(harness.sampleCalls()).toBe(sampleCalls);
      expect(harness.receiptAllocations()).toBe(receiptAllocations);
      expect(harness.runtime.writes).toHaveLength(shellWrites);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpoint,
      );
    } finally {
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('restores the first displayed set on browser refresh without sampling again', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'no-reroll-refresh');
    let refreshSocket: WebSocket | undefined;
    try {
      const committed = await commitNonCriticalSet(harness, vocabulary, 'no-reroll-refresh');
      const checkpoint = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      const sampleCalls = harness.sampleCalls();
      const receiptAllocations = harness.receiptAllocations();
      const shellWrites = harness.runtime.writes.length;
      refreshSocket = await harness.app.injectWS('/state');
      const frames = receiveFrames(refreshSocket, 2);
      refreshSocket.send(
        clientTextV2(reconnect(harness.deviceId, 'no-reroll-refresh-reconnect'), vocabulary),
      );
      const recovered = await frames;
      expect(hostMessageV2(recovered[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          assignment: {
            correlationId: 'no-reroll-refresh-reconnect',
            reason: 'RECONNECT',
          },
          base: {
            availableActionKeys: ['CHR-005::CTA::001', 'CHR-005::CTA::002'],
            formId: 'CHR-005',
            roleFilteredPayload: {
              acceptedSetReceiptId: committed.setResult.receipt.receiptId,
              decision: 'PENDING',
            },
          },
        },
        revisions: committed.setResult.receipt.revisions,
      });
      expect(harness.sampleCalls()).toBe(sampleCalls);
      expect(harness.receiptAllocations()).toBe(receiptAllocations);
      expect(harness.runtime.writes).toHaveLength(shellWrites);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpoint,
      );
    } finally {
      refreshSocket?.terminate();
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('forgets transient CANCEL after restart but recovers the durable current set', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'no-reroll-reconnect');
    let originalClosed = false;
    let restartedApp: FastifyInstance | undefined;
    let restartedSocket: WebSocket | undefined;
    let secondReconnectSocket: WebSocket | undefined;
    try {
      const committed = await commitNonCriticalSet(harness, vocabulary, 'no-reroll-reconnect');
      const opened = await openWarning(harness, vocabulary, committed, 'restart-cancel-open');
      const cancel = statDecisionRequest(
        'restart-transient-cancel',
        harness,
        'CHR-028',
        'CANCEL',
        resultRevision(committed.setResult, 'draftRevision'),
        opened.revisions,
      );
      const [cancelTerminal, closed] = await sendCommand(harness.socket, cancel, vocabulary);
      const cancelResult = committedResult(cancelTerminal);
      const checkpoint = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      expect(checkpoint.statRollStage?.attempts[0]?.decisionRecordOrNull).toBeNull();
      harness.socket.terminate();
      await harness.app.close();
      originalClosed = true;

      const restartRuntime = revisionRuntime();
      let restartReceipts = 0;
      let restartSamples = 0;
      restartedApp = await createHost({
        advanceRevisions: restartRuntime.advance,
        allocateCreationBranchUuid: () => '60000000-0000-4000-8000-000000000001',
        allocateCreationRollRequestId: () => 'no-reroll-restart-request',
        allocateContextId: () => '60000000-0000-4000-8000-000000000002',
        allocateLocalCharacterId: () => '60000000-0000-4000-8000-000000000003',
        allocateReceiptId: () => `no-reroll-restart-receipt-${String(++restartReceipts)}`,
        allocateWizardCheckpointId: () => 'no-reroll-restart-wizard',
        database: harness.database,
        onFrameError: (error) => {
          throw error;
        },
        projectRoot: PROJECT_ROOT,
        readRevisions: restartRuntime.read,
        sampleCreationD20: () => {
          restartSamples += 1;
          return 20;
        },
        staticRoot,
      });
      await startHost(restartedApp, { interface: '127.0.0.1', port: 0 });
      restartedSocket = await restartedApp.injectWS('/state');
      let frames = receiveFrames(restartedSocket, 4);
      restartedSocket.send(
        clientTextV2(
          reconnect(harness.deviceId, 'no-reroll-restart-reconnect', [
            cancel.commandId,
            committed.setRequest.commandId,
          ]),
          vocabulary,
        ),
      );
      const recovered = await frames;
      expect(hostMessage(recovered[0] ?? '', vocabulary)).toMatchObject({
        commandId: cancel.commandId,
        messageType: 'command.refusal',
        refusal: {
          code: 'UNRECOGNIZED',
          path: '$.unacknowledgedCommandIds[0]',
          value: cancel.commandId,
        },
      });
      expect(hostMessage(recovered[1] ?? '', vocabulary)).toEqual({
        lifecycleState: 'IDEMPOTENT_REPLAY',
        messageType: 'command.replay',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        receipt: committed.setResult.receipt,
      });
      expect(hostMessageV2(recovered[3] ?? '', vocabulary)).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-005::CTA::001', 'CHR-005::CTA::002'],
            formId: 'CHR-005',
            roleFilteredPayload: {
              acceptedSetReceiptId: committed.setResult.receipt.receiptId,
              decision: 'PENDING',
            },
          },
        },
        revisions: closed.revisions,
      });
      expect(restartSamples).toBe(0);
      expect(restartReceipts).toBe(0);
      expect(restartRuntime.writes).toHaveLength(0);

      secondReconnectSocket = await restartedApp.injectWS('/state');
      frames = receiveFrames(secondReconnectSocket, 2);
      secondReconnectSocket.send(
        clientTextV2(reconnect(harness.deviceId, 'no-reroll-second-reconnect'), vocabulary),
      );
      const second = await frames;
      expect(hostMessageV2(second[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          assignment: {
            correlationId: 'no-reroll-second-reconnect',
            reason: 'RECONNECT',
          },
          base: {
            formId: 'CHR-005',
            roleFilteredPayload: {
              acceptedSetReceiptId: committed.setResult.receipt.receiptId,
              decision: 'PENDING',
            },
          },
        },
        revisions: closed.revisions,
      });
      expect(restartSamples).toBe(0);
      expect(restartReceipts).toBe(0);
      expect(restartRuntime.writes).toHaveLength(0);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpoint,
      );
      expect(cancelResult.receipt.result['decision']).toBe('CANCEL');
    } finally {
      secondReconnectSocket?.terminate();
      restartedSocket?.terminate();
      harness.socket.terminate();
      if (restartedApp !== undefined) await restartedApp.close();
      if (!originalClosed) await harness.app.close();
      harness.database.close();
    }
  });

  it('returns the stored first set on direct exact command replay', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'no-reroll-replay');
    try {
      const committed = await commitNonCriticalSet(harness, vocabulary, 'no-reroll-replay');
      const checkpoint = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      const sampleCalls = harness.sampleCalls();
      const receiptAllocations = harness.receiptAllocations();
      const shellWrites = harness.runtime.writes.length;
      const frames = receiveFrames(harness.socket, 2);
      harness.socket.send(clientText(committed.setRequest, vocabulary));
      const replayed = await frames;
      expect(hostMessage(replayed[0] ?? '', vocabulary)).toEqual({
        lifecycleState: 'IDEMPOTENT_REPLAY',
        messageType: 'command.replay',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        receipt: committed.setResult.receipt,
      });
      expect(hostMessageV2(replayed[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          assignment: {
            correlationId: committed.setRequest.commandId,
            reason: 'COMMAND_DESTINATION',
          },
          base: {
            availableActionKeys: ['CHR-005::CTA::001', 'CHR-005::CTA::002'],
            formId: 'CHR-005',
            roleFilteredPayload: {
              acceptedSetReceiptId: committed.setResult.receipt.receiptId,
              decision: 'PENDING',
            },
          },
        },
        revisions: committed.setResult.receipt.revisions,
      });
      expect(harness.sampleCalls()).toBe(sampleCalls);
      expect(harness.receiptAllocations()).toBe(receiptAllocations);
      expect(harness.runtime.writes).toHaveLength(shellWrites);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpoint,
      );
    } finally {
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('rejects a changed payload under the committed roll command ID without new work', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'no-reroll-conflict');
    try {
      const committed = await commitNonCriticalSet(harness, vocabulary, 'no-reroll-conflict');
      const checkpoint = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      const sampleCalls = harness.sampleCalls();
      const receiptAllocations = harness.receiptAllocations();
      const shellWrites = harness.runtime.writes.length;
      const changed = statSetRollRequest(committed.setRequest.commandId, harness, committed, {
        branchUuid: 'changed-branch-same-command',
      });
      const frames = receiveFrames(harness.socket, 1);
      harness.socket.send(clientText(changed, vocabulary));
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: committed.setRequest.commandId,
        messageType: 'command.refusal',
        refusal: {
          code: 'IDEMPOTENCY_CONFLICT',
          commandId: committed.setRequest.commandId,
          detail: 'PAYLOAD_MISMATCH',
        },
        revisions: committed.setResult.receipt.revisions,
      });
      expect(harness.sampleCalls()).toBe(sampleCalls);
      expect(harness.receiptAllocations()).toBe(receiptAllocations);
      expect(harness.runtime.writes).toHaveLength(shellWrites);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpoint,
      );
    } finally {
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('rechecks player authority after receipt allocation and before the first sample', async () => {
    const frameErrors: unknown[] = [];
    const harness = await createJourneyHarness(
      staticRoot,
      vocabulary,
      'roll-authority-recheck',
      [],
      {
        onFrameError: (error) => frameErrors.push(error),
        onReceiptAllocation: (database, count) => {
          if (count === 6) resetDeviceIdentity(database, () => undefined);
        },
      },
    );
    try {
      const journey = await advanceToChr003(harness, vocabulary, 'roll-authority-recheck');
      const checkpoint = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      const receiptAllocations = harness.receiptAllocations();
      const shellWrites = harness.runtime.writes.length;
      const request = statSetRollRequest('roll-authority-recheck-set', harness, journey);
      const frames = receiveFrames(harness.socket, 1);
      harness.socket.send(clientText(request, vocabulary));
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: request.commandId,
        messageType: 'command.refusal',
        refusal: { code: 'GUARD_REJECTED' },
        revisions: journey.methodResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(receiptAllocations + 1);
      expect(harness.sampleCalls()).toBe(0);
      expect(harness.runtime.writes).toHaveLength(shellWrites);
      expect(frameErrors).toHaveLength(1);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpoint,
      );
    } finally {
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('rejects a branch-switch attempt after first display without rerolling', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'no-reroll-branch');
    try {
      const committed = await commitNonCriticalSet(harness, vocabulary, 'no-reroll-branch');
      const checkpoint = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      const sampleCalls = harness.sampleCalls();
      const receiptAllocations = harness.receiptAllocations();
      const shellWrites = harness.runtime.writes.length;
      const switched = statSetRollRequest('no-reroll-branch-switch', harness, committed, {
        branchUuid: 'different-branch-uuid',
        draftRevision: resultRevision(committed.setResult, 'draftRevision'),
        expectedRevisions: committed.setResult.receipt.revisions,
      });
      const frames = receiveFrames(harness.socket, 1);
      harness.socket.send(clientText(switched, vocabulary));
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: switched.commandId,
        messageType: 'command.refusal',
        refusal: { code: 'GUARD_REJECTED' },
        revisions: committed.setResult.receipt.revisions,
      });
      expect(harness.sampleCalls()).toBe(sampleCalls);
      expect(harness.receiptAllocations()).toBe(receiptAllocations);
      expect(harness.runtime.writes).toHaveLength(shellWrites);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpoint,
      );
    } finally {
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('opens CHR-028 and closes CANCEL with zero durable decision plus process-local replay', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'cancel-dialog');
    try {
      const committed = await commitNonCriticalSet(harness, vocabulary, 'cancel-dialog');
      const beforeOpen = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      const opened = await openWarning(harness, vocabulary, committed, 'cancel-dialog-open');
      expect(opened).toMatchObject({
        presentation: {
          base: { formId: 'CHR-005' },
          layers: [
            {
              availableActionKeys: ['CHR-028::CTA::001', 'CHR-028::CTA::002'],
              formId: 'CHR-028',
              formType: 'dialog',
              roleFilteredPayload: {
                abandonedSetReceiptIds: [committed.setResult.receipt.receiptId],
                decision: null,
                decisionReceiptIdOrNull: null,
                irreversibleConsequences: {
                  creationCriticalConsequencesDiscarded: true,
                  exactPointBuyTotalOrNull: 90,
                  nextAttemptIndexOrNull: null,
                  setValuesDiscarded: true,
                },
                originDecisionFormId: 'CHR-005',
                transitionKind: 'CLASSIC_TO_90',
              },
              routeBindings: [],
              routeTemplate: '@dialog/chr-028',
            },
          ],
        },
        revisions: {
          ...committed.setResult.receipt.revisions,
          projectionRevision: committed.setResult.receipt.revisions.projectionRevision + 1,
        },
      });
      const afterOpen = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      expect(afterOpen.checkpoint.checkpointRevision).toBe(
        beforeOpen.checkpoint.checkpointRevision,
      );
      expect(afterOpen.receipt).toEqual(beforeOpen.receipt);

      const cancel = statDecisionRequest(
        'cancel-dialog-command',
        harness,
        'CHR-028',
        'CANCEL',
        resultRevision(committed.setResult, 'draftRevision'),
        opened.revisions,
      );
      const [terminal, closed] = await sendCommand(harness.socket, cancel, vocabulary);
      const cancelResult = committedResult(terminal);
      expect(cancelResult.receipt).toMatchObject({
        result: {
          decision: 'CANCEL',
          decisionReceiptIdOrNull: null,
          nextFormId: 'CHR-005',
          originDecisionFormId: 'CHR-005',
          sourceFormId: 'CHR-028',
        },
        revisions: opened.revisions,
      });
      expect(closed).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-005::CTA::001', 'CHR-005::CTA::002'],
            formId: 'CHR-005',
            roleFilteredPayload: { decision: 'PENDING', decisionReceiptIdOrNull: null },
          },
          layers: [],
        },
        revisions: {
          ...opened.revisions,
          projectionRevision: opened.revisions.projectionRevision + 1,
        },
      });
      const afterCancel = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      expect(afterCancel.checkpoint.checkpointRevision).toBe(
        beforeOpen.checkpoint.checkpointRevision,
      );
      expect(afterCancel.statRollStage?.attempts[0]?.decisionRecordOrNull).toBeNull();

      const allocations = harness.receiptAllocations();
      const replayFrames = receiveFrames(harness.socket, 2);
      harness.socket.send(clientText(cancel, vocabulary));
      const replay = await replayFrames;
      expect(hostMessage(replay[0] ?? '', vocabulary)).toEqual({
        lifecycleState: 'IDEMPOTENT_REPLAY',
        messageType: 'command.replay',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        receipt: cancelResult.receipt,
      });
      expect(hostMessageV2(replay[1] ?? '', vocabulary)).toMatchObject({
        presentation: { base: { formId: 'CHR-005' }, layers: [] },
        revisions: closed.revisions,
      });
      expect(harness.receiptAllocations()).toBe(allocations);

      const changed = statDecisionRequest(
        cancel.commandId,
        harness,
        'CHR-028',
        'CONFIRM',
        resultRevision(committed.setResult, 'draftRevision'),
        opened.revisions,
      );
      const conflictFrames = receiveFrames(harness.socket, 1);
      harness.socket.send(clientText(changed, vocabulary));
      expect(hostMessage((await conflictFrames)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'command.refusal',
        refusal: { code: 'IDEMPOTENCY_CONFLICT', detail: 'PAYLOAD_MISMATCH' },
      });
      expect(harness.receiptAllocations()).toBe(allocations);

      const collisionOpened = await openWarning(
        harness,
        vocabulary,
        { ...committed, setDestination: closed },
        'cancel-dialog-collision-open',
      );
      const collisionCheckpoint = loadCreationWizardCheckpoint(
        harness.database,
        harness.characterDraftId,
      );
      for (const decision of ['CONFIRM', 'CANCEL'] as const) {
        const receiptAsCommand = statDecisionRequest(
          cancelResult.receipt.receiptId,
          harness,
          'CHR-028',
          decision,
          resultRevision(committed.setResult, 'draftRevision'),
          collisionOpened.revisions,
        );
        const collisionFrames = receiveFrames(harness.socket, 1);
        harness.socket.send(clientText(receiptAsCommand, vocabulary));
        expect(hostMessage((await collisionFrames)[0] ?? '', vocabulary)).toMatchObject({
          commandId: cancelResult.receipt.receiptId,
          messageType: 'command.refusal',
          refusal: { code: 'GUARD_REJECTED' },
        });
      }
      expect(harness.receiptAllocations()).toBe(allocations);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        collisionCheckpoint,
      );
    } finally {
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('accepts the current set into the real rolled-bijection CHR-009 projection', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'accept-set');
    let limitedSocket: WebSocket | undefined;
    let recoverySocket: WebSocket | undefined;
    try {
      const committed = await commitNonCriticalSet(harness, vocabulary, 'accept-set');
      const request = statDecisionRequest(
        'accept-set-command',
        harness,
        'CHR-005',
        'ACCEPT_SET',
        resultRevision(committed.setResult, 'draftRevision'),
        committed.setResult.receipt.revisions,
      );
      const [terminal, destination] = await sendCommand(harness.socket, request, vocabulary);
      const result = committedResult(terminal);
      expect(result.receipt).toMatchObject({
        result: {
          acceptedSetReceiptId: committed.setResult.receipt.receiptId,
          assignmentMode: 'ROLLED_BIJECTION',
          decision: 'ACCEPT_SET',
          nextFormId: 'CHR-009',
          sourceFormId: 'CHR-005',
        },
      });
      expect(destination).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-009::CTA::002'],
            formId: 'CHR-009',
            roleFilteredPayload: {
              C: null,
              D: null,
              I: null,
              M: null,
              S: null,
              W: null,
              Z: null,
              assignmentMode: 'ROLLED_BIJECTION',
              assignmentValidation: null,
              bijectionProofOrExactSum: {
                assignedSetEntryIndexByStat: null,
                kind: 'ROLLED_BIJECTION',
                sourceEntries: Array.from({ length: 7 }, (_, setEntryIndex) => ({
                  creationCriticalPenaltyOrNull: null,
                  setEntryIndex,
                  value: 10,
                })),
              },
              commandId: null,
              eachValueRange: null,
              raceChoice: 'UNITED',
              sourceSetReceiptIdOrNull: committed.setResult.receipt.receiptId,
            },
          },
          layers: [],
        },
        revisions: result.receipt.revisions,
      });
      const durable = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      expect(durable.nextStageEnvelope.formId).toBe('CHR-009');
      expect(durable.statRollStage?.attempts[0]?.decisionRecordOrNull).toMatchObject({
        derived: { assignmentMode: 'ROLLED_BIJECTION', decision: 'ACCEPT_SET' },
      });

      limitedSocket = await harness.app.injectWS('/state');
      let frames = receiveFrames(limitedSocket, 2);
      limitedSocket.send(
        clientTextV2(
          reconnect(
            harness.deviceId,
            'accept-set-without-checkpoint',
            [],
            WITHOUT_WIZARD_CHECKPOINT,
          ),
          vocabulary,
        ),
      );
      const limited = await frames;
      expect(hostMessageV2(limited[1] ?? '', vocabulary)).toMatchObject({
        presentation: { base: { availableActionKeys: [], formId: 'CHR-009' } },
        revisions: result.receipt.revisions,
      });
      const forgedAssignmentRequest = statAssignmentRequest(
        'accept-set-forged-assignment',
        harness,
        resultRevision(result, 'draftRevision'),
        result.receipt.revisions,
        { setEntryIndexByStat: CANONICAL_SET_ENTRY_INDEX_BY_STAT },
      );
      const allocationsBeforeForged = harness.receiptAllocations();
      frames = receiveFrames(limitedSocket, 1);
      limitedSocket.send(clientText(forgedAssignmentRequest, vocabulary));
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: forgedAssignmentRequest.commandId,
        messageType: 'command.refusal',
        refusal: { code: 'GUARD_REJECTED' },
        revisions: result.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(allocationsBeforeForged);
      limitedSocket.terminate();
      limitedSocket = undefined;

      const assignmentRequest = statAssignmentRequest(
        'accept-set-assignment',
        harness,
        resultRevision(result, 'draftRevision'),
        result.receipt.revisions,
        { setEntryIndexByStat: CANONICAL_SET_ENTRY_INDEX_BY_STAT },
      );
      const [assignmentTerminal, chr012] = await sendCommand(
        harness.socket,
        assignmentRequest,
        vocabulary,
      );
      const assignmentResult = committedResult(assignmentTerminal);
      const baseStats = { C: 10, D: 10, I: 10, M: 10, S: 10, W: 10, Z: 10 };
      expect(assignmentResult).toMatchObject({
        receipt: {
          result: {
            assignmentMode: 'ROLLED_BIJECTION',
            baseStats,
            nextFormId: 'CHR-012',
            raceChoice: 'UNITED',
            rolledAssignmentsOrNull: [
              { setEntryIndex: 0, statCode: 'S', value: 10 },
              { setEntryIndex: 1, statCode: 'D', value: 10 },
              { setEntryIndex: 2, statCode: 'M', value: 10 },
              { setEntryIndex: 3, statCode: 'Z', value: 10 },
              { setEntryIndex: 4, statCode: 'I', value: 10 },
              { setEntryIndex: 5, statCode: 'W', value: 10 },
              { setEntryIndex: 6, statCode: 'C', value: 10 },
            ],
            sourceFormId: 'CHR-009',
            sourceSetReceiptIdOrNull: committed.setResult.receipt.receiptId,
            stage: 'STAT_ASSIGNMENT',
          },
        },
      });
      expect(chr012).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: [],
            formId: 'CHR-012',
            roleFilteredPayload: {
              baseStats,
              classModifiersOrNull: null,
              commandId: null,
              mandatoryClassSkillOrNull: null,
              raceModifiers: [
                { delta: -7, statCode: 'S' },
                { delta: -10, statCode: 'M' },
                { delta: -10, statCode: 'Z' },
              ],
              skillStageStats: { ...baseStats, M: 0, S: 3, Z: 0 },
              symbiontModifiersExcluded: true,
            },
          },
          layers: [],
        },
        revisions: assignmentResult.receipt.revisions,
      });

      const allocationsAfterAssignment = harness.receiptAllocations();
      frames = receiveFrames(harness.socket, 2);
      harness.socket.send(clientText(assignmentRequest, vocabulary));
      const replay = await frames;
      expect(hostMessage(replay[0] ?? '', vocabulary)).toMatchObject({
        lifecycleState: 'IDEMPOTENT_REPLAY',
        receipt: assignmentResult.receipt,
      });
      expect(hostMessageV2(replay[1] ?? '', vocabulary)).toMatchObject({
        presentation: { base: { availableActionKeys: [], formId: 'CHR-012' }, layers: [] },
        revisions: assignmentResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(allocationsAfterAssignment);

      recoverySocket = await harness.app.injectWS('/state');
      frames = receiveFrames(recoverySocket, 2);
      recoverySocket.send(
        clientTextV2(reconnect(harness.deviceId, 'accept-set-assignment-reconnect'), vocabulary),
      );
      const recovered = await frames;
      expect(hostMessageV2(recovered[1] ?? '', vocabulary)).toMatchObject({
        presentation: { base: { availableActionKeys: [], formId: 'CHR-012' }, layers: [] },
        revisions: assignmentResult.receipt.revisions,
      });
    } finally {
      recoverySocket?.terminate();
      limitedSocket?.terminate();
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it.each(['direct repeated commandId', 'reconnect', 'refresh', 'replay'] as const)(
    'does not resurrect WARNING after CONFIRM through %s',
    async (recoveryPath) => {
      const suffix = `confirm-${recoveryPath.replaceAll(' ', '-')}`;
      const harness = await createJourneyHarness(staticRoot, vocabulary, suffix);
      let recoverySocket: WebSocket | undefined;
      try {
        const committed = await commitNonCriticalSet(harness, vocabulary, suffix);
        const opened = await openWarning(harness, vocabulary, committed, `${suffix}-open`);
        const request = statDecisionRequest(
          `${suffix}-command`,
          harness,
          'CHR-028',
          'CONFIRM',
          resultRevision(committed.setResult, 'draftRevision'),
          opened.revisions,
        );
        const [terminal, committedPresentation] = await sendCommand(
          harness.socket,
          request,
          vocabulary,
        );
        const result = committedResult(terminal);
        expect(result.receipt).toMatchObject({
          result: {
            alternateDecision: 'USE_POINT_BUY_90',
            assignmentModeOrNull: 'POINT_BUY_90',
            decision: 'CONFIRM',
            nextFormId: 'CHR-009',
            nextSetRollRequestIdOrNull: null,
            originDecisionFormId: 'CHR-005',
          },
        });
        expect(committedPresentation).toMatchObject({
          presentation: {
            base: {
              availableActionKeys: ['CHR-009::CTA::002'],
              formId: 'CHR-009',
              roleFilteredPayload: {
                assignmentMode: 'POINT_BUY_90',
                assignmentValidation: null,
                bijectionProofOrExactSum: {
                  actualTotal: null,
                  kind: 'EXACT_SUM',
                  requiredTotal: 90,
                },
                eachValueRange: { maximum: 20, minimum: 1 },
                raceChoice: 'UNITED',
                sourceSetReceiptIdOrNull: null,
              },
            },
            layers: [],
          },
          revisions: result.receipt.revisions,
        });
        const checkpoint = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
        const allocations = harness.receiptAllocations();
        let recovered: HostToClientV2Message;
        if (recoveryPath === 'direct repeated commandId') {
          const frames = receiveFrames(harness.socket, 2);
          harness.socket.send(clientText(request, vocabulary));
          const values = await frames;
          expect(hostMessage(values[0] ?? '', vocabulary)).toMatchObject({
            lifecycleState: 'IDEMPOTENT_REPLAY',
            receipt: result.receipt,
          });
          recovered = hostMessageV2(values[1] ?? '', vocabulary);
        } else {
          recoverySocket =
            recoveryPath === 'reconnect' ? harness.socket : await harness.app.injectWS('/state');
          const replayIds = recoveryPath === 'replay' ? [request.commandId] : [];
          const frames = receiveFrames(recoverySocket, replayIds.length === 0 ? 2 : 3);
          recoverySocket.send(
            clientTextV2(reconnect(harness.deviceId, `${suffix}-recover`, replayIds), vocabulary),
          );
          const values = await frames;
          if (replayIds.length !== 0) {
            expect(hostMessage(values[0] ?? '', vocabulary)).toMatchObject({
              lifecycleState: 'IDEMPOTENT_REPLAY',
              receipt: result.receipt,
            });
          }
          recovered = hostMessageV2(values.at(-1) ?? '', vocabulary);
        }
        expect(recovered).toMatchObject({
          presentation: {
            base: {
              availableActionKeys: ['CHR-009::CTA::002'],
              formId: 'CHR-009',
              roleFilteredPayload: {
                assignmentMode: 'POINT_BUY_90',
                assignmentValidation: null,
                bijectionProofOrExactSum: {
                  actualTotal: null,
                  kind: 'EXACT_SUM',
                  requiredTotal: 90,
                },
                eachValueRange: { maximum: 20, minimum: 1 },
                raceChoice: 'UNITED',
                sourceSetReceiptIdOrNull: null,
              },
            },
            layers: [],
          },
          revisions: result.receipt.revisions,
        });
        expect(harness.receiptAllocations()).toBe(allocations);
        expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
          checkpoint,
        );
      } finally {
        if (recoverySocket !== harness.socket) recoverySocket?.terminate();
        harness.socket.terminate();
        await harness.app.close();
        harness.database.close();
      }
    },
  );

  it('confirms ADVENTUROUS abandonment into one ordered second attempt', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'adventurous-second');
    try {
      const first = await commitNonCriticalSet(
        harness,
        vocabulary,
        'adventurous-second',
        'ADVENTUROUS',
      );
      expect(first.setDestination).toMatchObject({
        presentation: {
          base: {
            formId: 'CHR-006',
            roleFilteredPayload: { attemptIndex: 1, decision: 'PENDING' },
          },
        },
      });
      const opened = await openWarning(harness, vocabulary, first, 'adventurous-second-open');
      const confirm = statDecisionRequest(
        'adventurous-second-confirm',
        harness,
        'CHR-028',
        'CONFIRM',
        resultRevision(first.setResult, 'draftRevision'),
        opened.revisions,
      );
      const [terminal, destination] = await sendCommand(harness.socket, confirm, vocabulary);
      const result = committedResult(terminal);
      const nextSetRollRequestId = resultString(result, 'nextSetRollRequestIdOrNull');
      expect(result.receipt).toMatchObject({
        result: {
          alternateDecision: 'GO_ATTEMPT_2',
          nextAttemptIndexOrNull: 2,
          nextFormId: 'CHR-003',
          nextSetRollRequestIdOrNull: nextSetRollRequestId,
          transitionKind: 'ADVENTUROUS_TO_SECOND',
        },
      });
      expect(destination).toMatchObject({
        presentation: {
          base: {
            formId: 'CHR-003',
            roleFilteredPayload: {
              attemptIndex: 2,
              branchUuid: first.branchUuid,
              setRollRequestId: nextSetRollRequestId,
            },
          },
          layers: [],
        },
      });
      const secondJourney = nextAttemptJourney(first, result, destination);
      const secondRequest = statSetRollRequest(
        'adventurous-second-second-set',
        harness,
        secondJourney,
      );
      const [secondTerminal, secondDecision] = await sendCommand(
        harness.socket,
        secondRequest,
        vocabulary,
      );
      const secondResult = committedResult(secondTerminal);
      expect(secondDecision).toMatchObject({
        presentation: {
          base: {
            formId: 'CHR-007',
            roleFilteredPayload: {
              attemptIndex: 2,
              decision: 'PENDING',
              setReceiptId: secondResult.receipt.receiptId,
            },
          },
        },
      });
      expect(
        loadCreationWizardCheckpoint(harness.database, harness.characterDraftId).statRollStage,
      ).toMatchObject({
        attempts: [
          { attemptIndex: 1, decisionRecordOrNull: { request: { commandId: confirm.commandId } } },
          { attemptIndex: 2, decisionRecordOrNull: null, state: 'DECISION_READY' },
        ],
        branchUuid: first.branchUuid,
        currentAttemptIndexOrNull: 2,
      });
    } finally {
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('reaches mandatory ALL_OR_NOTHING attempt five and rejects every sixth-attempt path', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'aon-fifth');
    try {
      let journey = await advanceToChr003(harness, vocabulary, 'aon-fifth', 'ALL_OR_NOTHING');
      let fifth: CommittedNonCriticalSet | undefined;
      for (let attemptIndex = 1; attemptIndex <= 5; attemptIndex += 1) {
        const setRequest = statSetRollRequest(
          `aon-fifth-set-${String(attemptIndex)}`,
          harness,
          journey,
        );
        const [setTerminal, setDestination] = await sendCommand(
          harness.socket,
          setRequest,
          vocabulary,
        );
        const setResult = committedResult(setTerminal);
        const committed = { ...journey, setDestination, setRequest, setResult };
        expect(setDestination).toMatchObject({
          presentation: {
            base: {
              availableActionKeys:
                attemptIndex === 5
                  ? ['CHR-008::CTA::001']
                  : ['CHR-008::CTA::001', 'CHR-008::CTA::002'],
              formId: 'CHR-008',
              roleFilteredPayload: {
                attemptIndex,
                fifthAttemptMandatoryAccept: attemptIndex === 5,
              },
            },
          },
        });
        if (attemptIndex === 5) {
          fifth = committed;
          break;
        }
        const opened = await openWarning(
          harness,
          vocabulary,
          committed,
          `aon-fifth-open-${String(attemptIndex)}`,
        );
        const confirm = statDecisionRequest(
          `aon-fifth-confirm-${String(attemptIndex)}`,
          harness,
          'CHR-028',
          'CONFIRM',
          resultRevision(setResult, 'draftRevision'),
          opened.revisions,
        );
        const [confirmTerminal, nextDestination] = await sendCommand(
          harness.socket,
          confirm,
          vocabulary,
        );
        journey = nextAttemptJourney(committed, committedResult(confirmTerminal), nextDestination);
      }
      if (fifth === undefined) throw new Error('ALL_OR_NOTHING did not reach attempt five');
      const checkpoint = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      const allocations = harness.receiptAllocations();
      const forgedOpen = await sendV2(
        harness.socket,
        formAction(
          'aon-fifth-forged-open',
          'CHR-008',
          'CHR-008::CTA::002',
          fifth.setResult.receipt.revisions.projectionRevision,
        ),
        vocabulary,
      );
      expect(forgedOpen).toMatchObject({
        messageType: 'navigation.form-action.refusal',
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
      });
      const forgedConfirm = statDecisionRequest(
        'aon-fifth-forged-confirm',
        harness,
        'CHR-028',
        'CONFIRM',
        resultRevision(fifth.setResult, 'draftRevision'),
        fifth.setResult.receipt.revisions,
      );
      const frames = receiveFrames(harness.socket, 1);
      harness.socket.send(clientText(forgedConfirm, vocabulary));
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'command.refusal',
        refusal: { code: 'GUARD_REJECTED' },
      });
      expect(harness.receiptAllocations()).toBe(allocations);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpoint,
      );
      expect(checkpoint.statRollStage?.attempts).toHaveLength(5);
    } finally {
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('hides and rejects decision actions without the SET-DECIDE capability', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'decision-capability');
    let limitedSocket: WebSocket | undefined;
    try {
      const committed = await commitNonCriticalSet(harness, vocabulary, 'decision-capability');
      const checkpoint = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      const allocations = harness.receiptAllocations();
      limitedSocket = await harness.app.injectWS('/state');
      const frames = receiveFrames(limitedSocket, 2);
      limitedSocket.send(
        clientTextV2(
          reconnect(
            harness.deviceId,
            'decision-capability-reconnect',
            [],
            [IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID, CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID],
          ),
          vocabulary,
        ),
      );
      const recovered = await frames;
      expect(hostMessageV2(recovered[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          base: { availableActionKeys: [], formId: 'CHR-005' },
          layers: [],
        },
      });
      const refusal = await sendV2(
        limitedSocket,
        formAction(
          'decision-capability-forged-open',
          'CHR-005',
          'CHR-005::CTA::002',
          committed.setResult.receipt.revisions.projectionRevision,
        ),
        vocabulary,
      );
      expect(refusal).toMatchObject({
        messageType: 'navigation.form-action.refusal',
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
      });
      expect(harness.receiptAllocations()).toBe(allocations);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpoint,
      );
    } finally {
      limitedSocket?.terminate();
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('rejects a next-attempt ID reused from transient CANCEL before the durable CONFIRM write', async () => {
    const frameErrors: unknown[] = [];
    const suffix = 'cancel-receipt-collision';
    const harness = await createJourneyHarness(staticRoot, vocabulary, suffix, [], {
      onFrameError: (error) => frameErrors.push(error),
      rollRequestIdForCount: (count) =>
        count === 2 ? `receipt-${suffix}-7` : `roll-request-${suffix}-override-${String(count)}`,
    });
    let retrySocket: WebSocket | undefined;
    try {
      const first = await commitNonCriticalSet(harness, vocabulary, suffix, 'ADVENTUROUS');
      let opened = await openWarning(harness, vocabulary, first, `${suffix}-cancel-open`);
      const cancel = statDecisionRequest(
        `${suffix}-cancel`,
        harness,
        'CHR-028',
        'CANCEL',
        resultRevision(first.setResult, 'draftRevision'),
        opened.revisions,
      );
      const [cancelTerminal, closed] = await sendCommand(harness.socket, cancel, vocabulary);
      const cancelResult = committedResult(cancelTerminal);
      expect(cancelResult.receipt.receiptId).toBe(`receipt-${suffix}-7`);
      opened = await openWarning(
        harness,
        vocabulary,
        { ...first, setDestination: closed },
        `${suffix}-confirm-open`,
      );
      const confirm = statDecisionRequest(
        `${suffix}-confirm`,
        harness,
        'CHR-028',
        'CONFIRM',
        resultRevision(first.setResult, 'draftRevision'),
        opened.revisions,
      );
      const before = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      expect(harness.rollRequestAllocations()).toBe(1);
      const closedByFatal = new Promise<void>((resolve) =>
        harness.socket.once('close', () => resolve()),
      );
      harness.socket.send(clientText(confirm, vocabulary));
      await closedByFatal;
      expect(frameErrors).toHaveLength(1);
      expect(frameErrors[0]).toEqual(
        expect.objectContaining({
          message: `creation roll-request allocator reused process-local command/receipt ID "receipt-${suffix}-7"`,
        }),
      );
      expect(harness.rollRequestAllocations()).toBe(2);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        before,
      );

      retrySocket = await harness.app.injectWS('/state');
      let frames = receiveFrames(retrySocket, 2);
      retrySocket.send(clientTextV2(reconnect(harness.deviceId, `${suffix}-retry`), vocabulary));
      const reconnected = await frames;
      const base = hostMessageV2(reconnected[1] ?? '', vocabulary);
      if (base.messageType !== 'projection.snapshot') throw new Error('missing retry base');
      const retryOpened = await sendV2(
        retrySocket,
        formAction(
          `${suffix}-retry-open`,
          'CHR-006',
          'CHR-006::CTA::002',
          base.revisions.projectionRevision,
        ),
        vocabulary,
      );
      if (retryOpened.messageType !== 'projection.snapshot')
        throw new Error('missing retry dialog');
      const retriedConfirm = statDecisionRequest(
        confirm.commandId,
        harness,
        'CHR-028',
        'CONFIRM',
        resultRevision(first.setResult, 'draftRevision'),
        retryOpened.revisions,
      );
      frames = receiveFrames(retrySocket, 2);
      retrySocket.send(clientText(retriedConfirm, vocabulary));
      const retried = await frames;
      expect(hostMessage(retried[0] ?? '', vocabulary)).toMatchObject({
        lifecycleState: 'COMMITTED',
        receipt: { commandId: confirm.commandId },
      });
      expect(hostMessageV2(retried[1] ?? '', vocabulary)).toMatchObject({
        presentation: { base: { formId: 'CHR-003' } },
      });
      expect(harness.rollRequestAllocations()).toBe(3);
    } finally {
      retrySocket?.terminate();
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('omits the CHR-003 roll action when reconnect did not negotiate its capability', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'capability-chr003');
    let limitedSocket: WebSocket | undefined;
    try {
      const journey = await advanceToChr003(harness, vocabulary, 'capability-chr003');
      limitedSocket = await harness.app.injectWS('/state');
      const frames = receiveFrames(limitedSocket, 2);
      limitedSocket.send(
        clientTextV2(
          reconnect(harness.deviceId, 'capability-chr003-reconnect', [], WITHOUT_ROLL_COMMIT),
          vocabulary,
        ),
      );
      const recovered = await frames;
      expect(hostMessageV2(recovered[0] ?? '', vocabulary)).toMatchObject({
        executableWorkflowCommandIds: [...WITHOUT_ROLL_COMMIT],
      });
      expect(hostMessageV2(recovered[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: [],
            formId: 'CHR-003',
            roleFilteredPayload: {
              facesOrManualInputs: [null, null, null, null, null, null, null],
              setRollRequestId: journey.setRollRequestId,
              shownResultLocked: false,
            },
          },
        },
        revisions: journey.methodResult.receipt.revisions,
      });
      expect(harness.sampleCalls()).toBe(0);
    } finally {
      limitedSocket?.terminate();
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('commits an AUTO natural queue through actionless CHR-004 CHAIN_COMPLETE', async () => {
    const harness = await createJourneyHarness(
      staticRoot,
      vocabulary,
      'critical-chain',
      [20, 1, 2, 3, 4, 5, 6, 14, 6],
    );
    let limitedSocket: WebSocket | undefined;
    try {
      const journey = await advanceToChr003(harness, vocabulary, 'critical-chain');
      const setRequest = statSetRollRequest('critical-chain-set', harness, journey);
      const [setTerminal, chr004] = await sendCommand(harness.socket, setRequest, vocabulary);
      const setResult = committedResult(setTerminal);
      const setRollReceiptId = setResult.receipt.receiptId;
      const firstConfirmationRequestId = resultNullableString(
        setResult,
        'confirmationRollRequestIdOrNull',
      );
      if (firstConfirmationRequestId === null) {
        throw new Error('natural set did not create its first confirmation request');
      }
      expect(setResult).toMatchObject({
        receipt: {
          result: {
            confirmationRollRequestIdOrNull: firstConfirmationRequestId,
            faces: [20, 1, 2, 3, 4, 5, 6],
            naturalCriticalQueue: [
              { originFace: 20, setEntryIndex: 0 },
              { originFace: 1, setEntryIndex: 1 },
            ],
            nextFormId: 'CHR-004',
            setRollReceiptId,
            shownResultLocked: true,
          },
        },
      });
      expect(chr004).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-004::CTA::001'],
            formId: 'CHR-004',
            roleFilteredPayload: {
              confirmationFace: null,
              confirmationReceiptId: null,
              confirmationRollRequestId: firstConfirmationRequestId,
              criticalQueueIndex: 0,
              originFace: 20,
              returnDecisionFormId: 'CHR-005',
              setRollReceiptId,
            },
          },
        },
        revisions: setResult.receipt.revisions,
      });

      limitedSocket = await harness.app.injectWS('/state');
      const frames = receiveFrames(limitedSocket, 2);
      limitedSocket.send(
        clientTextV2(
          reconnect(harness.deviceId, 'capability-chr004-reconnect', [], WITHOUT_ROLL_COMMIT),
          vocabulary,
        ),
      );
      const limited = await frames;
      expect(hostMessageV2(limited[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          base: { availableActionKeys: [], formId: 'CHR-004' },
        },
        revisions: setResult.receipt.revisions,
      });
      limitedSocket.terminate();
      limitedSocket = undefined;

      const firstRequest = confirmationRollRequest(
        'critical-chain-confirm-20',
        harness,
        journey,
        setResult,
        setRollReceiptId,
        0,
        firstConfirmationRequestId,
      );
      const [firstTerminal, secondPending] = await sendCommand(
        harness.socket,
        firstRequest,
        vocabulary,
      );
      const firstResult = committedResult(firstTerminal);
      const secondConfirmationRequestId = resultNullableString(
        firstResult,
        'nextConfirmationRollRequestIdOrNull',
      );
      if (secondConfirmationRequestId === null) {
        throw new Error('first critical did not advance to the second queue item');
      }
      expect(firstResult).toMatchObject({
        receipt: {
          result: {
            confirmationFace: 14,
            criticalQueueIndex: 0,
            nextConfirmationRollRequestIdOrNull: secondConfirmationRequestId,
            nextFormId: 'CHR-004',
            originFace: 20,
            outcomeOrNull: {
              creationCriticalPenaltyOrNull: null,
              criticalGrade: 0,
              criticalPolarity: 'NONE',
              setEntryIndex: 0,
              value: 20,
            },
            returnDecisionFormId: 'CHR-005',
          },
        },
      });
      expect(secondPending).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-004::CTA::001'],
            formId: 'CHR-004',
            roleFilteredPayload: {
              confirmationFace: null,
              confirmationReceiptId: null,
              confirmationRollRequestId: secondConfirmationRequestId,
              criticalQueueIndex: 1,
              originFace: 1,
              returnDecisionFormId: 'CHR-005',
            },
          },
        },
        revisions: firstResult.receipt.revisions,
      });

      const secondRequest = confirmationRollRequest(
        'critical-chain-confirm-1',
        harness,
        journey,
        firstResult,
        setRollReceiptId,
        1,
        secondConfirmationRequestId,
      );
      const [secondTerminal, complete] = await sendCommand(
        harness.socket,
        secondRequest,
        vocabulary,
      );
      const secondResult = committedResult(secondTerminal);
      expect(secondResult).toMatchObject({
        receipt: {
          result: {
            confirmationFace: 6,
            criticalQueueIndex: 1,
            nextConfirmationRollRequestIdOrNull: null,
            nextFormId: 'CHR-005',
            originFace: 1,
            outcomeOrNull: {
              creationCriticalPenaltyOrNull: null,
              criticalGrade: 0,
              criticalPolarity: 'NONE',
              setEntryIndex: 1,
              value: 1,
            },
            returnDecisionFormId: 'CHR-005',
          },
        },
      });
      expect(complete).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-005::CTA::001', 'CHR-005::CTA::002'],
            formId: 'CHR-005',
            roleFilteredPayload: {
              acceptedSetReceiptId: setRollReceiptId,
              decision: 'PENDING',
              decisionReceiptIdOrNull: null,
            },
          },
        },
        revisions: secondResult.receipt.revisions,
      });
      const durable = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      expect(durable.nextStageEnvelope.formId).toBe('CHR-005');
      expect(durable.statRollStage).toMatchObject({
        attempts: [
          {
            confirmationRollRequestIdOrNull: null,
            criticalQueueIndexOrNull: 1,
            outcomes: [
              { criticalGrade: 0, setEntryIndex: 0, value: 20 },
              { criticalGrade: 0, setEntryIndex: 1, value: 1 },
            ],
            returnDecisionFormId: 'CHR-005',
            state: 'CHAIN_COMPLETE',
          },
        ],
        currentAttemptIndexOrNull: 1,
      });
      expect(durable.raceAndMethodStage).toMatchObject({
        diceInput: { choiceLockStatus: 'LOCKED_AFTER_RESULT' },
        race: { choiceLockStatus: 'UNLOCKED' },
        statMethod: { choiceLockStatus: 'LOCKED_AFTER_RESULT' },
        symbiontAcquisition: { choiceLockStatus: 'LOCKED_AFTER_RESULT' },
      });
      expect(durable.durablePayload.randomReceiptIds).toEqual([
        setResult.receipt.receiptId,
        firstResult.receipt.receiptId,
        secondResult.receipt.receiptId,
      ]);
      expect(harness.sampleCalls()).toBe(9);
    } finally {
      limitedSocket?.terminate();
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('routes PURE assignment through CHR-011 and derives actionless CHR-012 durably', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'pure-assignment');
    let limitedSocket: WebSocket | undefined;
    let recoverySocket: WebSocket | undefined;
    try {
      const committed = await commitNonCriticalSet(
        harness,
        vocabulary,
        'pure-assignment',
        'CLASSIC',
        'PURE',
      );
      const acceptRequest = statDecisionRequest(
        'pure-assignment-accept',
        harness,
        'CHR-005',
        'ACCEPT_SET',
        resultRevision(committed.setResult, 'draftRevision'),
        committed.setResult.receipt.revisions,
      );
      const [acceptTerminal, chr009] = await sendCommand(harness.socket, acceptRequest, vocabulary);
      const acceptResult = committedResult(acceptTerminal);
      expect(chr009).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-009::CTA::001'],
            formId: 'CHR-009',
            roleFilteredPayload: {
              assignmentMode: 'ROLLED_BIJECTION',
              raceChoice: 'PURE',
              sourceSetReceiptIdOrNull: committed.setResult.receipt.receiptId,
            },
          },
          layers: [],
        },
        revisions: acceptResult.receipt.revisions,
      });

      const checkpointBeforeAssignment = loadCreationWizardCheckpoint(
        harness.database,
        harness.characterDraftId,
      );
      const allocationsBeforeAssignment = harness.receiptAllocations();
      const chr009SafeReturn = await sendV2(
        harness.socket,
        formAction(
          'pure-assignment-forged-chr009-return',
          'CHR-009',
          'CHR-009::CTA::003',
          acceptResult.receipt.revisions.projectionRevision,
        ),
        vocabulary,
      );
      expect(chr009SafeReturn).toMatchObject({
        messageType: 'navigation.form-action.refusal',
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        revisions: acceptResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(allocationsBeforeAssignment);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpointBeforeAssignment,
      );

      const assignmentRequest = statAssignmentRequest(
        'pure-assignment-checkpoint',
        harness,
        resultRevision(acceptResult, 'draftRevision'),
        acceptResult.receipt.revisions,
        { setEntryIndexByStat: CANONICAL_SET_ENTRY_INDEX_BY_STAT },
      );
      const [assignmentTerminal, chr011] = await sendCommand(
        harness.socket,
        assignmentRequest,
        vocabulary,
      );
      const assignmentResult = committedResult(assignmentTerminal);
      const baseStats = { C: 10, D: 10, I: 10, M: 10, S: 10, W: 10, Z: 10 };
      expect(assignmentResult).toMatchObject({
        receipt: {
          result: {
            assignmentMode: 'ROLLED_BIJECTION',
            baseStats,
            nextFormId: 'CHR-011',
            raceChoice: 'PURE',
            sourceFormId: 'CHR-009',
          },
        },
      });
      expect(chr011).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-011::CTA::003', 'CHR-011::CTA::004', 'CHR-011::CTA::005'],
            formId: 'CHR-011',
            roleFilteredPayload: {
              classConsequences: null,
              classOptions: [
                {
                  classConsequences: {
                    statModifiers: [
                      { delta: 2, statCode: 'S' },
                      { delta: 2, statCode: 'D' },
                      { delta: 5, statCode: 'Z' },
                      { delta: 7, statCode: 'I' },
                    ],
                  },
                  mandatoryClassSkill: { bonus: 5, skillKey: 'PURE_SEEKER', slotCost: 1 },
                  pureClass: 'SEEKER',
                },
                {
                  mandatoryClassSkill: { bonus: 4, skillKey: 'PURE_STALKER', slotCost: 1 },
                  pureClass: 'STALKER',
                },
                {
                  mandatoryClassSkill: { bonus: 3, skillKey: 'PURE_SOLDIER', slotCost: 1 },
                  pureClass: 'SOLDIER',
                },
              ],
              commandId: null,
              mandatoryClassSkill: null,
              pureClass: null,
              raceChoice: 'PURE',
            },
          },
          layers: [],
        },
        revisions: assignmentResult.receipt.revisions,
      });

      const checkpointBeforeClass = loadCreationWizardCheckpoint(
        harness.database,
        harness.characterDraftId,
        skillCatalog,
      );
      const allocationsBeforeClass = harness.receiptAllocations();
      const runtimeRevisionsBeforeAssignmentConflict = harness.runtime.read();
      const runtimeWritesBeforeAssignmentConflict = [...harness.runtime.writes];
      const changedAssignmentRequest = statAssignmentRequest(
        assignmentRequest.commandId,
        harness,
        resultRevision(acceptResult, 'draftRevision'),
        acceptResult.receipt.revisions,
        { setEntryIndexByStat: { ...CANONICAL_SET_ENTRY_INDEX_BY_STAT, S: 1 } },
      );
      const assignmentConflictFrames = receiveFrames(harness.socket, 1);
      harness.socket.send(clientText(changedAssignmentRequest, vocabulary));
      expect(hostMessage((await assignmentConflictFrames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: assignmentRequest.commandId,
        messageType: 'command.refusal',
        refusal: {
          code: 'IDEMPOTENCY_CONFLICT',
          commandId: assignmentRequest.commandId,
          detail: 'PAYLOAD_MISMATCH',
        },
        revisions: assignmentResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(allocationsBeforeClass);
      expect(harness.runtime.read()).toEqual(runtimeRevisionsBeforeAssignmentConflict);
      expect(harness.runtime.writes).toEqual(runtimeWritesBeforeAssignmentConflict);
      expect(
        loadCreationWizardCheckpoint(harness.database, harness.characterDraftId, skillCatalog),
      ).toEqual(checkpointBeforeClass);

      const chr011SafeReturn = await sendV2(
        harness.socket,
        formAction(
          'pure-assignment-forged-chr011-return',
          'CHR-011',
          'CHR-011::CTA::002',
          assignmentResult.receipt.revisions.projectionRevision,
        ),
        vocabulary,
      );
      expect(chr011SafeReturn).toMatchObject({
        messageType: 'navigation.form-action.refusal',
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        revisions: assignmentResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(allocationsBeforeClass);
      expect(
        loadCreationWizardCheckpoint(harness.database, harness.characterDraftId, skillCatalog),
      ).toEqual(checkpointBeforeClass);

      limitedSocket = await harness.app.injectWS('/state');
      let frames = receiveFrames(limitedSocket, 2);
      limitedSocket.send(
        clientTextV2(
          reconnect(harness.deviceId, 'pure-assignment-without-set-decide', [], WITHOUT_SET_DECIDE),
          vocabulary,
        ),
      );
      const limited = await frames;
      expect(hostMessageV2(limited[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-011::CTA::003', 'CHR-011::CTA::004', 'CHR-011::CTA::005'],
            formId: 'CHR-011',
          },
        },
        revisions: assignmentResult.receipt.revisions,
      });
      const forgedClassRequest = pureClassDecisionRequest(
        'pure-assignment-forged-class',
        harness,
        'SEEKER',
        resultRevision(assignmentResult, 'draftRevision'),
        assignmentResult.receipt.revisions,
      );
      const allocationsBeforeForged = harness.receiptAllocations();
      frames = receiveFrames(limitedSocket, 1);
      limitedSocket.send(clientText(forgedClassRequest, vocabulary));
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: forgedClassRequest.commandId,
        messageType: 'command.refusal',
        refusal: { code: 'GUARD_REJECTED' },
        revisions: assignmentResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(allocationsBeforeForged);
      limitedSocket.terminate();
      limitedSocket = undefined;

      const classRequest = pureClassDecisionRequest(
        'pure-assignment-class',
        harness,
        'SEEKER',
        resultRevision(assignmentResult, 'draftRevision'),
        assignmentResult.receipt.revisions,
      );
      const [classTerminal, chr012] = await sendCommand(harness.socket, classRequest, vocabulary);
      const classResult = committedResult(classTerminal);
      const classModifiers = [
        { delta: 2, statCode: 'S' },
        { delta: 2, statCode: 'D' },
        { delta: 5, statCode: 'Z' },
        { delta: 7, statCode: 'I' },
      ];
      const mandatoryClassSkill = { bonus: 5, skillKey: 'PURE_SEEKER', slotCost: 1 };
      expect(classResult).toMatchObject({
        receipt: {
          result: {
            classConsequences: { statModifiers: classModifiers },
            mandatoryClassSkill,
            nextFormId: 'CHR-012',
            pureClass: 'SEEKER',
            sourceFormId: 'CHR-011',
            stage: 'STAT_ASSIGNMENT',
          },
        },
      });
      expect(chr012).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: [],
            formId: 'CHR-012',
            roleFilteredPayload: {
              baseStats,
              classModifiersOrNull: classModifiers,
              commandId: null,
              mandatoryClassSkillOrNull: mandatoryClassSkill,
              raceModifiers: [],
              skillStageStats: { ...baseStats, D: 12, I: 17, S: 12, Z: 15 },
              symbiontModifiersExcluded: true,
            },
          },
          layers: [],
        },
        revisions: classResult.receipt.revisions,
      });

      const checkpointAtChr012 = loadCreationWizardCheckpoint(
        harness.database,
        harness.characterDraftId,
        skillCatalog,
      );
      const allocationsAtChr012 = harness.receiptAllocations();
      const runtimeRevisionsBeforeClassConflict = harness.runtime.read();
      const runtimeWritesBeforeClassConflict = [...harness.runtime.writes];
      const changedClassRequest = pureClassDecisionRequest(
        classRequest.commandId,
        harness,
        'STALKER',
        resultRevision(assignmentResult, 'draftRevision'),
        assignmentResult.receipt.revisions,
      );
      const classConflictFrames = receiveFrames(harness.socket, 1);
      harness.socket.send(clientText(changedClassRequest, vocabulary));
      expect(hostMessage((await classConflictFrames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: classRequest.commandId,
        messageType: 'command.refusal',
        refusal: {
          code: 'IDEMPOTENCY_CONFLICT',
          commandId: classRequest.commandId,
          detail: 'PAYLOAD_MISMATCH',
        },
        revisions: classResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(allocationsAtChr012);
      expect(harness.runtime.read()).toEqual(runtimeRevisionsBeforeClassConflict);
      expect(harness.runtime.writes).toEqual(runtimeWritesBeforeClassConflict);
      expect(
        loadCreationWizardCheckpoint(harness.database, harness.characterDraftId, skillCatalog),
      ).toEqual(checkpointAtChr012);

      for (const [index, actionKey] of (
        ['CHR-012::CTA::001', 'CHR-012::CTA::002', 'CHR-012::CTA::003'] as const
      ).entries()) {
        const refusal = await sendV2(
          harness.socket,
          formAction(
            `pure-assignment-forged-chr012-${String(index + 1)}`,
            'CHR-012',
            actionKey,
            classResult.receipt.revisions.projectionRevision,
          ),
          vocabulary,
        );
        expect(refusal).toMatchObject({
          messageType: 'navigation.form-action.refusal',
          refusal: { code: 'NAVIGATION_UNAVAILABLE' },
          revisions: classResult.receipt.revisions,
        });
      }
      expect(harness.receiptAllocations()).toBe(allocationsAtChr012);
      expect(
        loadCreationWizardCheckpoint(harness.database, harness.characterDraftId, skillCatalog),
      ).toEqual(checkpointAtChr012);

      const allocationsAfterClass = harness.receiptAllocations();
      frames = receiveFrames(harness.socket, 2);
      harness.socket.send(clientText(classRequest, vocabulary));
      const replay = await frames;
      expect(hostMessage(replay[0] ?? '', vocabulary)).toMatchObject({
        lifecycleState: 'IDEMPOTENT_REPLAY',
        receipt: classResult.receipt,
      });
      expect(hostMessageV2(replay[1] ?? '', vocabulary)).toMatchObject({
        presentation: { base: { availableActionKeys: [], formId: 'CHR-012' }, layers: [] },
        revisions: classResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(allocationsAfterClass);

      recoverySocket = await harness.app.injectWS('/state');
      frames = receiveFrames(recoverySocket, 2);
      recoverySocket.send(
        clientTextV2(reconnect(harness.deviceId, 'pure-assignment-reconnect'), vocabulary),
      );
      const recovered = await frames;
      expect(hostMessageV2(recovered[0] ?? '', vocabulary)).toMatchObject({
        executableWorkflowCommandIds: [
          IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
          CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
          CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
        ],
      });
      expect(hostMessageV2(recovered[1] ?? '', vocabulary)).toMatchObject({
        presentation: { base: { availableActionKeys: [], formId: 'CHR-012' }, layers: [] },
        revisions: classResult.receipt.revisions,
      });

      const checkpointBeforeBacktracking = loadCreationWizardCheckpoint(
        harness.database,
        harness.characterDraftId,
        skillCatalog,
      );
      const allocationsBeforeBacktracking = harness.receiptAllocations();
      const runtimeRevisionsBeforeBacktracking = harness.runtime.read();
      const runtimeWritesBeforeBacktracking = [...harness.runtime.writes];
      const forgedAssignment = statAssignmentRequest(
        'pure-assignment-forged-checkpoint-at-chr012',
        harness,
        resultRevision(classResult, 'draftRevision'),
        classResult.receipt.revisions,
        { setEntryIndexByStat: CANONICAL_SET_ENTRY_INDEX_BY_STAT },
      );
      frames = receiveFrames(recoverySocket, 1);
      recoverySocket.send(clientText(forgedAssignment, vocabulary));
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: forgedAssignment.commandId,
        messageType: 'command.refusal',
        refusal: { code: 'GUARD_REJECTED' },
        revisions: classResult.receipt.revisions,
      });

      const forgedClassDecision = pureClassDecisionRequest(
        'pure-assignment-forged-class-at-chr012',
        harness,
        'STALKER',
        resultRevision(classResult, 'draftRevision'),
        classResult.receipt.revisions,
      );
      frames = receiveFrames(recoverySocket, 1);
      recoverySocket.send(clientText(forgedClassDecision, vocabulary));
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: forgedClassDecision.commandId,
        messageType: 'command.refusal',
        refusal: { code: 'GUARD_REJECTED' },
        revisions: classResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(allocationsBeforeBacktracking);
      expect(harness.runtime.read()).toEqual(runtimeRevisionsBeforeBacktracking);
      expect(harness.runtime.writes).toEqual(runtimeWritesBeforeBacktracking);
      expect(
        loadCreationWizardCheckpoint(harness.database, harness.characterDraftId, skillCatalog),
      ).toEqual(checkpointBeforeBacktracking);
    } finally {
      recoverySocket?.terminate();
      limitedSocket?.terminate();
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('routes FREE/RANDOM point-buy 85 through CHR-009 to durable actionless CHR-012', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'free-random-point-buy-85');
    try {
      const first = await commitNonCriticalSet(
        harness,
        vocabulary,
        'free-random-point-buy-85',
        'ADVENTUROUS',
        'FREE',
        'RANDOM',
      );
      const firstWarning = await openWarning(
        harness,
        vocabulary,
        first,
        'free-random-point-buy-85-first-warning',
      );
      const firstAbandonRequest = statDecisionRequest(
        'free-random-point-buy-85-first-abandon',
        harness,
        'CHR-028',
        'CONFIRM',
        resultRevision(first.setResult, 'draftRevision'),
        firstWarning.revisions,
      );
      const [firstAbandonTerminal, secondPending] = await sendCommand(
        harness.socket,
        firstAbandonRequest,
        vocabulary,
      );
      const firstAbandonResult = committedResult(firstAbandonTerminal);
      expect(firstAbandonResult).toMatchObject({
        receipt: {
          result: {
            alternateDecision: 'GO_ATTEMPT_2',
            assignmentModeOrNull: null,
            nextAttemptIndexOrNull: 2,
            nextFormId: 'CHR-003',
            originDecisionFormId: 'CHR-006',
          },
        },
      });

      const secondJourney = nextAttemptJourney(first, firstAbandonResult, secondPending);
      const secondSetRequest = statSetRollRequest(
        'free-random-point-buy-85-second-set',
        harness,
        secondJourney,
      );
      const [secondSetTerminal, secondDecision] = await sendCommand(
        harness.socket,
        secondSetRequest,
        vocabulary,
      );
      const secondSetResult = committedResult(secondSetTerminal);
      expect(secondDecision).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-007::CTA::001', 'CHR-007::CTA::002'],
            formId: 'CHR-007',
            roleFilteredPayload: {
              attemptIndex: 2,
              decision: 'PENDING',
              setReceiptId: secondSetResult.receipt.receiptId,
            },
          },
        },
      });
      const second = {
        ...secondJourney,
        setDestination: secondDecision,
        setRequest: secondSetRequest,
        setResult: secondSetResult,
      };
      const secondWarning = await openWarning(
        harness,
        vocabulary,
        second,
        'free-random-point-buy-85-second-warning',
      );
      const secondAbandonRequest = statDecisionRequest(
        'free-random-point-buy-85-second-abandon',
        harness,
        'CHR-028',
        'CONFIRM',
        resultRevision(secondSetResult, 'draftRevision'),
        secondWarning.revisions,
      );
      const [secondAbandonTerminal, chr009] = await sendCommand(
        harness.socket,
        secondAbandonRequest,
        vocabulary,
      );
      const secondAbandonResult = committedResult(secondAbandonTerminal);
      expect(secondAbandonResult).toMatchObject({
        receipt: {
          result: {
            alternateDecision: 'USE_POINT_BUY_85',
            assignmentModeOrNull: 'POINT_BUY_85',
            nextAttemptIndexOrNull: null,
            nextFormId: 'CHR-009',
            originDecisionFormId: 'CHR-007',
          },
        },
      });
      expect(chr009).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: ['CHR-009::CTA::002'],
            formId: 'CHR-009',
            roleFilteredPayload: {
              C: null,
              D: null,
              I: null,
              M: null,
              S: null,
              W: null,
              Z: null,
              assignmentMode: 'POINT_BUY_85',
              assignmentValidation: null,
              bijectionProofOrExactSum: {
                actualTotal: null,
                kind: 'EXACT_SUM',
                requiredTotal: 85,
              },
              eachValueRange: { maximum: 20, minimum: 1 },
              raceChoice: 'FREE',
              sourceSetReceiptIdOrNull: null,
            },
          },
          layers: [],
        },
        revisions: secondAbandonResult.receipt.revisions,
      });

      const pointBuyStats = { C: 12, D: 12, I: 12, M: 12, S: 13, W: 12, Z: 12 };
      const assignmentRequest = statAssignmentRequest(
        'free-random-point-buy-85-assignment',
        harness,
        resultRevision(secondAbandonResult, 'draftRevision'),
        secondAbandonResult.receipt.revisions,
        { pointBuyStats },
      );
      const [assignmentTerminal, chr012] = await sendCommand(
        harness.socket,
        assignmentRequest,
        vocabulary,
      );
      const assignmentResult = committedResult(assignmentTerminal);
      expect(assignmentResult).toMatchObject({
        receipt: {
          result: {
            assignmentMode: 'POINT_BUY_85',
            baseStats: pointBuyStats,
            nextFormId: 'CHR-012',
            raceChoice: 'FREE',
            rolledAssignmentsOrNull: null,
            sourceFormId: 'CHR-009',
            sourceSetReceiptIdOrNull: null,
            stage: 'STAT_ASSIGNMENT',
          },
        },
      });
      expect(chr012).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: [],
            formId: 'CHR-012',
            roleFilteredPayload: {
              baseStats: pointBuyStats,
              classModifiersOrNull: null,
              commandId: null,
              mandatoryClassSkillOrNull: null,
              raceModifiers: [],
              skillStageStats: pointBuyStats,
              symbiontModifiersExcluded: true,
            },
          },
          layers: [],
        },
        revisions: assignmentResult.receipt.revisions,
      });
      expect(
        loadCreationWizardCheckpoint(harness.database, harness.characterDraftId, skillCatalog),
      ).toMatchObject({
        nextStageEnvelope: { formId: 'CHR-012' },
        raceAndMethodStage: {
          race: { value: 'FREE' },
          symbiontAcquisition: { value: 'RANDOM' },
        },
        statAssignmentStage: {
          derived: {
            assignmentMode: 'POINT_BUY_85',
            baseStats: pointBuyStats,
            raceChoice: 'FREE',
            rolledAssignmentsOrNull: null,
            sourceSetReceiptIdOrNull: null,
          },
        },
      });

      const allocationsAfterAssignment = harness.receiptAllocations();
      const frames = receiveFrames(harness.socket, 2);
      harness.socket.send(clientText(assignmentRequest, vocabulary));
      const replay = await frames;
      expect(hostMessage(replay[0] ?? '', vocabulary)).toMatchObject({
        lifecycleState: 'IDEMPOTENT_REPLAY',
        receipt: assignmentResult.receipt,
      });
      expect(hostMessageV2(replay[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          base: {
            availableActionKeys: [],
            formId: 'CHR-012',
            roleFilteredPayload: { raceModifiers: [], skillStageStats: pointBuyStats },
          },
          layers: [],
        },
        revisions: assignmentResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(allocationsAfterAssignment);
    } finally {
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });

  it('routes PURE directly to CHR-036 and rejects every synthetic CHR-016 decision', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'pure');
    try {
      const raceRequest = setDecideRequest(
        'pure-race',
        'CHR-010',
        harness.characterDraftId,
        harness.wizardCheckpointId,
        resultRevision(harness.checkpointResult, 'draftRevision'),
        harness.checkpointResult.receipt.revisions,
        { raceChoice: 'PURE' },
      );
      const [raceTerminal, destination] = await sendCommand(
        harness.socket,
        raceRequest,
        vocabulary,
      );
      const raceResult = committedResult(raceTerminal);
      expect(raceResult).toMatchObject({
        receipt: {
          result: { nextFormId: 'CHR-036', raceChoice: 'PURE', sourceFormId: 'CHR-010' },
        },
      });
      expect(destination).toMatchObject({
        presentation: { base: { formId: 'CHR-036' } },
        revisions: raceResult.receipt.revisions,
      });

      const receiptCount = harness.receiptAllocations();
      const checkpointAfterRace = loadCreationWizardCheckpoint(
        harness.database,
        harness.characterDraftId,
      );
      const forgedMode = setDecideRequest(
        'pure-forged-mode',
        'CHR-016',
        harness.characterDraftId,
        harness.wizardCheckpointId,
        resultRevision(raceResult, 'draftRevision'),
        raceResult.receipt.revisions,
        { symbiontAcquisitionMode: 'RANDOM' },
      );
      const frames = receiveFrames(harness.socket, 1);
      harness.socket.send(clientText(forgedMode, vocabulary));
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: forgedMode.commandId,
        refusal: { code: 'GUARD_REJECTED' },
        revisions: raceResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(receiptCount);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpointAfterRace,
      );

      const diceRequest = setDecideRequest(
        'pure-dice',
        'CHR-036',
        harness.characterDraftId,
        harness.wizardCheckpointId,
        resultRevision(raceResult, 'draftRevision'),
        raceResult.receipt.revisions,
        { diceInputMode: 'MANUAL' },
      );
      const [diceTerminal, chr002] = await sendCommand(harness.socket, diceRequest, vocabulary);
      const diceResult = committedResult(diceTerminal);
      expect(chr002).toMatchObject({
        presentation: { base: { formId: 'CHR-002' } },
        revisions: diceResult.receipt.revisions,
      });
      const durable = loadCreationWizardCheckpoint(harness.database, harness.characterDraftId);
      expect(durable.raceAndMethodStage).toMatchObject({
        decisionRecords: [
          { request: { commandId: raceRequest.commandId } },
          { request: { commandId: diceRequest.commandId } },
        ],
        race: { value: 'PURE' },
        symbiontAcquisition: {
          choiceLockStatus: 'NOT_APPLICABLE',
          consequences: null,
          value: null,
        },
      });
    } finally {
      harness.socket.terminate();
      await harness.app.close();
      harness.database.close();
    }
  });
});
