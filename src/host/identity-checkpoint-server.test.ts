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
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  loadIdentityCheckpoint,
} from './identity-checkpoint.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { createHost, startHost } from './server.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ZERO_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;

type CheckpointRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request'; readonly commandKind: 'workflow-command' }
>;

interface RevisionRuntime {
  readonly advance: (impact: RevisionImpact) => RevisionVector;
  readonly read: () => RevisionVector;
  readonly writes: RevisionImpact[];
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
    supportedWorkflowCommandIds: [IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID],
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

describe('first durable identity checkpoint server path', () => {
  let staticRoot: string;
  let vocabulary: ProtocolVocabulary & WireV3Vocabulary;

  beforeAll(async () => {
    staticRoot = await mkdtemp(join(tmpdir(), 'symbiosis-checkpoint-host-'));
    await writeFile(join(staticRoot, 'index.html'), '<main>checkpoint</main>', 'utf8');
    vocabulary = await loadProtocolVocabulary(PROJECT_ROOT);
  });

  afterAll(async () => {
    await rm(staticRoot, { force: true, recursive: true });
  });

  it('commits, freezes sex, publishes CHR-010, refreshes APP-004 live, and replays after restart', async () => {
    const database = openPersistenceDatabase(':memory:');
    const deviceId = bootstrapDeviceIdentity(database);
    let allocatorSequence = 0;
    const frameErrors: unknown[] = [];
    const sockets: WebSocket[] = [];
    let runtime = revisionRuntime();
    const start = async (): Promise<FastifyInstance> => {
      const app = await createHost({
        advanceRevisions: runtime.advance,
        allocateContextId: () =>
          `00000000-0000-4000-8000-${String(++allocatorSequence).padStart(12, '0')}`,
        allocateLocalCharacterId: () =>
          `10000000-0000-4000-8000-${String(++allocatorSequence).padStart(12, '0')}`,
        allocateReceiptId: () => `receipt-${String(++allocatorSequence)}`,
        allocateWizardCheckpointId: () => `wizard-${String(++allocatorSequence)}`,
        database,
        onFrameError: (error) => frameErrors.push(error),
        projectRoot: PROJECT_ROOT,
        readRevisions: runtime.read,
        staticRoot,
      });
      await startHost(app, { interface: '127.0.0.1', port: 0 });
      return app;
    };

    let app = await start();
    try {
      // Open an independent APP-004 connection before the draft assignment. It stays live
      // while the other connection commits, proving the database read is not host-start frozen.
      let librarySocket = await app.injectWS('/state');
      sockets.push(librarySocket);
      let frames = receiveFrames(librarySocket, 2);
      librarySocket.send(clientTextV2(reconnect(deviceId, 'library-reconnect'), vocabulary));
      await frames;
      await sendV2(
        librarySocket,
        formAction('library-player', 'APP-001', 'APP-001::CTA::001', 0),
        vocabulary,
      );
      const emptyLibrary = await sendV2(
        librarySocket,
        formAction('library-open', 'APP-002', 'APP-002::CTA::002', 1),
        vocabulary,
      );
      expect(emptyLibrary).toMatchObject({
        presentation: {
          base: {
            formId: 'APP-004',
            roleFilteredPayload: {
              draftCharacterIds: [],
              localCharacterLibraryRevision: 0,
            },
          },
        },
        revisions: { ...ZERO_REVISIONS, projectionRevision: 2 },
      });

      const creatorSocket = await app.injectWS('/state');
      sockets.push(creatorSocket);
      frames = receiveFrames(creatorSocket, 2);
      creatorSocket.send(clientTextV2(reconnect(deviceId, 'creator-reconnect'), vocabulary));
      const reconnectFrames = await frames;
      expect(hostMessageV2(reconnectFrames[0] ?? '', vocabulary)).toMatchObject({
        executableWorkflowCommandIds: [IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID],
        revisions: { ...ZERO_REVISIONS, projectionRevision: 2 },
      });
      expect(hostMessageV2(reconnectFrames[1] ?? '', vocabulary)).toMatchObject({
        presentation: { base: { formId: 'APP-001' } },
        revisions: { ...ZERO_REVISIONS, projectionRevision: 2 },
      });
      const app002 = await sendV2(
        creatorSocket,
        formAction('creator-player', 'APP-001', 'APP-001::CTA::001', 2),
        vocabulary,
      );
      if (app002.messageType !== 'projection.snapshot') throw new Error('missing APP-002');
      const contextId = app002.presentation.base.roleFilteredPayload['contextId'];
      if (typeof contextId !== 'string') throw new Error('missing player contextId');
      const chr001 = await sendV2(
        creatorSocket,
        formAction('creator-draft', 'APP-002', 'APP-002::CTA::007', 3),
        vocabulary,
      );
      if (chr001.messageType !== 'projection.snapshot') throw new Error('missing CHR-001');
      const chr001Payload = chr001.presentation.base.roleFilteredPayload;
      const characterDraftId = chr001Payload['characterDraftId'];
      const wizardCheckpointId = chr001Payload['wizardCheckpointId'];
      if (typeof characterDraftId !== 'string' || typeof wizardCheckpointId !== 'string') {
        throw new Error('missing draft identities');
      }
      const scope = {
        characterDraftId,
        contextId,
        sourceFormId: 'CHR-001',
        wizardCheckpointId,
      } as const;
      const values = {
        age: 24,
        artAssetKeyOrLocalFile: null,
        description: null,
        massKg: 70.1,
        name: 'Alice',
        sex: 'MALE',
      } as const;
      const identityRequest = {
        draftUpdateId: 'identity-ready',
        expectedDraftRevision: 0,
        expectedRevisions: { ...ZERO_REVISIONS, projectionRevision: 4 },
        messageType: 'character.identity-draft.replace',
        protocolVersion: WIRE_PROTOCOL_V3_VERSION,
        scope,
        values,
      } as const satisfies IdentityDraftReplaceV3Message;
      frames = receiveFrames(creatorSocket, 1);
      creatorSocket.send(clientTextV3(identityRequest, vocabulary));
      const identityResult = hostMessageV3((await frames)[0] ?? '', vocabulary);
      expect(identityResult).toMatchObject({
        draftRevision: 1,
        messageType: 'character.identity-draft.result',
        presentation: {
          base: {
            availableActionKeys: ['CHR-001::CTA::001', 'CHR-001::CTA::002'],
            formId: 'CHR-001',
          },
        },
        revisions: { ...ZERO_REVISIONS, projectionRevision: 5 },
      });

      const checkpointRequest = {
        commandId: 'checkpoint-command-1',
        commandKind: 'workflow-command',
        expectedRevisions: { ...ZERO_REVISIONS, projectionRevision: 5 },
        messageType: 'command.request',
        payload: {
          age: values.age,
          artAssetKeyOrLocalFile: values.artAssetKeyOrLocalFile,
          characterDraftId,
          description: values.description,
          draftRevision: 1,
          massKg: values.massKg,
          name: values.name,
          sex: values.sex,
          stage: 'IDENTITY',
          wizardCheckpointId,
        },
        protocolVersion: WIRE_PROTOCOL_VERSION,
        role: 'player',
        workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
      } as const satisfies CheckpointRequest;

      // Exact shape is decoded first, but authority/revisions precede the full
      // application guard. An invalid value on a stale request therefore stays stale.
      const writesBeforeCheckpoint = runtime.writes.length;
      frames = receiveFrames(creatorSocket, 1);
      creatorSocket.send(
        clientText(
          {
            ...checkpointRequest,
            commandId: 'checkpoint-stale-invalid-mass',
            expectedRevisions: { ...ZERO_REVISIONS, projectionRevision: 4 },
            payload: { ...checkpointRequest.payload, massKg: -1 },
          },
          vocabulary,
        ),
      );
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: 'checkpoint-stale-invalid-mass',
        refusal: {
          actual: { ...ZERO_REVISIONS, projectionRevision: 5 },
          code: 'STALE_REVISION',
          expected: { ...ZERO_REVISIONS, projectionRevision: 4 },
        },
        revisions: { ...ZERO_REVISIONS, projectionRevision: 5 },
      });

      frames = receiveFrames(creatorSocket, 1);
      creatorSocket.send(
        clientText(
          {
            ...checkpointRequest,
            commandId: 'checkpoint-invalid-mass',
            payload: { ...checkpointRequest.payload, massKg: -1 },
          },
          vocabulary,
        ),
      );
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: 'checkpoint-invalid-mass',
        refusal: { code: 'GUARD_REJECTED' },
        revisions: { ...ZERO_REVISIONS, projectionRevision: 5 },
      });

      frames = receiveFrames(creatorSocket, 1);
      creatorSocket.send(
        clientText(
          {
            ...checkpointRequest,
            commandId: 'checkpoint-draft-mismatch',
            payload: { ...checkpointRequest.payload, sex: 'FEMALE' },
          },
          vocabulary,
        ),
      );
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        commandId: 'checkpoint-draft-mismatch',
        refusal: { code: 'GUARD_REJECTED' },
        revisions: { ...ZERO_REVISIONS, projectionRevision: 5 },
      });
      expect(runtime.writes).toHaveLength(writesBeforeCheckpoint);
      expect(database.prepare('SELECT count(*) AS count FROM local_character').get()).toEqual({
        count: 0,
      });

      frames = receiveFrames(creatorSocket, 2);
      creatorSocket.send(clientText(checkpointRequest, vocabulary));
      const checkpointFrames = await frames;
      const result = hostMessage(checkpointFrames[0] ?? '', vocabulary);
      const chr010 = hostMessageV2(checkpointFrames[1] ?? '', vocabulary);
      expect(result).toMatchObject({
        lifecycleState: 'COMMITTED',
        messageType: 'command.result',
        receipt: {
          commandId: checkpointRequest.commandId,
          result: {
            branchCacheHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
            characterDraftId,
            checkpointId: wizardCheckpointId,
            checkpointOwnerId: characterDraftId,
            checkpointRevision: 0,
            draftRevision: 1,
            nextFormId: 'CHR-010',
            stage: 'IDENTITY',
          },
          revisions: ZERO_REVISIONS,
        },
      });
      if (result.messageType !== 'command.result') throw new Error('missing command result');
      expect(result.receipt.receiptId).not.toBe(checkpointRequest.commandId);
      expect(result.receipt.receiptId).not.toBe(characterDraftId);
      expect(result.receipt.receiptId).not.toBe(wizardCheckpointId);
      expect(chr010).toEqual({
        messageType: 'projection.snapshot',
        presentation: {
          assignment: {
            correlationId: checkpointRequest.commandId,
            reason: 'COMMAND_DESTINATION',
          },
          base: {
            availableActionKeys: ['CHR-010::CTA::004', 'CHR-010::CTA::005', 'CHR-010::CTA::006'],
            formId: 'CHR-010',
            formType: 'screen',
            roleFilteredPayload: {
              ancientOptionSerialized: false,
              characterDraftId,
              choiceLockStatus: 'UNLOCKED',
              commandId: null,
              draftRevision: 1,
              raceChoice: null,
              raceConsequencesPreview: null,
              wizardCheckpointId,
            },
            routeBindings: [{ parameterIndex: 0, source: 'inherited', value: characterDraftId }],
            routeTemplate: '/player/characters/:localCharacterId/create/chr-010',
          },
          layers: [],
        },
        projectionRole: 'player',
        protocolVersion: 2,
        revisions: ZERO_REVISIONS,
      });
      expect(runtime.read()).toEqual({ ...ZERO_REVISIONS, projectionRevision: 6 });

      // The old scope is gone after commit: an explicit sex change is refused and cannot
      // mutate either the shell axes or the durable exact request.
      const frozenSexUpdate = {
        ...identityRequest,
        draftUpdateId: 'identity-after-checkpoint',
        expectedDraftRevision: 1,
        expectedRevisions: { ...ZERO_REVISIONS, projectionRevision: 6 },
        values: { ...values, sex: 'FEMALE' },
      } as const satisfies IdentityDraftReplaceV3Message;
      const writesAfterCommit = runtime.writes.length;
      frames = receiveFrames(creatorSocket, 1);
      creatorSocket.send(clientTextV3(frozenSexUpdate, vocabulary));
      expect(hostMessageV3((await frames)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'character.identity-draft.refusal',
        refusal: { code: 'DRAFT_UNAVAILABLE' },
        revisions: { ...ZERO_REVISIONS, projectionRevision: 6 },
      });
      expect(runtime.writes).toHaveLength(writesAfterCommit);
      const durable = loadIdentityCheckpoint(database, characterDraftId);
      expect(durable.request.payload.sex).toBe('MALE');
      expect(durable.receipt).toEqual(result.receipt);

      // Same command is a zero-write replay; a changed payload with that ID conflicts first.
      frames = receiveFrames(creatorSocket, 2);
      creatorSocket.send(clientText(checkpointRequest, vocabulary));
      const replayFrames = await frames;
      expect(hostMessage(replayFrames[0] ?? '', vocabulary)).toEqual({
        lifecycleState: 'IDEMPOTENT_REPLAY',
        messageType: 'command.replay',
        protocolVersion: 1,
        receipt: result.receipt,
      });
      expect(hostMessageV2(replayFrames[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          assignment: { correlationId: checkpointRequest.commandId, reason: 'COMMAND_DESTINATION' },
          base: { formId: 'CHR-010' },
        },
        revisions: ZERO_REVISIONS,
      });
      frames = receiveFrames(creatorSocket, 1);
      creatorSocket.send(
        clientText(
          {
            ...checkpointRequest,
            payload: { ...checkpointRequest.payload, sex: 'FEMALE' },
          },
          vocabulary,
        ),
      );
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'command.refusal',
        refusal: {
          code: 'IDEMPOTENCY_CONFLICT',
          commandId: checkpointRequest.commandId,
          detail: 'PAYLOAD_MISMATCH',
        },
        revisions: ZERO_REVISIONS,
      });
      expect(runtime.writes).toHaveLength(writesAfterCommit);

      // ADR 0034 keeps persisted identity re-entry unavailable, with stale checked first.
      expect(
        await sendV2(
          creatorSocket,
          formAction('chr010-stale-return', 'CHR-010', 'CHR-010::CTA::003', 1),
          vocabulary,
        ),
      ).toMatchObject({
        refusal: {
          actualProjectionRevision: 0,
          code: 'STALE_PROJECTION',
          expectedProjectionRevision: 1,
        },
        revisions: ZERO_REVISIONS,
      });
      expect(
        await sendV2(
          creatorSocket,
          formAction('chr010-return', 'CHR-010', 'CHR-010::CTA::003', 0),
          vocabulary,
        ),
      ).toMatchObject({
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        revisions: ZERO_REVISIONS,
      });

      // The already-open APP-004 connection reads persistence again on projection.
      await sendV2(
        librarySocket,
        formAction('library-return-after-commit', 'APP-004', 'APP-004::CTA::007', 6),
        vocabulary,
      );
      const liveLibrary = await sendV2(
        librarySocket,
        formAction('library-reopen-after-commit', 'APP-002', 'APP-002::CTA::002', 7),
        vocabulary,
      );
      expect(liveLibrary).toMatchObject({
        presentation: {
          base: {
            formId: 'APP-004',
            roleFilteredPayload: {
              draftCharacterIds: [characterDraftId],
              finalCharacterIds: [],
              localCharacterLibraryRevision: 1,
            },
          },
        },
        revisions: { ...ZERO_REVISIONS, projectionRevision: 8 },
      });

      for (const socket of sockets.splice(0)) socket.terminate();
      await app.close();

      // A new host gets library baseline 0 from the already-persisted row. Open the
      // library before restoring the signed command destination on another connection.
      runtime = revisionRuntime();
      app = await start();
      librarySocket = await app.injectWS('/state');
      sockets.push(librarySocket);
      frames = receiveFrames(librarySocket, 2);
      librarySocket.send(clientTextV2(reconnect(deviceId, 'restart-library'), vocabulary));
      await frames;
      await sendV2(
        librarySocket,
        formAction('restart-library-player', 'APP-001', 'APP-001::CTA::001', 0),
        vocabulary,
      );
      const restartedLibrary = await sendV2(
        librarySocket,
        formAction('restart-library-open', 'APP-002', 'APP-002::CTA::002', 1),
        vocabulary,
      );
      expect(restartedLibrary).toMatchObject({
        presentation: {
          base: {
            formId: 'APP-004',
            roleFilteredPayload: {
              draftCharacterIds: [characterDraftId],
              localCharacterLibraryRevision: 0,
            },
          },
        },
      });

      const recoverySocket = await app.injectWS('/state');
      sockets.push(recoverySocket);
      frames = receiveFrames(recoverySocket, 3);
      recoverySocket.send(
        clientTextV2(
          reconnect(deviceId, 'restart-recovery', [checkpointRequest.commandId]),
          vocabulary,
        ),
      );
      const recoveredFrames = await frames;
      expect(hostMessage(recoveredFrames[0] ?? '', vocabulary)).toEqual({
        lifecycleState: 'IDEMPOTENT_REPLAY',
        messageType: 'command.replay',
        protocolVersion: 1,
        receipt: result.receipt,
      });
      expect(hostMessageV2(recoveredFrames[1] ?? '', vocabulary)).toMatchObject({
        executableWorkflowCommandIds: [IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID],
        reconnectRequestId: 'restart-recovery',
        revisions: ZERO_REVISIONS,
      });
      expect(hostMessageV2(recoveredFrames[2] ?? '', vocabulary)).toMatchObject({
        presentation: {
          assignment: { correlationId: 'restart-recovery', reason: 'RECONNECT' },
          base: { formId: 'CHR-010', roleFilteredPayload: { characterDraftId } },
        },
        revisions: ZERO_REVISIONS,
      });

      // Once the replay was delivered and the command is acknowledged, transport reconnect
      // still restores the live host's entity-bound CHR-010 assignment.
      const completedReconnect = await app.injectWS('/state');
      sockets.push(completedReconnect);
      frames = receiveFrames(completedReconnect, 2);
      completedReconnect.send(clientTextV2(reconnect(deviceId, 'completed-reconnect'), vocabulary));
      const completedFrames = await frames;
      expect(hostMessageV2(completedFrames[0] ?? '', vocabulary)).toMatchObject({
        reconnectRequestId: 'completed-reconnect',
        revisions: ZERO_REVISIONS,
      });
      expect(hostMessageV2(completedFrames[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          assignment: { correlationId: 'completed-reconnect', reason: 'RECONNECT' },
          base: { formId: 'CHR-010', roleFilteredPayload: { characterDraftId } },
        },
        revisions: ZERO_REVISIONS,
      });

      // A direct exact request on the restarted host is also journal-first and recovers
      // the same signed destination without consulting the obsolete draft scope.
      frames = receiveFrames(recoverySocket, 2);
      recoverySocket.send(clientText(checkpointRequest, vocabulary));
      const directReplay = await frames;
      expect(hostMessage(directReplay[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'command.replay',
        receipt: result.receipt,
      });
      expect(hostMessageV2(directReplay[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          assignment: { correlationId: checkpointRequest.commandId, reason: 'COMMAND_DESTINATION' },
          base: { formId: 'CHR-010' },
        },
        revisions: ZERO_REVISIONS,
      });
      expect(frameErrors).toEqual([]);
    } finally {
      for (const socket of sockets) socket.terminate();
      await app.close();
      database.close();
    }
  });

  it('destroys the old identity scope before a fallible post-commit shell advance', async () => {
    const database = openPersistenceDatabase(':memory:');
    const deviceId = bootstrapDeviceIdentity(database);
    const runtime = revisionRuntime();
    const errors: unknown[] = [];
    let failNextAdvance = false;
    let reportFrameError: ((error: unknown) => void) | undefined;
    const frameError = new Promise<unknown>((resolve) => {
      reportFrameError = resolve;
    });
    let allocatorSequence = 0;
    const app = await createHost({
      advanceRevisions: (impact) => {
        if (failNextAdvance) {
          failNextAdvance = false;
          throw new Error('injected post-commit shell advance failure');
        }
        return runtime.advance(impact);
      },
      allocateContextId: () =>
        `20000000-0000-4000-8000-${String(++allocatorSequence).padStart(12, '0')}`,
      allocateLocalCharacterId: () =>
        `30000000-0000-4000-8000-${String(++allocatorSequence).padStart(12, '0')}`,
      allocateReceiptId: () => `receipt-failure-${String(++allocatorSequence)}`,
      allocateWizardCheckpointId: () => `wizard-failure-${String(++allocatorSequence)}`,
      database,
      onFrameError: (error) => {
        errors.push(error);
        reportFrameError?.(error);
      },
      projectRoot: PROJECT_ROOT,
      readRevisions: runtime.read,
      staticRoot,
    });
    await startHost(app, { interface: '127.0.0.1', port: 0 });
    const creatorSocket = await app.injectWS('/state');
    const parallelSocket = await app.injectWS('/state');
    try {
      let frames = receiveFrames(creatorSocket, 2);
      creatorSocket.send(clientTextV2(reconnect(deviceId, 'failure-reconnect'), vocabulary));
      await frames;
      const app002 = await sendV2(
        creatorSocket,
        formAction('failure-player', 'APP-001', 'APP-001::CTA::001', 0),
        vocabulary,
      );
      if (app002.messageType !== 'projection.snapshot') throw new Error('missing APP-002');
      const contextId = app002.presentation.base.roleFilteredPayload['contextId'];
      const chr001 = await sendV2(
        creatorSocket,
        formAction('failure-draft', 'APP-002', 'APP-002::CTA::007', 1),
        vocabulary,
      );
      if (chr001.messageType !== 'projection.snapshot') throw new Error('missing CHR-001');
      const characterDraftId = chr001.presentation.base.roleFilteredPayload['characterDraftId'];
      const wizardCheckpointId = chr001.presentation.base.roleFilteredPayload['wizardCheckpointId'];
      if (
        typeof contextId !== 'string' ||
        typeof characterDraftId !== 'string' ||
        typeof wizardCheckpointId !== 'string'
      ) {
        throw new Error('missing identity scope');
      }
      const scope = {
        characterDraftId,
        contextId,
        sourceFormId: 'CHR-001',
        wizardCheckpointId,
      } as const;
      const values = {
        age: 24,
        artAssetKeyOrLocalFile: null,
        description: null,
        massKg: 70.1,
        name: 'Alice',
        sex: 'MALE',
      } as const;
      const identityRequest = {
        draftUpdateId: 'failure-identity-ready',
        expectedDraftRevision: 0,
        expectedRevisions: { ...ZERO_REVISIONS, projectionRevision: 2 },
        messageType: 'character.identity-draft.replace',
        protocolVersion: WIRE_PROTOCOL_V3_VERSION,
        scope,
        values,
      } as const satisfies IdentityDraftReplaceV3Message;
      frames = receiveFrames(creatorSocket, 1);
      creatorSocket.send(clientTextV3(identityRequest, vocabulary));
      expect(hostMessageV3((await frames)[0] ?? '', vocabulary)).toMatchObject({
        draftRevision: 1,
        messageType: 'character.identity-draft.result',
        revisions: { ...ZERO_REVISIONS, projectionRevision: 3 },
      });

      // A second transport captures the old assignment before the commit. It is the
      // hostile writer used after the committing transport is closed with code 1011.
      frames = receiveFrames(parallelSocket, 2);
      parallelSocket.send(clientTextV2(reconnect(deviceId, 'failure-parallel'), vocabulary));
      const parallelReconnect = await frames;
      expect(hostMessageV2(parallelReconnect[1] ?? '', vocabulary)).toMatchObject({
        presentation: { base: { formId: 'CHR-001' } },
        revisions: { ...ZERO_REVISIONS, projectionRevision: 3 },
      });

      const checkpointRequest = {
        commandId: 'checkpoint-postcommit-failure',
        commandKind: 'workflow-command',
        expectedRevisions: { ...ZERO_REVISIONS, projectionRevision: 3 },
        messageType: 'command.request',
        payload: {
          age: values.age,
          artAssetKeyOrLocalFile: values.artAssetKeyOrLocalFile,
          characterDraftId,
          description: values.description,
          draftRevision: 1,
          massKg: values.massKg,
          name: values.name,
          sex: values.sex,
          stage: 'IDENTITY',
          wizardCheckpointId,
        },
        protocolVersion: WIRE_PROTOCOL_VERSION,
        role: 'player',
        workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
      } as const satisfies CheckpointRequest;
      failNextAdvance = true;
      creatorSocket.send(clientText(checkpointRequest, vocabulary));
      await expect(frameError).resolves.toMatchObject({
        message: 'injected post-commit shell advance failure',
      });
      expect(runtime.read()).toEqual({ ...ZERO_REVISIONS, projectionRevision: 3 });
      expect(database.prepare('SELECT count(*) AS count FROM local_character').get()).toEqual({
        count: 1,
      });

      const frozenSexUpdate = {
        ...identityRequest,
        draftUpdateId: 'failure-parallel-sex-change',
        expectedDraftRevision: 1,
        expectedRevisions: { ...ZERO_REVISIONS, projectionRevision: 3 },
        values: { ...values, sex: 'FEMALE' },
      } as const satisfies IdentityDraftReplaceV3Message;
      frames = receiveFrames(parallelSocket, 1);
      parallelSocket.send(clientTextV3(frozenSexUpdate, vocabulary));
      expect(hostMessageV3((await frames)[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'character.identity-draft.refusal',
        refusal: { code: 'DRAFT_UNAVAILABLE' },
        revisions: { ...ZERO_REVISIONS, projectionRevision: 3 },
      });
      const durable = loadIdentityCheckpoint(database, characterDraftId);
      expect(durable.request.payload.sex).toBe('MALE');

      // Journal and signed destination were installed before the failed runtime update,
      // so the surviving transport recovers through exact replay without a second write.
      frames = receiveFrames(parallelSocket, 2);
      parallelSocket.send(clientText(checkpointRequest, vocabulary));
      const replay = await frames;
      expect(hostMessage(replay[0] ?? '', vocabulary)).toMatchObject({
        messageType: 'command.replay',
        receipt: durable.receipt,
      });
      expect(hostMessageV2(replay[1] ?? '', vocabulary)).toMatchObject({
        presentation: {
          assignment: { correlationId: checkpointRequest.commandId, reason: 'COMMAND_DESTINATION' },
          base: { formId: 'CHR-010' },
        },
        revisions: ZERO_REVISIONS,
      });
      expect(errors).toHaveLength(1);
    } finally {
      creatorSocket.terminate();
      parallelSocket.terminate();
      await app.close();
      database.close();
    }
  });

  it('names an unsupported checkpoint stage with zero writes', async () => {
    const database = openPersistenceDatabase(':memory:');
    const deviceId = bootstrapDeviceIdentity(database);
    const runtime = revisionRuntime();
    const errors: unknown[] = [];
    const app = await createHost({
      advanceRevisions: runtime.advance,
      allocateContextId: () => '00000000-0000-4000-8000-000000000001',
      allocateLocalCharacterId: () => '10000000-0000-4000-8000-000000000001',
      allocateReceiptId: () => 'receipt-refusal',
      allocateWizardCheckpointId: () => 'wizard-refusal',
      database,
      onFrameError: (error) => errors.push(error),
      projectRoot: PROJECT_ROOT,
      readRevisions: runtime.read,
      staticRoot,
    });
    await startHost(app, { interface: '127.0.0.1', port: 0 });
    const socket = await app.injectWS('/state');
    try {
      let frames = receiveFrames(socket, 2);
      socket.send(clientTextV2(reconnect(deviceId, 'refusal-reconnect'), vocabulary));
      await frames;
      const unsupportedStage = {
        commandId: 'unsupported-stage',
        commandKind: 'workflow-command',
        expectedRevisions: ZERO_REVISIONS,
        messageType: 'command.request',
        payload: {
          age: 24,
          artAssetKeyOrLocalFile: null,
          characterDraftId: 'draft',
          description: null,
          draftRevision: 1,
          massKg: 0,
          name: 'Alice',
          sex: 'MALE',
          stage: 'RACE',
          wizardCheckpointId: 'checkpoint',
        },
        protocolVersion: WIRE_PROTOCOL_VERSION,
        role: 'player',
        workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
      } as const satisfies CheckpointRequest;
      frames = receiveFrames(socket, 1);
      const encodedNegativeZero = clientText(unsupportedStage, vocabulary).replace(
        '"massKg":0',
        '"massKg":-0',
      );
      expect(encodedNegativeZero).toContain('"massKg":-0');
      socket.send(encodedNegativeZero);
      const firstRefusal = hostMessage((await frames)[0] ?? '', vocabulary);
      expect(firstRefusal).toMatchObject({
        commandId: unsupportedStage.commandId,
        refusal: { code: 'UNRECOGNIZED', path: '$.payload.stage', value: 'RACE' },
        revisions: ZERO_REVISIONS,
      });

      // Invalid literal requests are journaled too. JSON -0 and +0 compare by the
      // protocol's numeric normalization even though stage decoding stopped earlier.
      frames = receiveFrames(socket, 1);
      socket.send(clientText(unsupportedStage, vocabulary));
      expect(hostMessage((await frames)[0] ?? '', vocabulary)).toEqual(firstRefusal);
      expect(runtime.writes).toEqual([]);
      expect(database.prepare('SELECT count(*) AS count FROM local_character').get()).toEqual({
        count: 0,
      });
      expect(errors).toEqual([]);
    } finally {
      socket.terminate();
      await app.close();
      database.close();
    }
  });
});
