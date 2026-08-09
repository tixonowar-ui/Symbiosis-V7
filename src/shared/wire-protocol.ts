import type {
  AtlasRole,
  FormId,
  GuardState,
  QaScenarioId,
  TransitionKind,
} from '@generated/types/atlas.js';

export type { AtlasRole, GuardState } from '@generated/types/atlas.js';

export const WIRE_PROTOCOL_VERSION = 1 as const;

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

type StripWorkflowQaPrefix<T extends string> =
  T extends `QA-WORKFLOW-${infer CommandId extends `UI-CMD-${string}`}` ? CommandId : never;

/** The current 106 UI command IDs, derived from the generated atlas type. */
export type WorkflowCommandId = StripWorkflowQaPrefix<QaScenarioId>;
export type WorkflowCommandCapabilityId = `UI-CMD-${string}`;
export type CommandKind = Extract<TransitionKind, `${string}-command`>;
export type HostReadCommandKind = Extract<
  CommandKind,
  'local-or-read-command' | 'read-only-command'
>;
export type HostMutationCommandKind = Extract<
  CommandKind,
  'operation-command' | 'workflow-command'
>;

export const COMMAND_KIND_ROUTE = {
  'local-command': 'CLIENT_LOCAL',
  'local-draft-command': 'CLIENT_LOCAL',
  'local-or-read-command': 'CLIENT_LOCAL_OR_HOST_READ',
  'operation-command': 'HOST_MUTATION',
  'read-only-command': 'HOST_READ',
  'workflow-command': 'HOST_MUTATION',
} as const satisfies Readonly<Record<CommandKind, string>>;

export const ATLAS_ROLES = ['gm', 'player', 'system'] as const satisfies readonly AtlasRole[];
export type InteractiveRole = Exclude<AtlasRole, 'system'>;
export const GUARD_STATES = [
  'actorVisibilityRevision',
  'authority',
  'connection',
  'consent/masterPredicate',
  'controllerSeat',
  'projectionRevision',
  'resource/effect/equipment',
  'role',
  'scene/phase',
  'stateRevision',
] as const satisfies readonly GuardState[];

export const COMMAND_LIFECYCLE_STATES = [
  'DECLARED',
  'PENDING_CONSENT',
  'REVALIDATING',
  'COMMITTED',
  'REJECTED_STALE',
  'IDEMPOTENT_REPLAY',
] as const;
export type CommandLifecycleState = (typeof COMMAND_LIFECYCLE_STATES)[number];

export const MASTER_PREDICATE_STATES = [
  'PENDING_PREDICATE',
  'YES_RECORDED',
  'NO_RECORDED',
  'UNKNOWN_OR_CLOSED',
] as const;
export type MasterPredicateState = (typeof MASTER_PREDICATE_STATES)[number];
export type MasterPredicateDecision = 'NO' | 'YES';
export const MASTER_PREDICATE_RESPONSE_COMMAND_ID =
  'UI-CMD-MASTER-PREDICATE-RESPOND' as const satisfies WorkflowCommandId;
export const MASTER_PREDICATE_REQUIRED_FIELDS = [
  'predicateRequestId',
  'linkedActionRequestId',
  'predicateType',
  'requestingCharacterId',
  'predicateQuestion',
  'decision=YES|NO',
  'masterAuthorityRevision',
  'returnContext',
  'noReservation=true',
] as const;
export type MasterPredicateStatus =
  | { readonly decision: null; readonly predicateState: 'PENDING_PREDICATE' }
  | { readonly decision: 'YES'; readonly predicateState: 'YES_RECORDED' }
  | { readonly decision: 'NO'; readonly predicateState: 'NO_RECORDED' }
  | { readonly decision: null; readonly predicateState: 'UNKNOWN_OR_CLOSED' };

export interface RevisionVector {
  readonly actorVisibilityRevision: number;
  readonly projectionRevision: number;
  readonly stateRevision: number;
}

export interface AtlasTransitionReference<K extends CommandKind = CommandKind> {
  readonly from: FormId;
  readonly kind: K;
  readonly to: FormId;
  readonly trigger: string;
}

interface WireEnvelope<T extends string> {
  readonly messageType: T;
  readonly protocolVersion: typeof WIRE_PROTOCOL_VERSION;
}

interface MutationRequestMessage<
  TKind extends HostMutationCommandKind,
  TPayload extends object,
> extends WireEnvelope<'command.request'> {
  readonly commandId: string;
  readonly commandKind: TKind;
  readonly expectedRevisions: RevisionVector;
  readonly payload: TPayload;
  /** Claimed projection context only; the host revalidates session authority. */
  readonly role: InteractiveRole;
}

export type RegularWorkflowCommandId = Exclude<
  WorkflowCommandId,
  typeof MASTER_PREDICATE_RESPONSE_COMMAND_ID
>;
export interface WorkflowCommandRequestMessage<
  TCommand extends RegularWorkflowCommandId = RegularWorkflowCommandId,
  TPayload extends JsonObject = JsonObject,
> extends MutationRequestMessage<'workflow-command', TPayload> {
  readonly workflowCommandId: TCommand;
}

export interface MasterPredicateDecisionPayload {
  readonly decision: MasterPredicateDecision;
  readonly linkedActionRequestId: string;
  readonly masterAuthorityRevision: number;
  readonly noReservation: true;
  readonly predicateRequestId: string;
  /** Opaque server-issued return context; it grants no authority by itself. */
  readonly returnContext: JsonObject;
}

export interface MasterPredicateDecisionMessage extends MutationRequestMessage<
  'workflow-command',
  MasterPredicateDecisionPayload
> {
  readonly role: Extract<AtlasRole, 'gm'>;
  readonly workflowCommandId: Extract<
    WorkflowCommandId,
    typeof MASTER_PREDICATE_RESPONSE_COMMAND_ID
  >;
}

export interface OperationCommandRequestMessage extends MutationRequestMessage<
  'operation-command',
  JsonObject
> {
  readonly transition: AtlasTransitionReference<'operation-command'>;
}

export interface ReadRequestMessage extends WireEnvelope<'read.request'> {
  readonly commandKind: HostReadCommandKind;
  readonly knownRevisions: RevisionVector;
  readonly parameters: JsonObject;
  readonly requestId: string;
  readonly role: InteractiveRole;
  readonly transition: AtlasTransitionReference<HostReadCommandKind>;
}

export interface ProjectionReconnectMessage extends WireEnvelope<'projection.reconnect'> {
  readonly knownRevisions: RevisionVector;
  readonly projectionRole: InteractiveRole;
  readonly requestId: string;
  readonly supportedWorkflowCommandIds: readonly WorkflowCommandCapabilityId[];
  readonly unacknowledgedCommandIds: readonly string[];
}

export interface MasterPredicateRequestMessage extends WireEnvelope<'master-predicate.request'> {
  readonly audience: Extract<AtlasRole, 'gm'>;
  readonly commandState: Extract<CommandLifecycleState, 'PENDING_CONSENT'>;
  readonly guardState: Extract<GuardState, 'consent/masterPredicate'>;
  readonly linkedActionRequestId: string;
  readonly masterAuthorityRevision: number;
  readonly noReservation: true;
  readonly predicateQuestion: string;
  readonly predicateRequestId: string;
  readonly predicateState: Extract<MasterPredicateState, 'PENDING_PREDICATE'>;
  readonly predicateType: string;
  readonly requestingCharacterId: string;
  readonly returnContext: JsonObject;
  readonly revisions: RevisionVector;
}

export interface CommandPendingMessage extends WireEnvelope<'command.pending'> {
  readonly commandId: string;
  readonly lifecycleState: Extract<CommandLifecycleState, 'PENDING_CONSENT'>;
  readonly noReservation: true;
  readonly predicateRequestId: string;
  readonly predicateState: Extract<MasterPredicateState, 'PENDING_PREDICATE'>;
  readonly revisions: RevisionVector;
}

export interface CommandReceipt<TResult extends JsonObject = JsonObject> {
  readonly commandId: string;
  readonly receiptId: string;
  readonly result: TResult;
  readonly revisions: RevisionVector;
}

export interface CommandResultMessage extends WireEnvelope<'command.result'> {
  readonly lifecycleState: Extract<CommandLifecycleState, 'COMMITTED'>;
  readonly receipt: CommandReceipt;
}

export interface CommandReplayMessage extends WireEnvelope<'command.replay'> {
  /** The receipt value is unchanged; only the delivery state says this is a replay. */
  readonly lifecycleState: Extract<CommandLifecycleState, 'IDEMPOTENT_REPLAY'>;
  readonly receipt: CommandReceipt;
}

export type UnrecognizedRefusal = {
  readonly code: 'UNRECOGNIZED';
  readonly path: string;
  readonly value: JsonValue;
};

export type InvalidShapeRefusal = {
  readonly actualType: string;
  readonly code: 'INVALID_SHAPE';
  readonly expected: string;
  readonly path: string;
};

export type DecodeRefusal =
  | {
      readonly code: 'MALFORMED_JSON';
      readonly detail: string;
      readonly path: '$';
    }
  | InvalidShapeRefusal
  | UnrecognizedRefusal;

export type CommandRefusal =
  | InvalidShapeRefusal
  | UnrecognizedRefusal
  | {
      readonly code: 'GUARD_REJECTED';
    }
  | {
      readonly code: 'IDEMPOTENCY_CONFLICT';
      readonly commandId: string;
      readonly detail: 'PAYLOAD_MISMATCH';
    }
  | {
      readonly code: 'MASTER_PREDICATE_DENIED';
      readonly linkedActionRequestId: string;
      readonly noReservation: true;
      readonly predicateRequestId: string;
      readonly predicateState: Extract<MasterPredicateState, 'NO_RECORDED'>;
    }
  | {
      readonly actual: RevisionVector;
      readonly code: 'STALE_REVISION';
      readonly expected: RevisionVector;
    };

export interface CommandRefusalMessage extends WireEnvelope<'command.refusal'> {
  readonly commandId: string;
  readonly lastLifecycleState: Exclude<
    CommandLifecycleState,
    'COMMITTED' | 'IDEMPOTENT_REPLAY'
  > | null;
  readonly refusal: CommandRefusal;
  readonly revisions: RevisionVector;
}

export interface ReadResultMessage extends WireEnvelope<'read.result'> {
  readonly requestId: string;
  readonly result: JsonObject;
  readonly revisions: RevisionVector;
}

export interface ReadRefusalMessage extends WireEnvelope<'read.refusal'> {
  readonly refusal: InvalidShapeRefusal | UnrecognizedRefusal;
  readonly requestId: string;
  readonly revisions: RevisionVector;
}

export interface ProjectionSnapshotMessage extends WireEnvelope<'projection.snapshot'> {
  readonly executableWorkflowCommandIds: readonly WorkflowCommandId[];
  /** This payload is already role-filtered by the host and replaces client cache atomically. */
  readonly projection: JsonObject;
  readonly projectionRole: InteractiveRole;
  readonly requestId: string;
  readonly revisions: RevisionVector;
}

export interface ProtocolRefusalMessage extends WireEnvelope<'protocol.refusal'> {
  readonly refusal: DecodeRefusal;
  readonly relatedCommandId: string | null;
}

export type ClientToHostMessage =
  | MasterPredicateDecisionMessage
  | OperationCommandRequestMessage
  | ProjectionReconnectMessage
  | ProtocolRefusalMessage
  | ReadRequestMessage
  | WorkflowCommandRequestMessage;

export type HostToClientMessage =
  | CommandPendingMessage
  | CommandRefusalMessage
  | CommandReplayMessage
  | CommandResultMessage
  | MasterPredicateRequestMessage
  | ProjectionSnapshotMessage
  | ProtocolRefusalMessage
  | ReadRefusalMessage
  | ReadResultMessage;

export interface ProtocolVocabulary {
  isFormId(value: string): value is FormId;
  isHostTransition(
    value: AtlasTransitionReference<HostReadCommandKind | 'operation-command'>,
  ): boolean;
  isWorkflowCommandId(value: string): value is WorkflowCommandId;
}

export type DecodeResult<T> =
  | { readonly ok: false; readonly refusal: DecodeRefusal }
  | { readonly ok: true; readonly value: T };

export type EncodeResult =
  | { readonly ok: false; readonly refusal: DecodeRefusal }
  | { readonly ok: true; readonly text: string };
