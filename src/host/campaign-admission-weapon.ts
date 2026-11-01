import type {
  AdmissionReviewDraft,
  AdmissionMechanicalSheetV1,
  AdmissionWeaponDecisionRef,
  AdmissionWeaponResolutionInput,
  AdmissionInventoryReview,
} from '@shared/campaign-admission.js';
import {
  admissionCodecReaders,
  admissionMasterWeaponProfileInputValue,
  admissionWeaponReviewInputValue,
  admissionReviewDraftValue,
} from '@shared/campaign-admission-codec.js';
import {
  deriveMasterWeaponProfile,
  stageValidatedWeaponProfile,
  type StagedWeaponProfile,
} from '../domain/rules/item-stage/master-weapon-profile.js';
import type {
  WeaponEffectiveProfile,
  WeaponProfileCatalog,
  WeaponProfileCatalogEntry,
} from '../domain/rules/item-stage/weapon-profile.js';
import type { ValidatedFinalAdmissionReviewSource } from './device-admission-candidate.js';
import {
  deriveAdmissionSourceProperties,
  validateAdmissionInventorySelection,
  type AdmissionReviewItemIdentity,
  type AdmissionSourceProperty,
} from './campaign-admission-inventory.js';
import type { FiveStartingPositionsCatalog } from '../domain/rules/item-stage/five-starting-positions.js';
import { projectAdmissionWeaponProfile } from './campaign-admission-mechanics.js';
import type { AdmissionStagedWeaponDecision } from '@shared/campaign-admission-review.js';

export type { AdmissionWeaponResolutionInput } from '@shared/campaign-admission.js';
export interface AdmissionWeaponResolution {
  readonly input: AdmissionWeaponResolutionInput;
  readonly beforeProfileOrNull: StagedWeaponProfile | null;
  readonly afterProfile: StagedWeaponProfile;
  readonly reasonOrNull: string | null;
}
/** Only the journal's verified replay supplies these records, never a browser draft. */
export interface VerifiedAdmissionWeaponDecision extends AdmissionStagedWeaponDecision {
  readonly reviewCopyId: string;
}
export function admissionStagedWeaponDecision(
  receiptId: string,
  resolution: AdmissionWeaponResolution,
): AdmissionStagedWeaponDecision {
  return {
    receiptId,
    input: resolution.input,
    beforeProfileOrNull:
      resolution.beforeProfileOrNull === null
        ? null
        : projectAdmissionWeaponProfile(resolution.beforeProfileOrNull),
    afterProfile: projectAdmissionWeaponProfile(resolution.afterProfile),
    reasonOrNull: resolution.reasonOrNull,
  };
}
function fail(detail: string): never {
  throw new Error(`admission weapon: ${detail}`);
}

/** Missing review work is distinct from corrupt history and from permitted lobby blockers. */
export function admissionUnresolvedWeapons(
  properties: readonly AdmissionSourceProperty[],
  inventory: AdmissionInventoryReview,
  decisions: readonly AdmissionStagedWeaponDecision[],
): { readonly requestIds: readonly string[]; readonly reviewItemIds: readonly string[] } {
  const requestIds = properties.flatMap((property) => {
    const request = property.weaponRequestOrNull;
    return request !== null &&
      !decisions.some((decision) => {
        const input = decision.input.weaponReviewInput;
        return (
          input.kind === 'VALIDATED_REQUEST' &&
          input.requestId === request.requestId &&
          input.validationReceiptId === request.validationReceiptId
        );
      })
      ? [request.requestId]
      : [];
  });
  const reviewItemIds = inventory.entries.flatMap((entry) => {
    if (entry.item.kind !== 'CATALOG' || !entry.item.itemTypeId.startsWith('ITM-WPN-')) return [];
    const original = properties.find(
      (property) => property.sourceEntryId === entry.sourceEntryIdOrNull,
    );
    if (entry.weaponDecisionReceiptIdOrNull !== null) return [];
    if (original?.weaponRequestOrNull != null) return [entry.reviewItemId];
    if (original?.weaponProfileOrNull != null) return [];
    const pendingOriginal =
      original?.item.kind === 'CATALOG' &&
      original.item.itemTypeId === entry.item.itemTypeId &&
      entry.sourceEntryIdOrNull !== null &&
      inventory.status === 'PENDING' &&
      inventory.unresolvedSourceEntryIds.includes(entry.sourceEntryIdOrNull);
    return pendingOriginal ? [] : [entry.reviewItemId];
  });
  return { requestIds, reviewItemIds };
}
/** A technical key over three exact registry identities; it does not create a global type. */
export function admissionWeaponTemplateId(entry: WeaponProfileCatalogEntry): string {
  return `${entry.canonicalProfileVersion}/${entry.weaponTypeId}/${entry.weaponVariant}`;
}
function reason(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    fail('master override requires a reason');
  return value;
}
/**
 * Computes a staged decision after journal authority/revision checks. It does not allocate
 * a receipt, live instance or version; the host persists the result in that transaction.
 */
export function deriveAdmissionWeaponResolution(
  source: ValidatedFinalAdmissionReviewSource,
  catalog: WeaponProfileCatalog,
  identities: readonly AdmissionReviewItemIdentity[],
  draft: Pick<AdmissionReviewDraft, 'inventoryReview'>,
  input: AdmissionWeaponResolutionInput,
): AdmissionWeaponResolution {
  admissionCodecReaders.exact(
    input,
    'weaponReviewInput decision overrideProfileOrNull reasonOrNull',
    '$.weaponResolution',
  );
  const review = admissionWeaponReviewInputValue(input.weaponReviewInput);
  if (input.decision !== 'APPROVE' && input.decision !== 'MASTER_OVERRIDE')
    fail('unrecognized weapon decision');
  let beforeProfileOrNull: StagedWeaponProfile | null = null;
  let afterProfile: StagedWeaponProfile;
  let decisionReason: string | null;
  if (review.kind === 'VALIDATED_REQUEST') {
    const original = deriveAdmissionSourceProperties(source).find(
      (property) =>
        property.weaponRequestOrNull?.requestId === review.requestId &&
        property.weaponRequestOrNull.validationReceiptId === review.validationReceiptId,
    );
    const stage = source.checkpoint.weaponProfileStage,
      record = stage?.records.at(-1);
    if (
      original === undefined ||
      stage?.kind !== 'FORMULA' ||
      record?.profileOrNull == null ||
      record.proofOrNull === null ||
      stage.requestId !== review.requestId ||
      record.receipt.receiptId !== review.validationReceiptId
    )
      fail('unknown or changed validated source request');
    const validated = record.profileOrNull as unknown as WeaponEffectiveProfile;
    beforeProfileOrNull = stageValidatedWeaponProfile(validated);
    if (input.decision === 'APPROVE') {
      if (input.overrideProfileOrNull !== null || input.reasonOrNull !== null)
        fail('approval cannot carry an override or fabricated reason');
      afterProfile = beforeProfileOrNull;
      decisionReason = null;
    } else {
      const override = admissionMasterWeaponProfileInputValue(input.overrideProfileOrNull);
      decisionReason = reason(input.reasonOrNull);
      afterProfile = deriveMasterWeaponProfile(
        catalog,
        { weaponTypeId: validated.weaponTypeId, weaponVariant: validated.weaponVariantId },
        override,
        validated,
      );
    }
  } else {
    if (
      input.decision !== 'MASTER_OVERRIDE' ||
      input.overrideProfileOrNull !== null ||
      input.reasonOrNull !== null
    )
      fail('grant uses its own complete profile input and reason');
    const identity = identities.find((entry) => entry.reviewItemId === review.reviewItemId);
    const selected = draft.inventoryReview.entries.find(
      (entry) => entry.reviewItemId === review.reviewItemId,
    );
    if (
      identity === undefined ||
      identity.sourceEntryIdOrNull !== null ||
      selected?.sourceEntryIdOrNull !== null ||
      selected.item.kind !== 'CATALOG' ||
      selected.item.itemTypeId !== review.weaponTypeId
    )
      fail('grant must address a new owned catalog weapon review item');
    decisionReason = reason(review.reason);
    if (review.profileSource.kind === 'CATALOG_TEMPLATE') {
      const templateId = review.profileSource.templateId;
      const template = catalog.entries.find(
        (entry) => admissionWeaponTemplateId(entry) === templateId,
      );
      if (
        template === undefined ||
        template.weaponTypeId !== review.weaponTypeId ||
        template.profileKind !== 'FIXED'
      )
        fail('grant requires an exact complete catalog template');
      afterProfile = stageValidatedWeaponProfile(template.template);
    } else {
      const typed = admissionMasterWeaponProfileInputValue(review.profileSource.typedProfile);
      afterProfile = deriveMasterWeaponProfile(
        catalog,
        { weaponTypeId: review.weaponTypeId, weaponVariant: typed.weaponVariantId },
        typed,
        null,
      );
    }
  }
  // Detached input bytes prevent later browser-draft edits from changing this decision's audit.
  return Object.freeze({
    input: structuredClone(input),
    beforeProfileOrNull,
    afterProfile,
    reasonOrNull: decisionReason,
  });
}

function decisionRef(decision: VerifiedAdmissionWeaponDecision): AdmissionWeaponDecisionRef {
  const input = decision.input.weaponReviewInput;
  return input.kind === 'VALIDATED_REQUEST'
    ? {
        kind: input.kind,
        requestId: input.requestId,
        validationReceiptId: input.validationReceiptId,
        decisionReceiptId: decision.receiptId,
      }
    : {
        kind: input.kind,
        reviewItemId: input.reviewItemId,
        decisionReceiptId: decision.receiptId,
      };
}

/**
 * Publication retains every resolved request even after its inventory row is removed.
 * Decisions are already replayed against their historical draft by the journal; a removed
 * grant must not be revalidated as though it were still selected in the current inventory.
 */
export function deriveAdmissionPublishedInventory(
  source: ValidatedFinalAdmissionReviewSource,
  reviewCopyId: string,
  identities: readonly AdmissionReviewItemIdentity[],
  draft: AdmissionReviewDraft,
  decisions: readonly VerifiedAdmissionWeaponDecision[],
  catalog: FiveStartingPositionsCatalog,
): AdmissionMechanicalSheetV1['inventoryReview'] {
  admissionReviewDraftValue(draft);
  const properties = deriveAdmissionSourceProperties(source);
  validateAdmissionInventorySelection(properties, identities, draft.inventoryReview, catalog);
  const byReceipt = new Map<string, VerifiedAdmissionWeaponDecision>();
  const targets = new Set<string>();
  for (const decision of decisions) {
    admissionCodecReaders.uuid(decision.receiptId, '$.weaponDecision.receiptId');
    if (decision.reviewCopyId !== reviewCopyId || byReceipt.has(decision.receiptId))
      fail('foreign or repeated staged decision receipt');
    const input = decision.input.weaponReviewInput;
    const key =
      input.kind === 'VALIDATED_REQUEST'
        ? `request:${input.requestId}`
        : `grant:${input.reviewItemId}`;
    if (targets.has(key)) fail('repeated terminal weapon decision');
    targets.add(key);
    byReceipt.set(decision.receiptId, decision);
  }
  if (draft.weaponDecisionRefs.length !== decisions.length)
    fail('draft must retain the complete staged weapon decision history');
  for (const ref of draft.weaponDecisionRefs) {
    const decision = byReceipt.get(ref.decisionReceiptId);
    if (decision === undefined) fail('unknown staged weapon decision receipt');
    const expected = decisionRef(decision);
    if (
      ref.kind !== expected.kind ||
      (ref.kind === 'VALIDATED_REQUEST' &&
        (expected.kind !== 'VALIDATED_REQUEST' ||
          ref.requestId !== expected.requestId ||
          ref.validationReceiptId !== expected.validationReceiptId)) ||
      (ref.kind === 'ADMISSION_GRANT' &&
        (expected.kind !== 'ADMISSION_GRANT' || ref.reviewItemId !== expected.reviewItemId))
    )
      fail('changed staged weapon decision reference');
  }
  for (const property of properties) {
    const request = property.weaponRequestOrNull;
    if (request === null) continue;
    if (
      !decisions.some((decision) => {
        const input = decision.input.weaponReviewInput;
        return (
          input.kind === 'VALIDATED_REQUEST' &&
          input.requestId === request.requestId &&
          input.validationReceiptId === request.validationReceiptId
        );
      })
    )
      fail('unresolved typed weapon request blocks publication, including removed weapons');
  }
  const entries = draft.inventoryReview.entries.map((entry) => {
    const original = properties.find(
      (property) => property.sourceEntryId === entry.sourceEntryIdOrNull,
    );
    const receiptId = entry.weaponDecisionReceiptIdOrNull;
    let profile = original?.weaponProfileOrNull ?? null;
    if (receiptId !== null) {
      const decision = byReceipt.get(receiptId);
      if (decision === undefined) fail('inventory claims an unknown staged weapon decision');
      const input = decision.input.weaponReviewInput;
      if (input.kind === 'VALIDATED_REQUEST') {
        if (
          original?.weaponRequestOrNull?.requestId !== input.requestId ||
          original.weaponRequestOrNull.validationReceiptId !== input.validationReceiptId
        )
          fail('weapon decision belongs to another source inventory entry');
      } else if (entry.sourceEntryIdOrNull !== null || entry.reviewItemId !== input.reviewItemId)
        fail('grant decision belongs to another review inventory entry');
      profile = decision.afterProfile;
    } else if (original?.weaponRequestOrNull != null)
      fail('retained source weapon must use its resolved decision');
    const isWeapon = entry.item.kind === 'CATALOG' && entry.item.itemTypeId.startsWith('ITM-WPN-');
    if (
      profile !== null &&
      (entry.item.kind !== 'CATALOG' || profile.weaponTypeId !== entry.item.itemTypeId)
    )
      fail('inventory weapon profile type differs from its item');
    if (
      isWeapon &&
      profile === null &&
      !(
        original?.item.kind === 'CATALOG' &&
        entry.item.kind === 'CATALOG' &&
        original.item.itemTypeId === entry.item.itemTypeId &&
        entry.sourceEntryIdOrNull !== null &&
        draft.inventoryReview.status === 'PENDING' &&
        draft.inventoryReview.unresolvedSourceEntryIds.includes(entry.sourceEntryIdOrNull)
      )
    )
      fail('weapon inventory entry requires a complete bound profile');
    return Object.freeze({
      ...entry,
      weaponProfileOrNull: profile,
      equipmentState: 'UNEQUIPPED' as const,
    });
  });
  return Object.freeze({ ...draft.inventoryReview, entries: Object.freeze(entries) });
}
