import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { loadDeviceId } from '../persistence/device-identity.js';
import {
  readHostedCampaignCreationOrigin,
  type CampaignPrivateOwner,
} from '../persistence/campaign-creation.js';
import {
  readHostedCurrentPausedCampaign,
  type CurrentPausedCampaignHeader,
} from '../persistence/current-paused-campaign.js';
import {
  commitHostedNetworkCommand,
  readHostedNetworkCommand,
  readHostedTechnicalSession,
  readHostedDeviceRequest,
  readGmDeviceRequestQueue,
  readHostedDeviceRequestCurrent,
  commitHostedRequestLaneBinding,
  type HostedRequestReviewCurrent,
  type GmRequestReviewSource,
  type VerifiedGmRequestQueue,
  type HostedCandidateBaselineGuard,
  readHostedConnectionAttempt,
  type HostedNetworkCommand,
  type HostedNetworkInput,
  type HostedNetworkPrincipal,
  type HostedNetworkReceipt,
  type HostedTechnicalSession,
  type HostedDeviceRequest,
  type HostedNetworkSource,
} from '../persistence/network-device-request.js';
import {
  validateNetworkPreparedBatch,
  NetworkApplicationStoreError,
  type NetworkPreparedBatch,
  type NetworkCampaignProof,
  type PeerLaneBindingReceipt,
} from '../persistence/network-local-application.js';
import type { CampaignPeerServerChannel } from './campaign-peer-channel.js';
import { loadNetworkInstallation } from './network-installation.js';
import {
  campaignPeerPublicIdentity,
  validateCampaignPeerPublicIdentity,
} from './campaign-peer-identity.js';
import { validateMasterSecretVerifier } from './campaign-secret.js';
import {
  type createCampaignNetworkExecutor,
  CampaignNetworkExecutorError,
  type CampaignNetworkExecutionChannel,
  type CampaignNetworkExecutionLease,
} from './campaign-network-executor.js';
import {
  decodeDeviceAdmissionPeerCommand,
  type DeviceAdmissionPeerCommand,
  type DeviceAdmissionPeerCommandLimits,
} from './device-admission-peer-commands.js';
import {
  encodeDeviceAdmissionPeerResponse,
  deviceAdmissionSubmitSemanticBody,
  deviceAdmissionRequestReviewCurrent,
  DeviceAdmissionPeerResponseError,
  DEVICE_ADMISSION_PEER_REFUSAL_CODES,
  type DeviceAdmissionPeerResponse,
  type DeviceAdmissionPeerRefusalCode,
  type DeviceAdmissionPeerReceipt,
  type DeviceAdmissionPeerCurrent,
  type PeerSessionHeader,
  type PeerRequestHeader,
} from './device-admission-peer-response.js';
import { validateFinalAdmissionCandidate } from './device-admission-candidate.js';
import {
  canonicalPostSaveJson,
  postSaveSha256,
  resolveStoredLocalCharacterExportBaseline,
  isStoredLocalCharacterExportBaselineCompatible,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';

export interface DeviceAdmissionPeerRequestConnectionFact {
  readonly requestId: string;
  readonly requestOwnerDeviceId: string;
  readonly connected: boolean;
}
export interface DeviceAdmissionPeerRuntimeLimits extends DeviceAdmissionPeerCommandLimits {
  readonly timeoutMs: number;
  readonly maxActiveTransfers: number;
  readonly maxStagedBytes: number;
  readonly maxChannels: number;
}
export interface DeviceAdmissionPeerRuntimeOptions {
  readonly database: Database.Database;
  readonly baseline: LocalCharacterExportBaseline;
  readonly executor: ReturnType<typeof createCampaignNetworkExecutor>;
  readonly limits: DeviceAdmissionPeerRuntimeLimits;
}
export class DeviceAdmissionPeerRuntimeError extends Error {
  constructor(readonly code: 'INVALID_CONFIG' | 'CLOSED' | 'INVALID_CHANNEL' | 'CHANNEL_FAILED') {
    super(`device admission peer runtime: ${code}`);
  }
}
class Refusal extends Error {
  constructor(readonly code: DeviceAdmissionPeerRefusalCode) {
    super(code);
  }
}
const fail = (code: DeviceAdmissionPeerRefusalCode): never => {
  throw new Refusal(code);
};
type Operation = DeviceAdmissionPeerCommand['operation'];
type Begin = Extract<DeviceAdmissionPeerCommand, { operation: 'DEVICE_REQUEST_BEGIN' }>;
type Ack = Extract<DeviceAdmissionPeerResponse, { outcome: 'ACK' }>;
interface Connection {
  readonly channel: CampaignPeerServerChannel;
  readonly handle: CampaignNetworkExecutionChannel;
  stage: Stage | null;
  task: Promise<void> | null;
}
interface Stage {
  readonly id: string;
  readonly begin: Begin;
  readonly beginText: string;
  readonly lease: CampaignNetworkExecutionLease;
  readonly connection: Connection;
  readonly chunks: Buffer[];
  readonly reserved: number;
  received: number;
  next: number;
  timer: ReturnType<typeof setTimeout> | null;
  untrack: () => void;
  disposed: boolean;
}
const same = (a: unknown, b: unknown) => canonicalPostSaveJson(a) === canonicalPostSaveJson(b);
const proof = (h: CurrentPausedCampaignHeader): NetworkCampaignProof => ({
  campaignId: h.campaignId,
  checkpointSha256: h.checkpointSha256,
  revisions: {
    stateRevision: h.stateRevision,
    projectionRevision: h.projectionRevision,
    actorVisibilityRevision: h.actorVisibilityRevision,
  },
});
const sessionHeader = (s: HostedTechnicalSession): PeerSessionHeader => ({
  technicalSessionId: s.technicalSessionId,
  attemptId: s.attemptId,
  campaignProof: s.campaignProof,
  connectionRevision: s.connectionRevision,
  receiptId: s.receiptId,
});
const requestHeader = (r: HostedDeviceRequest): PeerRequestHeader => ({
  requestId: r.requestId,
  technicalSessionId: r.technicalSessionId,
  submitCommandId: r.submitCommandId,
  submitReceiptId: r.submitReceiptId,
  requestRevision: r.requestRevision,
  status: r.status,
  batchSha256: r.batch.batchSha256,
  closureOrNull: r.closureOrNull,
});
function shortReceipt(r: HostedNetworkReceipt): DeviceAdmissionPeerReceipt {
  const common = {
    commandId: r.commandId,
    receiptId: r.receiptId,
    semanticBodySha256: r.semanticBodySha256,
  };
  return r.operation === 'OPEN'
    ? { ...common, operation: r.operation, session: sessionHeader(r.session) }
    : { ...common, operation: r.operation, request: requestHeader(r.request) };
}
function responseRefusal(operation: Operation, error: unknown): DeviceAdmissionPeerResponse {
  let code: DeviceAdmissionPeerRefusalCode = 'UNAVAILABLE';
  if (error instanceof Refusal && DEVICE_ADMISSION_PEER_REFUSAL_CODES.includes(error.code))
    code = error.code;
  else if (error instanceof DeviceAdmissionPeerResponseError) code = 'TRANSFER_LIMIT';
  else if (error instanceof CampaignNetworkExecutorError && error.code === 'STALE_GENERATION')
    code = 'STALE_GENERATION';
  else if (error instanceof CampaignNetworkExecutorError && error.code === 'SCOPE_LIMIT')
    code = 'TRANSFER_LIMIT';
  else if (
    error instanceof NetworkApplicationStoreError &&
    ['IDEMPOTENCY_CONFLICT', 'STALE_REVISION', 'CAPACITY_EXCEEDED'].includes(error.code)
  )
    code = error.code as 'IDEMPOTENCY_CONFLICT' | 'STALE_REVISION' | 'CAPACITY_EXCEEDED';
  return { schemaVersion: 1, operation, outcome: 'REFUSED', code };
}
function checkedLimits(value: DeviceAdmissionPeerRuntimeLimits): DeviceAdmissionPeerRuntimeLimits {
  try {
    const keys = [
      'maxSubmitBodyBytes',
      'maxWitnessBytes',
      'maxChunkBytes',
      'timeoutMs',
      'maxActiveTransfers',
      'maxStagedBytes',
      'maxChannels',
    ];
    const d = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(value).length !== keys.length ||
      keys.some(
        (k) =>
          d[k] === undefined ||
          !Object.hasOwn(d[k], 'value') ||
          !d[k].enumerable ||
          typeof d[k].value !== 'number' ||
          !Number.isSafeInteger(d[k].value) ||
          d[k].value <= 0,
      ) ||
      value.timeoutMs > 2_147_483_647 ||
      value.maxSubmitBodyBytes > Math.floor(Number.MAX_SAFE_INTEGER / 2)
    )
      throw new Error();
    return Object.freeze({ ...value });
  } catch {
    throw new DeviceAdmissionPeerRuntimeError('INVALID_CONFIG');
  }
}

/** Endpoint must provide a genuinely authenticated channel restricted to its published campaigns. */
export function createDeviceAdmissionPeerRuntime(d: DeviceAdmissionPeerRuntimeOptions) {
  const limits = checkedLimits(d.limits),
    connections = new Set<Connection>();
  const commandLimits: DeviceAdmissionPeerCommandLimits = {
    maxSubmitBodyBytes: limits.maxSubmitBodyBytes,
    maxWitnessBytes: limits.maxWitnessBytes,
    maxChunkBytes: limits.maxChunkBytes,
  };
  let closed = false,
    closePromise: Promise<void> | undefined,
    stagedBytes = 0,
    activeTransfers = 0;
  const validateOwner = (owner: CampaignPrivateOwner): void => {
    validateMasterSecretVerifier(owner.verifier);
  };
  function requireCompatibleBaseline(id: string): void {
    if (!isStoredLocalCharacterExportBaselineCompatible(d.baseline, id))
      return fail('INCOMPATIBLE_BASELINE');
    resolveStoredLocalCharacterExportBaseline(d.baseline, id);
  }
  const validateCandidateBaseline: HostedCandidateBaselineGuard = (s) => {
    requireCompatibleBaseline(s.campaign.baselineVersion);
    requireCompatibleBaseline(s.candidateBaselineVersion);
  };
  function source(c: Connection): {
    principal: HostedNetworkPrincipal;
    campaign: CurrentPausedCampaignHeader;
  } {
    const material = loadNetworkInstallation(d.database),
      host = campaignPeerPublicIdentity(material);
    if (!same(host, c.channel.hostIdentity) || loadDeviceId(d.database) !== host.ownerDeviceId)
      return fail('UNAVAILABLE');
    const peer = validateCampaignPeerPublicIdentity(c.channel.deviceIdentity);
    // This installation's UUID/key is already known, unlike a foreign device's first pin.
    if (peer.ownerDeviceId === host.ownerDeviceId && !same(peer, host)) return fail('UNAVAILABLE');
    const campaign = readHostedCurrentPausedCampaign(
      d.database,
      c.handle.campaignId,
      validateOwner,
    );
    requireCompatibleBaseline(campaign.baselineVersion);
    return {
      principal: {
        hostOwnerDeviceId: host.ownerDeviceId,
        campaignId: campaign.campaignId,
        peerIdentity: peer,
      },
      campaign,
    };
  }
  function requestCurrent(
    review: HostedRequestReviewCurrent,
  ): Extract<DeviceAdmissionPeerCurrent, { kind: 'REQUEST_REVIEW' }> {
    const current = deviceAdmissionRequestReviewCurrent(review.proof);
    if (
      current.request.requestRevision !== review.requestRevision ||
      current.request.status !== review.requestStatus ||
      !same(review.proof.submittedReceipt.request, requestHeader(review.submittedRequest))
    )
      return fail('UNAVAILABLE');
    return current;
  }
  function acknowledged(
    c: Connection,
    operation: Ack['operation'],
    delivery: Ack['delivery'],
    saved: HostedNetworkCommand,
  ): Ack {
    const current: DeviceAdmissionPeerCurrent =
      saved.receipt.operation === 'OPEN'
        ? { kind: 'SESSION', session: sessionHeader(saved.receipt.session) }
        : requestCurrent(
            readHostedDeviceRequestCurrent(
              d.database,
              source(c).principal,
              saved.receipt.request.requestId,
              validateOwner,
            ),
          );
    return {
      schemaVersion: 1,
      operation,
      outcome: 'ACK',
      delivery,
      receipt: shortReceipt(saved.receipt),
      current,
    };
  }
  function bindLane(
    c: Connection,
    command: Extract<DeviceAdmissionPeerCommand, { operation: 'DEVICE_REQUEST_BIND_LANE' }>,
    body: string,
  ): Ack {
    const p = source(c).principal;
    readHostedTechnicalSession(d.database, p, command.technicalSessionId, validateOwner);
    const lease = d.executor.bindScope(c.handle, {
      kind: 'SESSION',
      id: command.technicalSessionId,
    });
    const old = readHostedDeviceRequestCurrent(d.database, p, command.requestId, validateOwner);
    const binding = {
      campaignId: p.campaignId,
      requestOwnerDeviceId: p.peerIdentity.ownerDeviceId,
      requestId: command.requestId,
      technicalSessionId: command.technicalSessionId,
      submitCommandId: command.submitCommandId,
      batchSha256: command.batchSha256,
      localControllerSeatId: command.localControllerSeatId,
    };
    const prior = old.proof.laneProvenance;
    let receipt: PeerLaneBindingReceipt;
    let delivery: Ack['delivery'];
    if (prior?.kind === 'BIND_LANE') {
      receipt = prior.receipt;
      delivery = 'REPLAY';
      if (
        receipt.commandId !== command.commandId ||
        receipt.semanticBodySha256 !== postSaveSha256(body) ||
        !same(receipt.binding, binding)
      )
        return fail('IDEMPOTENCY_CONFLICT');
    } else {
      if (
        prior !== null ||
        old.submittedRequest.submitCommandId !== command.submitCommandId ||
        old.submittedRequest.technicalSessionId !== command.technicalSessionId ||
        old.submittedRequest.batch.batchSha256 !== command.batchSha256 ||
        readHostedNetworkCommand(d.database, p, command.commandId, validateOwner) !== null
      )
        return fail('IDEMPOTENCY_CONFLICT');
      receipt = {
        operation: 'BIND_LANE',
        commandId: command.commandId,
        receiptId: randomUUID(),
        semanticBodySha256: postSaveSha256(body),
        binding,
      };
      delivery = 'COMMITTED';
    }
    const response = (review: HostedRequestReviewCurrent): Ack => {
      const current = requestCurrent({
        ...review,
        proof: { ...review.proof, laneProvenance: { kind: 'BIND_LANE', receipt } },
      });
      return {
        schemaVersion: 1,
        operation: command.operation,
        outcome: 'ACK',
        delivery,
        receipt,
        current,
      };
    };
    encodeDeviceAdmissionPeerResponse(response(old));
    const result = commitHostedRequestLaneBinding(
      d.database,
      p,
      { request: command, receiptId: receipt.receiptId },
      validateOwner,
      guard(c, lease, p, () => {
        const fresh = readHostedDeviceRequestCurrent(
          d.database,
          p,
          command.requestId,
          validateOwner,
        );
        if (
          fresh.proof.laneProvenance !== null &&
          !same(fresh.proof.laneProvenance, { kind: 'BIND_LANE', receipt })
        )
          return fail('IDEMPOTENCY_CONFLICT');
        encodeDeviceAdmissionPeerResponse(response(fresh));
      }),
    );
    if (!same(result.receipt, receipt)) return fail('UNAVAILABLE');
    return {
      schemaVersion: 1,
      operation: command.operation,
      outcome: 'ACK',
      delivery,
      receipt: result.receipt,
      current: requestCurrent(result.current),
    };
  }

  function drop(stage: Stage): void {
    if (stage.disposed) return;
    stage.disposed = true;
    if (stage.timer !== null) clearTimeout(stage.timer);
    stage.timer = null;
    stage.untrack();
    for (const bytes of stage.chunks) bytes.fill(0);
    stage.chunks.length = 0;
    stagedBytes -= stage.reserved;
    activeTransfers--;
    if (stage.connection.stage === stage) stage.connection.stage = null;
  }
  function bounded(response: DeviceAdmissionPeerResponse): DeviceAdmissionPeerResponse {
    encodeDeviceAdmissionPeerResponse(response);
    return response;
  }
  function guard(
    c: Connection,
    lease: CampaignNetworkExecutionLease,
    p: HostedNetworkPrincipal,
    check: (s: HostedNetworkSource) => void,
  ) {
    return (s: HostedNetworkSource): void => {
      d.executor.assertCurrent(lease);
      const fresh = source(c);
      if (!same(fresh.principal, p) || !same(s.principal, p) || !same(fresh.campaign, s.campaign))
        return fail('UNAVAILABLE');
      check(s);
    };
  }
  function savedResponse(
    c: Connection,
    operation: Ack['operation'],
    known: HostedNetworkCommand,
    lease: CampaignNetworkExecutionLease,
    delivery: Ack['delivery'],
  ): Ack {
    const p = source(c).principal,
      preview = acknowledged(c, operation, delivery, known),
      previewText = encodeDeviceAdmissionPeerResponse(preview);
    const verified: { response?: Ack } = {};
    const result = commitHostedNetworkCommand(
      d.database,
      p,
      known.input,
      validateOwner,
      guard(c, lease, p, () => {
        const fresh = readHostedNetworkCommand(d.database, p, known.input.commandId, validateOwner);
        if (fresh === null) return fail('UNAVAILABLE');
        const response = acknowledged(c, operation, delivery, fresh);
        if (encodeDeviceAdmissionPeerResponse(response) !== previewText) return fail('UNAVAILABLE');
        verified.response = response;
      }),
      validateCandidateBaseline,
    );
    if (
      verified.response === undefined ||
      !same(verified.response.receipt, shortReceipt(result.receipt))
    )
      return fail('UNAVAILABLE');
    // The synchronous guarded transaction just verified these bytes; no await or write intervenes.
    return verified.response;
  }
  function newCommand(
    c: Connection,
    operation: Ack['operation'],
    input: HostedNetworkInput,
    lease: CampaignNetworkExecutionLease,
    preview: Ack,
    check: (s: HostedNetworkSource) => void,
  ): Ack {
    const p = source(c).principal,
      previewText = encodeDeviceAdmissionPeerResponse(preview);
    const verified: { response?: Ack } = {};
    const result = commitHostedNetworkCommand(
      d.database,
      p,
      input,
      validateOwner,
      guard(c, lease, p, (s) => {
        check(s);
        encodeDeviceAdmissionPeerResponse(preview);
        const actual = readHostedNetworkCommand(d.database, p, input.commandId, validateOwner);
        if (actual !== null) {
          const response = acknowledged(c, operation, 'COMMITTED', actual);
          if (encodeDeviceAdmissionPeerResponse(response) !== previewText)
            return fail('UNAVAILABLE');
          verified.response = response;
        }
      }),
      validateCandidateBaseline,
    );
    if (
      verified.response === undefined ||
      !same(verified.response.receipt, shortReceipt(result.receipt))
    )
      return fail('UNAVAILABLE');
    return verified.response;
  }
  function knownOpen(
    c: Connection,
    command: Extract<DeviceAdmissionPeerCommand, { operation: 'CONNECTION_OPEN' }>,
    body: string,
  ): Ack | null {
    const { principal } = source(c),
      known = readHostedNetworkCommand(d.database, principal, command.commandId, validateOwner);
    if (known === null) return null;
    if (
      known.input.operation !== 'OPEN' ||
      known.input.attemptId !== command.attemptId ||
      known.input.semanticBodyJson !== body
    )
      return fail('IDEMPOTENCY_CONFLICT');
    const attempt = d.executor.recoverScope(c.handle, { kind: 'ATTEMPT', id: command.attemptId });
    recoverOpenSession(c, principal, known);
    return savedResponse(c, command.operation, known, attempt, 'REPLAY');
  }
  function recoverOpenSession(
    c: Connection,
    principal: HostedNetworkPrincipal,
    known: HostedNetworkCommand,
  ): void {
    if (known.input.operation !== 'OPEN' || known.receipt.operation !== 'OPEN')
      return fail('IDEMPOTENCY_CONFLICT');
    const stored = readHostedTechnicalSession(
      d.database,
      principal,
      known.input.technicalSessionId,
      validateOwner,
    );
    if (!same(stored, known.receipt.session)) return fail('UNAVAILABLE');
    d.executor.recoverScope(c.handle, { kind: 'SESSION', id: stored.technicalSessionId });
  }
  function open(
    c: Connection,
    command: Extract<DeviceAdmissionPeerCommand, { operation: 'CONNECTION_OPEN' }>,
    body: string,
  ): Ack {
    const known = knownOpen(c, command, body);
    if (known !== null) return known;
    const { principal, campaign } = source(c);
    if (
      readHostedConnectionAttempt(d.database, principal, command.attemptId, validateOwner) !== null
    )
      return fail('IDEMPOTENCY_CONFLICT');
    if (command.campaignCheckpointSha256 !== campaign.checkpointSha256)
      return fail('STALE_REVISION');
    const lease = d.executor.bindScope(c.handle, { kind: 'ATTEMPT', id: command.attemptId });
    const technicalSessionId = randomUUID(),
      receiptId = randomUUID(),
      campaignProof = proof(campaign);
    const header: PeerSessionHeader = {
      technicalSessionId,
      attemptId: command.attemptId,
      campaignProof,
      connectionRevision: 0,
      receiptId,
    };
    const preview: Ack = {
      schemaVersion: 1,
      operation: command.operation,
      outcome: 'ACK',
      delivery: 'COMMITTED',
      receipt: {
        operation: 'OPEN',
        commandId: command.commandId,
        receiptId,
        semanticBodySha256: postSaveSha256(body),
        session: header,
      },
      current: { kind: 'SESSION', session: header },
    };
    const result = newCommand(
      c,
      command.operation,
      {
        operation: 'OPEN',
        commandId: command.commandId,
        receiptId,
        attemptId: command.attemptId,
        technicalSessionId,
        campaignProof,
        semanticBodyJson: body,
      },
      lease,
      preview,
      (s) => {
        if (!same(s.campaign, campaign)) return fail('STALE_REVISION');
      },
    );
    d.executor.bindScope(c.handle, { kind: 'SESSION', id: technicalSessionId });
    return result;
  }
  function recover(
    c: Connection,
    command: Extract<
      DeviceAdmissionPeerCommand,
      { operation: 'CONNECTION_RECOVER' | 'DEVICE_REQUEST_RECOVER' }
    >,
  ): DeviceAdmissionPeerResponse {
    const { principal } = source(c);
    const lease = d.executor.recoverScope(
      c.handle,
      command.operation === 'CONNECTION_RECOVER'
        ? { kind: 'ATTEMPT', id: command.attemptId }
        : { kind: 'SESSION', id: command.technicalSessionId },
    );
    d.executor.assertCurrent(lease);
    const known = readHostedNetworkCommand(
      d.database,
      principal,
      command.operation === 'CONNECTION_RECOVER' ? command.commandId : command.submitCommandId,
      validateOwner,
    );
    if (known === null) {
      if (
        command.operation === 'CONNECTION_RECOVER' &&
        readHostedConnectionAttempt(d.database, principal, command.attemptId, validateOwner) !==
          null
      )
        return fail('IDEMPOTENCY_CONFLICT');
      if (command.operation === 'DEVICE_REQUEST_RECOVER') {
        readHostedTechnicalSession(
          d.database,
          principal,
          command.technicalSessionId,
          validateOwner,
        );
        try {
          readHostedDeviceRequest(d.database, principal, command.requestId, validateOwner);
          return fail('IDEMPOTENCY_CONFLICT');
        } catch (e: unknown) {
          if (!(e instanceof NetworkApplicationStoreError) || e.code !== 'NOT_FOUND') throw e;
        }
      }
      d.executor.assertCurrent(lease);
      return command.operation === 'CONNECTION_RECOVER'
        ? {
            schemaVersion: 1,
            operation: command.operation,
            outcome: 'NOT_FOUND',
            commandId: command.commandId,
            attemptId: command.attemptId,
            semanticBodySha256: command.semanticBodySha256,
            fenced: true,
            generation: lease.generation,
          }
        : {
            schemaVersion: 1,
            operation: command.operation,
            outcome: 'NOT_FOUND',
            requestId: command.requestId,
            technicalSessionId: command.technicalSessionId,
            submitCommandId: command.submitCommandId,
            fenced: true,
            generation: lease.generation,
          };
    }
    if (command.operation === 'CONNECTION_RECOVER') {
      if (
        known.input.operation !== 'OPEN' ||
        known.input.attemptId !== command.attemptId ||
        known.receipt.semanticBodySha256 !== command.semanticBodySha256
      )
        return fail('IDEMPOTENCY_CONFLICT');
      recoverOpenSession(c, principal, known);
    } else if (
      known.input.operation !== 'SUBMIT' ||
      known.input.requestId !== command.requestId ||
      known.input.technicalSessionId !== command.technicalSessionId
    )
      return fail('IDEMPOTENCY_CONFLICT');
    return savedResponse(c, command.operation, known, lease, 'RECOVERED');
  }
  function manifestMatches(command: Begin, batch: NetworkPreparedBatch): boolean {
    return (
      command.requestId === batch.requestId &&
      command.technicalSessionId === batch.technicalSessionId &&
      command.connectionRevision === batch.connectionRevision &&
      command.campaignCheckpointSha256 === batch.campaignProof.checkpointSha256 &&
      same(
        command.candidates,
        batch.candidates.map((candidate) => ({
          descriptor: candidate.descriptor,
          witnessSha256: candidate.witnessSha256,
          witnessByteLength: candidate.byteLength,
        })),
      )
    );
  }
  function knownSubmit(
    c: Connection,
    command: Begin,
    lease: CampaignNetworkExecutionLease,
  ): Ack | null {
    const p = source(c).principal,
      known = readHostedNetworkCommand(d.database, p, command.commandId, validateOwner);
    if (known === null) return null;
    if (known.input.operation !== 'SUBMIT') return fail('IDEMPOTENCY_CONFLICT');
    const body = canonicalPostSaveJson(known.input.batch);
    if (
      !manifestMatches(command, known.input.batch) ||
      postSaveSha256(body) !== command.submitBodySha256 ||
      Buffer.byteLength(body, 'utf8') !== command.submitBodyByteLength ||
      known.input.semanticBodyJson !==
        deviceAdmissionSubmitSemanticBody(command.commandId, known.input.batch.batchSha256)
    )
      return fail('IDEMPOTENCY_CONFLICT');
    return savedResponse(c, command.operation, known, lease, 'REPLAY');
  }
  function begin(c: Connection, command: Begin, body: string): DeviceAdmissionPeerResponse {
    const { principal, campaign } = source(c);
    readHostedTechnicalSession(d.database, principal, command.technicalSessionId, validateOwner);
    const lease = d.executor.bindScope(c.handle, {
        kind: 'SESSION',
        id: command.technicalSessionId,
      }),
      known = knownSubmit(c, command, lease);
    if (known !== null) return known;
    if (c.stage !== null) {
      if (c.stage.beginText !== body) return fail('TRANSFER_UNAVAILABLE');
      return {
        schemaVersion: 1,
        operation: command.operation,
        outcome: 'TRANSFER_READY',
        transferId: c.stage.id,
        nextChunkIndex: c.stage.next,
        receivedBytes: c.stage.received,
      };
    }
    if (command.campaignCheckpointSha256 !== campaign.checkpointSha256)
      return fail('STALE_REVISION');
    if (command.candidates.length > campaign.activePlayerCapacity - campaign.activePcCount)
      return fail('CAPACITY_EXCEEDED');
    for (const candidate of command.candidates)
      requireCompatibleBaseline(candidate.descriptor.baselineVersion);
    // Reserve both accumulated chunks and the one complete Buffer used by final canonical validation.
    const reserved = command.submitBodyByteLength * 2;
    if (
      activeTransfers >= limits.maxActiveTransfers ||
      reserved > limits.maxStagedBytes - stagedBytes
    )
      return fail('TRANSFER_LIMIT');
    const stage: Stage = {
      id: randomUUID(),
      begin: command,
      beginText: body,
      lease,
      connection: c,
      chunks: [],
      reserved,
      received: 0,
      next: 0,
      timer: null,
      untrack: () => {},
      disposed: false,
    };
    stage.untrack = d.executor.trackTransfer(lease, stage.id, () => {
      drop(stage);
    });
    c.stage = stage;
    activeTransfers++;
    stagedBytes += reserved;
    stage.timer = setTimeout(() => {
      drop(stage);
      c.channel.close();
    }, limits.timeoutMs);
    return {
      schemaVersion: 1,
      operation: command.operation,
      outcome: 'TRANSFER_READY',
      transferId: stage.id,
      nextChunkIndex: 0,
      receivedBytes: 0,
    };
  }
  function stageAt(c: Connection, id: string): Stage {
    const stage = c.stage;
    if (stage === null || stage.id !== id || stage.disposed) return fail('TRANSFER_UNAVAILABLE');
    d.executor.assertCurrent(stage.lease);
    return stage;
  }
  function chunk(
    c: Connection,
    command: Extract<DeviceAdmissionPeerCommand, { operation: 'DEVICE_REQUEST_CHUNK' }>,
  ): DeviceAdmissionPeerResponse {
    source(c);
    const stage = stageAt(c, command.transferId);
    if (command.chunkIndex !== stage.next) return fail('TRANSFER_UNAVAILABLE');
    const bytes = Buffer.from(command.bytesBase64, 'base64');
    if (bytes.length > stage.begin.submitBodyByteLength - stage.received) {
      bytes.fill(0);
      drop(stage);
      return fail('TRANSFER_LIMIT');
    }
    stage.chunks.push(bytes);
    stage.received += bytes.length;
    stage.next++;
    return {
      schemaVersion: 1,
      operation: command.operation,
      outcome: 'CHUNK_ACCEPTED',
      transferId: stage.id,
      chunkIndex: command.chunkIndex,
      nextChunkIndex: stage.next,
      receivedBytes: stage.received,
    };
  }
  function submit(
    c: Connection,
    command: Extract<DeviceAdmissionPeerCommand, { operation: 'DEVICE_REQUEST_COMMIT' }>,
  ): Ack {
    const stage = stageAt(c, command.transferId);
    let bytes: Buffer | null = null;
    try {
      if (stage.received !== stage.begin.submitBodyByteLength) return fail('TRANSFER_UNAVAILABLE');
      bytes = Buffer.concat(stage.chunks, stage.received);
      if (postSaveSha256(bytes) !== stage.begin.submitBodySha256) return fail('INVALID_CANDIDATE');
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)) return fail('INVALID_CANDIDATE');
      let batch: NetworkPreparedBatch;
      try {
        const raw: unknown = JSON.parse(text);
        batch = validateNetworkPreparedBatch(raw);
        if (canonicalPostSaveJson(batch) !== text || !manifestMatches(stage.begin, batch))
          return fail('INVALID_CANDIDATE');
        for (const candidate of batch.candidates) {
          if (candidate.byteLength > limits.maxWitnessBytes) return fail('INVALID_CANDIDATE');
          validateFinalAdmissionCandidate(
            candidate.canonicalWitnessText,
            c.handle.peerDeviceId,
            candidate.descriptor,
            candidate.exportDocument,
            d.baseline,
            { maxWitnessBytes: limits.maxWitnessBytes },
          );
        }
      } catch {
        return fail('INVALID_CANDIDATE');
      }
      const { principal, campaign } = source(c);
      if (!same(batch.campaignProof, proof(campaign))) return fail('STALE_REVISION');
      if (batch.candidates.length > campaign.activePlayerCapacity - campaign.activePcCount)
        return fail('CAPACITY_EXCEEDED');
      const semanticBodyJson = deviceAdmissionSubmitSemanticBody(
        stage.begin.commandId,
        batch.batchSha256,
      );
      const existing = readHostedNetworkCommand(
        d.database,
        principal,
        stage.begin.commandId,
        validateOwner,
      );
      if (existing !== null) {
        if (
          existing.input.operation !== 'SUBMIT' ||
          existing.input.semanticBodyJson !== semanticBodyJson ||
          !same(existing.input.batch, batch)
        )
          return fail('IDEMPOTENCY_CONFLICT');
        return savedResponse(c, command.operation, existing, stage.lease, 'REPLAY');
      }
      if (batch.schemaVersion !== 2) return fail('INVALID_CANDIDATE');
      const receiptId = randomUUID();
      const header: PeerRequestHeader = {
        requestId: batch.requestId,
        technicalSessionId: batch.technicalSessionId,
        submitCommandId: stage.begin.commandId,
        submitReceiptId: receiptId,
        requestRevision: 0,
        status: 'PENDING',
        batchSha256: batch.batchSha256,
        closureOrNull: null,
      };
      const preview: Ack = {
        schemaVersion: 1,
        operation: command.operation,
        outcome: 'ACK',
        delivery: 'COMMITTED',
        receipt: {
          operation: 'SUBMIT',
          commandId: stage.begin.commandId,
          receiptId,
          semanticBodySha256: postSaveSha256(semanticBodyJson),
          request: header,
        },
        current: deviceAdmissionRequestReviewCurrent({
          submittedReceipt: {
            operation: 'SUBMIT',
            commandId: stage.begin.commandId,
            receiptId,
            semanticBodySha256: postSaveSha256(semanticBodyJson),
            request: header,
          },
          cancelledReceiptOrNull: null,
          decisions: [],
          laneProvenance: {
            kind: 'SUBMITTED_BATCH',
            batchSha256: batch.batchSha256,
            localControllerSeatId: batch.localControllerSeatId,
          },
        }),
      };
      return newCommand(
        c,
        command.operation,
        {
          operation: 'SUBMIT',
          commandId: stage.begin.commandId,
          receiptId,
          requestId: batch.requestId,
          technicalSessionId: batch.technicalSessionId,
          expectedConnectionRevision: batch.connectionRevision,
          batch,
          semanticBodyJson,
        },
        stage.lease,
        preview,
        (s) => {
          if (!same(s.campaign, campaign) || !same(proof(s.campaign), batch.campaignProof))
            return fail('STALE_REVISION');
          if (batch.candidates.length > s.campaign.activePlayerCapacity - s.campaign.activePcCount)
            return fail('CAPACITY_EXCEEDED');
        },
      );
    } finally {
      bytes?.fill(0);
      drop(stage);
    }
  }
  function cancel(
    c: Connection,
    command: Extract<DeviceAdmissionPeerCommand, { operation: 'DEVICE_REQUEST_CANCEL' }>,
    body: string,
  ): Ack {
    const p = source(c).principal;
    readHostedTechnicalSession(d.database, p, command.technicalSessionId, validateOwner);
    const lease = d.executor.bindScope(c.handle, {
        kind: 'SESSION',
        id: command.technicalSessionId,
      }),
      known = readHostedNetworkCommand(d.database, p, command.commandId, validateOwner);
    if (known !== null) {
      if (known.input.operation !== 'CANCEL' || known.input.semanticBodyJson !== body)
        return fail('IDEMPOTENCY_CONFLICT');
      return savedResponse(c, command.operation, known, lease, 'REPLAY');
    }
    const old = readHostedDeviceRequest(d.database, p, command.requestId, validateOwner);
    const review = readHostedDeviceRequestCurrent(d.database, p, command.requestId, validateOwner);
    if (review.requestStatus !== 'PENDING' || review.requestRevision !== command.requestRevision)
      return fail('STALE_REVISION');
    if (
      old.technicalSessionId !== command.technicalSessionId ||
      old.requestRevision !== command.requestRevision ||
      old.closureOrNull !== null ||
      old.requestRevision === Number.MAX_SAFE_INTEGER
    )
      return fail('STALE_REVISION');
    const receiptId = randomUUID(),
      header: PeerRequestHeader = {
        ...requestHeader(old),
        requestRevision: old.requestRevision + 1,
        closureOrNull: { commandId: command.commandId, receiptId, reason: command.reason },
      };
    const preview: Ack = {
      schemaVersion: 1,
      operation: command.operation,
      outcome: 'ACK',
      delivery: 'COMMITTED',
      receipt: {
        operation: 'CANCEL',
        commandId: command.commandId,
        receiptId,
        semanticBodySha256: postSaveSha256(body),
        request: header,
      },
      current: deviceAdmissionRequestReviewCurrent({
        ...review.proof,
        cancelledReceiptOrNull: {
          operation: 'CANCEL',
          commandId: command.commandId,
          receiptId,
          semanticBodySha256: postSaveSha256(body),
          request: header,
        },
      }),
    };
    return newCommand(
      c,
      command.operation,
      {
        operation: 'CANCEL',
        commandId: command.commandId,
        receiptId,
        requestId: command.requestId,
        technicalSessionId: command.technicalSessionId,
        expectedRequestRevision: command.requestRevision,
        reason: command.reason,
        semanticBodyJson: body,
      },
      lease,
      preview,
      (s) => {
        if (!same(s.requestOrNull, old)) return fail('STALE_REVISION');
      },
    );
  }
  function execute(
    c: Connection,
    command: DeviceAdmissionPeerCommand,
    body: string,
  ): DeviceAdmissionPeerResponse {
    try {
      switch (command.operation) {
        case 'CONNECTION_OPEN':
          return bounded(open(c, command, body));
        case 'CONNECTION_RECOVER':
        case 'DEVICE_REQUEST_RECOVER':
          return bounded(recover(c, command));
        case 'DEVICE_REQUEST_BEGIN':
          return bounded(begin(c, command, body));
        case 'DEVICE_REQUEST_CHUNK':
          return bounded(chunk(c, command));
        case 'DEVICE_REQUEST_COMMIT':
          return bounded(submit(c, command));
        case 'DEVICE_REQUEST_BIND_LANE':
          return bounded(bindLane(c, command, body));
        case 'DEVICE_REQUEST_CANCEL':
          return bounded(cancel(c, command, body));
      }
    } catch (error: unknown) {
      return responseRefusal(command.operation, error);
    }
  }
  function run(channel: CampaignPeerServerChannel): Promise<void> {
    if (closed) return Promise.reject(new DeviceAdmissionPeerRuntimeError('CLOSED'));
    if (
      connections.size >= limits.maxChannels ||
      [...connections].some((c) => c.channel === channel)
    )
      return Promise.reject(new DeviceAdmissionPeerRuntimeError('INVALID_CHANNEL'));
    let handle: CampaignNetworkExecutionChannel;
    try {
      handle = d.executor.registerChannel(channel);
    } catch {
      return Promise.reject(new DeviceAdmissionPeerRuntimeError('INVALID_CHANNEL'));
    }
    const c: Connection = { channel, handle, stage: null, task: null };
    connections.add(c);
    c.task = (async () => {
      try {
        source(c);
        while (!closed && !channel.closed) {
          const request = await channel.receiveRequest();
          const command = decodeDeviceAdmissionPeerCommand(request.bodyJson, commandLimits);
          const result = await d.executor.run(handle, () => execute(c, command, request.bodyJson));
          await channel.respond(request.sequenceNumber, encodeDeviceAdmissionPeerResponse(result));
        }
      } catch {
        if (!closed && !channel.closed) {
          channel.close();
          throw new DeviceAdmissionPeerRuntimeError('CHANNEL_FAILED');
        }
      } finally {
        if (c.stage !== null) drop(c.stage);
        connections.delete(c);
        try {
          d.executor.closeChannel(handle);
        } catch {
          /* Lease retirement is already fail-closed; never expose callback diagnostics. */
        }
      }
    })();
    return c.task;
  }
  /** Read-only host facts: queue identities come from storage, never a browser principal. */
  function requestConnectionFacts(
    campaignId: string,
    authoritativeRequestIds: readonly string[],
  ): readonly DeviceAdmissionPeerRequestConnectionFact[] {
    if (
      !Array.isArray(authoritativeRequestIds) ||
      authoritativeRequestIds.some((id) => typeof id !== 'string' || id.length === 0) ||
      new Set(authoritativeRequestIds).size !== authoritativeRequestIds.length
    )
      throw new NetworkApplicationStoreError('INVALID_INPUT');
    const read = () => {
      const origin = readHostedCampaignCreationOrigin(d.database, campaignId, validateOwner);
      const queue = readGmDeviceRequestQueue(
        d.database,
        {
          ownerDeviceId: loadDeviceId(d.database),
          gmLocalContextId: origin.command.request.payload.gmLocalContextId,
          campaignId,
        },
        validateOwner,
      );
      return connectionFacts(campaignId, authoritativeRequestIds, queue);
    };
    // A command guard reads its existing snapshot; standalone refresh opens only a deferred read.
    return d.database.inTransaction ? read() : d.database.transaction(read).deferred();
  }

  /** Internal synchronous composition only: never retain this source across await or a write. */
  function requestConnectionFactsFromSource(
    verified: GmRequestReviewSource,
  ): readonly DeviceAdmissionPeerRequestConnectionFact[] {
    const { scope, queue } = verified;
    const origin = readHostedCampaignCreationOrigin(d.database, scope.campaignId, validateOwner);
    if (
      scope.ownerDeviceId !== loadDeviceId(d.database) ||
      scope.gmLocalContextId !== origin.command.request.payload.gmLocalContextId ||
      queue.campaignId !== scope.campaignId
    )
      throw new NetworkApplicationStoreError('FOREIGN_OWNER');
    return connectionFacts(
      scope.campaignId,
      queue.requests.map((r) => r.submittedRequest.requestId),
      queue,
    );
  }
  function connectionFacts(
    campaignId: string,
    requestIds: readonly string[],
    queue: VerifiedGmRequestQueue,
  ): readonly DeviceAdmissionPeerRequestConnectionFact[] {
    if (new Set(requestIds).size !== requestIds.length)
      throw new NetworkApplicationStoreError('INVALID_INPUT');
    return Object.freeze(
      [...requestIds].sort().map((requestId) => {
        const stored = queue.requests.find((r) => r.submittedRequest.requestId === requestId);
        if (stored === undefined) throw new NetworkApplicationStoreError('NOT_FOUND');
        const expected = stored.submittedRequest.principal;
        if (expected.campaignId !== campaignId)
          throw new NetworkApplicationStoreError('FOREIGN_OWNER');
        // This also proves disconnected identities; a supplied UUID/key is never authority.
        readHostedDeviceRequest(d.database, expected, requestId, validateOwner);
        const connected =
          !closed &&
          [...connections].some((connection) => {
            if (
              connection.channel.closed ||
              connection.handle.campaignId !== campaignId ||
              !same(connection.channel.deviceIdentity, expected.peerIdentity)
            )
              return false;
            return same(source(connection).principal, expected);
          });
        return Object.freeze({
          requestId,
          requestOwnerDeviceId: expected.peerIdentity.ownerDeviceId,
          connected,
        });
      }),
    );
  }

  function close(): Promise<void> {
    if (closePromise !== undefined) return closePromise;
    closed = true;
    const tasks: Promise<void>[] = [];
    for (const c of connections) {
      if (c.stage !== null) drop(c.stage);
      c.channel.close();
      if (c.task !== null) tasks.push(c.task);
    }
    closePromise = Promise.allSettled(tasks).then(() => undefined);
    return closePromise;
  }
  return Object.freeze({ run, close, requestConnectionFacts, requestConnectionFactsFromSource });
}
