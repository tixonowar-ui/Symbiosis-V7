import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';
import { isIP } from 'node:net';
import { types } from 'node:util';
import { parseCampaignLanAddress } from './campaign-lan-address.js';
import { validatePeerCampaignHeader, type PeerCampaignHeader } from './campaign-peer-handshake.js';
import { canonicalPostSaveJson } from './local-character-export.js';

export interface DiscoveredCampaign {
  readonly origin: string;
  readonly campaign: PeerCampaignHeader;
}
export type CampaignDiscoveryDiagnostic =
  | 'INVALID_PACKET'
  | 'QUERY_MISMATCH'
  | 'OFFER_TOO_LARGE'
  | 'CONFLICTING_OFFER'
  | 'OFFER_LIMIT'
  | 'SOURCE_UNAVAILABLE'
  | 'SEND_FAILED';
export class CampaignDiscoveryError extends Error {
  constructor(readonly code: 'INVALID_CONFIG' | 'TRANSPORT_UNAVAILABLE' | 'CANCELLED') {
    super(`campaign discovery: ${code}`);
  }
}
export interface CampaignDiscoveryResponderOptions {
  readonly bindAddress: string;
  readonly port: number;
  readonly multicastGroup: string | null;
  readonly multicastInterface: string | null;
  readonly maxPacketBytes: number;
  readonly readOffers: () => readonly DiscoveredCampaign[];
  readonly onDiagnostic: (code: CampaignDiscoveryDiagnostic) => void;
}
export interface CampaignDiscoveryScanOptions {
  readonly bindAddress: string;
  readonly destinationAddress: string;
  readonly destinationPort: number;
  readonly windowMs: number;
  readonly maxPacketBytes: number;
  readonly maxOffers: number;
  readonly signal?: AbortSignal;
}
export interface CampaignDiscoveryScan {
  readonly offers: readonly DiscoveredCampaign[];
  readonly diagnostics: readonly CampaignDiscoveryDiagnostic[];
  readonly truncated: boolean;
}
type Query = {
  readonly protocolVersion: 3;
  readonly messageType: 'network.discovery.query';
  readonly queryId: string;
};
type Offer = {
  readonly protocolVersion: 3;
  readonly messageType: 'network.discovery.offer';
  readonly queryId: string;
  readonly offer: DiscoveredCampaign;
};
const fail = (code: CampaignDiscoveryError['code']): never => {
  throw new CampaignDiscoveryError(code);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
// Technical UDP4 packet budget, deliberately below the maximum IP packet payload.
const MAX_PACKET_BYTES = 60 * 1024;
function consumeNativePromise(value: unknown): boolean {
  if (!types.isPromise(value)) return false;
  try {
    void Promise.prototype.then.call(
      value,
      () => undefined,
      () => undefined,
    );
  } catch {
    // These callbacks are trusted code, not an adversarial Promise-constructor sandbox.
  }
  return true;
}
function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fail('INVALID_CONFIG');
}
function privateIpv4(value: string): string {
  if (isIP(value) !== 4) return fail('INVALID_CONFIG');
  try {
    return parseCampaignLanAddress(`http://${value}:1`).host;
  } catch {
    return fail('INVALID_CONFIG');
  }
}
function group(value: string): boolean {
  return isIP(value) === 4 && value.split('.')[0] === '239';
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail('INVALID_CONFIG');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some(
      (key) =>
        descriptors[key] === undefined ||
        !Object.hasOwn(descriptors[key], 'value') ||
        !descriptors[key].enumerable,
    )
  )
    return fail('INVALID_CONFIG');
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value as unknown]));
}
function offer(value: unknown): DiscoveredCampaign {
  const row = record(value, ['origin', 'campaign']);
  if (typeof row['origin'] !== 'string') return fail('INVALID_CONFIG');
  const locator = parseCampaignLanAddress(row['origin']);
  if (locator.campaignId !== null || locator.canonicalOrigin !== row['origin'])
    return fail('INVALID_CONFIG');
  return Object.freeze({
    origin: locator.canonicalOrigin,
    campaign: validatePeerCampaignHeader(row['campaign']),
  });
}
function packet(bytes: Buffer, maximum: number): Query | Offer {
  if (bytes.length > maximum) return fail('INVALID_CONFIG');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) return fail('INVALID_CONFIG');
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== 'object') return fail('INVALID_CONFIG');
  const type: unknown = Reflect.get(value, 'messageType');
  const row = record(
    value,
    type === 'network.discovery.query'
      ? ['protocolVersion', 'messageType', 'queryId']
      : ['protocolVersion', 'messageType', 'queryId', 'offer'],
  );
  if (
    row['protocolVersion'] !== 3 ||
    typeof row['queryId'] !== 'string' ||
    !UUID.test(row['queryId'])
  )
    return fail('INVALID_CONFIG');
  let result: Query | Offer;
  if (type === 'network.discovery.query')
    result = { protocolVersion: 3, messageType: type, queryId: row['queryId'] };
  else if (type === 'network.discovery.offer')
    result = {
      protocolVersion: 3,
      messageType: type,
      queryId: row['queryId'],
      offer: offer(row['offer']),
    };
  else return fail('INVALID_CONFIG');
  if (canonicalPostSaveJson(result) !== text) return fail('INVALID_CONFIG');
  return result;
}
function socketClose(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    try {
      socket.close(() => resolve());
    } catch {
      resolve();
    } // A failed bind has no live socket to release.
  });
}

/** Anonymous public locators only; discovery never grants trust, creates a session or reads a sheet. */
export async function startCampaignDiscoveryResponder(options: CampaignDiscoveryResponderOptions) {
  let bindAddress: string;
  let port: number;
  let maximum: number;
  try {
    bindAddress =
      options.bindAddress === '0.0.0.0' ? options.bindAddress : privateIpv4(options.bindAddress);
    port = integer(options.port, 0, 65535);
    maximum = integer(options.maxPacketBytes, 1, MAX_PACKET_BYTES);
    if (typeof options.readOffers !== 'function' || typeof options.onDiagnostic !== 'function')
      return fail('INVALID_CONFIG');
    if (
      options.multicastGroup === null
        ? options.multicastInterface !== null
        : !group(options.multicastGroup) || options.multicastInterface === null
    )
      return fail('INVALID_CONFIG');
    if (options.multicastInterface !== null) privateIpv4(options.multicastInterface);
  } catch {
    return fail('INVALID_CONFIG');
  }
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  let closePromise: Promise<void> | undefined;
  const close = () => (closePromise ??= socketClose(socket));
  const diagnostic = (code: CampaignDiscoveryDiagnostic) => {
    try {
      const result: unknown = options.onDiagnostic(code);
      // A void callback may legally be async in TypeScript. Revoke before another datagram,
      // without awaiting it or letting a rejected private diagnostic reach the event loop.
      if (consumeNativePromise(result)) void close();
    } catch (error: unknown) {
      consumeNativePromise(error);
      void close();
    } // A failed observer revokes this responder.
  };
  socket.on('error', () => {
    diagnostic('SOURCE_UNAVAILABLE');
    void close();
  });
  socket.on('message', (bytes, source) => {
    if (closePromise !== undefined) return;
    let request: Query;
    try {
      privateIpv4(source.address);
      const decoded = packet(bytes, maximum);
      if (decoded.messageType !== 'network.discovery.query') throw new Error('not a query');
      request = decoded;
    } catch {
      diagnostic('INVALID_PACKET');
      return;
    }
    let offers: readonly DiscoveredCampaign[];
    try {
      const selected: unknown = options.readOffers();
      if (consumeNativePromise(selected)) {
        diagnostic('SOURCE_UNAVAILABLE');
        void close();
        return;
      }
      if (!Array.isArray(selected)) throw new Error('invalid offer source');
      offers = selected as readonly DiscoveredCampaign[];
    } catch (error: unknown) {
      if (consumeNativePromise(error)) void close();
      diagnostic('SOURCE_UNAVAILABLE');
      return;
    }
    for (const candidate of offers) {
      if (closePromise !== undefined) return;
      let encoded: Buffer;
      try {
        const response: Offer = {
          protocolVersion: 3,
          messageType: 'network.discovery.offer',
          queryId: request.queryId,
          offer: offer(candidate),
        };
        encoded = Buffer.from(canonicalPostSaveJson(response));
        if (encoded.length > maximum) {
          diagnostic('OFFER_TOO_LARGE');
          continue;
        }
      } catch {
        diagnostic('SOURCE_UNAVAILABLE');
        continue;
      }
      try {
        socket.send(encoded, source.port, source.address, (error) => {
          if (error !== null) diagnostic('SEND_FAILED');
        });
      } catch {
        diagnostic('SEND_FAILED');
      }
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = () => reject(new CampaignDiscoveryError('TRANSPORT_UNAVAILABLE'));
      socket.once('error', onError);
      socket.bind(port, bindAddress, () => {
        socket.off('error', onError);
        resolve();
      });
    });
    if (options.multicastGroup !== null && options.multicastInterface !== null) {
      socket.addMembership(options.multicastGroup, options.multicastInterface);
      socket.setMulticastTTL(1);
    }
    const address = socket.address();
    return Object.freeze({ address: address.address, port: address.port, close });
  } catch {
    await close();
    return fail('TRANSPORT_UNAVAILABLE');
  }
}

export async function scanCampaignDiscovery(
  options: CampaignDiscoveryScanOptions,
): Promise<CampaignDiscoveryScan> {
  let bindAddress: string;
  let port: number;
  let maximum: number;
  let windowMs: number;
  let maxOffers: number;
  try {
    bindAddress = privateIpv4(options.bindAddress);
    if (!group(options.destinationAddress)) privateIpv4(options.destinationAddress);
    port = integer(options.destinationPort, 1, 65535);
    maximum = integer(options.maxPacketBytes, 1, MAX_PACKET_BYTES);
    windowMs = integer(options.windowMs, 1, 2 ** 31 - 1);
    maxOffers = integer(options.maxOffers, 1);
  } catch {
    return fail('INVALID_CONFIG');
  }
  if (options.signal?.aborted) return fail('CANCELLED');
  const socket = createSocket('udp4');
  const queryId = randomUUID();
  const query: Query = { protocolVersion: 3, messageType: 'network.discovery.query', queryId };
  const encoded = Buffer.from(canonicalPostSaveJson(query));
  if (encoded.length > maximum) {
    await socketClose(socket);
    return fail('INVALID_CONFIG');
  }
  const offers = new Map<string, DiscoveredCampaign>();
  const blocked = new Set<string>();
  const seen = new Set<string>();
  const diagnostics = new Set<CampaignDiscoveryDiagnostic>();
  let truncated = false;
  try {
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = (error?: CampaignDiscoveryError) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancelled);
        if (error === undefined) resolve();
        else reject(error);
      };
      const cancelled = () => finish(new CampaignDiscoveryError('CANCELLED'));
      options.signal?.addEventListener('abort', cancelled, { once: true });
      socket.on('error', () => finish(new CampaignDiscoveryError('TRANSPORT_UNAVAILABLE')));
      socket.on('message', (bytes, source) => {
        if (settled) return;
        let response: Offer;
        try {
          privateIpv4(source.address);
          const decoded = packet(bytes, maximum);
          if (decoded.messageType !== 'network.discovery.offer') throw new Error('not an offer');
          if (decoded.queryId !== queryId) {
            diagnostics.add('QUERY_MISMATCH');
            return;
          }
          response = decoded;
        } catch {
          diagnostics.add('INVALID_PACKET');
          return;
        }
        const key = `${response.offer.origin}/${response.offer.campaign.campaignId}`;
        if (blocked.has(key)) return;
        const existing = offers.get(key);
        if (existing !== undefined) {
          if (canonicalPostSaveJson(existing) !== canonicalPostSaveJson(response.offer)) {
            offers.delete(key);
            blocked.add(key);
            diagnostics.add('CONFLICTING_OFFER');
          }
          return;
        }
        if (!seen.has(key) && seen.size >= maxOffers) {
          truncated = true;
          diagnostics.add('OFFER_LIMIT');
          return;
        }
        seen.add(key);
        offers.set(key, response.offer);
      });
      socket.bind(0, bindAddress, () => {
        try {
          if (settled) return;
          if (group(options.destinationAddress)) {
            socket.setMulticastInterface(bindAddress);
            socket.setMulticastTTL(1);
          }
          socket.send(encoded, port, options.destinationAddress, (error) => {
            if (settled) return;
            if (error !== null) {
              finish(new CampaignDiscoveryError('TRANSPORT_UNAVAILABLE'));
              return;
            }
            timer = setTimeout(() => finish(), windowMs);
          });
        } catch {
          finish(new CampaignDiscoveryError('TRANSPORT_UNAVAILABLE'));
        }
      });
    });
    return Object.freeze({
      offers: Object.freeze(
        [...offers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, value]) => value),
      ),
      diagnostics: Object.freeze([...diagnostics].sort()),
      truncated,
    });
  } finally {
    await socketClose(socket);
  }
}
