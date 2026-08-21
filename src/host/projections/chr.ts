import type { ActionKey } from '@generated/types/atlas.js';
import type { ClassCode, StatCode } from '@generated/types/character.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { IdentityDraftValues } from '@shared/wire-v3-protocol.js';

import {
  CREATION_STAT_RETURN_DECISION_FORM_IDS,
  CREATION_STAT_SET_DECISION_RULES,
  deriveCreationStatAbandonment,
  type CreationStatAbandonmentConsequences,
  type CreationStatAbandonmentTransitionKind,
  type CreationStatReturnDecisionFormId,
  type CreationStatSetDecision,
} from '../../domain/index.js';
import type { CreationDecisionConsequenceCatalog } from '../creation-decision-consequence-catalog.js';

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

export const CREATION_SET_DECISION_FORM_IDS = CREATION_STAT_RETURN_DECISION_FORM_IDS;
export type CreationSetDecisionFormId = CreationStatReturnDecisionFormId;
export type CreationSetTransitionKind = CreationStatAbandonmentTransitionKind;
export type CreationSetAlternateDecision = Exclude<CreationStatSetDecision, 'ACCEPT_SET'>;

export const CHR_005_FORM_ID = 'CHR-005' as const;
export const CHR_005_ROUTE = '/player/characters/:localCharacterId/create/chr-005' as const;
/** Source: forms-by-id.json["CHR-005"].requiredFields. */
export const CHR_005_REQUIRED_FIELDS = [
  'characterDraftId',
  'statMethod=CLASSIC',
  'acceptedSetReceiptId',
  'decision=PENDING|ACCEPT_SET|USE_POINT_BUY_90',
  'decisionReceiptIdOrNull',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

export const CHR_006_FORM_ID = 'CHR-006' as const;
export const CHR_006_ROUTE = '/player/characters/:localCharacterId/create/chr-006' as const;
/** Source: forms-by-id.json["CHR-006"].requiredFields. */
export const CHR_006_REQUIRED_FIELDS = [
  'characterDraftId',
  'statMethod=ADVENTUROUS',
  'attemptIndex=1',
  'setReceiptId',
  'decision=PENDING|ACCEPT_SET|GO_ATTEMPT_2',
  'decisionReceiptIdOrNull',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

export const CHR_007_FORM_ID = 'CHR-007' as const;
export const CHR_007_ROUTE = '/player/characters/:localCharacterId/create/chr-007' as const;
/** Source: forms-by-id.json["CHR-007"].requiredFields. */
export const CHR_007_REQUIRED_FIELDS = [
  'characterDraftId',
  'statMethod=ADVENTUROUS',
  'attemptIndex=2',
  'setReceiptId',
  'decision=PENDING|ACCEPT_SET|USE_POINT_BUY_85',
  'decisionReceiptIdOrNull',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

export const CHR_008_FORM_ID = 'CHR-008' as const;
export const CHR_008_ROUTE = '/player/characters/:localCharacterId/create/chr-008' as const;
/** Source: forms-by-id.json["CHR-008"].requiredFields. */
export const CHR_008_REQUIRED_FIELDS = [
  'characterDraftId',
  'statMethod=ALL_OR_NOTHING',
  'attemptIndex=1..5',
  'setReceiptId',
  'decision=PENDING|ACCEPT_SET|GO_NEXT_ATTEMPT',
  'decisionReceiptIdOrNull',
  'fifthAttemptMandatoryAccept',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

export const CHR_009_FORM_ID = 'CHR-009' as const;
export const CHR_009_ROUTE = '/player/characters/:localCharacterId/create/chr-009' as const;
/** Source: forms-by-id.json["CHR-009"].requiredFields. */
export const CHR_009_REQUIRED_FIELDS = [
  'characterDraftId',
  'assignmentMode=ROLLED_BIJECTION|POINT_BUY_90|POINT_BUY_85',
  'sourceSetReceiptIdOrNull',
  'S',
  'D',
  'M',
  'Z',
  'I',
  'W',
  'C',
  'bijectionProofOrExactSum',
  'eachValueRange=1..20 when point-buy',
  'assignmentValidation',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_009_CONFIRM_PURE_ACTION_KEY = 'CHR-009::CTA::001' as const satisfies ActionKey;
export const CHR_009_CONFIRM_CLASSLESS_ACTION_KEY =
  'CHR-009::CTA::002' as const satisfies ActionKey;
export const CHR_009_SAFE_RETURN_ACTION_KEY = 'CHR-009::CTA::003' as const satisfies ActionKey;
export const CHR_009_CHECKPOINT_ACTION_KEYS = [
  CHR_009_CONFIRM_PURE_ACTION_KEY,
  CHR_009_CONFIRM_CLASSLESS_ACTION_KEY,
] as const satisfies readonly ActionKey[];

export function chr009CheckpointActionKeys(
  raceChoice: RaceChoice,
  capabilityAvailable: boolean,
): readonly ActionKey[] {
  switch (raceChoice) {
    case 'PURE':
      return capabilityAvailable ? [CHR_009_CONFIRM_PURE_ACTION_KEY] : [];
    case 'FREE':
    case 'UNITED':
      return capabilityAvailable ? [CHR_009_CONFIRM_CLASSLESS_ACTION_KEY] : [];
    default:
      throw new Error(`CHR-009 has unrecognized raceChoice ${JSON.stringify(raceChoice)}`);
  }
}

export const CHR_011_FORM_ID = 'CHR-011' as const;
export const CHR_011_ROUTE = '/player/characters/:localCharacterId/create/chr-011' as const;
/** Source: forms-by-id.json["CHR-011"].requiredFields. */
export const CHR_011_REQUIRED_FIELDS = [
  'characterDraftId',
  'raceChoice=PURE',
  'pureClass=SEEKER|STALKER|SOLDIER',
  'classConsequences',
  'mandatoryClassSkill',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_011_CONFIRM_ACTION_KEY = 'CHR-011::CTA::001' as const satisfies ActionKey;
export const CHR_011_SAFE_RETURN_ACTION_KEY = 'CHR-011::CTA::002' as const satisfies ActionKey;
export const CHR_011_INITIAL_ACTION_KEYS = [
  'CHR-011::CTA::003',
  'CHR-011::CTA::004',
  'CHR-011::CTA::005',
] as const satisfies readonly ActionKey[];
export const CHR_011_SET_DECIDE_ACTION_KEYS = [
  CHR_011_CONFIRM_ACTION_KEY,
] as const satisfies readonly ActionKey[];

export const CHR_012_FORM_ID = 'CHR-012' as const;
export const CHR_012_ROUTE = '/player/characters/:localCharacterId/create/chr-012' as const;
/** Source: forms-by-id.json["CHR-012"].requiredFields. */
export const CHR_012_REQUIRED_FIELDS = [
  'characterDraftId',
  'baseStats',
  'raceModifiers',
  'classModifiersOrNull',
  'skillStageStats',
  'symbiontModifiersExcluded=true',
  'mandatoryClassSkillOrNull',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_012_EXCLUDED_ACTION_KEYS = [
  'CHR-012::CTA::002',
  'CHR-012::CTA::003',
] as const satisfies readonly ActionKey[];
export const CHR_012_CHECKPOINT_ACTION_KEY = 'CHR-012::CTA::001' as const satisfies ActionKey;
export const CHR_012_CHECKPOINT_ACTION_KEYS = [
  CHR_012_CHECKPOINT_ACTION_KEY,
] as const satisfies readonly ActionKey[];
/** No capability means no executable CHR-012 action. */
export const CHR_012_ACTION_KEYS = [] as const satisfies readonly ActionKey[];

export const CHR_013_FORM_ID = 'CHR-013' as const;
export const CHR_013_ROUTE = '/player/characters/:localCharacterId/create/chr-013' as const;
/** Source: forms-by-id.json["CHR-013"].requiredFields. */
export const CHR_013_REQUIRED_FIELDS = [
  'characterDraftId',
  'skillStageStats',
  'eligibleSkillIds[]',
  'skillCardSummaries[]',
  'slotSources',
  'selectedSkillIdOrNull',
  'wizardCheckpointId',
  'draftRevision',
] as const;
export const CHR_013_CONTINUE_ACTION_KEY = 'CHR-013::CTA::002' as const satisfies ActionKey;
export const CHR_013_ACTION_KEYS = [
  CHR_013_CONTINUE_ACTION_KEY,
] as const satisfies readonly ActionKey[];
/** CHR-014 is deferred and the safe return lacks a reverse durable contract. */
export const CHR_013_EXCLUDED_ACTION_KEYS = [
  'CHR-013::CTA::001',
  'CHR-013::CTA::003',
] as const satisfies readonly ActionKey[];

export const CHR_015_FORM_ID = 'CHR-015' as const;
export const CHR_015_ROUTE = '/player/characters/:localCharacterId/create/chr-015' as const;
/** Source: forms-by-id.json["CHR-015"].requiredFields. */
export const CHR_015_REQUIRED_FIELDS = [
  'characterDraftId',
  'selectedSkillIds[]',
  'mandatoryClassSkillOrNull',
  'racialFreeSkillIds[]',
  'paidSlotUsage',
  'requiredSlotCount',
  'eligibleSkillIds[]',
  'selectionValidation',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_015_LOCAL_DRAFT_ACTION_KEY = 'CHR-015::CTA::003' as const satisfies ActionKey;
export const CHR_015_INITIAL_ACTION_KEYS = [
  CHR_015_LOCAL_DRAFT_ACTION_KEY,
] as const satisfies readonly ActionKey[];
export const CHR_015_CHECKPOINTED_ACTION_KEYS = [] as const satisfies readonly ActionKey[];
/** Confirm is a web-derived EXACT capability; safe return remains excluded by ADR 0044. */
export const CHR_015_HOST_EXCLUDED_ACTION_KEYS = [
  'CHR-015::CTA::001',
  'CHR-015::CTA::002',
] as const satisfies readonly ActionKey[];

export const CHR_028_FORM_ID = 'CHR-028' as const;
export const CHR_028_ROUTE = '@dialog/chr-028' as const;
/** Source: forms-by-id.json["CHR-028"].requiredFields. */
export const CHR_028_REQUIRED_FIELDS = [
  'characterDraftId',
  'originDecisionFormId(server-signed)=CHR-005|CHR-006|CHR-007|CHR-008',
  'transitionKind=CLASSIC_TO_90|ADVENTUROUS_TO_SECOND|ADVENTUROUS_TO_85|ALL_OR_NOTHING_NEXT',
  'abandonedSetReceiptIds[]',
  'irreversibleConsequences',
  'decision=CONFIRM|CANCEL',
  'decisionReceiptIdOrNull',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

export const CHR_028_CONFIRM_ACTION_KEY = 'CHR-028::CTA::001' as const satisfies ActionKey;
export const CHR_028_CANCEL_ACTION_KEY = 'CHR-028::CTA::002' as const satisfies ActionKey;
export const CHR_028_WARNING_ACTION_KEYS = [
  CHR_028_CONFIRM_ACTION_KEY,
  CHR_028_CANCEL_ACTION_KEY,
] as const satisfies readonly ActionKey[];
export const CHR_028_COMMITTED_ACTION_KEYS = [] as const satisfies readonly ActionKey[];

interface CreationSetDecisionFormContract {
  readonly acceptActionKey: ActionKey;
  readonly formId: CreationSetDecisionFormId;
  readonly requiredFields: readonly string[];
  readonly route: string;
  readonly warningActionKey: ActionKey;
  readonly warningGuard: string;
}

export const CREATION_SET_DECISION_FORMS = [
  {
    acceptActionKey: 'CHR-005::CTA::001',
    formId: CHR_005_FORM_ID,
    requiredFields: CHR_005_REQUIRED_FIELDS,
    route: CHR_005_ROUTE,
    warningActionKey: 'CHR-005::CTA::002',
    warningGuard: 'decision pending; transitionKind=CLASSIC_TO_90; no abandonment yet',
  },
  {
    acceptActionKey: 'CHR-006::CTA::001',
    formId: CHR_006_FORM_ID,
    requiredFields: CHR_006_REQUIRED_FIELDS,
    route: CHR_006_ROUTE,
    warningActionKey: 'CHR-006::CTA::002',
    warningGuard: 'transitionKind=ADVENTUROUS_TO_SECOND; first set not yet abandoned',
  },
  {
    acceptActionKey: 'CHR-007::CTA::001',
    formId: CHR_007_FORM_ID,
    requiredFields: CHR_007_REQUIRED_FIELDS,
    route: CHR_007_ROUTE,
    warningActionKey: 'CHR-007::CTA::002',
    warningGuard: 'transitionKind=ADVENTUROUS_TO_85; second set not yet abandoned',
  },
  {
    acceptActionKey: 'CHR-008::CTA::001',
    formId: CHR_008_FORM_ID,
    requiredFields: CHR_008_REQUIRED_FIELDS,
    route: CHR_008_ROUTE,
    warningActionKey: 'CHR-008::CTA::002',
    warningGuard:
      'attemptIndex<5; transitionKind=ALL_OR_NOTHING_NEXT; current set not yet abandoned',
  },
] as const satisfies readonly CreationSetDecisionFormContract[];

const CREATION_SET_DECISION_FORM_BY_ID = new Map(
  CREATION_SET_DECISION_FORMS.map((contract) => [contract.formId, contract]),
);

export function creationSetDecisionFormContract(
  formId: CreationSetDecisionFormId,
): (typeof CREATION_SET_DECISION_FORMS)[number] {
  const contract = CREATION_SET_DECISION_FORM_BY_ID.get(formId);
  if (contract === undefined) throw new Error(`unsupported creation set decision form ${formId}`);
  return contract;
}

export interface CreationSetDecisionProjectionValues {
  readonly attemptIndex: number;
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly decision: CreationStatSetDecision | 'PENDING';
  readonly decisionReceiptIdOrNull: string | null;
  readonly draftRevision: number;
  readonly formId: CreationSetDecisionFormId;
  readonly setReceiptId: string;
  readonly wizardCheckpointId: string;
}

export interface IrreversibleSetConsequences
  extends CreationStatAbandonmentConsequences, JsonObject {}

export interface Chr028ProjectionValues {
  readonly abandonedSetReceiptIds: readonly [string];
  readonly attemptIndex: number;
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly decision: 'CONFIRM' | null;
  readonly decisionReceiptIdOrNull: string | null;
  readonly draftRevision: number;
  readonly irreversibleConsequences: IrreversibleSetConsequences;
  readonly originDecisionFormId: CreationSetDecisionFormId;
  readonly transitionKind: CreationSetTransitionKind;
  readonly wizardCheckpointId: string;
}

function nonEmpty(value: string, label: string): void {
  if (value.length === 0) throw new Error(`${label} must be non-empty`);
}

export function projectCreationSetDecision(
  values: CreationSetDecisionProjectionValues,
): JsonObject {
  creationSetDecisionFormContract(values.formId);
  const rule = CREATION_STAT_SET_DECISION_RULES.find(
    (candidate) =>
      candidate.decisionFormId === values.formId && candidate.attemptIndex === values.attemptIndex,
  );
  if (rule === undefined) {
    throw new Error(
      `${values.formId} attemptIndex ${JSON.stringify(values.attemptIndex)} violates its decision contract`,
    );
  }
  if (
    values.decision !== 'PENDING' &&
    values.decision !== 'ACCEPT_SET' &&
    values.decision !== rule.alternateDecision
  ) {
    throw new Error(`${values.formId} decision ${JSON.stringify(values.decision)} is not allowed`);
  }
  if (
    (values.decision === 'PENDING' &&
      (values.commandId !== null || values.decisionReceiptIdOrNull !== null)) ||
    (values.decision !== 'PENDING' &&
      (values.commandId === null || values.decisionReceiptIdOrNull === null))
  ) {
    throw new Error(`${values.formId} decision and command receipt state disagree`);
  }
  nonEmpty(values.characterDraftId, `${values.formId} characterDraftId`);
  nonEmpty(values.setReceiptId, `${values.formId} set receipt`);
  nonEmpty(values.wizardCheckpointId, `${values.formId} wizardCheckpointId`);
  if (values.commandId !== null) nonEmpty(values.commandId, `${values.formId} commandId`);
  if (values.decisionReceiptIdOrNull !== null) {
    nonEmpty(values.decisionReceiptIdOrNull, `${values.formId} decision receipt`);
  }
  if (!Number.isSafeInteger(values.draftRevision) || values.draftRevision < 0) {
    throw new Error(`${values.formId} draftRevision must be a non-negative safe integer`);
  }
  return {
    ...(values.formId === CHR_005_FORM_ID ? {} : { attemptIndex: values.attemptIndex }),
    characterDraftId: values.characterDraftId,
    commandId: values.commandId,
    decision: values.decision,
    decisionReceiptIdOrNull: values.decisionReceiptIdOrNull,
    draftRevision: values.draftRevision,
    [rule.setReceiptField]: values.setReceiptId,
    statMethod: rule.statMethod,
    ...(values.formId === CHR_008_FORM_ID
      ? { fifthAttemptMandatoryAccept: rule.fifthAttemptMandatoryAccept }
      : {}),
    wizardCheckpointId: values.wizardCheckpointId,
  };
}

export function projectChr028(values: Chr028ProjectionValues): JsonObject {
  creationSetDecisionFormContract(values.originDecisionFormId);
  const rule = CREATION_STAT_SET_DECISION_RULES.find(
    (candidate) =>
      candidate.decisionFormId === values.originDecisionFormId &&
      candidate.attemptIndex === values.attemptIndex,
  );
  if (rule === undefined || values.transitionKind !== rule.transitionKind) {
    throw new Error('CHR-028 originDecisionFormId and transitionKind disagree');
  }
  if (values.abandonedSetReceiptIds.length !== 1) {
    throw new Error('CHR-028 abandonedSetReceiptIds must contain exactly the current set receipt');
  }
  if (
    (values.decision === null &&
      (values.commandId !== null || values.decisionReceiptIdOrNull !== null)) ||
    (values.decision === 'CONFIRM' &&
      (values.commandId === null || values.decisionReceiptIdOrNull === null))
  ) {
    throw new Error('CHR-028 decision and command receipt state disagree');
  }
  const expectedAbandonment = deriveCreationStatAbandonment(rule.statMethod, rule.attemptIndex);
  if (
    Object.keys(values.irreversibleConsequences).length !== 4 ||
    Object.entries(expectedAbandonment.consequences).some(
      ([key, value]) => values.irreversibleConsequences[key] !== value,
    )
  ) {
    throw new Error('CHR-028 irreversibleConsequences do not match the signed transition');
  }
  nonEmpty(values.characterDraftId, 'CHR-028 characterDraftId');
  nonEmpty(values.abandonedSetReceiptIds[0], 'CHR-028 abandoned set receipt');
  nonEmpty(values.wizardCheckpointId, 'CHR-028 wizardCheckpointId');
  if (values.commandId !== null) nonEmpty(values.commandId, 'CHR-028 commandId');
  if (values.decisionReceiptIdOrNull !== null) {
    nonEmpty(values.decisionReceiptIdOrNull, 'CHR-028 decision receipt');
  }
  if (!Number.isSafeInteger(values.draftRevision) || values.draftRevision < 0) {
    throw new Error('CHR-028 draftRevision must be a non-negative safe integer');
  }
  return {
    abandonedSetReceiptIds: [...values.abandonedSetReceiptIds],
    characterDraftId: values.characterDraftId,
    commandId: values.commandId,
    decision: values.decision,
    decisionReceiptIdOrNull: values.decisionReceiptIdOrNull,
    draftRevision: values.draftRevision,
    irreversibleConsequences: { ...values.irreversibleConsequences },
    originDecisionFormId: values.originDecisionFormId,
    transitionKind: values.transitionKind,
    wizardCheckpointId: values.wizardCheckpointId,
  };
}

export function creationSetDecisionPendingActionKeys(
  formId: CreationSetDecisionFormId,
  attemptIndex: number,
): readonly ActionKey[] {
  const contract = creationSetDecisionFormContract(formId);
  return formId === CHR_008_FORM_ID && attemptIndex === 5
    ? [contract.acceptActionKey]
    : [contract.acceptActionKey, contract.warningActionKey];
}

export const SET_DECIDE_ACTION_KEYS_BY_FORM = {
  [CHR_002_FORM_ID]: CHR_002_SET_DECIDE_ACTION_KEYS,
  [CHR_005_FORM_ID]: [creationSetDecisionFormContract(CHR_005_FORM_ID).acceptActionKey],
  [CHR_006_FORM_ID]: [creationSetDecisionFormContract(CHR_006_FORM_ID).acceptActionKey],
  [CHR_007_FORM_ID]: [creationSetDecisionFormContract(CHR_007_FORM_ID).acceptActionKey],
  [CHR_008_FORM_ID]: [creationSetDecisionFormContract(CHR_008_FORM_ID).acceptActionKey],
  [CHR_010_FORM_ID]: CHR_010_SET_DECIDE_ACTION_KEYS,
  [CHR_011_FORM_ID]: CHR_011_SET_DECIDE_ACTION_KEYS,
  [CHR_016_FORM_ID]: CHR_016_SET_DECIDE_ACTION_KEYS,
  [CHR_028_FORM_ID]: CHR_028_WARNING_ACTION_KEYS,
  [CHR_036_FORM_ID]: CHR_036_SET_DECIDE_ACTION_KEYS,
} as const;

export const SET_DECIDE_CAPABLE_FORM_IDS = [
  CHR_002_FORM_ID,
  CHR_005_FORM_ID,
  CHR_006_FORM_ID,
  CHR_007_FORM_ID,
  CHR_008_FORM_ID,
  CHR_010_FORM_ID,
  CHR_011_FORM_ID,
  CHR_016_FORM_ID,
  CHR_028_FORM_ID,
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
  consequenceCatalog: CreationDecisionConsequenceCatalog,
): JsonObject {
  return {
    ancientOptionSerialized: false,
    characterDraftId,
    choiceLockStatus: 'UNLOCKED',
    commandId: null,
    draftRevision,
    raceChoice: null,
    raceConsequenceOptions: consequenceCatalog.raceConsequenceOptions,
    raceConsequencesPreview: null,
    wizardCheckpointId,
  };
}

export function projectInitialChr016(
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
  raceChoice: SymbiontRaceChoice,
  consequenceCatalog: CreationDecisionConsequenceCatalog,
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
    modeConsequenceOptions: consequenceCatalog.modeConsequenceOptionsByRace[raceChoice],
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
  consequenceCatalog: CreationDecisionConsequenceCatalog,
): JsonObject {
  return {
    characterDraftId,
    choiceLockStatus: 'UNLOCKED',
    commandId: null,
    draftRevision,
    methodConsequenceOptions: consequenceCatalog.methodConsequenceOptions,
    methodConsequences: null,
    statMethod: null,
    wizardCheckpointId,
  };
}

export interface Chr009SourceEntry extends JsonObject {
  readonly creationCriticalPenaltyOrNull: -1 | -2 | -3 | -4 | -5 | null;
  readonly setEntryIndex: number;
  readonly value: number;
}

interface Chr009InitialProjectionCommon {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly raceChoice: RaceChoice;
  readonly wizardCheckpointId: string;
}

export type Chr009InitialProjectionValues = Chr009InitialProjectionCommon &
  (
    | {
        readonly assignmentMode: 'ROLLED_BIJECTION';
        readonly sourceEntries: readonly Chr009SourceEntry[];
        readonly sourceSetReceiptIdOrNull: string;
      }
    | {
        readonly assignmentMode: 'POINT_BUY_85' | 'POINT_BUY_90';
        readonly sourceSetReceiptIdOrNull: null;
      }
  );

export interface StatModifierProjection extends JsonObject {
  readonly delta: number;
  readonly statCode: StatCode;
}

export interface MandatoryClassSkillProjection extends JsonObject {
  readonly bonus: number;
  readonly skillKey: string;
  readonly slotCost: number;
}

export interface PureClassOptionProjection extends JsonObject {
  readonly classConsequences: {
    readonly statModifiers: readonly StatModifierProjection[];
  };
  readonly mandatoryClassSkill: MandatoryClassSkillProjection;
  readonly pureClass: ClassCode;
}

export interface Chr011InitialProjectionValues {
  readonly characterDraftId: string;
  readonly classOptions: readonly PureClassOptionProjection[];
  readonly draftRevision: number;
  readonly wizardCheckpointId: string;
}

export type StatMapProjection = Readonly<Record<StatCode, number>>;

export interface Chr012ProjectionValues {
  readonly baseStats: StatMapProjection;
  readonly characterDraftId: string;
  readonly classModifiersOrNull: readonly StatModifierProjection[] | null;
  readonly draftRevision: number;
  readonly mandatoryClassSkillOrNull: MandatoryClassSkillProjection | null;
  readonly raceModifiers: readonly StatModifierProjection[];
  readonly skillStageStats: StatMapProjection;
  readonly wizardCheckpointId: string;
}

export interface SkillLevelOptionProjection extends JsonObject {
  readonly slotCost: number;
  readonly targetBonus: number;
}

export interface SkillRequirementProjection extends JsonObject {
  readonly currentValue: number;
  readonly minValue: number;
  readonly satisfied: boolean;
  readonly statCode: StatCode;
  readonly statLabel: string;
}

export type MissingSkillPenaltyProjection =
  | Readonly<{ readonly kind: 'NO_MISSING_SKILL_PENALTY' }>
  | Readonly<{
      readonly kind: 'MISSING_SKILL_PENALTY';
      readonly value: number;
    }>;

export interface SkillCardSummaryProjection extends JsonObject {
  readonly bonusDomainScope: string;
  readonly eligibility: 'ELIGIBLE' | 'REQUIREMENTS_NOT_MET';
  readonly levelOptions: readonly SkillLevelOptionProjection[];
  readonly missingSkillPenalty: MissingSkillPenaltyProjection;
  readonly requirements: readonly SkillRequirementProjection[];
  readonly skillId: string;
  readonly skillLabel: string;
}

export interface FixedSkillProjection extends JsonObject {
  readonly bonus: number;
  readonly skillId: string;
  readonly skillLabel: string;
  readonly slotCost: number;
}

export interface SkillSlotSourcesProjection extends JsonObject {
  readonly mandatoryClassSkillOrNull: FixedSkillProjection | null;
  readonly racialFreeSkills: readonly FixedSkillProjection[];
  readonly requiredSlotCount: number;
}

export interface Chr013ProjectionValues {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly eligibleSkillIds: readonly string[];
  readonly skillCardSummaries: readonly SkillCardSummaryProjection[];
  readonly skillStageStats: StatMapProjection;
  readonly slotSources: SkillSlotSourcesProjection;
  readonly wizardCheckpointId: string;
}

export interface Chr013Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly commandId: null;
  readonly draftRevision: number;
  readonly eligibleSkillIds: readonly string[];
  readonly selectedSkillIdOrNull: null;
  readonly skillCardSummaries: readonly SkillCardSummaryProjection[];
  readonly skillStageStats: StatMapProjection;
  readonly slotSources: SkillSlotSourcesProjection;
  readonly wizardCheckpointId: string;
}

export interface SelectedSkillProjection extends JsonObject {
  readonly skillId: string;
  readonly slotCost: number;
  readonly targetBonus: number;
}

export interface SkillOptionProjection extends JsonObject {
  readonly bonusDomainScope: string;
  readonly levelOptions: readonly SkillLevelOptionProjection[];
  readonly missingSkillPenalty: MissingSkillPenaltyProjection;
  readonly skillId: string;
  readonly skillLabel: string;
}

export interface PaidSkillUsageEntryProjection extends JsonObject {
  readonly bonus: number;
  readonly skillId: string;
  readonly skillLabel: string;
  readonly slotCost: number;
  readonly source: 'CLASS_MANDATORY' | 'SELECTED';
}

export interface PaidSlotUsageProjection extends JsonObject {
  readonly entries: readonly PaidSkillUsageEntryProjection[];
  readonly usedSlotCount: number;
}

export interface UnderfilledSkillSelectionValidation extends JsonObject {
  readonly kind: 'UNDERFILLED';
  readonly missingSlotCount: number;
  readonly requiredSlotCount: number;
  readonly usedSlotCount: number;
}

export interface ExactSkillSelectionValidation extends JsonObject {
  readonly kind: 'EXACT';
  readonly requiredSlotCount: number;
  readonly usedSlotCount: number;
}

export interface OverfilledSkillSelectionValidation extends JsonObject {
  readonly excessSlotCount: number;
  readonly kind: 'OVERFILLED';
  readonly requiredSlotCount: number;
  readonly usedSlotCount: number;
}

export type SkillSelectionValidation =
  | UnderfilledSkillSelectionValidation
  | ExactSkillSelectionValidation
  | OverfilledSkillSelectionValidation;

export interface Chr015ProjectionValues {
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly draftRevision: number;
  readonly eligibleSkillIds: readonly string[];
  readonly mandatoryClassSkillOrNull: FixedSkillProjection | null;
  readonly paidSlotUsage: PaidSlotUsageProjection;
  readonly racialFreeSkillIds: readonly string[];
  readonly racialFreeSkills: readonly FixedSkillProjection[];
  readonly requiredSlotCount: number;
  readonly selectedSkillIds: readonly string[];
  readonly selectedSkills: readonly SelectedSkillProjection[];
  readonly selectionValidation: SkillSelectionValidation;
  readonly skillOptions: readonly SkillOptionProjection[];
  readonly wizardCheckpointId: string;
}

export interface Chr015Projection extends JsonObject, Chr015ProjectionValues {}

const STAT_CODES = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const satisfies readonly StatCode[];
const PURE_CLASSES = ['SEEKER', 'STALKER', 'SOLDIER'] as const satisfies readonly ClassCode[];

function assertProjectionAuthority(
  formId: string,
  characterDraftId: string,
  wizardCheckpointId: string,
  draftRevision: number,
): void {
  nonEmpty(characterDraftId, `${formId} characterDraftId`);
  nonEmpty(wizardCheckpointId, `${formId} wizardCheckpointId`);
  if (!Number.isSafeInteger(draftRevision) || draftRevision < 0) {
    throw new Error(`${formId} draftRevision must be a non-negative safe integer`);
  }
}

function copyStatMap(value: StatMapProjection, label: string): Record<StatCode, number> {
  const keys = Object.keys(value);
  if (
    keys.length !== STAT_CODES.length ||
    !keys.every((key) => STAT_CODES.includes(key as StatCode))
  ) {
    throw new Error(`${label} must contain exact StatCode keys ${STAT_CODES.join(',')}`);
  }
  const result = {} as Record<StatCode, number>;
  for (const statCode of STAT_CODES) {
    const statValue = value[statCode];
    if (!Number.isSafeInteger(statValue)) {
      throw new Error(`${label}.${statCode} must be a safe integer`);
    }
    result[statCode] = statValue;
  }
  return result;
}

function copyModifiers(
  value: readonly StatModifierProjection[],
  label: string,
): StatModifierProjection[] {
  return value.map((modifier, index) => {
    if (!STAT_CODES.includes(modifier.statCode) || !Number.isSafeInteger(modifier.delta)) {
      throw new Error(`${label}[${String(index)}] must contain StatCode and safe integer delta`);
    }
    return { delta: modifier.delta, statCode: modifier.statCode };
  });
}

function copyMandatoryClassSkill(
  value: MandatoryClassSkillProjection,
  label: string,
): MandatoryClassSkillProjection {
  nonEmpty(value.skillKey, `${label}.skillKey`);
  if (
    !Number.isSafeInteger(value.bonus) ||
    !Number.isSafeInteger(value.slotCost) ||
    value.slotCost < 0
  ) {
    throw new Error(`${label} bonus and slotCost must be safe integers`);
  }
  return { bonus: value.bonus, skillKey: value.skillKey, slotCost: value.slotCost };
}

export function projectInitialChr009(values: Chr009InitialProjectionValues): JsonObject {
  assertProjectionAuthority(
    CHR_009_FORM_ID,
    values.characterDraftId,
    values.wizardCheckpointId,
    values.draftRevision,
  );
  if (
    values.assignmentMode !== 'ROLLED_BIJECTION' &&
    values.assignmentMode !== 'POINT_BUY_90' &&
    values.assignmentMode !== 'POINT_BUY_85'
  ) {
    throw new Error(
      `CHR-009 has unrecognized assignmentMode ${JSON.stringify(values.assignmentMode)}`,
    );
  }
  let bijectionProofOrExactSum: JsonObject;
  let eachValueRange: JsonObject | null;
  if (values.assignmentMode === 'ROLLED_BIJECTION') {
    nonEmpty(values.sourceSetReceiptIdOrNull, 'CHR-009 source set receipt');
    if (
      values.sourceEntries.length !== STAT_CODES.length ||
      values.sourceEntries.some(({ setEntryIndex }, index) => setEntryIndex !== index)
    ) {
      throw new Error('CHR-009 rolled sourceEntries must contain canonical indices 0..6');
    }
    const sourceEntries = values.sourceEntries.map((entry) => {
      if (!Number.isSafeInteger(entry.value)) {
        throw new Error(`CHR-009 sourceEntries[${String(entry.setEntryIndex)}].value must be safe`);
      }
      if (
        entry.creationCriticalPenaltyOrNull !== null &&
        ![-1, -2, -3, -4, -5].includes(entry.creationCriticalPenaltyOrNull)
      ) {
        throw new Error(
          `CHR-009 sourceEntries[${String(entry.setEntryIndex)}] has invalid critical penalty`,
        );
      }
      return { ...entry };
    });
    bijectionProofOrExactSum = {
      assignedSetEntryIndexByStat: null,
      kind: 'ROLLED_BIJECTION',
      sourceEntries,
    };
    eachValueRange = null;
  } else {
    if (values.sourceSetReceiptIdOrNull !== null) {
      throw new Error('CHR-009 point-buy sourceSetReceiptIdOrNull must be null');
    }
    bijectionProofOrExactSum = {
      actualTotal: null,
      kind: 'EXACT_SUM',
      requiredTotal: values.assignmentMode === 'POINT_BUY_90' ? 90 : 85,
    };
    // ADR 0044 §2 materializes the source-owned point-buy range exactly here.
    eachValueRange = { maximum: 20, minimum: 1 };
  }
  return {
    C: null,
    D: null,
    I: null,
    M: null,
    S: null,
    W: null,
    Z: null,
    assignmentMode: values.assignmentMode,
    assignmentValidation: null,
    bijectionProofOrExactSum,
    characterDraftId: values.characterDraftId,
    commandId: null,
    draftRevision: values.draftRevision,
    eachValueRange,
    raceChoice: values.raceChoice,
    sourceSetReceiptIdOrNull: values.sourceSetReceiptIdOrNull,
    wizardCheckpointId: values.wizardCheckpointId,
  };
}

export function projectInitialChr011(values: Chr011InitialProjectionValues): JsonObject {
  assertProjectionAuthority(
    CHR_011_FORM_ID,
    values.characterDraftId,
    values.wizardCheckpointId,
    values.draftRevision,
  );
  if (
    values.classOptions.length !== PURE_CLASSES.length ||
    values.classOptions.some(({ pureClass }, index) => pureClass !== PURE_CLASSES[index])
  ) {
    throw new Error('CHR-011 classOptions must use canonical SEEKER,STALKER,SOLDIER order');
  }
  const classOptions = values.classOptions.map((option, index) => ({
    classConsequences: {
      statModifiers: copyModifiers(
        option.classConsequences.statModifiers,
        `CHR-011 classOptions[${String(index)}].classConsequences.statModifiers`,
      ),
    },
    mandatoryClassSkill: copyMandatoryClassSkill(
      option.mandatoryClassSkill,
      `CHR-011 classOptions[${String(index)}].mandatoryClassSkill`,
    ),
    pureClass: option.pureClass,
  }));
  return {
    characterDraftId: values.characterDraftId,
    classConsequences: null,
    classOptions,
    commandId: null,
    draftRevision: values.draftRevision,
    mandatoryClassSkill: null,
    pureClass: null,
    raceChoice: 'PURE',
    wizardCheckpointId: values.wizardCheckpointId,
  };
}

export function projectChr012(values: Chr012ProjectionValues): JsonObject {
  assertProjectionAuthority(
    CHR_012_FORM_ID,
    values.characterDraftId,
    values.wizardCheckpointId,
    values.draftRevision,
  );
  if ((values.classModifiersOrNull === null) !== (values.mandatoryClassSkillOrNull === null)) {
    throw new Error('CHR-012 class modifiers and mandatory class skill must share nullability');
  }
  return {
    baseStats: copyStatMap(values.baseStats, 'CHR-012 baseStats'),
    characterDraftId: values.characterDraftId,
    classModifiersOrNull:
      values.classModifiersOrNull === null
        ? null
        : copyModifiers(values.classModifiersOrNull, 'CHR-012 classModifiersOrNull'),
    commandId: null,
    draftRevision: values.draftRevision,
    mandatoryClassSkillOrNull:
      values.mandatoryClassSkillOrNull === null
        ? null
        : copyMandatoryClassSkill(
            values.mandatoryClassSkillOrNull,
            'CHR-012 mandatoryClassSkillOrNull',
          ),
    raceModifiers: copyModifiers(values.raceModifiers, 'CHR-012 raceModifiers'),
    skillStageStats: copyStatMap(values.skillStageStats, 'CHR-012 skillStageStats'),
    symbiontModifiersExcluded: true,
    wizardCheckpointId: values.wizardCheckpointId,
  };
}

function assertExactProjectionKeys(
  value: object,
  label: string,
  expectedKeys: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(
      `${label} must contain exact fields ${expectedKeys.join(',')}; got ${actual.join(',')}`,
    );
  }
}

function projectionInteger(value: number, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer >= ${String(minimum)}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function playerSkillId(value: string, label: string): string {
  nonEmpty(value, label);
  if (/^(?:CORE|Q|REQ|SKL)-/u.test(value)) {
    throw new Error(`${label} must be a public SkillKey, not an internal registry ID`);
  }
  return value;
}

function playerLabel(value: string, label: string): string {
  nonEmpty(value, label);
  return value;
}

function copyPlayerSkillIds(values: readonly string[], label: string): string[] {
  const result = values.map((value, index) => playerSkillId(value, `${label}[${String(index)}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} must contain unique IDs`);
  return result;
}

function sameStringsExact(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function copySkillLevelOptions(
  values: readonly SkillLevelOptionProjection[],
  label: string,
): SkillLevelOptionProjection[] {
  let previousSlotCost = 0;
  return values.map((option, index) => {
    assertExactProjectionKeys(option, `${label}[${String(index)}]`, ['slotCost', 'targetBonus']);
    const targetBonus = projectionInteger(
      option.targetBonus,
      `${label}[${String(index)}].targetBonus`,
      1,
    );
    const slotCost = projectionInteger(option.slotCost, `${label}[${String(index)}].slotCost`, 1);
    if (targetBonus !== index + 1 || slotCost < previousSlotCost) {
      throw new Error(`${label} must use contiguous target bonuses and nondecreasing slot costs`);
    }
    previousSlotCost = slotCost;
    return { slotCost, targetBonus };
  });
}

function copySkillRequirements(
  values: readonly SkillRequirementProjection[],
  skillStageStats: StatMapProjection,
  label: string,
): SkillRequirementProjection[] {
  if (values.length === 0) throw new Error(`${label} must be non-empty`);
  let previousStatIndex = -1;
  return values.map((requirement, index) => {
    const path = `${label}[${String(index)}]`;
    assertExactProjectionKeys(requirement, path, [
      'currentValue',
      'minValue',
      'satisfied',
      'statCode',
      'statLabel',
    ]);
    if (!STAT_CODES.includes(requirement.statCode)) {
      throw new Error(`${path}.statCode is not a recognized StatCode`);
    }
    const statIndex = STAT_CODES.indexOf(requirement.statCode);
    if (statIndex <= previousStatIndex) {
      throw new Error(`${label} must use unique canonical StatCode order`);
    }
    previousStatIndex = statIndex;
    const minValue = projectionInteger(requirement.minValue, `${path}.minValue`, 1);
    const currentValue = projectionInteger(
      requirement.currentValue,
      `${path}.currentValue`,
      Number.MIN_SAFE_INTEGER,
    );
    if (currentValue !== skillStageStats[requirement.statCode]) {
      throw new Error(`${path}.currentValue disagrees with skillStageStats`);
    }
    const expectedSatisfied = currentValue >= minValue;
    if (requirement.satisfied !== expectedSatisfied) {
      throw new Error(`${path}.satisfied disagrees with currentValue/minValue`);
    }
    return {
      currentValue,
      minValue,
      satisfied: expectedSatisfied,
      statCode: requirement.statCode,
      statLabel: playerLabel(requirement.statLabel, `${path}.statLabel`),
    };
  });
}

function copyMissingSkillPenalty(value: unknown, label: string): MissingSkillPenaltyProjection {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  if (candidate['kind'] === 'NO_MISSING_SKILL_PENALTY') {
    assertExactProjectionKeys(candidate, label, ['kind']);
    return { kind: 'NO_MISSING_SKILL_PENALTY' };
  }
  if (candidate['kind'] !== 'MISSING_SKILL_PENALTY') {
    throw new Error(`${label}.kind is not a recognized missing-skill-penalty variant`);
  }
  assertExactProjectionKeys(candidate, label, ['kind', 'value']);
  const penaltyValue = candidate['value'];
  if (typeof penaltyValue !== 'number' || !Number.isSafeInteger(penaltyValue)) {
    throw new Error(`${label}.value must be a signed safe integer`);
  }
  return { kind: 'MISSING_SKILL_PENALTY', value: penaltyValue };
}

function copySkillCardSummaries(
  values: readonly SkillCardSummaryProjection[],
  skillStageStats: StatMapProjection,
  label: string,
): SkillCardSummaryProjection[] {
  // Source-owned count: all 41 SELECTABLE_GENERAL rows, including ineligible rows.
  if (values.length !== 41) throw new Error(`${label} must contain all 41 selectable skills`);
  const seen = new Set<string>();
  const cards = values.map((card, index) => {
    const path = `${label}[${String(index)}]`;
    assertExactProjectionKeys(card, path, [
      'bonusDomainScope',
      'eligibility',
      'levelOptions',
      'missingSkillPenalty',
      'requirements',
      'skillId',
      'skillLabel',
    ]);
    const skillId = playerSkillId(card.skillId, `${path}.skillId`);
    if (seen.has(skillId)) throw new Error(`${label} contains duplicate skillId ${skillId}`);
    seen.add(skillId);
    const requirements = copySkillRequirements(
      card.requirements,
      skillStageStats,
      `${path}.requirements`,
    );
    const eligibility: SkillCardSummaryProjection['eligibility'] = requirements.every(
      ({ satisfied }) => satisfied,
    )
      ? 'ELIGIBLE'
      : 'REQUIREMENTS_NOT_MET';
    if (card.eligibility !== eligibility) {
      throw new Error(`${path}.eligibility disagrees with its requirement rows`);
    }
    return {
      bonusDomainScope: playerLabel(card.bonusDomainScope, `${path}.bonusDomainScope`),
      eligibility,
      levelOptions: copySkillLevelOptions(card.levelOptions, `${path}.levelOptions`),
      missingSkillPenalty: copyMissingSkillPenalty(
        card.missingSkillPenalty,
        `${path}.missingSkillPenalty`,
      ),
      requirements,
      skillId,
      skillLabel: playerLabel(card.skillLabel, `${path}.skillLabel`),
    };
  });
  const populatedPenaltyCount = cards.filter(
    ({ missingSkillPenalty }) => missingSkillPenalty.kind === 'MISSING_SKILL_PENALTY',
  ).length;
  // Source-owned selectable population from issue #131: 15 present, 26 absent.
  if (populatedPenaltyCount !== 15) {
    throw new Error(
      `${label} must contain 15 populated missing-skill penalties, got ${String(populatedPenaltyCount)}`,
    );
  }
  return cards;
}

function copyFixedSkill(
  value: FixedSkillProjection,
  label: string,
  expectedSlotCost: 0 | 1,
): FixedSkillProjection {
  assertExactProjectionKeys(value, label, ['bonus', 'skillId', 'skillLabel', 'slotCost']);
  const slotCost = projectionInteger(value.slotCost, `${label}.slotCost`, 0);
  if (slotCost !== expectedSlotCost) {
    throw new Error(`${label}.slotCost must equal ${String(expectedSlotCost)}`);
  }
  return {
    bonus: projectionInteger(value.bonus, `${label}.bonus`, 1),
    skillId: playerSkillId(value.skillId, `${label}.skillId`),
    skillLabel: playerLabel(value.skillLabel, `${label}.skillLabel`),
    slotCost,
  };
}

function copySkillSlotSources(
  value: SkillSlotSourcesProjection,
  label: string,
): SkillSlotSourcesProjection {
  assertExactProjectionKeys(value, label, [
    'mandatoryClassSkillOrNull',
    'racialFreeSkills',
    'requiredSlotCount',
  ]);
  if (value.racialFreeSkills.length > 1) {
    throw new Error(`${label}.racialFreeSkills must be empty or singleton`);
  }
  const mandatoryClassSkillOrNull =
    value.mandatoryClassSkillOrNull === null
      ? null
      : copyFixedSkill(value.mandatoryClassSkillOrNull, `${label}.mandatoryClassSkillOrNull`, 1);
  const racialFreeSkills = value.racialFreeSkills.map((skill, index) =>
    copyFixedSkill(skill, `${label}.racialFreeSkills[${String(index)}]`, 0),
  );
  if (mandatoryClassSkillOrNull !== null && racialFreeSkills.length !== 0) {
    throw new Error(`${label} cannot combine a PURE class skill with a racial free skill`);
  }
  return {
    mandatoryClassSkillOrNull,
    racialFreeSkills,
    requiredSlotCount: projectionInteger(value.requiredSlotCount, `${label}.requiredSlotCount`, 1),
  };
}

export function projectChr013(values: Chr013ProjectionValues): Chr013Projection {
  assertProjectionAuthority(
    CHR_013_FORM_ID,
    values.characterDraftId,
    values.wizardCheckpointId,
    values.draftRevision,
  );
  const skillStageStats = copyStatMap(values.skillStageStats, 'CHR-013 skillStageStats');
  const skillCardSummaries = copySkillCardSummaries(
    values.skillCardSummaries,
    skillStageStats,
    'CHR-013 skillCardSummaries',
  );
  const eligibleSkillIds = copyPlayerSkillIds(values.eligibleSkillIds, 'CHR-013 eligibleSkillIds');
  const expectedEligibleSkillIds = skillCardSummaries
    .filter(({ eligibility }) => eligibility === 'ELIGIBLE')
    .map(({ skillId }) => skillId);
  if (!sameStringsExact(eligibleSkillIds, expectedEligibleSkillIds)) {
    throw new Error('CHR-013 eligibleSkillIds must equal the canonical ELIGIBLE card subset');
  }
  const slotSources = copySkillSlotSources(values.slotSources, 'CHR-013 slotSources');
  const fixedIds = [
    ...(slotSources.mandatoryClassSkillOrNull === null
      ? []
      : [slotSources.mandatoryClassSkillOrNull.skillId]),
    ...slotSources.racialFreeSkills.map(({ skillId }) => skillId),
  ];
  if (fixedIds.some((skillId) => skillCardSummaries.some((card) => card.skillId === skillId))) {
    throw new Error('CHR-013 fixed skills must not appear in the selectable catalog');
  }
  return {
    characterDraftId: values.characterDraftId,
    commandId: null,
    draftRevision: values.draftRevision,
    eligibleSkillIds,
    selectedSkillIdOrNull: null,
    skillCardSummaries,
    skillStageStats,
    slotSources,
    wizardCheckpointId: values.wizardCheckpointId,
  };
}

function copySkillOptions(
  values: readonly SkillOptionProjection[],
  label: string,
): SkillOptionProjection[] {
  const seen = new Set<string>();
  return values.map((option, index) => {
    const path = `${label}[${String(index)}]`;
    assertExactProjectionKeys(option, path, [
      'bonusDomainScope',
      'levelOptions',
      'missingSkillPenalty',
      'skillId',
      'skillLabel',
    ]);
    const skillId = playerSkillId(option.skillId, `${path}.skillId`);
    if (seen.has(skillId)) throw new Error(`${label} contains duplicate skillId ${skillId}`);
    seen.add(skillId);
    return {
      bonusDomainScope: playerLabel(option.bonusDomainScope, `${path}.bonusDomainScope`),
      levelOptions: copySkillLevelOptions(option.levelOptions, `${path}.levelOptions`),
      missingSkillPenalty: copyMissingSkillPenalty(
        option.missingSkillPenalty,
        `${path}.missingSkillPenalty`,
      ),
      skillId,
      skillLabel: playerLabel(option.skillLabel, `${path}.skillLabel`),
    };
  });
}

function copySelectedSkills(
  values: readonly SelectedSkillProjection[],
  label: string,
): SelectedSkillProjection[] {
  const seen = new Set<string>();
  return values.map((selected, index) => {
    const path = `${label}[${String(index)}]`;
    assertExactProjectionKeys(selected, path, ['skillId', 'slotCost', 'targetBonus']);
    const skillId = playerSkillId(selected.skillId, `${path}.skillId`);
    if (seen.has(skillId)) throw new Error(`${label} contains duplicate skillId ${skillId}`);
    seen.add(skillId);
    return {
      skillId,
      slotCost: projectionInteger(selected.slotCost, `${path}.slotCost`, 1),
      targetBonus: projectionInteger(selected.targetBonus, `${path}.targetBonus`, 1),
    };
  });
}

function copyPaidSlotUsage(value: PaidSlotUsageProjection, label: string): PaidSlotUsageProjection {
  assertExactProjectionKeys(value, label, ['entries', 'usedSlotCount']);
  return {
    entries: value.entries.map((entry, index) => {
      const path = `${label}.entries[${String(index)}]`;
      assertExactProjectionKeys(entry, path, [
        'bonus',
        'skillId',
        'skillLabel',
        'slotCost',
        'source',
      ]);
      if (entry.source !== 'CLASS_MANDATORY' && entry.source !== 'SELECTED') {
        throw new Error(`${path}.source is not recognized`);
      }
      return {
        bonus: projectionInteger(entry.bonus, `${path}.bonus`, 1),
        skillId: playerSkillId(entry.skillId, `${path}.skillId`),
        skillLabel: playerLabel(entry.skillLabel, `${path}.skillLabel`),
        slotCost: projectionInteger(entry.slotCost, `${path}.slotCost`, 1),
        source: entry.source,
      };
    }),
    usedSlotCount: projectionInteger(value.usedSlotCount, `${label}.usedSlotCount`, 0),
  };
}

function copySkillSelectionValidation(
  value: SkillSelectionValidation,
  requiredSlotCount: number,
  usedSlotCount: number,
  label: string,
): SkillSelectionValidation {
  if (value.requiredSlotCount !== requiredSlotCount || value.usedSlotCount !== usedSlotCount) {
    throw new Error(`${label} counts disagree with requiredSlotCount/paidSlotUsage`);
  }
  switch (value.kind) {
    case 'UNDERFILLED': {
      assertExactProjectionKeys(value, label, [
        'kind',
        'missingSlotCount',
        'requiredSlotCount',
        'usedSlotCount',
      ]);
      const missingSlotCount = projectionInteger(
        value.missingSlotCount,
        `${label}.missingSlotCount`,
        1,
      );
      if (
        usedSlotCount >= requiredSlotCount ||
        missingSlotCount !== requiredSlotCount - usedSlotCount
      ) {
        throw new Error(`${label} is not an exact UNDERFILLED diagnostic`);
      }
      return { kind: value.kind, missingSlotCount, requiredSlotCount, usedSlotCount };
    }
    case 'EXACT':
      assertExactProjectionKeys(value, label, ['kind', 'requiredSlotCount', 'usedSlotCount']);
      if (usedSlotCount !== requiredSlotCount) {
        throw new Error(`${label} is not an exact EXACT diagnostic`);
      }
      return { kind: value.kind, requiredSlotCount, usedSlotCount };
    case 'OVERFILLED': {
      assertExactProjectionKeys(value, label, [
        'excessSlotCount',
        'kind',
        'requiredSlotCount',
        'usedSlotCount',
      ]);
      const excessSlotCount = projectionInteger(
        value.excessSlotCount,
        `${label}.excessSlotCount`,
        1,
      );
      if (
        usedSlotCount <= requiredSlotCount ||
        excessSlotCount !== usedSlotCount - requiredSlotCount
      ) {
        throw new Error(`${label} is not an exact OVERFILLED diagnostic`);
      }
      return { excessSlotCount, kind: value.kind, requiredSlotCount, usedSlotCount };
    }
    default:
      throw new Error(`${label}.kind is not recognized`);
  }
}

function paidUsageEntryMatches(
  actual: PaidSkillUsageEntryProjection,
  expected: PaidSkillUsageEntryProjection,
): boolean {
  return (
    actual.bonus === expected.bonus &&
    actual.skillId === expected.skillId &&
    actual.skillLabel === expected.skillLabel &&
    actual.slotCost === expected.slotCost &&
    actual.source === expected.source
  );
}

export function projectChr015(values: Chr015ProjectionValues): Chr015Projection {
  assertProjectionAuthority(
    CHR_015_FORM_ID,
    values.characterDraftId,
    values.wizardCheckpointId,
    values.draftRevision,
  );
  if (values.commandId !== null) nonEmpty(values.commandId, 'CHR-015 commandId');
  const eligibleSkillIds = copyPlayerSkillIds(values.eligibleSkillIds, 'CHR-015 eligibleSkillIds');
  const skillOptions = copySkillOptions(values.skillOptions, 'CHR-015 skillOptions');
  if (
    !sameStringsExact(
      eligibleSkillIds,
      skillOptions.map(({ skillId }) => skillId),
    )
  ) {
    throw new Error('CHR-015 skillOptions must exactly follow eligibleSkillIds');
  }
  const selectedSkills = copySelectedSkills(values.selectedSkills, 'CHR-015 selectedSkills');
  const selectedSkillIds = copyPlayerSkillIds(values.selectedSkillIds, 'CHR-015 selectedSkillIds');
  if (
    !sameStringsExact(
      selectedSkillIds,
      selectedSkills.map(({ skillId }) => skillId),
    )
  ) {
    throw new Error('CHR-015 selectedSkillIds must exactly mirror selectedSkills');
  }
  let previousOptionIndex = -1;
  for (const [index, selected] of selectedSkills.entries()) {
    const optionIndex = skillOptions.findIndex(({ skillId }) => skillId === selected.skillId);
    if (optionIndex <= previousOptionIndex) {
      throw new Error('CHR-015 selectedSkills must be a canonical skillOptions subset');
    }
    previousOptionIndex = optionIndex;
    const level = skillOptions[optionIndex]?.levelOptions.find(
      ({ targetBonus }) => targetBonus === selected.targetBonus,
    );
    if (level === undefined || level.slotCost !== selected.slotCost) {
      throw new Error(
        `CHR-015 selectedSkills[${String(index)}] must match a signed skill level option`,
      );
    }
  }
  if (values.commandId === null && selectedSkills.length !== 0) {
    throw new Error('CHR-015 initial host projection cannot contain client-local selection');
  }

  const mandatoryClassSkillOrNull =
    values.mandatoryClassSkillOrNull === null
      ? null
      : copyFixedSkill(values.mandatoryClassSkillOrNull, 'CHR-015 mandatoryClassSkillOrNull', 1);
  if (
    mandatoryClassSkillOrNull !== null &&
    eligibleSkillIds.includes(mandatoryClassSkillOrNull.skillId)
  ) {
    throw new Error('CHR-015 mandatory class skill cannot be selectable');
  }
  if (values.racialFreeSkills.length > 1) {
    throw new Error('CHR-015 racialFreeSkills must be empty or singleton');
  }
  const racialFreeSkills = values.racialFreeSkills.map((skill, index) =>
    copyFixedSkill(skill, `CHR-015 racialFreeSkills[${String(index)}]`, 0),
  );
  const racialFreeSkillIds = copyPlayerSkillIds(
    values.racialFreeSkillIds,
    'CHR-015 racialFreeSkillIds',
  );
  if (
    !sameStringsExact(
      racialFreeSkillIds,
      racialFreeSkills.map(({ skillId }) => skillId),
    )
  ) {
    throw new Error('CHR-015 racialFreeSkillIds must exactly mirror racialFreeSkills');
  }
  if (
    (mandatoryClassSkillOrNull !== null && racialFreeSkills.length !== 0) ||
    racialFreeSkillIds.some((skillId) => eligibleSkillIds.includes(skillId))
  ) {
    throw new Error('CHR-015 fixed skill sources conflict with selectable skills');
  }

  const paidSlotUsage = copyPaidSlotUsage(values.paidSlotUsage, 'CHR-015 paidSlotUsage');
  const optionById = new Map(skillOptions.map((option) => [option.skillId, option]));
  const expectedEntries: PaidSkillUsageEntryProjection[] = [
    ...(mandatoryClassSkillOrNull === null
      ? []
      : [
          {
            bonus: mandatoryClassSkillOrNull.bonus,
            skillId: mandatoryClassSkillOrNull.skillId,
            skillLabel: mandatoryClassSkillOrNull.skillLabel,
            slotCost: mandatoryClassSkillOrNull.slotCost,
            source: 'CLASS_MANDATORY' as const,
          },
        ]),
    ...selectedSkills.map((selected): PaidSkillUsageEntryProjection => ({
      bonus: selected.targetBonus,
      skillId: selected.skillId,
      skillLabel: optionById.get(selected.skillId)!.skillLabel,
      slotCost: selected.slotCost,
      source: 'SELECTED',
    })),
  ];
  if (
    paidSlotUsage.entries.length !== expectedEntries.length ||
    paidSlotUsage.entries.some(
      (entry, index) =>
        expectedEntries[index] === undefined ||
        !paidUsageEntryMatches(entry, expectedEntries[index]),
    )
  ) {
    throw new Error('CHR-015 paidSlotUsage.entries must equal class plus selected skills');
  }
  const expectedUsedSlotCount = expectedEntries.reduce((sum, entry) => sum + entry.slotCost, 0);
  if (paidSlotUsage.usedSlotCount !== expectedUsedSlotCount) {
    throw new Error('CHR-015 paidSlotUsage.usedSlotCount disagrees with its entries');
  }
  const requiredSlotCount = projectionInteger(
    values.requiredSlotCount,
    'CHR-015 requiredSlotCount',
    1,
  );
  const selectionValidation = copySkillSelectionValidation(
    values.selectionValidation,
    requiredSlotCount,
    paidSlotUsage.usedSlotCount,
    'CHR-015 selectionValidation',
  );
  if (values.commandId !== null && selectionValidation.kind !== 'EXACT') {
    throw new Error('CHR-015 checkpointed projection must have EXACT selectionValidation');
  }
  return {
    characterDraftId: values.characterDraftId,
    commandId: values.commandId,
    draftRevision: values.draftRevision,
    eligibleSkillIds,
    mandatoryClassSkillOrNull,
    paidSlotUsage,
    racialFreeSkillIds,
    racialFreeSkills,
    requiredSlotCount,
    selectedSkillIds,
    selectedSkills,
    selectionValidation,
    skillOptions,
    wizardCheckpointId: values.wizardCheckpointId,
  };
}
