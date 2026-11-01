import type Database from 'better-sqlite3';
import { admissionGmClientBindingValue } from '@shared/campaign-admission-review.js';
import {
  admissionGmDecisionRequestValue,
  admissionProposalValue,
  type AdmissionGmDecisionRequest,
  type AdmissionGmDecisionReceipt,
  type AdmissionProposal,
} from '@shared/campaign-admission-proposal.js';
import type {
  AdmissionMechanicalSheetV1,
  AdmissionPublicWeaponProfile,
} from '@shared/campaign-admission.js';
import {
  readCampaignCreationOrigin,
  appendGmAdmissionSourceInTransaction,
  appendGmAdmissionViewEventInTransaction,
  readGmAdmissionViewStateInTransaction,
  readGmRequestReviewViewStateInTransaction,
  readPausedCampaign,
  type CampaignPrivateOwnerValidator,
  type GmRequestReviewScope,
} from './campaign-creation.js';
import type { FormActionIntentV2Message } from '../shared/wire-v2-protocol.js';
import { readAppliedMigrationVersion } from './migrations/index.js';
import { readGmRequestReviewSource, type GmRequestReviewSource } from './network-device-request.js';
import {
  admissionReviewStorage as working,
  type AdmissionReviewRead,
  type AdmissionReviewRules,
} from './campaign-admission-review.js';
import {
  networkApplicationStorage as s,
  type NetworkStoreGuard,
} from './network-local-application.js';
import {
  advanceRevisions,
  commitCampaignCheckpoint,
  loadCampaignCheckpoint,
  readRevisions,
  type CampaignCheckpoint,
} from './store.js';
import {
  admissionPlayerStorage as player,
  type AdmissionHistory,
  type StoredAdmissionPlayerDecision,
} from './campaign-admission-player.js';
import { CAMPAIGN_ADMISSION_TABLES } from './migrations/0012-campaign-admission.js';

export interface AdmissionInventoryInstance {
  readonly instanceId: string;
  readonly reviewItemId: string;
  readonly weaponProfileOrNull: Readonly<{
    profileId: string;
    version: 1;
    profile: AdmissionPublicWeaponProfile;
  }> | null;
}
export interface AdmissionPublishedCopy {
  readonly schemaVersion: 1;
  readonly campaignId: string;
  readonly campaignCharacterId: string;
  readonly admissionBatchId: string;
  readonly reviewCopyId: string;
  readonly sourceUuid: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotChecksum: string;
  readonly proposalChecksum: string;
  readonly ownerDeviceId: string;
  readonly sheet: AdmissionMechanicalSheetV1;
  readonly inventoryInstances: readonly AdmissionInventoryInstance[];
}
export interface StoredAdmissionGmDecision {
  readonly scope: GmRequestReviewScope;
  readonly request: AdmissionGmDecisionRequest;
  readonly clientRequestJsonOrNull: string | null;
  readonly receipt: AdmissionGmDecisionReceipt;
  readonly reviewStateSha256: string;
  readonly proposalOrNull: AdmissionProposal | null;
  readonly copies: readonly AdmissionPublishedCopy[];
}
export interface AdmissionDecisionRead {
  readonly review: AdmissionReviewRead;
  readonly gmDecisionOrNull: StoredAdmissionGmDecision | null;
  readonly playerDecisionOrNull: StoredAdmissionPlayerDecision | null;
}
export interface AdmissionPublicationRules extends AdmissionReviewRules {
  /** Null IDs request a preview. Non-null IDs publish the same complete reviewed sheets. */
  readonly buildProposal: (
    review: AdmissionReviewRead,
    campaignCharacterIds: readonly (string | null)[],
  ) => AdmissionProposal;
}
/** Published history has its own NAV boundary; it must never fabricate another review OPEN. */
export function enterPublishedAdmissionView(
  db: Database.Database,
  scope: GmRequestReviewScope,
  value: FormActionIntentV2Message,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
  guard: NetworkStoreGuard<AdmissionDecisionRead>,
) {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const request = s.input(() => {
    const row = s.object(JSON.parse(s.canonical(value)) as unknown, [
      'messageType',
      'protocolVersion',
      'navigationRequestId',
      'sourceFormId',
      'actionKey',
      'expectedProjectionRevision',
    ]);
    if (
      row['messageType'] !== 'navigation.form-action' ||
      row['protocolVersion'] !== 2 ||
      row['sourceFormId'] !== 'NET-017' ||
      ![
        'NET-017::CTA::001',
        'NET-017::CTA::002',
        'NET-017::CTA::003',
        'NET-017::CTA::004',
      ].includes(s.text(row['actionKey']))
    )
      return s.fail('INVALID_INPUT');
    s.text(row['navigationRequestId']);
    s.integer(row['expectedProjectionRevision']);
    return row as unknown as FormActionIntentV2Message;
  });
  return s.safe(() =>
    db
      .transaction(() => {
        const views = readGmAdmissionViewStateInTransaction(db, scope);
        const known = views.events.find((event) => event.eventId === request.navigationRequestId);
        if (known !== undefined) {
          if (known.mutation.kind !== 'ENTER_PUBLISHED' || !s.same(known.mutation.request, request))
            return s.fail('IDEMPOTENCY_CONFLICT');
          const current = readAdmissionDecision(
            db,
            scope,
            known.mutation.admissionBatchId,
            validate,
            rules,
          );
          s.guarded(db, guard, current, 'REPLAY');
          return { event: known, current, replayed: true };
        }
        const source = readGmRequestReviewSource(db, scope, validate);
        if (
          source.cursor.kind !== 'QUEUE' ||
          source.cursor.targetId !== scope.campaignId ||
          source.viewOrNull?.formId !== 'NET-017' ||
          request.expectedProjectionRevision !== source.viewOrNull.projectionRevision
        )
          return s.fail('STALE_REVISION');
        const batch = s.at(
          db,
          'campaign_admission_batch',
          'request_id',
          s.text(source.viewOrNull?.values.selectedRequestIdOrNull),
        );
        if (batch === undefined) return s.fail('NOT_FOUND');
        const batchId = s.text(batch['admission_batch_id']);
        const current = readAdmissionDecision(db, scope, batchId, validate, rules);
        const published = current.gmDecisionOrNull;
        if (
          published?.request.decision !== 'ACCEPT' ||
          (current.playerDecisionOrNull !== null &&
            !current.playerDecisionOrNull.receipt.copies.some(
              (copy) => copy.lifecycleState === 'PROPOSED',
            ))
        )
          return s.fail('STALE_REVISION');
        const selected =
          published.copies.find(
            (copy) =>
              current.playerDecisionOrNull === null ||
              current.playerDecisionOrNull.receipt.copies.some(
                (result) =>
                  result.campaignCharacterId === copy.campaignCharacterId &&
                  result.lifecycleState === 'PROPOSED',
              ),
          ) ?? s.fail('STALE_REVISION');
        s.guarded(db, guard, current, 'APPLY');
        const queue = readGmRequestReviewViewStateInTransaction(db, scope),
          prefix = queue.events.at(-1) ?? s.fail();
        const saved = appendGmAdmissionViewEventInTransaction(db, scope, {
          eventId: request.navigationRequestId,
          mutation: {
            kind: 'ENTER_PUBLISHED',
            admissionBatchId: batchId,
            selectedReviewCopyId: selected.reviewCopyId,
            request,
            publicationRecordSha256: s.sha(s.canonical(published)),
            queuePrefix: { eventId: prefix.eventId, recordSha256: prefix.recordSha256 },
          },
        });
        const after = readAdmissionDecision(db, scope, batchId, validate, rules);
        s.guarded(db, guard, after, 'APPLY');
        return { event: saved.event, current: after, replayed: false };
      })
      .immediate(),
  );
}
interface AdmissionCheckpointEvent {
  readonly schemaVersion: 1;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly commandId: string;
  readonly receiptId: string;
  readonly kind: 'GM_ACCEPT' | 'PLAYER_ACCEPT' | 'PLAYER_DECLINE';
  readonly stateRevision: number;
  readonly beforeCheckpointSha256: string;
  readonly afterCheckpointSha256: string;
}
type Row = Record<string, unknown>;

function proposal(
  db: Database.Database,
  review: AdmissionReviewRead,
  rules: AdmissionPublicationRules,
  ids: readonly (string | null)[],
): AdmissionProposal {
  let result: string | null = null;
  s.guarded(
    db,
    () => {
      result = s.canonical(working.callSynchronous(rules.buildProposal, review, ids));
    },
    { review, ids },
    'REPLAY',
  );
  const value = admissionProposalValue(JSON.parse(s.text(result)) as unknown);
  const { proposalChecksum, ...body } = value;
  if (
    s.sha(s.canonical(body)) !== proposalChecksum ||
    value.campaignId !== review.source.scope.campaignId ||
    value.admissionBatchId !== review.current.admissionBatchId ||
    value.reviewRevision !== review.current.reviewRevision ||
    value.proposalRevision !== 1 ||
    value.ownerProvenance.requestId !== review.current.requestId ||
    value.ownerProvenance.requestOwnerDeviceId !== review.open.receipt.requestOwnerDeviceId ||
    value.fullCampaignCopyDiffs.length !== review.current.copies.length ||
    value.fullCampaignCopyDiffs.some((diff, i) => {
      const copy = review.current.copies[i]!;
      return (
        diff.campaignCharacterIdOrNull !== ids[i] ||
        diff.reviewCopyIdOrNull !== copy.reviewCopyId ||
        diff.sourceUuid !== copy.sourceUuid ||
        diff.sourceSnapshotChecksum !== copy.snapshotChecksum
      );
    })
  )
    return s.fail();
  return value;
}
function gmReceipt(
  review: AdmissionReviewRead,
  request: AdmissionGmDecisionRequest,
  publication: AdmissionProposal | null,
  receiptId: string,
  timestamp: string,
): AdmissionGmDecisionReceipt {
  return {
    receiptId,
    commandId: request.commandId,
    workflowCommandId:
      request.decision === 'ACCEPT' ? 'UI-CMD-ADMISSION-GM-ACCEPT' : 'UI-CMD-ADMISSION-GM-REJECT',
    campaignId: request.campaignId,
    admissionBatchId: request.admissionBatchId,
    requestId: review.current.requestId,
    requestOwnerDeviceId: review.open.receipt.requestOwnerDeviceId,
    reviewRevision: request.reviewRevision,
    decision: request.decision,
    reasonOrNull: request.reasonOrNull,
    proposalRevisionOrNull: publication?.proposalRevision ?? null,
    proposalChecksumOrNull: publication?.proposalChecksum ?? null,
    campaignCharacterIds:
      publication?.fullCampaignCopyDiffs.map((d) => s.uuid(d.campaignCharacterIdOrNull)) ?? [],
    authoritativeGmActorId: review.source.privateOwner.masterProfileId,
    timestamp,
  };
}
function previewChecksum(publication: AdmissionProposal): string {
  const { proposalChecksum: _checksum, ...body } = publication;
  const diffs = body.fullCampaignCopyDiffs.map((diff) => ({
    ...diff,
    campaignCharacterIdOrNull: null,
    blockers: diff.blockers.map((blocker) => ({ ...blocker, campaignCharacterIdOrNull: null })),
  }));
  return s.sha(
    s.canonical({
      ...body,
      fullCampaignCopyDiffs: diffs,
      blockers: diffs.flatMap((diff) => diff.blockers),
    }),
  );
}
function verifyExistingGroups(publication: AdmissionProposal, history: AdmissionHistory): void {
  for (const diff of publication.fullCampaignCopyDiffs) {
    const assignment = diff.afterSheet.groupAssignmentOrNull ?? s.fail();
    if (assignment.kind === 'EXISTING') {
      const group = history.groups.get(assignment.groupId);
      if (group === undefined || group.campaignId !== publication.campaignId)
        return s.fail('INVALID_INPUT');
    }
  }
}
function copyFromAllocations(
  review: AdmissionReviewRead,
  publication: AdmissionProposal,
  index: number,
  allocations: readonly Readonly<{ instanceId: string; profileIdOrNull: string | null }>[],
): AdmissionPublishedCopy {
  const diff = publication.fullCampaignCopyDiffs[index]!,
    source = review.current.copies[index]!;
  if (allocations.length !== diff.afterSheet.inventoryReview.entries.length) return s.fail();
  return {
    schemaVersion: 1,
    campaignId: publication.campaignId,
    campaignCharacterId: s.uuid(diff.campaignCharacterIdOrNull),
    admissionBatchId: publication.admissionBatchId,
    reviewCopyId: source.reviewCopyId,
    sourceUuid: source.sourceUuid,
    sourceSnapshotId: source.sourceSnapshotId,
    sourceSnapshotChecksum: source.snapshotChecksum,
    proposalChecksum: publication.proposalChecksum,
    ownerDeviceId: publication.ownerProvenance.requestOwnerDeviceId,
    sheet: diff.afterSheet,
    inventoryInstances: diff.afterSheet.inventoryReview.entries.map((entry, i) => {
      const allocated = allocations[i]!,
        profile = entry.weaponProfileOrNull;
      if ((profile === null) !== (allocated.profileIdOrNull === null)) return s.fail();
      return {
        instanceId: s.uuid(allocated.instanceId),
        reviewItemId: entry.reviewItemId,
        weaponProfileOrNull:
          profile === null
            ? null
            : {
                profileId: s.uuid(allocated.profileIdOrNull),
                version: 1,
                profile,
              },
      };
    }),
  };
}
function allocationsFromStored(
  value: unknown,
): readonly Readonly<{ instanceId: string; profileIdOrNull: string | null }>[] {
  const raw = s.object(value);
  if (!Array.isArray(raw['inventoryInstances'])) return s.fail();
  return raw['inventoryInstances'].map((entry: unknown) => {
    const row = s.object(entry, ['instanceId', 'reviewItemId', 'weaponProfileOrNull']);
    const profile =
      row['weaponProfileOrNull'] === null
        ? null
        : s.object(row['weaponProfileOrNull'], ['profileId', 'version', 'profile']);
    return {
      instanceId: s.uuid(row['instanceId']),
      profileIdOrNull: profile === null ? null : s.uuid(profile['profileId']),
    };
  });
}
function finalIds(record: StoredAdmissionGmDecision): readonly string[] {
  return [
    record.request.commandId,
    record.receipt.receiptId,
    ...record.copies.flatMap((copy) => [
      copy.campaignCharacterId,
      ...copy.inventoryInstances.flatMap((item) => [
        item.instanceId,
        ...(item.weaponProfileOrNull === null ? [] : [item.weaponProfileOrNull.profileId]),
      ]),
    ]),
  ];
}
function verifyCopies(db: Database.Database, record: StoredAdmissionGmDecision): void {
  const rows = db
    .prepare('SELECT * FROM campaign_admission_copy WHERE admission_batch_id=?')
    .all(record.request.admissionBatchId) as Row[];
  if (rows.length !== record.copies.length) return s.fail();
  for (const copy of record.copies) {
    const row =
      rows.find((r) => r['campaign_character_id'] === copy.campaignCharacterId) ?? s.fail();
    if (
      row['campaign_id'] !== copy.campaignId ||
      row['review_copy_id'] !== copy.reviewCopyId ||
      row['source_uuid'] !== copy.sourceUuid ||
      !s.same(s.checked(row), copy)
    )
      return s.fail();
    const live =
      s.at(db, 'campaign_character_copy', 'campaign_character_id', copy.campaignCharacterId) ??
      s.fail();
    // Mutable lifecycle/payload are checked by the complete checkpoint history below.
    if (live['campaign_id'] !== copy.campaignId || live['source_uuid'] !== copy.sourceUuid)
      return s.fail();
    const inventory = db
      .prepare('SELECT * FROM campaign_admission_inventory WHERE campaign_character_id=?')
      .all(copy.campaignCharacterId) as Row[];
    if (inventory.length !== copy.inventoryInstances.length) return s.fail();
    for (const item of copy.inventoryInstances) {
      const stored = inventory.find((r) => r['instance_id'] === item.instanceId) ?? s.fail();
      if (
        stored['review_item_id'] !== item.reviewItemId ||
        stored['profile_id'] !== (item.weaponProfileOrNull?.profileId ?? null) ||
        !s.same(s.checked(stored), item)
      )
        return s.fail();
    }
  }
}
function readDecision(
  db: Database.Database,
  review: AdmissionReviewRead,
  rules: AdmissionPublicationRules,
): AdmissionDecisionRead {
  const row = s.at(
    db,
    'campaign_admission_gm_decision',
    'admission_batch_id',
    review.current.admissionBatchId,
  );
  if (row === undefined) {
    if (
      db
        .prepare('SELECT 1 FROM campaign_admission_copy WHERE admission_batch_id=?')
        .get(review.current.admissionBatchId) !== undefined
    )
      return s.fail();
    return { review, gmDecisionOrNull: null, playerDecisionOrNull: null };
  }
  const raw = s.object(s.checked(row), [
      'scope',
      'request',
      'clientRequestJsonOrNull',
      'receipt',
      'reviewStateSha256',
      'proposalOrNull',
      'copies',
    ]),
    request = admissionGmDecisionRequestValue(raw['request']),
    receipt = s.object(raw['receipt']);
  const head =
    s.at(db, 'campaign_admission_head', 'admission_batch_id', review.current.admissionBatchId) ??
    s.fail();
  if (
    head['terminal_command_id'] !== request.commandId ||
    head['terminal_record_sha256'] !== row['record_sha256']
  )
    return s.fail();
  if (
    !s.same(raw['scope'], review.source.scope) ||
    request.campaignId !== review.source.scope.campaignId ||
    row['campaign_id'] !== request.campaignId ||
    row['command_id'] !== request.commandId ||
    row['receipt_id'] !== receipt['receiptId'] ||
    row['decision'] !== request.decision ||
    request.admissionBatchId !== review.current.admissionBatchId ||
    request.reviewRevision !== review.current.reviewRevision ||
    raw['reviewStateSha256'] !== s.sha(s.canonical(review.current)) ||
    review.request.requestStatus !== 'IN_REVIEW' ||
    review.request.requestRevision !== review.open.request.payload.requestRevision ||
    !Array.isArray(raw['copies'])
  )
    return s.fail();
  let publication: AdmissionProposal | null = null;
  let copies: readonly AdmissionPublishedCopy[] = [];
  if (request.decision === 'ACCEPT') {
    const storedProposal = admissionProposalValue(raw['proposalOrNull']);
    publication = proposal(
      db,
      review,
      rules,
      storedProposal.fullCampaignCopyDiffs.map((d) => s.uuid(d.campaignCharacterIdOrNull)),
    );
    if (
      !s.same(storedProposal, publication) ||
      raw['copies'].length !== publication.fullCampaignCopyDiffs.length ||
      // Rebuilt final mechanics plus normalized IDs prove the original preview.
      // Publication still derives both sides before freezing their equality.
      previewChecksum(publication) !== request.previewChecksumOrNull
    )
      return s.fail();
    copies = raw['copies'].map((v: unknown, index: number) =>
      copyFromAllocations(review, publication!, index, allocationsFromStored(v)),
    );
    if (!s.same(copies, raw['copies'])) return s.fail();
  } else if (raw['proposalOrNull'] !== null || raw['copies'].length !== 0) return s.fail();
  const expected = gmReceipt(
    review,
    request,
    publication,
    s.uuid(receipt['receiptId']),
    s.text(receipt['timestamp']),
  );
  if (!s.same(expected, receipt)) return s.fail();
  const record: StoredAdmissionGmDecision = {
    scope: review.source.scope,
    request,
    clientRequestJsonOrNull:
      raw['clientRequestJsonOrNull'] === null ? null : s.text(raw['clientRequestJsonOrNull']),
    receipt: expected,
    reviewStateSha256: s.sha(s.canonical(review.current)),
    proposalOrNull: publication,
    copies,
  };
  const ids = finalIds(record);
  if (new Set(ids).size !== ids.length) return s.fail();
  verifyCopies(db, record);
  return { review, gmDecisionOrNull: record, playerDecisionOrNull: null };
}
function publicationCheckpoint(
  before: CampaignCheckpoint,
  record: StoredAdmissionGmDecision,
): CampaignCheckpoint {
  if (
    record.request.decision !== 'ACCEPT' ||
    record.request.expectedCampaignRevision !== before.stateRevision
  )
    return s.fail();
  const snapshot = s.object(JSON.parse(before.snapshotJson) as unknown, [
    'campaign',
    'campaignCharacterCopies',
  ]);
  if (!Array.isArray(snapshot['campaignCharacterCopies'])) return s.fail();
  const copies = snapshot['campaignCharacterCopies'].map((copy: unknown) =>
    s.object(copy, ['campaignCharacterId', 'sourceUuid', 'lifecycleState', 'payloadJson']),
  );
  for (const copy of record.copies) {
    if (
      copy.campaignId !== before.campaignId ||
      copies.some(
        (old) =>
          old['campaignCharacterId'] === copy.campaignCharacterId ||
          old['sourceUuid'] === copy.sourceUuid,
      )
    )
      return s.fail();
    copies.push({
      campaignCharacterId: copy.campaignCharacterId,
      sourceUuid: copy.sourceUuid,
      lifecycleState: 'PROPOSED',
      payloadJson: s.canonical(copy),
    });
  }
  copies.sort((a, b) =>
    s.text(a['campaignCharacterId']) < s.text(b['campaignCharacterId']) ? -1 : 1,
  );
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
function publicationEvent(
  before: CampaignCheckpoint,
  after: CampaignCheckpoint,
  record: StoredAdmissionGmDecision | StoredAdmissionPlayerDecision,
  kind: AdmissionCheckpointEvent['kind'] = 'GM_ACCEPT',
): AdmissionCheckpointEvent {
  return {
    schemaVersion: 1,
    campaignId: record.request.campaignId,
    admissionBatchId: record.request.admissionBatchId,
    commandId: record.request.commandId,
    receiptId: record.receipt.receiptId,
    kind,
    stateRevision: after.stateRevision,
    beforeCheckpointSha256: s.sha(s.canonical(before)),
    afterCheckpointSha256: s.sha(s.canonical(after)),
  };
}
/** Rebuild every campaign change from immutable birth and verified complete decisions. */
function verifyCampaignHistory(
  db: Database.Database,
  source: GmRequestReviewSource,
  rules: AdmissionPublicationRules,
): AdmissionHistory {
  const verified = new Map<string, AdmissionDecisionRead>();
  let checkpoint: CampaignCheckpoint = {
    campaignId: source.scope.campaignId,
    snapshotJson: JSON.stringify({
      campaign: {
        campaignId: source.scope.campaignId,
        lifecycleState: 'PAUSED',
        payloadJson: s.canonical(source.creationOrigin.payload),
      },
      campaignCharacterCopies: [],
    }),
    stateRevision: 0,
    projectionRevision: 0,
    actorVisibilityRevision: 0,
  };
  const events = db
    .prepare(
      'SELECT * FROM campaign_admission_checkpoint_event WHERE campaign_id=? ORDER BY state_revision',
    )
    .all(source.scope.campaignId) as Row[];
  const decisions = db
    .prepare(
      "SELECT command_id FROM campaign_admission_gm_decision WHERE campaign_id=? AND decision='ACCEPT'",
    )
    .all(source.scope.campaignId) as Row[];
  const playerDecisions = db
    .prepare('SELECT command_id FROM campaign_admission_player_decision WHERE campaign_id=?')
    .all(source.scope.campaignId) as Row[];
  if (events.length !== decisions.length + playerDecisions.length) return s.fail();
  const history: AdmissionHistory = {
    checkpoint,
    decisions: verified,
    groups: new Map(),
    controllers: new Map(),
    occupiedCampaignPlaceCount: 0,
    activePcCount: 0,
  };
  for (const [index, row] of events.entries()) {
    const batchId = s.uuid(row['admission_batch_id']);
    if (row['state_revision'] !== index + 1) return s.fail();
    let next: CampaignCheckpoint;
    let event: AdmissionCheckpointEvent;
    if (row['kind'] === 'GM_ACCEPT') {
      if (verified.has(batchId)) return s.fail();
      const review = working.readInTransaction(db, source, batchId, rules),
        current = readDecision(db, review, rules),
        record = current.gmDecisionOrNull ?? s.fail();
      verifyExistingGroups(record.proposalOrNull ?? s.fail(), history);
      if (
        row['command_id'] !== record.request.commandId ||
        !decisions.some((d) => d['command_id'] === row['command_id'])
      )
        return s.fail();
      next = publicationCheckpoint(checkpoint, record);
      event = publicationEvent(checkpoint, next, record);
      verified.set(batchId, current);
    } else {
      const current = verified.get(batchId) ?? s.fail();
      if (current.playerDecisionOrNull !== null) return s.fail();
      const record = player.readInTransaction(db, current, history) ?? s.fail(),
        kind = record.request.decision === 'ACCEPT' ? 'PLAYER_ACCEPT' : 'PLAYER_DECLINE';
      if (
        row['kind'] !== kind ||
        row['command_id'] !== record.request.commandId ||
        !playerDecisions.some((d) => d['command_id'] === row['command_id'])
      )
        return s.fail();
      next = player.checkpoint(checkpoint, current, record);
      event = publicationEvent(checkpoint, next, record, kind);
      player.advance(history, record);
      verified.set(batchId, { ...current, playerDecisionOrNull: record });
    }
    if (!s.same(s.checked(row), event)) return s.fail();
    checkpoint = next;
    history.checkpoint = next;
  }
  if (!s.same(checkpoint, loadCampaignCheckpoint(db, source.scope.campaignId))) return s.fail();
  player.verifyLedger(db, source.scope.campaignId, history);
  return history;
}

export function readAdmissionDecision(
  db: Database.Database,
  scope: GmRequestReviewScope,
  batchId: string,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
): AdmissionDecisionRead {
  return s.read(db, scope.ownerDeviceId, () => {
    const source = readGmRequestReviewSource(db, scope, validate);
    const verified = verifyCampaignHistory(db, source, rules);
    return (
      verified.decisions.get(batchId) ??
      readDecision(db, working.readInTransaction(db, source, batchId, rules), rules)
    );
  });
}

/** Exact original-request lookup for authenticated peer delivery; absence is not a decision. */
export function readAdmissionDecisionByRequest(
  db: Database.Database,
  scope: GmRequestReviewScope,
  requestId: string,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
): AdmissionDecisionRead | null {
  return s.read(db, scope.ownerDeviceId, () => {
    const source = readGmRequestReviewSource(db, scope, validate),
      id = s.uuid(requestId);
    if (!source.queue.requests.some((r) => r.submittedRequest.requestId === id))
      return s.fail('NOT_FOUND');
    const history = verifyCampaignHistory(db, source, rules),
      rows = db
        .prepare(
          `SELECT admission_batch_id FROM campaign_admission_batch
       WHERE request_id=? OR json_extract(record_json,'$.initialState.requestId')=?
       OR json_extract(record_json,'$.request.payload.requestId')=?`,
        )
        .all(id, id, id) as Row[];
    if (rows.length > 1) return s.fail();
    if (rows.length === 0) {
      // A missing index must not turn an existing terminal/head anchor into NOT_READY.
      if (
        db
          .prepare(
            "SELECT 1 FROM campaign_admission_head WHERE json_extract(record_json,'$.requestId')=?",
          )
          .get(id) !== undefined ||
        db
          .prepare(
            "SELECT 1 FROM campaign_admission_gm_decision WHERE json_extract(record_json,'$.receipt.requestId')=?",
          )
          .get(id) !== undefined
      )
        return s.fail();
      return null;
    }
    const batchId = s.uuid(rows[0]!['admission_batch_id']),
      current =
        history.decisions.get(batchId) ??
        readDecision(db, working.readInTransaction(db, source, batchId, rules), rules);
    if (current.review.current.requestId !== id) return s.fail('FOREIGN_OWNER');
    return current;
  });
}

/** Compatibility callers without final-admission rules may operate only before any such journal exists. */
export function assertNoCampaignAdmissionEvidence(db: Database.Database): void {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  for (const table of CAMPAIGN_ADMISSION_TABLES)
    if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get() !== undefined)
      return s.fail('UNAVAILABLE');
}

/** One verified snapshot supplies both occupied places and proof of which original requests may be replaced. */
export function readCampaignAdmissionAvailability(
  db: Database.Database,
  scope: GmRequestReviewScope,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
) {
  return s.read(db, scope.ownerDeviceId, () => {
    const version = readAppliedMigrationVersion(db);
    if (version === 10 || version === 11) {
      // A real pre-admission installation can still contain the original SUBMIT.
      // Only the unchanged, empty CREATE checkpoint proves an empty import history.
      for (const table of CAMPAIGN_ADMISSION_TABLES)
        if (db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(table) !== undefined)
          return s.fail();
      const origin = readCampaignCreationOrigin(
          db,
          scope.gmLocalContextId,
          scope.campaignId,
          validate,
        ),
        current = readPausedCampaign(db, scope.gmLocalContextId, scope.campaignId);
      if (!s.same(origin.payload, current)) return s.fail();
      return {
        campaignRevision: 0,
        occupiedCampaignPlaceCount: 0,
        activePcCount: 0,
        releasedRequestIds: [] as string[],
        importedSources: [] as { sourceUuid: string; ownerDeviceId: string }[],
      };
    }
    if (version !== 12) return s.fail();
    const source = readGmRequestReviewSource(db, scope, validate),
      history = verifyCampaignHistory(db, source, rules),
      releasedRequestIds: string[] = [];
    const batches = db
      .prepare(
        `SELECT admission_batch_id FROM campaign_admission_batch
      WHERE campaign_id=? OR json_extract(record_json,'$.scope.campaignId')=?`,
      )
      .all(scope.campaignId, scope.campaignId) as Row[];
    const seen = new Set<string>();
    for (const row of batches) {
      const id = s.uuid(row['admission_batch_id']);
      if (seen.has(id)) return s.fail();
      seen.add(id);
      const current =
        history.decisions.get(id) ??
        readDecision(db, working.readInTransaction(db, source, id, rules), rules);
      if (
        current.gmDecisionOrNull?.request.decision === 'REJECT' ||
        current.playerDecisionOrNull?.request.decision === 'DECLINE'
      )
        releasedRequestIds.push(current.review.current.requestId);
    }
    // A missing batch must not hide a terminal refusal or manufacture release from an unverified row.
    const terminals = db
      .prepare(
        `SELECT admission_batch_id FROM campaign_admission_gm_decision
      WHERE campaign_id=? OR json_extract(record_json,'$.scope.campaignId')=?`,
      )
      .all(scope.campaignId, scope.campaignId) as Row[];
    if (terminals.some((row) => !seen.has(s.uuid(row['admission_batch_id'])))) return s.fail();
    return {
      campaignRevision: history.checkpoint.stateRevision,
      occupiedCampaignPlaceCount: history.occupiedCampaignPlaceCount,
      activePcCount: history.activePcCount,
      releasedRequestIds,
      importedSources: [...history.decisions.values()].flatMap((current) =>
        current.gmDecisionOrNull!.copies.map((copy) => ({
          sourceUuid: copy.sourceUuid,
          ownerDeviceId: copy.ownerDeviceId,
        })),
      ),
    };
  });
}

/** A single publication freezes the whole working prefix; no source row is ever updated. */
export function commitAdmissionGmDecision(
  db: Database.Database,
  scope: GmRequestReviewScope,
  value: Readonly<{
    request: AdmissionGmDecisionRequest;
    receiptId: string;
    timestamp: string;
    clientRequestJsonOrNull?: string | null;
  }>,
  validate: CampaignPrivateOwnerValidator,
  rules: AdmissionPublicationRules,
  allocateId: () => string,
  guard: NetworkStoreGuard<AdmissionDecisionRead>,
): Readonly<{ current: AdmissionDecisionRead; replayed: boolean }> {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const input = s.input(() =>
      s.object(value, [
        'request',
        'receiptId',
        'timestamp',
        ...('clientRequestJsonOrNull' in value ? ['clientRequestJsonOrNull'] : []),
      ]),
    ),
    request = s.input(() =>
      admissionGmDecisionRequestValue(JSON.parse(s.canonical(input['request'])) as unknown),
    ),
    clientRequestJsonOrNull = s.input(() => {
      const raw = input['clientRequestJsonOrNull'];
      if (raw === undefined || raw === null) return null;
      const json = s.text(raw),
        parsed: unknown = JSON.parse(json),
        binding = admissionGmClientBindingValue(parsed);
      if (
        s.canonical(parsed) !== json ||
        binding.contextId !== scope.gmLocalContextId ||
        binding.campaignId !== scope.campaignId ||
        binding.intentOrNull !== null ||
        !s.same(binding.decisionOrNull, request)
      )
        return s.fail('INVALID_INPUT');
      return json;
    });
  const replay = s.read(db, scope.ownerDeviceId, () => {
    // Presence only selects the transaction path; every new command verifies the
    // complete source/history inside its owning IMMEDIATE transaction below.
    if (
      s.at(db, 'campaign_admission_gm_decision', 'admission_batch_id', request.admissionBatchId) ===
      undefined
    )
      return null;
    const current = readAdmissionDecision(db, scope, request.admissionBatchId, validate, rules);
    if (current.gmDecisionOrNull === null) return s.fail();
    if (
      !s.same(current.gmDecisionOrNull.request, request) ||
      current.gmDecisionOrNull.clientRequestJsonOrNull !== clientRequestJsonOrNull
    )
      return s.fail('IDEMPOTENCY_CONFLICT');
    s.guarded(db, guard, current, 'REPLAY');
    return { current, replayed: true };
  });
  if (replay !== null) return replay;
  return s.safe(() => {
    const write = () => {
      const receiptId = s.uuid(input['receiptId']),
        timestamp = s.text(input['timestamp']);
      const source = readGmRequestReviewSource(db, scope, validate),
        history = verifyCampaignHistory(db, source, rules),
        current =
          history.decisions.get(request.admissionBatchId) ??
          readDecision(
            db,
            working.readInTransaction(db, source, request.admissionBatchId, rules),
            rules,
          ),
        review = current.review;
      if (
        !review.editable ||
        current.gmDecisionOrNull !== null ||
        request.campaignId !== scope.campaignId ||
        request.reviewRevision !== review.current.reviewRevision ||
        request.expectedCampaignRevision !==
          readRevisions(db, { entity: 'campaign', entityId: scope.campaignId }).stateRevision
      )
        return s.fail('STALE_REVISION');
      working.assertClientView(db, scope, clientRequestJsonOrNull);
      s.guarded(db, guard, current, 'APPLY');
      const beforeCheckpoint = loadCampaignCheckpoint(db, scope.campaignId);
      let publication: AdmissionProposal | null = null;
      let copies: readonly AdmissionPublishedCopy[] = [];
      if (request.decision === 'ACCEPT') {
        const preview = proposal(
          db,
          review,
          rules,
          review.current.copies.map(() => null),
        );
        if (preview.proposalChecksum !== request.previewChecksumOrNull)
          return s.fail('STALE_REVISION');
        verifyExistingGroups(preview, history);
        for (const copy of review.current.copies)
          if (
            db
              .prepare(
                'SELECT 1 FROM campaign_character_copy WHERE campaign_id=? AND source_uuid=?',
              )
              .get(scope.campaignId, copy.sourceUuid) !== undefined
          )
            return s.fail('IDEMPOTENCY_CONFLICT');
        const allocated: string[] = [],
          copyIds: string[] = [];
        const inventories: { instanceId: string; profileIdOrNull: string | null }[][] = [];
        const next = () => {
          const result = s.uuid(working.callSynchronous(allocateId));
          allocated.push(result);
          return result;
        };
        // All allocations share one synchronous guard over the same immutable source.
        s.guarded(
          db,
          () => {
            for (const diff of preview.fullCampaignCopyDiffs) {
              copyIds.push(next());
              inventories.push(
                diff.afterSheet.inventoryReview.entries.map((entry) => ({
                  instanceId: next(),
                  profileIdOrNull: entry.weaponProfileOrNull === null ? null : next(),
                })),
              );
            }
          },
          { review, request, input },
          'APPLY',
        );
        publication = proposal(db, review, rules, copyIds);
        if (previewChecksum(publication) !== preview.proposalChecksum)
          return s.fail('SOURCE_CHANGED');
        copies = publication.fullCampaignCopyDiffs.map((_diff, index) =>
          copyFromAllocations(review, publication!, index, inventories[index]!),
        );
        if (new Set(allocated).size !== allocated.length) return s.fail('IDEMPOTENCY_CONFLICT');
      }
      const record: StoredAdmissionGmDecision = {
        scope,
        request,
        clientRequestJsonOrNull,
        receipt: gmReceipt(review, request, publication, receiptId, timestamp),
        reviewStateSha256: s.sha(s.canonical(review.current)),
        proposalOrNull: publication,
        copies,
      };
      const ids = finalIds(record);
      if (new Set(ids).size !== ids.length) return s.fail('IDEMPOTENCY_CONFLICT');
      for (const id of ids) s.assertUnused(db, id);
      const before = s.changes(db),
        json = s.canonical(record);
      db.prepare('INSERT INTO campaign_admission_gm_decision VALUES (?,?,?,?,?,NULL,NULL,?,?)').run(
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
          'UPDATE campaign_admission_head SET terminal_command_id=?,terminal_record_sha256=? WHERE admission_batch_id=? AND terminal_command_id IS NULL AND terminal_record_sha256 IS NULL',
        )
        .run(request.commandId, s.sha(json), request.admissionBatchId);
      if (anchored.changes !== 1) return s.fail('SOURCE_CHANGED');
      let count = 2;
      for (const copy of copies) {
        const copyJson = s.canonical(copy);
        db.prepare('INSERT INTO campaign_character_copy VALUES (?,?,?,?,?)').run(
          copy.campaignCharacterId,
          scope.campaignId,
          copy.sourceUuid,
          'PROPOSED',
          copyJson,
        );
        db.prepare('INSERT INTO campaign_admission_copy VALUES (?,?,?,?,?,?,?)').run(
          copy.campaignCharacterId,
          scope.campaignId,
          request.admissionBatchId,
          copy.reviewCopyId,
          copy.sourceUuid,
          copyJson,
          s.sha(copyJson),
        );
        count += 2;
        for (const item of copy.inventoryInstances) {
          const itemJson = s.canonical(item);
          db.prepare('INSERT INTO campaign_admission_inventory VALUES (?,?,?,?,?,?)').run(
            item.instanceId,
            copy.campaignCharacterId,
            item.reviewItemId,
            item.weaponProfileOrNull?.profileId ?? null,
            itemJson,
            s.sha(itemJson),
          );
          count += 1;
        }
      }
      if (copies.length !== 0) {
        advanceRevisions(
          db,
          { entity: 'campaign', entityId: scope.campaignId },
          { stateChanged: true, projectionChanged: true, actorVisibilityChanged: true },
        );
        count += 1;
        const afterCheckpoint = publicationCheckpoint(beforeCheckpoint, record),
          event = publicationEvent(beforeCheckpoint, afterCheckpoint, record),
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
        count += 1;
      }
      if (!db.inTransaction || s.changes(db) !== before + count) return s.fail('SOURCE_CHANGED');
      appendGmAdmissionSourceInTransaction(db, scope, {
        kind: 'GM_DECISION',
        admissionBatchId: request.admissionBatchId,
        commandId: request.commandId,
        recordSha256: s.sha(json),
      });
      // The outer checkpoint owns its snapshot update. Validate our rows before that commit,
      // using the already replayed working prefix, whose rows this mutation never changes.
      const after = readDecision(
        db,
        working.withCurrentPresentation(db, { ...review, editable: false }),
        rules,
      );
      s.guarded(db, guard, after, 'APPLY');
      return { current: after, replayed: false };
    };
    return request.decision === 'ACCEPT'
      ? commitCampaignCheckpoint(db, scope.campaignId, write).result
      : db.transaction(write).immediate();
  });
}

/** Internal composition keeps every historical read in the caller's transaction. */
export const admissionDecisionStorage = {
  readHistory(
    db: Database.Database,
    scope: GmRequestReviewScope,
    validate: CampaignPrivateOwnerValidator,
    rules: AdmissionPublicationRules,
  ): AdmissionHistory {
    const source = readGmRequestReviewSource(db, scope, validate);
    return verifyCampaignHistory(db, source, rules);
  },
  event: publicationEvent,
};
