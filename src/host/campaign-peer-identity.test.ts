import { Buffer } from 'node:buffer';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { openPersistenceDatabase } from '../persistence/database.js';
import { bootstrapDeviceIdentity } from '../persistence/device-identity.js';
import {
  ensureDeviceInstallationIdentity,
  readDeviceInstallationIdentity,
} from '../persistence/network-installation-identity.js';
import {
  allocateCampaignPeerNonce,
  campaignPeerPublicIdentity,
  CampaignPeerIdentityError,
  generateDeviceInstallationIdentityMaterial,
  signCampaignPeerTranscript,
  validateCampaignPeerPublicIdentity,
  validateCampaignPeerTranscript,
  validateDeviceInstallationIdentityMaterial,
  verifyCampaignPeerTranscript,
  type CampaignPeerTranscript,
} from './campaign-peer-identity.js';

const HOST = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = '33333333-3333-4333-8333-333333333333';
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const device = generateDeviceInstallationIdentityMaterial(DEVICE);
const host = generateDeviceInstallationIdentityMaterial(HOST);
function transcript(
  purpose: CampaignPeerTranscript['purpose'] = 'RPC_REQUEST',
): CampaignPeerTranscript {
  return {
    schemaVersion: 1,
    purpose,
    hostDeviceId: HOST,
    hostKeyFingerprintSha256: host.keyFingerprintSha256,
    campaignId: CAMPAIGN,
    deviceId: DEVICE,
    deviceKeyFingerprintSha256: device.keyFingerprintSha256,
    deviceNonceBase64: Buffer.alloc(32, 1).toString('base64'),
    hostNonceBase64: Buffer.alloc(32, 2).toString('base64'),
    sequenceNumber: purpose === 'HOST_CHALLENGE' || purpose === 'DEVICE_PROOF' ? 0 : 1,
    bodySha256: sha('{"commandId":"closed-semantic-command"}'),
  };
}

describe('campaign peer installation keys and scoped signatures', () => {
  it('validates the selected persisted pair inside the store guard without rotating on replay', () => {
    const db = openPersistenceDatabase(':memory:');
    try {
      const owner = bootstrapDeviceIdentity(db);
      const prepared = generateDeviceInstallationIdentityMaterial(owner);
      const validate = vi.fn((selected: unknown) => {
        expect(db.inTransaction).toBe(true);
        validateDeviceInstallationIdentityMaterial(selected);
      });
      expect(ensureDeviceInstallationIdentity(db, prepared, validate)).toEqual(prepared);
      const beforeReplay = db.serialize();
      const unusedNewKey = generateDeviceInstallationIdentityMaterial(owner);
      expect(ensureDeviceInstallationIdentity(db, unusedNewKey, validate)).toEqual(prepared);
      expect(validate).toHaveBeenLastCalledWith(prepared);
      expect(db.serialize()).toEqual(beforeReplay);
      const restored = readDeviceInstallationIdentity(db, owner);
      expect(validateDeviceInstallationIdentityMaterial(restored)).toEqual(prepared);
      expect(campaignPeerPublicIdentity(prepared)).not.toHaveProperty('privateKeyPkcs8Base64');
    } finally {
      db.close();
    }
  });

  it('validates the independent RFC8032 section7.1 TEST1 seed/public key and signature', () => {
    // RFC8410: Ed25519 PKCS8 wraps the seed in nested OCTET STRINGs; SPKI has no parameters.
    const privateBytes = Buffer.from(
      '302e020100300506032b657004220420' +
        '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
      'hex',
    );
    const publicBytes = Buffer.from(
      '302a300506032b6570032100' +
        'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
      'hex',
    );
    const material = validateDeviceInstallationIdentityMaterial({
      schemaVersion: 1,
      algorithm: 'ED25519',
      ownerDeviceId: DEVICE,
      publicKeySpkiBase64: publicBytes.toString('base64'),
      privateKeyPkcs8Base64: privateBytes.toString('base64'),
      keyFingerprintSha256: sha(publicBytes),
    });
    const key = createPrivateKey({ key: privateBytes, format: 'der', type: 'pkcs8' });
    expect(sign(null, Buffer.alloc(0), key).toString('hex')).toBe(
      'e5564300c360ac729086e2cc806e828a' +
        '84877f1eb8e5d974d873e06522490155' +
        '5fb8821590a33bacc61e39701cf9b46b' +
        'd25bf5f0595bbe24655141438e7a100b',
    );
    expect(campaignPeerPublicIdentity(material).publicKeySpkiBase64).toBe(
      publicBytes.toString('base64'),
    );
  });

  it('allocates independent owner-bound pairs and exposes exactly the public fields', () => {
    const another = generateDeviceInstallationIdentityMaterial(DEVICE);
    expect(another.keyFingerprintSha256).not.toBe(device.keyFingerprintSha256);
    expect(Object.isFrozen(device)).toBe(true);
    expect(validateDeviceInstallationIdentityMaterial(structuredClone(device))).toEqual(device);
    const publicIdentity = campaignPeerPublicIdentity(device);
    expect(Object.isFrozen(publicIdentity)).toBe(true);
    expect(Object.keys(publicIdentity).sort()).toEqual(
      [
        'schemaVersion',
        'algorithm',
        'ownerDeviceId',
        'publicKeySpkiBase64',
        'keyFingerprintSha256',
      ].sort(),
    );
    expect(JSON.stringify(publicIdentity)).not.toContain(device.privateKeyPkcs8Base64);
    expect(() =>
      generateDeviceInstallationIdentityMaterial(DEVICE.replace(/2/gu, 'a').toUpperCase()),
    ).toThrow('INVALID_OWNER');
  });

  it.each(['HOST_CHALLENGE', 'DEVICE_PROOF', 'RPC_REQUEST', 'RPC_RESPONSE'] as const)(
    'signs %s with its designated principal and independent canonical transcript verification',
    (purpose) => {
      const source = transcript(purpose);
      const signer = purpose === 'HOST_CHALLENGE' || purpose === 'RPC_RESPONSE' ? host : device;
      const signature = signCampaignPeerTranscript(signer, source);
      const bytes = Buffer.from(
        'SYMBIOSIS_CAMPAIGN_PEER_TRANSCRIPT_V1\n' +
          JSON.stringify(
            Object.fromEntries(
              Object.entries(source).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
            ),
          ),
      );
      const key = createPublicKey({
        key: Buffer.from(signer.publicKeySpkiBase64, 'base64'),
        format: 'der',
        type: 'spki',
      });
      expect(Buffer.from(signature, 'base64')).toHaveLength(64);
      expect(verify(null, bytes, key, Buffer.from(signature, 'base64'))).toBe(true);
      expect(
        verifyCampaignPeerTranscript(campaignPeerPublicIdentity(signer), source, signature),
      ).toBe(true);
      expect(signCampaignPeerTranscript(signer, { ...source })).toBe(signature);
      expect(() => signCampaignPeerTranscript(signer === host ? device : host, source)).toThrow(
        'SIGNER_MISMATCH',
      );
    },
  );

  it('binds a signature to both keys, both nonces, target campaign, purpose, sequence and exact body', () => {
    const source = transcript();
    const signature = signCampaignPeerTranscript(device, source);
    const changed: CampaignPeerTranscript[] = [
      { ...source, campaignId: HOST },
      { ...source, hostDeviceId: DEVICE },
      { ...source, deviceId: HOST },
      { ...source, hostKeyFingerprintSha256: 'a'.repeat(64) },
      { ...source, deviceKeyFingerprintSha256: 'a'.repeat(64) },
      { ...source, hostNonceBase64: Buffer.alloc(32, 3).toString('base64') },
      { ...source, deviceNonceBase64: Buffer.alloc(32, 3).toString('base64') },
      { ...source, purpose: 'RPC_RESPONSE' },
      { ...source, sequenceNumber: 2 },
      { ...source, bodySha256: sha('{"commandId":"another-command"}') },
    ];
    for (const value of changed)
      expect(
        verifyCampaignPeerTranscript(campaignPeerPublicIdentity(device), value, signature),
      ).toBe(false);
    const bytes = Buffer.from(signature, 'base64');
    bytes[0] = bytes[0]! ^ 1;
    expect(
      verifyCampaignPeerTranscript(
        campaignPeerPublicIdentity(device),
        source,
        bytes.toString('base64'),
      ),
    ).toBe(false);
  });

  it('refuses changed pairs, noncanonical DER/Base64, extra fields and fingerprint mismatches', () => {
    const invalid = [
      { ...device, privateKeyPkcs8Base64: host.privateKeyPkcs8Base64 },
      { ...device, keyFingerprintSha256: 'a'.repeat(64) },
      { ...device, algorithm: 'ECDSA' },
      { ...device, extra: 'not permitted' },
      { ...device, privateKeyPkcs8Base64: device.privateKeyPkcs8Base64 + '\n' },
      { ...device, publicKeySpkiBase64: device.publicKeySpkiBase64.replace(/=+$/u, '') },
      {
        ...device,
        privateKeyPkcs8Base64: Buffer.concat([
          Buffer.from(device.privateKeyPkcs8Base64, 'base64'),
          Buffer.from([0]),
        ]).toString('base64'),
      },
    ];
    for (const value of invalid)
      expect(() => validateDeviceInstallationIdentityMaterial(value)).toThrow(
        'INVALID_PRIVATE_IDENTITY',
      );
    expect(() => validateCampaignPeerPublicIdentity(device)).toThrow('INVALID_PUBLIC_IDENTITY');
    const key = createPrivateKey({
      key: Buffer.from(device.privateKeyPkcs8Base64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    expect(() => validateDeviceInstallationIdentityMaterial(key)).toThrow(
      'INVALID_PRIVATE_IDENTITY',
    );
  });

  it('rejects accessor/symbol/hidden/prototype shapes without invoking user code or leaking keys', () => {
    const getter = vi.fn(() => device.privateKeyPkcs8Base64);
    const value = { ...device };
    Object.defineProperty(value, 'privateKeyPkcs8Base64', { enumerable: true, get: getter });
    const shapes = [
      value,
      { ...device, [Symbol('extra')]: 1 },
      Object.defineProperty({ ...device }, 'hidden', { value: 1 }),
      Object.assign(Object.create({ inherited: 1 }) as Record<string, unknown>, device),
    ];
    for (const shape of shapes) {
      try {
        validateDeviceInstallationIdentityMaterial(shape);
        expect.fail('malformed private identity must be refused');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(CampaignPeerIdentityError);
        expect(error).not.toHaveProperty('cause');
        expect(String(error)).not.toContain(device.privateKeyPkcs8Base64);
      }
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('validates handshake/RPC sequence namespaces and canonical nonce/signature shape', () => {
    const source = transcript();
    for (const value of [
      { ...source, sequenceNumber: 0 },
      { ...source, sequenceNumber: Number.MAX_SAFE_INTEGER + 1 },
      { ...source, sequenceNumber: -1 },
      { ...source, purpose: 'DEVICE_PROOF', sequenceNumber: 1 },
      { ...source, hostNonceBase64: source.deviceNonceBase64 },
      { ...source, deviceNonceBase64: 'invalid' },
      { ...source, bodySha256: 'A'.repeat(64) },
      { ...source, unrecognized: true },
    ])
      expect(() => validateCampaignPeerTranscript(value)).toThrow('INVALID_TRANSCRIPT');
    const signature = signCampaignPeerTranscript(device, source);
    for (const invalid of [signature + '\n', signature.replace(/=+$/u, ''), '', 'A'.repeat(88)])
      expect(() =>
        verifyCampaignPeerTranscript(campaignPeerPublicIdentity(device), source, invalid),
      ).toThrow('INVALID_SIGNATURE');
    const first = allocateCampaignPeerNonce();
    expect(Buffer.from(first, 'base64')).toHaveLength(32);
    expect(allocateCampaignPeerNonce()).not.toBe(first);
  });
});
