import { readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  CORE_169_SPECIES_BY_FACE,
  SYMBIOTIC_MONSTER_SPECIES_KEYS,
  type SymbiontSpeciesKey,
} from '../domain/index.js';
import { readJsonFile } from './json-source.js';

export interface SymbiontMediaPreview {
  readonly artFile: string;
  readonly developmentTreeFile: string;
  readonly artPath: string;
  readonly developmentTreePath: string;
}

interface SymbiontMediaManifestEntry {
  readonly speciesKey: SymbiontSpeciesKey;
  readonly artFile: string;
  readonly developmentTreeFile: string;
}

const EXPECTED_SPECIES = [...CORE_169_SPECIES_BY_FACE, ...SYMBIOTIC_MONSTER_SPECIES_KEYS];
const EXPECTED_KEYS = new Set(EXPECTED_SPECIES);

function fail(detail: string): never {
  throw new Error(`symbiont media: ${detail}`);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(object: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${path} must have exact fields ${expected.join(',')}`);
  }
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${path} must be non-empty`);
  return value;
}

function literal(value: unknown, expected: string, path: string): void {
  if (value !== expected) fail(`${path} must be ${JSON.stringify(expected)}`);
}

function within(root: string, path: string): void {
  const fromRoot = relative(root, path);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    fail(`resolved path escapes ${root}`);
  }
}

async function existingDirectory(root: string, relativePath: string): Promise<string> {
  const path = await realpath(resolve(root, relativePath));
  within(root, path);
  return path;
}

async function existingFile(root: string, relativePath: string): Promise<string> {
  const path = await realpath(resolve(root, relativePath));
  within(root, path);
  return path;
}

function manifestEntry(value: unknown, index: number): SymbiontMediaManifestEntry {
  const path = `species[${String(index)}]`;
  const object = objectAt(value, path);
  exactKeys(object, ['artFile', 'developmentTreeFile', 'speciesKey'], path);
  const speciesKey = text(object['speciesKey'], `${path}.speciesKey`);
  if (!EXPECTED_KEYS.has(speciesKey as SymbiontSpeciesKey)) {
    fail(
      `${path}.speciesKey must name an exact SpeciesKey, received ${JSON.stringify(speciesKey)}`,
    );
  }
  return {
    speciesKey: speciesKey as SymbiontSpeciesKey,
    artFile: text(object['artFile'], `${path}.artFile`),
    developmentTreeFile: text(object['developmentTreeFile'], `${path}.developmentTreeFile`),
  };
}

export async function loadSymbiontMediaCatalog(
  projectRoot: string,
): Promise<ReadonlyMap<SymbiontSpeciesKey, SymbiontMediaPreview>> {
  const root = await realpath(resolve(projectRoot));
  const manifest = objectAt(
    await readJsonFile(
      join(root, 'generated', 'spec', 'symbiont-media', 'manifest.json'),
      'manifest',
    ),
    'manifest',
  );
  exactKeys(manifest, ['artSource', 'developmentTreeSource', 'mediaDirs', 'species'], 'manifest');
  literal(
    manifest['artSource'],
    'artifacts/symbiont-media/Symbiosis_V7_Symbiont_Art_Mapping_v1.0.xlsx',
    'manifest.artSource',
  );
  literal(
    manifest['developmentTreeSource'],
    'artifacts/symbiont-media/Symbiosis_V7_Symbiont_Development_Tree_Mapping_v1.0.xlsx',
    'manifest.developmentTreeSource',
  );
  const mediaDirs = objectAt(manifest['mediaDirs'], 'manifest.mediaDirs');
  exactKeys(mediaDirs, ['art', 'developmentTrees'], 'manifest.mediaDirs');
  literal(mediaDirs['art'], 'generated/media/symbionts', 'manifest.mediaDirs.art');
  literal(
    mediaDirs['developmentTrees'],
    'generated/media/development-trees',
    'manifest.mediaDirs.developmentTrees',
  );
  const rawSpecies = manifest['species'];
  if (!Array.isArray(rawSpecies) || rawSpecies.length !== EXPECTED_SPECIES.length) {
    fail(`manifest.species must contain exactly ${EXPECTED_SPECIES.length} entries`);
  }
  const entries = rawSpecies.map(manifestEntry);
  const expectedFiles = EXPECTED_SPECIES.map((speciesKey) => `${speciesKey}.png`).sort();
  for (const [index, entry] of entries.entries()) {
    const expectedKey = EXPECTED_SPECIES[index];
    if (entry.speciesKey !== expectedKey) {
      fail(`species[${String(index)}] must be ${expectedKey}, received ${entry.speciesKey}`);
    }
    if (entry.artFile !== `${entry.speciesKey}.png`) {
      fail(
        `${entry.speciesKey}.artFile must be an exact SpeciesKey filename, received ${JSON.stringify(entry.artFile)}`,
      );
    }
    if (entry.developmentTreeFile !== `${entry.speciesKey}.png`) {
      fail(
        `${entry.speciesKey}.developmentTreeFile must be an exact SpeciesKey filename, received ${JSON.stringify(entry.developmentTreeFile)}`,
      );
    }
  }

  const artDirectory = await existingDirectory(root, 'generated/media/symbionts');
  const treeDirectory = await existingDirectory(root, 'generated/media/development-trees');
  const artFiles = (await readdir(artDirectory)).sort();
  const treeFiles = (await readdir(treeDirectory)).sort();
  if (artFiles.join('\n') !== expectedFiles.join('\n')) {
    fail(
      `symbiont art files must be exactly ${expectedFiles.join(',')}; received ${artFiles.join(',')}`,
    );
  }
  if (treeFiles.join('\n') !== expectedFiles.join('\n')) {
    fail(
      `development tree files must be exactly ${expectedFiles.join(',')}; received ${treeFiles.join(',')}`,
    );
  }

  const result = new Map<SymbiontSpeciesKey, SymbiontMediaPreview>();
  for (const entry of entries) {
    result.set(entry.speciesKey, {
      artFile: await existingFile(artDirectory, entry.artFile),
      developmentTreeFile: await existingFile(treeDirectory, entry.developmentTreeFile),
      artPath: `/generated/media/symbionts/${entry.speciesKey}.png`,
      developmentTreePath: `/generated/media/development-trees/${entry.speciesKey}.png`,
    });
  }
  return result;
}
