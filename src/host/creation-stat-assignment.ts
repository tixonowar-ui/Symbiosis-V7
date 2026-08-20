import { isDeepStrictEqual } from 'node:util';

import type { ClassCode, StatCode } from '@generated/types/character.js';
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
import { decodeClientMessage } from '@shared/wire-codec.js';

import {
  assignBaseStats,
  calculateSkillStageStats,
  StatAssignmentRuleError,
  SkillStageRuleError,
  type SkillStageCatalog,
  type StatAssignmentMode,
  type StatBlock,
} from '../domain/index.js';
import type {
  CreationNextStageEnvelope,
  DurableCreationWizardCheckpoint,
  RaceChoice,
} from './creation-set-decide.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';

export const STAT_CODES = Object.freeze([
  'S',
  'D',
  'M',
  'Z',
  'I',
  'W',
  'C',
] as const satisfies readonly StatCode[]);
export const PURE_CLASSES = Object.freeze([
  'SEEKER',
  'STALKER',
  'SOLDIER',
] as const satisfies readonly ClassCode[]);

const WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-WIZARD-CHECKPOINT' as const;
const SET_DECIDE_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-CREATION-SET-DECIDE' as const;

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

export type StatMap = Readonly<Record<StatCode, number>>;
export type StatEntryIndexMap = Readonly<Record<StatCode, number>>;

interface StatAssignmentPayloadCommon extends JsonObject {
  readonly stage: 'STAT_ASSIGNMENT';
  readonly sourceFormId: 'CHR-009';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
}

export type StatAssignmentCheckpointPayload = StatAssignmentPayloadCommon &
  ({ readonly setEntryIndexByStat: StatEntryIndexMap } | { readonly pointBuyStats: StatMap });

export type StatAssignmentCheckpointCommandRequest = WorkflowCommandRequestMessage<
  typeof WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID,
  StatAssignmentCheckpointPayload
>;

export interface PureClassDecisionPayload extends JsonObject {
  readonly stage: 'STAT_ASSIGNMENT';
  readonly sourceFormId: 'CHR-011';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly pureClass: ClassCode;
}

export type PureClassDecisionCommandRequest = WorkflowCommandRequestMessage<
  typeof SET_DECIDE_WORKFLOW_COMMAND_ID,
  PureClassDecisionPayload
>;

export interface StatAssignmentSourceEntry extends JsonObject {
  readonly setEntryIndex: number;
  readonly value: number;
  readonly creationCriticalPenaltyOrNull: -1 | -2 | -3 | -4 | -5 | null;
}

export interface RolledStatAssignment extends JsonObject {
  readonly statCode: StatCode;
  readonly setEntryIndex: number;
  readonly value: number;
  readonly creationCriticalPenaltyOrNull: -1 | -2 | -3 | -4 | -5 | null;
}

export interface StatModifierView extends JsonObject {
  readonly statCode: StatCode;
  readonly delta: number;
}

export interface ClassConsequences extends JsonObject {
  readonly statModifiers: readonly StatModifierView[];
}

export interface MandatoryClassSkill extends JsonObject {
  readonly skillKey: string;
  readonly bonus: number;
  readonly slotCost: number;
}

export interface PureClassOption extends JsonObject {
  readonly pureClass: ClassCode;
  readonly classConsequences: ClassConsequences;
  readonly mandatoryClassSkill: MandatoryClassSkill;
}

export interface StatAssignmentDerived {
  readonly assignmentMode: StatAssignmentMode;
  readonly sourceSetReceiptIdOrNull: string | null;
  readonly raceChoice: RaceChoice;
  readonly baseStats: StatMap;
  readonly rolledAssignmentsOrNull: readonly RolledStatAssignment[] | null;
}

export interface PureClassDecisionDerived {
  readonly pureClass: ClassCode;
  readonly classConsequences: ClassConsequences;
  readonly mandatoryClassSkill: MandatoryClassSkill;
}

interface StatAssignmentReceiptResultCommon extends JsonObject {
  readonly stage: 'STAT_ASSIGNMENT';
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
}

export interface StatAssignmentCheckpointReceiptResult
  extends StatAssignmentReceiptResultCommon, JsonObject {
  readonly sourceFormId: 'CHR-009';
  readonly assignmentMode: StatAssignmentMode;
  readonly sourceSetReceiptIdOrNull: string | null;
  readonly raceChoice: RaceChoice;
  readonly baseStats: StatMap;
  readonly rolledAssignmentsOrNull: readonly RolledStatAssignment[] | null;
  readonly nextFormId: 'CHR-011' | 'CHR-012';
}

export interface PureClassDecisionReceiptResult
  extends StatAssignmentReceiptResultCommon, JsonObject {
  readonly sourceFormId: 'CHR-011';
  readonly pureClass: ClassCode;
  readonly classConsequences: ClassConsequences;
  readonly mandatoryClassSkill: MandatoryClassSkill;
  readonly nextFormId: 'CHR-012';
}

export type StatAssignmentCheckpointReceipt = CommandReceipt<StatAssignmentCheckpointReceiptResult>;
export type PureClassDecisionReceipt = CommandReceipt<PureClassDecisionReceiptResult>;

export interface StatAssignmentStage {
  readonly request: StatAssignmentCheckpointCommandRequest;
  readonly derived: StatAssignmentDerived;
  readonly receipt: StatAssignmentCheckpointReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-011' | 'CHR-012'>;
}

export interface PureClassStage {
  readonly request: PureClassDecisionCommandRequest;
  readonly derived: PureClassDecisionDerived;
  readonly receipt: PureClassDecisionReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-012'>;
}

export interface Chr009AssignmentView {
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly raceChoice: RaceChoice;
  readonly assignmentMode: StatAssignmentMode;
  readonly sourceSetReceiptIdOrNull: string | null;
  readonly sourceEntries?: readonly StatAssignmentSourceEntry[];
}

export interface Chr011ClassView {
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly classOptions: readonly PureClassOption[];
}

export interface Chr012StatsView {
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly baseStats: StatMap;
  readonly raceModifiers: readonly StatModifierView[];
  readonly classModifiersOrNull: readonly StatModifierView[] | null;
  readonly skillStageStats: StatMap;
  readonly mandatoryClassSkillOrNull: MandatoryClassSkill | null;
}

export interface StatAssignmentPlan {
  readonly derived: StatAssignmentDerived;
  readonly nextFormId: 'CHR-011' | 'CHR-012';
}

export class CreationStatAssignmentApplicationError extends Error {
  constructor(readonly refusal: CommandRefusal) {
    super(`creation stat assignment request refused: ${JSON.stringify(refusal)}`);
  }
}

const typeName = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

const invalidShape = (path: string, expected: string, value: unknown): never => {
  throw new CreationStatAssignmentApplicationError({
    actualType: typeName(value),
    code: 'INVALID_SHAPE',
    expected,
    path,
  });
};

const unrecognized = (path: string, value: JsonValue): never => {
  throw new CreationStatAssignmentApplicationError({ code: 'UNRECOGNIZED', path, value });
};

const guardRejected = (): never => {
  throw new CreationStatAssignmentApplicationError({ code: 'GUARD_REJECTED' });
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

const nonEmptyStringAt = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    return invalidShape(path, 'non-empty string', value);
  }
  return value;
};

const revisionAt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalidShape(path, 'non-negative safe integer', value);
  }
  return Object.is(value, -0) ? 0 : value;
};

const revisionsAt = (value: unknown, path: string): RevisionVector => {
  const object = exactObject(value, path, [
    'actorVisibilityRevision',
    'projectionRevision',
    'stateRevision',
  ]);
  return {
    actorVisibilityRevision: revisionAt(
      object['actorVisibilityRevision'],
      `${path}.actorVisibilityRevision`,
    ),
    projectionRevision: revisionAt(object['projectionRevision'], `${path}.projectionRevision`),
    stateRevision: revisionAt(object['stateRevision'], `${path}.stateRevision`),
  };
};

const literal = <T extends JsonValue>(value: unknown, expected: T, path: string): T => {
  if (!isDeepStrictEqual(value, expected)) {
    if (value === undefined) return invalidShape(path, 'required field', value);
    return unrecognized(path, value as JsonValue);
  }
  return expected;
};

const enumAt = <T extends string>(value: unknown, path: string, values: readonly T[]): T => {
  if (typeof value !== 'string') return invalidShape(path, 'string', value);
  const selected = values.find((candidate) => candidate === value);
  return selected ?? unrecognized(path, value);
};

function statMapAt(value: unknown, path: string, minimum?: number, maximum?: number): StatMap {
  const object = exactObject(value, path, STAT_CODES);
  const result = {} as Record<StatCode, number>;
  for (const code of STAT_CODES) {
    const entry = object[code];
    if (
      typeof entry !== 'number' ||
      !Number.isSafeInteger(entry) ||
      (minimum !== undefined && entry < minimum) ||
      (maximum !== undefined && entry > maximum)
    ) {
      return invalidShape(
        `${path}.${code}`,
        minimum === undefined
          ? 'safe integer'
          : `safe integer in ${String(minimum)}..${String(maximum)}`,
        entry,
      );
    }
    result[code] = Object.is(entry, -0) ? 0 : entry;
  }
  return result;
}

function entryIndexMapAt(value: unknown, path: string): StatEntryIndexMap {
  const result = statMapAt(value, path, 0, 6);
  const entries = STAT_CODES.map((code) => result[code]);
  if (new Set(entries).size !== STAT_CODES.length) return unrecognized(path, result);
  return result;
}

const normalizedCommon = (request: DecodedCommandRequest) => ({
  commandId: request.commandId,
  commandKind: 'workflow-command' as const,
  expectedRevisions: revisionsAt(request.expectedRevisions, '$.expectedRevisions'),
  messageType: 'command.request' as const,
  protocolVersion: 1 as const,
  role: 'player' as const,
});

export function normalizeStatAssignmentCheckpointRequest(
  request: DecodedCommandRequest,
): StatAssignmentCheckpointCommandRequest {
  if (request.commandKind !== 'workflow-command') {
    return unrecognized('$.commandKind', request.commandKind);
  }
  if (request.workflowCommandId !== WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID) {
    return unrecognized('$.workflowCommandId', request.workflowCommandId);
  }
  if (request.role !== 'player') return unrecognized('$.role', request.role);
  const unshaped = objectAt(request.payload, '$.payload');
  literal(unshaped['stage'], 'STAT_ASSIGNMENT', '$.payload.stage');
  literal(unshaped['sourceFormId'], 'CHR-009', '$.payload.sourceFormId');
  const hasRolled = Object.hasOwn(unshaped, 'setEntryIndexByStat');
  const variantKey = hasRolled ? 'setEntryIndexByStat' : 'pointBuyStats';
  const payload = exactObject(request.payload, '$.payload', [
    'stage',
    'sourceFormId',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    variantKey,
  ]);
  const common = {
    characterDraftId: nonEmptyStringAt(payload['characterDraftId'], '$.payload.characterDraftId'),
    draftRevision: revisionAt(payload['draftRevision'], '$.payload.draftRevision'),
    sourceFormId: 'CHR-009' as const,
    stage: 'STAT_ASSIGNMENT' as const,
    wizardCheckpointId: nonEmptyStringAt(
      payload['wizardCheckpointId'],
      '$.payload.wizardCheckpointId',
    ),
  };
  return {
    ...normalizedCommon(request),
    payload: hasRolled
      ? {
          ...common,
          setEntryIndexByStat: entryIndexMapAt(
            payload['setEntryIndexByStat'],
            '$.payload.setEntryIndexByStat',
          ),
        }
      : {
          ...common,
          pointBuyStats: statMapAt(payload['pointBuyStats'], '$.payload.pointBuyStats', 1, 20),
        },
    workflowCommandId: WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID,
  };
}

export function normalizePureClassDecisionRequest(
  request: DecodedCommandRequest,
): PureClassDecisionCommandRequest {
  if (request.commandKind !== 'workflow-command') {
    return unrecognized('$.commandKind', request.commandKind);
  }
  if (request.workflowCommandId !== SET_DECIDE_WORKFLOW_COMMAND_ID) {
    return unrecognized('$.workflowCommandId', request.workflowCommandId);
  }
  if (request.role !== 'player') return unrecognized('$.role', request.role);
  const payload = exactObject(request.payload, '$.payload', [
    'stage',
    'sourceFormId',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    'pureClass',
  ]);
  return {
    ...normalizedCommon(request),
    payload: {
      characterDraftId: nonEmptyStringAt(payload['characterDraftId'], '$.payload.characterDraftId'),
      draftRevision: revisionAt(payload['draftRevision'], '$.payload.draftRevision'),
      pureClass: enumAt(payload['pureClass'], '$.payload.pureClass', PURE_CLASSES),
      sourceFormId: literal(payload['sourceFormId'], 'CHR-011', '$.payload.sourceFormId'),
      stage: literal(payload['stage'], 'STAT_ASSIGNMENT', '$.payload.stage'),
      wizardCheckpointId: nonEmptyStringAt(
        payload['wizardCheckpointId'],
        '$.payload.wizardCheckpointId',
      ),
    },
    workflowCommandId: SET_DECIDE_WORKFLOW_COMMAND_ID,
  };
}

interface AssignmentSource {
  readonly assignmentMode: StatAssignmentMode;
  readonly raceChoice: RaceChoice;
  readonly sourceSetReceiptIdOrNull: string | null;
  readonly sourceEntriesOrNull: readonly StatAssignmentSourceEntry[] | null;
  readonly branchUuid: string;
}

function raceDefinition(catalog: SkillStageCatalog, raceChoice: RaceChoice) {
  const race = catalog.races.find(({ raceCode }) => raceCode === raceChoice);
  if (race === undefined) throw new Error(`validated catalog lacks RaceCode ${raceChoice}`);
  return race;
}

function terminalAssignmentSource(checkpoint: DurableCreationWizardCheckpoint): AssignmentSource {
  const raceChoice = checkpoint.raceAndMethodStage?.race?.value;
  const stage = checkpoint.statRollStage;
  const attempt = stage?.attempts.at(-1);
  const record = attempt?.decisionRecordOrNull;
  if (
    checkpoint.nextStageEnvelope.formId !== 'CHR-009' ||
    raceChoice === undefined ||
    stage === null ||
    attempt === undefined ||
    attempt.setRecord === null ||
    record == null
  ) {
    return guardRejected();
  }
  if (record.derived.decision === 'ACCEPT_SET') {
    if (
      attempt.state !== 'SET_ACCEPTED' ||
      record.derived.acceptedSetReceiptId !== attempt.setRecord.receipt.receiptId
    ) {
      return guardRejected();
    }
    const outcomes = new Map(attempt.outcomes.map((outcome) => [outcome.setEntryIndex, outcome]));
    if (outcomes.size !== attempt.outcomes.length) return guardRejected();
    const sourceEntries = attempt.setRecord.receipt.result.faces.map((face, setEntryIndex) => {
      const outcome = outcomes.get(setEntryIndex);
      const penalty = outcome?.creationCriticalPenaltyOrNull ?? null;
      if (penalty !== null && ![-1, -2, -3, -4, -5].includes(penalty)) {
        return guardRejected();
      }
      return {
        creationCriticalPenaltyOrNull: penalty as -1 | -2 | -3 | -4 | -5 | null,
        setEntryIndex,
        value: outcome?.value ?? face,
      };
    });
    return {
      assignmentMode: 'ROLLED_BIJECTION',
      branchUuid: stage.branchUuid,
      raceChoice,
      sourceEntriesOrNull: sourceEntries,
      sourceSetReceiptIdOrNull: attempt.setRecord.receipt.receiptId,
    };
  }
  const assignmentMode = record.receipt.result.assignmentModeOrNull;
  if (
    attempt.state !== 'SET_ABANDONED' ||
    (assignmentMode !== 'POINT_BUY_85' && assignmentMode !== 'POINT_BUY_90')
  ) {
    return guardRejected();
  }
  return {
    assignmentMode,
    branchUuid: stage.branchUuid,
    raceChoice,
    sourceEntriesOrNull: null,
    sourceSetReceiptIdOrNull: null,
  };
}

function nextFormForRace(
  catalog: SkillStageCatalog,
  raceChoice: RaceChoice,
): 'CHR-011' | 'CHR-012' {
  return raceDefinition(catalog, raceChoice).classPolicy === 'REQUIRED_PURE_CLASS'
    ? 'CHR-011'
    : 'CHR-012';
}

export function deriveChr009AssignmentView(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SkillStageCatalog,
): Chr009AssignmentView {
  const source = terminalAssignmentSource(checkpoint);
  nextFormForRace(catalog, source.raceChoice);
  const common = {
    assignmentMode: source.assignmentMode,
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    draftRevision: checkpoint.receipt.result.draftRevision,
    raceChoice: source.raceChoice,
    sourceSetReceiptIdOrNull: source.sourceSetReceiptIdOrNull,
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
  };
  return source.sourceEntriesOrNull === null
    ? common
    : { ...common, sourceEntries: source.sourceEntriesOrNull };
}

export function prepareStatAssignment(
  checkpoint: DurableCreationWizardCheckpoint,
  request: StatAssignmentCheckpointCommandRequest,
  catalog: SkillStageCatalog,
): StatAssignmentPlan {
  const source = terminalAssignmentSource(checkpoint);
  let baseStats: StatBlock;
  let rolledAssignmentsOrNull: readonly RolledStatAssignment[] | null;
  try {
    if (source.assignmentMode === 'ROLLED_BIJECTION') {
      if (!('setEntryIndexByStat' in request.payload) || source.sourceEntriesOrNull === null) {
        return guardRejected();
      }
      const entries = source.sourceEntriesOrNull;
      const indexMap = (
        request.payload as StatAssignmentPayloadCommon & {
          readonly setEntryIndexByStat: StatEntryIndexMap;
        }
      ).setEntryIndexByStat;
      const assigned = {} as Record<StatCode, number>;
      rolledAssignmentsOrNull = STAT_CODES.map((statCode) => {
        const setEntryIndex = indexMap[statCode];
        const entry = entries[setEntryIndex];
        if (entry === undefined || entry.setEntryIndex !== setEntryIndex) return guardRejected();
        assigned[statCode] = entry.value;
        return { ...entry, statCode };
      });
      baseStats = assignBaseStats(catalog, {
        acceptedValues: entries.map(({ value }) => value),
        assignedStats: assigned,
        assignmentMode: source.assignmentMode,
      });
    } else {
      if (!('pointBuyStats' in request.payload) || source.sourceEntriesOrNull !== null) {
        return guardRejected();
      }
      baseStats = assignBaseStats(catalog, {
        assignedStats: (
          request.payload as StatAssignmentPayloadCommon & {
            readonly pointBuyStats: StatMap;
          }
        ).pointBuyStats,
        assignmentMode: source.assignmentMode,
      });
      rolledAssignmentsOrNull = null;
    }
  } catch (cause) {
    if (cause instanceof StatAssignmentRuleError) {
      if (source.assignmentMode === 'POINT_BUY_85' || source.assignmentMode === 'POINT_BUY_90') {
        throw new CreationStatAssignmentApplicationError({
          actualType: 'object',
          code: 'INVALID_SHAPE',
          expected: `StatMap with each value in 1..20 and exact total ${source.assignmentMode === 'POINT_BUY_90' ? '90' : '85'}`,
          path: '$.payload.pointBuyStats',
        });
      }
      return guardRejected();
    }
    throw cause;
  }
  return {
    derived: {
      assignmentMode: source.assignmentMode,
      baseStats,
      raceChoice: source.raceChoice,
      rolledAssignmentsOrNull,
      sourceSetReceiptIdOrNull: source.sourceSetReceiptIdOrNull,
    },
    nextFormId: nextFormForRace(catalog, source.raceChoice),
  };
}

function modifierViews(
  catalog: SkillStageCatalog,
  appliedModifierIds: readonly string[],
  raceChoice: RaceChoice,
  pureClass: ClassCode | null,
): {
  readonly race: readonly StatModifierView[];
  readonly classOrNull: readonly StatModifierView[] | null;
} {
  if (new Set(appliedModifierIds).size !== appliedModifierIds.length) {
    throw new Error('skill-stage result contains duplicate appliedModifierIds');
  }
  const race: StatModifierView[] = [];
  const classModifiers: StatModifierView[] = [];
  for (const modifierId of appliedModifierIds) {
    const row = catalog.modifiers.find((candidate) => candidate.modifierId === modifierId);
    if (
      row === undefined ||
      row.applicationStage !== 'SKILL_STAGE' ||
      (row.sourceType !== 'RACE' && row.sourceType !== 'PURE_CLASS')
    ) {
      throw new Error(`invalid SKILL_STAGE applied modifier ${JSON.stringify(modifierId)}`);
    }
    const view = { delta: row.value, statCode: row.targetCode };
    if (row.sourceType === 'RACE') {
      if (row.sourceId !== raceChoice) {
        throw new Error(`applied race modifier ${modifierId} does not belong to ${raceChoice}`);
      }
      race.push(view);
    } else {
      if (pureClass === null || row.sourceId !== pureClass) {
        throw new Error(`applied class modifier ${modifierId} does not belong to selected class`);
      }
      classModifiers.push(view);
    }
  }
  return { classOrNull: pureClass === null ? null : classModifiers, race };
}

function mandatoryClassSkill(
  catalog: SkillStageCatalog,
  pureClass: ClassCode,
): MandatoryClassSkill {
  const classRow = catalog.classes.find(({ classCode }) => classCode === pureClass);
  if (classRow === undefined || classRow.raceCode !== 'PURE') {
    throw new Error(`validated catalog lacks PURE class ${pureClass}`);
  }
  const skill = catalog.skills.find(({ skillKey }) => skillKey === classRow.mandatorySkillKey);
  if (
    skill === undefined ||
    skill.category !== 'FIXED_CLASS_PASSIVE' ||
    skill.slotCostMode !== 'FIXED_1' ||
    typeof skill.maxBonus !== 'number'
  ) {
    throw new Error(`validated class ${pureClass} lacks its fixed mandatory skill`);
  }
  return {
    bonus: skill.maxBonus,
    skillKey: skill.skillKey,
    slotCost: classRow.mandatorySkillSlotCost,
  };
}

function calculateForPure(catalog: SkillStageCatalog, baseStats: StatMap, pureClass: ClassCode) {
  const manual = calculateSkillStageStats(catalog, {
    baseStats,
    classCode: pureClass,
    creationMode: 'MANUAL',
    raceCode: 'PURE',
  });
  const random = calculateSkillStageStats(catalog, {
    baseStats,
    classCode: pureClass,
    creationMode: 'RANDOM',
    raceCode: 'PURE',
  });
  if (!isDeepStrictEqual(manual, random)) {
    throw new Error('PURE skill-stage result depends on an inapplicable acquisition mode');
  }
  return manual;
}

function pureClassOption(
  catalog: SkillStageCatalog,
  baseStats: StatMap,
  pureClass: ClassCode,
): PureClassOption {
  const result = calculateForPure(catalog, baseStats, pureClass);
  const modifiers = modifierViews(catalog, result.appliedModifierIds, 'PURE', pureClass);
  if (modifiers.race.length !== 0 || modifiers.classOrNull === null) {
    throw new Error(`PURE class ${pureClass} produced invalid modifier ownership`);
  }
  return {
    classConsequences: { statModifiers: modifiers.classOrNull },
    mandatoryClassSkill: mandatoryClassSkill(catalog, pureClass),
    pureClass,
  };
}

export function deriveChr011ClassView(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SkillStageCatalog,
): Chr011ClassView {
  const assignment = checkpoint.statAssignmentStage;
  if (
    checkpoint.nextStageEnvelope.formId !== 'CHR-011' ||
    assignment === null ||
    checkpoint.pureClassStage !== null ||
    assignment.derived.raceChoice !== 'PURE' ||
    raceDefinition(catalog, 'PURE').classPolicy !== 'REQUIRED_PURE_CLASS'
  ) {
    return guardRejected();
  }
  return {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    classOptions: PURE_CLASSES.map((pureClass) =>
      pureClassOption(catalog, assignment.derived.baseStats, pureClass),
    ),
    draftRevision: checkpoint.receipt.result.draftRevision,
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
  };
}

export function preparePureClassDecision(
  checkpoint: DurableCreationWizardCheckpoint,
  request: PureClassDecisionCommandRequest,
  catalog: SkillStageCatalog,
): PureClassDecisionDerived {
  const view = deriveChr011ClassView(checkpoint, catalog);
  const option = view.classOptions.find(({ pureClass }) => pureClass === request.payload.pureClass);
  if (option === undefined) return guardRejected();
  return {
    classConsequences: option.classConsequences,
    mandatoryClassSkill: option.mandatoryClassSkill,
    pureClass: option.pureClass,
  };
}

export function deriveChr012StatsView(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SkillStageCatalog,
): Chr012StatsView {
  const assignment = checkpoint.statAssignmentStage;
  if (checkpoint.nextStageEnvelope.formId !== 'CHR-012' || assignment === null) {
    return guardRejected();
  }
  const raceChoice = assignment.derived.raceChoice;
  const race = raceDefinition(catalog, raceChoice);
  const pureClassStage = checkpoint.pureClassStage;
  const pureClass = pureClassStage?.derived.pureClass ?? null;
  if (
    (race.classPolicy === 'REQUIRED_PURE_CLASS') !== (pureClassStage !== null) ||
    (pureClassStage !== null && raceChoice !== 'PURE')
  ) {
    return guardRejected();
  }
  let result;
  try {
    if (raceChoice === 'PURE') {
      if (pureClass === null) return guardRejected();
      result = calculateForPure(catalog, assignment.derived.baseStats, pureClass);
    } else {
      const creationMode = checkpoint.raceAndMethodStage?.symbiontAcquisition.value;
      if (creationMode === null || creationMode === undefined) return guardRejected();
      result = calculateSkillStageStats(catalog, {
        baseStats: assignment.derived.baseStats,
        classCode: null,
        creationMode,
        raceCode: raceChoice,
      });
    }
  } catch (cause) {
    if (cause instanceof SkillStageRuleError) return guardRejected();
    throw cause;
  }
  const modifiers = modifierViews(catalog, result.appliedModifierIds, raceChoice, pureClass);
  return {
    baseStats: assignment.derived.baseStats,
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    classModifiersOrNull: modifiers.classOrNull,
    draftRevision: checkpoint.receipt.result.draftRevision,
    mandatoryClassSkillOrNull: pureClassStage?.derived.mandatoryClassSkill ?? null,
    raceModifiers: modifiers.race,
    skillStageStats: result.skillStageStats,
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
  };
}

export function assignmentBranchUuid(checkpoint: DurableCreationWizardCheckpoint): string {
  return terminalAssignmentSource(checkpoint).branchUuid;
}

const STORED_REQUEST_VOCABULARY: ProtocolVocabulary = {
  isFormId: (_value): _value is never => false,
  isHostTransition: () => false,
  isWorkflowCommandId: (value): value is WorkflowCommandId =>
    value === WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID || value === SET_DECIDE_WORKFLOW_COMMAND_ID,
};

function storedRequestAt(
  value: unknown,
  label: string,
): StatAssignmentCheckpointCommandRequest | PureClassDecisionCommandRequest {
  let source: string;
  try {
    source = JSON.stringify(value);
  } catch (cause) {
    throw new Error(`${label} request cannot be encoded as JSON`, { cause });
  }
  const decoded = decodeClientMessage(source, STORED_REQUEST_VOCABULARY);
  if (
    !decoded.ok ||
    decoded.value.messageType !== 'command.request' ||
    decoded.value.commandKind !== 'workflow-command'
  ) {
    throw new Error(`${label} request is not a valid wire v1 command`);
  }
  try {
    return decoded.value.workflowCommandId === WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID
      ? normalizeStatAssignmentCheckpointRequest(decoded.value)
      : normalizePureClassDecisionRequest(decoded.value);
  } catch (cause) {
    if (cause instanceof CreationStatAssignmentApplicationError) {
      throw new Error(`${label} request violates the durable stat-assignment contract`, { cause });
    }
    throw cause;
  }
}

function penaltyAt(value: unknown, path: string): -1 | -2 | -3 | -4 | -5 | null {
  if (value === null) return null;
  if (value === -1 || value === -2 || value === -3 || value === -4 || value === -5) return value;
  return unrecognized(path, value as JsonValue);
}

function rolledAssignmentAt(value: unknown, path: string): RolledStatAssignment {
  const object = exactObject(value, path, [
    'statCode',
    'setEntryIndex',
    'value',
    'creationCriticalPenaltyOrNull',
  ]);
  const setEntryIndex = object['setEntryIndex'];
  const assignedValue = object['value'];
  if (
    typeof setEntryIndex !== 'number' ||
    !Number.isSafeInteger(setEntryIndex) ||
    setEntryIndex < 0 ||
    setEntryIndex > 6
  ) {
    return invalidShape(`${path}.setEntryIndex`, 'safe integer in 0..6', setEntryIndex);
  }
  if (typeof assignedValue !== 'number' || !Number.isSafeInteger(assignedValue)) {
    return invalidShape(`${path}.value`, 'safe integer', assignedValue);
  }
  return {
    creationCriticalPenaltyOrNull: penaltyAt(
      object['creationCriticalPenaltyOrNull'],
      `${path}.creationCriticalPenaltyOrNull`,
    ),
    setEntryIndex,
    statCode: enumAt(object['statCode'], `${path}.statCode`, STAT_CODES),
    value: assignedValue,
  };
}

function rolledAssignmentsAt(value: unknown, path: string): readonly RolledStatAssignment[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== STAT_CODES.length) {
    return invalidShape(path, 'null or array of exactly seven assignments', value);
  }
  return value.map((entry, index) => rolledAssignmentAt(entry, `${path}[${String(index)}]`));
}

function modifiersAt(value: unknown, path: string): readonly StatModifierView[] {
  if (!Array.isArray(value)) return invalidShape(path, 'array', value);
  return value.map((entry, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const object = exactObject(entry, itemPath, ['statCode', 'delta']);
    const delta = object['delta'];
    if (typeof delta !== 'number' || !Number.isSafeInteger(delta)) {
      return invalidShape(`${itemPath}.delta`, 'safe integer', delta);
    }
    return {
      delta,
      statCode: enumAt(object['statCode'], `${itemPath}.statCode`, STAT_CODES),
    };
  });
}

function classConsequencesAt(value: unknown, path: string): ClassConsequences {
  const object = exactObject(value, path, ['statModifiers']);
  return { statModifiers: modifiersAt(object['statModifiers'], `${path}.statModifiers`) };
}

function mandatorySkillAt(value: unknown, path: string): MandatoryClassSkill {
  const object = exactObject(value, path, ['skillKey', 'bonus', 'slotCost']);
  const bonus = object['bonus'];
  const slotCost = object['slotCost'];
  if (typeof bonus !== 'number' || !Number.isSafeInteger(bonus)) {
    return invalidShape(`${path}.bonus`, 'safe integer', bonus);
  }
  if (typeof slotCost !== 'number' || !Number.isSafeInteger(slotCost) || slotCost < 0) {
    return invalidShape(`${path}.slotCost`, 'non-negative safe integer', slotCost);
  }
  return {
    bonus,
    skillKey: nonEmptyStringAt(object['skillKey'], `${path}.skillKey`),
    slotCost,
  };
}

function receiptCommonAt(result: Record<string, unknown>, path: string) {
  return {
    branchCacheHash: literal(
      result['branchCacheHash'],
      EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      `${path}.branchCacheHash`,
    ),
    branchUuid: nonEmptyStringAt(result['branchUuid'], `${path}.branchUuid`),
    characterDraftId: nonEmptyStringAt(result['characterDraftId'], `${path}.characterDraftId`),
    checkpointId: nonEmptyStringAt(result['checkpointId'], `${path}.checkpointId`),
    checkpointOwnerId: nonEmptyStringAt(result['checkpointOwnerId'], `${path}.checkpointOwnerId`),
    checkpointRevision: revisionAt(result['checkpointRevision'], `${path}.checkpointRevision`),
    draftRevision: revisionAt(result['draftRevision'], `${path}.draftRevision`),
    stage: literal(result['stage'], 'STAT_ASSIGNMENT', `${path}.stage`),
  };
}

export function parseStatAssignmentReceipt(
  value: unknown,
  label: string,
): StatAssignmentCheckpointReceipt | PureClassDecisionReceipt {
  try {
    const object = exactObject(value, '$.receipt', [
      'commandId',
      'receiptId',
      'result',
      'revisions',
    ]);
    const unshaped = objectAt(object['result'], '$.receipt.result');
    const sourceFormId = enumAt(unshaped['sourceFormId'], '$.receipt.result.sourceFormId', [
      'CHR-009',
      'CHR-011',
    ] as const);
    const variantKeys =
      sourceFormId === 'CHR-009'
        ? [
            'assignmentMode',
            'sourceSetReceiptIdOrNull',
            'raceChoice',
            'baseStats',
            'rolledAssignmentsOrNull',
          ]
        : ['pureClass', 'classConsequences', 'mandatoryClassSkill'];
    const result = exactObject(object['result'], '$.receipt.result', [
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
      'nextFormId',
    ]);
    const common = receiptCommonAt(result, '$.receipt.result');
    const receiptCommon = {
      commandId: nonEmptyStringAt(object['commandId'], '$.receipt.commandId'),
      receiptId: nonEmptyStringAt(object['receiptId'], '$.receipt.receiptId'),
      revisions: revisionsAt(object['revisions'], '$.receipt.revisions'),
    };
    if (sourceFormId === 'CHR-009') {
      const sourceReceipt = result['sourceSetReceiptIdOrNull'];
      return {
        ...receiptCommon,
        result: {
          ...common,
          assignmentMode: enumAt(result['assignmentMode'], '$.receipt.result.assignmentMode', [
            'ROLLED_BIJECTION',
            'POINT_BUY_90',
            'POINT_BUY_85',
          ] as const),
          baseStats: statMapAt(result['baseStats'], '$.receipt.result.baseStats'),
          nextFormId: enumAt(result['nextFormId'], '$.receipt.result.nextFormId', [
            'CHR-011',
            'CHR-012',
          ] as const),
          raceChoice: enumAt(result['raceChoice'], '$.receipt.result.raceChoice', [
            'UNITED',
            'FREE',
            'PURE',
          ] as const),
          rolledAssignmentsOrNull: rolledAssignmentsAt(
            result['rolledAssignmentsOrNull'],
            '$.receipt.result.rolledAssignmentsOrNull',
          ),
          sourceFormId,
          sourceSetReceiptIdOrNull:
            sourceReceipt === null
              ? null
              : nonEmptyStringAt(sourceReceipt, '$.receipt.result.sourceSetReceiptIdOrNull'),
        },
      };
    }
    return {
      ...receiptCommon,
      result: {
        ...common,
        classConsequences: classConsequencesAt(
          result['classConsequences'],
          '$.receipt.result.classConsequences',
        ),
        mandatoryClassSkill: mandatorySkillAt(
          result['mandatoryClassSkill'],
          '$.receipt.result.mandatoryClassSkill',
        ),
        nextFormId: literal(result['nextFormId'], 'CHR-012', '$.receipt.result.nextFormId'),
        pureClass: enumAt(result['pureClass'], '$.receipt.result.pureClass', PURE_CLASSES),
        sourceFormId,
      },
    };
  } catch (cause) {
    if (cause instanceof CreationStatAssignmentApplicationError) {
      throw new Error(`${label} receipt violates the durable stat-assignment contract`, { cause });
    }
    throw cause;
  }
}

const isStatAssignmentCheckpointReceipt = (
  receipt: StatAssignmentCheckpointReceipt | PureClassDecisionReceipt,
): receipt is StatAssignmentCheckpointReceipt => receipt.result.sourceFormId === 'CHR-009';

const isPureClassDecisionReceipt = (
  receipt: StatAssignmentCheckpointReceipt | PureClassDecisionReceipt,
): receipt is PureClassDecisionReceipt => receipt.result.sourceFormId === 'CHR-011';

export function parseStatAssignmentStage(value: unknown, label: string): StatAssignmentStage {
  const object = exactObject(value, '$.statAssignmentStage', [
    'request',
    'derived',
    'receipt',
    'nextStageEnvelope',
  ]);
  const request = storedRequestAt(object['request'], label);
  const receipt = parseStatAssignmentReceipt(object['receipt'], label);
  if (
    request.workflowCommandId !== WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID ||
    !isStatAssignmentCheckpointReceipt(receipt)
  ) {
    throw new Error(`${label} statAssignmentStage does not contain CHR-009 checkpoint records`);
  }
  const derived = exactObject(object['derived'], '$.statAssignmentStage.derived', [
    'assignmentMode',
    'sourceSetReceiptIdOrNull',
    'raceChoice',
    'baseStats',
    'rolledAssignmentsOrNull',
  ]);
  const envelope = exactObject(
    object['nextStageEnvelope'],
    '$.statAssignmentStage.nextStageEnvelope',
    ['formId', 'routeBindings'],
  );
  const routeBindings = envelope['routeBindings'];
  if (!Array.isArray(routeBindings) || routeBindings.length !== 1) {
    throw new Error(`${label} statAssignmentStage routeBindings must contain one binding`);
  }
  const binding = exactObject(
    routeBindings[0],
    '$.statAssignmentStage.nextStageEnvelope.routeBindings[0]',
    ['parameterIndex', 'source', 'value'],
  );
  return {
    derived: {
      assignmentMode: enumAt(
        derived['assignmentMode'],
        '$.statAssignmentStage.derived.assignmentMode',
        ['ROLLED_BIJECTION', 'POINT_BUY_90', 'POINT_BUY_85'] as const,
      ),
      baseStats: statMapAt(derived['baseStats'], '$.statAssignmentStage.derived.baseStats'),
      raceChoice: enumAt(derived['raceChoice'], '$.statAssignmentStage.derived.raceChoice', [
        'UNITED',
        'FREE',
        'PURE',
      ] as const),
      rolledAssignmentsOrNull: rolledAssignmentsAt(
        derived['rolledAssignmentsOrNull'],
        '$.statAssignmentStage.derived.rolledAssignmentsOrNull',
      ),
      sourceSetReceiptIdOrNull:
        derived['sourceSetReceiptIdOrNull'] === null
          ? null
          : nonEmptyStringAt(
              derived['sourceSetReceiptIdOrNull'],
              '$.statAssignmentStage.derived.sourceSetReceiptIdOrNull',
            ),
    },
    nextStageEnvelope: {
      formId: enumAt(envelope['formId'], '$.statAssignmentStage.nextStageEnvelope.formId', [
        'CHR-011',
        'CHR-012',
      ] as const),
      routeBindings: [
        {
          parameterIndex: literal(
            binding['parameterIndex'],
            0,
            '$.statAssignmentStage.nextStageEnvelope.routeBindings[0].parameterIndex',
          ),
          source: literal(
            binding['source'],
            'inherited',
            '$.statAssignmentStage.nextStageEnvelope.routeBindings[0].source',
          ),
          value: nonEmptyStringAt(
            binding['value'],
            '$.statAssignmentStage.nextStageEnvelope.routeBindings[0].value',
          ),
        },
      ],
    },
    receipt,
    request,
  };
}

export function parsePureClassStage(value: unknown, label: string): PureClassStage | null {
  if (value === null) return null;
  const object = exactObject(value, '$.pureClassStage', [
    'request',
    'derived',
    'receipt',
    'nextStageEnvelope',
  ]);
  const request = storedRequestAt(object['request'], label);
  const receipt = parseStatAssignmentReceipt(object['receipt'], label);
  if (
    request.workflowCommandId !== SET_DECIDE_WORKFLOW_COMMAND_ID ||
    !isPureClassDecisionReceipt(receipt)
  ) {
    throw new Error(`${label} pureClassStage does not contain CHR-011 decision records`);
  }
  const derived = exactObject(object['derived'], '$.pureClassStage.derived', [
    'pureClass',
    'classConsequences',
    'mandatoryClassSkill',
  ]);
  const envelope = exactObject(object['nextStageEnvelope'], '$.pureClassStage.nextStageEnvelope', [
    'formId',
    'routeBindings',
  ]);
  const routeBindings = envelope['routeBindings'];
  if (!Array.isArray(routeBindings) || routeBindings.length !== 1) {
    throw new Error(`${label} pureClassStage routeBindings must contain one binding`);
  }
  const binding = exactObject(
    routeBindings[0],
    '$.pureClassStage.nextStageEnvelope.routeBindings[0]',
    ['parameterIndex', 'source', 'value'],
  );
  return {
    derived: {
      classConsequences: classConsequencesAt(
        derived['classConsequences'],
        '$.pureClassStage.derived.classConsequences',
      ),
      mandatoryClassSkill: mandatorySkillAt(
        derived['mandatoryClassSkill'],
        '$.pureClassStage.derived.mandatoryClassSkill',
      ),
      pureClass: enumAt(derived['pureClass'], '$.pureClassStage.derived.pureClass', PURE_CLASSES),
    },
    nextStageEnvelope: {
      formId: literal(envelope['formId'], 'CHR-012', '$.pureClassStage.nextStageEnvelope.formId'),
      routeBindings: [
        {
          parameterIndex: literal(
            binding['parameterIndex'],
            0,
            '$.pureClassStage.nextStageEnvelope.routeBindings[0].parameterIndex',
          ),
          source: literal(
            binding['source'],
            'inherited',
            '$.pureClassStage.nextStageEnvelope.routeBindings[0].source',
          ),
          value: nonEmptyStringAt(
            binding['value'],
            '$.pureClassStage.nextStageEnvelope.routeBindings[0].value',
          ),
        },
      ],
    },
    receipt,
    request,
  };
}
