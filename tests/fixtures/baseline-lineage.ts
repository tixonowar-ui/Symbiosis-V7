import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

export type BaselineFixtureRelease = 'B0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5';
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const patchPath = fileURLToPath(new URL('./atlas-177-lineage.patch', import.meta.url));
const admissionPatchPath = fileURLToPath(new URL('./atlas-199-lineage.patch', import.meta.url));
const lobbyPatchPath = fileURLToPath(new URL('./atlas-206-lineage.patch', import.meta.url));
const settingsPatchPath = fileURLToPath(new URL('./atlas-208-lineage.patch', import.meta.url));
const gmSourcePatchPath = fileURLToPath(new URL('./atlas-186-lineage.patch', import.meta.url));
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
type AtlasPath = keyof typeof historicalAtlas;
type AtlasBytes = Record<AtlasPath, Buffer>;
const atlasPaths = Object.keys(historicalAtlas) as AtlasPath[];
const readAtlasBytes = (projectRoot: string): AtlasBytes =>
  Object.fromEntries(
    atlasPaths.map((path) => [path, readFileSync(join(projectRoot, 'artifacts', path))]),
  ) as AtlasBytes;
const matchesAtlas = (bytes: AtlasBytes, digests: Readonly<Record<string, string>>): boolean =>
  atlasPaths.every((path) => sha(bytes[path]) === digests[path]);

// Repeated real git applies dominate these filesystem fixtures. Retain one
// privately verified byte pair, never catalogs or a production baseline context.
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
} as const;
const releaseAtlas = {
  B0: historicalAtlas,
  B1: BASELINE_LINEAGE_SEALS.successorAtlas,
  B2: BASELINE_LINEAGE_SEALS.admissionAtlas,
  B3: BASELINE_LINEAGE_SEALS.lobbyAtlas,
  B4: BASELINE_LINEAGE_SEALS.settingsAtlas,
  B5: BASELINE_LINEAGE_SEALS.gmSourceAtlas,
} as const;

export function baselineFixtureManifest(release: BaselineFixtureRelease): Buffer {
  if (release === 'B0') return Buffer.from(historicalManifest);
  let text = historicalManifest.toString('utf8');
  for (const [path, digest] of Object.entries(releaseAtlas[release])) {
    const prior = historicalAtlas[path as keyof typeof historicalAtlas];
    assert.ok(text.includes(`${prior}  ${path}`));
    text = text.replace(`${prior}  ${path}`, `${digest}  ${path}`);
  }
  if (release === 'B5') {
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
  const releases = ['B0', 'B1', 'B2', 'B3', 'B4', 'B5'] as const;
  const actual =
    releases.find((candidate) => matchesAtlas(before, releaseAtlas[candidate])) ?? null;
  assert.notEqual(actual, null, 'fixture requires exact known Atlas bytes');
  const patchSeal = (): string =>
    sha(
      Buffer.concat([
        readFileSync(patchPath),
        readFileSync(admissionPatchPath),
        readFileSync(lobbyPatchPath),
        readFileSync(settingsPatchPath),
        readFileSync(gmSourcePatchPath),
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
      // Reuse the closest one instead of spawning git again for that same prefix.
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
        for (const path of atlasPaths)
          writeFileSync(join(projectRoot, 'artifacts', path), intermediate[path]);
        assert.ok(matchesAtlas(readAtlasBytes(projectRoot), seal));
      }
      while (position !== target) {
        const reverse = position > target;
        const edge = reverse ? position - 1 : position;
        execFileSync(
          'git',
          [
            '-c',
            'core.autocrlf=false',
            'apply',
            '--no-index',
            ...(reverse ? ['--reverse'] : []),
            edge === 0
              ? patchPath
              : edge === 1
                ? admissionPatchPath
                : edge === 2
                  ? lobbyPatchPath
                  : edge === 3
                    ? settingsPatchPath
                    : gmSourcePatchPath,
          ],
          { cwd: projectRoot, stdio: 'pipe' },
        );
        position += reverse ? -1 : 1;
        const reached = releases[position]!;
        const bytes = readAtlasBytes(projectRoot);
        assert.ok(
          matchesAtlas(bytes, releaseAtlas[reached]),
          'intermediate Atlas bytes differ from their seal',
        );
        verified[reached] = bytes;
      }
    } else {
      assert.ok(matchesAtlas(cached, expected), 'cached Atlas bytes differ from their seal');
      for (const path of atlasPaths)
        writeFileSync(join(projectRoot, 'artifacts', path), cached[path]);
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
    if (release === 'B5') {
      const supplied = readFileSync(join(sourceRoot, 'artifacts', path));
      assert.equal(sha(supplied), digest, 'supplied GM source bytes differ');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, supplied);
    } else if (existsSync(target)) rmSync(target);
  }
  writeFileSync(join(projectRoot, 'artifacts/CHECKSUMS.sha256'), baselineFixtureManifest(release));
}

/** Exact B0–B5 sources use the five reviewed Atlas patches and the three sealed B5 art paths. */
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
