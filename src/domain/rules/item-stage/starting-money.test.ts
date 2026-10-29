import { describe, expect, it } from 'vitest';

import {
  CANONICAL_STARTING_MONEY_CATALOG,
  recommendStartingWealth,
  validateMoneyFace,
  type StartingMoneyCatalog,
} from './starting-money.js';

describe('CORE-172 starting money recommendation', () => {
  it.each([
    [1, 'NONE', 'нет денег', '1–4'],
    [4, 'NONE', 'нет денег', '1–4'],
    [5, 'SMALL', 'малая сумма', '5–9'],
    [9, 'SMALL', 'малая сумма', '5–9'],
    [10, 'ORDINARY', 'обычная', '10–14'],
    [14, 'ORDINARY', 'обычная', '10–14'],
    [15, 'LARGE', 'крупная', '15–18'],
    [18, 'LARGE', 'крупная', '15–18'],
    [19, 'EXCEPTIONAL', 'исключительная', '19'],
    [20, 'RARE_FORTUNE', 'редкое состояние', '20'],
  ] as const)(
    'maps face %i to the exact Q-CORE-052 recommendation',
    (rawFace, kind, label, range) => {
      expect(recommendStartingWealth(rawFace)).toEqual({ kind, label, range, rawFace });
    },
  );

  it('covers every D20 face once without gaps or overlapping ranges', () => {
    for (let face = 1; face <= 20; face++) {
      const entries = CANONICAL_STARTING_MONEY_CATALOG.wealthScale.filter(
        (entry) => face >= entry.minFace && face <= entry.maxFace,
      );
      expect(entries).toHaveLength(1);
      expect(recommendStartingWealth(face).kind).toBe(entries[0]!.kind);
    }
  });

  it.each([
    0,
    -0,
    -1,
    21,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER,
    '20',
    null,
    undefined,
  ])('refuses invalid face %s without coercion', (face) => {
    expect(() => validateMoneyFace(face as number)).toThrow('safe integer in 1..20');
    expect(() => recommendStartingWealth(face as number)).toThrow('safe integer in 1..20');
  });

  it('natural 1/20 only produce immutable recommendations with no final amount or effects', () => {
    for (const face of [1, 20]) {
      const result = recommendStartingWealth(face);
      expect(Object.keys(result).sort()).toEqual(['kind', 'label', 'range', 'rawFace']);
      expect(Object.isFrozen(result)).toBe(true);
      expect(recommendStartingWealth(face)).toEqual(result);
    }
    expect(CANONICAL_STARTING_MONEY_CATALOG.gmFinalizationRequired).toBe(true);
    expect(Object.isFrozen(CANONICAL_STARTING_MONEY_CATALOG.wealthScale[0])).toBe(true);
  });

  it.each([
    { dieSides: 12 },
    { gmFinalizationRequired: false },
    { finalAmount: 100 },
    { wealthScale: [] },
    {
      wealthScale: CANONICAL_STARTING_MONEY_CATALOG.wealthScale.map((entry, index) =>
        index === 0 ? { ...entry, maxFace: 5 } : entry,
      ),
    },
    {
      wealthScale: CANONICAL_STARTING_MONEY_CATALOG.wealthScale.map((entry, index) =>
        index === 0 ? { ...entry, label: 'Отсутствует/непригоден' } : entry,
      ),
    },
  ])('refuses a noncanonical scale or finalization policy: %j', (patch) => {
    const catalog = {
      ...CANONICAL_STARTING_MONEY_CATALOG,
      ...patch,
    } as unknown as StartingMoneyCatalog;
    expect(() => recommendStartingWealth(4, catalog)).toThrow('starting money:');
  });
});
