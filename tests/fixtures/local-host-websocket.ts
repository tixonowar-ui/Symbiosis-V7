import { once } from 'node:events';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';

const listeners = new WeakMap<FastifyInstance, Promise<string>>();

/** Private application tests use the same TCP endpoint and Origin proof as the browser. */
export async function localHostBaseUrl(app: FastifyInstance): Promise<string> {
  const address = app.server.address();
  if (address !== null) {
    if (typeof address === 'string') throw new Error('local host test requires a TCP listener');
    const host = address.address.includes(':') ? `[${address.address}]` : address.address;
    return new URL(`http://${host}:${String(address.port)}`).origin;
  }
  let pending = listeners.get(app);
  if (pending === undefined) {
    pending = app.listen({ host: '127.0.0.1', port: 0 }).then(() => localHostBaseUrl(app));
    listeners.set(app, pending);
  }
  return pending;
}

export async function openLocalHostWebSocket(app: FastifyInstance): Promise<WebSocket> {
  const origin = await localHostBaseUrl(app);
  const endpoint = new URL('/state', origin);
  endpoint.protocol = 'ws:';
  const socket = new WebSocket(endpoint, { origin });
  try {
    await once(socket, 'open');
    return socket;
  } catch (error: unknown) {
    socket.terminate();
    throw error;
  }
}
