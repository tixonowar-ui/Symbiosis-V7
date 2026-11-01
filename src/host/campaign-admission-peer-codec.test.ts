import { describe, expect, it, vi } from 'vitest';
import {
  encodeAdmissionPeerCommand,
  decodeAdmissionPeerCommand,
  encodeAdmissionPeerResponse,
  decodeAdmissionPeerResponse,
  type AdmissionPeerCommand,
  type AdmissionPeerResponse,
  encodeAdmissionCapacityCommand,
  decodeAdmissionCapacityCommand,
  encodeAdmissionCapacityResponse,
  decodeAdmissionCapacityResponse,
  type AdmissionCapacityResponse,
} from './campaign-admission-peer-codec.js';
import { canonicalPostSaveJson, postSaveSha256 } from './local-character-export.js';
import { CAMPAIGN_PEER_CHANNEL_MAX_BYTES } from './campaign-peer-channel.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  schemaVersion: 1 as const,
  requestId: id(1),
  technicalSessionId: id(2),
  submitCommandId: 'submit-original',
};
const limits = { maxPublicationBytes: 1024, maxChunkBytes: 3 };
const capacity: AdmissionCapacityResponse = {
  schemaVersion: 1,
  operation: 'ADMISSION_CAPACITY_READ',
  technicalSessionId: id(2),
  outcome: 'CAPACITY',
  campaign: {
    campaignId: id(3),
    title: 'Кампания',
    status: 'PAUSED',
    activePlayerCapacity: 3,
    activePcCount: 0,
    baselineVersion: 'sha256:' + 'b'.repeat(64),
    checkpointSha256: 'c'.repeat(64),
    revisions: { stateRevision: 2, projectionRevision: 2, actorVisibilityRevision: 2 },
  },
  occupiedCampaignPlaceCount: 1,
  alreadyImportedSourceUuids: ['legacy-source-id'],
};
describe('fresh authenticated admission capacity codec', () => {
  it('needs a confirmed session without requiring a not-yet-submitted request', () => {
    const command = {
      schemaVersion: 1 as const,
      operation: 'ADMISSION_CAPACITY_READ' as const,
      technicalSessionId: id(2),
    };
    expect(decodeAdmissionCapacityCommand(encodeAdmissionCapacityCommand(command))).toEqual(
      command,
    );
    expect(decodeAdmissionCapacityResponse(encodeAdmissionCapacityResponse(capacity))).toEqual(
      capacity,
    );
    expect(
      decodeAdmissionCapacityCommand(
        canonicalPostSaveJson({ ...scope, operation: 'ADMISSION_PUBLICATION_BEGIN' }),
      ),
    ).toBeNull();
  });
  it.each([
    { ...capacity, occupiedCampaignPlaceCount: 4 },
    { ...capacity, campaign: { ...capacity.campaign, activePcCount: 2 } },
    { ...capacity, alreadyImportedSourceUuids: ['same', 'same'] },
    { ...capacity, releasedRequestIds: [id(7)] },
  ])('refuses invalid capacity or extra private authority fields', (value) => {
    expect(() => decodeAdmissionCapacityResponse(canonicalPostSaveJson(value))).toThrow();
  });
});
const decision = {
  commandId: 'player-decision',
  decision: 'DECLINE' as const,
  campaignId: id(3),
  admissionBatchId: id(4),
  proposalRevision: 1,
  proposalChecksum: 'a'.repeat(64),
  expectedCampaignRevision: 2,
  controllerPreparationOrNull: null,
};
const commands: AdmissionPeerCommand[] = [
  { ...scope, operation: 'ADMISSION_PUBLICATION_BEGIN' },
  {
    ...scope,
    operation: 'ADMISSION_PUBLICATION_CHUNK',
    transferId: id(5),
    publicationChecksum: 'b'.repeat(64),
    chunkIndex: 0,
  },
  { ...scope, operation: 'ADMISSION_PLAYER_DECIDE', decision },
  {
    ...scope,
    operation: 'ADMISSION_PLAYER_RECOVER',
    commandId: decision.commandId,
    admissionBatchId: decision.admissionBatchId,
    semanticBodySha256: postSaveSha256(canonicalPostSaveJson(decision)),
  },
];
const responses: AdmissionPeerResponse[] = [
  { ...scope, operation: 'ADMISSION_PUBLICATION_BEGIN', outcome: 'NOT_READY' },
  {
    ...scope,
    operation: 'ADMISSION_PUBLICATION_BEGIN',
    outcome: 'MANIFEST',
    transferId: id(5),
    publicationChecksum: 'b'.repeat(64),
    bodySha256: 'c'.repeat(64),
    byteLength: 8,
    chunkBytes: 3,
    chunkCount: 3,
    campaignRevision: 2,
  },
  {
    ...scope,
    operation: 'ADMISSION_PUBLICATION_CHUNK',
    outcome: 'CHUNK',
    transferId: id(5),
    publicationChecksum: 'b'.repeat(64),
    chunkIndex: 0,
    bytesBase64: 'AQID',
  },
  // This codec preserves bounded canonical receipt bytes; full publication binding is tested at the owner store.
  {
    ...scope,
    operation: 'ADMISSION_PLAYER_DECIDE',
    outcome: 'DECIDED',
    receiptCanonicalJson: '{}',
    receiptSha256: postSaveSha256('{}'),
  },
  {
    ...scope,
    operation: 'ADMISSION_PLAYER_RECOVER',
    outcome: 'NOT_APPLIED',
    proof: {
      operation: 'ADMISSION_PLAYER_DECISION_ABSENT',
      requestId: scope.requestId,
      technicalSessionId: scope.technicalSessionId,
      submitCommandId: scope.submitCommandId,
      commandId: decision.commandId,
      campaignId: decision.campaignId,
      admissionBatchId: decision.admissionBatchId,
      semanticBodySha256: postSaveSha256(canonicalPostSaveJson(decision)),
      campaignRevision: 2,
      fenced: true,
      generation: 1,
      code: 'NOT_APPLIED',
    },
  },
  { ...scope, operation: 'ADMISSION_PLAYER_DECIDE', outcome: 'REFUSED', code: 'CAPACITY_EXCEEDED' },
];
describe('NET-027 bounded authenticated admission message syntax', () => {
  it.each(commands)('roundtrips the closed $operation command', (command) => {
    const encoded = encodeAdmissionPeerCommand(command);
    expect(encoded).toBe(canonicalPostSaveJson(command));
    expect(decodeAdmissionPeerCommand(encoded)).toEqual(command);
  });
  it.each(responses)(
    'roundtrips $operation / $outcome without exposing a GM authority object',
    (response) => {
      const encoded = encodeAdmissionPeerResponse(response, limits);
      expect(encoded).toBe(canonicalPostSaveJson(response));
      expect(decodeAdmissionPeerResponse(encoded, limits)).toEqual(response);
      expect(() =>
        decodeAdmissionPeerResponse(
          canonicalPostSaveJson({ ...response, authoritativeGmActorId: id(9) }),
          limits,
        ),
      ).toThrow();
    },
  );
  it('delegates legacy operations but refuses noncanonical, extended and oversized messages', () => {
    expect(
      decodeAdmissionPeerCommand(
        canonicalPostSaveJson({ schemaVersion: 1, operation: 'CONNECTION_OPEN' }),
      ),
    ).toBeNull();
    for (const value of [
      { ...commands[0], unknown: true },
      { ...commands[0], schemaVersion: 2 },
      { ...commands[2], decision: { ...decision, partialAccept: true } },
    ])
      expect(() => decodeAdmissionPeerCommand(canonicalPostSaveJson(value))).toThrow();
    expect(() =>
      decodeAdmissionPeerCommand(` ${encodeAdmissionPeerCommand(commands[0]!)}`),
    ).toThrow();
    expect(() =>
      decodeAdmissionPeerCommand(' '.repeat(CAMPAIGN_PEER_CHANNEL_MAX_BYTES + 1)),
    ).toThrow();
    expect(() =>
      encodeAdmissionPeerCommand({
        ...commands[0]!,
        submitCommandId: 'x'.repeat(CAMPAIGN_PEER_CHANNEL_MAX_BYTES),
      }),
    ).toThrow();
  });
  it('rejects all object and nested decision accessors without evaluating them', () => {
    const getter = vi.fn(() => 'ADMISSION_PUBLICATION_BEGIN');
    const outer = Object.defineProperty({}, 'operation', { enumerable: true, get: getter });
    expect(() => encodeAdmissionPeerCommand(outer as AdmissionPeerCommand)).toThrow();
    const nested = structuredClone(commands[2]!);
    if (nested.operation !== 'ADMISSION_PLAYER_DECIDE') throw new Error('wrong fixture');
    Object.defineProperty(nested.decision, 'expectedCampaignRevision', {
      enumerable: true,
      get: getter,
    });
    expect(() => encodeAdmissionPeerCommand(nested)).toThrow();
    const response = structuredClone(responses[3]!);
    Object.defineProperty(response, 'receiptCanonicalJson', { enumerable: true, get: getter });
    expect(() => encodeAdmissionPeerResponse(response, limits)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it('enforces the exact manifest arithmetic and actual chunk byte bounds', () => {
    const manifest = responses[1]!,
      chunk = responses[2]!;
    for (const patch of [
      { byteLength: 0 },
      { byteLength: 1025 },
      { chunkBytes: 4 },
      { chunkCount: 2 },
      { chunkCount: Number.MAX_SAFE_INTEGER },
      { bodySha256: 'bad' },
    ])
      expect(() =>
        decodeAdmissionPeerResponse(canonicalPostSaveJson({ ...manifest, ...patch }), limits),
      ).toThrow();
    for (const bytesBase64 of ['', 'AQI', 'AQIDBA==', 'AQID\n', '!!!!'])
      expect(() =>
        decodeAdmissionPeerResponse(canonicalPostSaveJson({ ...chunk, bytesBase64 }), limits),
      ).toThrow();
    expect(() =>
      decodeAdmissionPeerResponse(canonicalPostSaveJson(chunk), { ...limits, maxChunkBytes: 0 }),
    ).toThrow();
  });
  it('rejects receipt corruption before semantic owner ACK processing', () => {
    const receipt = responses[3]!;
    for (const patch of [
      { receiptSha256: 'f'.repeat(64) },
      { receiptCanonicalJson: '{ }' },
      { receiptCanonicalJson: '[]', receiptSha256: postSaveSha256('[]') },
    ])
      expect(() =>
        decodeAdmissionPeerResponse(canonicalPostSaveJson({ ...receipt, ...patch }), limits),
      ).toThrow();
  });
  it('preflights the complete RPC escaping before a bounded receipt can be committed', () => {
    const receiptCanonicalJson = canonicalPostSaveJson({ label: '"'.repeat(20_000) }),
      value: AdmissionPeerResponse = {
        ...scope,
        operation: 'ADMISSION_PLAYER_DECIDE',
        outcome: 'DECIDED',
        receiptCanonicalJson,
        receiptSha256: postSaveSha256(receiptCanonicalJson),
      },
      body = canonicalPostSaveJson(value);
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(CAMPAIGN_PEER_CHANNEL_MAX_BYTES);
    expect(Buffer.byteLength(canonicalPostSaveJson({ bodyJson: body }), 'utf8')).toBeGreaterThan(
      CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
    );
    expect(() =>
      encodeAdmissionPeerResponse(value, {
        ...limits,
        maxPublicationBytes: CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
      }),
    ).toThrow();
  });
  it('never converts an ordinary refusal or an unbound transport epoch into fenced absence', () => {
    const absence = responses[4]!;
    if (absence.outcome !== 'NOT_APPLIED') throw new Error('wrong fixture');
    for (const patch of [
      { requestId: id(9) },
      { technicalSessionId: id(9) },
      { submitCommandId: 'other' },
      { generation: 0 },
      { fenced: false },
      { code: 'UNAVAILABLE' },
    ])
      expect(() =>
        decodeAdmissionPeerResponse(
          canonicalPostSaveJson({ ...absence, proof: { ...absence.proof, ...patch } }),
          limits,
        ),
      ).toThrow();
    expect(
      decodeAdmissionPeerResponse(encodeAdmissionPeerResponse(responses[5]!, limits), limits)
        .outcome,
    ).toBe('REFUSED');
  });
});
