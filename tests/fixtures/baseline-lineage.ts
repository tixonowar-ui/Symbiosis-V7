import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { BASELINE_LINEAGE_SEALS } from '../../src/host/baseline-lineage-seals.js';
import {
  FIXTURE_ATLAS_PATHS,
  applyFixtureAtlasPatch,
  readFixtureAtlas,
  writeFixtureAtlas,
  type FixtureAtlasBytes,
} from './baseline-atlas-patch.js';

export type BaselineFixtureRelease =
  'B0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9' | 'B10' | 'B11';
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const patchPath = fileURLToPath(new URL('./atlas-177-lineage.patch', import.meta.url));
const admissionPatchPath = fileURLToPath(new URL('./atlas-199-lineage.patch', import.meta.url));
const lobbyPatchPath = fileURLToPath(new URL('./atlas-206-lineage.patch', import.meta.url));
const settingsPatchPath = fileURLToPath(new URL('./atlas-208-lineage.patch', import.meta.url));
const gmSourcePatchPath = fileURLToPath(new URL('./atlas-186-lineage.patch', import.meta.url));
const queueSourcePatchPath = fileURLToPath(new URL('./atlas-221-lineage.patch', import.meta.url));
const normalTransferPatchPath = fileURLToPath(
  new URL('./atlas-221-transfer-lineage.patch', import.meta.url),
);
const recoveryPatchPath = fileURLToPath(
  new URL('./atlas-221-recovery-lineage.patch', import.meta.url),
);
const initialTraumaPatchPath = fileURLToPath(new URL('./atlas-228-lineage.patch', import.meta.url));
const npcRulesPatchPath = fileURLToPath(new URL('./atlas-232-lineage.patch', import.meta.url));
const freshTrogrPatchPath = fileURLToPath(new URL('./atlas-234-lineage.patch', import.meta.url));
const historicalManifest = readFileSync(
  new URL('../../src/host/baselines/atlas-v1.5.checksums.sha256', import.meta.url),
);
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const historicalAtlas = {
  'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
    'df68aab0bdc09beb5e36369ae33fd1bb293620dfc74664e91a8b95711c972ce5',
  'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
    '2514c723b92847ff3d0f392e35cfb041459b589d0ffc2f79d1b60d2e7456f03e',
};
type AtlasBytes = FixtureAtlasBytes;
const atlasPaths = FIXTURE_ATLAS_PATHS;
const readAtlasBytes = readFixtureAtlas;
const matchesAtlas = (bytes: AtlasBytes, digests: Readonly<Record<string, string>>): boolean =>
  atlasPaths.every((path) => sha(bytes[path]) === digests[path]);

// Retain only privately verified historical byte pairs, never catalogs or a
// production baseline context; every hit still requires current source seals.
let atlasByteCache:
  | {
      readonly patchSha256: string;
      readonly releases: Partial<Record<BaselineFixtureRelease, AtlasBytes>>;
    }
  | undefined;
export const BASELINE_FIXTURE_IDS = {
  B0: BASELINE_LINEAGE_SEALS.historicalBaselineVersion,
  B1: BASELINE_LINEAGE_SEALS.successorBaselineVersion,
  B2: BASELINE_LINEAGE_SEALS.admissionBaselineVersion,
  B3: BASELINE_LINEAGE_SEALS.lobbyBaselineVersion,
  B4: BASELINE_LINEAGE_SEALS.settingsBaselineVersion,
  B5: BASELINE_LINEAGE_SEALS.gmSourceBaselineVersion,
  B6: BASELINE_LINEAGE_SEALS.queueSourceBaselineVersion,
  B7: BASELINE_LINEAGE_SEALS.normalTransferBaselineVersion,
  B8: BASELINE_LINEAGE_SEALS.recoveryBaselineVersion,
  B9: BASELINE_LINEAGE_SEALS.initialTraumaBaselineVersion,
  B10: BASELINE_LINEAGE_SEALS.npcRulesBaselineVersion,
  B11: BASELINE_LINEAGE_SEALS.freshTrogrBaselineVersion,
} as const;
const releaseAtlas = {
  B0: historicalAtlas,
  B1: BASELINE_LINEAGE_SEALS.successorAtlas,
  B2: BASELINE_LINEAGE_SEALS.admissionAtlas,
  B3: BASELINE_LINEAGE_SEALS.lobbyAtlas,
  B4: BASELINE_LINEAGE_SEALS.settingsAtlas,
  B5: BASELINE_LINEAGE_SEALS.gmSourceAtlas,
  B6: BASELINE_LINEAGE_SEALS.queueSourceAtlas,
  B7: BASELINE_LINEAGE_SEALS.normalTransferAtlas,
  B8: BASELINE_LINEAGE_SEALS.recoveryAtlas,
  B9: BASELINE_LINEAGE_SEALS.initialTraumaAtlas,
  B10: BASELINE_LINEAGE_SEALS.npcRulesAtlas,
  B11: BASELINE_LINEAGE_SEALS.freshTrogrAtlas,
} as const;

export function baselineFixtureManifest(release: BaselineFixtureRelease): Buffer {
  if (release === 'B0') return Buffer.from(historicalManifest);
  let text = historicalManifest.toString('utf8');
  for (const [path, digest] of Object.entries(releaseAtlas[release])) {
    const prior = historicalAtlas[path as keyof typeof historicalAtlas];
    assert.ok(text.includes(`${prior}  ${path}`));
    text = text.replace(`${prior}  ${path}`, `${digest}  ${path}`);
  }
  if (
    release === 'B5' ||
    release === 'B6' ||
    release === 'B7' ||
    release === 'B8' ||
    release === 'B9' ||
    release === 'B10' ||
    release === 'B11'
  ) {
    const entries = text.trimEnd().split('\n');
    entries.push(
      ...Object.entries(BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts).map(
        ([path, digest]) => digest + '  ' + path,
      ),
    );
    text =
      entries
        .sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : a.slice(66) > b.slice(66) ? 1 : 0))
        .join('\n') + '\n';
  }
  const bytes = Buffer.from(text);
  assert.equal(`sha256:${sha(bytes)}`, BASELINE_FIXTURE_IDS[release]);
  return bytes;
}

/** Apply the reviewed delivery's real diff; neither generated game catalogs nor hashes are faked. */
export function applyBaselineFixtureRelease(
  projectRoot: string,
  release: BaselineFixtureRelease,
): void {
  const before = readAtlasBytes(projectRoot);
  const releases = [
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
  ] as const;
  // These private bytes cannot change during the synchronous release lookup.
  // Hash each once instead of rehashing the same JSON for every older release.
  const beforeDigests = Object.fromEntries(atlasPaths.map((path) => [path, sha(before[path])]));
  const actual =
    releases.find((candidate) =>
      atlasPaths.every((path) => beforeDigests[path] === releaseAtlas[candidate][path]),
    ) ?? null;
  assert.notEqual(actual, null, 'fixture requires exact known Atlas bytes');
  const patchSeal = (): string =>
    sha(
      Buffer.concat([
        readFileSync(patchPath),
        readFileSync(admissionPatchPath),
        readFileSync(lobbyPatchPath),
        readFileSync(settingsPatchPath),
        readFileSync(gmSourcePatchPath),
        readFileSync(queueSourcePatchPath),
        readFileSync(normalTransferPatchPath),
        readFileSync(recoveryPatchPath),
        readFileSync(initialTraumaPatchPath),
        readFileSync(npcRulesPatchPath),
        readFileSync(freshTrogrPatchPath),
      ]),
    );
  const patchSha256 = patchSeal();
  const expected = releaseAtlas[release];
  const verified: Partial<Record<BaselineFixtureRelease, AtlasBytes>> = { [actual!]: before };
  if (actual !== release) {
    const cached =
      atlasByteCache?.patchSha256 === patchSha256 ? atlasByteCache.releases[release] : undefined;
    if (cached === undefined) {
      let position = releases.indexOf(actual!);
      const target = releases.indexOf(release);
      const lower = Math.min(position, target),
        upper = Math.max(position, target);
      let intermediate: AtlasBytes | undefined;
      // Cached bytes were already sealed under these exact patches.
      // Reuse the closest one instead of applying that same verified prefix again.
      for (let candidate = lower + 1; candidate < upper; candidate += 1) {
        const bytes =
          atlasByteCache?.patchSha256 === patchSha256
            ? atlasByteCache.releases[releases[candidate]!]
            : undefined;
        if (bytes !== undefined && Math.abs(candidate - target) < Math.abs(position - target)) {
          position = candidate;
          intermediate = bytes;
        }
      }
      if (intermediate !== undefined) {
        const seal = releaseAtlas[releases[position]!];
        assert.ok(
          matchesAtlas(intermediate, seal),
          'cached intermediate Atlas differs from its seal',
        );
        writeFixtureAtlas(projectRoot, intermediate, seal);
        assert.ok(matchesAtlas(readAtlasBytes(projectRoot), seal));
      }
      while (position !== target) {
        const reverse = position > target;
        const edge = reverse ? position - 1 : position;
        const patched = applyFixtureAtlasPatch(
          readAtlasBytes(projectRoot),
          readFileSync(
            edge === 0
              ? patchPath
              : edge === 1
                ? admissionPatchPath
                : edge === 2
                  ? lobbyPatchPath
                  : edge === 3
                    ? settingsPatchPath
                    : edge === 4
                      ? gmSourcePatchPath
                      : edge === 5
                        ? queueSourcePatchPath
                        : edge === 6
                          ? normalTransferPatchPath
                          : edge === 7
                            ? recoveryPatchPath
                            : edge === 8
                              ? initialTraumaPatchPath
                              : edge === 9
                                ? npcRulesPatchPath
                                : freshTrogrPatchPath,
          ),
          reverse,
        );
        position += reverse ? -1 : 1;
        const reached = releases[position]!;
        writeFixtureAtlas(projectRoot, patched, releaseAtlas[reached]);
        const bytes = readAtlasBytes(projectRoot);
        assert.ok(
          matchesAtlas(bytes, releaseAtlas[reached]),
          'intermediate Atlas bytes differ from their seal',
        );
        verified[reached] = bytes;
      }
    } else {
      assert.ok(matchesAtlas(cached, expected), 'cached Atlas bytes differ from their seal');
      writeFixtureAtlas(projectRoot, cached, expected);
    }
  }
  const after = readAtlasBytes(projectRoot);
  assert.ok(matchesAtlas(after, expected));
  assert.equal(patchSeal(), patchSha256, 'fixture patch changed during apply');
  atlasByteCache = {
    patchSha256,
    releases: {
      ...(atlasByteCache?.patchSha256 === patchSha256 ? atlasByteCache.releases : {}),
      ...verified,
      [release]: after,
    },
  };
  // Historical roots must contain exactly their own artifact set, even when the Atlas cache is warm.
  for (const [path, digest] of Object.entries(BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts)) {
    const target = join(projectRoot, 'artifacts', path);
    if (existsSync(target))
      assert.equal(sha(readFileSync(target)), digest, 'fixture GM source bytes changed');
    if (
      release === 'B5' ||
      release === 'B6' ||
      release === 'B7' ||
      release === 'B8' ||
      release === 'B9' ||
      release === 'B10' ||
      release === 'B11'
    ) {
      const supplied = readFileSync(join(sourceRoot, 'artifacts', path));
      assert.equal(sha(supplied), digest, 'supplied GM source bytes differ');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, supplied);
    } else if (existsSync(target)) rmSync(target);
  }
  writeFileSync(join(projectRoot, 'artifacts/CHECKSUMS.sha256'), baselineFixtureManifest(release));
}

/** Exact B0–B11 sources use eleven reviewed Atlas patches and the three sealed B5–B11 art paths. */
export function createBaselineLineageFixture(release: BaselineFixtureRelease = 'B0') {
  const directory = mkdtempSync(join(tmpdir(), 'symbiosis-baseline-lineage-'));
  const projectRoot = join(directory, 'project');
  try {
    cpSync(join(sourceRoot, 'artifacts'), join(projectRoot, 'artifacts'), { recursive: true });
    cpSync(join(sourceRoot, 'generated/spec'), join(projectRoot, 'generated/spec'), {
      recursive: true,
    });
    applyBaselineFixtureRelease(projectRoot, release);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    directory,
    projectRoot,
    apply: (next: BaselineFixtureRelease) => applyBaselineFixtureRelease(projectRoot, next),
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}
