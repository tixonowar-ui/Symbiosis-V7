import type Database from 'better-sqlite3';
import {
  admissionPlayerDecisionRequestValue,
  type AdmissionCapacityProof,
  type AdmissionControllerBinding,
  type AdmissionPlayerDecisionRequest,
  type AdmissionPlayerDecisionReceipt,
} from '@shared/campaign-admission-proposal.js';
import type { CampaignPrivateOwnerValidator, GmRequestReviewScope } from './campaign-creation.js';
import { appendGmAdmissionSourceInTransaction } from './campaign-creation.js';
import {
  admissionDecisionStorage as publication,
  readAdmissionDecision,
  type AdmissionDecisionRead,
  type AdmissionPublicationRules,
} from './campaign-admission-decision.js';
import { admissionReviewStorage as working } from './campaign-admission-review.js';
import {
  networkApplicationStorage as s,
  type NetworkStoreGuard,
} from './network-local-application.js';
import { advanceRevisions, commitCampaignCheckpoint, type CampaignCheckpoint } from './store.js';

export interface AdmissionGroup {
  readonly schemaVersion: 1;
  readonly groupId: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly origin: 'START' | 'NEW';
  readonly groupDraftIdOrNull: string | null;
  readonly nameOrNull: string | null;
}
export interface StoredAdmissionPlayerDecision {
  readonly scope: GmRequestReviewScope;
  readonly request: AdmissionPlayerDecisionRequest;
  readonly receipt: AdmissionPlayerDecisionReceipt;
  readonly createdGroups: readonly AdmissionGroup[];
}
/** Reconstructed in event order inside one SQLite snapshot, never cached across commands. */
export interface AdmissionHistory {
  checkpoint: CampaignCheckpoint;
  readonly decisions: Map<string, AdmissionDecisionRead>;
  readonly groups: Map<string, AdmissionGroup>;
  readonly controllers: Map<string, AdmissionControllerBinding>;
  occupiedCampaignPlaceCount: number;
  activePcCount: number;
}
type Row = Record<string, unknown>;

function plan(
  current: AdmissionDecisionRead,
  history: AdmissionHistory,
  request: AdmissionPlayerDecisionRequest,
  receiptId: string,
  timestamp: string,
  allocateId: () => string,
): StoredAdmissionPlayerDecision {
  const gm = current.gmDecisionOrNull ?? s.fail(),
    proposal = gm.proposalOrNull ?? s.fail(),
    owner = proposal.ownerProvenance.requestOwnerDeviceId;
  if (
    gm.request.decision !== 'ACCEPT' ||
    current.playerDecisionOrNull !== null ||
    request.campaignId !== proposal.campaignId ||
    request.admissionBatchId !== proposal.admissionBatchId ||
    request.proposalRevision !== proposal.proposalRevision ||
    request.proposalChecksum !== proposal.proposalChecksum ||
    request.expectedCampaignRevision !== history.checkpoint.stateRevision
  )
    return s.fail('STALE_REVISION');
  const accepted = request.decision === 'ACCEPT',
    preparation = request.controllerPreparationOrNull;
  let capacity: AdmissionCapacityProof | null = null;
  if (accepted) {
    const lane = current.review.request.proof.laneProvenance;
    if (lane === null) return s.fail('FOREIGN_OWNER');
    const originalSeat =
      lane.kind === 'SUBMITTED_BATCH'
        ? lane.localControllerSeatId
        : lane.receipt.binding.localControllerSeatId;
    if (
      preparation === null ||
      preparation.ownerDeviceId !== owner ||
      preparation.requestId !== proposal.ownerProvenance.requestId ||
      preparation.controllerBindings.length !== gm.copies.length ||
      preparation.controllerBindings[0]!.localControllerSeatId !== originalSeat ||
      preparation.controllerBindings.some(
        (binding, i) => binding.campaignCharacterId !== gm.copies[i]!.campaignCharacterId,
      )
    )
      return s.fail('FOREIGN_OWNER');
    const bindings = [...history.controllers.values()];
    for (const binding of preparation.controllerBindings)
      if (
        bindings.some(
          (old) =>
            old.campaignCharacterId === binding.campaignCharacterId ||
            (old.deviceId === binding.deviceId &&
              (old.localControllerSeatId === binding.localControllerSeatId ||
                old.inputLaneId === binding.inputLaneId)),
        )
      )
        return s.fail('IDEMPOTENCY_CONFLICT');
    const limit = current.review.source.creationOrigin.payload.host.activePlayerCapacity;
    capacity = {
      activePlayerCapacity: limit,
      occupiedCampaignPlaceCount: history.occupiedCampaignPlaceCount,
      activePcCount: history.activePcCount,
      candidateCount: gm.copies.length,
      fitsCurrentCapacity: history.occupiedCampaignPlaceCount + gm.copies.length <= limit,
      evaluatedCampaignRevision: history.checkpoint.stateRevision,
    };
    if (!capacity.fitsCurrentCapacity) return s.fail('CAPACITY_EXCEEDED');
  }
  const createdGroups: AdmissionGroup[] = [],
    groups = new Map(history.groups);
  const groupId = (index: number): string => {
    const assignment = gm.copies[index]!.sheet.groupAssignmentOrNull ?? s.fail();
    if (assignment.kind === 'EXISTING') {
      const group = groups.get(assignment.groupId) ?? s.fail('INVALID_INPUT');
      if (group.campaignId !== proposal.campaignId) return s.fail('INVALID_INPUT');
      return group.groupId;
    }
    const known = [...groups.values()].find((group) =>
      assignment.kind === 'START'
        ? group.origin === 'START'
        : group.origin === 'NEW' &&
          group.admissionBatchId === proposal.admissionBatchId &&
          group.groupDraftIdOrNull === assignment.groupDraftId,
    );
    if (known !== undefined) {
      if (assignment.kind === 'NEW' && known.nameOrNull !== assignment.name) return s.fail();
      return known.groupId;
    }
    const id = s.uuid(allocateId());
    if (groups.has(id)) return s.fail('IDEMPOTENCY_CONFLICT');
    const group: AdmissionGroup = {
      schemaVersion: 1,
      groupId: id,
      campaignId: proposal.campaignId,
      admissionBatchId: proposal.admissionBatchId,
      origin: assignment.kind,
      groupDraftIdOrNull: assignment.kind === 'NEW' ? assignment.groupDraftId : null,
      nameOrNull: assignment.kind === 'NEW' ? assignment.name : null,
    };
    groups.set(id, group);
    createdGroups.push(group);
    return id;
  };
  const receipt: AdmissionPlayerDecisionReceipt = {
    receiptId,
    commandId: request.commandId,
    workflowCommandId: 'UI-CMD-ADMISSION-PLAYER-DECIDE',
    campaignId: request.campaignId,
    admissionBatchId: request.admissionBatchId,
    requestId: proposal.ownerProvenance.requestId,
    requestOwnerDeviceId: owner,
    proposalRevision: proposal.proposalRevision,
    proposalChecksum: proposal.proposalChecksum,
    decision: request.decision,
    capacityProofOrNull: capacity,
    controllerProofOrNull:
      preparation === null
        ? null
        : {
            ownerProvenance: proposal.ownerProvenance,
            controllerBindings: preparation.controllerBindings,
            valid: true,
            evaluatedCampaignRevision: history.checkpoint.stateRevision,
          },
    copies: gm.copies.map((copy, i) => ({
      campaignCharacterId: copy.campaignCharacterId,
      lifecycleState: !accepted
        ? 'DECLINED'
        : proposal.fullCampaignCopyDiffs[i]!.blockers.length === 0
          ? 'ACTIVE'
          : 'PROPOSED',
      occupiesCampaignPlace: accepted,
      groupIdOrNull: accepted ? groupId(i) : null,
      locationAssignmentOrNull: accepted ? copy.sheet.locationAssignmentOrNull : null,
      controllerBindingOrNull: preparation?.controllerBindings[i] ?? null,
    })),
    campaignRevision: s.increment(history.checkpoint.stateRevision),
    timestamp,
  };
  return { scope: gm.scope, request, receipt, createdGroups };
}

function readInTransaction(
  db: Database.Database,
  current: AdmissionDecisionRead,
  history: AdmissionHistory,
): StoredAdmissionPlayerDecision | null {
  const gm = current.gmDecisionOrNull ?? s.fail(),
    batchId = gm.request.admissionBatchId,
    anchor = s.at(db, 'campaign_admission_gm_decision', 'admission_batch_id', batchId) ?? s.fail(),
    row = s.at(db, 'campaign_admission_player_decision', 'admission_batch_id', batchId);
  if (row === undefined) {
    if (anchor['player_command_id'] !== null || anchor['player_record_sha256'] !== null)
      return s.fail();
    return null;
  }
  const raw = s.object(s.checked(row), ['scope', 'request', 'receipt', 'createdGroups']),
    request = admissionPlayerDecisionRequestValue(raw['request']),
    receipt = s.object(raw['receipt']);
  if (!Array.isArray(raw['createdGroups'])) return s.fail();
  const createdGroups = raw['createdGroups'];
  let groupIndex = 0;
  const expected = plan(
    current,
    history,
    request,
    s.uuid(receipt['receiptId']),
    s.text(receipt['timestamp']),
    () => {
      const group = s.object(createdGroups[groupIndex++]);
      return s.uuid(group['groupId']);
    },
  );
  if (
    !s.same(expected, raw) ||
    groupIndex !== raw['createdGroups'].length ||
    row['campaign_id'] !== gm.request.campaignId ||
    row['command_id'] !== request.commandId ||
    row['receipt_id'] !== expected.receipt.receiptId ||
    row['decision'] !== request.decision ||
    anchor['player_command_id'] !== request.commandId ||
    anchor['player_record_sha256'] !== row['record_sha256']
  )
    return s.fail();
  const ids = [
    request.commandId,
    expected.receipt.receiptId,
    ...expected.createdGroups.map((g) => g.groupId),
  ];
  if (new Set(ids).size !== ids.length) return s.fail();
  return expected;
}

function copyPayload(
  current: AdmissionDecisionRead,
  record: StoredAdmissionPlayerDecision,
  index: number,
): string {
  return s.canonical({
    ...current.gmDecisionOrNull!.copies[index]!,
    admission: { playerCommandId: record.request.commandId, ...record.receipt.copies[index]! },
  });
}
function checkpoint(
  before: CampaignCheckpoint,
  current: AdmissionDecisionRead,
  record: StoredAdmissionPlayerDecision,
): CampaignCheckpoint {
  if (record.request.expectedCampaignRevision !== before.stateRevision) return s.fail();
  const snapshot = s.object(JSON.parse(before.snapshotJson) as unknown, [
    'campaign',
    'campaignCharacterCopies',
  ]);
  if (!Array.isArray(snapshot['campaignCharacterCopies'])) return s.fail();
  const copies = snapshot['campaignCharacterCopies'].map((v: unknown) =>
    s.object(v, ['campaignCharacterId', 'sourceUuid', 'lifecycleState', 'payloadJson']),
  );
  for (const [i, result] of record.receipt.copies.entries()) {
    const copy = current.gmDecisionOrNull!.copies[i]!,
      matching = copies.filter((c) => c['campaignCharacterId'] === result.campaignCharacterId);
    if (
      matching.length !== 1 ||
      matching[0]!['sourceUuid'] !== copy.sourceUuid ||
      matching[0]!['lifecycleState'] !== 'PROPOSED' ||
      matching[0]!['payloadJson'] !== s.canonical(copy)
    )
      return s.fail();
    matching[0]!['lifecycleState'] = result.lifecycleState;
    matching[0]!['payloadJson'] = copyPayload(current, record, i);
  }
  return {
    campaignId: before.campaignId,
    snapshotJson: JSON.stringify({
      campaign: snapshot['campaign'],
      campaignCharacterCopies: copies,
    }),
    stateRevision: s.increment(before.stateRevision),
    projectionRevision: s.increment(before.projectionRevision),
    actorVisibilityRevision: s.increment(before.actorVisibilityRevision),
  };
}
function advance(history: AdmissionHistory, record: StoredAdmissionPlayerDecision): void {
  for (const group of record.createdGroups) {
    if (history.groups.has(group.groupId)) return s.fail();
    history.groups.set(group.groupId, group);
  }
  for (const copy of record.receipt.copies) {
    if (copy.occupiesCampaignPlace) history.occupiedCampaignPlaceCount += 1;
    if (copy.lifecycleState === 'ACTIVE') history.activePcCount += 1;
    if (copy.controllerBindingOrNull !== null) {
      if (history.controllers.has(copy.campaignCharacterId)) return s.fail();
      history.controllers.set(copy.campaignCharacterId, copy.controllerBindingOrNull);
    }
  }
}
function controllerRecord(
  record: StoredAdmissionPlayerDecision,
  binding: AdmissionControllerBinding,
) {
  return {
    schemaVersion: 1,
    campaignId: record.request.campaignId,
    admissionBatchId: record.request.admissionBatchId,
    playerCommandId: record.request.commandId,
    binding,
  };
}
function verifyLedger(db: Database.Database, campaignId: string, history: AdmissionHistory): void {
  const groups = db
      .prepare('SELECT * FROM campaign_admission_group WHERE campaign_id=?')
      .all(campaignId) as Row[],
    controllers = db
      .prepare('SELECT * FROM campaign_admission_controller WHERE campaign_id=?')
      .all(campaignId) as Row[];
  if (groups.length !== history.groups.size || controllers.length !== history.controllers.size)
    return s.fail();
  for (const row of groups) {
    const expected = history.groups.get(s.uuid(row['group_id'])) ?? s.fail();
    if (
      row['admission_batch_id'] !== expected.admissionBatchId ||
      row['origin'] !== expected.origin ||
      row['group_draft_id'] !== expected.groupDraftIdOrNull ||
      !s.same(s.checked(row), expected)
    )
      return s.fail();
  }
  for (const row of controllers) {
    const binding = history.controllers.get(s.uuid(row['campaign_character_id'])) ?? s.fail(),
      decision =
        history.decisions.get(s.uuid(row['admission_batch_id']))?.playerDecisionOrNull ?? s.fail();
    if (
      row['owner_device_id'] !== binding.deviceId ||
      row['local_controller_seat_id'] !== binding.localControllerSeatId ||
      row['input_lane_id'] !== binding.inputLaneId ||
      !s.same(s.checked(row), controllerRecord(decision, binding))
    )
      return s.fail();
  }
  // Missing receipts and orphan terminal anchors are errors even for a still-pending batch.
  for (const [batchId, current] of history.decisions) {
    const row =
      s.at(db, 'campaign_admission_gm_decision', 'admission_batch_id', batchId) ?? s.fail();
    if (row['player_command_id'] !== (current.playerDecisionOrNull?.request.commandId ?? null))
      return s.fail();
  }
}

/** The owner identity comes from the authenticated peer channel, never from the browser payload. */
export function commitAdmissionPlayerDecision(
  db: Database.Database,
  scope: GmRequestReviewScope,
  authenticatedOwnerDeviceId: string,
  value: Readonly<{
    request: AdmissionPlayerDecisionRequest;
    receiptId: string;
    timestamp: string;
  }>,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
  allocateId: () => string,
  guard: NetworkStoreGuard<AdmissionDecisionRead>,
): Readonly<{ current: AdmissionDecisionRead; replayed: boolean }> {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const input = s.input(() => s.object(value, ['request', 'receiptId', 'timestamp'])),
    request = s.input(() =>
      admissionPlayerDecisionRequestValue(JSON.parse(s.canonical(input['request'])) as unknown),
    );
  const assertOwner = (current: AdmissionDecisionRead) => {
    if (current.gmDecisionOrNull?.receipt.requestOwnerDeviceId !== authenticatedOwnerDeviceId)
      return s.fail('FOREIGN_OWNER');
  };
  const replay = s.read(db, scope.ownerDeviceId, () => {
    if (
      s.at(
        db,
        'campaign_admission_player_decision',
        'admission_batch_id',
        request.admissionBatchId,
      ) === undefined
    )
      return null;
    const current = readAdmissionDecision(db, scope, request.admissionBatchId, validate, rules);
    assertOwner(current);
    if (!s.same(current.playerDecisionOrNull?.request, request))
      return s.fail('IDEMPOTENCY_CONFLICT');
    s.guarded(db, guard, current, 'REPLAY');
    return { current, replayed: true };
  });
  if (replay !== null) return replay;
  return s.safe(
    () =>
      commitCampaignCheckpoint(db, scope.campaignId, () => {
        const receiptId = s.uuid(input['receiptId']),
          timestamp = s.text(input['timestamp']);
        const history = publication.readHistory(db, scope, validate, rules),
          current = history.decisions.get(request.admissionBatchId) ?? s.fail('NOT_FOUND');
        assertOwner(current);
        s.guarded(db, guard, current, 'APPLY');
        // Semantic refusals retain their code; only the external allocator is a callback.
        const record = plan(current, history, request, receiptId, timestamp, () => {
          let allocated: string | null = null;
          s.guarded(
            db,
            () => {
              allocated = working.callSynchronous(allocateId);
            },
            { current, request, input },
            'APPLY',
          );
          return s.uuid(allocated);
        });
        const ids = [
          request.commandId,
          record.receipt.receiptId,
          ...record.createdGroups.map((g) => g.groupId),
        ];
        if (new Set(ids).size !== ids.length) return s.fail('IDEMPOTENCY_CONFLICT');
        for (const id of ids) s.assertUnused(db, id);
        for (const copy of record.receipt.copies) {
          const binding = copy.controllerBindingOrNull;
          if (
            binding !== null &&
            db
              .prepare(
                'SELECT 1 FROM campaign_admission_controller WHERE owner_device_id=? AND (local_controller_seat_id=? OR input_lane_id=?)',
              )
              .get(binding.deviceId, binding.localControllerSeatId, binding.inputLaneId) !==
              undefined
          )
            return s.fail('IDEMPOTENCY_CONFLICT');
        }
        const next = checkpoint(history.checkpoint, current, record),
          before = s.changes(db),
          json = s.canonical(record);
        db.prepare('INSERT INTO campaign_admission_player_decision VALUES (?,?,?,?,?,?,?)').run(
          request.admissionBatchId,
          scope.campaignId,
          request.commandId,
          record.receipt.receiptId,
          request.decision,
          json,
          s.sha(json),
        );
        const anchored = db
          .prepare(
            'UPDATE campaign_admission_gm_decision SET player_command_id=?,player_record_sha256=? WHERE admission_batch_id=? AND player_command_id IS NULL AND player_record_sha256 IS NULL',
          )
          .run(request.commandId, s.sha(json), request.admissionBatchId);
        if (anchored.changes !== 1) return s.fail('SOURCE_CHANGED');
        let count = 2;
        for (const group of record.createdGroups) {
          const groupJson = s.canonical(group);
          db.prepare('INSERT INTO campaign_admission_group VALUES (?,?,?,?,?,?,?)').run(
            group.groupId,
            scope.campaignId,
            request.admissionBatchId,
            group.origin,
            group.groupDraftIdOrNull,
            groupJson,
            s.sha(groupJson),
          );
          count += 1;
        }
        for (const [i, copy] of record.receipt.copies.entries()) {
          const updated = db
            .prepare(
              "UPDATE campaign_character_copy SET lifecycle_state=?,payload_json=? WHERE campaign_character_id=? AND campaign_id=? AND lifecycle_state='PROPOSED' AND payload_json=?",
            )
            .run(
              copy.lifecycleState,
              copyPayload(current, record, i),
              copy.campaignCharacterId,
              scope.campaignId,
              s.canonical(current.gmDecisionOrNull!.copies[i]!),
            );
          if (updated.changes !== 1) return s.fail('SOURCE_CHANGED');
          count += 1;
          const binding = copy.controllerBindingOrNull;
          if (binding !== null) {
            const bindingJson = s.canonical(controllerRecord(record, binding));
            db.prepare('INSERT INTO campaign_admission_controller VALUES (?,?,?,?,?,?,?,?)').run(
              copy.campaignCharacterId,
              scope.campaignId,
              request.admissionBatchId,
              binding.deviceId,
              binding.localControllerSeatId,
              binding.inputLaneId,
              bindingJson,
              s.sha(bindingJson),
            );
            count += 1;
          }
        }
        advanceRevisions(
          db,
          { entity: 'campaign', entityId: scope.campaignId },
          { stateChanged: true, projectionChanged: true, actorVisibilityChanged: true },
        );
        const event = publication.event(
            history.checkpoint,
            next,
            record,
            request.decision === 'ACCEPT' ? 'PLAYER_ACCEPT' : 'PLAYER_DECLINE',
          ),
          eventJson = s.canonical(event);
        db.prepare('INSERT INTO campaign_admission_checkpoint_event VALUES (?,?,?,?,?,?,?)').run(
          scope.campaignId,
          event.stateRevision,
          request.admissionBatchId,
          request.commandId,
          event.kind,
          eventJson,
          s.sha(eventJson),
        );
        count += 2;
        if (
          !db.inTransaction ||
          s.changes(db) !== before + count ||
          !s.same(readInTransaction(db, current, history), record)
        )
          return s.fail('SOURCE_CHANGED');
        const after = { ...current, playerDecisionOrNull: record };
        advance(history, record);
        history.decisions.set(request.admissionBatchId, after);
        verifyLedger(db, scope.campaignId, history);
        appendGmAdmissionSourceInTransaction(db, scope, {
          kind: 'PLAYER_DECISION',
          admissionBatchId: request.admissionBatchId,
          commandId: request.commandId,
          recordSha256: s.sha(json),
        });
        const refreshed = { ...after, review: working.withCurrentPresentation(db, after.review) };
        s.guarded(db, guard, refreshed, 'APPLY');
        return { current: refreshed, replayed: false };
      }).result,
  );
}

export const admissionPlayerStorage = { readInTransaction, checkpoint, advance, verifyLedger };
