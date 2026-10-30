import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  CampaignCreationStoreError,
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
  readonly status: 'PAUSED';
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
): CurrentPausedCampaignHeader {
  const checkpoint = loadCampaignCheckpoint(db, campaignId);
  const snapshot = object(JSON.parse(checkpoint.snapshotJson) as unknown, [
    'campaign',
    'campaignCharacterCopies',
  ]);
  const campaign = object(snapshot['campaign'], ['campaignId', 'lifecycleState', 'payloadJson']);
  if (campaign['campaignId'] !== campaignId || campaign['lifecycleState'] !== 'PAUSED')
    return fail();
  const currentPayload: unknown = JSON.parse(text(campaign['payloadJson']));
  // #171 may observe a changed roster/vector, not unimplemented settings/history semantics.
  if (campaignCreationHash(currentPayload) !== campaignCreationHash(origin.payload)) return fail();
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
  if (activePcCount > source.host.activePlayerCapacity) return fail();
  return {
    campaignId,
    title: source.metadata.title,
    status: 'PAUSED',
    activePlayerCapacity: source.host.activePlayerCapacity,
    activePcCount,
    checkpointSha256: createHash('sha256').update(checkpoint.snapshotJson, 'utf8').digest('hex'),
    baselineVersion: source.baselineVersion,
    bindConfiguration: {
      hostAddress: source.host.hostAddress,
      hostPort: source.host.hostPort,
      networkInterface: source.host.networkInterface,
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
    );
  });
}
