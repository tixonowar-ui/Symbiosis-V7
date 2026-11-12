import type Database from 'better-sqlite3';
import { npcChildIdentities, verifyNpcChildIndex } from './npc-child-identities.js';
import { createHash } from 'node:crypto';
import type { CampaignCheckpoint } from './store.js';
import type { CampaignLobbyEvent } from './campaign-lobby-state.js';
import { readAppliedMigrationVersion } from './migrations/index.js';
import { migration0015, NPC_TABLES } from './migrations/0015-persistent-npc.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import { readNpcGmPrimitiveCause } from './npc-gm-source.js';
import {
  campaignParts,
  npcArtBlobValue,
  npcAttemptEventEnvelopeValue,
  npcCheckpointAfter,
  npcLibraryBlockValue,
  npcScopeValue,
  npcVersionRefValue,
  positive,
  type NpcAnchor,
  type NpcLibraryBlock,
  type NpcOperation,
  type NpcVersionRef,
} from './npc-library-records.js';

type Row = Record<string, unknown>;
const digest = (value: unknown) => s.sha(s.canonical(value));
const equal = (a: unknown, b: unknown): void => {
  if (!s.same(a, b)) return s.fail();
};
const refOrder = (a: NpcVersionRef, b: NpcVersionRef) =>
  a.npcUuid < b.npcUuid ? -1 : a.npcUuid > b.npcUuid ? 1 : a.version - b.version;
const anchor = (block: NpcLibraryBlock): NpcAnchor => ({
  libraryRevision: block.libraryRevision,
  checkpointId: block.checkpointId,
  checkpointSha256: digest(block),
});
export interface NpcCampaignCheckpointEvent {
  readonly operation: NpcOperation;
  readonly block: NpcLibraryBlock;
}
export interface NpcCampaignCheckpointLedger {
  readonly campaignId: string;
  readonly operations: readonly NpcOperation[];
  readonly commits: readonly NpcCampaignCheckpointEvent[];
  readonly anchorOrNull: NpcAnchor | null;
}
function checked(row: Row): Row {
  const text = s.text(row['record_json']);
  if (s.sha(text) !== s.hash(row['record_sha256'])) return s.fail();
  const value = s.object(JSON.parse(text) as unknown);
  if (s.canonical(value) !== text) return s.fail();
  return value;
}
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
    version !== 22
  )
    return s.fail();
  const row = db
    .prepare('SELECT name,checksum_sha256 FROM schema_migration WHERE version=15')
    .get() as Row | undefined;
  equal(
    [row?.['name'], row?.['checksum_sha256']],
    [migration0015.name, createHash('sha256').update(migration0015.sql).digest('hex')],
  );
  for (const table of NPC_TABLES) db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  return true;
}
/** Structural history only: no sheet/lifetime validation, GM fold, or caller-provided success flag.
 * Full recovery still requires the owning NpcDomainReaders after aggregate ancestry is rebuilt.
 */
export function readNpcCampaignCheckpointLedgerInTransaction(
  db: Database.Database,
  campaignId: string,
): NpcCampaignCheckpointLedger {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  s.text(campaignId);
  if (!schema(db)) return { campaignId, operations: [], commits: [], anchorOrNull: null };
  const rows = (table: (typeof NPC_TABLES)[number]) =>
    db.prepare(`SELECT * FROM ${table} WHERE campaign_id=?`).all(campaignId) as Row[];
  const operations = rows('npc_operation').map((row) => {
    const raw = checked(row),
      scope = npcScopeValue(raw['scope']);
    if (scope.campaignId !== campaignId) return s.fail();
    const primitive = readNpcGmPrimitiveCause(db, scope, {
      operationId: s.text(row['operation_id']),
      recordSha256: s.hash(row['record_sha256']),
    });
    const operation = primitive.operation;
    if (
      (operation.kind === 'COMMIT' || operation.kind === 'COMMIT_V1') &&
      primitive.event.ref.stage !== 'NPC-017'
    )
      return s.fail();
    if (
      operation.beforeCheckpoint.campaignId !== campaignId ||
      operation.afterCheckpoint.campaignId !== campaignId
    )
      return s.fail();
    return operation;
  });
  const operationMap = new Map(operations.map((o) => [o.operationId, o]));
  const attempts = rows('npc_attempt_event');
  const children = npcChildIdentities(
    attempts.map((row) => npcAttemptEventEnvelopeValue(checked(row))),
    operations,
  );
  verifyNpcChildIndex(db, campaignId, children);
  if (attempts.length !== operations.length) return s.fail();
  const attemptHeads = new Map<string, Row>();
  const roots = new Map<string, Row>();
  for (const row of attempts) {
    const operation = operationMap.get(s.text(row['operation_id'])) ?? s.fail();
    if (operation.attemptEventSha256 !== row['record_sha256']) return s.fail();
    const id = s.uuid(row['draft_id']),
      revision = s.integer(row['revision']);
    const previous = attemptHeads.get(id);
    if (previous === undefined || s.integer(previous['revision']) < revision)
      attemptHeads.set(id, row);
    if (revision === 0 && operation.kind === 'CREATE') roots.set(id, row);
  }
  const savedHeads = rows('npc_attempt_head');
  if (savedHeads.length !== attemptHeads.size) return s.fail();
  for (const row of savedHeads) {
    const current = attemptHeads.get(s.uuid(row['draft_id'])) ?? s.fail();
    equal([row['revision'], row['record_sha256']], [current['revision'], current['record_sha256']]);
  }
  const reservations = rows('npc_identity_reservation');
  if (reservations.length !== roots.size) return s.fail();
  for (const row of reservations) {
    const root = roots.get(s.uuid(row['draft_id'])) ?? s.fail();
    const attempt = s.object(checked(root)['attempt']);
    equal(
      [row['candidate_npc_uuid'], row['create_operation_id']],
      [attempt['candidateNpcUuid'], root['operation_id']],
    );
  }
  const versions = rows('npc_version')
    .map((row) => {
      const v = s.object(checked(row), [
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
      // These objects remain opaque here; a well-formed record is not a valid NPC sheet.
      s.object(v['snapshot']);
      s.object(v['lifetimeFacts']);
      const scope = npcScopeValue(v['scope']),
        art = s.object(v['art'], ['assetKey', 'sha256']);
      s.text(art['assetKey']);
      const operation = operationMap.get(s.uuid(v['operationId'])) ?? s.fail();
      const ref = npcVersionRefValue({
        npcUuid: v['npcUuid'],
        version: v['version'],
        sha256: row['record_sha256'],
      });
      const libraryRevision = positive(v['libraryRevision']);
      equal(
        [
          row['campaign_id'],
          row['npc_uuid'],
          row['version'],
          row['library_revision'],
          row['operation_id'],
        ],
        [scope.campaignId, ref.npcUuid, ref.version, libraryRevision, operation.operationId],
      );
      equal(scope, operation.scope);
      equal(ref, operation.versionOrNull);
      return {
        ref,
        libraryRevision,
        operation,
        artSha256: s.hash(art['sha256']),
        previousSha256OrNull:
          v['previousVersionSha256OrNull'] === null
            ? null
            : s.hash(v['previousVersionSha256OrNull']),
      };
    })
    .sort((a, b) => a.libraryRevision - b.libraryRevision);
  const commits = operations.filter((o) => o.kind === 'COMMIT' || o.kind === 'COMMIT_V1');
  if (commits.length !== versions.length) return s.fail();
  const heads = new Map<string, NpcVersionRef>();
  for (const [index, v] of versions.entries()) {
    const previous = heads.get(v.ref.npcUuid);
    if (
      v.libraryRevision !== index + 1 ||
      v.ref.version !== (previous === undefined ? 1 : previous.version + 1)
    )
      return s.fail();
    equal(v.previousSha256OrNull, previous?.sha256 ?? null);
    if ((previous === undefined) !== (v.operation.kind === 'COMMIT_V1')) return s.fail();
    heads.set(v.ref.npcUuid, v.ref);
  }
  const currentHeads = rows('npc_current_head')
    .map((row) =>
      npcVersionRefValue({
        npcUuid: row['npc_uuid'],
        version: row['version'],
        sha256: row['record_sha256'],
      }),
    )
    .sort(refOrder);
  equal(currentHeads, [...heads.values()].sort(refOrder));
  const art = rows('npc_art')
    .map((row) => {
      const value = npcArtBlobValue(checked(row));
      equal(row['asset_sha256'], value.sha256);
      return value.sha256;
    })
    .sort();
  equal(art, [...new Set(versions.map((v) => v.artSha256))].sort());
  const blocks = rows('npc_library_checkpoint')
    .map((row) => {
      const block = npcLibraryBlockValue(checked(row));
      equal(
        [row['campaign_id'], row['library_revision'], row['checkpoint_id']],
        [block.campaignId, block.libraryRevision, block.checkpointId],
      );
      return block;
    })
    .sort((a, b) => a.libraryRevision - b.libraryRevision);
  if (blocks.length !== versions.length) return s.fail();
  const identities = [
    ...operations.map((o) => o.operationId),
    ...operations.map((o) => o.receiptId),
    ...blocks.map((b) => b.checkpointId),
    ...attemptHeads.keys(),
    ...reservations.map((row) => s.uuid(row['candidate_npc_uuid'])),
    ...children.map((child) => child.allocation.id),
  ];
  if (new Set(identities).size !== identities.length) return s.fail();
  const events: NpcCampaignCheckpointEvent[] = [];
  for (const [index, block] of blocks.entries()) {
    const v = versions[index] ?? s.fail(),
      prefix = versions.slice(0, index + 1),
      previous = blocks[index - 1];
    if (block.libraryRevision !== index + 1) return s.fail();
    const prefixHeads = new Map<string, NpcVersionRef>();
    for (const p of prefix) prefixHeads.set(p.ref.npcUuid, p.ref);
    equal(block.versions, prefix.map((p) => p.ref).sort(refOrder));
    equal(block.heads, [...prefixHeads.values()].sort(refOrder));
    equal(block.artSha256s, [...new Set(prefix.map((p) => p.artSha256))].sort());
    equal(v.operation.anchorOrNull, anchor(block));
    equal(
      campaignParts(v.operation.beforeCheckpoint).anchor,
      previous === undefined ? null : anchor(previous),
    );
    if (previous?.initialTimeLockOrNull !== null && previous?.initialTimeLockOrNull !== undefined)
      equal(block.initialTimeLockOrNull, previous.initialTimeLockOrNull);
    else if (block.initialTimeLockOrNull !== null)
      equal(
        [
          block.initialTimeLockOrNull.operationId,
          block.initialTimeLockOrNull.npcUuid,
          block.initialTimeLockOrNull.version,
        ],
        [v.operation.operationId, v.ref.npcUuid, v.ref.version],
      );
    const before = v.operation.beforeCheckpoint,
      after = v.operation.afterCheckpoint;
    const projection = after.projectionRevision - before.projectionRevision,
      visibility = after.actorVisibilityRevision - before.actorVisibilityRevision;
    if (![0, 1].includes(projection) || ![0, 1].includes(visibility)) return s.fail();
    equal(after, npcCheckpointAfter(before, anchor(block), projection === 1, visibility === 1));
    if (
      index > 0 &&
      before.stateRevision < events[index - 1]!.operation.afterCheckpoint.stateRevision
    )
      return s.fail();
    events.push({ operation: v.operation, block });
  }
  return {
    campaignId,
    operations,
    commits: events,
    anchorOrNull: blocks.length === 0 ? null : anchor(blocks.at(-1)!),
  };
}
/** The caller supplies its reconstructed checkpoints, never raw current-state SQL as ancestry. */
export function verifyNpcCampaignCheckpointHistory(
  ledger: NpcCampaignCheckpointLedger,
  checkpoints: ReadonlyMap<number, CampaignCheckpoint>,
  current: CampaignCheckpoint,
): void {
  if (ledger.campaignId !== current.campaignId) return s.fail();
  equal(campaignParts(current).anchor, ledger.anchorOrNull);
  for (const operation of ledger.operations) {
    equal(checkpoints.get(operation.beforeCheckpoint.stateRevision), operation.beforeCheckpoint);
    equal(checkpoints.get(operation.afterCheckpoint.stateRevision), operation.afterCheckpoint);
  }
}

/** ADR 0078: the first calendar save binds the already confirmed minute permanently.
 * Both ledgers have been structurally checked; this cross-check does not replace full NPC mechanics.
 */
export function verifyNpcInitialTimeHistory(
  ledger: NpcCampaignCheckpointLedger,
  events: readonly CampaignLobbyEvent[],
): void {
  const first = ledger.commits.find((entry) => entry.block.initialTimeLockOrNull !== null);
  if (first === undefined) return;
  const lock = first.block.initialTimeLockOrNull ?? s.fail();
  let confirmedMinute: number | null = null;
  for (const event of events) {
    if (event.campaignRevision > first.operation.beforeCheckpoint.stateRevision) break;
    if (event.receipt.workflowCommandId === 'UI-CMD-CAMPAIGN-START') return s.fail();
    if (event.receipt.workflowCommandId === 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET')
      confirmedMinute = event.receipt.initialCampaignTime.campaignTimestamp;
  }
  equal(confirmedMinute, lock.campaignTimestamp);
  for (const event of events) {
    if (event.campaignRevision < first.operation.afterCheckpoint.stateRevision) continue;
    if (event.receipt.workflowCommandId === 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET')
      equal(event.receipt.initialCampaignTime.campaignTimestamp, lock.campaignTimestamp);
    if (event.receipt.workflowCommandId === 'UI-CMD-CAMPAIGN-START')
      equal(event.receipt.scene.campaignTimestamp, lock.campaignTimestamp);
  }
}
