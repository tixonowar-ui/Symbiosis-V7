import type { NpcSymbiontInput } from './types.js';
import type { NpcInitialTraumaCalendarAnchor } from './initial-trauma.js';
import { npcPublicationData as data } from './inventory-publication.js';
import {
  deriveNpcMonsterPassiveProfile,
  deriveNpcChimeraSlotProgress,
  assertNpcMonsterAdditionalSlots,
  type NpcChimeraSlotProof,
  type NpcMonsterPassiveCatalog,
} from './monster-passive-profile.js';
import {
  deriveNpcSymbiontNativeProfile,
  validateNpcNativeCurrentOe,
  type NpcSymbiontNativeCatalog,
} from './symbiont-native-profile.js';

export type NpcHpMode = 'HUNGER' | 'REGENERATION';
export interface NpcHpModeInstant {
  readonly campaignTimestampExact: string;
}
export interface NpcHpModeEffectInstance {
  readonly effectInstanceId: string;
  readonly effectTypeId: 'EFF-FORM-STANCE';
  readonly familyCode: 'FAM-FORM_MODE';
  readonly targetActorId: string;
  readonly targetRegionId: null;
  readonly sourceRuleIds: readonly string[];
  readonly sourceEntityId: string;
  readonly sourceInstanceId: string;
  readonly sourceSnapshot: null;
  readonly sourceLifecyclePolicy: 'SOURCE_SPECIFIC';
  readonly stackingKey: 'MON-023' | 'SYM-034';
  readonly payload: Readonly<{ mode: NpcHpMode }>;
  readonly magnitude: null;
  readonly tags: readonly [];
  readonly createdAt: string;
  readonly startsAt: NpcHpModeInstant;
  readonly expiresAt: NpcHpModeInstant;
  readonly remainingExact: string;
  readonly durationUnit: 'MINUTE';
  readonly tickSchedule: null;
  readonly lastTickAt: null;
  readonly status: 'ACTIVE';
  readonly revision: number;
  readonly removalReason: null;
  readonly createdBy: 'GM';
  readonly variantKey: 'MON-023' | 'SYM-034';
  readonly aggregateKey: string;
  readonly deathDisposition: 'SOURCE_SPECIFIC';
}
/** Actual owning confirmation and original calendar, supplied independently of the effect. */
export interface NpcHpModeHistoryAnchor {
  readonly effectInstanceId: string;
  readonly npcUuid: string;
  readonly sourceInstanceId: string;
  readonly mode: NpcHpMode;
  readonly initialStateConfirmationId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly calendarAnchor: NpcInitialTraumaCalendarAnchor;
  readonly remainingMinutes: string;
  readonly revision: number;
}
/**
 * The owner proves actual membership, current availability and historical completion leaves.
 * This component checks native trees and MON-007 capacity; it is not a replacement for the
 * complete composition/current-effects fold or an authority verifier for submitted JSON.
 */
export interface NpcHpModeSourceEvidence {
  readonly npcUuid: string;
  readonly compositionFactId: string;
  readonly raceCode: 'PURE' | 'FREE' | 'UNITED';
  readonly monsterOrNull: NpcSymbiontInput | null;
  readonly ordinarySymbionts: readonly NpcSymbiontInput[];
  readonly unavailableSourceInstanceIds: readonly string[];
  readonly chimeraSlotProofOrNull: NpcChimeraSlotProof | null;
  readonly previousChimeraSlotProofOrNull: NpcChimeraSlotProof | null;
}
/** A retained actual CQA-008 lost-HP portion, not a synthesized past attack or healing tick. */
export interface NpcRegenerationHealingTimer {
  readonly healingTimerId: string;
  readonly targetActorId: string;
  readonly sourceEffectInstanceId: string;
  readonly damageFactId: string;
  readonly lostHP: number;
  readonly traumaInstanceIds: readonly string[];
  readonly createdAt: string;
  readonly calendarAnchor: NpcInitialTraumaCalendarAnchor;
  readonly remainingMinutes: string;
  readonly deadline: NpcHpModeInstant;
}
export interface NpcCombinedHpModeComponent {
  readonly kind: 'HUNGER_REGENERATION_HP_COMPONENT';
  readonly baseMaxHP: number;
  readonly hunger: boolean;
  readonly regeneration: boolean;
  readonly maxHP: number;
  readonly minHP: 0 | 1;
  readonly currentHP: number;
  readonly hungerStatMultiplier: 1 | 2;
  readonly modes: readonly NpcHpModeEffectInstance[];
  readonly healingTimers: readonly NpcRegenerationHealingTimer[];
}
export interface NpcHpModeStatProfile {
  readonly kind: 'SOURCE_BOUND_HP_MODE_STATS';
  readonly source: NpcHpModeSourceEvidence;
  readonly campaignTimestamp: number;
  readonly modes: readonly NpcHpModeEffectInstance[];
  readonly hungerStatMultiplier: 1 | 2;
}
declare const catalogBrand: unique symbol;
export interface NpcCombinedHpModeCatalog {
  readonly [catalogBrand]: true;
}
interface Context {
  readonly native: NpcSymbiontNativeCatalog;
  readonly monsters: NpcMonsterPassiveCatalog;
  readonly exactHP: number;
  readonly maximumMinutes: number;
  readonly healingMinutes: number;
}
const contexts = new WeakMap<NpcCombinedHpModeCatalog, Context>();
const components = new WeakMap<NpcCombinedHpModeComponent, NpcCombinedHpModeCatalog>();
const componentOwners = new WeakMap<object, NpcHpModeSourceEvidence>();
const statProfiles = new WeakSet<NpcHpModeStatProfile>();
const componentStats = new WeakMap<NpcCombinedHpModeComponent, NpcHpModeStatProfile>();

export function readNpcHpModeStatProfile(value: unknown): NpcHpModeStatProfile {
  if (
    value === null ||
    typeof value !== 'object' ||
    !statProfiles.has(value as NpcHpModeStatProfile)
  )
    return fail('issued HP mode stat profile required');
  return value as NpcHpModeStatProfile;
}
export function npcHpModeStatProfileForComponent(
  component: NpcCombinedHpModeComponent,
): NpcHpModeStatProfile {
  return componentStats.get(component) ?? fail('issued HP mode component required');
}

/** Internal builders may widen HP bounds only with an issued, source-checked component. */
export function readNpcCombinedHpModeBoundary(value: unknown): Readonly<{
  npcUuid: string;
  baseMaxHP: number;
  currentHP: number;
  maxHP: number;
  source: NpcHpModeSourceEvidence;
}> {
  if (value === null || typeof value !== 'object') return fail('issued HP mode component required');
  const source = componentOwners.get(value);
  if (source === undefined) return fail('issued HP mode component required');
  const component = value as NpcCombinedHpModeComponent;
  return Object.freeze({
    npcUuid: source.npcUuid,
    baseMaxHP: component.baseMaxHP,
    currentHP: component.currentHP,
    maxHP: component.maxHP,
    source,
  });
}
const MODE_SOURCE = {
  HUNGER: { species: 'CHIMERA', rule: 'MON-023', rules: ['MON-023', 'MON-024', 'CQA-045'] },
  REGENERATION: { species: 'WEAVER', rule: 'SYM-034', rules: ['SYM-034', 'CQA-008'] },
} as const;
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
function fail(detail: string): never {
  throw new Error(`NPC combined HP modes: ${detail}`);
}
function integer(value: unknown, minimum = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : fail('safe integer required');
}
function hp(value: unknown): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : fail('finite nonnegative HP required');
}
function mode(value: unknown): NpcHpMode {
  return value === 'HUNGER' || value === 'REGENERATION' ? value : fail('unknown HP mode');
}
function stamp(value: unknown): string {
  const text = data.text(value);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(text) ||
    !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString() !== text
  )
    return fail('saved canonical audit timestamp required');
  return text;
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
function duration(value: unknown, maximum: number): string {
  const d = decimal(value);
  if (d.numerator <= 0n || d.numerator > BigInt(maximum) * d.denominator)
    return fail('remaining time exceeds the source lifetime');
  return value as string;
}
function deadline(start: number, remaining: string): NpcHpModeInstant {
  const d = decimal(remaining),
    n = BigInt(start) * d.denominator + d.numerator;
  if (n > BigInt(Number.MAX_SAFE_INTEGER) * d.denominator) return fail('calendar overflow');
  const digits = n.toString().padStart(d.scale + 1, '0');
  const exact = d.scale === 0 ? digits : digits.slice(0, -d.scale) + '.' + digits.slice(-d.scale);
  return Object.freeze({ campaignTimestampExact: exact });
}
function calendar(value: unknown): NpcInitialTraumaCalendarAnchor {
  const row = data.record(value);
  if (row.kind === 'PRE_START_INITIAL') {
    data.record(value, ['kind', 'campaignTimestamp', 'lobbySnapshotRevision']);
    const revision = data.text(row.lobbySnapshotRevision);
    if (!/^[0-9a-f]{64}$/u.test(revision)) return fail('exact lobby snapshot hash required');
    return {
      kind: 'PRE_START_INITIAL',
      campaignTimestamp: integer(row.campaignTimestamp),
      lobbySnapshotRevision: revision,
    };
  }
  if (row.kind === 'CURRENT_CAMPAIGN') {
    data.record(value, ['kind', 'campaignTimestamp', 'stateRevision']);
    return {
      kind: 'CURRENT_CAMPAIGN',
      campaignTimestamp: integer(row.campaignTimestamp),
      stateRevision: integer(row.stateRevision),
    };
  }
  return fail('confirmed calendar anchor required');
}
function one(value: unknown, key: string, id: string): Record<string, unknown> {
  const found = data
    .array(value)
    .map((r) => data.record(r))
    .filter((r) => r[key] === id);
  return found.length === 1 ? found[0]! : fail(`exact source ${id} required`);
}
/** EFF-FORM-STANCE is a SOURCE_SPECIFIC container, not a new SYM-034 registry definition. */
export function createNpcCombinedHpModeCatalog(
  source: Readonly<{
    native: NpcSymbiontNativeCatalog;
    monsters: NpcMonsterPassiveCatalog;
    rules: unknown;
    effectTypes: unknown;
    runtimeContracts: unknown;
    timerPolicies: unknown;
    npc016: unknown;
  }>,
): NpcCombinedHpModeCatalog {
  const definition = one(source.effectTypes, 'EffectTypeID', 'EFF-FORM-STANCE');
  for (const [key, expected] of Object.entries({
    Automation: 'SOURCE_SPECIFIC',
    FamilyCode: 'FAM-FORM_MODE',
    'Schema status': 'DEFINED',
    'Stack policy': 'SOURCE_SPECIFIC_EXCLUSIVE',
    'State bucket': 'currentEffects',
    'Timer policy': 'SOURCE_SPECIFIC_OR_EXPLICIT',
    Семантика: 'Условия совместимости определяет источник',
    'Rule refs': 'SYM-173; MON-023',
  }))
    data.equal(expected, definition[key]);
  const rule = (id: string) => {
    const row = one(source.rules, 'Rule ID', id);
    data.equal('Активно', row['Статус']);
    return data.text(row['Итоговый алгоритм']);
  };
  const regeneration = rule('CQA-008');
  const exact = /максимум и текущее значение HP устанавливаются равными (\d+)/u.exec(regeneration);
  const durationMatch = /длительность R(\d+)\/(\d+) ходов/u.exec(rule('MON-023'));
  if (
    exact === null ||
    durationMatch === null ||
    !regeneration.includes('но не ниже 1') ||
    !regeneration.includes('отдельный таймер на два личных хода') ||
    !rule('CQA-045').includes('ceil(текущего удвоенного currentHP/2)') ||
    !rule('MON-024').includes('с округлением вверх') ||
    !rule('SYM-034').includes('незавершённые двухходовые таймеры продолжаются') ||
    !rule('MON-023').includes('удвоить S,D,M,Z и текущий/максимальный HP.')
  )
    return fail('source pair arithmetic/lifetime differs');
  const exactHP = integer(Number(exact[1]), 1);
  const maximumMinutes = integer(Number(durationMatch[1]) / Number(durationMatch[2]), 1);
  data.equal(
    '1 оставшийся ход = 1 минута',
    one(source.timerPolicies, 'PolicyID', 'TIME-007')['Алгоритм / инвариант'],
  );
  data.equal(
    'Округление вверх допустимо только для отображения',
    one(source.timerPolicies, 'PolicyID', 'TIME-008')['Алгоритм / инвариант'],
  );
  const fields = data
    .array(source.runtimeContracts)
    .map((r) => data.record(r))
    .filter((r) => r.Entity === 'EffectInstance');
  if (
    fields.length !== FIELDS.length ||
    FIELDS.some((field) => fields.filter((r) => r.Field === field).length !== 1)
  )
    return fail('Effects/12 field set differs');
  const acceptance = data.array(data.record(source.npc016).acceptanceCriteria).map(data.text);
  const pair = acceptance.filter((text) => text.startsWith('ADR0082 / #227:'));
  if (
    pair.length !== 1 ||
    !pair[0]!.includes(`maxHP=${exactHP} при Regeneration; иначе maxHP=2×H при Hunger; иначе H`) ||
    !acceptance.some(
      (text) => text.includes('H300/currentHP200') && text.includes('1000/400→300/300'),
    )
  )
    return fail('accepted pair-only source amendment required');
  const catalog = Object.freeze({}) as NpcCombinedHpModeCatalog;
  contexts.set(catalog, {
    native: source.native,
    monsters: source.monsters,
    exactHP,
    maximumMinutes,
    healingMinutes: 2,
  });
  return catalog;
}
function context(catalog: NpcCombinedHpModeCatalog): Context {
  return contexts.get(catalog) ?? fail('issued HP mode catalog required');
}
export function npcHpModeMaximumRemainingMinutes(catalog: NpcCombinedHpModeCatalog): string {
  return String(context(catalog).maximumMinutes);
}
export function validateNpcHpModeRemainingMinutes(
  catalog: NpcCombinedHpModeCatalog,
  value: unknown,
): string {
  return duration(value, context(catalog).maximumMinutes);
}
function sourceInstances(catalog: NpcCombinedHpModeCatalog, evidence: NpcHpModeSourceEvidence) {
  const c = context(catalog),
    row = data.record(evidence, [
      'npcUuid',
      'compositionFactId',
      'raceCode',
      'monsterOrNull',
      'ordinarySymbionts',
      'unavailableSourceInstanceIds',
      'chimeraSlotProofOrNull',
      'previousChimeraSlotProofOrNull',
    ]);
  const npcUuid = data.uuid(row.npcUuid);
  data.text(row.compositionFactId);
  if (row.raceCode !== 'UNITED' && row.raceCode !== 'FREE' && row.raceCode !== 'PURE')
    return fail('unknown race');
  const ordinary = data.array(row.ordinarySymbionts).map((raw) => {
    const value = data.record(raw, [
      'symbiontInstanceId',
      'speciesKey',
      'targetLevel',
      'learnedNodeRefs',
      'binding',
      'currentOE',
    ]);
    const native = deriveNpcSymbiontNativeProfile(c.native, {
      symbiontInstanceId: value.symbiontInstanceId,
      speciesKey: value.speciesKey,
      targetLevel: value.targetLevel,
      learnedNodeRefs: value.learnedNodeRefs,
      binding: value.binding,
    });
    validateNpcNativeCurrentOe(native, value.currentOE);
    if (['CHIMERA', 'PUPPETEER', 'PLAGUE_DOCTOR'].includes(native.speciesKey))
      return fail('ordinary member cannot hide another monster');
    return native;
  });
  if (row.raceCode === 'PURE' && (ordinary.length !== 0 || row.monsterOrNull !== null))
    return fail('PURE cannot own these sources');
  const monster =
    row.monsterOrNull === null
      ? null
      : deriveNpcMonsterPassiveProfile(c.monsters, {
          raceCode: row.raceCode,
          symbiont: row.monsterOrNull,
        });
  if (
    (monster === null &&
      (row.chimeraSlotProofOrNull !== null || row.previousChimeraSlotProofOrNull !== null)) ||
    (row.chimeraSlotProofOrNull === null && row.previousChimeraSlotProofOrNull !== null)
  )
    return fail('orphan Chimera history');
  if (monster !== null && (ordinary.length !== 0 || row.chimeraSlotProofOrNull !== null)) {
    const progress =
      row.chimeraSlotProofOrNull === null
        ? null
        : deriveNpcChimeraSlotProgress(
            c.monsters,
            row.chimeraSlotProofOrNull,
            row.previousChimeraSlotProofOrNull,
          );
    assertNpcMonsterAdditionalSlots(
      monster,
      progress,
      ordinary.map(() => 1),
    );
  }
  const members = [...ordinary, ...(monster === null ? [] : [monster.input])];
  const ids = members.map((m) => data.uuid(m.symbiontInstanceId));
  if (
    new Set(ids).size !== ids.length ||
    new Set(members.map((m) => m.speciesKey)).size !== members.length
  )
    return fail('ambiguous duplicate source membership');
  const unavailable = data.array(row.unavailableSourceInstanceIds).map(data.uuid);
  if (
    new Set(unavailable).size !== unavailable.length ||
    unavailable.some((id) => !ids.includes(id))
  )
    return fail('foreign/duplicate current source restriction');
  return { npcUuid, members: members.filter((m) => !unavailable.includes(m.symbiontInstanceId)) };
}
function anchor(catalog: NpcCombinedHpModeCatalog, value: unknown): NpcHpModeHistoryAnchor {
  const row = data.record(value, [
    'effectInstanceId',
    'npcUuid',
    'sourceInstanceId',
    'mode',
    'initialStateConfirmationId',
    'reason',
    'createdAt',
    'calendarAnchor',
    'remainingMinutes',
    'revision',
  ]);
  return data.freeze({
    effectInstanceId: data.uuid(row.effectInstanceId),
    npcUuid: data.uuid(row.npcUuid),
    sourceInstanceId: data.uuid(row.sourceInstanceId),
    mode: mode(row.mode),
    initialStateConfirmationId: data.text(row.initialStateConfirmationId),
    reason: data.text(row.reason),
    createdAt: stamp(row.createdAt),
    calendarAnchor: calendar(row.calendarAnchor),
    remainingMinutes: duration(row.remainingMinutes, context(catalog).maximumMinutes),
    revision: integer(row.revision, 1),
  });
}
function build(
  catalog: NpcCombinedHpModeCatalog,
  proof: NpcHpModeHistoryAnchor,
  source: NpcHpModeSourceEvidence,
  now: number,
): NpcHpModeEffectInstance {
  const checked = sourceInstances(catalog, source),
    rule = MODE_SOURCE[proof.mode];
  const member = checked.members.find((m) => m.symbiontInstanceId === proof.sourceInstanceId);
  if (
    proof.npcUuid !== checked.npcUuid ||
    member?.speciesKey !== rule.species ||
    !member.learnedNodeRefs.includes(rule.rule)
  )
    return fail('foreign, unavailable or unlearned mode source');
  const start = proof.calendarAnchor.campaignTimestamp,
    expiresAt = deadline(start, proof.remainingMinutes);
  const end = decimal(expiresAt.campaignTimestampExact);
  if (integer(now) < start || BigInt(now) * end.denominator >= end.numerator)
    return fail('current calendar outside saved mode lifetime');
  return data.freeze({
    effectInstanceId: proof.effectInstanceId,
    effectTypeId: 'EFF-FORM-STANCE',
    familyCode: 'FAM-FORM_MODE',
    targetActorId: proof.npcUuid,
    targetRegionId: null,
    sourceRuleIds: [...rule.rules],
    sourceEntityId: proof.npcUuid,
    sourceInstanceId: proof.sourceInstanceId,
    sourceSnapshot: null,
    sourceLifecyclePolicy: 'SOURCE_SPECIFIC',
    stackingKey: rule.rule,
    payload: { mode: proof.mode },
    magnitude: null,
    tags: [],
    createdAt: proof.createdAt,
    startsAt: { campaignTimestampExact: String(start) },
    expiresAt,
    remainingExact: proof.remainingMinutes,
    durationUnit: 'MINUTE',
    tickSchedule: null,
    lastTickAt: null,
    status: 'ACTIVE',
    revision: proof.revision,
    removalReason: null,
    createdBy: 'GM',
    variantKey: rule.rule,
    aggregateKey: `EFF-FORM-STANCE|${rule.rule}|null`,
    deathDisposition: 'SOURCE_SPECIFIC',
  });
}
/** Initial current state only: no activation, OE spend, roll, HP doubling, damage or healing. */
export function createNpcInitialHpModeEffect(
  catalog: NpcCombinedHpModeCatalog,
  suppliedProof: NpcHpModeHistoryAnchor,
  source: NpcHpModeSourceEvidence,
): NpcHpModeEffectInstance {
  const proof = anchor(catalog, suppliedProof);
  if (proof.revision !== 1) return fail('new initial mode starts at revision one');
  return build(catalog, proof, source, proof.calendarAnchor.campaignTimestamp);
}
/** Actual original proof is separate from the candidate; N+1 never recreates the timer at now. */
export function validateNpcHpModeEffect(
  catalog: NpcCombinedHpModeCatalog,
  candidate: unknown,
  suppliedProof: NpcHpModeHistoryAnchor,
  source: NpcHpModeSourceEvidence,
  now: number,
): NpcHpModeEffectInstance {
  data.record(candidate, FIELDS);
  const expected = build(catalog, anchor(catalog, suppliedProof), source, now);
  data.equal(expected, candidate);
  return expected;
}
function healing(
  catalog: NpcCombinedHpModeCatalog,
  values: unknown,
  proven: readonly NpcRegenerationHealingTimer[],
  npcUuid: string,
): readonly NpcRegenerationHealingTimer[] {
  // The owning reader proves each damage fact and original source effect, including expired modes.
  data.equal(proven, values);
  const seen = new Set<string>();
  return data.freeze(
    data.array(values).map((value) => {
      const r = data.record(value, [
        'healingTimerId',
        'targetActorId',
        'sourceEffectInstanceId',
        'damageFactId',
        'lostHP',
        'traumaInstanceIds',
        'createdAt',
        'calendarAnchor',
        'remainingMinutes',
        'deadline',
      ]);
      const id = data.uuid(r.healingTimerId),
        target = data.uuid(r.targetActorId),
        damageFactId = data.text(r.damageFactId);
      if (target !== npcUuid || seen.has(id) || seen.has(damageFactId))
        return fail('foreign/repeated healing history');
      seen.add(id);
      seen.add(damageFactId);
      const lostHP = hp(r.lostHP);
      if (lostHP === 0) return fail('healing requires an actual lost HP portion');
      const start = calendar(r.calendarAnchor),
        remaining = duration(r.remainingMinutes, context(catalog).healingMinutes);
      const due = deadline(start.campaignTimestamp, remaining);
      data.equal(due, r.deadline);
      const traumaInstanceIds = data.array(r.traumaInstanceIds).map(data.uuid);
      if (new Set(traumaInstanceIds).size !== traumaInstanceIds.length)
        return fail('repeated trauma reference');
      return {
        healingTimerId: id,
        targetActorId: target,
        sourceEffectInstanceId: data.uuid(r.sourceEffectInstanceId),
        damageFactId,
        lostHP,
        traumaInstanceIds,
        createdAt: stamp(r.createdAt),
        calendarAnchor: start,
        remainingMinutes: remaining,
        deadline: due,
      };
    }),
  );
}
function maximum(
  catalog: NpcCombinedHpModeCatalog,
  base: number,
  hunger: boolean,
  regeneration: boolean,
): number {
  integer(base, 1);
  return regeneration ? context(catalog).exactHP : integer(hunger ? base * 2 : base, 1);
}
/** Source/history validation without HP gating, for the later CORE-079 multiplication phase. */
export function deriveNpcHpModeStatProfile(
  catalog: NpcCombinedHpModeCatalog,
  input: Readonly<{
    modes: readonly NpcHpModeEffectInstance[];
    histories: readonly NpcHpModeHistoryAnchor[];
    source: NpcHpModeSourceEvidence;
    campaignTimestamp: number;
  }>,
): NpcHpModeStatProfile {
  data.record(input, ['modes', 'histories', 'source', 'campaignTimestamp']);
  sourceInstances(catalog, input.source);
  integer(input.campaignTimestamp);
  const histories = data.array(input.histories).map((p) => anchor(catalog, p));
  const ids = new Set<string>(),
    modes = new Set<NpcHpMode>();
  const effects = data.array(input.modes).map((value) => {
    const raw = data.record(value, FIELDS),
      matches = histories.filter((h) => h.effectInstanceId === raw.effectInstanceId);
    if (matches.length !== 1) return fail('exact independent mode history required');
    const effect = validateNpcHpModeEffect(
      catalog,
      value,
      matches[0]!,
      input.source,
      input.campaignTimestamp,
    );
    if (ids.has(effect.effectInstanceId) || modes.has(effect.payload.mode))
      return fail('duplicate pair mode/identity');
    ids.add(effect.effectInstanceId);
    modes.add(effect.payload.mode);
    return effect;
  });
  if (effects.length !== histories.length) return fail('orphan mode history');
  const result: NpcHpModeStatProfile = data.freeze({
    kind: 'SOURCE_BOUND_HP_MODE_STATS',
    source: structuredClone(input.source),
    campaignTimestamp: input.campaignTimestamp,
    modes: effects,
    hungerStatMultiplier: modes.has('HUNGER') ? 2 : 1,
  });
  statProfiles.add(result);
  return result;
}
export function deriveNpcCombinedHpModes(
  catalog: NpcCombinedHpModeCatalog,
  input: Readonly<{
    baseMaxHP: number;
    currentHP: number;
    modes: readonly NpcHpModeEffectInstance[];
    histories: readonly NpcHpModeHistoryAnchor[];
    source: NpcHpModeSourceEvidence;
    campaignTimestamp: number;
    healingTimers: readonly NpcRegenerationHealingTimer[];
    provenHealingTimers: readonly NpcRegenerationHealingTimer[];
  }>,
): NpcCombinedHpModeComponent {
  data.record(input, [
    'baseMaxHP',
    'currentHP',
    'modes',
    'histories',
    'source',
    'campaignTimestamp',
    'healingTimers',
    'provenHealingTimers',
  ]);
  const profile = deriveNpcHpModeStatProfile(catalog, {
    modes: input.modes,
    histories: input.histories,
    source: input.source,
    campaignTimestamp: input.campaignTimestamp,
  });
  const hunger = profile.hungerStatMultiplier === 2,
    regeneration = profile.modes.some((mode) => mode.payload.mode === 'REGENERATION');
  const maxHP = maximum(catalog, input.baseMaxHP, hunger, regeneration),
    minHP = regeneration ? 1 : 0;
  const currentHP = hp(input.currentHP);
  if (currentHP < minHP || currentHP > maxHP)
    return fail('initial current HP outside source-derived bounds');
  const timers = healing(
    catalog,
    input.healingTimers,
    input.provenHealingTimers,
    data.uuid(profile.source.npcUuid),
  );
  const result: NpcCombinedHpModeComponent = data.freeze({
    kind: 'HUNGER_REGENERATION_HP_COMPONENT',
    baseMaxHP: input.baseMaxHP,
    hunger,
    regeneration,
    maxHP,
    minHP,
    currentHP,
    hungerStatMultiplier: hunger ? 2 : 1,
    modes: profile.modes,
    healingTimers: timers,
  });
  components.set(result, catalog);
  componentOwners.set(result, data.freeze(structuredClone(input.source)));
  componentStats.set(result, profile);
  return result;
}
/** Source arithmetic for a separately proven successful activation/removal; not an authoring command. */
export function projectNpcHpModeTransition(
  catalog: NpcCombinedHpModeCatalog,
  before: NpcCombinedHpModeComponent,
  event: 'ACTIVATE_HUNGER' | 'ACTIVATE_REGENERATION' | 'REMOVE_HUNGER' | 'REMOVE_REGENERATION',
): Readonly<{
  maxHP: number;
  currentHP: number;
  hunger: boolean;
  regeneration: boolean;
  healingTimers: readonly NpcRegenerationHealingTimer[];
}> {
  if (components.get(before) !== catalog) return fail('issued current HP component required');
  let hunger = before.hunger,
    regeneration = before.regeneration,
    currentHP = before.currentHP;
  if (event === 'ACTIVATE_HUNGER') {
    if (hunger) return fail('Hunger already active');
    hunger = true;
    currentHP *= 2;
  } else if (event === 'ACTIVATE_REGENERATION') {
    if (regeneration) return fail('Regeneration already active');
    regeneration = true;
    currentHP = context(catalog).exactHP;
  } else if (event === 'REMOVE_HUNGER') {
    if (!hunger) return fail('Hunger is absent');
    hunger = false;
    currentHP = Math.ceil(currentHP / 2);
  } else if (event === 'REMOVE_REGENERATION') {
    if (!regeneration) return fail('Regeneration is absent');
    regeneration = false;
  } else return fail('unknown pair transition');
  const maxHP = maximum(catalog, before.baseMaxHP, hunger, regeneration);
  return data.freeze({
    maxHP,
    currentHP: Math.min(currentHP, maxHP),
    hunger,
    regeneration,
    healingTimers: before.healingTimers,
  });
}
