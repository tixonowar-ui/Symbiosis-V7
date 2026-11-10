import { createTestPhaseDiagnostics } from './test-phase-diagnostics.js';
import { encodeDeviceAdmissionPeerCommand } from '../../src/host/device-admission-peer-commands.js';
import { decodeDeviceAdmissionPeerResponse } from '../../src/host/device-admission-peer-response.js';
import {
  encodeCampaignLobbyCheckCommand,
  decodeCampaignLobbyCheckResponse,
} from '../../src/host/campaign-connection-peer.js';
import * as peerChannelModule from '../../src/host/campaign-peer-channel.js';
import {
  campaignPeerStateValue,
  type CampaignPeerControlV3Message,
} from '@shared/campaign-lifecycle.js';
import * as localConnectionStore from '../../src/persistence/local-campaign-connection.js';
import {
  readLocalCampaignConnection,
  observeLocalCampaignConnection,
  prepareLocalCampaignReconnect,
  settleLocalCampaignReconnect,
  replaceLocalCampaignReconnectLocator,
} from '../../src/persistence/local-campaign-connection.js';
import {
  encodeCampaignConnectionPeerCommand,
  decodeCampaignConnectionPeerResponse,
} from '../../src/host/campaign-connection-peer.js';
import {
  encodeAdmissionCapacityCommand,
  encodeAdmissionPeerCommand,
  decodeAdmissionPeerResponse,
  type AdmissionPeerResponse,
} from '../../src/host/campaign-admission-peer-codec.js';
import { campaignLifecycleGmAnchorValue } from '@shared/campaign-lifecycle.js';
import * as campaignSecretModule from '../../src/host/campaign-secret.js';
import {
  CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
  campaignLifecycleGmProjectionValue,
  campaignLifecycleGmRequest,
} from '@shared/campaign-lifecycle.js';
import { createCampaignGmScheduler } from '../../src/host/campaign-network-executor.js';
import { readCampaignCreationCursor } from '../../src/persistence/campaign-creation.js';
import type { NetworkWorkflowRequest } from '../../src/shared/network-application.js';
import * as localAdmissionStore from '../../src/persistence/local-campaign-admission.js';
import {
  campaignLobbyPlayerProjectionValue,
  campaignPeaceProjectionValue,
} from '@shared/campaign-lobby-presentation.js';
import Database from 'better-sqlite3';
import { encodeHostMessageV3 } from '../../src/shared/wire-v3-codec.js';
import { configurePersistenceDatabase } from '../../src/persistence/database.js';
import { applyMigrationSequence, applyMigrations } from '../../src/persistence/migrations/index.js';
import { migration0001 } from '../../src/persistence/migrations/0001-initial.js';
import { migration0002 } from '../../src/persistence/migrations/0002-local-character-checkpoint.js';
import { migration0003 } from '../../src/persistence/migrations/0003-device-identity.js';
import { migration0004 } from '../../src/persistence/migrations/0004-skill-presentation.js';
import { migration0005 } from '../../src/persistence/migrations/0005-symbiont-presentation.js';
import { migration0006 } from '../../src/persistence/migrations/0006-local-character-post-save.js';
import { migration0007 } from '../../src/persistence/migrations/0007-campaign-creation.js';
import { migration0008 } from '../../src/persistence/migrations/0008-network-installation-identity.js';
import { migration0009 } from '../../src/persistence/migrations/0009-device-admission.js';
import { migration0010 } from '../../src/persistence/migrations/0010-network-application.js';
import { migration0011 } from '../../src/persistence/migrations/0011-device-request-review.js';
import { readCampaignAdmissionAvailability } from '../../src/persistence/campaign-admission-decision.js';
import { advanceRevisions, commitCampaignCheckpoint } from '../../src/persistence/store.js';
import { createCampaignAdmissionRules } from '../../src/host/campaign-admission-service.js';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextEventLoopTurn } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMISSION_GM_WORKFLOW_IDS,
  admissionOwnerProjectionValue,
} from '../../src/shared/campaign-admission-presentation.js';
import { admissionReviewInputsValue } from '../../src/shared/campaign-admission-codec.js';
import { readLocalAdmission } from '../../src/persistence/local-campaign-admission.js';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import type { ProjectionSnapshotV2Message } from '../../src/shared/wire-v2-protocol.js';
import { NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS } from '../../src/shared/device-admission.js';
import { campaignQrPayload } from '../../src/shared/campaign-creation.js';
import {
  openPersistenceDatabase,
  bootstrapDeviceIdentity,
  loadDeviceId,
} from '../../src/persistence/index.js';
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
} from '../../src/persistence/campaign-creation.js';
import { readHostedCurrentPausedCampaign } from '../../src/persistence/current-paused-campaign.js';
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
} from '../../src/persistence/network-device-request.js';
import {
  readLocalNetworkApplication,
  readLocalNetworkOutbox,
  readLocalNetworkDeliverySnapshot,
  readLocalNetworkRequestDeliverySnapshot,
  readLocalRequestLaneBinding,
  readLocalNetworkCancelSettlementEvent,
  commitLocalNetworkMutation,
} from '../../src/persistence/network-local-application.js';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
} from './creation-finalization-stage.js';
import { commitCreationFinalization } from '../../src/host/creation-finalization.js';
import { loadCreationWizardCheckpoint } from '../../src/host/creation-set-decide.js';
import {
  loadLocalCharacterExportBaseline,
  canonicalPostSaveJson,
  postSaveSha256,
  type LocalCharacterExportBaseline,
} from '../../src/host/local-character-export.js';
import { createCampaignBindManager } from '../../src/host/campaign-bind.js';
import { createCampaignNetworkEndpoint } from '../../src/host/campaign-network-endpoint.js';
import { createCampaignNetworkExecutor } from '../../src/host/campaign-network-executor.js';
import {
  initializeNetworkInstallation,
  loadNetworkInstallation,
} from '../../src/host/network-installation.js';
import { campaignPeerPublicIdentity } from '../../src/host/campaign-peer-identity.js';
import {
  acceptCampaignPeerChannel,
  connectCampaignPeerChannel,
} from '../../src/host/campaign-peer-channel.js';
import { parseCampaignLanAddress } from '../../src/host/campaign-lan-address.js';
import { validatePeerCampaignHeader } from '../../src/host/campaign-peer-handshake.js';
import {
  prepareMasterSecret,
  validateMasterSecretVerifier,
} from '../../src/host/campaign-secret.js';
import {
  createDeviceAdmissionPeerRuntime,
  type DeviceAdmissionPeerRuntimeLimits,
} from '../../src/host/device-admission-peer-runtime.js';
import { createLocalNetworkPeer } from '../../src/host/network-local-peer.js';
import type { DeviceAdmissionPeerResponse } from '../../src/host/device-admission-peer-response.js';
import {
  loadNetworkApplicationConfig,
  type NetworkApplicationConfig,
} from '../../src/host/network-application-config.js';
import {
  createLocalNetworkRuntime,
  type LocalNetworkConnection,
  type LocalNetworkShell,
  type LocalNetworkClientMessage,
  type LocalNetworkHostMessage,
} from '../../src/host/network-application.js';
import { isNetworkApplicationProjection } from '../../src/shared/network-application-codec.js';
import { validateFinalAdmissionCandidate } from '../../src/host/device-admission-candidate.js';

let phaseDiagnostics: ReturnType<typeof createTestPhaseDiagnostics>;

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
let vocabulary: Awaited<ReturnType<typeof loadProtocolVocabulary>>;
type NetworkFixtureOwner =
  | 'network-application-transport'
  | 'network-application-lifecycle'
  | 'network-application-admission-accepted'
  | 'network-application-admission-other'
  | 'network-application-peace';
export function setupNetworkFixture(owner: NetworkFixtureOwner) {
  phaseDiagnostics = createTestPhaseDiagnostics(owner);
  const modulePhase = phaseDiagnostics.begin('module.registered-to-cleanup');
  const startupPhase = phaseDiagnostics.begin('module.registered-to-beforeAll');
  beforeAll(async () => {
    const measuredPhase = phaseDiagnostics.begin('root.prepare');
    try {
      phaseDiagnostics.end(startupPhase);
      const inputsPhase = phaseDiagnostics.begin('root.source-inputs');
      vocabulary = await loadProtocolVocabulary(process.cwd());
      baseline = await loadLocalCharacterExportBaseline(process.cwd());
      config = await loadNetworkApplicationConfig(process.cwd());
      limits = config.transfer;
      channelLimits = config.channel;
      phaseDiagnostics.end(inputsPhase);
      secret = await prepareMasterSecret('Valid fixture secret', 'Valid fixture secret');
      const finalPhase = phaseDiagnostics.begin('root.real-final-prepare');
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
      phaseDiagnostics.end(finalPhase);
    } finally {
      phaseDiagnostics.end(measuredPhase);
    }
  });
  afterEach(async () => {
    const measuredPhase = phaseDiagnostics.begin('case.cleanup');
    try {
      for (const close of cleaners.splice(0).reverse()) await close();
    } finally {
      phaseDiagnostics.end(measuredPhase);
    }
  });
  afterAll(() => {
    const measuredPhase = phaseDiagnostics.begin('module.cleanup');
    try {
      if (player.setup.database.open) player.setup.database.close();
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    } finally {
      phaseDiagnostics.end(measuredPhase);
      phaseDiagnostics.end(modulePhase);
      phaseDiagnostics.finish();
    }
  });
}

function client(twoSources = false) {
  const dir = mkdtempSync(join(tmpdir(), 'network-app-'));
  dirs.push(dir);
  const path = join(dir, 'player.sqlite');
  return player.setup.database.backup(path).then(async () => {
    if (twoSources) {
      const second = await createCreationFinalizationSetup({
        prefix: 'prepared-lobby-second',
        characterDraftId: randomUUID(),
        databasePath: path,
        raceChoice: 'PURE',
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
    }
    const openPhase = phaseDiagnostics.begin('client.open-migrate');
    let db: ReturnType<typeof openPersistenceDatabase>;
    try {
      db = openPersistenceDatabase(path);
    } finally {
      phaseDiagnostics.end(openPhase);
    }
    let runtime: ReturnType<typeof createLocalNetworkRuntime>;
    let live = true,
      loseExit = false,
      loseDestination = false,
      loseOwnerProjection = false,
      loseReadyResponse = false,
      holdReadyRecoveryAfterLoss = false,
      holdReadyRecovery = false,
      blockReconnect = false,
      holdDecisionRecovery = false,
      loseLobbyObservation = false,
      loseAdmissionDelivery = false,
      loseAdmissionResponse = false,
      hideCapacity = false,
      loseCapacityResponse = false,
      lastExit: string | null = null,
      shellFinalId = player.setup.characterDraftId,
      shellForm: string | null = 'APP-002',
      shellContext: string | null = randomUUID();
    const sent: LocalNetworkHostMessage[] = [];
    const responses: DeviceAdmissionPeerResponse[] = [];
    let reconnectCount = 0;
    let dropPeer = () => {};
    let inspectionPeer!: ReturnType<typeof createLocalNetworkPeer>;
    const peerErrors: string[] = [];
    let beforeDeliver: (() => void | Promise<void>) | null = null;
    let afterReadyResponse: (() => void) | null = null;
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
      inspectionPeer = peer;
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
          async deliverLobbyReady(...args) {
            if (holdReadyRecovery) throw Error('Simulated unavailable Ready recovery');
            const result = await peer.deliverLobbyReady(...args);
            const after = afterReadyResponse;
            afterReadyResponse = null;
            after?.();
            if (loseReadyResponse) {
              loseReadyResponse = false;
              holdReadyRecovery = holdReadyRecoveryAfterLoss;
              throw Error('Simulated lost committed Ready reply');
            }
            return result;
          },
          async fetchAdmission(...args) {
            if (args[1] !== undefined && loseLobbyObservation) {
              loseLobbyObservation = false;
              throw Error('Simulated lost lobby observation after Ready ACK');
            }
            try {
              const result = await peer.fetchAdmission(...args);
              if (result.outcome === 'REFUSED') peerErrors.push(JSON.stringify(result));
              return result;
            } catch (error) {
              peerErrors.push(
                error instanceof Error ? (error.stack ?? error.message) : JSON.stringify(error),
              );
              throw error;
            }
          },
          async deliverAdmissionDecision(...args) {
            if (holdDecisionRecovery && args[2])
              throw Error('Simulated unavailable decision recovery');
            if (loseAdmissionDelivery) {
              loseAdmissionDelivery = false;
              throw new Error('Simulated lost channel before decision execution');
            }
            const result = await peer.deliverAdmissionDecision(...args);
            if (loseAdmissionResponse) {
              loseAdmissionResponse = false;
              loseCapacityResponse = true;
              hideCapacity = true;
              throw new Error('Simulated lost committed decision reply');
            }
            return result;
          },
          admissionCapacity(id) {
            if (hideCapacity) return null;
            if (
              loseOwnerProjection &&
              db
                .prepare(
                  "SELECT 1 FROM local_admission_event WHERE json_extract(record_json, '$.payload.kind')='ACK'",
                )
                .get() !== undefined
            ) {
              loseOwnerProjection = false;
              throw new Error('Simulated projection construction failure after durable owner ACK');
            }
            return peer.admissionCapacity(id);
          },
          async refreshAdmissionCapacity(...args) {
            const response = await peer.refreshAdmissionCapacity(...args);
            if (loseCapacityResponse) {
              loseCapacityResponse = false;
              hideCapacity = true;
              throw new Error('Simulated lost authenticated capacity response');
            }
            hideCapacity = false;
            return response;
          },
          async checkLobbyObservation(...args) {
            return peer.checkLobbyObservation(...args);
          },
          async retryConnection(...args) {
            return peer.retryConnection(...args);
          },
          async readConnection(...args) {
            try {
              return await peer.readConnection(...args);
            } catch (error) {
              peerErrors.push(
                error instanceof Error
                  ? (error.stack ?? error.message)
                  : 'unknown connection error',
              );
              throw error;
            }
          },
          async reconnect(...args) {
            reconnectCount++;
            if (blockReconnect) throw Error('Simulated offline peer');
            try {
              return await peer.reconnect(...args);
            } catch (error) {
              peerErrors.push(
                error instanceof Error ? (error.stack ?? error.message) : 'unknown reconnect error',
              );
              throw error;
            }
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
      const measuredPhase = phaseDiagnostics.begin('player.send-handler');
      try {
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
      } finally {
        phaseDiagnostics.end(measuredPhase);
      }
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
      get peerForTest() {
        return inspectionPeer;
      },
      reconnectCount: () => reconnectCount,
      dropPeer: () => dropPeer(),
      goOffline() {
        blockReconnect = true;
        dropPeer();
      },
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
      loseNextOwnerProjection() {
        loseOwnerProjection = true;
      },
      afterNextReadyResponse(value: () => void) {
        afterReadyResponse = value;
      },
      loseNextReadyResponse(holdRecovery = false) {
        loseReadyResponse = true;
        holdReadyRecoveryAfterLoss = holdRecovery;
      },
      holdDecisionRecovery() {
        holdDecisionRecovery = true;
      },
      releaseOwnerRecovery() {
        holdDecisionRecovery = false;
        holdReadyRecovery = false;
      },
      loseNextLobbyObservation() {
        loseLobbyObservation = true;
      },
      loseNextAdmissionDelivery() {
        loseAdmissionDelivery = true;
      },
      loseNextAdmissionResponseThenCapacity() {
        loseAdmissionResponse = true;
      },
      loseNextCapacityResponse() {
        loseCapacityResponse = true;
      },
      loseNextExit() {
        loseExit = true;
      },
      reopenShell(formId: 'APP-002' | 'CHR-040', sourceId = player.setup.characterDraftId) {
        const measuredPhase = phaseDiagnostics.begin('client.reopen-shell');
        try {
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
        } finally {
          phaseDiagnostics.end(measuredPhase);
        }
      },
      async additionalOwnerView(
        networkScopeId = scope().networkScopeId,
        onPublished?: (message: LocalNetworkHostMessage) => void,
      ) {
        const connection: LocalNetworkConnection = { ...c, contextId: null, networkScopeId: null };
        const messages: LocalNetworkHostMessage[] = [];
        let failNextPush = false,
          failedPushes = 0;
        await runtime.handle(
          {
            messageType: 'network.local-context.resume',
            protocolVersion: 3,
            networkScopeId,
            reconnectRequestId: randomUUID(),
            knownRevisions: vector(readLocalNetworkApplication(db, { ...scope(), networkScopeId })),
            supportedWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
            unacknowledgedCommandIds: [],
          },
          connection,
          shell,
          (message) => {
            if (
              failNextPush &&
              message.messageType === 'projection.snapshot' &&
              message.protocolVersion === 2 &&
              message.presentation.assignment.reason === 'HOST_SYSTEM_EVENT'
            ) {
              failNextPush = false;
              failedPushes++;
              throw new Error('Simulated transient owner publication failure');
            }
            messages.push(message);
            onPublished?.(message);
          },
        );
        return {
          connection,
          messages,
          async send(message: LocalNetworkClientMessage) {
            messages.length = 0;
            expect(
              await runtime.handle(message, connection, shell, (reply) => messages.push(reply)),
            ).toBe(true);
          },
          failNextPush() {
            failNextPush = true;
          },
          failedPushes: () => failedPushes,
        };
      },
      async restart(pending: readonly string[] = [], retiredScope?: string) {
        const measuredPhase = phaseDiagnostics.begin('client.restart-with-resume');
        try {
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
        } finally {
          phaseDiagnostics.end(measuredPhase);
        }
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
  return submitConnectedPlayer(
    await connectedPlayer(h),
    h,
    legacy,
    loseFirstBindingAck,
    beforeSubmit,
  );
}

async function connectedPlayer(h: Awaited<ReturnType<typeof host>>, twoSources = false) {
  const p = await client(twoSources);
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
  return p;
}

async function submitConnectedPlayer(
  p: Awaited<ReturnType<typeof client>>,
  h: Awaited<ReturnType<typeof host>>,
  legacy = false,
  loseFirstBindingAck = false,
  beforeSubmit?: (p: Awaited<ReturnType<typeof client>>) => void,
  candidateCount = 1,
) {
  const refs = (p.payload()['eligibleFinalCandidates'] as readonly JsonObject[])
    .slice(0, candidateCount)
    .map(({ name: _name, sourceSnapshotId: _snapshot, ...ref }) => ref);
  await p.replace('SELECTION', { selectedCandidates: refs });
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
        version: 21,
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

const transportCases = () => {
  it.each([10, 11] as const)(
    'proves empty admission history only for an intact schema %s CREATE checkpoint',
    async (legacySchema) => {
      const h = await host({ legacySchema }),
        scope = {
          ownerDeviceId: h.principal.hostOwnerDeviceId,
          campaignId: h.campaignId,
          gmLocalContextId: h.gmLocalContextId,
        },
        rules = createCampaignAdmissionRules(baseline, config.transfer.maxWitnessBytes).rules,
        read = () => readCampaignAdmissionAvailability(h.db, scope, h.validate, rules);
      const before = h.db.serialize();
      expect(read()).toEqual({
        campaignRevision: 0,
        occupiedCampaignPlaceCount: 0,
        activePcCount: 0,
        releasedRequestIds: [],
        importedSources: [],
      });
      expect(h.db.serialize().equals(before)).toBe(true);
      h.db.exec('CREATE TABLE campaign_admission_copy (id TEXT)');
      expect(read).toThrow();
      h.db.exec('DROP TABLE campaign_admission_copy');
      h.db
        .prepare('UPDATE schema_migration SET checksum_sha256=? WHERE version=?')
        .run('0'.repeat(64), legacySchema);
      expect(read).toThrow();
    },
  );
  it('refuses a progressed legacy checkpoint even when its visible active count is still zero', async () => {
    const h = await host({ legacySchema: 10 });
    commitCampaignCheckpoint(h.db, h.campaignId, () =>
      advanceRevisions(
        h.db,
        { entity: 'campaign', entityId: h.campaignId },
        { stateChanged: false, projectionChanged: true, actorVisibilityChanged: false },
      ),
    );
    expect(h.header()).toMatchObject({ activePcCount: 0, projectionRevision: 1 });
    const before = h.db.serialize();
    expect(() =>
      readCampaignAdmissionAvailability(
        h.db,
        {
          ownerDeviceId: h.principal.hostOwnerDeviceId,
          campaignId: h.campaignId,
          gmLocalContextId: h.gmLocalContextId,
        },
        h.validate,
        createCampaignAdmissionRules(baseline, config.transfer.maxWitnessBytes).rules,
      ),
    ).toThrow();
    expect(h.db.serialize().equals(before)).toBe(true);
  });
  it('keeps the committed OPEN when the later capacity response is lost and replays its original receipt', async () => {
    const h = await host(),
      p = await client();
    await p.nav('APP-002::CTA::003', 'APP-002');
    await p.nav('NET-001::CTA::001');
    await p.replace('ADDRESS', {
      addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
    });
    p.loseNextCapacityResponse();
    const command = await p.command('UI-CMD-CONNECTION-OPEN', {
      attemptId: p.state().plannedAttemptIdOrNull,
      addressOrQrPayload: p.state().addressOrQrPayload,
      selectedCampaignIdOrNull: null,
    });
    const terminal = p.sent.find((m) => m.messageType === 'command.result');
    expect(terminal?.messageType).toBe('command.result');
    if (terminal?.messageType !== 'command.result') throw new Error('Missing committed OPEN');
    expect(p.sent.some((m) => m.messageType === 'command.refusal')).toBe(false);
    expect(p.state()).toMatchObject({
      formId: 'NET-011',
      diagnosticCodeOrNull: 'PEER_UNAVAILABLE',
      pendingCommandIdOrNull: null,
    });
    const original = readLocalNetworkOutbox(p.db, p.scope(), command.commandId);
    await p.restart([command.commandId]);
    expect(readLocalNetworkOutbox(p.db, p.scope(), command.commandId)).toEqual(original);
    expect(p.sent.find((m) => m.messageType === 'command.replay')).toMatchObject({
      receipt: terminal.receipt,
    });
    expect(p.sent.some((m) => m.messageType === 'command.refusal')).toBe(false);
  });
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
  it('closes a failed committed replay proof without a false refusal and retains the original receipt', async () => {
    const h = await host(),
      { p } = await submittedPlayer(h);
    const commandId = p.state().requestOrNull!.submitCommandId,
      original = readLocalNetworkOutbox(p.db, p.scope(), commandId)!;
    const command = JSON.parse(original.intent.clientRequestJson) as NetworkWorkflowRequest;
    const acknowledgement = readLocalNetworkDeliverySnapshot(
      p.db,
      p.scope(),
      commandId,
    ).acknowledgementEvent!;
    expect(original.acknowledgementOrNull?.operation).toBe('SUBMIT');
    const read = localAdmissionStore.readLocalAdmissionDelivery;
    const fault = vi
      .spyOn(localAdmissionStore, 'readLocalAdmissionDelivery')
      .mockImplementation((...args) => {
        if (args[2] === commandId)
          throw new Error('Simulated committed replay projection proof failure');
        return read(...args);
      });
    try {
      await expect(p.send(command)).rejects.toThrow(
        'Network publication failed after durable acknowledgement',
      );
      expect(p.sent).toEqual([]);
    } finally {
      fault.mockRestore();
    }
    expect(readLocalNetworkOutbox(p.db, p.scope(), commandId)).toEqual(original);
    await p.send(command);
    expect(p.sent[0]).toMatchObject({
      messageType: 'command.replay',
      receipt: { commandId, receiptId: acknowledgement.receipt.receiptId },
    });
    expect(p.sent[1]).toMatchObject({
      messageType: 'projection.snapshot',
      presentation: { base: { formId: 'NET-005' } },
    });
    expect(p.sent.some((message) => message.messageType === 'command.refusal')).toBe(false);
    expect(readLocalNetworkOutbox(p.db, p.scope(), commandId)).toEqual(original);
  }, 30000);
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
  it('publishes one durable review to two valid own contexts and retries a failed send without another mutation', async () => {
    const h = await host(),
      { p, submit, batch } = await submittedPlayer(h);
    const original = readLocalNetworkOutbox(p.db, p.scope(), submit.commandId);
    const other = await p.additionalOwnerView();
    expect(other.connection.networkScopeId).toBe(p.c.networkScopeId);
    expect(other.connection.contextId).not.toBe(p.c.contextId);
    const status = (messages: readonly LocalNetworkHostMessage[]) => {
      const m = messages.findLast(
        (value) => value.messageType === 'projection.snapshot' && value.protocolVersion === 2,
      );
      return m?.messageType === 'projection.snapshot' && m.protocolVersion === 2
        ? m.presentation.base.roleFilteredPayload['requestStatus']
        : null;
    };
    expect(status(other.messages)).toBe('PENDING');
    other.failNextPush();
    gmDecision(h, batch.requestId);
    await expect.poll(() => other.failedPushes(), { timeout: 10000 }).toBe(1);
    expect(status(p.sent)).toBe('IN_REVIEW');
    expect(status(other.messages)).toBe('PENDING');
    const committed = p.db.serialize(),
      hosted = h.db.serialize(),
      reconnects = p.reconnectCount();
    await expect.poll(() => status(other.messages), { timeout: 10000 }).toBe('IN_REVIEW');
    expect(p.db.serialize().equals(committed)).toBe(true);
    expect(other.failedPushes()).toBe(1);
    expect(h.db.serialize().equals(hosted)).toBe(true);
    expect(p.reconnectCount()).toBe(reconnects);
    expect(p.peerErrors).toEqual([]);
    expect(readLocalNetworkOutbox(p.db, p.scope(), submit.commandId)).toEqual(original);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM hosted_device_request_decision').get()).toEqual({
      n: 1,
    });
    const pushes = other.messages.filter(
      (m) =>
        m.messageType === 'projection.snapshot' &&
        m.protocolVersion === 2 &&
        m.presentation.assignment.reason === 'HOST_SYSTEM_EVENT',
    );
    expect(pushes).toHaveLength(1);
    expect(JSON.stringify(other.messages)).not.toMatch(
      /canonicalWitnessText|privateKeyPkcs8Base64|learnedNodeRefs/u,
    );
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
    const h = await host({ legacySchema: 10 }),
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
  }, 60000);

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
};
async function host(
  options: {
    path?: string;
    port?: number;
    campaignId?: string;
    capacity?: number;
    limits?: Partial<DeviceAdmissionPeerRuntimeLimits>;
    legacySchema?: 10 | 11;
  } = {},
) {
  const preparePhase = phaseDiagnostics.begin('host.prepare');
  const openPhase = phaseDiagnostics.begin('host.open-migrate');
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
      ...(options.legacySchema === 11 ? [migration0011] : []),
    ]);
  }
  phaseDiagnostics.end(openPhase);
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
    const { readLocalGmProfile } = await import('../../src/persistence/campaign-creation.js');
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
  phaseDiagnostics.end(preparePhase);
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
    runtime: {
      ...runtime,
      trackedTransferCount: ex.trackedTransferCount,
      availableNetworkInterfaces: () => bind.interfaces(),
      heldNetworkConfiguration: (id: string) => {
        const live = bind.configurationForCampaign(id);
        return live === null
          ? null
          : {
              hostAddress: live.hostAddress,
              hostPort: live.hostPort,
              networkInterface: live.networkInterface,
            };
      },
      operationCounts: (id: string, device: string | null = null) => {
        const commands = ex.pendingCounts(id, device),
          stagedTransferCount = ex.pendingTransferCount(id, device);
        return {
          ...commands,
          stagedTransferCount,
          pendingOperationCount:
            commands.queuedCommandCount + commands.executingCommandCount + stagedTransferCount,
        };
      },
    },
    connect,
    close,
    errors,
  };
}
import { createGmNetworkRuntime } from '../../src/host/network-application.js';
import type { FormActionIntentV2Message } from '../../src/shared/wire-v2-protocol.js';
import {
  createCampaignCreationRuntime,
  type CampaignConnection,
} from '../../src/host/campaign-creation.js';
import { loadProtocolVocabulary } from '../../src/host/protocol-vocabulary.js';
import { NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS } from '../../src/shared/device-admission.js';
import { readGmDeviceRequestQueue } from '../../src/persistence/network-device-request.js';

function lifecycleProjection(view: {
  base: { roleFilteredPayload: JsonObject };
  layers?: readonly { roleFilteredPayload: JsonObject }[];
}) {
  const { currentCampaignLifecycle, ...base } = view.base.roleFilteredPayload;
  const marker = campaignLifecycleGmAnchorValue(currentCampaignLifecycle);
  const p = campaignLifecycleGmProjectionValue(view.layers?.at(-1)?.roleFilteredPayload ?? base);
  expect(marker).toMatchObject({
    contextId: p.contextId,
    campaignId: p.campaignId,
    campaignRevision: p.campaignRevision,
    settingsRevision: p.settingsRevision,
    stateRevision: p.stateRevision,
    projectionRevision: p.projectionRevision,
    actorVisibilityRevision: p.actorVisibilityRevision,
    campaignStatus: p.campaignStatus,
    pauseReasonOrNull: p.pauseReasonOrNull,
    firstStartCompleted: p.firstStartCompleted,
  });
  return p;
}
function gmClient(h: Awaited<ReturnType<typeof host>>) {
  const c: CampaignConnection = {
    gmLocalContextId: h.gmLocalContextId,
    executableCreate: true,
    executableReview: NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS,
    trusted: () => h.db.open,
  };
  const gmScheduler = createCampaignGmScheduler((connection) => {
    if (!connection.trusted() || connection.gmLocalContextId === null) return null;
    try {
      const cursor = readCampaignCreationCursor(h.db, connection.gmLocalContextId);
      return cursor.kind === 'CAMPAIGN' || cursor.kind === 'QUEUE' || cursor.kind === 'ADMISSION'
        ? { gmLocalContextId: cursor.gmLocalContextId, campaignId: cursor.targetId }
        : null;
    } catch {
      // Match production: the normal handler owns the closed authority refusal.
      return null;
    }
  });
  const campaign = createCampaignCreationRuntime({
    gmScheduler,
    database: h.db,
    projectRoot: process.cwd(),
    baseline,
    bind: h.bind,
    requestReview: {
      withLifecycle: (connection, view) => runtime.withLifecycle(connection, view),
      project: (connection) => runtime.project(connection),
      refreshConnectionPresentation: (connection) =>
        runtime.refreshConnectionPresentation(connection),
      receipt: (connection, id) => runtime.receipt(connection, id),
    },
  });
  const runtime = createGmNetworkRuntime({
    gmScheduler,
    config,
    database: h.db,
    baseline,
    vocabulary,
    campaignNetwork: h.runtime,
    campaignPresentation: campaign.project,
  });
  cleaners.push(() => {
    runtime.close();
    gmScheduler.close();
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
    const measuredPhase = phaseDiagnostics.begin('gm.send-handler');
    try {
      sent.length = 0;
      expect(await runtime.handle(m, c, (v) => sent.push(v))).toBe(true);
      return sent;
    } finally {
      phaseDiagnostics.end(measuredPhase);
    }
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
  return { c, runtime, campaign, sent, scope, view, send, nav, select, resume, gmScheduler };
}

type AdmissionScenario = 'ACCEPT' | 'ACCEPT_WITH_BLOCKERS' | 'DECLINE' | 'REJECT' | 'MIXED';
function createAdmissionScenario(scenario: AdmissionScenario) {
  let h: Awaited<ReturnType<typeof host>>,
    p: Awaited<ReturnType<typeof client>>,
    gm: Awaited<ReturnType<typeof gmClient>>,
    requestId: string;
  let sourceRows: unknown;
  const gmNav = async (
    sourceFormId: FormActionIntentV2Message['sourceFormId'],
    actionKey: FormActionIntentV2Message['actionKey'],
  ) => {
    const view = await gm.runtime.project(gm.c);
    const navigationRequestId = randomUUID();
    await gm.send({
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId,
      sourceFormId,
      actionKey,
      expectedProjectionRevision: view.revisions.projectionRevision,
    });
    expect(
      gm.sent[0],
      JSON.stringify({
        sourceFormId,
        actionKey,
        actual: view.base.formId,
        layer: view.layers?.at(-1)?.formId,
        revisions: view.revisions,
        messages: gm.sent,
      }),
    ).toMatchObject({ messageType: 'projection.snapshot' });
    expect(
      gm.sent.find(
        (message) =>
          message.messageType === 'projection.snapshot' &&
          message.protocolVersion === 2 &&
          message.presentation.assignment.correlationId === navigationRequestId,
      ),
    ).toMatchObject({
      presentation: {
        assignment: { correlationId: navigationRequestId, reason: 'FORM_ACTION' },
      },
    });
  };
  beforeEach(async () => {
    h = await host();
  });
  beforeEach(async () => {
    p = await connectedPlayer(h, scenario === 'MIXED');
  });
  beforeEach(async () => {
    const submitted = await submitConnectedPlayer(
      p,
      h,
      false,
      false,
      undefined,
      scenario === 'MIXED' ? 2 : 1,
    );
    requestId = submitted.batch.requestId;
    sourceRows = p.db.prepare('SELECT * FROM local_character').all();
  });
  beforeEach(async () => {
    gm = gmClient(h);
    gm.c.executableReview = [
      ...NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS,
      ...ADMISSION_GM_WORKFLOW_IDS,
    ];
    await gm.nav();
  });
  beforeEach(async () => {
    await gm.select(requestId);
  });
  beforeEach(async () => {
    await gm.send({
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      workflowCommandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      expectedRevisions: vector(gm.view()),
      payload: { campaignId: h.campaignId, requestId, requestRevision: 0 },
    });
    expect(gm.sent[0]?.messageType).toBe('command.result');
  });
  beforeEach(async () => {
    await gm.send({
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      workflowCommandId: 'UI-CMD-ADMISSION-REVIEW-OPEN',
      expectedRevisions: vector(gm.view()),
      payload: { campaignId: h.campaignId, requestId, requestRevision: 1 },
    });
    expect(gm.sent[0]?.messageType).toBe('command.result');
    await gmNav('NET-018', 'NET-018::CTA::002');
  });
  beforeEach(async () => {
    if (scenario === 'REJECT') return;
    const view = await gm.runtime.project(gm.c),
      q = view.base.roleFilteredPayload;
    const inputs = structuredClone(admissionReviewInputsValue(q['reviewDraft']));
    const edited = {
      ...inputs,
      massReview: {
        ...inputs.massReview,
        decision:
          scenario === 'ACCEPT_WITH_BLOCKERS'
            ? ('PENDING_MASTER_APPROVAL' as const)
            : ('APPROVED' as const),
      },
      inventoryReview: {
        ...inputs.inventoryReview,
        status: 'FINAL' as const,
        unresolvedSourceEntryIds: [],
      },
      moneyReview: { status: 'FINAL' as const, amountOrNull: 42 },
      groupAssignmentOrNull: { kind: 'START' as const },
      locationAssignmentOrNull: { location: 'Лагерь', subLocationOrNull: null },
    };
    await gm.send({
      messageType: 'network.admission-review.edit',
      protocolVersion: 3,
      draftUpdateId: randomUUID(),
      contextId: h.gmLocalContextId,
      campaignId: h.campaignId,
      admissionBatchId: q['admissionBatchId'] as string,
      sourceFormId: 'NET-019',
      expectedRevisions: view.revisions,
      expectedReviewRevision: Number(q['reviewRevisionOrNull']!),
      intent: { kind: 'EDIT', reviewCopyId: q['selectedReviewCopyId'] as string, inputs: edited },
    });
    expect(gm.sent[0]).toMatchObject({ messageType: 'network.admission-draft.result' });
  });
  beforeEach(async () => {
    if (scenario !== 'MIXED') return;
    const current = await gm.runtime.project(gm.c),
      first = current.base.roleFilteredPayload['selectedReviewCopyId'];
    const second = (current.base.roleFilteredPayload['batchReviewCopies'] as JsonObject[])[1]![
      'reviewCopyId'
    ];
    const select = async (id: JsonObject[string]) => {
      const view = await gm.runtime.project(gm.c),
        q = view.base.roleFilteredPayload;
      await gm.send({
        messageType: 'network.admission-view.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        contextId: h.gmLocalContextId,
        campaignId: h.campaignId,
        admissionBatchId: q['admissionBatchId'] as string,
        sourceFormId: 'NET-019',
        expectedRevisions: view.revisions,
        values: {
          selectedReviewCopyId: id as string,
          rejectionReason: '',
          weaponDraftOrNull: null,
        },
      });
      expect(gm.sent[0]?.messageType).toBe('network.admission-draft.result');
    };
    await select(second!);
    const view = await gm.runtime.project(gm.c),
      q = view.base.roleFilteredPayload;
    const inputs = admissionReviewInputsValue(q['reviewDraft']);
    await gm.send({
      messageType: 'network.admission-review.edit',
      protocolVersion: 3,
      draftUpdateId: randomUUID(),
      contextId: h.gmLocalContextId,
      campaignId: h.campaignId,
      admissionBatchId: q['admissionBatchId'] as string,
      sourceFormId: 'NET-019',
      expectedRevisions: view.revisions,
      expectedReviewRevision: Number(q['reviewRevisionOrNull']),
      intent: {
        kind: 'EDIT',
        reviewCopyId: second as string,
        inputs: {
          ...inputs,
          groupAssignmentOrNull: { kind: 'START' },
          locationAssignmentOrNull: { location: 'Лагерь', subLocationOrNull: null },
        },
      },
    });
    expect(gm.sent[0]?.messageType).toBe('network.admission-draft.result');
    await select(first!);
  });
  beforeEach(
    async () => {
      if (scenario !== 'REJECT') {
        const initial = await gm.runtime.project(gm.c),
          first = initial.base.roleFilteredPayload['selectedReviewCopyId'];
        const select = async (id: string) => {
          const view = await gm.runtime.project(gm.c),
            q = view.base.roleFilteredPayload;
          if (q['selectedReviewCopyId'] === id) return;
          await gm.send({
            messageType: 'network.admission-view.replace',
            protocolVersion: 3,
            draftUpdateId: randomUUID(),
            contextId: h.gmLocalContextId,
            campaignId: h.campaignId,
            admissionBatchId: q['admissionBatchId'] as string,
            sourceFormId: 'NET-019',
            expectedRevisions: view.revisions,
            values: { selectedReviewCopyId: id, rejectionReason: '', weaponDraftOrNull: null },
          });
          expect(gm.sent[0]?.messageType).toBe('network.admission-draft.result');
        };
        const copyIds =
          scenario === 'MIXED'
            ? (initial.base.roleFilteredPayload['batchReviewCopies'] as JsonObject[]).map(
                (c) => c['reviewCopyId'] as string,
              )
            : [first as string];
        for (const copyId of copyIds) {
          await select(copyId);
          const view = await gm.runtime.project(gm.c),
            q = view.base.roleFilteredPayload;
          const requests = q['validatedWeaponRequests'] as readonly {
            requestId: string;
            validationReceiptId: string;
          }[];
          for (const request of requests) {
            await gmNav('NET-019', 'NET-019::CTA::004');
            let current = await gm.runtime.project(gm.c),
              payload = current.base.roleFilteredPayload;
            const values = {
              ...(payload['viewValues'] as unknown as {
                selectedReviewCopyId: string;
                rejectionReason: string;
              }),
              weaponDraftOrNull: {
                weaponReviewInput: { kind: 'VALIDATED_REQUEST' as const, ...request },
                decision: 'APPROVE' as const,
                overrideProfileOrNull: null,
                reasonOrNull: null,
              },
            };
            // The public request summary contains only the two typed input identities here.
            values.weaponDraftOrNull.weaponReviewInput = {
              kind: 'VALIDATED_REQUEST',
              requestId: request.requestId,
              validationReceiptId: request.validationReceiptId,
            };
            await gm.send({
              messageType: 'network.admission-view.replace',
              protocolVersion: 3,
              draftUpdateId: randomUUID(),
              contextId: h.gmLocalContextId,
              campaignId: h.campaignId,
              admissionBatchId: payload['admissionBatchId'] as string,
              sourceFormId: 'GM-019',
              expectedRevisions: current.revisions,
              values,
            });
            expect(gm.sent[0]?.messageType).toBe('network.admission-draft.result');
            current = await gm.runtime.project(gm.c);
            payload = current.base.roleFilteredPayload;
            await gm.send({
              messageType: 'command.request',
              protocolVersion: 1,
              commandKind: 'workflow-command',
              role: 'gm',
              commandId: randomUUID(),
              workflowCommandId: 'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
              expectedRevisions: current.revisions,
              payload: {
                contextId: h.gmLocalContextId,
                campaignId: h.campaignId,
                admissionBatchId: payload['admissionBatchId']!,
                reviewCopyId: payload['selectedReviewCopyId']!,
                reviewRevision: payload['reviewRevisionOrNull']!,
                input: values.weaponDraftOrNull,
              },
            });
            expect(gm.sent[0]?.messageType).toBe('command.result');
          }
        }
        await select(first as string);
      }
    },
    scenario === 'MIXED' ? 60000 : 30000,
  );
  beforeEach(async () => {
    await gmNav('NET-019', 'NET-019::CTA::002');
    await gmNav('NET-018', 'NET-018::CTA::004');
    if (scenario === 'REJECT') {
      await gmNav('NET-021', 'NET-021::CTA::002');
      const view = await gm.runtime.project(gm.c),
        q = view.layers!.at(-1)!.roleFilteredPayload;
      await gm.send({
        messageType: 'network.admission-view.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        contextId: h.gmLocalContextId,
        campaignId: h.campaignId,
        admissionBatchId: q['admissionBatchId'] as string,
        sourceFormId: 'NET-022',
        expectedRevisions: view.revisions,
        values: {
          selectedReviewCopyId: q['selectedReviewCopyId'] as string,
          rejectionReason: 'Нужно другое снаряжение',
          weaponDraftOrNull: null,
        },
      });
      expect(gm.sent[0]?.messageType).toBe('network.admission-draft.result');
    }
  });
  beforeEach(async () => {
    const view = await gm.runtime.project(gm.c),
      q = view.layers!.at(-1)!.roleFilteredPayload;
    if (scenario !== 'REJECT') expect(q['missingRequiredFields']).toEqual([]);
    await gm.send({
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      workflowCommandId:
        scenario === 'REJECT' ? 'UI-CMD-ADMISSION-GM-REJECT' : 'UI-CMD-ADMISSION-GM-ACCEPT',
      expectedRevisions: view.revisions,
      payload: {
        contextId: h.gmLocalContextId,
        campaignId: h.campaignId,
        admissionBatchId: q['admissionBatchId']!,
        reviewRevision: q['reviewRevisionOrNull']!,
        expectedCampaignRevision: (q['capacityPreview'] as JsonObject)[
          'evaluatedCampaignRevision'
        ]!,
        previewChecksumOrNull: scenario === 'REJECT' ? null : q['proposalChecksum']!,
        reasonOrNull: scenario === 'REJECT' ? 'Нужно другое снаряжение' : null,
      },
    });
    expect(gm.sent[0]).toMatchObject({ messageType: 'command.result' });
  });
  beforeEach(async () => {
    // This composite SQLite/peer restoration previously ran inside a 30s scenario.
    // Moving initial setup to a hook must not impose the implicit 10s hook deadline.
    // Later recovery/fault assertions retain their separate 30s scenario budget.
    await p.restart();
  }, 30000);
  const preparedTabs = () => {
    if (scenario === 'MIXED')
      describe('#173 prepared-tab authenticated transport', () => {
        let tabScope: string,
          child: Awaited<ReturnType<typeof p.additionalOwnerView>>,
          replayReady: () => Promise<void>;
        const payload = () => {
          const m = child.messages.findLast(
            (m) => m.messageType === 'projection.snapshot' && m.protocolVersion === 2,
          );
          if (m?.messageType !== 'projection.snapshot' || m.protocolVersion !== 2)
            throw Error('Missing prepared-tab projection');
          return m.presentation.base.roleFilteredPayload;
        };
        beforeEach(async () => {
          const owner = p.payload();
          await p.send({
            messageType: 'command.request',
            protocolVersion: 1,
            commandKind: 'workflow-command',
            role: 'player',
            commandId: randomUUID(),
            workflowCommandId: 'UI-CMD-ADMISSION-PLAYER-DECIDE',
            expectedRevisions: vector(p.state()),
            payload: {
              contextId: p.c.contextId!,
              networkScopeId: p.scope().networkScopeId,
              campaignId: h.campaignId,
              requestId,
              admissionBatchId: owner['admissionBatchId']!,
              proposalRevision: owner['proposalRevision']!,
              proposalChecksum: owner['proposalChecksum']!,
              expectedCampaignRevision: owner['campaignRevisionOrNull']!,
              decision: 'ACCEPT',
            },
          });
          expect(p.sent[0]?.messageType).toBe('command.result');
          const admission = readLocalAdmission(p.db, p.scope(), requestId)!;
          expect(admission.receiptOrNull!.copies.map((c) => c.lifecycleState)).toEqual([
            'ACTIVE',
            'PROPOSED',
          ]);
          tabScope = admission.additionalTabs[0]!.networkScopeId;
        }, 30000);
        beforeEach(async () => {
          child = await p.additionalOwnerView(tabScope);
          expect(
            campaignLobbyPlayerProjectionValue(payload()).lobby.selectedCopy.lifecycleState,
          ).toBe('PROPOSED');
        }, 30000);
        beforeEach(() => {
          gm.c.executableReview = [
            ...(gm.c.executableReview ?? []),
            'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
            'UI-CMD-CAMPAIGN-START',
          ];
        }, 30000);
        for (const [form, action] of [
          ['NET-021', 'NET-021::CTA::001'],
          ['NET-017', 'NET-017::CTA::009'],
          ['CMP-006', 'CMP-006::CTA::001'],
          ['CMP-007', 'CMP-007::CTA::001'],
        ] as const)
          beforeEach(async () => {
            await gmNav(form, action);
            // Direct runtime calls otherwise chain CPU-heavy folds through microtasks and
            // starve the real peer socket. A browser sends each action in a separate I/O turn.
            await new Promise<void>((resolve) => setImmediate(resolve));
          }, 30000);
        beforeEach(async () => {
          const view = await gm.runtime.project(gm.c);
          await gm.send({
            messageType: 'command.request',
            protocolVersion: 1,
            commandKind: 'workflow-command',
            role: 'gm',
            commandId: randomUUID(),
            workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
            expectedRevisions: view.revisions,
            payload: {
              campaignId: h.campaignId,
              expectedLobbySnapshotRevision:
                view.base.roleFilteredPayload['lobbySnapshotRevision']!,
              dayNumber: 2,
              hour: 21,
              minute: 7,
            },
          });
          expect(gm.sent[0]?.messageType).toBe('command.result');
          await expect
            .poll(
              () =>
                campaignLobbyPlayerProjectionValue(payload()).lobby.initialCampaignTimeOrNull
                  ?.campaignTimestamp,
              { timeout: 10000 },
            )
            .toBe(2707);
        }, 30000);
        beforeEach(async () => {
          const owner = campaignLobbyPlayerProjectionValue(payload());
          const command = {
            messageType: 'command.request',
            protocolVersion: 1,
            commandKind: 'workflow-command',
            role: 'player',
            commandId: randomUUID(),
            workflowCommandId: 'UI-CMD-CAMPAIGN-READY-SET',
            expectedRevisions: vector(owner),
            payload: {
              campaignId: h.campaignId,
              expectedLobbySnapshotRevision: owner.lobby.lobbySnapshotRevision,
              ready: true,
            },
          } as const;
          p.loseNextReadyResponse();
          await child.send(command);
          expect(
            child.messages.some(
              (m) => m.messageType === 'command.result' || m.messageType === 'command.refusal',
            ),
          ).toBe(false);
          await expect
            .poll(
              () =>
                child.messages.some(
                  (m) =>
                    m.messageType === 'command.replay' && m.receipt.commandId === command.commandId,
                ),
              { timeout: 10000 },
            )
            .toBe(true);
          expect(campaignLobbyPlayerProjectionValue(payload()).lobby.ready).toBe(true);
          const receipt = child.messages.find((m) => m.messageType === 'command.replay');
          replayReady = async () => {
            await child.send(command);
            expect(child.messages[0]).toEqual(receipt);
          };
        }, 30000);
        beforeEach(async () => {
          await replayReady();
        }, 30000);
        beforeEach(async () => {
          const view = await gm.runtime.project(gm.c);
          await gm.send({
            messageType: 'command.request',
            protocolVersion: 1,
            commandKind: 'workflow-command',
            role: 'gm',
            commandId: randomUUID(),
            workflowCommandId: 'UI-CMD-CAMPAIGN-START',
            expectedRevisions: view.revisions,
            payload: {
              campaignId: h.campaignId,
              expectedLobbySnapshotRevision:
                view.base.roleFilteredPayload['lobbySnapshotRevision']!,
              expectedReadinessRevision: view.base.roleFilteredPayload['readinessRevision']!,
            },
          });
          expect(gm.sent[0]?.messageType).toBe('command.result');
          await expect
            .poll(() => p.payload()['projectionVariant'], { timeout: 10000 })
            .toBe('PEACE_SNAPSHOT');
          await expect
            .poll(() => campaignLobbyPlayerProjectionValue(payload()).lobby.campaignStarted, {
              timeout: 10000,
            })
            .toBe(true);
        }, 30000);
        beforeEach(async () => {
          const blocked = campaignLobbyPlayerProjectionValue(payload());
          expect(blocked.lobby.selectedCopy.lifecycleState).toBe('PROPOSED');
          await child.send({
            messageType: 'navigation.form-action',
            protocolVersion: 2,
            navigationRequestId: randomUUID(),
            sourceFormId: 'NET-006',
            actionKey: 'NET-006::CTA::001',
            expectedProjectionRevision: blocked.projectionRevision,
          });
          expect(payload()['campaignStatus']).toBe('HOSTING');
          expect(payload()['startStatus']).toBe('STARTED');
          await child.send({
            messageType: 'navigation.form-action',
            protocolVersion: 2,
            navigationRequestId: randomUUID(),
            sourceFormId: 'NET-027',
            actionKey: 'NET-027::CTA::001',
            expectedProjectionRevision: Number(payload()['projectionRevision']),
          });
          expect(campaignLobbyPlayerProjectionValue(payload()).lobby.campaignStarted).toBe(true);
        }, 30000);
        beforeEach(async () => {
          const scene = campaignPeaceProjectionValue(p.payload()).sceneId;
          await p.restart();
          expect(campaignPeaceProjectionValue(p.payload()).sceneId).toBe(scene);
        }, 60000);
        it('keeps the blocked prepared tab in NET-006 while the original ACTIVE tab enters PEACE and both restore', async () => {
          child = await p.additionalOwnerView(tabScope);
          expect(campaignLobbyPlayerProjectionValue(payload()).lobby.campaignStarted).toBe(true);
          expect(
            campaignLobbyPlayerProjectionValue(payload()).lobby.selectedCopy.lifecycleState,
          ).toBe('PROPOSED');
          expect(p.db.prepare('SELECT * FROM local_character').all()).toEqual(sourceRows);
        }, 30000);
      });
  };
  const registerReadyAndPeace = (
    register: (groups: { ready: () => void; peace: () => void }) => void,
  ) => {
    if (scenario === 'ACCEPT' || scenario === 'ACCEPT_WITH_BLOCKERS')
      describe('#173 authenticated Ready and first PEACE destination', () => {
        beforeEach(async () => {
          const owner = p.payload();
          await p.send({
            messageType: 'command.request',
            protocolVersion: 1,
            commandKind: 'workflow-command',
            role: 'player',
            commandId: randomUUID(),
            workflowCommandId: 'UI-CMD-ADMISSION-PLAYER-DECIDE',
            expectedRevisions: vector(p.state()),
            payload: {
              contextId: p.c.contextId!,
              networkScopeId: p.scope().networkScopeId,
              campaignId: h.campaignId,
              requestId,
              admissionBatchId: owner['admissionBatchId']!,
              proposalRevision: owner['proposalRevision']!,
              proposalChecksum: owner['proposalChecksum']!,
              expectedCampaignRevision: owner['campaignRevisionOrNull']!,
              decision: 'ACCEPT',
            },
          });
          expect(p.sent[0]?.messageType).toBe('command.result');
          campaignLobbyPlayerProjectionValue(p.payload());
        }, 30000);
        const ready = async (value: boolean) => {
          const owner = campaignLobbyPlayerProjectionValue(p.payload());
          const request = {
            messageType: 'command.request',
            protocolVersion: 1,
            commandKind: 'workflow-command',
            role: 'player',
            commandId: randomUUID(),
            workflowCommandId: 'UI-CMD-CAMPAIGN-READY-SET',
            expectedRevisions: vector(p.state()),
            payload: {
              campaignId: h.campaignId,
              expectedLobbySnapshotRevision: owner.lobby.lobbySnapshotRevision,
              ready: value,
            },
          } as const;
          await p.send(request);
          return request;
        };
        if (scenario === 'ACCEPT_WITH_BLOCKERS')
          it('keeps blocked PROPOSED copies visible and refuses Ready without host writes', async () => {
            const owner = campaignLobbyPlayerProjectionValue(p.payload());
            expect(owner.lobby.includedCampaignCharacterIds).toEqual([]);
            expect(owner.lobby.ownCopies[0]?.blockers.length).toBeGreaterThan(0);
            const before = h.db.serialize();
            await ready(true);
            expect(p.sent[0]?.messageType).toBe('command.refusal');
            expect(h.db.serialize().equals(before)).toBe(true);
          });
        if (scenario === 'ACCEPT') {
          async function isolatedLobbyPeer() {
            // Direct protocol assertions must not race the runtime's serialized owner poll.
            // Recovery still uses the real authenticated channel and existing request binding.
            p.disconnect();
            const peer = createLocalNetworkPeer({ database: p.db, baseline, config });
            cleaners.push(() => {
              peer.close();
              return Promise.resolve();
            });
            const root = p.scope(),
              request = p.state().requestOrNull!;
            await peer.reconnect(root, p.state().addressOrQrPayload, h.campaignId);
            const recovered = await peer.call(root, {
              schemaVersion: 1,
              operation: 'DEVICE_REQUEST_RECOVER',
              requestId: request.requestId,
              technicalSessionId: request.technicalSessionId,
              submitCommandId: request.submitCommandId,
            });
            expect(recovered.outcome).toBe('ACK');
            return peer;
          }
          const readyCases = () => {
            it('checks an unchanged complete lobby digest without SQL writes or a staged transfer', async () => {
              const observation = campaignLobbyPlayerProjectionValue(p.payload()).lobby;
              const peer = await isolatedLobbyPeer();
              const localBefore = p.db.serialize(),
                hostBefore = h.db.serialize();
              expect(
                await peer.checkLobbyObservation(p.scope(), p.state().tabId, observation),
              ).toEqual({ outcome: 'UNCHANGED' });
              expect(p.db.serialize().equals(localBefore)).toBe(true);
              expect(h.db.serialize().equals(hostBefore)).toBe(true);
              expect(h.runtime.operationCounts(h.campaignId).pendingOperationCount).toBe(0);
              expect(h.runtime.trackedTransferCount(h.campaignId)).toBe(0);
            });
            describe('freshness after Ready changes only the lobby journal', () => {
              let observation: ReturnType<typeof campaignLobbyPlayerProjectionValue>['lobby'];
              beforeEach(async () => {
                observation = campaignLobbyPlayerProjectionValue(p.payload()).lobby;
                await ready(true);
                expect(p.sent[0]?.messageType).toBe('command.result');
              }, 30000);
              it('revokes a changed CHECK publication before any chunk when its channel closes', async () => {
                const peer = await isolatedLobbyPeer();
                const root = p.scope(),
                  request = p.state().requestOrNull!;
                const channel = peer.current(root.networkScopeId)!;
                const limits = {
                  maxPublicationBytes: config.transfer.maxSubmitBodyBytes,
                  maxChunkBytes: config.transfer.maxChunkBytes,
                };
                const query = {
                  schemaVersion: 1 as const,
                  operation: 'CAMPAIGN_LOBBY_CHECK' as const,
                  requestId: request.requestId,
                  technicalSessionId: request.technicalSessionId,
                  submitCommandId: request.submitCommandId,
                  admittedTabId: p.state().tabId,
                  knownObservationSha256: postSaveSha256(canonicalPostSaveJson(observation)),
                };
                const changed = decodeCampaignLobbyCheckResponse(
                  await channel.call(encodeCampaignLobbyCheckCommand(query)),
                  limits,
                );
                expect(changed.outcome).toBe('CHANGED');
                if (changed.outcome !== 'CHANGED')
                  throw Error('Expected changed CHECK publication');
                expect(h.runtime.trackedTransferCount(h.campaignId)).toBe(1);
                expect(h.runtime.operationCounts(h.campaignId).pendingOperationCount).toBe(0);
                const copies = h.db.prepare('SELECT * FROM campaign_character_copy').all();
                channel.close();
                await peer.reconnect(
                  root,
                  parseCampaignLanAddress(p.state().addressOrQrPayload).canonicalOrigin,
                  h.campaignId,
                );
                const replacement = peer.current(root.networkScopeId)!;
                expect(replacement).not.toBe(channel);
                const reply = decodeAdmissionPeerResponse(
                  await replacement.call(
                    encodeAdmissionPeerCommand({
                      schemaVersion: 1,
                      operation: 'ADMISSION_PUBLICATION_CHUNK',
                      requestId: query.requestId,
                      technicalSessionId: query.technicalSessionId,
                      submitCommandId: query.submitCommandId,
                      transferId: changed.manifest.transferId,
                      publicationChecksum: changed.manifest.publicationChecksum,
                      chunkIndex: 0,
                    }),
                  ),
                  limits,
                );
                expect(reply).toMatchObject({ outcome: 'REFUSED', code: 'TRANSFER_UNAVAILABLE' });
                expect(h.runtime.trackedTransferCount(h.campaignId)).toBe(0);
                expect(h.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual(copies);
                expect(p.db.prepare('SELECT * FROM local_character').all()).toEqual(sourceRows);
              });
              it('detects the complete changed observation and rejects a foreign admitted tab', async () => {
                const updated = campaignLobbyPlayerProjectionValue(p.payload()).lobby;
                expect(updated.campaignRevision).toBe(observation.campaignRevision);
                expect(updated.lobbySnapshotRevision).toBe(observation.lobbySnapshotRevision);
                const peer = await isolatedLobbyPeer();
                const request = p.state().requestOrNull!,
                  root = p.scope();
                const query = {
                  schemaVersion: 1 as const,
                  operation: 'CAMPAIGN_LOBBY_CHECK' as const,
                  requestId: request.requestId,
                  technicalSessionId: request.technicalSessionId,
                  submitCommandId: request.submitCommandId,
                  admittedTabId: p.state().tabId,
                  knownObservationSha256: postSaveSha256(canonicalPostSaveJson(observation)),
                };
                const channel = peer.current(root.networkScopeId)!;
                const limits = {
                  maxPublicationBytes: config.transfer.maxSubmitBodyBytes,
                  maxChunkBytes: config.transfer.maxChunkBytes,
                };
                const changed = decodeCampaignLobbyCheckResponse(
                  await channel.call(encodeCampaignLobbyCheckCommand(query)),
                  limits,
                );
                expect(changed).toMatchObject({
                  outcome: 'CHANGED',
                  observationSha256: postSaveSha256(canonicalPostSaveJson(updated)),
                });
                const refused = decodeCampaignLobbyCheckResponse(
                  await channel.call(
                    encodeCampaignLobbyCheckCommand({ ...query, admittedTabId: randomUUID() }),
                  ),
                  limits,
                );
                expect(refused).toMatchObject({ outcome: 'REFUSED' });
                if (changed.outcome !== 'CHANGED') throw Error('Expected changed lobby manifest');
                expect(h.runtime.trackedTransferCount(h.campaignId)).toBe(1);
                expect(h.runtime.operationCounts(h.campaignId).pendingOperationCount).toBe(0);
                const parts: Buffer[] = [];
                for (let index = 0; index < changed.manifest.chunkCount; index++) {
                  const chunk = decodeAdmissionPeerResponse(
                    await channel.call(
                      encodeAdmissionPeerCommand({
                        schemaVersion: 1,
                        operation: 'ADMISSION_PUBLICATION_CHUNK',
                        requestId: query.requestId,
                        technicalSessionId: query.technicalSessionId,
                        submitCommandId: query.submitCommandId,
                        transferId: changed.manifest.transferId,
                        publicationChecksum: changed.manifest.publicationChecksum,
                        chunkIndex: index,
                      }),
                    ),
                    limits,
                  );
                  expect(chunk.outcome).toBe('CHUNK');
                  if (chunk.outcome !== 'CHUNK') throw Error('Expected immutable lobby chunk');
                  parts.push(Buffer.from(chunk.bytesBase64, 'base64'));
                }
                const bytes = Buffer.concat(parts);
                expect(postSaveSha256(bytes)).toBe(changed.observationSha256);
                expect(JSON.parse(bytes.toString('utf8'))).toEqual(updated);
                expect(h.runtime.trackedTransferCount(h.campaignId)).toBe(0);
                await expect(
                  peer.checkLobbyObservation(root, p.state().tabId, observation),
                ).rejects.toThrow();
              });
            });
            it.each(['lost ACK', 'lost observation'] as const)(
              'recovers %s through the background channel without manual reconnect',
              async (fault) => {
                if (fault === 'lost ACK') p.loseNextReadyResponse(true);
                else p.loseNextLobbyObservation();
                const command = await ready(true);
                expect(
                  p.sent.some(
                    (m) =>
                      m.messageType === 'command.result' || m.messageType === 'command.refusal',
                  ),
                ).toBe(false);
                expect(p.payload()['pendingCommandIdOrNull']).toBe(command.commandId);
                expect(campaignLobbyPlayerProjectionValue(p.payload()).lobby.ready).toBe(false);
                const passive = fault === 'lost ACK' ? await p.additionalOwnerView() : null;
                if (passive !== null)
                  expect(passive.messages.at(-1)).toMatchObject({
                    presentation: {
                      base: { roleFilteredPayload: { pendingCommandIdOrNull: command.commandId } },
                    },
                  });
                p.releaseOwnerRecovery();
                await expect
                  .poll(
                    () =>
                      p.sent.some(
                        (m) =>
                          m.messageType === 'command.replay' &&
                          m.receipt.commandId === command.commandId,
                      ),
                    { timeout: 10000 },
                  )
                  .toBe(true);
                const receipt = p.sent.find((m) => m.messageType === 'command.replay');
                if (passive !== null)
                  await expect
                    .poll(
                      () => {
                        const latest = passive.messages.findLast(
                          (m) => m.messageType === 'projection.snapshot' && m.protocolVersion === 2,
                        );
                        return latest?.messageType === 'projection.snapshot' &&
                          latest.protocolVersion === 2
                          ? latest.presentation.base.roleFilteredPayload['pendingCommandIdOrNull']
                          : undefined;
                      },
                      { timeout: 10000 },
                    )
                    .toBeNull();
                expect(
                  passive?.messages.some((m) =>
                    ['command.result', 'command.replay', 'command.refusal'].includes(m.messageType),
                  ) ?? false,
                ).toBe(false);
                expect(campaignLobbyPlayerProjectionValue(p.payload()).lobby.ready).toBe(true);
                expect(p.payload()['pendingCommandIdOrNull']).toBeNull();
                await p.send(command);
                expect(p.sent[0]).toEqual(receipt);
                expect(
                  h.db
                    .prepare("SELECT count(*) AS n FROM campaign_lobby_event WHERE kind='READY'")
                    .get(),
                ).toEqual({ n: 1 });
              },
              30000,
            );
            it('fences the Ready destination when browser trust is revoked during delivery', async () => {
              p.afterNextReadyResponse(() => p.revoke());
              await ready(true);
              expect(
                p.sent.some(
                  (m) =>
                    m.messageType === 'projection.snapshot' ||
                    m.messageType === 'command.result' ||
                    m.messageType === 'command.replay',
                ),
              ).toBe(false);
              expect(
                h.db
                  .prepare("SELECT count(*) AS n FROM campaign_lobby_event WHERE kind='READY'")
                  .get(),
              ).toEqual({ n: 1 });
              expect(
                readLocalAdmission(p.db, p.scope(), requestId)!.events.some(
                  (e) => e.payload.kind === 'READY_INTENT',
                ),
              ).toBe(true);
              expect(
                readLocalAdmission(p.db, p.scope(), requestId)!.events.some(
                  (e) => e.payload.kind === 'READY_ACK',
                ),
              ).toBe(false);
            }, 30000);
            it('cancels a confirmed Ready through the authenticated channel', async () => {
              await ready(true);
              expect(p.sent[0]?.messageType).toBe('command.result');
              expect(campaignLobbyPlayerProjectionValue(p.payload()).lobby.ready).toBe(true);
              const unready = await ready(false),
                original = p.sent[0];
              expect(original?.messageType).toBe('command.result');
              expect(campaignLobbyPlayerProjectionValue(p.payload()).lobby.ready).toBe(false);
              p.goOffline();
              await p.send(unready);
              expect(p.sent[0]).toEqual({
                ...original,
                messageType: 'command.replay',
                lifecycleState: 'IDEMPOTENT_REPLAY',
              });
              expect(campaignLobbyPlayerProjectionValue(p.payload()).lobby.ready).toBe(false);
              expect(p.payload()['pendingCommandIdOrNull']).toBeNull();
              expect(p.payload()['technicalSessionAvailable']).toBe(false);
            }, 30000);
          };
          const confirmedTimeCases = () => {
            describe('confirmed initial time', () => {
              let source: ReturnType<
                typeof campaignLobbyPlayerProjectionValue
              >['lobby']['selectedCopy'];
              beforeEach(async () => {
                gm.c.executableReview = [
                  ...(gm.c.executableReview ?? []),
                  'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
                  'UI-CMD-CAMPAIGN-START',
                ];
                // These are separate UI actions. Direct handler awaits can otherwise
                // starve the real peer's polling timers across the whole setup sequence.
                await gmNav('NET-021', 'NET-021::CTA::001');
                await nextEventLoopTurn();
                await gmNav('NET-017', 'NET-017::CTA::009');
                await nextEventLoopTurn();
                await gmNav('CMP-006', 'CMP-006::CTA::001');
                await nextEventLoopTurn();
                await gmNav('CMP-007', 'CMP-007::CTA::001');
                await nextEventLoopTurn();
                const view = await gm.runtime.project(gm.c);
                await gm.send({
                  messageType: 'command.request',
                  protocolVersion: 1,
                  commandKind: 'workflow-command',
                  role: 'gm',
                  commandId: randomUUID(),
                  workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
                  expectedRevisions: view.revisions,
                  payload: {
                    campaignId: h.campaignId,
                    expectedLobbySnapshotRevision:
                      view.base.roleFilteredPayload['lobbySnapshotRevision']!,
                    dayNumber: 2,
                    hour: 21,
                    minute: 7,
                  },
                });
                expect(gm.sent[0]?.messageType).toBe('command.result');
                await expect
                  .poll(
                    () =>
                      campaignLobbyPlayerProjectionValue(p.payload()).lobby
                        .initialCampaignTimeOrNull?.campaignTimestamp,
                    { timeout: 30000 },
                  )
                  .toBe(2707);

                source = campaignLobbyPlayerProjectionValue(p.payload()).lobby.selectedCopy;
              }, 60000);
              beforeEach(async () => {
                await ready(true);
                expect(p.sent[0]?.messageType).toBe('command.result');
              }, 30000);
              describe('immutable outgoing downloads across lifecycle mutations', () => {
                let channel: Awaited<ReturnType<typeof h.connect>>;
                let manifest: Extract<AdmissionPeerResponse, { outcome: 'MANIFEST' }>;
                let observation: ReturnType<typeof campaignLobbyPlayerProjectionValue>['lobby'];
                let binding: {
                  requestId: string;
                  technicalSessionId: string;
                  submitCommandId: string;
                };
                const rpc = async (command: Parameters<typeof encodeAdmissionPeerCommand>[0]) =>
                  decodeAdmissionPeerResponse(
                    await channel.call(encodeAdmissionPeerCommand(command)),
                    {
                      maxPublicationBytes: config.transfer.maxSubmitBodyBytes,
                      maxChunkBytes: config.transfer.maxChunkBytes,
                    },
                  );
                // The real browser polls while GM works; keep this raw test client alive too.
                const observeStatus = async () => {
                  const response = decodeCampaignConnectionPeerResponse(
                    await channel.call(
                      encodeCampaignConnectionPeerCommand({
                        schemaVersion: 1,
                        operation: 'CAMPAIGN_CONNECTION_READ',
                      }),
                    ),
                  );
                  expect(response.outcome).toBe('STATUS');
                };
                const beginDownload = async () => {
                  const response = await rpc({
                    schemaVersion: 1,
                    operation: 'ADMISSION_LOBBY_BEGIN',
                    ...binding,
                    admittedTabId: p.state().tabId,
                  });
                  expect(response.outcome, JSON.stringify(response)).toBe('MANIFEST');
                  if (response.outcome !== 'MANIFEST') throw Error('Expected own snapshot');
                  return response;
                };
                const download = async (saved: typeof manifest) => {
                  const chunks: Buffer[] = [];
                  for (let chunkIndex = 0; chunkIndex < saved.chunkCount; chunkIndex++) {
                    const response = await rpc({
                      schemaVersion: 1,
                      operation: 'ADMISSION_PUBLICATION_CHUNK',
                      ...binding,
                      transferId: saved.transferId,
                      publicationChecksum: saved.publicationChecksum,
                      chunkIndex,
                    });
                    if (response.outcome !== 'CHUNK') throw Error(JSON.stringify(response));
                    chunks.push(Buffer.from(response.bytesBase64, 'base64'));
                  }
                  const bytes = Buffer.concat(chunks);
                  expect(bytes.length).toBe(saved.byteLength);
                  expect(postSaveSha256(bytes)).toBe(saved.bodySha256);
                  return bytes.toString('utf8');
                };
                beforeEach(async () => {
                  observation = campaignLobbyPlayerProjectionValue(p.payload()).lobby;
                  const request = p.state().requestOrNull!;
                  binding = {
                    requestId: request.requestId,
                    technicalSessionId: request.technicalSessionId,
                    submitCommandId: request.submitCommandId,
                  };
                  p.disconnect();
                  channel = await h.connect(loadNetworkInstallation(p.db));
                  const recovered = decodeDeviceAdmissionPeerResponse(
                    await channel.call(
                      encodeDeviceAdmissionPeerCommand(
                        {
                          schemaVersion: 1,
                          operation: 'DEVICE_REQUEST_RECOVER',
                          ...binding,
                        },
                        {
                          maxSubmitBodyBytes: config.transfer.maxSubmitBodyBytes,
                          maxWitnessBytes: config.transfer.maxWitnessBytes,
                          maxChunkBytes: config.transfer.maxChunkBytes,
                        },
                      ),
                    ),
                  );
                  expect(recovered.outcome).toBe('ACK');
                  manifest = await beginDownload();
                  expect(h.runtime.trackedTransferCount(h.campaignId)).toBe(1);
                  expect(h.runtime.operationCounts(h.campaignId).pendingOperationCount).toBe(0);
                }, 30000);
                beforeEach(async () => {
                  const view = await gm.runtime.project(gm.c);
                  await gm.send({
                    messageType: 'command.request',
                    protocolVersion: 1,
                    commandKind: 'workflow-command',
                    role: 'gm',
                    commandId: randomUUID(),
                    workflowCommandId: 'UI-CMD-CAMPAIGN-START',
                    expectedRevisions: view.revisions,
                    payload: {
                      campaignId: h.campaignId,
                      expectedLobbySnapshotRevision:
                        view.base.roleFilteredPayload['lobbySnapshotRevision']!,
                      expectedReadinessRevision:
                        view.base.roleFilteredPayload['readinessRevision']!,
                    },
                  });
                  expect(gm.sent[0], JSON.stringify(gm.sent)).toMatchObject({
                    messageType: 'command.result',
                  });
                  await observeStatus();
                  gm.c.executableReview = [
                    ...(gm.c.executableReview ?? []),
                    ...CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
                  ];
                  await gmNav('GM-001', 'GM-001::CTA::013');
                  await observeStatus();
                  await gmNav('CMP-007', 'CMP-007::CTA::003');
                  await observeStatus();
                  expect(h.runtime.trackedTransferCount(h.campaignId)).toBe(1);
                }, 30000);
                it('starts and pauses while retaining old snapshot bytes and publishes a newer current snapshot', async () => {
                  await gmNav('CMP-008', 'CMP-008::CTA::004');
                  await observeStatus();
                  const current = lifecycleProjection(await gm.runtime.project(gm.c));
                  expect(current.safeBoundary).toBe(true);
                  await gm.send(
                    campaignLifecycleGmRequest(current, 'CMP-016::CTA::002', randomUUID(), {
                      reason: 'Пауза во время скачивания',
                    }),
                  );
                  expect(gm.sent[0], JSON.stringify(gm.sent)).toMatchObject({
                    messageType: 'command.result',
                  });
                  await observeStatus();
                  expect(await download(manifest)).toBe(canonicalPostSaveJson(observation));
                  expect(h.runtime.trackedTransferCount(h.campaignId)).toBe(0);
                  const fresh = await beginDownload();
                  expect(fresh.campaignRevision).toBeGreaterThan(manifest.campaignRevision);
                  expect(fresh.bodySha256).not.toBe(manifest.bodySha256);
                  expect(JSON.parse(await download(fresh))).toMatchObject({
                    campaignStarted: true,
                    campaignRevision: fresh.campaignRevision,
                  });
                });
                it('disconnects an unfinished outgoing download, retains copies and bindings, and fences the old channel', async () => {
                  await gmNav('CMP-008', 'CMP-008::CTA::007');
                  const copies = h.db.prepare('SELECT * FROM campaign_character_copy').all();
                  const accepted = h.db
                    .prepare('SELECT * FROM campaign_admission_player_decision')
                    .all();
                  const current = lifecycleProjection(await gm.runtime.project(gm.c));
                  await gm.send(
                    campaignLifecycleGmRequest(current, 'NET-023::CTA::002', randomUUID(), {
                      deviceId: loadNetworkInstallation(p.db).ownerDeviceId,
                      selectedControllerSeatOrNull: null,
                      reason: 'Отключение во время скачивания',
                    }),
                  );
                  expect(gm.sent[0], JSON.stringify(gm.sent)).toMatchObject({
                    messageType: 'command.result',
                  });
                  await expect.poll(() => channel.closed).toBe(true);
                  expect(h.runtime.trackedTransferCount(h.campaignId)).toBe(0);
                  expect(h.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual(
                    copies,
                  );
                  expect(
                    h.db.prepare('SELECT * FROM campaign_admission_player_decision').all(),
                  ).toEqual(accepted);
                  await expect(download(manifest)).rejects.toThrow();
                  channel = await h.connect(loadNetworkInstallation(p.db));
                  await expect(beginDownload()).rejects.toThrow();
                });
              });
              describe('late pending request after Start', () => {
                let waiting: Awaited<ReturnType<typeof client>>;
                beforeEach(async () => {
                  waiting = await client(true);
                }, 30000);
                beforeEach(async () => {
                  await waiting.nav('APP-002::CTA::003', 'APP-002');
                  await waiting.nav('NET-001::CTA::001');
                  await waiting.replace('ADDRESS', {
                    addressOrQrPayload: campaignQrPayload('127.0.0.1', h.port, h.campaignId),
                  });
                }, 30000);
                beforeEach(async () => {
                  await waiting.command('UI-CMD-CONNECTION-OPEN', {
                    attemptId: waiting.state().plannedAttemptIdOrNull,
                    addressOrQrPayload: waiting.state().addressOrQrPayload,
                    selectedCampaignIdOrNull: null,
                  });
                }, 30000);
                beforeEach(async () => {
                  await submitConnectedPlayer(waiting, h);
                  expect(waiting.payload()['requestStatus']).toBe('PENDING');
                }, 30000);
                it('cancels over the existing session and publishes current HOSTING without fresh admission controls', async () => {
                  const view = await gm.runtime.project(gm.c);
                  await gm.send({
                    messageType: 'command.request',
                    protocolVersion: 1,
                    commandKind: 'workflow-command',
                    role: 'gm',
                    commandId: randomUUID(),
                    workflowCommandId: 'UI-CMD-CAMPAIGN-START',
                    expectedRevisions: view.revisions,
                    payload: {
                      campaignId: h.campaignId,
                      expectedLobbySnapshotRevision:
                        view.base.roleFilteredPayload['lobbySnapshotRevision']!,
                      expectedReadinessRevision:
                        view.base.roleFilteredPayload['readinessRevision']!,
                    },
                  });
                  expect(gm.sent[0]?.messageType).toBe('command.result');
                  await waiting.replace('CANCEL_REASON', { cancelReason: 'Withdraw after Start' });
                  const request = waiting.state().requestOrNull!;
                  const command = await waiting.command('UI-CMD-DEVICE-REQUEST-CANCEL', {
                    requestId: request.requestId,
                    technicalSessionId: request.technicalSessionId,
                    requestRevision: request.requestRevision,
                    reason: 'Withdraw after Start',
                  });
                  expect(waiting.sent[0]?.messageType).toBe('command.result');
                  const receipt = waiting.sent[0];
                  expect(waiting.payload()['campaignStatus']).toBe('HOSTING');
                  const destination = waiting.sent.findLast(
                    (m) => m.messageType === 'projection.snapshot',
                  );
                  expect(destination).toMatchObject({
                    presentation: { base: { formId: 'NET-003', availableActionKeys: [] } },
                  });
                  await waiting.restart([command.commandId]);
                  expect(waiting.sent[0]).toEqual({
                    ...receipt,
                    messageType: 'command.replay',
                    lifecycleState: 'IDEMPOTENT_REPLAY',
                  });
                  expect(waiting.payload()['campaignStatus']).toBe('HOSTING');
                  expect(
                    h.db.prepare('SELECT count(*) AS n FROM campaign_peace_scene').get(),
                  ).toEqual({ n: 1 });
                }, 30000);
              });
              describe('#174 real started campaign', () => {
                beforeEach(async () => {
                  const view = await gm.runtime.project(gm.c);
                  await gm.send({
                    messageType: 'command.request',
                    protocolVersion: 1,
                    commandKind: 'workflow-command',
                    role: 'gm',
                    commandId: randomUUID(),
                    workflowCommandId: 'UI-CMD-CAMPAIGN-START',
                    expectedRevisions: view.revisions,
                    payload: {
                      campaignId: h.campaignId,
                      expectedLobbySnapshotRevision:
                        view.base.roleFilteredPayload['lobbySnapshotRevision']!,
                      expectedReadinessRevision:
                        view.base.roleFilteredPayload['readinessRevision']!,
                    },
                  });
                  expect(gm.sent[0], JSON.stringify(gm.sent)).toMatchObject({
                    messageType: 'command.result',
                  });
                  gm.c.executableReview = [
                    ...(gm.c.executableReview ?? []),
                    ...CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
                  ];
                  await gmNav('GM-001', 'GM-001::CTA::013');
                  await gmNav('CMP-007', 'CMP-007::CTA::003');
                  await gmNav('CMP-008', 'CMP-008::CTA::004');
                });
                describe('confirmed disconnect in PEACE', () => {
                  const watch = (): CampaignPeerControlV3Message => ({
                    messageType: 'network.peer-control',
                    protocolVersion: 3,
                    requestId: randomUUID(),
                    contextId: p.c.contextId!,
                    networkScopeId: p.scope().networkScopeId,
                    expectedRevisions: vector(p.state()),
                    operation: 'WATCH',
                    expectedConnectionRevision: null,
                    commandIdOrNull: null,
                    endpointOrNull: null,
                  });
                  beforeEach(async () => {
                    let peaceArrived!: () => void, disconnected!: () => void;
                    const peace = new Promise<void>((resolve) => {
                      peaceArrived = resolve;
                    });
                    const closed = new Promise<void>((resolve) => {
                      disconnected = resolve;
                    });
                    const push = p.sent.push.bind(p.sent);
                    const publication = vi
                      .spyOn(p.sent, 'push')
                      .mockImplementation((...messages) => {
                        const size = push(...messages);
                        if (
                          messages.some(
                            (message) =>
                              message.messageType === 'projection.snapshot' &&
                              message.protocolVersion === 2 &&
                              message.presentation.base.roleFilteredPayload['projectionVariant'] ===
                                'PEACE_SNAPSHOT',
                          )
                        )
                          peaceArrived();
                        if (
                          messages.some(
                            (message) =>
                              message.messageType === 'network.peer-state' &&
                              message.connectionState === 'DISCONNECTED' &&
                              message.statusOrNull?.disconnectOrNull?.retryReceiptOrNull === null,
                          )
                        )
                          disconnected();
                        return size;
                      });
                    try {
                      // Observe the real publication under the existing hook deadline.
                      if (p.payload()['projectionVariant'] !== 'PEACE_SNAPSHOT') await peace;

                      await p.send(watch());

                      await gmNav('CMP-016', 'CMP-016::CTA::004');
                      await gmNav('CMP-008', 'CMP-008::CTA::007');
                      await gm.send(
                        campaignLifecycleGmRequest(
                          lifecycleProjection(await gm.runtime.project(gm.c)),
                          'NET-023::CTA::002',
                          randomUUID(),
                          {
                            deviceId: p.scope().ownerDeviceId,
                            selectedControllerSeatOrNull: null,
                            reason: 'Только подтверждённый лист до повтора',
                          },
                        ),
                      );
                      expect(gm.sent[0]).toMatchObject({ messageType: 'command.result' });

                      await closed;
                    } finally {
                      publication.mockRestore();
                    }
                  }, 60000);
                  it('keeps PEACE content unchanged and polls status without gated lobby downloads', async () => {
                    const peer = p.peerForTest,
                      read = peer.readConnection.bind(peer);
                    const admission = readLocalAdmission(p.db, p.scope(), requestId),
                      copies = h.db.prepare('SELECT * FROM campaign_character_copy').all();
                    let observed!: () => void;
                    const nextStatus = new Promise<void>((resolve) => {
                      observed = resolve;
                    });
                    const reads = vi
                      .spyOn(peer, 'readConnection')
                      .mockImplementation(async (...args) => {
                        const status = await read(...args);
                        if (status.disconnectOrNull?.retryReceiptOrNull === null) observed();
                        return status;
                      });
                    const checks = vi.spyOn(peer, 'checkLobbyObservation'),
                      downloads = vi.spyOn(peer, 'fetchAdmission'),
                      recovery = vi.spyOn(peer, 'recover');
                    try {
                      await nextStatus;
                      await p.send(watch());
                      expect(checks).not.toHaveBeenCalled();
                      expect(downloads).not.toHaveBeenCalled();
                      expect(recovery).not.toHaveBeenCalled();
                      expect(readLocalAdmission(p.db, p.scope(), requestId)).toEqual(admission);
                      expect(h.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual(
                        copies,
                      );
                      expect(
                        h.db.prepare('SELECT COUNT(*) AS n FROM campaign_disconnect_retry').get(),
                      ).toEqual({ n: 0 });
                    } finally {
                      reads.mockRestore();
                      checks.mockRestore();
                      downloads.mockRestore();
                      recovery.mockRestore();
                    }
                  });
                });
                it('pauses and resumes the same PEACE scene through CMP-016 and replays Pause after Resume', async () => {
                  const view = await gm.runtime.project(gm.c),
                    p = lifecycleProjection(view),
                    scene = h.db.prepare('SELECT * FROM campaign_peace_scene').all(),
                    copies = h.db.prepare('SELECT * FROM campaign_character_copy').all();
                  const pause = campaignLifecycleGmRequest(p, 'CMP-016::CTA::002', randomUUID(), {
                    reason: 'Перерыв за столом',
                  });
                  await gm.send(pause);
                  expect(gm.sent[0], JSON.stringify(gm.sent)).toMatchObject({
                    messageType: 'command.result',
                  });
                  const original = structuredClone(gm.sent[0]);
                  expect(h.header().status).toBe('PAUSED');
                  expect((await gm.runtime.project(gm.c)).base).toMatchObject({
                    formId: 'CMP-007',
                    roleFilteredPayload: {
                      campaignStatus: 'PAUSED',
                      panelVariant: 'STARTED_PEACE',
                    },
                  });
                  await gmNav('CMP-007', 'CMP-007::CTA::003');
                  expect((await gm.runtime.project(gm.c)).base.availableActionKeys).not.toContain(
                    'CMP-008::CTA::005',
                  );
                  await gmNav('CMP-008', 'CMP-008::CTA::004');
                  const paused = lifecycleProjection(await gm.runtime.project(gm.c));
                  expect(paused).toMatchObject({
                    campaignStatus: 'PAUSED',
                    pauseReasonOrNull: 'Перерыв за столом',
                    clockMode: 'STOPPED',
                  });
                  await gm.send(
                    campaignLifecycleGmRequest(paused, 'CMP-016::CTA::003', randomUUID(), {
                      reason: 'Продолжаем сессию',
                    }),
                  );
                  expect(gm.sent[0], JSON.stringify(gm.sent)).toMatchObject({
                    messageType: 'command.result',
                  });
                  expect(h.header().status).toBe('HOSTING');
                  const after = h.db.serialize();
                  await gm.send(pause);
                  expect(gm.sent[0]).toEqual({
                    ...original,
                    messageType: 'command.replay',
                    lifecycleState: 'IDEMPOTENT_REPLAY',
                  });
                  expect(h.db.serialize().equals(after)).toBe(true);
                  expect(h.db.prepare('SELECT * FROM campaign_peace_scene').all()).toEqual(scene);
                  expect(h.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual(
                    copies,
                  );
                });
              });
              it('enters one stopped PEACE scene and resumes the same owner sheet', async () => {
                const view = await gm.runtime.project(gm.c);
                const start = {
                  messageType: 'command.request',
                  protocolVersion: 1,
                  commandKind: 'workflow-command',
                  role: 'gm',
                  commandId: randomUUID(),
                  workflowCommandId: 'UI-CMD-CAMPAIGN-START',
                  expectedRevisions: view.revisions,
                  payload: {
                    campaignId: h.campaignId,
                    expectedLobbySnapshotRevision:
                      view.base.roleFilteredPayload['lobbySnapshotRevision']!,
                    expectedReadinessRevision: view.base.roleFilteredPayload['readinessRevision']!,
                  },
                } as const;
                await gm.send(start);
                expect(gm.sent[0]?.messageType).toBe('command.result');
                const original = gm.sent[0];
                await expect
                  .poll(() => p.payload()['projectionVariant'], { timeout: 10000 })
                  .toBe('PEACE_SNAPSHOT');
                const peace = campaignPeaceProjectionValue(p.payload());
                expect(peace).toMatchObject({
                  campaignCharacterId: source.campaignCharacterId,
                  mechanicalSheet: source.sheet,
                  groupId: source.groupId,
                  location: source.location,
                  effectiveController: source.controller,
                  campaignTimestamp: 2707,
                  clockMode: 'STOPPED',
                  dayPhase: 'NIGHT',
                  ownMarkerVisibility: 'UNKNOWN',
                  markerReason: 'NOT_SET',
                });
                for (const key of [
                  'combatId',
                  'combatActor',
                  'turn',
                  'reactionWindow',
                  'markerRevision',
                  'coordinates',
                ])
                  expect(Object.hasOwn(peace, key)).toBe(false);
                await p.restart();
                expect(campaignPeaceProjectionValue(p.payload())).toMatchObject({
                  sceneId: peace.sceneId,
                  campaignTimestamp: 2707,
                  mechanicalSheet: source.sheet,
                });
                await gm.send(start);
                expect(gm.sent[0]).toEqual({
                  ...original,
                  messageType: 'command.replay',
                  lifecycleState: 'IDEMPOTENT_REPLAY',
                });
                expect(p.db.prepare('SELECT * FROM local_character').all()).toEqual(sourceRows);
              }, 30000);
            });
          };
          register({ ready: readyCases, peace: confirmedTimeCases });
        }
      });
  };
  const results = () => {
    if (scenario !== 'MIXED') {
      it('delivers the complete owner result, preserves source and recovers original decisions after SQLite reopen', async () => {
        expect(p.sent.at(-1), JSON.stringify({ sent: p.sent, errors: p.peerErrors })).toMatchObject(
          {
            presentation: { base: { formId: scenario === 'REJECT' ? 'NET-007' : 'NET-027' } },
          },
        );
        let owner = p.payload();
        admissionOwnerProjectionValue(scenario === 'REJECT' ? 'NET-007' : 'NET-027', owner);
        expect(JSON.stringify(owner)).not.toMatch(
          /privateReplayWitness|availabilityTrace|authoritativeGmActorId/,
        );
        expect(p.db.prepare('SELECT * FROM local_character').all()).toEqual(sourceRows);
        if (scenario === 'REJECT') {
          expect(owner['gmReasonOrNull']).toBe('Нужно другое снаряжение');
          expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_character_copy').get()).toEqual({
            n: 0,
          });
          const menu = {
            messageType: 'navigation.form-action',
            protocolVersion: 2,
            navigationRequestId: randomUUID(),
            sourceFormId: 'NET-007',
            actionKey: 'NET-007::CTA::003',
            expectedProjectionRevision: p.state().projectionRevision,
          } as const;
          p.loseNextExit();
          await expect(p.send(menu)).rejects.toThrow();
          expect(
            p.sent.some((message) => message.messageType === 'navigation.form-action.refusal'),
          ).toBe(false);
          await p.send(menu);
          expect(p.sent.at(-1)).toMatchObject({ presentation: { base: { formId: 'APP-002' } } });
          const returned = p.db.serialize();
          await p.send(menu);
          expect(p.sent.at(-1)).toMatchObject({ presentation: { base: { formId: 'APP-002' } } });
          expect(p.db.serialize().equals(returned)).toBe(true);
          await p.send({
            ...menu,
            expectedProjectionRevision: menu.expectedProjectionRevision + 1,
          });
          expect(p.sent.at(-1)?.messageType).toBe('navigation.form-action.refusal');
          expect(p.db.serialize().equals(returned)).toBe(true);
          return;
        }
        const command = {
          messageType: 'command.request',
          protocolVersion: 1,
          commandKind: 'workflow-command',
          role: 'player',
          commandId: randomUUID(),
          workflowCommandId: 'UI-CMD-ADMISSION-PLAYER-DECIDE',
          expectedRevisions: vector(p.state()),
          payload: {
            contextId: p.c.contextId!,
            networkScopeId: p.scope().networkScopeId,
            campaignId: h.campaignId,
            requestId,
            admissionBatchId: owner['admissionBatchId']!,
            proposalRevision: owner['proposalRevision']!,
            proposalChecksum: owner['proposalChecksum']!,
            expectedCampaignRevision: owner['campaignRevisionOrNull']!,
            decision: scenario === 'DECLINE' ? 'DECLINE' : 'ACCEPT',
          },
        } as const;
        await p.send(command);
        expect(p.sent[0]).toMatchObject({ messageType: 'command.result' });
        const original = structuredClone(p.sent[0]);
        owner = p.payload();
        if (scenario === 'DECLINE') admissionOwnerProjectionValue('NET-007', owner);
        else campaignLobbyPlayerProjectionValue(owner);
        expect(owner['ownCampaignCopies']).toMatchObject([
          {
            lifecycleState:
              scenario === 'DECLINE'
                ? 'DECLINED'
                : scenario === 'ACCEPT_WITH_BLOCKERS'
                  ? 'PROPOSED'
                  : 'ACTIVE',
            occupiesCampaignPlace: scenario !== 'DECLINE',
          },
        ]);
        const saved = readLocalAdmission(p.db, p.scope(), requestId)!;
        expect(saved.pendingDecisionOrNull).toBeNull();
        await p.restart([command.commandId]);
        expect(p.sent[0]).toEqual({
          ...original,
          messageType: 'command.replay',
          lifecycleState: 'IDEMPOTENT_REPLAY',
        });
        expect(readLocalAdmission(p.db, p.scope(), requestId)).toEqual(saved);
        expect(p.db.prepare('SELECT * FROM local_character').all()).toEqual(sourceRows);
        await p.send(command);
        expect(p.sent[0]).toEqual({
          ...original,
          messageType: 'command.replay',
          lifecycleState: 'IDEMPOTENT_REPLAY',
        });
        expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_character_copy').get()).toEqual({
          n: 1,
        });
      }, 30000);
      if (scenario === 'ACCEPT')
        it('recovers a committed ACK after projection construction fails without publishing a false refusal', async () => {
          const owner = p.payload();
          const command = {
            messageType: 'command.request',
            protocolVersion: 1,
            commandKind: 'workflow-command',
            role: 'player',
            commandId: randomUUID(),
            workflowCommandId: 'UI-CMD-ADMISSION-PLAYER-DECIDE',
            expectedRevisions: vector(p.state()),
            payload: {
              contextId: p.c.contextId!,
              networkScopeId: p.scope().networkScopeId,
              campaignId: h.campaignId,
              requestId,
              admissionBatchId: owner['admissionBatchId']!,
              proposalRevision: owner['proposalRevision']!,
              proposalChecksum: owner['proposalChecksum']!,
              expectedCampaignRevision: owner['campaignRevisionOrNull']!,
              decision: 'ACCEPT',
            },
          } as const;
          p.loseNextOwnerProjection();
          await expect(p.send(command)).rejects.toThrow(
            'Network publication failed after durable acknowledgement',
          );
          expect(p.sent).toEqual([]);
          const saved = readLocalAdmission(p.db, p.scope(), requestId)!;
          expect(saved.receiptOrNull?.commandId).toBe(command.commandId);
          expect(saved.pendingDecisionOrNull).toBeNull();
          await p.restart([command.commandId]);
          expect(p.sent[0]).toMatchObject({
            messageType: 'command.replay',
            receipt: {
              commandId: command.commandId,
              result: { remoteReceipt: saved.receiptOrNull },
            },
          });
          expect(p.sent.at(-1)).toMatchObject({ presentation: { base: { formId: 'NET-006' } } });
          expect(p.db.prepare('SELECT * FROM local_character').all()).toEqual(sourceRows);
          expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_character_copy').get()).toEqual({
            n: 1,
          });
        }, 30000);
      if (scenario === 'DECLINE')
        describe('lost decision delivery after a restored proposal', () => {
          it('replays a lost DECLINE receipt before the menu reached by another own context', async () => {
            const source = p.payload(),
              originalScope = p.scope().networkScopeId;
            const command = {
              messageType: 'command.request',
              protocolVersion: 1,
              commandKind: 'workflow-command',
              role: 'player',
              commandId: randomUUID(),
              workflowCommandId: 'UI-CMD-ADMISSION-PLAYER-DECIDE',
              expectedRevisions: vector(p.state()),
              payload: {
                contextId: p.c.contextId!,
                networkScopeId: originalScope,
                campaignId: h.campaignId,
                requestId,
                admissionBatchId: source['admissionBatchId']!,
                proposalRevision: source['proposalRevision']!,
                proposalChecksum: source['proposalChecksum']!,
                expectedCampaignRevision: source['campaignRevisionOrNull']!,
                decision: 'DECLINE',
              },
            } as const;
            p.loseNextOwnerProjection();
            await expect(p.send(command)).rejects.toThrow(
              'Network publication failed after durable acknowledgement',
            );
            expect(p.sent).toEqual([]);
            const saved = readLocalAdmission(p.db, p.scope(), requestId)!;
            expect(saved.receiptOrNull?.decision).toBe('DECLINE');
            const other = await p.additionalOwnerView();
            await other.send({
              messageType: 'navigation.form-action',
              protocolVersion: 2,
              navigationRequestId: randomUUID(),
              sourceFormId: 'NET-007',
              actionKey: 'NET-007::CTA::003',
              expectedProjectionRevision: p.state().projectionRevision,
            });
            expect(other.messages.at(-1)).toMatchObject({
              presentation: { base: { formId: 'APP-002' } },
            });
            await p.restart([command.commandId], originalScope);
            expect(p.sent[0]).toMatchObject({
              messageType: 'command.replay',
              receipt: {
                commandId: command.commandId,
                result: { remoteReceipt: saved.receiptOrNull },
              },
            });
            expect(p.sent.at(-1)).toMatchObject({ presentation: { base: { formId: 'APP-002' } } });
            expect(p.sent.some((message) => message.messageType === 'command.refusal')).toBe(false);
            expect(p.db.prepare('SELECT * FROM local_character').all()).toEqual(sourceRows);
            expect(
              h.db.prepare('SELECT lifecycle_state FROM campaign_character_copy').all(),
            ).toEqual([{ lifecycle_state: 'DECLINED' }]);
          }, 30000);
        });
      if (scenario === 'ACCEPT')
        it('publishes a fenced absence only to a connection that observed the pending decision', async () => {
          const other = await p.additionalOwnerView();
          const source = p.payload();
          const command = {
            messageType: 'command.request',
            protocolVersion: 1,
            commandKind: 'workflow-command',
            role: 'player',
            commandId: randomUUID(),
            workflowCommandId: 'UI-CMD-ADMISSION-PLAYER-DECIDE',
            expectedRevisions: vector(p.state()),
            payload: {
              contextId: p.c.contextId!,
              networkScopeId: p.scope().networkScopeId,
              campaignId: h.campaignId,
              requestId,
              admissionBatchId: source['admissionBatchId']!,
              proposalRevision: source['proposalRevision']!,
              proposalChecksum: source['proposalChecksum']!,
              expectedCampaignRevision: source['campaignRevisionOrNull']!,
              decision: 'ACCEPT',
            },
          } as const;
          p.loseNextAdmissionDelivery();
          await p.send(command);
          expect(p.payload()['pendingCommandIdOrNull']).toBe(command.commandId);
          expect(p.sent.some((message) => message.messageType === 'command.refusal')).toBe(false);
          await expect
            .poll(
              () =>
                p.sent.some(
                  (message) =>
                    message.messageType === 'command.refusal' &&
                    message.commandId === command.commandId,
                ),
              { timeout: 10000 },
            )
            .toBe(true);
          const absence = readLocalAdmission(p.db, p.scope(), requestId)!;
          expect(absence.pendingDecisionOrNull).toBeNull();
          expect(absence.lastAbsenceOrNull?.commandId).toBe(command.commandId);
          expect(absence.receiptOrNull).toBeNull();
          expect(p.payload()['pendingCommandIdOrNull']).toBeNull();
          expect(other.messages.some((message) => message.messageType === 'command.refusal')).toBe(
            false,
          );
          expect(h.db.prepare('SELECT lifecycle_state FROM campaign_character_copy').all()).toEqual(
            [{ lifecycle_state: 'PROPOSED' }],
          );
        }, 30000);
      if (scenario === 'ACCEPT')
        it('publishes a recovered ACK when the subsequent capacity read is unavailable', async () => {
          const source = p.payload();
          const command = {
            messageType: 'command.request',
            protocolVersion: 1,
            commandKind: 'workflow-command',
            role: 'player',
            commandId: randomUUID(),
            workflowCommandId: 'UI-CMD-ADMISSION-PLAYER-DECIDE',
            expectedRevisions: vector(p.state()),
            payload: {
              contextId: p.c.contextId!,
              networkScopeId: p.scope().networkScopeId,
              campaignId: h.campaignId,
              requestId,
              admissionBatchId: source['admissionBatchId']!,
              proposalRevision: source['proposalRevision']!,
              proposalChecksum: source['proposalChecksum']!,
              expectedCampaignRevision: source['campaignRevisionOrNull']!,
              decision: 'ACCEPT',
            },
          } as const;
          p.loseNextAdmissionResponseThenCapacity();
          p.holdDecisionRecovery();
          await p.send(command);
          expect(p.payload()['pendingCommandIdOrNull']).toBe(command.commandId);
          const passive = await p.additionalOwnerView();
          expect(passive.messages.at(-1)).toMatchObject({
            presentation: {
              base: { roleFilteredPayload: { pendingCommandIdOrNull: command.commandId } },
            },
          });
          p.releaseOwnerRecovery();
          const recovered = () =>
            p.sent.find(
              (message) =>
                message.messageType === 'projection.snapshot' &&
                message.protocolVersion === 2 &&
                message.presentation.base.formId === 'NET-006',
            );
          await expect.poll(() => recovered() !== undefined, { timeout: 10000 }).toBe(true);
          expect(recovered()).toMatchObject({
            presentation: {
              base: {
                availableActionKeys: ['NET-006::CTA::001', 'NET-006::CTA::003'],
                roleFilteredPayload: {
                  projectionVariant: 'LOBBY_SNAPSHOT',
                  pendingCommandIdOrNull: null,
                },
              },
            },
          });
          const receipt = readLocalAdmission(p.db, p.scope(), requestId)!.receiptOrNull!;
          expect(receipt).toMatchObject({ commandId: command.commandId, decision: 'ACCEPT' });
          const replayIndex = p.sent.findIndex(
            (m) => m.messageType === 'command.replay' && m.receipt.commandId === command.commandId,
          );
          expect(replayIndex).toBeGreaterThanOrEqual(0);
          expect(replayIndex).toBeLessThan(p.sent.indexOf(recovered()!));
          await expect
            .poll(
              () => {
                const latest = passive.messages.findLast(
                  (m) => m.messageType === 'projection.snapshot' && m.protocolVersion === 2,
                );
                return latest?.messageType === 'projection.snapshot' && latest.protocolVersion === 2
                  ? latest.presentation.base.roleFilteredPayload['pendingCommandIdOrNull']
                  : undefined;
              },
              { timeout: 10000 },
            )
            .toBeNull();
          expect(
            passive.messages.some((m) =>
              ['command.result', 'command.replay', 'command.refusal'].includes(m.messageType),
            ),
          ).toBe(false);
          expect(p.sent[replayIndex]).toMatchObject({
            receipt: { result: { remoteReceipt: receipt } },
          });
          const destination = recovered();
          if (
            destination?.messageType !== 'projection.snapshot' ||
            destination.protocolVersion !== 2
          )
            throw Error('Missing recovered lobby');
          const payload = destination.presentation.base.roleFilteredPayload;
          expect(
            campaignLobbyPlayerProjectionValue(payload).lobby.selectedCopy.lifecycleState,
          ).toBe('ACTIVE');
          expect(payload).not.toHaveProperty('receiptOrNull');
          expect(payload).not.toHaveProperty('capacityRecheck');
          expect(p.sent.some((message) => message.messageType === 'command.refusal')).toBe(false);
          expect(h.db.prepare('SELECT lifecycle_state FROM campaign_character_copy').all()).toEqual(
            [{ lifecycle_state: 'ACTIVE' }],
          );
        }, 30000);
    }
  };
  return {
    preparedTabs,
    ready: () => registerReadyAndPeace(({ ready }) => ready()),
    peace: () => registerReadyAndPeace(({ peace }) => peace()),
    results,
  };
}
function registerAdmissionScenarios(
  scenarios: readonly AdmissionScenario[],
  registerCases: (suite: ReturnType<typeof createAdmissionScenario>) => void,
) {
  describe.each(scenarios)('actual final admission owner runtime %s', (scenario) => {
    registerCases(createAdmissionScenario(scenario));
  });
}
export function registerAcceptedReadyAndResults() {
  registerAdmissionScenarios(['ACCEPT'], (suite) => {
    suite.ready();
    suite.results();
  });
}
export function registerOtherAdmissionResults() {
  registerAdmissionScenarios(['ACCEPT_WITH_BLOCKERS', 'DECLINE', 'REJECT', 'MIXED'], (suite) => {
    suite.preparedTabs();
    suite.ready();
    suite.results();
  });
}
export function registerStartedPeace() {
  registerAdmissionScenarios(['ACCEPT'], (suite) => suite.peace());
}

const gmReviewCases = () => {
  describe('final admission of an incomplete submitted batch', () => {
    let h: Awaited<ReturnType<typeof host>>,
      batch: Awaited<ReturnType<typeof submittedPlayer>>['batch'],
      gm: ReturnType<typeof gmClient>;
    beforeEach(async () => {
      h = await host();
    });
    beforeEach(async () => {
      ({ batch } = await submittedPlayer(h));
    });
    it('opens a real admission review and rejects the incomplete batch with stable receipts', async () => {
      gm = gmClient(h);
      gm.c.executableReview = [
        ...NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS,
        ...CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
        'UI-CMD-ADMISSION-REVIEW-OPEN',
        'UI-CMD-ADMISSION-GM-ACCEPT',
        'UI-CMD-ADMISSION-GM-REJECT',
        'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
      ];
      await gm.nav();
      const selection = {
        messageType: 'network.gm-request-draft.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        scope: {
          gmLocalContextId: h.gmLocalContextId,
          campaignId: h.campaignId,
          sourceFormId: 'NET-017',
        },
        expectedRevisions: vector(gm.view()),
        expectedRequestQueueRevision: gm.view().requestQueueRevision,
        values: { selectedRequestIdOrNull: batch.requestId, decisionReason: '' },
      } as const;
      const revokeAfterCommit = async (
        message: LocalNetworkClientMessage,
        table: 'gm_request_queue_event' | 'gm_admission_view_event',
        id: string,
      ) => {
        let revoked = false;
        const trust = vi.spyOn(gm.c, 'trusted').mockImplementation(() => {
          if (h.db.prepare('SELECT 1 FROM ' + table + ' WHERE event_id=?').get(id) !== undefined)
            queueMicrotask(() => {
              revoked = true;
            });
          return !revoked;
        });
        try {
          await expect(gm.send(message)).rejects.toThrow();
          expect(revoked).toBe(true);
          expect(gm.sent).toEqual([]);
          expect(
            h.db.prepare('SELECT COUNT(*) AS n FROM ' + table + ' WHERE event_id=?').get(id),
          ).toEqual({ n: 1 });
        } finally {
          trust.mockRestore();
        }
      };
      await revokeAfterCommit(selection, 'gm_request_queue_event', selection.draftUpdateId);
      await gm.send(selection);
      const selectedResult = structuredClone(gm.sent[0]!);
      expect(selectedResult.messageType).toBe('network.gm-request-draft.result');
      if (selectedResult.protocolVersion !== 3) throw Error('Missing GM draft result');
      expect(encodeHostMessageV3(selectedResult, vocabulary).ok).toBe(true);
      expect(selectedResult).toMatchObject({
        presentation: {
          base: {
            roleFilteredPayload: {
              currentCampaignLifecycle: { campaignId: h.campaignId, contextId: h.gmLocalContextId },
            },
          },
        },
      });
      await gm.send({
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        role: 'gm',
        commandId: randomUUID(),
        workflowCommandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
        expectedRevisions: vector(gm.view()),
        payload: { campaignId: h.campaignId, requestId: batch.requestId, requestRevision: 0 },
      });
      expect(gm.sent[0]).toMatchObject({ messageType: 'command.result' });
      const opening = {
        messageType: 'command.request' as const,
        protocolVersion: 1 as const,
        commandKind: 'workflow-command' as const,
        role: 'gm' as const,
        commandId: randomUUID(),
        workflowCommandId: 'UI-CMD-ADMISSION-REVIEW-OPEN' as const,
        expectedRevisions: vector(gm.view()),
        payload: { campaignId: h.campaignId, requestId: batch.requestId, requestRevision: 1 },
      };
      await gm.send(opening);
      expect(gm.sent[0]).toMatchObject({ messageType: 'command.result' });
      expect(gm.sent[1]).toMatchObject({ presentation: { base: { formId: 'NET-018' } } });
      const originalReceipt = structuredClone(gm.sent[0]!);
      expect(gm.runtime.receipt(gm.c, opening.commandId)).toEqual(
        'receipt' in originalReceipt ? originalReceipt.receipt : null,
      );
      const navigate = async (
        sourceFormId: FormActionIntentV2Message['sourceFormId'],
        actionKey: FormActionIntentV2Message['actionKey'],
      ) => {
        const p = await gm.runtime.project(gm.c);
        await gm.send({
          messageType: 'navigation.form-action',
          protocolVersion: 2,
          navigationRequestId: randomUUID(),
          sourceFormId,
          actionKey,
          expectedProjectionRevision: p.revisions.projectionRevision,
        });
        expect(gm.sent[0]).toMatchObject({ messageType: 'projection.snapshot' });
      };
      await navigate('NET-018', 'NET-018::CTA::004');
      const incomplete = await gm.runtime.project(gm.c);
      expect(incomplete.layers?.at(-1)).toMatchObject({
        formId: 'NET-021',
        roleFilteredPayload: { allRequiredFieldsValid: false },
      });
      const beforeQueueReplay = h.db.serialize();
      await gm.send(selection);
      expect(gm.sent[0]).toMatchObject({
        messageType: 'network.gm-request-draft.result',
        appliedRevisions:
          'appliedRevisions' in selectedResult ? selectedResult.appliedRevisions : null,
        presentation: { base: { formId: 'NET-018' }, layers: [{ formId: 'NET-021' }] },
      });
      expect(h.db.serialize().equals(beforeQueueReplay)).toBe(true);
      expect(gm.sent[0]?.protocolVersion).toBe(3);
      if (gm.sent[0]?.protocolVersion !== 3) throw new Error('Missing draft replay');
      expect(encodeHostMessageV3(gm.sent[0], await loadProtocolVocabulary(process.cwd())).ok).toBe(
        true,
      );
      await navigate('NET-021', 'NET-021::CTA::002');
      const p = await gm.runtime.project(gm.c),
        payload = p.layers!.at(-1)!.roleFilteredPayload;
      const update = {
        messageType: 'network.admission-view.replace' as const,
        protocolVersion: 3 as const,
        draftUpdateId: randomUUID(),
        contextId: h.gmLocalContextId,
        campaignId: h.campaignId,
        admissionBatchId: payload['admissionBatchId'] as string,
        sourceFormId: 'NET-022' as const,
        expectedRevisions: p.revisions,
        values: {
          selectedReviewCopyId: payload['selectedReviewCopyId'] as string,
          rejectionReason: 'Проверка состава группы',
          weaponDraftOrNull: null,
        },
      };
      await revokeAfterCommit(update, 'gm_admission_view_event', update.draftUpdateId);
      await gm.send(update);
      expect(gm.sent[0]).toMatchObject({ messageType: 'network.admission-draft.result' });
      const after = await gm.runtime.project(gm.c),
        rejecting = {
          messageType: 'command.request' as const,
          protocolVersion: 1 as const,
          commandKind: 'workflow-command' as const,
          role: 'gm' as const,
          commandId: randomUUID(),
          workflowCommandId: 'UI-CMD-ADMISSION-GM-REJECT' as const,
          expectedRevisions: after.revisions,
          payload: {
            contextId: h.gmLocalContextId,
            campaignId: h.campaignId,
            admissionBatchId: update.admissionBatchId,
            reviewRevision: payload['reviewRevisionOrNull'] as number,
            expectedCampaignRevision: 0,
            previewChecksumOrNull: null,
            reasonOrNull: update.values.rejectionReason,
          },
        };
      await gm.send(rejecting);
      expect(gm.sent[0]).toMatchObject({
        messageType: 'command.result',
        receipt: { result: { decision: 'REJECT' } },
      });
      const rejected = structuredClone(gm.sent[0]);
      await navigate('NET-022', 'NET-022::CTA::001');
      await navigate('NET-021', 'NET-021::CTA::001');
      const beforeRecovery = h.db.serialize();
      expect(gm.runtime.receipt(gm.c, rejecting.commandId)).toEqual(
        'receipt' in rejected ? rejected.receipt : null,
      );
      expect(gm.runtime.receipt(gm.c, opening.commandId)).toEqual(
        'receipt' in originalReceipt ? originalReceipt.receipt : null,
      );
      expect(gm.runtime.receipt(gm.c, randomUUID())).toBeNull();
      expect(h.db.serialize().equals(beforeRecovery)).toBe(true);
      const delivered: LocalNetworkHostMessage[] = [];
      await expect(
        gm.runtime.handle(rejecting, gm.c, (message) => {
          delivered.push(message);
          throw new Error('Lost browser acknowledgement');
        }),
      ).rejects.toThrow('Network publication failed after durable acknowledgement');
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.messageType).toBe('command.replay');
      expect(h.db.serialize().equals(beforeRecovery)).toBe(true);
      await gm.send({
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        role: 'gm',
        commandId: randomUUID(),
        workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
        expectedRevisions: vector(gm.view()),
        payload: {
          campaignId: h.campaignId,
          requestId: batch.requestId,
          requestRevision: 1,
          reason: 'Forged preliminary rejection after final decision',
        },
      });
      expect(gm.sent[0]?.messageType).toBe('command.refusal');
      expect(h.db.serialize().equals(beforeRecovery)).toBe(true);
      await gm.send(rejecting);
      expect(gm.sent[0]).toMatchObject({
        messageType: 'command.replay',
        receipt: 'receipt' in rejected ? rejected.receipt : null,
      });
      await gm.send(opening);
      expect(gm.sent[0]).toMatchObject({
        messageType: 'command.replay',
        receipt: 'receipt' in originalReceipt ? originalReceipt.receipt : null,
      });
      expect(gm.sent[1]).toMatchObject({ presentation: { base: { formId: 'NET-017' } } });
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_character_copy').get()).toEqual({
        n: 0,
      });
    }, 30000);
  });
  it('keeps the campaign birth immutable through queue ingress, safe return, replay and unauthorized requests', async () => {
    const h = await host(),
      gm = gmClient(h);
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
    expect(Object.keys((await gm.runtime.project(gm.c)).base.roleFilteredPayload)).toHaveLength(13);
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
      gm = gmClient(h);
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
    const fresh = gmClient(h),
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
      gm = gmClient(h);
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
};

const preStartPanelCases = () => {
  let h: Awaited<ReturnType<typeof host>>, gm: ReturnType<typeof gmClient>;
  beforeEach(async () => {
    h = await host();
    gm = gmClient(h);
    gm.c.executableReview = [
      ...NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS,
      'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
      'UI-CMD-CAMPAIGN-START',
    ];
  });
  const nav = async (
    sourceFormId: FormActionIntentV2Message['sourceFormId'],
    actionKey: FormActionIntentV2Message['actionKey'],
  ) => {
    const view = await gm.campaign.project(gm.c);
    await gm.send({
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId,
      actionKey,
      expectedProjectionRevision: view.revisions.projectionRevision,
    });
    expect(gm.sent[0]?.messageType).toBe('projection.snapshot');
    return gm.runtime.project(gm.c);
  };
  beforeEach(async () => {
    await nav('CMP-006', 'CMP-006::CTA::001');
  });
  it('opens the same GM context before admission and returns to QR/queue without inventing groups or a scene', async () => {
    const initial = await gm.runtime.project(gm.c);
    expect(initial.base).toMatchObject({
      formId: 'CMP-007',
      roleFilteredPayload: {
        contextId: h.gmLocalContextId,
        campaignId: h.campaignId,
        panelVariant: 'PRE_START',
        groups: [],
        activePeaceSceneOrNull: null,
        initialCampaignTimeOrNull: null,
        startPreflightStatus: 'ZERO_ACTIVE_PLAYERS',
      },
    });
    expect((await nav('CMP-007', 'CMP-007::CTA::004')).base.formId).toBe('GM-001');
    expect((await nav('GM-001', 'GM-001::CTA::006')).base.formId).toBe('GRP-001');
    await nav('GRP-001', 'GRP-001::CTA::009');
    await nav('GM-001', 'GM-001::CTA::013');
    expect((await nav('CMP-007', 'CMP-007::CTA::006')).base.formId).toBe('CMP-006');
    await nav('CMP-006', 'CMP-006::CTA::002');
    await nav('NET-017', 'NET-017::CTA::009');
    expect((await nav('CMP-006', 'CMP-006::CTA::001')).base.roleFilteredPayload).toMatchObject({
      groups: [],
      activePeaceSceneOrNull: null,
      initialCampaignTimeOrNull: null,
    });
  });
  describe('explicit initial time', () => {
    beforeEach(async () => {
      await nav('CMP-007', 'CMP-007::CTA::001');
    });
    it('saves the three explicit values, retains them through navigation, and replays the original receipt', async () => {
      const first = await gm.runtime.project(gm.c);
      expect(first.base.availableActionKeys).toEqual(['NET-016::CTA::001', 'NET-016::CTA::004']);
      const request = {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        role: 'gm',
        commandId: randomUUID(),
        workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
        expectedRevisions: first.revisions,
        payload: {
          campaignId: h.campaignId,
          expectedLobbySnapshotRevision: first.base.roleFilteredPayload[
            'lobbySnapshotRevision'
          ] as string,
          dayNumber: 7,
          hour: 6,
          minute: 1,
        },
      } as const;
      await gm.send(request);
      expect(gm.sent[0]).toMatchObject({ messageType: 'command.result' });
      const receipt = structuredClone(gm.sent[0]);
      expect((await gm.runtime.project(gm.c)).base.roleFilteredPayload).toMatchObject({
        initialTimeInput: { dayNumber: null, hour: null, minute: null },
        initialCampaignTimeOrNull: { dayNumber: 7, hour: 6, minute: 1, campaignTimestamp: 9001 },
        startPreflightStatus: 'ZERO_ACTIVE_PLAYERS',
      });
      await nav('NET-016', 'NET-016::CTA::001');
      await nav('CMP-007', 'CMP-007::CTA::006');
      await nav('CMP-006', 'CMP-006::CTA::001');
      await nav('CMP-007', 'CMP-007::CTA::001');
      const before = h.db.serialize();
      await gm.send(request);
      expect(gm.sent[0]).toMatchObject({
        ...receipt,
        messageType: 'command.replay',
        lifecycleState: 'IDEMPOTENT_REPLAY',
      });
      expect(h.db.serialize().equals(before)).toBe(true);
    });
    it('refuses absent time fields and zero-PC Start without writing rows', async () => {
      const first = await gm.runtime.project(gm.c),
        before = h.db.serialize();
      const request = {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        role: 'gm',
        commandId: randomUUID(),
        workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
        expectedRevisions: first.revisions,
        payload: {
          campaignId: h.campaignId,
          expectedLobbySnapshotRevision: first.base.roleFilteredPayload[
            'lobbySnapshotRevision'
          ] as string,
          dayNumber: 1,
          hour: 6,
        },
      } as const;
      await gm.send(request);
      expect(gm.sent[0]?.messageType).toBe('command.refusal');
      expect(h.db.serialize().equals(before)).toBe(true);
      await gm.send({
        ...request,
        commandId: randomUUID(),
        workflowCommandId: 'UI-CMD-CAMPAIGN-START',
        payload: {
          campaignId: h.campaignId,
          expectedLobbySnapshotRevision: first.base.roleFilteredPayload[
            'lobbySnapshotRevision'
          ] as string,
          expectedReadinessRevision: 0,
        },
      });
      expect(gm.sent[0]?.messageType).toBe('command.refusal');
      expect(h.db.serialize().equals(before)).toBe(true);
    });
  });
};

const gmLifecycleCases = () => {
  let h: Awaited<ReturnType<typeof host>>, gm: ReturnType<typeof gmClient>;
  const current = async () => {
    const view = await gm.runtime.project(gm.c);
    return lifecycleProjection(view);
  };
  const nav = async (
    sourceFormId: FormActionIntentV2Message['sourceFormId'],
    actionKey: FormActionIntentV2Message['actionKey'],
  ) => {
    const view = await gm.campaign.project(gm.c);
    await gm.send({
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId,
      actionKey,
      expectedProjectionRevision: view.revisions.projectionRevision,
    });
    expect(gm.sent[0]?.messageType, JSON.stringify(gm.sent)).toBe('projection.snapshot');
  };
  beforeEach(async () => {
    h = await host();
    gm = gmClient(h);
    gm.c.executableReview = [
      ...NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS,
      ...CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
    ];
    await nav('CMP-006', 'CMP-006::CTA::001');
    await nav('CMP-007', 'CMP-007::CTA::003');
  });
  it.each(['RESOLVED', 'REJECTED'] as const)(
    'leaves a full GM polling interval after slow %s work and stops scheduling after close',
    async (outcome) => {
      gm.runtime.close();
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
      });
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let began!: () => void;
      const firstPoll = new Promise<void>((resolve) => {
        began = resolve;
      });
      let releaseClosed!: () => void;
      const heldAcrossClose = new Promise<void>((resolve) => {
        releaseClosed = resolve;
      });
      let secondRefreshCompleted = false;
      const active: { poll: Promise<unknown> | null } = { poll: null };
      let pollSpy: { mockRestore(): void; mock: { calls: unknown[][] } } | undefined;
      try {
        gm = gmClient(h);
        const poll = gm.gmScheduler.poll.bind(gm.gmScheduler);
        let first = true;
        pollSpy = vi.spyOn(gm.gmScheduler, 'poll').mockImplementation(function <T>(
          run: () => Promise<T>,
        ): Promise<T> {
          const hold = first;
          first = false;
          const result = poll(async () => {
            // Keep the real GM projection, SQLite reads and serialized scheduler.
            const value = await run();
            if (hold) {
              began();
              await held;
            } else {
              secondRefreshCompleted = true;
              await heldAcrossClose;
            }
            if (outcome === 'REJECTED') throw Error('Simulated failed GM poll settlement');
            return value;
          });
          active.poll = result;
          return result;
        });
        await vi.advanceTimersByTimeAsync(1000);
        expect(pollSpy.mock.calls).toHaveLength(0);
        gm.runtime.watch(gm.c, (message) => gm.sent.push(message));
        await vi.advanceTimersByTimeAsync(1000);
        await firstPoll;
        expect(gm.sent).toContainEqual(
          expect.objectContaining({ messageType: 'projection.snapshot', projectionRole: 'gm' }),
        );
        await vi.advanceTimersByTimeAsync(3500);
        expect(pollSpy.mock.calls).toHaveLength(1);
        release();
        await active.poll?.catch(() => {});
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(999);
        expect(pollSpy.mock.calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(pollSpy.mock.calls).toHaveLength(2);
        expect(secondRefreshCompleted).toBe(true);
        // Settle the real second refresh only after close, covering its late rearm branch.
        gm.runtime.close();
        releaseClosed();
        if (outcome === 'REJECTED')
          await expect(active.poll).rejects.toThrow('Simulated failed GM poll settlement');
        else await active.poll;
        await vi.advanceTimersByTimeAsync(5000);
        expect(pollSpy.mock.calls).toHaveLength(2);
        // Runtime close does not own the supplied command scheduler.
        await expect(gm.gmScheduler.wire(gm.c, () => Promise.resolve('available'))).resolves.toBe(
          'available',
        );
      } finally {
        release();
        releaseClosed();
        await active.poll?.catch(() => {});
        gm.runtime.close();
        pollSpy?.mockRestore();
        vi.useRealTimers();
      }
    },
  );
  it.each(['REVOKED', 'CORRUPT_EVENT'] as const)(
    'fences lifecycle navigation publication after commit when %s',
    async (fault) => {
      const view = await gm.runtime.project(gm.c);
      const request: FormActionIntentV2Message = {
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId: randomUUID(),
        sourceFormId: 'CMP-008',
        actionKey: 'CMP-008::CTA::007',
        expectedProjectionRevision: view.revisions.projectionRevision,
      };
      let queued = false,
        injected = false,
        revoked = false,
        insideTransaction = true;
      let changedRows = 0,
        faultBytes: Buffer | null = null;
      const originalTrust = gm.c.trusted;
      const trust = vi.spyOn(gm.c, 'trusted').mockImplementation(() => {
        if (
          !queued &&
          h.db
            .prepare('SELECT 1 FROM gm_request_queue_event WHERE event_id=?')
            .get(request.navigationRequestId) !== undefined
        ) {
          queued = true;
          queueMicrotask(() => {
            insideTransaction = h.db.inTransaction;
            if (fault === 'REVOKED') revoked = true;
            else
              changedRows = h.db
                .prepare('UPDATE gm_request_queue_event SET record_sha256=? WHERE event_id=?')
                .run('0'.repeat(64), request.navigationRequestId).changes;
            injected = true;
            faultBytes = h.db.serialize();
          });
        }
        return originalTrust() && !revoked;
      });
      try {
        await expect(gm.send(request)).rejects.toThrow(
          'Network publication failed after durable acknowledgement',
        );
        expect(injected).toBe(true);
        expect(insideTransaction).toBe(false);
        expect(changedRows).toBe(fault === 'CORRUPT_EVENT' ? 1 : 0);
        expect(gm.sent).toEqual([]);
        expect(
          h.db
            .prepare('SELECT COUNT(*) AS n FROM gm_request_queue_event WHERE event_id=?')
            .get(request.navigationRequestId),
        ).toEqual({ n: 1 });
        expect(faultBytes).not.toBeNull();
        expect(h.db.serialize().equals(faultBytes!)).toBe(true);
      } finally {
        trust.mockRestore();
      }
    },
  );
  it('binds a committed navigation to its original scope when another valid GM context becomes current', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'network-nav-scope-'));
    dirs.push(dir);
    const path = join(dir, 'host.sqlite');
    const first = await host({ path }),
      second = await host({ path });
    const client = gmClient(first);
    client.c.executableReview = [
      ...NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS,
      ...CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
    ];
    for (const [sourceFormId, actionKey] of [
      ['CMP-006', 'CMP-006::CTA::001'],
      ['CMP-007', 'CMP-007::CTA::003'],
    ] as const) {
      const p = await client.campaign.project(client.c);
      await client.send({
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId: randomUUID(),
        sourceFormId,
        actionKey,
        expectedProjectionRevision: p.revisions.projectionRevision,
      });
      expect(client.sent[0]?.messageType).toBe('projection.snapshot');
    }
    client.c.gmLocalContextId = second.gmLocalContextId;
    const foreign = await client.runtime.project(client.c);
    expect(foreign.base.formId).toBe('CMP-006');
    expect(foreign.base.roleFilteredPayload).toMatchObject({
      gmLocalContextId: second.gmLocalContextId,
      campaignId: second.campaignId,
    });
    client.c.gmLocalContextId = first.gmLocalContextId;
    const view = await client.runtime.project(client.c);
    const request: FormActionIntentV2Message = {
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      navigationRequestId: randomUUID(),
      sourceFormId: 'CMP-008',
      actionKey: 'CMP-008::CTA::007',
      expectedProjectionRevision: view.revisions.projectionRevision,
    };
    let queued = false,
      switched = false,
      committedBytes: Buffer | null = null;
    const originalTrust = client.c.trusted;
    const trust = vi.spyOn(client.c, 'trusted').mockImplementation(() => {
      if (
        !queued &&
        first.db
          .prepare('SELECT 1 FROM gm_request_queue_event WHERE event_id=?')
          .get(request.navigationRequestId) !== undefined
      ) {
        queued = true;
        queueMicrotask(() => {
          client.c.gmLocalContextId = second.gmLocalContextId;
          switched = true;
          committedBytes = first.db.serialize();
        });
      }
      return originalTrust();
    });
    try {
      await expect(client.send(request)).rejects.toThrow(
        'Network publication failed after durable acknowledgement',
      );
      expect(switched).toBe(true);
      expect(client.sent).toEqual([]);
      expect(
        first.db
          .prepare('SELECT COUNT(*) AS n FROM gm_request_queue_event WHERE event_id=?')
          .get(request.navigationRequestId),
      ).toEqual({ n: 1 });
      expect(committedBytes).not.toBeNull();
      expect(first.db.serialize().equals(committedBytes!)).toBe(true);
    } finally {
      trust.mockRestore();
      client.c.gmLocalContextId = first.gmLocalContextId;
    }
  });
  it('keeps read-only navigation usable while a real staged transfer blocks lifecycle writes', async () => {
    const { p, batch, submit } = await submittedPlayer(h);
    p.disconnect();
    const peer = createLocalNetworkPeer({ database: p.db, baseline, config });
    try {
      await peer.reconnect(p.scope(), p.state().addressOrQrPayload, h.campaignId);
      expect(
        await peer.call(p.scope(), {
          schemaVersion: 1,
          operation: 'DEVICE_REQUEST_RECOVER',
          requestId: batch.requestId,
          technicalSessionId: batch.technicalSessionId,
          submitCommandId: submit.commandId,
        }),
      ).toMatchObject({ outcome: 'ACK' });
      const body = canonicalPostSaveJson(batch);
      const begun = await peer.call(p.scope(), {
        schemaVersion: 1,
        operation: 'DEVICE_REQUEST_BEGIN',
        commandId: randomUUID(),
        requestId: batch.requestId,
        technicalSessionId: batch.technicalSessionId,
        connectionRevision: batch.connectionRevision,
        campaignCheckpointSha256: batch.campaignProof.checkpointSha256,
        candidates: batch.candidates.map((c) => ({
          descriptor: c.descriptor,
          witnessSha256: c.witnessSha256,
          witnessByteLength: c.byteLength,
        })),
        submitBodySha256: postSaveSha256(body),
        submitBodyByteLength: Buffer.byteLength(body),
      });
      expect(begun).toMatchObject({ outcome: 'TRANSFER_READY' });
      expect(h.runtime.operationCounts(h.campaignId).stagedTransferCount).toBe(1);
      await nav('CMP-008', 'CMP-008::CTA::005');
      const busy = await current();
      expect(busy).toMatchObject({ safeBoundary: false, pendingOperationCount: 1 });
      const refused = campaignLifecycleGmRequest(busy, 'CMP-014::CTA::002', randomUUID(), {
        newCapacity: 2,
      });
      const bytes = h.db.serialize();
      await gm.send(refused);
      expect(gm.sent[0]).toMatchObject({ messageType: 'command.refusal' });
      expect(h.db.serialize().equals(bytes)).toBe(true);
      await nav('CMP-014', 'CMP-014::CTA::003');
      await nav('CMP-008', 'CMP-008::CTA::007');
      const devices = await current();
      expect(devices.devices).toContainEqual(
        expect.objectContaining({ deviceId: p.scope().ownerDeviceId, pendingOwnedCommandCount: 1 }),
      );
      const disconnect = campaignLifecycleGmRequest(devices, 'NET-023::CTA::002', randomUUID(), {
        deviceId: p.scope().ownerDeviceId,
        selectedControllerSeatOrNull: null,
        reason: 'Still uploading',
      });
      const beforeDisconnect = h.db.serialize();
      await gm.send(disconnect);
      expect(gm.sent[0]).toMatchObject({ messageType: 'command.refusal' });
      expect(h.db.serialize().equals(beforeDisconnect)).toBe(true);
      peer.close();
      await expect
        .poll(() => h.runtime.operationCounts(h.campaignId).pendingOperationCount)
        .toBe(0);
    } finally {
      peer.close();
    }
  });
  it('ignores a delayed authenticated reply from the previous reconnect locator without a write', async () => {
    const { p } = await submittedPlayer(h);
    p.disconnect();
    const scope = p.scope(),
      address = parseCampaignLanAddress(p.state().addressOrQrPayload).canonicalOrigin;
    let received!: () => void,
      release!: () => void,
      delayNext = false;
    const arrived = new Promise<void>((resolve) => {
      received = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connect = peerChannelModule.connectCampaignPeerChannel;
    const spy = vi
      .spyOn(peerChannelModule, 'connectCampaignPeerChannel')
      .mockImplementationOnce(async (...args) => {
        const channel = await connect(...args);
        return {
          ...channel,
          get closed() {
            return channel.closed;
          },
          get needsHostPin() {
            return channel.needsHostPin;
          },
          confirmHostPin: channel.confirmHostPin.bind(channel),
          close: channel.close.bind(channel),
          async call(...input) {
            const response = await channel.call(...input);
            if (delayNext) {
              delayNext = false;
              received();
              await gate;
            }
            return response;
          },
        };
      });
    const peer = createLocalNetworkPeer({ database: p.db, baseline, config });
    try {
      await peer.reconnect(scope, address, h.campaignId);
      await peer.readConnection(scope, () => {});
      const intent = {
        commandId: randomUUID(),
        expectedConnectionRevision: readLocalCampaignConnection(p.db, scope).revision,
        canonicalOrigin: address,
        disconnectCommandIdOrNull: null,
      };
      prepareLocalCampaignReconnect(p.db, scope, intent, () => {});
      delayNext = true;
      const delayed = peer
        .readConnection(scope, () => {})
        .then(
          () => null,
          (error: unknown) => error,
        );
      await arrived;
      replaceLocalCampaignReconnectLocator(
        p.db,
        scope,
        randomUUID(),
        {
          commandId: intent.commandId,
          expectedConnectionRevision: readLocalCampaignConnection(p.db, scope).revision,
          canonicalOrigin: 'http://127.0.0.1:1',
        },
        () => {},
      );
      const bytes = p.db.serialize();
      release();
      expect(await delayed).toBeInstanceOf(Error);
      expect(p.db.serialize().equals(bytes)).toBe(true);
      expect(readLocalCampaignConnection(p.db, scope).pendingOrNull?.commandId).toBe(
        intent.commandId,
      );
    } finally {
      release();
      spy.mockRestore();
      peer.close();
    }
  });
  it('commits settings to the existing campaign, keeps the held endpoint/birth, and replays the same receipt', async () => {
    const p = await current(),
      birth = readHostedCampaignCreationOrigin(h.db, h.campaignId, h.validate);
    const request = campaignLifecycleGmRequest(p, 'CMP-008::CTA::008', randomUUID(), {
      title: 'Изменённое название',
      descriptionOrNull: 'Настройки будущих бросков',
      defaultFutureRollMode: 'MANUAL',
      network: p.networkForNextLaunch,
    });
    await gm.send(request);
    expect(gm.sent[0], JSON.stringify(gm.sent)).toMatchObject({ messageType: 'command.result' });
    const receipt = structuredClone(gm.sent[0]);
    expect(await current()).toMatchObject({
      title: 'Изменённое название',
      settingsRevision: 1,
      campaignStatus: 'PAUSED',
      firstStartCompleted: false,
      defaultFutureRollMode: 'MANUAL',
      activeListenerEndpointOrNull: p.activeListenerEndpointOrNull,
      clockMode: null,
    });
    expect(readHostedCampaignCreationOrigin(h.db, h.campaignId, h.validate)).toEqual(birth);
    const bytes = h.db.serialize();
    await gm.send(request);
    expect(gm.sent[0]).toEqual({
      ...receipt,
      messageType: 'command.replay',
      lifecycleState: 'IDEMPOTENT_REPLAY',
    });
    expect(h.db.serialize().equals(bytes)).toBe(true);
    await nav('CMP-008', 'CMP-008::CTA::009');
    expect((await gm.runtime.project(gm.c)).base.roleFilteredPayload).toMatchObject({
      title: 'Изменённое название',
      descriptionOrNull: 'Настройки будущих бросков',
      groups: [],
      activePeaceSceneOrNull: null,
    });
  });
  it.each(['REVOKED', 'CORRUPT_HEAD', 'CORRUPT_APPLICATION'] as const)(
    'fences WATCH publication after a real status response when %s',
    async (fault) => {
      const { p } = await submittedPlayer(h);
      expect(p.sent.some((m) => m.messageType === 'network.peer-state')).toBe(false);
      const message: CampaignPeerControlV3Message = {
        messageType: 'network.peer-control',
        protocolVersion: 3,
        requestId: randomUUID(),
        contextId: p.c.contextId!,
        networkScopeId: p.scope().networkScopeId,
        expectedRevisions: vector(p.state()),
        operation: 'WATCH',
        expectedConnectionRevision: null,
        commandIdOrNull: null,
        endpointOrNull: null,
      };
      const peer = p.peerForTest,
        read = peer.readConnection.bind(peer);
      let injected = false,
        faultBytes: Buffer | null = null;
      const spy = vi.spyOn(peer, 'readConnection').mockImplementationOnce(async (...args) => {
        const result = await read(...args);
        expect(result).toBeDefined();
        if (fault === 'REVOKED') p.revoke();
        else {
          const sql =
            fault === 'CORRUPT_HEAD'
              ? 'UPDATE local_campaign_connection_head SET record_sha256=? WHERE network_scope_id=?'
              : 'UPDATE local_network_application SET record_sha256=? WHERE network_scope_id=?';
          expect(p.db.prepare(sql).run('0'.repeat(64), p.scope().networkScopeId).changes).toBe(1);
        }
        faultBytes = p.db.serialize();
        injected = true;
        return result;
      });
      try {
        if (fault === 'REVOKED') {
          await p.send(message);
          expect(p.sent).toEqual([expect.objectContaining({ messageType: 'protocol.refusal' })]);
        } else {
          await expect(p.send(message)).rejects.toThrow();
          expect(p.sent).toEqual([]);
        }
        expect(injected).toBe(true);
        expect(faultBytes).not.toBeNull();
        expect(p.db.serialize().equals(faultBytes!)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    },
  );
  it('preserves guard rejection before async entry and rolls back hostile observation callbacks', async () => {
    const { p } = await submittedPlayer(h);
    p.disconnect();
    const scope = p.scope(),
      address = parseCampaignLanAddress(p.state().addressOrQrPayload).canonicalOrigin;
    const peer = createLocalNetworkPeer({ database: p.db, baseline, config });
    try {
      await peer.reconnect(scope, address, h.campaignId);
      await peer.readConnection(scope, () => {});
      let entered = false;
      const guards: ((state: localConnectionStore.LocalCampaignConnection) => void)[] = [
        async () => {
          entered = true;
          await Promise.resolve();
        },
        () => Promise.resolve(),
        (state) => {
          Object.assign(state, { revision: state.revision + 1 });
        },
        () => {
          p.db.exec('CREATE TABLE forbidden_peer_guard (x INTEGER)');
        },
      ];
      const bytes = p.db.serialize();
      for (const guard of guards) {
        await expect(peer.readConnection(scope, guard)).rejects.toThrow();
        expect(p.db.serialize().equals(bytes)).toBe(true);
      }
      expect(entered).toBe(false);
    } finally {
      peer.close();
    }
  });
  describe('explicit browser peer continuation', () => {
    let p: Awaited<ReturnType<typeof client>>;
    const state = () => {
      const message = p.sent.findLast((m) => m.messageType === 'network.peer-state');
      if (message === undefined) throw Error('Missing peer state: ' + JSON.stringify(p.sent));
      expect(encodeHostMessageV3(message, vocabulary).ok).toBe(true);
      return campaignPeerStateValue(message);
    };
    const watch = (): CampaignPeerControlV3Message => ({
      messageType: 'network.peer-control',
      protocolVersion: 3,
      requestId: randomUUID(),
      contextId: p.c.contextId!,
      networkScopeId: p.scope().networkScopeId,
      expectedRevisions: vector(p.state()),
      operation: 'WATCH',
      expectedConnectionRevision: null,
      commandIdOrNull: null,
      endpointOrNull: null,
    });
    beforeEach(async () => {
      ({ p } = await submittedPlayer(h));
      expect(p.sent.some((m) => m.messageType === 'network.peer-state')).toBe(false);
      await p.send(watch());
      expect(state()).toMatchObject({
        connectionState: 'CONNECTED',
        formOrNull: null,
        statusOrNull: {
          campaignStatus: 'PAUSED',
          firstStartCompleted: false,
          disconnectOrNull: null,
        },
      });
    });
    it('rejects a foreign context without a write or own continuation disclosure', async () => {
      const bytes = p.db.serialize();
      await p.send({ ...watch(), contextId: randomUUID() });
      expect(p.sent).toEqual([expect.objectContaining({ messageType: 'protocol.refusal' })]);
      expect(p.db.serialize().equals(bytes)).toBe(true);
    });
    it('retires the peer watch when real CANCEL returns to NET003', async () => {
      await p.replace('CANCEL_REASON', { cancelReason: 'Отменить ожидание' });
      const request = p.state().requestOrNull!;
      await p.command('UI-CMD-DEVICE-REQUEST-CANCEL', {
        requestId: request.requestId,
        technicalSessionId: request.technicalSessionId,
        requestRevision: request.requestRevision,
        reason: 'Отменить ожидание',
      });
      expect(p.state().formId).toBe('NET-003');
      p.sent.length = 0;
      // A full real poll interval must not republish the retired subscription.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(p.sent.some((m) => m.messageType === 'network.peer-state')).toBe(false);
    });
    describe('after the actual GM disconnect', () => {
      let original: ReturnType<typeof p.state>;
      let request: NonNullable<ReturnType<typeof p.state>['requestOrNull']>;
      let initialCopies: unknown[];
      let attempt: string;
      let retry: CampaignPeerControlV3Message;
      beforeEach(async () => {
        original = p.state();
        request = original.requestOrNull!;
        initialCopies = h.db.prepare('SELECT * FROM campaign_character_copy').all();
        await nav('CMP-008', 'CMP-008::CTA::007');
        const disconnect = campaignLifecycleGmRequest(
          await current(),
          'NET-023::CTA::002',
          randomUUID(),
          {
            deviceId: p.scope().ownerDeviceId,
            selectedControllerSeatOrNull: null,
            reason: 'Повторите подключение вручную',
          },
        );
        let acknowledge!: () => void;
        const disconnected = new Promise<void>((resolve) => {
          acknowledge = resolve;
        });
        const push = p.sent.push.bind(p.sent);
        const publication = vi.spyOn(p.sent, 'push').mockImplementation((...messages) => {
          const size = push(...messages);
          if (
            messages.some(
              (message) =>
                message.messageType === 'network.peer-state' &&
                message.connectionState === 'DISCONNECTED',
            )
          )
            acknowledge();
          return size;
        });
        try {
          await gm.send(disconnect);
          expect(gm.sent[0]?.messageType).toBe('command.result');
          // Await the actual authenticated publication under the unchanged test deadline.
          await disconnected;
        } finally {
          publication.mockRestore();
        }
        const blocked = state();
        expect(blocked.formOrNull).toMatchObject({
          formId: 'NET-009',
          availableActionKeys: ['NET-009::CTA::001'],
          fields: { resumeContextHint: 'NET-005' },
        });
        expect(blocked.statusOrNull?.disconnectOrNull?.reason).toBe(
          'Повторите подключение вручную',
        );
        attempt = blocked.formOrNull!.fields['commandId'] as string;
        retry = {
          ...watch(),
          operation: 'RETRY',
          expectedConnectionRevision: blocked.connectionRevision,
          commandIdOrNull: attempt,
          endpointOrNull: { hostAddress: '127.0.0.1', hostPort: h.port },
        };
      });
      it('polls authenticated status without admission recovery while the disconnect gate stays closed', async () => {
        const peer = p.peerForTest,
          read = peer.readConnection.bind(peer);
        let observed!: () => void;
        const nextStatus = new Promise<void>((resolve) => {
          observed = resolve;
        });
        const reads = vi.spyOn(peer, 'readConnection').mockImplementation(async (...args) => {
          const status = await read(...args);
          if (status.disconnectOrNull?.retryReceiptOrNull === null) observed();
          return status;
        });
        const recovery = vi.spyOn(peer, 'recover');
        try {
          await nextStatus;
          // The control queues behind the whole actual polling tick, including owner refresh.
          await p.send(watch());
          expect(recovery).not.toHaveBeenCalled();
          expect(state().statusOrNull?.disconnectOrNull?.retryReceiptOrNull).toBeNull();
          expect(p.state().requestOrNull).toEqual(request);
          expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_disconnect_retry').get()).toEqual(
            { n: 0 },
          );
          expect(h.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual(
            initialCopies,
          );
        } finally {
          reads.mockRestore();
          recovery.mockRestore();
        }
      });
      it('uses real NET009 controls for a pinned pre-Start retry', async () => {
        await p.send(retry);
        expect(state()).toMatchObject({
          retryOutcome: 'CONFIRMED',
          connectionState: 'RECONNECTING',
          statusOrNull: { disconnectOrNull: { retryReceiptOrNull: { commandId: attempt } } },
        });
        expect(p.state().requestOrNull).toEqual(request);
        expect(h.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual(initialCopies);
      });
      it('keeps a durable retry confirmed after the post-settlement recovery proof read fails', async () => {
        // Stop the unrelated GM display observer: its connection refresh is a legitimate write.
        // The real peer server, player runtime, storage guards and byte-exact replay checks stay live.
        gm.runtime.close();
        const peer = p.peerForTest,
          execute = peer.retryConnection.bind(peer);
        const read = localConnectionStore.readLocalCampaignReconnectSettlement;
        let committed = false,
          proofFailed = false;
        const dispatch = vi
          .spyOn(peer, 'retryConnection')
          .mockImplementationOnce(async (...args) => {
            await execute(...args);
            committed = true;
            throw Error('Lost completion after durable settlement');
          });
        const proof = vi
          .spyOn(localConnectionStore, 'readLocalCampaignReconnectSettlement')
          .mockImplementation((...args) => {
            if (committed && !proofFailed) {
              proofFailed = true;
              throw Error('One failed recovery proof read');
            }
            return read(...args);
          });
        try {
          await expect(p.send(retry)).rejects.toThrow(
            'Network publication failed after durable acknowledgement',
          );
        } finally {
          dispatch.mockRestore();
          proof.mockRestore();
        }
        expect(committed).toBe(true);
        expect(proofFailed).toBe(true);
        expect(
          p.sent.some(
            (m) => m.messageType === 'network.peer-state' && m.retryOutcome === 'REFUSED',
          ),
        ).toBe(false);
        const hostBytes = h.db.serialize(),
          localBytes = p.db.serialize();
        const tableDigests = () =>
          Object.fromEntries(
            (
              h.db
                .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
                .all() as { name: string }[]
            ).map(({ name }) => [
              name,
              postSaveSha256(
                canonicalPostSaveJson(
                  h.db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all(),
                ),
              ),
            ]),
          );
        const beforeTables = tableDigests();
        const receipt = read(p.db, p.scope(), attempt);
        expect(receipt?.outcome).toBe('CONFIRMED');
        await p.send(retry);
        expect(state().retryOutcome).toBe('CONFIRMED');
        const afterTables = tableDigests();
        expect(
          h.db.serialize().equals(hostBytes),
          'Changed host tables: ' +
            Object.keys(beforeTables)
              .filter((key) => beforeTables[key] !== afterTables[key])
              .join(', '),
        ).toBe(true);
        expect(p.db.serialize().equals(localBytes)).toBe(true);
        expect(read(p.db, p.scope(), attempt)).toEqual(receipt);
        expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_disconnect_retry').get()).toEqual({
          n: 1,
        });
      });
      it('keeps NONE nonterminal: exact proof replay writes nothing and a new CAS request corrects the locator', async () => {
        const unavailable = {
          ...retry,
          endpointOrNull: {
            hostAddress: '127.0.0.1',
            hostPort: h.port === 65535 ? 65534 : h.port + 1,
          },
        };
        const connect = vi
          .spyOn(p.peerForTest, 'reconnect')
          .mockRejectedValueOnce(Error('Offline before remote dispatch'));
        try {
          await p.send(unavailable);
        } finally {
          connect.mockRestore();
        }
        expect(state().retryOutcome).toBe('NONE');
        const hostBytes = h.db.serialize(),
          localBytes = p.db.serialize();
        const proof = vi
          .spyOn(localConnectionStore, 'readLocalCampaignReconnectSettlement')
          .mockImplementationOnce(() => {
            throw Error('Unresolved replay proof unavailable');
          });
        try {
          await expect(p.send(unavailable)).rejects.toThrow(
            'Network publication failed after durable acknowledgement',
          );
        } finally {
          proof.mockRestore();
        }
        expect(
          p.sent.some(
            (m) => m.messageType === 'network.peer-state' && m.retryOutcome === 'REFUSED',
          ),
        ).toBe(false);
        await p.send(unavailable);
        expect(state().retryOutcome).toBe('NONE');
        expect(h.db.serialize().equals(hostBytes)).toBe(true);
        expect(p.db.serialize().equals(localBytes)).toBe(true);
        const corrected = {
          ...retry,
          requestId: randomUUID(),
          expectedConnectionRevision: state().connectionRevision,
          expectedRevisions: vector(p.state()),
        };
        await p.send(corrected);
        expect(state().retryOutcome).toBe('CONFIRMED');
        expect(
          localConnectionStore.readLocalCampaignReconnectSettlement(p.db, p.scope(), attempt)
            ?.outcome,
        ).toBe('CONFIRMED');
        expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_disconnect_retry').get()).toEqual({
          n: 1,
        });
      });
      it('preserves committed retry across a publication failure and exact replay', async () => {
        const fail = vi.spyOn(p.sent, 'push').mockImplementationOnce(() => {
          throw Error('Lost confirmed retry publication');
        });
        await expect(p.send(retry)).rejects.toThrow();
        fail.mockRestore();
        expect(
          p.sent.some(
            (m) => m.messageType === 'network.peer-state' && m.retryOutcome === 'REFUSED',
          ),
        ).toBe(false);
        const before = h.db.serialize();
        await p.send(retry);
        expect(state().retryOutcome).toBe('CONFIRMED');
        expect(h.db.serialize().equals(before)).toBe(true);
        expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_disconnect_retry').get()).toEqual({
          n: 1,
        });
      });
      describe('after a lost committed retry publication', () => {
        beforeEach(async () => {
          const failure = vi.spyOn(p.sent, 'push').mockImplementationOnce(() => {
            throw Error('Lost R1 publication');
          });
          try {
            await expect(p.send(retry)).rejects.toThrow();
          } finally {
            failure.mockRestore();
          }
        });
        it('replays the old confirmed settlement while a later real disconnect remains blocked', async () => {
          const again = campaignLifecycleGmRequest(
            await current(),
            'NET-023::CTA::002',
            randomUUID(),
            {
              deviceId: p.scope().ownerDeviceId,
              selectedControllerSeatOrNull: null,
              reason: 'Новое отключение после R1',
            },
          );
          await gm.send(again);
          expect(gm.sent[0]?.messageType).toBe('command.result');
          const sibling = createLocalNetworkPeer({ database: p.db, baseline, config });
          cleaners.push(() => {
            sibling.close();
            return Promise.resolve();
          });
          await sibling.reconnect(
            p.scope(),
            parseCampaignLanAddress(p.state().addressOrQrPayload).canonicalOrigin,
            h.campaignId,
          );
          await sibling.readConnection(p.scope(), () => {});
          const hostBefore = h.db.serialize(),
            ownBefore = p.db.serialize();
          await p.send(retry);
          expect(state()).toMatchObject({
            retryOutcome: 'CONFIRMED',
            connectionState: 'RECONNECTING',
            statusOrNull: {
              disconnectOrNull: { disconnectCommandId: again.commandId, retryReceiptOrNull: null },
            },
            formOrNull: { formId: 'NET-009' },
          });
          expect(h.db.serialize().equals(hostBefore)).toBe(true);
          expect(p.db.serialize().equals(ownBefore)).toBe(true);
          expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_disconnect_retry').get()).toEqual(
            { n: 1 },
          );
        });
      });
      describe('after the confirmed explicit retry', () => {
        beforeEach(async () => {
          await p.send(retry);
          expect(state().retryOutcome).toBe('CONFIRMED');
        });
        it('leaves a full polling interval after a slow refresh and stops refreshing after close', async () => {
          // Only timer delivery is virtual: reconnect, WATCH, peer RPC and SQLite remain real.
          p.disconnect();
          vi.useFakeTimers({
            toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
          });
          let release!: () => void;
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          let began!: () => void;
          const firstPoll = new Promise<void>((resolve) => {
            began = resolve;
          });
          let nextBegan!: () => void;
          const nextPoll = new Promise<void>((resolve) => {
            nextBegan = resolve;
          });
          let observeNext = false;
          let readSpy: { mockRestore(): void; mock: { calls: unknown[][] } } | undefined;
          try {
            await p.restart();
            await p.send(watch());
            const peer = p.peerForTest,
              read = peer.readConnection.bind(peer);
            let first = true;
            readSpy = vi.spyOn(peer, 'readConnection').mockImplementation(async (...args) => {
              const hold = first;
              first = false;
              if (hold) began();
              else if (observeNext) nextBegan();
              const result = await read(...args);
              if (hold) await held;
              return result;
            });
            await vi.advanceTimersByTimeAsync(1000);
            await firstPoll;
            // Cross several nominal ticks while the first refresh is still in flight.
            await vi.advanceTimersByTimeAsync(3500);
            release();
            // A real WATCH queued after the refresh is a barrier for its completion.
            await p.send(watch());
            const completedReads = readSpy.mock.calls.length;
            observeNext = true;
            await vi.advanceTimersByTimeAsync(999);
            expect(readSpy.mock.calls.length).toBe(completedReads);
            await vi.advanceTimersByTimeAsync(1);
            await nextPoll;
            expect(readSpy.mock.calls.length).toBe(completedReads + 1);
            // Closing with this final refresh in flight must prevent further refresh calls.
            p.disconnect();
            const closedReads = readSpy.mock.calls.length;
            await vi.advanceTimersByTimeAsync(5000);
            expect(readSpy.mock.calls.length).toBe(closedReads);
            expect(
              h.db.prepare('SELECT COUNT(*) AS n FROM campaign_disconnect_retry').get(),
            ).toEqual({ n: 1 });
          } finally {
            release();
            p.disconnect();
            readSpy?.mockRestore();
            vi.useRealTimers();
          }
        });
        it('coalesces an older passive poll after a new connection publishes its paired reconnect', async () => {
          const peer = p.peerForTest,
            reconnect = peer.reconnect.bind(peer);
          let arrived!: () => void, release!: () => void;
          const connected = new Promise<void>((resolve) => {
            arrived = resolve;
          });
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          let nextRecovery!: () => void;
          const recoveredAgain = new Promise<void>((resolve) => {
            nextRecovery = resolve;
          });
          let observeRecovery = false;
          const recover = peer.recover.bind(peer);
          const recovery = vi.spyOn(peer, 'recover').mockImplementation((...args) => {
            if (observeRecovery) nextRecovery();
            return recover(...args);
          });
          const delay = vi.spyOn(peer, 'reconnect').mockImplementationOnce(async (...args) => {
            const result = await reconnect(...args);
            arrived();
            await gate;
            return result;
          });
          let publishedRecoveryCount: number | null = null;
          const resumed = p.additionalOwnerView(undefined, (message) => {
            if (
              message.messageType === 'projection.snapshot' &&
              message.protocolVersion === 2 &&
              message.presentation.assignment.reason === 'RECONNECT'
            )
              publishedRecoveryCount = recovery.mock.calls.length;
          });
          let oldTrust: { mockRestore(): void } | undefined;
          try {
            await connected;
            // The production browser opens a new /state connection and retires its previous socket.
            oldTrust = vi.spyOn(p.c, 'trusted').mockReturnValue(false);
            // Queue a real poll behind the held resume; no source, transport or timer is mocked.
            await new Promise((resolve) => setTimeout(resolve, 1100));
            release();
            const fresh = await resumed;
            expect(fresh.connection).not.toBe(p.c);
            expect(fresh.connection.contextId).not.toBe(p.c.contextId);
            expect(publishedRecoveryCount).not.toBeNull();
            await fresh.send({
              ...watch(),
              contextId: fresh.connection.contextId!,
              networkScopeId: fresh.connection.networkScopeId!,
              commandIdOrNull: attempt,
            });
            expect(
              fresh.messages.findLast((message) => message.messageType === 'network.peer-state'),
            ).toMatchObject({ connectionState: 'CONNECTED', formOrNull: null });
            expect(recovery.mock.calls.length).toBe(publishedRecoveryCount);
            // Coalescing one superseded poll must not starve the unchanged binding's next refresh.
            observeRecovery = true;
            await recoveredAgain;
            expect(recovery.mock.calls.length).toBeGreaterThan(publishedRecoveryCount!);
            expect(p.state().requestOrNull).toEqual(request);
            expect(h.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual(
              initialCopies,
            );
            expect(
              h.db.prepare('SELECT COUNT(*) AS n FROM campaign_disconnect_retry').get(),
            ).toEqual({ n: 1 });
          } finally {
            release();
            await resumed.catch(() => {});
            oldTrust?.mockRestore();
            delay.mockRestore();
            recovery.mockRestore();
          }
        });
        it('does not turn a failed pre-cache source read on exact confirmed replay into refusal', async () => {
          const hostBytes = h.db.serialize(),
            localBytes = p.db.serialize();
          const source = vi
            .spyOn(localAdmissionStore, 'readLocalAdmissionPresentation')
            .mockImplementationOnce(() => {
              throw Error('Owner proof temporarily unavailable');
            });
          try {
            await expect(p.send(retry)).rejects.toThrow(
              'Network publication failed after durable acknowledgement',
            );
          } finally {
            source.mockRestore();
          }
          expect(
            p.sent.some(
              (m) => m.messageType === 'network.peer-state' && m.retryOutcome === 'REFUSED',
            ),
          ).toBe(false);
          await p.send(retry);
          expect(state().retryOutcome).toBe('CONFIRMED');
          expect(h.db.serialize().equals(hostBytes)).toBe(true);
          expect(p.db.serialize().equals(localBytes)).toBe(true);
          expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_disconnect_retry').get()).toEqual(
            { n: 1 },
          );
        });
        it('refuses a settlement WATCH until a new paired reconnect covers that settlement', async () => {
          const before = p.db.serialize();
          await p.send({ ...watch(), commandIdOrNull: attempt });
          expect(state()).toMatchObject({
            retryOutcome: 'REFUSED',
            diagnosticOrNull: 'REQUEST_REFUSED',
            formOrNull: { formId: 'NET-009' },
          });
          expect(p.db.serialize().equals(before)).toBe(true);
        });
        it('performs paired reconnect without inventing pre-Start NET010 PEACE', async () => {
          const reconnectId = randomUUID();
          await p.send({
            messageType: 'network.local-context.resume',
            protocolVersion: 3,
            networkScopeId: p.scope().networkScopeId,
            reconnectRequestId: reconnectId,
            knownRevisions: vector(p.state()),
            supportedWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
            unacknowledgedCommandIds: [],
          });
          expect(
            p.sent.find((m) => m.messageType === 'session.reconnect.capabilities'),
          ).toMatchObject({
            reconnectRequestId: reconnectId,
          });
          expect(p.sent.find((m) => m.messageType === 'projection.snapshot')).toMatchObject({
            presentation: {
              assignment: { reason: 'RECONNECT', correlationId: reconnectId },
              base: { formId: 'NET-005' },
            },
          });
          await p.send({ ...watch(), commandIdOrNull: attempt });
          expect(state()).toMatchObject({ connectionState: 'CONNECTED', formOrNull: null });
          expect(p.state().requestOrNull).toEqual(request);
          expect(h.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual(
            initialCopies,
          );
          expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_disconnect_retry').get()).toEqual(
            {
              n: 1,
            },
          );
        });
      });
    });
  });
  it('retains pinned endpoint and explicit reconnect intent across lost acknowledgement and local reopen', async () => {
    const { p } = await submittedPlayer(h);
    p.disconnect();
    const scope = p.scope(),
      address = parseCampaignLanAddress(p.state().addressOrQrPayload).canonicalOrigin;
    let peer = createLocalNetworkPeer({ database: p.db, baseline, config });
    cleaners.push(() => {
      peer.close();
      return Promise.resolve();
    });
    await peer.reconnect(scope, address, h.campaignId);
    const first = await peer.readConnection(scope, () => {});
    const stable = p.db.serialize();
    await peer.readConnection(scope, () => {});
    expect(p.db.serialize().equals(stable)).toBe(true);
    await nav('CMP-008', 'CMP-008::CTA::007');
    const disconnect = campaignLifecycleGmRequest(
      await current(),
      'NET-023::CTA::002',
      randomUUID(),
      {
        deviceId: scope.ownerDeviceId,
        selectedControllerSeatOrNull: null,
        reason: 'Ручной повтор после отключения',
      },
    );
    await gm.send(disconnect);
    expect(gm.sent[0]?.messageType).toBe('command.result');
    await peer.reconnect(scope, address, h.campaignId);
    const blocked = await peer.readConnection(scope, () => {});
    expect(blocked.campaignRevision).toBeGreaterThan(first.campaignRevision);
    const state = readLocalCampaignConnection(p.db, scope);
    const intent = {
      commandId: randomUUID(),
      expectedConnectionRevision: state.revision,
      canonicalOrigin: address,
      disconnectCommandIdOrNull: disconnect.commandId,
    };
    prepareLocalCampaignReconnect(p.db, scope, intent, () => {});
    const pendingBytes = p.db.serialize();
    prepareLocalCampaignReconnect(p.db, scope, intent, () => {});
    expect(p.db.serialize().equals(pendingBytes)).toBe(true);
    expect(() =>
      prepareLocalCampaignReconnect(
        p.db,
        scope,
        { ...intent, canonicalOrigin: 'http://127.0.0.1:1' },
        () => {},
      ),
    ).toThrow();
    expect(p.db.serialize().equals(pendingBytes)).toBe(true);
    const lostAcknowledgement = vi
      .spyOn(localConnectionStore, 'observeLocalCampaignConnection')
      .mockImplementationOnce(() => {
        throw Error('Lost committed reconnect ACK before local persistence');
      });
    await expect(peer.retryConnection(scope, intent, () => {})).rejects.toThrow();
    lostAcknowledgement.mockRestore();
    expect(readLocalCampaignConnection(p.db, scope).pendingOrNull).toEqual(intent);
    // Channel observation writes its own GM projection events; isolate peer replay's no-write proof.
    gm.runtime.close();
    const hostBytes = h.db.serialize();
    peer.close();
    const reopened = openPersistenceDatabase(p.path);
    peer = createLocalNetworkPeer({ database: reopened, baseline, config });
    try {
      expect(readLocalCampaignConnection(reopened, scope).pendingOrNull).toEqual(intent);
      await peer.reconnect(scope, address, h.campaignId);
      const result = await peer.retryConnection(scope, intent, () => {});
      expect(result).toMatchObject({
        lastAuthenticatedEndpoint: address,
        pendingOrNull: null,
        statusOrNull: { disconnectOrNull: { retryReceiptOrNull: { commandId: intent.commandId } } },
      });
      expect(h.db.serialize().equals(hostBytes)).toBe(true);
      const bytes = reopened.serialize();
      expect(prepareLocalCampaignReconnect(reopened, scope, intent, () => {})).toEqual(result);
      expect(reopened.serialize().equals(bytes)).toBe(true);
    } finally {
      peer.close();
      reopened.close();
    }
  });
  it('rejects local reconnect settlement without a fresh authenticated endpoint and rolls back hostile guards', async () => {
    const { p } = await submittedPlayer(h);
    p.disconnect();
    const scope = p.scope(),
      address = parseCampaignLanAddress(p.state().addressOrQrPayload).canonicalOrigin;
    const peer = createLocalNetworkPeer({ database: p.db, baseline, config });
    try {
      const channel = await peer.reconnect(scope, address, h.campaignId);
      await peer.readConnection(scope, () => {});
      const state = readLocalCampaignConnection(p.db, scope);
      const intent = {
        commandId: randomUUID(),
        expectedConnectionRevision: state.revision,
        canonicalOrigin: 'http://127.0.0.1:1',
        disconnectCommandIdOrNull: null,
      };
      prepareLocalCampaignReconnect(p.db, scope, intent, () => {});
      const settle = () =>
        settleLocalCampaignReconnect(
          p.db,
          scope,
          randomUUID(),
          { commandId: intent.commandId, outcome: 'CONFIRMED', receiptOrNull: null },
          () => {},
        );
      let bytes = p.db.serialize();
      expect(settle).toThrow();
      expect(p.db.serialize().equals(bytes)).toBe(true);
      // A new observation of A still cannot acknowledge the explicitly requested endpoint B.
      await peer.readConnection(scope, () => {});
      bytes = p.db.serialize();
      expect(settle).toThrow();
      expect(p.db.serialize().equals(bytes)).toBe(true);
      const locatorEventId = randomUUID(),
        locatorSource = readLocalCampaignConnection(p.db, scope);
      const locator = {
        commandId: intent.commandId,
        expectedConnectionRevision: locatorSource.revision,
        canonicalOrigin: address,
      };
      const corrected = replaceLocalCampaignReconnectLocator(
        p.db,
        scope,
        locatorEventId,
        locator,
        () => {},
      );
      expect(corrected.pendingOrNull).toEqual({ ...intent, canonicalOrigin: address });
      bytes = p.db.serialize();
      expect(settle).toThrow();
      expect(p.db.serialize().equals(bytes)).toBe(true);
      await peer.readConnection(scope, () => {});
      const newerLocator = {
        ...locator,
        expectedConnectionRevision: readLocalCampaignConnection(p.db, scope).revision,
        canonicalOrigin: intent.canonicalOrigin,
      };
      replaceLocalCampaignReconnectLocator(p.db, scope, randomUUID(), newerLocator, () => {});
      bytes = p.db.serialize();
      expect(
        replaceLocalCampaignReconnectLocator(p.db, scope, locatorEventId, locator, () => {})
          .pendingOrNull?.canonicalOrigin,
      ).toBe(intent.canonicalOrigin);
      expect(p.db.serialize().equals(bytes)).toBe(true);
      expect(settle).toThrow();
      expect(p.db.serialize().equals(bytes)).toBe(true);
      const observation = {
        identity: channel.hostIdentity,
        canonicalOrigin: intent.canonicalOrigin,
        status: state.statusOrNull!,
      };
      expect(() =>
        observeLocalCampaignConnection(p.db, scope, randomUUID(), observation, () => {
          p.db.exec('CREATE TABLE forbidden_connection_guard (x INTEGER)');
        }),
      ).toThrow();
      expect(p.db.serialize().equals(bytes)).toBe(true);
      expect(() =>
        observeLocalCampaignConnection(
          p.db,
          scope,
          randomUUID(),
          { ...observation, identity: { ...observation.identity, ownerDeviceId: randomUUID() } },
          () => {},
        ),
      ).toThrow();
      expect(p.db.serialize().equals(bytes)).toBe(true);
      // Storage accepts only the host-supplied authenticated observation; this fixture tests its fold.
      observeLocalCampaignConnection(p.db, scope, randomUUID(), observation, () => {});
      expect(settle()).toMatchObject({
        pendingOrNull: null,
        lastAuthenticatedEndpoint: intent.canonicalOrigin,
      });
      const status = state.statusOrNull!;
      observeLocalCampaignConnection(
        p.db,
        scope,
        randomUUID(),
        { ...observation, status: { ...status, campaignRevision: 10 } },
        () => {},
      );
      bytes = p.db.serialize();
      expect(() =>
        observeLocalCampaignConnection(
          p.db,
          scope,
          randomUUID(),
          {
            ...observation,
            status: {
              ...status,
              campaignRevision: 11,
              disconnectOrNull: {
                disconnectCommandId: randomUUID(),
                campaignRevision: 9,
                reason: 'Impossible historical disconnect',
                retryReceiptOrNull: null,
              },
            },
          },
          () => {},
        ),
      ).toThrow();
      expect(p.db.serialize().equals(bytes)).toBe(true);
      const d1 = {
        disconnectCommandId: randomUUID(),
        campaignRevision: 11,
        reason: 'First',
        retryReceiptOrNull: null,
      };
      observeLocalCampaignConnection(
        p.db,
        scope,
        randomUUID(),
        { ...observation, status: { ...status, campaignRevision: 11, disconnectOrNull: d1 } },
        () => {},
      );
      const d2 = {
        ...d1,
        disconnectCommandId: randomUUID(),
        campaignRevision: 12,
        reason: 'Second',
      };
      observeLocalCampaignConnection(
        p.db,
        scope,
        randomUUID(),
        { ...observation, status: { ...status, campaignRevision: 12, disconnectOrNull: d2 } },
        () => {},
      );
      bytes = p.db.serialize();
      expect(() =>
        observeLocalCampaignConnection(
          p.db,
          scope,
          randomUUID(),
          {
            ...observation,
            status: {
              ...status,
              campaignRevision: 13,
              disconnectOrNull: { ...d1, campaignRevision: 13 },
            },
          },
          () => {},
        ),
      ).toThrow();
      expect(p.db.serialize().equals(bytes)).toBe(true);
    } finally {
      peer.close();
    }
  });
  it('disconnects only captured channels, requires an explicit own retry, and never re-disconnects on replay', async () => {
    const { p } = await submittedPlayer(h);
    const material = loadNetworkInstallation(p.db),
      session = p.state().sessionOrNull!;
    p.disconnect();
    const old = await h.connect(material);
    expect(
      decodeCampaignConnectionPeerResponse(
        await old.call(
          encodeCampaignConnectionPeerCommand({
            schemaVersion: 1,
            operation: 'CAMPAIGN_CONNECTION_READ',
          }),
        ),
      ),
    ).toMatchObject({ outcome: 'STATUS' });
    await nav('CMP-008', 'CMP-008::CTA::007');
    const before = await current();
    expect(before.devices).toContainEqual(
      expect.objectContaining({ deviceId: material.ownerDeviceId, connected: true }),
    );
    const request = campaignLifecycleGmRequest(before, 'NET-023::CTA::002', randomUUID(), {
      deviceId: material.ownerDeviceId,
      selectedControllerSeatOrNull: null,
      reason: 'Перерыв для устройства',
    });
    const origin = readHostedCampaignCreationOrigin(h.db, h.campaignId, h.validate);
    const copies = h.db.prepare('SELECT * FROM campaign_character_copy').all();
    await gm.send(request);
    expect(gm.sent[0], JSON.stringify(gm.sent)).toMatchObject({ messageType: 'command.result' });
    const committed = structuredClone(gm.sent[0]);
    await expect.poll(() => old.closed).toBe(true);
    expect(readHostedCampaignCreationOrigin(h.db, h.campaignId, h.validate)).toEqual(origin);
    expect(h.db.prepare('SELECT * FROM campaign_character_copy').all()).toEqual(copies);
    const blocked = await h.connect(material);
    const status = decodeCampaignConnectionPeerResponse(
      await blocked.call(
        encodeCampaignConnectionPeerCommand({
          schemaVersion: 1,
          operation: 'CAMPAIGN_CONNECTION_READ',
        }),
      ),
    );
    expect(status).toMatchObject({
      outcome: 'STATUS',
      status: {
        deviceId: material.ownerDeviceId,
        disconnectOrNull: {
          disconnectCommandId: request.commandId,
          reason: 'Перерыв для устройства',
          retryReceiptOrNull: null,
        },
      },
    });
    await expect(
      blocked.call(
        encodeAdmissionCapacityCommand({
          schemaVersion: 1,
          operation: 'ADMISSION_CAPACITY_READ',
          technicalSessionId: session.technicalSessionId,
        }),
      ),
    ).rejects.toThrow();
    const quarantined = await h.connect(material);
    expect(
      decodeCampaignConnectionPeerResponse(
        await quarantined.call(
          encodeCampaignConnectionPeerCommand({
            schemaVersion: 1,
            operation: 'CAMPAIGN_CONNECTION_READ',
          }),
        ),
      ),
    ).toMatchObject({
      outcome: 'STATUS',
      status: { disconnectOrNull: { retryReceiptOrNull: null } },
    });
    const fresh = await h.connect(material),
      retry = {
        schemaVersion: 1 as const,
        operation: 'CAMPAIGN_CONNECTION_RETRY' as const,
        commandId: randomUUID(),
        disconnectCommandId: request.commandId,
      };
    const checkpointCount = () =>
      h.db.prepare('SELECT COUNT(*) AS n FROM campaign_checkpoint').get();
    const checkpoints = checkpointCount();
    const retried = decodeCampaignConnectionPeerResponse(
      await fresh.call(encodeCampaignConnectionPeerCommand(retry)),
    );
    expect(retried).toMatchObject({
      outcome: 'RETRIED',
      receipt: { commandId: retry.commandId },
      status: { disconnectOrNull: { retryReceiptOrNull: { commandId: retry.commandId } } },
    });
    const retryBytes = h.db.serialize();
    expect(
      decodeCampaignConnectionPeerResponse(
        await fresh.call(encodeCampaignConnectionPeerCommand(retry)),
      ),
    ).toEqual(retried);
    expect(h.db.serialize().equals(retryBytes)).toBe(true);
    expect(checkpointCount()).toEqual(checkpoints);
    await gm.send(request);
    expect(gm.sent[0]).toEqual({
      ...committed,
      messageType: 'command.replay',
      lifecycleState: 'IDEMPOTENT_REPLAY',
    });
    expect(fresh.closed).toBe(false);
    expect(
      decodeCampaignConnectionPeerResponse(
        await fresh.call(
          encodeCampaignConnectionPeerCommand({
            schemaVersion: 1,
            operation: 'CAMPAIGN_CONNECTION_READ',
          }),
        ),
      ),
    ).toMatchObject({ outcome: 'STATUS' });
    expect(checkpointCount()).toEqual(checkpoints);
    const again = campaignLifecycleGmRequest(await current(), 'NET-023::CTA::002', randomUUID(), {
      deviceId: material.ownerDeviceId,
      selectedControllerSeatOrNull: null,
      reason: 'Второе отключение',
    });
    await gm.send(again);
    expect(gm.sent[0]?.messageType).toBe('command.result');
    await expect.poll(() => quarantined.closed).toBe(true);
    const last = await h.connect(material);
    const oldRetry = decodeCampaignConnectionPeerResponse(
      await last.call(encodeCampaignConnectionPeerCommand(retry)),
    );
    expect(oldRetry).toMatchObject({
      outcome: 'RETRIED',
      receipt: { commandId: retry.commandId },
      status: {
        disconnectOrNull: { disconnectCommandId: again.commandId, retryReceiptOrNull: null },
      },
    });
    await expect(
      last.call(
        encodeAdmissionCapacityCommand({
          schemaVersion: 1,
          operation: 'ADMISSION_CAPACITY_READ',
          technicalSessionId: session.technicalSessionId,
        }),
      ),
    ).rejects.toThrow();
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_disconnect_retry').get()).toEqual({
      n: 1,
    });
  });
  it('changes pre-Start capacity through CMP-014 without creating or evicting characters', async () => {
    await nav('CMP-008', 'CMP-008::CTA::005');
    const p = await current(),
      request = campaignLifecycleGmRequest(p, 'CMP-014::CTA::002', randomUUID(), {
        newCapacity: 1,
      });
    expect((await gm.runtime.project(gm.c)).layers?.[0]?.formId).toBe('CMP-014');
    await gm.send(request);
    expect(gm.sent[0], JSON.stringify(gm.sent)).toMatchObject({ messageType: 'command.result' });
    expect(await current()).toMatchObject({
      currentCapacity: 1,
      activePlayerCount: 0,
      settingsRevision: 1,
    });
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_character_copy').get()).toEqual({
      n: 0,
    });
    expect((await gm.runtime.project(gm.c)).layers).toEqual([]);
  });
  it('rejects stale, foreign, invalid fields and forged raw secret fields with byte-identical storage', async () => {
    const p = await current(),
      request = campaignLifecycleGmRequest(p, 'CMP-008::CTA::008', randomUUID(), {
        title: 'Не должно записаться',
        descriptionOrNull: null,
        defaultFutureRollMode: 'MANUAL',
        network: p.networkForNextLaunch,
      });
    for (const bad of [
      {
        ...request,
        expectedRevisions: {
          ...request.expectedRevisions,
          stateRevision: request.expectedRevisions.stateRevision + 1,
        },
      },
      { ...request, payload: { ...request.payload, campaignId: randomUUID() } },
      {
        ...request,
        payload: {
          ...request.payload,
          network: { ...p.networkForNextLaunch, networkInterface: 'absent-interface' },
        },
      },
      { ...request, payload: { ...request.payload, currentMasterPassword: 'must never persist' } },
      { ...request, payload: { ...request.payload, title: '' } },
    ]) {
      const before = h.db.serialize();
      await gm.send(bad);
      expect(gm.sent).toHaveLength(1);
      expect(gm.sent[0]).toMatchObject({ messageType: 'command.refusal' });
      expect(h.db.serialize().equals(before)).toBe(true);
    }
  });
  it.each(['queued GM tab', 'lost trust'] as const)(
    'rechecks %s after real password verification yields',
    async (change) => {
      await nav('CMP-008', 'CMP-008::CTA::006');
      let started!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
          started = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve;
        }),
        realVerify = campaignSecretModule.verifyMasterSecret;
      const spy = vi
        .spyOn(campaignSecretModule, 'verifyMasterSecret')
        .mockImplementationOnce(async (...args) => {
          // Signal before yielding so the competing tab precedes unrelated timer polling.
          // The real password verification and gate still finish before the handler resumes.
          started();
          const result = await realVerify(...args);
          await gate;
          return result;
        });
      const request = campaignLifecycleGmRequest(
          await current(),
          'CMP-015::CTA::003',
          randomUUID(),
          {
            currentMasterPassword: 'Valid fixture secret',
            newMasterPassword: 'New valid fixture secret',
            newMasterPasswordConfirmation: 'New valid fixture secret',
          },
        ),
        before = h.db.serialize();
      const command = gm.send(request);
      await entered;
      const queued =
        change === 'queued GM tab'
          ? gm.gmScheduler.wire({ ...gm.c }, () => Promise.resolve())
          : Promise.resolve();
      const trustSpy =
        change === 'lost trust' ? vi.spyOn(gm.c, 'trusted').mockReturnValue(false) : null;
      try {
        release();
        await command;
        await queued;
        expect(gm.sent).toHaveLength(1);
        expect(gm.sent[0]).toMatchObject({ messageType: 'command.refusal' });
        expect(h.db.serialize().equals(before)).toBe(true);
      } finally {
        release();
        spy.mockRestore();
        trustSpy?.mockRestore();
      }
    },
  );
  it('checks private password proofs, persists no raw secret, and replays A-to-B after B-to-C', async () => {
    await nav('CMP-008', 'CMP-008::CTA::006');
    const a = 'Valid fixture secret',
      b = 'Changed fixture secret B',
      c = 'Changed fixture secret C';
    const first = campaignLifecycleGmRequest(await current(), 'CMP-015::CTA::003', randomUUID(), {
      currentMasterPassword: a,
      newMasterPassword: b,
      newMasterPasswordConfirmation: b,
    });
    const before = h.db.serialize();
    await gm.send({
      ...first,
      payload: { ...first.payload, currentMasterPassword: 'Incorrect existing secret' },
    });
    expect(gm.sent[0]).toMatchObject({ messageType: 'command.refusal' });
    expect(h.db.serialize().equals(before)).toBe(true);
    await gm.send(first);
    expect(gm.sent[0], JSON.stringify(gm.sent)).toMatchObject({ messageType: 'command.result' });
    const original = structuredClone(gm.sent[0]);
    await nav('CMP-008', 'CMP-008::CTA::006');
    const second = campaignLifecycleGmRequest(await current(), 'CMP-015::CTA::003', randomUUID(), {
      currentMasterPassword: b,
      newMasterPassword: c,
      newMasterPasswordConfirmation: c,
    });
    await gm.send(second);
    expect(gm.sent[0], JSON.stringify(gm.sent)).toMatchObject({ messageType: 'command.result' });
    const after = h.db.serialize();
    await gm.send(first);
    expect(gm.sent[0]).toEqual({
      ...original,
      messageType: 'command.replay',
      lifecycleState: 'IDEMPOTENT_REPLAY',
    });
    expect(h.db.serialize().equals(after)).toBe(true);
    for (const secret of [a, b, c]) {
      expect(h.db.serialize().includes(Buffer.from(secret))).toBe(false);
      expect(JSON.stringify(gm.sent)).not.toContain(secret);
    }
    expect(JSON.stringify(gm.sent)).not.toMatch(
      /saltBase64|verifierBase64|beforeVerifier|afterVerifier/,
    );
  });
};

export function registerTransportAndReview() {
  describe('local network application with durable SQLite and real Node peers', transportCases);
  describe('actual GM request review orchestration', gmReviewCases);
  describe('NET-016 and shared CMP-007/GM-001/GRP-001 campaign lobby', preStartPanelCases);
}
export function registerGmLifecycle() {
  describe('#174 actual GM lifecycle handlers', gmLifecycleCases);
}
