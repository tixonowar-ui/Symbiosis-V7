import type { NpcInitialTraumaCalendarAnchor } from './initial-trauma.js';
import type { NpcRollFact } from './types.js';
import { npcPublicationData as data } from './inventory-publication.js';
import {
  createNpcLifeStateCatalog,
  prepareNpcBasePeaceDeathTimer,
  npcBasePeaceDeathTimerMinutes,
  type NpcLifeStateCatalog,
} from './life-state.js';
import {
  readNpcFunctionalDuplicateProof,
  readNpcFunctionalDuplicateRequiredDeathDeadline,
  assertNpcFunctionalDuplicateCampaign,
  type NpcFunctionalDuplicateProof,
} from './functional-duplicate-composition.js';

export type NpcFormalLifeKind = 'ALIVE' | 'SEVERELY_WOUNDED' | 'DEAD';
export type NpcFunctionalDuplicateSnapshot = ReturnType<typeof readNpcFunctionalDuplicateProof>;
export interface NpcFormalLifeHistoryAnchor {
  readonly kind: 'GM_FORMAL_INITIAL_LIFE';
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly lifeKind: NpcFormalLifeKind;
  readonly initialStateConfirmationId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly severeWoundOrNull: Readonly<{
    effectInstanceId: string;
    calendarAnchor: NpcInitialTraumaCalendarAnchor;
    rollFact: NpcRollFact<6>;
    remainingMinutes: string;
    duplicateAtEntry: NpcFunctionalDuplicateSnapshot;
  }> | null;
}
export interface NpcFormalLifeContext {
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly currentHP: number;
  readonly campaignTimestampOrNull: number | null;
}
export interface NpcFormalDeathTimer {
  readonly effectInstanceId: string;
  readonly effectTypeId: 'EFF-LIFE-DEATH_TIMER';
  readonly familyCode: 'FAM-LIFECYCLE';
  readonly targetActorId: string;
  readonly targetRegionId: null;
  readonly sourceRuleIds: readonly string[];
  readonly sourceEntityId: null;
  readonly sourceInstanceId: null;
  readonly sourceSnapshot: null;
  readonly sourceLifecyclePolicy: 'SOURCE_SPECIFIC';
  readonly stackingKey: 'CORE-153';
  readonly payload: Readonly<{
    assignedByGM: true;
    rollFact: NpcRollFact<6>;
    duplicateMultiplierAtEntry: 1 | 4;
    duplicateAtEntry: NpcFunctionalDuplicateSnapshot;
  }>;
  readonly magnitude: null;
  readonly tags: readonly ['LIFECYCLE'];
  readonly createdAt: string;
  readonly startsAt: Readonly<{ campaignTimestampExact: string }>;
  readonly expiresAt: Readonly<{ campaignTimestampExact: string }>;
  readonly remainingExact: string;
  readonly durationUnit: 'MINUTE';
  readonly tickSchedule: null;
  readonly lastTickAt: null;
  readonly status: 'ACTIVE';
  readonly revision: 1;
  readonly removalReason: null;
  readonly createdBy: 'GM';
  readonly variantKey: 'CORE-153';
  readonly aggregateKey: string;
  readonly deathDisposition: 'TERMINATE_ON_DEATH';
}
type Restriction = Readonly<{
  profileId: 'PRF-SEVERE-PC' | 'PRF-SEVERE-DUPLICATE' | 'PRF-DEAD';
  physicalActions: 'YES' | 'NO' | 'NO_BY_DEFAULT';
  mentalActions: 'YES' | 'NO' | 'NO_BY_DEFAULT';
  movement: 'YES' | 'NO';
  reactions: 'YES' | 'NO';
  activeDefense: 'YES' | 'NO';
  armor: 'YES' | 'N/A';
  controller: 'owningController' | 'NONE';
}>;
export type NpcFormalLifeState = Readonly<
  { anchor: NpcFormalLifeHistoryAnchor } & (
    | {
        lifeKind: 'ALIVE';
        dead: false;
        severeWound: false;
        deathTimerOrNull: null;
        restrictionOrNull: null;
      }
    | {
        lifeKind: 'SEVERELY_WOUNDED';
        dead: false;
        severeWound: true;
        abstractVitalSystemDamaged: true;
        deathTimerOrNull: NpcFormalDeathTimer;
        restrictionOrNull: Restriction;
      }
    | { lifeKind: 'DEAD'; dead: true; deathTimerOrNull: null; restrictionOrNull: Restriction }
  )
>;
declare const brand: unique symbol;
export interface NpcFormalLifeCatalog {
  readonly [brand]: true;
}
const catalogs = new WeakMap<NpcFormalLifeCatalog, NpcLifeStateCatalog>();
const boundaries = new WeakMap<
  NpcFormalLifeState,
  Readonly<{
    state: NpcFormalLifeState;
    context: NpcFormalLifeContext;
    currentDuplicateSnapshotOrNull: NpcFunctionalDuplicateSnapshot | null;
  }>
>();
export function readNpcFormalLifeBoundary(value: unknown) {
  if (value === null || typeof value !== 'object') return fail('issued life boundary required');
  return boundaries.get(value as NpcFormalLifeState) ?? fail('issued life boundary required');
}
const RESTRICTIONS: Readonly<Record<Restriction['profileId'], Restriction>> = {
  'PRF-SEVERE-PC': {
    profileId: 'PRF-SEVERE-PC',
    physicalActions: 'NO_BY_DEFAULT',
    mentalActions: 'NO_BY_DEFAULT',
    movement: 'NO',
    reactions: 'NO',
    activeDefense: 'NO',
    armor: 'YES',
    controller: 'owningController',
  },
  'PRF-SEVERE-DUPLICATE': {
    profileId: 'PRF-SEVERE-DUPLICATE',
    physicalActions: 'YES',
    mentalActions: 'YES',
    movement: 'YES',
    reactions: 'YES',
    activeDefense: 'YES',
    armor: 'YES',
    controller: 'owningController',
  },
  'PRF-DEAD': {
    profileId: 'PRF-DEAD',
    physicalActions: 'NO',
    mentalActions: 'NO',
    movement: 'NO',
    reactions: 'NO',
    activeDefense: 'NO',
    armor: 'N/A',
    controller: 'NONE',
  },
};
export class NpcFormalLifeError extends Error {
  constructor(detail: string) {
    super(`NPC formal life: ${detail}`);
    this.name = 'NpcFormalLifeError';
  }
}
function fail(detail: string): never {
  throw new NpcFormalLifeError(detail);
}
function integer(value: unknown, minimum = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : fail('safe integer required');
}
function base(catalog: NpcFormalLifeCatalog): NpcLifeStateCatalog {
  return catalogs.get(catalog) ?? fail('issued source catalog required');
}
function one(value: unknown, key: string, id: string) {
  const rows = data
    .array(value)
    .map((r) => data.record(r))
    .filter((r) => r[key] === id);
  return rows.length === 1 ? rows[0]! : fail(`exact source ${id} required`);
}
function lifeKind(value: unknown): NpcFormalLifeKind {
  return value === 'ALIVE' || value === 'SEVERELY_WOUNDED' || value === 'DEAD'
    ? value
    : fail('explicit known life state required');
}
function decimal(value: unknown) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u.test(value))
    return fail('canonical exact decimal required');
  const [whole, fraction = ''] = value.split('.');
  return {
    numerator: BigInt(whole! + fraction),
    denominator: 10n ** BigInt(fraction.length),
    scale: fraction.length,
  };
}
function exactText(numerator: bigint, scale: number): string {
  const digits = numerator.toString().padStart(scale + 1, '0');
  return scale === 0
    ? digits
    : (digits.slice(0, -scale) + '.' + digits.slice(-scale))
        .replace(/0+$/u, '')
        .replace(/\.$/u, '');
}
/** Accepted #237: no chosen remainder, rounding or full-duration default. */
export function readNpcFormalLifeRemaining(value: unknown, maximum: number): string {
  const exact = decimal(value);
  integer(maximum, 1);
  if (exact.numerator <= 0n || exact.numerator > BigInt(maximum) * exact.denominator)
    return fail('remaining time exceeds the preserved D6 and actual duplicate boundary');
  return value as string;
}
/** Preflight uses actual D6/source proofs without allocating a future SET or effect identity. */
export function npcFormalLifeMaximumRemainingMinutes(
  catalog: NpcFormalLifeCatalog,
  rollFact: unknown,
  duplicateProof: NpcFunctionalDuplicateProof,
): string {
  const minutes = npcBasePeaceDeathTimerMinutes(base(catalog), rollFact);
  const duplicate = readNpcFunctionalDuplicateProof(duplicateProof);
  // CORE-153/154: multiple real sources still multiply the entry timer only once.
  return String(minutes * (duplicate.sources.length === 0 ? 1 : 4));
}
function calendar(value: unknown): NpcInitialTraumaCalendarAnchor {
  const row = data.record(value);
  if (row.kind === 'PRE_START_INITIAL') {
    data.record(row, ['kind', 'campaignTimestamp', 'lobbySnapshotRevision']);
    const revision = data.text(row.lobbySnapshotRevision);
    if (!/^[0-9a-f]{64}$/u.test(revision)) return fail('exact lobby snapshot revision required');
    return {
      kind: 'PRE_START_INITIAL',
      campaignTimestamp: integer(row.campaignTimestamp),
      lobbySnapshotRevision: revision,
    };
  }
  if (row.kind === 'CURRENT_CAMPAIGN') {
    data.record(row, ['kind', 'campaignTimestamp', 'stateRevision']);
    return {
      kind: 'CURRENT_CAMPAIGN',
      campaignTimestamp: integer(row.campaignTimestamp),
      stateRevision: integer(row.stateRevision),
    };
  }
  return fail('confirmed virtual calendar required');
}
function anchor(
  catalog: NpcFormalLifeCatalog,
  value: unknown,
  entry: NpcFunctionalDuplicateProof | null,
): NpcFormalLifeHistoryAnchor {
  const source = base(catalog);
  const row = data.record(value, [
    'kind',
    'campaignId',
    'npcUuid',
    'lifeKind',
    'initialStateConfirmationId',
    'reason',
    'createdAt',
    'severeWoundOrNull',
  ]);
  data.equal('GM_FORMAL_INITIAL_LIFE', row.kind);
  const state = lifeKind(row.lifeKind),
    campaignId = data.uuid(row.campaignId),
    npcUuid = data.uuid(row.npcUuid),
    initialStateConfirmationId = data.uuid(row.initialStateConfirmationId),
    reason = data.text(row.reason),
    createdAt = data.text(row.createdAt);
  if (reason.trim().length === 0) return fail('explicit reason required');
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  )
    return fail('saved canonical audit timestamp required');
  let severeWoundOrNull: NpcFormalLifeHistoryAnchor['severeWoundOrNull'] = null;
  if (state === 'SEVERELY_WOUNDED') {
    if (entry === null) return fail('independent actual entry duplicate proof required');
    const detail = data.record(row.severeWoundOrNull, [
      'effectInstanceId',
      'calendarAnchor',
      'rollFact',
      'remainingMinutes',
      'duplicateAtEntry',
    ]);
    const clock = calendar(detail.calendarAnchor),
      duplicateAtEntry = readNpcFunctionalDuplicateProof(entry);
    assertNpcFunctionalDuplicateCampaign(entry, campaignId);
    data.equal(npcUuid, duplicateAtEntry.npcUuid);
    data.equal(clock.campaignTimestamp, duplicateAtEntry.campaignTimestamp);
    data.equal(duplicateAtEntry, detail.duplicateAtEntry);
    const contribution = prepareNpcBasePeaceDeathTimer(source, {
      kind: 'GM_FORMAL_INITIAL_SEVERE_WOUND',
      campaignId,
      targetActorId: npcUuid,
      preparationFactId: initialStateConfirmationId,
      reason,
      startsAt: { campaignTimestamp: clock.campaignTimestamp },
      rollFact: detail.rollFact,
    });
    const maximum = Number(
      npcFormalLifeMaximumRemainingMinutes(catalog, contribution.anchor.rollFact, entry),
    );
    severeWoundOrNull = {
      effectInstanceId: data.uuid(detail.effectInstanceId),
      calendarAnchor: clock,
      rollFact: contribution.anchor.rollFact,
      remainingMinutes: readNpcFormalLifeRemaining(detail.remainingMinutes, maximum),
      duplicateAtEntry,
    };
  } else {
    data.equal(null, row.severeWoundOrNull);
    if (entry !== null) return fail('untimed life state has no entry duplicate fact');
  }
  return data.freeze({
    kind: 'GM_FORMAL_INITIAL_LIFE',
    campaignId,
    npcUuid,
    lifeKind: state,
    initialStateConfirmationId,
    reason,
    createdAt,
    severeWoundOrNull,
  });
}
export function createNpcFormalLifeCatalog(
  sources: Readonly<{
    rules: unknown;
    effectTypes: unknown;
    timerPolicies: unknown;
    capabilityProfiles: unknown;
    gaps: unknown;
    runtimeContracts: unknown;
  }>,
): NpcFormalLifeCatalog {
  data.record(sources, [
    'rules',
    'effectTypes',
    'timerPolicies',
    'capabilityProfiles',
    'gaps',
    'runtimeContracts',
  ]);
  const source = createNpcLifeStateCatalog({
    rules: sources.rules,
    effectTypes: sources.effectTypes,
    timerPolicies: sources.timerPolicies,
  });
  for (const [id, text] of [
    ['CORE-152', 'абстрактное состояние «повреждён жизненно важный орган» без случайного organId'],
    ['CORE-154', 'если временный дубль исчез — запретить действия, таймер оставить'],
    ['CORE-156', 'Обычное лечение HP без прямого указания не действует.'],
    [
      'CQA-001',
      'Личные таймеры и периодические эффекты трупа останавливаются и не возобновляются сами.',
    ],
    ['AQA-028', 'назначить или снять формализованное состояние'],
  ]) {
    const row = one(sources.rules, 'Rule ID', id!);
    data.equal('Активно', row['Статус']);
    if (!data.text(row['Итоговый алгоритм']).includes(text!))
      fail(`${id} required source semantics differ`);
  }
  for (const definition of Object.values(RESTRICTIONS)) {
    const row = one(sources.capabilityProfiles, 'ProfileID', definition.profileId);
    for (const [field, expected] of Object.entries({
      Status: 'DEFINED',
      'Физические действия': definition.physicalActions,
      'Ментальные действия': definition.mentalActions,
      Перемещение: definition.movement,
      Реакции: definition.reactions,
      'Активная защита': definition.activeDefense,
      Броня: definition.armor,
      Контроллер: definition.controller,
    }))
      data.equal(expected, row[field]);
  }
  for (const [id, writes, stack, removal] of [
    ['EFF-LIFE-SEVERE_WOUND', 'severeWound=true', 'SINGLETON', 'SOURCE_OR_REANIMATION'],
    ['EFF-LIFE-DEAD', 'dead=true', 'TERMINAL_SINGLETON', 'NONE'],
  ]) {
    const row = one(sources.effectTypes, 'EffectTypeID', id!);
    for (const [field, expected] of Object.entries({
      Automation: 'AUTOMATED',
      'Schema status': 'DEFINED',
      FamilyCode: 'FAM-LIFECYCLE',
      'State bucket': 'actorFlags',
      'State writes': writes,
      'Stack policy': stack,
      'Removal policy': removal,
    }))
      data.equal(expected, row[field]);
  }
  data.equal(
    'Смерть завершает временные эффекты и контроль; сохраняет травмы, раны, предметы, инвентарь и симбионтов; воскрешение не возобновляет',
    one(sources.gaps, 'GapID', 'GAP-006')['Действующая политика / решение'],
  );
  const fields = data
    .array(sources.runtimeContracts)
    .map((r) => data.record(r))
    .filter((r) => r.Entity === 'EffectInstance')
    .map((r) => r.Field);
  data.equal([...EFFECT_FIELDS].sort(), [...fields].sort());
  const result = Object.freeze({}) as NpcFormalLifeCatalog;
  catalogs.set(result, source);
  return result;
}
const EFFECT_FIELDS = [
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
function deathTimerInterval(
  detail: NonNullable<NpcFormalLifeHistoryAnchor['severeWoundOrNull']>,
  now: number,
) {
  const start = detail.calendarAnchor.campaignTimestamp,
    exact = decimal(detail.remainingMinutes),
    end = BigInt(start) * exact.denominator + exact.numerator;
  if (now < start || BigInt(now) * exact.denominator >= end)
    return fail('current time is outside the independently preserved positive timer');
  if (end > BigInt(Number.MAX_SAFE_INTEGER) * exact.denominator) return fail('calendar overflow');
  return { start, exact, end, deadline: exactText(end, exact.scale) };
}

export interface NpcFormalLifeTimerDisplayBasis {
  readonly kind: 'PROVISIONAL_FORMAL_LIFE_TIMER';
  readonly startsAtExact: string;
  readonly deadlineExact: string;
  readonly remainingExact: string;
  readonly requiredRecoveryDeadlineOrNull: string | null;
  readonly recoveryFits: boolean;
}

export class NpcFormalLifeTimerDisplayUnavailableError extends NpcFormalLifeError {
  readonly kind = 'CURRENT_TIMER_EXPIRED' as const;
  constructor() {
    super('current provisional timer expired; no active life state is implied');
    this.name = 'NpcFormalLifeTimerDisplayUnavailableError';
  }
}

/** Display only: actual SET/original history is checked, but no accepted life boundary is issued. */
export function previewNpcFormalLifeTimerBasis(
  catalog: NpcFormalLifeCatalog,
  original: NpcFormalLifeHistoryAnchor,
  context: NpcFormalLifeContext,
  entryDuplicate: NpcFunctionalDuplicateProof,
  currentDuplicate: NpcFunctionalDuplicateProof,
): NpcFormalLifeTimerDisplayBasis {
  const proof = anchor(catalog, original, entryDuplicate);
  if (proof.lifeKind !== 'SEVERELY_WOUNDED' || proof.severeWoundOrNull === null)
    return fail('provisional timer requires an actual severe assignment');
  data.record(context, ['campaignId', 'npcUuid', 'currentHP', 'campaignTimestampOrNull']);
  data.equal(proof.campaignId, data.uuid(context.campaignId));
  data.equal(proof.npcUuid, data.uuid(context.npcUuid));
  data.equal(0, integer(context.currentHP));
  const now = integer(context.campaignTimestampOrNull),
    current = readNpcFunctionalDuplicateProof(currentDuplicate);
  assertNpcFunctionalDuplicateCampaign(currentDuplicate, proof.campaignId);
  data.equal(proof.npcUuid, current.npcUuid);
  data.equal(now, current.campaignTimestamp);
  // Only the display path exposes expiry as a removable current blocker, after all origin checks.
  const detail = proof.severeWoundOrNull,
    remaining = decimal(detail.remainingMinutes);
  if (
    now >= detail.calendarAnchor.campaignTimestamp &&
    BigInt(now) * remaining.denominator >=
      BigInt(detail.calendarAnchor.campaignTimestamp) * remaining.denominator + remaining.numerator
  )
    throw new NpcFormalLifeTimerDisplayUnavailableError();
  const { start, exact, end, deadline } = deathTimerInterval(proof.severeWoundOrNull, now);
  const requiredRecoveryDeadlineOrNull =
    readNpcFunctionalDuplicateRequiredDeathDeadline(currentDuplicate);
  const required =
    requiredRecoveryDeadlineOrNull === null ? null : decimal(requiredRecoveryDeadlineOrNull);
  return data.freeze({
    kind: 'PROVISIONAL_FORMAL_LIFE_TIMER',
    startsAtExact: String(start),
    deadlineExact: deadline,
    remainingExact: exactText(end - BigInt(now) * exact.denominator, exact.scale),
    requiredRecoveryDeadlineOrNull,
    recoveryFits:
      required === null || end * required.denominator >= required.numerator * exact.denominator,
  });
}

function build(
  catalog: NpcFormalLifeCatalog,
  proof: NpcFormalLifeHistoryAnchor,
  context: NpcFormalLifeContext,
  currentDuplicate: NpcFunctionalDuplicateProof | null,
): NpcFormalLifeState {
  base(catalog);
  data.record(context, ['campaignId', 'npcUuid', 'currentHP', 'campaignTimestampOrNull']);
  data.equal(proof.campaignId, data.uuid(context.campaignId));
  data.equal(proof.npcUuid, data.uuid(context.npcUuid));
  const hp = integer(context.currentHP);
  if (context.campaignTimestampOrNull !== null) integer(context.campaignTimestampOrNull);
  if (proof.lifeKind !== 'SEVERELY_WOUNDED') {
    if (currentDuplicate !== null) return fail('untimed life state has no duplicate token');
    if (proof.lifeKind === 'ALIVE') {
      if (hp === 0) return fail('ALIVE requires positive explicit HP');
      return data.freeze({
        anchor: proof,
        lifeKind: 'ALIVE',
        dead: false,
        severeWound: false,
        deathTimerOrNull: null,
        restrictionOrNull: null,
      });
    }
    data.equal(0, hp);
    // DEAD states no past severe-wound/organ fact. The owning sheet retains actual old wounds.
    return data.freeze({
      anchor: proof,
      lifeKind: 'DEAD',
      dead: true,
      deathTimerOrNull: null,
      restrictionOrNull: RESTRICTIONS['PRF-DEAD'],
    });
  }
  data.equal(0, hp);
  const detail = proof.severeWoundOrNull;
  if (detail === null || currentDuplicate === null || context.campaignTimestampOrNull === null)
    return fail('severe state requires its preserved timer and current actual duplicate proof');
  const actual = readNpcFunctionalDuplicateProof(currentDuplicate),
    now = context.campaignTimestampOrNull;
  assertNpcFunctionalDuplicateCampaign(currentDuplicate, proof.campaignId);
  data.equal(proof.npcUuid, actual.npcUuid);
  data.equal(now, actual.campaignTimestamp);
  const { start, exact, end, deadline } = deathTimerInterval(detail, now);
  const requiredDeadline = readNpcFunctionalDuplicateRequiredDeathDeadline(currentDuplicate);
  if (requiredDeadline !== null) {
    const required = decimal(requiredDeadline);
    if (end * required.denominator < required.numerator * exact.denominator)
      return fail(
        `preserved death deadline ${deadline} precedes replacement recovery deadline ${requiredDeadline}`,
      );
  }
  const duplicateMultiplierAtEntry = detail.duplicateAtEntry.sources.length === 0 ? 1 : 4;
  const deathTimer: NpcFormalDeathTimer = {
    effectInstanceId: detail.effectInstanceId,
    effectTypeId: 'EFF-LIFE-DEATH_TIMER',
    familyCode: 'FAM-LIFECYCLE',
    targetActorId: proof.npcUuid,
    targetRegionId: null,
    sourceRuleIds: ['CORE-152', 'CORE-153', 'CORE-154'],
    sourceEntityId: null,
    sourceInstanceId: null,
    sourceSnapshot: null,
    sourceLifecyclePolicy: 'SOURCE_SPECIFIC',
    stackingKey: 'CORE-153',
    payload: {
      assignedByGM: true,
      rollFact: detail.rollFact,
      duplicateMultiplierAtEntry,
      duplicateAtEntry: detail.duplicateAtEntry,
    },
    magnitude: null,
    tags: ['LIFECYCLE'],
    createdAt: proof.createdAt,
    startsAt: { campaignTimestampExact: String(start) },
    expiresAt: { campaignTimestampExact: deadline },
    remainingExact: exactText(end - BigInt(now) * exact.denominator, exact.scale),
    durationUnit: 'MINUTE',
    tickSchedule: null,
    lastTickAt: null,
    status: 'ACTIVE',
    revision: 1,
    removalReason: null,
    createdBy: 'GM',
    variantKey: 'CORE-153',
    aggregateKey: `EFF-LIFE-DEATH_TIMER|${proof.npcUuid}`,
    deathDisposition: 'TERMINATE_ON_DEATH',
  };
  return data.freeze({
    anchor: proof,
    lifeKind: 'SEVERELY_WOUNDED',
    dead: false,
    severeWound: true,
    abstractVitalSystemDamaged: true,
    deathTimerOrNull: deathTimer,
    restrictionOrNull:
      RESTRICTIONS[actual.sources.length === 0 ? 'PRF-SEVERE-PC' : 'PRF-SEVERE-DUPLICATE'],
  });
}
function issue(
  state: NpcFormalLifeState,
  context: NpcFormalLifeContext,
  current: NpcFunctionalDuplicateProof | null,
): NpcFormalLifeState {
  boundaries.set(
    state,
    data.freeze({
      state,
      context: { ...context },
      currentDuplicateSnapshotOrNull:
        current === null ? null : readNpcFunctionalDuplicateProof(current),
    }),
  );
  return state;
}
/** This assigns current state. It does not deal damage, consume protection/OE or fire death triggers. */
export function createNpcFormalLifeState(
  catalog: NpcFormalLifeCatalog,
  input: NpcFormalLifeHistoryAnchor,
  context: NpcFormalLifeContext,
  entryDuplicate: NpcFunctionalDuplicateProof | null,
): NpcFormalLifeState {
  const proof = anchor(catalog, input, entryDuplicate);
  if (proof.severeWoundOrNull !== null)
    data.equal(
      proof.severeWoundOrNull.calendarAnchor.campaignTimestamp,
      context.campaignTimestampOrNull,
    );
  return issue(build(catalog, proof, context, entryDuplicate), context, entryDuplicate);
}
/** Original preparation and entry proof come from owning history, independently of candidate bytes. */
export function validateNpcFormalLifeState(
  catalog: NpcFormalLifeCatalog,
  candidate: unknown,
  original: NpcFormalLifeHistoryAnchor,
  context: NpcFormalLifeContext,
  entryDuplicate: NpcFunctionalDuplicateProof | null,
  currentDuplicate: NpcFunctionalDuplicateProof | null,
): NpcFormalLifeState {
  const expected = build(
    catalog,
    anchor(catalog, original, entryDuplicate),
    context,
    currentDuplicate,
  );
  data.equal(expected, candidate);
  return issue(expected, context, currentDuplicate);
}
/** N+1 derives current restrictions/remainder without modifying the saved original boundary. */
export function deriveNpcRetainedFormalLifeState(
  catalog: NpcFormalLifeCatalog,
  original: NpcFormalLifeHistoryAnchor,
  context: NpcFormalLifeContext,
  entryDuplicate: NpcFunctionalDuplicateProof | null,
  currentDuplicate: NpcFunctionalDuplicateProof | null,
): NpcFormalLifeState {
  return issue(
    build(catalog, anchor(catalog, original, entryDuplicate), context, currentDuplicate),
    context,
    currentDuplicate,
  );
}
/** Ordinary N+1 is neither CORE-156 reanimation nor resurrection. */
export function assertNpcFormalLifeTransition(
  catalog: NpcFormalLifeCatalog,
  previous: NpcFormalLifeKind | null,
  requested: NpcFormalLifeKind,
): void {
  base(catalog);
  const next = lifeKind(requested);
  if (previous === null) return;
  const before = lifeKind(previous);
  if ((before === 'DEAD' && next !== 'DEAD') || (before === 'SEVERELY_WOUNDED' && next === 'ALIVE'))
    fail('ordinary editing cannot revive this independently saved life state');
}
