import type { StatCode } from '@generated/types/character.js';
import type { StatBlock } from '../skill-stage/stats.js';
import type { SymbiontCatalog } from '../symbiont-stage/catalog.js';
import { deriveNpcBaseStatLayers, type NpcBaseStatCatalog } from './base-stats.js';
import {
  evaluateNpcCompositionConsequences,
  npcTrogrRawStatDelta,
  type NpcCompositionConsequenceCatalog,
} from './composition-consequences.js';
import type { NpcCompositionConsequenceResult } from './composition-consequence-types.js';
import {
  deriveNpcInventoryStatContributions,
  npcPublicationData as data,
  type NpcInventoryPublicationCatalog,
} from './inventory-publication.js';
import type { NpcInventoryCatalog } from './inventory.js';
import type { NpcDerivedSymbiont, NpcStatLayers } from './types.js';
import {
  deriveNpcInitialMonsterProfile,
  type NpcInitialMonsterCatalog,
} from './initial-monster-composition.js';

export interface NpcOrdinaryStatComponents {
  readonly baseStats: NpcBaseStatCatalog;
  readonly symbionts: SymbiontCatalog;
  readonly compositionConsequences: NpcCompositionConsequenceCatalog;
  readonly initialMonsters?: NpcInitialMonsterCatalog;
  readonly equipment?: Readonly<{
    inventory: NpcInventoryCatalog;
    publication: NpcInventoryPublicationCatalog;
  }>;
}
export interface NpcOrdinaryStatCatalog {
  readonly kind: 'SOURCE_BOUND_NPC_ORDINARY_STATS';
}
export interface NpcOrdinaryStatContext {
  readonly schema: ReturnType<typeof deriveNpcBaseStatLayers>['schema'];
  readonly stats: NpcStatLayers;
  readonly composition: NpcCompositionConsequenceResult;
  readonly symbionts: readonly NpcDerivedSymbiont[];
  readonly nonTrogrBasis: StatBlock;
  readonly rawEquippedStats: StatBlock;
  readonly effectiveLimits: NpcEffectiveStatLimits;
  /** An authoring context is not a saved character; no floor repairs these values. */
  readonly invalidPermanentStats: readonly StatCode[];
}
declare const limitsBrand: unique symbol;
export interface NpcEffectiveStatLimits {
  readonly [limitsBrand]: true;
}
const issuedLimits = new WeakMap<
  NpcEffectiveStatLimits,
  Readonly<{
    minimums: Readonly<Partial<Record<StatCode, number>>>;
    maximums: Readonly<Partial<Record<StatCode, number>>>;
  }>
>();
/** Only source bounds are applied here. CORE-078's computational floor is a later phase. */
export function applyNpcEffectiveStatLimits(
  limits: NpcEffectiveStatLimits,
  value: StatBlock,
): StatBlock {
  const actual = issuedLimits.get(limits) ?? fail('issued actual-composition stat limits required');
  const input = data.record(value, [...STATS]);
  const result = {} as Record<StatCode, number>;
  for (const stat of STATS) {
    const raw = input[stat];
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw))
      return fail('finite raw integer stats required');
    const minimum = actual.minimums[stat],
      maximum = actual.maximums[stat];
    if (minimum !== undefined && maximum !== undefined && minimum > maximum)
      return fail('conflicting source stat bounds');
    result[stat] = Math.min(maximum ?? Infinity, Math.max(minimum ?? -Infinity, raw));
  }
  return Object.freeze(result);
}
const STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const contexts = new WeakMap<NpcOrdinaryStatCatalog, NpcOrdinaryStatComponents>();
function fail(detail: string): never {
  throw new Error(`NPC ordinary stats: ${detail}`);
}
function rule(rows: readonly Record<string, unknown>[], id: string): string {
  const found = rows.filter((r) => r['Rule ID'] === id);
  if (found.length !== 1 || found[0]?.['Статус'] !== 'Активно')
    return fail(`missing active source ${id}`);
  return data.text(found[0]['Итоговый алгоритм']);
}

/** Source guards cover the exact arithmetic used here; no target-level auto-grant is performed. */
export function createNpcOrdinaryStatCatalog(
  components: NpcOrdinaryStatComponents,
  rules: unknown,
): NpcOrdinaryStatCatalog {
  data.record(components, [
    'baseStats',
    'symbionts',
    'compositionConsequences',
    ...(Object.hasOwn(components, 'equipment') ? ['equipment'] : []),
    ...(Object.hasOwn(components, 'initialMonsters') ? ['initialMonsters'] : []),
  ]);
  if (components.equipment !== undefined)
    data.record(components.equipment, ['inventory', 'publication']);
  const rows = data.array(rules).map((r) => data.record(r));
  for (const [id, expected] of [
    [
      'SYM-054',
      'W_bonus=max(0,min(4L,20−W_base)); W=W_base+W_bonus. Если Учитель — единственный симбионт, I_bonus=max(0,min(4L,20−I_base)), I=I_base+I_bonus.',
    ],
    ['SYM-062', 'Z = Z_base + L; при гибели/удалении вернуть базовое.'],
    ['SYM-108', 'S=S_base+L; при гибели/удалении вернуть базовую.'],
    ['SYM-122', 'D=D_base+L; при гибели/удалении вернуть базовую.'],
    ['SYM-162', 'повысить I на 5L, но не выше 30; при удалении/гибели вернуть исходное.'],
  ] as const)
    data.equal(expected, rule(rows, id));
  if (
    !rule(rows, 'AQA-005').includes(
      'Пределы применяются к итоговой характеристике после суммирования всех активных дельт',
    ) ||
    !rule(rows, 'AQA-005').includes('В ручном режиме общего пола нет.') ||
    !rule(rows, 'CORE-164').includes('персонаж валиден, только если каждая ≥1;') ||
    !rule(rows, 'CORE-079').includes('точная установка и явно названные min/max')
  )
    return fail('unknown permanent stat order/minimum source');
  data.equal(
    'постоянное значение не ниже 1; ручное распределение до расовых/симбиотических поправок — не более 20 в одну характеристику; случайные значения, криты, раса, симбионты и развитие могут дать >20; временный штраф может сделать итог проверки отрицательным, но не саму характеристику, если эффект не говорит иное.',
    rule(rows, 'CORE-078'),
  );
  const catalog = Object.freeze({ kind: 'SOURCE_BOUND_NPC_ORDINARY_STATS' as const });
  contexts.set(catalog, {
    baseStats: components.baseStats,
    compositionConsequences: components.compositionConsequences,
    symbionts: data.freeze(structuredClone(components.symbionts)),
    ...(components.equipment === undefined ? {} : { equipment: components.equipment }),
    ...(components.initialMonsters === undefined
      ? {}
      : { initialMonsters: components.initialMonsters }),
  });
  return catalog;
}

/** Replays the actual composition prefix; a supplied final instance array is never its own proof. */
export function deriveNpcOrdinaryStatContext(
  catalog: NpcOrdinaryStatCatalog,
  value: unknown,
): NpcOrdinaryStatContext {
  const context = deriveNpcOrdinaryDraftStatContext(catalog, value);
  assertNpcOrdinaryStatContextValid(context);
  return context;
}

/** NPC authoring retains incomplete drafts before NPC-015; publication still requires validity. */
export function deriveNpcOrdinaryDraftStatContext(
  catalog: NpcOrdinaryStatCatalog,
  value: unknown,
): NpcOrdinaryStatContext {
  return deriveContext(catalog, value, null);
}

export function assertNpcOrdinaryStatContextValid(context: NpcOrdinaryStatContext): void {
  for (const stat of STATS) {
    const value = context.stats.permanentStats[stat];
    if (!Number.isSafeInteger(value)) return fail('permanent stat overflow');
    if (value < 1) return fail(`CORE-164 permanent ${stat} below one`);
  }
}

/** The owning inventory evaluator proves this condition from actual equipped items. */
export function deriveNpcOrdinaryEquippedStats(
  catalog: NpcOrdinaryStatCatalog,
  value: unknown,
  equipment: Readonly<{ equippedHermeticNate: boolean }>,
): StatBlock {
  return deriveNpcOrdinaryEquippedContext(catalog, value, equipment).stats.permanentStats;
}
export function deriveNpcOrdinaryEquippedContext(
  catalog: NpcOrdinaryStatCatalog,
  value: unknown,
  equipment: Readonly<{ equippedHermeticNate: boolean }>,
): NpcOrdinaryStatContext {
  const row = data.record(equipment, ['equippedHermeticNate']);
  if (typeof row.equippedHermeticNate !== 'boolean')
    return fail('explicit equipment condition required');
  const context = deriveContext(catalog, value, row.equippedHermeticNate);
  assertNpcOrdinaryStatContextValid(context);
  return context;
}

function deriveContext(
  catalog: NpcOrdinaryStatCatalog,
  value: unknown,
  equippedHermeticNateOverride: boolean | null,
): NpcOrdinaryStatContext {
  const components = contexts.get(catalog) ?? fail('expected issued source catalog');
  const candidate = data.record(value);
  const hasEquipment = Object.hasOwn(candidate, 'equippedInventory');
  const input = data.record(value, [
    'schema',
    'baseStats',
    'compositionProof',
    ...(hasEquipment ? ['equippedInventory'] : []),
  ]);
  let equippedHermeticNate = equippedHermeticNateOverride ?? false;
  let equipmentMobilityModifier = 0;
  let itemBonuses: StatBlock = { S: 0, D: 0, M: 0, Z: 0, I: 0, W: 0, C: 0 };
  if (hasEquipment) {
    if (equippedHermeticNateOverride !== null)
      return fail('historical inventory and current equipment condition cannot be mixed');
    const equipment = components.equipment ?? fail('historical equipment source catalog required');
    const contribution = deriveNpcInventoryStatContributions(
      equipment.publication,
      input.equippedInventory,
    );
    itemBonuses = contribution.itemContribution.totals;
    equippedHermeticNate = contribution.equippedHermeticNate;
    equipmentMobilityModifier = contribution.armor.mobilityModifier;
  }
  const base = deriveNpcBaseStatLayers(components.baseStats, {
    schema: input.schema,
    baseStats: input.baseStats,
  });
  const composition = evaluateNpcCompositionConsequences(
    components.compositionConsequences,
    input.compositionProof,
    null,
  );
  if (composition.composition.raceCode !== base.schema.raceCode)
    return fail('current schema differs from replayed composition race');
  const present = composition.composition.instances.filter(
    (i) => i.status === 'ACTIVE' || i.status === 'SUPPRESSED',
  );
  const permanent: Record<StatCode, number> = { ...base.skillStageStats };
  const add = (stat: StatCode, delta: number) => {
    const sum = permanent[stat] + delta;
    if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(sum))
      return fail('permanent stat overflow');
    permanent[stat] = sum;
  };
  const active = (species: string, node: string) =>
    present.find(
      (i) => i.speciesKey === species && i.effectsEnabled && i.learnedNodeRefs.includes(node),
    );
  for (const instance of present) {
    const species = components.symbionts.species.find((s) => s.speciesKey === instance.speciesKey);
    if (species === undefined) return fail('recognized composition species source required');
    if (!instance.effectsEnabled) continue;
    if (species.kind === 'SYMBIOTIC_MONSTER') {
      const profile = deriveNpcInitialMonsterProfile(
        components.initialMonsters ?? fail('initial monster source catalog required'),
        {
          raceCode: base.schema.raceCode,
          symbiont: {
            symbiontInstanceId: instance.symbiontInstanceId,
            speciesKey: instance.speciesKey,
            targetLevel: instance.targetLevel,
            learnedNodeRefs: instance.learnedNodeRefs,
            binding: instance.binding,
            currentOE: instance.currentOE,
          },
        },
      );
      for (const stat of STATS) add(stat, profile.basePermanentStatDelta[stat]);
      continue;
    }
    if (species.kind !== 'ORDINARY') return fail('unrecognized composition species kind');
    for (const modifier of species.modifiers) {
      if (
        modifier.contextPredicate !== 'symbiontActive=true' &&
        modifier.contextPredicate !== 'symbiontActive=true AND NOT equippedHermeticNate'
      )
        return fail('unknown source profile predicate');
      // Q-CHAR-009 / SYM-174: the permanent penalty itself is conditional on
      // actual hermetic Nate. Every historical fact carries its own loadout;
      // a later equipped item never rewrites earlier stat/skill contexts.
      if (
        equippedHermeticNate &&
        modifier.contextPredicate === 'symbiontActive=true AND NOT equippedHermeticNate'
      )
        continue;
      add(modifier.targetCode, modifier.value);
    }
  }
  const teacher = active('TEACHER', 'SYM-054');
  if (teacher !== undefined) {
    add('W', 4 * teacher.targetLevel);
    if (present.length === 1)
      add('I', Math.max(0, Math.min(4 * teacher.targetLevel, 20 - base.skillStageStats.I)));
  }
  const dolphin = active('DOLPHIN', 'SYM-162');
  if (dolphin !== undefined) add('I', 5 * dolphin.targetLevel);
  for (const [species, node, stat] of [
    ['ARMADILLO', 'SYM-062', 'Z'],
    ['TICK', 'SYM-108', 'S'],
    ['SPIDER', 'SYM-122', 'D'],
  ] as const) {
    const instance = active(species, node);
    if (instance !== undefined) add(stat, instance.targetLevel);
  }
  if (composition.lifetimeFacts.freeExtraSlot.kind === 'UNLOCKED')
    for (const stat of STATS)
      add(stat, composition.lifetimeFacts.freeExtraSlot.permanentStatConsequence[stat]);
  const minimums: Partial<Record<StatCode, number>> = {};
  const maximums: Partial<Record<StatCode, number>> = {};
  if (teacher !== undefined) maximums.W = 20;
  if (dolphin !== undefined) maximums.I = 30;
  // The counterfactual without any Trogr contribution has its own source caps.
  // Keep the uncapped real sum until the signed legacy is added as well (AQA-005 / AQ2-022).
  const nonTrogrBasis: StatBlock = Object.freeze({
    ...permanent,
    W: teacher === undefined ? permanent.W : Math.min(permanent.W, 20),
    I: dolphin === undefined ? permanent.I : Math.min(permanent.I, 30),
  });
  const ledger = composition.lifetimeFacts.trogrStrengthAndLegacyOrNull;
  if (ledger?.legacyOrNull != null)
    for (const stat of STATS) add(stat, ledger.legacyOrNull.signedSnapshot[stat]);
  const trogr = active('TROGR', 'SYM-076');
  if (trogr !== undefined) {
    // Pending closure can preview the actual confirmed specimen, but cannot finish
    // a sheet. Reached strength never falls when the current specimen is lowered.
    const raw = npcTrogrRawStatDelta(Math.max(ledger?.reachedLevel ?? 0, trogr.targetLevel));
    const included = ledger?.includedRawDelta ?? npcTrogrRawStatDelta(0);
    for (const stat of STATS) add(stat, raw[stat] - included[stat]);
    const absorbedTeacher = trogr.absorbedSpeciesKeys.includes('TEACHER');
    const suppressedAdviser = composition.composition.instances.find(
      (i) => i.speciesKey === 'ADVISER' && i.status === 'SUPPRESSED',
    );
    const suppression =
      suppressedAdviser === undefined
        ? null
        : composition.advisorContinuations.find(
            (c) => c.symbiontInstanceId === suppressedAdviser.symbiontInstanceId,
          )?.suppression;
    const bonus = suppression?.kind === 'RESOLVED' ? suppression.bonus : 0;
    for (const stat of STATS) {
      if (stat === 'S' || stat === 'D' || stat === 'M' || stat === 'Z')
        maximums[stat] = base.schema.raceCode === 'UNITED' ? 25 : 35;
      else {
        minimums[stat] =
          ((stat === 'I' || stat === 'W') && absorbedTeacher ? 4 : 1) + (stat === 'I' ? bonus : 0);
      }
    }
  }
  for (const stat of STATS)
    if (!Number.isSafeInteger(permanent[stat])) return fail('permanent stat overflow');
  const effectiveLimits = Object.freeze({}) as NpcEffectiveStatLimits;
  issuedLimits.set(effectiveLimits, data.freeze({ minimums, maximums }));
  const permanentStats = applyNpcEffectiveStatLimits(effectiveLimits, permanent);
  const rawEquippedStats: StatBlock = Object.freeze(
    Object.fromEntries(
      STATS.map((stat) => [
        stat,
        permanentStats[stat] + itemBonuses[stat] + (stat === 'M' ? equipmentMobilityModifier : 0),
      ]),
    ) as Record<StatCode, number>,
  );
  if (!Object.values(rawEquippedStats).every(Number.isSafeInteger))
    return fail('equipment stat overflow');
  const limited = applyNpcEffectiveStatLimits(effectiveLimits, rawEquippedStats);
  // CORE-078 applies to temporary equipment penalties, not invalid permanent
  // authoring input. Disease thresholds consume their own issued raw gear basis.
  const effectiveStats: StatBlock = Object.freeze(
    Object.fromEntries(
      STATS.map((stat) => [
        stat,
        permanentStats[stat] >= 1 ? Math.max(1, limited[stat]) : limited[stat],
      ]),
    ) as Record<StatCode, number>,
  );
  return data.freeze({
    schema: base.schema,
    composition,
    nonTrogrBasis,
    rawEquippedStats,
    effectiveLimits,
    invalidPermanentStats: STATS.filter((stat) => permanentStats[stat] < 1),
    stats: {
      baseStats: base.baseStats,
      skillStageStats: base.skillStageStats,
      permanentStats,
      effectiveStats,
    },
    symbionts: present.map((i) => {
      if (i.status !== 'ACTIVE' && i.status !== 'SUPPRESSED')
        return fail('current instance must be present');
      return {
        symbiontInstanceId: i.symbiontInstanceId,
        speciesKey: i.speciesKey,
        targetLevel: i.targetLevel,
        learnedNodeRefs: i.learnedNodeRefs,
        binding: i.binding,
        currentOE: i.currentOE,
        status: i.status,
        computedMaxOE: i.nativeMaxOE,
        slotCost: i.slotCost,
        effectsEnabled: i.effectsEnabled,
      };
    }),
  });
}
