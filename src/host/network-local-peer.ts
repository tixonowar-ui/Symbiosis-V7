import type Database from 'better-sqlite3';
import type {
  LocalNetworkScope,
  LocalNetworkOutbox,
  LocalNetworkApplication,
  NetworkStoreGuard,
} from '../persistence/network-local-application.js';
import {
  readLocalNetworkApplication,
  readLocalNetworkHostPin,
  commitLocalNetworkHostPin,
} from '../persistence/network-local-application.js';
import { readOwnedLocalNetworkTab } from '../persistence/network-local-tab.js';
import { loadNetworkInstallation } from './network-installation.js';
import { parseCampaignLanAddress, type CampaignLanAddress } from './campaign-lan-address.js';
import {
  connectCampaignPeerChannel,
  CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
  type CampaignPeerClientChannel,
} from './campaign-peer-channel.js';
import { validatePeerCampaignHeader } from './campaign-peer-handshake.js';
import {
  canonicalPostSaveJson,
  postSaveSha256,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import {
  encodeDeviceAdmissionPeerCommand,
  decodeDeviceAdmissionPeerCommand,
  type DeviceAdmissionPeerCommand,
} from './device-admission-peer-commands.js';
import {
  decodeDeviceAdmissionPeerResponse,
  type DeviceAdmissionPeerResponse,
} from './device-admission-peer-response.js';
import type { NetworkApplicationConfig } from './network-application-config.js';
import type { NetworkPublicErrorCode } from '../shared/network-application.js';

export class LocalNetworkPeerError extends Error {
  constructor(readonly code: NetworkPublicErrorCode) {
    super(`local network peer: ${code}`);
  }
}
const fail = (code: NetworkPublicErrorCode): never => {
  throw new LocalNetworkPeerError(code);
};

/** Public locator reads do not create a session and are never a substitute for the signed challenge. */
export async function readManualCampaignLocator(
  target: CampaignLanAddress,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const checked = parseCampaignLanAddress(target.canonicalOrigin);
  if (
    checked.canonicalOrigin !== target.canonicalOrigin ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  )
    return fail('INVALID_ADDRESS');
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(new URL('/campaign-locator', checked.canonicalOrigin), {
      redirect: 'error',
      signal:
        signal === undefined
          ? AbortSignal.timeout(timeoutMs)
          : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (response.status !== 200 || response.body === null) return fail('CAMPAIGN_UNAVAILABLE');
    reader = response.body.getReader();
    const parts: Buffer[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > CAMPAIGN_PEER_CHANNEL_MAX_BYTES) return fail('CAMPAIGN_UNAVAILABLE');
      parts.push(Buffer.from(chunk.value));
    }
    const buffer = Buffer.concat(parts),
      text = buffer.toString('utf8');
    if (!Buffer.from(text).equals(buffer)) return fail('CAMPAIGN_UNAVAILABLE');
    const raw: unknown = JSON.parse(text);
    if (
      raw === null ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      canonicalPostSaveJson(raw) !== text
    )
      return fail('CAMPAIGN_UNAVAILABLE');
    const r = raw as Record<string, unknown>;
    if (
      Object.keys(r).sort().join(' ') !== 'campaigns protocolVersion' ||
      r['protocolVersion'] !== 3 ||
      !Array.isArray(r['campaigns'])
    )
      return fail('CAMPAIGN_UNAVAILABLE');
    const headers = r['campaigns'].map(validatePeerCampaignHeader);
    if (new Set(headers.map((h) => h.campaignId)).size !== headers.length)
      return fail('AMBIGUOUS_CAMPAIGN');
    if (headers.length === 0) return fail('CAMPAIGN_UNAVAILABLE');
    if (headers.length !== 1) return fail('AMBIGUOUS_CAMPAIGN');
    return headers[0]!.campaignId;
  } catch (error: unknown) {
    if (error instanceof LocalNetworkPeerError) throw new LocalNetworkPeerError(error.code);
    return fail('PEER_UNAVAILABLE');
  } finally {
    try {
      await reader?.cancel();
    } catch {
      /* The bounded read already has a safe result. */
    }
  }
}

/** Own Node client only. The browser receives neither peer keys nor original FINAL witnesses. */
export function createLocalNetworkPeer(d: {
  readonly database: Database.Database;
  readonly baseline: LocalCharacterExportBaseline;
  readonly config: NetworkApplicationConfig;
}) {
  const channels = new Map<
    string,
    { target: CampaignLanAddress; channel: CampaignPeerClientChannel }
  >();
  const connecting = new Map<string, AbortController>();
  const limits = {
    maxSubmitBodyBytes: d.config.transfer.maxSubmitBodyBytes,
    maxWitnessBytes: d.config.transfer.maxWitnessBytes,
    maxChunkBytes: d.config.transfer.maxChunkBytes,
  };
  let closed = false;
  const owned = (scope: LocalNetworkScope) => {
    if (closed) return fail('PEER_UNAVAILABLE');
    const material = loadNetworkInstallation(d.database);
    if (material.ownerDeviceId !== scope.ownerDeviceId) return fail('PEER_UNAVAILABLE');
    return material;
  };
  function closeScope(networkScopeId: string) {
    connecting.get(networkScopeId)?.abort();
    connecting.delete(networkScopeId);
    channels.get(networkScopeId)?.channel.close();
    channels.delete(networkScopeId);
  }
  async function connect(
    scope: LocalNetworkScope,
    target: CampaignLanAddress,
    campaignId: string,
    pinGuard: NetworkStoreGuard<LocalNetworkApplication> | null,
    signal: AbortSignal,
  ) {
    const material = owned(scope);
    readLocalNetworkApplication(d.database, scope);
    const pin = readLocalNetworkHostPin(d.database, scope.ownerDeviceId, campaignId);
    if (pin === null && pinGuard === null) return fail('HOST_IDENTITY_CHANGED');
    let channel: CampaignPeerClientChannel | null = null;
    try {
      channel = await connectCampaignPeerChannel({
        target,
        campaignId,
        deviceMaterial: material,
        hostTrust:
          pin === null
            ? { kind: 'FIRST_EXPLICIT_CONNECT' }
            : { kind: 'PINNED', identity: pin.identity },
        limits: d.config.channel,
        signal,
      });
      owned(scope);
      if (signal.aborted) return fail('PEER_UNAVAILABLE');
      if (channel.campaign.baselineVersion !== d.baseline.baselineVersion)
        return fail('INCOMPATIBLE_BASELINE');
      if (channel.needsHostPin) {
        if (pinGuard === null) return fail('HOST_IDENTITY_CHANGED');
        const tab = readOwnedLocalNetworkTab(d.database, scope.ownerDeviceId, scope.networkScopeId);
        if (tab === null) return fail('PEER_UNAVAILABLE');
        const saved = commitLocalNetworkHostPin(
          d.database,
          scope,
          {
            ownerDeviceId: scope.ownerDeviceId,
            campaignId,
            identity: channel.hostIdentity,
            initialCanonicalOrigin: target.canonicalOrigin,
            entryCommandId: tab.entryCommandId,
          },
          pinGuard,
        );
        channel.confirmHostPin(saved.identity);
      }
      channels.set(scope.networkScopeId, { target, channel });
      return channel;
    } catch (error: unknown) {
      channel?.close();
      if (error instanceof LocalNetworkPeerError) throw new LocalNetworkPeerError(error.code);
      return fail('PEER_UNAVAILABLE');
    }
  }
  function live(scope: LocalNetworkScope): CampaignPeerClientChannel {
    owned(scope);
    const c = channels.get(scope.networkScopeId)?.channel;
    return c !== undefined && !c.closed ? c : fail('PEER_UNAVAILABLE');
  }
  async function call(
    scope: LocalNetworkScope,
    command: DeviceAdmissionPeerCommand,
  ): Promise<DeviceAdmissionPeerResponse> {
    const channel = live(scope);
    try {
      const response = decodeDeviceAdmissionPeerResponse(
        await channel.call(encodeDeviceAdmissionPeerCommand(command, limits)),
      );
      owned(scope);
      if (response.operation !== command.operation) return fail('UNCONFIRMED_OUTCOME');
      return response;
    } catch {
      return fail('UNCONFIRMED_OUTCOME');
    }
  }
  return {
    async open(
      scope: LocalNetworkScope,
      address: string,
      selectedCampaignIdOrNull: string | null,
      guard: NetworkStoreGuard<LocalNetworkApplication>,
    ) {
      owned(scope);
      let target: CampaignLanAddress;
      try {
        target = parseCampaignLanAddress(address);
      } catch {
        return fail('INVALID_ADDRESS');
      }
      if (
        target.campaignId !== null &&
        selectedCampaignIdOrNull !== null &&
        target.campaignId !== selectedCampaignIdOrNull
      )
        return fail('INVALID_ADDRESS');
      closeScope(scope.networkScopeId);
      const controller = new AbortController();
      connecting.set(scope.networkScopeId, controller);
      try {
        const campaignId =
          selectedCampaignIdOrNull ??
          target.campaignId ??
          (await readManualCampaignLocator(
            target,
            d.config.channel.handshakeTimeoutMs,
            controller.signal,
          ));
        if (controller.signal.aborted) return fail('PEER_UNAVAILABLE');
        return await connect(scope, target, campaignId, guard, controller.signal);
      } finally {
        if (connecting.get(scope.networkScopeId) === controller)
          connecting.delete(scope.networkScopeId);
      }
    },
    async reconnect(scope: LocalNetworkScope, address: string, campaignId: string) {
      owned(scope);
      let target: CampaignLanAddress;
      try {
        target = parseCampaignLanAddress(address);
      } catch {
        return fail('INVALID_ADDRESS');
      }
      closeScope(scope.networkScopeId);
      const controller = new AbortController();
      connecting.set(scope.networkScopeId, controller);
      try {
        return await connect(scope, target, campaignId, null, controller.signal);
      } finally {
        if (connecting.get(scope.networkScopeId) === controller)
          connecting.delete(scope.networkScopeId);
      }
    },
    current(networkScopeId: string) {
      const c = channels.get(networkScopeId)?.channel;
      return c !== undefined && !c.closed ? c : null;
    },
    call,
    async deliver(
      scope: LocalNetworkScope,
      outbox: LocalNetworkOutbox,
    ): Promise<DeviceAdmissionPeerResponse> {
      if (
        outbox.ownerDeviceId !== scope.ownerDeviceId ||
        outbox.networkScopeId !== scope.networkScopeId
      )
        return fail('PEER_UNAVAILABLE');
      const intent = outbox.intent;
      if (intent.operation !== 'SUBMIT') {
        const command = decodeDeviceAdmissionPeerCommand(intent.semanticBodyJson, limits);
        if (
          command.operation !==
            (intent.operation === 'OPEN' ? 'CONNECTION_OPEN' : 'DEVICE_REQUEST_CANCEL') ||
          command.commandId !== intent.commandId
        )
          return fail('UNCONFIRMED_OUTCOME');
        return call(scope, command);
      }
      const body = Buffer.from(canonicalPostSaveJson(intent.batch), 'utf8');
      if (body.length > limits.maxSubmitBodyBytes) return fail('UNCONFIRMED_OUTCOME');
      const batch = intent.batch;
      const begin = await call(scope, {
        schemaVersion: 1,
        operation: 'DEVICE_REQUEST_BEGIN',
        commandId: intent.commandId,
        requestId: intent.requestId,
        technicalSessionId: batch.technicalSessionId,
        connectionRevision: batch.connectionRevision,
        campaignCheckpointSha256: batch.campaignProof.checkpointSha256,
        candidates: batch.candidates.map((c) => ({
          descriptor: c.descriptor,
          witnessSha256: c.witnessSha256,
          witnessByteLength: c.byteLength,
        })),
        submitBodySha256: postSaveSha256(body),
        submitBodyByteLength: body.length,
      });
      if (begin.outcome !== 'TRANSFER_READY') return begin;
      if (begin.nextChunkIndex !== 0 || begin.receivedBytes !== 0)
        return fail('UNCONFIRMED_OUTCOME');
      let index = 0,
        offset = 0;
      while (offset < body.length) {
        const chunk = body.subarray(offset, offset + limits.maxChunkBytes);
        const response = await call(scope, {
          schemaVersion: 1,
          operation: 'DEVICE_REQUEST_CHUNK',
          transferId: begin.transferId,
          chunkIndex: index,
          bytesBase64: chunk.toString('base64'),
        });
        if (response.outcome !== 'CHUNK_ACCEPTED') return response;
        offset += chunk.length;
        if (
          response.transferId !== begin.transferId ||
          response.chunkIndex !== index ||
          response.nextChunkIndex !== index + 1 ||
          response.receivedBytes !== offset
        )
          return fail('UNCONFIRMED_OUTCOME');
        index++;
      }
      return call(scope, {
        schemaVersion: 1,
        operation: 'DEVICE_REQUEST_COMMIT',
        transferId: begin.transferId,
      });
    },
    async recover(
      scope: LocalNetworkScope,
      outbox: LocalNetworkOutbox,
    ): Promise<DeviceAdmissionPeerResponse> {
      const intent = outbox.intent;
      if (
        outbox.ownerDeviceId !== scope.ownerDeviceId ||
        outbox.networkScopeId !== scope.networkScopeId
      )
        return fail('PEER_UNAVAILABLE');
      if (intent.operation === 'OPEN')
        return call(scope, {
          schemaVersion: 1,
          operation: 'CONNECTION_RECOVER',
          commandId: intent.commandId,
          attemptId: intent.attemptId,
          semanticBodySha256: outbox.semanticBodySha256,
        });
      const current = readLocalNetworkApplication(d.database, scope);
      const submitCommandId =
        intent.operation === 'SUBMIT' ? intent.commandId : current.requestOrNull?.submitCommandId;
      if (submitCommandId === undefined) return fail('UNCONFIRMED_OUTCOME');
      return call(scope, {
        schemaVersion: 1,
        operation: 'DEVICE_REQUEST_RECOVER',
        requestId: intent.requestId,
        technicalSessionId:
          intent.operation === 'SUBMIT'
            ? intent.batch.technicalSessionId
            : intent.technicalSessionId,
        submitCommandId,
      });
    },
    closeScope,
    close() {
      if (closed) return;
      closed = true;
      for (const id of new Set([...channels.keys(), ...connecting.keys()])) closeScope(id);
    },
  };
}
