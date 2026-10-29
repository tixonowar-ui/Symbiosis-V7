import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { loadStartingWeaponCatalog } from './starting-weapon-catalog.js';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = [
  'catalogue',
  'weapon-profiles',
  'combat-values',
  'weapon-fields',
  'instance-model',
  'dictionaries',
  'formulas',
] as const;
const roots: string[] = [];
type Row = Record<string, unknown>;

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'symbiosis-starting-weapon-catalog-'));
  roots.push(root);
  const target = join(root, 'generated', 'spec', 'items');
  mkdirSync(target, { recursive: true });
  for (const file of FILES)
    copyFileSync(
      join(PROJECT_ROOT, 'generated', 'spec', 'items', `${file}.json`),
      join(target, `${file}.json`),
    );
  return root;
}

function mutate(root: string, file: (typeof FILES)[number], edit: (rows: Row[]) => Row[]): void {
  const path = join(root, 'generated', 'spec', 'items', `${file}.json`);
  const rows = JSON.parse(readFileSync(path, 'utf8')) as Row[];
  writeFileSync(path, JSON.stringify(edit(rows)), 'utf8');
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('CHR-022 source-backed starting weapon catalog', () => {
  it('joins all canonical types to exact variants and profile policy with safe requirement previews', async () => {
    const catalog = await loadStartingWeaponCatalog(PROJECT_ROOT);
    expect(catalog.entries).toHaveLength(29);
    expect(new Set(catalog.entries.map((entry) => entry.weaponTypeId)).size).toBe(27);
    expect(catalog.entries.filter((entry) => entry.profileKind === 'FORMULA')).toHaveLength(22);
    expect(
      catalog.entries
        .filter((entry) => entry.profileKind === 'FIXED')
        .map((entry) => [entry.weaponTypeId, entry.weaponVariant]),
    ).toEqual([
      ['ITM-WPN-003', 'DEFAULT'],
      ['ITM-WPN-004', 'DEFAULT'],
      ['ITM-WPN-005', 'DEFAULT'],
      ['ITM-WPN-006', 'DEFAULT'],
      ['ITM-WPN-026', 'SWORD'],
      ['ITM-WPN-027', 'SHIELD'],
      ['ITM-WPN-027', 'RAPIER'],
    ]);
    expect(
      catalog.entries
        .filter((entry) => entry.weaponTypeId === 'ITM-WPN-012')
        .map((entry) => [entry.weaponVariant, entry.variantLabel]),
    ).toEqual([
      ['ONE_HAND', 'Полуторный меч, фиксированный хват одной рукой.'],
      ['TWO_HAND', 'Полуторный меч, фиксированный хват двумя руками.'],
    ]);
    expect(
      catalog.entries.find((entry) => entry.weaponTypeId === 'ITM-WPN-003')?.requirementPreview,
    ).toEqual({
      requirements: 'S8; D19',
      skillOrClass: 'Стрельба; класс Сталкер/Солдат ПР',
      missingSkillOrClassPenalty: '−15 без класса',
    });
    expect(catalog.entries[0]?.requirementPreview).toEqual({
      requirements:
        'Требования к силе и ловкости, урон и дальность определяются готовым профилем оружия.',
      skillOrClass: 'Стрельба или Сталкер/Солдат ПР',
      missingSkillOrClassPenalty: '−5',
    });
    expect(catalog.qualityScale).toEqual([
      { range: '1–4', label: 'Отсутствует/непригоден' },
      { range: '5–9', label: 'Плохое' },
      { range: '10–14', label: 'Обычное' },
      { range: '15–18', label: 'Хорошее' },
      { range: '19', label: 'Исключительное' },
      { range: '20', label: 'Редкое' },
    ]);
    const json = JSON.stringify(catalog);
    expect(json).not.toMatch(
      /CORE-\d|F-WPN-|Rule ID|Источник|availabilityTrace|Master profile override|PROFILE|statRequirements|instanceDamage|rangeMeters|gripMode/,
    );
  });

  it.each([
    [
      'catalogue',
      (rows: Row[]) => rows.filter((row) => row['ItemTypeID'] !== 'ITM-WPN-001'),
      'missing canonical weapon',
    ],
    [
      'catalogue',
      (rows: Row[]) => [...rows, { ...rows.find((row) => row['ItemTypeID'] === 'ITM-WPN-001') }],
      'duplicate weapon',
    ],
    [
      'catalogue',
      (rows: Row[]) =>
        rows.map((row) =>
          row['ItemTypeID'] === 'ITM-WPN-001'
            ? { ...row, 'Политика заявки игрока': 'TEMPLATE_FIXED' }
            : row,
        ),
      'EXACT_JOINT_FORMULA',
    ],
    [
      'weapon-profiles',
      (rows: Row[]) =>
        rows.map((row) =>
          row['ItemTypeID'] === 'ITM-WPN-001' ? { ...row, Название: 'Another weapon' } : row,
        ),
      'Название',
    ],
    [
      'weapon-profiles',
      (rows: Row[]) =>
        rows.map((row) =>
          row['ItemTypeID'] === 'ITM-WPN-001' ? { ...row, Требования: 'S8 CORE-185' } : row,
        ),
      'internal provenance',
    ],
    [
      'weapon-profiles',
      (rows: Row[]) =>
        rows.map((row) =>
          row['ItemTypeID'] === 'ITM-WPN-001'
            ? { ...row, Требования: 'PROFILE: statRequirements{W:12}' }
            : row,
        ),
      'unrecognized formula requirement',
    ],
    [
      'combat-values',
      (rows: Row[]) =>
        rows.filter(
          (row) => !(row['ItemTypeID'] === 'ITM-WPN-012' && row['attackVariantId'] === 'TWO_HAND'),
        ),
      'missing combat definition',
    ],
    [
      'combat-values',
      (rows: Row[]) =>
        rows.map((row) =>
          row['ItemTypeID'] === 'ITM-WPN-026' ? { ...row, attackVariantId: 'SHIELD' } : row,
        ),
      'unknown combat definition',
    ],
    [
      'formulas',
      (rows: Row[]) => rows.filter((row) => row['Вариант'] !== 'TWO_HAND'),
      'missing formula selection',
    ],
    [
      'formulas',
      (rows: Row[]) =>
        rows.map((row) =>
          row['Вариант'] === 'ONE_HAND' ? { ...row, FormulaID: 'F-WPN-008B' } : row,
        ),
      'FormulaID',
    ],
    [
      'dictionaries',
      (rows: Row[]) => rows.filter((row) => row['Code'] !== 'ONE_HAND'),
      'ATTACK_VARIANT dictionary changed',
    ],
    [
      'dictionaries',
      (rows: Row[]) =>
        rows.map((row) =>
          row['Dictionary'] === 'QUALITY' && row['Code'] === '1–4'
            ? { ...row, Meaning: 'Removed' }
            : row,
        ),
      'QUALITY 1–4',
    ],
    [
      'dictionaries',
      (rows: Row[]) => [...rows, { ...rows.find((row) => row['Dictionary'] === 'QUALITY') }],
      'duplicate QUALITY',
    ],
  ] as const)('fails closed on %s source drift', async (file, edit, expected) => {
    const root = fixture();
    mutate(root, file, edit);
    await expect(loadStartingWeaponCatalog(root)).rejects.toThrow(expected);
  });
});
