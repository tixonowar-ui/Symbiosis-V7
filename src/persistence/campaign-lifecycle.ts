import {
  campaignConnectionStatusValue,
  campaignReconnectReceiptValue,
  type CampaignConnectionStatus,
  type CampaignReconnectReceipt,
} from '@shared/campaign-lifecycle.js';
import type { HostedNetworkPrincipal } from './network-device-request.js';
import type Database from 'better-sqlite3';
import {
  campaignLifecycleCommandForm,
  storedCampaignLifecycleCommandValue,
  type StoredCampaignLifecycleCommand,
} from '@shared/campaign-lifecycle.js';
import {
  appendGmLifecycleSourceInTransaction,
  type CampaignPrivateOwnerValidator,
  type GmRequestReviewScope,
} from './campaign-creation.js';
import {
  admissionDecisionStorage,
  type AdmissionPublicationRules,
} from './campaign-admission-decision.js';
import {
  networkApplicationStorage as s,
  type NetworkStoreGuard,
} from './network-local-application.js';
import { advanceRevisions, commitCampaignCheckpoint } from './store.js';
import {
  campaignCheckpointParts,
  planCampaignLifecycleEvent,
  readCampaignLifecycleClientBinding,
  type CampaignLifecycleEvent,
} from './campaign-lifecycle-state.js';
import {
  campaignLifecycleEventKind,
  hasCampaignLifecycleSchema,
  readCampaignLifecycleLedger,
} from './campaign-lifecycle-ledger.js';

export interface CampaignLifecycleGuardSource {
  readonly campaignId: string;
  readonly campaignRevision: number;
  readonly settingsRevision: number;
  readonly workflowCommandId: StoredCampaignLifecycleCommand['workflowCommandId'];
  readonly deviceIdOrNull: string | null;
}
/** One owning transaction, including its queue mirror and checkpoint. Birth and saved copies are immutable. */
export function commitCampaignLifecycleCommand(
  db: Database.Database,
  scope: GmRequestReviewScope,
  requestValue: StoredCampaignLifecycleCommand,
  allocations: {
    readonly receiptId: string;
    readonly checkpointId: string;
    readonly committedAt: string;
  },
  passwordTransitionOrNull: CampaignLifecycleEvent['passwordTransitionOrNull'],
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
  guard: NetworkStoreGuard<CampaignLifecycleGuardSource>,
  clientRequestJsonOrNull: string | null = null,
) {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const request = s.input(() =>
    storedCampaignLifecycleCommandValue(JSON.parse(s.canonical(requestValue)) as unknown),
  );
  const client = s.input(() =>
    readCampaignLifecycleClientBinding(clientRequestJsonOrNull, scope, request),
  );
  const guardSource = (
    campaignRevision: number,
    settingsRevision: number,
  ): CampaignLifecycleGuardSource => ({
    campaignId: scope.campaignId,
    campaignRevision,
    settingsRevision,
    workflowCommandId: request.workflowCommandId,
    deviceIdOrNull:
      request.workflowCommandId === 'UI-CMD-CLIENT-DISCONNECT' ? request.deviceId : null,
  });
  const known = s.read(db, scope.ownerDeviceId, () => {
    if (!hasCampaignLifecycleSchema(db)) return s.fail('UNAVAILABLE');
    if (s.at(db, 'campaign_lifecycle_event', 'command_id', request.commandId) === undefined)
      return null;
    const history = admissionDecisionStorage.readHistory(db, scope, validate, rules);
    const event =
      readCampaignLifecycleLedger(db, scope.campaignId).find(
        (e) => e.request.commandId === request.commandId,
      ) ?? s.fail('FOREIGN_OWNER');
    if (!s.same(event.scope, scope)) return s.fail('FOREIGN_OWNER');
    if (
      !s.same(event.request, request) ||
      !s.same(event.passwordTransitionOrNull, passwordTransitionOrNull) ||
      event.clientRequestJsonOrNull !== clientRequestJsonOrNull
    )
      return s.fail('IDEMPOTENCY_CONFLICT');
    s.guarded(
      db,
      guard,
      guardSource(
        history.checkpoint.stateRevision,
        history.lifecycleOrNull?.settingsRevision ?? s.fail(),
      ),
      'REPLAY',
    );
    return { receipt: event.receipt, replayed: true };
  });
  if (known !== null) return known;
  return s.safe(
    () =>
      commitCampaignCheckpoint(db, scope.campaignId, () => {
        s.schema(db);
        s.owner(db, scope.ownerDeviceId);
        if (!hasCampaignLifecycleSchema(db) || request.campaignId !== scope.campaignId)
          return s.fail('FOREIGN_OWNER');
        const { source, historyOrNull } = admissionDecisionStorage.readSourceAndHistory(
          db,
          scope,
          validate,
          () => rules,
        );
        const history = historyOrNull ?? s.fail();
        const state = history.lifecycleOrNull ?? s.fail();
        const cursor = source.cursor;
        if (client !== null && !s.same(client.request.expectedRevisions, cursor.revisions))
          return s.fail('STALE_REVISION');
        if (
          cursor.kind !== 'QUEUE' ||
          cursor.targetId !== scope.campaignId ||
          cursor.formId !== campaignLifecycleCommandForm(request.workflowCommandId)
        )
          return s.fail('UNAVAILABLE');
        if (request.workflowCommandId === 'UI-CMD-CLIENT-DISCONNECT') {
          if (
            !source.queue.requests.some(
              (q) => q.submittedRequest.principal.peerIdentity.ownerDeviceId === request.deviceId,
            )
          )
            return s.fail('NOT_FOUND');
          if (
            request.selectedControllerSeatOrNull !== null &&
            ![...history.controllers.values()].some(
              (binding) =>
                binding.deviceId === request.deviceId &&
                binding.localControllerSeatId === request.selectedControllerSeatOrNull,
            )
          )
            return s.fail('NOT_FOUND');
        }
        const proof = guardSource(history.checkpoint.stateRevision, state.settingsRevision);
        s.guarded(db, guard, proof, 'APPLY');
        let plannedOrNull: ReturnType<typeof planCampaignLifecycleEvent> | null = null;
        s.guarded(
          db,
          () => {
            plannedOrNull = planCampaignLifecycleEvent(
              scope,
              history.checkpoint,
              state,
              request,
              allocations,
              passwordTransitionOrNull,
              rules.lifecycle ?? s.fail(),
              clientRequestJsonOrNull,
            );
          },
          {
            scope,
            checkpoint: history.checkpoint,
            state,
            request,
            allocations,
            passwordTransitionOrNull,
          },
          'APPLY',
        );
        const planned = plannedOrNull as ReturnType<typeof planCampaignLifecycleEvent> | null;
        if (planned === null) return s.fail();
        const ids = [request.commandId, allocations.receiptId, allocations.checkpointId];
        if (new Set(ids).size !== ids.length) return s.fail('IDEMPOTENCY_CONFLICT');
        for (const id of ids) s.assertUnused(db, id);
        const changes = s.changes(db);
        const json = s.canonical(planned.event),
          hash = s.sha(json);
        db.prepare('INSERT INTO campaign_lifecycle_event VALUES (?,?,?,?,?,?,?,?,?)').run(
          scope.campaignId,
          planned.event.eventIndex,
          planned.event.receipt.campaignRevision,
          request.commandId,
          allocations.receiptId,
          allocations.checkpointId,
          campaignLifecycleEventKind(planned.event),
          json,
          hash,
        );
        if (state.eventRevision === 0)
          db.prepare('INSERT INTO campaign_lifecycle_head VALUES (?,?,?,?)').run(
            scope.campaignId,
            planned.event.eventIndex,
            request.commandId,
            hash,
          );
        else {
          const updated = db
            .prepare(
              'UPDATE campaign_lifecycle_head SET event_index=?,command_id=?,record_sha256=? WHERE campaign_id=? AND event_index=? AND record_sha256=?',
            )
            .run(
              planned.event.eventIndex,
              request.commandId,
              hash,
              scope.campaignId,
              state.eventRevision,
              state.lastEventSha256OrNull,
            );
          if (updated.changes !== 1) return s.fail('SOURCE_CHANGED');
        }
        const before = campaignCheckpointParts(history.checkpoint),
          after = campaignCheckpointParts(planned.checkpoint);
        const updated = db
          .prepare(
            'UPDATE campaign SET lifecycle_state=?,payload_json=? WHERE campaign_id=? AND lifecycle_state=? AND payload_json=?',
          )
          .run(
            after.campaign['lifecycleState'],
            after.campaign['payloadJson'],
            scope.campaignId,
            before.campaign['lifecycleState'],
            before.campaign['payloadJson'],
          );
        if (updated.changes !== 1) return s.fail('SOURCE_CHANGED');
        advanceRevisions(
          db,
          { entity: 'campaign', entityId: scope.campaignId },
          { stateChanged: true, projectionChanged: true, actorVisibilityChanged: true },
        );
        if (!db.inTransaction || s.changes(db) !== changes + 4) return s.fail('SOURCE_CHANGED');
        appendGmLifecycleSourceInTransaction(db, scope, {
          commandId: request.commandId,
          recordSha256: hash,
        });
        if (!s.same(readCampaignLifecycleLedger(db, scope.campaignId).at(-1), planned.event))
          return s.fail('SOURCE_CHANGED');
        s.guarded(db, guard, proof, 'APPLY');
        return { receipt: planned.event.receipt, replayed: false };
      }).result,
  );
}

interface Source {
  readonly status: CampaignConnectionStatus;
  readonly retries: readonly CampaignReconnectReceipt[];
}
function source(
  db: Database.Database,
  scope: GmRequestReviewScope,
  principal: HostedNetworkPrincipal,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
): Source {
  if (
    principal.hostOwnerDeviceId !== scope.ownerDeviceId ||
    principal.campaignId !== scope.campaignId
  )
    return s.fail('FOREIGN_OWNER');
  const { source: current, historyOrNull: history } = admissionDecisionStorage.readSourceAndHistory(
    db,
    scope,
    validate,
    () => rules,
  );
  if (!current.queue.requests.some((q) => s.same(q.submittedRequest.principal, principal)))
    return s.fail('FOREIGN_OWNER');
  if (
    history === null ||
    history.lifecycleOrNull === undefined ||
    current.currentCampaign.stateRevision !== history.checkpoint.stateRevision
  )
    return s.fail();
  const events = readCampaignLifecycleLedger(db, scope.campaignId);
  const rows = db
    .prepare('SELECT * FROM campaign_disconnect_retry WHERE campaign_id=?')
    .all(scope.campaignId) as Record<string, unknown>[];
  const retries = rows.map((row) => {
    const receipt = campaignReconnectReceiptValue(s.checked(row));
    const event = events.find((e) => e.request.commandId === receipt.disconnectCommandId);
    if (
      row['campaign_id'] !== receipt.campaignId ||
      row['device_id'] !== receipt.deviceId ||
      row['command_id'] !== receipt.commandId ||
      row['disconnect_command_id'] !== receipt.disconnectCommandId ||
      receipt.campaignId !== scope.campaignId ||
      event?.request.workflowCommandId !== 'UI-CMD-CLIENT-DISCONNECT' ||
      event.request.deviceId !== receipt.deviceId
    )
      return s.fail();
    return receipt;
  });
  const event = events.findLast(
    (e) =>
      e.request.workflowCommandId === 'UI-CMD-CLIENT-DISCONNECT' &&
      e.request.deviceId === principal.peerIdentity.ownerDeviceId,
  );
  const disconnect =
    event?.request.workflowCommandId === 'UI-CMD-CLIENT-DISCONNECT'
      ? {
          disconnectCommandId: event.request.commandId,
          reason: event.request.reason,
          campaignRevision: event.receipt.campaignRevision,
          retryReceiptOrNull:
            retries.find((r) => r.disconnectCommandId === event.request.commandId) ?? null,
        }
      : null;
  return {
    status: campaignConnectionStatusValue({
      campaignId: scope.campaignId,
      deviceId: principal.peerIdentity.ownerDeviceId,
      campaignRevision: history.checkpoint.stateRevision,
      campaignStatus: current.currentCampaign.status,
      pauseReasonOrNull: history.lifecycleOrNull.pauseReasonOrNull,
      firstStartCompleted: current.currentCampaign.firstStartCompleted,
      disconnectOrNull: disconnect,
    }),
    retries,
  };
}
export function readCampaignConnectionStatus(
  db: Database.Database,
  scope: GmRequestReviewScope,
  principal: HostedNetworkPrincipal,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
): CampaignConnectionStatus {
  return s.read(
    db,
    scope.ownerDeviceId,
    () => source(db, scope, principal, validate, rules).status,
  );
}
/** Only an explicit authenticated retry releases the latest durable disconnect gate. */
export function commitCampaignReconnect(
  db: Database.Database,
  scope: GmRequestReviewScope,
  principal: HostedNetworkPrincipal,
  input: { readonly commandId: string; readonly disconnectCommandId: string },
  confirmedAt: string,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
  guard: NetworkStoreGuard<CampaignConnectionStatus>,
) {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const request = s.input(() => {
    const row = s.object(JSON.parse(s.canonical(input)) as unknown, [
      'commandId',
      'disconnectCommandId',
    ]);
    return {
      commandId: s.uuid(row['commandId']),
      disconnectCommandId: s.uuid(row['disconnectCommandId']),
    };
  });
  return s.safe(() =>
    db
      .transaction(() => {
        const current = source(db, scope, principal, validate, rules);
        const existing = s.at(db, 'campaign_disconnect_retry', 'command_id', request.commandId);
        if (existing !== undefined) {
          const receipt = campaignReconnectReceiptValue(s.checked(existing));
          if (
            receipt.campaignId !== scope.campaignId ||
            receipt.deviceId !== principal.peerIdentity.ownerDeviceId ||
            receipt.disconnectCommandId !== request.disconnectCommandId ||
            !current.retries.some((r) => s.same(r, receipt))
          )
            return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, current.status, 'REPLAY');
          return { receipt, status: current.status, replayed: true };
        }
        const d = current.status.disconnectOrNull;
        if (d === null || d.disconnectCommandId !== request.disconnectCommandId)
          return s.fail('STALE_REVISION');
        if (d.retryReceiptOrNull !== null) return s.fail('IDEMPOTENCY_CONFLICT');
        s.assertUnused(db, request.commandId);
        s.guarded(db, guard, current.status, 'APPLY');
        const receipt = campaignReconnectReceiptValue({
          ...request,
          campaignId: scope.campaignId,
          deviceId: principal.peerIdentity.ownerDeviceId,
          confirmedAt,
        });
        const json = s.canonical(receipt),
          before = s.changes(db);
        db.prepare('INSERT INTO campaign_disconnect_retry VALUES (?,?,?,?,?,?)').run(
          receipt.commandId,
          receipt.campaignId,
          receipt.deviceId,
          receipt.disconnectCommandId,
          json,
          s.sha(json),
        );
        if (s.changes(db) !== before + 1) return s.fail('SOURCE_CHANGED');
        const after = source(db, scope, principal, validate, rules).status;
        if (
          !s.same(after, {
            ...current.status,
            disconnectOrNull: { ...d, retryReceiptOrNull: receipt },
          })
        )
          return s.fail('SOURCE_CHANGED');
        s.guarded(db, guard, after, 'APPLY');
        return { receipt, status: after, replayed: false };
      })
      .immediate(),
  );
}
