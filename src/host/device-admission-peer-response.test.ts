import { describe, expect, it, vi } from 'vitest';
import { canonicalPostSaveJson, postSaveSha256 } from './local-character-export.js';
import { CAMPAIGN_PEER_CHANNEL_MAX_BYTES } from './campaign-peer-channel.js';
import {
  encodeDeviceAdmissionPeerResponse,
  decodeDeviceAdmissionPeerResponse,
  deviceAdmissionSubmitSemanticBody,
  DeviceAdmissionPeerResponseError,
  type PeerSessionHeader,
  type PeerRequestHeader,
  type DeviceAdmissionPeerReceipt,
  type DeviceAdmissionPeerResponse,
} from './device-admission-peer-response.js';

const CAMPAIGN = '11111111-1111-4111-8111-111111111111',
  SESSION = '22222222-2222-4222-8222-222222222222',
  REQUEST = '33333333-3333-4333-8333-333333333333',
  TRANSFER = '44444444-4444-4444-8444-444444444444';
const session: PeerSessionHeader = {
  technicalSessionId: SESSION,
  attemptId: 'opaque-attempt',
  campaignProof: {
    campaignId: CAMPAIGN,
    checkpointSha256: 'a'.repeat(64),
    revisions: { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 },
  },
  connectionRevision: 0,
  receiptId: 'opaque-open-receipt',
};
const request: PeerRequestHeader = {
  requestId: REQUEST,
  technicalSessionId: SESSION,
  submitCommandId: 'submit-command',
  submitReceiptId: 'submit-receipt',
  requestRevision: 0,
  status: 'PENDING',
  batchSha256: 'b'.repeat(64),
  closureOrNull: null,
};
const cancelled: PeerRequestHeader = {
  ...request,
  requestRevision: 1,
  closureOrNull: {
    commandId: 'cancel-command',
    receiptId: 'cancel-receipt',
    reason: '  Own reason\r\nwith\ttab🙂  ',
  },
};
const open: DeviceAdmissionPeerReceipt = {
  operation: 'OPEN',
  commandId: 'open-command',
  receiptId: session.receiptId,
  semanticBodySha256: 'c'.repeat(64),
  session,
};
const submit: DeviceAdmissionPeerReceipt = {
  operation: 'SUBMIT',
  commandId: request.submitCommandId,
  receiptId: request.submitReceiptId,
  semanticBodySha256: 'd'.repeat(64),
  request,
};
const cancel: DeviceAdmissionPeerReceipt = {
  operation: 'CANCEL',
  commandId: 'cancel-command',
  receiptId: 'cancel-receipt',
  semanticBodySha256: 'e'.repeat(64),
  request: cancelled,
};
const ack: DeviceAdmissionPeerResponse = {
  schemaVersion: 1,
  operation: 'DEVICE_REQUEST_COMMIT',
  outcome: 'ACK',
  delivery: 'COMMITTED',
  receipt: submit,
  current: { kind: 'REQUEST', request },
};
const examples: readonly DeviceAdmissionPeerResponse[] = [
  {
    schemaVersion: 1,
    operation: 'CONNECTION_OPEN',
    outcome: 'ACK',
    delivery: 'COMMITTED',
    receipt: open,
    current: { kind: 'SESSION', session },
  },
  {
    schemaVersion: 1,
    operation: 'CONNECTION_RECOVER',
    outcome: 'ACK',
    delivery: 'RECOVERED',
    receipt: open,
    current: { kind: 'SESSION', session },
  },
  {
    schemaVersion: 1,
    operation: 'CONNECTION_RECOVER',
    outcome: 'NOT_FOUND',
    commandId: 'old-open',
    attemptId: 'old-attempt',
    semanticBodySha256: 'a'.repeat(64),
    fenced: true,
    generation: 1,
  },
  {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_RECOVER',
    outcome: 'NOT_FOUND',
    requestId: REQUEST,
    technicalSessionId: SESSION,
    submitCommandId: 'old-submit',
    fenced: true,
    generation: 2,
  },
  ack,
  {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_BEGIN',
    outcome: 'ACK',
    delivery: 'REPLAY',
    receipt: submit,
    current: { kind: 'REQUEST', request: cancelled },
  },
  {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_RECOVER',
    outcome: 'ACK',
    delivery: 'RECOVERED',
    receipt: submit,
    current: { kind: 'REQUEST', request: cancelled },
  },
  {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_CANCEL',
    outcome: 'ACK',
    delivery: 'COMMITTED',
    receipt: cancel,
    current: { kind: 'REQUEST', request: cancelled },
  },
  {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_BEGIN',
    outcome: 'TRANSFER_READY',
    transferId: TRANSFER,
    nextChunkIndex: 0,
    receivedBytes: 0,
  },
  {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_CHUNK',
    outcome: 'CHUNK_ACCEPTED',
    transferId: TRANSFER,
    chunkIndex: 2,
    nextChunkIndex: 3,
    receivedBytes: 1024,
  },
  {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_COMMIT',
    outcome: 'REFUSED',
    code: 'INVALID_CANDIDATE',
  },
];
function encode(value: unknown) {
  return encodeDeviceAdmissionPeerResponse(value as DeviceAdmissionPeerResponse);
}
function invalid(value: unknown) {
  expect(() => encode(value)).toThrow(DeviceAdmissionPeerResponseError);
  expect(() => decodeDeviceAdmissionPeerResponse(canonicalPostSaveJson(value))).toThrow(
    DeviceAdmissionPeerResponseError,
  );
}
describe('short private admission response codec', () => {
  it.each(examples.map((value, index) => [index, value] as const))(
    'round trips closed response %s without private batch or witness',
    (_index, value) => {
      const text = encode(value),
        decoded = decodeDeviceAdmissionPeerResponse(text);
      expect(decoded).toEqual(value);
      expect(text).toBe(canonicalPostSaveJson(value));
      expect(Object.isFrozen(decoded)).toBe(true);
      for (const privateKey of [
        'canonicalWitnessText',
        'exportDocument',
        'principal',
        'privateKey',
        'payloadJson',
      ])
        expect(text).not.toContain(privateKey);
    },
  );
  it('keeps immutable submit receipt separate from a later cancelled current request', () => {
    const value = examples[6]!;
    const decoded = decodeDeviceAdmissionPeerResponse(encode(value));
    if (
      decoded.outcome !== 'ACK' ||
      decoded.receipt.operation === 'OPEN' ||
      decoded.receipt.operation === 'BIND_LANE' ||
      decoded.current.kind !== 'REQUEST'
    )
      throw new Error('Expected request ACK');
    expect(decoded.receipt.request.closureOrNull).toBeNull();
    expect(decoded.current.request.closureOrNull).toEqual(cancelled.closureOrNull);
  });
  it.each(['fenced', 'generation', 'commandId', 'attemptId', 'semanticBodySha256'])(
    'requires exact fenced-absence correlation %s',
    (field) => {
      const value = { ...examples[2] } as Record<string, unknown>;
      delete value[field];
      invalid(value);
    },
  );
  it.each([false, null, 0, 'true'])('refuses a non-proof fenced value %s', (fenced) =>
    invalid({ ...examples[2], fenced }),
  );
  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'refuses unsafe/zero generation %s',
    (generation) => invalid({ ...examples[2], generation }),
  );
  it.each(['requestId', 'technicalSessionId', 'submitCommandId'])(
    'requires request recovery correlation %s',
    (field) => {
      const value = { ...examples[3] } as Record<string, unknown>;
      delete value[field];
      invalid(value);
    },
  );
  it.each([
    'batch',
    'canonicalWitnessText',
    'ownerDeviceId',
    'role',
    'gmSecret',
    'PRIVATE_INPUT_KEY',
  ])('rejects private/authority field %s at every envelope boundary', (key) => {
    invalid({ ...ack, [key]: 'PRIVATE_DATA' });
    invalid({ ...ack, receipt: { ...submit, [key]: 'PRIVATE_DATA' } });
    invalid({
      ...ack,
      current: { kind: 'REQUEST', request: { ...request, [key]: 'PRIVATE_DATA' } },
    });
  });
  it('enforces operation/receipt/current pairings rather than accepting reflected acknowledgements', () => {
    invalid({ ...ack, operation: 'DEVICE_REQUEST_CANCEL' });
    invalid({ ...ack, operation: 'CONNECTION_OPEN' });
    invalid({ ...ack, operation: 'DEVICE_REQUEST_CHUNK' });
    invalid({ ...ack, current: { kind: 'REQUEST', request: { ...request, requestId: TRANSFER } } });
    invalid({
      ...ack,
      current: { kind: 'REQUEST', request: { ...request, batchSha256: '0'.repeat(64) } },
    });
    invalid({
      ...examples[0],
      current: { kind: 'SESSION', session: { ...session, attemptId: 'foreign' } },
    });
    invalid({ ...examples[7], current: { kind: 'REQUEST', request } });
    invalid({
      ...examples[7],
      receipt: { ...cancel, request: { ...cancelled, closureOrNull: null } },
    });
    invalid({ ...ack, delivery: 'RECOVERED' });
    invalid({ ...examples[1], delivery: 'COMMITTED' });
    invalid({ ...examples[5], delivery: 'COMMITTED' });
    invalid({ ...examples[2], operation: 'CONNECTION_OPEN' });
    invalid({ ...examples[8], operation: 'DEVICE_REQUEST_COMMIT' });
  });
  it('validates new executor IDs while preserving opaque attempt/command/receipt IDs', () => {
    invalid({ ...examples[8], transferId: 'opaque-transfer' });
    invalid({ ...examples[3], requestId: '33333333-3333-8333-8333-333333333333' });
    invalid({
      ...ack,
      receipt: { ...submit, request: { ...request, technicalSessionId: 'foreign' } },
    });
    expect(
      decodeDeviceAdmissionPeerResponse(
        encode({ ...examples[0], receipt: { ...open, commandId: 'legacy-v8-or-string' } }),
      ),
    ).toBeDefined();
  });
  it('rejects contradictory chunk progress and unexpected refusal codes', () => {
    invalid({ ...examples[9], nextChunkIndex: 2 });
    invalid({ ...examples[9], receivedBytes: 0 });
    invalid({
      ...examples[9],
      chunkIndex: Number.MAX_SAFE_INTEGER,
      nextChunkIndex: Number.MAX_SAFE_INTEGER,
    });
    invalid({ ...examples[10], code: 'PRIVATE_SQLITE_CAUSE' });
  });
  it('rejects noncanonical/duplicate/unknown/unsafe raw response frames and preserves fixed errors', () => {
    const text = encode(ack);
    for (const value of [
      null,
      {},
      [],
      true,
      'PRIVATE_JSON',
      'null',
      text + '\n',
      JSON.stringify(ack, null, 2),
      text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
      text.replace('"schemaVersion":1', '"schemaVersion":1.0'),
    ]) {
      try {
        decodeDeviceAdmissionPeerResponse(value);
        throw new Error('accepted');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(DeviceAdmissionPeerResponseError);
        expect((error as Error).cause).toBeUndefined();
        expect(JSON.stringify(error)).not.toContain('PRIVATE_JSON');
      }
    }
  });
  it('rejects accessors without executing input code and bounds duplicate receipt/current bytes at128KiB', () => {
    const getter = vi.fn(() => {
      throw new Error('PRIVATE_KEY');
    });
    const value = { ...ack };
    Object.defineProperty(value, 'receipt', { get: getter, enumerable: true });
    expect(() => encode(value)).toThrow(DeviceAdmissionPeerResponseError);
    expect(getter).not.toHaveBeenCalled();
    const huge = { ...session, attemptId: 'x'.repeat(CAMPAIGN_PEER_CHANNEL_MAX_BYTES) };
    expect(() =>
      encode({
        schemaVersion: 1,
        operation: 'CONNECTION_OPEN',
        outcome: 'ACK',
        delivery: 'COMMITTED',
        receipt: { ...open, session: huge },
        current: { kind: 'SESSION', session: huge },
      }),
    ).toThrow(DeviceAdmissionPeerResponseError);
    expect(() =>
      decodeDeviceAdmissionPeerResponse(' '.repeat(CAMPAIGN_PEER_CHANNEL_MAX_BYTES + 1)),
    ).toThrow(DeviceAdmissionPeerResponseError);
  });
  it('builds the separate SUBMIT semantic journal identity from command and full-batch self-hash only', () => {
    const body = deviceAdmissionSubmitSemanticBody('opaque-command', 'a'.repeat(64));
    expect(body).toBe(
      canonicalPostSaveJson({
        schemaVersion: 1,
        operation: 'DEVICE_REQUEST_SUBMIT',
        commandId: 'opaque-command',
        batchSha256: 'a'.repeat(64),
      }),
    );
    expect(postSaveSha256(body)).not.toBe('a'.repeat(64));
    expect(deviceAdmissionSubmitSemanticBody('other-command', 'a'.repeat(64))).not.toBe(body);
    expect(() => deviceAdmissionSubmitSemanticBody('', 'a'.repeat(64))).toThrow(
      DeviceAdmissionPeerResponseError,
    );
    expect(() => deviceAdmissionSubmitSemanticBody('command', 'A'.repeat(64))).toThrow(
      DeviceAdmissionPeerResponseError,
    );
  });
});

describe('request review proof and explicit lane receipt', () => {
  type MutableReviewValue = {
    current: {
      request: Record<string, unknown>;
      proof: {
        decisions: Record<string, unknown>[];
        laneProvenance: unknown;
        submittedReceipt: Record<string, unknown>;
        cancelledReceiptOrNull: unknown;
        [key: string]: unknown;
      };
    };
  };
  const OWNER = '55555555-5555-4555-8555-555555555555';
  const LANE = '66666666-6666-4666-8666-666666666666';
  const accepted = {
    receiptId: 'review-receipt',
    commandId: 'review-command',
    workflowCommandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
    campaignId: CAMPAIGN,
    requestId: REQUEST,
    requestOwnerDeviceId: OWNER,
    beforeRequestStatus: 'PENDING',
    afterRequestStatus: 'IN_REVIEW',
    beforeRequestRevision: 0,
    requestRevision: 1,
    decisionReasonOrNull: null,
    candidateSnapshotChecksums: ['1'.repeat(64)],
    authoritativeGmActorId: 'original-gm-profile',
    timestamp: '2026-10-30T00:00:00.000Z',
  } as const;
  const rejected = {
    ...accepted,
    receiptId: 'reject-receipt',
    commandId: 'reject-command',
    workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
    beforeRequestStatus: 'IN_REVIEW',
    afterRequestStatus: 'REJECTED',
    beforeRequestRevision: 1,
    requestRevision: 2,
    decisionReasonOrNull: '  Public reason\nunchanged e\u0301  ',
  } as const;
  const proof = {
    submittedReceipt: submit,
    cancelledReceiptOrNull: null,
    decisions: [accepted],
    laneProvenance: {
      kind: 'SUBMITTED_BATCH',
      batchSha256: request.batchSha256,
      localControllerSeatId: LANE,
    },
  };
  const reviewed = {
    ...ack,
    operation: 'DEVICE_REQUEST_RECOVER',
    delivery: 'RECOVERED',
    current: {
      kind: 'REQUEST_REVIEW',
      request: { ...request, status: 'IN_REVIEW', requestRevision: 1 },
      proof,
    },
  };
  const bindCommand = {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_BIND_LANE',
    commandId: 'bind-command',
    requestId: REQUEST,
    technicalSessionId: SESSION,
    submitCommandId: request.submitCommandId,
    batchSha256: request.batchSha256,
    localControllerSeatId: LANE,
  };
  const binding = {
    operation: 'BIND_LANE',
    commandId: 'bind-command',
    receiptId: 'bind-receipt',
    semanticBodySha256: postSaveSha256(canonicalPostSaveJson(bindCommand)),
    binding: {
      campaignId: CAMPAIGN,
      requestOwnerDeviceId: OWNER,
      requestId: REQUEST,
      technicalSessionId: SESSION,
      submitCommandId: request.submitCommandId,
      batchSha256: request.batchSha256,
      localControllerSeatId: LANE,
    },
  };
  it('keeps the original submit bytes while a complete accept/reject proof advances current', () => {
    for (const [decisions, status, revision] of [
      [[accepted], 'IN_REVIEW', 1],
      [[accepted, rejected], 'REJECTED', 2],
    ] as const) {
      const value = {
        ...reviewed,
        current: {
          ...reviewed.current,
          request: { ...request, status, requestRevision: revision },
          proof: { ...proof, decisions },
        },
      };
      const decoded = decodeDeviceAdmissionPeerResponse(encode(value));
      expect(decoded).toEqual(value);
      expect(canonicalPostSaveJson(decoded.outcome === 'ACK' ? decoded.receipt : null)).toBe(
        canonicalPostSaveJson(submit),
      );
    }
  });
  it('accepts an explicit legacy BIND without increasing requestRevision, including a later decision', () => {
    for (const decisions of [[], [accepted]]) {
      const value = {
        schemaVersion: 1,
        operation: 'DEVICE_REQUEST_BIND_LANE',
        outcome: 'ACK',
        delivery: 'REPLAY',
        receipt: binding,
        current: {
          kind: 'REQUEST_REVIEW',
          request: {
            ...request,
            status: decisions.length ? 'IN_REVIEW' : 'PENDING',
            requestRevision: decisions.length,
          },
          proof: { ...proof, decisions, laneProvenance: { kind: 'BIND_LANE', receipt: binding } },
        },
      };
      expect(decodeDeviceAdmissionPeerResponse(encode(value))).toEqual(value);
    }
  });
  it('retains a historical cancellation receipt with a derived CANCELLED header and no fake lane', () => {
    const value = {
      schemaVersion: 1,
      operation: 'DEVICE_REQUEST_CANCEL',
      outcome: 'ACK',
      delivery: 'REPLAY',
      receipt: cancel,
      current: {
        kind: 'REQUEST_REVIEW',
        request: { ...cancelled, status: 'CANCELLED' },
        proof: {
          submittedReceipt: submit,
          cancelledReceiptOrNull: cancel,
          decisions: [],
          laneProvenance: null,
        },
      },
    };
    expect(decodeDeviceAdmissionPeerResponse(encode(value))).toEqual(value);
  });
  it.each([
    [
      'unproven status',
      (v: MutableReviewValue) => {
        v.current.request.status = 'REJECTED';
      },
    ],
    [
      'skipped revision',
      (v: MutableReviewValue) => {
        v.current.proof.decisions[0]!.beforeRequestRevision = 1;
      },
    ],
    [
      'missing predecessor',
      (v: MutableReviewValue) => {
        v.current.proof.decisions = [rejected];
      },
    ],
    [
      'decision without lane',
      (v: MutableReviewValue) => {
        v.current.proof.laneProvenance = null;
      },
    ],
    [
      'unknown proof field',
      (v: MutableReviewValue) => {
        v.current.proof.campaignCopies = [];
      },
    ],
    [
      'unknown header field',
      (v: MutableReviewValue) => {
        v.current.request.controllerSeat = LANE;
      },
    ],
    [
      'wrong snapshot shape',
      (v: MutableReviewValue) => {
        v.current.proof.decisions[0]!.candidateSnapshotChecksums = [];
      },
    ],
    [
      'changed submit receipt',
      (v: MutableReviewValue) => {
        v.current.proof.submittedReceipt.receiptId = 'another';
      },
    ],
    [
      'cancellation and decision',
      (v: MutableReviewValue) => {
        v.current.proof.cancelledReceiptOrNull = cancel;
      },
    ],
  ] as const)('rejects %s without normalizing a proof', (_label, mutate) => {
    const value = structuredClone(reviewed);
    mutate(value);
    invalid(value);
  });
  it('rejects cross-owner decisions and changed ordered snapshot checksums', () => {
    for (const second of [
      { ...rejected, requestOwnerDeviceId: TRANSFER },
      { ...rejected, candidateSnapshotChecksums: ['2'.repeat(64)] },
    ])
      invalid({
        ...reviewed,
        current: {
          ...reviewed.current,
          request: { ...request, status: 'REJECTED', requestRevision: 2 },
          proof: { ...proof, decisions: [accepted, second] },
        },
      });
  });
  it('requires the exact BIND receipt in separately current proof', () => {
    const value = {
      schemaVersion: 1,
      operation: 'DEVICE_REQUEST_BIND_LANE',
      outcome: 'ACK',
      delivery: 'COMMITTED',
      receipt: binding,
      current: {
        kind: 'REQUEST_REVIEW',
        request,
        proof: {
          ...proof,
          decisions: [],
          laneProvenance: { kind: 'BIND_LANE', receipt: { ...binding, receiptId: 'changed' } },
        },
      },
    };
    invalid(value);
    invalid({ ...value, receipt: { ...binding, semanticBodySha256: '0'.repeat(64) } });
  });
  it('never invokes request or proof-array accessors during direct encode validation', () => {
    const requestGetter = vi.fn(() => REQUEST),
      arrayGetter = vi.fn(() => accepted);
    const a = structuredClone(reviewed),
      b = structuredClone(reviewed);
    Object.defineProperty(a.current.request, 'requestId', { get: requestGetter, enumerable: true });
    Object.defineProperty(b.current.proof.decisions, '0', { get: arrayGetter, enumerable: true });
    expect(() => encode(a)).toThrow(DeviceAdmissionPeerResponseError);
    expect(() => encode(b)).toThrow(DeviceAdmissionPeerResponseError);
    expect(requestGetter).not.toHaveBeenCalled();
    expect(arrayGetter).not.toHaveBeenCalled();
  });
});
