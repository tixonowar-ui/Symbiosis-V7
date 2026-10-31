import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { BASELINE_LINEAGE_SEALS } from './baseline-lineage-seals.js';

export type ReplayCatalogDigests = Readonly<Record<string, string>>;
export interface BaselineRuntimeTuple {
  readonly registryVersion: string;
  readonly catalogVersion: string;
  readonly builtAgainstTuple: string;
}
const fail = (detail: string): never => {
  throw new Error(`baseline lineage: ${detail}`);
};
const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const historicalManifestUrl = new URL('./baselines/atlas-v1.5.checksums.sha256', import.meta.url);
const successorManifestUrl = new URL('./baselines/atlas-v1.6.checksums.sha256', import.meta.url);
const atlasPaths = new Set(Object.keys(BASELINE_LINEAGE_SEALS.successorAtlas));

/** Explicit forward pairs only; no semantic-version comparison or inferred transitivity. */
export function isApprovedBaselineLineagePair(stored: string, current: string): boolean {
  const {
    historicalBaselineVersion: b0,
    successorBaselineVersion: b1,
    admissionBaselineVersion: b2,
  } = BASELINE_LINEAGE_SEALS;
  return (
    (stored === b0 && (current === b0 || current === b1 || current === b2)) ||
    (stored === b1 && (current === b1 || current === b2)) ||
    (stored === b2 && current === b2)
  );
}

function entries(bytes: Uint8Array): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const line of Buffer.from(bytes).toString('utf8').split(/\r?\n/u)) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
    const path = match?.[2];
    if (
      path === undefined ||
      path.includes('\\') ||
      path.includes(':') ||
      posix.isAbsolute(path) ||
      posix.normalize(path) !== path ||
      path === '..' ||
      path.startsWith('../') ||
      result.has(path)
    )
      return fail('malformed or unsafe manifest');
    result.set(path, match![1]!);
  }
  if (result.size === 0) return fail('empty manifest');
  return result;
}

/** Bytes are sealed outside artifacts, so the current manifest never contains its own hash. */
export function verifyHistoricalBaselineManifest(bytes: Uint8Array): void {
  if (`sha256:${sha256(bytes)}` !== BASELINE_LINEAGE_SEALS.historicalBaselineVersion)
    fail('historical manifest seal differs');
  entries(bytes);
}

export function captureReplayCatalogDigests(projectRoot: string): ReplayCatalogDigests {
  return Object.freeze(
    Object.fromEntries(
      Object.keys(BASELINE_LINEAGE_SEALS.replayCatalogDigests).map((path) => [
        path,
        sha256(readFileSync(join(projectRoot, ...path.split('/')))),
      ]),
    ),
  );
}

/** The loader brackets catalog construction; a concurrently changed source is not registered. */
export function assertReplayCatalogDigestsUnchanged(
  projectRoot: string,
  before: ReplayCatalogDigests,
): void {
  const after = captureReplayCatalogDigests(projectRoot);
  if (JSON.stringify(before) !== JSON.stringify(after))
    fail('catalog sources changed while loading');
}

/**
 * Pure verification of loader-owned evidence. This function issues no context or
 * authority: only loadLocalCharacterExportBaseline can register a trusted object.
 */
export function verifyHistoricalBaselineLineage(
  currentManifest: Uint8Array,
  catalogDigests: ReplayCatalogDigests,
  tuple: BaselineRuntimeTuple,
  storedBaselineVersion: string = BASELINE_LINEAGE_SEALS.historicalBaselineVersion,
): void {
  const currentId = `sha256:${sha256(currentManifest)}`;
  if (!isApprovedBaselineLineagePair(storedBaselineVersion, currentId))
    fail('current release is not an approved historical successor');
  const historicalBytes =
    storedBaselineVersion === BASELINE_LINEAGE_SEALS.historicalBaselineVersion
      ? readFileSync(historicalManifestUrl)
      : storedBaselineVersion === BASELINE_LINEAGE_SEALS.successorBaselineVersion
        ? readFileSync(successorManifestUrl)
        : currentManifest;
  if (`sha256:${sha256(historicalBytes)}` !== storedBaselineVersion)
    fail('historical manifest seal differs');
  const historical = entries(historicalBytes);
  const current = entries(currentManifest);
  if (current.size !== historical.size || [...historical.keys()].some((path) => !current.has(path)))
    fail('manifest path set differs');
  for (const [path, digest] of historical) {
    if (!atlasPaths.has(path) && current.get(path) !== digest)
      fail(`non-Atlas artifact differs: ${path}`);
  }
  if (currentId === BASELINE_LINEAGE_SEALS.successorBaselineVersion)
    for (const [path, digest] of Object.entries(BASELINE_LINEAGE_SEALS.successorAtlas))
      if (current.get(path) !== digest) fail(`approved Atlas bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.admissionBaselineVersion)
    for (const [path, digest] of Object.entries(BASELINE_LINEAGE_SEALS.admissionAtlas))
      if (current.get(path) !== digest) fail(`approved Atlas bytes differ: ${path}`);
  const expected = BASELINE_LINEAGE_SEALS.replayCatalogDigests;
  if (
    Object.keys(catalogDigests).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([path, digest]) => catalogDigests[path] !== digest)
  )
    fail('replay catalog source seal differs');
  if (
    Object.keys(tuple).length !== 3 ||
    tuple.registryVersion !== BASELINE_LINEAGE_SEALS.runtimeTuple.registryVersion ||
    tuple.catalogVersion !== BASELINE_LINEAGE_SEALS.runtimeTuple.catalogVersion ||
    tuple.builtAgainstTuple !== BASELINE_LINEAGE_SEALS.runtimeTuple.builtAgainstTuple
  )
    fail('runtime contract tuple differs');
}
