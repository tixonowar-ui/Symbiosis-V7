import type { ActionKey } from '@generated/types/atlas.js';
import type { PresentedBaseForm } from '../../shared/wire-v2-protocol.js';
import type {
  WorkflowCommandCapabilityId,
  JsonObject,
  JsonValue,
} from '../../shared/wire-protocol.js';
import type {
  PublicFinalCandidateSummary,
  CapacityForecast,
} from '../../shared/device-admission.js';
import type {
  NetworkApplicationProjection,
  NetworkPublicErrorCode,
  NetworkPublicProvenance,
  NetworkDiscoveredHost,
} from '../../shared/network-application.js';
import type {
  LocalNetworkApplication,
  NetworkPreparedCandidate,
} from '../../persistence/network-local-application.js';
import type { PeerCampaignHeader } from '../campaign-peer-handshake.js';
import type { CampaignDiscoveryScan } from '../campaign-discovery.js';
import { parseCampaignLanAddress } from '../campaign-lan-address.js';
import { isNetworkApplicationProjection } from '../../shared/network-application-codec.js';

export const NETWORK_DIAGNOSTICS: Readonly<Record<NetworkPublicErrorCode, string>> = {
  INVALID_ADDRESS: 'Проверьте адрес и порт сервера.',
  CAMPAIGN_UNAVAILABLE: 'Кампания сейчас недоступна.',
  AMBIGUOUS_CAMPAIGN: 'По этому адресу найдено несколько кампаний. Используйте QR нужной кампании.',
  INCOMPATIBLE_BASELINE: 'Версии данных приложения и кампании несовместимы.',
  HOST_IDENTITY_CHANGED: 'Подтверждённый ключ сервера изменился.',
  PEER_UNAVAILABLE: 'Не удалось связаться с сервером.',
  UNCONFIRMED_OUTCOME:
    'Результат отправленной команды пока не подтверждён. Дождитесь восстановления связи.',
};
function publicObject(value: JsonValue | undefined): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('network public facts unavailable');
  return value as JsonObject;
}
function publicText(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error('network public text unavailable');
  return value;
}
export function candidateSummary(
  c: NetworkPreparedCandidate,
  tabId: string,
): PublicFinalCandidateSummary {
  const metadata = publicObject(c.exportDocument['metadata']);
  return {
    sourceUuid: c.descriptor.sourceUuid,
    sourceSnapshotId: c.descriptor.sourceSnapshotId,
    finalSnapshotVersion: c.descriptor.finalSnapshotVersion,
    metadataRevision: c.descriptor.metadataRevision,
    candidateSnapshotChecksum: c.descriptor.sourceChecksum,
    requestedControllerSeat: tabId,
    name: publicText(metadata['name']),
  };
}
export function networkCapacity(campaign: PeerCampaignHeader, selected: number): CapacityForecast {
  if (!Number.isInteger(selected) || selected < 0 || selected > 3)
    throw new Error('network selection unavailable');
  return {
    campaignRevision: campaign.revisions.stateRevision,
    activePlayerCapacity: campaign.activePlayerCapacity,
    activePcCount: campaign.activePcCount,
    selectedCandidateCount: selected as 0 | 1 | 2 | 3,
    fitsCurrentCapacity: selected <= campaign.activePlayerCapacity - campaign.activePcCount,
  };
}
export interface NetworkProjectionInput {
  readonly state: LocalNetworkApplication;
  readonly contextId: string;
  readonly supported: readonly WorkflowCommandCapabilityId[];
  readonly campaign: PeerCampaignHeader | null;
  readonly candidates: readonly NetworkPreparedCandidate[];
  readonly discovery: CampaignDiscoveryScan | null;
  readonly discoveryUnavailable: boolean;
  readonly baselineVersion: string;
  readonly isCompatibleBaseline?: (version: string) => boolean;
  readonly attemptCount: number;
}
/** Explicit public allowlist; original FINAL witnesses and peer proofs never enter this object. */
export function projectNetworkApplication(i: NetworkProjectionInput): PresentedBaseForm {
  const s = i.state,
    session = s.sessionOrNull,
    pending = s.pendingCommandIdOrNull !== null;
  const status = s.schemaVersion === 2 ? s.requestReviewOrNull?.requestStatus : undefined;
  const idle =
    !pending &&
    (s.requestOrNull === null ||
      s.requestOrNull.closureOrNull !== null ||
      status === 'REJECTED' ||
      status === 'CANCELLED');
  const live =
    i.campaign !== null &&
    session !== null &&
    i.campaign.campaignId === session.campaignProof.campaignId;
  const common = {
    networkScopeId: s.networkScopeId,
    contextId: i.contextId,
    deviceId: s.ownerDeviceId,
    controllerSeat: s.tabId,
    stateRevision: s.stateRevision,
    projectionRevision: s.projectionRevision,
    actorVisibilityRevision: s.actorVisibilityRevision,
    draftRevision: s.draftRevision,
    campaignIdOrNull: session?.campaignProof.campaignId ?? null,
    connectionState: pending
      ? ('CONNECTING' as const)
      : live
        ? ('CONNECTED_TECHNICAL' as const)
        : session === null
          ? ('NO_TECHNICAL_SESSION' as const)
          : ('LOST' as const),
    pendingCommandIdOrNull: s.pendingCommandIdOrNull,
  };
  let parsed: ReturnType<typeof parseCampaignLanAddress> | null = null;
  try {
    if (s.addressOrQrPayload !== '') parsed = parseCampaignLanAddress(s.addressOrQrPayload);
  } catch {
    /* An editable invalid address has no executable OPEN. */
  }
  const available: ActionKey[] = [];
  const add = (key: string, yes = true) => {
    if (yes) available.push(key as ActionKey);
  };
  const capable = (id: string) => i.supported.some((v) => v === id);
  const fresh =
    session === null &&
    s.plannedAttemptIdOrNull !== null &&
    s.plannedAttemptIdOrNull !== s.lastAttemptIdOrNull;
  const summaries = (c: readonly NetworkPreparedCandidate[]) =>
    c.map((v) => candidateSummary(v, s.tabId));
  let payload: NetworkApplicationProjection;
  switch (s.formId) {
    case 'NET-001':
      payload = {
        ...common,
        activeRole: 'PLAYER',
        discoveryState: i.discoveryUnavailable
          ? 'UNAVAILABLE'
          : i.discovery === null
            ? 'NOT_STARTED'
            : 'COMPLETE',
        discoveredHosts: (i.discovery?.offers ?? []).map((o): NetworkDiscoveredHost => {
          const a = parseCampaignLanAddress(o.origin);
          return {
            campaignId: o.campaign.campaignId,
            title: o.campaign.title,
            locator: {
              hostAddress: a.host,
              hostPort: a.port,
              campaignHintOrNull: o.campaign.campaignId,
            },
            campaignStatus: 'PAUSED',
            activePlayerCapacity: o.campaign.activePlayerCapacity,
            activePcCount: o.campaign.activePcCount,
            compatibility:
              (i.isCompatibleBaseline?.(o.campaign.baselineVersion) ??
              o.campaign.baselineVersion === i.baselineVersion)
                ? 'COMPATIBLE'
                : 'INCOMPATIBLE',
          };
        }),
        discoveryTruncated: i.discovery?.truncated ?? false,
        lastAddressOrNull: s.addressOrQrPayload || null,
        returnContext: 'PLAYER_MENU',
        connectionAttemptIdOrNull: s.lastAttemptIdOrNull,
      };
      add('NET-001::CTA::001', idle);
      add('NET-001::CTA::002', idle && live);
      add('NET-001::CTA::003', idle && session === null);
      break;
    case 'NET-002':
      if (s.plannedAttemptIdOrNull === null) throw new Error('network attempt unavailable');
      payload = {
        ...common,
        addressOrQrPayload: s.addressOrQrPayload,
        parsedHost: parsed?.host ?? null,
        parsedPort: parsed?.port ?? null,
        protocolVersion: 3,
        campaignHintOrNull: parsed?.campaignId ?? null,
        parseStatus: s.addressOrQrPayload === '' ? 'EMPTY' : parsed === null ? 'INVALID' : 'VALID',
        parseDiagnostic:
          parsed === null && s.addressOrQrPayload !== ''
            ? NETWORK_DIAGNOSTICS.INVALID_ADDRESS
            : null,
        attemptId: s.plannedAttemptIdOrNull,
        commandId: s.pendingCommandIdOrNull,
      };
      add('NET-002::CTA::001', idle);
      add('NET-002::CTA::002', idle && live);
      add(
        'NET-002::CTA::003',
        idle && fresh && parsed !== null && capable('UI-CMD-CONNECTION-OPEN'),
      );
      add('NET-002::CTA::004', idle && session === null);
      add('NET-002::CTA::005', idle && session === null);
      break;
    case 'NET-003': {
      if (session === null || i.campaign === null) throw new Error('network campaign unavailable');
      const forecast = networkCapacity(i.campaign, s.selectedCandidates.length);
      payload = {
        ...common,
        ownRequestIdOrNull:
          s.requestOrNull?.closureOrNull === null ? s.requestOrNull.requestId : null,
        campaignId: session.campaignProof.campaignId,
        campaignStatus: 'PAUSED',
        sessionId: session.technicalSessionId,
        connectionRevision: session.connectionRevision,
        eligibleFinalCandidates: summaries(i.candidates),
        selectedCandidates: s.selectedCandidates,
        capacityForecast: forecast,
      };
      add(
        'NET-003::CTA::001',
        idle && live && s.selectedCandidates.length > 0 && forecast.fitsCurrentCapacity,
      );
      add(
        'NET-003::CTA::002',
        idle && live && s.selectedCandidates.length === 1 && forecast.fitsCurrentCapacity,
      );
      add(
        'NET-003::CTA::003',
        !pending && s.requestOrNull !== null && s.requestOrNull.closureOrNull === null,
      );
      break;
    }
    case 'NET-004': {
      const b = s.preparedBatchOrNull;
      if (b === null || i.campaign === null) throw new Error('network batch unavailable');
      const forecast = networkCapacity(i.campaign, b.candidates.length);
      payload = {
        ...common,
        sessionId: b.technicalSessionId,
        requestId: b.requestId,
        selectedLocalCharacterUuids: b.candidates.map((c) => c.descriptor.sourceUuid),
        snapshotChecksums: b.candidates.map((c) => ({
          localCharacterUuid: c.descriptor.sourceUuid,
          candidateSnapshotChecksum: c.descriptor.sourceChecksum,
        })),
        campaignId: b.campaignProof.campaignId,
        connectionRevision: b.connectionRevision,
        commandId: s.pendingCommandIdOrNull,
        batchCharacterSummaries: summaries(b.candidates),
        capacityForecast: forecast,
      };
      add('NET-004::CTA::001', idle);
      add(
        'NET-004::CTA::002',
        idle && live && forecast.fitsCurrentCapacity && capable('UI-CMD-DEVICE-REQUEST-SUBMIT'),
      );
      add('NET-004::CTA::003', idle);
      break;
    }
    case 'NET-005': {
      const r = s.requestOrNull,
        b = s.preparedBatchOrNull;
      if (r === null || b === null || r.closureOrNull !== null)
        throw new Error('network request unavailable');
      const requestStatus =
        s.schemaVersion === 2 ? (s.requestReviewOrNull?.requestStatus ?? r.status) : r.status;
      if (requestStatus === 'CANCELLED')
        throw new Error('Cancelled request must leave the request screen');
      payload = {
        ...common,
        sessionId: r.technicalSessionId,
        requestId: r.requestId,
        requestOwnerDeviceId: s.ownerDeviceId,
        batchCharacterSummaries: summaries(b.candidates),
        requestStatus,
        gmMessage:
          s.schemaVersion === 2
            ? (s.requestReviewOrNull?.proof.decisions.at(-1)?.decisionReasonOrNull ?? null)
            : null,
        requestRevision:
          s.schemaVersion === 2
            ? (s.requestReviewOrNull?.requestRevision ?? r.requestRevision)
            : r.requestRevision,
        cancelReason: s.cancelReason,
        commandId: s.pendingCommandIdOrNull,
      };
      add(
        'NET-005::CTA::001',
        !pending &&
          live &&
          (status === undefined || status === 'PENDING') &&
          s.cancelReason.trim().length > 0 &&
          capable('UI-CMD-DEVICE-REQUEST-CANCEL'),
      );
      add('NET-005::CTA::003', !pending && status === 'REJECTED');
      break;
    }
    case 'NET-011': {
      const attemptId = s.lastAttemptIdOrNull ?? s.plannedAttemptIdOrNull;
      if (attemptId === null) throw new Error('network failed attempt unavailable');
      const code = s.diagnosticCodeOrNull ?? 'PEER_UNAVAILABLE';
      payload = {
        ...common,
        attemptId,
        retryAttemptIdOrNull: fresh ? s.plannedAttemptIdOrNull : null,
        activeRole: 'PLAYER',
        activeSeatOrGm: s.tabId,
        lastAddressOrQrPayload: s.addressOrQrPayload,
        lastParsedHostPort:
          parsed === null
            ? null
            : {
                hostAddress: parsed.host,
                hostPort: parsed.port,
                campaignHintOrNull: parsed.campaignId,
              },
        errorCode: code,
        humanDiagnostic: NETWORK_DIAGNOSTICS[code],
        retryCount: Math.max(0, i.attemptCount - 1),
        connectionState: 'UNAVAILABLE',
        lastConfirmedStateRevision: s.stateRevision,
        lastConfirmedProjectionRevision: s.projectionRevision,
        resumeContextOrNull: null,
        localDataUntouched: true,
        commandId: s.pendingCommandIdOrNull,
      };
      add(
        'NET-011::CTA::003',
        idle && fresh && parsed !== null && capable('UI-CMD-CONNECTION-OPEN'),
      );
      add('NET-011::CTA::004', idle);
      add('NET-011::CTA::005', idle);
      break;
    }
    case 'CHR-027': {
      const ref = s.selectedCandidates[0],
        candidate = i.candidates.find((c) => c.descriptor.sourceUuid === ref?.sourceUuid);
      if (ref === undefined || candidate === undefined)
        throw new Error('network candidate unavailable');
      const currentCandidate = candidateSummary(candidate, s.tabId);
      const selectionCurrent =
        ref.finalSnapshotVersion === currentCandidate.finalSnapshotVersion &&
        ref.metadataRevision === currentCandidate.metadataRevision &&
        ref.candidateSnapshotChecksum === currentCandidate.candidateSnapshotChecksum &&
        ref.requestedControllerSeat === s.tabId;
      const eligible =
        live && selectionCurrent && networkCapacity(i.campaign, 1).fitsCurrentCapacity;
      const raw = publicObject(candidate.exportDocument['provenance']);
      const provenance: NetworkPublicProvenance = {
        registryVersion: publicText(raw['registryVersion']),
        catalogVersion: publicText(raw['catalogVersion']),
        builtAgainstTuple: publicText(raw['builtAgainstTuple']),
        sourceUuid: ref.sourceUuid,
        sourceSnapshotId: candidate.descriptor.sourceSnapshotId,
        metadataRevision: currentCandidate.metadataRevision,
        sourceChecksum: currentCandidate.candidateSnapshotChecksum,
        finalSaveReceiptId: publicText(raw['finalSaveReceiptId']),
        finalSnapshotVersion: currentCandidate.finalSnapshotVersion,
      };
      payload = {
        ...common,
        localCharacterUuid: ref.sourceUuid,
        finalSnapshotVersion: currentCandidate.finalSnapshotVersion,
        candidateSnapshotChecksum: currentCandidate.candidateSnapshotChecksum,
        eligibleCampaignIds: eligible ? [session.campaignProof.campaignId] : [],
        selectedCampaignId: eligible ? s.selectedCampaignIdOrNull : null,
        requestedControllerSeat: s.requestedControllerSeatOrNull,
        sourceUuidAndProvenance: provenance,
        submissionStatus: 'DRAFT',
        commandId: s.pendingCommandIdOrNull,
      };
      add(
        'CHR-027::CTA::001',
        idle &&
          eligible &&
          s.selectedCampaignIdOrNull === session?.campaignProof.campaignId &&
          s.requestedControllerSeatOrNull === s.tabId,
      );
      add('CHR-027::CTA::002', idle);
      break;
    }
  }
  if (!isNetworkApplicationProjection(s.formId, payload))
    throw new Error('invalid network projection');
  return {
    formId: s.formId,
    formType: 'screen',
    availableActionKeys: available,
    roleFilteredPayload: payload,
    routeTemplate:
      s.formId === 'CHR-027'
        ? '/player/characters/:localCharacterId/create/chr-027'
        : `/player/campaigns/:campaignId/network/${s.formId.toLowerCase()}`,
    routeBindings: [
      {
        parameterIndex: 0,
        source: 'inherited',
        value:
          s.formId === 'CHR-027'
            ? s.selectedCandidates[0]!.sourceUuid
            : (session?.campaignProof.campaignId ?? `unbound:${s.networkScopeId}`),
      },
    ],
  };
}
import type { GmRequestReviewView } from '../../persistence/campaign-creation.js';
import type { VerifiedGmRequestQueue } from '../../persistence/network-device-request.js';
import type { CurrentPausedCampaignHeader } from '../../persistence/current-paused-campaign.js';
import type {
  Net017Projection,
  NetworkGmRequestQueueRow,
} from '../../shared/network-application.js';
import { networkGmRequestProjectionValue } from '../../shared/network-application-codec.js';

/** The GM queue exposes the submitted export byte digest, never the private replay witness. */
export function projectGmRequestQueue(i: {
  readonly view: GmRequestReviewView;
  readonly queue: VerifiedGmRequestQueue;
  readonly campaign: CurrentPausedCampaignHeader;
  readonly connections: readonly {
    readonly requestId: string;
    readonly requestOwnerDeviceId: string;
    readonly connected: boolean;
  }[];
  readonly supported: readonly WorkflowCommandCapabilityId[];
}): PresentedBaseForm {
  const { view, queue, campaign } = i;
  if (
    view.formId !== 'NET-017' ||
    queue.campaignId !== view.campaignId ||
    campaign.campaignId !== view.campaignId ||
    view.requestQueueRevision !== queue.requestQueueRevision
  )
    throw new Error('GM queue projection source mismatch');
  const requests = queue.requests
    .filter((r) => r.requestStatus !== 'CANCELLED')
    .map((r): NetworkGmRequestQueueRow => {
      if (r.requestStatus === 'CANCELLED') throw new Error('Cancelled request has no visible row');
      const original = r.submittedRequest,
        lane = r.proof.laneProvenance;
      if (lane === null) throw new Error('GM queue requires the original owner input lane');
      const localControllerSeatId =
        lane.kind === 'SUBMITTED_BATCH'
          ? original.batch.localControllerSeatId
          : lane.receipt.binding.localControllerSeatId;
      if (localControllerSeatId === undefined) throw new Error('GM queue lane unavailable');
      const connection = i.connections.find((v) => v.requestId === original.requestId);
      if (
        connection === undefined ||
        connection.requestOwnerDeviceId !== original.principal.peerIdentity.ownerDeviceId
      )
        throw new Error('GM queue owner connection mismatch');
      const decision = r.proof.decisions.at(-1);
      return {
        requestId: original.requestId,
        requestOwnerDeviceId: original.principal.peerIdentity.ownerDeviceId,
        requestStatus: r.requestStatus,
        requestRevision: r.requestRevision,
        connectionState: connection.connected ? 'CONNECTED_TECHNICAL' : 'LOST',
        batchCharacterSummaries: original.batch.candidates.map((candidate) => ({
          sourceUuid: candidate.descriptor.sourceUuid,
          snapshotChecksum: candidate.descriptor.exportBytesSha256,
          name: publicText(publicObject(candidate.exportDocument['metadata'])['name']),
          sourceSnapshotId: candidate.descriptor.sourceSnapshotId,
          localControllerSeatId,
        })),
        requestedCandidateCount: original.batch.candidates.length as 1 | 2 | 3,
        gmMessageOrNull: decision?.decisionReasonOrNull ?? null,
        decisionReceiptIdOrNull: decision?.receiptId ?? null,
      };
    });
  const payload: Net017Projection = {
    contextId: view.gmLocalContextId,
    campaignId: view.campaignId,
    stateRevision: view.stateRevision,
    projectionRevision: view.projectionRevision,
    requestQueueRevision: view.requestQueueRevision,
    requests,
    activePlayerCapacity: campaign.activePlayerCapacity as 1 | 2 | 3 | 4 | 5,
    occupiedActivePcCount: campaign.activePcCount,
    commandId: null,
    returnContext: view.returnContext,
    ...view.values,
  };
  networkGmRequestProjectionValue(payload);
  const selected = requests.find((r) => r.requestId === view.values.selectedRequestIdOrNull);
  const actions: ActionKey[] = [];
  if (
    selected?.requestStatus === 'PENDING' &&
    i.supported.includes('UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW')
  )
    actions.push('NET-017::CTA::007');
  if (
    (selected?.requestStatus === 'PENDING' || selected?.requestStatus === 'IN_REVIEW') &&
    view.values.decisionReason.trim().length > 0 &&
    i.supported.includes('UI-CMD-DEVICE-REQUEST-REJECT')
  )
    actions.push('NET-017::CTA::008');
  actions.push('NET-017::CTA::009');
  return {
    formId: 'NET-017',
    formType: 'screen',
    routeTemplate: '/master/campaigns/:campaignId/network/net-017',
    routeBindings: [{ parameterIndex: 0, source: 'inherited', value: view.campaignId }],
    availableActionKeys: actions,
    roleFilteredPayload: payload,
  };
}
