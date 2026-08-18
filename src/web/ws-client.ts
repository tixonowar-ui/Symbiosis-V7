import { FORM_IDS } from '@generated/types/atlas.js';
import type { ActionKey, FormId } from '@generated/types/atlas.js';
import {
  decodeHostMessage,
  decodeHostMessageV2,
  encodeClientMessage,
  encodeClientMessageV2,
  WIRE_PROTOCOL_VERSION,
  WIRE_PROTOCOL_V2_VERSION,
} from '@shared/index.js';
import type {
  AddressableRouteTemplate,
  DecodeRefusal,
  DecodeResult,
  FormActionIntentV2Message,
  FormActionRefusalV2Message,
  IdentityDraftValues,
  JsonObject,
  JsonValue,
  ProjectionSnapshotV2Message,
  ProtocolRefusalMessage,
  ProtocolVocabulary,
  RevisionVector,
  SessionReconnectCapabilitiesV2Message,
  SessionReconnectV2Message,
  WireV2Vocabulary,
  WorkflowCommandId,
} from '@shared/index.js';

import { isImplementedFormActionKey, presentedFormDefinition } from './forms/index.js';
import {
  IdentityDraftClient,
  type IdentityDraftClientState,
  type IdentityDraftSnapshot,
} from './identity-draft-client.js';

export type { IdentityDraftClientState, IdentityDraftValues };

const FORM_ID_SET: ReadonlySet<string> = new Set(FORM_IDS);

/**
 * The four presentation shapes are the exact implemented slice. Addressable
 * routes remain out of scope and therefore fail closed.
 */
export const WEB_PROTOCOL_VOCABULARY: ProtocolVocabulary & WireV2Vocabulary = {
  isAddressableRouteTemplate: (_value): _value is AddressableRouteTemplate => false,
  isClientRouteBindings: () => false,
  isFormActionKey: isImplementedFormActionKey,
  isFormId: (value): value is FormId => FORM_ID_SET.has(value),
  isHostTransition: () => false,
  isPresentedForm: (formId, formType, routeTemplate, bindings) => {
    const definition = presentedFormDefinition(formId);
    if (definition === null || formType !== 'screen' || routeTemplate !== definition.route)
      return false;
    if (formId !== 'CHR-001') return bindings.length === 0;
    const binding = bindings[0];
    return (
      bindings.length === 1 &&
      binding !== undefined &&
      binding.parameterIndex === 0 &&
      binding.source === 'executor-allocated' &&
      UUID_PATTERN.test(binding.value)
    );
  },
  isWorkflowCommandId: (_value): _value is WorkflowCommandId => false,
};

const NO_KNOWN_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;
const DEVICE_ID_KEYS = new Set(['deviceId']);
const DEVICE_ID_ERROR_KEYS = new Set(['error']);
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Sources: generated/spec/atlas/forms-by-id.json["APP-001"].requiredFields
 * for the four host-owned values (`formId` is the projection identity), and
 * generated/spec/atlas/forms-by-id.json["APP-001"].guardStates for
 * `bootState=BOOTING|READY|ERROR`.
 */
const APP_001_KEYS = new Set([
  'baselineCompatibility',
  'bootState',
  'buildVersion',
  'formId',
  'integrityStatus',
]);
const APP_001_BOOT_STATES: ReadonlySet<string> = new Set(['BOOTING', 'READY', 'ERROR']);
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const BASELINE_COMPATIBILITY_KEYS = new Set([
  'builtAgainstTuple',
  'catalogVersion',
  'registryVersion',
]);
const BASELINE_VALUE_KEYS = new Set(['status', 'value']);
const INTEGRITY_STATUS_KEYS = new Set(['changed', 'missing', 'ok', 'tracked', 'untracked']);

export interface BaselineValue extends JsonObject {
  readonly status: 'PASS';
  readonly value: string;
}

export interface BaselineCompatibility extends JsonObject {
  readonly builtAgainstTuple: BaselineValue;
  readonly catalogVersion: BaselineValue;
  readonly registryVersion: BaselineValue;
}

export interface IntegrityStatus extends JsonObject {
  readonly changed: readonly string[];
  readonly missing: readonly string[];
  readonly ok: boolean;
  readonly tracked: number;
  readonly untracked: readonly string[];
}

export interface App001Projection extends JsonObject {
  readonly baselineCompatibility: BaselineCompatibility;
  readonly bootState: 'BOOTING' | 'ERROR' | 'READY';
  readonly buildVersion: string;
  readonly formId: 'APP-001';
  readonly integrityStatus: IntegrityStatus;
}

export interface App004Projection extends JsonObject {
  readonly campaignAuthority: false;
  readonly draftCharacterIds: readonly string[];
  readonly finalCharacterIds: readonly string[];
  readonly handoffIdOrNull: null;
  readonly handoffReceiptIdOrNull: null;
  readonly launchContext: 'PLAYER_MENU';
  readonly localCharacterLibraryRevision: number;
  readonly localOwnerIdOrNull: null;
  readonly projectionRevision: number;
  readonly returnContext: 'PLAYER_MENU';
  readonly stateRevision: number;
}

export interface ConfirmedProjectionSnapshot {
  readonly availableActionKeys: readonly ActionKey[];
  readonly executableWorkflowCommandIds: readonly WorkflowCommandId[];
  readonly formId: 'APP-001' | 'APP-002' | 'APP-004' | 'CHR-001';
  readonly path: string;
  readonly projection: JsonObject;
  readonly revisions: RevisionVector;
}

export type WebClientState =
  | { readonly kind: 'awaiting-snapshot' }
  | { readonly kind: 'client-error'; readonly detail: string }
  | { readonly kind: 'connecting' }
  | {
      readonly code: number | null;
      readonly detail: string;
      readonly kind: 'disconnected';
      readonly snapshot: ConfirmedProjectionSnapshot | null;
    }
  | {
      readonly kind: 'host-refusal';
      readonly refusal: DecodeRefusal;
      readonly snapshot: ConfirmedProjectionSnapshot | null;
    }
  | {
      readonly detail: string;
      readonly kind: 'protocol-error';
      readonly refusal: DecodeRefusal;
      readonly snapshot: ConfirmedProjectionSnapshot | null;
    }
  | {
      readonly kind: 'navigation-refusal';
      readonly refusal: FormActionRefusalV2Message['refusal'];
      readonly snapshot: ConfirmedProjectionSnapshot;
    }
  | { readonly kind: 'ready'; readonly snapshot: ConfirmedProjectionSnapshot };

export type FormActionRequestResult =
  { readonly ok: false; readonly detail: string } | { readonly ok: true };

export interface ProjectionConnection {
  disconnect(): void;
  reconnect(): FormActionRequestResult;
  replaceIdentityDraft(values: IdentityDraftValues): FormActionRequestResult;
  requestFormAction(actionKey: ActionKey): FormActionRequestResult;
}

function refused<T>(refusal: DecodeRefusal): DecodeResult<T> {
  return { ok: false, refusal };
}

function unrecognized<T>(path: string, value: JsonValue): DecodeResult<T> {
  return refused({ code: 'UNRECOGNIZED', path, value });
}

function wireType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactObjectKeys(
  value: JsonObject,
  expectedKeys: ReadonlySet<string>,
  path: string,
): DecodeResult<null> {
  for (const key of Object.keys(value)) {
    if (expectedKeys.has(key)) continue;
    const unexpected = value[key];
    if (unexpected === undefined) {
      return refused({
        actualType: 'undefined',
        code: 'INVALID_SHAPE',
        expected: 'JSON value',
        path: `${path}.${key}`,
      });
    }
    return refused({ code: 'UNRECOGNIZED', path: `${path}.${key}`, value: unexpected });
  }
  return { ok: true, value: null };
}

function decodeBaselineValue(value: unknown, path: string): DecodeResult<BaselineValue> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object with status and value',
      path,
    });
  }
  const keys = exactObjectKeys(value, BASELINE_VALUE_KEYS, path);
  if (!keys.ok) return keys;
  const status = value['status'];
  if (typeof status !== 'string') {
    return refused({
      actualType: wireType(status),
      code: 'INVALID_SHAPE',
      expected: 'string literal PASS',
      path: `${path}.status`,
    });
  }
  if (status !== 'PASS') {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.status`, value: status });
  }
  const baselineValue = value['value'];
  if (typeof baselineValue !== 'string') {
    return refused({
      actualType: wireType(baselineValue),
      code: 'INVALID_SHAPE',
      expected: 'string',
      path: `${path}.value`,
    });
  }
  return { ok: true, value: value as BaselineValue };
}

function decodeBaselineCompatibility(
  value: unknown,
  path: string,
): DecodeResult<BaselineCompatibility> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object',
      path,
    });
  }
  const keys = exactObjectKeys(value, BASELINE_COMPATIBILITY_KEYS, path);
  if (!keys.ok) return keys;
  for (const key of ['builtAgainstTuple', 'catalogVersion', 'registryVersion'] as const) {
    const baselineValue = decodeBaselineValue(value[key], `${path}.${key}`);
    if (!baselineValue.ok) return baselineValue;
  }
  return { ok: true, value: value as BaselineCompatibility };
}

function decodeStringList(value: unknown, path: string): DecodeResult<readonly string[]> {
  if (!Array.isArray(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'array of strings',
      path,
    });
  }
  for (const [index, entry] of value.entries()) {
    if (typeof entry === 'string') continue;
    return refused({
      actualType: wireType(entry),
      code: 'INVALID_SHAPE',
      expected: 'string',
      path: `${path}[${String(index)}]`,
    });
  }
  return { ok: true, value: value as string[] };
}

function decodeIntegrityStatus(value: unknown, path: string): DecodeResult<IntegrityStatus> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object',
      path,
    });
  }
  const keys = exactObjectKeys(value, INTEGRITY_STATUS_KEYS, path);
  if (!keys.ok) return keys;
  for (const key of ['changed', 'missing', 'untracked'] as const) {
    const list = decodeStringList(value[key], `${path}.${key}`);
    if (!list.ok) return list;
  }
  const ok = value['ok'];
  if (typeof ok !== 'boolean') {
    return refused({
      actualType: wireType(ok),
      code: 'INVALID_SHAPE',
      expected: 'boolean',
      path: `${path}.ok`,
    });
  }
  const tracked = value['tracked'];
  if (typeof tracked !== 'number') {
    return refused({
      actualType: wireType(tracked),
      code: 'INVALID_SHAPE',
      expected: 'non-negative safe integer',
      path: `${path}.tracked`,
    });
  }
  if (!Number.isSafeInteger(tracked) || tracked < 0) {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.tracked`, value: tracked });
  }
  return { ok: true, value: value as IntegrityStatus };
}

function decodeApp001Projection(value: JsonObject, path: string): DecodeResult<App001Projection> {
  const keys = exactObjectKeys(value, APP_001_KEYS, path);
  if (!keys.ok) return keys;

  const formId = value['formId'];
  if (typeof formId !== 'string') {
    return refused({
      actualType: wireType(formId),
      code: 'INVALID_SHAPE',
      expected: 'string literal APP-001',
      path: `${path}.formId`,
    });
  }
  if (formId !== 'APP-001') {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.formId`, value: formId });
  }

  const buildVersion = value['buildVersion'];
  if (typeof buildVersion !== 'string') {
    return refused({
      actualType: wireType(buildVersion),
      code: 'INVALID_SHAPE',
      expected: 'string',
      path: `${path}.buildVersion`,
    });
  }

  const baselineCompatibility = decodeBaselineCompatibility(
    value['baselineCompatibility'],
    `${path}.baselineCompatibility`,
  );
  if (!baselineCompatibility.ok) return baselineCompatibility;

  const integrityStatus = decodeIntegrityStatus(
    value['integrityStatus'],
    `${path}.integrityStatus`,
  );
  if (!integrityStatus.ok) return integrityStatus;

  const bootState = value['bootState'];
  if (typeof bootState !== 'string') {
    return refused({
      actualType: wireType(bootState),
      code: 'INVALID_SHAPE',
      expected: 'BOOTING | READY | ERROR',
      path: `${path}.bootState`,
    });
  }
  if (!APP_001_BOOT_STATES.has(bootState)) {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.bootState`, value: bootState });
  }

  return { ok: true, value: value as App001Projection };
}

type FieldPredicate = (value: JsonValue) => boolean;

function decodeProjection(
  value: JsonObject,
  path: string,
  fields: Readonly<Record<string, FieldPredicate>>,
): DecodeResult<JsonObject> {
  const keys = exactObjectKeys(value, new Set(Object.keys(fields)), path);
  if (!keys.ok) return keys;
  for (const [key, valid] of Object.entries(fields)) {
    const field = value[key];
    if (field === undefined) {
      return refused({
        actualType: 'undefined',
        code: 'INVALID_SHAPE',
        expected: 'required JSON value',
        path: `${path}.${key}`,
      });
    }
    if (!valid(field)) return unrecognized(`${path}.${key}`, field);
  }
  return { ok: true, value };
}

function decodeApp002Projection(value: JsonObject, path: string, revisions: RevisionVector) {
  const result = decodeProjection(value, path, {
    contextId: (field) => typeof field === 'string' && DEVICE_ID_PATTERN.test(field),
    deviceId: (field) => typeof field === 'string' && DEVICE_ID_PATTERN.test(field),
    projectionRevision: (field) => field === revisions.projectionRevision,
    stateRevision: (field) => field === revisions.stateRevision,
  });
  const contextId = value['contextId'];
  if (result.ok && contextId !== undefined && contextId === value['deviceId']) {
    return unrecognized<JsonObject>(`${path}.contextId`, contextId);
  }
  return result;
}

function isCanonicalCharacterIdList(value: JsonValue): value is readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return false;
  const ids = value as string[];
  return (
    new Set(ids).size === ids.length &&
    ids.every((entry, index) => index === 0 || ids[index - 1]! < entry)
  );
}

function decodeApp004Projection(
  value: JsonObject,
  path: string,
  revisions: RevisionVector,
): DecodeResult<JsonObject> {
  const result = decodeProjection(value, path, {
    campaignAuthority: (field) => field === false,
    draftCharacterIds: isCanonicalCharacterIdList,
    finalCharacterIds: isCanonicalCharacterIdList,
    handoffIdOrNull: (field) => field === null,
    handoffReceiptIdOrNull: (field) => field === null,
    launchContext: (field) => field === 'PLAYER_MENU',
    localCharacterLibraryRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    localOwnerIdOrNull: (field) => field === null,
    projectionRevision: (field) => field === revisions.projectionRevision,
    returnContext: (field) => field === 'PLAYER_MENU',
    stateRevision: (field) => field === revisions.stateRevision,
  });
  if (!result.ok) return result;
  const draftIds = value['draftCharacterIds'] as readonly string[];
  const finalIds = value['finalCharacterIds'] as readonly string[];
  const draftIdSet = new Set(draftIds);
  const duplicate = finalIds.find((id) => draftIdSet.has(id));
  return duplicate === undefined
    ? result
    : unrecognized(`${path}.finalCharacterIds`, [...finalIds]);
}

function isIdentityArt(value: JsonValue): boolean {
  if (value === null) return true;
  if (!isJsonObject(value) || typeof value['kind'] !== 'string') return false;
  if (value['kind'] === 'asset-key') {
    return (
      Object.keys(value).sort().join(',') === 'assetKey,kind' &&
      typeof value['assetKey'] === 'string'
    );
  }
  return (
    value['kind'] === 'local-file' &&
    Object.keys(value).sort().join(',') === 'bytesBase64,kind,mediaType' &&
    typeof value['bytesBase64'] === 'string' &&
    (value['mediaType'] === 'image/png' || value['mediaType'] === 'image/jpeg')
  );
}

function decodeChr001Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    age: (field) => field === null || (typeof field === 'number' && Number.isFinite(field)),
    anatomyProfile: (field) => field === 'STANDARD_HUMANOID',
    artAssetKeyOrLocalFile: isIdentityArt,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null,
    description: (field) => field === null || typeof field === 'string',
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    massApprovalStatus: (field) => field === 'PENDING_GM',
    massKg: (field) =>
      field === null ||
      (typeof field === 'number' &&
        Number.isFinite(field) &&
        field > 0 &&
        (Number.isInteger(field) || Number.isInteger(field * 10))),
    name: (field) => field === null || typeof field === 'string',
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function decodeConfirmedSnapshot(
  message: ProjectionSnapshotV2Message,
  executableWorkflowCommandIds: readonly WorkflowCommandId[],
): DecodeResult<ConfirmedProjectionSnapshot> {
  const base = message.presentation.base;
  const expectedRole = base.formId === 'APP-001' ? null : 'player';
  if (message.projectionRole !== expectedRole) {
    return unrecognized('$.projectionRole', message.projectionRole);
  }
  let projection: DecodeResult<JsonObject>;
  switch (base.formId) {
    case 'APP-001':
      projection = decodeApp001Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
      );
      break;
    case 'APP-002':
      projection = decodeApp002Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        message.revisions,
      );
      break;
    case 'APP-004':
      projection = decodeApp004Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        message.revisions,
      );
      break;
    case 'CHR-001':
      projection = decodeChr001Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      break;
    default:
      return unrecognized('$.presentation.base.formId', base.formId);
  }
  if (!projection.ok) return projection;
  const common = {
    availableActionKeys: [...base.availableActionKeys],
    executableWorkflowCommandIds: [...executableWorkflowCommandIds],
    path:
      base.routeBindings.length === 0
        ? base.routeTemplate
        : base.routeTemplate.replace(/:[^/]+/u, encodeURIComponent(base.routeBindings[0]!.value)),
    revisions: { ...message.revisions },
  } as const;
  return {
    ok: true,
    value: {
      ...common,
      formId: base.formId,
      projection: projection.value,
    },
  };
}

function identitySnapshot(
  snapshot: ConfirmedProjectionSnapshot,
  contextId: string | null,
): IdentityDraftSnapshot | null {
  if (snapshot.formId !== 'CHR-001' || contextId === null) return null;
  const value = snapshot.projection;
  return {
    draftRevision: value['draftRevision'] as number,
    revisions: snapshot.revisions,
    scope: {
      characterDraftId: value['characterDraftId'] as string,
      contextId,
      sourceFormId: 'CHR-001',
      wizardCheckpointId: value['wizardCheckpointId'] as string,
    },
    values: {
      age: value['age'] as number | null,
      artAssetKeyOrLocalFile: value[
        'artAssetKeyOrLocalFile'
      ] as IdentityDraftValues['artAssetKeyOrLocalFile'],
      description: value['description'] as string | null,
      massKg: value['massKg'] as number | null,
      name: value['name'] as string | null,
    },
  };
}

function visibleSnapshot(
  snapshot: ConfirmedProjectionSnapshot,
  identity: IdentityDraftClient | null,
): ConfirmedProjectionSnapshot {
  return snapshot.formId === 'CHR-001' && identity?.state.dirty
    ? {
        ...snapshot,
        availableActionKeys: snapshot.availableActionKeys.filter(
          (key) => key !== 'CHR-001::CTA::001',
        ),
      }
    : snapshot;
}

function decodeReconnectSnapshot(
  message: ProjectionSnapshotV2Message,
  capabilities: SessionReconnectCapabilitiesV2Message,
  requestId: string,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (capabilities.reconnectRequestId !== requestId) {
    return unrecognized('$.reconnectRequestId', capabilities.reconnectRequestId);
  }
  if (message.presentation.assignment.correlationId !== requestId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'RECONNECT') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  if (
    capabilities.revisions.actorVisibilityRevision !== message.revisions.actorVisibilityRevision ||
    capabilities.revisions.projectionRevision !== message.revisions.projectionRevision ||
    capabilities.revisions.stateRevision !== message.revisions.stateRevision
  ) {
    return unrecognized('$.revisions', { ...message.revisions });
  }
  return decodeConfirmedSnapshot(message, capabilities.executableWorkflowCommandIds);
}

function decodeFormActionSnapshot(
  message: ProjectionSnapshotV2Message,
  pending: FormActionIntentV2Message,
  previous: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (message.presentation.assignment.correlationId !== pending.navigationRequestId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'FORM_ACTION') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  if (
    message.revisions.stateRevision !== previous.revisions.stateRevision ||
    message.revisions.actorVisibilityRevision !== previous.revisions.actorVisibilityRevision ||
    message.revisions.projectionRevision !== previous.revisions.projectionRevision + 1
  ) {
    return unrecognized('$.revisions', { ...message.revisions });
  }
  return decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
}

function decodeDeviceIdentity(value: unknown): DecodeResult<string> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object with deviceId',
      path: '$',
    });
  }
  const keys = exactObjectKeys(value, DEVICE_ID_KEYS, '$');
  if (!keys.ok) return keys;
  const deviceId = value['deviceId'];
  if (typeof deviceId !== 'string') {
    return refused({
      actualType: wireType(deviceId),
      code: 'INVALID_SHAPE',
      expected: 'canonical lowercase UUID v4',
      path: '$.deviceId',
    });
  }
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    return unrecognized('$.deviceId', deviceId);
  }
  return { ok: true, value: deviceId };
}

function decodeDeviceIdentityError(value: unknown): DecodeResult<string> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object with error',
      path: '$',
    });
  }
  const keys = exactObjectKeys(value, DEVICE_ID_ERROR_KEYS, '$');
  if (!keys.ok) return keys;
  const detail = value['error'];
  if (typeof detail !== 'string' || detail.length === 0) {
    return refused({
      actualType: wireType(detail),
      code: 'INVALID_SHAPE',
      expected: 'non-empty error string',
      path: '$.error',
    });
  }
  return { ok: true, value: detail };
}

export function stateSocketUrl(pageHref: string): string {
  const url = new URL('/state', pageHref);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else throw new Error(`web client cannot derive a WebSocket URL from ${url.protocol}`);
  return url.href;
}

function deviceIdentityUrl(pageHref: string): string {
  return new URL('/device-identity', pageHref).href;
}

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRequestId(prefix: 'identity' | 'navigation' | 'reconnect'): string {
  const entropy = crypto.getRandomValues(new Uint32Array(4));
  return `${prefix}-${[...entropy].map((value) => value.toString(16).padStart(8, '0')).join('')}`;
}

function envelopeProtocolVersion(source: string): unknown {
  try {
    const value: unknown = JSON.parse(source);
    return isJsonObject(value) ? value['protocolVersion'] : undefined;
  } catch {
    return undefined;
  }
}

export function connectProjection(
  onState: (state: WebClientState) => void,
  onIdentityDraft: (state: IdentityDraftClientState | null) => void = () => {},
): ProjectionConnection {
  let deviceId: string | null = null;
  let disposed = false;
  let identity: IdentityDraftClient | null = null;
  let terminal = false;
  let lastSnapshot: ConfirmedProjectionSnapshot | null = null;
  let pendingFormAction: FormActionIntentV2Message | null = null;
  let playerContextId: string | null = null;
  let socket: WebSocket | null = null;
  let stagedCapabilities: SessionReconnectCapabilitiesV2Message | null = null;
  const visibleLast = () =>
    lastSnapshot === null ? null : visibleSnapshot(lastSnapshot, identity);

  const closeAfterTerminalState = () => {
    if (
      socket !== null &&
      (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
    ) {
      socket.close(1002, 'wire frame refused');
    }
  };

  const failProtocol = (refusal: DecodeRefusal, detail: string) => {
    if (disposed || terminal) return;
    terminal = true;
    pendingFormAction = null;
    stagedCapabilities = null;
    const response = {
      messageType: 'protocol.refusal',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      refusal,
      relatedCommandId: null,
    } as const satisfies ProtocolRefusalMessage;
    const encoded = encodeClientMessage(response, WEB_PROTOCOL_VOCABULARY);
    let deliveryDetail = '';
    if (!encoded.ok) {
      deliveryDetail = ` Checked refusal could not be encoded: ${JSON.stringify(encoded.refusal)}.`;
    } else if (socket === null || socket.readyState !== WebSocket.OPEN) {
      deliveryDetail = ` Checked refusal was not sent because socket state is ${String(socket?.readyState)}.`;
    } else {
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        deliveryDetail = ` Checked refusal could not be sent: ${diagnostic(error)}.`;
      }
    }
    onState({
      detail: `${detail}${deliveryDetail}`,
      kind: 'protocol-error',
      refusal,
      snapshot: visibleLast(),
    });
    closeAfterTerminalState();
  };
  const failUnexpected = (path: string, value: JsonValue, detail: string): void =>
    failProtocol({ code: 'UNRECOGNIZED', path, value }, detail);

  const sendIdentity = (request: ReturnType<IdentityDraftClient['edit']>): boolean => {
    if (request === null || socket === null || socket.readyState !== WebSocket.OPEN) return false;
    const encoded = encodeClientMessageV2(request, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok)
      throw new Error(`identity draft encoding failed: ${JSON.stringify(encoded.refusal)}`);
    socket.send(encoded.text);
    return true;
  };

  const adoptSnapshot = (next: ConfirmedProjectionSnapshot, reconnect: boolean): void => {
    lastSnapshot = next;
    if (next.formId === 'APP-001') playerContextId = null;
    else if (next.formId === 'APP-002') playerContextId = next.projection['contextId'] as string;
    const draft = identitySnapshot(next, playerContextId);
    let replay = null;
    if (draft === null) identity = null;
    else if (identity === null || !reconnect)
      identity = new IdentityDraftClient(draft, () => createRequestId('identity'));
    else replay = identity.resumeAfterSnapshot(draft);
    onIdentityDraft(identity?.state ?? null);
    onState({ kind: 'ready', snapshot: visibleSnapshot(next, identity) });
    sendIdentity(replay);
  };

  const attachSocket = (
    activeSocket: WebSocket,
    requestId: string,
    reconnectText: string,
  ): void => {
    let expectingCapabilities = true;
    socket = activeSocket;

    activeSocket.onopen = () => {
      if (disposed || terminal || socket !== activeSocket) return;
      try {
        activeSocket.send(reconnectText);
      } catch (error: unknown) {
        socket = null;
        onState({
          code: null,
          detail: `session.reconnect could not be sent: ${diagnostic(error)}`,
          kind: 'disconnected',
          snapshot: visibleLast(),
        });
        return;
      }
      onState({ kind: 'awaiting-snapshot' });
    };

    activeSocket.onmessage = (event) => {
      if (disposed || terminal || socket !== activeSocket) return;
      const frame: unknown = event.data as unknown;
      if (typeof frame !== 'string') {
        failProtocol(
          {
            actualType: wireType(frame),
            code: 'INVALID_SHAPE',
            expected: 'text application frame',
            path: '$',
          },
          'Host sent a binary wire frame.',
        );
        return;
      }

      if (envelopeProtocolVersion(frame) === WIRE_PROTOCOL_VERSION) {
        const decoded = decodeHostMessage(frame, WEB_PROTOCOL_VOCABULARY);
        if (!decoded.ok) {
          failProtocol(decoded.refusal, 'Host frame did not decode as wire v1.');
          return;
        }
        if (stagedCapabilities !== null) {
          failUnexpected(
            '$.messageType',
            decoded.value.messageType,
            'A wire v1 frame interrupted the staged reconnect pair.',
          );
          return;
        }
        if (decoded.value.messageType === 'protocol.refusal') {
          terminal = true;
          onState({
            kind: 'host-refusal',
            refusal: decoded.value.refusal,
            snapshot: visibleLast(),
          });
          closeAfterTerminalState();
          return;
        }
        failUnexpected(
          '$.messageType',
          decoded.value.messageType,
          'Host sent a wire v1 message that this reconnect did not request.',
        );
        return;
      }

      const decoded = decodeHostMessageV2(frame, WEB_PROTOCOL_VOCABULARY);
      if (!decoded.ok) {
        failProtocol(decoded.refusal, 'Host frame did not decode as wire v2.');
        return;
      }
      const message = decoded.value;
      if (
        (expectingCapabilities && message.messageType !== 'session.reconnect.capabilities') ||
        (stagedCapabilities !== null && message.messageType !== 'projection.snapshot')
      ) {
        failUnexpected(
          '$.messageType',
          message.messageType,
          'A wire v2 frame interrupted the staged reconnect pair.',
        );
        return;
      }
      if (message.messageType === 'session.reconnect.capabilities') {
        if (!expectingCapabilities || stagedCapabilities !== null) {
          failUnexpected(
            '$.messageType',
            message.messageType,
            'Host sent an extra reconnect capability frame.',
          );
          return;
        }
        expectingCapabilities = false;
        if (message.reconnectRequestId !== requestId) {
          failUnexpected(
            '$.reconnectRequestId',
            message.reconnectRequestId,
            'Host capability frame belongs to another reconnect attempt.',
          );
          return;
        }
        stagedCapabilities = message;
        return;
      }
      if (message.messageType === 'projection.snapshot') {
        let snapshot: DecodeResult<ConfirmedProjectionSnapshot>;
        const reconnecting = stagedCapabilities !== null;
        if (reconnecting) {
          const capabilities = stagedCapabilities!;
          stagedCapabilities = null;
          snapshot = decodeReconnectSnapshot(message, capabilities, requestId);
        } else {
          if (stagedCapabilities !== null || pendingFormAction === null) {
            failUnexpected(
              '$.messageType',
              message.messageType,
              'Form-action snapshot arrived without exactly one pending form action.',
            );
            return;
          }
          snapshot = decodeFormActionSnapshot(message, pendingFormAction, lastSnapshot!);
          pendingFormAction = null;
        }
        if (!snapshot.ok) {
          failProtocol(snapshot.refusal, 'Host sent an invalid projection snapshot.');
          return;
        }
        adoptSnapshot(snapshot.value, reconnecting);
        return;
      }
      if (message.messageType === 'character.identity-draft.result') {
        if (identity === null || lastSnapshot === null) return;
        const candidate = decodeConfirmedSnapshot(
          {
            messageType: 'projection.snapshot',
            presentation: {
              assignment: { correlationId: message.draftUpdateId, reason: 'FORM_ACTION' },
              ...message.presentation,
            },
            projectionRole: message.projectionRole,
            protocolVersion: WIRE_PROTOCOL_V2_VERSION,
            revisions: message.revisions,
          },
          lastSnapshot.executableWorkflowCommandIds,
        );
        if (!candidate.ok) {
          failProtocol(candidate.refusal, 'Host sent an invalid identity draft result.');
          return;
        }
        const draft = identitySnapshot(candidate.value, playerContextId);
        if (draft === null) return;
        const outstanding = identity.state.outstanding;
        const applicable =
          outstanding?.draftUpdateId === message.draftUpdateId &&
          message.scope.contextId === playerContextId &&
          outstanding.scope.contextId === message.scope.contextId &&
          outstanding.scope.characterDraftId === message.scope.characterDraftId &&
          outstanding.scope.wizardCheckpointId === message.scope.wizardCheckpointId &&
          message.draftRevision >= (lastSnapshot.projection['draftRevision'] as number) &&
          (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).every(
            (axis) => message.revisions[axis] >= lastSnapshot!.revisions[axis],
          );
        const next = identity.receiveResult(message, draft.values);
        if (applicable) lastSnapshot = candidate.value;
        onIdentityDraft(identity.state);
        onState({ kind: 'ready', snapshot: visibleSnapshot(lastSnapshot, identity) });
        sendIdentity(next);
        return;
      }
      if (message.messageType === 'character.identity-draft.refusal') {
        if (identity === null || lastSnapshot === null) return;
        const next = identity.receiveRefusal(message);
        onIdentityDraft(identity.state);
        onState({ kind: 'ready', snapshot: visibleSnapshot(lastSnapshot, identity) });
        sendIdentity(next);
        return;
      }
      if (message.messageType === 'navigation.form-action.refusal') {
        if (
          lastSnapshot === null ||
          pendingFormAction === null ||
          message.navigationRequestId !== pendingFormAction.navigationRequestId
        ) {
          failUnexpected(
            '$.navigationRequestId',
            message.navigationRequestId,
            'Host form-action refusal does not match the pending request.',
          );
          return;
        }
        pendingFormAction = null;
        onState({
          kind: 'navigation-refusal',
          refusal: message.refusal,
          snapshot: visibleSnapshot(lastSnapshot, identity),
        });
        return;
      }
      failUnexpected(
        '$.messageType',
        message.messageType,
        'Host sent a wire v2 message that this reconnect did not request.',
      );
    };

    activeSocket.onerror = () => {
      if (disposed || terminal || socket !== activeSocket) return;
      socket = null;
      pendingFormAction = null;
      stagedCapabilities = null;
      onState({
        code: null,
        detail: 'WebSocket transport reported an error.',
        kind: 'disconnected',
        snapshot: visibleLast(),
      });
    };

    activeSocket.onclose = (event) => {
      if (disposed || terminal || socket !== activeSocket) return;
      socket = null;
      pendingFormAction = null;
      stagedCapabilities = null;
      const reason = event.reason.length === 0 ? 'no close reason' : event.reason;
      onState({
        code: event.code,
        detail: `WebSocket closed with code ${String(event.code)}: ${reason}.`,
        kind: 'disconnected',
        snapshot: visibleLast(),
      });
    };
  };

  const openTransport = (currentDeviceId: string): void => {
    const requestId = createRequestId('reconnect');
    const reconnect = {
      deviceId: currentDeviceId,
      knownRevisions: lastSnapshot?.revisions ?? NO_KNOWN_REVISIONS,
      messageType: 'session.reconnect',
      protocolVersion: WIRE_PROTOCOL_V2_VERSION,
      reconnectRequestId: requestId,
      supportedWorkflowCommandIds: [],
      unacknowledgedCommandIds: [],
    } as const satisfies SessionReconnectV2Message;
    const encoded = encodeClientMessageV2(reconnect, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok)
      throw new Error(
        `session.reconnect failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
      );
    stagedCapabilities = null;
    attachSocket(new WebSocket(stateSocketUrl(window.location.href)), requestId, encoded.text);
  };

  const start = async (): Promise<void> => {
    const response = await fetch(deviceIdentityUrl(window.location.href), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      const source: unknown = await response.json();
      const endpointError = decodeDeviceIdentityError(source);
      if (!endpointError.ok) {
        throw new Error(
          `device identity request returned HTTP ${String(response.status)} with invalid diagnostic: ${JSON.stringify(endpointError.refusal)}`,
        );
      }
      throw new Error(
        `device identity request returned HTTP ${String(response.status)}: ${endpointError.value}`,
      );
    }
    const source: unknown = await response.json();
    const identity = decodeDeviceIdentity(source);
    if (!identity.ok) {
      throw new Error(`device identity response refused: ${JSON.stringify(identity.refusal)}`);
    }
    if (disposed) return;
    deviceId = identity.value;
    openTransport(deviceId);
  };

  void start().catch((error: unknown) => {
    if (disposed || terminal) return;
    terminal = true;
    onState({ kind: 'client-error', detail: diagnostic(error) });
    closeAfterTerminalState();
  });

  return {
    disconnect: () => {
      if (disposed) return;
      disposed = true;
      pendingFormAction = null;
      stagedCapabilities = null;
      if (
        socket !== null &&
        (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
      ) {
        socket.close(1000, 'web client unmounted');
      }
    },
    reconnect: () => {
      if (disposed || terminal || deviceId === null)
        return { ok: false, detail: 'projection connection cannot reconnect' };
      if (socket !== null) return { ok: false, detail: 'WebSocket is already open or connecting' };
      try {
        openTransport(deviceId);
        return { ok: true };
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
    },
    replaceIdentityDraft: (values) => {
      if (identity === null) return { ok: false, detail: 'no active CHR-001 draft scope' };
      if ([values.age, values.massKg].some((value) => value !== null && !Number.isFinite(value)))
        return { ok: false, detail: 'identity draft numbers must be finite' };
      const request = identity.edit(values);
      onIdentityDraft(identity.state);
      if (lastSnapshot !== null)
        onState({ kind: 'ready', snapshot: visibleSnapshot(lastSnapshot, identity) });
      try {
        return request === null || sendIdentity(request)
          ? { ok: true }
          : { ok: false, detail: 'WebSocket is not open' };
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
    },
    requestFormAction: (actionKey) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (lastSnapshot === null)
        return { ok: false, detail: 'no confirmed projection is available' };
      if (pendingFormAction !== null) {
        return { ok: false, detail: 'a form action is already awaiting host confirmation' };
      }
      if (!visibleSnapshot(lastSnapshot, identity).availableActionKeys.includes(actionKey)) {
        return {
          ok: false,
          detail: `action ${JSON.stringify(actionKey)} is absent from the confirmed availableActionKeys`,
        };
      }
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return { ok: false, detail: 'WebSocket is not open' };
      }
      const request = {
        actionKey,
        expectedProjectionRevision: lastSnapshot.revisions.projectionRevision,
        messageType: 'navigation.form-action',
        navigationRequestId: createRequestId('navigation'),
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        sourceFormId: lastSnapshot.formId,
      } as const satisfies FormActionIntentV2Message;
      const encoded = encodeClientMessageV2(request, WEB_PROTOCOL_VOCABULARY);
      if (!encoded.ok) {
        return {
          ok: false,
          detail: `form action failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
        };
      }
      pendingFormAction = request;
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        pendingFormAction = null;
        return { ok: false, detail: `form action could not be sent: ${diagnostic(error)}` };
      }
      return { ok: true };
    },
  };
}
