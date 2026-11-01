import { describe, expect, it } from 'vitest';
import type { StatCode } from '@generated/types/character.js';
import { CATALOG, readJson } from '../../../../tests/fixtures/symbiont-stage.js';
import { createCreationFinalizationCatalog } from './catalog.js';
import { deriveAdmissionMechanics, deriveCreationFinalMechanics } from './mechanics.js';
import type { AdmissionMechanicsInput, CreationFinalMechanicsInput } from './types.js';
import type { StatBlock } from '../skill-stage/stats.js';
import { calculateSkillStageStats } from '../skill-stage/stats.js';
import { calculateStartSkillSlots, validateSkillSelectionDraft } from '../skill-stage/skills.js';
import type { SelectedSkillInput } from '../skill-stage/skills.js';
import type { SymbiontSpeciesKey } from '../symbiont-stage/catalog.js';
import { resolveSymbiontComposition } from '../symbiont-stage/composition.js';

const catalog = createCreationFinalizationCatalog(
  CATALOG,
  readJson('generated/spec/character/development-nodes.json'),
);
const zero = (): Record<StatCode, number> => ({ S: 0, D: 0, M: 0, Z: 0, I: 0, W: 0, C: 0 });
function source(
  species: readonly SymbiontSpeciesKey[] = [],
  overrides: Partial<CreationFinalMechanicsInput> = {},
  selectedKeys = ['UNARMED', 'GRAPPLING', 'WEAPON_THROWING', 'ARCHERY'],
): CreationFinalMechanicsInput {
  const raceCode =
    overrides.raceCode ??
    (species.length === 0 ? 'PURE' : species.length === 1 ? 'FREE' : 'UNITED');
  const classCode = raceCode === 'PURE' ? 'SEEKER' : null;
  const creationMode = raceCode === 'PURE' ? null : (overrides.creationMode ?? 'RANDOM');
  const baseStats = overrides.baseStats ?? { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 10, C: 20 };
  const skillStageStats = calculateSkillStageStats(catalog.symbionts.skillStage, {
    raceCode,
    classCode,
    creationMode: creationMode ?? 'MANUAL',
    baseStats,
  }).skillStageStats;
  const fixed = validateSkillSelectionDraft(catalog.symbionts.skillStage, {
    raceCode,
    classCode,
    skillStageStats,
    selectedSkills: [],
  });
  const selectedSkills: SelectedSkillInput[] = [];
  let remaining = fixed.remaining;
  for (const skillKey of selectedKeys) {
    if (remaining === 0) break;
    const targetBonus = Math.min(5, remaining);
    selectedSkills.push({ skillKey, targetBonus });
    remaining -= targetBonus;
  }
  if (remaining !== 0) throw Error('test source requires additional real selected skills');
  const input: CreationFinalMechanicsInput = {
    baseStats,
    raceCode,
    classCode,
    creationMode,
    composition:
      species.length === 0
        ? null
        : resolveSymbiontComposition(catalog.symbionts, {
            raceCode: raceCode as 'FREE' | 'UNITED',
            acceptedSpecies: species.map((speciesKey, acceptedIndex) => ({
              speciesKey,
              acceptedIndex,
            })),
          }),
    learnedSkills: validateSkillSelectionDraft(catalog.symbionts.skillStage, {
      raceCode,
      classCode,
      skillStageStats,
      selectedSkills,
    }).learnedSkills,
    advisorSuppressionBonusOrNull:
      species.includes('ADVISER') && species.includes('TROGR') ? 2 : null,
    permanentGrants: [],
    trainingSlotLedger: null,
    ...overrides,
  };
  const finalized = deriveCreationFinalMechanics(catalog, input);
  expect(finalized.blockers, 'fixture must be a mechanically valid FINAL').toEqual([]);
  return {
    ...input,
    permanentGrants: finalized.permanentGrants,
    trainingSlotLedger: finalized.trainingSlotLedger,
  };
}
function review(
  original = source(),
  overrides: Partial<AdmissionMechanicsInput> = {},
): AdmissionMechanicsInput {
  return {
    source: original,
    permanentGmAdjustments: zero(),
    backpackItemAdjustments: zero(),
    selectedSkills: original.learnedSkills
      .filter((skill) => skill.source === 'SELECTED')
      .map((skill) => ({ skillKey: skill.skillKey, targetBonus: skill.bonus })),
    ...overrides,
  };
}

describe('admission mechanics AQ2-002 / AQ2-005 / CORE-081', () => {
  it.each([
    [],
    ['RAT'],
    ['TEACHER'],
    ['DOLPHIN'],
    ['TROGR', 'DOLPHIN', 'TEACHER', 'ADVISER'],
  ] as const)('retains all unchanged FINAL mechanics for %j', (...species) => {
    // it.each spreads tuple rows; the source helper receives the actual species list.
    const original = source(species);
    const expected = deriveCreationFinalMechanics(catalog, original);
    const actual = deriveAdmissionMechanics(catalog, review(original));
    expect(actual.mechanics).toEqual(expected);
    expect(actual.remainingSlots).toBe(0);
    expect(actual.permanentEffectiveStats).toEqual(expected.effectiveStats);
  });
  it('removes only selected skills while the creation path still requires exact fill', () => {
    const original = source();
    const actual = deriveAdmissionMechanics(catalog, review(original, { selectedSkills: [] }));
    expect(actual.mechanics.learnedSkills).toEqual(
      original.learnedSkills.filter((skill) => skill.source !== 'SELECTED'),
    );
    expect(actual.remainingSlots).toBeGreaterThan(0);
    const creation = deriveCreationFinalMechanics(catalog, {
      ...original,
      learnedSkills: original.learnedSkills.filter((skill) => skill.source !== 'SELECTED'),
    });
    expect(creation.blockers.map((blocker) => blocker.code)).toContain('START_SLOTS_NOT_FILLED');
  });
  it('uses CORE-165 target bonuses and cannot expand the original start pool with W', () => {
    const original = source(['RAT']);
    const actual = deriveAdmissionMechanics(
      catalog,
      review(original, {
        permanentGmAdjustments: { ...zero(), W: 10 },
        backpackItemAdjustments: { ...zero(), W: 10 },
      }),
    );
    expect(actual.maxSlots).toBe(
      calculateStartSkillSlots(deriveCreationFinalMechanics(catalog, original).skillStageStats),
    );
    expect(() =>
      deriveAdmissionMechanics(
        catalog,
        review(original, {
          permanentGmAdjustments: { ...zero(), W: 10 },
          selectedSkills: [{ skillKey: 'UNARMED', targetBonus: 6 }],
        }),
      ),
    ).toThrow(/original starting pool/);
    const larger = source(['RAT'], { baseStats: { ...original.baseStats, W: 14 } });
    expect(
      deriveAdmissionMechanics(
        catalog,
        review(larger, { selectedSkills: [{ skillKey: 'UNARMED', targetBonus: 6 }] }),
      ).usedSlots,
    ).toBe(7);
  });
  it('carries the original training maximum forward, advances only at a new permanent maximum, and ignores backpack W', () => {
    const original = source(['RAT']);
    const before = deriveCreationFinalMechanics(catalog, original);
    const item = deriveAdmissionMechanics(
      catalog,
      review(original, { backpackItemAdjustments: { ...zero(), W: 30 } }),
    );
    expect(item.mechanics.trainingSlotLedger).toEqual(before.trainingSlotLedger);
    const increase = review(original, { permanentGmAdjustments: { ...zero(), W: 6 } });
    const first = deriveAdmissionMechanics(catalog, increase);
    expect(first.mechanics.trainingSlotLedger).toEqual({ maxPermanentWisdom: 16, everIssued: 8 });
    expect(deriveAdmissionMechanics(catalog, increase)).toEqual(first);
    expect(
      deriveAdmissionMechanics(
        catalog,
        review(original, { permanentGmAdjustments: { ...zero(), W: -6 } }),
      ).mechanics.trainingSlotLedger,
    ).toEqual(before.trainingSlotLedger);
  });
  it('does not record a new intermediate W above an explicit Teacher cap', () => {
    const original = source(['TEACHER']);
    const actual = deriveAdmissionMechanics(
      catalog,
      review(original, { permanentGmAdjustments: { ...zero(), W: 50 } }),
    );
    expect(actual.mechanics.skillStageStats.W).toBe(60);
    expect(actual.mechanics.effectiveStats.W).toBe(20);
    expect(actual.mechanics.trainingSlotLedger).toEqual({ maxPermanentWisdom: 20, everIssued: 10 });
  });
  it('applies item bonuses to raw sums before bounds instead of adding them to a previously capped value', () => {
    const original = source(['TEACHER']);
    const actual = deriveAdmissionMechanics(
      catalog,
      review(original, {
        permanentGmAdjustments: { ...zero(), W: 20 },
        backpackItemAdjustments: { ...zero(), W: 10 },
      }),
    );
    expect(actual.permanentEffectiveStats.W).toBe(20);
    expect(actual.mechanics.effectiveStats.W).toBe(20);
    expect(actual.mechanics.statProof.find((p) => p.statCode === 'W')).toMatchObject({
      beforeLimits: 44,
      maximumOrNull: 20,
      effectiveValue: 20,
    });
  });
  it('adds backpack modifiers after the RANDOM negative floor, without spending them on the negative delta', () => {
    const original = source(
      ['PLAGUE_DOCTOR'],
      {
        raceCode: 'UNITED',
        baseStats: { S: 4, D: 2, M: 7, Z: 20, I: 20, W: 10, C: 20 },
      },
      ['VETERAN_DRINKER'],
    );
    const actual = deriveAdmissionMechanics(
      catalog,
      review(original, { backpackItemAdjustments: { ...zero(), S: 3 } }),
    );
    expect(actual.permanentEffectiveStats.S).toBe(1);
    expect(actual.mechanics.effectiveStats.S).toBe(4);
    expect(actual.mechanics.statProof.find((p) => p.statCode === 'S')).toMatchObject({
      appliedNegativeDelta: 0,
      beforeLimits: 4,
    });
  });
  it('allows a corrected intermediate below one when the permanent symbiont result is valid', () => {
    const original = source(['TEACHER']);
    const actual = deriveAdmissionMechanics(
      catalog,
      review(original, { permanentGmAdjustments: { ...zero(), I: -21 } }),
    );
    expect(original.baseStats.I).toBe(20);
    expect(actual.mechanics.skillStageStats.I).toBe(-1);
    expect(actual.permanentEffectiveStats.I).toBe(3);
  });
  it('refuses permanent stats below one even when an item could hide the invalid value', () => {
    const original = source(['RAT']);
    expect(() =>
      deriveAdmissionMechanics(
        catalog,
        review(original, {
          permanentGmAdjustments: { ...zero(), S: -20 },
          backpackItemAdjustments: { ...zero(), S: 100 },
        }),
      ),
    ).toThrow(/STAT_S_BELOW_ONE/);
  });
  it('checks new selected skills against permanent final requirements, excluding backpack support', () => {
    const original = source(['RAT'], {
      baseStats: { S: 10, D: 20, M: 20, Z: 20, I: 20, W: 10, C: 20 },
    });
    const selection = [{ skillKey: 'GROSS', targetBonus: 1 }];
    expect(() =>
      deriveAdmissionMechanics(
        catalog,
        review(original, {
          selectedSkills: selection,
          backpackItemAdjustments: { ...zero(), S: 20 },
        }),
      ),
    ).toThrow(/SKILL_REQUIREMENT/);
    expect(
      deriveAdmissionMechanics(
        catalog,
        review(original, {
          selectedSkills: selection,
          permanentGmAdjustments: { ...zero(), S: 4 },
        }),
      ).mechanics.learnedSkills,
    ).toContainEqual({ source: 'SELECTED', skillKey: 'GROSS', bonus: 1, slotCost: 1 });
  });
  it('does not reissue Trogr grants when selected skills are removed or bonuses change', () => {
    const original = source(['TROGR', 'DOLPHIN', 'TEACHER', 'ADVISER']);
    const before = deriveCreationFinalMechanics(catalog, original);
    const actual = deriveAdmissionMechanics(catalog, review(original, { selectedSkills: [] }));
    expect(actual.mechanics.permanentGrants).toEqual(before.permanentGrants);
    expect(actual.mechanics.learnedSkills.find((skill) => skill.skillKey === 'GROSS')).toEqual(
      before.learnedSkills.find((skill) => skill.skillKey === 'GROSS'),
    );
    expect(actual.mechanics.initialRuntime).toEqual(before.initialRuntime);
    expect(actual.mechanics.symbionts).toEqual(before.symbionts);
  });
  it('checks the permanent GROSS grant after it has been applied, even with no selected skills', () => {
    const original = source(['TROGR', 'DOLPHIN', 'TEACHER', 'ADVISER']);
    const bytes = JSON.stringify(original);
    expect(() =>
      deriveAdmissionMechanics(
        catalog,
        review(original, {
          selectedSkills: [],
          permanentGmAdjustments: { ...zero(), S: -34 },
          backpackItemAdjustments: { ...zero(), S: 100 },
        }),
      ),
    ).toThrow(/SKILL_REQUIREMENT/);
    const valid = deriveAdmissionMechanics(
      catalog,
      review(original, {
        selectedSkills: [],
        permanentGmAdjustments: { ...zero(), S: -33 },
      }),
    );
    expect(valid.permanentEffectiveStats.S).toBe(14);
    expect(valid.mechanics.permanentGrants).toEqual(original.permanentGrants);
    expect(JSON.stringify(original)).toBe(bytes);
  });
  it('rejects free-grant edits, duplicates, invented skills and malformed target bonuses', () => {
    const original = source();
    const grant = original.learnedSkills.find((skill) => skill.source !== 'SELECTED')!;
    for (const selectedSkills of [
      [{ skillKey: grant.skillKey, targetBonus: 1 }],
      [{ skillKey: 'invented', targetBonus: 1 }],
      [{ skillKey: 'UNARMED', targetBonus: 0 }],
      [
        { skillKey: 'UNARMED', targetBonus: 1 },
        { skillKey: 'UNARMED', targetBonus: 2 },
      ],
    ]) {
      expect(() =>
        deriveAdmissionMechanics(catalog, review(original, { selectedSkills })),
      ).toThrow();
    }
  });
  it('rejects unknown, unsafe and negative item adjustments', () => {
    const original = source();
    for (const adjustments of [
      { ...zero(), HP: 1 },
      { ...zero(), S: 0.5 },
      { ...zero(), S: Infinity },
    ]) {
      expect(() =>
        deriveAdmissionMechanics(
          catalog,
          review(original, { permanentGmAdjustments: adjustments }),
        ),
      ).toThrow();
    }
    expect(() =>
      deriveAdmissionMechanics(
        catalog,
        review(original, { backpackItemAdjustments: { ...zero(), S: -1 } }),
      ),
    ).toThrow();
    expect(() =>
      deriveAdmissionMechanics(
        catalog,
        review(original, { permanentGmAdjustments: { ...zero(), S: Number.MAX_SAFE_INTEGER } }),
      ),
    ).toThrow(/safe integer/);
    expect(() =>
      deriveAdmissionMechanics(
        catalog,
        review(original, { permanentGmAdjustments: {} as StatBlock }),
      ),
    ).toThrow(/exactly/);
  });
  it('recomputes each draft from the original source without accumulation or source mutation', () => {
    const original = source(['TEACHER']);
    const input = review(original, {
      permanentGmAdjustments: { ...zero(), S: 2 },
      backpackItemAdjustments: { ...zero(), S: 3 },
    });
    const originalBytes = JSON.stringify(original),
      inputBytes = JSON.stringify(input);
    const first = deriveAdmissionMechanics(catalog, input);
    expect(deriveAdmissionMechanics(catalog, input)).toEqual(first);
    expect(deriveAdmissionMechanics(catalog, review(original)).mechanics.effectiveStats.S).toBe(
      first.mechanics.effectiveStats.S - 5,
    );
    expect(JSON.stringify(original)).toBe(originalBytes);
    expect(JSON.stringify(input)).toBe(inputBytes);
    expect(Object.isFrozen(first.mechanics.effectiveStats)).toBe(true);
    expect(Object.isFrozen(first.mechanics.trainingSlotLedger)).toBe(true);
  });
});
