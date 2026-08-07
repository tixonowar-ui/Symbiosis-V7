/**
 * Item Registry v1.6 (with icons) → generated/spec/items, generated/media/items
 * and generated/types/items.ts.
 *
 * Senior domain registry (ADR 0003, level 4). Also the first artifact carrying
 * binary payload: 64 embedded icons (CHK-010), resolved to their items through
 * the drawing anchors rather than by filename order — see lib/media.ts.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { banner, tsUnion, writeJson, writeText } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { anchoredImages } from './lib/media.js';
import { ARTIFACT, MEDIA_DIR, SPEC_DIR, TYPES_DIR } from './lib/paths.js';
import { Workbook } from './lib/workbook.js';

const WHERE = 'items';
const SOURCE = 'artifacts/registries/Symbiosis_V7_Item_Registry_v1.6_with_icons.xlsx';
const CONTROL_PASS = 'PASS';

const ICON_SHEET = '15_Иконки_предметов';
const ICON_HEADER_ROW = 3;
const EXPECTED_ICONS = 64;

const GATE = {
  sheet: '13_Контроль',
  headerRow: 2,
  key: 'Проверка',
  result: 'Статус',
  rows: 84,
} as const;

const TABLES = [
  { sheet: '01_Каталог', out: 'catalogue.json', headerRow: 2, key: 'ItemTypeID', rows: 64 },
  {
    sheet: '02_Профили_оружия',
    out: 'weapon-profiles.json',
    headerRow: 2,
    key: 'ItemTypeID',
    rows: 27,
  },
  {
    sheet: '03_Профили_брони',
    out: 'armor-profiles.json',
    headerRow: 2,
    key: 'ItemTypeID',
    rows: 8,
  },
  {
    sheet: '04_Фармацевтика',
    out: 'pharmaceuticals.json',
    headerRow: 2,
    key: 'ItemTypeID',
    rows: 14,
  },
  {
    sheet: '05_Формулы_валидации',
    out: 'formulas.json',
    headerRow: 2,
    key: 'FormulaID',
    rows: 22,
  },
  { sheet: '06_Диапазоны', out: 'formula-ranges.json', headerRow: 2, key: 'FormulaID', rows: 22 },
  {
    sheet: '07_Модель_экземпляра',
    out: 'instance-model.json',
    headerRow: 2,
    key: 'Field',
    rows: 46,
  },
  { sheet: '08_Операции', out: 'operations.json', headerRow: 2, key: 'OperationID', rows: 29 },
  {
    sheet: '09_Открытый_каталог',
    out: 'open-catalogue.json',
    headerRow: 2,
    key: 'RefID',
    rows: 106,
  },
  { sheet: '10_Решения_и_пробелы', out: 'gaps.json', headerRow: 2, key: 'IssueID', rows: 41 },
  {
    sheet: '11_Трассировка_правил',
    out: 'rule-trace.json',
    headerRow: 2,
    key: 'Rule ID',
    rows: 157,
  },
  { sheet: '12_Справочники', out: 'dictionaries.json', headerRow: 2, key: 'Dictionary', rows: 120 },
  {
    sheet: '02A_Семантика_Runtime',
    out: 'combat-values.json',
    headerRow: 2,
    key: 'CombatValueDefID',
    rows: 65,
  },
  {
    sheet: '07A_Разрешение_атаки',
    out: 'attack-resolution.json',
    headerRow: 2,
    key: 'Field',
    rows: 33,
  },
  { sheet: '07B_Профиль_оружия', out: 'weapon-fields.json', headerRow: 2, key: 'Field', rows: 49 },
  {
    sheet: '07C_Непредметные_атаки',
    out: 'non-item-attacks.json',
    headerRow: 2,
    key: 'Source kind',
    rows: 5,
  },
  { sheet: '17_QA_совместимость', out: 'qa.json', headerRow: 2, key: 'Scenario ID', rows: 27 },
  {
    sheet: '19_XP_RollOccurrences',
    out: 'xp-roll-occurrences.json',
    headerRow: 2,
    key: 'Field',
    rows: 23,
  },
  {
    sheet: ICON_SHEET,
    out: 'icons.json',
    headerRow: ICON_HEADER_ROW,
    key: 'ItemTypeID',
    rows: EXPECTED_ICONS,
  },
] as const;

export interface ItemsImport {
  readonly items: number;
  readonly icons: number;
  readonly bytesWritten: number;
  readonly mediaBytes: number;
  readonly files: readonly string[];
}

function text(record: JsonObject, column: string): string {
  const value = record[column];
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fail(WHERE, `column ${JSON.stringify(column)} holds a non-scalar value`);
}

export async function importItems(ruleCatalogue: ReadonlySet<string>): Promise<ItemsImport> {
  const book = Workbook.open(ARTIFACT.items, WHERE);

  // --- gate ---------------------------------------------------------------
  const control = book.table(GATE.sheet, GATE.headerRow, [GATE.key, GATE.result]).records(GATE.key);
  expectCount(WHERE, `${GATE.sheet} rows`, control.length, GATE.rows);
  const failures = control.filter((row) => text(row, GATE.result) !== CONTROL_PASS);
  if (failures.length > 0) {
    const names = failures
      .slice(0, 5)
      .map((row) => `${text(row, GATE.key)} → ${text(row, GATE.result)}`)
      .join('; ');
    fail(
      WHERE,
      `${GATE.sheet}: ${String(failures.length)} row(s) do not report ${CONTROL_PASS}: ${names}. ` +
        'The registry contradicts itself; importing it would emit wrong data.',
    );
  }

  // --- tables -------------------------------------------------------------
  const collected = new Map<string, JsonObject[]>();
  const dir = join(SPEC_DIR, 'items');
  let bytes = 0;
  const files: string[] = [];

  for (const table of TABLES) {
    const rows = book.table(table.sheet, table.headerRow, [table.key]).records(table.key);
    expectCount(WHERE, `${table.sheet} rows`, rows.length, table.rows);
    collected.set(table.sheet, rows);
    bytes += await writeJson(join(dir, table.out), rows);
    files.push(`generated/spec/items/${table.out}`);
  }

  const catalogue = collected.get('01_Каталог') ?? [];
  const itemIds = new Set(catalogue.map((row) => text(row, 'ItemTypeID')));

  // --- cross-registry -----------------------------------------------------
  (collected.get('11_Трассировка_правил') ?? []).forEach((row, index) => {
    const ruleId = text(row, 'Rule ID');
    if (!ruleCatalogue.has(ruleId)) {
      fail(
        WHERE,
        `11_Трассировка_правил[${String(index)}]: rule ${JSON.stringify(ruleId)} ` +
          'is not in the Executable Rules catalogue',
      );
    }
  });

  // --- icons --------------------------------------------------------------
  const mediaBytes = await extractIcons(book, itemIds, collected.get(ICON_SHEET) ?? []);

  bytes += await writeJson(join(dir, 'meta.json'), {
    source: SOURCE,
    registryVersion: 'v1.6_with_icons',
    items: catalogue.length,
    icons: EXPECTED_ICONS,
    ruleTraceRows: (collected.get('11_Трассировка_правил') ?? []).length,
    gateAllPass: true,
    mediaDir: 'generated/media/items',
  });
  files.push('generated/spec/items/meta.json');

  bytes += await writeText(join(TYPES_DIR, 'items.ts'), renderTypes(collected));
  files.push('generated/types/items.ts');

  return {
    items: catalogue.length,
    icons: EXPECTED_ICONS,
    bytesWritten: bytes,
    mediaBytes,
    files,
  };
}

/**
 * Writes each icon under the file name the registry declares for it, resolving
 * image→item through the drawing anchors and then checking that result against
 * the registry's own `FileName` column. Two independent statements have to
 * agree before a byte is written.
 */
async function extractIcons(
  book: Workbook,
  itemIds: ReadonlySet<string>,
  iconRows: readonly JsonObject[],
): Promise<number> {
  const images = anchoredImages(ARTIFACT.items, ICON_SHEET, WHERE);
  expectCount(WHERE, 'embedded icons', images.length, EXPECTED_ICONS);

  const rows = book.absoluteRows(ICON_SHEET);
  const header = rows[ICON_HEADER_ROW];
  if (header === undefined) {
    fail(WHERE, `${ICON_SHEET} has no header at row ${String(ICON_HEADER_ROW)}`);
  }
  const columns = header.map((c) => (c === null ? '' : String(c).trim()));
  const idColumn = columns.indexOf('ItemTypeID');
  const fileColumn = columns.indexOf('FileName');
  if (idColumn < 0 || fileColumn < 0) {
    fail(WHERE, `${ICON_SHEET}: ItemTypeID or FileName column not found`);
  }

  const declaredNames = new Map(
    iconRows.map((row) => [text(row, 'ItemTypeID'), text(row, 'FileName')]),
  );

  const outDir = join(MEDIA_DIR, 'items');
  await mkdir(outDir, { recursive: true });

  let written = 0;
  const usedNames = new Set<string>();

  for (const image of images) {
    const row = rows[image.row];
    if (row === undefined) {
      fail(WHERE, `${ICON_SHEET}: an icon is anchored to row ${String(image.row)}, which is empty`);
    }
    const rawId = row[idColumn];
    const itemId = typeof rawId === 'string' ? rawId.trim() : '';
    if (itemId === '') {
      fail(WHERE, `${ICON_SHEET}: row ${String(image.row)} carries an icon but no ItemTypeID`);
    }
    if (!itemIds.has(itemId)) {
      fail(WHERE, `${ICON_SHEET}: icon row ${String(image.row)} names unknown item ${itemId}`);
    }

    const fileName = declaredNames.get(itemId);
    if (fileName === undefined || fileName === '') {
      fail(WHERE, `${ICON_SHEET}: item ${itemId} has an icon but no declared FileName`);
    }
    if (usedNames.has(fileName)) {
      fail(WHERE, `${ICON_SHEET}: file name ${JSON.stringify(fileName)} is claimed twice`);
    }
    usedNames.add(fileName);

    await writeFile(join(outDir, fileName), image.bytes);
    written += image.bytes.byteLength;
  }

  return written;
}

function renderTypes(collected: ReadonlyMap<string, JsonObject[]>): string {
  const codes = (sheet: string, column: string): string[] =>
    [...new Set((collected.get(sheet) ?? []).map((r) => text(r, column)))]
      .filter((v) => v !== '')
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return [
    banner(SOURCE),
    '',
    tsUnion('ItemTypeId', codes('01_Каталог', 'ItemTypeID'), '64 catalogued item types.'),
    '',
    tsUnion('ItemFormulaId', codes('05_Формулы_валидации', 'FormulaID')),
    '',
    tsUnion('ItemOperationId', codes('08_Операции', 'OperationID')),
    '',
    tsUnion('CombatValueDefId', codes('02A_Семантика_Runtime', 'CombatValueDefID')),
    '',
    tsUnion(
      'IconVisualStatus',
      codes(ICON_SHEET, 'VisualStatus'),
      'Whether an icon matches its item type or is a provisional visual.',
    ),
    '',
  ].join('\n');
}
