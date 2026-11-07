import type { NpcInitialTraumaCalendarAnchor } from './initial-trauma.js';
import { npcPublicationData as data } from './inventory-publication.js';

export type NpcFormalControlKind = 'SLEEP' | 'PARALYSIS';
export interface NpcFormalControlHistoryAnchor {
  readonly kind: 'GM_FORMAL_INITIAL_CONTROL';
  readonly effectInstanceId: string;
  readonly npcUuid: string;
  readonly controlKind: NpcFormalControlKind;
  readonly initialStateConfirmationId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly calendarAnchor: NpcInitialTraumaCalendarAnchor;
  readonly remainingMinutes: string;
  readonly revision: number;
}
export interface NpcFormalControlEffectInstance {
  readonly effectInstanceId: string;
  readonly effectTypeId: 'EFF-CONSCIOUS-SLEEP' | 'EFF-CONTROL-PARALYSIS';
  readonly familyCode: 'FAM-CONSCIOUSNESS' | 'FAM-PHYSICAL_CONTROL';
  readonly targetActorId: string;
  readonly targetRegionId: null;
  readonly sourceRuleIds: readonly string[];
  readonly sourceEntityId: null;
  readonly sourceInstanceId: null;
  readonly sourceSnapshot: null;
  readonly sourceLifecyclePolicy: 'SOURCE_SPECIFIC';
  readonly stackingKey: 'CORE-061' | 'CORE-062';
  readonly payload: Readonly<{ controlKind: NpcFormalControlKind; assignedByGM: true }>;
  readonly magnitude: null;
  readonly tags: readonly ['CONTROL'];
  readonly createdAt: string;
  readonly startsAt: Readonly<{ campaignTimestampExact: string }>;
  readonly expiresAt: Readonly<{ campaignTimestampExact: string }>;
  readonly remainingExact: string;
  readonly durationUnit: 'MINUTE';
  readonly tickSchedule: null;
  readonly lastTickAt: null;
  readonly status: 'ACTIVE';
  readonly revision: number;
  readonly removalReason: null;
  readonly createdBy: 'GM';
  readonly variantKey: 'CORE-061' | 'CORE-062';
  readonly aggregateKey: string;
  readonly deathDisposition: 'TERMINATE_ON_DEATH';
}
export interface NpcFormalControlContext {
  readonly npcUuid: string;
  readonly campaignTimestamp: number;
  readonly dead: boolean;
}
declare const catalogBrand: unique symbol;
export interface NpcFormalControlCatalog {
  readonly [catalogBrand]: true;
}
const catalogs = new WeakSet<NpcFormalControlCatalog>();
const DEFINITIONS = {
  SLEEP: {
    type: 'EFF-CONSCIOUS-SLEEP',
    family: 'FAM-CONSCIOUSNESS',
    rule: 'CORE-061',
    profile: 'PRF-SLEEP',
    item: 'ITM-PHA-003',
    duration: '1 час; любой урон или отвар завершает',
    removal: 'DAMAGE_OR_SPECIFIC_ANTIDOTE',
    mental: 'NO',
    react: 'NO',
    defend: 'NO',
  },
  PARALYSIS: {
    type: 'EFF-CONTROL-PARALYSIS',
    family: 'FAM-PHYSICAL_CONTROL',
    rule: 'CORE-062',
    profile: 'PRF-PARALYZED',
    item: 'ITM-PHA-004',
    duration: '1 час или до отвара; урон не завершает',
    removal: 'SOURCE_SPECIFIC',
    mental: 'CONDITIONAL_NO_SPEECH_MOVEMENT_BODY',
    react: 'NO_PHYSICAL',
    defend: 'NO_ACTIVE_PHYSICAL',
  },
} as const;
// CORE-061/062 specify one hour. This converts its unit, not a chosen game duration.
const MAXIMUM_MINUTES = 60;
function fail(detail: string): never {
  throw new Error(`NPC formal control: ${detail}`);
}
function integer(value: unknown, minimum = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : fail('safe integer required');
}
function kind(value: unknown): NpcFormalControlKind {
  return value === 'SLEEP' || value === 'PARALYSIS' ? value : fail('unknown formal control');
}
function requireCatalog(catalog: NpcFormalControlCatalog): void {
  if (!catalogs.has(catalog)) fail('issued source catalog required');
}
export function npcFormalControlMaximumRemainingMinutes(catalog: NpcFormalControlCatalog): string {
  requireCatalog(catalog);
  return String(MAXIMUM_MINUTES);
}
function one(value: unknown, key: string, id: string) {
  const rows = data
    .array(value)
    .map((r) => data.record(r))
    .filter((r) => r[key] === id);
  return rows.length === 1 ? rows[0]! : fail(`exact source ${id} required`);
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
export function readNpcFormalControlRemaining(value: unknown): string {
  const exact = decimal(value);
  if (exact.numerator <= 0n || exact.numerator > BigInt(MAXIMUM_MINUTES) * exact.denominator)
    return fail('remaining time must be positive and at most the source hour');
  return value as string;
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
  return fail('confirmed campaign calendar required');
}
function anchor(value: unknown): NpcFormalControlHistoryAnchor {
  const row = data.record(value, [
    'kind',
    'effectInstanceId',
    'npcUuid',
    'controlKind',
    'initialStateConfirmationId',
    'reason',
    'createdAt',
    'calendarAnchor',
    'remainingMinutes',
    'revision',
  ]);
  data.equal('GM_FORMAL_INITIAL_CONTROL', row.kind);
  const createdAt = data.text(row.createdAt);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  )
    return fail('saved canonical audit timestamp required');
  const reason = data.text(row.reason);
  if (reason.trim().length === 0) return fail('explicit reason required');
  return data.freeze({
    kind: 'GM_FORMAL_INITIAL_CONTROL',
    effectInstanceId: data.uuid(row.effectInstanceId),
    npcUuid: data.uuid(row.npcUuid),
    controlKind: kind(row.controlKind),
    initialStateConfirmationId: data.uuid(row.initialStateConfirmationId),
    reason,
    createdAt,
    calendarAnchor: calendar(row.calendarAnchor),
    remainingMinutes: readNpcFormalControlRemaining(row.remainingMinutes),
    revision: integer(row.revision, 1),
  });
}
export function createNpcFormalControlCatalog(
  source: Readonly<{
    rules: unknown;
    effectTypes: unknown;
    capabilityProfiles: unknown;
    pharmaceuticals: unknown;
    runtimeContracts: unknown;
    gaps: unknown;
    timerPolicies: unknown;
  }>,
): NpcFormalControlCatalog {
  data.record(source, [
    'rules',
    'effectTypes',
    'capabilityProfiles',
    'pharmaceuticals',
    'runtimeContracts',
    'gaps',
    'timerPolicies',
  ]);
  const formal = one(source.gaps, 'GapID', 'GAP-033');
  data.equal('RESOLVED_BY_THIS_REGISTRY', formal['Статус']);
  data.equal(
    'Разрешать только известный EffectTypeID с automationStatus не BLOCKED/NOT_MODELED и обязательными структурированными полями',
    formal['Действующая политика / решение'],
  );
  const permission = one(source.rules, 'Rule ID', 'AQA-028');
  data.equal('Активно', permission['Статус']);
  if (
    !data
      .text(permission['Итоговый алгоритм'])
      .includes('назначить или снять формализованное состояние')
  )
    fail('actual GM formal-state permission required');
  for (const definition of Object.values(DEFINITIONS)) {
    const effect = one(source.effectTypes, 'EffectTypeID', definition.type);
    for (const [field, expected] of Object.entries({
      Automation: 'AUTOMATED',
      'Schema status': 'DEFINED',
      FamilyCode: definition.family,
      'Stack policy': 'PER_SOURCE',
      'Timer policy': 'SOURCE_SPECIFIC_OR_EXPLICIT',
      'Removal policy': definition.removal,
    }))
      data.equal(expected, effect[field]);
    const profile = one(source.capabilityProfiles, 'ProfileID', definition.profile);
    for (const [field, expected] of Object.entries({
      Status: 'DEFINED',
      'Активные состояния': definition.type,
      'Физические действия': 'NO',
      Перемещение: 'NO',
      'Ментальные действия': definition.mental,
      Реакции: definition.react,
      'Активная защита': definition.defend,
      Броня: 'YES',
      Контроллер: 'owningController',
      'Таймеры / автономные эффекты': 'Autonomous effects continue',
    }))
      data.equal(expected, profile[field]);
    const medication = one(source.pharmaceuticals, 'ItemTypeID', definition.item);
    data.equal(definition.rule, medication['Rule ID']);
    data.equal(definition.duration, medication['Длительность']);
    const rule = one(source.rules, 'Rule ID', definition.rule);
    data.equal('Активно', rule['Статус']);
    if (!data.text(rule['Итоговый алгоритм']).includes('1 час'))
      fail('one-hour source lifetime required');
  }
  data.equal(
    'Хранить точные отметки времени',
    one(source.timerPolicies, 'PolicyID', 'TIME-004')['Алгоритм / инвариант'],
  );
  data.equal(
    'Не тикать и не уменьшать в момент создания',
    one(source.timerPolicies, 'PolicyID', 'TIME-017')['Алгоритм / инвариант'],
  );
  data.equal(
    'Смерть завершает временные эффекты и контроль; сохраняет травмы, раны, предметы, инвентарь и симбионтов; воскрешение не возобновляет',
    one(source.gaps, 'GapID', 'GAP-006')['Действующая политика / решение'],
  );
  const fields = data
    .array(source.runtimeContracts)
    .map((r) => data.record(r))
    .filter((r) => r.Entity === 'EffectInstance')
    .map((r) => r.Field);
  data.equal([...EFFECT_FIELDS].sort(), [...fields].sort());
  const result = Object.freeze({}) as NpcFormalControlCatalog;
  catalogs.add(result);
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
function build(
  catalog: NpcFormalControlCatalog,
  proof: NpcFormalControlHistoryAnchor,
  context: NpcFormalControlContext,
): NpcFormalControlEffectInstance {
  requireCatalog(catalog);
  data.record(context, ['npcUuid', 'campaignTimestamp', 'dead']);
  data.equal(proof.npcUuid, data.uuid(context.npcUuid));
  data.equal(false, context.dead);
  const now = integer(context.campaignTimestamp),
    start = proof.calendarAnchor.campaignTimestamp;
  const exact = decimal(proof.remainingMinutes),
    end = BigInt(start) * exact.denominator + exact.numerator;
  if (now < start || BigInt(now) * exact.denominator > end)
    return fail('current time is outside the independently saved lifetime');
  if (end > BigInt(Number.MAX_SAFE_INTEGER) * exact.denominator) return fail('calendar overflow');
  const digits = end.toString().padStart(exact.scale + 1, '0');
  const deadline =
    exact.scale === 0 ? digits : digits.slice(0, -exact.scale) + '.' + digits.slice(-exact.scale);
  const definition = DEFINITIONS[proof.controlKind];
  return data.freeze({
    effectInstanceId: proof.effectInstanceId,
    effectTypeId: definition.type,
    familyCode: definition.family,
    targetActorId: proof.npcUuid,
    targetRegionId: null,
    sourceRuleIds: [definition.rule, 'CORE-103'],
    sourceEntityId: null,
    sourceInstanceId: null,
    sourceSnapshot: null,
    sourceLifecyclePolicy: 'SOURCE_SPECIFIC',
    stackingKey: definition.rule,
    payload: { controlKind: proof.controlKind, assignedByGM: true },
    magnitude: null,
    tags: ['CONTROL'],
    createdAt: proof.createdAt,
    startsAt: { campaignTimestampExact: String(start) },
    expiresAt: { campaignTimestampExact: deadline },
    remainingExact: proof.remainingMinutes,
    durationUnit: 'MINUTE',
    tickSchedule: null,
    lastTickAt: null,
    status: 'ACTIVE',
    revision: proof.revision,
    removalReason: null,
    createdBy: 'GM',
    variantKey: definition.rule,
    aggregateKey: `${definition.type}|${definition.rule}|null`,
    deathDisposition: 'TERMINATE_ON_DEATH',
  });
}
/** The initial state is not a drug-use event: no dose, resistance roll or combat action is created. */
export function createNpcFormalControlEffect(
  catalog: NpcFormalControlCatalog,
  supplied: NpcFormalControlHistoryAnchor,
  context: NpcFormalControlContext,
): NpcFormalControlEffectInstance {
  const proof = anchor(supplied);
  if (proof.revision !== 1) return fail('new initial assignment starts at revision one');
  data.equal(proof.calendarAnchor.campaignTimestamp, context.campaignTimestamp);
  return build(catalog, proof, context);
}
/** The owning reader supplies the original immutable preparation, independently from the candidate. */
export function validateNpcFormalControlEffect(
  catalog: NpcFormalControlCatalog,
  candidate: unknown,
  original: NpcFormalControlHistoryAnchor,
  context: NpcFormalControlContext,
): NpcFormalControlEffectInstance {
  data.record(candidate, EFFECT_FIELDS);
  const expected = build(catalog, anchor(original), context);
  data.equal(expected, candidate);
  return expected;
}
/** Restrictions only; the complete owner still resolves source-specific controller/response overrides. */
export function npcFormalControlRestriction(
  catalog: NpcFormalControlCatalog,
  controlKind: NpcFormalControlKind,
) {
  requireCatalog(catalog);
  const definition = DEFINITIONS[kind(controlKind)];
  return Object.freeze({
    profileId: definition.profile,
    physicalActions: 'NO' as const,
    movement: 'NO' as const,
    mentalActions: definition.mental,
    reactions: definition.react,
    activeDefense: definition.defend,
    armor: 'YES' as const,
    controller: 'owningController' as const,
  });
}
