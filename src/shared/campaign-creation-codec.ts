import { wireCodecPrimitives } from './wire-codec.js';
import { encodeHostMessageV2 } from './wire-v2-codec.js';
import type { WireV2Vocabulary, PresentedBaseForm } from './wire-v2-protocol.js';
import type { RevisionVector } from './wire-protocol.js';
import type {
  CampaignDraftReplaceV3Message,
  CampaignLocalContextResumeV3Message,
  CampaignDraftResultV3Message,
  CampaignDraftRefusalV3Message,
  CampaignDraftScope,
  CampaignArtValue,
} from './campaign-creation.js';

const {
  exact,
  literal,
  string: text,
  revision,
  revisions,
  jsonObject,
  validated,
  capabilityId,
  abortInvalid: invalid,
  abortUnrecognized: unrecognized,
} = wireCodecPrimitives;
const EDITABLE = new Set(['CMP-001', 'CMP-002', 'CMP-003', 'CMP-004']);
const FORMS = new Set([...EDITABLE, 'CMP-005']);
const VARIANTS = {
  METADATA: 'CMP-001',
  HOST: 'CMP-002',
  SECRET: 'CMP-003',
  MODE: 'CMP-004',
} as const;
const FORBIDDEN_READ_KEYS = new Set([
  'masterTransferPassword',
  'masterTransferPasswordConfirmation',
  'masterSecretVerifier',
  'saltBase64',
  'verifierBase64',
]);
const array = (value: unknown, path: string): readonly unknown[] =>
  Array.isArray(value) ? value : invalid(path, 'array', value);
const rawString = (value: unknown, path: string): string =>
  typeof value === 'string' ? value : invalid(path, 'string', value);
const nullableString = (value: unknown, path: string): string | null =>
  value === null ? null : rawString(value, path);
const number = (value: unknown, path: string): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Object.is(value, -0)
      ? 0
      : value
    : invalid(path, 'finite number', value);
const normalizedRevisions = (value: unknown, path: string): RevisionVector => {
  const vector = revisions(value, path);
  return {
    stateRevision: vector.stateRevision + 0,
    projectionRevision: vector.projectionRevision + 0,
    actorVisibilityRevision: vector.actorVisibilityRevision + 0,
  };
};
const scopeAt = (value: unknown, path: string): CampaignDraftScope => {
  const scope = exact(value, 'campaignDraftId gmLocalContextId sourceFormId', path);
  const form = text(scope['sourceFormId'], `${path}.sourceFormId`);
  if (!EDITABLE.has(form)) return unrecognized(`${path}.sourceFormId`, form);
  return {
    campaignDraftId: text(scope['campaignDraftId'], `${path}.campaignDraftId`),
    gmLocalContextId: text(scope['gmLocalContextId'], `${path}.gmLocalContextId`),
    sourceFormId: form as CampaignDraftScope['sourceFormId'],
  };
};
const uniqueStrings = (
  value: unknown,
  path: string,
  read: (v: unknown, p: string) => string = text,
): readonly string[] => {
  const result = array(value, path).map((v, i) => read(v, `${path}[${String(i)}]`));
  if (new Set(result).size !== result.length) return invalid(path, 'unique entries', null);
  return result;
};
function artAt(value: unknown, path: string): CampaignArtValue | null {
  if (value === null) return null;
  const art = exact(value, 'bytesBase64 kind mediaType', path);
  literal(art['kind'], 'local-file', `${path}.kind`);
  const mediaType = art['mediaType'];
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg')
    return unrecognized(`${path}.mediaType`, null);
  return {
    kind: 'local-file',
    mediaType,
    bytesBase64: rawString(art['bytesBase64'], `${path}.bytesBase64`),
  };
}
export function campaignClientValue(
  value: unknown,
): CampaignDraftReplaceV3Message | CampaignLocalContextResumeV3Message {
  const message = jsonObject(value, '$');
  literal(message['protocolVersion'], 3, '$.protocolVersion');
  if (message['messageType'] === 'campaign.local-context.resume') {
    const r = exact(
      value,
      'gmLocalContextId knownRevisions messageType protocolVersion reconnectRequestId supportedWorkflowCommandIds unacknowledgedCommandIds',
    );
    return {
      messageType: 'campaign.local-context.resume',
      protocolVersion: 3,
      gmLocalContextId: text(r['gmLocalContextId'], '$.gmLocalContextId'),
      reconnectRequestId: text(r['reconnectRequestId'], '$.reconnectRequestId'),
      knownRevisions: normalizedRevisions(r['knownRevisions'], '$.knownRevisions'),
      supportedWorkflowCommandIds: uniqueStrings(
        r['supportedWorkflowCommandIds'],
        '$.supportedWorkflowCommandIds',
        capabilityId,
      ) as CampaignLocalContextResumeV3Message['supportedWorkflowCommandIds'],
      unacknowledgedCommandIds: uniqueStrings(
        r['unacknowledgedCommandIds'],
        '$.unacknowledgedCommandIds',
      ),
    };
  }
  if (message['messageType'] !== 'campaign.draft.replace')
    return unrecognized('$.messageType', null);
  const r = exact(
    value,
    'draftUpdateId expectedDraftRevision expectedRevisions messageType protocolVersion scope values variant',
  );
  const scope = scopeAt(r['scope'], '$.scope');
  const variant = text(r['variant'], '$.variant');
  if (
    !Object.hasOwn(VARIANTS, variant) ||
    VARIANTS[variant as keyof typeof VARIANTS] !== scope.sourceFormId
  )
    return unrecognized('$.variant', variant);
  const common = {
    messageType: 'campaign.draft.replace' as const,
    protocolVersion: 3 as const,
    draftUpdateId: text(r['draftUpdateId'], '$.draftUpdateId'),
    expectedDraftRevision: revision(r['expectedDraftRevision'], '$.expectedDraftRevision') + 0,
    expectedRevisions: normalizedRevisions(r['expectedRevisions'], '$.expectedRevisions'),
  };
  if (variant === 'METADATA') {
    const v = exact(r['values'], 'art description title', '$.values');
    return {
      ...common,
      variant,
      scope: { ...scope, sourceFormId: 'CMP-001' },
      values: {
        title: nullableString(v['title'], '$.values.title'),
        description: nullableString(v['description'], '$.values.description'),
        art: artAt(v['art'], '$.values.art'),
      },
    };
  }
  if (variant === 'HOST') {
    const v = exact(
      r['values'],
      'activePlayerCapacity hostAddress hostPort networkInterface',
      '$.values',
    );
    return {
      ...common,
      variant,
      scope: { ...scope, sourceFormId: 'CMP-002' },
      values: {
        activePlayerCapacity:
          v['activePlayerCapacity'] === null
            ? null
            : number(v['activePlayerCapacity'], '$.values.activePlayerCapacity'),
        hostAddress: nullableString(v['hostAddress'], '$.values.hostAddress'),
        hostPort: v['hostPort'] === null ? null : number(v['hostPort'], '$.values.hostPort'),
        networkInterface: nullableString(v['networkInterface'], '$.values.networkInterface'),
      },
    };
  }
  if (variant === 'SECRET') {
    const v = exact(
      r['values'],
      'masterTransferPassword masterTransferPasswordConfirmation',
      '$.values',
    );
    return {
      ...common,
      variant,
      scope: { ...scope, sourceFormId: 'CMP-003' },
      values: {
        masterTransferPassword: rawString(
          v['masterTransferPassword'],
          '$.values.masterTransferPassword',
        ),
        masterTransferPasswordConfirmation: rawString(
          v['masterTransferPasswordConfirmation'],
          '$.values.masterTransferPasswordConfirmation',
        ),
      },
    };
  }
  const v = exact(r['values'], 'defaultFutureRollMode', '$.values');
  const mode = v['defaultFutureRollMode'];
  if (mode !== null && mode !== 'AUTO' && mode !== 'MANUAL')
    return unrecognized('$.values.defaultFutureRollMode', null);
  return {
    ...common,
    variant: 'MODE',
    scope: { ...scope, sourceFormId: 'CMP-004' },
    values: { defaultFutureRollMode: mode },
  };
}
function publicRead(value: unknown, path: string): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => publicRead(v, `${path}[${String(i)}]`));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_READ_KEYS.has(key))
      invalid(`${path}.${key}`, 'campaign read without private secret fields', null);
    publicRead(item, `${path}.${key}`);
  }
}
function refusalAt(value: unknown): void {
  const r = jsonObject(value, '$.refusal');
  const code = r['code'];
  if (code === 'INVALID_FIELD') {
    exact(value, 'code error', '$.refusal');
    const e = exact(r['error'], 'field reason', '$.refusal.error');
    if (
      !new Set([
        'title',
        'description',
        'art',
        'activePlayerCapacity',
        'hostAddress',
        'hostPort',
        'networkInterface',
        'masterTransferPassword',
        'masterTransferPasswordConfirmation',
        'defaultFutureRollMode',
      ]).has(text(e['field'], '$.refusal.error.field'))
    )
      unrecognized('$.refusal.error.field', null);
    if (
      !new Set([
        'REQUIRED',
        'INVALID_TYPE',
        'INVALID_VALUE',
        'INVALID_LENGTH',
        'DISALLOWED_CHARACTERS',
        'CONFIRMATION_MISMATCH',
        'UNSUPPORTED_INTERFACE',
        'INVALID_IMAGE',
      ]).has(text(e['reason'], '$.refusal.error.reason'))
    )
      unrecognized('$.refusal.error.reason', null);
  } else if (code === 'STALE_DRAFT') {
    exact(value, 'actual code expected', '$.refusal');
    revision(r['expected'], '$.refusal.expected');
    revision(r['actual'], '$.refusal.actual');
  } else if (code === 'STALE_REVISION') {
    exact(value, 'actual code expected', '$.refusal');
    revisions(r['expected'], '$.refusal.expected');
    revisions(r['actual'], '$.refusal.actual');
  } else if (
    code === 'IDEMPOTENCY_CONFLICT' ||
    code === 'DRAFT_UNAVAILABLE' ||
    code === 'REVISION_OVERFLOW'
  )
    exact(value, 'code', '$.refusal');
  else unrecognized('$.refusal.code', null);
}
export function campaignHostValue(
  value: unknown,
  vocabulary: WireV2Vocabulary,
): CampaignDraftResultV3Message | CampaignDraftRefusalV3Message {
  const message = jsonObject(value, '$');
  literal(message['protocolVersion'], 3, '$.protocolVersion');
  if (message['messageType'] === 'campaign.draft.refusal') {
    const r = exact(
      value,
      'draftUpdateId messageType presentationUnchanged protocolVersion refusal revisions scope',
    );
    text(r['draftUpdateId'], '$.draftUpdateId');
    scopeAt(r['scope'], '$.scope');
    const current = revisions(r['revisions'], '$.revisions');
    literal(r['presentationUnchanged'], true, '$.presentationUnchanged');
    refusalAt(r['refusal']);
    if ((r['refusal'] as { readonly code: string }).code === 'STALE_REVISION') {
      const actual = (r['refusal'] as { readonly actual: RevisionVector }).actual;
      for (const axis of [
        'stateRevision',
        'projectionRevision',
        'actorVisibilityRevision',
      ] as const)
        if (actual[axis] !== current[axis]) unrecognized(`$.refusal.actual.${axis}`, null);
    }
    return validated(value);
  }
  if (message['messageType'] !== 'campaign.draft.result')
    return unrecognized('$.messageType', null);
  const r = exact(
    value,
    'appliedDraftRevision appliedRevisions changed draftRevision draftUpdateId messageType presentation projectionRole protocolVersion revisions scope',
  );
  const id = text(r['draftUpdateId'], '$.draftUpdateId'),
    scope = scopeAt(r['scope'], '$.scope');
  if (typeof r['changed'] !== 'boolean') return invalid('$.changed', 'boolean', r['changed']);
  const appliedRevision = revision(r['appliedDraftRevision'], '$.appliedDraftRevision'),
    currentRevision = revision(r['draftRevision'], '$.draftRevision');
  const applied = revisions(r['appliedRevisions'], '$.appliedRevisions'),
    current = revisions(r['revisions'], '$.revisions');
  if (
    currentRevision < appliedRevision ||
    current.stateRevision !== currentRevision ||
    applied.stateRevision !== appliedRevision ||
    current.projectionRevision < applied.projectionRevision ||
    current.projectionRevision < current.stateRevision ||
    applied.projectionRevision < applied.stateRevision ||
    current.actorVisibilityRevision !== 0 ||
    applied.actorVisibilityRevision !== 0
  )
    return invalid('$.revisions', 'ordered campaign draft revision owners', null);
  literal(r['projectionRole'], 'gm', '$.projectionRole');
  const presentation = exact(r['presentation'], 'base layers', '$.presentation');
  if (array(presentation['layers'], '$.presentation.layers').length !== 0)
    return invalid('$.presentation.layers', 'empty campaign layers', null);
  const base = jsonObject(presentation['base'], '$.presentation.base');
  const form = text(base['formId'], '$.presentation.base.formId');
  if (!FORMS.has(form)) return unrecognized('$.presentation.base.formId', form);
  const payload = jsonObject(
    base['roleFilteredPayload'],
    '$.presentation.base.roleFilteredPayload',
  );
  literal(
    payload['gmLocalContextId'],
    scope.gmLocalContextId,
    '$.presentation.base.roleFilteredPayload.gmLocalContextId',
  );
  literal(
    payload['campaignDraftId'],
    scope.campaignDraftId,
    '$.presentation.base.roleFilteredPayload.campaignDraftId',
  );
  literal(
    payload['draftRevision'],
    currentRevision,
    '$.presentation.base.roleFilteredPayload.draftRevision',
  );
  publicRead(payload, '$.presentation.base.roleFilteredPayload');
  const encoded = encodeHostMessageV2(
    {
      messageType: 'projection.snapshot',
      protocolVersion: 2,
      projectionRole: 'gm',
      revisions: current,
      presentation: {
        assignment: { reason: 'RECONNECT', correlationId: id },
        base: base as unknown as PresentedBaseForm,
        layers: [],
      },
    },
    vocabulary,
  );
  if (!encoded.ok) return invalid('$.presentation', 'valid signed campaign presentation', null);
  return validated(value);
}
