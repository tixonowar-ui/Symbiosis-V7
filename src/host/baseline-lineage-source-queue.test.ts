import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

it('registers B0 through B5 views under exact B6 without replacing their IDs or source bytes', async () => {
  const fixture = createBaselineLineageFixture('B6');
  try {
    const manifestPath = join(fixture.projectRoot, 'artifacts/CHECKSUMS.sha256');
    const manifest = readFileSync(manifestPath);
    const oldManifests = (['B0', 'B1', 'B2', 'B3', 'B4', 'B5'] as const).map((release) => ({
      release,
      bytes: baselineFixtureManifest(release),
    }));
    const current = await loadLocalCharacterExportBaseline(fixture.projectRoot);
    expect(current.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B6);
    expect(resolveStoredLocalCharacterExportBaseline(current, BASELINE_FIXTURE_IDS.B6)).toBe(
      current,
    );
    expect(captureReplayCatalogDigests(fixture.projectRoot)).toEqual(
      BASELINE_LINEAGE_SEALS.replayCatalogDigests,
    );
    for (const { release, bytes } of oldManifests) {
      const old = resolveStoredLocalCharacterExportBaseline(current, BASELINE_FIXTURE_IDS[release]);
      expect(old.baselineVersion).toBe(BASELINE_FIXTURE_IDS[release]);
      expect(old.catalog).toBe(current.catalog);
      expect(Object.isFrozen(old)).toBe(true);
      expect(baselineFixtureManifest(release).equals(bytes)).toBe(true);
      expect(resolveStoredLocalCharacterExportBaseline(old, BASELINE_FIXTURE_IDS.B6)).toBe(current);
    }
    expect(readFileSync(manifestPath).equals(manifest)).toBe(true);
    expect(() =>
      verifyHistoricalBaselineLineage(
        manifest,
        BASELINE_LINEAGE_SEALS.replayCatalogDigests,
        BASELINE_LINEAGE_SEALS.runtimeTuple,
        BASELINE_FIXTURE_IDS.B6,
      ),
    ).not.toThrow();
    expect(() =>
      verifyHistoricalBaselineLineage(
        manifest,
        {
          ...BASELINE_LINEAGE_SEALS.replayCatalogDigests,
          'generated/spec/rules/rules.json': '0'.repeat(64),
        },
        BASELINE_LINEAGE_SEALS.runtimeTuple,
        BASELINE_FIXTURE_IDS.B5,
      ),
    ).toThrow('catalog source seal');
    expect(() =>
      verifyHistoricalBaselineLineage(
        manifest,
        BASELINE_LINEAGE_SEALS.replayCatalogDigests,
        { ...BASELINE_LINEAGE_SEALS.runtimeTuple, registryVersion: 'unknown' },
        BASELINE_FIXTURE_IDS.B5,
      ),
    ).toThrow('runtime contract tuple');
  } finally {
    fixture.close();
  }
});

it('keeps exactly the same 25 artifact paths through cold and warm B5/B6 delivery', () => {
  const fixture = createBaselineLineageFixture('B5');
  try {
    const paths = artifactPaths(fixture.projectRoot);
    expect(paths).toHaveLength(25);
    const nonAtlas = paths
      .filter((path) => !path.startsWith('atlas/'))
      .map((path) => ({ path, bytes: readFileSync(join(fixture.projectRoot, 'artifacts', path)) }));
    for (const release of ['B6', 'B5', 'B6', 'B4', 'B6'] as const) {
      fixture.apply(release);
      const expected =
        release === 'B4'
          ? paths.filter(
              (path) => !Object.hasOwn(BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts, path),
            )
          : paths;
      expect(artifactPaths(fixture.projectRoot)).toEqual(expected);
      expect(
        readFileSync(join(fixture.projectRoot, 'artifacts/CHECKSUMS.sha256')).equals(
          baselineFixtureManifest(release),
        ),
      ).toBe(true);
      for (const { path, bytes } of nonAtlas.filter((row) => expected.includes(row.path)))
        expect(readFileSync(join(fixture.projectRoot, 'artifacts', path)).equals(bytes), path).toBe(
          true,
        );
    }
  } finally {
    fixture.close();
  }
});

it.each([
  'gm-entity-portraits/manifest.json',
  'gm-entity-portraits/symbiosis_placeholder_monster.png',
  'gm-entity-portraits/symbiosis_placeholder_sentient_enemy.png',
] as const)(
  'refuses changed inherited B6 art %s before issuing a trusted context',
  async (path) => {
    const fixture = createBaselineLineageFixture('B6');
    try {
      const target = join(fixture.projectRoot, 'artifacts', path);
      const altered = Buffer.concat([readFileSync(target), Buffer.from([0])]);
      writeFileSync(target, altered);
      await expect(loadLocalCharacterExportBaseline(fixture.projectRoot)).rejects.toThrow(
        'baseline checksum differs',
      );
      expect(readFileSync(target).equals(altered)).toBe(true);
    } finally {
      fixture.close();
    }
  },
);
