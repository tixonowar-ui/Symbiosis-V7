import type { EnemyStats } from '@shared/enemy-authoring.js';
import {
  enemyInitialSkillInputValue,
  enemyInitialSkillPlanValue,
  enemySkillAccountingValue,
  type EnemyInitialSkillInput,
  type EnemyInitialSkillPlan,
  type EnemyPaidSkill,
  type EnemySkillAccounting,
  type EnemyAdvisorKnowledge,
} from '@shared/enemy-skill-plan.js';
import type { SkillStageCatalog } from '../../rules/skill-stage/catalog.js';
import { calculateSkillStageStats } from '../../rules/skill-stage/stats.js';
import { calculateSkillSlotCost, validateSkillSelection } from '../../rules/skill-stage/skills.js';
import {
  validateAdvisorSkillSelection,
  type AdvisorSkillSelectionInput,
} from '../../rules/symbiont-stage/advisor.js';

const fail = (message: string): never => {
  throw new Error('SENTIENT skill plan: ' + message);
};
function definition(catalog: SkillStageCatalog, key: string) {
  return catalog.skills.find((row) => row.skillKey === key) ?? fail('unknown SkillKey ' + key);
}
function meets(catalog: SkillStageCatalog, key: string, stats: EnemyStats): boolean {
  const skill = definition(catalog, key);
  if (skill.category === 'FIXED_RACE_PASSIVE' || skill.category === 'FIXED_CLASS_PASSIVE')
    return true;
  return catalog.requirements
    .filter((row) => row.skillKey === key)
    .every((row) => stats[row.statCode] >= row.minValue);
}

/** The host binds planId to the actual INITIALIZE/confirmed REBUILD command, not a second allocator. */
export function createSentientInitialSkillPlan(
  catalog: SkillStageCatalog,
  input: EnemyInitialSkillInput,
  planId: string,
  revision: number,
): EnemyInitialSkillPlan {
  enemyInitialSkillInputValue(input);
  const stats = calculateSkillStageStats(catalog, {
    baseStats: input.baseStats,
    raceCode: input.build.raceCode,
    classCode: input.build.pureClassOrNull,
    creationMode: 'MANUAL',
  }).skillStageStats;
  const initial = validateSkillSelection(catalog, {
    raceCode: input.build.raceCode,
    classCode: input.build.pureClassOrNull,
    skillStageStats: stats,
    selectedSkills: input.build.skillSelections,
  });
  return enemyInitialSkillPlanValue({
    schemaVersion: 1,
    planId,
    revision,
    initialInput: structuredClone(input),
    initialStartCapacity: initial.capacity,
    initialSkills: initial.learnedSkills.map((skill) => ({
      skillKey: skill.skillKey,
      bonus: skill.bonus,
      source: skill.source,
      startSlots: skill.slotCost,
      dolphinSlots: 0,
    })),
    accountingOrNull: null,
  });
}

/**
 * ADR0092/CORE166: call only at successful verified-body publication. Temporary equipment
 * availability is a separate read; it never mutates knowledge or returns a paid slot.
 * New Dolphin choices are an explicit pending purchase, not a replacement for retained skills.
 */
export function resolveSentientSkillAccounting(
  catalog: SkillStageCatalog,
  plan: EnemyInitialSkillPlan,
  input: Readonly<{
    commandId: string;
    permanentStats: EnemyStats;
    dolphinCapacity: number;
    newDolphinChoices: readonly Readonly<{ skillKey: string; targetBonus: number }>[];
    grossAcquired: boolean;
  }>,
): EnemySkillAccounting {
  enemyInitialSkillPlanValue(plan);
  if (!Number.isSafeInteger(input.dolphinCapacity) || input.dolphinCapacity < 0)
    return fail('invalid source Dolphin capacity');
  if (
    Object.values(input.permanentStats).some((value) => !Number.isSafeInteger(value) || value < 1)
  )
    return fail('verified permanent stats must be positive integers');
  const previous = plan.accountingOrNull;
  let known: EnemyPaidSkill[] = (previous?.knownSkills ?? plan.initialSkills).map((skill) => ({
    ...skill,
  }));
  for (const skill of known) definition(catalog, skill.skillKey);
  let gross = previous?.grossGrantOrNull ?? null;
  // The once-per-plan grant is independent of whether its source is still present now.
  if (input.grossAcquired && gross === null) {
    definition(catalog, 'GROSS');
    const before = known.find((skill) => skill.skillKey === 'GROSS');
    const bonusBefore = before?.bonus ?? 0;
    const bonusAfter =
      bonusBefore === 0 ? 3 : bonusBefore >= 5 ? bonusBefore : Math.min(5, bonusBefore + 3);
    gross = { commandId: input.commandId, bonusBefore, bonusAfter };
    known =
      before === undefined
        ? [
            ...known,
            {
              skillKey: 'GROSS',
              bonus: bonusAfter,
              source: 'SYMBIONT_GRANTED',
              startSlots: 0,
              dolphinSlots: 0,
            },
          ]
        : known.map((skill) =>
            skill.skillKey === 'GROSS'
              ? { ...skill, bonus: bonusAfter, source: 'SYMBIONT_GRANTED' }
              : skill,
          );
  }
  const losses = [...(previous?.permanentLosses ?? [])];
  known = known.filter((skill) => {
    if (meets(catalog, skill.skillKey, input.permanentStats)) return true;
    losses.push({
      skillKey: skill.skillKey,
      commandId: input.commandId,
      bonusBefore: skill.bonus,
      releasedStartSlots: skill.startSlots,
      releasedDolphinSlots: skill.dolphinSlots,
    });
    return false;
  });
  const keys = new Set<string>();
  for (const selection of input.newDolphinChoices) {
    if (keys.has(selection.skillKey)) return fail('duplicate Dolphin choice');
    keys.add(selection.skillKey);
    const skill = definition(catalog, selection.skillKey);
    if (
      skill.category !== 'SELECTABLE_GENERAL' ||
      !meets(catalog, skill.skillKey, input.permanentStats)
    )
      return fail('Dolphin choice fails source category/requirements');
    if (skill.maxBonus !== 'NO_RULED_UPPER_LIMIT' && selection.targetBonus > skill.maxBonus)
      return fail('Dolphin choice exceeds source maximum');
    const before = known.find((row) => row.skillKey === selection.skillKey);
    const cost =
      calculateSkillSlotCost(selection.targetBonus) -
      (before === undefined ? 0 : calculateSkillSlotCost(before.bonus));
    if (cost < 0) return fail('Dolphin choice cannot refund an existing bonus');
    if (cost === 0) continue;
    const used = known.reduce((sum, row) => sum + row.dolphinSlots, 0);
    if (used + cost > input.dolphinCapacity)
      return fail('Dolphin capacity exceeded; retained payments are not refunded');
    known =
      before === undefined
        ? [
            ...known,
            {
              skillKey: skill.skillKey,
              bonus: selection.targetBonus,
              source: 'SYMBIONT_SELECTED',
              startSlots: 0,
              dolphinSlots: cost,
            },
          ]
        : known.map((row) =>
            row.skillKey === selection.skillKey
              ? { ...row, bonus: selection.targetBonus, dolphinSlots: row.dolphinSlots + cost }
              : row,
          );
  }
  return enemySkillAccountingValue({
    schemaVersion: 1,
    resolvedAtCommandId: input.commandId,
    knownSkills: known,
    permanentLosses: losses,
    grossGrantOrNull: gross,
  });
}

export function sentientSkillPoolAccounting(
  plan: EnemyInitialSkillPlan,
  permanentStats: EnemyStats,
  dolphinCapacity: number,
) {
  const known = plan.accountingOrNull?.knownSkills ?? plan.initialSkills;
  const startCapacity = Math.max(
    0,
    Math.min(plan.initialStartCapacity, Math.ceil(permanentStats.W / 2)),
  );
  const pool = (capacity: number, used: number) => ({
    capacity,
    used,
    available: Math.max(0, capacity - used),
    overflow: Math.max(0, used - capacity),
  });
  return {
    start: pool(
      startCapacity,
      known.reduce((sum, row) => sum + row.startSlots, 0),
    ),
    dolphin: pool(
      dolphinCapacity,
      known.reduce((sum, row) => sum + row.dolphinSlots, 0),
    ),
  };
}

export function temporarilyUnavailableSentientSkills(
  catalog: SkillStageCatalog,
  known: readonly EnemyPaidSkill[],
  effectiveStats: EnemyStats,
): readonly string[] {
  return known
    .filter((skill) => !meets(catalog, skill.skillKey, effectiveStats))
    .map((skill) => skill.skillKey);
}

/** Initial acquisition exact-fill and later CORE166 knowledge are separate states. */
export function resolveSentientAdvisorKnowledge(
  catalog: SkillStageCatalog,
  input: Readonly<{
    cardId: string;
    commandId: string;
    previousOrNull: EnemyAdvisorKnowledge | null;
    advisorIw: AdvisorSkillSelectionInput['advisorIw'];
    permanentStats: EnemyStats;
    effectiveStats: EnemyStats;
    newChoices: readonly Readonly<{ skillKey: string; targetBonus: number }>[];
  }>,
): EnemyAdvisorKnowledge {
  const ownStats = (body: EnemyStats): EnemyStats => ({
    ...body,
    I: input.advisorIw.I.value,
    W: input.advisorIw.W.value,
  });
  const previous = input.previousOrNull;
  if (previous !== null && previous.cardId !== input.cardId)
    return fail('foreign Advisor knowledge');
  if (previous === null) {
    const body = input.effectiveStats;
    const selected = validateAdvisorSkillSelection(catalog, {
      advisorIw: input.advisorIw,
      bodyStats: { S: body.S, D: body.D, M: body.M, Z: body.Z, C: body.C },
      selectedSkills: input.newChoices,
    });
    const initialSkills: EnemyPaidSkill[] = selected.learnedSkills.map((skill) => ({
      skillKey: skill.skillKey,
      bonus: skill.bonus,
      source: 'SELECTED',
      startSlots: skill.slotCost,
      dolphinSlots: 0,
    }));
    return {
      cardId: input.cardId,
      initialFillCommandId: input.commandId,
      resolvedAtCommandId: input.commandId,
      initialSkills,
      knownSkills: initialSkills.map((skill) => ({ ...skill })),
      permanentLosses: [],
    };
  }
  const losses = [...previous.permanentLosses];
  let known = previous.knownSkills
    .filter((skill) => {
      if (meets(catalog, skill.skillKey, ownStats(input.permanentStats))) return true;
      losses.push({
        skillKey: skill.skillKey,
        commandId: input.commandId,
        bonusBefore: skill.bonus,
        releasedStartSlots: skill.startSlots,
        releasedDolphinSlots: 0,
      });
      return false;
    })
    .map((skill) => ({ ...skill }));
  const keys = new Set<string>();
  for (const choice of input.newChoices) {
    if (keys.has(choice.skillKey)) return fail('duplicate Advisor choice');
    keys.add(choice.skillKey);
    const skill = definition(catalog, choice.skillKey);
    if (
      skill.category !== 'SELECTABLE_GENERAL' ||
      !meets(catalog, skill.skillKey, ownStats(input.effectiveStats))
    )
      return fail('Advisor choice fails actual body requirements');
    if (skill.maxBonus !== 'NO_RULED_UPPER_LIMIT' && choice.targetBonus > skill.maxBonus)
      return fail('Advisor choice exceeds source maximum');
    const before = known.find((row) => row.skillKey === choice.skillKey);
    const cost =
      calculateSkillSlotCost(choice.targetBonus) -
      (before === undefined ? 0 : calculateSkillSlotCost(before.bonus));
    if (cost < 0) return fail('Advisor choice cannot refund an existing bonus');
    if (cost === 0) continue;
    if (
      known.reduce((sum, row) => sum + row.startSlots, 0) + cost >
      Math.ceil(input.advisorIw.W.value / 2)
    )
      return fail('Advisor capacity exceeded');
    known =
      before === undefined
        ? [
            ...known,
            {
              skillKey: skill.skillKey,
              bonus: choice.targetBonus,
              source: 'SELECTED',
              startSlots: cost,
              dolphinSlots: 0,
            },
          ]
        : known.map((row) =>
            row.skillKey === choice.skillKey
              ? { ...row, bonus: choice.targetBonus, startSlots: row.startSlots + cost }
              : row,
          );
  }
  return {
    ...previous,
    resolvedAtCommandId: input.commandId,
    knownSkills: known,
    permanentLosses: losses,
  };
}
