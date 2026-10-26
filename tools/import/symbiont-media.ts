import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { embeddedMedia } from './lib/archive.js';
import { writeJson } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { anchoredImages } from './lib/media.js';
import type { AnchoredImage } from './lib/media.js';
import { ARTIFACT, MEDIA_DIR, SPEC_DIR } from './lib/paths.js';
import { Workbook } from './lib/workbook.js';
import type { Row } from './lib/workbook.js';

const EXPECTED_SPECIES_COUNT = 23;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export interface SymbiontMediaWorkbookInput {
  readonly archivePath: string;
  readonly sheetName: string;
  readonly rows: readonly Row[];
  readonly images: readonly AnchoredImage[];
  readonly mediaPaths: readonly string[];
}

export interface SymbiontMediaSpeciesEntry extends JsonObject {
  readonly speciesKey: string;
  readonly artFile: string;
  readonly developmentTreeFile: string;
}

export interface SymbiontMediaPlan {
  readonly species: readonly SymbiontMediaSpeciesEntry[];
  readonly mediaBytes: number;
}

export interface SymbiontRegistryRow {
  readonly SpeciesKey: string;
  readonly Status: string;
  readonly SymbiontKind: string;
}

export function selectSymbiontMediaSpeciesKeys(
  rows: readonly SymbiontRegistryRow[],
): readonly string[] {
  return rows
    .filter(
      (row) =>
        row.Status === 'ACTIVE' &&
        (row.SymbiontKind === 'ORDINARY' || row.SymbiontKind === 'SYMBIOTIC_MONSTER'),
    )
    .map((row) => row.SpeciesKey);
}

function text(row: Row, column: number, where: string, rowIndex: number): string {
  const value = row[column];
  if (value === null || value === undefined) {
    fail(where, `row ${String(rowIndex)} is missing a required value`);
  }
  return typeof value === 'string' ? value.trim() : String(value);
}

function validateWorkbook(
  speciesKeys: readonly string[],
  input: SymbiontMediaWorkbookInput,
): ReadonlyMap<string, string> {
  const where = `symbiont-media/${input.sheetName}`;
  const header = input.rows[0];
  if (header === undefined) fail(where, 'missing header row 0');
  const columns = header.map((cell) => (cell === null ? '' : String(cell).trim()));
  const keyColumn = columns.indexOf('SpeciesKey');
  const fileColumn = columns.indexOf('FileName');
  if (keyColumn < 0 || fileColumn < 0) {
    fail(where, 'SpeciesKey or FileName column not found');
  }
  expectCount(where, 'data rows', input.rows.length - 1, EXPECTED_SPECIES_COUNT);

  const declared = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const [rowIndex, row] of input.rows.slice(1).entries()) {
    const sheetRow = rowIndex + 1;
    const speciesKey = text(row, keyColumn, where, sheetRow);
    if (declared.has(speciesKey)) fail(where, `duplicate SpeciesKey ${JSON.stringify(speciesKey)}`);
    if (!speciesKeys.includes(speciesKey)) {
      fail(where, `unknown SpeciesKey ${JSON.stringify(speciesKey)} at row ${String(sheetRow)}`);
    }
    const fileName = text(row, fileColumn, where, sheetRow);
    if (usedNames.has(fileName)) fail(where, `duplicate filename ${JSON.stringify(fileName)}`);
    if (!fileName.endsWith('.png')) {
      fail(where, `expected PNG extension for ${JSON.stringify(fileName)}`);
    }
    if (fileName.includes('\u0000') || !/^(?![A-Za-z]:)[^/\\]+\.png$/u.test(fileName)) {
      fail(where, `unsafe media basename ${JSON.stringify(fileName)}`);
    }
    if (fileName !== `${speciesKey}.png`) {
      fail(where, `declared filename ${JSON.stringify(fileName)} does not equal ${speciesKey}.png`);
    }
    declared.set(speciesKey, fileName);
    usedNames.add(fileName);
  }
  const missingRows = speciesKeys.filter((speciesKey) => !declared.has(speciesKey));
  if (missingRows.length > 0) {
    fail(where, `missing SpeciesKey rows: ${missingRows.join(', ')}`);
  }

  const resolvedSources = new Set(input.images.map((image) => image.source));
  if (resolvedSources.size !== input.images.length) {
    fail(where, 'two anchors resolve to the same media part');
  }
  const mediaPaths = new Set(input.mediaPaths);
  if (mediaPaths.size !== input.mediaPaths.length) {
    fail(where, 'embedded media paths are duplicated');
  }
  for (const source of resolvedSources) {
    if (!mediaPaths.has(source)) fail(where, `resolved media part ${source} is missing`);
  }

  const coveredKeys = new Set<string>();
  for (const image of input.images) {
    if (!Number.isSafeInteger(image.row) || image.row <= 0) {
      fail(where, `image is anchored to row ${String(image.row)}, not a species row`);
    }
    const row = input.rows[image.row];
    if (row === undefined) fail(where, `image is anchored to missing row ${String(image.row)}`);
    const speciesKey = text(row, keyColumn, where, image.row);
    if (!declared.has(speciesKey)) {
      fail(where, `image at row ${String(image.row)} names unknown SpeciesKey ${speciesKey}`);
    }
    if (coveredKeys.has(speciesKey)) {
      fail(where, `duplicate image for SpeciesKey ${JSON.stringify(speciesKey)}`);
    }
    if (PNG_SIGNATURE.some((byte, index) => image.bytes[index] !== byte)) {
      fail(where, `image for SpeciesKey ${speciesKey} lacks the PNG signature`);
    }
    coveredKeys.add(speciesKey);
  }
  const missingImages = speciesKeys.filter((speciesKey) => !coveredKeys.has(speciesKey));
  if (missingImages.length > 0) {
    fail(where, `missing SpeciesKey images: ${missingImages.join(', ')}`);
  }
  for (const path of mediaPaths) {
    if (!resolvedSources.has(path)) fail(where, `unreferenced media part ${path}`);
  }
  expectCount(where, 'anchored images', input.images.length, EXPECTED_SPECIES_COUNT);
  expectCount(where, 'embedded media parts', input.mediaPaths.length, EXPECTED_SPECIES_COUNT);
  return declared;
}

export function planSymbiontMediaImport(
  speciesKeys: readonly string[],
  art: SymbiontMediaWorkbookInput,
  developmentTrees: SymbiontMediaWorkbookInput,
): SymbiontMediaPlan {
  expectCount('symbiont-media', 'SpeciesKey entries', speciesKeys.length, EXPECTED_SPECIES_COUNT);
  if (new Set(speciesKeys).size !== speciesKeys.length) {
    fail('symbiont-media', 'the species catalogue contains a duplicate SpeciesKey');
  }
  const artFiles = validateWorkbook(speciesKeys, art);
  const treeFiles = validateWorkbook(speciesKeys, developmentTrees);
  return {
    species: speciesKeys.map((speciesKey) => ({
      speciesKey,
      artFile: artFiles.get(speciesKey)!,
      developmentTreeFile: treeFiles.get(speciesKey)!,
    })),
    mediaBytes: [...art.images, ...developmentTrees.images].reduce(
      (sum, image) => sum + image.bytes.byteLength,
      0,
    ),
  };
}

const ART_SOURCE = 'artifacts/symbiont-media/Symbiosis_V7_Symbiont_Art_Mapping_v1.0.xlsx';
const DEVELOPMENT_TREE_SOURCE =
  'artifacts/symbiont-media/Symbiosis_V7_Symbiont_Development_Tree_Mapping_v1.0.xlsx';
const MANIFEST_PATH = 'generated/spec/symbiont-media/manifest.json';

export interface SymbiontMediaImport {
  readonly species: readonly SymbiontMediaSpeciesEntry[];
  readonly artImages: number;
  readonly treeImages: number;
  readonly mediaBytes: number;
  readonly bytesWritten: number;
  readonly files: readonly string[];
}

function workbookInput(archivePath: string, sheetName: string): SymbiontMediaWorkbookInput {
  return {
    archivePath,
    sheetName,
    rows: Workbook.open(archivePath, 'symbiont-media').absoluteRows(sheetName),
    images: anchoredImages(archivePath, sheetName, 'symbiont-media'),
    mediaPaths: embeddedMedia(archivePath, 'symbiont-media').map((entry) => entry.path),
  };
}

function imageForSpecies(input: SymbiontMediaWorkbookInput, speciesKey: string): AnchoredImage {
  const keyColumn = input.rows[0]?.indexOf('SpeciesKey');
  if (keyColumn === undefined || keyColumn < 0) {
    fail('symbiont-media', `${input.sheetName} has no SpeciesKey column`);
  }
  const image = input.images.find(
    (candidate) => input.rows[candidate.row]?.[keyColumn] === speciesKey,
  );
  if (image === undefined) {
    fail('symbiont-media', `validated image for SpeciesKey ${speciesKey} is missing`);
  }
  return image;
}

export async function importSymbiontMedia(): Promise<SymbiontMediaImport> {
  const speciesKeys = selectSymbiontMediaSpeciesKeys(
    JSON.parse(
      await readFile(join(SPEC_DIR, 'character', 'symbionts.json'), 'utf8'),
    ) as SymbiontRegistryRow[],
  );
  const art = workbookInput(ARTIFACT.symbiontArt, 'SymbiontArt');
  const developmentTrees = workbookInput(ARTIFACT.symbiontDevelopmentTrees, 'DevelopmentTrees');
  const plan = planSymbiontMediaImport(speciesKeys, art, developmentTrees);
  const artDir = join(MEDIA_DIR, 'symbionts');
  const treeDir = join(MEDIA_DIR, 'development-trees');
  await Promise.all([
    rm(artDir, { recursive: true, force: true }),
    rm(treeDir, { recursive: true, force: true }),
  ]);
  await Promise.all([mkdir(artDir, { recursive: true }), mkdir(treeDir, { recursive: true })]);
  for (const entry of plan.species) {
    await writeFile(join(artDir, entry.artFile), imageForSpecies(art, entry.speciesKey).bytes);
    await writeFile(
      join(treeDir, entry.developmentTreeFile),
      imageForSpecies(developmentTrees, entry.speciesKey).bytes,
    );
  }
  const bytesWritten = await writeJson(join(SPEC_DIR, 'symbiont-media', 'manifest.json'), {
    artSource: ART_SOURCE,
    developmentTreeSource: DEVELOPMENT_TREE_SOURCE,
    mediaDirs: {
      art: 'generated/media/symbionts',
      developmentTrees: 'generated/media/development-trees',
    },
    species: [...plan.species],
  });
  return {
    species: plan.species,
    artImages: art.images.length,
    treeImages: developmentTrees.images.length,
    mediaBytes: plan.mediaBytes,
    bytesWritten,
    files: [MANIFEST_PATH],
  };
}
