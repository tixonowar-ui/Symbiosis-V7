import type { ClassCode, RaceCode, StatCode } from '@generated/types/character.js';
import type { SkillKey, SkillStageCatalog } from '../skill-stage/catalog.js';
import {
  calculateStartSkillSlots,
  validateSkillRequirements,
  validateSkillSelectionDraft,
} from '../skill-stage/skills.js';
import type { StatBlock } from '../skill-stage/stats.js';
import { foldNpcSkillChargeFacts } from './skill-accounting.js';
import type { NpcSkillAccountingFact } from './skill-accounting.js';
import type { NpcFixedSkill, NpcGrossGrant, NpcSkillLedger } from './types.js';

/** Host-confirmed consequences only; a preview or a client-supplied historical peak is not a context. */
export interface NpcSkillContext {
  readonly contextFactId: string;
  readonly ordinal: number;
  readonly stage: 'START_SELECTION' | 'CONFIRMED';
  readonly raceCode: RaceCode;
  readonly classCode: ClassCode | null;
  readonly skillStageStats: StatBlock;
  readonly permanentStats: StatBlock;
  readonly effectiveStats: StatBlock;
  readonly grossGrantSourceOrNull: Readonly<{
    sourceRuleId: 'SYM-079';
    symbiontInstanceId: string;
    sourceAcquisitionFactId: string;
  }> | null;
  readonly facts: readonly NpcSkillAccountingFact[];
}

export interface NpcSkillProof {
  readonly identityKey: string;
  readonly contexts: readonly NpcSkillContext[];
}

export interface NpcSkillEvaluation {
  readonly proof: NpcSkillProof;
  readonly ledger: NpcSkillLedger;
  readonly grossGrant: NpcGrossGrant;
  readonly disabledSkillKeys: readonly SkillKey[];
  readonly pools: Readonly<
    Record<
      'START' | 'TRAINING',
      Readonly<{
        capacity: number;
        used: number;
        available: number;
        overfill: number;
      }>
    >
  >;
}

export class NpcSkillEvaluationError extends Error {
  constructor(message: string) {
    super(`NPC skill evaluation: ${message}`);
    this.name = new.target.name;
  }
}
function fail(message: string): never {
  throw new NpcSkillEvaluationError(message);
}
const STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(`${label}: expected plain record`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((k) => typeof k !== 'string' || !keys.includes(k))
  )
    fail(`${label}: unexpected or missing fields`);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
      fail(`${label}.${key}: expected own data`);
    out[key] = d.value as unknown;
  }
  return out;
}
function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    fail(`${label}: expected plain array`);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    Reflect.ownKeys(value).length !== length + 1
  )
    fail(`${label}: sparse or extended array`);
  return Array.from({ length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
      fail(`${label}: expected own data index`);
    return d.value as unknown;
  });
}
function ref(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value)
    fail(`${label}: invalid reference`);
  return value;
}
function integer(value: unknown, label: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    fail(`${label}: invalid safe integer`);
  return value;
}
function stats(value: unknown, label: string, minimum: number): StatBlock {
  const row = record(value, STATS, label);
  return Object.freeze(
    Object.fromEntries(STATS.map((k) => [k, integer(row[k], `${label}.${k}`, minimum)])) as Record<
      StatCode,
      number
    >,
  );
}

/** Copy only the flat, closed accounting fact shape; the accounting fold validates its semantics. */
function fact(value: unknown): NpcSkillAccountingFact {
  const d =
    value !== null && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, 'kind')
      : undefined;
  const kind: unknown = d !== undefined && Object.hasOwn(d, 'value') ? d.value : undefined;
  const common = ['kind', 'factId', 'ordinal', 'contextFactId'];
  const extra =
    kind === 'PAID_ACQUISITION'
      ? ['skillKey', 'bonusBefore', 'bonusAfter', 'pool', 'chargedSlotCost']
      : kind === 'TROGR_GROSS_GRANT'
        ? ['sourceRuleId', 'symbiontAcquisitionFactId', 'bonusBefore', 'bonusAfter']
        : kind === 'PERMANENT_REQUIREMENT_LOSS'
          ? ['sourceRuleId', 'skillKey']
          : null;
  if (extra === null) fail('unrecognized accounting fact kind');
  const row = record(value, [...common, ...extra], 'fact');
  if (Object.values(row).some((v) => typeof v !== 'string' && typeof v !== 'number'))
    fail('fact: expected scalar fields');
  return Object.freeze(row) as unknown as NpcSkillAccountingFact;
}

function readProof(catalog: SkillStageCatalog, value: unknown): NpcSkillProof {
  const row = record(value, ['identityKey', 'contexts'], 'proof');
  const seen = new Set<string>();
  const contexts = array(row['contexts'], 'contexts').map((raw, i): NpcSkillContext => {
    const c = record(
      raw,
      [
        'contextFactId',
        'ordinal',
        'stage',
        'raceCode',
        'classCode',
        'skillStageStats',
        'permanentStats',
        'effectiveStats',
        'grossGrantSourceOrNull',
        'facts',
      ],
      'context',
    );
    const contextFactId = ref(c['contextFactId'], 'contextFactId');
    if (seen.has(contextFactId)) fail('duplicate contextFactId');
    seen.add(contextFactId);
    if (integer(c['ordinal'], 'context.ordinal', 1) !== i + 1)
      fail('context ordinals must be consecutive');
    if (c['stage'] !== (i === 0 ? 'START_SELECTION' : 'CONFIRMED'))
      fail('exactly the first context must confirm START_SELECTION');
    const race = catalog.races.find((r) => r.raceCode === c['raceCode']);
    if (race === undefined) fail('unknown context race');
    const cl =
      c['classCode'] === null ? null : catalog.classes.find((r) => r.classCode === c['classCode']);
    if (
      cl === undefined ||
      (race.classPolicy === 'REQUIRED_PURE_CLASS'
        ? cl === null || cl.raceCode !== race.raceCode
        : cl !== null)
    )
      fail('invalid context class policy');
    let source: NpcSkillContext['grossGrantSourceOrNull'] = null;
    if (c['grossGrantSourceOrNull'] !== null) {
      const g = record(
        c['grossGrantSourceOrNull'],
        ['sourceRuleId', 'symbiontInstanceId', 'sourceAcquisitionFactId'],
        'grossGrantSource',
      );
      if (g['sourceRuleId'] !== 'SYM-079') fail('gross source must be SYM-079');
      source = Object.freeze({
        sourceRuleId: 'SYM-079',
        symbiontInstanceId: ref(g['symbiontInstanceId'], 'symbiontInstanceId'),
        sourceAcquisitionFactId: ref(g['sourceAcquisitionFactId'], 'gross sourceAcquisitionFactId'),
      });
    }
    const facts = array(c['facts'], 'context.facts').map(fact);
    if (facts.some((f) => f.contextFactId !== contextFactId))
      fail('fact belongs to a different context');
    return Object.freeze({
      contextFactId,
      ordinal: i + 1,
      stage: i === 0 ? 'START_SELECTION' : 'CONFIRMED',
      raceCode: race.raceCode,
      classCode: cl?.classCode ?? null,
      skillStageStats: stats(c['skillStageStats'], 'skillStageStats', Number.MIN_SAFE_INTEGER),
      permanentStats: stats(c['permanentStats'], 'permanentStats', 1),
      effectiveStats: stats(c['effectiveStats'], 'effectiveStats', 1),
      grossGrantSourceOrNull: source,
      facts: Object.freeze(facts),
    });
  });
  if (contexts.length === 0) fail('confirmed start basis is required');
  return Object.freeze({
    identityKey: ref(row['identityKey'], 'identityKey'),
    contexts: Object.freeze(contexts),
  });
}

/** Character/03_Классы Rule IDs: each class owns exactly its named passive. */
const CLASS_RULE = { SEEKER: 'CORE-009', STALKER: 'CORE-010', SOLDIER: 'CORE-013' } as const;
function fixed(catalog: SkillStageCatalog, c: NpcSkillContext): readonly NpcFixedSkill[] {
  // Existing source catalog resolves all fixed bonuses and the mandatory class reservation.
  const result = validateSkillSelectionDraft(catalog, {
    raceCode: c.raceCode,
    classCode: c.classCode,
    skillStageStats: c.skillStageStats,
    selectedSkills: [],
  });
  return Object.freeze(
    result.learnedSkills.map((s) => {
      if (s.source === 'SELECTED') return fail('unexpected selected skill in fixed catalog result');
      return Object.freeze({
        ...s,
        source: s.source,
        sourceRuleIds: Object.freeze(
          s.source === 'RACE_GRANTED'
            ? ['CORE-004']
            : ['CORE-008', CLASS_RULE[c.classCode ?? fail('missing class source')]],
        ),
      });
    }),
  );
}
function meets(catalog: SkillStageCatalog, key: SkillKey, values: StatBlock): boolean {
  return catalog.requirements
    .filter((r) => r.skillKey === key)
    .every((r) => values[r.statCode] >= r.minValue);
}
function capacity(
  initial: number,
  issued: number,
  effectiveStats: StatBlock,
): { START: number; TRAINING: number } {
  // CORE-081 forbids extra START issuance; Q-CORE-051 separately permits current overfill.
  return {
    START: Math.min(initial, calculateStartSkillSlots(effectiveStats)),
    TRAINING: Math.min(issued, Math.floor(effectiveStats.W / 2)),
  };
}

function evaluate(catalog: SkillStageCatalog, proof: NpcSkillProof): NpcSkillEvaluation {
  const first = proof.contexts[0];
  if (first === undefined) return fail('missing start context');
  const accounting = foldNpcSkillChargeFacts(
    catalog,
    proof.contexts.flatMap((c) => c.facts),
  );
  const initial = calculateStartSkillSlots(first.skillStageStats);
  const active = new Map<SkillKey, { START: number; TRAINING: number }>();
  const used = { START: 0, TRAINING: 0 };
  let maxWisdom = 0,
    issued = 0,
    grossIssued = false;
  let basisFactId = first.contextFactId;
  let fixedSkills: readonly NpcFixedSkill[] = [];
  let capacities = { START: initial, TRAINING: 0 };
  for (const context of proof.contexts) {
    fixedSkills = fixed(catalog, context);
    const fixedCost = fixedSkills.reduce((sum, s) => sum + s.slotCost, 0);
    if (context.permanentStats.W > maxWisdom) {
      maxWisdom = context.permanentStats.W;
      basisFactId = context.contextFactId;
    }
    issued = Math.max(issued, Math.floor(context.permanentStats.W / 2));
    capacities = capacity(initial, issued, context.effectiveStats);
    // The initial reservation uses its pre-symbiont basis. Later capacity is a separate current value.
    const spendingCapacity =
      context.stage === 'START_SELECTION' ? { START: initial, TRAINING: 0 } : capacities;
    const pendingLoss = new Set(
      [...active.keys()].filter((key) => !meets(catalog, key, context.permanentStats)),
    );
    for (const f of context.facts) {
      if (f.kind === 'PERMANENT_REQUIREMENT_LOSS') {
        if (!pendingLoss.has(f.skillKey))
          fail('permanent loss lacks a failed permanent requirement');
        const costs = active.get(f.skillKey);
        if (costs === undefined) return fail('missing active skill for permanent loss');
        used.START -= costs.START;
        used.TRAINING -= costs.TRAINING;
        active.delete(f.skillKey);
        pendingLoss.delete(f.skillKey);
        continue;
      }
      if (pendingLoss.size !== 0)
        fail('permanent losses must be applied before further acquisitions');
      if (f.kind === 'TROGR_GROSS_GRANT') {
        if (context.grossGrantSourceOrNull?.sourceAcquisitionFactId !== f.symbiontAcquisitionFactId)
          fail('grant has no matching confirmed SYM-079 acquisition');
        const key = catalog.skills.find((s) => s.skillKey === 'GROSS')?.skillKey;
        if (key === undefined) return fail('missing source GROSS skill');
        if (!active.has(key)) active.set(key, { START: 0, TRAINING: 0 });
        if (!meets(catalog, key, context.permanentStats)) pendingLoss.add(key);
        grossIssued = true;
        continue;
      }
      validateSkillRequirements(catalog, f.skillKey, context.skillStageStats);
      if (!meets(catalog, f.skillKey, context.permanentStats))
        fail('new skill has an unmet permanent requirement');
      const reserved = f.pool === 'START' ? fixedCost : 0;
      if (used[f.pool] + reserved + f.chargedSlotCost > spendingCapacity[f.pool])
        fail('insufficient current capacity in the original pool');
      const costs = active.get(f.skillKey) ?? { START: 0, TRAINING: 0 };
      costs[f.pool] += f.chargedSlotCost;
      used[f.pool] += f.chargedSlotCost;
      active.set(f.skillKey, costs);
    }
    if (pendingLoss.size !== 0) fail('missing permanent requirement loss consequence');
    if (context.grossGrantSourceOrNull !== null && !grossIssued)
      fail('missing first SYM-079 grant consequence');
    if (context.stage === 'START_SELECTION' && used.START + fixedCost !== initial)
      fail('CREATE_V1 must fill every initial START slot');
  }
  const current = proof.contexts[proof.contexts.length - 1];
  if (current === undefined) return fail('missing current context');
  if (used.START !== accounting.usedSlots.START || used.TRAINING !== accounting.usedSlots.TRAINING)
    fail('accounting and context folds diverged');
  const pool = (name: 'START' | 'TRAINING') => {
    const count =
      used[name] + (name === 'START' ? fixedSkills.reduce((sum, s) => sum + s.slotCost, 0) : 0);
    return Object.freeze({
      capacity: capacities[name],
      used: count,
      available: Math.max(0, capacities[name] - count),
      overfill: Math.max(0, count - capacities[name]),
    });
  };
  return Object.freeze({
    proof,
    ledger: Object.freeze({
      startBasis: Object.freeze({
        skillStageStats: first.skillStageStats,
        confirmationFactId: first.contextFactId,
      }),
      training: Object.freeze({ maxPermanentWisdom: maxWisdom, everIssued: issued, basisFactId }),
      learnedSkills: accounting.learnedSkills,
      fixedSkills,
    }),
    grossGrant: accounting.grossGrant,
    disabledSkillKeys: Object.freeze(
      accounting.learnedSkills
        .filter((s) => !meets(catalog, s.skillKey, current.effectiveStats))
        .map((s) => s.skillKey),
    ),
    pools: Object.freeze({ START: pool('START'), TRAINING: pool('TRAINING') }),
  });
}

/**
 * The host must resolve the complete same-identity closure and prove each context's actual
 * stat derivation, confirmation, composition acquisition and order. These are data references,
 * not an authorization callback or a client-editable history. No XP, duration or past peak is invented.
 * APPEND revalidates the old prefix; matching bytes alone are not a domain-validation shortcut.
 */
export function evaluateNpcSkills(
  catalog: SkillStageCatalog,
  input: {
    readonly mode: 'CREATE_V1' | 'APPEND_N_PLUS_ONE';
    readonly identityKey: string;
    readonly previousConfirmedProofOrNull: unknown;
    readonly proof: unknown;
  },
): NpcSkillEvaluation {
  const row = record(
    input,
    ['mode', 'identityKey', 'previousConfirmedProofOrNull', 'proof'],
    'input',
  );
  const identity = ref(row['identityKey'], 'identityKey');
  const proof = readProof(catalog, row['proof']);
  if (proof.identityKey !== identity) fail('proof belongs to another identity');
  if (row['mode'] === 'CREATE_V1') {
    if (row['previousConfirmedProofOrNull'] !== null)
      fail('CREATE_V1 cannot replace an existing proof');
  } else if (row['mode'] === 'APPEND_N_PLUS_ONE') {
    const previous = readProof(catalog, row['previousConfirmedProofOrNull']);
    if (previous.identityKey !== identity) fail('previous proof belongs to another identity');
    evaluate(catalog, previous);
    if (
      proof.contexts.length < previous.contexts.length ||
      previous.contexts.some((c, i) => JSON.stringify(c) !== JSON.stringify(proof.contexts[i]))
    )
      fail('immutable confirmed prefix changed');
  } else fail('unrecognized NPC skill evaluation mode');
  return evaluate(catalog, proof);
}

/**
 * CORE-166/Q-CORE-051: current temporary penalties change availability, not the confirmed
 * acquisition history or its original charges. The owning sheet reader must derive these final
 * stats from the actual effects and prove the supplied history; a preview is not a new context.
 */
export function evaluateNpcCurrentSkillAvailability(
  catalog: SkillStageCatalog,
  input: {
    readonly identityKey: string;
    readonly proof: unknown;
    readonly effectiveStats: unknown;
  },
): Pick<NpcSkillEvaluation, 'disabledSkillKeys' | 'pools'> {
  const row = record(input, ['identityKey', 'proof', 'effectiveStats'], 'current input');
  const identity = ref(row['identityKey'], 'identityKey');
  const proof = readProof(catalog, row['proof']);
  if (proof.identityKey !== identity) fail('proof belongs to another identity');
  const currentStats = stats(row['effectiveStats'], 'current effectiveStats', 1);
  const evaluated = evaluate(catalog, proof);
  const capacities = capacity(
    calculateStartSkillSlots(evaluated.ledger.startBasis.skillStageStats),
    evaluated.ledger.training.everIssued,
    currentStats,
  );
  const pool = (name: 'START' | 'TRAINING') => {
    const used = evaluated.pools[name].used;
    return Object.freeze({
      capacity: capacities[name],
      used,
      available: Math.max(0, capacities[name] - used),
      overfill: Math.max(0, used - capacities[name]),
    });
  };
  return Object.freeze({
    disabledSkillKeys: Object.freeze(
      evaluated.ledger.learnedSkills
        .filter((skill) => !meets(catalog, skill.skillKey, currentStats))
        .map((skill) => skill.skillKey),
    ),
    pools: Object.freeze({ START: pool('START'), TRAINING: pool('TRAINING') }),
  });
}

/** Compare an untrusted snapshot with the derived closed shape, including exact charges/fixed sources. */
export function assertNpcSkillSnapshot(
  result: NpcSkillEvaluation,
  ledger: unknown,
  grossGrant: unknown,
): void {
  function equal(expected: unknown, actual: unknown, label: string): void {
    if (Array.isArray(expected)) {
      const values = array(actual, label);
      if (values.length !== expected.length) fail(`${label}: different array length`);
      expected.forEach((v, i) => equal(v, values[i], `${label}[${String(i)}]`));
    } else if (expected !== null && typeof expected === 'object') {
      const values = record(actual, Object.keys(expected), label);
      for (const [key, v] of Object.entries(expected)) equal(v, values[key], `${label}.${key}`);
    } else if (!Object.is(expected, actual)) fail(`${label}: differs from derived source state`);
  }
  equal(result.ledger, ledger, 'ledger');
  equal(result.grossGrant, grossGrant, 'grossGrant');
}
