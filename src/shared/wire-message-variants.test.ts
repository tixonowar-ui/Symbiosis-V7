import { FORM_IDS } from '@generated/types/atlas.js';
import { describe, expect, it } from 'vitest';

import {
  decodeClientMessage,
  decodeHostMessage,
  encodeClientMessage,
  encodeHostMessage,
} from './wire-codec.js';
import { MASTER_PREDICATE_RESPONSE_COMMAND_ID, WIRE_PROTOCOL_VERSION } from './wire-protocol.js';
import type {
  ClientToHostMessage,
  CommandPendingMessage,
  CommandRefusal,
  CommandRefusalMessage,
  CommandReplayMessage,
  CommandResultMessage,
  HostToClientMessage,
  MasterPredicateDecisionMessage,
  MasterPredicateRequestMessage,
  OperationCommandRequestMessage,
  ProjectionReconnectMessage,
  ProjectionSnapshotMessage,
  ProtocolRefusalMessage,
  ProtocolVocabulary,
  ReadRefusalMessage,
  ReadRequestMessage,
  ReadResultMessage,
  RevisionVector,
  WorkflowCommandId,
  WorkflowCommandRequestMessage,
} from './wire-protocol.js';

const workflowIds = new Set<string>([
  'UI-CMD-CAMPAIGN-CREATE',
  'UI-CMD-CONNECTION-OPEN',
  MASTER_PREDICATE_RESPONSE_COMMAND_ID,
]);
const formIds = new Set<string>(FORM_IDS);
const hostTransitions = new Set([
  'CMB-010|local-or-read-command|CMB-010|Повторить preflight',
  'CMP-012|read-only-command|CMP-012|Открыть архив read-only',
  'PLY-021|operation-command|PLY-021|Взять допустимое количество',
]);
const vocabulary: ProtocolVocabulary = {
  isFormId: (value): value is (typeof FORM_IDS)[number] => formIds.has(value),
  isHostTransition: (value) =>
    hostTransitions.has(`${value.from}|${value.kind}|${value.to}|${value.trigger}`),
  isWorkflowCommandId: (value): value is WorkflowCommandId => workflowIds.has(value),
};

const revisions = {
  actorVisibilityRevision: 3,
  projectionRevision: 7,
  stateRevision: 5,
} as const satisfies RevisionVector;
const freshRevisions = { ...revisions, projectionRevision: 8, stateRevision: 6 } as const;
const opaqueReturnContext = {
  continuation: { marker: 7, values: [true, null] },
  opaqueToken: 'server-issued-return-1',
} as const;

const regularWorkflow = {
  commandId: 'campaign-create-1',
  commandKind: 'workflow-command',
  expectedRevisions: revisions,
  messageType: 'command.request',
  payload: { campaignName: 'North Reach' },
  protocolVersion: WIRE_PROTOCOL_VERSION,
  role: 'gm',
  workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
} as const satisfies WorkflowCommandRequestMessage;

const masterDecision = {
  commandId: 'predicate-response-1',
  commandKind: 'workflow-command',
  expectedRevisions: revisions,
  messageType: 'command.request',
  payload: {
    decision: 'NO',
    linkedActionRequestId: 'linked-action-1',
    masterAuthorityRevision: 2,
    noReservation: true,
    predicateRequestId: 'predicate-1',
    returnContext: opaqueReturnContext,
  },
  protocolVersion: WIRE_PROTOCOL_VERSION,
  role: 'gm',
  workflowCommandId: MASTER_PREDICATE_RESPONSE_COMMAND_ID,
} as const satisfies MasterPredicateDecisionMessage;

const operation = {
  commandId: 'loot-take-1',
  commandKind: 'operation-command',
  expectedRevisions: revisions,
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

const readOnly = {
  commandKind: 'read-only-command',
  knownRevisions: revisions,
  messageType: 'read.request',
  parameters: { archiveId: 'archive-1' },
  protocolVersion: WIRE_PROTOCOL_VERSION,
  requestId: 'read-only-1',
  role: 'gm',
  transition: {
    from: 'CMP-012',
    kind: 'read-only-command',
    to: 'CMP-012',
    trigger: 'Открыть архив read-only',
  },
} as const satisfies ReadRequestMessage;

const localOrRead = {
  commandKind: 'local-or-read-command',
  knownRevisions: revisions,
  messageType: 'read.request',
  parameters: { actorId: 'actor-1' },
  protocolVersion: WIRE_PROTOCOL_VERSION,
  requestId: 'preflight-1',
  role: 'player',
  transition: {
    from: 'CMB-010',
    kind: 'local-or-read-command',
    to: 'CMB-010',
    trigger: 'Повторить preflight',
  },
} as const satisfies ReadRequestMessage;

const reconnect = {
  knownRevisions: revisions,
  messageType: 'projection.reconnect',
  projectionRole: 'gm',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  requestId: 'reconnect-pending-1',
  supportedWorkflowCommandIds: [MASTER_PREDICATE_RESPONSE_COMMAND_ID],
  unacknowledgedCommandIds: ['originating-command-1'],
} as const satisfies ProjectionReconnectMessage;

const malformedProtocolRefusal = {
  messageType: 'protocol.refusal',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  refusal: { code: 'MALFORMED_JSON', detail: 'invalid JSON frame', path: '$' },
  relatedCommandId: null,
} as const satisfies ProtocolRefusalMessage;
const invalidShapeProtocolRefusal = {
  messageType: 'protocol.refusal',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  refusal: { actualType: 'null', code: 'INVALID_SHAPE', expected: 'object', path: '$.payload' },
  relatedCommandId: 'command-1',
} as const satisfies ProtocolRefusalMessage;
const unrecognizedProtocolRefusal = {
  messageType: 'protocol.refusal',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  refusal: { code: 'UNRECOGNIZED', path: '$.messageType', value: 'future.message' },
  relatedCommandId: 'command-2',
} as const satisfies ProtocolRefusalMessage;

const receipt = {
  commandId: regularWorkflow.commandId,
  receiptId: 'receipt-1',
  result: { campaignId: 'campaign-1', randomResult: 17 },
  revisions: freshRevisions,
} as const;
const commandResult = {
  lifecycleState: 'COMMITTED',
  messageType: 'command.result',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  receipt,
} as const satisfies CommandResultMessage;
const commandReplay = {
  lifecycleState: 'IDEMPOTENT_REPLAY',
  messageType: 'command.replay',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  receipt,
} as const satisfies CommandReplayMessage;
const commandPending = {
  commandId: 'originating-command-1',
  lifecycleState: 'PENDING_CONSENT',
  messageType: 'command.pending',
  noReservation: true,
  predicateRequestId: 'predicate-1',
  predicateState: 'PENDING_PREDICATE',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  revisions: freshRevisions,
} as const satisfies CommandPendingMessage;
const masterRequest = {
  audience: 'gm',
  commandState: 'PENDING_CONSENT',
  guardState: 'consent/masterPredicate',
  linkedActionRequestId: 'linked-action-1',
  masterAuthorityRevision: 2,
  messageType: 'master-predicate.request',
  noReservation: true,
  predicateQuestion: 'Is the target behind green plants?',
  predicateRequestId: 'predicate-1',
  predicateState: 'PENDING_PREDICATE',
  predicateType: 'WORLD_FACT',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  requestingCharacterId: 'character-1',
  returnContext: opaqueReturnContext,
  revisions: freshRevisions,
} as const satisfies MasterPredicateRequestMessage;
const snapshot = {
  executableWorkflowCommandIds: ['UI-CMD-CONNECTION-OPEN'],
  messageType: 'projection.snapshot',
  projection: { allowedActions: ['UI-CMD-CONNECTION-OPEN'] },
  projectionRole: 'gm',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  requestId: reconnect.requestId,
  revisions: freshRevisions,
} as const satisfies ProjectionSnapshotMessage;
const readResult = {
  messageType: 'read.result',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  requestId: readOnly.requestId,
  result: { entries: 3 },
  revisions: freshRevisions,
} as const satisfies ReadResultMessage;
const invalidShapeReadRefusal = {
  messageType: 'read.refusal',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  refusal: { actualType: 'null', code: 'INVALID_SHAPE', expected: 'object', path: '$.parameters' },
  requestId: readOnly.requestId,
  revisions: freshRevisions,
} as const satisfies ReadRefusalMessage;
const unrecognizedReadRefusal = {
  messageType: 'read.refusal',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  refusal: { code: 'UNRECOGNIZED', path: '$.transition', value: 'future-transition' },
  requestId: localOrRead.requestId,
  revisions: freshRevisions,
} as const satisfies ReadRefusalMessage;

const refusalMessage = (
  commandId: string,
  lastLifecycleState: CommandRefusalMessage['lastLifecycleState'],
  refusal: CommandRefusal,
): CommandRefusalMessage => ({
  commandId,
  lastLifecycleState,
  messageType: 'command.refusal',
  protocolVersion: WIRE_PROTOCOL_VERSION,
  refusal,
  revisions: freshRevisions,
});
const invalidShapeCommandRefusal = refusalMessage('refusal-1', null, {
  actualType: 'null',
  code: 'INVALID_SHAPE',
  expected: 'object',
  path: '$.payload',
});
const unrecognizedCommandRefusal = refusalMessage('refusal-2', 'DECLARED', {
  code: 'UNRECOGNIZED',
  path: '$.workflowCommandId',
  value: 'future-command',
});
const guardCommandRefusal = refusalMessage('refusal-3', 'PENDING_CONSENT', {
  code: 'GUARD_REJECTED',
});
const idempotencyCommandRefusal = refusalMessage('refusal-4', 'REVALIDATING', {
  code: 'IDEMPOTENCY_CONFLICT',
  commandId: regularWorkflow.commandId,
  detail: 'PAYLOAD_MISMATCH',
});
const predicateCommandRefusal = refusalMessage('refusal-5', 'REJECTED_STALE', {
  code: 'MASTER_PREDICATE_DENIED',
  linkedActionRequestId: 'linked-action-1',
  noReservation: true,
  predicateRequestId: 'predicate-1',
  predicateState: 'NO_RECORDED',
});
const staleCommandRefusal = refusalMessage('refusal-6', 'REJECTED_STALE', {
  actual: freshRevisions,
  code: 'STALE_REVISION',
  expected: revisions,
});

const roundTripClient = (message: ClientToHostMessage): void => {
  const encoded = encodeClientMessage(message, vocabulary);
  expect(encoded.ok).toBe(true);
  if (!encoded.ok) throw new Error(`unexpected encode refusal: ${encoded.refusal.code}`);
  expect(decodeClientMessage(encoded.text, vocabulary)).toEqual({ ok: true, value: message });
};

const roundTripHost = (message: HostToClientMessage): void => {
  const encoded = encodeHostMessage(message, vocabulary);
  expect(encoded.ok).toBe(true);
  if (!encoded.ok) throw new Error(`unexpected encode refusal: ${encoded.refusal.code}`);
  expect(decodeHostMessage(encoded.text, vocabulary)).toEqual({ ok: true, value: message });
};

describe('client-to-host message variants', () => {
  it('round-trips a regular workflow command request', () => roundTripClient(regularWorkflow));
  it('round-trips a master predicate decision request', () => roundTripClient(masterDecision));
  it('round-trips an operation command request', () => roundTripClient(operation));
  it('round-trips a read-only request', () => roundTripClient(readOnly));
  it('round-trips a local-or-read request', () => roundTripClient(localOrRead));
  it('round-trips a projection reconnect request', () => roundTripClient(reconnect));
  it('round-trips a malformed JSON protocol refusal', () =>
    roundTripClient(malformedProtocolRefusal));
  it('round-trips an invalid shape protocol refusal', () =>
    roundTripClient(invalidShapeProtocolRefusal));
  it('round-trips an unrecognized value protocol refusal', () =>
    roundTripClient(unrecognizedProtocolRefusal));
});

describe('host-to-client message variants', () => {
  it('round-trips a committed command result', () => roundTripHost(commandResult));
  it('round-trips an idempotent command replay', () => roundTripHost(commandReplay));
  it('round-trips a pending predicate command', () => roundTripHost(commandPending));
  it('round-trips an invalid shape command refusal', () =>
    roundTripHost(invalidShapeCommandRefusal));
  it('round-trips an unrecognized value command refusal', () =>
    roundTripHost(unrecognizedCommandRefusal));
  it('round-trips a guard command refusal', () => roundTripHost(guardCommandRefusal));
  it('round-trips an idempotency command refusal', () => roundTripHost(idempotencyCommandRefusal));
  it('round-trips a master predicate denial', () => roundTripHost(predicateCommandRefusal));
  it('round-trips a stale revision command refusal', () => roundTripHost(staleCommandRefusal));
  it('round-trips a master predicate request', () => roundTripHost(masterRequest));
  it('round-trips a replacement projection snapshot', () => roundTripHost(snapshot));
  it('round-trips a read result', () => roundTripHost(readResult));
  it('round-trips an invalid shape read refusal', () => roundTripHost(invalidShapeReadRefusal));
  it('round-trips an unrecognized value read refusal', () =>
    roundTripHost(unrecognizedReadRefusal));
  it('round-trips a malformed JSON protocol refusal', () =>
    roundTripHost(malformedProtocolRefusal));
  it('round-trips an invalid shape protocol refusal', () =>
    roundTripHost(invalidShapeProtocolRefusal));
  it('round-trips an unrecognized value protocol refusal', () =>
    roundTripHost(unrecognizedProtocolRefusal));
});

describe('handoff and reconnect', () => {
  it('preserves the opaque return context across predicate handoff', () => {
    roundTripHost(masterRequest);
    roundTripClient(masterDecision);
    expect(masterDecision.payload.returnContext).toEqual(masterRequest.returnContext);
  });

  it('represents reconnect of the same pending predicate request', () => {
    roundTripClient(reconnect);
    roundTripHost(commandPending);
    roundTripHost(masterRequest);
    expect(commandPending.commandId).toBe(reconnect.unacknowledgedCommandIds[0]);
    expect(commandPending.predicateRequestId).toBe(masterRequest.predicateRequestId);
    expect(masterRequest.returnContext).toEqual(opaqueReturnContext);
  });

  it('does not encode timeout as a predicate response', () => {
    const timeout = {
      ...masterDecision,
      payload: { ...masterDecision.payload, decision: null },
    } as unknown as ClientToHostMessage;
    expect(encodeClientMessage(timeout, vocabulary)).toMatchObject({
      ok: false,
      refusal: { actualType: 'null', code: 'INVALID_SHAPE', path: '$.payload.decision' },
    });
  });
});

describe('exotic JSON values', () => {
  it('rejects undefined before JSON.stringify can remove it', () => {
    const value = {
      ...regularWorkflow,
      payload: { missingAfterStringify: undefined },
    } as unknown as ClientToHostMessage;
    expect(encodeClientMessage(value, vocabulary)).toMatchObject({
      ok: false,
      refusal: {
        actualType: 'undefined',
        code: 'INVALID_SHAPE',
        expected: 'JSON value',
        path: '$.payload.missingAfterStringify',
      },
    });
  });

  it('rejects NaN before JSON.stringify can turn it into null', () => {
    const value = {
      ...regularWorkflow,
      payload: { notANumber: Number.NaN },
    } as unknown as ClientToHostMessage;
    expect(encodeClientMessage(value, vocabulary)).toMatchObject({
      ok: false,
      refusal: {
        actualType: 'number',
        code: 'INVALID_SHAPE',
        expected: 'JSON value',
        path: '$.payload.notANumber',
      },
    });
  });

  it('rejects a revision literal that loses safe-integer precision', () => {
    const text = JSON.stringify(regularWorkflow).replace(
      '"stateRevision":5',
      '"stateRevision":9007199254740993',
    );
    expect(decodeClientMessage(text, vocabulary)).toMatchObject({
      ok: false,
      refusal: {
        actualType: 'number',
        code: 'INVALID_SHAPE',
        expected: 'non-negative safe integer',
        path: '$.expectedRevisions.stateRevision',
      },
    });
  });

  it('rejects null in a revision vector', () => {
    const value = {
      ...regularWorkflow,
      expectedRevisions: { ...revisions, projectionRevision: null },
    };
    expect(decodeClientMessage(JSON.stringify(value), vocabulary)).toMatchObject({
      ok: false,
      refusal: {
        actualType: 'null',
        code: 'INVALID_SHAPE',
        expected: 'non-negative safe integer',
        path: '$.expectedRevisions.projectionRevision',
      },
    });
  });
});

describe('validation precedence', () => {
  it('validates workflow identity before command scalar fields', () => {
    const value = { ...regularWorkflow, commandId: 7, workflowCommandId: 'future-command' };
    expect(decodeClientMessage(JSON.stringify(value), vocabulary)).toEqual({
      ok: false,
      refusal: { code: 'UNRECOGNIZED', path: '$.workflowCommandId', value: 'future-command' },
    });
  });

  it('validates a read transition before revisions', () => {
    const value = {
      ...readOnly,
      knownRevisions: { ...revisions, stateRevision: null },
      transition: { ...readOnly.transition, trigger: 'future-transition' },
    };
    expect(decodeClientMessage(JSON.stringify(value), vocabulary)).toMatchObject({
      ok: false,
      refusal: { code: 'UNRECOGNIZED', path: '$.transition' },
    });
  });

  it('rejects a terminal refusal state before its command ID', () => {
    const value = {
      ...guardCommandRefusal,
      commandId: 7,
      lastLifecycleState: 'COMMITTED',
    };
    expect(decodeHostMessage(JSON.stringify(value), vocabulary)).toEqual({
      ok: false,
      refusal: { code: 'UNRECOGNIZED', path: '$.lastLifecycleState', value: 'COMMITTED' },
    });
  });

  it('validates executable IDs before projection contents', () => {
    const value = {
      ...snapshot,
      executableWorkflowCommandIds: ['future-command'],
      projection: null,
    };
    expect(decodeHostMessage(JSON.stringify(value), vocabulary)).toEqual({
      ok: false,
      refusal: {
        code: 'UNRECOGNIZED',
        path: '$.executableWorkflowCommandIds[0]',
        value: 'future-command',
      },
    });
  });

  it('rejects a malformed-json read refusal before request metadata', () => {
    const value = {
      ...invalidShapeReadRefusal,
      refusal: malformedProtocolRefusal.refusal,
      requestId: 7,
      revisions: null,
    };
    expect(decodeHostMessage(JSON.stringify(value), vocabulary)).toEqual({
      ok: false,
      refusal: { code: 'UNRECOGNIZED', path: '$.refusal.code', value: 'MALFORMED_JSON' },
    });
  });

  it('validates a protocol refusal before its related command ID', () => {
    const value = {
      ...malformedProtocolRefusal,
      refusal: { code: 'future-refusal' },
      relatedCommandId: 7,
    };
    expect(decodeHostMessage(JSON.stringify(value), vocabulary)).toEqual({
      ok: false,
      refusal: { code: 'UNRECOGNIZED', path: '$.refusal.code', value: 'future-refusal' },
    });
  });
});
