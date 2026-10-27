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
  WIRE_PROTOCOL_V2_VERSION,
} from '@shared/index.js';
import type {
  AddressableRouteIntentV2Message,
  AddressableRouteTemplate,
  ClientToHostMessage,
  ClientToHostV2Message,
  CommandReplayMessage,
  CommandResultMessage,
  FormActionIntentV2Message,
  HostToClientMessage,
  HostToClientV2Message,
  ProtocolVocabulary,
  RevisionVector,
  SessionReconnectV2Message,
  WireV2Vocabulary,
} from '@shared/index.js';

import type { RevisionImpact } from '../persistence/index.js';
import type { openPersistenceDatabase } from '../persistence/index.js';
import {
  loadCreationWizardCheckpoint,
  currentCreationWizardRevisions,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { createHost, startHost } from './server.js';
import { CHR_018_ROUTE } from './projections/chr-manual-symbionts.js';
import {
  CHR_021_CONFIRM_ACTION_KEY,
  CHR_021_RETURN_ACTION_KEY,
  CHR_021_ROLL_ACTION_KEY,
} from './projections/chr-armor-bundle.js';
import {
  createManualWizardSetup,
  manualCompositionRequest,
  type ManualWizardSetup,
} from '../../tests/fixtures/manual-symbiont-stage.js';
import { CATALOG } from '../../tests/fixtures/symbiont-stage.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ZERO_REVISIONS: RevisionVector = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
};
const ALL_COMMANDS = [
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  'UI-CMD-CHAR-CREATION-SET-DECIDE',
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
] as const;

type WorkflowRequest = Extract<ClientToHostMessage, { readonly commandKind: 'workflow-command' }>;
type Snapshot = Extract<HostToClientV2Message, { readonly messageType: 'projection.snapshot' }>;

interface ArmorHost extends ManualWizardSetup {
  readonly app: FastifyInstance;
  readonly socket: WebSocket;
  readonly sampleCalls: () => number;
  readonly rollRequestAllocations: () => number;
}

const databases: ReturnType<typeof openPersistenceDatabase>[] = [];
const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
const temporaryDirectories: string[] = [];
let staticRoot: string;
let vocabulary: ProtocolVocabulary & WireV2Vocabulary;

beforeAll(async () => {
  staticRoot = await mkdtemp(join(tmpdir(), 'armor-bundle-host-static-'));
  await writeFile(join(staticRoot, 'index.html'), '<main>armor bundle</main>', 'utf8');
  vocabulary = await loadProtocolVocabulary(PROJECT_ROOT);
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const app of apps.splice(0)) await app.close();
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

afterAll(async () => {
  await rm(staticRoot, { recursive: true, force: true });
});

function revisionRuntime() {
  let revisions = ZERO_REVISIONS;
  return {
    read: () => revisions,
    advance: (impact: RevisionImpact) => {
      revisions = {
        actorVisibilityRevision:
          revisions.actorVisibilityRevision + Number(impact.actorVisibilityChanged),
        projectionRevision: revisions.projectionRevision + Number(impact.projectionChanged),
        stateRevision: revisions.stateRevision + Number(impact.stateChanged),
      };
      return revisions;
    },
  };
}

function rawText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  throw new TypeError('unsupported RawData');
}

function receiveFrames(socket: WebSocket, count: number): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    const frames: string[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(`timed out waiting for ${String(count)} frames; received: ${frames.join(' | ')}`),
      );
    }, 5000);
    const onMessage = (data: RawData): void => {
      frames.push(rawText(data));
      if (frames.length === count) {
        cleanup();
        resolve(frames);
      }
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('message', onMessage);
    };
    socket.on('message', onMessage);
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

function snapshot(value: string | HostToClientV2Message): Snapshot {
  const message = typeof value === 'string' ? hostMessageV2(value) : value;
  if (message.messageType !== 'projection.snapshot')
    throw new Error(`expected snapshot, got ${message.messageType}`);
  return message;
}

async function openSocket(app: FastifyInstance): Promise<WebSocket> {
  const socket = await app.injectWS('/state');
  sockets.push(socket);
  return socket;
}

async function createArmorHost(
  setup: ManualWizardSetup,
  sampleFaces: readonly number[],
  namespace: string,
): Promise<ArmorHost> {
  const runtime = revisionRuntime();
  let sampleCalls = 0;
  let rollRequestAllocations = 0;
  let receiptAllocations = 0;
  const app = await createHost({
    advanceRevisions: runtime.advance,
    allocateCreationBranchUuid: () => `${namespace}-branch`,
    allocateCreationRollRequestId: () =>
      `${namespace}-roll-request-${String(++rollRequestAllocations)}`,
    allocateContextId: () => '10000000-0000-4000-8000-000000000001',
    allocateLocalCharacterId: () => '20000000-0000-4000-8000-000000000001',
    allocateReceiptId: () => `${namespace}-receipt-${String(++receiptAllocations)}`,
    allocateWizardCheckpointId: () => `${namespace}-wizard`,
    database: setup.database,
    onFrameError: (error) => {
      throw error;
    },
    projectRoot: PROJECT_ROOT,
    readRevisions: runtime.read,
    sampleCreationD20: () => {
      const face = sampleFaces[sampleCalls];
      if (face === undefined) throw new Error('unexpected D20 sample');
      sampleCalls += 1;
      return face;
    },
    staticRoot,
  });
  apps.push(app);
  await startHost(app, { interface: '127.0.0.1', port: 0 });
  const socket = await openSocket(app);
  return {
    ...setup,
    app,
    socket,
    sampleCalls: () => sampleCalls,
    rollRequestAllocations: () => rollRequestAllocations,
  };
}

function current(host: ArmorHost): DurableCreationWizardCheckpoint {
  return loadCreationWizardCheckpoint(
    host.database,
    host.characterDraftId,
    CATALOG.skillStage,
    CATALOG,
  );
}

async function reconnect(host: ArmorHost, requestId: string): Promise<Snapshot> {
  const frames = receiveFrames(host.socket, 2);
  const request: SessionReconnectV2Message = {
    deviceId: host.deviceId,
    knownRevisions: ZERO_REVISIONS,
    messageType: 'session.reconnect',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    reconnectRequestId: requestId,
    supportedWorkflowCommandIds: ALL_COMMANDS,
    unacknowledgedCommandIds: [],
  };
  host.socket.send(clientTextV2(request));
  return snapshot((await frames)[1] ?? '');
}

async function sendV2(socket: WebSocket, message: ClientToHostV2Message): Promise<Snapshot> {
  const frames = receiveFrames(socket, 1);
  socket.send(clientTextV2(message));
  return snapshot((await frames)[0] ?? '');
}

async function sendCommand(
  socket: WebSocket,
  request: WorkflowRequest,
): Promise<readonly [CommandResultMessage | CommandReplayMessage, Snapshot]> {
  const frames = receiveFrames(socket, 2);
  socket.send(clientText(request));
  const received = await frames;
  const terminal = hostMessage(received[0] ?? '');
  if (terminal.messageType !== 'command.result' && terminal.messageType !== 'command.replay') {
    throw new Error(`expected command success or replay, got ${terminal.messageType}`);
  }
  return [terminal, snapshot(received[1] ?? '')];
}

async function sendRefusal(
  socket: WebSocket,
  request: WorkflowRequest,
): Promise<HostToClientMessage> {
  const frames = receiveFrames(socket, 1);
  socket.send(clientText(request));
  const message = hostMessage((await frames)[0] ?? '');
  if (message.messageType !== 'command.refusal') {
    throw new Error(`expected command.refusal, got ${message.messageType}`);
  }
  return message;
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

function cardRoute(
  navigationRequestId: string,
  speciesKey: string,
  expectedProjectionRevision: number,
): AddressableRouteIntentV2Message {
  return {
    bindings: [{ parameterIndex: 1, source: 'client-selected', value: speciesKey }],
    expectedProjectionRevision,
    messageType: 'navigation.addressable-route',
    navigationRequestId,
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    routeTemplate: CHR_018_ROUTE as AddressableRouteTemplate,
  };
}

function refusalCode(message: HostToClientMessage): string {
  if (message.messageType !== 'command.refusal') throw new Error('not a refusal');
  return message.refusal.code;
}

describe('CHR-021 host journey', () => {
  it(
    'enters from CHR-019, rolls quality, safe-returns and checkpoints to CHR-022',
    { timeout: 20000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'armor-host-'));
      temporaryDirectories.push(directory);
      const setup = createManualWizardSetup(
        'armor-host',
        'FREE',
        'MANUAL',
        join(directory, 'host.sqlite'),
      );
      databases.push(setup.database);
      const host = await createArmorHost(setup, [], 'armor-host');
      const initial = await reconnect(host, 'armor-host-initial');
      expect(initial.presentation.base.formId).toBe('CHR-017');

      const opened = await sendV2(
        host.socket,
        cardRoute('armor-host-card', 'EEL', initial.revisions.projectionRevision),
      );
      expect(opened.presentation.base.formId).toBe('CHR-018');

      const compositionRequest = manualCompositionRequest(
        setup,
        current(host),
        'armor-host-composition',
        ['EEL'],
      );
      const [, composed] = await sendCommand(host.socket, compositionRequest);
      expect(composed.presentation.base.formId).toBe('CHR-019');

      const beforeEntry = current(host);
      const staleEntry = await sendRefusal(host.socket, {
        commandId: 'armor-host-stale-entry',
        commandKind: 'workflow-command',
        expectedRevisions: ZERO_REVISIONS,
        messageType: 'command.request',
        payload: {
          characterDraftId: setup.characterDraftId,
          draftRevision: beforeEntry.receipt.result.draftRevision,
          sourceFormId: 'CHR-019',
          stage: 'SYMBIONTS',
          variant: 'ARMOR_BUNDLE_ENTRY',
          wizardCheckpointId: setup.wizardCheckpointId,
        },
        protocolVersion: 1,
        role: 'player',
        workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
      });
      expect(refusalCode(staleEntry)).toBe('STALE_REVISION');

      const entryCheckpoint = current(host);
      const [entryResult, entered] = await sendCommand(host.socket, {
        commandId: 'armor-host-entry',
        commandKind: 'workflow-command',
        expectedRevisions: currentCreationWizardRevisions(entryCheckpoint),
        messageType: 'command.request',
        payload: {
          characterDraftId: setup.characterDraftId,
          draftRevision: entryCheckpoint.receipt.result.draftRevision,
          sourceFormId: 'CHR-019',
          stage: 'SYMBIONTS',
          variant: 'ARMOR_BUNDLE_ENTRY',
          wizardCheckpointId: setup.wizardCheckpointId,
        },
        protocolVersion: 1,
        role: 'player',
        workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
      });
      expect(entryResult.messageType).toBe('command.result');
      expect(entered.presentation.base.formId).toBe('CHR-021');
      expect(entered.presentation.base.availableActionKeys).toEqual([CHR_021_ROLL_ACTION_KEY]);
      expect(entered.presentation.base.roleFilteredPayload).toMatchObject({
        armorBundleId: 'armor-host-roll-request-1',
        qualityRollRequestId: 'armor-host-roll-request-2',
        qualityRollReceiptIdOrNull: null,
        ownershipState: 'OWNED_NOT_EQUIPPED',
        diceInputModeSnapshot: 'MANUAL',
      });
      expect(JSON.stringify(entered.presentation.base.roleFilteredPayload)).not.toContain(
        'randomSequenceId',
      );

      const rollBase = current(host);
      const invalidRoll = await sendRefusal(host.socket, {
        commandId: 'armor-host-empty-roll',
        commandKind: 'workflow-command',
        expectedRevisions: currentCreationWizardRevisions(rollBase),
        messageType: 'command.request',
        payload: {
          armorBundleId: 'armor-host-roll-request-1',
          armorPieces: [],
          characterDraftId: setup.characterDraftId,
          draftRevision: rollBase.receipt.result.draftRevision,
          manualFaceOrNull: 16,
          qualityRollRequestId: 'armor-host-roll-request-2',
          sourceFormId: 'CHR-021',
          stage: 'SYMBIONTS',
          variant: 'ARMOR_BUNDLE_QUALITY',
          wizardCheckpointId: setup.wizardCheckpointId,
        },
        protocolVersion: 1,
        role: 'player',
        workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
      });
      expect(refusalCode(invalidRoll)).toBe('GUARD_REJECTED');
      expect(host.sampleCalls()).toBe(0);

      const [rollResult, rolled] = await sendCommand(host.socket, {
        commandId: 'armor-host-roll',
        commandKind: 'workflow-command',
        expectedRevisions: currentCreationWizardRevisions(rollBase),
        messageType: 'command.request',
        payload: {
          armorBundleId: 'armor-host-roll-request-1',
          armorPieces: [
            { itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' },
            { itemId: 'ITM-ARM-002', bodyZoneOrNull: 'TORSO' },
          ],
          characterDraftId: setup.characterDraftId,
          draftRevision: rollBase.receipt.result.draftRevision,
          manualFaceOrNull: 16,
          qualityRollRequestId: 'armor-host-roll-request-2',
          sourceFormId: 'CHR-021',
          stage: 'SYMBIONTS',
          variant: 'ARMOR_BUNDLE_QUALITY',
          wizardCheckpointId: setup.wizardCheckpointId,
        },
        protocolVersion: 1,
        role: 'player',
        workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
      });
      expect(rollResult.messageType).toBe('command.result');
      expect(host.sampleCalls()).toBe(0);
      expect(rolled.presentation.base.formId).toBe('CHR-021');
      expect(rolled.presentation.base.availableActionKeys).toEqual([
        CHR_021_CONFIRM_ACTION_KEY,
        CHR_021_RETURN_ACTION_KEY,
      ]);
      const rollReceiptId = (
        rolled.presentation.base.roleFilteredPayload as {
          readonly qualityRollReceiptIdOrNull: string;
        }
      ).qualityRollReceiptIdOrNull;
      expect(rollReceiptId).toMatch(/^armor-host-receipt-[0-9]+$/u);
      expect(rolled.presentation.base.roleFilteredPayload).toMatchObject({
        qualityRecommendation: { kind: 'GOOD', label: 'Хорошее', range: '15–18', rawFace: 16 },
        armorPieces: [
          { itemId: 'ITM-ARM-001', bodyZone: 'HEAD' },
          { itemId: 'ITM-ARM-002', bodyZone: 'TORSO' },
        ],
        distinctBodyZones: ['HEAD', 'TORSO'],
      });

      const payloadBeforeReturn = current(host).localCharacter.payloadJson;
      const checkpointRevisionBeforeReturn = current(host).checkpoint.checkpointRevision;
      const returned = await sendV2(
        host.socket,
        formAction(
          'armor-host-safe-return',
          'CHR-021',
          CHR_021_RETURN_ACTION_KEY,
          rolled.revisions.projectionRevision,
        ),
      );
      expect(returned.presentation.base.formId).toBe('CHR-019');
      expect(returned.revisions.projectionRevision).toBe(rolled.revisions.projectionRevision + 1);
      expect(returned.revisions.stateRevision).toBe(rolled.revisions.stateRevision);
      expect(returned.revisions.actorVisibilityRevision).toBe(
        rolled.revisions.actorVisibilityRevision,
      );
      const afterReturn = current(host);
      expect(afterReturn.localCharacter.payloadJson).toBe(payloadBeforeReturn);
      expect(afterReturn.checkpoint.checkpointRevision).toBe(checkpointRevisionBeforeReturn);
      expect(afterReturn.armorBundleStage?.qualityRollRecordOrNull?.receipt.receiptId).toBe(
        rollReceiptId,
      );

      const restored = await reconnect(host, 'armor-host-restore');
      expect(restored.presentation.base.formId).toBe('CHR-021');
      expect(restored.presentation.base.availableActionKeys).toEqual([
        CHR_021_CONFIRM_ACTION_KEY,
        CHR_021_RETURN_ACTION_KEY,
      ]);

      const checkpointBase = current(host);
      const [checkpointResult, checkpointed] = await sendCommand(host.socket, {
        commandId: 'armor-host-checkpoint',
        commandKind: 'workflow-command',
        expectedRevisions: currentCreationWizardRevisions(checkpointBase),
        messageType: 'command.request',
        payload: {
          armorBundleId: 'armor-host-roll-request-1',
          characterDraftId: setup.characterDraftId,
          draftRevision: checkpointBase.receipt.result.draftRevision,
          qualityRollReceiptId: rollReceiptId,
          sourceFormId: 'CHR-021',
          stage: 'SYMBIONTS',
          variant: 'ARMOR_BUNDLE_CHECKPOINT',
          wizardCheckpointId: setup.wizardCheckpointId,
        },
        protocolVersion: 1,
        role: 'player',
        workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
      });
      expect(checkpointResult.messageType).toBe('command.result');
      expect(checkpointed.presentation.base.formId).toBe('CHR-021');
      expect(checkpointed.presentation.base.availableActionKeys).toEqual([]);
      const checkpointReceiptId = (
        checkpointed.presentation.base.roleFilteredPayload as {
          readonly bundleCheckpointReceiptIdOrNull: string;
        }
      ).bundleCheckpointReceiptIdOrNull;
      expect(checkpointReceiptId).toMatch(/^armor-host-receipt-[0-9]+$/u);
      expect(checkpointed.presentation.base.roleFilteredPayload).toMatchObject({
        ownershipState: 'OWNED_NOT_EQUIPPED',
        qualityRecommendation: { kind: 'GOOD', rawFace: 16 },
        qualityRollReceiptIdOrNull: rollReceiptId,
        nextFormId: 'CHR-022',
        armorPieces: [
          { itemId: 'ITM-ARM-001', bodyZone: 'HEAD' },
          { itemId: 'ITM-ARM-002', bodyZone: 'TORSO' },
        ],
      });
    },
  );
});
