import type { ClassCode, RaceCode, SkillId, StatCode } from '@generated/types/character.js';
export const CLASS_POLICIES = ['REQUIRED_PURE_CLASS', 'NO_CLASS'] as const;
export const SKILL_CATEGORIES = [
  'SELECTABLE_GENERAL',
  'FIXED_RACE_PASSIVE',
  'FIXED_CLASS_PASSIVE',
] as const;
export const MODIFIER_SOURCE_TYPES = ['RACE', 'PURE_CLASS', 'SYMBIONT_PROFILE'] as const;
export const APPLICATION_STAGES = ['SKILL_STAGE', 'CHECK_CONTEXT', 'EFFECTIVE_STATS'] as const;

export type ClassPolicy = (typeof CLASS_POLICIES)[number];
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
export type ModifierSourceType = (typeof MODIFIER_SOURCE_TYPES)[number];
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export type SkillSlotCostMode = 'BONUS_LEVEL_FORMULA_CORE-165' | 'FIXED_0' | 'FIXED_1';
export type ModifierStackPolicy =
  'ADD_ONCE_PER_SOURCE' | 'MOST_SPECIFIC_CONTEXT' | 'ADD_ONCE_PER_ACTIVE_SPECIES';
declare const skillKeyBrand: unique symbol;
/** No generated union exists: values are branded only after SkillKey dictionary validation. */
export type SkillKey = string & { readonly [skillKeyBrand]: true };
export class SkillStageRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface StatDefinition {
  readonly statCode: StatCode;
  readonly baseMin: number;
  readonly baseMax: number;
  readonly effectiveMin: number;
  readonly cap35Scope: 'SENTIENT_BASE_ONLY';
  readonly order: number;
}
export interface RaceDefinition {
  readonly raceCode: RaceCode;
  readonly classPolicy: ClassPolicy;
  readonly baseSymbiontSlots: number;
  readonly statModifierProfileId: string;
  readonly grantedSkillRefs: readonly SkillKey[];
}
export interface ClassDefinition {
  readonly classCode: ClassCode;
  readonly raceCode: RaceCode;
  readonly mandatorySkillKey: SkillKey;
  readonly mandatorySkillSlotCost: number;
  readonly statModifierProfileId: string;
  readonly contextModifierRefs: string;
}
export interface SkillDefinition {
  readonly skillKey: SkillKey;
  readonly skillId: SkillId;
  readonly category: SkillCategory;
  readonly slotCostMode: SkillSlotCostMode;
  readonly maxBonus: number | 'NO_RULED_UPPER_LIMIT';
  readonly missingSkillPenalty?: number;
  readonly status: 'ACTIVE';
}
export interface SkillRequirementDefinition {
  readonly requirementId: string;
  readonly requirementSetId: string;
  readonly skillKey: SkillKey;
  readonly statCode: StatCode;
  readonly minValue: number;
  readonly evaluationStage: 'SKILL_STAGE_PRE_SYMBIONT';
  readonly beforeSymbiontBonuses: true;
  readonly ruleId: 'CORE-167';
}
export interface StatModifierDefinition {
  readonly modifierId: string;
  readonly sourceType: ModifierSourceType;
  readonly sourceId: string;
  readonly targetKind: 'STAT';
  readonly targetCode: StatCode;
  readonly operation: 'ADD';
  readonly value: number;
  readonly contextPredicate: string;
  readonly applicationStage: ApplicationStage;
  readonly stackPolicy: ModifierStackPolicy;
}
export interface SkillStageCatalogSources {
  readonly dictionaries: unknown;
  readonly stats: unknown;
  readonly races: unknown;
  readonly classes: unknown;
  readonly skills: unknown;
  readonly requirements: unknown;
  readonly modifiers: unknown;
}
export interface SkillStageCatalog {
  readonly stats: readonly StatDefinition[];
  readonly races: readonly RaceDefinition[];
  readonly classes: readonly ClassDefinition[];
  readonly skills: readonly SkillDefinition[];
  readonly requirements: readonly SkillRequirementDefinition[];
  readonly modifiers: readonly StatModifierDefinition[];
}
type Row = Record<string, unknown>;

function fail(path: string, detail: string): never {
  throw new SkillStageRuleError(`${path}: ${detail}`);
}
function rows(value: unknown, path: string, expected: number): Row[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (value.length !== expected)
    fail(path, `expected ${String(expected)} rows, got ${String(value.length)}`);
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`${path}[${String(index)}]`, 'expected an object');
    }
    return entry as Row;
  });
}
function text(row: Row, key: string, path: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0)
    fail(`${path}.${key}`, 'expected a non-empty string');
  return value;
}
function integer(row: Row, key: string, path: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    fail(`${path}.${key}`, 'expected a safe integer');
  return value;
}
function literal<T extends string>(row: Row, key: string, allowed: readonly T[], path: string): T {
  const value = text(row, key, path);
  if (!(allowed as readonly string[]).includes(value)) {
    const expected = allowed.join(', ');
    fail(`${path}.${key}`, `unrecognized ${JSON.stringify(value)}; expected: ${expected}`);
  }
  return value as T;
}
function requireUnique<T>(path: string, values: readonly T[], keyOf: (value: T) => unknown): void {
  if (new Set(values.map(keyOf)).size !== values.length) fail(path, 'contains duplicate values');
}
function requireSet(path: string, actual: ReadonlySet<string>, expected: readonly string[]): void {
  const missing = expected.filter((value) => !actual.has(value));
  const extra = [...actual].filter((value) => !expected.includes(value));
  if (missing.length > 0 || extra.length > 0) {
    const detail = `missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`;
    fail(path, `catalog mismatch; ${detail}`);
  }
}
function requireCount(path: string, actual: number, expected: number): void {
  if (actual !== expected) fail(path, `expected ${String(expected)}, got ${String(actual)}`);
}
function requirePopulations<T>(
  path: string,
  values: readonly T[],
  keyOf: (value: T) => string,
  expected: Readonly<Record<string, number>>,
): void {
  const actual = new Map<string, number>();
  for (const value of values) {
    const key = keyOf(value);
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }
  for (const key of actual.keys())
    if (!Object.hasOwn(expected, key)) fail(path, `unexpected ${key}`);
  for (const [key, count] of Object.entries(expected))
    requireCount(`${path} ${key}`, actual.get(key) ?? 0, count);
}

const STAT_CODES = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const satisfies readonly StatCode[];
const RACE_CODES = ['PURE', 'FREE', 'UNITED'] as const satisfies readonly RaceCode[];
const CLASS_CODES = ['SEEKER', 'STALKER', 'SOLDIER'] as const satisfies readonly ClassCode[];
const STAT_LAYERS = ['baseStats', 'skillStageStats', 'effectiveStats', 'equippedStats'] as const;
const SOURCE_DICTIONARIES = {
  RACE: 'RaceCode',
  PURE_CLASS: 'PureClass',
  SYMBIONT_PROFILE: 'SymbiontSpecies',
} as const satisfies Record<ModifierSourceType, string>;

/** Counts come from the seven generated/spec/character files named in issue #39. */
export function createSkillStageCatalog(sources: SkillStageCatalogSources): SkillStageCatalog {
  const dictionaryRows = rows(sources.dictionaries, 'dictionaries', 151);
  const statRows = rows(sources.stats, 'stats', 7);
  const raceRows = rows(sources.races, 'races', 3);
  const classRows = rows(sources.classes, 'classes', 3);
  const skillRows = rows(sources.skills, 'skills', 45);
  const requirementRows = rows(sources.requirements, 'requirements', 84);
  const modifierRows = rows(sources.modifiers, 'modifiers', 43);

  const dictionaries = dictionaryRows.map((row, index) => {
    const path = `dictionaries[${String(index)}]`;
    return {
      code: text(row, 'Code', path),
      dictionary: text(row, 'Dictionary', path),
      meaning: text(row, 'Meaning', path),
    };
  });
  requireUnique(
    'dictionaries.Dictionary/Code',
    dictionaries,
    (entry) => `${entry.dictionary}\0${entry.code}`,
  );
  const dictionaryNames = new Set(dictionaries.map((entry) => entry.dictionary));
  requireCount('dictionaries.Dictionary', dictionaryNames.size, 24);
  const dictionarySet = (name: string): Set<string> =>
    new Set(dictionaries.filter((entry) => entry.dictionary === name).map((entry) => entry.code));
  const statCodes = dictionarySet('StatCode');
  const raceCodes = dictionarySet('RaceCode');
  const classCodes = dictionarySet('PureClass');
  const skillKeys = dictionarySet('SkillKey');
  const symbiontSpecies = dictionarySet('SymbiontSpecies');
  requireSet('dictionary StatCode', statCodes, STAT_CODES);
  requireSet('dictionary RaceCode', raceCodes, RACE_CODES);
  requireSet('dictionary PureClass', classCodes, CLASS_CODES);
  requireSet('dictionary StatLayer', dictionarySet('StatLayer'), STAT_LAYERS);
  requireCount('dictionary SkillKey', skillKeys.size, 45);
  requireCount('dictionary SymbiontSpecies', symbiontSpecies.size, 23);
  const skillStageLayer = dictionaries.find(
    (entry) => entry.dictionary === 'StatLayer' && entry.code === 'skillStageStats',
  );
  if (skillStageLayer?.meaning !== 'base + race + class') {
    fail('dictionary StatLayer/skillStageStats.Meaning', 'expected "base + race + class"');
  }

  const stats = statRows.map((row, index): StatDefinition => {
    const path = `stats[${String(index)}]`;
    const statCode = text(row, 'StatCode', path);
    if (!statCodes.has(statCode))
      fail(`${path}.StatCode`, `unknown StatCode ${JSON.stringify(statCode)}`);
    const cap35Scope = literal(row, 'Cap35Scope', ['SENTIENT_BASE_ONLY'] as const, path);
    return Object.freeze({
      baseMax: integer(row, 'BaseMax игрока', path),
      baseMin: integer(row, 'BaseMin', path),
      cap35Scope,
      effectiveMin: integer(row, 'EffectiveMin', path),
      order: integer(row, 'Порядок', path),
      statCode: statCode as StatCode,
    });
  });
  requireSet('stats.StatCode', new Set(stats.map((stat) => stat.statCode)), STAT_CODES);

  const asSkillKey = (value: string, path: string): SkillKey => {
    if (!skillKeys.has(value)) fail(path, `unknown SkillKey ${JSON.stringify(value)}`);
    return value as SkillKey;
  };
  const races = raceRows.map((row, index): RaceDefinition => {
    const path = `races[${String(index)}]`;
    const raceCode = text(row, 'RaceCode', path);
    if (!raceCodes.has(raceCode))
      fail(`${path}.RaceCode`, `unknown RaceCode ${JSON.stringify(raceCode)}`);
    const granted = Object.hasOwn(row, 'GrantedSkillRefs')
      ? text(row, 'GrantedSkillRefs', path)
      : undefined;
    const grantedSkillRefs = Object.freeze(
      granted === undefined
        ? ([] as SkillKey[])
        : granted.split(';').map((value) => asSkillKey(value.trim(), `${path}.GrantedSkillRefs`)),
    );
    return Object.freeze({
      baseSymbiontSlots: integer(row, 'BaseSymbiontSlots', path),
      classPolicy: literal(row, 'ClassPolicy', CLASS_POLICIES, path),
      grantedSkillRefs,
      raceCode: raceCode as RaceCode,
      statModifierProfileId: text(row, 'StatModifierProfileID', path),
    });
  });
  requireSet('races.RaceCode', new Set(races.map((race) => race.raceCode)), RACE_CODES);

  const classes = classRows.map((row, index): ClassDefinition => {
    const path = `classes[${String(index)}]`;
    const classCode = text(row, 'ClassCode', path);
    const raceCode = text(row, 'RaceCode', path);
    if (!classCodes.has(classCode))
      fail(`${path}.ClassCode`, `unknown PureClass ${JSON.stringify(classCode)}`);
    if (!raceCodes.has(raceCode))
      fail(`${path}.RaceCode`, `unknown RaceCode ${JSON.stringify(raceCode)}`);
    return Object.freeze({
      classCode: classCode as ClassCode,
      contextModifierRefs: text(row, 'ContextModifierRefs', path),
      mandatorySkillKey: asSkillKey(
        text(row, 'MandatorySkillKey', path),
        `${path}.MandatorySkillKey`,
      ),
      mandatorySkillSlotCost: integer(row, 'MandatorySkillSlotCost', path),
      raceCode: raceCode as RaceCode,
      statModifierProfileId: text(row, 'StatModifierProfileID', path),
    });
  });
  requireSet('classes.ClassCode', new Set(classes.map((entry) => entry.classCode)), CLASS_CODES);

  const skills = skillRows.map((row, index): SkillDefinition => {
    const path = `skills[${String(index)}]`;
    const rawMax = row.MaxBonus;
    if (
      rawMax !== 'NO_RULED_UPPER_LIMIT' &&
      (typeof rawMax !== 'number' || !Number.isSafeInteger(rawMax))
    )
      fail(`${path}.MaxBonus`, 'expected a safe integer or NO_RULED_UPPER_LIMIT');
    const penalty = Object.hasOwn(row, 'MissingSkillPenalty')
      ? integer(row, 'MissingSkillPenalty', path)
      : undefined;
    return Object.freeze({
      category: literal(row, 'Категория', SKILL_CATEGORIES, path),
      maxBonus: rawMax,
      ...(penalty === undefined ? {} : { missingSkillPenalty: penalty }),
      skillId: text(row, 'SkillID', path) as SkillId,
      skillKey: asSkillKey(text(row, 'SkillKey', path), `${path}.SkillKey`),
      slotCostMode: literal(
        row,
        'SlotCostMode',
        ['BONUS_LEVEL_FORMULA_CORE-165', 'FIXED_0', 'FIXED_1'] as const,
        path,
      ),
      status: literal(row, 'Status', ['ACTIVE'] as const, path),
    });
  });
  requireUnique('skills.SkillID', skills, (skill) => skill.skillId);
  requireSet('skills.SkillKey', new Set(skills.map((skill) => skill.skillKey)), [...skillKeys]);
  // generated/spec/character/skills.json Category populations printed in issue #39.
  requirePopulations('skills.Category', skills, (skill) => skill.category, {
    SELECTABLE_GENERAL: 41,
    FIXED_CLASS_PASSIVE: 3,
    FIXED_RACE_PASSIVE: 1,
  });

  const requirements = requirementRows.map((row, index): SkillRequirementDefinition => {
    const path = `requirements[${String(index)}]`;
    if (row.BeforeSymbiontBonuses !== true) fail(`${path}.BeforeSymbiontBonuses`, 'expected true');
    return Object.freeze({
      beforeSymbiontBonuses: true,
      evaluationStage: literal(row, 'EvaluationStage', ['SKILL_STAGE_PRE_SYMBIONT'] as const, path),
      minValue: integer(row, 'MinValue', path),
      requirementId: text(row, 'RequirementID', path),
      requirementSetId: text(row, 'RequirementSetID', path),
      ruleId: literal(row, 'Rule ID', ['CORE-167'] as const, path),
      skillKey: asSkillKey(text(row, 'SkillKey', path), `${path}.SkillKey`),
      statCode: literal(row, 'StatCode', STAT_CODES, path),
    });
  });
  requireUnique('requirements.RequirementID', requirements, (entry) => entry.requirementId);
  const modifierSources = modifierRows.map((row, index) => {
    const path = `modifiers[${String(index)}]`;
    const sourceType = literal(row, 'SourceType', MODIFIER_SOURCE_TYPES, path);
    const sourceId = text(row, 'SourceID', path);
    const expectedDictionary = SOURCE_DICTIONARIES[sourceType];
    if (!dictionarySet(expectedDictionary).has(sourceId)) {
      fail(
        `${path}.SourceID`,
        `unknown pair (${sourceType}, ${sourceId}); expected dictionary ${expectedDictionary}`,
      );
    }
    return { path, row, sourceId, sourceType };
  });
  requirePopulations(
    'modifier group',
    modifierSources.filter((entry) => entry.sourceType !== 'SYMBIONT_PROFILE'),
    (entry) => `${entry.sourceType}/${entry.sourceId}`,
    {
      'RACE/FREE': 3,
      'RACE/UNITED': 8,
      // ADR 0023 makes this the sole allowed empty race/class tuple.
      'RACE/PURE': 0,
      'PURE_CLASS/SEEKER': 6,
      'PURE_CLASS/STALKER': 6,
      'PURE_CLASS/SOLDIER': 6,
    },
  );

  const modifiers = modifierSources.map(
    ({ path, row, sourceId, sourceType }): StatModifierDefinition =>
      Object.freeze({
        applicationStage: literal(row, 'ApplicationStage', APPLICATION_STAGES, path),
        contextPredicate: text(row, 'ContextPredicate', path),
        modifierId: text(row, 'ModifierID', path),
        operation: literal(row, 'Operation', ['ADD'] as const, path),
        sourceId,
        sourceType,
        stackPolicy: literal(
          row,
          'StackPolicy',
          ['ADD_ONCE_PER_SOURCE', 'MOST_SPECIFIC_CONTEXT', 'ADD_ONCE_PER_ACTIVE_SPECIES'] as const,
          path,
        ),
        targetCode: literal(row, 'TargetCode', STAT_CODES, path),
        targetKind: literal(row, 'TargetKind', ['STAT'] as const, path),
        value: integer(row, 'Value', path),
      }),
  );
  requireUnique('modifiers.ModifierID', modifiers, (modifier) => modifier.modifierId);
  // Raw pair totals plus the exact SKILL_STAGE populations below force every
  // race/class remainder to CHECK_CONTEXT; symbiont rows are all effective-stat rows.
  for (const modifier of modifiers) {
    const validStage =
      modifier.sourceType === 'SYMBIONT_PROFILE'
        ? modifier.applicationStage === 'EFFECTIVE_STATS'
        : modifier.applicationStage === 'SKILL_STAGE' ||
          modifier.applicationStage === 'CHECK_CONTEXT';
    const pair = `${modifier.sourceType}/${modifier.sourceId}`;
    if (!validStage) fail(`modifier stage ${pair}`, `unexpected ${modifier.applicationStage}`);
  }
  const skillStage = modifiers.filter((modifier) => modifier.applicationStage === 'SKILL_STAGE');
  for (const modifier of skillStage) {
    if (modifier.stackPolicy !== 'ADD_ONCE_PER_SOURCE') {
      fail(
        `modifier ${modifier.modifierId}.StackPolicy`,
        'SKILL_STAGE requires ADD_ONCE_PER_SOURCE',
      );
    }
  }
  requirePopulations(
    'SKILL_STAGE source/predicate',
    skillStage,
    (entry) => `${entry.sourceType}/${entry.sourceId}/${entry.contextPredicate}`,
    {
      'RACE/FREE/creationMode=MANUAL': 3,
      'RACE/UNITED/creationMode=MANUAL': 3,
      'RACE/UNITED/creationMode=RANDOM': 3,
      'PURE_CLASS/SEEKER/ownerRace=PURE': 4,
      'PURE_CLASS/STALKER/ownerRace=PURE': 4,
      'PURE_CLASS/SOLDIER/ownerRace=PURE': 4,
    },
  );
  const selectable = skills.filter((skill) => skill.category === 'SELECTABLE_GENERAL');
  const setsBySkill = new Map<SkillKey, Set<string>>();
  for (const requirement of requirements) {
    const sets = setsBySkill.get(requirement.skillKey) ?? new Set<string>();
    sets.add(requirement.requirementSetId);
    setsBySkill.set(requirement.skillKey, sets);
  }
  requireSet(
    'requirements SkillKey',
    new Set(setsBySkill.keys()),
    selectable.map((skill) => skill.skillKey),
  );
  requireCount(
    'requirements RequirementSetID',
    new Set(requirements.map((entry) => entry.requirementSetId)).size,
    41,
  );
  for (const skill of selectable) {
    requireCount(
      `requirements/${skill.skillKey} sets`,
      setsBySkill.get(skill.skillKey)?.size ?? 0,
      1,
    );
    if (
      skill.slotCostMode !== 'BONUS_LEVEL_FORMULA_CORE-165' ||
      skill.maxBonus !== 'NO_RULED_UPPER_LIMIT'
    ) {
      fail(
        `skills/${skill.skillKey}`,
        'selectable skill requires CORE-165 slot formula and no ruled upper limit',
      );
    }
  }

  const raceByCode = new Map(races.map((race) => [race.raceCode, race]));
  if (raceByCode.get('PURE')?.classPolicy !== 'REQUIRED_PURE_CLASS')
    fail('races/PURE.ClassPolicy', 'expected REQUIRED_PURE_CLASS');
  for (const code of ['FREE', 'UNITED'] as const) {
    if (raceByCode.get(code)?.classPolicy !== 'NO_CLASS')
      fail(`races/${code}.ClassPolicy`, 'expected NO_CLASS');
  }
  requireSet(
    'classes.MandatorySkillKey',
    new Set(classes.map((entry) => entry.mandatorySkillKey)),
    skills
      .filter((skill) => skill.category === 'FIXED_CLASS_PASSIVE')
      .map((skill) => skill.skillKey),
  );
  for (const entry of classes) {
    const mandatory = skills.find((skill) => skill.skillKey === entry.mandatorySkillKey);
    if (entry.raceCode !== 'PURE' || entry.mandatorySkillSlotCost !== 1) {
      fail(`classes/${entry.classCode}`, 'expected PURE with MandatorySkillSlotCost=1 (CORE-008)');
    }
    if (
      mandatory?.category !== 'FIXED_CLASS_PASSIVE' ||
      mandatory.slotCostMode !== 'FIXED_1' ||
      typeof mandatory.maxBonus !== 'number'
    ) {
      fail(`classes/${entry.classCode}.MandatorySkillKey`, 'expected FIXED_CLASS_PASSIVE/FIXED_1');
    }
  }
  for (const race of races) {
    const expectedCount = race.raceCode === 'UNITED' ? 1 : 0;
    requireCount(
      `races/${race.raceCode}.GrantedSkillRefs`,
      race.grantedSkillRefs.length,
      expectedCount,
    );
    for (const key of race.grantedSkillRefs) {
      const granted = skills.find((skill) => skill.skillKey === key);
      if (
        granted?.category !== 'FIXED_RACE_PASSIVE' ||
        granted.slotCostMode !== 'FIXED_0' ||
        typeof granted.maxBonus !== 'number'
      ) {
        fail(`races/${race.raceCode}.GrantedSkillRefs`, 'expected FIXED_RACE_PASSIVE/FIXED_0');
      }
    }
  }
  return Object.freeze({
    classes: Object.freeze(classes),
    modifiers: Object.freeze(modifiers),
    races: Object.freeze(races),
    requirements: Object.freeze(requirements),
    skills: Object.freeze(skills),
    stats: Object.freeze(stats),
  });
}
