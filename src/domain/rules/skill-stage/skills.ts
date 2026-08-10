import type { ClassCode, RaceCode } from '@generated/types/character.js';

import { SkillStageRuleError } from './catalog.js';
import type { SkillKey, SkillStageCatalog } from './catalog.js';
import type { StatBlock } from './stats.js';

type SkillDefinition = SkillStageCatalog['skills'][number];
type ClassDefinition = SkillStageCatalog['classes'][number];
const RULE = Object.freeze({
  raceGrant: 'CORE-004',
  classSelection: 'CORE-008',
  classPassives: ['CORE-009', 'CORE-010', 'CORE-013'],
  slots: 'CORE-081',
  skillCost: 'CORE-165',
  requirements: 'CORE-167',
  exactFill: 'generated/spec/character/operations.json: OP-CHAR-CREATE.State transition / result',
} as const);

/** CORE-165: +5 is Absolute; each later +1 costs two slots. */
const ABSOLUTE_BONUS = 5;
const POST_ABSOLUTE_SLOT_COST = 2;
export interface SelectedSkillInput {
  readonly skillKey: string;
  readonly targetBonus: number;
}
export interface LearnedSkill {
  readonly source: 'SELECTED' | 'RACE_GRANTED' | 'CLASS_MANDATORY';
  readonly skillKey: SkillKey;
  readonly bonus: number;
  readonly slotCost: number;
}
export interface SkillSelectionInput {
  readonly raceCode: RaceCode;
  readonly classCode: ClassCode | null;
  readonly skillStageStats: StatBlock;
  readonly selectedSkills: readonly SelectedSkillInput[];
}

export interface SkillSelectionResult {
  readonly capacity: number;
  readonly used: number;
  readonly remaining: 0;
  readonly learnedSkills: readonly LearnedSkill[];
}

function fail(message: string): never {
  throw new SkillStageRuleError(message);
}

function requireSkill(catalog: SkillStageCatalog, skillKey: string): SkillDefinition {
  const skill = catalog.skills.find((candidate) => candidate.skillKey === skillKey);
  if (skill === undefined) {
    fail(`unknown SkillKey ${JSON.stringify(skillKey)}; expected the SkillKey dictionary`);
  }
  return skill;
}

export function calculateStartSkillSlots(skillStageStats: StatBlock): number {
  const wisdom = skillStageStats.W;
  if (!Number.isFinite(wisdom) || wisdom < 1) {
    fail(`skillStageStats.W must be positive for ${RULE.slots}; received ${String(wisdom)}`);
  }
  const capacity = Math.ceil(wisdom / 2);
  if (!Number.isSafeInteger(capacity))
    fail(`start skill slot capacity cannot be represented safely (${RULE.slots})`);
  return capacity;
}

export function calculateSkillSlotCost(targetBonus: number): number {
  if (!Number.isSafeInteger(targetBonus) || targetBonus < 1) {
    fail(
      `target skill bonus must be a positive integer by ${RULE.skillCost} and safely representable; received ${String(targetBonus)}`,
    );
  }
  const slotCost =
    targetBonus <= ABSOLUTE_BONUS
      ? targetBonus
      : ABSOLUTE_BONUS + POST_ABSOLUTE_SLOT_COST * (targetBonus - ABSOLUTE_BONUS);
  if (!Number.isSafeInteger(slotCost))
    fail(`calculated skill slot cost cannot be represented safely (${RULE.skillCost})`);
  return slotCost;
}

export function validateSkillRequirements(
  catalog: SkillStageCatalog,
  skillKey: string,
  skillStageStats: StatBlock,
): void {
  const skill = requireSkill(catalog, skillKey);
  if (skill.category === 'FIXED_RACE_PASSIVE' || skill.category === 'FIXED_CLASS_PASSIVE') return;

  const requirements = catalog.requirements.filter(
    (requirement) => requirement.skillKey === skill.skillKey,
  );
  // The catalog proves these are all rows of exactly one RequirementSetID.
  for (const requirement of requirements) {
    const actual = skillStageStats[requirement.statCode];
    if (!Number.isFinite(actual) || actual < requirement.minValue) {
      fail(
        `skill ${JSON.stringify(skillKey)} fails RequirementID ${JSON.stringify(requirement.requirementId)}: ` +
          `StatCode ${JSON.stringify(requirement.statCode)}, MinValue ${String(requirement.minValue)}, actual ${String(actual)} (${RULE.requirements})`,
      );
    }
  }
}

export function validateSkillSelection(
  catalog: SkillStageCatalog,
  input: SkillSelectionInput,
): SkillSelectionResult {
  const race = catalog.races.find((candidate) => candidate.raceCode === input.raceCode);
  if (race === undefined) {
    fail(`unknown RaceCode ${JSON.stringify(input.raceCode)}; expected the RaceCode dictionary`);
  }
  let selectedClass: ClassDefinition | null = null;
  if (input.classCode !== null) {
    const candidate = catalog.classes.find((entry) => entry.classCode === input.classCode);
    if (candidate === undefined) {
      fail(
        `unknown ClassCode ${JSON.stringify(input.classCode)}; expected the PureClass dictionary`,
      );
    }
    selectedClass = candidate;
  }
  // RULE.classSelection makes one Pure class mandatory and forbids all other classes.
  if (input.raceCode === 'PURE') {
    if (selectedClass === null) fail(`race "PURE" requires one class by ${RULE.classSelection}`);
    if (selectedClass.raceCode !== input.raceCode) {
      fail(
        `class ${JSON.stringify(selectedClass.classCode)} belongs to race ${JSON.stringify(selectedClass.raceCode)}, not ${JSON.stringify(input.raceCode)}`,
      );
    }
  } else if (selectedClass !== null) {
    fail(
      `race ${JSON.stringify(input.raceCode)} has ClassPolicy = NO_CLASS; class ${JSON.stringify(selectedClass.classCode)} is forbidden`,
    );
  }

  const learnedSkills: LearnedSkill[] = race.grantedSkillRefs.map((skillKey) => {
    const skill = requireSkill(catalog, skillKey);
    return Object.freeze({
      source: 'RACE_GRANTED',
      skillKey: skill.skillKey,
      bonus: skill.maxBonus as number,
      slotCost: 0,
    });
  });
  if (selectedClass !== null) {
    const skill = requireSkill(catalog, selectedClass.mandatorySkillKey);
    learnedSkills.push(
      Object.freeze({
        source: 'CLASS_MANDATORY',
        skillKey: skill.skillKey,
        bonus: skill.maxBonus as number,
        slotCost: selectedClass.mandatorySkillSlotCost,
      }),
    );
  }

  const selectedKeys = new Set<string>();
  for (const selection of input.selectedSkills) {
    const skill = requireSkill(catalog, selection.skillKey);
    if (skill.category !== 'SELECTABLE_GENERAL') {
      fail(
        `skill ${JSON.stringify(selection.skillKey)} has category ${JSON.stringify(skill.category)} and cannot be selected`,
      );
    }
    if (selectedKeys.has(selection.skillKey)) {
      fail(`skill ${JSON.stringify(selection.skillKey)} is selected more than once`);
    }
    selectedKeys.add(selection.skillKey);
    validateSkillRequirements(catalog, selection.skillKey, input.skillStageStats);
    learnedSkills.push(
      Object.freeze({
        source: 'SELECTED',
        skillKey: skill.skillKey,
        bonus: selection.targetBonus,
        slotCost: calculateSkillSlotCost(selection.targetBonus),
      }),
    );
  }

  const capacity = calculateStartSkillSlots(input.skillStageStats);
  const used = learnedSkills.reduce((total, skill) => total + skill.slotCost, 0);
  if (used > capacity) {
    fail(
      `skill slots exceeded: used ${String(used)}, capacity ${String(capacity)} (${RULE.slots}; ${RULE.skillCost})`,
    );
  }
  if (used < capacity) {
    fail(
      `skill slots underfilled: used ${String(used)}, capacity ${String(capacity)}; creation must use every start slot (${RULE.exactFill}; ${RULE.slots}; ${RULE.skillCost})`,
    );
  }

  return Object.freeze({
    capacity,
    used,
    remaining: 0,
    learnedSkills: Object.freeze(learnedSkills),
  });
}
