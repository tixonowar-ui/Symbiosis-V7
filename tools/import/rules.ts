/**
 * Executable Rules Registry v1.7 → generated/spec/rules + generated/types/rules.ts.
 *
 * The senior source of mechanics (ADR 0003, level 4). Everything downstream —
 * Character, Items, Effects, Bestiary — references its Rule IDs, so this import
 * runs first and refuses to emit a catalogue the other registries could not
 * safely point into.
 *
 * Rule texts are carried across as data. Turning "Итоговый алгоритм" into
 * executable code is M3, and each rule needs its own decision there.
 */
import { join } from 'node:path';
import { banner, tsUnion, writeJson, writeText } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { ARTIFACT, SPEC_DIR, TYPES_DIR } from './lib/paths.js';
import { Workbook } from './lib/workbook.js';

const WHERE = 'rules';
const SOURCE = 'artifacts/registries/Symbiosis_V7_Executable_Rules_Registry_v1.7.xlsx';

const SHEET = {
  rules: 'Реестр правил',
  parameters: 'Параметры',
  links: 'Связи',
  sources: 'Источники',
  dictionaries: 'Справочники',
  control: 'Контроль',
} as const;

/**
 * Control values the audit states about this registry: CHK-001 739 cards,
 * CHK-002 699 active. The remaining 40 are tombstones.
 */
const EXPECTED = {
  cards: 739,
  active: 699,
  tombstone: 40,
  parameters: 4621,
  links: 876,
  sources: 739,
  dictionaries: 250,
  control: 99,
} as const;

const COLUMN = {
  ruleId: 'Rule ID',
  status: 'Статус',
  mode: 'Режим реализации',
  kind: 'Тип правила',
  parameterId: 'Parameter ID',
  linkSource: 'Source Rule ID',
  linkKind: 'Тип связи',
  linkTarget: 'Target Rule ID',
  dictGroup: 'Группа',
  controlCheck: 'Проверка',
  controlExpected: 'Ожидается',
  controlActual: 'Фактически',
  controlResult: 'Результат',
} as const;

/**
 * Status and implementation mode are two columns saying the same thing. They are
 * checked as a pair: a card claiming to be active while excluded from the game
 * core (or the reverse) is a contradiction in the source, not a case to resolve.
 */
const STATUS_MODE: ReadonlyMap<string, string> = new Map([
  ['Активно', 'Реализовать в игровом ядре'],
  ['Не автоматизируется', 'Не реализовывать в Windows-приложении'],
]);

const STATUS_ACTIVE = 'Активно';
const CONTROL_PASS = 'PASS';

export interface RulesImport {
  readonly activeIds: readonly string[];
  readonly tombstoneIds: readonly string[];
  readonly bytesWritten: number;
  readonly files: readonly string[];
}

/**
 * A cell as text. Registry cells are scalars; a nested value would mean the
 * reader changed shape underneath us, so it is refused rather than stringified
 * into `[object Object]`.
 */
function text(record: JsonObject, column: string): string {
  const value = record[column];
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fail(WHERE, `column ${JSON.stringify(column)} holds a non-scalar value`);
}

export async function importRules(): Promise<RulesImport> {
  const book = Workbook.open(ARTIFACT.rules, WHERE);

  // --- the registry must first agree with its own control sheet -----------
  const control = book.table(SHEET.control, 0, [
    COLUMN.controlCheck,
    COLUMN.controlExpected,
    COLUMN.controlActual,
    COLUMN.controlResult,
  ]);
  const controlRows = control.records(COLUMN.controlCheck);
  expectCount(WHERE, 'control rows', controlRows.length, EXPECTED.control);

  const controlFailures = controlRows.filter(
    (row) => text(row, COLUMN.controlResult) !== CONTROL_PASS,
  );
  if (controlFailures.length > 0) {
    const names = controlFailures
      .slice(0, 5)
      .map((row) => {
        const check = text(row, COLUMN.controlCheck);
        const expected = text(row, COLUMN.controlExpected);
        const actual = text(row, COLUMN.controlActual);
        return `${check} (expected ${expected}, got ${actual})`;
      })
      .join('; ');
    fail(
      WHERE,
      `${String(controlFailures.length)} control row(s) do not report ${CONTROL_PASS}: ${names}. ` +
        'The registry contradicts itself; importing it would emit wrong data.',
    );
  }

  // --- rule cards ---------------------------------------------------------
  const rulesTable = book.table(SHEET.rules, 0, [
    COLUMN.ruleId,
    COLUMN.status,
    COLUMN.mode,
    COLUMN.kind,
  ]);
  const rules = rulesTable.records(COLUMN.ruleId);
  expectCount(WHERE, 'rule cards', rules.length, EXPECTED.cards);

  const catalogue = new Set<string>();
  const activeIds: string[] = [];
  const tombstoneIds: string[] = [];

  rules.forEach((rule, index) => {
    const at = `${SHEET.rules}[${String(index)}]`;
    const id = text(rule, COLUMN.ruleId);
    if (catalogue.has(id)) fail(WHERE, `${at}: duplicate Rule ID ${JSON.stringify(id)}`);
    catalogue.add(id);

    const status = text(rule, COLUMN.status);
    const expectedMode = STATUS_MODE.get(status);
    if (expectedMode === undefined) {
      fail(
        WHERE,
        `${at}: unknown status ${JSON.stringify(status)} for rule ${id}. ` +
          `Known: ${[...STATUS_MODE.keys()].map((s) => JSON.stringify(s)).join(', ')}`,
      );
    }
    const mode = text(rule, COLUMN.mode);
    if (mode !== expectedMode) {
      fail(
        WHERE,
        `${at}: rule ${id} has status ${JSON.stringify(status)} but mode ${JSON.stringify(mode)}; ` +
          `expected ${JSON.stringify(expectedMode)}`,
      );
    }

    (status === STATUS_ACTIVE ? activeIds : tombstoneIds).push(id);
  });

  expectCount(WHERE, 'active rules', activeIds.length, EXPECTED.active);
  expectCount(WHERE, 'tombstone rules', tombstoneIds.length, EXPECTED.tombstone);
  if (activeIds.length + tombstoneIds.length !== catalogue.size) {
    fail(WHERE, 'active and tombstone sets do not partition the catalogue');
  }

  // --- everything else must point into the catalogue ----------------------
  const parameters = book
    .table(SHEET.parameters, 0, [COLUMN.parameterId, COLUMN.ruleId])
    .records(COLUMN.parameterId);
  expectCount(WHERE, 'parameters', parameters.length, EXPECTED.parameters);
  assertReferences(parameters, [COLUMN.ruleId], catalogue, SHEET.parameters);

  const links = book
    .table(SHEET.links, 0, [COLUMN.linkSource, COLUMN.linkKind, COLUMN.linkTarget])
    .records(COLUMN.linkSource);
  expectCount(WHERE, 'links', links.length, EXPECTED.links);
  assertReferences(links, [COLUMN.linkSource, COLUMN.linkTarget], catalogue, SHEET.links);

  const sources = book.table(SHEET.sources, 0, [COLUMN.ruleId]).records(COLUMN.ruleId);
  expectCount(WHERE, 'source rows', sources.length, EXPECTED.sources);
  assertReferences(sources, [COLUMN.ruleId], catalogue, SHEET.sources);

  const dictionaries = book
    .table(SHEET.dictionaries, 0, [COLUMN.dictGroup])
    .records(COLUMN.dictGroup);
  expectCount(WHERE, 'dictionary rows', dictionaries.length, EXPECTED.dictionaries);

  // --- emit ---------------------------------------------------------------
  const dir = join(SPEC_DIR, 'rules');
  let bytes = 0;
  const files: string[] = [];
  const emit = async (name: string, value: JsonObject[] | JsonObject): Promise<void> => {
    bytes += await writeJson(join(dir, name), value);
    files.push(`generated/spec/rules/${name}`);
  };

  await emit('meta.json', {
    source: SOURCE,
    registryVersion: 'v1.7',
    cards: rules.length,
    active: activeIds.length,
    tombstone: tombstoneIds.length,
    parameters: parameters.length,
    links: links.length,
    dictionaries: dictionaries.length,
    controlRows: controlRows.length,
    controlAllPass: true,
  });
  await emit('rules.json', rules);
  await emit('parameters.json', parameters);
  await emit('links.json', links);
  await emit('sources.json', sources);
  await emit('dictionaries.json', dictionaries);

  bytes += await writeText(
    join(TYPES_DIR, 'rules.ts'),
    renderTypes({ rules, links, activeIds, tombstoneIds }),
  );
  files.push('generated/types/rules.ts');

  return { activeIds, tombstoneIds, bytesWritten: bytes, files };
}

function assertReferences(
  rows: readonly JsonObject[],
  columns: readonly string[],
  catalogue: ReadonlySet<string>,
  sheet: string,
): void {
  rows.forEach((row, index) => {
    for (const column of columns) {
      const ref = text(row, column);
      if (ref === '') {
        fail(WHERE, `${sheet}[${String(index)}]: ${column} is empty`);
      }
      if (!catalogue.has(ref)) {
        fail(
          WHERE,
          `${sheet}[${String(index)}]: ${column} points at unknown rule ${JSON.stringify(ref)}`,
        );
      }
    }
  });
}

interface RenderInput {
  readonly rules: readonly JsonObject[];
  readonly links: readonly JsonObject[];
  readonly activeIds: readonly string[];
  readonly tombstoneIds: readonly string[];
}

function renderTypes(input: RenderInput): string {
  const distinct = (rows: readonly JsonObject[], column: string): string[] =>
    [...new Set(rows.map((r) => text(r, column)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const ruleIds = input.rules.map((r) => text(r, COLUMN.ruleId));

  return [
    banner(SOURCE),
    '',
    tsUnion('RuleId', ruleIds, 'Every rule card in the registry. 739 of them.'),
    '',
    tsUnion('RuleStatus', distinct(input.rules, COLUMN.status)),
    '',
    tsUnion('RuleImplementationMode', distinct(input.rules, COLUMN.mode)),
    '',
    tsUnion('RuleKind', distinct(input.rules, COLUMN.kind)),
    '',
    // Taken verbatim from the registry. Collapsing near-synonyms such as
    // "уточняет" into "Уточняет / имеет приоритет" would be an equivalence the
    // artifact does not state — see CLAUDE.md, section 4.
    tsUnion(
      'RuleLinkKind',
      distinct(input.links, COLUMN.linkKind),
      'Link kinds exactly as the registry spells them; no normalisation.',
    ),
    '',
    '/** Rules the game core implements. */',
    'export const ACTIVE_RULE_IDS: readonly RuleId[] = [',
    ...input.activeIds.map((id) => `  ${JSON.stringify(id)},`),
    '];',
    '',
    '/**',
    ' * Rules that are deliberately not automated. These are refusals, not gaps:',
    ' * the engine answers "rule X exists and is not automated" rather than',
    ' * "no such rule". See docs/adr/0011-not-modeled-stays-tombstone.md.',
    ' */',
    'export const TOMBSTONE_RULE_IDS: readonly RuleId[] = [',
    ...input.tombstoneIds.map((id) => `  ${JSON.stringify(id)},`),
    '];',
    '',
  ].join('\n');
}
