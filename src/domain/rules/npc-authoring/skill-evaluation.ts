import type { ClassCode, RaceCode, StatCode } from '@generated/types/character.js';
import type { SkillKey, SkillStageCatalog } from '../skill-stage/catalog.js';
import {
  calculateStartSkillSlots,
  calculateSkillSlotCost,
  validateSkillRequirements,
  validateSkillSelectionDraft,
} from '../skill-stage/skills.js';
import type { StatBlock } from '../skill-stage/stats.js';
import { foldNpcSkillChargeFacts, readNpcSkillAccountingFact } from './skill-accounting.js';
import type { NpcSkillAccountingFact } from './skill-accounting.js';
import type { NpcFixedSkill, NpcGrossGrant, NpcSkillLedger } from './types.js';

/** Host-confirmed consequences only; a preview or a client-supplied historical peak is not a context. */
export interface NpcSkillContext {
  readonly contextFactId: string;
  readonly ordinal: number;
  readonly stage: 'COMPOSITION_BEFORE_START' | 'START_SELECTION' | 'CONFIRMED';
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
  /** Omitted only by the exact older grammar; actual composition proves this current source. */
  readonly sym166SourceOrNull?: Readonly<{ symbiontInstanceId: string; nodeRef: 'SYM-166' }> | null;
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
    Record<'START' | 'TRAINING', NpcSkillPoolMetrics> &
      Partial<Record<'SYM-166', NpcSkillPoolMetrics>>
  >;
}
export interface NpcSkillPoolMetrics {
  readonly capacity: number;
  readonly used: number;
  readonly available: number;
  readonly overfill: number;
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

/** Structural storage reader; catalog policy, costs and requirements are still proved by evaluateNpcSkills. */
export function readNpcSkillProof(value: unknown): NpcSkillProof {
  const row = record(value, ['identityKey', 'contexts'], 'proof');
  const seen = new Set<string>();
  let sym166GrammarSeen = false;
  let startSeen = false;
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
        ...(raw !== null && typeof raw === 'object' && Object.hasOwn(raw, 'sym166SourceOrNull')
          ? ['sym166SourceOrNull']
          : []),
      ],
      'context',
    );
    const contextFactId = ref(c['contextFactId'], 'contextFactId');
    if (seen.has(contextFactId)) fail('duplicate contextFactId');
    seen.add(contextFactId);
    if (integer(c['ordinal'], 'context.ordinal', 1) !== i + 1)
      fail('context ordinals must be consecutive');
    const stage = c['stage'];
    if (stage === 'COMPOSITION_BEFORE_START') {
      if (startSeen) fail('composition-before-START cannot follow the actual START');
    } else if (stage === 'START_SELECTION') {
      if (startSeen) fail('exactly one context must confirm START_SELECTION');
      startSeen = true;
    } else if (stage !== 'CONFIRMED' || !startSeen)
      fail('confirmed skill context requires an actual preceding START_SELECTION');
    const raceCode = c['raceCode'],
      classCode = c['classCode'];
    if (raceCode !== 'PURE' && raceCode !== 'FREE' && raceCode !== 'UNITED')
      fail('unknown context race');
    if (
      classCode !== null &&
      classCode !== 'SEEKER' &&
      classCode !== 'STALKER' &&
      classCode !== 'SOLDIER'
    )
      fail('unknown context class');
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
    const facts = array(c['facts'], 'context.facts').map(readNpcSkillAccountingFact);
    if (facts.some((f) => f.contextFactId !== contextFactId))
      fail('fact belongs to a different context');
    if (
      stage === 'COMPOSITION_BEFORE_START' &&
      (facts.length === 0 || facts.some((f) => f.kind === 'PAID_ACQUISITION'))
    )
      fail('pre-START context must contain actual source grant/loss and no paid acquisition');
    let sym166: Pick<NpcSkillContext, 'sym166SourceOrNull'> = {};
    if (sym166GrammarSeen && !Object.hasOwn(c, 'sym166SourceOrNull'))
      fail('confirmed SYM-166 history requires explicit current source or absence');
    if (Object.hasOwn(c, 'sym166SourceOrNull')) {
      sym166GrammarSeen = true;
      const value = c['sym166SourceOrNull'];
      if (value === null) sym166 = { sym166SourceOrNull: null };
      else {
        const source = record(value, ['symbiontInstanceId', 'nodeRef'], 'SYM-166 source');
        if (source['nodeRef'] !== 'SYM-166') fail('unknown SYM-166 source node');
        sym166 = {
          sym166SourceOrNull: Object.freeze({
            symbiontInstanceId: ref(source['symbiontInstanceId'], 'SYM-166 instance'),
            nodeRef: 'SYM-166',
          }),
        };
      }
    }
    return Object.freeze({
      contextFactId,
      ordinal: i + 1,
      stage,
      raceCode,
      classCode,
      skillStageStats: stats(c['skillStageStats'], 'skillStageStats', Number.MIN_SAFE_INTEGER),
      permanentStats: stats(c['permanentStats'], 'permanentStats', 1),
      effectiveStats: stats(c['effectiveStats'], 'effectiveStats', 1),
      grossGrantSourceOrNull: source,
      ...sym166,
      facts: Object.freeze(facts),
    });
  });
  if (contexts.length === 0 || !startSeen) fail('confirmed start basis is required');
  return Object.freeze({
    identityKey: ref(row['identityKey'], 'identityKey'),
    contexts: Object.freeze(contexts),
  });
}

function readProof(catalog: SkillStageCatalog, value: unknown): NpcSkillProof {
  const proof = readNpcSkillProof(value);
  for (const c of proof.contexts) {
    const race = catalog.races.find((r) => r.raceCode === c.raceCode);
    if (race === undefined) fail('unknown context race');
    const cl =
      c.classCode === null ? null : catalog.classes.find((r) => r.classCode === c.classCode);
    if (
      cl === undefined ||
      (race.classPolicy === 'REQUIRED_PURE_CLASS'
        ? cl === null || cl.raceCode !== race.raceCode
        : cl !== null)
    )
      fail('invalid context class policy');
  }
  return proof;
}

/** Character/03_Классы Rule IDs: each class owns exactly its named passive. */
const CLASS_RULE = { SEEKER: 'CORE-009', STALKER: 'CORE-010', SOLDIER: 'CORE-013' } as const;
function fixed(
  catalog: SkillStageCatalog,
  c: Pick<NpcSkillContext, 'raceCode' | 'classCode' | 'skillStageStats'>,
): readonly NpcFixedSkill[] {
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
  const first = proof.contexts.find((c) => c.stage === 'START_SELECTION');
  if (first === undefined) return fail('missing start context');
  const accounting = foldNpcSkillChargeFacts(
    catalog,
    proof.contexts.flatMap((c) => c.facts),
  );
  const initial = calculateStartSkillSlots(first.skillStageStats);
  const active = new Map<SkillKey, { START: number; TRAINING: number; 'SYM-166': number }>();
  const used = { START: 0, TRAINING: 0, 'SYM-166': 0 };
  const hasSym166 = proof.contexts.some((c) => Object.hasOwn(c, 'sym166SourceOrNull'));
  let maxWisdom = 0,
    issued = 0,
    grossIssued = false;
  let basisFactId = first.contextFactId;
  let fixedSkills: readonly NpcFixedSkill[] = [];
  let capacities = { START: initial, TRAINING: 0, 'SYM-166': 0 };
  for (const context of proof.contexts) {
    fixedSkills = fixed(catalog, context);
    const fixedCost = fixedSkills.reduce((sum, s) => sum + s.slotCost, 0);
    if (context.stage !== 'COMPOSITION_BEFORE_START' && context.permanentStats.W > maxWisdom) {
      maxWisdom = context.permanentStats.W;
      basisFactId = context.contextFactId;
    }
    if (context.stage !== 'COMPOSITION_BEFORE_START')
      issued = Math.max(issued, Math.floor(context.permanentStats.W / 2));
    const sym166Capacity = context.sym166SourceOrNull == null ? 0 : 5; // ADR0082 / SYM-166: one lifetime pool.
    capacities = {
      ...capacity(initial, issued, context.effectiveStats),
      'SYM-166': sym166Capacity,
    };
    // The initial reservation uses its pre-symbiont basis. Later capacity is a separate current value.
    const spendingCapacity =
      context.stage === 'COMPOSITION_BEFORE_START'
        ? { START: 0, TRAINING: 0, 'SYM-166': 0 }
        : context.stage === 'START_SELECTION'
          ? { START: initial, TRAINING: 0, 'SYM-166': sym166Capacity }
          : capacities;
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
        used['SYM-166'] -= costs['SYM-166'];
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
        if (!active.has(key)) active.set(key, { START: 0, TRAINING: 0, 'SYM-166': 0 });
        if (!meets(catalog, key, context.permanentStats)) pendingLoss.add(key);
        grossIssued = true;
        continue;
      }
      if (!meets(catalog, f.skillKey, context.permanentStats))
        fail('new skill has an unmet permanent requirement');
      // NPC-014 follows composition. The pre-composition W basis fixes START
      // issuance, but CORE-166 requirements use the actual current characteristics.
      validateSkillRequirements(catalog, f.skillKey, context.effectiveStats);
      if (
        f.pool === 'SYM-166' &&
        (context.sym166SourceOrNull?.symbiontInstanceId !== f.symbiontInstanceId ||
          context.sym166SourceOrNull.nodeRef !== f.nodeRef)
      )
        fail('SYM-166 charge lacks its exact active learned source');
      const reserved = f.pool === 'START' ? fixedCost : 0;
      if (used[f.pool] + reserved + f.chargedSlotCost > spendingCapacity[f.pool])
        fail('insufficient current capacity in the original pool');
      const costs = active.get(f.skillKey) ?? { START: 0, TRAINING: 0, 'SYM-166': 0 };
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
  if (
    used.START !== accounting.usedSlots.START ||
    used.TRAINING !== accounting.usedSlots.TRAINING ||
    used['SYM-166'] !== (accounting.usedSlots['SYM-166'] ?? 0)
  )
    fail('accounting and context folds diverged');
  const pool = (name: 'START' | 'TRAINING' | 'SYM-166') => {
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
      ...(hasSym166
        ? {
            sym166Pool: Object.freeze({
              ...pool('SYM-166'),
              charges: Object.freeze(
                accounting.learnedSkills.flatMap((skill) =>
                  skill.charges.flatMap((charge) =>
                    charge.pool === 'SYM-166'
                      ? [
                          Object.freeze({
                            skillKey: skill.skillKey,
                            bonusBefore: charge.bonusBefore,
                            bonusAfter: charge.bonusAfter,
                            chargedSlotCost: charge.chargedSlotCost,
                            acquisitionFactId: charge.acquisitionFactId,
                            symbiontInstanceId: charge.symbiontInstanceId,
                            nodeRef: charge.nodeRef,
                          }),
                        ]
                      : [],
                  ),
                ),
              ),
            }),
          }
        : {}),
    }),
    grossGrant: accounting.grossGrant,
    disabledSkillKeys: Object.freeze(
      accounting.learnedSkills
        .filter((s) => !meets(catalog, s.skillKey, current.effectiveStats))
        .map((s) => s.skillKey),
    ),
    pools: Object.freeze({
      START: pool('START'),
      TRAINING: pool('TRAINING'),
      ...(hasSym166 ? { 'SYM-166': pool('SYM-166') } : {}),
    }),
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
    readonly sym166SourceOrNull?: NpcSkillContext['sym166SourceOrNull'];
  },
): Pick<NpcSkillEvaluation, 'disabledSkillKeys' | 'pools'> {
  const row = record(
    input,
    [
      'identityKey',
      'proof',
      'effectiveStats',
      ...(Object.hasOwn(input, 'sym166SourceOrNull') ? ['sym166SourceOrNull'] : []),
    ],
    'current input',
  );
  const identity = ref(row['identityKey'], 'identityKey');
  const proof = readProof(catalog, row['proof']);
  if (proof.identityKey !== identity) fail('proof belongs to another identity');
  const currentStats = stats(row['effectiveStats'], 'current effectiveStats', 1);
  const evaluated = evaluate(catalog, proof);
  const originalSource = proof.contexts.at(-1)?.sym166SourceOrNull;
  let currentSym166 = originalSource;
  if (Object.hasOwn(row, 'sym166SourceOrNull')) {
    if (row['sym166SourceOrNull'] === null) currentSym166 = null;
    else {
      const source = record(
        row['sym166SourceOrNull'],
        ['symbiontInstanceId', 'nodeRef'],
        'current SYM-166 source',
      );
      if (
        source['nodeRef'] !== 'SYM-166' ||
        originalSource == null ||
        source['symbiontInstanceId'] !== originalSource.symbiontInstanceId
      )
        fail('current SYM-166 source cannot invent or replace confirmed acquisition');
      currentSym166 = originalSource;
    }
  }
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
    pools: Object.freeze({
      START: pool('START'),
      TRAINING: pool('TRAINING'),
      ...(evaluated.pools['SYM-166'] === undefined
        ? {}
        : {
            'SYM-166': Object.freeze({
              capacity: currentSym166 == null ? 0 : 5,
              used: evaluated.pools['SYM-166'].used,
              available: Math.max(
                0,
                (currentSym166 == null ? 0 : 5) - evaluated.pools['SYM-166'].used,
              ),
              overfill: Math.max(
                0,
                evaluated.pools['SYM-166'].used - (currentSym166 == null ? 0 : 5),
              ),
            }),
          }),
    }),
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

export type NpcSkillPreviewContext = Readonly<
  Pick<
    NpcSkillContext,
    | 'contextFactId'
    | 'raceCode'
    | 'classCode'
    | 'skillStageStats'
    | 'permanentStats'
    | 'effectiveStats'
  > & {
    grossGrant: NpcGrossGrant;
    sym166SourceOrNull: NonNullable<NpcSkillContext['sym166SourceOrNull']> | null;
  }
>;
export interface NpcOrdinarySkillPreview {
  readonly kind: 'UNCOMMITTED';
  readonly capacity: number;
  readonly used: number;
  readonly remaining: number;
  readonly learnedSkills: readonly Readonly<{
    source: 'SELECTED' | 'RACE_GRANTED' | 'CLASS_MANDATORY';
    skillKey: SkillKey;
    bonus: number;
    slotCost: number;
  }>[];
  readonly pools: Readonly<Record<'START' | 'TRAINING' | 'SYM-166', NpcSkillPoolMetrics>>;
  readonly pendingCharges: readonly Readonly<{
    skillKey: SkillKey;
    pool: 'START' | 'TRAINING' | 'SYM-166';
    bonusBefore: number;
    bonusAfter: number;
    slotCost: number;
  }>[];
  readonly permanentLosses: readonly Readonly<{ contextFactId: string; skillKey: SkillKey }>[];
  readonly disabledSkillKeys: readonly SkillKey[];
}

/** Uncommitted arithmetic over already proved source contexts; allocates no fact or confirmation. */
export function previewNpcSkills(
  catalog: SkillStageCatalog,
  value: unknown,
): NpcOrdinarySkillPreview {
  const r = record(
    value,
    ['identityKey', 'previousConfirmedProofOrNull', 'contexts', 'selections'],
    'preview',
  );
  const identity = ref(r.identityKey, 'preview identity');
  const previous =
    r.previousConfirmedProofOrNull === null
      ? null
      : evaluateNpcSkills(catalog, {
          mode: 'CREATE_V1',
          identityKey: identity,
          previousConfirmedProofOrNull: null,
          proof: r.previousConfirmedProofOrNull,
        });
  const contexts = array(r.contexts, 'preview contexts').map((value): NpcSkillPreviewContext => {
    const c = record(
      value,
      [
        'contextFactId',
        'raceCode',
        'classCode',
        'skillStageStats',
        'permanentStats',
        'effectiveStats',
        'grossGrant',
        'sym166SourceOrNull',
      ],
      'preview context',
    );
    const race = catalog.races.find((r) => r.raceCode === c.raceCode);
    const cl =
      c.classCode === null ? null : catalog.classes.find((r) => r.classCode === c.classCode);
    if (
      race === undefined ||
      cl === undefined ||
      (race.classPolicy === 'REQUIRED_PURE_CLASS'
        ? cl === null || cl.raceCode !== race.raceCode
        : cl !== null)
    )
      return fail('invalid preview race/class');
    const g = c.grossGrant,
      gd =
        g !== null && typeof g === 'object'
          ? Object.getOwnPropertyDescriptor(g, 'kind')
          : undefined;
    let grossGrant: NpcGrossGrant;
    if (gd !== undefined && Object.hasOwn(gd, 'value') && gd.value === 'NOT_ISSUED') {
      record(g, ['kind'], 'preview grant');
      grossGrant = { kind: 'NOT_ISSUED' };
    } else {
      const grant = record(
        g,
        ['kind', 'sourceRuleId', 'bonusBefore', 'bonusAfter', 'acquisitionFactId'],
        'preview grant',
      );
      if (grant.kind !== 'ISSUED' || grant.sourceRuleId !== 'SYM-079')
        return fail('invalid preview GROSS');
      grossGrant = {
        kind: 'ISSUED',
        sourceRuleId: 'SYM-079',
        bonusBefore: integer(grant.bonusBefore, 'grant before', 0),
        bonusAfter: integer(grant.bonusAfter, 'grant after', 1),
        acquisitionFactId: ref(grant.acquisitionFactId, 'grant fact'),
      };
    }
    let sym166SourceOrNull: NpcSkillPreviewContext['sym166SourceOrNull'] = null;
    if (c.sym166SourceOrNull !== null) {
      const source = record(
        c.sym166SourceOrNull,
        ['symbiontInstanceId', 'nodeRef'],
        'preview SYM166',
      );
      if (source.nodeRef !== 'SYM-166') return fail('unknown preview source');
      sym166SourceOrNull = {
        symbiontInstanceId: ref(source.symbiontInstanceId, 'preview source instance'),
        nodeRef: 'SYM-166',
      };
    }
    return {
      contextFactId: ref(c.contextFactId, 'actual preview context'),
      raceCode: race.raceCode,
      classCode: cl?.classCode ?? null,
      skillStageStats: stats(c.skillStageStats, 'preview skillStageStats', Number.MIN_SAFE_INTEGER),
      permanentStats: stats(c.permanentStats, 'preview permanentStats', 1),
      effectiveStats: stats(c.effectiveStats, 'preview effectiveStats', 1),
      grossGrant,
      sym166SourceOrNull,
    };
  });
  const current = contexts.at(-1);
  if (current === undefined) return fail('missing actual preview contexts');
  if (new Set(contexts.map((c) => c.contextFactId)).size !== contexts.length)
    return fail('duplicate preview context');
  const active = new Map<
    SkillKey,
    { bonus: number; costs: { START: number; TRAINING: number; 'SYM-166': number } }
  >();
  const used = { START: 0, TRAINING: 0, 'SYM-166': 0 };
  for (const skill of previous?.ledger.learnedSkills ?? []) {
    const costs = { START: 0, TRAINING: 0, 'SYM-166': 0 };
    for (const charge of skill.charges) {
      costs[charge.pool] += charge.chargedSlotCost;
      used[charge.pool] += charge.chargedSlotCost;
    }
    active.set(skill.skillKey, { bonus: skill.bonus, costs });
  }
  let gross: NpcGrossGrant = previous?.grossGrant ?? { kind: 'NOT_ISSUED' };
  let issued = previous?.ledger.training.everIssued ?? Math.floor(current.permanentStats.W / 2);
  const permanentLosses: { contextFactId: string; skillKey: SkillKey }[] = [];
  for (const c of contexts) {
    for (const [key, skill] of active)
      if (!meets(catalog, key, c.permanentStats)) {
        for (const pool of ['START', 'TRAINING', 'SYM-166'] as const)
          used[pool] -= skill.costs[pool];
        active.delete(key);
        permanentLosses.push({ contextFactId: c.contextFactId, skillKey: key });
      }
    if (previous !== null) issued = Math.max(issued, Math.floor(c.permanentStats.W / 2));
    if (gross.kind === 'ISSUED') {
      if (JSON.stringify(gross) !== JSON.stringify(c.grossGrant))
        return fail('preview rewrites irreversible GROSS grant');
    } else if (c.grossGrant.kind === 'ISSUED') {
      const key = catalog.skills.find((s) => s.skillKey === 'GROSS')?.skillKey;
      if (key === undefined) return fail('missing GROSS source');
      const old = active.get(key),
        before = old?.bonus ?? 0,
        after = before === 0 ? 3 : before >= 5 ? before : Math.min(5, before + 3);
      if (c.grossGrant.bonusBefore !== before || c.grossGrant.bonusAfter !== after)
        return fail('preview grant differs from actual endpoints');
      gross = c.grossGrant;
      active.set(key, {
        bonus: after,
        costs: old?.costs ?? { START: 0, TRAINING: 0, 'SYM-166': 0 },
      });
      if (!meets(catalog, key, c.permanentStats)) {
        const granted = active.get(key);
        if (granted === undefined) return fail('lost preview grant');
        for (const pool of ['START', 'TRAINING', 'SYM-166'] as const)
          used[pool] -= granted.costs[pool];
        active.delete(key);
        permanentLosses.push({ contextFactId: c.contextFactId, skillKey: key });
      }
    }
  }
  const fixedSkills = fixed(catalog, current),
    fixedCost = fixedSkills.reduce((n, s) => n + s.slotCost, 0);
  const initial = calculateStartSkillSlots(
    previous?.ledger.startBasis.skillStageStats ?? current.skillStageStats,
  );
  const capacities = {
    ...capacity(initial, issued, current.effectiveStats),
    'SYM-166': current.sym166SourceOrNull === null ? 0 : 5,
  };
  const selections = array(r.selections, 'preview selections').map(
    (
      value,
    ): { skillKey: SkillKey; targetBonus: number; pool: 'START' | 'TRAINING' | 'SYM-166' } => {
      const s = record(value, ['skillKey', 'targetBonus', 'pool'], 'preview selection');
      const skill = catalog.skills.find((k) => k.skillKey === s.skillKey);
      if (skill === undefined || skill.category !== 'SELECTABLE_GENERAL')
        return fail('unknown selectable preview skill');
      if (s.pool !== 'START' && s.pool !== 'TRAINING' && s.pool !== 'SYM-166')
        return fail('unknown preview pool');
      return {
        skillKey: skill.skillKey,
        targetBonus: integer(s.targetBonus, 'selected bonus', 1),
        pool: s.pool,
      };
    },
  );
  const pendingCharges: NpcOrdinarySkillPreview['pendingCharges'][number][] = [];
  const apply = (selection: (typeof selections)[number], startPhase: boolean) => {
    const old = active.get(selection.skillKey),
      before = old?.bonus ?? 0;
    if (selection.targetBonus < before) return fail('preview cannot silently lower retained skill');
    if (selection.targetBonus === before) return;
    validateSkillRequirements(catalog, selection.skillKey, current.permanentStats);
    validateSkillRequirements(catalog, selection.skillKey, current.effectiveStats);
    const cost =
      calculateSkillSlotCost(selection.targetBonus) -
      (before === 0 ? 0 : calculateSkillSlotCost(before));
    const maximum = startPhase ? initial : capacities[selection.pool],
      reserved = selection.pool === 'START' ? fixedCost : 0;
    if (used[selection.pool] + reserved + cost > maximum)
      return fail('insufficient current preview capacity');
    used[selection.pool] += cost;
    const costs = old?.costs ?? { START: 0, TRAINING: 0, 'SYM-166': 0 };
    costs[selection.pool] += cost;
    active.set(selection.skillKey, { bonus: selection.targetBonus, costs });
    pendingCharges.push({
      skillKey: selection.skillKey,
      pool: selection.pool,
      bonusBefore: before,
      bonusAfter: selection.targetBonus,
      slotCost: cost,
    });
  };
  if (previous === null) {
    for (const s of selections.filter((s) => s.pool === 'START')) apply(s, true);
    if (used.START + fixedCost !== initial)
      return fail('initial preview must fill every START slot');
    for (const s of selections.filter((s) => s.pool !== 'START')) apply(s, false);
  } else for (const s of selections) apply(s, false);
  const pool = (name: 'START' | 'TRAINING' | 'SYM-166'): NpcSkillPoolMetrics => {
    const count = used[name] + (name === 'START' ? fixedCost : 0);
    return Object.freeze({
      capacity: capacities[name],
      used: count,
      available: Math.max(0, capacities[name] - count),
      overfill: Math.max(0, count - capacities[name]),
    });
  };
  const pools = Object.freeze({
    START: pool('START'),
    TRAINING: pool('TRAINING'),
    'SYM-166': pool('SYM-166'),
  });
  return Object.freeze({
    kind: 'UNCOMMITTED',
    capacity: pools.START.capacity,
    used: pools.START.used,
    remaining: pools.START.available,
    pools,
    learnedSkills: Object.freeze([
      ...fixedSkills,
      ...[...active].map(([skillKey, s]) =>
        Object.freeze({
          source: 'SELECTED' as const,
          skillKey,
          bonus: s.bonus,
          slotCost: s.costs.START + s.costs.TRAINING + s.costs['SYM-166'],
        }),
      ),
    ]),
    pendingCharges: Object.freeze(pendingCharges.map((c) => Object.freeze(c))),
    permanentLosses: Object.freeze(permanentLosses.map((c) => Object.freeze(c))),
    disabledSkillKeys: Object.freeze(
      [...active.keys()].filter((key) => !meets(catalog, key, current.effectiveStats)),
    ),
  });
}
