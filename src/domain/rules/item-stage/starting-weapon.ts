import {
  recommendArmorQuality,
  validateArmorQualityFace,
  type ArmorQualityRecommendation,
} from './armor-bundle.js';

/** Item Registry 07B attackVariantId; 05 formulas fixes both bastard-sword grips. */
export const STARTING_WEAPON_VARIANTS = [
  'DEFAULT',
  'ONE_HAND',
  'TWO_HAND',
  'SWORD',
  'SHIELD',
  'RAPIER',
] as const;

export type StartingWeaponVariant = (typeof STARTING_WEAPON_VARIANTS)[number];

export interface StartingWeaponSelection {
  readonly weaponTypeId: string;
  readonly weaponVariant: StartingWeaponVariant;
}

export interface StartingWeaponCatalogEntry extends StartingWeaponSelection {
  readonly name: string;
  readonly profileKind: 'FORMULA' | 'FIXED';
}

export interface StartingWeaponCatalog {
  readonly entries: readonly StartingWeaponCatalogEntry[];
}

/**
 * Item Registry 01 catalogue identity/policy and 07A attack variants. The host
 * loader asserts this closed identity set against the delivered rows before
 * serving it; durable history can then validate identities without file IO.
 */
const CANONICAL_WEAPON_ROWS = [
  ['ITM-WPN-001', 'Лёгкий арбалет', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-002', 'Тяжёлый арбалет', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-003', 'Кенси', 'FIXED', ['DEFAULT']],
  ['ITM-WPN-004', 'Эривел', 'FIXED', ['DEFAULT']],
  ['ITM-WPN-005', 'Эстрефорд', 'FIXED', ['DEFAULT']],
  ['ITM-WPN-006', 'Айнцберн', 'FIXED', ['DEFAULT']],
  ['ITM-WPN-007', 'Лёгкий лук', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-008', 'Тяжёлый лук', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-009', 'Длинный лук', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-010', 'Грубое оружие', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-011', 'Одноручный меч', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-012', 'Полуторный меч', 'FORMULA', ['ONE_HAND', 'TWO_HAND']],
  ['ITM-WPN-013', 'Двуручный меч', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-014', 'Шпага', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-015', 'Копьё', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-016', 'Кинжал', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-017', 'Мизерикордия', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-018', 'Одноручный топор', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-019', 'Клевец', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-020', 'Двуручный топор', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-021', 'Кастет', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-022', 'Деревянный круглый щит', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-023', 'Железный круглый щит', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-024', 'Деревянный треугольный щит', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-025', 'Железный треугольный щит', 'FORMULA', ['DEFAULT']],
  ['ITM-WPN-026', 'Корнадора', 'FIXED', ['SWORD']],
  ['ITM-WPN-027', 'Бларадэ', 'FIXED', ['SHIELD', 'RAPIER']],
] as const satisfies readonly (readonly [
  string,
  string,
  'FORMULA' | 'FIXED',
  readonly StartingWeaponVariant[],
])[];

export const CANONICAL_STARTING_WEAPON_CATALOG: StartingWeaponCatalog = Object.freeze({
  entries: Object.freeze(
    CANONICAL_WEAPON_ROWS.flatMap(([weaponTypeId, name, profileKind, variants]) =>
      variants.map((weaponVariant) =>
        Object.freeze({ weaponTypeId, weaponVariant, name, profileKind }),
      ),
    ),
  ),
});

export type StartingWeaponQualityRecommendation = ArmorQualityRecommendation;

// CORE-172/173 and Q-CORE-052 use the same descriptive scale as the armor bundle.
export const recommendStartingWeaponQuality = recommendArmorQuality;
export const validateStartingWeaponQualityFace = validateArmorQualityFace;

function fail(detail: string): never {
  throw new Error(`starting weapon: ${detail}`);
}

function variant(value: unknown): value is StartingWeaponVariant {
  return (
    typeof value === 'string' && (STARTING_WEAPON_VARIANTS as readonly string[]).includes(value)
  );
}

function isWeaponEntryArray(value: unknown): value is readonly StartingWeaponCatalogEntry[] {
  return Array.isArray(value);
}

export function validateStartingWeapon(
  catalog: StartingWeaponCatalog,
  selection: StartingWeaponSelection,
): StartingWeaponCatalogEntry {
  if (
    catalog === null ||
    typeof catalog !== 'object' ||
    Array.isArray(catalog) ||
    !isWeaponEntryArray(catalog.entries) ||
    catalog.entries.length === 0
  ) {
    fail('catalog must contain an entries array with canonical weapons');
  }
  const keys = new Set<string>();
  for (const [index, entry] of catalog.entries.entries()) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.weaponTypeId !== 'string' ||
      entry.weaponTypeId.length === 0 ||
      typeof entry.name !== 'string' ||
      entry.name.length === 0 ||
      (entry.profileKind !== 'FORMULA' && entry.profileKind !== 'FIXED') ||
      !variant(entry.weaponVariant)
    ) {
      fail(`catalog.entries[${String(index)}] is not a canonical weapon selection`);
    }
    const key = `${entry.weaponTypeId}/${entry.weaponVariant}`;
    if (keys.has(key)) fail(`duplicate catalog selection ${key}`);
    keys.add(key);
  }
  if (
    selection === null ||
    typeof selection !== 'object' ||
    Array.isArray(selection) ||
    Object.keys(selection).length !== 2 ||
    Object.keys(selection).some((key) => key !== 'weaponTypeId' && key !== 'weaponVariant') ||
    typeof selection.weaponTypeId !== 'string' ||
    selection.weaponTypeId.length === 0 ||
    !variant(selection.weaponVariant)
  ) {
    fail('selection must contain exactly one weaponTypeId and one canonical weaponVariant');
  }
  const selected = catalog.entries.find(
    (entry) =>
      entry.weaponTypeId === selection.weaponTypeId &&
      entry.weaponVariant === selection.weaponVariant,
  );
  if (selected === undefined) {
    fail(
      `unknown or incompatible selection ${selection.weaponTypeId}/${selection.weaponVariant}; available: ${[...keys].join(', ')}`,
    );
  }
  return Object.freeze({
    weaponTypeId: selected.weaponTypeId,
    weaponVariant: selected.weaponVariant,
    name: selected.name,
    profileKind: selected.profileKind,
  });
}

/** CHR-022 CTA 001/002 sign the formula/fixed route before selection becomes immutable. */
export function validateStartingWeaponRace(
  entry: StartingWeaponCatalogEntry,
  raceChoice: 'FREE' | 'UNITED' | 'PURE',
): void {
  if (raceChoice !== 'FREE' && raceChoice !== 'UNITED' && raceChoice !== 'PURE') {
    fail(`unknown race ${String(raceChoice)}`);
  }
  const expected = raceChoice === 'PURE' ? 'FIXED' : 'FORMULA';
  if (entry.profileKind !== expected) {
    fail(
      `weapon ${entry.weaponTypeId}/${entry.weaponVariant} requires the ${expected} path for ${raceChoice}`,
    );
  }
}

export function canonicalStartingWeaponSelection(
  weaponTypeId: string,
  weaponVariant: StartingWeaponVariant,
  raceChoice: 'FREE' | 'UNITED' | 'PURE',
): StartingWeaponCatalogEntry {
  const selection = validateStartingWeapon(CANONICAL_STARTING_WEAPON_CATALOG, {
    weaponTypeId,
    weaponVariant,
  });
  validateStartingWeaponRace(selection, raceChoice);
  return selection;
}
