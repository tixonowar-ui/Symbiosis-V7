/**
 * The validator's own patterns and reference checks, exercised against the real
 * `generated/spec`. These exist because the first version of this file invented
 * its id patterns instead of deriving them, and rejected 79 valid ids.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPEC_DIR } from '../import/lib/paths.js';

const spec = <T>(relative: string): T =>
  JSON.parse(readFileSync(join(SPEC_DIR, relative), 'utf8')) as T;

const ID = {
  rule: /^[A-Z][A-Z0-9]{1,3}-\d{3}$/,
  form: /^[A-Z]{2,3}-\d{3}$/,
  effect: /^EFF-[A-Z][A-Z0-9_]*(?:-[A-Z][A-Z0-9_]*)*$/,
  family: /^FAM-[A-Z][A-Z0-9_]*$/,
  item: /^[A-Z]{3}-[A-Z]{3}-\d{3}$/,
  species: /^SPC-[A-Z][A-Z-]*$/,
  template: /^CBT-[A-Z][A-Z-]*$/,
  sentient: /^SENT-[A-Z]+(?:-[A-Z]+)*-\d{3}$/,
};

describe('id patterns accept every id the artifacts actually use', () => {
  const cases: [string, string, string, RegExp][] = [
    ['rules/rules.json', 'Rule ID', 'rule', ID.rule],
    ['effects/effect-types.json', 'EffectTypeID', 'effect', ID.effect],
    ['effects/families.json', 'FamilyCode', 'family', ID.family],
    ['items/catalogue.json', 'ItemTypeID', 'item', ID.item],
    ['bestiary/species.json', 'Species ID', 'species', ID.species],
    ['bestiary/templates.json', 'Canonical Template ID', 'template', ID.template],
    ['sentient/templates.json', 'SystemTemplateID', 'sentient', ID.sentient],
  ];

  for (const [file, column, name, pattern] of cases) {
    it(`accepts every ${name} id`, () => {
      const ids = spec<Record<string, string>[]>(file).map((row) => row[column] ?? '');
      expect(ids.filter((id) => !pattern.test(id))).toEqual([]);
    });
  }

  it('accepts every form id in the renderer catalogue', () => {
    const forms = Object.values(
      spec<Record<string, { id: string }>>('atlas/renderer/forms-by-id.json'),
    );
    expect(forms.map((form) => form.id).filter((id) => !ID.form.test(id))).toEqual([]);
  });

  it('covers the shapes that broke the first attempt', () => {
    // Underscores inside a segment, and a two-segment effect id.
    expect(ID.effect.test('EFF-LIFE-SEVERE_WOUND')).toBe(true);
    expect(ID.effect.test('EFF-FATIGUE')).toBe(true);
    expect(ID.family.test('FAM-PHYSICAL_CONTROL')).toBe(true);
    // Rule prefixes are not uniformly three letters.
    expect(ID.rule.test('CORE-001')).toBe(true);
    expect(ID.rule.test('SYM-021')).toBe(true);
    expect(ID.rule.test('AQ2-001')).toBe(true);
  });

  it('still rejects malformed ids', () => {
    expect(ID.rule.test('core-001')).toBe(false);
    expect(ID.rule.test('CORE-1')).toBe(false);
    expect(ID.form.test('APP-1')).toBe(false);
    expect(ID.item.test('ITM-001')).toBe(false);
  });
});

describe('ids are unique within each catalogue', () => {
  const cases: [string, string][] = [
    ['rules/rules.json', 'Rule ID'],
    ['effects/effect-types.json', 'EffectTypeID'],
    ['items/catalogue.json', 'ItemTypeID'],
    ['bestiary/species.json', 'Species ID'],
    ['sentient/templates.json', 'SystemTemplateID'],
  ];

  for (const [file, column] of cases) {
    it(`has no duplicates in ${file}`, () => {
      const ids = spec<Record<string, string>[]>(file).map((row) => row[column] ?? '');
      expect(new Set(ids).size).toBe(ids.length);
    });
  }

  it('has no duplicate embedded ids in the renderer form catalogue', () => {
    const ids = Object.values(
      spec<Record<string, { id: string }>>('atlas/renderer/forms-by-id.json'),
    ).map((form) => form.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('no orphans in the graphs the atlas and bestiary define', () => {
  it('leaves no form outside the transition graph', () => {
    const forms = new Set(
      Object.values(spec<Record<string, { id: string }>>('atlas/renderer/forms-by-id.json')).map(
        (form) => form.id,
      ),
    );
    const reached = new Set<string>();
    for (const t of spec<{ from: string; to: string }[]>('atlas/transitions.json')) {
      reached.add(t.from);
      reached.add(t.to);
    }
    expect([...forms].filter((id) => !reached.has(id))).toEqual([]);
  });

  it('leaves no species without a statblock', () => {
    const species = new Set(
      spec<{ 'Species ID': string }[]>('bestiary/species.json').map((s) => s['Species ID']),
    );
    const used = new Set(
      spec<{ 'Species ID': string }[]>('bestiary/templates.json').map((t) => t['Species ID']),
    );
    expect([...species].filter((id) => !used.has(id))).toEqual([]);
  });
});
