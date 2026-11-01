import type { ActionKey } from '@generated/types/atlas.js';
import type {
  CommandReceipt,
  JsonObject,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';
import {
  admissionCodecReaders as r,
  admissionJsonEqual,
} from '@shared/campaign-admission-codec.js';
import { wireCodecPrimitives as w } from '@shared/wire-codec.js';
import {
  ADMISSION_GM_WORKFLOW_IDS,
  admissionGmProjectionValue,
  isAdmissionGmForm,
  isAdmissionOwnerForm,
  admissionOwnerCommandValue,
  admissionOwnerProjectionValue,
  type AdmissionOwnerCommand,
} from '@shared/campaign-admission-presentation.js';
import {
  admissionOwnerPublicationValue,
  admissionPlayerDecisionReceiptValue,
} from '@shared/campaign-admission-proposal.js';
import {
  admissionGmClientBindingValue,
  admissionGmViewValuesValue,
  type AdmissionGmClientV3Message,
  type AdmissionGmViewValues,
  type AdmissionReviewIntent,
} from '@shared/campaign-admission-review.js';
import { networkGmRequestProjectionValue } from '@shared/network-application-codec.js';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';

export type AdmissionBrowserRequest = WorkflowCommandRequestMessage<
  (typeof ADMISSION_GM_WORKFLOW_IDS)[number]
>;
export type AdmissionBrowserEdit =
  | { readonly kind: 'VIEW'; readonly values: AdmissionGmViewValues }
  | {
      readonly kind: 'REVIEW';
      readonly intent: Exclude<AdmissionReviewIntent, { kind: 'WEAPON' }>;
    };
export function admissionOwnerBrowserCommand(
  source: ConfirmedProjectionSnapshot,
  action: ActionKey,
  commandId: string,
): AdmissionOwnerCommand {
  if (
    source.formId !== 'NET-027' ||
    !source.availableActionKeys.includes(action) ||
    !['NET-027::CTA::003', 'NET-027::CTA::004'].includes(action)
  )
    throw new Error('Whole-batch decision is unavailable');
  const p = admissionOwnerProjectionValue(source.formId, source.projection);
  return admissionOwnerCommandValue({
    messageType: 'command.request',
    protocolVersion: 1,
    commandKind: 'workflow-command',
    role: 'player',
    commandId,
    workflowCommandId: 'UI-CMD-ADMISSION-PLAYER-DECIDE',
    expectedRevisions: source.revisions,
    payload: {
      contextId: p['contextId'],
      networkScopeId: p['networkScopeId'],
      campaignId: p['campaignId'],
      requestId: p['requestIdOrNull'],
      admissionBatchId: p['admissionBatchId'],
      proposalRevision: p['proposalRevision'],
      proposalChecksum: p['proposalChecksum'],
      expectedCampaignRevision: p['campaignRevisionOrNull'],
      decision: action === 'NET-027::CTA::003' ? 'ACCEPT' : 'DECLINE',
    },
  });
}
export function admissionOwnerMonotonic(
  next: ConfirmedProjectionSnapshot,
  previous: ConfirmedProjectionSnapshot,
  reconnecting = false,
): boolean {
  if (
    !isAdmissionOwnerForm(next.formId) ||
    (!isAdmissionOwnerForm(previous.formId) && previous.formId !== 'NET-005')
  )
    return false;
  const p = previous.projection,
    n = next.projection;
  if (
    ['networkScopeId', 'controllerSeat', 'deviceId'].some((key) => p[key] !== n[key]) ||
    (!reconnecting && p['contextId'] !== n['contextId']) ||
    next.revisions.stateRevision < previous.revisions.stateRevision ||
    next.revisions.projectionRevision < previous.revisions.projectionRevision ||
    next.revisions.actorVisibilityRevision !== previous.revisions.actorVisibilityRevision
  )
    return false;
  if (previous.formId === 'NET-005')
    return (
      p['requestId'] === n['requestIdOrNull'] &&
      p['campaignIdOrNull'] === n['campaignId'] &&
      (p['requestStatus'] === 'IN_REVIEW' || p['requestStatus'] === 'PENDING') &&
      next.revisions.stateRevision > previous.revisions.stateRevision
    );
  if (!admissionJsonEqual(p['publication'], n['publication'])) return false;
  if (p['receiptOrNull'] !== null && !admissionJsonEqual(p['receiptOrNull'], n['receiptOrNull']))
    return false;
  if (
    next.revisions.stateRevision === previous.revisions.stateRevision ||
    next.revisions.projectionRevision === previous.revisions.projectionRevision
  ) {
    // Only authenticated live connectivity/capacity can change without a local journal event.
    // The executor context may change on reconnect, never on an unsolicited system update.
    const durable = (value: JsonObject) =>
      Object.fromEntries(
        Object.entries(value).filter(
          ([key]) =>
            ![
              'contextId',
              'technicalSessionAvailable',
              'capacityRecheck',
              'controllerDeviceRecheck',
              'campaignRevisionOrNull',
            ].includes(key),
        ),
      );
    if (
      next.formId !== previous.formId ||
      !admissionJsonEqual(durable(p), durable(n)) ||
      !admissionJsonEqual(next.layers, previous.layers)
    )
      return false;
  }
  return true;
}
export function admissionOwnerBrowserReceipt(
  receipt: CommandReceipt,
  request: AdmissionOwnerCommand,
  source: ConfirmedProjectionSnapshot,
): CommandReceipt {
  const result = r.exact(
    receipt.result,
    'operation networkScopeId remoteReceipt',
    '$.receipt.result',
  );
  w.literal(result['operation'], 'ADMISSION_PLAYER_DECIDE', '$.operation');
  w.literal(
    result['networkScopeId'],
    request.payload['networkScopeId'] as string,
    '$.networkScopeId',
  );
  const publication = admissionOwnerPublicationValue(source.projection['publication']),
    remote = admissionPlayerDecisionReceiptValue(result['remoteReceipt'], publication);
  if (
    receipt.commandId !== request.commandId ||
    remote.commandId !== request.commandId ||
    remote.decision !== request.payload['decision'] ||
    remote.campaignRevision !== Number(request.payload['expectedCampaignRevision']) + 1 ||
    receipt.revisions.stateRevision < source.revisions.stateRevision + 2 ||
    receipt.revisions.projectionRevision < source.revisions.projectionRevision + 2 ||
    receipt.revisions.actorVisibilityRevision !== source.revisions.actorVisibilityRevision
  )
    r.invalid('$.receipt', 'matching whole-batch receipt', null);
  return receipt;
}
export function admissionOwnerDecisionDestination(
  next: ConfirmedProjectionSnapshot,
  request: AdmissionOwnerCommand,
  source: ConfirmedProjectionSnapshot,
  confirmedReceipt: CommandReceipt | null = null,
  reconnecting = false,
  currentContextId: string = source.projection['contextId'] as string,
): boolean {
  if (!reconnecting && next.projection['contextId'] !== currentContextId) return false;
  if (confirmedReceipt !== null) {
    admissionOwnerBrowserReceipt(confirmedReceipt, request, source);
    if (reconnecting && next.formId === 'APP-002')
      return (
        request.payload['decision'] === 'DECLINE' &&
        next.layers.length === 0 &&
        next.projection['deviceId'] === source.projection['deviceId']
      );
    if (
      next.projection['deviceId'] === source.projection['deviceId'] &&
      next.projection['networkScopeId'] === request.payload['networkScopeId'] &&
      next.revisions.stateRevision > confirmedReceipt.revisions.stateRevision &&
      next.revisions.projectionRevision >= confirmedReceipt.revisions.projectionRevision &&
      next.revisions.actorVisibilityRevision === confirmedReceipt.revisions.actorVisibilityRevision
    )
      return true;
  }
  // The request source is immutable receipt evidence; reconnect can replace the active executor.
  // Its current context was checked above (or by the reconnect envelope), independently of source.
  if (!admissionOwnerMonotonic(next, source, true)) return false;
  const receipt = next.projection['receiptOrNull'];
  if (receipt === null) return next.projection['pendingCommandIdOrNull'] === request.commandId;
  if (
    next.revisions.stateRevision < source.revisions.stateRevision + 2 ||
    next.revisions.projectionRevision < source.revisions.projectionRevision + 2
  )
    return false;
  const remote = admissionPlayerDecisionReceiptValue(
    receipt,
    admissionOwnerPublicationValue(source.projection['publication']),
  );
  return (
    remote.commandId === request.commandId &&
    remote.decision === request.payload['decision'] &&
    remote.campaignRevision === Number(request.payload['expectedCampaignRevision']) + 1
  );
}
export function admissionBrowserDraft(
  source: ConfirmedProjectionSnapshot,
  edit: AdmissionBrowserEdit,
  id: string,
): AdmissionGmClientV3Message {
  const active = source.layers.at(-1) ?? source;
  if (!isAdmissionGmForm(active.formId)) throw new Error('Admission form is unavailable');
  const p = admissionGmProjectionValue(active.formId, active.projection),
    common = {
      protocolVersion: 3 as const,
      draftUpdateId: id,
      contextId: p.contextId,
      campaignId: p.campaignId,
      admissionBatchId: p.admissionBatchId,
      expectedRevisions: source.revisions,
    };
  if (edit.kind === 'VIEW')
    return {
      ...common,
      messageType: 'network.admission-view.replace',
      sourceFormId: active.formId,
      values: admissionGmViewValuesValue(edit.values),
    };
  if (!['NET-019', 'NET-020', 'GM-020'].includes(active.formId) || !p.editable)
    throw new Error('Admission editing is unavailable');
  const request = {
    ...common,
    messageType: 'network.admission-review.edit' as const,
    sourceFormId: active.formId as 'NET-019' | 'NET-020' | 'GM-020',
    expectedReviewRevision: p.reviewRevisionOrNull,
    intent: edit.intent,
  };
  admissionGmClientBindingValue(request);
  return request;
}
/** Check the effect only at the applied vector; a later current is a separate historical delivery. */
export function admissionDraftDestinationMatches(
  next: ConfirmedProjectionSnapshot,
  source: ConfirmedProjectionSnapshot,
  request: AdmissionGmClientV3Message,
): boolean {
  const active = next.layers.at(-1) ?? next,
    before = source.layers.at(-1) ?? source;
  if (
    active.formId !== request.sourceFormId ||
    active.projection['admissionBatchId'] !== request.admissionBatchId
  )
    return false;
  const p = active.projection,
    old = before.projection;
  if (request.messageType === 'network.admission-view.replace')
    return admissionJsonEqual(p['viewValues'], request.values);
  if (p['reviewRevisionOrNull'] !== request.expectedReviewRevision + 1) return false;
  const intent = request.intent;
  if (intent.kind === 'EDIT')
    return (
      p['selectedReviewCopyId'] === intent.reviewCopyId &&
      admissionJsonEqual(p['reviewDraft'], intent.inputs)
    );
  const field = intent.kind === 'ALLOCATE_ITEM' ? 'reviewItemIdentities' : 'groupDraftIds';
  const a = old[field],
    b = p[field];
  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    b.length !== a.length + 1 ||
    !a.every((id, i) => admissionJsonEqual(id, b[i]))
  )
    return false;
  if (intent.kind === 'ALLOCATE_GROUP')
    return typeof b.at(-1) === 'string' && !a.includes(b.at(-1));
  const added = b.at(-1) as JsonObject;
  return (
    p['selectedReviewCopyId'] === intent.reviewCopyId &&
    added['sourceEntryIdOrNull'] === null &&
    typeof added['reviewItemId'] === 'string' &&
    !a.some((entry) => (entry as JsonObject)['reviewItemId'] === added['reviewItemId'])
  );
}
export function admissionOwnerActions(
  form: 'NET-006' | 'NET-007' | 'NET-027',
  p: JsonObject,
  supported: readonly string[],
): ActionKey[] {
  if (form === 'NET-006') return ['NET-006::CTA::001'];
  if (form === 'NET-007')
    return [
      ...(p['proposalChecksum'] !== null ? ['NET-007::CTA::001' as const] : []),
      ...(p['technicalSessionAvailable'] === true ? ['NET-007::CTA::002' as const] : []),
      'NET-007::CTA::003',
    ];
  if (p['decision'] === 'ACCEPT') return ['NET-027::CTA::001'];
  if (p['decision'] === 'DECLINE') return ['NET-027::CTA::002'];
  if (
    p['technicalSessionAvailable'] !== true ||
    p['capacityRecheck'] === null ||
    p['pendingCommandIdOrNull'] !== null ||
    !supported.includes('UI-CMD-ADMISSION-PLAYER-DECIDE')
  )
    return [];
  return [
    ...((p['capacityRecheck'] as JsonObject)['fitsCurrentCapacity'] === true
      ? ['NET-027::CTA::003' as const]
      : []),
    'NET-027::CTA::004',
  ];
}
export const isAdmissionWorkflow = (
  id: string,
): id is AdmissionBrowserRequest['workflowCommandId'] =>
  (ADMISSION_GM_WORKFLOW_IDS as readonly string[]).includes(id);
export function admissionBrowserCommand(
  snapshot: ConfirmedProjectionSnapshot,
  action: ActionKey,
  commandId: string,
): AdmissionBrowserRequest | null {
  const active = snapshot.layers.at(-1) ?? snapshot;
  let workflow: AdmissionBrowserRequest['workflowCommandId'], payload: JsonObject;
  if (active.formId === 'NET-017' && action === 'NET-017::CTA::010') {
    const p = networkGmRequestProjectionValue(active.projection),
      selected = p.requests.find((row) => row.requestId === p.selectedRequestIdOrNull);
    if (selected?.requestStatus !== 'IN_REVIEW' || p.selectedAdmissionOrNull?.published !== false)
      return null;
    workflow = 'UI-CMD-ADMISSION-REVIEW-OPEN';
    payload = {
      campaignId: p.campaignId,
      requestId: selected.requestId,
      requestRevision: selected.requestRevision,
    };
  } else {
    if (!isAdmissionGmForm(active.formId)) return null;
    const p = admissionGmProjectionValue(active.formId, active.projection);
    const common = {
      contextId: p.contextId,
      campaignId: p.campaignId,
      admissionBatchId: p.admissionBatchId,
      reviewRevision: p.reviewRevisionOrNull,
    };
    if (active.formId === 'GM-019' && action === 'GM-019::CTA::005') {
      const values = admissionGmViewValuesValue(p['viewValues']);
      if (values.weaponDraftOrNull === null) return null;
      workflow = 'UI-CMD-GM-WEAPON-REQUEST-RESOLVE';
      payload = w.jsonObject(
        { ...common, reviewCopyId: p.selectedReviewCopyId, input: values.weaponDraftOrNull },
        '$.payload',
      );
    } else if (
      (active.formId === 'NET-021' && action === 'NET-021::CTA::005') ||
      (active.formId === 'NET-022' && action === 'NET-022::CTA::003')
    ) {
      const accept = active.formId === 'NET-021',
        capacity = w.record(p['capacityPreview'], '$.capacityPreview');
      workflow = accept ? 'UI-CMD-ADMISSION-GM-ACCEPT' : 'UI-CMD-ADMISSION-GM-REJECT';
      payload = {
        ...common,
        expectedCampaignRevision: r.integer(capacity['evaluatedCampaignRevision'], '$.capacity', 0),
        previewChecksumOrNull: accept ? r.text(p['proposalChecksum'], '$.proposalChecksum') : null,
        reasonOrNull: accept ? null : r.raw(p['reason'], '$.reason'),
      };
    } else return null;
  }
  if (!snapshot.executableWorkflowCommandIds.includes(workflow)) return null;
  const request = {
    messageType: 'command.request',
    protocolVersion: 1,
    commandKind: 'workflow-command',
    role: 'gm',
    commandId,
    workflowCommandId: workflow,
    expectedRevisions: snapshot.revisions,
    payload,
  } as const;
  if (workflow !== 'UI-CMD-ADMISSION-REVIEW-OPEN') admissionGmClientBindingValue(request);
  return request;
}
const same = (a: unknown, b: unknown, path: string) => {
  if (!admissionJsonEqual(a, b)) r.invalid(path, 'original admission receipt correlation', null);
};
/** A current screen cannot relabel the immutable technical receipt returned by the host. */
export function admissionBrowserReceipt(
  value: CommandReceipt<JsonObject>,
  request: AdmissionBrowserRequest,
  source: ConfirmedProjectionSnapshot,
): CommandReceipt {
  same(value.commandId, request.commandId, '$.commandId');
  r.uuid(value.receiptId, '$.receiptId');
  const v = w.revisions(value.revisions, '$.revisions'),
    expected = request.expectedRevisions;
  same(
    v.stateRevision,
    expected.stateRevision + (request.workflowCommandId === 'UI-CMD-ADMISSION-REVIEW-OPEN' ? 0 : 1),
    '$.revisions.stateRevision',
  );
  same(v.projectionRevision, expected.projectionRevision + 1, '$.revisions.projectionRevision');
  same(
    v.actorVisibilityRevision,
    expected.actorVisibilityRevision +
      (request.workflowCommandId === 'UI-CMD-ADMISSION-GM-ACCEPT' ? 1 : 0),
    '$.revisions.actorVisibilityRevision',
  );
  const active = source.layers.at(-1) ?? source;
  const result = value.result;
  same(result['workflowCommandId'], request.workflowCommandId, '$.workflowCommandId');
  same(result['contextId'], source.projection['contextId'], '$.contextId');
  same(result['campaignId'], request.payload['campaignId'], '$.campaignId');
  r.uuid(result['admissionBatchId'], '$.admissionBatchId');
  r.text(result['timestamp'], '$.timestamp');
  if (request.workflowCommandId === 'UI-CMD-ADMISSION-REVIEW-OPEN') {
    r.exact(
      result,
      'workflowCommandId contextId campaignId admissionBatchId originalOpenReceipt timestamp',
      '$.result',
    );
    const original = r.exact(
      result['originalOpenReceipt'],
      'receiptId commandId workflowCommandId campaignId requestId requestOwnerDeviceId admissionBatchId reviewCopies reviewRevision authoritativeGmActorId timestamp',
      '$.originalOpenReceipt',
    );
    const p = networkGmRequestProjectionValue(source.projection),
      selected = p.requests.find((row) => row.requestId === request.payload['requestId']);
    if (selected === undefined) r.invalid('$.requestId', 'selected source request', null);
    same(original['requestId'], request.payload['requestId'], '$.original.requestId');
    same(original['campaignId'], request.payload['campaignId'], '$.original.campaignId');
    same(original['admissionBatchId'], result['admissionBatchId'], '$.original.admissionBatchId');
    same(
      original['requestOwnerDeviceId'],
      selected!.requestOwnerDeviceId,
      '$.original.requestOwnerDeviceId',
    );
    same(original['workflowCommandId'], request.workflowCommandId, '$.original.workflowCommandId');
    same(original['reviewRevision'], 0, '$.original.reviewRevision');
    for (const key of ['receiptId', 'commandId', 'authoritativeGmActorId', 'timestamp'])
      r.text(original[key], `$.original.${key}`);
    const copies = r.list(original['reviewCopies'], '$.original.reviewCopies');
    same(copies.length, selected!.batchCharacterSummaries.length, '$.original.reviewCopies');
    copies.forEach((raw, index) => {
      const copy = r.exact(
          raw,
          'reviewCopyId sourceUuid sourceSnapshotId snapshotChecksum',
          '$.copy',
        ),
        originalCopy = selected!.batchCharacterSummaries[index]!;
      r.uuid(copy['reviewCopyId'], '$.copy.reviewCopyId');
      same(copy['sourceUuid'], originalCopy.sourceUuid, '$.copy.sourceUuid');
      same(copy['sourceSnapshotId'], originalCopy.sourceSnapshotId, '$.copy.sourceSnapshotId');
      // The queue contains export-byte checksums; OPEN carries immutable source checksums.
      if (!/^[0-9a-f]{64}$/u.test(r.text(copy['snapshotChecksum'], '$.copy.snapshotChecksum')))
        r.invalid('$.copy.snapshotChecksum', 'SHA-256', null);
    });
  } else if (request.workflowCommandId === 'UI-CMD-GM-WEAPON-REQUEST-RESOLVE') {
    r.exact(
      result,
      'workflowCommandId contextId campaignId admissionBatchId reviewCopyId reviewRevision timestamp',
      '$.result',
    );
    same(result['admissionBatchId'], request.payload['admissionBatchId'], '$.admissionBatchId');
    same(result['reviewCopyId'], request.payload['reviewCopyId'], '$.reviewCopyId');
    same(
      result['reviewRevision'],
      Number(request.payload['reviewRevision']) + 1,
      '$.reviewRevision',
    );
  } else {
    r.exact(
      result,
      'receiptId commandId workflowCommandId campaignId admissionBatchId requestId requestOwnerDeviceId reviewRevision decision reasonOrNull proposalRevisionOrNull proposalChecksumOrNull campaignCharacterIds authoritativeGmActorId timestamp contextId',
      '$.result',
    );
    const accepted = request.workflowCommandId === 'UI-CMD-ADMISSION-GM-ACCEPT',
      p = admissionGmProjectionValue(active.formId as 'NET-021' | 'NET-022', active.projection);
    same(result['receiptId'], value.receiptId, '$.receiptId');
    same(result['commandId'], request.commandId, '$.commandId');
    same(result['admissionBatchId'], request.payload['admissionBatchId'], '$.admissionBatchId');
    same(result['requestId'], p['deviceRequestId'], '$.requestId');
    const owner = r.exact(
      p['ownerProvenance'],
      'kind requestId requestOwnerDeviceId',
      '$.ownerProvenance',
    );
    same(result['requestOwnerDeviceId'], owner['requestOwnerDeviceId'], '$.requestOwnerDeviceId');
    same(result['reviewRevision'], request.payload['reviewRevision'], '$.reviewRevision');
    same(result['decision'], accepted ? 'ACCEPT' : 'REJECT', '$.decision');
    same(result['reasonOrNull'], request.payload['reasonOrNull'], '$.reasonOrNull');
    // Atlas 1.7 publishes one frozen proposal; replacement proposals are outside this slice.
    same(result['proposalRevisionOrNull'], accepted ? 1 : null, '$.proposalRevisionOrNull');
    const ids = r
      .list(result['campaignCharacterIds'], '$.campaignCharacterIds')
      .map((id) => r.uuid(id, '$.campaignCharacterId'));
    r.unique(ids, '$.campaignCharacterIds');
    same(
      ids.length,
      accepted ? (p['batchReviewCopies'] as readonly unknown[]).length : 0,
      '$.campaignCharacterIds',
    );
    if (accepted) {
      if (
        !/^[0-9a-f]{64}$/u.test(
          r.text(result['proposalChecksumOrNull'], '$.proposalChecksumOrNull'),
        )
      )
        r.invalid('$.proposalChecksumOrNull', 'published proposal SHA-256', null);
    } else same(result['proposalChecksumOrNull'], null, '$.proposalChecksumOrNull');
    r.text(result['authoritativeGmActorId'], '$.authoritativeGmActorId');
  }
  return value;
}
