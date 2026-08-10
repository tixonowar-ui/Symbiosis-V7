import type { StatCode } from '@generated/types/character.js';
import type { SkillStageCatalog, StatBlock } from './skill-stage/index.js';

export const STAT_ASSIGNMENT_FORM_ID = 'CHR-009' as const;
export const STAT_ASSIGNMENT_MODES = Object.freeze([
  'ROLLED_BIJECTION',
  'POINT_BUY_90',
  'POINT_BUY_85',
] as const);

export type StatAssignmentMode = (typeof STAT_ASSIGNMENT_MODES)[number];
export type StatAssignmentCatalog = Pick<SkillStageCatalog, 'stats'>;
export type StatAssignmentInput =
  | {
      readonly acceptedValues: readonly number[];
      readonly assignedStats: StatBlock;
      readonly assignmentMode: 'ROLLED_BIJECTION';
    }
  | {
      readonly assignedStats: StatBlock;
      readonly assignmentMode: 'POINT_BUY_90' | 'POINT_BUY_85';
    };

export class StatAssignmentRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

const RULES = Object.freeze({
  classic: 'CORE-160',
  adventurous: 'CORE-161',
  allOrNothing: 'CORE-162',
});
const ROLLED_BIJECTION_RULE_IDS = Object.freeze([
  RULES.classic,
  RULES.adventurous,
  RULES.allOrNothing,
]);
// Exact manual totals belong to CORE-160/161; CORE-162 deliberately has no entry.
const POINT_BUY_CONTRACTS = Object.freeze({
  POINT_BUY_90: Object.freeze({ requiredTotal: 90, ruleId: RULES.classic }),
  POINT_BUY_85: Object.freeze({ requiredTotal: 85, ruleId: RULES.adventurous }),
});
// CHR-009 and Q-CORE-048 attach this range only to point buy, never to rolled values.
const POINT_BUY_RANGE = Object.freeze({ maximum: 20, minimum: 1 });
// CHR-009 and CORE-160/161/162 all define one assignment as seven characteristics.
const STAT_COUNT = 7;
const assignmentModes = new Set<unknown>(STAT_ASSIGNMENT_MODES);

type PointBuyMode = keyof typeof POINT_BUY_CONTRACTS;
type StatDefinition = SkillStageCatalog['stats'][number];

function fail(detail: string): never {
  throw new StatAssignmentRuleError(`${STAT_ASSIGNMENT_FORM_ID}: ${detail}`);
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function requireAssignmentMode(value: unknown): asserts value is StatAssignmentMode {
  if (!assignmentModes.has(value)) {
    fail(
      `unrecognized assignmentMode ${show(value)}; expected: ${STAT_ASSIGNMENT_MODES.join(', ')}`,
    );
  }
}

/** Runtime codes and order come from generated stats through the catalog, not a second vocabulary. */
function orderedStats(catalog: StatAssignmentCatalog): readonly StatDefinition[] {
  if (catalog.stats.length !== STAT_COUNT) {
    fail(
      `catalog.stats must contain ${String(STAT_COUNT)} rows; got ${String(catalog.stats.length)}`,
    );
  }
  const stats = [...catalog.stats].sort((left, right) => left.order - right.order);
  const seen = new Set<StatCode>();
  for (const [index, stat] of stats.entries()) {
    const expectedOrder = index + 1;
    if (stat.order !== expectedOrder) {
      fail(
        `catalog.stats order must be consecutive 1..${String(STAT_COUNT)}; ` +
          `${stat.statCode} has order ${String(stat.order)}, expected ${String(expectedOrder)}`,
      );
    }
    if (seen.has(stat.statCode)) fail(`catalog.stats contains duplicate StatCode ${stat.statCode}`);
    seen.add(stat.statCode);
  }
  return stats;
}

function requireAssignedStats(
  stats: readonly StatDefinition[],
  value: unknown,
): Record<StatCode, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`assignedStats must be an object with the exact StatCode keys; received ${show(value)}`);
  }
  const row = value as Record<string, unknown>;
  const expected = stats.map(({ statCode }) => statCode);
  const expectedSet = new Set<string>(expected);
  const actualKeys = Object.keys(row);
  const actualSet = new Set(actualKeys);
  const missing = expected.filter((key) => !actualSet.has(key));
  const extra = actualKeys.filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `assignedStats keys must exactly match StatCode; missing: ${missing.join(', ') || 'none'}; ` +
        `unexpected: ${extra.join(', ') || 'none'}`,
    );
  }

  const result = {} as Record<StatCode, number>;
  for (const stat of stats) {
    const assigned = row[stat.statCode];
    if (typeof assigned !== 'number' || !Number.isFinite(assigned)) {
      fail(`assignedStats.${stat.statCode} must be finite; received ${show(assigned)}`);
    }
    if (!Number.isSafeInteger(assigned)) {
      fail(`assignedStats.${stat.statCode} must be a safe integer; received ${show(assigned)}`);
    }
    result[stat.statCode] = assigned;
  }
  return result;
}

function requireAcceptedValues(value: unknown): readonly number[] {
  if (!Array.isArray(value))
    fail(`acceptedValues must be an array of ${String(STAT_COUNT)} values`);
  if (value.length !== STAT_COUNT) {
    fail(`acceptedValues must contain ${String(STAT_COUNT)} values; got ${String(value.length)}`);
  }
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      fail(`acceptedValues[${String(index)}] must be finite; received ${show(entry)}`);
    }
    if (!Number.isSafeInteger(entry)) {
      fail(`acceptedValues[${String(index)}] must be a safe integer; received ${show(entry)}`);
    }
  }
  return value as readonly number[];
}

function requireRolledBijection(
  stats: readonly StatDefinition[],
  assignedStats: Readonly<Record<StatCode, number>>,
  acceptedValue: unknown,
): void {
  const accepted = [...requireAcceptedValues(acceptedValue)].sort((left, right) => left - right);
  const assigned = stats
    .map(({ statCode }) => assignedStats[statCode])
    .sort((left, right) => left - right);
  if (!assigned.every((value, index) => value === accepted[index])) {
    fail(
      `ROLLED_BIJECTION must preserve the accepted multiset exactly; ` +
        `accepted: ${JSON.stringify(accepted)}; assigned: ${JSON.stringify(assigned)} ` +
        `(${ROLLED_BIJECTION_RULE_IDS.join('/')})`,
    );
  }
}

function requirePointBuy(
  mode: PointBuyMode,
  stats: readonly StatDefinition[],
  assignedStats: Readonly<Record<StatCode, number>>,
): void {
  const contract = POINT_BUY_CONTRACTS[mode];
  for (const stat of stats) {
    if (stat.baseMin !== POINT_BUY_RANGE.minimum || stat.baseMax !== POINT_BUY_RANGE.maximum) {
      fail(
        `catalog.stats.${stat.statCode} point-buy range must remain ` +
          `${String(POINT_BUY_RANGE.minimum)}..${String(POINT_BUY_RANGE.maximum)}; ` +
          `received ${String(stat.baseMin)}..${String(stat.baseMax)} (${contract.ruleId})`,
      );
    }
    const value = assignedStats[stat.statCode];
    if (value < stat.baseMin || value > stat.baseMax) {
      fail(
        `${mode} assignedStats.${stat.statCode}=${String(value)} is outside point-buy range ` +
          `${String(stat.baseMin)}..${String(stat.baseMax)} (${contract.ruleId})`,
      );
    }
  }
  const actualTotal = stats.reduce((total, { statCode }) => total + assignedStats[statCode], 0);
  if (actualTotal !== contract.requiredTotal) {
    fail(
      `${mode} actual total ${String(actualTotal)}; required ${String(contract.requiredTotal)} ` +
        `(${contract.ruleId})`,
    );
  }
}

export function assignBaseStats(
  catalog: StatAssignmentCatalog,
  input: StatAssignmentInput,
): StatBlock {
  requireAssignmentMode(input.assignmentMode);
  const stats = orderedStats(catalog);
  const assignedStats = requireAssignedStats(stats, input.assignedStats);
  if (input.assignmentMode === 'ROLLED_BIJECTION') {
    requireRolledBijection(stats, assignedStats, input.acceptedValues);
  } else {
    requirePointBuy(input.assignmentMode, stats, assignedStats);
  }
  return Object.freeze(assignedStats);
}
