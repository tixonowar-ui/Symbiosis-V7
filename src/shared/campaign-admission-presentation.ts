import type { JsonObject, RevisionVector } from './wire-protocol.js';
import type { PresentedBaseForm, PresentedLayerForm } from './wire-v2-protocol.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import {
  admissionCodecReaders as r,
  admissionJsonEqual,
  admissionReviewInputsValue,
  admissionStartingSkillsValue,
  admissionWeaponReviewInputValue,
  admissionMasterWeaponProfileInputValue,
  admissionInventoryReviewValue,
} from './campaign-admission-codec.js';
import {
  admissionMechanicalCoreValue,
  admissionMechanicalSheetValue,
  admissionPublicWeaponProfileValue,
  admissionSheetSkillEntriesValue,
} from './campaign-admission-sheet.js';
import { admissionFullCopyDiffValue } from './campaign-admission-proposal.js';
import {
  admissionOwnerPublicationValue,
  admissionPlayerDecisionReceiptValue,
  admissionGroupLabelsValue,
  admissionExistingGroupIds,
} from './campaign-admission-proposal.js';
import type { WorkflowCommandRequestMessage } from './wire-protocol.js';
import {
  ADMISSION_GM_VIEW_FORM_IDS,
  admissionGmViewValuesValue,
  admissionWeaponResolutionInputValue,
  type AdmissionGmViewFormId,
} from './campaign-admission-review.js';

export const ADMISSION_GM_WORKFLOW_IDS = [
  'UI-CMD-ADMISSION-REVIEW-OPEN',
  'UI-CMD-ADMISSION-GM-ACCEPT',
  'UI-CMD-ADMISSION-GM-REJECT',
  'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
] as const;
export const isAdmissionGmForm = (value: string): value is AdmissionGmViewFormId =>
  (ADMISSION_GM_VIEW_FORM_IDS as readonly string[]).includes(value);
export const ADMISSION_GM_NAV_TARGETS = {
  'NET-018::CTA::001': 'NET-017',
  'NET-018::CTA::002': 'NET-019',
  'NET-018::CTA::003': 'NET-020',
  'NET-018::CTA::004': 'NET-021',
  'NET-019::CTA::001': 'NET-017',
  'NET-019::CTA::002': 'NET-018',
  'NET-019::CTA::004': 'GM-019',
  'NET-019::CTA::005': 'GM-019',
  'NET-020::CTA::001': 'NET-017',
  'NET-020::CTA::002': 'NET-018',
  'NET-021::CTA::001': 'NET-017',
  'NET-021::CTA::002': 'NET-022',
  'NET-021::CTA::003': 'GM-020',
  'NET-021::CTA::004': 'NET-017',
  'NET-022::CTA::001': 'NET-021',
  'NET-022::CTA::002': 'NET-017',
  'GM-019::CTA::004': 'NET-019',
  'GM-020::CTA::001': 'NET-021',
  'NET-017::CTA::001': 'NET-018',
  'NET-017::CTA::002': 'NET-019',
  'NET-017::CTA::003': 'NET-020',
  'NET-017::CTA::004': 'NET-021',
} as const;
const COMMON =
  'contextId campaignId admissionBatchId deviceRequestId requestIdOrNull reviewRevisionOrNull stateRevision projectionRevision actorVisibilityRevision editable reviewScope selectedReviewCopyId batchReviewCopies returnContext viewValues itemLabels groupLabels';
const FIELDS: Readonly<Record<AdmissionGmViewFormId, string>> = {
  'NET-018': 'immutableSourceSnapshot sourceProvenanceAndNaturalRolls',
  'NET-019':
    'localSourceSnapshot reviewDraft afterCore campaignCopyDiff massStatus startingInventoryAndMoneyStatus groupAndLocationAssignment validatedWeaponRequests unresolvedWeaponRequestIds batchFinalizationStatus blockers missingRequiredFields reviewItemIdentities catalogs',
  'NET-020':
    'reviewDraft groupAssignment locationAssignment diff blockers missingRequiredFields groupDraftIds existingGroups',
  'NET-021':
    'proposedCampaignCopies fullCampaignCopyDiffs proposalChecksum allRequiredFieldsValid blockers missingRequiredFields incompleteReviews capacityPreview commandId admissionOrigin ownerProvenance published',
  'NET-022': 'reason commandId admissionOrigin ownerProvenance capacityPreview',
  'GM-020':
    'originalStartingSkills proposedStartingSkills reviewDraft immutableRaceAndClassGrants skillRequirementsAndPoolValidation campaignCopyDiff selectableSkills',
  'GM-019':
    'mode weaponOwnerScope weaponInstanceIdOrNull requestIdOrNull validationReceiptIdOrNull weaponTypeId commonWitness proposedWeaponProfileOrCurrentProfile typedPatchOrOverrideProfile profileVersionOrStagedDecisionPreview currentProfileOrNull decision formulaReachabilityValidation profileVersionBeforeOrNull equipmentState reason operationId masterAuthorityRevision commandId weaponReviewInputOrNull weaponDraftOrNull validatedWeaponRequests grantItems weaponTemplates weaponVariants',
};
export interface AdmissionGmProjection extends JsonObject, RevisionVector {
  readonly contextId: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly selectedReviewCopyId: string;
  readonly reviewRevisionOrNull: number;
  readonly editable: boolean;
}
const bool = (v: unknown, p: string) => {
  if (typeof v !== 'boolean') r.invalid(p, 'boolean', null);
};
const hash = (v: unknown, p: string) => {
  if (!/^[0-9a-f]{64}$/u.test(r.text(v, p))) r.invalid(p, 'SHA-256', null);
};
const equal = (a: unknown, b: unknown, p: string) => {
  if (!admissionJsonEqual(a, b)) r.invalid(p, 'matching admission fields', null);
};
function capacity(value: unknown, path: string): void {
  const c = r.exact(
    value,
    'evaluatedCampaignRevision activePlayerCapacity occupiedCampaignPlaceCount activePcCount candidateCount fitsCurrentCapacity',
    path,
  );
  for (const key of ['evaluatedCampaignRevision', 'occupiedCampaignPlaceCount', 'activePcCount'])
    r.integer(c[key], `${path}.${key}`, 0);
  const limit = r.integer(c['activePlayerCapacity'], `${path}.activePlayerCapacity`, 1),
    count = r.integer(c['candidateCount'], `${path}.candidateCount`, 1);
  if (
    limit > 5 ||
    count > 3 ||
    Number(c['activePcCount']) > Number(c['occupiedCampaignPlaceCount']) ||
    Number(c['occupiedCampaignPlaceCount']) > limit
  )
    r.invalid(path, 'campaign capacity bounds', null);
  bool(c['fitsCurrentCapacity'], `${path}.fitsCurrentCapacity`);
}
function blockers(value: unknown, path: string): void {
  r.list(value, path).forEach((v, index) => {
    const p = `${path}[${index}]`,
      b = r.exact(
        v,
        'kind reviewCopyIdOrNull campaignCharacterIdOrNull sourceEntryIdOrNull message',
        p,
      );
    r.oneOf(b['kind'], ['MASS_PENDING', 'STARTING_PROPERTY_PENDING'], `${p}.kind`);
    r.uuid(b['reviewCopyIdOrNull'], `${p}.reviewCopyIdOrNull`);
    r.nullable(b['campaignCharacterIdOrNull'], `${p}.campaignCharacterIdOrNull`, r.uuid);
    r.nullable(b['sourceEntryIdOrNull'], `${p}.sourceEntryIdOrNull`, r.text);
    r.text(b['message'], `${p}.message`);
  });
}
function texts(value: unknown, path: string): void {
  const values = r.list(value, path).map((v) => r.text(v, path));
  r.unique(values, path);
}
function itemLabels(value: unknown, path: string): void {
  r.list(value, path).forEach((v) => {
    const row = r.exact(v, 'itemTypeId name', path);
    r.text(row['itemTypeId'], path);
    r.text(row['name'], path);
  });
}
function skillCatalog(value: unknown, path: string): void {
  r.list(value, path).forEach((v) => {
    const row = r.exact(
      v,
      'skillId skillLabel bonusDomainScope missingSkillPenalty requirements',
      path,
    );
    for (const key of ['skillId', 'skillLabel', 'bonusDomainScope'])
      r.text(row[key], `${path}.${key}`);
    const penalty = w.record(row['missingSkillPenalty'], path);
    if (penalty['kind'] === 'NO_MISSING_SKILL_PENALTY') r.exact(penalty, 'kind', path);
    else {
      r.exact(penalty, 'kind value', path);
      w.literal(penalty['kind'], 'MISSING_SKILL_PENALTY', path);
      r.finite(penalty['value'], path, -Number.MAX_VALUE);
    }
    r.list(row['requirements'], path).forEach((v) => {
      const req = r.exact(v, 'minValue statCode statLabel', path);
      r.integer(req['minValue'], path, 1);
      r.oneOf(req['statCode'], ['S', 'D', 'M', 'Z', 'I', 'W', 'C'], path);
      r.text(req['statLabel'], path);
    });
  });
}
function skills(value: unknown, path: string): void {
  const row = r.exact(
    value,
    'entries maxSlots usedSlots remainingSlots requirementsSatisfied',
    path,
  );
  const entries = admissionSheetSkillEntriesValue(row['entries'], path);
  const max = r.integer(row['maxSlots'], path, 1),
    used = r.integer(row['usedSlots'], path, 0);
  if (used > max) r.invalid(path, 'pool within capacity', null);
  equal(
    used,
    entries.reduce((n, s) => n + s.slotCost, 0),
    path,
  );
  equal(row['remainingSlots'], max - used, path);
  w.literal(row['requirementsSatisfied'], true, path);
}
function templates(value: unknown, path: string): void {
  r.list(value, path).forEach((v) => {
    const row = r.exact(v, 'templateId profile', path);
    r.text(row['templateId'], path);
    admissionPublicWeaponProfileValue(row['profile'], path);
  });
}
function variants(value: unknown, path: string): void {
  r.list(value, path).forEach((v) => {
    const row = r.exact(v, 'weaponTypeId weaponVariantId name variantLabel', path);
    for (const k of ['weaponTypeId', 'name', 'variantLabel']) r.text(row[k], path);
    r.oneOf(
      row['weaponVariantId'],
      ['DEFAULT', 'ONE_HAND', 'TWO_HAND', 'SWORD', 'SHIELD', 'RAPIER'],
      path,
    );
  });
}
function witness(value: unknown, path: string): void {
  const row = r.exact(value, 'L Lw Ls', path);
  for (const key of ['L', 'Lw', 'Ls']) r.finite(row[key], `${path}.${key}`, 0);
}
function weaponRequests(value: unknown, path: string): void {
  r.list(value, path).forEach((v) => {
    const row = r.exact(
      v,
      'requestId validationReceiptId proposedWeaponProfile commonWitness decisionOrNull',
      path,
    );
    r.text(row['requestId'], path);
    r.text(row['validationReceiptId'], path);
    r.nullable(row['proposedWeaponProfile'], path, admissionPublicWeaponProfileValue);
    witness(row['commonWitness'], path);
    r.nullable(row['decisionOrNull'], path, (v, p) => {
      const d = r.exact(v, 'receiptId input beforeProfileOrNull afterProfile reasonOrNull', p);
      r.uuid(d['receiptId'], p);
      admissionWeaponResolutionInputValue(d['input'], p);
      r.nullable(d['beforeProfileOrNull'], p, admissionPublicWeaponProfileValue);
      admissionPublicWeaponProfileValue(d['afterProfile'], p);
      r.nullable(d['reasonOrNull'], p, r.text);
    });
  });
}
/** Separate GM allowlist: no checkpoint, transport witness or private authority object. */
export function admissionGmProjectionValue(
  formId: AdmissionGmViewFormId,
  value: unknown,
): AdmissionGmProjection {
  const p = r.exact(value, `${COMMON} ${FIELDS[formId]}`, '$.gmAdmission');
  w.jsonObject(p, '$.gmAdmission');
  for (const key of [
    'contextId',
    'campaignId',
    'admissionBatchId',
    'deviceRequestId',
    'selectedReviewCopyId',
  ])
    r.uuid(p[key], `$.${key}`);
  if (formId === 'GM-019') r.nullable(p['requestIdOrNull'], '$.requestIdOrNull', r.text);
  else equal(p['requestIdOrNull'], p['deviceRequestId'], '$.requestIdOrNull');
  for (const key of [
    'reviewRevisionOrNull',
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
  ])
    r.integer(p[key], `$.${key}`, 0);
  if (
    Number(p['projectionRevision']) < Number(p['stateRevision']) ||
    Number(p['actorVisibilityRevision']) > Number(p['stateRevision'])
  )
    r.invalid('$.revisions', 'ordered admission revisions', null);
  bool(p['editable'], '$.editable');
  itemLabels(p['itemLabels'], '$.itemLabels');
  const groupLabels = admissionGroupLabelsValue(p['groupLabels']);
  const checkSheetGroup = (sheet: ReturnType<typeof admissionMechanicalSheetValue>) => {
    const assignment = sheet.groupAssignmentOrNull;
    if (
      assignment?.kind === 'EXISTING' &&
      !groupLabels.some((label) => label.groupId === assignment.groupId)
    )
      r.invalid('$.groupLabels', 'label for every displayed group assignment', null);
  };
  const copies = r.list(p['batchReviewCopies'], '$.batchReviewCopies').map((v, index) => {
    const at = `$.batchReviewCopies[${index}]`,
      c = r.exact(v, 'reviewCopyId sourceUuid name', at);
    r.text(c['sourceUuid'], `${at}.sourceUuid`);
    r.text(c['name'], `${at}.name`);
    return r.uuid(c['reviewCopyId'], `${at}.reviewCopyId`);
  });
  if (copies.length < 1 || copies.length > 3 || !copies.includes(String(p['selectedReviewCopyId'])))
    r.invalid('$.batchReviewCopies', 'selected copy within ordered batch', null);
  r.unique(copies, '$.batchReviewCopies');
  const scope = w.record(p['reviewScope'], '$.reviewScope');
  if (scope['kind'] === 'ORDINARY_DRAFT') {
    r.exact(scope, 'kind admissionBatchId requestId reviewCopyId reviewRevision', '$.reviewScope');
    equal(scope['requestId'], p['deviceRequestId'], '$.reviewScope.requestId');
    equal(scope['reviewCopyId'], p['selectedReviewCopyId'], '$.reviewScope.reviewCopyId');
    equal(scope['reviewRevision'], p['reviewRevisionOrNull'], '$.reviewScope.reviewRevision');
  } else {
    r.exact(
      scope,
      'kind admissionBatchId campaignCharacterId proposalRevision origin requestIdOrNull reviewCopyIdOrNull',
      '$.reviewScope',
    );
    w.literal(scope['kind'], 'PUBLISHED_COPY', '$.reviewScope.kind');
    w.literal(scope['origin'], 'DEVICE_REQUEST', '$.reviewScope.origin');
    r.uuid(scope['campaignCharacterId'], '$.reviewScope.campaignCharacterId');
    r.integer(scope['proposalRevision'], '$.reviewScope.proposalRevision', 0);
    equal(scope['requestIdOrNull'], p['deviceRequestId'], '$.reviewScope.requestIdOrNull');
    equal(
      scope['reviewCopyIdOrNull'],
      p['selectedReviewCopyId'],
      '$.reviewScope.reviewCopyIdOrNull',
    );
    w.literal(p['editable'], false, '$.editable');
  }
  equal(scope['admissionBatchId'], p['admissionBatchId'], '$.reviewScope.admissionBatchId');
  const back = r.exact(p['returnContext'], 'formId campaignId', '$.returnContext');
  w.literal(back['formId'], 'NET-017', '$.returnContext.formId');
  equal(back['campaignId'], p['campaignId'], '$.returnContext.campaignId');
  const values = admissionGmViewValuesValue(p['viewValues']);
  equal(
    values.selectedReviewCopyId,
    p['selectedReviewCopyId'],
    '$.viewValues.selectedReviewCopyId',
  );
  for (const key of ['immutableSourceSnapshot', 'localSourceSnapshot'])
    if (Object.hasOwn(p, key)) checkSheetGroup(admissionMechanicalSheetValue(p[key], `$.${key}`));
  if (Object.hasOwn(p, 'afterCore')) admissionMechanicalCoreValue(p['afterCore']);
  if (Object.hasOwn(p, 'reviewDraft')) admissionReviewInputsValue(p['reviewDraft']);
  for (const key of ['campaignCopyDiff', 'diff'])
    if (Object.hasOwn(p, key))
      r.nullable(p[key], `$.${key}`, (value) => {
        const diff = admissionFullCopyDiffValue(value);
        checkSheetGroup(diff.beforeSheet);
        checkSheetGroup(diff.afterSheet);
        return diff;
      });
  if (Object.hasOwn(p, 'blockers')) blockers(p['blockers'], '$.blockers');
  if (Object.hasOwn(p, 'missingRequiredFields'))
    r.list(p['missingRequiredFields'], '$.missingRequiredFields').forEach((v) => {
      const row = r.exact(v, 'reviewCopyId code', '$.missingRequiredField');
      if (!copies.includes(r.uuid(row['reviewCopyId'], '$.missingRequiredField.reviewCopyId')))
        r.invalid('$.missingRequiredField', 'own batch copy', null);
      r.oneOf(
        row['code'],
        [
          'GROUP_REQUIRED',
          'LOCATION_REQUIRED',
          'WEAPON_REQUEST_REQUIRED',
          'WEAPON_PROFILE_REQUIRED',
          'GROUP_UNAVAILABLE',
        ],
        '$.missingRequiredField.code',
      );
    });
  if (Object.hasOwn(p, 'capacityPreview')) capacity(p['capacityPreview'], '$.capacityPreview');
  if (Object.hasOwn(p, 'validatedWeaponRequests'))
    weaponRequests(p['validatedWeaponRequests'], '$.validatedWeaponRequests');
  if (formId === 'NET-019') {
    const draft = admissionReviewInputsValue(p['reviewDraft']);
    equal(p['massStatus'], draft.massReview, '$.massStatus');
    equal(
      p['startingInventoryAndMoneyStatus'],
      { inventory: draft.inventoryReview, money: draft.moneyReview },
      '$.startingInventoryAndMoneyStatus',
    );
    equal(
      p['groupAndLocationAssignment'],
      { group: draft.groupAssignmentOrNull, location: draft.locationAssignmentOrNull },
      '$.groupAndLocationAssignment',
    );
    texts(p['unresolvedWeaponRequestIds'], '$.unresolvedWeaponRequestIds');
    r.oneOf(
      p['batchFinalizationStatus'],
      ['READY_ALL_OR_NONE', 'BLOCKED_INVALID_BATCH'],
      '$.batchFinalizationStatus',
    );
    r.list(p['reviewItemIdentities'], '$.reviewItemIdentities').forEach((v) => {
      const row = r.exact(v, 'reviewItemId sourceEntryIdOrNull', '$.reviewItemIdentity');
      r.uuid(row['reviewItemId'], '$.reviewItemId');
      r.nullable(row['sourceEntryIdOrNull'], '$.sourceEntryIdOrNull', r.text);
    });
    const catalogs = r.exact(
      p['catalogs'],
      'items skills qualities weaponTemplates weaponVariants',
      '$.catalogs',
    );
    variants(catalogs['weaponVariants'], '$.catalogs.weaponVariants');
    itemLabels(catalogs['items'], '$.catalogs.items');
    equal(catalogs['items'], p['itemLabels'], '$.catalogs.items');
    skillCatalog(catalogs['skills'], '$.catalogs.skills');
    texts(catalogs['qualities'], '$.catalogs.qualities');
    templates(catalogs['weaponTemplates'], '$.catalogs.weaponTemplates');
  }
  if (formId === 'NET-020') {
    const draft = admissionReviewInputsValue(p['reviewDraft']);
    equal(p['groupAssignment'], draft.groupAssignmentOrNull, '$.groupAssignment');
    equal(p['locationAssignment'], draft.locationAssignmentOrNull, '$.locationAssignment');
    r.list(p['groupDraftIds'], '$.groupDraftIds').forEach((v) => r.uuid(v, '$.groupDraftId'));
    r.list(p['existingGroups'], '$.existingGroups').forEach((v) => {
      const g = r.exact(v, 'groupId name', '$.existingGroup');
      r.uuid(g['groupId'], '$.groupId');
      r.text(g['name'], '$.name');
    });
  }
  if (formId === 'NET-021' || formId === 'NET-022') {
    w.literal(p['commandId'], null, '$.commandId');
    w.literal(p['admissionOrigin'], 'DEVICE_REQUEST', '$.admissionOrigin');
    const owner = r.exact(
      p['ownerProvenance'],
      'kind requestId requestOwnerDeviceId',
      '$.ownerProvenance',
    );
    w.literal(owner['kind'], 'DEVICE_REQUEST', '$.ownerProvenance.kind');
    equal(owner['requestId'], p['deviceRequestId'], '$.ownerProvenance.requestId');
    r.uuid(owner['requestOwnerDeviceId'], '$.ownerProvenance.requestOwnerDeviceId');
  }
  if (formId === 'GM-020') {
    const draft = admissionReviewInputsValue(p['reviewDraft']);
    skills(p['originalStartingSkills'], '$.originalStartingSkills');
    admissionStartingSkillsValue(p['proposedStartingSkills'], '$.proposedStartingSkills');
    equal(p['proposedStartingSkills'], draft.startingSkills, '$.proposedStartingSkills');
    admissionSheetSkillEntriesValue(
      p['immutableRaceAndClassGrants'],
      '$.immutableRaceAndClassGrants',
    );
    skills(p['skillRequirementsAndPoolValidation'], '$.skillRequirementsAndPoolValidation');
    skillCatalog(p['selectableSkills'], '$.selectableSkills');
  }
  if (formId === 'NET-018') {
    const source = r.exact(
      p['sourceProvenanceAndNaturalRolls'],
      'provenance naturalRolls',
      '$.source',
    );
    const provenance = r.exact(
      source['provenance'],
      'registryVersion catalogVersion builtAgainstTuple sourceUuid sourceSnapshotId sourceChecksum metadataRevision finalSnapshotVersion',
      '$.provenance',
    );
    for (const key of [
      'registryVersion',
      'catalogVersion',
      'builtAgainstTuple',
      'sourceUuid',
      'sourceSnapshotId',
    ])
      r.text(provenance[key], `$.provenance.${key}`);
    hash(provenance['sourceChecksum'], '$.provenance.sourceChecksum');
    r.integer(provenance['metadataRevision'], '$.provenance.metadataRevision', 0);
    r.integer(provenance['finalSnapshotVersion'], '$.provenance.finalSnapshotVersion', 1);
    r.list(source['naturalRolls'], '$.naturalRolls').forEach((value) => {
      const roll = r.exact(
        value,
        'kind rollRequestId rollReceiptId diceInputMode dieSides faces',
        '$.roll',
      );
      for (const key of ['kind', 'rollRequestId', 'rollReceiptId'])
        r.text(roll[key], `$.roll.${key}`);
      r.oneOf(roll['diceInputMode'], ['AUTO', 'MANUAL'], '$.roll.diceInputMode');
      w.literal(roll['dieSides'], 20, '$.roll.dieSides');
      const faces = r.list(roll['faces'], '$.roll.faces');
      if (faces.length === 0 || faces.some((face) => r.integer(face, '$.face', 1) > 20))
        r.invalid('$.roll.faces', 'physical D20 faces', null);
    });
  }
  if (formId === 'NET-021') {
    const diffs = r
      .list(p['fullCampaignCopyDiffs'], '$.fullCampaignCopyDiffs')
      .map((v) => admissionFullCopyDiffValue(v));
    admissionGroupLabelsValue(p['groupLabels'], admissionExistingGroupIds(diffs));
    bool(p['allRequiredFieldsValid'], '$.allRequiredFieldsValid');
    bool(p['published'], '$.published');
    r.nullable(p['proposalChecksum'], '$.proposalChecksum', hash);
    if (
      (p['allRequiredFieldsValid'] === true &&
        (diffs.length !== copies.length || p['proposalChecksum'] === null)) ||
      diffs.some((diff, index) => diff.reviewCopyIdOrNull !== copies[index])
    )
      r.invalid('$.fullCampaignCopyDiffs', 'whole ordered batch diff', null);
    equal(
      p['proposedCampaignCopies'],
      diffs.map((d) => ({
        reviewCopyId: d.reviewCopyIdOrNull,
        campaignCharacterIdOrNull: d.campaignCharacterIdOrNull,
        characterName: d.characterName,
      })),
      '$.proposedCampaignCopies',
    );
    const incomplete = r.list(p['incompleteReviews'], '$.incompleteReviews');
    incomplete.forEach((v, index) => {
      const row = r.exact(v, 'reviewCopyId beforeSheet afterCore inputs', '$.incompleteReview');
      equal(row['reviewCopyId'], copies[index], '$.incompleteReview.reviewCopyId');
      checkSheetGroup(admissionMechanicalSheetValue(row['beforeSheet']));
      admissionMechanicalCoreValue(row['afterCore']);
      admissionReviewInputsValue(row['inputs']);
    });
    if (diffs.length > 0 ? incomplete.length !== 0 : incomplete.length !== copies.length)
      r.invalid('$.incompleteReviews', 'whole incomplete batch or complete diffs', null);
  }
  if (formId === 'NET-022') {
    r.raw(p['reason'], '$.reason');
    equal(p['reason'], values.rejectionReason, '$.reason');
  }
  if (formId === 'GM-019') {
    w.literal(p['mode'], 'REQUEST_REVIEW', '$.mode');
    r.nullable(p['weaponDraftOrNull'], '$.weaponDraftOrNull', admissionWeaponResolutionInputValue);
    equal(p['weaponDraftOrNull'], values.weaponDraftOrNull, '$.weaponDraftOrNull');
    for (const key of [
      'proposedWeaponProfileOrCurrentProfile',
      'currentProfileOrNull',
      'profileVersionOrStagedDecisionPreview',
    ])
      r.nullable(p[key], `$.${key}`, admissionPublicWeaponProfileValue);
    const owner = r.exact(
      p['weaponOwnerScope'],
      'kind admissionBatchId requestId reviewCopyId reviewRevision',
      '$.weaponOwnerScope',
    );
    equal(
      owner,
      {
        kind: 'ADMISSION_REVIEW',
        admissionBatchId: p['admissionBatchId'],
        requestId: p['deviceRequestId'],
        reviewCopyId: p['selectedReviewCopyId'],
        reviewRevision: p['reviewRevisionOrNull'],
      },
      '$.weaponOwnerScope',
    );
    for (const key of ['weaponInstanceIdOrNull', 'profileVersionBeforeOrNull', 'commandId'])
      w.literal(p[key], null, `$.${key}`);
    for (const key of ['validationReceiptIdOrNull', 'weaponTypeId', 'reason'])
      r.nullable(p[key], `$.${key}`, r.text);
    r.nullable(p['commonWitness'], '$.commonWitness', witness);
    r.nullable(
      p['typedPatchOrOverrideProfile'],
      '$.typedPatchOrOverrideProfile',
      admissionMasterWeaponProfileInputValue,
    );
    r.nullable(
      p['weaponReviewInputOrNull'],
      '$.weaponReviewInputOrNull',
      admissionWeaponReviewInputValue,
    );
    r.nullable(p['decision'], '$.decision', (v, at) =>
      r.oneOf(v, ['APPROVE', 'MASTER_OVERRIDE'], at),
    );
    r.nullable(p['operationId'], '$.operationId', (v, at) => w.literal(v, 'OP-REQ-GM', at));
    r.nullable(p['formulaReachabilityValidation'], '$.formulaReachabilityValidation', (v, at) => {
      const f = r.exact(v, 'valid commonWitness', at);
      w.literal(f['valid'], true, at);
      witness(f['commonWitness'], at);
      equal(f['commonWitness'], p['commonWitness'], at);
    });
    equal(p['masterAuthorityRevision'], p['actorVisibilityRevision'], '$.masterAuthorityRevision');
    w.literal(p['equipmentState'], 'UNEQUIPPED_ON_MATERIALIZATION', '$.equipmentState');
    admissionInventoryReviewValue(
      { status: 'FINAL', entries: p['grantItems'], unresolvedSourceEntryIds: [] },
      '$.grantItems',
    );
    templates(p['weaponTemplates'], '$.weaponTemplates');
    variants(p['weaponVariants'], '$.weaponVariants');
    const draft = values.weaponDraftOrNull;
    equal(
      p['weaponReviewInputOrNull'],
      draft?.weaponReviewInput ?? null,
      '$.weaponReviewInputOrNull',
    );
    equal(
      p['typedPatchOrOverrideProfile'],
      draft?.overrideProfileOrNull ?? null,
      '$.typedPatchOrOverrideProfile',
    );
    equal(p['decision'], draft?.decision ?? null, '$.decision');
  }
  return r.validated(p);
}

/** Dialog ancestry and all scope/revision bindings are checked before the browser adopts a view. */
export function admissionGmPresentationValue(
  base: PresentedBaseForm,
  layers: readonly PresentedLayerForm[],
  revisions: RevisionVector,
): void {
  if (!isAdmissionGmForm(base.formId)) r.invalid('$.base', 'GM admission base', null);
  const active = layers.at(-1) ?? base;
  const expected =
    active.formId === 'NET-022'
      ? ['NET-018', 'NET-021', 'NET-022']
      : active.formId === 'NET-020' || active.formId === 'NET-021'
        ? ['NET-018', active.formId]
        : [active.formId];
  const forms = [base, ...layers];
  if (forms.length !== expected.length)
    r.invalid('$.layers', 'exact admission dialog ancestry', null);
  const first = admissionGmProjectionValue(
    r.oneOf(base.formId, ADMISSION_GM_VIEW_FORM_IDS, '$.base.formId'),
    base.roleFilteredPayload,
  );
  forms.forEach((form, index) => {
    if (form.formId !== expected[index] || !isAdmissionGmForm(form.formId))
      r.invalid('$.formId', 'exact admission form', null);
    const p = admissionGmProjectionValue(
      r.oneOf(form.formId, ADMISSION_GM_VIEW_FORM_IDS, '$.formId'),
      form.roleFilteredPayload,
    );
    for (const key of [
      'contextId',
      'campaignId',
      'admissionBatchId',
      'selectedReviewCopyId',
      'reviewRevisionOrNull',
      'viewValues',
      'deviceRequestId',
      'reviewScope',
      'editable',
      'batchReviewCopies',
      'itemLabels',
    ])
      equal(p[key], first[key], `$.${key}`);
    for (const axis of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const)
      equal(p[axis], revisions[axis], `$.${axis}`);
    if (index < forms.length - 1 && form.availableActionKeys.length !== 0)
      r.invalid('$.availableActionKeys', 'inactive ancestor', null);
    if (form.formType === 'screen' && form.routeBindings[0]?.value !== p.campaignId)
      r.invalid('$.routeBindings', 'own campaign binding', null);
  });
}

export const ADMISSION_OWNER_FORM_IDS = ['NET-027', 'NET-006', 'NET-007'] as const;
export type AdmissionOwnerFormId = (typeof ADMISSION_OWNER_FORM_IDS)[number];
export const isAdmissionOwnerForm = (value: string): value is AdmissionOwnerFormId =>
  (ADMISSION_OWNER_FORM_IDS as readonly string[]).includes(value);
export type AdmissionOwnerCommand = WorkflowCommandRequestMessage<'UI-CMD-ADMISSION-PLAYER-DECIDE'>;
/** Browser chooses the whole batch only. The installation prepares actual controller tabs. */
export function admissionOwnerCommandValue(value: unknown): AdmissionOwnerCommand {
  const row = r.exact(
    value,
    'messageType protocolVersion commandKind role commandId workflowCommandId expectedRevisions payload',
    '$.ownerCommand',
  );
  w.literal(row['messageType'], 'command.request', '$.messageType');
  w.literal(row['protocolVersion'], 1, '$.protocolVersion');
  w.literal(row['commandKind'], 'workflow-command', '$.commandKind');
  w.literal(row['role'], 'player', '$.role');
  w.literal(row['workflowCommandId'], 'UI-CMD-ADMISSION-PLAYER-DECIDE', '$.workflowCommandId');
  r.text(row['commandId'], '$.commandId');
  w.revisions(row['expectedRevisions'], '$.expectedRevisions');
  const p = r.exact(
    row['payload'],
    'contextId networkScopeId campaignId requestId admissionBatchId proposalRevision proposalChecksum expectedCampaignRevision decision',
    '$.payload',
  );
  for (const key of ['contextId', 'networkScopeId', 'campaignId', 'requestId', 'admissionBatchId'])
    r.uuid(p[key], `$.payload.${key}`);
  r.integer(p['proposalRevision'], '$.proposalRevision', 1);
  hash(p['proposalChecksum'], '$.proposalChecksum');
  r.integer(p['expectedCampaignRevision'], '$.expectedCampaignRevision', 0);
  r.oneOf(p['decision'], ['ACCEPT', 'DECLINE'], '$.decision');
  return r.validated(row);
}
export function admissionOwnerProjectionValue(
  formId: AdmissionOwnerFormId,
  value: unknown,
): JsonObject {
  const row = r.exact(
    value,
    'contextId networkScopeId controllerSeat deviceId campaignId requestIdOrNull admissionBatchId stateRevision projectionRevision actorVisibilityRevision draftRevision publication receiptOrNull pendingCommandIdOrNull campaignRevisionOrNull technicalSessionAvailable itemLabels admissionOrigin ownerProvenance fullCampaignCopyDiffs blockers proposalRevision proposalChecksum decision commandId capacityRecheck controllerDeviceRecheck ownCampaignCopies controllerBindings campaignStatus readyStatus startStatus result gmReasonOrNull decisionReceiptId signedReturnContextOrNull',
    '$.ownerAdmission',
  );
  w.jsonObject(row, '$.ownerAdmission');
  for (const key of [
    'contextId',
    'networkScopeId',
    'controllerSeat',
    'deviceId',
    'campaignId',
    'admissionBatchId',
  ])
    r.uuid(row[key], `$.${key}`);
  const publication = admissionOwnerPublicationValue(row['publication']),
    proposal = publication.proposalOrNull;
  for (const [key, expected] of Object.entries({
    campaignId: publication.gmDecision.campaignId,
    requestIdOrNull: publication.gmDecision.requestId,
    admissionBatchId: publication.gmDecision.admissionBatchId,
    deviceId: publication.gmDecision.requestOwnerDeviceId,
  }))
    equal(row[key], expected, `$.${key}`);
  const receipt = r.nullable(row['receiptOrNull'], '$.receiptOrNull', (v) =>
    admissionPlayerDecisionReceiptValue(v, publication),
  );
  for (const axis of [
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
    'draftRevision',
  ])
    r.integer(row[axis], `$.${axis}`, 0);
  if (
    Number(row['projectionRevision']) < Number(row['stateRevision']) ||
    row['actorVisibilityRevision'] !== 0
  )
    r.invalid('$.revisions', 'local owner revision vector', null);
  r.nullable(row['campaignRevisionOrNull'], '$.campaignRevisionOrNull', (v, p) =>
    r.integer(v, p, 0),
  );
  r.nullable(row['pendingCommandIdOrNull'], '$.pendingCommandIdOrNull', r.text);
  equal(row['commandId'], row['pendingCommandIdOrNull'], '$.commandId');
  bool(row['technicalSessionAvailable'], '$.technicalSessionAvailable');
  itemLabels(row['itemLabels'], '$.itemLabels');
  w.literal(row['admissionOrigin'], 'DEVICE_REQUEST', '$.admissionOrigin');
  equal(
    row['ownerProvenance'],
    {
      kind: 'DEVICE_REQUEST',
      requestId: publication.gmDecision.requestId,
      requestOwnerDeviceId: publication.gmDecision.requestOwnerDeviceId,
    },
    '$.ownerProvenance',
  );
  equal(
    row['fullCampaignCopyDiffs'],
    proposal?.fullCampaignCopyDiffs ?? [],
    '$.fullCampaignCopyDiffs',
  );
  equal(row['blockers'], proposal?.blockers ?? [], '$.blockers');
  equal(row['proposalRevision'], proposal?.proposalRevision ?? null, '$.proposalRevision');
  equal(row['proposalChecksum'], proposal?.proposalChecksum ?? null, '$.proposalChecksum');
  equal(row['decision'], receipt?.decision ?? null, '$.decision');
  equal(row['ownCampaignCopies'], receipt?.copies ?? [], '$.ownCampaignCopies');
  equal(
    row['controllerBindings'],
    receipt?.controllerProofOrNull?.controllerBindings ?? [],
    '$.controllerBindings',
  );
  r.nullable(row['capacityRecheck'], '$.capacityRecheck', capacity);
  bool(row['controllerDeviceRecheck'], '$.controllerDeviceRecheck');
  w.literal(row['campaignStatus'], 'PAUSED', '$.campaignStatus');
  w.literal(row['readyStatus'], 'NOT_READY', '$.readyStatus');
  w.literal(row['startStatus'], 'NOT_STARTED', '$.startStatus');
  const outcome =
    publication.gmDecision.decision === 'REJECT'
      ? 'GM_REJECTED'
      : receipt?.decision === 'DECLINE'
        ? 'PLAYER_DECLINED'
        : receipt?.decision === 'ACCEPT'
          ? 'PLAYER_ACCEPTED'
          : 'AWAITING_PLAYER';
  equal(row['result'], outcome, '$.result');
  equal(row['gmReasonOrNull'], publication.gmDecision.reasonOrNull, '$.gmReasonOrNull');
  equal(
    row['decisionReceiptId'],
    receipt?.receiptId ?? publication.gmDecision.receiptId,
    '$.decisionReceiptId',
  );
  w.literal(row['signedReturnContextOrNull'], null, '$.signedReturnContextOrNull');
  if (
    (formId === 'NET-006' && outcome !== 'PLAYER_ACCEPTED') ||
    (formId === 'NET-007' && outcome !== 'GM_REJECTED' && outcome !== 'PLAYER_DECLINED') ||
    (formId === 'NET-027' && proposal === null)
  )
    r.invalid('$.formId', 'owner decision destination', null);
  if (receipt !== null && row['pendingCommandIdOrNull'] !== null)
    r.invalid('$.pendingCommandIdOrNull', 'settled owner decision', null);
  return r.validated(row);
}
