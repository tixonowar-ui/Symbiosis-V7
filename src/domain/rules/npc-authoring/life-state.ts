import type { NpcRollFact } from './types.js';

/**
 * CORE-153 base component only. This record is not an active EffectInstance or a valid
 * initialRuntime: functional-duplicate/source-specific resolution remains mandatory.
 * A formal initial state is not an incoming damage event (CORE-182/155).
 */
export interface NpcBasePeaceDeathTimerAnchor {
  readonly kind: 'GM_FORMAL_INITIAL_SEVERE_WOUND';
  readonly campaignId: string;
  readonly targetActorId: string;
  readonly preparationFactId: string;
  readonly reason: string;
  readonly startsAt: Readonly<{ campaignTimestamp: number }>;
  readonly rollFact: NpcRollFact<6>;
}
export interface NpcBasePeaceDeathTimerContribution {
  readonly kind: 'BASE_PEACE_DEATH_TIMER_CONTRIBUTION_ONLY';
  readonly anchor: NpcBasePeaceDeathTimerAnchor;
  readonly baseDurationMinutes: number;
  readonly baseExpiresAt: Readonly<{ campaignTimestamp: number }>;
}

type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
declare const issued: unique symbol;
export interface NpcLifeStateCatalog {
  readonly [issued]: true;
}
const catalogs = new WeakSet<NpcLifeStateCatalog>();

const SOURCE_WITNESSES: readonly Readonly<{
  collection: 'rules' | 'effectTypes' | 'timerPolicies';
  idKey: string;
  id: string;
  fields: Readonly<Record<string, string>>;
}>[] = [
  {
    collection: 'rules',
    idKey: 'Rule ID',
    id: 'CORE-153',
    fields: {
      Статус: 'Активно',
      'Итоговый алгоритм':
        'Нормативная база (действует во всей непротиворечащей части):\nв бою remainingTurns=D6, в конце каждого последующего собственного хода −1, при 0 смерть; вне боя отдельный D6×5 минут. При функциональном дубле на входе исходный таймер ×4 один раз.\nПриоритетные авторские дельты (заменяют только прямо пересекающиеся ветви):\n[Q-CORE-063] При смене режима конвертируется только остаток, уже истёкшее время не пересчитывается. Для обычного эффекта 1 ход равен 1 минуте; для тяжёлого ранения 1 ход равен 5 минутам. Остаток хранится в точном базовом значении без округления, а округление вверх используется только для отображения числа предстоящих ходов. Обратный переход рассчитывается из сохранённого точного остатка, поэтому повторные вход и выход из боя не увеличивают длительность.\n[v1.4] Обычный CANONICAL_MONSTER и CUSTOM_MONSTER при HP=0 входят в тяжёлое ранение с abstractVitalSystemDamaged=true и общим таймером смерти по CORE-222; прямое видовое исключение сильнее.',
      'Исключения / приоритет':
        'несколько дублей не перемножаются; прекращение временного дубля не пересчитывает таймер; смена режима боя Q-CORE-063.\nПоздние дельты применяются по приоритету AQ3 > AQ2 > AQA/CQA > базовая карточка; локальное исключение сильнее общего.',
    },
  },
  {
    collection: 'effectTypes',
    idKey: 'EffectTypeID',
    id: 'EFF-LIFE-DEATH_TIMER',
    fields: {
      Automation: 'AUTOMATED',
      'Schema status': 'DEFINED',
      FamilyCode: 'FAM-LIFECYCLE',
      'State bucket': 'currentEffects',
      'State writes': 'deathTimer',
      'Stack policy': 'SINGLETON_BY_ACTOR',
      'Removal policy': 'EXPLICIT_REANIMATION_OR_EXPIRY',
      Семантика: 'Точный остаток хранится без округления интерфейсом',
    },
  },
  {
    collection: 'timerPolicies',
    idKey: 'PolicyID',
    id: 'TIME-006',
    fields: {
      Code: 'SEVERE_WOUND_TIMER',
      'Алгоритм / инвариант': '1 боевой ход остатка = 5 минут вне боя',
    },
  },
  {
    collection: 'timerPolicies',
    idKey: 'PolicyID',
    id: 'TIME-008',
    fields: {
      Code: 'EXACT_REMAINDER',
      'Алгоритм / инвариант': 'Округление вверх допустимо только для отображения',
    },
  },
  {
    collection: 'timerPolicies',
    idKey: 'PolicyID',
    id: 'TIME-017',
    fields: {
      Code: 'NO_SAME_MOMENT_SERVICE',
      'Алгоритм / инвариант': 'Не тикать и не уменьшать в момент создания',
    },
  },
];

function fail(detail: string): never {
  throw new Error(`NPC life component: ${detail}`);
}
function record(value: unknown, names?: readonly string[]): Row {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail('plain data record required');
  const own = Reflect.ownKeys(value),
    descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    own.some((key) => typeof key !== 'string') ||
    Object.values(descriptors).some((d) => !d.enumerable || !Object.hasOwn(d, 'value')) ||
    (names !== undefined &&
      (own.length !== names.length || names.some((key) => !Object.hasOwn(value, key))))
  )
    return fail('unknown, missing, hidden or accessor fields');
  return value as Row;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail('plain dense array required');
  const count: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    Reflect.ownKeys(value).length !== count + 1
  )
    return fail('array fields differ');
  return Array.from({ length: count }, (_, index) => {
    const d = Object.getOwnPropertyDescriptor(value, String(index));
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
      return fail('array accessor or hole');
    return d.value as unknown;
  });
}
function uuid(value: unknown): string {
  return typeof value === 'string' && UUID.test(value) ? value : fail('canonical UUID required');
}
function integer(value: unknown, minimum: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : fail('safe integer in range required');
}
function moment(value: unknown): Readonly<{ campaignTimestamp: number }> {
  const r = record(value, ['campaignTimestamp']);
  return Object.freeze({ campaignTimestamp: integer(r.campaignTimestamp, 0) });
}
function roll(value: unknown): NpcRollFact<6> {
  const r = record(value, ['factId', 'sourceRuleId', 'roll']);
  if (r.sourceRuleId !== 'CORE-153') return fail('death timer roll must belong to CORE-153');
  const mechanical = record(r.roll, ['dieSides', 'rawFace']);
  const rawFace = integer(mechanical.rawFace, 1);
  if (mechanical.dieSides !== 6 || rawFace > 6) return fail('confirmed D6 face required');
  return Object.freeze({
    factId: uuid(r.factId),
    sourceRuleId: 'CORE-153',
    roll: Object.freeze({ dieSides: 6, rawFace }),
  });
}
function anchor(value: unknown): NpcBasePeaceDeathTimerAnchor {
  const r = record(value, [
    'kind',
    'campaignId',
    'targetActorId',
    'preparationFactId',
    'reason',
    'startsAt',
    'rollFact',
  ]);
  if (r.kind !== 'GM_FORMAL_INITIAL_SEVERE_WOUND')
    return fail('new formal initial-state anchor required');
  if (typeof r.reason !== 'string' || r.reason.trim().length === 0)
    return fail('explicit GM reason required');
  const result = {
    kind: 'GM_FORMAL_INITIAL_SEVERE_WOUND' as const,
    campaignId: uuid(r.campaignId),
    targetActorId: uuid(r.targetActorId),
    preparationFactId: uuid(r.preparationFactId),
    reason: r.reason,
    startsAt: moment(r.startsAt),
    rollFact: roll(r.rollFact),
  };
  return Object.freeze(result);
}
function requireCatalog(catalog: NpcLifeStateCatalog): void {
  if (!catalogs.has(catalog)) fail('issued source catalog required');
}
/** Exact source witnesses include the multiplication/precision rules this component does not resolve. */
export function createNpcLifeStateCatalog(
  sources: Readonly<{ rules: unknown; effectTypes: unknown; timerPolicies: unknown }>,
): NpcLifeStateCatalog {
  const input = record(sources, ['rules', 'effectTypes', 'timerPolicies']);
  for (const witness of SOURCE_WITNESSES) {
    const rows = array(input[witness.collection]).map((row) => record(row));
    const found = rows.filter((row) => row[witness.idKey] === witness.id);
    const source = found.length === 1 ? found[0] : undefined;
    if (source === undefined) return fail(`one ${witness.id} source required`);
    for (const [key, expected] of Object.entries(witness.fields))
      if (source[key] !== expected) return fail(`${witness.id} source ${key} differs`);
  }
  const catalog = Object.freeze({}) as NpcLifeStateCatalog;
  catalogs.add(catalog);
  return catalog;
}
/**
 * The owning host binds the real stored D6 fact and confirmed campaign time before calling.
 * It must resolve source-specific extensions before publishing an active death timer.
 * This pure step neither allocates IDs nor rolls, consumes OE, ticks, or creates a death event.
 */
export function prepareNpcBasePeaceDeathTimer(
  catalog: NpcLifeStateCatalog,
  input: unknown,
): NpcBasePeaceDeathTimerContribution {
  requireCatalog(catalog);
  const origin = anchor(input),
    baseDurationMinutes = origin.rollFact.roll.rawFace * 5;
  const deadline = origin.startsAt.campaignTimestamp + baseDurationMinutes;
  if (!Number.isSafeInteger(deadline))
    return fail('base timer deadline exceeds exact minute range');
  return Object.freeze({
    kind: 'BASE_PEACE_DEATH_TIMER_CONTRIBUTION_ONLY',
    anchor: origin,
    baseDurationMinutes,
    baseExpiresAt: Object.freeze({ campaignTimestamp: deadline }),
  });
}
/** Reopen/N+1 use the original immutable anchor, never the current clock or a new roll. */
export function validateNpcSavedBasePeaceDeathTimer(
  catalog: NpcLifeStateCatalog,
  value: unknown,
  originalAnchor: unknown,
): NpcBasePeaceDeathTimerContribution {
  requireCatalog(catalog);
  const saved = record(value, ['kind', 'anchor', 'baseDurationMinutes', 'baseExpiresAt']);
  if (saved.kind !== 'BASE_PEACE_DEATH_TIMER_CONTRIBUTION_ONLY')
    return fail('base contribution required');
  const current = prepareNpcBasePeaceDeathTimer(catalog, saved.anchor);
  const original = prepareNpcBasePeaceDeathTimer(catalog, originalAnchor);
  if (JSON.stringify(current.anchor) !== JSON.stringify(original.anchor))
    return fail('immutable timer anchor changed or belongs to another target');
  const expiration = moment(saved.baseExpiresAt);
  if (
    saved.baseDurationMinutes !== current.baseDurationMinutes ||
    expiration.campaignTimestamp !== current.baseExpiresAt.campaignTimestamp
  )
    return fail('saved base duration/deadline differs');
  return current;
}
