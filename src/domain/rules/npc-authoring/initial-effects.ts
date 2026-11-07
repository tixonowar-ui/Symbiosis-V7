import type { StatCode } from '@generated/types/character.js';
import type { DiseaseId } from '@generated/types/effects.js';

import type {
  NpcCalendarInstant,
  NpcDerivedCapabilities,
  NpcDiseasePayload,
  NpcModifierComponent,
  NpcPoisonPayload,
} from './effect-types.js';

export interface NpcDiseaseDefinition {
  readonly diseaseId: DiseaseId;
  readonly nameRu: string;
  readonly status: 'ACTIVE' | 'TRACE_ONLY';
  readonly modifiers: readonly NpcModifierComponent[];
  readonly dailyDamageOrNull: number | null;
}

export interface NpcInitialEffectCatalog {
  readonly diseases: readonly NpcDiseaseDefinition[];
  readonly alcohol: Readonly<{ damagePerHour: number; durationHoursOffset: number }>;
}

/** No operation/intake/RNG is executed; the host must bind an actual new assignment. */
export interface NpcNewFormalAssignment {
  readonly kind: 'NEW_FORMAL_ASSIGNMENT';
  readonly campaignTimestamp: number;
}

/** An absent clock can establish NO_EFFECT, but cannot anchor a positive-duration state. */
export type NpcNewAlcoholAssignment =
  NpcNewFormalAssignment | Readonly<{ kind: 'NEW_FORMAL_ASSIGNMENT'; campaignTimestamp?: never }>;

export type NpcNewAlcoholParameters =
  | Readonly<{ kind: 'NO_EFFECT'; sourceRuleId: 'CORE-110'; reason: 'NON_POSITIVE_DURATION' }>
  | Readonly<{
      kind: 'PARAMETERS_REQUIRE_SCHEDULE';
      payload: NpcPoisonPayload;
      magnitude: number;
      startsAt: NpcCalendarInstant;
      expiresAt: NpcCalendarInstant;
      durationUnit: 'HOUR';
      remainingExact: string;
      blocker: 'FIRST_TICK_ANCHOR_NOT_YET_PROVEN';
    }>;

/** ADR 0082 / #224 closes the period origin only for this CORE-110 variant. */
export type NpcNewAlcoholSchedule =
  | Extract<NpcNewAlcoholParameters, { kind: 'NO_EFFECT' }>
  | Readonly<{
      kind: 'ACTIVE_PARAMETERS';
      payload: NpcPoisonPayload;
      magnitude: number;
      startsAt: NpcCalendarInstant;
      expiresAt: NpcCalendarInstant;
      durationUnit: 'HOUR';
      remainingExact: string;
      tickSchedule: Readonly<{
        phase: 'COSTS_AND_TICKS';
        period: Readonly<{ amount: 1; unit: 'HOUR' }>;
        nextTickAt: NpcCalendarInstant;
      }>;
      lastTickAt: null;
    }>;

type Row = Readonly<Record<string, unknown>>;
const DISEASE_IDS = [
  'DIS-POISONING',
  'DIS-RHINITIS',
  'DIS-FEVER',
  'DIS-SCABIES',
  'DIS-PNEUMONIA',
  'DIS-MIGRAINE',
  'DIS-FLATULENCE',
  'DIS-SKIN_GROWTHS',
  'DIS-ITCHY_SKIN_GROWTHS',
  'DIS-PESTILENCE',
] as const satisfies readonly DiseaseId[];
const STAT_CODES = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const satisfies readonly StatCode[];
// Unit conversion, not a gameplay duration: the confirmed calendar scale stores minutes.
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

function fail(path: string, detail: string): never {
  throw new Error(`NPC initial effects ${path}: ${detail}`);
}

function object(value: unknown, path: string, exactKeys?: readonly string[]): Row {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail(path, 'expected a plain data object');
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string') ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (entry) => !entry.enumerable || !Object.hasOwn(entry, 'value'),
    )
  )
    return fail(path, 'symbol/accessor/nonenumerable fields are forbidden');
  if (
    exactKeys !== undefined &&
    (keys.length !== exactKeys.length || exactKeys.some((key) => !Object.hasOwn(value, key)))
  )
    return fail(path, 'fields must be exact');
  return value as Row;
}

function sourceRows(value: unknown, path: string): readonly Row[] {
  if (!Array.isArray(value) || value.length === 0)
    return fail(path, 'expected nonempty source rows');
  return value.map((entry, index) => object(entry, `${path}[${index}]`));
}

function componentsArray(value: unknown, expectedLength: number): readonly unknown[] {
  const path = 'modifierComponents';
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail(path, 'expected a plain data array');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (length === undefined || !Object.hasOwn(length, 'value') || length.value !== expectedLength)
    return fail(path, 'source component count differs');
  const keys = Reflect.ownKeys(value);
  const indices = Array.from({ length: expectedLength }, (_, index) => String(index));
  if (
    keys.length !== expectedLength + 1 ||
    keys.some((key) => key !== 'length' && (typeof key !== 'string' || !indices.includes(key)))
  )
    return fail(path, 'array fields must be exact indices and length');
  return Object.freeze(
    indices.map((key) => {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
        return fail(path, 'array indices must be enumerable own data fields');
      return descriptor.value as unknown;
    }),
  );
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) return fail(path, 'expected nonempty text');
  return value;
}

function integer(value: unknown, minimum: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    return fail(path, `expected safe integer >= ${minimum}`);
  return value;
}

function one(rows: readonly Row[], field: string, id: string, path: string): Row {
  const matches = rows.filter((row) => row[field] === id);
  if (matches.length !== 1) return fail(path, `expected exactly one ${id}`);
  return matches[0]!;
}

function assertEqual(actual: unknown, expected: string, path: string): void {
  if (actual !== expected) fail(path, `expected ${expected}`);
}

function modifiers(
  value: unknown,
  kind: 'STAT' | 'CHECK',
  path: string,
): readonly NpcModifierComponent[] {
  const parsed = object(JSON.parse(text(value, path)), path);
  return Object.freeze(
    Object.entries(parsed)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, value]) => {
        if (typeof value !== 'number' || !Number.isSafeInteger(value))
          return fail(path, 'modifier must be a safe integer');
        if (kind === 'CHECK') {
          if (code !== 'STEALTH') return fail(path, `unknown disease check ${code}`);
          return Object.freeze({ targetKind: 'CHECK', targetCode: 'STEALTH', value } as const);
        }
        const stat = STAT_CODES.find((entry) => entry === code);
        if (stat === undefined) return fail(path, `unknown disease stat ${code}`);
        return Object.freeze({ targetKind: 'STAT', targetCode: stat, value } as const);
      }),
  );
}

/** Bounded source reader for these two families only, not the complete Effect Registry. */
export function createNpcInitialEffectCatalog(
  sources: Readonly<{
    diseases: unknown;
    poisons: unknown;
    timerPolicies: unknown;
    rules: unknown;
  }>,
): NpcInitialEffectCatalog {
  const diseaseRows = sourceRows(sources.diseases, 'diseases');
  if (
    diseaseRows.length !== DISEASE_IDS.length ||
    diseaseRows.some((row) => !DISEASE_IDS.some((id) => id === row.DiseaseID))
  )
    return fail('diseases', 'closed disease catalogue differs');
  const diseases = DISEASE_IDS.map((diseaseId): NpcDiseaseDefinition => {
    const row = one(diseaseRows, 'DiseaseID', diseaseId, 'diseases');
    const nameRu = text(row['Название'], diseaseId + '.nameRu');
    assertEqual(row['Effect family'], 'DISEASE', diseaseId);
    assertEqual(row['Is poison'], 'false', diseaseId);
    const status = row.Status;
    if (status !== 'ACTIVE' && status !== 'TRACE_ONLY')
      return fail(diseaseId, 'unknown source status');
    if ((diseaseId === 'DIS-PESTILENCE') !== (status === 'TRACE_ONLY'))
      return fail(diseaseId, 'trace boundary differs');
    const components = Object.freeze([
      ...modifiers(row['Stat modifiers JSON'], 'STAT', diseaseId),
      ...modifiers(row['Check modifiers JSON'], 'CHECK', diseaseId),
    ]);
    if (status === 'TRACE_ONLY')
      return Object.freeze({
        diseaseId,
        nameRu,
        status,
        modifiers: components,
        dailyDamageOrNull: null,
      });
    assertEqual(row.Assignment, 'GM_ASSIGN_REMOVE', diseaseId);
    assertEqual(row.Duration, 'UNTIL_GM_REMOVE_OR_SPECIFIC_CURE', diseaseId);
    assertEqual(row.Stacking, 'NO_STACK_SAME_ID', diseaseId);
    let dailyDamageOrNull: number | null = null;
    if (diseaseId === 'DIS-PNEUMONIA') {
      const periodic = /^HP_MINUS_(\d+)_EACH_FULL_DAY$/.exec(text(row.Periodic, diseaseId));
      if (periodic === null) return fail(diseaseId, 'unknown full-day damage grammar');
      dailyDamageOrNull = integer(Number(periodic[1]), 1, diseaseId);
    } else assertEqual(row.Periodic, 'NONE', diseaseId);
    return Object.freeze({ diseaseId, nameRu, status, modifiers: components, dailyDamageOrNull });
  });
  const timers = sourceRows(sources.timerPolicies, 'timers');
  assertEqual(one(timers, 'PolicyID', 'TIME-005', 'timers').Code, 'FULL_DAY_TICK', 'TIME-005');
  assertEqual(
    one(timers, 'PolicyID', 'TIME-005', 'timers')['Контекст'],
    '24 часа эффекта',
    'TIME-005',
  );
  assertEqual(one(timers, 'PolicyID', 'TIME-010', 'timers').Code, 'COSTS_AND_TICKS', 'TIME-010');
  assertEqual(
    one(timers, 'PolicyID', 'TIME-017', 'timers').Code,
    'NO_SAME_MOMENT_SERVICE',
    'TIME-017',
  );
  const poison = one(
    sourceRows(sources.poisons, 'poisons'),
    'PoisonProfileID',
    'POI-FOOD_ALCOHOL',
    'poisons',
  );
  assertEqual(poison['Source kind'], 'ORDINARY', 'POI-FOOD_ALCOHOL');
  assertEqual(poison['Effect family'], 'POISON', 'POI-FOOD_ALCOHOL');
  assertEqual(poison.Payload, 'By CORE-110', 'POI-FOOD_ALCOHOL');
  const rule = one(sourceRows(sources.rules, 'rules'), 'Rule ID', 'CORE-110', 'rules');
  const algorithm = text(rule['Итоговый алгоритм'], 'CORE-110');
  const alcohol =
    /Алкоголь\/некачественный алкоголь: (\d+) HP в час, срок (\d+)−Z часов, при ≤0 не возникает\./.exec(
      algorithm,
    );
  if (
    alcohol === null ||
    !algorithm.includes('[Q-CORE-029] В windows приложении мы не учитываем пищевое отравление')
  )
    return fail('CORE-110', 'unrecognized alcohol formula/food exclusion');
  return Object.freeze({
    diseases: Object.freeze(diseases),
    alcohol: Object.freeze({
      damagePerHour: integer(Number(alcohol[1]), 1, 'CORE-110'),
      durationHoursOffset: integer(Number(alcohol[2]), 1, 'CORE-110'),
    }),
  });
}

function newMoment(value: unknown): NpcCalendarInstant {
  const input = object(value, 'assignment', ['kind', 'campaignTimestamp']);
  assertEqual(input.kind, 'NEW_FORMAL_ASSIGNMENT', 'assignment');
  return Object.freeze({ campaignTimestamp: integer(input.campaignTimestamp, 0, 'assignment') });
}

function plusMinutes(moment: NpcCalendarInstant, minutes: number): NpcCalendarInstant {
  return Object.freeze({
    campaignTimestamp: integer(moment.campaignTimestamp + minutes, 0, 'result time'),
  });
}

/** Derives a new formal assignment only. It never rebases a stored effect onto a new now. */
export function prepareNewNpcDiseasePayload(
  catalog: NpcInitialEffectCatalog,
  diseaseId: string,
  assignment: NpcNewFormalAssignment,
): Readonly<{ payload: NpcDiseasePayload; startsAt: NpcCalendarInstant }> {
  const definition = catalog.diseases.find((entry) => entry.diseaseId === diseaseId);
  if (definition === undefined) return fail('diseaseId', `unknown ${JSON.stringify(diseaseId)}`);
  if (definition.status !== 'ACTIVE')
    return fail(diseaseId, 'TRACE_ONLY: no automated disease state');
  const startsAt = newMoment(assignment);
  return Object.freeze({
    startsAt,
    payload: Object.freeze({
      diseaseId: definition.diseaseId,
      assignedByGM: true,
      modifierComponents: definition.modifiers,
      dailyTick:
        definition.dailyDamageOrNull === null
          ? null
          : Object.freeze({
              phase: 'COSTS_AND_TICKS' as const,
              period: Object.freeze({ amount: 1 as const, unit: 'DAY' as const }),
              nextTickAt: plusMinutes(startsAt, HOURS_PER_DAY * MINUTES_PER_HOUR),
              damagePerTick: definition.dailyDamageOrNull,
            }),
    }),
  });
}

/** CORE-110/Q-CORE-029: no food branch, no dose/roll/cost replay, no clamp of 30-Z. */
export function prepareNewNpcAlcoholParameters(
  catalog: NpcInitialEffectCatalog,
  input: Readonly<{ kind: 'ALCOHOL'; effectiveZ: number; assignment: NpcNewAlcoholAssignment }>,
): NpcNewAlcoholParameters {
  const value = object(input, 'alcohol input', ['kind', 'effectiveZ', 'assignment']);
  assertEqual(value.kind, 'ALCOHOL', 'alcohol input');
  const z = integer(value.effectiveZ, 1, 'alcohol Z');
  const assignment = object(value.assignment, 'assignment');
  assertEqual(assignment.kind, 'NEW_FORMAL_ASSIGNMENT', 'assignment');
  // An explicitly supplied clock still has to be valid, even when no state will be created.
  let startsAt: NpcCalendarInstant | null = null;
  if (Object.hasOwn(assignment, 'campaignTimestamp')) startsAt = newMoment(assignment);
  else object(assignment, 'assignment', ['kind']);
  const duration = catalog.alcohol.durationHoursOffset - z;
  if (duration <= 0)
    return Object.freeze({
      kind: 'NO_EFFECT',
      sourceRuleId: 'CORE-110',
      reason: 'NON_POSITIVE_DURATION',
    });
  if (startsAt === null)
    return fail('assignment', 'positive alcohol duration requires confirmed campaignTimestamp');
  return Object.freeze({
    kind: 'PARAMETERS_REQUIRE_SCHEDULE',
    payload: Object.freeze({
      poisonProfileId: 'POI-FOOD_ALCOHOL',
      poisonSourceKind: 'ORDINARY',
      deliveryKind: 'INGESTED',
      secondaryControlApplicable: false,
    }),
    magnitude: catalog.alcohol.damagePerHour,
    startsAt,
    expiresAt: plusMinutes(startsAt, duration * MINUTES_PER_HOUR),
    durationUnit: 'HOUR',
    remainingExact: String(duration),
    blocker: 'FIRST_TICK_ANCHOR_NOT_YET_PROVEN',
  });
}

/** Formula-only compatibility above stays unchanged; this explicit new branch applies ADR 0082. */
export function prepareNewNpcAlcoholSchedule(
  catalog: NpcInitialEffectCatalog,
  input: Readonly<{ kind: 'ALCOHOL'; effectiveZ: number; assignment: NpcNewAlcoholAssignment }>,
): NpcNewAlcoholSchedule {
  const prepared = prepareNewNpcAlcoholParameters(catalog, input);
  if (prepared.kind === 'NO_EFFECT') return prepared;
  return Object.freeze({
    kind: 'ACTIVE_PARAMETERS',
    payload: prepared.payload,
    magnitude: prepared.magnitude,
    startsAt: prepared.startsAt,
    expiresAt: prepared.expiresAt,
    durationUnit: prepared.durationUnit,
    remainingExact: prepared.remainingExact,
    tickSchedule: Object.freeze({
      phase: 'COSTS_AND_TICKS',
      period: Object.freeze({ amount: 1, unit: 'HOUR' }),
      nextTickAt: plusMinutes(prepared.startsAt, MINUTES_PER_HOUR),
    }),
    lastTickAt: null,
  });
}

/** Read validation uses saved anchors, never a new current time or current Z. */
export function validateNpcDiseasePayload(
  catalog: NpcInitialEffectCatalog,
  candidate: unknown,
  anchors: Readonly<{ startsAt: NpcCalendarInstant; lastTickAtOrNull: NpcCalendarInstant | null }>,
): NpcDiseasePayload {
  const input = object(candidate, 'disease payload', [
    'diseaseId',
    'assignedByGM',
    'modifierComponents',
    'dailyTick',
  ]);
  const originalStart = object(anchors.startsAt, 'saved startsAt', ['campaignTimestamp']);
  const start = integer(originalStart.campaignTimestamp, 0, 'saved startsAt');
  const expected = prepareNewNpcDiseasePayload(catalog, text(input.diseaseId, 'diseaseId'), {
    kind: 'NEW_FORMAL_ASSIGNMENT',
    campaignTimestamp: start,
  }).payload;
  if (input.assignedByGM !== true) return fail('assignedByGM', 'must be true');
  const components = componentsArray(input.modifierComponents, expected.modifierComponents.length);
  for (let index = 0; index < expected.modifierComponents.length; index += 1) {
    const actual = object(components[index], 'modifierComponents', [
      'targetKind',
      'targetCode',
      'value',
    ]);
    const source = expected.modifierComponents[index]!;
    if (
      actual.targetKind !== source.targetKind ||
      actual.targetCode !== source.targetCode ||
      actual.value !== source.value
    )
      return fail('modifierComponents', 'source component differs');
  }
  if (expected.dailyTick === null) {
    if (input.dailyTick !== null || anchors.lastTickAtOrNull !== null)
      return fail('dailyTick', 'nonperiodic disease has no tick');
    return expected;
  }
  const dayMinutes = HOURS_PER_DAY * MINUTES_PER_HOUR;
  let last = start;
  if (anchors.lastTickAtOrNull !== null) {
    const saved = object(anchors.lastTickAtOrNull, 'saved lastTickAt', ['campaignTimestamp']);
    last = integer(saved.campaignTimestamp, 0, 'saved lastTickAt');
    if (last <= start || (last - start) % dayMinutes !== 0)
      return fail('saved lastTickAt', 'not an elapsed full day of this effect');
  }
  const actual = object(input.dailyTick, 'dailyTick', [
    'phase',
    'period',
    'nextTickAt',
    'damagePerTick',
  ]);
  const period = object(actual.period, 'dailyTick.period', ['amount', 'unit']);
  const next = object(actual.nextTickAt, 'dailyTick.nextTickAt', ['campaignTimestamp']);
  const nextTickAt = plusMinutes({ campaignTimestamp: last }, dayMinutes);
  if (
    actual.phase !== expected.dailyTick.phase ||
    actual.damagePerTick !== expected.dailyTick.damagePerTick ||
    period.amount !== 1 ||
    period.unit !== 'DAY' ||
    next.campaignTimestamp !== nextTickAt.campaignTimestamp
  )
    return fail('dailyTick', 'source schedule or saved anchor differs');
  return Object.freeze({
    ...expected,
    dailyTick: Object.freeze({ ...expected.dailyTick, nextTickAt }),
  });
}

/** This validates only the four common poison fields for the alcohol variant. */
export function validateNpcAlcoholPoisonPayload(candidate: unknown): NpcPoisonPayload {
  const value = object(candidate, 'alcohol payload', [
    'poisonProfileId',
    'poisonSourceKind',
    'deliveryKind',
    'secondaryControlApplicable',
  ]);
  if (
    value.poisonProfileId !== 'POI-FOOD_ALCOHOL' ||
    value.poisonSourceKind !== 'ORDINARY' ||
    value.deliveryKind !== 'INGESTED' ||
    value.secondaryControlApplicable !== false
  )
    return fail('alcohol payload', 'not the source alcohol variant');
  return Object.freeze({
    poisonProfileId: 'POI-FOOD_ALCOHOL',
    poisonSourceKind: 'ORDINARY',
    deliveryKind: 'INGESTED',
    secondaryControlApplicable: false,
  });
}

/** PRF-DEAD only; not the complete corpse/effect finalization transaction. */
export function npcFinalDeathCapabilities(): Readonly<
  Pick<
    NpcDerivedCapabilities,
    'canPhysicalAct' | 'canMentalAct' | 'canReact' | 'canActiveDefend' | 'effectiveControllerId'
  >
> {
  return Object.freeze({
    canPhysicalAct: false,
    canMentalAct: false,
    canReact: false,
    canActiveDefend: false,
    effectiveControllerId: null,
  });
}
