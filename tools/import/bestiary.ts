/**
 * Canonical Bestiary Registry v1.4 → generated/spec/bestiary,
 * generated/media/bestiary and generated/types/bestiary.ts.
 *
 * Senior domain registry (ADR 0003, level 4). Reissued as metadata only in
 * v1.4: the audit changed its Rules reference from v1.5 to v1.7 and left the
 * content untouched (AUD-021, CHG-010).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { banner, tsUnion, writeJson, writeText } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { anchoredImages } from './lib/media.js';
import { ARTIFACT, MEDIA_DIR, SPEC_DIR, TYPES_DIR } from './lib/paths.js';
import { Workbook } from './lib/workbook.js';

const WHERE = 'bestiary';
const SOURCE = 'artifacts/registries/Symbiosis_V7_Canonical_Bestiary_Registry_v1.4.xlsx';
const CONTROL_PASS = 'PASS';

const GALLERY = '01_Галерея';
const SPECIES = '02_Виды';
const TEMPLATES = '03_Шаблоны';
const EXPECTED_ARTS = 16;

/**
 * `12_Контроль` is one table with a section header repeated inside it
 * (`Проверка v1.3`), recognisable because its result cell literally reads
 * "Результат". Exactly one such row is expected; more or fewer means the sheet
 * was restructured.
 */
const GATE = {
  sheet: '12_Контроль',
  headerRow: 0,
  key: 'Проверка',
  result: 'Результат',
  rows: 50,
  sectionHeaders: 1,
} as const;

const TABLES = [
  { sheet: SPECIES, out: 'species.json', headerRow: 0, key: 'Species ID', rows: 16 },
  { sheet: TEMPLATES, out: 'templates.json', headerRow: 0, key: 'Canonical Template ID', rows: 17 },
  {
    sheet: '04_Характеристики',
    out: 'stats.json',
    headerRow: 0,
    key: 'Canonical Template ID',
    rows: 119,
  },
  { sheet: '05_Анатомия', out: 'anatomy.json', headerRow: 0, key: 'Anatomy row ID', rows: 20 },
  { sheet: '06_Атаки', out: 'attacks.json', headerRow: 0, key: 'Attack profile ID', rows: 22 },
  { sheet: '07_Правила', out: 'rules.json', headerRow: 0, key: 'Rule ID', rows: 80 },
  {
    sheet: '08_Симбионты',
    out: 'symbiont-relations.json',
    headerRow: 0,
    key: 'Relation ID',
    rows: 13,
  },
  { sheet: '09_Контракты', out: 'contracts.json', headerRow: 0, key: 'Entity', rows: 69 },
  { sheet: '10_Справочники', out: 'dictionaries.json', headerRow: 0, key: 'Группа', rows: 55 },
  { sheet: '11_Источники', out: 'sources.json', headerRow: 0, key: 'Source ID', rows: 6 },
  {
    sheet: '03A_Политики_шаблонов',
    out: 'template-policies.json',
    headerRow: 0,
    key: 'Policy ID',
    rows: 17,
  },
  {
    sheet: '05A_Маршрутизация_зон',
    out: 'zone-routing.json',
    headerRow: 0,
    key: 'Routing ID',
    rows: 20,
  },
  {
    sheet: '06A_Контракты_атак',
    out: 'attack-contracts.json',
    headerRow: 0,
    key: 'Contract ID',
    rows: 22,
  },
  {
    sheet: '06B_Ответы_эффектов',
    out: 'effect-responses.json',
    headerRow: 0,
    key: 'Response profile ID',
    rows: 5,
  },
  { sheet: '14_QA_готовность', out: 'qa.json', headerRow: 0, key: 'Scenario ID', rows: 24 },
] as const;

/**
 * `00_Сводка` and `01_Галерея` are not tables. Both spread a title across every
 * column, so their header rows carry duplicate names; the gallery is in fact a
 * picture grid, read below for media rather than as rows.
 */
const NOT_A_TABLE = ['00_Сводка', GALLERY] as const;

/** `SPC-… • §section, pages • ART-CB-…` under each picture in the gallery. */
const CAPTION = /^(SPC-[A-Z0-9-]+)\s*•.*•\s*(ART-CB-[A-Z0-9-]+)\s*$/;

export interface BestiaryImport {
  readonly species: number;
  readonly templates: number;
  readonly arts: number;
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

export async function importBestiary(ruleCatalogue: ReadonlySet<string>): Promise<BestiaryImport> {
  const book = Workbook.open(ARTIFACT.bestiary, WHERE);

  for (const sheet of NOT_A_TABLE) {
    if (!book.sheetNames.includes(sheet)) {
      fail(WHERE, `sheet ${JSON.stringify(sheet)} is listed as skipped but no longer exists`);
    }
  }

  // --- gate ---------------------------------------------------------------
  const control = book.table(GATE.sheet, GATE.headerRow, [GATE.key, GATE.result]).records(GATE.key);
  expectCount(WHERE, `${GATE.sheet} rows`, control.length, GATE.rows);

  const sectionHeaders = control.filter((row) => text(row, GATE.result) === GATE.result);
  expectCount(WHERE, `${GATE.sheet} section headers`, sectionHeaders.length, GATE.sectionHeaders);

  const checks = control.filter((row) => text(row, GATE.result) !== GATE.result);
  const failures = checks.filter((row) => text(row, GATE.result) !== CONTROL_PASS);
  if (failures.length > 0) {
    fail(
      WHERE,
      `${GATE.sheet}: ${String(failures.length)} check(s) do not report ${CONTROL_PASS}: ` +
        failures
          .slice(0, 5)
          .map((row) => `${text(row, GATE.key)} → ${text(row, GATE.result)}`)
          .join('; '),
    );
  }

  // --- tables -------------------------------------------------------------
  const collected = new Map<string, JsonObject[]>();
  const dir = join(SPEC_DIR, 'bestiary');
  let bytes = 0;
  const files: string[] = [];

  for (const table of TABLES) {
    const rows = book.table(table.sheet, table.headerRow, [table.key]).records(table.key);
    expectCount(WHERE, `${table.sheet} rows`, rows.length, table.rows);
    collected.set(table.sheet, rows);
    bytes += await writeJson(join(dir, table.out), rows);
    files.push(`generated/spec/bestiary/${table.out}`);
  }

  // --- referential integrity ----------------------------------------------
  const speciesRows = collected.get(SPECIES) ?? [];
  const species = new Set(speciesRows.map((row) => text(row, 'Species ID')));
  const templates = new Set(
    (collected.get(TEMPLATES) ?? []).map((row) => text(row, 'Canonical Template ID')),
  );

  assertRefs(collected.get(TEMPLATES) ?? [], 'Species ID', species, TEMPLATES);
  assertRefs(collected.get('04_Характеристики') ?? [], 'Species ID', species, '04_Характеристики');
  assertRefs(collected.get('08_Симбионты') ?? [], 'Species ID', species, '08_Симбионты');
  for (const sheet of [
    '04_Характеристики',
    '05_Анатомия',
    '03A_Политики_шаблонов',
    '05A_Маршрутизация_зон',
  ]) {
    assertRefs(collected.get(sheet) ?? [], 'Canonical Template ID', templates, sheet);
  }

  (collected.get('07_Правила') ?? []).forEach((row, index) => {
    const ruleId = text(row, 'Rule ID');
    if (!ruleCatalogue.has(ruleId)) {
      fail(
        WHERE,
        `07_Правила[${String(index)}]: rule ${JSON.stringify(ruleId)} ` +
          'is not in the Executable Rules catalogue',
      );
    }
  });

  // --- arts ---------------------------------------------------------------
  const { mediaBytes, assigned } = await extractArts(book, speciesRows);

  bytes += await writeJson(join(dir, 'arts.json'), assigned);
  files.push('generated/spec/bestiary/arts.json');

  bytes += await writeJson(join(dir, 'meta.json'), {
    source: SOURCE,
    registryVersion: 'v1.4',
    species: species.size,
    templates: templates.size,
    arts: assigned.length,
    ruleRows: (collected.get('07_Правила') ?? []).length,
    gateAllPass: true,
    skippedSheets: [...NOT_A_TABLE],
    mediaDir: 'generated/media/bestiary',
  });
  files.push('generated/spec/bestiary/meta.json');

  bytes += await writeText(join(TYPES_DIR, 'bestiary.ts'), renderTypes(collected));
  files.push('generated/types/bestiary.ts');

  return {
    species: species.size,
    templates: templates.size,
    arts: assigned.length,
    bytesWritten: bytes,
    mediaBytes,
    files,
  };
}

function assertRefs(
  rows: readonly JsonObject[],
  column: string,
  known: ReadonlySet<string>,
  sheet: string,
): void {
  rows.forEach((row, index) => {
    const value = text(row, column);
    if (value === '') return;
    if (!known.has(value)) {
      fail(WHERE, `${sheet}[${String(index)}]: unknown ${column} ${JSON.stringify(value)}`);
    }
  });
}

interface AssignedArt extends JsonObject {
  speciesId: string;
  artAssetKey: string;
  file: string;
  bytes: number;
}

/**
 * The gallery is a picture grid, not a list: two arts per block, each captioned
 * a few rows below its own column. So an art is matched to the nearest caption
 * *below it in the same column*, and the art key parsed from that caption must
 * equal the `Art asset key` the species sheet declares. Two independent
 * statements again, as with the item icons.
 */
async function extractArts(
  book: Workbook,
  speciesRows: readonly JsonObject[],
): Promise<{ mediaBytes: number; assigned: AssignedArt[] }> {
  const images = anchoredImages(ARTIFACT.bestiary, GALLERY, WHERE);
  expectCount(WHERE, 'embedded arts', images.length, EXPECTED_ARTS);

  const rows = book.absoluteRows(GALLERY);
  const captions: { row: number; col: number; species: string; art: string }[] = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (typeof cell !== 'string') return;
      const match = CAPTION.exec(cell.trim());
      if (match) {
        captions.push({ row: rowIndex, col: colIndex, species: match[1]!, art: match[2]! });
      }
    });
  });
  if (captions.length === 0) {
    fail(WHERE, `${GALLERY}: no "SPC-… • … • ART-CB-…" captions found`);
  }

  const declaredArt = new Map(
    speciesRows.map((row) => [text(row, 'Species ID'), text(row, 'Art asset key')]),
  );

  const outDir = join(MEDIA_DIR, 'bestiary');
  await mkdir(outDir, { recursive: true });

  const assigned: AssignedArt[] = [];
  const usedSpecies = new Set<string>();
  let mediaBytes = 0;

  for (const image of images) {
    const caption = captions
      .filter((c) => c.col === image.col && c.row > image.row)
      .sort((a, b) => a.row - b.row)[0];
    if (caption === undefined) {
      fail(
        WHERE,
        `${GALLERY}: the art at row ${String(image.row)}, column ${String(image.col)} ` +
          'has no caption below it in the same column',
      );
    }

    const declared = declaredArt.get(caption.species);
    if (declared === undefined) {
      fail(WHERE, `${GALLERY}: caption names unknown species ${JSON.stringify(caption.species)}`);
    }
    if (declared !== caption.art) {
      fail(
        WHERE,
        `${GALLERY}: caption for ${caption.species} says ${JSON.stringify(caption.art)}, ` +
          `but ${SPECIES} declares ${JSON.stringify(declared)}`,
      );
    }
    if (usedSpecies.has(caption.species)) {
      fail(WHERE, `${GALLERY}: two arts resolve to species ${caption.species}`);
    }
    usedSpecies.add(caption.species);

    const extension = image.source.slice(image.source.lastIndexOf('.') + 1);
    const file = `${caption.art.toLowerCase()}.${extension}`;
    await writeFile(join(outDir, file), image.bytes);
    mediaBytes += image.bytes.byteLength;

    assigned.push({
      speciesId: caption.species,
      artAssetKey: caption.art,
      file,
      bytes: image.bytes.byteLength,
    });
  }

  assigned.sort((a, b) => (a.speciesId < b.speciesId ? -1 : a.speciesId > b.speciesId ? 1 : 0));
  return { mediaBytes, assigned };
}

function renderTypes(collected: ReadonlyMap<string, JsonObject[]>): string {
  const codes = (sheet: string, column: string): string[] =>
    [...new Set((collected.get(sheet) ?? []).map((r) => text(r, column)))]
      .filter((v) => v !== '')
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return [
    banner(SOURCE),
    '',
    tsUnion('SpeciesId', codes(SPECIES, 'Species ID'), '16 canonical species.'),
    '',
    tsUnion(
      'CanonicalTemplateId',
      codes(TEMPLATES, 'Canonical Template ID'),
      '17 statblocks — one species carries two variants.',
    ),
    '',
    tsUnion('ArtAssetKey', codes(SPECIES, 'Art asset key')),
    '',
    tsUnion('AttackProfileId', codes('06_Атаки', 'Attack profile ID')),
    '',
    tsUnion('AnatomyRowId', codes('05_Анатомия', 'Anatomy row ID')),
    '',
  ].join('\n');
}
