import type { ClassCode, RaceCode, StatCode } from '@generated/types/character.js';

import type { LearnedSkill, SelectedSkillInput } from '../skill-stage/skills.js';
import type { CreationMode, StatBlock } from '../skill-stage/stats.js';
import type { SymbiontCatalog, SymbiontSpeciesKey } from '../symbiont-stage/catalog.js';
import type { SymbiontComposition, SymbiontInstanceStatus } from '../symbiont-stage/composition.js';

export type CreationValidationBlockerKind =
  | 'IDENTITY_OR_MASS'
  | 'RACE_OR_RACE_DEPENDENCIES'
  | 'STATS'
  | 'SKILLS'
  | 'SYMBIONT_COMPOSITION'
  | 'STARTING_PROPERTY';

export interface CreationValidationBlocker {
  readonly kind: CreationValidationBlockerKind;
  readonly code: string;
  readonly message: string;
  readonly returnFormId: 'CHR-001' | 'CHR-010' | 'CHR-009' | 'CHR-015' | 'CHR-019' | 'CHR-032';
}

export interface CreationDevelopmentNode {
  readonly speciesKey: SymbiontSpeciesKey;
  readonly nodeRef: string;
  readonly label: string;
  readonly level: number;
}

export interface CreationFinalizationCatalog {
  readonly symbionts: SymbiontCatalog;
  readonly initialNodes: readonly CreationDevelopmentNode[];
}

/** The host binds this once-only consequence to the first confirmed acquisition. */
export interface CreationPermanentSkillGrant {
  readonly kind: 'TROGR_GROSS';
  readonly bonusBefore: number;
  readonly bonusAfter: number;
}

export interface CreationTrainingSlotLedger {
  readonly maxPermanentWisdom: number;
  readonly everIssued: number;
}

export interface CreationInputLearnedSkill {
  readonly source: LearnedSkill['source'];
  readonly skillKey: string;
  readonly bonus: number;
  readonly slotCost: number;
}

export interface CreationFinalMechanicsInput {
  readonly baseStats: StatBlock;
  readonly raceCode: RaceCode;
  readonly classCode: ClassCode | null;
  readonly creationMode: CreationMode | null;
  readonly composition: SymbiontComposition | null;
  readonly learnedSkills: readonly CreationInputLearnedSkill[];
  readonly advisorSuppressionBonusOrNull: number | null;
  readonly permanentGrants: readonly CreationPermanentSkillGrant[];
  readonly trainingSlotLedger: CreationTrainingSlotLedger | null;
}

export interface CreationFinalStatProof {
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

export interface CreationFinalLearnedSkill {
  readonly source: LearnedSkill['source'] | 'SYMBIONT_PERMANENT';
  readonly skillKey: string;
  readonly bonus: number;
  readonly slotCost: number;
}

export interface CreationInitialSymbiont {
  readonly acceptedIndex: number;
  readonly speciesKey: SymbiontSpeciesKey;
  readonly status: SymbiontInstanceStatus;
  readonly level: number;
  readonly maxOe: number;
  readonly currentOe: number;
  readonly xp: 0;
  readonly learnedNodeRefs: readonly string[];
  readonly effectsEnabled: boolean;
  readonly xpEligible: boolean;
}

export interface CreationInitialRuntime {
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
  readonly statProgressionCounters: StatBlock;
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

export interface CreationFinalMechanics {
  readonly skillStageStats: StatBlock;
  readonly effectiveStats: StatBlock;
  readonly statProof: readonly CreationFinalStatProof[];
  readonly learnedSkills: readonly CreationFinalLearnedSkill[];
  readonly permanentGrants: readonly CreationPermanentSkillGrant[];
  readonly trainingSlotLedger: CreationTrainingSlotLedger;
  readonly symbionts: readonly CreationInitialSymbiont[];
  readonly initialRuntime: CreationInitialRuntime;
  readonly blockers: readonly CreationValidationBlocker[];
}

/** AQ2-002 edits a campaign proposal; the verified local FINAL remains immutable. */
export interface AdmissionMechanicsInput {
  readonly source: CreationFinalMechanicsInput;
  readonly permanentGmAdjustments: StatBlock;
  readonly backpackItemAdjustments: StatBlock;
  readonly selectedSkills: readonly SelectedSkillInput[];
}
export interface AdmissionMechanics {
  readonly mechanics: CreationFinalMechanics;
  readonly permanentEffectiveStats: StatBlock;
  readonly maxSlots: number;
  readonly usedSlots: number;
  readonly remainingSlots: number;
}
