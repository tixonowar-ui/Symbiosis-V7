import { isDeepStrictEqual } from 'node:util';

import type { ClassCode, RaceCode, StatCode } from '@generated/types/character.js';
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
  calculateSkillSlotCost,
  calculateStartSkillSlots,
  SkillStageRuleError,
  validateSkillRequirements,
  validateSkillSelection,
  type LearnedSkill,
  type SkillStageCatalog,
} from '../domain/index.js';
import type {
  CreationNextStageEnvelope,
  DurableCreationWizardCheckpoint,
  RaceChoice,
} from './creation-set-decide.js';
import type {
  CreationMissingSkillPenalty,
  CreationSkillCatalog,
} from './creation-skill-catalog.js';
import {
  deriveChr012StatsView,
  STAT_CODES,
  type MandatoryClassSkill,
  type StatMap,
} from './creation-stat-assignment.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';

const WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-WIZARD-CHECKPOINT' as const;

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

interface SkillCheckpointPayloadCommon extends JsonObject {
  readonly stage: 'SKILLS';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
}

export interface SkillEligibilityCheckpointPayload extends SkillCheckpointPayloadCommon {
  readonly sourceFormId: 'CHR-012';
}

export interface SelectedSkillCommandInput extends JsonObject {
  readonly skillId: string;
  readonly targetBonus: number;
}

export interface SkillSelectionCheckpointPayload extends SkillCheckpointPayloadCommon {
  readonly sourceFormId: 'CHR-015';
  readonly selectedSkills: readonly SelectedSkillCommandInput[];
}

export type SkillCheckpointPayload =
  SkillEligibilityCheckpointPayload | SkillSelectionCheckpointPayload;

export type SkillCheckpointCommandRequest = WorkflowCommandRequestMessage<
  typeof WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID,
  SkillCheckpointPayload
>;

export interface RacialFreeSkill extends JsonObject {
  readonly skillKey: string;
  readonly bonus: number;
  readonly slotCost: 0;
}

export interface SkillEligibilityDerived extends JsonObject {
  readonly raceCode: RaceCode;
  readonly classCodeOrNull: ClassCode | null;
  readonly skillStageStats: StatMap;
  readonly requiredSlotCount: number;
  readonly mandatoryClassSkillOrNull: MandatoryClassSkill | null;
  readonly racialFreeSkills: readonly RacialFreeSkill[];
  readonly eligibleSkillIds: readonly string[];
}

export interface DurableSelectedSkill extends JsonObject {
  readonly skillKey: string;
  readonly targetBonus: number;
}

export interface DurableLearnedSkill extends JsonObject {
  readonly source: LearnedSkill['source'];
  readonly skillKey: string;
  readonly bonus: number;
  readonly slotCost: number;
}

export interface SkillSelectionDerived extends JsonObject {
  readonly selectedSkills: readonly DurableSelectedSkill[];
  readonly learnedSkills: readonly DurableLearnedSkill[];
  readonly requiredSlotCount: number;
  readonly usedSlotCount: number;
}

interface SkillReceiptResultCommon extends JsonObject {
  readonly stage: 'SKILLS';
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
}

export interface SkillEligibilityCheckpointReceiptResult
  extends SkillReceiptResultCommon, SkillEligibilityDerived {
  readonly sourceFormId: 'CHR-012';
  readonly nextFormId: 'CHR-013';
}

export interface SkillSelectionCheckpointReceiptResult
  extends SkillReceiptResultCommon, SkillSelectionDerived {
  readonly sourceFormId: 'CHR-015';
  readonly nextFormId: 'CHR-017';
}

export type SkillEligibilityCheckpointReceipt =
  CommandReceipt<SkillEligibilityCheckpointReceiptResult>;
export type SkillSelectionCheckpointReceipt = CommandReceipt<SkillSelectionCheckpointReceiptResult>;
export type SkillCheckpointReceipt =
  SkillEligibilityCheckpointReceipt | SkillSelectionCheckpointReceipt;

export interface SkillEligibilityStage {
  readonly request: SkillCheckpointCommandRequest & {
    readonly payload: SkillEligibilityCheckpointPayload;
  };
  readonly derived: SkillEligibilityDerived;
  readonly receipt: SkillEligibilityCheckpointReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-013'>;
}

export interface SkillSelectionStage {
  readonly request: SkillCheckpointCommandRequest & {
    readonly payload: SkillSelectionCheckpointPayload;
  };
  readonly derived: SkillSelectionDerived;
  readonly receipt: SkillSelectionCheckpointReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-017'>;
}

export interface SkillEligibilityPlan {
  readonly derived: SkillEligibilityDerived;
  readonly nextFormId: 'CHR-013';
}

export interface SkillSelectionPlan {
  readonly derived: SkillSelectionDerived;
  readonly nextFormId: 'CHR-017';
}

export class CreationSkillSelectionApplicationError extends Error {
  constructor(readonly refusal: CommandRefusal) {
    super(`creation skill selection request refused: ${JSON.stringify(refusal)}`);
  }
}

const typeName = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

const invalidShape = (path: string, expected: string, value: unknown): never => {
  throw new CreationSkillSelectionApplicationError({
    actualType: typeName(value),
    code: 'INVALID_SHAPE',
    expected,
    path,
  });
};

const unrecognized = (path: string, value: JsonValue): never => {
  throw new CreationSkillSelectionApplicationError({ code: 'UNRECOGNIZED', path, value });
};

const guardRejected = (): never => {
  throw new CreationSkillSelectionApplicationError({ code: 'GUARD_REJECTED' });
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

const safeIntegerAt = (value: unknown, path: string, minimum = 0): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    return invalidShape(path, `safe integer >= ${String(minimum)}`, value);
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

const revisionsAt = (value: unknown, path: string): RevisionVector => {
  const object = exactObject(value, path, [
    'actorVisibilityRevision',
    'projectionRevision',
    'stateRevision',
  ]);
  return {
    actorVisibilityRevision: safeIntegerAt(
      object['actorVisibilityRevision'],
      `${path}.actorVisibilityRevision`,
    ),
    projectionRevision: safeIntegerAt(object['projectionRevision'], `${path}.projectionRevision`),
    stateRevision: safeIntegerAt(object['stateRevision'], `${path}.stateRevision`),
  };
};

const selectedSkillAt = (value: unknown, path: string): SelectedSkillCommandInput => {
  const object = exactObject(value, path, ['skillId', 'targetBonus']);
  return {
    skillId: nonEmptyStringAt(object['skillId'], `${path}.skillId`),
    targetBonus: safeIntegerAt(object['targetBonus'], `${path}.targetBonus`, 1),
  };
};

const selectedSkillsAt = (value: unknown, path: string): readonly SelectedSkillCommandInput[] => {
  if (!Array.isArray(value)) return invalidShape(path, 'array', value);
  return value.map((entry, index) => selectedSkillAt(entry, `${path}[${String(index)}]`));
};

const normalizedCommon = (request: DecodedCommandRequest) => ({
  commandId: request.commandId,
  commandKind: 'workflow-command' as const,
  expectedRevisions: revisionsAt(request.expectedRevisions, '$.expectedRevisions'),
  messageType: 'command.request' as const,
  protocolVersion: 1 as const,
  role: 'player' as const,
});

export function normalizeSkillCheckpointRequest(
  request: DecodedCommandRequest,
): SkillCheckpointCommandRequest {
  if (request.commandKind !== 'workflow-command') {
    return unrecognized('$.commandKind', request.commandKind);
  }
  if (request.workflowCommandId !== WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID) {
    return unrecognized('$.workflowCommandId', request.workflowCommandId);
  }
  if (request.role !== 'player') return unrecognized('$.role', request.role);
  const unshaped = objectAt(request.payload, '$.payload');
  literal(unshaped['stage'], 'SKILLS', '$.payload.stage');
  const sourceFormId = unshaped['sourceFormId'];
  if (sourceFormId !== 'CHR-012' && sourceFormId !== 'CHR-015') {
    return unrecognized('$.payload.sourceFormId', sourceFormId as JsonValue);
  }
  const payload = exactObject(
    request.payload,
    '$.payload',
    sourceFormId === 'CHR-015'
      ? [
          'stage',
          'sourceFormId',
          'characterDraftId',
          'wizardCheckpointId',
          'draftRevision',
          'selectedSkills',
        ]
      : ['stage', 'sourceFormId', 'characterDraftId', 'wizardCheckpointId', 'draftRevision'],
  );
  const common = {
    characterDraftId: nonEmptyStringAt(payload['characterDraftId'], '$.payload.characterDraftId'),
    draftRevision: safeIntegerAt(payload['draftRevision'], '$.payload.draftRevision'),
    stage: 'SKILLS' as const,
    wizardCheckpointId: nonEmptyStringAt(
      payload['wizardCheckpointId'],
      '$.payload.wizardCheckpointId',
    ),
  };
  return {
    ...normalizedCommon(request),
    payload:
      sourceFormId === 'CHR-015'
        ? {
            ...common,
            selectedSkills: selectedSkillsAt(payload['selectedSkills'], '$.payload.selectedSkills'),
            sourceFormId,
          }
        : { ...common, sourceFormId },
    workflowCommandId: WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID,
  };
}

const raceDefinition = (catalog: SkillStageCatalog, raceCode: RaceCode) => {
  const race = catalog.races.find((candidate) => candidate.raceCode === raceCode);
  if (race === undefined) throw new Error(`validated catalog lacks RaceCode ${raceCode}`);
  return race;
};

const skillDefinition = (catalog: SkillStageCatalog, skillKey: string) => {
  const skill = catalog.skills.find((candidate) => candidate.skillKey === skillKey);
  if (skill === undefined) throw new Error(`validated catalog lacks SkillKey ${skillKey}`);
  return skill;
};

const eligibilityFor = (
  catalog: SkillStageCatalog,
  skillKey: string,
  skillStageStats: StatMap,
): boolean => {
  try {
    validateSkillRequirements(catalog, skillKey, skillStageStats);
    return true;
  } catch (cause) {
    if (cause instanceof SkillStageRuleError) return false;
    throw cause;
  }
};

export function deriveSkillEligibility(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SkillStageCatalog,
): SkillEligibilityDerived {
  const stats = deriveChr012StatsView(checkpoint, catalog);
  const assignment = checkpoint.statAssignmentStage;
  if (assignment === null) return guardRejected();
  const raceCode = assignment.derived.raceChoice;
  const classCodeOrNull = checkpoint.pureClassStage?.derived.pureClass ?? null;
  const race = raceDefinition(catalog, raceCode);
  const racialFreeSkills = race.grantedSkillRefs.map((skillKey): RacialFreeSkill => {
    const skill = skillDefinition(catalog, skillKey);
    if (skill.slotCostMode !== 'FIXED_0' || typeof skill.maxBonus !== 'number') {
      throw new Error(`validated racial SkillKey ${skillKey} lacks a fixed free bonus`);
    }
    return { bonus: skill.maxBonus, skillKey, slotCost: 0 };
  });
  const eligibleSkillIds = catalog.skills
    .filter(({ category }) => category === 'SELECTABLE_GENERAL')
    .filter(({ skillKey }) => eligibilityFor(catalog, skillKey, stats.skillStageStats))
    .map(({ skillKey }) => skillKey);
  return {
    classCodeOrNull,
    eligibleSkillIds,
    mandatoryClassSkillOrNull: stats.mandatoryClassSkillOrNull,
    raceCode,
    racialFreeSkills,
    requiredSlotCount: calculateStartSkillSlots(stats.skillStageStats),
    skillStageStats: stats.skillStageStats,
  };
}

export function prepareSkillEligibility(
  checkpoint: DurableCreationWizardCheckpoint,
  request: SkillCheckpointCommandRequest & { readonly payload: SkillEligibilityCheckpointPayload },
  catalog: SkillStageCatalog,
): SkillEligibilityPlan {
  if (
    checkpoint.nextStageEnvelope.formId !== 'CHR-012' ||
    checkpoint.skillEligibilityStage !== null ||
    checkpoint.skillSelectionStage !== null ||
    request.payload.sourceFormId !== 'CHR-012'
  ) {
    return guardRejected();
  }
  return { derived: deriveSkillEligibility(checkpoint, catalog), nextFormId: 'CHR-013' };
}

export function prepareSkillSelection(
  checkpoint: DurableCreationWizardCheckpoint,
  request: SkillCheckpointCommandRequest & { readonly payload: SkillSelectionCheckpointPayload },
  catalog: SkillStageCatalog,
): SkillSelectionPlan {
  const eligibility = checkpoint.skillEligibilityStage;
  if (
    checkpoint.nextStageEnvelope.formId !== 'CHR-013' ||
    eligibility === null ||
    checkpoint.skillSelectionStage !== null ||
    request.payload.sourceFormId !== 'CHR-015'
  ) {
    return guardRejected();
  }
  const canonicalIndexes = new Map(
    catalog.skills.map(({ skillKey }, index) => [skillKey as string, index]),
  );
  let previousIndex = -1;
  for (const { skillId } of request.payload.selectedSkills) {
    const index = canonicalIndexes.get(skillId);
    if (index === undefined || index <= previousIndex) return guardRejected();
    previousIndex = index;
  }
  let selection;
  try {
    selection = validateSkillSelection(catalog, {
      classCode: eligibility.derived.classCodeOrNull,
      raceCode: eligibility.derived.raceCode,
      selectedSkills: request.payload.selectedSkills.map(({ skillId, targetBonus }) => ({
        skillKey: skillId,
        targetBonus,
      })),
      skillStageStats: eligibility.derived.skillStageStats,
    });
  } catch (cause) {
    if (cause instanceof SkillStageRuleError) return guardRejected();
    throw cause;
  }
  return {
    derived: {
      learnedSkills: selection.learnedSkills.map(({ source, skillKey, bonus, slotCost }) => ({
        bonus,
        skillKey,
        slotCost,
        source,
      })),
      requiredSlotCount: selection.capacity,
      selectedSkills: request.payload.selectedSkills.map(({ skillId, targetBonus }) => ({
        skillKey: skillId,
        targetBonus,
      })),
      usedSlotCount: selection.used,
    },
    nextFormId: 'CHR-017',
  };
}

const STORED_REQUEST_VOCABULARY: ProtocolVocabulary = {
  isFormId: (_value): _value is never => false,
  isHostTransition: () => false,
  isWorkflowCommandId: (value): value is WorkflowCommandId =>
    value === WIZARD_CHECKPOINT_WORKFLOW_COMMAND_ID,
};

const storedRequestAt = (value: unknown, label: string): SkillCheckpointCommandRequest => {
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
    return normalizeSkillCheckpointRequest(decoded.value);
  } catch (cause) {
    if (cause instanceof CreationSkillSelectionApplicationError) {
      throw new Error(`${label} request violates the durable skill checkpoint contract`, { cause });
    }
    throw cause;
  }
};

const statMapAt = (value: unknown, path: string): StatMap => {
  const object = exactObject(value, path, STAT_CODES);
  return Object.fromEntries(
    STAT_CODES.map((statCode) => [
      statCode,
      safeIntegerAt(object[statCode], `${path}.${statCode}`, Number.MIN_SAFE_INTEGER),
    ]),
  ) as Record<StatCode, number>;
};

const mandatoryClassSkillAt = (value: unknown, path: string): MandatoryClassSkill | null => {
  if (value === null) return null;
  const object = exactObject(value, path, ['skillKey', 'bonus', 'slotCost']);
  return {
    bonus: safeIntegerAt(object['bonus'], `${path}.bonus`, 1),
    skillKey: nonEmptyStringAt(object['skillKey'], `${path}.skillKey`),
    slotCost: safeIntegerAt(object['slotCost'], `${path}.slotCost`, 1),
  };
};

const racialFreeSkillsAt = (value: unknown, path: string): readonly RacialFreeSkill[] => {
  if (!Array.isArray(value)) return invalidShape(path, 'array', value);
  return value.map((entry, index) => {
    const entryPath = `${path}[${String(index)}]`;
    const object = exactObject(entry, entryPath, ['skillKey', 'bonus', 'slotCost']);
    return {
      bonus: safeIntegerAt(object['bonus'], `${entryPath}.bonus`, 1),
      skillKey: nonEmptyStringAt(object['skillKey'], `${entryPath}.skillKey`),
      slotCost: literal(object['slotCost'], 0, `${entryPath}.slotCost`),
    };
  });
};

const stringArrayAt = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value)) return invalidShape(path, 'array', value);
  return value.map((entry, index) => nonEmptyStringAt(entry, `${path}[${String(index)}]`));
};

const eligibilityDerivedAt = (value: unknown, path: string): SkillEligibilityDerived => {
  const object = exactObject(value, path, [
    'raceCode',
    'classCodeOrNull',
    'skillStageStats',
    'requiredSlotCount',
    'mandatoryClassSkillOrNull',
    'racialFreeSkills',
    'eligibleSkillIds',
  ]);
  const raceCode = object['raceCode'];
  if (raceCode !== 'PURE' && raceCode !== 'FREE' && raceCode !== 'UNITED') {
    return unrecognized(`${path}.raceCode`, raceCode as JsonValue);
  }
  const classCode = object['classCodeOrNull'];
  if (
    classCode !== null &&
    classCode !== 'SEEKER' &&
    classCode !== 'STALKER' &&
    classCode !== 'SOLDIER'
  ) {
    return unrecognized(`${path}.classCodeOrNull`, classCode as JsonValue);
  }
  return {
    classCodeOrNull: classCode,
    eligibleSkillIds: stringArrayAt(object['eligibleSkillIds'], `${path}.eligibleSkillIds`),
    mandatoryClassSkillOrNull: mandatoryClassSkillAt(
      object['mandatoryClassSkillOrNull'],
      `${path}.mandatoryClassSkillOrNull`,
    ),
    raceCode,
    racialFreeSkills: racialFreeSkillsAt(object['racialFreeSkills'], `${path}.racialFreeSkills`),
    requiredSlotCount: safeIntegerAt(object['requiredSlotCount'], `${path}.requiredSlotCount`, 1),
    skillStageStats: statMapAt(object['skillStageStats'], `${path}.skillStageStats`),
  };
};

const selectionDerivedAt = (value: unknown, path: string): SkillSelectionDerived => {
  const object = exactObject(value, path, [
    'selectedSkills',
    'learnedSkills',
    'requiredSlotCount',
    'usedSlotCount',
  ]);
  if (!Array.isArray(object['selectedSkills'])) {
    return invalidShape(`${path}.selectedSkills`, 'array', object['selectedSkills']);
  }
  if (!Array.isArray(object['learnedSkills'])) {
    return invalidShape(`${path}.learnedSkills`, 'array', object['learnedSkills']);
  }
  return {
    learnedSkills: object['learnedSkills'].map((entry, index) => {
      const entryPath = `${path}.learnedSkills[${String(index)}]`;
      const item = exactObject(entry, entryPath, ['source', 'skillKey', 'bonus', 'slotCost']);
      const source = item['source'];
      if (source !== 'SELECTED' && source !== 'RACE_GRANTED' && source !== 'CLASS_MANDATORY') {
        return unrecognized(`${entryPath}.source`, source as JsonValue);
      }
      return {
        bonus: safeIntegerAt(item['bonus'], `${entryPath}.bonus`, 1),
        skillKey: nonEmptyStringAt(item['skillKey'], `${entryPath}.skillKey`),
        slotCost: safeIntegerAt(item['slotCost'], `${entryPath}.slotCost`),
        source,
      };
    }),
    requiredSlotCount: safeIntegerAt(object['requiredSlotCount'], `${path}.requiredSlotCount`, 1),
    selectedSkills: object['selectedSkills'].map((entry, index) => {
      const entryPath = `${path}.selectedSkills[${String(index)}]`;
      const item = exactObject(entry, entryPath, ['skillKey', 'targetBonus']);
      return {
        skillKey: nonEmptyStringAt(item['skillKey'], `${entryPath}.skillKey`),
        targetBonus: safeIntegerAt(item['targetBonus'], `${entryPath}.targetBonus`, 1),
      };
    }),
    usedSlotCount: safeIntegerAt(object['usedSlotCount'], `${path}.usedSlotCount`, 1),
  };
};

const envelopeAt = <T extends 'CHR-013' | 'CHR-017'>(
  value: unknown,
  path: string,
  formId: T,
): CreationNextStageEnvelope<T> => {
  const object = exactObject(value, path, ['formId', 'routeBindings']);
  literal(object['formId'], formId, `${path}.formId`);
  const bindings = object['routeBindings'];
  if (!Array.isArray(bindings) || bindings.length !== 1) {
    return invalidShape(`${path}.routeBindings`, 'one-element array', bindings);
  }
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
        value: nonEmptyStringAt(binding['value'], `${path}.routeBindings[0].value`),
      },
    ],
  };
};

const receiptAt = (value: unknown, label: string): SkillCheckpointReceipt => {
  const object = exactObject(value, `${label}.receipt`, [
    'commandId',
    'receiptId',
    'result',
    'revisions',
  ]);
  const unshapedResult = objectAt(object['result'], `${label}.receipt.result`);
  const sourceFormId = unshapedResult['sourceFormId'];
  if (sourceFormId !== 'CHR-012' && sourceFormId !== 'CHR-015') {
    return unrecognized(`${label}.receipt.result.sourceFormId`, sourceFormId as JsonValue);
  }
  const derivedKeys =
    sourceFormId === 'CHR-012'
      ? [
          'raceCode',
          'classCodeOrNull',
          'skillStageStats',
          'requiredSlotCount',
          'mandatoryClassSkillOrNull',
          'racialFreeSkills',
          'eligibleSkillIds',
        ]
      : ['selectedSkills', 'learnedSkills', 'requiredSlotCount', 'usedSlotCount'];
  const result = exactObject(object['result'], `${label}.receipt.result`, [
    'stage',
    'sourceFormId',
    'characterDraftId',
    'checkpointOwnerId',
    'checkpointId',
    'checkpointRevision',
    'draftRevision',
    'branchCacheHash',
    'branchUuid',
    'nextFormId',
    ...derivedKeys,
  ]);
  const common = {
    branchCacheHash: literal(
      result['branchCacheHash'],
      EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      `${label}.receipt.result.branchCacheHash`,
    ),
    branchUuid: nonEmptyStringAt(result['branchUuid'], `${label}.receipt.result.branchUuid`),
    characterDraftId: nonEmptyStringAt(
      result['characterDraftId'],
      `${label}.receipt.result.characterDraftId`,
    ),
    checkpointId: nonEmptyStringAt(result['checkpointId'], `${label}.receipt.result.checkpointId`),
    checkpointOwnerId: nonEmptyStringAt(
      result['checkpointOwnerId'],
      `${label}.receipt.result.checkpointOwnerId`,
    ),
    checkpointRevision: safeIntegerAt(
      result['checkpointRevision'],
      `${label}.receipt.result.checkpointRevision`,
    ),
    draftRevision: safeIntegerAt(result['draftRevision'], `${label}.receipt.result.draftRevision`),
    stage: literal(result['stage'], 'SKILLS', `${label}.receipt.result.stage`),
  };
  return {
    commandId: nonEmptyStringAt(object['commandId'], `${label}.receipt.commandId`),
    receiptId: nonEmptyStringAt(object['receiptId'], `${label}.receipt.receiptId`),
    result:
      sourceFormId === 'CHR-012'
        ? {
            ...common,
            ...eligibilityDerivedAt(
              {
                classCodeOrNull: result['classCodeOrNull'],
                eligibleSkillIds: result['eligibleSkillIds'],
                mandatoryClassSkillOrNull: result['mandatoryClassSkillOrNull'],
                raceCode: result['raceCode'],
                racialFreeSkills: result['racialFreeSkills'],
                requiredSlotCount: result['requiredSlotCount'],
                skillStageStats: result['skillStageStats'],
              },
              `${label}.receipt.result`,
            ),
            nextFormId: literal(
              result['nextFormId'],
              'CHR-013',
              `${label}.receipt.result.nextFormId`,
            ),
            sourceFormId,
          }
        : {
            ...common,
            ...selectionDerivedAt(
              {
                learnedSkills: result['learnedSkills'],
                requiredSlotCount: result['requiredSlotCount'],
                selectedSkills: result['selectedSkills'],
                usedSlotCount: result['usedSlotCount'],
              },
              `${label}.receipt.result`,
            ),
            nextFormId: literal(
              result['nextFormId'],
              'CHR-017',
              `${label}.receipt.result.nextFormId`,
            ),
            sourceFormId,
          },
    revisions: revisionsAt(object['revisions'], `${label}.receipt.revisions`),
  } as SkillCheckpointReceipt;
};

export function parseSkillEligibilityStage(value: unknown, label: string): SkillEligibilityStage {
  const path = `${label}.skillEligibilityStage`;
  const object = exactObject(value, path, ['request', 'derived', 'receipt', 'nextStageEnvelope']);
  const request = storedRequestAt(object['request'], path);
  if (request.payload.sourceFormId !== 'CHR-012') {
    throw new Error(`${path} request must originate from CHR-012`);
  }
  const receipt = receiptAt(object['receipt'], path);
  if (receipt.result.sourceFormId !== 'CHR-012') {
    throw new Error(`${path} receipt must originate from CHR-012`);
  }
  return {
    derived: eligibilityDerivedAt(object['derived'], `${path}.derived`),
    nextStageEnvelope: envelopeAt(
      object['nextStageEnvelope'],
      `${path}.nextStageEnvelope`,
      'CHR-013',
    ),
    receipt: receipt as SkillEligibilityCheckpointReceipt,
    request: request as SkillEligibilityStage['request'],
  };
}

export function parseSkillSelectionStage(
  value: unknown,
  label: string,
): SkillSelectionStage | null {
  if (value === null) return null;
  const path = `${label}.skillSelectionStage`;
  const object = exactObject(value, path, ['request', 'derived', 'receipt', 'nextStageEnvelope']);
  const request = storedRequestAt(object['request'], path);
  if (request.payload.sourceFormId !== 'CHR-015') {
    throw new Error(`${path} request must originate from CHR-015`);
  }
  const receipt = receiptAt(object['receipt'], path);
  if (receipt.result.sourceFormId !== 'CHR-015') {
    throw new Error(`${path} receipt must originate from CHR-015`);
  }
  return {
    derived: selectionDerivedAt(object['derived'], `${path}.derived`),
    nextStageEnvelope: envelopeAt(
      object['nextStageEnvelope'],
      `${path}.nextStageEnvelope`,
      'CHR-017',
    ),
    receipt: receipt as SkillSelectionCheckpointReceipt,
    request: request as SkillSelectionStage['request'],
  };
}

export function slotCostOptions(maximumPaidSlots: number): readonly {
  readonly targetBonus: number;
  readonly slotCost: number;
}[] {
  const options: { targetBonus: number; slotCost: number }[] = [];
  for (let targetBonus = 1; ; targetBonus += 1) {
    const slotCost = calculateSkillSlotCost(targetBonus);
    if (slotCost > maximumPaidSlots) break;
    options.push({ slotCost, targetBonus });
  }
  return options;
}

export const skillSelectionRaceChoice = (derived: SkillEligibilityDerived): RaceChoice =>
  derived.raceCode;

export interface SkillLevelOption extends JsonObject {
  readonly targetBonus: number;
  readonly slotCost: number;
}

export interface SkillRequirementView extends JsonObject {
  readonly statCode: StatCode;
  readonly statLabel: string;
  readonly minValue: number;
  readonly currentValue: number;
  readonly satisfied: boolean;
}

export interface SkillCardSummaryView extends JsonObject {
  readonly bonusDomainScope: string;
  readonly skillId: string;
  readonly skillLabel: string;
  readonly eligibility: 'ELIGIBLE' | 'REQUIREMENTS_NOT_MET';
  readonly missingSkillPenalty: CreationMissingSkillPenalty;
  readonly requirements: readonly SkillRequirementView[];
  readonly levelOptions: readonly SkillLevelOption[];
}

export interface SkillSourceView extends JsonObject {
  readonly skillId: string;
  readonly skillLabel: string;
  readonly bonus: number;
  readonly slotCost: number;
}

export interface Chr013SkillCatalogView {
  readonly characterDraftId: string;
  readonly skillStageStats: StatMap;
  readonly eligibleSkillIds: readonly string[];
  readonly skillCardSummaries: readonly SkillCardSummaryView[];
  readonly slotSources: {
    readonly mandatoryClassSkillOrNull: SkillSourceView | null;
    readonly racialFreeSkills: readonly SkillSourceView[];
    readonly requiredSlotCount: number;
  };
  readonly selectedSkillIdOrNull: null;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
}

export interface SkillOptionView extends JsonObject {
  readonly bonusDomainScope: string;
  readonly skillId: string;
  readonly skillLabel: string;
  readonly levelOptions: readonly SkillLevelOption[];
  readonly missingSkillPenalty: CreationMissingSkillPenalty;
}

export interface SelectedSkillView extends JsonObject {
  readonly skillId: string;
  readonly targetBonus: number;
  readonly slotCost: number;
}

export interface PaidSkillEntryView extends SkillSourceView {
  readonly source: 'CLASS_MANDATORY' | 'SELECTED';
}

export type SkillSelectionValidationView =
  | {
      readonly kind: 'UNDERFILLED';
      readonly requiredSlotCount: number;
      readonly usedSlotCount: number;
      readonly missingSlotCount: number;
    }
  | {
      readonly kind: 'EXACT';
      readonly requiredSlotCount: number;
      readonly usedSlotCount: number;
    }
  | {
      readonly kind: 'OVERFILLED';
      readonly requiredSlotCount: number;
      readonly usedSlotCount: number;
      readonly excessSlotCount: number;
    };

export interface Chr015SkillSelectionView {
  readonly characterDraftId: string;
  readonly selectedSkillIds: readonly string[];
  readonly selectedSkills: readonly SelectedSkillView[];
  readonly mandatoryClassSkillOrNull: SkillSourceView | null;
  readonly racialFreeSkillIds: readonly string[];
  readonly racialFreeSkills: readonly SkillSourceView[];
  readonly paidSlotUsage: {
    readonly entries: readonly PaidSkillEntryView[];
    readonly usedSlotCount: number;
  };
  readonly requiredSlotCount: number;
  readonly eligibleSkillIds: readonly string[];
  readonly skillOptions: readonly SkillOptionView[];
  readonly selectionValidation: SkillSelectionValidationView;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly commandId: string | null;
}

const labelFor = (catalog: CreationSkillCatalog, skillId: string): string => {
  const label = catalog.skillLabels.find((candidate) => candidate.skillId === skillId)?.skillLabel;
  if (label === undefined) {
    throw new Error(`validated player skill catalog lacks SkillKey ${JSON.stringify(skillId)}`);
  }
  return label;
};

const sourceView = (
  source: MandatoryClassSkill | RacialFreeSkill,
  catalog: CreationSkillCatalog,
): SkillSourceView => ({
  bonus: source.bonus,
  skillId: source.skillKey,
  skillLabel: labelFor(catalog, source.skillKey),
  slotCost: source.slotCost,
});

const maximumSelectableSlots = (derived: SkillEligibilityDerived): number =>
  Math.max(0, derived.requiredSlotCount - (derived.mandatoryClassSkillOrNull?.slotCost ?? 0));

const cardSummaries = (
  derived: SkillEligibilityDerived,
  presentationCatalog: CreationSkillCatalog,
): readonly SkillCardSummaryView[] => {
  const eligible = new Set(derived.eligibleSkillIds);
  const levels = slotCostOptions(maximumSelectableSlots(derived));
  return presentationCatalog.selectableSkills.map((skill): SkillCardSummaryView => {
    const requirements = skill.requirements.map((requirement): SkillRequirementView => {
      const currentValue = derived.skillStageStats[requirement.statCode];
      return {
        currentValue,
        minValue: requirement.minValue,
        satisfied: currentValue >= requirement.minValue,
        statCode: requirement.statCode,
        statLabel: requirement.statLabel,
      };
    });
    const projectedEligibility = requirements.every(({ satisfied }) => satisfied);
    if (projectedEligibility !== eligible.has(skill.skillId)) {
      throw new Error(
        `player skill requirements disagree with eligibility for ${JSON.stringify(skill.skillId)}`,
      );
    }
    return {
      bonusDomainScope: skill.bonusDomainScope,
      eligibility: projectedEligibility ? 'ELIGIBLE' : 'REQUIREMENTS_NOT_MET',
      levelOptions: levels,
      missingSkillPenalty: skill.missingSkillPenalty,
      requirements,
      skillId: skill.skillId,
      skillLabel: skill.skillLabel,
    };
  });
};

export function deriveChr013SkillCatalogView(
  checkpoint: DurableCreationWizardCheckpoint,
  presentationCatalog: CreationSkillCatalog,
): Chr013SkillCatalogView {
  const stage = checkpoint.skillEligibilityStage;
  if (
    checkpoint.nextStageEnvelope.formId !== 'CHR-013' ||
    stage === null ||
    checkpoint.skillSelectionStage !== null
  ) {
    return guardRejected();
  }
  const derived = stage.derived;
  return {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    draftRevision: checkpoint.receipt.result.draftRevision,
    eligibleSkillIds: derived.eligibleSkillIds,
    selectedSkillIdOrNull: null,
    skillCardSummaries: cardSummaries(derived, presentationCatalog),
    skillStageStats: derived.skillStageStats,
    slotSources: {
      mandatoryClassSkillOrNull:
        derived.mandatoryClassSkillOrNull === null
          ? null
          : sourceView(derived.mandatoryClassSkillOrNull, presentationCatalog),
      racialFreeSkills: derived.racialFreeSkills.map((skill) =>
        sourceView(skill, presentationCatalog),
      ),
      requiredSlotCount: derived.requiredSlotCount,
    },
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
  };
}

const selectionValidation = (
  usedSlotCount: number,
  requiredSlotCount: number,
): SkillSelectionValidationView => {
  if (usedSlotCount < requiredSlotCount) {
    return {
      kind: 'UNDERFILLED',
      missingSlotCount: requiredSlotCount - usedSlotCount,
      requiredSlotCount,
      usedSlotCount,
    };
  }
  if (usedSlotCount > requiredSlotCount) {
    return {
      excessSlotCount: usedSlotCount - requiredSlotCount,
      kind: 'OVERFILLED',
      requiredSlotCount,
      usedSlotCount,
    };
  }
  return { kind: 'EXACT', requiredSlotCount, usedSlotCount };
};

export function deriveChr015SkillSelectionView(
  checkpoint: DurableCreationWizardCheckpoint,
  presentationCatalog: CreationSkillCatalog,
): Chr015SkillSelectionView {
  const eligibility = checkpoint.skillEligibilityStage;
  const selection = checkpoint.skillSelectionStage;
  if (
    eligibility === null ||
    (checkpoint.nextStageEnvelope.formId !== 'CHR-013' &&
      checkpoint.nextStageEnvelope.formId !== 'CHR-017') ||
    (checkpoint.nextStageEnvelope.formId === 'CHR-013' && selection !== null) ||
    (checkpoint.nextStageEnvelope.formId === 'CHR-017' && selection === null)
  ) {
    return guardRejected();
  }
  const derived = eligibility.derived;
  const mandatory = derived.mandatoryClassSkillOrNull;
  const selected = selection?.derived.selectedSkills ?? [];
  const learnedSelected = new Map(
    (selection?.derived.learnedSkills ?? [])
      .filter(({ source }) => source === 'SELECTED')
      .map((skill) => [skill.skillKey, skill]),
  );
  if (learnedSelected.size !== selected.length) return guardRejected();
  const selectedSkills = selected.map(({ skillKey, targetBonus }): SelectedSkillView => {
    const learned = learnedSelected.get(skillKey);
    if (learned === undefined || learned.bonus !== targetBonus) return guardRejected();
    return { skillId: skillKey, slotCost: learned.slotCost, targetBonus };
  });
  const entries: PaidSkillEntryView[] = [];
  if (mandatory !== null) {
    entries.push({ ...sourceView(mandatory, presentationCatalog), source: 'CLASS_MANDATORY' });
  }
  for (const selectedSkill of selectedSkills) {
    entries.push({
      bonus: selectedSkill.targetBonus,
      skillId: selectedSkill.skillId,
      skillLabel: labelFor(presentationCatalog, selectedSkill.skillId),
      slotCost: selectedSkill.slotCost,
      source: 'SELECTED',
    });
  }
  const usedSlotCount = entries.reduce((total, entry) => total + entry.slotCost, 0);
  if (selection !== null && usedSlotCount !== selection.derived.usedSlotCount) {
    return guardRejected();
  }
  const summaries = cardSummaries(derived, presentationCatalog);
  const eligible = new Set(derived.eligibleSkillIds);
  return {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    commandId: selection?.request.commandId ?? null,
    draftRevision: checkpoint.receipt.result.draftRevision,
    eligibleSkillIds: derived.eligibleSkillIds,
    mandatoryClassSkillOrNull:
      mandatory === null ? null : sourceView(mandatory, presentationCatalog),
    paidSlotUsage: { entries, usedSlotCount },
    racialFreeSkillIds: derived.racialFreeSkills.map(({ skillKey }) => skillKey),
    racialFreeSkills: derived.racialFreeSkills.map((skill) =>
      sourceView(skill, presentationCatalog),
    ),
    requiredSlotCount: derived.requiredSlotCount,
    selectedSkillIds: selectedSkills.map(({ skillId }) => skillId),
    selectedSkills,
    selectionValidation: selectionValidation(usedSlotCount, derived.requiredSlotCount),
    skillOptions: summaries
      .filter(({ skillId }) => eligible.has(skillId))
      .map(({ bonusDomainScope, skillId, skillLabel, levelOptions, missingSkillPenalty }) => ({
        bonusDomainScope,
        levelOptions,
        missingSkillPenalty,
        skillId,
        skillLabel,
      })),
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
  };
}
