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
import { openPersistenceDatabase } from '../persistence/index.js';
import {
  loadCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { createHost, startHost } from './server.js';
import { CHR_018_ROUTE } from './projections/chr-manual-symbionts.js';
import {
  createManualWizardSetup,
  exactManualAdvisorSkills,
  manualAdvisorFloorRollRequest,
  manualAdvisorIwRequest,
  manualAdvisorSkillRequest,
  manualCompositionRequest,
  type ManualWizardSetup,
} from '../../tests/fixtures/manual-symbiont-stage.js';
import { CATALOG } from '../../tests/fixtures/symbiont-stage.js';
import { loadCreationSkillCatalog, type CreationSkillCatalog } from './creation-skill-catalog.js';

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

interface ManualHost extends ManualWizardSetup {
  readonly app: FastifyInstance;
  readonly socket: WebSocket;
  readonly sampleCalls: () => number;
  readonly receiptAllocations: () => number;
  readonly rollRequestAllocations: () => number;
}

const databases: ReturnType<typeof openPersistenceDatabase>[] = [];
const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
const temporaryDirectories: string[] = [];
let staticRoot: string;
let vocabulary: ProtocolVocabulary & WireV2Vocabulary;
let presentation: CreationSkillCatalog;

beforeAll(async () => {
  staticRoot = await mkdtemp(join(tmpdir(), 'manual-symbiont-host-static-'));
  await writeFile(join(staticRoot, 'index.html'), '<main>manual symbionts</main>', 'utf8');
  [vocabulary, presentation] = await Promise.all([
    loadProtocolVocabulary(PROJECT_ROOT),
    loadCreationSkillCatalog(PROJECT_ROOT, CATALOG.skillStage),
  ]);
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

function snapshot(value: string | HostToClientV2Message): Snapshot {
  const message = typeof value === 'string' ? hostMessageV2(value) : value;
  if (message.messageType !== 'projection.snapshot')
    throw new Error(`expected snapshot, got ${message.messageType}: ${JSON.stringify(message)}`);
  return message;
}

async function openSocket(app: FastifyInstance): Promise<WebSocket> {
  const socket = await app.injectWS('/state');
  sockets.push(socket);
  return socket;
}

async function createManualHost(
  setup: ManualWizardSetup,
  sampleFaces: readonly number[],
  namespace: string,
  options: { readonly receiptIdForCount?: (count: number) => string } = {},
): Promise<ManualHost> {
  const runtime = revisionRuntime();
  let sampleCalls = 0;
  let receiptAllocations = 0;
  let rollRequestAllocations = 0;
  const app = await createHost({
    advanceRevisions: runtime.advance,
    allocateCreationBranchUuid: () => `${namespace}-branch`,
    allocateCreationRollRequestId: () =>
      `${namespace}-roll-request-${String(++rollRequestAllocations)}`,
    allocateContextId: () => '10000000-0000-4000-8000-000000000001',
    allocateLocalCharacterId: () => '20000000-0000-4000-8000-000000000001',
    allocateReceiptId: () => {
      receiptAllocations += 1;
      return (
        options.receiptIdForCount?.(receiptAllocations) ??
        `${namespace}-receipt-${String(receiptAllocations)}`
      );
    },
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
    receiptAllocations: () => receiptAllocations,
    rollRequestAllocations: () => rollRequestAllocations,
  };
}

async function stopHost(host: ManualHost): Promise<void> {
  host.socket.terminate();
  await host.app.close();
  const appIndex = apps.indexOf(host.app);
  if (appIndex >= 0) apps.splice(appIndex, 1);
  const socketIndex = sockets.indexOf(host.socket);
  if (socketIndex >= 0) sockets.splice(socketIndex, 1);
}

function current(host: ManualHost): DurableCreationWizardCheckpoint {
  return loadCreationWizardCheckpoint(
    host.database,
    host.characterDraftId,
    CATALOG.skillStage,
    CATALOG,
  );
}

async function reconnect(host: ManualHost, requestId: string): Promise<Snapshot> {
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

async function sendV2(
  socket: WebSocket,
  message: ClientToHostV2Message,
): Promise<HostToClientV2Message> {
  const frames = receiveFrames(socket, 1);
  socket.send(clientTextV2(message));
  return hostMessageV2((await frames)[0] ?? '');
}

async function sendV2Raw(
  socket: WebSocket,
  message: ClientToHostV2Message,
): Promise<HostToClientMessage | HostToClientV2Message> {
  const frames = receiveFrames(socket, 1);
  socket.send(JSON.stringify(message));
  const text = (await frames)[0] ?? '';
  const messageType = (JSON.parse(text) as { readonly messageType?: string }).messageType;
  return messageType === 'protocol.refusal' ? hostMessage(text) : hostMessageV2(text);
}

async function sendCommand(
  socket: WebSocket,
  request: WorkflowRequest,
): Promise<readonly [CommandResultMessage | CommandReplayMessage, Snapshot]> {
  const frames = receiveFrames(socket, 2);
  socket.send(clientText(request));
  const framesReceived = await frames.catch((error: unknown) => {
    throw new Error(
      `${request.commandId}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  });
  const terminal = hostMessage(framesReceived[0] ?? '');
  if (terminal.messageType !== 'command.result' && terminal.messageType !== 'command.replay') {
    throw new Error(`expected command success or replay, got ${terminal.messageType}`);
  }
  return [terminal, snapshot(framesReceived[1] ?? '')];
}

async function sendRefusal(
  socket: WebSocket,
  request: WorkflowRequest,
): Promise<HostToClientMessage> {
  const frames = receiveFrames(socket, 1);
  socket.send(clientText(request));
  return hostMessage((await frames)[0] ?? '');
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

function expectSafePayload(value: unknown): void {
  const json = JSON.stringify(value);
  for (const forbidden of [
    'ProfileRuleID',
    'ModifierID',
    'Rule IDs',
    'Источник',
    'availabilityTrace',
    'randomSequenceId',
    'seed',
  ]) {
    expect(json).not.toContain(forbidden);
  }
}

describe('manual symbiont host journeys', () => {
  it('opens cards, commits replacement, serves media and restores the host baseline', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'manual-host-free-'));
    temporaryDirectories.push(directory);
    const setup = createManualWizardSetup(
      'host-free',
      'FREE',
      'MANUAL',
      join(directory, 'host.sqlite'),
    );
    databases.push(setup.database);
    const host = await createManualHost(setup, [], 'host-free');
    const initial = await reconnect(host, 'host-free-initial');
    expect(initial.presentation.base.formId).toBe('CHR-017');
    expect(initial.presentation.base.roleFilteredPayload).toMatchObject({
      manualCompositionDraft: [],
    });
    const opened = snapshot(
      await sendV2(
        host.socket,
        cardRoute('host-free-card', 'EEL', initial.revisions.projectionRevision),
      ),
    );
    expect(opened.presentation.base.formId).toBe('CHR-018');
    expect(opened.presentation.base.roleFilteredPayload).toMatchObject({
      speciesKey: 'EEL',
      artAndTreePreview: { artPath: '/generated/media/symbionts/EEL.png' },
    });
    expectSafePayload(opened);
    const invalid = await sendV2Raw(
      host.socket,
      cardRoute('host-free-unknown', 'UNKNOWN', opened.revisions.projectionRevision),
    );
    expect(invalid).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { code: 'UNRECOGNIZED', path: '$.bindings' },
    });
    const incompatible = await sendV2Raw(
      host.socket,
      cardRoute('host-free-incompatible', 'CHIMERA', opened.revisions.projectionRevision),
    );
    expect(incompatible).toMatchObject({
      messageType: 'navigation.addressable-route.refusal',
      refusal: { code: 'INVALID_BINDINGS' },
    });
    const extra = cardRoute('host-free-extra', 'OWL', opened.revisions.projectionRevision);
    const invalidExtra: AddressableRouteIntentV2Message = {
      ...extra,
      bindings: [
        ...extra.bindings,
        { parameterIndex: 1, source: 'client-selected', value: 'TAIPAN' },
      ],
    };
    expect(await sendV2Raw(host.socket, invalidExtra)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { code: 'UNRECOGNIZED', path: '$.bindings[1].parameterIndex' },
    });
    const art = await host.app.inject({ method: 'GET', url: '/generated/media/symbionts/EEL.png' });
    const tree = await host.app.inject({
      method: 'GET',
      url: '/generated/media/development-trees/EEL.png',
    });
    const missing = await host.app.inject({
      method: 'GET',
      url: '/generated/media/symbionts/UNKNOWN.png',
    });
    expect(art.statusCode).toBe(200);
    expect(art.headers['content-type']).toContain('image/png');
    expect(tree.statusCode).toBe(200);
    expect(missing.statusCode).toBe(404);

    const [, summary] = await sendCommand(
      host.socket,
      manualCompositionRequest(
        setup,
        current(host),
        'host-free-add',
        ['EEL'],
        [{ speciesKey: 'EEL', side: 'LEFT' }],
      ),
    );
    expect(summary.presentation.base.formId).toBe('CHR-019');
    expect(summary.presentation.base.roleFilteredPayload).toMatchObject({
      duplicatePolicy: { kind: 'FORBIDDEN' },
      bindings: [{ binding: { side: 'LEFT' } }],
    });
    const catalog = snapshot(
      await sendV2(
        host.socket,
        formAction(
          'host-free-catalog',
          'CHR-019',
          'CHR-019::CTA::004',
          summary.revisions.projectionRevision,
        ),
      ),
    );
    expect(catalog.presentation.base.availableActionKeys).toContain('CHR-017::CTA::002');
    const duplicate = snapshot(
      await sendV2(
        host.socket,
        cardRoute('host-free-duplicate', 'EEL', catalog.revisions.projectionRevision),
      ),
    );
    expect(duplicate.presentation.base.availableActionKeys).not.toContain('CHR-018::CTA::001');
    expect(duplicate.presentation.base.roleFilteredPayload).toMatchObject({
      compatibility: { kind: 'DUPLICATE' },
    });
    const returned = snapshot(
      await sendV2(
        host.socket,
        formAction(
          'host-free-return',
          'CHR-018',
          'CHR-018::CTA::002',
          duplicate.revisions.projectionRevision,
        ),
      ),
    );
    expect(returned.presentation.base.formId).toBe('CHR-017');
    const owl = snapshot(
      await sendV2(
        host.socket,
        cardRoute('host-free-owl', 'OWL', returned.revisions.projectionRevision),
      ),
    );
    const replacementRequest = manualCompositionRequest(setup, current(host), 'host-free-replace', [
      'OWL',
    ]);
    const [, replacement] = await sendCommand(host.socket, replacementRequest);
    expect(replacement.presentation.base.roleFilteredPayload).toMatchObject({
      speciesKeys: ['OWL'],
    });
    expect(replacement.presentation.base.availableActionKeys).toContain('CHR-019::CTA::001');
    expect(host.sampleCalls()).toBe(0);
    expect(owl.presentation.base.roleFilteredPayload).toMatchObject({ speciesKey: 'OWL' });
    await stopHost(host);

    const path = setup.database.name;
    setup.database.close();
    const reopened = openPersistenceDatabase(path);
    databases.push(reopened);
    const restarted = await createManualHost(
      {
        ...setup,
        database: reopened,
        checkpoint: loadCreationWizardCheckpoint(
          reopened,
          setup.characterDraftId,
          CATALOG.skillStage,
          CATALOG,
        ),
      },
      [],
      'host-free-restart',
    );
    const restored = await reconnect(restarted, 'host-free-restored');
    expect(restored.presentation.base.formId).toBe('CHR-019');
    expect(restored.presentation.base.roleFilteredPayload).toMatchObject({ speciesKeys: ['OWL'] });
    const [replay] = await sendCommand(restarted.socket, replacementRequest);
    expect(replay).toMatchObject({ lifecycleState: 'IDEMPOTENT_REPLAY' });
    expect(restarted.sampleCalls()).toBe(0);
  }, 20000);

  it('runs Advisor I/W, B, exact skills and a non-mutating interaction preview with replay', async () => {
    const setup = createManualWizardSetup('host-advisor', 'UNITED', 'MANUAL');
    databases.push(setup.database);
    const host = await createManualHost(setup, [], 'host-advisor');
    const initial = await reconnect(host, 'host-advisor-initial');
    expect(initial.presentation.base.formId).toBe('CHR-017');
    const opened = snapshot(
      await sendV2(
        host.socket,
        cardRoute('host-advisor-card', 'TROGR', initial.revisions.projectionRevision),
      ),
    );
    expect(opened.presentation.base.formId).toBe('CHR-018');
    const [, pending] = await sendCommand(
      host.socket,
      manualCompositionRequest(setup, current(host), 'host-advisor-composition', [
        'TROGR',
        'ADVISER',
        'TAIPAN',
        'OWL',
      ]),
    );
    expect(pending.presentation.base.formId).toBe('CHR-041');
    expect(pending.presentation.base.roleFilteredPayload).toMatchObject({
      advisorSlotsAndSkills: { kind: 'IW_ROLLS_REQUIRED' },
    });
    expect(pending.presentation.base.availableActionKeys).toEqual(['CHR-041::CTA::003']);
    const iwRequest = manualAdvisorIwRequest(setup, current(host), 'host-advisor-iw', [8, 9]);
    const [iwResult, rolled] = await sendCommand(host.socket, iwRequest);
    expect(iwResult.receipt.result).toMatchObject({
      variant: 'ADVISOR_IW',
      advisorIw: { I: { value: 16 }, W: { value: 17 } },
    });
    expect(rolled.presentation.base.availableActionKeys).toContain('CHR-041::CTA::004');
    expect(host.rollRequestAllocations()).toBe(4);
    expect(host.sampleCalls()).toBe(0);
    const early = await sendRefusal(
      host.socket,
      manualAdvisorSkillRequest(
        setup,
        current(host),
        'host-advisor-early',
        exactManualAdvisorSkills(current(host), presentation),
      ),
    );
    expect(early).toMatchObject({ refusal: { code: 'GUARD_REJECTED' } });
    const [bResult, bReady] = await sendCommand(
      host.socket,
      manualAdvisorFloorRollRequest(setup, current(host), 'host-advisor-b', 2),
    );
    expect(bResult.receipt.result).toMatchObject({ minimumI: 2, suppressionB: 1 });
    expect(bReady.presentation.base.availableActionKeys).toContain('CHR-041::CTA::001');
    const teacherRequest = manualCompositionRequest(setup, current(host), 'host-advisor-teacher', [
      'TROGR',
      'TEACHER',
      'ADVISER',
      'TAIPAN',
    ]);
    const [, withTeacher] = await sendCommand(host.socket, teacherRequest);
    expect(withTeacher.presentation.base.roleFilteredPayload).toMatchObject({
      trogrSuppressionState: { minimumIOrNull: 2 },
    });
    const [, summary] = await sendCommand(
      host.socket,
      manualAdvisorSkillRequest(
        setup,
        current(host),
        'host-advisor-skills',
        exactManualAdvisorSkills(current(host), presentation),
      ),
    );
    expect(summary.presentation.base.formId).toBe('CHR-019');
    const preview = snapshot(
      await sendV2(
        host.socket,
        formAction(
          'host-advisor-preview',
          'CHR-019',
          'CHR-019::CTA::002',
          summary.revisions.projectionRevision,
        ),
      ),
    );
    expect(preview.presentation.base.availableActionKeys).toEqual(['CHR-042::CTA::002']);
    expect(preview.presentation.base.roleFilteredPayload).toMatchObject({
      confirmationStatus: 'PREVIEW',
      irreversibleOperationIds: ['ABSORPTION', 'SPECIES_SUPPRESSION'],
    });
    expectSafePayload(preview);
    const returned = snapshot(
      await sendV2(
        host.socket,
        formAction(
          'host-advisor-return',
          'CHR-042',
          'CHR-042::CTA::002',
          preview.revisions.projectionRevision,
        ),
      ),
    );
    expect(returned.presentation.base.formId).toBe('CHR-019');
    const [replay] = await sendCommand(host.socket, iwRequest);
    expect(replay).toMatchObject({ lifecycleState: 'IDEMPOTENT_REPLAY' });
    expect(host.sampleCalls()).toBe(0);
  }, 20000);

  it('rejects a receipt collision before AUTO sampling and replays the successful pair', async () => {
    const setup = createManualWizardSetup('host-collision', 'UNITED', 'AUTO');
    databases.push(setup.database);
    const host = await createManualHost(setup, [7, 11], 'host-collision', {
      receiptIdForCount: (count) =>
        count === 2 ? 'host-collision-roll-request-1' : `host-collision-receipt-${String(count)}`,
    });
    const initial = await reconnect(host, 'host-collision-initial');
    const opened = snapshot(
      await sendV2(
        host.socket,
        cardRoute('host-collision-card', 'ADVISER', initial.revisions.projectionRevision),
      ),
    );
    expect(opened.presentation.base.formId).toBe('CHR-018');
    await sendCommand(
      host.socket,
      manualCompositionRequest(setup, current(host), 'host-collision-composition', [
        'ADVISER',
        'TAIPAN',
        'OWL',
        'EEL',
      ]),
    );
    const before = current(host).localCharacter.payloadJson;
    const refused = await sendRefusal(
      host.socket,
      manualAdvisorIwRequest(setup, current(host), 'host-collision-iw', null),
    );
    expect(refused).toMatchObject({ refusal: { code: 'GUARD_REJECTED' } });
    expect(host.sampleCalls()).toBe(0);
    expect(current(host).localCharacter.payloadJson).toBe(before);
    const request = manualAdvisorIwRequest(setup, current(host), 'host-collision-valid-iw', null);
    const [result] = await sendCommand(host.socket, request);
    expect(result.receipt.result).toMatchObject({
      variant: 'ADVISOR_IW',
      advisorIw: { I: { value: 15 }, W: { value: 19 } },
    });
    expect(host.sampleCalls()).toBe(2);
    const [replay] = await sendCommand(host.socket, request);
    expect(replay).toMatchObject({ lifecycleState: 'IDEMPOTENT_REPLAY' });
    expect(host.sampleCalls()).toBe(2);
  }, 20000);
});
