import type {
  AdmissionInventoryReview,
  AdmissionItem,
  AdmissionSheetInventoryEntry,
} from '@shared/campaign-admission.js';
import {
  admissionCodecReaders,
  admissionInventoryReviewValue,
} from '@shared/campaign-admission-codec.js';
import { recommendArmorQuality } from '../domain/rules/item-stage/armor-bundle.js';
import {
  validateStartingPositionPublicText,
  type FiveStartingPositionsCatalog,
} from '../domain/rules/item-stage/five-starting-positions.js';
import type { WeaponEffectiveProfile } from '../domain/rules/item-stage/weapon-profile.js';
import { collectStartingPropertyReceiptRefs } from './creation-property-summary.js';
import { fiveStartingPositionSnapshots } from './creation-five-starting-positions-contract.js';
import type { ValidatedFinalAdmissionReviewSource } from './device-admission-candidate.js';
import { projectAdmissionWeaponProfile } from './campaign-admission-mechanics.js';
import { canonicalPostSaveJson, postSaveSha256 } from './local-character-export.js';

export interface AdmissionSourceProperty {
  readonly sourceEntryId: string;
  readonly item: AdmissionItem;
  readonly quantity: number;
  readonly qualityLabel: string;
  readonly weaponProfileOrNull: AdmissionSheetInventoryEntry['weaponProfileOrNull'];
  /** Actual original validation/submission receipt (ADR 0059), never a new operation receipt. */
  readonly weaponRequestOrNull: Readonly<{ requestId: string; validationReceiptId: string }> | null;
}
export interface AdmissionReviewItemIdentity {
  readonly reviewItemId: string;
  readonly sourceEntryIdOrNull: string | null;
}
function fail(detail: string): never {
  throw new Error(`admission inventory: ${detail}`);
}

/** Pure address derivation: reading a source does not allocate review or live item identities. */
export function deriveAdmissionSourceProperties(
  source: ValidatedFinalAdmissionReviewSource,
): readonly AdmissionSourceProperty[] {
  const checkpoint = source.checkpoint;
  collectStartingPropertyReceiptRefs(checkpoint);
  const armor = checkpoint.armorBundleStage?.qualityRollRecordOrNull;
  const weapon = checkpoint.startingWeaponStage?.qualityRollRecordOrNull;
  const profileStage = checkpoint.weaponProfileStage;
  const profile = profileStage?.records.at(-1);
  const positionsStage = checkpoint.fiveStartingPositionsStage;
  if (
    checkpoint.localCharacter.lifecycleState !== 'FINAL' ||
    armor == null ||
    weapon == null ||
    profileStage == null ||
    profile?.profileOrNull == null ||
    positionsStage == null
  )
    fail('complete verified FINAL starting property is required');
  const id = (kind: 'ARMOR' | 'WEAPON' | 'POSITION', sourceKey: string): string =>
    postSaveSha256(
      canonicalPostSaveJson({
        sourceUuid: source.candidate.descriptor.sourceUuid,
        sourceSnapshotId: source.candidate.descriptor.sourceSnapshotId,
        kind,
        sourceKey,
      }),
    );
  const entries: AdmissionSourceProperty[] = armor.armorPieces.map((piece, index) =>
    Object.freeze({
      sourceEntryId: id('ARMOR', String(index)),
      item: Object.freeze({ kind: 'CATALOG' as const, itemTypeId: piece.itemId }),
      quantity: 1,
      qualityLabel: armor.qualityRecommendation.label,
      weaponProfileOrNull: null,
      weaponRequestOrNull: null,
    }),
  );
  const submitted = profile.receipt.result;
  if (
    (profileStage.kind === 'FORMULA' &&
      (submitted.outcome !== 'SUBMITTED' || submitted.approvalStatus !== 'PENDING_GM')) ||
    (profileStage.kind === 'FIXED' &&
      (submitted.outcome !== 'ACKNOWLEDGED' || submitted.approvalStatus !== 'NOT_APPLICABLE'))
  )
    fail('source weapon validation/approval facts differ');
  entries.push(
    Object.freeze({
      sourceEntryId: id('WEAPON', profileStage.requestId),
      item: Object.freeze({ kind: 'CATALOG', itemTypeId: weapon.weaponTypeId }),
      quantity: 1,
      qualityLabel: weapon.qualityRecommendation.label,
      weaponProfileOrNull: projectAdmissionWeaponProfile(
        profile.profileOrNull as unknown as WeaponEffectiveProfile,
      ),
      weaponRequestOrNull:
        profileStage.kind === 'FORMULA'
          ? Object.freeze({
              requestId: profileStage.requestId,
              validationReceiptId: profile.receipt.receiptId,
            })
          : null,
    }),
  );
  for (const position of fiveStartingPositionSnapshots(positionsStage)) {
    if (
      position.qualityRecommendation === null ||
      position.itemTypeIdOrStoryType === null ||
      position.name === null ||
      position.quantity === null
    )
      fail('source position identity, quantity or quality recommendation is missing');
    let item: AdmissionItem;
    if (position.kind === 'CATALOGUE')
      item = Object.freeze({ kind: 'CATALOG', itemTypeId: position.itemTypeIdOrStoryType });
    else if (position.kind === 'STORY' && position.storyDescriptionOrNull !== null)
      item = Object.freeze({
        kind: 'CUSTOM_ITEM',
        name: position.name,
        description: position.storyDescriptionOrNull,
        statBonusOrNull: null,
      });
    else return fail('unrecognized source position kind or missing description');
    entries.push(
      Object.freeze({
        sourceEntryId: id('POSITION', position.positionId),
        item,
        quantity: position.quantity,
        qualityLabel: position.qualityRecommendation.label,
        weaponProfileOrNull: null,
        weaponRequestOrNull: null,
      }),
    );
  }
  if (new Set(entries.map((entry) => entry.sourceEntryId)).size !== entries.length)
    fail('duplicate source property identity');
  return Object.freeze(entries);
}

/** OPEN supplies the already allocated one-to-one mapping; read/replay never allocates it again. */
export function initialAdmissionInventoryReview(
  properties: readonly AdmissionSourceProperty[],
  identities: readonly AdmissionReviewItemIdentity[],
): AdmissionInventoryReview {
  if (
    properties.length !== identities.length ||
    new Set(identities.map((entry) => entry.sourceEntryIdOrNull)).size !== identities.length
  )
    fail('initial review must map every immutable source property exactly once');
  const entries = properties.map((property) => {
    const identity = identities.find(
      (candidate) => candidate.sourceEntryIdOrNull === property.sourceEntryId,
    );
    if (identity === undefined) fail('source property review identity is missing');
    return Object.freeze({
      reviewItemId: identity.reviewItemId,
      sourceEntryIdOrNull: property.sourceEntryId,
      item: property.item,
      quantity: property.quantity,
      qualityLabel: property.qualityLabel,
      weaponDecisionReceiptIdOrNull: null,
    });
  });
  return Object.freeze(
    admissionInventoryReviewValue(
      {
        status: 'PENDING',
        entries: Object.freeze(entries),
        unresolvedSourceEntryIds: Object.freeze(properties.map((entry) => entry.sourceEntryId)),
      },
      '$.inventoryReview',
    ),
  );
}

/** The before sheet retains every source item and its explicit unresolved review status. */
export function admissionSourceInventorySheet(
  properties: readonly AdmissionSourceProperty[],
  identities: readonly AdmissionReviewItemIdentity[],
): Readonly<{
  status: 'PENDING';
  entries: readonly AdmissionSheetInventoryEntry[];
  unresolvedSourceEntryIds: readonly string[];
}> {
  const initial = initialAdmissionInventoryReview(properties, identities);
  return Object.freeze({
    status: 'PENDING',
    unresolvedSourceEntryIds: initial.unresolvedSourceEntryIds,
    entries: Object.freeze(
      initial.entries.map((entry, index) =>
        Object.freeze({
          ...entry,
          weaponProfileOrNull: properties[index]!.weaponProfileOrNull,
          equipmentState: 'UNEQUIPPED' as const,
        }),
      ),
    ),
  });
}

/** Registry and identity checks for a draft, separate from publication's weapon-decision gate. */
export function validateAdmissionInventorySelection(
  properties: readonly AdmissionSourceProperty[],
  identities: readonly AdmissionReviewItemIdentity[],
  inventory: AdmissionInventoryReview,
  catalog: FiveStartingPositionsCatalog,
): AdmissionInventoryReview {
  admissionInventoryReviewValue(inventory, '$.inventoryReview');
  const sourceById = new Map(properties.map((entry) => [entry.sourceEntryId, entry]));
  if (sourceById.size !== properties.length) fail('duplicate immutable source entry');
  const identityById = new Map<string, AdmissionReviewItemIdentity>();
  const seenSources = new Set<string>();
  for (const identity of identities) {
    admissionCodecReaders.exact(
      identity,
      'reviewItemId sourceEntryIdOrNull',
      '$.reviewItemIdentity',
    );
    admissionCodecReaders.uuid(identity.reviewItemId, '$.reviewItemIdentity.reviewItemId');
    if (identityById.has(identity.reviewItemId)) fail('duplicate allocated review item');
    if (identity.sourceEntryIdOrNull !== null) {
      if (
        !sourceById.has(identity.sourceEntryIdOrNull) ||
        seenSources.has(identity.sourceEntryIdOrNull)
      )
        fail('foreign or repeated source item identity');
      seenSources.add(identity.sourceEntryIdOrNull);
    }
    identityById.set(identity.reviewItemId, identity);
  }
  if (seenSources.size !== properties.length)
    fail('original review item identities must be retained after removal');
  // CORE-172/173: enumerate the existing descriptive D20 quality scale, without RNG.
  const qualities = new Set(
    Array.from({ length: 20 }, (_, index) => recommendArmorQuality(index + 1).label),
  );
  for (const entry of inventory.entries) {
    const identity = identityById.get(entry.reviewItemId);
    if (identity === undefined || identity.sourceEntryIdOrNull !== entry.sourceEntryIdOrNull)
      fail('inventory entry does not match its owned stable review identity');
    const original =
      entry.sourceEntryIdOrNull === null ? undefined : sourceById.get(entry.sourceEntryIdOrNull);
    if (
      original?.item.kind === 'CATALOG' &&
      original.item.itemTypeId.startsWith('ITM-WPN-') &&
      (entry.item.kind !== 'CATALOG' || entry.item.itemTypeId !== original.item.itemTypeId)
    )
      fail('weapon type replacement requires a distinct new review item');
    if (entry.item.kind === 'CATALOG') {
      const itemTypeId = entry.item.itemTypeId;
      if (
        !catalog.entries.some(
          (candidate) =>
            candidate.kind === 'CATALOGUE' && candidate.itemTypeIdOrStoryType === itemTypeId,
        )
      )
        fail('unknown or non-inventory catalog item');
    } else {
      validateStartingPositionPublicText(entry.item.name);
      if (entry.item.description !== '') validateStartingPositionPublicText(entry.item.description);
    }
    if (!qualities.has(entry.qualityLabel)) fail('unrecognized descriptive quality label');
    if (
      (entry.item.kind !== 'CATALOG' || !entry.item.itemTypeId.startsWith('ITM-WPN-')) &&
      entry.weaponDecisionReceiptIdOrNull !== null
    )
      fail('non-weapon inventory entry cannot claim a weapon decision');
  }
  for (const id of inventory.unresolvedSourceEntryIds)
    if (!sourceById.has(id)) fail('unresolved inventory entry belongs to another source');
  return inventory;
}
