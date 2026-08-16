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

const FORM_ID_SET: ReadonlySet<string> = new Set(FORM_IDS);

/** Source: generated/spec/atlas/forms-by-id.json["APP-001"].actions.ctaAvailabilityByAction. */
const APP_001_ACTION_KEYS = [
  'APP-001::CTA::001',
  'APP-001::CTA::002',
  'APP-001::CTA::003',
  'APP-001::CTA::004',
] as const satisfies readonly ActionKey[];
const APP_001_ACTION_KEY_SET: ReadonlySet<string> = new Set(APP_001_ACTION_KEYS);

/**
 * This slice implements no command or navigation handling. The combined
 * vocabulary keeps accepted v1 command traffic separate while constraining a
 * v2 presentation to the one role-neutral APP-001 shape the client can apply.
 */
export const WEB_PROTOCOL_VOCABULARY: ProtocolVocabulary & WireV2Vocabulary = {
  isAddressableRouteTemplate: (_value): _value is AddressableRouteTemplate => false,
  isClientRouteBindings: () => false,
  isFormActionKey: (sourceFormId, value): value is ActionKey =>
    sourceFormId === 'APP-001' && APP_001_ACTION_KEY_SET.has(value),
  isFormId: (value): value is FormId => FORM_ID_SET.has(value),
  isHostTransition: () => false,
  isPresentedForm: (formId, formType, routeTemplate, bindings) =>
    formId === 'APP-001' && formType === 'screen' && routeTemplate === '/' && bindings.length === 0,
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

export interface ConfirmedApp001Snapshot {
  readonly executableWorkflowCommandIds: readonly WorkflowCommandId[];
  readonly projection: App001Projection;
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
      readonly snapshot: ConfirmedApp001Snapshot | null;
    }
  | {
      readonly kind: 'host-refusal';
      readonly refusal: DecodeRefusal;
      readonly snapshot: ConfirmedApp001Snapshot | null;
    }
  | {
      readonly detail: string;
      readonly kind: 'protocol-error';
      readonly refusal: DecodeRefusal;
      readonly snapshot: ConfirmedApp001Snapshot | null;
    }
  | { readonly kind: 'ready'; readonly snapshot: ConfirmedApp001Snapshot };

export interface ProjectionConnection {
  disconnect(): void;
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

function decodeSnapshot(
  message: ProjectionSnapshotV2Message,
  capabilities: SessionReconnectCapabilitiesV2Message,
  requestId: string,
): DecodeResult<ConfirmedApp001Snapshot> {
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
  if (message.projectionRole !== null) {
    return unrecognized('$.projectionRole', message.projectionRole);
  }
  const availableActionKeys = message.presentation.base.availableActionKeys;
  if (
    availableActionKeys.length !== APP_001_ACTION_KEYS.length ||
    APP_001_ACTION_KEYS.some((actionKey, index) => availableActionKeys[index] !== actionKey)
  ) {
    return unrecognized('$.presentation.base.availableActionKeys', [...availableActionKeys]);
  }
  const projection = decodeApp001Projection(
    message.presentation.base.roleFilteredPayload,
    '$.presentation.base.roleFilteredPayload',
  );
  if (!projection.ok) return projection;
  return {
    ok: true,
    value: {
      executableWorkflowCommandIds: [...capabilities.executableWorkflowCommandIds],
      projection: projection.value,
      revisions: { ...message.revisions },
    },
  };
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

function createRequestId(): string {
  const entropy = crypto.getRandomValues(new Uint32Array(4));
  return `reconnect-${[...entropy].map((value) => value.toString(16).padStart(8, '0')).join('')}`;
}

function envelopeProtocolVersion(source: string): unknown {
  try {
    const value: unknown = JSON.parse(source);
    return isJsonObject(value) ? value['protocolVersion'] : undefined;
  } catch {
    return undefined;
  }
}

export function connectApp001Projection(
  onState: (state: WebClientState) => void,
): ProjectionConnection {
  let disposed = false;
  let terminal = false;
  let lastSnapshot: ConfirmedApp001Snapshot | null = null;
  let socket: WebSocket | null = null;
  let stagedCapabilities: SessionReconnectCapabilitiesV2Message | null = null;

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
      snapshot: lastSnapshot,
    });
    closeAfterTerminalState();
  };
  const failUnexpected = (path: string, value: JsonValue, detail: string): void =>
    failProtocol({ code: 'UNRECOGNIZED', path, value }, detail);

  const attachSocket = (
    activeSocket: WebSocket,
    requestId: string,
    reconnectText: string,
  ): void => {
    socket = activeSocket;

    activeSocket.onopen = () => {
      if (disposed || terminal) return;
      try {
        activeSocket.send(reconnectText);
      } catch (error: unknown) {
        terminal = true;
        onState({
          code: null,
          detail: `session.reconnect could not be sent: ${diagnostic(error)}`,
          kind: 'disconnected',
          snapshot: lastSnapshot,
        });
        closeAfterTerminalState();
        return;
      }
      onState({ kind: 'awaiting-snapshot' });
    };

    activeSocket.onmessage = (event) => {
      if (disposed || terminal) return;
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
            snapshot: lastSnapshot,
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
      if (message.messageType === 'session.reconnect.capabilities') {
        if (lastSnapshot !== null || stagedCapabilities !== null) {
          failUnexpected(
            '$.messageType',
            message.messageType,
            'Host sent an extra reconnect capability frame.',
          );
          return;
        }
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
        if (lastSnapshot !== null || stagedCapabilities === null) {
          failUnexpected(
            '$.messageType',
            message.messageType,
            'Reconnect snapshot arrived without exactly one adjacent capability frame.',
          );
          return;
        }
        const capabilities = stagedCapabilities;
        stagedCapabilities = null;
        const snapshot = decodeSnapshot(message, capabilities, requestId);
        if (!snapshot.ok) {
          failProtocol(snapshot.refusal, 'Host sent an invalid APP-001 reconnect pair.');
          return;
        }
        lastSnapshot = snapshot.value;
        onState({ kind: 'ready', snapshot: snapshot.value });
        return;
      }
      failUnexpected(
        '$.messageType',
        message.messageType,
        'Host sent a wire v2 message that this reconnect did not request.',
      );
    };

    activeSocket.onerror = () => {
      if (disposed || terminal) return;
      terminal = true;
      stagedCapabilities = null;
      onState({
        code: null,
        detail: 'WebSocket transport reported an error.',
        kind: 'disconnected',
        snapshot: lastSnapshot,
      });
      closeAfterTerminalState();
    };

    activeSocket.onclose = (event) => {
      if (disposed || terminal) return;
      terminal = true;
      stagedCapabilities = null;
      const reason = event.reason.length === 0 ? 'no close reason' : event.reason;
      onState({
        code: event.code,
        detail: `WebSocket closed with code ${String(event.code)}: ${reason}.`,
        kind: 'disconnected',
        snapshot: lastSnapshot,
      });
    };
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

    const requestId = createRequestId();
    const reconnect = {
      deviceId: identity.value,
      knownRevisions: NO_KNOWN_REVISIONS,
      messageType: 'session.reconnect',
      protocolVersion: WIRE_PROTOCOL_V2_VERSION,
      reconnectRequestId: requestId,
      supportedWorkflowCommandIds: [],
      unacknowledgedCommandIds: [],
    } as const satisfies SessionReconnectV2Message;
    const encoded = encodeClientMessageV2(reconnect, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok) {
      throw new Error(
        `session.reconnect failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
      );
    }
    attachSocket(new WebSocket(stateSocketUrl(window.location.href)), requestId, encoded.text);
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
      stagedCapabilities = null;
      if (
        socket !== null &&
        (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
      ) {
        socket.close(1000, 'web client unmounted');
      }
    },
  };
}
