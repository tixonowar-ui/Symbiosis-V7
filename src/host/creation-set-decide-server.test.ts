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
import { bootstrapDeviceIdentity } from '../persistence/index.js';
import type { RevisionImpact } from '../persistence/index.js';
import {
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  loadCreationWizardCheckpoint,
} from './creation-set-decide.js';
import { IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID } from './identity-checkpoint.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { createHost, startHost } from './server.js';

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
  readonly runtime: RevisionRuntime;
  readonly socket: WebSocket;
  readonly wizardCheckpointId: string;
}

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
): SessionReconnectV2Message {
  return {
    deviceId,
    knownRevisions: ZERO_REVISIONS,
    messageType: 'session.reconnect',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    reconnectRequestId: requestId,
    supportedWorkflowCommandIds: [
      IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
      CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
    ],
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

async function createJourneyHarness(
  staticRoot: string,
  vocabulary: ProtocolVocabulary & WireV3Vocabulary,
  suffix: string,
): Promise<JourneyHarness> {
  const database = openPersistenceDatabase(':memory:');
  const deviceId = bootstrapDeviceIdentity(database);
  const runtime = revisionRuntime();
  let idSequence = 0;
  let receiptAllocations = 0;
  const app = await createHost({
    advanceRevisions: runtime.advance,
    allocateContextId: () => `10000000-0000-4000-8000-${String(++idSequence).padStart(12, '0')}`,
    allocateLocalCharacterId: () =>
      `20000000-0000-4000-8000-${String(++idSequence).padStart(12, '0')}`,
    allocateReceiptId: () => `receipt-${suffix}-${String(++receiptAllocations)}`,
    allocateWizardCheckpointId: () => `wizard-${suffix}-${String(++idSequence)}`,
    database,
    onFrameError: (error) => {
      throw error;
    },
    projectRoot: PROJECT_ROOT,
    readRevisions: runtime.read,
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
    runtime,
    socket,
    wizardCheckpointId,
  };
}

describe('durable character creation decisions', () => {
  let staticRoot: string;
  let vocabulary: ProtocolVocabulary & WireV3Vocabulary;

  beforeAll(async () => {
    staticRoot = await mkdtemp(join(tmpdir(), 'symbiosis-set-decide-host-'));
    await writeFile(join(staticRoot, 'index.html'), '<main>set decide</main>', 'utf8');
    vocabulary = await loadProtocolVocabulary(PROJECT_ROOT);
  });

  afterAll(async () => {
    await rm(staticRoot, { force: true, recursive: true });
  });

  it('traverses CHR-001 → CHR-010 → CHR-016 → CHR-036 → CHR-002 and restores the latest destination', async () => {
    const harness = await createJourneyHarness(staticRoot, vocabulary, 'normal');
    let app = harness.app;
    let socket = harness.socket;
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
              methodConsequences: null,
              statMethod: null,
            },
          },
        },
        revisions: diceResult.receipt.revisions,
      });

      const receiptCount = harness.receiptAllocations();
      const checkpointBeforeMethod = loadCreationWizardCheckpoint(
        harness.database,
        harness.characterDraftId,
      );
      const methodRequest = setDecideRequest(
        'normal-method-out-of-scope',
        'CHR-002',
        harness.characterDraftId,
        harness.wizardCheckpointId,
        resultRevision(diceResult, 'draftRevision'),
        diceResult.receipt.revisions,
        { statMethod: 'CLASSIC' },
      );
      let frames = receiveFrames(socket, 1);
      socket.send(clientText(methodRequest, vocabulary));
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: methodRequest.commandId,
        refusal: { code: 'GUARD_REJECTED' },
        revisions: diceResult.receipt.revisions,
      });
      expect(harness.receiptAllocations()).toBe(receiptCount);
      expect(loadCreationWizardCheckpoint(harness.database, harness.characterDraftId)).toEqual(
        checkpointBeforeMethod,
      );

      socket.terminate();
      await app.close();
      const restartRuntime = revisionRuntime();
      let restartReceipts = 0;
      app = await createHost({
        advanceRevisions: restartRuntime.advance,
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
        staticRoot,
      });
      await startHost(app, { interface: '127.0.0.1', port: 0 });
      socket = await app.injectWS('/state');
      frames = receiveFrames(socket, 6);
      socket.send(
        clientTextV2(
          reconnect(harness.deviceId, 'normal-restart', [
            harness.identityCommand.commandId,
            raceRequest.commandId,
            modeRequest.commandId,
            diceRequest.commandId,
          ]),
          vocabulary,
        ),
      );
      const recovered = await frames;
      expect(recovered.slice(0, 4).map((text) => hostMessage(text, vocabulary))).toEqual([
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
      ]);
      expect(hostMessageV2(recovered[5] ?? '', vocabulary)).toMatchObject({
        presentation: {
          assignment: { correlationId: 'normal-restart', reason: 'RECONNECT' },
          base: { formId: 'CHR-002', roleFilteredPayload: { draftRevision: 4 } },
        },
        revisions: diceResult.receipt.revisions,
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
          base: { formId: 'CHR-002' },
        },
        revisions: diceResult.receipt.revisions,
      });
      expect(restartReceipts).toBe(0);
    } finally {
      socket.terminate();
      await app.close();
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
