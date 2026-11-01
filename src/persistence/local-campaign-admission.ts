import type Database from 'better-sqlite3';
import {
  admissionControllerPreparationValue,
  admissionOwnerPublicationValue,
  admissionPlayerDecisionRequestValue,
  admissionPlayerDecisionReceiptValue,
  type AdmissionControllerPreparation,
  type AdmissionOwnerPublication,
  type AdmissionPlayerDecisionRequest,
  type AdmissionPlayerDecisionReceipt,
} from '@shared/campaign-admission-proposal.js';
import {
  networkApplicationStorage as s,
  commitLocalAdmissionNetworkMutation,
  readLocalNetworkHostPinAnchor,
  type LocalNetworkScope,
  type NetworkPublicIdentity,
  type NetworkStoreGuard,
  type LocalNetworkApplication,
  type LocalNetworkMutationInput,
} from './network-local-application.js';
import {
  localAdmissionTabStorage as tabs,
  readOwnedLocalNetworkTabAnchor,
  type LocalNetworkTab,
  type LocalNetworkTabEntryInput,
  type LocalNetworkTabCloseInput,
} from './network-local-tab.js';
import { admissionReviewStorage } from './campaign-admission-review.js';
import type { RevisionTriple } from './store.js';
import { readAppliedMigrationVersion } from './migrations/index.js';
import {
  admissionOwnerCommandValue,
  type AdmissionOwnerFormId,
} from '../shared/campaign-admission-presentation.js';

export interface LocalAdmissionPublicationRecord {
  readonly schemaVersion: 1;
  readonly scope: LocalNetworkScope;
  readonly originalTabId: string;
  readonly submitCommandId: string;
  readonly technicalSessionId: string;
  readonly hostIdentity: NetworkPublicIdentity;
  readonly publication: AdmissionOwnerPublication;
}
/** Only authenticated absence after fencing earlier execution leases permits a replacement intent. */
export interface AdmissionPlayerAbsenceProof {
  readonly operation: 'ADMISSION_PLAYER_DECISION_ABSENT';
  readonly commandId: string;
  readonly semanticBodySha256: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly campaignRevision: number;
  readonly requestId: string;
  readonly submitCommandId: string;
  readonly technicalSessionId: string;
  readonly fenced: true;
  /** Audits the authenticated transport epoch; never a global revision after host restart. */
  readonly generation: number;
  readonly code:
    'NOT_APPLIED' | 'STALE_REVISION' | 'CAPACITY_EXCEEDED' | 'FOREIGN_OWNER' | 'INVALID_INPUT';
}
export type LocalAdmissionEventPayload =
  | {
      readonly kind: 'INTENT';
      readonly request: AdmissionPlayerDecisionRequest;
      readonly additionalTabs: readonly LocalNetworkTabEntryInput[];
      readonly clientRequestJsonOrNull: string | null;
    }
  | { readonly kind: 'ACK'; readonly receipt: AdmissionPlayerDecisionReceipt }
  | { readonly kind: 'FENCED_ABSENT'; readonly proof: AdmissionPlayerAbsenceProof }
  | LocalAdmissionView
  | LocalAdmissionReturn;
export interface LocalAdmissionView {
  readonly kind: 'VIEW';
  readonly targetFormId: AdmissionOwnerFormId;
  readonly sourceRevisions: RevisionTriple;
  readonly clientRequestJson: string;
}
export interface LocalAdmissionReturn {
  readonly kind: 'RETURN';
  readonly mode: 'RESELECT' | 'MENU';
  readonly sourceRevisions: RevisionTriple;
  readonly sourceDraftRevision: number;
  readonly clientRequestJson: string;
  readonly additionalClosures: readonly LocalNetworkTabCloseInput[];
}
export interface LocalAdmissionEvent {
  readonly eventId: string;
  readonly eventIndex: number;
  readonly previousSha256: string;
  readonly payload: LocalAdmissionEventPayload;
}
export interface LocalAdmissionRead {
  readonly record: LocalAdmissionPublicationRecord;
  readonly events: readonly LocalAdmissionEvent[];
  readonly preparationOrNull: AdmissionControllerPreparation | null;
  readonly additionalTabs: readonly LocalNetworkTabEntryInput[];
  readonly pendingDecisionOrNull: AdmissionPlayerDecisionRequest | null;
  readonly receiptOrNull: AdmissionPlayerDecisionReceipt | null;
  readonly lastAbsenceOrNull: AdmissionPlayerAbsenceProof | null;
  readonly returnedOrNull: LocalAdmissionReturn | null;
}
type Row = Record<string, unknown>;
const digest = (value: unknown): string => s.sha(s.canonical(value));

export function validateAdmissionOwnerPublication(value: unknown): AdmissionOwnerPublication {
  const publication = admissionOwnerPublicationValue(value),
    { publicationChecksum, ...body } = publication;
  if (digest(body) !== publicationChecksum) return s.fail('INVALID_INPUT');
  if (publication.proposalOrNull !== null) {
    const { proposalChecksum, ...proposalBody } = publication.proposalOrNull;
    if (digest(proposalBody) !== proposalChecksum) return s.fail('INVALID_INPUT');
  }
  return publication;
}
function source(
  db: Database.Database,
  record: LocalAdmissionPublicationRecord,
  verifiedHistory?: ReturnType<typeof s.admissionHistory>,
) {
  const { scope, publication } = record,
    notice = publication.gmDecision,
    original = tabs.historyAnchor(db, scope.ownerDeviceId, scope.networkScopeId);
  if (original === null || original.tabId !== record.originalTabId) return s.fail('UNAVAILABLE');
  const entry = tabs.entryAnchor(db, scope.ownerDeviceId, original.entryCommandId) ?? s.fail();
  // An extra prepared tab may never become another batch's origin or create an origin cycle.
  if (entry.request.admissionEntry !== undefined) return s.fail('FOREIGN_OWNER');
  const history = verifiedHistory ?? s.admissionHistory(db, scope),
    snapshot = s.deliverySnapshot(history, record.submitCommandId),
    outbox = snapshot.outbox,
    current = snapshot.requestCurrentOrNull,
    pin = readLocalNetworkHostPinAnchor(db, scope.ownerDeviceId, notice.campaignId);
  if (
    outbox?.intent.operation !== 'SUBMIT' ||
    outbox.acknowledgementOrNull?.operation !== 'SUBMIT' ||
    current?.requestStatus !== 'IN_REVIEW' ||
    outbox.intent.requestId !== notice.requestId ||
    outbox.intent.batch.technicalSessionId !== record.technicalSessionId ||
    notice.requestOwnerDeviceId !== scope.ownerDeviceId ||
    outbox.intent.batch.campaignProof.campaignId !== notice.campaignId ||
    current.proof.submittedReceipt.commandId !== record.submitCommandId ||
    pin === null ||
    !s.same(pin.identity, record.hostIdentity)
  )
    return s.fail('FOREIGN_OWNER');
  const lane = current.proof.laneProvenance;
  if (
    lane === null ||
    (lane.kind === 'SUBMITTED_BATCH'
      ? lane.localControllerSeatId
      : lane.receipt.binding.localControllerSeatId) !== original.tabId
  )
    return s.fail('FOREIGN_OWNER');
  const diffs = publication.proposalOrNull?.fullCampaignCopyDiffs,
    submittedCandidates = outbox.intent.batch.candidates;
  if (
    diffs !== undefined &&
    (diffs.length !== submittedCandidates.length ||
      diffs.some(
        (copy, i) =>
          copy.sourceUuid !== submittedCandidates[i]!.descriptor.sourceUuid ||
          copy.sourceSnapshotChecksum !== submittedCandidates[i]!.descriptor.sourceChecksum,
      ))
  )
    return s.fail('FOREIGN_OWNER');
  return { original, snapshot, history };
}
function recordValue(value: unknown): LocalAdmissionPublicationRecord {
  const row = s.object(value, [
      'schemaVersion',
      'scope',
      'originalTabId',
      'submitCommandId',
      'technicalSessionId',
      'hostIdentity',
      'publication',
    ]),
    scope = s.object(row['scope'], ['ownerDeviceId', 'networkScopeId']);
  if (row['schemaVersion'] !== 1) return s.fail();
  return {
    schemaVersion: 1,
    scope: {
      ownerDeviceId: s.uuid(scope['ownerDeviceId']),
      networkScopeId: s.uuid(scope['networkScopeId']),
    },
    originalTabId: s.uuid(row['originalTabId']),
    submitCommandId: s.text(row['submitCommandId']),
    technicalSessionId: s.uuid(row['technicalSessionId']),
    hostIdentity: s.identity(row['hostIdentity']),
    publication: validateAdmissionOwnerPublication(row['publication']),
  };
}
function absenceValue(value: unknown): AdmissionPlayerAbsenceProof {
  const row = s.object(value, [
    'operation',
    'commandId',
    'semanticBodySha256',
    'campaignId',
    'admissionBatchId',
    'campaignRevision',
    'requestId',
    'submitCommandId',
    'technicalSessionId',
    'fenced',
    'generation',
    'code',
  ]);
  if (
    row['operation'] !== 'ADMISSION_PLAYER_DECISION_ABSENT' ||
    row['fenced'] !== true ||
    s.integer(row['generation']) < 1 ||
    ![
      'NOT_APPLIED',
      'STALE_REVISION',
      'CAPACITY_EXCEEDED',
      'FOREIGN_OWNER',
      'INVALID_INPUT',
    ].includes(s.text(row['code']))
  )
    return s.fail();
  return {
    operation: 'ADMISSION_PLAYER_DECISION_ABSENT',
    commandId: s.text(row['commandId']),
    semanticBodySha256: s.hash(row['semanticBodySha256']),
    campaignId: s.uuid(row['campaignId']),
    admissionBatchId: s.uuid(row['admissionBatchId']),
    campaignRevision: s.integer(row['campaignRevision']),
    requestId: s.uuid(row['requestId']),
    submitCommandId: s.text(row['submitCommandId']),
    technicalSessionId: s.uuid(row['technicalSessionId']),
    fenced: true,
    generation: s.integer(row['generation']),
    code: row['code'] as AdmissionPlayerAbsenceProof['code'],
  };
}
function payloadValue(
  value: unknown,
  publication: AdmissionOwnerPublication,
): LocalAdmissionEventPayload {
  const row = s.object(value);
  switch (row['kind']) {
    case 'INTENT': {
      s.object(row, ['kind', 'request', 'additionalTabs', 'clientRequestJsonOrNull']);
      if (!Array.isArray(row['additionalTabs'])) return s.fail();
      return {
        kind: 'INTENT',
        request: admissionPlayerDecisionRequestValue(row['request']),
        additionalTabs: row['additionalTabs'].map((v) => tabs.parseEntry(v)),
        clientRequestJsonOrNull:
          row['clientRequestJsonOrNull'] === null ? null : s.text(row['clientRequestJsonOrNull']),
      };
    }
    case 'ACK':
      s.object(row, ['kind', 'receipt']);
      return {
        kind: 'ACK',
        receipt: admissionPlayerDecisionReceiptValue(row['receipt'], publication),
      };
    case 'FENCED_ABSENT':
      s.object(row, ['kind', 'proof']);
      return { kind: 'FENCED_ABSENT', proof: absenceValue(row['proof']) };
    case 'RETURN': {
      return returnValue(row);
    }
    case 'VIEW':
      return viewValue(row);
    default:
      return s.fail();
  }
}
export function localAdmissionForm(state: LocalAdmissionRead): AdmissionOwnerFormId {
  for (const event of [...state.events].reverse()) {
    if (event.payload.kind === 'VIEW') return event.payload.targetFormId;
    if (event.payload.kind === 'ACK')
      return event.payload.receipt.decision === 'ACCEPT' ? 'NET-006' : 'NET-007';
  }
  return state.record.publication.gmDecision.decision === 'REJECT' ? 'NET-007' : 'NET-027';
}
function viewValue(value: unknown): LocalAdmissionView {
  const row = s.object(value, ['kind', 'targetFormId', 'sourceRevisions', 'clientRequestJson']);
  if (
    row['kind'] !== 'VIEW' ||
    !['NET-027', 'NET-006', 'NET-007'].includes(s.text(row['targetFormId']))
  )
    return s.fail();
  const view: LocalAdmissionView = {
    kind: 'VIEW',
    targetFormId: row['targetFormId'] as AdmissionOwnerFormId,
    sourceRevisions: s.vector(row['sourceRevisions']),
    clientRequestJson: s.text(row['clientRequestJson']),
  };
  viewNavigation(view);
  return view;
}
function viewNavigation(view: LocalAdmissionView) {
  const nav = s.object(JSON.parse(view.clientRequestJson) as unknown, [
    'messageType',
    'protocolVersion',
    'navigationRequestId',
    'sourceFormId',
    'actionKey',
    'expectedProjectionRevision',
  ]);
  const target = (
    {
      'NET-006::CTA::001': 'NET-027',
      'NET-007::CTA::001': 'NET-027',
      'NET-027::CTA::001': 'NET-006',
      'NET-027::CTA::002': 'NET-007',
    } as Record<string, string>
  )[s.text(nav['actionKey'])];
  if (
    s.canonical(nav) !== view.clientRequestJson ||
    nav['messageType'] !== 'navigation.form-action' ||
    nav['protocolVersion'] !== 2 ||
    target !== view.targetFormId ||
    !s.text(nav['actionKey']).startsWith(`${s.text(nav['sourceFormId'])}::`) ||
    nav['expectedProjectionRevision'] !== view.sourceRevisions.projectionRevision
  )
    return s.fail();
  return {
    eventId: `navigation:${s.text(nav['navigationRequestId'])}`,
    sourceFormId: nav['sourceFormId'],
  };
}
function returnValue(value: unknown): LocalAdmissionReturn {
  const row = s.object(value, [
    'kind',
    'mode',
    'sourceRevisions',
    'sourceDraftRevision',
    'clientRequestJson',
    'additionalClosures',
  ]);
  if (
    row['kind'] !== 'RETURN' ||
    (row['mode'] !== 'RESELECT' && row['mode'] !== 'MENU') ||
    !Array.isArray(row['additionalClosures'])
  )
    return s.fail();
  const result: LocalAdmissionReturn = {
    kind: 'RETURN',
    mode: row['mode'],
    sourceRevisions: s.vector(row['sourceRevisions']),
    sourceDraftRevision: s.integer(row['sourceDraftRevision']),
    clientRequestJson: s.text(row['clientRequestJson']),
    additionalClosures: row['additionalClosures'].map((v) => tabs.parseClose(v)),
  };
  returnNavigation(result);
  return result;
}
function returnNavigation(value: LocalAdmissionReturn): string {
  const nav = s.object(JSON.parse(value.clientRequestJson) as unknown, [
    'messageType',
    'protocolVersion',
    'navigationRequestId',
    'sourceFormId',
    'actionKey',
    'expectedProjectionRevision',
  ]);
  if (
    s.canonical(nav) !== value.clientRequestJson ||
    nav['messageType'] !== 'navigation.form-action' ||
    nav['protocolVersion'] !== 2 ||
    nav['sourceFormId'] !== 'NET-007' ||
    nav['actionKey'] !== (value.mode === 'RESELECT' ? 'NET-007::CTA::002' : 'NET-007::CTA::003') ||
    nav['expectedProjectionRevision'] !== value.sourceRevisions.projectionRevision
  )
    return s.fail();
  return `navigation:${s.text(nav['navigationRequestId'])}`;
}
function reduce(current: LocalAdmissionRead, event: LocalAdmissionEvent): LocalAdmissionRead {
  const { record, pendingDecisionOrNull: pending, receiptOrNull: receipt } = current,
    publication = record.publication,
    payload = event.payload;
  if (current.returnedOrNull !== null) return s.fail('UNAVAILABLE');
  if (payload.kind === 'VIEW') {
    const nav = viewNavigation(payload);
    if (
      pending !== null ||
      nav.eventId !== event.eventId ||
      nav.sourceFormId !== localAdmissionForm(current) ||
      publication.proposalOrNull === null ||
      receipt === null ||
      (payload.targetFormId === 'NET-006' && receipt.decision !== 'ACCEPT') ||
      (payload.targetFormId === 'NET-007' && receipt.decision !== 'DECLINE')
    )
      return s.fail('UNAVAILABLE');
    return { ...current, events: [...current.events, event] };
  }
  if (payload.kind === 'RETURN') {
    if (
      pending !== null ||
      (publication.gmDecision.decision !== 'REJECT' && receipt?.decision !== 'DECLINE')
    )
      return s.fail('UNAVAILABLE');
    if (
      event.eventId !== returnNavigation(payload) ||
      payload.additionalClosures.length !== current.additionalTabs.length
    )
      return s.fail();
    const ids: string[] = [event.eventId];
    payload.additionalClosures.forEach((closure, i) => {
      const entry = current.additionalTabs[i]!;
      if (
        closure.ownerDeviceId !== record.scope.ownerDeviceId ||
        closure.networkScopeId !== entry.networkScopeId ||
        closure.applicationExit !== undefined ||
        !s.same(closure.expectedRevisions, s.zero())
      )
        return s.fail();
      ids.push(closure.closeCommandId, closure.closeReceiptId);
    });
    if (new Set(ids).size !== ids.length) return s.fail('IDEMPOTENCY_CONFLICT');
    return { ...current, events: [...current.events, event], returnedOrNull: payload };
  }
  if (receipt !== null || publication.gmDecision.decision !== 'ACCEPT')
    return s.fail('UNAVAILABLE');
  let next = { ...current, events: [...current.events, event] };
  if (payload.kind === 'INTENT') {
    const proposal = publication.proposalOrNull ?? s.fail(),
      request = payload.request;
    if (
      pending !== null ||
      event.eventId !== request.commandId ||
      request.campaignId !== proposal.campaignId ||
      request.admissionBatchId !== proposal.admissionBatchId ||
      request.proposalRevision !== proposal.proposalRevision ||
      request.proposalChecksum !== proposal.proposalChecksum ||
      current.events.some(
        (e) => e.payload.kind === 'INTENT' && e.payload.request.commandId === request.commandId,
      )
    )
      return s.fail('IDEMPOTENCY_CONFLICT');
    if (payload.clientRequestJsonOrNull !== null) {
      const browser = admissionOwnerCommandValue(
          JSON.parse(payload.clientRequestJsonOrNull) as unknown,
        ),
        p = browser.payload;
      if (
        s.canonical(browser) !== payload.clientRequestJsonOrNull ||
        browser.commandId !== request.commandId ||
        p['networkScopeId'] !== record.scope.networkScopeId ||
        p['requestId'] !== publication.gmDecision.requestId ||
        p['campaignId'] !== request.campaignId ||
        p['admissionBatchId'] !== request.admissionBatchId ||
        p['proposalRevision'] !== request.proposalRevision ||
        p['proposalChecksum'] !== request.proposalChecksum ||
        p['expectedCampaignRevision'] !== request.expectedCampaignRevision ||
        p['decision'] !== request.decision
      )
        return s.fail('FOREIGN_OWNER');
    }
    if (request.decision === 'ACCEPT') {
      const prep = admissionControllerPreparationValue(request.controllerPreparationOrNull);
      if (
        prep.ownerDeviceId !== record.scope.ownerDeviceId ||
        prep.requestId !== publication.gmDecision.requestId ||
        prep.controllerBindings[0]!.localControllerSeatId !== record.originalTabId ||
        prep.controllerBindings.length !== proposal.fullCampaignCopyDiffs.length ||
        prep.controllerBindings.some(
          (binding, i) =>
            binding.campaignCharacterId !==
            proposal.fullCampaignCopyDiffs[i]!.campaignCharacterIdOrNull,
        )
      )
        return s.fail('FOREIGN_OWNER');
      if (current.preparationOrNull === null) {
        if (payload.additionalTabs.length !== prep.controllerBindings.length - 1) return s.fail();
        const ids: string[] = [prep.preparationId];
        for (const [i, entry] of payload.additionalTabs.entries()) {
          const expected = prep.controllerBindings[i + 1]!;
          if (
            entry.ownerDeviceId !== record.scope.ownerDeviceId ||
            entry.sourceContextId !== record.originalTabId ||
            entry.tabId !== expected.localControllerSeatId ||
            !s.same(entry.admissionEntry, {
              schemaVersion: 1,
              preparationId: prep.preparationId,
              requestId: prep.requestId,
              admissionBatchId: prep.admissionBatchId,
              proposalChecksum: prep.proposalChecksum,
              campaignCharacterId: expected.campaignCharacterId,
            })
          )
            return s.fail();
          ids.push(entry.tabId, entry.networkScopeId, entry.entryCommandId, entry.entryReceiptId);
        }
        if (new Set(ids).size !== ids.length || ids.includes(event.eventId)) return s.fail();
        next = { ...next, preparationOrNull: prep, additionalTabs: payload.additionalTabs };
      } else if (!s.same(current.preparationOrNull, prep) || payload.additionalTabs.length !== 0)
        return s.fail();
    } else if (payload.additionalTabs.length !== 0) return s.fail();
    return { ...next, pendingDecisionOrNull: request, lastAbsenceOrNull: null };
  }
  if (pending === null) return s.fail();
  if (payload.kind === 'FENCED_ABSENT') {
    const p = payload.proof;
    if (
      p.commandId !== pending.commandId ||
      p.semanticBodySha256 !== digest(pending) ||
      p.campaignId !== pending.campaignId ||
      p.admissionBatchId !== pending.admissionBatchId ||
      p.requestId !== publication.gmDecision.requestId ||
      p.submitCommandId !== record.submitCommandId ||
      p.technicalSessionId !== record.technicalSessionId
    )
      return s.fail();
    return { ...next, pendingDecisionOrNull: null, lastAbsenceOrNull: p };
  }
  const ack = payload.receipt;
  if (
    ack.commandId !== pending.commandId ||
    ack.decision !== pending.decision ||
    ack.campaignRevision !== pending.expectedCampaignRevision + 1 ||
    (ack.decision === 'ACCEPT' &&
      !s.same(
        ack.controllerProofOrNull?.controllerBindings,
        pending.controllerPreparationOrNull?.controllerBindings,
      ))
  )
    return s.fail();
  return { ...next, pendingDecisionOrNull: null, receiptOrNull: ack, lastAbsenceOrNull: null };
}
function readJournal(
  db: Database.Database,
  scope: LocalNetworkScope,
  requestId: string,
): LocalAdmissionRead | null {
  const row = s.at(db, 'local_admission_publication', 'request_id', requestId);
  if (row === undefined) return null;
  const record = recordValue(s.checked(row));
  if (
    !s.same(scope, record.scope) ||
    row['owner_device_id'] !== scope.ownerDeviceId ||
    row['network_scope_id'] !== scope.networkScopeId
  )
    return s.fail('FOREIGN_OWNER');
  if (
    record.publication.gmDecision.requestId !== requestId ||
    record.publication.gmDecision.admissionBatchId !== row['admission_batch_id']
  )
    return s.fail();
  let current: LocalAdmissionRead = {
      record,
      events: [],
      preparationOrNull: null,
      additionalTabs: [],
      pendingDecisionOrNull: null,
      receiptOrNull: null,
      lastAbsenceOrNull: null,
      returnedOrNull: null,
    },
    previous = digest(record);
  const rows = db
    .prepare('SELECT * FROM local_admission_event WHERE request_id=? ORDER BY event_index')
    .all(requestId) as Row[];
  for (const [i, stored] of rows.entries()) {
    const value = s.object(s.checked(stored), [
        'eventId',
        'eventIndex',
        'previousSha256',
        'payload',
      ]),
      event: LocalAdmissionEvent = {
        eventId: s.text(value['eventId']),
        eventIndex: s.integer(value['eventIndex']),
        previousSha256: s.hash(value['previousSha256']),
        payload: payloadValue(value['payload'], record.publication),
      };
    if (
      event.eventIndex !== i + 1 ||
      stored['event_index'] !== event.eventIndex ||
      stored['event_id'] !== event.eventId ||
      event.previousSha256 !== previous
    )
      return s.fail();
    const preparationId =
      event.payload.kind === 'INTENT' && current.preparationOrNull === null
        ? (event.payload.request.controllerPreparationOrNull?.preparationId ?? null)
        : null;
    if (stored['preparation_id'] !== preparationId) return s.fail();
    current = reduce(current, event);
    previous = digest(event);
  }
  if (
    row['event_index'] !== rows.length ||
    row['head_event_id'] !== (current.events.at(-1)?.eventId ?? null) ||
    row['head_sha256'] !== previous
  )
    return s.fail();
  return current;
}
function mirrorIdentity(
  record: LocalAdmissionPublicationRecord,
  event: LocalAdmissionEvent | null,
) {
  const eventId =
    event === null
      ? `admission-publication:${record.publication.gmDecision.requestId}`
      : `admission-event:${event.eventId}`;
  return { eventId, receiptId: `${eventId}:receipt` };
}
function mirrorInput(
  record: LocalAdmissionPublicationRecord,
  event: LocalAdmissionEvent | null,
  base: RevisionTriple & { readonly draftRevision: number },
): LocalNetworkMutationInput {
  const identity = mirrorIdentity(record, event),
    returned = event?.payload.kind === 'RETURN' ? event.payload : null,
    requestId = record.publication.gmDecision.requestId;
  return {
    ...record.scope,
    ...identity,
    expectedRevisions: s.vectorOf(base),
    expectedDraftRevision: base.draftRevision,
    clientRequestJsonOrNull:
      returned?.clientRequestJson ??
      (event?.payload.kind === 'VIEW'
        ? event.payload.clientRequestJson
        : event?.payload.kind === 'INTENT'
          ? event.payload.clientRequestJsonOrNull
          : null),
    mutation:
      returned === null
        ? {
            kind: 'ADMISSION_ADVANCE',
            requestId,
            ownerEventIdOrNull: event?.eventId ?? null,
            ownerSha256: digest(event ?? record),
          }
        : {
            kind: 'ADMISSION_RETURN',
            requestId,
            returnEventId: event!.eventId,
            returnEventSha256: digest(event),
            mode: returned.mode,
          },
  };
}
function mirror(
  db: Database.Database,
  state: LocalAdmissionRead,
  eventId: string | null,
  base: RevisionTriple & { readonly draftRevision: number },
): void {
  const event =
    eventId === null ? null : (state.events.find((e) => e.eventId === eventId) ?? s.fail());
  commitLocalAdmissionNetworkMutation(db, mirrorInput(state.record, event, base));
}
/** One-way historical proof: no full owner, network or tab reader is called from this leaf. */
export function validateLocalAdmissionNetworkEvent(
  db: Database.Database,
  base: LocalNetworkApplication,
  input: LocalNetworkMutationInput,
): void {
  createLocalAdmissionNetworkVerifier(db)(base, input);
}
/** A single synchronous history replay has no callbacks or writes; discard this cache with it. */
export function createLocalAdmissionNetworkVerifier(db: Database.Database) {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  const journals = new Map<string, LocalAdmissionRead>(),
    before = s.changes(db);
  return (base: LocalNetworkApplication, input: LocalNetworkMutationInput): void => {
    if (!db.inTransaction || s.changes(db) !== before) return s.fail('SOURCE_CHANGED');
    const change = input.mutation;
    if (change.kind !== 'ADMISSION_ADVANCE' && change.kind !== 'ADMISSION_RETURN')
      return s.fail('INVALID_INPUT');
    let state = journals.get(change.requestId);
    if (state === undefined) {
      state =
        readJournal(
          db,
          { ownerDeviceId: input.ownerDeviceId, networkScopeId: input.networkScopeId },
          change.requestId,
        ) ?? s.fail();
      journals.set(change.requestId, state);
    }
    const record = state.record,
      notice = record.publication.gmDecision,
      eventId =
        change.kind === 'ADMISSION_RETURN' ? change.returnEventId : change.ownerEventIdOrNull,
      event =
        eventId === null ? null : (state.events.find((e) => e.eventId === eventId) ?? s.fail());
    if (
      record.originalTabId !== base.tabId ||
      record.scope.ownerDeviceId !== base.ownerDeviceId ||
      record.scope.networkScopeId !== base.networkScopeId ||
      base.requestOrNull?.requestId !== notice.requestId ||
      base.requestOrNull.submitCommandId !== record.submitCommandId ||
      base.requestReviewOrNull?.requestStatus !== 'IN_REVIEW' ||
      base.sessionOrNull?.campaignProof.campaignId !== notice.campaignId ||
      notice.requestOwnerDeviceId !== base.ownerDeviceId ||
      !s.same(input, mirrorInput(record, event, base))
    )
      return s.fail('FOREIGN_OWNER');
    if (
      event?.payload.kind === 'RETURN' &&
      (!s.same(event.payload.sourceRevisions, s.vectorOf(base)) ||
        event.payload.sourceDraftRevision !== base.draftRevision)
    )
      return s.fail('STALE_REVISION');
    if (event?.payload.kind === 'VIEW' && !s.same(event.payload.sourceRevisions, s.vectorOf(base)))
      return s.fail('STALE_REVISION');
    if (
      event?.payload.kind === 'INTENT' &&
      event.payload.clientRequestJsonOrNull !== null &&
      !s.same(
        admissionOwnerCommandValue(JSON.parse(event.payload.clientRequestJsonOrNull) as unknown)
          .expectedRevisions,
        s.vectorOf(base),
      )
    )
      return s.fail('STALE_REVISION');
  };
}
function readInTransaction(
  db: Database.Database,
  scope: LocalNetworkScope,
  requestId: string,
): LocalAdmissionRead | null {
  return readWithSource(db, scope, requestId)?.current ?? null;
}
function readWithSource(
  db: Database.Database,
  scope: LocalNetworkScope,
  requestId: string,
  verifiedHistory?: ReturnType<typeof s.admissionHistory>,
) {
  const current = readJournal(db, scope, requestId);
  if (current === null) return null;
  const originalSource = source(db, current.record, verifiedHistory),
    { history } = originalSource;
  const mirrorEvents = [null, ...current.events] as const,
    actualMirrors = history.events.filter(
      (e) =>
        (e.input.mutation.kind === 'ADMISSION_ADVANCE' ||
          e.input.mutation.kind === 'ADMISSION_RETURN') &&
        e.input.mutation.requestId === requestId,
    );
  if (actualMirrors.length !== mirrorEvents.length) return s.fail();
  for (const [index, event] of mirrorEvents.entries()) {
    const actual = actualMirrors[index]!;
    if (
      !s.same(
        actual.input,
        mirrorInput(current.record, event, {
          ...actual.input.expectedRevisions,
          draftRevision: actual.input.expectedDraftRevision,
        }),
      )
    )
      return s.fail();
  }
  const preparationEvent = current.events.find(
      (e) => e.payload.kind === 'INTENT' && e.payload.additionalTabs.length !== 0,
    ),
    preparationSource =
      preparationEvent === undefined
        ? null
        : history.events.find(
            (e) => e.input.eventId === mirrorIdentity(current.record, preparationEvent).eventId,
          )?.input.expectedRevisions;
  for (const [i, entry] of current.additionalTabs.entries()) {
    const actual = tabs.entryAnchor(db, scope.ownerDeviceId, entry.entryCommandId);
    if (
      actual === null ||
      !s.same(actual.request, entry) ||
      !s.same(entry.sourceRevisions, preparationSource)
    )
      return s.fail();
    if (current.returnedOrNull === null) {
      if (
        actual.currentTab?.lifecycleState !== 'UNBOUND' ||
        !s.same(s.vectorOf(actual.currentTab), s.zero())
      )
        return s.fail();
    } else {
      const closure = current.returnedOrNull.additionalClosures[i]!,
        closed = actual.closureReceiptOrNull;
      if (
        actual.currentTab !== null ||
        closed === null ||
        closed.closeCommandId !== closure.closeCommandId ||
        closed.closeReceiptId !== closure.closeReceiptId ||
        !s.same(closed.sourceRevisions, closure.expectedRevisions) ||
        closed.activePointerCleared
      )
        return s.fail();
    }
    // Prepared seats carry no legacy application history and never obtain authority from UNBOUND.
    if (
      db
        .prepare('SELECT 1 FROM local_network_application_event WHERE network_scope_id=?')
        .get(entry.networkScopeId) !== undefined
    )
      return s.fail();
  }
  return { current, source: originalSource };
}
export function readLocalAdmission(
  db: Database.Database,
  scope: LocalNetworkScope,
  requestId: string,
): LocalAdmissionRead | null {
  return s.read(db, scope.ownerDeviceId, () => readInTransaction(db, scope, s.text(requestId)));
}
/** Resolve a prepared tab only through its original owner's complete, authenticated journal. */
export function readLocalAdmissionPresentation(db: Database.Database, scope: LocalNetworkScope) {
  return readPresentation(db, scope);
}
/** Receipt and owner overlay are checked against one complete history before either is sent. */
export function readLocalAdmissionDelivery(
  db: Database.Database,
  scope: LocalNetworkScope,
  commandId?: string,
) {
  const { delivery, observed } = s.readDeliveryWith(
    db,
    scope,
    commandId === undefined ? { kind: 'CURRENT_REQUEST' } : { kind: 'COMMAND', commandId },
    (history) => readPresentation(db, scope, history),
  );
  return { delivery, presentation: observed };
}
function readPresentation(
  db: Database.Database,
  scope: LocalNetworkScope,
  verifiedRootHistory?: ReturnType<typeof s.admissionHistory>,
) {
  if (readAppliedMigrationVersion(db) < 12) return null;
  return s.read(db, scope.ownerDeviceId, () => {
    const tab =
      readOwnedLocalNetworkTabAnchor(db, scope.ownerDeviceId, scope.networkScopeId) ??
      s.fail('UNAVAILABLE');
    const entry = tabs.entryAnchor(db, scope.ownerDeviceId, tab.entryCommandId) ?? s.fail();
    const extra = entry.request.admissionEntry;
    let rootScope = scope,
      requestId: string | null,
      verifiedHistory: ReturnType<typeof s.admissionHistory> | undefined;
    if (extra !== undefined) {
      const row =
        s.at(db, 'local_admission_publication', 'request_id', extra.requestId) ?? s.fail();
      const record = recordValue(s.checked(row));
      if (record.scope.ownerDeviceId !== scope.ownerDeviceId) return s.fail('FOREIGN_OWNER');
      rootScope = record.scope;
      requestId = extra.requestId;
    } else {
      const history = verifiedRootHistory ?? s.admissionHistory(db, scope);
      verifiedHistory = history;
      const last = history.events.at(-1)?.input.mutation;
      requestId =
        history.current.requestOrNull?.requestId ??
        (last?.kind === 'ADMISSION_RETURN' ? last.requestId : null);
    }
    if (requestId === null) return null;
    // No await or write separates discovery from replay in this SQL snapshot.
    const loaded = readWithSource(db, rootScope, requestId, verifiedHistory);
    if (loaded === null) {
      if (extra !== undefined) return s.fail();
      return null;
    }
    if (extra !== undefined && !loaded.current.additionalTabs.some((v) => s.same(v, entry.request)))
      return s.fail('FOREIGN_OWNER');
    return { admission: loaded.current, application: loaded.source.history.current, tab };
  });
}
export function readLocalAdmissionByEvent(
  db: Database.Database,
  scope: LocalNetworkScope,
  eventId: string,
): LocalAdmissionRead | null {
  if (readAppliedMigrationVersion(db) < 12) return null;
  return s.read(db, scope.ownerDeviceId, () => {
    const row = s.at(db, 'local_admission_event', 'event_id', s.text(eventId));
    if (row === undefined) return null;
    const tab = readOwnedLocalNetworkTabAnchor(db, scope.ownerDeviceId, scope.networkScopeId);
    if (tab !== null) {
      const entry = tabs.entryAnchor(db, scope.ownerDeviceId, tab.entryCommandId);
      if (entry?.request.admissionEntry !== undefined) {
        // A common owner does not establish a claim on another tab's journal.
        const presentation = readLocalAdmissionPresentation(db, scope) ?? s.fail();
        if (presentation.admission.record.publication.gmDecision.requestId !== row['request_id'])
          return s.fail('FOREIGN_OWNER');
        return presentation.admission;
      }
    }
    return readInTransaction(db, scope, s.text(row['request_id']));
  });
}
/** A completed MENU return is replayable only while it remains the owned root's current exit. */
export function readLocalAdmissionMenuReturn(
  db: Database.Database,
  ownerDeviceId: string,
  navigationRequestId: string,
): LocalAdmissionRead | null {
  if (readAppliedMigrationVersion(db) < 12) return null;
  return s.read(db, ownerDeviceId, () => {
    const row = s.at(
      db,
      'local_admission_event',
      'event_id',
      `navigation:${s.text(navigationRequestId)}`,
    );
    if (row === undefined) return null;
    const publication =
      s.at(db, 'local_admission_publication', 'request_id', s.text(row['request_id'])) ?? s.fail();
    const record = recordValue(s.checked(publication));
    if (record.scope.ownerDeviceId !== ownerDeviceId) return s.fail('FOREIGN_OWNER');
    const presentation = readLocalAdmissionPresentation(db, record.scope);
    const state = presentation?.admission;
    if (state?.returnedOrNull?.mode !== 'MENU') return null;
    const nav = JSON.parse(state.returnedOrNull.clientRequestJson) as {
      navigationRequestId: string;
    };
    return nav.navigationRequestId === navigationRequestId ? state : null;
  });
}
export function navigateLocalAdmission(
  db: Database.Database,
  scope: LocalNetworkScope,
  requestId: string,
  value: LocalAdmissionView,
  guard: NetworkStoreGuard<LocalAdmissionRead>,
): LocalAdmissionRead {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const payload = s.input(() => viewValue(JSON.parse(s.canonical(value)) as unknown)),
    id = viewNavigation(payload).eventId;
  return s.safe(() =>
    db
      .transaction(() => {
        s.schema(db);
        s.owner(db, scope.ownerDeviceId);
        const loaded = readWithSource(db, scope, requestId) ?? s.fail('UNAVAILABLE'),
          state = loaded.current;
        const known = state.events.find((e) => e.eventId === id);
        if (known !== undefined) {
          if (!s.same(known.payload, payload)) return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, state, 'REPLAY');
          return state;
        }
        if (!s.same(payload.sourceRevisions, s.vectorOf(loaded.source.history.current)))
          return s.fail('STALE_REVISION');
        s.guarded(db, guard, state, 'APPLY');
        const before = s.changes(db);
        append(db, state, id, payload);
        if (s.changes(db) !== before + 2) return s.fail('SOURCE_CHANGED');
        mirror(
          db,
          readJournal(db, scope, requestId) ?? s.fail(),
          id,
          loaded.source.history.current,
        );
        const saved = readInTransaction(db, scope, requestId) ?? s.fail();
        s.guarded(db, guard, saved, 'APPLY');
        return saved;
      })
      .immediate(),
  );
}
export function receiveLocalAdmissionPublication(
  db: Database.Database,
  scope: LocalNetworkScope,
  authenticatedHost: NetworkPublicIdentity,
  value: AdmissionOwnerPublication,
  guard: NetworkStoreGuard<LocalAdmissionRead>,
): LocalAdmissionRead {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const publication = s.input(() =>
      validateAdmissionOwnerPublication(JSON.parse(s.canonical(value)) as unknown),
    ),
    hostIdentity = structuredClone(s.input(() => s.identity(authenticatedHost)));
  return s.safe(() =>
    db
      .transaction(() => {
        s.schema(db);
        s.owner(db, scope.ownerDeviceId);
        const requestId = publication.gmDecision.requestId,
          known = readInTransaction(db, scope, requestId);
        if (known !== null) {
          if (
            !s.same(known.record.publication, publication) ||
            !s.same(known.record.hostIdentity, hostIdentity)
          )
            return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, known, 'REPLAY');
          return known;
        }
        const history = s.admissionHistory(db, scope),
          snapshot = s.deliverySnapshot(
            history,
            history.current.requestOrNull?.submitCommandId ?? null,
          ),
          submit = snapshot.outbox;
        if (submit?.intent.operation !== 'SUBMIT' || submit.intent.requestId !== requestId)
          return s.fail('UNAVAILABLE');
        const record: LocalAdmissionPublicationRecord = {
          schemaVersion: 1,
          scope: { ...scope },
          originalTabId: snapshot.current.tabId,
          submitCommandId: submit.intent.commandId,
          technicalSessionId: submit.intent.batch.technicalSessionId,
          hostIdentity,
          publication,
        };
        source(db, record, history);
        const state: LocalAdmissionRead = {
          record,
          events: [],
          preparationOrNull: null,
          additionalTabs: [],
          pendingDecisionOrNull: null,
          receiptOrNull: null,
          lastAbsenceOrNull: null,
          returnedOrNull: null,
        };
        s.guarded(db, guard, state, 'APPLY');
        const before = s.changes(db),
          json = s.canonical(record);
        db.prepare('INSERT INTO local_admission_publication VALUES (?,?,?,?,?,?,?,?,?)').run(
          requestId,
          scope.networkScopeId,
          scope.ownerDeviceId,
          publication.gmDecision.admissionBatchId,
          null,
          0,
          s.sha(json),
          json,
          s.sha(json),
        );
        if (s.changes(db) !== before + 1) return s.fail('SOURCE_CHANGED');
        mirror(db, state, null, snapshot.current);
        const saved = readInTransaction(db, scope, requestId) ?? s.fail();
        s.guarded(db, guard, saved, 'APPLY');
        return saved;
      })
      .immediate(),
  );
}
function append(
  db: Database.Database,
  current: LocalAdmissionRead,
  eventId: string,
  payload: LocalAdmissionEventPayload,
): void {
  const event: LocalAdmissionEvent = {
    eventId,
    eventIndex: current.events.length + 1,
    previousSha256: digest(current.events.at(-1) ?? current.record),
    payload,
  };
  reduce(current, event);
  s.assertUnused(db, eventId);
  const json = s.canonical(event),
    checksum = s.sha(json),
    requestId = current.record.publication.gmDecision.requestId;
  const preparationId =
    payload.kind === 'INTENT' && current.preparationOrNull === null
      ? (payload.request.controllerPreparationOrNull?.preparationId ?? null)
      : null;
  if (preparationId !== null) s.assertUnused(db, preparationId);
  db.prepare('INSERT INTO local_admission_event VALUES (?,?,?,?,?,?)').run(
    eventId,
    requestId,
    event.eventIndex,
    preparationId,
    json,
    checksum,
  );
  const update = db
    .prepare(
      'UPDATE local_admission_publication SET head_event_id=?,event_index=?,head_sha256=? WHERE request_id=? AND event_index=? AND head_sha256=?',
    )
    .run(
      eventId,
      event.eventIndex,
      checksum,
      requestId,
      current.events.length,
      event.previousSha256,
    );
  if (update.changes !== 1) return s.fail('SOURCE_CHANGED');
}
export function prepareLocalAdmissionDecision(
  db: Database.Database,
  scope: LocalNetworkScope,
  value: {
    readonly requestId: string;
    readonly commandId: string;
    readonly decision: 'ACCEPT' | 'DECLINE';
    readonly expectedCampaignRevision: number;
  },
  allocateId: () => string,
  guard: NetworkStoreGuard<LocalAdmissionRead>,
  clientRequestJsonOrNull: string | null = null,
): LocalAdmissionRead {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const input = s.input(() => {
    const row = s.object(value, ['requestId', 'commandId', 'decision', 'expectedCampaignRevision']);
    if (row['decision'] !== 'ACCEPT' && row['decision'] !== 'DECLINE')
      return s.fail('INVALID_INPUT');
    return {
      requestId: s.text(row['requestId']),
      commandId: s.text(row['commandId']),
      expectedCampaignRevision: s.integer(row['expectedCampaignRevision']),
      decision: row['decision'],
    };
  });
  const { requestId, commandId, decision, expectedCampaignRevision: revision } = input;
  const browserJson =
    clientRequestJsonOrNull === null
      ? null
      : s.canonical(
          s.input(() => admissionOwnerCommandValue(JSON.parse(clientRequestJsonOrNull) as unknown)),
        );
  return s.safe(() =>
    db
      .transaction(() => {
        s.schema(db);
        s.owner(db, scope.ownerDeviceId);
        const loaded = readWithSource(db, scope, requestId) ?? s.fail('UNAVAILABLE'),
          current = loaded.current,
          proposal = current.record.publication.proposalOrNull ?? s.fail('UNAVAILABLE'),
          old = current.events.find(
            (e) => e.payload.kind === 'INTENT' && e.payload.request.commandId === commandId,
          );
        if (old?.payload.kind === 'INTENT') {
          if (
            old.payload.request.decision !== decision ||
            old.payload.request.expectedCampaignRevision !== revision ||
            old.payload.clientRequestJsonOrNull !== browserJson
          )
            return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, current, 'REPLAY');
          return current;
        }
        if (current.pendingDecisionOrNull !== null || current.receiptOrNull !== null)
          return s.fail('UNAVAILABLE');
        // readInTransaction already replayed this original's full source history. Recheck
        // its owned anchor and pointer here without replaying the same large SUBMIT again.
        const original =
          readOwnedLocalNetworkTabAnchor(db, scope.ownerDeviceId, scope.networkScopeId) ??
          s.fail('UNAVAILABLE');
        if (original.tabId !== current.record.originalTabId) return s.fail('SOURCE_CHANGED');
        if (!s.same(tabs.activeAnchor(db, scope.ownerDeviceId), original))
          return s.fail('UNAVAILABLE');
        s.guarded(db, guard, current, 'APPLY');
        s.assertUnused(db, commandId);
        let preparation = current.preparationOrNull;
        const additional: LocalNetworkTabEntryInput[] = [],
          ids = new Set([commandId]);
        const allocate = (): string => {
          let id: string | null = null;
          s.guarded(
            db,
            () => {
              id = s.uuid(admissionReviewStorage.callSynchronous(allocateId));
            },
            { current, input },
            'APPLY',
          );
          if (id === null || ids.has(id)) return s.fail('IDEMPOTENCY_CONFLICT');
          s.assertUnused(db, id);
          ids.add(id);
          return id;
        };
        if (decision === 'ACCEPT' && preparation === null) {
          tabs.assertRoom(
            db,
            scope.ownerDeviceId,
            proposal.fullCampaignCopyDiffs.length - 1,
            original,
          );
          const preparationId = allocate();
          const bindings = proposal.fullCampaignCopyDiffs.map((copy, i) => {
            const tabId = i === 0 ? original.tabId : allocate(),
              copyId = copy.campaignCharacterIdOrNull ?? s.fail();
            if (i !== 0)
              additional.push({
                entryCommandId: allocate(),
                entryReceiptId: allocate(),
                ownerDeviceId: scope.ownerDeviceId,
                sourceContextId: original.tabId,
                sourceRevisions: s.vectorOf(original),
                tabId,
                networkScopeId: allocate(),
                admissionEntry: {
                  schemaVersion: 1,
                  preparationId,
                  requestId,
                  admissionBatchId: proposal.admissionBatchId,
                  proposalChecksum: proposal.proposalChecksum,
                  campaignCharacterId: copyId,
                },
              });
            return {
              campaignCharacterId: copyId,
              deviceId: scope.ownerDeviceId,
              localControllerSeatId: tabId,
              inputLaneId: tabId,
            };
          });
          preparation = admissionControllerPreparationValue({
            schemaVersion: 1,
            preparationId,
            requestId,
            ownerDeviceId: scope.ownerDeviceId,
            campaignId: proposal.campaignId,
            admissionBatchId: proposal.admissionBatchId,
            proposalRevision: proposal.proposalRevision,
            proposalChecksum: proposal.proposalChecksum,
            controllerBindings: bindings,
          });
        }
        const request = admissionPlayerDecisionRequestValue({
          commandId,
          decision,
          campaignId: proposal.campaignId,
          admissionBatchId: proposal.admissionBatchId,
          proposalRevision: proposal.proposalRevision,
          proposalChecksum: proposal.proposalChecksum,
          expectedCampaignRevision: revision,
          controllerPreparationOrNull: decision === 'ACCEPT' ? preparation : null,
        });
        const base = loaded.source.history.current;
        const before = s.changes(db);
        for (const entry of additional) tabs.createInactive(db, entry);
        append(db, current, commandId, {
          kind: 'INTENT',
          request,
          additionalTabs: additional,
          clientRequestJsonOrNull: browserJson,
        });
        if (s.changes(db) !== before + 2 + additional.length * 2) return s.fail('SOURCE_CHANGED');
        mirror(db, readJournal(db, scope, requestId) ?? s.fail(), commandId, base);
        const saved = readInTransaction(db, scope, requestId) ?? s.fail();
        if (tabs.activeAnchor(db, scope.ownerDeviceId)?.tabId !== original.tabId)
          return s.fail('SOURCE_CHANGED');
        s.guarded(db, guard, saved, 'APPLY');
        return saved;
      })
      .immediate(),
  );
}
export function acknowledgeLocalAdmissionDecision(
  db: Database.Database,
  scope: LocalNetworkScope,
  requestId: string,
  eventId: string,
  authenticatedHost: NetworkPublicIdentity,
  value: Extract<LocalAdmissionEventPayload, { kind: 'ACK' | 'FENCED_ABSENT' }>,
  guard: NetworkStoreGuard<LocalAdmissionRead>,
): LocalAdmissionRead {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const host = structuredClone(s.input(() => s.identity(authenticatedHost)));
  return s.safe(() =>
    db
      .transaction(() => {
        s.schema(db);
        s.owner(db, scope.ownerDeviceId);
        const loaded = readWithSource(db, scope, requestId) ?? s.fail('UNAVAILABLE'),
          current = loaded.current;
        if (!s.same(host, current.record.hostIdentity)) return s.fail('FOREIGN_OWNER');
        const payload = structuredClone(
            s.input(() => {
              const row = s.object(JSON.parse(s.canonical(value)) as unknown);
              if (row['kind'] !== 'ACK' && row['kind'] !== 'FENCED_ABSENT')
                return s.fail('INVALID_INPUT');
              return payloadValue(row, current.record.publication);
            }),
          ),
          known = current.events.find((e) => e.eventId === eventId);
        if (known !== undefined) {
          if (!s.same(known.payload, payload)) return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, current, 'REPLAY');
          return current;
        }
        s.guarded(db, guard, current, 'APPLY');
        const base = loaded.source.history.current;
        const before = s.changes(db);
        append(db, current, s.text(eventId), payload);
        if (s.changes(db) !== before + 2) return s.fail('SOURCE_CHANGED');
        mirror(db, readJournal(db, scope, requestId) ?? s.fail(), eventId, base);
        const saved = readInTransaction(db, scope, requestId) ?? s.fail();
        s.guarded(db, guard, saved, 'APPLY');
        return saved;
      })
      .immediate(),
  );
}

/** An extra actual tab is proven by its original owner's complete admission journal. */
export function validateLocalAdmissionTab(
  db: Database.Database,
  tab: LocalNetworkTab,
  entry: LocalNetworkTabEntryInput,
): void {
  const origin = entry.admissionEntry;
  if (origin === undefined) return s.fail();
  const row = s.at(db, 'local_admission_publication', 'request_id', origin.requestId) ?? s.fail(),
    record = recordValue(s.checked(row));
  if (
    record.scope.ownerDeviceId !== tab.ownerDeviceId ||
    record.originalTabId !== entry.sourceContextId
  )
    return s.fail('FOREIGN_OWNER');
  const state = readInTransaction(db, record.scope, origin.requestId) ?? s.fail();
  if (!state.additionalTabs.some((saved) => s.same(saved, entry))) return s.fail();
}
/** Ordinary APP/network commands cannot repurpose a seat with a possibly committed ACCEPT. */
export function assertLocalAdmissionTabMutable(db: Database.Database, tab: LocalNetworkTab): void {
  const version = (db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row)[
    'version'
  ];
  if (version !== 12) return;
  const entry = tabs.entryAnchor(db, tab.ownerDeviceId, tab.entryCommandId) ?? s.fail();
  if (entry.request.admissionEntry !== undefined) return s.fail('UNAVAILABLE');
  const rows = db
    .prepare('SELECT request_id FROM local_admission_publication WHERE network_scope_id=?')
    .all(tab.networkScopeId) as Row[];
  for (const row of rows) {
    const state =
      readInTransaction(
        db,
        { ownerDeviceId: tab.ownerDeviceId, networkScopeId: tab.networkScopeId },
        s.text(row['request_id']),
      ) ?? s.fail();
    if (state.returnedOrNull !== null) continue;
    if (
      state.preparationOrNull !== null ||
      state.pendingDecisionOrNull !== null ||
      state.receiptOrNull !== null ||
      state.record.publication.gmDecision.decision === 'REJECT'
    )
      return s.fail('UNAVAILABLE');
  }
}

/** Leaf proof for the tab writer; it deliberately does not replay the network or tab reader. */
export function validateLocalAdmissionReleasedTab(
  db: Database.Database,
  entry: LocalNetworkTabEntryInput,
  closure: LocalNetworkTabCloseInput,
): void {
  const origin = entry.admissionEntry ?? s.fail('INVALID_INPUT'),
    row = s.at(db, 'local_admission_publication', 'request_id', origin.requestId) ?? s.fail(),
    record = recordValue(s.checked(row)),
    state = readJournal(db, record.scope, origin.requestId) ?? s.fail(),
    returned = state.returnedOrNull ?? s.fail('UNAVAILABLE'),
    i = state.additionalTabs.findIndex((saved) => s.same(saved, entry));
  if (i < 0 || !s.same(returned.additionalClosures[i], closure)) return s.fail('FOREIGN_OWNER');
}

/** A terminal result releases presentation only; the original actual tab/session survives. */
export function returnFromLocalAdmission(
  db: Database.Database,
  scope: LocalNetworkScope,
  value: {
    readonly requestId: string;
    readonly expectedRevisions: RevisionTriple;
    readonly expectedDraftRevision: number;
    readonly clientRequestJson: string;
    readonly mode: 'RESELECT' | 'MENU';
  },
  allocateId: () => string,
  guard: NetworkStoreGuard<LocalAdmissionRead>,
): LocalAdmissionRead {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  const input = s.input(() => {
    const row = s.object(JSON.parse(s.canonical(value)) as unknown, [
      'requestId',
      'expectedRevisions',
      'expectedDraftRevision',
      'clientRequestJson',
      'mode',
    ]);
    return {
      requestId: s.text(row['requestId']),
      payload: returnValue({
        kind: 'RETURN',
        mode: row['mode'],
        sourceRevisions: row['expectedRevisions'],
        sourceDraftRevision: row['expectedDraftRevision'],
        clientRequestJson: row['clientRequestJson'],
        additionalClosures: [],
      }),
    };
  });
  const eventId = returnNavigation(input.payload);
  return s.safe(() =>
    db
      .transaction(() => {
        s.schema(db);
        s.owner(db, scope.ownerDeviceId);
        const loaded = readWithSource(db, scope, input.requestId) ?? s.fail('UNAVAILABLE'),
          current = loaded.current,
          known = current.events.find((e) => e.eventId === eventId);
        if (known !== undefined) {
          if (
            known.payload.kind !== 'RETURN' ||
            !s.same({ ...known.payload, additionalClosures: [] }, input.payload)
          )
            return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, current, 'REPLAY');
          return current;
        }
        if (
          current.returnedOrNull !== null ||
          current.pendingDecisionOrNull !== null ||
          (current.record.publication.gmDecision.decision !== 'REJECT' &&
            current.receiptOrNull?.decision !== 'DECLINE')
        )
          return s.fail('UNAVAILABLE');
        const { original, snapshot } = loaded.source;
        if (!s.same(tabs.activeAnchor(db, scope.ownerDeviceId), original))
          return s.fail('UNAVAILABLE');
        if (
          !s.same(input.payload.sourceRevisions, s.vectorOf(original)) ||
          input.payload.sourceDraftRevision !== snapshot.current.draftRevision
        )
          return s.fail('STALE_REVISION');
        s.guarded(db, guard, current, 'APPLY');
        const ids = new Set([eventId]),
          allocate = (): string => {
            let id: string | null = null;
            s.guarded(
              db,
              () => {
                id = s.uuid(admissionReviewStorage.callSynchronous(allocateId));
              },
              { current, input },
              'APPLY',
            );
            if (id === null || ids.has(id)) return s.fail('IDEMPOTENCY_CONFLICT');
            s.assertUnused(db, id);
            ids.add(id);
            return id;
          };
        const payload: LocalAdmissionReturn = {
          ...input.payload,
          additionalClosures: current.additionalTabs.map((entry) => ({
            ownerDeviceId: scope.ownerDeviceId,
            networkScopeId: entry.networkScopeId,
            expectedRevisions: s.zero(),
            closeCommandId: allocate(),
            closeReceiptId: allocate(),
          })),
        };
        const before = s.changes(db);
        append(db, current, eventId, payload);
        for (const closure of payload.additionalClosures) tabs.retirePrepared(db, closure);
        if (s.changes(db) !== before + 2 + payload.additionalClosures.length * 2)
          return s.fail('SOURCE_CHANGED');
        // The matching network transition is appended below in the same outer transaction.
        mirror(db, readJournal(db, scope, input.requestId) ?? s.fail(), eventId, snapshot.current);
        const saved = readInTransaction(db, scope, input.requestId) ?? s.fail();
        if (tabs.activeAnchor(db, scope.ownerDeviceId)?.tabId !== original.tabId)
          return s.fail('SOURCE_CHANGED');
        s.guarded(db, guard, saved, 'APPLY');
        return saved;
      })
      .immediate(),
  );
}
