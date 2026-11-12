import type { EnemyStats } from './enemy-authoring.js';
import { enemySymbiontChoiceValue, type EnemySymbiontChoice } from './enemy-composition.js';
import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import {
  monsterRuntimeDefinitionValue,
  type MonsterRuntimeDefinition,
} from './monster-runtime-definition.js';

export const CUSTOM_MONSTER_PLACEHOLDER = 'symbiosis_placeholder_monster' as const;
/** Supplied ADR0077 GM portrait mapping, not a generated/guessed monster image. */
export const CUSTOM_MONSTER_PLACEHOLDER_SHA256 =
  '563c23e0190bff9b5498bc0ec46830f9209fa1d181fe163e3ea76edbab7e7e86';
export const CUSTOM_MONSTER_STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;

export interface CustomMonsterIdentity {
  readonly name: string;
  readonly description: string | null;
  /** Atlas ENM-011 creatureType displays the actual immutable kind; it is not a new type enum. */
  readonly creatureType: 'CUSTOM_MONSTER';
}
export interface CustomMonsterStatsInput {
  readonly statMode: 'MANUAL';
  readonly baseStats: EnemyStats;
  readonly massKg: number;
  readonly ageYears: number;
  readonly baseMaxHP: number;
  readonly rollReceiptOrNull: null;
}
export interface CustomMonsterPhysics {
  readonly naturalArmorDefinition: MonsterRuntimeDefinition;
  readonly anatomyMode: 'NONSTANDARD_TORSO_ONLY';
  readonly normalizedHitRegion: 'TORSO';
  readonly size: string | null;
  readonly movement: string | null;
  readonly physicalTags: readonly string[];
  readonly metadataHasNoMechanicalEffect: true;
}
export interface CustomMonsterAttack {
  readonly category: 'MONSTER_ATTACK';
  readonly distance: 'MELEE';
  readonly actionCost: 1;
  readonly additionalDamageDefinition: MonsterRuntimeDefinition;
  readonly penetrationDefinition: MonsterRuntimeDefinition;
}
export type CustomMonsterSymbiontSelection =
  Readonly<{ mode: 'NONE' }> | Readonly<{ mode: 'ORDINARY'; symbiont: EnemySymbiontChoice }>;
export interface CustomMonsterManualInput {
  readonly identity: CustomMonsterIdentity;
  readonly stats: CustomMonsterStatsInput;
  readonly physics: CustomMonsterPhysics;
  readonly attack: CustomMonsterAttack;
  readonly symbiont: CustomMonsterSymbiontSelection;
}

export function customMonsterIdentityValue(value: unknown): CustomMonsterIdentity {
  const row = r.exact(value, 'name description creatureType', '$.monster.identity');
  r.raw(row['name'], '$.monster.identity.name');
  if (row['description'] !== null) r.raw(row['description'], '$.monster.identity.description');
  w.literal(row['creatureType'], 'CUSTOM_MONSTER', '$.monster.identity.creatureType');
  return w.validated(structuredClone(row));
}

export function customMonsterStatsValue(value: unknown): CustomMonsterStatsInput {
  const row = r.exact(
    value,
    'statMode baseStats massKg ageYears baseMaxHP rollReceiptOrNull',
    '$.monster.stats',
  );
  // #260 owns the future once-right and receipt. An unavailable choice cannot be a silent MANUAL alias.
  w.literal(row['statMode'], 'MANUAL', '$.monster.stats.statMode');
  w.literal(row['rollReceiptOrNull'], null, '$.monster.stats.rollReceiptOrNull');
  const stats = r.exact(row['baseStats'], CUSTOM_MONSTER_STATS.join(' '), '$.monster.baseStats');
  for (const stat of CUSTOM_MONSTER_STATS)
    if (r.integer(stats[stat], '$.monster.baseStats.' + stat, 1) > 35)
      r.invalid('$.monster.baseStats.' + stat, 'CORE-200 base integer 1..35', null);
  const mass = r.finite(row['massKg'], '$.monster.massKg', 5);
  if (mass > 10_000 || Math.round(mass * 10) / 10 !== mass)
    r.invalid('$.monster.massKg', 'ADR0077 5..10000kg with exact 0.1kg step', null);
  r.integer(row['ageYears'], '$.monster.ageYears', 1);
  r.integer(row['baseMaxHP'], '$.monster.baseMaxHP', 1);
  return w.validated(structuredClone(row));
}

export function customMonsterPhysicsValue(value: unknown): CustomMonsterPhysics {
  const row = r.exact(
    value,
    'naturalArmorDefinition anatomyMode normalizedHitRegion size movement physicalTags metadataHasNoMechanicalEffect',
    '$.monster.physics',
  );
  monsterRuntimeDefinitionValue(row['naturalArmorDefinition']);
  w.literal(row['anatomyMode'], 'NONSTANDARD_TORSO_ONLY', '$.monster.physics.anatomyMode');
  w.literal(row['normalizedHitRegion'], 'TORSO', '$.monster.physics.normalizedHitRegion');
  w.literal(
    row['metadataHasNoMechanicalEffect'],
    true,
    '$.monster.physics.metadataHasNoMechanicalEffect',
  );
  for (const key of ['size', 'movement'])
    if (row[key] !== null) r.raw(row[key], '$.monster.physics.' + key);
  for (const tag of r.list(row['physicalTags'], '$.monster.physics.physicalTags'))
    r.raw(tag, '$.monster.physics.physicalTags[]');
  return w.validated(structuredClone(row));
}

export function customMonsterAttackValue(value: unknown): CustomMonsterAttack {
  const row = r.exact(
    value,
    'category distance actionCost additionalDamageDefinition penetrationDefinition',
    '$.monster.attack',
  );
  w.literal(row['category'], 'MONSTER_ATTACK', '$.monster.attack.category');
  w.literal(row['distance'], 'MELEE', '$.monster.attack.distance');
  w.literal(row['actionCost'], 1, '$.monster.attack.actionCost');
  monsterRuntimeDefinitionValue(row['additionalDamageDefinition']);
  monsterRuntimeDefinitionValue(row['penetrationDefinition']);
  return w.validated(structuredClone(row));
}

export function customMonsterSymbiontSelectionValue(
  value: unknown,
): CustomMonsterSymbiontSelection {
  const raw = r.record(value, '$.monster.symbiont');
  if (raw['mode'] === 'NONE') r.exact(raw, 'mode', '$.monster.symbiont');
  else {
    r.exact(raw, 'mode symbiont', '$.monster.symbiont');
    w.literal(raw['mode'], 'ORDINARY', '$.monster.symbiont.mode');
    enemySymbiontChoiceValue(raw['symbiont']);
  }
  return w.validated(structuredClone(raw));
}

/** Structural closure only. Host applies source identity/graph/body/OE/acquisition validation. */
export function customMonsterManualInputValue(value: unknown): CustomMonsterManualInput {
  const row = r.exact(value, 'identity stats physics attack symbiont', '$.monster');
  customMonsterIdentityValue(row['identity']);
  customMonsterStatsValue(row['stats']);
  customMonsterPhysicsValue(row['physics']);
  customMonsterAttackValue(row['attack']);
  customMonsterSymbiontSelectionValue(row['symbiont']);
  return w.validated(structuredClone(row));
}
