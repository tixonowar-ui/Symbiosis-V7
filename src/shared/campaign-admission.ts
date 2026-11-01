// Closed wire literals mirror the character registry; shared has no domain/schema dependency.
type StatCode = 'S' | 'D' | 'M' | 'Z' | 'I' | 'W' | 'C';
type RaceCode = 'FREE' | 'PURE' | 'UNITED';
type ClassCode = 'SEEKER' | 'SOLDIER' | 'STALKER';

/** Atlas 1.7 NET-019 / ADR 0071. These inputs are not published mechanics. */
export type AdmissionStats = Readonly<Record<StatCode, number>>;
export interface AdmissionStartingSkill {
  readonly skillKey: string;
  readonly targetBonus: number;
}
export interface AdmissionMassReview {
  readonly massKg: number;
  readonly decision: 'PENDING_MASTER_APPROVAL' | 'APPROVED';
}
export type AdmissionMoneyReview =
  | Readonly<{ status: 'PENDING'; amountOrNull: null }>
  | Readonly<{ status: 'FINAL'; amountOrNull: number }>;
export type AdmissionItem =
  | Readonly<{ kind: 'CATALOG'; itemTypeId: string }>
  | Readonly<{
      kind: 'CUSTOM_ITEM';
      name: string;
      description: string;
      statBonusOrNull: Readonly<{ statCode: StatCode; positiveIntegerBonus: number }> | null;
    }>;
export interface AdmissionInventoryEntry {
  readonly reviewItemId: string;
  readonly sourceEntryIdOrNull: string | null;
  readonly item: AdmissionItem;
  readonly quantity: number;
  readonly qualityLabel: string;
  readonly weaponDecisionReceiptIdOrNull: string | null;
}
export interface AdmissionInventoryReview {
  readonly status: 'PENDING' | 'FINAL';
  readonly entries: readonly AdmissionInventoryEntry[];
  readonly unresolvedSourceEntryIds: readonly string[];
}
export type AdmissionWeaponDecisionRef =
  | Readonly<{
      kind: 'VALIDATED_REQUEST';
      requestId: string;
      validationReceiptId: string;
      decisionReceiptId: string;
    }>
  | Readonly<{
      kind: 'ADMISSION_GRANT';
      reviewItemId: string;
      decisionReceiptId: string;
    }>;
export type AdmissionGroupAssignment =
  | Readonly<{ kind: 'EXISTING'; groupId: string }>
  | Readonly<{ kind: 'NEW'; groupDraftId: string; name: string }>
  | Readonly<{ kind: 'START' }>;
export interface AdmissionLocationAssignment {
  readonly location: string;
  readonly subLocationOrNull: string | null;
}
export interface AdmissionReviewDraft {
  readonly statAdjustments: AdmissionStats;
  readonly startingSkills: Readonly<{ entries: readonly AdmissionStartingSkill[] }>;
  readonly massReview: AdmissionMassReview;
  readonly inventoryReview: AdmissionInventoryReview;
  readonly moneyReview: AdmissionMoneyReview;
  readonly weaponDecisionRefs: readonly AdmissionWeaponDecisionRef[];
  readonly groupAssignment: AdmissionGroupAssignment;
  readonly locationAssignment: AdmissionLocationAssignment;
}

/** Durable uncommitted input before the GM supplies NET-020 assignments; never publishable as-is. */
export type AdmissionReviewInputs = Omit<
  AdmissionReviewDraft,
  'groupAssignment' | 'locationAssignment'
> & {
  readonly groupAssignmentOrNull: AdmissionGroupAssignment | null;
  readonly locationAssignmentOrNull: AdmissionLocationAssignment | null;
};

export type AdmissionMasterWeaponExpression =
  | Readonly<{ kind: 'RETAIN' }>
  | Readonly<{
      kind: 'MASTER_DICE';
      pattern: 'R4' | 'R4+X' | 'R6' | 'R6+X' | 'R12' | 'R12+X' | 'R20+X' | 'R20*2+X';
      constantOrNull: number | null;
    }>;
/** CORE-187: protected fields are inherited from the exact host-bound template/request. */
export interface AdmissionMasterWeaponProfileInput {
  readonly weaponVariantId: AdmissionPublicWeaponProfile['weaponVariantId'];
  readonly damageDefinition: AdmissionMasterWeaponExpression;
  readonly penetrationDefinition: AdmissionMasterWeaponExpression;
  readonly statRequirements: Readonly<Partial<Record<StatCode, number>>>;
  readonly instanceDamageOrNull: number | null;
  readonly rangeMetersOrNull: number | null;
  readonly accuracyBonusOrNull: number | null;
}
export type AdmissionWeaponReviewInput =
  | Readonly<{ kind: 'VALIDATED_REQUEST'; requestId: string; validationReceiptId: string }>
  | Readonly<{
      kind: 'ADMISSION_GRANT';
      reviewItemId: string;
      weaponTypeId: string;
      reason: string;
      profileSource:
        | Readonly<{ kind: 'CATALOG_TEMPLATE'; templateId: string }>
        | Readonly<{ kind: 'GM_DEFINED'; typedProfile: AdmissionMasterWeaponProfileInput }>;
    }>;

export interface AdmissionWeaponResolutionInput {
  readonly weaponReviewInput: AdmissionWeaponReviewInput;
  readonly decision: 'APPROVE' | 'MASTER_OVERRIDE';
  readonly overrideProfileOrNull: AdmissionMasterWeaponProfileInput | null;
  /** A grant carries its own reason; there is no duplicate reason channel. */
  readonly reasonOrNull: string | null;
}

export interface AdmissionSheetSkill {
  readonly skillKey: string;
  readonly label: string;
  readonly source: 'SELECTED' | 'RACE_GRANTED' | 'CLASS_MANDATORY' | 'SYMBIONT_PERMANENT';
  readonly bonus: number;
  readonly slotCost: number;
}
export type AdmissionSymbiontBinding =
  | Readonly<{ kind: 'NONE' | 'TICK_RIGHT_HAND' | 'SPIDER_BOTH_WRISTS' | 'MANTIS_BOTH_FOREARMS' }>
  | Readonly<{ kind: 'OWL_EYE' | 'EEL_ARM'; side: 'LEFT' | 'RIGHT' }>;
export interface AdmissionSheetSymbiont {
  readonly acceptedIndex: number;
  readonly speciesKey: string;
  readonly label: string;
  readonly status: 'ACTIVE' | 'SUPPRESSED' | 'ABSORBED' | 'DESTROYED';
  readonly level: number;
  readonly maxOe: number;
  readonly currentOe: number;
  readonly xp: 0;
  readonly effectsEnabled: boolean;
  readonly xpEligible: boolean;
  readonly learnedNodes: readonly Readonly<{ label: string; level: number }>[];
  readonly binding: AdmissionSymbiontBinding;
}
export interface AdmissionStatProof {
  readonly statCode: StatCode;
  readonly skillStageValue: number;
  readonly positiveSymbiontDelta: number;
  readonly negativeSymbiontDelta: number;
  readonly appliedNegativeDelta: number;
  readonly beforeLimits: number;
  readonly minimumOrNull: number | null;
  readonly maximumOrNull: number | null;
  readonly effectiveValue: number;
}
/** Existing public initialRuntime; admission never introduces scene/equipment state. */
export interface AdmissionInitialRuntime {
  readonly maxHp: number;
  readonly currentHp: number;
  readonly alive: true;
  readonly conscious: true;
  readonly stunned: false;
  readonly bound: false;
  readonly burning: false;
  readonly poisoned: false;
  readonly diseased: false;
  readonly wounds: readonly [];
  readonly injuries: readonly [];
  readonly bleeding: readonly [];
  readonly temporaryEffects: readonly [];
  readonly cooldowns: readonly [];
  readonly preparations: readonly [];
  readonly initiativeOrNull: null;
  readonly combatSceneIdOrNull: null;
  readonly statProgressionCounters: AdmissionStats;
  readonly combatUsageLimits: readonly [];
  readonly symbiontXpProgressPoints: 0;
  readonly unallocatedSymbiontXp: 0;
  readonly equippedItems: readonly [];
  readonly generatedObjects: readonly [];
  readonly externalEntities: readonly [];
  readonly chimeraDevouringHistory: readonly [];
  readonly chimeraExtraSlots: 0;
  readonly taipanPoisonOrNull: 'DEADLY' | null;
  readonly penguinMiMiMiActive: boolean;
  readonly ratInsideHost: boolean;
  readonly keeperInsideHost: boolean;
  readonly mantisBladeStateOrNull: 'ORDINARY' | null;
}
/** Mechanical definition only: private definition/roll-group IDs never cross to the owner. */
export interface AdmissionPublicCombatValue {
  readonly valueMode: 'INSTANCE_VALUE' | 'CONSTANT' | 'PER_ATTACK_ROLL';
  readonly sourceNotation: string;
  readonly baseExpression: string;
  readonly sourceScope: 'WEAPON_PROFILE_VERSION' | 'ITEM_TEMPLATE';
  readonly evaluationScope: 'PROFILE_SNAPSHOT' | 'EACH_RESOLVED_ATTACK';
  readonly instanceSourceFieldOrNull: 'instanceDamage' | null;
  readonly conditionalOverrideOrNull: string | null;
  readonly effectiveTemplateExpression: string;
  readonly damageModifierStat: 'NONE' | 'S' | 'D';
  readonly dieType: 'NONE' | 'OTHER_DIE' | 'D20';
  readonly rollKind: 'DAMAGE' | 'PENETRATION';
  readonly progressionEligibility: 'NEVER_PROGRESSION' | 'NO_DIRECT_BUT_POOL';
  readonly rawRollPersistence: 'NOT_APPLICABLE' | 'ATTACK_RESOLUTION_AND_COMBAT_LOG';
  readonly resolvedResultField: 'resolvedDamage' | 'resolvedPenetration';
  readonly resolvedResultPersistence: 'ATTACK_RESOLUTION_AND_COMBAT_LOG';
}
/** Keys come from the existing weapon-profile catalog allowlist. */
export const ADMISSION_WEAPON_PROPERTY_KEYS = [
  'Боеприпас',
  'Можно метать',
  'Навык/класс',
  'Особое правило',
  'Перезарядка атомарна',
  'Перезарядка, действий',
  'Руки',
  'Стат точности',
  'Штраф без навыка/класса',
  'Ёмкость',
  'Штраф метания',
  'Парирование',
  'Shield max HP',
  'Блок',
  'Требования',
] as const;
export interface AdmissionPublicWeaponProfile {
  readonly weaponTypeId: string;
  readonly weaponVariantId: 'DEFAULT' | 'ONE_HAND' | 'TWO_HAND' | 'SWORD' | 'SHIELD' | 'RAPIER';
  readonly name: string;
  readonly variantLabel: string;
  readonly statSource: 'TEMPLATE_FIXED' | 'PLAYER_FORMULA_VALIDATED' | 'MASTER_OVERRIDE';
  readonly damageDefinition: AdmissionPublicCombatValue;
  readonly penetrationDefinition: AdmissionPublicCombatValue;
  readonly statRequirements: Readonly<Partial<Record<StatCode, number>>>;
  readonly instanceDamageOrNull: number | null;
  readonly rangeMetersOrNull: number | null;
  readonly accuracyBonusOrNull: number | null;
  readonly properties: Readonly<
    Partial<Record<(typeof ADMISSION_WEAPON_PROPERTY_KEYS)[number], string | number | boolean>>
  >;
}
export interface AdmissionSheetInventoryEntry extends AdmissionInventoryEntry {
  readonly weaponProfileOrNull: AdmissionPublicWeaponProfile | null;
  readonly equipmentState: 'UNEQUIPPED';
}
/** ADR 0071: both sides retain every section, including unchanged sections. */
export interface AdmissionMechanicalSheetV1 {
  readonly schemaVersion: 1;
  readonly identity: Readonly<{
    name: string;
    age: number;
    sex: 'MALE' | 'FEMALE';
    massKg: number;
  }>;
  readonly race: Readonly<{ code: RaceCode; label: string }>;
  readonly classOrNull: Readonly<{ code: ClassCode; label: string }> | null;
  readonly creationMode: 'MANUAL' | 'RANDOM' | null;
  readonly stats: Readonly<{
    acceptedBase: AdmissionStats;
    permanentGmAdjustments: AdmissionStats;
    backpackItemAdjustments: AdmissionStats;
    skillStageStats: AdmissionStats;
    effectiveStats: AdmissionStats;
    statProof: readonly AdmissionStatProof[];
  }>;
  readonly skills: Readonly<{
    entries: readonly AdmissionSheetSkill[];
    maxSlots: number;
    usedSlots: number;
    remainingSlots: number;
    requirementsSatisfied: true;
  }>;
  readonly symbionts: readonly AdmissionSheetSymbiont[];
  readonly advisorOrNull: Readonly<{
    intelligence: number;
    wisdom: number;
    suppressionBonusOrNull: number | null;
    skills: readonly AdmissionSheetSkill[];
  }> | null;
  readonly permanentGrants: readonly Readonly<{
    kind: 'TROGR_GROSS';
    bonusBefore: number;
    bonusAfter: number;
  }>[];
  readonly trainingSlotLedger: Readonly<{ maxPermanentWisdom: number; everIssued: number }>;
  readonly runtime: AdmissionInitialRuntime;
  readonly massReview: AdmissionMassReview;
  readonly inventoryReview: Readonly<{
    status: 'PENDING' | 'FINAL';
    entries: readonly AdmissionSheetInventoryEntry[];
    unresolvedSourceEntryIds: readonly string[];
  }>;
  readonly moneyReview: AdmissionMoneyReview;
  readonly groupAssignmentOrNull: AdmissionGroupAssignment | null;
  readonly locationAssignmentOrNull: AdmissionLocationAssignment | null;
}

export type AdmissionMechanicalCore = Pick<
  AdmissionMechanicalSheetV1,
  | 'schemaVersion'
  | 'identity'
  | 'race'
  | 'classOrNull'
  | 'creationMode'
  | 'stats'
  | 'skills'
  | 'symbionts'
  | 'advisorOrNull'
  | 'permanentGrants'
  | 'trainingSlotLedger'
  | 'runtime'
>;
