import type { StatCode } from '@generated/types/character.js';
import type { SymbiontCatalog } from '../symbiont-stage/catalog.js';
import type { StatBlock } from '../skill-stage/stats.js';
import {
  deriveNpcSymbiontNativeProfile,
  validateNpcNativeCurrentOe,
  type NpcSymbiontNativeCatalog,
} from './symbiont-native-profile.js';
import type { NpcSymbiontInput } from './types.js';

type MonsterSpecies = 'CHIMERA' | 'PUPPETEER' | 'PLAGUE_DOCTOR';
declare const catalogBrand: unique symbol;
export interface NpcMonsterPassiveCatalog {
  readonly [catalogBrand]: true;
}
interface Context {
  readonly native: NpcSymbiontNativeCatalog;
  readonly species: SymbiontCatalog['species'];
}
const contexts = new WeakMap<NpcMonsterPassiveCatalog, Context>();
const profiles = new WeakSet<NpcMonsterPassiveProfile>();
const progressResults = new WeakSet<NpcChimeraSlotProgress>();
const STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const MONSTERS = ['CHIMERA', 'PUPPETEER', 'PLAGUE_DOCTOR'] as const;
export interface NpcConfirmedDevouringLeaf {
  readonly completionFactId: string;
  readonly devouringOperationId: string;
  readonly ordinal: number;
  readonly chimeraInstanceId: string;
  readonly targetContextFactId: string;
}
export interface NpcChimeraSlotProof {
  readonly chimeraInstanceId: string;
  readonly thresholdConfirmationFactId: string;
  readonly gmIntervals: readonly [number, number, number];
  readonly completedDevourings: readonly NpcConfirmedDevouringLeaf[];
}
export interface NpcChimeraSlotProgress {
  readonly proof: NpcChimeraSlotProof;
  readonly thresholds: readonly [number, number, number];
  readonly devouredCount: number;
  readonly extraSlots: number;
}
export interface NpcMonsterPassiveProfile {
  readonly kind: 'NATIVE_MONSTER_AND_BASE_PASSIVES_ONLY';
  readonly input: NpcSymbiontInput;
  readonly speciesKey: MonsterSpecies;
  readonly nativeMaxOE: number;
  readonly baseSlotCost: 4;
  readonly basePermanentStatDelta: StatBlock;
  readonly additionalSlotPolicy: 'CONFIRMED_CHIMERA_HISTORY' | 'FORBIDDEN';
}
function fail(detail: string): never {
  throw new Error(`NPC monster component: ${detail}`);
}
function exact(value: unknown, names: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail('plain data record required');
  const keys = names.split(' '),
    own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    return fail('unexpected or missing fields');
  return Object.fromEntries(
    keys.map((key) => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
        return fail('accessor field');
      return [key, d.value as unknown];
    }),
  );
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
    return fail('sparse or extended array');
  return Array.from({ length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value'))
      return fail('array accessor');
    return d.value as unknown;
  });
}
function ref(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    ? value
    : fail('exact reference required');
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function context(catalog: NpcMonsterPassiveCatalog): Context {
  return contexts.get(catalog) ?? fail('issued catalog required');
}

export function createNpcMonsterPassiveCatalog(
  symbionts: SymbiontCatalog,
  native: NpcSymbiontNativeCatalog,
  rules: unknown,
): NpcMonsterPassiveCatalog {
  if (!Array.isArray(rules)) return fail('imported Rules required');
  const rows: readonly unknown[] = rules;
  const rule = (id: string, needle: string) => {
    const found = rows.filter(
      (r): r is Record<string, unknown> =>
        r !== null &&
        typeof r === 'object' &&
        !Array.isArray(r) &&
        (r as Record<string, unknown>)['Rule ID'] === id,
    );
    const entry = found[0];
    if (
      found.length !== 1 ||
      entry === undefined ||
      entry['Статус'] !== 'Активно' ||
      typeof entry['Итоговый алгоритм'] !== 'string' ||
      !entry['Итоговый алгоритм'].includes(needle)
    )
      return fail(`unsupported source ${id}`);
  };
  rule('MON-001', 'занять 4 слота.');
  rule('MON-007', 'Мастер в закрытую независимо определяет три значения от 10 до 22');
  rule('MON-007', 'Пороги равны первому значению, сумме первых двух и сумме всех трёх');
  rule('MON-007', 'успешных пожираний');
  const exclusivity = symbionts.interactions.filter(
    (r) => r.conflictId === 'SYMBIOTIC-MONSTER-BASE-SLOTS',
  );
  if (exclusivity.length !== 1) return fail('missing monster exclusivity source');
  for (const key of MONSTERS) {
    const row = symbionts.species.find((r) => r.speciesKey === key);
    if (
      row?.kind !== 'SYMBIOTIC_MONSTER' ||
      row.slotCost !== 4 ||
      row.allowedRaceCodes.join(',') !== 'UNITED'
    )
      return fail('unsupported monster race/slot source');
  }
  const result = Object.freeze({}) as NpcMonsterPassiveCatalog;
  contexts.set(result, { native, species: structuredClone(symbionts.species) });
  return result;
}

/** Native build + source base passives only; not learned-node effects, maxHP or final stats. */
export function deriveNpcMonsterPassiveProfile(
  catalog: NpcMonsterPassiveCatalog,
  value: unknown,
): NpcMonsterPassiveProfile {
  const c = context(catalog),
    row = exact(value, 'raceCode symbiont');
  if (row.raceCode !== 'UNITED') return fail('monsters require UNITED');
  const item = exact(
    row.symbiont,
    'symbiontInstanceId speciesKey targetLevel learnedNodeRefs binding currentOE',
  );
  if (!MONSTERS.some((key) => key === item.speciesKey)) return fail('monster species required');
  const input = {
    symbiontInstanceId: item.symbiontInstanceId,
    speciesKey: item.speciesKey,
    targetLevel: item.targetLevel,
    learnedNodeRefs: item.learnedNodeRefs,
    binding: item.binding,
  };
  const native = deriveNpcSymbiontNativeProfile(c.native, input),
    currentOE = validateNpcNativeCurrentOe(native, item.currentOE);
  const species = c.species.find((r) => r.speciesKey === native.speciesKey);
  if (species === undefined) return fail('missing source species');
  const delta = Object.fromEntries(STATS.map((key) => [key, 0])) as Record<StatCode, number>;
  for (const modifier of species.modifiers) {
    if (modifier.contextPredicate !== 'symbiontActive=true')
      return fail('unsupported base modifier condition');
    const total = delta[modifier.targetCode] + modifier.value;
    if (!Number.isSafeInteger(total)) return fail('modifier exceeds safe integer');
    delta[modifier.targetCode] = total;
  }
  const result: NpcMonsterPassiveProfile = freeze({
    kind: 'NATIVE_MONSTER_AND_BASE_PASSIVES_ONLY',
    input: {
      symbiontInstanceId: native.symbiontInstanceId,
      speciesKey: native.speciesKey,
      targetLevel: native.targetLevel,
      learnedNodeRefs: native.learnedNodeRefs,
      binding: native.binding,
      currentOE,
    },
    speciesKey: native.speciesKey as MonsterSpecies,
    nativeMaxOE: native.nativeMaxOE,
    baseSlotCost: 4,
    basePermanentStatDelta: delta,
    additionalSlotPolicy:
      native.speciesKey === 'CHIMERA' ? 'CONFIRMED_CHIMERA_HISTORY' : 'FORBIDDEN',
  });
  profiles.add(result);
  return result;
}

function slotProof(value: unknown): NpcChimeraSlotProgress {
  const row = exact(
    value,
    'chimeraInstanceId thresholdConfirmationFactId gmIntervals completedDevourings',
  );
  const chimeraInstanceId = ref(row.chimeraInstanceId),
    thresholdConfirmationFactId = ref(row.thresholdConfirmationFactId);
  const values = array(row.gmIntervals);
  if (
    values.length !== 3 ||
    values.some((n) => typeof n !== 'number' || !Number.isSafeInteger(n) || n < 10 || n > 22)
  )
    return fail('three explicit GM intervals in 10..22 required');
  const gmIntervals = values as [number, number, number];
  const thresholds: [number, number, number] = [
    gmIntervals[0],
    gmIntervals[0] + gmIntervals[1],
    gmIntervals[0] + gmIntervals[1] + gmIntervals[2],
  ];
  const seenFacts = new Set<string>([thresholdConfirmationFactId]),
    seenOperations = new Set<string>();
  const completedDevourings = array(row.completedDevourings).map(
    (value, index): NpcConfirmedDevouringLeaf => {
      const fact = exact(
        value,
        'completionFactId devouringOperationId ordinal chimeraInstanceId targetContextFactId',
      );
      const completionFactId = ref(fact.completionFactId),
        devouringOperationId = ref(fact.devouringOperationId),
        targetContextFactId = ref(fact.targetContextFactId);
      if (
        seenFacts.has(completionFactId) ||
        seenOperations.has(devouringOperationId) ||
        fact.ordinal !== index + 1 ||
        fact.chimeraInstanceId !== chimeraInstanceId
      )
        return fail('duplicate, reordered or foreign completion leaf');
      seenFacts.add(completionFactId);
      seenOperations.add(devouringOperationId);
      return {
        completionFactId,
        devouringOperationId,
        targetContextFactId,
        ordinal: index + 1,
        chimeraInstanceId,
      };
    },
  );
  return freeze({
    proof: {
      chimeraInstanceId,
      thresholdConfirmationFactId,
      gmIntervals: [...gmIntervals] as [number, number, number],
      completedDevourings,
    },
    thresholds,
    devouredCount: completedDevourings.length,
    extraSlots: thresholds.filter((threshold) => completedDevourings.length >= threshold).length,
  });
}

/** The host supplies actual completed MON-004/006 operation leaves, never a counter or invented history. */
export function deriveNpcChimeraSlotProgress(
  catalog: NpcMonsterPassiveCatalog,
  proof: unknown,
  previousConfirmedProofOrNull: unknown,
): NpcChimeraSlotProgress {
  context(catalog);
  const result = slotProof(proof);
  if (previousConfirmedProofOrNull !== null) {
    const before = slotProof(previousConfirmedProofOrNull).proof,
      after = result.proof;
    if (
      before.chimeraInstanceId !== after.chimeraInstanceId ||
      before.thresholdConfirmationFactId !== after.thresholdConfirmationFactId ||
      JSON.stringify(before.gmIntervals) !== JSON.stringify(after.gmIntervals) ||
      before.completedDevourings.length > after.completedDevourings.length ||
      before.completedDevourings.some(
        (leaf, i) => JSON.stringify(leaf) !== JSON.stringify(after.completedDevourings[i]),
      )
    )
      return fail('immutable Chimera slot proof prefix changed');
  }
  progressResults.add(result);
  return result;
}

/** Capacity check over already derived active ordinary slot costs; no authority or composition shortcut. */
export function assertNpcMonsterAdditionalSlots(
  profile: NpcMonsterPassiveProfile,
  progress: NpcChimeraSlotProgress | null,
  ordinarySlotCosts: readonly number[],
): void {
  if (!profiles.has(profile) || (progress !== null && !progressResults.has(progress)))
    return fail('issued profile/progress required');
  const costs = array(ordinarySlotCosts);
  if (costs.some((cost) => cost !== 1))
    return fail('monster additional slots accept only one-slot ordinary symbionts');
  if (profile.speciesKey !== 'CHIMERA') {
    if (progress !== null || costs.length !== 0)
      return fail('Puppeteer/Plague forbid ordinary additional symbionts');
    return;
  }
  if (progress === null || progress.proof.chimeraInstanceId !== profile.input.symbiontInstanceId)
    return fail('exact Chimera slot proof required');
  if (costs.length > progress.extraSlots) return fail('confirmed Chimera extra capacity exceeded');
}
