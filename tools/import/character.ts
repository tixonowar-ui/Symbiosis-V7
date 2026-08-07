/**
 * Character / Skills / Symbionts Registry v1.2 → generated/spec/character
 * and generated/types/character.ts.
 *
 * Senior domain registry (ADR 0003, level 4). Supplies stats, races, classes,
 * skills, symbionts, development nodes, abilities and the 1144-row payload
 * catalogue the seed will be built from.
 */
import { join } from 'node:path';
import { importXpRuntime } from './character-xp.js';
import { banner, tsUnion, writeJson, writeText } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { ARTIFACT, SPEC_DIR, TYPES_DIR } from './lib/paths.js';
import { Workbook } from './lib/workbook.js';

const WHERE = 'character';
const SOURCE = 'artifacts/registries/Symbiosis_V7_Character_Skills_Symbionts_Registry_v1.2.xlsx';
const CONTROL_PASS = 'PASS';

/**
 * The registry carries two independent self-checks — a passport and a control
 * sheet. Both are gates: the audit records 0 FAIL across the workbook
 * (CHK-009, AUD-027), so any row that is not PASS means the source contradicts
 * itself and must not be imported.
 */
const GATE = [
  { sheet: '00_Паспорт', headerRow: 2, key: 'Метрика', result: 'Проверка', rows: 21 },
  { sheet: '22_Контроль', headerRow: 2, key: 'Проверка', result: 'Результат', rows: 48 },
] as const;

/**
 * Sheets emitted to generated/spec/character, with the row count each must
 * yield. Counts come from the artifact itself; the audit pins two of them —
 * CHK-007 payload 1144, CHK-008 QA 51 — and the atlas pins abilities at 167.
 */
const TABLES = [
  { sheet: '01_Характеристики', out: 'stats.json', headerRow: 2, key: 'StatCode', rows: 7 },
  { sheet: '02_Расы', out: 'races.json', headerRow: 2, key: 'RaceCode', rows: 3 },
  { sheet: '03_Классы', out: 'classes.json', headerRow: 2, key: 'ClassCode', rows: 3 },
  { sheet: '04_Навыки', out: 'skills.json', headerRow: 2, key: 'SkillID', rows: 45 },
  {
    sheet: '05_Требования_навыков',
    out: 'skill-requirements.json',
    headerRow: 2,
    key: 'RequirementID',
    rows: 84,
  },
  {
    sheet: '06_Модификаторы_персонажа',
    out: 'modifiers.json',
    headerRow: 2,
    key: 'ModifierID',
    rows: 43,
  },
  { sheet: '07_Симбионты', out: 'symbionts.json', headerRow: 2, key: 'SpeciesKey', rows: 74 },
  {
    sheet: '08_Уровни_симбионтов',
    out: 'symbiont-levels.json',
    headerRow: 2,
    key: 'LevelProfileID',
    rows: 144,
  },
  {
    sheet: '09_Узлы_развития',
    out: 'development-nodes.json',
    headerRow: 2,
    key: 'NodeRef',
    rows: 182,
  },
  { sheet: '10_Способности', out: 'abilities.json', headerRow: 2, key: 'AbilityID', rows: 167 },
  {
    sheet: '11_Контексты_способностей',
    out: 'ability-contexts.json',
    headerRow: 2,
    key: 'AbilityContextID',
    rows: 334,
  },
  {
    sheet: '12_Несовместимости',
    out: 'incompatibilities.json',
    headerRow: 2,
    key: 'ConflictID',
    rows: 9,
  },
  {
    sheet: '13_Генерируемые_объекты',
    out: 'generated-objects.json',
    headerRow: 2,
    key: 'GeneratedObjectTypeID',
    rows: 1,
  },
  {
    sheet: '14_Контракты_Runtime',
    out: 'runtime-contracts.json',
    headerRow: 3,
    key: 'ContractKey',
    rows: 71,
  },
  { sheet: '15_Операции', out: 'operations.json', headerRow: 2, key: 'OperationID', rows: 16 },
  {
    sheet: '16_Отбор_автоматизации',
    out: 'automation-selection.json',
    headerRow: 2,
    key: 'CandidateRuleID',
    rows: 182,
  },
  {
    sheet: '17_Трассировка_правил',
    out: 'rule-trace.json',
    headerRow: 2,
    key: 'Rule ID',
    rows: 291,
  },
  { sheet: '18_Справочники', out: 'dictionaries.json', headerRow: 2, key: 'Dictionary', rows: 151 },
  { sheet: '19_Источники', out: 'sources.json', headerRow: 2, key: 'Source ID', rows: 9 },
  { sheet: '20_Payload_JSON', out: 'payloads.json', headerRow: 2, key: 'EntityKind', rows: 1144 },
  {
    sheet: '21_QA_совместимость',
    out: 'qa.json',
    headerRow: 2,
    key: 'Scenario ID',
    rows: 51,
  },
] as const;

export interface CharacterImport {
  readonly payloads: number;
  readonly xpSections: number;
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

export async function importCharacter(
  ruleCatalogue: ReadonlySet<string>,
): Promise<CharacterImport> {
  const book = Workbook.open(ARTIFACT.character, WHERE);

  // --- the registry must agree with both of its own self-checks -----------
  for (const gate of GATE) {
    const rows = book.table(gate.sheet, gate.headerRow, [gate.key, gate.result]).records(gate.key);
    expectCount(WHERE, `${gate.sheet} rows`, rows.length, gate.rows);

    const failures = rows.filter((row) => text(row, gate.result) !== CONTROL_PASS);
    if (failures.length > 0) {
      const names = failures
        .slice(0, 5)
        .map((row) => `${text(row, gate.key)} → ${text(row, gate.result)}`)
        .join('; ');
      fail(
        WHERE,
        `${gate.sheet}: ${String(failures.length)} row(s) do not report ${CONTROL_PASS}: ${names}. ` +
          'The registry contradicts itself; importing it would emit wrong data.',
      );
    }
  }

  // --- tables -------------------------------------------------------------
  const collected = new Map<string, JsonObject[]>();
  const dir = join(SPEC_DIR, 'character');
  let bytes = 0;
  const files: string[] = [];

  for (const table of TABLES) {
    const rows = book.table(table.sheet, table.headerRow, [table.key]).records(table.key);
    expectCount(WHERE, `${table.sheet} rows`, rows.length, table.rows);
    collected.set(table.sheet, rows);

    bytes += await writeJson(join(dir, table.out), rows);
    files.push(`generated/spec/character/${table.out}`);
  }

  // --- cross-registry: rule trace must point into the rules catalogue -----
  //
  // Only this sheet is checked. 16_Отбор_автоматизации looks similar but its
  // CandidateRuleID and RulesMirrorID columns hold composite and multi-valued
  // strings ("SYM-131#MI_MI_MI", "SYM-084; SYM-085"), so they are carried as
  // data rather than resolved — splitting them would be an invented convention.
  const trace = collected.get('17_Трассировка_правил') ?? [];
  trace.forEach((row, index) => {
    const ruleId = text(row, 'Rule ID');
    if (!ruleCatalogue.has(ruleId)) {
      fail(
        WHERE,
        `17_Трассировка_правил[${String(index)}]: rule ${JSON.stringify(ruleId)} ` +
          'is not in the Executable Rules catalogue',
      );
    }
  });

  const payloads = collected.get('20_Payload_JSON') ?? [];

  // --- 24_XP_Runtime, which needs its own section-aware reader ------------
  const xp = await importXpRuntime(book);
  bytes += xp.bytesWritten;
  files.push(...xp.files);

  bytes += await writeJson(join(dir, 'meta.json'), {
    source: SOURCE,
    registryVersion: 'v1.2',
    payloads: payloads.length,
    abilities: (collected.get('10_Способности') ?? []).length,
    symbiontSpecies: (collected.get('07_Симбионты') ?? []).length,
    ruleTraceRows: trace.length,
    gatesAllPass: true,
    xpRuntimeSections: xp.sections,
    xpRuntimeRows: xp.dataRows,
  });
  files.push('generated/spec/character/meta.json');

  // --- types --------------------------------------------------------------
  bytes += await writeText(join(TYPES_DIR, 'character.ts'), renderTypes(collected));
  files.push('generated/types/character.ts');

  return { payloads: payloads.length, xpSections: xp.sections, bytesWritten: bytes, files };
}

function renderTypes(collected: ReadonlyMap<string, JsonObject[]>): string {
  const codes = (sheet: string, column: string): string[] => {
    const rows = collected.get(sheet) ?? [];
    return [...new Set(rows.map((r) => text(r, column)))]
      .filter((v) => v !== '')
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  };

  return [
    banner(SOURCE),
    '',
    tsUnion('StatCode', codes('01_Характеристики', 'StatCode'), 'Seven character stats.'),
    '',
    tsUnion('RaceCode', codes('02_Расы', 'RaceCode')),
    '',
    tsUnion('ClassCode', codes('03_Классы', 'ClassCode')),
    '',
    tsUnion('SkillId', codes('04_Навыки', 'SkillID')),
    '',
    tsUnion('SymbiontSpeciesKey', codes('07_Симбионты', 'SpeciesKey')),
    '',
    tsUnion('AbilityId', codes('10_Способности', 'AbilityID'), '167 automated abilities.'),
    '',
    tsUnion('CharacterOperationId', codes('15_Операции', 'OperationID')),
    '',
    tsUnion(
      'CharacterEntityKind',
      codes('20_Payload_JSON', 'EntityKind'),
      'Entity kinds in the 1144-row payload catalogue.',
    ),
    '',
  ].join('\n');
}
