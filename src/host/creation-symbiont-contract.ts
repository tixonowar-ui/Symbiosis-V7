import { isDeepStrictEqual } from 'node:util';

import type {
  ClientToHostMessage,
  CommandReceipt,
  CommandRefusal,
  JsonObject,
  JsonValue,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';

import {
  resolveRandomSymbiontSequence,
  type AdvisorSkillSelectionResult,
  type RandomSymbiontPhysicalRoll,
  type RandomSymbiontPhysicalRollKind,
  type RandomSymbiontRaceCode,
  type RandomSymbiontSequence,
  type RandomSymbiontStatus,
  type ResolvedRandomSymbiontSequence,
  type SymbiontBindingSelection,
  type SymbiontCatalog,
  type SymbiontSide,
  type SymbiontSpeciesBinding,
  type SymbioticMonsterSpeciesKey,
} from '../domain/index.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';
import type { SelectedSkillCommandInput } from './creation-skill-selection.js';
import type {
  CreationNextStageEnvelope,
  CreationRollCommitCommandRequest,
  DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';

export const SYMBIONT_STAGE = 'SYMBIONTS' as const;
export const CHR_020_FORM_ID = 'CHR-020' as const;
export const CHR_041_FORM_ID = 'CHR-041' as const;

interface SymbiontPayloadCommon extends JsonObject {
  readonly stage: typeof SYMBIONT_STAGE;
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly randomSequenceId: string;
}

export interface SymbiontRollCommitPayload extends SymbiontPayloadCommon {
  readonly sourceFormId: typeof CHR_020_FORM_ID;
  readonly variant: 'ROLL';
  readonly pendingRollRequestIdOrNull: string | null;
  readonly manualFaceOrNull: number | null;
  readonly selectedMonsterSpeciesKeyOrNull: SymbioticMonsterSpeciesKey | null;
}

export interface SymbiontBindingSelectionInput extends JsonObject {
  readonly speciesKey: 'OWL' | 'EEL';
  readonly side: SymbiontSide;
}

export interface SymbiontBindingCommitPayload extends SymbiontPayloadCommon {
  readonly sourceFormId: typeof CHR_020_FORM_ID;
  readonly variant: 'BINDING';
  readonly physicalRollReceiptIds: readonly string[];
  readonly selectedBindings: readonly SymbiontBindingSelectionInput[];
}

export type SymbiontRollCommitCommandPayload =
  SymbiontBindingCommitPayload | SymbiontRollCommitPayload;
export type SymbiontRollCommitCommandRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  SymbiontRollCommitCommandPayload
>;
export type SymbiontPhysicalRollCommandRequest = SymbiontRollCommitCommandRequest & {
  readonly payload: SymbiontRollCommitPayload;
};
export type SymbiontBindingCommandRequest = SymbiontRollCommitCommandRequest & {
  readonly payload: SymbiontBindingCommitPayload;
};

export interface SymbiontAdvisorCheckpointPayload extends SymbiontPayloadCommon {
  readonly sourceFormId: typeof CHR_041_FORM_ID;
  readonly advisorInstanceDraftId: string;
  readonly selectedSkills: readonly SelectedSkillCommandInput[];
}
export type SymbiontAdvisorCheckpointCommandRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  SymbiontAdvisorCheckpointPayload
>;

interface SymbiontReceiptResultCommon extends JsonObject {
  readonly stage: typeof SYMBIONT_STAGE;
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly randomSequenceId: string;
}

export interface SymbiontPhysicalRollReceiptResult extends SymbiontReceiptResultCommon {
  readonly sourceFormId: typeof CHR_020_FORM_ID;
  readonly variant: 'ROLL';
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly physicalRoll: JsonObject;
  readonly nextPendingRollRequestIdOrNull: string | null;
  readonly randomStatus: RandomSymbiontStatus;
  readonly advisorBranch: boolean;
  readonly randomReceiptIdOrNull: string | null;
  readonly nextFormId: typeof CHR_020_FORM_ID;
}
export type SymbiontPhysicalRollReceipt = CommandReceipt<SymbiontPhysicalRollReceiptResult>;

export interface SymbiontBindingReceiptResult extends SymbiontReceiptResultCommon {
  readonly sourceFormId: typeof CHR_020_FORM_ID;
  readonly variant: 'BINDING';
  readonly bindings: readonly JsonObject[];
  readonly randomStatus: 'COMMITTED';
  readonly advisorBranch: boolean;
  readonly nextFormId: 'CHR-019' | typeof CHR_041_FORM_ID;
}
export type SymbiontBindingReceipt = CommandReceipt<SymbiontBindingReceiptResult>;

export interface SymbiontAdvisorCheckpointReceiptResult extends SymbiontReceiptResultCommon {
  readonly sourceFormId: typeof CHR_041_FORM_ID;
  readonly advisorInstanceDraftId: string;
  readonly selectedSkills: readonly SelectedSkillCommandInput[];
  readonly learnedSkills: readonly JsonObject[];
  readonly requiredSlotCount: number;
  readonly usedSlotCount: number;
  readonly effectsActive: boolean;
  readonly nextFormId: 'CHR-019';
}
export type SymbiontAdvisorCheckpointReceipt =
  CommandReceipt<SymbiontAdvisorCheckpointReceiptResult>;

export interface SymbiontPhysicalRollRecord {
  readonly physicalRoll: RandomSymbiontPhysicalRoll;
  readonly request: SymbiontPhysicalRollCommandRequest;
  readonly receipt: SymbiontPhysicalRollReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<typeof CHR_020_FORM_ID>;
}
export interface SymbiontBindingRecord {
  readonly bindings: readonly SymbiontSpeciesBinding[];
  readonly request: SymbiontBindingCommandRequest;
  readonly receipt: SymbiontBindingReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-019' | typeof CHR_041_FORM_ID>;
}
export interface SymbiontAdvisorSkillRecord {
  readonly selectedSkills: readonly SelectedSkillCommandInput[];
  readonly learnedSkills: AdvisorSkillSelectionResult['learnedSkills'];
  readonly advisorStats: AdvisorSkillSelectionResult['advisorStats'];
  readonly request: SymbiontAdvisorCheckpointCommandRequest;
  readonly receipt: SymbiontAdvisorCheckpointReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-019'>;
}
export interface SymbiontPendingRollRequest {
  readonly rollRequestId: string;
  readonly kind: RandomSymbiontPhysicalRollKind;
  readonly originRollRequestIdOrNull: string | null;
  readonly advisorAcceptedIndexOrNull: number | null;
}
export interface RandomSymbiontStage {
  readonly randomSequenceId: string;
  readonly raceCode: RandomSymbiontRaceCode;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly pendingRollRequestOrNull: SymbiontPendingRollRequest | null;
  readonly rollRecords: readonly SymbiontPhysicalRollRecord[];
  readonly bindingRecordOrNull: SymbiontBindingRecord | null;
  readonly advisorInstanceDraftIdOrNull: string | null;
  readonly advisorSkillRecordOrNull: SymbiontAdvisorSkillRecord | null;
}

export class CreationSymbiontApplicationError extends Error {
  constructor(readonly refusal: CommandRefusal) {
    super(`creation symbiont request refused: ${JSON.stringify(refusal)}`);
  }
}

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;
const typeName = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const invalidShape = (path: string, expected: string, value: unknown): never => {
  throw new CreationSymbiontApplicationError({
    actualType: typeName(value),
    code: 'INVALID_SHAPE',
    expected,
    path,
  });
};
const unrecognized = (path: string, value: JsonValue): never => {
  throw new CreationSymbiontApplicationError({ code: 'UNRECOGNIZED', path, value });
};
export const guardSymbiontRejected = (): never => {
  throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
};
export const objectSymbiontAt = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidShape(path, 'object', value);
  }
  return value as Record<string, unknown>;
};
export const exactSymbiontObject = (
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> => {
  const object = objectSymbiontAt(value, path);
  for (const key of keys) {
    if (!Object.hasOwn(object, key)) invalidShape(`${path}.${key}`, 'required field', undefined);
  }
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) invalidShape(`${path}.${key}`, 'no additional field', object[key]);
  }
  return object;
};
export const stringSymbiontAt = (value: unknown, path: string): string => {
  if (typeof value !== 'string') return invalidShape(path, 'string', value);
  return value;
};
export const nonEmptySymbiontStringAt = (value: unknown, path: string): string => {
  const string = stringSymbiontAt(value, path);
  if (string.length === 0) return invalidShape(path, 'non-empty string', value);
  return string;
};
export const revisionSymbiontAt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalidShape(path, 'non-negative safe integer', value);
  }
  return Object.is(value, -0) ? 0 : value;
};
export const d20SymbiontFaceAt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 20) {
    return invalidShape(path, 'safe integer in 1..20', value);
  }
  return value;
};
export const positiveSymbiontIntegerAt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return invalidShape(path, 'positive safe integer', value);
  }
  return value;
};
const manualFaceAt = (value: unknown, path: string): number | null =>
  value === null ? null : d20SymbiontFaceAt(value, path);
const revisionsAt = (value: unknown, path: string): RevisionVector => {
  const object = exactSymbiontObject(value, path, [
    'actorVisibilityRevision',
    'projectionRevision',
    'stateRevision',
  ]);
  return {
    actorVisibilityRevision: revisionSymbiontAt(
      object['actorVisibilityRevision'],
      `${path}.actorVisibilityRevision`,
    ),
    projectionRevision: revisionSymbiontAt(
      object['projectionRevision'],
      `${path}.projectionRevision`,
    ),
    stateRevision: revisionSymbiontAt(object['stateRevision'], `${path}.stateRevision`),
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
  const string = stringSymbiontAt(value, path);
  const selected = values.find((candidate) => candidate === string);
  if (selected === undefined) return unrecognized(path, string);
  return selected;
};
const commonRequest = (
  request: DecodedCommandRequest,
  workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT' | 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  sourceFormId: 'CHR-020' | 'CHR-041',
) => {
  const envelope = exactSymbiontObject(request, '$', [
    'commandId',
    'commandKind',
    'expectedRevisions',
    'messageType',
    'payload',
    'protocolVersion',
    'role',
    'workflowCommandId',
  ]);
  literal(envelope['messageType'], 'command.request', '$.messageType');
  literal(envelope['protocolVersion'], 1, '$.protocolVersion');
  nonEmptySymbiontStringAt(envelope['commandId'], '$.commandId');
  if (request.commandKind !== 'workflow-command') {
    return unrecognized('$.commandKind', request.commandKind);
  }
  if (request.workflowCommandId !== workflowCommandId) {
    return unrecognized('$.workflowCommandId', request.workflowCommandId);
  }
  if (request.role !== 'player') return unrecognized('$.role', request.role);
  const unshaped = objectSymbiontAt(request.payload, '$.payload');
  literal(unshaped['stage'], SYMBIONT_STAGE, '$.payload.stage');
  literal(unshaped['sourceFormId'], sourceFormId, '$.payload.sourceFormId');
  return {
    characterDraftId: nonEmptySymbiontStringAt(
      unshaped['characterDraftId'],
      '$.payload.characterDraftId',
    ),
    draftRevision: revisionSymbiontAt(unshaped['draftRevision'], '$.payload.draftRevision'),
    randomSequenceId: nonEmptySymbiontStringAt(
      unshaped['randomSequenceId'],
      '$.payload.randomSequenceId',
    ),
    wizardCheckpointId: nonEmptySymbiontStringAt(
      unshaped['wizardCheckpointId'],
      '$.payload.wizardCheckpointId',
    ),
    expectedRevisions: revisionsAt(request.expectedRevisions, '$.expectedRevisions'),
  };
};

export function normalizeSymbiontRollCommitRequest(
  request: DecodedCommandRequest,
): SymbiontRollCommitCommandRequest {
  const { expectedRevisions, ...common } = commonRequest(
    request,
    'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    CHR_020_FORM_ID,
  );
  const unshaped = objectSymbiontAt(request.payload, '$.payload');
  const variant = enumAt(unshaped['variant'], '$.payload.variant', ['ROLL', 'BINDING'] as const);
  const variantKeys =
    variant === 'ROLL'
      ? ['pendingRollRequestIdOrNull', 'manualFaceOrNull', 'selectedMonsterSpeciesKeyOrNull']
      : ['physicalRollReceiptIds', 'selectedBindings'];
  const payload = exactSymbiontObject(request.payload, '$.payload', [
    'stage',
    'sourceFormId',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    'randomSequenceId',
    'variant',
    ...variantKeys,
  ]);
  let normalizedPayload: SymbiontRollCommitCommandPayload;
  if (variant === 'ROLL') {
    const selectedMonster = payload['selectedMonsterSpeciesKeyOrNull'];
    if (
      selectedMonster !== null &&
      selectedMonster !== 'CHIMERA' &&
      selectedMonster !== 'PUPPETEER' &&
      selectedMonster !== 'PLAGUE_DOCTOR'
    ) {
      return unrecognized(
        '$.payload.selectedMonsterSpeciesKeyOrNull',
        selectedMonster as JsonValue,
      );
    }
    normalizedPayload = {
      ...common,
      sourceFormId: CHR_020_FORM_ID,
      stage: SYMBIONT_STAGE,
      variant,
      pendingRollRequestIdOrNull:
        payload['pendingRollRequestIdOrNull'] === null
          ? null
          : nonEmptySymbiontStringAt(
              payload['pendingRollRequestIdOrNull'],
              '$.payload.pendingRollRequestIdOrNull',
            ),
      manualFaceOrNull: manualFaceAt(payload['manualFaceOrNull'], '$.payload.manualFaceOrNull'),
      selectedMonsterSpeciesKeyOrNull: selectedMonster,
    };
  } else {
    const receiptIds = payload['physicalRollReceiptIds'];
    if (!Array.isArray(receiptIds)) {
      return invalidShape('$.payload.physicalRollReceiptIds', 'array of receipt IDs', receiptIds);
    }
    const bindings = payload['selectedBindings'];
    if (!Array.isArray(bindings)) {
      return invalidShape('$.payload.selectedBindings', 'array of side selections', bindings);
    }
    normalizedPayload = {
      ...common,
      sourceFormId: CHR_020_FORM_ID,
      stage: SYMBIONT_STAGE,
      variant,
      physicalRollReceiptIds: receiptIds.map((id, index) =>
        nonEmptySymbiontStringAt(id, `$.payload.physicalRollReceiptIds[${String(index)}]`),
      ),
      selectedBindings: bindings.map((binding, index): SymbiontBindingSelectionInput => {
        const path = `$.payload.selectedBindings[${String(index)}]`;
        const object = exactSymbiontObject(binding, path, ['speciesKey', 'side']);
        return {
          speciesKey: enumAt(object['speciesKey'], `${path}.speciesKey`, ['OWL', 'EEL'] as const),
          side: enumAt(object['side'], `${path}.side`, ['LEFT', 'RIGHT'] as const),
        };
      }),
    };
  }
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions,
    messageType: 'command.request',
    payload: normalizedPayload,
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  };
}

export function normalizeSymbiontAdvisorCheckpointRequest(
  request: DecodedCommandRequest,
): SymbiontAdvisorCheckpointCommandRequest {
  const { expectedRevisions, ...common } = commonRequest(
    request,
    'UI-CMD-CHAR-WIZARD-CHECKPOINT',
    CHR_041_FORM_ID,
  );
  const payload = exactSymbiontObject(request.payload, '$.payload', [
    'stage',
    'sourceFormId',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    'randomSequenceId',
    'advisorInstanceDraftId',
    'selectedSkills',
  ]);
  const selectedSkills = payload['selectedSkills'];
  if (!Array.isArray(selectedSkills)) {
    return invalidShape('$.payload.selectedSkills', 'array of selected skills', selectedSkills);
  }
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions,
    messageType: 'command.request',
    payload: {
      ...common,
      sourceFormId: CHR_041_FORM_ID,
      stage: SYMBIONT_STAGE,
      advisorInstanceDraftId: nonEmptySymbiontStringAt(
        payload['advisorInstanceDraftId'],
        '$.payload.advisorInstanceDraftId',
      ),
      selectedSkills: selectedSkills.map((selection, index) => {
        const path = `$.payload.selectedSkills[${String(index)}]`;
        const object = exactSymbiontObject(selection, path, ['skillId', 'targetBonus']);
        return {
          skillId: nonEmptySymbiontStringAt(object['skillId'], `${path}.skillId`),
          targetBonus: positiveSymbiontIntegerAt(object['targetBonus'], `${path}.targetBonus`),
        };
      }),
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  };
}

export function createInitialRandomSymbiontStage(
  randomSequenceId: string,
  raceCode: RandomSymbiontRaceCode,
  diceInputModeSnapshot: 'AUTO' | 'MANUAL',
): RandomSymbiontStage {
  return {
    randomSequenceId,
    raceCode,
    diceInputModeSnapshot,
    pendingRollRequestOrNull: null,
    rollRecords: [],
    bindingRecordOrNull: null,
    advisorInstanceDraftIdOrNull: null,
    advisorSkillRecordOrNull: null,
  };
}

export function domainRandomSequence(stage: RandomSymbiontStage): RandomSymbiontSequence {
  return {
    randomSequenceId: stage.randomSequenceId,
    raceCode: stage.raceCode,
    diceInputModeSnapshot: stage.diceInputModeSnapshot,
    physicalRolls: stage.rollRecords.map((record) => record.physicalRoll),
    bindingSnapshotOrNull: stage.bindingRecordOrNull?.bindings ?? null,
  };
}

export function resolveSymbiontStage(
  catalog: SymbiontCatalog,
  stage: RandomSymbiontStage,
): ResolvedRandomSymbiontSequence {
  return resolveRandomSymbiontSequence(catalog, domainRandomSequence(stage));
}

export function pendingSymbiontRequest(
  resolved: ResolvedRandomSymbiontSequence,
  rollRequestId: string,
): SymbiontPendingRollRequest | null {
  const next = resolved.nextRequest;
  switch (next.kind) {
    case 'SPECIES_ORIGIN':
      return {
        rollRequestId,
        kind: next.kind,
        originRollRequestIdOrNull: null,
        advisorAcceptedIndexOrNull: null,
      };
    case 'CRITICAL_CONFIRMATION':
      return {
        rollRequestId,
        kind: next.kind,
        originRollRequestIdOrNull: next.originRollRequestId,
        advisorAcceptedIndexOrNull: null,
      };
    case 'ADVISOR_I':
    case 'ADVISOR_W':
    case 'TROGR_SUPPRESSION_B':
      return {
        rollRequestId,
        kind: next.kind,
        originRollRequestIdOrNull: null,
        advisorAcceptedIndexOrNull: next.advisorAcceptedIndex,
      };
    case 'BINDING':
    case 'COMMITTED':
      return null;
  }
}

export function randomSymbiontStatus(
  resolved: ResolvedRandomSymbiontSequence,
  pending: SymbiontPendingRollRequest | null,
): RandomSymbiontStatus {
  if (resolved.sequence.physicalRolls.length === 0 && pending !== null) return 'PENDING';
  return resolved.randomStatus;
}

export function nextSymbiontEnvelope<
  T extends 'CHR-019' | 'CHR-020' | 'CHR-021' | 'CHR-022' | 'CHR-041',
>(formId: T, characterDraftId: string): CreationNextStageEnvelope<T> {
  return {
    formId,
    routeBindings: [{ parameterIndex: 0, source: 'inherited', value: characterDraftId }],
  };
}

export function incrementedSymbiontRevisions(revisions: RevisionVector): RevisionVector {
  if (
    revisions.stateRevision === Number.MAX_SAFE_INTEGER ||
    revisions.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    return guardSymbiontRejected();
  }
  return {
    actorVisibilityRevision: revisions.actorVisibilityRevision,
    projectionRevision: revisions.projectionRevision + 1,
    stateRevision: revisions.stateRevision + 1,
  };
}

interface ReceiptFacts {
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly receiptId: string;
  readonly revisions: RevisionVector;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
}
function receiptCommon(facts: ReceiptFacts, randomSequenceId: string) {
  const { checkpoint } = facts;
  const branchUuid = checkpoint.statRollStage?.branchUuid;
  if (branchUuid === undefined) return guardSymbiontRejected();
  return {
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    branchUuid,
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    checkpointId: checkpoint.checkpoint.checkpointId,
    checkpointOwnerId: checkpoint.localCharacter.localCharacterId,
    checkpointRevision: facts.checkpointRevision,
    draftRevision: facts.draftRevision,
    randomSequenceId,
    stage: SYMBIONT_STAGE,
  } as const;
}

export function symbiontPhysicalRollJson(roll: RandomSymbiontPhysicalRoll): JsonObject {
  const base: JsonObject = {
    kind: roll.kind,
    rollRequestId: roll.rollRequestId,
    rollReceiptId: roll.rollReceiptId,
    mechanical: { dieSides: 20, rawFace: roll.mechanical.rawFace },
  };
  switch (roll.kind) {
    case 'SPECIES_ORIGIN':
      return base;
    case 'CRITICAL_CONFIRMATION':
      return {
        ...base,
        originRollRequestId: roll.originRollRequestId,
        selectedMonsterSpeciesKeyOrNull: roll.selectedMonsterSpeciesKeyOrNull,
      };
    case 'ADVISOR_I':
    case 'ADVISOR_W':
    case 'TROGR_SUPPRESSION_B':
      return { ...base, advisorAcceptedIndex: roll.advisorAcceptedIndex };
  }
}

export function symbiontBindingsJson(
  bindings: readonly SymbiontSpeciesBinding[],
): readonly JsonObject[] {
  return bindings.map((entry) => ({
    acceptedIndex: entry.acceptedIndex,
    speciesKey: entry.speciesKey,
    binding:
      'side' in entry.binding
        ? { kind: entry.binding.kind, side: entry.binding.side }
        : { kind: entry.binding.kind },
  }));
}

export function symbiontLearnedSkillsJson(
  skills: AdvisorSkillSelectionResult['learnedSkills'],
): readonly JsonObject[] {
  return skills.map((skill) => ({
    skillKey: skill.skillKey,
    bonus: skill.bonus,
    slotCost: skill.slotCost,
  }));
}

export function symbiontPhysicalRollReceipt(
  facts: ReceiptFacts,
  request: SymbiontPhysicalRollCommandRequest,
  physicalRoll: RandomSymbiontPhysicalRoll,
  resolved: ResolvedRandomSymbiontSequence,
  nextPending: SymbiontPendingRollRequest | null,
): SymbiontPhysicalRollReceipt {
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts, request.payload.randomSequenceId),
      sourceFormId: CHR_020_FORM_ID,
      variant: 'ROLL',
      diceInputModeSnapshot: resolved.sequence.diceInputModeSnapshot,
      physicalRoll: symbiontPhysicalRollJson(physicalRoll),
      nextPendingRollRequestIdOrNull: nextPending?.rollRequestId ?? null,
      randomStatus: randomSymbiontStatus(resolved, nextPending),
      advisorBranch: resolved.advisorOrNull !== null,
      randomReceiptIdOrNull:
        resolved.sequence.diceInputModeSnapshot === 'AUTO' ? facts.receiptId : null,
      nextFormId: CHR_020_FORM_ID,
    },
  };
}

export function symbiontBindingReceipt(
  facts: ReceiptFacts,
  request: SymbiontBindingCommandRequest,
  resolved: ResolvedRandomSymbiontSequence,
): SymbiontBindingReceipt {
  if (resolved.randomStatus !== 'COMMITTED') return guardSymbiontRejected();
  const advisorBranch = resolved.advisorOrNull !== null;
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts, request.payload.randomSequenceId),
      sourceFormId: CHR_020_FORM_ID,
      variant: 'BINDING',
      bindings: symbiontBindingsJson(resolved.drawnSpeciesAndBindings),
      randomStatus: 'COMMITTED',
      advisorBranch,
      nextFormId: advisorBranch ? CHR_041_FORM_ID : 'CHR-019',
    },
  };
}

export function symbiontAdvisorCheckpointReceipt(
  facts: ReceiptFacts,
  request: SymbiontAdvisorCheckpointCommandRequest,
  selection: AdvisorSkillSelectionResult,
  effectsActive: boolean,
): SymbiontAdvisorCheckpointReceipt {
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts, request.payload.randomSequenceId),
      sourceFormId: CHR_041_FORM_ID,
      advisorInstanceDraftId: request.payload.advisorInstanceDraftId,
      selectedSkills: request.payload.selectedSkills,
      learnedSkills: symbiontLearnedSkillsJson(selection.learnedSkills),
      requiredSlotCount: selection.capacity,
      usedSlotCount: selection.used,
      effectsActive,
      nextFormId: 'CHR-019',
    },
  };
}

export function randomSymbiontStageIds(stage: RandomSymbiontStage): ReadonlySet<string> {
  const ids = new Set<string>([stage.randomSequenceId]);
  if (stage.pendingRollRequestOrNull !== null)
    ids.add(stage.pendingRollRequestOrNull.rollRequestId);
  if (stage.advisorInstanceDraftIdOrNull !== null) ids.add(stage.advisorInstanceDraftIdOrNull);
  for (const record of stage.rollRecords) {
    ids.add(record.physicalRoll.rollRequestId);
    ids.add(record.physicalRoll.rollReceiptId);
    ids.add(record.request.commandId);
    ids.add(record.receipt.receiptId);
  }
  if (stage.bindingRecordOrNull !== null) {
    ids.add(stage.bindingRecordOrNull.request.commandId);
    ids.add(stage.bindingRecordOrNull.receipt.receiptId);
  }
  if (stage.advisorSkillRecordOrNull !== null) {
    ids.add(stage.advisorSkillRecordOrNull.request.commandId);
    ids.add(stage.advisorSkillRecordOrNull.receipt.receiptId);
  }
  return ids;
}

export function latestSymbiontRecord(
  stage: RandomSymbiontStage,
): SymbiontAdvisorSkillRecord | SymbiontBindingRecord | SymbiontPhysicalRollRecord | null {
  return (
    stage.advisorSkillRecordOrNull ?? stage.bindingRecordOrNull ?? stage.rollRecords.at(-1) ?? null
  );
}

export function sameSymbiontBindings(
  left: readonly SymbiontBindingSelectionInput[],
  right: readonly SymbiontBindingSelection[],
): boolean {
  return isDeepStrictEqual(left, right);
}

export type { CreationRollCommitCommandRequest };
