import {
  createFiveStartingPositionsSetup,
  fiveStartingPositionRollRequest,
  fiveStartingPositionsCheckpointRequest,
} from './five-starting-positions-stage.js';
import { commitFiveStartingPositions } from '../../src/host/creation-five-starting-positions.js';
import {
  currentCreationWizardRevisions,
  type DurableCreationWizardCheckpoint,
} from '../../src/host/creation-set-decide.js';
import { collectStartingPropertyReceiptRefs } from '../../src/host/creation-property-summary.js';
import { loadCreationFinalizationCatalog } from '../../src/host/creation-finalization-catalog.js';
import { deriveCreationFinalizationView } from '../../src/host/creation-finalization.js';
import type {
  CreationFinalizationRequest,
  CreationCorrectionPayload,
  CreationPropertySummaryRequest,
  CreationFinalSaveRequest,
} from '../../src/host/creation-finalization-contract.js';
import {
  manualCompositionRequest,
  manualAdvisorIwRequest,
  manualAdvisorSkillRequest,
  type ManualWizardSetup,
} from './manual-symbiont-stage.js';
import { commitManualComposition } from '../../src/host/creation-manual-composition.js';
import {
  commitManualAdvisorIw,
  commitManualAdvisorSkills,
} from '../../src/host/creation-manual-advisor.js';

/** Real pre-symbiont Advisor acquisition whose ACTING requirement is lost to Skunk. */
export function prepareOriginalAdvisorBodyLoss(
  setup: ManualWizardSetup,
): DurableCreationWizardCheckpoint {
  const prefix = `${setup.characterDraftId}-initial-advisor`;
  let allocated = 0;
  const dependencies = {
    catalog: setup.catalog,
    allocateRollRequestId: () => `${prefix}-request-${String(++allocated)}`,
    sampleD20: () => 2,
  };
  let current = commitManualComposition(
    setup.database,
    manualCompositionRequest(setup, setup.checkpoint, `${prefix}-composition`, [
      'ADVISER',
      'SKUNK',
      'OWL',
      'TICK',
    ]),
    `${prefix}-composition-receipt`,
    dependencies,
  );
  current = commitManualAdvisorIw(
    setup.database,
    manualAdvisorIwRequest(
      setup,
      current,
      `${prefix}-iw`,
      current.manualCompositionStage!.diceInputModeSnapshot === 'MANUAL' ? [2, 2] : null,
    ),
    [`${prefix}-i-receipt`, `${prefix}-w-receipt`],
    dependencies,
  );
  return commitManualAdvisorSkills(
    setup.database,
    manualAdvisorSkillRequest(setup, current, `${prefix}-skills`, [
      { skillId: 'ACTING', targetBonus: 1 },
      { skillId: 'UNARMED', targetBonus: 4 },
    ]),
    `${prefix}-skills-receipt`,
    dependencies,
  );
}

export async function createCreationFinalizationSetup(
  options: Parameters<typeof createFiveStartingPositionsSetup>[0],
) {
  const prepared = await createFiveStartingPositionsSetup(options);
  try {
    const { setup } = prepared;
    const finalizationCatalog = await loadCreationFinalizationCatalog(process.cwd());
    const dependencies = { catalog: setup.catalog, finalizationCatalog, sampleD20: () => 1 };
    let current = prepared.current;
    for (const index of [4, 1, 3, 0, 2])
      current = commitFiveStartingPositions(
        setup.database,
        fiveStartingPositionRollRequest(
          current,
          `${options.prefix}-position-${String(index)}`,
          index,
        ),
        `${options.prefix}-position-receipt-${String(index)}`,
        { catalog: setup.catalog, positionsCatalog: prepared.positionsCatalog, sampleD20: () => 1 },
      );
    current = commitFiveStartingPositions(
      setup.database,
      fiveStartingPositionsCheckpointRequest(current, `${options.prefix}-positions-confirm`),
      `${options.prefix}-positions-confirm-receipt`,
      { catalog: setup.catalog, positionsCatalog: prepared.positionsCatalog, sampleD20: () => 1 },
    );
    return { ...prepared, current, finalizationCatalog, dependencies };
  } catch (error) {
    prepared.setup.database.close();
    throw error;
  }
}

function common(checkpoint: DurableCreationWizardCheckpoint, commandId: string) {
  return {
    protocolVersion: 1 as const,
    messageType: 'command.request' as const,
    role: 'player' as const,
    commandId,
    expectedRevisions: currentCreationWizardRevisions(checkpoint),
  };
}
function payload(checkpoint: DurableCreationWizardCheckpoint) {
  return {
    stage: 'FINALIZATION' as const,
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
    draftRevision: checkpoint.receipt.result.draftRevision,
  };
}
export function creationPropertySummaryRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  commandId: string,
): CreationPropertySummaryRequest {
  return {
    ...common(checkpoint, commandId),
    commandKind: 'workflow-command',
    workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
    payload: {
      ...payload(checkpoint),
      sourceFormId: 'CHR-032',
      variant: 'PROPERTY_SUMMARY',
      propertyCheckpointReceiptId:
        checkpoint.fiveStartingPositionsStage!.checkpointRecordOrNull!.receipt.receiptId,
      propertyRollReceipts: collectStartingPropertyReceiptRefs(checkpoint),
    },
  };
}
export function creationFinalSaveRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  commandId: string,
): CreationFinalSaveRequest {
  const view = deriveCreationFinalizationView(checkpoint);
  return {
    ...common(checkpoint, commandId),
    commandKind: 'operation-command',
    transition: {
      from: 'CHR-025',
      kind: 'operation-command',
      to: 'CHR-040',
      trigger: 'Сохранить финального персонажа',
    },
    payload: {
      ...payload(checkpoint),
      sourceFormId: 'CHR-025',
      variant: 'FINAL_SAVE',
      summaryReceiptId: view.summaryReceiptIdOrNull!,
      correctionHeadHash: view.correctionHeadHash,
    },
  };
}
type CorrectionInput<T extends CreationCorrectionPayload> = T extends unknown
  ? Omit<
      T,
      | 'stage'
      | 'characterDraftId'
      | 'wizardCheckpointId'
      | 'draftRevision'
      | 'summaryReceiptId'
      | 'correctionHeadHash'
    > & { readonly variant: T['variant']; readonly sourceFormId: T['sourceFormId'] }
  : never;
export function creationCorrectionRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  commandId: string,
  correction: CorrectionInput<CreationCorrectionPayload>,
): CreationFinalizationRequest {
  const view = deriveCreationFinalizationView(checkpoint);
  const roll = [
    'CORRECTION_RANDOM_ROLL',
    'CORRECTION_RANDOM_BINDINGS',
    'CORRECTION_MONSTER_CHOICE',
    'CORRECTION_ADVISOR_IW',
    'CORRECTION_ADVISOR_B',
  ].includes(correction.variant);
  const decide = ['CORRECTION_RACE', 'CORRECTION_CLASS', 'CORRECTION_INTERACTIONS'].includes(
    correction.variant,
  );
  return {
    ...common(checkpoint, commandId),
    commandKind: 'workflow-command',
    workflowCommandId: roll
      ? 'UI-CMD-CHAR-CREATION-ROLL-COMMIT'
      : decide
        ? 'UI-CMD-CHAR-CREATION-SET-DECIDE'
        : 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
    payload: {
      ...payload(checkpoint),
      ...correction,
      summaryReceiptId: view.summaryReceiptIdOrNull!,
      correctionHeadHash: view.correctionHeadHash,
    },
  } as CreationFinalizationRequest;
}
