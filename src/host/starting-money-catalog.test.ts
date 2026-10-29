import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { recommendStartingWealth } from '../domain/rules/item-stage/starting-money.js';
import {
  canonicalStartingMoneyCatalog,
  loadStartingMoneyCatalog,
} from './starting-money-catalog.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = ['rule-trace', 'catalogue', 'dictionaries'] as const;
type Row = Record<string, unknown>;
const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'symbiosis-starting-money-'));
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

describe('CHR-038 source-backed money scale', () => {
  it('loads the separate money scale, preserving master finalization without exposing source IDs', async () => {
    const catalog = await loadStartingMoneyCatalog(ROOT);
    expect(catalog).toEqual({
      dieSides: 20,
      gmFinalizationRequired: true,
      wealthScale: [
        { kind: 'NONE', minFace: 1, maxFace: 4, range: '1–4', label: 'нет денег' },
        { kind: 'SMALL', minFace: 5, maxFace: 9, range: '5–9', label: 'малая сумма' },
        { kind: 'ORDINARY', minFace: 10, maxFace: 14, range: '10–14', label: 'обычная' },
        { kind: 'LARGE', minFace: 15, maxFace: 18, range: '15–18', label: 'крупная' },
        { kind: 'EXCEPTIONAL', minFace: 19, maxFace: 19, range: '19', label: 'исключительная' },
        { kind: 'RARE_FORTUNE', minFace: 20, maxFace: 20, range: '20', label: 'редкое состояние' },
      ],
    });
    expect(JSON.stringify(catalog)).not.toMatch(
      /CORE-|AQ2-|RES-|Источник|amount|approval|availabilityTrace/i,
    );
    for (let face = 1; face <= 20; face++)
      expect(recommendStartingWealth(face, catalog)).toEqual(recommendStartingWealth(face));
  });

  it('caches a deeply frozen source-validated catalog for synchronous history replay', async () => {
    const catalog = canonicalStartingMoneyCatalog();
    expect(canonicalStartingMoneyCatalog()).toBe(catalog);
    expect(catalog).toEqual(await loadStartingMoneyCatalog(ROOT));
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.wealthScale)).toBe(true);
    expect(catalog.wealthScale.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    ['CORE-172', '1–4 — нет денег', '1–5 — нет денег'],
    ['CORE-172', 'малая сумма', '100 монет'],
    ['CORE-172', 'NEVER_PROGRESSION', 'STANDARD'],
    ['AQ2-003', 'Деньги получают отдельный D20.', 'Деньги получают два D20.'],
    ['AQ2-004', 'только итог мастера определяет', 'автоматический бросок определяет'],
  ] as const)('rejects drift of %s: %s', async (id, before, after) => {
    const root = fixture();
    mutate(root, 'rule-trace', (rows) =>
      rows.map((row) =>
        row['Rule ID'] === id
          ? { ...row, 'Итоговый алгоритм': String(row['Итоговый алгоритм']).replace(before, after) }
          : row,
      ),
    );
    await expect(loadStartingMoneyCatalog(root)).rejects.toThrow(`${id}.Итоговый алгоритм`);
  });

  it.each(['missing', 'duplicate', 'tombstone'] as const)(
    'refuses %s CORE-172 source',
    async (mode) => {
      const root = fixture();
      mutate(root, 'rule-trace', (rows) => {
        const rule = rows.find((row) => row['Rule ID'] === 'CORE-172')!;
        if (mode === 'missing') return rows.filter((row) => row !== rule);
        if (mode === 'duplicate') return [...rows, { ...rule }];
        return rows.map((row) => (row === rule ? { ...rule, Статус: 'TOMBSTONE' } : row));
      });
      await expect(loadStartingMoneyCatalog(root)).rejects.toThrow('CORE-172');
    },
  );

  it('refuses changed master-defined money and progression policies', async () => {
    const currency = fixture();
    mutate(currency, 'catalogue', (rows) =>
      rows.map((row) =>
        row['ItemTypeID'] === 'RES-CUR-000'
          ? { ...row, 'Источник готовых параметров экземпляра': 'AUTO_AMOUNT' }
          : row,
      ),
    );
    await expect(loadStartingMoneyCatalog(currency)).rejects.toThrow('RES-CUR-000');
    const progression = fixture();
    mutate(progression, 'dictionaries', (rows) =>
      rows.filter(
        (row) =>
          !(row['Dictionary'] === 'ProgressionEligibility' && row['Code'] === 'NEVER_PROGRESSION'),
      ),
    );
    await expect(loadStartingMoneyCatalog(progression)).rejects.toThrow('NEVER_PROGRESSION');
  });
});
