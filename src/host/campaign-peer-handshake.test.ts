import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  campaignPeerPublicIdentity,
  generateDeviceInstallationIdentityMaterial,
  signCampaignPeerTranscript,
} from './campaign-peer-identity.js';
import { createCampaignPeerProofExchange } from './campaign-peer-proof-exchange.js';
import {
  authenticateCampaignPeerChallenge,
  CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES,
  CampaignPeerHandshakeError,
  campaignPeerChallengeBodySha256,
  decodeCampaignPeerHandshakeMessage,
  encodeCampaignPeerHandshakeMessage,
  type CampaignPeerChallenge,
  type CampaignPeerHello,
  type CampaignPeerProof,
  type PeerCampaignHeader,
} from './campaign-peer-handshake.js';

const HOST = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = '33333333-3333-4333-8333-333333333333';
const host = generateDeviceInstallationIdentityMaterial(HOST);
const device = generateDeviceInstallationIdentityMaterial(DEVICE);
const header: PeerCampaignHeader = {
  campaignId: CAMPAIGN,
  title: 'Тихая гавань',
  status: 'PAUSED',
  activePlayerCapacity: 3,
  activePcCount: 1,
  checkpointSha256: 'a'.repeat(64),
  baselineVersion: `sha256:${'b'.repeat(64)}`,
  revisions: { stateRevision: 7, actorVisibilityRevision: 2, projectionRevision: 5 },
};
function setup() {
  const hello: CampaignPeerHello = {
    protocolVersion: 3,
    messageType: 'network.peer.hello',
    targetCampaignId: CAMPAIGN,
    deviceIdentity: campaignPeerPublicIdentity(device),
    deviceNonceBase64: Buffer.alloc(32, 7).toString('base64'),
  };
  const exchange = createCampaignPeerProofExchange(
    host,
    CAMPAIGN,
    hello.deviceIdentity,
    hello.deviceNonceBase64,
    campaignPeerChallengeBodySha256(campaignPeerPublicIdentity(host), header),
  );
  const challenge: CampaignPeerChallenge = {
    protocolVersion: 3,
    messageType: 'network.peer.challenge',
    hostIdentity: campaignPeerPublicIdentity(host),
    campaign: header,
    signed: exchange.challenge(),
  };
  const transcript = { ...challenge.signed.transcript, purpose: 'DEVICE_PROOF' as const };
  const proof: CampaignPeerProof = {
    protocolVersion: 3,
    messageType: 'network.peer.proof',
    signed: { transcript, signatureBase64: signCampaignPeerTranscript(device, transcript) },
  };
  return { hello, challenge, proof, exchange };
}

describe('closed private campaign peer handshake', () => {
  it('round trips canonical frames and authenticates both sides with the actual exchange', () => {
    const p = setup();
    for (const message of [p.hello, p.challenge, p.proof]) {
      const text = encodeCampaignPeerHandshakeMessage(message);
      expect(decodeCampaignPeerHandshakeMessage(text)).toEqual(message);
      expect(text).not.toContain(host.privateKeyPkcs8Base64);
      expect(text).not.toContain(device.privateKeyPkcs8Base64);
    }
    expect(
      authenticateCampaignPeerChallenge(p.hello, p.challenge, campaignPeerPublicIdentity(host)),
    ).toEqual(p.challenge);
    p.exchange.acceptDeviceProof(p.proof.signed.transcript, p.proof.signed.signatureBase64);
    expect(p.exchange.state).toBe('READY');
    expect(
      Object.isFrozen(
        decodeCampaignPeerHandshakeMessage(encodeCampaignPeerHandshakeMessage(p.challenge)),
      ),
    ).toBe(true);
  });

  it('requires the exact target, device nonce/key and pinned host key independently of shape decoding', () => {
    const p = setup();
    const otherHost = campaignPeerPublicIdentity(generateDeviceInstallationIdentityMaterial(HOST));
    for (const changed of [
      { ...p.hello, targetCampaignId: DEVICE },
      { ...p.hello, deviceNonceBase64: Buffer.alloc(32, 8).toString('base64') },
      {
        ...p.hello,
        deviceIdentity: campaignPeerPublicIdentity(
          generateDeviceInstallationIdentityMaterial(DEVICE),
        ),
      },
    ])
      expect(() =>
        authenticateCampaignPeerChallenge(changed, p.challenge, campaignPeerPublicIdentity(host)),
      ).toThrow(CampaignPeerHandshakeError);
    expect(() => authenticateCampaignPeerChallenge(p.hello, p.challenge, otherHost)).toThrow(
      CampaignPeerHandshakeError,
    );
    const bytes = Buffer.from(p.challenge.signed.signatureBase64, 'base64');
    bytes[0] = bytes[0]! ^ 1;
    const changed = {
      ...p.challenge,
      signed: { ...p.challenge.signed, signatureBase64: bytes.toString('base64') },
    };
    expect(() =>
      decodeCampaignPeerHandshakeMessage(encodeCampaignPeerHandshakeMessage(changed)),
    ).not.toThrow();
    expect(() =>
      authenticateCampaignPeerChallenge(p.hello, changed, campaignPeerPublicIdentity(host)),
    ).toThrow(CampaignPeerHandshakeError);
  });

  it('binds every public campaign fact to the signed challenge body', () => {
    const p = setup();
    const changes = [
      { title: 'Другое название' },
      { activePlayerCapacity: 4 },
      { activePcCount: 0 },
      { checkpointSha256: 'c'.repeat(64) },
      { baselineVersion: `sha256:${'c'.repeat(64)}` },
      { revisions: { ...header.revisions, projectionRevision: 6 } },
    ];
    for (const changed of changes)
      expect(() =>
        encodeCampaignPeerHandshakeMessage({
          ...p.challenge,
          campaign: { ...header, ...changed },
        } as CampaignPeerChallenge),
      ).toThrow(CampaignPeerHandshakeError);
  });

  it('refuses duplicate members, whitespace aliases, malformed and non-text frames', () => {
    const p = setup();
    const canonical = encodeCampaignPeerHandshakeMessage(p.hello);
    for (const value of [
      ` ${canonical}`,
      `${canonical}\n`,
      canonical.replace('"protocolVersion":3', '"protocolVersion":3,"protocolVersion":3'),
      canonical.replace('"protocolVersion":3', '"protocolVersion":4'),
      canonical.replace('network.peer.hello', 'session.reconnect'),
      '{malformed-private-marker',
      Buffer.from(canonical),
      null,
    ])
      expect(() => decodeCampaignPeerHandshakeMessage(value)).toThrow(CampaignPeerHandshakeError);
  });

  it('refuses private fields, unknown keys, unsafe revisions and invalid campaign facts', () => {
    const p = setup();
    const invalid = [
      { ...p.hello, role: 'gm' },
      {
        ...p.hello,
        deviceIdentity: {
          ...p.hello.deviceIdentity,
          privateKeyPkcs8Base64: device.privateKeyPkcs8Base64,
        },
      },
      { ...p.challenge, campaign: { ...header, status: 'ACTIVE' } },
      { ...p.challenge, campaign: { ...header, activePlayerCapacity: 0 } },
      { ...p.challenge, campaign: { ...header, activePlayerCapacity: 6 } },
      { ...p.challenge, campaign: { ...header, activePcCount: 4 } },
      { ...p.challenge, campaign: { ...header, activePcCount: -1 } },
      {
        ...p.challenge,
        campaign: {
          ...header,
          revisions: { ...header.revisions, stateRevision: Number.MAX_SAFE_INTEGER + 1 },
        },
      },
      { ...p.challenge, signed: { ...p.challenge.signed, transcript: p.proof.signed.transcript } },
      { ...p.proof, signed: p.challenge.signed },
    ];
    for (const value of invalid)
      expect(() => encodeCampaignPeerHandshakeMessage(value as CampaignPeerChallenge)).toThrow(
        CampaignPeerHandshakeError,
      );
  });

  it('bounds control frames and keeps all refusal diagnostics free of caller values', () => {
    const p = setup();
    const getter = vi.fn(() => host.privateKeyPkcs8Base64);
    const value = Object.defineProperty({ ...p.hello }, 'messageType', {
      enumerable: true,
      get: getter,
    });
    const oversizedHeader = { ...header, title: 'я'.repeat(CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES) };
    const oversizedExchange = createCampaignPeerProofExchange(
      host,
      CAMPAIGN,
      p.hello.deviceIdentity,
      p.hello.deviceNonceBase64,
      campaignPeerChallengeBodySha256(p.challenge.hostIdentity, oversizedHeader),
    );
    for (const invalid of [
      () => encodeCampaignPeerHandshakeMessage(value),
      () => decodeCampaignPeerHandshakeMessage('x'.repeat(CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES + 1)),
      () =>
        encodeCampaignPeerHandshakeMessage({
          ...p.challenge,
          campaign: oversizedHeader,
          signed: oversizedExchange.challenge(),
        }),
    ]) {
      try {
        invalid();
        expect.fail('invalid control frame must fail');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(CampaignPeerHandshakeError);
        expect(error).not.toHaveProperty('cause');
        expect(String(error)).toBe('Error: campaign peer handshake: INVALID_PEER_HANDSHAKE');
      }
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
