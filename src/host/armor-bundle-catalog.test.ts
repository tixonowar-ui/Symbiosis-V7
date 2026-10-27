import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadArmorBundleCatalog } from './armor-bundle-catalog.js';
import { REPO_ROOT } from '../../tests/fixtures/symbiont-stage.js';

const ITEM_FILES = ['catalogue.json', 'armor-profiles.json', 'dictionaries.json'] as const;
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function itemRoot(root: string): string {
  return join(root, 'generated', 'spec', 'items');
}

function createItemRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'symbiosis-armor-catalog-'));
  temporaryRoots.push(root);
  mkdirSync(itemRoot(root), { recursive: true });
  for (const file of ITEM_FILES) {
    cpSync(join(REPO_ROOT, 'generated', 'spec', 'items', file), join(itemRoot(root), file));
  }
  return root;
}

function readItems(root: string, file: string): unknown {
  return JSON.parse(readFileSync(join(itemRoot(root), file), 'utf8')) as unknown;
}

function writeItems(root: string, file: string, value: unknown): void {
  writeFileSync(join(itemRoot(root), file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('CHR-021 armor bundle item catalog', () => {
  it('loads exactly eight canonical template-fixed armor entries from generated items', async () => {
    const catalog = await loadArmorBundleCatalog(REPO_ROOT);
    expect(catalog.entries.map((entry) => [entry.itemId, entry.name, entry.coverageModel])).toEqual(
      [
        ['ITM-ARM-001', 'Кожаный доспех', 'ZONE_ELEMENT'],
        ['ITM-ARM-002', 'Бригантина', 'ZONE_ELEMENT'],
        ['ITM-ARM-003', 'Кольчуга', 'ZONE_ELEMENT'],
        ['ITM-ARM-004', 'Латы', 'ZONE_ELEMENT'],
        ['ITM-ARM-005', 'Нэйт', 'FULL_SUIT'],
        ['ITM-ARM-006', 'Кастелькросс', 'FULL_SUIT'],
        ['ITM-ARM-007', 'Цесмор', 'FULL_SUIT'],
        ['ITM-ARM-008', 'Гленхейм', 'FULL_SUIT'],
      ],
    );
    expect(catalog.bodyZones).toEqual(['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R']);
    expect(catalog.qualityScale.map((entry) => [entry.range, entry.label])).toEqual([
      ['1–4', 'Отсутствует/непригоден'],
      ['5–9', 'Плохое'],
      ['10–14', 'Обычное'],
      ['15–18', 'Хорошее'],
      ['19', 'Исключительное'],
      ['20', 'Редкое'],
    ]);
  });

  it('fails closed when an extra armor row appears in catalogue or profiles', async () => {
    const extraCatalogueRoot = createItemRoot();
    const catalogue = readItems(extraCatalogueRoot, 'catalogue.json') as
      Record<string, unknown> | Record<string, unknown>[];
    const allRows = (Array.isArray(catalogue) ? catalogue : Object.values(catalogue)) as Record<
      string,
      unknown
    >[];
    const sourceRow = allRows.find((row) => row['ItemTypeID'] === 'ITM-ARM-001')!;
    const extraRow = {
      ...sourceRow,
      ItemTypeID: 'ITM-ARM-009',
      Название: 'Внепоставочный доспех',
    };
    if (Array.isArray(catalogue)) catalogue.push(extraRow);
    else catalogue['64'] = extraRow;
    writeItems(extraCatalogueRoot, 'catalogue.json', catalogue);
    await expect(loadArmorBundleCatalog(extraCatalogueRoot)).rejects.toThrow('ITM-ARM-009');

    const extraProfileRoot = createItemRoot();
    const profiles = readItems(extraProfileRoot, 'armor-profiles.json') as Record<
      string,
      unknown
    >[];
    profiles.push({
      ...(profiles[0] as Record<string, unknown>),
      ItemTypeID: 'ITM-ARM-009',
      'Модель покрытия': 'ZONE_ELEMENT',
    });
    writeItems(extraProfileRoot, 'armor-profiles.json', profiles);
    await expect(loadArmorBundleCatalog(extraProfileRoot)).rejects.toThrow('ITM-ARM-009');
  });

  it('fails closed on drifted dictionaries, inventory flags or armor policy', async () => {
    const qualityRoot = createItemRoot();
    const dictionaries = readItems(qualityRoot, 'dictionaries.json') as Record<string, unknown>[];
    writeItems(
      qualityRoot,
      'dictionaries.json',
      dictionaries.filter(
        (entry) => !(entry['Dictionary'] === 'QUALITY' && entry['Code'] === '19'),
      ),
    );
    await expect(loadArmorBundleCatalog(qualityRoot)).rejects.toThrow('QUALITY 19');

    const zoneRoot = createItemRoot();
    const zoneDictionaries = readItems(zoneRoot, 'dictionaries.json') as Record<string, unknown>[];
    writeItems(
      zoneRoot,
      'dictionaries.json',
      zoneDictionaries.map((entry) =>
        entry['Dictionary'] === 'BODY_ZONE' && entry['Code'] === 'HEAD'
          ? { ...entry, Code: 'SKULL' }
          : entry,
      ),
    );
    await expect(loadArmorBundleCatalog(zoneRoot)).rejects.toThrow('BODY_ZONE HEAD');

    const policyRoot = createItemRoot();
    const catalogue = readItems(policyRoot, 'catalogue.json') as
      Record<string, unknown> | Record<string, unknown>[];
    const allRows = (Array.isArray(catalogue) ? catalogue : Object.values(catalogue)) as Record<
      string,
      unknown
    >[];
    const armorRow = allRows.find((row) => row['ItemTypeID'] === 'ITM-ARM-002')!;
    armorRow['Политика заявки игрока'] = 'OPEN';
    writeItems(policyRoot, 'catalogue.json', catalogue);
    await expect(loadArmorBundleCatalog(policyRoot)).rejects.toThrow('TEMPLATE_FIXED');
  });

  it('rejects a linked project root while preserving containment checks', async () => {
    const root = createItemRoot();
    const linkParent = mkdtempSync(join(tmpdir(), 'symbiosis-armor-catalog-link-'));
    temporaryRoots.push(linkParent);
    const linkedRoot = join(linkParent, 'linked-project');
    mkdirSync(dirname(linkedRoot), { recursive: true });
    await import('node:fs').then(({ symlinkSync }) => symlinkSync(root, linkedRoot, 'junction'));
    const catalog = await loadArmorBundleCatalog(linkedRoot);
    expect(catalog.entries).toHaveLength(8);
  });
});
