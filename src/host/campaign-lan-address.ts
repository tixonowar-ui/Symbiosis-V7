import { isIP } from 'node:net';
import { normalizedHostIp } from './local-master-trust.js';

export interface CampaignLanAddress {
  readonly host: string;
  readonly port: number;
  readonly canonicalOrigin: string;
  readonly campaignId: string | null;
}
export type CampaignLanAddressErrorCode =
  | 'INVALID_LOCATOR'
  | 'UNSUPPORTED_PROTOCOL'
  | 'UNSUPPORTED_ADDRESS'
  | 'INVALID_PORT'
  | 'INVALID_CAMPAIGN_ID';
export type CampaignLanAddressErrorField =
  'addressOrQrPayload' | 'protocol' | 'host' | 'port' | 'campaignId';

export class CampaignLanAddressError extends Error {
  constructor(
    readonly code: CampaignLanAddressErrorCode,
    readonly field: CampaignLanAddressErrorField,
  ) {
    // URL parser errors can contain the complete input, including unintended credentials.
    super(`${code}:${field}`);
  }
}
const fail = (code: CampaignLanAddressErrorCode, field: CampaignLanAddressErrorField): never => {
  throw new CampaignLanAddressError(code, field);
};
const CONTROL_OR_LONE_SURROGATE = /[\p{Cc}\uD800-\uDFFF]/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IPV4 = /^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/u;

function lanIpv4(host: string): boolean {
  const [first, second] = host.split('.').map(Number);
  // Technical offline-network policy; these ranges confer no campaign authority.
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function normalizedLanHost(value: string, bracketed: boolean): string {
  const family = isIP(value);
  if (
    value.includes('%') ||
    family === 0 ||
    (bracketed ? family !== 6 : family !== 4 || !IPV4.test(value))
  )
    return fail('UNSUPPORTED_ADDRESS', 'host');
  // Validate raw syntax before WHATWG URL can normalize shorthand, octal or encoded hosts.
  const normalized = normalizedHostIp(value);
  if (normalized === null) return fail('UNSUPPORTED_ADDRESS', 'host');
  if (isIP(normalized) === 4) {
    if (!lanIpv4(normalized)) return fail('UNSUPPORTED_ADDRESS', 'host');
  } else if (
    normalized !== '::1' &&
    !/^f[cd][0-9a-f]{2}:/u.test(normalized) &&
    !/^fe[89ab][0-9a-f]:/u.test(normalized)
  )
    return fail('UNSUPPORTED_ADDRESS', 'host');
  return normalized;
}

/** Parse only; no discovery, DNS, redirect, fetch or allocation occurs here. */
export function parseCampaignLanAddress(value: unknown): CampaignLanAddress {
  if (typeof value !== 'string' || CONTROL_OR_LONE_SURROGATE.test(value))
    return fail('INVALID_LOCATOR', 'addressOrQrPayload');
  // Only exterior manual-input whitespace is trimmed. A QR query remains an exact locator.
  const text = value.trim();
  if (text.length === 0 || /\s/u.test(text) || (text.includes('?') && text !== value))
    return fail('INVALID_LOCATOR', 'addressOrQrPayload');
  const http = text.startsWith('http://');
  if (
    !http &&
    (/^[a-z][a-z0-9+.-]*:\/\//iu.test(text) ||
      /^(?:https?|file|ftp|ws|wss|data|javascript):/iu.test(text))
  )
    return fail('UNSUPPORTED_PROTOCOL', 'protocol');
  let authority = text;
  let campaignId: string | null = null;
  if (http) {
    const locator = /^http:\/\/([^/?#]+)(\/?)(\?[^#]*)?$/u.exec(text);
    if (locator === null) return fail('INVALID_LOCATOR', 'addressOrQrPayload');
    authority = locator[1]!;
    const query = locator[3];
    if (query !== undefined) {
      if (locator[2] !== '/' || !query.startsWith('?campaignId='))
        return fail('INVALID_LOCATOR', 'addressOrQrPayload');
      campaignId = query.slice('?campaignId='.length);
      if (!UUID_V4.test(campaignId)) return fail('INVALID_CAMPAIGN_ID', 'campaignId');
    }
  }
  const bracketed = authority.startsWith('[');
  const target = bracketed
    ? /^\[([^\]]+)\](?::([^:]*))?$/u.exec(authority)
    : /^([^:]+)(?::([^:]*))?$/u.exec(authority);
  if (target === null) return fail('UNSUPPORTED_ADDRESS', 'host');
  const host = normalizedLanHost(target[1]!, bracketed);
  const portText = target[2];
  if (
    (portText === undefined && !http) ||
    (portText !== undefined && (!/^[1-9][0-9]{0,4}$/u.test(portText) || Number(portText) > 65535))
  )
    return fail('INVALID_PORT', 'port');
  const port = portText === undefined ? 80 : Number(portText);
  const canonicalOrigin = new URL(
    `http://${host.includes(':') ? `[${host}]` : host}:${String(port)}/`,
  ).origin;
  return { host, port, canonicalOrigin, campaignId };
}
