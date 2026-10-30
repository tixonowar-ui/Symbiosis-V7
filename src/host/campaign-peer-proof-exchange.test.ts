import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  allocateCampaignPeerNonce,
  campaignPeerPublicIdentity,
  generateDeviceInstallationIdentityMaterial,
  signCampaignPeerTranscript,
  verifyCampaignPeerTranscript,
  type CampaignPeerTranscript,
} from './campaign-peer-identity.js';
import {
  CampaignPeerProofExchangeError,
  createCampaignPeerProofExchange,
} from './campaign-peer-proof-exchange.js';

const HOST = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = '33333333-3333-4333-8333-333333333333';
const host = generateDeviceInstallationIdentityMaterial(HOST);
const device = generateDeviceInstallationIdentityMaterial(DEVICE);
const deviceIdentity = campaignPeerPublicIdentity(device);
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const challengeHash = digest('closed initial request');
type Exchange = ReturnType<typeof createCampaignPeerProofExchange>;

function exchange(deviceNonce = allocateCampaignPeerNonce()): Exchange {
  return createCampaignPeerProofExchange(
    host,
    CAMPAIGN,
    deviceIdentity,
    deviceNonce,
    challengeHash,
  );
}
function ready() {
  const instance = exchange();
  const initial = instance.challenge();
  const proof: CampaignPeerTranscript = { ...initial.transcript, purpose: 'DEVICE_PROOF' };
  instance.acceptDeviceProof(proof, signCampaignPeerTranscript(device, proof));
  return { instance, initial };
}
function request(initial: CampaignPeerTranscript, sequenceNumber = 1): CampaignPeerTranscript {
  return {
    ...initial,
    purpose: 'RPC_REQUEST',
    sequenceNumber,
    bodySha256: digest(`closed RPC ${String(sequenceNumber)}`),
  };
}
function refused(instance: Exchange, operation: () => unknown): void {
  try {
    operation();
    expect.fail('Expected proof-state refusal');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(CampaignPeerProofExchangeError);
    expect((error as CampaignPeerProofExchangeError).code).toBe('INVALID_EXCHANGE');
    expect((error as Error).message).toBe('campaign peer proof exchange: INVALID_EXCHANGE');
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain(host.privateKeyPkcs8Base64);
  }
  expect(instance.state).toBe('CLOSED');
}

describe('campaign peer proof exchange with real installation keys', () => {
  it('binds the challenge and device proof, consumes RPC slots and signs exactly one host response', () => {
    const instance = exchange();
    expect(instance.state).toBe('WAIT_DEVICE_PROOF');
    const initial = instance.challenge();
    expect(instance.challenge()).toBe(initial);
    expect(initial.transcript).toMatchObject({
      purpose: 'HOST_CHALLENGE',
      sequenceNumber: 0,
      hostDeviceId: HOST,
      deviceId: DEVICE,
      campaignId: CAMPAIGN,
      hostKeyFingerprintSha256: host.keyFingerprintSha256,
      deviceKeyFingerprintSha256: device.keyFingerprintSha256,
      bodySha256: challengeHash,
    });
    expect(
      verifyCampaignPeerTranscript(
        instance.publicIdentity,
        initial.transcript,
        initial.signatureBase64,
      ),
    ).toBe(true);
    const proof = { ...initial.transcript, purpose: 'DEVICE_PROOF' as const };
    instance.acceptDeviceProof(proof, signCampaignPeerTranscript(device, proof));
    expect(instance.state).toBe('READY');
    for (const sequence of [1, 2, 3]) {
      const rpc = request(initial.transcript, sequence);
      expect(
        instance.verifyRpcRequest(rpc, signCampaignPeerTranscript(device, rpc), rpc.bodySha256),
      ).toBe(sequence);
      expect(instance.state).toBe('AWAIT_RESPONSE');
      const responseHash = digest(`result ${String(sequence)}`);
      const response = instance.signRpcResponse(sequence, responseHash);
      expect(response.transcript).toEqual({
        ...rpc,
        purpose: 'RPC_RESPONSE',
        bodySha256: responseHash,
      });
      expect(
        verifyCampaignPeerTranscript(
          instance.publicIdentity,
          response.transcript,
          response.signatureBase64,
        ),
      ).toBe(true);
      expect(instance.state).toBe('READY');
    }
    instance.close();
    instance.close();
    expect(instance.state).toBe('CLOSED');
  });

  it('allocates a fresh host nonce for each exchange and rejects an old valid proof', () => {
    const deviceNonce = allocateCampaignPeerNonce();
    const old = exchange(deviceNonce).challenge();
    const current = exchange(deviceNonce);
    expect(current.challenge().transcript.hostNonceBase64).not.toBe(old.transcript.hostNonceBase64);
    const proof = { ...old.transcript, purpose: 'DEVICE_PROOF' as const };
    refused(current, () =>
      current.acceptDeviceProof(proof, signCampaignPeerTranscript(device, proof)),
    );
  });

  it.each([
    { campaignId: HOST },
    { hostDeviceId: DEVICE },
    { hostKeyFingerprintSha256: 'a'.repeat(64) },
    { deviceNonceBase64: allocateCampaignPeerNonce() },
    { hostNonceBase64: allocateCampaignPeerNonce() },
    { bodySha256: digest('attacker-selected challenge body') },
  ])('rejects a correctly signed proof with changed binding %#', (patch) => {
    const instance = exchange();
    const proof = {
      ...instance.challenge().transcript,
      purpose: 'DEVICE_PROOF' as const,
      ...patch,
    };
    refused(instance, () =>
      instance.acceptDeviceProof(proof, signCampaignPeerTranscript(device, proof)),
    );
  });

  it('rejects the same device ID signed with another real installation key', () => {
    const other = generateDeviceInstallationIdentityMaterial(DEVICE);
    const instance = exchange();
    const proof = {
      ...instance.challenge().transcript,
      purpose: 'DEVICE_PROOF' as const,
      deviceKeyFingerprintSha256: other.keyFingerprintSha256,
    };
    refused(instance, () =>
      instance.acceptDeviceProof(proof, signCampaignPeerTranscript(other, proof)),
    );
  });

  it('rejects reflection of the host challenge as device proof', () => {
    const instance = exchange();
    const initial = instance.challenge();
    refused(instance, () =>
      instance.acceptDeviceProof(initial.transcript, initial.signatureBase64),
    );
  });

  it('rejects a host key signing a device proof for a different device principal', () => {
    const instance = exchange();
    const proof = {
      ...instance.challenge().transcript,
      purpose: 'DEVICE_PROOF' as const,
      deviceId: HOST,
      deviceKeyFingerprintSha256: host.keyFingerprintSha256,
    };
    refused(instance, () =>
      instance.acceptDeviceProof(proof, signCampaignPeerTranscript(host, proof)),
    );
  });

  it('rejects an altered signature even when its Base64 encoding and transcript are valid', () => {
    const instance = exchange();
    const proof = { ...instance.challenge().transcript, purpose: 'DEVICE_PROOF' as const };
    const signature = Buffer.from(signCampaignPeerTranscript(device, proof), 'base64');
    signature[0] = signature[0]! ^ 1;
    refused(instance, () => instance.acceptDeviceProof(proof, signature.toString('base64')));
  });

  it('closes on duplicate device proof instead of resetting its RPC sequence', () => {
    const { instance, initial } = ready();
    const proof = { ...initial.transcript, purpose: 'DEVICE_PROOF' as const };
    refused(instance, () =>
      instance.acceptDeviceProof(proof, signCampaignPeerTranscript(device, proof)),
    );
  });

  it('requires completed device proof before accepting an RPC', () => {
    const instance = exchange();
    const rpc = request(instance.challenge().transcript);
    refused(instance, () =>
      instance.verifyRpcRequest(rpc, signCampaignPeerTranscript(device, rpc), rpc.bodySha256),
    );
  });

  it.each([
    { campaignId: HOST },
    { hostKeyFingerprintSha256: 'a'.repeat(64) },
    { hostNonceBase64: allocateCampaignPeerNonce() },
    { deviceNonceBase64: allocateCampaignPeerNonce() },
    { sequenceNumber: 2 },
    { bodySha256: digest('another body') },
  ])('rejects a valid RPC signature with changed binding or unexpected body %#', (patch) => {
    const { instance, initial } = ready();
    const expected = request(initial.transcript);
    const rpc = { ...expected, ...patch };
    refused(instance, () =>
      instance.verifyRpcRequest(rpc, signCampaignPeerTranscript(device, rpc), expected.bodySha256),
    );
  });

  it.each([null, 'not-a-sha256', 'A'.repeat(64), 123])(
    'rejects a malformed caller-computed body hash %#',
    (body) => {
      const { instance, initial } = ready();
      const rpc = request(initial.transcript);
      refused(instance, () =>
        instance.verifyRpcRequest(rpc, signCampaignPeerTranscript(device, rpc), body),
      );
    },
  );

  it('rejects a concurrent/repeated RPC before an outstanding executor response', () => {
    const { instance, initial } = ready();
    const rpc = request(initial.transcript);
    const signature = signCampaignPeerTranscript(device, rpc);
    expect(instance.verifyRpcRequest(rpc, signature, rpc.bodySha256)).toBe(1);
    refused(instance, () => instance.verifyRpcRequest(rpc, signature, rpc.bodySha256));
    refused(instance, () => instance.signRpcResponse(1, digest('late result')));
  });

  it('rejects an old request after a successful response instead of executing it twice', () => {
    const { instance, initial } = ready();
    const rpc = request(initial.transcript);
    const signature = signCampaignPeerTranscript(device, rpc);
    instance.verifyRpcRequest(rpc, signature, rpc.bodySha256);
    instance.signRpcResponse(1, digest('result'));
    refused(instance, () => instance.verifyRpcRequest(rpc, signature, rpc.bodySha256));
  });

  it('does not sign an unsolicited or duplicate host response', () => {
    const unused = ready().instance;
    refused(unused, () => unused.signRpcResponse(1, digest('unsolicited')));
    const { instance, initial } = ready();
    const rpc = request(initial.transcript);
    instance.verifyRpcRequest(rpc, signCampaignPeerTranscript(device, rpc), rpc.bodySha256);
    instance.signRpcResponse(1, digest('result'));
    refused(instance, () => instance.signRpcResponse(1, digest('second result')));
  });

  it('rejects a reflected signed host RPC response as the next device request', () => {
    const { instance, initial } = ready();
    const rpc = request(initial.transcript);
    instance.verifyRpcRequest(rpc, signCampaignPeerTranscript(device, rpc), rpc.bodySha256);
    const response = instance.signRpcResponse(1, digest('response'));
    refused(instance, () =>
      instance.verifyRpcRequest(
        response.transcript,
        response.signatureBase64,
        response.transcript.bodySha256,
      ),
    );
  });

  it.each([0, 2, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, '1'])(
    'rejects a mismatched response sequence %#',
    (sequence) => {
      const { instance, initial } = ready();
      const rpc = request(initial.transcript);
      instance.verifyRpcRequest(rpc, signCampaignPeerTranscript(device, rpc), rpc.bodySha256);
      refused(instance, () => instance.signRpcResponse(sequence, digest('result')));
    },
  );

  it.each([null, 'bad', 'A'.repeat(64)])('rejects invalid response-body encoding %#', (body) => {
    const { instance, initial } = ready();
    const rpc = request(initial.transcript);
    instance.verifyRpcRequest(rpc, signCampaignPeerTranscript(device, rpc), rpc.bodySha256);
    refused(instance, () => instance.signRpcResponse(1, body));
  });

  it.each(['bad', '', 'A'.repeat(88), ' '.repeat(88)])(
    'closes on malformed signature encoding %#',
    (signature) => {
      const instance = exchange();
      const proof = { ...instance.challenge().transcript, purpose: 'DEVICE_PROOF' as const };
      refused(instance, () => instance.acceptDeviceProof(proof, signature));
    },
  );

  it('rejects malformed, extra-key and accessor transcripts without executing getters', () => {
    for (const shape of [null, {}, { extra: host.privateKeyPkcs8Base64 }]) {
      const instance = exchange();
      refused(instance, () => instance.acceptDeviceProof(shape, 'invalid'));
    }
    const instance = exchange();
    let reads = 0;
    const proof = { ...instance.challenge().transcript, purpose: 'DEVICE_PROOF' as const };
    Object.defineProperty(proof, 'bodySha256', {
      enumerable: true,
      get: () => {
        reads++;
        return host.privateKeyPkcs8Base64;
      },
    });
    refused(instance, () => instance.acceptDeviceProof(proof, 'invalid'));
    expect(reads).toBe(0);
  });

  it('never exposes private material through enumerable properties, JSON or public snapshots', () => {
    const instance = exchange();
    const initial = instance.challenge();
    expect(Reflect.ownKeys(instance)).toEqual([]);
    expect(Object.keys(instance)).toEqual([]);
    expect(JSON.stringify(instance)).toBe('{}');
    expect(Object.isFrozen(instance)).toBe(true);
    expect(Object.isFrozen(instance.publicIdentity)).toBe(true);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.transcript)).toBe(true);
    expect(JSON.stringify({ publicIdentity: instance.publicIdentity, initial })).not.toContain(
      host.privateKeyPkcs8Base64,
    );
    expect(instance.publicIdentity).not.toHaveProperty('privateKeyPkcs8Base64');
    instance.close();
    refused(instance, () => instance.challenge());
  });

  it('rejects invalid factory material/IDs/nonces/hash with only the fixed error', () => {
    const values = [
      [
        { ...host, privateKeyPkcs8Base64: 'PRIVATE_MARKER' },
        CAMPAIGN,
        deviceIdentity,
        allocateCampaignPeerNonce(),
        challengeHash,
      ],
      [host, 'invalid-campaign', deviceIdentity, allocateCampaignPeerNonce(), challengeHash],
      [
        host,
        CAMPAIGN,
        { ...deviceIdentity, secret: 'PRIVATE_MARKER' },
        allocateCampaignPeerNonce(),
        challengeHash,
      ],
      [host, CAMPAIGN, deviceIdentity, 'PRIVATE_MARKER', challengeHash],
      [host, CAMPAIGN, deviceIdentity, allocateCampaignPeerNonce(), 'PRIVATE_MARKER'],
    ];
    for (const args of values) {
      try {
        Reflect.apply(createCampaignPeerProofExchange, undefined, args);
        expect.fail('Invalid factory input must be refused');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(CampaignPeerProofExchangeError);
        expect((error as Error).message).toBe('campaign peer proof exchange: INVALID_EXCHANGE');
        expect(error).not.toHaveProperty('cause');
        expect(String(error)).not.toContain('PRIVATE_MARKER');
      }
    }
  });
});
