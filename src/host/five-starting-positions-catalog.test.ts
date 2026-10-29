import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  recommendPositionQuality,
  validateFiveStartingPositions,
} from '../domain/rules/item-stage/five-starting-positions.js';
import {
  canonicalFiveStartingPositionsCatalog,
  loadFiveStartingPositionsCatalog,
} from './five-starting-positions-catalog.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = [
  'catalogue',
  'open-catalogue',
  'rule-trace',
  'instance-model',
  'dictionaries',
] as const;
type Row = Record<string, unknown>;
const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'symbiosis-five-positions-'));
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

describe('CHR-037 source-backed catalogue and story quantity', () => {
  it('admits exactly the 62 explicit inventory types and one supplied descriptive category', async () => {
    const catalog = await loadFiveStartingPositionsCatalog(ROOT);
    const source = JSON.parse(
      readFileSync(join(ROOT, 'generated/spec/items/catalogue.json'), 'utf8'),
    ) as Row[];
    expect(catalog.entries.filter((entry) => entry.kind === 'CATALOGUE')).toEqual(
      source
        .filter((row) => row['Можно в инвентарь'] === true)
        .map((row) => ({
          itemTypeIdOrStoryType: row['ItemTypeID'],
          kind: 'CATALOGUE',
          name: row['Название'],
        })),
    );
    expect(catalog.entries).toHaveLength(63);
    expect(catalog.entries.filter((entry) => entry.kind === 'STORY')).toEqual([
      {
        itemTypeIdOrStoryType: 'GEN-010',
        kind: 'STORY',
        name: 'Любой заявленный стартовый предмет',
      },
    ]);
    expect(catalog.entries.map((entry) => entry.itemTypeIdOrStoryType)).not.toContain(
      'RES-MAG-001',
    );
    expect(catalog.entries.map((entry) => entry.itemTypeIdOrStoryType)).not.toContain(
      'RES-MAG-002',
    );
    expect(JSON.stringify(catalog)).not.toMatch(
      /CORE-|AQ2-|Источник|availabilityTrace|mechanic|bonus/,
    );
    for (const entry of catalog.entries) {
      const result = validateFiveStartingPositions(
        catalog,
        Array.from({ length: 5 }, (_, index) => ({
          positionId: `position-${String(index)}`,
          itemTypeIdOrStoryType: entry.itemTypeIdOrStoryType,
          quantity: index + 1,
          storyDescriptionOrNull: entry.kind === 'STORY' ? 'Памятный камень' : null,
        })),
      );
      expect(result.every((position) => position.name === entry.name)).toBe(true);
    }
  });

  it('source-checks all 20 quality faces and caches an immutable catalog for history reads', async () => {
    const catalog = canonicalFiveStartingPositionsCatalog();
    expect(canonicalFiveStartingPositionsCatalog()).toBe(catalog);
    expect(catalog).toEqual(await loadFiveStartingPositionsCatalog(ROOT));
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.entries)).toBe(true);
    expect(catalog.entries.every(Object.isFrozen)).toBe(true);
    const dictionaries = JSON.parse(
      readFileSync(join(ROOT, 'generated/spec/items/dictionaries.json'), 'utf8'),
    ) as Row[];
    for (let face = 1; face <= 20; face++) {
      const recommendation = recommendPositionQuality(face);
      expect(dictionaries).toContainEqual({
        Dictionary: 'QUALITY',
        Code: recommendation.range,
        Meaning: recommendation.label,
      });
    }
  });

  it.each(['CORE-172', 'CORE-173', 'AQA-011', 'AQA-012', 'AQ2-003', 'AQ2-004', 'AQ2-005'])(
    'refuses normative drift in %s',
    async (id) => {
      const root = fixture();
      mutate(root, 'rule-trace', (rows) =>
        rows.map((row) =>
          row['Rule ID'] === id
            ? {
                ...row,
                'Итоговый алгоритм': `${String(row['Итоговый алгоритм'])} Изменённое правило.`,
              }
            : row,
        ),
      );
      await expect(loadFiveStartingPositionsCatalog(root)).rejects.toThrow(`${id}: normative`);
    },
  );

  it.each(['missing', 'duplicate', 'tombstone', 'exception'] as const)(
    'refuses %s five-position source',
    async (mode) => {
      const root = fixture();
      mutate(root, 'rule-trace', (rows) => {
        const rule = rows.find((row) => row['Rule ID'] === 'AQ2-003')!;
        if (mode === 'missing') return rows.filter((row) => row !== rule);
        if (mode === 'duplicate') return [...rows, { ...rule }];
        return rows.map((row) =>
          row !== rule
            ? row
            : mode === 'tombstone'
              ? { ...row, Статус: 'TOMBSTONE' }
              : { ...row, 'Исключения / приоритет': 'Описательный предмет бесплатен.' },
        );
      });
      await expect(loadFiveStartingPositionsCatalog(root)).rejects.toThrow('AQ2-003');
    },
  );

  it.each(['promote', 'remove', 'rename', 'duplicate'] as const)(
    'refuses changed catalogue identity/permission: %s',
    async (mode) => {
      const root = fixture();
      mutate(root, 'catalogue', (rows) => {
        if (mode === 'remove') return rows.slice(1);
        if (mode === 'duplicate') return [...rows, { ...rows[0] }];
        return rows.map((row) =>
          row['ItemTypeID'] !== 'RES-MAG-001'
            ? row
            : mode === 'promote'
              ? { ...row, 'Можно в инвентарь': true }
              : { ...row, Название: 'Новый тип' },
        );
      });
      await expect(loadFiveStartingPositionsCatalog(root)).rejects.toThrow('catalogue identities');
    },
  );

  it.each(['GEN-010', 'quantity', 'qualityRoll', 'QUALITY', 'NEVER_PROGRESSION'])(
    'refuses missing or changed %s contract',
    async (key) => {
      const root = fixture();
      if (key === 'GEN-010') {
        mutate(root, 'open-catalogue', (rows) => rows.filter((row) => row['RefID'] !== key));
      } else if (key === 'quantity' || key === 'qualityRoll') {
        mutate(root, 'instance-model', (rows) =>
          rows.map((row) =>
            row['Field'] === key
              ? { ...row, 'Validation / constraint': 'Произвольное значение' }
              : row,
          ),
        );
      } else if (key === 'QUALITY') {
        mutate(root, 'dictionaries', (rows) =>
          rows.map((row) =>
            row['Dictionary'] === key && row['Code'] === '1–4' ? { ...row, Code: '1–5' } : row,
          ),
        );
      } else {
        mutate(root, 'dictionaries', (rows) => rows.filter((row) => row['Code'] !== key));
      }
      await expect(loadFiveStartingPositionsCatalog(root)).rejects.toThrow(key);
    },
  );

  it('rejects a story category that starts granting mechanics', async () => {
    const root = fixture();
    mutate(root, 'open-catalogue', (rows) =>
      rows.map((row) =>
        row['RefID'] === 'GEN-010'
          ? { ...row, 'Граница автоматизации': 'Игрок задаёт бонус.' }
          : row,
      ),
    );
    await expect(loadFiveStartingPositionsCatalog(root)).rejects.toThrow('GEN-010');
  });
});
