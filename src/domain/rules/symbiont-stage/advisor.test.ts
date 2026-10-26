import { describe, expect, it } from 'vitest';

import { validateSkillRequirements } from '../skill-stage/skills.js';
import {
  calculateTrogrSuppressionBonus,
  createAdvisorSkillStats,
  deriveAdvisorSuppressionMinimumI,
  resolveAdvisorIwRolls,
  validateAdvisorSkillSelection,
  type AdvisorBodyStats,
  type AdvisorIwResult,
} from './advisor.js';
import { CATALOG, d20 } from '../../../../tests/fixtures/symbiont-stage.js';

const BODY: AdvisorBodyStats = Object.freeze({ S: 1, D: 14, M: 1, Z: 1, C: 1 });

function advisor(iFace: number, wFace: number): AdvisorIwResult {
  return resolveAdvisorIwRolls([d20(iFace), d20(wFace)]);
}

describe('CHR-041 Advisor rolls, skills, and suppression', () => {
  it('resolves two independent raw D20+8 results in I,W order without critical or XP outcomes', () => {
    const result = advisor(1, 20);
    expect(result).toEqual({
      I: { rawFace: 1, value: 9 },
      W: { rawFace: 20, value: 28 },
    });
    expect(advisor(20, 1)).toEqual({
      I: { rawFace: 20, value: 28 },
      W: { rawFace: 1, value: 9 },
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of ['critical', 'Penalty', 'XP', 'xp', 'grade', 'polarity']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('combines own I/W with exactly S/D/M/Z/C of the current body', () => {
    const stats = createAdvisorSkillStats({ advisorIw: advisor(8, 2), bodyStats: BODY });
    expect(stats).toEqual({ S: 1, D: 14, M: 1, Z: 1, I: 16, W: 10, C: 1 });
    expect(() =>
      createAdvisorSkillStats({
        advisorIw: advisor(8, 2),
        bodyStats: { ...BODY, I: 20 } as AdvisorBodyStats,
      }),
    ).toThrow('exactly S,D,M,Z,C');
    expect(() =>
      createAdvisorSkillStats({ advisorIw: advisor(8, 2), bodyStats: { ...BODY, D: 13 } }),
    ).not.toThrow();
  });

  it('uses own I/W rather than body values for skill eligibility', () => {
    const eligibleI = createAdvisorSkillStats({ advisorIw: advisor(8, 2), bodyStats: BODY });
    const ineligibleI = createAdvisorSkillStats({ advisorIw: advisor(7, 2), bodyStats: BODY });
    expect(() =>
      validateSkillRequirements(CATALOG.skillStage, 'ANALYTICAL_THINKING', eligibleI),
    ).not.toThrow();
    expect(() =>
      validateSkillRequirements(CATALOG.skillStage, 'ANALYTICAL_THINKING', ineligibleI),
    ).toThrow('REQ-ANALYTICAL_THINKING-I');

    const eligibleW = createAdvisorSkillStats({ advisorIw: advisor(8, 8), bodyStats: BODY });
    const ineligibleW = createAdvisorSkillStats({ advisorIw: advisor(8, 7), bodyStats: BODY });
    expect(() =>
      validateSkillRequirements(CATALOG.skillStage, 'AWARENESS', eligibleW),
    ).not.toThrow();
    expect(() => validateSkillRequirements(CATALOG.skillStage, 'AWARENESS', ineligibleW)).toThrow(
      'REQ-AWARENESS-W',
    );
  });

  it('uses current body requirements and exact-fill ceil(W/2) without race/class grants', () => {
    const result = validateAdvisorSkillSelection(CATALOG.skillStage, {
      advisorIw: advisor(4, 2),
      bodyStats: BODY,
      selectedSkills: [{ skillKey: 'ACROBATICS', targetBonus: 5 }],
    });
    expect(result).toMatchObject({ capacity: 5, used: 5, remaining: 0 });
    expect(result.advisorStats).toEqual({ S: 1, D: 14, M: 1, Z: 1, I: 12, W: 10, C: 1 });
    expect(result.learnedSkills).toEqual([{ skillKey: 'ACROBATICS', bonus: 5, slotCost: 5 }]);

    expect(() =>
      validateAdvisorSkillSelection(CATALOG.skillStage, {
        advisorIw: advisor(4, 2),
        bodyStats: { ...BODY, D: 13 },
        selectedSkills: [{ skillKey: 'ACROBATICS', targetBonus: 5 }],
      }),
    ).toThrow('REQ-ACROBATICS-D');
    expect(() =>
      validateAdvisorSkillSelection(CATALOG.skillStage, {
        advisorIw: advisor(4, 2),
        bodyStats: BODY,
        selectedSkills: [{ skillKey: 'ACROBATICS', targetBonus: 4 }],
      }),
    ).toThrow('underfilled: used 4, capacity 5');
    expect(() =>
      validateAdvisorSkillSelection(CATALOG.skillStage, {
        advisorIw: advisor(4, 2),
        bodyStats: BODY,
        selectedSkills: [{ skillKey: 'ACROBATICS', targetBonus: 6 }],
      }),
    ).toThrow('exceeded: used 7, capacity 5');
  });

  it('accepts zero and negative current body stats for own-W-only exact-fill without clamping', () => {
    const result = validateAdvisorSkillSelection(CATALOG.skillStage, {
      advisorIw: advisor(1, 8),
      bodyStats: { S: 0, D: -5, M: 0, Z: -20, C: -3 },
      selectedSkills: [
        { skillKey: 'AWARENESS', targetBonus: 1 },
        { skillKey: 'COOKING', targetBonus: 6 },
      ],
    });

    expect(result).toMatchObject({ capacity: 8, used: 8, remaining: 0 });
    expect(result.advisorStats).toEqual({ S: 0, D: -5, M: 0, Z: -20, I: 9, W: 16, C: -3 });
    expect(result.learnedSkills).toEqual([
      { skillKey: 'AWARENESS', bonus: 1, slotCost: 1 },
      { skillKey: 'COOKING', bonus: 6, slotCost: 7 },
    ]);
  });

  it('rejects duplicate, fixed, unknown, and malformed Advisor selections', () => {
    const base = { advisorIw: advisor(4, 2), bodyStats: BODY };
    expect(() =>
      validateAdvisorSkillSelection(CATALOG.skillStage, {
        ...base,
        selectedSkills: [
          { skillKey: 'ACROBATICS', targetBonus: 4 },
          { skillKey: 'ACROBATICS', targetBonus: 1 },
        ],
      }),
    ).toThrow('more than once');
    expect(() =>
      validateAdvisorSkillSelection(CATALOG.skillStage, {
        ...base,
        selectedSkills: [{ skillKey: 'FOLLOWING_PAIN', targetBonus: 5 }],
      }),
    ).toThrow('non-selectable category');
    expect(() =>
      validateAdvisorSkillSelection(CATALOG.skillStage, {
        ...base,
        selectedSkills: [{ skillKey: 'UNKNOWN', targetBonus: 5 }],
      }),
    ).toThrow('unknown Advisor SkillKey');
    expect(() =>
      validateAdvisorSkillSelection(CATALOG.skillStage, {
        ...base,
        selectedSkills: [{ skillKey: 'ACROBATICS', targetBonus: 0 }],
      }),
    ).toThrow('positive integer');
  });

  it.each([
    [1, 0],
    [2, 1],
    [3, 1],
    [4, 1],
    [5, 1],
    [6, 2],
    [7, 2],
    [8, 2],
    [9, 2],
    [10, 3],
    [11, 3],
    [12, 3],
    [13, 3],
    [14, 4],
    [15, 4],
    [16, 4],
    [17, 4],
    [18, 5],
    [19, 5],
    [20, 5],
  ])('rounds suppression R20/4 half-up for raw face %i', (face, expected) => {
    expect(calculateTrogrSuppressionBonus(d20(face))).toBe(expected);
  });

  it('derives the suppression minimum separately from Advisor I/W and preserves no-crit rolls', () => {
    expect(deriveAdvisorSuppressionMinimumI({ suppressionB: 3, teacherAbsorbed: false })).toBe(4);
    expect(deriveAdvisorSuppressionMinimumI({ suppressionB: 3, teacherAbsorbed: true })).toBe(7);
    expect(() => calculateTrogrSuppressionBonus(d20(0))).toThrow('1..20');
    expect(() =>
      deriveAdvisorSuppressionMinimumI({ suppressionB: 6, teacherAbsorbed: false }),
    ).toThrow('0..5');
  });
});
