import { beforeAll, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadNpcAuthoringSourceCatalog } from '../../../host/npc-catalog.js';
import {
  loadEnemyAuthoringSourceCatalog,
  type EnemyAuthoringSourceCatalog,
} from '../../../host/enemy-authoring-catalog.js';
import type { SkillStageCatalog } from '../../rules/skill-stage/catalog.js';
import type { EnemyInitialSkillPlan } from '@shared/enemy-skill-plan.js';
import { enemyInitialSkillPlanValue, enemySkillAccountingValue } from '@shared/enemy-skill-plan.js';
import {
  createSentientInitialSkillPlan,
  resolveSentientSkillAccounting,
  resolveSentientAdvisorKnowledge,
  sentientSkillPoolAccounting,
  temporarilyUnavailableSentientSkills,
} from './sentient-skill-plan.js';
import { deriveSentientComposition } from './sentient-composition.js';
import {
  enemyComposedCompositionValue,
  emptyEnemyCompositionAcquisitions,
} from '@shared/enemy-composition.js';
import { emptyEnemySkillPlanState } from '@shared/enemy-skill-plan.js';
import { calculateSkillStageStats } from '../../rules/skill-stage/stats.js';
import { resolveAdvisorIwRolls } from '../../rules/symbiont-stage/advisor.js';

let catalog: SkillStageCatalog;
let source: EnemyAuthoringSourceCatalog;
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const common = await loadNpcAuthoringSourceCatalog(root);
  catalog = common.skills;
  source = loadEnemyAuthoringSourceCatalog(root, common);
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stats = { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 };
function initial(dexterity = 20) {
  return createSentientInitialSkillPlan(
    catalog,
    {
      baseStats: { ...stats, D: dexterity },
      build: {
        raceCode: 'UNITED',
        pureClassOrNull: null,
        skillSelections: [
          { skillKey: 'UNARMED', targetBonus: 3 },
          { skillKey: 'LEARNING', targetBonus: 6 },
        ],
      },
    },
    id(1),
    1,
  );
}
function resolve(
  plan: EnemyInitialSkillPlan,
  n: number,
  overrides: Partial<Parameters<typeof resolveSentientSkillAccounting>[2]> = {},
) {
  return resolveSentientSkillAccounting(catalog, plan, {
    commandId: id(n),
    permanentStats: stats,
    dolphinCapacity: 0,
    newDolphinChoices: [],
    grossAcquired: false,
    ...overrides,
  });
}
it('seeds exact full START payments and detaches the approved input', () => {
  const plan = initial();
  expect(plan.initialStartCapacity).toBe(10);
  expect(plan.initialSkills.filter((row) => row.startSlots !== 0)).toEqual([
    { skillKey: 'UNARMED', bonus: 3, source: 'SELECTED', startSlots: 3, dolphinSlots: 0 },
    { skillKey: 'LEARNING', bonus: 6, source: 'SELECTED', startSlots: 7, dolphinSlots: 0 },
  ]);
  expect(() =>
    createSentientInitialSkillPlan(
      catalog,
      {
        ...plan.initialInput,
        build: {
          ...plan.initialInput.build,
          skillSelections: [{ skillKey: 'UNARMED', targetBonus: 3 }],
        },
      },
      id(2),
      2,
    ),
  ).toThrow('underfilled');
  const mutable = {
      baseStats: { ...plan.initialInput.baseStats },
      build: structuredClone(plan.initialInput.build),
    },
    detached = createSentientInitialSkillPlan(catalog, mutable, id(3), 2);
  mutable.baseStats.S = 30;
  expect(detached.initialInput.baseStats.S).toBe(20);
});
it('forgets START on actual permanent Plague requirements and never resurrects it on Chimera recovery', () => {
  const plan = initial(11);
  const plague = resolve(plan, 2, { permanentStats: { ...stats, S: 8, D: 6 } });
  expect(plague.knownSkills.some((row) => row.skillKey === 'UNARMED')).toBe(false);
  expect(plague.permanentLosses).toEqual([
    {
      skillKey: 'UNARMED',
      commandId: id(2),
      bonusBefore: 3,
      releasedStartSlots: 3,
      releasedDolphinSlots: 0,
    },
  ]);
  const restored = resolve({ ...plan, accountingOrNull: plague }, 3, {
    permanentStats: { ...stats, S: 13, D: 11 },
  });
  expect(restored.knownSkills.some((row) => row.skillKey === 'UNARMED')).toBe(false);
  expect(restored.permanentLosses).toEqual(plague.permanentLosses);
});
it('retains mixed START/SYM166 payments at capacity zero and cannot issue a second five on reacquisition', () => {
  const plan = initial();
  const acquired = resolve(plan, 2, {
    dolphinCapacity: 5,
    newDolphinChoices: [
      { skillKey: 'UNARMED', targetBonus: 5 },
      { skillKey: 'ACROBATICS', targetBonus: 3 },
    ],
  });
  expect(acquired.knownSkills.find((row) => row.skillKey === 'UNARMED')).toMatchObject({
    bonus: 5,
    startSlots: 3,
    dolphinSlots: 2,
  });
  const removed = resolve({ ...plan, accountingOrNull: acquired }, 3);
  expect(removed.knownSkills).toEqual(acquired.knownSkills);
  expect(
    sentientSkillPoolAccounting({ ...plan, accountingOrNull: removed }, stats, 0).dolphin,
  ).toEqual({ capacity: 0, used: 5, available: 0, overflow: 5 });
  expect(() =>
    resolve({ ...plan, accountingOrNull: removed }, 4, {
      dolphinCapacity: 5,
      newDolphinChoices: [{ skillKey: 'FENCING', targetBonus: 1 }],
    }),
  ).toThrow('capacity');
  expect(
    resolve({ ...plan, accountingOrNull: removed }, 4, { dolphinCapacity: 5 }).knownSkills,
  ).toEqual(acquired.knownSkills);
});
it('releases the actual mixed charges on permanent loss and pays a later explicit upgrade from the remaining pool', () => {
  const plan = initial(),
    acquired = resolve(plan, 2, {
      dolphinCapacity: 5,
      newDolphinChoices: [
        { skillKey: 'UNARMED', targetBonus: 5 },
        { skillKey: 'ACROBATICS', targetBonus: 3 },
      ],
    });
  const lost = resolve({ ...plan, accountingOrNull: acquired }, 3, {
    permanentStats: { ...stats, S: 8 },
    dolphinCapacity: 5,
  });
  expect(lost.permanentLosses).toContainEqual({
    skillKey: 'UNARMED',
    commandId: id(3),
    bonusBefore: 5,
    releasedStartSlots: 3,
    releasedDolphinSlots: 2,
  });
  const improved = resolve({ ...plan, accountingOrNull: lost }, 4, {
    dolphinCapacity: 5,
    newDolphinChoices: [{ skillKey: 'ACROBATICS', targetBonus: 5 }],
  });
  expect(improved.knownSkills.find((row) => row.skillKey === 'ACROBATICS')).toMatchObject({
    bonus: 5,
    startSlots: 0,
    dolphinSlots: 5,
  });
  expect(improved.knownSkills.some((row) => row.skillKey === 'UNARMED')).toBe(false);
  expect(
    sentientSkillPoolAccounting({ ...plan, accountingOrNull: improved }, stats, 5).start.used,
  ).toBe(7);
});
it('lower W retains knowledge with overflow and temporary availability never releases payments', () => {
  const plan = initial(),
    accounted = resolve(plan, 2, { permanentStats: { ...stats, W: 1 } });
  expect(accounted.knownSkills).toEqual(plan.initialSkills);
  expect(
    sentientSkillPoolAccounting({ ...plan, accountingOrNull: accounted }, { ...stats, W: 1 }, 0)
      .start,
  ).toEqual({ capacity: 1, used: 10, available: 0, overflow: 9 });
  expect(
    temporarilyUnavailableSentientSkills(catalog, accounted.knownSkills, { ...stats, D: 1 }),
  ).toContain('UNARMED');
  expect(accounted.permanentLosses).toEqual([]);
});
it('issues GROSS once per plan, retains its loss and only a separate full plan recomputes its grant', () => {
  const input = {
    baseStats: { ...stats, S: 30 },
    build: {
      raceCode: 'UNITED' as const,
      pureClassOrNull: null,
      skillSelections: [
        { skillKey: 'GROSS', targetBonus: 3 },
        { skillKey: 'LEARNING', targetBonus: 6 },
      ],
    },
  };
  const plan = createSentientInitialSkillPlan(catalog, input, id(1), 1),
    first = resolve(plan, 2, { grossAcquired: true });
  expect(first.knownSkills.find((row) => row.skillKey === 'GROSS')).toMatchObject({
    bonus: 5,
    startSlots: 3,
    dolphinSlots: 0,
  });
  const lost = resolve({ ...plan, accountingOrNull: first }, 3, {
    permanentStats: { ...stats, S: 1 },
    grossAcquired: true,
  });
  const restored = resolve({ ...plan, accountingOrNull: lost }, 4, { grossAcquired: true });
  expect(restored.knownSkills.some((row) => row.skillKey === 'GROSS')).toBe(false);
  expect(restored.grossGrantOrNull).toEqual(first.grossGrantOrNull);
  const rebuilt = createSentientInitialSkillPlan(catalog, input, id(5), 2);
  expect(
    resolve(rebuilt, 6, { grossAcquired: true }).knownSkills.find((row) => row.skillKey === 'GROSS')
      ?.bonus,
  ).toBe(5);
  expect(first.grossGrantOrNull?.commandId).toBe(id(2));
});
it('a full replacement uses its actual new initial basis rather than carrying old mixed promotions', () => {
  const old = initial(),
    mixed = resolve(old, 2, {
      dolphinCapacity: 5,
      newDolphinChoices: [
        { skillKey: 'UNARMED', targetBonus: 5 },
        { skillKey: 'ACROBATICS', targetBonus: 3 },
      ],
    });
  const rebuilt = createSentientInitialSkillPlan(
    catalog,
    {
      ...old.initialInput,
      build: {
        ...old.initialInput.build,
        skillSelections: [
          { skillKey: 'FENCING', targetBonus: 3 },
          { skillKey: 'LEARNING', targetBonus: 6 },
        ],
      },
    },
    id(3),
    2,
  );
  expect(rebuilt.accountingOrNull).toBeNull();
  expect(
    rebuilt.initialSkills.some(
      (row) => row.skillKey === 'UNARMED' || row.skillKey === 'ACROBATICS',
    ),
  ).toBe(false);
  expect(mixed.knownSkills.find((row) => row.skillKey === 'UNARMED')?.bonus).toBe(5);
});
it('permits source CHIMERA L4 to repair provisional UNITED M0 and still refuses an invalid complete body', () => {
  const plan = createSentientInitialSkillPlan(
    catalog,
    { ...initial().initialInput, baseStats: { ...stats, M: 10 } },
    id(1),
    1,
  );
  const basis = calculateSkillStageStats(catalog, {
    baseStats: plan.initialInput.baseStats,
    raceCode: 'UNITED',
    classCode: null,
    creationMode: 'MANUAL',
  }).skillStageStats;
  expect(basis.M).toBe(0);
  const profile = source.composition.development.levels.find(
    (row) => row.speciesKey === 'CHIMERA' && row.level === 4,
  )!;
  const composition = enemyComposedCompositionValue({
    schemaVersion: 1,
    phase: 'CONFIRMED',
    previewCommandId: id(2),
    confirmationCommandIdOrNull: id(3),
    lifecycleSourceCommandIdOrNull: null,
    diceModeSnapshot: 'AUTO',
    instanceIds: [id(4)],
    advisorCardIdOrNull: null,
    acquisitions: emptyEnemyCompositionAcquisitions(),
    rolls: [],
    skills: { advisorSkills: [], dolphinSkills: [] },
    symbiontCompositionMode: 'SYMBIOTIC_MONSTER',
    ordinarySymbiontInstances: [],
    symbioticMonsterProfileIdOrNull: profile.levelProfileId,
    monsterOrNull: {
      speciesKey: 'CHIMERA',
      targetLevel: 4,
      learnedNodeRefs: source.composition.development.nodes
        .filter((row) => row.speciesKey === 'CHIMERA' && row.level <= 4)
        .map((row) => row.nodeRef),
      binding: { kind: 'NONE' },
    },
  });
  const state = { ...emptyEnemySkillPlanState(), planOrNull: plan };
  const result = deriveSentientComposition(
    source.composition,
    catalog,
    plan.initialInput.build,
    basis,
    composition,
    [],
    false,
    true,
    0,
    false,
    state,
  );
  expect(result.permanentStats).toEqual({ S: 18, D: 20, M: 25, Z: 10, I: 20, W: 20, C: 20 });
  const empty = {
    ...composition,
    symbiontCompositionMode: 'ORDINARY_SYMBIONTS' as const,
    ordinarySymbiontInstances: [],
    monsterOrNull: null,
    symbioticMonsterProfileIdOrNull: null,
    instanceIds: [],
  };
  expect(() =>
    deriveSentientComposition(
      source.composition,
      catalog,
      plan.initialInput.build,
      basis,
      empty,
      [],
      false,
      true,
      0,
      false,
      state,
    ),
  ).toThrow('final permanent stat below one');
});
it('separates Advisor initial exact-fill from later permanent loss and temporary unavailability', () => {
  const iw = resolveAdvisorIwRolls([
    { dieSides: 20, rawFace: 12 },
    { dieSides: 20, rawFace: 2 },
  ]);
  const original = resolveSentientAdvisorKnowledge(catalog, {
    cardId: id(1),
    commandId: id(2),
    previousOrNull: null,
    advisorIw: iw,
    permanentStats: stats,
    effectiveStats: stats,
    newChoices: [
      { skillKey: 'UNARMED', targetBonus: 3 },
      { skillKey: 'FENCING', targetBonus: 2 },
    ],
  });
  const temporary = resolveSentientAdvisorKnowledge(catalog, {
    cardId: id(1),
    commandId: id(3),
    previousOrNull: original,
    advisorIw: iw,
    permanentStats: stats,
    effectiveStats: { ...stats, D: 1 },
    newChoices: [],
  });
  expect(temporary.knownSkills).toEqual(original.knownSkills);
  expect(temporary.permanentLosses).toEqual([]);
  const lost = resolveSentientAdvisorKnowledge(catalog, {
    cardId: id(1),
    commandId: id(4),
    previousOrNull: temporary,
    advisorIw: iw,
    permanentStats: { ...stats, S: 8, D: 6 },
    effectiveStats: { ...stats, S: 8, D: 6 },
    newChoices: [],
  });
  expect(lost.knownSkills).toEqual([]);
  expect(lost.permanentLosses.map((row) => row.releasedStartSlots)).toEqual([3, 2]);
  const restored = resolveSentientAdvisorKnowledge(catalog, {
    cardId: id(1),
    commandId: id(5),
    previousOrNull: lost,
    advisorIw: iw,
    permanentStats: stats,
    effectiveStats: stats,
    newChoices: [],
  });
  expect(restored.knownSkills).toEqual([]);
  expect(restored.initialSkills).toEqual(original.initialSkills);
  expect(restored.initialFillCommandId).toBe(id(2));
  expect(() =>
    resolveSentientAdvisorKnowledge(catalog, {
      cardId: id(1),
      commandId: id(6),
      previousOrNull: null,
      advisorIw: iw,
      permanentStats: stats,
      effectiveStats: stats,
      newChoices: [],
    }),
  ).toThrow('underfilled');
});
it('rejects foreign skills, unknown versions, extra/getter/sparse nested records and forged payment shapes', () => {
  const plan = initial();
  expect(() => enemyInitialSkillPlanValue({ ...plan, schemaVersion: 2 })).toThrow('UNRECOGNIZED');
  for (const bad of [
    { ...plan, extra: null },
    { ...plan, initialSkills: [{ ...plan.initialSkills[0], startSlots: 999 }] },
    { ...plan, initialSkills: new Array(1) },
  ])
    expect(() => enemyInitialSkillPlanValue(bad)).toThrow('INVALID_SHAPE');
  let getterCalls = 0;
  const getter = { ...plan };
  Object.defineProperty(getter, 'initialSkills', {
    enumerable: true,
    get() {
      getterCalls++;
      return [];
    },
  });
  expect(() => enemyInitialSkillPlanValue(getter)).toThrow('INVALID_SHAPE');
  expect(getterCalls).toBe(0);
  expect(() =>
    resolve(plan, 2, {
      dolphinCapacity: 5,
      newDolphinChoices: [{ skillKey: 'FOREIGN', targetBonus: 1 }],
    }),
  ).toThrow('unknown SkillKey');
  expect(() =>
    enemySkillAccountingValue({
      ...resolve(plan, 2),
      grossGrantOrNull: { commandId: id(2), bonusBefore: 3, bonusAfter: 6 },
    }),
  ).toThrow('INVALID_SHAPE');
});
