import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { format } from 'prettier';
import ts from 'typescript';

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const CODE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const ID_SHAPE = /^[A-Z][A-Z0-9_]*(?:-[A-Z0-9_]+)+(?:#[A-Z0-9_]+)?$/;

type JsonRecord = Record<string, unknown>;

export type CategoryKey =
  | 'forms'
  | 'transitions'
  | 'journeys'
  | 'requirements'
  | 'qaScenarios'
  | 'activeRules'
  | 'tombstoneRules'
  | 'lifecycles'
  | 'guardStates'
  | 'roles';

export interface Category {
  readonly key: CategoryKey;
  readonly milestone: string;
  readonly title: string;
  readonly references: readonly string[];
}

export interface FormReference {
  readonly id: string;
  readonly domain: string;
  readonly type: string;
}

export interface TransitionReference {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly trigger: string;
}

export interface Catalog {
  readonly categories: readonly Category[];
  readonly forms: readonly FormReference[];
  readonly transitions: readonly TransitionReference[];
  readonly knownIds: ReadonlySet<string>;
}

export interface ReferenceScan {
  readonly literals: ReadonlySet<string>;
  readonly transitions: ReadonlySet<string>;
  readonly literalLocations: ReadonlyMap<string, ReadonlySet<string>>;
  readonly transitionLocations: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface CoverageRow {
  readonly key: CategoryKey;
  readonly milestone: string;
  readonly title: string;
  readonly total: number;
  readonly implemented: number;
  readonly tested: number;
}

export interface FormGroupRow {
  readonly name: string;
  readonly prefix?: string;
  readonly total: number;
  readonly implemented: number;
  readonly tested: number;
}

export interface Discrepancy {
  readonly kind: 'ID' | 'Переход';
  readonly reference: string;
  readonly locations: readonly string[];
}

export interface CoverageModel {
  readonly categories: readonly CoverageRow[];
  readonly domains: readonly FormGroupRow[];
  readonly types: readonly FormGroupRow[];
  readonly discrepancies: readonly Discrepancy[];
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label}: expected object`);
  }
  return value as JsonRecord;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}: expected array`);
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label}: expected non-empty string`);
  }
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label}: expected non-negative integer`);
  }
  return value;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (cause) {
    throw new Error(`cannot read JSON ${path}`, { cause });
  }
}

function rows(path: string): JsonRecord[] {
  return asArray(readJson(path), path).map((value, index) =>
    asRecord(value, `${path}[${String(index)}]`),
  );
}

function field(row: JsonRecord, name: string, label: string): string {
  return asString(row[name], `${label}.${name}`);
}

function unique(values: Iterable<string>, label: string): string[] {
  const result = new Set<string>();
  for (const value of values) {
    if (result.has(value)) throw new Error(`${label}: duplicate ${JSON.stringify(value)}`);
    result.add(value);
  }
  return [...result].sort(compare);
}

export function transitionKey(value: TransitionReference): string {
  return JSON.stringify([value.from, value.to, value.kind, value.trigger]);
}

function walkFiles(root: string, extension?: string): string[] {
  const result: string[] = [];
  if (!existsSync(root)) return result;
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      compare(a.name, b.name),
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && (extension === undefined || extname(entry.name) === extension)) {
        result.push(path);
      }
    }
  };
  visit(root);
  return result;
}

function collectKnownIds(value: unknown, result: Set<string>): void {
  if (typeof value === 'string') {
    if (ID_SHAPE.test(value)) result.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectKnownIds(item, result);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (ID_SHAPE.test(key)) result.add(key);
      collectKnownIds(item, result);
    }
  }
}

function assertCount(actual: number, expected: unknown, label: string): void {
  const count = asNumber(expected, label);
  if (actual !== count)
    throw new Error(`${label}: declared ${String(count)}, found ${String(actual)}`);
}

export function loadCatalog(specRoot: string): Catalog {
  const atlasRoot = join(specRoot, 'atlas');
  const forms = rows(join(atlasRoot, 'forms.json')).map((row, index) => ({
    id: field(row, 'id', `forms[${String(index)}]`),
    domain: field(row, 'domain', `forms[${String(index)}]`),
    type: field(row, 'type', `forms[${String(index)}]`),
  }));
  unique(
    forms.map((form) => form.id),
    'forms',
  );

  const transitions = rows(join(atlasRoot, 'transitions.json')).map((row, index) => ({
    from: field(row, 'from', `transitions[${String(index)}]`),
    to: field(row, 'to', `transitions[${String(index)}]`),
    kind: field(row, 'kind', `transitions[${String(index)}]`),
    trigger: field(row, 'trigger', `transitions[${String(index)}]`),
  }));
  const transitionIds = unique(transitions.map(transitionKey), 'transitions');

  const journeys = unique(
    rows(join(atlasRoot, 'journeys.json')).map((row, index) =>
      field(row, 'id', `journeys[${String(index)}]`),
    ),
    'journeys',
  );
  const requirements = unique(
    rows(join(atlasRoot, 'requirements.json')).map((row, index) =>
      field(row, 'requirementId', `requirements[${String(index)}]`),
    ),
    'requirements',
  );
  const qaScenarios = unique(
    rows(join(atlasRoot, 'qa-scenarios.json')).map((row, index) =>
      field(row, 'qaId', `qa-scenarios[${String(index)}]`),
    ),
    'qa-scenarios',
  );
  const lifecycles = unique(
    rows(join(atlasRoot, 'lifecycles.json')).map((row, index) =>
      field(row, 'entity', `lifecycles[${String(index)}]`),
    ),
    'lifecycles',
  );

  const atlasMeta = asRecord(readJson(join(atlasRoot, 'meta.json')), 'atlas/meta.json');
  const counts = asRecord(atlasMeta['counts'], 'atlas/meta.json.counts');
  assertCount(forms.length, counts['forms'], 'atlas counts.forms');
  assertCount(transitions.length, counts['transitions'], 'atlas counts.transitions');
  assertCount(journeys.length, counts['journeys'], 'atlas counts.journeys');
  assertCount(requirements.length, counts['requirements'], 'atlas counts.requirements');
  assertCount(qaScenarios.length, counts['qaScenarios'], 'atlas counts.qaScenarios');

  const guardStates = unique(
    asArray(atlasMeta['guardStates'], 'atlas/meta.json.guardStates').map((value, index) =>
      asString(value, `guardStates[${String(index)}]`),
    ),
    'guardStates',
  );
  const roles = unique(
    asArray(atlasMeta['roles'], 'atlas/meta.json.roles').map((value, index) =>
      field(asRecord(value, `roles[${String(index)}]`), 'id', `roles[${String(index)}]`),
    ),
    'roles',
  );

  const activeRules: string[] = [];
  const tombstoneRules: string[] = [];
  for (const [index, row] of rows(join(specRoot, 'rules', 'rules.json')).entries()) {
    const label = `rules[${String(index)}]`;
    const id = field(row, 'Rule ID', label);
    const status = field(row, 'Статус', label);
    if (status === 'Активно') activeRules.push(id);
    else if (status === 'Не автоматизируется') tombstoneRules.push(id);
    else throw new Error(`${label}.Статус: unknown ${JSON.stringify(status)}`);
  }
  const allRules = unique([...activeRules, ...tombstoneRules], 'rules');
  const rulesMeta = asRecord(readJson(join(specRoot, 'rules', 'meta.json')), 'rules/meta.json');
  assertCount(activeRules.length, rulesMeta['active'], 'rules meta.active');
  assertCount(tombstoneRules.length, rulesMeta['tombstone'], 'rules meta.tombstone');

  const knownIds = new Set<string>();
  for (const path of walkFiles(specRoot, '.json')) collectKnownIds(readJson(path), knownIds);
  for (const id of [
    ...forms.map((form) => form.id),
    ...journeys,
    ...requirements,
    ...qaScenarios,
    ...allRules,
  ]) {
    knownIds.add(id);
  }

  const categories: Category[] = [
    {
      key: 'activeRules',
      milestone: 'M3',
      title: 'Активные правила',
      references: unique(activeRules, 'active rules'),
    },
    {
      key: 'tombstoneRules',
      milestone: 'M3',
      title: 'Tombstone-правила',
      references: unique(tombstoneRules, 'tombstone rules'),
    },
    { key: 'lifecycles', milestone: 'M3', title: 'Entity lifecycles', references: lifecycles },
    { key: 'roles', milestone: 'M4', title: 'Проекции ролей', references: roles },
    { key: 'guardStates', milestone: 'M4', title: 'Guard-состояния', references: guardStates },
    {
      key: 'forms',
      milestone: 'M5–M6',
      title: 'Формы',
      references: unique(
        forms.map((form) => form.id),
        'forms',
      ),
    },
    { key: 'transitions', milestone: 'M5–M6', title: 'Переходы', references: transitionIds },
    { key: 'journeys', milestone: 'M8', title: 'Journeys', references: journeys },
    { key: 'requirements', milestone: 'M8', title: 'Requirements', references: requirements },
    { key: 'qaScenarios', milestone: 'M8', title: 'QA-сценарии', references: qaScenarios },
  ];
  return { categories, forms, transitions, knownIds };
}

function scriptKind(path: string): ts.ScriptKind {
  const extension = extname(path);
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function addLocation(map: Map<string, Set<string>>, key: string, location: string): void {
  const locations = map.get(key) ?? new Set<string>();
  locations.add(location);
  map.set(key, locations);
}

function propertyName(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return undefined;
}

export function analyzeSource(source: string, path: string): ReferenceScan {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path));
  const literals = new Set<string>();
  const transitions = new Set<string>();
  const literalLocations = new Map<string, Set<string>>();
  const transitionLocations = new Map<string, Set<string>>();
  const location = (node: ts.Node): string => {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    return `${path}:${String(position.line + 1)}`;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      literals.add(node.text);
      addLocation(literalLocations, node.text, location(node));
    }
    if (ts.isObjectLiteralExpression(node)) {
      const values = new Map<string, string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer))
          continue;
        const name = propertyName(property.name);
        if (name !== undefined) values.set(name, property.initializer.text);
      }
      const from = values.get('from');
      const to = values.get('to');
      const kind = values.get('kind');
      const trigger = values.get('trigger');
      if (from !== undefined && to !== undefined && kind !== undefined && trigger !== undefined) {
        const key = transitionKey({ from, to, kind, trigger });
        transitions.add(key);
        addLocation(transitionLocations, key, location(node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { literals, transitions, literalLocations, transitionLocations };
}

function emptyScan(): {
  literals: Set<string>;
  transitions: Set<string>;
  literalLocations: Map<string, Set<string>>;
  transitionLocations: Map<string, Set<string>>;
} {
  return {
    literals: new Set<string>(),
    transitions: new Set<string>(),
    literalLocations: new Map<string, Set<string>>(),
    transitionLocations: new Map<string, Set<string>>(),
  };
}

function mergeScan(target: ReturnType<typeof emptyScan>, scan: ReferenceScan): void {
  for (const literal of scan.literals) target.literals.add(literal);
  for (const transition of scan.transitions) target.transitions.add(transition);
  for (const [key, locations] of scan.literalLocations) {
    for (const item of locations) addLocation(target.literalLocations, key, item);
  }
  for (const [key, locations] of scan.transitionLocations) {
    for (const item of locations) addLocation(target.transitionLocations, key, item);
  }
}

function isTestPath(path: string): boolean {
  return /(?:^|\/)(?:__tests__)(?:\/|$)|\.(?:test|spec)\.[^.]+$/.test(path);
}

export function scanRepository(repoRoot: string): {
  implementation: ReferenceScan;
  tests: ReferenceScan;
  source: ReferenceScan;
} {
  const implementation = emptyScan();
  const tests = emptyScan();
  const source = emptyScan();
  for (const rootName of ['src', 'tests']) {
    const root = join(repoRoot, rootName);
    for (const path of walkFiles(root)) {
      if (!CODE_EXTENSIONS.has(extname(path))) continue;
      const relativePath = relative(repoRoot, path).split(sep).join('/');
      const test = rootName === 'tests' || isTestPath(relativePath);
      const scan = analyzeSource(readFileSync(path, 'utf8'), relativePath);
      if (rootName === 'src') mergeScan(source, scan);
      mergeScan(test ? tests : implementation, scan);
    }
  }
  return { implementation, tests, source };
}

const countMatches = (expected: readonly string[], actual: ReadonlySet<string>): number =>
  expected.reduce((count, value) => count + (actual.has(value) ? 1 : 0), 0);

function groupForms(
  forms: readonly FormReference[],
  implementation: ReadonlySet<string>,
  tests: ReadonlySet<string>,
  selector: (form: FormReference) => string,
  includePrefix: boolean,
): FormGroupRow[] {
  const groups = new Map<string, FormReference[]>();
  for (const form of forms) {
    const key = selector(form);
    const group = groups.get(key) ?? [];
    group.push(form);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([name, group]) => {
      const prefixes = [...new Set(group.map((form) => `${form.id.split('-')[0] ?? ''}-`))].sort(
        compare,
      );
      if (includePrefix && prefixes.length !== 1) {
        throw new Error(`domain ${JSON.stringify(name)} has prefixes ${prefixes.join(', ')}`);
      }
      const ids = group.map((form) => form.id);
      return {
        name,
        ...(includePrefix ? { prefix: prefixes[0]! } : {}),
        total: group.length,
        implemented: countMatches(ids, implementation),
        tested: countMatches(ids, tests),
      };
    })
    .sort((left, right) =>
      compare(
        includePrefix ? (left.prefix ?? '') : left.name,
        includePrefix ? (right.prefix ?? '') : right.name,
      ),
    );
}

export function buildCoverage(
  catalog: Catalog,
  implementation: ReferenceScan,
  tests: ReferenceScan,
  source: ReferenceScan = implementation,
): CoverageModel {
  const categories = catalog.categories.map((category) => {
    const implemented =
      category.key === 'transitions' ? implementation.transitions : implementation.literals;
    const tested = category.key === 'transitions' ? tests.transitions : tests.literals;
    return {
      key: category.key,
      milestone: category.milestone,
      title: category.title,
      total: category.references.length,
      implemented: countMatches(category.references, implemented),
      tested: countMatches(category.references, tested),
    };
  });

  const discrepancies: Discrepancy[] = [];
  for (const [id, locations] of source.literalLocations) {
    if (ID_SHAPE.test(id) && !catalog.knownIds.has(id)) {
      discrepancies.push({ kind: 'ID', reference: id, locations: [...locations].sort(compare) });
    }
  }
  const expectedTransitions = new Set(catalog.transitions.map(transitionKey));
  for (const [key, locations] of source.transitionLocations) {
    if (!expectedTransitions.has(key)) {
      discrepancies.push({
        kind: 'Переход',
        reference: key,
        locations: [...locations].sort(compare),
      });
    }
  }
  discrepancies.sort(
    (left, right) => compare(left.kind, right.kind) || compare(left.reference, right.reference),
  );

  return {
    categories,
    domains: groupForms(
      catalog.forms,
      implementation.literals,
      tests.literals,
      (form) => form.domain,
      true,
    ),
    types: groupForms(
      catalog.forms,
      implementation.literals,
      tests.literals,
      (form) => form.type,
      false,
    ),
    discrepancies,
  };
}

function percent(value: number, total: number): string {
  if (total === 0) return '—';
  return `${(Math.round((value / total) * 1000) / 10).toFixed(1).replace(/\.0$/, '')} %`;
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export async function renderReport(model: CoverageModel): Promise<string> {
  const lines: string[] = [
    '# Матрица трассируемости',
    '',
    '> **Сгенерированный файл.** Обновляется командой `npm run traceability`; ручные',
    '> изменения будут перезаписаны.',
    '>',
    '> **Что считается ссылкой.** Только строковый литерал, целиком совпадающий с',
    '> каноническим ID или ключом из `generated/spec`. Комментарии, имена файлов и',
    '> каталогов, а также ID внутри более длинной строки не считаются. У перехода нет',
    '> собственного ID, поэтому он засчитывается только по одному объекту с точными',
    '> строковыми полями `from`, `to`, `kind`, `trigger`; эта четвёрка уникальна в',
    '> атласе.',
    '>',
    '> **Границы.** Реализация сканируется только в нетестовых файлах `src/`.',
    '> Покрытие сканируется в `src/**/*.{test,spec}.*` и `tests/`. `generated/`,',
    '> `docs/`, `artifacts/` и весь `tools/` не являются свидетельством реализации',
    '> или покрытия приложения.',
    '',
    '- Источник ожидаемых значений: `generated/spec`',
    '',
    '## Сводка',
    '',
    '| Веха | Предмет | Всего | Реализовано | % | Покрыто тестами | % |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...model.categories.map(
      (row) =>
        `| ${row.milestone} | ${row.title} | ${String(row.total)} | ${String(row.implemented)} | ${percent(row.implemented, row.total)} | ${String(row.tested)} | ${percent(row.tested, row.total)} |`,
    ),
    '',
    '## Формы по доменам',
    '',
    '| Домен | Префикс | Всего | Реализовано | Покрыто тестами |',
    '| --- | --- | ---: | ---: | ---: |',
    ...model.domains.map(
      (row) =>
        `| ${escapeCell(row.name)} | \`${row.prefix ?? ''}\` | ${String(row.total)} | ${String(row.implemented)} | ${String(row.tested)} |`,
    ),
    '',
    '## Формы по типам',
    '',
    '| Тип | Всего | Реализовано | Покрыто тестами |',
    '| --- | ---: | ---: | ---: |',
    ...model.types.map(
      (row) =>
        `| \`${escapeCell(row.name)}\` | ${String(row.total)} | ${String(row.implemented)} | ${String(row.tested)} |`,
    ),
    '',
    '## Расхождения',
    '',
  ];
  if (model.discrepancies.length === 0) {
    lines.push('Расхождений не найдено.');
  } else {
    lines.push(
      '| Вид | Ссылка из `src/` | Расположение |',
      '| --- | --- | --- |',
      ...model.discrepancies.map(
        (item) =>
          `| ${item.kind} | \`${escapeCell(item.reference)}\` | ${item.locations.map((location) => `\`${location}\``).join(', ')} |`,
      ),
    );
  }
  return format(`${lines.join('\n')}\n`, { parser: 'markdown', endOfLine: 'lf' });
}
