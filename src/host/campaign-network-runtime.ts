import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { readHostedCurrentPausedCampaign } from '../persistence/current-paused-campaign.js';
import { readHostedPausedCampaignIds } from '../persistence/network-device-request.js';
import { validateMasterSecretVerifier } from './campaign-secret.js';
import { loadNetworkInstallation } from './network-installation.js';
import type { CampaignBindManager, CampaignBindRecovery } from './campaign-bind.js';
import { createCampaignNetworkEndpoint } from './campaign-network-endpoint.js';
import { createCampaignNetworkExecutor } from './campaign-network-executor.js';
import { createDeviceAdmissionPeerRuntime } from './device-admission-peer-runtime.js';
import { acceptCampaignPeerChannel } from './campaign-peer-channel.js';
import { validatePeerCampaignHeader, type PeerCampaignHeader } from './campaign-peer-handshake.js';
import { parseCampaignLanAddress } from './campaign-lan-address.js';
import {
  startCampaignDiscoveryResponder,
  scanCampaignDiscovery,
  type CampaignDiscoveryScan,
  type DiscoveredCampaign,
} from './campaign-discovery.js';
import type { LocalCharacterExportBaseline } from './local-character-export.js';
import type { NetworkApplicationConfig } from './network-application-config.js';
import type { CampaignPrivateOwner } from '../persistence/campaign-creation.js';

export class CampaignNetworkRuntimeError extends Error {
  constructor(
    readonly code:
      | 'SOURCE_UNAVAILABLE'
      | 'PUBLICATION_UNAVAILABLE'
      | 'DISCOVERY_UNAVAILABLE'
      | 'PEER_REJECTED'
      | 'CLOSED',
  ) {
    super(`campaign network runtime: ${code}`);
  }
}
const validateOwner = (owner: CampaignPrivateOwner) => {
  validateMasterSecretVerifier(owner.verifier);
};

/** Composition of actual stored campaign proof, held listeners and the private peer executor. */
export function createCampaignNetworkRuntime(d: {
  readonly database: Database.Database;
  readonly baseline: LocalCharacterExportBaseline;
  readonly bind: CampaignBindManager;
  readonly shellServer: Server;
  readonly config: NetworkApplicationConfig;
}) {
  const published = new Set<string>();
  const responders = new Map<string, Awaited<ReturnType<typeof startCampaignDiscoveryResponder>>>();
  const scans = new Set<AbortController>();
  const diagnosticCodes = new Set<CampaignNetworkRuntimeError['code']>();
  const executor = createCampaignNetworkExecutor(d.config.executor);
  const receiver = createDeviceAdmissionPeerRuntime({
    database: d.database,
    baseline: d.baseline,
    executor,
    limits: d.config.transfer,
  });
  let closed = false;
  let startPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  const report = (code: CampaignNetworkRuntimeError['code']) => {
    if (!closed) diagnosticCodes.add(code);
  };
  function current(id: string) {
    return readHostedCurrentPausedCampaign(d.database, id, validateOwner);
  }
  function header(id: string): PeerCampaignHeader {
    const row = current(id);
    return validatePeerCampaignHeader({
      campaignId: row.campaignId,
      title: row.title,
      status: row.status,
      activePlayerCapacity: row.activePlayerCapacity,
      activePcCount: row.activePcCount,
      checkpointSha256: row.checkpointSha256,
      baselineVersion: row.baselineVersion,
      revisions: {
        stateRevision: row.stateRevision,
        projectionRevision: row.projectionRevision,
        actorVisibilityRevision: row.actorVisibilityRevision,
      },
    });
  }
  const endpoint = createCampaignNetworkEndpoint({
    maxConnections: d.config.transfer.maxChannels,
    shellServer: d.shellServer,
    bind: d.bind,
    readPublicCampaignHeaders: (ids) => ids.map(header),
    onError: () => report('PUBLICATION_UNAVAILABLE'),
    accept: async (socket, request, ids) => {
      try {
        if (closed) throw new CampaignNetworkRuntimeError('CLOSED');
        const channel = await acceptCampaignPeerChannel(socket, request, {
          limits: d.config.channel,
          resolveCampaign: (id) => {
            if (
              closed ||
              !ids.includes(id) ||
              !published.has(id) ||
              d.bind.endpointForCampaign(id) === null
            )
              return null;
            return { hostMaterial: loadNetworkInstallation(d.database), campaign: header(id) };
          },
        });
        await receiver.run(channel);
      } catch {
        socket.terminate();
        if (!closed) report('PEER_REJECTED');
      }
    },
  });
  function interfaces() {
    return d.bind.interfaces().filter((entry) => {
      if (entry.family !== 'IPv4') return false;
      try {
        return parseCampaignLanAddress(`http://${entry.hostAddress}:1`).host === entry.hostAddress;
      } catch {
        return false;
      } // A public interface is outside the explicit offline LAN allowlist.
    });
  }
  function offersFor(interfaceAddress: string): readonly DiscoveredCampaign[] {
    if (closed) return [];
    const selected = interfaces().find((entry) => entry.hostAddress === interfaceAddress);
    if (selected === undefined) return [];
    const offers: DiscoveredCampaign[] = [];
    for (const id of published) {
      if (d.bind.endpointForCampaign(id) === null) continue;
      const campaign = current(id),
        config = campaign.bindConfiguration;
      if (config.networkInterface !== selected.networkInterface) continue;
      const address = parseCampaignLanAddress(
        `http://${config.hostAddress.includes(':') ? `[${config.hostAddress}]` : config.hostAddress}:${String(config.hostPort)}`,
      );
      // Loopback locators remain on the loopback membership; they cannot reach another machine.
      if (
        (address.host.startsWith('127.') || address.host === '::1') !==
        selected.hostAddress.startsWith('127.')
      )
        continue;
      offers.push({ origin: address.canonicalOrigin, campaign: header(id) });
    }
    return offers;
  }
  async function ensureResponders() {
    for (const iface of interfaces()) {
      if (closed) return;
      if (responders.has(iface.hostAddress)) continue;
      try {
        const responder = await startCampaignDiscoveryResponder({
          bindAddress: '0.0.0.0',
          port: d.config.discoveryPort,
          multicastGroup: d.config.discoveryGroup,
          multicastInterface: iface.hostAddress,
          maxPacketBytes: d.config.discoveryMaxPacketBytes,
          readOffers: () => offersFor(iface.hostAddress),
          onDiagnostic: () => report('DISCOVERY_UNAVAILABLE'),
        });
        if (closed) await responder.close();
        else responders.set(iface.hostAddress, responder);
      } catch {
        report('DISCOVERY_UNAVAILABLE');
      }
    }
  }
  async function publishCampaign(id: string): Promise<CampaignBindRecovery> {
    if (closed) throw new CampaignNetworkRuntimeError('CLOSED');
    try {
      const row = current(id);
      const recovery = await d.bind.recover(id, {
        ...row.bindConfiguration,
        activePlayerCapacity: row.activePlayerCapacity,
      });
      if (closed) throw new CampaignNetworkRuntimeError('CLOSED');
      if (recovery.status !== 'RESERVED') {
        endpoint.unpublishCampaign(id);
        published.delete(id);
        report('PUBLICATION_UNAVAILABLE');
        return recovery;
      }
      endpoint.publishCampaign(id);
      published.add(id);
      return recovery;
    } catch {
      endpoint.unpublishCampaign(id);
      published.delete(id);
      report('PUBLICATION_UNAVAILABLE');
      return { status: 'UNAVAILABLE', reasonCode: 'BIND_FAILED' };
    }
  }
  function start(): Promise<void> {
    if (closed) return Promise.reject(new CampaignNetworkRuntimeError('CLOSED'));
    if (startPromise !== undefined) return startPromise;
    startPromise = (async () => {
      const ids = readHostedPausedCampaignIds(d.database, validateOwner);
      for (const id of ids) await publishCampaign(id);
      await ensureResponders();
    })();
    return startPromise;
  }
  async function discover(): Promise<CampaignDiscoveryScan> {
    if (closed) throw new CampaignNetworkRuntimeError('CLOSED');
    const controller = new AbortController();
    scans.add(controller);
    try {
      const results = await Promise.allSettled(
        interfaces().map((iface) =>
          scanCampaignDiscovery({
            bindAddress: iface.hostAddress,
            destinationAddress: d.config.discoveryGroup,
            destinationPort: d.config.discoveryPort,
            windowMs: d.config.discoveryWindowMs,
            maxPacketBytes: d.config.discoveryMaxPacketBytes,
            maxOffers: d.config.discoveryMaxOffers,
            signal: controller.signal,
          }),
        ),
      );
      const unique = new Map<string, DiscoveredCampaign>(),
        conflicts = new Set<string>(),
        seen = new Set<string>();
      const diagnostics: CampaignDiscoveryScan['diagnostics'][number][] = [];
      if (diagnosticCodes.has('DISCOVERY_UNAVAILABLE')) diagnostics.push('SOURCE_UNAVAILABLE');
      let truncated = false;
      for (const outcome of results) {
        if (outcome.status === 'rejected') {
          diagnostics.push('SOURCE_UNAVAILABLE');
          continue;
        }
        const result = outcome.value;
        diagnostics.push(...result.diagnostics);
        truncated ||= result.truncated;
        for (const offer of result.offers) {
          const key = `${offer.origin}/${offer.campaign.campaignId}`;
          if (conflicts.has(key)) continue;
          if (!seen.has(key) && seen.size >= d.config.discoveryMaxOffers) {
            truncated = true;
            diagnostics.push('OFFER_LIMIT');
            continue;
          }
          seen.add(key);
          const existing = unique.get(key);
          if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(offer)) {
            unique.delete(key);
            conflicts.add(key);
            diagnostics.push('CONFLICTING_OFFER');
            continue;
          }
          unique.set(key, offer);
        }
      }
      return { offers: [...unique.values()], diagnostics, truncated };
    } finally {
      scans.delete(controller);
    }
  }
  function close(): Promise<void> {
    if (closePromise !== undefined) return closePromise;
    closed = true;
    for (const controller of scans) controller.abort();
    closePromise = (async () => {
      await startPromise?.catch(() => undefined);
      await Promise.all([...responders.values()].map((responder) => responder.close()));
      responders.clear();
      published.clear();
      await endpoint.close();
      await receiver.close();
      executor.close();
    })();
    return closePromise;
  }
  return {
    localUpgradeServer: endpoint.localUpgradeServer,
    servePublicLocator: endpoint.servePublicLocator,
    publishCampaign,
    start,
    discover,
    close,
    diagnostics: () => [...diagnosticCodes],
  };
}
