import { wireCodecPrimitives } from './wire-codec.js';
import type {
  DecodeResult,
  JsonObject,
  RevisionVector,
  WorkflowCommandCapabilityId,
} from './wire-protocol.js';
import { POST_SAVE_COMMAND_IDS } from './local-character-post-save.js';

/** Player workflows only; GM request review has a separate capability vocabulary. */
export const NETWORK_WORKFLOW_COMMAND_IDS = Object.freeze([
  'UI-CMD-CONNECTION-OPEN',
  'UI-CMD-DEVICE-REQUEST-SUBMIT',
  'UI-CMD-DEVICE-REQUEST-CANCEL',
] as const);
export type NetworkWorkflowCommandId = (typeof NETWORK_WORKFLOW_COMMAND_IDS)[number];
/** Atlas 1.6 / ADR 0069. These identifiers never grant player capabilities. */
export const NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS = Object.freeze([
  'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
  'UI-CMD-DEVICE-REQUEST-REJECT',
] as const);
export type NetworkGmRequestReviewWorkflowId =
  (typeof NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS)[number];
/** Client implementation vocabulary across a local NET entry/exit; not a role or form grant. */
export const NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS = Object.freeze([
  ...NETWORK_WORKFLOW_COMMAND_IDS,
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  'UI-CMD-CHAR-CREATION-SET-DECIDE',
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  'UI-CMD-PLAYER-WEAPON-REQUEST-SUBMIT',
  ...Object.values(POST_SAVE_COMMAND_IDS),
] as const satisfies readonly WorkflowCommandCapabilityId[]);
export type NetworkEditableFormId = 'NET-002' | 'NET-003' | 'NET-005' | 'CHR-027';
export interface NetworkDraftScope {
  readonly networkScopeId: string;
  readonly contextId: string;
  readonly sourceFormId: NetworkEditableFormId;
}

export interface PublicCandidateRef extends JsonObject {
  readonly sourceUuid: string;
  readonly finalSnapshotVersion: number;
  readonly metadataRevision: number;
  /** Immutable FINAL descriptor.sourceChecksum, not the private peer export digest. */
  readonly candidateSnapshotChecksum: string;
  /** The current input lane may be shared by all candidates in this batch. */
  readonly requestedControllerSeat: string;
}
export interface PublicFinalCandidateSummary extends PublicCandidateRef {
  readonly name: string;
  readonly sourceSnapshotId: string;
}
export interface CapacityForecast extends JsonObject {
  readonly campaignRevision: number;
  /** CMP-002: configured active player capacity is one to five. */
  readonly activePlayerCapacity: 1 | 2 | 3 | 4 | 5;
  /** Counts only literal ACTIVE PCs; admitted or pending candidates are not this count. */
  readonly activePcCount: number;
  readonly selectedCandidateCount: 0 | 1 | 2 | 3;
  readonly fitsCurrentCapacity: boolean;
}

interface NetworkDraftReplaceBase {
  readonly messageType: 'network.draft.replace';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly expectedDraftRevision: number;
  readonly expectedRevisions: RevisionVector;
}
export type NetworkDraftReplaceV3Message = NetworkDraftReplaceBase &
  (
    | {
        readonly variant: 'ADDRESS';
        readonly scope: NetworkDraftScope & { readonly sourceFormId: 'NET-002' };
        readonly values: { readonly addressOrQrPayload: string };
      }
    | {
        readonly variant: 'SELECTION';
        readonly scope: NetworkDraftScope & { readonly sourceFormId: 'NET-003' };
        readonly values: { readonly selectedCandidates: readonly PublicCandidateRef[] };
      }
    | {
        readonly variant: 'CANCEL_REASON';
        readonly scope: NetworkDraftScope & { readonly sourceFormId: 'NET-005' };
        readonly values: { readonly cancelReason: string };
      }
    | {
        readonly variant: 'SINGLE_CANDIDATE';
        readonly scope: NetworkDraftScope & { readonly sourceFormId: 'CHR-027' };
        readonly values: {
          readonly selectedCampaignId: string | null;
          readonly requestedControllerSeat: string | null;
        };
      }
  );
export interface NetworkLocalContextResumeV3Message {
  readonly messageType: 'network.local-context.resume';
  readonly protocolVersion: 3;
  readonly networkScopeId: string;
  readonly reconnectRequestId: string;
  readonly knownRevisions: RevisionVector;
  readonly supportedWorkflowCommandIds: readonly WorkflowCommandCapabilityId[];
  readonly unacknowledgedCommandIds: readonly string[];
}
export type NetworkClientV3Message =
  NetworkDraftReplaceV3Message | NetworkLocalContextResumeV3Message;

const {
  abortInvalid: invalid,
  abortUnrecognized: unrecognized,
  parse,
  record,
  revision,
  string: identifier,
} = wireCodecPrimitives;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CHECKSUM = /^[0-9a-f]{64}$/u;

function exact(value: unknown, fields: string, path = '$'): Record<string, unknown> {
  const object = record(value, path);
  const keys = fields.split(' ');
  for (const key of keys) {
    if (!Object.hasOwn(object, key)) invalid(`${path}.${key}`, 'required field', undefined);
  }
  // Even an unknown property name can contain private input; report its parent only.
  if (Object.keys(object).some((key) => !keys.includes(key))) unrecognized(path, null);
  return object;
}
function uuid(value: unknown, path: string): string {
  const text = identifier(value, path);
  return UUID_V4.test(text) ? text : invalid(path, 'canonical lowercase UUID v4', value);
}
const integer = (value: unknown, path: string): number => revision(value, path) + 0;
function vector(value: unknown, path: string): RevisionVector {
  const object = exact(value, 'stateRevision projectionRevision actorVisibilityRevision', path);
  return {
    stateRevision: integer(object['stateRevision'], `${path}.stateRevision`),
    projectionRevision: integer(object['projectionRevision'], `${path}.projectionRevision`),
    actorVisibilityRevision: integer(
      object['actorVisibilityRevision'],
      `${path}.actorVisibilityRevision`,
    ),
  };
}
function list(value: unknown, path: string): readonly unknown[] {
  return Array.isArray(value) ? value : invalid(path, 'array', value);
}
function unique<T extends string>(items: readonly T[], path: string): readonly T[] {
  return new Set(items).size === items.length ? items : invalid(path, 'unique entries', items);
}
function candidate(value: unknown, path: string): PublicCandidateRef {
  const object = exact(
    value,
    'sourceUuid finalSnapshotVersion metadataRevision candidateSnapshotChecksum requestedControllerSeat',
    path,
  );
  const checksum = identifier(
    object['candidateSnapshotChecksum'],
    `${path}.candidateSnapshotChecksum`,
  );
  if (!CHECKSUM.test(checksum))
    invalid(`${path}.candidateSnapshotChecksum`, 'canonical lowercase SHA-256', checksum);
  return {
    sourceUuid: identifier(object['sourceUuid'], `${path}.sourceUuid`),
    finalSnapshotVersion: integer(object['finalSnapshotVersion'], `${path}.finalSnapshotVersion`),
    metadataRevision: integer(object['metadataRevision'], `${path}.metadataRevision`),
    candidateSnapshotChecksum: checksum,
    requestedControllerSeat: uuid(
      object['requestedControllerSeat'],
      `${path}.requestedControllerSeat`,
    ),
  };
}
function selection(value: unknown): readonly PublicCandidateRef[] {
  const path = '$.values.selectedCandidates';
  const entries = list(value, path);
  // NET-003/004 and J-JOIN-REVIEW SELECT_PROPOSE allow at most three candidates.
  // Empty editable selection is valid; the later SUBMIT guard requires at least one.
  if (entries.length > 3) invalid(path, 'zero to three draft candidates', entries);
  const candidates = entries.map((entry, index) => candidate(entry, `${path}[${String(index)}]`));
  unique(
    candidates.map((entry) => entry.sourceUuid),
    path,
  );
  return candidates;
}
function workflow(value: unknown, path: string): WorkflowCommandCapabilityId {
  const id = identifier(value, path);
  const known = NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS.find((item) => item === id);
  return known === undefined ? unrecognized(path, null) : known;
}
function resume(value: unknown): NetworkLocalContextResumeV3Message {
  const object = exact(
    value,
    'messageType protocolVersion networkScopeId reconnectRequestId knownRevisions supportedWorkflowCommandIds unacknowledgedCommandIds',
  );
  return {
    messageType: 'network.local-context.resume',
    protocolVersion: 3,
    networkScopeId: uuid(object['networkScopeId'], '$.networkScopeId'),
    reconnectRequestId: identifier(object['reconnectRequestId'], '$.reconnectRequestId'),
    knownRevisions: vector(object['knownRevisions'], '$.knownRevisions'),
    supportedWorkflowCommandIds: unique(
      list(object['supportedWorkflowCommandIds'], '$.supportedWorkflowCommandIds').map(
        (item, index) => workflow(item, `$.supportedWorkflowCommandIds[${String(index)}]`),
      ),
      '$.supportedWorkflowCommandIds',
    ),
    unacknowledgedCommandIds: unique(
      list(object['unacknowledgedCommandIds'], '$.unacknowledgedCommandIds').map((item, index) =>
        identifier(item, `$.unacknowledgedCommandIds[${String(index)}]`),
      ),
      '$.unacknowledgedCommandIds',
    ),
  };
}
export function networkClientValue(value: unknown): NetworkClientV3Message {
  const envelope = record(value, '$');
  if (envelope['protocolVersion'] !== 3) unrecognized('$.protocolVersion', null);
  if (envelope['messageType'] === 'network.local-context.resume') return resume(value);
  if (envelope['messageType'] !== 'network.draft.replace') unrecognized('$.messageType', null);
  const object = exact(
    value,
    'messageType protocolVersion draftUpdateId expectedDraftRevision expectedRevisions variant scope values',
  );
  const scope = exact(object['scope'], 'networkScopeId contextId sourceFormId', '$.scope');
  const assignedScope = {
    networkScopeId: uuid(scope['networkScopeId'], '$.scope.networkScopeId'),
    contextId: uuid(scope['contextId'], '$.scope.contextId'),
  };
  const common = {
    messageType: 'network.draft.replace' as const,
    protocolVersion: 3 as const,
    draftUpdateId: identifier(object['draftUpdateId'], '$.draftUpdateId'),
    expectedDraftRevision: integer(object['expectedDraftRevision'], '$.expectedDraftRevision'),
    expectedRevisions: vector(object['expectedRevisions'], '$.expectedRevisions'),
  };
  switch (object['variant']) {
    case 'ADDRESS': {
      if (scope['sourceFormId'] !== 'NET-002') unrecognized('$.scope.sourceFormId', null);
      const values = exact(object['values'], 'addressOrQrPayload', '$.values');
      const address = values['addressOrQrPayload'];
      if (typeof address !== 'string')
        return invalid('$.values.addressOrQrPayload', 'string', address);
      return {
        ...common,
        variant: 'ADDRESS',
        scope: { ...assignedScope, sourceFormId: 'NET-002' },
        values: { addressOrQrPayload: address },
      };
    }
    case 'SELECTION': {
      if (scope['sourceFormId'] !== 'NET-003') unrecognized('$.scope.sourceFormId', null);
      const values = exact(object['values'], 'selectedCandidates', '$.values');
      return {
        ...common,
        variant: 'SELECTION',
        scope: { ...assignedScope, sourceFormId: 'NET-003' },
        values: { selectedCandidates: selection(values['selectedCandidates']) },
      };
    }
    case 'SINGLE_CANDIDATE': {
      if (scope['sourceFormId'] !== 'CHR-027') unrecognized('$.scope.sourceFormId', null);
      const values = exact(
        object['values'],
        'selectedCampaignId requestedControllerSeat',
        '$.values',
      );
      return {
        ...common,
        variant: 'SINGLE_CANDIDATE',
        scope: { ...assignedScope, sourceFormId: 'CHR-027' },
        values: {
          selectedCampaignId:
            values['selectedCampaignId'] === null
              ? null
              : uuid(values['selectedCampaignId'], '$.values.selectedCampaignId'),
          requestedControllerSeat:
            values['requestedControllerSeat'] === null
              ? null
              : uuid(values['requestedControllerSeat'], '$.values.requestedControllerSeat'),
        },
      };
    }
    case 'CANCEL_REASON': {
      if (scope['sourceFormId'] !== 'NET-005') unrecognized('$.scope.sourceFormId', null);
      const values = exact(object['values'], 'cancelReason', '$.values');
      if (typeof values['cancelReason'] !== 'string')
        return invalid('$.values.cancelReason', 'string', null);
      return {
        ...common,
        variant: 'CANCEL_REASON',
        scope: { ...assignedScope, sourceFormId: 'NET-005' },
        values: { cancelReason: values['cancelReason'] },
      };
    }
    default:
      return unrecognized('$.variant', null);
  }
}

/** Syntax only: ownership, assigned lane, eligibility and SUBMIT remain host guards. */
export function decodeNetworkClientMessageV3(source: string): DecodeResult<NetworkClientV3Message> {
  // JSON.parse otherwise coerces non-string inputs and may invoke attacker-controlled getters.
  if (typeof source !== 'string')
    return {
      ok: false,
      refusal: {
        code: 'INVALID_SHAPE',
        path: '$',
        expected: 'JSON string',
        actualType: source === null ? 'null' : Array.isArray(source) ? 'array' : typeof source,
      },
    };
  return parse(source, networkClientValue);
}
