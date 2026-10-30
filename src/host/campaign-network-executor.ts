import { Buffer } from 'node:buffer';
import { types } from 'node:util';
import type { CampaignPeerServerChannel } from './campaign-peer-channel.js';
import { validateCampaignPeerPublicIdentity } from './campaign-peer-identity.js';
import { validatePeerCampaignHeader } from './campaign-peer-handshake.js';

export type CampaignNetworkExecutionScope = {
  readonly kind: 'ATTEMPT' | 'SESSION';
  readonly id: string;
};
/** Opaque runtime handles: matching public fields do not manufacture a registered channel/lease. */
export interface CampaignNetworkExecutionChannel {
  readonly campaignId: string;
  readonly peerDeviceId: string;
  readonly peerKeyFingerprintSha256: string;
}
export interface CampaignNetworkExecutionLease extends CampaignNetworkExecutionChannel {
  readonly scope: CampaignNetworkExecutionScope;
  readonly generation: number;
}
export type CampaignNetworkExecutorErrorCode =
  | 'INVALID_CONFIG'
  | 'SCOPE_LIMIT'
  | 'INVALID_CHANNEL'
  | 'INVALID_SCOPE'
  | 'STALE_GENERATION'
  | 'INVALID_TRANSFER'
  | 'REVOCATION_FAILED'
  | 'EXECUTION_FAILED'
  | 'CLOSED';
export class CampaignNetworkExecutorError extends Error {
  constructor(readonly code: CampaignNetworkExecutorErrorCode) {
    super(`campaign network executor: ${code}`);
  }
}
export interface CampaignNetworkExecutorOptions {
  readonly maxScopes: number;
  /** UTF-8 bytes of canonical scope keys, not an estimate of JavaScript heap/RSS. */
  readonly maxScopeBytes: number;
}
interface ChannelRecord {
  readonly value: CampaignNetworkExecutionChannel;
  readonly channel: CampaignPeerServerChannel;
  readonly leases: Set<LeaseRecord>;
  readonly ordinal: number;
  revoked: boolean;
}
interface ScopeRecord {
  generation: number;
  current: LeaseRecord | null;
  readonly retired: WeakSet<ChannelRecord>;
  retiring: boolean;
  recoveryBarrier: number;
}
interface LeaseRecord {
  readonly value: CampaignNetworkExecutionLease;
  readonly owner: ChannelRecord;
  readonly scope: ScopeRecord;
  readonly transfers: Map<string, { readonly onRevoke: () => void }>;
  revoked: boolean;
}
const fail = (code: CampaignNetworkExecutorErrorCode): never => {
  throw new CampaignNetworkExecutorError(code);
};
function consumePromise(value: unknown): boolean {
  if (!types.isPromise(value)) return false;
  try {
    void Promise.prototype.then.call(
      value,
      () => undefined,
      () => undefined,
    );
  } catch {
    /* Trusted callbacks are not a Promise-constructor sandbox. */
  }
  return true;
}
function scopeAt(value: CampaignNetworkExecutionScope): CampaignNetworkExecutionScope {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      Reflect.ownKeys(value).length !== 2 ||
      ['kind', 'id'].some(
        (key) =>
          descriptors[key] === undefined ||
          !descriptors[key].enumerable ||
          !Object.hasOwn(descriptors[key], 'value'),
      )
    )
      return fail('INVALID_SCOPE');
    const kind: unknown = descriptors['kind'].value;
    const id: unknown = descriptors['id'].value;
    if ((kind !== 'ATTEMPT' && kind !== 'SESSION') || typeof id !== 'string' || id.length === 0)
      return fail('INVALID_SCOPE');
    return Object.freeze({ kind, id });
  } catch {
    return fail('INVALID_SCOPE');
  }
}

/** RAM transport fencing only. Durable source/peer ownership and journals remain storage guards. */
export function createCampaignNetworkExecutor(options: CampaignNetworkExecutorOptions) {
  let limits: CampaignNetworkExecutorOptions;
  try {
    const keys = ['maxScopes', 'maxScopeBytes'],
      descriptors = Object.getOwnPropertyDescriptors(options);
    if (
      (Object.getPrototypeOf(options) !== Object.prototype &&
        Object.getPrototypeOf(options) !== null) ||
      Reflect.ownKeys(options).length !== keys.length ||
      keys.some((key) => {
        const d = descriptors[key];
        return (
          d === undefined ||
          !d.enumerable ||
          !Object.hasOwn(d, 'value') ||
          typeof d.value !== 'number' ||
          !Number.isSafeInteger(d.value) ||
          d.value <= 0
        );
      })
    )
      return fail('INVALID_CONFIG');
    limits = Object.freeze({ maxScopes: options.maxScopes, maxScopeBytes: options.maxScopeBytes });
  } catch {
    return fail('INVALID_CONFIG');
  }
  const channels = new WeakMap<CampaignNetworkExecutionChannel, ChannelRecord>();
  const nativeChannels = new WeakMap<CampaignPeerServerChannel, ChannelRecord>();
  const registered = new Set<ChannelRecord>();
  const leases = new WeakMap<CampaignNetworkExecutionLease, LeaseRecord>();
  const scopes = new Map<string, ScopeRecord>();
  const queues = new Map<string, Promise<void>>();
  let closed = false;
  let channelOrdinal = 0;
  let scopeBytes = 0;
  const live = (owner: ChannelRecord): void => {
    if (closed) return fail('CLOSED');
    try {
      if (owner.revoked || owner.channel.closed) return fail('INVALID_CHANNEL');
    } catch {
      return fail('INVALID_CHANNEL');
    }
  };
  const channelAt = (value: CampaignNetworkExecutionChannel): ChannelRecord => {
    const owner = channels.get(value);
    if (owner === undefined) return fail('INVALID_CHANNEL');
    live(owner);
    return owner;
  };
  function assertCurrent(value: CampaignNetworkExecutionLease): void {
    if (closed) return fail('CLOSED');
    const lease = leases.get(value);
    if (lease === undefined) return fail('STALE_GENERATION');
    live(lease.owner);
    if (
      lease.revoked ||
      lease.scope.current !== lease ||
      lease.scope.generation !== value.generation
    )
      return fail('STALE_GENERATION');
  }
  function revoke(lease: LeaseRecord): boolean {
    if (lease.revoked) return false;
    lease.revoked = true;
    lease.owner.leases.delete(lease);
    let failed = false;
    const callbacks = [...lease.transfers.values()];
    lease.transfers.clear();
    for (const { onRevoke: callback } of callbacks) {
      try {
        const result: unknown = callback();
        if (
          consumePromise(result) ||
          (result !== null && (typeof result === 'object' || typeof result === 'function'))
        ) {
          failed = true;
        }
      } catch (error: unknown) {
        consumePromise(error);
        failed = true;
      }
    }
    return failed;
  }
  function registerChannel(channel: CampaignPeerServerChannel): CampaignNetworkExecutionChannel {
    if (closed) return fail('CLOSED');
    try {
      const prior = nativeChannels.get(channel);
      if (prior !== undefined) {
        live(prior);
        return prior.value;
      }
      if (
        channel.closed ||
        typeof channel.close !== 'function' ||
        typeof channel.receiveRequest !== 'function' ||
        typeof channel.respond !== 'function'
      )
        return fail('INVALID_CHANNEL');
      const peer = validateCampaignPeerPublicIdentity(channel.deviceIdentity);
      validateCampaignPeerPublicIdentity(channel.hostIdentity);
      const campaign = validatePeerCampaignHeader(channel.campaign);
      const value = Object.freeze({
        campaignId: campaign.campaignId,
        peerDeviceId: peer.ownerDeviceId,
        peerKeyFingerprintSha256: peer.keyFingerprintSha256,
      });
      if (channelOrdinal === Number.MAX_SAFE_INTEGER) return fail('INVALID_CHANNEL');
      const owner: ChannelRecord = {
        value,
        channel,
        leases: new Set(),
        ordinal: ++channelOrdinal,
        revoked: false,
      };
      nativeChannels.set(channel, owner);
      channels.set(value, owner);
      registered.add(owner);
      return value;
    } catch {
      return fail('INVALID_CHANNEL');
    }
  }
  function assign(
    value: CampaignNetworkExecutionChannel,
    rawScope: CampaignNetworkExecutionScope,
    recover: boolean,
  ): CampaignNetworkExecutionLease {
    const owner = channelAt(value),
      scope = scopeAt(rawScope);
    const key = JSON.stringify([
      value.campaignId,
      value.peerDeviceId,
      value.peerKeyFingerprintSha256,
      scope.kind,
      scope.id,
    ]);
    let state = scopes.get(key);
    if (state === undefined) {
      const bytes = Buffer.byteLength(key, 'utf8');
      if (scopes.size >= limits.maxScopes || bytes > limits.maxScopeBytes - scopeBytes)
        return fail('SCOPE_LIMIT');
      state = {
        generation: 0,
        current: null,
        retired: new WeakSet(),
        retiring: false,
        recoveryBarrier: 0,
      };
      scopes.set(key, state);
      scopeBytes += bytes;
    }
    if (
      state.retiring ||
      state.retired.has(owner) ||
      (state.current?.owner !== owner && owner.ordinal <= state.recoveryBarrier)
    )
      return fail('STALE_GENERATION');
    if (state.current?.owner === owner && !state.current.revoked) {
      assertCurrent(state.current.value);
      return state.current.value;
    }
    if (!recover && state.generation !== 0) return fail('STALE_GENERATION');
    if (state.generation === Number.MAX_SAFE_INTEGER) return fail('STALE_GENERATION');
    const previous = state.current;
    state.generation += 1;
    // Cover old physical channels even when their delayed first operation has not bound this scope.
    if (recover) state.recoveryBarrier = channelOrdinal;
    state.current = null;
    if (previous !== null) {
      state.retired.add(previous.owner);
      state.retiring = true;
      let failed: boolean;
      try {
        failed = revoke(previous);
      } finally {
        state.retiring = false;
      }
      if (failed) return fail('REVOCATION_FAILED');
    }
    const result = Object.freeze({ ...value, scope, generation: state.generation });
    const lease: LeaseRecord = {
      value: result,
      owner,
      scope: state,
      transfers: new Map(),
      revoked: false,
    };
    state.current = lease;
    owner.leases.add(lease);
    leases.set(result, lease);
    return result;
  }
  function trackTransfer(
    value: CampaignNetworkExecutionLease,
    transferId: string,
    onRevoke: () => void,
  ): () => void {
    assertCurrent(value);
    if (typeof transferId !== 'string' || transferId.length === 0 || typeof onRevoke !== 'function')
      return fail('INVALID_TRANSFER');
    const lease = leases.get(value)!;
    if (lease.transfers.has(transferId)) return fail('INVALID_TRANSFER');
    const registration = { onRevoke };
    lease.transfers.set(transferId, registration);
    return () => {
      if (lease.transfers.get(transferId) === registration) lease.transfers.delete(transferId);
    };
  }
  function closeChannel(value: CampaignNetworkExecutionChannel): void {
    const owner = channels.get(value);
    if (owner === undefined) return fail('INVALID_CHANNEL');
    if (owner.revoked) return;
    owner.revoked = true;
    registered.delete(owner);
    let failed = false;
    for (const lease of [...owner.leases]) {
      lease.scope.retired.add(owner);
      if (revoke(lease)) failed = true;
    }
    try {
      const result: unknown = owner.channel.close();
      if (result !== undefined) {
        consumePromise(result);
        failed = true;
      }
    } catch (error: unknown) {
      consumePromise(error);
      failed = true;
    }
    // Every old opaque handle is revoked; a future transport cannot use any old barrier.
    if (registered.size === 0) {
      scopes.clear();
      scopeBytes = 0;
    }
    if (failed) return fail('REVOCATION_FAILED');
  }
  function run<T>(
    value: CampaignNetworkExecutionChannel,
    execute: () => T | Promise<T>,
  ): Promise<T> {
    let owner: ChannelRecord;
    try {
      owner = channelAt(value);
      if (typeof execute !== 'function')
        return Promise.reject(new CampaignNetworkExecutorError('EXECUTION_FAILED'));
    } catch {
      return Promise.reject(
        new CampaignNetworkExecutorError(closed ? 'CLOSED' : 'INVALID_CHANNEL'),
      );
    }
    const prior = queues.get(value.campaignId) ?? Promise.resolve();
    const pending = prior.then(async () => {
      live(owner);
      try {
        const result = execute();
        if (types.isPromise(result)) return await result;
        // Do not trigger a caller-owned then getter through Promise resolution.
        if (
          result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          'then' in result
        )
          return fail('EXECUTION_FAILED');
        return result;
      } catch (error: unknown) {
        consumePromise(error);
        return fail('EXECUTION_FAILED');
      }
    });
    const tail = pending.then(
      () => undefined,
      () => undefined,
    );
    queues.set(value.campaignId, tail);
    void tail.then(() => {
      if (queues.get(value.campaignId) === tail) queues.delete(value.campaignId);
    });
    return pending;
  }
  function close(): void {
    if (closed) return;
    closed = true;
    let failed = false;
    for (const owner of [...registered])
      try {
        closeChannel(owner.value);
      } catch {
        failed = true;
      }
    scopes.clear();
    scopeBytes = 0;
    queues.clear();
    if (failed) return fail('REVOCATION_FAILED');
  }
  return Object.freeze({
    registerChannel,
    run,
    bindScope: (channel: CampaignNetworkExecutionChannel, scope: CampaignNetworkExecutionScope) =>
      assign(channel, scope, false),
    recoverScope: (
      channel: CampaignNetworkExecutionChannel,
      scope: CampaignNetworkExecutionScope,
    ) => assign(channel, scope, true),
    assertCurrent,
    trackTransfer,
    closeChannel,
    close,
  });
}
