import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyzeSource,
  buildCoverage,
  loadCatalog,
  renderReport,
  scanRepository,
  transitionKey,
  type Catalog,
  type CoverageModel,
  type ReferenceScan,
  type TransitionReference,
} from './traceability.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const emptyScan = (): ReferenceScan => analyzeSource('', 'empty.ts');
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, relative: string, source: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, 'utf8');
}

function writeJson(root: string, relative: string, value: unknown): void {
  write(root, relative, `${JSON.stringify(value)}\n`);
}

function catalogFixture(formsById: unknown, declaredFormCount: number): string {
  const root = mkdtempSync(join(tmpdir(), 'symbiosis-traceability-catalog-'));
  temporaryRoots.push(root);
  const specRoot = join(root, 'generated', 'spec');
  writeJson(specRoot, 'atlas/renderer/forms-by-id.json', formsById);
  writeJson(specRoot, 'atlas/transitions.json', []);
  writeJson(specRoot, 'atlas/journeys.json', []);
  writeJson(specRoot, 'atlas/requirements.json', []);
  writeJson(specRoot, 'atlas/qa-scenarios.json', []);
  writeJson(specRoot, 'atlas/lifecycles.json', []);
  writeJson(specRoot, 'atlas/meta.json', {
    counts: {
      forms: declaredFormCount,
      transitions: 0,
      journeys: 0,
      requirements: 0,
      qaScenarios: 0,
    },
    guardStates: [],
    roles: [],
  });
  writeJson(specRoot, 'rules/rules.json', []);
  writeJson(specRoot, 'rules/meta.json', { active: 0, tombstone: 0 });
  return specRoot;
}

function fixtureCatalog(transition: TransitionReference): Catalog {
  return {
    categories: [
      { key: 'forms', milestone: 'M5–M6', title: 'Формы', references: ['ZZZ-901'] },
      {
        key: 'transitions',
        milestone: 'M5–M6',
        title: 'Переходы',
        references: [transitionKey(transition)],
      },
    ],
    forms: [{ id: 'ZZZ-901', domain: 'Тестовый домен', type: 'screen' }],
    transitions: [transition],
    knownIds: new Set(['ZZZ-901', 'ZZZ-902']),
  };
}

describe('catalog extraction', () => {
  const catalog = loadCatalog(join(REPO_ROOT, 'generated', 'spec'));
  const totals = Object.fromEntries(
    catalog.categories.map((item) => [item.key, item.references.length]),
  );

  it('derives every acceptance total from generated/spec', () => {
    expect(totals).toEqual({
      activeRules: 699,
      tombstoneRules: 40,
      lifecycles: 19,
      roles: 3,
      guardStates: 10,
      forms: 376,
      transitions: 1672,
      journeys: 66,
      requirements: 91,
      qaScenarios: 2440,
    });
  });

  it('derives all form group totals without losing a form', () => {
    const model = buildCoverage(catalog, emptyScan(), emptyScan());
    expect(model.domains).toHaveLength(16);
    expect(model.types).toHaveLength(6);
    expect(model.domains.reduce((sum, row) => sum + row.total, 0)).toBe(376);
    expect(model.types.reduce((sum, row) => sum + row.total, 0)).toBe(376);
  });
});

describe('renderer form index validation', () => {
  const form = { id: 'ZZZ-901', domain: 'Тестовый домен', type: 'screen' };

  it('preserves form rows and category references from the object index', () => {
    const catalog = loadCatalog(catalogFixture({ 'ZZZ-901': form }, 1));

    expect(catalog.forms).toEqual([form]);
    expect(catalog.categories.find(({ key }) => key === 'forms')?.references).toEqual(['ZZZ-901']);
  });

  it('rejects a non-object renderer form index', () => {
    expect(() => loadCatalog(catalogFixture([form], 1))).toThrow(
      'atlas/renderer/forms-by-id.json: expected object',
    );
  });

  it('rejects duplicate embedded form ids', () => {
    expect(() =>
      loadCatalog(
        catalogFixture(
          {
            'ZZZ-901': form,
            'ZZZ-902': form,
          },
          2,
        ),
      ),
    ).toThrow('forms: duplicate "ZZZ-901"');
  });

  it('rejects an index key that does not match the embedded form id', () => {
    expect(() => loadCatalog(catalogFixture({ 'ZZZ-902': form }, 1))).toThrow(
      'atlas/renderer/forms-by-id.json["ZZZ-902"].id: index key does not match "ZZZ-901"',
    );
  });

  it.each(['id', 'domain', 'type'] as const)('requires a non-empty form %s', (fieldName) => {
    expect(() =>
      loadCatalog(
        catalogFixture(
          {
            'ZZZ-901': { ...form, [fieldName]: '' },
          },
          1,
        ),
      ),
    ).toThrow(`atlas/renderer/forms-by-id.json["ZZZ-901"].${fieldName}: expected non-empty string`);
  });

  it('checks the renderer form count against atlas metadata', () => {
    expect(() => loadCatalog(catalogFixture({ 'ZZZ-901': form }, 2))).toThrow(
      'atlas counts.forms: declared 2, found 1',
    );
  });
});

describe('reference semantics', () => {
  it('counts exact string literals, not comments or substrings, and deduplicates them', () => {
    const scan = analyzeSource(
      `
        // ZZZ-901
        const first = 'ZZZ-901';
        const duplicate = "ZZZ-901";
        const longer = 'prefix ZZZ-901 suffix';
      `,
      'src/example.ts',
    );
    expect([...scan.literals].filter((value) => value === 'ZZZ-901')).toEqual(['ZZZ-901']);
    expect(scan.literals.has('prefix ZZZ-901 suffix')).toBe(true);
    expect(scan.literalLocations.get('ZZZ-901')).toEqual(
      new Set(['src/example.ts:3', 'src/example.ts:4']),
    );
  });

  it('requires all four literal fields for a transition', () => {
    const transition = { from: 'ZZZ-901', to: 'ZZZ-902', kind: 'journey', trigger: 'open' };
    const endpoints = analyzeSource("const from = 'ZZZ-901'; const to = 'ZZZ-902';", 'src/a.ts');
    const exact = analyzeSource(
      "const route = { from: 'ZZZ-901', to: 'ZZZ-902', kind: 'journey', trigger: 'open' };",
      'src/b.ts',
    );
    expect(endpoints.transitions.size).toBe(0);
    expect(exact.transitions).toEqual(new Set([transitionKey(transition)]));
  });

  it('separates implementation from application tests and ignores tooling', () => {
    const root = mkdtempSync(join(tmpdir(), 'symbiosis-traceability-'));
    temporaryRoots.push(root);
    write(root, 'src/app.ts', "export const id = 'ZZZ-901';");
    write(root, 'src/app.test.ts', "export const id = 'ZZZ-902';");
    write(root, 'tools/helper.ts', "export const id = 'ZZZ-903';");
    write(root, 'tools/helper.test.ts', "export const id = 'ZZZ-904';");
    write(root, 'tests/integration/example.ts', "export const id = 'ZZZ-905';");
    write(root, 'generated/spec/fake.ts', "export const id = 'ZZZ-906';");

    const scans = scanRepository(root);
    expect(scans.implementation.literals).toEqual(new Set(['ZZZ-901']));
    expect(scans.tests.literals).toEqual(new Set(['ZZZ-902', 'ZZZ-905']));
    expect(scans.source.literals).toEqual(new Set(['ZZZ-901', 'ZZZ-902']));
  });
});

describe('coverage and discrepancies', () => {
  const transition = { from: 'ZZZ-901', to: 'ZZZ-902', kind: 'journey', trigger: 'open' };
  const catalog = fixtureCatalog(transition);

  it('counts expected literals and transition tuples independently', () => {
    const implementation = analyzeSource(
      "const form = 'ZZZ-901'; const route = { from: 'ZZZ-901', to: 'ZZZ-902', kind: 'journey', trigger: 'open' };",
      'src/app.ts',
    );
    const tests = analyzeSource("expect('ZZZ-901').toBeDefined();", 'src/app.test.ts');
    const model = buildCoverage(catalog, implementation, tests);
    expect(model.categories.map((row) => [row.key, row.implemented, row.tested])).toEqual([
      ['forms', 1, 1],
      ['transitions', 1, 0],
    ]);
  });

  it('reports unknown source IDs and transition tuples with stable locations', () => {
    const implementation = analyzeSource(
      "const id = 'ZZZ-999'; const route = { from: 'ZZZ-901', to: 'ZZZ-999', kind: 'journey', trigger: 'open' };",
      'src/app.ts',
    );
    const model = buildCoverage(catalog, implementation, emptyScan());
    expect(model.discrepancies).toEqual([
      { kind: 'ID', reference: 'ZZZ-999', locations: ['src/app.ts:1'] },
      {
        kind: 'Переход',
        reference: '["ZZZ-901","ZZZ-999","journey","open"]',
        locations: ['src/app.ts:1'],
      },
    ]);
  });

  it('reports an unknown ID from a colocated src test without implementing it', () => {
    const source = analyzeSource("const id = 'ZZZ-999';", 'src/app.test.ts');
    const model = buildCoverage(catalog, emptyScan(), source, source);
    expect(model.categories[0]?.implemented).toBe(0);
    expect(model.discrepancies[0]).toEqual({
      kind: 'ID',
      reference: 'ZZZ-999',
      locations: ['src/app.test.ts:1'],
    });
  });
});

describe('report rendering', () => {
  const model: CoverageModel = {
    categories: [],
    domains: [],
    types: [],
    discrepancies: [],
  };

  it('is byte-stable without a commit-dependent date in the compared body', async () => {
    const first = await renderReport(model);
    const second = await renderReport(model);
    expect(second).toBe(first);
    expect(first).toContain('Только строковый литерал');
    expect(first).toContain('Комментарии, имена файлов');
    expect(first).not.toContain('Дата снимка');
    expect(first).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/u);
    expect(first.endsWith('\n')).toBe(true);
    expect(first).not.toContain('\r\n');
  });
});
