import { createSymbiontCatalog } from '../symbiont-stage/catalog.js';
import type { SymbiontCatalogSources } from '../symbiont-stage/catalog.js';

/** Source-backed component only: not a complete current maximum HP evaluator. */
export interface NpcPassiveHealthCatalog {
  readonly ordinaryBaseHP: number;
}

/** Produced by the full composition/tree evaluator, never trusted directly from a GM form. */
export interface NpcResolvedHealthSymbiont {
  readonly symbiontInstanceId: string;
  readonly speciesKey: string;
  readonly effectiveLevel: number;
  readonly learnedNodeRefs: readonly string[];
  readonly effectsEnabled: boolean;
}

export interface NpcPassiveHealthComponent {
  readonly kind: 'ORDINARY_BASE_AND_KNOWN_LEARNED_PASSIVES_ONLY';
  readonly ordinaryBaseHP: number;
  readonly contributions: readonly Readonly<{
    symbiontInstanceId: string;
    sourceRuleId: 'SYM-076' | 'SYM-149' | 'MON-012';
    effectiveLevel: number;
    addedHP: number;
  }>[];
  readonly subtotalHP: number;
}

type Row = Readonly<Record<string, unknown>>;
interface SourceContext {
  readonly species: ReadonlyMap<string, number>;
  readonly nodes: ReadonlyMap<string, Readonly<{ species: string; level: number }>>;
  readonly rates: Readonly<Record<'SYM-076' | 'SYM-149' | 'MON-012', number>>;
}
const contexts = new WeakMap<NpcPassiveHealthCatalog, SourceContext>();
const PASSIVES = [
  { rule: 'SYM-076', species: 'TROGR', nodeLevel: 1, scalesWithLevel: true },
  { rule: 'SYM-149', species: 'TOAD', nodeLevel: 6, scalesWithLevel: true },
  { rule: 'MON-012', species: 'CHIMERA', nodeLevel: 3, scalesWithLevel: false },
] as const;

function fail(message: string): never {
  throw new Error(`NPC passive health component: ${message}`);
}
function object(value: unknown, label: string, exactKeys?: readonly string[]): Row {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail(`${label} must be a plain data object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string') ||
    Object.values(descriptors).some((d) => !d.enumerable || !Object.hasOwn(d, 'value'))
  )
    return fail(`${label} has non-data fields`);
  if (
    exactKeys &&
    (keys.length !== exactKeys.length || exactKeys.some((key) => !Object.hasOwn(descriptors, key)))
  )
    return fail(`${label} fields must be exact`);
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, d]) => [key, d.value as unknown]),
  );
}
function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail(`${label} must be a plain data array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    !length ||
    !Object.hasOwn(length, 'value') ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0
  )
    return fail(`${label} length is invalid`);
  const count = length.value as number;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== count + 1) return fail(`${label} has extra or missing fields`);
  const result: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    const d = descriptors[String(index)];
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value'))
      return fail(`${label} is not dense data`);
    result.push(d.value as unknown);
  }
  return result;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    return fail(`${label} must be nonempty text`);
  return value;
}
function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    return fail(`${label} must be a positive safe integer`);
  return value;
}
function rows(value: unknown, label: string): readonly Row[] {
  return array(value, label).map((item, index) => object(item, `${label}[${index}]`));
}
function one(source: readonly Row[], key: string, id: string): Row {
  const found = source.filter((row) => row[key] === id);
  if (found.length !== 1) return fail(`${key} ${id} must have exactly one source row`);
  return found[0]!;
}
function matchNumber(value: unknown, pattern: RegExp, label: string): number {
  const matches = [...text(value, label).matchAll(pattern)];
  if (matches.length !== 1) return fail(`${label} formula is not recognized exactly once`);
  return integer(Number(matches[0]![1]), label);
}

/** Reads numerical values from supplied sources; reviewed IDs are selectors, not new rules. */
export function createNpcPassiveHealthCatalog(
  input: Readonly<{
    rules: unknown;
    symbiontSources: SymbiontCatalogSources;
    developmentNodes: unknown;
    characterRuntime: unknown;
  }>,
): NpcPassiveHealthCatalog {
  const sources = object(input, 'catalog input', [
    'rules',
    'symbiontSources',
    'developmentNodes',
    'characterRuntime',
  ]);
  const rules = rows(sources.rules, 'rules');
  const runtime = rows(sources.characterRuntime, 'character runtime');
  const baseRule = one(rules, 'Rule ID', 'CORE-152');
  const ordinaryBaseHP = matchNumber(baseRule['Предусловия'], /базовый maxHP=(\d+)\./g, 'CORE-152');
  const profile = one(runtime, 'ContractKey', 'maxHP');
  if (profile.NormativeValue !== 'CharacterProfile' || profile.Status !== ordinaryBaseHP)
    return fail('CharacterProfile maxHP disagrees with CORE-152');
  const trogr = one(rules, 'Rule ID', 'SYM-076');
  const toad = one(rules, 'Rule ID', 'SYM-149');
  const chimera = one(rules, 'Rule ID', 'MON-012');
  for (const row of [baseRule, trogr, toad, chimera])
    if (row['Статус'] !== 'Активно') return fail('selected rule is not active');
  const rates = Object.freeze({
    'SYM-076': matchNumber(trogr['Итоговый алгоритм'], /добавить (\d+)L к maxHP/g, 'SYM-076'),
    'SYM-149': matchNumber(toad['Итоговый алгоритм'], /maxHP \+=(\d+)L;/g, 'SYM-149'),
    'MON-012': matchNumber(chimera['Итоговый алгоритм'], /^maxHP \+= (\d+)\.$/g, 'MON-012'),
  });
  // AQ2-022 explicitly prevents treating permanent Trogr stat history as an HP bonus.
  const removal = one(rules, 'Rule ID', 'AQ2-022');
  if (
    !text(removal['Итоговый алгоритм'], 'AQ2-022').includes(
      'Бонус 20L к maxHP, броня, способности, пределы и остальные активные пассивы Трогра прекращаются;',
    )
  )
    return fail('Trogr removal boundary changed');
  if (
    chimera['Исключения / приоритет'] !==
    'удаление/отключение симбионта обрабатывается общими правилами пассивов.'
  )
    return fail('MON-012 passive lifetime changed');
  const disabled = one(rules, 'Rule ID', 'CORE-104');
  if (
    !text(disabled['Итоговый алгоритм'], 'CORE-104').includes(
      'запретить активные способности, пассивные механические эффекты',
    )
  )
    return fail('disabled passive boundary changed');
  // The existing catalog validates the mixed species/stat-link source sheet in full.
  const symbionts = createSymbiontCatalog(input.symbiontSources);
  const speciesRows = rows(input.symbiontSources.symbionts, 'validated symbionts');
  const species = new Map<string, number>(
    symbionts.species.map((row) => [
      row.speciesKey,
      integer(one(speciesRows, 'SpeciesKey', row.speciesKey).MaxL, 'species maximum level'),
    ]),
  );
  const nodes = new Map<string, Readonly<{ species: string; level: number }>>();
  for (const row of rows(sources.developmentNodes, 'development nodes')) {
    const nodeRef = text(row.NodeRef, 'node reference');
    const key = text(row.SpeciesKey, 'node species');
    const level = integer(row.L, 'node level');
    if (nodes.has(nodeRef) || !species.has(key) || level > species.get(key)!)
      return fail('duplicate node or inconsistent node level/species');
    nodes.set(nodeRef, Object.freeze({ species: key, level }));
  }
  for (const passive of PASSIVES) {
    const row = one(rows(sources.developmentNodes, 'development nodes'), 'NodeRef', passive.rule);
    if (
      row.SpeciesKey !== passive.species ||
      row.L !== passive.nodeLevel ||
      row.AbilityID !== passive.rule ||
      row.AutomationStatus !== 'AUTOMATED_ACCEPTED' ||
      row.NodeKind !== 'AUTOMATED_ABILITY_NODE'
    )
      return fail(`${passive.rule} learned node binding changed`);
  }
  const catalog = Object.freeze({ ordinaryBaseHP });
  contexts.set(catalog, { species, nodes, rates });
  return catalog;
}

/** Caller must first prove race/slots/full node graph, real instance identity and enabled state.
 * This unit checks source membership/level consistency, never grants a node by target level.
 * It neither consumes nor restores Trogr legacy and has no input for an arbitrary HP modifier. */
export function deriveNpcPassiveHealthComponent(
  catalog: NpcPassiveHealthCatalog,
  resolvedSymbionts: readonly NpcResolvedHealthSymbiont[],
): NpcPassiveHealthComponent {
  const source = contexts.get(catalog);
  if (!source) return fail('unknown catalog context');
  const contributions: NpcPassiveHealthComponent['contributions'][number][] = [];
  const identities = new Set<string>();
  const seenSpecies = new Set<string>();
  let subtotalHP = catalog.ordinaryBaseHP;
  for (const value of array(resolvedSymbionts, 'resolved symbionts')) {
    const row = object(value, 'resolved symbiont', [
      'symbiontInstanceId',
      'speciesKey',
      'effectiveLevel',
      'learnedNodeRefs',
      'effectsEnabled',
    ]);
    const id = text(row.symbiontInstanceId, 'instance identity');
    const key = text(row.speciesKey, 'species key');
    const level = integer(row.effectiveLevel, 'effective level');
    if (identities.has(id) || seenSpecies.has(key))
      return fail('ambiguous duplicate instance/species input');
    identities.add(id);
    seenSpecies.add(key);
    const maximum = source.species.get(key);
    if (maximum === undefined || level > maximum) return fail('unknown species or invalid level');
    if (typeof row.effectsEnabled !== 'boolean')
      return fail('effectsEnabled must be a resolved boolean');
    const learned = new Set<string>();
    let maximumLearnedLevel = 0;
    for (const value of array(row.learnedNodeRefs, 'learned nodes')) {
      const nodeRef = text(value, 'learned node');
      const node = source.nodes.get(nodeRef);
      if (!node || node.species !== key || node.level > level || learned.has(nodeRef))
        return fail('unknown, foreign, duplicate or over-level learned node');
      learned.add(nodeRef);
      maximumLearnedLevel = Math.max(maximumLearnedLevel, node.level);
    }
    if (maximumLearnedLevel !== level) return fail('effective level differs from learned nodes');
    for (const passive of PASSIVES) {
      if (key !== passive.species || !learned.has(passive.rule) || !row.effectsEnabled) continue;
      const addedHP = source.rates[passive.rule] * (passive.scalesWithLevel ? level : 1);
      if (!Number.isSafeInteger(addedHP) || !Number.isSafeInteger(subtotalHP + addedHP))
        return fail('HP component overflow');
      subtotalHP += addedHP;
      contributions.push(
        Object.freeze({
          symbiontInstanceId: id,
          sourceRuleId: passive.rule,
          effectiveLevel: level,
          addedHP,
        }),
      );
    }
  }
  return Object.freeze({
    kind: 'ORDINARY_BASE_AND_KNOWN_LEARNED_PASSIVES_ONLY',
    ordinaryBaseHP: catalog.ordinaryBaseHP,
    contributions: Object.freeze(contributions),
    subtotalHP,
  });
}
