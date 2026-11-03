import { describe, expect, it } from 'vitest';
import { networkFramesForPrivateDataCheck } from '../fixtures/network-browser-privacy.js';

const host = {
  ownerDeviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  keyFingerprintSha256: 'a'.repeat(64),
};
const privateData = /privateKey|keyFingerprint|canonicalWitnessText|CORE-\d/u;
function frame() {
  return {
    messageType: 'network.peer-state',
    protocolVersion: 3,
    formOrNull: {
      formId: 'NET-009',
      fields: {
        pinnedCampaignPeerReconnectOrNull: {
          reconnectHostAddress: '127.0.0.1',
          reconnectHostPort: 41337,
          lastAuthenticatedEndpoint: 'http://127.0.0.1:41337',
          previouslyPinnedHostIdentity: { ...host },
        },
      },
    },
  };
}

describe('network browser privacy assertion scope', () => {
  it('allows only the exact public NET-009 identity of the real expected host', () => {
    const raw = JSON.stringify(frame());
    expect(raw).toMatch(privateData);
    expect(networkFramesForPrivateDataCheck([raw], host)).not.toMatch(privateData);
    expect(raw).toContain('keyFingerprintSha256');
  });
  it('rejects duplicate keys whose earlier private value would disappear during parsing', () => {
    const raw = JSON.stringify(frame()).replace(
      '"reconnectHostAddress":"127.0.0.1"',
      '"reconnectHostAddress":"privateKeyPkcs8Base64","reconnectHostAddress":"127.0.0.1"',
    );
    expect(raw).toMatch(privateData);
    expect(JSON.stringify(JSON.parse(raw))).not.toContain('privateKeyPkcs8Base64');
    expect(() => networkFramesForPrivateDataCheck([raw], host)).toThrow();
  });
  it('rejects alternate lexical encoding before changing an allowed frame', () => {
    const raw = JSON.stringify(frame()).replace('127.0.0.1', String.raw`\u0031` + '27.0.0.1');
    expect(JSON.parse(raw)).toEqual(frame());
    expect(() => networkFramesForPrivateDataCheck([raw], host)).toThrow();
  });
  it.each(['ownerDeviceId', 'keyFingerprintSha256'] as const)('rejects another host %s', (key) => {
    const packet = frame();
    packet.formOrNull.fields.pinnedCampaignPeerReconnectOrNull.previouslyPinnedHostIdentity[key] =
      key === 'ownerDeviceId' ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : 'b'.repeat(64);
    expect(() => networkFramesForPrivateDataCheck([JSON.stringify(packet)], host)).toThrow();
  });
  it.each(['pin', 'identity'] as const)('rejects extra private data in the closed %s', (target) => {
    const packet = frame();
    const pin = packet.formOrNull.fields.pinnedCampaignPeerReconnectOrNull;
    Object.assign(target === 'pin' ? pin : pin.previouslyPinnedHostIdentity, {
      privateKeyPkcs8Base64: 'private-material',
    });
    expect(() => networkFramesForPrivateDataCheck([JSON.stringify(packet)], host)).toThrow();
  });
  it('keeps duplicate fingerprints and private fields beside the allowed identity in the scan', () => {
    for (const leaked of [
      { keyFingerprintSha256: host.keyFingerprintSha256 },
      { privateKeyPkcs8Base64: 'private-material' },
      { canonicalWitnessText: 'CORE-123' },
    ]) {
      const packet = { ...frame(), leaked };
      expect(networkFramesForPrivateDataCheck([JSON.stringify(packet)], host)).toMatch(privateData);
    }
  });
  it.each(['message', 'protocol', 'form', 'path'] as const)(
    'does not exempt a fingerprint under a different %s',
    (difference) => {
      const packet = frame();
      if (difference === 'message') packet.messageType = 'projection.snapshot';
      if (difference === 'protocol') packet.protocolVersion = 2;
      if (difference === 'form') packet.formOrNull.formId = 'NET-008';
      if (difference === 'path') {
        const fields = packet.formOrNull.fields as Record<string, unknown>;
        fields['unexpectedPin'] = fields['pinnedCampaignPeerReconnectOrNull'];
        delete fields['pinnedCampaignPeerReconnectOrNull'];
        expect(() => networkFramesForPrivateDataCheck([JSON.stringify(packet)], host)).toThrow();
      } else {
        expect(networkFramesForPrivateDataCheck([JSON.stringify(packet)], host)).toMatch(
          privateData,
        );
      }
    },
  );
});
