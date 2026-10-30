import type { ActionKey } from '@generated/types/atlas.js';
import type {
  DecodeResult,
  CommandReceipt,
  JsonObject,
  RevisionVector,
  WorkflowCommandId,
} from '@shared/wire-protocol.js';
import type {
  NetworkDraftReplaceV3Message,
  NetworkEditableFormId,
  PublicCandidateRef,
} from '@shared/device-admission.js';
import {
  NETWORK_APPLICATION_FORM_IDS,
  type NetworkApplicationFormId,
  type NetworkApplicationProjection,
  type NetworkCancelPayload,
  type NetworkCommandResult,
  type NetworkDraftResultV3Message,
  type NetworkOpenPayload,
  type NetworkSubmitPayload,
  type NetworkWorkflowRequest,
  type Net002Projection,
  type Net004Projection,
  type Net005Projection,
  type Net011Projection,
  type Net017Projection,
  type NetworkGmRequestDraftValues,
  type NetworkGmAcceptToReviewPayload,
  type NetworkGmRejectRequestPayload,
} from '@shared/network-application.js';
import {
  isNetworkApplicationProjection,
  networkGmRequestProjectionValue,
  networkGmRequestDraftValues,
} from '@shared/network-application-codec.js';

export type NetworkEdit = NetworkDraftReplaceV3Message extends infer Request
  ? Request extends NetworkDraftReplaceV3Message
    ? Pick<Request, 'variant' | 'values'>
    : never
  : never;
export const NETWORK_CONTEXT_STORAGE_KEY = 'symbiosis.network-local-context.v1';
export const isNetworkApplicationForm = (value: string): value is NetworkApplicationFormId =>
  (NETWORK_APPLICATION_FORM_IDS as readonly string[]).includes(value);
export const isNetworkEditableForm = (value: string): value is NetworkEditableFormId =>
  ['NET-002', 'NET-003', 'NET-005', 'CHR-027'].includes(value);

/** Closed shared validation precedes every use of the public projection in the UI. */
export function decodeNetworkProjection(
  value: unknown,
  path: string,
  formId: NetworkApplicationFormId,
): DecodeResult<NetworkApplicationProjection> {
  return isNetworkApplicationProjection(formId, value)
    ? { ok: true, value }
    : { ok: false, refusal: { code: 'UNRECOGNIZED', path, value: null } };
}
export function networkEditFromProjection(
  formId: NetworkEditableFormId,
  projection: JsonObject,
): NetworkEdit | null {
  if (!isNetworkApplicationProjection(formId, projection)) return null;
  switch (formId) {
    case 'NET-002':
      return {
        variant: 'ADDRESS',
        values: { addressOrQrPayload: projection['addressOrQrPayload'] as string },
      };
    case 'NET-003':
      return {
        variant: 'SELECTION',
        values: {
          selectedCandidates: projection['selectedCandidates'] as readonly PublicCandidateRef[],
        },
      };
    case 'CHR-027':
      return {
        variant: 'SINGLE_CANDIDATE',
        values: {
          selectedCampaignId: projection['selectedCampaignId'] as string | null,
          requestedControllerSeat: projection['requestedControllerSeat'] as string | null,
        },
      };
    case 'NET-005':
      return {
        variant: 'CANCEL_REASON',
        values: { cancelReason: projection['cancelReason'] as string },
      };
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  record(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const integer = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function candidate(value: unknown): boolean {
  return (
    exact(value, [
      'sourceUuid',
      'finalSnapshotVersion',
      'metadataRevision',
      'candidateSnapshotChecksum',
      'requestedControllerSeat',
    ]) &&
    typeof value['sourceUuid'] === 'string' &&
    value['sourceUuid'].length > 0 &&
    integer(value['finalSnapshotVersion']) &&
    integer(value['metadataRevision']) &&
    typeof value['candidateSnapshotChecksum'] === 'string' &&
    /^[0-9a-f]{64}$/u.test(value['candidateSnapshotChecksum']) &&
    uuid(value['requestedControllerSeat'])
  );
}
export function networkEditIsSendable(edit: NetworkEdit): boolean {
  if (!exact(edit, ['variant', 'values'])) return false;
  switch (edit.variant) {
    case 'ADDRESS':
      return (
        exact(edit.values, ['addressOrQrPayload']) &&
        typeof edit.values.addressOrQrPayload === 'string'
      );
    case 'SELECTION': {
      const selected = edit.values.selectedCandidates;
      return (
        exact(edit.values, ['selectedCandidates']) &&
        Array.isArray(selected) &&
        selected.length <= 3 &&
        selected.every(candidate) &&
        new Set((selected as readonly PublicCandidateRef[]).map((item) => item.sourceUuid)).size ===
          selected.length
      );
    }
    case 'SINGLE_CANDIDATE':
      return (
        exact(edit.values, ['selectedCampaignId', 'requestedControllerSeat']) &&
        (edit.values.selectedCampaignId === null || uuid(edit.values.selectedCampaignId)) &&
        (edit.values.requestedControllerSeat === null || uuid(edit.values.requestedControllerSeat))
      );
    case 'CANCEL_REASON':
      return exact(edit.values, ['cancelReason']) && typeof edit.values.cancelReason === 'string';
    default:
      return false;
  }
}
export const sameNetworkRevisions = (left: RevisionVector, right: RevisionVector): boolean =>
  left.stateRevision === right.stateRevision &&
  left.projectionRevision === right.projectionRevision &&
  left.actorVisibilityRevision === right.actorVisibilityRevision;

export function networkDraftResultMatches(
  message: NetworkDraftResultV3Message,
  request: NetworkDraftReplaceV3Message,
  projection: JsonObject,
): boolean {
  const increment = message.changed ? 1 : 0;
  const expected = request.expectedRevisions;
  return (
    message.draftUpdateId === request.draftUpdateId &&
    message.scope.networkScopeId === request.scope.networkScopeId &&
    message.scope.contextId === request.scope.contextId &&
    message.scope.sourceFormId === request.scope.sourceFormId &&
    message.appliedDraftRevision === request.expectedDraftRevision + increment &&
    sameNetworkRevisions(message.appliedRevisions, {
      stateRevision: expected.stateRevision + increment,
      projectionRevision: expected.projectionRevision + increment,
      actorVisibilityRevision: expected.actorVisibilityRevision,
    }) &&
    message.draftRevision >= message.appliedDraftRevision &&
    message.revisions.stateRevision >= message.appliedRevisions.stateRevision &&
    message.revisions.projectionRevision >= message.appliedRevisions.projectionRevision &&
    message.revisions.actorVisibilityRevision ===
      message.appliedRevisions.actorVisibilityRevision &&
    projection['networkScopeId'] === request.scope.networkScopeId &&
    projection['draftRevision'] === message.draftRevision &&
    projection['stateRevision'] === message.revisions.stateRevision &&
    projection['projectionRevision'] === message.revisions.projectionRevision &&
    projection['actorVisibilityRevision'] === message.revisions.actorVisibilityRevision
  );
}
const commandScope = (p: NetworkApplicationProjection) => ({
  networkScopeId: p.networkScopeId,
  contextId: p.contextId,
  expectedDraftRevision: p.draftRevision,
});

export function networkOpenPayload(formId: string, value: JsonObject): NetworkOpenPayload | null {
  if (
    (formId !== 'NET-002' && formId !== 'NET-011') ||
    !isNetworkApplicationProjection(formId, value)
  )
    return null;
  const p = value as Net002Projection | Net011Projection;
  if (p.pendingCommandIdOrNull !== null || p.campaignIdOrNull !== null) return null;
  if (formId === 'NET-002') {
    const address = p as Net002Projection;
    if (address.parseStatus !== 'VALID' || address.connectionState !== 'NO_TECHNICAL_SESSION')
      return null;
    return {
      ...commandScope(address),
      attemptId: address.attemptId,
      addressOrQrPayload: address.addressOrQrPayload,
      selectedCampaignIdOrNull: address.campaignHintOrNull,
    };
  }
  const failed = p as Net011Projection;
  if (
    failed.lastParsedHostPort === null ||
    failed.errorCode === 'UNCONFIRMED_OUTCOME' ||
    failed.retryAttemptIdOrNull === null ||
    failed.retryAttemptIdOrNull === failed.attemptId
  )
    return null;
  return {
    ...commandScope(failed),
    attemptId: failed.retryAttemptIdOrNull,
    addressOrQrPayload: failed.lastAddressOrQrPayload,
    selectedCampaignIdOrNull: failed.lastParsedHostPort.campaignHintOrNull,
  };
}
export function networkSubmitPayload(
  formId: string,
  value: JsonObject,
): NetworkSubmitPayload | null {
  if (formId !== 'NET-004' || !isNetworkApplicationProjection(formId, value)) return null;
  const p = value as Net004Projection;
  if (
    p.pendingCommandIdOrNull !== null ||
    p.connectionState !== 'CONNECTED_TECHNICAL' ||
    !p.capacityForecast.fitsCurrentCapacity
  )
    return null;
  return {
    ...commandScope(p),
    requestId: p.requestId,
    technicalSessionId: p.sessionId,
    connectionRevision: p.connectionRevision,
    selectedCandidates: p.batchCharacterSummaries.map((entry) => ({
      sourceUuid: entry.sourceUuid,
      finalSnapshotVersion: entry.finalSnapshotVersion,
      metadataRevision: entry.metadataRevision,
      candidateSnapshotChecksum: entry.candidateSnapshotChecksum,
      requestedControllerSeat: entry.requestedControllerSeat,
    })),
  };
}
export function networkCancelPayload(
  formId: string,
  value: JsonObject,
  reason: string,
): NetworkCancelPayload | null {
  if (formId !== 'NET-005' || !isNetworkApplicationProjection(formId, value)) return null;
  const p = value as Net005Projection;
  if (
    p.pendingCommandIdOrNull !== null ||
    p.connectionState !== 'CONNECTED_TECHNICAL' ||
    p.requestStatus !== 'PENDING' ||
    reason !== p.cancelReason ||
    reason.trim().length === 0
  )
    return null;
  return {
    ...commandScope(p),
    requestId: p.requestId,
    technicalSessionId: p.sessionId,
    requestRevision: p.requestRevision,
    reason,
  };
}

/** The published subset excludes later seats, GM diagnostics and gameplay reconnect forms. */
export function expectedNetworkActions(
  formId: NetworkApplicationFormId,
  p: JsonObject,
  capabilities: readonly WorkflowCommandId[],
): readonly ActionKey[] {
  if (!isNetworkApplicationProjection(formId, p) || p.pendingCommandIdOrNull !== null) return [];
  const connected = p.connectionState === 'CONNECTED_TECHNICAL';
  switch (formId) {
    case 'NET-001':
      return [
        'NET-001::CTA::001',
        ...(connected ? ['NET-001::CTA::002' as const] : []),
        ...(p.campaignIdOrNull === null && p.connectionState === 'NO_TECHNICAL_SESSION'
          ? ['NET-001::CTA::003' as const]
          : []),
      ];
    case 'NET-002':
      return [
        'NET-002::CTA::001',
        ...(connected ? ['NET-002::CTA::002' as const] : []),
        ...(networkOpenPayload(formId, p) && capabilities.includes('UI-CMD-CONNECTION-OPEN')
          ? ['NET-002::CTA::003' as const]
          : []),
        ...(p.campaignIdOrNull === null && p.connectionState === 'NO_TECHNICAL_SESSION'
          ? ['NET-002::CTA::004' as const, 'NET-002::CTA::005' as const]
          : []),
      ];
    case 'NET-003': {
      if (!connected) return [];
      if (p['ownRequestIdOrNull'] !== null) return ['NET-003::CTA::003'];
      const selected = p['selectedCandidates'] as readonly PublicCandidateRef[];
      const forecast = p['capacityForecast'] as JsonObject;
      return [
        ...(selected.length > 0 && forecast['fitsCurrentCapacity'] === true
          ? ['NET-003::CTA::001' as const]
          : []),
        ...(selected.length === 1 && forecast['fitsCurrentCapacity'] === true
          ? ['NET-003::CTA::002' as const]
          : []),
      ];
    }
    case 'NET-004':
      return [
        'NET-004::CTA::001',
        ...(networkSubmitPayload(formId, p) && capabilities.includes('UI-CMD-DEVICE-REQUEST-SUBMIT')
          ? ['NET-004::CTA::002' as const]
          : []),
        'NET-004::CTA::003',
      ];
    case 'NET-005':
      if (connected && p['requestStatus'] === 'REJECTED') return ['NET-005::CTA::003'];
      return capabilities.includes('UI-CMD-DEVICE-REQUEST-CANCEL') &&
        networkCancelPayload(formId, p, p['cancelReason'] as string)
        ? ['NET-005::CTA::001']
        : [];
    case 'NET-011':
      if (p['errorCode'] === 'UNCONFIRMED_OUTCOME') return [];
      return [
        ...(networkOpenPayload(formId, p) && capabilities.includes('UI-CMD-CONNECTION-OPEN')
          ? ['NET-011::CTA::003' as const]
          : []),
        'NET-011::CTA::004',
        'NET-011::CTA::005',
      ];
    case 'CHR-027':
      if (p['submissionStatus'] !== 'DRAFT') return [];
      return [
        ...(p['selectedCampaignId'] !== null && p['requestedControllerSeat'] === p.controllerSeat
          ? ['CHR-027::CTA::001' as const]
          : []),
        'CHR-027::CTA::002',
      ];
  }
}

/** Receipts contain only local/remote correlation facts, never the private candidate witness. */
export function decodeNetworkCommandReceipt(
  value: unknown,
  request: NetworkWorkflowRequest,
): DecodeResult<CommandReceipt<NetworkCommandResult>> {
  const fail = (): DecodeResult<CommandReceipt<NetworkCommandResult>> => ({
    ok: false,
    refusal: { code: 'UNRECOGNIZED', path: '$.receipt', value: null },
  });
  if (
    !exact(value, ['commandId', 'receiptId', 'result', 'revisions']) ||
    value['commandId'] !== request.commandId ||
    typeof value['receiptId'] !== 'string' ||
    value['receiptId'].length === 0 ||
    !exact(value['revisions'], [
      'stateRevision',
      'projectionRevision',
      'actorVisibilityRevision',
    ]) ||
    !exact(value['result'], [
      'operation',
      'networkScopeId',
      'remoteReceiptId',
      'technicalSessionId',
      'attemptIdOrNull',
      'requestIdOrNull',
      'requestRevisionOrNull',
      'outcome',
    ])
  )
    return fail();
  const r = value['result'],
    v = value['revisions'];
  const expected = {
    stateRevision: request.expectedRevisions.stateRevision + 2,
    projectionRevision: request.expectedRevisions.projectionRevision + 2,
    actorVisibilityRevision: request.expectedRevisions.actorVisibilityRevision,
  };
  if (
    Object.values(expected).some((axis) => !integer(axis)) ||
    v['stateRevision'] !== expected.stateRevision ||
    !integer(v['projectionRevision']) ||
    (v['projectionRevision'] as number) < expected.projectionRevision ||
    v['actorVisibilityRevision'] !== expected.actorVisibilityRevision ||
    r['networkScopeId'] !== request.payload.networkScopeId ||
    !uuid(r['technicalSessionId']) ||
    typeof r['remoteReceiptId'] !== 'string' ||
    r['remoteReceiptId'].length === 0
  )
    return fail();
  if (request.workflowCommandId === 'UI-CMD-CONNECTION-OPEN') {
    if (
      r['operation'] !== 'OPEN' ||
      r['outcome'] !== 'CONNECTED_TECHNICAL' ||
      r['attemptIdOrNull'] !== request.payload.attemptId ||
      r['requestIdOrNull'] !== null ||
      r['requestRevisionOrNull'] !== null
    )
      return fail();
  } else {
    const cancel = request.workflowCommandId === 'UI-CMD-DEVICE-REQUEST-CANCEL';
    const expectedRevision = cancel ? request.payload.requestRevision + 1 : 0;
    if (
      !integer(expectedRevision) ||
      r['operation'] !== (cancel ? 'CANCEL' : 'SUBMIT') ||
      r['outcome'] !== (cancel ? 'CANCELLED' : 'PENDING') ||
      r['attemptIdOrNull'] !== null ||
      r['technicalSessionId'] !== request.payload.technicalSessionId ||
      r['requestIdOrNull'] !== request.payload.requestId ||
      r['requestRevisionOrNull'] !== expectedRevision
    )
      return fail();
  }
  return { ok: true, value: value as unknown as CommandReceipt<NetworkCommandResult> };
}
export function networkCommandDestinationMatches(
  formId: string,
  p: JsonObject,
  revisions: RevisionVector,
  receipt: CommandReceipt<NetworkCommandResult>,
  request: NetworkWorkflowRequest,
  replay: boolean,
): boolean {
  if (
    !isNetworkApplicationForm(formId) ||
    !isNetworkApplicationProjection(formId, p) ||
    p.networkScopeId !== receipt.result.networkScopeId ||
    revisions.stateRevision < receipt.revisions.stateRevision ||
    revisions.projectionRevision < receipt.revisions.projectionRevision ||
    revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision
  )
    return false;
  if (replay) return true;
  if (
    revisions.stateRevision !== receipt.revisions.stateRevision ||
    p.draftRevision !== request.payload.expectedDraftRevision
  )
    return false;
  if (receipt.result.operation === 'OPEN')
    return (
      formId === 'NET-003' &&
      p['sessionId'] === receipt.result.technicalSessionId &&
      (request.workflowCommandId !== 'UI-CMD-CONNECTION-OPEN' ||
        request.payload.selectedCampaignIdOrNull === null ||
        p.campaignIdOrNull === request.payload.selectedCampaignIdOrNull)
    );
  return (
    formId === (receipt.result.operation === 'SUBMIT' ? 'NET-005' : 'NET-003') &&
    p['sessionId'] === receipt.result.technicalSessionId &&
    (receipt.result.operation === 'SUBMIT'
      ? p['requestId'] === receipt.result.requestIdOrNull &&
        p['requestRevision'] === receipt.result.requestRevisionOrNull
      : p['ownRequestIdOrNull'] === null)
  );
}

/** Local editor flags only: neither these values nor the queue DTO grant GM authority. */
export interface NetworkGmRequestEditState {
  readonly values: NetworkGmRequestDraftValues;
  readonly dirty: boolean;
  readonly pending: boolean;
}
export function networkGmRequestDraftFromProjection(
  value: Net017Projection,
): NetworkGmRequestDraftValues {
  const p = networkGmRequestProjectionValue(value);
  return { selectedRequestIdOrNull: p.selectedRequestIdOrNull, decisionReason: p.decisionReason };
}
function confirmedGmRequestSelection(
  value: Net017Projection,
  state: NetworkGmRequestEditState | null,
) {
  const p = networkGmRequestProjectionValue(value);
  if (p.commandId !== null || state?.dirty || state?.pending) return null;
  if (state !== null) {
    const values = networkGmRequestDraftValues(state.values);
    if (
      values.selectedRequestIdOrNull !== p.selectedRequestIdOrNull ||
      values.decisionReason !== p.decisionReason
    )
      return null;
  }
  const row = p.requests.find((request) => request.requestId === p.selectedRequestIdOrNull);
  return row === undefined ? null : { projection: p, row };
}
/** NET-017::CTA::007: a payload preview, never a client-side decision or reservation. */
export function networkGmAcceptToReviewPayload(
  value: Net017Projection,
  state: NetworkGmRequestEditState | null = null,
): NetworkGmAcceptToReviewPayload | null {
  const selected = confirmedGmRequestSelection(value, state);
  if (selected === null || selected.row.requestStatus !== 'PENDING') return null;
  return {
    campaignId: selected.projection.campaignId,
    requestId: selected.row.requestId,
    requestRevision: selected.row.requestRevision,
  };
}
/** NET-017::CTA::008 preserves exact confirmed reason bytes for the host command. */
export function networkGmRejectRequestPayload(
  value: Net017Projection,
  state: NetworkGmRequestEditState | null = null,
): NetworkGmRejectRequestPayload | null {
  const selected = confirmedGmRequestSelection(value, state);
  if (
    selected === null ||
    !['PENDING', 'IN_REVIEW'].includes(selected.row.requestStatus) ||
    selected.projection.decisionReason.trim().length === 0
  )
    return null;
  return {
    campaignId: selected.projection.campaignId,
    requestId: selected.row.requestId,
    requestRevision: selected.row.requestRevision,
    reason: selected.projection.decisionReason,
  };
}
