import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { ClassCode, RaceCode, StatCode } from '@generated/types/character.js';
import {
  calculateSkillSlotCost,
  calculateSkillStageStats,
  calculateStartSkillSlots,
  createSkillStageCatalog,
  validateSkillRequirements,
  validateSkillSelection,
} from './index.js';
import type { SkillStageCatalogSources, StatBlock } from './index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(`${REPO_ROOT}/${path}`, 'utf8')) as unknown;
}

function rows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`${label}[${String(index)}] must be an object`);
    }
    return entry as Record<string, unknown>;
  });
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`);
  return value;
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') throw new TypeError(`${key} must be a number`);
  return value;
}

const RAW = Object.freeze({
  dictionaries: readJson('generated/spec/character/dictionaries.json'),
  stats: readJson('generated/spec/character/stats.json'),
  races: readJson('generated/spec/character/races.json'),
  classes: readJson('generated/spec/character/classes.json'),
  skills: readJson('generated/spec/character/skills.json'),
  requirements: readJson('generated/spec/character/skill-requirements.json'),
  modifiers: readJson('generated/spec/character/modifiers.json'),
});
const RAW_STATS = rows(RAW.stats, 'stats');
const RAW_RACES = rows(RAW.races, 'races');
const RAW_CLASSES = rows(RAW.classes, 'classes');
const RAW_SKILLS = rows(RAW.skills, 'skills');
const RAW_REQUIREMENTS = rows(RAW.requirements, 'requirements');
const RAW_MODIFIERS = rows(RAW.modifiers, 'modifiers');
const RULES = rows(readJson('generated/spec/rules/rules.json'), 'rules');
const OPERATIONS = rows(readJson('generated/spec/character/operations.json'), 'operations');
const CATALOG = createSkillStageCatalog(RAW);

const RULE_IDS = [
  'CORE-001',
  'CORE-004',
  'CORE-006',
  'CORE-008',
  'CORE-009',
  'CORE-010',
  'CORE-013',
  'CORE-078',
  'CORE-079',
  'CORE-081',
  'CORE-165',
  'CORE-167',
] as const;

function rule(ruleId: (typeof RULE_IDS)[number]): Record<string, unknown> {
  const found = RULES.find((entry) => entry['Rule ID'] === ruleId);
  if (found === undefined) throw new Error(`rule ${ruleId} not found`);
  return found;
}

function cloneSources(): SkillStageCatalogSources {
  return structuredClone(RAW);
}

function mutate(
  table: keyof SkillStageCatalogSources,
  change: (entries: Record<string, unknown>[]) => void,
): SkillStageCatalogSources {
  const source = cloneSources();
  change(rows(source[table], table));
  return source;
}

function rawStat(statCode: StatCode): Record<string, unknown> {
  const found = RAW_STATS.find((entry) => entry.StatCode === statCode);
  if (found === undefined) throw new Error(`stat ${statCode} not found`);
  return found;
}

function statBlock(
  sourceField: 'BaseMax игрока' | 'BaseMin' = 'BaseMin',
  overrides: Partial<Record<StatCode, number>> = {},
): StatBlock {
  const result = {} as Record<StatCode, number>;
  for (const row of RAW_STATS) {
    const statCode = stringField(row, 'StatCode') as StatCode;
    result[statCode] = overrides[statCode] ?? numberField(row, sourceField);
  }
  return result;
}

function modifier(modifierId: string): Record<string, unknown> {
  const found = RAW_MODIFIERS.find((entry) => entry.ModifierID === modifierId);
  if (found === undefined) throw new Error(`modifier ${modifierId} not found`);
  return found;
}

function expectedStats(base: StatBlock, modifierIds: readonly string[]): StatBlock {
  const expected = { ...base } as Record<StatCode, number>;
  for (const modifierId of modifierIds) {
    const row = modifier(modifierId);
    expected[stringField(row, 'TargetCode') as StatCode] += numberField(row, 'Value');
  }
  return expected;
}

function requirementsFor(skillKey: string): Record<string, unknown>[] {
  return RAW_REQUIREMENTS.filter((entry) => entry.SkillKey === skillKey);
}

function statsMeeting(skillKey: string): StatBlock {
  const result = { ...statBlock() } as Record<StatCode, number>;
  for (const requirement of requirementsFor(skillKey)) {
    result[stringField(requirement, 'StatCode') as StatCode] = numberField(requirement, 'MinValue');
  }
  return result;
}

describe('generated skill-stage catalog contract', () => {
  it('loads the seven artifact tables without inventing MissingSkillPenalty', () => {
    expect(CATALOG.stats).toHaveLength(RAW_STATS.length);
    expect(CATALOG.races).toHaveLength(RAW_RACES.length);
    expect(CATALOG.classes).toHaveLength(RAW_CLASSES.length);
    expect(CATALOG.skills).toHaveLength(RAW_SKILLS.length);
    expect(CATALOG.requirements).toHaveLength(RAW_REQUIREMENTS.length);
    expect(CATALOG.modifiers).toHaveLength(RAW_MODIFIERS.length);

    const rawMissing = RAW_SKILLS.filter((entry) => !Object.hasOwn(entry, 'MissingSkillPenalty'))
      .map((entry) => stringField(entry, 'SkillKey'))
      .sort();
    const loadedMissing = CATALOG.skills
      .filter((entry) => !Object.hasOwn(entry, 'missingSkillPenalty'))
      .map((entry) => entry.skillKey)
      .sort();
    expect(rawMissing).toHaveLength(30);
    expect(loadedMissing).toEqual(rawMissing);
  });

  it('anchors every implemented mechanic to an active executable rule card', () => {
    for (const ruleId of RULE_IDS) {
      expect(rule(ruleId)).toMatchObject({
        'Rule ID': ruleId,
        'Режим реализации': 'Реализовать в игровом ядре',
        Статус: 'Активно',
      });
    }
  });

  it('reproduces the exact three SKILL_STAGE predicate populations from modifiers.json', () => {
    const counts = Object.fromEntries(
      ['creationMode=MANUAL', 'creationMode=RANDOM', 'ownerRace=PURE'].map((predicate) => [
        predicate,
        RAW_MODIFIERS.filter(
          (entry) =>
            entry.ApplicationStage === 'SKILL_STAGE' && entry.ContextPredicate === predicate,
        ).length,
      ]),
    );
    expect(counts).toEqual({
      'creationMode=MANUAL': 6,
      'creationMode=RANDOM': 3,
      'ownerRace=PURE': 12,
    });
  });

  it.each([
    ['SourceType', 'UNKNOWN_SOURCE', 'unrecognized "UNKNOWN_SOURCE"'],
    ['SourceID', 'UNKNOWN_ID', 'expected dictionary RaceCode'],
    ['ApplicationStage', 'UNKNOWN_STAGE', 'unrecognized "UNKNOWN_STAGE"'],
    ['ContextPredicate', 'unknown=true', 'unexpected RACE/FREE/unknown=true'],
    ['Operation', 'SET', 'unrecognized "SET"'],
    ['TargetKind', 'SKILL', 'unrecognized "SKILL"'],
    ['TargetCode', 'Q', 'unrecognized "Q"'],
    ['StackPolicy', 'MOST_SPECIFIC_CONTEXT', 'SKILL_STAGE requires ADD_ONCE_PER_SOURCE'],
  ])('rejects drifted modifier %s fail-closed', (field, value, message) => {
    const source = mutate('modifiers', (entries) => {
      const first = entries[0];
      if (first === undefined) throw new Error('modifier fixture is empty');
      first[field] = value;
    });
    expect(() => createSkillStageCatalog(source)).toThrow(message);
  });

  it('rejects balanced stage and predicate drift inside source pairs', () => {
    const stageDrift = mutate('modifiers', (entries) => {
      const free = entries.find(
        (entry) => entry.SourceType === 'RACE' && entry.SourceID === 'FREE',
      );
      const symbiont = entries.find((entry) => entry.SourceType === 'SYMBIONT_PROFILE');
      if (free === undefined || symbiont === undefined) throw new Error('modifier pair not found');
      free.ApplicationStage = 'EFFECTIVE_STATS';
      symbiont.ApplicationStage = 'SKILL_STAGE';
      symbiont.ContextPredicate = 'creationMode=MANUAL';
      symbiont.StackPolicy = 'ADD_ONCE_PER_SOURCE';
    });
    expect(() => createSkillStageCatalog(stageDrift)).toThrow('RACE/FREE');

    const predicateDrift = mutate('modifiers', (entries) => {
      const free = entries.find(
        (entry) =>
          entry.SourceType === 'RACE' &&
          entry.SourceID === 'FREE' &&
          entry.ContextPredicate === 'creationMode=MANUAL',
      );
      const united = entries.find(
        (entry) =>
          entry.SourceType === 'RACE' &&
          entry.SourceID === 'UNITED' &&
          entry.ContextPredicate === 'creationMode=RANDOM',
      );
      if (free === undefined || united === undefined)
        throw new Error('modifier predicate not found');
      [free.ContextPredicate, united.ContextPredicate] = [
        united.ContextPredicate,
        free.ContextPredicate,
      ];
    });
    expect(() => createSkillStageCatalog(predicateDrift)).toThrow('RACE/FREE');
  });

  it('checks a raw source group before stage and predicate filtering', () => {
    const source = mutate('modifiers', (entries) => {
      for (const entry of entries) {
        if (entry.SourceType === 'RACE' && entry.SourceID === 'FREE') entry.SourceID = 'UNITED';
      }
    });
    expect(() => createSkillStageCatalog(source)).toThrow(
      'modifier group RACE/FREE: expected 3, got 0',
    );
  });

  it('rejects new rows in the ADR 0023 empty RACE/PURE tuple', () => {
    const source = mutate('modifiers', (entries) => {
      const symbiont = entries.find((entry) => entry.SourceType === 'SYMBIONT_PROFILE');
      if (symbiont === undefined) throw new Error('symbiont modifier not found');
      symbiont.SourceType = 'RACE';
      symbiont.SourceID = 'PURE';
    });
    expect(() => createSkillStageCatalog(source)).toThrow(
      'modifier group RACE/PURE: expected 0, got 1',
    );
  });

  it('rejects requirement-stage drift instead of treating it as inapplicable', () => {
    const source = mutate('requirements', (entries) => {
      const first = entries[0];
      if (first === undefined) throw new Error('requirement fixture is empty');
      first.EvaluationStage = 'EFFECTIVE_STATS';
    });
    expect(() => createSkillStageCatalog(source)).toThrow('SKILL_STAGE_PRE_SYMBIONT');
  });

  it('rejects an incomplete StatLayer dictionary', () => {
    const source = mutate('dictionaries', (entries) => {
      const base = entries.find(
        (entry) => entry.Dictionary === 'StatLayer' && entry.Code === 'baseStats',
      );
      if (base === undefined) throw new Error('baseStats dictionary row not found');
      base.Code = 'BROKEN';
    });
    expect(() => createSkillStageCatalog(source)).toThrow('dictionary StatLayer');
  });

  it.each([
    ['skills', 'SkillID', 'skills.SkillID'],
    ['requirements', 'RequirementID', 'requirements.RequirementID'],
  ] as const)('rejects duplicate %s identities', (table, field, message) => {
    const source = mutate(table, (entries) => {
      if (entries[0] === undefined || entries[1] === undefined)
        throw new Error(`${table} rows missing`);
      entries[1][field] = entries[0][field];
    });
    expect(() => createSkillStageCatalog(source)).toThrow(message);
  });

  it('requires every fixed class passive to be mandatory exactly once', () => {
    const source = mutate('classes', (entries) => {
      if (entries[0] === undefined || entries[1] === undefined)
        throw new Error('class rows missing');
      entries[1].MandatorySkillKey = entries[0].MandatorySkillKey;
    });
    expect(() => createSkillStageCatalog(source)).toThrow('classes.MandatorySkillKey');
  });
});

describe('baseStats to skillStageStats', () => {
  const base = statBlock('BaseMax игрока');
  const cases = [
    {
      raceCode: 'FREE',
      classCode: null,
      creationMode: 'MANUAL',
      modifierIds: ['MOD-RACE-FREE-MANUAL-S', 'MOD-RACE-FREE-MANUAL-M', 'MOD-RACE-FREE-MANUAL-Z'],
    },
    {
      raceCode: 'UNITED',
      classCode: null,
      creationMode: 'RANDOM',
      modifierIds: [
        'MOD-RACE-UNITED-RANDOM-S',
        'MOD-RACE-UNITED-RANDOM-M',
        'MOD-RACE-UNITED-RANDOM-Z',
      ],
    },
    {
      raceCode: 'PURE',
      classCode: 'SEEKER',
      creationMode: 'MANUAL',
      modifierIds: [
        'MOD-CLASS-SEEKER-S',
        'MOD-CLASS-SEEKER-D',
        'MOD-CLASS-SEEKER-Z',
        'MOD-CLASS-SEEKER-I',
      ],
    },
  ] as const;

  it.each(cases)('uses exact source pairs for $raceCode', (entry) => {
    const result = calculateSkillStageStats(CATALOG, {
      baseStats: base,
      raceCode: entry.raceCode,
      classCode: entry.classCode,
      creationMode: entry.creationMode,
    });
    expect(result.appliedModifierIds).toEqual(entry.modifierIds);
    expect(result.skillStageStats).toEqual(expectedStats(base, entry.modifierIds));
    expect(Object.isFrozen(result.skillStageStats)).toBe(true);
  });

  it.each(['SEEKER', 'STALKER', 'SOLDIER'] as const)(
    'applies every ownerRace=PURE row for class %s',
    (classCode) => {
      const modifierIds = RAW_MODIFIERS.filter(
        (entry) =>
          entry.SourceType === 'PURE_CLASS' &&
          entry.SourceID === classCode &&
          entry.ApplicationStage === 'SKILL_STAGE',
      ).map((entry) => stringField(entry, 'ModifierID'));
      const result = calculateSkillStageStats(CATALOG, {
        baseStats: base,
        raceCode: 'PURE',
        classCode,
        creationMode: 'RANDOM',
      });
      expect(result.appliedModifierIds).toEqual(modifierIds);
      expect(result.skillStageStats).toEqual(expectedStats(base, modifierIds));
    },
  );

  it('accepts FREE/RANDOM as an existing group with zero applicable rows', () => {
    const result = calculateSkillStageStats(CATALOG, {
      baseStats: base,
      raceCode: 'FREE',
      classCode: null,
      creationMode: 'RANDOM',
    });
    expect(result).toEqual({ appliedModifierIds: [], skillStageStats: base });
  });

  it('does not dereference or normalize dangling profile/ref fields', () => {
    const source = cloneSources();
    for (const race of rows(source.races, 'races')) {
      race.StatModifierProfileID = ['MOD', 'RACE', 'FAKE'].join('-');
    }
    for (const pureClass of rows(source.classes, 'classes')) {
      pureClass.StatModifierProfileID = ['MOD', 'CLASS', 'FAKE'].join('-');
      pureClass.ContextModifierRefs = ['MOD', 'CLASS', 'FAKE', 'CONTEXT'].join('-');
    }
    const changedCatalog = createSkillStageCatalog(source);
    expect(changedCatalog.races.map((race) => race.statModifierProfileId)).toEqual(
      rows(source.races, 'races').map((race) => stringField(race, 'StatModifierProfileID')),
    );
    expect(changedCatalog.classes.map((entry) => entry.statModifierProfileId)).toEqual(
      rows(source.classes, 'classes').map((entry) => stringField(entry, 'StatModifierProfileID')),
    );
    expect(changedCatalog.classes.map((entry) => entry.contextModifierRefs)).toEqual(
      rows(source.classes, 'classes').map((entry) => stringField(entry, 'ContextModifierRefs')),
    );
    const input = {
      baseStats: base,
      raceCode: 'UNITED',
      classCode: null,
      creationMode: 'MANUAL',
    } as const;
    expect(calculateSkillStageStats(changedCatalog, input)).toEqual(
      calculateSkillStageStats(CATALOG, input),
    );
  });

  it('enforces CORE-008 class policy and unknown identifiers', () => {
    expect(() =>
      calculateSkillStageStats(CATALOG, {
        baseStats: base,
        raceCode: 'PURE',
        classCode: null,
        creationMode: 'MANUAL',
      }),
    ).toThrow('requires one PureClass (CORE-008)');
    expect(() =>
      calculateSkillStageStats(CATALOG, {
        baseStats: base,
        raceCode: 'FREE',
        classCode: 'SEEKER',
        creationMode: 'MANUAL',
      }),
    ).toThrow('ClassPolicy NO_CLASS');
    expect(() =>
      calculateSkillStageStats(CATALOG, {
        baseStats: base,
        raceCode: 'UNKNOWN' as RaceCode,
        classCode: null,
        creationMode: 'MANUAL',
      }),
    ).toThrow('unrecognized RaceCode "UNKNOWN"');
    expect(() =>
      calculateSkillStageStats(CATALOG, {
        baseStats: base,
        raceCode: 'PURE',
        classCode: 'UNKNOWN' as ClassCode,
        creationMode: 'MANUAL',
      }),
    ).toThrow('unrecognized ClassCode "UNKNOWN"');
  });

  it('validates the exact base map without imposing BaseMax as an input cap', () => {
    const aboveOrdinaryMax = {
      ...statBlock(),
      S: numberField(rawStat('S'), 'BaseMax игрока') + 1,
    };
    expect(
      calculateSkillStageStats(CATALOG, {
        baseStats: aboveOrdinaryMax,
        raceCode: 'FREE',
        classCode: null,
        creationMode: 'RANDOM',
      }).skillStageStats.S,
    ).toBe(aboveOrdinaryMax.S);

    const missing = { ...base } as Partial<Record<StatCode, number>>;
    delete missing.C;
    expect(() =>
      calculateSkillStageStats(CATALOG, {
        baseStats: missing as StatBlock,
        raceCode: 'FREE',
        classCode: null,
        creationMode: 'RANDOM',
      }),
    ).toThrow('missing: C');
    expect(() =>
      calculateSkillStageStats(CATALOG, {
        baseStats: { ...base, EXTRA: 1 } as unknown as StatBlock,
        raceCode: 'FREE',
        classCode: null,
        creationMode: 'RANDOM',
      }),
    ).toThrow('unexpected: EXTRA');
  });

  it('rejects a non-safe baseStat while preserving the CORE-163 integer value 25', () => {
    for (const value of [10.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        calculateSkillStageStats(CATALOG, {
          baseStats: { ...base, S: value },
          raceCode: 'FREE',
          classCode: null,
          creationMode: 'RANDOM',
        }),
      ).toThrow(`baseStats.S must be a safe integer; received ${String(value)}`);
    }

    expect(
      calculateSkillStageStats(CATALOG, {
        baseStats: { ...base, S: 25 },
        raceCode: 'FREE',
        classCode: null,
        creationMode: 'RANDOM',
      }).skillStageStats.S,
    ).toBe(25);
  });

  it('keeps the raw CORE-001 intermediate result even below EffectiveMin', () => {
    const modifierIds = RAW_MODIFIERS.filter(
      (entry) =>
        entry.SourceType === 'RACE' &&
        entry.SourceID === 'UNITED' &&
        entry.ContextPredicate === 'creationMode=MANUAL',
    ).map((entry) => stringField(entry, 'ModifierID'));
    const input = statBlock();
    const result = calculateSkillStageStats(CATALOG, {
      baseStats: input,
      raceCode: 'UNITED',
      classCode: null,
      creationMode: 'MANUAL',
    }).skillStageStats;
    expect(result).toEqual(expectedStats(input, modifierIds));
    expect(result.S).toBeLessThan(numberField(rawStat('S'), 'EffectiveMin'));
  });

  it('rejects an unknown creationMode', () => {
    expect(() =>
      calculateSkillStageStats(CATALOG, {
        baseStats: base,
        raceCode: 'FREE',
        classCode: null,
        creationMode: 'OTHER' as 'MANUAL',
      }),
    ).toThrow('unrecognized creationMode "OTHER"');
  });
});

describe('skill requirements and starting slots', () => {
  it('implements the CORE-081 and CORE-165 formulas from their rule cards', () => {
    expect(stringField(rule('CORE-081'), 'Итоговый алгоритм')).toContain('startSlots=ceil(W/2)');
    expect(stringField(rule('CORE-165'), 'Итоговый алгоритм')).toContain('slotCost=5+2×plusCount');
    const cooking = requirementsFor('COOKING')[0];
    if (cooking === undefined) throw new Error('COOKING requirement not found');
    const wisdom = numberField(cooking, 'MinValue');
    expect(calculateStartSkillSlots({ ...statBlock(), W: wisdom })).toBe(Math.ceil(wisdom / 2));
    expect(() => calculateStartSkillSlots({ ...statBlock(), W: Number.MAX_VALUE })).toThrow(
      'cannot be represented safely',
    );
    expect(calculateSkillSlotCost(5)).toBe(5);
    expect(calculateSkillSlotCost(6)).toBe(7);
    for (const invalid of [0, -1, 1.5]) {
      expect(() => calculateSkillSlotCost(invalid)).toThrow('positive integer by CORE-165');
    }
    expect(() => calculateSkillSlotCost(Number.MAX_SAFE_INTEGER)).toThrow(
      'cannot be represented safely',
    );
  });

  it('requires every CORE-167 row and reports the exact failed requirement', () => {
    const skillKey = 'WILDERNESS_SURVIVAL';
    const passing = statsMeeting(skillKey);
    expect(() => validateSkillRequirements(CATALOG, skillKey, passing)).not.toThrow();

    const failed = requirementsFor(skillKey).find((entry) => entry.StatCode === 'D');
    if (failed === undefined) throw new Error('D requirement not found');
    const actual = numberField(failed, 'MinValue') - 1;
    expect(() => validateSkillRequirements(CATALOG, skillKey, { ...passing, D: actual })).toThrow(
      `RequirementID ${JSON.stringify(stringField(failed, 'RequirementID'))}: ` +
        `StatCode "D", MinValue ${String(numberField(failed, 'MinValue'))}, actual ${String(actual)}`,
    );
    expect(() =>
      validateSkillRequirements(CATALOG, skillKey, { ...passing, D: Number.NaN }),
    ).toThrow('StatCode "D"');
  });

  it('bypasses requirements for the four artifact-issued fixed skills', () => {
    const fixed = RAW_SKILLS.filter((entry) => entry['Категория'] !== 'SELECTABLE_GENERAL');
    expect(fixed).toHaveLength(4);
    for (const skill of fixed) {
      const skillKey = stringField(skill, 'SkillKey');
      expect(requirementsFor(skillKey)).toEqual([]);
      expect(() => validateSkillRequirements(CATALOG, skillKey, statBlock())).not.toThrow();
    }
  });

  it('fills a FREE character slot with one selectable skill', () => {
    const acrobatics = requirementsFor('ACROBATICS')[0];
    if (acrobatics === undefined) throw new Error('ACROBATICS requirement not found');
    const stats = {
      ...statBlock(),
      D: numberField(acrobatics, 'MinValue'),
    };
    const result = validateSkillSelection(CATALOG, {
      raceCode: 'FREE',
      classCode: null,
      skillStageStats: stats,
      selectedSkills: [{ skillKey: 'ACROBATICS', targetBonus: 1 }],
    });
    expect(result).toMatchObject({ capacity: 1, used: 1, remaining: 0 });
    expect(result.learnedSkills).toEqual([
      { source: 'SELECTED', skillKey: 'ACROBATICS', bonus: 1, slotCost: 1 },
    ]);
  });

  it('grants FOLLOWING_PAIN without requirements or slot cost for UNITED', () => {
    const acrobatics = requirementsFor('ACROBATICS')[0];
    if (acrobatics === undefined) throw new Error('ACROBATICS requirement not found');
    const result = validateSkillSelection(CATALOG, {
      raceCode: 'UNITED',
      classCode: null,
      skillStageStats: {
        ...statBlock(),
        D: numberField(acrobatics, 'MinValue'),
      },
      selectedSkills: [{ skillKey: 'ACROBATICS', targetBonus: 1 }],
    });
    const granted = result.learnedSkills.find((skill) => skill.source === 'RACE_GRANTED');
    const sourceSkill = RAW_SKILLS.find((skill) => skill.SkillKey === 'FOLLOWING_PAIN');
    if (sourceSkill === undefined) throw new Error('FOLLOWING_PAIN not found');
    expect(granted).toEqual({
      source: 'RACE_GRANTED',
      skillKey: 'FOLLOWING_PAIN',
      bonus: numberField(sourceSkill, 'MaxBonus'),
      slotCost: 0,
    });
    expect(result.used).toBe(1);
  });

  it.each(['SEEKER', 'STALKER', 'SOLDIER'] as const)(
    'counts the mandatory %s class skill exactly once',
    (classCode) => {
      const sourceClass = RAW_CLASSES.find((entry) => entry.ClassCode === classCode);
      if (sourceClass === undefined) throw new Error(`class ${classCode} not found`);
      const mandatoryKey = stringField(sourceClass, 'MandatorySkillKey');
      const sourceSkill = RAW_SKILLS.find((entry) => entry.SkillKey === mandatoryKey);
      if (sourceSkill === undefined) throw new Error(`skill ${mandatoryKey} not found`);
      const result = validateSkillSelection(CATALOG, {
        raceCode: 'PURE',
        classCode,
        skillStageStats: statBlock(),
        selectedSkills: [],
      });
      expect(result).toMatchObject({ capacity: 1, used: 1, remaining: 0 });
      expect(result.learnedSkills).toEqual([
        {
          source: 'CLASS_MANDATORY',
          skillKey: mandatoryKey,
          bonus: numberField(sourceSkill, 'MaxBonus'),
          slotCost: numberField(sourceClass, 'MandatorySkillSlotCost'),
        },
      ]);
    },
  );

  it('rejects underfilled and exceeded starting-slot selections', () => {
    const create = OPERATIONS.find((entry) => entry.OperationID === 'OP-CHAR-CREATE');
    if (create === undefined) throw new Error('OP-CHAR-CREATE not found');
    expect(stringField(create, 'State transition / result')).toContain(
      'заполнить все обязательные стартовые слоты',
    );
    const baseWisdom = numberField(rawStat('W'), 'BaseMin');
    expect(() =>
      validateSkillSelection(CATALOG, {
        raceCode: 'FREE',
        classCode: null,
        skillStageStats: { ...statBlock(), W: baseWisdom + 2 },
        selectedSkills: [],
      }),
    ).toThrow('skill slots underfilled: used 0, capacity 2');

    const acrobatics = requirementsFor('ACROBATICS')[0];
    if (acrobatics === undefined) throw new Error('ACROBATICS requirement not found');
    expect(() =>
      validateSkillSelection(CATALOG, {
        raceCode: 'FREE',
        classCode: null,
        skillStageStats: {
          ...statBlock(),
          D: numberField(acrobatics, 'MinValue'),
        },
        selectedSkills: [{ skillKey: 'ACROBATICS', targetBonus: 2 }],
      }),
    ).toThrow('skill slots exceeded: used 2, capacity 1');
  });

  it('rejects unknown, fixed, and duplicate selectable keys', () => {
    const passing = statsMeeting('ACROBATICS');
    expect(() =>
      validateSkillSelection(CATALOG, {
        raceCode: 'FREE',
        classCode: null,
        skillStageStats: passing,
        selectedSkills: [{ skillKey: 'UNKNOWN', targetBonus: 1 }],
      }),
    ).toThrow('unknown SkillKey "UNKNOWN"');
    expect(() =>
      validateSkillSelection(CATALOG, {
        raceCode: 'FREE',
        classCode: null,
        skillStageStats: passing,
        selectedSkills: [{ skillKey: 'FOLLOWING_PAIN', targetBonus: 1 }],
      }),
    ).toThrow('cannot be selected');
    expect(() =>
      validateSkillSelection(CATALOG, {
        raceCode: 'FREE',
        classCode: null,
        skillStageStats: passing,
        selectedSkills: [
          { skillKey: 'ACROBATICS', targetBonus: 1 },
          { skillKey: 'ACROBATICS', targetBonus: 1 },
        ],
      }),
    ).toThrow('selected more than once');
  });
});
