import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { expect, it } from 'vitest';
import { BASELINE_LINEAGE_SEALS } from './baseline-lineage-seals.js';
import { verifyHistoricalBaselineLineage } from './baseline-lineage.js';
import {
  isStoredLocalCharacterExportBaselineCompatible,
  loadLocalCharacterExportBaseline,
  resolveStoredLocalCharacterExportBaseline,
} from './local-character-export.js';
import {
  BASELINE_FIXTURE_IDS,
  baselineFixtureManifest,
  createBaselineLineageFixture,
} from '../../tests/fixtures/baseline-lineage.js';

it('preserves B11 and earlier trusted views under exact B12 without upgrading saved IDs', async () => {
  const fixture = createBaselineLineageFixture('B12');
  try {
    const manifestPath = join(fixture.projectRoot, 'artifacts/CHECKSUMS.sha256');
    const manifest = readFileSync(manifestPath);
    const current = await loadLocalCharacterExportBaseline(fixture.projectRoot);
    expect(current.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B12);
    expect(resolveStoredLocalCharacterExportBaseline(current, BASELINE_FIXTURE_IDS.B12)).toBe(
      current,
    );
    for (const release of [
      'B0',
      'B1',
      'B2',
      'B3',
      'B4',
      'B5',
      'B6',
      'B7',
      'B8',
      'B9',
      'B10',
      'B11',
    ] as const) {
      const bytes = baselineFixtureManifest(release);
      const id = BASELINE_FIXTURE_IDS[release];
      expect(isStoredLocalCharacterExportBaselineCompatible(current, id)).toBe(true);
      const stored = resolveStoredLocalCharacterExportBaseline(current, id);
      expect(stored.baselineVersion).toBe(id);
      expect(stored.catalog).toBe(current.catalog);
      expect(Object.isFrozen(stored)).toBe(true);
      expect(resolveStoredLocalCharacterExportBaseline(current, id)).toBe(stored);
      expect(resolveStoredLocalCharacterExportBaseline(stored, BASELINE_FIXTURE_IDS.B12)).toBe(
        current,
      );
      expect(baselineFixtureManifest(release).equals(bytes)).toBe(true);
    }
    expect(() =>
      resolveStoredLocalCharacterExportBaseline({ ...current }, BASELINE_FIXTURE_IDS.B11),
    ).toThrow('unverified');
    expect(() => resolveStoredLocalCharacterExportBaseline(current, 'sha256:unknown')).toThrow(
      'unknown stored baseline',
    );
    expect(readFileSync(manifestPath).equals(manifest)).toBe(true);
  } finally {
    fixture.close();
  }
});

it('refuses altered B12 path claims instead of inferring compatibility from Atlas version', () => {
  const manifest = baselineFixtureManifest('B12').toString('utf8');
  const inherited = 'gm-entity-portraits/manifest.json';
  const digest = BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts[inherited];
  for (const changed of [
    manifest.replace(inherited, 'gm-entity-portraits/replaced.json'),
    manifest.replace(`${digest}  ${inherited}\n`, ''),
    `${manifest}${'0'.repeat(64)}  unexpected.json\n`,
    manifest.replace(digest, '0'.repeat(64)),
  ]) {
    expect(changed).not.toBe(manifest);
    expect(() =>
      verifyHistoricalBaselineLineage(
        Buffer.from(changed),
        BASELINE_LINEAGE_SEALS.replayCatalogDigests,
        BASELINE_LINEAGE_SEALS.runtimeTuple,
        BASELINE_FIXTURE_IDS.B11,
      ),
    ).toThrow('not an approved historical successor');
  }
});

it('keeps the B11 artifact path set through warm B12 transitions and refuses an actual extra file', async () => {
  const fixture = createBaselineLineageFixture('B11');
  try {
    const directory = join(fixture.projectRoot, 'artifacts');
    const paths = () =>
      readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name !== 'CHECKSUMS.sha256')
        .map((entry) =>
          relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'),
        )
        .sort();
    const originalPaths = paths();
    expect(originalPaths).toHaveLength(25);
    for (const release of ['B12', 'B11', 'B12'] as const) {
      fixture.apply(release);
      expect(paths()).toEqual(originalPaths);
      expect(
        readFileSync(join(directory, 'CHECKSUMS.sha256')).equals(baselineFixtureManifest(release)),
      ).toBe(true);
    }
    const extra = join(directory, 'unexpected.json');
    const bytes = Buffer.from('{}\n');
    writeFileSync(extra, bytes);
    const manifest = readFileSync(join(directory, 'CHECKSUMS.sha256'));
    await expect(loadLocalCharacterExportBaseline(fixture.projectRoot)).rejects.toThrow(
      'baseline manifest does not cover the supplied files',
    );
    expect(readFileSync(extra).equals(bytes)).toBe(true);
    expect(readFileSync(join(directory, 'CHECKSUMS.sha256')).equals(manifest)).toBe(true);
  } finally {
    fixture.close();
  }
});
