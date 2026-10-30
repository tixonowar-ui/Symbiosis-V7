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
  readLocalNetworkShellExitByNavigationId,
  readLocalNetworkAttemptCount,
  readLocalNetworkOpenOutboxByAttempt,
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
import { prepareOwnedFinalAdmissionCandidate } from './device-admission-candidate.js';
import {
  deviceAdmissionSubmitSemanticBody,
  encodeDeviceAdmissionPeerResponse,
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
      attemptCount: s.formId === 'NET-011' ? readLocalNetworkAttemptCount(db, scope(c)) : 0,
    });
  };
  const snapshot = (
    c: LocalNetworkConnection,
    id: string,
    reason: 'FORM_ACTION' | 'RECONNECT' | 'COMMAND_DESTINATION',
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
      mutate(c, {
        kind: 'NAVIGATE',
        targetFormId: 'NET-011',
        plannedAttemptIdOrNull: randomUUID(),
        singleCandidateOrNull: null,
      });
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
    if ((force || s.pendingCommandIdOrNull === null) && s.requestOrNull !== null) {
      const restored = readLocalNetworkDeliverySnapshot(
        db,
        scope(c),
        s.requestOrNull.submitCommandId,
      );
      verify(restored.current);
      const submit = restored.outbox;
      if (
        submit === null ||
        submit.intent.operation !== 'SUBMIT' ||
        submit.acknowledgementOrNull?.operation !== 'SUBMIT'
      )
        unavailable();
      const recovered = await d.peer.recover(scope(c), submit);
      verify();
      if (
        recovered.outcome !== 'ACK' ||
        recovered.operation !== 'DEVICE_REQUEST_RECOVER' ||
        recovered.receipt.operation !== 'SUBMIT' ||
        recovered.current.kind !== 'REQUEST'
      )
        unavailable();
      exact(recovered.receipt.commandId, submit.intent.commandId);
      exact(recovered.receipt.semanticBodySha256, submit.semanticBodySha256);
      exact(recovered.receipt.request, submit.acknowledgementOrNull.request);
      exact(recovered.current.request, s.requestOrNull);
    } else if ((force || s.pendingCommandIdOrNull === null) && s.sessionOrNull !== null) {
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
  function unresolved(c: LocalNetworkConnection, original: LocalNetworkOutbox) {
    const delivery = readLocalNetworkDeliverySnapshot(db, scope(c), original.intent.commandId),
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
        const now = response.current.kind === 'REQUEST' ? response.current.request : null;
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
      if (r.operation !== 'OPEN' && intent.operation !== 'OPEN') {
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
  async function deliver(c: LocalNetworkConnection, out: LocalNetworkOutbox, recovery: boolean) {
    const bound = scope(c),
      contextId = c.contextId;
    const check = () => {
      trust(c);
      exact(scope(c), bound);
      if (c.contextId !== contextId) unavailable();
      return unresolved(c, out);
    };
    const beforeReconnect = check();
    await reconnect(c, !recovery && out.intent.operation !== 'OPEN', beforeReconnect);
    check();
    let response = recovery ? await d.peer.recover(bound, out) : await d.peer.deliver(bound, out);
    let verified = check();
    let ack = acknowledgement(out, response);
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
        response.current.kind === 'REQUEST' &&
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
    if (ack === null) {
      diagnostic(c, 'UNCONFIRMED_OUTCOME');
      return;
    }
    const saved = mutate(
      c,
      { kind: 'ACKNOWLEDGE', acknowledgement: ack },
      undefined,
      null,
      verified.current,
    );
    planRetry(c, saved.current);
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
      if (known.acknowledgementOrNull === null)
        try {
          await deliver(c, known, true);
        } catch {
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
    const out = readLocalNetworkOutbox(db, scope(c), m.commandId)!;
    try {
      await deliver(c, out, false);
    } catch {
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
      presentation: { base: project(c), layers: [] },
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
        await reconnect(c);
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
    planRetry(c);
    s = current(c);
    for (const id of m.unacknowledgedCommandIds) {
      const out = readLocalNetworkOutbox(db, scope(c), id);
      if (out !== null) terminal(c, out, true, send);
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
      revisions: currentVector(c),
      executableWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS.filter((id) =>
        c.executableWorkflowCommandIds.includes(id),
      ),
    });
    send(snapshot(c, m.reconnectRequestId, 'RECONNECT'));
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
  return {
    currentVector,
    handle(
      m: LocalNetworkClientMessage,
      c: LocalNetworkConnection,
      shell: LocalNetworkShell,
      send: (m: LocalNetworkHostMessage) => void,
    ) {
      const next = frames.then(() => handle(m, c, shell, send));
      frames = next.then(
        () => {},
        () => {},
      );
      return next;
    },
    close() {
      closed = true;
      d.peer.close();
    },
  };
}
