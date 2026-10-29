import { isIP } from 'node:net';

export function normalizedHostIp(value: unknown): string | null {
  if (typeof value !== 'string' || value.includes('%')) return null;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  let normalized: string;
  try {
    normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  if (normalized.startsWith('::ffff:')) {
    const parts = normalized.slice(7).split(':');
    if (parts.length !== 2) return null;
    const high = Number.parseInt(parts[0]!, 16),
      low = Number.parseInt(parts[1]!, 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return normalized;
}
const loopback = (ip: string): boolean => ip === '::1' || ip.startsWith('127.');
const originFor = (ip: string, port: number): string =>
  new URL(`http://${ip.includes(':') ? `[${ip}]` : ip}:${String(port)}`).origin;

export interface LocalMasterConnectionProof {
  readonly remoteAddress: unknown;
  readonly localAddress: unknown;
  readonly origin: unknown;
  readonly listener: { readonly address: string; readonly port: number } | null;
}
/** The TCP endpoint and real bound listener are trusted; request Host/proxy headers are absent. */
export function isTrustedLocalMasterConnection(proof: LocalMasterConnectionProof): boolean {
  const remote = normalizedHostIp(proof.remoteAddress),
    local = normalizedHostIp(proof.localAddress);
  const listener = proof.listener;
  if (
    remote === null ||
    local === null ||
    listener === null ||
    !Number.isSafeInteger(listener.port) ||
    listener.port < 1 ||
    listener.port > 65535 ||
    (remote !== local && !(loopback(remote) && loopback(local))) ||
    typeof proof.origin !== 'string'
  )
    return false;
  const bound = normalizedHostIp(listener.address);
  if (bound === null || (bound !== '0.0.0.0' && bound !== '::' && bound !== local)) return false;
  try {
    const origin = new URL(proof.origin);
    if (
      origin.protocol !== 'http:' ||
      origin.origin !== proof.origin ||
      origin.username !== '' ||
      origin.password !== ''
    )
      return false;
    const allowed = [originFor(local, listener.port)];
    if (loopback(local)) allowed.push(new URL(`http://localhost:${String(listener.port)}`).origin);
    return allowed.includes(proof.origin);
  } catch {
    return false;
  }
}
