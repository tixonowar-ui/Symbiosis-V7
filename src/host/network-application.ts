import type Database from 'better-sqlite3';
import type {
  ClientToHostMessage,
  HostToClientMessage,
  RevisionVector,
  WorkflowCommandCapabilityId,
} from '../shared/wire-protocol.js';
import type {
  ClientToHostV2Message,
  HostToClientV2Message,
  ProjectionSnapshotV2Message,
} from '../shared/wire-v2-protocol.js';
import type { ClientToHostV3Message, HostToClientV3Message } from '../shared/wire-v3-protocol.js';
import type { LocalCharacterExportBaseline } from './local-character-export.js';
import type { LocalPostSaveDependencies } from './local-character-post-save.js';
import type { createLocalNetworkPeer } from './network-local-peer.js';
import type { NetworkApplicationConfig } from './network-application-config.js';
import type { CampaignDiscoveryScan } from './campaign-discovery.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  loadDeviceId,
  listLocalCharacters,
  readLocalCharacterOwner,
} from '../persistence/index.js';
import {
  commitLocalNetworkTabEntry,
  readLocalNetworkTabEntryByCommandId,
  readActiveLocalNetworkTab,
  commitLocalNetworkTabClose,
  readLocalNetworkTabClosure,
  readLocalNetworkTabCloseByCommandId,
  type LocalNetworkTabCloseInput,
} from '../persistence/network-local-tab.js';
import {
  commitLocalNetworkMutation,
  readLocalNetworkApplication,
  readLocalNetworkApplicationEvent,
  readLocalNetworkOutbox,
  readLocalNetworkAcknowledgementEvent,
  readLocalNetworkDeliverySnapshot,
  readLocalNetworkRequestDeliverySnapshot,
  readLocalNetworkShellExitByNavigationId,
  readLocalNetworkAttemptCount,
  readLocalNetworkOpenOutboxByAttempt,
  readLocalRequestLaneBinding,
  prepareLocalRequestLaneBinding,
  acknowledgeLocalRequestLaneBinding,
  readLocalNetworkCancelSettlementEvent,
  commitLocalNetworkCancelSettlement,
  commitLocalNetworkRequestAdvance,
  validateRequestReviewProof,
  NetworkApplicationStoreError,
  type LocalNetworkScope,
  type LocalNetworkApplication,
  type LocalNetworkMutation,
  type LocalNetworkOutbox,
  type LocalNetworkAcknowledgement,
  type NetworkPreparedCandidate,
  type NetworkPreparedBatch,
  type StoredLocalNetworkEvent,
  type LocalNetworkDeliverySnapshot,
} from '../persistence/network-local-application.js';
import {
  NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
  NETWORK_WORKFLOW_COMMAND_IDS,
  type NetworkDraftReplaceV3Message,
  type PublicCandidateRef,
} from '../shared/device-admission.js';
import { networkWorkflowPayloadValue } from '../shared/network-application-codec.js';
import type {
  NetworkWorkflowRequest,
  NetworkCommandResult,
  NetworkPublicErrorCode,
} from '../shared/network-application.js';
import type { FormActionIntentV2Message } from '../shared/wire-v2-protocol.js';
import type { CommandReceipt, JsonObject } from '../shared/wire-protocol.js';
import { canonicalPostSaveJson, postSaveSha256 } from './local-character-export.js';
import {
  prepareOwnedFinalAdmissionCandidate,
  validateFinalAdmissionCandidate,
} from './device-admission-candidate.js';
import {
  deviceAdmissionSubmitSemanticBody,
  encodeDeviceAdmissionPeerResponse,
  deviceAdmissionRequestReviewCurrent,
  type DeviceAdmissionPeerResponse,
} from './device-admission-peer-response.js';
import { encodeDeviceAdmissionPeerCommand } from './device-admission-peer-commands.js';
import { LocalNetworkPeerError } from './network-local-peer.js';
import { parseCampaignLanAddress } from './campaign-lan-address.js';
import {
  projectNetworkApplication,
  candidateSummary,
  networkCapacity,
} from './projections/net-application.js';

export type LocalNetworkClientMessage =
  ClientToHostMessage | ClientToHostV2Message | ClientToHostV3Message;
export type LocalNetworkHostMessage =
  HostToClientMessage | HostToClientV2Message | HostToClientV3Message;
export interface LocalNetworkConnection {
  networkScopeId: string | null;
  contextId: string | null;
  executableWorkflowCommandIds: readonly WorkflowCommandCapabilityId[];
  readonly trusted: () => boolean;
}
export interface LocalNetworkShell {
  readonly formId: string | null;
  readonly contextId: string | null;
  readonly deviceId: string | null;
  readonly revisions: RevisionVector;
  readonly sourceFinalIdOrNull: string | null;
  readonly lastNetworkExitNavigationIdOrNull: string | null;
  readonly enterNetwork: () => void;
  readonly exitToPlayer: (
    navigationId: string,
  ) => ProjectionSnapshotV2Message | Promise<ProjectionSnapshotV2Message>;
  readonly returnToFinal: (
    sourceUuid: string,
    navigationId: string,
  ) => ProjectionSnapshotV2Message | Promise<ProjectionSnapshotV2Message>;
}
export interface LocalNetworkRuntimeDependencies {
  readonly database: Database.Database;
  readonly projectRoot: string;
  readonly baseline: LocalCharacterExportBaseline;
  readonly postSave: LocalPostSaveDependencies;
  readonly peer: ReturnType<typeof createLocalNetworkPeer>;
  readonly config: NetworkApplicationConfig;
  readonly discover: () => Promise<CampaignDiscoveryScan>;
}
const vector = (s: RevisionVector): RevisionVector => ({
  stateRevision: s.stateRevision,
  projectionRevision: s.projectionRevision,
  actorVisibilityRevision: s.actorVisibilityRevision,
});
function unavailable(): never {
  throw new NetworkApplicationStoreError('UNAVAILABLE');
}
const exact = (a: unknown, b: unknown): void => {
  if (!isDeepStrictEqual(a, b)) throw new NetworkApplicationStoreError('IDEMPOTENCY_CONFLICT');
};
const eventId = (id: string) => `navigation:${id}`;
const actionFor: Readonly<Record<string, string>> = {
  'UI-CMD-CONNECTION-OPEN': 'NET-002::CTA::003',
  'UI-CMD-DEVICE-REQUEST-SUBMIT': 'NET-004::CTA::002',
  'UI-CMD-DEVICE-REQUEST-CANCEL': 'NET-005::CTA::001',
};
class LocalNetworkPublicationError extends Error {
  constructor() {
    super('Network publication failed after durable acknowledgement');
  }
}
/** One own host serializes local intents; only the authenticated Node peer crosses the LAN. */
export function createLocalNetworkRuntime(d: LocalNetworkRuntimeDependencies) {
  const db = d.database;
  const commandLimits = {
    maxSubmitBodyBytes: d.config.transfer.maxSubmitBodyBytes,
    maxWitnessBytes: d.config.transfer.maxWitnessBytes,
    maxChunkBytes: d.config.transfer.maxChunkBytes,
  };
  let closed = false,
    frames = Promise.resolve();
  const discovery = new Map<string, CampaignDiscoveryScan | null>(),
    discoveryFailures = new Set<string>();
  const trust = (c: LocalNetworkConnection) => {
    if (closed || !c.trusted()) unavailable();
  };
  const owner = (c: LocalNetworkConnection) => {
    trust(c);
    return loadDeviceId(db);
  };
  const scope = (c: LocalNetworkConnection): LocalNetworkScope => {
    const ownerDeviceId = owner(c);
    if (c.networkScopeId === null || c.contextId === null) return unavailable();
    return { ownerDeviceId, networkScopeId: c.networkScopeId };
  };
  const current = (c: LocalNetworkConnection) => readLocalNetworkApplication(db, scope(c));
  const currentVector = (c: LocalNetworkConnection) => vector(current(c));
  function guard(c: LocalNetworkConnection, expected?: LocalNetworkApplication) {
    const bound = scope(c),
      contextId = c.contextId;
    return () => {
      trust(c);
      exact(scope(c), bound);
      if (c.contextId !== contextId) unavailable();
      if (expected !== undefined) {
        const actual = current(c);
        if (!isDeepStrictEqual(actual, expected))
          throw new NetworkApplicationStoreError('STALE_REVISION');
      }
    };
  }
  function mutate(
    c: LocalNetworkConnection,
    mutation: LocalNetworkMutation,
    id: string = randomUUID(),
    client: string | null = null,
    verifiedCurrent?: LocalNetworkApplication,
  ) {
    const s = verifiedCurrent ?? current(c),
      known = readLocalNetworkApplicationEvent(db, scope(c), id);
    if (known !== null) {
      exact(known.input.clientRequestJsonOrNull, client);
      exact(known.input.mutation, mutation);
      return commitLocalNetworkMutation(db, known.input, guard(c));
    }
    return commitLocalNetworkMutation(
      db,
      {
        ...scope(c),
        eventId: id,
        receiptId: randomUUID(),
        expectedRevisions: vector(s),
        expectedDraftRevision: s.draftRevision,
        clientRequestJsonOrNull: client,
        mutation,
      },
      guard(c),
    );
  }
  function prepared(c: LocalNetworkConnection, id: string): NetworkPreparedCandidate {
    return prepareOwnedFinalAdmissionCandidate(d.postSave, owner(c), id, {
      maxWitnessBytes: d.config.transfer.maxWitnessBytes,
    });
  }
  function candidates(
    c: LocalNetworkConnection,
    s: LocalNetworkApplication,
  ): readonly NetworkPreparedCandidate[] {
    if (s.formId === 'NET-004' || s.formId === 'NET-005')
      return s.preparedBatchOrNull?.candidates ?? [];
    if (s.formId === 'CHR-027') return s.selectedCandidates.map((r) => prepared(c, r.sourceUuid));
    if (s.formId !== 'NET-003') return [];
    return listLocalCharacters(db)
      .filter(
        (row) =>
          row.lifecycleState === 'FINAL' &&
          readLocalCharacterOwner(db, row.localCharacterId)?.ownerDeviceId === s.ownerDeviceId,
      )
      .map((row) => prepared(c, row.localCharacterId));
  }
  const project = (c: LocalNetworkConnection, s = current(c)) => {
    return projectNetworkApplication({
      state: s,
      contextId: c.contextId!,
      supported: c.executableWorkflowCommandIds,
      campaign: d.peer.current(s.networkScopeId)?.campaign ?? null,
      candidates: candidates(c, s),
      discovery: discovery.get(s.networkScopeId) ?? null,
      discoveryUnavailable: discoveryFailures.has(s.networkScopeId),
      baselineVersion: d.baseline.baselineVersion,
      isCompatibleBaseline: (version) =>
        isStoredLocalCharacterExportBaselineCompatible(d.baseline, version),
      attemptCount: s.formId === 'NET-011' ? readLocalNetworkAttemptCount(db, scope(c)) : 0,
    });
  };
  const snapshot = (
    c: LocalNetworkConnection,
    id: string,
    reason: 'FORM_ACTION' | 'RECONNECT' | 'COMMAND_DESTINATION' | 'HOST_SYSTEM_EVENT',
    verifiedCurrent?: LocalNetworkApplication,
  ): ProjectionSnapshotV2Message => {
    const s = verifiedCurrent ?? current(c);
    return {
      messageType: 'projection.snapshot',
      protocolVersion: 2,
      projectionRole: 'player',
      revisions: vector(s),
      presentation: { assignment: { reason, correlationId: id }, base: project(c, s), layers: [] },
    };
  };
  function fresh(
    c: LocalNetworkConnection,
    contextId: string,
    revisions: RevisionVector,
    draftRevision?: number,
  ) {
    const s = current(c);
    if (c.contextId !== contextId) unavailable();
    if (!isDeepStrictEqual(vector(s), revisions))
      throw new NetworkApplicationStoreError('STALE_REVISION');
    if (draftRevision !== undefined && s.draftRevision !== draftRevision)
      throw new NetworkApplicationStoreError('STALE_REVISION');
    return s;
  }
  function selected(
    c: LocalNetworkConnection,
    refs: readonly PublicCandidateRef[],
  ): readonly NetworkPreparedCandidate[] {
    const s = current(c);
    if (refs.length > 3 || new Set(refs.map((r) => r.sourceUuid)).size !== refs.length)
      unavailable();
    return refs.map((r) => {
      const p = prepared(c, r.sourceUuid),
        summary = candidateSummary(p, s.tabId);
      exact(r, {
        sourceUuid: summary.sourceUuid,
        finalSnapshotVersion: summary.finalSnapshotVersion,
        metadataRevision: summary.metadataRevision,
        candidateSnapshotChecksum: summary.candidateSnapshotChecksum,
        requestedControllerSeat: s.tabId,
      });
      if (p.descriptor.baselineVersion !== d.baseline.baselineVersion) unavailable();
      return p;
    });
  }
  function planRetry(c: LocalNetworkConnection, s = current(c)) {
    if (
      s.formId === 'NET-011' &&
      s.sessionOrNull === null &&
      s.pendingCommandIdOrNull === null &&
      (s.requestOrNull === null || s.requestOrNull.closureOrNull !== null) &&
      (s.plannedAttemptIdOrNull === null || s.plannedAttemptIdOrNull === s.lastAttemptIdOrNull)
    )
      return mutate(
        c,
        {
          kind: 'NAVIGATE',
          targetFormId: 'NET-011',
          plannedAttemptIdOrNull: randomUUID(),
          singleCandidateOrNull: null,
        },
        undefined,
        null,
        s,
      ).current;
    return s;
  }
  function diagnostic(
    c: LocalNetworkConnection,
    code: NetworkPublicErrorCode,
    attemptIdOrNull?: string,
  ) {
    mutate(c, {
      kind: 'DIAGNOSTIC',
      code,
      ...(attemptIdOrNull === undefined ? {} : { attemptIdOrNull }),
    });
    planRetry(c);
  }
  async function reconnect(
    c: LocalNetworkConnection,
    force = false,
    verifiedSource?: LocalNetworkDeliverySnapshot,
  ) {
    const s = verifiedSource?.current ?? current(c),
      bound = scope(c),
      contextId = c.contextId;
    const verify = (actual = current(c)) => {
      trust(c);
      exact(scope(c), bound);
      if (c.contextId !== contextId) unavailable();
      if (!isDeepStrictEqual(actual, s)) throw new NetworkApplicationStoreError('STALE_REVISION');
    };
    if (!force && d.peer.current(s.networkScopeId) !== null) return;
    const out =
      s.pendingCommandIdOrNull === null
        ? null
        : verifiedSource === undefined
          ? readLocalNetworkOutbox(db, scope(c), s.pendingCommandIdOrNull)
          : verifiedSource.outbox;
    const campaignId =
      out?.intent.operation === 'OPEN'
        ? out.intent.campaignId
        : s.sessionOrNull?.campaignProof.campaignId;
    if (campaignId === undefined) return;
    const address =
      out?.intent.operation === 'OPEN' ? out.intent.canonicalOrigin : s.addressOrQrPayload;
    await d.peer.reconnect(scope(c), address, campaignId);
    // A newly authenticated transport must reconcile the existing logical session
    // before it can issue another command against that session's generation.
    if (out?.intent.operation !== 'OPEN' && s.requestOrNull !== null) {
      verify();
      await refreshRequest(c);
    } else if (out?.intent.operation !== 'OPEN' && s.sessionOrNull !== null) {
      verify();
      const opening = readLocalNetworkOpenOutboxByAttempt(db, scope(c), s.sessionOrNull.attemptId);
      if (opening === null || opening.acknowledgementOrNull?.operation !== 'OPEN') unavailable();
      const recovered = await d.peer.recover(scope(c), opening);
      verify();
      if (
        recovered.outcome !== 'ACK' ||
        recovered.operation !== 'CONNECTION_RECOVER' ||
        recovered.receipt.operation !== 'OPEN' ||
        recovered.current.kind !== 'SESSION'
      )
        unavailable();
      exact(recovered.receipt.commandId, opening.intent.commandId);
      exact(recovered.receipt.semanticBodySha256, opening.semanticBodySha256);
      exact(recovered.receipt.session, s.sessionOrNull);
      exact(recovered.current.session, s.sessionOrNull);
    } else verify();
  }
  function requestProof(
    c: LocalNetworkConnection,
    response: DeviceAdmissionPeerResponse,
    verifiedDelivery?: LocalNetworkDeliverySnapshot,
  ) {
    if (response.outcome !== 'ACK' || response.current.kind !== 'REQUEST_REVIEW') return null;
    const proof = response.current.proof,
      delivery =
        verifiedDelivery ??
        readLocalNetworkDeliverySnapshot(db, scope(c), proof.submittedReceipt.commandId),
      submit = delivery.outbox;
    if (
      submit?.intent.operation !== 'SUBMIT' ||
      submit.intent.commandId !== proof.submittedReceipt.commandId ||
      submit.networkScopeId !== scope(c).networkScopeId ||
      submit.ownerDeviceId !== owner(c)
    )
      unavailable();
    const ack = submit.acknowledgementOrNull;
    // Before the first local ACK, the signed original SUBMIT is the only admissible receipt.
    const original =
      ack === null
        ? response.receipt
        : ack.operation === 'SUBMIT'
          ? {
              operation: 'SUBMIT' as const,
              commandId: ack.commandId,
              receiptId: ack.request.submitReceiptId,
              semanticBodySha256: ack.semanticBodySha256,
              request: ack.request,
            }
          : unavailable();
    if (original.operation !== 'SUBMIT') unavailable();
    const result = validateRequestReviewProof(proof, {
      submittedReceipt: original,
      batch: submit.intent.batch,
      requestOwnerDeviceId: submit.ownerDeviceId,
      campaignId: submit.intent.batch.campaignProof.campaignId,
    });
    exact(response.current.request, {
      ...proof.submittedReceipt.request,
      requestRevision: result.requestRevision,
      status: result.requestStatus,
      closureOrNull: proof.cancelledReceiptOrNull?.request.closureOrNull ?? null,
    });
    return { proof: result.proof, submit, status: result.requestStatus, delivery };
  }
  async function applyRequestCurrent(
    c: LocalNetworkConnection,
    response: DeviceAdmissionPeerResponse,
    verifiedDelivery?: LocalNetworkDeliverySnapshot,
  ) {
    let parsed = requestProof(c, response, verifiedDelivery);
    if (parsed === null) return;
    const bound = scope(c),
      contextId = c.contextId;
    const check = (s = current(c)) => {
      trust(c);
      exact(scope(c), bound);
      if (c.contextId !== contextId) unavailable();
      if (s.requestOrNull?.requestId !== parsed!.proof.submittedReceipt.request.requestId)
        unavailable();
      return s;
    };
    check(parsed.delivery.current);
    const requestId = parsed.proof.submittedReceipt.request.requestId;
    if (
      parsed.submit.intent.operation !== 'SUBMIT' ||
      parsed.submit.acknowledgementOrNull?.operation !== 'SUBMIT'
    )
      unavailable();
    if (parsed.submit.intent.batch.schemaVersion !== 2) {
      let lane = readLocalRequestLaneBinding(db, bound, requestId);
      const remote = parsed.proof.laneProvenance;
      if (remote?.kind === 'BIND_LANE') {
        // A remote proof cannot invent a local BIND identity after the original intent was lost.
        if (lane === null || lane.request.commandId !== remote.receipt.commandId) unavailable();
        acknowledgeLocalRequestLaneBinding(
          db,
          bound,
          lane.request.commandId,
          remote.receipt,
          guard(c),
        );
      } else if (remote === null) {
        if (lane?.receiptOrNull != null) unavailable();
        lane ??= prepareLocalRequestLaneBinding(db, bound, requestId, randomUUID(), guard(c));
        const verify = guard(c, check());
        const recovered = await d.peer.recoverLaneBinding(bound, lane);
        verify();
        if (
          recovered.outcome !== 'ACK' ||
          recovered.operation !== 'DEVICE_REQUEST_RECOVER' ||
          recovered.receipt.operation !== 'SUBMIT'
        )
          unavailable();
        let updated = requestProof(c, recovered) ?? unavailable();
        if (updated.proof.laneProvenance === null) {
          // Recovery fenced the old channel before retransmitting the SAME durable BIND intent.
          verify();
          const delivered = await d.peer.deliverLaneBinding(bound, lane);
          verify();
          if (
            delivered.outcome !== 'ACK' ||
            delivered.operation !== 'DEVICE_REQUEST_BIND_LANE' ||
            delivered.receipt.operation !== 'BIND_LANE'
          )
            unavailable();
          updated = requestProof(c, delivered) ?? unavailable();
        }
        const receipt = updated.proof.laneProvenance;
        if (receipt?.kind !== 'BIND_LANE' || receipt.receipt.commandId !== lane.request.commandId)
          unavailable();
        acknowledgeLocalRequestLaneBinding(
          db,
          bound,
          lane.request.commandId,
          receipt.receipt,
          guard(c),
        );
        parsed = updated;
      } else unavailable();
    }
    // v2 provenance performs no await or mutation above; retain that one verified read only here.
    if (parsed.submit.intent.operation !== 'SUBMIT') unavailable();
    const sameRead = parsed.submit.intent.batch.schemaVersion === 2;
    const s = check(sameRead ? parsed.delivery.current : undefined);
    const pending =
      s.pendingCommandIdOrNull === null
        ? null
        : readLocalNetworkOutbox(db, bound, s.pendingCommandIdOrNull);
    if (
      pending?.intent.operation === 'CANCEL' &&
      ['IN_REVIEW', 'REJECTED'].includes(parsed.status)
    ) {
      const known = readLocalNetworkCancelSettlementEvent(db, bound, pending.intent.commandId);
      if (known !== null) {
        commitLocalNetworkMutation(db, known.input, guard(c));
      } else {
        commitLocalNetworkCancelSettlement(
          db,
          {
            ...bound,
            expectedRevisions: vector(s),
            expectedDraftRevision: s.draftRevision,
          },
          {
            eventId: randomUUID(),
            receiptId: randomUUID(),
            commandId: pending.intent.commandId,
            proof: parsed.proof,
          },
          guard(c),
        );
      }
      return;
    }
    const confirmed = sameRead
      ? parsed.delivery
      : readLocalNetworkDeliverySnapshot(db, bound, parsed.submit.intent.commandId);
    if (isDeepStrictEqual(confirmed.requestCurrentOrNull?.proof, parsed.proof)) return;
    const source = confirmed.current;
    commitLocalNetworkRequestAdvance(
      db,
      {
        ...bound,
        expectedRevisions: vector(source),
        expectedDraftRevision: source.draftRevision,
      },
      { eventId: randomUUID(), receiptId: randomUUID(), proof: parsed.proof },
      guard(c),
    );
  }
  async function refreshRequest(
    c: LocalNetworkConnection,
    verifiedBefore?: LocalNetworkDeliverySnapshot,
  ) {
    const before = verifiedBefore ?? readLocalNetworkRequestDeliverySnapshot(db, scope(c)),
      s = before.current,
      request = s.requestOrNull;
    if (request === null) return;
    const submit = before.outbox;
    if (
      submit?.intent.operation !== 'SUBMIT' ||
      submit.intent.commandId !== request.submitCommandId ||
      submit.acknowledgementOrNull?.operation !== 'SUBMIT'
    )
      unavailable();
    const verifyAuthority = guard(c);
    const response = await d.peer.recover(scope(c), submit);
    // No pre-await cache is authoritative here: fold the owned history again, then use that one fresh result synchronously.
    const after = readLocalNetworkDeliverySnapshot(db, scope(c), submit.intent.commandId);
    verifyAuthority();
    if (!isDeepStrictEqual(after.current, s))
      throw new NetworkApplicationStoreError('STALE_REVISION');
    if (
      response.outcome !== 'ACK' ||
      response.operation !== 'DEVICE_REQUEST_RECOVER' ||
      response.receipt.operation !== 'SUBMIT'
    )
      unavailable();
    exact(response.receipt.commandId, submit.intent.commandId);
    exact(response.receipt.semanticBodySha256, submit.semanticBodySha256);
    exact(response.receipt.request, submit.acknowledgementOrNull.request);
    if (response.current.kind === 'REQUEST') exact(response.current.request, request);
    else if (response.current.kind === 'REQUEST_REVIEW')
      await applyRequestCurrent(c, response, after);
    else unavailable();
  }

  function receipt(
    c: LocalNetworkConnection,
    out: LocalNetworkOutbox,
    verifiedEvent?: StoredLocalNetworkEvent | null,
  ): CommandReceipt<NetworkCommandResult> | null {
    const event =
        verifiedEvent === undefined
          ? readLocalNetworkAcknowledgementEvent(db, scope(c), out.intent.commandId)
          : verifiedEvent,
      a = out.acknowledgementOrNull;
    if (event === null || a === null || a.operation === 'OPEN_FAILURE') return null;
    const open = a.operation === 'OPEN';
    return {
      commandId: out.intent.commandId,
      receiptId: event.receipt.receiptId,
      revisions: event.receipt.revisions,
      result: {
        operation: a.operation,
        networkScopeId: out.networkScopeId,
        remoteReceiptId: open
          ? a.session.receiptId
          : a.operation === 'SUBMIT'
            ? a.request.submitReceiptId
            : a.request.closureOrNull!.receiptId,
        technicalSessionId: open ? a.session.technicalSessionId : a.request.technicalSessionId,
        attemptIdOrNull: open ? a.session.attemptId : null,
        requestIdOrNull: open ? null : a.request.requestId,
        requestRevisionOrNull: open ? null : a.request.requestRevision,
        outcome: open ? 'CONNECTED_TECHNICAL' : a.operation === 'SUBMIT' ? 'PENDING' : 'CANCELLED',
      },
    };
  }
  function terminal(
    c: LocalNetworkConnection,
    out: LocalNetworkOutbox,
    replay: boolean,
    send: (m: LocalNetworkHostMessage) => void,
    delivery?: LocalNetworkDeliverySnapshot,
  ) {
    if (out.intent.operation === 'CANCEL') {
      delivery ??= readLocalNetworkDeliverySnapshot(db, scope(c), out.intent.commandId);
      if (delivery.cancelSettlementOrNull !== null) {
        send({
          messageType: 'command.refusal',
          protocolVersion: 1,
          commandId: out.intent.commandId,
          lastLifecycleState: null,
          revisions: vector(delivery.current),
          refusal: { code: 'GUARD_REJECTED' },
        });
        return;
      }
    }
    const r = receipt(c, out, delivery?.acknowledgementEvent);
    if (r !== null)
      send(
        replay
          ? {
              messageType: 'command.replay',
              protocolVersion: 1,
              lifecycleState: 'IDEMPOTENT_REPLAY',
              receipt: r,
            }
          : {
              messageType: 'command.result',
              protocolVersion: 1,
              lifecycleState: 'COMMITTED',
              receipt: r,
            },
      );
    else if (out.acknowledgementOrNull?.operation === 'OPEN_FAILURE')
      send({
        messageType: 'command.refusal',
        protocolVersion: 1,
        commandId: out.intent.commandId,
        lastLifecycleState: null,
        revisions: delivery === undefined ? currentVector(c) : vector(delivery.current),
        refusal: { code: 'GUARD_REJECTED' },
      });
  }
  function unresolved(
    c: LocalNetworkConnection,
    original: LocalNetworkOutbox,
    verifiedDelivery?: LocalNetworkDeliverySnapshot,
  ) {
    const delivery =
        verifiedDelivery ??
        readLocalNetworkDeliverySnapshot(db, scope(c), original.intent.commandId),
      now = delivery.outbox;
    if (
      now === null ||
      now.acknowledgementOrNull !== null ||
      delivery.current.pendingCommandIdOrNull !== original.intent.commandId
    )
      unavailable();
    exact(now.intent, original.intent);
    return delivery;
  }
  function acknowledgement(
    out: LocalNetworkOutbox,
    response: DeviceAdmissionPeerResponse,
  ): LocalNetworkAcknowledgement | null {
    const intent = out.intent;
    if (response.outcome === 'ACK') {
      let r = response.receipt;
      if (intent.operation === 'CANCEL' && response.operation === 'DEVICE_REQUEST_RECOVER') {
        const now =
          response.current.kind === 'REQUEST'
            ? response.current.request
            : response.current.kind === 'REQUEST_REVIEW'
              ? (response.current.proof.cancelledReceiptOrNull?.request ?? null)
              : null;
        if (
          now?.closureOrNull?.commandId === intent.commandId &&
          now.closureOrNull.reason === intent.reason &&
          now.requestRevision === intent.requestRevision + 1
        )
          r = {
            operation: 'CANCEL',
            commandId: intent.commandId,
            receiptId: now.closureOrNull.receiptId,
            semanticBodySha256: out.semanticBodySha256,
            request: now,
          };
        else return null;
      }
      if (
        r.operation !== intent.operation ||
        r.commandId !== intent.commandId ||
        r.semanticBodySha256 !== out.semanticBodySha256
      )
        unavailable();
      if (r.operation === 'OPEN' && intent.operation === 'OPEN') {
        if (
          r.session.attemptId !== intent.attemptId ||
          r.session.campaignProof.campaignId !== intent.campaignId ||
          r.receiptId !== r.session.receiptId
        )
          unavailable();
        const sent = JSON.parse(intent.semanticBodyJson) as Record<string, unknown>;
        if (r.session.campaignProof.checkpointSha256 !== sent['campaignCheckpointSha256'])
          unavailable();
        return {
          operation: 'OPEN',
          commandId: intent.commandId,
          semanticBodySha256: out.semanticBodySha256,
          session: r.session,
          verifiedReceipt: response as unknown as JsonObject,
        };
      }
      if ((r.operation === 'SUBMIT' || r.operation === 'CANCEL') && intent.operation !== 'OPEN') {
        const sessionId =
          intent.operation === 'SUBMIT'
            ? intent.batch.technicalSessionId
            : intent.technicalSessionId;
        if (
          r.request.requestId !== intent.requestId ||
          r.request.technicalSessionId !== sessionId ||
          (intent.operation === 'SUBMIT' &&
            (r.request.batchSha256 !== intent.batch.batchSha256 ||
              r.receiptId !== r.request.submitReceiptId)) ||
          (intent.operation === 'CANCEL' &&
            (r.request.closureOrNull?.commandId !== intent.commandId ||
              r.receiptId !== r.request.closureOrNull.receiptId))
        )
          unavailable();
        return {
          operation: r.operation,
          commandId: intent.commandId,
          semanticBodySha256: out.semanticBodySha256,
          request: r.request,
          verifiedReceipt: response as unknown as JsonObject,
        };
      }
    }
    if (
      response.outcome === 'NOT_FOUND' &&
      response.operation === 'CONNECTION_RECOVER' &&
      intent.operation === 'OPEN'
    ) {
      if (
        response.commandId !== intent.commandId ||
        response.attemptId !== intent.attemptId ||
        response.semanticBodySha256 !== out.semanticBodySha256 ||
        !response.fenced ||
        response.generation < 1
      )
        unavailable();
      return {
        operation: 'OPEN_FAILURE',
        commandId: intent.commandId,
        semanticBodySha256: out.semanticBodySha256,
        attemptId: intent.attemptId,
        code: 'PEER_UNAVAILABLE',
        proofKind: 'FENCED_ABSENT',
        verifiedReceipt: response as unknown as JsonObject,
      };
    }
    return null;
  }
  async function deliver(
    c: LocalNetworkConnection,
    out: LocalNetworkOutbox,
    recovery: boolean,
    publish?: (delivery: LocalNetworkDeliverySnapshot) => void,
    verifiedInitial?: LocalNetworkDeliverySnapshot,
  ): Promise<boolean> {
    const bound = scope(c),
      contextId = c.contextId;
    const check = (verifiedDelivery?: LocalNetworkDeliverySnapshot) => {
      trust(c);
      exact(scope(c), bound);
      if (c.contextId !== contextId) unavailable();
      return unresolved(c, out, verifiedDelivery);
    };
    const beforeReconnect = check(verifiedInitial);
    if (d.peer.current(bound.networkScopeId) === null) {
      await reconnect(c, false, beforeReconnect);
      const afterReconnect = readLocalNetworkDeliverySnapshot(db, bound, out.intent.commandId);
      if (
        afterReconnect.cancelSettlementOrNull !== null ||
        afterReconnect.outbox?.acknowledgementOrNull != null
      )
        return false;
      check(afterReconnect);
    }
    let response = recovery ? await d.peer.recover(bound, out) : await d.peer.deliver(bound, out);
    let verified = check();
    if (response.outcome === 'ACK' && response.current.kind === 'REQUEST_REVIEW')
      requestProof(c, response, out.intent.operation === 'SUBMIT' ? verified : undefined);
    let ack = acknowledgement(out, response);
    if (ack === null && out.intent.operation === 'CANCEL') {
      if (!(response.outcome === 'ACK' && response.operation === 'DEVICE_REQUEST_RECOVER')) {
        response = await d.peer.recover(bound, out);
        verified = check();
      }
      if (response.outcome === 'ACK' && response.current.kind === 'REQUEST_REVIEW') {
        await applyRequestCurrent(c, response);
        const settled = readLocalNetworkDeliverySnapshot(db, bound, out.intent.commandId);
        if (settled.cancelSettlementOrNull !== null) return false;
        verified = check();
      }
      ack = acknowledgement(out, response);
    }
    if (ack === null && recovery && out.intent.operation !== 'OPEN') {
      const i = out.intent;
      const absence =
        response.outcome === 'NOT_FOUND' &&
        response.operation === 'DEVICE_REQUEST_RECOVER' &&
        response.fenced &&
        response.generation > 0 &&
        response.requestId === i.requestId &&
        response.technicalSessionId ===
          (i.operation === 'SUBMIT' ? i.batch.technicalSessionId : i.technicalSessionId) &&
        response.submitCommandId ===
          (i.operation === 'SUBMIT'
            ? i.commandId
            : verified.current.requestOrNull?.submitCommandId);
      const cancelKnown =
        i.operation === 'CANCEL' &&
        response.outcome === 'ACK' &&
        response.operation === 'DEVICE_REQUEST_RECOVER' &&
        (response.current.kind === 'REQUEST' || response.current.kind === 'REQUEST_REVIEW') &&
        response.current.request.status === 'PENDING' &&
        response.current.request.requestId === i.requestId &&
        response.current.request.technicalSessionId === i.technicalSessionId &&
        response.current.request.closureOrNull === null &&
        response.current.request.requestRevision === i.requestRevision;
      if ((absence && i.operation === 'SUBMIT') || cancelKnown) {
        check();
        response = await d.peer.deliver(bound, out);
        verified = check();
        ack = acknowledgement(out, response);
      }
    }
    if (ack === null && out.intent.operation === 'CANCEL' && response.outcome === 'REFUSED') {
      // A decision may win after the preceding recovery but before the same CANCEL redelivery.
      response = await d.peer.recover(bound, out);
      verified = check();
      if (response.outcome === 'ACK' && response.current.kind === 'REQUEST_REVIEW') {
        await applyRequestCurrent(c, response);
        if (
          readLocalNetworkDeliverySnapshot(db, bound, out.intent.commandId)
            .cancelSettlementOrNull !== null
        )
          return false;
        verified = check();
      }
      ack = acknowledgement(out, response);
    }
    if (ack === null) {
      diagnostic(c, 'UNCONFIRMED_OUTCOME');
      return false;
    }
    const saved = mutate(
      c,
      { kind: 'ACKNOWLEDGE', acknowledgement: ack },
      undefined,
      null,
      verified.current,
    );
    planRetry(c, saved.current);
    if (
      !recovery &&
      publish !== undefined &&
      out.intent.operation === 'SUBMIT' &&
      out.intent.batch.schemaVersion === 2 &&
      response.outcome === 'ACK' &&
      response.current.kind === 'REQUEST_REVIEW'
    ) {
      const delivery = readLocalNetworkDeliverySnapshot(db, bound, out.intent.commandId);
      const parsed = requestProof(c, response, delivery) ?? unavailable();
      if (
        delivery.current.pendingCommandIdOrNull === null &&
        delivery.current.requestOrNull?.submitCommandId === out.intent.commandId &&
        delivery.current.requestOrNull.requestId === out.intent.requestId &&
        delivery.outbox?.acknowledgementOrNull?.operation === 'SUBMIT' &&
        isDeepStrictEqual(delivery.requestCurrentOrNull?.proof, parsed.proof)
      ) {
        // ACK already sealed the inline lane and current proof. Publish this fresh,
        // unchanged proof synchronously; never return it as authority across await.
        publish(delivery);
        return true;
      }
    }
    if (response.outcome === 'ACK' && response.current.kind === 'REQUEST_REVIEW')
      await applyRequestCurrent(c, response);
    return false;
  }
  async function command(
    m: NetworkWorkflowRequest,
    c: LocalNetworkConnection,
    send: (m: LocalNetworkHostMessage) => void,
  ) {
    const wire = canonicalPostSaveJson(m),
      p = networkWorkflowPayloadValue(m.workflowCommandId, m.payload);
    if (m.role !== 'player' || p.networkScopeId !== scope(c).networkScopeId) unavailable();
    const known = readLocalNetworkOutbox(db, scope(c), m.commandId);
    if (known !== null) {
      exact(known.intent.clientRequestJson, wire);
      if (
        known.acknowledgementOrNull === null &&
        readLocalNetworkCancelSettlementEvent(db, scope(c), m.commandId) === null
      )
        try {
          await deliver(c, known, true);
        } catch {
          const latest = readLocalNetworkDeliverySnapshot(db, scope(c), m.commandId);
          if (
            latest.outbox?.acknowledgementOrNull === null &&
            latest.cancelSettlementOrNull === null
          )
            diagnostic(c, 'UNCONFIRMED_OUTCOME');
        }
      const delivery = readLocalNetworkDeliverySnapshot(db, scope(c), m.commandId);
      terminal(c, delivery.outbox!, true, send, delivery);
      send(snapshot(c, m.commandId, 'COMMAND_DESTINATION', delivery.current));
      return;
    }
    const failed = readLocalNetworkApplicationEvent(db, scope(c), m.commandId);
    if (failed !== null) {
      if (
        failed.input.mutation.kind !== 'DIAGNOSTIC' ||
        failed.input.mutation.attemptIdOrNull == null
      )
        unavailable();
      exact(failed.input.clientRequestJsonOrNull, wire);
      commitLocalNetworkMutation(db, failed.input, guard(c));
      send({
        messageType: 'command.refusal',
        protocolVersion: 1,
        commandId: m.commandId,
        lastLifecycleState: null,
        revisions: currentVector(c),
        refusal: { code: 'GUARD_REJECTED' },
      });
      send(snapshot(c, m.commandId, 'COMMAND_DESTINATION'));
      return;
    }
    const s = fresh(c, p.contextId, m.expectedRevisions, p.expectedDraftRevision);
    if (
      m.workflowCommandId !== 'UI-CMD-CONNECTION-OPEN' &&
      d.peer.current(s.networkScopeId) === null
    ) {
      await reconnect(c);
      fresh(c, p.contextId, m.expectedRevisions, p.expectedDraftRevision);
    }
    const base = project(c, s);
    const action =
      m.workflowCommandId === 'UI-CMD-CONNECTION-OPEN' && s.formId === 'NET-011'
        ? 'NET-011::CTA::003'
        : actionFor[m.workflowCommandId];
    if (
      action === undefined ||
      !base.availableActionKeys.some((k) => k === action) ||
      !c.executableWorkflowCommandIds.includes(m.workflowCommandId)
    )
      unavailable();
    if (m.workflowCommandId === 'UI-CMD-CONNECTION-OPEN') {
      const p = m.payload;
      if (p.attemptId !== s.plannedAttemptIdOrNull || p.addressOrQrPayload !== s.addressOrQrPayload)
        unavailable();
      const verify = guard(c, s);
      let channel: Awaited<ReturnType<typeof d.peer.open>>;
      try {
        channel = await d.peer.open(
          scope(c),
          p.addressOrQrPayload,
          p.selectedCampaignIdOrNull,
          verify,
        );
        verify();
      } catch (error) {
        verify();
        mutate(
          c,
          {
            kind: 'DIAGNOSTIC',
            code: error instanceof LocalNetworkPeerError ? error.code : 'PEER_UNAVAILABLE',
            attemptIdOrNull: p.attemptId,
          },
          m.commandId,
          wire,
        );
        planRetry(c);
        send({
          messageType: 'command.refusal',
          protocolVersion: 1,
          commandId: m.commandId,
          lastLifecycleState: null,
          revisions: currentVector(c),
          refusal: { code: 'GUARD_REJECTED' },
        });
        send(snapshot(c, m.commandId, 'COMMAND_DESTINATION'));
        return;
      }
      const body = encodeDeviceAdmissionPeerCommand(
        {
          schemaVersion: 1,
          operation: 'CONNECTION_OPEN',
          commandId: m.commandId,
          attemptId: p.attemptId,
          campaignCheckpointSha256: channel.campaign.checkpointSha256,
        },
        commandLimits,
      );
      verify();
      mutate(
        c,
        {
          kind: 'INTENT',
          intent: {
            operation: 'OPEN',
            commandId: m.commandId,
            clientRequestJson: wire,
            attemptId: p.attemptId,
            canonicalOrigin: parseCampaignLanAddress(p.addressOrQrPayload).canonicalOrigin,
            campaignId: channel.campaign.campaignId,
            semanticBodyJson: body,
          },
        },
        m.commandId,
        wire,
      );
    } else if (m.workflowCommandId === 'UI-CMD-DEVICE-REQUEST-SUBMIT') {
      const p = m.payload;
      const b = s.preparedBatchOrNull;
      if (
        b === null ||
        p.requestId !== b.requestId ||
        p.technicalSessionId !== b.technicalSessionId ||
        p.connectionRevision !== b.connectionRevision
      )
        unavailable();
      exact(p.selectedCandidates, s.selectedCandidates);
      const channel = d.peer.current(s.networkScopeId);
      if (
        channel === null ||
        !networkCapacity(channel.campaign, b.candidates.length).fitsCurrentCapacity
      )
        unavailable();
      exact(channel.campaign.revisions, b.campaignProof.revisions);
      if (channel.campaign.checkpointSha256 !== b.campaignProof.checkpointSha256) unavailable();
      mutate(
        c,
        {
          kind: 'INTENT',
          intent: {
            operation: 'SUBMIT',
            commandId: m.commandId,
            clientRequestJson: wire,
            requestId: b.requestId,
            batch: b,
            semanticBodyJson: deviceAdmissionSubmitSemanticBody(m.commandId, b.batchSha256),
          },
        },
        m.commandId,
        wire,
        s,
      );
    } else if (m.workflowCommandId === 'UI-CMD-DEVICE-REQUEST-CANCEL') {
      const p = m.payload;
      const r = s.requestOrNull;
      if (
        r === null ||
        p.requestId !== r.requestId ||
        p.technicalSessionId !== r.technicalSessionId ||
        p.requestRevision !== r.requestRevision ||
        p.reason !== s.cancelReason
      )
        unavailable();
      const body = encodeDeviceAdmissionPeerCommand(
        {
          schemaVersion: 1,
          operation: 'DEVICE_REQUEST_CANCEL',
          commandId: m.commandId,
          requestId: p.requestId,
          technicalSessionId: p.technicalSessionId,
          requestRevision: p.requestRevision,
          reason: p.reason,
        },
        commandLimits,
      );
      // The bounded ACK repeats the closure in receipt and current. Validate those
      // exact bytes before pinning an intent that the peer could never acknowledge.
      // This placeholder has the actual allocator's UUID length and is never persisted.
      const budgetReceiptId = '00000000-0000-4000-8000-000000000001';
      const closedRequest = {
        ...r,
        requestRevision: r.requestRevision + 1,
        closureOrNull: { commandId: m.commandId, receiptId: budgetReceiptId, reason: p.reason },
      };
      encodeDeviceAdmissionPeerResponse({
        schemaVersion: 1,
        operation: 'DEVICE_REQUEST_CANCEL',
        outcome: 'ACK',
        delivery: 'COMMITTED',
        receipt: {
          operation: 'CANCEL',
          commandId: m.commandId,
          receiptId: budgetReceiptId,
          semanticBodySha256: postSaveSha256(body),
          request: closedRequest,
        },
        current: { kind: 'REQUEST', request: closedRequest },
      });
      mutate(
        c,
        {
          kind: 'INTENT',
          intent: {
            operation: 'CANCEL',
            commandId: m.commandId,
            clientRequestJson: wire,
            requestId: p.requestId,
            technicalSessionId: p.technicalSessionId,
            requestRevision: p.requestRevision,
            reason: p.reason,
            semanticBodyJson: body,
          },
        },
        m.commandId,
        wire,
      );
    } else unavailable();
    const initial = readLocalNetworkDeliverySnapshot(db, scope(c), m.commandId);
    const out = initial.outbox ?? unavailable();
    let publicationAttempted = false;
    try {
      const published = await deliver(
        c,
        out,
        false,
        (delivery) => {
          publicationAttempted = true;
          const messages: LocalNetworkHostMessage[] = [];
          terminal(c, delivery.outbox!, false, (message) => messages.push(message), delivery);
          const destination = snapshot(c, m.commandId, 'COMMAND_DESTINATION', delivery.current);
          if (messages.length !== 1 || messages[0]?.messageType !== 'command.result') unavailable();
          send(messages[0]);
          send(destination);
        },
        initial,
      );
      if (published === true) return;
    } catch {
      // Once publication is attempted, a construction/transport failure must close the connection.
      // The next connection recovers the ACK; neither fallback nor refusal may contradict it.
      if (publicationAttempted) throw new LocalNetworkPublicationError();
      const latest = readLocalNetworkDeliverySnapshot(db, scope(c), m.commandId);
      if (latest.outbox?.acknowledgementOrNull === null && latest.cancelSettlementOrNull === null)
        diagnostic(c, 'UNCONFIRMED_OUTCOME');
    }
    const delivery = readLocalNetworkDeliverySnapshot(db, scope(c), m.commandId);
    terminal(c, delivery.outbox!, false, send, delivery);
    send(snapshot(c, m.commandId, 'COMMAND_DESTINATION', delivery.current));
  }
  function replace(
    m: NetworkDraftReplaceV3Message,
    c: LocalNetworkConnection,
    send: (m: LocalNetworkHostMessage) => void,
  ) {
    const wire = canonicalPostSaveJson(m),
      known = readLocalNetworkApplicationEvent(db, scope(c), m.draftUpdateId);
    let result: StoredLocalNetworkEvent;
    if (known !== null) {
      exact(known.input.clientRequestJsonOrNull, wire);
      result = commitLocalNetworkMutation(db, known.input, guard(c));
    } else {
      const s = fresh(c, m.scope.contextId, m.expectedRevisions, m.expectedDraftRevision);
      if (m.scope.networkScopeId !== s.networkScopeId || m.scope.sourceFormId !== s.formId)
        unavailable();
      let mutation: LocalNetworkMutation;
      switch (m.variant) {
        case 'ADDRESS':
          mutation = { kind: 'ADDRESS', addressOrQrPayload: m.values.addressOrQrPayload };
          break;
        case 'CANCEL_REASON':
          mutation = { kind: 'CANCEL_REASON', cancelReason: m.values.cancelReason };
          break;
        case 'SELECTION':
          selected(c, m.values.selectedCandidates);
          mutation = { kind: 'SELECTION', selectedCandidates: m.values.selectedCandidates };
          break;
        case 'SINGLE_CANDIDATE':
          if (
            m.values.selectedCampaignId !== null &&
            m.values.selectedCampaignId !== s.sessionOrNull?.campaignProof.campaignId
          )
            unavailable();
          if (
            m.values.requestedControllerSeat !== null &&
            m.values.requestedControllerSeat !== s.tabId
          )
            unavailable();
          mutation = {
            kind: 'SINGLE_CANDIDATE',
            selectedCampaignId: m.values.selectedCampaignId,
            requestedControllerSeat: m.values.requestedControllerSeat,
          };
          break;
      }
      result = mutate(c, mutation, m.draftUpdateId, wire);
    }
    send({
      messageType: 'network.draft.result',
      protocolVersion: 3,
      draftUpdateId: m.draftUpdateId,
      scope: m.scope,
      changed: result.receipt.changed,
      appliedDraftRevision: result.receipt.draftRevision,
      appliedRevisions: result.receipt.revisions,
      draftRevision: result.current.draftRevision,
      revisions: vector(result.current),
      projectionRole: 'player',
      presentation: { base: project(c, result.current), layers: [] },
    });
  }
  async function enter(
    m: FormActionIntentV2Message,
    c: LocalNetworkConnection,
    shell: LocalNetworkShell,
    send: (m: LocalNetworkHostMessage) => void,
  ) {
    const ownerDeviceId = owner(c),
      fromFinal = m.sourceFormId === 'CHR-040';
    const known = readLocalNetworkTabEntryByCommandId(db, ownerDeviceId, m.navigationRequestId);
    let tab = known?.currentTab ?? null;
    let sourceId: string | null = null;
    if (known !== null) {
      const entry = known.request.applicationEntry;
      if (tab === null || entry === undefined) unavailable();
      exact(entry.clientRequestJson, canonicalPostSaveJson(m));
      if (m.expectedProjectionRevision !== known.receipt.sourceRevisions.projectionRevision)
        unavailable();
      sourceId = entry.sourceFinalUuidOrNull;
      if (sourceId !== null) prepared(c, sourceId);
    } else {
      const entryCapabilities = fromFinal
        ? ['UI-CMD-CONNECTION-OPEN']
        : NETWORK_WORKFLOW_COMMAND_IDS;
      if (
        !entryCapabilities.every((id) =>
          c.executableWorkflowCommandIds.some((supported) => supported === id),
        )
      )
        unavailable();
      if (
        shell.formId !== m.sourceFormId ||
        shell.deviceId !== ownerDeviceId ||
        shell.contextId === null ||
        shell.revisions.projectionRevision !== m.expectedProjectionRevision
      )
        unavailable();
      if (fromFinal) {
        if (shell.sourceFinalIdOrNull === null) unavailable();
        sourceId = shell.sourceFinalIdOrNull;
        prepared(c, sourceId);
        const active = readActiveLocalNetworkTab(db, ownerDeviceId);
        if (active !== null && active.lifecycleState === 'UNBOUND') {
          const a = readLocalNetworkApplication(db, {
            ownerDeviceId,
            networkScopeId: active.networkScopeId,
          });
          if (a.pendingCommandIdOrNull === null && a.sessionOrNull !== null) tab = active;
        }
      }
      if (tab === null) {
        const sourceContextId = shell.contextId,
          sourceRevisions = vector(shell.revisions);
        const entry = commitLocalNetworkTabEntry(
          db,
          {
            ownerDeviceId,
            sourceContextId,
            sourceRevisions,
            entryCommandId: m.navigationRequestId,
            entryReceiptId: randomUUID(),
            tabId: randomUUID(),
            networkScopeId: randomUUID(),
            applicationEntry: {
              schemaVersion: 1,
              clientRequestJson: canonicalPostSaveJson(m),
              sourceFinalUuidOrNull: sourceId,
            },
          },
          () => {
            trust(c);
            if (
              loadDeviceId(db) !== ownerDeviceId ||
              shell.formId !== m.sourceFormId ||
              shell.contextId !== sourceContextId ||
              shell.sourceFinalIdOrNull !== sourceId ||
              !isDeepStrictEqual(shell.revisions, sourceRevisions)
            )
              unavailable();
          },
        );
        tab = entry.currentTab;
        if (tab === null) unavailable();
      }
    }
    c.networkScopeId = tab.networkScopeId;
    c.contextId = randomUUID();
    const saved = readLocalNetworkApplicationEvent(db, scope(c), eventId(m.navigationRequestId));
    if (saved !== null) {
      exact(saved.input.clientRequestJsonOrNull, canonicalPostSaveJson(m));
      commitLocalNetworkMutation(db, saved.input, guard(c));
    } else {
      if (fromFinal && sourceId === null) unavailable();
      const single = sourceId === null ? null : candidateSummary(prepared(c, sourceId), tab.tabId);
      const ref =
        single === null
          ? null
          : {
              sourceUuid: single.sourceUuid,
              finalSnapshotVersion: single.finalSnapshotVersion,
              metadataRevision: single.metadataRevision,
              candidateSnapshotChecksum: single.candidateSnapshotChecksum,
              requestedControllerSeat: single.requestedControllerSeat,
            };
      mutate(
        c,
        {
          kind: 'NAVIGATE',
          targetFormId: fromFinal ? 'CHR-027' : 'NET-001',
          plannedAttemptIdOrNull: null,
          singleCandidateOrNull: ref,
        },
        eventId(m.navigationRequestId),
        canonicalPostSaveJson(m),
      );
    }
    const entered = current(c);
    if (entered.shellExitOrNull !== null)
      return retainedExit(c, shell, send, entered, m.navigationRequestId, 'FORM_ACTION');
    shell.enterNetwork();
    if (!fromFinal) {
      const verify = guard(c);
      try {
        const found = await d.discover();
        verify();
        discovery.set(tab.networkScopeId, found);
      } catch {
        verify();
        discoveryFailures.add(tab.networkScopeId);
      }
    } else if (current(c).sessionOrNull !== null)
      try {
        await reconnect(c);
      } catch {
        /* A disconnected campaign is not advertised as eligible. */
      }
    trust(c);
    send(snapshot(c, m.navigationRequestId, 'FORM_ACTION'));
  }
  async function navigate(
    m: FormActionIntentV2Message,
    c: LocalNetworkConnection,
    shell: LocalNetworkShell,
    send: (m: LocalNetworkHostMessage) => void,
  ) {
    if (
      (m.sourceFormId === 'APP-002' && m.actionKey === 'APP-002::CTA::003') ||
      (m.sourceFormId === 'CHR-040' && m.actionKey === 'CHR-040::CTA::002')
    )
      return enter(m, c, shell, send);
    const closed = readLocalNetworkTabCloseByCommandId(db, owner(c), m.navigationRequestId);
    if (closed !== null) {
      const exit = closed.request.applicationExit;
      if (exit === undefined) unavailable();
      exact(exit.clientRequestJson, canonicalPostSaveJson(m));
      if (c.networkScopeId !== null && c.networkScopeId !== closed.request.networkScopeId)
        unavailable();
      if (
        c.networkScopeId === null &&
        shell.formId !== null &&
        shell.lastNetworkExitNavigationIdOrNull !== m.navigationRequestId
      )
        unavailable();
      return finishExit(c, shell, send, closed.request.networkScopeId, exit, m.navigationRequestId);
    }
    if (c.networkScopeId === null) {
      const retained = readLocalNetworkShellExitByNavigationId(db, owner(c), m.navigationRequestId);
      if (
        retained === null ||
        retained.current.shellExitOrNull?.navigationRequestId !== m.navigationRequestId
      )
        unavailable();
      exact(retained.input.clientRequestJsonOrNull, canonicalPostSaveJson(m));
      if (
        shell.formId !== null &&
        shell.lastNetworkExitNavigationIdOrNull !== m.navigationRequestId
      )
        unavailable();
      return retainedExit(c, shell, send, retained.current, m.navigationRequestId, 'FORM_ACTION');
    }
    const known = readLocalNetworkApplicationEvent(db, scope(c), eventId(m.navigationRequestId));
    if (known !== null) {
      exact(known.input.clientRequestJsonOrNull, canonicalPostSaveJson(m));
      commitLocalNetworkMutation(db, known.input, guard(c));
      if (
        known.input.mutation.kind === 'SHELL_EXIT' &&
        known.current.shellExitOrNull?.navigationRequestId === m.navigationRequestId
      )
        return retainedExit(c, shell, send, known.current, m.navigationRequestId, 'FORM_ACTION');
      send(snapshot(c, m.navigationRequestId, 'FORM_ACTION'));
      return;
    }
    const s = current(c),
      view = project(c);
    if (
      s.formId !== m.sourceFormId ||
      s.projectionRevision !== m.expectedProjectionRevision ||
      !view.availableActionKeys.includes(m.actionKey)
    )
      unavailable();
    if (['NET-001::CTA::003', 'NET-002::CTA::004', 'NET-011::CTA::005'].includes(m.actionKey)) {
      const binding = scope(c);
      commitLocalNetworkTabClose(
        db,
        {
          ...binding,
          closeCommandId: m.navigationRequestId,
          closeReceiptId: randomUUID(),
          expectedRevisions: vector(s),
          applicationExit: {
            schemaVersion: 1,
            clientRequestJson: canonicalPostSaveJson(m),
            target: { kind: 'PLAYER_MENU' },
          },
        },
        () => {
          trust(c);
          exact(scope(c), binding);
        },
      );
      d.peer.closeScope(binding.networkScopeId);
      c.networkScopeId = null;
      c.contextId = null;
      const target = await shell.exitToPlayer(m.navigationRequestId);
      trust(c);
      send(target);
      return;
    }
    if (m.actionKey === 'CHR-027::CTA::002') {
      const sourceId = s.selectedCandidates[0]?.sourceUuid;
      if (sourceId === undefined) unavailable();
      prepared(c, sourceId);
      if (s.sessionOrNull === null) {
        commitLocalNetworkTabClose(
          db,
          {
            ...scope(c),
            closeCommandId: m.navigationRequestId,
            closeReceiptId: randomUUID(),
            expectedRevisions: vector(s),
            applicationExit: {
              schemaVersion: 1,
              clientRequestJson: canonicalPostSaveJson(m),
              target: { kind: 'LOCAL_FINAL', sourceUuid: sourceId },
            },
          },
          guard(c),
        );
        d.peer.closeScope(s.networkScopeId);
      } else {
        const saved = mutate(
          c,
          { kind: 'SHELL_EXIT', navigationRequestId: m.navigationRequestId, sourceUuid: sourceId },
          eventId(m.navigationRequestId),
          canonicalPostSaveJson(m),
        );
        return retainedExit(c, shell, send, saved.current, m.navigationRequestId, 'FORM_ACTION');
      }
      c.networkScopeId = null;
      c.contextId = null;
      const target = await shell.returnToFinal(sourceId, m.navigationRequestId);
      trust(c);
      send(target);
      return;
    }
    if (m.actionKey === 'NET-003::CTA::001' || m.actionKey === 'CHR-027::CTA::001') {
      const list = selected(c, s.selectedCandidates),
        channel = d.peer.current(s.networkScopeId),
        session = s.sessionOrNull;
      if (
        list.length < 1 ||
        channel === null ||
        session === null ||
        !networkCapacity(channel.campaign, list.length).fitsCurrentCapacity
      )
        unavailable();
      const body = {
        schemaVersion: 2 as const,
        localControllerSeatId: s.tabId,
        requestId: randomUUID(),
        technicalSessionId: session.technicalSessionId,
        connectionRevision: session.connectionRevision,
        campaignProof: {
          campaignId: channel.campaign.campaignId,
          revisions: vector(channel.campaign.revisions),
          checkpointSha256: channel.campaign.checkpointSha256,
        },
        candidates: list,
      };
      const batch: NetworkPreparedBatch = {
        ...body,
        batchSha256: postSaveSha256(canonicalPostSaveJson(body)),
      };
      mutate(
        c,
        { kind: 'PREPARE_BATCH', batch },
        eventId(m.navigationRequestId),
        canonicalPostSaveJson(m),
      );
    } else {
      const hops: Readonly<Record<string, LocalNetworkApplication['formId']>> = {
        'NET-001::CTA::001': 'NET-002',
        'NET-001::CTA::002': 'NET-003',
        'NET-002::CTA::001': 'NET-001',
        'NET-002::CTA::002': 'NET-003',
        'NET-003::CTA::002': 'CHR-027',
        'NET-003::CTA::003': 'NET-005',
        'NET-004::CTA::001': 'NET-003',
        'NET-004::CTA::003': 'NET-003',
        'NET-005::CTA::003': 'NET-003',
        'NET-011::CTA::004': 'NET-002',
      };
      const target = hops[m.actionKey];
      if (target === undefined) unavailable();
      mutate(
        c,
        {
          kind: 'NAVIGATE',
          targetFormId: target,
          plannedAttemptIdOrNull:
            target === 'NET-002' && s.sessionOrNull === null ? randomUUID() : null,
          singleCandidateOrNull: null,
        },
        eventId(m.navigationRequestId),
        canonicalPostSaveJson(m),
      );
    }
    send(snapshot(c, m.navigationRequestId, 'FORM_ACTION'));
  }
  async function finishExit(
    c: LocalNetworkConnection,
    shell: LocalNetworkShell,
    send: (m: LocalNetworkHostMessage) => void,
    networkScopeId: string,
    exit: NonNullable<LocalNetworkTabCloseInput['applicationExit']>,
    correlationId: string,
    reason: 'FORM_ACTION' | 'RECONNECT' = 'FORM_ACTION',
    originalNavigationId = correlationId,
    keepPeer = false,
  ) {
    trust(c);
    const original = JSON.parse(exit.clientRequestJson) as Record<string, unknown>;
    if (
      original['messageType'] !== 'navigation.form-action' ||
      original['protocolVersion'] !== 2 ||
      original['navigationRequestId'] !== originalNavigationId
    )
      unavailable();
    if (exit.target.kind === 'LOCAL_FINAL')
      prepareOwnedFinalAdmissionCandidate(d.postSave, owner(c), exit.target.sourceUuid, {
        maxWitnessBytes: d.config.transfer.maxWitnessBytes,
      });
    if (!keepPeer) d.peer.closeScope(networkScopeId);
    c.networkScopeId = null;
    c.contextId = null;
    const target =
      exit.target.kind === 'PLAYER_MENU'
        ? await shell.exitToPlayer(originalNavigationId)
        : await shell.returnToFinal(exit.target.sourceUuid, originalNavigationId);
    trust(c);
    if (reason === 'RECONNECT')
      send({
        messageType: 'session.reconnect.capabilities',
        protocolVersion: 2,
        reconnectRequestId: correlationId,
        revisions: target.revisions,
        executableWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS.filter((id) =>
          c.executableWorkflowCommandIds.includes(id),
        ),
      });
    send({
      ...target,
      presentation: { ...target.presentation, assignment: { correlationId, reason } },
    });
  }
  async function retainedExit(
    c: LocalNetworkConnection,
    shell: LocalNetworkShell,
    send: (m: LocalNetworkHostMessage) => void,
    s: LocalNetworkApplication,
    correlationId: string,
    reason: 'FORM_ACTION' | 'RECONNECT',
  ) {
    const marker = s.shellExitOrNull;
    if (marker === null) unavailable();
    const e = readLocalNetworkApplicationEvent(
      db,
      { ownerDeviceId: owner(c), networkScopeId: s.networkScopeId },
      eventId(marker.navigationRequestId),
    );
    if (
      e?.input.mutation.kind !== 'SHELL_EXIT' ||
      e.input.clientRequestJsonOrNull === null ||
      e.input.mutation.sourceUuid !== marker.sourceUuid
    )
      unavailable();
    return finishExit(
      c,
      shell,
      send,
      s.networkScopeId,
      {
        schemaVersion: 1,
        clientRequestJson: e.input.clientRequestJsonOrNull,
        target: { kind: 'LOCAL_FINAL', sourceUuid: marker.sourceUuid },
      },
      correlationId,
      reason,
      marker.navigationRequestId,
      true,
    );
  }
  async function resume(
    m: Extract<LocalNetworkClientMessage, { messageType: 'network.local-context.resume' }>,
    c: LocalNetworkConnection,
    shell: LocalNetworkShell,
    send: (m: LocalNetworkHostMessage) => void,
  ) {
    if (c.networkScopeId === null && shell.formId !== null) unavailable();
    if (c.networkScopeId !== null && c.networkScopeId !== m.networkScopeId) unavailable();
    const own = { ownerDeviceId: owner(c), networkScopeId: m.networkScopeId };
    c.executableWorkflowCommandIds = m.supportedWorkflowCommandIds;
    const closed = readLocalNetworkTabClosure(db, own.ownerDeviceId, own.networkScopeId);
    if (closed !== null) {
      if (closed.request.applicationExit === undefined) unavailable();
      return finishExit(
        c,
        shell,
        send,
        own.networkScopeId,
        closed.request.applicationExit,
        m.reconnectRequestId,
        'RECONNECT',
        closed.request.closeCommandId,
      );
    }
    const resumed = readLocalNetworkApplication(db, own);
    if (resumed.shellExitOrNull !== null)
      return retainedExit(c, shell, send, resumed, m.reconnectRequestId, 'RECONNECT');
    c.networkScopeId = m.networkScopeId;
    c.contextId = randomUUID();
    c.executableWorkflowCommandIds = m.supportedWorkflowCommandIds;
    shell.enterNetwork();
    let s = current(c);
    if (s.pendingCommandIdOrNull !== null) {
      const out = readLocalNetworkOutbox(db, scope(c), s.pendingCommandIdOrNull)!;
      try {
        await deliver(c, out, true);
      } catch {
        diagnostic(c, 'UNCONFIRMED_OUTCOME');
      }
    } else if (s.sessionOrNull !== null)
      try {
        await reconnect(c, true);
        // A recovered technical session keeps its original OPEN identity. Only
        // the confirmed presentation resumes; candidate bytes and requests stay pinned.
        const restored = current(c);
        if (restored.formId === 'NET-011')
          mutate(
            c,
            {
              kind: 'NAVIGATE',
              targetFormId:
                restored.preparedBatchOrNull !== null && restored.requestOrNull === null
                  ? 'NET-004'
                  : 'NET-003',
              plannedAttemptIdOrNull: null,
              singleCandidateOrNull: null,
            },
            `resume:${m.reconnectRequestId}`,
            canonicalPostSaveJson(m),
            restored,
          );
      } catch {
        if (s.formId !== 'CHR-027') diagnostic(c, 'PEER_UNAVAILABLE');
      }
    s = planRetry(c);
    for (const id of m.unacknowledgedCommandIds) {
      const delivery = readLocalNetworkDeliverySnapshot(db, scope(c), id);
      s = delivery.current;
      if (delivery.outbox !== null) terminal(c, delivery.outbox, true, send, delivery);
      else
        send({
          messageType: 'command.refusal',
          protocolVersion: 1,
          commandId: id,
          lastLifecycleState: null,
          revisions: vector(s),
          refusal: { code: 'GUARD_REJECTED' },
        });
    }
    send({
      messageType: 'session.reconnect.capabilities',
      protocolVersion: 2,
      reconnectRequestId: m.reconnectRequestId,
      revisions: vector(s),
      executableWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS.filter((id) =>
        c.executableWorkflowCommandIds.includes(id),
      ),
    });
    send(snapshot(c, m.reconnectRequestId, 'RECONNECT', s));
  }
  async function handle(
    m: LocalNetworkClientMessage,
    c: LocalNetworkConnection,
    shell: LocalNetworkShell,
    send: (m: LocalNetworkHostMessage) => void,
  ): Promise<boolean> {
    const entry =
      m.messageType === 'navigation.form-action' &&
      ((m.sourceFormId === 'APP-002' && m.actionKey === 'APP-002::CTA::003') ||
        (m.sourceFormId === 'CHR-040' && m.actionKey === 'CHR-040::CTA::002'));
    const workflow =
      m.messageType === 'command.request' &&
      m.commandKind === 'workflow-command' &&
      NETWORK_WORKFLOW_COMMAND_IDS.some((id) => id === m.workflowCommandId);
    const networkNavigation =
      m.messageType === 'navigation.form-action' &&
      (m.sourceFormId.startsWith('NET-') || m.sourceFormId === 'CHR-027');
    if (
      c.networkScopeId === null &&
      !entry &&
      !m.messageType.startsWith('network.') &&
      !workflow &&
      !networkNavigation
    )
      return false;
    try {
      trust(c);
      if (m.messageType === 'network.local-context.resume') await resume(m, c, shell, send);
      else if (m.messageType === 'network.draft.replace') replace(m, c, send);
      else if (m.messageType === 'navigation.form-action') await navigate(m, c, shell, send);
      else if (workflow) await command(m as NetworkWorkflowRequest, c, send);
      else if (m.messageType === 'session.reconnect') {
        if (m.deviceId !== owner(c) || c.networkScopeId === null) unavailable();
        await resume(
          {
            messageType: 'network.local-context.resume',
            protocolVersion: 3,
            networkScopeId: c.networkScopeId,
            reconnectRequestId: m.reconnectRequestId,
            knownRevisions: m.knownRevisions,
            supportedWorkflowCommandIds: m.supportedWorkflowCommandIds,
            unacknowledgedCommandIds: m.unacknowledgedCommandIds,
          },
          c,
          shell,
          send,
        );
      } else unavailable();
    } catch (error) {
      if (error instanceof LocalNetworkPublicationError) throw error;
      let revisions = shell.revisions;
      try {
        if (c.trusted() && c.networkScopeId !== null) revisions = currentVector(c);
      } catch {
        /* No foreign aggregate is disclosed in a refusal. */
      }
      const conflict =
        error instanceof NetworkApplicationStoreError && error.code === 'IDEMPOTENCY_CONFLICT';
      if (m.messageType === 'network.draft.replace')
        send({
          messageType: 'network.draft.refusal',
          protocolVersion: 3,
          draftUpdateId: m.draftUpdateId,
          scope: m.scope,
          revisions,
          presentationUnchanged: true,
          refusal: conflict ? { code: 'IDEMPOTENCY_CONFLICT' } : { code: 'DRAFT_UNAVAILABLE' },
        });
      else if (m.messageType === 'navigation.form-action')
        send({
          messageType: 'navigation.form-action.refusal',
          protocolVersion: 2,
          navigationRequestId: m.navigationRequestId,
          presentationUnchanged: true,
          revisions,
          refusal: conflict
            ? { code: 'IDEMPOTENCY_CONFLICT', detail: 'PAYLOAD_MISMATCH' }
            : { code: 'NAVIGATION_UNAVAILABLE' },
        });
      else if (workflow && m.messageType === 'command.request') {
        const out =
          c.trusted() && c.networkScopeId !== null
            ? readLocalNetworkOutbox(db, scope(c), m.commandId)
            : null;
        if (out === null || out.acknowledgementOrNull !== null || conflict)
          send({
            messageType: 'command.refusal',
            protocolVersion: 1,
            commandId: m.commandId,
            lastLifecycleState: null,
            revisions,
            refusal: conflict
              ? { code: 'IDEMPOTENCY_CONFLICT', commandId: m.commandId, detail: 'PAYLOAD_MISMATCH' }
              : { code: 'GUARD_REJECTED' },
          });
        if (c.trusted() && c.networkScopeId !== null)
          try {
            send(snapshot(c, m.commandId, 'COMMAND_DESTINATION'));
          } catch {
            /* A corrupt scope cannot supply a destination. */
          }
      } else
        send({
          messageType: 'protocol.refusal',
          protocolVersion: 1,
          relatedCommandId: null,
          refusal: { code: 'UNRECOGNIZED', path: '$.networkContext', value: null },
        });
    }
    return true;
  }
  const ownerViews = new Map<
    LocalNetworkConnection,
    { contextId: string; scopeId: string; send: (m: LocalNetworkHostMessage) => void }
  >();
  let polling = false;
  const ownerTimer = setInterval(() => {
    if (closed || polling || ownerViews.size === 0) return;
    polling = true;
    const tick = frames.then(async () => {
      for (const [c, binding] of ownerViews) {
        try {
          if (
            !c.trusted() ||
            c.contextId !== binding.contextId ||
            c.networkScopeId !== binding.scopeId
          ) {
            ownerViews.delete(c);
            continue;
          }
          const observed = readLocalNetworkRequestDeliverySnapshot(db, scope(c)),
            before = observed.current;
          if (
            before.formId !== 'NET-005' ||
            before.pendingCommandIdOrNull !== null ||
            before.requestOrNull === null
          )
            continue;
          if (d.peer.current(binding.scopeId) === null) await reconnect(c, true);
          else await refreshRequest(c, observed);
          trust(c);
          if (c.contextId !== binding.contextId || c.networkScopeId !== binding.scopeId) continue;
          const after = current(c);
          if (
            after.formId !== 'NET-005' ||
            after.pendingCommandIdOrNull !== null ||
            isDeepStrictEqual(vector(before), vector(after))
          )
            continue;
          const correlation =
            'network-owner-view:' +
            postSaveSha256(
              canonicalPostSaveJson({
                scope: scope(c),
                contextId: c.contextId,
                revisions: vector(after),
              }),
            );
          binding.send(snapshot(c, correlation, 'HOST_SYSTEM_EVENT', after));
        } catch {
          // A missing or unverifiable reply never replaces the last confirmed own view.
        }
      }
    });
    frames = tick.then(
      () => {
        polling = false;
      },
      () => {
        polling = false;
      },
    );
  }, 1000);
  ownerTimer.unref();
  return {
    currentVector,
    handle(
      m: LocalNetworkClientMessage,
      c: LocalNetworkConnection,
      shell: LocalNetworkShell,
      send: (m: LocalNetworkHostMessage) => void,
    ) {
      const next = frames.then(async () => {
        const previous = ownerViews.get(c);
        let watching =
          previous !== undefined &&
          previous.contextId === c.contextId &&
          previous.scopeId === c.networkScopeId;
        let watchedContextId = previous?.contextId ?? null;
        let watchedScopeId = previous?.scopeId ?? null;
        const handled = await handle(m, c, shell, (message) => {
          send(message);
          // Subscription follows our published form, never a browser's claim. The tick
          // still verifies the full owned current before any recovery or publication.
          if (message.messageType === 'projection.snapshot' && message.protocolVersion === 2)
            watching =
              message.projectionRole === 'player' && message.presentation.base.formId === 'NET-005';
          else if (message.messageType === 'network.draft.result')
            watching = message.presentation.base.formId === 'NET-005';
          else return;
          watchedContextId = watching ? c.contextId : null;
          watchedScopeId = watching ? c.networkScopeId : null;
        });
        if (
          handled &&
          watching &&
          watchedContextId === c.contextId &&
          watchedScopeId === c.networkScopeId &&
          !closed &&
          c.trusted() &&
          c.networkScopeId !== null &&
          c.contextId !== null
        )
          ownerViews.set(c, { contextId: c.contextId, scopeId: c.networkScopeId, send });
        else ownerViews.delete(c);
        return handled;
      });
      frames = next.then(
        () => {},
        () => {},
      );
      return next;
    },
    close() {
      closed = true;
      clearInterval(ownerTimer);
      ownerViews.clear();
      d.peer.close();
    },
  };
}
import type { CampaignConnection } from './campaign-creation.js';
import type { PresentedBaseForm, WireV2Vocabulary } from '../shared/wire-v2-protocol.js';
import type { ProtocolVocabulary } from '../shared/wire-protocol.js';
import type { createCampaignNetworkRuntime } from './campaign-network-runtime.js';
import {
  readCampaignCreationCursor,
  readLocalGmContext,
  type GmRequestReviewScope,
} from '../persistence/campaign-creation.js';
import {
  readGmRequestReviewSource,
  readGmDeviceRequestQueue,
  readGmDeviceRequestDecision,
  commitGmRequestReviewNavigation,
  commitGmRequestReviewDraft,
  commitGmDeviceRequestDecision,
  commitGmRequestReviewConnectionRefresh,
  type GmRequestReviewSource,
  type NetworkGmDecisionRequest,
} from '../persistence/network-device-request.js';
import { readHostedCurrentPausedCampaign } from '../persistence/current-paused-campaign.js';
import { validateMasterSecretVerifier } from './campaign-secret.js';
import {
  resolveStoredLocalCharacterExportBaseline,
  isStoredLocalCharacterExportBaselineCompatible,
} from './local-character-export.js';
import { NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS } from '../shared/device-admission.js';
import { projectGmRequestQueue } from './projections/net-application.js';
import { encodeHostMessage } from '../shared/wire-codec.js';
import { encodeHostMessageV2 } from '../shared/wire-v2-codec.js';
import type { NetworkGmRequestDraftRefusal } from '../shared/network-application.js';

/** Local GM authority and technical QUEUE heads remain separate from campaign birth/checkpoints. */
export function createGmNetworkRuntime(d: {
  readonly database: Database.Database;
  readonly schedule?: <T>(run: () => Promise<T>) => Promise<T>;
  readonly config: NetworkApplicationConfig;
  readonly baseline: LocalCharacterExportBaseline;
  readonly vocabulary: ProtocolVocabulary & WireV2Vocabulary;
  readonly campaignNetwork: Pick<
    ReturnType<typeof createCampaignNetworkRuntime>,
    'requestConnectionFacts'
  >;
  readonly campaignPresentation: (
    c: CampaignConnection,
  ) => Promise<{ base: PresentedBaseForm; revisions: RevisionVector }>;
}) {
  const db = d.database;
  let closed = false,
    frames = Promise.resolve();
  const schedule = <T>(run: () => Promise<T>): Promise<T> => {
    if (d.schedule !== undefined) return d.schedule(run);
    const next = frames.then(run);
    frames = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const validatedCandidates = new Set<string>();
  const watchers = new Map<
    CampaignConnection,
    { send: (m: LocalNetworkHostMessage) => void; lastHash: string }
  >();
  const validateOwner = (o: GmRequestReviewSource['privateOwner']): void => {
    validateMasterSecretVerifier(o.verifier);
  };
  const scope = (c: CampaignConnection): GmRequestReviewScope => {
    if (closed || !c.trusted() || c.gmLocalContextId === null) unavailable();
    const context = readLocalGmContext(db, c.gmLocalContextId),
      cursor = readCampaignCreationCursor(db, context.gmLocalContextId);
    if (
      context.ownerDeviceId !== loadDeviceId(db) ||
      (cursor.kind !== 'CAMPAIGN' && cursor.kind !== 'QUEUE')
    )
      unavailable();
    const current = readHostedCurrentPausedCampaign(db, cursor.targetId, validateOwner);
    resolveStoredLocalCharacterExportBaseline(d.baseline, current.baselineVersion);
    return {
      ownerDeviceId: context.ownerDeviceId,
      gmLocalContextId: context.gmLocalContextId,
      campaignId: cursor.targetId,
    };
  };
  const verifiedQueue = (queue: GmRequestReviewSource['queue']) => {
    for (const request of queue.requests)
      for (const candidate of request.submittedRequest.batch.candidates) {
        // The trusted context is rechecked even on a content-cache hit; mutable catalog changes remain fatal.
        resolveStoredLocalCharacterExportBaseline(d.baseline, candidate.descriptor.baselineVersion);
        const owner = request.submittedRequest.principal.peerIdentity.ownerDeviceId;
        const key = postSaveSha256(canonicalPostSaveJson({ owner, candidate }));
        if (!validatedCandidates.has(key)) {
          validateFinalAdmissionCandidate(
            candidate.canonicalWitnessText,
            owner,
            candidate.descriptor,
            candidate.exportDocument,
            d.baseline,
            { maxWitnessBytes: d.config.transfer.maxWitnessBytes },
          );
          validatedCandidates.add(key);
        }
      }
    return queue;
  };
  const verifiedSource = (c: CampaignConnection): GmRequestReviewSource => {
    const source = readGmRequestReviewSource(db, scope(c), validateOwner);
    verifiedQueue(source.queue);
    return source;
  };
  const guard = (c: CampaignConnection) => {
    const bound = scope(c);
    return (source: GmRequestReviewSource): void => {
      exact(scope(c), bound);
      exact(source.scope, bound);
      if (source.context.masterProfileId !== source.privateOwner.masterProfileId) unavailable();
      // This runs both before and after the tentative SQL write. Encoding failure rolls the transaction back.
      const view = source.viewOrNull;
      const queue = verifiedQueue(source.queue);
      if (view?.formId === 'NET-017') {
        const base = projectGmRequestQueue({
          view,
          queue,
          campaign: readHostedCurrentPausedCampaign(db, bound.campaignId, validateOwner),
          connections: d.campaignNetwork.requestConnectionFacts(
            bound.campaignId,
            queue.requests.map((r) => r.submittedRequest.requestId),
          ),
          supported: c.executableReview ?? [],
        });
        if (
          !encodeHostMessageV2(
            {
              messageType: 'projection.snapshot',
              protocolVersion: 2,
              projectionRole: 'gm',
              revisions: vector(view),
              presentation: {
                assignment: {
                  reason: 'HOST_SYSTEM_EVENT',
                  correlationId: 'network-gm-view:' + view.snapshotSha256,
                },
                base,
                layers: [],
              },
            },
            d.vocabulary,
          ).ok
        )
          unavailable();
      }
    };
  };
  function receipt(c: CampaignConnection, id: string) {
    const own = scope(c);
    verifiedQueue(readGmDeviceRequestQueue(db, own, validateOwner));
    return readGmDeviceRequestDecision(db, own, id, validateOwner)?.receipt ?? null;
  }
  function queuePresentation(
    c: CampaignConnection,
    source: GmRequestReviewSource,
    connections?: ReturnType<typeof d.campaignNetwork.requestConnectionFacts>,
  ): { base: PresentedBaseForm; revisions: RevisionVector } {
    const { scope: own, viewOrNull: view, queue } = source;
    if (view?.formId !== 'NET-017') unavailable();
    return {
      revisions: vector(view),
      base: projectGmRequestQueue({
        view,
        queue,
        campaign: readHostedCurrentPausedCampaign(db, own.campaignId, validateOwner),
        connections:
          connections ??
          d.campaignNetwork.requestConnectionFacts(
            own.campaignId,
            queue.requests.map((r) => r.submittedRequest.requestId),
          ),
        supported: c.executableReview ?? [],
      }),
    };
  }
  const project = async (c: CampaignConnection) => {
    const source = verifiedSource(c);
    return source.viewOrNull?.formId === 'NET-017'
      ? queuePresentation(c, source)
      : d.campaignPresentation(c);
  };
  const presentationHash = (
    c: CampaignConnection,
    value: { base: PresentedBaseForm; revisions: RevisionVector },
  ) =>
    postSaveSha256(
      canonicalPostSaveJson({
        scope: scope(c),
        formId: value.base.formId,
        revisions: value.revisions,
        projectionPayload: value.base.roleFilteredPayload,
      }),
    );
  async function snapshot(
    c: CampaignConnection,
    id: string,
    reason: ProjectionSnapshotV2Message['presentation']['assignment']['reason'],
    prepared?: { base: PresentedBaseForm; revisions: RevisionVector },
  ): Promise<ProjectionSnapshotV2Message> {
    const p = prepared ?? (await publication(c));
    const result: ProjectionSnapshotV2Message = {
      messageType: 'projection.snapshot',
      protocolVersion: 2,
      projectionRole: 'gm',
      revisions: p.revisions,
      presentation: { assignment: { correlationId: id, reason }, base: p.base, layers: [] },
    };
    if (!encodeHostMessageV2(result, d.vocabulary).ok) unavailable();
    const watched = watchers.get(c);
    if (watched !== undefined) watched.lastHash = presentationHash(c, p);
    return result;
  }
  function connectionSource(c: CampaignConnection) {
    let source = verifiedSource(c);
    if (source.viewOrNull?.formId !== 'NET-017') return { source, facts: null };
    const own = source.scope,
      view = source.viewOrNull;
    const facts = d.campaignNetwork.requestConnectionFacts(
      own.campaignId,
      source.queue.requests.map((r) => r.submittedRequest.requestId),
    );
    const connectionFactsSha256 = postSaveSha256(canonicalPostSaveJson(facts));
    if (source.connectionFactsSha256OrNull !== connectionFactsSha256) {
      commitGmRequestReviewConnectionRefresh(
        db,
        own,
        {
          eventId: `gm-connection:${postSaveSha256(canonicalPostSaveJson({ own, vector: vector(view), connectionFactsSha256 }))}`,
          connectionFactsSha256,
        },
        validateOwner,
        (actual) => {
          guard(c)(actual);
          exact(
            d.campaignNetwork.requestConnectionFacts(
              own.campaignId,
              actual.queue.requests.map((r) => r.submittedRequest.requestId),
            ),
            facts,
          );
        },
      );
      source = verifiedSource(c);
    }
    return { source, facts };
  }
  // A publication may discover a real channel change while no browser watcher existed.
  // Seal that technical P-only event explicitly; the public project() reader stays read-only.
  function refreshConnectionPresentation(c: CampaignConnection): void {
    connectionSource(c);
  }
  const publication = async (c: CampaignConnection) => {
    const { source, facts } = connectionSource(c);
    return facts === null ? d.campaignPresentation(c) : queuePresentation(c, source, facts);
  };
  async function refresh(
    c: CampaignConnection,
    send: (m: LocalNetworkHostMessage) => void,
  ): Promise<void> {
    const { source, facts } = connectionSource(c);
    if (facts === null) return;
    const p = queuePresentation(c, source, facts),
      hash = presentationHash(c, p),
      watched = watchers.get(c);
    if (watched !== undefined && watched.lastHash !== hash)
      send(await snapshot(c, `network-gm-view:${hash}`, 'HOST_SYSTEM_EVENT', p));
  }
  async function handle(
    m: LocalNetworkClientMessage,
    c: CampaignConnection,
    send: (m: LocalNetworkHostMessage) => void,
  ): Promise<boolean> {
    const command =
      m.messageType === 'command.request' &&
      m.commandKind === 'workflow-command' &&
      NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS.some((id) => id === m.workflowCommandId);
    const nav =
      m.messageType === 'navigation.form-action' &&
      (m.sourceFormId === 'NET-017' ||
        (m.sourceFormId === 'CMP-006' && m.actionKey === 'CMP-006::CTA::002'));
    const draft = m.messageType === 'network.gm-request-draft.replace';
    if (!command && !nav && !draft) return false;
    try {
      const own = scope(c);
      watchers.set(c, { send, lastHash: watchers.get(c)?.lastHash ?? '' });
      if (nav && m.messageType === 'navigation.form-action') {
        if (m.sourceFormId === 'CMP-006' && (c.executableReview?.length ?? 0) === 0) unavailable();
        commitGmRequestReviewNavigation(db, own, m, validateOwner, guard(c));
        send(await snapshot(c, m.navigationRequestId, 'FORM_ACTION'));
      } else if (draft) {
        const result = commitGmRequestReviewDraft(db, own, m, validateOwner, guard(c));
        const p = await publication(c);
        send({
          messageType: 'network.gm-request-draft.result',
          protocolVersion: 3,
          draftUpdateId: m.draftUpdateId,
          scope: m.scope,
          changed: result.event.changed,
          appliedRevisions: result.event.appliedRevisions,
          appliedRequestQueueRevision: result.event.appliedRequestQueueRevision,
          revisions: p.revisions,
          requestQueueRevision: result.current.requestQueueRevision,
          projectionRole: 'gm',
          presentation: { base: p.base, layers: [] },
        });
        watchers.set(c, { send, lastHash: presentationHash(c, p) });
      } else if (command && m.messageType === 'command.request') {
        if (!(c.executableReview ?? []).includes(m.workflowCommandId)) unavailable();
        const request = m as NetworkGmDecisionRequest,
          known = readGmDeviceRequestDecision(db, own, m.commandId, validateOwner);
        const receiptId = known?.receipt.receiptId ?? randomUUID(),
          timestamp = known?.receipt.result.timestamp ?? new Date().toISOString();
        const result = commitGmDeviceRequestDecision(
          db,
          own,
          { request, receiptId, timestamp },
          validateOwner,
          (source) => {
            guard(c)(source);
            const current = verifiedQueue(source.queue).requests.find(
              (r) => r.submittedRequest.requestId === request.payload.requestId,
            );
            if (current === undefined) unavailable();
            encodeDeviceAdmissionPeerResponse({
              schemaVersion: 1,
              operation: 'DEVICE_REQUEST_RECOVER',
              outcome: 'ACK',
              delivery: 'RECOVERED',
              receipt: current.proof.submittedReceipt,
              current: deviceAdmissionRequestReviewCurrent(current.proof),
            });
            const encodedCommand = readGmDeviceRequestDecision(db, own, m.commandId, validateOwner);
            if (
              encodedCommand !== null &&
              !encodeHostMessage(
                {
                  messageType: 'command.replay',
                  protocolVersion: 1,
                  lifecycleState: 'IDEMPOTENT_REPLAY',
                  receipt: encodedCommand.receipt,
                },
                d.vocabulary,
              ).ok
            )
              unavailable();
          },
        );
        send(
          known === null
            ? {
                messageType: 'command.result',
                protocolVersion: 1,
                lifecycleState: 'COMMITTED',
                receipt: result.command.receipt,
              }
            : {
                messageType: 'command.replay',
                protocolVersion: 1,
                lifecycleState: 'IDEMPOTENT_REPLAY',
                receipt: result.command.receipt,
              },
        );
        send(await snapshot(c, m.commandId, 'COMMAND_DESTINATION'));
      }
    } catch (error) {
      let revisions: RevisionVector = {
        stateRevision: 0,
        projectionRevision: 0,
        actorVisibilityRevision: 0,
      };
      try {
        revisions = readCampaignCreationCursor(db, scope(c).gmLocalContextId).revisions;
      } catch {
        /* Foreign/corrupt contexts disclose no head. */
      }
      const conflict =
        error instanceof NetworkApplicationStoreError && error.code === 'IDEMPOTENCY_CONFLICT';
      if (draft) {
        let refusal: NetworkGmRequestDraftRefusal = conflict
          ? { code: 'IDEMPOTENCY_CONFLICT' }
          : { code: 'DRAFT_UNAVAILABLE' };
        if (error instanceof NetworkApplicationStoreError && error.code === 'STALE_REVISION')
          refusal = { code: 'STALE_REVISION', expected: m.expectedRevisions, actual: revisions };
        send({
          messageType: 'network.gm-request-draft.refusal',
          protocolVersion: 3,
          draftUpdateId: m.draftUpdateId,
          scope: m.scope,
          revisions,
          presentationUnchanged: true,
          refusal,
        });
      } else if (nav && m.messageType === 'navigation.form-action')
        send({
          messageType: 'navigation.form-action.refusal',
          protocolVersion: 2,
          navigationRequestId: m.navigationRequestId,
          presentationUnchanged: true,
          revisions,
          refusal: conflict
            ? { code: 'IDEMPOTENCY_CONFLICT', detail: 'PAYLOAD_MISMATCH' }
            : { code: 'NAVIGATION_UNAVAILABLE' },
        });
      else if (command && m.messageType === 'command.request')
        send({
          messageType: 'command.refusal',
          protocolVersion: 1,
          commandId: m.commandId,
          lastLifecycleState: null,
          revisions,
          refusal: conflict
            ? { code: 'IDEMPOTENCY_CONFLICT', commandId: m.commandId, detail: 'PAYLOAD_MISMATCH' }
            : { code: 'GUARD_REJECTED' },
        });
      if (command && m.messageType === 'command.request') {
        try {
          send(await snapshot(c, m.commandId, 'COMMAND_DESTINATION'));
        } catch {
          /* A foreign or corrupt source cannot supply a current view. */
        }
      }
    }
    return true;
  }
  // Technical polling observes persisted requests and authenticated channels; it cannot allocate gameplay state.
  let polling = false;
  const timer = setInterval(() => {
    if (closed || polling || watchers.size === 0) return;
    polling = true;
    const next = schedule(async () => {
      for (const [c, w] of watchers) {
        if (!c.trusted() || c.gmLocalContextId === null) {
          watchers.delete(c);
          continue;
        }
        try {
          await refresh(c, w.send);
        } catch {
          /* A refused source never emits a partial or foreign queue. */
        }
      }
    });
    void next
      .catch(() => {})
      .finally(() => {
        polling = false;
      });
  }, 1000);
  timer.unref();
  return {
    project,
    refreshConnectionPresentation,
    receipt,
    watch(c: CampaignConnection, send: (m: LocalNetworkHostMessage) => void): void {
      if (!closed && c.trusted()) watchers.set(c, { send, lastHash: '' });
    },
    handle(
      m: LocalNetworkClientMessage,
      c: CampaignConnection,
      send: (m: LocalNetworkHostMessage) => void,
    ) {
      const relevant =
        m.messageType === 'network.gm-request-draft.replace' ||
        (m.messageType === 'command.request' &&
          m.commandKind === 'workflow-command' &&
          NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS.some((id) => id === m.workflowCommandId)) ||
        (m.messageType === 'navigation.form-action' &&
          (m.sourceFormId === 'NET-017' ||
            (m.sourceFormId === 'CMP-006' && m.actionKey === 'CMP-006::CTA::002')));
      if (!relevant) return Promise.resolve(false);
      return schedule(() => handle(m, c, send));
    },
    close() {
      closed = true;
      clearInterval(timer);
      watchers.clear();
    },
  };
}
