import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { expect, it } from 'vitest';
import { BASELINE_LINEAGE_SEALS } from './baseline-lineage-seals.js';
import {
  captureReplayCatalogDigests,
  verifyHistoricalBaselineLineage,
} from './baseline-lineage.js';
import {
  loadLocalCharacterExportBaseline,
  resolveStoredLocalCharacterExportBaseline,
} from './local-character-export.js';
import {
  BASELINE_FIXTURE_IDS,
  baselineFixtureManifest,
  createBaselineLineageFixture,
} from '../../tests/fixtures/baseline-lineage.js';

const artifactPaths = (root: string) => {
  const directory = join(root, 'artifacts');
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== 'CHECKSUMS.sha256')
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
};

it('registers all five immutable old views under exact B5 while preserving 24 mechanical catalogs', async () => {
  const f = createBaselineLineageFixture('B5');
  try {
    const manifest = readFileSync(join(f.projectRoot, 'artifacts/CHECKSUMS.sha256'));
    expect(artifactPaths(f.projectRoot)).toHaveLength(25);
    expect(captureReplayCatalogDigests(f.projectRoot)).toEqual(
      BASELINE_LINEAGE_SEALS.replayCatalogDigests,
    );
    const current = await loadLocalCharacterExportBaseline(f.projectRoot);
    expect(current.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B5);
    for (const release of ['B0', 'B1', 'B2', 'B3', 'B4'] as const) {
      const old = resolveStoredLocalCharacterExportBaseline(current, BASELINE_FIXTURE_IDS[release]);
      expect(old.baselineVersion).toBe(BASELINE_FIXTURE_IDS[release]);
      expect(old.catalog).toBe(current.catalog);
      expect(Object.isFrozen(old)).toBe(true);
    }
    expect(() =>
      verifyHistoricalBaselineLineage(
        manifest,
        BASELINE_LINEAGE_SEALS.replayCatalogDigests,
        BASELINE_LINEAGE_SEALS.runtimeTuple,
        BASELINE_FIXTURE_IDS.B5,
      ),
    ).not.toThrow();
    expect(readFileSync(join(f.projectRoot, 'artifacts/CHECKSUMS.sha256')).equals(manifest)).toBe(
      true,
    );
  } finally {
    f.close();
  }
});

it('restores the exact 22/25 artifact sets on both cold and warm Atlas fixture paths', () => {
  const f = createBaselineLineageFixture('B4');
  try {
    const historical = artifactPaths(f.projectRoot);
    expect(historical).toHaveLength(22);
    for (const round of [0, 1]) {
      f.apply('B5');
      expect(artifactPaths(f.projectRoot)).toEqual(
        [...historical, ...Object.keys(BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts)].sort(),
      );
      expect(
        readFileSync(join(f.projectRoot, 'artifacts/CHECKSUMS.sha256')).equals(
          baselineFixtureManifest('B5'),
        ),
      ).toBe(true);
      f.apply('B4');
      expect(artifactPaths(f.projectRoot), String(round)).toEqual(historical);
      expect(
        readFileSync(join(f.projectRoot, 'artifacts/CHECKSUMS.sha256')).equals(
          baselineFixtureManifest('B4'),
        ),
      ).toBe(true);
      for (const path of Object.keys(BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts))
        expect(existsSync(join(f.projectRoot, 'artifacts', path))).toBe(false);
    }
  } finally {
    f.close();
  }
});

it('rejects actual altered B5 artwork before issuing a trusted baseline', async () => {
  const f = createBaselineLineageFixture('B5');
  try {
    const path = join(
      f.projectRoot,
      'artifacts/gm-entity-portraits/symbiosis_placeholder_monster.png',
    );
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from([0])]));
    await expect(loadLocalCharacterExportBaseline(f.projectRoot)).rejects.toThrow(
      'baseline checksum differs',
    );
  } finally {
    f.close();
  }
});
