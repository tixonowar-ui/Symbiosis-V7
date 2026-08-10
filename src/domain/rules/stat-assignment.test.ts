import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { StatCode } from '@generated/types/character.js';
import {
  assignBaseStats,
  calculateSkillStageStats,
  createSkillStageCatalog,
  STAT_ASSIGNMENT_FORM_ID,
  STAT_ASSIGNMENT_MODES,
} from '../index.js';
import type { SkillStageCatalogSources, StatAssignmentInput, StatBlock } from '../index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(`${REPO_ROOT}/${path}`, 'utf8')) as unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((entry, index) => record(entry, `${label}[${String(index)}]`));
}

const RAW: SkillStageCatalogSources = Object.freeze({
  dictionaries: readJson('generated/spec/character/dictionaries.json'),
  stats: readJson('generated/spec/character/stats.json'),
  races: readJson('generated/spec/character/races.json'),
  classes: readJson('generated/spec/character/classes.json'),
  skills: readJson('generated/spec/character/skills.json'),
  requirements: readJson('generated/spec/character/skill-requirements.json'),
  modifiers: readJson('generated/spec/character/modifiers.json'),
});
const CATALOG = createSkillStageCatalog(RAW);
const ORDERED_STATS = Object.freeze(
  [...CATALOG.stats].sort((left, right) => left.order - right.order),
);
const RULES = records(readJson('generated/spec/rules/rules.json'), 'rules');
const FORMS = record(readJson('generated/spec/atlas/forms-by-id.json'), 'forms-by-id');
const RULE_IDS = ['CORE-160', 'CORE-161', 'CORE-162'] as const;

function statBlock(values: readonly number[]): StatBlock {
  if (values.length !== ORDERED_STATS.length) throw new Error('test requires seven stat values');
  return Object.fromEntries(
    ORDERED_STATS.map(({ statCode }, index) => [statCode, values[index]]),
  ) as StatBlock;
}

function rule(ruleId: (typeof RULE_IDS)[number]): Record<string, unknown> {
  const found = RULES.find((entry) => entry['Rule ID'] === ruleId);
  if (found === undefined) throw new Error(`rule ${ruleId} not found`);
  return found;
}

describe('CHR-009 stat assignment', () => {
  it('anchors CORE-160/161/162 and the exact atlas mode contract', () => {
    for (const ruleId of RULE_IDS) {
      expect(rule(ruleId)).toMatchObject({
        'Rule ID': ruleId,
        'Режим реализации': 'Реализовать в игровом ядре',
        Статус: 'Активно',
      });
    }
    const form = record(FORMS[STAT_ASSIGNMENT_FORM_ID], STAT_ASSIGNMENT_FORM_ID);
    expect(form.id).toBe('CHR-009');
    expect(form.requiredFields).toEqual(
      expect.arrayContaining([
        'assignmentMode=ROLLED_BIJECTION|POINT_BUY_90|POINT_BUY_85',
        'eachValueRange=1..20 when point-buy',
      ]),
    );
    expect(STAT_ASSIGNMENT_MODES).toEqual(['ROLLED_BIJECTION', 'POINT_BUY_90', 'POINT_BUY_85']);
  });

  it('preserves duplicate rolled values as a bijection and accepts CORE-163 value 25', () => {
    const acceptedValues = [25, 7, 7, 12, 1, 20, 3];
    const assignedStats = statBlock([7, 25, 3, 7, 12, 1, 20]);
    const result = assignBaseStats(CATALOG, {
      acceptedValues,
      assignedStats,
      assignmentMode: 'ROLLED_BIJECTION',
    });
    expect(result).toEqual(assignedStats);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects a rolled multiset mismatch without collapsing duplicate values', () => {
    expect(() =>
      assignBaseStats(CATALOG, {
        acceptedValues: [25, 7, 7, 12, 1, 20, 3],
        assignedStats: statBlock([7, 25, 3, 8, 12, 1, 20]),
        assignmentMode: 'ROLLED_BIJECTION',
      }),
    ).toThrow('must preserve the accepted multiset exactly');
  });

  it('requires exactly seven finite accepted rolled values', () => {
    expect(() =>
      assignBaseStats(CATALOG, {
        acceptedValues: [1, 2, 3, 4, 5, 6],
        assignedStats: statBlock([1, 2, 3, 4, 5, 6, 7]),
        assignmentMode: 'ROLLED_BIJECTION',
      }),
    ).toThrow('acceptedValues must contain 7 values; got 6');
    expect(() =>
      assignBaseStats(CATALOG, {
        acceptedValues: [1, 2, 3, 4, 5, 6, Number.POSITIVE_INFINITY],
        assignedStats: statBlock([1, 2, 3, 4, 5, 6, 7]),
        assignmentMode: 'ROLLED_BIJECTION',
      }),
    ).toThrow('acceptedValues[6] must be finite');
  });

  it.each([
    ['POINT_BUY_90', [15, 15, 12, 12, 12, 12, 12], 90],
    ['POINT_BUY_85', [13, 12, 12, 12, 12, 12, 12], 85],
  ] as const)('accepts %s only at its exact total %i', (assignmentMode, values, total) => {
    const result = assignBaseStats(CATALOG, {
      assignedStats: statBlock(values),
      assignmentMode,
    });
    expect(Object.values(result).reduce((sum, value) => sum + value, 0)).toBe(total);
  });

  it.each([
    [89, [14, 15, 12, 12, 12, 12, 12]],
    [91, [16, 15, 12, 12, 12, 12, 12]],
  ] as const)('rejects CORE-160 total %i with actual and required totals', (actual, values) => {
    expect(() =>
      assignBaseStats(CATALOG, {
        assignedStats: statBlock(values),
        assignmentMode: 'POINT_BUY_90',
      }),
    ).toThrow(`actual total ${String(actual)}; required 90`);
  });

  it('rejects a nonexact CORE-161 total with actual and required totals', () => {
    expect(() =>
      assignBaseStats(CATALOG, {
        assignedStats: statBlock([12, 12, 12, 12, 12, 12, 12]),
        assignmentMode: 'POINT_BUY_85',
      }),
    ).toThrow('actual total 84; required 85');
  });

  it.each([
    [0, [0, 15, 15, 15, 15, 15, 15]],
    [-1, [-1, 20, 20, 15, 15, 11, 10]],
    [21, [21, 15, 12, 12, 10, 10, 10]],
  ] as const)('rejects point-buy value %i with its StatCode and value', (value, values) => {
    const statCode = ORDERED_STATS[0]?.statCode;
    if (statCode === undefined) throw new Error('first StatCode not found');
    expect(() =>
      assignBaseStats(CATALOG, {
        assignedStats: statBlock(values),
        assignmentMode: 'POINT_BUY_90',
      }),
    ).toThrow(`assignedStats.${statCode}=${String(value)}`);
  });

  it('rejects missing and unexpected StatCode keys', () => {
    const first = ORDERED_STATS[0]?.statCode;
    if (first === undefined) throw new Error('first StatCode not found');
    const missing = { ...statBlock([15, 15, 12, 12, 12, 12, 12]) } as Partial<
      Record<StatCode, number>
    >;
    delete missing[first];
    expect(() =>
      assignBaseStats(CATALOG, {
        assignedStats: missing as StatBlock,
        assignmentMode: 'POINT_BUY_90',
      }),
    ).toThrow(`missing: ${first}`);
    expect(() =>
      assignBaseStats(CATALOG, {
        assignedStats: {
          ...statBlock([15, 15, 12, 12, 12, 12, 12]),
          EXTRA: 1,
        } as unknown as StatBlock,
        assignmentMode: 'POINT_BUY_90',
      }),
    ).toThrow('unexpected: EXTRA');
  });

  it('keeps CORE-162 rolled-only and lists every allowed mode on refusal', () => {
    const input = {
      assignedStats: statBlock(ORDERED_STATS.map(({ baseMin }) => baseMin)),
      assignmentMode: 'POINT_BUY_ALL_OR_NOTHING',
    } as unknown as StatAssignmentInput;
    expect(() => assignBaseStats(CATALOG, input)).toThrow(
      'expected: ROLLED_BIJECTION, POINT_BUY_90, POINT_BUY_85',
    );
  });

  it('feeds calculateSkillStageStats directly without applying the later CORE-164 minimum', () => {
    const baseValues = ORDERED_STATS.map(({ baseMin }) => baseMin);
    const baseStats = assignBaseStats(CATALOG, {
      acceptedValues: baseValues,
      assignedStats: statBlock([...baseValues].reverse()),
      assignmentMode: 'ROLLED_BIJECTION',
    });
    const result = calculateSkillStageStats(CATALOG, {
      baseStats,
      classCode: null,
      creationMode: 'MANUAL',
      raceCode: 'UNITED',
    });
    const lowered = CATALOG.modifiers.find(
      (modifier) =>
        modifier.sourceType === 'RACE' &&
        modifier.sourceId === 'UNITED' &&
        modifier.applicationStage === 'SKILL_STAGE' &&
        modifier.contextPredicate === 'creationMode=MANUAL' &&
        modifier.value < 0,
    );
    if (lowered === undefined) throw new Error('negative UNITED/MANUAL modifier not found');
    const definition = ORDERED_STATS.find(({ statCode }) => statCode === lowered.targetCode);
    if (definition === undefined) throw new Error('modified StatCode not found');
    expect(result.skillStageStats[lowered.targetCode]).toBeLessThan(definition.effectiveMin);
  });
});
