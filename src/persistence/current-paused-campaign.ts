import { readNpcCampaignCheckpointLedgerInTransaction } from './npc-campaign-checkpoints.js';
import { campaignParts } from './npc-library-records.js';
import { campaignSettingsValue } from '@shared/campaign-lifecycle.js';
import { readCampaignLifecycleLedger } from './campaign-lifecycle-ledger.js';
import {
  campaignCheckpointParts,
  initialCampaignLifecycleState,
  replayCampaignLifecycleEvent,
} from './campaign-lifecycle-state.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import {
  hasCampaignLobbySchema,
  readCampaignLobbyLedger,
  readCampaignStartHeaderCheckpoint,
} from './campaign-lobby.js';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  CampaignCreationStoreError,
  readCampaignOwnerBinding,
  validateOriginOwner,
  campaignCreationHash,
  readCampaignCreationOrigin,
  readHostedCampaignCreationOrigin,
  type CampaignCreationOrigin,
  type CampaignPrivateOwnerValidator,
} from './campaign-creation.js';
import { V1_LIFECYCLE_STATES } from './migrations/0001-initial.js';
import { loadCampaignCheckpoint, type RevisionTriple } from './store.js';

export interface OwnedCampaignReadScope {
  readonly gmLocalContextId: string;
  readonly campaignId: string;
}
export interface CurrentPausedCampaignHeader extends RevisionTriple {
  readonly campaignId: string;
  readonly title: string;
  readonly status: 'PAUSED' | 'HOSTING';
  readonly firstStartCompleted: boolean;
  readonly activePlayerCapacity: number;
  readonly activePcCount: number;
  readonly checkpointSha256: string;
  readonly baselineVersion: string;
  readonly bindConfiguration: {
    readonly hostAddress: string;
    readonly hostPort: number;
    readonly networkInterface: string;
  };
}
const fail = (code: CampaignCreationStoreError['code'] = 'CORRUPT_STORAGE'): never => {
  throw new CampaignCreationStoreError(code);
};
function object(
  value: unknown,
  keys: readonly string[],
  code: CampaignCreationStoreError['code'] = 'CORRUPT_STORAGE',
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    keys.some(
      (key) =>
        !Object.hasOwn(descriptors, key) ||
        !Object.hasOwn(descriptors[key]!, 'value') ||
        !descriptors[key]!.enumerable,
    )
  )
    return fail(code);
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  code: CampaignCreationStoreError['code'] = 'CORRUPT_STORAGE',
): string {
  return typeof value === 'string' && value.length > 0 ? value : fail(code);
}
function readTransaction<T>(db: Database.Database, read: () => T): T {
  try {
    // A source read within an owning command shares its snapshot without committing it.
    return db.inTransaction ? read() : db.transaction(read).deferred();
  } catch (error: unknown) {
    if (error instanceof CampaignCreationStoreError) throw error;
    return fail();
  }
}
function header(
  db: Database.Database,
  campaignId: string,
  origin: CampaignCreationOrigin,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): CurrentPausedCampaignHeader {
  const checkpoint = loadCampaignCheckpoint(db, campaignId);
  const snapshot = object(JSON.parse(checkpoint.snapshotJson) as unknown, [
    'campaign',
    'campaignCharacterCopies',
  ]);
  const campaign = object(snapshot['campaign'], ['campaignId', 'lifecycleState', 'payloadJson']);
  const status = campaign['lifecycleState'];
  if (campaign['campaignId'] !== campaignId || (status !== 'PAUSED' && status !== 'HOSTING'))
    return fail();
  const owner = readCampaignOwnerBinding(
    db,
    origin.command.request.payload.gmLocalContextId,
    campaignId,
  );
  const npc = readNpcCampaignCheckpointLedgerInTransaction(db, campaignId);
  if (!s.same(campaignParts(checkpoint).anchor, npc.anchorOrNull)) return fail();
  const npcAware = npc.commits.length !== 0;
  const lifecycleEvents = readCampaignLifecycleLedger(db, campaignId);
  let lifecycle = initialCampaignLifecycleState(origin.payload, owner.verifier);
  let expectedPayload: unknown = origin.payload;
  let expectedStatus: 'PAUSED' | 'HOSTING' = 'PAUSED';
  let previous: typeof checkpoint | null = null;
  let started = false;
  const start = hasCampaignLobbySchema(db)
    ? readCampaignLobbyLedger(db, campaignId).find(
        (e) => e.request.workflowCommandId === 'UI-CMD-CAMPAIGN-START',
      )
    : undefined;
  const changes = [
    ...npc.commits.map((event) => ({
      kind: 'NPC' as const,
      revision: event.operation.afterCheckpoint.stateRevision,
      before: event.operation.beforeCheckpoint,
      event,
    })),
    ...lifecycleEvents.map((event) => ({
      kind: 'LIFECYCLE' as const,
      revision: event.receipt.campaignRevision,
      before: event.beforeCheckpoint,
      event,
    })),
    ...(start === undefined
      ? []
      : [
          {
            kind: 'START' as const,
            revision: start.campaignRevision + 1,
            before: start.beforeCheckpointOrNull ?? fail(),
          },
        ]),
  ].sort((a, b) => a.revision - b.revision);
  // With lifecycle evidence, every intervening revision must have an actual checkpoint event.
  // Mechanics and predecessor hashes are independently rebuilt by the authoritative full fold.
  const admissionRevisions = new Set<number>();
  if (lifecycleEvents.length !== 0 || npcAware) {
    const admissionRows = db
      .prepare(
        'SELECT * FROM campaign_admission_checkpoint_event WHERE campaign_id=? ORDER BY state_revision',
      )
      .all(campaignId) as Record<string, unknown>[];
    const revisions = changes.map((change) => change.revision);
    for (const row of admissionRows) {
      const record = s.object(s.checked(row));
      if (
        record['campaignId'] !== campaignId ||
        record['stateRevision'] !== row['state_revision'] ||
        (start !== undefined && s.integer(row['state_revision']) > start.campaignRevision)
      )
        return fail();
      const revision = s.integer(row['state_revision']);
      admissionRevisions.add(revision);
      revisions.push(revision);
    }
    revisions.sort((a, b) => a - b);
    if (
      revisions.length !== checkpoint.stateRevision ||
      revisions.some((revision, index) => revision !== index + 1)
    )
      return fail();
  }
  let coveredRevision = 0;
  let expectedRevisions: RevisionTriple = {
    stateRevision: 0,
    projectionRevision: 0,
    actorVisibilityRevision: 0,
  };
  const verifyAdmissionGap = (before: typeof checkpoint): void => {
    const gap = before.stateRevision - coveredRevision;
    if (gap < 0) return fail();
    for (let revision = coveredRevision + 1; revision <= before.stateRevision; revision += 1)
      if (!admissionRevisions.has(revision)) return fail();
    if (
      before.projectionRevision !== expectedRevisions.projectionRevision + gap ||
      before.actorVisibilityRevision !== expectedRevisions.actorVisibilityRevision + gap
    )
      return fail();
  };
  for (const change of changes) {
    const before = change.before;
    const parts = campaignCheckpointParts(before);
    if (npcAware) verifyAdmissionGap(before);
    if (
      before.campaignId !== campaignId ||
      before.stateRevision + 1 !== change.revision ||
      (!npcAware &&
        (before.projectionRevision !== before.stateRevision ||
          before.actorVisibilityRevision !== before.stateRevision)) ||
      !s.same(parts.payload, expectedPayload) ||
      parts.campaign['lifecycleState'] !== expectedStatus
    )
      return fail();
    if (
      previous !== null &&
      (before.stateRevision < previous.stateRevision ||
        ((started || before.stateRevision === previous.stateRevision) && !s.same(before, previous)))
    )
      return fail();
    if (change.kind === 'NPC') {
      // The primitive ledger proves this exact anchor-only transition, not the NPC mechanics.
      previous = change.event.operation.afterCheckpoint;
    } else if (change.kind === 'START') {
      if (started) return fail();
      previous = readCampaignStartHeaderCheckpoint(db, campaignId, expectedPayload) ?? fail();
      started = true;
    } else {
      const replay = replayCampaignLifecycleEvent(
        {
          ownerDeviceId: owner.ownerDeviceId,
          gmLocalContextId: owner.gmLocalContextId,
          campaignId,
        },
        before,
        lifecycle,
        change.event,
        {
          validateSettings: (value) => {
            campaignSettingsValue(value);
          },
          validateVerifier: (verifier) =>
            validateOriginOwner(
              db,
              { ...owner, verifier, verifierSha256: campaignCreationHash(verifier) },
              validatePrivateOwner,
            ),
        },
      );
      lifecycle = replay.state;
      previous = replay.checkpoint;
    }
    coveredRevision = previous.stateRevision;
    expectedRevisions = previous;
    const after = campaignCheckpointParts(previous);
    expectedPayload = after.payload;
    expectedStatus = after.campaign['lifecycleState'] as 'PAUSED' | 'HOSTING';
  }
  if (npcAware) verifyAdmissionGap(checkpoint);
  if (
    status !== expectedStatus ||
    !s.same(JSON.parse(text(campaign['payloadJson'])) as unknown, expectedPayload)
  )
    return fail();
  if (
    previous !== null &&
    (checkpoint.stateRevision < previous.stateRevision ||
      ((started || checkpoint.stateRevision === previous.stateRevision) &&
        !s.same(checkpoint, previous)))
  )
    return fail();
  const copies = snapshot['campaignCharacterCopies'];
  if (!Array.isArray(copies)) return fail();
  let activePcCount = 0;
  for (const value of copies) {
    const copy = object(value, [
      'campaignCharacterId',
      'sourceUuid',
      'lifecycleState',
      'payloadJson',
    ]);
    text(copy['campaignCharacterId']);
    text(copy['sourceUuid']);
    const lifecycle = copy['lifecycleState'];
    if (!V1_LIFECYCLE_STATES.campaignCharacterCopy.some((state) => state === lifecycle))
      return fail();
    // Q-CAMP-001 counts active PC, not requests, PROPOSED copies, devices or input lanes.
    // Blocked-lobby admission mapping belongs to #172; no extra SQL lifecycle is inferred.
    if (lifecycle === 'ACTIVE') activePcCount += 1;
  }
  const source = origin.payload;
  if (activePcCount > lifecycle.activePlayerCapacity) return fail();
  return {
    campaignId,
    title: lifecycle.settings.title,
    status,
    firstStartCompleted: started,
    activePlayerCapacity: lifecycle.activePlayerCapacity,
    activePcCount,
    checkpointSha256: createHash('sha256').update(checkpoint.snapshotJson, 'utf8').digest('hex'),
    baselineVersion: source.baselineVersion,
    bindConfiguration: {
      hostAddress: lifecycle.settings.network.hostAddress,
      hostPort: lifecycle.settings.network.hostPort,
      networkInterface: lifecycle.settings.network.networkInterface,
    },
    stateRevision: checkpoint.stateRevision,
    projectionRevision: checkpoint.projectionRevision,
    actorVisibilityRevision: checkpoint.actorVisibilityRevision,
  };
}

/** Exact trusted local scope; never accepts client-selected role, owner or revision claims. */
export function readOwnedCurrentPausedCampaign(
  db: Database.Database,
  scope: OwnedCampaignReadScope,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): CurrentPausedCampaignHeader {
  return readTransaction(db, () => {
    const selected = object(scope, ['gmLocalContextId', 'campaignId'], 'INVALID_INPUT');
    const context = text(selected['gmLocalContextId'], 'INVALID_INPUT');
    const campaignId = text(selected['campaignId'], 'INVALID_INPUT');
    return header(
      db,
      campaignId,
      readCampaignCreationOrigin(db, context, campaignId, validatePrivateOwner),
      validatePrivateOwner,
    );
  });
}

/** The host selects one published campaign ID; its private row determines the verified owner. */
export function readHostedCurrentPausedCampaign(
  db: Database.Database,
  campaignId: string,
  validatePrivateOwner: CampaignPrivateOwnerValidator,
): CurrentPausedCampaignHeader {
  return readTransaction(db, () => {
    text(campaignId, 'INVALID_INPUT');
    return header(
      db,
      campaignId,
      readHostedCampaignCreationOrigin(db, campaignId, validatePrivateOwner),
      validatePrivateOwner,
    );
  });
}
