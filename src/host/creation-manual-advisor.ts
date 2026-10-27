import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import {
  validateAdvisorSkillSelection,
  type AdvisorSkillSelectionResult,
  type SymbiontCatalog,
  type SymbiontComposition,
} from '../domain/index.js';
import { commitLocalCharacterCheckpoint } from '../persistence/index.js';
import {
  creationWizardDurableIds,
  currentCreationWizardRevisions,
  loadCreationWizardCheckpoint,
  validateDurableCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  assertCommonSymbiont,
  assertNoPreviousSymbiontCommand,
  sampledSymbiontFace,
  type CreationSymbiontRollDependencies,
} from './creation-symbiont-commands.js';
import {
  guardSymbiontRejected,
  incrementedSymbiontRevisions,
  nextSymbiontEnvelope,
} from './creation-symbiont-contract.js';
import { advisorSuppressedByTrogr } from './creation-advisor-intelligence-floor-contract.js';
import { deriveCreationSkillStageResult } from './creation-stat-assignment.js';
import {
  manualAdvisorIwRollReceipt,
  manualAdvisorSkillCheckpointReceipt,
  normalizeManualAdvisorIwRollRequest,
  normalizeManualAdvisorSkillCheckpointRequest,
  type ManualAdvisorIwRollCommandRequest,
  type ManualAdvisorSkillCheckpointCommandRequest,
  type ManualAdvisorSkillRecord,
  type ManualCompositionStage,
  type ManualPhysicalRoll,
} from './creation-manual-advisor-contract.js';
import type { ManualCompositionValidationContext } from './creation-manual-composition.js';
import {
  manualNavigationRevisionsMatch,
  type ManualAdvisorIwRecord,
} from './creation-manual-composition-contract.js';
import { writeManualCommandPresentation } from './creation-manual-composition-navigation.js';

type DecodedCommandRequest = Parameters<typeof normalizeManualAdvisorIwRollRequest>[0];

interface ManualAdvisorPreflight<Request> {
  readonly request: Request;
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly stage: ManualCompositionStage;
}

function hasAdvisor(composition: SymbiontComposition): boolean {
  return composition.acceptedSpecies.some((accepted) => accepted.speciesKey === 'ADVISER');
}

function freshAdvisorId(
  checkpoint: DurableCreationWizardCheckpoint,
  request: ManualAdvisorIwRollCommandRequest,
  receiptIds: readonly [string, string],
  allocate: () => string,
): string {
  const value = allocate();
  const occupied = creationWizardDurableIds(checkpoint);
  if (
    value.length === 0 ||
    occupied.has(value) ||
    value === request.commandId ||
    receiptIds.includes(value)
  ) {
    return guardSymbiontRejected();
  }
  return value;
}

function assertReceiptPair(
  checkpoint: DurableCreationWizardCheckpoint,
  request: ManualAdvisorIwRollCommandRequest,
  receiptIds: readonly [string, string],
): void {
  const occupied = creationWizardDurableIds(checkpoint);
  if (
    receiptIds[0] === receiptIds[1] ||
    receiptIds.includes(request.commandId) ||
    occupied.has(receiptIds[0]) ||
    occupied.has(receiptIds[1])
  ) {
    return guardSymbiontRejected();
  }
}

export function preflightManualAdvisorIw(
  database: Database.Database,
  request: DecodedCommandRequest,
  catalog: SymbiontCatalog,
  receiptIds?: readonly [string, string],
): ManualAdvisorPreflight<ManualAdvisorIwRollCommandRequest> {
  const normalized = normalizeManualAdvisorIwRollRequest(request);
  assertNoPreviousSymbiontCommand(database, catalog, normalized);
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    normalized.payload.characterDraftId,
    catalog.skillStage,
    catalog,
  );
  assertCommonSymbiont(
    checkpoint,
    normalized,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    normalized.payload.draftRevision,
    receiptIds?.[1],
  );
  const stage = checkpoint.manualCompositionStage;
  if (
    stage === null ||
    stage === undefined ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-041' ||
    !hasAdvisor(stage.composition) ||
    stage.advisorInstanceDraftIdOrNull !== normalized.payload.advisorInstanceDraftId ||
    stage.compositionDraftRevision !== normalized.payload.compositionDraftRevision ||
    !isDeepStrictEqual(stage.iwRollRequestIdsOrNull, normalized.payload.pendingRollRequestIds) ||
    stage.advisorIwRecordOrNull !== null ||
    stage.advisorSkillRecordOrNull !== null ||
    (stage.diceInputModeSnapshot === 'AUTO') !== (normalized.payload.manualFacesOrNull === null)
  ) {
    return guardSymbiontRejected();
  }
  if (receiptIds !== undefined) assertReceiptPair(checkpoint, normalized, receiptIds);
  return { request: normalized, checkpoint, stage };
}

export function commitManualAdvisorIw(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptIds: readonly [string, string],
  dependencies: CreationSymbiontRollDependencies,
): DurableCreationWizardCheckpoint {
  if (
    receiptIds.length !== 2 ||
    receiptIds.some((receiptId) => typeof receiptId !== 'string' || receiptId.length === 0)
  ) {
    throw new TypeError('manual Advisor I/W requires exactly two non-empty receipt IDs');
  }
  const normalized = normalizeManualAdvisorIwRollRequest(request);
  preflightManualAdvisorIw(database, normalized, dependencies.catalog, receiptIds);
  const committed = commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightManualAdvisorIw(
        database,
        normalized,
        dependencies.catalog,
        receiptIds,
      );
      const faces = normalized.payload.manualFacesOrNull ?? [
        sampledSymbiontFace(dependencies.sampleD20),
        sampledSymbiontFace(dependencies.sampleD20),
      ];
      const physicalRolls: [ManualPhysicalRoll, ManualPhysicalRoll] = [
        {
          kind: 'ADVISOR_I',
          rollRequestId: normalized.payload.pendingRollRequestIds[0],
          rollReceiptId: receiptIds[0],
          mechanical: { dieSides: 20, rawFace: faces[0] },
        },
        {
          kind: 'ADVISOR_W',
          rollRequestId: normalized.payload.pendingRollRequestIds[1],
          rollReceiptId: receiptIds[1],
          mechanical: { dieSides: 20, rawFace: faces[1] },
        },
      ];
      const receipt = manualAdvisorIwRollReceipt(
        {
          checkpoint: current.checkpoint,
          receiptId: receiptIds[1],
          revisions: incrementedSymbiontRevisions(
            currentCreationWizardRevisions(current.checkpoint),
          ),
          checkpointRevision: current.checkpoint.checkpoint.checkpointRevision + 1,
          draftRevision: current.checkpoint.receipt.result.draftRevision + 1,
          compositionDraftRevision: current.stage.compositionDraftRevision,
          diceInputModeSnapshot: current.stage.diceInputModeSnapshot,
        },
        normalized,
        physicalRolls,
      );
      const advisorIwRecordOrNull: ManualAdvisorIwRecord = {
        physicalRolls,
        request: normalized,
        receipt,
        nextStageEnvelope: nextSymbiontEnvelope('CHR-041', normalized.payload.characterDraftId),
      };
      const pendingSuppressionRollRequestIdOrNull =
        current.stage.suppressionRollRecordOrNull === null &&
        advisorSuppressedByTrogr(current.stage.composition)
          ? (current.stage.pendingSuppressionRollRequestIdOrNull ??
            freshAdvisorId(
              current.checkpoint,
              normalized,
              receiptIds,
              dependencies.allocateRollRequestId,
            ))
          : current.stage.pendingSuppressionRollRequestIdOrNull;
      const durablePayload = current.checkpoint.durablePayload;
      if (!('randomSymbiontStage' in durablePayload)) return guardSymbiontRejected();
      const result = update(
        {
          payloadJson: JSON.stringify({
            ...durablePayload,
            nextStageEnvelope: advisorIwRecordOrNull.nextStageEnvelope,
            receipt,
            randomReceiptIds:
              current.stage.diceInputModeSnapshot === 'AUTO'
                ? [...durablePayload.randomReceiptIds, ...receiptIds]
                : durablePayload.randomReceiptIds,
            manualCompositionStage: {
              ...current.stage,
              advisorIwRecordOrNull,
              pendingSuppressionRollRequestIdOrNull,
            },
          }),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      writeManualCommandPresentation(
        database,
        'CHR-041',
        normalized.payload.characterDraftId,
        current.stage.compositionDraftRevision,
        receipt.revisions.projectionRevision,
      );
      return result;
    },
  );
  return validateDurableCreationWizardCheckpoint(
    committed.result,
    committed.checkpoint,
    dependencies.catalog.skillStage,
    dependencies.catalog,
  );
}

function advisorSkillSelection(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
  stage: ManualCompositionStage,
  selectedSkills: ManualAdvisorSkillCheckpointCommandRequest['payload']['selectedSkills'],
): AdvisorSkillSelectionResult {
  const advisorIw = stage.advisorIwRecordOrNull?.receipt.result.advisorIw;
  if (advisorIw === undefined) return guardSymbiontRejected();
  const stats = deriveCreationSkillStageResult(checkpoint, catalog.skillStage).skillStageStats;
  try {
    return validateAdvisorSkillSelection(catalog.skillStage, {
      advisorIw,
      bodyStats: { S: stats.S, D: stats.D, M: stats.M, Z: stats.Z, C: stats.C },
      selectedSkills: selectedSkills.map((selection) => ({
        skillKey: selection.skillId,
        targetBonus: selection.targetBonus,
      })),
    });
  } catch {
    return guardSymbiontRejected();
  }
}

export function preflightManualAdvisorSkills(
  database: Database.Database,
  request: DecodedCommandRequest,
  catalog: SymbiontCatalog,
  receiptId?: string,
): ManualAdvisorPreflight<ManualAdvisorSkillCheckpointCommandRequest> {
  const normalized = normalizeManualAdvisorSkillCheckpointRequest(request);
  assertNoPreviousSymbiontCommand(database, catalog, normalized);
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    normalized.payload.characterDraftId,
    catalog.skillStage,
    catalog,
  );
  assertCommonSymbiont(
    checkpoint,
    normalized,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    normalized.payload.draftRevision,
    receiptId,
  );
  const stage = checkpoint.manualCompositionStage;
  if (
    stage === null ||
    stage === undefined ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-041' ||
    !hasAdvisor(stage.composition) ||
    stage.advisorInstanceDraftIdOrNull !== normalized.payload.advisorInstanceDraftId ||
    stage.compositionDraftRevision !== normalized.payload.compositionDraftRevision ||
    stage.advisorIwRecordOrNull === null ||
    stage.advisorSkillRecordOrNull !== null ||
    (advisorSuppressedByTrogr(stage.composition) && stage.suppressionRollRecordOrNull === null)
  ) {
    return guardSymbiontRejected();
  }
  advisorSkillSelection(checkpoint, catalog, stage, normalized.payload.selectedSkills);
  return { request: normalized, checkpoint, stage };
}

export function commitManualAdvisorSkills(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  dependencies: CreationSymbiontRollDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError('manual Advisor skill receiptId must be non-empty');
  }
  const normalized = normalizeManualAdvisorSkillCheckpointRequest(request);
  preflightManualAdvisorSkills(database, normalized, dependencies.catalog, receiptId);
  const committed = commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightManualAdvisorSkills(
        database,
        normalized,
        dependencies.catalog,
        receiptId,
      );
      const selection = advisorSkillSelection(
        current.checkpoint,
        dependencies.catalog,
        current.stage,
        normalized.payload.selectedSkills,
      );
      const receipt = manualAdvisorSkillCheckpointReceipt(
        {
          checkpoint: current.checkpoint,
          receiptId,
          revisions: incrementedSymbiontRevisions(
            currentCreationWizardRevisions(current.checkpoint),
          ),
          checkpointRevision: current.checkpoint.checkpoint.checkpointRevision + 1,
          draftRevision: current.checkpoint.receipt.result.draftRevision + 1,
          compositionDraftRevision: current.stage.compositionDraftRevision,
        },
        normalized,
        selection,
        !advisorSuppressedByTrogr(current.stage.composition),
      );
      const advisorSkillRecordOrNull: ManualAdvisorSkillRecord = {
        selectedSkills: normalized.payload.selectedSkills,
        learnedSkills: selection.learnedSkills,
        advisorStats: selection.advisorStats,
        request: normalized,
        receipt,
        nextStageEnvelope: nextSymbiontEnvelope('CHR-019', normalized.payload.characterDraftId),
      };
      const result = update(
        {
          payloadJson: JSON.stringify({
            ...current.checkpoint.durablePayload,
            nextStageEnvelope: advisorSkillRecordOrNull.nextStageEnvelope,
            receipt,
            manualCompositionStage: { ...current.stage, advisorSkillRecordOrNull },
          }),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      writeManualCommandPresentation(
        database,
        'CHR-019',
        normalized.payload.characterDraftId,
        current.stage.compositionDraftRevision,
        receipt.revisions.projectionRevision,
      );
      return result;
    },
  );
  return validateDurableCreationWizardCheckpoint(
    committed.result,
    committed.checkpoint,
    dependencies.catalog.skillStage,
    dependencies.catalog,
  );
}

export function validateManualAdvisorIwRecord(
  stage: ManualCompositionStage,
  composition: SymbiontComposition,
  compositionDraftRevision: number,
  context: ManualCompositionValidationContext,
): { readonly cursor: ManualCompositionValidationContext['cursor'] } {
  const record = stage.advisorIwRecordOrNull;
  if (record === null || !hasAdvisor(composition)) return guardSymbiontRejected();
  const { request, physicalRolls, cursor } = { ...record, cursor: context.cursor };
  if (
    request.payload.characterDraftId !== context.localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
    request.payload.draftRevision !== cursor.draftRevision ||
    request.payload.compositionDraftRevision !== compositionDraftRevision ||
    request.payload.advisorInstanceDraftId !== stage.advisorInstanceDraftIdOrNull ||
    !isDeepStrictEqual(request.payload.pendingRollRequestIds, stage.iwRollRequestIdsOrNull) ||
    !manualNavigationRevisionsMatch(request.expectedRevisions, cursor.revisions) ||
    physicalRolls[0].kind !== 'ADVISOR_I' ||
    physicalRolls[1].kind !== 'ADVISOR_W' ||
    physicalRolls[0].rollRequestId !== request.payload.pendingRollRequestIds[0] ||
    physicalRolls[1].rollRequestId !== request.payload.pendingRollRequestIds[1] ||
    physicalRolls[1].rollReceiptId !== record.receipt.receiptId ||
    (stage.diceInputModeSnapshot === 'AUTO'
      ? request.payload.manualFacesOrNull !== null
      : !isDeepStrictEqual(request.payload.manualFacesOrNull, [
          physicalRolls[0].mechanical.rawFace,
          physicalRolls[1].mechanical.rawFace,
        ]))
  ) {
    return guardSymbiontRejected();
  }
  if (context.commandIds.has(request.commandId)) return guardSymbiontRejected();
  context.commandIds.add(request.commandId);
  for (const roll of physicalRolls) {
    if (context.receiptIds.has(roll.rollReceiptId)) return guardSymbiontRejected();
    context.receiptIds.add(roll.rollReceiptId);
  }
  const receipt = manualAdvisorIwRollReceipt(
    {
      checkpoint: context.checkpointView,
      receiptId: record.receipt.receiptId,
      revisions: incrementedSymbiontRevisions(request.expectedRevisions),
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      compositionDraftRevision,
      diceInputModeSnapshot: stage.diceInputModeSnapshot,
    },
    request,
    physicalRolls,
  );
  const nextStageEnvelope = nextSymbiontEnvelope(
    'CHR-041',
    context.localCharacter.localCharacterId,
  );
  if (
    !isDeepStrictEqual(record.receipt, receipt) ||
    !isDeepStrictEqual(record.nextStageEnvelope, nextStageEnvelope)
  ) {
    return guardSymbiontRejected();
  }
  return {
    cursor: {
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      latestEnvelope: nextStageEnvelope,
      latestReceipt: receipt,
      latestRequest: request,
      revisions: receipt.revisions,
    },
  };
}

export function validateManualAdvisorSkillRecord(
  stage: ManualCompositionStage,
  composition: SymbiontComposition,
  compositionDraftRevision: number,
  context: ManualCompositionValidationContext,
): { readonly cursor: ManualCompositionValidationContext['cursor'] } {
  const record = stage.advisorSkillRecordOrNull;
  if (record === null || !hasAdvisor(composition)) return guardSymbiontRejected();
  const { request } = record;
  const cursor = context.cursor;
  if (
    stage.advisorIwRecordOrNull === null ||
    (advisorSuppressedByTrogr(composition) && stage.suppressionRollRecordOrNull === null) ||
    request.payload.characterDraftId !== context.localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
    request.payload.draftRevision !== cursor.draftRevision ||
    request.payload.compositionDraftRevision !== compositionDraftRevision ||
    request.payload.advisorInstanceDraftId !== stage.advisorInstanceDraftIdOrNull ||
    !manualNavigationRevisionsMatch(request.expectedRevisions, cursor.revisions)
  ) {
    return guardSymbiontRejected();
  }
  if (context.commandIds.has(request.commandId)) return guardSymbiontRejected();
  context.commandIds.add(request.commandId);
  if (context.receiptIds.has(record.receipt.receiptId)) return guardSymbiontRejected();
  context.receiptIds.add(record.receipt.receiptId);
  const selection = advisorSkillSelection(
    context.checkpointView,
    context.catalog,
    stage,
    request.payload.selectedSkills,
  );
  const receipt = manualAdvisorSkillCheckpointReceipt(
    {
      checkpoint: context.checkpointView,
      receiptId: record.receipt.receiptId,
      revisions: incrementedSymbiontRevisions(request.expectedRevisions),
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      compositionDraftRevision,
    },
    request,
    selection,
    !advisorSuppressedByTrogr(composition),
  );
  const nextStageEnvelope = nextSymbiontEnvelope(
    'CHR-019',
    context.localCharacter.localCharacterId,
  );
  if (
    !isDeepStrictEqual(record.selectedSkills, request.payload.selectedSkills) ||
    !isDeepStrictEqual(record.learnedSkills, selection.learnedSkills) ||
    !isDeepStrictEqual(record.advisorStats, selection.advisorStats) ||
    !isDeepStrictEqual(record.receipt, receipt) ||
    !isDeepStrictEqual(record.nextStageEnvelope, nextStageEnvelope)
  ) {
    return guardSymbiontRejected();
  }
  return {
    cursor: {
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      latestEnvelope: nextStageEnvelope,
      latestReceipt: receipt,
      latestRequest: request,
      revisions: receipt.revisions,
    },
  };
}
