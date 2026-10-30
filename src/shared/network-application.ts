import type {
  NetworkDraftScope,
  NetworkWorkflowCommandId,
  PublicCandidateRef,
  PublicFinalCandidateSummary,
  CapacityForecast,
} from './device-admission.js';
import type { JsonObject, RevisionVector, WorkflowCommandRequestMessage } from './wire-protocol.js';
import type { PresentedBaseForm } from './wire-v2-protocol.js';

/** Application surfaces of #171; later review/admission forms are deliberately separate. */
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
  /** Only the existing source literals. New preliminary GM states await #177. */
  readonly requestStatus: 'PENDING' | 'REJECTED' | 'PROPOSED';
  readonly gmMessage: string | null;
  readonly requestRevision: number;
  /** Own local input only; storing it never executes the separate cancellation command. */
  readonly cancelReason: string;
  readonly commandId: string | null;
}
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
