import { redactProtocolInputRefusal, wireCodecPrimitives } from './wire-codec.js';
import type { DecodeResult, EncodeResult } from './wire-protocol.js';
import { encodeHostMessageV2 } from './wire-v2-codec.js';
import {
  admissionGmPresentationValue,
  isAdmissionGmForm,
} from './campaign-admission-presentation.js';
import type { PresentedLayerForm } from './wire-v2-protocol.js';
import type { PresentedBaseForm, WireV2Vocabulary } from './wire-v2-protocol.js';
import { networkClientValue } from './device-admission.js';
import type {
  NetworkClientV3Message,
  NetworkDraftScope,
  PublicCandidateRef,
} from './device-admission.js';
import type {
  NetworkApplicationFormId,
  NetworkApplicationProjection,
  NetworkHostV3Message,
  NetworkGmClientV3Message,
  NetworkGmHostV3Message,
  NetworkGmRequestDraftScope,
  NetworkOpenPayload,
  NetworkSubmitPayload,
  NetworkCancelPayload,
  Net017Projection,
  NetworkGmRequestCandidateSummary,
  NetworkGmRequestQueueRow,
  NetworkGmRequestDraftValues,
  NetworkGmAcceptToReviewPayload,
  NetworkGmRejectRequestPayload,
  NetworkGmRequestDecisionReceipt,
} from './network-application.js';

const {
  record,
  string: text,
  revision,
  revisions,
  literal,
  validated,
  abortInvalid: invalid,
  abortUnrecognized: unrecognized,
} = wireCodecPrimitives;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const AXES = ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const;
const COMMON =
  'networkScopeId contextId deviceId controllerSeat stateRevision projectionRevision actorVisibilityRevision draftRevision campaignIdOrNull connectionState pendingCommandIdOrNull';
const FIELDS: Readonly<Record<NetworkApplicationFormId, string>> = {
  'NET-001':
    'activeRole discoveryState discoveredHosts discoveryTruncated lastAddressOrNull returnContext connectionAttemptIdOrNull',
  'NET-002':
    'addressOrQrPayload parsedHost parsedPort protocolVersion campaignHintOrNull parseStatus parseDiagnostic attemptId commandId',
  'NET-003':
    'ownRequestIdOrNull campaignId campaignStatus sessionId connectionRevision eligibleFinalCandidates selectedCandidates capacityForecast',
  'NET-004':
    'sessionId requestId selectedLocalCharacterUuids snapshotChecksums campaignId connectionRevision commandId batchCharacterSummaries capacityForecast',
  'NET-005':
    'sessionId requestId requestOwnerDeviceId batchCharacterSummaries requestStatus gmMessage requestRevision cancelReason commandId',
  'NET-011':
    'attemptId retryAttemptIdOrNull activeRole activeSeatOrGm lastAddressOrQrPayload lastParsedHostPort errorCode humanDiagnostic retryCount lastConfirmedStateRevision lastConfirmedProjectionRevision resumeContextOrNull localDataUntouched commandId',
  'CHR-027':
    'localCharacterUuid finalSnapshotVersion candidateSnapshotChecksum eligibleCampaignIds selectedCampaignId requestedControllerSeat sourceUuidAndProvenance submissionStatus commandId',
};
function exact(value: unknown, fields: string, path = '$'): Record<string, unknown> {
  const object = record(value, path);
  const keys = fields.split(' ');
  for (const key of keys)
    if (!Object.hasOwn(object, key)) invalid(`${path}.${key}`, 'required field', null);
  if (Object.keys(object).some((key) => !keys.includes(key))) unrecognized(path, null);
  return object;
}
function uuid(value: unknown, path: string): string {
  const id = text(value, path);
  return UUID.test(id) ? id : invalid(path, 'canonical lowercase UUID v4', null);
}
function raw(value: unknown, path: string): string {
  return typeof value === 'string' ? value : invalid(path, 'string', null);
}
const nullable = <T>(value: unknown, path: string, read: (v: unknown, p: string) => T): T | null =>
  value === null ? null : read(value, path);
const nullableText = (v: unknown, p: string) => nullable(v, p, raw);
const nullableUuid = (v: unknown, p: string) => nullable(v, p, uuid);
const hash = (v: unknown, p: string): string => {
  const h = text(v, p);
  return SHA256.test(h) ? h : invalid(p, 'canonical SHA-256', null);
};
const list = (v: unknown, p: string): readonly unknown[] =>
  Array.isArray(v) ? v : invalid(p, 'array', null);
function oneOf<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  const match = choices.find((choice) => choice === value);
  return match === undefined ? unrecognized(path, null) : match;
}
function boolean(value: unknown, path: string): boolean {
  return typeof value === 'boolean' ? value : invalid(path, 'boolean', null);
}
function unique<T>(items: readonly T[], path: string): readonly T[] {
  if (new Set(items).size !== items.length) invalid(path, 'unique entries', null);
  return items;
}
function capacity(value: unknown, path: string): number {
  const result = revision(value, path);
  return result >= 1 && result <= 5 ? result : invalid(path, 'capacity one to five', null);
}
function port(value: unknown, path: string): number {
  const result = revision(value, path);
  return result >= 1 && result <= 65535 ? result : invalid(path, 'port one to 65535', null);
}
function locator(value: unknown, path: string): void {
  const r = exact(value, 'hostAddress hostPort campaignHintOrNull', path);
  text(r['hostAddress'], `${path}.hostAddress`);
  port(r['hostPort'], `${path}.hostPort`);
  nullableUuid(r['campaignHintOrNull'], `${path}.campaignHintOrNull`);
}
function candidate(value: unknown, path: string, summary: boolean): PublicCandidateRef {
  const r = exact(
    value,
    'sourceUuid finalSnapshotVersion metadataRevision candidateSnapshotChecksum requestedControllerSeat' +
      (summary ? ' name sourceSnapshotId' : ''),
    path,
  );
  text(r['sourceUuid'], `${path}.sourceUuid`);
  revision(r['finalSnapshotVersion'], `${path}.finalSnapshotVersion`);
  revision(r['metadataRevision'], `${path}.metadataRevision`);
  hash(r['candidateSnapshotChecksum'], `${path}.candidateSnapshotChecksum`);
  uuid(r['requestedControllerSeat'], `${path}.requestedControllerSeat`);
  if (summary) {
    text(r['name'], `${path}.name`);
    text(r['sourceSnapshotId'], `${path}.sourceSnapshotId`);
  }
  return validated(r);
}
function candidates(
  value: unknown,
  path: string,
  summary: boolean,
  minimum = 0,
  maximum = 3,
): readonly PublicCandidateRef[] {
  const values = list(value, path);
  if (values.length < minimum || values.length > maximum)
    invalid(path, 'permitted candidate count', null);
  const result = values.map((v, i) => candidate(v, `${path}[${String(i)}]`, summary));
  unique(
    result.map((v) => v.sourceUuid),
    path,
  );
  return result;
}
function forecast(value: unknown, path: string, selectedCount: number): void {
  const r = exact(
    value,
    'campaignRevision activePlayerCapacity activePcCount occupiedCampaignPlaceCount selectedCandidateCount fitsCurrentCapacity',
    path,
  );
  revision(r['campaignRevision'], `${path}.campaignRevision`);
  const limit = capacity(r['activePlayerCapacity'], `${path}.activePlayerCapacity`);
  const active = revision(r['activePcCount'], `${path}.activePcCount`);
  if (active > limit) invalid(path, 'active PCs within capacity', null);
  const occupied = revision(r['occupiedCampaignPlaceCount'], `${path}.occupiedCampaignPlaceCount`);
  if (occupied < active || occupied > limit)
    invalid(path, 'occupied places include active PCs within capacity', null);
  literal(r['selectedCandidateCount'], selectedCount, `${path}.selectedCandidateCount`);
  literal(
    r['fitsCurrentCapacity'],
    occupied + selectedCount <= limit,
    `${path}.fitsCurrentCapacity`,
  );
}
function ownCandidates(values: readonly PublicCandidateRef[], lane: unknown, path: string): void {
  if (values.some((v) => v.requestedControllerSeat !== lane)) invalid(path, 'own input lane', null);
}
function projectionValue(
  formId: NetworkApplicationFormId,
  value: unknown,
): NetworkApplicationProjection {
  const r = exact(value, `${COMMON} ${FIELDS[formId]}`);
  for (const key of ['networkScopeId', 'contextId', 'deviceId', 'controllerSeat'])
    uuid(r[key], `$.${key}`);
  const vector = revisions(Object.fromEntries(AXES.map((key) => [key, r[key]])), '$.revisions');
  if (vector.actorVisibilityRevision !== 0 || vector.projectionRevision < vector.stateRevision)
    invalid('$.revisions', 'non-admitted local revision owners', null);
  if (revision(r['draftRevision'], '$.draftRevision') > vector.stateRevision)
    invalid('$.draftRevision', 'draft revision within local state history', null);
  const campaignId = nullableUuid(r['campaignIdOrNull'], '$.campaignIdOrNull');
  oneOf(
    r['connectionState'],
    [
      'NO_TECHNICAL_SESSION',
      'CONNECTING',
      'CONNECTED_TECHNICAL',
      'LOST',
      'UNAVAILABLE',
      'RECONNECTED',
    ],
    '$.connectionState',
  );
  if (
    (r['connectionState'] === 'NO_TECHNICAL_SESSION' && campaignId !== null) ||
    (r['connectionState'] === 'CONNECTED_TECHNICAL' && campaignId === null)
  )
    invalid('$.campaignIdOrNull', 'confirmed campaign session binding', null);
  nullableText(r['pendingCommandIdOrNull'], '$.pendingCommandIdOrNull');
  if (Object.hasOwn(r, 'commandId')) nullableText(r['commandId'], '$.commandId');
  if (formId === 'NET-001') {
    literal(r['activeRole'], 'PLAYER', '$.activeRole');
    oneOf(
      r['discoveryState'],
      ['NOT_STARTED', 'SEARCHING', 'COMPLETE', 'UNAVAILABLE'],
      '$.discoveryState',
    );
    boolean(r['discoveryTruncated'], '$.discoveryTruncated');
    nullableText(r['lastAddressOrNull'], '$.lastAddressOrNull');
    nullable(r['connectionAttemptIdOrNull'], '$.connectionAttemptIdOrNull', text);
    literal(r['returnContext'], 'PLAYER_MENU', '$.returnContext');
    const offers = list(r['discoveredHosts'], '$.discoveredHosts');
    const keys = offers.map((offer, i) => {
      const path = `$.discoveredHosts[${String(i)}]`;
      const item = exact(
        offer,
        'campaignId title locator campaignStatus activePlayerCapacity activePcCount compatibility',
        path,
      );
      const id = uuid(item['campaignId'], `${path}.campaignId`);
      text(item['title'], `${path}.title`);
      locator(item['locator'], `${path}.locator`);
      literal(item['campaignStatus'], 'PAUSED', `${path}.campaignStatus`);
      const maximum = capacity(item['activePlayerCapacity'], `${path}.activePlayerCapacity`);
      if (revision(item['activePcCount'], `${path}.activePcCount`) > maximum)
        invalid(path, 'active PCs within capacity', null);
      oneOf(item['compatibility'], ['COMPATIBLE', 'INCOMPATIBLE'], `${path}.compatibility`);
      const address = item['locator'] as Record<string, unknown>;
      return `${String(address['hostAddress'])}:${String(address['hostPort'])}/${id}`;
    });
    unique(keys, '$.discoveredHosts');
  } else if (formId === 'NET-002') {
    const address = raw(r['addressOrQrPayload'], '$.addressOrQrPayload');
    const status = oneOf(r['parseStatus'], ['EMPTY', 'INVALID', 'VALID'], '$.parseStatus');
    literal(r['protocolVersion'], 3, '$.protocolVersion');
    nullableUuid(r['campaignHintOrNull'], '$.campaignHintOrNull');
    text(r['attemptId'], '$.attemptId');
    nullableText(r['parseDiagnostic'], '$.parseDiagnostic');
    if (status === 'VALID') {
      text(r['parsedHost'], '$.parsedHost');
      port(r['parsedPort'], '$.parsedPort');
      literal(r['parseDiagnostic'], null, '$.parseDiagnostic');
    } else {
      literal(r['parsedHost'], null, '$.parsedHost');
      literal(r['parsedPort'], null, '$.parsedPort');
      literal(r['campaignHintOrNull'], null, '$.campaignHintOrNull');
      if (status === 'EMPTY' && address.trim() !== '')
        invalid('$.parseStatus', 'empty address', null);
      if (status === 'INVALID') text(r['parseDiagnostic'], '$.parseDiagnostic');
    }
  } else if (formId === 'NET-003') {
    nullableUuid(r['ownRequestIdOrNull'], '$.ownRequestIdOrNull');
    if (campaignId === null) invalid('$.campaignIdOrNull', 'confirmed campaign', null);
    literal(r['campaignId'], campaignId, '$.campaignId');
    literal(r['campaignStatus'], 'PAUSED', '$.campaignStatus');
    uuid(r['sessionId'], '$.sessionId');
    revision(r['connectionRevision'], '$.connectionRevision');
    const eligible = candidates(
      r['eligibleFinalCandidates'],
      '$.eligibleFinalCandidates',
      true,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const selected = candidates(r['selectedCandidates'], '$.selectedCandidates', false);
    ownCandidates([...eligible, ...selected], r['controllerSeat'], '$.selectedCandidates');
    for (const item of selected)
      if (!eligible.some((e) => Object.keys(item).every((key) => e[key] === item[key])))
        invalid('$.selectedCandidates', 'exact eligible version', null);
    forecast(r['capacityForecast'], '$.capacityForecast', selected.length);
  } else if (formId === 'NET-004' || formId === 'NET-005') {
    if (campaignId === null) invalid('$.campaignIdOrNull', 'confirmed campaign', null);
    uuid(r['sessionId'], '$.sessionId');
    uuid(r['requestId'], '$.requestId');
    const batch = candidates(r['batchCharacterSummaries'], '$.batchCharacterSummaries', true, 1);
    ownCandidates(batch, r['controllerSeat'], '$.batchCharacterSummaries');
    if (formId === 'NET-004') {
      literal(r['campaignId'], campaignId, '$.campaignId');
      revision(r['connectionRevision'], '$.connectionRevision');
      const ids = list(r['selectedLocalCharacterUuids'], '$.selectedLocalCharacterUuids');
      const checksums = list(r['snapshotChecksums'], '$.snapshotChecksums');
      if (ids.length !== batch.length || checksums.length !== batch.length)
        invalid('$', 'matching immutable batch', null);
      batch.forEach((item, i) => {
        literal(ids[i], item.sourceUuid, '$.selectedLocalCharacterUuids');
        const checksum = exact(
          checksums[i],
          'localCharacterUuid candidateSnapshotChecksum',
          '$.snapshotChecksums',
        );
        literal(
          checksum['localCharacterUuid'],
          item.sourceUuid,
          '$.snapshotChecksums.localCharacterUuid',
        );
        literal(
          checksum['candidateSnapshotChecksum'],
          item.candidateSnapshotChecksum,
          '$.snapshotChecksums.candidateSnapshotChecksum',
        );
      });
      forecast(r['capacityForecast'], '$.capacityForecast', batch.length);
    } else {
      literal(
        r['requestOwnerDeviceId'],
        uuid(r['deviceId'], '$.deviceId'),
        '$.requestOwnerDeviceId',
      );
      oneOf(
        r['requestStatus'],
        ['PENDING', 'IN_REVIEW', 'REJECTED', 'PROPOSED'],
        '$.requestStatus',
      );
      nullableText(r['gmMessage'], '$.gmMessage');
      revision(r['requestRevision'], '$.requestRevision');
      raw(r['cancelReason'], '$.cancelReason');
    }
  } else if (formId === 'CHR-027') {
    const source = text(r['localCharacterUuid'], '$.localCharacterUuid');
    const version = revision(r['finalSnapshotVersion'], '$.finalSnapshotVersion');
    const checksum = hash(r['candidateSnapshotChecksum'], '$.candidateSnapshotChecksum');
    const ids = unique(
      list(r['eligibleCampaignIds'], '$.eligibleCampaignIds').map((v) =>
        uuid(v, '$.eligibleCampaignIds'),
      ),
      '$.eligibleCampaignIds',
    );
    const selected = nullableUuid(r['selectedCampaignId'], '$.selectedCampaignId');
    const seat = nullableUuid(r['requestedControllerSeat'], '$.requestedControllerSeat');
    if (
      (selected !== null && !ids.includes(selected)) ||
      (seat !== null && seat !== r['controllerSeat'])
    )
      invalid('$', 'eligible campaign and own input lane', null);
    oneOf(r['submissionStatus'], ['DRAFT', 'SUBMITTED'], '$.submissionStatus');
    const p = exact(
      r['sourceUuidAndProvenance'],
      'registryVersion catalogVersion builtAgainstTuple sourceUuid sourceSnapshotId metadataRevision sourceChecksum finalSaveReceiptId finalSnapshotVersion',
      '$.sourceUuidAndProvenance',
    );
    for (const key of [
      'registryVersion',
      'catalogVersion',
      'builtAgainstTuple',
      'sourceSnapshotId',
      'finalSaveReceiptId',
    ])
      text(p[key], `$.sourceUuidAndProvenance.${key}`);
    revision(p['metadataRevision'], '$.sourceUuidAndProvenance.metadataRevision');
    literal(p['sourceUuid'], source, '$.sourceUuidAndProvenance.sourceUuid');
    literal(p['sourceChecksum'], checksum, '$.sourceUuidAndProvenance.sourceChecksum');
    literal(p['finalSnapshotVersion'], version, '$.sourceUuidAndProvenance.finalSnapshotVersion');
  } else {
    text(r['attemptId'], '$.attemptId');
    const retry = nullable(r['retryAttemptIdOrNull'], '$.retryAttemptIdOrNull', text);
    if (retry === r['attemptId'] || (r['errorCode'] === 'UNCONFIRMED_OUTCOME' && retry !== null))
      invalid('$.retryAttemptIdOrNull', 'distinct confirmed retry plan', null);
    literal(r['activeRole'], 'PLAYER', '$.activeRole');
    literal(r['activeSeatOrGm'], uuid(r['controllerSeat'], '$.controllerSeat'), '$.activeSeatOrGm');
    raw(r['lastAddressOrQrPayload'], '$.lastAddressOrQrPayload');
    if (r['lastParsedHostPort'] !== null) locator(r['lastParsedHostPort'], '$.lastParsedHostPort');
    oneOf(
      r['errorCode'],
      [
        'INVALID_ADDRESS',
        'CAMPAIGN_UNAVAILABLE',
        'AMBIGUOUS_CAMPAIGN',
        'INCOMPATIBLE_BASELINE',
        'HOST_IDENTITY_CHANGED',
        'PEER_UNAVAILABLE',
        'UNCONFIRMED_OUTCOME',
      ],
      '$.errorCode',
    );
    text(r['humanDiagnostic'], '$.humanDiagnostic');
    revision(r['retryCount'], '$.retryCount');
    literal(r['connectionState'], 'UNAVAILABLE', '$.connectionState');
    revision(r['lastConfirmedStateRevision'], '$.lastConfirmedStateRevision');
    revision(r['lastConfirmedProjectionRevision'], '$.lastConfirmedProjectionRevision');
    literal(r['resumeContextOrNull'], null, '$.resumeContextOrNull');
    literal(r['localDataUntouched'], true, '$.localDataUntouched');
  }
  return validated(r);
}

/** Boolean validation is used after wire JSON decoding; no private diagnostic data is returned. */
export function isNetworkApplicationProjection(
  formId: NetworkApplicationFormId,
  value: unknown,
): value is NetworkApplicationProjection {
  try {
    if (!Object.hasOwn(FIELDS, formId)) return false;
    projectionValue(formId, value);
    return true;
  } catch {
    return false;
  }
}

function scope(value: unknown): NetworkDraftScope {
  const r = exact(value, 'networkScopeId contextId sourceFormId', '$.scope');
  return {
    networkScopeId: uuid(r['networkScopeId'], '$.scope.networkScopeId'),
    contextId: uuid(r['contextId'], '$.scope.contextId'),
    sourceFormId: oneOf(
      r['sourceFormId'],
      ['NET-002', 'NET-003', 'NET-005', 'CHR-027'],
      '$.scope.sourceFormId',
    ),
  };
}
export function networkHostValue(
  value: unknown,
  vocabulary: WireV2Vocabulary,
): NetworkHostV3Message {
  const message = record(value, '$');
  literal(message['protocolVersion'], 3, '$.protocolVersion');
  if (message['messageType'] === 'network.draft.refusal') {
    const r = exact(
      value,
      'messageType protocolVersion draftUpdateId scope revisions presentationUnchanged refusal',
    );
    text(r['draftUpdateId'], '$.draftUpdateId');
    scope(r['scope']);
    const current = revisions(r['revisions'], '$.revisions');
    literal(r['presentationUnchanged'], true, '$.presentationUnchanged');
    const error = record(r['refusal'], '$.refusal');
    const code = error['code'];
    if (code === 'INVALID_FIELD') {
      exact(error, 'code field', '$.refusal');
      oneOf(
        error['field'],
        ['address', 'selection', 'campaign', 'seat', 'reason'],
        '$.refusal.field',
      );
    } else if (code === 'STALE_DRAFT') {
      exact(error, 'code expected actual', '$.refusal');
      revision(error['expected'], '$.refusal.expected');
      revision(error['actual'], '$.refusal.actual');
    } else if (code === 'STALE_REVISION') {
      exact(error, 'code expected actual', '$.refusal');
      revisions(error['expected'], '$.refusal.expected');
      const actual = revisions(error['actual'], '$.refusal.actual');
      for (const key of AXES) literal(actual[key], current[key], `$.refusal.actual.${key}`);
    } else {
      exact(error, 'code', '$.refusal');
      oneOf(
        code,
        ['IDEMPOTENCY_CONFLICT', 'DRAFT_UNAVAILABLE', 'UNRESOLVED_COMMAND', 'REVISION_OVERFLOW'],
        '$.refusal.code',
      );
    }
    return validated(r);
  }
  literal(message['messageType'], 'network.draft.result', '$.messageType');
  const r = exact(
    value,
    'messageType protocolVersion draftUpdateId scope changed appliedDraftRevision appliedRevisions draftRevision revisions projectionRole presentation',
  );
  const id = text(r['draftUpdateId'], '$.draftUpdateId');
  const binding = scope(r['scope']);
  boolean(r['changed'], '$.changed');
  const appliedDraft = revision(r['appliedDraftRevision'], '$.appliedDraftRevision');
  const currentDraft = revision(r['draftRevision'], '$.draftRevision');
  const applied = revisions(r['appliedRevisions'], '$.appliedRevisions');
  const current = revisions(r['revisions'], '$.revisions');
  if (
    appliedDraft > currentDraft ||
    AXES.some((key) => applied[key] > current[key]) ||
    applied.actorVisibilityRevision !== 0 ||
    current.actorVisibilityRevision !== 0
  )
    invalid('$.revisions', 'ordered local application revisions', null);
  literal(r['projectionRole'], 'player', '$.projectionRole');
  const presentation = exact(r['presentation'], 'base layers', '$.presentation');
  if (list(presentation['layers'], '$.presentation.layers').length !== 0)
    invalid('$.presentation.layers', 'empty network layers', null);
  const base = record(presentation['base'], '$.presentation.base');
  const currentForm = oneOf(
    base['formId'],
    Object.keys(FIELDS) as NetworkApplicationFormId[],
    '$.presentation.base.formId',
  );
  const payload = projectionValue(currentForm, base['roleFilteredPayload']);
  const routeBindings = list(base['routeBindings'], '$.presentation.base.routeBindings');
  if (routeBindings.length !== 1)
    invalid('$.presentation.base.routeBindings', 'one assigned network binding', null);
  const routeBinding = exact(
    routeBindings[0],
    'parameterIndex source value',
    '$.presentation.base.routeBindings[0]',
  );
  literal(routeBinding['parameterIndex'], 0, '$.presentation.base.routeBindings[0].parameterIndex');
  literal(routeBinding['source'], 'inherited', '$.presentation.base.routeBindings[0].source');
  literal(
    routeBinding['value'],
    currentForm === 'CHR-027'
      ? payload['localCharacterUuid']
      : (payload.campaignIdOrNull ?? `unbound:${payload.networkScopeId}`),
    '$.presentation.base.routeBindings[0].value',
  );
  literal(
    payload.networkScopeId,
    binding.networkScopeId,
    '$.presentation.base.roleFilteredPayload.networkScopeId',
  );
  literal(
    payload.draftRevision,
    currentDraft,
    '$.presentation.base.roleFilteredPayload.draftRevision',
  );
  for (const key of AXES)
    literal(payload[key], current[key], `$.presentation.base.roleFilteredPayload.${key}`);
  const encoded = encodeHostMessageV2(
    {
      messageType: 'projection.snapshot',
      protocolVersion: 2,
      projectionRole: 'player',
      revisions: current,
      presentation: {
        assignment: { reason: 'RECONNECT', correlationId: id },
        base: base as unknown as PresentedBaseForm,
        layers: [],
      },
    },
    vocabulary,
  );
  if (!encoded.ok) invalid('$.presentation', 'valid local network presentation', null);
  return validated(r);
}

export function networkWorkflowPayloadValue(
  workflowId: string,
  value: unknown,
): NetworkOpenPayload | NetworkSubmitPayload | NetworkCancelPayload {
  const common = 'networkScopeId contextId expectedDraftRevision';
  const fields =
    workflowId === 'UI-CMD-CONNECTION-OPEN'
      ? 'attemptId addressOrQrPayload selectedCampaignIdOrNull'
      : workflowId === 'UI-CMD-DEVICE-REQUEST-SUBMIT'
        ? 'requestId technicalSessionId connectionRevision selectedCandidates'
        : workflowId === 'UI-CMD-DEVICE-REQUEST-CANCEL'
          ? 'requestId technicalSessionId requestRevision reason'
          : unrecognized('$.workflowCommandId', null);
  const r = exact(value, `${common} ${fields}`, '$.payload');
  uuid(r['networkScopeId'], '$.payload.networkScopeId');
  uuid(r['contextId'], '$.payload.contextId');
  revision(r['expectedDraftRevision'], '$.payload.expectedDraftRevision');
  if (workflowId === 'UI-CMD-CONNECTION-OPEN') {
    text(r['attemptId'], '$.payload.attemptId');
    text(r['addressOrQrPayload'], '$.payload.addressOrQrPayload');
    nullableUuid(r['selectedCampaignIdOrNull'], '$.payload.selectedCampaignIdOrNull');
  } else {
    uuid(r['requestId'], '$.payload.requestId');
    uuid(r['technicalSessionId'], '$.payload.technicalSessionId');
    if (workflowId === 'UI-CMD-DEVICE-REQUEST-SUBMIT') {
      revision(r['connectionRevision'], '$.payload.connectionRevision');
      candidates(r['selectedCandidates'], '$.payload.selectedCandidates', false, 1);
    } else {
      revision(r['requestRevision'], '$.payload.requestRevision');
      if (text(r['reason'], '$.payload.reason').trim() === '')
        invalid('$.payload.reason', 'nonblank reason', null);
    }
  }
  return validated(r);
}

function gmRequestCandidates(
  value: unknown,
  path: string,
): readonly NetworkGmRequestCandidateSummary[] {
  const batch = list(value, path);
  if (batch.length < 1 || batch.length > 3)
    invalid(path, 'one to three submitted candidates', null);
  const result = batch.map((value, index): NetworkGmRequestCandidateSummary => {
    const at = `${path}[${String(index)}]`;
    const row = exact(
      value,
      'sourceUuid snapshotChecksum name sourceSnapshotId localControllerSeatId',
      at,
    );
    for (const key of ['sourceUuid', 'name', 'sourceSnapshotId']) text(row[key], `${at}.${key}`);
    hash(row['snapshotChecksum'], `${at}.snapshotChecksum`);
    uuid(row['localControllerSeatId'], `${at}.localControllerSeatId`);
    return validated(row);
  });
  unique(
    result.map((row) => row.sourceUuid),
    path,
  );
  return result;
}
function gmRequestRow(value: unknown, path: string): NetworkGmRequestQueueRow {
  const row = exact(
    value,
    'requestId requestOwnerDeviceId requestStatus requestRevision connectionState batchCharacterSummaries requestedCandidateCount gmMessageOrNull decisionReceiptIdOrNull',
    path,
  );
  text(row['requestId'], `${path}.requestId`);
  uuid(row['requestOwnerDeviceId'], `${path}.requestOwnerDeviceId`);
  oneOf(
    row['requestStatus'],
    ['PENDING', 'IN_REVIEW', 'REJECTED', 'PROPOSED'],
    `${path}.requestStatus`,
  );
  revision(row['requestRevision'], `${path}.requestRevision`);
  oneOf(
    row['connectionState'],
    [
      'NO_TECHNICAL_SESSION',
      'CONNECTING',
      'CONNECTED_TECHNICAL',
      'CONNECTED_ADMITTED',
      'LOST',
      'UNAVAILABLE',
      'DISCONNECTED',
      'RECONNECTED',
    ],
    `${path}.connectionState`,
  );
  const batch = gmRequestCandidates(
    row['batchCharacterSummaries'],
    `${path}.batchCharacterSummaries`,
  );
  literal(row['requestedCandidateCount'], batch.length, `${path}.requestedCandidateCount`);
  nullableText(row['gmMessageOrNull'], `${path}.gmMessageOrNull`);
  nullable(row['decisionReceiptIdOrNull'], `${path}.decisionReceiptIdOrNull`, text);
  return validated(row);
}
/** No transport scope or authority is inferred from these two editable source fields. */
export function networkGmRequestDraftValues(value: unknown): NetworkGmRequestDraftValues {
  const row = exact(value, 'selectedRequestIdOrNull decisionReason', '$.values');
  nullable(row['selectedRequestIdOrNull'], '$.values.selectedRequestIdOrNull', text);
  raw(row['decisionReason'], '$.values.decisionReason');
  return validated(row);
}
export function networkGmRequestProjectionValue(value: unknown): Net017Projection {
  const row = exact(
    value,
    'contextId campaignId stateRevision projectionRevision requestQueueRevision requests selectedRequestIdOrNull activePlayerCapacity occupiedActivePcCount decisionReason commandId returnContext selectedAdmissionOrNull',
  );
  uuid(row['contextId'], '$.contextId');
  if (row['selectedAdmissionOrNull'] !== null) {
    const admission = exact(
      row['selectedAdmissionOrNull'],
      'published hasProposed',
      '$.selectedAdmissionOrNull',
    );
    if (
      typeof admission['published'] !== 'boolean' ||
      typeof admission['hasProposed'] !== 'boolean' ||
      (admission['hasProposed'] && !admission['published']) ||
      row['selectedRequestIdOrNull'] === null
    )
      invalid('$.selectedAdmissionOrNull', 'selected admission publication facts', null);
  }
  const campaignId = uuid(row['campaignId'], '$.campaignId');
  for (const key of ['stateRevision', 'projectionRevision', 'requestQueueRevision'])
    revision(row[key], `$.${key}`);
  const requests = list(row['requests'], '$.requests').map((value, index) =>
    gmRequestRow(value, `$.requests[${String(index)}]`),
  );
  const ids = unique(
    requests.map((request) => request.requestId),
    '$.requests',
  );
  const selected = nullable(row['selectedRequestIdOrNull'], '$.selectedRequestIdOrNull', text);
  if (selected !== null && !ids.includes(selected))
    invalid('$.selectedRequestIdOrNull', 'request in the current queue', null);
  const limit = capacity(row['activePlayerCapacity'], '$.activePlayerCapacity');
  if (revision(row['occupiedActivePcCount'], '$.occupiedActivePcCount') > limit)
    invalid('$.occupiedActivePcCount', 'active PCs within capacity', null);
  raw(row['decisionReason'], '$.decisionReason');
  nullable(row['commandId'], '$.commandId', text);
  const context = record(row['returnContext'], '$.returnContext');
  const origin = oneOf(
    context['originFormId'],
    ['CMP-006', 'GM-002', 'CMP-009'],
    '$.returnContext.originFormId',
  );
  exact(
    context,
    origin === 'CMP-006' ? 'originFormId campaignId creationReceiptId' : 'originFormId campaignId',
    '$.returnContext',
  );
  literal(context['campaignId'], campaignId, '$.returnContext.campaignId');
  if (origin === 'CMP-006') text(context['creationReceiptId'], '$.returnContext.creationReceiptId');
  return validated(row);
}
/** Selection membership, verified GM authority, source action, and expected revisions belong to host preflight. */
export function networkGmRequestWorkflowPayloadValue(
  workflowId: string,
  value: unknown,
): NetworkGmAcceptToReviewPayload | NetworkGmRejectRequestPayload {
  const reject = workflowId === 'UI-CMD-DEVICE-REQUEST-REJECT';
  if (!reject && workflowId !== 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW')
    unrecognized('$.workflowCommandId', null);
  const row = exact(
    value,
    'campaignId requestId requestRevision' + (reject ? ' reason' : ''),
    '$.payload',
  );
  uuid(row['campaignId'], '$.payload.campaignId');
  text(row['requestId'], '$.payload.requestId');
  revision(row['requestRevision'], '$.payload.requestRevision');
  if (reject && text(row['reason'], '$.payload.reason').trim() === '')
    invalid('$.payload.reason', 'nonblank reason', null);
  return validated(row);
}
/** The host supplies summaries from its verified immutable submitted batch, not a browser selection. */
export function networkGmRequestDecisionReceiptValue(
  value: unknown,
  submittedSummaries: readonly NetworkGmRequestCandidateSummary[],
): NetworkGmRequestDecisionReceipt {
  const row = exact(
    value,
    'receiptId commandId workflowCommandId campaignId requestId requestOwnerDeviceId beforeRequestStatus afterRequestStatus beforeRequestRevision requestRevision decisionReasonOrNull candidateSnapshotChecksums authoritativeGmActorId timestamp',
    '$.receipt',
  );
  for (const key of ['receiptId', 'commandId', 'requestId', 'authoritativeGmActorId', 'timestamp'])
    text(row[key], `$.receipt.${key}`);
  uuid(row['campaignId'], '$.receipt.campaignId');
  uuid(row['requestOwnerDeviceId'], '$.receipt.requestOwnerDeviceId');
  const before = revision(row['beforeRequestRevision'], '$.receipt.beforeRequestRevision');
  const after = revision(row['requestRevision'], '$.receipt.requestRevision');
  if (before === Number.MAX_SAFE_INTEGER || after !== before + 1)
    invalid('$.receipt.requestRevision', 'one committed request revision', null);
  const workflow = oneOf(
    row['workflowCommandId'],
    ['UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW', 'UI-CMD-DEVICE-REQUEST-REJECT'],
    '$.receipt.workflowCommandId',
  );
  if (workflow === 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW') {
    literal(row['beforeRequestStatus'], 'PENDING', '$.receipt.beforeRequestStatus');
    literal(row['afterRequestStatus'], 'IN_REVIEW', '$.receipt.afterRequestStatus');
    literal(row['decisionReasonOrNull'], null, '$.receipt.decisionReasonOrNull');
  } else {
    oneOf(row['beforeRequestStatus'], ['PENDING', 'IN_REVIEW'], '$.receipt.beforeRequestStatus');
    literal(row['afterRequestStatus'], 'REJECTED', '$.receipt.afterRequestStatus');
    if (text(row['decisionReasonOrNull'], '$.receipt.decisionReasonOrNull').trim() === '')
      invalid('$.receipt.decisionReasonOrNull', 'nonblank public reason', null);
  }
  const expected = gmRequestCandidates(submittedSummaries, '$.submittedSummaries');
  const actual = list(row['candidateSnapshotChecksums'], '$.receipt.candidateSnapshotChecksums');
  if (actual.length !== expected.length)
    invalid('$.receipt.candidateSnapshotChecksums', 'exact submitted batch length', null);
  actual.forEach((value, index) => {
    const at = `$.receipt.candidateSnapshotChecksums[${String(index)}]`;
    literal(hash(value, at), expected[index]!.snapshotChecksum, at);
  });
  return validated(row);
}

function gmDraftScope(value: unknown): NetworkGmRequestDraftScope {
  const row = exact(value, 'gmLocalContextId campaignId sourceFormId', '$.scope');
  text(row['gmLocalContextId'], '$.scope.gmLocalContextId');
  uuid(row['campaignId'], '$.scope.campaignId');
  literal(row['sourceFormId'], 'NET-017', '$.scope.sourceFormId');
  return validated(row);
}
export function networkGmRequestClientValue(value: unknown): NetworkGmClientV3Message {
  const row = exact(
    value,
    'messageType protocolVersion draftUpdateId scope expectedRevisions expectedRequestQueueRevision values',
  );
  literal(row['messageType'], 'network.gm-request-draft.replace', '$.messageType');
  literal(row['protocolVersion'], 3, '$.protocolVersion');
  text(row['draftUpdateId'], '$.draftUpdateId');
  gmDraftScope(row['scope']);
  revisions(row['expectedRevisions'], '$.expectedRevisions');
  revision(row['expectedRequestQueueRevision'], '$.expectedRequestQueueRevision');
  networkGmRequestDraftValues(row['values']);
  return validated(row);
}
function gmDraftRefusal(value: unknown): void {
  const row = record(value, '$.refusal');
  switch (row['code']) {
    case 'INVALID_FIELD':
      exact(row, 'code field reason', '$.refusal');
      oneOf(row['field'], ['selectedRequestIdOrNull', 'decisionReason'], '$.refusal.field');
      literal(row['reason'], 'INVALID_VALUE', '$.refusal.reason');
      return;
    case 'STALE_REVISION':
      exact(row, 'code expected actual', '$.refusal');
      revisions(row['expected'], '$.refusal.expected');
      revisions(row['actual'], '$.refusal.actual');
      return;
    case 'STALE_QUEUE':
      exact(row, 'code expected actual', '$.refusal');
      revision(row['expected'], '$.refusal.expected');
      revision(row['actual'], '$.refusal.actual');
      return;
    case 'IDEMPOTENCY_CONFLICT':
    case 'DRAFT_UNAVAILABLE':
    case 'REVISION_OVERFLOW':
      exact(row, 'code', '$.refusal');
      return;
    default:
      return unrecognized('$.refusal.code', null);
  }
}
/** Replay may return the saved QUEUE family's CMP-006 view; it is never a new CREATE receipt. */
function gmQueueCampaignPayload(value: unknown, scope: NetworkGmRequestDraftScope): void {
  const path = '$.presentation.base.roleFilteredPayload';
  const row = exact(
    value,
    'gmLocalContextId hostDeviceId masterAuthorityRevision routeIdentityKind campaignId sourceCampaignDraftId status createdAt hostAddress hostPort networkInterface qrPayload activePlayerCapacity creationReceiptId creationCommandId hostBindRecovery',
    path,
  );
  literal(row['gmLocalContextId'], scope.gmLocalContextId, path + '.gmLocalContextId');
  literal(row['campaignId'], scope.campaignId, path + '.campaignId');
  literal(row['routeIdentityKind'], 'CAMPAIGN', path + '.routeIdentityKind');
  literal(row['status'], 'PAUSED', path + '.status');
  literal(row['masterAuthorityRevision'], 0, path + '.masterAuthorityRevision');
  uuid(row['hostDeviceId'], path + '.hostDeviceId');
  for (const key of [
    'sourceCampaignDraftId',
    'createdAt',
    'hostAddress',
    'networkInterface',
    'qrPayload',
    'creationReceiptId',
    'creationCommandId',
  ])
    text(row[key], path + '.' + key);
  const port = revision(row['hostPort'], path + '.hostPort');
  if (port < 1 || port > 65535) invalid(path + '.hostPort', 'valid TCP port', null);
  capacity(row['activePlayerCapacity'], path + '.activePlayerCapacity');
  const recovery = exact(row['hostBindRecovery'], 'status reasonCode', path + '.hostBindRecovery');
  oneOf(recovery['status'], ['RESERVED', 'UNAVAILABLE'], path + '.hostBindRecovery.status');
  if (recovery['status'] === 'RESERVED')
    literal(recovery['reasonCode'], null, path + '.hostBindRecovery.reasonCode');
  else
    oneOf(
      recovery['reasonCode'],
      ['PORT_UNAVAILABLE', 'BIND_FAILED'],
      path + '.hostBindRecovery.reasonCode',
    );
}
export function networkGmRequestHostValue(
  value: unknown,
  vocabulary: WireV2Vocabulary,
): NetworkGmHostV3Message {
  const message = record(value, '$');
  literal(message['protocolVersion'], 3, '$.protocolVersion');
  if (message['messageType'] === 'network.gm-request-draft.refusal') {
    const row = exact(
      value,
      'messageType protocolVersion draftUpdateId scope revisions presentationUnchanged refusal',
    );
    text(row['draftUpdateId'], '$.draftUpdateId');
    gmDraftScope(row['scope']);
    const current = revisions(row['revisions'], '$.revisions');
    literal(row['presentationUnchanged'], true, '$.presentationUnchanged');
    gmDraftRefusal(row['refusal']);
    const refusal = record(row['refusal'], '$.refusal');
    if (refusal['code'] === 'STALE_REVISION') {
      const actual = revisions(refusal['actual'], '$.refusal.actual');
      for (const axis of AXES) literal(actual[axis], current[axis], '$.refusal.actual.' + axis);
    }
    return validated(row);
  }
  if (message['messageType'] !== 'network.gm-request-draft.result')
    return unrecognized('$.messageType', null);
  const row = exact(
    value,
    'messageType protocolVersion draftUpdateId scope changed appliedRevisions appliedRequestQueueRevision revisions requestQueueRevision projectionRole presentation',
  );
  const id = text(row['draftUpdateId'], '$.draftUpdateId'),
    scope = gmDraftScope(row['scope']);
  if (typeof row['changed'] !== 'boolean') invalid('$.changed', 'boolean', null);
  const applied = revisions(row['appliedRevisions'], '$.appliedRevisions'),
    current = revisions(row['revisions'], '$.revisions');
  const appliedQueue = revision(
      row['appliedRequestQueueRevision'],
      '$.appliedRequestQueueRevision',
    ),
    currentQueue = revision(row['requestQueueRevision'], '$.requestQueueRevision');
  if (
    AXES.some((axis) => current[axis] < applied[axis]) ||
    currentQueue < appliedQueue ||
    current.projectionRevision < current.stateRevision ||
    applied.projectionRevision < applied.stateRevision ||
    current.actorVisibilityRevision > current.stateRevision ||
    applied.actorVisibilityRevision > applied.stateRevision
  )
    invalid('$.revisions', 'ordered GM queue revision owners', null);
  literal(row['projectionRole'], 'gm', '$.projectionRole');
  const presentation = exact(row['presentation'], 'base layers', '$.presentation');
  const layers = list(
    presentation['layers'],
    '$.presentation.layers',
  ) as readonly PresentedLayerForm[];
  const base = record(presentation['base'], '$.presentation.base');
  const admission = typeof base['formId'] === 'string' && isAdmissionGmForm(base['formId']);
  if (!admission && layers.length !== 0)
    invalid('$.presentation.layers', 'empty GM queue layers', null);
  if (base['formId'] === 'NET-017') {
    const payload = networkGmRequestProjectionValue(base['roleFilteredPayload']);
    literal(
      payload.contextId,
      scope.gmLocalContextId,
      '$.presentation.base.roleFilteredPayload.contextId',
    );
    literal(
      payload.campaignId,
      scope.campaignId,
      '$.presentation.base.roleFilteredPayload.campaignId',
    );
    literal(
      payload.stateRevision,
      current.stateRevision,
      '$.presentation.base.roleFilteredPayload.stateRevision',
    );
    literal(
      payload.projectionRevision,
      current.projectionRevision,
      '$.presentation.base.roleFilteredPayload.projectionRevision',
    );
    literal(
      payload.requestQueueRevision,
      currentQueue,
      '$.presentation.base.roleFilteredPayload.requestQueueRevision',
    );
  } else if (base['formId'] === 'CMP-006')
    gmQueueCampaignPayload(base['roleFilteredPayload'], scope);
  else if (admission) {
    admissionGmPresentationValue(base as unknown as PresentedBaseForm, layers, current);
    const payload = record(base['roleFilteredPayload'], '$.roleFilteredPayload');
    literal(payload['contextId'], scope.gmLocalContextId, '$.contextId');
    literal(payload['campaignId'], scope.campaignId, '$.campaignId');
  } else return unrecognized('$.presentation.base.formId', null);
  const bindings = list(base['routeBindings'], '$.presentation.base.routeBindings');
  if (bindings.length !== 1)
    invalid('$.presentation.base.routeBindings', 'one campaign binding', null);
  const binding = exact(
    bindings[0],
    'parameterIndex source value',
    '$.presentation.base.routeBindings[0]',
  );
  literal(binding['parameterIndex'], 0, '$.presentation.base.routeBindings[0].parameterIndex');
  literal(binding['source'], 'inherited', '$.presentation.base.routeBindings[0].source');
  literal(binding['value'], scope.campaignId, '$.presentation.base.routeBindings[0].value');
  const encoded = encodeHostMessageV2(
    {
      messageType: 'projection.snapshot',
      protocolVersion: 2,
      projectionRole: 'gm',
      revisions: current,
      presentation: {
        assignment: { reason: 'RECONNECT', correlationId: id },
        base: base as unknown as PresentedBaseForm,
        layers,
      },
    },
    vocabulary,
  );
  if (!encoded.ok) invalid('$.presentation', 'valid signed GM queue presentation', null);
  return validated(row);
}

/** Standalone syntax contracts; registering a family and granting authority belong to the host. */
function decodeNetworkFamily<T>(source: string, reader: (value: unknown) => T): DecodeResult<T> {
  // JSON.parse would otherwise coerce an object and invoke its custom getters.
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
  const result = wireCodecPrimitives.parse(source, reader);
  return result.ok ? result : { ok: false, refusal: redactProtocolInputRefusal(result.refusal) };
}

function encodeNetworkFamily<T>(value: T, reader: (candidate: unknown) => T): EncodeResult {
  const result = wireCodecPrimitives.encode(value, reader);
  // The JSON prewalk can fail before the closed reader sees an unknown private property name.
  return result.ok
    ? result
    : { ok: false, refusal: { ...redactProtocolInputRefusal(result.refusal), path: '$' } };
}

export const encodeNetworkClientMessageV3 = (value: NetworkClientV3Message): EncodeResult =>
  encodeNetworkFamily(value, networkClientValue);

export const decodeNetworkHostMessageV3 = (
  source: string,
  vocabulary: WireV2Vocabulary,
): DecodeResult<NetworkHostV3Message> =>
  decodeNetworkFamily(source, (value) => networkHostValue(value, vocabulary));

export const encodeNetworkHostMessageV3 = (
  value: NetworkHostV3Message,
  vocabulary: WireV2Vocabulary,
): EncodeResult =>
  encodeNetworkFamily(value, (candidate) => networkHostValue(candidate, vocabulary));

export const decodeNetworkGmRequestClientMessageV3 = (
  source: string,
): DecodeResult<NetworkGmClientV3Message> =>
  decodeNetworkFamily(source, networkGmRequestClientValue);

export const encodeNetworkGmRequestClientMessageV3 = (
  value: NetworkGmClientV3Message,
): EncodeResult => encodeNetworkFamily(value, networkGmRequestClientValue);

export const decodeNetworkGmRequestHostMessageV3 = (
  source: string,
  vocabulary: WireV2Vocabulary,
): DecodeResult<NetworkGmHostV3Message> =>
  decodeNetworkFamily(source, (value) => networkGmRequestHostValue(value, vocabulary));

export const encodeNetworkGmRequestHostMessageV3 = (
  value: NetworkGmHostV3Message,
  vocabulary: WireV2Vocabulary,
): EncodeResult =>
  encodeNetworkFamily(value, (candidate) => networkGmRequestHostValue(candidate, vocabulary));
