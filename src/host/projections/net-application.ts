import type { ActionKey } from '@generated/types/atlas.js';
import type { PresentedBaseForm, PresentedLayerForm } from '../../shared/wire-v2-protocol.js';
import type { GmAdmissionView } from '../../persistence/campaign-creation.js';
import type { AdmissionDecisionRead } from '../../persistence/campaign-admission-decision.js';
import type { AdmissionHistory } from '../../persistence/campaign-admission-player.js';
import {
  admissionSelectedGroupLabels,
  type createCampaignAdmissionRules,
} from '../campaign-admission-service.js';
import type { AdmissionGmViewFormId } from '../../shared/campaign-admission-review.js';
import { isDeepStrictEqual } from 'node:util';
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
import { admissionGmProjectionValue } from '../../shared/campaign-admission-presentation.js';
import { admissionOwnerProjectionValue } from '../../shared/campaign-admission-presentation.js';
import {
  localAdmissionForm,
  type LocalAdmissionRead,
} from '../../persistence/local-campaign-admission.js';
import type { AdmissionCapacityResponse } from '../campaign-admission-peer-codec.js';

export function projectOwnerAdmission(i: {
  admission: LocalAdmissionRead;
  application: LocalNetworkApplication;
  contextId: string;
  networkScopeId: string;
  controllerSeat: string;
  itemLabels: readonly { itemTypeId: string; name: string }[];
  capacity: Extract<AdmissionCapacityResponse, { outcome: 'CAPACITY' }> | null;
  connected: boolean;
  supported: readonly WorkflowCommandCapabilityId[];
}): PresentedBaseForm {
  const state = i.admission,
    publication = state.record.publication,
    notice = publication.gmDecision;
  if (
    state.returnedOrNull !== null ||
    i.application.ownerDeviceId !== notice.requestOwnerDeviceId ||
    i.application.networkScopeId !== state.record.scope.networkScopeId ||
    (i.controllerSeat !== state.record.originalTabId &&
      !state.additionalTabs.some(
        (t) => t.tabId === i.controllerSeat && t.networkScopeId === i.networkScopeId,
      ))
  )
    throw new Error('owner admission scope mismatch');
  const proposal = publication.proposalOrNull,
    receipt = state.receiptOrNull,
    formId = localAdmissionForm(state);
  const capacity =
    i.capacity === null || proposal === null
      ? null
      : {
          evaluatedCampaignRevision: i.capacity.campaign.revisions.stateRevision,
          activePlayerCapacity: i.capacity.campaign.activePlayerCapacity,
          occupiedCampaignPlaceCount: i.capacity.occupiedCampaignPlaceCount,
          activePcCount: i.capacity.campaign.activePcCount,
          candidateCount: proposal.fullCampaignCopyDiffs.length,
          fitsCurrentCapacity:
            proposal.fullCampaignCopyDiffs.length <=
            i.capacity.campaign.activePlayerCapacity -
              i.capacity.occupiedCampaignPlaceCount +
              (receipt?.decision === 'ACCEPT' ? receipt.copies.length : 0),
        };
  const actions: ActionKey[] = [];
  if (formId === 'NET-027') {
    if (receipt?.decision === 'ACCEPT') actions.push('NET-027::CTA::001');
    else if (receipt?.decision === 'DECLINE') actions.push('NET-027::CTA::002');
    else if (
      i.connected &&
      capacity !== null &&
      state.pendingDecisionOrNull === null &&
      i.controllerSeat === state.record.originalTabId &&
      i.supported.includes('UI-CMD-ADMISSION-PLAYER-DECIDE')
    ) {
      if (capacity.fitsCurrentCapacity) actions.push('NET-027::CTA::003');
      actions.push('NET-027::CTA::004');
    }
  } else if (formId === 'NET-006') actions.push('NET-006::CTA::001');
  else {
    if (proposal !== null) actions.push('NET-007::CTA::001');
    if (i.connected) actions.push('NET-007::CTA::002');
    actions.push('NET-007::CTA::003');
  }
  const payload = {
    contextId: i.contextId,
    networkScopeId: i.networkScopeId,
    controllerSeat: i.controllerSeat,
    deviceId: notice.requestOwnerDeviceId,
    campaignId: notice.campaignId,
    requestIdOrNull: notice.requestId,
    admissionBatchId: notice.admissionBatchId,
    stateRevision: i.application.stateRevision,
    projectionRevision: i.application.projectionRevision,
    actorVisibilityRevision: i.application.actorVisibilityRevision,
    draftRevision: i.application.draftRevision,
    publication,
    receiptOrNull: receipt,
    pendingCommandIdOrNull: state.pendingDecisionOrNull?.commandId ?? null,
    campaignRevisionOrNull: i.capacity?.campaign.revisions.stateRevision ?? null,
    technicalSessionAvailable: i.connected,
    itemLabels: i.itemLabels,
    admissionOrigin: 'DEVICE_REQUEST',
    ownerProvenance: {
      kind: 'DEVICE_REQUEST',
      requestId: notice.requestId,
      requestOwnerDeviceId: notice.requestOwnerDeviceId,
    },
    fullCampaignCopyDiffs: proposal?.fullCampaignCopyDiffs ?? [],
    blockers: proposal?.blockers ?? [],
    proposalRevision: proposal?.proposalRevision ?? null,
    proposalChecksum: proposal?.proposalChecksum ?? null,
    decision: receipt?.decision ?? null,
    commandId: state.pendingDecisionOrNull?.commandId ?? null,
    capacityRecheck: capacity,
    controllerDeviceRecheck:
      i.connected && state.record.scope.ownerDeviceId === notice.requestOwnerDeviceId,
    ownCampaignCopies: receipt?.copies ?? [],
    controllerBindings: receipt?.controllerProofOrNull?.controllerBindings ?? [],
    campaignStatus: 'PAUSED',
    readyStatus: 'NOT_READY',
    startStatus: 'NOT_STARTED',
    result:
      notice.decision === 'REJECT'
        ? 'GM_REJECTED'
        : receipt?.decision === 'DECLINE'
          ? 'PLAYER_DECLINED'
          : receipt?.decision === 'ACCEPT'
            ? 'PLAYER_ACCEPTED'
            : 'AWAITING_PLAYER',
    gmReasonOrNull: notice.reasonOrNull,
    decisionReceiptId: receipt?.receiptId ?? notice.receiptId,
    signedReturnContextOrNull: null,
  } as unknown as JsonObject;
  admissionOwnerProjectionValue(formId, payload);
  return {
    formId,
    formType: 'screen',
    routeTemplate: `/player/campaigns/:campaignId/network/${formId.toLowerCase()}`,
    routeBindings: [{ parameterIndex: 0, source: 'inherited', value: notice.campaignId }],
    availableActionKeys: actions,
    roleFilteredPayload: payload,
  };
}

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

/** GM-only allowlist. A partial review is presented as inputs/core, never as a publishable sheet. */
export function projectGmAdmission(i: {
  readonly view: GmAdmissionView;
  readonly current: AdmissionDecisionRead;
  readonly history: AdmissionHistory;
  readonly service: ReturnType<typeof createCampaignAdmissionRules>;
  readonly campaign: PeerCampaignHeader;
  readonly supported: readonly WorkflowCommandCapabilityId[];
}) {
  const { view, current, service, history, campaign } = i;
  if (
    !view.active ||
    view.admissionBatchId !== current.review.current.admissionBatchId ||
    view.campaignId !== campaign.campaignId ||
    view.campaignId !== current.review.source.scope.campaignId ||
    view.ownerDeviceId !== current.review.source.scope.ownerDeviceId ||
    view.gmLocalContextId !== current.review.source.scope.gmLocalContextId ||
    history.checkpoint.campaignId !== view.campaignId ||
    !isDeepStrictEqual(campaign.revisions, {
      stateRevision: history.checkpoint.stateRevision,
      projectionRevision: history.checkpoint.projectionRevision,
      actorVisibilityRevision: history.checkpoint.actorVisibilityRevision,
    }) ||
    [...history.groups.values()].some((group) => group.campaignId !== view.campaignId)
  )
    throw new Error('GM admission projection source mismatch');
  const review = service.reviewPresentation(current.review),
    selected = review.copies.find((copy) => copy.reviewCopyId === view.values.selectedReviewCopyId);
  if (selected === undefined) throw new Error('GM admission selected copy is missing');
  const proposal = current.gmDecisionOrNull?.proposalOrNull ?? review.proposalOrNull;
  const blockers = proposal?.blockers ?? review.copies.flatMap((copy) => copy.blockers);
  const missing = review.copies.flatMap((copy) => {
    const group = copy.inputs.groupAssignmentOrNull;
    return [
      ...copy.missing,
      ...(group?.kind === 'EXISTING' &&
      history.groups.get(group.groupId)?.campaignId !== view.campaignId
        ? ['GROUP_UNAVAILABLE']
        : []),
    ].map((code) => ({ reviewCopyId: copy.reviewCopyId, code }));
  });
  const editable = current.review.editable && current.gmDecisionOrNull === null,
    fullDiffs = proposal?.fullCampaignCopyDiffs ?? [],
    selectedDiff =
      fullDiffs.find((copy) => copy.reviewCopyIdOrNull === selected.reviewCopyId) ?? null,
    ready = proposal !== null && missing.length === 0,
    rawCapacity = networkCapacity(
      campaign,
      review.copies.length,
      history.occupiedCampaignPlaceCount,
    ),
    ownerProvenance = {
      kind: 'DEVICE_REQUEST',
      requestId: current.review.current.requestId,
      requestOwnerDeviceId: current.review.open.receipt.requestOwnerDeviceId,
    },
    ordinaryScope = {
      kind: 'ORDINARY_DRAFT',
      admissionBatchId: view.admissionBatchId,
      requestId: current.review.current.requestId,
      reviewCopyId: selected.reviewCopyId,
      reviewRevision: current.review.current.reviewRevision,
    };
  const publishedCopy = current.gmDecisionOrNull?.copies.find(
    (copy) => copy.reviewCopyId === selected.reviewCopyId,
  );
  if (
    current.gmDecisionOrNull?.request.decision === 'ACCEPT' &&
    (publishedCopy === undefined || proposal === null)
  )
    throw new Error('GM admission published copy identity is missing');
  const reviewScope =
    publishedCopy === undefined
      ? ordinaryScope
      : {
          kind: 'PUBLISHED_COPY',
          admissionBatchId: view.admissionBatchId,
          campaignCharacterId: publishedCopy.campaignCharacterId,
          proposalRevision: proposal!.proposalRevision,
          origin: 'DEVICE_REQUEST',
          requestIdOrNull: current.review.current.requestId,
          reviewCopyIdOrNull: selected.reviewCopyId,
        };
  const common = {
    contextId: view.gmLocalContextId,
    campaignId: view.campaignId,
    admissionBatchId: view.admissionBatchId,
    requestIdOrNull: current.review.current.requestId,
    deviceRequestId: current.review.current.requestId,
    reviewRevisionOrNull: current.review.current.reviewRevision,
    stateRevision: view.stateRevision,
    projectionRevision: view.projectionRevision,
    actorVisibilityRevision: view.actorVisibilityRevision,
    editable,
    reviewScope,
    selectedReviewCopyId: selected.reviewCopyId,
    viewValues: structuredClone(view.values),
    itemLabels: service.catalogs.items,
    groupLabels: admissionSelectedGroupLabels(fullDiffs, [...history.groups.values()]),
    batchReviewCopies: review.copies.map((copy) => ({
      reviewCopyId: copy.reviewCopyId,
      sourceUuid: copy.sourceUuid,
      name: copy.beforeSheet.identity.name,
    })),
    returnContext: { formId: 'NET-017', campaignId: view.campaignId },
  };
  const capable = (id: string) => i.supported.some((value) => value === id);
  const committedPlaces =
    current.playerDecisionOrNull?.request.decision === 'ACCEPT'
      ? current.playerDecisionOrNull.receipt.copies.filter((copy) => copy.occupiesCampaignPlace)
          .length
      : 0;
  const capacity = {
    evaluatedCampaignRevision: rawCapacity.campaignRevision,
    activePlayerCapacity: rawCapacity.activePlayerCapacity,
    occupiedCampaignPlaceCount: rawCapacity.occupiedCampaignPlaceCount,
    activePcCount: rawCapacity.activePcCount,
    candidateCount: rawCapacity.selectedCandidateCount,
    fitsCurrentCapacity:
      rawCapacity.selectedCandidateCount <=
      rawCapacity.activePlayerCapacity - rawCapacity.occupiedCampaignPlaceCount + committedPlaces,
  };
  const originalSelectedSkills = selected.beforeSheet.skills.entries
    .filter((skill) => skill.source === 'SELECTED')
    .map((skill) => ({ skillKey: skill.skillKey, targetBonus: skill.bonus }));
  const skillChangeProposed = !isDeepStrictEqual(
    originalSelectedSkills,
    selected.inputs.startingSkills.entries,
  );
  const skillDecisionRecorded = current.review.events.some(
    (event) =>
      event.mutation.kind === 'EDIT' &&
      event.mutation.reviewCopyId === selected.reviewCopyId &&
      isDeepStrictEqual(event.mutation.inputs.startingSkills, selected.inputs.startingSkills),
  );
  const form = (
    id: AdmissionGmViewFormId,
    enabled: boolean,
  ): PresentedBaseForm | PresentedLayerForm => {
    let fields: unknown;
    const actions: ActionKey[] = [];
    const add = (suffix: string, yes = true) => {
      if (enabled && yes) actions.push(`${id}::CTA::${suffix}` as ActionKey);
    };
    if (id === 'NET-018') {
      fields = {
        immutableSourceSnapshot: selected.beforeSheet,
        sourceProvenanceAndNaturalRolls: {
          provenance: selected.provenance,
          naturalRolls: selected.naturalRolls,
        },
      };
      for (const suffix of ['001', '002', '003', '004']) add(suffix);
    } else if (id === 'NET-019') {
      fields = {
        localSourceSnapshot: selected.beforeSheet,
        reviewDraft: selected.inputs,
        afterCore: selected.afterCore,
        campaignCopyDiff: selectedDiff,
        massStatus: selected.inputs.massReview,
        startingInventoryAndMoneyStatus: {
          inventory: selected.inputs.inventoryReview,
          money: selected.inputs.moneyReview,
        },
        groupAndLocationAssignment: {
          group: selected.inputs.groupAssignmentOrNull,
          location: selected.inputs.locationAssignmentOrNull,
        },
        validatedWeaponRequests: selected.weaponRequests,
        unresolvedWeaponRequestIds: selected.unresolvedWeapons.requestIds,
        batchFinalizationStatus: ready ? 'READY_ALL_OR_NONE' : 'BLOCKED_INVALID_BATCH',
        blockers,
        missingRequiredFields: missing,
        reviewItemIdentities: selected.reviewItemIdentities,
        catalogs: service.catalogs,
      };
      add('001');
      add('002');
      add('004', editable && selected.unresolvedWeapons.requestIds.length > 0);
      add(
        '005',
        editable &&
          selected.inputs.inventoryReview.entries.some(
            (entry) =>
              entry.sourceEntryIdOrNull === null &&
              entry.item.kind === 'CATALOG' &&
              entry.item.itemTypeId.startsWith('ITM-WPN-') &&
              entry.weaponDecisionReceiptIdOrNull === null,
          ),
      );
    } else if (id === 'NET-020') {
      fields = {
        reviewDraft: selected.inputs,
        groupAssignment: selected.inputs.groupAssignmentOrNull,
        locationAssignment: selected.inputs.locationAssignmentOrNull,
        diff: selectedDiff,
        blockers,
        missingRequiredFields: missing,
        groupDraftIds: current.review.current.groupDraftIds,
        existingGroups: [...history.groups.values()].map((group) => ({
          groupId: group.groupId,
          name: group.origin === 'START' ? 'Стартовая группа' : group.nameOrNull,
        })),
      };
      add('001');
      add('002');
    } else if (id === 'NET-021') {
      fields = {
        proposedCampaignCopies: fullDiffs.map((copy) => ({
          reviewCopyId: copy.reviewCopyIdOrNull,
          campaignCharacterIdOrNull: copy.campaignCharacterIdOrNull,
          characterName: copy.characterName,
        })),
        fullCampaignCopyDiffs: fullDiffs,
        proposalChecksum: proposal?.proposalChecksum ?? null,
        allRequiredFieldsValid: ready,
        blockers,
        missingRequiredFields: missing,
        incompleteReviews:
          proposal === null
            ? review.copies.map((copy) => ({
                reviewCopyId: copy.reviewCopyId,
                beforeSheet: copy.beforeSheet,
                afterCore: copy.afterCore,
                inputs: copy.inputs,
              }))
            : [],
        capacityPreview: capacity,
        commandId: null,
        admissionOrigin: 'DEVICE_REQUEST',
        ownerProvenance,
        published: current.gmDecisionOrNull !== null,
      };
      add('001');
      add('002', editable);
      add('003', editable && skillChangeProposed);
      add('004', editable);
      add('005', editable && ready && capable('UI-CMD-ADMISSION-GM-ACCEPT'));
    } else if (id === 'NET-022') {
      fields = {
        capacityPreview: capacity,
        reason: view.values.rejectionReason,
        commandId: null,
        admissionOrigin: 'DEVICE_REQUEST',
        ownerProvenance,
      };
      add('001');
      add('002', current.gmDecisionOrNull === null);
      add(
        '003',
        editable &&
          view.values.rejectionReason.trim().length > 0 &&
          capable('UI-CMD-ADMISSION-GM-REJECT'),
      );
    } else if (id === 'GM-020') {
      fields = {
        originalStartingSkills: selected.beforeSheet.skills,
        proposedStartingSkills: selected.inputs.startingSkills,
        reviewDraft: selected.inputs,
        immutableRaceAndClassGrants: selected.afterCore.skills.entries.filter(
          (skill) => skill.source !== 'SELECTED',
        ),
        skillRequirementsAndPoolValidation: selected.afterCore.skills,
        campaignCopyDiff: selectedDiff,
        selectableSkills: service.catalogs.skills,
      };
      add('001', editable && skillDecisionRecorded);
    } else {
      const input = view.values.weaponDraftOrNull;
      const requestedWeapon = input?.weaponReviewInput;
      const request =
        requestedWeapon?.kind === 'VALIDATED_REQUEST'
          ? selected.weaponRequests.find((entry) => entry.requestId === requestedWeapon.requestId)
          : null;
      const preview =
        input === null ? null : service.weaponPreview(current.review, selected.reviewCopyId, input);
      const terminal =
        input !== null &&
        current.review.current.copies
          .find((copy) => copy.reviewCopyId === selected.reviewCopyId)!
          .weaponDecisions.some((decision) => {
            const target = decision.input.weaponReviewInput;
            return requestedWeapon?.kind === 'VALIDATED_REQUEST'
              ? target.kind === 'VALIDATED_REQUEST' &&
                  target.requestId === requestedWeapon.requestId
              : requestedWeapon?.kind === 'ADMISSION_GRANT' &&
                  target.kind === 'ADMISSION_GRANT' &&
                  target.reviewItemId === requestedWeapon.reviewItemId;
          });
      fields = {
        mode: 'REQUEST_REVIEW',
        weaponOwnerScope: { ...ordinaryScope, kind: 'ADMISSION_REVIEW' },
        weaponInstanceIdOrNull: null,
        requestIdOrNull: request?.requestId ?? null,
        validationReceiptIdOrNull: request?.validationReceiptId ?? null,
        weaponTypeId:
          input?.weaponReviewInput.kind === 'ADMISSION_GRANT'
            ? input.weaponReviewInput.weaponTypeId
            : (request?.proposedWeaponProfile?.weaponTypeId ?? null),
        commonWitness: request?.commonWitness ?? null,
        proposedWeaponProfileOrCurrentProfile:
          request?.proposedWeaponProfile ?? preview?.beforeProfileOrNull ?? null,
        currentProfileOrNull: preview?.beforeProfileOrNull ?? null,
        decision: input?.decision ?? null,
        typedPatchOrOverrideProfile: input?.overrideProfileOrNull ?? null,
        formulaReachabilityValidation:
          request === null || request === undefined
            ? null
            : { valid: true, commonWitness: request.commonWitness },
        profileVersionBeforeOrNull: null,
        profileVersionOrStagedDecisionPreview: preview?.afterProfile ?? null,
        equipmentState: 'UNEQUIPPED_ON_MATERIALIZATION',
        reason:
          requestedWeapon?.kind === 'ADMISSION_GRANT'
            ? requestedWeapon.reason
            : (input?.reasonOrNull ?? null),
        operationId: request == null ? null : 'OP-REQ-GM',
        masterAuthorityRevision: history.checkpoint.actorVisibilityRevision,
        commandId: null,
        weaponReviewInputOrNull: input?.weaponReviewInput ?? null,
        weaponDraftOrNull: input,
        validatedWeaponRequests: selected.weaponRequests.filter(
          (row) =>
            selected.unresolvedWeapons.requestIds.includes(row.requestId) ||
            row.requestId === request?.requestId,
        ),
        grantItems: selected.inputs.inventoryReview.entries.filter(
          (entry) =>
            entry.sourceEntryIdOrNull === null &&
            (entry.weaponDecisionReceiptIdOrNull === null ||
              (requestedWeapon?.kind === 'ADMISSION_GRANT' &&
                requestedWeapon.reviewItemId === entry.reviewItemId)),
        ),
        weaponTemplates: service.catalogs.weaponTemplates,
        weaponVariants: service.catalogs.weaponVariants,
      };
      add('004', !terminal);
      add(
        '005',
        editable && !terminal && preview !== null && capable('UI-CMD-GM-WEAPON-REQUEST-RESOLVE'),
      );
    }
    const payload = { ...common, ...(fields as object) } as unknown as JsonObject;
    // Validate the allowlist without replacing its plain records by codec-owned null prototypes.
    admissionGmProjectionValue(id, payload);
    if (id === 'NET-020' || id === 'NET-021' || id === 'NET-022')
      return {
        formId: id,
        formType: 'dialog',
        routeTemplate: `@dialog/${id.toLowerCase()}`,
        routeBindings: [],
        availableActionKeys: actions,
        roleFilteredPayload: payload,
      };
    return {
      formId: id,
      formType: 'screen',
      routeTemplate: `/master/campaigns/:campaignId/${id.startsWith('GM-') ? 'gm-operations' : 'network'}/${id.toLowerCase()}`,
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: view.campaignId }],
      availableActionKeys: actions,
      roleFilteredPayload: payload,
    };
  };
  const active = form(view.formId, true);
  return {
    revisions: {
      stateRevision: view.stateRevision,
      projectionRevision: view.projectionRevision,
      actorVisibilityRevision: view.actorVisibilityRevision,
    },
    base: active.formType === 'screen' ? active : (form('NET-018', false) as PresentedBaseForm),
    layers:
      active.formType === 'screen'
        ? []
        : view.formId === 'NET-022'
          ? [form('NET-021', false) as PresentedLayerForm, active]
          : [active],
  };
}
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
export function networkCapacity(
  campaign: PeerCampaignHeader,
  selected: number,
  occupied: number | null,
): CapacityForecast {
  if (
    !Number.isInteger(selected) ||
    selected < 0 ||
    selected > 3 ||
    occupied === null ||
    !Number.isSafeInteger(occupied) ||
    occupied < campaign.activePcCount ||
    occupied > campaign.activePlayerCapacity
  )
    throw new Error('network selection unavailable');
  return {
    campaignRevision: campaign.revisions.stateRevision,
    activePlayerCapacity: campaign.activePlayerCapacity,
    activePcCount: campaign.activePcCount,
    occupiedCampaignPlaceCount: occupied,
    selectedCandidateCount: selected as 0 | 1 | 2 | 3,
    fitsCurrentCapacity: selected <= campaign.activePlayerCapacity - occupied,
  };
}
export interface NetworkProjectionInput {
  readonly state: LocalNetworkApplication;
  readonly contextId: string;
  readonly supported: readonly WorkflowCommandCapabilityId[];
  readonly campaign: PeerCampaignHeader | null;
  readonly occupiedCampaignPlaceCount: number | null;
  readonly alreadyImportedSourceUuids: readonly string[];
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
  const selectionEligible = s.selectedCandidates.every(
    (ref) => !i.alreadyImportedSourceUuids.includes(ref.sourceUuid),
  );
  const activeRequest =
    s.requestOrNull !== null &&
    s.requestOrNull.closureOrNull === null &&
    (status === undefined || status === 'PENDING' || status === 'IN_REVIEW');
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
      const forecast = networkCapacity(
        i.campaign,
        s.selectedCandidates.length,
        i.occupiedCampaignPlaceCount,
      );
      payload = {
        ...common,
        ownRequestIdOrNull: activeRequest ? s.requestOrNull.requestId : null,
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
        idle &&
          live &&
          selectionEligible &&
          s.selectedCandidates.length > 0 &&
          forecast.fitsCurrentCapacity,
      );
      add(
        'NET-003::CTA::002',
        idle &&
          live &&
          selectionEligible &&
          s.selectedCandidates.length === 1 &&
          forecast.fitsCurrentCapacity,
      );
      add('NET-003::CTA::003', !pending && live && activeRequest);
      break;
    }
    case 'NET-004': {
      const b = s.preparedBatchOrNull;
      if (b === null || i.campaign === null) throw new Error('network batch unavailable');
      const forecast = networkCapacity(
        i.campaign,
        b.candidates.length,
        i.occupiedCampaignPlaceCount,
      );
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
        idle &&
          live &&
          selectionEligible &&
          forecast.fitsCurrentCapacity &&
          capable('UI-CMD-DEVICE-REQUEST-SUBMIT'),
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
      add('NET-005::CTA::003', !pending && live && status === 'REJECTED');
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
        live &&
        selectionCurrent &&
        selectionEligible &&
        i.occupiedCampaignPlaceCount !== null &&
        networkCapacity(i.campaign, 1, i.occupiedCampaignPlaceCount).fitsCurrentCapacity;
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
  readonly selectedAdmission?: { readonly published: boolean; readonly hasProposed: boolean };
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
    selectedAdmissionOrNull:
      view.values.selectedRequestIdOrNull === null ? null : (i.selectedAdmission ?? null),
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
    i.selectedAdmission?.published !== true &&
    view.values.decisionReason.trim().length > 0 &&
    i.supported.includes('UI-CMD-DEVICE-REQUEST-REJECT')
  )
    actions.push('NET-017::CTA::008');
  if (selected?.requestStatus === 'IN_REVIEW' && i.selectedAdmission !== undefined) {
    if (!i.selectedAdmission.published && i.supported.includes('UI-CMD-ADMISSION-REVIEW-OPEN'))
      actions.push('NET-017::CTA::010');
    if (i.selectedAdmission.hasProposed)
      actions.push(
        'NET-017::CTA::001',
        'NET-017::CTA::002',
        'NET-017::CTA::003',
        'NET-017::CTA::004',
      );
  }
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
