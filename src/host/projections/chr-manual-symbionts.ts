import type { ActionKey } from '@generated/types/atlas.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import type { JsonObject } from '@shared/wire-protocol.js';

import {
  calculateSkillSlotCost,
  createSymbiontInteractionProjection,
  createSymbiontPlayerCatalog,
  deriveSymbiontModifierBreakdown,
  type SymbiontCatalog,
  type SymbiontComposition,
  type SymbiontSpeciesKey,
  type ValidatedManualComposition,
} from '../../domain/index.js';
import {
  advisorSuppressedByTrogr,
  ADVISOR_INTELLIGENCE_FLOOR_PURPOSE,
} from '../creation-advisor-intelligence-floor-contract.js';
import { latestManualCompositionRecord } from '../creation-manual-composition-contract.js';
import {
  manualAdvisorWorkPending,
  manualCompositionRevision,
  manualInteractionPreview,
} from '../creation-manual-composition-navigation.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';
import type { CreationSkillCatalog } from '../creation-skill-catalog.js';
import { deriveCreationSkillStageResult } from '../creation-stat-assignment.js';
import { symbiontBindingsJson } from '../creation-symbiont-contract.js';
import { createAdvisorSkillOptions } from '../symbiont-stage-catalog.js';
import type { SymbiontMediaPreview } from '../symbiont-media.js';
import {
  advisorSelectionValidation,
  advisorSkillOptionsJson,
  modifierBreakdownJson,
  modifierEffectJson,
  CHR_017_FORM_ID,
  CHR_017_REQUIRED_FIELDS,
  CHR_017_ROUTE,
  CHR_019_FORM_ID,
  CHR_019_REQUIRED_FIELDS,
  CHR_019_ROUTE,
  CHR_041_FORM_ID,
  CHR_041_REQUIRED_FIELDS,
  CHR_041_ROUTE,
} from './chr-symbionts.js';

export const CHR_018_FORM_ID = 'CHR-018' as const;
export const CHR_042_FORM_ID = 'CHR-042' as const;
export const CHR_018_ROUTE =
  '/player/characters/:localCharacterId/create/chr-018/:speciesKey' as const;
export const CHR_042_ROUTE = '/player/characters/:localCharacterId/create/chr-042' as const;
export const CHR_018_REQUIRED_FIELDS = [
  'characterDraftId',
  'speciesKey',
  'artAndTreePreview',
  'slotCost',
  'compatibility',
  'bindingKind=OWL_EYE|EEL_ARM|FIXED|NONE',
  'bindingChoiceOrReadOnly',
  'compositionDraftRevision',
] as const;
export const CHR_042_REQUIRED_FIELDS = [
  'characterDraftId',
  'compositionBefore',
  'compositionAfter',
  'interactionGraph',
  'suppressionDestructionAbsorption',
  'slotStatOeDiff',
  'irreversibleOperationIds[]',
  'confirmationStatus',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_017_MANUAL_COMPOSITION_ACTION_KEY =
  'CHR-017::CTA::002' as const satisfies ActionKey;
export const CHR_017_CARD_ACTION_KEY = 'CHR-017::CTA::001' as const satisfies ActionKey;
export const CHR_018_RETURN_ACTION_KEY = 'CHR-018::CTA::002' as const satisfies ActionKey;
export const CHR_019_PREVIEW_ACTION_KEY = 'CHR-019::CTA::002' as const satisfies ActionKey;
export const CHR_019_RETURN_ACTION_KEY = 'CHR-019::CTA::004' as const satisfies ActionKey;
export const CHR_042_RETURN_ACTION_KEY = 'CHR-042::CTA::002' as const satisfies ActionKey;
const CHR_018_ADD_ACTION = 'CHR-018::CTA::001' as const satisfies ActionKey;
const CHR_018_BINDING_ACTION = 'CHR-018::CTA::003' as const satisfies ActionKey;
const ADVISOR_CONFIRM_ACTION = 'CHR-041::CTA::001' as const satisfies ActionKey;
const ADVISOR_DRAFT_ACTION = 'CHR-041::CTA::002' as const satisfies ActionKey;
const ADVISOR_IW_ACTION = 'CHR-041::CTA::003' as const satisfies ActionKey;
const ADVISOR_B_ACTION = 'CHR-041::CTA::004' as const satisfies ActionKey;

function presentation(
  checkpoint: DurableCreationWizardCheckpoint,
  formId: 'CHR-017' | 'CHR-018' | 'CHR-019' | 'CHR-041' | 'CHR-042',
  route: string,
  availableActionKeys: readonly ActionKey[],
  roleFilteredPayload: JsonObject,
): PresentedBaseForm {
  return {
    availableActionKeys,
    formId,
    formType: 'screen',
    roleFilteredPayload,
    routeBindings:
      checkpoint.symbiontPresentationStage?.routeBindings ??
      checkpoint.nextStageEnvelope.routeBindings,
    routeTemplate: route,
  };
}

function stage(checkpoint: DurableCreationWizardCheckpoint) {
  const stage = checkpoint.manualCompositionStage;
  if (stage === null || stage === undefined) throw new Error('manual composition stage is missing');
  return stage;
}

function species(
  catalog: SymbiontCatalog,
  speciesKey: SymbiontSpeciesKey,
): SymbiontCatalog['species'][number] {
  const value = catalog.species.find((candidate) => candidate.speciesKey === speciesKey);
  if (value === undefined) throw new Error(`unknown manual symbiont ${JSON.stringify(speciesKey)}`);
  return value;
}

function compositionJson(
  catalog: SymbiontCatalog,
  composition: SymbiontComposition,
  bindings: ValidatedManualComposition['bindings'],
): JsonObject {
  return {
    symbiontInstancesDraft: composition.instances.map((instance) => ({
      acceptedIndex: instance.acceptedIndex,
      speciesKey: instance.speciesKey,
      speciesLabel: species(catalog, instance.speciesKey).speciesLabel,
      status: instance.status,
      slotCost: instance.slotCost,
      currentOe: instance.currentOe,
      absorbedSpeciesKeys: instance.absorbedSpeciesKeys,
    })),
    speciesKeys: composition.acceptedSpecies.map((accepted) => accepted.speciesKey),
    bindings: symbiontBindingsJson(bindings),
    slotUsageAndCapacity: { used: composition.slotUsage, capacity: composition.slotCapacity },
  };
}

export function projectManualChr017(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
): PresentedBaseForm {
  const raceChoice = checkpoint.raceAndMethodStage?.race?.value;
  if (raceChoice === undefined) throw new Error('CHR-017 lacks raceChoice');
  const playerCatalog = createSymbiontPlayerCatalog(catalog, raceChoice);
  const current = checkpoint.manualCompositionStage;
  const latest = current?.compositionRecords.at(-1);
  const actions: ActionKey[] = [CHR_017_CARD_ACTION_KEY];
  if (current !== null && current !== undefined && !manualAdvisorWorkPending(current)) {
    actions.push(CHR_017_MANUAL_COMPOSITION_ACTION_KEY);
  }
  return presentation(checkpoint, CHR_017_FORM_ID, CHR_017_ROUTE, actions, {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    raceChoice,
    symbiontAcquisitionModeOrNull: 'MANUAL',
    eligibleSymbiontSpecies: playerCatalog.eligibleSymbiontSpecies.map((entry) => ({
      speciesKey: entry.speciesKey,
      speciesLabel: entry.speciesLabel,
      kind: entry.kind,
      slotCost: entry.slotCost,
      linkedStatCodes: entry.linkedStatCodes,
      bindingPolicy: entry.bindingPolicy,
      statModifiers: entry.statModifiers,
    })),
    manualCompositionDraft:
      latest?.bindings.map((binding) => ({
        acceptedIndex: binding.acceptedIndex,
        speciesKey: binding.speciesKey,
        binding: binding.binding,
      })) ?? [],
    slotCapacity: playerCatalog.slotCapacity,
    selectedSpeciesOrNull:
      checkpoint.symbiontPresentationStage?.formId === CHR_018_FORM_ID
        ? (checkpoint.symbiontPresentationStage.routeBindings[1]?.value ?? null)
        : null,
    pureNoSymbiontRoute: raceChoice === 'PURE',
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
    draftRevision: checkpoint.receipt.result.draftRevision,
  });
}

function bindingKind(policy: SymbiontCatalog['species'][number]['bindingPolicy']): string {
  if (policy === 'OWL_EYE' || policy === 'EEL_ARM') return policy;
  return policy === 'NONE' ? 'NONE' : 'FIXED';
}

function compatibility(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
  speciesKey: SymbiontSpeciesKey,
): string {
  const current = checkpoint.manualCompositionStage?.composition;
  const candidate = species(catalog, speciesKey);
  if (current?.acceptedSpecies.some((accepted) => accepted.speciesKey === speciesKey) === true) {
    return 'DUPLICATE';
  }
  if (candidate.kind === 'SYMBIOTIC_MONSTER' && (current?.acceptedSpecies.length ?? 0) > 0) {
    return 'MONSTER_EXCLUSIVE';
  }
  if (
    current?.instances.some(
      (instance) =>
        instance.speciesKey === 'CHIMERA' ||
        instance.speciesKey === 'PUPPETEER' ||
        instance.speciesKey === 'PLAGUE_DOCTOR',
    ) === true
  ) {
    return 'MONSTER_EXCLUSIVE';
  }
  // The command validates a full replacement, not an incremental addition to this baseline.
  return 'COMPATIBLE';
}

export function projectManualChr018(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
  media: ReadonlyMap<SymbiontSpeciesKey, SymbiontMediaPreview>,
  checkpointCapable: boolean,
): PresentedBaseForm {
  const signed = checkpoint.symbiontPresentationStage;
  const speciesKey =
    signed?.formId === CHR_018_FORM_ID ? signed.routeBindings[1]?.value : undefined;
  if (speciesKey === undefined) throw new Error('CHR-018 lacks its signed speciesKey');
  const key = speciesKey as SymbiontSpeciesKey;
  const currentSpecies = species(catalog, key);
  const preview = media.get(key);
  if (preview === undefined) throw new Error(`CHR-018 lacks verified media for ${speciesKey}`);
  const status = compatibility(checkpoint, catalog, key);
  const actions: ActionKey[] = [];
  if (checkpointCapable && status === 'COMPATIBLE') actions.push(CHR_018_ADD_ACTION);
  actions.push(CHR_018_RETURN_ACTION_KEY);
  if (currentSpecies.bindingPolicy === 'OWL_EYE' || currentSpecies.bindingPolicy === 'EEL_ARM') {
    actions.push(CHR_018_BINDING_ACTION);
  }
  return presentation(checkpoint, CHR_018_FORM_ID, CHR_018_ROUTE, actions, {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    speciesKey: key,
    artAndTreePreview: {
      artPath: preview.artPath,
      developmentTreePath: preview.developmentTreePath,
    },
    slotCost: currentSpecies.slotCost,
    compatibility: { kind: status },
    bindingKind: bindingKind(currentSpecies.bindingPolicy),
    bindingChoiceOrReadOnly:
      currentSpecies.bindingPolicy === 'OWL_EYE' || currentSpecies.bindingPolicy === 'EEL_ARM'
        ? { kind: 'CHOICE', options: ['LEFT', 'RIGHT'], defaultSide: 'RIGHT' }
        : { kind: 'READ_ONLY', binding: { kind: currentSpecies.bindingPolicy } },
    compositionDraftRevision: manualCompositionRevision(checkpoint),
  });
}

export function projectManualChr019(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
): PresentedBaseForm {
  const current = stage(checkpoint);
  if (manualAdvisorWorkPending(current)) throw new Error('CHR-019 has pending Advisor work');
  const latest = current.compositionRecords.at(-1)!;
  const interactions = createSymbiontInteractionProjection(current.composition);
  const previewRequired =
    current.compositionRecords.length > 1 &&
    manualInteractionPreview(checkpoint, catalog).irreversibleOperationIds.length > 0;
  const actions: ActionKey[] = [];
  if (previewRequired) actions.push(CHR_019_PREVIEW_ACTION_KEY);
  actions.push(CHR_019_RETURN_ACTION_KEY);
  return presentation(checkpoint, CHR_019_FORM_ID, CHR_019_ROUTE, actions, {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    raceChoice: current.composition.raceCode,
    ...compositionJson(catalog, current.composition, latest.bindings),
    interactionGraph: interactions.interactionGraph,
    duplicatePolicy: { kind: 'FORBIDDEN' },
    suppressionDestructionAbsorptionPreview: interactions.suppressionDestructionAbsorptionPreview,
    compositionValidation: 'VALID',
    randomReceiptIds:
      current.diceInputModeSnapshot === 'AUTO'
        ? [
            ...(current.advisorIwRecordOrNull?.physicalRolls.map((roll) => roll.rollReceiptId) ??
              []),
            ...(current.suppressionRollRecordOrNull === null
              ? []
              : [current.suppressionRollRecordOrNull.receipt.receiptId]),
          ]
        : [],
    irreversibleBoundaryStatus: 'NOT_CROSSED',
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
    draftRevision: checkpoint.receipt.result.draftRevision,
    commandId: latestManualCompositionRecord(current)?.request.commandId ?? null,
    symbiontModifierBreakdown: modifierBreakdownJson(
      deriveSymbiontModifierBreakdown(catalog, current.composition, {
        equippedHermeticNate: false,
      }),
    ),
  });
}

export function projectManualChr041(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
  presentationCatalog: CreationSkillCatalog,
  checkpointCapable: boolean,
  rollCommitCapable: boolean,
): PresentedBaseForm {
  const current = stage(checkpoint);
  if (!current.composition.acceptedSpecies.some((accepted) => accepted.speciesKey === 'ADVISER')) {
    throw new Error('CHR-041 lacks its current Advisor');
  }
  const iw = current.advisorIwRecordOrNull;
  const acknowledged = current.advisorSkillRecordOrNull !== null;
  const pendingB = current.pendingSuppressionRollRequestIdOrNull !== null;
  const actions: ActionKey[] = [];
  if (iw === null) {
    if (rollCommitCapable) actions.push(ADVISOR_IW_ACTION);
  } else {
    if (pendingB && rollCommitCapable) actions.push(ADVISOR_B_ACTION);
    if (!acknowledged) {
      if (!pendingB && checkpointCapable) actions.push(ADVISOR_CONFIRM_ACTION);
      actions.push(ADVISOR_DRAFT_ACTION);
    }
  }
  const stats = deriveCreationSkillStageResult(checkpoint, catalog.skillStage).skillStageStats;
  const options =
    iw === null
      ? null
      : createAdvisorSkillOptions(catalog, presentationCatalog, iw.receipt.result.advisorIw, {
          S: stats.S,
          D: stats.D,
          M: stats.M,
          Z: stats.Z,
          C: stats.C,
        });
  const selected = current.advisorSkillRecordOrNull?.selectedSkills ?? [];
  const b = current.suppressionRollRecordOrNull;
  const suppressed = advisorSuppressedByTrogr(current.composition);
  return presentation(checkpoint, CHR_041_FORM_ID, CHR_041_ROUTE, actions, {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    advisorInstanceDraftId: current.advisorInstanceDraftIdOrNull,
    advisorCard: {
      speciesKey: 'ADVISER',
      effectsActive: !suppressed,
      advisorIPlus8: iw?.receipt.result.advisorIw.I.value ?? null,
      advisorWPlus8: iw?.receipt.result.advisorIw.W.value ?? null,
    },
    iwRollRequestIds: current.iwRollRequestIdsOrNull,
    iwRollReceiptIds:
      iw === null
        ? [null, null]
        : [iw.physicalRolls[0].rollReceiptId, iw.physicalRolls[1].rollReceiptId],
    advisorIPlus8OrNull: iw?.receipt.result.advisorIw.I.value ?? null,
    advisorWPlus8OrNull: iw?.receipt.result.advisorIw.W.value ?? null,
    advisorSlotsAndSkills:
      options === null
        ? { kind: 'IW_ROLLS_REQUIRED' }
        : {
            requiredSlotCount: options.requiredSlotCount,
            skillOptions: advisorSkillOptionsJson(options),
            selectedSkills: selected.map((selection) => ({
              skillId: selection.skillId,
              targetBonus: selection.targetBonus,
              slotCost: calculateSkillSlotCost(selection.targetBonus),
            })),
            selectionValidation: advisorSelectionValidation(selected, options.requiredSlotCount),
          },
    trogrSuppressionState: suppressed
      ? {
          kind: 'SUPPRESSED',
          suppressionBOrNull: b?.receipt.result.suppressionB ?? null,
          minimumIOrNull: b?.receipt.result.minimumI ?? null,
          rollPurpose: ADVISOR_INTELLIGENCE_FLOOR_PURPOSE,
          rollRequestIdOrNull:
            b?.physicalRoll.rollRequestId ?? current.pendingSuppressionRollRequestIdOrNull,
          rollReceiptIdOrNull: b?.physicalRoll.rollReceiptId ?? null,
        }
      : { kind: 'NOT_SUPPRESSED' },
    acknowledged,
    compositionDraftRevision: current.compositionDraftRevision,
    diceInputModeSnapshot: current.diceInputModeSnapshot,
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
    draftRevision: checkpoint.receipt.result.draftRevision,
    commandId: latestManualCompositionRecord(current)?.request.commandId ?? null,
  });
}

export function projectManualChr042(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
): PresentedBaseForm {
  const current = stage(checkpoint);
  if (manualAdvisorWorkPending(current)) throw new Error('CHR-042 has pending Advisor work');
  const preview = manualInteractionPreview(checkpoint, catalog);
  if (preview.irreversibleOperationIds.length === 0) {
    throw new Error('CHR-042 requires a confirmation-required interaction');
  }
  return presentation(checkpoint, CHR_042_FORM_ID, CHR_042_ROUTE, [CHR_042_RETURN_ACTION_KEY], {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    compositionBefore: compositionJson(
      catalog,
      preview.compositionBefore.composition,
      preview.compositionBefore.bindings,
    ),
    compositionAfter: compositionJson(
      catalog,
      preview.compositionAfter.composition,
      preview.compositionAfter.bindings,
    ),
    interactionGraph: preview.interactionGraph,
    suppressionDestructionAbsorption: preview.suppressionDestructionAbsorption,
    slotStatOeDiff: {
      slotUsageBefore: preview.slotStatOeDiff.slotUsageBefore,
      slotUsageAfter: preview.slotStatOeDiff.slotUsageAfter,
      entries: preview.slotStatOeDiff.entries.map((entry) => ({
        speciesKey: entry.speciesKey,
        before:
          entry.before === null
            ? null
            : {
                slotCost: entry.before.slotCost,
                currentOe: entry.before.currentOe,
                status: entry.before.status,
              },
        after:
          entry.after === null
            ? null
            : {
                slotCost: entry.after.slotCost,
                currentOe: entry.after.currentOe,
                status: entry.after.status,
              },
      })),
      modifierBreakdownBefore: modifierEffectJson(preview.slotStatOeDiff.modifierBreakdownBefore),
      modifierBreakdownAfter: modifierEffectJson(preview.slotStatOeDiff.modifierBreakdownAfter),
    },
    irreversibleOperationIds: preview.irreversibleOperationIds,
    confirmationStatus: 'PREVIEW',
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
    draftRevision: checkpoint.receipt.result.draftRevision,
    commandId: current.compositionRecords.at(-1)!.request.commandId,
  });
}

export function assertManualSymbiontScreenContracts(
  forms: Readonly<Record<string, unknown>>,
  assert: (
    forms: Readonly<Record<string, unknown>>,
    formId: string,
    requiredFields: readonly string[],
    route: string,
    formType?: 'dialog' | 'screen',
  ) => void,
): void {
  assert(forms, CHR_018_FORM_ID, CHR_018_REQUIRED_FIELDS, CHR_018_ROUTE);
  assert(forms, CHR_042_FORM_ID, CHR_042_REQUIRED_FIELDS, CHR_042_ROUTE);
}

export {
  CHR_017_FORM_ID,
  CHR_017_REQUIRED_FIELDS,
  CHR_017_ROUTE,
  CHR_019_FORM_ID,
  CHR_019_REQUIRED_FIELDS,
  CHR_019_ROUTE,
  CHR_041_FORM_ID,
  CHR_041_REQUIRED_FIELDS,
  CHR_041_ROUTE,
};
