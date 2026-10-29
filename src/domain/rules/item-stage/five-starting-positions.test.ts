import { describe, expect, it } from 'vitest';

import {
  recommendPositionQuality,
  validateFiveStartingPositions,
  validateFiveStartingPositionsCatalog,
  validatePositionQualityFace,
  type FiveStartingPositionSelection,
  type FiveStartingPositionsCatalog,
} from './five-starting-positions.js';

// Item Registry 01_Каталог + 09_Открытый_каталог GEN-010; no invented mechanical types.
const CATALOG: FiveStartingPositionsCatalog = {
  entries: [
    { itemTypeIdOrStoryType: 'RES-AMM-002', kind: 'CATALOGUE', name: 'Стрела' },
    { itemTypeIdOrStoryType: 'ITM-PHA-001', kind: 'CATALOGUE', name: 'Антисептик' },
    {
      itemTypeIdOrStoryType: 'GEN-010',
      kind: 'STORY',
      name: 'Любой заявленный стартовый предмет',
    },
  ],
};

function selections(): FiveStartingPositionSelection[] {
  return Array.from({ length: 5 }, (_, index) => ({
    positionId: `position-${String(index + 1)}`,
    itemTypeIdOrStoryType: index === 4 ? 'GEN-010' : 'RES-AMM-002',
    quantity: index === 4 ? 3 : index + 1,
    storyDescriptionOrNull: index === 4 ? '  Три памятных камня  ' : null,
  }));
}

describe('CHR-037 five positions (AQ2-003, AQA-012, AQ2-004/005)', () => {
  it('keeps five distinct positions even for repeated item types and a multi-item story stack', () => {
    const input = selections();
    const validated = validateFiveStartingPositions(CATALOG, input);
    expect(validated).toHaveLength(5);
    expect(new Set(validated.map((row) => row.positionId)).size).toBe(5);
    expect(validated.slice(0, 4).every((row) => row.name === 'Стрела')).toBe(true);
    expect(validated[4]).toEqual({
      ...input[4],
      name: 'Любой заявленный стартовый предмет',
      kind: 'STORY',
    });
    expect(validated[4]!.storyDescriptionOrNull).toBe('  Три памятных камня  ');
    expect(Object.isFrozen(validated)).toBe(true);
    expect(validated.every(Object.isFrozen)).toBe(true);
    input[0] = { ...input[0]!, quantity: 99 };
    expect(validated[0]!.quantity).toBe(1);
    expect(validateFiveStartingPositions(CATALOG, validated)).toEqual(validated);
  });

  it.each([0, 4, 6])('refuses %i positions, including an extra free story position', (count) => {
    const input = Array.from({ length: count }, (_, index) => ({
      ...selections()[4]!,
      positionId: `story-${String(index)}`,
    }));
    expect(() => validateFiveStartingPositions(CATALOG, input)).toThrow('exactly five');
  });

  it('refuses duplicate position identities without merging their quantities', () => {
    const input = selections();
    input[4] = { ...input[4]!, positionId: input[0]!.positionId };
    expect(() => validateFiveStartingPositions(CATALOG, input)).toThrow('distinct');
  });

  it.each([0, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null])(
    'refuses quantity %s without a default or coercion',
    (quantity) => {
      const input = selections();
      input[4] = { ...input[4]!, quantity: quantity as number };
      expect(() => validateFiveStartingPositions(CATALOG, input)).toThrow('positive safe integer');
    },
  );

  it('does not add an unsupported gameplay cap to a positive integral quantity', () => {
    const input = selections();
    input[0] = { ...input[0]!, quantity: Number.MAX_SAFE_INTEGER };
    expect(validateFiveStartingPositions(CATALOG, input)[0]!.quantity).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it.each(['RES-MAG-001', 'RES-MAG-002', 'NAR-001', 'MOD-005', 'UNKNOWN'])(
    'refuses unavailable type %s',
    (itemTypeIdOrStoryType) => {
      const input = selections();
      input[0] = { ...input[0]!, itemTypeIdOrStoryType };
      expect(() => validateFiveStartingPositions(CATALOG, input)).toThrow('unavailable item type');
    },
  );

  it.each(['', '  ', null, 1, { bonus: 10 }])('requires actual story text: %s', (description) => {
    const input = selections();
    input[4] = { ...input[4]!, storyDescriptionOrNull: description as string };
    expect(() => validateFiveStartingPositions(CATALOG, input)).toThrow('description must contain');
  });

  it.each([
    'Амулет CORE-172',
    'Талисман aq2-005',
    'Карточка SYM-117',
    'Метка Q-CHAR-017',
    'Камень F-WPN-001',
    'Свиток ITM-WPN-001',
    'Источник: скрытая карточка',
    'actionAvailabilityTrace: скрыто',
    'masterPredicate=true',
    'gmFinalizationRequired=false',
  ])('rejects internal notation before it becomes saved story prose: %s', (description) => {
    const input = selections();
    input[4] = { ...input[4]!, storyDescriptionOrNull: description };
    let message = '';
    try {
      validateFiveStartingPositions(CATALOG, input);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('internal source or diagnostic notation');
    expect(message).not.toContain(description);
  });

  it('refuses descriptions on catalogue types and any player mechanical payload', () => {
    const input = selections();
    input[0] = { ...input[0]!, storyDescriptionOrNull: 'Прибавляет силу' };
    expect(() => validateFiveStartingPositions(CATALOG, input)).toThrow('must not contain');
    const mechanical = selections();
    mechanical[4] = { ...mechanical[4]!, bonus: 10 } as FiveStartingPositionSelection;
    expect(() => validateFiveStartingPositions(CATALOG, mechanical)).toThrow('unexpected fields');
  });

  it('revalidates derived names/kinds and refuses a tampered durable selection', () => {
    const input = [...validateFiveStartingPositions(CATALOG, selections())];
    input[0] = { ...input[0]!, name: 'Непоставленный предмет' };
    expect(() => validateFiveStartingPositions(CATALOG, input)).toThrow('catalog entry');
  });

  it.each([null, [], {}, { entries: [] }, { entries: CATALOG.entries, mechanics: {} }])(
    'refuses an incomplete or expanded catalog %s',
    (catalog) => {
      expect(() =>
        validateFiveStartingPositionsCatalog(catalog as FiveStartingPositionsCatalog),
      ).toThrow('five starting positions');
    },
  );

  it('refuses duplicate or disguised catalog types', () => {
    expect(() =>
      validateFiveStartingPositionsCatalog({
        entries: [...CATALOG.entries, CATALOG.entries[0]!],
      }),
    ).toThrow('duplicate');
    expect(() =>
      validateFiveStartingPositionsCatalog({
        entries: [
          ...CATALOG.entries.slice(0, 2),
          { ...CATALOG.entries[2]!, itemTypeIdOrStoryType: 'NAR-001' },
        ],
      }),
    ).toThrow('not recognized');
  });
});

describe('CHR-037 descriptive QUALITY scale (CORE-173, AQ2-004)', () => {
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
  ] as const)(
    'recommends face %i without inventory, quantity or equipment effects',
    (rawFace, kind, label, range) => {
      const input = selections();
      const before = structuredClone(input);
      expect(recommendPositionQuality(rawFace)).toEqual({ rawFace, kind, label, range });
      expect(Object.isFrozen(recommendPositionQuality(rawFace))).toBe(true);
      expect(input).toEqual(before);
    },
  );

  it.each([0, 21, -1, 1.5, NaN, Infinity, '20', null])('refuses invalid face %s', (face) => {
    expect(() => validatePositionQualityFace(face as number)).toThrow('1..20');
    expect(() => recommendPositionQuality(face as number)).toThrow('1..20');
  });
});
