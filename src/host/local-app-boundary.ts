import {
  isTrustedLocalMasterConnection,
  normalizedHostIp,
  type LocalMasterConnectionProof,
} from './local-master-trust.js';

/**
 * Same-origin browser GETs may omit Origin. Only this read-only HTTP path may
 * derive the expected origin from the actual local TCP endpoint/listener;
 * WebSocket state commands always require the original explicit Origin.
 */
export function isTrustedLocalHttpAppConnection(proof: LocalMasterConnectionProof): boolean {
  if (proof.origin !== undefined) return isTrustedLocalMasterConnection(proof);
  const local = normalizedHostIp(proof.localAddress);
  if (local === null || proof.listener === null) return false;
  try {
    const origin = new URL(
      `http://${local.includes(':') ? `[${local}]` : local}:${String(proof.listener.port)}`,
    ).origin;
    return isTrustedLocalMasterConnection({ ...proof, origin });
  } catch {
    return false;
  }
}
