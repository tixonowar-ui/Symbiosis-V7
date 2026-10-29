import type { SkillStageCatalog } from '../skill-stage/catalog.js';
import type { StatBlock } from '../skill-stage/stats.js';
import { CreationFinalizationError } from './catalog.js';

/** CORE-166/AQA-004 concern retention after a confirmed permanent change,
 * not acquisition: new ordinary skills still use SKILL_STAGE_PRE_SYMBIONT. */
export function revalidateCreationSkillRetention<
  T extends {
    readonly skillKey: string;
    readonly bonus: number;
    readonly slotCost: number;
  },
>(
  catalog: SkillStageCatalog,
  learnedSkills: readonly T[],
  requirementStats: StatBlock,
): { readonly retained: readonly T[]; readonly removed: readonly T[] } {
  const statCodes = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
  if (statCodes.some((code) => !Number.isSafeInteger(requirementStats[code])))
    throw new CreationFinalizationError('skill retention requires seven safe integer stats');
  const retained: T[] = [],
    removed: T[] = [];
  const seen = new Set<string>();
  for (const skill of learnedSkills) {
    if (
      !catalog.skills.some((entry) => entry.skillKey === skill.skillKey) ||
      seen.has(skill.skillKey)
    )
      throw new CreationFinalizationError('skill retention requires known unique skills');
    if (
      !Number.isSafeInteger(skill.bonus) ||
      skill.bonus < 1 ||
      !Number.isSafeInteger(skill.slotCost) ||
      skill.slotCost < 0
    )
      throw new CreationFinalizationError('skill retention requires valid learned skill values');
    seen.add(skill.skillKey);
    const valid = catalog.requirements
      .filter((row) => row.skillKey === skill.skillKey)
      .every((row) => requirementStats[row.statCode] >= row.minValue);
    (valid ? retained : removed).push(Object.freeze({ ...skill }));
  }
  // Capacity changes never erase an acquired skill; the host retains each pool's
  // original cost and blocks new purchases while that pool is overfilled.
  return Object.freeze({ retained: Object.freeze(retained), removed: Object.freeze(removed) });
}
