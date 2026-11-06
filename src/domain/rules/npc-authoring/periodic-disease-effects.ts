import type {
  NpcCalendarInstant,
  NpcDiseaseEffectInstance,
  NpcPneumoniaEffectInstance,
} from './effect-types.js';
import { prepareNewNpcDiseasePayload, validateNpcDiseasePayload } from './initial-effects.js';
import {
  validateNpcUntimedDiseaseEffect,
  type NpcDiseaseEffectContext,
  type NpcUntimedDiseaseCodecCatalog,
} from './untimed-disease-effects.js';
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
type Row = Readonly<Record<string, unknown>>;

function fail(path: string, detail: string): never {
  throw new Error(`NPC periodic disease ${path}: ${detail}`);
}

function record(value: unknown, path: string, exact?: readonly string[]): Row {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail(path, 'expected plain data');
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string') ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (field) => !field.enumerable || !Object.hasOwn(field, 'value'),
    ) ||
    (exact !== undefined &&
      (keys.length !== exact.length || exact.some((key) => !Object.hasOwn(value, key))))
  )
    return fail(path, 'unexpected, missing, accessor or nonenumerable fields');
  return value as Row;
}

function array(value: unknown, path: string, maximum?: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail(path, 'expected plain dense array');
  const fields = Object.getOwnPropertyDescriptors(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  const count = length?.value as unknown;
  if (
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    (maximum !== undefined && count > maximum) ||
    Reflect.ownKeys(value).length !== count + 1
  )
    return fail(path, 'array fields/count differ');
  const result: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    const field = fields[String(index)];
    if (field === undefined || !field.enumerable || !Object.hasOwn(field, 'value'))
      return fail(path, 'array index is not an own data field');
    result.push(field.value);
  }
  return result;
}

function integer(value: unknown, minimum: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    return fail(path, `expected safe integer >= ${minimum}`);
  return value;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    return fail(path, 'expected canonical UUID v4');
  return value;
}

function auditTimestamp(value: unknown): string {
  // Only validate an existing audit timestamp; never read the system clock or rebase startsAt.
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value))
    return fail('createdAt', 'expected canonical UTC audit timestamp');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    return fail('createdAt', 'invalid audit timestamp');
  return value;
}

function context(candidate: unknown): NpcDiseaseEffectContext {
  const value = record(candidate, 'context', ['targetActorId', 'campaignTimestampOrNull', 'dead']);
  const targetActorId = uuid(value.targetActorId, 'context.targetActorId');
  if (typeof value.dead !== 'boolean') return fail('context.dead', 'expected boolean');
  return Object.freeze({
    targetActorId,
    campaignTimestampOrNull:
      value.campaignTimestampOrNull === null
        ? null
        : integer(value.campaignTimestampOrNull, 0, 'context.campaignTimestampOrNull'),
    dead: value.dead,
  });
}

/** The host supplies this from confirmed history, never by copying an untrusted candidate.
 * It proves anchors only after the owning journal has checked each processed tick and HP write.
 * This is call context, not a new persisted tick-event contract or authority verifier.
 */
export interface NpcPneumoniaHistoryAnchor {
  readonly effectInstanceId: string;
  readonly targetActorId: string;
  readonly startsAt: NpcCalendarInstant;
  readonly lastTickAt: NpcCalendarInstant | null;
  readonly revision: number;
}
export interface NpcDiseaseCodecCatalog {
  readonly nonperiodic: NpcUntimedDiseaseCodecCatalog;
}
const RULES = Object.freeze(['MON-080', 'MON-087', 'MON-085', 'CQA-060', 'AQA-024', 'CORE-101']);
function moment(value: unknown, path: string): NpcCalendarInstant {
  const row = record(value, path, ['campaignTimestamp']);
  return Object.freeze({ campaignTimestamp: integer(row.campaignTimestamp, 0, path) });
}
function sameArray(value: unknown, expected: readonly string[], path: string): void {
  const actual = array(value, path, expected.length);
  if (actual.length !== expected.length || actual.some((entry, i) => entry !== expected[i]))
    fail(path, 'source identity/tag set differs');
}
/** Extend the already source-sealed common disease family without accepting TRACE_ONLY PESTILENCE. */
export function createNpcDiseaseCodecCatalog(
  nonperiodic: NpcUntimedDiseaseCodecCatalog,
  sources: Readonly<{ diseases: unknown; timerPolicies: unknown; runtimeContracts: unknown }>,
): NpcDiseaseCodecCatalog {
  const one = (input: unknown, key: string, id: string): Row => {
    const found = array(input, id)
      .map((row) => record(row, id))
      .filter((row) => row[key] === id);
    if (found.length !== 1) return fail(id, 'expected exactly one source row');
    return found[0]!;
  };
  const disease = one(sources.diseases, 'DiseaseID', 'DIS-PNEUMONIA');
  for (const [key, expected] of Object.entries({
    Status: 'ACTIVE',
    'Effect family': 'DISEASE',
    'Is poison': 'false',
    Assignment: 'GM_ASSIGN_REMOVE',
    Duration: 'UNTIL_GM_REMOVE_OR_SPECIFIC_CURE',
    Stacking: 'NO_STACK_SAME_ID',
    'Rule refs': 'MON-080; MON-087',
  }))
    if (disease[key] !== expected) return fail('DIS-PNEUMONIA', `source ${key} differs`);
  const definition = nonperiodic.initialEffects.diseases.filter(
    (row) => row.diseaseId === 'DIS-PNEUMONIA',
  );
  if (
    definition.length !== 1 ||
    definition[0]!.status !== 'ACTIVE' ||
    definition[0]!.dailyDamageOrNull === null
  )
    return fail('DIS-PNEUMONIA', 'missing validated periodic definition');
  if (disease.Periodic !== `HP_MINUS_${definition[0]!.dailyDamageOrNull}_EACH_FULL_DAY`)
    return fail('DIS-PNEUMONIA', 'periodic source differs');
  for (const [id, code, contextText, invariant, refs] of [
    [
      'TIME-005',
      'FULL_DAY_TICK',
      '24 часа эффекта',
      'Пневмония тикает только за полные сутки',
      'MON-080',
    ],
    [
      'TIME-010',
      'COSTS_AND_TICKS',
      'Одна временная метка',
      'Обязательные цены и периодические тики',
      'AQA-024',
    ],
    [
      'TIME-017',
      'NO_SAME_MOMENT_SERVICE',
      'Момент создания',
      'Не тикать и не уменьшать в момент создания',
      'CORE-101; Q-CORE-062',
    ],
  ] as const) {
    const row = one(sources.timerPolicies, 'PolicyID', id);
    if (
      row.Code !== code ||
      row['Контекст'] !== contextText ||
      row['Алгоритм / инвариант'] !== invariant ||
      row['Rule refs'] !== refs
    )
      return fail(id, 'timer source differs');
  }
  const contracts = array(sources.runtimeContracts, 'runtimeContracts').map((row) =>
    record(row, 'contract'),
  );
  for (const [field, type, required, invariant] of [
    ['tickSchedule', 'object|null', 'CONDITIONAL', 'Фаза, период и nextTickAt'],
    ['lastTickAt', 'timestamp|turnRef|null', 'NO', 'Аудит дедупликации тика'],
  ] as const) {
    const matches = contracts.filter(
      (row) => row.Entity === 'EffectInstance' && row.Field === field,
    );
    if (
      matches.length !== 1 ||
      matches[0]!.Type !== type ||
      matches[0]!.Required !== required ||
      matches[0]!['Семантика / инвариант'] !== invariant
    )
      return fail(field, 'runtime contract differs');
  }
  return Object.freeze({ nonperiodic });
}
function build(
  catalog: NpcDiseaseCodecCatalog,
  scope: NpcDiseaseEffectContext,
  identity: Readonly<{
    effectInstanceId: string;
    createdAt: string;
    startsAt: NpcCalendarInstant;
    lastTickAt: NpcCalendarInstant | null;
    revision: number;
  }>,
  candidatePayload?: unknown,
): NpcPneumoniaEffectInstance {
  if (scope.dead)
    return fail('context.dead', 'living-current-state codec cannot finalize corpse effects');
  if (scope.campaignTimestampOrNull === null)
    return fail('startsAt', 'an assigned disease requires confirmed campaign time');
  if (
    identity.startsAt.campaignTimestamp > scope.campaignTimestampOrNull ||
    (identity.lastTickAt !== null &&
      identity.lastTickAt.campaignTimestamp > scope.campaignTimestampOrNull)
  )
    return fail('anchors', 'saved beginning/tick is after current confirmed campaign time');
  const initial = catalog.nonperiodic.initialEffects;
  const prepared = prepareNewNpcDiseasePayload(initial, 'DIS-PNEUMONIA', {
    kind: 'NEW_FORMAL_ASSIGNMENT',
    campaignTimestamp: identity.startsAt.campaignTimestamp,
  });
  const payload = validateNpcDiseasePayload(initial, candidatePayload ?? prepared.payload, {
    startsAt: identity.startsAt,
    lastTickAtOrNull: identity.lastTickAt,
  });
  if (payload.diseaseId !== 'DIS-PNEUMONIA' || payload.dailyTick === null)
    return fail('payload', 'expected periodic PNEUMONIA');
  const tick = payload.dailyTick;
  return Object.freeze({
    effectInstanceId: identity.effectInstanceId,
    effectTypeId: 'EFF-DISEASE-INSTANCE',
    familyCode: 'FAM-DISEASE',
    targetActorId: scope.targetActorId,
    targetRegionId: null,
    sourceRuleIds: RULES,
    sourceEntityId: null,
    sourceInstanceId: null,
    sourceSnapshot: null,
    sourceLifecyclePolicy: 'SOURCE_SPECIFIC',
    stackingKey: 'DIS-PNEUMONIA',
    payload: Object.freeze({
      diseaseId: 'DIS-PNEUMONIA',
      assignedByGM: true,
      modifierComponents: payload.modifierComponents,
      dailyTick: tick,
    }),
    magnitude: null,
    tags: Object.freeze(['DISEASE'] as const),
    createdAt: identity.createdAt,
    startsAt: identity.startsAt,
    expiresAt: null,
    remainingExact: null,
    durationUnit: null,
    tickSchedule: Object.freeze({
      phase: tick.phase,
      period: tick.period,
      nextTickAt: tick.nextTickAt,
    }),
    lastTickAt: identity.lastTickAt,
    status: 'ACTIVE',
    revision: identity.revision,
    removalReason: null,
    createdBy: 'GM',
    variantKey: 'DIS-PNEUMONIA',
    aggregateKey: 'EFF-DISEASE-INSTANCE|DIS-PNEUMONIA|null',
    deathDisposition: 'SOURCE_SPECIFIC',
  });
}
/** Creates only the assigned effect; it neither executes the first tick nor modifies HP. */
export function createNpcPneumoniaEffect(
  catalog: NpcDiseaseCodecCatalog,
  candidate: unknown,
  scope: NpcDiseaseEffectContext,
): NpcPneumoniaEffectInstance {
  const row = record(candidate, 'assignment', ['effectInstanceId', 'createdAt']);
  const verified = context(scope);
  if (verified.campaignTimestampOrNull === null)
    return fail('startsAt', 'an assigned disease requires confirmed campaign time');
  return build(catalog, verified, {
    effectInstanceId: uuid(row.effectInstanceId, 'effectInstanceId'),
    createdAt: auditTimestamp(row.createdAt),
    startsAt: Object.freeze({ campaignTimestamp: verified.campaignTimestampOrNull }),
    lastTickAt: null,
    revision: 1,
  });
}
/** Read exact persisted anchors. The separate history input must come from the host's verified fold. */
export function validateNpcPneumoniaEffect(
  catalog: NpcDiseaseCodecCatalog,
  candidate: unknown,
  scope: NpcDiseaseEffectContext,
  history: NpcPneumoniaHistoryAnchor,
): NpcPneumoniaEffectInstance {
  const row = record(candidate, 'effect', FIELDS);
  record(row.payload, 'payload', ['diseaseId', 'assignedByGM', 'modifierComponents', 'dailyTick']);
  const verified = context(scope);
  const proof = record(history, 'history', [
    'effectInstanceId',
    'targetActorId',
    'startsAt',
    'lastTickAt',
    'revision',
  ]);
  const startsAt = moment(row.startsAt, 'startsAt');
  const lastTickAt = row.lastTickAt === null ? null : moment(row.lastTickAt, 'lastTickAt');
  const historyStart = moment(proof.startsAt, 'history.startsAt');
  const historyLast =
    proof.lastTickAt === null ? null : moment(proof.lastTickAt, 'history.lastTickAt');
  if (
    uuid(proof.effectInstanceId, 'history.effectInstanceId') !== row.effectInstanceId ||
    uuid(proof.targetActorId, 'history.targetActorId') !== verified.targetActorId ||
    historyStart.campaignTimestamp !== startsAt.campaignTimestamp ||
    historyLast?.campaignTimestamp !== lastTickAt?.campaignTimestamp ||
    integer(proof.revision, 1, 'history.revision') !== row.revision
  )
    return fail('history', 'saved anchors do not match the host-proved history');
  const result = build(
    catalog,
    verified,
    {
      effectInstanceId: uuid(row.effectInstanceId, 'effectInstanceId'),
      createdAt: auditTimestamp(row.createdAt),
      startsAt,
      lastTickAt,
      revision: integer(row.revision, 1, 'revision'),
    },
    row.payload,
  );
  for (const key of FIELDS) {
    if (
      key === 'payload' ||
      key === 'startsAt' ||
      key === 'lastTickAt' ||
      key === 'tickSchedule' ||
      key === 'sourceRuleIds' ||
      key === 'tags'
    )
      continue;
    if (row[key] !== result[key]) return fail(key, 'not the source-derived periodic disease value');
  }
  sameArray(row.sourceRuleIds, RULES, 'sourceRuleIds');
  sameArray(row.tags, result.tags, 'tags');
  const schedule = record(row.tickSchedule, 'tickSchedule', ['phase', 'period', 'nextTickAt']);
  const period = record(schedule.period, 'tickSchedule.period', ['amount', 'unit']);
  const next = moment(schedule.nextTickAt, 'tickSchedule.nextTickAt');
  if (
    schedule.phase !== result.tickSchedule.phase ||
    period.amount !== result.tickSchedule.period.amount ||
    period.unit !== result.tickSchedule.period.unit ||
    next.campaignTimestamp !== result.tickSchedule.nextTickAt.campaignTimestamp
  )
    return fail('tickSchedule', 'schedule differs from the checked daily payload');
  return result;
}
/** Common disease reader: nine modeled diseases, with no automatic trace-only PESTILENCE branch. */
export function validateNpcDiseaseEffects(
  catalog: NpcDiseaseCodecCatalog,
  candidate: unknown,
  scope: NpcDiseaseEffectContext,
  histories: readonly NpcPneumoniaHistoryAnchor[],
): readonly NpcDiseaseEffectInstance[] {
  const verified = context(scope);
  const supplied = array(histories, 'histories', 1);
  const rows = array(candidate, 'effects', catalog.nonperiodic.diseaseIds.length + 1);
  const identities = new Set<string>(),
    diseases = new Set<string>();
  let periodicCount = 0;
  const results = rows.map((value): NpcDiseaseEffectInstance => {
    const row = record(value, 'effect', FIELDS),
      payload = record(row.payload, 'payload');
    let result: NpcDiseaseEffectInstance;
    if (payload.diseaseId === 'DIS-PNEUMONIA') {
      periodicCount += 1;
      if (supplied.length !== 1)
        return fail('histories', 'periodic disease needs exactly one host-proved history');
      result = validateNpcPneumoniaEffect(
        catalog,
        row,
        verified,
        supplied[0] as NpcPneumoniaHistoryAnchor,
      );
    } else result = validateNpcUntimedDiseaseEffect(catalog.nonperiodic, row, verified);
    if (identities.has(result.effectInstanceId))
      return fail('effectInstanceId', 'duplicate mutable identity');
    if (diseases.has(result.payload.diseaseId))
      return fail('diseaseId', 'duplicate active disease');
    identities.add(result.effectInstanceId);
    diseases.add(result.payload.diseaseId);
    return result;
  });
  if (periodicCount !== supplied.length) return fail('histories', 'unused or repeated history');
  return Object.freeze(results);
}
