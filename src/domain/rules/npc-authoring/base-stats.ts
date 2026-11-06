import type { ClassCode, RaceCode, StatCode } from '@generated/types/character.js';

import { createSkillStageCatalog } from '../skill-stage/catalog.js';
import type { SkillStageCatalog, SkillStageCatalogSources } from '../skill-stage/catalog.js';
import { calculateSkillStageStats } from '../skill-stage/stats.js';
import type { StatBlock } from '../skill-stage/stats.js';
import type { NpcIdentityStageInput, NpcSchemaStageInput } from './types.js';

export class NpcBaseStatRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export type NpcValidatedSchema = NpcSchemaStageInput &
  Readonly<Pick<NpcIdentityStageInput, 'sex' | 'massKg'>>;

export interface NpcBaseStatCatalog {
  readonly perStatMinMax: Readonly<
    Record<StatCode, Readonly<{ minimum: number; maximum: number }>>
  >;
}

/** Deliberately ends before symbionts, lifetime consequences, equipment and effects. */
export interface NpcBaseStatLayers {
  readonly schema: NpcValidatedSchema;
  readonly baseStats: StatBlock;
  readonly skillStageStats: StatBlock;
  readonly appliedModifierIds: readonly string[];
}

const contexts = new WeakMap<NpcBaseStatCatalog, SkillStageCatalog>();
// ADR 0077 A overrides the earlier mass workflow for NPC; endpoints are inclusive.
const MASS_BOUNDS = {
  PURE: { MALE: [60, 400], FEMALE: [40, 350] },
  UNITED: { MALE: [30, 150], FEMALE: [25, 120] },
  FREE: { MALE: [40, 200], FEMALE: [30, 160] },
} as const satisfies Record<RaceCode, Record<'MALE' | 'FEMALE', readonly [number, number]>>;

function fail(message: string): never {
  throw new NpcBaseStatRuleError(message);
}

/** Copy only own data fields: a getter cannot alter a later validation/derivation read. */
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label}: expected an object`);
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(`${label}: unsupported prototype`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    fail(`${label}: expected exactly ${keys.join(', ')}`);
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      fail(`${label}.${key}: expected an own data field`);
    }
    result[key] = descriptor.value as unknown;
  }
  return result;
}

function context(catalog: NpcBaseStatCatalog): SkillStageCatalog {
  const result = contexts.get(catalog);
  if (result === undefined)
    fail('NPC base-stat catalog must originate from createNpcBaseStatCatalog');
  return result;
}

/** The editor displays the same ADR 0077 bounds used by schema validation; no second table. */
export function npcMassBounds(
  catalog: NpcBaseStatCatalog,
  raceCode: unknown,
  sex: unknown,
): Readonly<{ minimum: number; maximum: number }> {
  const race = context(catalog).races.find((entry) => entry.raceCode === raceCode);
  if (race === undefined || (sex !== 'MALE' && sex !== 'FEMALE'))
    return fail('NPC mass bounds: exact source race and sex required');
  const [minimum, maximum] = MASS_BOUNDS[race.raceCode][sex];
  return Object.freeze({ minimum, maximum });
}

/** CORE-078 is the common manual rule, not a transfer of the PC point-buy total. */
export function createNpcBaseStatCatalog(
  sources: SkillStageCatalogSources,
  core078: unknown,
): NpcBaseStatCatalog {
  if (core078 === null || typeof core078 !== 'object' || Array.isArray(core078)) {
    fail('CORE-078: expected the source rule card');
  }
  const card = core078 as Record<string, unknown>;
  if (card['Rule ID'] !== 'CORE-078' || card['Статус'] !== 'Активно') {
    fail('CORE-078: expected the active CORE-078 source card');
  }
  const algorithm = card['Итоговый алгоритм'];
  if (typeof algorithm !== 'string' || card['Ручной выбор мастера'] !== algorithm) {
    fail('CORE-078: manual and final algorithm witnesses must match');
  }
  const match =
    /^постоянное значение не ниже ([1-9]\d*); ручное распределение до расовых\/симбиотических поправок — не более ([1-9]\d*) в одну характеристику; случайные значения, криты, раса, симбионты и развитие могут дать >([1-9]\d*); временный штраф может сделать итог проверки отрицательным, но не саму характеристику, если эффект не говорит иное\.$/u.exec(
      algorithm,
    );
  if (match === null) fail('CORE-078: unsupported manual bounds contract');
  const minimum = Number(match[1]);
  const maximum = Number(match[2]);
  if (
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum > maximum ||
    maximum !== Number(match[3])
  ) {
    fail('CORE-078: inconsistent manual bounds');
  }
  const skillStage = createSkillStageCatalog(sources);
  const perStatMinMax = {} as Record<StatCode, Readonly<{ minimum: number; maximum: number }>>;
  for (const stat of skillStage.stats) {
    if (stat.baseMin !== minimum || stat.baseMax !== maximum || stat.effectiveMin !== minimum) {
      fail(`CORE-078: Character stats.${stat.statCode} disagrees with the source bounds`);
    }
    perStatMinMax[stat.statCode] = Object.freeze({ minimum, maximum });
  }
  const catalog = Object.freeze({ perStatMinMax: Object.freeze(perStatMinMax) });
  contexts.set(catalog, skillStage);
  return catalog;
}

/** NPC-002 identity sex/mass and NPC-011 schema are combined only for validation. */
export function validateNpcSchema(catalog: NpcBaseStatCatalog, value: unknown): NpcValidatedSchema {
  const skillStage = context(catalog);
  const row = exact(
    value,
    ['raceCode', 'pureClassOrNull', 'anatomyProfileId', 'sex', 'massKg'],
    'NPC schema',
  );
  const race = skillStage.races.find((entry) => entry.raceCode === row['raceCode']);
  if (race === undefined) fail('NPC schema.raceCode: unknown race');
  let pureClassOrNull: ClassCode | null = null;
  if (race.classPolicy === 'REQUIRED_PURE_CLASS') {
    const selected = skillStage.classes.find((entry) => entry.classCode === row['pureClassOrNull']);
    if (selected === undefined || selected.raceCode !== race.raceCode) {
      fail('NPC schema.pureClassOrNull: PURE requires one matching class (CORE-008)');
    }
    pureClassOrNull = selected.classCode;
  } else if (row['pureClassOrNull'] !== null) {
    fail('NPC schema.pureClassOrNull: this race requires null (CORE-008)');
  }
  if (row['anatomyProfileId'] !== 'STANDARD_HUMANOID') {
    fail('NPC schema.anatomyProfileId: only STANDARD_HUMANOID is allowed (AQA-010)');
  }
  const sex = row['sex'];
  if (sex !== 'MALE' && sex !== 'FEMALE')
    fail('NPC schema.sex: expected MALE or FEMALE (ADR 0077 A)');
  const massKg = row['massKg'];
  const [minimum, maximum] = MASS_BOUNDS[race.raceCode][sex];
  if (
    typeof massKg !== 'number' ||
    !Number.isFinite(massKg) ||
    massKg < minimum ||
    massKg > maximum ||
    Math.round(massKg * 10) / 10 !== massKg
  ) {
    fail(
      `NPC schema.massKg: expected ${String(minimum)}..${String(maximum)} kg at exact 0.1 precision (ADR 0077 A)`,
    );
  }
  return Object.freeze({
    raceCode: race.raceCode,
    pureClassOrNull,
    anatomyProfileId: 'STANDARD_HUMANOID',
    sex,
    massKg,
  });
}

export function deriveNpcBaseStatLayers(
  catalog: NpcBaseStatCatalog,
  value: unknown,
): NpcBaseStatLayers {
  const skillStage = context(catalog);
  const row = exact(value, ['schema', 'baseStats'], 'NPC base-stat input');
  const schema = validateNpcSchema(catalog, row['schema']);
  const input = exact(
    row['baseStats'],
    skillStage.stats.map((stat) => stat.statCode),
    'NPC baseStats',
  );
  const baseStats = {} as Record<StatCode, number>;
  for (const stat of skillStage.stats) {
    const n = input[stat.statCode];
    const { minimum, maximum } = catalog.perStatMinMax[stat.statCode];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < minimum || n > maximum) {
      fail(
        `NPC baseStats.${stat.statCode}: expected a safe integer ${String(minimum)}..${String(maximum)} (CORE-078/NPC-012)`,
      );
    }
    baseStats[stat.statCode] = n;
  }
  const derived = calculateSkillStageStats(skillStage, {
    baseStats,
    classCode: schema.pureClassOrNull,
    creationMode: 'MANUAL',
    raceCode: schema.raceCode,
  });
  // CORE-164 evaluates the complete permanent composition later. No premature clamp/refusal.
  return Object.freeze({ schema, baseStats: Object.freeze(baseStats), ...derived });
}
