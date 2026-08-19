import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import {
  commitCreationCriticalConfirmation,
  createCreationCriticalChain,
  deriveCreationReturnDecisionFormId,
  resolveCreationStatSet,
  type CreationStatCriticalChainState,
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

export type CreationDecisionSourceFormId = 'CHR-002' | 'CHR-010' | 'CHR-016' | 'CHR-036';
export type CreationNextFormId =
  'CHR-002' | 'CHR-003' | 'CHR-004' | 'CHR-010' | 'CHR-016' | 'CHR-036';

interface CreationSetDecidePayloadCommon extends JsonObject {
  readonly stage: 'RACE_AND_METHOD';
  readonly sourceFormId: CreationDecisionSourceFormId;
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

export type CreationSetDecidePayload =
  | DiceInputDecisionPayload
  | RaceDecisionPayload
  | StatMethodDecisionPayload
  | SymbiontAcquisitionDecisionPayload;

export type CreationSetDecideCommandRequest = WorkflowCommandRequestMessage<
  typeof CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  CreationSetDecidePayload
>;

interface CreationSetDecideReceiptResultCommon extends JsonObject {
  readonly stage: 'RACE_AND_METHOD';
  readonly sourceFormId: CreationDecisionSourceFormId;
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

export type CreationSetDecideReceiptResult =
  | DiceInputDecisionReceiptResult
  | RaceDecisionReceiptResult
  | StatMethodDecisionReceiptResult
  | SymbiontAcquisitionDecisionReceiptResult;
export type CreationSetDecideReceipt = CommandReceipt<CreationSetDecideReceiptResult>;

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

export interface CreationSetDecideDecisionRecord {
  readonly request: CreationSetDecideCommandRequest;
  readonly derived: CreationSetDecideDerived;
  readonly receipt: CreationSetDecideReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope;
}

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
  'CHAIN_COMPLETE' | 'CRITICALS_PENDING' | 'DECISION_READY' | 'REQUEST_READY';

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
  readonly nextFormId: 'CHR-003' | 'CHR-004';
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
  readonly nextFormId: 'CHR-004';
}

export type CreationRollCommitReceiptResult =
  CriticalConfirmationRollReceiptResult | StatSetRollReceiptResult;
export type CreationRollCommitReceipt = CommandReceipt<CreationRollCommitReceiptResult>;

export interface StatSetRollRecord {
  readonly request: CreationRollCommitCommandRequest & {
    readonly payload: StatSetRollCommitPayload;
  };
  readonly receipt: CommandReceipt<StatSetRollReceiptResult>;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-003' | 'CHR-004'>;
}

export interface CriticalConfirmationRollRecord {
  readonly request: CreationRollCommitCommandRequest & {
    readonly payload: CriticalConfirmationRollCommitPayload;
  };
  readonly receipt: CommandReceipt<CriticalConfirmationRollReceiptResult>;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-004'>;
}

export interface StatRollStage {
  readonly branchUuid: string;
  readonly statMethod: StatMethod;
  readonly attemptIndex: number;
  readonly diceInputModeSnapshot: DiceInputMode;
  readonly setRollRequestId: string;
  readonly setRecord: StatSetRollRecord | null;
  readonly naturalCriticalQueue: readonly NaturalCriticalQueueItem[];
  readonly criticalQueueIndexOrNull: number | null;
  readonly confirmationRollRequestIdOrNull: string | null;
  readonly confirmationRecords: readonly CriticalConfirmationRollRecord[];
  readonly outcomes: readonly CreationCriticalOutcome[];
  readonly returnDecisionFormId: 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008';
  readonly state: StatRollStageState;
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
  readonly receipt: CreationSetDecideReceipt;
}

export interface CreationWizardStatRollPayload {
  readonly identityStage: CreationIdentityStage;
  readonly raceAndMethodStage: RaceAndMethodStage;
  readonly statRollStage: StatRollStage;
  readonly branchCacheEntries: readonly [];
  readonly selectedBranchUuidOrNull: null;
  readonly randomReceiptIds: readonly string[];
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-003' | 'CHR-004'>;
  readonly receipt: CreationRollCommitReceipt | CreationSetDecideReceipt;
}

export type CreationWizardPostIdentityPayload =
  CreationWizardPreRollPayload | CreationWizardStatRollPayload;

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
  readonly receipt:
    CreationRollCommitReceipt | CreationSetDecideReceipt | IdentityCheckpointReceipt;
  readonly request:
    | CreationRollCommitCommandRequest
    | CreationSetDecideCommandRequest
    | IdentityCheckpointCommandRequest;
}

export interface DurableCreationWizardCommand {
  readonly durableCheckpoint: DurableCreationWizardCheckpoint;
  readonly nextStageEnvelope: CreationNextStageEnvelope;
  readonly receipt:
    CreationRollCommitReceipt | CreationSetDecideReceipt | IdentityCheckpointReceipt;
  readonly request:
    | CreationRollCommitCommandRequest
    | CreationSetDecideCommandRequest
    | IdentityCheckpointCommandRequest;
}

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
  literal(unshapedPayload['stage'], 'RACE_AND_METHOD', '$.payload.stage');
  const sourceFormId = enumAt(unshapedPayload['sourceFormId'], '$.payload.sourceFormId', [
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
  const payload = exactObject(request.payload, '$.payload', [...COMMON_PAYLOAD_KEYS, decisionKey]);
  const common = {
    characterDraftId: stringAt(payload['characterDraftId'], '$.payload.characterDraftId'),
    draftRevision: revisionAt(payload['draftRevision'], '$.payload.draftRevision'),
    stage: 'RACE_AND_METHOD' as const,
    wizardCheckpointId: stringAt(payload['wizardCheckpointId'], '$.payload.wizardCheckpointId'),
  };
  let normalizedPayload: CreationSetDecidePayload;
  switch (sourceFormId) {
    case 'CHR-010':
      normalizedPayload = {
        ...common,
        raceChoice: enumAt(payload['raceChoice'], '$.payload.raceChoice', RACE_CHOICES),
        sourceFormId,
      };
      break;
    case 'CHR-016':
      normalizedPayload = {
        ...common,
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
        sourceFormId,
      };
      break;
    case 'CHR-002':
      normalizedPayload = {
        ...common,
        sourceFormId,
        statMethod: enumAt(payload['statMethod'], '$.payload.statMethod', STAT_METHODS),
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

const derivedForRequest = (request: CreationSetDecideCommandRequest): CreationSetDecideDerived => {
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

const nextFormForPayload = (payload: CreationSetDecidePayload): CreationNextFormId => {
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

const creationReceiptAt = (value: unknown, path: string): CreationSetDecideReceipt => {
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
  let parsedResult: CreationSetDecideReceiptResult;
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
  | IdentityCheckpointCommandRequest => {
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
      cause instanceof CreationRollCommitApplicationError
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
  const expectedDerived = derivedForRequest(request);
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
    receipt: creationReceiptAt(object['receipt'], `${path}.receipt`),
    request,
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
        'CHR-003',
        'CHR-004',
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
      nextFormId: literal(result['nextFormId'], 'CHR-004', `${resultPath}.nextFormId`),
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
    ) as CreationNextStageEnvelope<'CHR-003' | 'CHR-004'>,
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
    ) as CreationNextStageEnvelope<'CHR-004'>,
    receipt: receipt as CommandReceipt<CriticalConfirmationRollReceiptResult>,
    request: request as CriticalConfirmationRollRecord['request'],
  };
};

const statRollStageAt = (value: unknown, label: string): StatRollStage => {
  const path = '$.statRollStage';
  const object = exactObject(value, path, [
    'branchUuid',
    'statMethod',
    'attemptIndex',
    'diceInputModeSnapshot',
    'setRollRequestId',
    'setRecord',
    'naturalCriticalQueue',
    'criticalQueueIndexOrNull',
    'confirmationRollRequestIdOrNull',
    'confirmationRecords',
    'outcomes',
    'returnDecisionFormId',
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
    branchUuid: nonEmptyStringAt(object['branchUuid'], `${path}.branchUuid`),
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
    diceInputModeSnapshot: enumAt(
      object['diceInputModeSnapshot'],
      `${path}.diceInputModeSnapshot`,
      DICE_INPUT_MODES,
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
    statMethod: enumAt(object['statMethod'], `${path}.statMethod`, STAT_METHODS),
    state: enumAt(object['state'], `${path}.state`, [
      'REQUEST_READY',
      'CRITICALS_PENDING',
      'DECISION_READY',
      'CHAIN_COMPLETE',
    ] as const),
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
  request: CreationSetDecideCommandRequest,
  checkpointRevision: number,
  draftRevision: number,
  methodAllocation?: CreationStatRollAllocation,
): CreationSetDecideReceiptResult => {
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
    const object = exactObject(
      value,
      '$',
      hasStatRollStage ? STAT_ROLL_PAYLOAD_KEYS : POST_IDENTITY_PAYLOAD_KEYS,
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
    const receipt =
      receiptResult['stage'] === 'STAT_ROLLS'
        ? creationRollReceiptAt(object['receipt'], '$.receipt')
        : creationReceiptAt(object['receipt'], '$.receipt');
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
    return {
      ...common,
      nextStageEnvelope: common.nextStageEnvelope as CreationNextStageEnvelope<
        'CHR-003' | 'CHR-004'
      >,
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
  readonly latestReceipt: CreationRollCommitReceipt | CreationSetDecideReceipt;
  readonly latestRequest: CreationRollCommitCommandRequest | CreationSetDecideCommandRequest;
  readonly revisions: RevisionVector;
}

const d20Mechanical = (face: number): { readonly dieSides: 20; readonly rawFace: number } => ({
  dieSides: 20,
  rawFace: face,
});

const validateStatRollHistory = (
  durablePayload: CreationWizardStatRollPayload,
  methodRecord: CreationSetDecideDecisionRecord,
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
  start: RollValidationCursor,
  commandIds: Set<string>,
  receiptIds: Set<string>,
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
  const expectedReturnDecisionFormId = deriveCreationReturnDecisionFormId(
    methodRequest.payload.statMethod,
    1,
  );
  if (stage.branchUuid !== methodReceipt.result.branchUuid) {
    mismatches.push('statRollStage branchUuid/method receipt');
  }
  if (stage.setRollRequestId !== methodReceipt.result.setRollRequestId) {
    mismatches.push('statRollStage setRollRequestId/method receipt');
  }
  if (stage.statMethod !== methodRequest.payload.statMethod) {
    mismatches.push('statRollStage statMethod/method request');
  }
  if (stage.attemptIndex !== 1) mismatches.push('statRollStage attemptIndex');
  if (stage.diceInputModeSnapshot !== durablePayload.raceAndMethodStage.diceInput?.value) {
    mismatches.push('statRollStage diceInputModeSnapshot/decision');
  }
  if (stage.returnDecisionFormId !== expectedReturnDecisionFormId) {
    mismatches.push('statRollStage returnDecisionFormId');
  }
  const allocatedIds = new Set<string>([
    localCharacter.localCharacterId,
    checkpoint.checkpointId,
    ...commandIds,
    ...receiptIds,
  ]);
  for (const [name, id] of [
    ['branchUuid', stage.branchUuid],
    ['setRollRequestId', stage.setRollRequestId],
  ] as const) {
    if (allocatedIds.has(id)) mismatches.push(`statRollStage ${name} ID collision`);
    allocatedIds.add(id);
  }

  let cursor = start;
  const expectedRandomReceiptIds: string[] = [];
  const setRecord = stage.setRecord;
  if (setRecord === null) {
    const expectedStage: StatRollStage = {
      attemptIndex: 1,
      branchUuid: methodReceipt.result.branchUuid,
      confirmationRecords: [],
      confirmationRollRequestIdOrNull: null,
      criticalQueueIndexOrNull: null,
      diceInputModeSnapshot: durablePayload.raceAndMethodStage.diceInput!.value,
      naturalCriticalQueue: [],
      outcomes: [],
      returnDecisionFormId: expectedReturnDecisionFormId,
      setRecord: null,
      setRollRequestId: methodReceipt.result.setRollRequestId,
      statMethod: methodRequest.payload.statMethod,
      state: 'REQUEST_READY',
    };
    if (!isDeepStrictEqual(stage, expectedStage)) {
      mismatches.push('statRollStage initial aggregate');
    }
    if (!isDeepStrictEqual(durablePayload.randomReceiptIds, expectedRandomReceiptIds)) {
      mismatches.push('randomReceiptIds before first result');
    }
    return cursor;
  }

  const setRequest = setRecord.request;
  const setReceipt = setRecord.receipt;
  const setResult = setReceipt.result;
  if (commandIds.has(setRequest.commandId)) mismatches.push('setRecord duplicate commandId');
  commandIds.add(setRequest.commandId);
  if (receiptIds.has(setReceipt.receiptId)) mismatches.push('setRecord duplicate receiptId');
  receiptIds.add(setReceipt.receiptId);
  if (allocatedIds.has(setReceipt.receiptId)) mismatches.push('setRecord receipt ID collision');
  allocatedIds.add(setReceipt.receiptId);
  if (setRequest.payload.characterDraftId !== localCharacter.localCharacterId) {
    mismatches.push('setRecord characterDraftId');
  }
  if (setRequest.payload.wizardCheckpointId !== checkpoint.checkpointId) {
    mismatches.push('setRecord wizardCheckpointId');
  }
  if (
    setRequest.payload.branchUuid !== stage.branchUuid ||
    setRequest.payload.setRollRequestId !== stage.setRollRequestId
  ) {
    mismatches.push('setRecord addressed request');
  }
  if (
    setRequest.payload.draftRevision !== cursor.draftRevision ||
    !isDeepStrictEqual(setRequest.expectedRevisions, cursor.revisions)
  ) {
    mismatches.push('setRecord pre-commit revisions');
  }
  const manualFaces = setRequest.payload.manualFacesOrNull;
  if (
    stage.diceInputModeSnapshot === 'AUTO'
      ? manualFaces !== null
      : manualFaces === null || !isDeepStrictEqual(manualFaces, setResult.faces)
  ) {
    mismatches.push('setRecord immutable input mode/manual faces');
  }
  const resolvedSet = resolveCreationStatSet(setResult.faces.map(d20Mechanical));
  const expectedQueue = resolvedSet.naturalCriticalQueue.map(({ originFace, setEntryIndex }) => ({
    originFace,
    setEntryIndex,
  }));
  const nextConfirmationRollRequestId = setResult.confirmationRollRequestIdOrNull;
  if ((expectedQueue.length === 0) !== (nextConfirmationRollRequestId === null)) {
    mismatches.push('setRecord initial confirmation request presence');
  }
  if (nextConfirmationRollRequestId !== null && allocatedIds.has(nextConfirmationRollRequestId)) {
    mismatches.push('setRecord confirmation request ID collision');
  }
  if (nextConfirmationRollRequestId !== null) allocatedIds.add(nextConfirmationRollRequestId);
  let postSetRevisions = cursor.revisions;
  try {
    postSetRevisions = incrementedRevisions(cursor.revisions);
  } catch {
    mismatches.push('setRecord entity revision overflow');
  }
  const expectedSetResult: StatSetRollReceiptResult = {
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    branchUuid: stage.branchUuid,
    characterDraftId: localCharacter.localCharacterId,
    checkpointId: checkpoint.checkpointId,
    checkpointOwnerId: localCharacter.localCharacterId,
    checkpointRevision: cursor.checkpointRevision + 1,
    confirmationRollRequestIdOrNull: nextConfirmationRollRequestId,
    diceInputModeSnapshot: stage.diceInputModeSnapshot,
    draftRevision: cursor.draftRevision + 1,
    faces: setResult.faces,
    naturalCriticalQueue: expectedQueue,
    nextFormId: expectedQueue.length === 0 ? 'CHR-003' : 'CHR-004',
    setRollReceiptId: setReceipt.receiptId,
    setRollRequestId: stage.setRollRequestId,
    shownResultLocked: true,
    sourceFormId: 'CHR-003',
    stage: 'STAT_ROLLS',
  };
  if (setReceipt.commandId !== setRequest.commandId) {
    mismatches.push('setRecord request/receipt commandId');
  }
  if (!isDeepStrictEqual(setResult, expectedSetResult)) {
    mismatches.push('setRecord receipt result');
  }
  if (!isDeepStrictEqual(setReceipt.revisions, postSetRevisions)) {
    mismatches.push('setRecord receipt revisions');
  }
  const expectedSetEnvelope = nextStageEnvelope(
    expectedSetResult.nextFormId,
    localCharacter.localCharacterId,
  );
  if (!isDeepStrictEqual(setRecord.nextStageEnvelope, expectedSetEnvelope)) {
    mismatches.push('setRecord signed destination');
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
  let pendingRequestId = nextConfirmationRollRequestId;
  let chain: CreationStatCriticalChainState | null =
    queueIndex === null ? null : createCreationCriticalChain(expectedQueue[queueIndex]!);
  const outcomes: CreationCriticalOutcome[] = [];

  for (const [recordIndex, record] of stage.confirmationRecords.entries()) {
    const recordLabel = `confirmationRecords[${String(recordIndex)}]`;
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
    if (receiptIds.has(receipt.receiptId)) mismatches.push(`${recordLabel} duplicate receiptId`);
    receiptIds.add(receipt.receiptId);
    if (allocatedIds.has(receipt.receiptId)) mismatches.push(`${recordLabel} receipt ID collision`);
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
    if (
      request.payload.draftRevision !== cursor.draftRevision ||
      !isDeepStrictEqual(request.expectedRevisions, cursor.revisions)
    ) {
      mismatches.push(`${recordLabel} pre-commit revisions`);
    }
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
      outcome === null ? queueIndex : queueIndex + 1 < expectedQueue.length ? queueIndex + 1 : null;
    const nextRequestId = result.nextConfirmationRollRequestIdOrNull;
    if ((nextQueueIndex === null) !== (nextRequestId === null)) {
      mismatches.push(`${recordLabel} next confirmation request presence`);
    }
    if (nextRequestId !== null && allocatedIds.has(nextRequestId)) {
      mismatches.push(`${recordLabel} next request ID collision`);
    }
    if (nextRequestId !== null) allocatedIds.add(nextRequestId);
    let postRevisions = cursor.revisions;
    try {
      postRevisions = incrementedRevisions(cursor.revisions);
    } catch {
      mismatches.push(`${recordLabel} entity revision overflow`);
    }
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
      nextFormId: 'CHR-004',
      originFace: queueItem.originFace,
      outcomeOrNull: outcome,
      returnDecisionFormId: expectedReturnDecisionFormId,
      setRollReceiptId: setReceipt.receiptId,
      sourceFormId: 'CHR-004',
      stage: 'STAT_ROLLS',
    };
    if (receipt.commandId !== request.commandId) {
      mismatches.push(`${recordLabel} request/receipt commandId`);
    }
    if (!isDeepStrictEqual(result, expectedResult)) {
      mismatches.push(`${recordLabel} receipt result`);
    }
    if (!isDeepStrictEqual(receipt.revisions, postRevisions)) {
      mismatches.push(`${recordLabel} receipt revisions`);
    }
    const expectedEnvelope = nextStageEnvelope('CHR-004', localCharacter.localCharacterId);
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

  const expectedState: StatRollStageState =
    expectedQueue.length === 0
      ? 'DECISION_READY'
      : queueIndex === null
        ? 'CHAIN_COMPLETE'
        : 'CRITICALS_PENDING';
  const expectedStage: StatRollStage = {
    attemptIndex: 1,
    branchUuid: methodReceipt.result.branchUuid,
    confirmationRecords: stage.confirmationRecords,
    confirmationRollRequestIdOrNull: pendingRequestId,
    criticalQueueIndexOrNull:
      expectedState === 'CHAIN_COMPLETE' ? expectedQueue.length - 1 : queueIndex,
    diceInputModeSnapshot: durablePayload.raceAndMethodStage.diceInput!.value,
    naturalCriticalQueue: expectedQueue,
    outcomes,
    returnDecisionFormId: expectedReturnDecisionFormId,
    setRecord,
    setRollRequestId: methodReceipt.result.setRollRequestId,
    statMethod: methodRequest.payload.statMethod,
    state: expectedState,
  };
  if (!isDeepStrictEqual(stage, expectedStage)) mismatches.push('statRollStage aggregate');
  if (!isDeepStrictEqual(durablePayload.randomReceiptIds, expectedRandomReceiptIds)) {
    mismatches.push('randomReceiptIds roll provenance');
  }
  return cursor;
};

const validatePostIdentityPayload = (
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
  durablePayload: CreationWizardPostIdentityPayload,
): DurableCreationWizardCheckpoint => {
  const label = `localCharacter ${JSON.stringify(localCharacter.localCharacterId)}`;
  const mismatches: string[] = [];
  const { identityStage, raceAndMethodStage } = durablePayload;
  const records = raceAndMethodStage.decisionRecords;
  const commandIds = new Set<string>([identityStage.request.commandId]);
  const receiptIds = new Set<string>([identityStage.receipt.receiptId]);
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
    if (receiptIds.has(receipt.receiptId)) mismatches.push(`${recordLabel} duplicate receiptId`);
    receiptIds.add(receipt.receiptId);
    if (payload.characterDraftId !== localCharacter.localCharacterId) {
      mismatches.push(`${recordLabel} characterDraftId`);
    }
    if (payload.wizardCheckpointId !== checkpoint.checkpointId) {
      mismatches.push(`${recordLabel} wizardCheckpointId`);
    }
    if (payload.draftRevision !== previousDraftRevision) {
      mismatches.push(`${recordLabel} pre-commit draftRevision`);
    }
    if (!isDeepStrictEqual(request.expectedRevisions, previousRevisions)) {
      mismatches.push(`${recordLabel} pre-commit revisions`);
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
    let expectedPostRevisions: RevisionVector;
    try {
      expectedPostRevisions = incrementedRevisions(previousRevisions);
    } catch {
      mismatches.push(`${recordLabel} entity revision overflow`);
      continue;
    }
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
  if (statRollStage?.setRecord !== null && statRollStage !== null) {
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
      durablePayload,
      methodRecord,
      localCharacter,
      checkpoint,
      cursor,
      commandIds,
      receiptIds,
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
  if (!isDeepStrictEqual(currentRevisions, previousRevisions)) {
    mismatches.push('localCharacter/latest receipt revisions');
  }
  if (!isDeepStrictEqual(checkpointRevisions, previousRevisions)) {
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
    statRollStage,
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
    raceAndMethodStage: null,
    statRollStage: null,
    receipt: durable.receipt,
    request: durable.request,
  };
};

export function validateDurableCreationWizardCheckpoint(
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
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
): DurableCreationWizardCheckpoint {
  return validateDurableCreationWizardCheckpoint(
    readLocalCharacter(database, localCharacterId),
    loadLocalCharacterCheckpoint(database, localCharacterId),
  );
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
    const setRecord = roll['setRecord'];
    if (setRecord !== null && typeof setRecord === 'object' && !Array.isArray(setRecord)) {
      addRequestId((setRecord as Record<string, unknown>)['request']);
    }
    const confirmationRecords = roll['confirmationRecords'];
    if (Array.isArray(confirmationRecords)) {
      for (const record of confirmationRecords) {
        if (record !== null && typeof record === 'object' && !Array.isArray(record)) {
          addRequestId((record as Record<string, unknown>)['request']);
        }
      }
    }
  }
  return ids;
};

export function loadCreationWizardCommandByCommandId(
  database: Database.Database,
  commandId: string,
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
  const durableCheckpoint = loadCreationWizardCheckpoint(database, matches[0]!.localCharacterId);
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
  const rollRecords = [
    ...(durableCheckpoint.statRollStage?.setRecord === null ||
    durableCheckpoint.statRollStage?.setRecord === undefined
      ? []
      : [durableCheckpoint.statRollStage.setRecord]),
    ...(durableCheckpoint.statRollStage?.confirmationRecords ?? []),
  ];
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

const currentRevisions = (checkpoint: DurableCreationWizardCheckpoint): RevisionVector => ({
  actorVisibilityRevision: checkpoint.localCharacter.actorVisibilityRevision,
  projectionRevision: checkpoint.localCharacter.projectionRevision,
  stateRevision: checkpoint.localCharacter.stateRevision,
});

const storedDecisionRecords = (
  checkpoint: DurableCreationWizardCheckpoint,
): readonly CreationSetDecideDecisionRecord[] =>
  checkpoint.raceAndMethodStage?.decisionRecords ?? [];

const guardRejected = (): never => {
  throw new CreationSetDecideApplicationError({ code: 'GUARD_REJECTED' });
};

const assertCommitAllowed = (
  checkpoint: DurableCreationWizardCheckpoint,
  request: CreationSetDecideCommandRequest,
  receiptId: string,
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
    request.payload.draftRevision !== checkpoint.receipt.result.draftRevision ||
    request.payload.sourceFormId !== checkpoint.nextStageEnvelope.formId
  ) {
    guardRejected();
  }
  const records = storedDecisionRecords(checkpoint);
  const previousRequests = [
    checkpoint.identityStage.request,
    ...records.map(({ request }) => request),
  ];
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
  const previousReceiptIds = [
    checkpoint.identityStage.receipt.receiptId,
    ...records.map(({ receipt }) => receipt.receiptId),
  ];
  if (previousReceiptIds.includes(receiptId)) guardRejected();
  if (checkpoint.statRollStage !== null) guardRejected();

  const stage = checkpoint.raceAndMethodStage;
  switch (request.payload.sourceFormId) {
    case 'CHR-010':
      if (stage !== null) guardRejected();
      break;
    case 'CHR-016':
      if (
        stage === null ||
        stage.race === null ||
        stage.race.value === 'PURE' ||
        stage.symbiontAcquisition.value !== null ||
        stage.symbiontAcquisition.choiceLockStatus !== 'UNLOCKED'
      ) {
        guardRejected();
      }
      break;
    case 'CHR-036':
      if (stage === null || stage.race === null || stage.diceInput !== null) guardRejected();
      if (
        stage!.race!.value === 'PURE'
          ? stage!.symbiontAcquisition.choiceLockStatus !== 'NOT_APPLICABLE'
          : stage!.symbiontAcquisition.value === null
      ) {
        guardRejected();
      }
      break;
    case 'CHR-002':
      if (
        stage === null ||
        stage.race === null ||
        stage.diceInput === null ||
        stage.statMethod !== null ||
        (stage.race.value === 'PURE'
          ? stage.symbiontAcquisition.choiceLockStatus !== 'NOT_APPLICABLE'
          : stage.symbiontAcquisition.value === null)
      ) {
        guardRejected();
      }
      break;
  }
  if (
    checkpoint.receipt.result.draftRevision === Number.MAX_SAFE_INTEGER ||
    checkpoint.checkpoint.checkpointRevision === Number.MAX_SAFE_INTEGER ||
    actual.stateRevision === Number.MAX_SAFE_INTEGER ||
    actual.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    guardRejected();
  }
};

const payloadAfterDecision = (
  checkpoint: DurableCreationWizardCheckpoint,
  request: CreationSetDecideCommandRequest,
  receiptId: string,
  methodAllocation?: CreationStatRollAllocation,
): CreationWizardPostIdentityPayload => {
  const revisions = incrementedRevisions(currentRevisions(checkpoint));
  const checkpointRevision = checkpoint.checkpoint.checkpointRevision + 1;
  const draftRevision = checkpoint.receipt.result.draftRevision + 1;
  const receipt: CreationSetDecideReceipt = {
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
      attemptIndex: 1,
      branchUuid: methodAllocation.branchUuid,
      confirmationRecords: [],
      confirmationRollRequestIdOrNull: null,
      criticalQueueIndexOrNull: null,
      diceInputModeSnapshot: dice.value,
      naturalCriticalQueue: [],
      outcomes: [],
      returnDecisionFormId: deriveCreationReturnDecisionFormId(request.payload.statMethod, 1),
      setRecord: null,
      setRollRequestId: methodAllocation.setRollRequestId,
      statMethod: request.payload.statMethod,
      state: 'REQUEST_READY',
    },
  };
};

const allocatedCreationStatRollId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must allocate a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
};

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
  const occupied = new Set([
    checkpoint.localCharacter.localCharacterId,
    checkpoint.checkpoint.checkpointId,
    checkpoint.identityStage.request.commandId,
    checkpoint.identityStage.receipt.receiptId,
    receiptId,
    request.commandId,
    ...storedDecisionRecords(checkpoint).flatMap(({ request: stored, receipt }) => [
      stored.commandId,
      receipt.receiptId,
    ]),
  ]);
  if (
    branchUuid === setRollRequestId ||
    occupied.has(branchUuid) ||
    occupied.has(setRollRequestId)
  ) {
    guardRejected();
  }
  return { branchUuid, setRollRequestId };
};

export function commitCreationSetDecide(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  statRollAllocators?: CreationStatRollAllocators,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(
      `creation set decision receiptId must be a non-empty string, got ${JSON.stringify(receiptId)}`,
    );
  }
  const normalized = normalizeCreationSetDecideRequest(request);
  const preflight = loadCreationWizardCheckpoint(database, normalized.payload.characterDraftId);
  assertCommitAllowed(preflight, normalized, receiptId);
  const methodAllocation = allocateCreationStatRoll(
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
      const current = loadCreationWizardCheckpoint(database, normalized.payload.characterDraftId);
      assertCommitAllowed(current, normalized, receiptId);
      const durablePayload = payloadAfterDecision(current, normalized, receiptId, methodAllocation);
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
  return validateDurableCreationWizardCheckpoint(committed.result, committed.checkpoint);
}
