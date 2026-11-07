import {
  evaluateNpcCompositionConsequences,
  type NpcCompositionConsequenceCatalog,
} from './composition-consequences.js';
import type { NpcOrdinaryCompositionInstance } from './ordinary-composition-types.js';
import type { NpcInitialTraumaCalendarAnchor } from './initial-trauma.js';
import { npcPublicationData as data } from './inventory-publication.js';

export type NpcFormalWeaverBranch =
  'REPLACEMENT_TEMPORARY' | 'REPLACEMENT_RECOVERY' | 'DUPLICATED_ORGANS_PROTECTION';
export interface NpcFormalWeaverHistoryAnchor {
  readonly kind: 'GM_FORMAL_INITIAL_WEAVER';
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly effectInstanceId: string;
  readonly sourceInstanceId: string;
  readonly sourceOperationId: string;
  readonly branch: NpcFormalWeaverBranch;
  readonly reason: string;
  readonly createdAt: string;
  readonly calendarAnchor: NpcInitialTraumaCalendarAnchor;
  readonly remainingMinutes: string;
  readonly revision: 1;
}
export type NpcFormalWeaverOrigin =
  | Readonly<{ kind: 'PREPARED'; preparationOperationId: string }>
  | Readonly<{ kind: 'COMMITTED'; originCommitOperationId: string }>;
export interface NpcFormalWeaverContext {
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly campaignTimestamp: number;
  readonly origin: NpcFormalWeaverOrigin;
  /** Independently reconstructed owning preparation / original COMMIT prefix. */
  readonly originalCompositionProof: unknown;
  readonly currentCompositionProof: unknown;
}
export interface NpcFormalWeaverEffectInstance {
  readonly effectInstanceId: string;
  readonly effectTypeId: 'EFF-CAPABILITY-SEVERE_WOUND' | 'EFF-PROTECTION-SEVERE_WOUND';
  readonly familyCode: 'FAM-LIFECYCLE';
  readonly targetActorId: string;
  readonly targetRegionId: null;
  readonly sourceRuleIds: readonly string[];
  readonly sourceEntityId: string;
  readonly sourceInstanceId: string;
  readonly sourceSnapshot: NpcOrdinaryCompositionInstance;
  readonly sourceLifecyclePolicy: 'SOURCE_SPECIFIC';
  readonly stackingKey: string;
  readonly payload: Readonly<{
    kind: 'GM_FORMAL_INITIAL_WEAVER';
    campaignId: string;
    sourceOperationId: string;
    branch: NpcFormalWeaverBranch;
    originalR20: null;
    assignedByGM: true;
    recoveryOnExpiry: 'NONE' | 'CORE_156_ONLY_WITH_PROVEN_NO_NEW_HP_LOSS';
    protection: 'NONE' | 'UNCONSUMED_CORE_182';
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
  readonly variantKey: NpcFormalWeaverBranch;
  readonly aggregateKey: string;
  readonly deathDisposition: 'TERMINATE_ON_DEATH';
}
declare const catalogBrand: unique symbol;
declare const contributionBrand: unique symbol;
export interface NpcFormalWeaverCatalog {
  readonly [catalogBrand]: true;
}
/** Issued source/time contribution, deliberately not proof of a complete valid life state. */
export interface NpcFormalWeaverEffectContribution {
  readonly [contributionBrand]: true;
}
interface CatalogContext {
  readonly composition: NpcCompositionConsequenceCatalog;
  readonly maximum: Readonly<Record<NpcFormalWeaverBranch, number>>;
}
const catalogs = new WeakMap<NpcFormalWeaverCatalog, CatalogContext>();
const contributions = new WeakMap<
  NpcFormalWeaverEffectContribution,
  Readonly<{
    effect: NpcFormalWeaverEffectInstance;
    history: NpcFormalWeaverHistoryAnchor;
    context: NpcFormalWeaverContext;
  }>
>();
export class NpcFormalWeaverError extends Error {
  constructor(detail: string) {
    super('NPC formal Weaver: ' + detail);
    this.name = 'NpcFormalWeaverError';
  }
}
/** Only a verified original effect that is unavailable in the current draft may become a blocker. */
export class NpcFormalWeaverCurrentUnavailableError extends NpcFormalWeaverError {
  constructor(
    readonly kind: 'CURRENT_SOURCE_UNAVAILABLE' | 'CURRENT_EFFECT_EXPIRED',
    detail: string,
  ) {
    super(detail);
    this.name = 'NpcFormalWeaverCurrentUnavailableError';
  }
}
function fail(detail: string): never {
  throw new NpcFormalWeaverError(detail);
}
function one(value: unknown, field: string, id: string) {
  const rows = data
    .array(value)
    .map((r) => data.record(r))
    .filter((r) => r[field] === id);
  return rows.length === 1 ? rows[0]! : fail('exact source ' + id + ' required');
}
function branch(value: unknown): NpcFormalWeaverBranch {
  return value === 'REPLACEMENT_TEMPORARY' ||
    value === 'REPLACEMENT_RECOVERY' ||
    value === 'DUPLICATED_ORGANS_PROTECTION'
    ? value
    : fail('explicit known branch required');
}
function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail('confirmed exact virtual minute required');
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
export function compareNpcFormalWeaverExactTimes(a: string, b: string): number {
  const x = decimal(a),
    y = decimal(b),
    difference = x.numerator * y.denominator - y.numerator * x.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
function catalogContext(catalog: NpcFormalWeaverCatalog) {
  return catalogs.get(catalog) ?? fail('issued source catalog required');
}
export function npcFormalWeaverMaximumRemainingMinutes(
  catalog: NpcFormalWeaverCatalog,
  value: NpcFormalWeaverBranch,
): string {
  return String(catalogContext(catalog).maximum[branch(value)]);
}
export function readNpcFormalWeaverRemaining(
  catalog: NpcFormalWeaverCatalog,
  value: unknown,
  kind: NpcFormalWeaverBranch,
): string {
  const exact = decimal(value),
    maximum = catalogContext(catalog).maximum[branch(kind)];
  if (exact.numerator <= 0n || exact.numerator > BigInt(maximum) * exact.denominator)
    return fail('remaining time exceeds the accepted formal branch bound');
  return value as string;
}
export function createNpcFormalWeaverCatalog(
  source: Readonly<{
    compositionConsequences: NpcCompositionConsequenceCatalog;
    rules: unknown;
    developmentNodes: unknown;
    abilityContexts: unknown;
    effectTypes: unknown;
    npcInitialStateForm: unknown;
  }>,
): NpcFormalWeaverCatalog {
  data.record(source, [
    'compositionConsequences',
    'rules',
    'developmentNodes',
    'abilityContexts',
    'effectTypes',
    'npcInitialStateForm',
  ]);
  const form = data.record(source.npcInitialStateForm);
  data.equal('NPC-016', form.id);
  const fields = data.array(form.requiredFields),
    states = data.record(form.states);
  for (const field of [
    'temporaryWeaverStates[]',
    'temporaryWeaverStatePreparations[]',
    'temporaryWeaverValidationSummary',
  ])
    if (!fields.includes(field)) return fail('accepted ADR0086 source delivery required: ' + field);
  for (const state of ['TEMPORARY_WEAVER_VALID', 'TEMPORARY_WEAVER_INVALID'])
    data.text(states[state]);
  const clauses = data.array(form.acceptanceCriteria).map((v) => data.text(v));
  for (const witness of FORMAL_SOURCE_WITNESSES)
    if (!clauses.includes(witness)) return fail('accepted ADR0086 source clause absent or changed');
  const duration = clauses.find((v) => v.startsWith('ADR0086 formal duration:'));
  const caps = duration?.match(
    /Для REPLACEMENT_TEMPORARY максимум (\d+) минут, REPLACEMENT_RECOVERY — (\d+) минут, DUPLICATED_ORGANS_PROTECTION — (\d+) минут/u,
  );
  if (caps === undefined || caps === null) return fail('exact formal duration source required');
  const maximum = {
    REPLACEMENT_TEMPORARY: integer(Number(caps[1])),
    REPLACEMENT_RECOVERY: integer(Number(caps[2])),
    DUPLICATED_ORGANS_PROTECTION: integer(Number(caps[3])),
  };
  for (const [id, level, parent] of [
    ['SYM-028', 2, 'SYM-027'],
    ['SYM-030', 3, 'SYM-028'],
  ] as const) {
    const node = one(source.developmentNodes, 'NodeRef', id);
    for (const [field, expected] of Object.entries({
      SpeciesKey: 'WEAVER',
      AbilityID: id,
      'Rule IDs': id,
      L: level,
      ParentNodeRef: parent,
      BranchCode: 'SELF_REGENERATION',
      AutomationStatus: 'AUTOMATED_ACCEPTED',
    }))
      data.equal(expected, node[field]);
    data.equal('Активно', one(source.rules, 'Rule ID', id)['Статус']);
    const context = one(source.abilityContexts, 'AbilityContextID', 'CTX-' + id + '-PEACE');
    data.equal(id, context.AbilityID);
    data.equal('PEACE', context.Context);
    data.equal(id === 'SYM-028', context.Allowed);
    if (id === 'SYM-030') {
      data.equal('Не выполняется', context.RollDefinition);
      data.equal('Нет', context.StateWrites);
    }
  }
  for (const [type, stack, removal] of [
    ['EFF-CAPABILITY-SEVERE_WOUND', 'BOOLEAN_BY_ANY_ACTIVE_SOURCE', 'SOURCE_END'],
    ['EFF-PROTECTION-SEVERE_WOUND', 'PRIORITY_CONSUMABLE', 'CONSUME_ON_TRIGGER'],
  ] as const) {
    const row = one(source.effectTypes, 'EffectTypeID', type);
    for (const [field, expected] of Object.entries({
      Automation: 'AUTOMATED',
      'Schema status': 'DEFINED',
      FamilyCode: 'FAM-LIFECYCLE',
      'Stack policy': stack,
      'Removal policy': removal,
      'Timer policy': 'SOURCE_SPECIFIC_OR_EXPLICIT',
    }))
      data.equal(expected, row[field]);
  }
  const catalog = Object.freeze({}) as NpcFormalWeaverCatalog;
  catalogs.set(catalog, data.freeze({ composition: source.compositionConsequences, maximum }));
  return catalog;
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
function history(catalog: NpcFormalWeaverCatalog, value: unknown): NpcFormalWeaverHistoryAnchor {
  const row = data.record(value, [
    'kind',
    'campaignId',
    'npcUuid',
    'effectInstanceId',
    'sourceInstanceId',
    'sourceOperationId',
    'branch',
    'reason',
    'createdAt',
    'calendarAnchor',
    'remainingMinutes',
    'revision',
  ]);
  data.equal('GM_FORMAL_INITIAL_WEAVER', row.kind);
  data.equal(1, row.revision);
  const kind = branch(row.branch),
    reason = data.text(row.reason),
    createdAt = data.text(row.createdAt);
  if (reason.trim().length === 0) return fail('explicit assignment reason required');
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  )
    return fail('saved canonical audit timestamp required');
  return data.freeze({
    kind: 'GM_FORMAL_INITIAL_WEAVER',
    campaignId: data.uuid(row.campaignId),
    npcUuid: data.uuid(row.npcUuid),
    effectInstanceId: data.uuid(row.effectInstanceId),
    sourceInstanceId: data.uuid(row.sourceInstanceId),
    sourceOperationId: data.uuid(row.sourceOperationId),
    branch: kind,
    reason,
    createdAt,
    calendarAnchor: calendar(row.calendarAnchor),
    remainingMinutes: readNpcFormalWeaverRemaining(catalog, row.remainingMinutes, kind),
    revision: 1,
  });
}
function actualComposition(catalog: NpcFormalWeaverCatalog, proof: unknown, npcUuid: string) {
  const actual = evaluateNpcCompositionConsequences(
    catalogContext(catalog).composition,
    proof,
    null,
  );
  data.equal(npcUuid, actual.proof.identityKey);
  if (actual.obligationStatus !== 'RESOLVED') return fail('complete actual composition required');
  return actual.composition;
}
/** Offered sources require no invented effect, preparation, roll, or clock identity. */
export function npcFormalWeaverSourceChoices(
  catalog: NpcFormalWeaverCatalog,
  input: Readonly<{ npcUuid: string; compositionProof: unknown }>,
): readonly Readonly<{
  sourceInstanceId: string;
  branches: readonly Readonly<{
    branch: NpcFormalWeaverBranch;
    maximumRemainingMinutes: string;
  }>[];
}>[] {
  const row = data.record(input, ['npcUuid', 'compositionProof']);
  const actual = actualComposition(catalog, row.compositionProof, data.uuid(row.npcUuid));
  return data.freeze(
    actual.instances.flatMap((member) => {
      if (member.speciesKey !== 'WEAVER' || member.status !== 'ACTIVE' || !member.effectsEnabled)
        return [];
      const branches: NpcFormalWeaverBranch[] = [];
      if (member.learnedNodeRefs.includes('SYM-028'))
        branches.push('REPLACEMENT_TEMPORARY', 'REPLACEMENT_RECOVERY');
      if (member.learnedNodeRefs.includes('SYM-030')) branches.push('DUPLICATED_ORGANS_PROTECTION');
      return branches.length === 0
        ? []
        : [
            {
              sourceInstanceId: member.symbiontInstanceId,
              branches: branches.map((branch) => ({
                branch,
                maximumRemainingMinutes: npcFormalWeaverMaximumRemainingMinutes(catalog, branch),
              })),
            },
          ];
    }),
  );
}
function actualMember(
  catalog: NpcFormalWeaverCatalog,
  proof: unknown,
  npcUuid: string,
  sourceInstanceId: string,
  kind: NpcFormalWeaverBranch,
  phase: 'ORIGINAL' | 'CURRENT',
) {
  const actual = actualComposition(catalog, proof, npcUuid);
  const member = actual.instances.find((m) => m.symbiontInstanceId === sourceInstanceId);
  const rule = kind === 'DUPLICATED_ORGANS_PROTECTION' ? 'SYM-030' : 'SYM-028';
  if (
    member === undefined ||
    member.speciesKey !== 'WEAVER' ||
    member.status !== 'ACTIVE' ||
    !member.effectsEnabled ||
    !member.learnedNodeRefs.includes(rule)
  ) {
    const detail =
      'actual active learned Weaver source required; remove an incompatible retained state explicitly';
    if (phase === 'CURRENT')
      throw new NpcFormalWeaverCurrentUnavailableError('CURRENT_SOURCE_UNAVAILABLE', detail);
    return fail(detail);
  }
  return member;
}
export function deriveNpcFormalWeaverEffectContribution(
  catalog: NpcFormalWeaverCatalog,
  supplied: NpcFormalWeaverHistoryAnchor,
  context: NpcFormalWeaverContext,
): NpcFormalWeaverEffectContribution {
  const anchor = history(catalog, supplied);
  data.record(context, [
    'campaignId',
    'npcUuid',
    'campaignTimestamp',
    'origin',
    'originalCompositionProof',
    'currentCompositionProof',
  ]);
  data.equal(anchor.campaignId, data.uuid(context.campaignId));
  data.equal(anchor.npcUuid, data.uuid(context.npcUuid));
  const now = integer(context.campaignTimestamp),
    start = anchor.calendarAnchor.campaignTimestamp;
  const origin = data.record(context.origin);
  if (origin.kind === 'PREPARED') {
    data.record(origin, ['kind', 'preparationOperationId']);
    data.equal(anchor.sourceOperationId, data.uuid(origin.preparationOperationId));
    data.equal(start, now);
    data.equal(context.originalCompositionProof, context.currentCompositionProof);
  } else if (origin.kind === 'COMMITTED') {
    data.record(origin, ['kind', 'originCommitOperationId']);
    data.uuid(origin.originCommitOperationId);
  } else return fail('actual PREPARED or original COMMIT origin required');
  const original = actualMember(
    catalog,
    context.originalCompositionProof,
    anchor.npcUuid,
    anchor.sourceInstanceId,
    anchor.branch,
    'ORIGINAL',
  );
  const exact = decimal(anchor.remainingMinutes),
    end = BigInt(start) * exact.denominator + exact.numerator;
  if (now < start) return fail('current clock precedes valid original Weaver state');
  if (end > BigInt(Number.MAX_SAFE_INTEGER) * exact.denominator) return fail('calendar overflow');
  actualMember(
    catalog,
    context.currentCompositionProof,
    anchor.npcUuid,
    anchor.sourceInstanceId,
    anchor.branch,
    'CURRENT',
  );
  if (BigInt(now) * exact.denominator >= end)
    throw new NpcFormalWeaverCurrentUnavailableError(
      'CURRENT_EFFECT_EXPIRED',
      'expired unresolved Weaver source requires actual lifecycle resolution',
    );
  const protection = anchor.branch === 'DUPLICATED_ORGANS_PROTECTION',
    rule = protection ? 'SYM-030' : 'SYM-028';
  const type = protection ? 'EFF-PROTECTION-SEVERE_WOUND' : 'EFF-CAPABILITY-SEVERE_WOUND';
  const effect: NpcFormalWeaverEffectInstance = {
    effectInstanceId: anchor.effectInstanceId,
    effectTypeId: type,
    familyCode: 'FAM-LIFECYCLE',
    targetActorId: anchor.npcUuid,
    targetRegionId: null,
    sourceRuleIds: [
      rule,
      'CORE-154',
      ...(protection ? ['CORE-182'] : anchor.branch === 'REPLACEMENT_RECOVERY' ? ['CORE-156'] : []),
    ],
    sourceEntityId: anchor.npcUuid,
    sourceInstanceId: anchor.sourceInstanceId,
    sourceSnapshot: original,
    sourceLifecyclePolicy: 'SOURCE_SPECIFIC',
    stackingKey: rule + '|' + anchor.sourceInstanceId,
    payload: {
      kind: 'GM_FORMAL_INITIAL_WEAVER',
      campaignId: anchor.campaignId,
      sourceOperationId: anchor.sourceOperationId,
      branch: anchor.branch,
      originalR20: null,
      assignedByGM: true,
      recoveryOnExpiry:
        anchor.branch === 'REPLACEMENT_RECOVERY'
          ? 'CORE_156_ONLY_WITH_PROVEN_NO_NEW_HP_LOSS'
          : 'NONE',
      protection: protection ? 'UNCONSUMED_CORE_182' : 'NONE',
    },
    magnitude: null,
    tags: ['LIFECYCLE'],
    createdAt: anchor.createdAt,
    startsAt: { campaignTimestampExact: String(start) },
    expiresAt: { campaignTimestampExact: exactText(end, exact.scale) },
    remainingExact: exactText(end - BigInt(now) * exact.denominator, exact.scale),
    durationUnit: 'MINUTE',
    tickSchedule: null,
    lastTickAt: null,
    status: 'ACTIVE',
    revision: 1,
    removalReason: null,
    createdBy: 'GM',
    variantKey: anchor.branch,
    aggregateKey: type + '|' + rule + '|' + anchor.sourceInstanceId,
    deathDisposition: 'TERMINATE_ON_DEATH',
  };
  const contribution = Object.freeze({}) as NpcFormalWeaverEffectContribution;
  contributions.set(contribution, data.freeze({ effect, history: anchor, context }));
  return contribution;
}
export function readNpcFormalWeaverEffectContribution(value: unknown) {
  if (value === null || typeof value !== 'object')
    return fail('independently issued formal source/time contribution required');
  return (
    contributions.get(value as NpcFormalWeaverEffectContribution) ??
    fail('independently issued formal source/time contribution required')
  );
}
export function validateNpcFormalWeaverEffectContribution(
  catalog: NpcFormalWeaverCatalog,
  candidate: unknown,
  original: NpcFormalWeaverHistoryAnchor,
  context: NpcFormalWeaverContext,
) {
  let proof: NpcFormalWeaverEffectContribution;
  try {
    proof = deriveNpcFormalWeaverEffectContribution(catalog, original, context);
  } catch (error) {
    // A stored candidate must be verified at its own actual saved target minute.
    // Only a separate current derivation after that check may become a UI blocker.
    if (error instanceof NpcFormalWeaverCurrentUnavailableError)
      return fail('saved candidate requires a fully valid source/time context: ' + error.kind);
    throw error;
  }
  data.equal(readNpcFormalWeaverEffectContribution(proof).effect, candidate);
  return proof;
}
/** Whole-source cardinality, without merging independently owned timers or multiplying ×4. */
export function assertNpcFormalWeaverContributionSet(
  values: readonly NpcFormalWeaverEffectContribution[],
): void {
  const ids = new Set<string>(),
    slots = new Set<string>();
  for (const value of values) {
    const { history } = readNpcFormalWeaverEffectContribution(value);
    const key =
      history.sourceInstanceId +
      '|' +
      (history.branch === 'DUPLICATED_ORGANS_PROTECTION' ? 'PROTECTION' : 'REPLACEMENT');
    if (ids.has(history.effectInstanceId) || slots.has(key))
      return fail('duplicate effect identity or conflicting Weaver branch');
    ids.add(history.effectInstanceId);
    slots.add(key);
  }
}

// ADR0086 is an accepted, separately delivered source amendment, not inferred activation policy.
const FORMAL_SOURCE_WITNESSES: readonly string[] = [
  'ADR0086 / #239: NPC-016 задаёт отдельное формальное текущее состояние Ткача, а не прошлую или новую сыгранную активацию: REPLACEMENT_TEMPORARY — временная функция без восстановления при окончании; REPLACEMENT_RECOVERY — функция с source восстановлением SYM-028 при окончании только без новой потери HP после назначения; DUPLICATED_ORGANS_PROTECTION — текущие задвоенные органы с неиспользованной защитой SYM-030. Original R20 имеет явное ABSENT; fake roll/receipt не создаются, неуспешные исходы обычной активации (SYM-028: R1/2; SYM-030: R1) не воспроизводятся. Обычная активация и CTX-SYM-030-PEACE=false неизменны; formal control не является кнопкой peaceful activation.',
  'ADR0086 source/life closure: нужен actual active/effectsEnabled WEAVER с изученным SYM-028 для REPLACEMENT_TEMPORARY/REPLACEMENT_RECOVERY либо SYM-030 для DUPLICATED_ORGANS_PROTECTION. CurrentOE сохраняется точно, включая 0; OE, действия и RNG не расходуются. DEAD запрещает эти личные эффекты. Оба REPLACEMENT на итоговом PREVIEW/COMMIT требуют SEVERELY_WOUNDED, HP=0 и подтверждённое abstractVitalSystemDamaged без organId. PROTECTION допускает ALIVE либо formal SEVERELY_WOUNDED, которое само не расходует защиту и не является сыгранным HP→0. Технический preparation допускает незавершённый draft; final PREVIEW/COMMIT совместно замыкает source, effect и life proof, не требует вымышленной прошлой активации.',
  'ADR0086 formal duration: GM явно вводит canonical decimal-string remainingMinutes и подтверждает виртуальную минуту T; defaults отсутствуют. Для REPLACEMENT_TEMPORARY максимум 5 минут, REPLACEMENT_RECOVERY — 7 минут, DUPLICATED_ORGANS_PROTECTION — 10 минут; 0<remainingMinutes<=соответствующий максимум и deadline=T+remainingMinutes точно. Это принятые максимумы нового formal-assignment контракта, равные верхним срокам успешных натуральных R20 после source округления, но не доказательство какого-либо R20. Назначение не тикает, не запускает clock и не округляет остаток повторно.',
  'ADR0086 cardinality: на одном WEAVER допускается не более одной текущей замены (REPLACEMENT_TEMPORARY либо REPLACEMENT_RECOVERY) и не более одной DUPLICATED_ORGANS_PROTECTION. Отдельные IDs, origins и deadlines не сливаются. Функциональный дубль возникает только из полностью проверенного issued effect token; несколько источников не усиливают исходный ×4. Сам formal life input не лечит и не расходует защиту.',
  'ADR0086 recovery deadline: для REPLACEMENT_RECOVERY выбранный death deadline уже должен быть не раньше replacement deadline. Новый severe assignment требует явно введённого совместимого остатка; несовместимый ввод блокируется с показом обоих сроков. Retained severe original death deadline никогда не продлевается редактором; новый или оставшийся RECOVERY допустим только если уже укладывается. Скрытый max, новый life D6 и перезапуск жизни запрещены. Альтернативное formal продление срока этим решением не принято.',
  'ADR0086 lifecycle boundary: будущий обычный resolver при TEMPORARY expiry прекращает только текущую дееспособность этого источника, сохраняя доказанный исходный ×4; RECOVERY expiry выполняет CORE-156/HP=1 только при доказанном отсутствии новой потери HP после назначения. Новая потеря HP в severe вызывает смерть по существующему правилу. SYM-030 protection расходуется только настоящим incoming HP→0 по CORE-182. PREVIEW, COMMIT, reopen и replay не выполняют expiry, reanimation или damage и не превращают истёкший эффект в живой. Истёкший неразрешённый source блокирует current snapshot до настоящего разрешения; будущий lifecycle executor этим срезом не добавляется.',
  'ADR0086 retained state: N+1 без изменения сохраняет точные original effect ID/COMMIT/T/deadline/branch. Same identity не получает новый срок. Явное снятие требует отдельной причины; повторное formal назначение создаёт новый source operation/effect identity и не меняет старую запись, не даёт автоматически нового life D6 и не продлевает original death deadline. Если actual source удалён, отключён или лишён нужного изученного узла, сохранение эффекта в новой версии блокируется до явного снятия несовместимого состояния. Это authoring guard, не новое общее played-source termination правило.',
  'ADR0086 origin/replay: source — реальная immutable NPC-016 operation; PREPARED и original COMMIT различаются. Candidate хранит только refs, host независимо восстанавливает owning operation и original COMMIT; current composition/clock повторно проверяются на COMMIT. Stale/foreign/changed request даёт zero write, exact replay прежний receipt. Historical snapshots читаются со своим original context и не переписываются; прежние FINAL/receipts и отсутствие полей неизменны.',
  'ADR0086 controls: NPC-016 показывает actual доступные WEAVER instances/узлы, явный branch, причину, точный остаток, подтверждённую T/deadline, поле причины явного снятия и понятные blockers. Для RECOVERY явно показаны оба срока и обязательная совместимость. Нет editable originalR20, checkbox «раньше был дубль» или произвольного multiplier. NPC-017, NPC-003 и NPC-007 показывают исходный множитель отдельно от текущей дееспособности, actual origin, branch/deadline и preservation/expiry/protection semantics. Read-only итог не заменяет controls; обычная peaceful activation SYM-030 остаётся недоступной. Используется существующий NPC wizard без нового игрового workflow/OperationID.',
];
