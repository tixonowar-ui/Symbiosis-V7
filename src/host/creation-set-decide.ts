import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import {
  commitCreationCriticalConfirmation,
  createCreationCriticalChain,
  deriveCreationStatAbandonment,
  deriveCreationReturnDecisionFormId,
  deriveCreationStatSetDecisionRule,
  resolveCreationStatSet,
  type CreationStatAbandonmentTransitionKind,
  type CreationStatCriticalChainState,
  type CreationStatSetDecisionRule,
  type SkillStageCatalog,
} from '../domain/index.js';

import { decodeClientMessage } from '@shared/wire-codec.js';
import type {
  ClientToHostMessage,
  CommandReceipt,
  CommandRefusal,
  JsonObject,
  JsonValue,
  ProtocolVocabulary,
  RevisionVector,
  WorkflowCommandId,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';

import {
  commitLocalCharacterCheckpoint,
  listLocalCharacters,
  loadLocalCharacterCheckpoint,
  readLocalCharacter,
} from '../persistence/index.js';
import type { LocalCharacter, LocalCharacterCheckpoint } from '../persistence/index.js';
import {
  EMPTY_IDENTITY_BRANCH_CACHE_HASH,
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  IdentityCheckpointApplicationError,
  normalizeIdentityCheckpointRequest,
  validateDurableIdentityCheckpoint,
  validateIdentityCheckpointRequest,
} from './identity-checkpoint.js';
import {
  CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  CreationRollCommitApplicationError,
  normalizeCreationRollCommitRequest,
} from './creation-roll-commit.js';
import {
  CreationStatAssignmentApplicationError,
  normalizePureClassDecisionRequest,
  normalizeStatAssignmentCheckpointRequest,
  parsePureClassStage,
  parseStatAssignmentReceipt,
  parseStatAssignmentStage,
  deriveChr012StatsView,
  prepareStatAssignment,
  preparePureClassDecision,
  type PureClassDecisionCommandRequest,
  type PureClassDecisionPayload,
  type PureClassDecisionReceipt,
  type PureClassStage,
  type StatAssignmentCheckpointCommandRequest,
  type StatAssignmentCheckpointReceipt,
  type StatAssignmentStage,
} from './creation-stat-assignment.js';
import {
  parseSkillEligibilityStage,
  parseSkillSelectionStage,
  prepareSkillEligibility,
  prepareSkillSelection,
  type SkillCheckpointCommandRequest,
  type SkillEligibilityCheckpointReceipt,
  type SkillEligibilityStage,
  type SkillSelectionCheckpointReceipt,
  type SkillSelectionStage,
} from './creation-skill-selection.js';
import type {
  DurableIdentityCheckpoint,
  IdentityCheckpointCommandRequest,
  IdentityCheckpointDurablePayload,
  IdentityCheckpointReceipt,
} from './identity-checkpoint.js';

export const CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID =
  'UI-CMD-CHAR-CREATION-SET-DECIDE' as const satisfies WorkflowCommandId;

export const RACE_CHOICES = ['UNITED', 'FREE', 'PURE'] as const;
export type RaceChoice = (typeof RACE_CHOICES)[number];
export const SYMBIONT_ACQUISITION_MODES = ['MANUAL', 'RANDOM'] as const;
export type SymbiontAcquisitionMode = (typeof SYMBIONT_ACQUISITION_MODES)[number];
export const DICE_INPUT_MODES = ['AUTO', 'MANUAL'] as const;
export type DiceInputMode = (typeof DICE_INPUT_MODES)[number];
export const STAT_METHODS = ['CLASSIC', 'ADVENTUROUS', 'ALL_OR_NOTHING'] as const;
export type StatMethod = (typeof STAT_METHODS)[number];
export type ChoiceLockStatus = 'LOCKED_AFTER_RESULT' | 'NOT_APPLICABLE' | 'UNLOCKED';

export type CreationRaceMethodDecisionSourceFormId = 'CHR-002' | 'CHR-010' | 'CHR-016' | 'CHR-036';
export type CreationStatRollDecisionFormId = 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008';
export interface CreationSetAbandonmentConsequences extends JsonObject {
  readonly creationCriticalConsequencesDiscarded: true;
  readonly exactPointBuyTotalOrNull: 85 | 90 | null;
  readonly nextAttemptIndexOrNull: 2 | 3 | 4 | 5 | null;
  readonly setValuesDiscarded: true;
}
export type CreationDecisionSourceFormId =
  CreationRaceMethodDecisionSourceFormId | CreationStatRollDecisionFormId | 'CHR-011' | 'CHR-028';
export type CreationNextFormId =
  | 'CHR-002'
  | 'CHR-003'
  | 'CHR-004'
  | 'CHR-005'
  | 'CHR-006'
  | 'CHR-007'
  | 'CHR-008'
  | 'CHR-009'
  | 'CHR-010'
  | 'CHR-011'
  | 'CHR-012'
  | 'CHR-013'
  | 'CHR-016'
  | 'CHR-017'
  | 'CHR-036';

interface CreationSetDecidePayloadCommon extends JsonObject {
  readonly stage: 'RACE_AND_METHOD';
  readonly sourceFormId: CreationRaceMethodDecisionSourceFormId;
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
}

export interface RaceDecisionPayload extends CreationSetDecidePayloadCommon {
  readonly sourceFormId: 'CHR-010';
  readonly raceChoice: RaceChoice;
}

export interface SymbiontAcquisitionDecisionPayload extends CreationSetDecidePayloadCommon {
  readonly sourceFormId: 'CHR-016';
  readonly symbiontAcquisitionMode: SymbiontAcquisitionMode;
}

export interface DiceInputDecisionPayload extends CreationSetDecidePayloadCommon {
  readonly sourceFormId: 'CHR-036';
  readonly diceInputMode: DiceInputMode;
}

export interface StatMethodDecisionPayload extends CreationSetDecidePayloadCommon {
  readonly sourceFormId: 'CHR-002';
  readonly statMethod: StatMethod;
}

interface CreationStatRollDecisionPayloadCommon extends JsonObject {
  readonly stage: 'STAT_ROLLS';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
}

export interface StatRollAcceptSetPayload extends CreationStatRollDecisionPayloadCommon {
  readonly sourceFormId: CreationStatRollDecisionFormId;
  readonly decision: 'ACCEPT_SET';
}

export interface StatRollDialogDecisionPayload extends CreationStatRollDecisionPayloadCommon {
  readonly sourceFormId: 'CHR-028';
  readonly decision: 'CANCEL' | 'CONFIRM';
}

export type CreationSetDecidePayload =
  | DiceInputDecisionPayload
  | RaceDecisionPayload
  | StatRollAcceptSetPayload
  | StatRollDialogDecisionPayload
  | StatMethodDecisionPayload
  | SymbiontAcquisitionDecisionPayload
  | PureClassDecisionPayload;

export type CreationRaceMethodSetDecidePayload =
  | DiceInputDecisionPayload
  | RaceDecisionPayload
  | StatMethodDecisionPayload
  | SymbiontAcquisitionDecisionPayload;

export type CreationSetDecideCommandRequest = WorkflowCommandRequestMessage<
  typeof CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  CreationSetDecidePayload
>;
export type CreationRaceMethodSetDecideCommandRequest = CreationSetDecideCommandRequest & {
  readonly payload: CreationRaceMethodSetDecidePayload;
};
export type DurableCreationSetDecideCommandRequest = CreationSetDecideCommandRequest & {
  readonly payload:
    | CreationRaceMethodSetDecidePayload
    | StatRollAcceptSetPayload
    | (StatRollDialogDecisionPayload & { readonly decision: 'CONFIRM' })
    | PureClassDecisionPayload;
};
export type CreationSetCancelCommandRequest = CreationSetDecideCommandRequest & {
  readonly payload: StatRollDialogDecisionPayload & { readonly decision: 'CANCEL' };
};

interface CreationSetDecideReceiptResultCommon extends JsonObject {
  readonly stage: 'RACE_AND_METHOD';
  readonly sourceFormId: CreationRaceMethodDecisionSourceFormId;
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly nextFormId: CreationNextFormId;
}

export interface RaceDecisionReceiptResult extends CreationSetDecideReceiptResultCommon {
  readonly sourceFormId: 'CHR-010';
  readonly raceChoice: RaceChoice;
  readonly nextFormId: 'CHR-016' | 'CHR-036';
}

export interface SymbiontAcquisitionDecisionReceiptResult extends CreationSetDecideReceiptResultCommon {
  readonly sourceFormId: 'CHR-016';
  readonly symbiontAcquisitionMode: SymbiontAcquisitionMode;
  readonly nextFormId: 'CHR-036';
}

export interface DiceInputDecisionReceiptResult extends CreationSetDecideReceiptResultCommon {
  readonly sourceFormId: 'CHR-036';
  readonly diceInputMode: DiceInputMode;
  readonly nextFormId: 'CHR-002';
}

export interface StatMethodDecisionReceiptResult extends CreationSetDecideReceiptResultCommon {
  readonly sourceFormId: 'CHR-002';
  readonly statMethod: StatMethod;
  readonly branchUuid: string;
  readonly setRollRequestId: string;
  readonly nextFormId: 'CHR-003';
}

interface CreationStatRollDecisionReceiptResultCommon extends JsonObject {
  readonly stage: 'STAT_ROLLS';
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
}

export interface CreationSetAcceptanceReceiptResult extends CreationStatRollDecisionReceiptResultCommon {
  readonly sourceFormId: CreationStatRollDecisionFormId;
  readonly decision: 'ACCEPT_SET';
  readonly acceptedSetReceiptId: string;
  readonly assignmentMode: 'ROLLED_BIJECTION';
  readonly nextFormId: 'CHR-009';
}

export interface CreationSetAbandonmentReceiptResult extends CreationStatRollDecisionReceiptResultCommon {
  readonly sourceFormId: 'CHR-028';
  readonly decision: 'CONFIRM';
  readonly originDecisionFormId: CreationStatRollDecisionFormId;
  readonly alternateDecision:
    'GO_ATTEMPT_2' | 'GO_NEXT_ATTEMPT' | 'USE_POINT_BUY_85' | 'USE_POINT_BUY_90';
  readonly transitionKind: CreationStatAbandonmentTransitionKind;
  readonly abandonedSetReceiptIds: readonly [string];
  readonly irreversibleConsequences: CreationSetAbandonmentConsequences;
  readonly assignmentModeOrNull: 'POINT_BUY_85' | 'POINT_BUY_90' | null;
  readonly sourceSetReceiptIdOrNull: null;
  readonly nextAttemptIndexOrNull: 2 | 3 | 4 | 5 | null;
  readonly nextSetRollRequestIdOrNull: string | null;
  readonly nextFormId: 'CHR-003' | 'CHR-009';
}

export interface CreationSetCancelReceiptResult extends CreationStatRollDecisionReceiptResultCommon {
  readonly sourceFormId: 'CHR-028';
  readonly decision: 'CANCEL';
  readonly originDecisionFormId: CreationStatRollDecisionFormId;
  readonly decisionReceiptIdOrNull: null;
  readonly nextFormId: CreationStatRollDecisionFormId;
}

export type CreationSetDecideReceiptResult =
  | CreationSetAbandonmentReceiptResult
  | CreationSetAcceptanceReceiptResult
  | CreationSetCancelReceiptResult
  | DiceInputDecisionReceiptResult
  | RaceDecisionReceiptResult
  | StatMethodDecisionReceiptResult
  | SymbiontAcquisitionDecisionReceiptResult
  | PureClassDecisionReceipt['result'];
export type CreationSetDecideReceipt = CommandReceipt<CreationSetDecideReceiptResult>;
export type CreationSetCancelReceipt = CommandReceipt<CreationSetCancelReceiptResult>;
export type DurableCreationSetDecideReceiptResult = Exclude<
  CreationSetDecideReceiptResult,
  CreationSetCancelReceiptResult
>;
export type DurableCreationSetDecideReceipt = CommandReceipt<DurableCreationSetDecideReceiptResult>;
export type CreationRaceMethodSetDecideReceiptResult =
  | DiceInputDecisionReceiptResult
  | RaceDecisionReceiptResult
  | StatMethodDecisionReceiptResult
  | SymbiontAcquisitionDecisionReceiptResult;
export type CreationRaceMethodSetDecideReceipt =
  CommandReceipt<CreationRaceMethodSetDecideReceiptResult>;

export interface CreationNextStageEnvelope<
  TFormId extends CreationNextFormId = CreationNextFormId,
> {
  readonly formId: TFormId;
  readonly routeBindings: readonly [
    {
      readonly parameterIndex: 0;
      readonly source: 'inherited';
      readonly value: string;
    },
  ];
}

export type RaceDecisionDerived = {
  readonly ancientOptionSerialized: false;
  readonly choiceLockStatus: 'UNLOCKED';
  readonly raceConsequencesPreview: 'Выбрать Единого' | 'Выбрать Вольного' | 'Выбрать Чистого';
};

export type SymbiontAcquisitionDecisionDerived = {
  readonly choiceLockStatus: 'UNLOCKED';
  readonly modeConsequences:
    'Выбрать ручное получение симбионтов' | 'Выбрать случайное получение симбионтов';
};

export type DiceInputDecisionDerived = {
  readonly appliesToAllCreationRolls: true;
  readonly choiceLockStatus: 'UNLOCKED';
};

export type StatMethodDecisionDerived = {
  readonly choiceLockStatus: 'UNLOCKED';
  readonly methodConsequences:
    'Выбрать авантюристский метод' | 'Выбрать классический метод' | 'Выбрать «Всё или ничего»';
};

export type CreationSetDecideDerived =
  | DiceInputDecisionDerived
  | RaceDecisionDerived
  | StatMethodDecisionDerived
  | SymbiontAcquisitionDecisionDerived;

export interface CreationSetAcceptanceDerived {
  readonly decision: 'ACCEPT_SET';
  readonly acceptedSetReceiptId: string;
  readonly assignmentMode: 'ROLLED_BIJECTION';
}

export interface CreationSetAbandonmentDerived {
  readonly decision: 'GO_ATTEMPT_2' | 'GO_NEXT_ATTEMPT' | 'USE_POINT_BUY_85' | 'USE_POINT_BUY_90';
  readonly originDecisionFormId: CreationStatRollDecisionFormId;
  readonly transitionKind: CreationStatAbandonmentTransitionKind;
  readonly abandonedSetReceiptIds: readonly [string];
  readonly irreversibleConsequences: CreationSetAbandonmentConsequences;
  readonly destinationFormId: 'CHR-003' | 'CHR-009';
}

export interface CreationSetDecideDecisionRecord {
  readonly request: CreationRaceMethodSetDecideCommandRequest;
  readonly derived: CreationSetDecideDerived;
  readonly receipt: CreationRaceMethodSetDecideReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope;
}

export interface CreationSetAcceptanceDecisionRecord {
  readonly request: CreationSetDecideCommandRequest & {
    readonly payload: StatRollAcceptSetPayload;
  };
  readonly derived: CreationSetAcceptanceDerived;
  readonly receipt: CommandReceipt<CreationSetAcceptanceReceiptResult>;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-009'>;
}

export interface CreationSetAbandonmentDecisionRecord {
  readonly request: CreationSetDecideCommandRequest & {
    readonly payload: StatRollDialogDecisionPayload & { readonly decision: 'CONFIRM' };
  };
  readonly derived: CreationSetAbandonmentDerived;
  readonly receipt: CommandReceipt<CreationSetAbandonmentReceiptResult>;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-003' | 'CHR-009'>;
}

export type CreationStatRollDecisionRecord =
  CreationSetAbandonmentDecisionRecord | CreationSetAcceptanceDecisionRecord;

export interface RaceAndMethodStage {
  readonly race: {
    readonly value: RaceChoice;
    readonly consequences: RaceDecisionDerived['raceConsequencesPreview'];
    readonly choiceLockStatus: 'UNLOCKED';
  } | null;
  readonly symbiontAcquisition: {
    readonly value: SymbiontAcquisitionMode | null;
    readonly consequences: SymbiontAcquisitionDecisionDerived['modeConsequences'] | null;
    readonly choiceLockStatus: ChoiceLockStatus;
  };
  readonly diceInput: {
    readonly value: DiceInputMode;
    readonly choiceLockStatus: 'LOCKED_AFTER_RESULT' | 'UNLOCKED';
  } | null;
  readonly statMethod: {
    readonly value: StatMethod;
    readonly consequences: StatMethodDecisionDerived['methodConsequences'];
    readonly choiceLockStatus: 'LOCKED_AFTER_RESULT' | 'UNLOCKED';
  } | null;
  readonly decisionRecords: readonly CreationSetDecideDecisionRecord[];
}

export type StatRollStageState =
  | 'CHAIN_COMPLETE'
  | 'CRITICALS_PENDING'
  | 'DECISION_READY'
  | 'REQUEST_READY'
  | 'SET_ABANDONED'
  | 'SET_ACCEPTED';

export interface NaturalCriticalQueueItem extends JsonObject {
  readonly setEntryIndex: number;
  readonly originFace: 1 | 20;
}

export interface CreationCriticalOutcome extends JsonObject {
  readonly setEntryIndex: number;
  readonly value: number;
  readonly criticalGrade: number;
  readonly criticalPolarity: 'FAILURE' | 'NONE' | 'SUCCESS';
  readonly creationCriticalPenaltyOrNull: number | null;
}

interface CreationRollCommitPayloadCommon extends JsonObject {
  readonly stage: 'STAT_ROLLS';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly branchUuid: string;
}

export interface StatSetRollCommitPayload extends CreationRollCommitPayloadCommon {
  readonly sourceFormId: 'CHR-003';
  readonly setRollRequestId: string;
  readonly manualFacesOrNull: readonly number[] | null;
}

export interface CriticalConfirmationRollCommitPayload extends CreationRollCommitPayloadCommon {
  readonly sourceFormId: 'CHR-004';
  readonly setRollReceiptId: string;
  readonly criticalQueueIndex: number;
  readonly confirmationRollRequestId: string;
  readonly manualFaceOrNull: number | null;
}

export type CreationRollCommitPayload =
  CriticalConfirmationRollCommitPayload | StatSetRollCommitPayload;

export type CreationRollCommitCommandRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  CreationRollCommitPayload
>;

interface CreationRollReceiptResultCommon extends JsonObject {
  readonly stage: 'STAT_ROLLS';
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
}

export interface StatSetRollReceiptResult extends CreationRollReceiptResultCommon {
  readonly sourceFormId: 'CHR-003';
  readonly setRollRequestId: string;
  readonly setRollReceiptId: string;
  readonly diceInputModeSnapshot: DiceInputMode;
  readonly faces: readonly number[];
  readonly naturalCriticalQueue: readonly NaturalCriticalQueueItem[];
  readonly shownResultLocked: true;
  readonly confirmationRollRequestIdOrNull: string | null;
  readonly nextFormId: 'CHR-004' | CreationStatRollDecisionFormId;
}

export interface CriticalConfirmationRollReceiptResult extends CreationRollReceiptResultCommon {
  readonly sourceFormId: 'CHR-004';
  readonly setRollReceiptId: string;
  readonly criticalQueueIndex: number;
  readonly originFace: 1 | 20;
  readonly confirmationRollRequestId: string;
  readonly confirmationFace: number;
  readonly confirmationReceiptId: string;
  readonly returnDecisionFormId: 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008';
  readonly outcomeOrNull: CreationCriticalOutcome | null;
  readonly nextConfirmationRollRequestIdOrNull: string | null;
  readonly nextFormId: 'CHR-004' | CreationStatRollDecisionFormId;
}

export type CreationRollCommitReceiptResult =
  CriticalConfirmationRollReceiptResult | StatSetRollReceiptResult;
export type CreationRollCommitReceipt = CommandReceipt<CreationRollCommitReceiptResult>;

export interface StatSetRollRecord {
  readonly request: CreationRollCommitCommandRequest & {
    readonly payload: StatSetRollCommitPayload;
  };
  readonly receipt: CommandReceipt<StatSetRollReceiptResult>;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-004' | CreationStatRollDecisionFormId>;
}

export interface CriticalConfirmationRollRecord {
  readonly request: CreationRollCommitCommandRequest & {
    readonly payload: CriticalConfirmationRollCommitPayload;
  };
  readonly receipt: CommandReceipt<CriticalConfirmationRollReceiptResult>;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-004' | CreationStatRollDecisionFormId>;
}

export interface StatRollAttempt {
  readonly attemptIndex: number;
  readonly setRollRequestId: string;
  readonly setRecord: StatSetRollRecord | null;
  readonly naturalCriticalQueue: readonly NaturalCriticalQueueItem[];
  readonly criticalQueueIndexOrNull: number | null;
  readonly confirmationRollRequestIdOrNull: string | null;
  readonly confirmationRecords: readonly CriticalConfirmationRollRecord[];
  readonly outcomes: readonly CreationCriticalOutcome[];
  readonly returnDecisionFormId: 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008';
  readonly decisionRecordOrNull: CreationStatRollDecisionRecord | null;
  readonly state: StatRollStageState;
}

export interface StatRollStage {
  readonly branchUuid: string;
  readonly statMethod: StatMethod;
  readonly diceInputModeSnapshot: DiceInputMode;
  readonly attempts: readonly StatRollAttempt[];
  readonly currentAttemptIndexOrNull: number | null;
}

export function currentStatRollAttempt(stage: StatRollStage): StatRollAttempt | null {
  if (stage.currentAttemptIndexOrNull === null) return null;
  const current = stage.attempts.find(
    ({ attemptIndex }) => attemptIndex === stage.currentAttemptIndexOrNull,
  );
  if (current === undefined) {
    throw new Error(
      `statRollStage currentAttemptIndexOrNull ${String(stage.currentAttemptIndexOrNull)} does not address an attempt`,
    );
  }
  return current;
}

export interface CreationStatRollAllocation {
  readonly branchUuid: string;
  readonly setRollRequestId: string;
}

export interface CreationStatRollAllocators {
  readonly allocateBranchUuid: () => string;
  readonly allocateRollRequestId: () => string;
}

export interface CreationIdentityStage {
  readonly request: IdentityCheckpointCommandRequest;
  readonly derived: IdentityCheckpointDurablePayload['lastCompleteStage']['derived'];
  readonly receipt: IdentityCheckpointReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-010'>;
}

export interface CreationWizardPreRollPayload {
  readonly identityStage: CreationIdentityStage;
  readonly raceAndMethodStage: RaceAndMethodStage;
  readonly branchCacheEntries: readonly [];
  readonly selectedBranchUuidOrNull: null;
  readonly randomReceiptIds: readonly [];
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly nextStageEnvelope: CreationNextStageEnvelope;
  readonly receipt: CreationRaceMethodSetDecideReceipt;
}

export interface CreationWizardStatRollPayload {
  readonly identityStage: CreationIdentityStage;
  readonly raceAndMethodStage: RaceAndMethodStage;
  readonly statRollStage: StatRollStage;
  readonly branchCacheEntries: readonly [];
  readonly selectedBranchUuidOrNull: null;
  readonly randomReceiptIds: readonly string[];
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly nextStageEnvelope: CreationNextStageEnvelope<
    'CHR-003' | 'CHR-004' | 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008' | 'CHR-009'
  >;
  readonly receipt: CreationRollCommitReceipt | DurableCreationSetDecideReceipt;
}

export interface CreationWizardStatAssignmentPayload extends Omit<
  CreationWizardStatRollPayload,
  'nextStageEnvelope' | 'receipt'
> {
  readonly statAssignmentStage: StatAssignmentStage;
  readonly pureClassStage: PureClassStage | null;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-011' | 'CHR-012'>;
  readonly receipt: StatAssignmentCheckpointReceipt | PureClassDecisionReceipt;
}

export interface CreationWizardSkillPayload extends Omit<
  CreationWizardStatAssignmentPayload,
  'nextStageEnvelope' | 'receipt'
> {
  readonly skillEligibilityStage: SkillEligibilityStage;
  readonly skillSelectionStage: SkillSelectionStage | null;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-013' | 'CHR-017'>;
  readonly receipt: SkillEligibilityCheckpointReceipt | SkillSelectionCheckpointReceipt;
}

export type CreationWizardPostIdentityPayload =
  | CreationWizardPreRollPayload
  | CreationWizardStatRollPayload
  | CreationWizardStatAssignmentPayload
  | CreationWizardSkillPayload;

export type DurableCreationWizardPayload =
  | (IdentityCheckpointDurablePayload & {
      readonly identityStage?: never;
      readonly raceAndMethodStage?: never;
    })
  | CreationWizardPostIdentityPayload;

export interface DurableCreationWizardCheckpoint {
  readonly checkpoint: LocalCharacterCheckpoint;
  readonly durablePayload: DurableCreationWizardPayload;
  readonly identityStage: CreationIdentityStage;
  readonly localCharacter: LocalCharacter;
  readonly nextStageEnvelope: CreationNextStageEnvelope;
  readonly raceAndMethodStage: RaceAndMethodStage | null;
  readonly statRollStage: StatRollStage | null;
  readonly statAssignmentStage: StatAssignmentStage | null;
  readonly pureClassStage: PureClassStage | null;
  readonly skillEligibilityStage: SkillEligibilityStage | null;
  readonly skillSelectionStage: SkillSelectionStage | null;
  readonly receipt:
    | CreationRollCommitReceipt
    | DurableCreationSetDecideReceipt
    | IdentityCheckpointReceipt
    | StatAssignmentCheckpointReceipt
    | PureClassDecisionReceipt
    | SkillEligibilityCheckpointReceipt
    | SkillSelectionCheckpointReceipt;
  readonly request:
    | CreationRollCommitCommandRequest
    | DurableCreationSetDecideCommandRequest
    | IdentityCheckpointCommandRequest
    | StatAssignmentCheckpointCommandRequest
    | SkillCheckpointCommandRequest;
}

export interface DurableCreationWizardCommand {
  readonly durableCheckpoint: DurableCreationWizardCheckpoint;
  readonly nextStageEnvelope: CreationNextStageEnvelope;
  readonly receipt:
    | CreationRollCommitReceipt
    | DurableCreationSetDecideReceipt
    | IdentityCheckpointReceipt
    | StatAssignmentCheckpointReceipt
    | PureClassDecisionReceipt
    | SkillEligibilityCheckpointReceipt
    | SkillSelectionCheckpointReceipt;
  readonly request:
    | CreationRollCommitCommandRequest
    | DurableCreationSetDecideCommandRequest
    | IdentityCheckpointCommandRequest
    | StatAssignmentCheckpointCommandRequest
    | SkillCheckpointCommandRequest;
}

export interface CreationSetAbandonmentDialogContext {
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly originDecisionFormId: CreationStatRollDecisionFormId;
  readonly transitionKind: CreationStatAbandonmentTransitionKind;
  readonly abandonedSetReceiptIds: readonly [string];
  readonly irreversibleConsequences: CreationSetAbandonmentConsequences;
}

export type CreationSetDecideExecutionResult =
  | {
      readonly kind: 'DURABLE';
      readonly durableCheckpoint: DurableCreationWizardCheckpoint;
    }
  | {
      readonly kind: 'TRANSIENT_CANCEL';
      readonly request: CreationSetCancelCommandRequest;
      readonly receipt: CreationSetCancelReceipt;
    };

export class CreationSetDecideApplicationError extends Error {
  constructor(readonly refusal: CommandRefusal) {
    super(`creation set decision request refused: ${JSON.stringify(refusal)}`);
  }
}

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

const COMMON_PAYLOAD_KEYS = [
  'stage',
  'sourceFormId',
  'characterDraftId',
  'wizardCheckpointId',
  'draftRevision',
] as const;
const POST_IDENTITY_PAYLOAD_KEYS = [
  'identityStage',
  'raceAndMethodStage',
  'branchCacheEntries',
  'selectedBranchUuidOrNull',
  'randomReceiptIds',
  'branchCacheHash',
  'nextStageEnvelope',
  'receipt',
] as const;
const STAT_ROLL_PAYLOAD_KEYS = [...POST_IDENTITY_PAYLOAD_KEYS, 'statRollStage'] as const;
const STAT_ASSIGNMENT_PAYLOAD_KEYS = [
  ...STAT_ROLL_PAYLOAD_KEYS,
  'statAssignmentStage',
  'pureClassStage',
] as const;
const SKILL_PAYLOAD_KEYS = [
  ...STAT_ASSIGNMENT_PAYLOAD_KEYS,
  'skillEligibilityStage',
  'skillSelectionStage',
] as const;
const RECEIPT_RESULT_COMMON_KEYS = [
  'stage',
  'sourceFormId',
  'characterDraftId',
  'checkpointOwnerId',
  'checkpointId',
  'checkpointRevision',
  'draftRevision',
  'branchCacheHash',
  'nextFormId',
] as const;
const REVISION_KEYS = ['actorVisibilityRevision', 'projectionRevision', 'stateRevision'] as const;

const RACE_CONSEQUENCES = {
  FREE: 'Выбрать Вольного',
  PURE: 'Выбрать Чистого',
  UNITED: 'Выбрать Единого',
} as const satisfies Record<RaceChoice, RaceDecisionDerived['raceConsequencesPreview']>;
const ACQUISITION_CONSEQUENCES = {
  MANUAL: 'Выбрать ручное получение симбионтов',
  RANDOM: 'Выбрать случайное получение симбионтов',
} as const satisfies Record<
  SymbiontAcquisitionMode,
  SymbiontAcquisitionDecisionDerived['modeConsequences']
>;
const METHOD_CONSEQUENCES = {
  ADVENTUROUS: 'Выбрать авантюристский метод',
  ALL_OR_NOTHING: 'Выбрать «Всё или ничего»',
  CLASSIC: 'Выбрать классический метод',
} as const satisfies Record<StatMethod, StatMethodDecisionDerived['methodConsequences']>;

const typeName = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

const invalidShape = (path: string, expected: string, value: unknown): never => {
  throw new CreationSetDecideApplicationError({
    actualType: typeName(value),
    code: 'INVALID_SHAPE',
    expected,
    path,
  });
};

const unrecognized = (path: string, value: JsonValue): never => {
  throw new CreationSetDecideApplicationError({ code: 'UNRECOGNIZED', path, value });
};

const objectAt = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidShape(path, 'object', value);
  }
  return value as Record<string, unknown>;
};

const exactObject = (
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> => {
  const object = objectAt(value, path);
  for (const key of keys) {
    if (!Object.hasOwn(object, key)) invalidShape(`${path}.${key}`, 'required field', undefined);
  }
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) invalidShape(`${path}.${key}`, 'no additional field', object[key]);
  }
  return object;
};

const stringAt = (value: unknown, path: string): string => {
  if (typeof value !== 'string') return invalidShape(path, 'string', value);
  return value;
};

const nonEmptyStringAt = (value: unknown, path: string): string => {
  const string = stringAt(value, path);
  if (string.length === 0) return invalidShape(path, 'non-empty string', value);
  return string;
};

const revisionAt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalidShape(path, 'non-negative safe integer', value);
  }
  return Object.is(value, -0) ? 0 : value;
};

const literal = <T extends JsonValue>(value: unknown, expected: T, path: string): T => {
  if (!isDeepStrictEqual(value, expected)) {
    if (value === undefined) return invalidShape(path, 'required field', value);
    return unrecognized(path, value as JsonValue);
  }
  return expected;
};

const enumAt = <T extends string>(value: unknown, path: string, values: readonly T[]): T => {
  const string = stringAt(value, path);
  const selected = values.find((candidate) => candidate === string);
  if (selected === undefined) return unrecognized(path, string);
  return selected;
};

const emptyArrayAt = (value: unknown, path: string): readonly [] => {
  if (!Array.isArray(value)) return invalidShape(path, 'array', value);
  if (value.length !== 0) return unrecognized(path, value as JsonValue);
  return [];
};

const stringArrayAt = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value)) return invalidShape(path, 'array', value);
  return value.map((item, index) => nonEmptyStringAt(item, `${path}[${String(index)}]`));
};

const revisionsAt = (value: unknown, path: string): RevisionVector => {
  const object = exactObject(value, path, REVISION_KEYS);
  return {
    actorVisibilityRevision: revisionAt(
      object['actorVisibilityRevision'],
      `${path}.actorVisibilityRevision`,
    ),
    projectionRevision: revisionAt(object['projectionRevision'], `${path}.projectionRevision`),
    stateRevision: revisionAt(object['stateRevision'], `${path}.stateRevision`),
  };
};

export function normalizeCreationSetDecideRequest(
  request: DecodedCommandRequest,
): CreationSetDecideCommandRequest {
  if (request.commandKind !== 'workflow-command') {
    return unrecognized('$.commandKind', request.commandKind);
  }
  if (request.workflowCommandId !== CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID) {
    return unrecognized('$.workflowCommandId', request.workflowCommandId);
  }
  if (request.role !== 'player') return unrecognized('$.role', request.role);

  const unshapedPayload = objectAt(request.payload, '$.payload');
  const stage = enumAt(unshapedPayload['stage'], '$.payload.stage', [
    'RACE_AND_METHOD',
    'STAT_ASSIGNMENT',
    'STAT_ROLLS',
  ] as const);
  if (stage === 'STAT_ASSIGNMENT') {
    try {
      return normalizePureClassDecisionRequest(request);
    } catch (cause) {
      if (cause instanceof CreationStatAssignmentApplicationError) {
        throw new CreationSetDecideApplicationError(cause.refusal);
      }
      throw cause;
    }
  }
  const sourceFormId =
    stage === 'RACE_AND_METHOD'
      ? enumAt(unshapedPayload['sourceFormId'], '$.payload.sourceFormId', [
          'CHR-010',
          'CHR-016',
          'CHR-036',
          'CHR-002',
        ] as const)
      : enumAt(unshapedPayload['sourceFormId'], '$.payload.sourceFormId', [
          'CHR-005',
          'CHR-006',
          'CHR-007',
          'CHR-008',
          'CHR-028',
        ] as const);
  const variantKey =
    stage === 'STAT_ROLLS'
      ? 'decision'
      : {
          'CHR-002': 'statMethod',
          'CHR-010': 'raceChoice',
          'CHR-016': 'symbiontAcquisitionMode',
          'CHR-036': 'diceInputMode',
        }[sourceFormId as CreationRaceMethodDecisionSourceFormId];
  const payload = exactObject(request.payload, '$.payload', [...COMMON_PAYLOAD_KEYS, variantKey]);
  const common = {
    characterDraftId: nonEmptyStringAt(payload['characterDraftId'], '$.payload.characterDraftId'),
    draftRevision: revisionAt(payload['draftRevision'], '$.payload.draftRevision'),
    wizardCheckpointId: nonEmptyStringAt(
      payload['wizardCheckpointId'],
      '$.payload.wizardCheckpointId',
    ),
  };
  let normalizedPayload: CreationSetDecidePayload;
  switch (sourceFormId) {
    case 'CHR-010':
      normalizedPayload = {
        ...common,
        raceChoice: enumAt(payload['raceChoice'], '$.payload.raceChoice', RACE_CHOICES),
        stage: 'RACE_AND_METHOD',
        sourceFormId,
      };
      break;
    case 'CHR-016':
      normalizedPayload = {
        ...common,
        stage: 'RACE_AND_METHOD',
        sourceFormId,
        symbiontAcquisitionMode: enumAt(
          payload['symbiontAcquisitionMode'],
          '$.payload.symbiontAcquisitionMode',
          SYMBIONT_ACQUISITION_MODES,
        ),
      };
      break;
    case 'CHR-036':
      normalizedPayload = {
        ...common,
        diceInputMode: enumAt(
          payload['diceInputMode'],
          '$.payload.diceInputMode',
          DICE_INPUT_MODES,
        ),
        stage: 'RACE_AND_METHOD',
        sourceFormId,
      };
      break;
    case 'CHR-002':
      normalizedPayload = {
        ...common,
        stage: 'RACE_AND_METHOD',
        sourceFormId,
        statMethod: enumAt(payload['statMethod'], '$.payload.statMethod', STAT_METHODS),
      };
      break;
    case 'CHR-005':
    case 'CHR-006':
    case 'CHR-007':
    case 'CHR-008':
      normalizedPayload = {
        ...common,
        decision: literal(payload['decision'], 'ACCEPT_SET', '$.payload.decision'),
        sourceFormId,
        stage: 'STAT_ROLLS',
      };
      break;
    case 'CHR-028':
      normalizedPayload = {
        ...common,
        decision: enumAt(payload['decision'], '$.payload.decision', ['CONFIRM', 'CANCEL'] as const),
        sourceFormId,
        stage: 'STAT_ROLLS',
      };
      break;
  }
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions: revisionsAt(request.expectedRevisions, '$.expectedRevisions'),
    messageType: 'command.request',
    payload: normalizedPayload,
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  };
}

const raceDerived = (choice: RaceChoice): RaceDecisionDerived => ({
  ancientOptionSerialized: false,
  choiceLockStatus: 'UNLOCKED',
  raceConsequencesPreview: RACE_CONSEQUENCES[choice],
});

const acquisitionDerived = (mode: SymbiontAcquisitionMode): SymbiontAcquisitionDecisionDerived => ({
  choiceLockStatus: 'UNLOCKED',
  modeConsequences: ACQUISITION_CONSEQUENCES[mode],
});

const diceDerived = (): DiceInputDecisionDerived => ({
  appliesToAllCreationRolls: true,
  choiceLockStatus: 'UNLOCKED',
});

const methodDerived = (method: StatMethod): StatMethodDecisionDerived => ({
  choiceLockStatus: 'UNLOCKED',
  methodConsequences: METHOD_CONSEQUENCES[method],
});

const derivedForRequest = (
  request: CreationRaceMethodSetDecideCommandRequest,
): CreationSetDecideDerived => {
  switch (request.payload.sourceFormId) {
    case 'CHR-010':
      return raceDerived(request.payload.raceChoice);
    case 'CHR-016':
      return acquisitionDerived(request.payload.symbiontAcquisitionMode);
    case 'CHR-036':
      return diceDerived();
    case 'CHR-002':
      return methodDerived(request.payload.statMethod);
  }
};

const nextFormForPayload = (payload: CreationRaceMethodSetDecidePayload): CreationNextFormId => {
  switch (payload.sourceFormId) {
    case 'CHR-010':
      return payload.raceChoice === 'PURE' ? 'CHR-036' : 'CHR-016';
    case 'CHR-016':
      return 'CHR-036';
    case 'CHR-036':
      return 'CHR-002';
    case 'CHR-002':
      return 'CHR-003';
  }
};

const nextStageEnvelope = <TFormId extends CreationNextFormId>(
  formId: TFormId,
  characterDraftId: string,
): CreationNextStageEnvelope<TFormId> => ({
  formId,
  routeBindings: [
    {
      parameterIndex: 0,
      source: 'inherited',
      value: characterDraftId,
    },
  ],
});

const nextStageEnvelopeAt = (value: unknown, path: string): CreationNextStageEnvelope => {
  const object = exactObject(value, path, ['formId', 'routeBindings']);
  const formId = enumAt(object['formId'], `${path}.formId`, [
    'CHR-010',
    'CHR-016',
    'CHR-036',
    'CHR-002',
    'CHR-003',
    'CHR-004',
    'CHR-005',
    'CHR-006',
    'CHR-007',
    'CHR-008',
    'CHR-009',
    'CHR-011',
    'CHR-012',
    'CHR-013',
    'CHR-017',
  ] as const);
  const bindings = object['routeBindings'];
  if (!Array.isArray(bindings)) return invalidShape(`${path}.routeBindings`, 'array', bindings);
  if (bindings.length !== 1) return unrecognized(`${path}.routeBindings`, bindings as JsonValue);
  const binding = exactObject(bindings[0], `${path}.routeBindings[0]`, [
    'parameterIndex',
    'source',
    'value',
  ]);
  return {
    formId,
    routeBindings: [
      {
        parameterIndex: literal(
          binding['parameterIndex'],
          0,
          `${path}.routeBindings[0].parameterIndex`,
        ),
        source: literal(binding['source'], 'inherited', `${path}.routeBindings[0].source`),
        value: stringAt(binding['value'], `${path}.routeBindings[0].value`),
      },
    ],
  };
};

const raceMethodReceiptAt = (value: unknown, path: string): CreationRaceMethodSetDecideReceipt => {
  const object = exactObject(value, path, ['commandId', 'receiptId', 'result', 'revisions']);
  const resultPath = `${path}.result`;
  const unshapedResult = objectAt(object['result'], resultPath);
  literal(unshapedResult['stage'], 'RACE_AND_METHOD', `${resultPath}.stage`);
  const sourceFormId = enumAt(unshapedResult['sourceFormId'], `${resultPath}.sourceFormId`, [
    'CHR-010',
    'CHR-016',
    'CHR-036',
    'CHR-002',
  ] as const);
  const decisionKey = {
    'CHR-002': 'statMethod',
    'CHR-010': 'raceChoice',
    'CHR-016': 'symbiontAcquisitionMode',
    'CHR-036': 'diceInputMode',
  }[sourceFormId];
  const result = exactObject(object['result'], resultPath, [
    ...RECEIPT_RESULT_COMMON_KEYS,
    decisionKey,
    ...(sourceFormId === 'CHR-002' ? ['branchUuid', 'setRollRequestId'] : []),
  ]);
  const common = {
    branchCacheHash: literal(
      result['branchCacheHash'],
      EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      `${resultPath}.branchCacheHash`,
    ),
    characterDraftId: stringAt(result['characterDraftId'], `${resultPath}.characterDraftId`),
    checkpointId: stringAt(result['checkpointId'], `${resultPath}.checkpointId`),
    checkpointOwnerId: stringAt(result['checkpointOwnerId'], `${resultPath}.checkpointOwnerId`),
    checkpointRevision: revisionAt(
      result['checkpointRevision'],
      `${resultPath}.checkpointRevision`,
    ),
    draftRevision: revisionAt(result['draftRevision'], `${resultPath}.draftRevision`),
    stage: 'RACE_AND_METHOD' as const,
  };
  let parsedResult: CreationRaceMethodSetDecideReceiptResult;
  switch (sourceFormId) {
    case 'CHR-010':
      parsedResult = {
        ...common,
        nextFormId: enumAt(result['nextFormId'], `${resultPath}.nextFormId`, [
          'CHR-016',
          'CHR-036',
        ] as const),
        raceChoice: enumAt(result['raceChoice'], `${resultPath}.raceChoice`, RACE_CHOICES),
        sourceFormId,
      };
      break;
    case 'CHR-016':
      parsedResult = {
        ...common,
        nextFormId: literal(result['nextFormId'], 'CHR-036', `${resultPath}.nextFormId`),
        sourceFormId,
        symbiontAcquisitionMode: enumAt(
          result['symbiontAcquisitionMode'],
          `${resultPath}.symbiontAcquisitionMode`,
          SYMBIONT_ACQUISITION_MODES,
        ),
      };
      break;
    case 'CHR-036':
      parsedResult = {
        ...common,
        diceInputMode: enumAt(
          result['diceInputMode'],
          `${resultPath}.diceInputMode`,
          DICE_INPUT_MODES,
        ),
        nextFormId: literal(result['nextFormId'], 'CHR-002', `${resultPath}.nextFormId`),
        sourceFormId,
      };
      break;
    case 'CHR-002':
      parsedResult = {
        ...common,
        branchUuid: nonEmptyStringAt(result['branchUuid'], `${resultPath}.branchUuid`),
        nextFormId: literal(result['nextFormId'], 'CHR-003', `${resultPath}.nextFormId`),
        setRollRequestId: nonEmptyStringAt(
          result['setRollRequestId'],
          `${resultPath}.setRollRequestId`,
        ),
        sourceFormId,
        statMethod: enumAt(result['statMethod'], `${resultPath}.statMethod`, STAT_METHODS),
      };
      break;
  }
  return {
    commandId: stringAt(object['commandId'], `${path}.commandId`),
    receiptId: nonEmptyStringAt(object['receiptId'], `${path}.receiptId`),
    result: parsedResult,
    revisions: revisionsAt(object['revisions'], `${path}.revisions`),
  };
};

const abandonmentConsequencesAt = (
  value: unknown,
  path: string,
): CreationSetAbandonmentConsequences => {
  const object = exactObject(value, path, [
    'setValuesDiscarded',
    'creationCriticalConsequencesDiscarded',
    'nextAttemptIndexOrNull',
    'exactPointBuyTotalOrNull',
  ]);
  const nextAttempt = object['nextAttemptIndexOrNull'];
  const pointTotal = object['exactPointBuyTotalOrNull'];
  return {
    creationCriticalConsequencesDiscarded: literal(
      object['creationCriticalConsequencesDiscarded'],
      true,
      `${path}.creationCriticalConsequencesDiscarded`,
    ),
    exactPointBuyTotalOrNull:
      pointTotal === null
        ? null
        : (() => {
            const total = safeIntegerAt(pointTotal, `${path}.exactPointBuyTotalOrNull`, 85, 90);
            if (total !== 85 && total !== 90) {
              return unrecognized(`${path}.exactPointBuyTotalOrNull`, total);
            }
            return total;
          })(),
    nextAttemptIndexOrNull:
      nextAttempt === null
        ? null
        : (safeIntegerAt(nextAttempt, `${path}.nextAttemptIndexOrNull`, 2, 5) as 2 | 3 | 4 | 5),
    setValuesDiscarded: literal(object['setValuesDiscarded'], true, `${path}.setValuesDiscarded`),
  };
};

const statDecisionReceiptAt = (value: unknown, path: string): CreationSetDecideReceipt => {
  const object = exactObject(value, path, ['commandId', 'receiptId', 'result', 'revisions']);
  const resultPath = `${path}.result`;
  const unshaped = objectAt(object['result'], resultPath);
  literal(unshaped['stage'], 'STAT_ROLLS', `${resultPath}.stage`);
  const sourceFormId = enumAt(unshaped['sourceFormId'], `${resultPath}.sourceFormId`, [
    'CHR-005',
    'CHR-006',
    'CHR-007',
    'CHR-008',
    'CHR-028',
  ] as const);
  const decision = enumAt(unshaped['decision'], `${resultPath}.decision`, [
    'ACCEPT_SET',
    'CONFIRM',
    'CANCEL',
  ] as const);
  const commonKeys = [
    'stage',
    'sourceFormId',
    'characterDraftId',
    'checkpointOwnerId',
    'checkpointId',
    'checkpointRevision',
    'draftRevision',
    'branchCacheHash',
    'branchUuid',
    'decision',
    'nextFormId',
  ] as const;
  const variantKeys =
    decision === 'ACCEPT_SET'
      ? ['acceptedSetReceiptId', 'assignmentMode']
      : decision === 'CANCEL'
        ? ['originDecisionFormId', 'decisionReceiptIdOrNull']
        : [
            'originDecisionFormId',
            'alternateDecision',
            'transitionKind',
            'abandonedSetReceiptIds',
            'irreversibleConsequences',
            'assignmentModeOrNull',
            'sourceSetReceiptIdOrNull',
            'nextAttemptIndexOrNull',
            'nextSetRollRequestIdOrNull',
          ];
  const result = exactObject(object['result'], resultPath, [...commonKeys, ...variantKeys]);
  const common = {
    branchCacheHash: literal(
      result['branchCacheHash'],
      EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      `${resultPath}.branchCacheHash`,
    ),
    branchUuid: nonEmptyStringAt(result['branchUuid'], `${resultPath}.branchUuid`),
    characterDraftId: nonEmptyStringAt(
      result['characterDraftId'],
      `${resultPath}.characterDraftId`,
    ),
    checkpointId: nonEmptyStringAt(result['checkpointId'], `${resultPath}.checkpointId`),
    checkpointOwnerId: nonEmptyStringAt(
      result['checkpointOwnerId'],
      `${resultPath}.checkpointOwnerId`,
    ),
    checkpointRevision: revisionAt(
      result['checkpointRevision'],
      `${resultPath}.checkpointRevision`,
    ),
    draftRevision: revisionAt(result['draftRevision'], `${resultPath}.draftRevision`),
    stage: 'STAT_ROLLS' as const,
  };
  let parsedResult: CreationSetDecideReceiptResult;
  if (decision === 'ACCEPT_SET') {
    if (sourceFormId === 'CHR-028') return unrecognized(`${resultPath}.sourceFormId`, sourceFormId);
    parsedResult = {
      ...common,
      acceptedSetReceiptId: nonEmptyStringAt(
        result['acceptedSetReceiptId'],
        `${resultPath}.acceptedSetReceiptId`,
      ),
      assignmentMode: literal(
        result['assignmentMode'],
        'ROLLED_BIJECTION',
        `${resultPath}.assignmentMode`,
      ),
      decision,
      nextFormId: literal(result['nextFormId'], 'CHR-009', `${resultPath}.nextFormId`),
      sourceFormId,
    };
  } else if (decision === 'CANCEL') {
    if (sourceFormId !== 'CHR-028') return unrecognized(`${resultPath}.sourceFormId`, sourceFormId);
    const originDecisionFormId = enumAt(
      result['originDecisionFormId'],
      `${resultPath}.originDecisionFormId`,
      ['CHR-005', 'CHR-006', 'CHR-007', 'CHR-008'] as const,
    );
    parsedResult = {
      ...common,
      decision,
      decisionReceiptIdOrNull: literal(
        result['decisionReceiptIdOrNull'],
        null,
        `${resultPath}.decisionReceiptIdOrNull`,
      ),
      nextFormId: literal(result['nextFormId'], originDecisionFormId, `${resultPath}.nextFormId`),
      originDecisionFormId,
      sourceFormId,
    };
  } else {
    if (sourceFormId !== 'CHR-028') return unrecognized(`${resultPath}.sourceFormId`, sourceFormId);
    const abandoned = stringArrayAt(
      result['abandonedSetReceiptIds'],
      `${resultPath}.abandonedSetReceiptIds`,
    );
    if (abandoned.length !== 1) {
      return invalidShape(`${resultPath}.abandonedSetReceiptIds`, 'singleton array', abandoned);
    }
    parsedResult = {
      ...common,
      abandonedSetReceiptIds: [abandoned[0]!],
      alternateDecision: enumAt(result['alternateDecision'], `${resultPath}.alternateDecision`, [
        'GO_ATTEMPT_2',
        'GO_NEXT_ATTEMPT',
        'USE_POINT_BUY_85',
        'USE_POINT_BUY_90',
      ] as const),
      assignmentModeOrNull:
        result['assignmentModeOrNull'] === null
          ? null
          : enumAt(result['assignmentModeOrNull'], `${resultPath}.assignmentModeOrNull`, [
              'POINT_BUY_85',
              'POINT_BUY_90',
            ] as const),
      decision,
      irreversibleConsequences: abandonmentConsequencesAt(
        result['irreversibleConsequences'],
        `${resultPath}.irreversibleConsequences`,
      ),
      nextAttemptIndexOrNull:
        result['nextAttemptIndexOrNull'] === null
          ? null
          : (safeIntegerAt(
              result['nextAttemptIndexOrNull'],
              `${resultPath}.nextAttemptIndexOrNull`,
              2,
              5,
            ) as 2 | 3 | 4 | 5),
      nextFormId: enumAt(result['nextFormId'], `${resultPath}.nextFormId`, [
        'CHR-003',
        'CHR-009',
      ] as const),
      originDecisionFormId: enumAt(
        result['originDecisionFormId'],
        `${resultPath}.originDecisionFormId`,
        ['CHR-005', 'CHR-006', 'CHR-007', 'CHR-008'] as const,
      ),
      nextSetRollRequestIdOrNull: nullableNonEmptyStringAt(
        result['nextSetRollRequestIdOrNull'],
        `${resultPath}.nextSetRollRequestIdOrNull`,
      ),
      sourceFormId,
      sourceSetReceiptIdOrNull: literal(
        result['sourceSetReceiptIdOrNull'],
        null,
        `${resultPath}.sourceSetReceiptIdOrNull`,
      ),
      transitionKind: enumAt(result['transitionKind'], `${resultPath}.transitionKind`, [
        'CLASSIC_TO_90',
        'ADVENTUROUS_TO_SECOND',
        'ADVENTUROUS_TO_85',
        'ALL_OR_NOTHING_NEXT',
      ] as const),
    };
  }
  return {
    commandId: nonEmptyStringAt(object['commandId'], `${path}.commandId`),
    receiptId: nonEmptyStringAt(object['receiptId'], `${path}.receiptId`),
    result: parsedResult,
    revisions: revisionsAt(object['revisions'], `${path}.revisions`),
  };
};

const STORED_REQUEST_VOCABULARY: ProtocolVocabulary = {
  isFormId: (_value): _value is never => false,
  isHostTransition: () => false,
  isWorkflowCommandId: (value): value is WorkflowCommandId =>
    value === IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID ||
    value === CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID ||
    value === CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
};

const storedRequestAt = (
  value: unknown,
  label: string,
):
  | CreationRollCommitCommandRequest
  | CreationSetDecideCommandRequest
  | IdentityCheckpointCommandRequest
  | StatAssignmentCheckpointCommandRequest => {
  let source: string;
  try {
    source = JSON.stringify(value);
  } catch (cause) {
    throw new Error(`${label} request cannot be encoded as JSON`, { cause });
  }
  const decoded = decodeClientMessage(source, STORED_REQUEST_VOCABULARY);
  if (!decoded.ok) {
    throw new Error(
      `${label} request is not a valid wire v1 command: ${JSON.stringify(decoded.refusal)}`,
    );
  }
  if (decoded.value.messageType !== 'command.request') {
    throw new Error(`${label} request is not a command.request`);
  }
  try {
    if (
      decoded.value.commandKind === 'workflow-command' &&
      decoded.value.workflowCommandId === IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID
    ) {
      const payload = decoded.value.payload;
      if (
        payload !== null &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        (payload as Record<string, unknown>)['stage'] === 'STAT_ASSIGNMENT'
      ) {
        return normalizeStatAssignmentCheckpointRequest(decoded.value);
      }
      return validateIdentityCheckpointRequest(normalizeIdentityCheckpointRequest(decoded.value));
    }
    if (
      decoded.value.commandKind === 'workflow-command' &&
      decoded.value.workflowCommandId === CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID
    ) {
      return normalizeCreationRollCommitRequest(decoded.value);
    }
    return normalizeCreationSetDecideRequest(decoded.value);
  } catch (cause) {
    if (
      cause instanceof IdentityCheckpointApplicationError ||
      cause instanceof CreationSetDecideApplicationError ||
      cause instanceof CreationRollCommitApplicationError ||
      cause instanceof CreationStatAssignmentApplicationError
    ) {
      throw new Error(`${label} request violates the character wizard contract`, { cause });
    }
    throw cause;
  }
};

const decisionRecordAt = (
  value: unknown,
  path: string,
  label: string,
): CreationSetDecideDecisionRecord => {
  const object = exactObject(value, path, ['request', 'derived', 'receipt', 'nextStageEnvelope']);
  const request = storedRequestAt(object['request'], label);
  if (request.workflowCommandId !== CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID) {
    throw new Error(`${label} ${path}.request is not a SET-DECIDE command`);
  }
  if (request.payload.stage !== 'RACE_AND_METHOD') {
    throw new Error(`${label} ${path}.request is not a RACE_AND_METHOD decision`);
  }
  const raceMethodRequest = request as CreationRaceMethodSetDecideCommandRequest;
  const expectedDerived = derivedForRequest(raceMethodRequest);
  const derived = exactObject(object['derived'], `${path}.derived`, Object.keys(expectedDerived));
  for (const [key, expected] of Object.entries(expectedDerived)) {
    literal(derived[key], expected, `${path}.derived.${key}`);
  }
  return {
    derived: expectedDerived,
    nextStageEnvelope: nextStageEnvelopeAt(
      object['nextStageEnvelope'],
      `${path}.nextStageEnvelope`,
    ),
    receipt: raceMethodReceiptAt(object['receipt'], `${path}.receipt`),
    request: raceMethodRequest,
  };
};

const safeIntegerAt = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalidShape(path, `safe integer in ${String(minimum)}..${String(maximum)}`, value);
  }
  return Object.is(value, -0) ? 0 : value;
};

const nullableNonEmptyStringAt = (value: unknown, path: string): string | null =>
  value === null ? null : nonEmptyStringAt(value, path);

const criticalFaceAt = (value: unknown, path: string): 1 | 20 => {
  const face = safeIntegerAt(value, path, 1, 20);
  if (face !== 1 && face !== 20) return unrecognized(path, face);
  return face;
};

const naturalCriticalQueueItemAt = (value: unknown, path: string): NaturalCriticalQueueItem => {
  const object = exactObject(value, path, ['setEntryIndex', 'originFace']);
  return {
    originFace: criticalFaceAt(object['originFace'], `${path}.originFace`),
    setEntryIndex: safeIntegerAt(object['setEntryIndex'], `${path}.setEntryIndex`, 0, 6),
  };
};

const naturalCriticalQueueAt = (
  value: unknown,
  path: string,
): readonly NaturalCriticalQueueItem[] => {
  if (!Array.isArray(value)) return invalidShape(path, 'array', value);
  return value.map((item, index) => naturalCriticalQueueItemAt(item, `${path}[${String(index)}]`));
};

const criticalOutcomeAt = (value: unknown, path: string): CreationCriticalOutcome => {
  const object = exactObject(value, path, [
    'setEntryIndex',
    'value',
    'criticalGrade',
    'criticalPolarity',
    'creationCriticalPenaltyOrNull',
  ]);
  const penalty = object['creationCriticalPenaltyOrNull'];
  return {
    creationCriticalPenaltyOrNull:
      penalty === null
        ? null
        : safeIntegerAt(penalty, `${path}.creationCriticalPenaltyOrNull`, -5, -1),
    criticalGrade: safeIntegerAt(object['criticalGrade'], `${path}.criticalGrade`, 0, 5),
    criticalPolarity: enumAt(object['criticalPolarity'], `${path}.criticalPolarity`, [
      'SUCCESS',
      'FAILURE',
      'NONE',
    ] as const),
    setEntryIndex: safeIntegerAt(object['setEntryIndex'], `${path}.setEntryIndex`, 0, 6),
    value: safeIntegerAt(object['value'], `${path}.value`, 1, 25),
  };
};

const rollReceiptCommonAt = (result: Record<string, unknown>, resultPath: string) => ({
  branchCacheHash: literal(
    result['branchCacheHash'],
    EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    `${resultPath}.branchCacheHash`,
  ),
  branchUuid: nonEmptyStringAt(result['branchUuid'], `${resultPath}.branchUuid`),
  characterDraftId: nonEmptyStringAt(result['characterDraftId'], `${resultPath}.characterDraftId`),
  checkpointId: nonEmptyStringAt(result['checkpointId'], `${resultPath}.checkpointId`),
  checkpointOwnerId: nonEmptyStringAt(
    result['checkpointOwnerId'],
    `${resultPath}.checkpointOwnerId`,
  ),
  checkpointRevision: revisionAt(result['checkpointRevision'], `${resultPath}.checkpointRevision`),
  draftRevision: revisionAt(result['draftRevision'], `${resultPath}.draftRevision`),
  stage: 'STAT_ROLLS' as const,
});

const creationRollReceiptAt = (value: unknown, path: string): CreationRollCommitReceipt => {
  const object = exactObject(value, path, ['commandId', 'receiptId', 'result', 'revisions']);
  const resultPath = `${path}.result`;
  const unshapedResult = objectAt(object['result'], resultPath);
  literal(unshapedResult['stage'], 'STAT_ROLLS', `${resultPath}.stage`);
  const sourceFormId = enumAt(unshapedResult['sourceFormId'], `${resultPath}.sourceFormId`, [
    'CHR-003',
    'CHR-004',
  ] as const);
  const variantKeys =
    sourceFormId === 'CHR-003'
      ? [
          'setRollRequestId',
          'setRollReceiptId',
          'diceInputModeSnapshot',
          'faces',
          'naturalCriticalQueue',
          'shownResultLocked',
          'confirmationRollRequestIdOrNull',
          'nextFormId',
        ]
      : [
          'setRollReceiptId',
          'criticalQueueIndex',
          'originFace',
          'confirmationRollRequestId',
          'confirmationFace',
          'confirmationReceiptId',
          'returnDecisionFormId',
          'outcomeOrNull',
          'nextConfirmationRollRequestIdOrNull',
          'nextFormId',
        ];
  const result = exactObject(object['result'], resultPath, [
    'stage',
    'sourceFormId',
    'characterDraftId',
    'checkpointOwnerId',
    'checkpointId',
    'checkpointRevision',
    'draftRevision',
    'branchCacheHash',
    'branchUuid',
    ...variantKeys,
  ]);
  const common = rollReceiptCommonAt(result, resultPath);
  let parsedResult: CreationRollCommitReceiptResult;
  if (sourceFormId === 'CHR-003') {
    const rawFaces = result['faces'];
    if (!Array.isArray(rawFaces) || rawFaces.length !== 7) {
      return invalidShape(`${resultPath}.faces`, 'array of exactly seven d20 faces', rawFaces);
    }
    const naturalCriticalQueue = naturalCriticalQueueAt(
      result['naturalCriticalQueue'],
      `${resultPath}.naturalCriticalQueue`,
    );
    parsedResult = {
      ...common,
      confirmationRollRequestIdOrNull: nullableNonEmptyStringAt(
        result['confirmationRollRequestIdOrNull'],
        `${resultPath}.confirmationRollRequestIdOrNull`,
      ),
      diceInputModeSnapshot: enumAt(
        result['diceInputModeSnapshot'],
        `${resultPath}.diceInputModeSnapshot`,
        DICE_INPUT_MODES,
      ),
      faces: rawFaces.map((face, index) =>
        safeIntegerAt(face, `${resultPath}.faces[${String(index)}]`, 1, 20),
      ),
      naturalCriticalQueue,
      nextFormId: enumAt(result['nextFormId'], `${resultPath}.nextFormId`, [
        'CHR-004',
        'CHR-005',
        'CHR-006',
        'CHR-007',
        'CHR-008',
      ] as const),
      setRollReceiptId: nonEmptyStringAt(
        result['setRollReceiptId'],
        `${resultPath}.setRollReceiptId`,
      ),
      setRollRequestId: nonEmptyStringAt(
        result['setRollRequestId'],
        `${resultPath}.setRollRequestId`,
      ),
      shownResultLocked: literal(
        result['shownResultLocked'],
        true,
        `${resultPath}.shownResultLocked`,
      ),
      sourceFormId,
    };
  } else {
    parsedResult = {
      ...common,
      confirmationFace: safeIntegerAt(
        result['confirmationFace'],
        `${resultPath}.confirmationFace`,
        1,
        20,
      ),
      confirmationReceiptId: nonEmptyStringAt(
        result['confirmationReceiptId'],
        `${resultPath}.confirmationReceiptId`,
      ),
      confirmationRollRequestId: nonEmptyStringAt(
        result['confirmationRollRequestId'],
        `${resultPath}.confirmationRollRequestId`,
      ),
      criticalQueueIndex: revisionAt(
        result['criticalQueueIndex'],
        `${resultPath}.criticalQueueIndex`,
      ),
      nextConfirmationRollRequestIdOrNull: nullableNonEmptyStringAt(
        result['nextConfirmationRollRequestIdOrNull'],
        `${resultPath}.nextConfirmationRollRequestIdOrNull`,
      ),
      nextFormId: enumAt(result['nextFormId'], `${resultPath}.nextFormId`, [
        'CHR-004',
        'CHR-005',
        'CHR-006',
        'CHR-007',
        'CHR-008',
      ] as const),
      originFace: criticalFaceAt(result['originFace'], `${resultPath}.originFace`),
      outcomeOrNull:
        result['outcomeOrNull'] === null
          ? null
          : criticalOutcomeAt(result['outcomeOrNull'], `${resultPath}.outcomeOrNull`),
      returnDecisionFormId: enumAt(
        result['returnDecisionFormId'],
        `${resultPath}.returnDecisionFormId`,
        ['CHR-005', 'CHR-006', 'CHR-007', 'CHR-008'] as const,
      ),
      setRollReceiptId: nonEmptyStringAt(
        result['setRollReceiptId'],
        `${resultPath}.setRollReceiptId`,
      ),
      sourceFormId,
    };
  }
  return {
    commandId: nonEmptyStringAt(object['commandId'], `${path}.commandId`),
    receiptId: nonEmptyStringAt(object['receiptId'], `${path}.receiptId`),
    result: parsedResult,
    revisions: revisionsAt(object['revisions'], `${path}.revisions`),
  };
};

const statSetRecordAt = (value: unknown, path: string, label: string): StatSetRollRecord => {
  const object = exactObject(value, path, ['request', 'receipt', 'nextStageEnvelope']);
  const request = storedRequestAt(object['request'], `${label} ${path}`);
  if (
    request.workflowCommandId !== CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID ||
    request.payload.sourceFormId !== 'CHR-003'
  ) {
    throw new Error(`${label} ${path}.request is not a CHR-003 ROLL-COMMIT command`);
  }
  const receipt = creationRollReceiptAt(object['receipt'], `${path}.receipt`);
  if (receipt.result.sourceFormId !== 'CHR-003') {
    throw new Error(`${label} ${path}.receipt is not a CHR-003 ROLL-COMMIT receipt`);
  }
  return {
    nextStageEnvelope: nextStageEnvelopeAt(
      object['nextStageEnvelope'],
      `${path}.nextStageEnvelope`,
    ) as CreationNextStageEnvelope<'CHR-004' | CreationStatRollDecisionFormId>,
    receipt: receipt as CommandReceipt<StatSetRollReceiptResult>,
    request: request as StatSetRollRecord['request'],
  };
};

const confirmationRecordAt = (
  value: unknown,
  path: string,
  label: string,
): CriticalConfirmationRollRecord => {
  const object = exactObject(value, path, ['request', 'receipt', 'nextStageEnvelope']);
  const request = storedRequestAt(object['request'], `${label} ${path}`);
  if (
    request.workflowCommandId !== CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID ||
    request.payload.sourceFormId !== 'CHR-004'
  ) {
    throw new Error(`${label} ${path}.request is not a CHR-004 ROLL-COMMIT command`);
  }
  const receipt = creationRollReceiptAt(object['receipt'], `${path}.receipt`);
  if (receipt.result.sourceFormId !== 'CHR-004') {
    throw new Error(`${label} ${path}.receipt is not a CHR-004 ROLL-COMMIT receipt`);
  }
  return {
    nextStageEnvelope: nextStageEnvelopeAt(
      object['nextStageEnvelope'],
      `${path}.nextStageEnvelope`,
    ) as CreationNextStageEnvelope<'CHR-004' | CreationStatRollDecisionFormId>,
    receipt: receipt as CommandReceipt<CriticalConfirmationRollReceiptResult>,
    request: request as CriticalConfirmationRollRecord['request'],
  };
};

const statRollDecisionRecordAt = (
  value: unknown,
  path: string,
  label: string,
): CreationStatRollDecisionRecord => {
  const object = exactObject(value, path, ['request', 'derived', 'receipt', 'nextStageEnvelope']);
  const request = storedRequestAt(object['request'], `${label} ${path}`);
  if (
    request.workflowCommandId !== CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID ||
    request.payload.stage !== 'STAT_ROLLS' ||
    request.payload.decision === 'CANCEL'
  ) {
    throw new Error(`${label} ${path}.request is not a durable STAT_ROLLS SET-DECIDE command`);
  }
  const receipt = statDecisionReceiptAt(object['receipt'], `${path}.receipt`);
  if (receipt.result.decision === 'CANCEL') {
    throw new Error(`${label} ${path}.receipt persists a transient CANCEL`);
  }
  const derivedPath = `${path}.derived`;
  if (request.payload.decision === 'ACCEPT_SET') {
    const derived = exactObject(object['derived'], derivedPath, [
      'decision',
      'acceptedSetReceiptId',
      'assignmentMode',
    ]);
    return {
      derived: {
        acceptedSetReceiptId: nonEmptyStringAt(
          derived['acceptedSetReceiptId'],
          `${derivedPath}.acceptedSetReceiptId`,
        ),
        assignmentMode: literal(
          derived['assignmentMode'],
          'ROLLED_BIJECTION',
          `${derivedPath}.assignmentMode`,
        ),
        decision: literal(derived['decision'], 'ACCEPT_SET', `${derivedPath}.decision`),
      },
      nextStageEnvelope: nextStageEnvelopeAt(
        object['nextStageEnvelope'],
        `${path}.nextStageEnvelope`,
      ) as CreationNextStageEnvelope<'CHR-009'>,
      receipt: receipt as CommandReceipt<CreationSetAcceptanceReceiptResult>,
      request: request as CreationSetAcceptanceDecisionRecord['request'],
    };
  }
  const derived = exactObject(object['derived'], derivedPath, [
    'decision',
    'originDecisionFormId',
    'transitionKind',
    'abandonedSetReceiptIds',
    'irreversibleConsequences',
    'destinationFormId',
  ]);
  const abandoned = stringArrayAt(
    derived['abandonedSetReceiptIds'],
    `${derivedPath}.abandonedSetReceiptIds`,
  );
  if (abandoned.length !== 1) {
    return invalidShape(`${derivedPath}.abandonedSetReceiptIds`, 'singleton array', abandoned);
  }
  return {
    derived: {
      abandonedSetReceiptIds: [abandoned[0]!],
      decision: enumAt(derived['decision'], `${derivedPath}.decision`, [
        'GO_ATTEMPT_2',
        'GO_NEXT_ATTEMPT',
        'USE_POINT_BUY_85',
        'USE_POINT_BUY_90',
      ] as const),
      destinationFormId: enumAt(derived['destinationFormId'], `${derivedPath}.destinationFormId`, [
        'CHR-003',
        'CHR-009',
      ] as const),
      irreversibleConsequences: abandonmentConsequencesAt(
        derived['irreversibleConsequences'],
        `${derivedPath}.irreversibleConsequences`,
      ),
      originDecisionFormId: enumAt(
        derived['originDecisionFormId'],
        `${derivedPath}.originDecisionFormId`,
        ['CHR-005', 'CHR-006', 'CHR-007', 'CHR-008'] as const,
      ),
      transitionKind: enumAt(derived['transitionKind'], `${derivedPath}.transitionKind`, [
        'CLASSIC_TO_90',
        'ADVENTUROUS_TO_SECOND',
        'ADVENTUROUS_TO_85',
        'ALL_OR_NOTHING_NEXT',
      ] as const),
    },
    nextStageEnvelope: nextStageEnvelopeAt(
      object['nextStageEnvelope'],
      `${path}.nextStageEnvelope`,
    ) as CreationNextStageEnvelope<'CHR-003' | 'CHR-009'>,
    receipt: receipt as CommandReceipt<CreationSetAbandonmentReceiptResult>,
    request: request as CreationSetAbandonmentDecisionRecord['request'],
  };
};

const statRollAttemptAt = (value: unknown, path: string, label: string): StatRollAttempt => {
  const object = exactObject(value, path, [
    'attemptIndex',
    'setRollRequestId',
    'setRecord',
    'naturalCriticalQueue',
    'criticalQueueIndexOrNull',
    'confirmationRollRequestIdOrNull',
    'confirmationRecords',
    'outcomes',
    'returnDecisionFormId',
    'decisionRecordOrNull',
    'state',
  ]);
  const rawConfirmationRecords = object['confirmationRecords'];
  if (!Array.isArray(rawConfirmationRecords)) {
    return invalidShape(`${path}.confirmationRecords`, 'array', rawConfirmationRecords);
  }
  const rawOutcomes = object['outcomes'];
  if (!Array.isArray(rawOutcomes)) return invalidShape(`${path}.outcomes`, 'array', rawOutcomes);
  return {
    attemptIndex: safeIntegerAt(object['attemptIndex'], `${path}.attemptIndex`, 1, 5),
    confirmationRecords: rawConfirmationRecords.map((record, index) =>
      confirmationRecordAt(record, `${path}.confirmationRecords[${String(index)}]`, label),
    ),
    confirmationRollRequestIdOrNull: nullableNonEmptyStringAt(
      object['confirmationRollRequestIdOrNull'],
      `${path}.confirmationRollRequestIdOrNull`,
    ),
    criticalQueueIndexOrNull:
      object['criticalQueueIndexOrNull'] === null
        ? null
        : revisionAt(object['criticalQueueIndexOrNull'], `${path}.criticalQueueIndexOrNull`),
    decisionRecordOrNull:
      object['decisionRecordOrNull'] === null
        ? null
        : statRollDecisionRecordAt(
            object['decisionRecordOrNull'],
            `${path}.decisionRecordOrNull`,
            label,
          ),
    naturalCriticalQueue: naturalCriticalQueueAt(
      object['naturalCriticalQueue'],
      `${path}.naturalCriticalQueue`,
    ),
    outcomes: rawOutcomes.map((outcome, index) =>
      criticalOutcomeAt(outcome, `${path}.outcomes[${String(index)}]`),
    ),
    returnDecisionFormId: enumAt(object['returnDecisionFormId'], `${path}.returnDecisionFormId`, [
      'CHR-005',
      'CHR-006',
      'CHR-007',
      'CHR-008',
    ] as const),
    setRecord:
      object['setRecord'] === null
        ? null
        : statSetRecordAt(object['setRecord'], `${path}.setRecord`, label),
    setRollRequestId: nonEmptyStringAt(object['setRollRequestId'], `${path}.setRollRequestId`),
    state: enumAt(object['state'], `${path}.state`, [
      'REQUEST_READY',
      'CRITICALS_PENDING',
      'DECISION_READY',
      'CHAIN_COMPLETE',
      'SET_ABANDONED',
      'SET_ACCEPTED',
    ] as const),
  };
};

const statRollStageAt = (value: unknown, label: string): StatRollStage => {
  const path = '$.statRollStage';
  const object = exactObject(value, path, [
    'branchUuid',
    'statMethod',
    'diceInputModeSnapshot',
    'attempts',
    'currentAttemptIndexOrNull',
  ]);
  const rawAttempts = object['attempts'];
  if (!Array.isArray(rawAttempts) || rawAttempts.length === 0) {
    return invalidShape(`${path}.attempts`, 'non-empty array', rawAttempts);
  }
  return {
    attempts: rawAttempts.map((attempt, index) =>
      statRollAttemptAt(attempt, `${path}.attempts[${String(index)}]`, label),
    ),
    branchUuid: nonEmptyStringAt(object['branchUuid'], `${path}.branchUuid`),
    currentAttemptIndexOrNull:
      object['currentAttemptIndexOrNull'] === null
        ? null
        : safeIntegerAt(
            object['currentAttemptIndexOrNull'],
            `${path}.currentAttemptIndexOrNull`,
            1,
            5,
          ),
    diceInputModeSnapshot: enumAt(
      object['diceInputModeSnapshot'],
      `${path}.diceInputModeSnapshot`,
      DICE_INPUT_MODES,
    ),
    statMethod: enumAt(object['statMethod'], `${path}.statMethod`, STAT_METHODS),
  };
};

const identityStageFromDurable = (durable: DurableIdentityCheckpoint): CreationIdentityStage => ({
  derived: durable.durablePayload.lastCompleteStage.derived,
  nextStageEnvelope: durable.durablePayload.nextStageEnvelope,
  receipt: durable.receipt,
  request: durable.request,
});

const identityStageAt = (
  value: unknown,
  label: string,
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
  outer: {
    readonly branchCacheEntries: readonly [];
    readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
    readonly randomReceiptIds: readonly string[];
    readonly selectedBranchUuidOrNull: null;
  },
): CreationIdentityStage => {
  const object = exactObject(value, '$.identityStage', [
    'request',
    'derived',
    'receipt',
    'nextStageEnvelope',
  ]);
  const identityPayload = {
    branchCacheEntries: outer.branchCacheEntries,
    branchCacheHash: outer.branchCacheHash,
    lastCompleteStage: {
      derived: object['derived'],
      request: object['request'],
    },
    nextStageEnvelope: object['nextStageEnvelope'],
    randomReceiptIds: [],
    receipt: object['receipt'],
    selectedBranchUuidOrNull: outer.selectedBranchUuidOrNull,
  };
  const syntheticLocalCharacter: LocalCharacter = {
    ...localCharacter,
    actorVisibilityRevision: 0,
    payloadJson: JSON.stringify(identityPayload),
    projectionRevision: 0,
    stateRevision: 0,
  };
  const syntheticCheckpoint: LocalCharacterCheckpoint = {
    ...checkpoint,
    actorVisibilityRevision: 0,
    checkpointRevision: 0,
    projectionRevision: 0,
    stateRevision: 0,
  };
  try {
    return identityStageFromDurable(
      validateDurableIdentityCheckpoint(syntheticLocalCharacter, syntheticCheckpoint),
    );
  } catch (cause) {
    throw new Error(`${label} identityStage violates the frozen IDENTITY contract`, { cause });
  }
};

const raceSelectionAt = (value: unknown, path: string): RaceAndMethodStage['race'] => {
  if (value === null) return null;
  const object = exactObject(value, path, ['value', 'consequences', 'choiceLockStatus']);
  const selected = enumAt(object['value'], `${path}.value`, RACE_CHOICES);
  return {
    choiceLockStatus: literal(object['choiceLockStatus'], 'UNLOCKED', `${path}.choiceLockStatus`),
    consequences: literal(
      object['consequences'],
      RACE_CONSEQUENCES[selected],
      `${path}.consequences`,
    ),
    value: selected,
  };
};

const acquisitionSelectionAt = (
  value: unknown,
  path: string,
): RaceAndMethodStage['symbiontAcquisition'] => {
  const object = exactObject(value, path, ['value', 'consequences', 'choiceLockStatus']);
  if (object['value'] === null) {
    return {
      choiceLockStatus: enumAt(object['choiceLockStatus'], `${path}.choiceLockStatus`, [
        'UNLOCKED',
        'NOT_APPLICABLE',
      ] as const),
      consequences: literal(object['consequences'], null, `${path}.consequences`),
      value: null,
    };
  }
  const selected = enumAt(object['value'], `${path}.value`, SYMBIONT_ACQUISITION_MODES);
  return {
    choiceLockStatus: enumAt(object['choiceLockStatus'], `${path}.choiceLockStatus`, [
      'UNLOCKED',
      'LOCKED_AFTER_RESULT',
    ] as const),
    consequences: literal(
      object['consequences'],
      ACQUISITION_CONSEQUENCES[selected],
      `${path}.consequences`,
    ),
    value: selected,
  };
};

const diceSelectionAt = (value: unknown, path: string): RaceAndMethodStage['diceInput'] => {
  if (value === null) return null;
  const object = exactObject(value, path, ['value', 'choiceLockStatus']);
  return {
    choiceLockStatus: enumAt(object['choiceLockStatus'], `${path}.choiceLockStatus`, [
      'UNLOCKED',
      'LOCKED_AFTER_RESULT',
    ] as const),
    value: enumAt(object['value'], `${path}.value`, DICE_INPUT_MODES),
  };
};

const methodSelectionAt = (value: unknown, path: string): RaceAndMethodStage['statMethod'] => {
  if (value === null) return null;
  const object = exactObject(value, path, ['value', 'consequences', 'choiceLockStatus']);
  const selected = enumAt(object['value'], `${path}.value`, STAT_METHODS);
  return {
    choiceLockStatus: enumAt(object['choiceLockStatus'], `${path}.choiceLockStatus`, [
      'UNLOCKED',
      'LOCKED_AFTER_RESULT',
    ] as const),
    consequences: literal(
      object['consequences'],
      METHOD_CONSEQUENCES[selected],
      `${path}.consequences`,
    ),
    value: selected,
  };
};

const raceAndMethodStageAt = (value: unknown, label: string): RaceAndMethodStage => {
  const path = '$.raceAndMethodStage';
  const object = exactObject(value, path, [
    'race',
    'symbiontAcquisition',
    'diceInput',
    'statMethod',
    'decisionRecords',
  ]);
  const rawRecords = object['decisionRecords'];
  if (!Array.isArray(rawRecords)) {
    return invalidShape(`${path}.decisionRecords`, 'array', rawRecords);
  }
  if (rawRecords.length === 0) {
    return invalidShape(`${path}.decisionRecords`, 'non-empty array', rawRecords);
  }
  return {
    decisionRecords: rawRecords.map((record, index) =>
      decisionRecordAt(record, `${path}.decisionRecords[${String(index)}]`, label),
    ),
    diceInput: diceSelectionAt(object['diceInput'], `${path}.diceInput`),
    race: raceSelectionAt(object['race'], `${path}.race`),
    statMethod: methodSelectionAt(object['statMethod'], `${path}.statMethod`),
    symbiontAcquisition: acquisitionSelectionAt(
      object['symbiontAcquisition'],
      `${path}.symbiontAcquisition`,
    ),
  };
};

const incrementedRevisions = (revisions: RevisionVector): RevisionVector => {
  if (
    revisions.stateRevision === Number.MAX_SAFE_INTEGER ||
    revisions.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError('creation decision revision overflow');
  }
  return {
    actorVisibilityRevision: revisions.actorVisibilityRevision,
    projectionRevision: revisions.projectionRevision + 1,
    stateRevision: revisions.stateRevision + 1,
  };
};

const receiptResultForRequest = (
  request: CreationRaceMethodSetDecideCommandRequest,
  checkpointRevision: number,
  draftRevision: number,
  methodAllocation?: CreationStatRollAllocation,
): CreationRaceMethodSetDecideReceiptResult => {
  const { payload } = request;
  const common = {
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    characterDraftId: payload.characterDraftId,
    checkpointId: payload.wizardCheckpointId,
    checkpointOwnerId: payload.characterDraftId,
    checkpointRevision,
    draftRevision,
    stage: 'RACE_AND_METHOD' as const,
  };
  switch (payload.sourceFormId) {
    case 'CHR-010':
      return {
        ...common,
        nextFormId: payload.raceChoice === 'PURE' ? 'CHR-036' : 'CHR-016',
        raceChoice: payload.raceChoice,
        sourceFormId: payload.sourceFormId,
      };
    case 'CHR-016':
      return {
        ...common,
        nextFormId: 'CHR-036',
        sourceFormId: payload.sourceFormId,
        symbiontAcquisitionMode: payload.symbiontAcquisitionMode,
      };
    case 'CHR-036':
      return {
        ...common,
        diceInputMode: payload.diceInputMode,
        nextFormId: 'CHR-002',
        sourceFormId: payload.sourceFormId,
      };
    case 'CHR-002':
      if (methodAllocation === undefined) {
        throw new Error('CHR-002 method receipt requires its atomic branch/request allocation');
      }
      return {
        ...common,
        branchUuid: methodAllocation.branchUuid,
        nextFormId: 'CHR-003',
        setRollRequestId: methodAllocation.setRollRequestId,
        sourceFormId: payload.sourceFormId,
        statMethod: payload.statMethod,
      };
  }
};

const initialAcquisition = (raceChoice: RaceChoice): RaceAndMethodStage['symbiontAcquisition'] =>
  raceChoice === 'PURE'
    ? { choiceLockStatus: 'NOT_APPLICABLE', consequences: null, value: null }
    : { choiceLockStatus: 'UNLOCKED', consequences: null, value: null };

const postIdentityPayloadAt = (
  value: unknown,
  label: string,
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
): CreationWizardPostIdentityPayload => {
  try {
    const unshaped = objectAt(value, '$');
    const hasStatRollStage = Object.hasOwn(unshaped, 'statRollStage');
    const hasStatAssignmentStage = Object.hasOwn(unshaped, 'statAssignmentStage');
    const hasSkillEligibilityStage = Object.hasOwn(unshaped, 'skillEligibilityStage');
    const object = exactObject(
      value,
      '$',
      hasSkillEligibilityStage
        ? SKILL_PAYLOAD_KEYS
        : hasStatAssignmentStage
          ? STAT_ASSIGNMENT_PAYLOAD_KEYS
          : hasStatRollStage
            ? STAT_ROLL_PAYLOAD_KEYS
            : POST_IDENTITY_PAYLOAD_KEYS,
    );
    const branchCacheEntries = emptyArrayAt(object['branchCacheEntries'], '$.branchCacheEntries');
    const branchCacheHash = literal(
      object['branchCacheHash'],
      EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      '$.branchCacheHash',
    );
    const randomReceiptIds = hasStatRollStage
      ? stringArrayAt(object['randomReceiptIds'], '$.randomReceiptIds')
      : emptyArrayAt(object['randomReceiptIds'], '$.randomReceiptIds');
    const selectedBranchUuidOrNull = literal(
      object['selectedBranchUuidOrNull'],
      null,
      '$.selectedBranchUuidOrNull',
    );
    const identityStage = identityStageAt(
      object['identityStage'],
      label,
      localCharacter,
      checkpoint,
      {
        branchCacheEntries,
        branchCacheHash,
        randomReceiptIds,
        selectedBranchUuidOrNull,
      },
    );
    const receiptResult = objectAt(
      objectAt(object['receipt'], '$.receipt')['result'],
      '$.receipt.result',
    );
    const skillEligibilityStage = hasSkillEligibilityStage
      ? parseSkillEligibilityStage(object['skillEligibilityStage'], label)
      : null;
    const skillSelectionStage = hasSkillEligibilityStage
      ? parseSkillSelectionStage(object['skillSelectionStage'], label)
      : null;
    const receipt =
      receiptResult['stage'] === 'SKILLS'
        ? (skillSelectionStage?.receipt ??
          skillEligibilityStage?.receipt ??
          (() => {
            throw new Error(`${label} SKILLS payload lacks a skill stage receipt`);
          })())
        : receiptResult['stage'] === 'STAT_ASSIGNMENT'
          ? parseStatAssignmentReceipt(object['receipt'], label)
          : receiptResult['stage'] !== 'STAT_ROLLS'
            ? raceMethodReceiptAt(object['receipt'], '$.receipt')
            : receiptResult['sourceFormId'] === 'CHR-003' ||
                receiptResult['sourceFormId'] === 'CHR-004'
              ? creationRollReceiptAt(object['receipt'], '$.receipt')
              : statDecisionReceiptAt(object['receipt'], '$.receipt');
    const common = {
      branchCacheEntries,
      branchCacheHash,
      identityStage,
      nextStageEnvelope: nextStageEnvelopeAt(object['nextStageEnvelope'], '$.nextStageEnvelope'),
      raceAndMethodStage: raceAndMethodStageAt(object['raceAndMethodStage'], label),
      randomReceiptIds,
      receipt,
      selectedBranchUuidOrNull,
    };
    if (!hasStatRollStage) {
      if (receipt.result.stage !== 'RACE_AND_METHOD') {
        throw new Error(`${label} pre-roll payload cannot carry a STAT_ROLLS receipt`);
      }
      return common as CreationWizardPreRollPayload;
    }
    if (hasSkillEligibilityStage) {
      if (
        receipt.result.stage !== 'SKILLS' ||
        skillEligibilityStage === null ||
        !isDeepStrictEqual(receipt, skillSelectionStage?.receipt ?? skillEligibilityStage.receipt)
      ) {
        throw new Error(`${label} skill payload must carry its latest SKILLS receipt`);
      }
      return {
        ...common,
        nextStageEnvelope: common.nextStageEnvelope as CreationNextStageEnvelope<
          'CHR-013' | 'CHR-017'
        >,
        pureClassStage: parsePureClassStage(object['pureClassStage'], label),
        receipt,
        skillEligibilityStage,
        skillSelectionStage,
        statAssignmentStage: parseStatAssignmentStage(object['statAssignmentStage'], label),
        statRollStage: statRollStageAt(object['statRollStage'], label),
      } as CreationWizardSkillPayload;
    }
    if (hasStatAssignmentStage) {
      if (receipt.result.stage !== 'STAT_ASSIGNMENT') {
        throw new Error(`${label} assignment payload must carry a STAT_ASSIGNMENT receipt`);
      }
      return {
        ...common,
        nextStageEnvelope: common.nextStageEnvelope as CreationNextStageEnvelope<
          'CHR-011' | 'CHR-012'
        >,
        pureClassStage: parsePureClassStage(object['pureClassStage'], label),
        receipt,
        statAssignmentStage: parseStatAssignmentStage(object['statAssignmentStage'], label),
        statRollStage: statRollStageAt(object['statRollStage'], label),
      } as CreationWizardStatAssignmentPayload;
    }
    if ('decision' in receipt.result && receipt.result.decision === 'CANCEL') {
      throw new Error(`${label} durable payload cannot carry a transient CANCEL receipt`);
    }
    return {
      ...common,
      nextStageEnvelope: common.nextStageEnvelope as CreationNextStageEnvelope<
        'CHR-003' | 'CHR-004' | 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008' | 'CHR-009'
      >,
      receipt: receipt as CreationRollCommitReceipt | DurableCreationSetDecideReceipt,
      statRollStage: statRollStageAt(object['statRollStage'], label),
    };
  } catch (cause) {
    if (cause instanceof CreationSetDecideApplicationError) {
      throw new Error(`${label} payload violates the durable SET-DECIDE contract`, { cause });
    }
    throw cause;
  }
};

const mismatchError = (label: string, mismatches: readonly string[]): never => {
  throw new Error(
    `${label} durable character wizard checkpoint mismatch: ${mismatches.join(', ')}`,
  );
};

interface RollValidationCursor {
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly latestEnvelope: CreationNextStageEnvelope;
  readonly latestReceipt:
    | CreationRollCommitReceipt
    | DurableCreationSetDecideReceipt
    | StatAssignmentCheckpointReceipt
    | PureClassDecisionReceipt
    | SkillEligibilityCheckpointReceipt
    | SkillSelectionCheckpointReceipt;
  readonly latestRequest:
    | CreationRollCommitCommandRequest
    | DurableCreationSetDecideCommandRequest
    | StatAssignmentCheckpointCommandRequest
    | SkillCheckpointCommandRequest;
  readonly revisions: RevisionVector;
}

const d20Mechanical = (face: number): { readonly dieSides: 20; readonly rawFace: number } => ({
  dieSides: 20,
  rawFace: face,
});

const durablePostRevisions = (
  previous: RevisionVector,
  request: { readonly expectedRevisions: RevisionVector },
  label: string,
  mismatches: string[],
): RevisionVector => {
  const expected = request.expectedRevisions;
  if (
    expected.actorVisibilityRevision !== previous.actorVisibilityRevision ||
    expected.stateRevision !== previous.stateRevision ||
    expected.projectionRevision < previous.projectionRevision
  ) {
    mismatches.push(`${label} pre-commit revisions`);
  }
  try {
    return incrementedRevisions(expected);
  } catch {
    mismatches.push(`${label} entity revision overflow`);
    return previous;
  }
};

const exactDurablePostRevisions = (
  previous: RevisionVector,
  request: { readonly expectedRevisions: RevisionVector },
  label: string,
  mismatches: string[],
): RevisionVector => {
  if (!isDeepStrictEqual(request.expectedRevisions, previous)) {
    mismatches.push(`${label} pre-commit revisions`);
  }
  try {
    return incrementedRevisions(request.expectedRevisions);
  } catch {
    mismatches.push(`${label} entity revision overflow`);
    return previous;
  }
};

/** CHR-013 -> CHR-015 is a projection-only navigation between the two durable skill commits. */
const presentationAdvancedDurablePostRevisions = (
  previous: RevisionVector,
  request: { readonly expectedRevisions: RevisionVector },
  label: string,
  mismatches: string[],
): RevisionVector => {
  const expected = request.expectedRevisions;
  if (
    expected.actorVisibilityRevision !== previous.actorVisibilityRevision ||
    expected.stateRevision !== previous.stateRevision ||
    previous.projectionRevision === Number.MAX_SAFE_INTEGER ||
    expected.projectionRevision !== previous.projectionRevision + 1
  ) {
    mismatches.push(`${label} pre-commit revisions`);
  }
  try {
    return incrementedRevisions(expected);
  } catch {
    mismatches.push(`${label} entity revision overflow`);
    return previous;
  }
};

const validateStatRollHistory = (
  durablePayload: CreationWizardStatRollPayload,
  methodRecord: CreationSetDecideDecisionRecord,
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
  start: RollValidationCursor,
  commandIds: Set<string>,
  receiptIds: Set<string>,
  allocatedIds: Set<string>,
  mismatches: string[],
): RollValidationCursor => {
  const stage = durablePayload.statRollStage;
  const methodRequest = methodRecord.request;
  const methodReceipt = methodRecord.receipt;
  if (
    methodRequest.payload.sourceFormId !== 'CHR-002' ||
    methodReceipt.result.sourceFormId !== 'CHR-002'
  ) {
    mismatches.push('statRollStage without CHR-002 method record');
    return start;
  }
  if (stage.branchUuid !== methodReceipt.result.branchUuid) {
    mismatches.push('statRollStage branchUuid/method receipt');
  }
  if (stage.statMethod !== methodRequest.payload.statMethod) {
    mismatches.push('statRollStage statMethod/method request');
  }
  if (stage.diceInputModeSnapshot !== durablePayload.raceAndMethodStage.diceInput?.value) {
    mismatches.push('statRollStage diceInputModeSnapshot/decision');
  }
  if (allocatedIds.has(stage.branchUuid)) mismatches.push('statRollStage branchUuid ID collision');
  allocatedIds.add(stage.branchUuid);
  if (allocatedIds.has(methodReceipt.result.setRollRequestId)) {
    mismatches.push('statRollStage first setRollRequestId ID collision');
  }
  allocatedIds.add(methodReceipt.result.setRollRequestId);

  let cursor = start;
  let expectedSetRollRequestId = methodReceipt.result.setRollRequestId;
  let terminalReached = false;
  const expectedAttempts: StatRollAttempt[] = [];
  const expectedRandomReceiptIds: string[] = [];
  const seenSetRollRequestIds = new Set<string>();

  for (const [attemptOffset, attempt] of stage.attempts.entries()) {
    const attemptIndex = attemptOffset + 1;
    const attemptLabel = `attempts[${String(attemptOffset)}]`;
    if (terminalReached) mismatches.push(`${attemptLabel} tail after terminal assignment choice`);
    if (attempt.attemptIndex !== attemptIndex) mismatches.push(`${attemptLabel} ordered index`);
    if (attempt.setRollRequestId !== expectedSetRollRequestId) {
      mismatches.push(`${attemptLabel} setRollRequestId/previous destination`);
    }
    if (seenSetRollRequestIds.has(attempt.setRollRequestId)) {
      mismatches.push(`${attemptLabel} duplicate setRollRequestId`);
    }
    seenSetRollRequestIds.add(attempt.setRollRequestId);
    let decisionRule: CreationStatSetDecisionRule;
    try {
      decisionRule = deriveCreationStatSetDecisionRule(stage.statMethod, attemptIndex);
    } catch {
      mismatches.push(`${attemptLabel} exceeds method attempt domain`);
      break;
    }
    if (attempt.returnDecisionFormId !== decisionRule.decisionFormId) {
      mismatches.push(`${attemptLabel} returnDecisionFormId`);
    }

    const setRecord = attempt.setRecord;
    if (setRecord === null) {
      const expectedAttempt: StatRollAttempt = {
        attemptIndex,
        confirmationRecords: [],
        confirmationRollRequestIdOrNull: null,
        criticalQueueIndexOrNull: null,
        decisionRecordOrNull: null,
        naturalCriticalQueue: [],
        outcomes: [],
        returnDecisionFormId: decisionRule.decisionFormId,
        setRecord: null,
        setRollRequestId: expectedSetRollRequestId,
        state: 'REQUEST_READY',
      };
      expectedAttempts.push(expectedAttempt);
      if (!isDeepStrictEqual(attempt, expectedAttempt)) {
        mismatches.push(`${attemptLabel} request-ready aggregate`);
      }
      if (attemptOffset !== stage.attempts.length - 1) {
        mismatches.push(`${attemptLabel} request-ready attempt has a tail`);
      }
      continue;
    }

    const setRequest = setRecord.request;
    const setReceipt = setRecord.receipt;
    const setResult = setReceipt.result;
    if (commandIds.has(setRequest.commandId)) {
      mismatches.push(`${attemptLabel} setRecord duplicate commandId`);
    }
    commandIds.add(setRequest.commandId);
    if (allocatedIds.has(setRequest.commandId)) {
      mismatches.push(`${attemptLabel} setRecord command ID collision`);
    }
    allocatedIds.add(setRequest.commandId);
    if (receiptIds.has(setReceipt.receiptId)) {
      mismatches.push(`${attemptLabel} setRecord duplicate receiptId`);
    }
    receiptIds.add(setReceipt.receiptId);
    if (allocatedIds.has(setReceipt.receiptId)) {
      mismatches.push(`${attemptLabel} setRecord receipt ID collision`);
    }
    allocatedIds.add(setReceipt.receiptId);
    if (
      setRequest.payload.characterDraftId !== localCharacter.localCharacterId ||
      setRequest.payload.wizardCheckpointId !== checkpoint.checkpointId ||
      setRequest.payload.branchUuid !== stage.branchUuid ||
      setRequest.payload.setRollRequestId !== expectedSetRollRequestId
    ) {
      mismatches.push(`${attemptLabel} setRecord addressed request`);
    }
    if (setRequest.payload.draftRevision !== cursor.draftRevision) {
      mismatches.push(`${attemptLabel} setRecord pre-commit draftRevision`);
    }
    const postSetRevisions = durablePostRevisions(
      cursor.revisions,
      setRequest,
      `${attemptLabel} setRecord`,
      mismatches,
    );
    const manualFaces = setRequest.payload.manualFacesOrNull;
    if (
      stage.diceInputModeSnapshot === 'AUTO'
        ? manualFaces !== null
        : manualFaces === null || !isDeepStrictEqual(manualFaces, setResult.faces)
    ) {
      mismatches.push(`${attemptLabel} setRecord immutable input mode/manual faces`);
    }
    const resolvedSet = resolveCreationStatSet(setResult.faces.map(d20Mechanical));
    const expectedQueue = resolvedSet.naturalCriticalQueue.map(({ originFace, setEntryIndex }) => ({
      originFace,
      setEntryIndex,
    }));
    const initialConfirmationRequest = setResult.confirmationRollRequestIdOrNull;
    if ((expectedQueue.length === 0) !== (initialConfirmationRequest === null)) {
      mismatches.push(`${attemptLabel} setRecord initial confirmation request presence`);
    }
    if (initialConfirmationRequest !== null && allocatedIds.has(initialConfirmationRequest)) {
      mismatches.push(`${attemptLabel} setRecord confirmation request ID collision`);
    }
    if (initialConfirmationRequest !== null) allocatedIds.add(initialConfirmationRequest);
    const setDestination = expectedQueue.length === 0 ? decisionRule.decisionFormId : 'CHR-004';
    const expectedSetResult: StatSetRollReceiptResult = {
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      branchUuid: stage.branchUuid,
      characterDraftId: localCharacter.localCharacterId,
      checkpointId: checkpoint.checkpointId,
      checkpointOwnerId: localCharacter.localCharacterId,
      checkpointRevision: cursor.checkpointRevision + 1,
      confirmationRollRequestIdOrNull: initialConfirmationRequest,
      diceInputModeSnapshot: stage.diceInputModeSnapshot,
      draftRevision: cursor.draftRevision + 1,
      faces: setResult.faces,
      naturalCriticalQueue: expectedQueue,
      nextFormId: setDestination,
      setRollReceiptId: setReceipt.receiptId,
      setRollRequestId: expectedSetRollRequestId,
      shownResultLocked: true,
      sourceFormId: 'CHR-003',
      stage: 'STAT_ROLLS',
    };
    if (setReceipt.commandId !== setRequest.commandId) {
      mismatches.push(`${attemptLabel} setRecord request/receipt commandId`);
    }
    if (!isDeepStrictEqual(setResult, expectedSetResult)) {
      mismatches.push(`${attemptLabel} setRecord receipt result`);
    }
    if (!isDeepStrictEqual(setReceipt.revisions, postSetRevisions)) {
      mismatches.push(`${attemptLabel} setRecord receipt revisions`);
    }
    const expectedSetEnvelope = nextStageEnvelope(setDestination, localCharacter.localCharacterId);
    if (!isDeepStrictEqual(setRecord.nextStageEnvelope, expectedSetEnvelope)) {
      mismatches.push(`${attemptLabel} setRecord signed destination`);
    }
    if (stage.diceInputModeSnapshot === 'AUTO') expectedRandomReceiptIds.push(setReceipt.receiptId);
    cursor = {
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      latestEnvelope: setRecord.nextStageEnvelope,
      latestReceipt: setReceipt,
      latestRequest: setRequest,
      revisions: postSetRevisions,
    };

    let queueIndex = expectedQueue.length === 0 ? null : 0;
    let pendingRequestId = initialConfirmationRequest;
    let chain: CreationStatCriticalChainState | null =
      queueIndex === null ? null : createCreationCriticalChain(expectedQueue[queueIndex]!);
    const outcomes: CreationCriticalOutcome[] = [];

    for (const [recordIndex, record] of attempt.confirmationRecords.entries()) {
      const recordLabel = `${attemptLabel}.confirmationRecords[${String(recordIndex)}]`;
      const request = record.request;
      const receipt = record.receipt;
      const result = receipt.result;
      if (queueIndex === null || chain === null || pendingRequestId === null) {
        mismatches.push(`${recordLabel} confirmation tail after completed queue`);
        break;
      }
      const queueItem = expectedQueue[queueIndex]!;
      if (commandIds.has(request.commandId)) mismatches.push(`${recordLabel} duplicate commandId`);
      commandIds.add(request.commandId);
      if (allocatedIds.has(request.commandId))
        mismatches.push(`${recordLabel} command ID collision`);
      allocatedIds.add(request.commandId);
      if (receiptIds.has(receipt.receiptId)) mismatches.push(`${recordLabel} duplicate receiptId`);
      receiptIds.add(receipt.receiptId);
      if (allocatedIds.has(receipt.receiptId))
        mismatches.push(`${recordLabel} receipt ID collision`);
      allocatedIds.add(receipt.receiptId);
      if (
        request.payload.characterDraftId !== localCharacter.localCharacterId ||
        request.payload.wizardCheckpointId !== checkpoint.checkpointId ||
        request.payload.branchUuid !== stage.branchUuid ||
        request.payload.setRollReceiptId !== setReceipt.receiptId ||
        request.payload.criticalQueueIndex !== queueIndex ||
        request.payload.confirmationRollRequestId !== pendingRequestId
      ) {
        mismatches.push(`${recordLabel} addressed request`);
      }
      if (request.payload.draftRevision !== cursor.draftRevision) {
        mismatches.push(`${recordLabel} pre-commit draftRevision`);
      }
      const postRevisions = durablePostRevisions(
        cursor.revisions,
        request,
        recordLabel,
        mismatches,
      );
      if (
        stage.diceInputModeSnapshot === 'AUTO'
          ? request.payload.manualFaceOrNull !== null
          : request.payload.manualFaceOrNull !== result.confirmationFace
      ) {
        mismatches.push(`${recordLabel} immutable input mode/manual face`);
      }
      const nextChain = commitCreationCriticalConfirmation(
        chain,
        d20Mechanical(result.confirmationFace),
      );
      const outcome: CreationCriticalOutcome | null =
        nextChain.status === 'TERMINAL'
          ? {
              creationCriticalPenaltyOrNull: nextChain.outcome.creationCriticalPenaltyOrNull,
              criticalGrade: nextChain.outcome.criticalGrade,
              criticalPolarity: nextChain.outcome.criticalPolarity,
              setEntryIndex: nextChain.outcome.setEntryIndex,
              value: nextChain.outcome.value,
            }
          : null;
      if (outcome !== null) outcomes.push(outcome);
      const nextQueueIndex =
        outcome === null
          ? queueIndex
          : queueIndex + 1 < expectedQueue.length
            ? queueIndex + 1
            : null;
      const nextRequestId = result.nextConfirmationRollRequestIdOrNull;
      if ((nextQueueIndex === null) !== (nextRequestId === null)) {
        mismatches.push(`${recordLabel} next confirmation request presence`);
      }
      if (nextRequestId !== null && allocatedIds.has(nextRequestId)) {
        mismatches.push(`${recordLabel} next request ID collision`);
      }
      if (nextRequestId !== null) allocatedIds.add(nextRequestId);
      const destination = nextQueueIndex === null ? decisionRule.decisionFormId : 'CHR-004';
      const expectedResult: CriticalConfirmationRollReceiptResult = {
        branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
        branchUuid: stage.branchUuid,
        characterDraftId: localCharacter.localCharacterId,
        checkpointId: checkpoint.checkpointId,
        checkpointOwnerId: localCharacter.localCharacterId,
        checkpointRevision: cursor.checkpointRevision + 1,
        confirmationFace: result.confirmationFace,
        confirmationReceiptId: receipt.receiptId,
        confirmationRollRequestId: pendingRequestId,
        criticalQueueIndex: queueIndex,
        draftRevision: cursor.draftRevision + 1,
        nextConfirmationRollRequestIdOrNull: nextRequestId,
        nextFormId: destination,
        originFace: queueItem.originFace,
        outcomeOrNull: outcome,
        returnDecisionFormId: decisionRule.decisionFormId,
        setRollReceiptId: setReceipt.receiptId,
        sourceFormId: 'CHR-004',
        stage: 'STAT_ROLLS',
      };
      if (receipt.commandId !== request.commandId) {
        mismatches.push(`${recordLabel} request/receipt commandId`);
      }
      if (!isDeepStrictEqual(result, expectedResult))
        mismatches.push(`${recordLabel} receipt result`);
      if (!isDeepStrictEqual(receipt.revisions, postRevisions)) {
        mismatches.push(`${recordLabel} receipt revisions`);
      }
      const expectedEnvelope = nextStageEnvelope(destination, localCharacter.localCharacterId);
      if (!isDeepStrictEqual(record.nextStageEnvelope, expectedEnvelope)) {
        mismatches.push(`${recordLabel} signed destination`);
      }
      if (stage.diceInputModeSnapshot === 'AUTO') expectedRandomReceiptIds.push(receipt.receiptId);
      cursor = {
        checkpointRevision: cursor.checkpointRevision + 1,
        draftRevision: cursor.draftRevision + 1,
        latestEnvelope: record.nextStageEnvelope,
        latestReceipt: receipt,
        latestRequest: request,
        revisions: postRevisions,
      };
      queueIndex = nextQueueIndex;
      pendingRequestId = nextRequestId;
      chain =
        nextQueueIndex === null
          ? null
          : outcome === null
            ? nextChain
            : createCreationCriticalChain(expectedQueue[nextQueueIndex]!);
    }

    const rolledState: StatRollStageState =
      expectedQueue.length === 0
        ? 'DECISION_READY'
        : queueIndex === null
          ? 'CHAIN_COMPLETE'
          : 'CRITICALS_PENDING';
    let expectedState: StatRollStageState = rolledState;
    let expectedDecision: CreationStatRollDecisionRecord | null = null;
    const decisionRecord = attempt.decisionRecordOrNull;
    if (decisionRecord !== null) {
      const request = decisionRecord.request;
      const receipt = decisionRecord.receipt;
      const result = receipt.result;
      const recordLabel = `${attemptLabel}.decisionRecordOrNull`;
      if (rolledState !== 'DECISION_READY' && rolledState !== 'CHAIN_COMPLETE') {
        mismatches.push(`${recordLabel} decision before terminal roll`);
      }
      if (commandIds.has(request.commandId)) mismatches.push(`${recordLabel} duplicate commandId`);
      commandIds.add(request.commandId);
      if (allocatedIds.has(request.commandId))
        mismatches.push(`${recordLabel} command ID collision`);
      allocatedIds.add(request.commandId);
      if (receiptIds.has(receipt.receiptId)) mismatches.push(`${recordLabel} duplicate receiptId`);
      receiptIds.add(receipt.receiptId);
      if (allocatedIds.has(receipt.receiptId))
        mismatches.push(`${recordLabel} receipt ID collision`);
      allocatedIds.add(receipt.receiptId);
      if (
        request.payload.characterDraftId !== localCharacter.localCharacterId ||
        request.payload.wizardCheckpointId !== checkpoint.checkpointId ||
        request.payload.draftRevision !== cursor.draftRevision
      ) {
        mismatches.push(`${recordLabel} addressed request`);
      }
      const postRevisions = durablePostRevisions(
        cursor.revisions,
        request,
        recordLabel,
        mismatches,
      );
      if (receipt.commandId !== request.commandId) {
        mismatches.push(`${recordLabel} request/receipt commandId`);
      }
      if (request.payload.decision === 'ACCEPT_SET') {
        const derived: CreationSetAcceptanceDerived = {
          acceptedSetReceiptId: setReceipt.receiptId,
          assignmentMode: 'ROLLED_BIJECTION',
          decision: 'ACCEPT_SET',
        };
        const expectedResult: CreationSetAcceptanceReceiptResult = {
          branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
          branchUuid: stage.branchUuid,
          characterDraftId: localCharacter.localCharacterId,
          checkpointId: checkpoint.checkpointId,
          checkpointOwnerId: localCharacter.localCharacterId,
          checkpointRevision: cursor.checkpointRevision + 1,
          draftRevision: cursor.draftRevision + 1,
          acceptedSetReceiptId: setReceipt.receiptId,
          assignmentMode: 'ROLLED_BIJECTION',
          decision: 'ACCEPT_SET',
          nextFormId: 'CHR-009',
          sourceFormId: decisionRule.decisionFormId,
          stage: 'STAT_ROLLS',
        };
        const envelope = nextStageEnvelope('CHR-009', localCharacter.localCharacterId);
        expectedDecision = {
          derived,
          nextStageEnvelope: envelope,
          receipt: receipt as CommandReceipt<CreationSetAcceptanceReceiptResult>,
          request: request as CreationSetAcceptanceDecisionRecord['request'],
        };
        if (request.payload.sourceFormId !== decisionRule.decisionFormId) {
          mismatches.push(`${recordLabel} acceptance source form`);
        }
        if (!isDeepStrictEqual(result, expectedResult))
          mismatches.push(`${recordLabel} receipt result`);
        if (!isDeepStrictEqual(decisionRecord.derived, derived)) {
          mismatches.push(`${recordLabel} derived values`);
        }
        if (!isDeepStrictEqual(decisionRecord.nextStageEnvelope, envelope)) {
          mismatches.push(`${recordLabel} signed destination`);
        }
        expectedState = 'SET_ACCEPTED';
        terminalReached = true;
      } else {
        const abandonment = deriveCreationStatAbandonment(stage.statMethod, attemptIndex);
        const abandonmentResult = result as CreationSetAbandonmentReceiptResult;
        const nextSetRollRequestId = abandonmentResult.nextSetRollRequestIdOrNull;
        if ((abandonment.nextFormId === 'CHR-003') !== (nextSetRollRequestId !== null)) {
          mismatches.push(`${recordLabel} next set request presence`);
        }
        if (nextSetRollRequestId !== null) {
          if (allocatedIds.has(nextSetRollRequestId)) {
            mismatches.push(`${recordLabel} next set request ID collision`);
          }
          allocatedIds.add(nextSetRollRequestId);
          expectedSetRollRequestId = nextSetRollRequestId;
        }
        const consequences: CreationSetAbandonmentConsequences = {
          ...abandonment.consequences,
        };
        const derived: CreationSetAbandonmentDerived = {
          abandonedSetReceiptIds: [setReceipt.receiptId],
          decision: abandonment.alternateDecision,
          destinationFormId: abandonment.nextFormId,
          irreversibleConsequences: consequences,
          originDecisionFormId: decisionRule.decisionFormId,
          transitionKind: abandonment.transitionKind,
        };
        const expectedResult: CreationSetAbandonmentReceiptResult = {
          abandonedSetReceiptIds: [setReceipt.receiptId],
          alternateDecision: abandonment.alternateDecision,
          assignmentModeOrNull: abandonment.statAssignmentModeOrNull,
          branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
          branchUuid: stage.branchUuid,
          characterDraftId: localCharacter.localCharacterId,
          checkpointId: checkpoint.checkpointId,
          checkpointOwnerId: localCharacter.localCharacterId,
          checkpointRevision: cursor.checkpointRevision + 1,
          decision: 'CONFIRM',
          draftRevision: cursor.draftRevision + 1,
          irreversibleConsequences: consequences,
          nextAttemptIndexOrNull: abandonment.consequences.nextAttemptIndexOrNull,
          nextFormId: abandonment.nextFormId,
          nextSetRollRequestIdOrNull: nextSetRollRequestId,
          originDecisionFormId: decisionRule.decisionFormId,
          sourceFormId: 'CHR-028',
          sourceSetReceiptIdOrNull: null,
          stage: 'STAT_ROLLS',
          transitionKind: abandonment.transitionKind,
        };
        const envelope = nextStageEnvelope(abandonment.nextFormId, localCharacter.localCharacterId);
        expectedDecision = {
          derived,
          nextStageEnvelope: envelope,
          receipt: receipt as CommandReceipt<CreationSetAbandonmentReceiptResult>,
          request: request as CreationSetAbandonmentDecisionRecord['request'],
        };
        if (request.payload.sourceFormId !== 'CHR-028' || request.payload.decision !== 'CONFIRM') {
          mismatches.push(`${recordLabel} abandonment request`);
        }
        if (!isDeepStrictEqual(result, expectedResult))
          mismatches.push(`${recordLabel} receipt result`);
        if (!isDeepStrictEqual(decisionRecord.derived, derived)) {
          mismatches.push(`${recordLabel} derived values`);
        }
        if (!isDeepStrictEqual(decisionRecord.nextStageEnvelope, envelope)) {
          mismatches.push(`${recordLabel} signed destination`);
        }
        expectedState = 'SET_ABANDONED';
        terminalReached = abandonment.nextFormId === 'CHR-009';
      }
      if (!isDeepStrictEqual(receipt.revisions, postRevisions)) {
        mismatches.push(`${recordLabel} receipt revisions`);
      }
      cursor = {
        checkpointRevision: cursor.checkpointRevision + 1,
        draftRevision: cursor.draftRevision + 1,
        latestEnvelope: decisionRecord.nextStageEnvelope,
        latestReceipt: receipt,
        latestRequest: request,
        revisions: postRevisions,
      };
    }

    const expectedAttempt: StatRollAttempt = {
      attemptIndex,
      confirmationRecords: attempt.confirmationRecords,
      confirmationRollRequestIdOrNull: pendingRequestId,
      criticalQueueIndexOrNull:
        rolledState === 'CHAIN_COMPLETE' ? expectedQueue.length - 1 : queueIndex,
      decisionRecordOrNull: expectedDecision,
      naturalCriticalQueue: expectedQueue,
      outcomes,
      returnDecisionFormId: decisionRule.decisionFormId,
      setRecord,
      setRollRequestId: attempt.setRollRequestId,
      state: expectedState,
    };
    expectedAttempts.push(expectedAttempt);
    if (!isDeepStrictEqual(attempt, expectedAttempt)) {
      mismatches.push(`${attemptLabel} aggregate`);
    }
    if (attemptOffset < stage.attempts.length - 1 && expectedState !== 'SET_ABANDONED') {
      mismatches.push(`${attemptLabel} non-last attempt lacks committed abandonment`);
    }
  }

  const lastAttempt = expectedAttempts.at(-1);
  if (lastAttempt?.state === 'SET_ABANDONED' && !terminalReached) {
    mismatches.push(
      'statRollStage confirmed next-attempt abandonment lacks atomic appended attempt',
    );
  }
  const expectedCurrentAttemptIndexOrNull =
    lastAttempt?.state === 'SET_ABANDONED' && terminalReached
      ? null
      : (lastAttempt?.attemptIndex ?? null);
  const expectedStage: StatRollStage = {
    attempts: expectedAttempts,
    branchUuid: methodReceipt.result.branchUuid,
    currentAttemptIndexOrNull: expectedCurrentAttemptIndexOrNull,
    diceInputModeSnapshot: durablePayload.raceAndMethodStage.diceInput!.value,
    statMethod: methodRequest.payload.statMethod,
  };
  if (!isDeepStrictEqual(stage, expectedStage)) mismatches.push('statRollStage aggregate');
  if (!isDeepStrictEqual(durablePayload.randomReceiptIds, expectedRandomReceiptIds)) {
    mismatches.push('randomReceiptIds roll provenance');
  }
  return cursor;
};

const assignmentCheckpointAtCursor = (
  durablePayload: CreationWizardStatAssignmentPayload,
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
  identityStage: CreationIdentityStage,
  raceAndMethodStage: RaceAndMethodStage,
  statRollStage: StatRollStage,
  cursor: RollValidationCursor,
  statAssignmentStage: StatAssignmentStage | null,
  pureClassStage: PureClassStage | null,
): DurableCreationWizardCheckpoint => ({
  checkpoint,
  durablePayload,
  identityStage,
  localCharacter,
  nextStageEnvelope: cursor.latestEnvelope,
  pureClassStage,
  raceAndMethodStage,
  receipt: cursor.latestReceipt,
  request: cursor.latestRequest,
  skillEligibilityStage: null,
  skillSelectionStage: null,
  statAssignmentStage,
  statRollStage,
});

const validateStatAssignmentHistory = (
  durablePayload: CreationWizardStatAssignmentPayload,
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
  identityStage: CreationIdentityStage,
  raceAndMethodStage: RaceAndMethodStage,
  cursorStart: RollValidationCursor,
  commandIds: Set<string>,
  receiptIds: Set<string>,
  occupied: Set<string>,
  catalog: SkillStageCatalog,
  mismatches: string[],
): RollValidationCursor => {
  const statRollStage = durablePayload.statRollStage;
  const assignment = durablePayload.statAssignmentStage;
  const request = assignment.request;
  const receipt = assignment.receipt;
  const label = 'statAssignmentStage';
  if (
    request.payload.characterDraftId !== localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== checkpoint.checkpointId ||
    request.payload.draftRevision !== cursorStart.draftRevision
  ) {
    mismatches.push(`${label} addressed request`);
  }
  if (occupied.has(request.commandId)) mismatches.push(`${label} command ID collision`);
  occupied.add(request.commandId);
  commandIds.add(request.commandId);
  if (occupied.has(receipt.receiptId)) mismatches.push(`${label} receipt ID collision`);
  occupied.add(receipt.receiptId);
  receiptIds.add(receipt.receiptId);
  const postRevisions = exactDurablePostRevisions(
    cursorStart.revisions,
    request,
    label,
    mismatches,
  );
  const preAssignment = assignmentCheckpointAtCursor(
    durablePayload,
    localCharacter,
    checkpoint,
    identityStage,
    raceAndMethodStage,
    statRollStage,
    cursorStart,
    null,
    null,
  );
  let plan;
  try {
    plan = prepareStatAssignment(preAssignment, request, catalog);
  } catch {
    mismatches.push(`${label} source/domain derivation`);
    return cursorStart;
  }
  const envelope = nextStageEnvelope(plan.nextFormId, localCharacter.localCharacterId);
  const expectedResult: StatAssignmentCheckpointReceipt['result'] = {
    ...plan.derived,
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    branchUuid: statRollStage.branchUuid,
    characterDraftId: localCharacter.localCharacterId,
    checkpointId: checkpoint.checkpointId,
    checkpointOwnerId: localCharacter.localCharacterId,
    checkpointRevision: cursorStart.checkpointRevision + 1,
    draftRevision: cursorStart.draftRevision + 1,
    nextFormId: plan.nextFormId,
    sourceFormId: 'CHR-009',
    stage: 'STAT_ASSIGNMENT',
  };
  if (receipt.commandId !== request.commandId)
    mismatches.push(`${label} request/receipt commandId`);
  if (!isDeepStrictEqual(receipt.result, expectedResult))
    mismatches.push(`${label} receipt result`);
  if (!isDeepStrictEqual(receipt.revisions, postRevisions)) {
    mismatches.push(`${label} receipt revisions`);
  }
  if (!isDeepStrictEqual(assignment.derived, plan.derived)) mismatches.push(`${label} derived`);
  if (!isDeepStrictEqual(assignment.nextStageEnvelope, envelope)) {
    mismatches.push(`${label} signed destination`);
  }
  let cursor: RollValidationCursor = {
    checkpointRevision: cursorStart.checkpointRevision + 1,
    draftRevision: cursorStart.draftRevision + 1,
    latestEnvelope: assignment.nextStageEnvelope,
    latestReceipt: receipt,
    latestRequest: request,
    revisions: postRevisions,
  };
  const pureClass = durablePayload.pureClassStage;
  if (pureClass === null) {
    if (plan.nextFormId === 'CHR-011' && durablePayload.nextStageEnvelope.formId !== 'CHR-011') {
      mismatches.push('required pureClassStage is absent past CHR-011');
    }
  } else {
    const classRequest = pureClass.request;
    const classReceipt = pureClass.receipt;
    const classLabel = 'pureClassStage';
    if (
      plan.nextFormId !== 'CHR-011' ||
      classRequest.payload.characterDraftId !== localCharacter.localCharacterId ||
      classRequest.payload.wizardCheckpointId !== checkpoint.checkpointId ||
      classRequest.payload.draftRevision !== cursor.draftRevision
    ) {
      mismatches.push(`${classLabel} addressed request`);
    }
    if (occupied.has(classRequest.commandId)) mismatches.push(`${classLabel} command ID collision`);
    occupied.add(classRequest.commandId);
    commandIds.add(classRequest.commandId);
    if (occupied.has(classReceipt.receiptId)) mismatches.push(`${classLabel} receipt ID collision`);
    occupied.add(classReceipt.receiptId);
    receiptIds.add(classReceipt.receiptId);
    const classPostRevisions = exactDurablePostRevisions(
      cursor.revisions,
      classRequest,
      classLabel,
      mismatches,
    );
    const preClass = assignmentCheckpointAtCursor(
      durablePayload,
      localCharacter,
      checkpoint,
      identityStage,
      raceAndMethodStage,
      statRollStage,
      cursor,
      assignment,
      null,
    );
    let derived;
    try {
      derived = preparePureClassDecision(preClass, classRequest, catalog);
    } catch {
      mismatches.push(`${classLabel} catalog derivation`);
      return cursor;
    }
    const classEnvelope = nextStageEnvelope('CHR-012', localCharacter.localCharacterId);
    const expectedClassResult: PureClassDecisionReceipt['result'] = {
      ...derived,
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      branchUuid: statRollStage.branchUuid,
      characterDraftId: localCharacter.localCharacterId,
      checkpointId: checkpoint.checkpointId,
      checkpointOwnerId: localCharacter.localCharacterId,
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      nextFormId: 'CHR-012',
      sourceFormId: 'CHR-011',
      stage: 'STAT_ASSIGNMENT',
    };
    if (classReceipt.commandId !== classRequest.commandId) {
      mismatches.push(`${classLabel} request/receipt commandId`);
    }
    if (!isDeepStrictEqual(classReceipt.result, expectedClassResult)) {
      mismatches.push(`${classLabel} receipt result`);
    }
    if (!isDeepStrictEqual(classReceipt.revisions, classPostRevisions)) {
      mismatches.push(`${classLabel} receipt revisions`);
    }
    if (!isDeepStrictEqual(pureClass.derived, derived)) mismatches.push(`${classLabel} derived`);
    if (!isDeepStrictEqual(pureClass.nextStageEnvelope, classEnvelope)) {
      mismatches.push(`${classLabel} signed destination`);
    }
    cursor = {
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      latestEnvelope: pureClass.nextStageEnvelope,
      latestReceipt: classReceipt,
      latestRequest: classRequest,
      revisions: classPostRevisions,
    };
  }
  if (cursor.latestEnvelope.formId === 'CHR-012') {
    try {
      deriveChr012StatsView(
        assignmentCheckpointAtCursor(
          durablePayload,
          localCharacter,
          checkpoint,
          identityStage,
          raceAndMethodStage,
          statRollStage,
          cursor,
          assignment,
          pureClass,
        ),
        catalog,
      );
    } catch {
      mismatches.push('CHR-012 derived projection');
    }
  }
  return cursor;
};

const skillCheckpointAtCursor = (
  durablePayload: CreationWizardSkillPayload,
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
  identityStage: CreationIdentityStage,
  raceAndMethodStage: RaceAndMethodStage,
  statRollStage: StatRollStage,
  statAssignmentStage: StatAssignmentStage,
  pureClassStage: PureClassStage | null,
  cursor: RollValidationCursor,
  skillEligibilityStage: SkillEligibilityStage | null,
  skillSelectionStage: SkillSelectionStage | null,
): DurableCreationWizardCheckpoint => ({
  checkpoint,
  durablePayload,
  identityStage,
  localCharacter,
  nextStageEnvelope: cursor.latestEnvelope,
  pureClassStage,
  raceAndMethodStage,
  receipt: cursor.latestReceipt,
  request: cursor.latestRequest,
  skillEligibilityStage,
  skillSelectionStage,
  statAssignmentStage,
  statRollStage,
});

const validateSkillHistory = (
  durablePayload: CreationWizardSkillPayload,
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
  identityStage: CreationIdentityStage,
  raceAndMethodStage: RaceAndMethodStage,
  statRollStage: StatRollStage,
  statAssignmentStage: StatAssignmentStage,
  pureClassStage: PureClassStage | null,
  cursorStart: RollValidationCursor,
  commandIds: Set<string>,
  receiptIds: Set<string>,
  occupied: Set<string>,
  catalog: SkillStageCatalog,
  mismatches: string[],
): RollValidationCursor => {
  const eligibility = durablePayload.skillEligibilityStage;
  const request = eligibility.request;
  const receipt = eligibility.receipt;
  const label = 'skillEligibilityStage';
  if (
    request.payload.characterDraftId !== localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== checkpoint.checkpointId ||
    request.payload.draftRevision !== cursorStart.draftRevision ||
    request.payload.sourceFormId !== 'CHR-012'
  ) {
    mismatches.push(`${label} addressed request`);
  }
  if (occupied.has(request.commandId)) mismatches.push(`${label} command ID collision`);
  occupied.add(request.commandId);
  commandIds.add(request.commandId);
  if (occupied.has(receipt.receiptId)) mismatches.push(`${label} receipt ID collision`);
  occupied.add(receipt.receiptId);
  receiptIds.add(receipt.receiptId);
  const postRevisions = exactDurablePostRevisions(
    cursorStart.revisions,
    request,
    label,
    mismatches,
  );
  const preEligibility = skillCheckpointAtCursor(
    durablePayload,
    localCharacter,
    checkpoint,
    identityStage,
    raceAndMethodStage,
    statRollStage,
    statAssignmentStage,
    pureClassStage,
    cursorStart,
    null,
    null,
  );
  let plan;
  try {
    plan = prepareSkillEligibility(preEligibility, request, catalog);
  } catch {
    mismatches.push(`${label} source/domain derivation`);
    return cursorStart;
  }
  const envelope = nextStageEnvelope('CHR-013', localCharacter.localCharacterId);
  const expectedResult: SkillEligibilityCheckpointReceipt['result'] = {
    ...plan.derived,
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    branchUuid: statRollStage.branchUuid,
    characterDraftId: localCharacter.localCharacterId,
    checkpointId: checkpoint.checkpointId,
    checkpointOwnerId: localCharacter.localCharacterId,
    checkpointRevision: cursorStart.checkpointRevision + 1,
    draftRevision: cursorStart.draftRevision + 1,
    nextFormId: 'CHR-013',
    sourceFormId: 'CHR-012',
    stage: 'SKILLS',
  };
  if (receipt.commandId !== request.commandId)
    mismatches.push(`${label} request/receipt commandId`);
  if (!isDeepStrictEqual(receipt.result, expectedResult))
    mismatches.push(`${label} receipt result`);
  if (!isDeepStrictEqual(receipt.revisions, postRevisions)) {
    mismatches.push(`${label} receipt revisions`);
  }
  if (!isDeepStrictEqual(eligibility.derived, plan.derived)) mismatches.push(`${label} derived`);
  if (!isDeepStrictEqual(eligibility.nextStageEnvelope, envelope)) {
    mismatches.push(`${label} signed destination`);
  }
  let cursor: RollValidationCursor = {
    checkpointRevision: cursorStart.checkpointRevision + 1,
    draftRevision: cursorStart.draftRevision + 1,
    latestEnvelope: eligibility.nextStageEnvelope,
    latestReceipt: receipt,
    latestRequest: request,
    revisions: postRevisions,
  };

  const selection = durablePayload.skillSelectionStage;
  if (selection === null) return cursor;
  const selectionRequest = selection.request;
  const selectionReceipt = selection.receipt;
  const selectionLabel = 'skillSelectionStage';
  if (
    selectionRequest.payload.characterDraftId !== localCharacter.localCharacterId ||
    selectionRequest.payload.wizardCheckpointId !== checkpoint.checkpointId ||
    selectionRequest.payload.draftRevision !== cursor.draftRevision ||
    selectionRequest.payload.sourceFormId !== 'CHR-015'
  ) {
    mismatches.push(`${selectionLabel} addressed request`);
  }
  if (occupied.has(selectionRequest.commandId)) {
    mismatches.push(`${selectionLabel} command ID collision`);
  }
  occupied.add(selectionRequest.commandId);
  commandIds.add(selectionRequest.commandId);
  if (occupied.has(selectionReceipt.receiptId)) {
    mismatches.push(`${selectionLabel} receipt ID collision`);
  }
  occupied.add(selectionReceipt.receiptId);
  receiptIds.add(selectionReceipt.receiptId);
  const selectionPostRevisions = presentationAdvancedDurablePostRevisions(
    cursor.revisions,
    selectionRequest,
    selectionLabel,
    mismatches,
  );
  const preSelection = skillCheckpointAtCursor(
    durablePayload,
    localCharacter,
    checkpoint,
    identityStage,
    raceAndMethodStage,
    statRollStage,
    statAssignmentStage,
    pureClassStage,
    cursor,
    eligibility,
    null,
  );
  let selectionPlan;
  try {
    selectionPlan = prepareSkillSelection(preSelection, selectionRequest, catalog);
  } catch {
    mismatches.push(`${selectionLabel} source/domain derivation`);
    return cursor;
  }
  const selectionEnvelope = nextStageEnvelope('CHR-017', localCharacter.localCharacterId);
  const expectedSelectionResult: SkillSelectionCheckpointReceipt['result'] = {
    ...selectionPlan.derived,
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    branchUuid: statRollStage.branchUuid,
    characterDraftId: localCharacter.localCharacterId,
    checkpointId: checkpoint.checkpointId,
    checkpointOwnerId: localCharacter.localCharacterId,
    checkpointRevision: cursor.checkpointRevision + 1,
    draftRevision: cursor.draftRevision + 1,
    nextFormId: 'CHR-017',
    sourceFormId: 'CHR-015',
    stage: 'SKILLS',
  };
  if (selectionReceipt.commandId !== selectionRequest.commandId) {
    mismatches.push(`${selectionLabel} request/receipt commandId`);
  }
  if (!isDeepStrictEqual(selectionReceipt.result, expectedSelectionResult)) {
    mismatches.push(`${selectionLabel} receipt result`);
  }
  if (!isDeepStrictEqual(selectionReceipt.revisions, selectionPostRevisions)) {
    mismatches.push(`${selectionLabel} receipt revisions`);
  }
  if (!isDeepStrictEqual(selection.derived, selectionPlan.derived)) {
    mismatches.push(`${selectionLabel} derived`);
  }
  if (!isDeepStrictEqual(selection.nextStageEnvelope, selectionEnvelope)) {
    mismatches.push(`${selectionLabel} signed destination`);
  }
  cursor = {
    checkpointRevision: cursor.checkpointRevision + 1,
    draftRevision: cursor.draftRevision + 1,
    latestEnvelope: selection.nextStageEnvelope,
    latestReceipt: selectionReceipt,
    latestRequest: selectionRequest,
    revisions: selectionPostRevisions,
  };
  return cursor;
};

const validatePostIdentityPayload = (
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
  durablePayload: CreationWizardPostIdentityPayload,
  catalog?: SkillStageCatalog,
): DurableCreationWizardCheckpoint => {
  const label = `localCharacter ${JSON.stringify(localCharacter.localCharacterId)}`;
  const mismatches: string[] = [];
  const { identityStage, raceAndMethodStage } = durablePayload;
  const records = raceAndMethodStage.decisionRecords;
  const commandIds = new Set<string>([identityStage.request.commandId]);
  const receiptIds = new Set<string>([identityStage.receipt.receiptId]);
  const occupiedIds = new Set<string>([localCharacter.localCharacterId, checkpoint.checkpointId]);
  const occupyId = (id: string, idLabel: string): void => {
    if (occupiedIds.has(id)) mismatches.push(`${idLabel} ID collision`);
    occupiedIds.add(id);
  };
  occupyId(identityStage.request.commandId, 'identityStage command');
  occupyId(identityStage.receipt.receiptId, 'identityStage receipt');
  const sourceForms = new Set<CreationDecisionSourceFormId>();
  let expectedSourceFormId: CreationDecisionSourceFormId = 'CHR-010';
  let previousDraftRevision: number = identityStage.receipt.result.draftRevision;
  let previousCheckpointRevision: number = identityStage.receipt.result.checkpointRevision;
  let previousRevisions = identityStage.receipt.revisions;
  let expectedRace: RaceAndMethodStage['race'] = null;
  let expectedAcquisition: RaceAndMethodStage['symbiontAcquisition'] = {
    choiceLockStatus: 'UNLOCKED',
    consequences: null,
    value: null,
  };
  let expectedDice: RaceAndMethodStage['diceInput'] = null;
  let expectedMethod: RaceAndMethodStage['statMethod'] = null;
  let methodRecord: CreationSetDecideDecisionRecord | null = null;

  if (localCharacter.lifecycleState !== 'DRAFT') mismatches.push('lifecycleState');
  if (checkpoint.localCharacterId !== localCharacter.localCharacterId) {
    mismatches.push('checkpoint.localCharacterId');
  }
  if (checkpoint.checkpointId === localCharacter.localCharacterId) {
    mismatches.push('checkpoint/character ID collision');
  }

  for (const [index, record] of records.entries()) {
    const recordLabel = `decisionRecords[${String(index)}]`;
    const { request, receipt } = record;
    const { payload } = request;
    if (sourceForms.has(payload.sourceFormId)) {
      mismatches.push(`${recordLabel} duplicate decision stage ${payload.sourceFormId}`);
    }
    sourceForms.add(payload.sourceFormId);
    if (payload.sourceFormId !== expectedSourceFormId) {
      mismatches.push(`${recordLabel} stage sequence`);
    }
    if (commandIds.has(request.commandId)) mismatches.push(`${recordLabel} duplicate commandId`);
    commandIds.add(request.commandId);
    occupyId(request.commandId, `${recordLabel} command`);
    if (receiptIds.has(receipt.receiptId)) mismatches.push(`${recordLabel} duplicate receiptId`);
    receiptIds.add(receipt.receiptId);
    occupyId(receipt.receiptId, `${recordLabel} receipt`);
    if (payload.characterDraftId !== localCharacter.localCharacterId) {
      mismatches.push(`${recordLabel} characterDraftId`);
    }
    if (payload.wizardCheckpointId !== checkpoint.checkpointId) {
      mismatches.push(`${recordLabel} wizardCheckpointId`);
    }
    if (payload.draftRevision !== previousDraftRevision) {
      mismatches.push(`${recordLabel} pre-commit draftRevision`);
    }
    if (receipt.commandId !== request.commandId) {
      mismatches.push(`${recordLabel} request/receipt commandId`);
    }
    if (
      previousDraftRevision === Number.MAX_SAFE_INTEGER ||
      previousCheckpointRevision === Number.MAX_SAFE_INTEGER
    ) {
      mismatches.push(`${recordLabel} revision overflow`);
      continue;
    }
    const expectedPostRevisions = durablePostRevisions(
      previousRevisions,
      request,
      recordLabel,
      mismatches,
    );
    const expectedResult = receiptResultForRequest(
      request,
      previousCheckpointRevision + 1,
      previousDraftRevision + 1,
      payload.sourceFormId === 'CHR-002' && receipt.result.sourceFormId === 'CHR-002'
        ? {
            branchUuid: receipt.result.branchUuid,
            setRollRequestId: receipt.result.setRollRequestId,
          }
        : undefined,
    );
    if (!isDeepStrictEqual(receipt.result, expectedResult)) {
      mismatches.push(`${recordLabel} receipt result`);
    }
    if (!isDeepStrictEqual(receipt.revisions, expectedPostRevisions)) {
      mismatches.push(`${recordLabel} receipt revisions`);
    }
    const expectedEnvelope = nextStageEnvelope(
      nextFormForPayload(payload),
      localCharacter.localCharacterId,
    );
    if (!isDeepStrictEqual(record.nextStageEnvelope, expectedEnvelope)) {
      mismatches.push(`${recordLabel} signed destination`);
    }
    if (!isDeepStrictEqual(record.derived, derivedForRequest(request))) {
      mismatches.push(`${recordLabel} derived values`);
    }

    switch (payload.sourceFormId) {
      case 'CHR-010':
        expectedRace = {
          choiceLockStatus: 'UNLOCKED',
          consequences: RACE_CONSEQUENCES[payload.raceChoice],
          value: payload.raceChoice,
        };
        expectedAcquisition = initialAcquisition(payload.raceChoice);
        break;
      case 'CHR-016':
        if (expectedRace?.value === 'PURE') {
          mismatches.push(`${recordLabel} CHR-016 is not applicable to PURE`);
        }
        expectedAcquisition = {
          choiceLockStatus: 'UNLOCKED',
          consequences: ACQUISITION_CONSEQUENCES[payload.symbiontAcquisitionMode],
          value: payload.symbiontAcquisitionMode,
        };
        break;
      case 'CHR-036':
        expectedDice = {
          choiceLockStatus: 'UNLOCKED',
          value: payload.diceInputMode,
        };
        break;
      case 'CHR-002':
        methodRecord = record;
        expectedMethod = {
          choiceLockStatus: 'UNLOCKED',
          consequences: METHOD_CONSEQUENCES[payload.statMethod],
          value: payload.statMethod,
        };
        break;
    }
    expectedSourceFormId = nextFormForPayload(payload) as CreationDecisionSourceFormId;
    previousDraftRevision += 1;
    previousCheckpointRevision += 1;
    previousRevisions = expectedPostRevisions;
  }

  const statRollStage = 'statRollStage' in durablePayload ? durablePayload.statRollStage : null;
  if (statRollStage !== null && methodRecord === null) {
    mismatches.push('statRollStage requires a CHR-002 method record');
  }
  if (statRollStage === null && methodRecord !== null) {
    mismatches.push('CHR-002 method record requires statRollStage');
  }
  if (statRollStage?.attempts.some(({ setRecord }) => setRecord !== null) === true) {
    if (expectedDice !== null)
      expectedDice = { ...expectedDice, choiceLockStatus: 'LOCKED_AFTER_RESULT' };
    if (expectedMethod !== null) {
      expectedMethod = { ...expectedMethod, choiceLockStatus: 'LOCKED_AFTER_RESULT' };
    }
    if (expectedAcquisition.choiceLockStatus !== 'NOT_APPLICABLE') {
      expectedAcquisition = {
        ...expectedAcquisition,
        choiceLockStatus: 'LOCKED_AFTER_RESULT',
      };
    }
  }
  const expectedStage: RaceAndMethodStage = {
    decisionRecords: records,
    diceInput: expectedDice,
    race: expectedRace,
    statMethod: expectedMethod,
    symbiontAcquisition: expectedAcquisition,
  };
  if (!isDeepStrictEqual(raceAndMethodStage, expectedStage)) {
    mismatches.push('raceAndMethodStage aggregate');
  }
  const latestRecord = records.at(-1)!;
  let cursor: RollValidationCursor = {
    checkpointRevision: previousCheckpointRevision,
    draftRevision: previousDraftRevision,
    latestEnvelope: latestRecord.nextStageEnvelope,
    latestReceipt: latestRecord.receipt,
    latestRequest: latestRecord.request,
    revisions: previousRevisions,
  };
  if (statRollStage !== null && methodRecord !== null && 'statRollStage' in durablePayload) {
    cursor = validateStatRollHistory(
      durablePayload as CreationWizardStatRollPayload,
      methodRecord,
      localCharacter,
      checkpoint,
      cursor,
      commandIds,
      receiptIds,
      occupiedIds,
      mismatches,
    );
  }
  const statAssignmentStage =
    'statAssignmentStage' in durablePayload ? durablePayload.statAssignmentStage : null;
  const pureClassStage = 'pureClassStage' in durablePayload ? durablePayload.pureClassStage : null;
  if (statAssignmentStage !== null) {
    if (
      catalog === undefined ||
      statRollStage === null ||
      !('statAssignmentStage' in durablePayload)
    ) {
      throw new Error(`${label} stat-assignment checkpoint requires a validated skill catalog`);
    }
    cursor = validateStatAssignmentHistory(
      durablePayload as CreationWizardStatAssignmentPayload,
      localCharacter,
      checkpoint,
      identityStage,
      raceAndMethodStage,
      cursor,
      commandIds,
      receiptIds,
      occupiedIds,
      catalog,
      mismatches,
    );
  }
  const skillEligibilityStage =
    'skillEligibilityStage' in durablePayload ? durablePayload.skillEligibilityStage : null;
  const skillSelectionStage =
    'skillSelectionStage' in durablePayload ? durablePayload.skillSelectionStage : null;
  if (skillEligibilityStage !== null) {
    if (
      catalog === undefined ||
      statRollStage === null ||
      statAssignmentStage === null ||
      !('skillEligibilityStage' in durablePayload)
    ) {
      throw new Error(`${label} skill checkpoint requires a validated skill catalog`);
    }
    cursor = validateSkillHistory(
      durablePayload,
      localCharacter,
      checkpoint,
      identityStage,
      raceAndMethodStage,
      statRollStage,
      statAssignmentStage,
      pureClassStage,
      cursor,
      commandIds,
      receiptIds,
      occupiedIds,
      catalog,
      mismatches,
    );
  }
  previousCheckpointRevision = cursor.checkpointRevision;
  previousRevisions = cursor.revisions;
  if (!isDeepStrictEqual(durablePayload.receipt, cursor.latestReceipt)) {
    mismatches.push('top-level receipt/latest record');
  }
  if (!isDeepStrictEqual(durablePayload.nextStageEnvelope, cursor.latestEnvelope)) {
    mismatches.push('top-level destination/latest record');
  }
  if (durablePayload.branchCacheHash !== durablePayload.receipt.result.branchCacheHash) {
    mismatches.push('branchCacheHash');
  }
  if (durablePayload.nextStageEnvelope.formId !== durablePayload.receipt.result.nextFormId) {
    mismatches.push('top-level receipt/destination form');
  }
  if (durablePayload.nextStageEnvelope.routeBindings[0].value !== localCharacter.localCharacterId) {
    mismatches.push('top-level destination route binding');
  }
  if (checkpoint.checkpointRevision !== previousCheckpointRevision) {
    mismatches.push('checkpointRevision');
  }
  const currentRevisions = {
    actorVisibilityRevision: localCharacter.actorVisibilityRevision,
    projectionRevision: localCharacter.projectionRevision,
    stateRevision: localCharacter.stateRevision,
  };
  const checkpointRevisions = {
    actorVisibilityRevision: checkpoint.actorVisibilityRevision,
    projectionRevision: checkpoint.projectionRevision,
    stateRevision: checkpoint.stateRevision,
  };
  const projectionRevisionMatches =
    skillEligibilityStage !== null && skillSelectionStage === null
      ? currentRevisions.projectionRevision === previousRevisions.projectionRevision ||
        (previousRevisions.projectionRevision < Number.MAX_SAFE_INTEGER &&
          currentRevisions.projectionRevision === previousRevisions.projectionRevision + 1)
      : statAssignmentStage !== null
        ? currentRevisions.projectionRevision === previousRevisions.projectionRevision
        : currentRevisions.projectionRevision >= previousRevisions.projectionRevision;
  if (
    currentRevisions.actorVisibilityRevision !== previousRevisions.actorVisibilityRevision ||
    currentRevisions.stateRevision !== previousRevisions.stateRevision ||
    !projectionRevisionMatches
  ) {
    mismatches.push('localCharacter/latest receipt revisions');
  }
  if (!isDeepStrictEqual(checkpointRevisions, currentRevisions)) {
    mismatches.push('checkpoint/latest receipt revisions');
  }
  if (mismatches.length > 0) mismatchError(label, mismatches);

  return {
    checkpoint,
    durablePayload,
    identityStage,
    localCharacter,
    nextStageEnvelope: durablePayload.nextStageEnvelope,
    raceAndMethodStage,
    pureClassStage,
    skillEligibilityStage,
    skillSelectionStage,
    statRollStage,
    statAssignmentStage,
    receipt: durablePayload.receipt,
    request: cursor.latestRequest,
  };
};

const identityOnlyCheckpoint = (
  durable: DurableIdentityCheckpoint,
): DurableCreationWizardCheckpoint => {
  const identityStage = identityStageFromDurable(durable);
  return {
    checkpoint: durable.checkpoint,
    durablePayload: durable.durablePayload,
    identityStage,
    localCharacter: durable.localCharacter,
    nextStageEnvelope: identityStage.nextStageEnvelope,
    pureClassStage: null,
    raceAndMethodStage: null,
    skillEligibilityStage: null,
    skillSelectionStage: null,
    statAssignmentStage: null,
    statRollStage: null,
    receipt: durable.receipt,
    request: durable.request,
  };
};

export function validateDurableCreationWizardCheckpoint(
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
  catalog?: SkillStageCatalog,
): DurableCreationWizardCheckpoint {
  const label = `localCharacter ${JSON.stringify(localCharacter.localCharacterId)}`;
  let value: unknown;
  try {
    value = JSON.parse(localCharacter.payloadJson) as unknown;
  } catch (cause) {
    throw new Error(`${label} payload is not valid JSON`, { cause });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} payload is not a character wizard object`);
  }
  const object = value as Record<string, unknown>;
  if (Object.hasOwn(object, 'identityStage')) {
    return validatePostIdentityPayload(
      localCharacter,
      checkpoint,
      postIdentityPayloadAt(value, label, localCharacter, checkpoint),
      catalog,
    );
  }
  if (Object.hasOwn(object, 'lastCompleteStage')) {
    return identityOnlyCheckpoint(validateDurableIdentityCheckpoint(localCharacter, checkpoint));
  }
  throw new Error(`${label} payload has an unrecognized character wizard envelope`);
}

export function loadCreationWizardCheckpoint(
  database: Database.Database,
  localCharacterId: string,
  catalog?: SkillStageCatalog,
): DurableCreationWizardCheckpoint {
  return validateDurableCreationWizardCheckpoint(
    readLocalCharacter(database, localCharacterId),
    loadLocalCharacterCheckpoint(database, localCharacterId),
    catalog,
  );
}

export function currentCreationWizardRevisions(
  checkpoint: DurableCreationWizardCheckpoint,
): RevisionVector {
  return {
    actorVisibilityRevision: checkpoint.localCharacter.actorVisibilityRevision,
    projectionRevision: checkpoint.localCharacter.projectionRevision,
    stateRevision: checkpoint.localCharacter.stateRevision,
  };
}

export function deriveCreationSetAbandonmentDialogContext(
  checkpoint: DurableCreationWizardCheckpoint,
): CreationSetAbandonmentDialogContext {
  const stage = checkpoint.statRollStage;
  const attempt = stage === null ? null : currentStatRollAttempt(stage);
  if (
    stage === null ||
    attempt === null ||
    attempt.setRecord === null ||
    attempt.decisionRecordOrNull !== null ||
    (attempt.state !== 'DECISION_READY' && attempt.state !== 'CHAIN_COMPLETE') ||
    checkpoint.nextStageEnvelope.formId !== attempt.returnDecisionFormId
  ) {
    throw new CreationSetDecideApplicationError({ code: 'GUARD_REJECTED' });
  }
  const rule = deriveCreationStatSetDecisionRule(stage.statMethod, attempt.attemptIndex);
  if (rule.fifthAttemptMandatoryAccept) return guardRejected();
  const abandonment = deriveCreationStatAbandonment(stage.statMethod, attempt.attemptIndex);
  return {
    abandonedSetReceiptIds: [attempt.setRecord.receipt.receiptId],
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    draftRevision: checkpoint.receipt.result.draftRevision,
    irreversibleConsequences: { ...abandonment.consequences },
    originDecisionFormId: rule.decisionFormId,
    transitionKind: abandonment.transitionKind,
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
  };
}

export function advanceCreationWizardProjection(
  database: Database.Database,
  characterDraftId: string,
  wizardCheckpointId: string,
  catalog?: SkillStageCatalog,
): DurableCreationWizardCheckpoint {
  const preflight = loadCreationWizardCheckpoint(database, characterDraftId, catalog);
  if (
    preflight.checkpoint.checkpointId !== wizardCheckpointId ||
    preflight.localCharacter.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    throw new CreationSetDecideApplicationError({ code: 'GUARD_REJECTED' });
  }
  deriveCreationSetAbandonmentDialogContext(preflight);
  const committed = commitLocalCharacterCheckpoint(
    database,
    characterDraftId,
    wizardCheckpointId,
    (update) => {
      const current = loadCreationWizardCheckpoint(database, characterDraftId, catalog);
      if (
        current.checkpoint.checkpointId !== wizardCheckpointId ||
        current.localCharacter.projectionRevision === Number.MAX_SAFE_INTEGER
      ) {
        throw new CreationSetDecideApplicationError({ code: 'GUARD_REJECTED' });
      }
      deriveCreationSetAbandonmentDialogContext(current);
      return update(
        { payloadJson: current.localCharacter.payloadJson },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
      );
    },
  );
  return validateDurableCreationWizardCheckpoint(committed.result, committed.checkpoint, catalog);
}

function assertSkillSelectionPresentationAdvance(
  checkpoint: DurableCreationWizardCheckpoint,
  wizardCheckpointId: string,
): void {
  const eligibility = checkpoint.skillEligibilityStage;
  if (
    checkpoint.checkpoint.checkpointId !== wizardCheckpointId ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-013' ||
    eligibility === null ||
    checkpoint.skillSelectionStage !== null ||
    !isDeepStrictEqual(currentCreationWizardRevisions(checkpoint), eligibility.receipt.revisions) ||
    checkpoint.localCharacter.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    throw new CreationSetDecideApplicationError({ code: 'GUARD_REJECTED' });
  }
}

/** Advances only the CHR-013 -> CHR-015 presentation; no durable skill stage changes. */
export function advanceCreationSkillSelectionProjection(
  database: Database.Database,
  characterDraftId: string,
  wizardCheckpointId: string,
  catalog: SkillStageCatalog,
): DurableCreationWizardCheckpoint {
  assertSkillSelectionPresentationAdvance(
    loadCreationWizardCheckpoint(database, characterDraftId, catalog),
    wizardCheckpointId,
  );
  const committed = commitLocalCharacterCheckpoint(
    database,
    characterDraftId,
    wizardCheckpointId,
    (update) => {
      const current = loadCreationWizardCheckpoint(database, characterDraftId, catalog);
      assertSkillSelectionPresentationAdvance(current, wizardCheckpointId);
      return update(
        { payloadJson: current.localCharacter.payloadJson },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
      );
    },
  );
  return validateDurableCreationWizardCheckpoint(committed.result, committed.checkpoint, catalog);
}

const rawCommandIds = (payloadJson: string): readonly string[] => {
  const value = JSON.parse(payloadJson) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const object = value as Record<string, unknown>;
  const ids: string[] = [];
  const addRequestId = (request: unknown): void => {
    if (request === null || typeof request !== 'object' || Array.isArray(request)) return;
    const commandId = (request as Record<string, unknown>)['commandId'];
    if (typeof commandId === 'string') ids.push(commandId);
  };
  const lastCompleteStage = object['lastCompleteStage'];
  if (
    lastCompleteStage !== null &&
    typeof lastCompleteStage === 'object' &&
    !Array.isArray(lastCompleteStage)
  ) {
    addRequestId((lastCompleteStage as Record<string, unknown>)['request']);
  }
  const identityStage = object['identityStage'];
  if (
    identityStage !== null &&
    typeof identityStage === 'object' &&
    !Array.isArray(identityStage)
  ) {
    addRequestId((identityStage as Record<string, unknown>)['request']);
  }
  const raceAndMethodStage = object['raceAndMethodStage'];
  if (
    raceAndMethodStage !== null &&
    typeof raceAndMethodStage === 'object' &&
    !Array.isArray(raceAndMethodStage)
  ) {
    const records = (raceAndMethodStage as Record<string, unknown>)['decisionRecords'];
    if (Array.isArray(records)) {
      for (const record of records) {
        if (record !== null && typeof record === 'object' && !Array.isArray(record)) {
          addRequestId((record as Record<string, unknown>)['request']);
        }
      }
    }
  }
  const statRollStage = object['statRollStage'];
  if (
    statRollStage !== null &&
    typeof statRollStage === 'object' &&
    !Array.isArray(statRollStage)
  ) {
    const roll = statRollStage as Record<string, unknown>;
    const attempts = roll['attempts'];
    if (Array.isArray(attempts)) {
      for (const attempt of attempts) {
        if (attempt !== null && typeof attempt === 'object' && !Array.isArray(attempt)) {
          const attemptObject = attempt as Record<string, unknown>;
          for (const record of [
            attemptObject['setRecord'],
            attemptObject['decisionRecordOrNull'],
          ]) {
            if (record !== null && typeof record === 'object' && !Array.isArray(record)) {
              addRequestId((record as Record<string, unknown>)['request']);
            }
          }
          const confirmationRecords = attemptObject['confirmationRecords'];
          if (Array.isArray(confirmationRecords)) {
            for (const record of confirmationRecords) {
              if (record !== null && typeof record === 'object' && !Array.isArray(record)) {
                addRequestId((record as Record<string, unknown>)['request']);
              }
            }
          }
        }
      }
    }
  }
  for (const stageKey of [
    'statAssignmentStage',
    'pureClassStage',
    'skillEligibilityStage',
    'skillSelectionStage',
  ] as const) {
    const stage = object[stageKey];
    if (stage !== null && typeof stage === 'object' && !Array.isArray(stage)) {
      addRequestId((stage as Record<string, unknown>)['request']);
    }
  }
  return ids;
};

export function loadCreationWizardCommandByCommandId(
  database: Database.Database,
  commandId: string,
  catalog?: SkillStageCatalog,
): DurableCreationWizardCommand | null {
  const matches = listLocalCharacters(database).filter((localCharacter) =>
    rawCommandIds(localCharacter.payloadJson).includes(commandId),
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new Error(
      `durable character wizard commandId ${JSON.stringify(commandId)} is duplicated by local characters: ${matches.map(({ localCharacterId }) => JSON.stringify(localCharacterId)).join(', ')}`,
    );
  }
  const durableCheckpoint = loadCreationWizardCheckpoint(
    database,
    matches[0]!.localCharacterId,
    catalog,
  );
  if (durableCheckpoint.identityStage.request.commandId === commandId) {
    return {
      durableCheckpoint,
      nextStageEnvelope: durableCheckpoint.identityStage.nextStageEnvelope,
      receipt: durableCheckpoint.identityStage.receipt,
      request: durableCheckpoint.identityStage.request,
    };
  }
  const decisionRecord = durableCheckpoint.raceAndMethodStage?.decisionRecords.find(
    ({ request }) => request.commandId === commandId,
  );
  if (decisionRecord !== undefined) {
    return {
      durableCheckpoint,
      nextStageEnvelope: decisionRecord.nextStageEnvelope,
      receipt: decisionRecord.receipt,
      request: decisionRecord.request,
    };
  }
  for (const record of [
    durableCheckpoint.statAssignmentStage,
    durableCheckpoint.pureClassStage,
    durableCheckpoint.skillEligibilityStage,
    durableCheckpoint.skillSelectionStage,
  ]) {
    if (record?.request.commandId === commandId) {
      return {
        durableCheckpoint,
        nextStageEnvelope: record.nextStageEnvelope,
        receipt: record.receipt,
        request: record.request,
      };
    }
  }
  const rollRecords =
    durableCheckpoint.statRollStage?.attempts.flatMap((attempt) => [
      ...(attempt.setRecord === null ? [] : [attempt.setRecord]),
      ...attempt.confirmationRecords,
      ...(attempt.decisionRecordOrNull === null ? [] : [attempt.decisionRecordOrNull]),
    ]) ?? [];
  const rollRecord = rollRecords.find(({ request }) => request.commandId === commandId);
  if (rollRecord === undefined) {
    throw new Error(
      `durable character wizard commandId ${JSON.stringify(commandId)} disappeared during validation`,
    );
  }
  return {
    durableCheckpoint,
    nextStageEnvelope: rollRecord.nextStageEnvelope,
    receipt: rollRecord.receipt,
    request: rollRecord.request,
  };
}

const currentRevisions = currentCreationWizardRevisions;

const storedDecisionRecords = (
  checkpoint: DurableCreationWizardCheckpoint,
): readonly CreationSetDecideDecisionRecord[] =>
  checkpoint.raceAndMethodStage?.decisionRecords ?? [];

const storedWizardRecords = (checkpoint: DurableCreationWizardCheckpoint) => [
  { request: checkpoint.identityStage.request, receipt: checkpoint.identityStage.receipt },
  ...storedDecisionRecords(checkpoint),
  ...(checkpoint.statRollStage?.attempts.flatMap((attempt) => [
    ...(attempt.setRecord === null ? [] : [attempt.setRecord]),
    ...attempt.confirmationRecords,
    ...(attempt.decisionRecordOrNull === null ? [] : [attempt.decisionRecordOrNull]),
  ]) ?? []),
  ...(checkpoint.statAssignmentStage === null ? [] : [checkpoint.statAssignmentStage]),
  ...(checkpoint.pureClassStage === null ? [] : [checkpoint.pureClassStage]),
  ...(checkpoint.skillEligibilityStage === null ? [] : [checkpoint.skillEligibilityStage]),
  ...(checkpoint.skillSelectionStage === null ? [] : [checkpoint.skillSelectionStage]),
];

const guardRejected = (): never => {
  throw new CreationSetDecideApplicationError({ code: 'GUARD_REJECTED' });
};

const assertCommitAllowed = (
  checkpoint: DurableCreationWizardCheckpoint,
  request: CreationSetDecideCommandRequest,
  receiptId?: string,
  dialogContext?: CreationSetAbandonmentDialogContext,
  catalog?: SkillStageCatalog,
): void => {
  const actual = currentRevisions(checkpoint);
  if (!isDeepStrictEqual(request.expectedRevisions, actual)) {
    throw new CreationSetDecideApplicationError({
      actual,
      code: 'STALE_REVISION',
      expected: request.expectedRevisions,
    });
  }
  if (
    request.payload.characterDraftId !== checkpoint.localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== checkpoint.checkpoint.checkpointId ||
    request.payload.draftRevision !== checkpoint.receipt.result.draftRevision
  ) {
    guardRejected();
  }
  const previousRecords = storedWizardRecords(checkpoint);
  const previousRequests = previousRecords.map(({ request: stored }) => stored);
  const duplicateRequest = previousRequests.find(
    ({ commandId }) => commandId === request.commandId,
  );
  if (duplicateRequest !== undefined) {
    if (!isDeepStrictEqual(duplicateRequest, request)) {
      throw new CreationSetDecideApplicationError({
        code: 'IDEMPOTENCY_CONFLICT',
        commandId: request.commandId,
        detail: 'PAYLOAD_MISMATCH',
      });
    }
    guardRejected();
  }
  if (durableWizardIds(checkpoint).has(request.commandId)) guardRejected();
  const previousReceiptIds = previousRecords.map(({ receipt }) => receipt.receiptId);
  if (
    receiptId !== undefined &&
    (previousReceiptIds.includes(receiptId) ||
      durableWizardIds(checkpoint).has(receiptId) ||
      receiptId === request.commandId)
  ) {
    guardRejected();
  }

  const raceStage = checkpoint.raceAndMethodStage;
  const statStage = checkpoint.statRollStage;
  switch (request.payload.sourceFormId) {
    case 'CHR-010':
      if (
        checkpoint.nextStageEnvelope.formId !== 'CHR-010' ||
        raceStage !== null ||
        statStage !== null
      ) {
        guardRejected();
      }
      break;
    case 'CHR-016':
      if (
        checkpoint.nextStageEnvelope.formId !== 'CHR-016' ||
        raceStage === null ||
        statStage !== null ||
        raceStage.race === null ||
        raceStage.race.value === 'PURE' ||
        raceStage.symbiontAcquisition.value !== null ||
        raceStage.symbiontAcquisition.choiceLockStatus !== 'UNLOCKED'
      ) {
        guardRejected();
      }
      break;
    case 'CHR-036':
      if (
        checkpoint.nextStageEnvelope.formId !== 'CHR-036' ||
        raceStage === null ||
        statStage !== null ||
        raceStage.race === null ||
        raceStage.diceInput !== null
      ) {
        guardRejected();
      }
      if (
        raceStage!.race!.value === 'PURE'
          ? raceStage!.symbiontAcquisition.choiceLockStatus !== 'NOT_APPLICABLE'
          : raceStage!.symbiontAcquisition.value === null
      ) {
        guardRejected();
      }
      break;
    case 'CHR-002':
      if (
        checkpoint.nextStageEnvelope.formId !== 'CHR-002' ||
        raceStage === null ||
        statStage !== null ||
        raceStage.race === null ||
        raceStage.diceInput === null ||
        raceStage.statMethod !== null ||
        (raceStage.race.value === 'PURE'
          ? raceStage.symbiontAcquisition.choiceLockStatus !== 'NOT_APPLICABLE'
          : raceStage.symbiontAcquisition.value === null)
      ) {
        guardRejected();
      }
      break;
    case 'CHR-005':
    case 'CHR-006':
    case 'CHR-007':
    case 'CHR-008': {
      const attempt = statStage === null ? null : currentStatRollAttempt(statStage);
      if (
        attempt === null ||
        checkpoint.nextStageEnvelope.formId !== request.payload.sourceFormId ||
        attempt.returnDecisionFormId !== request.payload.sourceFormId ||
        attempt.setRecord === null ||
        attempt.decisionRecordOrNull !== null ||
        (attempt.state !== 'DECISION_READY' && attempt.state !== 'CHAIN_COMPLETE')
      ) {
        guardRejected();
      }
      break;
    }
    case 'CHR-028':
      if (
        dialogContext === undefined ||
        !isDeepStrictEqual(dialogContext, deriveCreationSetAbandonmentDialogContext(checkpoint))
      ) {
        guardRejected();
      }
      break;
    case 'CHR-011':
      if (
        catalog === undefined ||
        checkpoint.nextStageEnvelope.formId !== 'CHR-011' ||
        checkpoint.statAssignmentStage === null ||
        checkpoint.pureClassStage !== null
      ) {
        guardRejected();
      }
      try {
        preparePureClassDecision(checkpoint, request as PureClassDecisionCommandRequest, catalog!);
      } catch (cause) {
        if (cause instanceof CreationStatAssignmentApplicationError) guardRejected();
        throw cause;
      }
      break;
  }
  const isCancel =
    request.payload.sourceFormId === 'CHR-028' && request.payload.decision === 'CANCEL';
  if (
    (isCancel && actual.projectionRevision === Number.MAX_SAFE_INTEGER) ||
    (!isCancel &&
      (checkpoint.receipt.result.draftRevision === Number.MAX_SAFE_INTEGER ||
        checkpoint.checkpoint.checkpointRevision === Number.MAX_SAFE_INTEGER ||
        actual.stateRevision === Number.MAX_SAFE_INTEGER ||
        actual.projectionRevision === Number.MAX_SAFE_INTEGER))
  ) {
    guardRejected();
  }
};

const payloadAfterDecision = (
  checkpoint: DurableCreationWizardCheckpoint,
  request: CreationRaceMethodSetDecideCommandRequest,
  receiptId: string,
  methodAllocation?: CreationStatRollAllocation,
): CreationWizardPostIdentityPayload => {
  const revisions = incrementedRevisions(currentRevisions(checkpoint));
  const checkpointRevision = checkpoint.checkpoint.checkpointRevision + 1;
  const draftRevision = checkpoint.receipt.result.draftRevision + 1;
  const receipt: CreationRaceMethodSetDecideReceipt = {
    commandId: request.commandId,
    receiptId,
    result: receiptResultForRequest(request, checkpointRevision, draftRevision, methodAllocation),
    revisions,
  };
  const destination = nextStageEnvelope(
    nextFormForPayload(request.payload),
    request.payload.characterDraftId,
  );
  const record: CreationSetDecideDecisionRecord = {
    derived: derivedForRequest(request),
    nextStageEnvelope: destination,
    receipt,
    request,
  };
  const previousStage = checkpoint.raceAndMethodStage;
  let race = previousStage?.race ?? null;
  let acquisition = previousStage?.symbiontAcquisition ?? {
    choiceLockStatus: 'UNLOCKED' as const,
    consequences: null,
    value: null,
  };
  let dice = previousStage?.diceInput ?? null;
  let method = previousStage?.statMethod ?? null;
  switch (request.payload.sourceFormId) {
    case 'CHR-010':
      race = {
        choiceLockStatus: 'UNLOCKED',
        consequences: RACE_CONSEQUENCES[request.payload.raceChoice],
        value: request.payload.raceChoice,
      };
      acquisition = initialAcquisition(request.payload.raceChoice);
      break;
    case 'CHR-016':
      acquisition = {
        choiceLockStatus: 'UNLOCKED',
        consequences: ACQUISITION_CONSEQUENCES[request.payload.symbiontAcquisitionMode],
        value: request.payload.symbiontAcquisitionMode,
      };
      break;
    case 'CHR-036':
      dice = {
        choiceLockStatus: 'UNLOCKED',
        value: request.payload.diceInputMode,
      };
      break;
    case 'CHR-002':
      method = {
        choiceLockStatus: 'UNLOCKED',
        consequences: METHOD_CONSEQUENCES[request.payload.statMethod],
        value: request.payload.statMethod,
      };
      break;
  }
  const raceAndMethodStage: RaceAndMethodStage = {
    decisionRecords: [...storedDecisionRecords(checkpoint), record],
    diceInput: dice,
    race,
    statMethod: method,
    symbiontAcquisition: acquisition,
  };
  const common = {
    branchCacheEntries: [] as const,
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    identityStage: checkpoint.identityStage,
    nextStageEnvelope: destination,
    raceAndMethodStage,
    randomReceiptIds: [] as const,
    receipt,
    selectedBranchUuidOrNull: null,
  };
  if (request.payload.sourceFormId !== 'CHR-002') {
    return common;
  }
  if (methodAllocation === undefined || dice === null) {
    throw new Error('CHR-002 method commit lacks its preflight allocation or dice mode');
  }
  return {
    ...common,
    nextStageEnvelope: destination as CreationNextStageEnvelope<'CHR-003'>,
    statRollStage: {
      attempts: [
        {
          attemptIndex: 1,
          confirmationRecords: [],
          confirmationRollRequestIdOrNull: null,
          criticalQueueIndexOrNull: null,
          decisionRecordOrNull: null,
          naturalCriticalQueue: [],
          outcomes: [],
          returnDecisionFormId: deriveCreationReturnDecisionFormId(request.payload.statMethod, 1),
          setRecord: null,
          setRollRequestId: methodAllocation.setRollRequestId,
          state: 'REQUEST_READY',
        },
      ],
      branchUuid: methodAllocation.branchUuid,
      currentAttemptIndexOrNull: 1,
      diceInputModeSnapshot: dice.value,
      statMethod: request.payload.statMethod,
    },
  };
};

const payloadAfterStatDecision = (
  checkpoint: DurableCreationWizardCheckpoint,
  request: DurableCreationSetDecideCommandRequest & {
    readonly payload:
      StatRollAcceptSetPayload | (StatRollDialogDecisionPayload & { readonly decision: 'CONFIRM' });
  },
  receiptId: string,
  nextSetRollRequestIdOrNull: string | null,
): CreationWizardStatRollPayload => {
  const stage = checkpoint.statRollStage;
  const attempt = stage === null ? null : currentStatRollAttempt(stage);
  if (stage === null || attempt === null || attempt.setRecord === null) return guardRejected();
  const rule = deriveCreationStatSetDecisionRule(stage.statMethod, attempt.attemptIndex);
  const revisions = incrementedRevisions(currentRevisions(checkpoint));
  const checkpointRevision = checkpoint.checkpoint.checkpointRevision + 1;
  const draftRevision = checkpoint.receipt.result.draftRevision + 1;
  let destination: CreationNextStageEnvelope<'CHR-003' | 'CHR-009'>;
  let record: CreationStatRollDecisionRecord;
  let currentAttemptIndexOrNull: number | null = attempt.attemptIndex;
  let appendedAttempt: StatRollAttempt | null = null;
  if (request.payload.decision === 'ACCEPT_SET') {
    destination = nextStageEnvelope('CHR-009', request.payload.characterDraftId);
    const derived: CreationSetAcceptanceDerived = {
      acceptedSetReceiptId: attempt.setRecord.receipt.receiptId,
      assignmentMode: 'ROLLED_BIJECTION',
      decision: 'ACCEPT_SET',
    };
    const receipt: CommandReceipt<CreationSetAcceptanceReceiptResult> = {
      commandId: request.commandId,
      receiptId,
      result: {
        branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
        branchUuid: stage.branchUuid,
        characterDraftId: request.payload.characterDraftId,
        checkpointId: request.payload.wizardCheckpointId,
        checkpointOwnerId: request.payload.characterDraftId,
        checkpointRevision,
        draftRevision,
        ...derived,
        nextFormId: 'CHR-009',
        sourceFormId: rule.decisionFormId,
        stage: 'STAT_ROLLS',
      },
      revisions,
    };
    record = {
      derived,
      nextStageEnvelope: destination as CreationNextStageEnvelope<'CHR-009'>,
      receipt,
      request: request as CreationSetAcceptanceDecisionRecord['request'],
    };
  } else {
    const abandonment = deriveCreationStatAbandonment(stage.statMethod, attempt.attemptIndex);
    if ((abandonment.nextFormId === 'CHR-003') !== (nextSetRollRequestIdOrNull !== null)) {
      return guardRejected();
    }
    destination = nextStageEnvelope(abandonment.nextFormId, request.payload.characterDraftId);
    const irreversibleConsequences: CreationSetAbandonmentConsequences = {
      ...abandonment.consequences,
    };
    const derived: CreationSetAbandonmentDerived = {
      abandonedSetReceiptIds: [attempt.setRecord.receipt.receiptId],
      decision: abandonment.alternateDecision,
      destinationFormId: abandonment.nextFormId,
      irreversibleConsequences,
      originDecisionFormId: rule.decisionFormId,
      transitionKind: abandonment.transitionKind,
    };
    const receipt: CommandReceipt<CreationSetAbandonmentReceiptResult> = {
      commandId: request.commandId,
      receiptId,
      result: {
        abandonedSetReceiptIds: derived.abandonedSetReceiptIds,
        alternateDecision: derived.decision,
        assignmentModeOrNull: abandonment.statAssignmentModeOrNull,
        branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
        branchUuid: stage.branchUuid,
        characterDraftId: request.payload.characterDraftId,
        checkpointId: request.payload.wizardCheckpointId,
        checkpointOwnerId: request.payload.characterDraftId,
        checkpointRevision,
        decision: 'CONFIRM',
        draftRevision,
        irreversibleConsequences,
        nextAttemptIndexOrNull: abandonment.consequences.nextAttemptIndexOrNull,
        nextFormId: abandonment.nextFormId,
        nextSetRollRequestIdOrNull,
        originDecisionFormId: rule.decisionFormId,
        sourceFormId: 'CHR-028',
        sourceSetReceiptIdOrNull: null,
        stage: 'STAT_ROLLS',
        transitionKind: abandonment.transitionKind,
      },
      revisions,
    };
    record = {
      derived,
      nextStageEnvelope: destination,
      receipt,
      request: request as CreationSetAbandonmentDecisionRecord['request'],
    };
    if (nextSetRollRequestIdOrNull === null) {
      currentAttemptIndexOrNull = null;
    } else {
      const nextAttemptIndex = abandonment.consequences.nextAttemptIndexOrNull!;
      currentAttemptIndexOrNull = nextAttemptIndex;
      appendedAttempt = {
        attemptIndex: nextAttemptIndex,
        confirmationRecords: [],
        confirmationRollRequestIdOrNull: null,
        criticalQueueIndexOrNull: null,
        decisionRecordOrNull: null,
        naturalCriticalQueue: [],
        outcomes: [],
        returnDecisionFormId: deriveCreationReturnDecisionFormId(
          stage.statMethod,
          nextAttemptIndex,
        ),
        setRecord: null,
        setRollRequestId: nextSetRollRequestIdOrNull,
        state: 'REQUEST_READY',
      };
    }
  }
  const attempts = stage.attempts.map((stored) =>
    stored.attemptIndex === attempt.attemptIndex
      ? {
          ...stored,
          decisionRecordOrNull: record,
          state: request.payload.decision === 'ACCEPT_SET' ? 'SET_ACCEPTED' : 'SET_ABANDONED',
        }
      : stored,
  );
  if (appendedAttempt !== null) attempts.push(appendedAttempt);
  return {
    ...checkpoint.durablePayload,
    nextStageEnvelope: destination,
    receipt: record.receipt,
    statRollStage: { ...stage, attempts, currentAttemptIndexOrNull },
  } as CreationWizardStatRollPayload;
};

const payloadAfterPureClassDecision = (
  checkpoint: DurableCreationWizardCheckpoint,
  request: PureClassDecisionCommandRequest,
  receiptId: string,
  catalog: SkillStageCatalog,
): CreationWizardStatAssignmentPayload => {
  const statRollStage = checkpoint.statRollStage;
  const statAssignmentStage = checkpoint.statAssignmentStage;
  if (statRollStage === null || statAssignmentStage === null) return guardRejected();
  const derived = preparePureClassDecision(checkpoint, request, catalog);
  const revisions = incrementedRevisions(currentRevisions(checkpoint));
  const nextStageEnvelope = nextStageEnvelopeForPureClass(request.payload.characterDraftId);
  const receipt: PureClassDecisionReceipt = {
    commandId: request.commandId,
    receiptId,
    result: {
      ...derived,
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      branchUuid: statRollStage.branchUuid,
      characterDraftId: request.payload.characterDraftId,
      checkpointId: request.payload.wizardCheckpointId,
      checkpointOwnerId: request.payload.characterDraftId,
      checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
      draftRevision: checkpoint.receipt.result.draftRevision + 1,
      nextFormId: 'CHR-012',
      sourceFormId: 'CHR-011',
      stage: 'STAT_ASSIGNMENT',
    },
    revisions,
  };
  const pureClassStage: PureClassStage = {
    derived,
    nextStageEnvelope,
    receipt,
    request,
  };
  return {
    ...(checkpoint.durablePayload as CreationWizardStatAssignmentPayload),
    nextStageEnvelope,
    pureClassStage,
    receipt,
  };
};

const nextStageEnvelopeForPureClass = (
  characterDraftId: string,
): CreationNextStageEnvelope<'CHR-012'> => nextStageEnvelope('CHR-012', characterDraftId);

const allocatedCreationStatRollId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must allocate a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
};

export const creationWizardDurableIds = (
  checkpoint: DurableCreationWizardCheckpoint,
): ReadonlySet<string> =>
  new Set(
    [
      checkpoint.localCharacter.localCharacterId,
      checkpoint.checkpoint.checkpointId,
      checkpoint.statRollStage?.branchUuid,
      ...storedWizardRecords(checkpoint).flatMap(({ request, receipt }) => [
        request.commandId,
        receipt.receiptId,
      ]),
      ...(checkpoint.statRollStage?.attempts.flatMap((attempt) => [
        attempt.setRollRequestId,
        attempt.confirmationRollRequestIdOrNull,
        attempt.setRecord?.receipt.result.confirmationRollRequestIdOrNull,
        ...attempt.confirmationRecords.flatMap(({ receipt }) => [
          receipt.result.confirmationRollRequestId,
          receipt.result.nextConfirmationRollRequestIdOrNull,
        ]),
      ]) ?? []),
    ].filter((value): value is string => typeof value === 'string'),
  );

const durableWizardIds = (checkpoint: DurableCreationWizardCheckpoint): Set<string> =>
  new Set(creationWizardDurableIds(checkpoint));

const allocateCreationStatRoll = (
  checkpoint: DurableCreationWizardCheckpoint,
  request: CreationSetDecideCommandRequest,
  receiptId: string,
  allocators: CreationStatRollAllocators | undefined,
): CreationStatRollAllocation | undefined => {
  if (request.payload.sourceFormId !== 'CHR-002') return undefined;
  if (allocators === undefined) {
    throw new TypeError('CHR-002 method commit requires branch and roll-request allocators');
  }
  const branchUuid = allocatedCreationStatRollId(
    allocators.allocateBranchUuid(),
    'creation stat branchUuid allocator',
  );
  const setRollRequestId = allocatedCreationStatRollId(
    allocators.allocateRollRequestId(),
    'creation stat roll request allocator',
  );
  const occupied = durableWizardIds(checkpoint);
  occupied.add(receiptId).add(request.commandId);
  if (
    branchUuid === setRollRequestId ||
    occupied.has(branchUuid) ||
    occupied.has(setRollRequestId)
  ) {
    guardRejected();
  }
  return { branchUuid, setRollRequestId };
};

const allocateNextSetRollRequest = (
  checkpoint: DurableCreationWizardCheckpoint,
  request: CreationSetDecideCommandRequest,
  receiptId: string,
  allocators: CreationStatRollAllocators | undefined,
): string | null => {
  if (request.payload.sourceFormId !== 'CHR-028' || request.payload.decision !== 'CONFIRM') {
    return null;
  }
  const stage = checkpoint.statRollStage;
  const attempt = stage === null ? null : currentStatRollAttempt(stage);
  if (stage === null || attempt === null) return guardRejected();
  const abandonment = deriveCreationStatAbandonment(stage.statMethod, attempt.attemptIndex);
  if (abandonment.nextFormId !== 'CHR-003') return null;
  if (allocators === undefined) {
    throw new TypeError('next-attempt confirmation requires a roll-request allocator');
  }
  const id = allocatedCreationStatRollId(
    allocators.allocateRollRequestId(),
    'next creation stat roll request allocator',
  );
  const occupied = durableWizardIds(checkpoint);
  occupied.add(request.commandId).add(receiptId);
  if (occupied.has(id)) return guardRejected();
  return id;
};

export function preflightCreationSetDecide(
  database: Database.Database,
  request: DecodedCommandRequest,
  dialogContext?: CreationSetAbandonmentDialogContext,
  catalog?: SkillStageCatalog,
): DurableCreationWizardCheckpoint {
  const normalized = normalizeCreationSetDecideRequest(request);
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    normalized.payload.characterDraftId,
    catalog,
  );
  assertCommitAllowed(checkpoint, normalized, undefined, dialogContext, catalog);
  return checkpoint;
}

export function commitCreationSetDecide(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  statRollAllocators?: CreationStatRollAllocators,
  dialogContext?: CreationSetAbandonmentDialogContext,
  catalog?: SkillStageCatalog,
): CreationSetDecideExecutionResult {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(
      `creation set decision receiptId must be a non-empty string, got ${JSON.stringify(receiptId)}`,
    );
  }
  const normalized = normalizeCreationSetDecideRequest(request);
  const preflight = loadCreationWizardCheckpoint(
    database,
    normalized.payload.characterDraftId,
    catalog,
  );
  assertCommitAllowed(preflight, normalized, receiptId, dialogContext, catalog);
  if (normalized.payload.sourceFormId === 'CHR-028' && normalized.payload.decision === 'CANCEL') {
    const stage = preflight.statRollStage!;
    const context = dialogContext!;
    const cancelRequest = normalized as CreationSetCancelCommandRequest;
    const receipt: CreationSetCancelReceipt = {
      commandId: normalized.commandId,
      receiptId,
      result: {
        branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
        branchUuid: stage.branchUuid,
        characterDraftId: normalized.payload.characterDraftId,
        checkpointId: normalized.payload.wizardCheckpointId,
        checkpointOwnerId: normalized.payload.characterDraftId,
        checkpointRevision: preflight.checkpoint.checkpointRevision,
        decision: 'CANCEL',
        decisionReceiptIdOrNull: null,
        draftRevision: preflight.receipt.result.draftRevision,
        nextFormId: context.originDecisionFormId,
        originDecisionFormId: context.originDecisionFormId,
        sourceFormId: 'CHR-028',
        stage: 'STAT_ROLLS',
      },
      revisions: currentRevisions(preflight),
    };
    return {
      kind: 'TRANSIENT_CANCEL',
      receipt,
      request: cancelRequest,
    };
  }
  const methodAllocation = allocateCreationStatRoll(
    preflight,
    normalized,
    receiptId,
    statRollAllocators,
  );
  const nextSetRollRequestIdOrNull = allocateNextSetRollRequest(
    preflight,
    normalized,
    receiptId,
    statRollAllocators,
  );

  const committed = commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      // BEGIN IMMEDIATE owns the final guard. The earlier pass is deliberately
      // retained so every numeric limit is checked before transaction entry.
      const current = loadCreationWizardCheckpoint(
        database,
        normalized.payload.characterDraftId,
        catalog,
      );
      assertCommitAllowed(current, normalized, receiptId, dialogContext, catalog);
      const durablePayload =
        normalized.payload.stage === 'RACE_AND_METHOD'
          ? payloadAfterDecision(
              current,
              normalized as CreationRaceMethodSetDecideCommandRequest,
              receiptId,
              methodAllocation,
            )
          : normalized.payload.stage === 'STAT_ASSIGNMENT'
            ? payloadAfterPureClassDecision(
                current,
                normalized as PureClassDecisionCommandRequest,
                receiptId,
                catalog!,
              )
            : payloadAfterStatDecision(
                current,
                normalized as DurableCreationSetDecideCommandRequest & {
                  readonly payload:
                    | StatRollAcceptSetPayload
                    | (StatRollDialogDecisionPayload & { readonly decision: 'CONFIRM' });
                },
                receiptId,
                nextSetRollRequestIdOrNull,
              );
      return update(
        { payloadJson: JSON.stringify(durablePayload) },
        {
          actorVisibilityChanged: false,
          projectionChanged: true,
          stateChanged: true,
        },
      );
    },
  );
  return {
    durableCheckpoint: validateDurableCreationWizardCheckpoint(
      committed.result,
      committed.checkpoint,
      catalog,
    ),
    kind: 'DURABLE',
  };
}
