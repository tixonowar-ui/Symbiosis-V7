import { isDeepStrictEqual } from 'node:util';

import type { JsonObject } from '@shared/wire-protocol.js';
import {
  weaponProfilePlayerFacts,
  type WeaponEffectiveProfile,
} from '../domain/rules/item-stage/weapon-profile.js';
import type { DurableCreationWizardCheckpoint } from './creation-set-decide.js';
import { fiveStartingPositionSnapshots } from './creation-five-starting-positions-contract.js';
import { guardSymbiontRejected } from './creation-symbiont-contract.js';

export interface StartingPropertyReceiptRef extends JsonObject {
  readonly block: 'ARMOR_BUNDLE' | 'WEAPON' | 'MONEY' | 'POSITION';
  readonly positionIdOrNull: string | null;
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly rawFace: number;
}

export function startingPropertyResumeAvailable(
  checkpoint: DurableCreationWizardCheckpoint,
): boolean {
  return (
    checkpoint.localCharacter.lifecycleState === 'DRAFT' &&
    checkpoint.fiveStartingPositionsStage?.checkpointRecordOrNull != null
  );
}

function recommendation(value: {
  readonly kind: string;
  readonly label: string;
  readonly range: string;
  readonly rawFace: number;
}): JsonObject {
  return { kind: value.kind, label: value.label, range: value.range, rawFace: value.rawFace };
}

interface PhysicalRecord {
  readonly request: { readonly payload: { readonly characterDraftId: string } };
  readonly receipt: { readonly receiptId: string };
  readonly physicalRoll: {
    readonly kind: string;
    readonly rollRequestId: string;
    readonly rollReceiptId: string;
    readonly mechanical: { readonly dieSides: number; readonly rawFace: number };
  };
}

function reference(
  owner: string,
  block: StartingPropertyReceiptRef['block'],
  positionIdOrNull: string | null,
  expectedKind: string,
  expectedRequestId: string,
  record: PhysicalRecord,
): StartingPropertyReceiptRef {
  const roll = record.physicalRoll;
  if (
    record.request.payload.characterDraftId !== owner ||
    roll.kind !== expectedKind ||
    roll.rollRequestId !== expectedRequestId ||
    roll.rollReceiptId !== record.receipt.receiptId ||
    typeof roll.rollRequestId !== 'string' ||
    roll.rollRequestId.length === 0 ||
    typeof roll.rollReceiptId !== 'string' ||
    roll.rollReceiptId.length === 0 ||
    roll.mechanical.dieSides !== 20 ||
    !Number.isSafeInteger(roll.mechanical.rawFace) ||
    roll.mechanical.rawFace < 1 ||
    roll.mechanical.rawFace > 20
  )
    return guardSymbiontRejected();
  return {
    block,
    positionIdOrNull,
    rollRequestId: roll.rollRequestId,
    rollReceiptId: roll.rollReceiptId,
    rawFace: roll.mechanical.rawFace,
  };
}

/** AQ2-003 counts operations: armor bundle, weapon, money and five separate whole stacks. */
export function collectStartingPropertyReceiptRefs(
  checkpoint: DurableCreationWizardCheckpoint,
): readonly StartingPropertyReceiptRef[] {
  const armor = checkpoint.armorBundleStage;
  const weapon = checkpoint.startingWeaponStage;
  const money = checkpoint.startingMoneyStage;
  const five = checkpoint.fiveStartingPositionsStage;
  if (
    armor?.qualityRollRecordOrNull == null ||
    armor.checkpointRecordOrNull === null ||
    weapon?.qualityRollRecordOrNull == null ||
    weapon.checkpointRecordOrNull === null ||
    money?.rollRecordOrNull == null ||
    money.checkpointRecordOrNull === null ||
    five == null ||
    five.checkpointRecordOrNull === null ||
    five.slots.length !== 5 ||
    five.rollRecords.length !== 5 ||
    new Set(five.slots.map((slot) => slot.positionId)).size !== 5 ||
    five.moneyCheckpointReceiptId !== money.checkpointRecordOrNull.receipt.receiptId ||
    weapon.armorBundleCheckpointReceiptId !== armor.checkpointRecordOrNull.receipt.receiptId
  )
    return guardSymbiontRejected();
  const owner = checkpoint.localCharacter.localCharacterId;
  const refs = [
    reference(
      owner,
      'ARMOR_BUNDLE',
      null,
      'ARMOR_BUNDLE_QUALITY',
      armor.qualityRollRequestId,
      armor.qualityRollRecordOrNull,
    ),
    reference(
      owner,
      'WEAPON',
      null,
      'STARTING_WEAPON_QUALITY',
      weapon.weaponQualityRollRequestId,
      weapon.qualityRollRecordOrNull,
    ),
    reference(
      owner,
      'MONEY',
      null,
      'STARTING_MONEY',
      money.moneyRollRequestId,
      money.rollRecordOrNull,
    ),
    ...five.slots.map((slot) => {
      const matches = five.rollRecords.filter((r) => r.position.positionId === slot.positionId);
      if (matches.length !== 1) return guardSymbiontRejected();
      const record = matches[0]!;
      const ref = reference(
        owner,
        'POSITION',
        slot.positionId,
        'FIVE_STARTING_POSITION_QUALITY',
        slot.qualityRollRequestId,
        record,
      );
      if (
        record.position.qualityRollRequestId !== ref.rollRequestId ||
        record.position.qualityRollReceiptId !== ref.rollReceiptId ||
        record.position.qualityRollFaceOrNull !== ref.rawFace
      )
        return guardSymbiontRejected();
      return ref;
    }),
  ];
  if (
    new Set(refs.map((ref) => ref.rollReceiptId)).size !== 8 ||
    new Set(refs.map((ref) => ref.rollRequestId)).size !== 8
  )
    return guardSymbiontRejected();
  return refs;
}

export function validateStartingPropertyReceiptRefs(
  checkpoint: DurableCreationWizardCheckpoint,
  value: unknown,
): readonly StartingPropertyReceiptRef[] {
  const expected = collectStartingPropertyReceiptRefs(checkpoint);
  if (!isDeepStrictEqual(value, expected)) return guardSymbiontRejected();
  return expected;
}

/** Player-facing summary deliberately excludes formula proof, source rows and GM decisions. */
export function deriveStartingPropertySummary(
  checkpoint: DurableCreationWizardCheckpoint,
): JsonObject {
  const propertyRollReceipts = collectStartingPropertyReceiptRefs(checkpoint);
  const armor = checkpoint.armorBundleStage!;
  const weapon = checkpoint.startingWeaponStage!;
  const money = checkpoint.startingMoneyStage!;
  const profile = checkpoint.weaponProfileStage?.records.at(-1);
  if (
    profile == null ||
    profile.profileOrNull === null ||
    profile.receipt.result.outcome === 'INVALID'
  )
    return guardSymbiontRejected();
  const armorRoll = armor.qualityRollRecordOrNull!;
  const weaponRoll = weapon.qualityRollRecordOrNull!;
  const moneyRoll = money.rollRecordOrNull!;
  return {
    armorBundle: {
      armorBundleId: armor.armorBundleId,
      armorPieces: armorRoll.armorPieces.map((piece) => ({
        itemId: piece.itemId,
        name: piece.name,
        coverageModel: piece.coverageModel,
        bodyZone: piece.bodyZone,
      })),
      distinctBodyZones: [...armorRoll.distinctBodyZones],
      qualityRecommendation: recommendation(armorRoll.qualityRecommendation),
      ownershipState: 'OWNED_NOT_EQUIPPED',
    },
    weapon: {
      weaponTypeId: weaponRoll.weaponTypeId,
      weaponVariant: weaponRoll.weaponVariant,
      name: weaponRoll.name,
      qualityRecommendation: recommendation(weaponRoll.qualityRecommendation),
      profileFacts: weaponProfilePlayerFacts(
        profile.profileOrNull as unknown as WeaponEffectiveProfile,
      ).map((fact) => ({ ...fact })),
      profileStatus: profile.receipt.result.outcome,
      ownershipState: 'OWNED_NOT_EQUIPPED',
    },
    moneyRecommendation: {
      wealthRecommendation: recommendation(moneyRoll.wealthRecommendation),
      gmFinalizationRequired: true,
    },
    fivePositions: fiveStartingPositionSnapshots(checkpoint.fiveStartingPositionsStage!).map(
      (position) => ({
        positionId: position.positionId,
        qualityRollRequestId: position.qualityRollRequestId,
        itemTypeIdOrStoryType: position.itemTypeIdOrStoryType,
        quantity: position.quantity,
        storyDescriptionOrNull: position.storyDescriptionOrNull,
        name: position.name,
        kind: position.kind,
        qualityRollReceiptId: position.qualityRollReceiptId,
        qualityRollFaceOrNull: position.qualityRollFaceOrNull,
        qualityRecommendation:
          position.qualityRecommendation === null
            ? null
            : recommendation(position.qualityRecommendation),
        ownershipState: 'OWNED_NOT_EQUIPPED',
      }),
    ),
    propertyRollReceipts: [...propertyRollReceipts],
    exactOperationCount: 8,
    ownershipStateAll: 'OWNED_NOT_EQUIPPED',
  };
}
