import { join, resolve } from 'node:path';

import type { SkillStageCatalog } from '../domain/index.js';
import { readJsonFile } from './json-source.js';

type SkillId = SkillStageCatalog['skills'][number]['skillKey'];
type StatCode = SkillStageCatalog['stats'][number]['statCode'];

export interface CreationSkillLabel {
  readonly skillId: SkillId;
  readonly skillLabel: string;
}

export interface CreationSkillRequirementSummary {
  readonly minValue: number;
  readonly statCode: StatCode;
  readonly statLabel: string;
}

export type CreationMissingSkillPenalty =
  | Readonly<{ readonly kind: 'NO_MISSING_SKILL_PENALTY' }>
  | Readonly<{
      readonly kind: 'MISSING_SKILL_PENALTY';
      readonly value: number;
    }>;

export interface CreationSelectableSkillSummary extends CreationSkillLabel {
  readonly bonusDomainScope: string;
  readonly missingSkillPenalty: CreationMissingSkillPenalty;
  readonly requirements: readonly CreationSkillRequirementSummary[];
}

/**
 * Player-safe source facts only. The validated SkillKey is exposed under the
 * public skillId field; raw SkillID, requirement IDs, rules and source trace
 * remain in the host catalog and never enter this structure.
 */
export interface CreationSkillCatalog {
  readonly selectableSkills: readonly CreationSelectableSkillSummary[];
  readonly skillLabels: readonly CreationSkillLabel[];
}

export interface CreationSkillCatalogSources {
  readonly requirements: unknown;
  readonly skills: unknown;
  readonly stats: unknown;
}

type Row = Record<string, unknown>;

export class CreationSkillCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

function fail(path: string, detail: string): never {
  throw new CreationSkillCatalogError(`${path}: ${detail}`);
}

function rows(value: unknown, path: string, expected: number): Row[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (value.length !== expected) {
    fail(path, `expected ${String(expected)} rows, got ${String(value.length)}`);
  }
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${path}[${String(index)}]`, 'expected an object');
    }
    return entry as Row;
  });
}

function text(row: Row, key: string, path: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path}.${key}`, 'expected a non-empty string');
  }
  return value;
}

function integer(row: Row, key: string, path: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail(`${path}.${key}`, 'expected a safe integer');
  }
  return value;
}

function positiveInteger(row: Row, key: string, path: string): number {
  const value = integer(row, key, path);
  if (value <= 0) fail(`${path}.${key}`, 'expected a positive safe integer');
  return value;
}

function literal<T extends string>(row: Row, key: string, expected: T, path: string): T {
  const value = text(row, key, path);
  if (value !== expected) {
    fail(`${path}.${key}`, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
  }
  return expected;
}

function booleanLiteral(row: Row, key: string, expected: boolean, path: string): boolean {
  const value = row[key];
  if (value !== expected) {
    fail(`${path}.${key}`, `expected ${String(expected)}, got ${JSON.stringify(value)}`);
  }
  return expected;
}

function maxBonus(row: Row, path: string): number | 'NO_RULED_UPPER_LIMIT' {
  const value = row['MaxBonus'];
  if (
    value !== 'NO_RULED_UPPER_LIMIT' &&
    (typeof value !== 'number' || !Number.isSafeInteger(value))
  ) {
    fail(`${path}.MaxBonus`, 'expected a safe integer or NO_RULED_UPPER_LIMIT');
  }
  return value;
}

function mismatch(path: string, field: string): never {
  return fail(path, `${field} disagrees with the validated skill-stage catalog`);
}

interface RequirementJoin {
  readonly minValue: number;
  readonly skillKey: SkillId;
  readonly statCode: StatCode;
}

interface SkillPresentationFacts extends CreationSkillLabel {
  readonly bonusDomainScope: string;
  readonly category: string;
  readonly missingSkillPenalty: CreationMissingSkillPenalty;
}

/**
 * Builds the issue #126 player-facing allowlist plus the issue #131 delivered
 * content fields while cross-checking every join against the validated catalog.
 */
export function createCreationSkillCatalog(
  sources: CreationSkillCatalogSources,
  skillStageCatalog: SkillStageCatalog,
): CreationSkillCatalog {
  // Source-owned cardinalities printed in issue #126.
  const skillRows = rows(sources.skills, 'creation skills', 45);
  const requirementRows = rows(sources.requirements, 'creation skill requirements', 84);
  const statRows = rows(sources.stats, 'creation skill stats', 7);

  const stats = statRows
    .map((row, index) => {
      const path = `creation skill stats[${String(index)}]`;
      return Object.freeze({
        order: positiveInteger(row, 'Порядок', path),
        statCode: text(row, 'StatCode', path) as StatCode,
        statLabel: text(row, 'Название', path),
      });
    })
    .sort((left, right) => left.order - right.order);
  if (stats.length !== skillStageCatalog.stats.length) {
    mismatch('creation skill stats', 'row count');
  }
  stats.forEach((stat, index) => {
    const validated = skillStageCatalog.stats[index];
    if (
      validated === undefined ||
      stat.statCode !== validated.statCode ||
      stat.order !== validated.order
    ) {
      mismatch(`creation skill stats[${String(index)}]`, 'StatCode/order');
    }
  });
  const statByCode = new Map(stats.map((stat) => [stat.statCode, stat]));
  if (statByCode.size !== stats.length)
    fail('creation skill stats.StatCode', 'contains duplicates');
  const statOrder = new Map(stats.map((stat, index) => [stat.statCode, index]));

  const skillFacts = skillRows.map((row, index): SkillPresentationFacts => {
    const path = `creation skills[${String(index)}]`;
    const validated = skillStageCatalog.skills[index];
    if (validated === undefined) mismatch(path, 'row count/order');
    const rawSkillId = text(row, 'SkillID', path);
    const skillKey = text(row, 'SkillKey', path);
    const category = text(row, 'Категория', path);
    const slotCostMode = text(row, 'SlotCostMode', path);
    const status = text(row, 'Status', path);
    const rawMaxBonus = maxBonus(row, path);
    const rawPenalty = Object.hasOwn(row, 'MissingSkillPenalty')
      ? integer(row, 'MissingSkillPenalty', path)
      : undefined;
    if (
      rawSkillId !== validated.skillId ||
      skillKey !== validated.skillKey ||
      category !== validated.category ||
      slotCostMode !== validated.slotCostMode ||
      status !== validated.status ||
      rawMaxBonus !== validated.maxBonus ||
      rawPenalty !== validated.missingSkillPenalty
    ) {
      mismatch(path, 'skill identity/mechanics');
    }
    return Object.freeze({
      bonusDomainScope: text(row, 'BonusDomain / Scope', path),
      category,
      missingSkillPenalty:
        rawPenalty === undefined
          ? Object.freeze({ kind: 'NO_MISSING_SKILL_PENALTY' as const })
          : Object.freeze({ kind: 'MISSING_SKILL_PENALTY' as const, value: rawPenalty }),
      skillId: validated.skillKey,
      skillLabel: text(row, 'Название', path),
    });
  });
  if (skillFacts.length !== skillStageCatalog.skills.length) {
    mismatch('creation skills', 'row count');
  }
  const missingPenaltyCount = skillFacts.filter(
    ({ missingSkillPenalty }) => missingSkillPenalty.kind === 'MISSING_SKILL_PENALTY',
  ).length;
  // Source-owned population printed in issue #131: 15 present, 30 absent.
  if (missingPenaltyCount !== 15) {
    fail(
      'creation skills.MissingSkillPenalty',
      `expected 15 populated rows, got ${String(missingPenaltyCount)}`,
    );
  }
  const skillLabels = skillFacts.map(({ skillId, skillLabel }) =>
    Object.freeze({ skillId, skillLabel }),
  );
  if (new Set(skillLabels.map(({ skillId }) => skillId)).size !== skillLabels.length) {
    fail('creation skills.SkillKey', 'contains duplicates');
  }
  const labelBySkillId = new Map(skillLabels.map((skill) => [skill.skillId, skill.skillLabel]));
  const factsBySkillId = new Map(skillFacts.map((skill) => [skill.skillId, skill]));

  const requirementJoins = requirementRows.map((row, index): RequirementJoin => {
    const path = `creation skill requirements[${String(index)}]`;
    const validated = skillStageCatalog.requirements[index];
    if (validated === undefined) mismatch(path, 'row count/order');
    const requirementId = text(row, 'RequirementID', path);
    const requirementSetId = text(row, 'RequirementSetID', path);
    const skillKey = text(row, 'SkillKey', path);
    const statCode = text(row, 'StatCode', path) as StatCode;
    const minValue = integer(row, 'MinValue', path);
    const evaluationStage = literal(row, 'EvaluationStage', 'SKILL_STAGE_PRE_SYMBIONT', path);
    const beforeSymbiontBonuses = booleanLiteral(row, 'BeforeSymbiontBonuses', true, path);
    const ruleId = literal(row, 'Rule ID', 'CORE-167', path);
    if (
      requirementId !== validated.requirementId ||
      requirementSetId !== validated.requirementSetId ||
      skillKey !== validated.skillKey ||
      statCode !== validated.statCode ||
      minValue !== validated.minValue ||
      evaluationStage !== validated.evaluationStage ||
      beforeSymbiontBonuses !== validated.beforeSymbiontBonuses ||
      ruleId !== validated.ruleId
    ) {
      mismatch(path, 'requirement identity/mechanics');
    }
    if (!statByCode.has(statCode)) fail(`${path}.StatCode`, `unknown ${JSON.stringify(statCode)}`);
    return Object.freeze({ minValue, skillKey: validated.skillKey, statCode });
  });
  if (requirementJoins.length !== skillStageCatalog.requirements.length) {
    mismatch('creation skill requirements', 'row count');
  }

  const selectableSkills = skillStageCatalog.skills
    .filter(({ category }) => category === 'SELECTABLE_GENERAL')
    .map((skill): CreationSelectableSkillSummary => {
      const skillLabel = labelBySkillId.get(skill.skillKey);
      const facts = factsBySkillId.get(skill.skillKey);
      if (skillLabel === undefined || facts === undefined) {
        fail(
          'creation skills.SkillKey',
          `missing presentation facts for ${JSON.stringify(skill.skillKey)}`,
        );
      }
      if (facts.category !== 'SELECTABLE_GENERAL') {
        fail(
          'creation skills.Категория',
          `expected SELECTABLE_GENERAL for ${JSON.stringify(skill.skillKey)}`,
        );
      }
      const requirements = requirementJoins
        .filter(({ skillKey }) => skillKey === skill.skillKey)
        .sort(
          (left, right) =>
            (statOrder.get(left.statCode) ?? Number.MAX_SAFE_INTEGER) -
            (statOrder.get(right.statCode) ?? Number.MAX_SAFE_INTEGER),
        )
        .map((requirement): CreationSkillRequirementSummary => {
          const stat = statByCode.get(requirement.statCode);
          if (stat === undefined) {
            fail(
              'creation skill requirements.StatCode',
              `missing label for ${JSON.stringify(requirement.statCode)}`,
            );
          }
          return Object.freeze({
            minValue: requirement.minValue,
            statCode: requirement.statCode,
            statLabel: stat.statLabel,
          });
        });
      if (requirements.length === 0) {
        fail(
          'creation skill requirements.SkillKey',
          `selectable skill ${JSON.stringify(skill.skillKey)} has no requirements`,
        );
      }
      if (new Set(requirements.map(({ statCode }) => statCode)).size !== requirements.length) {
        fail(
          'creation skill requirements.StatCode',
          `selectable skill ${JSON.stringify(skill.skillKey)} repeats a characteristic`,
        );
      }
      return Object.freeze({
        bonusDomainScope: facts.bonusDomainScope,
        missingSkillPenalty: facts.missingSkillPenalty,
        requirements: Object.freeze(requirements),
        skillId: skill.skillKey,
        skillLabel,
      });
    });

  return Object.freeze({
    selectableSkills: Object.freeze(selectableSkills),
    skillLabels: Object.freeze(skillLabels),
  });
}

/** Loads only the three generated tables needed by the sanitized skill presentation catalog. */
export async function loadCreationSkillCatalog(
  projectRoot: string,
  skillStageCatalog: SkillStageCatalog,
): Promise<CreationSkillCatalog> {
  const root = join(resolve(projectRoot), 'generated', 'spec', 'character');
  const [requirements, skills, stats] = await Promise.all([
    readJsonFile(join(root, 'skill-requirements.json'), 'creation skill catalog'),
    readJsonFile(join(root, 'skills.json'), 'creation skill catalog'),
    readJsonFile(join(root, 'stats.json'), 'creation skill catalog'),
  ]);
  return createCreationSkillCatalog({ requirements, skills, stats }, skillStageCatalog);
}
