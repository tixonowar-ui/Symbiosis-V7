import type { NpcCalendarInstant, NpcPoisonPayload } from './effect-types.js';
import { prepareNewNpcAlcoholSchedule, type NpcInitialEffectCatalog } from './initial-effects.js';
import { npcPublicationData as data } from './inventory-publication.js';
import type { NpcDiseaseEffectContext } from './untimed-disease-effects.js';

export interface NpcAlcoholEffectInstance {
  readonly effectInstanceId: string;
  readonly effectTypeId: 'EFF-POISON-INSTANCE';
  readonly familyCode: 'FAM-POISON';
  readonly targetActorId: string;
  readonly targetRegionId: null;
  readonly sourceRuleIds: readonly ['CORE-110', 'CORE-228', 'AQA-024', 'CORE-101'];
  readonly sourceEntityId: null;
  readonly sourceInstanceId: null;
  readonly sourceSnapshot: null;
  readonly sourceLifecyclePolicy: 'SOURCE_SPECIFIC';
  readonly stackingKey: 'POI-FOOD_ALCOHOL';
  readonly payload: NpcPoisonPayload;
  readonly magnitude: number;
  readonly tags: readonly ['POISON'];
  readonly createdAt: string;
  readonly startsAt: NpcCalendarInstant;
  readonly expiresAt: NpcCalendarInstant;
  readonly remainingExact: string;
  readonly durationUnit: 'HOUR';
  readonly tickSchedule: Readonly<{
    phase: 'COSTS_AND_TICKS';
    period: Readonly<{ amount: 1; unit: 'HOUR' }>;
    nextTickAt: NpcCalendarInstant;
  }>;
  readonly lastTickAt: NpcCalendarInstant | null;
  readonly status: 'ACTIVE';
  readonly revision: number;
  readonly removalReason: null;
  readonly createdBy: 'GM';
  readonly variantKey: 'POI-FOOD_ALCOHOL';
  readonly aggregateKey: 'EFF-POISON-INSTANCE|POI-FOOD_ALCOHOL|null';
  readonly deathDisposition: 'SOURCE_SPECIFIC';
}
declare const catalogBrand: unique symbol;
export interface NpcAlcoholCodecCatalog {
  readonly [catalogBrand]: true;
}
/** Independent owning-history input; never reconstructed from the candidate effect. */
export interface NpcAlcoholHistoryAnchor {
  readonly effectInstanceId: string;
  readonly targetActorId: string;
  readonly createdAt: string;
  readonly effectiveZAtAssignment: number;
  readonly startsAt: NpcCalendarInstant;
  readonly expiresAt: NpcCalendarInstant;
  readonly nextTickAt: NpcCalendarInstant;
  readonly lastTickAt: NpcCalendarInstant | null;
  readonly remainingExact: string;
  readonly revision: number;
}
/** The owner proves response from actual composition/equipment; this is not a client permission. */
export interface NpcAlcoholAssignmentContext extends NpcDiseaseEffectContext {
  readonly kind: 'NEW_FORMAL_ASSIGNMENT';
  readonly poisonResponse: 'APPLICABLE' | 'IMMUNE';
}
export type NpcAlcoholAssignmentResult =
  | Readonly<{
      kind: 'NO_EFFECT';
      sourceRuleId: 'CORE-110' | 'CORE-228';
      reason: 'NON_POSITIVE_DURATION' | 'POISON_IMMUNITY';
    }>
  | Readonly<{ kind: 'ACTIVE'; effect: NpcAlcoholEffectInstance }>;

const contexts = new WeakMap<NpcAlcoholCodecCatalog, NpcInitialEffectCatalog>();
const RULES = ['CORE-110', 'CORE-228', 'AQA-024', 'CORE-101'] as const;
// Technical calendar conversion. The period origin itself comes from ADR 0082 / #224.
const MINUTES_PER_HOUR = 60;
const FIELDS = [
  'effectInstanceId',
  'effectTypeId',
  'familyCode',
  'targetActorId',
  'targetRegionId',
  'sourceRuleIds',
  'sourceEntityId',
  'sourceInstanceId',
  'sourceSnapshot',
  'sourceLifecyclePolicy',
  'stackingKey',
  'payload',
  'magnitude',
  'tags',
  'createdAt',
  'startsAt',
  'expiresAt',
  'remainingExact',
  'durationUnit',
  'tickSchedule',
  'lastTickAt',
  'status',
  'revision',
  'removalReason',
  'createdBy',
  'variantKey',
  'aggregateKey',
  'deathDisposition',
] as const;
function fail(message: string): never {
  throw new Error(`NPC alcohol effect: ${message}`);
}
function integer(value: unknown, minimum = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : fail('safe calendar/integer value required');
}
function moment(value: unknown): NpcCalendarInstant {
  return Object.freeze({
    campaignTimestamp: integer(data.record(value, ['campaignTimestamp']).campaignTimestamp),
  });
}
function timestamp(value: unknown): string {
  const text = data.text(value);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(text) ||
    !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString() !== text
  )
    return fail('existing canonical audit timestamp required');
  return text;
}
function scope(value: unknown): NpcDiseaseEffectContext {
  const row = data.record(value, ['targetActorId', 'campaignTimestampOrNull', 'dead']);
  if (typeof row.dead !== 'boolean') return fail('explicit living/dead context required');
  if (row.dead) return fail('living-current-state codec cannot finalize corpse effects');
  return {
    targetActorId: data.uuid(row.targetActorId),
    dead: false,
    campaignTimestampOrNull:
      row.campaignTimestampOrNull === null ? null : integer(row.campaignTimestampOrNull),
  };
}
function one(value: unknown, key: string, id: string): Record<string, unknown> {
  const found = data
    .array(value)
    .map((row) => data.record(row))
    .filter((row) => row[key] === id);
  return found.length === 1 ? found[0]! : fail(`exact source ${id} required`);
}
/** Seals the existing poison container and the explicitly delivered alcohol-only amendment. */
export function createNpcAlcoholCodecCatalog(
  initialEffects: NpcInitialEffectCatalog,
  sources: Readonly<{
    effectTypes: unknown;
    runtimeContracts: unknown;
    timerPolicies: unknown;
    npc016: unknown;
  }>,
): NpcAlcoholCodecCatalog {
  const definition = one(sources.effectTypes, 'EffectTypeID', 'EFF-POISON-INSTANCE');
  for (const [key, value] of Object.entries({
    FamilyCode: 'FAM-POISON',
    Automation: 'REGISTRY_SCHEMA',
    'Schema status': 'DEFINED',
    'Stack policy': 'POISON_PROFILE_SPECIFIC',
    'Removal policy': 'PROFILE_SPECIFIC',
    'State bucket': 'currentEffects',
    'State writes': 'EffectInstance.payload.poisonProfileId',
    'Timer policy': 'SOURCE_SPECIFIC_OR_EXPLICIT',
    'Rule refs': 'CORE-228',
  }))
    data.equal(value, definition[key]);
  const contracts = data
    .array(sources.runtimeContracts)
    .map((row) => data.record(row))
    .filter((row) => row.Entity === 'EffectInstance');
  if (
    contracts.length !== FIELDS.length ||
    FIELDS.some((field) => contracts.filter((r) => r.Field === field).length !== 1)
  )
    return fail('closed Effects/12 field contract changed');
  data.equal('COSTS_AND_TICKS', one(sources.timerPolicies, 'PolicyID', 'TIME-010').Code);
  data.equal('NO_SAME_MOMENT_SERVICE', one(sources.timerPolicies, 'PolicyID', 'TIME-017').Code);
  const form = data.record(sources.npc016);
  const acceptance = data.array(form.acceptanceCriteria).map(data.text);
  const amendment = acceptance.filter((line) => line.startsWith('ADR0082 / #224:'));
  if (
    amendment.length !== 1 ||
    !amendment[0]!.includes('nextTickAt=startsAt+60 минут') ||
    !amendment[0]!.includes('Срок 30−Z часов и 5 HP за тик') ||
    !amendment[0]!.includes('тик на expiresAt исполняется в штатной фазе ticks перед expiry')
  )
    return fail('confirmed #224 schedule amendment required');
  data.equal(5, initialEffects.alcohol.damagePerHour);
  data.equal(30, initialEffects.alcohol.durationHoursOffset);
  const catalog = Object.freeze({}) as NpcAlcoholCodecCatalog;
  contexts.set(catalog, initialEffects);
  return catalog;
}
function initial(catalog: NpcAlcoholCodecCatalog): NpcInitialEffectCatalog {
  return contexts.get(catalog) ?? fail('issued alcohol catalog required');
}
function readHistory(value: unknown): NpcAlcoholHistoryAnchor {
  const row = data.record(value, [
    'effectInstanceId',
    'targetActorId',
    'createdAt',
    'effectiveZAtAssignment',
    'startsAt',
    'expiresAt',
    'nextTickAt',
    'lastTickAt',
    'remainingExact',
    'revision',
  ]);
  const remainingExact = data.text(row.remainingExact);
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u.test(remainingExact) ||
    !Number.isFinite(Number(remainingExact))
  )
    return fail('canonical nonnegative saved duration required');
  return data.freeze({
    effectInstanceId: data.uuid(row.effectInstanceId),
    targetActorId: data.uuid(row.targetActorId),
    createdAt: timestamp(row.createdAt),
    effectiveZAtAssignment: integer(row.effectiveZAtAssignment, 1),
    startsAt: moment(row.startsAt),
    expiresAt: moment(row.expiresAt),
    nextTickAt: moment(row.nextTickAt),
    lastTickAt: row.lastTickAt === null ? null : moment(row.lastTickAt),
    remainingExact,
    revision: integer(row.revision, 1),
  });
}
function build(
  catalog: NpcAlcoholCodecCatalog,
  context: NpcDiseaseEffectContext,
  history: NpcAlcoholHistoryAnchor,
): NpcAlcoholEffectInstance {
  const prepared = prepareNewNpcAlcoholSchedule(initial(catalog), {
    kind: 'ALCOHOL',
    effectiveZ: history.effectiveZAtAssignment,
    assignment: {
      kind: 'NEW_FORMAL_ASSIGNMENT',
      campaignTimestamp: history.startsAt.campaignTimestamp,
    },
  });
  if (prepared.kind === 'NO_EFFECT') return fail('nonpositive duration cannot own an effect');
  const now = context.campaignTimestampOrNull;
  const start = history.startsAt.campaignTimestamp,
    expiry = history.expiresAt.campaignTimestamp;
  const last = history.lastTickAt?.campaignTimestamp ?? null;
  if (
    history.targetActorId !== context.targetActorId ||
    now === null ||
    start > now ||
    now > expiry
  )
    return fail('foreign owner or unconfirmed/current time outside the active lifetime');
  data.equal(prepared.expiresAt, history.expiresAt);
  if (last !== null && (last <= start || last > now || (last - start) % MINUTES_PER_HOUR !== 0))
    return fail('last tick must be an actual full-period saved anchor');
  const next = integer((last ?? start) + MINUTES_PER_HOUR);
  if (
    next !== history.nextTickAt.campaignTimestamp ||
    next > expiry ||
    Number(history.remainingExact) > Number(prepared.remainingExact)
  )
    return fail('saved phase/duration differs; historical phase is never guessed');
  return data.freeze({
    effectInstanceId: history.effectInstanceId,
    effectTypeId: 'EFF-POISON-INSTANCE',
    familyCode: 'FAM-POISON',
    targetActorId: history.targetActorId,
    targetRegionId: null,
    sourceRuleIds: [...RULES],
    sourceEntityId: null,
    sourceInstanceId: null,
    sourceSnapshot: null,
    sourceLifecyclePolicy: 'SOURCE_SPECIFIC',
    stackingKey: 'POI-FOOD_ALCOHOL',
    payload: prepared.payload,
    magnitude: prepared.magnitude,
    tags: ['POISON'],
    createdAt: history.createdAt,
    startsAt: history.startsAt,
    expiresAt: history.expiresAt,
    remainingExact: history.remainingExact,
    durationUnit: 'HOUR',
    tickSchedule: { ...prepared.tickSchedule, nextTickAt: history.nextTickAt },
    lastTickAt: history.lastTickAt,
    status: 'ACTIVE',
    revision: history.revision,
    removalReason: null,
    createdBy: 'GM',
    variantKey: 'POI-FOOD_ALCOHOL',
    aggregateKey: 'EFF-POISON-INSTANCE|POI-FOOD_ALCOHOL|null',
    deathDisposition: 'SOURCE_SPECIFIC',
  });
}
/** No intake, cost, RNG, damage, clock advance or identity allocation happens in this constructor. */
export function createNpcAlcoholEffect(
  catalog: NpcAlcoholCodecCatalog,
  candidate: unknown,
  suppliedContext: NpcAlcoholAssignmentContext,
): NpcAlcoholAssignmentResult {
  const contextRow = data.record(suppliedContext, [
    'kind',
    'targetActorId',
    'campaignTimestampOrNull',
    'dead',
    'poisonResponse',
  ]);
  data.equal('NEW_FORMAL_ASSIGNMENT', contextRow.kind);
  if (contextRow.poisonResponse !== 'APPLICABLE' && contextRow.poisonResponse !== 'IMMUNE')
    return fail('explicit independently checked poison response required');
  const context = scope({
    targetActorId: contextRow.targetActorId,
    campaignTimestampOrNull: contextRow.campaignTimestampOrNull,
    dead: contextRow.dead,
  });
  const row = data.record(candidate, [
    'effectInstanceIdOrNull',
    'createdAtOrNull',
    'effectiveZ',
    'reason',
  ]);
  data.text(row.reason);
  const initialEffects = initial(catalog),
    effectiveZ = integer(row.effectiveZ, 1);
  // CORE-228 prevents the assignment itself. An immune actor has no timer to anchor.
  if (contextRow.poisonResponse === 'IMMUNE') {
    if (row.effectInstanceIdOrNull !== null || row.createdAtOrNull !== null)
      return fail('NO_EFFECT must not allocate an effect identity or audit timestamp');
    return Object.freeze({
      kind: 'NO_EFFECT',
      sourceRuleId: 'CORE-228',
      reason: 'POISON_IMMUNITY',
    });
  }
  const prepared = prepareNewNpcAlcoholSchedule(initialEffects, {
    kind: 'ALCOHOL',
    effectiveZ,
    assignment:
      context.campaignTimestampOrNull === null
        ? { kind: 'NEW_FORMAL_ASSIGNMENT' }
        : { kind: 'NEW_FORMAL_ASSIGNMENT', campaignTimestamp: context.campaignTimestampOrNull },
  });
  if (prepared.kind === 'NO_EFFECT') {
    if (row.effectInstanceIdOrNull !== null || row.createdAtOrNull !== null)
      return fail('NO_EFFECT must not allocate an effect identity or audit timestamp');
    return prepared;
  }
  const history: NpcAlcoholHistoryAnchor = {
    effectInstanceId: data.uuid(row.effectInstanceIdOrNull),
    targetActorId: context.targetActorId,
    createdAt: timestamp(row.createdAtOrNull),
    effectiveZAtAssignment: effectiveZ,
    startsAt: prepared.startsAt,
    expiresAt: prepared.expiresAt,
    nextTickAt: prepared.tickSchedule.nextTickAt,
    lastTickAt: null,
    remainingExact: prepared.remainingExact,
    revision: 1,
  };
  return Object.freeze({ kind: 'ACTIVE', effect: build(catalog, context, history) });
}
/** Retained instances use actual saved history, never current Z/new immunity or a reconstructed start. */
export function validateNpcAlcoholEffect(
  catalog: NpcAlcoholCodecCatalog,
  candidate: unknown,
  suppliedContext: NpcDiseaseEffectContext,
  suppliedHistory: NpcAlcoholHistoryAnchor,
): NpcAlcoholEffectInstance {
  data.record(candidate, FIELDS);
  const expected = build(catalog, scope(suppliedContext), readHistory(suppliedHistory));
  data.equal(expected, candidate);
  return expected;
}
