/**
 * `24_XP_Runtime` — Symbiont XP Runtime Contract v1.2.
 *
 * This sheet is nine stacked sections, each with its own header row and its own
 * columns. The single-header reader used for every other sheet would silently
 * produce nonsense here, so the sections are enumerated by title.
 *
 * Detecting them by shape is not an option: sections A–G write their title
 * across every column (merged cells) while H and I write it only in the first,
 * so any "banner row" heuristic drops two sections without saying so.
 */
import { join } from 'node:path';
import { banner, tsUnion, writeJson, writeText } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { SPEC_DIR, TYPES_DIR } from './lib/paths.js';
import { Table, type Workbook } from './lib/workbook.js';

const WHERE = 'character/24_XP_Runtime';
const SHEET = '24_XP_Runtime';
const SOURCE =
  'artifacts/registries/Symbiosis_V7_Character_Skills_Symbionts_Registry_v1.2.xlsx#24_XP_Runtime';

interface SectionSpec {
  readonly title: string;
  readonly out: string;
  readonly key: string;
  readonly rows: number;
}

/** Declared in sheet order. A missing title or a reordering stops the import. */
const SECTIONS: readonly SectionSpec[] = [
  { title: 'A. Progression routes', out: 'progression-routes.json', key: 'RouteCode', rows: 3 },
  { title: 'B. Event points', out: 'event-points.json', key: 'PointPolicyID', rows: 7 },
  { title: 'C. Roll-kind policy', out: 'roll-kinds.json', key: 'RollKind', rows: 11 },
  {
    title: 'D. Never-progression sources',
    out: 'never-sources.json',
    key: 'NeverSourceCode',
    rows: 8,
  },
  { title: 'E. Race multipliers', out: 'race-multipliers.json', key: 'RaceCode', rows: 3 },
  {
    title: 'F. Suppression: effectsEnabled ≠ xpEligible',
    out: 'suppression.json',
    key: 'PolicyID',
    rows: 3,
  },
  { title: 'G. SymbiontXpEvent fields', out: 'xp-event-fields.json', key: 'Field', rows: 19 },
  {
    title: 'H. Immutable GM direct XP policy',
    out: 'gm-direct-policy.json',
    key: 'PolicyID',
    rows: 1,
  },
  { title: 'I. MasterSymbiontXpAward fields', out: 'gm-award-fields.json', key: 'Field', rows: 11 },
];

export interface XpRuntimeImport {
  readonly sections: number;
  readonly dataRows: number;
  readonly bytesWritten: number;
  readonly files: readonly string[];
}

function text(record: JsonObject, column: string): string {
  const value = record[column];
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fail(WHERE, `column ${JSON.stringify(column)} holds a non-scalar value`);
}

function find(record: readonly JsonObject[], key: string, value: string): JsonObject {
  const hit = record.find((row) => text(row, key) === value);
  if (hit === undefined) {
    fail(WHERE, `no row where ${key} = ${JSON.stringify(value)}`);
  }
  return hit;
}

export async function importXpRuntime(book: Workbook): Promise<XpRuntimeImport> {
  const { rows } = book.sheet(SHEET);
  const first = (index: number): string => {
    const cell = rows[index]?.[0];
    return typeof cell === 'string'
      ? cell.trim()
      : cell === null || cell === undefined
        ? ''
        : String(cell);
  };

  // Locate every declared section, in order.
  const starts: number[] = [];
  let cursor = 0;
  for (const section of SECTIONS) {
    let found = -1;
    for (let i = cursor; i < rows.length; i++) {
      if (first(i) === section.title) {
        found = i;
        break;
      }
    }
    if (found < 0) {
      fail(
        WHERE,
        `section ${JSON.stringify(section.title)} not found after row ${String(cursor)}. ` +
          'The sheet layout changed; the section map needs updating.',
      );
    }
    starts.push(found);
    cursor = found + 1;
  }

  const collected = new Map<string, JsonObject[]>();
  const dir = join(SPEC_DIR, 'character', 'xp-runtime');
  let bytes = 0;
  let dataRows = 0;
  const files: string[] = [];

  for (const [index, section] of SECTIONS.entries()) {
    const start = starts[index]!;
    const headerIndex = start + 1;
    const end = index + 1 < starts.length ? starts[index + 1]! : rows.length;

    const header = rows[headerIndex];
    if (header === undefined) {
      fail(WHERE, `section ${JSON.stringify(section.title)} has no header row`);
    }
    const columns = header.map((c) => (c === null ? '' : String(c).trim()));
    if (!columns.includes(section.key)) {
      fail(
        WHERE,
        `section ${JSON.stringify(section.title)}: key column ${JSON.stringify(section.key)} ` +
          `not in header: ${columns.filter((c) => c !== '').join(' | ')}`,
      );
    }

    const table = new Table(`${WHERE}/${section.title}`, columns, rows.slice(headerIndex + 1, end));
    const records = table.records(section.key);
    expectCount(WHERE, `rows in ${JSON.stringify(section.title)}`, records.length, section.rows);

    collected.set(section.title, records);
    dataRows += records.length;
    bytes += await writeJson(join(dir, section.out), records);
    files.push(`generated/spec/character/xp-runtime/${section.out}`);
  }

  assertAdr0004(collected);

  bytes += await writeText(join(TYPES_DIR, 'character-xp.ts'), renderTypes(collected));
  files.push('generated/types/character-xp.ts');

  return { sections: SECTIONS.length, dataRows, bytesWritten: bytes, files };
}

/**
 * ADR 0004 states that a committed GM XP award is irreversible and that the FREE
 * race multiplier is 2. Those claims live in a document; this ties them back to
 * the artifact they were taken from. If a future delivery changes either, the
 * import stops and the ADR has to be revisited rather than quietly diverging.
 */
export function assertAdr0004(collected: ReadonlyMap<string, JsonObject[]>): void {
  const races = collected.get('E. Race multipliers') ?? [];
  const free = find(races, 'RaceCode', 'FREE');
  const multiplier = text(free, 'DirectXpMultiplier');
  if (multiplier !== '2') {
    fail(
      WHERE,
      `FREE DirectXpMultiplier is ${JSON.stringify(multiplier)}, but ADR 0004 records 2. ` +
        'Update docs/adr/0004-gm-xp-award-is-irreversible.md before importing.',
    );
  }

  const awardFields = collected.get('I. MasterSymbiontXpAward fields') ?? [];
  const immutable = find(awardFields, 'Field', 'immutable');
  const constraint = text(immutable, 'Validation / constraint');
  if (!constraint.includes('no inverse command')) {
    fail(
      WHERE,
      `MasterSymbiontXpAward.immutable no longer states "no inverse command" ` +
        `(got ${JSON.stringify(constraint)}). ADR 0004 depends on this.`,
    );
  }
}

function renderTypes(collected: ReadonlyMap<string, JsonObject[]>): string {
  const codes = (section: string, column: string): string[] =>
    [...new Set((collected.get(section) ?? []).map((r) => text(r, column)))]
      .filter((v) => v !== '')
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return [
    banner(SOURCE),
    '',
    tsUnion(
      'XpProgressionRoute',
      codes('A. Progression routes', 'RouteCode'),
      'Where a natural 1/20 is routed.',
    ),
    '',
    tsUnion('XpPointPolicyId', codes('B. Event points', 'PointPolicyID')),
    '',
    tsUnion('XpRollKind', codes('C. Roll-kind policy', 'RollKind')),
    '',
    tsUnion(
      'XpNeverSourceCode',
      codes('D. Never-progression sources', 'NeverSourceCode'),
      'Conditions that never produce progression.',
    ),
    '',
    tsUnion(
      'XpSuppressionPolicyId',
      codes('F. Suppression: effectsEnabled ≠ xpEligible', 'PolicyID'),
    ),
    '',
  ].join('\n');
}
