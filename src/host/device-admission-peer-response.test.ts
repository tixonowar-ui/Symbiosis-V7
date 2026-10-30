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
