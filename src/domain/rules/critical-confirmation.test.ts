import { describe, expect, it } from 'vitest';

import type { MechanicalRoll } from '../index.js';
import { resolveCreationCritical, resolveCriticalConfirmation } from '../index.js';

function d20(rawFace: number): MechanicalRoll {
  return { dieSides: 20, rawFace };
}

describe('source-neutral critical confirmation', () => {
  it('distinguishes a pending success from terminal miss and grade cap', () => {
    expect(
      resolveCriticalConfirmation({ originRoll: d20(20), confirmationRolls: [d20(15)] }),
    ).toEqual({ originFace: 20, criticalGrade: 1, criticalPolarity: 'SUCCESS', terminal: false });
    expect(
      resolveCriticalConfirmation({
        originRoll: d20(20),
        confirmationRolls: [d20(15), d20(14)],
      }),
    ).toEqual({ originFace: 20, criticalGrade: 1, criticalPolarity: 'SUCCESS', terminal: true });
    expect(
      resolveCriticalConfirmation({
        originRoll: d20(20),
        confirmationRolls: [d20(20), d20(19), d20(18), d20(17), d20(16)],
      }),
    ).toEqual({ originFace: 20, criticalGrade: 5, criticalPolarity: 'SUCCESS', terminal: true });
  });

  it('returns unconfirmed and failure facts without stat value or creation penalty', () => {
    const unconfirmed = resolveCriticalConfirmation({
      originRoll: d20(20),
      confirmationRolls: [d20(14)],
    });
    expect(unconfirmed).toEqual({
      originFace: 20,
      criticalGrade: 0,
      criticalPolarity: 'NONE',
      terminal: true,
    });
    const failure = resolveCriticalConfirmation({
      originRoll: d20(1),
      confirmationRolls: [d20(5), d20(6)],
    });
    expect(failure).toEqual({
      originFace: 1,
      criticalGrade: 1,
      criticalPolarity: 'FAILURE',
      terminal: true,
    });
    for (const outcome of [unconfirmed, failure]) {
      expect(outcome).not.toHaveProperty('value');
      expect(outcome).not.toHaveProperty('creationCriticalPenalty');
      expect(outcome).not.toHaveProperty('xp');
    }
  });

  it('preserves the existing CHR-004 stat adapter behavior', () => {
    const input = { originRoll: d20(20), confirmationRolls: [d20(15), d20(14)] };
    expect(resolveCreationCritical(input)).toEqual({
      criticalGrade: 1,
      criticalPolarity: 'SUCCESS',
      value: 21,
    });
    expect(
      resolveCreationCritical({ originRoll: d20(1), confirmationRolls: [d20(5), d20(6)] }),
    ).toEqual({
      creationCriticalPenalty: -1,
      criticalGrade: 1,
      criticalPolarity: 'FAILURE',
      value: 1,
    });
  });
});
