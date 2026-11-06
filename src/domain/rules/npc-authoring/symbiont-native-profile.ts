import {
  createSymbiontBindingSnapshot,
  type SymbiontBinding,
  type SymbiontBindingSelection,
  type SymbiontCatalog,
} from '../symbiont-stage/catalog.js';
import type { NpcDevelopmentCatalog } from './catalog.js';
import { validateNpcDevelopmentSelection } from './development-selection.js';
import type { NpcSymbiontInput } from './types.js';

export type NpcSymbiontNativeInput = Pick<
  NpcSymbiontInput,
  'symbiontInstanceId' | 'speciesKey' | 'targetLevel' | 'learnedNodeRefs' | 'binding'
>;
declare const nativeCatalog: unique symbol;
export interface NpcSymbiontNativeCatalog {
  readonly [nativeCatalog]: true;
}
export interface NpcSymbiontNativeProfile extends NpcSymbiontNativeInput {
  readonly kind: 'NATIVE_PROFILE_BEFORE_COMPOSITION_AND_EFFECTS';
  readonly levelProfileId: string;
  readonly nativeMaxOE: number;
  readonly maxOeRuleIds: readonly string[];
}
interface Context {
  readonly symbionts: SymbiontCatalog;
  readonly development: NpcDevelopmentCatalog;
  readonly keeperOverridePerLevel: number;
}
const contexts = new WeakMap<NpcSymbiontNativeCatalog, Context>();
const issuedProfiles = new WeakSet<NpcSymbiontNativeProfile>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function fail(path: string, detail: string): never {
  throw new Error(`NPC native symbiont profile ${path}: ${detail}`);
}
function exact(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail(path, 'expected plain data');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(descriptors, key)) ||
    Object.values(descriptors).some((field) => !field.enumerable || !Object.hasOwn(field, 'value'))
  )
    return fail(path, 'unexpected, missing or accessor fields');
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    return fail(path, `expected safe integer >= ${minimum}`);
  return value;
}
function activeRule(rules: unknown, id: string): Record<string, unknown> {
  if (!Array.isArray(rules)) return fail('rules', 'expected imported rule rows');
  const matches = rules.filter((row: unknown) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row))
      return fail('rules', 'expected imported objects');
    return (row as Record<string, unknown>)['Rule ID'] === id;
  });
  if (matches.length !== 1) return fail(id, 'expected one source rule');
  const row = matches[0] as Record<string, unknown>;
  if (row['Статус'] !== 'Активно') return fail(id, 'source rule is not active');
  return row;
}

/**
 * Accepts catalogs produced by their existing closed source constructors, not client data.
 * Private copies keep later changes to a caller's catalog from altering an issued context.
 */
export function createNpcSymbiontNativeCatalog(
  symbionts: SymbiontCatalog,
  development: NpcDevelopmentCatalog,
  rules: unknown,
): NpcSymbiontNativeCatalog {
  const source = activeRule(rules, 'SYM-090');
  const text = source['Итоговый алгоритм'];
  const match =
    typeof text === 'string'
      ? /^заменить формулу максимума на maxOE=([1-9]\d*)×L; текущий ОЭ не восстанавливать\.$/u.exec(
          text,
        )
      : null;
  if (
    match === null ||
    source['Предусловия'] !== 'узел изучен.' ||
    source['Субъект'] !== 'Хранитель.'
  )
    return fail('SYM-090', 'unknown learned-node maximum replacement contract');
  const keeperOverridePerLevel = integer(Number(match[1]), 1, 'SYM-090.coefficient');
  const oeRule = activeRule(rules, 'SYM-009');
  if (
    typeof oeRule['Броски / формулы'] !== 'string' ||
    !oeRule['Броски / формулы'].includes(
      `Кромсатель Хранителя заменяет формулу на ${keeperOverridePerLevel}×L.`,
    )
  )
    return fail('SYM-009', 'resource policy and learned override disagree');
  const node = development.nodes.filter((entry) => entry.nodeRef === 'SYM-090');
  if (
    node.length !== 1 ||
    node[0]?.speciesKey !== 'KEEPER' ||
    node[0].abilityIdOrNull !== 'SYM-090'
  )
    return fail('SYM-090', 'missing matching learned Keeper ability');
  if (new Set(symbionts.species.map((entry) => entry.speciesKey)).size !== symbionts.species.length)
    return fail('species', 'duplicate source profile');
  for (const species of symbionts.species) {
    const coefficient = integer(species.initialCurrentOe, 1, species.speciesKey);
    const levels = development.levels.filter((entry) => entry.speciesKey === species.speciesKey);
    if (levels.length === 0) return fail(species.speciesKey, 'missing level profiles');
    for (const level of levels) {
      // Existing initialCurrentOe is parsed from OEPolicy's baseMaxOE=<coefficient>×L.
      // Here it is only a source coefficient; no new/current instance is initialized.
      if (level.baseMaxOE !== coefficient * level.level || !Number.isSafeInteger(level.baseMaxOE))
        return fail(level.levelProfileId, 'level table and species native maximum disagree');
    }
  }
  if (
    development.levels.some(
      (level) => !symbionts.species.some((entry) => entry.speciesKey === level.speciesKey),
    )
  )
    return fail('levels', 'unknown species profile');
  const catalog = Object.freeze({}) as NpcSymbiontNativeCatalog;
  contexts.set(catalog, {
    symbionts: structuredClone(symbionts),
    development: structuredClone(development),
    keeperOverridePerLevel,
  });
  return catalog;
}

/**
 * One specimen's learned native resources and anatomy. This grants no availability,
 * status, slot capacity, acquisition facts, temporary level loss or gameplay action.
 */
export function deriveNpcSymbiontNativeProfile(
  catalog: NpcSymbiontNativeCatalog,
  value: unknown,
): NpcSymbiontNativeProfile {
  const context = contexts.get(catalog);
  if (context === undefined) return fail('catalog', 'expected issued source context');
  const input = exact(
    value,
    ['symbiontInstanceId', 'speciesKey', 'targetLevel', 'learnedNodeRefs', 'binding'],
    'input',
  );
  if (typeof input.symbiontInstanceId !== 'string' || !UUID.test(input.symbiontInstanceId))
    return fail('symbiontInstanceId', 'expected canonical lowercase UUID v4');
  const selection = validateNpcDevelopmentSelection(context.development, {
    speciesKey: input.speciesKey,
    targetLevel: input.targetLevel,
    learnedNodeRefs: input.learnedNodeRefs,
  });
  const species = context.symbionts.species.find(
    (entry) => entry.speciesKey === selection.speciesKey,
  );
  if (species === undefined) return fail('speciesKey', 'missing native species profile');
  const sided = species.bindingPolicy === 'OWL_EYE' || species.bindingPolicy === 'EEL_ARM';
  const binding = exact(input.binding, sided ? ['kind', 'side'] : ['kind'], 'binding');
  if (binding.kind !== species.bindingPolicy)
    return fail('binding.kind', 'species anatomy mismatch');
  const selections: SymbiontBindingSelection[] = [];
  if (sided) {
    if (binding.side !== 'LEFT' && binding.side !== 'RIGHT')
      return fail('binding.side', 'explicit LEFT or RIGHT required');
    if (species.speciesKey !== 'OWL' && species.speciesKey !== 'EEL')
      return fail('binding', 'unknown sided species');
    selections.push({ speciesKey: species.speciesKey, side: binding.side });
  }
  // acceptedIndex is only the existing anatomical helper's local array index, never NPC identity.
  const resolvedBinding: SymbiontBinding | undefined = createSymbiontBindingSnapshot(
    context.symbionts,
    [{ acceptedIndex: 0, speciesKey: selection.speciesKey }],
    selections,
  )[0]?.binding;
  if (resolvedBinding === undefined) return fail('binding', 'source anatomy not resolved');
  const level = context.development.levels.find(
    (entry) =>
      entry.speciesKey === selection.speciesKey && entry.level === selection.effectiveLevel,
  );
  if (level === undefined) return fail('targetLevel', 'source level profile not found');
  const keeperOverride =
    selection.speciesKey === 'KEEPER' && selection.learnedNodeRefs.includes('SYM-090');
  const nativeMaxOE = keeperOverride
    ? context.keeperOverridePerLevel * selection.effectiveLevel
    : level.baseMaxOE;
  integer(nativeMaxOE, 1, 'nativeMaxOE');
  const result: NpcSymbiontNativeProfile = Object.freeze({
    kind: 'NATIVE_PROFILE_BEFORE_COMPOSITION_AND_EFFECTS',
    symbiontInstanceId: input.symbiontInstanceId,
    speciesKey: selection.speciesKey,
    targetLevel: selection.targetLevel,
    learnedNodeRefs: selection.learnedNodeRefs,
    binding: resolvedBinding,
    levelProfileId: level.levelProfileId,
    nativeMaxOE,
    maxOeRuleIds: Object.freeze([
      species.profileRuleId,
      'SYM-009',
      ...(keeperOverride ? ['SYM-090'] : []),
    ]),
  });
  issuedProfiles.add(result);
  return result;
}

/**
 * Explicit native-only editor check. A full evaluator resolves any current runtime
 * maximum first; it must not treat this helper as that full effect calculation.
 * SYM-009/CORE-077: no guessed origin, refill, transplant reset or silent clamping.
 */
export function validateNpcNativeCurrentOe(
  profile: NpcSymbiontNativeProfile,
  value: unknown,
): number {
  if (!issuedProfiles.has(profile)) return fail('profile', 'expected issued native profile');
  const current = integer(value, 0, 'currentOE');
  if (current > profile.nativeMaxOE) return fail('currentOE', 'exceeds this native maximum');
  return current;
}
