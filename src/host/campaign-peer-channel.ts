import { Buffer, isUtf8 } from 'node:buffer';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import WebSocket, { type RawData } from 'ws';
import type { DeviceInstallationIdentityMaterial } from '../persistence/network-installation-identity.js';
import { parseCampaignLanAddress, type CampaignLanAddress } from './campaign-lan-address.js';
import {
  authenticateCampaignPeerChallenge,
  CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES,
  campaignPeerChallengeBodySha256,
  decodeCampaignPeerHandshakeMessage,
  encodeCampaignPeerHandshakeMessage,
  type CampaignPeerChallenge,
  type CampaignPeerHello,
  type PeerCampaignHeader,
  type PeerSignedTranscript,
} from './campaign-peer-handshake.js';
import {
  allocateCampaignPeerNonce,
  campaignPeerPublicIdentity,
  signCampaignPeerTranscript,
  validateCampaignPeerPublicIdentity,
  validateCampaignPeerTranscript,
  validateDeviceInstallationIdentityMaterial,
  verifyCampaignPeerTranscript,
  type CampaignPeerPublicIdentity,
} from './campaign-peer-identity.js';
import { createCampaignPeerProofExchange } from './campaign-peer-proof-exchange.js';
import { canonicalPostSaveJson, postSaveSha256 } from './local-character-export.js';

export const CAMPAIGN_PEER_CHANNEL_MAX_BYTES = CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES;
export interface CampaignPeerChannelLimits {
  readonly handshakeTimeoutMs: number;
  readonly rpcTimeoutMs: number;
  readonly maxQueuedFrames: number;
  readonly maxQueuedBytes: number;
  readonly maxPendingCalls: number;
}
export type CampaignPeerHostTrust =
  | { readonly kind: 'PINNED'; readonly identity: CampaignPeerPublicIdentity }
  | { readonly kind: 'FIRST_EXPLICIT_CONNECT' };
const ERROR_CODES = [
  'INVALID_CONFIG',
  'INVALID_CONNECTION',
  'INVALID_HANDSHAKE',
  'INVALID_RPC',
  'INVALID_STATE',
  'QUEUE_OVERFLOW',
  'TIMEOUT',
  'TRANSPORT_ERROR',
  'CLOSED',
] as const;
export type CampaignPeerChannelErrorCode = (typeof ERROR_CODES)[number];
export class CampaignPeerChannelError extends Error {
  constructor(readonly code: CampaignPeerChannelErrorCode) {
    super(`campaign peer channel: ${code}`);
  }
}
interface PublicPeerChannel {
  readonly hostIdentity: CampaignPeerPublicIdentity;
  readonly deviceIdentity: CampaignPeerPublicIdentity;
  readonly campaign: PeerCampaignHeader;
  readonly closed: boolean;
  close(): void;
}
export interface CampaignPeerClientChannel extends PublicPeerChannel {
  readonly needsHostPin: boolean;
  /** The trusted caller must actually persist this pin before confirming it here. */
  confirmHostPin(identity: CampaignPeerPublicIdentity): void;
  call(bodyJson: string): Promise<string>;
}
export interface CampaignPeerRpcRequest {
  readonly sequenceNumber: number;
  readonly bodyJson: string;
}
export interface CampaignPeerServerChannel extends PublicPeerChannel {
  receiveRequest(): Promise<CampaignPeerRpcRequest>;
  respond(sequenceNumber: number, bodyJson: string): Promise<void>;
}
export interface CampaignPeerConnectOptions {
  readonly target: CampaignLanAddress;
  readonly campaignId: string;
  readonly deviceMaterial: DeviceInstallationIdentityMaterial;
  readonly hostTrust: CampaignPeerHostTrust;
  readonly limits: CampaignPeerChannelLimits;
  readonly signal?: AbortSignal;
}
export interface CampaignPeerAcceptOptions {
  readonly limits: CampaignPeerChannelLimits;
  readonly resolveCampaign: (campaignId: string) => {
    readonly hostMaterial: DeviceInstallationIdentityMaterial;
    readonly campaign: PeerCampaignHeader;
  } | null;
}
const fail = (code: CampaignPeerChannelErrorCode): never => {
  throw new CampaignPeerChannelError(code);
};
function safeError(
  error: unknown,
  fallback: CampaignPeerChannelErrorCode,
): CampaignPeerChannelError {
  // Even a trusted callback's typed error may carry an unrelated message, cause or fields.
  if (error instanceof CampaignPeerChannelError && ERROR_CODES.includes(error.code))
    return new CampaignPeerChannelError(error.code);
  return new CampaignPeerChannelError(fallback);
}
function limits(value: CampaignPeerChannelLimits): CampaignPeerChannelLimits {
  const keys = [
    'handshakeTimeoutMs',
    'rpcTimeoutMs',
    'maxQueuedFrames',
    'maxQueuedBytes',
    'maxPendingCalls',
  ] as const;
  if (keys.some((key) => !Number.isSafeInteger(value[key]) || value[key] <= 0))
    return fail('INVALID_CONFIG');
  // Node timer overflow otherwise silently turns a large configured deadline into 1 ms.
  if (value.handshakeTimeoutMs > 2_147_483_647 || value.rpcTimeoutMs > 2_147_483_647)
    return fail('INVALID_CONFIG');
  return Object.freeze(
    Object.fromEntries(
      keys.map((key) => [key, value[key]]),
    ) as unknown as CampaignPeerChannelLimits,
  );
}
function canonicalBody(value: unknown): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > CAMPAIGN_PEER_CHANNEL_MAX_BYTES
  )
    return fail('INVALID_RPC');
  const parsed: unknown = JSON.parse(value);
  if (canonicalPostSaveJson(parsed) !== value) return fail('INVALID_RPC');
  return value;
}
interface RpcFrame {
  readonly protocolVersion: 3;
  readonly messageType: 'network.peer.rpc.request' | 'network.peer.rpc.response';
  readonly bodyJson: string;
  readonly signed: PeerSignedTranscript;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return fail('INVALID_RPC');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    return fail('INVALID_RPC');
  return row;
}
function rpcFrame(text: string, type: RpcFrame['messageType']): RpcFrame {
  const row = exact(JSON.parse(text) as unknown, [
    'protocolVersion',
    'messageType',
    'bodyJson',
    'signed',
  ]);
  if (row['protocolVersion'] !== 3 || row['messageType'] !== type) return fail('INVALID_RPC');
  const proof = exact(row['signed'], ['transcript', 'signatureBase64']);
  const signature = proof['signatureBase64'];
  if (typeof signature !== 'string') return fail('INVALID_RPC');
  const bytes = Buffer.from(signature, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== signature) return fail('INVALID_RPC');
  const result: RpcFrame = {
    protocolVersion: 3,
    messageType: type,
    bodyJson: canonicalBody(row['bodyJson']),
    signed: {
      transcript: validateCampaignPeerTranscript(proof['transcript']),
      signatureBase64: signature,
    },
  };
  if (canonicalPostSaveJson(result) !== text) return fail('INVALID_RPC');
  return result;
}
function encodeRpc(
  type: RpcFrame['messageType'],
  bodyJson: string,
  signed: PeerSignedTranscript,
): string {
  const text = canonicalPostSaveJson({ protocolVersion: 3, messageType: type, bodyJson, signed });
  if (Buffer.byteLength(text, 'utf8') > CAMPAIGN_PEER_CHANNEL_MAX_BYTES) return fail('INVALID_RPC');
  return text;
}

/** Owns message/error/close for the complete socket lifetime, including handshake handoff. */
class FrameInbox {
  readonly #socket: WebSocket;
  readonly #limits: CampaignPeerChannelLimits;
  readonly #queue: string[] = [];
  readonly #closeListeners = new Set<(error: CampaignPeerChannelError) => void>();
  #queuedBytes = 0;
  #error: CampaignPeerChannelError | null = null;
  #receiver: ((text: string) => void) | null = null;
  #waiter: {
    resolve(text: string): void;
    reject(error: CampaignPeerChannelError): void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  constructor(socket: WebSocket, config: CampaignPeerChannelLimits) {
    this.#socket = socket;
    this.#limits = config;
    socket.on('message', (data: RawData, binary: boolean) => this.#message(data, binary));
    socket.on('error', () => this.close('TRANSPORT_ERROR'));
    socket.on('close', () => this.close('CLOSED'));
  }
  get error(): CampaignPeerChannelError | null {
    return this.#error;
  }
  checked(): void {
    if (this.#error !== null) throw this.#error;
  }
  watchClose(listener: (error: CampaignPeerChannelError) => void): () => void {
    if (this.#error !== null) listener(this.#error);
    else this.#closeListeners.add(listener);
    return () => {
      this.#closeListeners.delete(listener);
    };
  }
  close(code: CampaignPeerChannelErrorCode = 'CLOSED'): void {
    if (this.#error !== null) return;
    this.#error = new CampaignPeerChannelError(code);
    this.#queue.length = 0;
    this.#queuedBytes = 0;
    this.#receiver = null;
    if (this.#waiter !== null) {
      clearTimeout(this.#waiter.timer);
      this.#waiter.reject(this.#error);
      this.#waiter = null;
    }
    for (const listener of this.#closeListeners) listener(this.#error);
    this.#closeListeners.clear();
    // Termination releases resources even when an untrusted peer ignores a close handshake.
    this.#socket.terminate();
  }
  #message(data: RawData, binary: boolean): void {
    if (this.#error !== null) return;
    try {
      const size = Array.isArray(data)
        ? data.reduce((sum, item) => sum + item.length, 0)
        : data.byteLength;
      if (binary || size > CAMPAIGN_PEER_CHANNEL_MAX_BYTES) return this.close('INVALID_RPC');
      const bytes = Array.isArray(data)
        ? Buffer.concat(data, size)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      if (!isUtf8(bytes)) return this.close('INVALID_RPC');
      const text = bytes.toString('utf8');
      if (this.#receiver !== null) return this.#receiver(text);
      if (this.#waiter !== null) {
        const waiter = this.#waiter;
        this.#waiter = null;
        clearTimeout(waiter.timer);
        waiter.resolve(text);
        return;
      }
      if (
        this.#queue.length >= this.#limits.maxQueuedFrames ||
        this.#queuedBytes + size > this.#limits.maxQueuedBytes
      )
        return this.close('QUEUE_OVERFLOW');
      this.#queue.push(text);
      this.#queuedBytes += size;
    } catch {
      this.close('INVALID_RPC');
    }
  }
  opened(): Promise<void> {
    if (this.#error !== null) return Promise.reject(this.#error);
    if (this.#socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close('TIMEOUT'), this.#limits.handshakeTimeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        this.#socket.off('open', opened);
        stop();
      };
      const opened = (): void => {
        cleanup();
        resolve();
      };
      const stop = this.watchClose((error) => {
        cleanup();
        reject(error);
      });
      this.#socket.once('open', opened);
    });
  }
  next(): Promise<string> {
    if (this.#error !== null) return Promise.reject(this.#error);
    if (this.#receiver !== null || this.#waiter !== null) {
      this.close('INVALID_STATE');
      return Promise.reject(new CampaignPeerChannelError('INVALID_STATE'));
    }
    const queued = this.#queue.shift();
    if (queued !== undefined) {
      this.#queuedBytes -= Buffer.byteLength(queued, 'utf8');
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close('TIMEOUT'), this.#limits.handshakeTimeoutMs);
      this.#waiter = { resolve, reject, timer };
    });
  }
  startRpc(receiver: (text: string) => void): void {
    this.checked();
    if (this.#receiver !== null || this.#waiter !== null) return fail('INVALID_STATE');
    this.#receiver = receiver;
    while (this.#queue.length > 0 && this.#error === null) {
      const text = this.#queue.shift()!;
      this.#queuedBytes -= Buffer.byteLength(text, 'utf8');
      receiver(text);
    }
    this.checked();
  }
  send(text: string, timeout: number): Promise<void> {
    if (this.#error !== null) return Promise.reject(this.#error);
    if (Buffer.byteLength(text, 'utf8') > CAMPAIGN_PEER_CHANNEL_MAX_BYTES) {
      this.close('INVALID_RPC');
      return Promise.reject(new CampaignPeerChannelError('INVALID_RPC'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close('TIMEOUT'), timeout);
      const cleanup = (): void => {
        clearTimeout(timer);
        stop();
      };
      const stop = this.watchClose((error) => {
        cleanup();
        reject(error);
      });
      try {
        this.#socket.send(text, { binary: false }, (error?: Error | null) => {
          if (error != null) this.close('TRANSPORT_ERROR');
          else {
            cleanup();
            resolve();
          }
        });
      } catch {
        this.close('TRANSPORT_ERROR');
      }
    });
  }
}

type Exchange = ReturnType<typeof createCampaignPeerProofExchange>;
class ServerChannel implements CampaignPeerServerChannel {
  readonly #inbox: FrameInbox;
  readonly #exchange: Exchange;
  readonly #limits: CampaignPeerChannelLimits;
  readonly hostIdentity: CampaignPeerPublicIdentity;
  readonly deviceIdentity: CampaignPeerPublicIdentity;
  readonly campaign: PeerCampaignHeader;
  #pending: CampaignPeerRpcRequest | null = null;
  #delivered = false;
  #responseTimer: ReturnType<typeof setTimeout> | null = null;
  #reader: {
    resolve(value: CampaignPeerRpcRequest): void;
    reject(error: CampaignPeerChannelError): void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  constructor(
    inbox: FrameInbox,
    exchange: Exchange,
    hello: CampaignPeerHello,
    challenge: CampaignPeerChallenge,
    config: CampaignPeerChannelLimits,
  ) {
    this.#inbox = inbox;
    this.#exchange = exchange;
    this.#limits = config;
    this.hostIdentity = challenge.hostIdentity;
    this.deviceIdentity = hello.deviceIdentity;
    this.campaign = challenge.campaign;
    inbox.watchClose((error) => {
      exchange.close();
      if (this.#responseTimer !== null) clearTimeout(this.#responseTimer);
      if (this.#reader !== null) {
        clearTimeout(this.#reader.timer);
        this.#reader.reject(error);
      }
      this.#reader = null;
      this.#pending = null;
    });
    inbox.startRpc((text) => {
      try {
        if (this.#pending !== null) return fail('INVALID_STATE');
        const frame = rpcFrame(text, 'network.peer.rpc.request');
        const sequenceNumber = exchange.verifyRpcRequest(
          frame.signed.transcript,
          frame.signed.signatureBase64,
          postSaveSha256(frame.bodyJson),
        );
        this.#pending = Object.freeze({ sequenceNumber, bodyJson: frame.bodyJson });
        this.#delivered = false;
        this.#responseTimer = setTimeout(() => inbox.close('TIMEOUT'), config.rpcTimeoutMs);
        if (this.#reader !== null) {
          const reader = this.#reader;
          this.#reader = null;
          clearTimeout(reader.timer);
          this.#delivered = true;
          reader.resolve(this.#pending);
        }
      } catch (error) {
        inbox.close(safeError(error, 'INVALID_RPC').code);
      }
    });
    Object.freeze(this);
  }
  get closed(): boolean {
    return this.#inbox.error !== null;
  }
  close(): void {
    this.#inbox.close();
  }
  receiveRequest(): Promise<CampaignPeerRpcRequest> {
    if (this.#inbox.error !== null) return Promise.reject(this.#inbox.error);
    if (this.#reader !== null || this.#delivered) {
      this.#inbox.close('INVALID_STATE');
      return Promise.reject(new CampaignPeerChannelError('INVALID_STATE'));
    }
    if (this.#pending !== null) {
      this.#delivered = true;
      return Promise.resolve(this.#pending);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#inbox.close('TIMEOUT'), this.#limits.rpcTimeoutMs);
      this.#reader = { resolve, reject, timer };
    });
  }
  async respond(sequenceNumber: number, bodyJson: string): Promise<void> {
    try {
      this.#inbox.checked();
      if (!this.#delivered || this.#pending?.sequenceNumber !== sequenceNumber)
        return fail('INVALID_STATE');
      const body = canonicalBody(bodyJson);
      const signed = this.#exchange.signRpcResponse(sequenceNumber, postSaveSha256(body));
      const text = encodeRpc('network.peer.rpc.response', body, signed);
      this.#pending = null;
      this.#delivered = false;
      if (this.#responseTimer !== null) clearTimeout(this.#responseTimer);
      this.#responseTimer = null;
      await this.#inbox.send(text, this.#limits.rpcTimeoutMs);
    } catch (error) {
      const safe = safeError(error, 'INVALID_RPC');
      this.#inbox.close(safe.code);
      throw safe;
    }
  }
}

interface PendingCall {
  readonly bodyJson: string;
  resolve(value: string): void;
  reject(error: CampaignPeerChannelError): void;
}
class ClientChannel implements CampaignPeerClientChannel {
  readonly #inbox: FrameInbox;
  readonly #limits: CampaignPeerChannelLimits;
  readonly #challenge: CampaignPeerChallenge;
  #material: DeviceInstallationIdentityMaterial | null;
  readonly #queue: PendingCall[] = [];
  #active: {
    call: PendingCall;
    sequenceNumber: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  #sequenceNumber = 1;
  #needsHostPin: boolean;
  readonly hostIdentity: CampaignPeerPublicIdentity;
  readonly deviceIdentity: CampaignPeerPublicIdentity;
  readonly campaign: PeerCampaignHeader;
  constructor(
    inbox: FrameInbox,
    material: DeviceInstallationIdentityMaterial,
    challenge: CampaignPeerChallenge,
    needsHostPin: boolean,
    config: CampaignPeerChannelLimits,
  ) {
    this.#inbox = inbox;
    this.#material = material;
    this.#challenge = challenge;
    this.#limits = config;
    this.#needsHostPin = needsHostPin;
    this.hostIdentity = challenge.hostIdentity;
    this.deviceIdentity = campaignPeerPublicIdentity(material);
    this.campaign = challenge.campaign;
    inbox.watchClose((error) => {
      this.#material = null;
      if (this.#active !== null) {
        clearTimeout(this.#active.timer);
        this.#active.call.reject(error);
      }
      this.#active = null;
      for (const call of this.#queue.splice(0)) call.reject(error);
    });
    inbox.startRpc((text) => this.#response(text));
    Object.freeze(this);
  }
  get closed(): boolean {
    return this.#inbox.error !== null;
  }
  get needsHostPin(): boolean {
    return this.#needsHostPin;
  }
  close(): void {
    this.#inbox.close();
  }
  confirmHostPin(identity: CampaignPeerPublicIdentity): void {
    try {
      this.#inbox.checked();
      if (!this.#needsHostPin) return fail('INVALID_STATE');
      if (!isDeepStrictEqual(validateCampaignPeerPublicIdentity(identity), this.hostIdentity))
        return fail('INVALID_HANDSHAKE');
      // This is an explicit caller acknowledgement, not proof that a SQL commit happened.
      this.#needsHostPin = false;
    } catch (error) {
      const safe = safeError(error, 'INVALID_HANDSHAKE');
      this.#inbox.close(safe.code);
      throw safe;
    }
  }
  call(bodyJson: string): Promise<string> {
    try {
      this.#inbox.checked();
      if (this.#needsHostPin) return fail('INVALID_STATE');
      const body = canonicalBody(bodyJson);
      if (this.#queue.length + (this.#active === null ? 0 : 1) >= this.#limits.maxPendingCalls)
        return fail('QUEUE_OVERFLOW');
      return new Promise((resolve, reject) => {
        this.#queue.push({ bodyJson: body, resolve, reject });
        this.#pump();
      });
    } catch (error) {
      const safe = safeError(error, 'INVALID_RPC');
      this.#inbox.close(safe.code);
      return Promise.reject(safe);
    }
  }
  #pump(): void {
    if (this.#active !== null || this.closed) return;
    const call = this.#queue.shift();
    if (call === undefined) return;
    try {
      if (this.#material === null) return fail('CLOSED');
      const transcript = validateCampaignPeerTranscript({
        ...this.#challenge.signed.transcript,
        purpose: 'RPC_REQUEST',
        sequenceNumber: this.#sequenceNumber,
        bodySha256: postSaveSha256(call.bodyJson),
      });
      const signed = {
        transcript,
        signatureBase64: signCampaignPeerTranscript(this.#material, transcript),
      };
      const text = encodeRpc('network.peer.rpc.request', call.bodyJson, signed);
      const timer = setTimeout(() => this.#inbox.close('TIMEOUT'), this.#limits.rpcTimeoutMs);
      this.#active = { call, sequenceNumber: this.#sequenceNumber, timer };
      void this.#inbox
        .send(text, this.#limits.rpcTimeoutMs)
        .catch((error: unknown) => this.#inbox.close(safeError(error, 'TRANSPORT_ERROR').code));
    } catch (error) {
      const safe = safeError(error, 'INVALID_RPC');
      call.reject(safe);
      this.#inbox.close(safe.code);
    }
  }
  #response(text: string): void {
    try {
      if (this.#active === null) return fail('INVALID_RPC');
      const active = this.#active;
      const frame = rpcFrame(text, 'network.peer.rpc.response');
      const expected = validateCampaignPeerTranscript({
        ...this.#challenge.signed.transcript,
        purpose: 'RPC_RESPONSE',
        sequenceNumber: active.sequenceNumber,
        bodySha256: postSaveSha256(frame.bodyJson),
      });
      if (
        !isDeepStrictEqual(frame.signed.transcript, expected) ||
        !verifyCampaignPeerTranscript(this.hostIdentity, expected, frame.signed.signatureBase64)
      )
        return fail('INVALID_RPC');
      clearTimeout(active.timer);
      this.#active = null;
      active.call.resolve(frame.bodyJson);
      if (active.sequenceNumber === Number.MAX_SAFE_INTEGER) this.#inbox.close();
      else {
        this.#sequenceNumber += 1;
        this.#pump();
      }
    } catch (error) {
      this.#inbox.close(safeError(error, 'INVALID_RPC').code);
    }
  }
}

function privateTcp(request: IncomingMessage): boolean {
  try {
    const socket = request.socket;
    if (
      !(request instanceof IncomingMessage) ||
      !(socket instanceof Socket) ||
      socket.destroyed ||
      socket.connecting ||
      request.method !== 'GET' ||
      request.url !== '/campaign-state' ||
      request.headers.origin !== undefined ||
      request.rawHeaders.some((value, i) => i % 2 === 0 && value.toLowerCase() === 'origin')
    )
      return false;
    for (const [host, port] of [
      [socket.localAddress, socket.localPort],
      [socket.remoteAddress, socket.remotePort],
    ] as const) {
      if (host === undefined || port === undefined) return false;
      parseCampaignLanAddress(`${host.includes(':') ? `[${host}]` : host}:${String(port)}`);
    }
    return true;
  } catch {
    return false;
  }
}

/** Caller must supply the actual ws/IncomingMessage upgrade pair and set WS maxPayload=128 KiB.
 * An already supplied socket has only a post-receive guard here; no private ws receiver mutation.
 */
export async function acceptCampaignPeerChannel(
  socket: WebSocket,
  request: IncomingMessage,
  options: CampaignPeerAcceptOptions,
): Promise<CampaignPeerServerChannel> {
  let inbox: FrameInbox | null = null;
  let exchange: Exchange | null = null;
  try {
    const config = limits(options.limits);
    inbox = new FrameInbox(socket, config);
    if (!privateTcp(request)) return fail('INVALID_CONNECTION');
    const hello = decodeCampaignPeerHandshakeMessage(await inbox.next());
    inbox.checked();
    if (hello.messageType !== 'network.peer.hello') return fail('INVALID_HANDSHAKE');
    const resolved = options.resolveCampaign(hello.targetCampaignId);
    if (resolved === null || resolved.campaign.campaignId !== hello.targetCampaignId)
      return fail('INVALID_HANDSHAKE');
    const hostIdentity = campaignPeerPublicIdentity(resolved.hostMaterial);
    exchange = createCampaignPeerProofExchange(
      resolved.hostMaterial,
      hello.targetCampaignId,
      hello.deviceIdentity,
      hello.deviceNonceBase64,
      campaignPeerChallengeBodySha256(hostIdentity, resolved.campaign),
    );
    const challenge: CampaignPeerChallenge = {
      protocolVersion: 3,
      messageType: 'network.peer.challenge',
      hostIdentity,
      campaign: resolved.campaign,
      signed: exchange.challenge(),
    };
    const challengeText = encodeCampaignPeerHandshakeMessage(challenge);
    // Decode our own closed public frame so caller-owned mutable header objects cannot drift.
    const publicChallenge = decodeCampaignPeerHandshakeMessage(challengeText);
    if (publicChallenge.messageType !== 'network.peer.challenge') return fail('INVALID_HANDSHAKE');
    await inbox.send(challengeText, config.handshakeTimeoutMs);
    const proof = decodeCampaignPeerHandshakeMessage(await inbox.next());
    inbox.checked();
    if (proof.messageType !== 'network.peer.proof') return fail('INVALID_HANDSHAKE');
    exchange.acceptDeviceProof(proof.signed.transcript, proof.signed.signatureBase64);
    const channel = new ServerChannel(inbox, exchange, hello, publicChallenge, config);
    inbox.checked();
    return channel;
  } catch (error) {
    const safe = safeError(error, 'INVALID_HANDSHAKE');
    exchange?.close();
    if (inbox !== null) inbox.close(safe.code);
    else {
      socket.on('error', () => undefined);
      socket.terminate();
    }
    throw safe;
  }
}

export async function connectCampaignPeerChannel(
  options: CampaignPeerConnectOptions,
): Promise<CampaignPeerClientChannel> {
  let inbox: FrameInbox | null = null;
  const abort = () => inbox?.close('CLOSED');
  try {
    if (options.signal?.aborted) return fail('CLOSED');
    const config = limits(options.limits);
    const target = parseCampaignLanAddress(options.target.canonicalOrigin);
    if (
      target.host !== options.target.host ||
      target.port !== options.target.port ||
      target.canonicalOrigin !== options.target.canonicalOrigin ||
      (options.target.campaignId !== null && options.target.campaignId !== options.campaignId)
    )
      return fail('INVALID_CONNECTION');
    const material = validateDeviceInstallationIdentityMaterial(options.deviceMaterial);
    const hello: CampaignPeerHello = {
      protocolVersion: 3,
      messageType: 'network.peer.hello',
      targetCampaignId: options.campaignId,
      deviceIdentity: campaignPeerPublicIdentity(material),
      deviceNonceBase64: allocateCampaignPeerNonce(),
    };
    const helloText = encodeCampaignPeerHandshakeMessage(hello);
    const trust = options.hostTrust;
    if (trust.kind !== 'PINNED' && trust.kind !== 'FIRST_EXPLICIT_CONNECT')
      return fail('INVALID_CONFIG');
    const expectedPin =
      trust.kind === 'PINNED' ? validateCampaignPeerPublicIdentity(trust.identity) : null;
    const endpoint = new URL('/campaign-state', target.canonicalOrigin);
    endpoint.protocol = 'ws:';
    const socket = new WebSocket(endpoint, {
      followRedirects: false,
      perMessageDeflate: false,
      maxPayload: CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
    });
    inbox = new FrameInbox(socket, config);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) return fail('CLOSED');
    await inbox.opened();
    await inbox.send(helloText, config.handshakeTimeoutMs);
    const rawChallenge = decodeCampaignPeerHandshakeMessage(await inbox.next());
    if (rawChallenge.messageType !== 'network.peer.challenge') return fail('INVALID_HANDSHAKE');
    const challenge = authenticateCampaignPeerChallenge(
      hello,
      rawChallenge,
      expectedPin ?? rawChallenge.hostIdentity,
    );
    const transcript = validateCampaignPeerTranscript({
      ...challenge.signed.transcript,
      purpose: 'DEVICE_PROOF',
    });
    const proof = encodeCampaignPeerHandshakeMessage({
      protocolVersion: 3,
      messageType: 'network.peer.proof',
      signed: { transcript, signatureBase64: signCampaignPeerTranscript(material, transcript) },
    });
    await inbox.send(proof, config.handshakeTimeoutMs);
    const channel = new ClientChannel(inbox, material, challenge, expectedPin === null, config);
    inbox.checked();
    return channel;
  } catch (error) {
    const safe = safeError(error, 'INVALID_HANDSHAKE');
    inbox?.close(safe.code);
    throw safe;
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
}
