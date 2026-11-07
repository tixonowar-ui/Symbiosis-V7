import type { StatCode } from '@generated/types/character.js';
import { ARMOR_BODY_ZONES, type ArmorBodyZone } from '../item-stage/armor-bundle.js';
import {
  deriveMasterWeaponProfile,
  type MasterWeaponProfileInput,
  type StagedWeaponProfile,
  type MasterWeaponBaseProfile,
} from '../item-stage/master-weapon-profile.js';
import {
  STARTING_WEAPON_VARIANTS,
  type StartingWeaponVariant,
} from '../item-stage/starting-weapon.js';
import {
  canonicalFixedWeaponProfile,
  type WeaponProfileCatalog,
} from '../item-stage/weapon-profile.js';
import { stageValidatedWeaponProfile } from '../item-stage/master-weapon-profile.js';

/** NPC-015 edits typed inputs; published weapon properties never come from the client. */
export type NpcItemProfileRequest =
  | Readonly<{ kind: 'CATALOG' }>
  | Readonly<{
      kind: 'MASTER_WEAPON';
      inputs: readonly MasterWeaponProfileInput[];
      reason: string;
    }>
  | Readonly<{
      kind: 'STRUCTURED_CUSTOM';
      name: string;
      description: string;
      customBonusOrNull: Readonly<{
        customBonusStat: StatCode;
        customBonusValue: number;
        activeOnlyInBackpack: true;
      }> | null;
      massKg: number | null;
      heldSizeClass: 'FITS_IN_FIST' | 'LARGE' | 'UNKNOWN';
      armorWeightClass: 'LIGHT' | 'OTHER' | 'UNKNOWN';
      flammability: 'COMBUSTIBLE' | 'NONCOMBUSTIBLE' | 'UNKNOWN';
      isIgnitionSource: boolean;
      isFood: boolean;
      canReceivePoison: boolean;
      canReceiveFlammableCoating: boolean;
    }>;

export type NpcStructuredCustomProfile = Extract<
  NpcItemProfileRequest,
  { kind: 'STRUCTURED_CUSTOM' }
>;
/** ADR 0084: these are host reservations, not a claim that a complete profile is committed. */
export interface NpcCustomProfileVersionReference {
  readonly profileId: string;
  readonly profileVersionId: string;
  readonly version: number;
  readonly reservationOperationId: string;
}
export interface NpcCampaignCustomProfileReference extends NpcCustomProfileVersionReference {
  readonly kind: 'CAMPAIGN_CUSTOM_PROFILE';
}
export interface NpcCatalogueCustomModifierReference extends NpcCustomProfileVersionReference {
  readonly kind: 'CATALOG_CUSTOM_MODIFIER';
}
export type NpcCustomBonusContainerBinding =
  | Readonly<{ kind: 'NOT_APPLICABLE' }>
  | Readonly<{ kind: 'OUTSIDE_BACKPACK' }>
  | Readonly<{ kind: 'BACKPACK'; backpackItemInstanceId: string }>;
/** A catalogue modifier is separate: it cannot replace the original checked profile. */
export interface NpcCatalogueCustomModifierRequest {
  readonly reference: NpcCatalogueCustomModifierReference;
  readonly profile: NpcStructuredCustomProfile;
  readonly bonusContainerBinding: NpcCustomBonusContainerBinding;
  readonly reason: string;
}
export interface NpcCustomProfileContent {
  readonly profile: NpcStructuredCustomProfile;
  readonly reason: string;
}
export function readNpcCustomProfileContent(value: unknown): NpcCustomProfileContent {
  const row = object(value, ['profile', 'reason'], 'custom.content');
  return freeze({
    profile: readNpcStructuredCustomProfile(row['profile']),
    reason: text(row['reason'], 'custom.reason'),
  });
}
/** Item Registry QUALITY dictionary; these names identify the GM's final choice, not a roll. */
export const NPC_ITEM_QUALITY_TIERS = [
  'MISSING_OR_UNFIT',
  'POOR',
  'ORDINARY',
  'GOOD',
  'EXCEPTIONAL',
  'RARE',
] as const;
export type NpcItemQualityTier = (typeof NPC_ITEM_QUALITY_TIERS)[number];
export interface NpcClothingProperties {
  readonly coveredRegionIds: readonly ArmorBodyZone[];
  readonly hermetic: boolean | 'UNKNOWN';
  readonly flammability: 'COMBUSTIBLE' | 'NONCOMBUSTIBLE' | 'UNKNOWN';
}
export interface NpcInventoryMetadata {
  readonly qualityTier?: NpcItemQualityTier | null;
  readonly clothingProperties?: NpcClothingProperties;
}
export function readNpcItemQualityTier(value: unknown): NpcItemQualityTier | null {
  return nullable(value, (v) => choice(v, NPC_ITEM_QUALITY_TIERS, 'qualityTier'));
}
export function readNpcClothingProperties(value: unknown): NpcClothingProperties {
  const row = object(value, ['coveredRegionIds', 'hermetic', 'flammability'], 'clothingProperties');
  return freeze<NpcClothingProperties>({
    coveredRegionIds: uniqueStrings(
      row['coveredRegionIds'],
      'clothingProperties.coveredRegionIds',
    ).map((v) => choice(v, ARMOR_BODY_ZONES, 'clothing region')),
    hermetic:
      row['hermetic'] === 'UNKNOWN'
        ? 'UNKNOWN'
        : boolean(row['hermetic'], 'clothingProperties.hermetic'),
    flammability: choice(
      row['flammability'],
      ['COMBUSTIBLE', 'NONCOMBUSTIBLE', 'UNKNOWN'],
      'clothingProperties.flammability',
    ),
  });
}
/** Preserve historical absence; an explicit null quality is a different GM decision. */
export function npcInventoryMetadata(value: NpcInventoryMetadata): NpcInventoryMetadata {
  return {
    ...(Object.hasOwn(value, 'qualityTier')
      ? { qualityTier: readNpcItemQualityTier(value.qualityTier) }
      : {}),
    ...(Object.hasOwn(value, 'clothingProperties')
      ? { clothingProperties: readNpcClothingProperties(value.clothingProperties) }
      : {}),
  };
}
/** Immutable physical identity is assigned by the host's attempt, then echoed by the editor. */
export interface NpcCatalogueInventoryRequestEntry extends NpcInventoryMetadata {
  readonly itemInstanceId: string;
  readonly itemTypeId: string;
  readonly quantity: number;
  readonly profile: NpcItemProfileRequest;
  readonly equipped: boolean;
  readonly equippedSlots: readonly string[];
  readonly bodyZone: ArmorBodyZone | null;
  readonly gripMode: 'ONE_HAND' | 'TWO_HAND' | null;
  readonly currentAmmo: number | null;
  readonly shieldCurrentHP: number | null;
  readonly broken: boolean;
  readonly sealed: boolean | null;
  readonly linkedSetInstanceId: string | null;
  readonly componentRole: 'SWORD' | 'RAPIER' | 'SHIELD' | null;
  readonly qualityRoll: number | null;
  readonly coatingInstanceIds: readonly string[];
  readonly issueReason: string;
  /** Absence is the exact historical catalogue shape, never an implicit new modifier. */
  readonly customModifier?: NpcCatalogueCustomModifierRequest;
}
export interface NpcCampaignCustomInventoryRequestEntry extends Omit<
  NpcCatalogueInventoryRequestEntry,
  'itemTypeId' | 'profile' | 'customModifier'
> {
  readonly itemTypeId: null;
  readonly itemTypeReference: NpcCampaignCustomProfileReference;
  readonly profile: NpcStructuredCustomProfile;
  readonly bonusContainerBinding: NpcCustomBonusContainerBinding;
  readonly customProfileReason: string;
}
export type NpcInventoryRequestEntry =
  NpcCatalogueInventoryRequestEntry | NpcCampaignCustomInventoryRequestEntry;

function fail(path: string, detail: string): never {
  throw new Error(`NPC inventory ${path}: ${detail}`);
}
function object(value: unknown, fields: readonly string[], path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(path, 'expected plain data object');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    fail(path, 'unexpected or missing fields');
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      fail(`${path}.${key}`, 'expected own enumerable data field');
    result[key] = descriptor.value as unknown;
  }
  return result;
}
function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    fail(path, 'expected plain data array');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    Reflect.ownKeys(value).length !== length + 1
  )
    fail(path, 'sparse or extended array');
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      fail(path, 'expected dense own data entries');
    result.push(descriptor.value as unknown);
  }
  return result;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(path, 'expected nonempty text');
  return value;
}
function uuid(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  )
    fail(path, 'expected canonical UUID v4');
  return value;
}
function number(value: unknown, min: number, integer: boolean, path: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    (integer && !Number.isSafeInteger(value))
  )
    fail(path, `expected ${integer ? 'safe integer' : 'finite number'} >= ${String(min)}`);
  return Object.is(value, -0) ? 0 : value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected boolean');
  return value;
}
function choice<const T extends readonly string[]>(
  value: unknown,
  values: T,
  path: string,
): T[number] {
  if (typeof value !== 'string' || !values.includes(value))
    fail(path, `expected ${values.join('|')}`);
  return value;
}
function nullable<T>(value: unknown, read: (value: unknown) => T): T | null {
  return value === null ? null : read(value);
}
function uniqueStrings(value: unknown, path: string, read = text): readonly string[] {
  const result = array(value, path).map((entry, index) => read(entry, `${path}[${String(index)}]`));
  if (new Set(result).size !== result.length) fail(path, 'duplicate entries');
  return Object.freeze(result);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function masterInput(value: unknown, path: string): MasterWeaponProfileInput {
  const row = object(
    value,
    [
      'weaponVariantId',
      'damageDefinition',
      'penetrationDefinition',
      'statRequirements',
      'instanceDamageOrNull',
      'rangeMetersOrNull',
      'accuracyBonusOrNull',
    ],
    path,
  );
  const expression = (
    value: unknown,
    path: string,
  ): MasterWeaponProfileInput['damageDefinition'] => {
    if (value === null || typeof value !== 'object') fail(path, 'expected typed expression');
    const discriminator = Object.getOwnPropertyDescriptor(value, 'kind');
    if (discriminator === undefined || !Object.hasOwn(discriminator, 'value'))
      fail(path, 'missing data discriminator');
    if (discriminator.value === 'RETAIN') {
      object(value, ['kind'], path);
      return { kind: 'RETAIN' };
    }
    const definition = object(value, ['kind', 'pattern', 'constantOrNull'], path);
    if (definition['kind'] !== 'MASTER_DICE') fail(path, 'unknown expression kind');
    const pattern = choice(
      definition['pattern'],
      ['R4', 'R4+X', 'R6', 'R6+X', 'R12', 'R12+X', 'R20+X', 'R20*2+X'],
      path,
    );
    const constantOrNull = nullable(definition['constantOrNull'], (v) =>
      number(v, 0, false, `${path}.X`),
    );
    if (
      pattern.endsWith('+X')
        ? constantOrNull === null || constantOrNull <= 0
        : constantOrNull !== null
    )
      fail(path, 'X must be positive exactly when the pattern has X');
    return { kind: 'MASTER_DICE', pattern, constantOrNull };
  };
  const rawRequirements = row['statRequirements'];
  if (rawRequirements === null || typeof rawRequirements !== 'object')
    fail(path, 'missing requirements map');
  const requirementKeys = Reflect.ownKeys(rawRequirements);
  if (
    requirementKeys.some(
      (key) => typeof key !== 'string' || !['S', 'D', 'I', 'W', 'M', 'Z', 'C'].includes(key),
    )
  )
    fail(path, 'unknown stat requirement');
  const required = object(rawRequirements, requirementKeys as string[], `${path}.statRequirements`);
  const statRequirements: Partial<Record<StatCode, number>> = {};
  for (const [key, raw] of Object.entries(required)) {
    const amount = number(raw, 0, false, `${path}.statRequirements.${key}`);
    if (amount <= 0) fail(path, 'stat requirements must be positive');
    statRequirements[key as StatCode] = amount;
  }
  const positiveOrNull = (value: unknown, label: string): number | null =>
    nullable(value, (raw) => {
      const amount = number(raw, 0, false, label);
      if (amount <= 0) fail(label, 'expected positive number');
      return amount;
    });
  return {
    weaponVariantId: choice(
      row['weaponVariantId'],
      STARTING_WEAPON_VARIANTS,
      `${path}.weaponVariantId`,
    ),
    damageDefinition: expression(row['damageDefinition'], `${path}.damageDefinition`),
    penetrationDefinition: expression(
      row['penetrationDefinition'],
      `${path}.penetrationDefinition`,
    ),
    statRequirements,
    instanceDamageOrNull: positiveOrNull(row['instanceDamageOrNull'], `${path}.instanceDamage`),
    rangeMetersOrNull: positiveOrNull(row['rangeMetersOrNull'], `${path}.rangeMeters`),
    accuracyBonusOrNull: positiveOrNull(row['accuracyBonusOrNull'], `${path}.accuracyBonus`),
  };
}
function profile(value: unknown, path: string): NpcItemProfileRequest {
  if (value === null || typeof value !== 'object') fail(path, 'expected profile input');
  const kind = Object.getOwnPropertyDescriptor(value, 'kind');
  if (kind === undefined || !Object.hasOwn(kind, 'value')) fail(path, 'missing data discriminator');
  if (kind.value === 'CATALOG') {
    object(value, ['kind'], path);
    return { kind: 'CATALOG' };
  }
  if (kind.value === 'MASTER_WEAPON') {
    const row = object(value, ['kind', 'inputs', 'reason'], path);
    const inputs = array(row['inputs'], `${path}.inputs`).map((entry, index) =>
      masterInput(entry, `${path}.inputs[${String(index)}]`),
    );
    if (
      inputs.length === 0 ||
      new Set(inputs.map((entry) => entry.weaponVariantId)).size !== inputs.length
    )
      fail(path, 'expected distinct nonempty attack variants');
    return {
      kind: 'MASTER_WEAPON',
      inputs,
      reason: text(row['reason'], `${path}.reason`),
    };
  }
  const row = object(
    value,
    [
      'kind',
      'name',
      'description',
      'customBonusOrNull',
      'massKg',
      'heldSizeClass',
      'armorWeightClass',
      'flammability',
      'isIgnitionSource',
      'isFood',
      'canReceivePoison',
      'canReceiveFlammableCoating',
    ],
    path,
  );
  if (row['kind'] !== 'STRUCTURED_CUSTOM') fail(path, 'unknown profile kind');
  const customBonusOrNull = nullable(row['customBonusOrNull'], (raw) => {
    const bonus = object(
      raw,
      ['customBonusStat', 'customBonusValue', 'activeOnlyInBackpack'],
      `${path}.customBonus`,
    );
    if (bonus['activeOnlyInBackpack'] !== true)
      fail(path, 'custom bonus requires backpack condition');
    return {
      customBonusStat: choice(
        bonus['customBonusStat'],
        ['S', 'D', 'I', 'W', 'M', 'Z', 'C'],
        `${path}.customBonusStat`,
      ),
      customBonusValue: number(bonus['customBonusValue'], 1, true, `${path}.customBonusValue`),
      activeOnlyInBackpack: true as const,
    };
  });
  return {
    kind: 'STRUCTURED_CUSTOM',
    name: text(row['name'], `${path}.name`),
    description: text(row['description'], `${path}.description`),
    customBonusOrNull,
    massKg: nullable(row['massKg'], (v) => number(v, 0, false, `${path}.massKg`)),
    heldSizeClass: choice(
      row['heldSizeClass'],
      ['FITS_IN_FIST', 'LARGE', 'UNKNOWN'],
      `${path}.heldSizeClass`,
    ),
    armorWeightClass: choice(
      row['armorWeightClass'],
      ['LIGHT', 'OTHER', 'UNKNOWN'],
      `${path}.armorWeightClass`,
    ),
    flammability: choice(
      row['flammability'],
      ['COMBUSTIBLE', 'NONCOMBUSTIBLE', 'UNKNOWN'],
      `${path}.flammability`,
    ),
    isIgnitionSource: boolean(row['isIgnitionSource'], `${path}.isIgnitionSource`),
    isFood: boolean(row['isFood'], `${path}.isFood`),
    canReceivePoison: boolean(row['canReceivePoison'], `${path}.canReceivePoison`),
    canReceiveFlammableCoating: boolean(
      row['canReceiveFlammableCoating'],
      `${path}.canReceiveFlammableCoating`,
    ),
  };
}

export function readNpcCustomProfileReference<
  K extends 'CAMPAIGN_CUSTOM_PROFILE' | 'CATALOG_CUSTOM_MODIFIER',
>(value: unknown, kind: K): Readonly<NpcCustomProfileVersionReference & { kind: K }> {
  const row = object(
    value,
    ['kind', 'profileId', 'profileVersionId', 'version', 'reservationOperationId'],
    'custom.reference',
  );
  if (row['kind'] !== kind) fail('custom.reference', 'wrong profile purpose');
  const result = {
    kind,
    profileId: uuid(row['profileId'], 'custom.profileId'),
    profileVersionId: uuid(row['profileVersionId'], 'custom.profileVersionId'),
    version: number(row['version'], 1, true, 'custom.version'),
    reservationOperationId: uuid(row['reservationOperationId'], 'custom.reservationOperationId'),
  };
  if (
    new Set([result.profileId, result.profileVersionId, result.reservationOperationId]).size !== 3
  )
    fail('custom.reference', 'identity domains overlap');
  return freeze(result);
}
export function readNpcCustomBonusContainerBinding(value: unknown): NpcCustomBonusContainerBinding {
  if (value === null || typeof value !== 'object')
    fail('custom.container', 'typed binding required');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'kind');
  const kind: unknown =
    descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  if (kind === 'NOT_APPLICABLE' || kind === 'OUTSIDE_BACKPACK') {
    object(value, ['kind'], 'custom.container');
    return Object.freeze({ kind });
  }
  const row = object(value, ['kind', 'backpackItemInstanceId'], 'custom.container');
  if (row['kind'] !== 'BACKPACK') fail('custom.container', 'unknown binding kind');
  return Object.freeze({
    kind: 'BACKPACK',
    backpackItemInstanceId: uuid(
      row['backpackItemInstanceId'],
      'custom.container.backpackItemInstanceId',
    ),
  });
}
export function readNpcStructuredCustomProfile(value: unknown): NpcStructuredCustomProfile {
  const result = profile(value, 'custom.profile');
  if (result.kind !== 'STRUCTURED_CUSTOM')
    return fail('custom.profile', 'structured profile required');
  return freeze(result);
}
function customModifier(value: unknown): NpcCatalogueCustomModifierRequest {
  const row = object(
    value,
    ['reference', 'profile', 'bonusContainerBinding', 'reason'],
    'custom.modifier',
  );
  return {
    reference: readNpcCustomProfileReference(row['reference'], 'CATALOG_CUSTOM_MODIFIER'),
    profile: readNpcStructuredCustomProfile(row['profile']),
    bonusContainerBinding: readNpcCustomBonusContainerBinding(row['bonusContainerBinding']),
    reason: text(row['reason'], 'custom.modifier.reason'),
  };
}
function readInventoryRequest(
  value: unknown,
  scope: 'COMPLETE_INVENTORY' | 'RESTORED_GROUP',
): readonly NpcInventoryRequestEntry[] {
  const entries = array(value, '$').map((value, index): NpcInventoryRequestEntry => {
    const path = `$[${String(index)}]`;
    const arbitrary =
      value !== null && typeof value === 'object' && Object.hasOwn(value, 'itemTypeReference');
    const modifier =
      !arbitrary &&
      value !== null &&
      typeof value === 'object' &&
      Object.hasOwn(value, 'customModifier');
    const row = object(
      value,
      [
        'itemInstanceId',
        'itemTypeId',
        'quantity',
        'profile',
        'equipped',
        'equippedSlots',
        'bodyZone',
        'gripMode',
        'currentAmmo',
        'shieldCurrentHP',
        'broken',
        'sealed',
        'linkedSetInstanceId',
        'componentRole',
        'qualityRoll',
        'coatingInstanceIds',
        'issueReason',
        ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'qualityTier')
          ? ['qualityTier']
          : []),
        ...(value !== null &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'clothingProperties')
          ? ['clothingProperties']
          : []),
        ...(arbitrary
          ? ['itemTypeReference', 'bonusContainerBinding', 'customProfileReason']
          : modifier
            ? ['customModifier']
            : []),
      ],
      path,
    );
    const equipped = boolean(row['equipped'], `${path}.equipped`);
    const equippedSlots = uniqueStrings(row['equippedSlots'], `${path}.equippedSlots`);
    if (equipped ? equippedSlots.length === 0 : equippedSlots.length !== 0)
      fail(path, 'equipped state and slot presence disagree');
    const qualityRoll = nullable(row['qualityRoll'], (v) =>
      number(v, 1, true, `${path}.qualityRoll`),
    );
    if (qualityRoll !== null && qualityRoll > 20)
      fail(path, 'quality recommendation face outside R20');
    const common = {
      itemInstanceId: uuid(row['itemInstanceId'], `${path}.itemInstanceId`),
      quantity: number(row['quantity'], 1, true, `${path}.quantity`),
      equipped,
      equippedSlots,
      bodyZone: nullable(row['bodyZone'], (v) => choice(v, ARMOR_BODY_ZONES, `${path}.bodyZone`)),
      gripMode: nullable(row['gripMode'], (v) =>
        choice(v, ['ONE_HAND', 'TWO_HAND'], `${path}.gripMode`),
      ),
      currentAmmo: nullable(row['currentAmmo'], (v) => number(v, 0, true, `${path}.currentAmmo`)),
      shieldCurrentHP: nullable(row['shieldCurrentHP'], (v) =>
        number(v, 0, true, `${path}.shieldCurrentHP`),
      ),
      broken: boolean(row['broken'], `${path}.broken`),
      sealed: nullable(row['sealed'], (v) => boolean(v, `${path}.sealed`)),
      linkedSetInstanceId: nullable(row['linkedSetInstanceId'], (v) =>
        uuid(v, `${path}.linkedSetInstanceId`),
      ),
      componentRole: nullable(row['componentRole'], (v) =>
        choice(v, ['SWORD', 'RAPIER', 'SHIELD'], `${path}.componentRole`),
      ),
      qualityRoll,
      coatingInstanceIds: uniqueStrings(
        row['coatingInstanceIds'],
        `${path}.coatingInstanceIds`,
        uuid,
      ),
      issueReason: text(row['issueReason'], `${path}.issueReason`),
      ...(Object.hasOwn(row, 'qualityTier')
        ? { qualityTier: readNpcItemQualityTier(row['qualityTier']) }
        : {}),
      ...(Object.hasOwn(row, 'clothingProperties')
        ? { clothingProperties: readNpcClothingProperties(row['clothingProperties']) }
        : {}),
    };
    if (
      Object.hasOwn(common, 'clothingProperties') &&
      (arbitrary || row['itemTypeId'] !== 'RES-EQP-001')
    )
      return fail(path, 'clothing properties require the actual clothing catalogue identity');
    if (arbitrary) {
      if (row['itemTypeId'] !== null)
        return fail(path, 'campaign custom item has no catalogue identity');
      return {
        ...common,
        itemTypeId: null,
        itemTypeReference: readNpcCustomProfileReference(
          row['itemTypeReference'],
          'CAMPAIGN_CUSTOM_PROFILE',
        ),
        profile: readNpcStructuredCustomProfile(row['profile']),
        bonusContainerBinding: readNpcCustomBonusContainerBinding(row['bonusContainerBinding']),
        customProfileReason: text(row['customProfileReason'], `${path}.customProfileReason`),
      };
    }
    return {
      ...common,
      itemTypeId: text(row['itemTypeId'], `${path}.itemTypeId`),
      profile: profile(row['profile'], `${path}.profile`),
      ...(modifier ? { customModifier: customModifier(row['customModifier']) } : {}),
    };
  });
  if (new Set(entries.map((entry) => entry.itemInstanceId)).size !== entries.length)
    fail('$', 'duplicate physical item identity');
  const coatingIds = entries.flatMap((entry) => entry.coatingInstanceIds);
  if (new Set(coatingIds).size !== coatingIds.length)
    fail('$', 'coating cannot belong to two items');
  const custom: readonly Readonly<{
    item: NpcInventoryRequestEntry;
    reference: NpcCustomProfileVersionReference;
    profile: NpcStructuredCustomProfile;
    container: NpcCustomBonusContainerBinding;
  }>[] = entries.flatMap(
    (
      entry,
    ): Readonly<{
      item: NpcInventoryRequestEntry;
      reference: NpcCustomProfileVersionReference;
      profile: NpcStructuredCustomProfile;
      container: NpcCustomBonusContainerBinding;
    }>[] =>
      entry.itemTypeId === null
        ? [
            {
              item: entry,
              reference: entry.itemTypeReference,
              profile: entry.profile,
              container: entry.bonusContainerBinding,
            },
          ]
        : entry.customModifier === undefined
          ? []
          : [
              {
                item: entry,
                reference: entry.customModifier.reference,
                profile: entry.customModifier.profile,
                container: entry.customModifier.bonusContainerBinding,
              },
            ],
  );
  const identities = [
    ...entries.map((entry) => entry.itemInstanceId),
    ...custom.flatMap((entry) => [entry.reference.profileId, entry.reference.profileVersionId]),
  ];
  if (new Set(identities).size !== identities.length)
    fail('$', 'custom profile identity reused across physical items');
  for (const entry of custom) {
    if (entry.profile.customBonusOrNull === null) {
      if (entry.container.kind !== 'NOT_APPLICABLE')
        fail('$', 'absent bonus needs NOT_APPLICABLE container');
    } else {
      if (entry.item.quantity !== 1) fail('$', 'a bonus belongs to one physical item, not a stack');
      if (entry.container.kind === 'NOT_APPLICABLE')
        fail('$', 'bonus needs an explicit backpack or outside choice');
      if (entry.container.kind === 'BACKPACK') {
        const backpackItemInstanceId = entry.container.backpackItemInstanceId;
        const backpack = entries.find((item) => item.itemInstanceId === backpackItemInstanceId);
        // A selected historical group may refer to a backpack restored separately.
        // Keep the exact reference in the editor; full inventory validation still
        // requires the real selected backpack before any contribution/publication.
        if (backpack === undefined && scope === 'RESTORED_GROUP') continue;
        if (
          backpack === undefined ||
          backpack.itemTypeId !== 'RES-CON-001' ||
          backpack.itemInstanceId === entry.item.itemInstanceId
        )
          fail('$', 'bonus container must be a different real selected backpack of this NPC');
      }
    }
  }
  return freeze(entries);
}

/** Shape, local consistency and detached bytes only; owning attempt and source catalog are separate guards. */
export function readNpcInventoryRequest(value: unknown): readonly NpcInventoryRequestEntry[] {
  return readInventoryRequest(value, 'COMPLETE_INVENTORY');
}
/** Closed historical row grammar, not a valid complete inventory or authorization to restore it. */
export function readNpcInventoryRestorationRows(
  value: unknown,
): readonly NpcInventoryRequestEntry[] {
  return readInventoryRequest(value, 'RESTORED_GROUP');
}

/** CORE-187–190: source protected fields are rebuilt, not accepted as staged client truth. */
export function resolveNpcWeaponProfiles(
  catalog: WeaponProfileCatalog,
  itemTypeId: string,
  rawVariants: readonly StartingWeaponVariant[],
  rawRequest: Exclude<NpcItemProfileRequest, { kind: 'STRUCTURED_CUSTOM' }>,
  priorProfiles: readonly MasterWeaponBaseProfile[] = [],
): readonly StagedWeaponProfile[] {
  const requestedVariants = array(rawVariants, 'weapon.variants').map((value) =>
    choice(value, STARTING_WEAPON_VARIANTS, 'weapon.variant'),
  );
  const request = profile(rawRequest, 'weapon.profile');
  if (request.kind === 'STRUCTURED_CUSTOM') fail('weapon.profile', 'expected weapon profile input');
  // CORE-047 has no shield attack CVD. Its defensive profile is retained by the catalog.
  if (itemTypeId === 'ITM-WPN-026' && requestedVariants.length === 0 && request.kind === 'CATALOG')
    return Object.freeze([]);
  if (
    requestedVariants.length === 0 ||
    new Set(requestedVariants).size !== requestedVariants.length
  )
    fail('weapon', 'expected exact nonempty distinct physical attack variants');
  if (
    request.kind === 'MASTER_WEAPON' &&
    (request.inputs.length !== requestedVariants.length ||
      request.inputs.some((entry) => !requestedVariants.includes(entry.weaponVariantId)))
  )
    fail('weapon', 'profile inputs differ from the host-bound physical attack variants');
  return freeze(
    requestedVariants.map((weaponVariant) => {
      const selection = { weaponTypeId: itemTypeId, weaponVariant };
      if (request.kind === 'CATALOG')
        return stageValidatedWeaponProfile(canonicalFixedWeaponProfile(catalog, selection));
      const input = request.inputs.find((entry) => entry.weaponVariantId === weaponVariant);
      if (input === undefined) return fail('weapon', 'missing profile variant');
      const previous = priorProfiles.filter(
        (entry) => entry.weaponTypeId === itemTypeId && entry.weaponVariantId === weaponVariant,
      );
      if (previous.length > 1) return fail('weapon', 'ambiguous previous physical profile');
      return deriveMasterWeaponProfile(catalog, selection, input, previous[0] ?? null);
    }),
  );
}

export interface NpcInventoryDefinition {
  readonly itemTypeId: string;
  readonly name: string;
  readonly inventoryAllowed: boolean | 'UNKNOWN';
  readonly equippable: boolean;
  readonly composite: boolean;
  readonly components: readonly Readonly<{
    role: 'SWORD' | 'RAPIER' | 'SHIELD';
    attackVariants: readonly StartingWeaponVariant[];
    shieldMaxHPOrNull: number | null;
  }>[];
  readonly category: string;
  readonly completeness: 'FULL' | 'PARTIAL';
  readonly armorOrNull: Readonly<{
    coverageModel: 'ZONE_ELEMENT' | 'FULL_SUIT';
    allowsLayers: boolean;
    sealedApplicable: boolean;
  }> | null;
  /** Source-only data; validators admit no additional user-supplied mechanical properties. */
  readonly catalogueSource: Readonly<Record<string, string | number | boolean>>;
  readonly profileSource: Readonly<Record<string, string | number | boolean>> | null;
}
export interface NpcInventoryCatalog {
  readonly definitions: readonly NpcInventoryDefinition[];
  readonly weapons: WeaponProfileCatalog;
}
export interface NpcInventoryMetadataChoices {
  readonly qualityTiers: readonly Readonly<{ value: NpcItemQualityTier; label: string }>[];
  readonly clothingRegions: readonly ArmorBodyZone[];
  readonly clothingHermetic: readonly (boolean | 'UNKNOWN')[];
  readonly clothingFlammability: readonly NpcClothingProperties['flammability'][];
}
const metadataCatalogs = new WeakMap<NpcInventoryCatalog, NpcInventoryMetadataChoices>();
export function npcInventoryMetadataChoices(
  catalog: NpcInventoryCatalog,
): NpcInventoryMetadataChoices | null {
  return metadataCatalogs.get(catalog) ?? null;
}
function readMetadataSource(
  catalog: NpcInventoryCatalog,
  value: unknown,
): NpcInventoryMetadataChoices {
  const source = object(value, ['instanceModel', 'dictionaries'], 'metadata.source');
  const seals = [
    {
      'Data type': 'ENUM',
      Field: 'qualityTier',
      Purpose: 'Качество',
      Required: false,
      Scope: 'ITEM_INSTANCE',
      'Validation / constraint': 'По шкале PDF; финализирует мастер',
    },
    {
      'Data type': 'ARRAY<ENUM>',
      Default: '[]',
      Field: 'equippedSlots',
      Purpose: 'Занятые слоты',
      Required: false,
      Scope: 'EQUIPMENT',
      'Validation / constraint': 'Руки или зоны тела',
    },
    {
      'Data type': 'ENUM',
      Field: 'bodyZone',
      Purpose: 'Зона брони',
      Required: false,
      Scope: 'EQUIPMENT',
      'Validation / constraint': 'HEAD|TORSO|ARM_L|ARM_R|LEG_L|LEG_R',
    },
    {
      'Data type': 'BOOLEAN',
      Field: 'sealed',
      Purpose: 'Герметичность',
      Required: false,
      Scope: 'ITEM_STATE',
      'Validation / constraint': 'Только Нэйт; true при выдаче',
    },
  ];
  const rows = array(source['instanceModel'], 'metadata.instanceModel');
  for (const seal of seals) {
    const found = rows.filter(
      (row) =>
        row !== null && typeof row === 'object' && 'Field' in row && row.Field === seal.Field,
    );
    if (found.length !== 1) fail('metadata.source', 'missing exact instance field');
    const actual = object(found[0], Object.keys(seal), 'metadata.instanceField');
    if (Object.entries(seal).some(([key, value]) => actual[key] !== value))
      fail('metadata.source', 'changed instance field contract');
  }
  const definitions = [
    ['1–4', 'Отсутствует/непригоден', 'MISSING_OR_UNFIT'],
    ['5–9', 'Плохое', 'POOR'],
    ['10–14', 'Обычное', 'ORDINARY'],
    ['15–18', 'Хорошее', 'GOOD'],
    ['19', 'Исключительное', 'EXCEPTIONAL'],
    ['20', 'Редкое', 'RARE'],
  ] as const;
  const quality = array(source['dictionaries'], 'metadata.dictionaries').filter(
    (row) =>
      row !== null &&
      typeof row === 'object' &&
      'Dictionary' in row &&
      row.Dictionary === 'QUALITY',
  );
  if (quality.length !== definitions.length) fail('metadata.source', 'changed QUALITY dictionary');
  const qualityTiers = definitions.map(([code, label, tier]) => {
    const found = quality.filter(
      (row) => object(row, ['Code', 'Dictionary', 'Meaning'], 'metadata.quality')['Code'] === code,
    );
    if (
      found.length !== 1 ||
      object(found[0], ['Code', 'Dictionary', 'Meaning'], 'metadata.quality')['Meaning'] !== label
    )
      fail('metadata.source', 'changed QUALITY tier');
    return { value: tier, label };
  });
  const clothing = catalog.definitions.find((row) => row.itemTypeId === 'RES-EQP-001');
  if (
    clothing === undefined ||
    clothing.inventoryAllowed !== true ||
    !clothing.equippable ||
    clothing.category !== 'Экипировка' ||
    clothing.armorOrNull !== null ||
    clothing.composite ||
    clothing.catalogueSource['Rule ID'] !== 'CORE-112; MON-072' ||
    clothing.catalogueSource['Примечание'] !==
      'Общий тип; зоны, герметичность и горючесть задаются экземпляром/мастером.'
  )
    fail('metadata.source', 'changed explicit clothing source');
  return freeze<NpcInventoryMetadataChoices>({
    qualityTiers,
    clothingRegions: ARMOR_BODY_ZONES,
    clothingHermetic: [true, false, 'UNKNOWN'],
    clothingFlammability: ['COMBUSTIBLE', 'NONCOMBUSTIBLE', 'UNKNOWN'],
  });
}
export function validateNpcInventoryMetadata(
  catalog: NpcInventoryCatalog,
  request: NpcInventoryRequestEntry,
): void {
  if (
    (Object.hasOwn(request, 'qualityTier') || Object.hasOwn(request, 'clothingProperties')) &&
    !metadataCatalogs.has(catalog)
  )
    fail('metadata', 'source-bound quality/clothing capability is unavailable');
  if (request.itemTypeId !== 'RES-EQP-001') return;
  const properties = request.clothingProperties;
  if (request.equipped && (properties === undefined || properties.coveredRegionIds.length === 0))
    fail('clothing', 'equipped clothing requires explicit physical coverage/properties');
  // Items 07 permits body regions as equipment placement. Clothing coverage is
  // declarative metadata, not an armor layer or hand occupancy; the source does
  // not impose exclusivity between clothes or between clothes and armor.
  const expected = request.equipped ? (properties?.coveredRegionIds ?? []) : [];
  if (
    request.equippedSlots.length !== expected.length ||
    expected.some((zone) => !request.equippedSlots.includes(zone))
  )
    fail('clothing', 'slots differ from exact declared coverage');
  if (request.bodyZone !== null || request.sealed !== null)
    fail('clothing', 'clothing metadata cannot claim armor zone or Nate sealed protection');
}
/** Complete source description of a carried catalogue item; PARTIAL does not invent later use mechanics. */
export interface NpcCatalogueItemProfile {
  readonly itemTypeId: string;
  readonly name: string;
  readonly category: string;
  readonly completeness: 'FULL' | 'PARTIAL';
  readonly catalogueSource: NpcInventoryDefinition['catalogueSource'];
  readonly mechanicsSourceOrNull: NpcInventoryDefinition['profileSource'];
}
/** CORE-047's shield is a physical component; it has no supplied attack variant. */
export interface NpcNonattackingShieldProfile {
  readonly itemTypeId: 'ITM-WPN-026';
  readonly sourceRuleId: 'CORE-047';
  readonly componentRole: 'SHIELD';
  readonly shieldMaxHP: number;
  readonly statRequirements: StagedWeaponProfile['statRequirements'];
  readonly sourceProperties: StagedWeaponProfile['properties'];
}
export function resolveNpcNonattackingShieldProfile(
  catalog: NpcInventoryCatalog,
  itemTypeId: string,
): NpcNonattackingShieldProfile {
  const definition = catalog.definitions.find((row) => row.itemTypeId === itemTypeId);
  const shield = definition?.components.find((part) => part.role === 'SHIELD');
  if (
    itemTypeId !== 'ITM-WPN-026' ||
    definition?.catalogueSource['Rule ID'] !== 'CORE-047' ||
    shield === undefined ||
    shield.attackVariants.length !== 0 ||
    shield.shieldMaxHPOrNull === null
  )
    fail('shield.profile', 'expected the source nonattacking shield component');
  const source = catalog.weapons.entries.find(
    (entry) => entry.weaponTypeId === itemTypeId && entry.weaponVariant === 'SWORD',
  );
  if (source === undefined) fail('shield.profile', 'missing protected complete-set properties');
  return freeze({
    itemTypeId: 'ITM-WPN-026',
    sourceRuleId: 'CORE-047',
    componentRole: 'SHIELD',
    shieldMaxHP: shield.shieldMaxHPOrNull,
    statRequirements: source.template.statRequirements,
    sourceProperties: source.template.properties,
  });
}
export function resolveNpcCatalogueItemProfile(
  catalog: NpcInventoryCatalog,
  itemTypeId: string,
): NpcCatalogueItemProfile {
  const definition = catalog.definitions.find((item) => item.itemTypeId === itemTypeId);
  if (
    definition === undefined ||
    definition.inventoryAllowed !== true ||
    definition.category === 'Оружие' ||
    definition.category === 'Броня'
  )
    return fail('catalogue profile', 'carried nonweapon source item required');
  return freeze({
    itemTypeId: definition.itemTypeId,
    name: definition.name,
    category: definition.category,
    completeness: definition.completeness,
    catalogueSource: definition.catalogueSource,
    mechanicsSourceOrNull: definition.profileSource,
  });
}
function sourceRow(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): Record<string, string | number | boolean> {
  if (value === null || typeof value !== 'object') fail(path, 'expected source row');
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string' || !allowed.includes(key)) ||
    required.some((key) => !keys.includes(key))
  )
    fail(path, 'unknown or missing source field');
  const row = object(value, keys as string[], path);
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(row)) {
    if (
      (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') ||
      (typeof value === 'number' && !Number.isFinite(value))
    )
      fail(`${path}.${key}`, 'expected source scalar');
    result[key] = value;
  }
  return result;
}

/** Item Registry 01/03/04. PARTIAL descriptive resources remain explicitly partial. */
export function createNpcInventoryCatalog(
  catalogue: unknown,
  armorProfiles: unknown,
  pharmaceuticals: unknown,
  weapons: WeaponProfileCatalog,
  metadataSource?: Readonly<{ instanceModel: unknown; dictionaries: unknown }>,
): NpcInventoryCatalog {
  const catalogueFields = [
    'Единица',
    'Источник',
    'Источник готовых параметров экземпляра',
    'Категория',
    'Класс каталога',
    'Можно в инвентарь',
    'Название',
    'Подкатегория',
    'Политика заявки игрока',
    'Полнота механики',
    'Примечание',
    'Составной',
    'Физически взаимозаменяем',
    'Экипируется',
    'Formula ID',
    'Generation enabled',
    'ID уникален',
    'ItemTypeID',
    'Master profile override allowed',
    'Rule ID',
    'UI-группировка по stackKey',
  ];
  const armorFields = [
    'Акробатика',
    'Бег',
    'Броня: исходное выражение',
    'Герметичен',
    'Допускает слои',
    'Защиты/иммунитеты',
    'Зоны',
    'Модель покрытия',
    'Название',
    'Твёрдая шея',
    'Требование S',
    'Уклонение',
    'Условие/ограничение',
    'Физическая броня',
    'ItemTypeID',
    'M',
    'PDF, с.',
    'Rule ID',
  ];
  const pharmaFields = [
    'Длительность',
    'Макс. доз/24ч',
    'Название',
    'Ограничение расы',
    'Политика отказа',
    'Примечание',
    'Стоимость в бою',
    'Эффект',
    'ItemTypeID',
    'Rule ID',
  ];
  const indexedProfiles = (
    value: unknown,
    fields: readonly string[],
    required: readonly string[],
    path: string,
  ) => {
    const result = new Map<string, Record<string, string | number | boolean>>();
    for (const entry of array(value, path)) {
      const row = sourceRow(entry, fields, required, path);
      const id = text(row['ItemTypeID'], `${path}.ItemTypeID`);
      if (result.has(id)) fail(path, 'duplicate profile identity');
      result.set(id, row);
    }
    return result;
  };
  const armor = indexedProfiles(
    armorProfiles,
    armorFields,
    [
      'ItemTypeID',
      'Название',
      'Модель покрытия',
      'Допускает слои',
      'Герметичен',
      'Rule ID',
      'Броня: исходное выражение',
      'Физическая броня',
      'Твёрдая шея',
      'Требование S',
      'Зоны',
      'PDF, с.',
    ],
    'armor',
  );
  const pharma = indexedProfiles(
    pharmaceuticals,
    pharmaFields,
    [
      'ItemTypeID',
      'Название',
      'Эффект',
      'Длительность',
      'Ограничение расы',
      'Rule ID',
      'Макс. доз/24ч',
      'Политика отказа',
      'Стоимость в бою',
    ],
    'pharmaceuticals',
  );
  // Exact per-profile optional-column presence is part of the delivered mechanical schema.
  const armorExtras: Readonly<Record<string, readonly string[]>> = {
    'ITM-ARM-001': ['Защиты/иммунитеты'],
    'ITM-ARM-002': ['M', 'Акробатика', 'Бег', 'Защиты/иммунитеты'],
    'ITM-ARM-003': ['M', 'Акробатика', 'Бег', 'Защиты/иммунитеты'],
    'ITM-ARM-004': ['M', 'Акробатика', 'Бег', 'Защиты/иммунитеты'],
    'ITM-ARM-005': ['Защиты/иммунитеты', 'Условие/ограничение'],
    'ITM-ARM-006': ['M', 'Акробатика', 'Бег', 'Защиты/иммунитеты', 'Условие/ограничение'],
    'ITM-ARM-007': ['Условие/ограничение'],
    'ITM-ARM-008': [
      'M',
      'Акробатика',
      'Бег',
      'Защиты/иммунитеты',
      'Уклонение',
      'Условие/ограничение',
    ],
  };
  const optionalArmorFields = [
    'M',
    'Акробатика',
    'Бег',
    'Защиты/иммунитеты',
    'Уклонение',
    'Условие/ограничение',
  ];
  for (const [id, row] of armor) {
    const expected = armorExtras[id];
    if (
      expected === undefined ||
      optionalArmorFields.some((field) => Object.hasOwn(row, field) !== expected.includes(field))
    )
      fail(id, 'armor mechanical column presence differs');
    for (const key of ['Герметичен', 'Допускает слои', 'Твёрдая шея', 'Физическая броня'])
      boolean(row[key], id + '.' + key);
    for (const key of ['Броня: исходное выражение', 'Требование S', ...expected])
      text(row[key], id + '.' + key);
  }
  for (const [id, row] of pharma) {
    const noteExpected = !['ITM-PHA-005', 'ITM-PHA-007', 'ITM-PHA-014'].includes(id);
    if (Object.hasOwn(row, 'Примечание') !== noteExpected)
      fail(id, 'pharmaceutical mechanical note presence differs');
  }
  const definitions = array(catalogue, 'catalogue').map((value): NpcInventoryDefinition => {
    const row = sourceRow(
      value,
      catalogueFields,
      [
        'ItemTypeID',
        'Название',
        'Категория',
        'Можно в инвентарь',
        'Экипируется',
        'Составной',
        'Полнота механики',
      ],
      'catalogue',
    );
    const itemTypeId = text(row['ItemTypeID'], 'catalogue.ItemTypeID');
    const category = choice(
      row['Категория'],
      [
        'Оружие',
        'Броня',
        'Фармацевтика',
        'Боеприпасы',
        'Валюта/ресурс',
        'Инструмент',
        'Ключ',
        'Контейнер',
        'Ограничивающий предмет',
        'Расходник',
        'Экипировка',
      ],
      'catalogue.category',
    );
    const inventoryAllowed =
      row['Можно в инвентарь'] === 'UNKNOWN'
        ? 'UNKNOWN'
        : boolean(row['Можно в инвентарь'], 'catalogue.inventoryAllowed');
    const name = text(row['Название'], 'catalogue.name');
    const profileSource =
      category === 'Броня'
        ? armor.get(itemTypeId)
        : category === 'Фармацевтика'
          ? pharma.get(itemTypeId)
          : null;
    if (
      profileSource === undefined ||
      (profileSource !== null && profileSource['Название'] !== name)
    )
      fail(itemTypeId, 'missing or mismatched source profile');
    if (
      category === 'Оружие' &&
      !weapons.entries.some((entry) => entry.weaponTypeId === itemTypeId)
    )
      fail(itemTypeId, 'missing full weapon catalog');
    const composite = boolean(row['Составной'], 'catalogue.composite');
    const components: NpcInventoryDefinition['components'][number][] = [];
    if (composite) {
      const cornadora =
        itemTypeId === 'ITM-WPN-026' && name === 'Корнадора' && row['Rule ID'] === 'CORE-047';
      const blarade =
        itemTypeId === 'ITM-WPN-027' && name === 'Бларадэ' && row['Rule ID'] === 'CORE-048';
      if (!cornadora && !blarade) fail(itemTypeId, 'unknown composite component source');
      const entries = weapons.entries.filter((entry) => entry.weaponTypeId === itemTypeId);
      const expectedVariants = cornadora ? ['SWORD'] : ['SHIELD', 'RAPIER'];
      if (
        entries.length !== expectedVariants.length ||
        entries.some((entry) => !expectedVariants.includes(entry.weaponVariant))
      )
        fail(itemTypeId, 'composite attack variants differ from source');
      // CORE-177 describes the complete own pair as two hands. Component holding
      // slots may split that pair only while this protected whole-set fact holds.
      if (entries.some((entry) => entry.template.properties['Руки'] !== '2'))
        fail(itemTypeId, 'composite complete-set hand count differs from source');
      const hp = entries.map((entry) => entry.template.properties['Shield max HP']);
      if (new Set(hp).size !== 1 || typeof hp[0] !== 'string' || !/^[1-9]\d*$/u.test(hp[0]))
        fail(itemTypeId, 'missing protected shield profile');
      const maximum = number(Number(hp[0]), 1, true, itemTypeId + '.shieldMaxHP');
      components.push({
        role: cornadora ? 'SWORD' : 'RAPIER',
        attackVariants: [cornadora ? 'SWORD' : 'RAPIER'],
        shieldMaxHPOrNull: null,
      });
      components.push({
        role: 'SHIELD',
        attackVariants: cornadora ? [] : ['SHIELD'],
        shieldMaxHPOrNull: maximum,
      });
    }
    return {
      itemTypeId,
      name,
      inventoryAllowed,
      category,
      equippable: boolean(row['Экипируется'], 'catalogue.equippable'),
      composite,
      components,
      completeness: choice(row['Полнота механики'], ['FULL', 'PARTIAL'], 'catalogue.completeness'),
      catalogueSource: row,
      profileSource,
      armorOrNull:
        category !== 'Броня' || profileSource === null
          ? null
          : {
              coverageModel: choice(
                profileSource['Модель покрытия'],
                ['ZONE_ELEMENT', 'FULL_SUIT'],
                'armor.coverageModel',
              ),
              allowsLayers: boolean(profileSource['Допускает слои'], 'armor.allowsLayers'),
              sealedApplicable: boolean(profileSource['Герметичен'], 'armor.sealedApplicable'),
            },
    };
  });
  if (
    definitions.length === 0 ||
    new Set(definitions.map((entry) => entry.itemTypeId)).size !== definitions.length
  )
    fail('catalogue', 'empty or duplicate identities');
  for (const [category, profiles] of [
    ['Броня', armor],
    ['Фармацевтика', pharma],
  ] as const) {
    if (profiles.size !== definitions.filter((entry) => entry.category === category).length)
      fail(category, 'orphan or missing profile');
  }
  for (const weapon of weapons.entries) {
    if (
      !definitions.some(
        (entry) => entry.itemTypeId === weapon.weaponTypeId && entry.category === 'Оружие',
      )
    )
      fail('catalogue', 'orphan weapon profile');
  }
  const catalog = freeze({ definitions, weapons });
  if (metadataSource !== undefined)
    metadataCatalogs.set(catalog, readMetadataSource(catalog, metadataSource));
  return catalog;
}

/** Item-instance bounds, not armor aggregation, hand availability or ownership authorization. */
export function validateNpcCatalogueItemState(
  definition: NpcInventoryDefinition,
  input: NpcInventoryRequestEntry,
  weaponProfiles: readonly StagedWeaponProfile[],
  inventoryContext: readonly NpcInventoryRequestEntry[] = [input],
): void {
  const entry = readNpcInventoryRequest([
    input,
    ...inventoryContext.filter((item) => item.itemInstanceId !== input.itemInstanceId),
  ])[0]!;
  if (entry.itemTypeId !== definition.itemTypeId || definition.inventoryAllowed !== true)
    fail('itemTypeId', 'unknown or unavailable inventory type');
  if (entry.profile.kind === 'STRUCTURED_CUSTOM')
    fail('profile', 'catalog identity cannot become a custom type');
  if (entry.equipped && !definition.equippable) fail('equipped', 'source item is not equippable');
  const component = definition.components.find((part) => part.role === entry.componentRole);
  if (definition.composite && component === undefined)
    fail('componentRole', 'role is not a component of this source item');
  if (component !== undefined) {
    if (
      weaponProfiles.length !== component.attackVariants.length ||
      weaponProfiles.some((profile) => !component.attackVariants.includes(profile.weaponVariantId))
    )
      fail('profile', 'attack profile differs from physical component');
    if (component.attackVariants.length === 0 && entry.profile.kind !== 'CATALOG')
      fail('profile', 'nonattacking shield has no attack override');
  } else if (
    definition.category === 'Оружие'
      ? weaponProfiles.length !== 1
      : weaponProfiles.length !== 0 || entry.profile.kind === 'MASTER_WEAPON'
  )
    fail('profile', 'weapon profile presence differs from category');
  if (weaponProfiles.some((profile) => profile.weaponTypeId !== entry.itemTypeId))
    fail('profile', 'foreign weapon profile');
  if (
    definition.armorOrNull?.coverageModel === 'ZONE_ELEMENT'
      ? entry.bodyZone === null
      : entry.bodyZone !== null
  )
    fail('bodyZone', 'zone presence differs from armor coverage');
  if (
    definition.armorOrNull?.sealedApplicable === true
      ? entry.sealed === null
      : entry.sealed !== null
  )
    fail('sealed', 'sealed state differs from source applicability');
  if (
    definition.composite
      ? entry.linkedSetInstanceId === null || entry.componentRole === null
      : entry.linkedSetInstanceId !== null || entry.componentRole !== null
  )
    fail('componentRole', 'composite component binding differs from source');
  const hasGripVariant = weaponProfiles.some(
    (profile) => profile.weaponVariantId === 'ONE_HAND' || profile.weaponVariantId === 'TWO_HAND',
  );
  if (
    hasGripVariant
      ? entry.gripMode === null ||
        weaponProfiles.some((profile) => profile.weaponVariantId !== entry.gripMode)
      : entry.gripMode !== null
  )
    fail('gripMode', 'grip differs from fixed physical profile');
  const cap = (key: string): number | null => {
    const values = weaponProfiles.flatMap((profile) =>
      Object.hasOwn(profile.properties, key) ? [profile.properties[key]] : [],
    );
    if (values.length === 0) return null;
    const parsed = values.map((value) =>
      typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value,
    );
    if (
      parsed.some(
        (value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0,
      ) ||
      new Set(parsed).size !== 1
    )
      fail(key, 'unrecognized or conflicting source capacity');
    return parsed[0] as number;
  };
  const ammoCapacity = cap('Ёмкость');
  if (entry.currentAmmo !== null && (ammoCapacity === null || entry.currentAmmo > ammoCapacity))
    fail('currentAmmo', 'ammo outside protected source magazine capacity');
  const shieldMaxHP = component === undefined ? cap('Shield max HP') : component.shieldMaxHPOrNull;
  if (
    entry.shieldCurrentHP !== null &&
    (shieldMaxHP === null || entry.shieldCurrentHP > shieldMaxHP)
  )
    fail('shieldCurrentHP', 'HP outside protected source shield capacity');
}

/** CORE-049..056: one symbolic roll per layer, including the shared roll in 2×R20+5. */
export interface NpcArmorProfile {
  readonly itemTypeId: string;
  readonly sourceRuleId: string;
  readonly coverageModel: 'ZONE_ELEMENT' | 'FULL_SUIT';
  readonly physicalArmorOrNull: Readonly<{
    dieSides: 6 | 12 | 20;
    multiplier: 1 | 2;
    constant: 0 | 5;
  }> | null;
  readonly requiredStrength: number;
  readonly runningModifier: number;
  readonly acrobaticsModifier: number;
  readonly dodgeModifier: number;
  readonly mobilityModifierOrNull: Readonly<
    | { kind: 'PER_ITEM'; amount: number }
    | { kind: 'TYPE_THRESHOLD'; minimumPieces: number; amount: number }
  > | null;
  readonly protectionSourceOrNull: string | null;
  readonly conditionSourceOrNull: string | null;
  readonly hardNeck: boolean;
  readonly sealedApplicable: boolean;
  readonly allowsLayers: boolean;
}

/** Reads source expressions, never a user-supplied resolved armor value. */
export function resolveNpcArmorProfile(
  catalog: NpcInventoryCatalog,
  itemTypeId: string,
): NpcArmorProfile {
  const definition = catalog.definitions.find((row) => row.itemTypeId === itemTypeId);
  if (
    definition === undefined ||
    definition.category !== 'Броня' ||
    definition.profileSource === null ||
    definition.armorOrNull === null
  )
    fail('armor.profile', 'expected a complete armor catalogue definition');
  const row = definition.profileSource;
  const sourceRuleId = text(row['Rule ID'], 'armor.rule');
  const sourceIds = [
    'CORE-049',
    'CORE-050',
    'CORE-051',
    'CORE-052',
    'CORE-053',
    'CORE-054',
    'CORE-055',
    'CORE-056',
  ];
  const index = Number(itemTypeId.slice(-3)) - 1;
  if (!/^ITM-ARM-00[1-8]$/u.test(itemTypeId) || sourceIds[index] !== sourceRuleId)
    fail('armor.profile', 'unknown armor rule binding');
  const physical = boolean(row['Физическая броня'], 'armor.physical');
  const expression = text(row['Броня: исходное выражение'], 'armor.expression');
  const physicalArmorOrNull: NpcArmorProfile['physicalArmorOrNull'] =
    expression === 'R6'
      ? { dieSides: 6, multiplier: 1, constant: 0 }
      : expression === 'R12'
        ? { dieSides: 12, multiplier: 1, constant: 0 }
        : expression === 'R20'
          ? { dieSides: 20, multiplier: 1, constant: 0 }
          : expression === '2×R20+5 (тот же бросок)'
            ? { dieSides: 20, multiplier: 2, constant: 5 }
            : expression === '—' && !physical
              ? null
              : fail('armor.expression', 'unrecognized physical armor definition');
  if (physical !== (physicalArmorOrNull !== null))
    fail('armor.physical', 'physical presence and expression differ');
  const { coverageModel, sealedApplicable, allowsLayers } = definition.armorOrNull;
  const strengthText = text(row['Требование S'], 'armor.requiredStrength');
  const match = (
    coverageModel === 'ZONE_ELEMENT' ? /^([1-9]\d*) за элемент$/u : /^([1-9]\d*)$/u
  ).exec(strengthText);
  if (match === null) fail('armor.requiredStrength', 'unrecognized strength expression');
  const requiredStrength = number(Number(match[1]), 1, true, 'armor.requiredStrength');
  const penalty = (key: string): number => {
    if (!Object.hasOwn(row, key)) return 0;
    const value = text(row[key], `armor.${key}`);
    const parsed = (
      coverageModel === 'ZONE_ELEMENT' ? /^−([1-9]\d*) за элемент$/u : /^−([1-9]\d*)$/u
    ).exec(value);
    if (parsed === null) fail(`armor.${key}`, 'unrecognized penalty expression');
    return -number(Number(parsed[1]), 1, true, `armor.${key}`);
  };
  let mobilityModifierOrNull: NpcArmorProfile['mobilityModifierOrNull'] = null;
  if (Object.hasOwn(row, 'M')) {
    const value = text(row['M'], 'armor.M');
    const parsed = (
      coverageModel === 'ZONE_ELEMENT' ? /^−([1-9]\d*) при >([1-9]\d*)$/u : /^−([1-9]\d*)$/u
    ).exec(value);
    if (parsed === null) fail('armor.M', 'unrecognized threshold expression');
    const threshold =
      coverageModel === 'FULL_SUIT'
        ? 1
        : number(Number(parsed[2]), 1, true, 'armor.M.threshold') + 1;
    const amount = -number(Number(parsed[1]), 1, true, 'armor.M.amount');
    mobilityModifierOrNull =
      coverageModel === 'FULL_SUIT'
        ? { kind: 'PER_ITEM', amount }
        : {
            kind: 'TYPE_THRESHOLD',
            minimumPieces: number(threshold, 1, true, 'armor.M.threshold'),
            amount,
          };
  }
  return freeze({
    itemTypeId,
    sourceRuleId,
    coverageModel,
    physicalArmorOrNull,
    requiredStrength,
    runningModifier: penalty('Бег'),
    acrobaticsModifier: penalty('Акробатика'),
    dodgeModifier: penalty('Уклонение'),
    mobilityModifierOrNull,
    protectionSourceOrNull: Object.hasOwn(row, 'Защиты/иммунитеты')
      ? text(row['Защиты/иммунитеты'], 'armor.protection')
      : null,
    conditionSourceOrNull: Object.hasOwn(row, 'Условие/ограничение')
      ? text(row['Условие/ограничение'], 'armor.condition')
      : null,
    hardNeck: boolean(row['Твёрдая шея'], 'armor.hardNeck'),
    sealedApplicable,
    allowsLayers,
  });
}

export interface NpcEquippedArmorPiece {
  readonly itemInstanceId: string;
  readonly itemTypeId: string;
  readonly bodyZoneOrNull: ArmorBodyZone | null;
  readonly sealedOrNull: boolean | null;
}
export interface NpcArmorContribution {
  readonly pieces: readonly Readonly<{ piece: NpcEquippedArmorPiece; profile: NpcArmorProfile }>[];
  readonly layersByZone: Readonly<
    Record<
      ArmorBodyZone,
      readonly Readonly<{
        itemInstanceId: string;
        definition: NonNullable<NpcArmorProfile['physicalArmorOrNull']>;
      }>[]
    >
  >;
  readonly requiredStrength: number;
  readonly mobilityModifier: number;
  readonly runningModifier: number;
  readonly acrobaticsModifier: number;
  readonly dodgeModifier: number;
  /** Exact current selection that requires host-confirmed physical compatibility. No boolean grants it. */
  readonly compatibilityRequiredItemIds: readonly string[];
}

/** CORE-057/151 + Q-CORE-013/015: no PC starting-piece limit, no roll and no automatic equipment selection. */
export function deriveNpcArmorContribution(
  catalog: NpcInventoryCatalog,
  value: unknown,
): NpcArmorContribution {
  const pieces = array(value, 'armor.pieces').map(
    (value): NpcArmorContribution['pieces'][number] => {
      const row = object(
        value,
        ['itemInstanceId', 'itemTypeId', 'bodyZoneOrNull', 'sealedOrNull'],
        'armor.piece',
      );
      const piece: NpcEquippedArmorPiece = {
        itemInstanceId: uuid(row['itemInstanceId'], 'armor.itemInstanceId'),
        itemTypeId: text(row['itemTypeId'], 'armor.itemTypeId'),
        bodyZoneOrNull: nullable(row['bodyZoneOrNull'], (v) =>
          choice(v, ARMOR_BODY_ZONES, 'armor.bodyZone'),
        ),
        sealedOrNull: nullable(row['sealedOrNull'], (v) => boolean(v, 'armor.sealed')),
      };
      const profile = resolveNpcArmorProfile(catalog, piece.itemTypeId);
      if ((profile.coverageModel === 'ZONE_ELEMENT') !== (piece.bodyZoneOrNull !== null))
        fail('armor.bodyZone', 'zone presence differs from source coverage');
      if (profile.sealedApplicable !== (piece.sealedOrNull !== null))
        fail('armor.sealed', 'sealed state presence differs from source applicability');
      return { piece, profile };
    },
  );
  if (new Set(pieces.map(({ piece }) => piece.itemInstanceId)).size !== pieces.length)
    fail('armor.pieces', 'physical item identity is repeated');
  const layersByZone: Record<
    ArmorBodyZone,
    { itemInstanceId: string; definition: NonNullable<NpcArmorProfile['physicalArmorOrNull']> }[]
  > = { HEAD: [], TORSO: [], ARM_L: [], ARM_R: [], LEG_L: [], LEG_R: [] };
  const perType = new Map<string, { count: number; profile: NpcArmorProfile }>();
  let requiredStrength = 0,
    runningModifier = 0,
    acrobaticsModifier = 0,
    dodgeModifier = 0;
  for (const { piece, profile } of pieces) {
    const zones = piece.bodyZoneOrNull === null ? ARMOR_BODY_ZONES : [piece.bodyZoneOrNull];
    if (profile.physicalArmorOrNull !== null)
      for (const zone of zones)
        layersByZone[zone].push({
          itemInstanceId: piece.itemInstanceId,
          definition: profile.physicalArmorOrNull,
        });
    requiredStrength += profile.requiredStrength;
    runningModifier += profile.runningModifier;
    acrobaticsModifier += profile.acrobaticsModifier;
    dodgeModifier += profile.dodgeModifier;
    const before = perType.get(piece.itemTypeId);
    perType.set(piece.itemTypeId, { count: (before?.count ?? 0) + 1, profile });
  }
  let mobilityModifier = 0;
  for (const { count, profile } of perType.values()) {
    const modifier = profile.mobilityModifierOrNull;
    if (modifier?.kind === 'PER_ITEM') mobilityModifier += modifier.amount * count;
    else if (modifier?.kind === 'TYPE_THRESHOLD' && count >= modifier.minimumPieces)
      mobilityModifier += modifier.amount;
  }
  for (const total of [
    requiredStrength,
    runningModifier,
    acrobaticsModifier,
    dodgeModifier,
    mobilityModifier,
  ])
    if (!Number.isSafeInteger(total))
      fail('armor.total', 'aggregate exceeds exact integer representation');
  if (
    pieces.length > 1 &&
    pieces.some(({ profile }) => profile.coverageModel === 'FULL_SUIT' && !profile.allowsLayers)
  )
    fail('armor.layers', 'source full suit does not allow layers');
  // Layerable whole suits require the GM's physical compatibility decision.
  // This is a requirement output for the owning host boundary, not a fabricated confirmation.
  const compatibilityRequiredItemIds =
    pieces.length > 1 && pieces.some(({ profile }) => profile.coverageModel === 'FULL_SUIT')
      ? pieces.map(({ piece }) => piece.itemInstanceId)
      : [];
  return freeze({
    pieces,
    layersByZone,
    requiredStrength,
    mobilityModifier,
    runningModifier,
    acrobaticsModifier,
    dodgeModifier,
    compatibilityRequiredItemIds,
  });
}
