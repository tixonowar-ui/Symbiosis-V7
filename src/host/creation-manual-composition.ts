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
  normalizeManualCompositionCheckpointRequest,
  parseManualCompositionStage,
  type ManualCompositionCheckpointCommandRequest,
  type ManualCompositionRecord,
  type ManualCompositionStage,
} from './creation-manual-composition-contract.js';

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
      const nextStageEnvelope = nextSymbiontEnvelope(
        hasAdvisor ? 'CHR-041' : 'CHR-019',
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
          currentStage?.pendingSuppressionRollRequestIdOrNull ?? null,
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
      return update(
        { payloadJson: JSON.stringify(nextPayload) },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
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
  for (const record of stage.compositionRecords) {
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
      request.payload.compositionDraftRevision !== cursor.draftRevision ||
      !isDeepStrictEqual(request.expectedRevisions, cursor.revisions)
    ) {
      return guardSymbiontRejected();
    }
    if (context.commandIds.has(request.commandId)) return guardSymbiontRejected();
    context.commandIds.add(request.commandId);
    if (context.receiptIds.has(record.receipt.receiptId)) return guardSymbiontRejected();
    context.receiptIds.add(record.receipt.receiptId);
    const revisions = {
      actorVisibilityRevision: request.expectedRevisions.actorVisibilityRevision,
      projectionRevision: request.expectedRevisions.projectionRevision + 1,
      stateRevision: request.expectedRevisions.stateRevision + 1,
    };
    const receipt = manualCompositionCheckpointReceipt(
      {
        checkpoint: context.checkpointView,
        receiptId: record.receipt.receiptId,
        revisions,
        checkpointRevision: cursor.checkpointRevision + 1,
        draftRevision: cursor.draftRevision + 1,
        compositionDraftRevision: cursor.draftRevision + 1,
      },
      request,
      validated.composition,
      validated.bindings,
    );
    if (!isDeepStrictEqual(record.receipt, receipt)) return guardSymbiontRejected();
    const nextStageEnvelope = nextSymbiontEnvelope(
      receipt.result.nextFormId,
      context.localCharacter.localCharacterId,
    );
    if (!isDeepStrictEqual(record.nextStageEnvelope, nextStageEnvelope)) {
      return guardSymbiontRejected();
    }
    cursor = {
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      latestEnvelope: nextStageEnvelope,
      latestReceipt: receipt,
      latestRequest: request,
      revisions,
    };
  }
  if (
    stage.advisorIwRecordOrNull !== null ||
    stage.suppressionRollRecordOrNull !== null ||
    stage.advisorSkillRecordOrNull !== null
  ) {
    return guardSymbiontRejected();
  }
  if (
    stage.pendingSuppressionRollRequestIdOrNull !== null ||
    stage.compositionDraftRevision !== cursor.draftRevision
  ) {
    return guardSymbiontRejected();
  }
  const latestRecord = stage.compositionRecords.at(-1)!;
  if (
    !isDeepStrictEqual(
      stage.composition,
      validateManualSymbiontComposition(context.catalog, {
        raceCode: stage.composition.raceCode,
        acceptedSpecies: latestRecord.acceptedSpecies,
        selectedBindings: latestRecord.request.payload.selectedBindings,
      }).composition,
    )
  ) {
    return guardSymbiontRejected();
  }
  const advisorPresent = stage.composition.acceptedSpecies.some(
    (accepted) => accepted.speciesKey === 'ADVISER',
  );
  if (
    advisorPresent &&
    (stage.advisorInstanceDraftIdOrNull === null || stage.iwRollRequestIdsOrNull === null)
  ) {
    return guardSymbiontRejected();
  }
  if (
    !advisorPresent &&
    stage.advisorInstanceDraftIdOrNull === null &&
    stage.iwRollRequestIdsOrNull !== null
  ) {
    return guardSymbiontRejected();
  }
  return { cursor };
}
