import type { ActionKey } from '@generated/types/atlas.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import type { JsonObject } from '@shared/wire-protocol.js';

import {
  calculateSkillSlotCost,
  createSymbiontInteractionProjection,
  createSymbiontPlayerCatalog,
  deriveSymbiontModifierBreakdown,
  type RandomSymbiontStatus,
  type SymbiontCatalog,
  type SymbiontModifierBreakdown,
  type SymbiontStatModifierEffect,
} from '../../domain/index.js';
import {
  CHR_020_FORM_ID,
  CHR_041_FORM_ID,
  randomSymbiontStatus,
  resolveSymbiontStage,
  symbiontBindingsJson,
  symbiontPhysicalRollJson,
  type RandomSymbiontStage,
} from '../creation-symbiont-contract.js';
export { CHR_020_FORM_ID, CHR_041_FORM_ID } from '../creation-symbiont-contract.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';
import type { CreationSkillCatalog } from '../creation-skill-catalog.js';
import type { SelectedSkillCommandInput } from '../creation-skill-selection.js';
import { createAdvisorSkillOptions } from '../symbiont-stage-catalog.js';
import { deriveCreationSkillStageResult } from '../creation-stat-assignment.js';

export const CHR_017_FORM_ID = 'CHR-017' as const;
export const CHR_019_FORM_ID = 'CHR-019' as const;
export const CHR_017_ROUTE = '/player/characters/:localCharacterId/create/chr-017' as const;
export const CHR_019_ROUTE = '/player/characters/:localCharacterId/create/chr-019' as const;
export const CHR_020_ROUTE = '/player/characters/:localCharacterId/create/chr-020' as const;
export const CHR_041_ROUTE = '/player/characters/:localCharacterId/create/chr-041' as const;

export const CHR_017_REQUIRED_FIELDS = [
  'characterDraftId',
  'raceChoice',
  'symbiontAcquisitionModeOrNull',
  'eligibleSymbiontSpecies[]',
  'manualCompositionDraft[]',
  'slotCapacity',
  'selectedSpeciesOrNull',
  'pureNoSymbiontRoute',
  'wizardCheckpointId',
  'draftRevision',
] as const;
export const CHR_020_REQUIRED_FIELDS = [
  'characterDraftId',
  'raceChoice=UNITED|FREE',
  'symbiontAcquisitionMode=RANDOM',
  'randomSequenceId',
  'pendingRollRequestIdOrNull',
  'diceInputModeSnapshot',
  'seedOrManualFaces',
  'drawnSpeciesAndBindings[]',
  'duplicateRerollReceipts[]',
  'advisorBranch',
  'randomStatus=NOT_STARTED|PENDING|BINDING|COMMITTED',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_041_REQUIRED_FIELDS = [
  'characterDraftId',
  'advisorInstanceDraftId',
  'advisorCard',
  'iwRollRequestIds[2]',
  'iwRollReceiptIds[2]OrNull',
  'advisorIPlus8OrNull',
  'advisorWPlus8OrNull',
  'advisorSlotsAndSkills',
  'trogrSuppressionState',
  'acknowledged',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_019_REQUIRED_FIELDS = [
  'characterDraftId',
  'raceChoice',
  'symbiontInstancesDraft[]',
  'speciesKeys[]',
  'bindings[]',
  'slotUsageAndCapacity',
  'interactionGraph',
  'duplicatePolicy',
  'suppressionDestructionAbsorptionPreview',
  'compositionValidation',
  'randomReceiptIds[]',
  'irreversibleBoundaryStatus',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

export const CHR_017_RANDOM_START_ACTION_KEY = 'CHR-017::CTA::003' as const satisfies ActionKey;
const RANDOM_START_ACTION = CHR_017_RANDOM_START_ACTION_KEY;
const ROLL_ACTION = 'CHR-020::CTA::002' as const satisfies ActionKey;
const SIDE_ACTION = 'CHR-020::CTA::003' as const satisfies ActionKey;
const MONSTER_ACTION = 'CHR-020::CTA::004' as const satisfies ActionKey;
const ADVISOR_CONFIRM_ACTION = 'CHR-041::CTA::001' as const satisfies ActionKey;
const ADVISOR_DRAFT_ACTION = 'CHR-041::CTA::002' as const satisfies ActionKey;

function stage(checkpoint: DurableCreationWizardCheckpoint): RandomSymbiontStage {
  const value = checkpoint.randomSymbiontStage;
  if (value === null) throw new Error('random symbiont stage is missing');
  return value;
}

function bindings(checkpoint: DurableCreationWizardCheckpoint) {
  return checkpoint.nextStageEnvelope.routeBindings;
}

function presentation(
  formId: 'CHR-017' | 'CHR-019' | 'CHR-020' | 'CHR-041',
  route: string,
  availableActionKeys: readonly ActionKey[],
  roleFilteredPayload: JsonObject,
  checkpoint: DurableCreationWizardCheckpoint,
): PresentedBaseForm {
  return {
    availableActionKeys,
    formId,
    formType: 'screen',
    roleFilteredPayload,
    routeBindings: bindings(checkpoint),
    routeTemplate: route,
  };
}

export function projectChr017(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
): PresentedBaseForm {
  const raceChoice = checkpoint.raceAndMethodStage?.race?.value;
  if (raceChoice === undefined) throw new Error('CHR-017 lacks committed raceChoice');
  const playerCatalog = createSymbiontPlayerCatalog(catalog, raceChoice);
  const acquisition = checkpoint.raceAndMethodStage?.symbiontAcquisition.value ?? null;
  return presentation(
    CHR_017_FORM_ID,
    CHR_017_ROUTE,
    acquisition === 'RANDOM' ? [RANDOM_START_ACTION] : [],
    {
      characterDraftId: checkpoint.localCharacter.localCharacterId,
      raceChoice,
      symbiontAcquisitionModeOrNull: acquisition,
      eligibleSymbiontSpecies: playerCatalog.eligibleSymbiontSpecies.map((species) => ({
        speciesKey: species.speciesKey,
        speciesLabel: species.speciesLabel,
        kind: species.kind,
        slotCost: species.slotCost,
        linkedStatCodes: species.linkedStatCodes,
        bindingPolicy: species.bindingPolicy,
        statModifiers: species.statModifiers,
      })),
      manualCompositionDraft: [],
      slotCapacity: playerCatalog.slotCapacity,
      selectedSpeciesOrNull: null,
      pureNoSymbiontRoute: raceChoice === 'PURE',
      wizardCheckpointId: checkpoint.checkpoint.checkpointId,
      draftRevision: checkpoint.receipt.result.draftRevision,
    },
    checkpoint,
  );
}

function sideAvailable(status: RandomSymbiontStatus): boolean {
  return status === 'NOT_STARTED' || status === 'PENDING' || status === 'BINDING';
}

export function projectChr020(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
  rollCommitCapable: boolean,
): PresentedBaseForm {
  const current = stage(checkpoint);
  const resolved = resolveSymbiontStage(catalog, current);
  const status = randomSymbiontStatus(resolved, current.pendingRollRequestOrNull);
  const next = resolved.nextRequest;
  const actions: ActionKey[] = [];
  if (rollCommitCapable && status !== 'COMMITTED') actions.push(ROLL_ACTION);
  if (
    sideAvailable(status) &&
    resolved.accepted.some((entry) => entry.speciesKey === 'OWL' || entry.speciesKey === 'EEL')
  ) {
    actions.push(SIDE_ACTION);
  }
  if (next.kind === 'CRITICAL_CONFIRMATION' && next.monsterEligible) actions.push(MONSTER_ACTION);
  const latestCommandId =
    current.bindingRecordOrNull?.request.commandId ??
    current.rollRecords.at(-1)?.request.commandId ??
    null;
  return presentation(
    CHR_020_FORM_ID,
    CHR_020_ROUTE,
    actions,
    {
      characterDraftId: checkpoint.localCharacter.localCharacterId,
      raceChoice: current.raceCode,
      symbiontAcquisitionMode: 'RANDOM',
      randomSequenceId: current.randomSequenceId,
      pendingRollRequestIdOrNull: current.pendingRollRequestOrNull?.rollRequestId ?? null,
      diceInputModeSnapshot: current.diceInputModeSnapshot,
      seedOrManualFaces: {
        kind: 'D20_RESULTS',
        entries: current.rollRecords.map((record) => symbiontPhysicalRollJson(record.physicalRoll)),
      },
      drawnSpeciesAndBindings: symbiontBindingsJson(resolved.drawnSpeciesAndBindings),
      duplicateRerollReceipts: resolved.duplicateRerollReceipts.map((receipt) => ({
        rollRequestId: receipt.rollRequestId,
        rollReceiptId: receipt.rollReceiptId,
        speciesKey: receipt.speciesKey,
        duplicateOfAcceptedIndex: receipt.duplicateOfAcceptedIndex,
      })),
      advisorBranch: resolved.advisorOrNull !== null,
      randomStatus: status,
      wizardCheckpointId: checkpoint.checkpoint.checkpointId,
      draftRevision: checkpoint.receipt.result.draftRevision,
      commandId: latestCommandId,
    },
    checkpoint,
  );
}

function advisorSelectionValidation(
  selectedSkills: readonly SelectedSkillCommandInput[],
  requiredSlotCount: number,
): JsonObject {
  const usedSlotCount = selectedSkills.reduce(
    (total, selection) => total + calculateSkillSlotCost(selection.targetBonus),
    0,
  );
  if (usedSlotCount < requiredSlotCount) {
    return {
      kind: 'UNDERFILLED',
      requiredSlotCount,
      usedSlotCount,
      missingSlotCount: requiredSlotCount - usedSlotCount,
    };
  }
  if (usedSlotCount > requiredSlotCount) {
    return {
      kind: 'OVERFILLED',
      requiredSlotCount,
      usedSlotCount,
      excessSlotCount: usedSlotCount - requiredSlotCount,
    };
  }
  return { kind: 'EXACT', requiredSlotCount, usedSlotCount };
}

function advisorSkillOptionsJson(
  options: ReturnType<typeof createAdvisorSkillOptions>,
): readonly JsonObject[] {
  return options.skillOptions.map((option) => ({
    skillId: option.skillId,
    skillLabel: option.skillLabel,
    bonusDomainScope: option.bonusDomainScope,
    missingSkillPenalty:
      option.missingSkillPenalty.kind === 'NO_MISSING_SKILL_PENALTY'
        ? { kind: option.missingSkillPenalty.kind }
        : {
            kind: option.missingSkillPenalty.kind,
            value: option.missingSkillPenalty.value,
          },
    requirements: option.requirements.map((requirement) => ({
      statCode: requirement.statCode,
      statLabel: requirement.statLabel,
      minValue: requirement.minValue,
      currentValue: requirement.currentValue,
      satisfied: requirement.satisfied,
    })),
    levelOptions: option.levelOptions.map((level) => ({
      targetBonus: level.targetBonus,
      slotCost: level.slotCost,
    })),
  }));
}

function modifierEffectJson(
  effect: SymbiontStatModifierEffect | Readonly<{ kind: 'INACTIVE' }>,
): JsonObject {
  if (effect.kind !== 'ADDITIVE_STAT_MODIFIERS') return { kind: effect.kind };
  return {
    kind: effect.kind,
    entries: effect.entries.map((entry) => ({
      statCode: entry.statCode,
      statLabel: entry.statLabel,
      delta: entry.delta,
    })),
  };
}

function modifierBreakdownJson(breakdown: SymbiontModifierBreakdown): JsonObject {
  return {
    bySpecies: breakdown.bySpecies.map((entry) => ({
      acceptedIndex: entry.acceptedIndex,
      speciesKey: entry.speciesKey,
      speciesLabel: entry.speciesLabel,
      status: entry.status,
      effect: modifierEffectJson(entry.effect),
    })),
    total: modifierEffectJson(breakdown.total),
  };
}

export function projectChr041(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
  presentationCatalog: CreationSkillCatalog,
  checkpointCapable: boolean,
): PresentedBaseForm {
  const current = stage(checkpoint);
  const resolved = resolveSymbiontStage(catalog, current);
  const advisor = resolved.advisorOrNull;
  const advisorInstanceDraftId = current.advisorInstanceDraftIdOrNull;
  if (advisor === null || advisorInstanceDraftId === null || advisor.advisorIwOrNull === null) {
    throw new Error('CHR-041 lacks its persisted Advisor and I/W results');
  }
  const stats = deriveCreationSkillStageResult(checkpoint, catalog.skillStage).skillStageStats;
  const options = createAdvisorSkillOptions(catalog, presentationCatalog, advisor.advisorIwOrNull, {
    S: stats.S,
    D: stats.D,
    M: stats.M,
    Z: stats.Z,
    C: stats.C,
  });
  const selected = current.advisorSkillRecordOrNull?.selectedSkills ?? [];
  const acknowledged = current.advisorSkillRecordOrNull !== null;
  return presentation(
    CHR_041_FORM_ID,
    CHR_041_ROUTE,
    acknowledged
      ? []
      : [...(checkpointCapable ? [ADVISOR_CONFIRM_ACTION] : []), ADVISOR_DRAFT_ACTION],
    {
      characterDraftId: checkpoint.localCharacter.localCharacterId,
      advisorInstanceDraftId,
      advisorCard: {
        speciesKey: 'ADVISER',
        effectsActive: advisor.effectsActive,
        advisorIPlus8: advisor.advisorIPlus8OrNull,
        advisorWPlus8: advisor.advisorWPlus8OrNull,
      },
      iwRollRequestIds: advisor.iwRollRequestIds,
      iwRollReceiptIds: advisor.iwRollReceiptIds,
      advisorIPlus8OrNull: advisor.advisorIPlus8OrNull,
      advisorWPlus8OrNull: advisor.advisorWPlus8OrNull,
      advisorSlotsAndSkills: {
        requiredSlotCount: options.requiredSlotCount,
        skillOptions: advisorSkillOptionsJson(options),
        selectedSkills: selected.map((selection) => ({
          skillId: selection.skillId,
          targetBonus: selection.targetBonus,
          slotCost: calculateSkillSlotCost(selection.targetBonus),
        })),
        selectionValidation: advisorSelectionValidation(selected, options.requiredSlotCount),
      },
      trogrSuppressionState:
        advisor.suppressionOrNull === null
          ? { kind: 'NOT_SUPPRESSED' }
          : {
              kind: 'SUPPRESSED',
              suppressionBOrNull: advisor.suppressionOrNull.suppressionBOrNull,
              minimumIOrNull: advisor.suppressionOrNull.minimumIOrNull,
            },
      acknowledged,
      randomSequenceId: current.randomSequenceId,
      wizardCheckpointId: checkpoint.checkpoint.checkpointId,
      draftRevision: checkpoint.receipt.result.draftRevision,
      commandId: current.advisorSkillRecordOrNull?.request.commandId ?? null,
    },
    checkpoint,
  );
}

export function projectChr019(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
): PresentedBaseForm {
  const current = stage(checkpoint);
  const resolved = resolveSymbiontStage(catalog, current);
  if (resolved.randomStatus !== 'COMMITTED') {
    throw new Error('CHR-019 requires committed species and binding snapshots');
  }
  const interactions = createSymbiontInteractionProjection(resolved.composition);
  const latestCommandId =
    current.advisorSkillRecordOrNull?.request.commandId ??
    current.bindingRecordOrNull?.request.commandId ??
    null;
  return presentation(
    CHR_019_FORM_ID,
    CHR_019_ROUTE,
    [],
    {
      characterDraftId: checkpoint.localCharacter.localCharacterId,
      raceChoice: current.raceCode,
      symbiontInstancesDraft: resolved.composition.instances.map((instance) => {
        const species = catalog.species.find(
          (candidate) => candidate.speciesKey === instance.speciesKey,
        );
        if (species === undefined) throw new Error('composition references an unknown species');
        return {
          acceptedIndex: instance.acceptedIndex,
          speciesKey: instance.speciesKey,
          speciesLabel: species.speciesLabel,
          status: instance.status,
          slotCost: instance.slotCost,
          currentOe: instance.currentOe,
          absorbedSpeciesKeys: instance.absorbedSpeciesKeys,
        };
      }),
      speciesKeys: resolved.accepted.map((entry) => entry.speciesKey),
      bindings: symbiontBindingsJson(resolved.drawnSpeciesAndBindings),
      slotUsageAndCapacity: {
        used: resolved.composition.slotUsage,
        capacity: resolved.composition.slotCapacity,
      },
      interactionGraph: interactions.interactionGraph,
      duplicatePolicy: {
        kind: 'REROLL_WITH_SEPARATE_RECEIPTS',
        receipts: resolved.duplicateRerollReceipts.map((receipt) => ({
          rollRequestId: receipt.rollRequestId,
          rollReceiptId: receipt.rollReceiptId,
          speciesKey: receipt.speciesKey,
          duplicateOfAcceptedIndex: receipt.duplicateOfAcceptedIndex,
        })),
      },
      suppressionDestructionAbsorptionPreview: interactions.suppressionDestructionAbsorptionPreview,
      compositionValidation: 'VALID',
      randomReceiptIds: checkpoint.durablePayload.randomReceiptIds,
      irreversibleBoundaryStatus: 'CROSSED',
      wizardCheckpointId: checkpoint.checkpoint.checkpointId,
      draftRevision: checkpoint.receipt.result.draftRevision,
      commandId: latestCommandId,
      symbiontModifierBreakdown: modifierBreakdownJson(
        deriveSymbiontModifierBreakdown(catalog, resolved.composition, {
          equippedHermeticNate: false,
        }),
      ),
    },
    checkpoint,
  );
}

type ScreenContractAssert = (
  forms: Readonly<Record<string, unknown>>,
  formId: string,
  requiredFields: readonly string[],
  route: string,
  formType?: 'dialog' | 'screen',
) => void;

export function assertSymbiontScreenContracts(
  forms: Readonly<Record<string, unknown>>,
  assert: ScreenContractAssert,
): void {
  assert(forms, CHR_017_FORM_ID, CHR_017_REQUIRED_FIELDS, CHR_017_ROUTE);
  assert(forms, CHR_020_FORM_ID, CHR_020_REQUIRED_FIELDS, CHR_020_ROUTE);
  assert(forms, CHR_041_FORM_ID, CHR_041_REQUIRED_FIELDS, CHR_041_ROUTE);
  assert(forms, CHR_019_FORM_ID, CHR_019_REQUIRED_FIELDS, CHR_019_ROUTE);
}
