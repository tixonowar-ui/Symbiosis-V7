import type { EnemyAttempt, EnemyWorkflowRequest } from '@shared/enemy-authoring.js';
import type { EnemyComposedComposition } from '@shared/enemy-composition.js';
import {
  emptyEnemySkillPlanState,
  enemyBuildPlanPatchValue,
  enemySkillPlanStateValue,
  type EnemyBuildPlanPatch,
  type EnemySkillPlanState,
  type EnemySkillRebuildPreview,
} from '@shared/enemy-skill-plan.js';
import {
  enemyBuildValue,
  enemyInventoryValue,
  deriveSentientEnemySheet,
} from '../domain/entities/enemy-template/sentient-authoring.js';
import {
  createSentientInitialSkillPlan,
  resolveSentientSkillAccounting,
  resolveSentientAdvisorKnowledge,
} from '../domain/entities/enemy-template/sentient-skill-plan.js';
import { resolveAdvisorIwRolls } from '../domain/rules/symbiont-stage/advisor.js';
import type { EnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import { enemyCompositionReaders as r } from '@shared/enemy-composition-codec.js';

function retainedReceipts(attempt: EnemyAttempt): readonly string[] {
  const ledger = attempt.compositionAcquisitions;
  return ledger === undefined
    ? []
    : [
        ...(ledger.freeSlotOrNull === null ? [] : [ledger.freeSlotOrNull.roll.rollReceiptId]),
        ...ledger.advisorCards.flatMap((card) => [
          ...card.iwRolls.map((roll) => roll.rollReceiptId),
          ...(card.suppressionRollOrNull === null
            ? []
            : [card.suppressionRollOrNull.rollReceiptId]),
        ]),
      ];
}
function buildPatch(
  catalog: EnemyAuthoringSourceCatalog,
  attempt: EnemyAttempt,
  request: EnemyWorkflowRequest,
  state: EnemySkillPlanState,
): EnemySkillPlanState {
  const data = request.payload.data ?? s.fail('INVALID_INPUT');
  const baseStats = attempt.baseStatsOrNull ?? s.fail('UNAVAILABLE');
  const plan = state.planOrNull;
  const patch: EnemyBuildPlanPatch = Object.hasOwn(data, 'operation')
    ? enemyBuildPlanPatchValue(data)
    : {
        operation: plan === null ? 'INITIALIZE' : 'SAVE_IDENTICAL',
        initialInput: { baseStats, build: enemyBuildValue(data) },
      };
  if (patch.operation === 'DISCARD_REBUILD') {
    if (state.rebuildPreviewOrNull?.previewCommandId !== patch.previewCommandId)
      return s.fail('STALE_REVISION');
    return enemySkillPlanStateValue({ ...state, rebuildPreviewOrNull: null });
  }
  if (!s.same(patch.initialInput.baseStats, baseStats)) return s.fail('FOREIGN_OWNER');
  // Validate the complete candidate before publishing any preview or resetting a dependent stage.
  const candidate = createSentientInitialSkillPlan(
    catalog.skills,
    patch.initialInput,
    request.commandId,
    (plan?.revision ?? 0) + 1,
  );
  if (patch.operation === 'INITIALIZE') {
    if (
      plan !== null ||
      attempt.buildOrNull !== null ||
      attempt.compositionAcquisitions !== undefined
    )
      return s.fail('INVALID_INPUT');
    return enemySkillPlanStateValue({
      ...state,
      planOrNull: candidate,
      rebuildPreviewOrNull: null,
      pendingChoicesOrNull: null,
      advisorKnowledge: [],
    });
  }
  if (patch.operation === 'SAVE_IDENTICAL') {
    if (
      plan === null ||
      attempt.buildOrNull === null ||
      !s.same(plan.initialInput, patch.initialInput)
    )
      return s.fail('INVALID_INPUT');
    return enemySkillPlanStateValue({ ...state, rebuildPreviewOrNull: null });
  }
  if (patch.expectedPlanRevision !== (plan?.revision ?? 0)) return s.fail('STALE_REVISION');
  if (patch.operation === 'PREVIEW_REBUILD') {
    const legacyInitial =
      plan === null && attempt.buildOrNull !== null
        ? createSentientInitialSkillPlan(
            catalog.skills,
            { baseStats, build: attempt.buildOrNull },
            request.commandId,
            1,
          ).initialSkills
        : [];
    const preview: EnemySkillRebuildPreview = {
      schemaVersion: 1,
      previewCommandId: request.commandId,
      attemptId: attempt.attemptId,
      sourceAttemptRevision: attempt.revision,
      planIdOrNull: plan?.planId ?? null,
      planRevision: plan?.revision ?? 0,
      initialInput: candidate.initialInput,
      consequences: {
        abandonedSkills: structuredClone(
          plan?.accountingOrNull?.knownSkills ?? plan?.initialSkills ?? legacyInitial,
        ),
        invalidateComposition: attempt.compositionOrNull !== null,
        invalidateInventory: attempt.inventoryOrNull !== null,
        invalidateOwnAdvisorChoices:
          state.advisorKnowledge.length !== 0 ||
          (attempt.compositionOrNull !== null &&
            'schemaVersion' in attempt.compositionOrNull &&
            attempt.compositionOrNull.skills.advisorSkills.length !== 0),
        retainedRollReceiptIds: retainedReceipts(attempt),
      },
    };
    return enemySkillPlanStateValue({ ...state, rebuildPreviewOrNull: preview });
  }
  const preview = state.rebuildPreviewOrNull ?? s.fail('UNAVAILABLE');
  if (
    patch.previewCommandId !== preview.previewCommandId ||
    preview.attemptId !== attempt.attemptId ||
    preview.sourceAttemptRevision + 1 !== attempt.revision ||
    preview.planIdOrNull !== (plan?.planId ?? null) ||
    !s.same(preview.initialInput, candidate.initialInput) ||
    !s.same(preview.consequences, patch.displayedConsequences)
  )
    return s.fail('STALE_REVISION');
  return enemySkillPlanStateValue({
    ...state,
    planOrNull: candidate,
    rebuildPreviewOrNull: null,
    pendingChoicesOrNull: null,
    advisorKnowledge: [],
  });
}

/** Pure preparation is also replayed against each immutable prefix; no RNG, DB or current cursor. */
export function prepareEnemySkillPlanState(
  catalog: EnemyAuthoringSourceCatalog,
  attempt: EnemyAttempt,
  request: EnemyWorkflowRequest,
  itemTemplateKeys: readonly string[],
  preparedComposition?: EnemyComposedComposition,
): EnemySkillPlanState | undefined {
  const upgrade =
    request.payload.stage === 'SENTIENT_BUILD' &&
    Object.hasOwn(request.payload.data ?? {}, 'operation');
  if (attempt.schemaVersion !== 2 && !upgrade) return undefined;
  const state = attempt.skillPlanState ?? {
    ...emptyEnemySkillPlanState(),
    rebuildPreviewOrNull: attempt.legacySkillPlanPreview ?? null,
  };
  if (
    request.workflowCommandId === 'UI-CMD-ENEMY-COMMIT-V1' ||
    request.workflowCommandId === 'UI-CMD-ENEMY-NEW-VERSION'
  ) {
    deriveSentientEnemySheet(catalog, attempt);
    if (state.rebuildPreviewOrNull !== null || state.pendingChoicesOrNull !== null)
      return s.fail('UNAVAILABLE');
    return state;
  }
  if (request.payload.stage === 'SENTIENT_BUILD')
    return buildPatch(catalog, attempt, request, state);
  if (request.payload.stage === 'SENTIENT_STATS' || request.payload.stage === 'SENTIENT_IDENTITY')
    return enemySkillPlanStateValue({
      ...state,
      rebuildPreviewOrNull: null,
      ...(request.payload.stage === 'SENTIENT_STATS' &&
      !s.same(attempt.baseStatsOrNull, request.payload.data)
        ? { pendingChoicesOrNull: null }
        : {}),
    });
  const plan = state.planOrNull ?? s.fail('UNAVAILABLE');
  if (
    !s.same(plan.initialInput, { baseStats: attempt.baseStatsOrNull, build: attempt.buildOrNull })
  )
    return s.fail('SOURCE_CHANGED');
  if (request.payload.stage === 'SENTIENT_SYMBIONTS') {
    const composition = preparedComposition ?? s.fail('INVALID_INPUT');
    if (composition.phase !== 'CONFIRMED')
      return enemySkillPlanStateValue({
        ...state,
        rebuildPreviewOrNull: null,
        pendingChoicesOrNull: null,
      });
    return enemySkillPlanStateValue({
      ...state,
      rebuildPreviewOrNull: null,
      ...(s.same(attempt.compositionOrNull, composition)
        ? {}
        : {
            pendingChoicesOrNull: {
              commandId: request.commandId,
              compositionPreviewCommandId: composition.previewCommandId,
              advisorSkills: composition.skills.advisorSkills,
              dolphinSkills: composition.skills.dolphinSkills,
            },
          }),
    });
  }
  if (request.payload.stage !== 'SENTIENT_INVENTORY') return s.fail('INVALID_INPUT');
  const composition = attempt.compositionOrNull;
  if (
    composition === null ||
    !('schemaVersion' in composition) ||
    composition.phase !== 'CONFIRMED'
  )
    return s.fail('UNAVAILABLE');
  const inventory = enemyInventoryValue(request.payload.data);
  const candidate: EnemyAttempt = { ...attempt, inventoryOrNull: inventory, itemTemplateKeys };
  const body = deriveSentientEnemySheet(catalog, candidate, true);
  const facts = body.compositionFacts ?? s.fail('SOURCE_CHANGED');
  const pending = state.pendingChoicesOrNull;
  if (pending !== null && pending.compositionPreviewCommandId !== composition.previewCommandId)
    return s.fail('SOURCE_CHANGED');
  const accounting = resolveSentientSkillAccounting(catalog.skills, plan, {
    commandId: request.commandId,
    permanentStats: body.permanentStats,
    dolphinCapacity: r.integer(
      r.record(facts['dolphinSkillSlots'], '$.dolphinSlots')['capacity'],
      '$.capacity',
      0,
    ),
    newDolphinChoices: pending?.dolphinSkills ?? [],
    grossAcquired: composition.acquisitions.grossGrantOrNull !== null,
  });
  let advisorKnowledge = state.advisorKnowledge;
  let advisorInitialFillHistory = state.advisorInitialFillHistory;
  if (composition.advisorCardIdOrNull !== null) {
    const card =
      composition.acquisitions.advisorCards.find(
        (row) => row.cardId === composition.advisorCardIdOrNull,
      ) ?? s.fail('SOURCE_CHANGED');
    const previous = advisorKnowledge.find((row) => row.cardId === card.cardId) ?? null;
    if (previous === null && pending === null) return s.fail('UNAVAILABLE');
    const knowledge = resolveSentientAdvisorKnowledge(catalog.skills, {
      cardId: card.cardId,
      commandId: request.commandId,
      previousOrNull: previous,
      advisorIw: resolveAdvisorIwRolls([card.iwRolls[0].mechanical, card.iwRolls[1].mechanical]),
      permanentStats: body.permanentStats,
      effectiveStats: body.effectiveStats,
      newChoices: pending?.advisorSkills ?? [],
    });
    advisorKnowledge = [...advisorKnowledge.filter((row) => row.cardId !== card.cardId), knowledge];
    if (previous === null)
      advisorInitialFillHistory = [
        ...advisorInitialFillHistory,
        {
          cardId: card.cardId,
          planId: plan.planId,
          commandId: knowledge.initialFillCommandId,
          skills: knowledge.initialSkills,
        },
      ];
  }
  const prepared = enemySkillPlanStateValue({
    ...state,
    planOrNull: { ...plan, accountingOrNull: accounting },
    rebuildPreviewOrNull: null,
    pendingChoicesOrNull: null,
    advisorKnowledge,
    advisorInitialFillHistory,
  });
  deriveSentientEnemySheet(catalog, { ...candidate, skillPlanState: prepared });
  return prepared;
}
