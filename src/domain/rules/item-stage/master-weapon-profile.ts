import type { StatCode } from '@generated/types/character.js';
import type { StartingWeaponSelection, StartingWeaponVariant } from './starting-weapon.js';
import {
  findWeaponProfile,
  type WeaponCombatDefinition,
  type WeaponEffectiveProfile,
  type WeaponProfileCatalog,
} from './weapon-profile.js';

/** Item Registry MasterDiceGrammarTable; X is a typed value, never executable text. */
export type MasterWeaponExpression =
  | Readonly<{ kind: 'RETAIN' }>
  | Readonly<{
      kind: 'MASTER_DICE';
      pattern: 'R4' | 'R4+X' | 'R6' | 'R6+X' | 'R12' | 'R12+X' | 'R20+X' | 'R20*2+X';
      constantOrNull: number | null;
    }>;
export interface MasterWeaponProfileInput {
  readonly weaponVariantId: StartingWeaponVariant;
  readonly damageDefinition: MasterWeaponExpression;
  readonly penetrationDefinition: MasterWeaponExpression;
  readonly statRequirements: Readonly<Partial<Record<StatCode, number>>>;
  readonly instanceDamageOrNull: number | null;
  readonly rangeMetersOrNull: number | null;
  readonly accuracyBonusOrNull: number | null;
}
/** IDs belong to the future published profile version, not an uncommitted review draft. */
export type StagedWeaponCombatDefinition = Omit<
  WeaponCombatDefinition,
  'definitionId' | 'rollGroupId'
>;
export interface StagedWeaponProfile extends Omit<
  WeaponEffectiveProfile,
  'statSource' | 'damageDefinition' | 'penetrationDefinition'
> {
  readonly statSource: 'TEMPLATE_FIXED' | 'PLAYER_FORMULA_VALIDATED' | 'MASTER_OVERRIDE';
  readonly damageDefinition: StagedWeaponCombatDefinition;
  readonly penetrationDefinition: StagedWeaponCombatDefinition;
  readonly accuracyBonus?: number;
}
function fail(detail: string): never {
  throw new Error(`master weapon profile: ${detail}`);
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (descriptor) => !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'),
    )
  )
    fail(`expected exactly ${keys.join(',')}`);
  return value as Record<string, unknown>;
}
function positive(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    fail(`${label} must be finite and positive`);
  return value;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}
function stageDefinition(value: WeaponCombatDefinition): StagedWeaponCombatDefinition {
  return {
    valueMode: value.valueMode,
    sourceNotation: value.sourceNotation,
    baseExpression: value.baseExpression,
    sourceScope: value.sourceScope,
    evaluationScope: value.evaluationScope,
    ...(value.instanceSourceField === undefined
      ? {}
      : { instanceSourceField: value.instanceSourceField }),
    ...(value.conditionalOverride === undefined
      ? {}
      : { conditionalOverride: value.conditionalOverride }),
    effectiveTemplateExpression: value.effectiveTemplateExpression,
    damageModifierStat: value.damageModifierStat,
    dieType: value.dieType,
    rollKind: value.rollKind,
    progressionEligibility: value.progressionEligibility,
    rawRollPersistence: value.rawRollPersistence,
    resolvedResultField: value.resolvedResultField,
    resolvedResultPersistence: value.resolvedResultPersistence,
  };
}
export function stageValidatedWeaponProfile(profile: WeaponEffectiveProfile): StagedWeaponProfile {
  return freeze({
    weaponTypeId: profile.weaponTypeId,
    weaponVariantId: profile.weaponVariantId,
    name: profile.name,
    variantLabel: profile.variantLabel,
    templateProfileVersion: profile.templateProfileVersion,
    statSource: profile.statSource,
    damageDefinition: stageDefinition(profile.damageDefinition),
    penetrationDefinition: stageDefinition(profile.penetrationDefinition),
    statRequirements: { ...profile.statRequirements },
    ...(profile.instanceDamage === undefined ? {} : { instanceDamage: profile.instanceDamage }),
    ...(profile.rangeMeters === undefined ? {} : { rangeMeters: profile.rangeMeters }),
    properties: { ...profile.properties },
  });
}
function definition(
  base: WeaponCombatDefinition,
  input: MasterWeaponExpression,
): StagedWeaponCombatDefinition {
  if (input === null || typeof input !== 'object') fail('missing typed combat definition');
  const head = exact(input, Object.keys(input));
  if (head['kind'] === 'RETAIN') {
    exact(input, ['kind']);
    return stageDefinition(base);
  }
  const row = exact(input, ['kind', 'pattern', 'constantOrNull']);
  if (row['kind'] !== 'MASTER_DICE') fail('unrecognized combat definition choice');
  const patterns = ['R4', 'R4+X', 'R6', 'R6+X', 'R12', 'R12+X', 'R20+X', 'R20*2+X'];
  const pattern = row['pattern'];
  if (typeof pattern !== 'string' || !patterns.includes(pattern))
    fail('expression is outside the closed master dice grammar');
  const hasConstant = pattern.endsWith('+X');
  const constant = hasConstant ? positive(row['constantOrNull'], 'master expression X') : null;
  if (!hasConstant && row['constantOrNull'] !== null)
    fail('expression without X requires explicit null');
  const die = pattern.startsWith('R20')
    ? 20
    : pattern.startsWith('R12')
      ? 12
      : pattern.startsWith('R6')
        ? 6
        : 4;
  const baseExpression = `${pattern.startsWith('R20*2') ? '2*' : ''}ROLL(R${String(die)})${constant === null ? '' : `+${String(constant)}`}`;
  if (!['NONE', 'S', 'D'].includes(base.damageModifierStat))
    fail('unknown protected damage modifier');
  // CORE-189 preserves the weapon's ordinary modifier and special conditional effects.
  return {
    valueMode: 'PER_ATTACK_ROLL',
    sourceNotation: hasConstant ? pattern.replace('X', String(constant)) : pattern,
    baseExpression,
    sourceScope: 'WEAPON_PROFILE_VERSION',
    evaluationScope: 'EACH_RESOLVED_ATTACK',
    ...(base.conditionalOverride === undefined
      ? {}
      : { conditionalOverride: base.conditionalOverride }),
    effectiveTemplateExpression: `${baseExpression}${base.damageModifierStat === 'NONE' ? '' : `+attacker.${base.damageModifierStat}`}`,
    damageModifierStat: base.damageModifierStat,
    dieType: die === 20 ? 'D20' : 'OTHER_DIE',
    rollKind: base.rollKind,
    progressionEligibility: die === 20 ? 'NO_DIRECT_BUT_POOL' : 'NEVER_PROGRESSION',
    rawRollPersistence: 'ATTACK_RESOLUTION_AND_COMBAT_LOG',
    resolvedResultField: base.resolvedResultField,
    resolvedResultPersistence: base.resolvedResultPersistence,
  };
}
function requirements(value: unknown): Readonly<Partial<Record<StatCode, number>>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('stat requirements must be a map');
  const keys = Object.keys(value);
  const row = exact(value, keys),
    result: Partial<Record<StatCode, number>> = {};
  for (const key of keys) {
    if (!['S', 'D', 'M', 'Z', 'I', 'W', 'C'].includes(key)) fail(`unknown stat requirement ${key}`);
    result[key as StatCode] = positive(row[key], `stat requirement ${key}`);
  }
  return result;
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  return (
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((key) => Object.hasOwn(y, key) && same(x[key], y[key]))
  );
}

function propertiesWithRequirements(
  base: WeaponEffectiveProfile,
  updated: Readonly<Partial<Record<StatCode, number>>>,
): WeaponEffectiveProfile['properties'] {
  const properties = { ...base.properties },
    displayed = properties['Требования'];
  if (displayed === undefined) return properties;
  if (typeof displayed !== 'string') fail('unrecognized template requirements display');
  // Fixed templates combine mutable stat thresholds and a protected skill clause.
  // CORE-188 replaces only the former; copying the old label would contradict the map.
  const protectedClauses = displayed.split('; ').filter((part) => !/^[SDMZIWC]\d+$/u.test(part));
  const labels = (['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const).flatMap((stat) =>
    updated[stat] === undefined ? [] : [`${stat}${String(updated[stat])}`],
  );
  const current = [...labels, ...protectedClauses];
  delete properties['Требования'];
  if (current.length !== 0) properties['Требования'] = current.join('; ');
  return properties;
}

/** CORE-187/188/189: full explicit editable input, exact inherited protected fields, no RNG. */
export function deriveMasterWeaponProfile(
  catalog: WeaponProfileCatalog,
  selection: StartingWeaponSelection,
  input: MasterWeaponProfileInput,
  validatedRequestProfileOrNull: WeaponEffectiveProfile | null,
): StagedWeaponProfile {
  exact(input, [
    'weaponVariantId',
    'damageDefinition',
    'penetrationDefinition',
    'statRequirements',
    'instanceDamageOrNull',
    'rangeMetersOrNull',
    'accuracyBonusOrNull',
  ]);
  const entry = findWeaponProfile(catalog, selection);
  if (input.weaponVariantId !== selection.weaponVariant)
    fail('typed profile variant differs from the selected catalog variant');
  const base = validatedRequestProfileOrNull ?? entry.template;
  if (
    base.weaponTypeId !== selection.weaponTypeId ||
    base.weaponVariantId !== selection.weaponVariant ||
    base.templateProfileVersion !== entry.canonicalProfileVersion
  )
    fail('retained profile belongs to another weapon type, variant or template');
  const damageDefinition = definition(base.damageDefinition, input.damageDefinition);
  const penetrationDefinition = definition(base.penetrationDefinition, input.penetrationDefinition);
  const ranged =
    entry.template.rangeMeters !== undefined ||
    (entry.formula?.outputs.some((output) => output.key === 'Rn') ?? false);
  if (damageDefinition.valueMode === 'INSTANCE_VALUE')
    positive(input.instanceDamageOrNull, 'instanceDamage');
  else if (input.instanceDamageOrNull !== null)
    fail('non-instance damage requires absent instanceDamage');
  if (ranged) positive(input.rangeMetersOrNull, 'rangeMeters');
  else if (input.rangeMetersOrNull !== null) fail('melee variant cannot acquire a ranged profile');
  if (input.accuracyBonusOrNull !== null) positive(input.accuracyBonusOrNull, 'accuracyBonus');
  const staged = stageValidatedWeaponProfile(base);
  const statRequirements = requirements(input.statRequirements);
  const result: StagedWeaponProfile = {
    weaponTypeId: base.weaponTypeId,
    weaponVariantId: base.weaponVariantId,
    name: base.name,
    variantLabel: base.variantLabel,
    templateProfileVersion: base.templateProfileVersion,
    statSource: 'MASTER_OVERRIDE',
    damageDefinition,
    penetrationDefinition,
    statRequirements,
    ...(input.instanceDamageOrNull === null ? {} : { instanceDamage: input.instanceDamageOrNull }),
    ...(input.rangeMetersOrNull === null ? {} : { rangeMeters: input.rangeMetersOrNull }),
    ...(input.accuracyBonusOrNull === null ? {} : { accuracyBonus: input.accuracyBonusOrNull }),
    properties: propertiesWithRequirements(base, statRequirements),
  };
  // CORE-187 explicitly allows an unchanged complete canonical template to remain fixed.
  if (
    base.statSource === 'TEMPLATE_FIXED' &&
    same({ ...result, statSource: 'TEMPLATE_FIXED' }, staged)
  )
    return freeze({ ...result, statSource: 'TEMPLATE_FIXED' });
  return freeze(result);
}
