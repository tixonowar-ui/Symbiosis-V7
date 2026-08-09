import { FORM_IDS } from '@generated/types/atlas.js';
import type { GuardState } from '@generated/types/atlas.js';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  decodeClientMessage,
  decodeHostMessage,
  encodeClientMessage,
  encodeHostMessage,
} from './wire-codec.js';
import {
  COMMAND_KIND_ROUTE,
  MASTER_PREDICATE_RESPONSE_COMMAND_ID,
  MASTER_PREDICATE_STATES,
  WIRE_PROTOCOL_VERSION,
} from './wire-protocol.js';
import type {
  ClientToHostMessage,
  CommandKind,
  CommandRefusalMessage,
  CommandReplayMessage,
  CommandResultMessage,
  DecodeRefusal,
  DecodeResult,
  HostToClientMessage,
  InteractiveRole,
  MasterPredicateDecision,
  MasterPredicateDecisionMessage,
  MasterPredicateDecisionPayload,
  MasterPredicateRequestMessage,
  MasterPredicateStatus,
  OperationCommandRequestMessage,
  ProjectionReconnectMessage,
  ProjectionSnapshotMessage,
  ProtocolVocabulary,
  ReadRequestMessage,
  RevisionVector,
  WorkflowCommandId,
  WorkflowCommandRequestMessage,
} from './wire-protocol.js';

const TEST_WORKFLOW_COMMANDS = [
  MASTER_PREDICATE_RESPONSE_COMMAND_ID,
  'UI-CMD-CAMPAIGN-CREATE',
  'UI-CMD-CONNECTION-OPEN',
] as const satisfies readonly WorkflowCommandId[];
const FUTURE_WORKFLOW_CAPABILITY = `${'UI-CMD-'}FUTURE` as const;
const UNKNOWN_WORKFLOW_COMMAND = `${'UI-CMD-'}NOT-IN-ATLAS` as const;
const workflowCommands = new Set<string>(TEST_WORKFLOW_COMMANDS);
const formIds = new Set<string>(FORM_IDS);
const hostTransitions = new Set([
  'CMP-012|read-only-command|CMP-012|Открыть архив read-only',
  'PLY-021|operation-command|PLY-021|Взять допустимое количество',
]);
const vocabulary: ProtocolVocabulary = {
  isFormId: (value): value is (typeof FORM_IDS)[number] => formIds.has(value),
  isHostTransition: (value) =>
    hostTransitions.has(`${value.from}|${value.kind}|${value.to}|${value.trigger}`),
  isWorkflowCommandId: (value): value is WorkflowCommandId => workflowCommands.has(value),
};

const currentRevisions = {
  actorVisibilityRevision: 3,
  projectionRevision: 7,
  stateRevision: 5,
} as const satisfies RevisionVector;

const masterDecision = {
  commandId: 'predicate-response-command-1',
  commandKind: 'workflow-command',
  expectedRevisions: currentRevisions,
  messageType: 'command.request',
  payload: {
    decision: 'NO',
    linkedActionRequestId: 'linked-action-1',
    masterAuthorityRevision: 2,
    noReservation: true,
    predicateRequestId: 'predicate-1',
    returnContext: { handoffId: 'handoff-1', returnFormId: 'PLY-019' },
  },
  protocolVersion: WIRE_PROTOCOL_VERSION,
  role: 'gm',
  workflowCommandId: MASTER_PREDICATE_RESPONSE_COMMAND_ID,
} as const satisfies MasterPredicateDecisionMessage;

const predicateRequest = {
  audience: 'gm',
  commandState: 'PENDING_CONSENT',
  guardState: 'consent/masterPredicate',
  linkedActionRequestId: 'linked-action-1',
  masterAuthorityRevision: 2,
  messageType: 'master-predicate.request',
  noReservation: true,
  predicateQuestion: 'Is the target against green plants?',
  predicateRequestId: 'predicate-1',
  predicateState: 'PENDING_PREDICATE',
  predicateType: 'WORLD_FACT',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  requestingCharacterId: 'character-1',
  returnContext: { handoffId: 'handoff-1', returnFormId: 'PLY-019' },
  revisions: currentRevisions,
} as const satisfies MasterPredicateRequestMessage;

const unwrap = <T>(result: DecodeResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`unexpected refusal: ${result.refusal.code}`);
  return result.value;
};

const refuse = <T>(result: DecodeResult<T>): DecodeRefusal => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a refusal');
  return result.refusal;
};

describe('wire protocol types', () => {
  it('derives roles, guards, six command kinds and workflow IDs from atlas types', () => {
    expectTypeOf<WorkflowCommandRequestMessage['role']>().toEqualTypeOf<InteractiveRole>();
    expectTypeOf<MasterPredicateRequestMessage['guardState']>().toEqualTypeOf<
      Extract<GuardState, 'consent/masterPredicate'>
    >();
    expectTypeOf<CommandKind>().toEqualTypeOf<
      | 'local-command'
      | 'local-draft-command'
      | 'local-or-read-command'
      | 'operation-command'
      | 'read-only-command'
      | 'workflow-command'
    >();
    expect(COMMAND_KIND_ROUTE).toEqual({
      'local-command': 'CLIENT_LOCAL',
      'local-draft-command': 'CLIENT_LOCAL',
      'local-or-read-command': 'CLIENT_LOCAL_OR_HOST_READ',
      'operation-command': 'HOST_MUTATION',
      'read-only-command': 'HOST_READ',
      'workflow-command': 'HOST_MUTATION',
    });

    const known: WorkflowCommandId = MASTER_PREDICATE_RESPONSE_COMMAND_ID;
    // @ts-expect-error The current atlas has no such workflow command.
    const invented: WorkflowCommandId = UNKNOWN_WORKFLOW_COMMAND;
    // @ts-expect-error Client-only transitions never enter the mutation envelope.
    const localKind: WorkflowCommandRequestMessage['commandKind'] = 'local-command';
    expect([known, invented, localKind]).toHaveLength(3);
  });

  it('makes required fields and predicate decisions compile-time contracts', () => {
    const complete: MasterPredicateDecisionMessage = masterDecision;
    // @ts-expect-error A wire command without the revision precondition is incomplete.
    const missingRevisions: WorkflowCommandRequestMessage = {
      commandId: 'missing-revisions',
      commandKind: 'workflow-command',
      messageType: 'command.request',
      payload: {},
      protocolVersion: WIRE_PROTOCOL_VERSION,
      role: 'player',
      workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
    };
    // @ts-expect-error GM-029 permits exactly YES or NO, not an implicit third response.
    const unknownDecision: MasterPredicateDecision = 'UNKNOWN';
    // @ts-expect-error The response cannot claim that the predicate reserved resources.
    const earlyReservation: MasterPredicateDecisionPayload['noReservation'] = false;
    // @ts-expect-error A recorded YES cannot carry the NO state.
    const mismatchedStatus: MasterPredicateStatus = {
      decision: 'YES',
      predicateState: 'NO_RECORDED',
    };
    // @ts-expect-error The system role is server-side and cannot claim a client projection.
    const systemClaim: WorkflowCommandRequestMessage['role'] = 'system';
    const extraPredicateField: MasterPredicateDecisionPayload = {
      ...masterDecision.payload,
      // @ts-expect-error Exact GM payloads cannot grow silently within protocol v1.
      extra: true,
    };
    expect([
      complete,
      missingRevisions,
      unknownDecision,
      earlyReservation,
      mismatchedStatus,
      systemClaim,
      extraPredicateField,
    ]).toHaveLength(7);
  });

  it('keeps master decisions and message directions discriminated', () => {
    const narrow = (message: ClientToHostMessage): void => {
      if (
        message.messageType === 'command.request' &&
        message.commandKind === 'workflow-command' &&
        message.workflowCommandId === MASTER_PREDICATE_RESPONSE_COMMAND_ID
      ) {
        expectTypeOf(message.payload).toEqualTypeOf<MasterPredicateDecisionPayload>();
      }
    };
    narrow(masterDecision);

    // @ts-expect-error Host-only requests cannot enter the client-to-host union.
    const wrongClientDirection: ClientToHostMessage = predicateRequest;
    // @ts-expect-error Client commands cannot enter the host-to-client union.
    const wrongHostDirection: HostToClientMessage = masterDecision;
    expect([wrongClientDirection, wrongHostDirection]).toHaveLength(2);
  });

  it('keeps four predicate states distinct from the two recorded decisions', () => {
    expect(MASTER_PREDICATE_STATES).toEqual([
      'PENDING_PREDICATE',
      'YES_RECORDED',
      'NO_RECORDED',
      'UNKNOWN_OR_CLOSED',
    ]);
  });
});

describe('wire codec', () => {
  it('round-trips the GM-029 request and its linked YES/NO command', () => {
    const encodedRequest = encodeHostMessage(predicateRequest, vocabulary);
    expect(encodedRequest.ok).toBe(true);
    if (!encodedRequest.ok) return;
    expect(unwrap(decodeHostMessage(encodedRequest.text, vocabulary))).toEqual(predicateRequest);

    const encodedDecision = encodeClientMessage(masterDecision, vocabulary);
    expect(encodedDecision.ok).toBe(true);
    if (!encodedDecision.ok) return;
    expect(unwrap(decodeClientMessage(encodedDecision.text, vocabulary))).toEqual(masterDecision);
  });

  it('carries revisions through reconnect and replaces cache with a fresh role projection', () => {
    const reconnect = {
      knownRevisions: currentRevisions,
      messageType: 'projection.reconnect',
      projectionRole: 'player',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: 'reconnect-1',
      supportedWorkflowCommandIds: TEST_WORKFLOW_COMMANDS,
      unacknowledgedCommandIds: ['campaign-create-1'],
    } as const satisfies ProjectionReconnectMessage;
    const snapshot = {
      messageType: 'projection.snapshot',
      executableWorkflowCommandIds: ['UI-CMD-CONNECTION-OPEN'],
      projection: { allowedActions: ['UI-CMD-CONNECTION-OPEN'] },
      projectionRole: 'player',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: reconnect.requestId,
      revisions: currentRevisions,
    } as const satisfies ProjectionSnapshotMessage;

    const encodedReconnect = encodeClientMessage(reconnect, vocabulary);
    const encodedSnapshot = encodeHostMessage(snapshot, vocabulary);
    expect(encodedReconnect.ok && encodedSnapshot.ok).toBe(true);
    if (!encodedReconnect.ok || !encodedSnapshot.ok) return;
    expect(unwrap(decodeClientMessage(encodedReconnect.text, vocabulary))).toEqual(reconnect);
    expect(unwrap(decodeHostMessage(encodedSnapshot.text, vocabulary))).toEqual(snapshot);

    const futureCapability = {
      ...reconnect,
      supportedWorkflowCommandIds: [...TEST_WORKFLOW_COMMANDS, FUTURE_WORKFLOW_CAPABILITY],
    };
    expect(unwrap(decodeClientMessage(JSON.stringify(futureCapability), vocabulary))).toEqual(
      futureCapability,
    );

    const unsupported = {
      ...snapshot,
      executableWorkflowCommandIds: [UNKNOWN_WORKFLOW_COMMAND],
    };
    expect(refuse(decodeHostMessage(JSON.stringify(unsupported), vocabulary))).toMatchObject({
      code: 'UNRECOGNIZED',
      path: '$.executableWorkflowCommandIds[0]',
    });
  });

  it('uses a separate non-mutating read channel for read-only and hybrid transitions', () => {
    const read = {
      commandKind: 'read-only-command',
      knownRevisions: currentRevisions,
      messageType: 'read.request',
      parameters: { archiveId: 'archive-1' },
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: 'read-1',
      role: 'gm',
      transition: {
        from: 'CMP-012',
        kind: 'read-only-command',
        to: 'CMP-012',
        trigger: 'Открыть архив read-only',
      },
    } as const satisfies ReadRequestMessage;
    const encoded = encodeClientMessage(read, vocabulary);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(unwrap(decodeClientMessage(encoded.text, vocabulary))).toEqual(read);
  });

  it('routes an exact atlas operation transition to the authoritative host', () => {
    const operation = {
      commandId: 'loot-take-1',
      commandKind: 'operation-command',
      expectedRevisions: currentRevisions,
      messageType: 'command.request',
      payload: { quantity: 1 },
      protocolVersion: WIRE_PROTOCOL_VERSION,
      role: 'player',
      transition: {
        from: 'PLY-021',
        kind: 'operation-command',
        to: 'PLY-021',
        trigger: 'Взять допустимое количество',
      },
    } as const satisfies OperationCommandRequestMessage;
    const encoded = encodeClientMessage(operation, vocabulary);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(unwrap(decodeClientMessage(encoded.text, vocabulary))).toEqual(operation);

    const invented = { ...operation, transition: { ...operation.transition, trigger: 'INVENTED' } };
    expect(refuse(decodeClientMessage(JSON.stringify(invented), vocabulary))).toEqual({
      code: 'UNRECOGNIZED',
      path: '$.transition',
      value: invented.transition,
    });
  });

  it('distinguishes a committed result from idempotent replay while preserving the receipt', () => {
    const receipt = {
      commandId: 'campaign-create-1',
      receiptId: 'receipt-1',
      result: { campaignId: 'campaign-1', randomResult: 17 },
      revisions: currentRevisions,
    } as const;
    const result = {
      lifecycleState: 'COMMITTED',
      messageType: 'command.result',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      receipt,
    } as const satisfies CommandResultMessage;
    const replay = {
      lifecycleState: 'IDEMPOTENT_REPLAY',
      messageType: 'command.replay',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      receipt,
    } as const satisfies CommandReplayMessage;

    const encodedResult = encodeHostMessage(result, vocabulary);
    const encodedReplay = encodeHostMessage(replay, vocabulary);
    expect(encodedResult.ok && encodedReplay.ok).toBe(true);
    if (!encodedResult.ok || !encodedReplay.ok) return;
    const decodedResult = unwrap(decodeHostMessage(encodedResult.text, vocabulary));
    const decodedReplay = unwrap(decodeHostMessage(encodedReplay.text, vocabulary));
    expect('receipt' in decodedResult && 'receipt' in decodedReplay).toBe(true);
    if ('receipt' in decodedResult && 'receipt' in decodedReplay) {
      expect(decodedReplay.receipt).toEqual(decodedResult.receipt);
    }
  });

  it.each([
    {
      commandId: 'pending-action-1',
      lifecycleState: 'PENDING_CONSENT',
      messageType: 'command.pending',
      noReservation: true,
      predicateRequestId: 'predicate-1',
      predicateState: 'PENDING_PREDICATE',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      revisions: currentRevisions,
    },
    {
      messageType: 'read.result',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: 'read-1',
      result: { entries: 3 },
      revisions: currentRevisions,
    },
    {
      messageType: 'read.refusal',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      refusal: { code: 'UNRECOGNIZED', path: '$.transition', value: 'INVENTED' },
      requestId: 'read-2',
      revisions: currentRevisions,
    },
    {
      messageType: 'protocol.refusal',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      refusal: { code: 'MALFORMED_JSON', detail: 'invalid JSON frame', path: '$' },
      relatedCommandId: null,
    },
  ] as const satisfies readonly HostToClientMessage[])('round-trips $messageType', (message) => {
    const encoded = encodeHostMessage(message, vocabulary);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(unwrap(decodeHostMessage(encoded.text, vocabulary))).toEqual(message);
  });

  it('represents an unrecognized value as data rather than an exception', () => {
    const refusal = {
      commandId: 'unknown-command-1',
      lastLifecycleState: null,
      messageType: 'command.refusal',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      refusal: {
        code: 'UNRECOGNIZED',
        path: '$.workflowCommandId',
        value: UNKNOWN_WORKFLOW_COMMAND,
      },
      revisions: currentRevisions,
    } as const satisfies CommandRefusalMessage;
    const encoded = encodeHostMessage(refusal, vocabulary);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(unwrap(decodeHostMessage(encoded.text, vocabulary))).toEqual(refusal);
  });

  it.each([
    [
      'unknown version',
      { ...masterDecision, protocolVersion: 2 },
      'UNRECOGNIZED',
      '$.protocolVersion',
    ],
    [
      'unknown message',
      { ...masterDecision, messageType: 'future.message' },
      'UNRECOGNIZED',
      '$.messageType',
    ],
    [
      'client-only kind',
      { ...masterDecision, commandKind: 'local-command' },
      'UNRECOGNIZED',
      '$.commandKind',
    ],
    [
      'unknown command',
      { ...masterDecision, workflowCommandId: UNKNOWN_WORKFLOW_COMMAND },
      'UNRECOGNIZED',
      '$.workflowCommandId',
    ],
    [
      'wrong decision',
      { ...masterDecision, payload: { ...masterDecision.payload, decision: 'UNKNOWN' } },
      'UNRECOGNIZED',
      '$.payload.decision',
    ],
    ['wrong authority', { ...masterDecision, role: 'player' }, 'UNRECOGNIZED', '$.role'],
    ['system authority', { ...masterDecision, role: 'system' }, 'UNRECOGNIZED', '$.role'],
    [
      'unsafe revision',
      {
        ...masterDecision,
        expectedRevisions: { ...currentRevisions, stateRevision: 9_007_199_254_740_992 },
      },
      'INVALID_SHAPE',
      '$.expectedRevisions.stateRevision',
    ],
  ])('rejects %s without returning a partial message', (_name, value, code, path) => {
    const failure = refuse(decodeClientMessage(JSON.stringify(value), vocabulary));
    expect(failure).toMatchObject({ code, path });
  });

  it('rejects malformed JSON, missing fields and unexpected fields', () => {
    expect(refuse(decodeClientMessage('{', vocabulary))).toMatchObject({
      code: 'MALFORMED_JSON',
      path: '$',
    });

    const { expectedRevisions: _removed, ...missing } = masterDecision;
    expect(refuse(decodeClientMessage(JSON.stringify(missing), vocabulary))).toMatchObject({
      code: 'INVALID_SHAPE',
      path: '$.expectedRevisions',
    });

    const extended = { ...masterDecision, staleField: true };
    expect(refuse(decodeClientMessage(JSON.stringify(extended), vocabulary))).toEqual({
      code: 'UNRECOGNIZED',
      path: '$.staleField',
      value: true,
    });
    expect(encodeClientMessage(extended, vocabulary)).toEqual({
      ok: false,
      refusal: { code: 'UNRECOGNIZED', path: '$.staleField', value: true },
    });

    const prototypeKey = JSON.stringify(masterDecision).replace(
      /\}$/u,
      ',"staleField":{"__proto__":{"polluted":true}}}',
    );
    const prototypeRefusal = refuse(decodeClientMessage(prototypeKey, vocabulary));
    expect(prototypeRefusal).toMatchObject({ code: 'UNRECOGNIZED', path: '$.staleField' });
    if (
      prototypeRefusal.code !== 'UNRECOGNIZED' ||
      typeof prototypeRefusal.value !== 'object' ||
      prototypeRefusal.value === null
    )
      throw new Error('expected the exact unrecognized object');
    expect(Object.keys(prototypeRefusal.value)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(prototypeRefusal.value)).toBeNull();
  });

  it('rejects values that JSON.stringify would silently change', () => {
    const disguised = { ...masterDecision };
    const roles = ['gm', 'system'];
    Object.defineProperty(disguised, 'role', { enumerable: true, get: () => roles.shift() });
    expect(encodeClientMessage(disguised, vocabulary)).toEqual({
      ok: true,
      text: JSON.stringify(masterDecision),
    });

    const invalid = {
      ...masterDecision,
      payload: { ...masterDecision.payload, masterAuthorityRevision: Number.NaN },
    };
    expect(encodeClientMessage(invalid, vocabulary)).toMatchObject({
      ok: false,
      refusal: {
        code: 'INVALID_SHAPE',
        path: '$.payload.masterAuthorityRevision',
      },
    });

    const sparse: null[] = [];
    sparse.length = 1;
    const sparsePayload = {
      ...masterDecision,
      payload: { ...masterDecision.payload, returnContext: { sparse } },
    };
    expect(encodeClientMessage(sparsePayload, vocabulary)).toMatchObject({
      ok: false,
      refusal: { code: 'INVALID_SHAPE', path: '$.payload.returnContext.sparse[0]' },
    });
  });
});
