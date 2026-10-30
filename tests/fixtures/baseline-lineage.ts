import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { BASELINE_LINEAGE_SEALS } from '../../src/host/baseline-lineage-seals.js';

export type BaselineFixtureRelease = 'B0' | 'B1';
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const patchPath = fileURLToPath(new URL('./atlas-177-lineage.patch', import.meta.url));
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
export const BASELINE_FIXTURE_IDS = {
  B0: BASELINE_LINEAGE_SEALS.historicalBaselineVersion,
  B1: BASELINE_LINEAGE_SEALS.successorBaselineVersion,
} as const;

export function baselineFixtureManifest(release: BaselineFixtureRelease): Buffer {
  if (release === 'B0') return Buffer.from(historicalManifest);
  let text = historicalManifest.toString('utf8');
  for (const [path, digest] of Object.entries(BASELINE_LINEAGE_SEALS.successorAtlas)) {
    const prior = historicalAtlas[path as keyof typeof historicalAtlas];
    assert.ok(text.includes(`${prior}  ${path}`));
    text = text.replace(`${prior}  ${path}`, `${digest}  ${path}`);
  }
  const bytes = Buffer.from(text);
  assert.equal(`sha256:${sha(bytes)}`, BASELINE_FIXTURE_IDS.B1);
  return bytes;
}

/** Apply the reviewed delivery's real diff; neither generated game catalogs nor hashes are faked. */
export function applyBaselineFixtureRelease(
  projectRoot: string,
  release: BaselineFixtureRelease,
): void {
  const matches = (digests: Readonly<Record<string, string>>): boolean =>
    Object.entries(digests).every(
      ([path, digest]) => sha(readFileSync(join(projectRoot, 'artifacts', path))) === digest,
    );
  const actual = matches(historicalAtlas)
    ? 'B0'
    : matches(BASELINE_LINEAGE_SEALS.successorAtlas)
      ? 'B1'
      : null;
  assert.notEqual(actual, null, 'fixture requires exact known Atlas bytes');
  if (actual !== release)
    execFileSync(
      'git',
      [
        '-c',
        'core.autocrlf=false',
        'apply',
        '--no-index',
        ...(release === 'B0' ? ['--reverse'] : []),
        patchPath,
      ],
      {
        cwd: projectRoot,
        stdio: 'pipe',
      },
    );
  assert.ok(matches(release === 'B0' ? historicalAtlas : BASELINE_LINEAGE_SEALS.successorAtlas));
  writeFileSync(join(projectRoot, 'artifacts/CHECKSUMS.sha256'), baselineFixtureManifest(release));
}

/** Works before and after #177: an exact B1 checkout is reversed to the actual B0 source first. */
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
