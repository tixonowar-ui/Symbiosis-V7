import { describe, expect, it } from 'vitest';

import { CATALOG, readJson } from '../../../../tests/fixtures/symbiont-stage.js';
import { calculateSkillStageStats } from '../skill-stage/stats.js';
import { validateSkillSelectionDraft } from '../skill-stage/skills.js';
import { resolveSymbiontComposition } from '../symbiont-stage/composition.js';
import type { SymbiontSpeciesKey } from '../symbiont-stage/catalog.js';
import { deriveCreationFinalMechanics } from './mechanics.js';
import { createCreationFinalizationCatalog } from './catalog.js';
import type { CreationFinalMechanicsInput } from './types.js';

const catalog = createCreationFinalizationCatalog(
  CATALOG,
  readJson('generated/spec/character/development-nodes.json'),
);
function input(
  species: readonly SymbiontSpeciesKey[] = [],
  overrides: Partial<CreationFinalMechanicsInput> = {},
): CreationFinalMechanicsInput {
  const raceCode =
    overrides.raceCode ??
    (species.length === 0 ? 'PURE' : species.length === 1 ? 'FREE' : 'UNITED');
  const baseStats = overrides.baseStats ?? { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 };
  const classCode = overrides.classCode ?? (raceCode === 'PURE' ? 'SEEKER' : null);
  const creationMode = raceCode === 'PURE' ? null : (overrides.creationMode ?? 'RANDOM');
  const skillStageStats = calculateSkillStageStats(catalog.symbionts.skillStage, {
    raceCode,
    classCode,
    creationMode: creationMode ?? 'MANUAL',
    baseStats,
  }).skillStageStats;
  return {
    baseStats,
    raceCode,
    classCode,
    creationMode,
    composition:
      raceCode === 'PURE'
        ? null
        : resolveSymbiontComposition(catalog.symbionts, {
            raceCode,
            acceptedSpecies: species.map((speciesKey, acceptedIndex) => ({
              speciesKey,
              acceptedIndex,
            })),
          }),
    learnedSkills: validateSkillSelectionDraft(catalog.symbionts.skillStage, {
      raceCode,
      classCode,
      skillStageStats,
      selectedSkills: [],
    }).learnedSkills,
    advisorSuppressionBonusOrNull:
      species.includes('ADVISER') && species.includes('TROGR') ? 2 : null,
    permanentGrants: [],
    trainingSlotLedger: null,
    ...overrides,
  };
}

describe('source-backed final mechanics (AQA-005/008/009)', () => {
  it.each(catalog.symbionts.species.map((species) => species.speciesKey))(
    'initializes source-backed L1 %s without runtime objects or free XP',
    (speciesKey) => {
      const species = catalog.symbionts.species.find((entry) => entry.speciesKey === speciesKey)!;
      const result = deriveCreationFinalMechanics(
        catalog,
        input([speciesKey], { raceCode: species.kind === 'SYMBIOTIC_MONSTER' ? 'UNITED' : 'FREE' }),
      );
      expect(result.symbionts[0]).toMatchObject({
        level: 1,
        xp: 0,
        maxOe: species.initialCurrentOe,
        currentOe: species.initialCurrentOe,
      });
      expect(result.symbionts[0]!.learnedNodeRefs).toHaveLength(1);
      expect(result.initialRuntime.equippedItems).toEqual([]);
      expect(result.initialRuntime.generatedObjects).toEqual([]);
    },
  );
  it('keeps PURE acquisition absent, applies its class, and creates clean unequipped runtime', () => {
    const result = deriveCreationFinalMechanics(catalog, input());
    expect(result.effectiveStats).toEqual(result.skillStageStats);
    expect(result.symbionts).toEqual([]);
    expect(result.initialRuntime).toMatchObject({
      currentHp: 100,
      maxHp: 100,
      equippedItems: [],
      temporaryEffects: [],
      wounds: [],
      initiativeOrNull: null,
      symbiontXpProgressPoints: 0,
    });
    expect(result.blockers.some((blocker) => blocker.kind === 'SKILLS')).toBe(true);
  });
  it('uses the final Teacher W cap and the sole-Teacher I bonus without lowering I above20', () => {
    const result = deriveCreationFinalMechanics(
      catalog,
      input(['TEACHER'], { baseStats: { S: 20, D: 20, M: 20, Z: 20, I: 30, W: 30, C: 20 } }),
    );
    expect(result.effectiveStats.W).toBe(20);
    expect(result.effectiveStats.I).toBe(30);
    const ordinary = deriveCreationFinalMechanics(
      catalog,
      input(['TEACHER'], { baseStats: { S: 20, D: 20, M: 20, Z: 20, I: 10, W: 10, C: 20 } }),
    );
    expect(ordinary.effectiveStats).toMatchObject({ W: 14, I: 14 });
  });
  it('does not give the sole-Teacher I bonus when another symbiont is present', () => {
    const result = deriveCreationFinalMechanics(
      catalog,
      input(['TEACHER', 'OWL', 'TICK', 'CRICKET']),
    );
    const withoutTeacherI = result.statProof.find((proof) => proof.statCode === 'I')!;
    expect(withoutTeacherI.positiveSymbiontDelta).toBe(0);
  });
  it('adds all active positive deltas before applying the Dolphin I cap', () => {
    const result = deriveCreationFinalMechanics(
      catalog,
      input(['DOLPHIN'], { baseStats: { S: 20, D: 20, M: 20, Z: 20, I: 29, W: 20, C: 20 } }),
    );
    expect(result.effectiveStats.I).toBe(30);
  });
  it('limits RANDOM negative Plague Doctor deltas but does not repair an invalid race value', () => {
    const source = input(['PLAGUE_DOCTOR'], {
      raceCode: 'UNITED',
      baseStats: { S: 4, D: 2, M: 7, Z: 20, I: 20, W: 20, C: 20 },
    });
    const result = deriveCreationFinalMechanics(catalog, source);
    expect(result.effectiveStats).toMatchObject({ S: 1, D: 1, M: 1 });
    const invalid = deriveCreationFinalMechanics(catalog, {
      ...source,
      baseStats: { ...source.baseStats, S: 1 },
    });
    expect(invalid.effectiveStats.S).toBe(-2);
    expect(invalid.blockers.some((blocker) => blocker.code === 'STAT_S_BELOW_ONE')).toBe(true);
  });
  it('has no general floor for MANUAL negative modifiers', () => {
    const result = deriveCreationFinalMechanics(
      catalog,
      input(['SKUNK'], {
        creationMode: 'MANUAL',
        baseStats: { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 1 },
      }),
    );
    expect(result.effectiveStats.C).toBeLessThan(1);
    expect(result.blockers.some((blocker) => blocker.code === 'STAT_C_BELOW_ONE')).toBe(true);
  });
  it('resolves absorption, L5 stats, free nodes, permanent GROSS and spent OE without refilling', () => {
    const result = deriveCreationFinalMechanics(
      catalog,
      input(['TROGR', 'DOLPHIN', 'KEEPER', 'TEACHER']),
    );
    expect(result.effectiveStats).toMatchObject({ S: 25, D: 25, M: 25, Z: 25, I: 4, W: 4, C: 1 });
    const trogr = result.symbionts.find((entry) => entry.speciesKey === 'TROGR')!;
    expect(trogr.level).toBe(5);
    expect(trogr.maxOe).toBe(5000);
    expect(trogr.currentOe).toBeLessThan(1000);
    expect(trogr.learnedNodeRefs).toEqual(['SYM-076', 'SYM-077', 'SYM-078', 'SYM-079', 'SYM-080']);
    expect(result.initialRuntime.maxHp).toBe(200);
    expect(result.initialRuntime.currentHp).toBe(200);
    expect(result.learnedSkills).toContainEqual({
      source: 'SYMBIONT_PERMANENT',
      skillKey: 'GROSS',
      bonus: 3,
      slotCost: 0,
    });
  });
  it('applies Adviser B only to Trogr minimum I and preserves its inactive nodes', () => {
    const result = deriveCreationFinalMechanics(
      catalog,
      input(['TROGR', 'DOLPHIN', 'TEACHER', 'ADVISER']),
    );
    expect(result.effectiveStats.I).toBe(6);
    expect(result.effectiveStats.W).toBe(4);
    expect(result.symbionts.find((entry) => entry.speciesKey === 'ADVISER')).toMatchObject({
      effectsEnabled: false,
      xpEligible: false,
      learnedNodeRefs: ['SYM-096'],
    });
  });
  it('does not repeat a permanent grant after removing or revisiting Trogr', () => {
    const first = deriveCreationFinalMechanics(catalog, input(['TROGR', 'DOLPHIN', 'OWL', 'TICK']));
    const removed = deriveCreationFinalMechanics(
      catalog,
      input([], { permanentGrants: first.permanentGrants }),
    );
    expect(removed.learnedSkills.find((skill) => skill.skillKey === 'GROSS')?.bonus).toBe(3);
    const replay = deriveCreationFinalMechanics(
      catalog,
      input(['TROGR', 'DOLPHIN', 'OWL', 'TICK'], { permanentGrants: first.permanentGrants }),
    );
    expect(replay.permanentGrants).toEqual(first.permanentGrants);
    expect(replay.learnedSkills.find((skill) => skill.skillKey === 'GROSS')?.bonus).toBe(3);
  });
  it('keeps a historical training maximum when W falls and does not issue it twice', () => {
    const baseStats = { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 10, C: 20 };
    const first = deriveCreationFinalMechanics(catalog, input(['TEACHER'], { baseStats }));
    expect(first.trainingSlotLedger).toEqual({ maxPermanentWisdom: 14, everIssued: 7 });
    const lower = deriveCreationFinalMechanics(
      catalog,
      input(['RAT'], { baseStats, trainingSlotLedger: first.trainingSlotLedger }),
    );
    expect(lower.trainingSlotLedger).toEqual(first.trainingSlotLedger);
    const restored = deriveCreationFinalMechanics(
      catalog,
      input(['TEACHER'], { baseStats, trainingSlotLedger: lower.trainingSlotLedger }),
    );
    expect(restored.trainingSlotLedger).toEqual(first.trainingSlotLedger);
    const higher = deriveCreationFinalMechanics(
      catalog,
      input(['TEACHER', 'OWL', 'RAT', 'TICK'], {
        baseStats,
        trainingSlotLedger: first.trainingSlotLedger,
      }),
    );
    expect(higher.trainingSlotLedger.maxPermanentWisdom).toBeGreaterThan(14);
    expect(higher.trainingSlotLedger.everIssued).toBe(Math.floor(higher.effectiveStats.W / 2));
  });
  it('accepts a historically overfilled skill pool after W decreases', () => {
    const before = input(['RAT']);
    const skillStageStats = calculateSkillStageStats(catalog.symbionts.skillStage, {
      raceCode: 'FREE',
      classCode: null,
      creationMode: 'RANDOM',
      baseStats: before.baseStats,
    }).skillStageStats;
    const learnedSkills = validateSkillSelectionDraft(catalog.symbionts.skillStage, {
      raceCode: 'FREE',
      classCode: null,
      skillStageStats,
      selectedSkills: [{ skillKey: 'GROSS', targetBonus: 5 }],
    }).learnedSkills;
    const result = deriveCreationFinalMechanics(catalog, {
      ...before,
      baseStats: { ...before.baseStats, W: 2 },
      learnedSkills,
    });
    expect(result.blockers.filter((blocker) => blocker.kind === 'SKILLS')).toEqual([]);
    expect(result.learnedSkills.find((skill) => skill.skillKey === 'GROSS')?.bonus).toBe(5);
  });
  it('blocks an acquired skill whose permanent symbiont loss crosses an explicit requirement', () => {
    const before = input(['RAT'], {
      baseStats: { S: 14, D: 20, M: 20, Z: 20, I: 20, W: 2, C: 20 },
    });
    const learnedSkills = validateSkillSelectionDraft(catalog.symbionts.skillStage, {
      raceCode: 'FREE',
      classCode: null,
      skillStageStats: before.baseStats,
      selectedSkills: [{ skillKey: 'GROSS', targetBonus: 1 }],
    }).learnedSkills;
    const valid = deriveCreationFinalMechanics(catalog, { ...before, learnedSkills });
    expect(valid.blockers.filter((b) => b.code === 'SKILL_REQUIREMENT')).toEqual([]);
    const lowered = deriveCreationFinalMechanics(
      catalog,
      input(['PLAGUE_DOCTOR'], {
        raceCode: 'UNITED',
        creationMode: 'MANUAL',
        baseStats: { ...before.baseStats, S: 23 },
        learnedSkills: learnedSkills.filter((s) => s.source === 'SELECTED'),
      }),
    );
    expect(lowered.skillStageStats.S).toBe(16);
    expect(lowered.effectiveStats.S).toBe(11);
    expect(lowered.blockers.some((b) => b.code === 'SKILL_REQUIREMENT')).toBe(true);
  });
  it('keeps supplied manual monsters valid and applies no generic negative floor', () => {
    const result = deriveCreationFinalMechanics(
      catalog,
      input(['PLAGUE_DOCTOR'], {
        raceCode: 'UNITED',
        creationMode: 'MANUAL',
        baseStats: { S: 8, D: 2, M: 11, Z: 20, I: 20, W: 20, C: 20 },
      }),
    );
    expect(result.effectiveStats.S).toBe(-4);
    expect(result.blockers.some((blocker) => blocker.kind === 'SYMBIONT_COMPOSITION')).toBe(false);
  });
  it('does not impose the enemy-only base cap35 on final player stats', () => {
    const result = deriveCreationFinalMechanics(
      catalog,
      input(['PLAGUE_DOCTOR'], {
        raceCode: 'UNITED',
        baseStats: { S: 20, D: 20, M: 20, Z: 20, I: 35, W: 20, C: 20 },
      }),
    );
    expect(result.effectiveStats.I).toBe(45);
  });
  it('keeps suppressed Taipan without XP eligibility or active effects', () => {
    const result = deriveCreationFinalMechanics(catalog, input(['TAIPAN', 'TOAD', 'OWL', 'RAT']));
    expect(result.symbionts.find((entry) => entry.speciesKey === 'TAIPAN')).toMatchObject({
      status: 'SUPPRESSED',
      effectsEnabled: false,
      xpEligible: false,
    });
  });
  it('keeps Penguin passive inactive when suppressed and does not pre-create objects', () => {
    const result = deriveCreationFinalMechanics(
      catalog,
      input(['TROGR', 'PENGUIN', 'RAT', 'MANTIS']),
    );
    expect(result.initialRuntime).toMatchObject({
      penguinMiMiMiActive: false,
      ratInsideHost: true,
      mantisBladeStateOrNull: 'ORDINARY',
      generatedObjects: [],
      externalEntities: [],
    });
  });
  it('rejects tampered composition OE rather than repairing durable history', () => {
    const source = input(['TROGR']);
    expect(() =>
      deriveCreationFinalMechanics(catalog, {
        ...source,
        composition: {
          ...source.composition!,
          instances: source.composition!.instances.map((entry) => ({ ...entry, currentOe: 999 })),
        },
      }),
    ).toThrow(/resolved composition/);
  });
  it('rejects duplicate grants and invalid suppression witnesses', () => {
    const source = input(['TROGR', 'ADVISER', 'DOLPHIN', 'OWL']);
    expect(() =>
      deriveCreationFinalMechanics(catalog, { ...source, advisorSuppressionBonusOrNull: 6 }),
    ).toThrow(/suppression/);
    const grant = { kind: 'TROGR_GROSS', bonusBefore: 0, bonusAfter: 3 } as const;
    expect(() =>
      deriveCreationFinalMechanics(catalog, input([], { permanentGrants: [grant, grant] })),
    ).toThrow(/only once/);
  });
  it('never mutates supplied state and returns deeply frozen serializable values', () => {
    const source = input(['TROGR', 'DOLPHIN', 'OWL', 'TICK']);
    const before = JSON.stringify(source);
    const result = deriveCreationFinalMechanics(catalog, source);
    expect(JSON.stringify(source)).toBe(before);
    expect(Object.isFrozen(result.initialRuntime.equippedItems)).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
