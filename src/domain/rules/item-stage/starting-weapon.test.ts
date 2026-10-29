import { describe, expect, it } from 'vitest';

import {
  recommendStartingWeaponQuality,
  validateStartingWeapon,
  validateStartingWeaponQualityFace,
  validateStartingWeaponRace,
  type StartingWeaponCatalog,
  type StartingWeaponSelection,
} from './starting-weapon.js';

// Item Registry 01, 02 and 07A; the fixed-grip variants belong only to WPN-012.
const CATALOG: StartingWeaponCatalog = {
  entries: [
    {
      weaponTypeId: 'ITM-WPN-001',
      weaponVariant: 'DEFAULT',
      name: 'Лёгкий арбалет',
      profileKind: 'FORMULA',
    },
    {
      weaponTypeId: 'ITM-WPN-012',
      weaponVariant: 'ONE_HAND',
      name: 'Полуторный меч',
      profileKind: 'FORMULA',
    },
    {
      weaponTypeId: 'ITM-WPN-012',
      weaponVariant: 'TWO_HAND',
      name: 'Полуторный меч',
      profileKind: 'FORMULA',
    },
    { weaponTypeId: 'ITM-WPN-003', weaponVariant: 'DEFAULT', name: 'Кенси', profileKind: 'FIXED' },
    {
      weaponTypeId: 'ITM-WPN-026',
      weaponVariant: 'SWORD',
      name: 'Корнадора',
      profileKind: 'FIXED',
    },
    { weaponTypeId: 'ITM-WPN-027', weaponVariant: 'SHIELD', name: 'Бларадэ', profileKind: 'FIXED' },
    { weaponTypeId: 'ITM-WPN-027', weaponVariant: 'RAPIER', name: 'Бларадэ', profileKind: 'FIXED' },
  ],
};

describe('CHR-022 starting weapon selection (CORE-172/173, AQ2-003)', () => {
  it.each(CATALOG.entries)(
    'preserves the one exact canonical pair $weaponTypeId/$weaponVariant',
    (entry) => {
      const result = validateStartingWeapon(CATALOG, {
        weaponTypeId: entry.weaponTypeId,
        weaponVariant: entry.weaponVariant,
      });
      expect(result).toEqual(entry);
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it.each([
    null,
    [],
    [{ weaponTypeId: 'ITM-WPN-001', weaponVariant: 'DEFAULT' }],
    { weaponTypeId: ['ITM-WPN-001'], weaponVariant: 'DEFAULT' },
    { weaponTypeId: 'ITM-WPN-001', weaponVariant: ['DEFAULT'] },
    { weaponTypeId: 'ITM-WPN-001', weaponVariant: 'DEFAULT; ONE_HAND' },
    { weaponTypeId: 'ITM-WPN-001;ITM-WPN-012', weaponVariant: 'DEFAULT' },
    { weaponTypeId: 'ITM-WPN-001', weaponVariant: 'ONE_HAND' },
    { weaponTypeId: 'ITM-WPN-012', weaponVariant: 'DEFAULT' },
    { weaponTypeId: 'ITM-WPN-026', weaponVariant: 'SHIELD' },
    { weaponTypeId: 'ITM-ARM-001', weaponVariant: 'DEFAULT' },
    { weaponTypeId: 'unknown-weapon', weaponVariant: 'DEFAULT' },
    { weaponTypeId: 'ITM-WPN-001', weaponVariant: 'DEFAULT', equipped: true },
    { weaponTypeId: 'ITM-WPN-001' },
  ])(
    'rejects forged, mixed or incompatible selection %j without changing the catalog',
    (selection) => {
      const before = structuredClone(CATALOG);
      expect(() => validateStartingWeapon(CATALOG, selection as StartingWeaponSelection)).toThrow(
        'starting weapon:',
      );
      expect(CATALOG).toEqual(before);
    },
  );

  it('rejects duplicate or invalid host catalog entries instead of selecting the first', () => {
    const selection = { weaponTypeId: 'ITM-WPN-001', weaponVariant: 'DEFAULT' } as const;
    expect(() =>
      validateStartingWeapon({ entries: [CATALOG.entries[0]!, CATALOG.entries[0]!] }, selection),
    ).toThrow('duplicate catalog selection');
    expect(() => validateStartingWeapon({ entries: [] }, selection)).toThrow('catalog');
  });

  it('accepts only the signed race/profile paths before an immutable roll', () => {
    const formula = CATALOG.entries[0]!;
    const fixed = CATALOG.entries[3]!;
    expect(() => validateStartingWeaponRace(formula, 'FREE')).not.toThrow();
    expect(() => validateStartingWeaponRace(formula, 'UNITED')).not.toThrow();
    expect(() => validateStartingWeaponRace(fixed, 'PURE')).not.toThrow();
    expect(() => validateStartingWeaponRace(fixed, 'FREE')).toThrow('FORMULA path');
    expect(() => validateStartingWeaponRace(fixed, 'UNITED')).toThrow('FORMULA path');
    expect(() => validateStartingWeaponRace(formula, 'PURE')).toThrow('FIXED path');
    expect(() => validateStartingWeaponRace(formula, 'OTHER' as 'FREE')).toThrow('unknown race');
  });

  it.each([
    [1, 'MISSING_OR_UNFIT', 'Отсутствует/непригоден', '1–4'],
    [4, 'MISSING_OR_UNFIT', 'Отсутствует/непригоден', '1–4'],
    [5, 'POOR', 'Плохое', '5–9'],
    [9, 'POOR', 'Плохое', '5–9'],
    [10, 'ORDINARY', 'Обычное', '10–14'],
    [14, 'ORDINARY', 'Обычное', '10–14'],
    [15, 'GOOD', 'Хорошее', '15–18'],
    [18, 'GOOD', 'Хорошее', '15–18'],
    [19, 'EXCEPTIONAL', 'Исключительное', '19'],
    [20, 'RARE', 'Редкое', '20'],
  ])(
    'maps D20 %i to the descriptive source scale without changing weapons',
    (rawFace, kind, label, range) => {
      const before = structuredClone(CATALOG);
      expect(recommendStartingWeaponQuality(rawFace)).toEqual({
        kind,
        label,
        range,
        rawFace,
      });
      expect(CATALOG).toEqual(before);
    },
  );

  it.each([0, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid D20 %s', (face) => {
    expect(() => validateStartingWeaponQualityFace(face)).toThrow('safe integer in 1..20');
  });
});
