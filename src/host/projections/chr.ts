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
  'CHR-012::CTA::001',
  'CHR-012::CTA::002',
  'CHR-012::CTA::003',
] as const satisfies readonly ActionKey[];
export const CHR_012_ACTION_KEYS = [] as const satisfies readonly ActionKey[];

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
