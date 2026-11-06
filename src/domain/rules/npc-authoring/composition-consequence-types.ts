import type { RollMode, MechanicalRoll } from '../../entities/roll-request/roll-model.js';
import type { AdvisorBodyStats } from '../symbiont-stage/advisor.js';
import type { SelectedSkillInput } from '../skill-stage/skills.js';
import type { StatBlock } from '../skill-stage/stats.js';
import type { NpcSkillProof } from './skill-evaluation.js';
import type {
  NpcCompositionBinding,
  NpcCompositionPendingRequirement,
  NpcOrdinaryCompositionFact,
  NpcOrdinaryCompositionReceipt,
  NpcOrdinaryCompositionView,
} from './ordinary-composition-types.js';
import type { NpcAdvisorCard, NpcLifetimeFacts } from './types.js';

/** Existing durable host roll receipt, not a request to sample or a client outcome assertion. */
export interface NpcRecordedCompositionRoll {
  readonly factId: string;
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly originatingCommandId: string;
  readonly modeSnapshot: RollMode;
  readonly mechanical: MechanicalRoll;
}
export interface NpcCompositionConfirmation {
  readonly input: NpcOrdinaryCompositionFact;
  readonly confirmationCommandId: string;
  readonly diceModeSnapshot: RollMode;
}
interface ResolutionIdentity {
  readonly factId: string;
  readonly ordinal: number;
  readonly compositionOrdinal: number;
  readonly causedByFactId: string;
}
export type NpcCompositionResolution =
  | (ResolutionIdentity &
      Readonly<{
        kind: 'FREE_SLOT_ROLL';
        statContextFactId: string;
        permanentStatsBefore: StatBlock;
        roll: NpcRecordedCompositionRoll;
      }>)
  | (ResolutionIdentity &
      Readonly<{
        kind: 'ADVISER_IW_ROLLS';
        symbiontInstanceId: string;
        cardId: string;
        rolls: readonly [NpcRecordedCompositionRoll, NpcRecordedCompositionRoll];
      }>)
  | (ResolutionIdentity &
      Readonly<{
        kind: 'ADVISER_SKILLS';
        symbiontInstanceId: string;
        bodyContextFactId: string;
        bodyStats: AdvisorBodyStats;
        selectedSkills: readonly SelectedSkillInput[];
      }>)
  | (ResolutionIdentity &
      Readonly<{
        kind: 'ADVISER_SUPPRESSION_ROLL';
        symbiontInstanceId: string;
        roll: NpcRecordedCompositionRoll;
      }>)
  | (ResolutionIdentity &
      Readonly<{
        kind: 'GROSS_SKILL_GRANT';
        symbiontInstanceId: string;
        skillProof: NpcSkillProof;
      }>);

/** New identity begins with an actual empty history; N+1 supplies its exact immutable old prefix. */
export interface NpcCompositionConsequenceProof {
  readonly identityKey: string;
  readonly binding: NpcCompositionBinding;
  readonly confirmations: readonly NpcCompositionConfirmation[];
  readonly resolutions: readonly NpcCompositionResolution[];
}
export interface NpcCompositionConsequenceResult {
  readonly proof: NpcCompositionConsequenceProof;
  readonly composition: NpcOrdinaryCompositionView;
  readonly compositionReceipts: readonly NpcOrdinaryCompositionReceipt[];
  readonly lifetimeFacts: NpcLifetimeFacts;
  readonly advisorContinuations: readonly Readonly<
    Omit<NpcAdvisorCard, 'skills'> & { skillsOrNull: NpcAdvisorCard['skills'] | null }
  >[];
  readonly confirmedSlotCapacity: number;
  readonly unresolvedRequirements: readonly NpcCompositionPendingRequirement[];
  /** Completion of these obligations alone is not a full NPC sheet/HP/stat validation. */
  readonly obligationStatus: 'PENDING' | 'RESOLVED';
}
