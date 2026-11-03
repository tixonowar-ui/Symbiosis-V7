import assert from 'node:assert/strict';

interface PublicPinnedHost {
  readonly ownerDeviceId: string;
  readonly keyFingerprintSha256: string;
}

/** Atlas 1.9 NET-009 exposes this exact public pin, never the installation key material. */
export function networkFramesForPrivateDataCheck(
  frames: readonly string[],
  expectedHost: PublicPinnedHost,
): string {
  return frames
    .map((raw) => {
      const packet = JSON.parse(raw) as Record<string, unknown>;
      const form = packet['formOrNull'] as Record<string, unknown> | null | undefined;
      if (
        packet['messageType'] !== 'network.peer-state' ||
        packet['protocolVersion'] !== 3 ||
        form?.['formId'] !== 'NET-009'
      )
        return raw;
      // A lossy parse could hide forbidden bytes in duplicate keys before the raw scan.
      assert.equal(JSON.stringify(packet), raw);
      const fields = form['fields'] as Record<string, unknown>;
      const pin = fields['pinnedCampaignPeerReconnectOrNull'] as Record<string, unknown>;
      assert.deepEqual(Object.keys(pin).sort(), [
        'lastAuthenticatedEndpoint',
        'previouslyPinnedHostIdentity',
        'reconnectHostAddress',
        'reconnectHostPort',
      ]);
      const identity = pin['previouslyPinnedHostIdentity'] as Record<string, unknown>;
      assert.deepEqual(Object.keys(identity).sort(), ['keyFingerprintSha256', 'ownerDeviceId']);
      assert.deepEqual(identity, expectedHost);
      // Keep every other key/value in the scan, including duplicate identities elsewhere.
      const scannedIdentity: Record<string, unknown> = { ...identity };
      delete scannedIdentity['keyFingerprintSha256'];
      pin['previouslyPinnedHostIdentity'] = scannedIdentity;
      return JSON.stringify(packet);
    })
    .join('\n');
}
