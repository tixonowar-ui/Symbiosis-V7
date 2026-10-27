import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import {
  validateManualSymbiontComposition,
  type SymbiontCatalog,
  type SymbiontComposition,
} from '../domain/index.js';
import { commitLocalCharacterCheckpoint } from '../persistence/index.js';
import type { LocalCharacter, LocalCharacterCheckpoint } from '../persistence/index.js';
import {
  currentCreationWizardRevisions,
  creationWizardDurableIds,
  loadCreationWizardCheckpoint,
  validateDurableCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
  type RollValidationCursor,
} from './creation-set-decide.js';
import {
  assertCommonSymbiont,
  assertNoPreviousSymbiontCommand,
  type CreationSymbiontRollDependencies,
} from './creation-symbiont-commands.js';
import {
  guardSymbiontRejected,
  incrementedSymbiontRevisions,
  nextSymbiontEnvelope,
} from './creation-symbiont-contract.js';
import {
  manualCompositionCheckpointReceipt,
  manualCompositionStageIds,
  manualNavigationRevisionsMatch,
  normalizeManualCompositionCheckpointRequest,
  parseManualCompositionStage,
  type ManualCompositionCheckpointCommandRequest,
  type ManualCompositionRecord,
  type ManualCompositionStage,
} from './creation-manual-composition-contract.js';
import { advisorIntelligenceFloorStageForManual } from './creation-manual-advisor-contract.js';
import {
  validateManualAdvisorIwRecord,
  validateManualAdvisorSkillRecord,
} from './creation-manual-advisor.js';
import {
  advisorSuppressedByTrogr,
  validateAdvisorIntelligenceFloorStageHistory,
} from './creation-advisor-intelligence-floor-contract.js';
import { writeManualCommandPresentation } from './creation-manual-composition-navigation.js';

export { latestManualCompositionRecord } from './creation-manual-composition-contract.js';

type DecodedCommandRequest = Parameters<typeof normalizeManualCompositionCheckpointRequest>[0];

interface ManualCompositionPreflight {
  readonly request: ManualCompositionCheckpointCommandRequest;
  readonly checkpoint: DurableCreationWizardCheckpoint;
}

function freshManualId(
  checkpoint: DurableCreationWizardCheckpoint,
  commandId: string,
  receiptId: string,
  allocate: () => string,
  additional: readonly string[] = [],
): string {
  const occupied = new Set([
    ...creationWizardDurableIds(checkpoint),
    commandId,
    receiptId,
    ...additional,
  ]);
  const value = allocate();
  if (value.length === 0 || occupied.has(value)) return guardSymbiontRejected();
  return value;
}

export function preflightManualComposition(
  database: Database.Database,
  request: DecodedCommandRequest,
  catalog: SymbiontCatalog,
  receiptId?: string,
): ManualCompositionPreflight {
  const normalized = normalizeManualCompositionCheckpointRequest(request);
  assertNoPreviousSymbiontCommand(database, catalog, normalized);
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    normalized.payload.characterDraftId,
    catalog.skillStage,
    catalog,
  );
  const acquisition = checkpoint.raceAndMethodStage;
  if (acquisition?.symbiontAcquisition.value !== 'MANUAL') {
    return guardSymbiontRejected();
  }
  assertCommonSymbiont(
    checkpoint,
    normalized,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    normalized.payload.draftRevision,
    receiptId,
  );
  const currentStage = checkpoint.manualCompositionStage;
  if (
    checkpoint.randomSymbiontStage !== null ||
    (checkpoint.advisorIntelligenceFloorStage !== null &&
      checkpoint.advisorIntelligenceFloorStage !== undefined) ||
    (currentStage === null && checkpoint.nextStageEnvelope.formId !== 'CHR-017')
  ) {
    return guardSymbiontRejected();
  }
  if (
    normalized.payload.compositionDraftRevision !==
    (currentStage?.compositionDraftRevision ?? checkpoint.receipt.result.draftRevision)
  ) {
    return guardSymbiontRejected();
  }
  if (currentStage !== null && currentStage !== undefined) {
    parseManualCompositionStage(currentStage, catalog);
  }
  return { request: normalized, checkpoint };
}

export function commitManualComposition(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  dependencies: CreationSymbiontRollDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError('manual composition receiptId must be non-empty');
  }
  const normalized = normalizeManualCompositionCheckpointRequest(request);
  preflightManualComposition(database, normalized, dependencies.catalog, receiptId);
  const committed = commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightManualComposition(
        database,
        normalized,
        dependencies.catalog,
        receiptId,
      );
      const validated = validateManualSymbiontComposition(dependencies.catalog, {
        raceCode: current.checkpoint.raceAndMethodStage!.race!
          .value as SymbiontComposition['raceCode'],
        acceptedSpecies: normalized.payload.acceptedSpecies,
        selectedBindings: normalized.payload.selectedBindings,
      });
      const currentStage = current.checkpoint.manualCompositionStage;
      const hasAdvisor = validated.composition.acceptedSpecies.some(
        (accepted) => accepted.speciesKey === 'ADVISER',
      );
      const advisorInstanceDraftIdOrNull =
        currentStage?.advisorInstanceDraftIdOrNull ??
        (hasAdvisor
          ? freshManualId(
              current.checkpoint,
              normalized.commandId,
              receiptId,
              dependencies.allocateRollRequestId,
            )
          : null);
      const iwRollRequestIdsOrNull: ManualCompositionStage['iwRollRequestIdsOrNull'] =
        currentStage?.iwRollRequestIdsOrNull ??
        (hasAdvisor
          ? [
              freshManualId(
                current.checkpoint,
                normalized.commandId,
                receiptId,
                dependencies.allocateRollRequestId,
                [advisorInstanceDraftIdOrNull!],
              ),
              freshManualId(
                current.checkpoint,
                normalized.commandId,
                receiptId,
                dependencies.allocateRollRequestId,
                [advisorInstanceDraftIdOrNull!],
              ),
            ]
          : null);
      const advisorWorkPending =
        hasAdvisor &&
        ((currentStage?.advisorIwRecordOrNull ?? null) === null ||
          (currentStage?.advisorSkillRecordOrNull ?? null) === null ||
          ((currentStage?.suppressionRollRecordOrNull ?? null) === null &&
            advisorSuppressedByTrogr(validated.composition)));
      const nextStageEnvelope = nextSymbiontEnvelope(
        advisorWorkPending ? 'CHR-041' : 'CHR-019',
        normalized.payload.characterDraftId,
      );
      const revisions = incrementedSymbiontRevisions(
        currentCreationWizardRevisions(current.checkpoint),
      );
      const draftRevision = current.checkpoint.receipt.result.draftRevision + 1;
      const receipt = manualCompositionCheckpointReceipt(
        {
          checkpoint: current.checkpoint,
          receiptId,
          revisions,
          checkpointRevision: current.checkpoint.checkpoint.checkpointRevision + 1,
          draftRevision,
          compositionDraftRevision: draftRevision,
        },
        normalized,
        validated.composition,
        validated.bindings,
        nextStageEnvelope.formId,
      );
      const record: ManualCompositionRecord = {
        acceptedSpecies: validated.composition.acceptedSpecies,
        bindings: validated.bindings,
        request: normalized,
        receipt,
        nextStageEnvelope,
      };
      const manualCompositionStage: ManualCompositionStage = {
        composition: validated.composition,
        compositionDraftRevision: draftRevision,
        diceInputModeSnapshot: current.checkpoint.raceAndMethodStage!.diceInput!.value,
        compositionRecords: [...(currentStage?.compositionRecords ?? []), record],
        advisorInstanceDraftIdOrNull,
        iwRollRequestIdsOrNull,
        advisorIwRecordOrNull: currentStage?.advisorIwRecordOrNull ?? null,
        pendingSuppressionRollRequestIdOrNull:
          currentStage?.suppressionRollRecordOrNull === null &&
          currentStage.advisorIwRecordOrNull !== null &&
          hasAdvisor &&
          advisorSuppressedByTrogr(validated.composition)
            ? (currentStage.pendingSuppressionRollRequestIdOrNull ??
              freshManualId(
                current.checkpoint,
                normalized.commandId,
                receiptId,
                dependencies.allocateRollRequestId,
              ))
            : (currentStage?.pendingSuppressionRollRequestIdOrNull ?? null),
        suppressionRollRecordOrNull: currentStage?.suppressionRollRecordOrNull ?? null,
        advisorSkillRecordOrNull: currentStage?.advisorSkillRecordOrNull ?? null,
      };
      manualCompositionStageIds(manualCompositionStage);
      const nextPayload = {
        ...current.checkpoint.durablePayload,
        nextStageEnvelope,
        receipt,
        randomSymbiontStage: null,
        manualCompositionStage,
      };
      const result = update(
        { payloadJson: JSON.stringify(nextPayload) },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      writeManualCommandPresentation(
        database,
        nextStageEnvelope.formId,
        normalized.payload.characterDraftId,
        draftRevision,
        revisions.projectionRevision,
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

export interface ManualCompositionValidationContext {
  readonly catalog: SymbiontCatalog;
  readonly localCharacter: LocalCharacter;
  readonly checkpoint: LocalCharacterCheckpoint;
  readonly checkpointView: DurableCreationWizardCheckpoint;
  readonly cursor: RollValidationCursor;
  readonly commandIds: Set<string>;
  readonly receiptIds: Set<string>;
  readonly occupiedIds: Set<string>;
}

function occupy(context: ManualCompositionValidationContext, id: string): void {
  if (context.occupiedIds.has(id)) throw new Error(`duplicate durable ID ${JSON.stringify(id)}`);
  context.occupiedIds.add(id);
}

export function validateManualCompositionStageHistory(
  stage: ManualCompositionStage,
  context: ManualCompositionValidationContext,
): { readonly cursor: RollValidationCursor } {
  const acquisition = context.checkpointView.raceAndMethodStage;
  if (
    acquisition === null ||
    acquisition.race?.value !== stage.composition.raceCode ||
    acquisition.symbiontAcquisition.value !== 'MANUAL' ||
    acquisition.diceInput?.value !== stage.diceInputModeSnapshot ||
    context.checkpointView.skillSelectionStage === null ||
    stage.compositionRecords.length === 0
  ) {
    return guardSymbiontRejected();
  }
  for (const id of manualCompositionStageIds(stage)) occupy(context, id);
  let cursor = context.cursor;
  let currentComposition: SymbiontComposition | null = null;
  let compositionDraftRevision: number | null = null;
  let advisorEverPresent = false;
  let iwCommitted = false;
  let suppressionCommitted = false;
  let pendingSuppressionExpected = false;
  if (
    stage.compositionRecords.some(
      (record, index, records) =>
        index > 0 &&
        record.receipt.result.draftRevision <= records[index - 1]!.receipt.result.draftRevision,
    )
  ) {
    return guardSymbiontRejected();
  }
  const records = [
    ...stage.compositionRecords,
    ...(stage.advisorIwRecordOrNull === null ? [] : [stage.advisorIwRecordOrNull]),
    ...(stage.suppressionRollRecordOrNull === null ? [] : [stage.suppressionRollRecordOrNull]),
    ...(stage.advisorSkillRecordOrNull === null ? [] : [stage.advisorSkillRecordOrNull]),
  ].sort((left, right) => left.receipt.result.draftRevision - right.receipt.result.draftRevision);
  for (const record of records) {
    if (record.receipt.result.draftRevision !== cursor.draftRevision + 1) {
      return guardSymbiontRejected();
    }
    if ('acceptedSpecies' in record) {
      const validated = validateManualSymbiontComposition(context.catalog, {
        raceCode: stage.composition.raceCode,
        acceptedSpecies: record.acceptedSpecies,
        selectedBindings: record.request.payload.selectedBindings,
      });
      if (
        !isDeepStrictEqual(record.bindings, validated.bindings) ||
        !isDeepStrictEqual(record.acceptedSpecies, validated.composition.acceptedSpecies)
      ) {
        return guardSymbiontRejected();
      }
      const request = record.request;
      if (
        request.payload.characterDraftId !== context.localCharacter.localCharacterId ||
        request.payload.wizardCheckpointId !== context.checkpoint.checkpointId ||
        request.payload.draftRevision !== cursor.draftRevision ||
        request.payload.compositionDraftRevision !==
          (compositionDraftRevision ?? cursor.draftRevision) ||
        !manualNavigationRevisionsMatch(request.expectedRevisions, cursor.revisions)
      ) {
        return guardSymbiontRejected();
      }
      if (context.commandIds.has(request.commandId)) return guardSymbiontRejected();
      context.commandIds.add(request.commandId);
      if (context.receiptIds.has(record.receipt.receiptId)) return guardSymbiontRejected();
      context.receiptIds.add(record.receipt.receiptId);
      const receipt = manualCompositionCheckpointReceipt(
        {
          checkpoint: context.checkpointView,
          receiptId: record.receipt.receiptId,
          revisions: incrementedSymbiontRevisions(request.expectedRevisions),
          checkpointRevision: cursor.checkpointRevision + 1,
          draftRevision: cursor.draftRevision + 1,
          compositionDraftRevision: cursor.draftRevision + 1,
        },
        request,
        validated.composition,
        validated.bindings,
        record.nextStageEnvelope.formId,
      );
      const nextStageEnvelope = nextSymbiontEnvelope(
        receipt.result.nextFormId,
        context.localCharacter.localCharacterId,
      );
      if (
        !isDeepStrictEqual(record.receipt, receipt) ||
        !isDeepStrictEqual(record.nextStageEnvelope, nextStageEnvelope)
      ) {
        return guardSymbiontRejected();
      }
      cursor = {
        checkpointRevision: cursor.checkpointRevision + 1,
        draftRevision: cursor.draftRevision + 1,
        latestEnvelope: nextStageEnvelope,
        latestReceipt: receipt,
        latestRequest: request,
        revisions: receipt.revisions,
      };
      currentComposition = validated.composition;
      compositionDraftRevision = receipt.result.compositionDraftRevision;
      advisorEverPresent ||= validated.composition.acceptedSpecies.some(
        (accepted) => accepted.speciesKey === 'ADVISER',
      );
      if (iwCommitted && !suppressionCommitted && advisorSuppressedByTrogr(validated.composition)) {
        pendingSuppressionExpected = true;
      }
      continue;
    }
    if (currentComposition === null || compositionDraftRevision === null) {
      return guardSymbiontRejected();
    }
    if ('physicalRolls' in record) {
      cursor = validateManualAdvisorIwRecord(stage, currentComposition, compositionDraftRevision, {
        ...context,
        cursor,
      }).cursor;
      iwCommitted = true;
      if (advisorSuppressedByTrogr(currentComposition)) pendingSuppressionExpected = true;
      continue;
    }
    if ('physicalRoll' in record) {
      if (
        !iwCommitted ||
        suppressionCommitted ||
        !pendingSuppressionExpected ||
        (stage.pendingSuppressionRollRequestIdOrNull !== null &&
          stage.pendingSuppressionRollRequestIdOrNull !==
            record.request.payload.pendingRollRequestId) ||
        !advisorSuppressedByTrogr(currentComposition)
      ) {
        return guardSymbiontRejected();
      }
      const floorStage = advisorIntelligenceFloorStageForManual(
        { ...context.checkpointView, manualCompositionStage: stage },
        context.catalog,
      );
      if (floorStage === null) return guardSymbiontRejected();
      cursor = validateAdvisorIntelligenceFloorStageHistory(floorStage, {
        ...context,
        cursor,
        idsAlreadyOccupied: true,
      }).cursor;
      suppressionCommitted = true;
      pendingSuppressionExpected = false;
      continue;
    }
    if (advisorSuppressedByTrogr(currentComposition) && (!iwCommitted || !suppressionCommitted)) {
      return guardSymbiontRejected();
    }
    cursor = validateManualAdvisorSkillRecord(stage, currentComposition, compositionDraftRevision, {
      ...context,
      cursor,
    }).cursor;
  }
  if (
    currentComposition === null ||
    compositionDraftRevision === null ||
    !isDeepStrictEqual(stage.composition, currentComposition) ||
    stage.compositionDraftRevision !== compositionDraftRevision ||
    advisorEverPresent !==
      (stage.advisorInstanceDraftIdOrNull !== null && stage.iwRollRequestIdsOrNull !== null) ||
    (stage.advisorInstanceDraftIdOrNull === null) !== (stage.iwRollRequestIdsOrNull === null) ||
    pendingSuppressionExpected !== (stage.pendingSuppressionRollRequestIdOrNull !== null)
  ) {
    return guardSymbiontRejected();
  }
  return { cursor };
}
