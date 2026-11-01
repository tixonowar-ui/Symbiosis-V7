import type {
  AdmissionReviewInputs,
  AdmissionWeaponResolutionInput,
  AdmissionPublicWeaponProfile,
} from './campaign-admission.js';
import {
  admissionCodecReaders,
  admissionReviewInputsValue,
  admissionWeaponReviewInputValue,
  admissionMasterWeaponProfileInputValue,
} from './campaign-admission-codec.js';
import { admissionPublicWeaponProfileValue } from './campaign-admission-sheet.js';
import {
  admissionGmDecisionRequestValue,
  type AdmissionGmDecisionRequest,
} from './campaign-admission-proposal.js';
import { wireCodecPrimitives } from './wire-codec.js';
import type { RevisionVector, WorkflowCommandRequestMessage } from './wire-protocol.js';
import type {
  PresentedBaseForm,
  PresentedLayerForm,
  WireV2Vocabulary,
} from './wire-v2-protocol.js';
import { encodeHostMessageV2 } from './wire-v2-codec.js';

export interface AdmissionReviewItemIdentity {
  readonly reviewItemId: string;
  readonly sourceEntryIdOrNull: string | null;
}
export interface AdmissionStagedWeaponDecision {
  readonly receiptId: string;
  readonly input: AdmissionWeaponResolutionInput;
  readonly beforeProfileOrNull: AdmissionPublicWeaponProfile | null;
  readonly afterProfile: AdmissionPublicWeaponProfile;
  readonly reasonOrNull: string | null;
}
export interface AdmissionReviewCopyState {
  readonly reviewCopyId: string;
  readonly sourceUuid: string;
  readonly sourceSnapshotId: string;
  readonly snapshotChecksum: string;
  readonly reviewItemIdentities: readonly AdmissionReviewItemIdentity[];
  readonly inputs: AdmissionReviewInputs;
  readonly weaponDecisions: readonly AdmissionStagedWeaponDecision[];
}
/** A GM-private working state. No live copy, group, inventory instance or player authority. */
export interface AdmissionReviewState {
  readonly schemaVersion: 1;
  readonly admissionBatchId: string;
  readonly requestId: string;
  readonly reviewRevision: number;
  readonly copies: readonly AdmissionReviewCopyState[];
  readonly groupDraftIds: readonly string[];
}
export const ADMISSION_GM_VIEW_FORM_IDS = [
  'NET-018',
  'NET-019',
  'NET-020',
  'NET-021',
  'NET-022',
  'GM-019',
  'GM-020',
] as const;
export type AdmissionGmViewFormId = (typeof ADMISSION_GM_VIEW_FORM_IDS)[number];
export const CAMPAIGN_ADMISSION_FORM_IDS = [
  ...ADMISSION_GM_VIEW_FORM_IDS,
  'NET-006',
  'NET-007',
  'NET-027',
] as const;
/** Technical presentation state; gameplay inputs and committed decisions have separate journals. */
export interface AdmissionGmViewValues {
  readonly selectedReviewCopyId: string;
  readonly rejectionReason: string;
  readonly weaponDraftOrNull: AdmissionWeaponResolutionInput | null;
}
export function admissionGmViewValuesValue(
  value: unknown,
  path = '$.viewValues',
): AdmissionGmViewValues {
  const row = exact(value, 'selectedReviewCopyId rejectionReason weaponDraftOrNull', path);
  uuid(row['selectedReviewCopyId'], `${path}.selectedReviewCopyId`);
  if (typeof row['rejectionReason'] !== 'string')
    invalid(`${path}.rejectionReason`, 'string', null);
  nullable(
    row['weaponDraftOrNull'],
    `${path}.weaponDraftOrNull`,
    admissionWeaponResolutionInputValue,
  );
  return validated(row);
}
/** Allocation fields are host-issued journal output, never accepted in browser intentions. */
export type AdmissionReviewMutation =
  | Readonly<{ kind: 'EDIT'; reviewCopyId: string; inputs: AdmissionReviewInputs }>
  | Readonly<{ kind: 'ALLOCATE_ITEM'; reviewCopyId: string; reviewItemId: string }>
  | Readonly<{ kind: 'ALLOCATE_GROUP'; groupDraftId: string }>
  | Readonly<{ kind: 'WEAPON'; reviewCopyId: string; input: AdmissionWeaponResolutionInput }>;
export type AdmissionReviewIntent =
  | Extract<AdmissionReviewMutation, { kind: 'EDIT' | 'WEAPON' }>
  | Readonly<{ kind: 'ALLOCATE_ITEM'; reviewCopyId: string }>
  | Readonly<{ kind: 'ALLOCATE_GROUP' }>;
/** Draft transport only; weapon confirmation and publication keep their Atlas workflows. */
export interface AdmissionGmEditV3Message {
  readonly messageType: 'network.admission-review.edit';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly contextId: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly sourceFormId: 'NET-019' | 'NET-020' | 'GM-020';
  readonly expectedRevisions: RevisionVector;
  readonly expectedReviewRevision: number;
  readonly intent: Exclude<AdmissionReviewIntent, { kind: 'WEAPON' }>;
}
export interface AdmissionGmViewReplaceV3Message {
  readonly messageType: 'network.admission-view.replace';
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly contextId: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly sourceFormId: AdmissionGmViewFormId;
  readonly expectedRevisions: RevisionVector;
  readonly values: AdmissionGmViewValues;
}
export type AdmissionGmClientV3Message = AdmissionGmEditV3Message | AdmissionGmViewReplaceV3Message;
interface AdmissionGmDraftCorrelation {
  readonly protocolVersion: 3;
  readonly draftUpdateId: string;
  readonly contextId: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly revisions: RevisionVector;
}
export type AdmissionGmHostV3Message =
  | (AdmissionGmDraftCorrelation & {
      readonly messageType: 'network.admission-draft.result';
      readonly appliedRevisions: RevisionVector;
      readonly projectionRole: 'gm';
      readonly presentation: {
        readonly base: PresentedBaseForm;
        readonly layers: readonly PresentedLayerForm[];
      };
    })
  | (AdmissionGmDraftCorrelation & {
      readonly messageType: 'network.admission-draft.refusal';
      readonly presentationUnchanged: true;
      readonly refusal: 'INVALID_INPUT' | 'STALE_REVISION' | 'IDEMPOTENCY_CONFLICT' | 'UNAVAILABLE';
    });
export function admissionGmClientValue(value: unknown, path = '$'): AdmissionGmClientV3Message {
  const raw = wireCodecPrimitives.record(value, path);
  if (raw['messageType'] === 'network.admission-review.edit') {
    admissionGmClientBindingValue(value, path);
    return validated(value);
  }
  const row = exact(
    value,
    'messageType protocolVersion draftUpdateId contextId campaignId admissionBatchId sourceFormId expectedRevisions values',
    path,
  );
  wireCodecPrimitives.literal(
    row['messageType'],
    'network.admission-view.replace',
    `${path}.messageType`,
  );
  wireCodecPrimitives.literal(row['protocolVersion'], 3, `${path}.protocolVersion`);
  text(row['draftUpdateId'], `${path}.draftUpdateId`);
  for (const field of ['contextId', 'campaignId', 'admissionBatchId'])
    uuid(row[field], `${path}.${field}`);
  oneOf(row['sourceFormId'], ADMISSION_GM_VIEW_FORM_IDS, `${path}.sourceFormId`);
  wireCodecPrimitives.revisions(row['expectedRevisions'], `${path}.expectedRevisions`);
  admissionGmViewValuesValue(row['values'], `${path}.values`);
  return validated(row);
}
export function admissionGmHostValue(
  value: unknown,
  vocabulary: WireV2Vocabulary,
): AdmissionGmHostV3Message {
  const raw = wireCodecPrimitives.record(value, '$'),
    kind = oneOf(
      raw['messageType'],
      ['network.admission-draft.result', 'network.admission-draft.refusal'],
      '$.messageType',
    ),
    result = kind === 'network.admission-draft.result';
  const row = exact(
    value,
    'messageType protocolVersion draftUpdateId contextId campaignId admissionBatchId revisions ' +
      (result ? 'appliedRevisions projectionRole presentation' : 'presentationUnchanged refusal'),
    '$',
  );
  wireCodecPrimitives.literal(row['protocolVersion'], 3, '$.protocolVersion');
  const id = text(row['draftUpdateId'], '$.draftUpdateId');
  for (const field of ['contextId', 'campaignId', 'admissionBatchId'])
    uuid(row[field], `$.${field}`);
  const current = wireCodecPrimitives.revisions(row['revisions'], '$.revisions');
  if (!result) {
    wireCodecPrimitives.literal(row['presentationUnchanged'], true, '$.presentationUnchanged');
    oneOf(
      row['refusal'],
      ['INVALID_INPUT', 'STALE_REVISION', 'IDEMPOTENCY_CONFLICT', 'UNAVAILABLE'],
      '$.refusal',
    );
  } else {
    const applied = wireCodecPrimitives.revisions(row['appliedRevisions'], '$.appliedRevisions');
    for (const vector of [applied, current])
      if (
        vector.projectionRevision < vector.stateRevision ||
        vector.actorVisibilityRevision > vector.stateRevision
      )
        invalid('$.revisions', 'ordered admission revisions', null);
    for (const axis of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const)
      if (current[axis] < applied[axis])
        invalid('$.revisions', 'current at or after applied', null);
    wireCodecPrimitives.literal(row['projectionRole'], 'gm', '$.projectionRole');
    const presentation = exact(row['presentation'], 'base layers', '$.presentation');
    const base = wireCodecPrimitives.record(presentation['base'], '$.presentation.base');
    const forms = [
      base,
      ...list(presentation['layers'], '$.presentation.layers').map((layer) =>
        wireCodecPrimitives.record(layer, '$.layer'),
      ),
    ];
    for (const form of forms) {
      oneOf(form['formId'], [...ADMISSION_GM_VIEW_FORM_IDS, 'NET-017', 'CMP-006'], '$.formId');
      const payload = wireCodecPrimitives.record(
        form['roleFilteredPayload'],
        '$.roleFilteredPayload',
      );
      wireCodecPrimitives.literal(
        payload[form['formId'] === 'CMP-006' ? 'gmLocalContextId' : 'contextId'],
        text(row['contextId'], '$.contextId'),
        '$.contextId',
      );
      wireCodecPrimitives.literal(
        payload['campaignId'],
        text(row['campaignId'], '$.campaignId'),
        '$.campaignId',
      );
    }
    if (
      !encodeHostMessageV2(
        {
          messageType: 'projection.snapshot',
          protocolVersion: 2,
          projectionRole: 'gm',
          revisions: current,
          presentation: {
            assignment: { reason: 'HOST_SYSTEM_EVENT', correlationId: id },
            base: presentation['base'] as PresentedBaseForm,
            layers: presentation['layers'] as readonly PresentedLayerForm[],
          },
        },
        vocabulary,
      ).ok
    )
      invalid('$.presentation', 'valid GM admission presentation', null);
  }
  return validated(row);
}
export type AdmissionGmDecisionPayload = Omit<
  AdmissionGmDecisionRequest,
  'commandId' | 'decision'
> & {
  readonly contextId: string;
};
export type AdmissionGmWeaponPayload = {
  readonly contextId: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly reviewRevision: number;
  readonly reviewCopyId: string;
  readonly input: AdmissionWeaponResolutionInput;
};
export type AdmissionGmWorkflowRequest =
  | WorkflowCommandRequestMessage<
      'UI-CMD-ADMISSION-GM-ACCEPT' | 'UI-CMD-ADMISSION-GM-REJECT',
      AdmissionGmDecisionPayload
    >
  | (Omit<WorkflowCommandRequestMessage<'UI-CMD-GM-WEAPON-REQUEST-RESOLVE'>, 'payload'> & {
      readonly payload: AdmissionGmWeaponPayload;
    });
export type AdmissionGmClientRequest = AdmissionGmEditV3Message | AdmissionGmWorkflowRequest;
export interface AdmissionGmClientBinding {
  readonly commandId: string;
  readonly contextId: string;
  readonly campaignId: string;
  readonly admissionBatchId: string;
  readonly sourceFormId: AdmissionGmViewFormId;
  readonly expectedRevisions: RevisionVector;
  readonly reviewRevision: number;
  readonly intentOrNull: AdmissionReviewIntent | null;
  readonly decisionOrNull: AdmissionGmDecisionRequest | null;
}
/** Closed envelope plus exact semantic command; storage additionally proves its historical view. */
export function admissionGmClientBindingValue(
  value: unknown,
  path = '$',
): AdmissionGmClientBinding {
  const initial = wireCodecPrimitives.record(value, path);
  if (initial['messageType'] === 'network.admission-review.edit') {
    const row = exact(
      value,
      'messageType protocolVersion draftUpdateId contextId campaignId admissionBatchId sourceFormId expectedRevisions expectedReviewRevision intent',
      path,
    );
    if (row['protocolVersion'] !== 3) invalid(path, 'admission draft protocol 3', null);
    const intent = admissionReviewIntentValue(row['intent'], `${path}.intent`);
    if (intent.kind === 'WEAPON') invalid(path, 'separate weapon workflow', null);
    return {
      commandId: text(row['draftUpdateId'], `${path}.draftUpdateId`),
      contextId: uuid(row['contextId'], `${path}.contextId`),
      campaignId: uuid(row['campaignId'], `${path}.campaignId`),
      admissionBatchId: uuid(row['admissionBatchId'], `${path}.admissionBatchId`),
      sourceFormId: oneOf(
        row['sourceFormId'],
        ['NET-019', 'NET-020', 'GM-020'],
        `${path}.sourceFormId`,
      ),
      expectedRevisions: wireCodecPrimitives.revisions(
        row['expectedRevisions'],
        `${path}.expectedRevisions`,
      ),
      reviewRevision: integer(row['expectedReviewRevision'], `${path}.expectedReviewRevision`, 0),
      intentOrNull: intent,
      decisionOrNull: null,
    };
  }
  const row = exact(
    value,
    'messageType protocolVersion commandId commandKind workflowCommandId role expectedRevisions payload',
    path,
  );
  if (
    row['messageType'] !== 'command.request' ||
    row['protocolVersion'] !== 1 ||
    row['commandKind'] !== 'workflow-command' ||
    row['role'] !== 'gm'
  )
    invalid(path, 'GM workflow protocol 1', null);
  const workflow = oneOf(
    row['workflowCommandId'],
    [
      'UI-CMD-ADMISSION-GM-ACCEPT',
      'UI-CMD-ADMISSION-GM-REJECT',
      'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
    ],
    `${path}.workflowCommandId`,
  );
  const weapon = workflow === 'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
    p = exact(
      row['payload'],
      weapon
        ? 'contextId campaignId admissionBatchId reviewRevision reviewCopyId input'
        : 'contextId campaignId admissionBatchId reviewRevision expectedCampaignRevision previewChecksumOrNull reasonOrNull',
      `${path}.payload`,
    ),
    commandId = text(row['commandId'], `${path}.commandId`),
    campaignId = uuid(p['campaignId'], `${path}.payload.campaignId`),
    admissionBatchId = uuid(p['admissionBatchId'], `${path}.payload.admissionBatchId`),
    reviewRevision = integer(p['reviewRevision'], `${path}.payload.reviewRevision`, 0);
  return {
    commandId,
    contextId: uuid(p['contextId'], `${path}.payload.contextId`),
    campaignId,
    admissionBatchId,
    reviewRevision,
    sourceFormId: weapon
      ? 'GM-019'
      : workflow === 'UI-CMD-ADMISSION-GM-ACCEPT'
        ? 'NET-021'
        : 'NET-022',
    expectedRevisions: wireCodecPrimitives.revisions(
      row['expectedRevisions'],
      `${path}.expectedRevisions`,
    ),
    intentOrNull: weapon
      ? {
          kind: 'WEAPON',
          reviewCopyId: uuid(p['reviewCopyId'], `${path}.payload.reviewCopyId`),
          input: admissionWeaponResolutionInputValue(p['input'], `${path}.payload.input`),
        }
      : null,
    decisionOrNull: weapon
      ? null
      : admissionGmDecisionRequestValue({
          commandId,
          campaignId,
          admissionBatchId,
          reviewRevision,
          decision: workflow === 'UI-CMD-ADMISSION-GM-ACCEPT' ? 'ACCEPT' : 'REJECT',
          expectedCampaignRevision: p['expectedCampaignRevision'],
          previewChecksumOrNull: p['previewChecksumOrNull'],
          reasonOrNull: p['reasonOrNull'],
        }),
  };
}
export type AdmissionReviewOpenPayload = {
  readonly campaignId: string;
  readonly requestId: string;
  readonly requestRevision: number;
};
export interface AdmissionReviewOpenReceipt {
  readonly receiptId: string;
  readonly commandId: string;
  readonly workflowCommandId: 'UI-CMD-ADMISSION-REVIEW-OPEN';
  readonly campaignId: string;
  readonly requestId: string;
  readonly requestOwnerDeviceId: string;
  readonly admissionBatchId: string;
  readonly reviewCopies: readonly Readonly<{
    reviewCopyId: string;
    sourceUuid: string;
    sourceSnapshotId: string;
    snapshotChecksum: string;
  }>[];
  readonly reviewRevision: 0;
  readonly authoritativeGmActorId: string;
  readonly timestamp: string;
}

const { exact, uuid, text, list, unique, integer, oneOf, nullable, invalid, validated } =
  admissionCodecReaders;
function hash(value: unknown, path: string): void {
  if (!/^[0-9a-f]{64}$/u.test(text(value, path))) invalid(path, 'canonical SHA-256', null);
}
export function admissionWeaponResolutionInputValue(
  value: unknown,
  path = '$.weapon',
): AdmissionWeaponResolutionInput {
  const row = exact(value, 'weaponReviewInput decision overrideProfileOrNull reasonOrNull', path);
  const input = admissionWeaponReviewInputValue(
      row['weaponReviewInput'],
      `${path}.weaponReviewInput`,
    ),
    decision = oneOf(row['decision'], ['APPROVE', 'MASTER_OVERRIDE'], `${path}.decision`),
    profile = nullable(
      row['overrideProfileOrNull'],
      `${path}.overrideProfileOrNull`,
      admissionMasterWeaponProfileInputValue,
    ),
    reason = nullable(row['reasonOrNull'], `${path}.reasonOrNull`, text);
  if (input.kind === 'ADMISSION_GRANT') {
    if (decision !== 'MASTER_OVERRIDE' || profile !== null || reason !== null)
      invalid(path, 'grant profile and reason in the grant input only', null);
  } else if (
    decision === 'APPROVE'
      ? profile !== null || reason !== null
      : profile === null || reason === null || reason.trim() === ''
  )
    invalid(path, 'approval or complete master override', null);
  return validated(row);
}
export function admissionReviewMutationValue(
  value: unknown,
  path = '$.mutation',
): AdmissionReviewMutation {
  const initial = wireObject(value, path),
    kind = oneOf(
      initial['kind'],
      ['EDIT', 'ALLOCATE_ITEM', 'ALLOCATE_GROUP', 'WEAPON'],
      `${path}.kind`,
    );
  const row = exact(
    value,
    kind === 'EDIT'
      ? 'kind reviewCopyId inputs'
      : kind === 'ALLOCATE_ITEM'
        ? 'kind reviewCopyId reviewItemId'
        : kind === 'ALLOCATE_GROUP'
          ? 'kind groupDraftId'
          : 'kind reviewCopyId input',
    path,
  );
  if (kind === 'ALLOCATE_GROUP') uuid(row['groupDraftId'], `${path}.groupDraftId`);
  else {
    uuid(row['reviewCopyId'], `${path}.reviewCopyId`);
    if (kind === 'ALLOCATE_ITEM') uuid(row['reviewItemId'], `${path}.reviewItemId`);
    if (kind === 'EDIT') admissionReviewInputsValue(row['inputs'], `${path}.inputs`);
    if (kind === 'WEAPON') admissionWeaponResolutionInputValue(row['input'], `${path}.input`);
  }
  return validated(row);
}
function wireObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return invalid(path, 'object', null);
  return value as Record<string, unknown>;
}
export function admissionReviewIntentValue(
  value: unknown,
  path = '$.intent',
): AdmissionReviewIntent {
  const row = wireObject(value, path);
  if (row['kind'] === 'ALLOCATE_GROUP') exact(value, 'kind', path);
  else if (row['kind'] === 'ALLOCATE_ITEM') {
    exact(value, 'kind reviewCopyId', path);
    uuid(row['reviewCopyId'], `${path}.reviewCopyId`);
  } else admissionReviewMutationValue(value, path);
  return validated(row);
}
export function admissionReviewStateValue(value: unknown, path = '$.review'): AdmissionReviewState {
  const row = exact(
    value,
    'schemaVersion admissionBatchId requestId reviewRevision copies groupDraftIds',
    path,
  );
  if (row['schemaVersion'] !== 1) invalid(`${path}.schemaVersion`, '1', null);
  uuid(row['admissionBatchId'], `${path}.admissionBatchId`);
  text(row['requestId'], `${path}.requestId`);
  integer(row['reviewRevision'], `${path}.reviewRevision`, 0);
  const groups = list(row['groupDraftIds'], `${path}.groupDraftIds`).map((v, i) =>
    uuid(v, `${path}.groupDraftIds[${String(i)}]`),
  );
  unique(groups, `${path}.groupDraftIds`);
  const copies = list(row['copies'], `${path}.copies`).map((v, i) => {
    const p = `${path}.copies[${String(i)}]`,
      copy = exact(
        v,
        'reviewCopyId sourceUuid sourceSnapshotId snapshotChecksum reviewItemIdentities inputs weaponDecisions',
        p,
      );
    uuid(copy['reviewCopyId'], `${p}.reviewCopyId`);
    text(copy['sourceUuid'], `${p}.sourceUuid`);
    text(copy['sourceSnapshotId'], `${p}.sourceSnapshotId`);
    hash(copy['snapshotChecksum'], `${p}.snapshotChecksum`);
    const identities = list(copy['reviewItemIdentities'], `${p}.reviewItemIdentities`).map(
      (v, i) => {
        const q = `${p}.reviewItemIdentities[${String(i)}]`,
          item = exact(v, 'reviewItemId sourceEntryIdOrNull', q);
        uuid(item['reviewItemId'], `${q}.reviewItemId`);
        nullable(item['sourceEntryIdOrNull'], `${q}.sourceEntryIdOrNull`, text);
        return validated<AdmissionReviewItemIdentity>(item);
      },
    );
    unique(
      identities.map((item) => item.reviewItemId),
      `${p}.reviewItemIdentities`,
    );
    unique(
      identities.flatMap((item) =>
        item.sourceEntryIdOrNull === null ? [] : [item.sourceEntryIdOrNull],
      ),
      `${p}.reviewItemIdentities`,
    );
    const inputs = admissionReviewInputsValue(copy['inputs'], `${p}.inputs`);
    if (
      inputs.groupAssignmentOrNull?.kind === 'NEW' &&
      !groups.includes(inputs.groupAssignmentOrNull.groupDraftId)
    )
      invalid(`${p}.inputs.groupAssignmentOrNull`, 'owned group draft identity', null);
    const decisions = list(copy['weaponDecisions'], `${p}.weaponDecisions`).map((v, i) => {
      const q = `${p}.weaponDecisions[${String(i)}]`,
        decision = exact(v, 'receiptId input beforeProfileOrNull afterProfile reasonOrNull', q);
      uuid(decision['receiptId'], `${q}.receiptId`);
      admissionWeaponResolutionInputValue(decision['input'], `${q}.input`);
      nullable(
        decision['beforeProfileOrNull'],
        `${q}.beforeProfileOrNull`,
        admissionPublicWeaponProfileValue,
      );
      admissionPublicWeaponProfileValue(decision['afterProfile'], `${q}.afterProfile`);
      nullable(decision['reasonOrNull'], `${q}.reasonOrNull`, text);
      return validated<AdmissionStagedWeaponDecision>(decision);
    });
    unique(
      decisions.map((d) => d.receiptId),
      `${p}.weaponDecisions`,
    );
    return validated<AdmissionReviewCopyState>(copy);
  });
  if (copies.length < 1 || copies.length > 3)
    invalid(`${path}.copies`, 'one through three copies', null);
  unique(
    copies.map((c) => c.reviewCopyId),
    `${path}.copies`,
  );
  unique(
    copies.map((c) => c.sourceUuid),
    `${path}.copies`,
  );
  unique(
    copies.flatMap((c) => c.reviewItemIdentities.map((i) => i.reviewItemId)),
    `${path}.copies.items`,
  );
  return validated(row);
}
