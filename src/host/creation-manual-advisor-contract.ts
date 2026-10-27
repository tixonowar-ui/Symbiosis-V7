import {
  resolveSymbiontComposition,
  type SymbiontCatalog,
  type SymbiontComposition,
} from '../domain/index.js';
import type { AdvisorIntelligenceFloorStage } from './creation-advisor-intelligence-floor-contract.js';
import type { DurableCreationWizardCheckpoint } from './creation-set-decide.js';
import {
  advisorIntelligenceFloorStageFromCheckpoint,
  manualAdvisorIwRollReceipt,
  manualAdvisorSkillCheckpointReceipt,
  normalizeManualAdvisorIwRollRequest,
  normalizeManualAdvisorSkillCheckpointRequest,
} from './creation-manual-composition-contract.js';
import { guardSymbiontRejected } from './creation-symbiont-contract.js';

export {
  advisorIntelligenceFloorStageFromCheckpoint,
  manualAdvisorIwRollReceipt,
  manualAdvisorSkillCheckpointReceipt,
  normalizeManualAdvisorIwRollRequest,
  normalizeManualAdvisorSkillCheckpointRequest,
};
export type {
  ManualAdvisorIwRollCommandRequest,
  ManualAdvisorIwRollPayload,
  ManualAdvisorIwRecord,
  ManualAdvisorIwRollReceipt,
  ManualAdvisorSkillCheckpointCommandRequest,
  ManualAdvisorSkillCheckpointPayload,
  ManualAdvisorSkillCheckpointReceipt,
  ManualAdvisorSkillRecord,
  ManualCompositionStage,
  ManualPhysicalRoll,
} from './creation-manual-composition-contract.js';

export function manualCompositionAtRevision(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
  compositionDraftRevision: number,
): SymbiontComposition {
  const stage = checkpoint.manualCompositionStage;
  const record = stage?.compositionRecords.find(
    (candidate) => candidate.receipt.result.compositionDraftRevision === compositionDraftRevision,
  );
  if (stage === null || stage === undefined || record === undefined) {
    return guardSymbiontRejected();
  }
  return resolveSymbiontComposition(catalog, {
    raceCode: stage.composition.raceCode,
    acceptedSpecies: record.acceptedSpecies,
  });
}

export function advisorIntelligenceFloorStageForManual(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
): AdvisorIntelligenceFloorStage | null {
  const stage = checkpoint.manualCompositionStage;
  if (stage === null || stage === undefined) {
    return advisorIntelligenceFloorStageFromCheckpoint(checkpoint);
  }
  const compositionDraftRevision =
    stage.suppressionRollRecordOrNull?.request.payload.compositionDraftRevision;
  return advisorIntelligenceFloorStageFromCheckpoint(
    checkpoint,
    compositionDraftRevision === undefined
      ? undefined
      : manualCompositionAtRevision(checkpoint, catalog, compositionDraftRevision),
  );
}
