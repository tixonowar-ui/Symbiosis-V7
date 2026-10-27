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
  calculateTrogrSuppressionBonus,
  deriveAdvisorSuppressionMinimumI,
  resolveAdvisorIwRolls,
  resolveSymbiontComposition,
  validateAdvisorSkillSelection,
  type AdvisorIwResult,
  type SymbiontComposition,
  type SymbiontCatalog,
} from '../domain/index.js';
import type { LocalCharacter, LocalCharacterCheckpoint } from '../persistence/index.js';
import type { SelectedSkillCommandInput } from './creation-skill-selection.js';
import { deriveCreationSkillStageResult } from './creation-stat-assignment.js';
import type {
  CreationNextStageEnvelope,
  DurableCreationWizardCheckpoint,
  RollValidationCursor,
} from './creation-set-decide.js';
import {
  CreationSymbiontApplicationError,
  d20SymbiontFaceAt,
  exactSymbiontObject,
  guardSymbiontRejected,
  nonEmptySymbiontStringAt,
  objectSymbiontAt,
  revisionSymbiontAt,
} from './creation-symbiont-contract.js';
import { nextSymbiontEnvelope } from './creation-symbiont-contract.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';

const SYMBIONT_STAGE = 'SYMBIONTS';
const CHR_041_FORM_ID = 'CHR-041';
const FLOOR_KIND = 'TROGR_SUPPRESSION_B';
export const ADVISOR_INTELLIGENCE_FLOOR_PURPOSE = 'FUTURE_MINIMUM_INTELLIGENCE';

export interface AdvisorIntelligenceFloorPhysicalRoll extends JsonObject {
  readonly kind: typeof FLOOR_KIND;
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly mechanical: { readonly dieSides: 20; readonly rawFace: number };
}

export interface AdvisorIntelligenceFloorRollPayload extends JsonObject {
  readonly stage: typeof SYMBIONT_STAGE;
  readonly sourceFormId: typeof CHR_041_FORM_ID;
  readonly variant: typeof FLOOR_KIND;
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly advisorInstanceDraftId: string;
  readonly compositionDraftRevision: number;
  readonly pendingRollRequestId: string;
  readonly manualFaceOrNull: number | null;
}

export type AdvisorIntelligenceFloorRollCommandRequest = WorkflowCommandRequestMessage<
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  AdvisorIntelligenceFloorRollPayload
>;

export interface AdvisorIntelligenceFloorRollReceiptResult extends JsonObject {
  readonly stage: typeof SYMBIONT_STAGE;
  readonly sourceFormId: typeof CHR_041_FORM_ID;
  readonly variant: typeof FLOOR_KIND;
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly advisorInstanceDraftId: string;
  readonly compositionDraftRevision: number;
  readonly physicalRoll: AdvisorIntelligenceFloorPhysicalRoll;
  readonly rollPurpose: typeof ADVISOR_INTELLIGENCE_FLOOR_PURPOSE;
  readonly suppressionB: number;
  readonly minimumI: number;
  readonly teacherAbsorbed: boolean;
  readonly nextFormId: typeof CHR_041_FORM_ID;
}
export type AdvisorIntelligenceFloorRollReceipt =
  CommandReceipt<AdvisorIntelligenceFloorRollReceiptResult>;

export interface AdvisorIntelligenceFloorSkillRecord {
  readonly receiptId: string;
  readonly selectedSkills: readonly SelectedSkillCommandInput[];
}

export interface AdvisorIntelligenceFloorRollRecord {
  readonly physicalRoll: AdvisorIntelligenceFloorPhysicalRoll;
  readonly request: AdvisorIntelligenceFloorRollCommandRequest;
  readonly receipt: AdvisorIntelligenceFloorRollReceipt;
  readonly nextStageEnvelope: CreationNextStageEnvelope<typeof CHR_041_FORM_ID>;
}

export interface AdvisorIntelligenceFloorStage {
  readonly advisorInstanceDraftId: string;
  readonly composition: SymbiontComposition;
  readonly compositionDraftRevision: number;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly advisorIw: AdvisorIwResult;
  readonly iwRollRequestIds: readonly [string, string];
  readonly iwRollReceiptIds: readonly [string, string];
  readonly advisorSkillRecordOrNull: AdvisorIntelligenceFloorSkillRecord | null;
  readonly pendingRollRequestIdOrNull: string | null;
  readonly rollRecordOrNull: AdvisorIntelligenceFloorRollRecord | null;
}

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

function revisionsAt(value: unknown, path: string): RevisionVector {
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
}

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

export function normalizeAdvisorIntelligenceFloorRollRequest(
  request: DecodedCommandRequest,
): AdvisorIntelligenceFloorRollCommandRequest {
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
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: '$.commandKind',
      value: request.commandKind,
    });
  }
  if (request.workflowCommandId !== 'UI-CMD-CHAR-CREATION-ROLL-COMMIT') {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: '$.workflowCommandId',
      value: request.workflowCommandId,
    });
  }
  if (request.role !== 'player') {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: '$.role',
      value: request.role,
    });
  }
  const payload = exactSymbiontObject(request.payload, '$.payload', [
    'stage',
    'sourceFormId',
    'variant',
    'characterDraftId',
    'wizardCheckpointId',
    'draftRevision',
    'advisorInstanceDraftId',
    'compositionDraftRevision',
    'pendingRollRequestId',
    'manualFaceOrNull',
  ]);
  literal(payload['stage'], SYMBIONT_STAGE, '$.payload.stage');
  literal(payload['sourceFormId'], CHR_041_FORM_ID, '$.payload.sourceFormId');
  literal(payload['variant'], FLOOR_KIND, '$.payload.variant');
  const manualFaceOrNull =
    payload['manualFaceOrNull'] === null
      ? null
      : d20SymbiontFaceAt(payload['manualFaceOrNull'], '$.payload.manualFaceOrNull');
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions: revisionsAt(request.expectedRevisions, '$.expectedRevisions'),
    messageType: 'command.request',
    payload: {
      stage: SYMBIONT_STAGE,
      sourceFormId: CHR_041_FORM_ID,
      variant: FLOOR_KIND,
      characterDraftId: nonEmptySymbiontStringAt(
        payload['characterDraftId'],
        '$.payload.characterDraftId',
      ),
      wizardCheckpointId: nonEmptySymbiontStringAt(
        payload['wizardCheckpointId'],
        '$.payload.wizardCheckpointId',
      ),
      draftRevision: revisionSymbiontAt(payload['draftRevision'], '$.payload.draftRevision'),
      advisorInstanceDraftId: nonEmptySymbiontStringAt(
        payload['advisorInstanceDraftId'],
        '$.payload.advisorInstanceDraftId',
      ),
      compositionDraftRevision: revisionSymbiontAt(
        payload['compositionDraftRevision'],
        '$.payload.compositionDraftRevision',
      ),
      pendingRollRequestId: nonEmptySymbiontStringAt(
        payload['pendingRollRequestId'],
        '$.payload.pendingRollRequestId',
      ),
      manualFaceOrNull,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  };
}

export function advisorSuppressedByTrogr(composition: SymbiontComposition): boolean {
  return composition.instances.some(
    (instance) => instance.speciesKey === 'ADVISER' && instance.status === 'SUPPRESSED',
  );
}

export function advisorTeacherAbsorbed(composition: SymbiontComposition): boolean {
  return composition.instances.some(
    (instance) =>
      instance.speciesKey === 'TROGR' && instance.absorbedSpeciesKeys.includes('TEACHER'),
  );
}

function selectedSkillsAt(value: unknown, path: string): readonly SelectedSkillCommandInput[] {
  if (!Array.isArray(value)) {
    throw new CreationSymbiontApplicationError({
      actualType: value === null ? 'null' : typeof value,
      code: 'INVALID_SHAPE',
      expected: 'array of selected skills',
      path,
    });
  }
  return value.map((selection, index) => {
    const entryPath = `${path}[${String(index)}]`;
    const object = exactSymbiontObject(selection, entryPath, ['skillId', 'targetBonus']);
    return {
      skillId: nonEmptySymbiontStringAt(object['skillId'], `${entryPath}.skillId`),
      targetBonus: revisionSymbiontAt(object['targetBonus'], `${entryPath}.targetBonus`),
    };
  });
}

function rollRecordAt(value: unknown, label: string): AdvisorIntelligenceFloorRollRecord | null {
  if (value === null) return null;
  const object = exactSymbiontObject(value, label, [
    'physicalRoll',
    'request',
    'receipt',
    'nextStageEnvelope',
  ]);
  const physical = exactSymbiontObject(object['physicalRoll'], `${label}.physicalRoll`, [
    'kind',
    'rollRequestId',
    'rollReceiptId',
    'mechanical',
  ]);
  literal(physical['kind'], FLOOR_KIND, `${label}.physicalRoll.kind`);
  const mechanical = exactSymbiontObject(
    physical['mechanical'],
    `${label}.physicalRoll.mechanical`,
    ['dieSides', 'rawFace'],
  );
  literal(mechanical['dieSides'], 20, `${label}.physicalRoll.mechanical.dieSides`);
  const rawFace = revisionSymbiontAt(
    mechanical['rawFace'],
    `${label}.physicalRoll.mechanical.rawFace`,
  );
  if (rawFace < 1 || rawFace > 20) {
    throw new CreationSymbiontApplicationError({
      actualType: 'number',
      code: 'INVALID_SHAPE',
      expected: 'safe integer in 1..20',
      path: `${label}.physicalRoll.mechanical.rawFace`,
    });
  }
  return {
    physicalRoll: {
      kind: FLOOR_KIND,
      rollRequestId: nonEmptySymbiontStringAt(
        physical['rollRequestId'],
        `${label}.physicalRoll.rollRequestId`,
      ),
      rollReceiptId: nonEmptySymbiontStringAt(
        physical['rollReceiptId'],
        `${label}.physicalRoll.rollReceiptId`,
      ),
      mechanical: { dieSides: 20, rawFace },
    },
    request: normalizeAdvisorIntelligenceFloorRollRequest(
      object['request'] as DecodedCommandRequest,
    ),
    receipt: object['receipt'] as AdvisorIntelligenceFloorRollReceipt,
    nextStageEnvelope: object['nextStageEnvelope'] as CreationNextStageEnvelope<
      typeof CHR_041_FORM_ID
    >,
  };
}

export function parseAdvisorIntelligenceFloorRollRecord(
  value: unknown,
  path: string,
): AdvisorIntelligenceFloorRollRecord {
  const record = rollRecordAt(value, path);
  if (record === null) return guardSymbiontRejected();
  return record;
}

export function parseAdvisorIntelligenceFloorStage(
  value: unknown,
  catalog: SymbiontCatalog,
  checkpoint: DurableCreationWizardCheckpoint,
): AdvisorIntelligenceFloorStage {
  const object = exactSymbiontObject(value, '$.advisorIntelligenceFloorStage', [
    'advisorInstanceDraftId',
    'composition',
    'compositionDraftRevision',
    'diceInputModeSnapshot',
    'advisorIw',
    'iwRollRequestIds',
    'iwRollReceiptIds',
    'advisorSkillRecordOrNull',
    'pendingRollRequestIdOrNull',
    'rollRecordOrNull',
  ]);
  const compositionInput = objectSymbiontAt(
    object['composition'],
    '$.advisorIntelligenceFloorStage.composition',
  );
  const composition = resolveSymbiontComposition(catalog, {
    raceCode: compositionInput['raceCode'] as SymbiontComposition['raceCode'],
    acceptedSpecies: compositionInput['acceptedSpecies'] as SymbiontComposition['acceptedSpecies'],
  });
  if (!isDeepStrictEqual(composition, compositionInput)) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  const advisorIwInput = objectSymbiontAt(
    object['advisorIw'],
    '$.advisorIntelligenceFloorStage.advisorIw',
  );
  const advisorI = objectSymbiontAt(
    advisorIwInput['I'],
    '$.advisorIntelligenceFloorStage.advisorIw.I',
  );
  const advisorW = objectSymbiontAt(
    advisorIwInput['W'],
    '$.advisorIntelligenceFloorStage.advisorIw.W',
  );
  const advisorIw = resolveAdvisorIwRolls([
    {
      dieSides: 20,
      rawFace: revisionSymbiontAt(
        advisorI['rawFace'],
        '$.advisorIntelligenceFloorStage.advisorIw.I.rawFace',
      ),
    },
    {
      dieSides: 20,
      rawFace: revisionSymbiontAt(
        advisorW['rawFace'],
        '$.advisorIntelligenceFloorStage.advisorIw.W.rawFace',
      ),
    },
  ]);
  if (!isDeepStrictEqual(advisorIw, advisorIwInput)) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  const iwRollRequestIds = selectedStrings(object['iwRollRequestIds'], 'iwRollRequestIds', 2);
  const iwRollReceiptIds = selectedStrings(object['iwRollReceiptIds'], 'iwRollReceiptIds', 2);
  const skillValue = object['advisorSkillRecordOrNull'];
  let advisorSkillRecordOrNull: AdvisorIntelligenceFloorSkillRecord | null = null;
  if (skillValue !== null) {
    const skill = exactSymbiontObject(
      skillValue,
      '$.advisorIntelligenceFloorStage.advisorSkillRecordOrNull',
      ['receiptId', 'selectedSkills'],
    );
    const selectedSkills = selectedSkillsAt(
      skill['selectedSkills'],
      '$.advisorIntelligenceFloorStage.advisorSkillRecordOrNull.selectedSkills',
    );
    const stats = deriveCreationSkillStageResult(checkpoint, catalog.skillStage).skillStageStats;
    validateAdvisorSkillSelection(catalog.skillStage, {
      advisorIw,
      bodyStats: { S: stats.S, D: stats.D, M: stats.M, Z: stats.Z, C: stats.C },
      selectedSkills: selectedSkills.map((selection) => ({
        skillKey: selection.skillId,
        targetBonus: selection.targetBonus,
      })),
    });
    advisorSkillRecordOrNull = {
      receiptId: nonEmptySymbiontStringAt(
        skill['receiptId'],
        '$.advisorIntelligenceFloorStage.advisorSkillRecordOrNull.receiptId',
      ),
      selectedSkills,
    };
  }
  const diceInputModeSnapshot = nonEmptySymbiontStringAt(
    object['diceInputModeSnapshot'],
    '$.advisorIntelligenceFloorStage.diceInputModeSnapshot',
  );
  if (diceInputModeSnapshot !== 'AUTO' && diceInputModeSnapshot !== 'MANUAL') {
    throw new CreationSymbiontApplicationError({
      code: 'UNRECOGNIZED',
      path: '$.advisorIntelligenceFloorStage.diceInputModeSnapshot',
      value: object['diceInputModeSnapshot'] as JsonValue,
    });
  }
  const pendingValue = object['pendingRollRequestIdOrNull'];
  const pendingRollRequestIdOrNull =
    pendingValue === null
      ? null
      : nonEmptySymbiontStringAt(
          pendingValue,
          '$.advisorIntelligenceFloorStage.pendingRollRequestIdOrNull',
        );
  const rollRecordOrNull = rollRecordAt(
    object['rollRecordOrNull'],
    '$.advisorIntelligenceFloorStage.rollRecordOrNull',
  );
  const hasRollResult = pendingRollRequestIdOrNull !== null || rollRecordOrNull !== null;
  if (
    advisorSuppressedByTrogr(composition) !== hasRollResult ||
    (pendingRollRequestIdOrNull !== null && rollRecordOrNull !== null)
  ) {
    return guardSymbiontRejected();
  }
  const stage: AdvisorIntelligenceFloorStage = {
    advisorInstanceDraftId: nonEmptySymbiontStringAt(
      object['advisorInstanceDraftId'],
      '$.advisorIntelligenceFloorStage.advisorInstanceDraftId',
    ),
    composition,
    compositionDraftRevision: revisionSymbiontAt(
      object['compositionDraftRevision'],
      '$.advisorIntelligenceFloorStage.compositionDraftRevision',
    ),
    diceInputModeSnapshot,
    advisorIw,
    iwRollRequestIds,
    iwRollReceiptIds,
    advisorSkillRecordOrNull,
    pendingRollRequestIdOrNull,
    rollRecordOrNull,
  };
  advisorIntelligenceFloorStageIds(stage);
  return stage;
}

function selectedStrings(value: unknown, path: string, length: number): [string, string] {
  if (!Array.isArray(value) || value.length !== length) {
    throw new CreationSymbiontApplicationError({
      actualType: Array.isArray(value) ? 'array' : typeof value,
      code: 'INVALID_SHAPE',
      expected: `${String(length)} non-empty strings`,
      path: `$.advisorIntelligenceFloorStage.${path}`,
    });
  }
  return value.map((entry, index) =>
    nonEmptySymbiontStringAt(entry, `${path}[${String(index)}]`),
  ) as [string, string];
}

export function advisorIntelligenceFloorStageIds(
  stage: AdvisorIntelligenceFloorStage,
): ReadonlySet<string> {
  const ids = [
    stage.advisorInstanceDraftId,
    ...stage.iwRollRequestIds,
    ...stage.iwRollReceiptIds,
    stage.advisorSkillRecordOrNull?.receiptId,
    stage.pendingRollRequestIdOrNull,
    stage.rollRecordOrNull?.physicalRoll.rollRequestId,
    stage.rollRecordOrNull?.physicalRoll.rollReceiptId,
    stage.rollRecordOrNull?.request.commandId,
  ].filter((value): value is string => typeof value === 'string');
  if (new Set(ids).size !== ids.length) return guardSymbiontRejected();
  return new Set(ids);
}

export function advisorIntelligenceFloorRollReceipt(
  facts: {
    readonly checkpoint: DurableCreationWizardCheckpoint;
    readonly receiptId: string;
    readonly revisions: RevisionVector;
    readonly checkpointRevision: number;
    readonly draftRevision: number;
  },
  request: AdvisorIntelligenceFloorRollCommandRequest,
  physicalRoll: AdvisorIntelligenceFloorPhysicalRoll,
  suppressionB: number,
  minimumI: number,
  teacherAbsorbed: boolean,
): AdvisorIntelligenceFloorRollReceipt {
  const branchUuid = facts.checkpoint.statRollStage?.branchUuid;
  if (branchUuid === undefined) return guardSymbiontRejected();
  return {
    commandId: request.commandId,
    receiptId: facts.receiptId,
    result: {
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      branchUuid,
      characterDraftId: facts.checkpoint.localCharacter.localCharacterId,
      checkpointId: facts.checkpoint.checkpoint.checkpointId,
      checkpointOwnerId: facts.checkpoint.localCharacter.localCharacterId,
      checkpointRevision: facts.checkpointRevision,
      draftRevision: facts.draftRevision,
      stage: SYMBIONT_STAGE,
      sourceFormId: CHR_041_FORM_ID,
      variant: FLOOR_KIND,
      advisorInstanceDraftId: request.payload.advisorInstanceDraftId,
      compositionDraftRevision: request.payload.compositionDraftRevision,
      physicalRoll,
      rollPurpose: ADVISOR_INTELLIGENCE_FLOOR_PURPOSE,
      suppressionB,
      minimumI,
      teacherAbsorbed,
      nextFormId: CHR_041_FORM_ID,
    },
    revisions: facts.revisions,
  };
}

export interface AdvisorIntelligenceFloorValidationContext {
  readonly catalog: SymbiontCatalog;
  readonly localCharacter: LocalCharacter;
  readonly checkpoint: LocalCharacterCheckpoint;
  readonly checkpointView: DurableCreationWizardCheckpoint;
  readonly cursor: RollValidationCursor;
  readonly commandIds: Set<string>;
  readonly receiptIds: Set<string>;
  readonly occupiedIds: Set<string>;
  readonly idsAlreadyOccupied?: boolean;
}

function occupy(context: AdvisorIntelligenceFloorValidationContext, id: string): void {
  if (context.occupiedIds.has(id)) {
    throw new CreationSymbiontApplicationError({ code: 'GUARD_REJECTED' });
  }
  context.occupiedIds.add(id);
}

export function validateAdvisorIntelligenceFloorStageHistory(
  stage: AdvisorIntelligenceFloorStage,
  context: AdvisorIntelligenceFloorValidationContext,
): { readonly cursor: RollValidationCursor } {
  const acquisition = context.checkpointView.raceAndMethodStage;
  if (
    acquisition === null ||
    acquisition.race?.value !== stage.composition.raceCode ||
    acquisition.symbiontAcquisition.value !== 'MANUAL' ||
    acquisition.diceInput?.value !== stage.diceInputModeSnapshot ||
    context.checkpointView.skillSelectionStage === null
  ) {
    return guardSymbiontRejected();
  }
  if (context.idsAlreadyOccupied !== true) {
    for (const id of advisorIntelligenceFloorStageIds(stage)) occupy(context, id);
  }
  const record = stage.rollRecordOrNull;
  let cursor = context.cursor;
  if (cursor.latestReceipt.result.stage === 'SKILLS') {
    if (
      cursor.checkpointRevision === Number.MAX_SAFE_INTEGER ||
      cursor.revisions.stateRevision === Number.MAX_SAFE_INTEGER
    ) {
      return guardSymbiontRejected();
    }
    cursor = {
      ...cursor,
      checkpointRevision: cursor.checkpointRevision + 1,
      revisions: {
        ...cursor.revisions,
        stateRevision: cursor.revisions.stateRevision + 1,
      },
    };
  }
  if (record === null) {
    return {
      cursor: {
        ...cursor,
        latestEnvelope: nextSymbiontEnvelope(
          CHR_041_FORM_ID,
          context.localCharacter.localCharacterId,
        ),
      },
    };
  }
  const request = record.request;
  const physical = record.physicalRoll;
  const expectedProjectionRevision =
    cursor.revisions.projectionRevision + (cursor.latestReceipt.result.stage === 'SKILLS' ? 1 : 0);
  if (
    request.payload.characterDraftId !== context.localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
    request.payload.draftRevision !== cursor.draftRevision ||
    request.payload.advisorInstanceDraftId !== stage.advisorInstanceDraftId ||
    request.payload.compositionDraftRevision !== stage.compositionDraftRevision ||
    request.payload.pendingRollRequestId !== physical.rollRequestId ||
    request.expectedRevisions.actorVisibilityRevision !==
      cursor.revisions.actorVisibilityRevision ||
    request.expectedRevisions.stateRevision !== cursor.revisions.stateRevision ||
    (context.idsAlreadyOccupied === true
      ? request.expectedRevisions.projectionRevision < cursor.revisions.projectionRevision
      : request.expectedRevisions.projectionRevision !== expectedProjectionRevision)
  ) {
    return guardSymbiontRejected();
  }
  if (context.commandIds.has(request.commandId)) return guardSymbiontRejected();
  context.commandIds.add(request.commandId);
  if (context.receiptIds.has(record.receipt.receiptId)) return guardSymbiontRejected();
  context.receiptIds.add(record.receipt.receiptId);
  if (physical.rollReceiptId !== record.receipt.receiptId) return guardSymbiontRejected();
  if (
    stage.diceInputModeSnapshot === 'MANUAL' &&
    request.payload.manualFaceOrNull !== physical.mechanical.rawFace
  ) {
    return guardSymbiontRejected();
  }
  if (stage.diceInputModeSnapshot === 'AUTO' && request.payload.manualFaceOrNull !== null) {
    return guardSymbiontRejected();
  }
  const suppressionB = calculateTrogrSuppressionBonus(physical.mechanical);
  const minimumI = deriveAdvisorSuppressionMinimumI({
    suppressionB,
    teacherAbsorbed: advisorTeacherAbsorbed(stage.composition),
  });
  const revisions = {
    actorVisibilityRevision: request.expectedRevisions.actorVisibilityRevision,
    projectionRevision: request.expectedRevisions.projectionRevision + 1,
    stateRevision: request.expectedRevisions.stateRevision + 1,
  };
  const receipt = advisorIntelligenceFloorRollReceipt(
    {
      checkpoint: context.checkpointView,
      receiptId: record.receipt.receiptId,
      revisions,
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
    },
    request,
    physical,
    suppressionB,
    minimumI,
    advisorTeacherAbsorbed(stage.composition),
  );
  if (!isDeepStrictEqual(record.receipt, receipt)) return guardSymbiontRejected();
  const nextStageEnvelope = nextSymbiontEnvelope(
    CHR_041_FORM_ID,
    context.localCharacter.localCharacterId,
  );
  if (!isDeepStrictEqual(record.nextStageEnvelope, nextStageEnvelope)) {
    return guardSymbiontRejected();
  }
  return {
    cursor: {
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      latestEnvelope: nextStageEnvelope,
      latestReceipt: receipt,
      latestRequest: request,
      revisions,
    },
  };
}
