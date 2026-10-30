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
  verifyHistoricalBaselineLineage,
  verifyHistoricalBaselineManifest,
} from './baseline-lineage.js';
import {
  loadLocalCharacterExportBaseline,
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
    } finally {
      writeFileSync(path, bytes);
    }
  });
});
