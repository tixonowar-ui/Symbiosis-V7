import { isDeepStrictEqual } from 'node:util';
import type { DeviceInstallationIdentityMaterial } from '../persistence/network-installation-identity.js';
import {
  allocateCampaignPeerNonce,
  campaignPeerPublicIdentity,
  signCampaignPeerTranscript,
  validateCampaignPeerPublicIdentity,
  validateCampaignPeerTranscript,
  validateDeviceInstallationIdentityMaterial,
  verifyCampaignPeerTranscript,
  type CampaignPeerPublicIdentity,
  type CampaignPeerTranscript,
} from './campaign-peer-identity.js';

export type CampaignPeerProofExchangeState =
  'WAIT_DEVICE_PROOF' | 'READY' | 'AWAIT_RESPONSE' | 'CLOSED';
export interface SignedCampaignPeerTranscript {
  readonly transcript: CampaignPeerTranscript;
  readonly signatureBase64: string;
}
export class CampaignPeerProofExchangeError extends Error {
  readonly code = 'INVALID_EXCHANGE';
  constructor() {
    super('campaign peer proof exchange: INVALID_EXCHANGE');
  }
}

/** Transport possession/binding only; no GM grant, admission, key pin or payload authorization. */
class CampaignPeerProofExchange {
  #material: DeviceInstallationIdentityMaterial | null;
  readonly #publicIdentity: CampaignPeerPublicIdentity;
  readonly #deviceIdentity: CampaignPeerPublicIdentity;
  readonly #challenge: SignedCampaignPeerTranscript;
  #state: CampaignPeerProofExchangeState = 'WAIT_DEVICE_PROOF';
  #nextSequence = 1;
  #awaitingSequence: number | null = null;

  constructor(
    material: DeviceInstallationIdentityMaterial,
    deviceIdentity: CampaignPeerPublicIdentity,
    challenge: SignedCampaignPeerTranscript,
  ) {
    this.#material = material;
    this.#publicIdentity = campaignPeerPublicIdentity(material);
    this.#deviceIdentity = deviceIdentity;
    this.#challenge = challenge;
    Object.freeze(this);
  }
  get publicIdentity(): CampaignPeerPublicIdentity {
    return this.#publicIdentity;
  }
  get state(): CampaignPeerProofExchangeState {
    return this.#state;
  }
  #checked<T>(operation: () => T): T {
    try {
      return operation();
    } catch {
      this.close();
      // Never preserve a crypto/parser error, caller value or cause.
      throw new CampaignPeerProofExchangeError();
    }
  }
  #requireState(state: CampaignPeerProofExchangeState): void {
    if (this.#state !== state) throw new CampaignPeerProofExchangeError();
  }
  #expected(
    purpose: CampaignPeerTranscript['purpose'],
    sequenceNumber: unknown,
    bodySha256: unknown,
  ): CampaignPeerTranscript {
    return validateCampaignPeerTranscript({
      ...this.#challenge.transcript,
      purpose,
      sequenceNumber,
      bodySha256,
    });
  }
  #verify(value: unknown, signatureBase64: unknown, expected: CampaignPeerTranscript): void {
    const transcript = validateCampaignPeerTranscript(value);
    if (
      !isDeepStrictEqual(transcript, expected) ||
      typeof signatureBase64 !== 'string' ||
      !verifyCampaignPeerTranscript(this.#deviceIdentity, transcript, signatureBase64)
    )
      throw new CampaignPeerProofExchangeError();
  }
  challenge(): SignedCampaignPeerTranscript {
    return this.#checked(() => {
      this.#requireState('WAIT_DEVICE_PROOF');
      return this.#challenge;
    });
  }
  acceptDeviceProof(transcript: unknown, signatureBase64: unknown): void {
    this.#checked(() => {
      this.#requireState('WAIT_DEVICE_PROOF');
      this.#verify(
        transcript,
        signatureBase64,
        this.#expected('DEVICE_PROOF', 0, this.#challenge.transcript.bodySha256),
      );
      this.#state = 'READY';
    });
  }
  verifyRpcRequest(
    transcript: unknown,
    signatureBase64: unknown,
    expectedBodySha256: unknown,
  ): number {
    return this.#checked(() => {
      this.#requireState('READY');
      this.#verify(
        transcript,
        signatureBase64,
        this.#expected('RPC_REQUEST', this.#nextSequence, expectedBodySha256),
      );
      // Consume before the caller executes anything; another frame cannot reuse this slot.
      this.#awaitingSequence = this.#nextSequence;
      this.#state = 'AWAIT_RESPONSE';
      return this.#awaitingSequence;
    });
  }
  signRpcResponse(sequence: unknown, bodySha256: unknown): SignedCampaignPeerTranscript {
    return this.#checked(() => {
      this.#requireState('AWAIT_RESPONSE');
      if (sequence !== this.#awaitingSequence || this.#material === null)
        throw new CampaignPeerProofExchangeError();
      const transcript = this.#expected('RPC_RESPONSE', sequence, bodySha256);
      const response = Object.freeze({
        transcript,
        signatureBase64: signCampaignPeerTranscript(this.#material, transcript),
      });
      if (transcript.sequenceNumber === Number.MAX_SAFE_INTEGER) this.close();
      else {
        this.#nextSequence = transcript.sequenceNumber + 1;
        this.#awaitingSequence = null;
        this.#state = 'READY';
      }
      return response;
    });
  }
  close(): void {
    this.#state = 'CLOSED';
    this.#material = null;
    this.#awaitingSequence = null;
  }
}

export function createCampaignPeerProofExchange(
  hostMaterial: DeviceInstallationIdentityMaterial,
  campaignId: string,
  devicePublicIdentity: CampaignPeerPublicIdentity,
  deviceNonceBase64: string,
  challengeBodySha256: string,
): CampaignPeerProofExchange {
  try {
    const material = validateDeviceInstallationIdentityMaterial(hostMaterial);
    const host = campaignPeerPublicIdentity(material);
    const device = validateCampaignPeerPublicIdentity(devicePublicIdentity);
    const transcript = validateCampaignPeerTranscript({
      schemaVersion: 1,
      purpose: 'HOST_CHALLENGE',
      hostDeviceId: host.ownerDeviceId,
      hostKeyFingerprintSha256: host.keyFingerprintSha256,
      campaignId,
      deviceId: device.ownerDeviceId,
      deviceKeyFingerprintSha256: device.keyFingerprintSha256,
      deviceNonceBase64,
      hostNonceBase64: allocateCampaignPeerNonce(),
      sequenceNumber: 0,
      bodySha256: challengeBodySha256,
    });
    return new CampaignPeerProofExchange(
      material,
      device,
      Object.freeze({
        transcript,
        signatureBase64: signCampaignPeerTranscript(material, transcript),
      }),
    );
  } catch {
    throw new CampaignPeerProofExchangeError();
  }
}
