import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CampaignPeerChannelLimits } from './campaign-peer-channel.js';
import type { DeviceAdmissionPeerCommandLimits } from './device-admission-peer-commands.js';

export interface NetworkApplicationConfig {
  readonly discoveryGroup: string;
  readonly discoveryPort: number;
  readonly discoveryWindowMs: number;
  readonly discoveryMaxOffers: number;
  readonly discoveryMaxPacketBytes: number;
  readonly channel: CampaignPeerChannelLimits;
  readonly executor: { readonly maxScopes: number; readonly maxScopeBytes: number };
  readonly transfer: DeviceAdmissionPeerCommandLimits & {
    readonly timeoutMs: number;
    readonly maxActiveTransfers: number;
    readonly maxStagedBytes: number;
    readonly maxChannels: number;
  };
}

/** ADR 0066: engineering resource budgets, independent of character/campaign rules. */
export async function loadNetworkApplicationConfig(
  projectRoot: string,
): Promise<NetworkApplicationConfig> {
  const source: unknown = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const fail = (): never => {
    throw new TypeError('Invalid network application configuration');
  };
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return fail();
  const config: unknown = (source as Record<string, unknown>)['config'];
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return fail();
  const values = config as Record<string, unknown>;
  const group = values['network_discovery_group'];
  const port = values['network_discovery_port'];
  if (
    typeof group !== 'string' ||
    !/^239\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})$/u.test(group) ||
    group.split('.').some((v) => Number(v) > 255) ||
    typeof port !== 'string' ||
    !/^[1-9][0-9]{0,4}$/u.test(port) ||
    Number(port) > 65535
  )
    return fail();
  return Object.freeze({
    discoveryGroup: group,
    discoveryPort: Number(port),
    discoveryWindowMs: 1200,
    discoveryMaxOffers: 64,
    discoveryMaxPacketBytes: 4096,
    channel: Object.freeze({
      handshakeTimeoutMs: 10_000,
      rpcTimeoutMs: 10_000,
      maxQueuedFrames: 16,
      maxQueuedBytes: 512 * 1024,
      maxPendingCalls: 8,
    }),
    executor: Object.freeze({ maxScopes: 1024, maxScopeBytes: 8 * 1024 * 1024 }),
    transfer: Object.freeze({
      maxSubmitBodyBytes: 64 * 1024 * 1024,
      maxWitnessBytes: 16 * 1024 * 1024,
      maxChunkBytes: 64 * 1024,
      timeoutMs: 30_000,
      maxActiveTransfers: 8,
      maxStagedBytes: 128 * 1024 * 1024,
      maxChannels: 64,
    }),
  });
}
