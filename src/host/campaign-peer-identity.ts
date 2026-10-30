import { Buffer } from 'node:buffer';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import type { DeviceInstallationIdentityMaterial } from '../persistence/network-installation-identity.js';

export interface CampaignPeerPublicIdentity {
  readonly schemaVersion: 1;
  readonly algorithm: 'ED25519';
  readonly ownerDeviceId: string;
  readonly publicKeySpkiBase64: string;
  readonly keyFingerprintSha256: string;
}

export interface CampaignPeerTranscript {
  readonly schemaVersion: 1;
  readonly purpose: 'HOST_CHALLENGE' | 'DEVICE_PROOF' | 'RPC_REQUEST' | 'RPC_RESPONSE';
  readonly hostDeviceId: string;
  readonly hostKeyFingerprintSha256: string;
  readonly campaignId: string;
  readonly deviceId: string;
  readonly deviceKeyFingerprintSha256: string;
  readonly deviceNonceBase64: string;
  readonly hostNonceBase64: string;
  readonly sequenceNumber: number;
  readonly bodySha256: string;
}

export type CampaignPeerIdentityErrorCode =
  | 'INVALID_OWNER'
  | 'INVALID_PUBLIC_IDENTITY'
  | 'INVALID_PRIVATE_IDENTITY'
  | 'KEY_GENERATION_FAILED'
  | 'NONCE_ALLOCATION_FAILED'
  | 'INVALID_TRANSCRIPT'
  | 'INVALID_SIGNATURE'
  | 'SIGNER_MISMATCH'
  | 'SIGNATURE_FAILED';

export class CampaignPeerIdentityError extends Error {
  constructor(readonly code: CampaignPeerIdentityErrorCode) {
    // OpenSSL errors and caller objects can contain the private key; retain neither.
    super(`campaign peer identity: ${code}`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const PUBLIC_KEYS = [
  'schemaVersion',
  'algorithm',
  'ownerDeviceId',
  'publicKeySpkiBase64',
  'keyFingerprintSha256',
] as const;
const PRIVATE_KEYS = [...PUBLIC_KEYS, 'privateKeyPkcs8Base64'] as const;
const TRANSCRIPT_KEYS = [
  'schemaVersion',
  'purpose',
  'hostDeviceId',
  'hostKeyFingerprintSha256',
  'campaignId',
  'deviceId',
  'deviceKeyFingerprintSha256',
  'deviceNonceBase64',
  'hostNonceBase64',
  'sequenceNumber',
  'bodySha256',
] as const;
/** ADR0066 technical envelope; RFC8032 Ed25519 signatures are 64 bytes. */
const NONCE_BYTES = 32;
const SIGNATURE_BYTES = 64;
const DOMAIN = 'SYMBIOSIS_CAMPAIGN_PEER_TRANSCRIPT_V1\n';
const fail = (code: CampaignPeerIdentityErrorCode): never => {
  throw new CampaignPeerIdentityError(code);
};
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function closedRecord(
  value: unknown,
  keys: readonly string[],
  code: CampaignPeerIdentityErrorCode,
): Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key)) ||
      keys.some(
        (key) =>
          descriptors[key] === undefined ||
          !Object.hasOwn(descriptors[key], 'value') ||
          !descriptors[key].enumerable,
      )
    )
      return fail(code);
    return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value as unknown]));
  } catch {
    return fail(code);
  }
}

function base64(value: unknown, code: CampaignPeerIdentityErrorCode, length?: number): Buffer {
  if (typeof value !== 'string' || value.length === 0) return fail(code);
  // DER encodings for the only allowed algorithm are far smaller than this technical cap.
  if (value.length > 1024) return fail(code);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (length !== undefined && bytes.length !== length)) {
    bytes.fill(0);
    return fail(code);
  }
  return bytes;
}

function publicIdentity(
  record: Record<string, unknown>,
  code: CampaignPeerIdentityErrorCode,
): { identity: CampaignPeerPublicIdentity; key: KeyObject } {
  if (
    record['schemaVersion'] !== 1 ||
    record['algorithm'] !== 'ED25519' ||
    typeof record['ownerDeviceId'] !== 'string' ||
    !UUID.test(record['ownerDeviceId']) ||
    typeof record['keyFingerprintSha256'] !== 'string' ||
    !SHA256.test(record['keyFingerprintSha256'])
  )
    return fail(code);
  const bytes = base64(record['publicKeySpkiBase64'], code);
  const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !key.export({ format: 'der', type: 'spki' }).equals(bytes) ||
    sha256(bytes) !== record['keyFingerprintSha256']
  )
    return fail(code);
  return {
    identity: Object.freeze({
      schemaVersion: 1,
      algorithm: 'ED25519',
      ownerDeviceId: record['ownerDeviceId'],
      publicKeySpkiBase64: bytes.toString('base64'),
      keyFingerprintSha256: record['keyFingerprintSha256'],
    }),
    key,
  };
}

export function validateCampaignPeerPublicIdentity(value: unknown): CampaignPeerPublicIdentity {
  try {
    return publicIdentity(
      closedRecord(value, PUBLIC_KEYS, 'INVALID_PUBLIC_IDENTITY'),
      'INVALID_PUBLIC_IDENTITY',
    ).identity;
  } catch {
    return fail('INVALID_PUBLIC_IDENTITY');
  }
}

function privateIdentity(value: unknown): {
  material: DeviceInstallationIdentityMaterial;
  key: KeyObject;
} {
  let bytes: Buffer | undefined;
  try {
    const record = closedRecord(value, PRIVATE_KEYS, 'INVALID_PRIVATE_IDENTITY');
    const { identity } = publicIdentity(record, 'INVALID_PRIVATE_IDENTITY');
    bytes = base64(record['privateKeyPkcs8Base64'], 'INVALID_PRIVATE_IDENTITY');
    const key = createPrivateKey({ key: bytes, format: 'der', type: 'pkcs8' });
    const reexported = key.export({ format: 'der', type: 'pkcs8' });
    try {
      if (
        key.asymmetricKeyType !== 'ed25519' ||
        !reexported.equals(bytes) ||
        createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64') !==
          identity.publicKeySpkiBase64
      )
        return fail('INVALID_PRIVATE_IDENTITY');
      return {
        material: Object.freeze({ ...identity, privateKeyPkcs8Base64: bytes.toString('base64') }),
        key,
      };
    } finally {
      reexported.fill(0);
    }
  } catch {
    return fail('INVALID_PRIVATE_IDENTITY');
  } finally {
    bytes?.fill(0);
  }
}

export function validateDeviceInstallationIdentityMaterial(
  value: unknown,
): DeviceInstallationIdentityMaterial {
  return privateIdentity(value).material;
}

export function generateDeviceInstallationIdentityMaterial(
  ownerDeviceId: string,
): DeviceInstallationIdentityMaterial {
  if (typeof ownerDeviceId !== 'string' || !UUID.test(ownerDeviceId)) return fail('INVALID_OWNER');
  let privateBytes: Buffer | undefined;
  try {
    const pair = generateKeyPairSync('ed25519');
    const publicBytes = pair.publicKey.export({ format: 'der', type: 'spki' });
    privateBytes = pair.privateKey.export({ format: 'der', type: 'pkcs8' });
    return validateDeviceInstallationIdentityMaterial({
      schemaVersion: 1,
      algorithm: 'ED25519',
      ownerDeviceId,
      publicKeySpkiBase64: publicBytes.toString('base64'),
      privateKeyPkcs8Base64: privateBytes.toString('base64'),
      keyFingerprintSha256: sha256(publicBytes),
    });
  } catch {
    return fail('KEY_GENERATION_FAILED');
  } finally {
    privateBytes?.fill(0);
  }
}

export function campaignPeerPublicIdentity(
  material: DeviceInstallationIdentityMaterial,
): CampaignPeerPublicIdentity {
  const { privateKeyPkcs8Base64: _private, ...identity } = privateIdentity(material).material;
  return Object.freeze(identity);
}

export function allocateCampaignPeerNonce(): string {
  try {
    const bytes = randomBytes(NONCE_BYTES);
    if (!Buffer.isBuffer(bytes) || bytes.length !== NONCE_BYTES)
      return fail('NONCE_ALLOCATION_FAILED');
    return bytes.toString('base64');
  } catch {
    return fail('NONCE_ALLOCATION_FAILED');
  }
}

export function validateCampaignPeerTranscript(value: unknown): CampaignPeerTranscript {
  const code = 'INVALID_TRANSCRIPT';
  const record = closedRecord(value, TRANSCRIPT_KEYS, code);
  if (
    record['schemaVersion'] !== 1 ||
    !['HOST_CHALLENGE', 'DEVICE_PROOF', 'RPC_REQUEST', 'RPC_RESPONSE'].includes(
      record['purpose'] as string,
    ) ||
    !['hostDeviceId', 'campaignId', 'deviceId'].every(
      (key) => typeof record[key] === 'string' && UUID.test(record[key]),
    ) ||
    !['hostKeyFingerprintSha256', 'deviceKeyFingerprintSha256', 'bodySha256'].every(
      (key) => typeof record[key] === 'string' && SHA256.test(record[key]),
    ) ||
    !Number.isSafeInteger(record['sequenceNumber']) ||
    (record['sequenceNumber'] as number) < 0 ||
    (['HOST_CHALLENGE', 'DEVICE_PROOF'].includes(record['purpose'] as string)
      ? record['sequenceNumber'] !== 0
      : record['sequenceNumber'] === 0)
  )
    return fail(code);
  base64(record['deviceNonceBase64'], code, NONCE_BYTES);
  base64(record['hostNonceBase64'], code, NONCE_BYTES);
  if (record['deviceNonceBase64'] === record['hostNonceBase64']) return fail(code);
  return Object.freeze(record) as unknown as CampaignPeerTranscript;
}

/** Fixed closed fields use the same code-unit key ordering as ADR0063 canonical JSON. */
function transcriptBytes(transcript: CampaignPeerTranscript): Buffer {
  return Buffer.from(
    DOMAIN +
      `{${Object.keys(transcript)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${JSON.stringify(Reflect.get(transcript, key))}`)
        .join(',')}}`,
    'utf8',
  );
}

function isTranscriptSigner(
  identity: CampaignPeerPublicIdentity,
  transcript: CampaignPeerTranscript,
): boolean {
  const host = transcript.purpose === 'HOST_CHALLENGE' || transcript.purpose === 'RPC_RESPONSE';
  return (
    identity.ownerDeviceId === (host ? transcript.hostDeviceId : transcript.deviceId) &&
    identity.keyFingerprintSha256 ===
      (host ? transcript.hostKeyFingerprintSha256 : transcript.deviceKeyFingerprintSha256)
  );
}

export function signCampaignPeerTranscript(
  material: DeviceInstallationIdentityMaterial,
  value: CampaignPeerTranscript,
): string {
  const { material: selected, key } = privateIdentity(material);
  const transcript = validateCampaignPeerTranscript(value);
  if (!isTranscriptSigner(selected, transcript)) return fail('SIGNER_MISMATCH');
  try {
    const signature = sign(null, transcriptBytes(transcript), key);
    if (signature.length !== SIGNATURE_BYTES) return fail('SIGNATURE_FAILED');
    return signature.toString('base64');
  } catch {
    return fail('SIGNATURE_FAILED');
  }
}

export function verifyCampaignPeerTranscript(
  identityValue: CampaignPeerPublicIdentity,
  transcriptValue: CampaignPeerTranscript,
  signatureBase64: string,
): boolean {
  const identity = validateCampaignPeerPublicIdentity(identityValue);
  const transcript = validateCampaignPeerTranscript(transcriptValue);
  const signature = base64(signatureBase64, 'INVALID_SIGNATURE', SIGNATURE_BYTES);
  if (!isTranscriptSigner(identity, transcript)) return false;
  try {
    return verify(
      null,
      transcriptBytes(transcript),
      createPublicKey({
        key: Buffer.from(identity.publicKeySpkiBase64, 'base64'),
        format: 'der',
        type: 'spki',
      }),
      signature,
    );
  } catch {
    return fail('INVALID_SIGNATURE');
  }
}
