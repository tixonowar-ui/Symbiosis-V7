import type { ClassCode, RaceCode, StatCode } from '@generated/types/character.js';
import { SkillStageRuleError } from './catalog.js';
import type { SkillStageCatalog } from './catalog.js';
export const CREATION_MODES = ['MANUAL', 'RANDOM'] as const;
export type CreationMode = (typeof CREATION_MODES)[number];
export type StatBlock = Readonly<Record<StatCode, number>>;

export interface SkillStageInput {
  readonly baseStats: StatBlock;
  readonly classCode: ClassCode | null;
  readonly creationMode: CreationMode;
  readonly raceCode: RaceCode;
}

export interface SkillStageResult {
  readonly appliedModifierIds: readonly string[];
  readonly skillStageStats: StatBlock;
}

const RULES = Object.freeze({
  sourceGroups: ['CORE-001', 'CORE-006'] as const,
  classSelection: 'CORE-008',
  baseMinimum: 'CORE-078',
  modifierOrder: 'CORE-079',
});
const creationModes = new Set<unknown>(CREATION_MODES);

type ClassDefinition = SkillStageCatalog['classes'][number];
type RaceDefinition = SkillStageCatalog['races'][number];

function fail(message: string): never {
  throw new SkillStageRuleError(message);
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function requireBaseStats(catalog: SkillStageCatalog, value: unknown): Record<StatCode, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`baseStats must be an object with the exact StatCode keys; received ${show(value)}`);
  }
  const row = value as Record<string, unknown>;
  const expected = catalog.stats.map(({ statCode }) => statCode);
  const actualKeys = Object.keys(row);
  const expectedSet = new Set<string>(expected);
  const actualSet = new Set(actualKeys);
  const missing = expected.filter((key) => !actualSet.has(key));
  const extra = actualKeys.filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `baseStats keys must exactly match StatCode; missing: ${missing.join(', ') || 'none'}; unexpected: ${extra.join(', ') || 'none'}`,
    );
  }

  const result = {} as Record<StatCode, number>;
  for (const stat of catalog.stats) {
    const valueAtKey = row[stat.statCode];
    if (typeof valueAtKey !== 'number' || !Number.isFinite(valueAtKey)) {
      fail(`baseStats.${stat.statCode} must be finite; received ${show(valueAtKey)}`);
    }
    if (valueAtKey < stat.baseMin) {
      fail(
        `baseStats.${stat.statCode} must be at least BaseMin ${String(stat.baseMin)}; received ${String(valueAtKey)} (${RULES.baseMinimum})`,
      );
    }
    result[stat.statCode] = valueAtKey;
  }
  return result;
}

function requireRace(catalog: SkillStageCatalog, value: unknown): RaceDefinition {
  const race = catalog.races.find(({ raceCode }) => raceCode === value);
  if (race === undefined) {
    fail(
      `unrecognized RaceCode ${show(value)}; expected: ${catalog.races.map(({ raceCode }) => raceCode).join(', ')}`,
    );
  }
  return race;
}

function requireClass(
  catalog: SkillStageCatalog,
  race: RaceDefinition,
  value: unknown,
): ClassDefinition | null {
  if (value === null) {
    if (race.classPolicy === 'REQUIRED_PURE_CLASS') {
      fail(
        `RaceCode ${race.raceCode} has ClassPolicy REQUIRED_PURE_CLASS and requires one PureClass (${RULES.classSelection})`,
      );
    }
    return null;
  }
  const selected = catalog.classes.find(({ classCode }) => classCode === value);
  if (selected === undefined) {
    fail(
      `unrecognized ClassCode ${show(value)}; expected: ${catalog.classes.map(({ classCode }) => classCode).join(', ')}`,
    );
  }
  if (race.classPolicy === 'NO_CLASS') {
    fail(
      `RaceCode ${race.raceCode} has ClassPolicy NO_CLASS and requires classCode null; received ${selected.classCode} (${RULES.classSelection})`,
    );
  }
  if (selected.raceCode !== race.raceCode) {
    fail(
      `ClassCode ${selected.classCode} belongs to RaceCode ${selected.raceCode}, not ${race.raceCode} (${RULES.classSelection})`,
    );
  }
  return selected;
}

function matches(predicate: string, input: SkillStageInput): boolean {
  switch (predicate) {
    case 'creationMode=MANUAL':
      return input.creationMode === 'MANUAL';
    case 'creationMode=RANDOM':
      return input.creationMode === 'RANDOM';
    case 'ownerRace=PURE':
      return input.raceCode === 'PURE';
    default:
      fail(`unsupported SKILL_STAGE ContextPredicate ${show(predicate)}`);
  }
}

function applySource(
  catalog: SkillStageCatalog,
  sourceType: 'PURE_CLASS' | 'RACE',
  sourceId: string,
  input: SkillStageInput,
  stats: Record<StatCode, number>,
  applied: string[],
): void {
  const group = catalog.modifiers.filter(
    (row) => row.sourceType === sourceType && row.sourceId === sourceId,
  );
  const pair = `(${sourceType}, ${sourceId})`;
  if (sourceType === 'RACE' && sourceId === 'PURE') {
    if (group.length !== 0) fail(`modifier group ${pair} must remain empty under ADR 0023`);
    return;
  }
  if (group.length === 0) {
    fail(
      `modifier group ${pair} is empty; source data is required (${RULES.sourceGroups.join('/')})`,
    );
  }

  for (const modifier of group) {
    if (modifier.applicationStage !== 'SKILL_STAGE') continue;
    // createSkillStageCatalog guarantees STAT/ADD/ADD_ONCE_PER_SOURCE (CORE-079).
    if (!matches(modifier.contextPredicate, input)) continue;
    stats[modifier.targetCode] += modifier.value;
    applied.push(modifier.modifierId);
  }
}

export function calculateSkillStageStats(
  catalog: SkillStageCatalog,
  input: SkillStageInput,
): SkillStageResult {
  if (!creationModes.has(input.creationMode)) {
    fail(
      `unrecognized creationMode ${show(input.creationMode)}; expected: ${CREATION_MODES.join(', ')}`,
    );
  }
  const race = requireRace(catalog, input.raceCode);
  const selectedClass = requireClass(catalog, race, input.classCode);
  const stats = requireBaseStats(catalog, input.baseStats);
  const applied: string[] = [];

  applySource(catalog, 'RACE', race.raceCode, input, stats, applied);
  if (selectedClass !== null) {
    applySource(catalog, 'PURE_CLASS', selectedClass.classCode, input, stats, applied);
  }
  return Object.freeze({
    appliedModifierIds: Object.freeze([...applied]),
    skillStageStats: Object.freeze({ ...stats }),
  });
}
