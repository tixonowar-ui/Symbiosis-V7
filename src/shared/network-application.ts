import type {
  NetworkDraftScope,
  NetworkWorkflowCommandId,
  NetworkGmRequestReviewWorkflowId,
  PublicCandidateRef,
  PublicFinalCandidateSummary,
  CapacityForecast,
} from './device-admission.js';
import type { JsonObject, RevisionVector, WorkflowCommandRequestMessage } from './wire-protocol.js';
import type { PresentedBaseForm, PresentedLayerForm } from './wire-v2-protocol.js';

/** Player application surfaces of #171; GM review is a separate projection family. */
export const NETWORK_APPLICATION_FORM_IDS = [
  'NET-001',
  'NET-002',
  'NET-003',
  'NET-004',
  'NET-005',
  'NET-011',
  'CHR-027',
] as const;
export type NetworkApplicationFormId = (typeof NETWORK_APPLICATION_FORM_IDS)[number];

/** ADR 0027, section 5. These describe the campaign session, not the local browser WS. */
export type NetworkConnectionState =
  | 'NO_TECHNICAL_SESSION'
  | 'CONNECTING'
  | 'CONNECTED_TECHNICAL'
  | 'CONNECTED_ADMITTED'
  | 'LOST'
  | 'UNAVAILABLE'
  | 'DISCONNECTED'
  | 'RECONNECTED';

export interface NetworkHostLocator extends JsonObject {
  readonly hostAddress: string;
  readonly hostPort: number;
  readonly campaignHintOrNull: string | null;
}
export interface NetworkDiscoveredHost extends JsonObject {
  readonly campaignId: string;
  readonly title: string;
  readonly locator: NetworkHostLocator;
  readonly campaignStatus: 'PAUSED';
  readonly activePlayerCapacity: 1 | 2 | 3 | 4 | 5;
  readonly activePcCount: number;
  readonly compatibility: 'COMPATIBLE' | 'INCOMPATIBLE';
}
export interface NetworkReadCommon extends JsonObject {
  readonly networkScopeId: string;
  readonly contextId: string;
  readonly deviceId: string;
  /** The real logical input tab; this is not an admitted campaign seat. */
  readonly controllerSeat: string;
  readonly stateRevision: number;
  readonly projectionRevision: number;
  readonly actorVisibilityRevision: number;
  readonly draftRevision: number;
  /** A QR/discovery hint never becomes a confirmed campaign binding. */
  readonly campaignIdOrNull: string | null;
  readonly connectionState: NetworkConnectionState;
  readonly pendingCommandIdOrNull: string | null;
}
export interface Net001Projection extends NetworkReadCommon {
  readonly activeRole: 'PLAYER';
  readonly discoveryState: 'NOT_STARTED' | 'SEARCHING' | 'COMPLETE' | 'UNAVAILABLE';
  readonly discoveredHosts: readonly NetworkDiscoveredHost[];
  readonly discoveryTruncated: boolean;
  readonly lastAddressOrNull: string | null;
  readonly returnContext: 'PLAYER_MENU';
  readonly connectionAttemptIdOrNull: string | null;
}
export interface Net002Projection extends NetworkReadCommon {
  readonly addressOrQrPayload: string;
  readonly parsedHost: string | null;
  readonly parsedPort: number | null;
  readonly protocolVersion: 3;
  readonly campaignHintOrNull: string | null;
  readonly parseStatus: 'EMPTY' | 'INVALID' | 'VALID';
  readonly parseDiagnostic: string | null;
  readonly attemptId: string;
  readonly commandId: string | null;
}
export interface Net003Projection extends NetworkReadCommon {
  readonly ownRequestIdOrNull: string | null;
  readonly campaignId: string;
  readonly campaignStatus: 'PAUSED';
  readonly sessionId: string;
  readonly connectionRevision: number;
  readonly eligibleFinalCandidates: readonly PublicFinalCandidateSummary[];
  readonly selectedCandidates: readonly PublicCandidateRef[];
  readonly capacityForecast: CapacityForecast;
}
export interface NetworkSnapshotChecksum extends JsonObject {
  readonly localCharacterUuid: string;
  readonly candidateSnapshotChecksum: string;
}
export interface Net004Projection extends NetworkReadCommon {
  readonly sessionId: string;
  readonly requestId: string;
  readonly selectedLocalCharacterUuids: readonly string[];
  readonly snapshotChecksums: readonly NetworkSnapshotChecksum[];
  readonly campaignId: string;
  readonly connectionRevision: number;
  readonly commandId: string | null;
  readonly batchCharacterSummaries: readonly PublicFinalCandidateSummary[];
  readonly capacityForecast: CapacityForecast;
}
export interface Net005Projection extends NetworkReadCommon {
  readonly sessionId: string;
  readonly requestId: string;
  readonly requestOwnerDeviceId: string;
  readonly batchCharacterSummaries: readonly PublicFinalCandidateSummary[];
  /** Atlas 1.6: only this installation's request; no queue or admission authority. */
  readonly requestStatus: NetworkVisibleRequestStatus;
  readonly gmMessage: string | null;
  readonly requestRevision: number;
  /** Own local input only; storing it never executes the separate cancellation command. */
  readonly cancelReason: string;
  readonly commandId: string | null;
}

/** Atlas 1.6 excludes CANCELLED rows from the queue and clears their selection. */
export type NetworkVisibleRequestStatus = 'PENDING' | 'IN_REVIEW' | 'REJECTED' | 'PROPOSED';
export interface NetworkGmRequestCandidateSummary extends JsonObject {
  readonly sourceUuid: string;
  /** Verified descriptor.exportBytesSha256; the exact canonical export file, including LF. */
  readonly snapshotChecksum: string;
  readonly name: string;
  readonly sourceSnapshotId: string;
  /** The submitted installation's real input lane, never an admitted campaign seat. */
  readonly localControllerSeatId: string;
}
export interface NetworkGmRequestQueueRow extends JsonObject {
  readonly requestId: string;
  readonly requestOwnerDeviceId: string;
  readonly requestStatus: NetworkVisibleRequestStatus;
  readonly requestRevision: number;
  readonly connectionState: NetworkConnectionState;
  readonly batchCharacterSummaries: readonly NetworkGmRequestCandidateSummary[];
  readonly requestedCandidateCount: 1 | 2 | 3;
  readonly gmMessageOrNull: string | null;
  readonly decisionReceiptIdOrNull: string | null;
}
export type NetworkGmRequestReturnContext =
  | {
      readonly originFormId: 'CMP-006';
      readonly campaignId: string;
      readonly creationReceiptId: string;
    }
  | { readonly originFormId: 'GM-002'; readonly campaignId: string }
  | { readonly originFormId: 'CMP-009'; readonly campaignId: string };
/** Bare source-backed values only; a GM draft transport/revision owner is defined separately. */
export interface NetworkGmRequestDraftValues extends JsonObject {
  readonly selectedRequestIdOrNull: string | null;
  readonly decisionReason: string;
}
/** Independent GM projection: it cannot inherit a player scope, device, or controller seat. */
export interface Net017Projection extends NetworkGmRequestDraftValues {
  readonly selectedAdmissionOrNull: Readonly<{ published: boolean; hasProposed: boolean }> | null;
  readonly contextId: string;
  readonly campaignId: string;
  readonly stateRevision: number;
  readonly projectionRevision: number;
  readonly requestQueueRevision: number;
  readonly requests: readonly NetworkGmRequestQueueRow[];
  readonly activePlayerCapacity: 1 | 2 | 3 | 4 | 5;
  readonly occupiedActivePcCount: number;
  readonly commandId: string | null;
  readonly returnContext: NetworkGmRequestReturnContext;
}
export interface NetworkGmAcceptToReviewPayload extends JsonObject {
  readonly campaignId: string;
  readonly requestId: string;
  readonly requestRevision: number;
}
export interface NetworkGmRejectRequestPayload extends NetworkGmAcceptToReviewPayload {
  readonly reason: string;
}
interface NetworkGmRequestDecisionReceiptBase extends JsonObject {
  readonly receiptId: string;
  readonly commandId: string;
  readonly workflowCommandId: NetworkGmRequestReviewWorkflowId;
  readonly campaignId: string;
  readonly requestId: string;
  readonly requestOwnerDeviceId: string;
  readonly beforeRequestRevision: number;
  readonly requestRevision: number;
  /** One to three exact submitted export byte digests, in immutable batch order. */
  readonly candidateSnapshotChecksums: readonly string[];
  readonly authoritativeGmActorId: string;
  readonly timestamp: string;
}
export type NetworkGmRequestDecisionReceipt =
  | (NetworkGmRequestDecisionReceiptBase & {
      readonly workflowCommandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW';
      readonly beforeRequestStatus: 'PENDING';
      readonly afterRequestStatus: 'IN_REVIEW';
      readonly decisionReasonOrNull: null;
    })
  | (NetworkGmRequestDecisionReceiptBase & {
      readonly workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT';
      readonly beforeRequestStatus: 'PENDING' | 'IN_REVIEW';
      readonly afterRequestStatus: 'REJECTED';
      readonly decisionReasonOrNull: string;
    });

export interface NetworkPublicProvenance extends JsonObject {
  readonly registryVersion: string;
  readonly catalogVersion: string;
  readonly builtAgainstTuple: string;
  readonly sourceUuid: string;
  readonly sourceSnapshotId: string;
  readonly metadataRevision: number;
  readonly sourceChecksum: string;
  readonly finalSaveReceiptId: string;
  readonly finalSnapshotVersion: number;
}
export interface Chr027Projection extends NetworkReadCommon {
  readonly localCharacterUuid: string;
  readonly finalSnapshotVersion: number;
  readonly candidateSnapshotChecksum: string;
  readonly eligibleCampaignIds: readonly string[];
  readonly selectedCampaignId: string | null;
  readonly requestedControllerSeat: string | null;
  readonly sourceUuidAndProvenance: NetworkPublicProvenance;
  readonly submissionStatus: 'DRAFT' | 'SUBMITTED';
  readonly commandId: string | null;
}
export type NetworkPublicErrorCode =
  | 'INVALID_ADDRESS'
  | 'CAMPAIGN_UNAVAILABLE'
  | 'AMBIGUOUS_CAMPAIGN'
  | 'INCOMPATIBLE_BASELINE'
  | 'HOST_IDENTITY_CHANGED'
  | 'PEER_UNAVAILABLE'
  | 'UNCONFIRMED_OUTCOME';
export interface Net011Projection extends NetworkReadCommon {
  readonly attemptId: string;
  readonly retryAttemptIdOrNull: string | null;
  readonly activeRole: 'PLAYER';
  readonly activeSeatOrGm: string;
  readonly lastAddressOrQrPayload: string;
  readonly lastParsedHostPort: NetworkHostLocator | null;
  readonly errorCode: NetworkPublicErrorCode;
  readonly humanDiagnostic: string;
  readonly retryCount: number;
  readonly connectionState: 'UNAVAILABLE';
  readonly lastConfirmedStateRevision: number;
  readonly lastConfirmedProjectionRevision: number;
  readonly resumeContextOrNull: null;
  readonly localDataUntouched: true;
  readonly commandId: string | null;
}
export type NetworkApplicationProjection =
  | Net001Projection
  | Net002Projection
  | Net003Projection
  | Net004Projection
  | Net005Projection
  | Net011Projection
  | Chr027Projection;

export interface NetworkCommandPayload extends JsonObject {
  readonly networkScopeId: string;
  readonly contextId: string;
  readonly expectedDraftRevision: number;
}
export interface NetworkOpenPayload extends NetworkCommandPayload {
  readonly attemptId: string;
  readonly addressOrQrPayload: string;
  readonly selectedCampaignIdOrNull: string | null;
}
export interface NetworkSubmitPayload extends NetworkCommandPayload {
  readonly requestId: string;
  readonly technicalSessionId: string;
  readonly connectionRevision: number;
  readonly selectedCandidates: readonly PublicCandidateRef[];
}
export interface NetworkCancelPayload extends NetworkCommandPayload {
  readonly requestId: string;
  readonly technicalSessionId: string;
  readonly requestRevision: number;
  readonly reason: string;
}
export type NetworkWorkflowRequest =
  | WorkflowCommandRequestMessage<'UI-CMD-CONNECTION-OPEN', NetworkOpenPayload>
  | WorkflowCommandRequestMessage<'UI-CMD-DEVICE-REQUEST-SUBMIT', NetworkSubmitPayload>
  | WorkflowCommandRequestMessage<'UI-CMD-DEVICE-REQUEST-CANCEL', NetworkCancelPayload>;

export interface NetworkCommandResult extends JsonObject {
  readonly operation: 'OPEN' | 'SUBMIT' | 'CANCEL';
  readonly networkScopeId: string;
  readonly remoteReceiptId: string;
  readonly technicalSessionId: string;
  readonly attemptIdOrNull: string | null;
  readonly requestIdOrNull: string | null;
  readonly requestRevisionOrNull: number | null;
  readonly outcome: 'CONNECTED_TECHNICAL' | 'PENDING' | 'CANCELLED';
}

export interface NetworkDraftResultV3Message {
  readonly messageType: 'network.draft.result';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly scope: NetworkDraftScope;
  readonly changed: boolean;
  readonly appliedDraftRevision: number;
  readonly appliedRevisions: RevisionVector;
  readonly draftRevision: number;
  readonly revisions: RevisionVector;
  readonly projectionRole: 'player';
  readonly presentation: { readonly base: PresentedBaseForm; readonly layers: readonly [] };
}
export type NetworkDraftRefusal =
  | {
      readonly code: 'INVALID_FIELD';
      readonly field: 'address' | 'selection' | 'campaign' | 'seat' | 'reason';
    }
  | { readonly code: 'STALE_DRAFT'; readonly expected: number; readonly actual: number }
  | {
      readonly code: 'STALE_REVISION';
      readonly expected: RevisionVector;
      readonly actual: RevisionVector;
    }
  | { readonly code: 'IDEMPOTENCY_CONFLICT' }
  | { readonly code: 'DRAFT_UNAVAILABLE' }
  | { readonly code: 'UNRESOLVED_COMMAND' }
  | { readonly code: 'REVISION_OVERFLOW' };
export interface NetworkDraftRefusalV3Message {
  readonly messageType: 'network.draft.refusal';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly scope: NetworkDraftScope;
  readonly revisions: RevisionVector;
  readonly presentationUnchanged: true;
  readonly refusal: NetworkDraftRefusal;
}
export type NetworkHostV3Message = NetworkDraftResultV3Message | NetworkDraftRefusalV3Message;
export type NetworkSupportedWorkflows = readonly NetworkWorkflowCommandId[];

/** A distinct GM draft family; player network scope and lane fields are not applicable. */
export interface NetworkGmRequestDraftScope {
  readonly gmLocalContextId: string;
  readonly campaignId: string;
  readonly sourceFormId: 'NET-017';
}
export interface NetworkGmRequestDraftReplaceV3Message {
  readonly messageType: 'network.gm-request-draft.replace';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly scope: NetworkGmRequestDraftScope;
  readonly expectedRevisions: RevisionVector;
  readonly expectedRequestQueueRevision: number;
  readonly values: NetworkGmRequestDraftValues;
}
export interface NetworkGmRequestDraftResultV3Message {
  readonly messageType: 'network.gm-request-draft.result';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly scope: NetworkGmRequestDraftScope;
  readonly changed: boolean;
  readonly appliedRevisions: RevisionVector;
  readonly appliedRequestQueueRevision: number;
  readonly revisions: RevisionVector;
  readonly requestQueueRevision: number;
  readonly projectionRole: 'gm';
  readonly presentation: {
    readonly base: PresentedBaseForm;
    readonly layers: readonly PresentedLayerForm[];
  };
}
export type NetworkGmRequestDraftRefusal =
  | {
      readonly code: 'INVALID_FIELD';
      readonly field: 'selectedRequestIdOrNull' | 'decisionReason';
      readonly reason: 'INVALID_VALUE';
    }
  | {
      readonly code: 'STALE_REVISION';
      readonly expected: RevisionVector;
      readonly actual: RevisionVector;
    }
  | { readonly code: 'STALE_QUEUE'; readonly expected: number; readonly actual: number }
  | { readonly code: 'IDEMPOTENCY_CONFLICT' }
  | { readonly code: 'DRAFT_UNAVAILABLE' }
  | { readonly code: 'REVISION_OVERFLOW' };
export interface NetworkGmRequestDraftRefusalV3Message {
  readonly messageType: 'network.gm-request-draft.refusal';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly scope: NetworkGmRequestDraftScope;
  readonly revisions: RevisionVector;
  readonly presentationUnchanged: true;
  readonly refusal: NetworkGmRequestDraftRefusal;
}
export type NetworkGmClientV3Message = NetworkGmRequestDraftReplaceV3Message;
export type NetworkGmHostV3Message =
  NetworkGmRequestDraftResultV3Message | NetworkGmRequestDraftRefusalV3Message;
