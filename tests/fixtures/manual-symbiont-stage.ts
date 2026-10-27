import type { WorkflowCommandRequestMessage } from '@shared/wire-protocol.js';

import type {
  RandomSymbiontRaceCode,
  SymbiontCatalog,
  SymbiontSpeciesKey,
} from '../../src/domain/index.js';
import {
  advanceCreationSkillSelectionProjection,
  commitCreationSetDecide,
  currentCreationWizardRevisions,
  currentStatRollAttempt,
  loadCreationWizardCheckpoint,
  type CreationSetDecideCommandRequest,
  type DurableCreationWizardCheckpoint,
} from '../../src/host/creation-set-decide.js';
import { commitCreationRoll } from '../../src/host/creation-roll-commit.js';
import {
  advisorIntelligenceFloorStageFromCheckpoint,
  type ManualAdvisorIwRollCommandRequest,
  type ManualAdvisorSkillCheckpointCommandRequest,
  type ManualBindingSelection,
  type ManualCompositionCheckpointCommandRequest,
} from '../../src/host/creation-manual-composition-contract.js';
import type { AdvisorIntelligenceFloorRollCommandRequest } from '../../src/host/creation-advisor-intelligence-floor-contract.js';
import type { CreationSkillCatalog } from '../../src/host/creation-skill-catalog.js';
import type { SelectedSkillCommandInput } from '../../src/host/creation-skill-selection.js';
import { deriveCreationSkillStageResult } from '../../src/host/creation-stat-assignment.js';
import { createAdvisorSkillOptions } from '../../src/host/symbiont-stage-catalog.js';
import { commitCreationWizardCheckpoint } from '../../src/host/creation-wizard-checkpoint.js';
import {
  commitIdentityCheckpoint,
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
} from '../../src/host/identity-checkpoint.js';
import { bootstrapDeviceIdentity, openPersistenceDatabase } from '../../src/persistence/index.js';
import { CATALOG } from './symbiont-stage.js';

const ZERO_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const;

function decision(
  previous: DurableCreationWizardCheckpoint,
  commandId: string,
  payload: CreationSetDecideCommandRequest['payload'],
): CreationSetDecideCommandRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(previous),
    messageType: 'command.request',
    payload,
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-SET-DECIDE',
  };
}

function durableDecision(
  database: Parameters<typeof commitCreationSetDecide>[0],
  request: CreationSetDecideCommandRequest,
  receiptId: string,
  allocators?: {
    readonly allocateBranchUuid: () => string;
    readonly allocateRollRequestId: () => string;
  },
): DurableCreationWizardCheckpoint {
  const result = commitCreationSetDecide(database, request, receiptId, allocators);
  if (result.kind !== 'DURABLE') throw new Error('expected a durable decision');
  return result.durableCheckpoint;
}

function exactSelectedSkills(
  checkpoint: DurableCreationWizardCheckpoint,
): readonly { skillId: string; targetBonus: number }[] {
  const derived = checkpoint.skillEligibilityStage?.derived;
  if (derived === undefined) throw new Error('expected skill eligibility');
  let remaining = derived.requiredSlotCount - (derived.mandatoryClassSkillOrNull?.slotCost ?? 0);
  const selected: { skillId: string; targetBonus: number }[] = [];
  for (const skillId of derived.eligibleSkillIds) {
    if (remaining === 0) break;
    const targetBonus = Math.min(5, remaining);
    selected.push({ skillId, targetBonus });
    remaining -= targetBonus;
  }
  if (remaining !== 0) throw new Error('could not fill exact skill slots');
  return selected;
}

export interface ManualWizardSetup {
  readonly characterDraftId: string;
  readonly checkpoint: DurableCreationWizardCheckpoint;
  readonly database: Parameters<typeof commitCreationSetDecide>[0];
  readonly deviceId: string;
  readonly selectionRequest: WorkflowCommandRequestMessage;
  readonly wizardCheckpointId: string;
  readonly catalog: SymbiontCatalog;
}

export function createManualWizardSetup(
  prefix: string,
  raceChoice: 'FREE' | 'UNITED',
  diceInputMode: 'AUTO' | 'MANUAL',
  databasePath = ':memory:',
): ManualWizardSetup {
  const database = openPersistenceDatabase(databasePath);
  const deviceId = bootstrapDeviceIdentity(database);
  const characterDraftId = `${prefix}-character`;
  const wizardCheckpointId = `${prefix}-wizard`;
  commitIdentityCheckpoint(
    database,
    {
      commandId: `${prefix}-identity-command`,
      commandKind: 'workflow-command',
      expectedRevisions: ZERO_REVISIONS,
      messageType: 'command.request',
      payload: {
        age: 31,
        artAssetKeyOrLocalFile: null,
        characterDraftId,
        description: null,
        draftRevision: 0,
        massKg: 75,
        name: prefix,
        sex: 'FEMALE',
        stage: 'IDENTITY',
        wizardCheckpointId,
      },
      protocolVersion: 1,
      role: 'player',
      workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
    },
    `${prefix}-identity-receipt`,
  );
  let current = loadCreationWizardCheckpoint(
    database,
    characterDraftId,
    CATALOG.skillStage,
    CATALOG,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-race-command`, {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      raceChoice,
      sourceFormId: 'CHR-010',
      stage: 'RACE_AND_METHOD',
      wizardCheckpointId,
    }),
    `${prefix}-race-receipt`,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-acquisition-command`, {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: 'CHR-016',
      stage: 'RACE_AND_METHOD',
      symbiontAcquisitionMode: 'MANUAL',
      wizardCheckpointId,
    }),
    `${prefix}-acquisition-receipt`,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-dice-command`, {
      characterDraftId,
      diceInputMode,
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: 'CHR-036',
      stage: 'RACE_AND_METHOD',
      wizardCheckpointId,
    }),
    `${prefix}-dice-receipt`,
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-method-command`, {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: 'CHR-002',
      stage: 'RACE_AND_METHOD',
      statMethod: 'CLASSIC',
      wizardCheckpointId,
    }),
    `${prefix}-method-receipt`,
    {
      allocateBranchUuid: () => `${prefix}-stat-branch`,
      allocateRollRequestId: () => `${prefix}-set-request`,
    },
  );
  current = commitCreationRoll(
    database,
    {
      commandId: `${prefix}-set-command`,
      commandKind: 'workflow-command',
      expectedRevisions: currentCreationWizardRevisions(current),
      messageType: 'command.request',
      payload: {
        branchUuid: current.statRollStage!.branchUuid,
        characterDraftId,
        draftRevision: current.receipt.result.draftRevision,
        manualFacesOrNull: diceInputMode === 'MANUAL' ? [19, 19, 19, 19, 19, 19, 19] : null,
        setRollRequestId: currentStatRollAttempt(current.statRollStage!)!.setRollRequestId,
        sourceFormId: 'CHR-003',
        stage: 'STAT_ROLLS',
        wizardCheckpointId,
      },
      protocolVersion: 1,
      role: 'player',
      workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    },
    `${prefix}-set-receipt`,
    {
      allocateRollRequestId: () => `${prefix}-unused-confirmation-request`,
      sampleD20: () => 19,
    },
  );
  current = durableDecision(
    database,
    decision(current, `${prefix}-accept-command`, {
      characterDraftId,
      decision: 'ACCEPT_SET',
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: currentStatRollAttempt(current.statRollStage!)!.returnDecisionFormId,
      stage: 'STAT_ROLLS',
      wizardCheckpointId,
    }),
    `${prefix}-accept-receipt`,
  );
  current = commitCreationWizardCheckpoint(
    database,
    {
      commandId: `${prefix}-assignment-command`,
      commandKind: 'workflow-command',
      expectedRevisions: currentCreationWizardRevisions(current),
      messageType: 'command.request',
      payload: {
        characterDraftId,
        draftRevision: current.receipt.result.draftRevision,
        setEntryIndexByStat: { S: 0, D: 1, M: 2, Z: 3, I: 4, W: 5, C: 6 },
        sourceFormId: 'CHR-009',
        stage: 'STAT_ASSIGNMENT',
        wizardCheckpointId,
      },
      protocolVersion: 1,
      role: 'player',
      workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
    },
    `${prefix}-assignment-receipt`,
    CATALOG.skillStage,
  );
  commitCreationWizardCheckpoint(
    database,
    {
      commandId: `${prefix}-eligibility-command`,
      commandKind: 'workflow-command',
      expectedRevisions: currentCreationWizardRevisions(current),
      messageType: 'command.request',
      payload: {
        characterDraftId,
        draftRevision: current.receipt.result.draftRevision,
        sourceFormId: 'CHR-012',
        stage: 'SKILLS',
        wizardCheckpointId,
      },
      protocolVersion: 1,
      role: 'player',
      workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
    },
    `${prefix}-eligibility-receipt`,
    CATALOG.skillStage,
  );
  current = advanceCreationSkillSelectionProjection(
    database,
    characterDraftId,
    wizardCheckpointId,
    CATALOG.skillStage,
  );
  const selectionRequest: WorkflowCommandRequestMessage = {
    commandId: `${prefix}-selection-command`,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      selectedSkills: exactSelectedSkills(current),
      sourceFormId: 'CHR-015',
      stage: 'SKILLS',
      wizardCheckpointId,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  };
  current = commitCreationWizardCheckpoint(
    database,
    selectionRequest,
    `${prefix}-selection-receipt`,
    CATALOG.skillStage,
    () => `${prefix}-random-sequence`,
  );
  if (current.nextStageEnvelope.formId !== 'CHR-017') {
    throw new Error('manual setup did not reach CHR-017');
  }
  return {
    characterDraftId,
    checkpoint: current,
    database,
    deviceId,
    selectionRequest,
    wizardCheckpointId,
    catalog: CATALOG,
  };
}

export function manualCompositionRequest(
  setup: ManualWizardSetup,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  speciesKeys: readonly SymbiontSpeciesKey[],
  selectedBindings: readonly ManualBindingSelection[] = [],
): ManualCompositionCheckpointCommandRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      acceptedSpecies: speciesKeys.map((speciesKey, acceptedIndex) => ({
        acceptedIndex,
        speciesKey,
      })),
      characterDraftId: setup.characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      compositionDraftRevision:
        current.manualCompositionStage?.compositionDraftRevision ??
        current.receipt.result.draftRevision,
      selectedBindings,
      sourceFormId: 'CHR-018',
      stage: 'SYMBIONTS',
      variant: 'MANUAL_COMPOSITION',
      wizardCheckpointId: setup.wizardCheckpointId,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  };
}

export function manualRace(setup: ManualWizardSetup): RandomSymbiontRaceCode {
  const raceChoice = setup.checkpoint.raceAndMethodStage?.race?.value;
  if (raceChoice !== 'FREE' && raceChoice !== 'UNITED') {
    throw new Error('expected FREE or UNITED');
  }
  return raceChoice;
}

function manualStage(current: DurableCreationWizardCheckpoint) {
  const stage = current.manualCompositionStage;
  if (
    stage === null ||
    stage === undefined ||
    stage.advisorInstanceDraftIdOrNull === null ||
    stage.iwRollRequestIdsOrNull === null
  ) {
    throw new Error('expected manual Advisor stage');
  }
  return stage;
}

export function manualAdvisorIwRequest(
  setup: ManualWizardSetup,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  manualFacesOrNull: readonly [number, number] | null,
): ManualAdvisorIwRollCommandRequest {
  const stage = manualStage(current);
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      advisorInstanceDraftId: stage.advisorInstanceDraftIdOrNull!,
      characterDraftId: setup.characterDraftId,
      compositionDraftRevision: stage.compositionDraftRevision,
      draftRevision: current.receipt.result.draftRevision,
      manualFacesOrNull,
      pendingRollRequestIds: stage.iwRollRequestIdsOrNull!,
      sourceFormId: 'CHR-041',
      stage: 'SYMBIONTS',
      variant: 'ADVISOR_IW',
      wizardCheckpointId: setup.wizardCheckpointId,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  };
}

export function manualAdvisorSkillRequest(
  setup: ManualWizardSetup,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  selectedSkills: readonly SelectedSkillCommandInput[],
): ManualAdvisorSkillCheckpointCommandRequest {
  const stage = manualStage(current);
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      advisorInstanceDraftId: stage.advisorInstanceDraftIdOrNull!,
      characterDraftId: setup.characterDraftId,
      compositionDraftRevision: stage.compositionDraftRevision,
      draftRevision: current.receipt.result.draftRevision,
      selectedSkills,
      sourceFormId: 'CHR-041',
      stage: 'SYMBIONTS',
      variant: 'MANUAL_ADVISOR_SKILLS',
      wizardCheckpointId: setup.wizardCheckpointId,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  };
}

export function manualAdvisorFloorRollRequest(
  setup: ManualWizardSetup,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  manualFaceOrNull: number | null,
): AdvisorIntelligenceFloorRollCommandRequest {
  const stage = advisorIntelligenceFloorStageFromCheckpoint(current);
  if (stage === null || stage.pendingRollRequestIdOrNull === null) {
    throw new Error('expected pending manual Advisor B');
  }
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      advisorInstanceDraftId: stage.advisorInstanceDraftId,
      characterDraftId: setup.characterDraftId,
      compositionDraftRevision: stage.compositionDraftRevision,
      draftRevision: current.receipt.result.draftRevision,
      manualFaceOrNull,
      pendingRollRequestId: stage.pendingRollRequestIdOrNull,
      sourceFormId: 'CHR-041',
      stage: 'SYMBIONTS',
      variant: 'TROGR_SUPPRESSION_B',
      wizardCheckpointId: setup.wizardCheckpointId,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  };
}

export function exactManualAdvisorSkills(
  current: DurableCreationWizardCheckpoint,
  presentation: CreationSkillCatalog,
): readonly SelectedSkillCommandInput[] {
  const stage = manualStage(current);
  const advisorIw = stage.advisorIwRecordOrNull?.receipt.result.advisorIw;
  if (advisorIw === undefined) throw new Error('expected committed manual I/W');
  const stats = deriveCreationSkillStageResult(current, CATALOG.skillStage).skillStageStats;
  const options = createAdvisorSkillOptions(CATALOG, presentation, advisorIw, {
    S: stats.S,
    D: stats.D,
    M: stats.M,
    Z: stats.Z,
    C: stats.C,
  });
  let remaining = options.requiredSlotCount;
  const selected: SelectedSkillCommandInput[] = [];
  for (const candidate of options.skillOptions) {
    let level;
    for (const option of candidate.levelOptions) {
      if (option.slotCost <= remaining) level = option;
    }
    if (level === undefined) continue;
    selected.push({ skillId: candidate.skillId, targetBonus: level.targetBonus });
    remaining -= level.slotCost;
    if (remaining === 0) break;
  }
  if (remaining !== 0) throw new Error('manual Advisor fixture could not fill exact slots');
  return selected;
}
