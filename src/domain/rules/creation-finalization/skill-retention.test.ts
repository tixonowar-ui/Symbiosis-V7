import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../../../tests/fixtures/symbiont-stage.js';
import { revalidateCreationSkillRetention } from './skill-retention.js';
import { validateSkillRequirements } from '../skill-stage/skills.js';
const stats = { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 };
describe('CORE-166/AQA-004 permanent skill retention', () => {
  it('removes an acquired skill exactly below its permanent threshold and preserves its pool cost', () => {
    const gross = { skillKey: 'GROSS', bonus: 3, slotCost: 3 };
    expect(
      revalidateCreationSkillRetention(CATALOG.skillStage, [gross], { ...stats, S: 14 }).retained,
    ).toEqual([gross]);
    const result = revalidateCreationSkillRetention(CATALOG.skillStage, [gross], {
      ...stats,
      S: 13,
    });
    expect(result.retained).toEqual([]);
    expect(result.removed).toEqual([gross]);
    expect(Object.isFrozen(result.removed[0])).toBe(true);
  });
  it('does not delete skills just because a lower W overfills their pool', () => {
    const skill = { skillKey: 'UNARMED', bonus: 5, slotCost: 5 };
    expect(
      revalidateCreationSkillRetention(CATALOG.skillStage, [skill], { ...stats, W: 1 }).retained,
    ).toEqual([skill]);
  });
  it('keeps acquisition pre-symbiont independently of later effective retention', () => {
    expect(() =>
      validateSkillRequirements(CATALOG.skillStage, 'GROSS', { ...stats, S: 13 }),
    ).toThrow();
    expect(
      revalidateCreationSkillRetention(
        CATALOG.skillStage,
        [{ skillKey: 'GROSS', bonus: 1, slotCost: 1 }],
        stats,
      ).retained,
    ).toHaveLength(1);
  });
  it('rejects unknown skills and malformed inputs instead of silently deleting them', () => {
    expect(() =>
      revalidateCreationSkillRetention(
        CATALOG.skillStage,
        [{ skillKey: 'UNKNOWN', bonus: 1, slotCost: 1 }],
        stats,
      ),
    ).toThrow();
    expect(() =>
      revalidateCreationSkillRetention(
        CATALOG.skillStage,
        [{ skillKey: 'GROSS', bonus: 1, slotCost: 1 }],
        { ...stats, S: NaN },
      ),
    ).toThrow();
  });
});
