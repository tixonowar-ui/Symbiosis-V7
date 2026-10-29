import type { ActionKey } from '@generated/types/atlas.js';
import type {
  CommandReceipt,
  DecodeResult,
  JsonObject,
  RevisionVector,
  WorkflowCommandId,
} from '@shared/index.js';
import {
  CAMPAIGN_CREATE_COMMAND_ID,
  campaignQrPayload,
  type CampaignArtValue,
  type CampaignCreationFormId,
  type CampaignCreationProjection,
  type CampaignCreateRequest,
  type CampaignCreateResult,
  type CampaignDraftReplaceV3Message,
  type CampaignDraftResultV3Message,
  type CampaignEditableFormId,
} from '@shared/campaign-creation.js';

export const CMP_CREATE_FORM_IDS = [
  'CMP-001',
  'CMP-002',
  'CMP-003',
  'CMP-004',
  'CMP-005',
  'CMP-006',
] as const;
export const CAMPAIGN_CREATION_FORMS = ['APP-011', ...CMP_CREATE_FORM_IDS] as const;
export const CAMPAIGN_CREATE_ACTION_KEY = 'CMP-005::CTA::001' as const;
export const GM_CONTEXT_STORAGE_KEY = 'symbiosis.gm-local-context.v1';
export type CampaignEdit = CampaignDraftReplaceV3Message extends infer Request
  ? Request extends CampaignDraftReplaceV3Message
    ? Pick<Request, 'variant' | 'values'>
    : never
  : never;

type ObjectValue = Record<string, unknown>;
type Check = (value: unknown) => boolean;
const record = (value: unknown): value is ObjectValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const object = (value: unknown, fields: Readonly<Record<string, Check>>): value is ObjectValue =>
  record(value) &&
  Object.keys(value).length === Object.keys(fields).length &&
  Object.entries(fields).every(([key, check]) => Object.hasOwn(value, key) && check(value[key]));
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const nullableHash = (value: unknown) => value === null || hash(value);
const capacity = (value: unknown) => integer(value) && value >= 1 && value <= 5;
const port = (value: unknown) => integer(value) && value >= 1 && value <= 65535;
const mode = (value: unknown) => value === 'MANUAL' || value === 'AUTO';
const nullableMode = (value: unknown) => value === null || mode(value);
const bool = (value: unknown) => typeof value === 'boolean';
const rows = (value: unknown, check: Check) => Array.isArray(value) && value.every(check);
const vectorFields = {
  stateRevision: integer,
  projectionRevision: integer,
  actorVisibilityRevision: integer,
};
const vector = (value: unknown) => object(value, vectorFields);
export const sameCampaignRevisions = (left: RevisionVector, right: RevisionVector): boolean =>
  left.stateRevision === right.stateRevision &&
  left.projectionRevision === right.projectionRevision &&
  left.actorVisibilityRevision === right.actorVisibilityRevision;
export const isCampaignCreationForm = (value: string): value is CampaignCreationFormId =>
  (CAMPAIGN_CREATION_FORMS as readonly string[]).includes(value);
export const isCampaignEditableForm = (value: string): value is CampaignEditableFormId =>
  ['CMP-001', 'CMP-002', 'CMP-003', 'CMP-004'].includes(value);

export function isCampaignArt(value: unknown): value is CampaignArtValue {
  if (
    !object(value, {
      kind: (v) => v === 'local-file',
      mediaType: (v) => v === 'image/png' || v === 'image/jpeg',
      bytesBase64: text,
    })
  )
    return false;
  const encoded = value['bytesBase64'] as string;
  if (encoded.length > 4 * Math.ceil((12 * 1024 * 1024) / 3)) return false;
  try {
    const binary = atob(encoded);
    if (btoa(binary) !== encoded || binary.length > 12 * 1024 * 1024) return false;
    const signature =
      value['mediaType'] === 'image/png'
        ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        : [0xff, 0xd8, 0xff];
    return signature.every((byte, index) => binary.charCodeAt(index) === byte);
  } catch {
    return false;
  }
}
export function validCampaignSecret(secret: string, confirmation: string): boolean {
  const length = [...secret].length;
  return (
    length >= 12 &&
    length <= 128 &&
    secret === confirmation &&
    !/[\p{Cc}\uD800-\uDFFF]/u.test(secret)
  );
}
export function isCampaignQrLocator(value: unknown): value is string {
  if (!text(value) || [...value].some((c) => c.charCodeAt(0) < 0x21 || c.charCodeAt(0) > 0x7e))
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' && url.username === '' && url.password === '' && url.href === value
    );
  } catch {
    return false;
  }
}
function qrMatches(value: ObjectValue): boolean {
  try {
    return (
      value['qrPayload'] ===
      campaignQrPayload(
        value['hostAddress'] as string,
        value['hostPort'] as number,
        value['campaignId'] as string,
      )
    );
  } catch {
    return false;
  }
}
const common = { gmLocalContextId: uuid, hostDeviceId: uuid, masterAuthorityRevision: integer };
const draft = {
  ...common,
  routeIdentityKind: (v: unknown) => v === 'CAMPAIGN_DRAFT',
  campaignDraftId: uuid,
  draftRevision: integer,
};
const metadata = {
  title: nullableText,
  description: nullableText,
  art: (v: unknown) => v === null || isCampaignArt(v),
};
const host = {
  activePlayerCapacity: (v: unknown) => v === null || capacity(v),
  hostAddress: nullableText,
  hostPort: (v: unknown) => v === null || port(v),
  networkInterface: nullableText,
};
const hostComplete = (value: ObjectValue) =>
  capacity(value['activePlayerCapacity']) &&
  text(value['hostAddress']) &&
  port(value['hostPort']) &&
  text(value['networkInterface']);
const timestamp = (v: unknown) =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const failed = <T>(path: string): DecodeResult<T> => ({
  ok: false,
  refusal: { code: 'UNRECOGNIZED', path, value: null },
});

/** Refusals contain a field address, never untrusted values that might contain a secret. */
export function decodeCampaignProjection(
  value: unknown,
  path: string,
  formId: CampaignCreationFormId,
): DecodeResult<CampaignCreationProjection> {
  let valid = false;
  switch (formId) {
    case 'APP-011':
      valid = object(value, {
        ...common,
        campaignLibraryState: (v) =>
          object(v, {
            status: (s) =>
              ['NO_CAMPAIGNS', 'DRAFT_AVAILABLE', 'HOST_RECOVERABLE'].includes(s as string),
            draftCount: integer,
            pausedCampaignCount: integer,
          }),
        masterAuthorityState: (v) =>
          object(v, {
            status: (s) => s === 'CONFIRMED_LOCAL',
            masterProfileId: uuid,
            revision: integer,
          }),
      });
      if (valid && record(value)) {
        const library = value['campaignLibraryState'] as ObjectValue;
        valid =
          (value['masterAuthorityState'] as ObjectValue)['revision'] ===
            value['masterAuthorityRevision'] &&
          (library['status'] === 'NO_CAMPAIGNS'
            ? library['draftCount'] === 0 && library['pausedCampaignCount'] === 0
            : library['status'] === 'DRAFT_AVAILABLE'
              ? (library['draftCount'] as number) > 0
              : (library['pausedCampaignCount'] as number) > 0);
      }
      break;
    case 'CMP-001':
      valid = object(value, {
        ...draft,
        title: nullableText,
        description: nullableText,
        artFilePickerState: (v) =>
          object(v, {
            status: (s) => s === 'EMPTY' || s === 'SELECTED',
            value: (a) => a === null || isCampaignArt(a),
          }),
        artAssetChecksumOrNull: nullableHash,
      });
      if (valid && record(value)) {
        const art = value['artFilePickerState'] as ObjectValue;
        valid =
          art['status'] === 'EMPTY'
            ? art['value'] === null && value['artAssetChecksumOrNull'] === null
            : art['value'] !== null && hash(value['artAssetChecksumOrNull']);
      }
      break;
    case 'CMP-002':
      valid = object(value, {
        ...draft,
        ...host,
        availableNetworkInterfaces: (v) =>
          rows(v, (r) =>
            object(r, {
              networkInterface: text,
              hostAddress: text,
              family: (f) => f === 'IPv4' || f === 'IPv6',
            }),
          ),
      });
      if (valid && record(value)) {
        const interfaces = value['availableNetworkInterfaces'] as ObjectValue[];
        valid =
          new Set(interfaces.map((r) => JSON.stringify([r['networkInterface'], r['hostAddress']])))
            .size === interfaces.length;
      }
      break;
    case 'CMP-003':
      valid = object(value, {
        ...draft,
        masterSecretConfigured: bool,
        passwordStrengthLocal: (v) =>
          object(v, {
            minimumCodePoints: (n) => n === 12,
            maximumCodePoints: (n) => n === 128,
            status: (s) => s === 'NOT_CONFIGURED' || s === 'CONFIGURED',
          }),
        secretPersistencePolicy: (v) => v === 'VERIFIER_ONLY_CLEAR_AFTER_SAVE',
      });
      if (valid && record(value))
        valid =
          (value['passwordStrengthLocal'] as ObjectValue)['status'] ===
          (value['masterSecretConfigured'] ? 'CONFIGURED' : 'NOT_CONFIGURED');
      break;
    case 'CMP-004':
      valid = object(value, {
        ...draft,
        defaultFutureRollMode: nullableMode,
        openRollRequestsUnaffected: (v) => v === true,
      });
      break;
    case 'CMP-005':
      valid = object(value, {
        ...draft,
        fullDraftSummary: (v) =>
          object(v, {
            metadata: (m) => object(m, metadata),
            host: (h) => object(h, host),
            defaultFutureRollMode: nullableMode,
            masterSecretConfigured: bool,
            artAssetChecksumOrNull: nullableHash,
          }),
        baselineVersion: text,
        catalogCompatibility: (v) =>
          object(v, {
            status: (s) => s === 'PASS' || s === 'FAIL',
            registryVersion: text,
            catalogVersion: text,
            builtAgainstTuple: text,
            reasonCode: (r) => r === null || r === 'BASELINE_MISMATCH',
          }),
        hostBindPreflight: (v) =>
          object(v, {
            status: (s) => ['NOT_CHECKED', 'PASS', 'FAIL'].includes(s as string),
            leaseIdOrNull: (id) => id === null || text(id),
            reasonCode: (r) =>
              r === null ||
              ['INVALID_INTERFACE', 'PORT_UNAVAILABLE', 'BIND_FAILED', 'LEASE_EXPIRED'].includes(
                r as string,
              ),
          }),
        activePlayerCount: (v) => v === 0,
        validationStatus: (s) => s === 'READY_TO_CREATE' || s === 'PREFLIGHT_BLOCKED',
        commandId: (v) => v === null || text(v),
      });
      if (valid && record(value)) {
        const summary = value['fullDraftSummary'] as ObjectValue,
          catalog = value['catalogCompatibility'] as ObjectValue,
          bind = value['hostBindPreflight'] as ObjectValue;
        const complete =
          text((summary['metadata'] as ObjectValue)['title']) &&
          ((summary['metadata'] as ObjectValue)['title'] as string).trim().length > 0 &&
          hostComplete(summary['host'] as ObjectValue) &&
          mode(summary['defaultFutureRollMode']) &&
          summary['masterSecretConfigured'] === true;
        const ready = complete && catalog['status'] === 'PASS' && bind['status'] === 'PASS';
        valid =
          (catalog['status'] === 'PASS'
            ? catalog['reasonCode'] === null
            : catalog['reasonCode'] === 'BASELINE_MISMATCH') &&
          (bind['status'] === 'PASS'
            ? text(bind['leaseIdOrNull']) && bind['reasonCode'] === null
            : bind['leaseIdOrNull'] === null &&
              (bind['status'] === 'NOT_CHECKED'
                ? bind['reasonCode'] === null
                : bind['reasonCode'] !== null)) &&
          value['validationStatus'] === (ready ? 'READY_TO_CREATE' : 'PREFLIGHT_BLOCKED') &&
          ((summary['metadata'] as ObjectValue)['art'] === null
            ? summary['artAssetChecksumOrNull'] === null
            : hash(summary['artAssetChecksumOrNull']));
      }
      break;
    case 'CMP-006':
      valid = object(value, {
        ...common,
        routeIdentityKind: (v) => v === 'CAMPAIGN',
        campaignId: uuid,
        sourceCampaignDraftId: uuid,
        status: (v) => v === 'PAUSED',
        createdAt: timestamp,
        hostAddress: text,
        hostPort: port,
        networkInterface: text,
        qrPayload: isCampaignQrLocator,
        activePlayerCapacity: capacity,
        creationReceiptId: text,
        creationCommandId: text,
        hostBindRecovery: (v) =>
          object(v, {
            status: (s) => s === 'RESERVED' || s === 'UNAVAILABLE',
            reasonCode: (r) => r === null || r === 'PORT_UNAVAILABLE' || r === 'BIND_FAILED',
          }),
      });
      if (valid && record(value)) {
        const bind = value['hostBindRecovery'] as ObjectValue;
        valid =
          (bind['status'] === 'RESERVED'
            ? bind['reasonCode'] === null
            : bind['reasonCode'] !== null) && qrMatches(value);
      }
  }
  return valid ? { ok: true, value: value as CampaignCreationProjection } : failed(path);
}

export function expectedCampaignActions(
  formId: CampaignCreationFormId,
  projection: JsonObject,
  capabilities: readonly WorkflowCommandId[],
): readonly ActionKey[] {
  const p = projection;
  switch (formId) {
    case 'APP-011':
      return ['APP-011::CTA::001', 'APP-011::CTA::006'];
    case 'CMP-001':
      return text(p['title']) && p['title'].trim().length > 0
        ? ['CMP-001::CTA::001', 'CMP-001::CTA::002']
        : ['CMP-001::CTA::002'];
    case 'CMP-002':
      return hostComplete(p) &&
        (p['availableNetworkInterfaces'] as ObjectValue[]).some(
          (v) =>
            v['networkInterface'] === p['networkInterface'] &&
            v['hostAddress'] === p['hostAddress'],
        )
        ? ['CMP-002::CTA::001', 'CMP-002::CTA::002']
        : ['CMP-002::CTA::001'];
    case 'CMP-003':
      return p['masterSecretConfigured'] === true
        ? ['CMP-003::CTA::001', 'CMP-003::CTA::002']
        : ['CMP-003::CTA::001'];
    case 'CMP-004':
      return mode(p['defaultFutureRollMode'])
        ? ['CMP-004::CTA::001', 'CMP-004::CTA::002']
        : ['CMP-004::CTA::001'];
    case 'CMP-005':
      return p['validationStatus'] === 'READY_TO_CREATE' &&
        capabilities.includes(CAMPAIGN_CREATE_COMMAND_ID)
        ? ['CMP-005::CTA::001', 'CMP-005::CTA::002']
        : ['CMP-005::CTA::002'];
    case 'CMP-006':
      return [];
  }
}

export function campaignEditFromProjection(
  formId: CampaignEditableFormId,
  p: JsonObject,
): CampaignEdit | null {
  switch (formId) {
    case 'CMP-001':
      return {
        variant: 'METADATA',
        values: {
          title: p['title'] as string | null,
          description: p['description'] as string | null,
          art: (p['artFilePickerState'] as JsonObject)['value'] as CampaignArtValue | null,
        },
      };
    case 'CMP-002':
      return {
        variant: 'HOST',
        values: {
          activePlayerCapacity: p['activePlayerCapacity'] as number | null,
          hostAddress: p['hostAddress'] as string | null,
          hostPort: p['hostPort'] as number | null,
          networkInterface: p['networkInterface'] as string | null,
        },
      };
    case 'CMP-003':
      return null;
    case 'CMP-004':
      return {
        variant: 'MODE',
        values: { defaultFutureRollMode: p['defaultFutureRollMode'] as 'MANUAL' | 'AUTO' | null },
      };
  }
}

export function campaignEditIsSendable(edit: CampaignEdit): boolean {
  switch (edit.variant) {
    case 'METADATA':
      return object(edit.values, metadata);
    case 'HOST':
      return object(edit.values, host);
    case 'SECRET':
      return validCampaignSecret(
        edit.values.masterTransferPassword,
        edit.values.masterTransferPasswordConfirmation,
      );
    case 'MODE':
      return object(edit.values, { defaultFutureRollMode: nullableMode });
  }
}

export function campaignDraftResultMatches(
  message: CampaignDraftResultV3Message,
  request: CampaignDraftReplaceV3Message,
  projection: JsonObject,
): boolean {
  const increment = message.changed ? 1 : 0;
  const expected = request.expectedRevisions;
  return (
    message.draftUpdateId === request.draftUpdateId &&
    message.scope.gmLocalContextId === request.scope.gmLocalContextId &&
    message.scope.campaignDraftId === request.scope.campaignDraftId &&
    message.scope.sourceFormId === request.scope.sourceFormId &&
    message.appliedDraftRevision === request.expectedDraftRevision + increment &&
    sameCampaignRevisions(message.appliedRevisions, {
      stateRevision: expected.stateRevision + increment,
      projectionRevision: expected.projectionRevision + increment,
      actorVisibilityRevision: expected.actorVisibilityRevision,
    }) &&
    message.draftRevision >= message.appliedDraftRevision &&
    message.revisions.stateRevision >= message.appliedRevisions.stateRevision &&
    message.revisions.projectionRevision >= message.appliedRevisions.projectionRevision &&
    message.revisions.actorVisibilityRevision ===
      message.appliedRevisions.actorVisibilityRevision &&
    projection['gmLocalContextId'] === request.scope.gmLocalContextId &&
    projection['campaignDraftId'] === request.scope.campaignDraftId &&
    projection['draftRevision'] === message.draftRevision
  );
}

export function decodeCampaignCreateReceipt(
  value: unknown,
  request: CampaignCreateRequest,
  source: JsonObject,
): DecodeResult<CommandReceipt<CampaignCreateResult>> {
  if (
    !object(value, {
      commandId: text,
      receiptId: text,
      revisions: vector,
      result: (v) =>
        object(v, {
          stage: (s) => s === 'CAMPAIGN_CREATE',
          gmLocalContextId: uuid,
          campaignDraftId: uuid,
          campaignId: uuid,
          status: (s) => s === 'PAUSED',
          createdAt: timestamp,
          creationReceiptId: text,
          sourceDraftRevision: integer,
          sourceRevisions: vector,
          targetRevisions: vector,
          hostAddress: text,
          hostPort: port,
          networkInterface: text,
          activePlayerCapacity: capacity,
          defaultFutureRollMode: mode,
          qrPayload: isCampaignQrLocator,
          baselineVersion: text,
        }),
    })
  )
    return failed('$.receipt');
  const receipt = value as unknown as CommandReceipt<CampaignCreateResult>,
    result = receipt.result;
  const summary = source['fullDraftSummary'] as JsonObject,
    configuredHost = summary['host'] as JsonObject;
  if (
    receipt.commandId !== request.commandId ||
    receipt.receiptId === request.commandId ||
    result.creationReceiptId !== receipt.receiptId ||
    result.campaignId === result.campaignDraftId ||
    result.gmLocalContextId !== request.payload.gmLocalContextId ||
    result.campaignDraftId !== request.payload.campaignDraftId ||
    result.sourceDraftRevision !== request.payload.draftRevision ||
    !sameCampaignRevisions(result.sourceRevisions, request.expectedRevisions) ||
    !sameCampaignRevisions(result.targetRevisions, {
      stateRevision: 0,
      projectionRevision: 0,
      actorVisibilityRevision: 0,
    }) ||
    !sameCampaignRevisions(receipt.revisions, result.targetRevisions) ||
    result.hostAddress !== configuredHost['hostAddress'] ||
    result.hostPort !== configuredHost['hostPort'] ||
    result.networkInterface !== configuredHost['networkInterface'] ||
    result.activePlayerCapacity !== configuredHost['activePlayerCapacity'] ||
    result.defaultFutureRollMode !== summary['defaultFutureRollMode'] ||
    result.baselineVersion !== source['baselineVersion'] ||
    !qrMatches(result)
  )
    return failed('$.receipt.result');
  return { ok: true, value: receipt };
}

export function campaignCreateDestinationMatches(
  formId: string,
  p: JsonObject,
  revisions: RevisionVector,
  receipt: CommandReceipt<CampaignCreateResult>,
): boolean {
  const r = receipt.result;
  return (
    formId === 'CMP-006' &&
    sameCampaignRevisions(revisions, r.targetRevisions) &&
    p['gmLocalContextId'] === r.gmLocalContextId &&
    p['sourceCampaignDraftId'] === r.campaignDraftId &&
    p['campaignId'] === r.campaignId &&
    p['creationReceiptId'] === receipt.receiptId &&
    p['creationCommandId'] === receipt.commandId &&
    p['status'] === r.status &&
    p['createdAt'] === r.createdAt &&
    p['hostAddress'] === r.hostAddress &&
    p['hostPort'] === r.hostPort &&
    p['networkInterface'] === r.networkInterface &&
    p['activePlayerCapacity'] === r.activePlayerCapacity &&
    p['qrPayload'] === r.qrPayload
  );
}
