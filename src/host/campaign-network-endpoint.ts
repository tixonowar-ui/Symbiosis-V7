import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { types } from 'node:util';
import { WebSocketServer, type WebSocket } from 'ws';
import type {
  CampaignBindManager,
  CampaignNetworkEndpoint,
  CampaignSocketAttachment,
} from './campaign-bind.js';
import { CAMPAIGN_PEER_CHANNEL_MAX_BYTES } from './campaign-peer-channel.js';
import { normalizedHostIp } from './local-master-trust.js';
import { parseCampaignLanAddress } from './campaign-lan-address.js';
import { validatePeerCampaignHeader, type PeerCampaignHeader } from './campaign-peer-handshake.js';
import { canonicalPostSaveJson } from './local-character-export.js';

export type CampaignNetworkEndpointErrorCode =
  | 'INVALID_CONFIG'
  | 'LISTENER_CONFLICT'
  | 'CLOSED'
  | 'ENDPOINT_UNAVAILABLE'
  | 'UPGRADE_FAILED'
  | 'ACCEPT_FAILED';
export class CampaignNetworkEndpointError extends Error {
  constructor(readonly code: CampaignNetworkEndpointErrorCode) {
    super(`campaign network endpoint: ${code}`);
  }
}
export interface CampaignNetworkEndpointOptions {
  readonly shellServer: Server;
  readonly bind: CampaignBindManager;
  readonly maxConnections: number;
  readonly accept: (
    socket: WebSocket,
    request: IncomingMessage,
    campaignIds: readonly string[],
  ) => void | Promise<void>;
  readonly onError: (error: CampaignNetworkEndpointError) => void;
  /** Public locator source only; grants no peer, GM or campaign authority. */
  readonly readPublicCampaignHeaders: (
    campaignIds: readonly string[],
  ) => readonly PeerCampaignHeader[];
}
interface Publication {
  readonly endpoint: CampaignNetworkEndpoint;
  attachment: CampaignSocketAttachment | null;
  readonly http: Server | null;
  readonly sockets: Set<Socket>;
  readonly handler: (socket: Socket) => void;
}
const fail = (code: CampaignNetworkEndpointErrorCode): never => {
  throw new CampaignNetworkEndpointError(code);
};
function consumePromise(value: unknown, rejected: () => void): boolean {
  if (!types.isPromise(value)) return false;
  try {
    void Promise.prototype.then.call(value, () => undefined, rejected);
  } catch {
    rejected();
  }
  return true;
}
const sameEndpoint = (a: CampaignNetworkEndpoint, b: CampaignNetworkEndpoint): boolean =>
  a.kind === b.kind && a.address === b.address && a.port === b.port;
function refuse(socket: Socket, status: 403 | 404 | 503): void {
  if (!socket.destroyed)
    socket.end(
      `HTTP/1.1 ${status === 403 ? '403 Forbidden' : status === 404 ? '404 Not Found' : '503 Service Unavailable'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
}

/** Owns upgrade routing, not shell/bind ownership or campaign/device authorization. */
export function createCampaignNetworkEndpoint(options: CampaignNetworkEndpointOptions) {
  try {
    if (
      !(options.shellServer instanceof Server) ||
      !Number.isSafeInteger(options.maxConnections) ||
      options.maxConnections <= 0 ||
      typeof options.accept !== 'function' ||
      typeof options.onError !== 'function' ||
      typeof options.readPublicCampaignHeaders !== 'function'
    )
      return fail('INVALID_CONFIG');
  } catch {
    return fail('INVALID_CONFIG');
  }
  if (options.shellServer.listenerCount('upgrade') !== 0) return fail('LISTENER_CONFLICT');
  const localUpgradeServer = createServer();
  const privateWss = new WebSocketServer({
    noServer: true,
    maxPayload: CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
    perMessageDeflate: false,
  });
  const publications = new Map<string, Publication>();
  const peers = new Map<WebSocket, readonly string[]>();
  const pendingUpgrades = new Set<Socket>();
  const maxConnections = options.maxConnections;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const diagnostic = (code: CampaignNetworkEndpointErrorCode): void => {
    try {
      const result: unknown = options.onError(new CampaignNetworkEndpointError(code));
      if (consumePromise(result, () => {})) void close();
    } catch (error: unknown) {
      consumePromise(error, () => {});
      void close();
    }
  };
  privateWss.on('error', () => diagnostic('UPGRADE_FAILED'));
  function liveIds(endpoint: CampaignNetworkEndpoint): readonly string[] {
    const ids: string[] = [];
    for (const [id, publication] of publications) {
      const live = options.bind.endpointForCampaign(id);
      if (
        sameEndpoint(publication.endpoint, endpoint) &&
        live !== null &&
        sameEndpoint(live, endpoint)
      )
        ids.push(id);
    }
    return Object.freeze(ids);
  }
  function servePublicLocator(request: IncomingMessage, response: ServerResponse): boolean {
    if (!(request instanceof IncomingMessage) || request.url !== '/campaign-locator') return false;
    const reply = (status: 200 | 403 | 503, value: unknown): void => {
      const body = canonicalPostSaveJson(value);
      response.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
      });
      response.end(body);
    };
    try {
      if (
        closed ||
        !(response instanceof ServerResponse) ||
        response.req !== request ||
        !(request.socket instanceof Socket) ||
        request.socket.destroyed ||
        request.method !== 'GET' ||
        request.headers.origin !== undefined ||
        request.rawHeaders.some((v, i) => i % 2 === 0 && v.toLowerCase() === 'origin')
      ) {
        reply(403, { error: 'LOCATOR_UNAVAILABLE' });
        return true;
      }
      for (const [address, port] of [
        [request.socket.localAddress, request.socket.localPort],
        [request.socket.remoteAddress, request.socket.remotePort],
      ] as const) {
        if (address === undefined || port === undefined) throw new Error();
        parseCampaignLanAddress(
          `${address.includes(':') ? `[${address}]` : address}:${String(port)}`,
        );
      }
      const address = normalizedHostIp(request.socket.localAddress),
        port = request.socket.localPort;
      const ids = Object.freeze(
        [...publications]
          .filter(([id, p]) => {
            const actual = options.bind.endpointForCampaign(id);
            return (
              p.endpoint.address === address &&
              p.endpoint.port === port &&
              actual !== null &&
              sameEndpoint(actual, p.endpoint)
            );
          })
          .map(([id]) => id),
      );
      let selected: unknown;
      try {
        selected = options.readPublicCampaignHeaders(ids);
      } catch (error: unknown) {
        consumePromise(error, () => {});
        selected = undefined;
      }
      if (
        consumePromise(selected, () => {}) ||
        !Array.isArray(selected) ||
        selected.length !== ids.length
      )
        throw new Error();
      const campaigns = selected.map((header: unknown, index) => {
        const checked = validatePeerCampaignHeader(header);
        if (checked.campaignId !== ids[index]) throw new Error();
        return checked;
      });
      const value = { protocolVersion: 3, campaigns };
      if (Buffer.byteLength(canonicalPostSaveJson(value), 'utf8') > CAMPAIGN_PEER_CHANNEL_MAX_BYTES)
        throw new Error();
      reply(200, value);
    } catch {
      reply(503, { error: 'LOCATOR_UNAVAILABLE' });
    }
    return true;
  }
  function privateUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
    endpoint: CampaignNetworkEndpoint,
  ): void {
    try {
      const ids = liveIds(endpoint);
      if (
        closed ||
        ids.length === 0 ||
        !(request instanceof IncomingMessage) ||
        request.socket !== socket ||
        request.method !== 'GET' ||
        request.url !== '/campaign-state' ||
        request.headers.origin !== undefined ||
        request.rawHeaders.some((v, i) => i % 2 === 0 && v.toLowerCase() === 'origin')
      ) {
        refuse(socket, 403);
        return;
      }
      if (peers.size + pendingUpgrades.size >= maxConnections) {
        refuse(socket, 503);
        return;
      }
      pendingUpgrades.add(socket);
      const releasePending = () => {
        pendingUpgrades.delete(socket);
      };
      socket.once('close', releasePending);
      privateWss.handleUpgrade(request, socket, head, (peer) => {
        releasePending();
        socket.removeListener('close', releasePending);
        peers.set(peer, ids);
        peer.on('error', () => {});
        peer.once('close', () => peers.delete(peer));
        const rejected = () => {
          peer.terminate();
          diagnostic('ACCEPT_FAILED');
        };
        try {
          const result: unknown = options.accept(peer, request, ids);
          if (result !== undefined && !consumePromise(result, rejected)) rejected();
        } catch (error: unknown) {
          consumePromise(error, () => {});
          rejected();
        }
      });
    } catch {
      pendingUpgrades.delete(socket);
      socket.destroy();
      diagnostic('UPGRADE_FAILED');
    }
  }
  const shellUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (!(socket instanceof Socket)) {
      socket.destroy();
      return;
    }
    socket.on('error', () => {});
    if (closed) {
      socket.destroy();
      return;
    }
    if (request.url === '/campaign-state' || request.url?.startsWith('/campaign-state?')) {
      const address = options.shellServer.address();
      if (!options.shellServer.listening || address === null || typeof address === 'string') {
        socket.destroy();
        return;
      }
      const localAddress = normalizedHostIp(socket.localAddress);
      if (localAddress === null) {
        socket.destroy();
        return;
      }
      privateUpgrade(request, socket, head, {
        kind: 'BORROWED_SHELL',
        address: localAddress,
        port: address.port,
      });
    } else if (!localUpgradeServer.emit('upgrade', request, socket, head)) refuse(socket, 404);
  };
  options.shellServer.on('upgrade', shellUpgrade);
  function unpublishCampaign(campaignId: string): void {
    const publication = publications.get(campaignId);
    if (publication === undefined) return;
    publications.delete(campaignId);
    for (const [peer, ids] of peers) if (ids.includes(campaignId)) peer.terminate();
    if (publication.attachment?.kind === 'OWNED_RESERVATION') publication.attachment.detach();
    for (const socket of publication.sockets) socket.destroy();
    publication.http?.removeAllListeners();
  }
  function publishCampaign(campaignId: string): CampaignNetworkEndpoint {
    if (closed) return fail('CLOSED');
    if (typeof campaignId !== 'string' || campaignId.length === 0) return fail('INVALID_CONFIG');
    try {
      const endpoint = options.bind.endpointForCampaign(campaignId);
      if (endpoint === null) {
        unpublishCampaign(campaignId);
        return fail('ENDPOINT_UNAVAILABLE');
      }
      const previous = publications.get(campaignId);
      if (previous !== undefined && sameEndpoint(previous.endpoint, endpoint)) {
        const attachment = attach(campaignId, previous);
        if (previous.attachment !== attachment && endpoint.kind === 'OWNED_RESERVATION') {
          for (const [peer, ids] of peers) if (ids.includes(campaignId)) peer.terminate();
          for (const socket of previous.sockets) socket.destroy();
          if (previous.attachment?.kind === 'OWNED_RESERVATION') previous.attachment.detach();
        }
        previous.attachment = attachment;
        return Object.freeze({ ...endpoint });
      }
      unpublishCampaign(campaignId);
      const sockets = new Set<Socket>();
      const http =
        endpoint.kind === 'OWNED_RESERVATION'
          ? createServer((request, response) => {
              if (servePublicLocator(request, response)) return;
              response.writeHead(404);
              response.end();
            })
          : null;
      if (http !== null) {
        http.on('connection', (socket: Socket) => {
          sockets.add(socket);
          socket.on('error', () => {});
          socket.once('close', () => sockets.delete(socket));
        });
        http.on('upgrade', (request, socket, head) => {
          if (!(socket instanceof Socket)) {
            socket.destroy();
            return;
          }
          if (request.url !== '/campaign-state') {
            refuse(socket, 404);
            return;
          }
          privateUpgrade(request, socket, head, endpoint);
        });
        http.on('clientError', (_error, socket) => socket.destroy());
      }
      const publication: Publication = {
        endpoint: Object.freeze({ ...endpoint }),
        attachment: null,
        http,
        sockets,
        handler: (socket) => {
          if (closed || publications.get(campaignId) !== publication || http === null) {
            socket.destroy();
            return;
          }
          http.emit('connection', socket);
        },
      };
      publications.set(campaignId, publication);
      publication.attachment = attach(campaignId, publication);
      return Object.freeze({ ...endpoint });
    } catch {
      unpublishCampaign(campaignId);
      return fail('ENDPOINT_UNAVAILABLE');
    }
  }
  function attach(campaignId: string, publication: Publication): CampaignSocketAttachment {
    let selected: CampaignSocketAttachment | null = null;
    selected = options.bind.attachCampaignSocketHandler(campaignId, publication.handler, () => {
      if (publications.get(campaignId) !== publication || publication.attachment !== selected)
        return;
      unpublishCampaign(campaignId);
      diagnostic('ENDPOINT_UNAVAILABLE');
    });
    return selected;
  }
  function close(): Promise<void> {
    if (closePromise !== undefined) return closePromise;
    closed = true;
    options.shellServer.removeListener('upgrade', shellUpgrade);
    for (const id of [...publications.keys()]) unpublishCampaign(id);
    for (const peer of peers.keys()) peer.terminate();
    for (const socket of pendingUpgrades) socket.destroy();
    pendingUpgrades.clear();
    // This relay belongs exclusively to this adapter; plugin cleanup may target app.server instead.
    localUpgradeServer.removeAllListeners('upgrade');
    closePromise = new Promise<void>((resolve) => privateWss.close(() => resolve()));
    return closePromise;
  }
  return Object.freeze({
    localUpgradeServer,
    servePublicLocator,
    publishCampaign,
    unpublishCampaign,
    close,
  });
}
