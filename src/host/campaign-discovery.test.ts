import { describe, expect, it } from 'vitest';
import {
  CampaignDiscoveryError,
  scanCampaignDiscovery,
  startCampaignDiscoveryResponder,
  type CampaignDiscoveryDiagnostic,
  type CampaignDiscoveryScanOptions,
  type DiscoveredCampaign,
} from './campaign-discovery.js';

const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const offer: DiscoveredCampaign = {
  origin: 'http://127.0.0.1:48500',
  campaign: {
    campaignId: CAMPAIGN,
    title: 'Тихая гавань',
    status: 'PAUSED',
    activePlayerCapacity: 3,
    activePcCount: 0,
    checkpointSha256: 'a'.repeat(64),
    baselineVersion: `sha256:${'b'.repeat(64)}`,
    revisions: { stateRevision: 0, actorVisibilityRevision: 0, projectionRevision: 0 },
  },
};
async function responder(
  offers: readonly DiscoveredCampaign[],
  diagnostics: CampaignDiscoveryDiagnostic[] = [],
) {
  return startCampaignDiscoveryResponder({
    bindAddress: '127.0.0.1',
    port: 0,
    multicastGroup: null,
    multicastInterface: null,
    maxPacketBytes: 60 * 1024,
    readOffers: () => offers,
    onDiagnostic: (code) => diagnostics.push(code),
  });
}
function scanOptions(port: number): CampaignDiscoveryScanOptions {
  return {
    bindAddress: '127.0.0.1',
    destinationAddress: '127.0.0.1',
    destinationPort: port,
    windowMs: 300,
    maxPacketBytes: 60 * 1024,
    maxOffers: 8,
  };
}

describe('actual UDP campaign discovery without domain admission', () => {
  it('finds exact public facts and deduplicates identical datagrams', async () => {
    const host = await responder([offer, offer]);
    try {
      const result = await scanCampaignDiscovery(scanOptions(host.port));
      expect(result).toEqual({ offers: [offer], diagnostics: [], truncated: false });
      expect(Object.isFrozen(result.offers)).toBe(true);
    } finally {
      await host.close();
      await host.close();
    }
  });

  it('removes contradictory facts instead of selecting an arbitrary first/latest offer', async () => {
    const changed = { ...offer, campaign: { ...offer.campaign, title: 'Другое имя' } };
    const host = await responder([offer, changed, offer]);
    try {
      expect(await scanCampaignDiscovery(scanOptions(host.port))).toEqual({
        offers: [],
        diagnostics: ['CONFLICTING_OFFER'],
        truncated: false,
      });
    } finally {
      await host.close();
    }
  });

  it('bounds unique offers even when conflicting entries are discarded', async () => {
    const second = { ...offer, campaign: { ...offer.campaign, campaignId: OTHER } };
    const host = await responder([
      offer,
      { ...offer, campaign: { ...offer.campaign, title: 'Другое' } },
      second,
    ]);
    try {
      expect(await scanCampaignDiscovery({ ...scanOptions(host.port), maxOffers: 1 })).toEqual({
        offers: [],
        diagnostics: ['CONFLICTING_OFFER', 'OFFER_LIMIT'],
        truncated: true,
      });
    } finally {
      await host.close();
    }
  });

  it('reports an oversized or private-contaminated public source without sending it', async () => {
    const diagnostics: CampaignDiscoveryDiagnostic[] = [];
    const host = await responder(
      [
        { ...offer, campaign: { ...offer.campaign, title: 'я'.repeat(40 * 1024) } },
        { ...offer, privateKey: 'PRIVATE_MARKER' } as DiscoveredCampaign,
      ],
      diagnostics,
    );
    try {
      const result = await scanCampaignDiscovery(scanOptions(host.port));
      expect(result.offers).toEqual([]);
      expect(diagnostics).toEqual(['OFFER_TOO_LARGE', 'SOURCE_UNAVAILABLE']);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_MARKER');
    } finally {
      await host.close();
    }
  });

  it('requires explicit LAN configuration and handles cancellation without a dangling scan', async () => {
    const host = await responder([offer]);
    try {
      for (const changed of [
        { destinationAddress: '8.8.8.8' },
        { destinationAddress: 'example.invalid' },
        { bindAddress: '0.0.0.0' },
        { destinationPort: 0 },
        { windowMs: 0 },
        { maxOffers: 0 },
      ])
        await expect(
          scanCampaignDiscovery({ ...scanOptions(host.port), ...changed }),
        ).rejects.toEqual(new CampaignDiscoveryError('INVALID_CONFIG'));
      const controller = new AbortController();
      const pending = scanCampaignDiscovery({
        ...scanOptions(host.port),
        windowMs: 10000,
        signal: controller.signal,
      });
      controller.abort();
      await expect(pending).rejects.toEqual(new CampaignDiscoveryError('CANCELLED'));
      await expect(
        scanCampaignDiscovery({ ...scanOptions(host.port), signal: controller.signal }),
      ).rejects.toEqual(new CampaignDiscoveryError('CANCELLED'));
    } finally {
      await host.close();
    }
  });
});
