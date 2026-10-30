import { describe, expect, it } from 'vitest';
import { campaignQrPayload } from '@shared/campaign-creation.js';
import {
  CampaignLanAddressError,
  parseCampaignLanAddress,
  type CampaignLanAddressErrorCode,
  type CampaignLanAddressErrorField,
} from './campaign-lan-address.js';

const CAMPAIGN_ID = '12345678-1234-4abc-8def-123456789abc';
function refusal(
  value: unknown,
  code?: CampaignLanAddressErrorCode,
  field?: CampaignLanAddressErrorField,
): CampaignLanAddressError {
  try {
    parseCampaignLanAddress(value);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(CampaignLanAddressError);
    const result = error as CampaignLanAddressError;
    if (code !== undefined) expect(result.code).toBe(code);
    if (field !== undefined) expect(result.field).toBe(field);
    expect(result.message).toBe(`${result.code}:${result.field}`);
    expect(result.cause).toBeUndefined();
    return result;
  }
  throw new Error('Expected a typed LAN address refusal');
}

describe('campaign LAN locator parser', () => {
  it.each([
    ['192.168.1.20', 3000, 'http://192.168.1.20:3000'],
    ['127.0.0.1', 80, 'http://127.0.0.1'],
    ['::1', 3000, 'http://[::1]:3000'],
    ['fdab:0:0:0:0:0:0:abcd', 80, 'http://[fdab::abcd]'],
  ] as const)(
    'accepts actual source campaignQrPayload for %s:%s',
    (host, port, canonicalOrigin) => {
      const qr = campaignQrPayload(host, port, CAMPAIGN_ID);
      expect(parseCampaignLanAddress(qr)).toEqual({
        host: host === 'fdab:0:0:0:0:0:0:abcd' ? 'fdab::abcd' : host,
        port,
        canonicalOrigin,
        campaignId: CAMPAIGN_ID,
      });
    },
  );

  it.each([
    ['10.0.0.1:1', '10.0.0.1', 1, 'http://10.0.0.1:1'],
    ['172.16.0.1:65535', '172.16.0.1', 65535, 'http://172.16.0.1:65535'],
    ['172.31.255.254:3000', '172.31.255.254', 3000, 'http://172.31.255.254:3000'],
    ['169.254.2.3:80', '169.254.2.3', 80, 'http://169.254.2.3'],
    ['127.2.3.4:3000', '127.2.3.4', 3000, 'http://127.2.3.4:3000'],
    ['http://192.168.1.20', '192.168.1.20', 80, 'http://192.168.1.20'],
    ['http://192.168.1.20:80/', '192.168.1.20', 80, 'http://192.168.1.20'],
    ['http://[::1]/', '::1', 80, 'http://[::1]'],
    ['[FC00:0000:0:0:0:0:0:1]:3000', 'fc00::1', 3000, 'http://[fc00::1]:3000'],
    ['[fdff:ffff::1]:3000', 'fdff:ffff::1', 3000, 'http://[fdff:ffff::1]:3000'],
    ['[fe80::1]:3000', 'fe80::1', 3000, 'http://[fe80::1]:3000'],
    ['[febf::1]:3000', 'febf::1', 3000, 'http://[febf::1]:3000'],
    ['[::ffff:192.168.1.20]:3000', '192.168.1.20', 3000, 'http://192.168.1.20:3000'],
    ['http://[::ffff:7f00:1]:80/', '127.0.0.1', 80, 'http://127.0.0.1'],
    [' \u00a0 192.168.1.20:3000\u2003 ', '192.168.1.20', 3000, 'http://192.168.1.20:3000'],
  ] as const)(
    'normalizes only supported manual IP endpoint %s',
    (text, host, port, canonicalOrigin) => {
      expect(parseCampaignLanAddress(text)).toEqual({
        host,
        port,
        canonicalOrigin,
        campaignId: null,
      });
    },
  );

  it.each([
    'http://8.8.8.8:3000/',
    'http://172.15.255.255/',
    'http://172.32.0.0/',
    'http://192.169.1.1/',
    'http://169.253.1.1/',
    'http://0.0.0.0/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    'http://100.64.0.1/',
    'http://localhost/',
    'http://host.local:3000/',
    'http://127.0.0.1.example.com/',
    'http://[2001:db8::1]/',
    'http://[::]/',
    'http://[ff02::1]/',
    'http://[fec0::1]/',
    'http://[fe7f::1]/',
    'http://[::ffff:8.8.8.8]/',
    'http://[::ffff:808:808]/',
    'http://[::192.168.1.1]/',
    'http://[64:ff9b::192.168.1.1]/',
    'http://[fe80::1%3]:3000/',
    'http://[fe80::1%253]:3000/',
    'http://user:password@192.168.1.20:3000/',
    'http://@127.0.0.1/',
  ])('rejects unsupported, DNS, scoped or credential-bearing host %s', (text) => {
    refusal(text, 'UNSUPPORTED_ADDRESS', 'host');
  });

  it.each([
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://127.00.0.1/',
    'http://127.0.0.01/',
    'http://127.0.0.1./',
    'http://%31%32%37.0.0.1/',
    'http://127%2e0%2e0%2e1/',
    'http://１２７.０.０.１/',
    'http://127.0.0.256/',
    'http://[127.0.0.1]:3000/',
    '192.168.1.1:3000/path',
    '::1:3000',
    '//192.168.1.1:3000',
  ])('rejects ambiguous or WHATWG-normalized host syntax %s', (text) => {
    refusal(text);
  });

  it.each([
    'http://192.168.1.20:0/',
    'http://192.168.1.20:65536/',
    'http://192.168.1.20:03000/',
    'http://192.168.1.20:/',
    'http://192.168.1.20:+80/',
    'http://192.168.1.20:80.0/',
    'http://192.168.1.20:8e1/',
    'http://192.168.1.20:%38%30/',
    '192.168.1.20',
    '[::1]',
    '192.168.1.20:',
    '[::1]:-1',
  ])('requires an explicit canonical bare port or valid HTTP port %s', (text) => {
    refusal(text, 'INVALID_PORT', 'port');
  });

  it.each([
    'https://192.168.1.20/',
    'file:///192.168.1.20/',
    'ftp://192.168.1.20/',
    'ws://192.168.1.20/',
    'http:/192.168.1.20/',
    'HTTP://192.168.1.20/',
    'data:text/plain,192.168.1.20',
    'javascript:alert(1)',
  ])('rejects another scheme rather than downgrade %s', (text) => {
    refusal(text, 'UNSUPPORTED_PROTOCOL', 'protocol');
  });

  it.each([
    `http://192.168.1.20/?campaignId=${CAMPAIGN_ID.toUpperCase()}`,
    'http://192.168.1.20/?campaignId=12345678-1234-1abc-8def-123456789abc',
    'http://192.168.1.20/?campaignId=12345678-1234-4abc-7def-123456789abc',
    'http://192.168.1.20/?campaignId=00000000-0000-0000-0000-000000000000',
    'http://192.168.1.20/?campaignId=',
    `http://192.168.1.20/?campaignId=${CAMPAIGN_ID}&campaignId=${CAMPAIGN_ID}`,
    `http://192.168.1.20/?campaignId=${CAMPAIGN_ID}&redirect=http://8.8.8.8/`,
    `http://192.168.1.20/?campaignId=%31${CAMPAIGN_ID.slice(1)}`,
    `http://192.168.1.20/?campaignId=${CAMPAIGN_ID}%20`,
  ])('rejects noncanonical campaign hints and additional query keys %s', (text) => {
    refusal(text, 'INVALID_CAMPAIGN_ID', 'campaignId');
  });

  it.each([
    '',
    '   ',
    null,
    undefined,
    {},
    ['192.168.1.20:3000'],
    'http://192.168.1.20/private',
    'http://192.168.1.20/../',
    'http://192.168.1.20/%2e/',
    'http://192.168.1.20/#',
    'http://192.168.1.20/#secret',
    `http://192.168.1.20?campaignId=${CAMPAIGN_ID}`,
    `http://192.168.1.20/?CampaignId=${CAMPAIGN_ID}`,
    `http://192.168.1.20/?%63ampaignId=${CAMPAIGN_ID}`,
    ` http://192.168.1.20/?campaignId=${CAMPAIGN_ID} `,
    'http://192.168.1.20/\n',
    '\t192.168.1.20:3000',
    '192.168.1.20:3000\r',
    'http://192.168.1.20\u0000/',
    'http://192.168.1.20/\uD800',
    'http://192.168.1.20/\uDC00',
    'http://192.168. 1.20/',
  ])('returns a safe typed refusal for malformed input %#', (text) => {
    refusal(text, 'INVALID_LOCATOR', 'addressOrQrPayload');
  });

  it('never serializes a caller secret or URL parse cause in the error', () => {
    const marker = 'PRIVATE_PASSWORD_MARKER';
    const error = refusal(`http://user:${marker}@192.168.1.20:3000/`);
    expect(JSON.stringify(error)).not.toContain(marker);
    expect(String(error)).not.toContain(marker);
    expect(error.stack).not.toContain(marker);
  });
});
