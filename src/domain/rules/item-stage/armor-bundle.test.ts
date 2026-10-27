import { describe, expect, it } from 'vitest';

import {
  recommendArmorQuality,
  validateArmorBundle,
  validateArmorQualityFace,
  type ArmorBodyZone,
  type ArmorBundleCatalog,
  type ArmorBundleSelection,
} from './armor-bundle.js';

const BODY_ZONES = ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'] as const;

const CATALOG: ArmorBundleCatalog = Object.freeze({
  entries: Object.freeze([
    Object.freeze({ itemId: 'ITM-ARM-001', name: 'Кожаный доспех', coverageModel: 'ZONE_ELEMENT' }),
    Object.freeze({ itemId: 'ITM-ARM-002', name: 'Бригантина', coverageModel: 'ZONE_ELEMENT' }),
    Object.freeze({ itemId: 'ITM-ARM-003', name: 'Кольчуга', coverageModel: 'ZONE_ELEMENT' }),
    Object.freeze({ itemId: 'ITM-ARM-004', name: 'Латы', coverageModel: 'ZONE_ELEMENT' }),
    Object.freeze({ itemId: 'ITM-ARM-005', name: 'Нэйт', coverageModel: 'FULL_SUIT' }),
    Object.freeze({ itemId: 'ITM-ARM-006', name: 'Кастелькросс', coverageModel: 'FULL_SUIT' }),
    Object.freeze({ itemId: 'ITM-ARM-007', name: 'Цесмор', coverageModel: 'FULL_SUIT' }),
    Object.freeze({ itemId: 'ITM-ARM-008', name: 'Гленхейм', coverageModel: 'FULL_SUIT' }),
  ]),
});

function selection(
  itemId: string,
  bodyZoneOrNull: ArmorBodyZone | null = null,
): ArmorBundleSelection {
  return Object.freeze({ itemId, bodyZoneOrNull });
}

function zoneSelections(): readonly ArmorBundleSelection[] {
  return BODY_ZONES.map((bodyZone) => selection('ITM-ARM-001', bodyZone));
}

describe('CHR-021 starting armor bundle domain rules', () => {
  it('accepts one zone element and six different zone elements with exact zone coverage', () => {
    const single = validateArmorBundle(CATALOG, [selection('ITM-ARM-001', 'HEAD')]);
    expect(single.armorPieces).toEqual([
      {
        itemId: 'ITM-ARM-001',
        name: 'Кожаный доспех',
        coverageModel: 'ZONE_ELEMENT',
        bodyZone: 'HEAD',
      },
    ]);
    expect(single.distinctBodyZones).toEqual(['HEAD']);

    const six = validateArmorBundle(CATALOG, zoneSelections());
    expect(six.armorPieces).toHaveLength(6);
    expect(six.distinctBodyZones).toEqual([...BODY_ZONES]);
  });

  it('accepts one full suit as a single element covering all six zones', () => {
    const fullSuit = validateArmorBundle(CATALOG, [selection('ITM-ARM-005')]);
    expect(fullSuit.armorPieces).toEqual([
      {
        itemId: 'ITM-ARM-005',
        name: 'Нэйт',
        coverageModel: 'FULL_SUIT',
        bodyZone: null,
      },
    ]);
    expect(fullSuit.distinctBodyZones).toEqual([...BODY_ZONES]);
  });

  it.each([
    ['empty bundle', [] as readonly ArmorBundleSelection[]],
    ['seven zone elements', [...zoneSelections(), selection('ITM-ARM-001', 'HEAD')]],
    [
      'duplicate zone for the same item',
      [selection('ITM-ARM-001', 'HEAD'), selection('ITM-ARM-001', 'HEAD')],
    ],
    [
      'duplicate zone for another item',
      [selection('ITM-ARM-001', 'HEAD'), selection('ITM-ARM-002', 'HEAD')],
    ],
    [
      'full suit with a second zone element',
      [selection('ITM-ARM-005'), selection('ITM-ARM-001', 'HEAD')],
    ],
    [
      'zone element with another full suit',
      [selection('ITM-ARM-001', 'HEAD'), selection('ITM-ARM-006')],
    ],
    ['unknown item', [selection('itm-arm-009', 'HEAD')]],
    ['non-armor item', [selection('ITM-WPN-001', 'HEAD')]],
    ['zone element without a zone', [selection('ITM-ARM-001')]],
    ['full suit with a forged zone', [selection('ITM-ARM-005', 'HEAD')]],
  ])('rejects %s before any host write or sampler', (_name, selections) => {
    expect(() => validateArmorBundle(CATALOG, selections)).toThrow();
    expect(CATALOG.entries).toHaveLength(8);
  });

  it('rejects forged body zones and non-positive or over-cap counts without mutating input', () => {
    const forged = [{ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'TAIL' }] as const;
    const frozen = Object.freeze(forged) as unknown as readonly ArmorBundleSelection[];
    expect(() => validateArmorBundle(CATALOG, frozen)).toThrow('unrecognized armor body zone');
    expect(() =>
      validateArmorBundle(CATALOG, [selection('ITM-ARM-001', 'HEAD')].slice(0, 0)),
    ).toThrow('1..6 armor pieces');
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
  ])('maps D20 face %d to the exact source quality recommendation', (face, kind, label, range) => {
    expect(recommendArmorQuality(face)).toEqual({ kind, label, range, rawFace: face });
    expect(validateArmorQualityFace(face)).toBe(face);
  });

  it.each([0, 21, 1.5, Number.NaN])('rejects invalid D20 quality face %s', (face) => {
    expect(() => recommendArmorQuality(face as number)).toThrow('safe integer in 1..20');
    expect(() => validateArmorQualityFace(face as number)).toThrow('safe integer in 1..20');
  });
});
