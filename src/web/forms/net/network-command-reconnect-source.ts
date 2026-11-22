import type { NetworkWorkflowRequest } from '@shared/network-application.js';
import { reconnectFingerprint } from '@shared/reconnect-fingerprint.js';
import type { JsonObject, RevisionVector, WorkflowCommandId } from '@shared/wire-protocol.js';
import { isNetworkApplicationForm, sameNetworkRevisions } from './network-application.js';

interface Snapshot {
  readonly formId: string;
  readonly revisions: RevisionVector;
  readonly projection: JsonObject;
}

const ABSENT_BINDING = [
  'networkScopeId',
  'deviceId',
  'controllerSeat',
  'campaignIdOrNull',
  'sessionId',
  'requestId',
];
const UNCONFIRMED_BINDING = ['networkScopeId', 'controllerSeat', 'draftRevision'];
const CANCEL_CONTENT = [
  ...ABSENT_BINDING,
  'draftRevision',
  'requestRevision',
  'requestOwnerDeviceId',
  'cancelReason',
  'gmMessage',
  'batchCharacterSummaries',
];

function fingerprintFields(projection: JsonObject, keys: readonly string[]) {
  // A missing session/request before OPEN is distinct from an explicit null in another form.
  return reconnectFingerprint(
    Object.fromEntries(
      keys.filter((key) => Object.hasOwn(projection, key)).map((key) => [key, projection[key]]),
    ),
  );
}

export function rememberNetworkCommandSource(
  source: Snapshot & { readonly executableWorkflowCommandIds: readonly WorkflowCommandId[] },
) {
  const { projection } = source;
  return {
    formId: source.formId,
    revisions: { ...source.revisions },
    executableWorkflowCommandIds: [...source.executableWorkflowCommandIds],
    scope: fingerprintFields(projection, ['networkScopeId']),
    absentBinding: fingerprintFields(projection, ABSENT_BINDING),
    unconfirmedBinding: fingerprintFields(projection, UNCONFIRMED_BINDING),
    // After socket replacement the host may assign a new context to otherwise identical bytes.
    contentWithoutContext: reconnectFingerprint({ ...projection, contextId: null }),
    cancel:
      source.formId === 'NET-005'
        ? {
            context: fingerprintFields(projection, ['contextId']),
            content: fingerprintFields(projection, CANCEL_CONTENT),
          }
        : null,
  };
}
export type NetworkCommandReconnectSource = ReturnType<typeof rememberNetworkCommandSource>;

function revisionsFollow(next: RevisionVector, source: RevisionVector) {
  return (
    next.stateRevision >= source.stateRevision &&
    next.projectionRevision >= source.projectionRevision &&
    next.actorVisibilityRevision === source.actorVisibilityRevision
  );
}
function preparationRevisionsMatch(next: RevisionVector, source: RevisionVector) {
  return (
    next.stateRevision === source.stateRevision + 1 &&
    next.projectionRevision >= source.projectionRevision + 1 &&
    next.actorVisibilityRevision === source.actorVisibilityRevision
  );
}

export function networkRefusalSourceMatches(next: Snapshot, source: NetworkCommandReconnectSource) {
  return (
    isNetworkApplicationForm(next.formId) &&
    revisionsFollow(next.revisions, source.revisions) &&
    fingerprintFields(next.projection, ['networkScopeId']) === source.scope
  );
}

export function absentNetworkCommandSourceMatches(
  next: Snapshot,
  source: NetworkCommandReconnectSource,
) {
  const p = next.projection;
  return (
    next.formId === source.formId &&
    p['pendingCommandIdOrNull'] === null &&
    revisionsFollow(next.revisions, source.revisions) &&
    fingerprintFields(p, ABSENT_BINDING) === source.absentBinding &&
    (!sameNetworkRevisions(next.revisions, source.revisions) ||
      (Object.hasOwn(p, 'contextId') &&
        reconnectFingerprint({ ...p, contextId: null }) === source.contentWithoutContext))
  );
}

export function unconfirmedNetworkCommandSourceMatches(
  next: Snapshot,
  source: NetworkCommandReconnectSource,
  commandId: string,
) {
  return (
    next.formId === 'NET-011' &&
    next.projection['errorCode'] === 'UNCONFIRMED_OUTCOME' &&
    next.projection['pendingCommandIdOrNull'] === commandId &&
    preparationRevisionsMatch(next.revisions, source.revisions) &&
    fingerprintFields(next.projection, UNCONFIRMED_BINDING) === source.unconfirmedBinding
  );
}

export function pendingNetworkCancelSnapshotMatches(
  next: Snapshot,
  source: NetworkCommandReconnectSource,
  request: NetworkWorkflowRequest,
  reconnect: boolean,
) {
  if (
    source.cancel === null ||
    request.workflowCommandId !== 'UI-CMD-DEVICE-REQUEST-CANCEL' ||
    next.formId !== 'NET-005'
  )
    return false;
  const p = next.projection;
  const { payload } = request;
  return (
    preparationRevisionsMatch(next.revisions, source.revisions) &&
    p['connectionState'] === 'CONNECTING' &&
    p['requestStatus'] === 'PENDING' &&
    p['pendingCommandIdOrNull'] === request.commandId &&
    p['commandId'] === request.commandId &&
    p['networkScopeId'] === payload.networkScopeId &&
    p['draftRevision'] === payload.expectedDraftRevision &&
    p['sessionId'] === payload.technicalSessionId &&
    p['requestId'] === payload.requestId &&
    p['requestRevision'] === payload.requestRevision &&
    p['cancelReason'] === payload.reason &&
    (reconnect || p['contextId'] === payload.contextId) &&
    fingerprintFields({ contextId: payload.contextId }, ['contextId']) === source.cancel.context &&
    fingerprintFields(p, CANCEL_CONTENT) === source.cancel.content
  );
}
