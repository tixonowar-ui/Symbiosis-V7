import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  MASTER_PREDICATE_RESPONSE_COMMAND_ID,
  WIRE_PROTOCOL_V2_VERSION,
  decodeClientMessage,
  decodeClientMessageV2,
  decodeHostMessage,
  decodeHostMessageV2,
  encodeClientMessageV2,
  encodeHostMessageV2,
} from './index.js';
import type {
  ClientToHostV2Message,
  DecodeRefusal,
  DecodeResult,
  HostToClientV2Message,
  ProtocolVocabulary,
  RevisionVector,
  SessionReconnectCapabilitiesV2Message,
  SessionReconnectV2Message,
  WireV2Vocabulary,
  WorkflowCommandCapabilityId,
  WorkflowCommandId,
} from './index.js';

const DEVICE_ID = '123e4567-e89b-42d3-a456-426614174000';
const CONTROLLER_SEAT_FIELD = ['controller', 'Seat'].join('');
const FUTURE_CAPABILITY = ['UI', 'CMD', 'CLIENT', 'ONLY'].join('-') as WorkflowCommandCapabilityId;
const MALFORMED_CAPABILITY = ['UI', 'CMD', 'client', 'only'].join('-');
const workflowCommands = new Set<string>([MASTER_PREDICATE_RESPONSE_COMMAND_ID]);

const vocabulary: WireV2Vocabulary = {
  isAddressableRouteTemplate: (_value): _value is never => false,
  isClientRouteBindings: () => false,
  isFormActionKey: (_formId, _value): _value is never => false,
  isFormId: (_value): _value is never => false,
  isPresentedForm: () => false,
  isWorkflowCommandId: (value): value is WorkflowCommandId => workflowCommands.has(value),
};

const v1Vocabulary: ProtocolVocabulary = {
  isFormId: (_value): _value is never => false,
  isHostTransition: () => false,
  isWorkflowCommandId: (value): value is WorkflowCommandId => workflowCommands.has(value),
};

const revisions = {
  actorVisibilityRevision: 3,
  projectionRevision: 7,
  stateRevision: 5,
} as const satisfies RevisionVector;

const reconnect = {
  deviceId: DEVICE_ID,
  knownRevisions: revisions,
  messageType: 'session.reconnect',
  protocolVersion: WIRE_PROTOCOL_V2_VERSION,
  reconnectRequestId: 'reconnect-1',
  supportedWorkflowCommandIds: [MASTER_PREDICATE_RESPONSE_COMMAND_ID, FUTURE_CAPABILITY],
  unacknowledgedCommandIds: ['command-1'],
} as const satisfies SessionReconnectV2Message;

const capabilities = {
  executableWorkflowCommandIds: [MASTER_PREDICATE_RESPONSE_COMMAND_ID],
  messageType: 'session.reconnect.capabilities',
  protocolVersion: WIRE_PROTOCOL_V2_VERSION,
  reconnectRequestId: reconnect.reconnectRequestId,
  revisions,
} as const satisfies SessionReconnectCapabilitiesV2Message;

const unwrap = <T>(result: DecodeResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`unexpected refusal: ${result.refusal.code}`);
  return result.value;
};

const refuse = <T>(result: DecodeResult<T>): DecodeRefusal => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected refusal');
  return result.refusal;
};

const refuseClient = (value: unknown): DecodeRefusal =>
  refuse(decodeClientMessageV2(JSON.stringify(value), vocabulary));

const refuseHost = (value: unknown): DecodeRefusal =>
  refuse(decodeHostMessageV2(JSON.stringify(value), vocabulary));

const clientRoundTrip = (message: ClientToHostV2Message): ClientToHostV2Message => {
  const encoded = encodeClientMessageV2(message, vocabulary);
  expect(encoded.ok).toBe(true);
  if (!encoded.ok) throw new Error(`unexpected encode refusal: ${encoded.refusal.code}`);
  return unwrap(decodeClientMessageV2(encoded.text, vocabulary));
};

const hostRoundTrip = (message: HostToClientV2Message): HostToClientV2Message => {
  const encoded = encodeHostMessageV2(message, vocabulary);
  expect(encoded.ok).toBe(true);
  if (!encoded.ok) throw new Error(`unexpected encode refusal: ${encoded.refusal.code}`);
  return unwrap(decodeHostMessageV2(encoded.text, vocabulary));
};

const omitField = (value: object, field: string): Record<string, unknown> => {
  const copy = { ...value } as Record<string, unknown>;
  delete copy[field];
  return copy;
};

const versionRefusal = (value: number): DecodeRefusal => ({
  code: 'UNRECOGNIZED',
  path: '$.protocolVersion',
  value,
});

describe('wire v2 reconnect contracts', () => {
  it('adds the reconnect request and capability frame to their directional unions', () => {
    expectTypeOf<
      Extract<ClientToHostV2Message, { messageType: 'session.reconnect' }>
    >().toEqualTypeOf<SessionReconnectV2Message>();
    expectTypeOf<
      Extract<HostToClientV2Message, { messageType: 'session.reconnect.capabilities' }>
    >().toEqualTypeOf<SessionReconnectCapabilitiesV2Message>();
  });

  it('round-trips both exact reconnect messages', () => {
    expect(clientRoundTrip(reconnect)).toEqual(reconnect);
    expect(hostRoundTrip(capabilities)).toEqual(capabilities);
  });

  it('accepts first connect with zero revisions and empty command lists', () => {
    const firstConnect = {
      ...reconnect,
      knownRevisions: {
        actorVisibilityRevision: 0,
        projectionRevision: 0,
        stateRevision: 0,
      },
      supportedWorkflowCommandIds: [],
      unacknowledgedCommandIds: [],
    } as const satisfies SessionReconnectV2Message;

    expect(clientRoundTrip(firstConnect)).toEqual(firstConnect);
  });

  it.each([
    ['projectionRole', 'player'],
    ['contextId', 'forged-context'],
    [CONTROLLER_SEAT_FIELD, 'forged-seat'],
    ['form', 'forged-form'],
    ['formId', 'forged-form'],
    ['route', 'forged-route'],
    ['routeTemplate', 'forged-route'],
    ['destination', 'forged-destination'],
    ['url', 'forged-url'],
    ['history', 'forged-history'],
  ] as const)('rejects forbidden reconnect field %s in decode and encode', (field, value) => {
    const forged = { ...reconnect, [field]: value } as unknown as ClientToHostV2Message;
    const expected = { code: 'UNRECOGNIZED', path: `$.${field}`, value } as const;

    expect(refuseClient(forged)).toEqual(expected);
    expect(encodeClientMessageV2(forged, vocabulary)).toEqual({ ok: false, refusal: expected });
  });

  it('rejects an unknown capability-frame field in decode and encode', () => {
    const forged = {
      ...capabilities,
      projectionRole: 'player',
    } as unknown as HostToClientV2Message;
    const expected = {
      code: 'UNRECOGNIZED',
      path: '$.projectionRole',
      value: 'player',
    } as const;

    expect(refuseHost(forged)).toEqual(expected);
    expect(encodeHostMessageV2(forged, vocabulary)).toEqual({ ok: false, refusal: expected });
  });

  it.each([
    ['request', 'deviceId', reconnect],
    ['request', 'knownRevisions', reconnect],
    ['request', 'reconnectRequestId', reconnect],
    ['request', 'supportedWorkflowCommandIds', reconnect],
    ['request', 'unacknowledgedCommandIds', reconnect],
    ['capabilities', 'executableWorkflowCommandIds', capabilities],
    ['capabilities', 'reconnectRequestId', capabilities],
    ['capabilities', 'revisions', capabilities],
  ] as const)('rejects a missing %s field $.%s', (direction, field, message) => {
    const refusal =
      direction === 'request'
        ? refuseClient(omitField(message, field))
        : refuseHost(omitField(message, field));

    expect(refusal).toEqual({
      actualType: 'undefined',
      code: 'INVALID_SHAPE',
      expected: 'required enumerable field',
      path: `$.${field}`,
    });
  });

  it.each([
    ['uppercase', DEVICE_ID.toUpperCase()],
    ['version-7', '123e4567-e89b-72d3-a456-426614174000'],
    ['wrong-variant', '123e4567-e89b-42d3-7456-426614174000'],
  ] as const)('rejects %s deviceId with its exact path and value', (_case, deviceId) => {
    const forged = { ...reconnect, deviceId } as unknown as ClientToHostV2Message;
    const expected = { code: 'UNRECOGNIZED', path: '$.deviceId', value: deviceId } as const;

    expect(refuseClient(forged)).toEqual(expected);
    expect(encodeClientMessageV2(forged, vocabulary)).toEqual({ ok: false, refusal: expected });
  });

  it('distinguishes shaped client capability tokens from exact executable vocabulary', () => {
    const futureRequest = {
      ...reconnect,
      supportedWorkflowCommandIds: [FUTURE_CAPABILITY],
    } satisfies SessionReconnectV2Message;
    expect(clientRoundTrip(futureRequest)).toEqual(futureRequest);

    const futureExecutable = {
      ...capabilities,
      executableWorkflowCommandIds: [FUTURE_CAPABILITY],
    } as unknown as HostToClientV2Message;
    const executableRefusal = {
      code: 'UNRECOGNIZED',
      path: '$.executableWorkflowCommandIds[0]',
      value: FUTURE_CAPABILITY,
    } as const;
    expect(refuseHost(futureExecutable)).toEqual(executableRefusal);
    expect(encodeHostMessageV2(futureExecutable, vocabulary)).toEqual({
      ok: false,
      refusal: executableRefusal,
    });

    const malformedSupported = {
      ...reconnect,
      supportedWorkflowCommandIds: [MALFORMED_CAPABILITY],
    } as unknown as ClientToHostV2Message;
    const supportedRefusal = {
      code: 'UNRECOGNIZED',
      path: '$.supportedWorkflowCommandIds[0]',
      value: MALFORMED_CAPABILITY,
    } as const;
    expect(refuseClient(malformedSupported)).toEqual(supportedRefusal);
    expect(encodeClientMessageV2(malformedSupported, vocabulary)).toEqual({
      ok: false,
      refusal: supportedRefusal,
    });
  });

  it.each([
    [
      'supported list',
      '$.supportedWorkflowCommandIds',
      { ...reconnect, supportedWorkflowCommandIds: 'not-an-array' },
    ],
    [
      'unacknowledged item',
      '$.unacknowledgedCommandIds[0]',
      { ...reconnect, unacknowledgedCommandIds: [0] },
    ],
    [
      'executable list',
      '$.executableWorkflowCommandIds',
      { ...capabilities, executableWorkflowCommandIds: 'not-an-array' },
    ],
  ] as const)('rejects malformed %s at %s', (kind, path, value) => {
    const refusal = kind === 'executable list' ? refuseHost(value) : refuseClient(value);
    expect(refusal).toMatchObject({ code: 'INVALID_SHAPE', path });
  });

  it('keeps the new message types directional', () => {
    expect(refuseHost(reconnect)).toEqual({
      code: 'UNRECOGNIZED',
      path: '$.messageType',
      value: 'session.reconnect',
    });
    expect(refuseClient(capabilities)).toEqual({
      code: 'UNRECOGNIZED',
      path: '$.messageType',
      value: 'session.reconnect.capabilities',
    });
  });

  it('fails closed across v1 and v2 for both new messages', () => {
    expect(refuse(decodeClientMessage(JSON.stringify(reconnect), v1Vocabulary))).toEqual(
      versionRefusal(2),
    );
    expect(refuse(decodeHostMessage(JSON.stringify(capabilities), v1Vocabulary))).toEqual(
      versionRefusal(2),
    );
    expect(refuseClient({ ...reconnect, protocolVersion: 1 })).toEqual(versionRefusal(1));
    expect(refuseHost({ ...capabilities, protocolVersion: 1 })).toEqual(versionRefusal(1));
    expect(refuseClient({ ...reconnect, protocolVersion: 3 })).toEqual(versionRefusal(3));
    expect(refuseHost({ ...capabilities, protocolVersion: 3 })).toEqual(versionRefusal(3));
  });
});
