import type { ActionKey } from '@generated/types/atlas.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { IdentityDraftValues } from '@shared/wire-v3-protocol.js';

export const CHOICE_LOCK_STATUSES = ['UNLOCKED', 'LOCKED_AFTER_RESULT', 'NOT_APPLICABLE'] as const;
export type ChoiceLockStatus = (typeof CHOICE_LOCK_STATUSES)[number];

export const RACE_CHOICES = ['UNITED', 'FREE', 'PURE'] as const;
export type RaceChoice = (typeof RACE_CHOICES)[number];
export type SymbiontRaceChoice = Exclude<RaceChoice, 'PURE'>;

export const SYMBIONT_ACQUISITION_MODES = ['MANUAL', 'RANDOM'] as const;
export type SymbiontAcquisitionMode = (typeof SYMBIONT_ACQUISITION_MODES)[number];

export const DICE_INPUT_MODES = ['AUTO', 'MANUAL'] as const;
export type DiceInputMode = (typeof DICE_INPUT_MODES)[number];

export const STAT_METHODS = ['CLASSIC', 'ADVENTUROUS', 'ALL_OR_NOTHING'] as const;
export type StatMethod = (typeof STAT_METHODS)[number];

export const CHR_001_FORM_ID = 'CHR-001' as const;
export const CHR_001_ROUTE = '/player/characters/:localCharacterId/create/chr-001' as const;
export const CHR_001_CONTINUE_ACTION_KEY = 'CHR-001::CTA::001' as const satisfies ActionKey;
export const CHR_001_CANCEL_ACTION_KEY = 'CHR-001::CTA::002' as const satisfies ActionKey;
/** Continue remains guard-hidden until its required identity fields are confirmed. */
export const CHR_001_INITIAL_ACTION_KEYS = [
  CHR_001_CANCEL_ACTION_KEY,
] as const satisfies readonly ActionKey[];
export const CHR_001_CHECKPOINT_ACTION_KEYS = [
  CHR_001_CONTINUE_ACTION_KEY,
  CHR_001_CANCEL_ACTION_KEY,
] as const satisfies readonly ActionKey[];

export const CHR_010_FORM_ID = 'CHR-010' as const;
export const CHR_010_ROUTE = '/player/characters/:localCharacterId/create/chr-010' as const;
/** Source: forms-by-id.json["CHR-010"].requiredFields. */
export const CHR_010_REQUIRED_FIELDS = [
  'characterDraftId',
  'raceChoice=UNITED|FREE|PURE',
  'ancientOptionSerialized=false',
  'raceConsequencesPreview',
  'choiceLockStatus',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_010_CONFIRM_SYMBIONT_RACE_ACTION_KEY =
  'CHR-010::CTA::001' as const satisfies ActionKey;
export const CHR_010_CONFIRM_PURE_RACE_ACTION_KEY =
  'CHR-010::CTA::002' as const satisfies ActionKey;
export const CHR_010_SET_DECIDE_ACTION_KEYS = [
  CHR_010_CONFIRM_SYMBIONT_RACE_ACTION_KEY,
  CHR_010_CONFIRM_PURE_RACE_ACTION_KEY,
] as const satisfies readonly ActionKey[];
export const CHR_010_INITIAL_ACTION_KEYS = [
  'CHR-010::CTA::004',
  'CHR-010::CTA::005',
  'CHR-010::CTA::006',
] as const satisfies readonly ActionKey[];

export const CHR_016_FORM_ID = 'CHR-016' as const;
export const CHR_016_ROUTE = '/player/characters/:localCharacterId/create/chr-016' as const;
/** Source: forms-by-id.json["CHR-016"].requiredFields. */
export const CHR_016_REQUIRED_FIELDS = [
  'characterDraftId',
  'raceChoice=UNITED|FREE',
  'symbiontAcquisitionMode=MANUAL|RANDOM',
  'modeConsequences',
  'choiceLockStatus',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_016_CONFIRM_ACTION_KEY = 'CHR-016::CTA::001' as const satisfies ActionKey;
export const CHR_016_SET_DECIDE_ACTION_KEYS = [
  CHR_016_CONFIRM_ACTION_KEY,
] as const satisfies readonly ActionKey[];
export const CHR_016_INITIAL_ACTION_KEYS = [
  'CHR-016::CTA::003',
  'CHR-016::CTA::004',
] as const satisfies readonly ActionKey[];

export const CHR_036_FORM_ID = 'CHR-036' as const;
export const CHR_036_ROUTE = '/player/characters/:localCharacterId/create/chr-036' as const;
/** Source: forms-by-id.json["CHR-036"].requiredFields. */
export const CHR_036_REQUIRED_FIELDS = [
  'characterDraftId',
  'diceInputMode=AUTO|MANUAL',
  'appliesToAllCreationRolls=true',
  'choiceLockStatus',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_036_CONFIRM_ACTION_KEY = 'CHR-036::CTA::001' as const satisfies ActionKey;
export const CHR_036_SET_DECIDE_ACTION_KEYS = [
  CHR_036_CONFIRM_ACTION_KEY,
] as const satisfies readonly ActionKey[];
export const CHR_036_INITIAL_ACTION_KEYS = [
  'CHR-036::CTA::004',
  'CHR-036::CTA::005',
] as const satisfies readonly ActionKey[];

export const CHR_002_FORM_ID = 'CHR-002' as const;
export const CHR_002_ROUTE = '/player/characters/:localCharacterId/create/chr-002' as const;
/** Source: forms-by-id.json["CHR-002"].requiredFields. */
export const CHR_002_REQUIRED_FIELDS = [
  'characterDraftId',
  'statMethod=CLASSIC|ADVENTUROUS|ALL_OR_NOTHING',
  'methodConsequences',
  'choiceLockStatus',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_002_INITIAL_ACTION_KEYS = [
  'CHR-002::CTA::003',
  'CHR-002::CTA::004',
  'CHR-002::CTA::005',
] as const satisfies readonly ActionKey[];
export const CHR_002_CONFIRM_ACTION_KEY = 'CHR-002::CTA::001' as const satisfies ActionKey;
/** ADR 0042 creates CHR-003's first addressed set in the same method transaction. */
export const CHR_002_SET_DECIDE_ACTION_KEYS = [
  CHR_002_CONFIRM_ACTION_KEY,
] as const satisfies readonly ActionKey[];

export const CHR_003_FORM_ID = 'CHR-003' as const;
export const CHR_003_ROUTE = '/player/characters/:localCharacterId/create/chr-003' as const;
/** Source: forms-by-id.json["CHR-003"].requiredFields. */
export const CHR_003_REQUIRED_FIELDS = [
  'characterDraftId',
  'statMethod',
  'attemptIndex',
  'diceInputModeSnapshot=AUTO|MANUAL',
  'setRollRequestId',
  'faces[7]OrManualInputs[7]',
  'setRollReceiptIdOrNull',
  'naturalCriticalQueue[]',
  'shownResultLocked',
  'branchUuid',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_003_SAFE_RETURN_ACTION_KEY = 'CHR-003::CTA::001' as const satisfies ActionKey;
export const CHR_003_ROLL_COMMIT_ACTION_KEY = 'CHR-003::CTA::002' as const satisfies ActionKey;
/** Safe return stays capability-excluded until its reverse durable contract exists. */
export const CHR_003_REQUEST_ACTION_KEYS = [
  CHR_003_ROLL_COMMIT_ACTION_KEY,
] as const satisfies readonly ActionKey[];
export const CHR_003_COMMITTED_ACTION_KEYS = [] as const satisfies readonly ActionKey[];

export const CHR_004_FORM_ID = 'CHR-004' as const;
export const CHR_004_ROUTE = '/player/characters/:localCharacterId/create/chr-004' as const;
/** Source: forms-by-id.json["CHR-004"].requiredFields. */
export const CHR_004_REQUIRED_FIELDS = [
  'characterDraftId',
  'setRollReceiptId',
  'criticalQueueIndex',
  'originFace=1|20',
  'confirmationRollRequestId',
  'diceInputModeSnapshot=AUTO|MANUAL',
  'confirmationFaceOrNull',
  'confirmationReceiptIdOrNull',
  'returnDecisionFormId(server-signed)=CHR-005|CHR-006|CHR-007|CHR-008',
  'branchUuid',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_004_ROLL_COMMIT_ACTION_KEY = 'CHR-004::CTA::001' as const satisfies ActionKey;
export const CHR_004_PENDING_ACTION_KEYS = [
  CHR_004_ROLL_COMMIT_ACTION_KEY,
] as const satisfies readonly ActionKey[];
export const CHR_004_COMPLETE_ACTION_KEYS = [] as const satisfies readonly ActionKey[];

export const SET_DECIDE_ACTION_KEYS_BY_FORM = {
  [CHR_002_FORM_ID]: CHR_002_SET_DECIDE_ACTION_KEYS,
  [CHR_010_FORM_ID]: CHR_010_SET_DECIDE_ACTION_KEYS,
  [CHR_016_FORM_ID]: CHR_016_SET_DECIDE_ACTION_KEYS,
  [CHR_036_FORM_ID]: CHR_036_SET_DECIDE_ACTION_KEYS,
} as const;

export const SET_DECIDE_CAPABLE_FORM_IDS = [
  CHR_002_FORM_ID,
  CHR_010_FORM_ID,
  CHR_016_FORM_ID,
  CHR_036_FORM_ID,
] as const;

export interface NaturalCriticalQueueItem extends JsonObject {
  readonly originFace: 1 | 20;
  readonly setEntryIndex: number;
}

export interface Chr003ProjectionValues {
  readonly attemptIndex: number;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly diceInputModeSnapshot: DiceInputMode;
  readonly draftRevision: number;
  readonly facesOrManualInputs: readonly (number | null)[];
  readonly naturalCriticalQueue: readonly NaturalCriticalQueueItem[];
  readonly setRollReceiptId: string | null;
  readonly setRollRequestId: string;
  readonly shownResultLocked: boolean;
  readonly statMethod: StatMethod;
  readonly wizardCheckpointId: string;
}

export interface Chr004ProjectionValues {
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly confirmationFace: number | null;
  readonly confirmationReceiptId: string | null;
  readonly confirmationRollRequestId: string;
  readonly criticalQueueIndex: number;
  readonly diceInputModeSnapshot: DiceInputMode;
  readonly draftRevision: number;
  readonly originFace: 1 | 20;
  readonly returnDecisionFormId: 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008';
  readonly setRollReceiptId: string;
  readonly wizardCheckpointId: string;
}

function assertSevenFaceSlots(values: readonly (number | null)[]): void {
  if (
    values.length !== 7 ||
    values.some(
      (value) => value !== null && (!Number.isSafeInteger(value) || value < 1 || value > 20),
    )
  ) {
    throw new Error('CHR-003 facesOrManualInputs must contain exactly seven null or 1..20 slots');
  }
}

export function projectChr003(values: Chr003ProjectionValues): JsonObject {
  assertSevenFaceSlots(values.facesOrManualInputs);
  return {
    attemptIndex: values.attemptIndex,
    branchUuid: values.branchUuid,
    characterDraftId: values.characterDraftId,
    commandId: null,
    diceInputModeSnapshot: values.diceInputModeSnapshot,
    draftRevision: values.draftRevision,
    facesOrManualInputs: [...values.facesOrManualInputs],
    naturalCriticalQueue: values.naturalCriticalQueue.map((item) => ({ ...item })),
    setRollReceiptId: values.setRollReceiptId,
    setRollRequestId: values.setRollRequestId,
    shownResultLocked: values.shownResultLocked,
    statMethod: values.statMethod,
    wizardCheckpointId: values.wizardCheckpointId,
  };
}

export function projectChr004(values: Chr004ProjectionValues): JsonObject {
  return {
    branchUuid: values.branchUuid,
    characterDraftId: values.characterDraftId,
    commandId: null,
    confirmationFace: values.confirmationFace,
    confirmationReceiptId: values.confirmationReceiptId,
    confirmationRollRequestId: values.confirmationRollRequestId,
    criticalQueueIndex: values.criticalQueueIndex,
    diceInputModeSnapshot: values.diceInputModeSnapshot,
    draftRevision: values.draftRevision,
    originFace: values.originFace,
    returnDecisionFormId: values.returnDecisionFormId,
    setRollReceiptId: values.setRollReceiptId,
    wizardCheckpointId: values.wizardCheckpointId,
  };
}

export function projectChr001(
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
  values: IdentityDraftValues,
): JsonObject {
  return {
    ...values,
    anatomyProfile: 'STANDARD_HUMANOID',
    characterDraftId,
    commandId: null,
    draftRevision,
    massApprovalStatus: 'PENDING_GM',
    wizardCheckpointId,
  };
}

export function projectInitialChr001(
  characterDraftId: string,
  wizardCheckpointId: string,
): JsonObject {
  return projectChr001(characterDraftId, wizardCheckpointId, 0, {
    age: null,
    artAssetKeyOrLocalFile: null,
    description: null,
    massKg: null,
    name: null,
    sex: null,
  });
}

export function projectInitialChr010(
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
): JsonObject {
  return {
    ancientOptionSerialized: false,
    characterDraftId,
    choiceLockStatus: 'UNLOCKED',
    commandId: null,
    draftRevision,
    raceChoice: null,
    raceConsequencesPreview: null,
    wizardCheckpointId,
  };
}

export function projectInitialChr016(
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
  raceChoice: SymbiontRaceChoice,
): JsonObject {
  if (raceChoice !== 'UNITED' && raceChoice !== 'FREE') {
    throw new Error(
      `CHR-016 raceChoice is ${JSON.stringify(raceChoice)}, expected "UNITED" or "FREE"`,
    );
  }
  return {
    characterDraftId,
    choiceLockStatus: 'UNLOCKED',
    commandId: null,
    draftRevision,
    modeConsequences: null,
    raceChoice,
    symbiontAcquisitionMode: null,
    wizardCheckpointId,
  };
}

export function projectInitialChr036(
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
): JsonObject {
  return {
    appliesToAllCreationRolls: true,
    characterDraftId,
    choiceLockStatus: 'UNLOCKED',
    commandId: null,
    diceInputMode: null,
    draftRevision,
    wizardCheckpointId,
  };
}

export function projectInitialChr002(
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
): JsonObject {
  return {
    characterDraftId,
    choiceLockStatus: 'UNLOCKED',
    commandId: null,
    draftRevision,
    methodConsequences: null,
    statMethod: null,
    wizardCheckpointId,
  };
}
