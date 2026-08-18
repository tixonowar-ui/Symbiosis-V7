import type { ActionKey, FormId, FormType } from '@generated/types/atlas.js';

import type {
  InteractiveRole,
  JsonObject,
  RevisionVector,
  WorkflowCommandCapabilityId,
  WorkflowCommandId,
} from './wire-protocol.js';

export const WIRE_PROTOCOL_V2_VERSION = 2 as const;
declare const addressableRouteTemplate: unique symbol;
export type AddressableRouteTemplate = string & { readonly [addressableRouteTemplate]: true };

export interface ClientSelectedRouteBinding {
  readonly parameterIndex: number;
  readonly source: 'client-selected';
  readonly value: string;
}

export type AssignedRouteBindingSource = 'client-selected' | 'executor-allocated' | 'inherited';

export interface AssignedRouteBinding {
  readonly parameterIndex: number;
  readonly source: AssignedRouteBindingSource;
  readonly value: string;
}

interface PresentedFormFields {
  readonly availableActionKeys: readonly ActionKey[];
  readonly formId: FormId;
  readonly roleFilteredPayload: JsonObject;
  readonly routeBindings: readonly AssignedRouteBinding[];
  readonly routeTemplate: string;
}

export interface PresentedBaseForm extends PresentedFormFields {
  readonly formType: Extract<FormType, 'screen'>;
}

export interface PresentedLayerForm extends PresentedFormFields {
  readonly formType: Exclude<FormType, 'screen'>;
}

export type PresentationAssignmentReason =
  'ADDRESSABLE_ROUTE' | 'COMMAND_DESTINATION' | 'FORM_ACTION' | 'HOST_SYSTEM_EVENT' | 'RECONNECT';

export interface PresentationAssignment {
  readonly correlationId: string;
  readonly reason: PresentationAssignmentReason;
}

export interface AssignedPresentation {
  readonly assignment: PresentationAssignment;
  readonly base: PresentedBaseForm;
  readonly layers: readonly PresentedLayerForm[];
}

interface WireV2Envelope<T extends string> {
  readonly messageType: T;
  readonly protocolVersion: typeof WIRE_PROTOCOL_V2_VERSION;
}

export interface FormActionIntentV2Message extends WireV2Envelope<'navigation.form-action'> {
  readonly actionKey: ActionKey;
  readonly expectedProjectionRevision: number;
  readonly navigationRequestId: string;
  readonly sourceFormId: FormId;
}

export interface AddressableRouteIntentV2Message extends WireV2Envelope<'navigation.addressable-route'> {
  readonly bindings: readonly ClientSelectedRouteBinding[];
  readonly expectedProjectionRevision: number;
  readonly navigationRequestId: string;
  readonly routeTemplate: AddressableRouteTemplate;
}

export interface SessionReconnectV2Message extends WireV2Envelope<'session.reconnect'> {
  readonly deviceId: string;
  readonly knownRevisions: RevisionVector;
  readonly reconnectRequestId: string;
  readonly supportedWorkflowCommandIds: readonly WorkflowCommandCapabilityId[];
  readonly unacknowledgedCommandIds: readonly string[];
}

export interface IdentityDraftScope {
  readonly sourceFormId: 'CHR-001';
  readonly contextId: string;
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
}

export type IdentityDraftArtValue =
  | null
  | { readonly kind: 'asset-key'; readonly assetKey: string }
  | {
      readonly kind: 'local-file';
      readonly mediaType: 'image/jpeg' | 'image/png';
      readonly bytesBase64: string;
    };

export interface IdentityDraftValues {
  readonly name: string | null;
  readonly description: string | null;
  readonly artAssetKeyOrLocalFile: IdentityDraftArtValue;
  readonly age: number | null;
  readonly massKg: number | null;
}

export interface IdentityDraftReplaceV2Message extends WireV2Envelope<'character.identity-draft.replace'> {
  readonly draftUpdateId: string;
  readonly scope: IdentityDraftScope;
  readonly expectedDraftRevision: number;
  readonly expectedRevisions: RevisionVector;
  readonly values: IdentityDraftValues;
}

export interface IdentityDraftPresentation {
  readonly base: PresentedBaseForm;
  readonly layers: readonly PresentedLayerForm[];
}

export interface IdentityDraftResultV2Message extends WireV2Envelope<'character.identity-draft.result'> {
  readonly draftUpdateId: string;
  readonly scope: IdentityDraftScope;
  readonly draftRevision: number;
  readonly revisions: RevisionVector;
  readonly projectionRole: 'player';
  readonly presentation: IdentityDraftPresentation;
}

export type IdentityDraftFieldError =
  | {
      readonly field: 'name';
      readonly reason:
        | 'BLANK_AFTER_TRIM'
        | 'CONTROL_CHARACTER'
        | 'NO_VISIBLE_GRAPHEME'
        | 'TOO_LONG'
        | 'UNPAIRED_SURROGATE';
    }
  | { readonly field: 'description'; readonly reason: 'EMPTY_NOT_NULL' | 'TOO_LONG' }
  | {
      readonly field: 'artAssetKeyOrLocalFile';
      readonly reason:
        | 'ASSET_NOT_FOUND'
        | 'EMPTY_ASSET_KEY'
        | 'FILE_TOO_LARGE'
        | 'MEDIA_SIGNATURE_MISMATCH'
        | 'NON_CANONICAL_BASE64';
    }
  | { readonly field: 'massKg'; readonly reason: 'NOT_POSITIVE' | 'STEP_MISMATCH' };

export type IdentityDraftRefusal =
  | { readonly code: 'INVALID_FIELD'; readonly error: IdentityDraftFieldError }
  | { readonly code: 'STALE_DRAFT'; readonly expected: number; readonly actual: number }
  | {
      readonly code: 'STALE_REVISION';
      readonly expected: RevisionVector;
      readonly actual: RevisionVector;
    }
  | { readonly code: 'IDEMPOTENCY_CONFLICT'; readonly detail: 'PAYLOAD_MISMATCH' }
  | { readonly code: 'DRAFT_UNAVAILABLE' }
  | {
      readonly code: 'REVISION_OVERFLOW';
      readonly axis: 'draftRevision' | 'projectionRevision';
    };

export interface IdentityDraftRefusalV2Message extends WireV2Envelope<'character.identity-draft.refusal'> {
  readonly draftUpdateId: string;
  readonly scope: IdentityDraftScope;
  readonly revisions: RevisionVector;
  readonly presentationUnchanged: true;
  readonly refusal: IdentityDraftRefusal;
}

export type NavigationCommonRefusal =
  | {
      readonly actualProjectionRevision: number;
      readonly code: 'STALE_PROJECTION';
      readonly expectedProjectionRevision: number;
    }
  | { readonly code: 'IDEMPOTENCY_CONFLICT'; readonly detail: 'PAYLOAD_MISMATCH' }
  | { readonly code: 'NAVIGATION_UNAVAILABLE' };

export type FormActionRefusal = NavigationCommonRefusal;
export type AddressableRouteRefusal =
  NavigationCommonRefusal | { readonly code: 'INVALID_BINDINGS' };
interface NavigationRefusalV2Message<T extends string, TRefusal> extends WireV2Envelope<T> {
  readonly navigationRequestId: string;
  readonly presentationUnchanged: true;
  readonly refusal: TRefusal;
  readonly revisions: RevisionVector;
}

export type FormActionRefusalV2Message = NavigationRefusalV2Message<
  'navigation.form-action.refusal',
  FormActionRefusal
>;
export type AddressableRouteRefusalV2Message = NavigationRefusalV2Message<
  'navigation.addressable-route.refusal',
  AddressableRouteRefusal
>;

export interface ProjectionSnapshotV2Message extends WireV2Envelope<'projection.snapshot'> {
  readonly presentation: AssignedPresentation;
  readonly projectionRole: InteractiveRole | null;
  readonly revisions: RevisionVector;
}

export interface SessionReconnectCapabilitiesV2Message extends WireV2Envelope<'session.reconnect.capabilities'> {
  readonly executableWorkflowCommandIds: readonly WorkflowCommandId[];
  readonly reconnectRequestId: string;
  readonly revisions: RevisionVector;
}

export type ClientToHostV2Message =
  | AddressableRouteIntentV2Message
  | IdentityDraftReplaceV2Message
  | FormActionIntentV2Message
  | SessionReconnectV2Message;

export type HostToClientV2Message =
  | AddressableRouteRefusalV2Message
  | IdentityDraftRefusalV2Message
  | IdentityDraftResultV2Message
  | FormActionRefusalV2Message
  | ProjectionSnapshotV2Message
  | SessionReconnectCapabilitiesV2Message;

export interface WireV2Vocabulary {
  isAddressableRouteTemplate(value: string): value is AddressableRouteTemplate;
  isClientRouteBindings(
    routeTemplate: AddressableRouteTemplate,
    bindings: readonly ClientSelectedRouteBinding[],
  ): boolean;
  isPresentedForm(
    formId: FormId,
    formType: FormType,
    routeTemplate: string,
    bindings: readonly AssignedRouteBinding[],
  ): boolean;
  isFormActionKey(sourceFormId: FormId, value: string): value is ActionKey;
  isFormId(value: string): value is FormId;
  isWorkflowCommandId(value: string): value is WorkflowCommandId;
}
