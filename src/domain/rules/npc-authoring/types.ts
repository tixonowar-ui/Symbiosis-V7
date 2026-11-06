import type { NpcPublishedWeaponItem } from './inventory-publication.js';
import type { ClassCode, RaceCode, StatCode } from '@generated/types/character.js';

import type { MechanicalRoll } from '../../entities/roll-request/roll-model.js';
import type { CreationTrainingSlotLedger } from '../creation-finalization/types.js';
import type { ArmorBodyZone } from '../item-stage/armor-bundle.js';
import type { StagedWeaponProfile } from '../item-stage/master-weapon-profile.js';
import type { SkillKey } from '../skill-stage/catalog.js';
import type { StatBlock } from '../skill-stage/stats.js';
import type { AdvisorIwResult, AdvisorLearnedSkill } from '../symbiont-stage/advisor.js';
import type { SymbiontBinding, SymbiontSpeciesKey } from '../symbiont-stage/catalog.js';
import type { SymbiontInstanceStatus } from '../symbiont-stage/composition.js';
import type {
  NpcDerivedCapabilities,
  NpcEffectInstance,
  NpcPreparedCoatingInstance,
  NpcTraumaInstance,
  NpcWoundInstance,
} from './effect-types.js';

/** Domain input only: no campaign, transport identity, cursor, SQL, or command dispatch. */
export interface NpcIdentityInput {
  readonly name: string;
  readonly description: string | null;
  readonly affiliation: string;
  readonly campaignRole: string;
  readonly raceCode: RaceCode;
  readonly pureClassOrNull: ClassCode | null;
  readonly sex: 'MALE' | 'FEMALE';
  readonly massKg: number;
  readonly anatomyProfileId: string;
  readonly artAssetKeyOrNull: string | null;
}

/** NPC-002 completes before race/class/anatomy are selected on NPC-011. */
export type NpcIdentityStageInput = Readonly<
  Pick<
    NpcIdentityInput,
    'name' | 'description' | 'affiliation' | 'campaignRole' | 'sex' | 'massKg' | 'artAssetKeyOrNull'
  >
>;

/** Sex and mass have one owner in identity; schema validation uses their current values. */
export type NpcSchemaStageInput = Readonly<
  Pick<NpcIdentityInput, 'raceCode' | 'pureClassOrNull' | 'anatomyProfileId'>
>;

/** A reference to an existing immutable mechanical fact, never a request to roll. */
export interface NpcRollFact<
  DieSides extends MechanicalRoll['dieSides'] = MechanicalRoll['dieSides'],
> {
  readonly factId: string;
  readonly sourceRuleId: string;
  readonly roll: MechanicalRoll & Readonly<{ dieSides: DieSides }>;
}

export interface NpcSkillCharge {
  readonly pool: 'START' | 'TRAINING';
  readonly paidBonus: number;
  readonly chargedSlotCost: number;
  readonly acquisitionFactId: string;
}

export interface NpcLearnedSkill {
  readonly skillKey: SkillKey;
  readonly bonus: number;
  readonly charges: readonly NpcSkillCharge[];
}

export interface NpcFixedSkill {
  readonly source: 'RACE_GRANTED' | 'CLASS_MANDATORY';
  readonly skillKey: SkillKey;
  readonly bonus: number;
  readonly slotCost: number;
  readonly sourceRuleIds: readonly string[];
}

/** CORE-081: basis and issued history survive a change in current W. */
export interface NpcSkillLedger {
  readonly startBasis: Readonly<{ skillStageStats: StatBlock; confirmationFactId: string }>;
  readonly training: CreationTrainingSlotLedger & Readonly<{ basisFactId: string }>;
  readonly learnedSkills: readonly NpcLearnedSkill[];
  readonly fixedSkills: readonly NpcFixedSkill[];
}

export interface NpcAdvisorCard {
  readonly cardId: string;
  readonly symbiontInstanceId: string;
  readonly acquisitionFactId: string;
  readonly iwRollFacts: readonly [NpcRollFact<20>, NpcRollFact<20>];
  readonly iw: AdvisorIwResult;
  readonly skills: readonly AdvisorLearnedSkill[];
  readonly suppression:
    | Readonly<{ kind: 'NOT_TRIGGERED' }>
    | Readonly<{ kind: 'RESOLVED'; rollFact: NpcRollFact<20>; bonus: number }>;
}

export type NpcGrossGrant =
  | Readonly<{ kind: 'NOT_ISSUED' }>
  | Readonly<{
      kind: 'ISSUED';
      sourceRuleId: 'SYM-079';
      bonusBefore: number;
      bonusAfter: number;
      acquisitionFactId: string;
    }>;

/** Per-rule permanent contributions only; transient suppression/HP/armor are not legacy. */
export interface NpcTrogrLegacyEntry {
  readonly sourceRuleId: 'SYM-076';
  readonly reachedStatContributions: StatBlock;
  readonly acquisitionFactId: string;
}

/** SYM-075/Q-SYM-031; AQ2-022 preserves this fact after removal of its particular absorber. */
export interface NpcTrogrAbsorptionFact {
  readonly compositionConsequenceFactId: string;
  readonly sourceRuleId: 'SYM-075';
  readonly sourceQuestionId: 'Q-SYM-031';
  readonly absorberInstanceId: string;
  readonly absorberSpeciesKey: 'TROGR';
  readonly absorbedInstanceId: string;
  readonly absorbedSpeciesKey: 'TEACHER' | 'DOLPHIN';
}

export interface NpcLifetimeFacts {
  readonly freeExtraSlot:
    | Readonly<{ kind: 'NOT_UNLOCKED' }>
    | Readonly<{
        kind: 'UNLOCKED';
        sourceRuleId: 'AQ2-015';
        rollFact: NpcRollFact<6>;
        permanentStatConsequence: StatBlock;
        acquisitionFactId: string;
      }>;
  readonly trogrLegacy: readonly NpcTrogrLegacyEntry[];
  readonly grossGrant: NpcGrossGrant;
  readonly advisorCards: readonly NpcAdvisorCard[];
  readonly absorptionFacts: readonly NpcTrogrAbsorptionFact[];
}

/** IDs survive N+1; acceptedIndex from PC acquisition is deliberately not used as identity. */
export interface NpcSymbiontInput {
  readonly symbiontInstanceId: string;
  readonly speciesKey: SymbiontSpeciesKey;
  readonly targetLevel: number;
  readonly learnedNodeRefs: readonly string[];
  readonly binding: SymbiontBinding;
  readonly currentOE: number;
}

export interface NpcDerivedSymbiont extends NpcSymbiontInput {
  readonly status: SymbiontInstanceStatus;
  readonly computedMaxOE: number;
  readonly slotCost: number;
  readonly effectsEnabled: boolean;
}

export type NpcItemProfileInput =
  | Readonly<{ kind: 'CATALOG'; profileVersion: string }>
  | Readonly<{
      kind: 'MASTER_WEAPON';
      profileVersion: string;
      profiles: readonly StagedWeaponProfile[];
      reason: string;
    }>
  | Readonly<{
      kind: 'STRUCTURED_CUSTOM';
      description: string;
      customBonusOrNull: Readonly<{
        customBonusStat: StatCode;
        customBonusValue: number;
        activeOnlyInBackpack: true;
      }> | null;
      massKg: number | null;
      heldSizeClass: 'FITS_IN_FIST' | 'LARGE' | 'UNKNOWN';
      armorWeightClass: 'LIGHT' | 'OTHER' | 'UNKNOWN';
      flammability: 'COMBUSTIBLE' | 'NONCOMBUSTIBLE' | 'UNKNOWN';
      isIgnitionSource: boolean;
      isFood: boolean;
      canReceivePoison: boolean;
      canReceiveFlammableCoating: boolean;
    }>;

export type NpcEquipmentState =
  | Readonly<{ equipped: false; equippedSlots: readonly [] }>
  | Readonly<{ equipped: true; equippedSlots: readonly string[] }>;

/** The item editor binds the owner's identity at publication, without inventing a battle scene. */
export interface NpcInventoryItemInput {
  readonly itemInstanceId: string;
  readonly itemTypeId: string;
  readonly quantity: number;
  readonly profile: NpcItemProfileInput;
  readonly equipment: NpcEquipmentState;
  readonly bodyZone: ArmorBodyZone | null;
  readonly gripMode: 'ONE_HAND' | 'TWO_HAND' | null;
  readonly currentAmmo: number | null;
  readonly shieldCurrentHP: number | null;
  readonly broken: boolean;
  readonly sealed: boolean | null;
  readonly linkedSetInstanceId: string | null;
  readonly componentRole: 'SWORD' | 'RAPIER' | 'SHIELD' | null;
  readonly qualityRoll: number | null;
  readonly coatings: readonly NpcPreparedCoatingInstance[];
  readonly issueReason: string;
}

/** Unfinished codecs are explicit. They cannot be substituted with arbitrary JSON. */
export type NpcResolvedItemProfile = NpcPublishedWeaponItem;
// TODO(M3): complete the source-specific initial-state and interaction codecs in issue #187.
export type NpcSourceSpecificInitialState = never;
export type NpcResolvedSymbiontInteraction = never;

export interface NpcInitialStateInput {
  readonly currentHP: number;
  readonly dead: boolean;
  readonly currentTraumas: readonly NpcTraumaInstance[];
  readonly currentWounds: readonly NpcWoundInstance[];
  readonly effectInstances: readonly NpcEffectInstance[];
  readonly sourceSpecificStates: readonly NpcSourceSpecificInitialState[];
  readonly deathTimerRollFactOrNull: NpcRollFact<6> | null;
}

/** Layers are results, not additional client-controlled truth. */
export interface NpcStatLayers {
  readonly baseStats: StatBlock;
  readonly skillStageStats: StatBlock;
  readonly permanentStats: StatBlock;
  readonly effectiveStats: StatBlock;
}

export interface NpcSheetInput {
  readonly identity: NpcIdentityInput;
  readonly baseStats: StatBlock;
  readonly symbionts: readonly NpcSymbiontInput[];
  readonly skills: NpcSkillLedger;
  readonly lifetimeFacts: NpcLifetimeFacts;
  readonly inventory: readonly NpcInventoryItemInput[];
  readonly initialState: NpcInitialStateInput;
}

/** Shape of the future pure result, not a constructor or a declaration of validated mechanics. */
export interface NpcDerivedSheet {
  readonly input: NpcSheetInput;
  readonly stats: NpcStatLayers;
  readonly symbionts: readonly NpcDerivedSymbiont[];
  readonly interactions: readonly NpcResolvedSymbiontInteraction[];
  readonly itemProfiles: readonly NpcResolvedItemProfile[];
  readonly maxHP: number;
  readonly capabilities: NpcDerivedCapabilities;
  readonly requiresCampaignTime: boolean;
  readonly combatContext: Readonly<{ kind: 'ABSENT' }>;
}

/** Technical partial-state marker only; it never substitutes for a fully populated saved sheet. */
export type NpcDraftSection<T> =
  Readonly<{ kind: 'UNSET' }> | Readonly<{ kind: 'ENTERED'; value: T }>;

export interface NpcSheetDraft {
  readonly identity: NpcDraftSection<NpcIdentityStageInput>;
  readonly schema: NpcDraftSection<NpcSchemaStageInput>;
  readonly baseStats: NpcDraftSection<StatBlock>;
  readonly symbionts: NpcDraftSection<readonly NpcSymbiontInput[]>;
  readonly skills: NpcDraftSection<NpcSkillLedger>;
  readonly lifetimeFacts: NpcDraftSection<NpcLifetimeFacts>;
  readonly inventory: NpcDraftSection<readonly NpcInventoryItemInput[]>;
  readonly initialState: NpcDraftSection<NpcInitialStateInput>;
}
