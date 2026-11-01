import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  baselineFixtureManifest,
  createBaselineLineageFixture,
  BASELINE_FIXTURE_IDS,
} from '../../tests/fixtures/baseline-lineage.js';
import { BASELINE_LINEAGE_SEALS } from './baseline-lineage-seals.js';
import {
  captureReplayCatalogDigests,
  isApprovedBaselineLineagePair,
  verifyHistoricalBaselineLineage,
  verifyHistoricalBaselineManifest,
} from './baseline-lineage.js';
import {
  loadLocalCharacterExportBaseline,
  isStoredLocalCharacterExportBaselineCompatible,
  resolveStoredLocalCharacterExportBaseline,
  postSaveSha256,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';

const seals = BASELINE_LINEAGE_SEALS;
const verify = (
  manifest: Uint8Array,
  catalogs = seals.replayCatalogDigests,
  tuple = seals.runtimeTuple,
) => verifyHistoricalBaselineLineage(manifest, catalogs, tuple);
let fixture: ReturnType<typeof createBaselineLineageFixture>;
let current: LocalCharacterExportBaseline;
beforeAll(async () => {
  fixture = createBaselineLineageFixture('B1');
  current = await loadLocalCharacterExportBaseline(fixture.projectRoot);
});
afterAll(() => fixture?.close());

describe('verified baseline lineage', () => {
  it('accepts only explicit forward pairs among the four reviewed releases', () => {
    const ids = BASELINE_FIXTURE_IDS;
    for (const [from, to] of [
      ['B0', 'B1'],
      ['B0', 'B2'],
      ['B1', 'B2'],
      ['B0', 'B3'],
      ['B1', 'B3'],
      ['B2', 'B3'],
    ] as const) {
      expect(isApprovedBaselineLineagePair(ids[from], ids[to])).toBe(true);
      expect(() =>
        verifyHistoricalBaselineLineage(
          baselineFixtureManifest(to),
          seals.replayCatalogDigests,
          seals.runtimeTuple,
          ids[from],
        ),
      ).not.toThrow();
      expect(isApprovedBaselineLineagePair(ids[to], ids[from])).toBe(false);
      expect(() =>
        verifyHistoricalBaselineLineage(
          baselineFixtureManifest(from),
          seals.replayCatalogDigests,
          seals.runtimeTuple,
          ids[to],
        ),
      ).toThrow('not an approved');
    }
    expect(isApprovedBaselineLineagePair(ids.B1, 'sha256:future')).toBe(false);
    expect(isApprovedBaselineLineagePair('sha256:unknown', ids.B2)).toBe(false);
  });

  it('registers immutable B0 and B1 views under real B2 bytes without rewriting either manifest', async () => {
    const probe = createBaselineLineageFixture('B2');
    try {
      const next = await loadLocalCharacterExportBaseline(probe.projectRoot);
      expect(next.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B2);
      for (const release of ['B0', 'B1'] as const) {
        const id = BASELINE_FIXTURE_IDS[release];
        expect(isStoredLocalCharacterExportBaselineCompatible(next, id)).toBe(true);
        const historical = resolveStoredLocalCharacterExportBaseline(next, id);
        expect(historical.baselineVersion).toBe(id);
        expect(historical.catalog).toBe(next.catalog);
        expect(Object.isFrozen(historical)).toBe(true);
        expect(resolveStoredLocalCharacterExportBaseline(historical, BASELINE_FIXTURE_IDS.B2)).toBe(
          next,
        );
      }
    } finally {
      probe.close();
    }
  });
  it('registers B0/B1/B2 immutable views under exact B3 without losing the old seals', async () => {
    const probe = createBaselineLineageFixture('B3');
    try {
      const next = await loadLocalCharacterExportBaseline(probe.projectRoot);
      expect(next.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B3);
      for (const release of ['B0', 'B1', 'B2'] as const) {
        const prior = resolveStoredLocalCharacterExportBaseline(
          next,
          BASELINE_FIXTURE_IDS[release],
        );
        expect(prior.baselineVersion).toBe(BASELINE_FIXTURE_IDS[release]);
        expect(prior.catalog).toBe(next.catalog);
        expect(Object.isFrozen(prior)).toBe(true);
        expect(() =>
          verifyHistoricalBaselineLineage(
            baselineFixtureManifest('B3'),
            { ...seals.replayCatalogDigests, 'generated/spec/rules/rules.json': '0'.repeat(64) },
            seals.runtimeTuple,
            prior.baselineVersion,
          ),
        ).toThrow('catalog source seal');
      }
      const corrupt = Buffer.concat([baselineFixtureManifest('B3'), Buffer.from('\n')]);
      expect(() =>
        verifyHistoricalBaselineLineage(
          corrupt,
          seals.replayCatalogDigests,
          seals.runtimeTuple,
          BASELINE_FIXTURE_IDS.B2,
        ),
      ).toThrow('not an approved');
    } finally {
      probe.close();
    }
  });

  it('refuses unknown current Atlas bytes before a warm fixture cache can overwrite them', () => {
    const probe = createBaselineLineageFixture('B0');
    try {
      probe.apply('B1');
      probe.apply('B0');
      const atlasPath = join(
        probe.projectRoot,
        'artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json',
      );
      const altered = Buffer.concat([readFileSync(atlasPath), Buffer.from('\n')]);
      const manifestPath = join(probe.projectRoot, 'artifacts/CHECKSUMS.sha256');
      const manifest = readFileSync(manifestPath);
      writeFileSync(atlasPath, altered);
      expect(() => probe.apply('B1')).toThrow('fixture requires exact known Atlas bytes');
      expect(readFileSync(atlasPath).equals(altered)).toBe(true);
      expect(readFileSync(manifestPath).equals(manifest)).toBe(true);
    } finally {
      probe.close();
    }
  });

  it('accepts the two sealed releases with all 24 replay catalogs and the exact tuple', () => {
    expect(Object.keys(seals.replayCatalogDigests)).toHaveLength(24);
    expect(captureReplayCatalogDigests(fixture.projectRoot)).toEqual(seals.replayCatalogDigests);
    expect(() => verify(baselineFixtureManifest('B0'))).not.toThrow();
    expect(() => verify(baselineFixtureManifest('B1'))).not.toThrow();
    const historical = resolveStoredLocalCharacterExportBaseline(current, BASELINE_FIXTURE_IDS.B0);
    expect(historical).not.toBe(current);
    expect(historical.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B0);
    expect(historical.catalog).toBe(current.catalog);
    expect(historical.skillCatalog).toBe(current.skillCatalog);
    expect(Object.isFrozen(historical)).toBe(true);
    expect(resolveStoredLocalCharacterExportBaseline(current, BASELINE_FIXTURE_IDS.B0)).toBe(
      historical,
    );
    expect(resolveStoredLocalCharacterExportBaseline(historical, BASELINE_FIXTURE_IDS.B1)).toBe(
      current,
    );
    expect(current.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B1);
  });

  it('previews registered compatibility without hiding invalid trusted contexts', () => {
    expect(isStoredLocalCharacterExportBaselineCompatible(current, BASELINE_FIXTURE_IDS.B1)).toBe(
      true,
    );
    expect(isStoredLocalCharacterExportBaselineCompatible(current, BASELINE_FIXTURE_IDS.B0)).toBe(
      true,
    );
    expect(isStoredLocalCharacterExportBaselineCompatible(current, 'sha256:unregistered')).toBe(
      false,
    );
    expect(() =>
      isStoredLocalCharacterExportBaselineCompatible({ ...current }, BASELINE_FIXTURE_IDS.B1),
    ).toThrow('unverified');
  });

  it('rejects unknown IDs and structurally identical untrusted contexts', () => {
    expect(() => resolveStoredLocalCharacterExportBaseline(current, 'sha256:unknown')).toThrow(
      'unknown stored baseline',
    );
    expect(() =>
      resolveStoredLocalCharacterExportBaseline({ ...current }, BASELINE_FIXTURE_IDS.B0),
    ).toThrow('unverified');
    expect(() =>
      resolveStoredLocalCharacterExportBaseline(
        { ...current, baselineVersion: BASELINE_FIXTURE_IDS.B0 },
        BASELINE_FIXTURE_IDS.B0,
      ),
    ).toThrow('unverified');
  });

  it('rejects corruption of the historical byte seal', () => {
    const old = baselineFixtureManifest('B0');
    expect(() => verifyHistoricalBaselineManifest(old)).not.toThrow();
    expect(() => verifyHistoricalBaselineManifest(Buffer.concat([old, Buffer.from('\n')]))).toThrow(
      'historical manifest seal',
    );
  });

  it('rejects unapproved Atlas-only successors, non-Atlas changes and changed path sets', () => {
    const text = baselineFixtureManifest('B1').toString('utf8');
    const first = Object.values(seals.successorAtlas)[0]!;
    const nonAtlasDigest = text
      .split(/\r?\n/u)
      .find((line) => line.includes('  registries/'))!
      .slice(0, 64);
    for (const altered of [
      text.replace(first, '0'.repeat(64)),
      text.replace(nonAtlasDigest, '0'.repeat(64)),
      text.replace('atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json', 'atlas/renamed.json'),
      `${text}${'0'.repeat(64)}  extra.json\n`,
      text.split('\n').slice(1).join('\n'),
    ])
      expect(() => verify(Buffer.from(altered))).toThrow();
  });

  it('checks every transitive replay source and refuses missing or additional sources', () => {
    const manifest = baselineFixtureManifest('B1');
    for (const path of Object.keys(seals.replayCatalogDigests))
      expect(() =>
        verifyHistoricalBaselineLineage(
          manifest,
          { ...seals.replayCatalogDigests, [path]: '0'.repeat(64) },
          seals.runtimeTuple,
        ),
      ).toThrow('catalog source seal');
    expect(() => verifyHistoricalBaselineLineage(manifest, {}, seals.runtimeTuple)).toThrow(
      'catalog source seal',
    );
    expect(() =>
      verifyHistoricalBaselineLineage(
        manifest,
        { ...seals.replayCatalogDigests, extra: '0'.repeat(64) },
        seals.runtimeTuple,
      ),
    ).toThrow('catalog source seal');
  });

  it('checks every runtime tuple value and disallows extended tuple claims', () => {
    for (const key of Object.keys(seals.runtimeTuple))
      expect(() =>
        verifyHistoricalBaselineLineage(baselineFixtureManifest('B1'), seals.replayCatalogDigests, {
          ...seals.runtimeTuple,
          [key]: 'unapproved',
        }),
      ).toThrow('runtime contract tuple');
    const extended = { ...seals.runtimeTuple, browserApproved: true };
    expect(() =>
      verifyHistoricalBaselineLineage(
        baselineFixtureManifest('B1'),
        seals.replayCatalogDigests,
        extended,
      ),
    ).toThrow('runtime contract tuple');
  });

  it('detects mutable label-map changes even after issuing a historical view', async () => {
    const mutable = await loadLocalCharacterExportBaseline(fixture.projectRoot);
    const historical = resolveStoredLocalCharacterExportBaseline(mutable, BASELINE_FIXTURE_IDS.B0);
    (mutable.classLabels as Map<string, string>).set('UNKNOWN_CLASS', 'forged label');
    expect(() =>
      resolveStoredLocalCharacterExportBaseline(mutable, BASELINE_FIXTURE_IDS.B1),
    ).toThrow('mutated');
    expect(() =>
      resolveStoredLocalCharacterExportBaseline(historical, BASELINE_FIXTURE_IDS.B0),
    ).toThrow('mutated');
  });

  it('refuses actual self-checksummed unknown B2 while preserving the current-loader ID algorithm', async () => {
    const path = Object.keys(seals.successorAtlas)[0]!;
    const atlasPath = join(fixture.projectRoot, 'artifacts', path);
    const manifestPath = join(fixture.projectRoot, 'artifacts/CHECKSUMS.sha256');
    const oldAtlas = readFileSync(atlasPath);
    const oldManifest = readFileSync(manifestPath);
    try {
      const bytes = Buffer.concat([oldAtlas, Buffer.from('\n')]);
      writeFileSync(atlasPath, bytes);
      const manifest = Buffer.from(
        oldManifest.toString('utf8').replace(postSaveSha256(oldAtlas), postSaveSha256(bytes)),
      );
      writeFileSync(manifestPath, manifest);
      const other = await loadLocalCharacterExportBaseline(fixture.projectRoot);
      expect(other.baselineVersion).toBe(`sha256:${postSaveSha256(manifest)}`);
      expect(() =>
        resolveStoredLocalCharacterExportBaseline(other, BASELINE_FIXTURE_IDS.B0),
      ).toThrow('not an approved historical successor');
      expect(resolveStoredLocalCharacterExportBaseline(other, other.baselineVersion)).toBe(other);
      expect(isStoredLocalCharacterExportBaselineCompatible(other, BASELINE_FIXTURE_IDS.B0)).toBe(
        false,
      );
      expect(isStoredLocalCharacterExportBaselineCompatible(other, other.baselineVersion)).toBe(
        true,
      );
    } finally {
      writeFileSync(atlasPath, oldAtlas);
      writeFileSync(manifestPath, oldManifest);
    }
  });

  it('refuses a changed item replay source even when current export catalogs still load', async () => {
    const path = join(fixture.projectRoot, 'generated/spec/items/weapon-profiles.json');
    const bytes = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([bytes, Buffer.from('\n')]));
      const changed = await loadLocalCharacterExportBaseline(fixture.projectRoot);
      expect(changed.baselineVersion).toBe(BASELINE_FIXTURE_IDS.B1);
      expect(() =>
        resolveStoredLocalCharacterExportBaseline(changed, BASELINE_FIXTURE_IDS.B0),
      ).toThrow('catalog source seal');
      expect(() =>
        isStoredLocalCharacterExportBaselineCompatible(changed, BASELINE_FIXTURE_IDS.B0),
      ).toThrow('catalog source seal');
    } finally {
      writeFileSync(path, bytes);
    }
  });
});
