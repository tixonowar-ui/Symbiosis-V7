import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { configurePersistenceDatabase } from '../persistence/database.js';
import { applyMigrations, applyMigrationSequence } from '../persistence/migrations/index.js';
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
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import { campaignQrPayload } from '@shared/campaign-creation.js';
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
  readHostedCampaignCreationOrigin,
  commitCampaignDraftUpdate,
  navigateCampaignDraft,
  commitCampaignCreation,
  type RedactedCampaignDraftRequest,
} from '../persistence/campaign-creation.js';
import { readHostedCurrentPausedCampaign } from '../persistence/current-paused-campaign.js';
import {
  readHostedNetworkCommand,
  readGmRequestReviewSource,
  commitHostedNetworkCommand,
  readHostedDeviceRequest,
  readHostedPausedCampaignIds,
  type HostedNetworkPrincipal,
  commitGmRequestReviewNavigation,
  commitGmRequestReviewDraft,
  readGmRequestReviewView,
  commitGmDeviceRequestDecision,
} from '../persistence/network-device-request.js';
import {
  commitAdmissionReviewOpen,
  commitAdmissionReviewEdit,
  type AdmissionReviewRead,
} from '../persistence/campaign-admission-review.js';
import {
  commitAdmissionGmDecision,
  readAdmissionDecision,
} from '../persistence/campaign-admission-decision.js';
import { createCampaignAdmissionRules } from './campaign-admission-service.js';
import { validateFinalAdmissionReviewSource } from './device-admission-candidate.js';
import { deriveAdmissionSourceProperties } from './campaign-admission-inventory.js';
import {
  encodeAdmissionPeerCommand,
  decodeAdmissionPeerResponse,
  encodeAdmissionCapacityCommand,
  decodeAdmissionCapacityResponse,
  type AdmissionPeerCommand,
  type AdmissionPeerResponse,
} from './campaign-admission-peer-codec.js';
import { validateAdmissionOwnerPublication } from '../persistence/local-campaign-admission.js';
import {
  admissionPlayerDecisionReceiptValue,
  admissionGmDecisionNotice,
  type AdmissionOwnerPublication,
  type AdmissionPlayerDecisionRequest,
} from '@shared/campaign-admission-proposal.js';
import type { AdmissionReviewMutation } from '@shared/campaign-admission-review.js';
import type { NetworkPreparedBatch } from '../persistence/network-local-application.js';
import { loadCampaignCheckpoint } from '../persistence/store.js';
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
import { prepareOwnedFinalAdmissionCandidate } from './device-admission-candidate.js';
import { createCampaignBindManager } from './campaign-bind.js';
import { createCampaignNetworkEndpoint } from './campaign-network-endpoint.js';
import { createCampaignNetworkExecutor } from './campaign-network-executor.js';
import { initializeNetworkInstallation, loadNetworkInstallation } from './network-installation.js';
import {
  campaignPeerPublicIdentity,
  generateDeviceInstallationIdentityMaterial,
} from './campaign-peer-identity.js';
import { acceptCampaignPeerChannel, connectCampaignPeerChannel } from './campaign-peer-channel.js';
import { parseCampaignLanAddress } from './campaign-lan-address.js';
import { validatePeerCampaignHeader } from './campaign-peer-handshake.js';
import { prepareMasterSecret, validateMasterSecretVerifier } from './campaign-secret.js';
import {
  encodeDeviceAdmissionPeerCommand,
  type DeviceAdmissionPeerCommand,
} from './device-admission-peer-commands.js';
import {
  decodeDeviceAdmissionPeerResponse,
  deviceAdmissionSubmitSemanticBody,
  type DeviceAdmissionPeerResponse,
  type PeerSessionHeader,
} from './device-admission-peer-response.js';
import {
  createDeviceAdmissionPeerRuntime,
  type DeviceAdmissionPeerRuntimeLimits,
} from './device-admission-peer-runtime.js';

let baseline: LocalCharacterExportBaseline, secret: Awaited<ReturnType<typeof prepareMasterSecret>>;
let player: Awaited<ReturnType<typeof createCreationFinalizationSetup>>;
let candidate: ReturnType<typeof prepareOwnedFinalAdmissionCandidate>;
let playerMaterial: ReturnType<typeof initializeNetworkInstallation>;
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const vector = (v: typeof zero) => ({
  stateRevision: v.stateRevision,
  projectionRevision: v.projectionRevision,
  actorVisibilityRevision: v.actorVisibilityRevision,
});
const limits: DeviceAdmissionPeerRuntimeLimits = {
  maxSubmitBodyBytes: 4 * 1024 * 1024,
  maxWitnessBytes: 2 * 1024 * 1024,
  maxChunkBytes: 64 * 1024,
  timeoutMs: 3000,
  maxActiveTransfers: 4,
  maxStagedBytes: 16 * 1024 * 1024,
  maxChannels: 16,
};
const commandLimits = {
  maxSubmitBodyBytes: limits.maxSubmitBodyBytes,
  maxWitnessBytes: limits.maxWitnessBytes,
  maxChunkBytes: limits.maxChunkBytes,
};
const channelLimits = {
  handshakeTimeoutMs: 2000,
  rpcTimeoutMs: 2000,
  maxQueuedFrames: 8,
  maxQueuedBytes: 512 * 1024,
  maxPendingCalls: 4,
};
const cleaners: (() => Promise<void>)[] = [];
const dirs: string[] = [];
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  secret = await prepareMasterSecret('Valid fixture secret', 'Valid fixture secret');
  player = await createCreationFinalizationSetup({
    prefix: 'actual-peer-source',
    raceChoice: 'FREE',
    diceInputMode: 'AUTO',
  });
  let current = commitCreationFinalization(
    player.setup.database,
    creationPropertySummaryRequest(player.current, 'peer-source-summary'),
    'peer-source-summary-receipt',
    player.dependencies,
  );
  current = commitCreationFinalization(
    player.setup.database,
    creationFinalSaveRequest(current, 'peer-source-final'),
    'peer-source-final-receipt',
    player.dependencies,
  );
  const db = player.setup.database,
    catalog = player.setup.catalog;
  playerMaterial = initializeNetworkInstallation(db);
  candidate = prepareOwnedFinalAdmissionCandidate(
    {
      database: db,
      baseline,
      symbiontCatalog: catalog,
      loadCheckpoint: (id) => loadCreationWizardCheckpoint(db, id, catalog.skillStage, catalog),
      resumeForm: (c) => c.nextStageEnvelope.formId,
    },
    loadDeviceId(db),
    current.localCharacter.localCharacterId,
    { maxWitnessBytes: limits.maxWitnessBytes },
  );
});
afterEach(async () => {
  for (const close of cleaners.splice(0).reverse()) await close();
});
afterAll(() => {
  if (player.setup.database.open) player.setup.database.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Actual CREATE, secret and held-listener source fixture; no production authority provider. */
async function host(
  options: {
    path?: string;
    port?: number;
    campaignId?: string;
    capacity?: number;
    limits?: Partial<DeviceAdmissionPeerRuntimeLimits>;
    legacySeed?: (
      db: Database.Database,
      principal: HostedNetworkPrincipal,
      current: ReturnType<typeof readHostedCurrentPausedCampaign>,
    ) => void;
  } = {},
) {
  const db =
    options.legacySeed === undefined
      ? openPersistenceDatabase(options.path ?? ':memory:')
      : new Database(options.path ?? ':memory:');
  if (options.legacySeed !== undefined) {
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
  const principal: HostedNetworkPrincipal = {
    hostOwnerDeviceId: owner,
    campaignId,
    peerIdentity: campaignPeerPublicIdentity(playerMaterial),
  };
  if (options.legacySeed !== undefined) {
    options.legacySeed(db, principal, header());
    applyMigrations(db);
  }
  const ex = createCampaignNetworkExecutor({ maxScopes: 1024, maxScopeBytes: 8 * 1024 * 1024 }),
    runtime = createDeviceAdmissionPeerRuntime({
      database: db,
      baseline,
      executor: ex,
      limits: { ...limits, ...options.limits },
    });
  const errors: string[] = [];
  const endpoint = createCampaignNetworkEndpoint({
    shellServer: http,
    bind,
    maxConnections: 64,
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

  return {
    db,
    campaignId,
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
type Host = Awaited<ReturnType<typeof host>>;
type Client = Awaited<ReturnType<Host['connect']>>;
const admissionLimits = {
  maxPublicationBytes: limits.maxSubmitBodyBytes,
  maxChunkBytes: limits.maxChunkBytes,
};
const admissionCall = async (
  client: Client,
  command: AdmissionPeerCommand,
): Promise<AdmissionPeerResponse> =>
  decodeAdmissionPeerResponse(
    await client.call(encodeAdmissionPeerCommand(command)),
    admissionLimits,
  );
const call = async (
  client: Client,
  command: DeviceAdmissionPeerCommand,
): Promise<DeviceAdmissionPeerResponse> =>
  decodeDeviceAdmissionPeerResponse(
    await client.call(encodeDeviceAdmissionPeerCommand(command, commandLimits)),
  );
async function opened(
  p: Host,
  client?: Client,
  commandId = 'open-command',
  attemptId = 'opaque-attempt',
) {
  const peer = client ?? (await p.connect());
  const command: Extract<DeviceAdmissionPeerCommand, { operation: 'CONNECTION_OPEN' }> = {
    schemaVersion: 1,
    operation: 'CONNECTION_OPEN',
    commandId,
    attemptId,
    campaignCheckpointSha256: p.header().checkpointSha256,
  };
  const response = await call(peer, command);
  expect(response.outcome).toBe('ACK');
  if (response.outcome !== 'ACK' || response.receipt.operation !== 'OPEN')
    throw new Error('Expected session');
  return { peer, command, response, session: response.receipt.session };
}
function batch(session: PeerSessionHeader): NetworkPreparedBatch {
  const rest = {
    schemaVersion: 2 as const,
    localControllerSeatId: randomUUID(),
    requestId: randomUUID(),
    technicalSessionId: session.technicalSessionId,
    connectionRevision: session.connectionRevision,
    campaignProof: session.campaignProof,
    candidates: [candidate],
  };
  return { ...rest, batchSha256: postSaveSha256(canonicalPostSaveJson(rest)) };
}
function withBatchHash(value: NetworkPreparedBatch): NetworkPreparedBatch {
  const { batchSha256: _old, ...rest } = value;
  return { ...rest, batchSha256: postSaveSha256(canonicalPostSaveJson(rest)) };
}
function begin(
  batch: NetworkPreparedBatch,
  commandId = 'submit-command',
  text = canonicalPostSaveJson(batch),
): Extract<DeviceAdmissionPeerCommand, { operation: 'DEVICE_REQUEST_BEGIN' }> {
  return {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_BEGIN',
    commandId,
    requestId: batch.requestId,
    technicalSessionId: batch.technicalSessionId,
    connectionRevision: batch.connectionRevision,
    campaignCheckpointSha256: batch.campaignProof.checkpointSha256,
    candidates: batch.candidates.map((c) => ({
      descriptor: c.descriptor,
      witnessSha256: c.witnessSha256,
      witnessByteLength: c.byteLength,
    })),
    submitBodySha256: postSaveSha256(text),
    submitBodyByteLength: Buffer.byteLength(text, 'utf8'),
  };
}
async function transferred(
  peer: Client,
  prepared: NetworkPreparedBatch,
  commandId = 'submit-command',
  text = canonicalPostSaveJson(prepared),
) {
  const started = await call(peer, begin(prepared, commandId, text));
  if (started.outcome !== 'TRANSFER_READY') return { started, result: started };
  const bytes = Buffer.from(text, 'utf8');
  let index = 0;
  for (let offset = 0; offset < bytes.length; offset += limits.maxChunkBytes) {
    const response = await call(peer, {
      schemaVersion: 1,
      operation: 'DEVICE_REQUEST_CHUNK',
      transferId: started.transferId,
      chunkIndex: index++,
      bytesBase64: bytes.subarray(offset, offset + limits.maxChunkBytes).toString('base64'),
    });
    expect(response.outcome).toBe('CHUNK_ACCEPTED');
  }
  return {
    started,
    result: await call(peer, {
      schemaVersion: 1,
      operation: 'DEVICE_REQUEST_COMMIT',
      transferId: started.transferId,
    }),
  };
}

describe('final admission over the actual authenticated peer channel', () => {
  let p: Host,
    connection: Awaited<ReturnType<typeof opened>>,
    prepared: NetworkPreparedBatch,
    review: AdmissionReviewRead;
  const allow = () => undefined;
  const scope = () => ({
    ownerDeviceId: p.principal.hostOwnerDeviceId,
    campaignId: p.campaignId,
    gmLocalContextId: readHostedCampaignCreationOrigin(p.db, p.campaignId, p.validate).command
      .request.payload.gmLocalContextId,
  });
  const rules = () => createCampaignAdmissionRules(baseline, limits.maxWitnessBytes);
  const binding = () => ({
    requestId: prepared.requestId,
    technicalSessionId: prepared.technicalSessionId,
    submitCommandId: 'submit-command',
  });
  beforeEach(async () => {
    p = await host({ limits: { maxActiveTransfers: 1 } });
    connection = await opened(p);
    prepared = batch(connection.session);
    expect((await transferred(connection.peer, prepared)).result.outcome).toBe('ACK');
  });
  const preliminary = () => {
    const s = scope();
    commitGmRequestReviewNavigation(
      p.db,
      s,
      {
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId: randomUUID(),
        sourceFormId: 'CMP-006',
        actionKey: 'CMP-006::CTA::002',
        expectedProjectionRevision: 0,
      },
      p.validate,
      allow,
    );
    const view = readGmRequestReviewView(p.db, s, p.validate)!;
    const selected = commitGmRequestReviewDraft(
      p.db,
      s,
      {
        messageType: 'network.gm-request-draft.replace',
        protocolVersion: 3,
        draftUpdateId: randomUUID(),
        scope: {
          gmLocalContextId: s.gmLocalContextId,
          campaignId: p.campaignId,
          sourceFormId: 'NET-017',
        },
        expectedRevisions: vector(view),
        expectedRequestQueueRevision: view.requestQueueRevision,
        values: { selectedRequestIdOrNull: prepared.requestId, decisionReason: '' },
      },
      p.validate,
      allow,
    ).current;
    return commitGmDeviceRequestDecision(
      p.db,
      s,
      {
        request: {
          messageType: 'command.request',
          protocolVersion: 1,
          commandKind: 'workflow-command',
          role: 'gm',
          workflowCommandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
          commandId: randomUUID(),
          expectedRevisions: vector(selected),
          payload: { campaignId: p.campaignId, requestId: prepared.requestId, requestRevision: 0 },
        },
        receiptId: randomUUID(),
        timestamp: '2026-11-01T00:01:00.000Z',
      },
      p.validate,
      allow,
    ).current;
  };
  const edit = (mutation: Extract<AdmissionReviewMutation, { kind: 'EDIT' | 'WEAPON' }>) => {
    review = commitAdmissionReviewEdit(
      p.db,
      scope(),
      {
        request: {
          commandId: randomUUID(),
          admissionBatchId: review.current.admissionBatchId,
          expectedReviewRevision: review.current.reviewRevision,
          intent: mutation,
        },
        receiptId: randomUUID(),
        timestamp: '2026-11-01T00:03:00.000Z',
      },
      p.validate,
      rules().rules,
      () => mutation,
      allow,
    ).review;
  };
  const capacityAt = async (peer: Client, technicalSessionId: string) =>
    decodeAdmissionCapacityResponse(
      await peer.call(
        encodeAdmissionCapacityCommand({
          schemaVersion: 1,
          operation: 'ADMISSION_CAPACITY_READ',
          technicalSessionId,
        }),
      ),
    );
  it('does not manufacture a publication before final GM review', async () => {
    const before = p.db.serialize();
    expect(
      await admissionCall(connection.peer, {
        schemaVersion: 1,
        operation: 'ADMISSION_PUBLICATION_BEGIN',
        ...binding(),
      }),
    ).toMatchObject({ outcome: 'NOT_READY' });
    expect(p.db.serialize().equals(before)).toBe(true);
    expect(await capacityAt(connection.peer, prepared.technicalSessionId)).toMatchObject({
      outcome: 'CAPACITY',
      occupiedCampaignPlaceCount: 0,
      alreadyImportedSourceUuids: [],
    });
  });
  describe('published whole proposal', () => {
    let decision: AdmissionPlayerDecisionRequest, publication: AdmissionOwnerPublication;
    beforeEach(() => {
      const view = preliminary(),
        service = rules();
      review = commitAdmissionReviewOpen(
        p.db,
        scope(),
        {
          request: {
            messageType: 'command.request',
            protocolVersion: 1,
            commandKind: 'workflow-command',
            role: 'gm',
            workflowCommandId: 'UI-CMD-ADMISSION-REVIEW-OPEN',
            commandId: randomUUID(),
            expectedRevisions: vector(view),
            payload: {
              campaignId: p.campaignId,
              requestId: prepared.requestId,
              requestRevision: 1,
            },
          },
          receiptId: randomUUID(),
          timestamp: '2026-11-01T00:02:00.000Z',
        },
        p.validate,
        service.rules,
        (request) => service.initial(request, randomUUID),
        allow,
      ).review;
    });
    beforeEach(() => {
      const copy = review.current.copies[0]!;
      edit({
        kind: 'EDIT',
        reviewCopyId: copy.reviewCopyId,
        inputs: {
          ...copy.inputs,
          groupAssignmentOrNull: { kind: 'START' },
          locationAssignmentOrNull: { location: 'Город', subLocationOrNull: null },
        },
      });
      const source = validateFinalAdmissionReviewSource(
        candidate.canonicalWitnessText,
        playerMaterial.ownerDeviceId,
        candidate.descriptor,
        candidate.exportDocument,
        baseline,
        { maxWitnessBytes: limits.maxWitnessBytes },
      );
      for (const property of deriveAdmissionSourceProperties(source))
        if (property.weaponRequestOrNull !== null)
          edit({
            kind: 'WEAPON',
            reviewCopyId: copy.reviewCopyId,
            input: {
              weaponReviewInput: { kind: 'VALIDATED_REQUEST', ...property.weaponRequestOrNull },
              decision: 'APPROVE',
              overrideProfileOrNull: null,
              reasonOrNull: null,
            },
          });
    });
    beforeEach(() => {
      const service = rules(),
        preview = service.rules.buildProposal(review, [null]);
      const published = commitAdmissionGmDecision(
        p.db,
        scope(),
        {
          request: {
            commandId: randomUUID(),
            campaignId: p.campaignId,
            admissionBatchId: review.current.admissionBatchId,
            reviewRevision: review.current.reviewRevision,
            expectedCampaignRevision: p.header().stateRevision,
            decision: 'ACCEPT',
            previewChecksumOrNull: preview.proposalChecksum,
            reasonOrNull: null,
          },
          receiptId: randomUUID(),
          timestamp: '2026-11-01T00:04:00.000Z',
        },
        p.validate,
        service.rules,
        randomUUID,
        allow,
      ).current;
      const proposal = published.gmDecisionOrNull!.proposalOrNull!;
      const body = {
        schemaVersion: 1 as const,
        gmDecision: admissionGmDecisionNotice(published.gmDecisionOrNull!.receipt),
        groupLabels: [],
        proposalOrNull: proposal,
      };
      publication = { ...body, publicationChecksum: postSaveSha256(canonicalPostSaveJson(body)) };
      decision = {
        commandId: randomUUID(),
        campaignId: p.campaignId,
        admissionBatchId: proposal.admissionBatchId,
        proposalRevision: proposal.proposalRevision,
        proposalChecksum: proposal.proposalChecksum,
        expectedCampaignRevision: p.header().stateRevision,
        decision: 'DECLINE',
        controllerPreparationOrNull: null,
      };
    });
    const recover = (): AdmissionPeerCommand => ({
      schemaVersion: 1,
      operation: 'ADMISSION_PLAYER_RECOVER',
      ...binding(),
      commandId: decision.commandId,
      admissionBatchId: decision.admissionBatchId,
      semanticBodySha256: postSaveSha256(canonicalPostSaveJson(decision)),
    });
    beforeEach(async () => {
      // Human GM review can outlive the idle transport. Resume the actual original session.
      connection = { ...connection, peer: await p.connect() };
      expect(
        await call(connection.peer, {
          schemaVersion: 1,
          operation: 'DEVICE_REQUEST_RECOVER',
          ...binding(),
        }),
      ).toMatchObject({ outcome: 'ACK' });
    });
    it('downloads exact canonical owner bytes, releases the shared slot and refuses another original request scope', async () => {
      const manifest = await admissionCall(connection.peer, {
        schemaVersion: 1,
        operation: 'ADMISSION_PUBLICATION_BEGIN',
        ...binding(),
      });
      if (manifest.outcome !== 'MANIFEST') throw new Error(JSON.stringify(manifest));
      const chunks: Buffer[] = [];
      for (let index = 0; index < manifest.chunkCount; index++) {
        const chunk = await admissionCall(connection.peer, {
          schemaVersion: 1,
          operation: 'ADMISSION_PUBLICATION_CHUNK',
          ...binding(),
          transferId: manifest.transferId,
          publicationChecksum: manifest.publicationChecksum,
          chunkIndex: index,
        });
        if (chunk.outcome !== 'CHUNK') throw new Error(JSON.stringify(chunk));
        chunks.push(Buffer.from(chunk.bytesBase64, 'base64'));
      }
      const bytes = Buffer.concat(chunks),
        publication = validateAdmissionOwnerPublication(
          JSON.parse(bytes.toString('utf8')) as unknown,
        );
      expect(bytes.length).toBe(manifest.byteLength);
      expect(postSaveSha256(bytes)).toBe(manifest.bodySha256);
      expect(publication.publicationChecksum).toBe(manifest.publicationChecksum);
      expect(publication.gmDecision.requestId).toBe(prepared.requestId);
      expect(
        publication.proposalOrNull!.fullCampaignCopyDiffs[0]!.campaignCharacterIdOrNull,
      ).not.toBeNull();
      expect(bytes.toString('utf8')).not.toContain('authoritativeGmActorId');
      expect(
        await admissionCall(connection.peer, {
          schemaVersion: 1,
          operation: 'ADMISSION_PUBLICATION_CHUNK',
          ...binding(),
          requestId: randomUUID(),
          transferId: manifest.transferId,
          publicationChecksum: manifest.publicationChecksum,
          chunkIndex: 0,
        }),
      ).toMatchObject({ outcome: 'REFUSED', code: 'TRANSFER_UNAVAILABLE' });
      const uploadFromAnotherDevice = async () => {
        const client = await p.connect(generateDeviceInstallationIdentityMaterial(randomUUID()));
        const next = await opened(p, client, randomUUID(), randomUUID());
        // The upload manifest is only a bounded reservation, never a trusted FINAL or a committed request.
        return call(client, begin(batch(next.session), randomUUID()));
      };
      expect(await uploadFromAnotherDevice()).toMatchObject({ outcome: 'TRANSFER_READY' });
      connection.peer.close();
      // Closing the completed download must not release the other device's reservation a second time.
      expect(await uploadFromAnotherDevice()).toMatchObject({
        outcome: 'REFUSED',
        code: 'TRANSFER_LIMIT',
      });
    });
    it('commits the whole decision and recovers the exact receipt after losing its first reply', async () => {
      const command: AdmissionPeerCommand = {
        schemaVersion: 1,
        operation: 'ADMISSION_PLAYER_DECIDE',
        ...binding(),
        decision,
      };
      const first = await admissionCall(connection.peer, command);
      expect(first.outcome, JSON.stringify(first)).toBe('DECIDED');
      if (first.outcome !== 'DECIDED') throw new Error(JSON.stringify(first));
      const receipt = admissionPlayerDecisionReceiptValue(
        JSON.parse(first.receiptCanonicalJson) as unknown,
        publication,
      );
      expect(receipt.decision).toBe('DECLINE');
      expect(
        receipt.copies.every((c) => c.lifecycleState === 'DECLINED' && !c.occupiesCampaignPlace),
      ).toBe(true);
      const next = await p.connect(),
        replay = await admissionCall(next, recover());
      expect(replay).toEqual({ ...first, operation: 'ADMISSION_PLAYER_RECOVER' });
      expect(
        await admissionCall(next, {
          ...recover(),
          commandId: randomUUID(),
        } as AdmissionPeerCommand),
      ).toMatchObject({ outcome: 'REFUSED', code: 'IDEMPOTENCY_CONFLICT' });
      expect(p.header().activePcCount).toBe(0);
    });
    it('fences late decisions before proving absence and releases the previous download', async () => {
      const first = await admissionCall(connection.peer, {
        schemaVersion: 1,
        operation: 'ADMISSION_PUBLICATION_BEGIN',
        ...binding(),
      });
      expect(first.outcome).toBe('MANIFEST');
      const next = await p.connect(),
        absent = await admissionCall(next, recover());
      expect(absent).toMatchObject({
        outcome: 'NOT_APPLIED',
        proof: {
          fenced: true,
          commandId: decision.commandId,
          requestId: prepared.requestId,
          technicalSessionId: prepared.technicalSessionId,
          code: 'NOT_APPLIED',
        },
      });
      expect(
        await admissionCall(connection.peer, {
          schemaVersion: 1,
          operation: 'ADMISSION_PLAYER_DECIDE',
          ...binding(),
          decision,
        }),
      ).toMatchObject({ outcome: 'REFUSED', code: 'STALE_GENERATION' });
      expect(
        readAdmissionDecision(p.db, scope(), decision.admissionBatchId, p.validate, rules().rules)
          .playerDecisionOrNull,
      ).toBeNull();
      expect(
        await admissionCall(next, {
          schemaVersion: 1,
          operation: 'ADMISSION_PUBLICATION_BEGIN',
          ...binding(),
        }),
      ).toMatchObject({ outcome: 'MANIFEST' });
    });
    it('returns fresh proof and occupied lobby places but only the authenticated owners imported sources', async () => {
      const before = await capacityAt(connection.peer, prepared.technicalSessionId);
      expect(before).toMatchObject({
        outcome: 'CAPACITY',
        occupiedCampaignPlaceCount: 0,
        alreadyImportedSourceUuids: [candidate.descriptor.sourceUuid],
      });
      const proposal = publication.proposalOrNull!;
      if (prepared.schemaVersion !== 2) throw new Error('Expected real submitted lane');
      const request: AdmissionPlayerDecisionRequest = {
        ...decision,
        decision: 'ACCEPT',
        controllerPreparationOrNull: {
          schemaVersion: 1,
          preparationId: randomUUID(),
          requestId: prepared.requestId,
          ownerDeviceId: playerMaterial.ownerDeviceId,
          campaignId: p.campaignId,
          admissionBatchId: proposal.admissionBatchId,
          proposalRevision: proposal.proposalRevision,
          proposalChecksum: proposal.proposalChecksum,
          controllerBindings: [
            {
              campaignCharacterId: proposal.fullCampaignCopyDiffs[0]!.campaignCharacterIdOrNull!,
              deviceId: playerMaterial.ownerDeviceId,
              localControllerSeatId: prepared.localControllerSeatId,
              inputLaneId: prepared.localControllerSeatId,
            },
          ],
        },
      };
      const accepted = await admissionCall(connection.peer, {
        schemaVersion: 1,
        operation: 'ADMISSION_PLAYER_DECIDE',
        ...binding(),
        decision: request,
      });
      expect(accepted.outcome, JSON.stringify(accepted)).toBe('DECIDED');
      const after = await capacityAt(connection.peer, prepared.technicalSessionId);
      expect(after).toMatchObject({
        outcome: 'CAPACITY',
        occupiedCampaignPlaceCount: 1,
        campaign: { activePcCount: 0 },
        alreadyImportedSourceUuids: [candidate.descriptor.sourceUuid],
      });
      if (after.outcome !== 'CAPACITY') throw new Error('Expected capacity');
      expect(after.campaign.checkpointSha256).toBe(p.header().checkpointSha256);
      expect(after.campaign.revisions.stateRevision).toBeGreaterThan(
        connection.peer.campaign.revisions.stateRevision,
      );
      const foreign = await p.connect(generateDeviceInstallationIdentityMaterial(randomUUID())),
        foreignSession = await opened(p, foreign, randomUUID(), randomUUID());
      expect(await capacityAt(foreign, foreignSession.session.technicalSessionId)).toMatchObject({
        outcome: 'CAPACITY',
        occupiedCampaignPlaceCount: 1,
        alreadyImportedSourceUuids: [],
      });
    });
    it('does not turn a different batch or corrupted terminal history into permission to replace an intent', async () => {
      const next = await p.connect();
      expect(
        await admissionCall(next, {
          ...recover(),
          admissionBatchId: randomUUID(),
        } as AdmissionPeerCommand),
      ).toMatchObject({ outcome: 'REFUSED', code: 'IDEMPOTENCY_CONFLICT' });
      p.db.pragma('foreign_keys = OFF');
      p.db.prepare('DELETE FROM campaign_admission_gm_decision').run();
      expect(await admissionCall(next, recover())).toMatchObject({ outcome: 'REFUSED' });
    });
  });
});

describe('actual owner-bound campaign peer application', () => {
  it('commits OPEN/SUBMIT/CANCEL with short receipts, source-backed replay and no copy/capacity/source mutation', async () => {
    const p = await host(),
      initial = loadCampaignCheckpoint(p.db, p.campaignId),
      playerBefore = player.setup.database.serialize();
    const a = await opened(p),
      prepared = batch(a.session),
      sent = await transferred(a.peer, prepared);
    expect(sent.result.outcome).toBe('ACK');
    if (sent.result.outcome !== 'ACK' || sent.result.receipt.operation !== 'SUBMIT')
      throw new Error('Expected submission');
    expect(sent.result.receipt.semanticBodySha256).toBe(
      postSaveSha256(deviceAdmissionSubmitSemanticBody('submit-command', prepared.batchSha256)),
    );
    const cancel = await call(a.peer, {
      schemaVersion: 1,
      operation: 'DEVICE_REQUEST_CANCEL',
      commandId: 'cancel-command',
      requestId: prepared.requestId,
      technicalSessionId: a.session.technicalSessionId,
      requestRevision: 0,
      reason: '  Own reason\nunchanged  ',
    });
    expect(cancel.outcome).toBe('ACK');
    const replay = await call(a.peer, begin(prepared));
    expect(replay.outcome).toBe('ACK');
    if (
      replay.outcome !== 'ACK' ||
      replay.receipt.operation !== 'SUBMIT' ||
      replay.current.kind !== 'REQUEST_REVIEW'
    )
      throw new Error('Expected replay');
    expect(replay.delivery).toBe('REPLAY');
    expect(replay.receipt.request.closureOrNull).toBeNull();
    expect(replay.current.request.closureOrNull?.reason).toBe('  Own reason\nunchanged  ');
    expect(loadCampaignCheckpoint(p.db, p.campaignId)).toEqual(initial);
    expect(p.header().activePcCount).toBe(0);
    expect(p.db.prepare('SELECT count(*) AS n FROM campaign_character_copy').get()).toEqual({
      n: 0,
    });
    expect(p.db.prepare('SELECT count(*) AS n FROM local_character').get()).toEqual({ n: 0 });
    expect(player.setup.database.serialize().equals(playerBefore)).toBe(true);
    const text = JSON.stringify([a.response, sent.result, cancel, replay]);
    for (const secret of [
      'canonicalWitnessText',
      'exportDocument',
      playerMaterial.privateKeyPkcs8Base64,
      'Valid fixture secret',
    ])
      expect(text).not.toContain(secret);
  });

  it('returns exact known OPEN receipt on a new physical channel without allocating another session', async () => {
    const p = await host(),
      a = await opened(p);
    a.peer.close();
    const fresh = await p.connect();
    const replay = await call(fresh, a.command);
    expect(replay.outcome).toBe('ACK');
    if (replay.outcome !== 'ACK') throw new Error('Expected replay');
    expect(replay.receipt).toEqual(a.response.receipt);
    expect(p.db.prepare('SELECT count(*) AS n FROM hosted_technical_session').get()).toEqual({
      n: 1,
    });
    const changed = await call(fresh, { ...a.command, campaignCheckpointSha256: '0'.repeat(64) });
    expect(changed).toMatchObject({ outcome: 'REFUSED', code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('explicit OPEN recovery renews the owned confirmed session before its first request and fences the old channel', async () => {
    const p = await host(),
      a = await opened(p),
      fresh = await p.connect(),
      prepared = batch(a.session),
      command = begin(prepared);
    expect(await call(fresh, command)).toMatchObject({
      outcome: 'REFUSED',
      code: 'STALE_GENERATION',
    });
    const recovered = await call(fresh, {
      schemaVersion: 1,
      operation: 'CONNECTION_RECOVER',
      commandId: a.command.commandId,
      attemptId: a.command.attemptId,
      semanticBodySha256: postSaveSha256(
        encodeDeviceAdmissionPeerCommand(a.command, commandLimits),
      ),
    });
    expect(recovered.outcome).toBe('ACK');
    if (recovered.outcome !== 'ACK') throw new Error('Expected confirmed session recovery');
    expect(recovered.receipt).toEqual(a.response.receipt);
    expect((await call(fresh, command)).outcome).toBe('TRANSFER_READY');
    expect(await call(a.peer, command)).toMatchObject({
      outcome: 'REFUSED',
      code: 'STALE_GENERATION',
    });
    expect(p.db.prepare('SELECT count(*) AS n FROM hosted_device_request').get()).toEqual({ n: 0 });
    expect(p.db.prepare('SELECT count(*) AS n FROM hosted_technical_session').get()).toEqual({
      n: 1,
    });
  });

  it('fenced negative OPEN recovery echoes exact correlation and blocks a late old physical OPEN', async () => {
    const p = await host(),
      old = await p.connect(),
      fresh = await p.connect();
    const command = {
      schemaVersion: 1 as const,
      operation: 'CONNECTION_OPEN' as const,
      commandId: 'absent-open',
      attemptId: 'absent-attempt',
      campaignCheckpointSha256: p.header().checkpointSha256,
    };
    // Register the old scope through a stale source refusal before any durable OPEN exists.
    expect(await call(old, { ...command, campaignCheckpointSha256: '0'.repeat(64) })).toMatchObject(
      { outcome: 'REFUSED' },
    );
    const semanticBodySha256 = postSaveSha256(
      encodeDeviceAdmissionPeerCommand(command, commandLimits),
    );
    const negative = await call(fresh, {
      schemaVersion: 1,
      operation: 'CONNECTION_RECOVER',
      commandId: command.commandId,
      attemptId: command.attemptId,
      semanticBodySha256,
    });
    expect(negative).toMatchObject({
      outcome: 'NOT_FOUND',
      commandId: command.commandId,
      attemptId: command.attemptId,
      semanticBodySha256,
      fenced: true,
    });
    const late = await call(old, command);
    expect(late).toMatchObject({ outcome: 'REFUSED' });
    expect(readHostedNetworkCommand(p.db, p.principal, command.commandId, p.validate)).toBeNull();
  });

  it('new-channel request NOT_FOUND fences staged bytes before a late old COMMIT', async () => {
    const p = await host(),
      a = await opened(p),
      prepared = batch(a.session),
      started = await call(a.peer, begin(prepared));
    if (started.outcome !== 'TRANSFER_READY') throw new Error('Expected transfer');
    const fresh = await p.connect();
    const negative = await call(fresh, {
      schemaVersion: 1,
      operation: 'DEVICE_REQUEST_RECOVER',
      requestId: prepared.requestId,
      technicalSessionId: a.session.technicalSessionId,
      submitCommandId: 'submit-command',
    });
    expect(negative).toMatchObject({
      outcome: 'NOT_FOUND',
      fenced: true,
      requestId: prepared.requestId,
      technicalSessionId: a.session.technicalSessionId,
      submitCommandId: 'submit-command',
    });
    expect(
      await call(a.peer, {
        schemaVersion: 1,
        operation: 'DEVICE_REQUEST_COMMIT',
        transferId: started.transferId,
      }),
    ).toMatchObject({ outcome: 'REFUSED' });
    expect(p.db.prepare('SELECT count(*) AS n FROM hosted_device_request').get()).toEqual({ n: 0 });
  });

  it.each(['export', 'witness', 'selfhash', 'extra'] as const)(
    'refuses a fully rehashed %s candidate/batch before any request write',
    async (kind) => {
      const p = await host(),
        a = await opened(p);
      let prepared = structuredClone(batch(a.session));
      if (kind === 'export') {
        const candidate = prepared.candidates[0]!,
          doc = { ...candidate.exportDocument } as Record<string, unknown>,
          mechanics = doc['mechanicsSnapshot'] as Record<string, unknown>;
        (mechanics['runtime'] as Record<string, unknown>)['maxHp'] = 99999;
        delete doc['checksum'];
        doc['checksum'] = postSaveSha256(canonicalPostSaveJson(doc));
        prepared = {
          ...prepared,
          candidates: [
            {
              ...candidate,
              exportDocument: doc as JsonObject,
              descriptor: {
                ...candidate.descriptor,
                exportChecksum: doc['checksum'] as string,
                exportBytesSha256: postSaveSha256(canonicalPostSaveJson(doc) + '\n'),
              },
            },
          ],
        };
      }
      if (kind === 'witness') {
        const candidate = prepared.candidates[0]!,
          w = JSON.parse(candidate.canonicalWitnessText) as Record<string, unknown>;
        w['ownerDeviceId'] = randomUUID();
        const text = canonicalPostSaveJson(w);
        prepared = {
          ...prepared,
          candidates: [
            {
              ...candidate,
              canonicalWitnessText: text,
              witnessSha256: postSaveSha256(text),
              byteLength: Buffer.byteLength(text),
            },
          ],
        };
      }
      prepared = withBatchHash(prepared);
      if (kind === 'selfhash') prepared = { ...prepared, batchSha256: '0'.repeat(64) };
      const text = canonicalPostSaveJson(
        kind === 'extra' ? { ...prepared, privateForeignField: 'PRIVATE_INPUT' } : prepared,
      );
      const result = await transferred(a.peer, prepared, 'submit-command', text);
      expect(result.result).toMatchObject({ outcome: 'REFUSED', code: 'INVALID_CANDIDATE' });
      expect(p.db.prepare('SELECT count(*) AS n FROM hosted_device_request').get()).toEqual({
        n: 0,
      });
    },
  );

  it('rejects changed peer keys on absent recovery reads and never returns a false fenced absence', async () => {
    const p = await host();
    await opened(p);
    const { generateDeviceInstallationIdentityMaterial } =
      await import('./campaign-peer-identity.js');
    const foreign = await p.connect(
      generateDeviceInstallationIdentityMaterial(playerMaterial.ownerDeviceId),
    );
    const response = await call(foreign, {
      schemaVersion: 1,
      operation: 'CONNECTION_RECOVER',
      commandId: 'unknown',
      attemptId: 'unknown',
      semanticBodySha256: 'a'.repeat(64),
    });
    expect(response).toMatchObject({ outcome: 'REFUSED', code: 'UNAVAILABLE' });
  });

  it('refuses a foreign key claiming the already-known host device UUID without poisoning its self-player pin', async () => {
    const p = await host(),
      { generateDeviceInstallationIdentityMaterial } = await import('./campaign-peer-identity.js'),
      forged = await p.connect(
        generateDeviceInstallationIdentityMaterial(p.principal.hostOwnerDeviceId),
      ),
      before = p.db.serialize();
    const response = await call(forged, {
      schemaVersion: 1,
      operation: 'CONNECTION_OPEN',
      commandId: 'self-id-impostor',
      attemptId: 'self-id-impostor-attempt',
      campaignCheckpointSha256: p.header().checkpointSha256,
    }).catch(() => null);
    expect(response?.outcome).not.toBe('ACK');
    expect(p.db.serialize().equals(before)).toBe(true);
    const actual = await p.connect(loadNetworkInstallation(p.db));
    expect((await opened(p, actual)).response.outcome).toBe('ACK');
  });

  it('preflights a duplicate receipt/current cancellation response before durable writes', async () => {
    const p = await host(),
      a = await opened(p),
      prepared = batch(a.session);
    await transferred(a.peer, prepared);
    const before = p.db.serialize();
    const response = await call(a.peer, {
      schemaVersion: 1,
      operation: 'DEVICE_REQUEST_CANCEL',
      commandId: 'oversize-cancel',
      requestId: prepared.requestId,
      technicalSessionId: a.session.technicalSessionId,
      requestRevision: 0,
      reason: 'x'.repeat(70 * 1024),
    });
    expect(response).toMatchObject({ outcome: 'REFUSED', code: 'TRANSFER_LIMIT' });
    expect(p.db.serialize().equals(before)).toBe(true);
    expect(
      readHostedDeviceRequest(p.db, p.principal, prepared.requestId, p.validate).closureOrNull,
    ).toBeNull();
  });

  it('keeps the original request bytes/receipt across actual SQLite close/reopen and recovers without resubmit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'peer-runtime-reopen-'));
    dirs.push(dir);
    const path = join(dir, 'host.sqlite');
    const p = await host({ path }),
      a = await opened(p),
      prepared = batch(a.session),
      sent = await transferred(a.peer, prepared);
    const port = p.port,
      campaignId = p.campaignId;
    await p.close();
    const fresh = await host({ path, port, campaignId }),
      peer = await fresh.connect();
    const recovered = await call(peer, {
      schemaVersion: 1,
      operation: 'DEVICE_REQUEST_RECOVER',
      requestId: prepared.requestId,
      technicalSessionId: a.session.technicalSessionId,
      submitCommandId: 'submit-command',
    });
    expect(recovered.outcome).toBe('ACK');
    if (recovered.outcome !== 'ACK' || sent.result.outcome !== 'ACK')
      throw new Error('Expected durable recovery');
    expect(recovered.receipt).toEqual(sent.result.receipt);
    expect(
      readHostedDeviceRequest(fresh.db, fresh.principal, prepared.requestId, fresh.validate).batch,
    ).toEqual(prepared);
    expect(fresh.db.prepare('SELECT count(*) AS n FROM hosted_device_request').get()).toEqual({
      n: 1,
    });
  });

  it('enforces one active transfer/channel and chunk order without a request write', async () => {
    const p = await host(),
      a = await opened(p),
      prepared = batch(a.session),
      beginCommand = begin(prepared),
      started = await call(a.peer, beginCommand);
    if (started.outcome !== 'TRANSFER_READY') throw new Error('Expected transfer');
    expect(await call(a.peer, beginCommand)).toEqual(started);
    expect(await call(a.peer, { ...beginCommand, commandId: 'changed-submit' })).toMatchObject({
      outcome: 'REFUSED',
      code: 'TRANSFER_UNAVAILABLE',
    });
    expect(
      await call(a.peer, {
        schemaVersion: 1,
        operation: 'DEVICE_REQUEST_CHUNK',
        transferId: started.transferId,
        chunkIndex: 1,
        bytesBase64: 'eA==',
      }),
    ).toMatchObject({ outcome: 'REFUSED', code: 'TRANSFER_UNAVAILABLE' });
    expect(
      await call(a.peer, {
        schemaVersion: 1,
        operation: 'DEVICE_REQUEST_COMMIT',
        transferId: started.transferId,
      }),
    ).toMatchObject({ outcome: 'REFUSED' });
    expect(p.db.prepare('SELECT count(*) AS n FROM hosted_device_request').get()).toEqual({ n: 0 });
  });

  it('the global active-transfer budget is released by fencing before a new BEGIN', async () => {
    const p = await host({ limits: { maxActiveTransfers: 1 } }),
      a = await opened(p),
      prepared = batch(a.session),
      started = await call(a.peer, begin(prepared));
    expect(started.outcome).toBe('TRANSFER_READY');
    const b = await opened(p, undefined, 'second-open', 'second-attempt'),
      other = batch(b.session);
    expect(await call(b.peer, begin(other, 'second-submit'))).toMatchObject({
      outcome: 'REFUSED',
      code: 'TRANSFER_LIMIT',
    });
    const recovery = await p.connect();
    await call(recovery, {
      schemaVersion: 1,
      operation: 'DEVICE_REQUEST_RECOVER',
      requestId: prepared.requestId,
      technicalSessionId: a.session.technicalSessionId,
      submitCommandId: 'submit-command',
    });
    expect((await call(b.peer, begin(other, 'second-submit'))).outcome).toBe('TRANSFER_READY');
  });

  it('checks manifest capacity before reserving a transfer or writing a request', async () => {
    const p = await host({ capacity: 1 }),
      a = await opened(p),
      command = begin(batch(a.session)),
      first = command.candidates[0]!,
      before = p.db.serialize();
    // Capacity is a manifest preflight, before the private second witness is requested or trusted.
    const response = await call(a.peer, {
      ...command,
      candidates: [
        first,
        { ...first, descriptor: { ...first.descriptor, sourceUuid: randomUUID() } },
      ],
    });
    expect(response).toMatchObject({ outcome: 'REFUSED', code: 'CAPACITY_EXCEEDED' });
    expect(p.db.serialize().equals(before)).toBe(true);
    expect((await call(a.peer, command)).outcome).toBe('TRANSFER_READY');
  });

  it('enforces the staged-byte budget before accepting source-backed private bytes', async () => {
    const p = await host({ limits: { maxStagedBytes: 1 } }),
      a = await opened(p),
      before = p.db.serialize();
    expect(await call(a.peer, begin(batch(a.session)))).toMatchObject({
      outcome: 'REFUSED',
      code: 'TRANSFER_LIMIT',
    });
    expect(p.db.serialize().equals(before)).toBe(true);
  });

  it('drops a transfer when cumulative chunk bytes exceed the exact declared body length', async () => {
    const p = await host({ limits: { maxActiveTransfers: 1 } }),
      a = await opened(p),
      command = { ...begin(batch(a.session)), submitBodyByteLength: 1 },
      started = await call(a.peer, command),
      before = p.db.serialize();
    if (started.outcome !== 'TRANSFER_READY') throw new Error('Expected transfer');
    expect(
      await call(a.peer, {
        schemaVersion: 1,
        operation: 'DEVICE_REQUEST_CHUNK',
        transferId: started.transferId,
        chunkIndex: 0,
        bytesBase64: Buffer.from('xx').toString('base64'),
      }),
    ).toMatchObject({ outcome: 'REFUSED', code: 'TRANSFER_LIMIT' });
    expect(p.db.serialize().equals(before)).toBe(true);
    const retried = await call(a.peer, command);
    expect(retried.outcome).toBe('TRANSFER_READY');
    if (retried.outcome !== 'TRANSFER_READY') throw new Error('Expected new transfer');
    expect(retried.transferId).not.toBe(started.transferId);
  });

  it('closes excess real channels without allocating a technical session', async () => {
    const p = await host({ limits: { maxChannels: 1 } }),
      first = await p.connect(),
      before = p.db.serialize(),
      extra = await p.connect().catch(() => null);
    if (extra !== null) await vi.waitFor(() => expect(extra.closed).toBe(true));
    expect(p.db.serialize().equals(before)).toBe(true);
    expect((await opened(p, first)).response.outcome).toBe('ACK');
    expect(p.db.prepare('SELECT count(*) AS n FROM hosted_technical_session').get()).toEqual({
      n: 1,
    });
  });

  it('transfer timeout closes the real channel and releases its memory reservation', async () => {
    const p = await host({ limits: { timeoutMs: 500, maxActiveTransfers: 1 } }),
      a = await opened(p),
      prepared = batch(a.session);
    expect((await call(a.peer, begin(prepared))).outcome).toBe('TRANSFER_READY');
    await vi.waitFor(() => expect(a.peer.closed).toBe(true));
    const b = await opened(p, undefined, 'second-open', 'second-attempt');
    expect((await call(b.peer, begin(batch(b.session), 'second-submit'))).outcome).toBe(
      'TRANSFER_READY',
    );
  });
});

const validateMasterOwner = (
  owner: Parameters<typeof readHostedCurrentPausedCampaign>[2] extends (p: infer P) => void
    ? P
    : never,
): void => {
  validateMasterSecretVerifier(owner.verifier);
};

it('binds an authenticated owner attestation to genuine schema10 history without changing SUBMIT bytes', async () => {
  let legacy!: {
    prepared: NetworkPreparedBatch;
    session: PeerSessionHeader;
    submit: ReturnType<typeof commitHostedNetworkCommand>;
  };
  const p = await host({
    legacySeed: (db, principal, current) => {
      const technicalSessionId = randomUUID(),
        receiptId = randomUUID();
      const command = {
        schemaVersion: 1 as const,
        operation: 'CONNECTION_OPEN' as const,
        commandId: 'legacy-open',
        attemptId: 'legacy-attempt',
        campaignCheckpointSha256: current.checkpointSha256,
      };
      const saved = commitHostedNetworkCommand(
        db,
        principal,
        {
          operation: 'OPEN',
          commandId: command.commandId,
          receiptId,
          attemptId: command.attemptId,
          technicalSessionId,
          campaignProof: {
            campaignId: current.campaignId,
            revisions: vector(current),
            checkpointSha256: current.checkpointSha256,
          },
          semanticBodyJson: canonicalPostSaveJson(command),
        },
        validateMasterOwner,
        () => undefined,
      );
      if (saved.receipt.operation !== 'OPEN') throw new Error('Missing historical OPEN');
      const session: PeerSessionHeader = {
        technicalSessionId,
        attemptId: command.attemptId,
        campaignProof: saved.receipt.session.campaignProof,
        connectionRevision: 0,
        receiptId,
      };
      const v2 = batch(session),
        { schemaVersion: _schema, localControllerSeatId: _lane, batchSha256: _hash, ...body } = v2;
      const prepared: NetworkPreparedBatch = {
        ...body,
        batchSha256: postSaveSha256(canonicalPostSaveJson(body)),
      };
      const submit = commitHostedNetworkCommand(
        db,
        principal,
        {
          operation: 'SUBMIT',
          commandId: 'legacy-submit',
          receiptId: randomUUID(),
          requestId: prepared.requestId,
          technicalSessionId,
          expectedConnectionRevision: 0,
          batch: prepared,
          semanticBodyJson: deviceAdmissionSubmitSemanticBody(
            'legacy-submit',
            prepared.batchSha256,
          ),
        },
        validateMasterOwner,
        () => undefined,
      );
      legacy = { prepared, session, submit };
    },
  });
  const beforeSubmit = canonicalPostSaveJson(legacy.submit.receipt),
    peer = await p.connect();
  // The receiver proves a signed owner-host attestation, not the existence of a row in remote SQLite.
  const command: Extract<DeviceAdmissionPeerCommand, { operation: 'DEVICE_REQUEST_BIND_LANE' }> = {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_BIND_LANE',
    commandId: 'bind-historical-lane',
    requestId: legacy.prepared.requestId,
    technicalSessionId: legacy.session.technicalSessionId,
    submitCommandId: 'legacy-submit',
    batchSha256: legacy.prepared.batchSha256,
    localControllerSeatId: randomUUID(),
  };
  const originalWire = await call(peer, {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_RECOVER',
    requestId: command.requestId,
    technicalSessionId: command.technicalSessionId,
    submitCommandId: command.submitCommandId,
  });
  if (originalWire.outcome !== 'ACK' || originalWire.receipt.operation !== 'SUBMIT')
    throw new Error('Missing original wire SUBMIT');
  const beforeWireSubmit = canonicalPostSaveJson(originalWire.receipt);
  const first = await call(peer, command);
  if (
    first.outcome !== 'ACK' ||
    first.receipt.operation !== 'BIND_LANE' ||
    first.current.kind !== 'REQUEST_REVIEW'
  )
    throw new Error('Expected explicit BIND ACK');
  expect(first.current.request.requestRevision).toBe(0);
  expect(first.current.request.status).toBe('PENDING');
  expect(first.current.proof.laneProvenance).toEqual({ kind: 'BIND_LANE', receipt: first.receipt });
  const beforeReplay = p.db.serialize(),
    replay = await call(peer, command);
  expect(replay).toEqual({ ...first, delivery: 'REPLAY' });
  expect(p.db.serialize().equals(beforeReplay)).toBe(true);
  const recovered = await call(peer, {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_RECOVER',
    requestId: command.requestId,
    technicalSessionId: command.technicalSessionId,
    submitCommandId: command.submitCommandId,
  });
  if (recovered.outcome !== 'ACK') throw new Error('Missing recovered historical SUBMIT');
  expect(canonicalPostSaveJson(recovered.receipt)).toBe(beforeWireSubmit);
  expect(recovered.current).toEqual(first.current);
  expect(p.db.serialize().equals(beforeReplay)).toBe(true);
  for (const change of [
    { commandId: 'another-bind' },
    { localControllerSeatId: randomUUID() },
    { technicalSessionId: randomUUID() },
    { batchSha256: '0'.repeat(64) },
  ]) {
    expect((await call(peer, { ...command, ...change })).outcome).toBe('REFUSED');
    expect(p.db.serialize().equals(beforeReplay)).toBe(true);
  }
  expect(
    canonicalPostSaveJson(
      readHostedNetworkCommand(p.db, p.principal, 'legacy-submit', p.validate)!.receipt,
    ),
  ).toBe(beforeSubmit);
  expect(p.db.prepare('SELECT count(*) AS n FROM campaign_character_copy').get()).toEqual({ n: 0 });
});

it('derives deterministic request connection facts from live signed channels and the exact stored key pin', async () => {
  const p = await host(),
    first = await opened(p),
    one = batch(first.session);
  expect((await transferred(first.peer, one)).result.outcome).toBe('ACK');
  const second = await opened(p, first.peer, 'second-facts-open', 'second-facts-attempt'),
    two = batch(second.session);
  expect((await transferred(second.peer, two, 'second-facts-submit')).result.outcome).toBe('ACK');
  const ids = [one.requestId, two.requestId],
    sorted = [...ids].sort(),
    owner = p.principal.peerIdentity.ownerDeviceId;
  const before = p.db.serialize();
  const facts = p.runtime.requestConnectionFacts(p.campaignId, ids.slice().reverse());
  expect(facts).toEqual(
    sorted.map((requestId) => ({ requestId, requestOwnerDeviceId: owner, connected: true })),
  );
  const source = () =>
    readGmRequestReviewSource(
      p.db,
      {
        ownerDeviceId: loadDeviceId(p.db),
        gmLocalContextId: readHostedCampaignCreationOrigin(p.db, p.campaignId, p.validate).command
          .request.payload.gmLocalContextId,
        campaignId: p.campaignId,
      },
      p.validate,
    );
  const current = source();
  expect(p.runtime.requestConnectionFactsFromSource(current)).toEqual(facts);
  for (const change of [
    { ownerDeviceId: randomUUID() },
    { gmLocalContextId: randomUUID() },
    { campaignId: randomUUID() },
  ]) {
    expect(() =>
      p.runtime.requestConnectionFactsFromSource({
        ...current,
        scope: { ...current.scope, ...change },
      }),
    ).toThrow();
  }
  for (const change of [
    { requestId: randomUUID() },
    {
      principal: {
        ...p.principal,
        peerIdentity: {
          ...p.principal.peerIdentity,
          ownerDeviceId: randomUUID(),
        },
      },
    },
    {
      principal: {
        ...p.principal,
        peerIdentity: {
          ...p.principal.peerIdentity,
          publicKeySpkiBase64: 'wrong-key',
        },
      },
    },
  ]) {
    const firstRequest = current.queue.requests[0]!;
    expect(() =>
      p.runtime.requestConnectionFactsFromSource({
        ...current,
        queue: {
          ...current.queue,
          requests: [
            {
              ...firstRequest,
              submittedRequest: { ...firstRequest.submittedRequest, ...change },
            },
          ],
        },
      }),
    ).toThrow();
  }
  expect(Object.isFrozen(facts)).toBe(true);
  expect(facts.every(Object.isFrozen)).toBe(true);
  expect(() =>
    p.runtime.requestConnectionFacts(p.campaignId, [one.requestId, one.requestId]),
  ).toThrow();
  expect(() => p.runtime.requestConnectionFacts(p.campaignId, [randomUUID()])).toThrow();
  expect(() => p.runtime.requestConnectionFacts(randomUUID(), ids)).toThrow();
  expect(p.db.serialize().equals(before)).toBe(true);
  const other = await p.connect(),
    changedKey = await p.connect(generateDeviceInstallationIdentityMaterial(owner));
  await vi.waitFor(() =>
    expect(p.runtime.requestConnectionFacts(p.campaignId, ids).every((f) => f.connected)).toBe(
      true,
    ),
  );
  first.peer.close();
  await vi.waitFor(() => expect(first.peer.closed).toBe(true));
  expect(p.runtime.requestConnectionFacts(p.campaignId, ids).every((f) => f.connected)).toBe(true);
  other.close();
  await vi.waitFor(() =>
    expect(p.runtime.requestConnectionFacts(p.campaignId, ids).every((f) => !f.connected)).toBe(
      true,
    ),
  );
  expect(changedKey.closed).toBe(false);
  expect(p.runtime.requestConnectionFactsFromSource(source())).toEqual(
    sorted.map((requestId) => ({ requestId, requestOwnerDeviceId: owner, connected: false })),
  );
  expect(p.db.serialize().equals(before)).toBe(true);
  await p.runtime.close();
  expect(p.runtime.requestConnectionFacts(p.campaignId, ids)).toEqual(
    sorted.map((requestId) => ({ requestId, requestOwnerDeviceId: owner, connected: false })),
  );
  expect(p.db.serialize().equals(before)).toBe(true);
});
