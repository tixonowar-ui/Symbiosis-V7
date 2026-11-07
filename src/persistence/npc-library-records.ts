import {
  readNpcCompositionConfirmation,
  readNpcCompositionResolution,
} from '../domain/rules/npc-authoring/composition-consequences.js';
import type {
  NpcCompositionConfirmation,
  NpcCompositionResolution,
} from '../domain/rules/npc-authoring/composition-consequence-types.js';
import {
  readNpcOrdinaryStatFact,
  type NpcOrdinaryStatFact,
} from '../domain/rules/npc-authoring/ordinary-humanoid-proof.js';
import type { NpcAttemptPreparationContext } from './npc-library-store.js';
import {
  npcLifeStateRollFactValue,
  verifyNpcLifeRollFactBinding,
  type NpcLifeStateRollFact,
} from './npc-life-facts.js';
import type { NpcPreparationRequest } from '@shared/npc-command.js';
import type { DiseaseId } from '@generated/types/effects.js';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import {
  npcChildAllocationsValue,
  type NpcChildAllocation,
  type NpcAttemptReadContext,
  type NpcPublishedChildGraph,
} from './npc-child-identities.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { CampaignCheckpoint, RevisionTriple } from './store.js';
import { npcWorkflowCommandRequestValue } from '@shared/npc-command.js';
import { networkApplicationStorage as s } from './network-local-application.js';

export const NPC_STAGES = [
  'NPC-002',
  'NPC-011',
  'NPC-012',
  'NPC-013',
  'NPC-014',
  'NPC-015',
  'NPC-016',
  'NPC-017',
] as const;
export type NpcStage = (typeof NPC_STAGES)[number];
export interface NpcScope {
  readonly campaignId: string;
  readonly gmLocalContextId: string;
  readonly ownerDeviceId: string;
}
export interface NpcAnchor {
  readonly libraryRevision: number;
  readonly checkpointId: string;
  readonly checkpointSha256: string;
}
export interface NpcTarget {
  readonly npcUuid: string;
  readonly expectedCurrentVersion: number;
}
export interface NpcIdentityReservation {
  readonly campaignId: string;
  readonly npcDraftId: string;
  readonly candidateNpcUuid: string;
  readonly createOperationId: string;
}
export interface NpcAttempt {
  readonly scope: NpcScope;
  readonly npcDraftId: string;
  readonly candidateNpcUuid: string;
  readonly revision: number;
  readonly mode: 'CREATE_V1' | 'APPEND_N_PLUS_ONE';
  readonly targetOrNull: NpcTarget | null;
  readonly stage: NpcStage;
  readonly status: 'OPEN' | 'CANCELLED' | 'COMMITTED';
  readonly values: JsonObject;
}
/** Ephemeral evidence from the complete structural admission/lobby/GM fold, never persisted. */
export interface NpcCalendarClock {
  readonly phase: 'PRE_START' | 'POST_START';
  readonly campaignTimestampOrNull: number | null;
  /** Exact lobby projection seal when supplied by the structural reader, never a clock-source alias. */
  readonly lobbySnapshotRevisionOrNull?: string | null;
  readonly sourceOrNull: Readonly<{
    kind: 'INITIAL_TIME' | 'START';
    commandId: string;
    recordSha256: string;
  }> | null;
}
export interface NpcCalendarOperationProof {
  readonly operationId: string;
  readonly operationSha256: string;
  readonly beforeCheckpointSha256: string;
  readonly beforeGmSource: NpcGmSource;
  readonly kind: NpcOperationKind;
  readonly committedAt: string;
  readonly versionOrNull: NpcVersionRef | null;
  readonly clock: NpcCalendarClock;
}
export interface NpcCalendarReadContext {
  readonly format: 'NPC_CALENDAR_READ_V1';
  readonly scope: NpcScope;
  readonly checkpoint: CampaignCheckpoint;
  readonly currentQueuePrefixOrNull: NpcGmSource['queuePrefix'] | null;
  readonly currentClock: NpcCalendarClock;
  readonly operations: readonly NpcCalendarOperationProof[];
}
/** Actual fresh writer allocation, deliberately separate from already persisted calendar operations. */
export interface NpcPendingCommitEvidence {
  readonly kind: 'PENDING_NPC_COMMIT';
  readonly scope: NpcScope;
  readonly operationId: string;
  readonly npcUuid: string;
  readonly npcDraftId: string;
  readonly version: number;
  readonly attemptRevision: number;
  readonly committedAt: string;
  readonly beforeCheckpointSha256: string;
  readonly beforeGmSource: NpcGmSource;
}
/** One complete stored-version read; ephemeral selectors never become persisted evidence. */
export interface NpcStoredSnapshotInspection {
  readonly snapshot: JsonObject;
  readonly publishedChildGraph: NpcPublishedChildGraph;
  readonly requiredPreStartTimeOrNull: number | null;
}
/** Required closed domain readers. An identity/JSON-only reader is NOT a domain implementation. */
export interface NpcDomainReaders {
  /** Stored versions only: rebuild once from this SQL snapshot; never retain between reads. */
  readonly inspectStoredSnapshot: (
    value: unknown,
    calendar: NpcCalendarReadContext | null,
  ) => NpcStoredSnapshotInspection;
  /** A complete checked sheet and its actual COMMIT clock determine the irreversible first lock. */
  readonly requiredPreStartTime: (
    snapshot: JsonObject,
    calendar: NpcCalendarReadContext | null,
    pending: NpcPendingCommitEvidence | null,
  ) => number | null;
  readonly attempt: (
    stage: NpcStage,
    value: unknown,
    context: NpcAttemptReadContext | null,
  ) => JsonObject;
  /** Extract only after actual source-backed snapshot validation, including proven empty inventory. */
  readonly publishedChildGraph: (
    snapshot: JsonObject,
    calendar: NpcCalendarReadContext | null,
    pending: NpcPendingCommitEvidence | null,
  ) => NpcPublishedChildGraph;
  readonly snapshot: (
    value: unknown,
    calendar: NpcCalendarReadContext | null,
    pending: NpcPendingCommitEvidence | null,
  ) => JsonObject;
  readonly lifetimeFacts: (value: unknown) => JsonObject;
  /** CREATE must be exactly empty; OPEN must reproduce its checked immutable base version. */
  readonly validateAttemptOrigin: (
    attempt: NpcAttempt,
    operation: NpcOperation,
    baseVersionOrNull: NpcVersion | null,
    calendar: NpcCalendarReadContext | null,
  ) => void;
  /** Required only for ITEM_RESERVE; absence means this reader does not implement preparation. */
  readonly validateItemReservation?: (
    previous: JsonObject,
    input: JsonObject,
    context: NpcAttemptReadContext,
  ) => void;
  /** Required only for DISEASE_RESERVE; no effect is materialized by this technical intent. */
  readonly validateDiseaseReservation?: (
    previous: JsonObject,
    diseaseId: DiseaseId,
    context: NpcAttemptReadContext,
  ) => void;
  /** Required only for TRAUMA_RESERVE; the reserved row has no resolved trauma value. */
  readonly validateTraumaReservation?: (
    previous: JsonObject,
    context: NpcAttemptReadContext,
  ) => void;
  readonly validateWoundPreparation?: (
    previous: JsonObject,
    input: JsonObject,
    context: NpcAttemptReadContext,
  ) => void;
  readonly validateEquipmentCompatibilityPreparation?: (
    previous: JsonObject,
    input: JsonObject,
    context: NpcAttemptReadContext,
  ) => void;
  readonly validateCompositeItemReservation?: (
    previous: JsonObject,
    input: JsonObject,
    context: NpcAttemptReadContext,
  ) => void;
  readonly validateCustomItemPreparation?: (
    request: NpcPreparationRequest,
    context: NpcAttemptPreparationContext,
  ) => void;
  readonly validateItemRestorePreparation?: (
    request: NpcPreparationRequest,
    context: NpcAttemptPreparationContext,
  ) => void;
  readonly validateRuntimeEffectPreparation?: (
    request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-016' }>,
    context: NpcAttemptPreparationContext,
  ) => void;
  readonly validateLifeStatePreparation?: (
    request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-016' }>,
    context: NpcAttemptPreparationContext,
  ) => void;
  readonly validateWeaverStatePreparation?: (
    request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-016' }>,
    context: NpcAttemptPreparationContext,
  ) => void;
  readonly validatePoisonPreparation?: (
    request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-015' | 'NPC-016' }>,
    context: NpcAttemptPreparationContext,
  ) => void;
  readonly validateSymbiontReservation?: (
    previous: JsonObject,
    input: JsonObject,
    context: NpcAttemptReadContext,
  ) => void;
  /** Exact checked BEFORE context, before any roll or fact allocation. */
  readonly validateCompositionPreparation?: (
    request: Extract<NpcPreparationRequest, { sourceFormId: 'NPC-013' }>,
    context: NpcAttemptPreparationContext,
  ) => void;
  /** Required only for ART preparation; absent capability refuses before the factory runs. */
  readonly validateArtPreparation?: (
    previous: JsonObject,
    input: JsonObject,
    context: NpcAttemptReadContext,
  ) => void;
  /** Full source-backed derivation/bindings, including art/time/fact prefix; no default implementation. */
  readonly validateVersion: (
    version: NpcVersion,
    committedAttempt: NpcAttempt,
    previousVersionOrNull: NpcVersion | null,
    calendar: NpcCalendarReadContext | null,
    pending: NpcPendingCommitEvidence | null,
  ) => void;
}
export interface NpcArtBlob {
  readonly mediaType: 'image/png' | 'image/jpeg';
  readonly sha256: string;
  readonly bytesBase64: string;
}
export interface NpcArt extends NpcArtBlob {
  readonly assetKey: string;
}
export interface NpcVersion {
  readonly scope: NpcScope;
  readonly npcUuid: string;
  readonly version: number;
  readonly libraryRevision: number;
  readonly operationId: string;
  readonly npcDraftId: string;
  readonly attemptRevision: number;
  readonly previousVersionSha256OrNull: string | null;
  readonly snapshot: JsonObject;
  readonly lifetimeFacts: JsonObject;
  readonly art: { readonly assetKey: string; readonly sha256: string };
  readonly committedAt: string;
}
export interface NpcTimeLock {
  readonly campaignTimestamp: number;
  readonly operationId: string;
  readonly npcUuid: string;
  readonly version: number;
}
export interface NpcVersionRef {
  readonly npcUuid: string;
  readonly version: number;
  readonly sha256: string;
}
export interface NpcLibraryBlock {
  readonly format: 'NPC_LIBRARY_RECOVERY_V1';
  readonly campaignId: string;
  readonly libraryRevision: number;
  readonly checkpointId: string;
  readonly versions: readonly NpcVersionRef[];
  readonly heads: readonly NpcVersionRef[];
  readonly artSha256s: readonly string[];
  readonly initialTimeLockOrNull: NpcTimeLock | null;
}
export type NpcOperationKind = 'CREATE' | 'REPLACE' | 'CANCEL' | 'OPEN' | 'COMMIT_V1' | 'COMMIT';
/** Immutable host-issued facts, deliberately outside editable stage values. */
export type NpcOrdinaryAuthoringFact =
  | Readonly<{ kind: 'STAT_CONTEXT'; statContext: NpcOrdinaryStatFact }>
  | Readonly<{
      kind: 'CONFIRMATION';
      confirmation: NpcCompositionConfirmation;
      beforeStatContext: NpcOrdinaryStatFact;
      statContext: NpcOrdinaryStatFact;
    }>
  | Readonly<{
      kind: 'RESOLUTION';
      resolution: NpcCompositionResolution;
      statContext: NpcOrdinaryStatFact;
    }>;
export function npcOrdinaryAuthoringFactValue(value: unknown): NpcOrdinaryAuthoringFact {
  const r = s.object(value);
  if (r['kind'] === 'STAT_CONTEXT') {
    s.object(r, ['kind', 'statContext']);
    return { kind: 'STAT_CONTEXT', statContext: readNpcOrdinaryStatFact(r['statContext']) };
  }
  if (r['kind'] === 'CONFIRMATION') {
    s.object(r, ['kind', 'confirmation', 'beforeStatContext', 'statContext']);
    return {
      kind: 'CONFIRMATION',
      confirmation: readNpcCompositionConfirmation(r['confirmation']),
      beforeStatContext: readNpcOrdinaryStatFact(r['beforeStatContext']),
      statContext: readNpcOrdinaryStatFact(r['statContext']),
    };
  }
  if (r['kind'] === 'RESOLUTION') {
    s.object(r, ['kind', 'resolution', 'statContext']);
    return {
      kind: 'RESOLUTION',
      resolution: readNpcCompositionResolution(r['resolution']),
      statContext: readNpcOrdinaryStatFact(r['statContext']),
    };
  }
  return s.fail('INVALID_INPUT');
}
export function npcEventOrdinaryFact(event: NpcAttemptEvent): NpcOrdinaryAuthoringFact | null {
  return 'format' in event ? (event.ordinaryFact ?? null) : null;
}
/** Intrinsic origin only. The owning adapter must also replay the exact immutable prefix. */
export function verifyNpcOrdinaryFactBinding(
  fact: NpcOrdinaryAuthoringFact | null,
  operation: NpcOperation,
  attempt: Pick<NpcAttempt, 'stage' | 'status'>,
): void {
  const r = operation.request;
  const preparation =
    r['messageType'] === 'network.npc-preparation.request' ? s.object(r['preparation']) : null;
  const kind = preparation?.['kind'];
  const expected =
    kind === 'COMPOSITION_CONFIRM'
      ? fact?.kind === 'STAT_CONTEXT'
        ? 'STAT_CONTEXT'
        : 'CONFIRMATION'
      : kind === 'COMPOSITION_RESOLVE'
        ? 'RESOLUTION'
        : null;
  if (expected === null) {
    if (fact !== null) return s.fail();
    return;
  }
  if (
    fact === null ||
    fact.kind !== expected ||
    operation.kind !== 'REPLACE' ||
    r['sourceFormId'] !== 'NPC-013' ||
    attempt.stage !== 'NPC-013' ||
    attempt.status !== 'OPEN'
  )
    return s.fail();
  if (fact.statContext.contextFactId !== operation.operationId) return s.fail();
  if (fact.kind === 'STAT_CONTEXT') return;
  const original = fact.kind === 'CONFIRMATION' ? fact.confirmation.input : fact.resolution;
  if (original.factId !== operation.operationId) return s.fail();
  if (
    fact.kind === 'CONFIRMATION' &&
    (fact.confirmation.confirmationCommandId !== operation.operationId ||
      fact.beforeStatContext.contextFactId !== `NPC_STAT_CONTEXT/${operation.operationId}/BEFORE`)
  )
    return s.fail();
}
interface NpcAttemptEventFields {
  readonly operationId: string;
  readonly previousSha256OrNull: string | null;
  readonly attempt: NpcAttempt;
}
/** Both saved shapes remain exact; no old record is rewritten or normalized to V2. */
export type NpcAttemptEvent =
  | NpcAttemptEventFields
  | (NpcAttemptEventFields & {
      readonly format: 'NPC_ATTEMPT_EVENT_V2';
      readonly childAllocations: readonly NpcChildAllocation[];
      readonly ordinaryFact?: NpcOrdinaryAuthoringFact;
      readonly lifeStateFact?: NpcLifeStateRollFact;
    });
export function npcEventLifeStateFact(event: NpcAttemptEvent): NpcLifeStateRollFact | null {
  return 'format' in event ? (event.lifeStateFact ?? null) : null;
}
export const NPC_SOURCE_FORMS = ['NPC-001', 'NPC-003', 'NPC-007', ...NPC_STAGES] as const;
export interface NpcGmSource {
  readonly sourceFormId: (typeof NPC_SOURCE_FORMS)[number];
  readonly revisions: RevisionTriple;
  readonly sourceSnapshotSha256: string;
  readonly queuePrefix: { readonly eventId: string; readonly recordSha256: string };
}
/** Mandatory owning GM fold: source prefix, actual selected attempt/NPC, CTA transition and one mirror.
 * It must not rebuild this proof from the request or recursively call the full NPC closure.
 */
export interface NpcHistoricalSourceEntry {
  readonly operation: NpcOperation;
  readonly event: NpcAttemptEvent;
  readonly previous: NpcAttemptEvent | null;
  readonly readContext: NpcAttemptReadContext;
  readonly previousReadContextOrNull: NpcAttemptReadContext | null;
}
export interface NpcHistoricalSourceReader {
  /** Mandatory phase 0. Only explicitly primitive, non-version fixtures may return null. */
  readonly createReadContext: (campaignId: string) => NpcCalendarReadContext | null;
  /** One closed read invocation; every entry remains checked against its exact immutable GM prefix. */
  readonly validateHistoricalGmSources: (
    entries: readonly NpcHistoricalSourceEntry[],
    calendar: NpcCalendarReadContext | null,
  ) => void;
}
export type NpcTechnicalBinding =
  | {
      readonly kind: 'FORM_ACTION';
      readonly navigationRequestId: string;
      readonly sourceFormId: NpcGmSource['sourceFormId'];
      readonly expectedProjectionRevision: number;
    }
  | {
      readonly kind: 'DRAFT_REPLACE';
      readonly operationId: string;
      readonly campaignId: string;
      readonly npcDraftId: string;
      readonly expectedAttemptRevision: number;
      readonly expectedRevisions: RevisionTriple;
    };
export interface NpcOperation {
  readonly operationId: string;
  readonly receiptId: string;
  readonly kind: NpcOperationKind;
  readonly scope: NpcScope;
  /** Exact canonical authenticated request, checked by the mandatory workflow/technical reader. */
  readonly request: JsonObject;
  readonly attemptEventSha256: string;
  readonly versionOrNull: NpcVersionRef | null;
  readonly anchorOrNull: NpcAnchor | null;
  readonly beforeGmSource: NpcGmSource;
  readonly beforeCheckpoint: CampaignCheckpoint;
  readonly afterCheckpoint: CampaignCheckpoint;
  readonly committedAt: string;
}
export interface NpcRequestReader {
  readonly request: (kind: NpcOperationKind, value: unknown) => JsonObject;
  /** Technical transport is not an invented UI-CMD. Its concrete codec must prove these echoes. */
  readonly technicalBinding: (
    kind: 'CREATE' | 'REPLACE' | 'CANCEL',
    request: JsonObject,
  ) => NpcTechnicalBinding;
}
export function npcGmSourceValue(value: unknown): NpcGmSource {
  const row = s.object(value, ['sourceFormId', 'revisions', 'sourceSnapshotSha256', 'queuePrefix']);
  const prefix = s.object(row['queuePrefix'], ['eventId', 'recordSha256']);
  const revisions = s.vector(row['revisions']);
  if (
    revisions.projectionRevision < revisions.stateRevision ||
    revisions.actorVisibilityRevision > revisions.stateRevision
  )
    return s.fail();
  return {
    sourceFormId: NPC_SOURCE_FORMS.find((form) => form === row['sourceFormId']) ?? s.fail(),
    revisions,
    sourceSnapshotSha256: s.hash(row['sourceSnapshotSha256']),
    queuePrefix: {
      eventId: s.text(prefix['eventId']),
      recordSha256: s.hash(prefix['recordSha256']),
    },
  };
}
/** Capture the original callable inside the SQL guard, before a wrapper could hide native async.
 * The surrounding guard still rejects writes, argument mutation and non-void return values.
 */
export function npcSynchronousValidator<T extends (...args: never[]) => void>(callback: T): T {
  if (
    typeof callback !== 'function' ||
    types.isAsyncFunction(callback) ||
    Object.prototype.toString.call(callback) === '[object AsyncFunction]'
  )
    return s.fail('INVALID_INPUT');
  return callback;
}
/** Resolve the shared primitive at call time: GM queue and local history import each other. */
export function npcRecord(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  return s.object(value, keys);
}
export function closedDocument(value: unknown, read: (value: unknown) => JsonObject): JsonObject {
  const original = s.canonical(value);
  const parsed = JSON.parse(original) as unknown;
  const result = read(parsed);
  s.object(result);
  // Dropped fields or normalization cannot turn unknown stored bytes into a valid document.
  if (s.canonical(result) !== original) return s.fail();
  return JSON.parse(original) as JsonObject;
}
export function npcScopeValue(value: unknown): NpcScope {
  const r = s.object(value, ['campaignId', 'gmLocalContextId', 'ownerDeviceId']);
  return {
    campaignId: s.uuid(r['campaignId']),
    gmLocalContextId: s.uuid(r['gmLocalContextId']),
    ownerDeviceId: s.uuid(r['ownerDeviceId']),
  };
}
export function positive(value: unknown): number {
  const n = s.integer(value);
  return n > 0 ? n : s.fail();
}
export function npcAnchorValue(value: unknown): NpcAnchor {
  const r = s.object(value, ['libraryRevision', 'checkpointId', 'checkpointSha256']);
  return {
    libraryRevision: positive(r['libraryRevision']),
    checkpointId: s.uuid(r['checkpointId']),
    checkpointSha256: s.hash(r['checkpointSha256']),
  };
}
function target(value: unknown): NpcTarget | null {
  if (value === null) return null;
  const r = s.object(value, ['npcUuid', 'expectedCurrentVersion']);
  return {
    npcUuid: s.uuid(r['npcUuid']),
    expectedCurrentVersion: positive(r['expectedCurrentVersion']),
  };
}
/** Closed primitive envelope only; callers must subsequently validate its values with the owning reader. */
export function npcAttemptEnvelopeValue(value: unknown): NpcAttempt {
  const r = s.object(value, [
    'scope',
    'npcDraftId',
    'candidateNpcUuid',
    'revision',
    'mode',
    'targetOrNull',
    'stage',
    'status',
    'values',
  ]);
  if (r['mode'] !== 'CREATE_V1' && r['mode'] !== 'APPEND_N_PLUS_ONE') return s.fail();
  const stage = NPC_STAGES.find((x) => x === r['stage']) ?? s.fail();
  if (r['status'] !== 'OPEN' && r['status'] !== 'CANCELLED' && r['status'] !== 'COMMITTED')
    return s.fail();
  const binding = target(r['targetOrNull']);
  if ((r['mode'] === 'CREATE_V1') !== (binding === null)) return s.fail();
  const candidateNpcUuid = s.uuid(r['candidateNpcUuid']);
  if (
    candidateNpcUuid === r['npcDraftId'] ||
    (binding !== null && candidateNpcUuid !== binding.npcUuid)
  )
    return s.fail();
  return {
    scope: npcScopeValue(r['scope']),
    npcDraftId: s.uuid(r['npcDraftId']),
    candidateNpcUuid,
    revision: s.integer(r['revision']),
    mode: r['mode'],
    targetOrNull: binding,
    stage,
    status: r['status'],
    values: s.object(r['values']) as JsonObject,
  };
}
export function npcAttemptValue(
  value: unknown,
  readers: NpcDomainReaders,
  context: NpcAttemptReadContext | null = null,
): NpcAttempt {
  const a = npcAttemptEnvelopeValue(value);
  if (
    context !== null &&
    !s.same(
      [a.scope, a.npcDraftId, a.candidateNpcUuid, a.revision],
      [context.scope, context.npcDraftId, context.candidateNpcUuid, context.revision],
    )
  )
    return s.fail();
  return { ...a, values: closedDocument(a.values, (v) => readers.attempt(a.stage, v, context)) };
}
export function npcArtBlobValue(value: unknown): NpcArtBlob {
  const r = s.object(value, ['mediaType', 'sha256', 'bytesBase64']);
  if (r['mediaType'] !== 'image/png' && r['mediaType'] !== 'image/jpeg') return s.fail();
  const encoded = s.text(r['bytesBase64']),
    bytes = Buffer.from(encoded, 'base64'),
    sha256 = s.hash(r['sha256']);
  if (
    bytes.length === 0 ||
    bytes.toString('base64') !== encoded ||
    createHash('sha256').update(bytes).digest('hex') !== sha256
  )
    return s.fail();
  return {
    mediaType: r['mediaType'],
    sha256,
    bytesBase64: encoded,
  };
}
export function npcArtValue(value: unknown): NpcArt {
  const r = s.object(value, ['assetKey', 'mediaType', 'sha256', 'bytesBase64']);
  return {
    assetKey: s.text(r['assetKey']),
    ...npcArtBlobValue({
      mediaType: r['mediaType'],
      sha256: r['sha256'],
      bytesBase64: r['bytesBase64'],
    }),
  };
}
export function npcVersionRefValue(value: unknown): NpcVersionRef {
  const r = s.object(value, ['npcUuid', 'version', 'sha256']);
  return {
    npcUuid: s.uuid(r['npcUuid']),
    version: positive(r['version']),
    sha256: s.hash(r['sha256']),
  };
}
export function npcVersionValue(
  value: unknown,
  readers: Pick<NpcDomainReaders, 'snapshot' | 'lifetimeFacts'>,
  calendar: NpcCalendarReadContext | null = null,
  pending: NpcPendingCommitEvidence | null = null,
): NpcVersion {
  const r = s.object(value, [
    'scope',
    'npcUuid',
    'version',
    'libraryRevision',
    'operationId',
    'npcDraftId',
    'attemptRevision',
    'previousVersionSha256OrNull',
    'snapshot',
    'lifetimeFacts',
    'art',
    'committedAt',
  ]);
  const art = s.object(r['art'], ['assetKey', 'sha256']);
  if (pending !== null) {
    if (calendar === null || calendar.operations.some((o) => o.operationId === pending.operationId))
      return s.fail();
    if (
      !s.same(
        [
          pending.scope,
          pending.operationId,
          pending.npcUuid,
          pending.npcDraftId,
          pending.version,
          pending.attemptRevision,
          pending.committedAt,
        ],
        [
          r['scope'],
          r['operationId'],
          r['npcUuid'],
          r['npcDraftId'],
          r['version'],
          r['attemptRevision'],
          r['committedAt'],
        ],
      )
    )
      return s.fail();
    if (
      !s.same(pending.scope, calendar.scope) ||
      pending.beforeCheckpointSha256 !== s.sha(s.canonical(calendar.checkpoint)) ||
      !s.same(pending.beforeGmSource.queuePrefix, calendar.currentQueuePrefixOrNull)
    )
      return s.fail();
  }
  return {
    scope: npcScopeValue(r['scope']),
    npcUuid: s.uuid(r['npcUuid']),
    version: positive(r['version']),
    libraryRevision: positive(r['libraryRevision']),
    operationId: s.uuid(r['operationId']),
    npcDraftId: s.uuid(r['npcDraftId']),
    attemptRevision: s.integer(r['attemptRevision']),
    previousVersionSha256OrNull:
      r['previousVersionSha256OrNull'] === null ? null : s.hash(r['previousVersionSha256OrNull']),
    snapshot: closedDocument(r['snapshot'], (value) => readers.snapshot(value, calendar, pending)),
    lifetimeFacts: closedDocument(r['lifetimeFacts'], readers.lifetimeFacts),
    art: { assetKey: s.text(art['assetKey']), sha256: s.hash(art['sha256']) },
    committedAt: s.text(r['committedAt']),
  };
}
/** Closed transport between trusted persistence/host composition; parsing alone is not calendar proof. */
export function npcCalendarReadContextValue(value: unknown): NpcCalendarReadContext {
  const r = s.object(value, [
    'format',
    'scope',
    'checkpoint',
    'currentQueuePrefixOrNull',
    'currentClock',
    'operations',
  ]);
  if (r['format'] !== 'NPC_CALENDAR_READ_V1') return s.fail();
  const prefix = (value: unknown): NpcGmSource['queuePrefix'] => {
    const row = s.object(value, ['eventId', 'recordSha256']);
    return { eventId: s.text(row['eventId']), recordSha256: s.hash(row['recordSha256']) };
  };
  const clock = (value: unknown): NpcCalendarClock => {
    const row = s.object(value);
    const hasLobbyRevision = Object.hasOwn(row, 'lobbySnapshotRevisionOrNull');
    s.object(
      row,
      hasLobbyRevision
        ? ['phase', 'campaignTimestampOrNull', 'sourceOrNull', 'lobbySnapshotRevisionOrNull']
        : ['phase', 'campaignTimestampOrNull', 'sourceOrNull'],
    );
    const phase = row['phase'];
    if (phase !== 'PRE_START' && phase !== 'POST_START') return s.fail();
    const minute =
      row['campaignTimestampOrNull'] === null ? null : s.integer(row['campaignTimestampOrNull']);
    const source =
      row['sourceOrNull'] === null
        ? null
        : s.object(row['sourceOrNull'], ['kind', 'commandId', 'recordSha256']);
    if ((minute === null) !== (source === null) || (source === null && phase !== 'PRE_START'))
      return s.fail();
    if (source !== null && source['kind'] !== (phase === 'PRE_START' ? 'INITIAL_TIME' : 'START'))
      return s.fail();
    return {
      phase,
      campaignTimestampOrNull: minute,
      ...(hasLobbyRevision
        ? {
            lobbySnapshotRevisionOrNull:
              row['lobbySnapshotRevisionOrNull'] === null
                ? null
                : s.hash(row['lobbySnapshotRevisionOrNull']),
          }
        : {}),
      sourceOrNull:
        source === null
          ? null
          : {
              kind: phase === 'PRE_START' ? 'INITIAL_TIME' : 'START',
              commandId: s.uuid(source['commandId']),
              recordSha256: s.hash(source['recordSha256']),
            },
    };
  };
  const scope = npcScopeValue(r['scope']),
    checkpoint = npcCheckpointValue(r['checkpoint']);
  if (checkpoint.campaignId !== scope.campaignId) return s.fail('FOREIGN_OWNER');
  const operations = list(r['operations'], (value): NpcCalendarOperationProof => {
    const o = s.object(value, [
      'operationId',
      'operationSha256',
      'beforeCheckpointSha256',
      'beforeGmSource',
      'kind',
      'committedAt',
      'versionOrNull',
      'clock',
    ]);
    const kind =
      (['CREATE', 'REPLACE', 'CANCEL', 'OPEN', 'COMMIT_V1', 'COMMIT'] as const).find(
        (k) => k === o['kind'],
      ) ?? s.fail();
    return {
      operationId: s.text(o['operationId']),
      operationSha256: s.hash(o['operationSha256']),
      beforeCheckpointSha256: s.hash(o['beforeCheckpointSha256']),
      beforeGmSource: npcGmSourceValue(o['beforeGmSource']),
      kind,
      committedAt: s.text(o['committedAt']),
      versionOrNull: o['versionOrNull'] === null ? null : npcVersionRefValue(o['versionOrNull']),
      clock: clock(o['clock']),
    };
  });
  if (new Set(operations.map((o) => o.operationId)).size !== operations.length) return s.fail();
  const result: NpcCalendarReadContext = {
    format: 'NPC_CALENDAR_READ_V1',
    scope,
    checkpoint,
    currentQueuePrefixOrNull:
      r['currentQueuePrefixOrNull'] === null ? null : prefix(r['currentQueuePrefixOrNull']),
    currentClock: clock(r['currentClock']),
    operations,
  };
  return freezeNpcReadEvidence(result);
}
function freezeNpcReadEvidence<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeNpcReadEvidence(child);
    Object.freeze(value);
  }
  return value;
}
/** Structural parser only; the writer/owning factory supplies the independent audit allocation. */
export function npcPendingCommitEvidenceValue(value: unknown): NpcPendingCommitEvidence {
  const r = s.object(value, [
    'kind',
    'scope',
    'operationId',
    'npcUuid',
    'npcDraftId',
    'version',
    'attemptRevision',
    'committedAt',
    'beforeCheckpointSha256',
    'beforeGmSource',
  ]);
  if (r['kind'] !== 'PENDING_NPC_COMMIT') return s.fail();
  const source = npcGmSourceValue(r['beforeGmSource']);
  if (source.sourceFormId !== 'NPC-017') return s.fail();
  return freezeNpcReadEvidence({
    kind: 'PENDING_NPC_COMMIT',
    scope: npcScopeValue(r['scope']),
    operationId: s.uuid(r['operationId']),
    npcUuid: s.uuid(r['npcUuid']),
    npcDraftId: s.uuid(r['npcDraftId']),
    version: positive(r['version']),
    attemptRevision: positive(r['attemptRevision']),
    committedAt: s.text(r['committedAt']),
    beforeCheckpointSha256: s.hash(r['beforeCheckpointSha256']),
    beforeGmSource: source,
  });
}
export function npcTimeLockValue(value: unknown): NpcTimeLock | null {
  if (value === null) return null;
  const r = s.object(value, ['campaignTimestamp', 'operationId', 'npcUuid', 'version']);
  return {
    campaignTimestamp: s.integer(r['campaignTimestamp']),
    operationId: s.uuid(r['operationId']),
    npcUuid: s.uuid(r['npcUuid']),
    version: positive(r['version']),
  };
}
function list<T>(value: unknown, read: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) return s.fail();
  // All persisted inputs came from parsed canonical JSON; canonical also rejects sparse/accessor input.
  s.canonical(value);
  return value.map(read);
}
export function npcLibraryBlockValue(value: unknown): NpcLibraryBlock {
  const r = s.object(value, [
    'format',
    'campaignId',
    'libraryRevision',
    'checkpointId',
    'versions',
    'heads',
    'artSha256s',
    'initialTimeLockOrNull',
  ]);
  if (r['format'] !== 'NPC_LIBRARY_RECOVERY_V1') return s.fail();
  return {
    format: 'NPC_LIBRARY_RECOVERY_V1',
    campaignId: s.uuid(r['campaignId']),
    libraryRevision: positive(r['libraryRevision']),
    checkpointId: s.uuid(r['checkpointId']),
    versions: list(r['versions'], npcVersionRefValue),
    heads: list(r['heads'], npcVersionRefValue),
    artSha256s: list(r['artSha256s'], s.hash),
    initialTimeLockOrNull: npcTimeLockValue(r['initialTimeLockOrNull']),
  };
}
export function npcCheckpointValue(value: unknown): CampaignCheckpoint {
  const r = s.object(value, [
    'campaignId',
    'snapshotJson',
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
  ]);
  const result = {
    campaignId: s.uuid(r['campaignId']),
    snapshotJson: s.text(r['snapshotJson']),
    stateRevision: s.integer(r['stateRevision']),
    projectionRevision: s.integer(r['projectionRevision']),
    actorVisibilityRevision: s.integer(r['actorVisibilityRevision']),
  };
  campaignParts(result);
  return result;
}
export function campaignParts(checkpoint: CampaignCheckpoint) {
  const snapshot = s.object(JSON.parse(checkpoint.snapshotJson) as unknown, [
    'campaign',
    'campaignCharacterCopies',
  ]);
  const campaign = s.object(snapshot['campaign'], ['campaignId', 'lifecycleState', 'payloadJson']);
  if (
    campaign['campaignId'] !== checkpoint.campaignId ||
    !['PAUSED', 'HOSTING'].includes(s.text(campaign['lifecycleState'])) ||
    !Array.isArray(snapshot['campaignCharacterCopies'])
  )
    return s.fail();
  const payload = s.object(JSON.parse(s.text(campaign['payloadJson'])) as unknown);
  const anchor = Object.hasOwn(payload, 'npcLibrary')
    ? npcAnchorValue(payload['npcLibrary'])
    : null;
  return { snapshot, campaign, payload, anchor };
}
/** The owning campaign reader still validates every non-NPC payload key and copy. */
export function npcCheckpointAfter(
  before: CampaignCheckpoint,
  anchor: NpcAnchor,
  projectionChanged: boolean,
  visibilityChanged: boolean,
): CampaignCheckpoint {
  if (visibilityChanged && !projectionChanged) return s.fail('INVALID_INPUT');
  const parts = campaignParts(before);
  const payloadJson = s.canonical({ ...parts.payload, npcLibrary: anchor });
  return {
    campaignId: before.campaignId,
    snapshotJson: JSON.stringify({
      campaign: {
        campaignId: before.campaignId,
        lifecycleState: parts.campaign['lifecycleState'],
        payloadJson,
      },
      campaignCharacterCopies: parts.snapshot['campaignCharacterCopies'],
    }),
    stateRevision: s.increment(before.stateRevision),
    projectionRevision: projectionChanged
      ? s.increment(before.projectionRevision)
      : before.projectionRevision,
    actorVisibilityRevision: visibilityChanged
      ? s.increment(before.actorVisibilityRevision)
      : before.actorVisibilityRevision,
  };
}
export function npcAttemptEventEnvelopeValue(value: unknown): NpcAttemptEvent {
  const r = s.object(value);
  const modern = Object.hasOwn(r, 'format');
  s.object(
    r,
    modern
      ? [
          'format',
          'operationId',
          'previousSha256OrNull',
          'attempt',
          'childAllocations',
          ...(Object.hasOwn(r, 'ordinaryFact') ? ['ordinaryFact'] : []),
          ...(Object.hasOwn(r, 'lifeStateFact') ? ['lifeStateFact'] : []),
        ]
      : ['operationId', 'previousSha256OrNull', 'attempt'],
  );
  if (modern && r['format'] !== 'NPC_ATTEMPT_EVENT_V2') return s.fail();
  const common = {
    operationId: s.text(r['operationId']),
    previousSha256OrNull:
      r['previousSha256OrNull'] === null ? null : s.hash(r['previousSha256OrNull']),
    attempt: npcAttemptEnvelopeValue(r['attempt']),
  };
  return modern
    ? {
        ...common,
        format: 'NPC_ATTEMPT_EVENT_V2',
        childAllocations: npcChildAllocationsValue(r['childAllocations']),
        ...(Object.hasOwn(r, 'ordinaryFact')
          ? { ordinaryFact: npcOrdinaryAuthoringFactValue(r['ordinaryFact']) }
          : {}),
        ...(Object.hasOwn(r, 'lifeStateFact')
          ? { lifeStateFact: npcLifeStateRollFactValue(r['lifeStateFact']) }
          : {}),
      }
    : common;
}
export function npcAttemptEventValue(
  value: unknown,
  readers: NpcDomainReaders,
  context: NpcAttemptReadContext | null = null,
): NpcAttemptEvent {
  const event = npcAttemptEventEnvelopeValue(value);
  return { ...event, attempt: npcAttemptValue(event.attempt, readers, context) };
}
export function npcOperationValue(value: unknown, readers: NpcRequestReader): NpcOperation {
  const r = s.object(value, [
    'operationId',
    'receiptId',
    'kind',
    'scope',
    'request',
    'attemptEventSha256',
    'versionOrNull',
    'anchorOrNull',
    'beforeGmSource',
    'beforeCheckpoint',
    'afterCheckpoint',
    'committedAt',
  ]);
  const kind =
    (['CREATE', 'REPLACE', 'CANCEL', 'OPEN', 'COMMIT_V1', 'COMMIT'] as const).find(
      (k) => k === r['kind'],
    ) ?? s.fail();
  return {
    operationId: s.text(r['operationId']),
    receiptId: s.uuid(r['receiptId']),
    kind,
    scope: npcScopeValue(r['scope']),
    request: closedDocument(r['request'], (v) => readers.request(kind, v)),
    attemptEventSha256: s.hash(r['attemptEventSha256']),
    versionOrNull: r['versionOrNull'] === null ? null : npcVersionRefValue(r['versionOrNull']),
    anchorOrNull: r['anchorOrNull'] === null ? null : npcAnchorValue(r['anchorOrNull']),
    beforeGmSource: npcGmSourceValue(r['beforeGmSource']),
    beforeCheckpoint: npcCheckpointValue(r['beforeCheckpoint']),
    afterCheckpoint: npcCheckpointValue(r['afterCheckpoint']),
    committedAt: s.text(r['committedAt']),
  };
}

/** Intrinsic request echoes; historical view/selection/CTA legality is the owning GM fold's duty. */
export function verifyNpcRequestBinding(
  event: NpcAttemptEvent,
  operation: NpcOperation,
  readers: NpcRequestReader,
): void {
  const a = event.attempt,
    kind = operation.kind,
    source = npcGmSourceValue(operation.beforeGmSource);
  const equal = (left: unknown, right: unknown): void => {
    if (!s.same(left, right)) return s.fail();
  };
  equal(a.scope, operation.scope);
  equal(event.operationId, operation.operationId);
  verifyNpcOrdinaryFactBinding(npcEventOrdinaryFact(event), operation, a);
  verifyNpcLifeRollFactBinding(npcEventLifeStateFact(event), operation, a);
  if (kind === 'CREATE' || kind === 'REPLACE' || kind === 'CANCEL') {
    const binding = readers.technicalBinding(kind, operation.request);
    const row = s.object(binding);
    if (row['kind'] === 'FORM_ACTION') {
      s.object(binding, [
        'kind',
        'navigationRequestId',
        'sourceFormId',
        'expectedProjectionRevision',
      ]);
      equal(
        [
          s.text(row['navigationRequestId']),
          row['sourceFormId'],
          s.integer(row['expectedProjectionRevision']),
        ],
        [operation.operationId, source.sourceFormId, source.revisions.projectionRevision],
      );
      if (
        kind === 'CREATE'
          ? source.sourceFormId !== 'NPC-001'
          : !NPC_STAGES.some((stage) => stage === source.sourceFormId)
      )
        return s.fail();
      // NAV carries no draft identity/revision. The owning history proves the selected prior attempt.
      return;
    }
    if (
      row['kind'] !== 'DRAFT_REPLACE' ||
      kind !== 'REPLACE' ||
      !NPC_STAGES.some((stage) => stage === source.sourceFormId)
    )
      return s.fail();
    s.object(binding, [
      'kind',
      'operationId',
      'campaignId',
      'npcDraftId',
      'expectedAttemptRevision',
      'expectedRevisions',
    ]);
    equal(
      {
        operationId: s.text(row['operationId']),
        campaignId: s.uuid(row['campaignId']),
        npcDraftId: s.uuid(row['npcDraftId']),
        expectedAttemptRevision: s.integer(row['expectedAttemptRevision']),
        expectedRevisions: s.vector(row['expectedRevisions']),
      },
      {
        operationId: operation.operationId,
        campaignId: a.scope.campaignId,
        npcDraftId: a.npcDraftId,
        expectedAttemptRevision: a.revision - 1,
        expectedRevisions: source.revisions,
      },
    );
    return;
  }
  const request = npcWorkflowCommandRequestValue(operation.request);
  equal(
    [request.commandId, request.payload.campaignId, request.expectedRevisions],
    [operation.operationId, a.scope.campaignId, source.revisions],
  );
  if (kind === 'OPEN') {
    if (
      request.workflowCommandId !== 'UI-CMD-NPC-NEW-VERSION' ||
      request.payload.phase !== 'OPEN' ||
      (source.sourceFormId !== 'NPC-003' && source.sourceFormId !== 'NPC-007')
    )
      return s.fail();
    equal(a.targetOrNull, {
      npcUuid: request.payload.npcUuid,
      expectedCurrentVersion: request.payload.expectedCurrentVersion,
    });
  } else if (kind === 'COMMIT_V1') {
    if (request.workflowCommandId !== 'UI-CMD-NPC-COMMIT-V1' || source.sourceFormId !== 'NPC-017')
      return s.fail();
    equal(
      [request.payload.npcDraftId, request.payload.expectedAttemptRevision],
      [a.npcDraftId, a.revision - 1],
    );
  } else {
    if (
      request.workflowCommandId !== 'UI-CMD-NPC-NEW-VERSION' ||
      request.payload.phase !== 'COMMIT' ||
      source.sourceFormId !== 'NPC-017'
    )
      return s.fail();
    equal(
      [
        request.payload.npcDraftId,
        request.payload.expectedAttemptRevision,
        request.payload.expectedCurrentVersion,
      ],
      [a.npcDraftId, a.revision - 1, a.targetOrNull?.expectedCurrentVersion],
    );
  }
}
