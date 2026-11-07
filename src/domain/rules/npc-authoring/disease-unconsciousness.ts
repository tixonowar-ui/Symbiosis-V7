import type { StatCode } from '@generated/types/character.js';
import type { DiseaseId } from '@generated/types/effects.js';
import type { NpcDiseaseEffectInstance } from './effect-types.js';
import {
  validateNpcDiseaseEffects,
  type NpcDiseaseCodecCatalog,
  type NpcPneumoniaHistoryAnchor,
} from './periodic-disease-effects.js';
import type { NpcDiseaseEffectContext } from './untimed-disease-effects.js';
import { readNpcEquipmentStatBasis } from './equipment-profile.js';
import { readNpcHpModeStatProfile, type NpcHpModeStatProfile } from './combined-hp-modes.js';
import {
  applyNpcEffectiveStatLimits,
  type NpcEffectiveStatLimits,
} from './ordinary-stat-profile.js';

const STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const ALGORITHM =
  'Нормативная база (действует во всей непротиворечащей части):\n' +
  'если сумма поражаемой характеристики и Z становится <1, установить потерю сознания.\n' +
  'Приоритетные авторские дельты (заменяют только прямо пересекающиеся ветви):\n' +
  '[Q-MON-039] Для каждой характеристики X, которую снижает болезнь, отдельно проверяется условие «итоговое X + итоговое Z < 1». Достаточно выполнения условия хотя бы для одной поражённой характеристики, чтобы персонаж потерял сознание до излечения.';
type Row = Readonly<Record<string, unknown>>;
function fail(detail: string): never {
  throw new Error(`NPC disease unconsciousness: ${detail}`);
}
function record(value: unknown, keys?: readonly string[]): Row {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail('plain data object required');
  const own = Reflect.ownKeys(value),
    fields = Object.getOwnPropertyDescriptors(value);
  if (
    own.some((k) => typeof k !== 'string') ||
    Object.values(fields).some((d) => !d.enumerable || !Object.hasOwn(d, 'value')) ||
    (keys !== undefined &&
      (own.length !== keys.length || keys.some((k) => !Object.hasOwn(value, k))))
  )
    return fail('unknown, missing, hidden or accessor fields');
  return value as Row;
}
function rows(value: unknown): readonly Row[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail('source row array required');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    Reflect.ownKeys(value).length !== length + 1
  )
    return fail('source row array fields differ');
  const fields = Object.getOwnPropertyDescriptors(value),
    result: Row[] = [];
  for (let i = 0; i < length; i += 1) {
    const d = fields[String(i)];
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
      return fail('source row is not own data');
    result.push(record(d.value));
  }
  return result;
}
function one(value: unknown, key: string, id: string): Row {
  const found = rows(value).filter((row) => row[key] === id);
  if (found.length !== 1 || found[0] === undefined) return fail(`one ${id} source required`);
  return found[0];
}
function effectiveStats(value: unknown): Readonly<Record<StatCode, number>> {
  const r = record(value, STATS),
    result = {} as Record<StatCode, number>;
  for (const stat of STATS) {
    const number = r[stat];
    if (typeof number !== 'number' || !Number.isFinite(number))
      return fail(`finite effective ${stat} required`);
    result[stat] = number;
  }
  return Object.freeze(result);
}
function permanentStats(value: unknown): Readonly<Record<StatCode, number>> {
  const permanent = effectiveStats(value);
  for (const stat of STATS)
    if (!Number.isSafeInteger(permanent[stat]) || permanent[stat] < 1)
      return fail('permanent stats must be safe integers at least one');
  return permanent;
}
declare const issued: unique symbol;
export interface NpcDiseaseUnconsciousnessCatalog {
  readonly [issued]: true;
}
const contexts = new WeakMap<NpcDiseaseUnconsciousnessCatalog, NpcDiseaseCodecCatalog>();

/** Bind the source rule/profile to the same validated disease codec used by the owning sheet. */
export function createNpcDiseaseUnconsciousnessCatalog(
  diseaseEffects: NpcDiseaseCodecCatalog,
  sources: Readonly<{ rules: unknown; capabilityProfiles: unknown }>,
): NpcDiseaseUnconsciousnessCatalog {
  const source = record(sources, ['rules', 'capabilityProfiles']);
  const minimum = one(source.rules, 'Rule ID', 'CORE-078');
  if (
    minimum['Статус'] !== 'Активно' ||
    minimum['Исключения / приоритет'] !==
      'специальное последствие снижения ниже 1 сначала срабатывает, затем для расчётов значение 1.'
  )
    return fail('CORE-078 consequence-before-floor contract differs');
  const order = one(source.rules, 'Rule ID', 'CORE-079');
  if (
    order['Статус'] !== 'Активно' ||
    order['Итоговый алгоритм'] !==
      '1) постоянное значение; 2) временные прибавки/штрафы; 3) умножение/деление; 4) точная установка и явно названные min/max. «Становится равной/до» применяется после обычных модификаторов.'
  )
    return fail('CORE-079 stat order contract differs');
  const rule = one(source.rules, 'Rule ID', 'MON-075');
  if (
    rule['Статус'] !== 'Активно' ||
    rule['ID вопросов'] !== 'Q-MON-039' ||
    rule['Итоговый алгоритм'] !== ALGORITHM
  )
    return fail('MON-075 active source algorithm differs');
  const profile = one(source.capabilityProfiles, 'ProfileID', 'PRF-DISEASE-UNCONSCIOUS');
  for (const [key, expected] of Object.entries({
    Status: 'DEFINED',
    'Rule refs': 'MON-075; MON-085',
    'Активные состояния': 'EFF-DISEASE-INSTANCE + derived unconscious',
    Выход: 'Remove enough disease decrease',
    'Таймеры / автономные эффекты': 'Disease ticks remain',
    'Физические действия': 'NO',
    'Ментальные действия': 'NO',
    Перемещение: 'NO',
    Реакции: 'NO',
    'Активная защита': 'NO',
    Броня: 'YES',
    Контроллер: 'owningController',
  }))
    if (profile[key] !== expected) return fail(`PRF-DISEASE-UNCONSCIOUS source ${key} differs`);
  const catalog = Object.freeze({}) as NpcDiseaseUnconsciousnessCatalog;
  contexts.set(catalog, diseaseEffects);
  return catalog;
}
export interface NpcDiseaseUnconsciousnessTrigger {
  readonly effectInstanceId: string;
  readonly diseaseId: DiseaseId;
  readonly stat: StatCode;
  readonly effectiveStat: number;
  readonly effectiveZ: number;
  readonly sum: number;
}
export interface NpcDiseaseUnconsciousnessContribution {
  readonly kind: 'DISEASE_UNCONSCIOUSNESS_CONTRIBUTION_ONLY';
  readonly sourceRuleId: 'MON-075';
  readonly profileId: 'PRF-DISEASE-UNCONSCIOUS';
  readonly triggers: readonly NpcDiseaseUnconsciousnessTrigger[];
}
/** Inputs already contain final stats: subtracting modifiers again or clamping them to base >=1
 * would erase the source threshold. No triggers says nothing about other unconsciousness causes.
 * This function changes no effect, timer, capability/controller, identity or durable state.
 */
export function evaluateNpcDiseaseUnconsciousness(
  catalog: NpcDiseaseUnconsciousnessCatalog,
  candidate: unknown,
): NpcDiseaseUnconsciousnessContribution {
  const diseases = contexts.get(catalog) ?? fail('issued source catalog required');
  const input = record(candidate, ['effects', 'effectiveStats', 'scope', 'histories']);
  const checked = validateNpcDiseaseEffects(
    diseases,
    input.effects,
    input.scope as NpcDiseaseEffectContext,
    input.histories as readonly NpcPneumoniaHistoryAnchor[],
  );
  return contribution(checked, effectiveStats(input.effectiveStats));
}
type DiseaseModifiers = Readonly<{
  effectInstanceId: string;
  payload: Pick<NpcDiseaseEffectInstance['payload'], 'diseaseId' | 'modifierComponents'>;
}>;
function contribution(
  checked: readonly DiseaseModifiers[],
  stats: Readonly<Record<StatCode, number>>,
): NpcDiseaseUnconsciousnessContribution {
  const triggers: NpcDiseaseUnconsciousnessTrigger[] = [];
  for (const effect of checked) {
    for (const modifier of effect.payload.modifierComponents) {
      if (modifier.targetKind !== 'STAT' || modifier.value >= 0) continue;
      const stat =
        STATS.find((code) => code === modifier.targetCode) ?? fail('unknown disease STAT target');
      const sum = stats[stat] + stats.Z;
      if (!Number.isFinite(sum)) return fail('effective stat sum is not finite');
      if (sum < 1)
        triggers.push(
          Object.freeze({
            effectInstanceId: effect.effectInstanceId,
            diseaseId: effect.payload.diseaseId,
            stat,
            effectiveStat: stats[stat],
            effectiveZ: stats.Z,
            sum,
          }),
        );
    }
  }
  triggers.sort((a, b) =>
    a.effectInstanceId < b.effectInstanceId
      ? -1
      : a.effectInstanceId > b.effectInstanceId
        ? 1
        : STATS.indexOf(a.stat) - STATS.indexOf(b.stat),
  );
  return Object.freeze({
    kind: 'DISEASE_UNCONSCIOUSNESS_CONTRIBUTION_ONLY',
    sourceRuleId: 'MON-075',
    profileId: 'PRF-DISEASE-UNCONSCIOUS',
    triggers: Object.freeze(triggers),
  });
}

export interface NpcDiseaseStatContribution {
  readonly kind: 'DISEASE_STAT_CONTRIBUTION_ONLY';
  readonly permanentStats: Readonly<Record<StatCode, number>>;
  readonly rawFinalStats: Readonly<Record<StatCode, number>>;
  readonly effectiveStats: Readonly<Record<StatCode, number>>;
  readonly checkModifiers: readonly Readonly<{
    effectInstanceId: string;
    diseaseId: DiseaseId;
    targetCode: 'STEALTH';
    value: number;
  }>[];
  readonly unconsciousness: NpcDiseaseUnconsciousnessContribution;
}
/**
 * CORE-079 disease-only additive branch. The caller proves that other stat modifiers are absent
 * or composes them in their own source order; this is neither a full sheet nor general capabilities.
 * CORE-078/MON-075 require the raw threshold before the computational floor. No HP tick occurs here.
 */
export function deriveNpcDiseaseStatContribution(
  catalog: NpcDiseaseUnconsciousnessCatalog,
  candidate: unknown,
  hpModeStatProfile: NpcHpModeStatProfile | null = null,
  effectiveLimits: NpcEffectiveStatLimits | null = null,
): NpcDiseaseStatContribution {
  const diseases = contexts.get(catalog) ?? fail('issued source catalog required');
  const input = record(candidate, ['effects', 'permanentStats', 'scope', 'histories']);
  const permanent = permanentStats(input.permanentStats);
  const checked = validateNpcDiseaseEffects(
    diseases,
    input.effects,
    input.scope as NpcDiseaseEffectContext,
    input.histories as readonly NpcPneumoniaHistoryAnchor[],
  );
  return statContribution(
    checked,
    permanent,
    permanent,
    modeMultiplier(hpModeStatProfile, record(input.scope).targetActorId),
    effectiveLimits,
  );
}
/** Only issued equipment can supply a raw temporary basis below one; permanent input stays strict. */
export function deriveNpcDiseaseEquippedStatContribution(
  catalog: NpcDiseaseUnconsciousnessCatalog,
  candidate: unknown,
  hpModeStatProfile: NpcHpModeStatProfile | null = null,
): NpcDiseaseStatContribution {
  const diseases = contexts.get(catalog) ?? fail('issued source catalog required');
  const input = record(candidate, ['effects', 'equipmentProfile', 'scope', 'histories']);
  const basis = readNpcEquipmentStatBasis(input.equipmentProfile);
  if (record(input.scope).targetActorId !== basis.npcUuid)
    return fail('equipment profile belongs to another NPC');
  const permanent = permanentStats(basis.permanentStats);
  const checked = validateNpcDiseaseEffects(
    diseases,
    input.effects,
    input.scope as NpcDiseaseEffectContext,
    input.histories as readonly NpcPneumoniaHistoryAnchor[],
  );
  return statContribution(
    checked,
    permanent,
    basis.rawEquippedStats,
    modeMultiplier(hpModeStatProfile, basis.npcUuid),
    basis.effectiveLimitsOrNull,
  );
}
function modeMultiplier(profile: NpcHpModeStatProfile | null, npcUuid?: unknown): 1 | 2 {
  if (profile === null) return 1;
  const actual = readNpcHpModeStatProfile(profile);
  if (npcUuid !== undefined && actual.source.npcUuid !== npcUuid)
    return fail('mode stat profile belongs to another NPC');
  return actual.hungerStatMultiplier;
}
function statContribution(
  checked: readonly DiseaseModifiers[],
  permanent: Readonly<Record<StatCode, number>>,
  rawBasis: Readonly<Record<StatCode, number>> = permanent,
  hungerMultiplier: 1 | 2 = 1,
  effectiveLimits: NpcEffectiveStatLimits | null = null,
): NpcDiseaseStatContribution {
  const raw = { ...rawBasis };
  const checkModifiers: Array<NpcDiseaseStatContribution['checkModifiers'][number]> = [];
  for (const effect of checked) {
    for (const modifier of effect.payload.modifierComponents) {
      if (modifier.targetKind === 'STAT') {
        raw[modifier.targetCode] += modifier.value;
        if (!Number.isSafeInteger(raw[modifier.targetCode]))
          return fail('disease stat sum is not a safe integer');
      } else {
        checkModifiers.push(
          Object.freeze({
            effectInstanceId: effect.effectInstanceId,
            diseaseId: effect.payload.diseaseId,
            targetCode: modifier.targetCode,
            value: modifier.value,
          }),
        );
      }
    }
  }
  // MON-023 / CORE-079: multiply only S,D,M,Z after temporary additions;
  // MON-075 then sees these raw values before CORE-078's computational floor.
  for (const stat of ['S', 'D', 'M', 'Z'] as const) {
    raw[stat] *= hungerMultiplier;
    if (!Number.isSafeInteger(raw[stat])) return fail('mode stat multiplication overflow');
  }
  const rawFinalStats =
    effectiveLimits === null
      ? Object.freeze(raw)
      : applyNpcEffectiveStatLimits(effectiveLimits, raw);
  const result: Record<StatCode, number> = { ...rawFinalStats };
  for (const stat of STATS) result[stat] = Math.max(1, result[stat]);
  checkModifiers.sort((a, b) =>
    a.effectInstanceId < b.effectInstanceId ? -1 : a.effectInstanceId > b.effectInstanceId ? 1 : 0,
  );
  return Object.freeze({
    kind: 'DISEASE_STAT_CONTRIBUTION_ONLY',
    permanentStats: permanent,
    rawFinalStats,
    effectiveStats: Object.freeze(result),
    checkModifiers: Object.freeze(checkModifiers),
    unconsciousness: contribution(checked, rawFinalStats),
  });
}

export interface NpcDiseasePreviewAssignment {
  readonly effectInstanceId: string;
  readonly diseaseId: DiseaseId;
}
export interface NpcPreparedDiseaseContribution {
  readonly kind: 'UNCOMMITTED_DISEASE_SELECTION';
  readonly assignments: readonly NpcDiseasePreviewAssignment[];
  readonly contribution: NpcDiseaseStatContribution;
}
/** Mechanics of source-backed intentions, not EffectInstance creation or evidence of an assignment.
 * The host binds each ID to its actual reservation/retained effect; no timestamp is invented here.
 */
export function previewNpcDiseaseStatContribution(
  catalog: NpcDiseaseUnconsciousnessCatalog,
  candidate: unknown,
  hpModeStatProfile: NpcHpModeStatProfile | null = null,
  effectiveLimits: NpcEffectiveStatLimits | null = null,
): NpcPreparedDiseaseContribution {
  const diseases = contexts.get(catalog) ?? fail('issued source catalog required');
  const input = record(candidate, ['assignments', 'permanentStats']);
  const permanent = permanentStats(input.permanentStats);
  return previewContribution(
    diseases,
    input.assignments,
    permanent,
    permanent,
    modeMultiplier(hpModeStatProfile),
    effectiveLimits,
  );
}
/** Equipment-only computational floors must not erase the later MON-075 raw threshold. */
export function previewNpcDiseaseEquippedStatContribution(
  catalog: NpcDiseaseUnconsciousnessCatalog,
  candidate: unknown,
  hpModeStatProfile: NpcHpModeStatProfile | null = null,
): NpcPreparedDiseaseContribution {
  const diseases = contexts.get(catalog) ?? fail('issued source catalog required');
  const input = record(candidate, ['assignments', 'equipmentProfile']);
  const basis = readNpcEquipmentStatBasis(input.equipmentProfile);
  return previewContribution(
    diseases,
    input.assignments,
    permanentStats(basis.permanentStats),
    basis.rawEquippedStats,
    modeMultiplier(hpModeStatProfile, basis.npcUuid),
    basis.effectiveLimitsOrNull,
  );
}
function previewContribution(
  diseases: NpcDiseaseCodecCatalog,
  assignments: unknown,
  permanent: Readonly<Record<StatCode, number>>,
  rawBasis: Readonly<Record<StatCode, number>> = permanent,
  hungerMultiplier: 1 | 2 = 1,
  effectiveLimits: NpcEffectiveStatLimits | null = null,
): NpcPreparedDiseaseContribution {
  const checked = rows(assignments).map((value) => {
    const r = record(value, ['effectInstanceId', 'diseaseId']);
    if (
      typeof r.effectInstanceId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        r.effectInstanceId,
      )
    )
      return fail('actual reserved effect UUID required');
    const definition = diseases.nonperiodic.initialEffects.diseases.find(
      (d) => d.diseaseId === r.diseaseId,
    );
    if (
      definition === undefined ||
      definition.status !== 'ACTIVE' ||
      definition.diseaseId === 'DIS-PESTILENCE'
    )
      return fail('modeled ACTIVE disease required');
    return Object.freeze({
      effectInstanceId: r.effectInstanceId,
      payload: Object.freeze({
        diseaseId: definition.diseaseId,
        modifierComponents: definition.modifiers,
      }),
    });
  });
  if (
    new Set(checked.map((e) => e.effectInstanceId)).size !== checked.length ||
    new Set(checked.map((e) => e.payload.diseaseId)).size !== checked.length
  )
    return fail('duplicate disease selection or identity');
  return Object.freeze({
    kind: 'UNCOMMITTED_DISEASE_SELECTION',
    assignments: Object.freeze(
      checked.map((e) =>
        Object.freeze({ effectInstanceId: e.effectInstanceId, diseaseId: e.payload.diseaseId }),
      ),
    ),
    contribution: statContribution(checked, permanent, rawBasis, hungerMultiplier, effectiveLimits),
  });
}
