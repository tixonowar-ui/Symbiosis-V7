import type {
  AdmissionMechanicalSheetV1,
  AdmissionLocationAssignment,
  AdmissionReviewInputs,
} from './campaign-admission.js';
import {
  admissionMechanicalChangesValue,
  admissionMechanicalSheetValue,
  type AdmissionMechanicalChange,
} from './campaign-admission-sheet.js';
import {
  admissionCodecReaders,
  admissionLocationAssignmentValue,
  admissionReviewInputsValue,
} from './campaign-admission-codec.js';
import { redactProtocolInputRefusal, wireCodecPrimitives } from './wire-codec.js';
import type { DecodeResult } from './wire-protocol.js';

/** Closed NET-019 blocker shape. Invalid mechanics never become lobby blockers. */
export interface AdmissionBlocker {
  readonly kind: 'MASS_PENDING' | 'STARTING_PROPERTY_PENDING';
  readonly reviewCopyIdOrNull: string;
  readonly campaignCharacterIdOrNull: string | null;
  readonly sourceEntryIdOrNull: string | null;
  readonly message: string;
}
/** Runtime #172 implements DEVICE_REQUEST; imported copies remain outside this family. */
export interface AdmissionFullCopyDiff {
  readonly sourceUuid: string;
  readonly sourceSnapshotChecksum: string;
  readonly reviewCopyIdOrNull: string;
  readonly campaignCharacterIdOrNull: string | null;
  readonly characterName: string;
  readonly beforeSheet: AdmissionMechanicalSheetV1;
  readonly afterSheet: AdmissionMechanicalSheetV1;
  readonly changes: readonly AdmissionMechanicalChange[];
  readonly blockers: readonly AdmissionBlocker[];
}
export interface AdmissionProposalBody {
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly admissionOrigin: 'DEVICE_REQUEST';
  readonly ownerProvenance: Readonly<{
    kind: 'DEVICE_REQUEST';
    requestId: string;
    requestOwnerDeviceId: string;
  }>;
  readonly reviewRevision: number;
  readonly proposalRevision: number;
  readonly fullCampaignCopyDiffs: readonly AdmissionFullCopyDiff[];
  readonly blockers: readonly AdmissionBlocker[];
}
export interface AdmissionProposal extends AdmissionProposalBody {
  readonly proposalChecksum: string;
}
/** Complete review revision and preview checksum bind the GM's whole-batch decision. */
export interface AdmissionGmDecisionRequest {
  readonly commandId: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly reviewRevision: number;
  readonly expectedCampaignRevision: number;
  readonly decision: 'ACCEPT' | 'REJECT';
  readonly previewChecksumOrNull: string | null;
  readonly reasonOrNull: string | null;
}
export interface AdmissionCapacityProof {
  readonly activePlayerCapacity: number;
  readonly occupiedCampaignPlaceCount: number;
  readonly activePcCount: number;
  readonly candidateCount: number;
  readonly fitsCurrentCapacity: boolean;
  readonly evaluatedCampaignRevision: number;
}
export interface AdmissionControllerBinding {
  readonly campaignCharacterId: string;
  readonly deviceId: string;
  readonly localControllerSeatId: string;
  readonly inputLaneId: string;
}
export interface AdmissionControllerProof {
  readonly ownerProvenance: AdmissionProposalBody['ownerProvenance'];
  readonly controllerBindings: readonly AdmissionControllerBinding[];
  readonly valid: boolean;
  readonly evaluatedCampaignRevision: number;
}
/** Created by the owning installation from real local tabs before sending ACCEPT. */
export interface AdmissionControllerPreparation {
  readonly schemaVersion: 1;
  readonly preparationId: string;
  readonly requestId: string;
  readonly ownerDeviceId: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly proposalRevision: number;
  readonly proposalChecksum: string;
  readonly controllerBindings: readonly AdmissionControllerBinding[];
}
export interface AdmissionPlayerDecisionRequest {
  readonly commandId: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly proposalRevision: number;
  readonly proposalChecksum: string;
  readonly expectedCampaignRevision: number;
  readonly decision: 'ACCEPT' | 'DECLINE';
  readonly controllerPreparationOrNull: AdmissionControllerPreparation | null;
}
export interface AdmissionPlayerCopyResult {
  readonly campaignCharacterId: string;
  readonly lifecycleState: 'ACTIVE' | 'PROPOSED' | 'DECLINED';
  readonly occupiesCampaignPlace: boolean;
  readonly groupIdOrNull: string | null;
  readonly locationAssignmentOrNull: AdmissionLocationAssignment | null;
  readonly controllerBindingOrNull: AdmissionControllerBinding | null;
}
export interface AdmissionPlayerDecisionReceipt {
  readonly receiptId: string;
  readonly commandId: string;
  readonly workflowCommandId: 'UI-CMD-ADMISSION-PLAYER-DECIDE';
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly requestId: string;
  readonly requestOwnerDeviceId: string;
  readonly proposalRevision: number;
  readonly proposalChecksum: string;
  readonly decision: 'ACCEPT' | 'DECLINE';
  readonly capacityProofOrNull: AdmissionCapacityProof | null;
  readonly controllerProofOrNull: AdmissionControllerProof | null;
  readonly copies: readonly AdmissionPlayerCopyResult[];
  readonly campaignRevision: number;
  readonly timestamp: string;
}
export interface AdmissionGmDecisionReceipt {
  readonly receiptId: string;
  readonly commandId: string;
  readonly workflowCommandId: 'UI-CMD-ADMISSION-GM-ACCEPT' | 'UI-CMD-ADMISSION-GM-REJECT';
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly requestId: string;
  readonly requestOwnerDeviceId: string;
  readonly reviewRevision: number;
  readonly decision: 'ACCEPT' | 'REJECT';
  readonly reasonOrNull: string | null;
  readonly proposalRevisionOrNull: number | null;
  readonly proposalChecksumOrNull: string | null;
  readonly campaignCharacterIds: readonly string[];
  readonly authoritativeGmActorId: string;
  readonly timestamp: string;
}
const { exact, oneOf, uuid, text, integer, nullable, list, unique, invalid, validated } =
  admissionCodecReaders;
function checksum(value: unknown, path: string): string {
  const result = text(value, path);
  return /^[0-9a-f]{64}$/u.test(result) ? result : invalid(path, 'canonical SHA-256', null);
}

export function admissionControllerPreparationValue(
  value: unknown,
  path = '$',
): AdmissionControllerPreparation {
  const row = exact(
    value,
    'schemaVersion preparationId requestId ownerDeviceId campaignId admissionBatchId proposalRevision proposalChecksum controllerBindings',
    path,
  );
  if (row['schemaVersion'] !== 1) invalid(path, 'controller preparation schema 1', null);
  for (const key of ['preparationId', 'ownerDeviceId', 'campaignId', 'admissionBatchId'] as const)
    uuid(row[key], `${path}.${key}`);
  text(row['requestId'], `${path}.requestId`);
  integer(row['proposalRevision'], `${path}.proposalRevision`, 1);
  checksum(row['proposalChecksum'], `${path}.proposalChecksum`);
  const bindings = list(row['controllerBindings'], `${path}.controllerBindings`).map((v, i) => {
    const p = `${path}.controllerBindings[${String(i)}]`,
      binding = exact(v, 'campaignCharacterId deviceId localControllerSeatId inputLaneId', p);
    for (const key of [
      'campaignCharacterId',
      'deviceId',
      'localControllerSeatId',
      'inputLaneId',
    ] as const)
      uuid(binding[key], `${p}.${key}`);
    if (
      binding['deviceId'] !== row['ownerDeviceId'] ||
      binding['inputLaneId'] !== binding['localControllerSeatId']
    )
      invalid(p, 'owner local tab as both seat and input lane', null);
    return binding;
  });
  if (bindings.length < 1 || bindings.length > 3)
    invalid(path, 'one through three real local tabs', null);
  for (const key of ['campaignCharacterId', 'localControllerSeatId', 'inputLaneId'] as const)
    unique(
      bindings.map((b) => text(b[key], `${path}.${key}`)),
      `${path}.${key}`,
    );
  return validated(row);
}
export function admissionPlayerDecisionRequestValue(
  value: unknown,
  path = '$',
): AdmissionPlayerDecisionRequest {
  const row = exact(
    value,
    'commandId campaignId admissionBatchId proposalRevision proposalChecksum expectedCampaignRevision decision controllerPreparationOrNull',
    path,
  );
  text(row['commandId'], `${path}.commandId`);
  uuid(row['campaignId'], `${path}.campaignId`);
  uuid(row['admissionBatchId'], `${path}.admissionBatchId`);
  integer(row['proposalRevision'], `${path}.proposalRevision`, 1);
  integer(row['expectedCampaignRevision'], `${path}.expectedCampaignRevision`, 0);
  checksum(row['proposalChecksum'], `${path}.proposalChecksum`);
  const decision = oneOf(row['decision'], ['ACCEPT', 'DECLINE'], `${path}.decision`);
  if (decision === 'ACCEPT') {
    const preparation = admissionControllerPreparationValue(
      row['controllerPreparationOrNull'],
      `${path}.controllerPreparationOrNull`,
    );
    for (const key of [
      'campaignId',
      'admissionBatchId',
      'proposalRevision',
      'proposalChecksum',
    ] as const)
      if (preparation[key] !== row[key])
        invalid(path, 'preparation bound to the entire proposal', null);
  } else if (row['controllerPreparationOrNull'] !== null)
    invalid(path, 'no controller preparation on DECLINE', null);
  return validated(row);
}

export function admissionGmDecisionRequestValue(
  value: unknown,
  path = '$',
): AdmissionGmDecisionRequest {
  const row = exact(
    value,
    'commandId campaignId admissionBatchId reviewRevision expectedCampaignRevision decision previewChecksumOrNull reasonOrNull',
    path,
  );
  text(row['commandId'], `${path}.commandId`);
  uuid(row['campaignId'], `${path}.campaignId`);
  uuid(row['admissionBatchId'], `${path}.admissionBatchId`);
  integer(row['reviewRevision'], `${path}.reviewRevision`, 0);
  integer(row['expectedCampaignRevision'], `${path}.expectedCampaignRevision`, 0);
  const decision = oneOf(row['decision'], ['ACCEPT', 'REJECT'], `${path}.decision`);
  if (decision === 'ACCEPT') {
    checksum(row['previewChecksumOrNull'], `${path}.previewChecksumOrNull`);
    if (row['reasonOrNull'] !== null) invalid(path, 'no rejection reason on ACCEPT', null);
  } else {
    if (text(row['reasonOrNull'], `${path}.reasonOrNull`).trim().length === 0)
      invalid(path, 'non-empty rejection reason', null);
    if (row['previewChecksumOrNull'] !== null) invalid(path, 'no preview required on REJECT', null);
  }
  return validated(row);
}

/** UI messages describe explicit review statuses, never a successful approval. */
export function admissionLobbyBlockers(
  sheet: AdmissionMechanicalSheetV1,
  reviewCopyId: string,
  campaignCharacterIdOrNull: string | null,
): readonly AdmissionBlocker[] {
  admissionMechanicalSheetValue(sheet);
  return pendingReviewBlockers(sheet, reviewCopyId, campaignCharacterIdOrNull);
}
/** Incomplete assignment/weapon work does not hide the independent mass/property lobby statuses. */
export function admissionPendingReviewBlockers(
  inputs: AdmissionReviewInputs,
  reviewCopyId: string,
): readonly AdmissionBlocker[] {
  admissionReviewInputsValue(inputs);
  return pendingReviewBlockers(inputs, reviewCopyId, null);
}
function pendingReviewBlockers(
  sheet: Pick<AdmissionReviewInputs, 'massReview' | 'inventoryReview' | 'moneyReview'>,
  reviewCopyId: string,
  campaignCharacterIdOrNull: string | null,
): readonly AdmissionBlocker[] {
  uuid(reviewCopyId, '$.reviewCopyId');
  nullable(campaignCharacterIdOrNull, '$.campaignCharacterIdOrNull', uuid);
  const result: AdmissionBlocker[] = [];
  const add = (
    kind: AdmissionBlocker['kind'],
    message: string,
    sourceEntryIdOrNull: string | null = null,
  ) => {
    result.push(
      Object.freeze({
        kind,
        reviewCopyIdOrNull: reviewCopyId,
        campaignCharacterIdOrNull,
        sourceEntryIdOrNull,
        message,
      }),
    );
  };
  if (sheet.massReview.decision === 'PENDING_MASTER_APPROVAL')
    add('MASS_PENDING', 'Масса персонажа не согласована.');
  if (sheet.inventoryReview.status === 'PENDING') {
    add('STARTING_PROPERTY_PENDING', 'Проверка стартового имущества не завершена.');
    for (const id of sheet.inventoryReview.unresolvedSourceEntryIds)
      add('STARTING_PROPERTY_PENDING', 'Стартовая позиция ожидает проверки.', id);
  }
  if (sheet.moneyReview.status === 'PENDING')
    add('STARTING_PROPERTY_PENDING', 'Стартовые деньги не согласованы.');
  return Object.freeze(result);
}

function blockersValue(value: unknown, expected: readonly AdmissionBlocker[], path: string): void {
  const rows = list(value, path);
  if (rows.length !== expected.length) invalid(path, 'complete derived lobby blockers', null);
  for (const [i, row] of rows.entries()) {
    const p = `${path}[${String(i)}]`,
      actual = exact(
        row,
        'kind reviewCopyIdOrNull campaignCharacterIdOrNull sourceEntryIdOrNull message',
        p,
      );
    for (const key of [
      'kind',
      'reviewCopyIdOrNull',
      'campaignCharacterIdOrNull',
      'sourceEntryIdOrNull',
      'message',
    ] as const)
      if (actual[key] !== expected[i]![key])
        invalid(`${p}.${key}`, 'derived lobby blocker field', null);
  }
}

export function admissionFullCopyDiffValue(value: unknown, path = '$.diff'): AdmissionFullCopyDiff {
  const row = exact(
    value,
    'sourceUuid sourceSnapshotChecksum reviewCopyIdOrNull campaignCharacterIdOrNull characterName beforeSheet afterSheet changes blockers',
    path,
  );
  text(row['sourceUuid'], `${path}.sourceUuid`);
  checksum(row['sourceSnapshotChecksum'], `${path}.sourceSnapshotChecksum`);
  const reviewId = uuid(row['reviewCopyIdOrNull'], `${path}.reviewCopyIdOrNull`),
    copyId = nullable(row['campaignCharacterIdOrNull'], `${path}.campaignCharacterIdOrNull`, uuid),
    before = admissionMechanicalSheetValue(row['beforeSheet'], `${path}.beforeSheet`),
    after = admissionMechanicalSheetValue(row['afterSheet'], `${path}.afterSheet`);
  if (
    row['characterName'] !== before.identity.name ||
    after.identity.name !== before.identity.name ||
    after.identity.age !== before.identity.age ||
    after.identity.sex !== before.identity.sex
  )
    invalid(path, 'unchanged source character identity', null);
  if (
    before.groupAssignmentOrNull !== null ||
    before.locationAssignmentOrNull !== null ||
    after.groupAssignmentOrNull === null ||
    after.locationAssignmentOrNull === null
  )
    invalid(path, 'local source and explicit proposed group/location assignments', null);
  admissionMechanicalChangesValue(row['changes'], before, after, `${path}.changes`);
  blockersValue(
    row['blockers'],
    admissionLobbyBlockers(after, reviewId, copyId),
    `${path}.blockers`,
  );
  return validated(row);
}

/** The checksum is recomputed by the receiving host over this complete closed body. */
export function admissionProposalValue(value: unknown, path = '$'): AdmissionProposal {
  const row = exact(
    value,
    'campaignId admissionBatchId admissionOrigin ownerProvenance reviewRevision proposalRevision fullCampaignCopyDiffs blockers proposalChecksum',
    path,
  );
  uuid(row['campaignId'], `${path}.campaignId`);
  uuid(row['admissionBatchId'], `${path}.admissionBatchId`);
  oneOf(row['admissionOrigin'], ['DEVICE_REQUEST'], `${path}.admissionOrigin`);
  const owner = exact(
    row['ownerProvenance'],
    'kind requestId requestOwnerDeviceId',
    `${path}.ownerProvenance`,
  );
  oneOf(owner['kind'], ['DEVICE_REQUEST'], `${path}.ownerProvenance.kind`);
  text(owner['requestId'], `${path}.ownerProvenance.requestId`);
  text(owner['requestOwnerDeviceId'], `${path}.ownerProvenance.requestOwnerDeviceId`);
  integer(row['reviewRevision'], `${path}.reviewRevision`, 0);
  integer(row['proposalRevision'], `${path}.proposalRevision`, 1);
  checksum(row['proposalChecksum'], `${path}.proposalChecksum`);
  const diffs = list(row['fullCampaignCopyDiffs'], `${path}.fullCampaignCopyDiffs`).map((v, i) =>
    admissionFullCopyDiffValue(v, `${path}.fullCampaignCopyDiffs[${String(i)}]`),
  );
  // NET-021/027: one through three copies; no partial or mixed preview/publication batch.
  if (diffs.length < 1 || diffs.length > 3)
    invalid(path, 'one through three complete copies', null);
  unique(
    diffs.map((d) => d.sourceUuid),
    `${path}.fullCampaignCopyDiffs.sourceUuid`,
  );
  unique(
    diffs.map((d) => d.reviewCopyIdOrNull),
    `${path}.fullCampaignCopyDiffs.reviewCopyIdOrNull`,
  );
  const ids = diffs.flatMap((d) =>
    d.campaignCharacterIdOrNull === null ? [] : [d.campaignCharacterIdOrNull],
  );
  if (ids.length !== 0 && ids.length !== diffs.length)
    invalid(path, 'atomic copy identity mapping', null);
  unique(ids, `${path}.fullCampaignCopyDiffs.campaignCharacterIdOrNull`);
  const groups = new Map<string, string>();
  for (const diff of diffs) {
    const group = diff.afterSheet.groupAssignmentOrNull!;
    if (group.kind !== 'NEW') continue;
    if (groups.has(group.groupDraftId) && groups.get(group.groupDraftId) !== group.name)
      invalid(path, 'one name for the same new group identity', null);
    groups.set(group.groupDraftId, group.name);
  }
  blockersValue(
    row['blockers'],
    diffs.flatMap((d) => d.blockers),
    `${path}.blockers`,
  );
  return validated(row);
}
export function decodeAdmissionProposal(source: string): DecodeResult<AdmissionProposal> {
  const result = wireCodecPrimitives.parse(source, admissionProposalValue);
  return result.ok ? result : { ok: false, refusal: redactProtocolInputRefusal(result.refusal) };
}

/** The peer publication deliberately omits the private GM actor/context and working journal. */
export interface AdmissionGmDecisionNotice {
  readonly receiptId: string;
  readonly commandId: string;
  readonly workflowCommandId: 'UI-CMD-ADMISSION-GM-ACCEPT' | 'UI-CMD-ADMISSION-GM-REJECT';
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly requestId: string;
  readonly requestOwnerDeviceId: string;
  readonly reviewRevision: number;
  readonly decision: 'ACCEPT' | 'REJECT';
  readonly reasonOrNull: string | null;
  readonly proposalRevisionOrNull: number | null;
  readonly proposalChecksumOrNull: string | null;
  readonly campaignCharacterIds: readonly string[];
  readonly timestamp: string;
}
export interface AdmissionOwnerPublication {
  readonly schemaVersion: 1;
  readonly gmDecision: AdmissionGmDecisionNotice;
  readonly proposalOrNull: AdmissionProposal | null;
  readonly groupLabels: readonly AdmissionGroupLabel[];
  readonly publicationChecksum: string;
}
export interface AdmissionGroupLabel {
  readonly groupId: string;
  readonly name: string;
}
export function admissionExistingGroupIds(
  diffs: readonly AdmissionFullCopyDiff[],
): readonly string[] {
  return [
    ...new Set(
      diffs.flatMap((diff) =>
        [diff.beforeSheet, diff.afterSheet].flatMap((sheet) =>
          sheet.groupAssignmentOrNull?.kind === 'EXISTING'
            ? [sheet.groupAssignmentOrNull.groupId]
            : [],
        ),
      ),
    ),
  ];
}
export function admissionGroupLabelsValue(
  value: unknown,
  requiredIds?: readonly string[],
  path = '$.groupLabels',
): readonly AdmissionGroupLabel[] {
  const rows = list(value, path).map((value, index) => {
    const at = `${path}[${index}]`,
      row = exact(value, 'groupId name', at);
    uuid(row['groupId'], `${at}.groupId`);
    if (text(row['name'], `${at}.name`).trim().length === 0)
      invalid(`${at}.name`, 'actual group name', null);
    return validated<AdmissionGroupLabel>(row);
  });
  unique(
    rows.map((row) => row.groupId),
    path,
  );
  if (
    requiredIds !== undefined &&
    (rows.length !== requiredIds.length ||
      rows.some((row, index) => row.groupId !== requiredIds[index]))
  )
    invalid(path, 'exact ordered selected group labels', null);
  return rows;
}

export function admissionGmDecisionNotice(
  receipt: AdmissionGmDecisionReceipt,
): AdmissionGmDecisionNotice {
  return {
    receiptId: receipt.receiptId,
    commandId: receipt.commandId,
    workflowCommandId: receipt.workflowCommandId,
    campaignId: receipt.campaignId,
    admissionBatchId: receipt.admissionBatchId,
    requestId: receipt.requestId,
    requestOwnerDeviceId: receipt.requestOwnerDeviceId,
    reviewRevision: receipt.reviewRevision,
    decision: receipt.decision,
    reasonOrNull: receipt.reasonOrNull,
    proposalRevisionOrNull: receipt.proposalRevisionOrNull,
    proposalChecksumOrNull: receipt.proposalChecksumOrNull,
    campaignCharacterIds: [...receipt.campaignCharacterIds],
    timestamp: receipt.timestamp,
  };
}
export function admissionOwnerPublicationValue(
  value: unknown,
  path = '$',
): AdmissionOwnerPublication {
  const row = exact(
    value,
    'schemaVersion gmDecision proposalOrNull groupLabels publicationChecksum',
    path,
  );
  if (row['schemaVersion'] !== 1) invalid(path, 'owner publication schema 1', null);
  checksum(row['publicationChecksum'], `${path}.publicationChecksum`);
  const p = `${path}.gmDecision`,
    notice = exact(
      row['gmDecision'],
      'receiptId commandId workflowCommandId campaignId admissionBatchId requestId requestOwnerDeviceId reviewRevision decision reasonOrNull proposalRevisionOrNull proposalChecksumOrNull campaignCharacterIds timestamp',
      p,
    );
  for (const key of [
    'receiptId',
    'campaignId',
    'admissionBatchId',
    'requestOwnerDeviceId',
  ] as const)
    uuid(notice[key], `${p}.${key}`);
  for (const key of ['commandId', 'requestId', 'timestamp'] as const)
    text(notice[key], `${p}.${key}`);
  integer(notice['reviewRevision'], `${p}.reviewRevision`, 0);
  const decision = oneOf(notice['decision'], ['ACCEPT', 'REJECT'], `${p}.decision`),
    ids = list(notice['campaignCharacterIds'], `${p}.campaignCharacterIds`).map((v, i) =>
      uuid(v, `${p}.campaignCharacterIds[${String(i)}]`),
    );
  unique(ids, `${p}.campaignCharacterIds`);
  if (decision === 'REJECT') {
    if (
      notice['workflowCommandId'] !== 'UI-CMD-ADMISSION-GM-REJECT' ||
      row['proposalOrNull'] !== null ||
      ids.length !== 0 ||
      notice['proposalRevisionOrNull'] !== null ||
      notice['proposalChecksumOrNull'] !== null ||
      text(notice['reasonOrNull'], `${p}.reasonOrNull`).trim().length === 0
    )
      invalid(p, 'whole rejected batch with a real reason and no proposal', null);
  } else {
    const proposal = admissionProposalValue(row['proposalOrNull'], `${path}.proposalOrNull`);
    if (
      notice['workflowCommandId'] !== 'UI-CMD-ADMISSION-GM-ACCEPT' ||
      notice['reasonOrNull'] !== null ||
      notice['campaignId'] !== proposal.campaignId ||
      notice['admissionBatchId'] !== proposal.admissionBatchId ||
      notice['requestId'] !== proposal.ownerProvenance.requestId ||
      notice['requestOwnerDeviceId'] !== proposal.ownerProvenance.requestOwnerDeviceId ||
      notice['reviewRevision'] !== proposal.reviewRevision ||
      notice['proposalRevisionOrNull'] !== proposal.proposalRevision ||
      notice['proposalChecksumOrNull'] !== proposal.proposalChecksum ||
      ids.length !== proposal.fullCampaignCopyDiffs.length ||
      ids.some((id, i) => id !== proposal.fullCampaignCopyDiffs[i]!.campaignCharacterIdOrNull)
    )
      invalid(p, 'complete published batch and matching original GM receipt', null);
  }
  admissionGroupLabelsValue(
    row['groupLabels'],
    row['proposalOrNull'] === null
      ? []
      : admissionExistingGroupIds(
          (row['proposalOrNull'] as AdmissionProposal).fullCampaignCopyDiffs,
        ),
    `${path}.groupLabels`,
  );
  return validated(row);
}

export function admissionPlayerDecisionReceiptValue(
  value: unknown,
  publication: AdmissionOwnerPublication,
  path = '$',
): AdmissionPlayerDecisionReceipt {
  admissionOwnerPublicationValue(publication);
  const proposal = publication.proposalOrNull;
  if (proposal === null) return invalid(path, 'published proposal before a player receipt', null);
  const row = exact(
    value,
    'receiptId commandId workflowCommandId campaignId admissionBatchId requestId requestOwnerDeviceId proposalRevision proposalChecksum decision capacityProofOrNull controllerProofOrNull copies campaignRevision timestamp',
    path,
  );
  uuid(row['receiptId'], `${path}.receiptId`);
  text(row['commandId'], `${path}.commandId`);
  text(row['timestamp'], `${path}.timestamp`);
  const revision = integer(row['campaignRevision'], `${path}.campaignRevision`, 1),
    decision = oneOf(row['decision'], ['ACCEPT', 'DECLINE'], `${path}.decision`),
    accepted = decision === 'ACCEPT';
  if (
    row['workflowCommandId'] !== 'UI-CMD-ADMISSION-PLAYER-DECIDE' ||
    row['campaignId'] !== proposal.campaignId ||
    row['admissionBatchId'] !== proposal.admissionBatchId ||
    row['requestId'] !== proposal.ownerProvenance.requestId ||
    row['requestOwnerDeviceId'] !== proposal.ownerProvenance.requestOwnerDeviceId ||
    row['proposalRevision'] !== proposal.proposalRevision ||
    row['proposalChecksum'] !== proposal.proposalChecksum
  )
    invalid(path, 'player receipt bound to the complete owner publication', null);
  let bindings: readonly Record<string, unknown>[] = [];
  if (accepted) {
    const p = `${path}.capacityProofOrNull`,
      capacity = exact(
        row['capacityProofOrNull'],
        'activePlayerCapacity occupiedCampaignPlaceCount activePcCount candidateCount fitsCurrentCapacity evaluatedCampaignRevision',
        p,
      ),
      limit = integer(capacity['activePlayerCapacity'], `${p}.activePlayerCapacity`, 1),
      occupied = integer(
        capacity['occupiedCampaignPlaceCount'],
        `${p}.occupiedCampaignPlaceCount`,
        0,
      ),
      active = integer(capacity['activePcCount'], `${p}.activePcCount`, 0);
    if (
      // Atlas CMP-001/002: a campaign has one through five player places.
      limit > 5 ||
      capacity['candidateCount'] !== proposal.fullCampaignCopyDiffs.length ||
      capacity['fitsCurrentCapacity'] !== true ||
      capacity['evaluatedCampaignRevision'] !== revision - 1 ||
      active > occupied ||
      occupied + proposal.fullCampaignCopyDiffs.length > limit
    )
      invalid(p, 'fresh capacity for every accepted copy including blocked copies', null);
    const c = `${path}.controllerProofOrNull`,
      controller = exact(
        row['controllerProofOrNull'],
        'ownerProvenance controllerBindings valid evaluatedCampaignRevision',
        c,
      ),
      owner = exact(
        controller['ownerProvenance'],
        'kind requestId requestOwnerDeviceId',
        `${c}.ownerProvenance`,
      );
    for (const key of ['kind', 'requestId', 'requestOwnerDeviceId'] as const)
      if (owner[key] !== proposal.ownerProvenance[key]) invalid(c, 'original proposal owner', null);
    if (controller['valid'] !== true || controller['evaluatedCampaignRevision'] !== revision - 1)
      invalid(c, 'controller proof at the accepted revision', null);
    bindings = list(controller['controllerBindings'], `${c}.controllerBindings`).map((v, i) => {
      const b = `${c}.controllerBindings[${String(i)}]`,
        binding = exact(v, 'campaignCharacterId deviceId localControllerSeatId inputLaneId', b);
      uuid(binding['localControllerSeatId'], `${b}.localControllerSeatId`);
      if (
        binding['campaignCharacterId'] !==
          proposal.fullCampaignCopyDiffs[i]?.campaignCharacterIdOrNull ||
        binding['deviceId'] !== proposal.ownerProvenance.requestOwnerDeviceId ||
        binding['inputLaneId'] !== binding['localControllerSeatId']
      )
        invalid(b, 'complete ordered owner tab mapping', null);
      return binding;
    });
    if (bindings.length !== proposal.fullCampaignCopyDiffs.length)
      invalid(c, 'one controller per published copy', null);
    unique(
      bindings.map((b) => text(b['localControllerSeatId'], c)),
      c,
    );
  } else if (row['capacityProofOrNull'] !== null || row['controllerProofOrNull'] !== null)
    invalid(path, 'no admission authority on DECLINE', null);
  const copies = list(row['copies'], `${path}.copies`);
  if (copies.length !== proposal.fullCampaignCopyDiffs.length)
    invalid(path, 'complete whole-batch result', null);
  const groups: {
    assignment: NonNullable<AdmissionMechanicalSheetV1['groupAssignmentOrNull']>;
    id: string;
  }[] = [];
  for (const [i, value] of copies.entries()) {
    const p = `${path}.copies[${String(i)}]`,
      copy = exact(
        value,
        'campaignCharacterId lifecycleState occupiesCampaignPlace groupIdOrNull locationAssignmentOrNull controllerBindingOrNull',
        p,
      ),
      diff = proposal.fullCampaignCopyDiffs[i]!;
    if (
      copy['campaignCharacterId'] !== diff.campaignCharacterIdOrNull ||
      copy['occupiesCampaignPlace'] !== accepted ||
      copy['lifecycleState'] !==
        (!accepted ? 'DECLINED' : diff.blockers.length === 0 ? 'ACTIVE' : 'PROPOSED')
    )
      invalid(p, 'unchanged copy identity and blocker-aware admission result', null);
    if (!accepted) {
      if (
        copy['groupIdOrNull'] !== null ||
        copy['locationAssignmentOrNull'] !== null ||
        copy['controllerBindingOrNull'] !== null
      )
        invalid(p, 'no assignments on DECLINE', null);
      continue;
    }
    const groupId = uuid(copy['groupIdOrNull'], `${p}.groupIdOrNull`),
      assignment = diff.afterSheet.groupAssignmentOrNull!;
    if (assignment.kind === 'EXISTING' && groupId !== assignment.groupId)
      invalid(p, 'selected existing group identity', null);
    for (const previous of groups) {
      const sameDraft =
        assignment.kind === 'NEW' &&
        previous.assignment.kind === 'NEW' &&
        assignment.groupDraftId === previous.assignment.groupDraftId;
      if (
        (sameDraft || (assignment.kind === 'START' && previous.assignment.kind === 'START')) &&
        previous.id !== groupId
      )
        invalid(p, 'shared group identity', null);
      if (
        (assignment.kind === 'NEW' || previous.assignment.kind === 'NEW') &&
        !sameDraft &&
        previous.id === groupId
      )
        invalid(p, 'distinct new group identities', null);
    }
    groups.push({ assignment, id: groupId });
    const location = admissionLocationAssignmentValue(
        copy['locationAssignmentOrNull'],
        `${p}.locationAssignmentOrNull`,
      ),
      expectedLocation = diff.afterSheet.locationAssignmentOrNull!;
    if (
      location.location !== expectedLocation.location ||
      location.subLocationOrNull !== expectedLocation.subLocationOrNull
    )
      invalid(p, 'the exact reviewed location labels', null);
    const binding = exact(
      copy['controllerBindingOrNull'],
      'campaignCharacterId deviceId localControllerSeatId inputLaneId',
      `${p}.controllerBindingOrNull`,
    );
    for (const key of [
      'campaignCharacterId',
      'deviceId',
      'localControllerSeatId',
      'inputLaneId',
    ] as const)
      if (binding[key] !== bindings[i]![key]) invalid(p, 'same accepted controller mapping', null);
  }
  return validated(row);
}
