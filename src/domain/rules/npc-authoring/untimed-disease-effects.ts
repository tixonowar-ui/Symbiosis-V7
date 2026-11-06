import type {
  NpcUntimedDiseaseEffectInstance,
  NpcUntimedDiseaseId,
  NpcUntimedDiseasePayload,
} from './effect-types.js';
import type { NpcInitialEffectCatalog } from './initial-effects.js';
import { prepareNewNpcDiseasePayload, validateNpcDiseasePayload } from './initial-effects.js';

/** Eight named ACTIVE diseases with Periodic=NONE in Effects/03. */
const DISEASE_RULES = Object.freeze({
  'DIS-POISONING': 'MON-076',
  'DIS-RHINITIS': 'MON-077',
  'DIS-FEVER': 'MON-078',
  'DIS-SCABIES': 'MON-079',
  'DIS-MIGRAINE': 'MON-081',
  'DIS-FLATULENCE': 'MON-082',
  'DIS-SKIN_GROWTHS': 'MON-083',
  'DIS-ITCHY_SKIN_GROWTHS': 'MON-084',
} as const satisfies Readonly<Record<NpcUntimedDiseaseId, string>>);
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

export interface NpcUntimedDiseaseCodecCatalog {
  readonly initialEffects: NpcInitialEffectCatalog;
  readonly diseaseIds: readonly NpcUntimedDiseaseId[];
}

/** The authoritative caller supplies actual identity/time; this codec creates neither. */
export interface NpcDiseaseEffectContext {
  readonly targetActorId: string;
  readonly campaignTimestampOrNull: number | null;
  readonly dead: boolean;
}

function fail(path: string, detail: string): never {
  throw new Error(`NPC untimed disease ${path}: ${detail}`);
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

function diseaseId(value: unknown, catalog: NpcUntimedDiseaseCodecCatalog): NpcUntimedDiseaseId {
  const found = catalog.diseaseIds.find((id) => id === value);
  if (found === undefined) return fail('diseaseId', 'not a supported ACTIVE nonperiodic disease');
  return found;
}

/** The initial payload catalog is already source-validated; seal this family's routing metadata. */
export function createNpcUntimedDiseaseCodecCatalog(
  initialEffects: NpcInitialEffectCatalog,
  sources: Readonly<{ diseases: unknown; effectTypes: unknown; operations: unknown }>,
): NpcUntimedDiseaseCodecCatalog {
  const diseases = array(sources.diseases, 'diseases').map((row) => record(row, 'disease row'));
  const types = array(sources.effectTypes, 'effectTypes').map((row) => record(row, 'effect type'));
  const operations = array(sources.operations, 'operations').map((row) => record(row, 'operation'));
  const one = (rows: readonly Row[], key: string, id: string): Row => {
    const found = rows.filter((row) => row[key] === id);
    if (found.length !== 1) return fail(id, 'source row is missing or repeated');
    return found[0]!;
  };
  const type = one(types, 'EffectTypeID', 'EFF-DISEASE-INSTANCE');
  for (const [key, expected] of Object.entries({
    FamilyCode: 'FAM-DISEASE',
    Automation: 'REGISTRY_SCHEMA',
    'Schema status': 'DEFINED',
    'State bucket': 'currentEffects',
    'Stack policy': 'NO_STACK_BY_DISEASE_ID',
    'Removal policy': 'GM_REMOVE',
    'Timer policy': 'SOURCE_SPECIFIC_OR_EXPLICIT',
    'Rule refs': 'MON-085; CQA-060',
  }))
    if (type[key] !== expected) return fail('EFF-DISEASE-INSTANCE', `source ${key} differs`);
  const assign = one(operations, 'OperationID', 'ASSIGN_DISEASE');
  if (
    assign['Алгоритм'] !== 'No automatic disease selection; apply if not same active disease' ||
    assign['State writes'] !== 'EFF-DISEASE-INSTANCE' ||
    assign['Rule refs'] !== 'CQA-060; MON-085'
  )
    return fail('ASSIGN_DISEASE', 'source routing/duplicate policy differs');
  const ids = Object.keys(DISEASE_RULES) as NpcUntimedDiseaseId[];
  for (const id of ids) {
    const raw = one(diseases, 'DiseaseID', id);
    const matching = initialEffects.diseases.filter((entry) => entry.diseaseId === id);
    if (
      matching.length !== 1 ||
      matching[0]!.status !== 'ACTIVE' ||
      matching[0]!.dailyDamageOrNull !== null ||
      raw.Status !== 'ACTIVE' ||
      raw.Periodic !== 'NONE' ||
      raw['Rule refs'] !== DISEASE_RULES[id] ||
      raw['Effect family'] !== 'DISEASE' ||
      raw['Is poison'] !== 'false' ||
      raw.Assignment !== 'GM_ASSIGN_REMOVE' ||
      raw.Duration !== 'UNTIL_GM_REMOVE_OR_SPECIFIC_CURE' ||
      raw.Stacking !== 'NO_STACK_SAME_ID'
    )
      return fail(id, 'source nonperiodic manual disease contract differs');
  }
  return Object.freeze({ initialEffects, diseaseIds: Object.freeze(ids) });
}

function build(
  catalog: NpcUntimedDiseaseCodecCatalog,
  scope: NpcDiseaseEffectContext,
  identity: Readonly<{
    effectInstanceId: string;
    diseaseId: NpcUntimedDiseaseId;
    createdAt: string;
    startsAt: number;
    revision: number;
  }>,
): NpcUntimedDiseaseEffectInstance {
  if (scope.dead)
    return fail('context.dead', 'living-current-state codec cannot finalize corpse effects');
  if (scope.campaignTimestampOrNull === null)
    return fail('startsAt', 'an assigned disease requires confirmed campaign time');
  if (identity.startsAt > scope.campaignTimestampOrNull)
    return fail('startsAt', 'saved beginning is after current confirmed campaign time');
  const prepared = prepareNewNpcDiseasePayload(catalog.initialEffects, identity.diseaseId, {
    kind: 'NEW_FORMAL_ASSIGNMENT',
    campaignTimestamp: identity.startsAt,
  });
  if (prepared.payload.dailyTick !== null)
    return fail('dailyTick', 'periodic disease belongs to another codec');
  const payload: NpcUntimedDiseasePayload = Object.freeze({
    diseaseId: identity.diseaseId,
    assignedByGM: true,
    modifierComponents: prepared.payload.modifierComponents,
    dailyTick: null,
  });
  return Object.freeze({
    effectInstanceId: identity.effectInstanceId,
    effectTypeId: 'EFF-DISEASE-INSTANCE',
    familyCode: 'FAM-DISEASE',
    targetActorId: scope.targetActorId,
    targetRegionId: null,
    sourceRuleIds: Object.freeze([DISEASE_RULES[identity.diseaseId], 'MON-085', 'CQA-060']),
    sourceEntityId: null,
    sourceInstanceId: null,
    sourceSnapshot: null,
    sourceLifecyclePolicy: 'SOURCE_SPECIFIC',
    stackingKey: identity.diseaseId,
    payload,
    magnitude: null,
    tags: Object.freeze(['DISEASE'] as const),
    createdAt: identity.createdAt,
    startsAt: prepared.startsAt,
    expiresAt: null,
    remainingExact: null,
    durationUnit: null,
    tickSchedule: null,
    lastTickAt: null,
    status: 'ACTIVE',
    revision: identity.revision,
    removalReason: null,
    createdBy: 'GM',
    variantKey: identity.diseaseId,
    // Technical serialization of type/variant/explicit absent region, never display-name inference.
    aggregateKey: `EFF-DISEASE-INSTANCE|${identity.diseaseId}|null`,
    deathDisposition: 'SOURCE_SPECIFIC',
  });
}

/** Pure construction only: authority, UUID and audit timestamp are already supplied by the caller. */
export function createNpcUntimedDiseaseEffect(
  catalog: NpcUntimedDiseaseCodecCatalog,
  candidate: unknown,
  scope: NpcDiseaseEffectContext,
): NpcUntimedDiseaseEffectInstance {
  const value = record(candidate, 'assignment', ['effectInstanceId', 'diseaseId', 'createdAt']);
  const verified = context(scope);
  if (verified.campaignTimestampOrNull === null)
    return fail('startsAt', 'an assigned disease requires confirmed campaign time');
  return build(catalog, verified, {
    effectInstanceId: uuid(value.effectInstanceId, 'effectInstanceId'),
    diseaseId: diseaseId(value.diseaseId, catalog),
    createdAt: auditTimestamp(value.createdAt),
    startsAt: verified.campaignTimestampOrNull,
    revision: 1,
  });
}

/** Read existing state with its original start/revision; never recreate at the current time. */
export function validateNpcUntimedDiseaseEffect(
  catalog: NpcUntimedDiseaseCodecCatalog,
  candidate: unknown,
  scope: NpcDiseaseEffectContext,
): NpcUntimedDiseaseEffectInstance {
  const value = record(candidate, 'effect', FIELDS);
  const start = record(value.startsAt, 'startsAt', ['campaignTimestamp']);
  const payload = record(value.payload, 'payload', [
    'diseaseId',
    'assignedByGM',
    'modifierComponents',
    'dailyTick',
  ]);
  const result = build(catalog, context(scope), {
    effectInstanceId: uuid(value.effectInstanceId, 'effectInstanceId'),
    diseaseId: diseaseId(payload.diseaseId, catalog),
    createdAt: auditTimestamp(value.createdAt),
    startsAt: integer(start.campaignTimestamp, 0, 'startsAt'),
    revision: integer(value.revision, 1, 'revision'),
  });
  for (const key of FIELDS) {
    if (key === 'payload' || key === 'startsAt' || key === 'sourceRuleIds' || key === 'tags')
      continue;
    if (value[key] !== result[key]) return fail(key, 'not the source-derived manual disease value');
  }
  for (const key of ['sourceRuleIds', 'tags'] as const) {
    const actual = array(value[key], key, result[key].length);
    if (
      actual.length !== result[key].length ||
      actual.some((entry, index) => entry !== result[key][index])
    )
      return fail(key, 'source identity/tag set differs');
  }
  validateNpcDiseasePayload(catalog.initialEffects, value.payload, {
    startsAt: result.startsAt,
    lastTickAtOrNull: null,
  });
  return result;
}

/** COMB-003/MON-085: one active instance per named disease. Empty state needs no invented clock. */
export function validateNpcUntimedDiseaseEffects(
  catalog: NpcUntimedDiseaseCodecCatalog,
  candidate: unknown,
  scope: NpcDiseaseEffectContext,
): readonly NpcUntimedDiseaseEffectInstance[] {
  const verified = context(scope);
  const rows = array(candidate, 'effects', catalog.diseaseIds.length);
  const identities = new Set<string>();
  const diseases = new Set<NpcUntimedDiseaseId>();
  return Object.freeze(
    rows.map((row) => {
      const result = validateNpcUntimedDiseaseEffect(catalog, row, verified);
      if (identities.has(result.effectInstanceId))
        return fail('effectInstanceId', 'duplicate mutable identity');
      if (diseases.has(result.payload.diseaseId))
        return fail('diseaseId', 'duplicate active disease');
      identities.add(result.effectInstanceId);
      diseases.add(result.payload.diseaseId);
      return result;
    }),
  );
}
