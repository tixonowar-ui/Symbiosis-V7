import type { AssignedRouteBinding } from '@shared/wire-v2-protocol.js';
import type { JsonObject } from '@shared/wire-protocol.js';

import type { SkillPresentationStage } from '../persistence/skill-presentation.js';

export { parseSkillPresentationStage } from '../persistence/skill-presentation.js';
export type { SkillPresentationStage } from '../persistence/skill-presentation.js';

import {
  calculateSkillSlotCost,
  SkillStageRuleError,
  validateSkillSelectionDraft,
  type SkillStageCatalog,
} from '../domain/index.js';
import type { DurableCreationWizardCheckpoint } from './creation-set-decide.js';
import {
  CreationSkillSelectionApplicationError,
  slotCostOptions,
  type Chr013SkillCatalogView,
  type DurableSelectedSkill,
  type SelectedSkillCommandInput,
  type SelectedSkillView,
  type SkillCheckpointCommandRequest,
  type SkillEligibilityDerived,
  type SkillSelectionCheckpointPayload,
  type SkillSelectionPlan,
} from './creation-skill-selection.js';

export const CHR_014_ROUTE =
  '/player/characters/:localCharacterId/create/chr-014/:skillId' as const;
const CHR_013_ROUTE = '/player/characters/:localCharacterId/create/chr-013' as const;
const CHR_015_ROUTE = '/player/characters/:localCharacterId/create/chr-015' as const;

export interface Chr014SkillCardView extends JsonObject {
  readonly bonusDomainScope: string;
  readonly characterDraftId: string;
  readonly eligibility: 'ELIGIBLE' | 'INELIGIBLE_READ_ONLY';
  readonly eligibleSkillIds: readonly string[];
  readonly freeSources: { readonly kind: 'NO_FREE_SOURCE' };
  readonly levelsAndBonuses: readonly {
    readonly targetBonus: number;
    readonly slotCost: number;
  }[];
  readonly missingSkillPenalty: Chr013SkillCatalogView['skillCardSummaries'][number]['missingSkillPenalty'];
  readonly requirements: Chr013SkillCatalogView['skillCardSummaries'][number]['requirements'];
  readonly selectedSkills: readonly SelectedSkillView[];
  readonly selectionRevision: number;
  readonly skillId: string;
  readonly skillLabel: string;
  readonly skillStageValues: Chr013SkillCatalogView['skillStageStats'];
  readonly slotCost: null;
  readonly slotSources: Chr013SkillCatalogView['slotSources'];
  readonly wizardCheckpointId: string;
}

export interface SkillCardAdditionPreparation {
  readonly eligibility: SkillEligibilityDerived;
  readonly request: SkillCheckpointCommandRequest & {
    readonly payload: SkillSelectionCheckpointPayload;
  };
  readonly selectedSkills: readonly SelectedSkillCommandInput[];
  readonly selectionRevision: number;
  readonly skillId: string;
}

const guardRejected = (): never => {
  throw new CreationSkillSelectionApplicationError({ code: 'GUARD_REJECTED' });
};

const selectedViews = (
  selectedSkills: readonly SelectedSkillCommandInput[],
): readonly SelectedSkillView[] =>
  selectedSkills.map(({ skillId, targetBonus }) => ({
    skillId,
    slotCost: calculateSkillSlotCost(targetBonus),
    targetBonus,
  }));

export function deriveChr014SkillCardView(
  catalog: Chr013SkillCatalogView,
  selectedSkills: readonly SelectedSkillCommandInput[],
  skillId: string,
): Chr014SkillCardView {
  const card = catalog.skillCardSummaries.find((candidate) => candidate.skillId === skillId);
  if (card === undefined) {
    throw new Error(
      `CHR-014 skillId ${JSON.stringify(skillId)} is absent from the inspectable catalog`,
    );
  }
  const selected = selectedViews(selectedSkills);
  const usedSlotCount =
    (catalog.slotSources.mandatoryClassSkillOrNull?.slotCost ?? 0) +
    selected.reduce((total, skill) => total + skill.slotCost, 0);
  return {
    bonusDomainScope: card.bonusDomainScope,
    characterDraftId: catalog.characterDraftId,
    eligibility: card.eligibility === 'ELIGIBLE' ? 'ELIGIBLE' : 'INELIGIBLE_READ_ONLY',
    eligibleSkillIds: catalog.eligibleSkillIds,
    freeSources: { kind: 'NO_FREE_SOURCE' },
    levelsAndBonuses: slotCostOptions(catalog.slotSources.requiredSlotCount - usedSlotCount),
    missingSkillPenalty: card.missingSkillPenalty,
    requirements: card.requirements,
    selectedSkills: selected,
    selectionRevision: catalog.draftRevision,
    skillId: card.skillId,
    skillLabel: card.skillLabel,
    skillStageValues: catalog.skillStageStats,
    slotCost: null,
    slotSources: catalog.slotSources,
    wizardCheckpointId: catalog.wizardCheckpointId,
  };
}

export function prepareSkillCardAddition(
  input: SkillCardAdditionPreparation,
  catalog: SkillStageCatalog,
): SkillSelectionPlan {
  const { eligibility, request, selectedSkills, selectionRevision, skillId } = input;
  if (
    request.payload.sourceFormId !== 'CHR-014' ||
    request.payload.draftRevision !== selectionRevision ||
    !eligibility.eligibleSkillIds.includes(skillId) ||
    request.payload.selectedSkills.length !== selectedSkills.length + 1
  ) {
    return guardRejected();
  }
  const currentById = new Map(selectedSkills.map((selected) => [selected.skillId, selected]));
  if (currentById.size !== selectedSkills.length || currentById.has(skillId)) {
    return guardRejected();
  }
  let additions = 0;
  for (const selected of request.payload.selectedSkills) {
    const current = currentById.get(selected.skillId);
    if (current === undefined) {
      additions += 1;
      if (selected.skillId !== skillId) return guardRejected();
    } else if (current.targetBonus !== selected.targetBonus) {
      return guardRejected();
    }
  }
  if (additions !== 1) return guardRejected();
  const canonicalIndexes = new Map(
    catalog.skills.map(({ skillKey }, index) => [skillKey as string, index]),
  );
  let previousIndex = -1;
  for (const { skillId: selectedId } of request.payload.selectedSkills) {
    const index = canonicalIndexes.get(selectedId);
    if (index === undefined || index <= previousIndex) return guardRejected();
    previousIndex = index;
  }
  const added = request.payload.selectedSkills.find((selected) => selected.skillId === skillId);
  if (added === undefined) return guardRejected();
  const usedBefore = selectedSkills.reduce(
    (total, selected) => total + calculateSkillSlotCost(selected.targetBonus),
    eligibility.mandatoryClassSkillOrNull?.slotCost ?? 0,
  );
  const signedOption = slotCostOptions(eligibility.requiredSlotCount - usedBefore).find(
    (option) => option.targetBonus === added.targetBonus,
  );
  if (signedOption === undefined) return guardRejected();
  try {
    const selection = validateSkillSelectionDraft(catalog, {
      classCode: eligibility.classCodeOrNull,
      raceCode: eligibility.raceCode,
      selectedSkills: request.payload.selectedSkills.map(
        ({ skillId: selectedId, targetBonus }) => ({
          skillKey: selectedId,
          targetBonus,
        }),
      ),
      skillStageStats: eligibility.skillStageStats,
    });
    return {
      derived: {
        learnedSkills: selection.learnedSkills.map(({ source, skillKey, bonus, slotCost }) => ({
          bonus,
          skillKey,
          slotCost,
          source,
        })),
        requiredSlotCount: selection.capacity,
        selectedSkills: request.payload.selectedSkills.map(
          ({ skillId: selectedId, targetBonus }): DurableSelectedSkill => ({
            skillKey: selectedId,
            targetBonus,
          }),
        ),
        usedSlotCount: selection.used,
      },
      nextFormId: 'CHR-015',
    };
  } catch (cause) {
    if (cause instanceof SkillStageRuleError) return guardRejected();
    throw cause;
  }
}

export function prepareSkillCardAdditionFromCheckpoint(
  checkpoint: DurableCreationWizardCheckpoint,
  request: SkillCardAdditionPreparation['request'],
  catalog: SkillStageCatalog,
): SkillSelectionPlan {
  const eligibility = checkpoint.skillEligibilityStage?.derived;
  const presentation = checkpoint.skillPresentationStage;
  const binding = presentation?.routeBindings[1];
  if (
    eligibility === undefined ||
    presentation?.formId !== 'CHR-014' ||
    presentation.routeTemplate !== CHR_014_ROUTE ||
    binding?.source !== 'client-selected' ||
    binding.parameterIndex !== 1
  ) {
    return guardRejected();
  }
  return prepareSkillCardAddition(
    {
      eligibility,
      request,
      selectedSkills: (checkpoint.skillSelectionStage?.derived.selectedSkills ?? []).map(
        ({ skillKey, targetBonus }) => ({ skillId: skillKey, targetBonus }),
      ),
      selectionRevision: presentation.selectionRevision,
      skillId: binding.value,
    },
    catalog,
  );
}

export function createSkillPresentationStage(
  formId: SkillPresentationStage['formId'],
  characterDraftId: string,
  skillId: string | null,
  selectionRevision: number,
  projectionRevision: number,
): SkillPresentationStage {
  const routeBindings: AssignedRouteBinding[] = [
    { parameterIndex: 0, source: 'inherited', value: characterDraftId },
  ];
  if (formId === 'CHR-014') {
    if (skillId === null) throw new Error('CHR-014 requires a client-selected skillId');
    routeBindings.push({ parameterIndex: 1, source: 'client-selected', value: skillId });
  } else if (skillId !== null) {
    throw new Error(`${formId} cannot carry a skillId route binding`);
  }
  return {
    formId,
    projectionRevision,
    routeBindings,
    routeTemplate:
      formId === 'CHR-013' ? CHR_013_ROUTE : formId === 'CHR-014' ? CHR_014_ROUTE : CHR_015_ROUTE,
    selectionRevision,
  };
}
