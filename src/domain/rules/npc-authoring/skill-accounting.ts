import type { SkillKey, SkillStageCatalog } from '../skill-stage/catalog.js';
import { calculateSkillSlotCost } from '../skill-stage/skills.js';
import type { NpcGrossGrant, NpcLearnedSkill, NpcSkillCharge } from './types.js';

interface FactIdentity {
  readonly factId: string;
  readonly ordinal: number;
  readonly contextFactId: string;
}

/** References identify exact leaf facts, not client assertions or a new editable biography. */
export type NpcSkillAccountingFact =
  | (FactIdentity &
      Readonly<{
        kind: 'PAID_ACQUISITION';
        skillKey: SkillKey;
        bonusBefore: number;
        bonusAfter: number;
        pool: 'START' | 'TRAINING';
        chargedSlotCost: number;
      }>)
  | (FactIdentity &
      Readonly<{
        kind: 'TROGR_GROSS_GRANT';
        sourceRuleId: 'SYM-079';
        symbiontAcquisitionFactId: string;
        bonusBefore: number;
        bonusAfter: number;
      }>)
  | (FactIdentity &
      Readonly<{
        kind: 'PERMANENT_REQUIREMENT_LOSS';
        sourceRuleId: 'CORE-166';
        skillKey: SkillKey;
      }>);

export interface NpcSkillAccounting {
  readonly learnedSkills: readonly NpcLearnedSkill[];
  readonly grossGrant: NpcGrossGrant;
  readonly usedSlots: Readonly<Record<'START' | 'TRAINING', number>>;
}

export class NpcSkillAccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

function fail(detail: string): never {
  throw new NpcSkillAccountingError(`NPC skill accounting: ${detail}`);
}

function exact(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(`${label}: expected plain data object`);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    fail(`${label}: fields must be exact`);
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
      fail(`${label}.${key}: expected enumerable own data field`);
    result[key] = d.value as unknown;
  }
  return result;
}

function factsArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    fail('facts: expected plain data array');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0)
    fail('facts: invalid length');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) fail('facts: extra fields or sparse entries');
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const d = Object.getOwnPropertyDescriptor(value, String(index));
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
      fail('facts: indices must be enumerable own data fields');
    values.push(d.value as unknown);
  }
  return values;
}

function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value)
    fail(`${field}: expected exact nonempty reference`);
  return value;
}

function integer(value: unknown, minimum: number, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    fail(`${field}: expected safe integer >= ${String(minimum)}`);
  return value;
}

function skill(catalog: SkillStageCatalog, value: unknown): SkillKey {
  const key = id(value, 'skillKey');
  const found = catalog.skills.find((row) => row.skillKey === key);
  if (
    found === undefined ||
    found.category !== 'SELECTABLE_GENERAL' ||
    found.slotCostMode !== 'BONUS_LEVEL_FORMULA_CORE-165'
  )
    fail(`skillKey ${JSON.stringify(key)}: expected selectable general skill`);
  return found.skillKey;
}

const COMMON = ['kind', 'factId', 'ordinal', 'contextFactId'] as const;
const PAID = [...COMMON, 'skillKey', 'bonusBefore', 'bonusAfter', 'pool', 'chargedSlotCost'];
const GRANT = [...COMMON, 'sourceRuleId', 'symbiontAcquisitionFactId', 'bonusBefore', 'bonusAfter'];
const LOSS = [...COMMON, 'sourceRuleId', 'skillKey'];

/**
 * Arithmetic fold of a complete ordered leaf-fact history (technical ordinals 1..N).
 * Caller must prove catalog/identity/prefix and every referenced mechanical context:
 * requirements, affordability, START/TRAINING basis and actual SYM-079 acquisition.
 * This function cannot authenticate references, replace those checks, or validate a full ledger.
 */
export function foldNpcSkillChargeFacts(
  catalog: SkillStageCatalog,
  orderedFacts: unknown,
): NpcSkillAccounting {
  const learned = new Map<SkillKey, NpcLearnedSkill>();
  const seen = new Set<string>();
  const used = { START: 0, TRAINING: 0 };
  let grossGrant: NpcGrossGrant = Object.freeze({ kind: 'NOT_ISSUED' });
  const facts = factsArray(orderedFacts);
  for (const [index, candidate] of facts.entries()) {
    const descriptor =
      candidate !== null && typeof candidate === 'object'
        ? Object.getOwnPropertyDescriptor(candidate, 'kind')
        : undefined;
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value'))
      fail('fact.kind: expected own data field');
    const kind: unknown = descriptor.value;
    const fields =
      kind === 'PAID_ACQUISITION'
        ? PAID
        : kind === 'TROGR_GROSS_GRANT'
          ? GRANT
          : kind === 'PERMANENT_REQUIREMENT_LOSS'
            ? LOSS
            : null;
    if (fields === null) fail('unknown skill fact kind');
    const fact = exact(candidate, fields, `fact ${String(index + 1)}`);
    const factId = id(fact['factId'], 'factId');
    id(fact['contextFactId'], 'contextFactId');
    if (seen.has(factId)) fail('duplicate factId');
    if (integer(fact['ordinal'], 1, 'ordinal') !== index + 1)
      fail('facts must have consecutive ordinals 1..N');
    seen.add(factId);
    const key = skill(catalog, kind === 'TROGR_GROSS_GRANT' ? 'GROSS' : fact['skillKey']);
    const previous = learned.get(key);

    if (kind === 'PERMANENT_REQUIREMENT_LOSS') {
      if (fact['sourceRuleId'] !== 'CORE-166') fail('permanent loss requires CORE-166');
      if (previous === undefined) fail('cannot lose an absent skill');
      for (const charge of previous.charges) used[charge.pool] -= charge.chargedSlotCost;
      learned.delete(key);
      continue;
    }

    const before = integer(fact['bonusBefore'], 0, 'bonusBefore');
    const after = integer(fact['bonusAfter'], 1, 'bonusAfter');
    if (before !== (previous?.bonus ?? 0))
      fail('bonusBefore differs from the current folded skill');
    if (kind === 'TROGR_GROSS_GRANT') {
      if (fact['sourceRuleId'] !== 'SYM-079') fail('GROSS grant requires SYM-079');
      id(fact['symbiontAcquisitionFactId'], 'symbiontAcquisitionFactId');
      if (grossGrant.kind !== 'NOT_ISSUED') fail('SYM-079 lifetime grant already issued (SYM-185)');
      // SYM-079: absent -> high(+3); otherwise +3 up to absolute(+5), never lower an existing >5.
      const expected = before === 0 ? 3 : before >= 5 ? before : Math.min(5, before + 3);
      if (after !== expected) fail('GROSS grant endpoints differ from SYM-079');
      grossGrant = Object.freeze({
        kind: 'ISSUED',
        sourceRuleId: 'SYM-079',
        bonusBefore: before,
        bonusAfter: after,
        acquisitionFactId: factId,
      });
      learned.set(
        key,
        Object.freeze({
          skillKey: key,
          bonus: after,
          charges: previous?.charges ?? Object.freeze([]),
        }),
      );
      continue;
    }

    if (after <= before) fail('paid acquisition must increase the current bonus');
    const pool = fact['pool'];
    if (pool !== 'START' && pool !== 'TRAINING') fail('unknown skill slot pool');
    const cost = integer(fact['chargedSlotCost'], 1, 'chargedSlotCost');
    // Zero denotes proven absence; the existing CORE-165 positive-cost primitive never receives 0.
    const expected =
      calculateSkillSlotCost(after) - (before === 0 ? 0 : calculateSkillSlotCost(before));
    if (cost !== expected) fail('chargedSlotCost differs from CORE-165 cost difference');
    const total = used[pool] + cost;
    if (!Number.isSafeInteger(total)) fail('occupied pool cost overflows safe integer');
    used[pool] = total;
    // paidBonus is this referenced event's target bonus, not a separately purchased increment.
    const charge: NpcSkillCharge = Object.freeze({
      pool,
      paidBonus: after,
      chargedSlotCost: cost,
      acquisitionFactId: factId,
    });
    learned.set(
      key,
      Object.freeze({
        skillKey: key,
        bonus: after,
        charges: Object.freeze([...(previous?.charges ?? []), charge]),
      }),
    );
  }
  return Object.freeze({
    learnedSkills: Object.freeze([...learned.values()]),
    grossGrant,
    usedSlots: Object.freeze(used),
  });
}
