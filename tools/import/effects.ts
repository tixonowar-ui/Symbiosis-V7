/**
 * Effects and Diseases Registry v1.2 → generated/spec/effects and
 * generated/types/effects.ts.
 *
 * Senior domain registry (ADR 0003, level 4). Frozen by bytes in the delivery
 * manifest and forward-compatible with the current line (ADR 0007), so the
 * import treats its own control sheet as the authority on whether it is
 * internally consistent.
 */
import { join } from 'node:path';
import { banner, tsUnion, writeJson, writeText } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { ARTIFACT, SPEC_DIR, TYPES_DIR } from './lib/paths.js';
import { Workbook } from './lib/workbook.js';

const WHERE = 'effects';
const SOURCE = 'artifacts/registries/Symbiosis_V7_Effects_and_Diseases_Registry_v1.2.xlsx';
const CONTROL_PASS = 'PASS';

/** The single effect type the registry excludes from runtime — see ADR 0011. */
const NOT_MODELED_ID = 'EFF-SENSE-BLINDNESS';
const NOT_MODELED = 'NOT_MODELED';
const EXCLUDED_FROM_RUNTIME = 'EXCLUDED_FROM_RUNTIME';

const GATE = {
  sheet: '20_Контроль',
  headerRow: 2,
  key: 'ControlID',
  result: 'Result',
  rows: 24,
} as const;

const S = {
  families: '01_Семейства',
  types: '02_Типы_эффектов',
  sourceMap: '06_Карта_источников',
  combinations: '07_Правила_сочетаний',
  matrix: '08_Матрица_семейств',
  payloads: '18_Payload_JSON',
} as const;

const TABLES = [
  { sheet: S.families, out: 'families.json', key: 'FamilyCode', rows: 24 },
  { sheet: S.types, out: 'effect-types.json', key: 'EffectTypeID', rows: 67 },
  { sheet: '03_Болезни', out: 'diseases.json', key: 'DiseaseID', rows: 10 },
  { sheet: '04_Яды', out: 'poisons.json', key: 'PoisonProfileID', rows: 8 },
  { sheet: '05_Травмы_и_раны', out: 'injuries.json', key: 'InjuryID', rows: 8 },
  { sheet: S.sourceMap, out: 'source-map.json', key: 'SourceMapID', rows: 306 },
  { sheet: S.combinations, out: 'combination-rules.json', key: 'CombinationRuleID', rows: 67 },
  { sheet: S.matrix, out: 'family-matrix.json', key: 'PairID', rows: 300 },
  {
    sheet: '09_Профили_дееспособности',
    out: 'capability-profiles.json',
    key: 'ProfileID',
    rows: 21,
  },
  { sheet: '10_Иммунитеты', out: 'immunities.json', key: 'ResponseProfileID', rows: 20 },
  { sheet: '11_Таймеры_порядок', out: 'timer-policies.json', key: 'PolicyID', rows: 21 },
  { sheet: '12_Runtime_контракты', out: 'runtime-contracts.json', key: 'Entity', rows: 69 },
  { sheet: '13_Операции', out: 'operations.json', key: 'OperationID', rows: 25 },
  { sheet: '14_Пробелы_и_решения', out: 'gaps.json', key: 'GapID', rows: 34 },
  { sheet: '15_Трассировка', out: 'trace.json', key: 'TraceID', rows: 28 },
  { sheet: '16_QA', out: 'qa.json', key: 'ScenarioID', rows: 98 },
  { sheet: '17_Справочники', out: 'dictionaries.json', key: 'Dictionary', rows: 89 },
  { sheet: S.payloads, out: 'payloads.json', key: 'PayloadID', rows: 185 },
  { sheet: '19_Зависимости', out: 'dependencies.json', key: 'Файл', rows: 9 },
] as const;

/**
 * `00_Паспорт` is not imported: it lays three `Параметр | Значение | Статус`
 * groups side by side in one header row, so its column names repeat. The record
 * reader refuses duplicate columns rather than silently keeping the last one,
 * and `20_Контроль` already carries the registry's self-check.
 */
const NOT_A_TABLE = ['00_Паспорт'] as const;

/** Payload rows per entity type must match the sheet each type comes from. */
const PAYLOAD_EXPECTED: readonly (readonly [string, number])[] = [
  ['EffectDefinition', 67],
  ['CombinationRule', 67],
  ['EffectFamily', 24],
  ['DiseaseDefinition', 10],
  ['PoisonProfile', 8],
  ['InjuryDefinition', 8],
  ['RuntimeSchema', 1],
];

export interface EffectsImport {
  readonly effectTypes: number;
  readonly modeled: number;
  readonly notModeled: number;
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

export async function importEffects(ruleCatalogue: ReadonlySet<string>): Promise<EffectsImport> {
  const book = Workbook.open(ARTIFACT.effects, WHERE);

  for (const sheet of NOT_A_TABLE) {
    if (!book.sheetNames.includes(sheet)) {
      fail(WHERE, `sheet ${JSON.stringify(sheet)} is listed as skipped but no longer exists`);
    }
  }

  // --- gate ---------------------------------------------------------------
  const control = book.table(GATE.sheet, GATE.headerRow, [GATE.key, GATE.result]).records(GATE.key);
  expectCount(WHERE, `${GATE.sheet} rows`, control.length, GATE.rows);
  const failures = control.filter((row) => text(row, GATE.result) !== CONTROL_PASS);
  if (failures.length > 0) {
    fail(
      WHERE,
      `${GATE.sheet}: ${String(failures.length)} row(s) do not report ${CONTROL_PASS}: ` +
        failures
          .slice(0, 5)
          .map((row) => `${text(row, GATE.key)} → ${text(row, GATE.result)}`)
          .join('; '),
    );
  }

  // --- tables -------------------------------------------------------------
  const collected = new Map<string, JsonObject[]>();
  const dir = join(SPEC_DIR, 'effects');
  let bytes = 0;
  const files: string[] = [];

  for (const table of TABLES) {
    const rows = book.table(table.sheet, 2, [table.key]).records(table.key);
    expectCount(WHERE, `${table.sheet} rows`, rows.length, table.rows);
    collected.set(table.sheet, rows);
    bytes += await writeJson(join(dir, table.out), rows);
    files.push(`generated/spec/effects/${table.out}`);
  }

  // --- referential integrity ----------------------------------------------
  //
  // Family codes are checked; rule references are not. "Rule refs" columns hold
  // multi-valued strings with range notation ("CORE-155–156; CQA-001"), and
  // 10_Иммунитеты/"Effect family" uses a broader vocabulary (POISON, FIRE)
  // rather than FamilyCode. Resolving either would mean inventing a convention.
  const families = new Set((collected.get(S.families) ?? []).map((row) => text(row, 'FamilyCode')));
  assertFamilies(collected.get(S.types) ?? [], 'FamilyCode', families, S.types);
  assertFamilies(collected.get(S.combinations) ?? [], 'Left family', families, S.combinations);
  assertFamilies(collected.get(S.matrix) ?? [], 'Left family', families, S.matrix);
  assertFamilies(collected.get(S.matrix) ?? [], 'Right family', families, S.matrix);

  // The source map holds one plain Rule ID per row, so it resolves cleanly.
  (collected.get(S.sourceMap) ?? []).forEach((row, index) => {
    const ruleId = text(row, 'Rule ID');
    if (!ruleCatalogue.has(ruleId)) {
      fail(
        WHERE,
        `${S.sourceMap}[${String(index)}]: rule ${JSON.stringify(ruleId)} ` +
          'is not in the Executable Rules catalogue',
      );
    }
  });

  // Payload catalogue must account for every entity the registry defines.
  const payloadCounts = new Map<string, number>();
  for (const row of collected.get(S.payloads) ?? []) {
    const kind = text(row, 'EntityType');
    payloadCounts.set(kind, (payloadCounts.get(kind) ?? 0) + 1);
  }
  for (const [kind, expected] of PAYLOAD_EXPECTED) {
    expectCount(WHERE, `payloads of ${kind}`, payloadCounts.get(kind) ?? 0, expected);
  }
  expectCount(WHERE, 'payload entity types', payloadCounts.size, PAYLOAD_EXPECTED.length);

  const types = collected.get(S.types) ?? [];
  const { modeled, notModeled } = assertAdr0011(types);

  bytes += await writeJson(join(dir, 'meta.json'), {
    source: SOURCE,
    registryVersion: 'v1.2',
    effectTypes: types.length,
    modeledEffectTypes: modeled.length,
    notModeledEffectTypes: notModeled.length,
    families: families.size,
    sourceMapRows: (collected.get(S.sourceMap) ?? []).length,
    gateAllPass: true,
    skippedSheets: [...NOT_A_TABLE],
  });
  files.push('generated/spec/effects/meta.json');

  bytes += await writeText(
    join(TYPES_DIR, 'effects.ts'),
    renderTypes(collected, modeled, notModeled),
  );
  files.push('generated/types/effects.ts');

  return {
    effectTypes: types.length,
    modeled: modeled.length,
    notModeled: notModeled.length,
    bytesWritten: bytes,
    files,
  };
}

function assertFamilies(
  rows: readonly JsonObject[],
  column: string,
  families: ReadonlySet<string>,
  sheet: string,
): void {
  rows.forEach((row, index) => {
    const code = text(row, column);
    if (code === '') return;
    if (!families.has(code)) {
      fail(WHERE, `${sheet}[${String(index)}]: unknown ${column} ${JSON.stringify(code)}`);
    }
  });
}

/**
 * ADR 0011 records that `NOT_MODELED` is a deliberate refusal, not a gap, and
 * that exactly one effect type carries it. The atlas agrees: 66 modeled types
 * and 1 excluded. This ties all three together — if a delivery starts modelling
 * blindness, or excludes something else, the import stops.
 */
export function assertAdr0011(types: readonly JsonObject[]): {
  modeled: JsonObject[];
  notModeled: JsonObject[];
} {
  const notModeled = types.filter((t) => text(t, 'Automation') === NOT_MODELED);
  const modeled = types.filter((t) => text(t, 'Automation') !== NOT_MODELED);

  expectCount(WHERE, `effect types marked ${NOT_MODELED}`, notModeled.length, 1);
  expectCount(WHERE, 'modeled effect types', modeled.length, 66);

  const excluded = notModeled[0]!;
  const id = text(excluded, 'EffectTypeID');
  if (id !== NOT_MODELED_ID) {
    fail(
      WHERE,
      `the excluded effect type is ${JSON.stringify(id)}, but ADR 0011 records ` +
        `${JSON.stringify(NOT_MODELED_ID)}. Revisit the ADR before importing.`,
    );
  }
  const schema = text(excluded, 'Schema status');
  if (schema !== EXCLUDED_FROM_RUNTIME) {
    fail(
      WHERE,
      `${id} has schema status ${JSON.stringify(schema)}, expected ` +
        `${JSON.stringify(EXCLUDED_FROM_RUNTIME)}. ADR 0011 depends on it staying out of runtime.`,
    );
  }

  return { modeled, notModeled };
}

function renderTypes(
  collected: ReadonlyMap<string, JsonObject[]>,
  modeled: readonly JsonObject[],
  notModeled: readonly JsonObject[],
): string {
  const codes = (sheet: string, column: string): string[] =>
    [...new Set((collected.get(sheet) ?? []).map((r) => text(r, column)))]
      .filter((v) => v !== '')
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const ids = (rows: readonly JsonObject[]): string[] => rows.map((r) => text(r, 'EffectTypeID'));

  return [
    banner(SOURCE),
    '',
    tsUnion('EffectTypeId', codes(S.types, 'EffectTypeID'), '67 effect types: 66 modeled, 1 not.'),
    '',
    tsUnion('EffectFamilyCode', codes(S.families, 'FamilyCode')),
    '',
    tsUnion('DiseaseId', codes('03_Болезни', 'DiseaseID')),
    '',
    tsUnion('PoisonProfileId', codes('04_Яды', 'PoisonProfileID')),
    '',
    tsUnion('InjuryId', codes('05_Травмы_и_раны', 'InjuryID')),
    '',
    tsUnion('EffectAutomation', codes(S.types, 'Automation')),
    '',
    tsUnion('EffectSchemaStatus', codes(S.types, 'Schema status')),
    '',
    tsUnion('EffectOperationId', codes('13_Операции', 'OperationID')),
    '',
    '/** Effect types the engine models. */',
    'export const MODELED_EFFECT_TYPE_IDS: readonly EffectTypeId[] = [',
    ...ids(modeled).map((id) => `  ${JSON.stringify(id)},`),
    '];',
    '',
    '/**',
    ' * Effect types deliberately left unmodelled. These are refusals, not gaps:',
    ' * they carry no runtime state and must not be rendered as active.',
    ' * See docs/adr/0011-not-modeled-stays-tombstone.md.',
    ' */',
    'export const NOT_MODELED_EFFECT_TYPE_IDS: readonly EffectTypeId[] = [',
    ...ids(notModeled).map((id) => `  ${JSON.stringify(id)},`),
    '];',
    '',
  ].join('\n');
}
