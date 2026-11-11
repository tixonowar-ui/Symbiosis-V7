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
const admissionManifestUrl = new URL('./baselines/atlas-v1.7.checksums.sha256', import.meta.url);
const lobbyManifestUrl = new URL('./baselines/atlas-v1.8.checksums.sha256', import.meta.url);
const settingsManifestUrl = new URL('./baselines/atlas-v1.9.checksums.sha256', import.meta.url);
const gmSourceManifestUrl = new URL('./baselines/atlas-v1.10.checksums.sha256', import.meta.url);
const queueSourceManifestUrl = new URL('./baselines/atlas-v1.11.checksums.sha256', import.meta.url);
const normalTransferManifestUrl = new URL(
  './baselines/atlas-v1.12.checksums.sha256',
  import.meta.url,
);
const recoveryManifestUrl = new URL('./baselines/atlas-v1.13.checksums.sha256', import.meta.url);
const initialTraumaManifestUrl = new URL(
  './baselines/atlas-v1.14.checksums.sha256',
  import.meta.url,
);
const npcRulesManifestUrl = new URL('./baselines/atlas-v1.15.checksums.sha256', import.meta.url);
const freshTrogrManifestUrl = new URL('./baselines/atlas-v1.16.checksums.sha256', import.meta.url);
const customItemManifestUrl = new URL('./baselines/atlas-v1.17.checksums.sha256', import.meta.url);
const initialLifeManifestUrl = new URL('./baselines/atlas-v1.18.checksums.sha256', import.meta.url);
const initialPoisonManifestUrl = new URL(
  './baselines/atlas-v1.19.checksums.sha256',
  import.meta.url,
);
const systemLibraryManifestUrl = new URL(
  './baselines/atlas-v1.20.checksums.sha256',
  import.meta.url,
);
const atlasPaths = new Set(Object.keys(BASELINE_LINEAGE_SEALS.successorAtlas));

/** Explicit forward pairs only; no semantic-version comparison or inferred transitivity. */
export function isApprovedBaselineLineagePair(stored: string, current: string): boolean {
  const {
    historicalBaselineVersion: b0,
    successorBaselineVersion: b1,
    admissionBaselineVersion: b2,
    lobbyBaselineVersion: b3,
    settingsBaselineVersion: b4,
    gmSourceBaselineVersion: b5,
    queueSourceBaselineVersion: b6,
    normalTransferBaselineVersion: b7,
    recoveryBaselineVersion: b8,
    initialTraumaBaselineVersion: b9,
    npcRulesBaselineVersion: b10,
    freshTrogrBaselineVersion: b11,
    customItemBaselineVersion: b12,
    initialLifeBaselineVersion: b13,
    initialPoisonBaselineVersion: b14,
    systemLibraryBaselineVersion: b15,
    initialSkillPlanBaselineVersion: b16,
  } = BASELINE_LINEAGE_SEALS;
  return (
    (stored === b0 &&
      (current === b0 ||
        current === b1 ||
        current === b2 ||
        current === b3 ||
        current === b4 ||
        current === b5 ||
        current === b6 ||
        current === b7 ||
        current === b8 ||
        current === b9)) ||
    (stored === b1 &&
      (current === b1 ||
        current === b2 ||
        current === b3 ||
        current === b4 ||
        current === b5 ||
        current === b6 ||
        current === b7 ||
        current === b8 ||
        current === b9)) ||
    (stored === b2 &&
      (current === b2 ||
        current === b3 ||
        current === b4 ||
        current === b5 ||
        current === b6 ||
        current === b7 ||
        current === b8 ||
        current === b9)) ||
    (stored === b3 &&
      (current === b3 ||
        current === b4 ||
        current === b5 ||
        current === b6 ||
        current === b7 ||
        current === b8 ||
        current === b9)) ||
    (stored === b4 &&
      (current === b4 ||
        current === b5 ||
        current === b6 ||
        current === b7 ||
        current === b8 ||
        current === b9)) ||
    (stored === b5 &&
      (current === b5 || current === b6 || current === b7 || current === b8 || current === b9)) ||
    (stored === b6 && (current === b6 || current === b7 || current === b8 || current === b9)) ||
    (stored === b7 && (current === b7 || current === b8 || current === b9)) ||
    (stored === b8 && (current === b8 || current === b9)) ||
    (stored === b9 && current === b9) ||
    ((stored === b0 ||
      stored === b1 ||
      stored === b2 ||
      stored === b3 ||
      stored === b4 ||
      stored === b5 ||
      stored === b6 ||
      stored === b7 ||
      stored === b8 ||
      stored === b9 ||
      stored === b10) &&
      current === b10) ||
    ((stored === b0 ||
      stored === b1 ||
      stored === b2 ||
      stored === b3 ||
      stored === b4 ||
      stored === b5 ||
      stored === b6 ||
      stored === b7 ||
      stored === b8 ||
      stored === b9 ||
      stored === b10 ||
      stored === b11) &&
      current === b11) ||
    ((stored === b0 ||
      stored === b1 ||
      stored === b2 ||
      stored === b3 ||
      stored === b4 ||
      stored === b5 ||
      stored === b6 ||
      stored === b7 ||
      stored === b8 ||
      stored === b9 ||
      stored === b10 ||
      stored === b11 ||
      stored === b12) &&
      current === b12) ||
    ((stored === b0 ||
      stored === b1 ||
      stored === b2 ||
      stored === b3 ||
      stored === b4 ||
      stored === b5 ||
      stored === b6 ||
      stored === b7 ||
      stored === b8 ||
      stored === b9 ||
      stored === b10 ||
      stored === b11 ||
      stored === b12 ||
      stored === b13) &&
      current === b13) ||
    ((stored === b0 ||
      stored === b1 ||
      stored === b2 ||
      stored === b3 ||
      stored === b4 ||
      stored === b5 ||
      stored === b6 ||
      stored === b7 ||
      stored === b8 ||
      stored === b9 ||
      stored === b10 ||
      stored === b11 ||
      stored === b12 ||
      stored === b13 ||
      stored === b14) &&
      current === b14) ||
    ((stored === b0 ||
      stored === b1 ||
      stored === b2 ||
      stored === b3 ||
      stored === b4 ||
      stored === b5 ||
      stored === b6 ||
      stored === b7 ||
      stored === b8 ||
      stored === b9 ||
      stored === b10 ||
      stored === b11 ||
      stored === b12 ||
      stored === b13 ||
      stored === b14 ||
      stored === b15) &&
      current === b15) ||
    ((stored === b0 ||
      stored === b1 ||
      stored === b2 ||
      stored === b3 ||
      stored === b4 ||
      stored === b5 ||
      stored === b6 ||
      stored === b7 ||
      stored === b8 ||
      stored === b9 ||
      stored === b10 ||
      stored === b11 ||
      stored === b12 ||
      stored === b13 ||
      stored === b14 ||
      stored === b15 ||
      stored === b16) &&
      current === b16)
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
        : storedBaselineVersion === BASELINE_LINEAGE_SEALS.admissionBaselineVersion
          ? readFileSync(admissionManifestUrl)
          : storedBaselineVersion === BASELINE_LINEAGE_SEALS.lobbyBaselineVersion
            ? readFileSync(lobbyManifestUrl)
            : storedBaselineVersion === BASELINE_LINEAGE_SEALS.settingsBaselineVersion
              ? readFileSync(settingsManifestUrl)
              : storedBaselineVersion === BASELINE_LINEAGE_SEALS.gmSourceBaselineVersion
                ? readFileSync(gmSourceManifestUrl)
                : storedBaselineVersion === BASELINE_LINEAGE_SEALS.queueSourceBaselineVersion
                  ? readFileSync(queueSourceManifestUrl)
                  : storedBaselineVersion === BASELINE_LINEAGE_SEALS.normalTransferBaselineVersion
                    ? readFileSync(normalTransferManifestUrl)
                    : storedBaselineVersion === BASELINE_LINEAGE_SEALS.recoveryBaselineVersion
                      ? readFileSync(recoveryManifestUrl)
                      : storedBaselineVersion ===
                          BASELINE_LINEAGE_SEALS.initialTraumaBaselineVersion
                        ? readFileSync(initialTraumaManifestUrl)
                        : storedBaselineVersion === BASELINE_LINEAGE_SEALS.npcRulesBaselineVersion
                          ? readFileSync(npcRulesManifestUrl)
                          : storedBaselineVersion ===
                              BASELINE_LINEAGE_SEALS.freshTrogrBaselineVersion
                            ? readFileSync(freshTrogrManifestUrl)
                            : storedBaselineVersion ===
                                BASELINE_LINEAGE_SEALS.customItemBaselineVersion
                              ? readFileSync(customItemManifestUrl)
                              : storedBaselineVersion ===
                                  BASELINE_LINEAGE_SEALS.initialLifeBaselineVersion
                                ? readFileSync(initialLifeManifestUrl)
                                : storedBaselineVersion ===
                                    BASELINE_LINEAGE_SEALS.initialPoisonBaselineVersion
                                  ? readFileSync(initialPoisonManifestUrl)
                                  : storedBaselineVersion ===
                                      BASELINE_LINEAGE_SEALS.systemLibraryBaselineVersion
                                    ? readFileSync(systemLibraryManifestUrl)
                                    : currentManifest;
  if (`sha256:${sha256(historicalBytes)}` !== storedBaselineVersion)
    fail('historical manifest seal differs');
  const historical = entries(historicalBytes);
  const current = entries(currentManifest);
  const additions =
    (currentId === BASELINE_LINEAGE_SEALS.gmSourceBaselineVersion ||
      currentId === BASELINE_LINEAGE_SEALS.queueSourceBaselineVersion ||
      currentId === BASELINE_LINEAGE_SEALS.normalTransferBaselineVersion ||
      currentId === BASELINE_LINEAGE_SEALS.recoveryBaselineVersion ||
      currentId === BASELINE_LINEAGE_SEALS.initialTraumaBaselineVersion ||
      currentId === BASELINE_LINEAGE_SEALS.npcRulesBaselineVersion ||
      currentId === BASELINE_LINEAGE_SEALS.freshTrogrBaselineVersion ||
      currentId === BASELINE_LINEAGE_SEALS.customItemBaselineVersion ||
      currentId === BASELINE_LINEAGE_SEALS.initialLifeBaselineVersion ||
      currentId === BASELINE_LINEAGE_SEALS.initialPoisonBaselineVersion ||
      currentId === BASELINE_LINEAGE_SEALS.systemLibraryBaselineVersion ||
      currentId === BASELINE_LINEAGE_SEALS.initialSkillPlanBaselineVersion) &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.gmSourceBaselineVersion &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.queueSourceBaselineVersion &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.normalTransferBaselineVersion &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.recoveryBaselineVersion &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.initialTraumaBaselineVersion &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.npcRulesBaselineVersion &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.freshTrogrBaselineVersion &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.customItemBaselineVersion &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.initialLifeBaselineVersion &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.initialPoisonBaselineVersion &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.systemLibraryBaselineVersion &&
    storedBaselineVersion !== BASELINE_LINEAGE_SEALS.initialSkillPlanBaselineVersion
      ? Object.keys(BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts)
      : [];
  const expectedPaths = new Set([...historical.keys(), ...additions]);
  if (current.size !== expectedPaths.size || [...expectedPaths].some((path) => !current.has(path)))
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
  if (currentId === BASELINE_LINEAGE_SEALS.lobbyBaselineVersion)
    for (const [path, digest] of Object.entries(BASELINE_LINEAGE_SEALS.lobbyAtlas))
      if (current.get(path) !== digest) fail(`approved Atlas bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.settingsBaselineVersion)
    for (const [path, digest] of Object.entries(BASELINE_LINEAGE_SEALS.settingsAtlas))
      if (current.get(path) !== digest) fail(`approved Atlas bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.gmSourceBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.gmSourceAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest) fail(`approved GM source bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.queueSourceBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.queueSourceAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest) fail(`approved queue source bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.normalTransferBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.normalTransferAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest) fail(`approved normal transfer bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.recoveryBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.recoveryAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest) fail(`approved recovery bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.initialTraumaBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.initialTraumaAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest) fail(`approved initial trauma bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.npcRulesBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.npcRulesAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest) fail(`approved NPC rule source bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.freshTrogrBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.freshTrogrAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest) fail(`approved fresh Trogr source bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.customItemBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.customItemAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest) fail(`approved custom item source bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.initialLifeBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.initialLifeAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest) fail(`approved initial life source bytes differ: ${path}`);
  if (currentId === BASELINE_LINEAGE_SEALS.initialPoisonBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.initialPoisonAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest)
        fail('approved initial poison source bytes differ: ' + path);
  if (currentId === BASELINE_LINEAGE_SEALS.systemLibraryBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.systemLibraryAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest)
        fail('approved system library source bytes differ: ' + path);
  if (currentId === BASELINE_LINEAGE_SEALS.initialSkillPlanBaselineVersion)
    for (const [path, digest] of Object.entries({
      ...BASELINE_LINEAGE_SEALS.initialSkillPlanAtlas,
      ...BASELINE_LINEAGE_SEALS.gmSourceAddedArtifacts,
    }))
      if (current.get(path) !== digest)
        fail('approved initial skill-plan source bytes differ: ' + path);
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
