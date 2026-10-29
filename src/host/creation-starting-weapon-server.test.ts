import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RawData, WebSocket } from 'ws';

import type { ActionKey } from '@generated/types/atlas.js';

import {
  decodeHostMessage,
  decodeHostMessageV2,
  encodeClientMessage,
  encodeClientMessageV2,
  WIRE_PROTOCOL_V2_VERSION,
} from '@shared/index.js';
import type {
  AddressableRouteTemplate,
  ClientToHostMessage,
  ClientToHostV2Message,
  CommandReplayMessage,
  CommandResultMessage,
  HostToClientMessage,
  HostToClientV2Message,
  JsonObject,
  ProtocolVocabulary,
  RevisionVector,
  WireV2Vocabulary,
  WorkflowCommandRequestMessage,
} from '@shared/index.js';

import { openPersistenceDatabase, type RevisionImpact } from '../persistence/index.js';
import {
  currentCreationWizardRevisions,
  loadCreationWizardCheckpoint,
} from './creation-set-decide.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { createHost, startHost } from './server.js';
import { CHR_018_ROUTE } from './projections/chr-manual-symbionts.js';
import {
  createManualWizardSetup,
  manualCompositionRequest,
  type ManualWizardSetup,
} from '../../tests/fixtures/manual-symbiont-stage.js';
import { CATALOG } from '../../tests/fixtures/symbiont-stage.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ZERO: RevisionVector = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
};
const ALL_COMMANDS = [
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  'UI-CMD-CHAR-CREATION-SET-DECIDE',
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  'UI-CMD-PLAYER-WEAPON-REQUEST-SUBMIT',
] as const;
type WorkflowRequest = Extract<ClientToHostMessage, { readonly commandKind: 'workflow-command' }>;
type Snapshot = Extract<HostToClientV2Message, { readonly messageType: 'projection.snapshot' }>;
interface WeaponHost extends ManualWizardSetup {
  readonly app: FastifyInstance;
  readonly socket: WebSocket;
  readonly sampleCalls: () => number;
  readonly allocations: () => number;
}
const databases: ReturnType<typeof openPersistenceDatabase>[] = [];
const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
const directories: string[] = [];
let vocabulary: ProtocolVocabulary & WireV2Vocabulary;
let staticRoot: string;

beforeAll(async () => {
  vocabulary = await loadProtocolVocabulary(PROJECT_ROOT);
  staticRoot = await mkdtemp(join(tmpdir(), 'starting-weapon-static-'));
  await writeFile(join(staticRoot, 'index.html'), '<main>starting weapon</main>', 'utf8');
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const app of apps.splice(0)) await app.close();
  for (const database of databases.splice(0)) if (database.open) database.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await rm(staticRoot, { recursive: true, force: true });
});

function current(host: WeaponHost) {
  return loadCreationWizardCheckpoint(
    host.database,
    host.characterDraftId,
    CATALOG.skillStage,
    CATALOG,
  );
}
function rawText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  throw new TypeError('unsupported RawData');
}
function receive(socket: WebSocket, count: number): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    const frames: string[] = [];
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`expected ${String(count)} frames; received ${frames.join(' | ')}`));
    }, 5000);
    const onMessage = (data: RawData): void => {
      frames.push(rawText(data));
      if (frames.length === count) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(frames);
      }
    };
    socket.on('message', onMessage);
  });
}
function clientText(request: WorkflowRequest): string {
  const encoded = encodeClientMessage(request, vocabulary);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.refusal));
  return encoded.text;
}
function clientV2(request: ClientToHostV2Message): string {
  const encoded = encodeClientMessageV2(request, vocabulary);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.refusal));
  return encoded.text;
}
function hostMessage(text: string): HostToClientMessage {
  const decoded = decodeHostMessage(text, vocabulary);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.refusal));
  return decoded.value;
}
function snapshot(text: string): Snapshot {
  const decoded = decodeHostMessageV2(text, vocabulary);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.refusal));
  if (decoded.value.messageType !== 'projection.snapshot')
    throw new Error(`expected snapshot: ${text}`);
  return decoded.value;
}
async function openSocket(app: FastifyInstance): Promise<WebSocket> {
  const socket = await app.injectWS('/state');
  sockets.push(socket);
  return socket;
}
async function start(
  setup: ManualWizardSetup,
  faces: readonly number[],
  prefix: string,
): Promise<WeaponHost> {
  let revisions = ZERO;
  let sampleCalls = 0;
  let allocations = 0;
  let receiptIds = 0;
  const app = await createHost({
    projectRoot: PROJECT_ROOT,
    database: setup.database,
    staticRoot,
    readRevisions: () => revisions,
    advanceRevisions: (impact: RevisionImpact) => {
      revisions = {
        actorVisibilityRevision:
          revisions.actorVisibilityRevision + Number(impact.actorVisibilityChanged),
        projectionRevision: revisions.projectionRevision + Number(impact.projectionChanged),
        stateRevision: revisions.stateRevision + Number(impact.stateChanged),
      };
      return revisions;
    },
    allocateCreationBranchUuid: () => `${prefix}-branch`,
    allocateCreationRollRequestId: () => `${prefix}-request-${String(++allocations)}`,
    allocateContextId: () => '10000000-0000-4000-8000-000000000151',
    allocateLocalCharacterId: () => '20000000-0000-4000-8000-000000000151',
    allocateReceiptId: () => `${prefix}-receipt-${String(++receiptIds)}`,
    allocateWizardCheckpointId: () => `${prefix}-wizard`,
    sampleCreationD20: () => {
      const face = faces[sampleCalls];
      if (face === undefined) throw new Error('unexpected starting weapon D20 sampler call');
      sampleCalls += 1;
      return face;
    },
    onFrameError: (error) => {
      throw error;
    },
  });
  apps.push(app);
  await startHost(app, { interface: '127.0.0.1', port: 0 });
  return {
    ...setup,
    app,
    socket: await openSocket(app),
    sampleCalls: () => sampleCalls,
    allocations: () => allocations,
  };
}
async function reconnect(host: WeaponHost, id: string): Promise<Snapshot> {
  const frames = receive(host.socket, 2);
  host.socket.send(
    clientV2({
      protocolVersion: WIRE_PROTOCOL_V2_VERSION,
      messageType: 'session.reconnect',
      reconnectRequestId: id,
      deviceId: host.deviceId,
      knownRevisions: ZERO,
      supportedWorkflowCommandIds: ALL_COMMANDS,
      unacknowledgedCommandIds: [],
    }),
  );
  return snapshot((await frames)[1]!);
}
async function navigation(host: WeaponHost, request: ClientToHostV2Message): Promise<Snapshot> {
  const frames = receive(host.socket, 1);
  host.socket.send(clientV2(request));
  return snapshot((await frames)[0]!);
}
async function action(
  host: WeaponHost,
  view: Snapshot,
  id: string,
  source: 'CHR-021' | 'CHR-022' | 'CHR-023' | 'CHR-038',
  actionKey: ActionKey,
): Promise<Snapshot> {
  return navigation(host, {
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    messageType: 'navigation.form-action',
    navigationRequestId: id,
    sourceFormId: source,
    actionKey,
    expectedProjectionRevision: view.revisions.projectionRevision,
  });
}
async function command(
  host: WeaponHost,
  request: WorkflowRequest,
): Promise<readonly [CommandResultMessage | CommandReplayMessage, Snapshot]> {
  const frames = receive(host.socket, 2);
  host.socket.send(clientText(request));
  const received = await frames;
  const result = hostMessage(received[0]!);
  if (result.messageType !== 'command.result' && result.messageType !== 'command.replay')
    throw new Error(`unexpected terminal ${JSON.stringify(result)}`);
  return [result, snapshot(received[1]!)];
}
async function refusal(host: WeaponHost, request: WorkflowRequest): Promise<string> {
  const frames = receive(host.socket, 1);
  host.socket.send(clientText(request));
  const result = hostMessage((await frames)[0]!);
  if (result.messageType !== 'command.refusal')
    throw new Error(`expected refusal: ${JSON.stringify(result)}`);
  return result.refusal.code;
}
function request(
  host: WeaponHost,
  id: string,
  payload: JsonObject,
  roll = false,
): WorkflowCommandRequestMessage {
  const checkpoint = current(host);
  return {
    protocolVersion: 1,
    messageType: 'command.request',
    commandId: id,
    commandKind: 'workflow-command',
    workflowCommandId: roll ? 'UI-CMD-CHAR-CREATION-ROLL-COMMIT' : 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
    role: 'player',
    expectedRevisions: currentCreationWizardRevisions(checkpoint),
    payload: {
      stage: 'SYMBIONTS',
      characterDraftId: host.characterDraftId,
      wizardCheckpointId: host.wizardCheckpointId,
      draftRevision: checkpoint.receipt.result.draftRevision,
      ...payload,
    },
  };
}
async function enterWeapon(
  host: WeaponHost,
  mode: 'AUTO' | 'MANUAL',
  prefix: string,
): Promise<Snapshot> {
  const initial = await reconnect(host, `${prefix}-initial`);
  await navigation(host, {
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    messageType: 'navigation.addressable-route',
    navigationRequestId: `${prefix}-eel`,
    expectedProjectionRevision: initial.revisions.projectionRevision,
    routeTemplate: CHR_018_ROUTE as AddressableRouteTemplate,
    bindings: [{ parameterIndex: 1, source: 'client-selected', value: 'EEL' }],
  });
  await command(
    host,
    manualCompositionRequest(host, current(host), `${prefix}-composition`, ['EEL']),
  );
  await command(
    host,
    request(host, `${prefix}-armor-entry`, {
      sourceFormId: 'CHR-019',
      variant: 'ARMOR_BUNDLE_ENTRY',
    }),
  );
  const armor = current(host).armorBundleStage!;
  await command(
    host,
    request(
      host,
      `${prefix}-armor-quality`,
      {
        sourceFormId: 'CHR-021',
        variant: 'ARMOR_BUNDLE_QUALITY',
        armorBundleId: armor.armorBundleId,
        qualityRollRequestId: armor.qualityRollRequestId,
        armorPieces: [{ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' }],
        manualFaceOrNull: mode === 'MANUAL' ? 16 : null,
      },
      true,
    ),
  );
  const [, entered] = await command(
    host,
    request(host, `${prefix}-armor-checkpoint`, {
      sourceFormId: 'CHR-021',
      variant: 'ARMOR_BUNDLE_CHECKPOINT',
      armorBundleId: armor.armorBundleId,
      qualityRollReceiptId:
        current(host).armorBundleStage!.qualityRollRecordOrNull!.receipt.receiptId,
    }),
  );
  expect(entered.presentation.base.formId).toBe('CHR-022');
  return entered;
}

describe('CHR-022 real host WS journey', () => {
  it.each(['MANUAL', 'AUTO'] as const)(
    'preserves %s selection and one D20 through hostile commands, safe-return, two sessions and SQLite restart',
    { timeout: 30000 },
    async (mode) => {
      const prefix = `weapon-${mode.toLowerCase()}`;
      const directory = await mkdtemp(join(tmpdir(), `${prefix}-`));
      directories.push(directory);
      const databasePath = join(directory, 'host.sqlite');
      const setup = createManualWizardSetup(prefix, 'FREE', mode, databasePath);
      databases.push(setup.database);
      const host = await start(setup, mode === 'AUTO' ? [16, 1] : [], prefix);
      const entered = await enterWeapon(host, mode, prefix);
      const pending = current(host);
      const weaponRequestId = pending.startingWeaponStage!.weaponQualityRollRequestId;
      const armor = pending.armorBundleStage!;
      const sampleBeforeRoll = host.sampleCalls();
      const allocationsBeforeRoll = host.allocations();
      expect(entered.presentation.base.roleFilteredPayload).toMatchObject({
        weaponQualityRollRequestId: weaponRequestId,
        weaponQualityRollReceiptIdOrNull: null,
        ownershipState: 'OWNED_NOT_EQUIPPED',
      });
      const sessionB = { ...host, socket: await openSocket(host.app) };
      await reconnect(sessionB, `${prefix}-second-session`);

      const roll = request(
        host,
        `${prefix}-weapon-quality`,
        {
          sourceFormId: 'CHR-022',
          variant: 'STARTING_WEAPON_QUALITY',
          weaponQualityRollRequestId: weaponRequestId,
          weaponTypeId: 'ITM-WPN-012',
          weaponVariant: 'TWO_HAND',
          manualFaceOrNull: mode === 'MANUAL' ? 1 : null,
        },
        true,
      );
      expect(
        await refusal(host, { ...roll, commandId: `${prefix}-stale`, expectedRevisions: ZERO }),
      ).toBe('STALE_REVISION');
      for (const [suffix, weaponTypeId, weaponVariant] of [
        ['unknown', 'unknown-weapon', 'DEFAULT'],
        ['mixed', 'ITM-WPN-001', 'TWO_HAND'],
        ['incompatible', 'ITM-WPN-003', 'DEFAULT'],
      ] as const) {
        expect(
          await refusal(host, {
            ...roll,
            commandId: `${prefix}-${suffix}`,
            payload: { ...roll.payload, weaponTypeId, weaponVariant },
          }),
        ).toBe('GUARD_REJECTED');
      }
      expect(current(host).localCharacter).toEqual(pending.localCharacter);
      expect(current(host).checkpoint).toEqual(pending.checkpoint);
      expect(host.sampleCalls()).toBe(sampleBeforeRoll);
      expect(host.allocations()).toBe(allocationsBeforeRoll);

      const [rolledResult, rolled] = await command(host, roll);
      expect(rolledResult.messageType).toBe('command.result');
      const afterRoll = current(host);
      const weaponReceiptId =
        afterRoll.startingWeaponStage!.qualityRollRecordOrNull!.receipt.receiptId;
      expect(afterRoll.armorBundleStage).toEqual(armor);
      expect(rolled.presentation.base.roleFilteredPayload).toMatchObject({
        weaponTypeId: 'ITM-WPN-012',
        weaponVariant: 'TWO_HAND',
        weaponQualityRollRequestId: weaponRequestId,
        weaponQualityRollReceiptIdOrNull: weaponReceiptId,
        qualityRecommendation: { kind: 'MISSING_OR_UNFIT', rawFace: 1 },
        ownershipState: 'OWNED_NOT_EQUIPPED',
      });
      expect(host.sampleCalls()).toBe(sampleBeforeRoll + Number(mode === 'AUTO'));
      expect(host.allocations()).toBe(allocationsBeforeRoll);
      const [replay] = await command(host, roll);
      expect(replay.messageType).toBe('command.replay');
      expect(replay.receipt).toEqual(rolledResult.receipt);
      expect(
        await refusal(host, {
          ...roll,
          payload: { ...roll.payload, weaponVariant: 'ONE_HAND' },
        }),
      ).toBe('IDEMPOTENCY_CONFLICT');

      const returned = await action(
        host,
        rolled,
        `${prefix}-return`,
        'CHR-022',
        'CHR-022::CTA::003',
      );
      expect(returned.presentation.base.formId).toBe('CHR-021');
      expect(current(host).localCharacter.payloadJson).toBe(afterRoll.localCharacter.payloadJson);
      expect(current(host).localCharacter.stateRevision).toBe(
        afterRoll.localCharacter.stateRevision,
      );
      expect(current(host).checkpoint).toEqual({
        ...afterRoll.checkpoint,
        projectionRevision: returned.revisions.projectionRevision,
      });
      const beforeLate = current(host);
      const late = request(
        sessionB,
        `${prefix}-second-session-late`,
        { ...roll.payload, draftRevision: current(host).receipt.result.draftRevision },
        true,
      );
      expect(await refusal(sessionB, late)).toBe('GUARD_REJECTED');
      expect(current(host).localCharacter).toEqual(beforeLate.localCharacter);
      expect(current(host).checkpoint).toEqual(beforeLate.checkpoint);
      expect((await reconnect(host, `${prefix}-return-refresh`)).presentation.base.formId).toBe(
        'CHR-021',
      );
      expect(host.sampleCalls()).toBe(sampleBeforeRoll + Number(mode === 'AUTO'));

      await host.app.close();
      host.database.close();
      const reopened = openPersistenceDatabase(databasePath);
      databases.push(reopened);
      const restarted = await start(
        { ...setup, database: reopened },
        mode === 'AUTO' ? [20] : [],
        `${prefix}-restarted`,
      );
      const restoredReturn = await reconnect(restarted, `${prefix}-restart`);
      expect(restoredReturn.presentation.base.formId).toBe('CHR-021');
      const resumed = await action(
        restarted,
        restoredReturn,
        `${prefix}-resume`,
        'CHR-021',
        'CHR-021::CTA::001',
      );
      expect(resumed.presentation.base.formId).toBe('CHR-022');
      expect(resumed.presentation.base.roleFilteredPayload).toMatchObject({
        weaponQualityRollRequestId: weaponRequestId,
        weaponQualityRollReceiptIdOrNull: weaponReceiptId,
      });
      const [durableReplay] = await command(restarted, roll);
      expect(durableReplay.messageType).toBe('command.replay');
      expect(durableReplay.receipt).toEqual(rolledResult.receipt);

      const checkpointRequest = request(restarted, `${prefix}-weapon-checkpoint`, {
        sourceFormId: 'CHR-022',
        variant: 'STARTING_WEAPON_CHECKPOINT',
        weaponQualityRollRequestId: weaponRequestId,
        weaponQualityRollReceiptId: weaponReceiptId,
      });
      const [checkpointResult, completed] = await command(restarted, checkpointRequest);
      expect(completed.presentation.base.formId).toBe('CHR-023');
      expect(completed.presentation.base.availableActionKeys).toContain('CHR-023::CTA::002');
      expect(completed.presentation.base.roleFilteredPayload).toMatchObject({
        nextFormId: 'CHR-023',
        weaponQualityRollReceiptId: weaponReceiptId,
      });
      const [checkpointReplay] = await command(restarted, checkpointRequest);
      expect(checkpointReplay.messageType).toBe('command.replay');
      expect(checkpointReplay.receipt).toEqual(checkpointResult.receipt);
      const finalSnapshot = await reconnect(restarted, `${prefix}-final-refresh`);
      expect(finalSnapshot.presentation.base.formId).toBe('CHR-023');
      expect(finalSnapshot.presentation.base.availableActionKeys).toContain('CHR-023::CTA::002');
      expect(current(restarted).armorBundleStage).toEqual(armor);
      expect(restarted.allocations()).toBe(1);
      expect(restarted.sampleCalls()).toBe(0);
      expect(JSON.stringify(finalSnapshot.presentation)).not.toMatch(
        /CORE-\d|F-WPN-|Источник|availabilityTrace|randomSequenceId|finalQualityTier/,
      );
      // Item Registry TWO_HAND 012: L=1,Lw=10,Ls=4 and both R4=2 give S=18,D=15.
      const profileRequest: WorkflowRequest = {
        ...request(restarted, `${prefix}-profile-submit`, {
          sourceFormId: 'CHR-023',
          variant: 'WEAPON_PROFILE_SUBMIT',
          requestId: current(restarted).weaponProfileStage!.requestId,
          weaponTypeId: 'ITM-WPN-012',
          weaponVariant: 'TWO_HAND',
          inputs: {
            commonWitness: { L: 1, Lw: 10, Ls: 4 },
            independentDice: { R4_RS: 2, R4_RD: 2 },
            formulaOutputs: { Rs: 18, Rd: 15 },
          },
        }),
        workflowCommandId: 'UI-CMD-PLAYER-WEAPON-REQUEST-SUBMIT',
      };
      const [profileResult, submitted] = await command(restarted, profileRequest);
      expect(submitted.presentation.base.formId).toBe('CHR-038');
      expect(submitted.presentation.base.availableActionKeys).toEqual([
        'CHR-038::CTA::003',
        'CHR-038::CTA::002',
      ]);
      expect(profileResult.receipt.result).toMatchObject({
        outcome: 'SUBMITTED',
        approvalStatus: 'PENDING_GM',
        nextFormId: 'CHR-038',
      });
      const committed = current(restarted);
      const [profileReplay] = await command(restarted, profileRequest);
      expect(profileReplay.messageType).toBe('command.replay');
      expect(profileReplay.receipt).toEqual(profileResult.receipt);
      expect(
        await refusal(restarted, {
          ...profileRequest,
          commandId: `${prefix}-profile-stale`,
        }),
      ).toBe('GUARD_REJECTED'); // The active form is now CHR-038, before revision validation.
      expect(current(restarted).localCharacter).toEqual(committed.localCharacter);
      expect(current(restarted).checkpoint).toEqual(committed.checkpoint);
      expect(restarted.sampleCalls()).toBe(0);

      const moneyRequestId = committed.startingMoneyStage!.moneyRollRequestId;
      const moneyAllocations = restarted.allocations();
      const moneySessionB = { ...restarted, socket: await openSocket(restarted.app) };
      await reconnect(moneySessionB, `${prefix}-money-second-session`);
      const moneyPayload = {
        sourceFormId: 'CHR-038',
        variant: 'STARTING_MONEY_ROLL',
        moneyRollRequestId: moneyRequestId,
        manualFaceOrNull: mode === 'MANUAL' ? 5 : null,
      };
      const staleMoneyRoll = request(
        moneySessionB,
        `${prefix}-money-stale-session`,
        moneyPayload,
        true,
      );
      const moneyReturn = await action(
        restarted,
        submitted,
        `${prefix}-money-return`,
        'CHR-038',
        'CHR-038::CTA::002',
      );
      const profileReturn = await action(
        restarted,
        moneyReturn,
        `${prefix}-money-profile-return`,
        'CHR-022',
        'CHR-022::CTA::001',
      );
      const moneyResume = await action(
        restarted,
        profileReturn,
        `${prefix}-money-resume`,
        'CHR-023',
        'CHR-023::CTA::001',
      );
      expect(moneyResume.presentation.base.formId).toBe('CHR-038');
      const beforeStaleMoney = current(restarted);
      expect(beforeStaleMoney.localCharacter.payloadJson).toBe(
        committed.localCharacter.payloadJson,
      );
      expect(await refusal(moneySessionB, staleMoneyRoll)).toBe('STALE_REVISION');
      expect(current(restarted).localCharacter).toEqual(beforeStaleMoney.localCharacter);
      expect(current(restarted).checkpoint).toEqual(beforeStaleMoney.checkpoint);
      expect(restarted.sampleCalls()).toBe(0);
      expect(restarted.allocations()).toBe(moneyAllocations);

      const moneyRoll = request(restarted, `${prefix}-money-roll`, moneyPayload, true);
      const [moneyResult, moneyRolled] = await command(restarted, moneyRoll);
      expect(moneyResult.messageType).toBe('command.result');
      const afterMoney = current(restarted);
      const moneyReceiptId = afterMoney.startingMoneyStage!.rollRecordOrNull!.receipt.receiptId;
      expect(moneyRolled.presentation.base.formId).toBe('CHR-038');
      expect(moneyRolled.presentation.base.availableActionKeys).toEqual([
        'CHR-038::CTA::001',
        'CHR-038::CTA::002',
      ]);
      expect(moneyRolled.presentation.base.roleFilteredPayload).toMatchObject({
        moneyRollRequestId: moneyRequestId,
        moneyRollReceiptIdOrNull: moneyReceiptId,
        moneyRollFaceOrNull: mode === 'AUTO' ? 20 : 5,
        wealthRecommendation: { kind: mode === 'AUTO' ? 'RARE_FORTUNE' : 'SMALL' },
        gmFinalizationRequired: true,
      });
      expect(afterMoney.weaponProfileStage).toEqual(committed.weaponProfileStage);
      expect(afterMoney.startingWeaponStage).toEqual(committed.startingWeaponStage);
      expect(afterMoney.armorBundleStage).toEqual(armor);
      expect(restarted.sampleCalls()).toBe(Number(mode === 'AUTO'));
      expect(restarted.allocations()).toBe(moneyAllocations);
      const [moneyReplay] = await command(restarted, moneyRoll);
      expect(moneyReplay.messageType).toBe('command.replay');
      expect(moneyReplay.receipt).toEqual(moneyResult.receipt);
      expect(
        await refusal(restarted, {
          ...moneyRoll,
          payload: { ...moneyRoll.payload, manualFaceOrNull: 19 },
        }),
      ).toBe('IDEMPOTENCY_CONFLICT');
      expect(
        await refusal(moneySessionB, {
          ...staleMoneyRoll,
          commandId: `${prefix}-money-late-session`,
        }),
      ).toBe('STALE_REVISION');
      expect(current(restarted).localCharacter).toEqual(afterMoney.localCharacter);
      expect(current(restarted).checkpoint).toEqual(afterMoney.checkpoint);
      expect(restarted.sampleCalls()).toBe(Number(mode === 'AUTO'));
      expect(restarted.allocations()).toBe(moneyAllocations);

      const moneyCheckpoint = request(restarted, `${prefix}-money-checkpoint`, {
        sourceFormId: 'CHR-038',
        variant: 'STARTING_MONEY_CHECKPOINT',
        moneyRollRequestId: moneyRequestId,
        moneyRollReceiptId: moneyReceiptId,
      });
      const [moneyCheckpointResult, moneyCompleted] = await command(restarted, moneyCheckpoint);
      expect(moneyCompleted.presentation.base.formId).toBe('CHR-038');
      expect(moneyCompleted.presentation.base.availableActionKeys).toEqual([]);
      expect(moneyCompleted.presentation.base.roleFilteredPayload).toMatchObject({
        nextFormId: 'CHR-037',
        moneyRollRequestId: moneyRequestId,
        moneyRollReceiptIdOrNull: moneyReceiptId,
        gmFinalizationRequired: true,
      });
      expect(current(restarted).nextStageEnvelope.formId).toBe('CHR-037');
      const [moneyCheckpointReplay] = await command(restarted, moneyCheckpoint);
      expect(moneyCheckpointReplay.messageType).toBe('command.replay');
      expect(moneyCheckpointReplay.receipt).toEqual(moneyCheckpointResult.receipt);
      const moneyRefresh = await reconnect(restarted, `${prefix}-money-final-refresh`);
      expect(moneyRefresh.presentation.base.formId).toBe('CHR-038');
      expect(moneyRefresh.presentation.base.availableActionKeys).toEqual([]);
      expect(current(restarted).weaponProfileStage).toEqual(committed.weaponProfileStage);
      expect(restarted.sampleCalls()).toBe(Number(mode === 'AUTO'));
      expect(restarted.allocations()).toBe(moneyAllocations);
      expect(JSON.stringify(moneyRefresh.presentation)).not.toMatch(
        /CORE-\d|AQ2-\d|Источник|availabilityTrace|finalAmount|masterApproval|criticalChain/,
      );
    },
  );
});
