import type { StatCode } from '@generated/types/character.js';

import type { MechanicalRoll } from '../../entities/roll-request/roll-model.js';
import type { SkillStageCatalog, SkillKey } from '../skill-stage/catalog.js';
import {
  calculateSkillSlotCost,
  calculateStartSkillSlots,
  validateSkillRequirements,
  type SelectedSkillInput,
} from '../skill-stage/skills.js';
import type { StatBlock } from '../skill-stage/stats.js';

export interface AdvisorStatResult {
  readonly rawFace: number;
  readonly value: number;
}

export interface AdvisorIwResult {
  readonly I: AdvisorStatResult;
  readonly W: AdvisorStatResult;
}

export type AdvisorBodyStats = Readonly<Pick<StatBlock, 'S' | 'D' | 'M' | 'Z' | 'C'>>;

export interface AdvisorSkillStatsInput {
  readonly advisorIw: AdvisorIwResult;
  readonly bodyStats: AdvisorBodyStats;
}

export interface AdvisorSkillSelectionInput extends AdvisorSkillStatsInput {
  readonly selectedSkills: readonly SelectedSkillInput[];
}

export interface AdvisorLearnedSkill {
  readonly skillKey: SkillKey;
  readonly bonus: number;
  readonly slotCost: number;
}

export interface AdvisorSkillSelectionResult {
  readonly advisorStats: StatBlock;
  readonly capacity: number;
  readonly used: number;
  readonly remaining: 0;
  readonly learnedSkills: readonly AdvisorLearnedSkill[];
}

export interface AdvisorSuppressionMinimumInput {
  readonly suppressionB: number;
  readonly teacherAbsorbed: boolean;
}

export class AdvisorRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

const BODY_STAT_CODES = Object.freeze(['S', 'D', 'M', 'Z', 'C'] as const);
const ADVISOR_STAT_BONUS = 8;
const SUPPRESSION_DIVISOR = 4;

function fail(detail: string): never {
  throw new AdvisorRuleError(detail);
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function requireD20(roll: MechanicalRoll, path: string): MechanicalRoll {
  if (typeof roll !== 'object' || roll === null || Array.isArray(roll)) {
    fail(`${path} must be a D20 MechanicalRoll; received ${show(roll)}`);
  }
  const keys = Object.keys(roll).sort();
  if (keys.join(',') !== 'dieSides,rawFace') fail(`${path} keys must be exact`);
  if (roll.dieSides !== 20) fail(`${path}.dieSides must be 20`);
  if (
    typeof roll.rawFace !== 'number' ||
    !Number.isSafeInteger(roll.rawFace) ||
    roll.rawFace < 1 ||
    roll.rawFace > 20
  ) {
    fail(`${path}.rawFace must be an integer in 1..20; received ${show(roll.rawFace)}`);
  }
  return Object.freeze({ dieSides: 20, rawFace: roll.rawFace });
}

/** Q-CHAR-006: one independent raw D20 plus eight, with no critical outcome. */
export function resolveAdvisorStatRoll(roll: MechanicalRoll): AdvisorStatResult {
  const resolved = requireD20(roll, 'advisorRoll');
  return Object.freeze({
    rawFace: resolved.rawFace,
    value: resolved.rawFace + ADVISOR_STAT_BONUS,
  });
}

/** Input order is explicitly I then W; natural 1/20 has no special branch. */
export function resolveAdvisorIwRolls(
  rolls: readonly [MechanicalRoll, MechanicalRoll],
): AdvisorIwResult {
  if (!Array.isArray(rolls) || rolls.length !== 2) {
    fail('advisor I/W requires exactly two rolls in I,W order');
  }
  return Object.freeze({
    I: resolveAdvisorStatRoll(rolls[0]),
    W: resolveAdvisorStatRoll(rolls[1]),
  });
}

function requireAdvisorResult(result: AdvisorStatResult, path: string): AdvisorStatResult {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    fail(`${path} must be an Advisor stat result`);
  }
  const rawFace = requireD20({ dieSides: 20, rawFace: result.rawFace }, path).rawFace;
  if (result.value !== rawFace + ADVISOR_STAT_BONUS) {
    fail(`${path}.value must equal rawFace+8; received ${show(result.value)}`);
  }
  if (Object.keys(result).sort().join(',') !== 'rawFace,value') fail(`${path} keys must be exact`);
  return Object.freeze({ rawFace, value: result.value });
}

/** Only I/W come from the Advisor; the other five values belong to the current body. */
export function createAdvisorSkillStats(input: AdvisorSkillStatsInput): StatBlock {
  if (
    typeof input.bodyStats !== 'object' ||
    input.bodyStats === null ||
    Array.isArray(input.bodyStats)
  ) {
    fail('bodyStats must contain exactly S,D,M,Z,C');
  }
  const actualKeys = Object.keys(input.bodyStats).sort();
  const expectedKeys = [...BODY_STAT_CODES].sort();
  if (actualKeys.join(',') !== expectedKeys.join(',')) {
    fail(`bodyStats must contain exactly S,D,M,Z,C; received keys ${actualKeys.join(',')}`);
  }
  const body = {} as Record<(typeof BODY_STAT_CODES)[number], number>;
  for (const statCode of BODY_STAT_CODES) {
    const value = input.bodyStats[statCode];
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      fail(`bodyStats.${statCode} must be a safe integer; received ${show(value)}`);
    }
    body[statCode] = value;
  }
  const I = requireAdvisorResult(input.advisorIw.I, 'advisorIw.I');
  const W = requireAdvisorResult(input.advisorIw.W, 'advisorIw.W');
  return Object.freeze({
    S: body.S,
    D: body.D,
    M: body.M,
    Z: body.Z,
    I: I.value,
    W: W.value,
    C: body.C,
  });
}

export function validateAdvisorSkillSelection(
  catalog: SkillStageCatalog,
  input: AdvisorSkillSelectionInput,
): AdvisorSkillSelectionResult {
  const selectedSkillsInput: unknown = input.selectedSkills;
  if (!Array.isArray(selectedSkillsInput)) fail('selectedSkills must be an array');
  const selectedSkills = selectedSkillsInput as readonly SelectedSkillInput[];
  const advisorStats = createAdvisorSkillStats(input);
  const learnedSkills: AdvisorLearnedSkill[] = [];
  const selected = new Set<SkillKey>();
  for (const [index, selection] of selectedSkills.entries()) {
    if (typeof selection !== 'object' || selection === null || Array.isArray(selection)) {
      fail(`selectedSkills[${String(index)}] must be an object`);
    }
    const keys = Object.keys(selection).sort();
    if (keys.join(',') !== 'skillKey,targetBonus') {
      fail(`selectedSkills[${String(index)}] keys must be exact`);
    }
    const skill = catalog.skills.find((candidate) => candidate.skillKey === selection.skillKey);
    if (skill === undefined) fail(`unknown Advisor SkillKey ${JSON.stringify(selection.skillKey)}`);
    if (skill.category !== 'SELECTABLE_GENERAL') {
      fail(`Advisor skill ${skill.skillKey} has non-selectable category ${skill.category}`);
    }
    if (selected.has(skill.skillKey))
      fail(`Advisor skill ${skill.skillKey} is selected more than once`);
    selected.add(skill.skillKey);
    validateSkillRequirements(catalog, skill.skillKey, advisorStats);
    learnedSkills.push(
      Object.freeze({
        skillKey: skill.skillKey,
        bonus: selection.targetBonus,
        slotCost: calculateSkillSlotCost(selection.targetBonus),
      }),
    );
  }
  const capacity = calculateStartSkillSlots(advisorStats);
  const used = learnedSkills.reduce((total, skill) => total + skill.slotCost, 0);
  if (used > capacity)
    fail(`Advisor skill slots exceeded: used ${String(used)}, capacity ${String(capacity)}`);
  if (used < capacity)
    fail(`Advisor skill slots underfilled: used ${String(used)}, capacity ${String(capacity)}`);
  return Object.freeze({
    advisorStats,
    capacity,
    used,
    remaining: 0,
    learnedSkills: Object.freeze(learnedSkills),
  });
}

/** Q-SYM-005/073: nearest integer, with an exact half rounded upward. */
export function calculateTrogrSuppressionBonus(roll: MechanicalRoll): number {
  const resolved = requireD20(roll, 'trogrSuppressionRoll');
  return Math.floor(resolved.rawFace / SUPPRESSION_DIVISOR + 0.5);
}

export function deriveAdvisorSuppressionMinimumI(input: AdvisorSuppressionMinimumInput): number {
  if (
    !Number.isSafeInteger(input.suppressionB) ||
    input.suppressionB < 0 ||
    input.suppressionB > 5
  ) {
    fail(`suppressionB must be an integer in 0..5; received ${show(input.suppressionB)}`);
  }
  if (typeof input.teacherAbsorbed !== 'boolean')
    fail('teacherAbsorbed must be an explicit boolean');
  return (input.teacherAbsorbed ? 4 : 1) + input.suppressionB;
}

export const ADVISOR_SKILL_STAT_CODES = Object.freeze([
  ...BODY_STAT_CODES.slice(0, 4),
  'I',
  'W',
  'C',
] as const satisfies readonly StatCode[]);
