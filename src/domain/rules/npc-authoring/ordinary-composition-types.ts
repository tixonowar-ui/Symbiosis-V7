import type { RaceCode } from '@generated/types/character.js';
import type { SymbiontBinding, Core169SpeciesKey } from '../symbiont-stage/catalog.js';
import type { NpcSymbiontInput } from './types.js';

export interface NpcCompositionBinding {
  readonly journalId: string;
  readonly raceCode: RaceCode;
}
interface FactIdentity {
  readonly factId: string;
  readonly journalId: string;
  readonly ordinal: number;
}
/** AQ2-017: one confirmation, removals before all candidates, final capacity only. */
export interface NpcOrdinaryCompositionFact extends FactIdentity {
  readonly kind: 'APPLY_COMPOSITION_EDIT';
  /** Host-bound selected schema for this edit; initial journal binding remains immutable. */
  readonly raceCode: RaceCode;
  readonly removals: readonly string[];
  readonly additions: readonly NpcSymbiontInput[];
  readonly buildChanges: readonly Readonly<{
    symbiontInstanceId: string;
    targetLevel: number;
    learnedNodeRefs: readonly string[];
    binding: SymbiontBinding;
  }>[];
  readonly currentOeChanges: readonly Readonly<{ symbiontInstanceId: string; currentOE: number }>[];
}
export interface NpcOrdinaryCompositionInstance extends NpcSymbiontInput {
  readonly speciesKey: Core169SpeciesKey;
  readonly status: 'ACTIVE' | 'SUPPRESSED' | 'ABSORBED' | 'DESTROYED' | 'REMOVED';
  readonly slotCost: number;
  readonly nativeMaxOE: number;
  readonly effectsEnabled: boolean;
  readonly suppressedAbilities: readonly 'DOUBLE_FOCUS'[];
  readonly absorbedSpeciesKeys: readonly ('TEACHER' | 'DOLPHIN')[];
  readonly acquisitionFactId: string;
}
export type NpcCompositionConsequence =
  | {
      readonly kind: 'ABSORPTION';
      readonly absorberInstanceId: string;
      readonly absorbedInstanceId: string;
      readonly absorbedSpeciesKey: 'TEACHER' | 'DOLPHIN';
    }
  | {
      readonly kind: 'DOLPHIN_LEARNED_GRANT';
      readonly symbiontInstanceId: string;
      readonly beforeLevel: number;
      readonly afterLevel: number;
      readonly addedNodeRefs: readonly string[];
    }
  | {
      readonly kind: 'CURRENT_OE_DUEL';
      readonly trogrInstanceId: string;
      readonly keeperInstanceId: string;
      readonly trogrCurrentOeBefore: number;
      readonly keeperCurrentOeBefore: number;
      readonly outcome: 'TROGR_DESTROYED' | 'KEEPER_DESTROYED' | 'TIE';
      readonly winnerCurrentOeAfterOrNull: number | null;
    }
  | {
      readonly kind: 'SPECIES_SUPPRESSION';
      readonly symbiontInstanceId: string;
      readonly before: 'ACTIVE' | 'SUPPRESSED';
      readonly after: 'ACTIVE' | 'SUPPRESSED';
    }
  | {
      readonly kind: 'ABILITY_SUPPRESSION';
      readonly symbiontInstanceId: string;
      readonly ability: 'DOUBLE_FOCUS';
      readonly suppressed: boolean;
    }
  | {
      readonly kind: 'NATIVE_OE_CLAMP';
      readonly symbiontInstanceId: string;
      readonly before: number;
      readonly after: number;
    };

/** Required facts cannot be supplied by a caller's successful/complete boolean. */
export type NpcCompositionPendingRequirement =
  | {
      readonly kind: 'ADVISER_CARD_AND_SKILLS';
      readonly causedByFactId: string;
      readonly symbiontInstanceId: string;
      readonly sourceRuleIds: readonly ['AQA-006', 'AQ2-023'];
    }
  | {
      readonly kind: 'ADVISER_SUPPRESSION_ROLL';
      readonly causedByFactId: string;
      readonly symbiontInstanceId: string;
      readonly sourceRuleIds: readonly ['SYM-075', 'Q-SYM-073'];
    }
  | {
      readonly kind: 'FREE_EXTRA_SLOT_ROLL_AND_STAT_CONSEQUENCE';
      readonly causedByFactId: string;
      readonly sourceRuleIds: readonly ['AQ2-015'];
    }
  | {
      readonly kind: 'TROGR_PERMANENT_STAT_CLOSURE';
      readonly causedByFactId: string;
      readonly symbiontInstanceId: string;
      readonly sourceRuleIds: readonly ['SYM-076', 'AQ2-022', 'SYM-185'];
    }
  | {
      readonly kind: 'GROSS_SKILL_GRANT';
      readonly causedByFactId: string;
      readonly symbiontInstanceId: string;
      readonly sourceRuleIds: readonly ['SYM-079', 'SYM-185'];
    };

export interface NpcOrdinaryCompositionView extends NpcCompositionBinding {
  readonly kind: 'ORDINARY_STRUCTURAL_COMPOSITION_ONLY';
  readonly lastOrdinal: number;
  readonly instances: readonly NpcOrdinaryCompositionInstance[];
  readonly occupiedSlots: number;
  readonly confirmedSlotCapacity: number;
  readonly pendingRequirements: readonly NpcCompositionPendingRequirement[];
  readonly completion: 'PENDING_REQUIRED_FACTS' | 'STRUCTURAL_COMPOSITION_RESOLVED';
}
export interface NpcOrdinaryCompositionReceipt {
  readonly factId: string;
  readonly ordinal: number;
  readonly input: NpcOrdinaryCompositionFact;
  readonly consequences: readonly NpcCompositionConsequence[];
  readonly view: NpcOrdinaryCompositionView;
}
