import { isDeepStrictEqual } from 'node:util';

import type {
  ClientToHostMessage,
  CommandReceipt,
  JsonObject,
  JsonValue,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';

import {
  CORE_169_SPECIES_BY_FACE,
  SYMBIOTIC_MONSTER_SPECIES_KEYS,
  resolveAdvisorIwRolls,
  resolveSymbiontComposition,
  type AdvisorSkillSelectionResult,
  type SymbiontAcceptedSpecies,
  type SymbiontCatalog,
  type SymbiontComposition,
  type SymbiontSide,
  type SymbiontSpeciesBinding,
  type SymbiontSpeciesKey,
} from '../domain/index.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';
import type { SelectedSkillCommandInput } from './creation-skill-selection.js';
import type {
  CreationNextStageEnvelope,
  DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  CreationSymbiontApplicationError,
  d20SymbiontFaceAt,
  exactSymbiontObject,
  nonEmptySymbiontStringAt,
  objectSymbiontAt,
  revisionSymbiontAt,
} from './creation-symbiont-contract.js';
import { nextSymbiontEnvelope } from './creation-symbiont-contract.js';
import type {
  AdvisorIntelligenceFloorRollRecord,
  AdvisorIntelligenceFloorStage,
} from './creation-advisor-intelligence-floor-contract.js';

export type ManualAcceptedSpecies = {
  readonly acceptedIndex: number;
  readonly speciesKey: SymbiontSpeciesKey;
};
export type ManualBindingSelection = {
  readonly speciesKey: 'OWL' | 'EEL';
  readonly side: SymbiontSide;
};

export interface ManualCompositionCheckpointPayload extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly sourceFormId: 'CHR-018';
  readonly variant: 'MANUAL_COMPOSITION';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly compositionDraftRevision: number;
  readonly acceptedSpecies: readonly ManualAcceptedSpecies[];
  readonly selectedBindings: readonly ManualBindingSelection[];
}

export type ManualCompositionCheckpointCommandRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  ManualCompositionCheckpointPayload
>;

export interface ManualAdvisorIwRollPayload extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly sourceFormId: 'CHR-041';
  readonly variant: 'ADVISOR_IW';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly compositionDraftRevision: number;
  readonly advisorInstanceDraftId: string;
  readonly pendingRollRequestIds: readonly [string, string];
  readonly manualFacesOrNull: readonly [number, number] | null;
}

export type ManualAdvisorIwRollCommandRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  ManualAdvisorIwRollPayload
>;

export interface ManualAdvisorSkillCheckpointPayload extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly sourceFormId: 'CHR-041';
  readonly variant: 'MANUAL_ADVISOR_SKILLS';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly compositionDraftRevision: number;
  readonly advisorInstanceDraftId: string;
  readonly selectedSkills: readonly SelectedSkillCommandInput[];
}

export type ManualAdvisorSkillCheckpointCommandRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  ManualAdvisorSkillCheckpointPayload
>;

export interface ManualPhysicalRoll extends JsonObject {
  readonly kind: 'ADVISOR_I' | 'ADVISOR_W' | 'TROGR_SUPPRESSION_B';
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly mechanical: { readonly dieSides: 20; readonly rawFace: number };
}

interface ManualReceiptResultCommon extends JsonObject {
  readonly stage: 'SYMBIONTS';
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
}

export interface ManualCompositionCheckpointReceiptResult extends ManualReceiptResultCommon {
  readonly sourceFormId: 'CHR-018';
  readonly variant: 'MANUAL_COMPOSITION';
  readonly compositionDraftRevision: number;
  readonly acceptedSpecies: readonly ManualAcceptedSpecies[];
  readonly bindings: readonly JsonObject[];
  readonly advisorBranch: boolean;
  readonly nextFormId: 'CHR-019' | 'CHR-041';
}
export type ManualCompositionCheckpointReceipt =
  CommandReceipt<ManualCompositionCheckpointReceiptResult>;

export interface ManualAdvisorIwRollReceiptResult extends ManualReceiptResultCommon {
  readonly sourceFormId: 'CHR-041';
  readonly variant: 'ADVISOR_IW';
  readonly advisorInstanceDraftId: string;
  readonly compositionDraftRevision: number;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly physicalRolls: readonly [ManualPhysicalRoll, ManualPhysicalRoll];
  readonly advisorIw: {
    readonly I: { readonly rawFace: number; readonly value: number };
    readonly W: { readonly rawFace: number; readonly value: number };
  };
  readonly nextFormId: 'CHR-041';
}
export type ManualAdvisorIwRollReceipt = CommandReceipt<ManualAdvisorIwRollReceiptResult>;

export interface ManualAdvisorSkillCheckpointReceiptResult extends ManualReceiptResultCommon {
  readonly sourceFormId: 'CHR-041';
  readonly variant: 'MANUAL_ADVISOR_SKILLS';
  readonly advisorInstanceDraftId: string;
  readonly compositionDraftRevision: number;
  readonly selectedSkills: readonly SelectedSkillCommandInput[];
  readonly learnedSkills: readonly JsonObject[];
  readonly requiredSlotCount: number;
  readonly usedSlotCount: number;
  readonly effectsActive: boolean;
  readonly nextFormId: 'CHR-019';
}
export type ManualAdvisorSkillCheckpointReceipt =
  CommandReceipt<ManualAdvisorSkillCheckpointReceiptResult>;

export interface ManualCompositionRecord {
  readonly acceptedSpecies: readonly SymbiontAcceptedSpecies[];
  readonly bindings: readonly SymbiontSpeciesBinding[];
  readonly request: ManualCompositionCheckpointCommandRequest;
  readonly receipt: ManualCompositionCheckpointReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-019' | 'CHR-041'>;
}

export interface ManualAdvisorIwRecord {
  readonly physicalRolls: readonly [ManualPhysicalRoll, ManualPhysicalRoll];
  readonly request: ManualAdvisorIwRollCommandRequest;
  readonly receipt: ManualAdvisorIwRollReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-041'>;
}

export interface ManualAdvisorSkillRecord {
  readonly selectedSkills: readonly SelectedSkillCommandInput[];
  readonly learnedSkills: AdvisorSkillSelectionResult['learnedSkills'];
  readonly advisorStats: AdvisorSkillSelectionResult['advisorStats'];
  readonly request: ManualAdvisorSkillCheckpointCommandRequest;
  readonly receipt: ManualAdvisorSkillCheckpointReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<'CHR-019'>;
}

export interface ManualCompositionStage {
  readonly composition: SymbiontComposition;
  readonly compositionDraftRevision: number;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly compositionRecords: readonly ManualCompositionRecord[];
  readonly advisorInstanceDraftIdOrNull: string | null;
  readonly iwRollRequestIdsOrNull: readonly [string, string] | null;
  readonly advisorIwRecordOrNull: ManualAdvisorIwRecord | null;
  readonly pendingSuppressionRollRequestIdOrNull: string | null;
  readonly suppressionRollRecordOrNull: AdvisorIntelligenceFloorRollRecord | null;
  readonly advisorSkillRecordOrNull: ManualAdvisorSkillRecord | null;
}

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

function literal<T extends JsonValue>(value: unknown, expected: T, path: string): T {
  if (!isDeepStrictEqual(value, expected)) {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path,
      value: value as JsonValue,
    });
  }
  return expected;
}

function invalidShape(path: string, expected: string, value: unknown): never {
  throw new CreationSymbiontApplicationError({
    actualType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    code: 'INVALID_SHAPE',
    expected,
    path,
  });
}

function speciesKeyAt(value: unknown, path: string): SymbiontSpeciesKey {
  const input = nonEmptySymbiontStringAt(value, path);
  const speciesKey = [...CORE_169_SPECIES_BY_FACE, ...SYMBIOTIC_MONSTER_SPECIES_KEYS].find(
    (candidate) => candidate === input,
  );
  if (speciesKey === undefined) {
    throw new CreationSymbiontApplicationError({ code: 'UNRECOGNIZED', path, value: input });
  }
  return speciesKey;
}

function envelopeAt(request: DecodedCommandRequest): Record<string, unknown> {
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
  literal(envelope['role'], 'player', '$.role');
  nonEmptySymbiontStringAt(envelope['commandId'], '$.commandId');
  if (request.commandKind !== 'workflow-command') {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: '$.commandKind',
      value: request.commandKind,
    });
  }
  return envelope;
}

function commonPayloadAt(
  payload: Record<string, unknown>,
  fields: readonly string[],
): {
  characterDraftId: string;
  wizardCheckpointId: string;
  draftRevision: number;
  compositionDraftRevision: number;
} {
  exactSymbiontObject(payload, '$.payload', [
    'characterDraftId',
    'compositionDraftRevision',
    'draftRevision',
    'sourceFormId',
    'stage',
    'variant',
    'wizardCheckpointId',
    ...fields,
  ]);
  return {
    characterDraftId: nonEmptySymbiontStringAt(
      payload['characterDraftId'],
      '$.payload.characterDraftId',
    ),
    wizardCheckpointId: nonEmptySymbiontStringAt(
      payload['wizardCheckpointId'],
      '$.payload.wizardCheckpointId',
    ),
    draftRevision: revisionSymbiontAt(payload['draftRevision'], '$.payload.draftRevision'),
    compositionDraftRevision: revisionSymbiontAt(
      payload['compositionDraftRevision'],
      '$.payload.compositionDraftRevision',
    ),
  };
}

export function normalizeManualCompositionCheckpointRequest(
  request: DecodedCommandRequest,
): ManualCompositionCheckpointCommandRequest {
  const envelope = envelopeAt(request);
  literal(envelope['workflowCommandId'], 'UI-CMD-CHAR-WIZARD-CHECKPOINT', '$.workflowCommandId');
  const payload = objectSymbiontAt(envelope['payload'], '$.payload');
  const common = commonPayloadAt(payload, ['acceptedSpecies', 'selectedBindings']);
  literal(payload['stage'], 'SYMBIONTS', '$.payload.stage');
  literal(payload['sourceFormId'], 'CHR-018', '$.payload.sourceFormId');
  literal(payload['variant'], 'MANUAL_COMPOSITION', '$.payload.variant');
  const acceptedSpecies = acceptedAt(payload['acceptedSpecies'], '$.payload.acceptedSpecies').map(
    (accepted, index) => {
      if (accepted.acceptedIndex !== index) {
        throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
      }
      return accepted;
    },
  );
  const bindingsInput = payload['selectedBindings'];
  if (!Array.isArray(bindingsInput)) {
    invalidShape('$.payload.selectedBindings', 'array', bindingsInput);
  }
  const selectedBindings = bindingsInput.map((entry, index): ManualBindingSelection => {
    const item = exactSymbiontObject(entry, `$.payload.selectedBindings[${String(index)}]`, [
      'speciesKey',
      'side',
    ]);
    const speciesKey = nonEmptySymbiontStringAt(
      item['speciesKey'],
      `$.payload.selectedBindings[${String(index)}].speciesKey`,
    );
    if (speciesKey !== 'OWL' && speciesKey !== 'EEL') {
      throw new CreationSymbiontApplicationError({
        code: 'UNRECOGNIZED',
        path: `$.payload.selectedBindings[${String(index)}].speciesKey`,
        value: speciesKey,
      });
    }
    const side = nonEmptySymbiontStringAt(
      item['side'],
      `$.payload.selectedBindings[${String(index)}].side`,
    );
    if (side !== 'LEFT' && side !== 'RIGHT') {
      throw new CreationSymbiontApplicationError({
        code: 'UNRECOGNIZED',
        path: `$.payload.selectedBindings[${String(index)}].side`,
        value: side,
      });
    }
    return { speciesKey, side };
  });
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions: request.expectedRevisions,
    messageType: 'command.request',
    payload: {
      ...common,
      acceptedSpecies,
      selectedBindings,
      sourceFormId: 'CHR-018',
      stage: 'SYMBIONTS',
      variant: 'MANUAL_COMPOSITION',
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  };
}

export function normalizeManualAdvisorIwRollRequest(
  request: DecodedCommandRequest,
): ManualAdvisorIwRollCommandRequest {
  const envelope = envelopeAt(request);
  literal(envelope['workflowCommandId'], 'UI-CMD-CHAR-CREATION-ROLL-COMMIT', '$.workflowCommandId');
  const payload = objectSymbiontAt(envelope['payload'], '$.payload');
  const common = commonPayloadAt(payload, [
    'advisorInstanceDraftId',
    'manualFacesOrNull',
    'pendingRollRequestIds',
  ]);
  literal(payload['stage'], 'SYMBIONTS', '$.payload.stage');
  literal(payload['sourceFormId'], 'CHR-041', '$.payload.sourceFormId');
  literal(payload['variant'], 'ADVISOR_IW', '$.payload.variant');
  const advisorInstanceDraftId = nonEmptySymbiontStringAt(
    payload['advisorInstanceDraftId'],
    '$.payload.advisorInstanceDraftId',
  );
  const rawIds = payload['pendingRollRequestIds'];
  if (!Array.isArray(rawIds) || rawIds.length !== 2) {
    invalidShape('$.payload.pendingRollRequestIds', 'exactly two IDs', rawIds);
  }
  const pendingRollRequestIds = rawIds.map((id, index) =>
    nonEmptySymbiontStringAt(id, `$.payload.pendingRollRequestIds[${String(index)}]`),
  ) as [string, string];
  if (new Set(pendingRollRequestIds).size !== 2) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  const rawFaces = payload['manualFacesOrNull'];
  if (rawFaces !== null && (!Array.isArray(rawFaces) || rawFaces.length !== 2)) {
    invalidShape('$.payload.manualFacesOrNull', 'null or exactly two D20 faces', rawFaces);
  }
  const manualFacesOrNull =
    rawFaces === null
      ? null
      : (rawFaces.map((face, index) =>
          d20SymbiontFaceAt(face, `$.payload.manualFacesOrNull[${String(index)}]`),
        ) as [number, number]);
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions: request.expectedRevisions,
    messageType: 'command.request',
    payload: {
      ...common,
      advisorInstanceDraftId,
      pendingRollRequestIds,
      manualFacesOrNull,
      sourceFormId: 'CHR-041',
      stage: 'SYMBIONTS',
      variant: 'ADVISOR_IW',
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  };
}

export function normalizeManualAdvisorSkillCheckpointRequest(
  request: DecodedCommandRequest,
): ManualAdvisorSkillCheckpointCommandRequest {
  const envelope = envelopeAt(request);
  literal(envelope['workflowCommandId'], 'UI-CMD-CHAR-WIZARD-CHECKPOINT', '$.workflowCommandId');
  const payload = objectSymbiontAt(envelope['payload'], '$.payload');
  const common = commonPayloadAt(payload, ['advisorInstanceDraftId', 'selectedSkills']);
  literal(payload['stage'], 'SYMBIONTS', '$.payload.stage');
  literal(payload['sourceFormId'], 'CHR-041', '$.payload.sourceFormId');
  literal(payload['variant'], 'MANUAL_ADVISOR_SKILLS', '$.payload.variant');
  const advisorInstanceDraftId = nonEmptySymbiontStringAt(
    payload['advisorInstanceDraftId'],
    '$.payload.advisorInstanceDraftId',
  );
  const rawSkills = payload['selectedSkills'];
  if (!Array.isArray(rawSkills)) {
    invalidShape('$.payload.selectedSkills', 'array', rawSkills);
  }
  const selectedSkills = rawSkills.map((entry, index) => {
    const item = exactSymbiontObject(entry, `$.payload.selectedSkills[${String(index)}]`, [
      'skillId',
      'targetBonus',
    ]);
    return {
      skillId: nonEmptySymbiontStringAt(
        item['skillId'],
        `$.payload.selectedSkills[${String(index)}].skillId`,
      ),
      targetBonus: revisionSymbiontAt(
        item['targetBonus'],
        `$.payload.selectedSkills[${String(index)}].targetBonus`,
      ),
    };
  });
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions: request.expectedRevisions,
    messageType: 'command.request',
    payload: {
      ...common,
      advisorInstanceDraftId,
      selectedSkills,
      sourceFormId: 'CHR-041',
      stage: 'SYMBIONTS',
      variant: 'MANUAL_ADVISOR_SKILLS',
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  };
}

interface ReceiptFacts {
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly receiptId: string;
  readonly revisions: RevisionVector;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly compositionDraftRevision: number;
}

function receiptCommon(facts: ReceiptFacts) {
  const branchUuid = facts.checkpoint.statRollStage?.branchUuid;
  if (branchUuid === undefined) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return {
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    branchUuid,
    characterDraftId: facts.checkpoint.localCharacter.localCharacterId,
    checkpointId: facts.checkpoint.checkpoint.checkpointId,
    checkpointOwnerId: facts.checkpoint.localCharacter.localCharacterId,
    checkpointRevision: facts.checkpointRevision,
    draftRevision: facts.draftRevision,
    stage: 'SYMBIONTS' as const,
  };
}

export function manualCompositionCheckpointReceipt(
  facts: ReceiptFacts,
  request: ManualCompositionCheckpointCommandRequest,
  composition: SymbiontComposition,
  bindings: readonly SymbiontSpeciesBinding[],
): ManualCompositionCheckpointReceipt {
  const advisorBranch = composition.acceptedSpecies.some(
    (accepted) => accepted.speciesKey === 'ADVISER',
  );
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts),
      sourceFormId: 'CHR-018',
      variant: 'MANUAL_COMPOSITION',
      compositionDraftRevision: facts.compositionDraftRevision,
      acceptedSpecies: composition.acceptedSpecies.map((accepted) => ({
        acceptedIndex: accepted.acceptedIndex,
        speciesKey: accepted.speciesKey,
      })),
      bindings: bindings.map((entry) => ({
        acceptedIndex: entry.acceptedIndex,
        speciesKey: entry.speciesKey,
        binding:
          'side' in entry.binding
            ? { kind: entry.binding.kind, side: entry.binding.side }
            : { kind: entry.binding.kind },
      })),
      advisorBranch,
      nextFormId: advisorBranch ? 'CHR-041' : 'CHR-019',
    },
  };
}

export function manualAdvisorIwRollReceipt(
  facts: ReceiptFacts & { readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL' },
  request: ManualAdvisorIwRollCommandRequest,
  physicalRolls: readonly [ManualPhysicalRoll, ManualPhysicalRoll],
): ManualAdvisorIwRollReceipt {
  const advisorIw = resolveAdvisorIwRolls([
    physicalRolls[0].mechanical,
    physicalRolls[1].mechanical,
  ]);
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts),
      sourceFormId: 'CHR-041',
      variant: 'ADVISOR_IW',
      advisorInstanceDraftId: request.payload.advisorInstanceDraftId,
      compositionDraftRevision: facts.compositionDraftRevision,
      diceInputModeSnapshot: facts.diceInputModeSnapshot,
      physicalRolls,
      advisorIw: {
        I: { rawFace: advisorIw.I.rawFace, value: advisorIw.I.value },
        W: { rawFace: advisorIw.W.rawFace, value: advisorIw.W.value },
      },
      nextFormId: 'CHR-041',
    },
  };
}

export function manualAdvisorSkillCheckpointReceipt(
  facts: ReceiptFacts,
  request: ManualAdvisorSkillCheckpointCommandRequest,
  selection: AdvisorSkillSelectionResult,
  effectsActive: boolean,
): ManualAdvisorSkillCheckpointReceipt {
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    revisions: facts.revisions,
    result: {
      ...receiptCommon(facts),
      sourceFormId: 'CHR-041',
      variant: 'MANUAL_ADVISOR_SKILLS',
      advisorInstanceDraftId: request.payload.advisorInstanceDraftId,
      compositionDraftRevision: facts.compositionDraftRevision,
      selectedSkills: request.payload.selectedSkills,
      learnedSkills: selection.learnedSkills.map((skill) => ({
        skillKey: skill.skillKey,
        bonus: skill.bonus,
        slotCost: skill.slotCost,
      })),
      requiredSlotCount: selection.capacity,
      usedSlotCount: selection.used,
      effectsActive,
      nextFormId: 'CHR-019',
    },
  };
}

function acceptedAt(value: unknown, path: string): readonly ManualAcceptedSpecies[] {
  if (!Array.isArray(value)) invalidShape(path, 'array', value);
  return value.map((entry, index) => {
    const item = exactSymbiontObject(entry, `${path}[${String(index)}]`, [
      'acceptedIndex',
      'speciesKey',
    ]);
    return {
      acceptedIndex: revisionSymbiontAt(
        item['acceptedIndex'],
        `${path}[${String(index)}].acceptedIndex`,
      ),
      speciesKey: speciesKeyAt(item['speciesKey'], `${path}[${String(index)}].speciesKey`),
    };
  });
}

function bindingsAt(value: unknown, path: string): readonly SymbiontSpeciesBinding[] {
  if (!Array.isArray(value)) invalidShape(path, 'array', value);
  return value.map((entry, index) => {
    const item = exactSymbiontObject(entry, `${path}[${String(index)}]`, [
      'acceptedIndex',
      'binding',
      'speciesKey',
    ]);
    const binding = objectSymbiontAt(item['binding'], `${path}[${String(index)}].binding`);
    const kind = nonEmptySymbiontStringAt(
      binding['kind'],
      `${path}[${String(index)}].binding.kind`,
    );
    const acceptedIndex = revisionSymbiontAt(
      item['acceptedIndex'],
      `${path}[${String(index)}].acceptedIndex`,
    );
    const speciesKey = speciesKeyAt(item['speciesKey'], `${path}[${String(index)}].speciesKey`);
    if (kind === 'OWL_EYE' || kind === 'EEL_ARM') {
      exactSymbiontObject(binding, `${path}[${String(index)}].binding`, ['kind', 'side']);
      const side = nonEmptySymbiontStringAt(
        binding['side'],
        `${path}[${String(index)}].binding.side`,
      );
      if (side !== 'LEFT' && side !== 'RIGHT') {
        throw new CreationSymbiontApplicationError({
          code: 'UNRECOGNIZED',
          path: `${path}[${String(index)}].binding.side`,
          value: side,
        });
      }
      return { acceptedIndex, speciesKey, binding: { kind, side } };
    }
    exactSymbiontObject(binding, `${path}[${String(index)}].binding`, ['kind']);
    if (
      kind !== 'NONE' &&
      kind !== 'TICK_RIGHT_HAND' &&
      kind !== 'SPIDER_BOTH_WRISTS' &&
      kind !== 'MANTIS_BOTH_FOREARMS'
    ) {
      throw new CreationSymbiontApplicationError({
        code: 'UNRECOGNIZED',
        path: `${path}[${String(index)}].binding.kind`,
        value: kind,
      });
    }
    return { acceptedIndex, speciesKey, binding: { kind } };
  });
}

function compositionRecordAt(value: unknown, path: string): ManualCompositionRecord {
  const object = exactSymbiontObject(value, path, [
    'acceptedSpecies',
    'bindings',
    'nextStageEnvelope',
    'receipt',
    'request',
  ]);
  const acceptedSpecies = acceptedAt(object['acceptedSpecies'], `${path}.acceptedSpecies`);
  const bindings = bindingsAt(object['bindings'], `${path}.bindings`);
  const request = normalizeManualCompositionCheckpointRequest(
    object['request'] as DecodedCommandRequest,
  );
  const receipt = object['receipt'] as ManualCompositionCheckpointReceipt;
  const nextStageEnvelope = object['nextStageEnvelope'] as CreationNextStageEnvelope<
    'CHR-019' | 'CHR-041'
  >;
  const nextFormId = receipt.result.nextFormId;
  if (
    nextFormId !== nextStageEnvelope.formId ||
    !isDeepStrictEqual(
      nextStageEnvelope,
      nextSymbiontEnvelope(nextFormId, receipt.result.characterDraftId),
    )
  ) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return { acceptedSpecies, bindings, request, receipt, nextStageEnvelope };
}

function advisorIwRecordAt(value: unknown, path: string): ManualAdvisorIwRecord {
  const object = exactSymbiontObject(value, path, [
    'nextStageEnvelope',
    'physicalRolls',
    'receipt',
    'request',
  ]);
  const request = normalizeManualAdvisorIwRollRequest(object['request'] as DecodedCommandRequest);
  const rawRolls = object['physicalRolls'];
  if (!Array.isArray(rawRolls) || rawRolls.length !== 2) {
    invalidShape(`${path}.physicalRolls`, 'exactly two physical rolls', rawRolls);
  }
  const physicalRolls = rawRolls.map((entry, index) => {
    const roll = exactSymbiontObject(entry, `${path}.physicalRolls[${String(index)}]`, [
      'kind',
      'mechanical',
      'rollReceiptId',
      'rollRequestId',
    ]);
    const kind = nonEmptySymbiontStringAt(
      roll['kind'],
      `${path}.physicalRolls[${String(index)}].kind`,
    );
    if (kind !== 'ADVISOR_I' && kind !== 'ADVISOR_W') {
      throw new CreationSymbiontApplicationError({
        code: 'UNRECOGNIZED',
        path: `${path}.physicalRolls[${String(index)}].kind`,
        value: kind,
      });
    }
    const mechanical = exactSymbiontObject(
      roll['mechanical'],
      `${path}.physicalRolls[${String(index)}].mechanical`,
      ['dieSides', 'rawFace'],
    );
    return {
      kind,
      rollRequestId: nonEmptySymbiontStringAt(
        roll['rollRequestId'],
        `${path}.physicalRolls[${String(index)}].rollRequestId`,
      ),
      rollReceiptId: nonEmptySymbiontStringAt(
        roll['rollReceiptId'],
        `${path}.physicalRolls[${String(index)}].rollReceiptId`,
      ),
      mechanical: {
        dieSides: literal(
          mechanical['dieSides'],
          20,
          `${path}.physicalRolls[${String(index)}].mechanical.dieSides`,
        ),
        rawFace: d20SymbiontFaceAt(
          mechanical['rawFace'],
          `${path}.physicalRolls[${String(index)}].mechanical.rawFace`,
        ),
      },
    };
  }) as [ManualPhysicalRoll, ManualPhysicalRoll];
  const receipt = object['receipt'] as ManualAdvisorIwRollReceipt;
  const nextStageEnvelope = object['nextStageEnvelope'] as CreationNextStageEnvelope<'CHR-041'>;
  if (
    !isDeepStrictEqual(
      nextStageEnvelope,
      nextSymbiontEnvelope('CHR-041', receipt.result.characterDraftId),
    )
  ) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return { physicalRolls, request, receipt, nextStageEnvelope };
}

function advisorSkillRecordAt(value: unknown, path: string): ManualAdvisorSkillRecord {
  const object = exactSymbiontObject(value, path, [
    'advisorStats',
    'learnedSkills',
    'nextStageEnvelope',
    'receipt',
    'request',
    'selectedSkills',
  ]);
  const request = normalizeManualAdvisorSkillCheckpointRequest(
    object['request'] as DecodedCommandRequest,
  );
  const receipt = object['receipt'] as ManualAdvisorSkillCheckpointReceipt;
  const nextStageEnvelope = object['nextStageEnvelope'] as CreationNextStageEnvelope<'CHR-019'>;
  if (
    !isDeepStrictEqual(
      nextStageEnvelope,
      nextSymbiontEnvelope('CHR-019', receipt.result.characterDraftId),
    )
  ) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return {
    advisorStats: object['advisorStats'] as AdvisorSkillSelectionResult['advisorStats'],
    learnedSkills: object['learnedSkills'] as AdvisorSkillSelectionResult['learnedSkills'],
    selectedSkills: request.payload.selectedSkills,
    request,
    receipt,
    nextStageEnvelope,
  };
}

export function parseManualCompositionStage(
  value: unknown,
  catalog: SymbiontCatalog,
): ManualCompositionStage {
  const object = exactSymbiontObject(value, '$.manualCompositionStage', [
    'advisorInstanceDraftIdOrNull',
    'advisorIwRecordOrNull',
    'advisorSkillRecordOrNull',
    'composition',
    'compositionDraftRevision',
    'compositionRecords',
    'diceInputModeSnapshot',
    'iwRollRequestIdsOrNull',
    'pendingSuppressionRollRequestIdOrNull',
    'suppressionRollRecordOrNull',
  ]);
  const compositionInput = objectSymbiontAt(
    object['composition'],
    '$.manualCompositionStage.composition',
  );
  const composition = resolveSymbiontComposition(catalog, {
    raceCode: compositionInput['raceCode'] as SymbiontComposition['raceCode'],
    acceptedSpecies: compositionInput['acceptedSpecies'] as SymbiontComposition['acceptedSpecies'],
  });
  if (!isDeepStrictEqual(composition, compositionInput)) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  const diceInputModeSnapshot = nonEmptySymbiontStringAt(
    object['diceInputModeSnapshot'],
    '$.manualCompositionStage.diceInputModeSnapshot',
  );
  if (diceInputModeSnapshot !== 'AUTO' && diceInputModeSnapshot !== 'MANUAL') {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: '$.manualCompositionStage.diceInputModeSnapshot',
      value: diceInputModeSnapshot,
    });
  }
  if (!Array.isArray(object['compositionRecords'])) {
    invalidShape(
      '$.manualCompositionStage.compositionRecords',
      'array',
      object['compositionRecords'],
    );
  }
  const compositionRecords = object['compositionRecords'].map((entry, index) =>
    compositionRecordAt(entry, `$.manualCompositionStage.compositionRecords[${String(index)}]`),
  );
  const advisorInstanceDraftIdOrNull =
    object['advisorInstanceDraftIdOrNull'] === null
      ? null
      : nonEmptySymbiontStringAt(
          object['advisorInstanceDraftIdOrNull'],
          '$.manualCompositionStage.advisorInstanceDraftIdOrNull',
        );
  const iwRollRequestIdsOrNull =
    object['iwRollRequestIdsOrNull'] === null
      ? null
      : (() => {
          const raw = object['iwRollRequestIdsOrNull'];
          if (!Array.isArray(raw) || raw.length !== 2) {
            invalidShape(
              '$.manualCompositionStage.iwRollRequestIdsOrNull',
              'null or exactly two IDs',
              raw,
            );
          }
          return raw.map((id, index) =>
            nonEmptySymbiontStringAt(
              id,
              `$.manualCompositionStage.iwRollRequestIdsOrNull[${String(index)}]`,
            ),
          ) as [string, string];
        })();
  const advisorIwRecordOrNull =
    object['advisorIwRecordOrNull'] === null
      ? null
      : advisorIwRecordAt(
          object['advisorIwRecordOrNull'],
          '$.manualCompositionStage.advisorIwRecordOrNull',
        );
  const pendingSuppressionRollRequestIdOrNull =
    object['pendingSuppressionRollRequestIdOrNull'] === null
      ? null
      : nonEmptySymbiontStringAt(
          object['pendingSuppressionRollRequestIdOrNull'],
          '$.manualCompositionStage.pendingSuppressionRollRequestIdOrNull',
        );
  const suppressionRollRecordOrNull =
    object['suppressionRollRecordOrNull'] === null
      ? null
      : (object['suppressionRollRecordOrNull'] as AdvisorIntelligenceFloorRollRecord);
  const advisorSkillRecordOrNull =
    object['advisorSkillRecordOrNull'] === null
      ? null
      : advisorSkillRecordAt(
          object['advisorSkillRecordOrNull'],
          '$.manualCompositionStage.advisorSkillRecordOrNull',
        );
  const stage: ManualCompositionStage = {
    composition,
    compositionDraftRevision: revisionSymbiontAt(
      object['compositionDraftRevision'],
      '$.manualCompositionStage.compositionDraftRevision',
    ),
    diceInputModeSnapshot,
    compositionRecords,
    advisorInstanceDraftIdOrNull,
    iwRollRequestIdsOrNull,
    advisorIwRecordOrNull,
    pendingSuppressionRollRequestIdOrNull,
    suppressionRollRecordOrNull,
    advisorSkillRecordOrNull,
  };
  manualCompositionStageIds(stage);
  return stage;
}

export function latestManualCompositionRecord(
  stage: ManualCompositionStage,
):
  | ManualCompositionRecord
  | ManualAdvisorIwRecord
  | AdvisorIntelligenceFloorRollRecord
  | ManualAdvisorSkillRecord
  | null {
  const candidates = [
    ...stage.compositionRecords,
    ...(stage.advisorIwRecordOrNull === null ? [] : [stage.advisorIwRecordOrNull]),
    ...(stage.suppressionRollRecordOrNull === null ? [] : [stage.suppressionRollRecordOrNull]),
    ...(stage.advisorSkillRecordOrNull === null ? [] : [stage.advisorSkillRecordOrNull]),
  ];
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, candidate) =>
    candidate.receipt.result.draftRevision > latest.receipt.result.draftRevision
      ? candidate
      : latest,
  );
}

export function manualCompositionStageIds(stage: ManualCompositionStage): ReadonlySet<string> {
  const ids: string[] = [];
  for (const record of stage.compositionRecords)
    ids.push(record.request.commandId, record.receipt.receiptId);
  if (stage.advisorInstanceDraftIdOrNull !== null) ids.push(stage.advisorInstanceDraftIdOrNull);
  if (stage.iwRollRequestIdsOrNull !== null) ids.push(...stage.iwRollRequestIdsOrNull);
  if (stage.advisorIwRecordOrNull !== null) {
    ids.push(stage.advisorIwRecordOrNull.request.commandId);
    for (const roll of stage.advisorIwRecordOrNull.physicalRolls)
      ids.push(roll.rollRequestId, roll.rollReceiptId);
  }
  if (stage.pendingSuppressionRollRequestIdOrNull !== null)
    ids.push(stage.pendingSuppressionRollRequestIdOrNull);
  if (stage.suppressionRollRecordOrNull !== null) {
    ids.push(
      stage.suppressionRollRecordOrNull.physicalRoll.rollRequestId,
      stage.suppressionRollRecordOrNull.physicalRoll.rollReceiptId,
      stage.suppressionRollRecordOrNull.request.commandId,
    );
  }
  if (stage.advisorSkillRecordOrNull !== null)
    ids.push(
      stage.advisorSkillRecordOrNull.request.commandId,
      stage.advisorSkillRecordOrNull.receipt.receiptId,
    );
  if (new Set(ids).size !== ids.length) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  return new Set(ids);
}

export function advisorIntelligenceFloorStageFromCheckpoint(
  checkpoint: DurableCreationWizardCheckpoint,
  compositionAtRoll?: SymbiontComposition,
): AdvisorIntelligenceFloorStage | null {
  if (
    checkpoint.advisorIntelligenceFloorStage !== null &&
    checkpoint.advisorIntelligenceFloorStage !== undefined
  ) {
    return checkpoint.advisorIntelligenceFloorStage;
  }
  const stage = checkpoint.manualCompositionStage;
  const record = stage?.advisorIwRecordOrNull;
  if (stage === null || stage === undefined || record === null || record === undefined) return null;
  return {
    advisorInstanceDraftId: stage.advisorInstanceDraftIdOrNull!,
    composition: compositionAtRoll ?? stage.composition,
    compositionDraftRevision: stage.compositionDraftRevision,
    diceInputModeSnapshot: stage.diceInputModeSnapshot,
    advisorIw: record.receipt.result.advisorIw,
    iwRollRequestIds: stage.iwRollRequestIdsOrNull!,
    iwRollReceiptIds: [
      record.physicalRolls[0].rollReceiptId,
      record.physicalRolls[1].rollReceiptId,
    ],
    advisorSkillRecordOrNull:
      stage.advisorSkillRecordOrNull === null
        ? null
        : {
            receiptId: stage.advisorSkillRecordOrNull!.receipt.receiptId,
            selectedSkills: stage.advisorSkillRecordOrNull!.selectedSkills,
          },
    pendingRollRequestIdOrNull: stage.pendingSuppressionRollRequestIdOrNull,
    rollRecordOrNull: stage.suppressionRollRecordOrNull,
  };
}
