import type {
  JsonObject,
  RevisionVector,
  WorkflowCommandCapabilityId,
  WorkflowCommandRequestMessage,
} from './wire-protocol.js';
import type { PresentedBaseForm } from './wire-v2-protocol.js';

export const CAMPAIGN_CREATE_COMMAND_ID = 'UI-CMD-CAMPAIGN-CREATE' as const;
/** Public discovery locator, ADR 0064; it grants no campaign authority. */
export function campaignQrPayload(
  hostAddress: string,
  hostPort: number,
  campaignId: string,
): string {
  const invalid = (): never => {
    throw new TypeError('Invalid campaign locator');
  };
  if (
    !Number.isSafeInteger(hostPort) ||
    hostPort < 1 ||
    hostPort > 65535 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(campaignId) ||
    !/^[0-9a-fA-F:.]+$/u.test(hostAddress)
  )
    return invalid();
  if (
    !hostAddress.includes(':') &&
    (!/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/u.test(hostAddress) ||
      hostAddress.split('.').some((v) => Number(v) > 255))
  )
    return invalid();
  try {
    const url = new URL(
      `http://${hostAddress.includes(':') ? `[${hostAddress}]` : hostAddress}:${String(hostPort)}/`,
    );
    if (url.hostname === '0.0.0.0' || url.hostname === '[::]') return invalid();
    url.searchParams.set('campaignId', campaignId);
    return url.href;
  } catch {
    return invalid();
  }
}
export type CampaignDraftFormId = 'CMP-001' | 'CMP-002' | 'CMP-003' | 'CMP-004' | 'CMP-005';
export type CampaignEditableFormId = Exclude<CampaignDraftFormId, 'CMP-005'>;
export type CampaignCreationFormId = 'APP-011' | CampaignDraftFormId | 'CMP-006';
export interface CampaignArtValue extends JsonObject {
  readonly kind: 'local-file';
  readonly mediaType: 'image/png' | 'image/jpeg';
  readonly bytesBase64: string;
}
export interface CampaignMetadataValues extends JsonObject {
  readonly title: string | null;
  readonly description: string | null;
  readonly art: CampaignArtValue | null;
}
export interface CampaignHostValues extends JsonObject {
  readonly activePlayerCapacity: number | null;
  readonly hostAddress: string | null;
  readonly hostPort: number | null;
  readonly networkInterface: string | null;
}
export type CampaignFutureRollMode = 'MANUAL' | 'AUTO';
export interface CampaignPublicDraftValues extends JsonObject {
  readonly metadata: CampaignMetadataValues;
  readonly host: CampaignHostValues;
  readonly defaultFutureRollMode: CampaignFutureRollMode | null;
}
export interface CampaignDraftScope {
  readonly gmLocalContextId: string;
  readonly campaignDraftId: string;
  readonly sourceFormId: CampaignEditableFormId;
}
interface CampaignDraftReplaceBase {
  readonly messageType: 'campaign.draft.replace';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly expectedDraftRevision: number;
  readonly expectedRevisions: RevisionVector;
}
export type CampaignDraftReplaceV3Message = CampaignDraftReplaceBase &
  (
    | {
        readonly variant: 'METADATA';
        readonly scope: CampaignDraftScope & { readonly sourceFormId: 'CMP-001' };
        readonly values: CampaignMetadataValues;
      }
    | {
        readonly variant: 'HOST';
        readonly scope: CampaignDraftScope & { readonly sourceFormId: 'CMP-002' };
        readonly values: CampaignHostValues;
      }
    | {
        readonly variant: 'SECRET';
        readonly scope: CampaignDraftScope & { readonly sourceFormId: 'CMP-003' };
        readonly values: {
          readonly masterTransferPassword: string;
          readonly masterTransferPasswordConfirmation: string;
        };
      }
    | {
        readonly variant: 'MODE';
        readonly scope: CampaignDraftScope & { readonly sourceFormId: 'CMP-004' };
        readonly values: { readonly defaultFutureRollMode: CampaignFutureRollMode | null };
      }
  );
export interface CampaignLocalContextResumeV3Message {
  readonly messageType: 'campaign.local-context.resume';
  readonly protocolVersion: 3;
  readonly gmLocalContextId: string;
  readonly reconnectRequestId: string;
  readonly knownRevisions: RevisionVector;
  readonly supportedWorkflowCommandIds: readonly WorkflowCommandCapabilityId[];
  readonly unacknowledgedCommandIds: readonly string[];
}
export interface CampaignDraftResultV3Message {
  readonly messageType: 'campaign.draft.result';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly scope: CampaignDraftScope;
  /** Immutable event facts remain stable when a later view is returned on replay. */
  readonly changed: boolean;
  readonly appliedDraftRevision: number;
  readonly appliedRevisions: RevisionVector;
  readonly draftRevision: number;
  readonly revisions: RevisionVector;
  readonly projectionRole: 'gm';
  readonly presentation: { readonly base: PresentedBaseForm; readonly layers: readonly [] };
}
export type CampaignDraftField =
  | 'title'
  | 'description'
  | 'art'
  | 'activePlayerCapacity'
  | 'hostAddress'
  | 'hostPort'
  | 'networkInterface'
  | 'masterTransferPassword'
  | 'masterTransferPasswordConfirmation'
  | 'defaultFutureRollMode';
export interface CampaignFieldError extends JsonObject {
  readonly field: CampaignDraftField;
  readonly reason:
    | 'REQUIRED'
    | 'INVALID_TYPE'
    | 'INVALID_VALUE'
    | 'INVALID_LENGTH'
    | 'DISALLOWED_CHARACTERS'
    | 'CONFIRMATION_MISMATCH'
    | 'UNSUPPORTED_INTERFACE'
    | 'INVALID_IMAGE';
}
export type CampaignDraftRefusal =
  | { readonly code: 'INVALID_FIELD'; readonly error: CampaignFieldError }
  | { readonly code: 'STALE_DRAFT'; readonly expected: number; readonly actual: number }
  | {
      readonly code: 'STALE_REVISION';
      readonly expected: RevisionVector;
      readonly actual: RevisionVector;
    }
  | { readonly code: 'IDEMPOTENCY_CONFLICT' }
  | { readonly code: 'DRAFT_UNAVAILABLE' }
  | { readonly code: 'REVISION_OVERFLOW' };
export interface CampaignDraftRefusalV3Message {
  readonly messageType: 'campaign.draft.refusal';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly scope: CampaignDraftScope;
  readonly revisions: RevisionVector;
  readonly presentationUnchanged: true;
  readonly refusal: CampaignDraftRefusal;
}
export interface CampaignGmReadCommon extends JsonObject {
  readonly gmLocalContextId: string;
  readonly hostDeviceId: string;
  readonly masterAuthorityRevision: number;
}
export interface App011CampaignProjection extends CampaignGmReadCommon {
  readonly campaignLibraryState: JsonObject & {
    readonly status: 'NO_CAMPAIGNS' | 'DRAFT_AVAILABLE' | 'HOST_RECOVERABLE';
    readonly draftCount: number;
    readonly pausedCampaignCount: number;
  };
  readonly masterAuthorityState: JsonObject & {
    readonly status: 'CONFIRMED_LOCAL';
    readonly masterProfileId: string;
    readonly revision: number;
  };
}
export interface CampaignDraftReadCommon extends CampaignGmReadCommon {
  readonly routeIdentityKind: 'CAMPAIGN_DRAFT';
  readonly campaignDraftId: string;
  readonly draftRevision: number;
}
export interface Cmp001Projection extends CampaignDraftReadCommon {
  readonly title: string | null;
  readonly description: string | null;
  readonly artFilePickerState: JsonObject & {
    readonly status: 'EMPTY' | 'SELECTED';
    readonly value: CampaignArtValue | null;
  };
  readonly artAssetChecksumOrNull: string | null;
}
export interface CampaignNetworkInterface extends JsonObject {
  readonly networkInterface: string;
  readonly hostAddress: string;
  readonly family: 'IPv4' | 'IPv6';
}
export interface Cmp002Projection extends CampaignDraftReadCommon, CampaignHostValues {
  readonly availableNetworkInterfaces: readonly CampaignNetworkInterface[];
}
export interface Cmp003Projection extends CampaignDraftReadCommon {
  readonly masterSecretConfigured: boolean;
  readonly passwordStrengthLocal: JsonObject & {
    readonly minimumCodePoints: 12;
    readonly maximumCodePoints: 128;
    readonly status: 'NOT_CONFIGURED' | 'CONFIGURED';
  };
  readonly secretPersistencePolicy: 'VERIFIER_ONLY_CLEAR_AFTER_SAVE';
}
export interface Cmp004Projection extends CampaignDraftReadCommon {
  readonly defaultFutureRollMode: CampaignFutureRollMode | null;
  readonly openRollRequestsUnaffected: true;
}
export interface CampaignBindPreflight extends JsonObject {
  readonly status: 'NOT_CHECKED' | 'PASS' | 'FAIL';
  readonly leaseIdOrNull: string | null;
  readonly reasonCode:
    null | 'INVALID_INTERFACE' | 'PORT_UNAVAILABLE' | 'BIND_FAILED' | 'LEASE_EXPIRED';
}
export interface Cmp005Projection extends CampaignDraftReadCommon {
  readonly fullDraftSummary: CampaignPublicDraftValues & {
    readonly masterSecretConfigured: boolean;
    readonly artAssetChecksumOrNull: string | null;
  };
  readonly baselineVersion: string;
  readonly catalogCompatibility: JsonObject & {
    readonly status: 'PASS' | 'FAIL';
    readonly registryVersion: string;
    readonly catalogVersion: string;
    readonly builtAgainstTuple: string;
    readonly reasonCode: null | 'BASELINE_MISMATCH';
  };
  readonly hostBindPreflight: CampaignBindPreflight;
  readonly activePlayerCount: 0;
  readonly validationStatus: 'READY_TO_CREATE' | 'PREFLIGHT_BLOCKED';
  readonly commandId: string | null;
}
export interface Cmp006Projection extends CampaignGmReadCommon {
  readonly routeIdentityKind: 'CAMPAIGN';
  readonly campaignId: string;
  readonly sourceCampaignDraftId: string;
  readonly status: 'PAUSED';
  readonly createdAt: string;
  readonly hostAddress: string;
  readonly hostPort: number;
  readonly networkInterface: string;
  readonly qrPayload: string;
  readonly activePlayerCapacity: number;
  readonly creationReceiptId: string;
  readonly creationCommandId: string;
  readonly hostBindRecovery: JsonObject & {
    readonly status: 'RESERVED' | 'UNAVAILABLE';
    readonly reasonCode: null | 'PORT_UNAVAILABLE' | 'BIND_FAILED';
  };
}
export type CampaignCreationProjection =
  | App011CampaignProjection
  | Cmp001Projection
  | Cmp002Projection
  | Cmp003Projection
  | Cmp004Projection
  | Cmp005Projection
  | Cmp006Projection;
export interface CampaignCreatePayload extends JsonObject {
  readonly stage: 'CAMPAIGN_CREATE';
  readonly sourceFormId: 'CMP-005';
  readonly gmLocalContextId: string;
  readonly campaignDraftId: string;
  readonly draftRevision: number;
  readonly preflightLeaseId: string;
}
export type CampaignCreateRequest = WorkflowCommandRequestMessage<
  typeof CAMPAIGN_CREATE_COMMAND_ID,
  CampaignCreatePayload
>;
export interface CampaignCreateResult extends JsonObject {
  readonly stage: 'CAMPAIGN_CREATE';
  readonly gmLocalContextId: string;
  readonly campaignDraftId: string;
  readonly campaignId: string;
  readonly status: 'PAUSED';
  readonly createdAt: string;
  readonly creationReceiptId: string;
  readonly sourceDraftRevision: number;
  readonly sourceRevisions: RevisionVector & JsonObject;
  readonly targetRevisions: RevisionVector & JsonObject;
  readonly hostAddress: string;
  readonly hostPort: number;
  readonly networkInterface: string;
  readonly activePlayerCapacity: number;
  readonly defaultFutureRollMode: CampaignFutureRollMode;
  readonly qrPayload: string;
  readonly baselineVersion: string;
}
