import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MONSTER_STATS,
  customMonsterAttackValue,
  customMonsterManualInputValue,
  customMonsterPhysicsValue,
  customMonsterStatsValue,
  customMonsterSymbiontSelectionValue,
  type CustomMonsterManualInput,
} from './custom-monster.js';

const input = (): CustomMonsterManualInput => ({
  identity: { name: 'Песчаный зверь', description: null, creatureType: 'CUSTOM_MONSTER' },
  stats: {
    statMode: 'MANUAL',
    baseStats: { S: 35, D: 20, M: 10, Z: 20, I: 10, W: 10, C: 10 },
    massKg: 125.5,
    ageYears: 1,
    baseMaxHP: 75,
    rollReceiptOrNull: null,
  },
  physics: {
    naturalArmorDefinition: { mode: 'ZERO' },
    anatomyMode: 'NONSTANDARD_TORSO_ONLY',
    normalizedHitRegion: 'TORSO',
    size: null,
    movement: null,
    physicalTags: [],
    metadataHasNoMechanicalEffect: true,
  },
  attack: {
    category: 'MONSTER_ATTACK',
    distance: 'MELEE',
    actionCost: 1,
    additionalDamageDefinition: {
      mode: 'PER_RESOLUTION_ROLL',
      dieSides: 20,
      multiplier: 1,
      bonus: 0,
    },
    penetrationDefinition: { mode: 'CONSTANT', value: 1.5 },
  },
  symbiont: { mode: 'NONE' },
});

describe('CORE-199/200/202 and ENM-011–016 closed manual CUSTOM_MONSTER input', () => {
  it('keeps the kind separate and detaches a complete NONE input', () => {
    const original = input(),
      decoded = customMonsterManualInputValue(original);
    expect(decoded).toEqual(original);
    expect(decoded).not.toBe(original);
    expect(decoded.stats).not.toBe(original.stats);
  });

  it.each([5, 5.1, 9999.9, 10_000])('accepts supplied inclusive mass/precision %s', (massKg) => {
    expect(customMonsterStatsValue({ ...input().stats, massKg }).massKg).toBe(massKg);
  });
  it.each([0, 4.9, 10_000.1, 5.01, 125.55, Infinity, NaN])(
    'refuses mass %s without rounding',
    (massKg) => {
      expect(() => customMonsterStatsValue({ ...input().stats, massKg })).toThrow();
    },
  );

  it.each(CUSTOM_MONSTER_STATS)(
    'checks the base bounds of %s independently without a sum rule',
    (stat) => {
      for (const value of [1, 35]) {
        const stats = input().stats;
        expect(
          customMonsterStatsValue({ ...stats, baseStats: { ...stats.baseStats, [stat]: value } })
            .baseStats[stat],
        ).toBe(value);
      }
      for (const value of [0, 36, 1.1]) {
        const stats = input().stats;
        expect(() =>
          customMonsterStatsValue({ ...stats, baseStats: { ...stats.baseStats, [stat]: value } }),
        ).toThrow();
      }
    },
  );

  it.each(['ageYears', 'baseMaxHP'])(
    'requires positive integers for %s without an invented game cap',
    (field) => {
      for (const value of [1, 100_000_000])
        expect(customMonsterStatsValue({ ...input().stats, [field]: value })).toHaveProperty(
          field,
          value,
        );
      for (const value of [0, -1, 1.5, Infinity])
        expect(() => customMonsterStatsValue({ ...input().stats, [field]: value })).toThrow();
    },
  );

  it.each(['sex', 'race', 'class', 'skills', 'inventory', 'equipment', 'bodyZones'])(
    'rejects the absent %s container instead of adapting an NPC payload',
    (field) => {
      expect(() => customMonsterManualInputValue({ ...input(), [field]: [] })).toThrow();
    },
  );

  it('does not expose #260 as an executable stat mode or accept a fabricated receipt', () => {
    expect(() => customMonsterStatsValue({ ...input().stats, statMode: 'ROLL_ONCE' })).toThrow();
    expect(() => customMonsterStatsValue({ ...input().stats, rollReceiptOrNull: {} })).toThrow();
    expect(() => customMonsterStatsValue({ ...input().stats, currentHP: 75 })).toThrow();
  });

  it('keeps physics torso-only and metadata explicitly nonmechanical', () => {
    expect(customMonsterPhysicsValue(input().physics)).toEqual(input().physics);
    expect(() =>
      customMonsterPhysicsValue({ ...input().physics, anatomyMode: 'STANDARD_HUMANOID' }),
    ).toThrow();
    expect(() =>
      customMonsterPhysicsValue({ ...input().physics, normalizedHitRegion: 'HEAD' }),
    ).toThrow();
    expect(() =>
      customMonsterPhysicsValue({ ...input().physics, metadataHasNoMechanicalEffect: false }),
    ).toThrow();
    expect(() => customMonsterPhysicsValue({ ...input().physics, bodyZones: [] })).toThrow();
  });

  it.each(['range', 'hitFormula', 'targetingRules', 'customActionCost', 'weapon', 'accuracyBonus'])(
    'refuses custom attack field %s',
    (field) => {
      expect(() => customMonsterAttackValue({ ...input().attack, [field]: 1 })).toThrow();
    },
  );
  it('preserves exactly the source base attack category, distance and cost', () => {
    expect(() => customMonsterAttackValue({ ...input().attack, category: 'UNARMED' })).toThrow();
    expect(() => customMonsterAttackValue({ ...input().attack, distance: 'RANGED' })).toThrow();
    expect(() => customMonsterAttackValue({ ...input().attack, actionCost: 2 })).toThrow();
  });

  it('has one explicit ordinary choice or NONE, with no second specimen or monster mode', () => {
    const choice = {
      speciesKey: 'OWL',
      targetLevel: 1,
      learnedNodeRefs: ['SYM-047'],
      binding: { kind: 'OWL_EYE', side: 'LEFT' },
    };
    expect(customMonsterSymbiontSelectionValue({ mode: 'ORDINARY', symbiont: choice })).toEqual({
      mode: 'ORDINARY',
      symbiont: choice,
    });
    expect(() =>
      customMonsterSymbiontSelectionValue({ mode: 'ORDINARY', symbionts: [choice, choice] }),
    ).toThrow();
    expect(() =>
      customMonsterSymbiontSelectionValue({ mode: 'SYMBIOTIC_MONSTER', symbiont: choice }),
    ).toThrow();
    expect(() => customMonsterSymbiontSelectionValue({ mode: 'NONE', symbiont: choice })).toThrow();
  });
});
