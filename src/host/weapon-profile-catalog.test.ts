import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { weaponProfilePlayerFacts } from '../domain/rules/item-stage/weapon-profile.js';
import {
  canonicalWeaponProfileCatalog,
  loadWeaponProfileCatalog,
} from './weapon-profile-catalog.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = [
  'catalogue',
  'weapon-profiles',
  'combat-values',
  'weapon-fields',
  'formulas',
  'formula-ranges',
  'dictionaries',
  'operations',
  'rule-trace',
] as const;
type Row = Record<string, unknown>;
const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'symbiosis-weapon-profiles-'));
  roots.push(root);
  const target = join(root, 'generated', 'spec', 'items');
  mkdirSync(target, { recursive: true });
  for (const file of FILES)
    copyFileSync(
      join(ROOT, 'generated', 'spec', 'items', `${file}.json`),
      join(target, `${file}.json`),
    );
  return root;
}
function mutate(root: string, file: (typeof FILES)[number], change: (rows: Row[]) => Row[]): void {
  const path = join(root, 'generated', 'spec', 'items', `${file}.json`);
  writeFileSync(path, JSON.stringify(change(JSON.parse(readFileSync(path, 'utf8')) as Row[])));
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('CHR-023/024 source-backed profile catalog', () => {
  it('loads the canonical 29 pairs, 22 formula certificates and 7 fixed variants with complete safe facts', async () => {
    const catalog = await loadWeaponProfileCatalog(ROOT);
    expect(catalog.entries).toHaveLength(29);
    expect(catalog.entries.filter((entry) => entry.formula !== null)).toHaveLength(22);
    expect(
      new Set(
        catalog.entries
          .filter((entry) => entry.formula === null)
          .map((entry) => entry.weaponTypeId),
      ).size,
    ).toBe(6);
    for (const entry of catalog.entries) {
      expect(entry.canonicalProfileVersion).toBe('ITEM_REGISTRY_V1.2');
      expect(entry.template.weaponVariantId).toBe(entry.weaponVariant);
      expect(entry.template.properties['Навык/класс']).toBe(entry.requirementPreview.skillOrClass);
      expect(entry.template.damageDefinition.definitionId).toBeTruthy();
      expect(entry.template.penetrationDefinition.definitionId).toBeTruthy();
      const facts = weaponProfilePlayerFacts(entry.template);
      expect(facts).not.toEqual([]);
      expect(JSON.stringify(facts)).not.toMatch(
        /CORE-|F-WPN-|CVD-|RG-|ITM-|Источник|availabilityTrace/,
      );
      if (entry.formula !== null) {
        expect(entry.formula.variables.map(({ key }) => key)).toEqual(['L', 'Lw', 'Ls']);
        expect(entry.formula.outputs.every(({ min, step }) => min > 0 && step > 0)).toBe(true);
        expect(entry.formula.expressions).toHaveLength(entry.formula.outputs.length);
        expect(new Set(entry.formula.independentDice.map(({ key }) => key)).size).toBe(
          entry.formula.independentDice.length,
        );
      }
    }
  });

  it('caches a deeply frozen canonical source catalog for synchronous durable validation', async () => {
    const first = canonicalWeaponProfileCatalog();
    expect(canonicalWeaponProfileCatalog()).toBe(first);
    expect(first).toEqual(await loadWeaponProfileCatalog(ROOT));
    expect(Object.isFrozen(first.entries[0]!.template.damageDefinition)).toBe(true);
    expect(Object.isFrozen(first.entries[0]!.formula!.expressions[0]!.expression)).toBe(true);
  });

  it('keeps exact half-step ranges, divisor rules and independent die addresses', async () => {
    const catalog = await loadWeaponProfileCatalog(ROOT);
    const lightCrossbow = catalog.entries.find((entry) => entry.weaponTypeId === 'ITM-WPN-001')!;
    expect(lightCrossbow.formula!.variables.find(({ key }) => key === 'Lw')!.min).toBe(1);
    const lightBow = catalog.entries.find((entry) => entry.weaponTypeId === 'ITM-WPN-007')!;
    expect(lightBow.formula!.variables.find(({ key }) => key === 'Lw')!.min).toBe(0);
    expect(lightBow.formula!.independentDice).toEqual([
      { key: 'R6_DMG', dieSides: 6, label: 'Независимое значение R6_DMG' },
      { key: 'R12_RANGE', dieSides: 12, label: 'Независимое значение R12_RANGE' },
      { key: 'R20_RS', dieSides: 20, label: 'Независимое значение R20_RS' },
      { key: 'R6_RD', dieSides: 6, label: 'Независимое значение R6_RD' },
    ]);
    expect(
      catalog.entries
        .find((entry) => entry.weaponTypeId === 'ITM-WPN-009')!
        .formula!.outputs.find(({ key }) => key === 'Rn'),
    ).toMatchObject({ min: 2, max: null, step: 0.5 });
    expect(
      catalog.entries.find((entry) => entry.weaponTypeId === 'ITM-WPN-016')!.template
        .damageDefinition.conditionalOverride,
    ).toBeDefined();
  });

  it.each([
    ['formulas', (rows: Row[]) => rows.slice(1), 'count drifted'],
    [
      'formulas',
      (rows: Row[]) =>
        rows.map((row, i) => (i === 0 ? { ...row, 'Execution mode': 'GENERATE' } : row)),
      'VALIDATION_ONLY',
    ],
    [
      'formulas',
      (rows: Row[]) =>
        rows.map((row, i) => (i === 0 ? { ...row, 'Generation enabled': true } : row)),
      'false',
    ],
    [
      'formulas',
      (rows: Row[]) =>
        rows.map((row, i) => (i === 0 ? { ...row, 'Общие переменные': 'L,W,S' } : row)),
      'unknown common',
    ],
    [
      'formulas',
      (rows: Row[]) => rows.map((row, i) => (i === 0 ? { ...row, Dm: 'Dm = Math.random()' } : row)),
      'unsupported formula',
    ],
    [
      'formulas',
      (rows: Row[]) => rows.map((row, i) => (i === 0 ? { ...row, Rn: 'Rn = R12_DMG+Dm+L' } : row)),
      'exactly once',
    ],
    [
      'formulas',
      (rows: Row[]) =>
        rows.map((row, i) =>
          i === 0 ? { ...row, 'Независимые дайсы': 'R12_DMG,R12_DMG,R20_RS' } : row,
        ),
      'duplicate independent',
    ],
    [
      'formulas',
      (rows: Row[]) => rows.map((row, i) => (i === 0 ? { ...row, damageBonus: 5 } : row)),
      'unknown fields',
    ],
    [
      'formula-ranges',
      (rows: Row[]) =>
        rows.map((row, i) => (i === 0 ? { ...row, FormulaID: 'unknown-formula' } : row)),
      'expected one formula range',
    ],
    [
      'formula-ranges',
      (rows: Row[]) => rows.map((row, i) => (i === 0 ? { ...row, 'Шаг Rn': 0.25 } : row)),
      'unsupported Rn step',
    ],
    [
      'weapon-profiles',
      (rows: Row[]) =>
        rows.map((row, i) => (i === 2 ? { ...row, Требования: 'S8; D19; Q12' } : row)),
      'unrecognized fixed requirement',
    ],
    [
      'weapon-profiles',
      (rows: Row[]) =>
        rows.map((row, i) =>
          i === 2 ? { ...row, 'Особое правило': 'CORE-185 internal secret' } : row,
        ),
      'internal provenance',
    ],
    [
      'weapon-profiles',
      (rows: Row[]) => rows.map((row, i) => (i === 0 ? { ...row, newMechanicalField: true } : row)),
      'unknown fields',
    ],
    [
      'combat-values',
      (rows: Row[]) =>
        rows.map((row) =>
          row['ItemTypeID'] === 'ITM-WPN-004' && row['valueKind'] === 'PENETRATION'
            ? { ...row, rollGroupId: 'RG-WPN-004-DEFAULT-DAMAGE' }
            : row,
        ),
      'share a roll group',
    ],
    [
      'combat-values',
      (rows: Row[]) =>
        rows.map((row) =>
          row['ItemTypeID'] === 'ITM-WPN-001' && row['valueKind'] === 'DAMAGE'
            ? { ...row, valueMode: 'CONSTANT' }
            : row,
        ),
      'damage output',
    ],
    [
      'operations',
      (rows: Row[]) =>
        rows.map((row) =>
          row['OperationID'] === 'OP-REQ-VALIDATE'
            ? { ...row, 'State transition / result': 'GENERATE' }
            : row,
        ),
      'без бросков',
    ],
    [
      'rule-trace',
      (rows: Row[]) =>
        rows.map((row) =>
          row['Rule ID'] === 'CORE-185' ? { ...row, Статус: 'Не автоматизируется' } : row,
        ),
      'Активно',
    ],
    [
      'weapon-fields',
      (rows: Row[]) =>
        rows.map((row) =>
          row['Field'] === 'templateProfileVersion' ? { ...row, Default: 'unknown-version' } : row,
        ),
      'ITEM_REGISTRY_V1.2',
    ],
  ] as const)('rejects incomplete or unrecognized %s sources', async (file, edit, error) => {
    const root = fixture();
    mutate(root, file, edit);
    await expect(loadWeaponProfileCatalog(root)).rejects.toThrow(error);
  });
});
