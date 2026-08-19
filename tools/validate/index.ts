/**
 * Cross-registry validation over generated/spec.
 *
 *   npm run validate
 *
 * The import pipeline already refuses malformed artifacts (ADR 0015). This runs
 * against the *output*, and exists for a different reason: it is the check that
 * survives when someone edits `generated/` by hand, lands a partial import, or
 * changes one registry without re-running the others.
 *
 * The prompt for this repo originally called for JSON Schema per registry. That
 * does not apply here — registries are frozen xlsx, not editable JSON. This is
 * the real analogue: schema-shaped assertions over the machine-readable form.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SPEC_DIR } from '../import/lib/paths.js';
import {
  validateAtlasFormQaMirrors,
  validateChr001IdentityTextMirrors,
  validateDetailedFormIndexKeys,
  validateRendererFormCatalogue,
  validateRendererFormGraph,
} from './atlas.js';
import { validateQuestionRefs } from './question-refs.js';

interface Problem {
  readonly file: string;
  readonly id: string;
  readonly message: string;
}

const problems: Problem[] = [];

function report(file: string, id: string, message: string): void {
  problems.push({ file, id, message });
}

function load(relative: string): unknown {
  const path = join(SPEC_DIR, relative);
  if (!existsSync(path)) {
    report(relative, '-', 'file is missing; run "npm run import"');
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    report(relative, '-', `is not valid JSON: ${cause instanceof Error ? cause.message : ''}`);
    return undefined;
  }
}

function rows(relative: string): Record<string, unknown>[] {
  const value = load(relative);
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    report(relative, '-', 'expected an array of records');
    return [];
  }
  return value as Record<string, unknown>[];
}

function object(
  relative: string,
  expected = 'expected an object keyed by id',
): Record<string, unknown> | null {
  const value = load(relative);
  if (value === undefined) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    report(relative, '-', expected);
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * A cell as text. Spec cells are scalars; anything nested means the pipeline
 * changed shape, so it is reported rather than stringified into
 * `[object Object]`, which would then fail an id pattern for the wrong reason.
 */
const str = (row: Record<string, unknown>, column: string): string => {
  const value = row[column];
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return ' nested';
};

/** Every id in a catalogue must be present, unique and shaped as declared. */
function checkIds(
  file: string,
  records: readonly Record<string, unknown>[],
  column: string,
  pattern: RegExp,
): Set<string> {
  const seen = new Set<string>();
  records.forEach((row, index) => {
    const id = str(row, column);
    if (id === '') {
      report(file, `row ${String(index)}`, `${column} is empty`);
      return;
    }
    if (seen.has(id)) {
      report(file, id, `duplicate ${column}`);
      return;
    }
    if (!pattern.test(id)) {
      report(file, id, `${column} does not match ${String(pattern)}`);
    }
    seen.add(id);
  });
  return seen;
}

/** Every reference must resolve into a known catalogue. */
function checkRefs(
  file: string,
  records: readonly Record<string, unknown>[],
  column: string,
  known: ReadonlySet<string>,
  target: string,
  idColumn?: string,
): void {
  records.forEach((row, index) => {
    const ref = str(row, column);
    if (ref === '') return;
    if (!known.has(ref)) {
      const id = idColumn === undefined ? `row ${String(index)}` : str(row, idColumn);
      report(file, id, `${column} ${JSON.stringify(ref)} is not in ${target}`);
    }
  });
}

// ---------------------------------------------------------------------------

/**
 * Patterns derived from the data, not invented. Effect and family codes carry
 * underscores inside their trailing segment (`EFF-LIFE-SEVERE_WOUND`), and rule
 * prefixes are not uniformly three letters (`CORE-`, `SYM-`, `AQ2-`). A tighter
 * guess would reject valid ids — which is how this check first failed.
 */
const ID = {
  rule: /^[A-Z][A-Z0-9]{1,3}-\d{3}$/,
  form: /^[A-Z]{2,3}-\d{3}$/,
  // Most are three segments (`EFF-LIFE-DEAD`), a few are two (`EFF-FATIGUE`).
  effect: /^EFF-[A-Z][A-Z0-9_]*(?:-[A-Z][A-Z0-9_]*)*$/,
  family: /^FAM-[A-Z][A-Z0-9_]*$/,
  item: /^[A-Z]{3}-[A-Z]{3}-\d{3}$/,
  species: /^SPC-[A-Z][A-Z-]*$/,
  template: /^CBT-[A-Z][A-Z-]*$/,
  sentient: /^SENT-[A-Z]+(?:-[A-Z]+)*-\d{3}$/,
} as const;

const ruleRows = rows('rules/rules.json');
const rules = checkIds('rules/rules.json', ruleRows, 'Rule ID', ID.rule);

let expectedFormCount: number | null = null;
const atlasMeta = object('atlas/meta.json', 'expected an object');
if (atlasMeta !== null) {
  const counts = atlasMeta['counts'];
  if (typeof counts !== 'object' || counts === null || Array.isArray(counts)) {
    report('atlas/meta.json', 'counts', 'expected an object');
  } else {
    const value = (counts as Record<string, unknown>)['forms'];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      report('atlas/meta.json', 'counts.forms', 'expected a non-negative safe integer');
    } else {
      expectedFormCount = value;
    }
  }
}

let forms: ReadonlySet<string> = new Set();
const rendererFormsById = object('atlas/renderer/forms-by-id.json');
if (rendererFormsById !== null) {
  const validation = validateRendererFormCatalogue(rendererFormsById, ID.form, expectedFormCount);
  forms = validation.forms;
  validation.problems.forEach((problem) => report(problem.file, problem.id, problem.message));
}

const detailedFormsById = object('atlas/forms-by-id.json');
if (rendererFormsById !== null && detailedFormsById !== null) {
  validateDetailedFormIndexKeys(detailedFormsById, forms).forEach((problem) =>
    report(problem.file, problem.id, problem.message),
  );
}

const formRows = rows('atlas/forms.json');
const qaScenarioRows = rows('atlas/qa-scenarios.json');
validateAtlasFormQaMirrors(formRows, qaScenarioRows).forEach((problem) =>
  report(problem.file, problem.id, problem.message),
);

const effectRows = rows('effects/effect-types.json');
const effects = checkIds('effects/effect-types.json', effectRows, 'EffectTypeID', ID.effect);

const familyRows = rows('effects/families.json');
const families = checkIds('effects/families.json', familyRows, 'FamilyCode', ID.family);

const itemRows = rows('items/catalogue.json');
const items = checkIds('items/catalogue.json', itemRows, 'ItemTypeID', ID.item);

const speciesRows = rows('bestiary/species.json');
const species = checkIds('bestiary/species.json', speciesRows, 'Species ID', ID.species);

const templateRows = rows('bestiary/templates.json');
const templates = checkIds(
  'bestiary/templates.json',
  templateRows,
  'Canonical Template ID',
  ID.template,
);

const sentientRows = rows('sentient/templates.json');
const sentient = checkIds('sentient/templates.json', sentientRows, 'SystemTemplateID', ID.sentient);

// --- cross-registry references ---------------------------------------------

checkRefs(
  'rules/parameters.json',
  rows('rules/parameters.json'),
  'Rule ID',
  rules,
  'the rule catalogue',
  'Parameter ID',
);
for (const column of ['Source Rule ID', 'Target Rule ID']) {
  checkRefs('rules/links.json', rows('rules/links.json'), column, rules, 'the rule catalogue');
}
checkRefs(
  'character/rule-trace.json',
  rows('character/rule-trace.json'),
  'Rule ID',
  rules,
  'the rule catalogue',
);
checkRefs(
  'items/rule-trace.json',
  rows('items/rule-trace.json'),
  'Rule ID',
  rules,
  'the rule catalogue',
);
checkRefs(
  'effects/source-map.json',
  rows('effects/source-map.json'),
  'Rule ID',
  rules,
  'the rule catalogue',
  'SourceMapID',
);
checkRefs(
  'bestiary/rules.json',
  rows('bestiary/rules.json'),
  'Rule ID',
  rules,
  'the rule catalogue',
);

checkRefs(
  'effects/effect-types.json',
  effectRows,
  'FamilyCode',
  families,
  'the family catalogue',
  'EffectTypeID',
);
for (const column of ['Left family', 'Right family']) {
  checkRefs(
    'effects/family-matrix.json',
    rows('effects/family-matrix.json'),
    column,
    families,
    'the family catalogue',
    'PairID',
  );
}

checkRefs(
  'bestiary/templates.json',
  templateRows,
  'Species ID',
  species,
  'the species catalogue',
  'Canonical Template ID',
);
for (const file of ['bestiary/stats.json', 'bestiary/anatomy.json', 'bestiary/zone-routing.json']) {
  checkRefs(file, rows(file), 'Canonical Template ID', templates, 'the template catalogue');
}

for (const file of [
  'sentient/stats.json',
  'sentient/skills.json',
  'sentient/equipment.json',
  'sentient/arts.json',
]) {
  checkRefs(file, rows(file), 'SystemTemplateID', sentient, 'the sentient template catalogue');
}

checkRefs('items/icons.json', rows('items/icons.json'), 'ItemTypeID', items, 'the item catalogue');

let questionCodes: ReadonlySet<string> = new Set();
try {
  questionCodes = validateQuestionRefs(SPEC_DIR).questionCodes;
} catch (cause) {
  report(
    'question references',
    '-',
    cause instanceof Error ? cause.message : 'validation failed with a non-error value',
  );
}

// --- orphans ---------------------------------------------------------------

const transitionRows = rows('atlas/transitions.json');
if (rendererFormsById !== null) {
  validateRendererFormGraph(forms, transitionRows).forEach((problem) =>
    report(problem.file, problem.id, problem.message),
  );
}
validateChr001IdentityTextMirrors(formRows, rows('atlas/journeys.json'), transitionRows).forEach(
  (problem) => report(problem.file, problem.id, problem.message),
);

const speciesReferenced = new Set(templateRows.map((row) => str(row, 'Species ID')));
for (const id of species) {
  if (!speciesReferenced.has(id)) {
    report('bestiary/species.json', id, 'species is defined but never referenced');
  }
}

// --- output ----------------------------------------------------------------

if (problems.length === 0) {
  const counted = [
    ['rules', rules.size],
    ['forms', forms.size],
    ['effect types', effects.size],
    ['item types', items.size],
    ['species', species.size],
    ['sentient templates', sentient.size],
    ['question codes', questionCodes.size],
  ] as const;
  console.log('validate: OK — ' + counted.map(([what, n]) => `${String(n)} ${what}`).join(', '));
  process.exit(0);
}

console.error(`validate: ${String(problems.length)} problem(s)\n`);
for (const problem of problems.slice(0, 50)) {
  console.error(`  ${problem.file}  [${problem.id}]  ${problem.message}`);
}
if (problems.length > 50) {
  console.error(`  … and ${String(problems.length - 50)} more`);
}
console.error(
  '\ngenerated/ is pipeline output. Do not edit it by hand — fix the source ' +
    'artifact or tools/import, then run "npm run import".',
);
process.exit(1);
