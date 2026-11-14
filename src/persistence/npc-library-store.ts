import { migration0022 } from './migrations/0022-custom-monster-v1.js';
import { migration0023 } from './migrations/0023-enemy-template-versions.js';
import { migration0021 } from './migrations/0021-sentient-enemy-v1.js';
import { migration0020 } from './migrations/0020-enemy-library.js';
import type { DiseaseId } from '@generated/types/effects.js';
import type Database from 'better-sqlite3';
import { npcLifeStateRollFactValue, type NpcLifeStateRollFact } from './npc-life-facts.js';
import { npcTechnicalRequestValue, type NpcPreparationRequest } from '@shared/npc-command.js';
import {
  npcAttemptReadContext,
  npcChildAllocationsValue,
  npcChildIdentities,
  npcPublishedChildGraphValue,
  npcLinkedSetBindingValue,
  npcRuntimeEffectAllocationSource,
  npcPendingCustomProfile,
  type NpcPendingCustomProfile,
  type NpcLinkedSetBinding,
  type NpcRuntimeEffectSource,
  verifyNpcChildIndex,
  verifyNpcPublishedChildren,
  writeNpcChildIndex,
  type NpcAttemptReadContext,
  type NpcChildAllocation,
  type NpcChildIdentity,
  type NpcPublishedChildGraph,
  type NpcRestoredInventoryGraph,
} from './npc-child-identities.js';
import { npcIdentityInUse, legacyLocalIdentityInUse } from './npc-identities.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { networkApplicationStorage as s } from './network-local-application.js';
import {
  advanceRevisions,
  commitCampaignCheckpoint,
  loadCampaignCheckpoint,
  type CampaignCheckpoint,
} from './store.js';
import { migration0015, NPC_TABLES } from './migrations/0015-persistent-npc.js';
import { migration0016 } from './migrations/0016-npc-wound-identities.js';
import { migration0017 } from './migrations/0017-npc-linked-sets.js';
import { migration0018 } from './migrations/0018-npc-custom-profile-identities.js';
import { migration0019 } from './migrations/0019-npc-poison-coating-identities.js';
import { readAppliedMigrationVersion } from './migrations/index.js';
import {
  campaignParts,
  closedDocument,
  npcArtValue,
  npcArtBlobValue,
  npcAttemptEventEnvelopeValue,
  npcOrdinaryAuthoringFactValue,
  type NpcOrdinaryAuthoringFact,
  npcAttemptEnvelopeValue,
  npcAttemptValue,
  npcCheckpointAfter,
  npcLibraryBlockValue,
  npcOperationValue,
  npcGmSourceValue,
  npcSynchronousValidator,
  withNpcAttemptEnvelopeCalculations,
  verifyNpcRequestBinding,
  npcScopeValue,
  npcTimeLockValue,
  npcVersionValue,
  npcCalendarReadContextValue,
  npcPendingCommitEvidenceValue,
  type NpcCalendarReadContext,
  type NpcPendingCommitEvidence,
  type NpcAnchor,
  type NpcArt,
  type NpcArtBlob,
  type NpcAttempt,
  type NpcAttemptEvent,
  type NpcDomainReaders,
  type NpcStoredSnapshotInspection,
  type NpcIdentityReservation,
  type NpcGmSource,
  type NpcHistoricalSourceReader,
  type NpcHistoricalSourceEntry,
  type NpcLibraryBlock,
  type NpcOperation,
  type NpcOperationKind,
  type NpcRequestReader,
  type NpcScope,
  type NpcTarget,
  type NpcVersion,
  type NpcVersionRef,
} from './npc-library-records.js';

type Row = Record<string, unknown>;
type Readers = NpcDomainReaders & NpcRequestReader & NpcHistoricalSourceReader;
export interface NpcRecoveryClosure {
  /** Checked once for this read; not persisted and never reused across a write. */
  readonly calendarContext: NpcCalendarReadContext | null;
  readonly campaignId: string;
  readonly attempts: readonly NpcAttemptEvent[];
  readonly reservations: readonly NpcIdentityReservation[];
  readonly children: readonly NpcChildIdentity[];
  readonly versions: readonly NpcVersion[];
  readonly blocks: readonly NpcLibraryBlock[];
  readonly art: readonly NpcArtBlob[];
  readonly operations: readonly NpcOperation[];
  readonly anchorOrNull: NpcAnchor | null;
}
/** Ephemeral selectors from the same complete read; never persist or reuse after a write. */
export interface NpcRecoveryRead {
  readonly closure: NpcRecoveryClosure;
  readonly attemptReadContexts: readonly NpcAttemptReadContext[];
}
export interface NpcBoundary {
  readonly scope: NpcScope;
  readonly operationId: string;
  readonly kind: NpcOperationKind;
  readonly request: JsonObject;
  readonly expectedAttemptRevisionOrNull: number | null;
  readonly expectedCurrentVersionOrNull: number | null;
}
/** Existing authenticated GM/cursor/preview/history integration MUST implement both checks. */
export interface NpcTransactionIntegration {
  /** Current verified cursor/view/prefix; APPLY only inside the same IMMEDIATE transaction. */
  readonly readCheckedGmSource: (
    boundary: NpcBoundary,
    checkpoint: CampaignCheckpoint,
  ) => NpcGmSource;
  /** Exact complete closure checked in this same phase and transaction; never supplied by a caller. */
  readonly validate: (
    boundary: NpcBoundary,
    checkpoint: CampaignCheckpoint,
    phase: 'APPLY' | 'REPLAY' | 'AFTER',
    checkedClosure: NpcRecoveryClosure,
  ) => void;
  /** Owning persistence mirror only; never a host callback containing arbitrary SQL. */
  readonly writeGmMirror: (operation: NpcOperation) => void;
}
const digest = (value: unknown) => s.sha(s.canonical(value));
const equal = (a: unknown, b: unknown) => {
  if (!s.same(a, b)) return s.fail();
};
function schema(db: Database.Database): boolean {
  const version = readAppliedMigrationVersion(db);
  if (version < 15) {
    for (const table of NPC_TABLES)
      if (db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(table) !== undefined)
        return s.fail();
    return false;
  }
  if (
    version !== 15 &&
    version !== 16 &&
    version !== 17 &&
    version !== 18 &&
    version !== 19 &&
    version !== 20 &&
    version !== 21 &&
    version !== 22 &&
    version !== 23
  )
    return s.fail();
  const expectedMigration =
    version === 15
      ? migration0015
      : version === 16
        ? migration0016
        : version === 17
          ? migration0017
          : version === 18
            ? migration0018
            : version === 19
              ? migration0019
              : version === 20
                ? migration0020
                : version === 21
                  ? migration0021
                  : version === 22
                    ? migration0022
                    : migration0023;
  const row = db
    .prepare(
      'SELECT version,name,checksum_sha256 FROM schema_migration ORDER BY version DESC LIMIT 1',
    )
    .get() as Row | undefined;
  if (
    row?.['version'] !== version ||
    row['name'] !== expectedMigration.name ||
    row['checksum_sha256'] !== createHash('sha256').update(expectedMigration.sql).digest('hex')
  )
    return s.fail();
  for (const table of NPC_TABLES) db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  return true;
}
function guardedValue<T>(db: Database.Database, read: () => T): T {
  let result: T | undefined;
  s.guarded(
    db,
    () => {
      result = read();
    },
    null,
    'APPLY',
  );
  if (result === undefined) return s.fail();
  return result;
}
function publishedChildGraph(
  db: Database.Database,
  snapshot: JsonObject,
  readers: Readers,
  calendar: NpcCalendarReadContext | null,
  pending: NpcPendingCommitEvidence | null = null,
): NpcPublishedChildGraph {
  let graph: NpcPublishedChildGraph | undefined;
  s.guarded(
    db,
    (): unknown => {
      const value = Reflect.apply(preparationCallable(readers.publishedChildGraph), readers, [
        snapshot,
        calendar,
        pending,
      ]);
      if (types.isPromise(value)) return value;
      graph = npcPublishedChildGraphValue(preparationData(value));
      return undefined;
    },
    snapshot,
    'APPLY',
  );
  return graph ?? s.fail();
}
function pendingRuntimeEffect(facts: readonly NpcChildAllocation[]) {
  const allocation = facts[0];
  return allocation?.kind === 'EFFECT_INSTANCE' && 'sourceKind' in allocation
    ? {
        effectInstanceId: allocation.id,
        ...npcRuntimeEffectAllocationSource(allocation),
      }
    : null;
}
function pendingCoating(facts: readonly NpcChildAllocation[]) {
  const allocation = facts[0];
  return allocation?.kind === 'COATING_INSTANCE'
    ? {
        coatingInstanceId: allocation.id,
        itemInstanceId: allocation.itemInstanceId,
        sourceInstanceId: allocation.sourceInstanceId,
      }
    : null;
}
function pendingComposite(facts: readonly NpcChildAllocation[]) {
  const allocation = facts[0];
  if (allocation?.kind !== 'LINKED_SET') return null;
  if (facts.length !== 3 || facts[1]?.kind !== 'ITEM' || facts[2]?.kind !== 'ITEM')
    return s.fail('INVALID_INPUT');
  return npcLinkedSetBindingValue({
    linkedSetInstanceId: allocation.id,
    itemTypeId: allocation.itemTypeId,
    components: [
      {
        itemInstanceId: facts[1].id,
        componentRole: allocation.itemTypeId === 'ITM-WPN-026' ? 'SWORD' : 'RAPIER',
      },
      { itemInstanceId: facts[2].id, componentRole: 'SHIELD' },
    ],
  });
}
function restoredInventoryGraph(
  db: Database.Database,
  attempt: NpcAttempt,
  versions: readonly NpcVersion[],
  readers: Readers,
  calendar: NpcCalendarReadContext | null,
  graphs: ReadonlyMap<string, NpcPublishedChildGraph> | undefined,
  pending: NpcPreparationRequest | null,
): NpcRestoredInventoryGraph | null {
  // The canonical literal is only a cheap SQL prefilter; every matching operation
  // is independently parsed and its owning historical transition is checked below.
  const candidates = db
    .prepare(
      'SELECT o.* FROM npc_operation o JOIN npc_attempt_event e ON e.operation_id=o.operation_id WHERE e.campaign_id=? AND e.draft_id=? AND e.revision<=? AND instr(o.record_json, ?) > 0 ORDER BY e.revision',
    )
    .all(
      attempt.scope.campaignId,
      attempt.npcDraftId,
      attempt.revision,
      '"kind":"ITEM_RESTORE"',
    ) as Row[];
  const selected = candidates.map((row) => {
    const operation = checked(row, (value) => npcOperationValue(value, readers));
    const request = npcTechnicalRequestValue(operation.request);
    if (
      operation.kind !== 'REPLACE' ||
      !s.same(operation.scope, attempt.scope) ||
      request.messageType !== 'network.npc-preparation.request' ||
      request.sourceFormId !== 'NPC-015' ||
      request.preparation.kind !== 'ITEM_RESTORE' ||
      request.npcDraftId !== attempt.npcDraftId ||
      request.expectedAttemptRevision >= attempt.revision
    )
      return s.fail();
    return request.preparation.itemInstanceId;
  });
  if (pending !== null) {
    if (
      pending.sourceFormId !== 'NPC-015' ||
      pending.preparation.kind !== 'ITEM_RESTORE' ||
      pending.npcDraftId !== attempt.npcDraftId ||
      pending.campaignId !== attempt.scope.campaignId ||
      pending.expectedAttemptRevision !== attempt.revision - 1
    )
      return s.fail();
    selected.push(pending.preparation.itemInstanceId);
  }
  if (selected.length === 0) return null;
  if (attempt.mode !== 'APPEND_N_PLUS_ONE' || attempt.targetOrNull === null) return s.fail();
  const prefix = versions
    .filter(
      (version) =>
        s.same(version.scope, attempt.scope) &&
        version.npcUuid === attempt.candidateNpcUuid &&
        version.version <= attempt.targetOrNull!.expectedCurrentVersion,
    )
    .sort((a, b) => b.version - a.version);
  const verified = prefix.map((version) => ({
    version,
    graph:
      graphs?.get(version.operationId) ??
      publishedChildGraph(db, version.snapshot, readers, calendar),
  }));
  const items: NpcPublishedChildGraph['items'][number][] = [],
    linkedSets: NonNullable<NpcPublishedChildGraph['linkedSets']>[number][] = [],
    coatings: NonNullable<NpcPublishedChildGraph['coatings']>[number][] = [],
    archivedCoatingPreparations: NonNullable<
      NpcPublishedChildGraph['archivedCoatingPreparations']
    >[number][] = [],
    customProfiles: NonNullable<NpcPublishedChildGraph['customProfiles']>[number][] = [];
  for (const id of selected) {
    const latest = verified.find((row) =>
      row.graph.items.some((item) => item.itemInstanceId === id),
    );
    const pending =
      latest === undefined
        ? verified.find((row) =>
            row.graph.pendingInventory?.items.some((item) => item.itemInstanceId === id),
          )?.graph.pendingInventory
        : undefined;
    if (latest === undefined && pending === undefined) return s.fail();
    const sourceSets = latest?.graph.linkedSets ?? pending?.linkedSets ?? [];
    const set = sourceSets.find((set) => set.components.some((part) => part.itemInstanceId === id));
    const ids = set?.components.map((part) => part.itemInstanceId) ?? [id];
    if (
      set !== undefined &&
      !linkedSets.some((row) => row.linkedSetInstanceId === set.linkedSetInstanceId)
    )
      linkedSets.push(set);
    for (const itemId of ids) {
      const item =
        latest !== undefined
          ? (latest.graph.items.find((item) => item.itemInstanceId === itemId) ?? s.fail())
          : pending?.items.some((item) => item.itemInstanceId === itemId)
            ? { itemInstanceId: itemId, profileVersions: [] }
            : s.fail();
      if (!items.some((row) => row.itemInstanceId === itemId)) items.push(item);
      for (const coating of latest?.graph.coatings?.filter(
        (row) => row.itemInstanceId === itemId,
      ) ?? [])
        if (!coatings.some((row) => row.coatingInstanceId === coating.coatingInstanceId))
          coatings.push(coating);
      // These are identity permissions only. The owning restore reader separately
      // folds all preparation/removal events and chooses the exact current dose.
      for (const archived of verified.flatMap(
        (entry) =>
          entry.graph.archivedCoatingPreparations?.filter((row) => row.itemInstanceId === itemId) ??
          [],
      ))
        if (
          !archivedCoatingPreparations.some(
            (row) => row.coatingInstanceId === archived.coatingInstanceId,
          )
        )
          archivedCoatingPreparations.push(archived);
      for (const binding of (latest?.graph.customProfiles ?? pending?.customProfiles)?.filter(
        (row) => row.itemInstanceId === itemId,
      ) ?? [])
        if (
          !customProfiles.some(
            (row) => row.reference.profileVersionId === binding.reference.profileVersionId,
          )
        )
          customProfiles.push(binding);
    }
  }
  return {
    items,
    ...(linkedSets.length === 0 ? {} : { linkedSets }),
    ...(customProfiles.length === 0 ? {} : { customProfiles }),
    ...(coatings.length === 0 ? {} : { coatings }),
    ...(archivedCoatingPreparations.length === 0 ? {} : { archivedCoatingPreparations }),
  };
}
function attemptContext(
  db: Database.Database,
  attempt: NpcAttempt,
  operationId: string,
  children: readonly NpcChildIdentity[],
  versions: readonly NpcVersion[],
  readers: Readers,
  calendar: NpcCalendarReadContext | null,
  pendingItemId: string | null = null,
  graphs?: ReadonlyMap<string, NpcPublishedChildGraph>,
  pendingEffect: Readonly<{ effectInstanceId: string; diseaseId: DiseaseId }> | null = null,
  pendingTraumaId: string | null = null,
  pendingSymbiontId: string | null = null,
  pendingWoundId: string | null = null,
  pendingRuntimeEffect:
    (NpcRuntimeEffectSource & Readonly<{ effectInstanceId: string }>) | null = null,
  pendingComposite: NpcLinkedSetBinding | null = null,
  pendingCustomProfile: NpcPendingCustomProfile | null = null,
  pendingRestore: NpcPreparationRequest | null = null,
  coating: ReturnType<typeof pendingCoating> = null,
): NpcAttemptReadContext {
  const target = attempt.targetOrNull;
  const base =
    target === null
      ? null
      : (versions.find(
          (v) => v.npcUuid === target.npcUuid && v.version === target.expectedCurrentVersion,
        ) ?? s.fail());
  return npcAttemptReadContext(
    attempt,
    operationId,
    children,
    base === null
      ? null
      : {
          version: base,
          graph:
            graphs?.get(base.operationId) ??
            publishedChildGraph(db, base.snapshot, readers, calendar),
        },
    pendingItemId,
    pendingEffect,
    pendingTraumaId,
    pendingSymbiontId,
    pendingWoundId,
    pendingRuntimeEffect,
    pendingComposite,
    pendingCustomProfile,
    restoredInventoryGraph(db, attempt, versions, readers, calendar, graphs, pendingRestore),
    coating,
  );
}
function requiredPreStartTime(
  db: Database.Database,
  snapshot: JsonObject,
  readers: Readers,
  calendar: NpcCalendarReadContext | null,
  pending: NpcPendingCommitEvidence | null = null,
): number | null {
  let result: number | null | undefined;
  s.guarded(
    db,
    (): unknown => {
      const value = Reflect.apply(preparationCallable(readers.requiredPreStartTime), readers, [
        snapshot,
        calendar,
        pending,
      ]);
      if (types.isPromise(value)) return value;
      if (
        value !== null &&
        (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      )
        return s.fail('INVALID_INPUT');
      result = value;
      return undefined;
    },
    { snapshot, calendar, pending },
    'APPLY',
  );
  return result === undefined ? s.fail() : result;
}
/** The detached result is private to one readClosure; no reader can retain its checked metadata. */
function inspectStoredSnapshot(
  db: Database.Database,
  snapshot: unknown,
  readers: Readers,
  calendar: NpcCalendarReadContext | null,
): NpcStoredSnapshotInspection {
  let result: NpcStoredSnapshotInspection | undefined;
  s.guarded(
    db,
    (): unknown => {
      if (types.isProxy(readers)) return s.fail('INVALID_INPUT');
      const descriptor = Object.getOwnPropertyDescriptor(readers, 'inspectStoredSnapshot');
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value'))
        return s.fail('INVALID_INPUT');
      // Check the original callable before wrapping/invoking, so native async bodies never start.
      const inspect = preparationCallable(descriptor.value);
      const value = Reflect.apply(inspect, readers, [snapshot, calendar]);
      if (types.isPromise(value)) return value;
      const row = s.object(preparationData(value), [
        'snapshot',
        'publishedChildGraph',
        'requiredPreStartTimeOrNull',
      ]);
      const time = row['requiredPreStartTimeOrNull'];
      if (time !== null && (typeof time !== 'number' || !Number.isSafeInteger(time) || time < 0))
        return s.fail('INVALID_INPUT');
      result = {
        // preparationData already closed all nested JSON values without invoking accessors.
        // npcVersionValue.closedDocument independently requires byte-equivalent snapshot content.
        snapshot: s.object(row['snapshot']) as JsonObject,
        publishedChildGraph: npcPublishedChildGraphValue(row['publishedChildGraph']),
        requiredPreStartTimeOrNull: time,
      };
      return undefined;
    },
    { snapshot, calendar },
    'APPLY',
  );
  return result ?? s.fail();
}
function rows(
  db: Database.Database,
  table: (typeof NPC_TABLES)[number],
  campaignId: string,
): Row[] {
  return db.prepare(`SELECT * FROM ${table} WHERE campaign_id=?`).all(campaignId) as Row[];
}
function checked<T>(row: Row, read: (v: unknown) => T): T {
  const text = s.text(row['record_json']);
  if (s.sha(text) !== row['record_sha256']) return s.fail();
  const parsed: unknown = JSON.parse(text);
  if (s.canonical(parsed) !== text) return s.fail();
  const result = read(parsed);
  if (s.canonical(result) !== text) return s.fail();
  return result;
}
const ref = (version: NpcVersion): NpcVersionRef => ({
  npcUuid: version.npcUuid,
  version: version.version,
  sha256: digest(version),
});
const textOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const refOrder = (a: NpcVersionRef, b: NpcVersionRef) =>
  textOrder(a.npcUuid, b.npcUuid) || a.version - b.version;
function refs(versions: readonly NpcVersion[]): NpcVersionRef[] {
  return versions.map(ref).sort(refOrder);
}
function heads(versions: readonly NpcVersion[]): NpcVersionRef[] {
  const map = new Map<string, NpcVersion>();
  for (const v of versions) {
    const old = map.get(v.npcUuid);
    if (old === undefined || old.version < v.version) map.set(v.npcUuid, v);
  }
  return refs([...map.values()]);
}
const anchor = (block: NpcLibraryBlock): NpcAnchor => ({
  libraryRevision: block.libraryRevision,
  checkpointId: block.checkpointId,
  checkpointSha256: digest(block),
});
function verifyAttemptStep(
  event: NpcAttemptEvent,
  previous: NpcAttemptEvent | undefined,
  operation: NpcOperation,
): void {
  const a = event.attempt;
  equal(operation.scope, a.scope);
  if (operation.operationId !== event.operationId || operation.attemptEventSha256 !== digest(event))
    return s.fail();
  if (previous === undefined) {
    if (
      a.revision !== 0 ||
      event.previousSha256OrNull !== null ||
      a.status !== 'OPEN' ||
      (operation.kind !== 'CREATE' && operation.kind !== 'OPEN')
    )
      return s.fail();
    if ((operation.kind === 'CREATE') !== (a.mode === 'CREATE_V1')) return s.fail();
    return;
  }
  const p = previous.attempt;
  if (
    a.revision !== s.increment(p.revision) ||
    event.previousSha256OrNull !== digest(previous) ||
    p.status !== 'OPEN'
  )
    return s.fail();
  equal(
    [a.scope, a.npcDraftId, a.candidateNpcUuid, a.mode, a.targetOrNull],
    [p.scope, p.npcDraftId, p.candidateNpcUuid, p.mode, p.targetOrNull],
  );
  if (operation.kind === 'REPLACE') {
    if (a.status !== 'OPEN') return s.fail();
  } else {
    const status =
      operation.kind === 'CANCEL'
        ? 'CANCELLED'
        : operation.kind === 'COMMIT' || operation.kind === 'COMMIT_V1'
          ? 'COMMITTED'
          : s.fail();
    equal(a, { ...p, revision: a.revision, status });
  }
}
/** Origin is a domain invariant, not implied by valid hashes or a closed partial draft grammar. */
function validateAttemptOrigin(
  db: Database.Database,
  attempt: NpcAttempt,
  operation: NpcOperation,
  versions: readonly NpcVersion[],
  readers: Readers,
  calendar: NpcCalendarReadContext | null,
): void {
  if (operation.kind !== 'CREATE' && operation.kind !== 'OPEN') return;
  const target = attempt.targetOrNull;
  const base =
    operation.kind === 'CREATE'
      ? null
      : (versions.find(
          (version) =>
            version.npcUuid === target?.npcUuid &&
            version.version === target.expectedCurrentVersion,
        ) ?? s.fail());
  s.guarded(
    db,
    () => {
      const validate = npcSynchronousValidator(readers.validateAttemptOrigin);
      return validate.call(readers, attempt, operation, base, calendar);
    },
    { attempt, operation, baseVersionOrNull: base },
    'APPLY',
  );
}
/** Phase 0 must finish before any domain snapshot/graph callback. No reader-local mutable cache. */
function calendarContextForRead(
  db: Database.Database,
  campaignId: string,
  readers: Readers,
): NpcCalendarReadContext | null {
  let context: NpcCalendarReadContext | null | undefined;
  s.guarded(
    db,
    (): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(readers, 'createReadContext');
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value'))
        return s.fail('INVALID_INPUT');
      const value: unknown = Reflect.apply(preparationCallable(descriptor.value), readers, [
        campaignId,
      ]);
      if (types.isPromise(value)) return value;
      context = value === null ? null : npcCalendarReadContextValue(preparationData(value));
      if (context !== null) {
        if (context.scope.campaignId !== campaignId) return s.fail('FOREIGN_OWNER');
        equal(context.checkpoint, loadCampaignCheckpoint(db, campaignId));
      }
      return undefined;
    },
    null,
    'APPLY',
  );
  if (context === undefined) return s.fail('INVALID_INPUT');
  return context;
}
/** Complete current closure, plus immutable historical blocks. Never substitutes current heads for a prefix. */
function readClosure(
  db: Database.Database,
  campaignId: string,
  readers: Readers,
  contexts: Map<string, NpcAttemptReadContext>,
): NpcRecoveryClosure {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  if (!schema(db))
    return {
      campaignId,
      calendarContext: null,
      attempts: [],
      reservations: [],
      children: [],
      versions: [],
      blocks: [],
      art: [],
      operations: [],
      anchorOrNull: null,
    };
  const calendarContext = calendarContextForRead(db, campaignId, readers);
  const operationRows = rows(db, 'npc_operation', campaignId);
  const operations = operationRows
    .map((row) => {
      const o = checked(row, (v) => npcOperationValue(v, readers));
      equal(
        [row['operation_id'], row['receipt_id'], row['kind'], row['campaign_id']],
        [o.operationId, o.receiptId, o.kind, o.scope.campaignId],
      );
      if (
        o.scope.campaignId !== campaignId ||
        o.beforeCheckpoint.campaignId !== campaignId ||
        o.afterCheckpoint.campaignId !== campaignId
      )
        return s.fail();
      return o;
    })
    .sort((a, b) => textOrder(a.operationId, b.operationId));
  if (calendarContext !== null) {
    equal(
      calendarContext.operations.map((p) => p.operationId).sort(),
      operations.map((o) => o.operationId).sort(),
    );
    for (const operation of operations) {
      equal(operation.scope, calendarContext.scope);
      const proof =
        calendarContext.operations.find((p) => p.operationId === operation.operationId) ?? s.fail();
      equal(
        [
          proof.operationSha256,
          proof.beforeCheckpointSha256,
          proof.beforeGmSource,
          proof.kind,
          proof.committedAt,
          proof.versionOrNull,
        ],
        [
          digest(operation),
          digest(operation.beforeCheckpoint),
          operation.beforeGmSource,
          operation.kind,
          operation.committedAt,
          operation.versionOrNull,
        ],
      );
    }
  }
  const operationMap = new Map(operations.map((o) => [o.operationId, o]));
  const inspections = new Map<string, NpcStoredSnapshotInspection>();
  const versions = rows(db, 'npc_version', campaignId)
    .map((row) => {
      let inspection: NpcStoredSnapshotInspection | undefined;
      const v = checked(row, (x) =>
        npcVersionValue(
          x,
          {
            lifetimeFacts: readers.lifetimeFacts,
            snapshot(value) {
              if (inspection !== undefined) return s.fail();
              inspection = inspectStoredSnapshot(db, value, readers, calendarContext);
              return inspection.snapshot;
            },
          },
          calendarContext,
          null,
        ),
      );
      equal(
        [
          row['campaign_id'],
          row['npc_uuid'],
          row['version'],
          row['library_revision'],
          row['operation_id'],
        ],
        [v.scope.campaignId, v.npcUuid, v.version, v.libraryRevision, v.operationId],
      );
      if (inspection === undefined || inspections.has(v.operationId)) return s.fail();
      inspections.set(v.operationId, inspection);
      return v;
    })
    .sort((a, b) => a.libraryRevision - b.libraryRevision);
  const graphs = new Map(
    versions.map((v) => [
      v.operationId,
      (inspections.get(v.operationId) ?? s.fail()).publishedChildGraph,
    ]),
  );
  const attempts = rows(db, 'npc_attempt_event', campaignId)
    .map((row) => {
      const e = checked(row, npcAttemptEventEnvelopeValue);
      equal(
        [row['campaign_id'], row['draft_id'], row['revision'], row['operation_id']],
        [e.attempt.scope.campaignId, e.attempt.npcDraftId, e.attempt.revision, e.operationId],
      );
      return e;
    })
    .sort(
      (a, b) =>
        textOrder(a.attempt.npcDraftId, b.attempt.npcDraftId) ||
        a.attempt.revision - b.attempt.revision,
    );
  if (operations.length !== attempts.length) return s.fail();
  const children = npcChildIdentities(attempts, operations);
  verifyNpcChildIndex(db, campaignId, children);
  const currentAttempts = new Map<string, NpcAttemptEvent>();
  const historicalSources: NpcHistoricalSourceEntry[] = [];
  for (const e of attempts) {
    const operation = operationMap.get(e.operationId) ?? s.fail();
    verifyAttemptStep(e, currentAttempts.get(e.attempt.npcDraftId), operation);
    verifyNpcRequestBinding(e, operation, readers);
    const previous = currentAttempts.get(e.attempt.npcDraftId) ?? null;
    const readContext = attemptContext(
      db,
      e.attempt,
      e.operationId,
      children,
      versions,
      readers,
      calendarContext,
      null,
      graphs,
    );
    equal(npcAttemptValue(e.attempt, readers, readContext), e.attempt);
    historicalSources.push({
      operation,
      event: e,
      previous,
      readContext,
      previousReadContextOrNull:
        previous === null ? null : (contexts.get(previous.operationId) ?? s.fail()),
    });
    contexts.set(e.operationId, readContext);
    currentAttempts.set(e.attempt.npcDraftId, e);
  }
  // Rebuilding the same complete GM queue for every attempt makes a single read quadratic.
  // The batch is private to this read, still fenced against source/SQL mutation and async results.
  if (historicalSources.length !== 0)
    s.guarded(
      db,
      () => {
        const validate = npcSynchronousValidator(readers.validateHistoricalGmSources);
        return validate.call(readers, historicalSources, calendarContext);
      },
      historicalSources,
      'APPLY',
    );
  const reservations = rows(db, 'npc_identity_reservation', campaignId)
    .map((row) => ({
      campaignId: s.uuid(row['campaign_id']),
      npcDraftId: s.uuid(row['draft_id']),
      candidateNpcUuid: s.uuid(row['candidate_npc_uuid']),
      createOperationId: s.text(row['create_operation_id']),
    }))
    .sort((a, b) => textOrder(a.npcDraftId, b.npcDraftId));
  const roots = attempts.filter((e) => e.attempt.revision === 0 && e.attempt.mode === 'CREATE_V1');
  equal(
    reservations,
    roots.map((e) => ({
      campaignId,
      npcDraftId: e.attempt.npcDraftId,
      candidateNpcUuid: e.attempt.candidateNpcUuid,
      createOperationId: e.operationId,
    })),
  );
  const attemptHeads = rows(db, 'npc_attempt_head', campaignId);
  if (attemptHeads.length !== currentAttempts.size) return s.fail();
  for (const row of attemptHeads) {
    const e = currentAttempts.get(s.uuid(row['draft_id'])) ?? s.fail();
    equal([row['revision'], row['record_sha256']], [e.attempt.revision, digest(e)]);
  }
  const priorVersions = new Map<string, NpcVersion>();
  for (const [i, v] of versions.entries()) {
    if (v.libraryRevision !== i + 1) return s.fail();
    const previous = priorVersions.get(v.npcUuid),
      o = operationMap.get(v.operationId) ?? s.fail();
    const e = attempts.find((a) => a.operationId === v.operationId) ?? s.fail();
    const a = e.attempt;
    equal(v.scope, a.scope);
    if (
      a.npcDraftId !== v.npcDraftId ||
      a.candidateNpcUuid !== v.npcUuid ||
      a.revision !== v.attemptRevision ||
      a.status !== 'COMMITTED' ||
      a.stage !== 'NPC-017'
    )
      return s.fail();
    if (
      v.version !== (previous === undefined ? 1 : s.increment(previous.version)) ||
      v.previousVersionSha256OrNull !== (previous === undefined ? null : digest(previous))
    )
      return s.fail();
    if (previous === undefined) {
      if (a.mode !== 'CREATE_V1' || o.kind !== 'COMMIT_V1') return s.fail();
    } else {
      if (a.mode !== 'APPEND_N_PLUS_ONE' || o.kind !== 'COMMIT') return s.fail();
      equal(a.targetOrNull, { npcUuid: v.npcUuid, expectedCurrentVersion: previous.version });
    }
    equal(o.versionOrNull, ref(v));
    if (o.committedAt !== v.committedAt) return s.fail();
    const storedChildGraph = graphs.get(v.operationId) ?? s.fail();
    s.guarded(
      db,
      () => {
        const validate = npcSynchronousValidator(readers.validateVersion);
        return validate.call(
          readers,
          v,
          a,
          previous ?? null,
          calendarContext,
          null,
          storedChildGraph,
        );
      },
      { version: v, attempt: a, previous: previous ?? null, storedChildGraph },
      'APPLY',
    );
    verifyNpcPublishedChildren(
      v,
      storedChildGraph,
      previous === undefined ? null : (graphs.get(previous.operationId) ?? s.fail()),
      children,
      contexts.get(v.operationId) ?? s.fail(),
    );
    priorVersions.set(v.npcUuid, v);
  }
  // Checked versions are available now; historical OPEN resolves its exact base, never today's head.
  for (const event of attempts) {
    if (event.attempt.revision !== 0) continue;
    validateAttemptOrigin(
      db,
      event.attempt,
      operationMap.get(event.operationId) ?? s.fail(),
      versions,
      readers,
      calendarContext,
    );
  }
  const currentHeads = rows(db, 'npc_current_head', campaignId)
    .map((row) => ({
      npcUuid: s.uuid(row['npc_uuid']),
      version: s.integer(row['version']),
      sha256: s.hash(row['record_sha256']),
    }))
    .sort(refOrder);
  equal(currentHeads, heads(versions));
  const art = rows(db, 'npc_art', campaignId)
    .map((row) => {
      const a = checked(row, npcArtBlobValue);
      if (row['asset_sha256'] !== a.sha256) return s.fail();
      return a;
    })
    .sort((a, b) => textOrder(a.sha256, b.sha256));
  const usedArt = [...new Set(versions.map((v) => v.art.sha256))].sort();
  equal(
    art.map((a) => a.sha256),
    usedArt,
  );
  // Asset keys belong to their immutable version; equal content may have several valid keys.
  // The domain version reader proves each resolved key/checksum binding.
  const blocks = rows(db, 'npc_library_checkpoint', campaignId)
    .map((row) => {
      const b = checked(row, npcLibraryBlockValue);
      equal(
        [row['campaign_id'], row['library_revision'], row['checkpoint_id']],
        [b.campaignId, b.libraryRevision, b.checkpointId],
      );
      return b;
    })
    .sort((a, b) => a.libraryRevision - b.libraryRevision);
  if (blocks.length !== versions.length) return s.fail();
  const identities = [
    ...operations.map((o) => o.operationId),
    ...operations.map((o) => o.receiptId),
    ...blocks.map((b) => b.checkpointId),
    ...currentAttempts.keys(),
    ...reservations.map((r) => r.candidateNpcUuid),
    ...children.map((c) => c.allocation.id),
  ];
  if (new Set(identities).size !== identities.length) return s.fail();
  let requiredLock: ReturnType<typeof npcTimeLockValue> | null = null;
  for (const [i, b] of blocks.entries()) {
    if (b.libraryRevision !== i + 1) return s.fail();
    const prefix = versions.slice(0, i + 1),
      v = versions[i] ?? s.fail(),
      o = operationMap.get(v.operationId) ?? s.fail();
    equal(b.versions, refs(prefix));
    equal(b.heads, heads(prefix));
    equal(b.artSha256s, [...new Set(prefix.map((v) => v.art.sha256))].sort());
    equal(o.anchorOrNull, anchor(b));
    const prior = blocks[i - 1];
    const requiredMinute = (inspections.get(v.operationId) ?? s.fail()).requiredPreStartTimeOrNull;
    if (requiredMinute !== null) {
      if (requiredLock === null)
        requiredLock = npcTimeLockValue({
          campaignTimestamp: requiredMinute,
          operationId: v.operationId,
          npcUuid: v.npcUuid,
          version: v.version,
        });
      else equal(requiredMinute, requiredLock.campaignTimestamp);
    }
    equal(b.initialTimeLockOrNull, requiredLock);
    if (prior?.initialTimeLockOrNull !== null && prior?.initialTimeLockOrNull !== undefined)
      equal(b.initialTimeLockOrNull, prior.initialTimeLockOrNull);
    else if (b.initialTimeLockOrNull !== null)
      equal(
        [
          b.initialTimeLockOrNull.operationId,
          b.initialTimeLockOrNull.npcUuid,
          b.initialTimeLockOrNull.version,
        ],
        [v.operationId, v.npcUuid, v.version],
      );
    equal(campaignParts(o.beforeCheckpoint).anchor, prior === undefined ? null : anchor(prior));
    const projectionDelta =
      o.afterCheckpoint.projectionRevision - o.beforeCheckpoint.projectionRevision;
    const visibilityDelta =
      o.afterCheckpoint.actorVisibilityRevision - o.beforeCheckpoint.actorVisibilityRevision;
    if (![0, 1].includes(projectionDelta) || ![0, 1].includes(visibilityDelta)) return s.fail();
    equal(
      o.afterCheckpoint,
      npcCheckpointAfter(
        o.beforeCheckpoint,
        anchor(b),
        projectionDelta === 1,
        visibilityDelta === 1,
      ),
    );
  }
  for (const o of operations) {
    if (o.kind === 'COMMIT' || o.kind === 'COMMIT_V1') {
      if (!versions.some((v) => v.operationId === o.operationId)) return s.fail();
    } else {
      if (o.versionOrNull !== null || o.anchorOrNull !== null) return s.fail();
      equal(o.beforeCheckpoint, o.afterCheckpoint);
    }
  }
  return {
    campaignId,
    calendarContext,
    attempts,
    reservations,
    children,
    versions,
    blocks,
    art,
    operations,
    anchorOrNull: blocks.length === 0 ? null : anchor(blocks.at(-1)!),
  };
}

function readRecoveryState(
  db: Database.Database,
  campaignId: string,
  readers: Readers,
): NpcRecoveryRead {
  return withNpcAttemptEnvelopeCalculations(() => {
    const read = () => {
      const contexts = new Map<string, NpcAttemptReadContext>();
      const closure = guardedValue(db, () =>
        readClosure(db, s.uuid(campaignId), readers, contexts),
      );
      return { closure, attemptReadContexts: Object.freeze([...contexts.values()]) };
    };
    return db.inTransaction ? read() : db.transaction(read).deferred();
  });
}
export function readNpcRecoveryClosure(
  db: Database.Database,
  campaignId: string,
  readers: Readers,
): NpcRecoveryClosure {
  return readRecoveryState(db, campaignId, readers).closure;
}
/** Mandatory for the current campaign reader, including absent-anchor/orphan detection. */
export function verifyCurrentNpcAnchor(
  db: Database.Database,
  checkpoint: CampaignCheckpoint,
  readers: Readers,
): NpcRecoveryClosure {
  return verifyCurrentNpcRead(db, checkpoint, readers).closure;
}
/** The closure and attempt contexts share one checked SQL frontier and must travel together. */
export function verifyCurrentNpcRead(
  db: Database.Database,
  checkpoint: CampaignCheckpoint,
  readers: Readers,
): NpcRecoveryRead {
  const read = readRecoveryState(db, checkpoint.campaignId, readers);
  equal(campaignParts(checkpoint).anchor, read.closure.anchorOrNull);
  return read;
}
/** Historical replay resolves its own immutable library prefix; later heads are not substituted. */
export function resolveNpcHistoricalPrefix(
  db: Database.Database,
  checkpoint: CampaignCheckpoint,
  readers: Readers,
) {
  const closure = readNpcRecoveryClosure(db, checkpoint.campaignId, readers),
    pinned = campaignParts(checkpoint).anchor;
  if (pinned === null) return { block: null, versions: [], art: [] };
  const block =
    closure.blocks.find((b) => b.libraryRevision === pinned.libraryRevision) ?? s.fail();
  equal(anchor(block), pinned);
  return {
    block,
    versions: closure.versions.filter((v) => v.libraryRevision <= block.libraryRevision),
    art: closure.art.filter((a) => block.artSha256s.includes(a.sha256)),
  };
}

function readCheckedGmSource(
  db: Database.Database,
  b: NpcBoundary,
  checkpoint: CampaignCheckpoint,
  integration: NpcTransactionIntegration,
): NpcGmSource {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  let result: NpcGmSource | undefined;
  s.guarded(
    db,
    () => {
      const read = npcSynchronousValidator(integration.readCheckedGmSource);
      const raw: unknown = read.call(integration, b, checkpoint);
      if (types.isPromise(raw)) {
        void raw.catch(() => undefined);
        return s.fail('INVALID_INPUT');
      }
      result = npcGmSourceValue(raw);
    },
    { boundary: b, checkpoint },
    'APPLY',
  );
  return result ?? s.fail('INVALID_INPUT');
}
function validateBoundary(
  db: Database.Database,
  b: NpcBoundary,
  checkpoint: CampaignCheckpoint,
  integration: NpcTransactionIntegration,
  phase: 'APPLY' | 'REPLAY' | 'AFTER',
  checkedClosure: NpcRecoveryClosure,
): void {
  s.owner(db, b.scope.ownerDeviceId);
  s.guarded(
    db,
    () => {
      const validate = npcSynchronousValidator(integration.validate);
      return validate.call(integration, b, checkpoint, phase, freezePreparation(checkedClosure));
    },
    { boundary: b, checkpoint, checkedClosure },
    phase === 'REPLAY' ? 'REPLAY' : 'APPLY',
  );
}
function writeRecord(
  db: Database.Database,
  sql: string,
  args: readonly (string | number)[],
  value: unknown,
): void {
  const text = s.canonical(value);
  const result = db.prepare(sql).run(...args, text, s.sha(text));
  if (result.changes !== 1) return s.fail('SOURCE_CHANGED');
}
function writeAttempt(
  db: Database.Database,
  event: NpcAttemptEvent,
  previous: NpcAttemptEvent | undefined,
): void {
  const a = event.attempt;
  writeRecord(
    db,
    'INSERT INTO npc_attempt_event VALUES (?,?,?,?,?,?)',
    [a.scope.campaignId, a.npcDraftId, a.revision, event.operationId],
    event,
  );
  const result =
    previous === undefined
      ? db
          .prepare('INSERT INTO npc_attempt_head VALUES (?,?,?,?)')
          .run(a.scope.campaignId, a.npcDraftId, a.revision, digest(event))
      : db
          .prepare(
            'UPDATE npc_attempt_head SET revision=?,record_sha256=? WHERE campaign_id=? AND draft_id=? AND revision=? AND record_sha256=?',
          )
          .run(
            a.revision,
            digest(event),
            a.scope.campaignId,
            a.npcDraftId,
            previous.attempt.revision,
            digest(previous),
          );
  if (result.changes !== 1) return s.fail('SOURCE_CHANGED');
}
function writeOperation(db: Database.Database, operation: NpcOperation): void {
  writeRecord(
    db,
    'INSERT INTO npc_operation VALUES (?,?,?,?,?,?)',
    [operation.operationId, operation.scope.campaignId, operation.receiptId, operation.kind],
    operation,
  );
}
function freshIdentities(
  db: Database.Database,
  operationId: string,
  allocatedIds: readonly string[],
): void {
  s.text(operationId);
  for (const id of allocatedIds) s.uuid(id);
  const ids = [operationId, ...allocatedIds];
  if (new Set(ids).size !== ids.length) return s.fail('IDEMPOTENCY_CONFLICT');
  for (const id of ids) {
    s.assertUnused(db, id);
    if (npcIdentityInUse(db, id) || legacyLocalIdentityInUse(db, id))
      return s.fail('IDEMPOTENCY_CONFLICT');
  }
}
function checkedBoundary(value: NpcBoundary, readers: Readers): NpcBoundary {
  const r = s.object(value, [
    'scope',
    'operationId',
    'kind',
    'request',
    'expectedAttemptRevisionOrNull',
    'expectedCurrentVersionOrNull',
  ]);
  const kind =
    (['CREATE', 'REPLACE', 'CANCEL', 'OPEN', 'COMMIT_V1', 'COMMIT'] as const).find(
      (k) => k === r['kind'],
    ) ?? s.fail('INVALID_INPUT');
  return {
    scope: npcScopeValue(r['scope']),
    operationId: s.text(r['operationId']),
    kind,
    request: closedDocument(r['request'], (v) => readers.request(kind, v)),
    expectedAttemptRevisionOrNull:
      r['expectedAttemptRevisionOrNull'] === null
        ? null
        : s.integer(r['expectedAttemptRevisionOrNull']),
    expectedCurrentVersionOrNull:
      r['expectedCurrentVersionOrNull'] === null
        ? null
        : s.integer(r['expectedCurrentVersionOrNull']),
  };
}
function knownOperation(
  db: Database.Database,
  b: NpcBoundary,
  closure: NpcRecoveryClosure,
): NpcOperation | null {
  const any = db
    .prepare('SELECT campaign_id FROM npc_operation WHERE operation_id=?')
    .get(b.operationId) as Row | undefined;
  if (any === undefined) return null;
  if (any['campaign_id'] !== b.scope.campaignId) return s.fail('FOREIGN_OWNER');
  const o = closure.operations.find((o) => o.operationId === b.operationId) ?? s.fail();
  if (!s.same([o.kind, o.scope, o.request], [b.kind, b.scope, b.request]))
    return s.fail('IDEMPOTENCY_CONFLICT');
  return o;
}
function latestAttempt(closure: NpcRecoveryClosure, id: string): NpcAttemptEvent | undefined {
  return closure.attempts.filter((e) => e.attempt.npcDraftId === id).at(-1);
}
function mirror(
  db: Database.Database,
  integration: NpcTransactionIntegration,
  o: NpcOperation,
): void {
  const before = s.canonical(o);
  const write = npcSynchronousValidator(integration.writeGmMirror);
  const returned: unknown = write.call(integration, o);
  if (returned !== undefined || !db.inTransaction || s.canonical(o) !== before)
    return s.fail('SOURCE_CHANGED');
}
export type NpcAttemptPreparationSource =
  | Readonly<{ kind: 'EXISTING'; npcDraftId: string }>
  | Readonly<{ kind: 'CREATE' }>
  | Readonly<{ kind: 'OPEN'; target: NpcTarget }>;
export interface NpcAttemptPreparationContext {
  readonly calendarContext: NpcCalendarReadContext | null;
  readonly source: NpcAttemptPreparationSource;
  readonly boundary: NpcBoundary;
  readonly checkpoint: CampaignCheckpoint;
  readonly beforeGmSource: NpcGmSource;
  readonly previousOrNull: NpcAttemptEvent | null;
  readonly previousReadContextOrNull: NpcAttemptReadContext | null;
  readonly baseVersionOrNull: NpcVersion | null;
  /** Exact target of the saved EXISTING attempt; OPEN keeps its separate baseVersionOrNull. */
  readonly inheritedVersionForPreviousAttemptOrNull: NpcVersion | null;
}
export interface NpcPreparedAttempt {
  readonly ordinaryFact?: NpcOrdinaryAuthoringFact;
  readonly lifeStateFact?: NpcLifeStateRollFact;
  readonly next: NpcAttempt;
  readonly receiptId: string;
  readonly committedAt: string;
  readonly childAllocations?: readonly Extract<
    NpcChildAllocation,
    {
      kind:
        | 'ITEM'
        | 'LINKED_SET'
        | 'CUSTOM_PROFILE'
        | 'CUSTOM_PROFILE_VERSION'
        | 'EFFECT_INSTANCE'
        | 'COATING_INSTANCE'
        | 'TRAUMA_INSTANCE'
        | 'SYMBIONT_INSTANCE'
        | 'WOUND_INSTANCE';
    }
  >[];
}
export interface NpcPreparationIntegration extends NpcTransactionIntegration {
  /** Owning GM adapter proves the selected attempt/version and child context before preparation. */
  readonly validatePreparation: (context: NpcAttemptPreparationContext) => void;
}
export type NpcAttemptPreparer = (context: NpcAttemptPreparationContext) => NpcPreparedAttempt;

function preparationCallable(value: unknown): (...args: unknown[]) => unknown {
  if (
    typeof value !== 'function' ||
    types.isProxy(value) ||
    types.isAsyncFunction(value) ||
    types.isGeneratorFunction(value) ||
    /\{\s*\[native code\]\s*\}$/u.test(Function.prototype.toString.call(value))
  )
    return s.fail('INVALID_INPUT');
  // A bound callable hides its async target even from isAsyncFunction. Only inspectable host
  // closures/methods enter this new API; the existing eager writer retains its old contract.
  return value as (...args: unknown[]) => unknown;
}

/** Descriptor-only detachment: neither a factory result nor a selector can execute getters/toJSON. */
function preparationData(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || types.isProxy(value) || ancestors.has(value))
    return s.fail('INVALID_INPUT');
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value))
    return s.fail('INVALID_INPUT');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, 'length');
      if (length === undefined || !Object.hasOwn(length, 'value')) return s.fail('INVALID_INPUT');
      const size: unknown = length.value;
      if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0)
        return s.fail('INVALID_INPUT');
      if (Reflect.ownKeys(value).length !== size + 1) return s.fail('INVALID_INPUT');
      const result: unknown[] = [];
      for (let index = 0; index < size; index++) {
        const item = Object.getOwnPropertyDescriptor(value, String(index));
        if (item === undefined || !item.enumerable || !Object.hasOwn(item, 'value'))
          return s.fail('INVALID_INPUT');
        result.push(preparationData(item.value, ancestors));
      }
      return result;
    }
    // Owning domain codecs require plain JSON objects; defineProperty keeps __proto__ an own key.
    const result: Row = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return s.fail('INVALID_INPUT');
      const item = Object.getOwnPropertyDescriptor(value, key);
      if (item === undefined || !item.enumerable || !Object.hasOwn(item, 'value'))
        return s.fail('INVALID_INPUT');
      Object.defineProperty(result, key, {
        value: preparationData(item.value, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
function preparationSource(value: unknown): NpcAttemptPreparationSource {
  const r = s.object(preparationData(value));
  if (r['kind'] === 'EXISTING') {
    s.object(r, ['kind', 'npcDraftId']);
    return { kind: 'EXISTING', npcDraftId: s.uuid(r['npcDraftId']) };
  }
  if (r['kind'] === 'CREATE') {
    s.object(r, ['kind']);
    return { kind: 'CREATE' };
  }
  if (r['kind'] !== 'OPEN') return s.fail('INVALID_INPUT');
  s.object(r, ['kind', 'target']);
  const target = s.object(r['target'], ['npcUuid', 'expectedCurrentVersion']);
  const version = s.integer(target['expectedCurrentVersion']);
  if (version < 1) return s.fail('INVALID_INPUT');
  return {
    kind: 'OPEN',
    target: { npcUuid: s.uuid(target['npcUuid']), expectedCurrentVersion: version },
  };
}
function freezePreparation<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezePreparation(child);
    Object.freeze(value);
  }
  return value;
}
function preparedAttempt(
  db: Database.Database,
  b: NpcBoundary,
  checkpoint: CampaignCheckpoint,
  closure: NpcRecoveryClosure,
  rawSource: NpcAttemptPreparationSource,
  prepare: NpcAttemptPreparer,
  readers: Readers,
  integration: NpcPreparationIntegration,
): {
  prepared: NpcPreparedAttempt;
  context: NpcAttemptPreparationContext;
  pendingRestore: NpcPreparationRequest | null;
} {
  const source = guardedValue(db, () => preparationSource(rawSource));
  let previousOrNull: NpcAttemptEvent | null = null;
  let baseVersionOrNull: NpcVersion | null = null;
  let inheritedVersionForPreviousAttemptOrNull: NpcVersion | null = null;
  if (source.kind === 'EXISTING') {
    if ((b.kind !== 'REPLACE' && b.kind !== 'CANCEL') || b.expectedCurrentVersionOrNull !== null)
      return s.fail('INVALID_INPUT');
    previousOrNull = latestAttempt(closure, source.npcDraftId) ?? s.fail('NOT_FOUND');
    equal(previousOrNull.attempt.scope, b.scope);
    if (previousOrNull.attempt.status !== 'OPEN') return s.fail('UNAVAILABLE');
    if (previousOrNull.attempt.revision !== b.expectedAttemptRevisionOrNull)
      return s.fail('STALE_REVISION');
    const target = previousOrNull.attempt.targetOrNull;
    if (target !== null) {
      inheritedVersionForPreviousAttemptOrNull =
        closure.versions.find(
          (version) =>
            version.npcUuid === target.npcUuid && version.version === target.expectedCurrentVersion,
        ) ?? s.fail();
      equal(inheritedVersionForPreviousAttemptOrNull.scope, b.scope);
    }
  } else {
    if (b.kind !== source.kind || b.expectedAttemptRevisionOrNull !== null)
      return s.fail('INVALID_INPUT');
    if (source.kind === 'CREATE') {
      if (b.expectedCurrentVersionOrNull !== null) return s.fail('INVALID_INPUT');
    } else {
      baseVersionOrNull =
        closure.versions.filter((v) => v.npcUuid === source.target.npcUuid).at(-1) ??
        s.fail('NOT_FOUND');
      if (
        baseVersionOrNull.version !== source.target.expectedCurrentVersion ||
        baseVersionOrNull.version !== b.expectedCurrentVersionOrNull
      )
        return s.fail('STALE_REVISION');
    }
  }
  // A known identifier collision is rejected before any allocator/sampler in the callback.
  freshIdentities(db, b.operationId, []);
  const beforeGmSource = readCheckedGmSource(db, b, checkpoint, integration);
  if (closure.calendarContext !== null)
    equal(closure.calendarContext.currentQueuePrefixOrNull, beforeGmSource.queuePrefix);
  const context = freezePreparation(
    JSON.parse(
      s.canonical({
        calendarContext: closure.calendarContext,
        source,
        boundary: b,
        checkpoint,
        beforeGmSource,
        previousOrNull,
        previousReadContextOrNull:
          previousOrNull === null
            ? null
            : attemptContext(
                db,
                previousOrNull.attempt,
                previousOrNull.operationId,
                closure.children,
                closure.versions,
                readers,
                closure.calendarContext,
              ),
        baseVersionOrNull,
        inheritedVersionForPreviousAttemptOrNull,
      }),
    ) as NpcAttemptPreparationContext,
  );
  s.guarded(
    db,
    (): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(integration, 'validatePreparation');
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'function'
      )
        return s.fail('INVALID_INPUT');
      const checked: unknown = Reflect.apply(preparationCallable(descriptor.value), integration, [
        context,
      ]);
      // The existing SQL guard consumes native rejected promises without consulting a then getter.
      if (types.isPromise(checked)) return checked;
      if (checked !== undefined) return s.fail('INVALID_INPUT');
      return undefined;
    },
    context,
    'APPLY',
  );
  const reservation =
    b.request['messageType'] === 'network.npc-preparation.request'
      ? npcTechnicalRequestValue(b.request)
      : null;
  if (reservation !== null) {
    if (
      reservation.messageType !== 'network.npc-preparation.request' ||
      source.kind !== 'EXISTING' ||
      b.kind !== 'REPLACE' ||
      previousOrNull === null ||
      previousOrNull.attempt.stage !== reservation.sourceFormId ||
      context.previousReadContextOrNull === null
    )
      return s.fail('UNAVAILABLE');
    const prior = context.previousReadContextOrNull;
    const isItem = reservation.preparation.kind === 'ITEM_RESERVE';
    const isRestore = reservation.preparation.kind === 'ITEM_RESTORE';
    const isDisease = reservation.preparation.kind === 'DISEASE_RESERVE';
    const isTrauma = reservation.preparation.kind === 'TRAUMA_RESERVE';
    const isSymbiont = reservation.preparation.kind === 'SYMBIONT_RESERVE';
    const isWound = reservation.preparation.kind === 'WOUND_PREPARE';
    const isEquipment = reservation.preparation.kind === 'EQUIPMENT_COMPATIBILITY_CONFIRM';
    const isComposite = reservation.preparation.kind === 'COMPOSITE_ITEM_RESERVE';
    const isCustom =
      reservation.preparation.kind === 'CUSTOM_ITEM_RESERVE' ||
      reservation.preparation.kind === 'CUSTOM_MODIFIER_RESERVE' ||
      reservation.preparation.kind === 'CUSTOM_PROFILE_VERSION_RESERVE';
    const isRuntimeEffect =
      reservation.preparation.kind === 'ALCOHOL_PREPARE' ||
      reservation.preparation.kind === 'HP_MODE_PREPARE' ||
      reservation.preparation.kind === 'FORMAL_CONTROL_SET';
    const isLifeState =
      reservation.preparation.kind === 'LIFE_STATE_ROLL' ||
      reservation.preparation.kind === 'LIFE_STATE_SET';
    const isWeaverState =
      reservation.preparation.kind === 'WEAVER_STATE_PREPARE' ||
      reservation.preparation.kind === 'WEAVER_STATE_REMOVE';
    const isPoison =
      reservation.preparation.kind === 'POISON_MODE_SET' ||
      reservation.preparation.kind === 'POISON_COATING_PREPARE' ||
      reservation.preparation.kind === 'POISON_COATING_REMOVE';
    const isComposition =
      reservation.preparation.kind === 'COMPOSITION_CONFIRM' ||
      reservation.preparation.kind === 'COMPOSITION_RESOLVE';
    const reservationValues =
      isItem || isSymbiont || isCustom || isRestore
        ? reservation.preparation.values
        : isWound ||
            isEquipment ||
            isComposite ||
            isRuntimeEffect ||
            isLifeState ||
            isWeaverState ||
            isPoison
          ? reservation.preparation.input
          : isDisease
            ? reservation.preparation.diseaseId
            : reservation.preparation;
    s.guarded(
      db,
      (): unknown =>
        Reflect.apply(
          preparationCallable(
            isRestore
              ? readers.validateItemRestorePreparation
              : isPoison
                ? readers.validatePoisonPreparation
                : isCustom
                  ? readers.validateCustomItemPreparation
                  : isWeaverState
                    ? readers.validateWeaverStatePreparation
                    : isLifeState
                      ? readers.validateLifeStatePreparation
                      : isRuntimeEffect
                        ? readers.validateRuntimeEffectPreparation
                        : isComposite
                          ? readers.validateCompositeItemReservation
                          : isEquipment
                            ? readers.validateEquipmentCompatibilityPreparation
                            : isWound
                              ? readers.validateWoundPreparation
                              : isComposition
                                ? readers.validateCompositionPreparation
                                : isSymbiont
                                  ? readers.validateSymbiontReservation
                                  : isItem
                                    ? readers.validateItemReservation
                                    : isDisease
                                      ? readers.validateDiseaseReservation
                                      : isTrauma
                                        ? readers.validateTraumaReservation
                                        : readers.validateArtPreparation,
          ),
          readers,
          isComposition ||
            isRuntimeEffect ||
            isLifeState ||
            isCustom ||
            isRestore ||
            isWeaverState ||
            isPoison
            ? [reservation, context]
            : isTrauma
              ? [previousOrNull.attempt.values, prior]
              : [previousOrNull.attempt.values, reservationValues, prior],
        ),
      {
        previous: previousOrNull.attempt.values,
        input: reservationValues,
        context: prior,
      },
      'APPLY',
    );
  }
  let prepared: NpcPreparedAttempt | undefined;
  s.guarded(
    db,
    (): unknown => {
      const raw: unknown = preparationCallable(prepare)(context);
      if (types.isPromise(raw)) return raw;
      // Do not await/assimilate a thenable or invoke its then getter.
      const result = s.object(preparationData(raw));
      const hasChildren = Object.hasOwn(result, 'childAllocations');
      const hasOrdinaryFact = Object.hasOwn(result, 'ordinaryFact');
      const hasLifeStateFact = Object.hasOwn(result, 'lifeStateFact');
      s.object(result, [
        'next',
        'receiptId',
        'committedAt',
        ...(hasChildren ? ['childAllocations'] : []),
        ...(hasOrdinaryFact ? ['ordinaryFact'] : []),
        ...(hasLifeStateFact ? ['lifeStateFact'] : []),
      ]);
      const childAllocations = hasChildren
        ? npcChildAllocationsValue(result['childAllocations'])
        : [];
      if (
        childAllocations.some(
          (c) =>
            c.kind !== 'ITEM' &&
            c.kind !== 'LINKED_SET' &&
            c.kind !== 'CUSTOM_PROFILE' &&
            c.kind !== 'CUSTOM_PROFILE_VERSION' &&
            c.kind !== 'EFFECT_INSTANCE' &&
            c.kind !== 'COATING_INSTANCE' &&
            c.kind !== 'TRAUMA_INSTANCE' &&
            c.kind !== 'WOUND_INSTANCE' &&
            c.kind !== 'SYMBIONT_INSTANCE',
        )
      )
        return s.fail('INVALID_INPUT');
      prepared = {
        next: npcAttemptEnvelopeValue(result['next']),
        ...(hasOrdinaryFact
          ? { ordinaryFact: npcOrdinaryAuthoringFactValue(result['ordinaryFact']) }
          : {}),
        ...(hasLifeStateFact
          ? { lifeStateFact: npcLifeStateRollFactValue(result['lifeStateFact']) }
          : {}),
        ...(hasChildren
          ? {
              childAllocations: childAllocations as readonly Extract<
                NpcChildAllocation,
                {
                  kind:
                    | 'ITEM'
                    | 'LINKED_SET'
                    | 'CUSTOM_PROFILE'
                    | 'CUSTOM_PROFILE_VERSION'
                    | 'EFFECT_INSTANCE'
                    | 'COATING_INSTANCE'
                    | 'TRAUMA_INSTANCE'
                    | 'SYMBIONT_INSTANCE'
                    | 'WOUND_INSTANCE';
                }
              >[],
            }
          : {}),
        receiptId: s.uuid(result['receiptId']),
        committedAt: s.text(result['committedAt']),
      };
      return undefined;
    },
    context,
    'APPLY',
  );
  if (prepared === undefined) return s.fail('INVALID_INPUT');
  const facts = prepared.childAllocations ?? [];
  const allocation = facts[0];
  const custom = facts.some(
    (fact) => fact.kind === 'CUSTOM_PROFILE' || fact.kind === 'CUSTOM_PROFILE_VERSION',
  )
    ? npcPendingCustomProfile(
        facts,
        context.previousReadContextOrNull ?? s.fail('INVALID_INPUT'),
        b.operationId,
      )
    : null;
  if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    reservation.preparation.kind === 'ITEM_RESERVE'
  ) {
    if (facts.length !== 1 || allocation?.kind !== 'ITEM') return s.fail('INVALID_INPUT');
  } else if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    (reservation.preparation.kind === 'CUSTOM_ITEM_RESERVE' ||
      reservation.preparation.kind === 'CUSTOM_MODIFIER_RESERVE' ||
      reservation.preparation.kind === 'CUSTOM_PROFILE_VERSION_RESERVE')
  ) {
    if (custom === null) return s.fail('INVALID_INPUT');
    const request = reservation.preparation;
    if (request.kind === 'CUSTOM_ITEM_RESERVE') {
      if (!custom.newItem || custom.reference.kind !== 'CAMPAIGN_CUSTOM_PROFILE')
        return s.fail('INVALID_INPUT');
    } else {
      if (custom.newItem || custom.itemInstanceId !== request.itemInstanceId)
        return s.fail('INVALID_INPUT');
      if (request.kind === 'CUSTOM_MODIFIER_RESERVE') {
        if (custom.reference.kind !== 'CATALOG_CUSTOM_MODIFIER' || custom.reference.version !== 1)
          return s.fail('INVALID_INPUT');
      } else if (
        custom.reference.profileId !== request.profileId ||
        facts[0]?.kind !== 'CUSTOM_PROFILE_VERSION' ||
        facts[0].previousVersionIdOrNull !== request.expectedProfileVersionId
      )
        return s.fail('INVALID_INPUT');
    }
  } else if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    reservation.preparation.kind === 'COMPOSITE_ITEM_RESERVE'
  ) {
    const set = pendingComposite(facts);
    if (set === null || set.itemTypeId !== reservation.preparation.input.itemTypeId)
      return s.fail('INVALID_INPUT');
  } else if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    (reservation.preparation.kind === 'ALCOHOL_PREPARE' ||
      reservation.preparation.kind === 'HP_MODE_PREPARE' ||
      reservation.preparation.kind === 'FORMAL_CONTROL_SET')
  ) {
    const source = pendingRuntimeEffect(facts),
      requested =
        reservation.preparation.kind === 'ALCOHOL_PREPARE'
          ? 'ALCOHOL'
          : reservation.preparation.kind === 'HP_MODE_PREPARE'
            ? 'HP_MODE'
            : 'FORMAL_CONTROL';
    if (requested === 'HP_MODE' ? facts.length !== 1 : facts.length > 1)
      return s.fail('INVALID_INPUT');
    if (facts.length !== 0 && (source === null || source.sourceKind !== requested))
      return s.fail('INVALID_INPUT');
    if (
      source?.sourceKind === 'FORMAL_CONTROL' &&
      reservation.preparation.kind === 'FORMAL_CONTROL_SET' &&
      source.controlKind !== reservation.preparation.input.controlKind
    )
      return s.fail('INVALID_INPUT');
  } else if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    reservation.preparation.kind === 'POISON_MODE_SET'
  ) {
    if (
      facts.length !== 1 ||
      allocation?.kind !== 'EFFECT_INSTANCE' ||
      !('sourceKind' in allocation) ||
      allocation.sourceKind !== 'POISON_MODE' ||
      allocation.sourceInstanceId !== reservation.preparation.input.sourceInstanceId
    )
      return s.fail('INVALID_INPUT');
  } else if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    reservation.preparation.kind === 'POISON_COATING_PREPARE'
  ) {
    if (
      facts.length !== 1 ||
      allocation?.kind !== 'COATING_INSTANCE' ||
      allocation.itemInstanceId !== reservation.preparation.input.targetItemInstanceId ||
      allocation.sourceInstanceId !== reservation.preparation.input.sourceInstanceId
    )
      return s.fail('INVALID_INPUT');
  } else if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    reservation.preparation.kind === 'WEAVER_STATE_PREPARE'
  ) {
    if (
      facts.length !== 1 ||
      allocation?.kind !== 'EFFECT_INSTANCE' ||
      !('sourceKind' in allocation) ||
      allocation.sourceKind !== 'WEAVER_STATE' ||
      allocation.sourceInstanceId !== reservation.preparation.input.sourceInstanceId ||
      allocation.branch !== reservation.preparation.input.branch
    )
      return s.fail('INVALID_INPUT');
  } else if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    reservation.preparation.kind === 'LIFE_STATE_SET'
  ) {
    if (
      facts.length > 1 ||
      (allocation !== undefined &&
        (allocation.kind !== 'EFFECT_INSTANCE' ||
          !('sourceKind' in allocation) ||
          allocation.sourceKind !== 'LIFE_TIMER' ||
          reservation.preparation.input.lifeKind !== 'SEVERELY_WOUNDED'))
    )
      return s.fail('INVALID_INPUT');
  } else if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    reservation.preparation.kind === 'DISEASE_RESERVE'
  ) {
    if (
      facts.length !== 1 ||
      allocation?.kind !== 'EFFECT_INSTANCE' ||
      !('diseaseId' in allocation) ||
      allocation.diseaseId !== reservation.preparation.diseaseId
    )
      return s.fail('INVALID_INPUT');
  } else if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    reservation.preparation.kind === 'TRAUMA_RESERVE'
  ) {
    if (facts.length !== 1 || allocation?.kind !== 'TRAUMA_INSTANCE')
      return s.fail('INVALID_INPUT');
  } else if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    reservation.preparation.kind === 'SYMBIONT_RESERVE'
  ) {
    if (facts.length !== 1 || allocation?.kind !== 'SYMBIONT_INSTANCE')
      return s.fail('INVALID_INPUT');
  } else if (
    reservation?.messageType === 'network.npc-preparation.request' &&
    reservation.preparation.kind === 'WOUND_PREPARE'
  ) {
    if (facts.length !== 1 || allocation?.kind !== 'WOUND_INSTANCE') return s.fail('INVALID_INPUT');
  } else if (facts.length !== 0) return s.fail('INVALID_INPUT');
  const pendingRestore =
    reservation?.messageType === 'network.npc-preparation.request' &&
    reservation.preparation.kind === 'ITEM_RESTORE'
      ? reservation
      : null;
  const readContext = attemptContext(
    db,
    prepared.next,
    b.operationId,
    closure.children,
    closure.versions,
    readers,
    closure.calendarContext,
    custom === null && allocation?.kind === 'ITEM' ? allocation.id : null,
    undefined,
    allocation?.kind === 'EFFECT_INSTANCE' && 'diseaseId' in allocation
      ? { effectInstanceId: allocation.id, diseaseId: allocation.diseaseId }
      : null,
    allocation?.kind === 'TRAUMA_INSTANCE' ? allocation.id : null,
    allocation?.kind === 'SYMBIONT_INSTANCE' ? allocation.id : null,
    allocation?.kind === 'WOUND_INSTANCE' ? allocation.id : null,
    pendingRuntimeEffect(facts),
    pendingComposite(facts),
    custom,
    pendingRestore,
    pendingCoating(facts),
  );
  prepared = {
    ...prepared,
    next: guardedValue(db, () => npcAttemptValue(prepared?.next, readers, readContext)),
  };
  equal(prepared.next.scope, b.scope);
  if (source.kind === 'EXISTING') equal(prepared.next.npcDraftId, source.npcDraftId);
  else
    equal(
      [prepared.next.mode, prepared.next.targetOrNull],
      source.kind === 'CREATE' ? ['CREATE_V1', null] : ['APPEND_N_PLUS_ONE', source.target],
    );
  return { prepared, context, pendingRestore };
}

export interface NpcWriterEvidenceResult {
  readonly operation: NpcOperation;
  readonly replayed: boolean;
  readonly attemptEvent: NpcAttemptEvent;
}
/** Detached immutable evidence from the same fully checked read; never a replacement for recovery. */
function writerEvidence(
  operation: NpcOperation,
  replayed: boolean,
  closure: NpcRecoveryClosure,
): NpcWriterEvidenceResult {
  const matches = closure.attempts.filter((event) => event.operationId === operation.operationId);
  const event = matches[0];
  if (matches.length !== 1 || event === undefined || digest(event) !== operation.attemptEventSha256)
    return s.fail('SOURCE_CHANGED');
  equal(event.attempt.scope, operation.scope);
  return Object.freeze({
    operation,
    replayed,
    attemptEvent: freezePreparation(JSON.parse(s.canonical(event)) as NpcAttemptEvent),
  });
}
function originalWriteResult(result: NpcWriterEvidenceResult) {
  return { operation: result.operation, replayed: result.replayed };
}

/** Technical attempt only; OPEN and COMMIT require distinct IDs in one global uniqueness namespace. */
export function saveNpcAttempt(
  db: Database.Database,
  boundary: NpcBoundary,
  next: NpcAttempt,
  receiptId: string,
  committedAt: string,
  readers: Readers,
  integration: NpcTransactionIntegration,
) {
  return withNpcAttemptEnvelopeCalculations(() => {
    return originalWriteResult(
      saveAttempt(
        db,
        boundary,
        { kind: 'EAGER', next, receiptId, committedAt },
        readers,
        integration,
      ),
    );
  });
}
/** Exact replay and current source checks precede factory entry; the factory never receives SQL access. */
export function saveNpcAttemptPrepared(
  db: Database.Database,
  boundary: NpcBoundary,
  source: NpcAttemptPreparationSource,
  prepare: NpcAttemptPreparer,
  readers: Readers,
  integration: NpcPreparationIntegration,
) {
  return originalWriteResult(
    saveNpcAttemptPreparedWithEvidence(db, boundary, source, prepare, readers, integration),
  );
}
/** Owning host delivery consumes this event without reopening the complete NPC history. */
export function saveNpcAttemptPreparedWithEvidence(
  db: Database.Database,
  boundary: NpcBoundary,
  source: NpcAttemptPreparationSource,
  prepare: NpcAttemptPreparer,
  readers: Readers,
  integration: NpcPreparationIntegration,
) {
  return withNpcAttemptEnvelopeCalculations(() => {
    return saveAttempt(
      db,
      boundary,
      { kind: 'PREPARED', source, prepare, integration },
      readers,
      integration,
    );
  });
}
function saveAttempt(
  db: Database.Database,
  boundary: NpcBoundary,
  input:
    | ({ readonly kind: 'EAGER' } & NpcPreparedAttempt)
    | {
        readonly kind: 'PREPARED';
        readonly source: NpcAttemptPreparationSource;
        readonly prepare: NpcAttemptPreparer;
        readonly integration: NpcPreparationIntegration;
      },
  readers: Readers,
  integration: NpcTransactionIntegration,
) {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  return db
    .transaction(() => {
      if (!schema(db)) return s.fail('UNAVAILABLE');
      const b = guardedValue(db, () => checkedBoundary(boundary, readers));
      if (b.kind === 'COMMIT' || b.kind === 'COMMIT_V1') return s.fail('INVALID_INPUT');
      const checkpoint = loadCampaignCheckpoint(db, b.scope.campaignId),
        closure = verifyCurrentNpcAnchor(db, checkpoint, readers);
      const known = knownOperation(db, b, closure);
      validateBoundary(
        db,
        b,
        checkpoint,
        integration,
        known === null ? 'APPLY' : 'REPLAY',
        closure,
      );
      if (known !== null) return writerEvidence(known, true, closure);
      const lazy =
        input.kind === 'PREPARED'
          ? preparedAttempt(
              db,
              b,
              checkpoint,
              closure,
              input.source,
              input.prepare,
              readers,
              input.integration,
            )
          : null;
      const {
        next,
        receiptId,
        committedAt,
        childAllocations = [],
        ordinaryFact,
        lifeStateFact,
      } = input.kind === 'EAGER' ? input : (lazy?.prepared ?? s.fail());
      const envelope = guardedValue(db, () => npcAttemptEnvelopeValue(next));
      const custom = childAllocations.some(
        (fact) => fact.kind === 'CUSTOM_PROFILE' || fact.kind === 'CUSTOM_PROFILE_VERSION',
      )
        ? npcPendingCustomProfile(
            childAllocations,
            lazy?.context.previousReadContextOrNull ?? s.fail('INVALID_INPUT'),
            b.operationId,
          )
        : null;
      const readContext = attemptContext(
        db,
        envelope,
        b.operationId,
        closure.children,
        closure.versions,
        readers,
        closure.calendarContext,
        custom === null && childAllocations[0]?.kind === 'ITEM' ? childAllocations[0].id : null,
        undefined,
        childAllocations[0]?.kind === 'EFFECT_INSTANCE' && 'diseaseId' in childAllocations[0]
          ? { effectInstanceId: childAllocations[0].id, diseaseId: childAllocations[0].diseaseId }
          : null,
        childAllocations[0]?.kind === 'TRAUMA_INSTANCE' ? childAllocations[0].id : null,
        childAllocations[0]?.kind === 'SYMBIONT_INSTANCE' ? childAllocations[0].id : null,
        childAllocations[0]?.kind === 'WOUND_INSTANCE' ? childAllocations[0].id : null,
        pendingRuntimeEffect(childAllocations),
        pendingComposite(childAllocations),
        custom,
        // A no-allocation restore is not in SQL yet; both pre-insert readers need
        // the same already validated intent to bind its immutable physical graph.
        lazy?.pendingRestore ?? null,
        pendingCoating(childAllocations),
      );
      const attempt = guardedValue(db, () => npcAttemptValue(envelope, readers, readContext)),
        previous = latestAttempt(closure, attempt.npcDraftId);
      equal(attempt.scope, b.scope);
      if ((previous?.attempt.revision ?? null) !== b.expectedAttemptRevisionOrNull)
        return s.fail('STALE_REVISION');
      if (b.kind === 'OPEN') {
        const target = attempt.targetOrNull ?? s.fail('INVALID_INPUT');
        const current =
          closure.versions.filter((v) => v.npcUuid === target.npcUuid).at(-1) ??
          s.fail('NOT_FOUND');
        if (
          current.version !== b.expectedCurrentVersionOrNull ||
          current.version !== target.expectedCurrentVersion
        )
          return s.fail('STALE_REVISION');
      }
      const beforeGmSource =
        lazy?.context.beforeGmSource ?? readCheckedGmSource(db, b, checkpoint, integration);
      const commonEvent = {
        operationId: b.operationId,
        previousSha256OrNull: previous === undefined ? null : digest(previous),
        attempt,
      };
      const event: NpcAttemptEvent =
        ordinaryFact !== undefined ||
        lifeStateFact !== undefined ||
        childAllocations.length !== 0 ||
        (previous !== undefined && 'format' in previous) ||
        readContext.itemBindings.length !== 0 ||
        readContext.effectBindings.length !== 0 ||
        readContext.traumaBindings.length !== 0 ||
        readContext.symbiontBindings.length !== 0
          ? {
              ...commonEvent,
              format: 'NPC_ATTEMPT_EVENT_V2',
              childAllocations,
              ...(ordinaryFact === undefined ? {} : { ordinaryFact }),
              ...(lifeStateFact === undefined ? {} : { lifeStateFact }),
            }
          : commonEvent;
      const operation: NpcOperation = {
        operationId: b.operationId,
        receiptId: s.uuid(receiptId),
        kind: b.kind,
        scope: b.scope,
        request: b.request,
        attemptEventSha256: digest(event),
        versionOrNull: null,
        anchorOrNull: null,
        beforeGmSource,
        beforeCheckpoint: checkpoint,
        afterCheckpoint: checkpoint,
        committedAt: s.text(committedAt),
      };
      verifyAttemptStep(event, previous, operation);
      guardedValue(db, () => {
        verifyNpcRequestBinding(event, operation, readers);
        return true;
      });
      validateAttemptOrigin(
        db,
        attempt,
        operation,
        closure.versions,
        readers,
        closure.calendarContext,
      );
      freshIdentities(db, b.operationId, [
        operation.receiptId,
        ...(previous === undefined ? [attempt.npcDraftId] : []),
        ...(b.kind === 'CREATE' ? [attempt.candidateNpcUuid] : []),
        ...childAllocations.map((c) => c.id),
      ]);
      const children = npcChildIdentities(
        [...closure.attempts, event],
        [...closure.operations, operation],
      );
      writeAttempt(db, event, previous);
      writeNpcChildIndex(
        db,
        children.filter((c) => c.originOperationId === b.operationId),
      );
      if (b.kind === 'CREATE')
        db.prepare('INSERT INTO npc_identity_reservation VALUES (?,?,?,?)').run(
          attempt.candidateNpcUuid,
          b.scope.campaignId,
          attempt.npcDraftId,
          b.operationId,
        );
      writeOperation(db, operation);
      mirror(db, integration, operation);
      equal(loadCampaignCheckpoint(db, b.scope.campaignId), checkpoint);
      const after = verifyCurrentNpcAnchor(db, checkpoint, readers);
      equal(
        after.operations.find((o) => o.operationId === b.operationId),
        operation,
      );
      validateBoundary(db, b, checkpoint, integration, 'AFTER', after);
      return writerEvidence(operation, false, after);
    })
    .immediate();
}

export interface NpcCommitInput {
  readonly childAllocations?: readonly Extract<
    NpcChildAllocation,
    { kind: 'WEAPON_PROFILE_VERSION' }
  >[];
  readonly npcDraftId: string;
  readonly npcUuid: string;
  readonly receiptId: string;
  readonly checkpointId: string;
  readonly committedAt: string;
  readonly snapshot: JsonObject;
  readonly lifetimeFacts: JsonObject;
  readonly art: NpcArt;
  /** Host-proved PRE_START_INITIAL minute only. Post-Start/untimed commits pass null. */
  readonly preStartTimeOrNull: number | null;
  readonly projectionChanged: boolean;
  readonly visibilityChanged: boolean;
}
export interface NpcCommitPreparationContext {
  readonly calendarContext: NpcCalendarReadContext | null;
  readonly boundary: NpcBoundary;
  readonly checkpoint: CampaignCheckpoint;
  readonly beforeGmSource: NpcGmSource;
  readonly previous: NpcAttemptEvent;
  readonly attemptReadContext: NpcAttemptReadContext;
  readonly previousVersionOrNull: NpcVersion | null;
}
export interface NpcCommitPreparationIntegration extends NpcTransactionIntegration {
  /** Proves the exact active NPC-017 attempt and workflow request before any allocation. */
  readonly validateCommitPreparation: (context: NpcCommitPreparationContext) => void;
}
export type NpcCommitPreparer = (context: NpcCommitPreparationContext) => NpcCommitInput;

function preparedCommit(
  db: Database.Database,
  b: NpcBoundary,
  checkpoint: CampaignCheckpoint,
  closure: NpcRecoveryClosure,
  npcDraftId: string,
  prepare: NpcCommitPreparer,
  readers: Readers,
  integration: NpcCommitPreparationIntegration,
): { input: NpcCommitInput; context: NpcCommitPreparationContext } {
  const previous = latestAttempt(closure, s.uuid(npcDraftId)) ?? s.fail('NOT_FOUND');
  const a = previous.attempt;
  equal(a.scope, b.scope);
  if (a.status !== 'OPEN' || a.stage !== 'NPC-017') return s.fail('UNAVAILABLE');
  if (a.revision !== b.expectedAttemptRevisionOrNull) return s.fail('STALE_REVISION');
  const previousVersionOrNull =
    closure.versions.filter((v) => v.npcUuid === a.candidateNpcUuid).at(-1) ?? null;
  if (a.mode === 'CREATE_V1') {
    if (
      !closure.reservations.some(
        (reservation) =>
          reservation.npcDraftId === a.npcDraftId &&
          reservation.candidateNpcUuid === a.candidateNpcUuid,
      )
    )
      return s.fail();
    if (
      b.kind !== 'COMMIT_V1' ||
      previousVersionOrNull !== null ||
      b.expectedCurrentVersionOrNull !== null
    )
      return s.fail('IDEMPOTENCY_CONFLICT');
  } else {
    if (
      b.kind !== 'COMMIT' ||
      a.targetOrNull?.npcUuid !== a.candidateNpcUuid ||
      previousVersionOrNull === null
    )
      return s.fail('FOREIGN_OWNER');
    if (
      previousVersionOrNull.version !== a.targetOrNull.expectedCurrentVersion ||
      previousVersionOrNull.version !== b.expectedCurrentVersionOrNull
    )
      return s.fail('STALE_REVISION');
  }
  freshIdentities(db, b.operationId, []);
  const beforeGmSource = readCheckedGmSource(db, b, checkpoint, integration);
  if (closure.calendarContext !== null)
    equal(closure.calendarContext.currentQueuePrefixOrNull, beforeGmSource.queuePrefix);
  const context = freezePreparation(
    JSON.parse(
      s.canonical({
        calendarContext: closure.calendarContext,
        boundary: b,
        checkpoint,
        beforeGmSource,
        previous,
        attemptReadContext: attemptContext(
          db,
          a,
          previous.operationId,
          closure.children,
          closure.versions,
          readers,
          closure.calendarContext,
        ),
        previousVersionOrNull,
      }),
    ) as NpcCommitPreparationContext,
  );
  s.guarded(
    db,
    (): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(integration, 'validateCommitPreparation');
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'function'
      )
        return s.fail('INVALID_INPUT');
      const checked: unknown = Reflect.apply(preparationCallable(descriptor.value), integration, [
        context,
      ]);
      if (types.isPromise(checked)) return checked;
      if (checked !== undefined) return s.fail('INVALID_INPUT');
      return undefined;
    },
    context,
    'APPLY',
  );
  let input: NpcCommitInput | undefined;
  s.guarded(
    db,
    (): unknown => {
      const raw: unknown = preparationCallable(prepare)(context);
      if (types.isPromise(raw)) return raw;
      // Closed structural/semantic readers below still validate every field of this detached data.
      const result = s.object(preparationData(raw));
      const hasChildren = Object.hasOwn(result, 'childAllocations');
      const children = hasChildren ? npcChildAllocationsValue(result['childAllocations']) : [];
      if (children.some((c) => c.kind !== 'WEAPON_PROFILE_VERSION')) return s.fail('INVALID_INPUT');
      input = s.object(result, [
        ...(hasChildren ? ['childAllocations'] : []),
        'npcDraftId',
        'npcUuid',
        'receiptId',
        'checkpointId',
        'committedAt',
        'snapshot',
        'lifetimeFacts',
        'art',
        'preStartTimeOrNull',
        'projectionChanged',
        'visibilityChanged',
      ]) as unknown as NpcCommitInput;
      return undefined;
    },
    context,
    'APPLY',
  );
  if (input === undefined) return s.fail('INVALID_INPUT');
  equal([input.npcDraftId, input.npcUuid], [a.npcDraftId, a.candidateNpcUuid]);
  return { input, context };
}

/** Existing eager input contract; the lazy entry point below prevents replay allocations. */
export function commitNpcVersion(
  db: Database.Database,
  boundary: NpcBoundary,
  input: NpcCommitInput,
  readers: Readers,
  integration: NpcTransactionIntegration,
) {
  return withNpcAttemptEnvelopeCalculations(() => {
    return originalWriteResult(
      commitNpcVersionInternal(db, boundary, { kind: 'EAGER', value: input }, readers, integration),
    );
  });
}
/** Host allocators run only after the current source and exact workflow request are proved. */
export function commitNpcVersionPrepared(
  db: Database.Database,
  boundary: NpcBoundary,
  npcDraftId: string,
  prepare: NpcCommitPreparer,
  readers: Readers,
  integration: NpcCommitPreparationIntegration,
) {
  return originalWriteResult(
    commitNpcVersionPreparedWithEvidence(db, boundary, npcDraftId, prepare, readers, integration),
  );
}
/** Same transaction and recovery checks; detached event evidence only changes the return value. */
export function commitNpcVersionPreparedWithEvidence(
  db: Database.Database,
  boundary: NpcBoundary,
  npcDraftId: string,
  prepare: NpcCommitPreparer,
  readers: Readers,
  integration: NpcCommitPreparationIntegration,
) {
  return withNpcAttemptEnvelopeCalculations(() => {
    return commitNpcVersionInternal(
      db,
      boundary,
      { kind: 'PREPARED', npcDraftId, prepare, integration },
      readers,
      integration,
    );
  });
}
/** Owns the aggregate transaction. No public partial NPC append is exposed. */
function commitNpcVersionInternal(
  db: Database.Database,
  boundary: NpcBoundary,
  input:
    | Readonly<{ kind: 'EAGER'; value: NpcCommitInput }>
    | Readonly<{
        kind: 'PREPARED';
        npcDraftId: string;
        prepare: NpcCommitPreparer;
        integration: NpcCommitPreparationIntegration;
      }>,
  readers: Readers,
  integration: NpcTransactionIntegration,
) {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const scope = npcScopeValue(
    s.object(boundary, [
      'scope',
      'operationId',
      'kind',
      'request',
      'expectedAttemptRevisionOrNull',
      'expectedCurrentVersionOrNull',
    ])['scope'],
  );
  // Exact replay never enters the checkpoint writer (even its identical UPSERT is a write).
  const replay = db
    .transaction(() => {
      if (!schema(db)) return s.fail('UNAVAILABLE');
      const b = guardedValue(db, () => checkedBoundary(boundary, readers));
      if (b.kind !== 'COMMIT_V1' && b.kind !== 'COMMIT') return s.fail('INVALID_INPUT');
      const current = loadCampaignCheckpoint(db, scope.campaignId),
        closure = verifyCurrentNpcAnchor(db, current, readers);
      const known = knownOperation(db, b, closure);
      if (known !== null) validateBoundary(db, b, current, integration, 'REPLAY', closure);
      return known === null ? null : writerEvidence(known, true, closure);
    })
    .deferred();
  if (replay !== null) return replay;
  return commitCampaignCheckpoint(db, scope.campaignId, () => {
    const b = guardedValue(db, () => checkedBoundary(boundary, readers));
    if (b.kind !== 'COMMIT_V1' && b.kind !== 'COMMIT') return s.fail('INVALID_INPUT');
    const before = loadCampaignCheckpoint(db, b.scope.campaignId),
      closure = verifyCurrentNpcAnchor(db, before, readers);
    const known = knownOperation(db, b, closure);
    if (known !== null) return s.fail('SOURCE_CHANGED');
    validateBoundary(db, b, before, integration, 'APPLY', closure);
    const lazy =
      input.kind === 'PREPARED'
        ? preparedCommit(
            db,
            b,
            before,
            closure,
            input.npcDraftId,
            input.prepare,
            readers,
            input.integration,
          )
        : null;
    const source = JSON.parse(
      s.canonical(input.kind === 'EAGER' ? input.value : lazy?.input),
    ) as NpcCommitInput;
    const hasChildren = Object.hasOwn(source, 'childAllocations');
    const childAllocations = hasChildren ? npcChildAllocationsValue(source.childAllocations) : [];
    if (
      childAllocations.some((c) => c.kind !== 'WEAPON_PROFILE_VERSION') ||
      (childAllocations.length !== 0 && input.kind !== 'PREPARED')
    )
      return s.fail('INVALID_INPUT');
    s.object(source, [
      ...(hasChildren ? ['childAllocations'] : []),
      'npcDraftId',
      'npcUuid',
      'receiptId',
      'checkpointId',
      'committedAt',
      'snapshot',
      'lifetimeFacts',
      'art',
      'preStartTimeOrNull',
      'projectionChanged',
      'visibilityChanged',
    ]);
    if (
      typeof source.projectionChanged !== 'boolean' ||
      typeof source.visibilityChanged !== 'boolean'
    )
      return s.fail('INVALID_INPUT');
    const previous = latestAttempt(closure, s.uuid(source.npcDraftId)) ?? s.fail('NOT_FOUND');
    const a = previous.attempt;
    equal(a.scope, b.scope);
    if (a.status !== 'OPEN' || a.stage !== 'NPC-017') return s.fail('UNAVAILABLE');
    if (a.revision !== b.expectedAttemptRevisionOrNull) return s.fail('STALE_REVISION');
    const id = s.uuid(source.npcUuid),
      oldVersion = closure.versions.filter((v) => v.npcUuid === id).at(-1);
    if (id !== a.candidateNpcUuid) return s.fail('FOREIGN_OWNER');
    if (a.mode === 'CREATE_V1') {
      if (
        !closure.reservations.some(
          (r) => r.npcDraftId === a.npcDraftId && r.candidateNpcUuid === id,
        )
      )
        return s.fail();
      if (
        b.kind !== 'COMMIT_V1' ||
        oldVersion !== undefined ||
        b.expectedCurrentVersionOrNull !== null
      )
        return s.fail('IDEMPOTENCY_CONFLICT');
    } else {
      if (b.kind !== 'COMMIT' || a.targetOrNull?.npcUuid !== id || oldVersion === undefined)
        return s.fail('FOREIGN_OWNER');
      if (
        oldVersion.version !== a.targetOrNull.expectedCurrentVersion ||
        oldVersion.version !== b.expectedCurrentVersionOrNull
      )
        return s.fail('STALE_REVISION');
    }
    const attempt = { ...a, revision: s.increment(a.revision), status: 'COMMITTED' as const };
    const beforeGmSource =
      lazy?.context.beforeGmSource ?? readCheckedGmSource(db, b, before, integration);
    const commitReadContext = attemptContext(
      db,
      attempt,
      b.operationId,
      closure.children,
      closure.versions,
      readers,
      closure.calendarContext,
    );
    equal(
      guardedValue(db, () => npcAttemptValue(attempt, readers, commitReadContext)),
      attempt,
    );
    const commonEvent = {
      operationId: b.operationId,
      previousSha256OrNull: digest(previous),
      attempt,
    };
    const event: NpcAttemptEvent =
      childAllocations.length !== 0 ||
      'format' in previous ||
      commitReadContext.itemBindings.length !== 0 ||
      commitReadContext.effectBindings.length !== 0 ||
      commitReadContext.traumaBindings.length !== 0
        ? { ...commonEvent, format: 'NPC_ATTEMPT_EVENT_V2', childAllocations }
        : commonEvent;
    const art = npcArtValue(source.art),
      libraryRevision = s.increment(closure.anchorOrNull?.libraryRevision ?? 0);
    // Fresh audit evidence comes from the checked writer input, never the candidate snapshot.
    const pendingCommit = npcPendingCommitEvidenceValue({
      kind: 'PENDING_NPC_COMMIT',
      scope: b.scope,
      operationId: b.operationId,
      npcUuid: id,
      npcDraftId: a.npcDraftId,
      version: oldVersion === undefined ? 1 : s.increment(oldVersion.version),
      attemptRevision: attempt.revision,
      committedAt: s.text(source.committedAt),
      beforeCheckpointSha256: digest(before),
      beforeGmSource,
    });
    const version = guardedValue(db, () =>
      npcVersionValue(
        {
          scope: b.scope,
          npcUuid: id,
          version: oldVersion === undefined ? 1 : s.increment(oldVersion.version),
          libraryRevision,
          operationId: b.operationId,
          npcDraftId: a.npcDraftId,
          attemptRevision: attempt.revision,
          previousVersionSha256OrNull: oldVersion === undefined ? null : digest(oldVersion),
          snapshot: source.snapshot,
          lifetimeFacts: source.lifetimeFacts,
          art: { assetKey: art.assetKey, sha256: art.sha256 },
          committedAt: s.text(source.committedAt),
        },
        readers,
        closure.calendarContext,
        pendingCommit,
      ),
    );
    s.guarded(
      db,
      () => {
        const validate = npcSynchronousValidator(readers.validateVersion);
        return validate.call(
          readers,
          version,
          attempt,
          oldVersion ?? null,
          closure.calendarContext,
          pendingCommit,
          null,
        );
      },
      { version, attempt, previous: oldVersion ?? null },
      'APPLY',
    );
    const versions = [...closure.versions, version],
      oldLock = closure.blocks.at(-1)?.initialTimeLockOrNull ?? null;
    equal(
      source.preStartTimeOrNull,
      requiredPreStartTime(db, version.snapshot, readers, closure.calendarContext, pendingCommit),
    );
    const initialTimeLockOrNull =
      source.preStartTimeOrNull === null
        ? oldLock
        : npcTimeLockValue({
            campaignTimestamp: source.preStartTimeOrNull,
            operationId: oldLock?.operationId ?? b.operationId,
            npcUuid: oldLock?.npcUuid ?? id,
            version: oldLock?.version ?? version.version,
          });
    if (oldLock !== null) equal(initialTimeLockOrNull, oldLock);
    const block = npcLibraryBlockValue({
      format: 'NPC_LIBRARY_RECOVERY_V1',
      campaignId: b.scope.campaignId,
      libraryRevision,
      checkpointId: s.uuid(source.checkpointId),
      versions: refs(versions),
      heads: heads(versions),
      artSha256s: [...new Set(versions.map((v) => v.art.sha256))].sort(),
      initialTimeLockOrNull,
    });
    const after = npcCheckpointAfter(
      before,
      anchor(block),
      source.projectionChanged,
      source.visibilityChanged,
    );
    const operation: NpcOperation = {
      operationId: b.operationId,
      receiptId: s.uuid(source.receiptId),
      kind: b.kind,
      scope: b.scope,
      request: b.request,
      attemptEventSha256: digest(event),
      versionOrNull: ref(version),
      anchorOrNull: anchor(block),
      beforeGmSource,
      beforeCheckpoint: before,
      afterCheckpoint: after,
      committedAt: version.committedAt,
    };
    verifyAttemptStep(event, previous, operation);
    verifyNpcRequestBinding(event, operation, readers);
    const children = npcChildIdentities(
      [...closure.attempts, event],
      [...closure.operations, operation],
    );
    verifyNpcPublishedChildren(
      version,
      publishedChildGraph(db, version.snapshot, readers, closure.calendarContext, pendingCommit),
      oldVersion === undefined
        ? null
        : publishedChildGraph(db, oldVersion.snapshot, readers, closure.calendarContext),
      children,
      commitReadContext,
    );
    freshIdentities(db, b.operationId, [
      operation.receiptId,
      block.checkpointId,
      ...childAllocations.map((c) => c.id),
      // The entity owner is the attempt's checked reservation, not a new allocation.
    ]);
    const blob = npcArtBlobValue({
      mediaType: art.mediaType,
      sha256: art.sha256,
      bytesBase64: art.bytesBase64,
    });
    const knownArt = closure.art.find((a) => a.sha256 === art.sha256);
    if (knownArt !== undefined) equal(knownArt, blob);
    else
      writeRecord(
        db,
        'INSERT INTO npc_art VALUES (?,?,?,?)',
        [b.scope.campaignId, art.sha256],
        blob,
      );
    writeRecord(
      db,
      'INSERT INTO npc_version VALUES (?,?,?,?,?,?,?)',
      [b.scope.campaignId, id, version.version, libraryRevision, b.operationId],
      version,
    );
    const updated =
      oldVersion === undefined
        ? db
            .prepare('INSERT INTO npc_current_head VALUES (?,?,?,?)')
            .run(b.scope.campaignId, id, version.version, digest(version))
        : db
            .prepare(
              'UPDATE npc_current_head SET version=?,record_sha256=? WHERE campaign_id=? AND npc_uuid=? AND version=? AND record_sha256=?',
            )
            .run(
              version.version,
              digest(version),
              b.scope.campaignId,
              id,
              oldVersion.version,
              digest(oldVersion),
            );
    if (updated.changes !== 1) return s.fail('SOURCE_CHANGED');
    writeRecord(
      db,
      'INSERT INTO npc_library_checkpoint VALUES (?,?,?,?,?)',
      [b.scope.campaignId, libraryRevision, block.checkpointId],
      block,
    );
    writeAttempt(db, event, previous);
    writeNpcChildIndex(
      db,
      children.filter((c) => c.originOperationId === b.operationId),
    );
    writeOperation(db, operation);
    const beforeParts = campaignParts(before),
      afterParts = campaignParts(after);
    const campaignWrite = db
      .prepare('UPDATE campaign SET payload_json=? WHERE campaign_id=? AND payload_json=?')
      .run(
        afterParts.campaign['payloadJson'],
        b.scope.campaignId,
        beforeParts.campaign['payloadJson'],
      );
    if (campaignWrite.changes !== 1) return s.fail('SOURCE_CHANGED');
    advanceRevisions(
      db,
      { entity: 'campaign', entityId: b.scope.campaignId },
      {
        stateChanged: true,
        projectionChanged: source.projectionChanged,
        actorVisibilityChanged: source.visibilityChanged,
      },
    );
    // Install the exact planned checkpoint inside the same transaction so the full post-write reader
    // can reject a trigger/cursor/history mismatch before the owning store wrapper commits.
    const checkpointWrite = db
      .prepare(
        'UPDATE campaign_checkpoint SET snapshot_json=?,stateRevision=?,projectionRevision=?,actorVisibilityRevision=? WHERE campaign_id=? AND snapshot_json=? AND stateRevision=? AND projectionRevision=? AND actorVisibilityRevision=?',
      )
      .run(
        after.snapshotJson,
        after.stateRevision,
        after.projectionRevision,
        after.actorVisibilityRevision,
        b.scope.campaignId,
        before.snapshotJson,
        before.stateRevision,
        before.projectionRevision,
        before.actorVisibilityRevision,
      );
    if (checkpointWrite.changes !== 1) return s.fail('SOURCE_CHANGED');
    mirror(db, integration, operation);
    equal(loadCampaignCheckpoint(db, b.scope.campaignId), after);
    const checkedAfter = verifyCurrentNpcAnchor(db, after, readers);
    equal(
      checkedAfter.operations.find((o) => o.operationId === b.operationId),
      operation,
    );
    validateBoundary(db, b, after, integration, 'AFTER', checkedAfter);
    return writerEvidence(operation, false, checkedAfter);
  }).result;
}
