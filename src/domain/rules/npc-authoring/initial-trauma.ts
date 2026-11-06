import type { ArmorBodyZone } from '../item-stage/armor-bundle.js';
import type { NpcTraumaInstance } from './effect-types.js';
import { readNpcTraumaInstance } from './trauma-instances.js';

export type NpcInitialTraumaCalendarAnchor =
  | Readonly<{
      kind: 'PRE_START_INITIAL';
      campaignTimestamp: number;
      lobbySnapshotRevision: string;
    }>
  | Readonly<{ kind: 'CURRENT_CAMPAIGN'; campaignTimestamp: number; stateRevision: number }>;
export interface NpcInitialTraumaScope {
  readonly campaignId: string;
  readonly gmLocalContextId: string;
  readonly ownerDeviceId: string;
}
export interface NpcInitialTraumaOrigin {
  readonly commitOperationId: string;
  readonly sourceOperationId: string;
  readonly version: number;
  readonly committedAt: string;
}
type UntimedConsequence =
  | Readonly<{ kind: 'LIMB' }>
  | Readonly<{ kind: 'TORSO'; hpInterpretation: 'CURRENT_HP_ALREADY_FINAL' }>;
type HeadPenalty = 'PENDING' | 'CONSUMED';
export type NpcInitialTraumaConsequence =
  | UntimedConsequence
  | Readonly<{
      kind: 'HEAD';
      penalty: HeadPenalty;
      stun:
        Readonly<{ status: 'ABSENT' }> | Readonly<{ status: 'ACTIVE'; remainingMinutes: string }>;
    }>;
export interface NpcInitialTraumaChoice {
  readonly traumaInstanceId: string;
  readonly reason: string;
  readonly consequence: NpcInitialTraumaConsequence;
}
type SealedConsequence =
  | UntimedConsequence
  | Readonly<{
      kind: 'HEAD';
      penalty: HeadPenalty;
      stun:
        | Readonly<{ status: 'ABSENT' }>
        | Readonly<{
            status: 'ACTIVE';
            remainingMinutes: string;
            calendarAnchor: NpcInitialTraumaCalendarAnchor;
          }>;
    }>;
export interface NpcInitialTraumaFact {
  readonly format: 'NPC_INITIAL_TRAUMA_V1';
  readonly originKind: 'INITIAL_STATE_AUTHORING';
  readonly scope: NpcInitialTraumaScope;
  readonly npcUuid: string;
  readonly origin: NpcInitialTraumaOrigin;
  readonly trauma: NpcTraumaInstance;
  readonly reason: string;
  readonly consequence: SealedConsequence;
}
/** Supplied from actual owning records, never reconstructed from the candidate fact. */
export interface NpcInitialTraumaEvidence {
  readonly phase: 'PENDING_COMMIT' | 'COMMITTED';
  readonly scope: NpcInitialTraumaScope;
  readonly npcUuid: string;
  readonly origin: NpcInitialTraumaOrigin;
  readonly trauma: NpcTraumaInstance;
  readonly choice: NpcInitialTraumaChoice;
  readonly calendarAnchorOrNull: NpcInitialTraumaCalendarAnchor | null;
}
/** Actual owning read/write boundary, distinct from each retained fact's original phase. */
export type NpcInitialTraumaDerivationBoundary =
  | Readonly<{ kind: 'HISTORICAL' }>
  | Readonly<{
      kind: 'PENDING_COMMIT';
      commitOperationId: string;
      version: number;
      committedAt: string;
    }>;
type Limb = Extract<ArmorBodyZone, 'ARM_L' | 'ARM_R' | 'LEG_L' | 'LEG_R'>;
export interface NpcInitialTraumaContribution {
  readonly kind: 'INITIAL_TRAUMA_COMPONENT_ONLY';
  readonly limbs: readonly Readonly<{
    regionId: Limb;
    traumaTotal: number;
    localCheckPenalty: number;
    disabled: boolean;
  }>[];
  readonly movementAndDodgeLocalPenalty: number;
  readonly globalCheckPenalty: number;
  readonly pendingHeadPenalties: readonly Readonly<{
    traumaInstanceId: string;
    checkPenalty: number;
  }>[];
  readonly headStuns: readonly Readonly<{
    traumaInstanceId: string;
    deadlineMinutes: string;
    remainingMinutes: string;
    activeNow: boolean;
  }>[];
  readonly hpDelta: 0;
  readonly requiresCampaignTime: boolean;
}
declare const issued: unique symbol;
export interface NpcInitialTraumaCatalog {
  readonly [issued]: true;
}
const catalogs = new WeakSet<NpcInitialTraumaCatalog>();
const ANATOMY = Object.freeze({ anatomyProfileId: 'STANDARD_HUMANOID' as const });
const LIMBS = ['ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?(?![\s\S])/u;
type Row = Readonly<Record<string, unknown>>;
export class NpcInitialTraumaError extends Error {
  constructor(detail: string) {
    super(`NPC initial trauma: ${detail}`);
    this.name = new.target.name;
  }
}
function fail(detail: string): never {
  throw new NpcInitialTraumaError(detail);
}
function record(value: unknown, keys?: readonly string[]): Row {
  if (value === null || typeof value !== 'object') return fail('plain data record required');
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return fail('plain data record required');
  const own = Reflect.ownKeys(value),
    descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    own.some((key) => typeof key !== 'string') ||
    Object.values(descriptors).some((d) => !d.enumerable || !Object.hasOwn(d, 'value')) ||
    (keys !== undefined &&
      (keys.length !== own.length || keys.some((k) => !Object.hasOwn(value, k))))
  )
    return fail('unknown, missing, hidden or accessor fields');
  const detached: Record<string, unknown> = {};
  for (const key of own)
    if (typeof key === 'string') {
      const descriptor = descriptors[key];
      if (descriptor === undefined) return fail('data descriptor disappeared');
      detached[key] = descriptor.value as unknown;
    }
  return detached;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail('plain dense array required');
  const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    Reflect.ownKeys(value).length !== length + 1
  )
    return fail('array fields differ');
  return Array.from({ length }, (_, index) => {
    const d = Object.getOwnPropertyDescriptor(value, String(index));
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
      return fail('array hole or accessor');
    return d.value as unknown;
  });
}
function text(value: unknown): string {
  return typeof value === 'string' && value.trim().length !== 0
    ? value
    : fail('explicit nonempty text required');
}
function uuid(value: unknown): string {
  return typeof value === 'string' && UUID.test(value) ? value : fail('canonical UUID v4 required');
}
function integer(value: unknown, minimum = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : fail('exact safe integer required');
}
function equal(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(label + ' differs');
}
function requireCatalog(catalog: NpcInitialTraumaCatalog): void {
  if (!catalogs.has(catalog)) fail('issued source catalog required');
}
function one(rows: unknown, key: string, id: string): Row {
  const matches = array(rows)
    .map((row) => record(row))
    .filter((row) => row[key] === id);
  return matches.length === 1 && matches[0] !== undefined
    ? matches[0]
    : fail(`one ${id} source required`);
}
function fields(row: Row, expected: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(expected))
    if (row[key] !== value) fail(`source ${key} differs`);
}
/** Exact witnesses bind this component; this does not register APPLY_TRAUMA or a STUN handler. */
export function createNpcInitialTraumaCatalog(
  source: Readonly<{
    rules: unknown;
    combinationRules: unknown;
    runtimeContracts: unknown;
    timerPolicies: unknown;
    npc016: unknown;
  }>,
): NpcInitialTraumaCatalog {
  const s = record(source, [
    'rules',
    'combinationRules',
    'runtimeContracts',
    'timerPolicies',
    'npc016',
  ]);
  fields(one(s.rules, 'Rule ID', 'CORE-119'), {
    'Атомарность / аудит':
      'Если суммарная травма превышает 6, конечность становится недействующей; общий штраф −5 применяется один раз за каждую недействующую конечность.',
    'Броски / формулы':
      'независимый R12, Z.\ninjury=max(0,round_math(R12−Z/3)); нога — штраф injury к перемещению/уклонению (штрафы двух ног суммируются); рука — штраф injury к атаке/защите при использовании этой руки.',
  });
  fields(one(s.rules, 'Rule ID', 'CORE-120'), {
    'Итоговый алгоритм':
      'Нормативная база (действует во всей непротиворечащей части):\nналожить прямой −injury на следующее действие цели; если injury>6 — оглушить: пропуск следующего хода в бою / отключение на 5 минут вне боя. Любая активная защита головы получает +5.\nПриоритетные авторские дельты (заменяют только прямо пересекающиеся ветви):\n[Q-CORE-034] Штраф травмы головы применяется к первой следующей проверке, которую выполняет пострадавший, включая активную защиту, реакцию или действие собственного хода, и после неё расходуется. Действие без проверочного броска штраф не расходует.',
  });
  fields(one(s.rules, 'Rule ID', 'CORE-121'), {
    'Атомарность / аудит':
      'один раз дополнительно уменьшить HP цели на extra; не запускать новую травму, шрам или повтор этого эффекта.',
  });
  fields(one(s.combinationRules, 'CombinationRuleID', 'COMB-029'), {
    Результат: 'ADD_TRAUMA_VALUES; DISABLE_IF_TOTAL_GT_6',
    'Removal / transition / note': 'Каждая отключённая конечность даёт один глобальный −5',
  });
  fields(one(s.combinationRules, 'CombinationRuleID', 'COMB-030'), {
    Результат: 'INDEPENDENT_BY_LIMB',
  });
  const schema = array(s.runtimeContracts)
    .map((row) => record(row))
    .filter((row) => row.Entity === 'TraumaInstance');
  equal(
    schema.map((row) => [row.Field, row.Type, row.Required]),
    [
      ['traumaInstanceId', 'UUID', 'YES'],
      ['regionId', 'string', 'YES'],
      ['traumaValue', 'number', 'YES'],
    ],
    'TraumaInstance source schema',
  );
  fields(one(s.timerPolicies, 'PolicyID', 'TIME-008'), {
    Code: 'EXACT_REMAINDER',
    'Алгоритм / инвариант': 'Округление вверх допустимо только для отображения',
  });
  fields(one(s.timerPolicies, 'PolicyID', 'TIME-004'), {
    Code: 'WORLD_TIME',
    Контекст: 'Календарь кампании',
    'Алгоритм / инвариант': 'Хранить точные отметки времени',
  });
  const form = record(s.npc016);
  if (form.id !== 'NPC-016') return fail('NPC-016 source required');
  const required = array(form.requiredFields);
  for (const field of [
    'traumaAuthoringChoices[]=exact {traumaInstanceId,reason,consequence:{kind=LIMB}|{kind=TORSO,hpInterpretation=CURRENT_HP_ALREADY_FINAL}|{kind=HEAD,penalty=PENDING|CONSUMED,stun:{status=ABSENT}|{status=ACTIVE,remainingMinutes:canonicalDecimalString}}}',
    'initialTraumaFacts[]=exact {format=NPC_INITIAL_TRAUMA_V1,originKind=INITIAL_STATE_AUTHORING,scope:{campaignId,gmLocalContextId,ownerDeviceId},npcUuid,origin:{commitOperationId,sourceOperationId,version,committedAt},trauma:{traumaInstanceId,regionId,traumaValue},reason,consequence:SealedConsequence}',
  ])
    if (required.filter((item) => item === field).length !== 1)
      return fail('ADR 0081 source field differs');
  const catalog = Object.freeze({}) as NpcInitialTraumaCatalog;
  catalogs.add(catalog);
  return catalog;
}
interface Decimal {
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly scale: number;
}
function decimal(value: unknown): Decimal {
  if (typeof value !== 'string' || !DECIMAL.test(value))
    return fail('canonical decimal string required');
  const [whole, fraction = ''] = value.split('.');
  return {
    numerator: BigInt(whole! + fraction),
    denominator: 10n ** BigInt(fraction.length),
    scale: fraction.length,
  };
}
function remaining(value: unknown): string {
  const r = decimal(value);
  if (r.numerator <= 0n || r.numerator > 5n * r.denominator)
    return fail('remainingMinutes must be exact 0 < r <= 5');
  return value as string;
}
function render(numerator: bigint, scale: number): string {
  if (numerator < 0n) return fail('negative exact time');
  if (scale === 0) return numerator.toString();
  const digits = numerator.toString().padStart(scale + 1, '0');
  const fraction = digits.slice(-scale).replace(/0+$/u, '');
  return digits.slice(0, -scale) + (fraction.length === 0 ? '' : '.' + fraction);
}
/** No rounding and no conversion of fractional text through Number/parseFloat. */
export function readNpcInitialStunRemaining(value: unknown): string {
  return remaining(value);
}
function anchor(value: unknown): NpcInitialTraumaCalendarAnchor {
  const row = record(value);
  if (row.kind === 'PRE_START_INITIAL') {
    record(value, ['kind', 'campaignTimestamp', 'lobbySnapshotRevision']);
    if (
      typeof row.lobbySnapshotRevision !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(row.lobbySnapshotRevision)
    )
      return fail('lobbySnapshotRevision SHA-256 required');
    return Object.freeze({
      kind: 'PRE_START_INITIAL',
      campaignTimestamp: integer(row.campaignTimestamp),
      lobbySnapshotRevision: row.lobbySnapshotRevision,
    });
  }
  if (row.kind === 'CURRENT_CAMPAIGN') {
    record(value, ['kind', 'campaignTimestamp', 'stateRevision']);
    return Object.freeze({
      kind: 'CURRENT_CAMPAIGN',
      campaignTimestamp: integer(row.campaignTimestamp),
      stateRevision: integer(row.stateRevision),
    });
  }
  return fail('known calendar anchor required');
}
function scope(value: unknown): NpcInitialTraumaScope {
  const row = record(value, ['campaignId', 'gmLocalContextId', 'ownerDeviceId']);
  return Object.freeze({
    campaignId: uuid(row.campaignId),
    gmLocalContextId: uuid(row.gmLocalContextId),
    ownerDeviceId: uuid(row.ownerDeviceId),
  });
}
function auditTime(committedAt: unknown): string {
  if (
    typeof committedAt !== 'string' ||
    !Number.isFinite(Date.parse(committedAt)) ||
    new Date(committedAt).toISOString() !== committedAt
  )
    return fail('canonical UTC committedAt required');
  return committedAt;
}
function origin(value: unknown): NpcInitialTraumaOrigin {
  const row = record(value, ['commitOperationId', 'sourceOperationId', 'version', 'committedAt']);
  return Object.freeze({
    commitOperationId: uuid(row.commitOperationId),
    sourceOperationId: text(row.sourceOperationId),
    version: integer(row.version, 1),
    committedAt: auditTime(row.committedAt),
  });
}
function derivationBoundary(value: unknown): NpcInitialTraumaDerivationBoundary {
  const row = record(value);
  if (row.kind === 'HISTORICAL') {
    record(value, ['kind']);
    return Object.freeze({ kind: 'HISTORICAL' });
  }
  if (row.kind !== 'PENDING_COMMIT') return fail('explicit derivation boundary required');
  record(value, ['kind', 'commitOperationId', 'version', 'committedAt']);
  return Object.freeze({
    kind: 'PENDING_COMMIT',
    commitOperationId: uuid(row.commitOperationId),
    version: integer(row.version, 1),
    committedAt: auditTime(row.committedAt),
  });
}
function trauma(value: unknown): NpcTraumaInstance {
  const result = readNpcTraumaInstance(ANATOMY, value);
  integer(result.traumaValue);
  return result;
}
function traumas(value: unknown): readonly NpcTraumaInstance[] {
  const result = array(value).map(trauma);
  if (new Set(result.map((row) => row.traumaInstanceId)).size !== result.length)
    return fail('duplicate trauma identity');
  return Object.freeze(result);
}
function consequence(
  value: unknown,
  instance: NpcTraumaInstance,
  sealed: boolean,
): SealedConsequence | NpcInitialTraumaConsequence {
  const row = record(value);
  if (instance.regionId === 'TORSO') {
    record(value, ['kind', 'hpInterpretation']);
    if (row.kind !== 'TORSO' || row.hpInterpretation !== 'CURRENT_HP_ALREADY_FINAL')
      return fail('TORSO current HP interpretation required');
    return Object.freeze({ kind: 'TORSO', hpInterpretation: 'CURRENT_HP_ALREADY_FINAL' });
  }
  if (instance.regionId !== 'HEAD') {
    record(value, ['kind']);
    if (row.kind !== 'LIMB') return fail('LIMB consequence required');
    return Object.freeze({ kind: 'LIMB' });
  }
  record(value, ['kind', 'penalty', 'stun']);
  if (row.kind !== 'HEAD' || (row.penalty !== 'PENDING' && row.penalty !== 'CONSUMED'))
    return fail('explicit HEAD penalty required');
  const stun = record(row.stun);
  if (stun.status === 'ABSENT') {
    record(row.stun, ['status']);
    return Object.freeze({
      kind: 'HEAD',
      penalty: row.penalty,
      stun: Object.freeze({ status: 'ABSENT' }),
    });
  }
  if (stun.status !== 'ACTIVE' || instance.traumaValue <= 6)
    return fail('ACTIVE requires traumaValue > 6');
  record(
    row.stun,
    sealed ? ['status', 'remainingMinutes', 'calendarAnchor'] : ['status', 'remainingMinutes'],
  );
  const duration = remaining(stun.remainingMinutes);
  return Object.freeze({
    kind: 'HEAD',
    penalty: row.penalty,
    stun: Object.freeze(
      sealed
        ? {
            status: 'ACTIVE' as const,
            remainingMinutes: duration,
            calendarAnchor: anchor(stun.calendarAnchor),
          }
        : { status: 'ACTIVE' as const, remainingMinutes: duration },
    ),
  });
}
function choice(value: unknown, instance: NpcTraumaInstance): NpcInitialTraumaChoice {
  const row = record(value, ['traumaInstanceId', 'reason', 'consequence']);
  if (uuid(row.traumaInstanceId) !== instance.traumaInstanceId)
    return fail('foreign trauma choice');
  return Object.freeze({
    traumaInstanceId: instance.traumaInstanceId,
    reason: text(row.reason),
    consequence: consequence(row.consequence, instance, false),
  });
}
function choices(
  instances: readonly NpcTraumaInstance[],
  value: unknown,
): readonly NpcInitialTraumaChoice[] {
  const rows = array(value).map((raw) =>
    record(raw, ['traumaInstanceId', 'reason', 'consequence']),
  );
  if (
    rows.length !== instances.length ||
    new Set(rows.map((row) => uuid(row.traumaInstanceId))).size !== rows.length
  )
    return fail('one choice per trauma required');
  return Object.freeze(
    instances.map((instance) => {
      const row = rows.find(
        (candidate) => candidate.traumaInstanceId === instance.traumaInstanceId,
      );
      if (row === undefined) return fail('missing or orphan trauma choice');
      return choice(row, instance);
    }),
  );
}
export function readNpcInitialTraumaChoices(
  catalog: NpcInitialTraumaCatalog,
  currentTraumas: unknown,
  value: unknown,
): readonly NpcInitialTraumaChoice[] {
  requireCatalog(catalog);
  return choices(traumas(currentTraumas), value);
}
function sealConsequence(value: NpcInitialTraumaConsequence, calendar: unknown): SealedConsequence {
  if (value.kind === 'HEAD' && value.stun.status === 'ACTIVE')
    return Object.freeze({
      ...value,
      stun: Object.freeze({ ...value.stun, calendarAnchor: anchor(calendar) }),
    });
  if (calendar !== null) return fail('untimed consequence must not carry a hidden calendar anchor');
  if (value.kind !== 'HEAD') return value;
  return Object.freeze({
    kind: 'HEAD',
    penalty: value.penalty,
    stun: Object.freeze({ status: 'ABSENT' }),
  });
}
function expectedFact(
  value: unknown,
  phase: NpcInitialTraumaEvidence['phase'],
): NpcInitialTraumaFact {
  const row = record(value, [
    'phase',
    'scope',
    'npcUuid',
    'origin',
    'trauma',
    'choice',
    'calendarAnchorOrNull',
  ]);
  if (row.phase !== phase) return fail('pending/committed evidence phase differs');
  const instance = trauma(row.trauma),
    selected = choice(row.choice, instance);
  return Object.freeze({
    format: 'NPC_INITIAL_TRAUMA_V1',
    originKind: 'INITIAL_STATE_AUTHORING',
    scope: scope(row.scope),
    npcUuid: uuid(row.npcUuid),
    origin: origin(row.origin),
    trauma: instance,
    reason: selected.reason,
    consequence: sealConsequence(selected.consequence, row.calendarAnchorOrNull),
  });
}
/** The host has already allocated audit/identity and checked the exact NPC-016 prefix. */
export function prepareNpcInitialTraumaFact(
  catalog: NpcInitialTraumaCatalog,
  evidence: unknown,
): NpcInitialTraumaFact {
  requireCatalog(catalog);
  return expectedFact(evidence, 'PENDING_COMMIT');
}
/** Historical callers must pass COMMITTED and original evidence, including on retained N+1. */
export function readNpcInitialTraumaFact(
  catalog: NpcInitialTraumaCatalog,
  value: unknown,
  evidence: unknown,
  phase: NpcInitialTraumaEvidence['phase'],
): NpcInitialTraumaFact {
  requireCatalog(catalog);
  if (phase !== 'COMMITTED' && phase !== 'PENDING_COMMIT')
    return fail('explicit read phase required');
  const expected = expectedFact(evidence, phase);
  const row = record(value, [
    'format',
    'originKind',
    'scope',
    'npcUuid',
    'origin',
    'trauma',
    'reason',
    'consequence',
  ]);
  if (row.format !== 'NPC_INITIAL_TRAUMA_V1' || row.originKind !== 'INITIAL_STATE_AUTHORING')
    return fail('initial authoring fact required');
  const instance = trauma(row.trauma);
  const actual = {
    format: row.format,
    originKind: row.originKind,
    scope: scope(row.scope),
    npcUuid: uuid(row.npcUuid),
    origin: origin(row.origin),
    trauma: instance,
    reason: text(row.reason),
    consequence: consequence(row.consequence, instance, true),
  };
  equal(actual, expected, 'immutable fact/external origin evidence');
  return expected;
}
function negative(value: number): number {
  return value === 0 ? 0 : -value;
}
function derive(
  instances: readonly NpcTraumaInstance[],
  consequences: readonly SealedConsequence[],
  now: number | null,
): NpcInitialTraumaContribution {
  const limbs = LIMBS.map((regionId) => {
    const total = instances
      .filter((instance) => instance.regionId === regionId)
      .reduce((sum, instance) => sum + BigInt(instance.traumaValue), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      return fail('limb total exceeds exact numeric output');
    // The conversion follows an exact safe-integer range check; fractional time never uses it.
    const traumaTotal = Number(total);
    return Object.freeze({
      regionId,
      traumaTotal,
      localCheckPenalty: negative(traumaTotal),
      disabled: traumaTotal > 6,
    });
  });
  const legs = limbs.filter((limb) => limb.regionId === 'LEG_L' || limb.regionId === 'LEG_R');
  const legTotal = legs.reduce((sum, limb) => sum + BigInt(limb.traumaTotal), 0n);
  if (legTotal > BigInt(Number.MAX_SAFE_INTEGER))
    return fail('leg total exceeds exact numeric output');
  const pending: { traumaInstanceId: string; checkPenalty: number }[] = [];
  const stuns: {
    traumaInstanceId: string;
    deadlineMinutes: string;
    remainingMinutes: string;
    activeNow: boolean;
  }[] = [];
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i]!,
      effect = consequences[i]!;
    if (effect.kind !== 'HEAD') continue;
    if (effect.penalty === 'PENDING')
      pending.push(
        Object.freeze({
          traumaInstanceId: instance.traumaInstanceId,
          checkPenalty: negative(instance.traumaValue),
        }),
      );
    if (effect.stun.status === 'ABSENT') continue;
    if (now === null) return fail('checked current calendar required for ACTIVE origin');
    const start = effect.stun.calendarAnchor.campaignTimestamp;
    if (now < start) return fail('current calendar precedes original anchor');
    const r = decimal(effect.stun.remainingMinutes);
    const deadline = BigInt(start) * r.denominator + r.numerator;
    const left = deadline - BigInt(now) * r.denominator;
    stuns.push(
      Object.freeze({
        traumaInstanceId: instance.traumaInstanceId,
        deadlineMinutes: render(deadline, r.scale),
        remainingMinutes: render(left > 0n ? left : 0n, r.scale),
        activeNow: left > 0n,
      }),
    );
  }
  return Object.freeze({
    kind: 'INITIAL_TRAUMA_COMPONENT_ONLY',
    limbs: Object.freeze(limbs),
    movementAndDodgeLocalPenalty: negative(Number(legTotal)),
    globalCheckPenalty: negative(5 * limbs.filter((limb) => limb.disabled).length),
    pendingHeadPenalties: Object.freeze(pending),
    headStuns: Object.freeze(stuns),
    hpDelta: 0,
    requiresCampaignTime: stuns.length !== 0,
  });
}
/** No future receipt, audit time or played damage event is manufactured for a preview. */
export function previewNpcInitialTraumaConsequences(
  catalog: NpcInitialTraumaCatalog,
  value: unknown,
): NpcInitialTraumaContribution {
  requireCatalog(catalog);
  const row = record(value, ['currentTraumas', 'choices', 'calendarAnchorOrNull']);
  const instances = traumas(row.currentTraumas),
    selected = choices(instances, row.choices);
  const calendar = row.calendarAnchorOrNull === null ? null : anchor(row.calendarAnchorOrNull);
  const effects = selected.map((item) =>
    sealConsequence(
      item.consequence,
      item.consequence.kind === 'HEAD' && item.consequence.stun.status === 'ACTIVE'
        ? calendar
        : null,
    ),
  );
  return derive(instances, effects, calendar === null ? null : calendar.campaignTimestamp);
}
/** Complete immutable fact checks precede composition; no caller-supplied outcome flags. */
export function deriveNpcInitialTraumaConsequences(
  catalog: NpcInitialTraumaCatalog,
  value: unknown,
  boundary: NpcInitialTraumaDerivationBoundary,
): NpcInitialTraumaContribution {
  requireCatalog(catalog);
  const currentBoundary = derivationBoundary(boundary);
  const row = record(value, [
    'scope',
    'npcUuid',
    'currentCampaignTimestampOrNull',
    'currentTraumas',
    'facts',
    'evidence',
  ]);
  const boundScope = scope(row.scope),
    npcUuid = uuid(row.npcUuid);
  const now =
    row.currentCampaignTimestampOrNull === null
      ? null
      : integer(row.currentCampaignTimestampOrNull);
  const instances = traumas(row.currentTraumas),
    facts = array(row.facts),
    evidence = array(row.evidence);
  if (facts.length !== instances.length || evidence.length !== instances.length)
    return fail('one fact and evidence per current trauma required');
  const expected = evidence.map((entry) => {
    const phase = record(entry).phase;
    if (phase !== 'COMMITTED' && phase !== 'PENDING_COMMIT')
      return fail('known evidence phase required');
    const fact = expectedFact(entry, phase);
    if (currentBoundary.kind === 'HISTORICAL') {
      if (phase !== 'COMMITTED') return fail('historical derivation refuses pending evidence');
    } else if (phase === 'PENDING_COMMIT') {
      if (
        fact.origin.commitOperationId !== currentBoundary.commitOperationId ||
        fact.origin.version !== currentBoundary.version ||
        fact.origin.committedAt !== currentBoundary.committedAt
      )
        return fail('pending origin differs from actual current commit boundary');
    } else if (
      fact.origin.commitOperationId === currentBoundary.commitOperationId ||
      fact.origin.version >= currentBoundary.version
    ) {
      return fail('retained committed origin must precede current pending version');
    }
    return Object.freeze({ fact, phase });
  });
  if (new Set(expected.map((entry) => entry.fact.trauma.traumaInstanceId)).size !== expected.length)
    return fail('duplicate external trauma evidence');
  const actualFacts = facts.map((fact) => {
    const id = trauma(record(fact).trauma).traumaInstanceId;
    const index = expected.findIndex((entry) => entry.fact.trauma.traumaInstanceId === id);
    if (index < 0) return fail('missing external trauma evidence');
    const original = expected[index];
    if (original === undefined) return fail('missing external trauma evidence');
    return readNpcInitialTraumaFact(catalog, fact, evidence[index], original.phase);
  });
  if (new Set(actualFacts.map((fact) => fact.trauma.traumaInstanceId)).size !== actualFacts.length)
    return fail('duplicate initial trauma fact');
  const effects = instances.map((instance) => {
    const fact = actualFacts.find(
      (candidate) => candidate.trauma.traumaInstanceId === instance.traumaInstanceId,
    );
    if (fact === undefined) return fail('missing or orphan initial trauma fact');
    equal(fact.trauma, instance, 'current trauma');
    equal(fact.scope, boundScope, 'owner scope');
    equal(fact.npcUuid, npcUuid, 'NPC identity');
    return fact.consequence;
  });
  return derive(instances, effects, now);
}
