import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadSymbiontMediaCatalog } from './symbiont-media.js';
import { CATALOG, REPO_ROOT } from '../../tests/fixtures/symbiont-stage.js';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createMediaRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'symbiosis-manual-media-'));
  temporaryDirectories.push(root);
  const specDir = join(root, 'generated', 'spec', 'symbiont-media');
  const artDir = join(root, 'generated', 'media', 'symbionts');
  const treeDir = join(root, 'generated', 'media', 'development-trees');
  mkdirSync(specDir, { recursive: true });
  mkdirSync(artDir, { recursive: true });
  mkdirSync(treeDir, { recursive: true });
  cpSync(
    resolve(REPO_ROOT, 'generated/spec/symbiont-media/manifest.json'),
    join(specDir, 'manifest.json'),
  );
  const manifest = JSON.parse(readFileSync(join(specDir, 'manifest.json'), 'utf8')) as {
    species: readonly { speciesKey: string; artFile: string; developmentTreeFile: string }[];
  };
  for (const entry of manifest.species) {
    writeFileSync(join(artDir, entry.artFile), 'png');
    writeFileSync(join(treeDir, entry.developmentTreeFile), 'png');
  }
  return root;
}

describe('CHR-018 symbiont media catalog', () => {
  it('loads all 23 exact species mappings and exposes only source-owned URLs', async () => {
    const catalog = await loadSymbiontMediaCatalog(REPO_ROOT);
    expect([...catalog.keys()].sort()).toEqual(
      CATALOG.species.map((species) => species.speciesKey).sort(),
    );
    for (const species of CATALOG.species) {
      expect(catalog.get(species.speciesKey)).toMatchObject({
        artPath: `/generated/media/symbionts/${species.speciesKey}.png`,
        developmentTreePath: `/generated/media/development-trees/${species.speciesKey}.png`,
      });
    }
  });

  it('fails closed on missing, extra and mismatched media', async () => {
    const missingRoot = createMediaRoot();
    rmSync(join(missingRoot, 'generated', 'media', 'symbionts', 'WEAVER.png'));
    await expect(loadSymbiontMediaCatalog(missingRoot)).rejects.toThrow('WEAVER');

    const extraRoot = createMediaRoot();
    writeFileSync(join(extraRoot, 'generated', 'media', 'symbionts', 'EXTRA.png'), 'png');
    await expect(loadSymbiontMediaCatalog(extraRoot)).rejects.toThrow('EXTRA');

    const mismatchRoot = createMediaRoot();
    const manifestPath = join(mismatchRoot, 'generated', 'spec', 'symbiont-media', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      species: { speciesKey: string; artFile: string; developmentTreeFile: string }[];
    };
    manifest.species[0]!.artFile = 'MISMATCHED.png';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    await expect(loadSymbiontMediaCatalog(mismatchRoot)).rejects.toThrow('MISMATCHED');

    const traversalRoot = createMediaRoot();
    const traversalManifestPath = join(
      traversalRoot,
      'generated',
      'spec',
      'symbiont-media',
      'manifest.json',
    );
    const traversalManifest = JSON.parse(readFileSync(traversalManifestPath, 'utf8')) as {
      species: { speciesKey: string; artFile: string; developmentTreeFile: string }[];
    };
    traversalManifest.species[0]!.artFile = '../secret.png';
    writeFileSync(traversalManifestPath, JSON.stringify(traversalManifest, null, 2));
    await expect(loadSymbiontMediaCatalog(traversalRoot)).rejects.toThrow('exact SpeciesKey');
  });
});
