import type Database from 'better-sqlite3';
import { storedCampaignLifecycleCommandValue } from '@shared/campaign-lifecycle.js';
import {
  readCampaignLifecycleClientBinding,
  type CampaignLifecycleEvent,
} from './campaign-lifecycle-state.js';
import type { GmRequestReviewScope } from './campaign-creation.js';
import { networkApplicationStorage as s } from './network-local-application.js';

type Row = Record<string, unknown>;
export function hasCampaignLifecycleSchema(db: Database.Database): boolean {
  return db.prepare('SELECT 1 FROM schema_migration WHERE version=14').get() !== undefined;
}
export function campaignLifecycleEventKind(
  event: CampaignLifecycleEvent,
): 'SETTINGS' | 'CAPACITY' | 'PASSWORD' | 'PAUSE' | 'RESUME' | 'DISCONNECT' {
  switch (event.request.workflowCommandId) {
    case 'UI-CMD-CAMPAIGN-SETTINGS-SET':
      return 'SETTINGS';
    case 'UI-CMD-CAMPAIGN-CAPACITY-SET':
      return 'CAPACITY';
    case 'UI-CMD-MASTER-PASSWORD-CHANGE':
      return 'PASSWORD';
    case 'UI-CMD-CAMPAIGN-PAUSE-SET':
      return event.request.decision;
    case 'UI-CMD-CLIENT-DISCONNECT':
      return 'DISCONNECT';
  }
}
/** Structural proof only. The owning history fold separately rebuilds each checkpoint and guard. */
export function readCampaignLifecycleLedger(
  db: Database.Database,
  campaignId: string,
): readonly CampaignLifecycleEvent[] {
  if (!hasCampaignLifecycleSchema(db)) return [];
  const rows = db
    .prepare('SELECT * FROM campaign_lifecycle_event WHERE campaign_id=? ORDER BY event_index')
    .all(campaignId) as Row[];
  const events: CampaignLifecycleEvent[] = [];
  let previous: string | null = null,
    revision = 0;
  const identities = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const record = s.object(s.checked(row), [
      'schemaVersion',
      'eventIndex',
      'previousEventSha256OrNull',
      'scope',
      'request',
      'clientRequestJsonOrNull',
      'beforeCheckpoint',
      'beforeCheckpointSha256',
      'afterCheckpointSha256',
      'passwordTransitionOrNull',
      'receipt',
    ]) as unknown as CampaignLifecycleEvent;
    storedCampaignLifecycleCommandValue(record.request);
    readCampaignLifecycleClientBinding(
      record.clientRequestJsonOrNull,
      record.scope,
      record.request,
    );
    const receipt = s.object(record.receipt, [
      'receiptId',
      'commandId',
      'campaignId',
      'workflowCommandId',
      'campaignRevision',
      'campaignStatus',
      'pauseReasonOrNull',
      'settingsRevision',
      'checkpointId',
      'committedAt',
    ]);
    const scope = s.object(record.scope, ['ownerDeviceId', 'gmLocalContextId', 'campaignId']);
    for (const key of ['ownerDeviceId', 'gmLocalContextId', 'campaignId']) s.uuid(scope[key]);
    for (const key of ['receiptId', 'commandId', 'campaignId', 'checkpointId']) {
      const id = s.uuid(receipt[key]);
      if (key !== 'campaignId') {
        if (identities.has(id)) return s.fail();
        identities.add(id);
      }
    }
    const currentRevision = s.integer(receipt['campaignRevision']);
    if (
      record.schemaVersion !== 1 ||
      record.eventIndex !== index + 1 ||
      row['event_index'] !== index + 1 ||
      record.previousEventSha256OrNull !== previous ||
      record.scope.campaignId !== campaignId ||
      record.request.campaignId !== campaignId ||
      receipt['campaignId'] !== campaignId ||
      receipt['commandId'] !== record.request.commandId ||
      receipt['workflowCommandId'] !== record.request.workflowCommandId ||
      row['command_id'] !== record.request.commandId ||
      row['receipt_id'] !== receipt['receiptId'] ||
      row['checkpoint_id'] !== receipt['checkpointId'] ||
      row['kind'] !== campaignLifecycleEventKind(record) ||
      row['state_revision'] !== currentRevision ||
      currentRevision <= revision
    )
      return s.fail();
    s.hash(record.beforeCheckpointSha256);
    s.hash(record.afterCheckpointSha256);
    s.object(record.beforeCheckpoint, [
      'campaignId',
      'snapshotJson',
      'stateRevision',
      'projectionRevision',
      'actorVisibilityRevision',
    ]);
    if (
      record.beforeCheckpoint.campaignId !== campaignId ||
      record.beforeCheckpoint.stateRevision !== currentRevision - 1 ||
      s.sha(s.canonical(record.beforeCheckpoint)) !== record.beforeCheckpointSha256
    )
      return s.fail();
    s.vector(s.vectorOf(record.beforeCheckpoint));
    s.integer(receipt['settingsRevision']);
    s.text(receipt['committedAt']);
    if (receipt['campaignStatus'] !== 'HOSTING' && receipt['campaignStatus'] !== 'PAUSED')
      return s.fail();
    if (receipt['pauseReasonOrNull'] !== null) s.text(receipt['pauseReasonOrNull']);
    if (record.passwordTransitionOrNull !== null) {
      const proof = s.object(record.passwordTransitionOrNull, ['beforeVerifier', 'afterVerifier']);
      s.object(proof['beforeVerifier']);
      s.object(proof['afterVerifier']);
    }
    if (
      (record.request.workflowCommandId === 'UI-CMD-MASTER-PASSWORD-CHANGE') !==
      (record.passwordTransitionOrNull !== null)
    )
      return s.fail();
    previous = s.hash(row['record_sha256']);
    revision = currentRevision;
    events.push(record);
  }
  const heads = db
    .prepare('SELECT * FROM campaign_lifecycle_head WHERE campaign_id=?')
    .all(campaignId) as Row[];
  if (heads.length !== (events.length === 0 ? 0 : 1)) return s.fail();
  if (
    heads.length === 1 &&
    (heads[0]!['event_index'] !== events.length ||
      heads[0]!['command_id'] !== events.at(-1)!.request.commandId ||
      heads[0]!['record_sha256'] !== previous)
  )
    return s.fail();
  return events;
}

export function verifyCampaignLifecycleMirrors(
  db: Database.Database,
  scope: GmRequestReviewScope,
  events: readonly CampaignLifecycleEvent[],
): void {
  if (!hasCampaignLifecycleSchema(db)) {
    if (events.length !== 0) s.fail();
    return;
  }
  const mirrors = db
    .prepare(
      "SELECT * FROM gm_request_queue_event WHERE campaign_id=? AND kind='LIFECYCLE_SOURCE' ORDER BY event_index",
    )
    .all(scope.campaignId) as Row[];
  if (mirrors.length !== events.length) return s.fail();
  for (const [index, event] of events.entries()) {
    const row = mirrors[index]!,
      document = s.object(s.checked(row)),
      mutation = s.object(document['mutation']);
    if (
      row['context_id'] !== scope.gmLocalContextId ||
      row['owner_device_id'] !== scope.ownerDeviceId ||
      !s.same(document['scope'], scope) ||
      !s.same(event.scope, scope) ||
      mutation['kind'] !== 'LIFECYCLE_SOURCE' ||
      !s.same(mutation['cause'], {
        commandId: event.request.commandId,
        recordSha256: s.sha(s.canonical(event)),
      })
    )
      return s.fail();
  }
}
