import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';
import { calculateSkillStageStats } from '../domain/rules/skill-stage/stats.js';
import {
  calculateSkillSlotCost,
  validateSkillSelection,
} from '../domain/rules/skill-stage/skills.js';
import type {
  EnemyVersionConfigurationInput,
  EnemyVersionReplacementSummary,
} from '@shared/enemy-version-configuration.js';
import type {
  EnemyAuthoringAttempt,
  EnemyAttempt,
  EnemyWorkflowRequest,
} from '@shared/enemy-authoring.js';
import {
  enemyVersionConfigurationPatchValue,
  preparedEnemyVersionConfigurationValue,
  type EnemyVersionAttemptContext,
  type PreparedEnemyVersionConfiguration,
} from '@shared/enemy-version-configuration.js';
import { emptyEnemySkillPlanState } from '@shared/enemy-skill-plan.js';
import {
  assertEnemyVersionReplacementConsent,
  previewEnemyVersionReplacement,
  mergeEnemyVersionMandatoryFacts,
} from '../domain/entities/enemy-template/version-configuration.js';
import { createSentientInitialSkillPlan } from '../domain/entities/enemy-template/sentient-skill-plan.js';
import type { EnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import type { EnemyVersionMandatoryFacts } from '@shared/enemy-version-facts.js';
import {
  customMonsterCompositionPatchValue,
  type CustomMonsterAttempt,
} from '@shared/custom-monster-state.js';
import {
  customMonsterAdvisorSkills,
  customMonsterAdvisorStats,
  customMonsterCompleteInput,
  deriveCustomMonsterBody,
} from '../domain/entities/enemy-template/custom-monster-authoring.js';

/** Source-derived consequences are durable preview data, rederived by every historical prepare. */
export function deriveEnemyVersionReplacementSummary(
  catalog: EnemyAuthoringSourceCatalog,
  input: EnemyVersionConfigurationInput,
): EnemyVersionReplacementSummary {
  const advisorOwnChoices = input.advisorSkills.map((choice) => ({
    ...choice,
    name: catalog.skillLabels[choice.skillKey] ?? s.fail('SOURCE_CHANGED'),
    slotCost: calculateSkillSlotCost(choice.targetBonus),
  }));
  if (input.kind === 'CUSTOM_MONSTER') return { kind: input.kind, advisorOwnChoices };
  const statsBeforeComposition = calculateSkillStageStats(catalog.skills, {
    baseStats: input.initialInput.baseStats,
    raceCode: input.initialInput.build.raceCode,
    classCode: input.initialInput.build.pureClassOrNull,
    creationMode: 'MANUAL',
  }).skillStageStats;
  const initial = validateSkillSelection(catalog.skills, {
    raceCode: input.initialInput.build.raceCode,
    classCode: input.initialInput.build.pureClassOrNull,
    skillStageStats: statsBeforeComposition,
    selectedSkills: input.initialInput.build.skillSelections,
  });
  return {
    kind: input.kind,
    advisorOwnChoices,
    statsBeforeComposition,
    startCapacity: initial.capacity,
    initialSkills: initial.learnedSkills.map((skill) => ({
      skillKey: skill.skillKey,
      name: catalog.skillLabels[skill.skillKey] ?? s.fail('SOURCE_CHANGED'),
      bonus: skill.bonus,
      slotCost: skill.slotCost,
      source: skill.source,
    })),
  };
}

/** Deterministic preparation is re-evaluated at every owning historical prefix; no allocations/RNG. */
export function prepareEnemyVersionConfiguration(
  catalog: EnemyAuthoringSourceCatalog,
  attempt: EnemyAuthoringAttempt,
  state: EnemyVersionAttemptContext,
  request: EnemyWorkflowRequest,
  actualMandatoryFacts: EnemyVersionMandatoryFacts,
): PreparedEnemyVersionConfiguration {
  if (
    request.payload.stage !== 'VERSION_CONFIGURATION' ||
    request.payload.creationAttemptId !== attempt.attemptId ||
    request.payload.expectedAttemptRevision !== attempt.revision
  )
    return s.fail('STALE_REVISION');
  const patch = enemyVersionConfigurationPatchValue(request.payload.data);
  let next: EnemyAuthoringAttempt = { ...attempt, revision: attempt.revision + 1 };
  let metadata: EnemyVersionAttemptContext = { ...state, replacementPreviewOrNull: null };
  if (patch.operation === 'SET_REASON') metadata = { ...metadata, reason: patch.reason.trim() };
  else if (patch.operation === 'DISCARD_REPLACEMENT') {
    if (state.replacementPreviewOrNull?.previewCommandId !== patch.previewCommandId)
      return s.fail('STALE_REVISION');
  } else {
    if (patch.input.kind !== attempt.kind) return s.fail('FOREIGN_OWNER');
    for (const choice of patch.input.advisorSkills) {
      const skill = catalog.skills.skills.find((row) => row.skillKey === choice.skillKey);
      if (
        skill?.category !== 'SELECTABLE_GENERAL' ||
        (skill.maxBonus !== 'NO_RULED_UPPER_LIMIT' && choice.targetBonus > skill.maxBonus)
      )
        return s.fail('INVALID_INPUT');
    }
    if (patch.input.kind === 'SENTIENT')
      createSentientInitialSkillPlan(
        catalog.skills,
        patch.input.initialInput,
        request.commandId,
        (attempt.kind === 'SENTIENT' ? (attempt.skillPlanState?.planOrNull?.revision ?? 0) : 0) + 1,
      );
    if (patch.operation === 'PREVIEW_REPLACEMENT')
      metadata = {
        ...metadata,
        replacementPreviewOrNull: previewEnemyVersionReplacement(
          state.origin,
          attempt,
          patch.input,
          request.commandId,
          deriveEnemyVersionReplacementSummary(catalog, patch.input),
        ),
      };
    else {
      const preview = state.replacementPreviewOrNull ?? s.fail('STALE_REVISION');
      if (
        !admissionJsonEqual(
          preview.inputSummary,
          deriveEnemyVersionReplacementSummary(catalog, patch.input),
        )
      )
        return s.fail('SOURCE_CHANGED');
      assertEnemyVersionReplacementConsent(preview, {
        origin: state.origin,
        attempt,
        input: patch.input,
        displayedPreview: patch.displayedPreview,
      });
      if (preview.previewCommandId !== patch.previewCommandId) return s.fail('STALE_REVISION');
      metadata = {
        ...metadata,
        configurationConfirmation: { commandId: request.commandId, input: patch.input },
        ownChoicesPending: true,
        ...(attempt.kind === 'CUSTOM_MONSTER'
          ? {
              unconfiguredAdvisorCardIdOrNull:
                actualMandatoryFacts.advisorCards.find((card) => card.initialFillOrNull !== null)
                  ?.cardId ?? null,
            }
          : {}),
      };
      if (attempt.kind === 'SENTIENT' && patch.input.kind === 'SENTIENT') {
        const plan = createSentientInitialSkillPlan(
          catalog.skills,
          patch.input.initialInput,
          request.commandId,
          (attempt.skillPlanState?.planOrNull?.revision ?? 0) + 1,
        );
        const { legacySkillPlanPreview: _discarded, ...prior } = attempt;
        next = mergeEnemyVersionMandatoryFacts(
          {
            ...prior,
            revision: next.revision,
            schemaVersion: 2,
            baseStatsOrNull: plan.initialInput.baseStats,
            buildOrNull: plan.initialInput.build,
            skillPlanState: {
              ...emptyEnemySkillPlanState(),
              planOrNull: plan,
              advisorInitialFillHistory: attempt.skillPlanState?.advisorInitialFillHistory ?? [],
            },
            compositionOrNull: null,
            inventoryOrNull: null,
            itemTemplateKeys: [],
            ...(attempt.compositionAcquisitions === undefined
              ? {}
              : {
                  compositionAcquisitions: {
                    ...attempt.compositionAcquisitions,
                    activeAdvisorCardIdOrNull: null,
                    // Deterministic once-per-configuration grant; mandatory rolls/card facts remain intact.
                    grossGrantOrNull: null,
                  },
                }),
          },
          actualMandatoryFacts,
        );
      } else if (attempt.kind === 'CUSTOM_MONSTER') {
        // The actual card/initial fill remains historical. New current choices wait for the verified body.
        const merged = mergeEnemyVersionMandatoryFacts(attempt, actualMandatoryFacts);
        if (merged.kind !== 'CUSTOM_MONSTER') return s.fail('SOURCE_CHANGED');
        next = {
          ...merged,
          revision: next.revision,
          compositionOrNull: null,
          activeAdvisorCardIdOrNull: null,
          advisorCards: merged.advisorCards.map((card) => ({
            ...card,
            knownSkills: [],
            permanentLosses: [],
          })),
        };
      }
    }
  }
  return preparedEnemyVersionConfigurationValue({ attempt: next, state: metadata });
}

/** Current choices change only after explicit consent and the actually accepted monster body. */
export function prepareCustomMonsterVersionOwnChoices(
  catalog: EnemyAuthoringSourceCatalog['monster'],
  attempt: CustomMonsterAttempt,
  request: EnemyWorkflowRequest,
  state: EnemyVersionAttemptContext | undefined,
): CustomMonsterAttempt {
  if (
    state === undefined ||
    request.payload.stage !== 'MONSTER_SYMBIONT' ||
    request.payload.data?.['operation'] !== 'FINISH'
  )
    return attempt;
  const patch = customMonsterCompositionPatchValue(request.payload.data);
  if (patch.operation !== 'FINISH') return s.fail('INVALID_INPUT');
  const composition = attempt.compositionOrNull ?? s.fail('UNAVAILABLE');
  if (composition.advisorCardIdOrNull === null) return attempt;
  const card =
    attempt.advisorCards.find((row) => row.cardId === composition.advisorCardIdOrNull) ??
    s.fail('SOURCE_CHANGED');
  // Acquired but never filled retains its ordinary first-fill permission, including after cancel.
  if (card.initialSkillsOrNull === null) return attempt;
  if (state.unconfiguredAdvisorCardIdOrNull === card.cardId && state.ownChoicesPending !== true)
    return s.fail('UNAVAILABLE');
  if (state.ownChoicesPending !== true) return attempt;
  const input = state.configurationConfirmation?.input ?? s.fail('SOURCE_CHANGED');
  if (input.kind !== 'CUSTOM_MONSTER' || !s.same(input.advisorSkills, patch.advisorSkills))
    return s.fail('INVALID_INPUT');
  const body = deriveCustomMonsterBody(
    catalog,
    customMonsterCompleteInput(attempt),
    composition.symbiontInstanceIdOrNull,
  );
  customMonsterAdvisorSkills(
    catalog,
    customMonsterAdvisorStats(catalog, body, card),
    patch.advisorSkills,
    true,
  );
  return {
    ...attempt,
    advisorCards: attempt.advisorCards.map((row) =>
      row.cardId === card.cardId
        ? {
            ...row,
            knownSkills: patch.advisorSkills,
            permanentLosses: [],
          }
        : row,
    ),
  };
}

/** A prior real card fill is not a free first allocation into another, unconfirmed current plan. */
export function assertSentientVersionOwnChoices(
  attempt: EnemyAttempt,
  state: EnemyVersionAttemptContext,
  facts: EnemyVersionMandatoryFacts,
  request: EnemyWorkflowRequest,
): void {
  if (request.payload.stage !== 'SENTIENT_INVENTORY') return;
  if (facts.kind !== 'SENTIENT') return s.fail('SOURCE_CHANGED');
  const composition = attempt.compositionOrNull;
  if (
    composition === null ||
    !('schemaVersion' in composition) ||
    composition.advisorCardIdOrNull === null
  )
    return;
  const cardId = composition.advisorCardIdOrNull;
  const statePlan = attempt.skillPlanState;
  if (statePlan?.advisorKnowledge.some((row) => row.cardId === cardId)) return;
  const firstFill = facts.advisorCards.find((card) => card.cardId === cardId)?.initialFillOrNull;
  if (firstFill == null) return; // Acquisition/FINISH without a successful body publication is not a fill.
  const confirmation = state.configurationConfirmation;
  const choices =
    statePlan?.pendingChoicesOrNull?.advisorSkills ?? composition.skills.advisorSkills;
  if (
    confirmation?.input.kind !== 'SENTIENT' ||
    confirmation.commandId !== statePlan?.planOrNull?.planId ||
    !s.same(confirmation.input.advisorSkills, choices)
  )
    return s.fail('UNAVAILABLE');
}
