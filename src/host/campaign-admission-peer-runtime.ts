import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  admissionGmDecisionNotice,
  type AdmissionPlayerDecisionReceipt,
} from '@shared/campaign-admission-proposal.js';
import {
  readHostedCampaignCreationOrigin,
  type CampaignPrivateOwnerValidator,
} from '../persistence/campaign-creation.js';
import {
  readHostedDeviceRequestCurrent,
  readHostedTechnicalSession,
  type HostedNetworkPrincipal,
} from '../persistence/network-device-request.js';
import { type CurrentPausedCampaignHeader } from '../persistence/current-paused-campaign.js';
import {
  readAdmissionDecisionDeliveryByRequest,
  readCampaignAdmissionAvailability,
} from '../persistence/campaign-admission-decision.js';
import { commitAdmissionPlayerDecision } from '../persistence/campaign-admission-player.js';
import {
  networkApplicationStorage as storage,
  NetworkApplicationStoreError,
} from '../persistence/network-local-application.js';
import {
  CampaignNetworkExecutorError,
  type createCampaignNetworkExecutor,
  type CampaignNetworkExecutionChannel,
  type CampaignNetworkExecutionLease,
} from './campaign-network-executor.js';
import {
  createCampaignAdmissionRules,
  admissionSelectedGroupLabels,
} from './campaign-admission-service.js';
import {
  AdmissionPeerCodecError,
  encodeAdmissionCapacityResponse,
  type AdmissionCapacityCommand,
  type AdmissionCapacityResponse,
  encodeAdmissionPeerResponse,
  type AdmissionPeerCommand,
  type AdmissionPeerResponse,
  type AdmissionPeerLimits,
  type AdmissionPeerRefusal,
  type AdmissionPeerScope,
} from './campaign-admission-peer-codec.js';
import {
  canonicalPostSaveJson,
  postSaveSha256,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import { CAMPAIGN_PEER_CHANNEL_MAX_BYTES } from './campaign-peer-channel.js';
import { validatePeerCampaignHeader } from './campaign-peer-handshake.js';

interface Connection {
  readonly handle: CampaignNetworkExecutionChannel;
}
interface Options<C extends Connection> {
  readonly database: Database.Database;
  readonly baseline: LocalCharacterExportBaseline;
  readonly executor: ReturnType<typeof createCampaignNetworkExecutor>;
  readonly limits: AdmissionPeerLimits & {
    readonly maxWitnessBytes: number;
    readonly timeoutMs: number;
  };
  readonly validateOwner: CampaignPrivateOwnerValidator;
  /** Does not load the campaign checkpoint while its owning transaction is preparing the next one. */
  readonly principal: (connection: C) => HostedNetworkPrincipal;
  readonly source: (connection: C) => {
    principal: HostedNetworkPrincipal;
    campaign: CurrentPausedCampaignHeader;
  };
  /** Shares the upload budget; successful reservations must be released exactly once. */
  readonly reserve: (bytes: number) => boolean;
  readonly release: (bytes: number) => void;
}
type Manifest = Extract<AdmissionPeerResponse, { outcome: 'MANIFEST' }>;
interface Stage<C> {
  readonly connection: C;
  readonly lease: CampaignNetworkExecutionLease;
  readonly manifest: Manifest;
  readonly bytes: Buffer;
  readonly reserved: number;
  timer: ReturnType<typeof setTimeout> | null;
  untrack: () => void;
  disposed: boolean;
  next: number;
}
class Refusal extends Error {
  constructor(readonly code: AdmissionPeerRefusal) {
    super(code);
  }
}
const fail = (code: AdmissionPeerRefusal): never => {
  throw new Refusal(code);
};
const same = (a: unknown, b: unknown) => canonicalPostSaveJson(a) === canonicalPostSaveJson(b);
const scopeOf = (value: AdmissionPeerScope) => ({
  requestId: value.requestId,
  technicalSessionId: value.technicalSessionId,
  submitCommandId: value.submitCommandId,
});

/** Called only inside the existing authenticated campaign executor; no second command queue. */
export function createCampaignAdmissionPeerRuntime<C extends Connection>(d: Options<C>) {
  const stages = new Map<C, Stage<C>>();
  const codecLimits = {
    maxPublicationBytes: d.limits.maxPublicationBytes,
    maxChunkBytes: d.limits.maxChunkBytes,
  };
  const bounded = (value: AdmissionPeerResponse): AdmissionPeerResponse => {
    encodeAdmissionPeerResponse(value, codecLimits);
    return value;
  };
  function drop(stage: Stage<C>): void {
    if (stage.disposed) return;
    stage.disposed = true;
    if (stage.timer !== null) clearTimeout(stage.timer);
    stage.untrack();
    stage.bytes.fill(0);
    d.release(stage.reserved);
    if (stages.get(stage.connection) === stage) stages.delete(stage.connection);
  }
  function close(connection: C): void {
    const stage = stages.get(connection);
    if (stage !== undefined) drop(stage);
  }
  function authoritative(connection: C, command: AdmissionPeerCommand) {
    const { principal, campaign } = d.source(connection);
    readHostedTechnicalSession(d.database, principal, command.technicalSessionId, d.validateOwner);
    const request = readHostedDeviceRequestCurrent(
      d.database,
      principal,
      command.requestId,
      d.validateOwner,
    );
    if (
      request.submittedRequest.technicalSessionId !== command.technicalSessionId ||
      request.submittedRequest.submitCommandId !== command.submitCommandId
    )
      return fail('FOREIGN_OWNER');
    const origin = readHostedCampaignCreationOrigin(
      d.database,
      campaign.campaignId,
      d.validateOwner,
    );
    const scope = {
      ownerDeviceId: principal.hostOwnerDeviceId,
      campaignId: campaign.campaignId,
      gmLocalContextId: origin.command.request.payload.gmLocalContextId,
    };
    const { rules } = createCampaignAdmissionRules(d.baseline, d.limits.maxWitnessBytes);
    const delivery = readAdmissionDecisionDeliveryByRequest(
      d.database,
      scope,
      command.requestId,
      d.validateOwner,
      rules,
    );
    const current = delivery?.current ?? null;
    if (
      current !== null &&
      current.review.request.submittedRequest.principal.peerIdentity.ownerDeviceId !==
        principal.peerIdentity.ownerDeviceId
    )
      return fail('FOREIGN_OWNER');
    return { principal, campaign, scope, rules, current, groups: delivery?.groups ?? [] };
  }
  function leaseAt(connection: C, command: AdmissionPeerCommand) {
    const scope = { kind: 'SESSION' as const, id: command.technicalSessionId };
    return command.operation === 'ADMISSION_PLAYER_RECOVER'
      ? d.executor.recoverScope(connection.handle, scope)
      : d.executor.bindScope(connection.handle, scope);
  }
  function chunkBytes(command: AdmissionPeerScope, transferId: string, checksum: string): number {
    // Bound the complete escaped/signed RPC, not just the raw base64 payload.
    let low = 0,
      high = Math.min(
        d.limits.maxChunkBytes,
        d.limits.maxPublicationBytes,
        CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
      );
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      try {
        bounded({
          schemaVersion: 1,
          operation: 'ADMISSION_PUBLICATION_CHUNK',
          ...scopeOf(command),
          outcome: 'CHUNK',
          transferId,
          publicationChecksum: checksum,
          chunkIndex: Number.MAX_SAFE_INTEGER,
          bytesBase64: Buffer.alloc(middle).toString('base64'),
        });
        low = middle;
      } catch {
        high = middle - 1;
      }
    }
    return low > 0 ? low : fail('TRANSFER_LIMIT');
  }
  function begin(
    connection: C,
    command: Extract<AdmissionPeerCommand, { operation: 'ADMISSION_PUBLICATION_BEGIN' }>,
  ): AdmissionPeerResponse {
    const state = authoritative(connection, command),
      lease = leaseAt(connection, command);
    close(connection);
    const gm = state.current?.gmDecisionOrNull;
    if (gm === undefined || gm === null)
      return {
        schemaVersion: 1,
        operation: command.operation,
        ...scopeOf(command),
        outcome: 'NOT_READY',
      };
    const body = {
      schemaVersion: 1 as const,
      gmDecision: admissionGmDecisionNotice(gm.receipt),
      proposalOrNull: gm.proposalOrNull,
      groupLabels: admissionSelectedGroupLabels(
        gm.proposalOrNull?.fullCampaignCopyDiffs ?? [],
        state.groups,
      ),
    };
    const publicationChecksum = postSaveSha256(canonicalPostSaveJson(body));
    const text = canonicalPostSaveJson({ ...body, publicationChecksum }),
      byteLength = Buffer.byteLength(text, 'utf8');
    if (byteLength > d.limits.maxPublicationBytes) return fail('TRANSFER_LIMIT');
    const transferId = randomUUID(),
      size = chunkBytes(command, transferId, publicationChecksum);
    const manifest: Manifest = {
      schemaVersion: 1,
      operation: command.operation,
      ...scopeOf(command),
      outcome: 'MANIFEST',
      transferId,
      publicationChecksum,
      bodySha256: postSaveSha256(text),
      byteLength,
      chunkBytes: size,
      chunkCount: Math.ceil(byteLength / size),
      campaignRevision: state.campaign.stateRevision,
    };
    bounded(manifest);
    d.executor.assertCurrent(lease);
    const reserved = byteLength * 2;
    if (!d.reserve(reserved)) return fail('TRANSFER_LIMIT');
    let stage: Stage<C> | null = null;
    try {
      stage = {
        connection,
        lease,
        manifest,
        bytes: Buffer.from(text, 'utf8'),
        reserved,
        timer: null,
        untrack: () => undefined,
        disposed: false,
        next: 0,
      };
      const owned = stage;
      stage.untrack = d.executor.trackTransfer(lease, transferId, () => drop(owned));
      stage.timer = setTimeout(() => drop(owned), d.limits.timeoutMs);
      stage.timer.unref();
      stages.set(connection, stage);
      return manifest;
    } catch (error: unknown) {
      if (stage === null) d.release(reserved);
      else drop(stage);
      throw error;
    }
  }
  function chunk(
    connection: C,
    command: Extract<AdmissionPeerCommand, { operation: 'ADMISSION_PUBLICATION_CHUNK' }>,
  ): AdmissionPeerResponse {
    const stage = stages.get(connection);
    if (
      stage === undefined ||
      stage.disposed ||
      stage.manifest.transferId !== command.transferId ||
      stage.manifest.publicationChecksum !== command.publicationChecksum ||
      !same(scopeOf(stage.manifest), scopeOf(command)) ||
      command.chunkIndex >= stage.manifest.chunkCount ||
      command.chunkIndex !== stage.next
    )
      return fail('TRANSFER_UNAVAILABLE');
    d.executor.assertCurrent(stage.lease);
    d.source(connection);
    const start = command.chunkIndex * stage.manifest.chunkBytes;
    const response = bounded({
      schemaVersion: 1,
      operation: command.operation,
      ...scopeOf(command),
      outcome: 'CHUNK',
      transferId: command.transferId,
      publicationChecksum: command.publicationChecksum,
      chunkIndex: command.chunkIndex,
      bytesBase64: stage.bytes
        .subarray(start, Math.min(start + stage.manifest.chunkBytes, stage.bytes.length))
        .toString('base64'),
    });
    stage.next++;
    // Lost replies restart the immutable download; completed transfers release the shared budget immediately.
    if (stage.next === stage.manifest.chunkCount) drop(stage);
    return response;
  }
  function decided(
    command: Extract<
      AdmissionPeerCommand,
      { operation: 'ADMISSION_PLAYER_DECIDE' | 'ADMISSION_PLAYER_RECOVER' }
    >,
    receipt: AdmissionPlayerDecisionReceipt,
  ): AdmissionPeerResponse {
    const receiptCanonicalJson = canonicalPostSaveJson(receipt);
    return bounded({
      schemaVersion: 1,
      operation: command.operation,
      ...scopeOf(command),
      outcome: 'DECIDED',
      receiptCanonicalJson,
      receiptSha256: postSaveSha256(receiptCanonicalJson),
    });
  }
  function decision(
    connection: C,
    command: Extract<
      AdmissionPeerCommand,
      { operation: 'ADMISSION_PLAYER_DECIDE' | 'ADMISSION_PLAYER_RECOVER' }
    >,
  ): AdmissionPeerResponse {
    const state = authoritative(connection, command),
      lease = leaseAt(connection, command);
    const current = state.current;
    if (current === null || current.gmDecisionOrNull?.request.decision !== 'ACCEPT')
      return fail('UNAVAILABLE');
    const batchId = current.review.current.admissionBatchId;
    if (command.operation === 'ADMISSION_PLAYER_RECOVER') {
      if (command.admissionBatchId !== batchId) return fail('IDEMPOTENCY_CONFLICT');
      const saved = current.playerDecisionOrNull;
      d.executor.assertCurrent(lease);
      if (saved !== null) {
        if (
          saved.request.commandId !== command.commandId ||
          postSaveSha256(canonicalPostSaveJson(saved.request)) !== command.semanticBodySha256
        )
          return fail('IDEMPOTENCY_CONFLICT');
        return decided(command, saved.receipt);
      }
      storage.assertUnused(d.database, command.commandId);
      return bounded({
        schemaVersion: 1,
        operation: command.operation,
        ...scopeOf(command),
        outcome: 'NOT_APPLIED',
        proof: {
          operation: 'ADMISSION_PLAYER_DECISION_ABSENT',
          commandId: command.commandId,
          semanticBodySha256: command.semanticBodySha256,
          campaignId: state.scope.campaignId,
          admissionBatchId: batchId,
          campaignRevision: state.campaign.stateRevision,
          ...scopeOf(command),
          fenced: true,
          generation: lease.generation,
          code: 'NOT_APPLIED',
        },
      });
    }
    if (
      command.decision.admissionBatchId !== batchId ||
      command.decision.campaignId !== state.scope.campaignId
    )
      return fail('FOREIGN_OWNER');
    let response: AdmissionPeerResponse | null = null;
    const result = commitAdmissionPlayerDecision(
      d.database,
      state.scope,
      state.principal.peerIdentity.ownerDeviceId,
      { request: command.decision, receiptId: randomUUID(), timestamp: new Date().toISOString() },
      d.validateOwner,
      state.rules,
      randomUUID,
      (fresh) => {
        d.executor.assertCurrent(lease);
        if (
          !same(d.principal(connection), state.principal) ||
          !same(fresh.review.source.scope, state.scope) ||
          fresh.review.current.requestId !== command.requestId ||
          fresh.review.request.submittedRequest.technicalSessionId !== command.technicalSessionId ||
          fresh.review.request.submittedRequest.submitCommandId !== command.submitCommandId
        )
          return fail('FOREIGN_OWNER');
        // The post-write callback still owns the transaction: an oversized ACK rolls it back.
        if (fresh.playerDecisionOrNull !== null)
          response = decided(command, fresh.playerDecisionOrNull.receipt);
      },
    );
    if (response === null || result.current.playerDecisionOrNull === null)
      return fail('UNAVAILABLE');
    return response;
  }
  function execute(connection: C, command: AdmissionPeerCommand): AdmissionPeerResponse {
    try {
      switch (command.operation) {
        case 'ADMISSION_PUBLICATION_BEGIN':
          return bounded(begin(connection, command));
        case 'ADMISSION_PUBLICATION_CHUNK':
          return bounded(chunk(connection, command));
        case 'ADMISSION_PLAYER_DECIDE':
        case 'ADMISSION_PLAYER_RECOVER':
          return bounded(decision(connection, command));
      }
    } catch (error: unknown) {
      let code: AdmissionPeerRefusal = 'UNAVAILABLE';
      if (error instanceof Refusal) code = error.code;
      else if (error instanceof AdmissionPeerCodecError) code = 'TRANSFER_LIMIT';
      else if (error instanceof CampaignNetworkExecutorError && error.code === 'STALE_GENERATION')
        code = 'STALE_GENERATION';
      else if (error instanceof CampaignNetworkExecutorError && error.code === 'SCOPE_LIMIT')
        code = 'TRANSFER_LIMIT';
      else if (
        error instanceof NetworkApplicationStoreError &&
        (error.code === 'IDEMPOTENCY_CONFLICT' ||
          error.code === 'STALE_REVISION' ||
          error.code === 'CAPACITY_EXCEEDED' ||
          error.code === 'FOREIGN_OWNER' ||
          error.code === 'INVALID_INPUT')
      )
        code = error.code;
      return {
        schemaVersion: 1,
        operation: command.operation,
        ...scopeOf(command),
        outcome: 'REFUSED',
        code,
      };
    }
  }
  function capacity(connection: C, command: AdmissionCapacityCommand): AdmissionCapacityResponse {
    try {
      const { principal, campaign } = d.source(connection);
      readHostedTechnicalSession(
        d.database,
        principal,
        command.technicalSessionId,
        d.validateOwner,
      );
      const lease = d.executor.bindScope(connection.handle, {
          kind: 'SESSION',
          id: command.technicalSessionId,
        }),
        origin = readHostedCampaignCreationOrigin(d.database, campaign.campaignId, d.validateOwner),
        availability = readCampaignAdmissionAvailability(
          d.database,
          {
            ownerDeviceId: principal.hostOwnerDeviceId,
            campaignId: campaign.campaignId,
            gmLocalContextId: origin.command.request.payload.gmLocalContextId,
          },
          d.validateOwner,
          createCampaignAdmissionRules(d.baseline, d.limits.maxWitnessBytes).rules,
        );
      if (
        availability.campaignRevision !== campaign.stateRevision ||
        availability.activePcCount !== campaign.activePcCount
      )
        return fail('UNAVAILABLE');
      d.executor.assertCurrent(lease);
      const response: AdmissionCapacityResponse = {
        ...command,
        outcome: 'CAPACITY',
        campaign: validatePeerCampaignHeader({
          campaignId: campaign.campaignId,
          title: campaign.title,
          status: campaign.status,
          activePlayerCapacity: campaign.activePlayerCapacity,
          activePcCount: campaign.activePcCount,
          checkpointSha256: campaign.checkpointSha256,
          baselineVersion: campaign.baselineVersion,
          revisions: {
            stateRevision: campaign.stateRevision,
            projectionRevision: campaign.projectionRevision,
            actorVisibilityRevision: campaign.actorVisibilityRevision,
          },
        }),
        occupiedCampaignPlaceCount: availability.occupiedCampaignPlaceCount,
        alreadyImportedSourceUuids: availability.importedSources
          .filter((source) => source.ownerDeviceId === principal.peerIdentity.ownerDeviceId)
          .map((source) => source.sourceUuid),
      };
      encodeAdmissionCapacityResponse(response);
      return response;
    } catch (error: unknown) {
      return {
        ...command,
        outcome: 'REFUSED',
        code:
          error instanceof CampaignNetworkExecutorError && error.code === 'STALE_GENERATION'
            ? 'STALE_GENERATION'
            : 'UNAVAILABLE',
      };
    }
  }
  return { execute, capacity, close };
}
