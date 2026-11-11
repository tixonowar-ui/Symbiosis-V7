import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { BASELINE_LINEAGE_SEALS } from './baseline-lineage-seals.js';
import {
  isApprovedBaselineLineagePair,
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

const earlier = [
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
  'B12',
  'B13',
  'B14',
  'B15',
] as const;
it('preserves exact B15 and all B0–B15 views under B16 without upgrading old IDs or manifests', async () => {
  const fixture = createBaselineLineageFixture('B16');
  try {
    const frozen = readFileSync(
      new URL('./baselines/atlas-v1.20.checksums.sha256', import.meta.url),
    );
    expect(frozen.length).toBe(3177);
    expect(createHash('sha256').update(frozen).digest('hex')).toBe(
      '1edfa7ba69d281082f8343b68e9f901cf3cd9cac19535eb73f5145ef94a838a2',
    );
    expect(baselineFixtureManifest('B15').equals(frozen)).toBe(true);
    const path = join(fixture.projectRoot, 'artifacts/CHECKSUMS.sha256'),
      bytes = readFileSync(path);
    const current = await loadLocalCharacterExportBaseline(fixture.projectRoot);
    expect(current.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B16);
    expect(resolveStoredLocalCharacterExportBaseline(current, BASELINE_FIXTURE_IDS.B16)).toBe(
      current,
    );
    for (const release of earlier) {
      const original = baselineFixtureManifest(release),
        stored = resolveStoredLocalCharacterExportBaseline(current, BASELINE_FIXTURE_IDS[release]);
      expect(stored.baselineVersion).toBe(BASELINE_FIXTURE_IDS[release]);
      expect(stored.catalog).toBe(current.catalog);
      expect(Object.isFrozen(stored)).toBe(true);
      expect(resolveStoredLocalCharacterExportBaseline(current, stored.baselineVersion)).toBe(
        stored,
      );
      expect(resolveStoredLocalCharacterExportBaseline(stored, current.baselineVersion)).toBe(
        current,
      );
      expect(baselineFixtureManifest(release).equals(original)).toBe(true);
      expect(
        isApprovedBaselineLineagePair(BASELINE_FIXTURE_IDS.B16, BASELINE_FIXTURE_IDS[release]),
      ).toBe(false);
    }
    expect(() =>
      resolveStoredLocalCharacterExportBaseline({ ...current }, BASELINE_FIXTURE_IDS.B15),
    ).toThrow('unverified');
    expect(() =>
      resolveStoredLocalCharacterExportBaseline(current, 'sha256:unapproved-future'),
    ).toThrow('unknown stored baseline');
    expect(readFileSync(path).equals(bytes)).toBe(true);
    const oldEntries = new Map(
      frozen
        .toString()
        .trimEnd()
        .split('\n')
        .map((line) => [line.slice(66), line.slice(0, 64)]),
    );
    const nextEntries = new Map(
      bytes
        .toString()
        .trimEnd()
        .split('\n')
        .map((line) => [line.slice(66), line.slice(0, 64)]),
    );
    expect([...nextEntries.keys()]).toEqual([...oldEntries.keys()]);
    for (const [name, digest] of oldEntries)
      if (!name.startsWith('atlas/')) expect(nextEntries.get(name)).toBe(digest);
  } finally {
    fixture.close();
  }
});

it('rejects forged B16 manifest identity, path sets and non-Atlas bytes instead of inferring rights from the version', () => {
  const original = baselineFixtureManifest('B16').toString('utf8'),
    path = 'gm-entity-portraits/manifest.json';
  const digest = BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts[path];
  for (const changed of [
    original.replace(digest, '0'.repeat(64)),
    original.replace(path, 'gm-entity-portraits/foreign.json'),
    original.replace(`${digest}  ${path}\n`, ''),
    original + '0'.repeat(64) + '  extra.json\n',
  ]) {
    expect(changed).not.toBe(original);
    expect(() =>
      verifyHistoricalBaselineLineage(
        Buffer.from(changed),
        BASELINE_LINEAGE_SEALS.replayCatalogDigests,
        BASELINE_LINEAGE_SEALS.runtimeTuple,
        BASELINE_FIXTURE_IDS.B15,
      ),
    ).toThrow('not an approved historical successor');
  }
});
