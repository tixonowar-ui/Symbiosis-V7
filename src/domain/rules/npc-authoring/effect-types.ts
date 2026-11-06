import type { DiseaseId, PoisonProfileId } from '@generated/types/effects.js';
import type { StatCode } from '@generated/types/character.js';

/** Technical representation of the two exact DiseaseDefinition modifier maps. */
export type NpcModifierComponent =
  | Readonly<{ targetKind: 'STAT'; targetCode: StatCode; value: number }>
  | Readonly<{ targetKind: 'CHECK'; targetCode: 'STEALTH'; value: number }>;

/** TIME-005: 24 hours of this effect; TIME-010/017: no immediate creation tick. */
export interface NpcDiseaseDailyTick {
  readonly phase: 'COSTS_AND_TICKS';
  readonly period: Readonly<{ amount: 1; unit: 'DAY' }>;
  readonly nextTickAt: NpcCalendarInstant;
  readonly damagePerTick: number;
}
/** Effects/CapabilityProfiles PRF-PARALYZED, CORE-062/103: a restriction, never unconditional true. */
export type NpcConditionalMentalCapability = 'CONDITIONAL_NO_SPEECH_MOVEMENT_BODY';

/** A virtual calendar value; the caller supplies its exact unit and campaign binding. */
export interface NpcCalendarInstant {
  readonly campaignTimestamp: number;
}

/** Implemented branches only; this is not a prohibition of other modeled families. */
export type NpcEffectInstance = NpcDiseaseEffectInstance;
export type NpcUntimedDiseaseId = Exclude<DiseaseId, 'DIS-PNEUMONIA' | 'DIS-PESTILENCE'>;
export type NpcUntimedDiseasePayload = Readonly<{
  diseaseId: NpcUntimedDiseaseId;
  assignedByGM: true;
  modifierComponents: readonly NpcModifierComponent[];
  dailyTick: null;
}>;

/**
 * Current GM-assigned, nonperiodic disease state of a living actor.
 * Effects/12 requires a real startsAt even when expiration is indefinite.
 * SOURCE_SPECIFIC names this manual disease lifecycle; corpse resolution is separate.
 */
export interface NpcUntimedDiseaseEffectInstance {
  readonly effectInstanceId: string;
  readonly effectTypeId: 'EFF-DISEASE-INSTANCE';
  readonly familyCode: 'FAM-DISEASE';
  readonly targetActorId: string;
  readonly targetRegionId: null;
  readonly sourceRuleIds: readonly string[];
  readonly sourceEntityId: null;
  readonly sourceInstanceId: null;
  readonly sourceSnapshot: null;
  readonly sourceLifecyclePolicy: 'SOURCE_SPECIFIC';
  readonly stackingKey: NpcUntimedDiseaseId;
  readonly payload: NpcUntimedDiseasePayload;
  readonly magnitude: null;
  readonly tags: readonly ['DISEASE'];
  readonly createdAt: string;
  readonly startsAt: NpcCalendarInstant;
  readonly expiresAt: null;
  readonly remainingExact: null;
  readonly durationUnit: null;
  readonly tickSchedule: null;
  readonly lastTickAt: null;
  readonly status: 'ACTIVE';
  readonly revision: number;
  readonly removalReason: null;
  readonly createdBy: 'GM';
  readonly variantKey: NpcUntimedDiseaseId;
  readonly aggregateKey: string;
  readonly deathDisposition: 'SOURCE_SPECIFIC';
}
export interface NpcDiseasePayload {
  readonly diseaseId: DiseaseId;
  readonly assignedByGM: true;
  readonly modifierComponents: readonly NpcModifierComponent[];
  readonly dailyTick: NpcDiseaseDailyTick | null;
}

export interface NpcPoisonPayload {
  readonly poisonProfileId: PoisonProfileId;
  readonly poisonSourceKind: 'ORDINARY' | 'NATURAL' | 'ARTIFICIAL' | 'SYMBIOTIC' | 'CANONICAL';
  readonly deliveryKind:
    'CONTACT' | 'INHALED' | 'INGESTED' | 'INJECTED' | 'COATING' | 'SOURCE_SPECIFIC';
  readonly secondaryControlApplicable: boolean;
}

/** CORE-119 / Effects TraumaInstance. Consequences belong to the derived output. */
export interface NpcTraumaInstance {
  readonly traumaInstanceId: string;
  readonly regionId: string;
  readonly traumaValue: number;
}

/** GAP-001/002 distinguish explicit absence from an invented bleeding default. */
export type NpcWoundInstance = Readonly<{
  woundInstanceId: string;
  regionId: string;
  creationPolicy: 'SOURCE_CREATES_WOUND_OR_GM';
  healingPolicy: 'EXPLICIT_TREATMENT_OR_GM_ONLY';
}> &
  (
    | Readonly<{ woundType: 'GENERIC'; damagePerTick: null; tickPhase: null }>
    | Readonly<{ woundType: 'BLEEDING'; damagePerTick: number; tickPhase: 'END_OF_TARGET_TURN' }>
  );

/** GAP-011; the separately validated coating payload/expiry is not invented here. */
export interface NpcPreparedCoatingInstance {
  readonly coatingInstanceId: string;
  readonly hostItemInstanceId: string;
  readonly surfaceKey: string;
  readonly inventoryMode:
    'STACKABLE_UNCOATED_PROJECTILES' | 'INDIVIDUAL_POISONED_PROJECTILE' | 'INDIVIDUAL_ITEM_COATING';
  readonly consumptionState: 'ACTIVE' | 'CONSUMED' | 'REPLACED';
  readonly replacesCoatingId: string | null;
}

/** Output only. A missing mental-condition codec must not become an unconditional true. */
export interface NpcDerivedCapabilities {
  readonly canPhysicalAct: boolean;
  readonly canMentalAct: boolean | NpcConditionalMentalCapability;
  readonly canReact: boolean;
  readonly canActiveDefend: boolean;
  readonly effectiveControllerId: string | null;
  readonly regionPenaltyById: Readonly<Record<string, number>>;
}

/** The explicit periodic branch in MON-080/087; its expiration remains indefinite. */
export interface NpcPneumoniaEffectInstance extends Omit<
  NpcUntimedDiseaseEffectInstance,
  'stackingKey' | 'payload' | 'variantKey' | 'tickSchedule' | 'lastTickAt'
> {
  readonly stackingKey: 'DIS-PNEUMONIA';
  readonly variantKey: 'DIS-PNEUMONIA';
  readonly payload: Readonly<{
    diseaseId: 'DIS-PNEUMONIA';
    assignedByGM: true;
    modifierComponents: readonly NpcModifierComponent[];
    dailyTick: NpcDiseaseDailyTick;
  }>;
  readonly tickSchedule: Readonly<Pick<NpcDiseaseDailyTick, 'phase' | 'period' | 'nextTickAt'>>;
  readonly lastTickAt: NpcCalendarInstant | null;
}
export type NpcDiseaseEffectInstance = NpcUntimedDiseaseEffectInstance | NpcPneumoniaEffectInstance;
