/**
 * Pinned against the registry's control sheet and the atlas counts:
 * 66 modeled effect types and 1 excluded (`counts.modeledEffectTypes`,
 * `counts.excludedEffectTypes`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertAdr0011 } from './effects.js';
import { ImportError } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { SPEC_DIR, TYPES_DIR } from './lib/paths.js';

const spec = <T>(name: string): T =>
  JSON.parse(readFileSync(join(SPEC_DIR, 'effects', name), 'utf8')) as T;

interface EffectType {
  EffectTypeID: string;
  FamilyCode: string;
  Automation: string;
  'Schema status': string;
}

const types = spec<EffectType[]>('effect-types.json');

describe('generated effects spec', () => {
  it('carries 67 effect types across 24 families', () => {
    expect(types).toHaveLength(67);
    expect(spec<unknown[]>('families.json')).toHaveLength(24);
  });

  it('carries the remaining catalogues at their declared sizes', () => {
    expect(spec<unknown[]>('diseases.json')).toHaveLength(10);
    expect(spec<unknown[]>('poisons.json')).toHaveLength(8);
    expect(spec<unknown[]>('injuries.json')).toHaveLength(8);
    expect(spec<unknown[]>('source-map.json')).toHaveLength(306);
    expect(spec<unknown[]>('combination-rules.json')).toHaveLength(67);
    expect(spec<unknown[]>('family-matrix.json')).toHaveLength(300);
    expect(spec<unknown[]>('payloads.json')).toHaveLength(185);
  });

  it('resolves every family reference against the family catalogue', () => {
    const families = new Set(
      spec<{ FamilyCode: string }[]>('families.json').map((f) => f.FamilyCode),
    );
    expect(types.filter((t) => !families.has(t.FamilyCode))).toEqual([]);

    const matrix = spec<{ 'Left family': string; 'Right family': string }[]>('family-matrix.json');
    expect(
      matrix.filter((p) => !families.has(p['Left family']) || !families.has(p['Right family'])),
    ).toEqual([]);
  });

  it('resolves every source-map row against the Executable Rules catalogue', () => {
    const rules = JSON.parse(readFileSync(join(SPEC_DIR, 'rules', 'rules.json'), 'utf8')) as {
      'Rule ID': string;
    }[];
    const catalogue = new Set(rules.map((r) => r['Rule ID']));
    const map = spec<{ 'Rule ID': string }[]>('source-map.json');
    expect(map.filter((m) => !catalogue.has(m['Rule ID']))).toEqual([]);
  });

  it('accounts for every defined entity in the payload catalogue', () => {
    const counts = new Map<string, number>();
    for (const row of spec<{ EntityType: string }[]>('payloads.json')) {
      counts.set(row.EntityType, (counts.get(row.EntityType) ?? 0) + 1);
    }
    expect(counts.get('EffectDefinition')).toBe(67);
    expect(counts.get('CombinationRule')).toBe(67);
    expect(counts.get('EffectFamily')).toBe(24);
    expect(counts.get('DiseaseDefinition')).toBe(10);
  });

  it('records the gate and what was deliberately skipped', () => {
    const meta = spec<{ gateAllPass: boolean; skippedSheets: string[] }>('meta.json');
    expect(meta.gateAllPass).toBe(true);
    // 00_Паспорт repeats its column names across three side-by-side groups; the
    // record reader refuses duplicates rather than keeping the last silently.
    expect(meta.skippedSheets).toEqual(['00_Паспорт']);
  });
});

describe('ADR 0011, checked against its source', () => {
  it('marks exactly one effect type NOT_MODELED, and it is blindness', () => {
    const excluded = types.filter((t) => t.Automation === 'NOT_MODELED');
    expect(excluded).toHaveLength(1);
    expect(excluded[0]?.EffectTypeID).toBe('EFF-SENSE-BLINDNESS');
    expect(excluded[0]?.['Schema status']).toBe('EXCLUDED_FROM_RUNTIME');
  });

  it('leaves 66 modeled types, the figure the atlas states', () => {
    expect(types.filter((t) => t.Automation !== 'NOT_MODELED')).toHaveLength(66);
  });

  it('exposes the excluded type as its own set, so refusals stay explicit', () => {
    const source = readFileSync(join(TYPES_DIR, 'effects.ts'), 'utf8');
    const block =
      /export const NOT_MODELED_EFFECT_TYPE_IDS: readonly EffectTypeId\[\] = \[\n(.*?)\n\];/s.exec(
        source,
      );
    expect(block).not.toBeNull();
    expect(block![1]!.trim().split('\n')).toHaveLength(1);
    expect(block![1]).toContain('EFF-SENSE-BLINDNESS');
  });
});

describe('the ADR 0011 guard actually fires', () => {
  const type = (id: string, automation: string, schema: string): JsonObject => ({
    EffectTypeID: id,
    Automation: automation,
    'Schema status': schema,
  });
  const modeled = (n: number): JsonObject[] =>
    Array.from({ length: n }, (_, i) => type(`EFF-${String(i)}`, 'AUTOMATED', 'DEFINED'));

  it('accepts the shape the artifact currently has', () => {
    expect(() => {
      assertAdr0011([
        ...modeled(66),
        type('EFF-SENSE-BLINDNESS', 'NOT_MODELED', 'EXCLUDED_FROM_RUNTIME'),
      ]);
    }).not.toThrow();
  });

  it('refuses a second unmodelled type', () => {
    expect(() => {
      assertAdr0011([
        ...modeled(65),
        type('EFF-SENSE-BLINDNESS', 'NOT_MODELED', 'EXCLUDED_FROM_RUNTIME'),
        type('EFF-OTHER', 'NOT_MODELED', 'EXCLUDED_FROM_RUNTIME'),
      ]);
    }).toThrow(/expected 1 effect types marked NOT_MODELED, got 2/);
  });

  it('refuses when something other than blindness is the excluded one', () => {
    expect(() => {
      assertAdr0011([...modeled(66), type('EFF-OTHER', 'NOT_MODELED', 'EXCLUDED_FROM_RUNTIME')]);
    }).toThrow(/but ADR 0011 records "EFF-SENSE-BLINDNESS"/);
  });

  it('refuses if blindness re-enters the runtime schema', () => {
    expect(() => {
      assertAdr0011([...modeled(66), type('EFF-SENSE-BLINDNESS', 'NOT_MODELED', 'DEFINED')]);
    }).toThrow(/ADR 0011 depends on it staying out of runtime/);
  });

  it('refuses an empty catalogue rather than passing vacuously', () => {
    expect(() => {
      assertAdr0011([]);
    }).toThrow(ImportError);
  });
});

describe('generated effects types', () => {
  const source = readFileSync(join(TYPES_DIR, 'effects.ts'), 'utf8');

  it('emits an EffectTypeId per type', () => {
    const union = /export type EffectTypeId =\n((?: {2}\| "[^"]+";?\n)+)/.exec(source);
    expect(union).not.toBeNull();
    expect(union![1]!.trimEnd().split('\n')).toHaveLength(67);
  });

  it('is marked generated and uses LF endings', () => {
    expect(source.startsWith('// Generated by tools/import.')).toBe(true);
    expect(source).not.toContain('\r\n');
  });
});
