import type Database from 'better-sqlite3';
import {
  campaignLobbyCommandValue,
  type CampaignLobbyCommand,
  campaignPeaceSceneValue,
} from '@shared/campaign-lobby.js';
import {
  admissionDecisionStorage,
  type AdmissionPublicationRules,
} from './campaign-admission-decision.js';
import {
  appendGmLobbySourceInTransaction,
  readCampaignCreationCursor,
  type CampaignPrivateOwnerValidator,
  type GmRequestReviewScope,
} from './campaign-creation.js';
import {
  campaignStartCheckpoint,
  planCampaignLobbyEvent,
  type CampaignLobbyState,
  type LobbyAllocations,
  type LobbyAuthority,
  replayCampaignLobby,
  type CampaignLobbyEvent,
} from './campaign-lobby-state.js';
import {
  networkApplicationStorage as s,
  type NetworkStoreGuard,
} from './network-local-application.js';
import { advanceRevisions, commitCampaignCheckpoint, type CampaignCheckpoint } from './store.js';
import { type AdmissionHistory } from './campaign-admission-player.js';

export interface CampaignLobbyGuardSource {
  readonly campaignId: string;
  readonly campaignRevision: number;
  readonly lobbySnapshotRevision: string;
  readonly readinessRevision: number;
  readonly sceneIdOrNull: string | null;
}
function guardSource(state: CampaignLobbyState): CampaignLobbyGuardSource {
  return {
    campaignId: state.checkpoint.campaignId,
    campaignRevision: state.checkpoint.stateRevision,
    lobbySnapshotRevision: state.lobbySnapshotRevision,
    readinessRevision: state.readinessRevision,
    sceneIdOrNull: state.sceneOrNull?.sceneId ?? null,
  };
}
export function readCampaignLobby(
  db: Database.Database,
  scope: GmRequestReviewScope,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
): CampaignLobbyState {
  return s.read(db, scope.ownerDeviceId, () => {
    if (!hasCampaignLobbySchema(db)) return s.fail('UNAVAILABLE');
    return admissionDecisionStorage.readHistory(db, scope, validate, rules).lobbyOrNull ?? s.fail();
  });
}

/** Exact replay is read-only; a fresh Start seals scene, receipt and checkpoint in one transaction. */
export function commitCampaignLobbyCommand(
  db: Database.Database,
  scope: GmRequestReviewScope,
  authorityValue: LobbyAuthority,
  requestValue: CampaignLobbyCommand,
  allocations: LobbyAllocations,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
  guard: NetworkStoreGuard<CampaignLobbyGuardSource>,
  clientRequestJsonOrNull: string | null = null,
) {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const request = s.input(() =>
    campaignLobbyCommandValue(JSON.parse(s.canonical(requestValue)) as unknown),
  );
  const authority = s.input(() => JSON.parse(s.canonical(authorityValue)) as LobbyAuthority);
  const known = s.read(db, scope.ownerDeviceId, () => {
    if (!hasCampaignLobbySchema(db)) return s.fail('UNAVAILABLE');
    if (s.at(db, 'campaign_lobby_event', 'command_id', request.commandId) === undefined)
      return null;
    const state = readCampaignLobby(db, scope, validate, rules);
    const event = state.events.find((event) => event.request.commandId === request.commandId);
    if (event === undefined) return null;
    if (!s.same(event.authority, authority)) return s.fail('FOREIGN_OWNER');
    if (
      !s.same(event.request, request) ||
      event.clientRequestJsonOrNull !== clientRequestJsonOrNull
    )
      return s.fail('IDEMPOTENCY_CONFLICT');
    s.guarded(db, guard, guardSource(state), 'REPLAY');
    return { receipt: event.receipt, replayed: true };
  });
  if (known !== null) return known;
  return s.safe(() => {
    const write = () => {
      s.schema(db);
      s.owner(db, scope.ownerDeviceId);
      const history = admissionDecisionStorage.readHistory(db, scope, validate, rules);
      const before = history.lobbyOrNull ?? s.fail('UNAVAILABLE');
      if (authority.kind === 'GM') {
        const cursor = readCampaignCreationCursor(db, scope.gmLocalContextId);
        if (
          cursor.kind !== 'QUEUE' ||
          cursor.targetId !== scope.campaignId ||
          cursor.formId !== 'NET-016'
        )
          return s.fail('UNAVAILABLE');
      }
      s.guarded(db, guard, guardSource(before), 'APPLY');
      const event = planCampaignLobbyEvent(
        scope,
        history,
        before,
        authority,
        request,
        allocations,
        clientRequestJsonOrNull,
      );
      const start =
        event.receipt.workflowCommandId === 'UI-CMD-CAMPAIGN-START' ? event.receipt.scene : null;
      const ids = [
        request.commandId,
        event.receipt.receiptId,
        ...(start === null ? [] : [start.sceneId, start.checkpointId]),
      ];
      if (new Set(ids).size !== ids.length) return s.fail('IDEMPOTENCY_CONFLICT');
      for (const id of ids) s.assertUnused(db, id);
      const changes = s.changes(db),
        json = s.canonical(event),
        hash = s.sha(json);
      db.prepare('INSERT INTO campaign_lobby_event VALUES (?,?,?,?,?,?,?)').run(
        scope.campaignId,
        event.eventIndex,
        request.commandId,
        event.receipt.receiptId,
        campaignLobbyEventKind(event),
        json,
        hash,
      );
      if (before.eventRevision === 0) {
        db.prepare('INSERT INTO campaign_lobby_head VALUES (?,?,?,?)').run(
          scope.campaignId,
          event.eventIndex,
          request.commandId,
          hash,
        );
      } else {
        const changed = db
          .prepare(
            'UPDATE campaign_lobby_head SET event_index=?,command_id=?,record_sha256=? WHERE campaign_id=? AND event_index=? AND record_sha256=?',
          )
          .run(
            event.eventIndex,
            request.commandId,
            hash,
            scope.campaignId,
            before.eventRevision,
            event.previousSha256OrNull,
          );
        if (changed.changes !== 1) return s.fail('SOURCE_CHANGED');
      }
      let count = 2;
      if (start !== null) {
        const next = campaignStartCheckpoint(before.checkpoint, start);
        const root = s.object(JSON.parse(next.snapshotJson) as unknown);
        const campaign = s.object(root['campaign']);
        const previous = s.object(
          s.object(JSON.parse(before.checkpoint.snapshotJson) as unknown)['campaign'],
        );
        const updated = db
          .prepare(
            "UPDATE campaign SET lifecycle_state='HOSTING',payload_json=? WHERE campaign_id=? AND lifecycle_state='PAUSED' AND payload_json=?",
          )
          .run(campaign['payloadJson'], scope.campaignId, previous['payloadJson']);
        if (updated.changes !== 1) return s.fail('SOURCE_CHANGED');
        advanceRevisions(
          db,
          { entity: 'campaign', entityId: scope.campaignId },
          {
            stateChanged: true,
            projectionChanged: true,
            actorVisibilityChanged: true,
          },
        );
        const sceneJson = s.canonical(start);
        db.prepare('INSERT INTO campaign_peace_scene VALUES (?,?,?,?,?,?)').run(
          scope.campaignId,
          start.sceneId,
          start.checkpointId,
          request.commandId,
          sceneJson,
          s.sha(sceneJson),
        );
        count += 3;
      }
      if (!db.inTransaction || s.changes(db) !== changes + count) return s.fail('SOURCE_CHANGED');
      appendGmLobbySourceInTransaction(db, scope, {
        commandId: request.commandId,
        recordSha256: hash,
      });
      if (!s.same(readCampaignLobbyLedger(db, scope.campaignId).at(-1), event))
        return s.fail('SOURCE_CHANGED');
      s.guarded(db, guard, guardSource(before), 'APPLY');
      return { receipt: event.receipt, replayed: false };
    };
    return request.workflowCommandId === 'UI-CMD-CAMPAIGN-START'
      ? commitCampaignCheckpoint(db, scope.campaignId, write).result
      : db.transaction(write).immediate();
  });
}

type Row = Record<string, unknown>;
export function hasCampaignLobbySchema(db: Database.Database): boolean {
  return db.prepare('SELECT 1 FROM schema_migration WHERE version=13').get() !== undefined;
}
export function campaignLobbyEventKind(event: CampaignLobbyEvent): 'READY' | 'TIME' | 'START' {
  switch (event.request.workflowCommandId) {
    case 'UI-CMD-CAMPAIGN-READY-SET':
      return 'READY';
    case 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET':
      return 'TIME';
    case 'UI-CMD-CAMPAIGN-START':
      return 'START';
  }
}

/** A contiguous journal, one exact head and an independently anchored singleton scene. */
export function readCampaignLobbyLedger(
  db: Database.Database,
  campaignId: string,
): readonly CampaignLobbyEvent[] {
  if (!hasCampaignLobbySchema(db)) return s.fail('UNAVAILABLE');
  const rows = db
    .prepare('SELECT * FROM campaign_lobby_event WHERE campaign_id=? ORDER BY event_index')
    .all(campaignId) as Row[];
  const events: CampaignLobbyEvent[] = [];
  let previousSha256: string | null = null;
  for (const [index, row] of rows.entries()) {
    const record = s.object(s.checked(row), [
      'schemaVersion',
      'eventIndex',
      'previousSha256OrNull',
      'campaignRevision',
      'authority',
      'request',
      'clientRequestJsonOrNull',
      'receipt',
      'beforeCheckpointOrNull',
    ]) as unknown as CampaignLobbyEvent;
    campaignLobbyCommandValue(record.request);
    if (
      record.schemaVersion !== 1 ||
      record.eventIndex !== index + 1 ||
      row['event_index'] !== index + 1 ||
      record.previousSha256OrNull !== previousSha256 ||
      record.request.campaignId !== campaignId ||
      row['command_id'] !== record.request.commandId ||
      row['receipt_id'] !== record.receipt.receiptId ||
      record.receipt.commandId !== record.request.commandId ||
      record.receipt.campaignId !== campaignId ||
      record.receipt.workflowCommandId !== record.request.workflowCommandId ||
      row['kind'] !== campaignLobbyEventKind(record)
    )
      return s.fail();
    previousSha256 = s.hash(row['record_sha256']);
    events.push(record);
  }
  const heads = db
    .prepare('SELECT * FROM campaign_lobby_head WHERE campaign_id=?')
    .all(campaignId) as Row[];
  if (heads.length !== (events.length === 0 ? 0 : 1)) return s.fail();
  if (
    heads.length === 1 &&
    (heads[0]!['event_index'] !== events.length ||
      heads[0]!['command_id'] !== events.at(-1)!.request.commandId ||
      heads[0]!['record_sha256'] !== previousSha256)
  )
    return s.fail();
  const starts = events.filter(
    (event) => event.request.workflowCommandId === 'UI-CMD-CAMPAIGN-START',
  );
  const scenes = db
    .prepare('SELECT * FROM campaign_peace_scene WHERE campaign_id=?')
    .all(campaignId) as Row[];
  if (
    starts.length > 1 ||
    scenes.length !== starts.length ||
    (starts.length === 1 && starts[0] !== events.at(-1))
  )
    return s.fail();
  if (starts.length === 1) {
    const start = starts[0]!,
      row = scenes[0]!;
    if (start.receipt.workflowCommandId !== 'UI-CMD-CAMPAIGN-START') return s.fail();
    const scene = campaignPeaceSceneValue(start.receipt.scene);
    if (
      row['scene_id'] !== scene.sceneId ||
      row['checkpoint_id'] !== scene.checkpointId ||
      row['start_command_id'] !== start.request.commandId ||
      !s.same(s.checked(row), scene)
    )
      return s.fail();
  }
  return events;
}

/** Called by the admission verifier before its final exact comparison with the current SQL checkpoint. */
export function readCampaignLobbyContinuation(
  db: Database.Database,
  scope: GmRequestReviewScope,
  history: AdmissionHistory,
  admissionCheckpoints: ReadonlyMap<number, CampaignCheckpoint>,
) {
  if (history.checkpoint.campaignId !== scope.campaignId) return s.fail('FOREIGN_OWNER');
  const events = readCampaignLobbyLedger(db, scope.campaignId);
  const mirrors = db
    .prepare(
      "SELECT * FROM gm_request_queue_event WHERE campaign_id=? AND kind='LOBBY_SOURCE' ORDER BY event_index",
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
      mutation['kind'] !== 'LOBBY_SOURCE' ||
      !s.same(mutation['cause'], {
        commandId: event.request.commandId,
        recordSha256: s.sha(s.canonical(event)),
      })
    )
      return s.fail();
  }
  return replayCampaignLobby(scope, history, admissionCheckpoints, events);
}

/**
 * The public transport header already verifies only birth/checkpoint structure, not admission mechanics.
 * This extends that same narrow proof; authoritative projections and writes still use the complete fold.
 */
export function readCampaignStartHeaderCheckpoint(
  db: Database.Database,
  campaignId: string,
  originalPayload: unknown,
): CampaignCheckpoint | null {
  const events = readCampaignLobbyLedger(db, campaignId);
  const start = events.find((event) => event.receipt.workflowCommandId === 'UI-CMD-CAMPAIGN-START');
  if (start === undefined) return null;
  if (start.receipt.workflowCommandId !== 'UI-CMD-CAMPAIGN-START') return s.fail();
  const before = s.object(start.beforeCheckpointOrNull, [
    'campaignId',
    'snapshotJson',
    'stateRevision',
    'projectionRevision',
    'actorVisibilityRevision',
  ]) as unknown as CampaignCheckpoint;
  if (before.campaignId !== campaignId || before.stateRevision !== start.campaignRevision)
    return s.fail();
  for (const key of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const)
    s.integer(before[key]);
  const snapshot = s.object(JSON.parse(s.text(before.snapshotJson)) as unknown, [
    'campaign',
    'campaignCharacterCopies',
  ]);
  const campaign = s.object(snapshot['campaign'], ['campaignId', 'lifecycleState', 'payloadJson']);
  if (!s.same(JSON.parse(s.text(campaign['payloadJson'])) as unknown, originalPayload))
    return s.fail();
  const result = campaignStartCheckpoint(before, campaignPeaceSceneValue(start.receipt.scene));
  if (
    start.receipt.campaignRevision !== result.stateRevision ||
    start.receipt.checkpointSha256 !== s.sha(result.snapshotJson)
  )
    return s.fail();
  return result;
}
