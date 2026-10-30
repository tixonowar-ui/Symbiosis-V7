import { isDeepStrictEqual } from 'node:util';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { PostSaveMetadata } from '@shared/local-character-post-save.js';
import {
  assertLocalCharacterOwnedByDevice,
  loadDeviceId,
  loadLocalCharacterCheckpoint,
  readLocalCharacter,
  readLocalCharacterSkillPresentation,
  readLocalCharacterSymbiontPresentation,
  type LocalCharacter,
  type LocalCharacterCheckpoint,
  type SkillPresentationStage,
  type SymbiontPresentationStage,
} from '../persistence/index.js';
import { parseSkillPresentationStage } from '../persistence/skill-presentation.js';
import { parseSymbiontPresentationStage } from '../persistence/symbiont-presentation.js';
import { validateDurableCreationWizardCheckpoint } from './creation-set-decide.js';
import { validateArchivedLocalExportDocument } from './local-character-archive-export.js';
import {
  canonicalPostSaveJson,
  deriveLocalFinalExport,
  postSaveSha256,
  resolveStoredLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import { metadataForFinal, type LocalPostSaveDependencies } from './local-character-post-save.js';

export interface AdmissionCandidateLimits {
  readonly maxWitnessBytes: number;
}
export interface FinalAdmissionCandidateDescriptor {
  readonly sourceUuid: string;
  readonly sourceSnapshotId: string;
  readonly finalSnapshotVersion: number;
  readonly metadataRevision: number;
  readonly sourceChecksum: string;
  readonly exportChecksum: string;
  readonly exportBytesSha256: string;
  readonly baselineVersion: string;
}
export interface ValidatedFinalAdmissionCandidate {
  readonly descriptor: FinalAdmissionCandidateDescriptor;
  readonly exportDocument: JsonObject;
}
export interface PreparedOwnedFinalAdmissionCandidate extends ValidatedFinalAdmissionCandidate {
  /** Private Node-to-Node evidence: never a projection, readback, or diagnostic payload. */
  readonly canonicalWitnessText: string;
  readonly witnessSha256: string;
  readonly byteLength: number;
}
type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_OWNED_FINAL'
  | 'WITNESS_TOO_LARGE'
  | 'INVALID_WITNESS'
  | 'CANDIDATE_MISMATCH';
type ErrorField =
  | 'limits'
  | 'ownerDeviceId'
  | 'sourceUuid'
  | 'source'
  | 'witness'
  | 'descriptor'
  | 'exportDocument'
  | 'baseline';
export class DeviceAdmissionCandidateError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly field: ErrorField,
  ) {
    super(`device admission candidate: ${code}:${field}`);
  }
}
const fail = (code: ErrorCode, field: ErrorField): never => {
  throw new DeviceAdmissionCandidateError(code, field);
};
function checked<T>(code: ErrorCode, field: ErrorField, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof DeviceAdmissionCandidateError) throw error;
    return fail(code, field);
  }
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !isDeepStrictEqual(Reflect.ownKeys(value).sort(), [...keys].sort()) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (d) => !d.enumerable || !Object.hasOwn(d, 'value'),
    )
  )
    throw new Error('invalid candidate object');
  return value as Record<string, unknown>;
}
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const revision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

function limit(limits: AdmissionCandidateLimits): number {
  return checked('INVALID_INPUT', 'limits', () => {
    const value = object(limits, ['maxWitnessBytes'])['maxWitnessBytes'];
    if (!revision(value) || value === 0) return fail('INVALID_INPUT', 'limits');
    return value;
  });
}
function assertText(
  value: unknown,
  field: 'ownerDeviceId' | 'sourceUuid',
): asserts value is string {
  if (!text(value)) fail('INVALID_INPUT', field);
}

/** Copy only JSON data properties; supplied object accessors never execute in a validator. */
function jsonData(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      value === null ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return value;
    return fail('INVALID_INPUT', 'exportDocument');
  }
  if (Array.isArray(value)) {
    const keys = Array.from({ length: value.length }, (_, index) => String(index));
    if (
      !isDeepStrictEqual(Reflect.ownKeys(value).sort(), [...keys, 'length'].sort()) ||
      keys.some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        return !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
      })
    )
      return fail('INVALID_INPUT', 'exportDocument');
    return value.map(jsonData);
  }
  const fields = object(value, Object.keys(value));
  return Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, jsonData(entry)]));
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const descriptorKeys = [
  'sourceUuid',
  'sourceSnapshotId',
  'finalSnapshotVersion',
  'metadataRevision',
  'sourceChecksum',
  'exportChecksum',
  'exportBytesSha256',
  'baselineVersion',
] as const;
function descriptor(value: unknown): FinalAdmissionCandidateDescriptor {
  return checked('INVALID_INPUT', 'descriptor', () => {
    const d = object(value, descriptorKeys);
    if (
      !text(d['sourceUuid']) ||
      !text(d['sourceSnapshotId']) ||
      !revision(d['finalSnapshotVersion']) ||
      !revision(d['metadataRevision']) ||
      !hash(d['sourceChecksum']) ||
      !hash(d['exportChecksum']) ||
      !hash(d['exportBytesSha256']) ||
      !text(d['baselineVersion'])
    )
      return fail('INVALID_INPUT', 'descriptor');
    return freeze({ ...d }) as unknown as FinalAdmissionCandidateDescriptor;
  });
}
interface PrivateWitness {
  readonly schemaVersion: 1;
  readonly ownerDeviceId: string;
  readonly localCharacter: LocalCharacter;
  readonly checkpoint: LocalCharacterCheckpoint;
  readonly skillPresentationStage: SkillPresentationStage | null;
  readonly symbiontPresentationStage: SymbiontPresentationStage | null;
}
function witnessAt(value: unknown, expectedOwnerDeviceId: string): PrivateWitness {
  const w = object(value, [
    'schemaVersion',
    'ownerDeviceId',
    'localCharacter',
    'checkpoint',
    'skillPresentationStage',
    'symbiontPresentationStage',
  ]);
  if (w['schemaVersion'] !== 1 || w['ownerDeviceId'] !== expectedOwnerDeviceId)
    return fail('INVALID_WITNESS', 'witness');
  const l = object(w['localCharacter'], [
    'localCharacterId',
    'lifecycleState',
    'payloadJson',
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
  ]);
  const c = object(w['checkpoint'], [
    'checkpointId',
    'localCharacterId',
    'checkpointRevision',
    'snapshotJson',
    'snapshotSha256',
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
  ]);
  if (
    !text(l['localCharacterId']) ||
    l['lifecycleState'] !== 'FINAL' ||
    !text(l['payloadJson']) ||
    !text(c['checkpointId']) ||
    c['localCharacterId'] !== l['localCharacterId'] ||
    !revision(c['checkpointRevision']) ||
    !text(c['snapshotJson']) ||
    !hash(c['snapshotSha256']) ||
    ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'].some(
      (key) => !revision(l[key]) || c[key] !== l[key],
    ) ||
    postSaveSha256(c['snapshotJson']) !== c['snapshotSha256'] ||
    c['snapshotJson'] !==
      JSON.stringify({
        localCharacter: {
          localCharacterId: l['localCharacterId'],
          lifecycleState: l['lifecycleState'],
          payloadJson: l['payloadJson'],
        },
      })
  )
    return fail('INVALID_WITNESS', 'witness');
  const skill =
    w['skillPresentationStage'] === null
      ? null
      : parseSkillPresentationStage(w['skillPresentationStage'], 'candidate');
  const symbiont =
    w['symbiontPresentationStage'] === null
      ? null
      : parseSymbiontPresentationStage(w['symbiontPresentationStage'], 'candidate');
  if (
    [skill, symbiont].some((p) => p !== null && p.routeBindings[0]?.value !== l['localCharacterId'])
  )
    return fail('INVALID_WITNESS', 'witness');
  return {
    schemaVersion: 1,
    ownerDeviceId: expectedOwnerDeviceId,
    localCharacter: l as unknown as LocalCharacter,
    checkpoint: c as unknown as LocalCharacterCheckpoint,
    skillPresentationStage: skill,
    symbiontPresentationStage: symbiont,
  };
}
function derive(
  w: PrivateWitness,
  metadata: PostSaveMetadata,
  metadataRevision: number,
  baseline: LocalCharacterExportBaseline,
) {
  const actual = validateDurableCreationWizardCheckpoint(
    w.localCharacter,
    w.checkpoint,
    baseline.catalog.symbionts.skillStage,
    baseline.catalog.symbionts,
    w.skillPresentationStage ?? undefined,
    w.symbiontPresentationStage ?? undefined,
  );
  const identity = actual.finalizationStage?.finalMechanicsSnapshotOrNull?.identity;
  if (
    metadataRevision === 0 &&
    (identity == null ||
      !isDeepStrictEqual(metadata, {
        name: identity.name,
        description: identity.description,
        artAssetKeyOrLocalFile: identity.artAssetKeyOrLocalFile,
      }))
  )
    return fail('CANDIDATE_MISMATCH', 'exportDocument');
  const result = deriveLocalFinalExport(
    actual,
    metadata,
    metadataRevision,
    {
      ownerContext: 'PLAYER_LOCAL',
      sourceKind: 'LOCAL_FINAL',
      originFormId: 'APP-004',
      returnFormId: 'APP-004',
      activeLocalOwnerIdOrNull: w.ownerDeviceId,
      masterAuthorityRevisionOrNull: null,
    },
    baseline,
  );
  const exportDocument = validateArchivedLocalExportDocument(
    JSON.parse(result.contentText),
    baseline,
  );
  const d = descriptor({
    sourceUuid: w.localCharacter.localCharacterId,
    sourceSnapshotId: result.sourceSnapshotId,
    finalSnapshotVersion: result.finalSnapshotVersion,
    metadataRevision,
    sourceChecksum: result.provenance['sourceChecksum'],
    exportChecksum: result.checksum,
    exportBytesSha256: result.bytesSha256,
    baselineVersion: result.baselineVersion,
  });
  return freeze({ descriptor: d, exportDocument });
}

/**
 * Replay proves internal consistency, not an honest remote runtime or a GM admission decision.
 * Caller must separately bind peer keys and authorize payloads. Later metadata is a pinned DTO;
 * its actual private revision chain is checked only by the owning producer.
 */
export function validateFinalAdmissionCandidate(
  witnessText: unknown,
  expectedOwnerDeviceId: string,
  expectedDescriptor: unknown,
  expectedExportDocument: unknown,
  baseline: LocalCharacterExportBaseline,
  limits: AdmissionCandidateLimits,
): ValidatedFinalAdmissionCandidate {
  const maximum = limit(limits);
  assertText(expectedOwnerDeviceId, 'ownerDeviceId');
  if (typeof witnessText !== 'string') return fail('INVALID_INPUT', 'witness');
  if (Buffer.byteLength(witnessText, 'utf8') > maximum) return fail('WITNESS_TOO_LARGE', 'witness');
  const expected = descriptor(expectedDescriptor);
  const sourceBaseline = checked('CANDIDATE_MISMATCH', 'baseline', () =>
    resolveStoredLocalCharacterExportBaseline(baseline, expected.baselineVersion),
  );
  const doc = checked('INVALID_INPUT', 'exportDocument', () =>
    validateArchivedLocalExportDocument(jsonData(expectedExportDocument), sourceBaseline),
  );
  return checked('INVALID_WITNESS', 'witness', () => {
    const raw: unknown = JSON.parse(witnessText);
    if (canonicalPostSaveJson(raw) !== witnessText) return fail('INVALID_WITNESS', 'witness');
    const w = witnessAt(raw, expectedOwnerDeviceId);
    const result = derive(
      w,
      doc['metadata'] as unknown as PostSaveMetadata,
      doc['metadataRevision'] as number,
      sourceBaseline,
    );
    if (
      !isDeepStrictEqual(result.descriptor, expected) ||
      !isDeepStrictEqual(result.exportDocument, doc)
    )
      return fail('CANDIDATE_MISMATCH', 'exportDocument');
    return result;
  });
}

/** Reads original owner-bound FINAL state; it allocates no scope, command, export, or metadata row. */
export function prepareOwnedFinalAdmissionCandidate(
  d: LocalPostSaveDependencies,
  ownerDeviceId: string,
  sourceUuid: string,
  limits: AdmissionCandidateLimits,
): PreparedOwnedFinalAdmissionCandidate {
  const maximum = limit(limits);
  assertText(ownerDeviceId, 'ownerDeviceId');
  assertText(sourceUuid, 'sourceUuid');
  return checked('NOT_OWNED_FINAL', 'source', () => {
    const read = (): PreparedOwnedFinalAdmissionCandidate => {
      if (loadDeviceId(d.database) !== ownerDeviceId)
        return fail('NOT_OWNED_FINAL', 'ownerDeviceId');
      const owner = assertLocalCharacterOwnedByDevice(d.database, sourceUuid, ownerDeviceId);
      const localCharacter = readLocalCharacter(d.database, sourceUuid);
      const checkpoint = loadLocalCharacterCheckpoint(d.database, sourceUuid);
      const skillPresentationStage = readLocalCharacterSkillPresentation(d.database, sourceUuid);
      const symbiontPresentationStage = readLocalCharacterSymbiontPresentation(
        d.database,
        sourceUuid,
      );
      const original = {
        schemaVersion: 1,
        ownerDeviceId,
        localCharacter,
        checkpoint,
        skillPresentationStage,
        symbiontPresentationStage,
      };
      const canonicalWitnessText = canonicalPostSaveJson(original);
      const byteLength = Buffer.byteLength(canonicalWitnessText, 'utf8');
      if (byteLength > maximum) return fail('WITNESS_TOO_LARGE', 'witness');
      const w = witnessAt(original, ownerDeviceId);
      const actual = validateDurableCreationWizardCheckpoint(
        w.localCharacter,
        w.checkpoint,
        d.baseline.catalog.symbionts.skillStage,
        d.baseline.catalog.symbionts,
        w.skillPresentationStage ?? undefined,
        w.symbiontPresentationStage ?? undefined,
      );
      const metadata = metadataForFinal(d, actual);
      const loaded = d.loadCheckpoint(sourceUuid);
      if (
        !d.database.inTransaction ||
        !isDeepStrictEqual(localCharacter, loaded.localCharacter) ||
        !isDeepStrictEqual(checkpoint, loaded.checkpoint) ||
        !isDeepStrictEqual(metadataForFinal(d, loaded), metadata)
      )
        return fail('NOT_OWNED_FINAL', 'source');
      const result = derive(w, metadata.values, metadata.revision, d.baseline);
      if (
        loadDeviceId(d.database) !== ownerDeviceId ||
        !isDeepStrictEqual(
          assertLocalCharacterOwnedByDevice(d.database, sourceUuid, ownerDeviceId),
          owner,
        ) ||
        !isDeepStrictEqual(readLocalCharacter(d.database, sourceUuid), localCharacter) ||
        !isDeepStrictEqual(loadLocalCharacterCheckpoint(d.database, sourceUuid), checkpoint) ||
        !isDeepStrictEqual(
          readLocalCharacterSkillPresentation(d.database, sourceUuid),
          skillPresentationStage,
        ) ||
        !isDeepStrictEqual(
          readLocalCharacterSymbiontPresentation(d.database, sourceUuid),
          symbiontPresentationStage,
        ) ||
        !isDeepStrictEqual(metadataForFinal(d, loaded), metadata)
      )
        return fail('NOT_OWNED_FINAL', 'source');
      return freeze({
        ...result,
        canonicalWitnessText,
        witnessSha256: postSaveSha256(canonicalWitnessText),
        byteLength,
      });
    };
    return d.database.inTransaction ? read() : d.database.transaction(read).deferred();
  });
}
