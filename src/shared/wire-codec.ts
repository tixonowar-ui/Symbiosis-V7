import {
  ATLAS_ROLES,
  COMMAND_LIFECYCLE_STATES,
  MASTER_PREDICATE_RESPONSE_COMMAND_ID,
  WIRE_PROTOCOL_VERSION,
} from './wire-protocol.js';
import type {
  AtlasTransitionReference,
  ClientToHostMessage,
  CommandLifecycleState,
  CommandReceipt,
  CommandRefusal,
  DecodeRefusal,
  DecodeResult,
  EncodeResult,
  HostReadCommandKind,
  HostToClientMessage,
  InteractiveRole,
  JsonObject,
  JsonValue,
  MasterPredicateDecisionPayload,
  ProtocolRefusalMessage,
  ProtocolVocabulary,
  RevisionVector,
  WorkflowCommandId,
} from './wire-protocol.js';

const INTERACTIVE_ROLE_SET = new Set<string>(ATLAS_ROLES.filter((role) => role !== 'system'));
const LIFECYCLE_SET = new Set<string>(COMMAND_LIFECYCLE_STATES);
const RUNTIME_TYPES = new Set(
  'array bigint boolean function null number object string symbol undefined'.split(' '),
);

class DecodeAbort extends Error {
  constructor(readonly refusal: DecodeRefusal) {
    super(refusal.code);
  }
}

const runtimeType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const abortInvalid = (path: string, expected: string, value: unknown): never => {
  throw new DecodeAbort({
    actualType: runtimeType(value),
    code: 'INVALID_SHAPE',
    expected,
    path,
  });
};

const abortUnrecognized = (path: string, value: JsonValue): never => {
  throw new DecodeAbort({ code: 'UNRECOGNIZED', path, value });
};

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return abortInvalid(path, 'object', value);
  }
  return value as Record<string, unknown>;
};

const exact = (value: unknown, fields: string, path = '$'): Record<string, unknown> => {
  const object = record(value, path);
  const keys = fields.split(' ');
  const allowed = new Set(keys);
  for (const key of keys) {
    if (!Object.prototype.propertyIsEnumerable.call(object, key))
      abortInvalid(`${path}.${key}`, 'required enumerable field', undefined);
  }
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) abortUnrecognized(`${path}.${key}`, json(object[key], `${path}.${key}`));
  }
  return object;
};

const string = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    return abortInvalid(path, 'non-empty string', value);
  }
  return value;
};

const literal = <T extends JsonValue>(value: unknown, expected: T, path: string): T => {
  if (value !== expected) abortUnrecognized(path, json(value, path));
  return expected;
};

const oneOf = <T extends string>(value: unknown, allowed: ReadonlySet<string>, path: string): T => {
  const candidate = string(value, path);
  if (!allowed.has(candidate)) abortUnrecognized(path, candidate);
  return candidate as T;
};

const revision = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return abortInvalid(path, 'non-negative safe integer', value);
  }
  return value;
};

const json = (value: unknown, path: string, seen = new WeakSet<object>()): JsonValue => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== 'object') return abortInvalid(path, 'JSON value', value);
  if (seen.has(value)) return abortInvalid(path, 'acyclic JSON value', value);
  seen.add(value);
  if (Array.isArray(value)) {
    const result = Array.from(value, (item, index) =>
      json(item, `${path}[${String(index)}]`, seen),
    );
    seen.delete(value);
    return result;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    return abortInvalid(path, 'plain JSON object', value);
  }
  const result = Object.create(null) as Record<string, JsonValue>;
  for (const [key, item] of Object.entries(value)) result[key] = json(item, `${path}.${key}`, seen);
  seen.delete(value);
  return result;
};

const jsonObject = (value: unknown, path: string): JsonObject => {
  const parsed = json(value, path);
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as JsonObject;
  }
  return abortInvalid(path, 'JSON object', value);
};

const validated = <T>(value: unknown): T => value as T;

const revisions = (value: unknown, path: string): RevisionVector => {
  const object = exact(value, 'actorVisibilityRevision projectionRevision stateRevision', path);
  revision(object['actorVisibilityRevision'], `${path}.actorVisibilityRevision`);
  revision(object['projectionRevision'], `${path}.projectionRevision`);
  revision(object['stateRevision'], `${path}.stateRevision`);
  return validated(value);
};

const role = (value: unknown, path: string): InteractiveRole =>
  oneOf(value, INTERACTIVE_ROLE_SET, path);
const lifecycle = (value: unknown, path: string): CommandLifecycleState =>
  oneOf(value, LIFECYCLE_SET, path);

const workflowId = (
  value: unknown,
  path: string,
  vocabulary: ProtocolVocabulary,
): WorkflowCommandId => {
  const candidate = string(value, path);
  if (vocabulary.isWorkflowCommandId(candidate)) return candidate;
  return abortUnrecognized(path, candidate);
};

const capabilityId = (value: unknown, path: string): string => {
  const candidate = string(value, path);
  if (/^UI-CMD-[A-Z0-9-]+$/u.test(candidate)) return candidate;
  return abortUnrecognized(path, candidate);
};

const list = (
  value: unknown,
  path: string,
  read: (item: unknown, itemPath: string) => unknown,
): void => {
  if (!Array.isArray(value)) return abortInvalid(path, 'array', value);
  for (let index = 0; index < value.length; index += 1) {
    read(value[index], `${path}[${String(index)}]`);
  }
};

const base = (value: unknown): Record<string, unknown> => {
  const object = record(value, '$');
  if (!Object.hasOwn(object, 'protocolVersion')) {
    abortInvalid('$.protocolVersion', 'required field', undefined);
  }
  if (object['protocolVersion'] !== WIRE_PROTOCOL_VERSION) {
    abortUnrecognized('$.protocolVersion', json(object['protocolVersion'], '$.protocolVersion'));
  }
  if (!Object.hasOwn(object, 'messageType'))
    abortInvalid('$.messageType', 'required field', undefined);
  string(object['messageType'], '$.messageType');
  return object;
};

const transition = <K extends HostReadCommandKind | 'operation-command'>(
  value: unknown,
  path: string,
  vocabulary: ProtocolVocabulary,
  kinds: ReadonlySet<string>,
): AtlasTransitionReference<K> => {
  const object = exact(value, 'from kind to trigger', path);
  const from = string(object['from'], `${path}.from`);
  const to = string(object['to'], `${path}.to`);
  if (!vocabulary.isFormId(from)) return abortUnrecognized(`${path}.from`, from);
  if (!vocabulary.isFormId(to)) return abortUnrecognized(`${path}.to`, to);
  const kind = oneOf<K>(object['kind'], kinds, `${path}.kind`);
  const reference = { from, kind, to, trigger: string(object['trigger'], `${path}.trigger`) };
  if (!vocabulary.isHostTransition(reference)) abortUnrecognized(path, json(value, path));
  return reference;
};

const decisionPayload = (value: unknown, path: string): MasterPredicateDecisionPayload => {
  const object = exact(
    value,
    'decision linkedActionRequestId masterAuthorityRevision noReservation predicateRequestId returnContext',
    path,
  );
  oneOf(object['decision'], new Set(['NO', 'YES']), `${path}.decision`);
  string(object['linkedActionRequestId'], `${path}.linkedActionRequestId`);
  revision(object['masterAuthorityRevision'], `${path}.masterAuthorityRevision`);
  literal(object['noReservation'], true, `${path}.noReservation`);
  string(object['predicateRequestId'], `${path}.predicateRequestId`);
  jsonObject(object['returnContext'], `${path}.returnContext`);
  return validated(value);
};

const malformedJsonRefusal = (
  value: unknown,
  path: string,
): Extract<DecodeRefusal, { readonly code: 'MALFORMED_JSON' }> => {
  const object = exact(value, 'code detail path', path);
  string(object['detail'], `${path}.detail`);
  literal(object['path'], '$', `${path}.path`);
  return validated(value);
};

const invalidShapeRefusal = (
  value: unknown,
  path: string,
): Extract<DecodeRefusal, { readonly code: 'INVALID_SHAPE' }> => {
  const object = exact(value, 'actualType code expected path', path);
  oneOf(object['actualType'], RUNTIME_TYPES, `${path}.actualType`);
  string(object['expected'], `${path}.expected`);
  string(object['path'], `${path}.path`);
  return validated(value);
};

const unrecognizedRefusal = (
  value: unknown,
  path: string,
): Extract<DecodeRefusal, { readonly code: 'UNRECOGNIZED' }> => {
  const object = exact(value, 'code path value', path);
  string(object['path'], `${path}.path`);
  json(object['value'], `${path}.value`);
  return validated(value);
};

const decodeRefusal = (value: unknown, path: string): DecodeRefusal => {
  const object = record(value, path);
  const code = string(object['code'], `${path}.code`);
  if (code === 'MALFORMED_JSON') return malformedJsonRefusal(value, path);
  if (code === 'INVALID_SHAPE') return invalidShapeRefusal(value, path);
  if (code === 'UNRECOGNIZED') return unrecognizedRefusal(value, path);
  return abortUnrecognized(`${path}.code`, code);
};

const protocolRefusal = (value: unknown): ProtocolRefusalMessage => {
  const object = exact(value, 'messageType protocolVersion refusal relatedCommandId');
  const related = object['relatedCommandId'];
  literal(object['messageType'], 'protocol.refusal', '$.messageType');
  decodeRefusal(object['refusal'], '$.refusal');
  if (related !== null) string(related, '$.relatedCommandId');
  return validated(value);
};

const commandReceipt = (value: unknown): CommandReceipt => {
  const object = exact(value, 'commandId receiptId result revisions', '$.receipt');
  string(object['commandId'], '$.receipt.commandId');
  string(object['receiptId'], '$.receipt.receiptId');
  jsonObject(object['result'], '$.receipt.result');
  revisions(object['revisions'], '$.receipt.revisions');
  return validated(value);
};

const idempotencyConflictRefusal = (value: unknown): CommandRefusal => {
  const object = exact(value, 'code commandId detail', '$.refusal');
  string(object['commandId'], '$.refusal.commandId');
  literal(object['detail'], 'PAYLOAD_MISMATCH', '$.refusal.detail');
  return validated(value);
};

const masterPredicateDeniedRefusal = (value: unknown): CommandRefusal => {
  const object = exact(
    value,
    'code linkedActionRequestId noReservation predicateRequestId predicateState',
    '$.refusal',
  );
  string(object['linkedActionRequestId'], '$.refusal.linkedActionRequestId');
  literal(object['noReservation'], true, '$.refusal.noReservation');
  string(object['predicateRequestId'], '$.refusal.predicateRequestId');
  literal(object['predicateState'], 'NO_RECORDED', '$.refusal.predicateState');
  return validated(value);
};

const staleRevisionRefusal = (value: unknown): CommandRefusal => {
  const object = exact(value, 'actual code expected', '$.refusal');
  revisions(object['actual'], '$.refusal.actual');
  revisions(object['expected'], '$.refusal.expected');
  return validated(value);
};

const commandRefusalPayload = (value: unknown): CommandRefusal => {
  const object = record(value, '$.refusal');
  const code = string(object['code'], '$.refusal.code');
  if (code === 'INVALID_SHAPE') return invalidShapeRefusal(value, '$.refusal');
  if (code === 'UNRECOGNIZED') return unrecognizedRefusal(value, '$.refusal');
  if (code === 'GUARD_REJECTED') {
    exact(value, 'code', '$.refusal');
    return validated(value);
  }
  if (code === 'IDEMPOTENCY_CONFLICT') return idempotencyConflictRefusal(value);
  if (code === 'MASTER_PREDICATE_DENIED') return masterPredicateDeniedRefusal(value);
  if (code === 'STALE_REVISION') return staleRevisionRefusal(value);
  return abortUnrecognized('$.refusal.code', code);
};

const workflowCommandRequest = (
  value: unknown,
  vocabulary: ProtocolVocabulary,
): ClientToHostMessage => {
  const object = exact(
    value,
    'commandId commandKind expectedRevisions messageType payload protocolVersion role workflowCommandId',
  );
  const command = workflowId(object['workflowCommandId'], '$.workflowCommandId', vocabulary);
  const commandRole = role(object['role'], '$.role');
  if (command === MASTER_PREDICATE_RESPONSE_COMMAND_ID) {
    decisionPayload(object['payload'], '$.payload');
    if (commandRole !== 'gm') abortUnrecognized('$.role', commandRole);
  } else {
    jsonObject(object['payload'], '$.payload');
  }
  string(object['commandId'], '$.commandId');
  revisions(object['expectedRevisions'], '$.expectedRevisions');
  return validated(value);
};

const operationCommandRequest = (
  value: unknown,
  kind: string,
  vocabulary: ProtocolVocabulary,
): ClientToHostMessage => {
  const object = exact(
    value,
    'commandId commandKind expectedRevisions messageType payload protocolVersion role transition',
  );
  string(object['commandId'], '$.commandId');
  revisions(object['expectedRevisions'], '$.expectedRevisions');
  jsonObject(object['payload'], '$.payload');
  role(object['role'], '$.role');
  transition(object['transition'], '$.transition', vocabulary, new Set([kind]));
  return validated(value);
};

const commandRequest = (
  value: unknown,
  object: Record<string, unknown>,
  vocabulary: ProtocolVocabulary,
): ClientToHostMessage => {
  const kind = string(object['commandKind'], '$.commandKind');
  if (kind === 'workflow-command') return workflowCommandRequest(value, vocabulary);
  if (kind === 'operation-command') return operationCommandRequest(value, kind, vocabulary);
  return abortUnrecognized('$.commandKind', kind);
};

const readRequest = (value: unknown, vocabulary: ProtocolVocabulary): ClientToHostMessage => {
  const object = exact(
    value,
    'commandKind knownRevisions messageType parameters protocolVersion requestId role transition',
  );
  const kinds = new Set(['local-or-read-command', 'read-only-command']);
  const kind = oneOf<HostReadCommandKind>(object['commandKind'], kinds, '$.commandKind');
  const reference = transition<HostReadCommandKind>(
    object['transition'],
    '$.transition',
    vocabulary,
    kinds,
  );
  if (reference.kind !== kind) abortUnrecognized('$.transition.kind', reference.kind);
  revisions(object['knownRevisions'], '$.knownRevisions');
  jsonObject(object['parameters'], '$.parameters');
  string(object['requestId'], '$.requestId');
  role(object['role'], '$.role');
  return validated(value);
};

const projectionReconnect = (value: unknown): ClientToHostMessage => {
  const object = exact(
    value,
    'knownRevisions messageType projectionRole protocolVersion requestId supportedWorkflowCommandIds unacknowledgedCommandIds',
  );
  revisions(object['knownRevisions'], '$.knownRevisions');
  role(object['projectionRole'], '$.projectionRole');
  string(object['requestId'], '$.requestId');
  list(object['supportedWorkflowCommandIds'], '$.supportedWorkflowCommandIds', capabilityId);
  list(object['unacknowledgedCommandIds'], '$.unacknowledgedCommandIds', string);
  return validated(value);
};

const clientValue = (value: unknown, vocabulary: ProtocolVocabulary): ClientToHostMessage => {
  const object = base(value);
  switch (object['messageType']) {
    case 'command.request':
      return commandRequest(value, object, vocabulary);
    case 'read.request':
      return readRequest(value, vocabulary);
    case 'projection.reconnect':
      return projectionReconnect(value);
    case 'protocol.refusal':
      return protocolRefusal(value);
    default:
      return abortUnrecognized('$.messageType', string(object['messageType'], '$.messageType'));
  }
};

const commandDelivery = (value: unknown, replay: boolean): HostToClientMessage => {
  const item = exact(value, 'lifecycleState messageType protocolVersion receipt');
  literal(item['lifecycleState'], replay ? 'IDEMPOTENT_REPLAY' : 'COMMITTED', '$.lifecycleState');
  literal(item['messageType'], replay ? 'command.replay' : 'command.result', '$.messageType');
  commandReceipt(item['receipt']);
  return validated(value);
};

const commandPending = (value: unknown): HostToClientMessage => {
  const object = exact(
    value,
    'commandId lifecycleState messageType noReservation predicateRequestId predicateState protocolVersion revisions',
  );
  string(object['commandId'], '$.commandId');
  literal(object['lifecycleState'], 'PENDING_CONSENT', '$.lifecycleState');
  literal(object['noReservation'], true, '$.noReservation');
  string(object['predicateRequestId'], '$.predicateRequestId');
  literal(object['predicateState'], 'PENDING_PREDICATE', '$.predicateState');
  revisions(object['revisions'], '$.revisions');
  return validated(value);
};

const commandRefusalMessage = (value: unknown): HostToClientMessage => {
  const object = exact(
    value,
    'commandId lastLifecycleState messageType protocolVersion refusal revisions',
  );
  const last = object['lastLifecycleState'];
  if (last !== null && (last === 'COMMITTED' || last === 'IDEMPOTENT_REPLAY')) {
    abortUnrecognized('$.lastLifecycleState', last);
  }
  string(object['commandId'], '$.commandId');
  if (last !== null) lifecycle(last, '$.lastLifecycleState');
  commandRefusalPayload(object['refusal']);
  revisions(object['revisions'], '$.revisions');
  return validated(value);
};

const masterPredicateRequest = (value: unknown): HostToClientMessage => {
  const object = exact(
    value,
    'audience commandState guardState linkedActionRequestId masterAuthorityRevision messageType noReservation predicateQuestion predicateRequestId predicateState predicateType protocolVersion requestingCharacterId returnContext revisions',
  );
  literal(object['audience'], 'gm', '$.audience');
  literal(object['commandState'], 'PENDING_CONSENT', '$.commandState');
  literal(object['guardState'], 'consent/masterPredicate', '$.guardState');
  string(object['linkedActionRequestId'], '$.linkedActionRequestId');
  revision(object['masterAuthorityRevision'], '$.masterAuthorityRevision');
  literal(object['noReservation'], true, '$.noReservation');
  string(object['predicateQuestion'], '$.predicateQuestion');
  string(object['predicateRequestId'], '$.predicateRequestId');
  literal(object['predicateState'], 'PENDING_PREDICATE', '$.predicateState');
  string(object['predicateType'], '$.predicateType');
  string(object['requestingCharacterId'], '$.requestingCharacterId');
  jsonObject(object['returnContext'], '$.returnContext');
  revisions(object['revisions'], '$.revisions');
  return validated(value);
};

const projectionSnapshot = (
  value: unknown,
  vocabulary: ProtocolVocabulary,
): HostToClientMessage => {
  const object = exact(
    value,
    'executableWorkflowCommandIds messageType projection projectionRole protocolVersion requestId revisions',
  );
  list(object['executableWorkflowCommandIds'], '$.executableWorkflowCommandIds', (entry, path) =>
    workflowId(entry, path, vocabulary),
  );
  jsonObject(object['projection'], '$.projection');
  role(object['projectionRole'], '$.projectionRole');
  string(object['requestId'], '$.requestId');
  revisions(object['revisions'], '$.revisions');
  return validated(value);
};

const readResult = (value: unknown): HostToClientMessage => {
  const object = exact(value, 'messageType protocolVersion requestId result revisions');
  string(object['requestId'], '$.requestId');
  jsonObject(object['result'], '$.result');
  revisions(object['revisions'], '$.revisions');
  return validated(value);
};

const readRefusal = (value: unknown): HostToClientMessage => {
  const object = exact(value, 'messageType protocolVersion refusal requestId revisions');
  const refusal = decodeRefusal(object['refusal'], '$.refusal');
  if (refusal.code === 'MALFORMED_JSON') {
    return abortUnrecognized('$.refusal.code', refusal.code);
  }
  string(object['requestId'], '$.requestId');
  revisions(object['revisions'], '$.revisions');
  return validated(value);
};

const hostValue = (value: unknown, vocabulary: ProtocolVocabulary): HostToClientMessage => {
  const object = base(value);
  switch (object['messageType']) {
    case 'command.result':
      return commandDelivery(value, false);
    case 'command.replay':
      return commandDelivery(value, true);
    case 'command.pending':
      return commandPending(value);
    case 'command.refusal':
      return commandRefusalMessage(value);
    case 'master-predicate.request':
      return masterPredicateRequest(value);
    case 'projection.snapshot':
      return projectionSnapshot(value, vocabulary);
    case 'read.result':
      return readResult(value);
    case 'read.refusal':
      return readRefusal(value);
    case 'protocol.refusal':
      return protocolRefusal(value);
    default:
      return abortUnrecognized('$.messageType', string(object['messageType'], '$.messageType'));
  }
};

const decodeValue = <T>(reader: () => T): DecodeResult<T> => {
  try {
    return { ok: true, value: reader() };
  } catch (error: unknown) {
    if (error instanceof DecodeAbort) return { ok: false, refusal: error.refusal };
    throw error;
  }
};

const parse = <T>(text: string, reader: (value: unknown) => T): DecodeResult<T> => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    return {
      ok: false,
      refusal: {
        code: 'MALFORMED_JSON',
        detail: error instanceof Error ? error.message : 'JSON.parse failed',
        path: '$',
      },
    };
  }
  return decodeValue(() => reader(value));
};

const encode = <T>(value: T, reader: (candidate: unknown) => T): EncodeResult => {
  const checked = decodeValue(() => reader(json(value, '$')));
  if (!checked.ok) return checked;
  return { ok: true, text: JSON.stringify(checked.value) };
};

export const decodeClientMessage = (
  text: string,
  vocabulary: ProtocolVocabulary,
): DecodeResult<ClientToHostMessage> => parse(text, (value) => clientValue(value, vocabulary));

export const decodeHostMessage = (
  text: string,
  vocabulary: ProtocolVocabulary,
): DecodeResult<HostToClientMessage> => parse(text, (value) => hostValue(value, vocabulary));

export const encodeClientMessage = (
  value: ClientToHostMessage,
  vocabulary: ProtocolVocabulary,
): EncodeResult => encode(value, (candidate) => clientValue(candidate, vocabulary));

export const encodeHostMessage = (
  value: HostToClientMessage,
  vocabulary: ProtocolVocabulary,
): EncodeResult => encode(value, (candidate) => hostValue(candidate, vocabulary));
