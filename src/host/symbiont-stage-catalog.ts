import { join, resolve } from 'node:path';

import type { StatCode } from '@generated/types/character.js';

import {
  calculateSkillSlotCost,
  calculateStartSkillSlots,
  createAdvisorSkillStats,
  createSymbiontCatalog,
  validateSkillRequirements,
  type AdvisorIwResult,
  type SkillStageCatalog,
  type StatBlock,
  type SymbiontCatalog,
  type SymbiontCatalogSources,
} from '../domain/index.js';
import type {
  CreationMissingSkillPenalty,
  CreationSelectableSkillSummary,
  CreationSkillCatalog,
} from './creation-skill-catalog.js';
import { readJsonFile } from './json-source.js';
import { loadSkillStageCatalogSources } from './skill-stage-catalog.js';

const EXTRA_SOURCE_FILES = Object.freeze({
  incompatibilities: 'incompatibilities.json',
  symbionts: 'symbionts.json',
} as const);

/** Loads and validates every source required by the random symbiont domain. */
export async function loadSymbiontCatalog(projectRoot: string): Promise<SymbiontCatalog> {
  const root = resolve(projectRoot);
  const [baseSources, extraEntries] = await Promise.all([
    loadSkillStageCatalogSources(root),
    Promise.all(
      Object.entries(EXTRA_SOURCE_FILES).map(async ([key, file]) => [
        key,
        await readJsonFile(
          join(root, 'generated', 'spec', 'character', file),
          'random symbiont catalog source',
        ),
      ]),
    ),
  ]);
  return createSymbiontCatalog({
    ...baseSources,
    ...Object.fromEntries(extraEntries),
  } as SymbiontCatalogSources);
}

export interface AdvisorSkillLevelOption {
  readonly targetBonus: number;
  readonly slotCost: number;
}

export interface AdvisorSkillRequirementOption {
  readonly statCode: StatCode;
  readonly statLabel: string;
  readonly minValue: number;
  readonly currentValue: number;
  readonly satisfied: boolean;
}

export interface AdvisorSkillOption {
  readonly skillId: string;
  readonly skillLabel: string;
  readonly bonusDomainScope: string;
  readonly missingSkillPenalty: CreationMissingSkillPenalty;
  readonly requirements: readonly AdvisorSkillRequirementOption[];
  readonly levelOptions: readonly AdvisorSkillLevelOption[];
}

export interface AdvisorSkillOptions {
  readonly requiredSlotCount: number;
  readonly skillOptions: readonly AdvisorSkillOption[];
}

function eligible(catalog: SkillStageCatalog, skillKey: string, stats: StatBlock): boolean {
  try {
    validateSkillRequirements(catalog, skillKey, stats);
    return true;
  } catch {
    return false;
  }
}

function option(
  source: CreationSelectableSkillSummary,
  stats: StatBlock,
  requiredSlotCount: number,
): AdvisorSkillOption {
  const levelOptions: AdvisorSkillLevelOption[] = [];
  for (let targetBonus = 1; ; targetBonus += 1) {
    const slotCost = calculateSkillSlotCost(targetBonus);
    if (slotCost > requiredSlotCount) break;
    levelOptions.push(Object.freeze({ targetBonus, slotCost }));
  }
  return Object.freeze({
    skillId: source.skillId,
    skillLabel: source.skillLabel,
    bonusDomainScope: source.bonusDomainScope,
    missingSkillPenalty: source.missingSkillPenalty,
    requirements: Object.freeze(
      source.requirements.map((requirement) => {
        const currentValue = stats[requirement.statCode];
        return Object.freeze({
          statCode: requirement.statCode,
          statLabel: requirement.statLabel,
          minValue: requirement.minValue,
          currentValue,
          satisfied: currentValue >= requirement.minValue,
        });
      }),
    ),
    levelOptions: Object.freeze(levelOptions),
  });
}

/** Sanitized Advisor-only options; host race/class skills are not added to this pool. */
export function createAdvisorSkillOptions(
  catalog: SymbiontCatalog,
  presentation: CreationSkillCatalog,
  advisorIw: AdvisorIwResult,
  bodyStats: Parameters<typeof createAdvisorSkillStats>[0]['bodyStats'],
): AdvisorSkillOptions {
  const advisorStats = createAdvisorSkillStats({ advisorIw, bodyStats });
  const requiredSlotCount = calculateStartSkillSlots(advisorStats);
  const skillOptions = presentation.selectableSkills
    .filter((skill) => eligible(catalog.skillStage, skill.skillId, advisorStats))
    .map((skill) => option(skill, advisorStats, requiredSlotCount));
  return Object.freeze({ requiredSlotCount, skillOptions: Object.freeze(skillOptions) });
}
