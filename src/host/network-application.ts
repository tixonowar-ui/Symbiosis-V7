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
  projectOwnerAdmission,
} from './projections/net-application.js';
import {
  readLocalAdmission,
  readLocalAdmissionPresentation,
  readLocalAdmissionDelivery,
  readLocalAdmissionByEvent,
  readLocalAdmissionMenuReturn,
  receiveLocalAdmissionPublication,
  prepareLocalAdmissionDecision,
  acknowledgeLocalAdmissionDecision,
  navigateLocalAdmission,
  returnFromLocalAdmission,
  type LocalAdmissionRead,
} from '../persistence/local-campaign-admission.js';
import {
  admissionOwnerCommandValue,
  isAdmissionOwnerForm,
  type AdmissionOwnerFormId,
} from '../shared/campaign-admission-presentation.js';
import { admissionPlayerDecisionReceiptValue } from '../shared/campaign-admission-proposal.js';
import { canonicalFiveStartingPositionsCatalog } from './five-starting-positions-catalog.js';

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
  constructor(cause?: unknown) {
    super('Network publication failed after durable acknowledgement', { cause });
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
  const currentVector = (c: LocalNetworkConnection) =>
    vector(readLocalAdmissionPresentation(db, scope(c))?.application ?? current(c));
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
          readLocalCharacterOwner(db, row.localCharacterId)?.ownerDeviceId === s.ownerDeviceId &&
          !d.peer
            .admissionCapacity(s.networkScopeId)
            ?.alreadyImportedSourceUuids.includes(row.localCharacterId),
      )
      .map((row) => prepared(c, row.localCharacterId));
  }
  const project = (
    c: LocalNetworkConnection,
    s = current(c),
    verifiedAdmission?: ReturnType<typeof readLocalAdmissionPresentation>,
  ) => {
    const owned =
      verifiedAdmission === undefined
        ? readLocalAdmissionPresentation(db, scope(c))
        : verifiedAdmission;
    if (owned !== null && owned.admission.returnedOrNull === null)
      return projectOwnerAdmission({
        ...owned,
        contextId: c.contextId!,
        networkScopeId: c.networkScopeId!,
        controllerSeat: owned.tab.tabId,
        supported: c.executableWorkflowCommandIds,
        connected: d.peer.current(owned.application.networkScopeId) !== null,
        capacity: d.peer.admissionCapacity(owned.application.networkScopeId),
        itemLabels: canonicalFiveStartingPositionsCatalog()
          .entries.filter((entry) => entry.kind === 'CATALOGUE')
          .map((entry) => ({ itemTypeId: entry.itemTypeIdOrStoryType, name: entry.name })),
      });
    const capacity = d.peer.admissionCapacity(s.networkScopeId);
    return projectNetworkApplication({
      state: s,
      contextId: c.contextId!,
      supported: c.executableWorkflowCommandIds,
      campaign: capacity?.campaign ?? d.peer.current(s.networkScopeId)?.campaign ?? null,
      occupiedCampaignPlaceCount: capacity?.occupiedCampaignPlaceCount ?? null,
      alreadyImportedSourceUuids: capacity?.alreadyImportedSourceUuids ?? [],
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
    verifiedAdmission?: ReturnType<typeof readLocalAdmissionPresentation>,
  ): ProjectionSnapshotV2Message => {
    const s = verifiedCurrent ?? current(c),
      base = project(c, s, verifiedAdmission);
    return {
      messageType: 'projection.snapshot',
      protocolVersion: 2,
      projectionRole: 'player',
      revisions: isAdmissionOwnerForm(base.formId)
        ? vector(base.roleFilteredPayload as unknown as RevisionVector)
        : vector(s),
      presentation: { assignment: { reason, correlationId: id }, base, layers: [] },
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
  async function refreshCapacity(c: LocalNetworkConnection) {
    const before = current(c),
      verify = guard(c, before);
    const response = await d.peer.refreshAdmissionCapacity(scope(c));
    verify();
    if (response.outcome !== 'CAPACITY') unavailable();
    return response;
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
    if (current(c).sessionOrNull !== null) await refreshCapacity(c);
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
    consumeVerifiedCurrent?: (current: LocalNetworkApplication) => void,
  ): Promise<boolean> {
    let parsed = requestProof(c, response, verifiedDelivery);
    if (parsed === null) return false;
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
      return false;
    }
    const confirmed = sameRead
      ? parsed.delivery
      : readLocalNetworkDeliverySnapshot(db, bound, parsed.submit.intent.commandId);
    const consume = (delivery: LocalNetworkDeliverySnapshot): boolean => {
      if (!sameRead || consumeVerifiedCurrent === undefined) return false;
      // Only a callback result crosses the caller's await, never this authoritative read.
      consumeVerifiedCurrent(delivery.current);
      return true;
    };
    if (isDeepStrictEqual(confirmed.requestCurrentOrNull?.proof, parsed.proof))
      return consume(confirmed);
    const source = confirmed.current;
    const advanced = commitLocalNetworkRequestAdvance(
      db,
      {
        ...bound,
        expectedRevisions: vector(source),
        expectedDraftRevision: source.draftRevision,
      },
      { eventId: randomUUID(), receiptId: randomUUID(), proof: parsed.proof },
      guard(c),
    );
    return consume(advanced);
  }
  async function refreshRequest(
    c: LocalNetworkConnection,
    verifiedBefore?: LocalNetworkDeliverySnapshot,
    consumeVerifiedCurrent?: (current: LocalNetworkApplication) => void,
  ): Promise<boolean> {
    const before = verifiedBefore ?? readLocalNetworkRequestDeliverySnapshot(db, scope(c)),
      s = before.current,
      request = s.requestOrNull;
    if (request === null) return false;
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
      return applyRequestCurrent(c, response, after, consumeVerifiedCurrent);
    else unavailable();
    return false;
  }

  function ownerDecisionReceipt(
    c: LocalNetworkConnection,
    state: LocalAdmissionRead,
    commandId: string,
  ): CommandReceipt | null {
    const ack = state.events.find(
      (e) => e.payload.kind === 'ACK' && e.payload.receipt.commandId === commandId,
    );
    if (ack?.payload.kind !== 'ACK') return null;
    const mirror = readLocalNetworkApplicationEvent(
      db,
      state.record.scope,
      `admission-event:${ack.eventId}`,
    );
    if (mirror === null) unavailable();
    trust(c);
    if (
      owner(c) !== state.record.scope.ownerDeviceId ||
      (c.networkScopeId !== null && c.networkScopeId !== state.record.scope.networkScopeId)
    )
      unavailable();
    return {
      commandId,
      receiptId: mirror.receipt.receiptId,
      revisions: mirror.receipt.revisions,
      result: {
        operation: 'ADMISSION_PLAYER_DECIDE',
        networkScopeId: state.record.scope.networkScopeId,
        remoteReceipt: ack.payload.receipt as unknown as JsonObject,
      },
    };
  }
  async function deliverOwnerDecision(
    c: LocalNetworkConnection,
    state: LocalAdmissionRead,
    recovery: boolean,
  ): Promise<LocalAdmissionRead> {
    const pending = state.pendingDecisionOrNull;
    if (pending === null) return state;
    const verify = guard(c),
      bound = scope(c);
    if (bound.networkScopeId !== state.record.scope.networkScopeId) unavailable();
    const delivered = await d.peer.deliverAdmissionDecision(
      bound,
      state.record.publication.gmDecision.requestId,
      recovery,
    );
    verify();
    const now = readLocalAdmission(db, bound, state.record.publication.gmDecision.requestId);
    if (now === null) unavailable();
    exact(now, state);
    const response = delivered.response;
    if (response.outcome === 'DECIDED') {
      const remote = admissionPlayerDecisionReceiptValue(
        JSON.parse(response.receiptCanonicalJson) as unknown,
        state.record.publication,
      );
      return acknowledgeLocalAdmissionDecision(
        db,
        bound,
        response.requestId,
        randomUUID(),
        delivered.hostIdentity,
        { kind: 'ACK', receipt: remote },
        guard(c),
      );
    }
    if (response.outcome === 'NOT_APPLIED')
      return acknowledgeLocalAdmissionDecision(
        db,
        bound,
        response.requestId,
        randomUUID(),
        delivered.hostIdentity,
        { kind: 'FENCED_ABSENT', proof: response.proof },
        guard(c),
      );
    // An ordinary refusal is not proof that an earlier execution could not commit.
    if (!recovery) return deliverOwnerDecision(c, state, true);
    throw new LocalNetworkPeerError('UNCONFIRMED_OUTCOME');
  }
  async function refreshOwnerAdmission(
    c: LocalNetworkConnection,
  ): Promise<LocalAdmissionRead | null> {
    const s = current(c),
      request = s.requestOrNull;
    if (s.requestReviewOrNull?.requestStatus !== 'IN_REVIEW' || request === null) return null;
    let state = readLocalAdmission(db, scope(c), request.requestId);
    if (state === null) {
      const verify = guard(c, s),
        response = await d.peer.fetchAdmission(scope(c));
      verify();
      if (response.outcome === 'NOT_READY') return null;
      if (response.outcome !== 'PUBLICATION') unavailable();
      state = receiveLocalAdmissionPublication(
        db,
        scope(c),
        response.hostIdentity,
        response.publication,
        guard(c),
      );
    }
    if (state.pendingDecisionOrNull !== null) state = await deliverOwnerDecision(c, state, true);
    return state;
  }
  async function ownerCommand(
    raw: Extract<LocalNetworkClientMessage, { messageType: 'command.request' }>,
    c: LocalNetworkConnection,
    send: (m: LocalNetworkHostMessage) => void,
  ) {
    const m = admissionOwnerCommandValue(raw),
      p = m.payload;
    const binding = scope(c),
      known = readLocalAdmissionByEvent(db, binding, m.commandId);
    let state: LocalAdmissionRead;
    if (known !== null) {
      const event = known.events.find((e) => e.eventId === m.commandId);
      if (
        event?.payload.kind !== 'INTENT' ||
        event.payload.clientRequestJsonOrNull !== canonicalPostSaveJson(m)
      )
        throw new NetworkApplicationStoreError('IDEMPOTENCY_CONFLICT');
      state = known;
    } else {
      const s = fresh(c, p['contextId'] as string, m.expectedRevisions),
        view = project(c, s);
      if (
        view.formId !== 'NET-027' ||
        p['networkScopeId'] !== binding.networkScopeId ||
        !c.executableWorkflowCommandIds.includes('UI-CMD-ADMISSION-PLAYER-DECIDE') ||
        !view.availableActionKeys.includes(
          p['decision'] === 'ACCEPT' ? 'NET-027::CTA::003' : 'NET-027::CTA::004',
        )
      )
        unavailable();
      const capacity = await refreshCapacity(c);
      exact(current(c), s);
      if (capacity.campaign.revisions.stateRevision !== p['expectedCampaignRevision'])
        throw new NetworkApplicationStoreError('STALE_REVISION');
      state = prepareLocalAdmissionDecision(
        db,
        binding,
        {
          requestId: p['requestId'] as string,
          commandId: m.commandId,
          decision: p['decision'] === 'ACCEPT' ? 'ACCEPT' : 'DECLINE',
          expectedCampaignRevision: Number(p['expectedCampaignRevision']),
        },
        randomUUID,
        guard(c),
        canonicalPostSaveJson(m),
      );
    }
    try {
      if (state.pendingDecisionOrNull !== null) {
        if (d.peer.current(binding.networkScopeId) === null) await reconnect(c, true);
        const latest = readLocalAdmission(
          db,
          binding,
          state.record.publication.gmDecision.requestId,
        );
        if (latest === null) unavailable();
        state = await deliverOwnerDecision(c, latest, known !== null);
      }
    } catch {
      // INTENT survives uncertain transport outcomes. Recovery must fence or confirm it.
      state = readLocalAdmission(db, binding, state.record.publication.gmDecision.requestId)!;
    }
    try {
      const receipt = ownerDecisionReceipt(c, state, m.commandId);
      const destination = snapshot(c, m.commandId, 'COMMAND_DESTINATION');
      if (receipt !== null)
        send(
          known === null
            ? {
                messageType: 'command.result',
                protocolVersion: 1,
                lifecycleState: 'COMMITTED',
                receipt,
              }
            : {
                messageType: 'command.replay',
                protocolVersion: 1,
                lifecycleState: 'IDEMPOTENT_REPLAY',
                receipt,
              },
        );
      else if (state.pendingDecisionOrNull === null)
        send({
          messageType: 'command.refusal',
          protocolVersion: 1,
          commandId: m.commandId,
          lastLifecycleState: null,
          revisions: destination.revisions,
          refusal: { code: 'GUARD_REJECTED' },
        });
      send(destination);
    } catch (error) {
      throw new LocalNetworkPublicationError(error);
    }
  }
  async function ownerNavigate(
    m: FormActionIntentV2Message,
    c: LocalNetworkConnection,
    shell: LocalNetworkShell,
    send: (m: LocalNetworkHostMessage) => void,
  ) {
    if (c.networkScopeId === null) {
      const returned = readLocalAdmissionMenuReturn(db, owner(c), m.navigationRequestId);
      if (
        returned?.returnedOrNull?.mode !== 'MENU' ||
        (shell.formId !== null && shell.lastNetworkExitNavigationIdOrNull !== m.navigationRequestId)
      )
        unavailable();
      exact(returned.returnedOrNull.clientRequestJson, canonicalPostSaveJson(m));
      try {
        return await finishExit(
          c,
          shell,
          send,
          returned.record.scope.networkScopeId,
          {
            schemaVersion: 1,
            clientRequestJson: canonicalPostSaveJson(m),
            target: { kind: 'PLAYER_MENU' },
          },
          m.navigationRequestId,
          'FORM_ACTION',
          m.navigationRequestId,
          true,
        );
      } catch (error) {
        throw new LocalNetworkPublicationError(error);
      }
    }
    const owned = readLocalAdmissionPresentation(db, scope(c)),
      known = readLocalAdmissionByEvent(db, scope(c), eventId(m.navigationRequestId));
    const state = known ?? owned?.admission;
    if (state === undefined || state === null) unavailable();
    const previous = known?.events.find((e) => e.eventId === eventId(m.navigationRequestId));
    if (previous !== undefined) {
      if (
        (previous.payload.kind !== 'VIEW' && previous.payload.kind !== 'RETURN') ||
        previous.payload.clientRequestJson !== canonicalPostSaveJson(m)
      )
        throw new NetworkApplicationStoreError('IDEMPOTENCY_CONFLICT');
    } else {
      const view = project(c);
      if (
        view.formId !== m.sourceFormId ||
        currentVector(c).projectionRevision !== m.expectedProjectionRevision ||
        !view.availableActionKeys.includes(m.actionKey)
      )
        unavailable();
    }
    const requestId = state.record.publication.gmDecision.requestId;
    if (m.actionKey === 'NET-007::CTA::002' || m.actionKey === 'NET-007::CTA::003') {
      if (previous === undefined && m.actionKey === 'NET-007::CTA::002') {
        await reconnect(c);
        await refreshCapacity(c);
      }
      const result =
        previous?.payload.kind === 'RETURN'
          ? state
          : returnFromLocalAdmission(
              db,
              state.record.scope,
              {
                requestId,
                expectedRevisions: currentVector(c),
                expectedDraftRevision: current(c).draftRevision,
                clientRequestJson: canonicalPostSaveJson(m),
                mode: m.actionKey === 'NET-007::CTA::002' ? 'RESELECT' : 'MENU',
              },
              randomUUID,
              guard(c),
            );
      if (result.returnedOrNull?.mode === 'MENU') {
        try {
          return await finishExit(
            c,
            shell,
            send,
            state.record.scope.networkScopeId,
            {
              schemaVersion: 1,
              clientRequestJson: canonicalPostSaveJson(m),
              target: { kind: 'PLAYER_MENU' },
            },
            m.navigationRequestId,
            'FORM_ACTION',
            m.navigationRequestId,
            true,
          );
        } catch (error) {
          throw new LocalNetworkPublicationError(error);
        }
      }
    } else if (previous === undefined) {
      const target = (
        {
          'NET-006::CTA::001': 'NET-027',
          'NET-007::CTA::001': 'NET-027',
          'NET-027::CTA::001': 'NET-006',
          'NET-027::CTA::002': 'NET-007',
        } as Record<string, AdmissionOwnerFormId>
      )[m.actionKey];
      if (target === undefined) unavailable();
      navigateLocalAdmission(
        db,
        state.record.scope,
        requestId,
        {
          kind: 'VIEW',
          targetFormId: target,
          sourceRevisions: currentVector(c),
          clientRequestJson: canonicalPostSaveJson(m),
        },
        guard(c),
      );
    }
    try {
      send(snapshot(c, m.navigationRequestId, 'FORM_ACTION'));
    } catch (error) {
      throw new LocalNetworkPublicationError(error);
    }
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
    publish?: (
      delivery: LocalNetworkDeliverySnapshot,
      presentation: ReturnType<typeof readLocalAdmissionPresentation>,
    ) => void,
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
    if (out.intent.operation === 'OPEN') {
      try {
        await refreshCapacity(c);
      } catch {
        // OPEN is already durably acknowledged. Missing capacity only prevents
        // the next selection; it must not turn that committed OPEN into a refusal.
        diagnostic(c, 'PEER_UNAVAILABLE');
      }
    }
    if (
      !recovery &&
      publish !== undefined &&
      out.intent.operation === 'SUBMIT' &&
      out.intent.batch.schemaVersion === 2 &&
      response.outcome === 'ACK' &&
      response.current.kind === 'REQUEST_REVIEW'
    ) {
      const { delivery, presentation } = readLocalAdmissionDelivery(
        db,
        bound,
        out.intent.commandId,
      );
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
        publish(delivery, presentation);
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
      publishTerminal(c, delivery, true, send);
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
      const capacity = await refreshCapacity(c);
      exact(current(c), s);
      if (
        !networkCapacity(
          capacity.campaign,
          b.candidates.length,
          capacity.occupiedCampaignPlaceCount,
        ).fitsCurrentCapacity ||
        b.candidates.some((candidate) =>
          capacity.alreadyImportedSourceUuids.includes(candidate.descriptor.sourceUuid),
        )
      )
        unavailable();
      exact(capacity.campaign.revisions, b.campaignProof.revisions);
      if (capacity.campaign.checkpointSha256 !== b.campaignProof.checkpointSha256) unavailable();
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
        (delivery, presentation) => {
          publicationAttempted = true;
          const messages: LocalNetworkHostMessage[] = [];
          terminal(c, delivery.outbox!, false, (message) => messages.push(message), delivery);
          const destination = snapshot(
            c,
            m.commandId,
            'COMMAND_DESTINATION',
            delivery.current,
            presentation,
          );
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
    publishTerminal(c, delivery, false, send);
  }
  function publishTerminal(
    c: LocalNetworkConnection,
    delivery: LocalNetworkDeliverySnapshot,
    replay: boolean,
    send: (m: LocalNetworkHostMessage) => void,
  ) {
    const out = delivery.outbox ?? unavailable();
    try {
      const messages: LocalNetworkHostMessage[] = [];
      terminal(c, out, replay, (message) => messages.push(message), delivery);
      const destination = snapshot(
        c,
        out.intent.commandId,
        'COMMAND_DESTINATION',
        delivery.current,
      );
      for (const message of messages) send(message);
      send(destination);
    } catch {
      // Construction precedes delivery; transport failure recovers the original terminal.
      throw new LocalNetworkPublicationError();
    }
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
    if (isAdmissionOwnerForm(m.sourceFormId)) return ownerNavigate(m, c, shell, send);
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
      const capacity = await refreshCapacity(c);
      exact(current(c), s);
      const list = selected(c, s.selectedCandidates),
        session = s.sessionOrNull;
      if (
        list.length < 1 ||
        session === null ||
        !networkCapacity(capacity.campaign, list.length, capacity.occupiedCampaignPlaceCount)
          .fitsCurrentCapacity ||
        list.some((candidate) =>
          capacity.alreadyImportedSourceUuids.includes(candidate.descriptor.sourceUuid),
        )
      )
        unavailable();
      const body = {
        schemaVersion: 2 as const,
        localControllerSeatId: s.tabId,
        requestId: randomUUID(),
        technicalSessionId: session.technicalSessionId,
        connectionRevision: session.connectionRevision,
        campaignProof: {
          campaignId: capacity.campaign.campaignId,
          revisions: vector(capacity.campaign.revisions),
          checkpointSha256: capacity.campaign.checkpointSha256,
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
    const ownerView = readLocalAdmissionPresentation(db, own);
    if (ownerView?.admission.returnedOrNull?.mode === 'MENU') {
      const json = ownerView.admission.returnedOrNull.clientRequestJson;
      const nav = JSON.parse(json) as FormActionIntentV2Message;
      for (const id of m.unacknowledgedCommandIds) {
        const receipt = ownerDecisionReceipt(c, ownerView.admission, id);
        if (receipt !== null)
          send({
            messageType: 'command.replay',
            protocolVersion: 1,
            lifecycleState: 'IDEMPOTENT_REPLAY',
            receipt,
          });
        else
          send({
            messageType: 'command.refusal',
            protocolVersion: 1,
            commandId: id,
            lastLifecycleState: null,
            revisions: vector(ownerView.application),
            refusal: { code: 'GUARD_REJECTED' },
          });
      }
      return finishExit(
        c,
        shell,
        send,
        own.networkScopeId,
        { schemaVersion: 1, clientRequestJson: json, target: { kind: 'PLAYER_MENU' } },
        m.reconnectRequestId,
        'RECONNECT',
        nav.navigationRequestId,
        true,
      );
    }
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
    if (
      s.requestReviewOrNull?.requestStatus === 'IN_REVIEW' &&
      d.peer.current(s.networkScopeId) !== null
    ) {
      try {
        await refreshOwnerAdmission(c);
      } catch {
        /* Pending decisions remain durable until authenticated recovery. */
      }
      s = current(c);
    }
    for (const id of m.unacknowledgedCommandIds) {
      const admission = readLocalAdmissionByEvent(db, scope(c), id);
      if (admission !== null) {
        const receipt = ownerDecisionReceipt(c, admission, id);
        if (receipt !== null)
          send({
            messageType: 'command.replay',
            protocolVersion: 1,
            lifecycleState: 'IDEMPOTENT_REPLAY',
            receipt,
          });
        else if (admission.pendingDecisionOrNull?.commandId !== id)
          send({
            messageType: 'command.refusal',
            protocolVersion: 1,
            commandId: id,
            lastLifecycleState: null,
            revisions: currentVector(c),
            refusal: { code: 'GUARD_REJECTED' },
          });
        continue;
      }
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
    const resumedSnapshot = snapshot(c, m.reconnectRequestId, 'RECONNECT', s);
    send({
      messageType: 'session.reconnect.capabilities',
      protocolVersion: 2,
      reconnectRequestId: m.reconnectRequestId,
      revisions: resumedSnapshot.revisions,
      executableWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS.filter((id) =>
        c.executableWorkflowCommandIds.includes(id),
      ),
    });
    send(resumedSnapshot);
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
      (NETWORK_WORKFLOW_COMMAND_IDS.some((id) => id === m.workflowCommandId) ||
        m.workflowCommandId === 'UI-CMD-ADMISSION-PLAYER-DECIDE');
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
      else if (
        workflow &&
        m.messageType === 'command.request' &&
        m.commandKind === 'workflow-command' &&
        m.workflowCommandId === 'UI-CMD-ADMISSION-PLAYER-DECIDE'
      )
        await ownerCommand(m, c, send);
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
        if (
          m.commandKind === 'workflow-command' &&
          m.workflowCommandId === 'UI-CMD-ADMISSION-PLAYER-DECIDE'
        ) {
          const admission =
            c.trusted() && c.networkScopeId !== null
              ? readLocalAdmissionByEvent(db, scope(c), m.commandId)
              : null;
          if (admission?.pendingDecisionOrNull?.commandId === m.commandId && !conflict) return true;
          if (admission?.receiptOrNull?.commandId === m.commandId && !conflict)
            throw new LocalNetworkPublicationError(error);
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
          return true;
        }
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
  const ownerViewToken = (revisions: RevisionVector, base: PresentedBaseForm): string =>
    canonicalPostSaveJson({ revisions, base });
  const ownerViews = new Map<
    LocalNetworkConnection,
    {
      contextId: string;
      scopeId: string;
      publishedToken: string;
      publishedPendingCommandId: string | null;
      send: (m: LocalNetworkHostMessage) => void;
    }
  >();
  let polling = false;
  const ownerTimer = setInterval(() => {
    if (closed || polling || ownerViews.size === 0) return;
    polling = true;
    const tick = frames.then(async () => {
      const refreshedScopes = new Set<string>();
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
          const { presentation: owned, delivery: observed } = readLocalAdmissionDelivery(
            db,
            scope(c),
          );
          if (owned !== null && owned.application.networkScopeId !== binding.scopeId) {
            // A prepared tab reads the original authenticated journal; it has no separate peer session.
            const message = snapshot(
              c,
              'network-owner-view:' +
                postSaveSha256(
                  canonicalPostSaveJson({
                    scope: scope(c),
                    contextId: c.contextId,
                    revisions: vector(owned.application),
                  }),
                ),
              'HOST_SYSTEM_EVENT',
            );
            const token = ownerViewToken(message.revisions, message.presentation.base);
            if (token !== binding.publishedToken) {
              binding.send(message);
              binding.publishedToken = token;
            }
            continue;
          }
          const before = observed.current;
          if (before.formId !== 'NET-005') {
            ownerViews.delete(c);
            continue;
          }
          if (before.pendingCommandIdOrNull !== null || before.requestOrNull === null) continue;
          const publish = (after: LocalNetworkApplication): void => {
            trust(c);
            if (
              c.contextId !== binding.contextId ||
              c.networkScopeId !== binding.scopeId ||
              ownerViews.get(c) !== binding
            )
              return;
            if (after.formId !== 'NET-005') {
              ownerViews.delete(c);
              return;
            }
            if (after.pendingCommandIdOrNull !== null) return;
            const correlation =
              'network-owner-view:' +
              postSaveSha256(
                canonicalPostSaveJson({
                  scope: scope(c),
                  contextId: c.contextId,
                  revisions: vector(after),
                }),
              );
            const presentation = readLocalAdmissionPresentation(db, scope(c));
            const message = snapshot(c, correlation, 'HOST_SYSTEM_EVENT', after, presentation);
            const token = ownerViewToken(message.revisions, message.presentation.base);
            if (token === binding.publishedToken) return;
            const admission = presentation?.admission;
            if (
              binding.publishedPendingCommandId !== null &&
              admission?.lastAbsenceOrNull?.commandId === binding.publishedPendingCommandId
            )
              binding.send({
                messageType: 'command.refusal',
                protocolVersion: 1,
                commandId: binding.publishedPendingCommandId,
                lastLifecycleState: null,
                revisions: message.revisions,
                refusal: { code: 'GUARD_REJECTED' },
              });
            binding.send(message);
            // Publication failure retains the old token, so a quiet poll retries the same current.
            binding.publishedToken = token;
            binding.publishedPendingCommandId = admission?.pendingDecisionOrNull?.commandId ?? null;
          };
          if (!refreshedScopes.has(binding.scopeId)) {
            if (d.peer.current(binding.scopeId) === null) await reconnect(c, true);
            // A verified final publication already proves the immutable preliminary review.
            // Reconnect still reconciles the authenticated session generation above.
            else if (owned === null) await refreshRequest(c, observed);
            const admission = await refreshOwnerAdmission(c);
            // GM publication advances campaign state even though PROPOSED occupies no place.
            // The first live proposal must not reuse the pre-publication capacity revision.
            if (admission !== null) {
              try {
                await refreshCapacity(c);
              } catch {
                // The peer invalidates its capacity cache before RPC. A missing fresh header
                // disables decision CTAs, but cannot hide an already verified publication/ACK.
              }
            }
            // The serialized tick refreshes one installation scope once. Each connection
            // still reads its own complete local history and retains its own delivery token.
            refreshedScopes.add(binding.scopeId);
          }
          publish(current(c));
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
        let publishedToken = watching ? previous!.publishedToken : null;
        let publishedPendingCommandId = watching ? previous!.publishedPendingCommandId : null;
        const handled = await handle(m, c, shell, (message) => {
          send(message);
          // Subscription follows our published form, never a browser's claim. The tick
          // still verifies the full owned current before any recovery or publication.
          if (message.messageType === 'projection.snapshot' && message.protocolVersion === 2)
            watching =
              message.projectionRole === 'player' &&
              (message.presentation.base.formId === 'NET-005' ||
                isAdmissionOwnerForm(message.presentation.base.formId));
          else if (message.messageType === 'network.draft.result')
            watching = message.presentation.base.formId === 'NET-005';
          else return;
          publishedToken = watching
            ? ownerViewToken(message.revisions, message.presentation.base)
            : null;
          const pending = message.presentation.base.roleFilteredPayload['pendingCommandIdOrNull'];
          publishedPendingCommandId = watching && typeof pending === 'string' ? pending : null;
          watchedContextId = watching ? c.contextId : null;
          watchedScopeId = watching ? c.networkScopeId : null;
        });
        if (
          handled &&
          watching &&
          publishedToken !== null &&
          watchedContextId === c.contextId &&
          watchedScopeId === c.networkScopeId &&
          !closed &&
          c.trusted() &&
          c.networkScopeId !== null &&
          c.contextId !== null
        )
          ownerViews.set(c, {
            contextId: c.contextId,
            scopeId: c.networkScopeId,
            publishedToken,
            publishedPendingCommandId,
            send,
          });
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
import { createCampaignAdmissionRules } from './campaign-admission-service.js';
import { projectGmAdmission } from './projections/net-application.js';
import {
  readGmAdmissionViewStateInTransaction,
  readGmRequestReviewViewStateInTransaction,
} from '../persistence/campaign-creation.js';
import {
  commitAdmissionReviewOpenWithView,
  commitAdmissionReviewEdit,
  commitAdmissionViewValues,
  commitAdmissionViewNavigation,
  type AdmissionReviewOpenRequest,
} from '../persistence/campaign-admission-review.js';
import {
  commitAdmissionGmDecision,
  enterPublishedAdmissionView,
} from '../persistence/campaign-admission-decision.js';
import {
  ADMISSION_GM_VIEW_FORM_IDS,
  admissionGmClientBindingValue,
} from '../shared/campaign-admission-review.js';
import { encodeHostMessageV3 } from '../shared/wire-v3-codec.js';
import {
  readAdmissionDecision,
  readAdmissionDecisionWithHistory,
  readAdmissionDecisionByRequest,
} from '../persistence/campaign-admission-decision.js';
import type { PresentedLayerForm } from '../shared/wire-v2-protocol.js';

/** Local GM authority and technical QUEUE heads remain separate from campaign birth/checkpoints. */
export function createGmNetworkRuntime(d: {
  readonly database: Database.Database;
  readonly schedule?: <T>(run: () => Promise<T>) => Promise<T>;
  readonly config: NetworkApplicationConfig;
  readonly baseline: LocalCharacterExportBaseline;
  readonly vocabulary: ProtocolVocabulary & WireV2Vocabulary;
  readonly campaignNetwork: Pick<
    ReturnType<typeof createCampaignNetworkRuntime>,
    'requestConnectionFacts' | 'requestConnectionFactsFromSource'
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
  const authorityScope = (c: CampaignConnection): GmRequestReviewScope => {
    if (closed || !c.trusted() || c.gmLocalContextId === null) unavailable();
    const context = readLocalGmContext(db, c.gmLocalContextId),
      cursor = readCampaignCreationCursor(db, context.gmLocalContextId);
    if (
      context.ownerDeviceId !== loadDeviceId(db) ||
      (cursor.kind !== 'CAMPAIGN' && cursor.kind !== 'QUEUE' && cursor.kind !== 'ADMISSION')
    )
      unavailable();
    return {
      ownerDeviceId: context.ownerDeviceId,
      gmLocalContextId: context.gmLocalContextId,
      campaignId: cursor.targetId,
    };
  };
  const scope = (c: CampaignConnection): GmRequestReviewScope => {
    const own = authorityScope(c),
      current = readHostedCurrentPausedCampaign(db, own.campaignId, validateOwner);
    resolveStoredLocalCharacterExportBaseline(d.baseline, current.baselineVersion);
    return own;
  };
  const admissionService = () =>
    createCampaignAdmissionRules(d.baseline, d.config.transfer.maxWitnessBytes);
  type GmPresentation = {
    base: PresentedBaseForm;
    layers?: readonly PresentedLayerForm[];
    revisions: RevisionVector;
  };
  const admissionPresentation = (c: CampaignConnection): GmPresentation =>
    db
      .transaction(() => {
        const own = scope(c),
          service = admissionService(),
          view = readGmAdmissionViewStateInTransaction(db, own).viewOrNull;
        if (view === null || !view.active) unavailable();
        const { current, history } = readAdmissionDecisionWithHistory(
            db,
            own,
            view.admissionBatchId,
            validateOwner,
            service.rules,
          ),
          header = readHostedCurrentPausedCampaign(db, own.campaignId, validateOwner);
        return projectGmAdmission({
          view,
          current,
          history,
          service,
          campaign: {
            ...header,
            activePlayerCapacity: header.activePlayerCapacity as 1 | 2 | 3 | 4 | 5,
            revisions: vector(header),
          },
          supported: c.executableReview ?? [],
        });
      })
      .deferred();
  const inAdmission = (c: CampaignConnection) =>
    readCampaignCreationCursor(db, scope(c).gmLocalContextId).kind === 'ADMISSION';
  const admissionWorkflowIds = [
    'UI-CMD-ADMISSION-REVIEW-OPEN',
    'UI-CMD-ADMISSION-GM-ACCEPT',
    'UI-CMD-ADMISSION-GM-REJECT',
    'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
  ];
  const admissionRelevant = (m: LocalNetworkClientMessage) =>
    m.messageType === 'network.admission-review.edit' ||
    m.messageType === 'network.admission-view.replace' ||
    (m.messageType === 'navigation.form-action' &&
      ((ADMISSION_GM_VIEW_FORM_IDS as readonly string[]).includes(m.sourceFormId) ||
        (m.sourceFormId === 'NET-017' &&
          [
            'NET-017::CTA::001',
            'NET-017::CTA::002',
            'NET-017::CTA::003',
            'NET-017::CTA::004',
          ].includes(m.actionKey)))) ||
    (m.messageType === 'command.request' &&
      m.commandKind === 'workflow-command' &&
      admissionWorkflowIds.includes(m.workflowCommandId));
  const admissionViewEvents = (own: GmRequestReviewScope) =>
    db.transaction(() => readGmAdmissionViewStateInTransaction(db, own)).deferred();
  const admissionApplied = (own: GmRequestReviewScope, commandId: string): RevisionVector =>
    db
      .transaction(() => {
        const queue = readGmRequestReviewViewStateInTransaction(db, own),
          cause = queue.events.find(
            (event) =>
              event.mutation.kind === 'SOURCE_ADVANCE' &&
              event.mutation.cause.commandId === commandId,
          );
        if (cause === undefined) unavailable();
        const view = readGmAdmissionViewStateInTransaction(db, own).events.find(
          (event) =>
            event.mutation.kind === 'SOURCE_ADVANCE' &&
            event.mutation.queuePrefix.eventId === cause.eventId,
        );
        if (view === undefined) unavailable();
        return vector(view.view);
      })
      .deferred();
  const admissionAuthority =
    (c: CampaignConnection, own: GmRequestReviewScope) =>
    (source: GmRequestReviewSource): void => {
      exact(authorityScope(c), own);
      exact(source.scope, own);
      if (source.context.masterProfileId !== source.privateOwner.masterProfileId) unavailable();
    };
  const actionAvailable = (c: CampaignConnection, formId: string, key: string): void => {
    const p = admissionPresentation(c),
      active = p.layers?.at(-1) ?? p.base;
    if (active.formId !== formId || !active.availableActionKeys.some((action) => action === key))
      unavailable();
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
  const guard = (
    c: CampaignConnection,
    connections?: ReturnType<typeof d.campaignNetwork.requestConnectionFacts>,
  ) => {
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
          connections: connections ?? d.campaignNetwork.requestConnectionFactsFromSource(source),
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
  function receipt(c: CampaignConnection, id: string): CommandReceipt | null {
    return db
      .transaction(() => {
        const own = scope(c);
        verifiedQueue(readGmDeviceRequestQueue(db, own, validateOwner));
        const preliminary = readGmDeviceRequestDecision(db, own, id, validateOwner);
        if (preliminary !== null) return preliminary.receipt;
        const events = readGmAdmissionViewStateInTransaction(db, own).events,
          entry = events.find((event) => event.eventId === `gm-admission-enter:${id}`);
        if (entry?.mutation.kind === 'ENTER') {
          const current = readAdmissionDecision(
            db,
            own,
            entry.mutation.admissionBatchId,
            validateOwner,
            admissionService().rules,
          );
          return {
            commandId: id,
            receiptId: entry.mutation.receiptId,
            revisions: vector(entry.view),
            result: {
              workflowCommandId: 'UI-CMD-ADMISSION-REVIEW-OPEN',
              contextId: own.gmLocalContextId,
              campaignId: own.campaignId,
              admissionBatchId: current.review.current.admissionBatchId,
              originalOpenReceipt: current.review.open.receipt as unknown as JsonObject,
              timestamp: entry.mutation.timestamp,
            },
          };
        }
        const source = readGmRequestReviewViewStateInTransaction(db, own).events.find(
          (event) =>
            event.mutation.kind === 'SOURCE_ADVANCE' && event.mutation.cause.commandId === id,
        );
        if (
          source?.mutation.kind !== 'SOURCE_ADVANCE' ||
          source.mutation.cause.kind === 'PLAYER_DECISION'
        )
          return null;
        const current = readAdmissionDecision(
            db,
            own,
            source.mutation.cause.admissionBatchId,
            validateOwner,
            admissionService().rules,
          ),
          decision = current.gmDecisionOrNull;
        if (source.mutation.cause.kind === 'GM_DECISION') {
          if (decision?.request.commandId !== id) unavailable();
          // Internal store commands have no browser receipt and cannot be claimed by reconnect.
          if (decision.clientRequestJsonOrNull === null) return null;
          return {
            commandId: id,
            receiptId: decision.receipt.receiptId,
            revisions: admissionApplied(own, id),
            result: { ...decision.receipt, contextId: own.gmLocalContextId },
          };
        }
        const edit = current.review.events.find((event) => event.request.commandId === id);
        if (edit === undefined) unavailable();
        if (edit.clientRequestJsonOrNull === null || edit.request.intent.kind !== 'WEAPON')
          return null;
        return {
          commandId: id,
          receiptId: edit.receiptId,
          revisions: admissionApplied(own, id),
          result: {
            workflowCommandId: 'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
            contextId: own.gmLocalContextId,
            campaignId: own.campaignId,
            admissionBatchId: current.review.current.admissionBatchId,
            reviewCopyId: edit.request.intent.reviewCopyId,
            reviewRevision: edit.reviewRevision,
            timestamp: edit.timestamp,
          },
        };
      })
      .deferred();
  }
  function queuePresentation(
    c: CampaignConnection,
    source: GmRequestReviewSource,
    connections?: ReturnType<typeof d.campaignNetwork.requestConnectionFacts>,
  ): { base: PresentedBaseForm; revisions: RevisionVector } {
    const { scope: own, viewOrNull: view, queue } = source;
    if (view?.formId !== 'NET-017') unavailable();
    const selected =
      view.values.selectedRequestIdOrNull === null
        ? null
        : readAdmissionDecisionByRequest(
            db,
            own,
            view.values.selectedRequestIdOrNull,
            validateOwner,
            admissionService().rules,
          );
    const selectedAdmission = {
      published: selected?.gmDecisionOrNull !== null && selected?.gmDecisionOrNull !== undefined,
      hasProposed:
        selected?.gmDecisionOrNull?.request.decision === 'ACCEPT' &&
        (selected.playerDecisionOrNull === null ||
          selected.playerDecisionOrNull.receipt.copies.some(
            (copy) => copy.lifecycleState === 'PROPOSED',
          )),
    };
    return {
      revisions: vector(view),
      base: projectGmRequestQueue({
        view,
        queue,
        campaign: readHostedCurrentPausedCampaign(db, own.campaignId, validateOwner),
        connections: connections ?? d.campaignNetwork.requestConnectionFactsFromSource(source),
        supported: c.executableReview ?? [],
        selectedAdmission,
      }),
    };
  }
  const project = async (c: CampaignConnection): Promise<GmPresentation> => {
    if (inAdmission(c)) return admissionPresentation(c);
    const source = verifiedSource(c);
    return source.viewOrNull?.formId === 'NET-017'
      ? queuePresentation(c, source)
      : d.campaignPresentation(c);
  };
  const presentationHash = (c: CampaignConnection, value: GmPresentation) =>
    postSaveSha256(
      canonicalPostSaveJson({
        scope: scope(c),
        formId: value.base.formId,
        revisions: value.revisions,
        projectionPayload: value.base.roleFilteredPayload,
        layers: value.layers ?? [],
      }),
    );
  async function snapshot(
    c: CampaignConnection,
    id: string,
    reason: ProjectionSnapshotV2Message['presentation']['assignment']['reason'],
    prepared?: GmPresentation,
  ): Promise<ProjectionSnapshotV2Message> {
    const p = prepared ?? (await publication(c));
    const result: ProjectionSnapshotV2Message = {
      messageType: 'projection.snapshot',
      protocolVersion: 2,
      projectionRole: 'gm',
      revisions: p.revisions,
      presentation: {
        assignment: { correlationId: id, reason },
        base: p.base,
        layers: p.layers ?? [],
      },
    };
    const encoded = encodeHostMessageV2(result, d.vocabulary);
    if (!encoded.ok)
      throw new Error('GM snapshot failed closed validation', { cause: encoded.refusal });
    return result;
  }
  function sendSnapshot(
    c: CampaignConnection,
    send: (m: LocalNetworkHostMessage) => void,
    message: ProjectionSnapshotV2Message,
  ): void {
    send(message);
    const watched = watchers.get(c);
    if (watched !== undefined)
      watched.lastHash = presentationHash(c, {
        base: message.presentation.base,
        layers: message.presentation.layers,
        revisions: message.revisions,
      });
  }
  function connectionSource(c: CampaignConnection) {
    let source = verifiedSource(c);
    if (source.viewOrNull?.formId !== 'NET-017') return { source, facts: null };
    const own = source.scope,
      view = source.viewOrNull;
    const facts = d.campaignNetwork.requestConnectionFactsFromSource(source);
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
          const currentFacts = d.campaignNetwork.requestConnectionFactsFromSource(actual);
          guard(c, currentFacts)(actual);
          exact(currentFacts, facts);
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
  const publication = async (c: CampaignConnection): Promise<GmPresentation> => {
    const { source, facts } = connectionSource(c);
    if (inAdmission(c)) return admissionPresentation(c);
    return facts === null ? d.campaignPresentation(c) : queuePresentation(c, source, facts);
  };
  async function refresh(
    c: CampaignConnection,
    send: (m: LocalNetworkHostMessage) => void,
  ): Promise<void> {
    const { source, facts } = connectionSource(c);
    if (facts === null) return;
    const p = inAdmission(c) ? admissionPresentation(c) : queuePresentation(c, source, facts),
      hash = presentationHash(c, p),
      watched = watchers.get(c);
    if (watched !== undefined && watched.lastHash !== hash)
      sendSnapshot(c, send, await snapshot(c, `network-gm-view:${hash}`, 'HOST_SYSTEM_EVENT', p));
  }
  async function handleAdmission(
    m: LocalNetworkClientMessage,
    c: CampaignConnection,
    send: (m: LocalNetworkHostMessage) => void,
  ): Promise<boolean> {
    if (!admissionRelevant(m)) return false;
    let committed = false;
    try {
      const own = scope(c),
        service = admissionService(),
        authority = admissionAuthority(c, own);
      watchers.set(c, { send, lastHash: watchers.get(c)?.lastHash ?? '' });
      if (m.messageType === 'navigation.form-action') {
        if (m.sourceFormId === 'NET-017') {
          enterPublishedAdmissionView(db, own, m, validateOwner, service.rules, (current) =>
            authority(current.review.source),
          );
        } else {
          const known = admissionViewEvents(own).events.some(
            (event) => event.eventId === m.navigationRequestId,
          );
          if (!known) actionAvailable(c, m.sourceFormId, m.actionKey);
          const returns = [
            'NET-018::CTA::001',
            'NET-019::CTA::001',
            'NET-020::CTA::001',
            'NET-021::CTA::001',
            'NET-021::CTA::004',
            'NET-022::CTA::002',
          ].includes(m.actionKey);
          commitAdmissionViewNavigation(
            db,
            own,
            m,
            returns,
            validateOwner,
            service.rules,
            (review) => authority(review.source),
          );
        }
        committed = true;
        sendSnapshot(c, send, await snapshot(c, m.navigationRequestId, 'FORM_ACTION'));
      } else if (
        m.messageType === 'network.admission-review.edit' ||
        m.messageType === 'network.admission-view.replace'
      ) {
        let appliedRevisions: RevisionVector;
        if (m.messageType === 'network.admission-view.replace') {
          const saved = commitAdmissionViewValues(
            db,
            own,
            m,
            validateOwner,
            service.rules,
            (review, values) => {
              const previous = readGmAdmissionViewStateInTransaction(db, own).viewOrNull;
              if (previous === null) unavailable();
              if (
                !review.editable &&
                (values.rejectionReason !== previous.values.rejectionReason ||
                  !isDeepStrictEqual(values.weaponDraftOrNull, previous.values.weaponDraftOrNull))
              )
                unavailable();
              if (values.weaponDraftOrNull !== null)
                service.weaponPreview(
                  review,
                  values.selectedReviewCopyId,
                  values.weaponDraftOrNull,
                );
            },
            (review) => authority(review.source),
          );
          committed = true;
          appliedRevisions = vector(saved.event.view);
        } else {
          const binding = admissionGmClientBindingValue(m),
            intent = binding.intentOrNull;
          if (intent === null || intent.kind === 'WEAPON') unavailable();
          commitAdmissionReviewEdit(
            db,
            own,
            {
              request: {
                commandId: m.draftUpdateId,
                admissionBatchId: m.admissionBatchId,
                expectedReviewRevision: m.expectedReviewRevision,
                intent,
              },
              clientRequestJsonOrNull: canonicalPostSaveJson(m),
              receiptId: randomUUID(),
              timestamp: new Date().toISOString(),
            },
            validateOwner,
            service.rules,
            (intent) =>
              intent.kind === 'ALLOCATE_ITEM'
                ? { ...intent, reviewItemId: randomUUID() }
                : intent.kind === 'ALLOCATE_GROUP'
                  ? { ...intent, groupDraftId: randomUUID() }
                  : intent,
            (review) => authority(review.source),
          );
          committed = true;
          appliedRevisions = admissionApplied(own, m.draftUpdateId);
        }
        committed = true;
        const p = await publication(c);
        const result: HostToClientV3Message = {
          messageType: 'network.admission-draft.result',
          protocolVersion: 3,
          draftUpdateId: m.draftUpdateId,
          contextId: m.contextId,
          campaignId: m.campaignId,
          admissionBatchId: m.admissionBatchId,
          appliedRevisions,
          revisions: p.revisions,
          projectionRole: 'gm',
          presentation: { base: p.base, layers: p.layers ?? [] },
        };
        if (!encodeHostMessageV3(result, d.vocabulary).ok) unavailable();
        send(result);
        watchers.set(c, { send, lastHash: presentationHash(c, p) });
      } else if (m.messageType === 'command.request' && m.commandKind === 'workflow-command') {
        if (!(c.executableReview ?? []).includes(m.workflowCommandId)) unavailable();
        let receipt: CommandReceipt, replayed: boolean;
        if (m.workflowCommandId === 'UI-CMD-ADMISSION-REVIEW-OPEN') {
          const result = commitAdmissionReviewOpenWithView(
            db,
            own,
            {
              request: m as AdmissionReviewOpenRequest,
              receiptId: randomUUID(),
              timestamp: new Date().toISOString(),
            },
            validateOwner,
            service.rules,
            (request) => service.initial(request, randomUUID),
            authority,
          );
          committed = true;
          const entry = result.entryOrNull,
            original = result.review.open;
          if (entry !== null && entry.mutation.kind !== 'ENTER') unavailable();
          receipt = {
            commandId: m.commandId,
            receiptId:
              entry?.mutation.kind === 'ENTER'
                ? entry.mutation.receiptId
                : original.receipt.receiptId,
            revisions: entry === null ? original.request.expectedRevisions : vector(entry.view),
            result: {
              workflowCommandId: m.workflowCommandId,
              contextId: own.gmLocalContextId,
              campaignId: own.campaignId,
              admissionBatchId: original.initialState.admissionBatchId,
              originalOpenReceipt: original.receipt as unknown as JsonObject,
              timestamp:
                entry?.mutation.kind === 'ENTER'
                  ? entry.mutation.timestamp
                  : original.receipt.timestamp,
            },
          };
          replayed = result.kind === 'REPLAYED';
        } else {
          const binding = admissionGmClientBindingValue(m),
            before = readAdmissionDecision(
              db,
              own,
              binding.admissionBatchId,
              validateOwner,
              service.rules,
            );
          if (binding.intentOrNull?.kind === 'WEAPON') {
            const known = before.review.events.find(
              (event) => event.request.commandId === m.commandId,
            );
            if (known === undefined) actionAvailable(c, 'GM-019', 'GM-019::CTA::005');
            const saved = commitAdmissionReviewEdit(
              db,
              own,
              {
                request: {
                  commandId: m.commandId,
                  admissionBatchId: binding.admissionBatchId,
                  expectedReviewRevision: binding.reviewRevision,
                  intent: binding.intentOrNull,
                },
                clientRequestJsonOrNull: canonicalPostSaveJson(m),
                receiptId: randomUUID(),
                timestamp: new Date().toISOString(),
              },
              validateOwner,
              service.rules,
              (intent) => {
                if (intent.kind !== 'WEAPON') return unavailable();
                return intent;
              },
              (review) => authority(review.source),
            );
            committed = true;
            receipt = {
              commandId: m.commandId,
              receiptId: saved.event.receiptId,
              revisions: admissionApplied(own, m.commandId),
              result: {
                workflowCommandId: m.workflowCommandId,
                contextId: own.gmLocalContextId,
                campaignId: own.campaignId,
                admissionBatchId: binding.admissionBatchId,
                reviewCopyId: binding.intentOrNull.reviewCopyId,
                reviewRevision: saved.event.reviewRevision,
                timestamp: saved.event.timestamp,
              },
            };
            replayed = saved.replayed;
          } else {
            const request = binding.decisionOrNull;
            if (request === null) unavailable();
            if (before.gmDecisionOrNull?.request.commandId !== m.commandId)
              actionAvailable(
                c,
                request.decision === 'ACCEPT' ? 'NET-021' : 'NET-022',
                request.decision === 'ACCEPT' ? 'NET-021::CTA::005' : 'NET-022::CTA::003',
              );
            const saved = commitAdmissionGmDecision(
              db,
              own,
              {
                request,
                clientRequestJsonOrNull: canonicalPostSaveJson(m),
                receiptId: randomUUID(),
                timestamp: new Date().toISOString(),
              },
              validateOwner,
              service.rules,
              randomUUID,
              (current) => authority(current.review.source),
            );
            committed = true;
            const core = saved.current.gmDecisionOrNull;
            if (core === null) unavailable();
            receipt = {
              commandId: m.commandId,
              receiptId: core.receipt.receiptId,
              revisions: admissionApplied(own, m.commandId),
              result: { ...core.receipt, contextId: own.gmLocalContextId },
            };
            replayed = saved.replayed;
          }
        }
        committed = true;
        const terminal: HostToClientMessage = replayed
          ? {
              messageType: 'command.replay',
              protocolVersion: 1,
              lifecycleState: 'IDEMPOTENT_REPLAY',
              receipt,
            }
          : {
              messageType: 'command.result',
              protocolVersion: 1,
              lifecycleState: 'COMMITTED',
              receipt,
            };
        const target = await snapshot(c, m.commandId, 'COMMAND_DESTINATION');
        if (!encodeHostMessage(terminal, d.vocabulary).ok) unavailable();
        send(terminal);
        sendSnapshot(c, send, target);
      }
    } catch (error) {
      if (committed) throw new LocalNetworkPublicationError(error);
      let revisions: RevisionVector = {
        stateRevision: 0,
        projectionRevision: 0,
        actorVisibilityRevision: 0,
      };
      try {
        revisions = readCampaignCreationCursor(db, scope(c).gmLocalContextId).revisions;
      } catch {
        /* No foreign head is disclosed. */
      }
      const code = error instanceof NetworkApplicationStoreError ? error.code : 'UNAVAILABLE';
      if (
        m.messageType === 'network.admission-review.edit' ||
        m.messageType === 'network.admission-view.replace'
      )
        send({
          messageType: 'network.admission-draft.refusal',
          protocolVersion: 3,
          draftUpdateId: m.draftUpdateId,
          contextId: m.contextId,
          campaignId: m.campaignId,
          admissionBatchId: m.admissionBatchId,
          revisions,
          presentationUnchanged: true,
          refusal:
            code === 'STALE_REVISION' || code === 'IDEMPOTENCY_CONFLICT' || code === 'INVALID_INPUT'
              ? code
              : 'UNAVAILABLE',
        });
      else if (m.messageType === 'navigation.form-action')
        send({
          messageType: 'navigation.form-action.refusal',
          protocolVersion: 2,
          navigationRequestId: m.navigationRequestId,
          revisions,
          presentationUnchanged: true,
          refusal:
            code === 'IDEMPOTENCY_CONFLICT'
              ? { code: 'IDEMPOTENCY_CONFLICT', detail: 'PAYLOAD_MISMATCH' }
              : { code: 'NAVIGATION_UNAVAILABLE' },
        });
      else if (m.messageType === 'command.request')
        send({
          messageType: 'command.refusal',
          protocolVersion: 1,
          commandId: m.commandId,
          lastLifecycleState: null,
          revisions,
          refusal:
            code === 'IDEMPOTENCY_CONFLICT'
              ? { code: 'IDEMPOTENCY_CONFLICT', commandId: m.commandId, detail: 'PAYLOAD_MISMATCH' }
              : { code: 'GUARD_REJECTED' },
        });
    }
    return true;
  }
  async function handle(
    m: LocalNetworkClientMessage,
    c: CampaignConnection,
    send: (m: LocalNetworkHostMessage) => void,
  ): Promise<boolean> {
    if (await handleAdmission(m, c, send)) return true;
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
    let committed = false;
    try {
      const own = scope(c);
      watchers.set(c, { send, lastHash: watchers.get(c)?.lastHash ?? '' });
      if (nav && m.messageType === 'navigation.form-action') {
        if (m.sourceFormId === 'CMP-006' && (c.executableReview?.length ?? 0) === 0) unavailable();
        commitGmRequestReviewNavigation(db, own, m, validateOwner, guard(c));
        committed = true;
        sendSnapshot(c, send, await snapshot(c, m.navigationRequestId, 'FORM_ACTION'));
      } else if (draft) {
        const result = commitGmRequestReviewDraft(db, own, m, validateOwner, guard(c));
        committed = true;
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
          presentation: { base: p.base, layers: p.layers ?? [] },
        });
        watchers.set(c, { send, lastHash: presentationHash(c, p) });
      } else if (command && m.messageType === 'command.request') {
        if (!(c.executableReview ?? []).includes(m.workflowCommandId)) unavailable();
        const request = m as NetworkGmDecisionRequest,
          known = readGmDeviceRequestDecision(db, own, m.commandId, validateOwner);
        if (known === null) {
          const admission = readAdmissionDecisionByRequest(
            db,
            own,
            request.payload.requestId,
            validateOwner,
            admissionService().rules,
          );
          if (admission !== null && admission.gmDecisionOrNull !== null) unavailable();
        }
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
        committed = true;
        const destination = await snapshot(c, m.commandId, 'COMMAND_DESTINATION');
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
        sendSnapshot(c, send, destination);
      }
    } catch (error) {
      if (committed) throw new LocalNetworkPublicationError(error);
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
          sendSnapshot(c, send, await snapshot(c, m.commandId, 'COMMAND_DESTINATION'));
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
        admissionRelevant(m) ||
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
