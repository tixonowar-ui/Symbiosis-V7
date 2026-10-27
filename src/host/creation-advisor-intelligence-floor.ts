import type Database from 'better-sqlite3';

import {
  calculateTrogrSuppressionBonus,
  deriveAdvisorSuppressionMinimumI,
  type SymbiontCatalog,
} from '../domain/index.js';
import { commitLocalCharacterCheckpoint } from '../persistence/index.js';
import {
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
import {
  advisorSuppressedByTrogr,
  advisorTeacherAbsorbed,
  normalizeAdvisorIntelligenceFloorRollRequest,
  advisorIntelligenceFloorRollReceipt,
  type AdvisorIntelligenceFloorRollCommandRequest,
  type AdvisorIntelligenceFloorStage,
} from './creation-advisor-intelligence-floor-contract.js';
import { advisorIntelligenceFloorStageForManual } from './creation-manual-advisor-contract.js';
import { writeManualCommandPresentation } from './creation-manual-composition-navigation.js';

type DecodedCommandRequest = Parameters<typeof normalizeAdvisorIntelligenceFloorRollRequest>[0];

interface AdvisorIntelligenceFloorPreflight {
  readonly request: AdvisorIntelligenceFloorRollCommandRequest;
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly stage: AdvisorIntelligenceFloorStage;
}

export function preflightAdvisorIntelligenceFloorRoll(
  database: Database.Database,
  request: DecodedCommandRequest,
  catalog: SymbiontCatalog,
  receiptId?: string,
): AdvisorIntelligenceFloorPreflight {
  const normalized = normalizeAdvisorIntelligenceFloorRollRequest(request);
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
  const stage = advisorIntelligenceFloorStageForManual(checkpoint, catalog);
  if (
    stage === null ||
    stage === undefined ||
    checkpoint.randomSymbiontStage !== null ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-041' ||
    stage.advisorInstanceDraftId !== normalized.payload.advisorInstanceDraftId ||
    stage.compositionDraftRevision !== normalized.payload.compositionDraftRevision ||
    stage.pendingRollRequestIdOrNull !== normalized.payload.pendingRollRequestId ||
    stage.rollRecordOrNull !== null ||
    !advisorSuppressedByTrogr(stage.composition) ||
    (stage.diceInputModeSnapshot === 'AUTO') !== (normalized.payload.manualFaceOrNull === null)
  ) {
    return guardSymbiontRejected();
  }
  return { request: normalized, checkpoint, stage };
}

export function commitAdvisorIntelligenceFloorRoll(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  dependencies: CreationSymbiontRollDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(`advisor intelligence floor receiptId must be non-empty`);
  }
  const normalized = normalizeAdvisorIntelligenceFloorRollRequest(request);
  preflightAdvisorIntelligenceFloorRoll(database, normalized, dependencies.catalog, receiptId);
  const committed = commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = preflightAdvisorIntelligenceFloorRoll(
        database,
        normalized,
        dependencies.catalog,
        receiptId,
      );
      const rollRequestId = current.stage.pendingRollRequestIdOrNull;
      if (rollRequestId === null) return guardSymbiontRejected();
      const rawFace =
        normalized.payload.manualFaceOrNull ?? sampledSymbiontFace(dependencies.sampleD20);
      const physicalRoll = {
        kind: 'TROGR_SUPPRESSION_B' as const,
        rollRequestId,
        rollReceiptId: receiptId,
        mechanical: { dieSides: 20 as const, rawFace },
      };
      const suppressionB = calculateTrogrSuppressionBonus(physicalRoll.mechanical);
      const teacherAbsorbed = advisorTeacherAbsorbed(current.stage.composition);
      const minimumI = deriveAdvisorSuppressionMinimumI({ suppressionB, teacherAbsorbed });
      const revisions = incrementedSymbiontRevisions(
        currentCreationWizardRevisions(current.checkpoint),
      );
      const receipt = advisorIntelligenceFloorRollReceipt(
        {
          checkpoint: current.checkpoint,
          receiptId,
          revisions,
          checkpointRevision: current.checkpoint.checkpoint.checkpointRevision + 1,
          draftRevision: current.checkpoint.receipt.result.draftRevision + 1,
        },
        normalized,
        physicalRoll,
        suppressionB,
        minimumI,
        teacherAbsorbed,
      );
      const rollRecordOrNull = {
        physicalRoll,
        request: normalized,
        receipt,
        nextStageEnvelope: nextSymbiontEnvelope('CHR-041', normalized.payload.characterDraftId),
      };
      const advisorIntelligenceFloorStage: AdvisorIntelligenceFloorStage = {
        ...current.stage,
        pendingRollRequestIdOrNull: null,
        rollRecordOrNull,
      };
      const manualCompositionStage = current.checkpoint.manualCompositionStage;
      const nextPayload = {
        ...current.checkpoint.durablePayload,
        nextStageEnvelope: rollRecordOrNull.nextStageEnvelope,
        receipt,
        randomReceiptIds:
          current.stage.diceInputModeSnapshot === 'AUTO'
            ? [...current.checkpoint.durablePayload.randomReceiptIds, receiptId]
            : current.checkpoint.durablePayload.randomReceiptIds,
        ...(manualCompositionStage === null || manualCompositionStage === undefined
          ? { advisorIntelligenceFloorStage }
          : {
              manualCompositionStage: {
                ...manualCompositionStage,
                pendingSuppressionRollRequestIdOrNull: null,
                suppressionRollRecordOrNull: rollRecordOrNull,
              },
            }),
      };
      const result = update(
        { payloadJson: JSON.stringify(nextPayload) },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      if (manualCompositionStage !== null && manualCompositionStage !== undefined) {
        writeManualCommandPresentation(
          database,
          'CHR-041',
          normalized.payload.characterDraftId,
          current.stage.compositionDraftRevision,
          receipt.revisions.projectionRevision,
        );
      }
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
