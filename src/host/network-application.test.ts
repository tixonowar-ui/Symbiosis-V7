import Database from 'better-sqlite3';
import { configurePersistenceDatabase } from '../persistence/database.js';
import { applyMigrationSequence, applyMigrations } from '../persistence/migrations/index.js';
import { migration0001 } from '../persistence/migrations/0001-initial.js';
import { migration0002 } from '../persistence/migrations/0002-local-character-checkpoint.js';
import { migration0003 } from '../persistence/migrations/0003-device-identity.js';
import { migration0004 } from '../persistence/migrations/0004-skill-presentation.js';
import { migration0005 } from '../persistence/migrations/0005-symbiont-presentation.js';
import { migration0006 } from '../persistence/migrations/0006-local-character-post-save.js';
import { migration0007 } from '../persistence/migrations/0007-campaign-creation.js';
import { migration0008 } from '../persistence/migrations/0008-network-installation-identity.js';
import { migration0009 } from '../persistence/migrations/0009-device-admission.js';
import { migration0010 } from '../persistence/migrations/0010-network-application.js';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '../shared/wire-protocol.js';
import type { ProjectionSnapshotV2Message } from '../shared/wire-v2-protocol.js';
import { NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS } from '../shared/device-admission.js';
import { campaignQrPayload } from '../shared/campaign-creation.js';
import {
  openPersistenceDatabase,
  bootstrapDeviceIdentity,
  loadDeviceId,
} from '../persistence/index.js';
import {
  ensureLocalGmProfile,
  createLocalGmContext,
  createCampaignDraft,
  readCampaignDraft,
  commitCampaignDraftUpdate,
  navigateCampaignDraft,
  commitCampaignCreation,
  readHostedCampaignCreationOrigin,
  type RedactedCampaignDraftRequest,
} from '../persistence/campaign-creation.js';
import { readHostedCurrentPausedCampaign } from '../persistence/current-paused-campaign.js';
import {
  readHostedPausedCampaignIds,
  commitHostedNetworkCommand,
  type HostedNetworkPrincipal,
  readGmRequestReviewView,
  readHostedDeviceRequestCurrent,
  commitGmRequestReviewNavigation,
  commitGmRequestReviewDraft,
  commitGmDeviceRequestDecision,
  type NetworkGmDecisionRequest,
} from '../persistence/network-device-request.js';
import {
  readLocalNetworkApplication,
  readLocalNetworkOutbox,
  readLocalNetworkDeliverySnapshot,
  readLocalNetworkRequestDeliverySnapshot,
  readLocalRequestLaneBinding,
  readLocalNetworkCancelSettlementEvent,
  commitLocalNetworkMutation,
} from '../persistence/network-local-application.js';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
} from '../../tests/fixtures/creation-finalization-stage.js';
import { commitCreationFinalization } from './creation-finalization.js';
import { loadCreationWizardCheckpoint } from './creation-set-decide.js';
import {
  loadLocalCharacterExportBaseline,
  canonicalPostSaveJson,
  postSaveSha256,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import { createCampaignBindManager } from './campaign-bind.js';
import { createCampaignNetworkEndpoint } from './campaign-network-endpoint.js';
import { createCampaignNetworkExecutor } from './campaign-network-executor.js';
import { initializeNetworkInstallation, loadNetworkInstallation } from './network-installation.js';
import { campaignPeerPublicIdentity } from './campaign-peer-identity.js';
import { acceptCampaignPeerChannel, connectCampaignPeerChannel } from './campaign-peer-channel.js';
import { parseCampaignLanAddress } from './campaign-lan-address.js';
import { validatePeerCampaignHeader } from './campaign-peer-handshake.js';
import { prepareMasterSecret, validateMasterSecretVerifier } from './campaign-secret.js';
import {
  createDeviceAdmissionPeerRuntime,
  type DeviceAdmissionPeerRuntimeLimits,
} from './device-admission-peer-runtime.js';
import { createLocalNetworkPeer } from './network-local-peer.js';
import type { DeviceAdmissionPeerResponse } from './device-admission-peer-response.js';
import {
  loadNetworkApplicationConfig,
  type NetworkApplicationConfig,
} from './network-application-config.js';
import {
  createLocalNetworkRuntime,
  type LocalNetworkConnection,
  type LocalNetworkShell,
  type LocalNetworkClientMessage,
  type LocalNetworkHostMessage,
} from './network-application.js';
import { isNetworkApplicationProjection } from '../shared/network-application-codec.js';
import { validateFinalAdmissionCandidate } from './device-admission-candidate.js';

let baseline: LocalCharacterExportBaseline,
  config: NetworkApplicationConfig,
  secret: Awaited<ReturnType<typeof prepareMasterSecret>>;
let player: Awaited<ReturnType<typeof createCreationFinalizationSetup>>,
  playerMaterial: ReturnType<typeof initializeNetworkInstallation>;
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const vector = (s: typeof zero) => ({
  stateRevision: s.stateRevision,
  projectionRevision: s.projectionRevision,
  actorVisibilityRevision: s.actorVisibilityRevision,
});
const cleaners: (() => Promise<void>)[] = [],
  dirs: string[] = [];
let limits: DeviceAdmissionPeerRuntimeLimits, channelLimits: NetworkApplicationConfig['channel'];
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  config = await loadNetworkApplicationConfig(process.cwd());
  limits = config.transfer;
  channelLimits = config.channel;
  secret = await prepareMasterSecret('Valid fixture secret', 'Valid fixture secret');
  player = await createCreationFinalizationSetup({
    prefix: 'local-application-source',
    raceChoice: 'FREE',
    diceInputMode: 'AUTO',
  });
  const current = commitCreationFinalization(
    player.setup.database,
    creationPropertySummaryRequest(player.current, 'local-source-summary'),
    'local-source-summary-receipt',
    player.dependencies,
  );
  commitCreationFinalization(
    player.setup.database,
    creationFinalSaveRequest(current, 'local-source-final'),
    'local-source-final-receipt',
    player.dependencies,
  );
  playerMaterial = initializeNetworkInstallation(player.setup.database);
});
afterEach(async () => {
  for (const close of cleaners.splice(0).reverse()) await close();
});
afterAll(() => {
  if (player.setup.database.open) player.setup.database.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function client() {
  const dir = mkdtempSync(join(tmpdir(), 'network-app-'));
  dirs.push(dir);
  const path = join(dir, 'player.sqlite');
  return player.setup.database.backup(path).then(() => {
    let db = openPersistenceDatabase(path),
      runtime: ReturnType<typeof createLocalNetworkRuntime>;
    let live = true,
      loseExit = false,
      loseDestination = false,
      lastExit: string | null = null,
      shellFinalId = player.setup.characterDraftId,
      shellForm: string | null = 'APP-002',
      shellContext: string | null = randomUUID();
    const sent: LocalNetworkHostMessage[] = [];
    const responses: DeviceAdmissionPeerResponse[] = [];
    let reconnectCount = 0;
    let dropPeer = () => {};
    const peerErrors: string[] = [];
    let beforeDeliver: (() => void | Promise<void>) | null = null;
    const c: LocalNetworkConnection = {
      networkScopeId: null,
      contextId: null,
      executableWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
      trusted: () => live && db.open && loadDeviceId(db) === playerMaterial.ownerDeviceId,
    };
    const own = (id: string, formId: 'APP-002' | 'CHR-040'): ProjectionSnapshotV2Message => ({
      messageType: 'projection.snapshot',
      protocolVersion: 2,
      projectionRole: 'player',
      revisions: zero,
      presentation: {
        assignment: { correlationId: id, reason: 'FORM_ACTION' },
        base: {
          formId,
          formType: 'screen',
          routeTemplate:
            formId === 'APP-002'
              ? '/player'
              : '/player/characters/:localCharacterId/create/chr-040',
          routeBindings:
            formId === 'APP-002'
              ? []
              : [{ parameterIndex: 0, source: 'inherited', value: player.setup.characterDraftId }],
          availableActionKeys: [],
          roleFilteredPayload: {},
        },
        layers: [],
      },
    });
    const shell: LocalNetworkShell = {
      get formId() {
        return shellForm;
      },
      get contextId() {
        return shellContext;
      },
      deviceId: playerMaterial.ownerDeviceId,
      revisions: zero,
      get sourceFinalIdOrNull() {
        return shellForm === 'CHR-040' ? shellFinalId : null;
      },
      get lastNetworkExitNavigationIdOrNull() {
        return lastExit;
      },
      enterNetwork() {
        lastExit = null;
        shellForm = null;
      },
      exitToPlayer(id) {
        if (loseExit) {
          loseExit = false;
          throw new Error('Simulated loss after durable close');
        }
        shellForm = 'APP-002';
        shellContext = randomUUID();
        lastExit = id;
        return own(id, 'APP-002');
      },
      returnToFinal(_source, id) {
        if (loseExit) {
          loseExit = false;
          throw new Error('Simulated loss after durable retained exit');
        }
        shellForm = 'CHR-040';
        shellContext = randomUUID();
        lastExit = id;
        return own(id, 'CHR-040');
      },
    };
    function start() {
      const catalog = player.setup.catalog;
      const peer = createLocalNetworkPeer({ database: db, baseline, config });
      dropPeer = () => peer.current(c.networkScopeId!)?.close();
      runtime = createLocalNetworkRuntime({
        database: db,
        projectRoot: process.cwd(),
        baseline,
        config,
        postSave: {
          database: db,
          baseline,
          symbiontCatalog: catalog,
          loadCheckpoint: (id) => loadCreationWizardCheckpoint(db, id, catalog.skillStage, catalog),
          resumeForm: (checkpoint) => checkpoint.nextStageEnvelope.formId,
        },
        peer: {
          ...peer,
          async reconnect(...args) {
            reconnectCount++;
            return peer.reconnect(...args);
          },
          async deliver(scope, out) {
            const before = beforeDeliver;
            beforeDeliver = null;
            await before?.();
            try {
              const value = await peer.deliver(scope, out);
              responses.push(value);
              return value;
            } catch (error) {
              peerErrors.push(error instanceof Error ? (error.stack ?? error.message) : 'unknown');
              throw error;
            }
          },
          async recover(scope, out) {
            const value = await peer.recover(scope, out);
            responses.push(value);
            return value;
          },
        },
        discover: () => Promise.resolve({ offers: [], diagnostics: [], truncated: false }),
      });
    }
    start();
    cleaners.push(() => {
      runtime.close();
      if (db.open) db.close();
      return Promise.resolve();
    });
    const scope = () => ({
      ownerDeviceId: playerMaterial.ownerDeviceId,
      networkScopeId: c.networkScopeId!,
    });
    const state = () => readLocalNetworkApplication(db, scope());
    const send = async (m: LocalNetworkClientMessage) => {
      sent.length = 0;
      expect(
        await runtime.handle(m, c, shell, (value) => {
          if (
            loseDestination &&
            value.messageType === 'projection.snapshot' &&
            value.protocolVersion === 2 &&
            value.presentation.assignment.reason === 'COMMAND_DESTINATION'
          ) {
            loseDestination = false;
            throw new Error('Simulated encoder failure after terminal delivery');
          }
          sent.push(value);
        }),
      ).toBe(true);
      return sent;
    };
    const nav = async (action: string, from?: string) => {
      const s = c.networkScopeId === null ? null : state();
      const m = {
        messageType: 'navigation.form-action' as const,
        protocolVersion: 2 as const,
        navigationRequestId: randomUUID(),
        sourceFormId: (from ?? s?.formId ?? shellForm) as 'NET-001',
        actionKey: action as 'NET-001::CTA::001',
        expectedProjectionRevision: s?.projectionRevision ?? 0,
      };
      await send(m);
      return m;
    };
    const payload = () => {
      const last = sent.findLast(
        (m) => m.messageType === 'projection.snapshot' || m.messageType === 'network.draft.result',
      );
      if (last === undefined || !('presentation' in last))
        throw new Error('Missing destination ' + JSON.stringify(sent));
      return last.presentation.base.roleFilteredPayload;
    };
    const replace = async (
      variant: 'ADDRESS' | 'SELECTION' | 'CANCEL_REASON',
      values: JsonObject,
    ) => {
      const s = state();
      const m = {
        messageType: 'network.draft.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        scope: {
          networkScopeId: s.networkScopeId,
          contextId: c.contextId!,
          sourceFormId: s.formId,
        },
        expectedDraftRevision: s.draftRevision,
        expectedRevisions: vector(s),
        variant,
        values,
      } as LocalNetworkClientMessage;
      await send(m);
      return m;
    };
    const command = async (
      id:
        'UI-CMD-CONNECTION-OPEN' | 'UI-CMD-DEVICE-REQUEST-SUBMIT' | 'UI-CMD-DEVICE-REQUEST-CANCEL',
      extras: JsonObject,
    ) => {
      const s = state();
      const m = {
        messageType: 'command.request' as const,
        protocolVersion: 1 as const,
        commandKind: 'workflow-command' as const,
        workflowCommandId: id,
        commandId: randomUUID(),
        role: 'player' as const,
        expectedRevisions: vector(s),
        payload: {
          networkScopeId: s.networkScopeId,
          contextId: c.contextId!,
          expectedDraftRevision: s.draftRevision,
          ...extras,
        },
      };
      await send(m);
      return m;
    };
    return {
      get db() {
        return db;
      },
      path,
      c,
      shell,
      sent,
      responses,
      peerErrors,
      reconnectCount: () => reconnectCount,
      dropPeer: () => dropPeer(),
      beforeNextDeliver(value: () => void | Promise<void>) {
        beforeDeliver = value;
      },
      send,
      nav,
      payload,
      replace,
      command,
      state,
      scope,
      disconnect() {
        runtime.close();
      },
      revoke() {
        live = false;
      },
      final(sourceId = player.setup.characterDraftId) {
        shellFinalId = sourceId;
        shellForm = 'CHR-040';
        shellContext = randomUUID();
        lastExit = null;
      },
      newPlayerTab() {
        lastExit = null;
        c.networkScopeId = null;
        c.contextId = null;
        shellForm = 'APP-002';
        shellContext = randomUUID();
      },
      laterLocalNavigation() {
        shellForm = 'APP-004';
        shellContext = randomUUID();
        lastExit = null;
      },
      loseNextDestination() {
        loseDestination = true;
      },
      loseNextExit() {
        loseExit = true;
      },
      reopenShell(formId: 'APP-002' | 'CHR-040', sourceId = player.setup.characterDraftId) {
        runtime.close();
        db.close();
        db = openPersistenceDatabase(path);
        c.networkScopeId = null;
        c.contextId = null;
        shellForm = formId;
        shellContext = randomUUID();
        shellFinalId = sourceId;
        lastExit = null;
        start();
      },
      async restart(pending: readonly string[] = [], retiredScope?: string) {
        const id = retiredScope ?? c.networkScopeId!,
          v = retiredScope === undefined ? vector(state()) : zero;
        runtime.close();
        db.close();
        db = openPersistenceDatabase(path);
        c.networkScopeId = null;
        c.contextId = null;
        shellForm = null;
        lastExit = null;
        start();
        await send({
          messageType: 'network.local-context.resume',
          protocolVersion: 3,
          networkScopeId: id,
          reconnectRequestId: randomUUID(),
          knownRevisions: v,
          supportedWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
          unacknowledgedCommandIds: pending,
        });
      },
    };
  });
}

async function submittedPlayer(
  h: Awaited<ReturnType<typeof host>>,
  legacy = false,
  loseFirstBindingAck = false,
  beforeSubmit?: (p: Awaited<ReturnType<typeof client>>) => void,
) {
  const p = await client();
  await p.nav('APP-002::CTA::003', 'APP-002');
  await p.nav('NET-001::CTA::001');
  await p.replace('ADDRESS', {
    addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
  });
  await p.command('UI-CMD-CONNECTION-OPEN', {
    attemptId: p.state().plannedAttemptIdOrNull,
    addressOrQrPayload: p.state().addressOrQrPayload,
    selectedCampaignIdOrNull: null,
  });
  const {
    name: _name,
    sourceSnapshotId: _snapshot,
    ...ref
  } = (p.payload()['eligibleFinalCandidates'] as readonly JsonObject[])[0]!;
  await p.replace('SELECTION', { selectedCandidates: [ref] });
  await p.nav('NET-003::CTA::001');
  expect(p.state().preparedBatchOrNull).toMatchObject({
    schemaVersion: 2,
    localControllerSeatId: p.state().tabId,
  });
  if (legacy) {
    const batch = p.state().preparedBatchOrNull!;
    await p.nav('NET-004::CTA::001');
    const {
      schemaVersion: _version,
      localControllerSeatId: _lane,
      batchSha256: _sha,
      ...body
    } = batch;
    const before = p.state();
    // A valid old batch is produced through the same store writer, never by editing old journal bytes.
    commitLocalNetworkMutation(
      p.db,
      {
        ...p.scope(),
        eventId: randomUUID(),
        receiptId: randomUUID(),
        expectedRevisions: vector(before),
        expectedDraftRevision: before.draftRevision,
        clientRequestJsonOrNull: null,
        mutation: {
          kind: 'PREPARE_BATCH',
          batch: {
            ...body,
            batchSha256: postSaveSha256(canonicalPostSaveJson(body)),
          },
        },
      },
      () => {
        if (!p.c.trusted() || loadDeviceId(p.db) !== p.scope().ownerDeviceId)
          throw new Error('Lost own source');
      },
    );
  }
  const batch = p.state().preparedBatchOrNull!;
  let originalHostedSubmit: unknown = null;
  if (legacy)
    p.beforeNextDeliver(() => {
      // Seed through the real schema10 writer, then forward-migrate before the upgraded peer replays it.
      expect(h.db.prepare('SELECT MAX(version) AS version FROM schema_migration').get()).toEqual({
        version: 10,
      });
      const commandId = p.state().pendingCommandIdOrNull!;
      const out = readLocalNetworkOutbox(p.db, p.scope(), commandId)!;
      if (out.intent.operation !== 'SUBMIT') throw new Error('Expected original legacy submit');
      commitHostedNetworkCommand(
        h.db,
        h.principal,
        {
          operation: 'SUBMIT',
          commandId,
          receiptId: randomUUID(),
          requestId: batch.requestId,
          technicalSessionId: batch.technicalSessionId,
          expectedConnectionRevision: batch.connectionRevision,
          batch,
          semanticBodyJson: out.intent.semanticBodyJson,
        },
        h.validate,
        () => {
          for (const candidate of batch.candidates)
            validateFinalAdmissionCandidate(
              candidate.canonicalWitnessText,
              p.scope().ownerDeviceId,
              candidate.descriptor,
              candidate.exportDocument,
              baseline,
              { maxWitnessBytes: config.transfer.maxWitnessBytes },
            );
        },
      );
      originalHostedSubmit = h.db
        .prepare('SELECT * FROM hosted_network_command WHERE command_id=?')
        .get(commandId);
      applyMigrations(h.db);
      expect(
        h.db.prepare('SELECT * FROM hosted_network_command WHERE command_id=?').get(commandId),
      ).toEqual(originalHostedSubmit);
      expect(h.db.prepare('SELECT MAX(version) AS version FROM schema_migration').get()).toEqual({
        version: 11,
      });
    });
  if (loseFirstBindingAck)
    p.db.exec(
      "CREATE TRIGGER fail_binding_ack BEFORE INSERT ON local_network_application_event WHEN json_extract(NEW.record_json,'$.input.mutation.kind')='LANE_BIND_ACK' BEGIN SELECT RAISE(ABORT,'binding ACK interrupted'); END",
    );
  beforeSubmit?.(p);
  const submit = await p.command('UI-CMD-DEVICE-REQUEST-SUBMIT', {
    requestId: batch.requestId,
    technicalSessionId: batch.technicalSessionId,
    connectionRevision: batch.connectionRevision,
    selectedCandidates: p.state().selectedCandidates,
  });
  expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-005');
  return { p, submit, batch, originalHostedSubmit };
}
function gmDecision(h: Awaited<ReturnType<typeof host>>, requestId: string, reject = false) {
  const scope = {
    ownerDeviceId: h.principal.hostOwnerDeviceId,
    gmLocalContextId: h.gmLocalContextId,
    campaignId: h.campaignId,
  };
  const guard = () => {
    if (loadDeviceId(h.db) !== scope.ownerDeviceId) throw new Error('Lost real GM owner');
    h.header();
  };
  let view = readGmRequestReviewView(h.db, scope, h.validate);
  if (view?.formId !== 'NET-017')
    view = commitGmRequestReviewNavigation(
      h.db,
      scope,
      {
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId: randomUUID(),
        sourceFormId: 'CMP-006',
        actionKey: 'CMP-006::CTA::002',
        expectedProjectionRevision: view?.projectionRevision ?? 0,
      },
      h.validate,
      guard,
    ).current;
  for (let n = 0; n < (reject ? 2 : 1); n++)
    view = commitGmRequestReviewDraft(
      h.db,
      scope,
      {
        messageType: 'network.gm-request-draft.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        scope: {
          gmLocalContextId: scope.gmLocalContextId,
          campaignId: scope.campaignId,
          sourceFormId: 'NET-017',
        },
        expectedRevisions: vector(view),
        expectedRequestQueueRevision: view.requestQueueRevision,
        values: {
          selectedRequestIdOrNull: requestId,
          decisionReason: reject ? 'Different candidates required' : '',
        },
      },
      h.validate,
      guard,
    ).current;
  const current = readHostedDeviceRequestCurrent(h.db, h.principal, requestId, h.validate);
  const common = {
    messageType: 'command.request' as const,
    protocolVersion: 1 as const,
    commandKind: 'workflow-command' as const,
    role: 'gm' as const,
    commandId: randomUUID(),
    expectedRevisions: vector(view),
  };
  const payload = { campaignId: h.campaignId, requestId, requestRevision: current.requestRevision };
  const request: NetworkGmDecisionRequest = reject
    ? {
        ...common,
        workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
        payload: { ...payload, reason: view.values.decisionReason },
      }
    : { ...common, workflowCommandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW', payload };
  return commitGmDeviceRequestDecision(
    h.db,
    scope,
    { request, receiptId: randomUUID(), timestamp: '2026-10-30T12:00:00.000Z' },
    h.validate,
    guard,
  );
}

describe('local network application with durable SQLite and real Node peers', () => {
  it.each(['construction', 'delivery'] as const)(
    'does not repeat or contradict a committed terminal after destination %s fails, and replays after reopen',
    async (failureStage) => {
      const h = await host();
      const captured: { player?: Awaited<ReturnType<typeof client>> } = {};
      await expect(
        submittedPlayer(h, false, false, (p) => {
          captured.player = p;
          if (failureStage === 'delivery') p.loseNextDestination();
          else {
            let pending = true,
              supported = p.c.executableWorkflowCommandIds;
            Object.defineProperty(p.c, 'executableWorkflowCommandIds', {
              configurable: true,
              get() {
                const state = p.state();
                if (
                  pending &&
                  state.requestOrNull !== null &&
                  state.pendingCommandIdOrNull === null
                ) {
                  pending = false;
                  throw new Error('Simulated projection construction failure after durable ACK');
                }
                return supported;
              },
              set(value: typeof supported) {
                supported = value;
              },
            });
          }
        }),
      ).rejects.toThrow('Network publication failed after durable acknowledgement');
      const p = captured.player;
      if (p === undefined) throw new Error('Missing actual owner fixture');
      const commandId = p.state().requestOrNull?.submitCommandId;
      if (commandId === undefined) throw new Error('Missing durable original SUBMIT');
      const result = p.sent.find((m) => m.messageType === 'command.result');
      expect(p.sent.filter((m) => m.messageType === 'command.result')).toHaveLength(
        failureStage === 'delivery' ? 1 : 0,
      );
      expect(p.sent.filter((m) => m.messageType === 'command.refusal')).toHaveLength(0);
      const original = readLocalNetworkOutbox(p.db, p.scope(), commandId);
      const acknowledgement = readLocalNetworkDeliverySnapshot(
        p.db,
        p.scope(),
        commandId,
      ).acknowledgementEvent;
      expect(original?.acknowledgementOrNull?.operation).toBe('SUBMIT');
      expect(p.state().formId).toBe('NET-005');
      await p.restart([commandId]);
      const replay = p.sent.find((m) => m.messageType === 'command.replay');
      expect(replay).toMatchObject({
        receipt: { commandId, receiptId: acknowledgement!.receipt.receiptId },
      });
      if (result?.messageType === 'command.result')
        expect(replay).toMatchObject({ receipt: result.receipt });
      expect(p.sent.find((m) => m.messageType === 'projection.snapshot')).toMatchObject({
        presentation: { base: { formId: 'NET-005' } },
      });
      expect(readLocalNetworkOutbox(p.db, p.scope(), commandId)).toEqual(original);
    },
    30000,
  );
  it('does not transfer a published owner subscription into a failed resume context', async () => {
    const h = await host(),
      { p } = await submittedPlayer(h),
      originalContext = p.c.contextId;
    const enter = vi.spyOn(p.shell, 'enterNetwork').mockImplementation(() => {
      throw new Error('Simulated shell transition failure before resumed projection');
    });
    await p.send({
      messageType: 'network.local-context.resume',
      protocolVersion: 3,
      networkScopeId: p.scope().networkScopeId,
      reconnectRequestId: randomUUID(),
      knownRevisions: vector(p.state()),
      supportedWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
      unacknowledgedCommandIds: [],
    });
    enter.mockRestore();
    expect(p.c.contextId).not.toBe(originalContext);
    expect(p.sent.some((m) => m.messageType === 'protocol.refusal')).toBe(true);
    expect(p.sent.some((m) => m.messageType === 'projection.snapshot')).toBe(false);
    const prepare = vi.spyOn(p.db, 'prepare');
    try {
      // The actual one-second owner timer must not read the failed new binding.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      prepare.mockRestore();
    }
  }, 30000);
  it('publishes owner review updates over the existing session and keeps the original SUBMIT replay unchanged', async () => {
    const h = await host(),
      { p, submit, batch } = await submittedPlayer(h);
    const original = p.sent.find((m) => m.messageType === 'command.result');
    expect(original?.messageType).toBe('command.result');
    const stored = readLocalNetworkOutbox(p.db, p.scope(), submit.commandId);
    gmDecision(h, batch.requestId);
    await expect
      .poll(
        () => {
          const pushed = p.sent.findLast(
            (m) =>
              m.messageType === 'projection.snapshot' &&
              m.protocolVersion === 2 &&
              m.presentation.assignment.reason === 'HOST_SYSTEM_EVENT',
          );
          return pushed?.messageType === 'projection.snapshot' && pushed.protocolVersion === 2
            ? pushed.presentation.base.roleFilteredPayload['requestStatus']
            : null;
        },
        { timeout: 10000 },
      )
      .toBe('IN_REVIEW');
    const pushed = p.sent.findLast((m) => m.messageType === 'projection.snapshot')!;
    if (pushed.messageType !== 'projection.snapshot' || pushed.protocolVersion !== 2)
      throw new Error('Missing actual owner push');
    expect(pushed.presentation.assignment.correlationId).toMatch(
      /^network-owner-view:[0-9a-f]{64}$/u,
    );
    expect(pushed.presentation.base.availableActionKeys).not.toContain('NET-005::CTA::001');
    expect(readLocalNetworkOutbox(p.db, p.scope(), submit.commandId)).toEqual(stored);
    gmDecision(h, batch.requestId, true);
    await expect
      .poll(() => p.state().requestReviewOrNull?.requestStatus, { timeout: 10000 })
      .toBe('REJECTED');
    await p.restart([submit.commandId]);
    const replay = p.sent.find((m) => m.messageType === 'command.replay');
    if (original?.messageType !== 'command.result' || replay?.messageType !== 'command.replay')
      throw new Error('Missing immutable terminal receipt');
    expect(replay.receipt).toEqual(original.receipt);
    expect(p.state().formId).toBe('NET-005');
    expect(p.state().requestReviewOrNull?.requestStatus).toBe('REJECTED');
    expect(p.payload()['requestStatus']).toBe('REJECTED');
    expect(JSON.stringify(p.sent)).not.toMatch(
      /canonicalWitnessText|privateKeyPkcs8Base64|learnedNodeRefs/u,
    );
    await p.nav('NET-005::CTA::003');
    expect(p.state().formId).toBe('NET-003');
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_character_copy').get()).toEqual({
      n: 0,
    });
  }, 30000);
  it.each(['live', 'missing'] as const)(
    'uses the authenticated %s channel correctly before CANCEL',
    async (channel) => {
      const h = await host(),
        { p, batch } = await submittedPlayer(h);
      await p.replace('CANCEL_REASON', { cancelReason: 'Withdraw' });
      if (channel === 'missing') p.dropPeer();
      const reconnects = p.reconnectCount(),
        before = p.responses.length;
      const cancel = await p.command('UI-CMD-DEVICE-REQUEST-CANCEL', {
        requestId: batch.requestId,
        technicalSessionId: batch.technicalSessionId,
        requestRevision: 0,
        reason: 'Withdraw',
      });
      expect(p.reconnectCount() - reconnects).toBe(channel === 'missing' ? 1 : 0);
      const responses = p.responses.slice(before);
      if (channel === 'missing')
        expect(responses[0]).toMatchObject({ operation: 'DEVICE_REQUEST_RECOVER', outcome: 'ACK' });
      expect(
        readLocalNetworkDeliverySnapshot(p.db, p.scope(), cancel.commandId).outbox
          ?.acknowledgementOrNull?.operation,
      ).toBe('CANCEL');
      expect(p.state().formId).toBe('NET-003');
    },
    30000,
  );
  it('settles CANCEL losing to review and recovers the same refusal after SQLite reopen without a fake ACK', async () => {
    const h = await host(),
      { p, batch } = await submittedPlayer(h);
    await p.replace('CANCEL_REASON', { cancelReason: 'Withdraw original submission' });
    p.beforeNextDeliver(() => {
      gmDecision(h, batch.requestId);
    });
    const cancel = await p.command('UI-CMD-DEVICE-REQUEST-CANCEL', {
      requestId: batch.requestId,
      technicalSessionId: batch.technicalSessionId,
      requestRevision: 0,
      reason: 'Withdraw original submission',
    });
    expect(
      p.sent.some((m) => m.messageType === 'command.refusal' && m.commandId === cancel.commandId),
    ).toBe(true);
    const delivery = readLocalNetworkDeliverySnapshot(p.db, p.scope(), cancel.commandId);
    expect(delivery.outbox?.acknowledgementOrNull).toBeNull();
    expect(delivery.cancelSettlementOrNull?.proof.decisions).toHaveLength(1);
    expect(delivery.current.pendingCommandIdOrNull).toBeNull();
    expect(delivery.current.requestReviewOrNull?.requestStatus).toBe('IN_REVIEW');
    const event = readLocalNetworkCancelSettlementEvent(p.db, p.scope(), cancel.commandId)!;
    expect(event).not.toBeNull();
    const count = h.db
      .prepare("SELECT COUNT(*) AS n FROM hosted_network_command WHERE operation='CANCEL'")
      .get();
    expect(count).toEqual({ n: 0 });
    await p.restart([cancel.commandId]);
    expect(
      p.sent.some((m) => m.messageType === 'command.refusal' && m.commandId === cancel.commandId),
    ).toBe(true);
    const after = readLocalNetworkCancelSettlementEvent(p.db, p.scope(), cancel.commandId)!;
    expect(after.input).toEqual(event.input);
    expect(after.receipt).toEqual(event.receipt);
    await p.send(cancel);
    expect(p.sent[0]?.messageType).toBe('command.refusal');
    expect(readLocalNetworkOutbox(p.db, p.scope(), cancel.commandId)).toEqual(delivery.outbox);
    expect(
      h.db
        .prepare("SELECT COUNT(*) AS n FROM hosted_network_command WHERE operation='CANCEL'")
        .get(),
    ).toEqual(count);
  }, 30000);
  it('recovers a lost first BIND ACK using the original input and command after restart', async () => {
    const h = await host({ legacySchema: true }),
      { p, submit, batch, originalHostedSubmit } = await submittedPlayer(h, true, true);
    expect(batch.schemaVersion).toBeUndefined();
    const bound = readLocalRequestLaneBinding(p.db, p.scope(), batch.requestId)!;
    expect(bound.receiptOrNull).toBeNull();
    expect(bound.request.localControllerSeatId).toBe(p.state().tabId);
    expect(bound.origin.submitCommandId).toBe(submit.commandId);
    expect(bound.request.batchSha256).toBe(batch.batchSha256);
    const original = readLocalNetworkOutbox(p.db, p.scope(), submit.commandId);
    p.db.exec('DROP TRIGGER fail_binding_ack');
    await p.restart([submit.commandId]);
    const recovered = readLocalRequestLaneBinding(p.db, p.scope(), batch.requestId)!;
    expect(recovered.request).toEqual(bound.request);
    expect(recovered.origin).toEqual(bound.origin);
    expect(recovered.receiptOrNull?.binding.localControllerSeatId).toBe(bound.origin.tabId);
    expect(readLocalNetworkOutbox(p.db, p.scope(), submit.commandId)).toEqual(original);
    expect(
      h.db.prepare('SELECT COUNT(*) AS n FROM hosted_device_request_lane_binding').get(),
    ).toEqual({ n: 1 });
    expect(p.state().requestReviewOrNull?.proof.laneProvenance?.kind).toBe('BIND_LANE');
    expect(
      h.db.prepare('SELECT * FROM hosted_network_command WHERE command_id=?').get(submit.commandId),
    ).toEqual(originalHostedSubmit);
  }, 30000);

  it('binds an entry before the first NAV fault and refuses a changed envelope after reopen without binding the connection', async () => {
    const p = await client();
    p.db.exec(
      "CREATE TRIGGER abort_entry_nav BEFORE INSERT ON local_network_application_event WHEN json_extract(NEW.record_json,'$.input.mutation.kind')='NAVIGATE' BEGIN SELECT RAISE(ABORT,'entry fault'); END",
    );
    const original = await p.nav('APP-002::CTA::003', 'APP-002');
    expect(p.sent.some((m) => m.messageType === 'navigation.form-action.refusal')).toBe(true);
    expect(p.db.prepare('SELECT COUNT(*) AS n FROM local_network_tab_entry').get()).toEqual({
      n: 1,
    });
    expect(p.db.prepare('SELECT COUNT(*) AS n FROM local_network_application_event').get()).toEqual(
      { n: 0 },
    );
    const originalScope = p.c.networkScopeId;
    p.db.exec('DROP TRIGGER abort_entry_nav');
    p.reopenShell('CHR-040');
    const before = p.db.serialize();
    await p.send({ ...original, sourceFormId: 'CHR-040', actionKey: 'CHR-040::CTA::002' });
    expect(p.sent.some((m) => m.messageType === 'navigation.form-action.refusal')).toBe(true);
    expect(p.c.networkScopeId).toBeNull();
    expect(p.c.contextId).toBeNull();
    expect(p.db.serialize().equals(before)).toBe(true);
    await p.send(original);
    expect(p.state().formId).toBe('NET-001');
    expect(p.c.networkScopeId).toBe(originalScope);
    expect(p.db.prepare('SELECT COUNT(*) AS n FROM local_network_tab_entry').get()).toEqual({
      n: 1,
    });
  });
  it('restores the original owned FINAL after entry/NAV crash even when a different actual FINAL is now open', async () => {
    const p = await client();
    const second = await createCreationFinalizationSetup({
      prefix: 'second-entry-final',
      characterDraftId: randomUUID(),
      databasePath: p.path,
      raceChoice: 'FREE',
      diceInputMode: 'AUTO',
    });
    try {
      const summary = commitCreationFinalization(
        second.setup.database,
        creationPropertySummaryRequest(second.current, randomUUID()),
        randomUUID(),
        second.dependencies,
      );
      commitCreationFinalization(
        second.setup.database,
        creationFinalSaveRequest(summary, randomUUID()),
        randomUUID(),
        second.dependencies,
      );
    } finally {
      second.setup.database.close();
    }
    p.final();
    p.db.exec(
      "CREATE TRIGGER abort_entry_nav BEFORE INSERT ON local_network_application_event WHEN json_extract(NEW.record_json,'$.input.mutation.kind')='NAVIGATE' BEGIN SELECT RAISE(ABORT,'entry fault'); END",
    );
    const original = await p.nav('CHR-040::CTA::002', 'CHR-040');
    expect(p.db.prepare('SELECT COUNT(*) AS n FROM local_network_application_event').get()).toEqual(
      { n: 0 },
    );
    expect(p.db.prepare('SELECT COUNT(*) AS n FROM local_network_tab_entry').get()).toEqual({
      n: 1,
    });
    const scope = p.c.networkScopeId;
    p.db.exec('DROP TRIGGER abort_entry_nav');
    p.reopenShell('CHR-040', second.setup.characterDraftId);
    await p.send(original);
    expect(p.state().formId).toBe('CHR-027');
    expect(p.state().selectedCandidates.map((r) => r.sourceUuid)).toEqual([
      player.setup.characterDraftId,
    ]);
    expect(p.c.networkScopeId).toBe(scope);
    const saved = p.db.serialize();
    await p.send(original);
    expect(p.db.serialize().equals(saved)).toBe(true);
    expect(p.state().selectedCandidates.map((r) => r.sourceUuid)).toEqual([
      player.setup.characterDraftId,
    ]);
  }, 15000);
  it('rejects forged entry CTAs before allocation when the negotiated source capabilities are absent', async () => {
    const p = await client();
    for (const missing of [
      'UI-CMD-CONNECTION-OPEN',
      'UI-CMD-DEVICE-REQUEST-SUBMIT',
      'UI-CMD-DEVICE-REQUEST-CANCEL',
    ]) {
      p.newPlayerTab();
      p.c.executableWorkflowCommandIds = NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS.filter(
        (id) => id !== missing,
      );
      const before = p.db.serialize();
      await p.nav('APP-002::CTA::003', 'APP-002');
      expect(p.sent[0]?.messageType).toBe('navigation.form-action.refusal');
      expect(p.c.networkScopeId).toBeNull();
      expect(p.db.serialize().equals(before)).toBe(true);
    }
    p.final();
    p.c.executableWorkflowCommandIds = NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS.filter(
      (id) => id !== 'UI-CMD-CONNECTION-OPEN',
    );
    const before = p.db.serialize();
    await p.nav('CHR-040::CTA::002', 'CHR-040');
    expect(p.sent[0]?.messageType).toBe('navigation.form-action.refusal');
    expect(p.c.networkScopeId).toBeNull();
    expect(p.db.serialize().equals(before)).toBe(true);
  });
  it('resumes an exact logical tab and releases it only through an explicit exit', async () => {
    const p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    expect(p.state().formId).toBe('NET-001');
    const first = p.c.networkScopeId;
    await p.restart();
    expect(p.c.networkScopeId).toBe(first);
    // The same physical shell can return only through a published source action.
    await p.nav('NET-001::CTA::003');
    expect(p.c.networkScopeId).toBeNull();
    await p.nav('APP-002::CTA::003', 'APP-002');
    expect(p.c.networkScopeId).not.toBe(first);
  });
  it('creates three distinct counted inputs through actual runtime entry and refuses the fourth', async () => {
    const p = await client();
    const scopes: string[] = [];
    for (let i = 0; i < 3; i++) {
      p.newPlayerTab();
      const entry = await p.nav('APP-002::CTA::003', 'APP-002');
      scopes.push(p.c.networkScopeId!);
      const before = p.db.serialize();
      await p.send(entry);
      expect(p.c.networkScopeId).toBe(scopes[i]);
      expect(p.db.serialize().equals(before)).toBe(true);
    }
    expect(new Set(scopes).size).toBe(3);
    p.newPlayerTab();
    const before = p.db.serialize();
    await p.nav('APP-002::CTA::003', 'APP-002');
    expect(p.sent[0]?.messageType).toBe('navigation.form-action.refusal');
    expect(p.db.serialize().equals(before)).toBe(true);
    expect(p.c.networkScopeId).toBeNull();
  });
  it('recovers a committed exit after lost delivery and SQLite reopen without recreating a tab', async () => {
    const p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    const retiredScope = p.c.networkScopeId!;
    p.loseNextExit();
    const closedNavigation = await p.nav('NET-001::CTA::003');
    const before = p.db.serialize();
    await p.restart([], retiredScope);
    expect(p.sent).toHaveLength(2);
    expect(p.sent[0]).toMatchObject({
      messageType: 'session.reconnect.capabilities',
      executableWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
    });
    expect(p.sent[1]).toMatchObject({
      messageType: 'projection.snapshot',
      presentation: { assignment: { reason: 'RECONNECT' }, base: { formId: 'APP-002' } },
    });
    expect(p.c.networkScopeId).toBeNull();
    expect(p.db.serialize().equals(before)).toBe(true);
    await p.send(closedNavigation);
    expect(p.sent[0]).toMatchObject({
      messageType: 'projection.snapshot',
      presentation: { assignment: { reason: 'FORM_ACTION' }, base: { formId: 'APP-002' } },
    });
    p.laterLocalNavigation();
    const later = p.db.serialize();
    await p.send(closedNavigation);
    expect(p.sent[0]?.messageType).toBe('navigation.form-action.refusal');
    expect(p.shell.formId).toBe('APP-004');
    expect(p.db.serialize().equals(later)).toBe(true);
  });
  it('records definite pre-OPEN failures and plans distinct retries without reusing an old command identity', async () => {
    const unavailableHost = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => unavailableHost.listen(0, '127.0.0.1', resolve));
    cleaners.push(() => new Promise<void>((resolve) => unavailableHost.close(() => resolve())));
    const bound = unavailableHost.address();
    if (bound === null || typeof bound === 'string') throw new Error('Actual listener required');
    const p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    await p.nav('NET-001::CTA::001');
    await p.replace('ADDRESS', {
      addressOrQrPayload: campaignQrPayload('127.0.0.1', bound.port, randomUUID()),
    });
    const firstAttempt = p.state().plannedAttemptIdOrNull;
    const first = await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: firstAttempt,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-011');
    expect(p.state().lastAttemptIdOrNull).toBe(firstAttempt);
    const retry = p.state().plannedAttemptIdOrNull;
    expect(retry).not.toBe(firstAttempt);
    const before = p.db.serialize();
    await p.send(first);
    expect(p.db.serialize().equals(before)).toBe(true);
    await p.send({ ...first, payload: { ...first.payload, attemptId: retry } });
    expect(p.sent[0]).toMatchObject({
      messageType: 'command.refusal',
      refusal: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(p.db.serialize().equals(before)).toBe(true);
    await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: retry,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    expect(p.state().lastAttemptIdOrNull).toBe(retry);
    expect(p.state().plannedAttemptIdOrNull).not.toBe(retry);
    expect(p.payload()['retryCount']).toBe(1);
    expect(p.state().pendingCommandIdOrNull).toBeNull();
    await p.restart([first.commandId]);
    expect(p.state().lastAttemptIdOrNull).toBe(retry);
  });
  it('retains a confirmed UNBOUND session across a lost return to FINAL and clears only its exit marker on new entry', async () => {
    const h = await host(),
      p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    await p.nav('NET-001::CTA::001');
    await p.replace('ADDRESS', {
      addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
    });
    await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: p.state().plannedAttemptIdOrNull,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    const candidate = (p.payload()['eligibleFinalCandidates'] as readonly JsonObject[])[0]!;
    const { name: _name, sourceSnapshotId: _snapshot, ...ref } = candidate;
    await p.replace('SELECTION', { selectedCandidates: [ref] });
    await p.nav('NET-003::CTA::002');
    const before = p.state(),
      scope = p.scope();
    p.loseNextExit();
    const leaving = await p.nav('CHR-027::CTA::002');
    const saved = readLocalNetworkApplication(p.db, scope);
    expect(saved.sessionOrNull).toEqual(before.sessionOrNull);
    expect(saved.stateRevision).toBe(before.stateRevision);
    expect(saved.projectionRevision).toBe(before.projectionRevision + 1);
    expect(saved.shellExitOrNull).toEqual({
      navigationRequestId: leaving.navigationRequestId,
      sourceUuid: player.setup.characterDraftId,
    });
    const bytes = p.db.serialize();
    await p.restart([], scope.networkScopeId);
    expect(p.sent[1]).toMatchObject({
      messageType: 'projection.snapshot',
      presentation: { assignment: { reason: 'RECONNECT' }, base: { formId: 'CHR-040' } },
    });
    expect(p.db.serialize().equals(bytes)).toBe(true);
    await p.send(leaving);
    expect(p.sent[0]).toMatchObject({
      messageType: 'projection.snapshot',
      presentation: { assignment: { reason: 'FORM_ACTION' }, base: { formId: 'CHR-040' } },
    });
    p.laterLocalNavigation();
    const later = p.db.serialize();
    await p.send(leaving);
    expect(p.sent[0]?.messageType).toBe('navigation.form-action.refusal');
    expect(p.shell.formId).toBe('APP-004');
    expect(p.db.serialize().equals(later)).toBe(true);
    p.final();
    await p.nav('CHR-040::CTA::002', 'CHR-040');
    expect(p.c.networkScopeId).toBe(scope.networkScopeId);
    expect(p.state().shellExitOrNull).toBeNull();
    expect(p.state().sessionOrNull).toEqual(before.sessionOrNull);
    const newEntry = p.db.serialize();
    await p.send(leaving);
    expect(p.db.serialize().equals(newEntry)).toBe(true);
    expect(p.c.networkScopeId).toBe(scope.networkScopeId);
  }, 15000);
  it('opens, pins real FINAL bytes, submits and cancels with exact replay after a complete local restart', async () => {
    const h = await host(),
      p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    await p.nav('NET-001::CTA::001');
    await p.replace('ADDRESS', {
      addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
    });
    const opening = await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: p.state().plannedAttemptIdOrNull,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    expect(
      p.state().formId,
      JSON.stringify({ sent: p.sent, responses: p.responses, remoteErrors: h.errors }),
    ).toBe('NET-003');
    const candidates = p.payload()['eligibleFinalCandidates'] as readonly JsonObject[];
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    const { name: _name, sourceSnapshotId: _snapshot, ...ref } = candidate;
    await p.replace('SELECTION', { selectedCandidates: [ref] });
    await p.nav('NET-003::CTA::001');
    expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-004');
    const batch = p.state().preparedBatchOrNull!;
    const submit = await p.command('UI-CMD-DEVICE-REQUEST-SUBMIT', {
      requestId: batch.requestId,
      technicalSessionId: batch.technicalSessionId,
      connectionRevision: batch.connectionRevision,
      selectedCandidates: p.state().selectedCandidates,
    });
    expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-005');
    const original = p.sent.find((m) => m.messageType === 'command.result');
    expect(original).toBeDefined();
    const serialized = JSON.stringify(p.sent);
    for (const value of [
      'canonicalWitnessText',
      'privateKeyPkcs8Base64',
      'learnedNodeRefs',
      'privateVerifier',
    ])
      expect(serialized).not.toContain(value);
    await p.restart([submit.commandId]);
    expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-005');
    expect(p.sent.find((m) => m.messageType === 'command.replay')).toMatchObject({
      receipt: (original as Extract<LocalNetworkHostMessage, { messageType: 'command.result' }>)
        .receipt,
    });
    expect(isNetworkApplicationProjection('NET-005', p.payload())).toBe(true);
    const before = p.db.serialize();
    await p.send({ ...submit, payload: { ...submit.payload, contextId: randomUUID() } });
    expect(p.sent[0]).toMatchObject({
      messageType: 'command.refusal',
      refusal: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(p.db.serialize().equals(before)).toBe(true);
    const oversizedReason = 'r'.repeat(70 * 1024);
    await p.replace('CANCEL_REASON', { cancelReason: oversizedReason });
    const oversizedBefore = p.db.serialize(),
      pendingRequest = p.state().requestOrNull!;
    const oversizedCancel = await p.command('UI-CMD-DEVICE-REQUEST-CANCEL', {
      requestId: pendingRequest.requestId,
      technicalSessionId: pendingRequest.technicalSessionId,
      requestRevision: pendingRequest.requestRevision,
      reason: oversizedReason,
    });
    expect(p.sent[0]).toMatchObject({
      messageType: 'command.refusal',
      commandId: oversizedCancel.commandId,
    });
    expect(readLocalNetworkOutbox(p.db, p.scope(), oversizedCancel.commandId)).toBeNull();
    expect(p.state().pendingCommandIdOrNull).toBeNull();
    expect(p.state().cancelReason).toBe(oversizedReason);
    expect(p.db.serialize().equals(oversizedBefore)).toBe(true);
    await p.replace('CANCEL_REASON', { cancelReason: 'Changed selection' });
    const request = p.state().requestOrNull!;
    const cancel = await p.command('UI-CMD-DEVICE-REQUEST-CANCEL', {
      requestId: request.requestId,
      technicalSessionId: request.technicalSessionId,
      requestRevision: request.requestRevision,
      reason: 'Changed selection',
    });
    expect(
      p.state().formId,
      JSON.stringify({
        sent: p.sent,
        responses: p.responses,
        peerErrors: p.peerErrors,
        remoteErrors: h.errors,
        remoteCommands: h.db.prepare('SELECT operation FROM hosted_network_command').all(),
      }),
    ).toBe('NET-003');
    await p.restart([opening.commandId, submit.commandId, cancel.commandId]);
    expect(p.state().formId).toBe('NET-003');
    expect(p.sent.filter((m) => m.messageType === 'command.replay')).toHaveLength(3);
    expect(
      readLocalNetworkOutbox(p.db, p.scope(), cancel.commandId)?.acknowledgementOrNull?.operation,
    ).toBe('CANCEL');
  }, 30000);
  it.each([false, true])(
    'recovers an offline confirmed OPEN without a new attempt, with prepared batch %s',
    async (prepareBatch) => {
      const dir = mkdtempSync(join(tmpdir(), 'network-confirmed-offline-'));
      dirs.push(dir);
      const path = join(dir, 'host.sqlite');
      let h = await host({ path });
      const p = await client();
      const hostOptions = { path, port: h.port, campaignId: h.campaignId };
      await p.nav('APP-002::CTA::003', 'APP-002');
      await p.nav('NET-001::CTA::001');
      await p.replace('ADDRESS', {
        addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
      });
      const opening = await p.command('UI-CMD-CONNECTION-OPEN', {
        attemptId: p.state().plannedAttemptIdOrNull,
        addressOrQrPayload: p.state().addressOrQrPayload,
        selectedCampaignIdOrNull: null,
      });
      expect(p.state().formId).toBe('NET-003');
      const original = p.sent.find((m) => m.messageType === 'command.result');
      expect(original).toBeDefined();
      if (prepareBatch) {
        const candidate = (p.payload()['eligibleFinalCandidates'] as readonly JsonObject[])[0]!;
        const { name: _name, sourceSnapshotId: _snapshot, ...ref } = candidate;
        await p.replace('SELECTION', { selectedCandidates: [ref] });
        await p.nav('NET-003::CTA::001');
      }
      const confirmed = p.state();
      const actions = () => {
        const view = p.sent.findLast(
          (m) => m.messageType === 'projection.snapshot' && m.protocolVersion === 2,
        );
        if (view?.messageType !== 'projection.snapshot' || view.protocolVersion !== 2)
          throw new Error('Missing network view');
        return view.presentation.base.availableActionKeys;
      };
      await h.close();
      await p.restart([opening.commandId]);
      expect(p.state()).toMatchObject({
        formId: 'NET-011',
        sessionOrNull: confirmed.sessionOrNull,
        plannedAttemptIdOrNull: confirmed.plannedAttemptIdOrNull,
        pendingCommandIdOrNull: null,
      });
      expect(p.payload()['retryAttemptIdOrNull']).toBeNull();
      expect(actions()).toEqual(['NET-011::CTA::004', 'NET-011::CTA::005']);
      expect(p.sent.find((m) => m.messageType === 'command.replay')).toMatchObject({
        receipt: (original as Extract<LocalNetworkHostMessage, { messageType: 'command.result' }>)
          .receipt,
      });
      if (!prepareBatch) {
        await p.nav('NET-011::CTA::004');
        expect(p.state().formId).toBe('NET-002');
        expect(p.state().plannedAttemptIdOrNull).toBe(confirmed.plannedAttemptIdOrNull);
        expect(actions()).toEqual(['NET-002::CTA::001']);
        h = await host(hostOptions);
        await p.restart();
        expect(actions()).toEqual(['NET-002::CTA::001', 'NET-002::CTA::002']);
        await p.nav('NET-002::CTA::002');
        expect(p.state().formId).toBe('NET-003');
        await h.close();
        await p.restart();
      }
      const beforeRecovery = p.state();
      h = await host(hostOptions);
      await p.restart([opening.commandId]);
      expect(p.state()).toMatchObject({
        formId: prepareBatch ? 'NET-004' : 'NET-003',
        stateRevision: beforeRecovery.stateRevision,
        projectionRevision: beforeRecovery.projectionRevision + 1,
        sessionOrNull: confirmed.sessionOrNull,
        preparedBatchOrNull: confirmed.preparedBatchOrNull,
        plannedAttemptIdOrNull: confirmed.plannedAttemptIdOrNull,
      });
      expect(h.db.prepare('SELECT operation FROM hosted_network_command').all()).toEqual([
        { operation: 'OPEN' },
      ]);
      expect(p.db.prepare('SELECT COUNT(*) AS count FROM local_network_outbox').get()).toEqual({
        count: 1,
      });
      const recovered = p.state();
      await p.restart();
      expect(p.state()).toEqual(recovered);
      await h.close();
      await p.restart();
      await p.nav('NET-011::CTA::005');
      expect(p.c.networkScopeId).toBeNull();
      expect(p.sent.findLast((m) => m.messageType === 'projection.snapshot')).toMatchObject({
        presentation: { base: { formId: 'APP-002' } },
      });
    },
    30000,
  );
  it('keeps an unresolved SUBMIT after local ACK failure and recovers the same remote request after reopen', async () => {
    const h = await host(),
      p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    await p.nav('NET-001::CTA::001');
    await p.replace('ADDRESS', {
      addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
    });
    await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: p.state().plannedAttemptIdOrNull,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    // A fresh physical connection must restore an acknowledged OPEN before the first SUBMIT.
    await p.restart();
    expect(p.state().formId).toBe('NET-003');
    const candidate = (p.payload()['eligibleFinalCandidates'] as readonly JsonObject[])[0]!;
    const { name: _name, sourceSnapshotId: _snapshot, ...ref } = candidate;
    await p.replace('SELECTION', { selectedCandidates: [ref] });
    await p.nav('NET-003::CTA::001');
    const batch = p.state().preparedBatchOrNull!;
    p.db.exec(
      "CREATE TRIGGER fail_local_ack BEFORE INSERT ON local_network_application_event WHEN json_extract(NEW.record_json,'$.input.mutation.kind')='ACKNOWLEDGE' BEGIN SELECT RAISE(ABORT,'local ACK interrupted'); END",
    );
    const submit = await p.command('UI-CMD-DEVICE-REQUEST-SUBMIT', {
      requestId: batch.requestId,
      technicalSessionId: batch.technicalSessionId,
      connectionRevision: batch.connectionRevision,
      selectedCandidates: p.state().selectedCandidates,
    });
    expect(
      p.sent.some((m) => m.messageType === 'command.result' || m.messageType === 'command.refusal'),
    ).toBe(false);
    const pending = readLocalNetworkOutbox(p.db, p.scope(), submit.commandId)!;
    expect(pending.acknowledgementOrNull).toBeNull();
    expect(p.state().pendingCommandIdOrNull).toBe(submit.commandId);
    expect(
      h.db
        .prepare("SELECT COUNT(*) AS count FROM hosted_network_command WHERE operation='SUBMIT'")
        .get(),
    ).toEqual({ count: 1 });
    p.db.exec('DROP TRIGGER fail_local_ack');
    await p.restart([submit.commandId]);
    expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-005');
    const recovered = readLocalNetworkOutbox(p.db, p.scope(), submit.commandId)!;
    expect(recovered.intent).toEqual(pending.intent);
    expect(recovered.acknowledgementOrNull?.operation).toBe('SUBMIT');
    expect(p.sent.some((m) => m.messageType === 'command.replay')).toBe(true);
    expect(
      h.db
        .prepare("SELECT COUNT(*) AS count FROM hosted_network_command WHERE operation='SUBMIT'")
        .get(),
    ).toEqual({ count: 1 });
  }, 30000);
});
async function host(
  options: {
    path?: string;
    port?: number;
    campaignId?: string;
    capacity?: number;
    limits?: Partial<DeviceAdmissionPeerRuntimeLimits>;
    legacySchema?: boolean;
  } = {},
) {
  const db = options.legacySchema
    ? new Database(options.path ?? ':memory:')
    : openPersistenceDatabase(options.path ?? ':memory:');
  if (options.legacySchema) {
    configurePersistenceDatabase(db);
    applyMigrationSequence(db, [
      migration0001,
      migration0002,
      migration0003,
      migration0004,
      migration0005,
      migration0006,
      migration0007,
      migration0008,
      migration0009,
      migration0010,
    ]);
  }
  bootstrapDeviceIdentity(db);
  initializeNetworkInstallation(db);
  const http = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => http.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = http.address();
  if (address === null || typeof address === 'string') throw new Error('Actual endpoint required');
  const bind = createCampaignBindManager({
    readShellListener: () => (http.listening ? { address: '127.0.0.1', port: address.port } : null),
  });
  const loopback = bind.interfaces().find((i) => i.hostAddress === '127.0.0.1');
  if (loopback === undefined) throw new Error('Actual loopback missing');
  const owner = loadDeviceId(db),
    validate = (
      p: Parameters<typeof readHostedCurrentPausedCampaign>[2] extends (p: infer P) => void
        ? P
        : never,
    ) => {
      validateMasterSecretVerifier(p.verifier);
    };
  const ids = readHostedPausedCampaignIds(db, validate);
  let campaignId: string;
  if (options.campaignId !== undefined) {
    if (!ids.includes(options.campaignId)) throw new Error('Expected persisted campaign');
    campaignId = options.campaignId;
  } else {
    campaignId = randomUUID();
    const context = randomUUID(),
      draftId = randomUUID();
    const owned = () => {
      if (loadDeviceId(db) !== owner || !http.listening)
        throw new Error('Real source ownership unavailable');
    };
    ensureLocalGmProfile(db, { ownerDeviceId: owner, masterProfileId: randomUUID() }, owned);
    // read the real profile id through its public owner reader rather than inventing another owner.
    const { readLocalGmProfile } = await import('../persistence/campaign-creation.js');
    createLocalGmContext(
      db,
      {
        ownerDeviceId: owner,
        masterProfileId: readLocalGmProfile(db, owner)!.masterProfileId,
        gmLocalContextId: context,
      },
      owned,
    );
    createCampaignDraft(
      db,
      { gmLocalContextId: context, campaignDraftId: draftId, expectedRevisions: zero },
      owned,
    );
    for (const stage of [
      {
        form: 'CMP-001',
        variant: 'METADATA',
        values: { title: 'Actual peer campaign', description: null, art: null },
      },
      {
        form: 'CMP-002',
        variant: 'HOST',
        values: {
          hostAddress: '127.0.0.1',
          hostPort: address.port,
          networkInterface: loopback.networkInterface,
          activePlayerCapacity: options.capacity ?? 3,
        },
      },
      { form: 'CMP-003', variant: 'SECRET', values: { secretProvided: true } },
      { form: 'CMP-004', variant: 'MODE', values: { defaultFutureRollMode: 'AUTO' } },
    ] as const) {
      let draft = readCampaignDraft(db, context, draftId);
      if (draft.formId !== stage.form) {
        navigateCampaignDraft(
          db,
          {
            gmLocalContextId: context,
            campaignDraftId: draftId,
            expectedDraftRevision: draft.draftRevision,
            expectedRevisions: vector(draft),
            sourceFormId: draft.formId,
            targetFormId: stage.form,
          },
          owned,
        );
        draft = readCampaignDraft(db, context, draftId);
      }
      commitCampaignDraftUpdate(
        db,
        {
          request: {
            messageType: 'campaign.draft.replace',
            protocolVersion: 3,
            draftUpdateId: randomUUID(),
            scope: {
              gmLocalContextId: context,
              campaignDraftId: draftId,
              sourceFormId: stage.form,
            },
            expectedDraftRevision: draft.draftRevision,
            expectedRevisions: vector(draft),
            variant: stage.variant,
            values: stage.values,
          } as RedactedCampaignDraftRequest,
          ...(stage.variant === 'SECRET'
            ? { secretUpdate: { kind: 'REPLACE' as const, preparedVerifier: { ...secret } } }
            : {}),
        },
        owned,
      );
    }
    let draft = readCampaignDraft(db, context, draftId);
    navigateCampaignDraft(
      db,
      {
        gmLocalContextId: context,
        campaignDraftId: draftId,
        expectedDraftRevision: draft.draftRevision,
        expectedRevisions: vector(draft),
        sourceFormId: draft.formId,
        targetFormId: 'CMP-005',
      },
      owned,
    );
    draft = readCampaignDraft(db, context, draftId);
    const preflight = await bind.prepare(draftId, draft.values.host);
    if (preflight.status !== 'PASS') throw new Error('Actual bind failed');
    commitCampaignCreation(
      db,
      {
        campaignId,
        receiptId: randomUUID(),
        createdAt: '2026-10-30T10:00:00.000Z',
        qrPayload: campaignQrPayload('127.0.0.1', address.port, campaignId),
        baselineVersion: baseline.baselineVersion,
        request: {
          protocolVersion: 1,
          messageType: 'command.request',
          commandKind: 'workflow-command',
          workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
          role: 'gm',
          commandId: randomUUID(),
          expectedRevisions: vector(draft),
          payload: {
            stage: 'CAMPAIGN_CREATE',
            sourceFormId: 'CMP-005',
            gmLocalContextId: context,
            campaignDraftId: draftId,
            draftRevision: draft.draftRevision,
            preflightLeaseId: preflight.leaseIdOrNull!,
          },
        },
      },
      (fresh, ctx) => {
        owned();
        if (
          ctx.ownerDeviceId !== owner ||
          fresh.currentVerifier === null ||
          !bind.validate(preflight.leaseIdOrNull!, draftId, fresh.values.host)
        )
          throw new Error('Real CREATE source changed');
        validateMasterSecretVerifier(fresh.currentVerifier);
      },
    );
    bind.retainForCampaign(draftId, campaignId);
  }
  const header = () => readHostedCurrentPausedCampaign(db, campaignId, validate);
  if (options.campaignId !== undefined) {
    const h = header();
    if (
      (
        await bind.recover(campaignId, {
          ...h.bindConfiguration,
          activePlayerCapacity: h.activePlayerCapacity,
        })
      ).status !== 'RESERVED'
    )
      throw new Error('Real recovery bind failed');
  }
  const publicHeader = () => {
    const h = header();
    return validatePeerCampaignHeader({
      campaignId: h.campaignId,
      title: h.title,
      status: h.status,
      activePlayerCapacity: h.activePlayerCapacity,
      activePcCount: h.activePcCount,
      checkpointSha256: h.checkpointSha256,
      baselineVersion: h.baselineVersion,
      revisions: vector(h),
    });
  };
  const ex = createCampaignNetworkExecutor(config.executor),
    runtime = createDeviceAdmissionPeerRuntime({
      database: db,
      baseline,
      executor: ex,
      limits: { ...limits, ...options.limits },
    });
  const errors: string[] = [];
  const endpoint = createCampaignNetworkEndpoint({
    maxConnections: config.transfer.maxChannels,
    shellServer: http,
    bind,
    readPublicCampaignHeaders: (published) =>
      published.map((id) => {
        if (id !== campaignId) throw new Error('Unpublished');
        return publicHeader();
      }),
    onError: (e) => {
      errors.push(e.code);
    },
    accept: async (socket, request, published) => {
      const channel = await acceptCampaignPeerChannel(socket, request, {
        limits: channelLimits,
        resolveCampaign: (id) =>
          id === campaignId && published.includes(id)
            ? { hostMaterial: loadNetworkInstallation(db), campaign: publicHeader() }
            : null,
      });
      await runtime.run(channel);
    },
  });
  endpoint.publishCampaign(campaignId);
  let closed = false;
  const clients: Awaited<ReturnType<typeof connectCampaignPeerChannel>>[] = [];
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const client of clients) client.close();
    await runtime.close();
    await endpoint.close();
    ex.close();
    await bind.close();
    http.closeAllConnections();
    if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    if (db.open) db.close();
  };
  cleaners.push(close);
  const connect = async (material = playerMaterial) => {
    const client = await connectCampaignPeerChannel({
      target: parseCampaignLanAddress(`http://127.0.0.1:${String(address.port)}`),
      campaignId,
      deviceMaterial: material,
      hostTrust: {
        kind: 'PINNED',
        identity: campaignPeerPublicIdentity(loadNetworkInstallation(db)),
      },
      limits: channelLimits,
    });
    clients.push(client);
    return client;
  };
  const principal: HostedNetworkPrincipal = {
    hostOwnerDeviceId: owner,
    campaignId,
    peerIdentity: campaignPeerPublicIdentity(playerMaterial),
  };
  return {
    db,
    campaignId,
    gmLocalContextId: readHostedCampaignCreationOrigin(db, campaignId, validate).command.request
      .payload.gmLocalContextId,
    bind,
    port: address.port,
    header,
    principal,
    validate,
    runtime,
    connect,
    close,
    errors,
  };
}
import { createGmNetworkRuntime } from './network-application.js';
import { createCampaignCreationRuntime, type CampaignConnection } from './campaign-creation.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import { NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS } from '../shared/device-admission.js';
import { readGmDeviceRequestQueue } from '../persistence/network-device-request.js';

async function gmClient(h: Awaited<ReturnType<typeof host>>) {
  const c: CampaignConnection = {
    gmLocalContextId: h.gmLocalContextId,
    executableCreate: true,
    executableReview: NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS,
    trusted: () => h.db.open,
  };
  let gmFrames = Promise.resolve();
  const schedule = <T>(run: () => Promise<T>): Promise<T> => {
    const next = gmFrames.then(run);
    gmFrames = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const campaign = createCampaignCreationRuntime({
    schedule,
    database: h.db,
    projectRoot: process.cwd(),
    baseline,
    bind: h.bind,
    requestReview: {
      project: (connection) => runtime.project(connection),
      refreshConnectionPresentation: (connection) =>
        runtime.refreshConnectionPresentation(connection),
      receipt: (connection, id) => runtime.receipt(connection, id),
    },
  });
  const runtime = createGmNetworkRuntime({
    schedule,
    config,
    database: h.db,
    baseline,
    vocabulary: await loadProtocolVocabulary(process.cwd()),
    campaignNetwork: h.runtime,
    campaignPresentation: campaign.project,
  });
  cleaners.push(() => {
    runtime.close();
    return Promise.resolve();
  });
  const sent: LocalNetworkHostMessage[] = [];
  const scope = {
    ownerDeviceId: loadDeviceId(h.db),
    gmLocalContextId: h.gmLocalContextId,
    campaignId: h.campaignId,
  };
  const view = () => readGmRequestReviewView(h.db, scope, h.validate)!;
  const send = async (m: LocalNetworkClientMessage) => {
    sent.length = 0;
    expect(await runtime.handle(m, c, (v) => sent.push(v))).toBe(true);
    return sent;
  };
  const nav = async (enter = true) => {
    const request = {
      messageType: 'navigation.form-action' as const,
      protocolVersion: 2 as const,
      navigationRequestId: randomUUID(),
      sourceFormId: enter ? ('CMP-006' as const) : ('NET-017' as const),
      actionKey: enter ? ('CMP-006::CTA::002' as const) : ('NET-017::CTA::009' as const),
      expectedProjectionRevision: view()?.projectionRevision ?? 0,
    };
    await send(request);
    return request;
  };
  const select = async (requestId: string, reason = '') => {
    const update = () =>
      send({
        messageType: 'network.gm-request-draft.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        scope: {
          gmLocalContextId: h.gmLocalContextId,
          campaignId: h.campaignId,
          sourceFormId: 'NET-017',
        },
        expectedRevisions: vector(view()),
        expectedRequestQueueRevision: view().requestQueueRevision,
        values: { selectedRequestIdOrNull: requestId, decisionReason: reason },
      });
    await update();
    if (reason !== '' && view().values.decisionReason === '') await update();
  };
  const resume = async () => {
    sent.length = 0;
    const shell = {
      formId: null,
      revisions: zero,
      ready: true,
      enter() {},
      exit() {},
      advance: () => zero,
      base: (): never => {
        throw new Error('No unrelated GM shell projection');
      },
    };
    expect(
      await campaign.handle(
        {
          messageType: 'campaign.local-context.resume',
          protocolVersion: 3,
          gmLocalContextId: h.gmLocalContextId,
          reconnectRequestId: randomUUID(),
          knownRevisions: vector(view()),
          supportedWorkflowCommandIds: NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS,
          unacknowledgedCommandIds: [],
        },
        c,
        shell,
        (value) => sent.push(value),
      ),
    ).toBe(true);
  };
  return { c, runtime, campaign, sent, scope, view, send, nav, select, resume };
}

describe('actual GM request review orchestration', () => {
  it('keeps the campaign birth immutable through queue ingress, safe return, replay and unauthorized requests', async () => {
    const h = await host(),
      gm = await gmClient(h);
    const checkpoint = h.db.prepare('SELECT * FROM campaign_checkpoint').all();
    const entering = await gm.nav();
    expect(gm.sent[0]).toMatchObject({
      messageType: 'projection.snapshot',
      projectionRole: 'gm',
      presentation: {
        base: {
          formId: 'NET-017',
          roleFilteredPayload: {
            contextId: h.gmLocalContextId,
            campaignId: h.campaignId,
            requests: [],
          },
        },
      },
    });
    expect(Object.keys((await gm.runtime.project(gm.c)).base.roleFilteredPayload)).toHaveLength(12);
    const leaving = await gm.nav(false);
    expect((await gm.campaign.project(gm.c)).base.formId).toBe('CMP-006');
    const before = h.db.serialize();
    await gm.send(entering);
    expect(gm.sent[0]).toMatchObject({ presentation: { base: { formId: 'CMP-006' } } });
    expect(h.db.serialize().equals(before)).toBe(true);
    await gm.send({ ...leaving, navigationRequestId: entering.navigationRequestId });
    expect(gm.sent[0]).toMatchObject({ messageType: 'navigation.form-action.refusal' });
    expect(h.db.serialize().equals(before)).toBe(true);
    gm.c.gmLocalContextId = randomUUID();
    await gm.send({ ...entering, navigationRequestId: randomUUID() });
    expect(gm.sent[0]).toMatchObject({ messageType: 'navigation.form-action.refusal' });
    expect(h.db.serialize().equals(before)).toBe(true);
    expect(h.db.prepare('SELECT * FROM campaign_checkpoint').all()).toEqual(checkpoint);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_character_copy').get()).toEqual({
      n: 0,
    });
  });
  it('seals a disconnected owner as a technical view revision on explicit GM reconnect without rewriting campaign or SUBMIT', async () => {
    const h = await host(),
      { p, submit, batch } = await submittedPlayer(h),
      gm = await gmClient(h);
    await gm.nav();
    const before = gm.view(),
      original = h.db
        .prepare('SELECT * FROM hosted_network_command WHERE command_id=?')
        .get(submit.commandId),
      campaign = h.db.prepare('SELECT * FROM campaign_checkpoint').all();
    gm.runtime.close();
    p.disconnect();
    await expect
      .poll(() => h.runtime.requestConnectionFacts(h.campaignId, [batch.requestId])[0]!.connected)
      .toBe(false);
    const fresh = await gmClient(h),
      bytes = h.db.serialize();
    expect(
      (await fresh.runtime.project(fresh.c)).base.roleFilteredPayload['requests'],
    ).toMatchObject([{ connectionState: 'LOST' }]);
    expect(h.db.serialize().equals(bytes)).toBe(true);
    await fresh.resume();
    expect(fresh.sent.find((m) => m.messageType === 'projection.snapshot')).toMatchObject({
      revisions: {
        stateRevision: before.stateRevision,
        projectionRevision: before.projectionRevision + 1,
        actorVisibilityRevision: before.actorVisibilityRevision,
      },
      presentation: {
        assignment: { reason: 'RECONNECT' },
        base: {
          formId: 'NET-017',
          roleFilteredPayload: { requests: [{ connectionState: 'LOST' }] },
        },
      },
    });
    expect(fresh.view().requestQueueRevision).toBe(before.requestQueueRevision);
    const settled = h.db.serialize();
    await fresh.resume();
    expect(h.db.serialize().equals(settled)).toBe(true);
    expect(
      h.db.prepare('SELECT * FROM hosted_network_command WHERE command_id=?').get(submit.commandId),
    ).toEqual(original);
    expect(h.db.prepare('SELECT * FROM campaign_checkpoint').all()).toEqual(campaign);
  }, 30000);
  it('accepts and rejects the actual submitted FINAL with separate immutable receipt/current and exact owner lane', async () => {
    const h = await host(),
      p = await client(),
      gm = await gmClient(h);
    await gm.nav();
    await p.nav('APP-002::CTA::003', 'APP-002');
    await p.nav('NET-001::CTA::001');
    await p.replace('ADDRESS', {
      addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
    });
    await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: p.state().plannedAttemptIdOrNull,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    const candidate = (p.payload()['eligibleFinalCandidates'] as readonly JsonObject[])[0]!;
    const { name: _name, sourceSnapshotId: _snapshot, ...ref } = candidate;
    await p.replace('SELECTION', { selectedCandidates: [ref] });
    await p.nav('NET-003::CTA::001');
    const batch = p.state().preparedBatchOrNull!;
    const submit = await p.command('UI-CMD-DEVICE-REQUEST-SUBMIT', {
      requestId: batch.requestId,
      technicalSessionId: batch.technicalSessionId,
      connectionRevision: batch.connectionRevision,
      selectedCandidates: p.state().selectedCandidates,
    });
    expect(p.state().formId, JSON.stringify(p.sent)).toBe('NET-005');
    const submitted = p.sent.find((m) => m.messageType === 'command.result');
    expect(
      p.sent.filter(
        (m) => m.messageType === 'command.result' && m.receipt.commandId === submit.commandId,
      ),
    ).toHaveLength(1);
    expect(
      p.sent.filter(
        (m) =>
          m.messageType === 'projection.snapshot' &&
          m.protocolVersion === 2 &&
          m.presentation.assignment.correlationId === submit.commandId,
      ),
    ).toHaveLength(1);
    expect(
      readLocalNetworkRequestDeliverySnapshot(p.db, p.scope()).requestCurrentOrNull?.proof
        .laneProvenance?.kind,
    ).toBe('SUBMITTED_BATCH');
    const projected = (await gm.runtime.project(gm.c)).base.roleFilteredPayload;
    expect(projected['requests']).toMatchObject([
      {
        requestId: batch.requestId,
        requestStatus: 'PENDING',
        batchCharacterSummaries: [
          {
            snapshotChecksum: batch.candidates[0]!.descriptor.exportBytesSha256,
            localControllerSeatId: p.state().tabId,
          },
        ],
      },
    ]);
    await gm.select(batch.requestId);
    const accept = {
      messageType: 'command.request' as const,
      protocolVersion: 1 as const,
      commandKind: 'workflow-command' as const,
      role: 'gm' as const,
      commandId: randomUUID(),
      workflowCommandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW' as const,
      expectedRevisions: vector(gm.view()),
      payload: { campaignId: h.campaignId, requestId: batch.requestId, requestRevision: 0 },
    };
    await gm.send(accept);
    const accepted = gm.sent[0];
    expect(accepted).toMatchObject({
      messageType: 'command.result',
      receipt: {
        result: {
          beforeRequestStatus: 'PENDING',
          afterRequestStatus: 'IN_REVIEW',
          requestRevision: 1,
        },
      },
    });
    await gm.select(batch.requestId, 'x'.repeat(128 * 1024));
    const beforeOversized = h.db.serialize();
    await gm.send({
      ...accept,
      commandId: randomUUID(),
      workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
      expectedRevisions: vector(gm.view()),
      payload: { ...accept.payload, requestRevision: 1, reason: 'x'.repeat(128 * 1024) },
    });
    expect(gm.sent[0]).toMatchObject({ messageType: 'command.refusal' });
    expect(h.db.serialize().equals(beforeOversized)).toBe(true);
    await gm.select(batch.requestId, 'Причина решения');
    await gm.send({
      ...accept,
      commandId: randomUUID(),
      workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
      expectedRevisions: vector(gm.view()),
      payload: { ...accept.payload, requestRevision: 1, reason: 'Причина решения' },
    });
    expect(gm.sent[0]).toMatchObject({
      messageType: 'command.result',
      receipt: {
        result: {
          beforeRequestStatus: 'IN_REVIEW',
          afterRequestStatus: 'REJECTED',
          requestRevision: 2,
          decisionReasonOrNull: 'Причина решения',
        },
      },
    });
    const durable = h.db.serialize();
    await gm.send(accept);
    expect(gm.sent[0]).toMatchObject({
      messageType: 'command.replay',
      receipt: (accepted as Extract<LocalNetworkHostMessage, { messageType: 'command.result' }>)
        .receipt,
    });
    expect(gm.sent[1]).toMatchObject({
      presentation: {
        base: {
          roleFilteredPayload: { requests: [{ requestStatus: 'REJECTED', requestRevision: 2 }] },
        },
      },
    });
    expect(h.db.serialize().equals(durable)).toBe(true);
    await p.restart([submit.commandId]);
    expect(p.sent.find((m) => m.messageType === 'command.replay')).toMatchObject({
      receipt: (submitted as Extract<LocalNetworkHostMessage, { messageType: 'command.result' }>)
        .receipt,
    });
    expect(p.payload()).toMatchObject({
      requestStatus: 'REJECTED',
      requestRevision: 2,
      gmMessage: 'Причина решения',
    });
    expect(readGmDeviceRequestQueue(h.db, gm.scope, h.validate).requests[0]!.requestStatus).toBe(
      'REJECTED',
    );
    const rejectedState = p.state(),
      retained = readLocalNetworkOutbox(p.db, p.scope(), submit.commandId),
      requests = h.db.prepare('SELECT * FROM hosted_device_request').all(),
      receipts = h.db.prepare('SELECT * FROM hosted_network_command').all();
    await p.nav('NET-005::CTA::003');
    expect(p.state().formId).toBe('NET-003');
    expect(vector(p.state())).toEqual({
      ...vector(rejectedState),
      projectionRevision: rejectedState.projectionRevision + 1,
    });
    expect(readLocalNetworkOutbox(p.db, p.scope(), submit.commandId)).toEqual(retained);
    expect(h.db.prepare('SELECT * FROM hosted_device_request').all()).toEqual(requests);
    expect(h.db.prepare('SELECT * FROM hosted_network_command').all()).toEqual(receipts);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_character_copy').get()).toEqual({
      n: 0,
    });
  }, 30000);
});
