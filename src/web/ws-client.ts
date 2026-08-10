import { FORM_IDS } from '@generated/types/atlas.js';
import type { FormId } from '@generated/types/atlas.js';
import { decodeHostMessage, encodeClientMessage, WIRE_PROTOCOL_VERSION } from '@shared/index.js';
import type {
  DecodeRefusal,
  DecodeResult,
  JsonObject,
  ProjectionReconnectMessage,
  ProjectionSnapshotMessage,
  ProtocolRefusalMessage,
  ProtocolVocabulary,
  RevisionVector,
  WorkflowCommandId,
} from '@shared/index.js';

const FORM_ID_SET: ReadonlySet<string> = new Set(FORM_IDS);

/**
 * Issue #36 implements no command or transition handling. An empty command
 * vocabulary makes the decoder reject a snapshot that violates the empty
 * capability intersection instead of accepting a CTA the client cannot run.
 */
export const WEB_PROTOCOL_VOCABULARY: ProtocolVocabulary = {
  isFormId: (value): value is FormId => FORM_ID_SET.has(value),
  isHostTransition: () => false,
  isWorkflowCommandId: (_value): _value is WorkflowCommandId => false,
};

const NO_KNOWN_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;

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

function decodeApp001Projection(value: JsonObject): DecodeResult<App001Projection> {
  const keys = exactObjectKeys(value, APP_001_KEYS, '$.projection');
  if (!keys.ok) return keys;

  const formId = value['formId'];
  if (typeof formId !== 'string') {
    return refused({
      actualType: wireType(formId),
      code: 'INVALID_SHAPE',
      expected: 'string literal APP-001',
      path: '$.projection.formId',
    });
  }
  if (formId !== 'APP-001') {
    return refused({ code: 'UNRECOGNIZED', path: '$.projection.formId', value: formId });
  }

  const buildVersion = value['buildVersion'];
  if (typeof buildVersion !== 'string') {
    return refused({
      actualType: wireType(buildVersion),
      code: 'INVALID_SHAPE',
      expected: 'string',
      path: '$.projection.buildVersion',
    });
  }

  const baselineCompatibility = decodeBaselineCompatibility(
    value['baselineCompatibility'],
    '$.projection.baselineCompatibility',
  );
  if (!baselineCompatibility.ok) return baselineCompatibility;

  const integrityStatus = decodeIntegrityStatus(
    value['integrityStatus'],
    '$.projection.integrityStatus',
  );
  if (!integrityStatus.ok) return integrityStatus;

  const bootState = value['bootState'];
  if (typeof bootState !== 'string') {
    return refused({
      actualType: wireType(bootState),
      code: 'INVALID_SHAPE',
      expected: 'BOOTING | READY | ERROR',
      path: '$.projection.bootState',
    });
  }
  if (!APP_001_BOOT_STATES.has(bootState)) {
    return refused({ code: 'UNRECOGNIZED', path: '$.projection.bootState', value: bootState });
  }

  return { ok: true, value: value as App001Projection };
}

function decodeSnapshot(
  message: ProjectionSnapshotMessage,
  requestId: string,
): DecodeResult<ConfirmedApp001Snapshot> {
  if (message.requestId !== requestId) {
    return refused({
      code: 'UNRECOGNIZED',
      path: '$.requestId',
      value: message.requestId,
    });
  }
  if (message.projectionRole !== 'player') {
    return refused({
      code: 'UNRECOGNIZED',
      path: '$.projectionRole',
      value: message.projectionRole,
    });
  }
  const executableCommand = message.executableWorkflowCommandIds[0];
  if (executableCommand !== undefined) {
    return refused({
      code: 'UNRECOGNIZED',
      path: '$.executableWorkflowCommandIds[0]',
      value: executableCommand,
    });
  }
  const projection = decodeApp001Projection(message.projection);
  if (!projection.ok) return projection;
  return {
    ok: true,
    value: { projection: projection.value, revisions: { ...message.revisions } },
  };
}

export function stateSocketUrl(pageHref: string): string {
  const url = new URL('/state', pageHref);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else throw new Error(`web client cannot derive a WebSocket URL from ${url.protocol}`);
  return url.href;
}

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRequestId(): string {
  const entropy = crypto.getRandomValues(new Uint32Array(4));
  return `projection-${[...entropy].map((value) => value.toString(16).padStart(8, '0')).join('')}`;
}

export function connectApp001Projection(
  onState: (state: WebClientState) => void,
): ProjectionConnection {
  let requestId: string;
  let socket: WebSocket;
  try {
    requestId = createRequestId();
    socket = new WebSocket(stateSocketUrl(window.location.href));
  } catch (error: unknown) {
    onState({ kind: 'client-error', detail: diagnostic(error) });
    return { disconnect: () => undefined };
  }

  let disposed = false;
  let terminal = false;
  let lastSnapshot: ConfirmedApp001Snapshot | null = null;

  const closeAfterTerminalState = () => {
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      socket.close(1002, 'wire v1 frame refused');
    }
  };

  const failProtocol = (refusal: DecodeRefusal, detail: string) => {
    if (disposed || terminal) return;
    terminal = true;
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
    } else if (socket.readyState !== WebSocket.OPEN) {
      deliveryDetail = ` Checked refusal was not sent because socket state is ${String(socket.readyState)}.`;
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

  socket.onopen = () => {
    if (disposed || terminal) return;
    const reconnect = {
      knownRevisions: NO_KNOWN_REVISIONS,
      messageType: 'projection.reconnect',
      projectionRole: 'player',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId,
      supportedWorkflowCommandIds: [],
      unacknowledgedCommandIds: [],
    } as const satisfies ProjectionReconnectMessage;
    const encoded = encodeClientMessage(reconnect, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok) {
      terminal = true;
      onState({
        detail: `projection.reconnect failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
        kind: 'client-error',
      });
      closeAfterTerminalState();
      return;
    }
    try {
      socket.send(encoded.text);
    } catch (error: unknown) {
      terminal = true;
      onState({
        code: null,
        detail: `projection.reconnect could not be sent: ${diagnostic(error)}`,
        kind: 'disconnected',
        snapshot: lastSnapshot,
      });
      closeAfterTerminalState();
      return;
    }
    onState({ kind: 'awaiting-snapshot' });
  };

  socket.onmessage = (event) => {
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
    const decoded = decodeHostMessage(frame, WEB_PROTOCOL_VOCABULARY);
    if (!decoded.ok) {
      failProtocol(decoded.refusal, 'Host frame did not decode as wire v1.');
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
    if (decoded.value.messageType !== 'projection.snapshot') {
      failProtocol(
        {
          code: 'UNRECOGNIZED',
          path: '$.messageType',
          value: decoded.value.messageType,
        },
        'Host sent a wire message that this entry point did not request.',
      );
      return;
    }
    const snapshot = decodeSnapshot(decoded.value, requestId);
    if (!snapshot.ok) {
      failProtocol(snapshot.refusal, 'Host sent an invalid APP-001 snapshot.');
      return;
    }
    lastSnapshot = snapshot.value;
    onState({ kind: 'ready', snapshot: snapshot.value });
  };

  socket.onerror = () => {
    if (disposed || terminal) return;
    terminal = true;
    onState({
      code: null,
      detail: 'WebSocket transport reported an error.',
      kind: 'disconnected',
      snapshot: lastSnapshot,
    });
    closeAfterTerminalState();
  };

  socket.onclose = (event) => {
    if (disposed || terminal) return;
    terminal = true;
    const reason = event.reason.length === 0 ? 'no close reason' : event.reason;
    onState({
      code: event.code,
      detail: `WebSocket closed with code ${String(event.code)}: ${reason}.`,
      kind: 'disconnected',
      snapshot: lastSnapshot,
    });
  };

  return {
    disconnect: () => {
      if (disposed) return;
      disposed = true;
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close(1000, 'web client unmounted');
      }
    },
  };
}
