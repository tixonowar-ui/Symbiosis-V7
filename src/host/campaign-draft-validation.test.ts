import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  CampaignArtValue,
  CampaignNetworkInterface,
  CampaignPublicDraftValues,
} from '../shared/campaign-creation.js';
import {
  CAMPAIGN_ART_MAX_BYTES,
  CampaignDraftValidationError,
  campaignArtChecksum,
  campaignDraftReadiness,
  validateCampaignHost,
  validateCampaignMetadata,
  validateCampaignMode,
} from './campaign-draft-validation.js';

const interfaces: readonly CampaignNetworkInterface[] = [
  { networkInterface: 'Ethernet', hostAddress: '192.168.1.10', family: 'IPv4' },
  { networkInterface: 'Loopback', hostAddress: '127.0.0.1', family: 'IPv4' },
  { networkInterface: 'IPv6', hostAddress: '::1', family: 'IPv6' },
];
const host = {
  activePlayerCapacity: 5,
  hostAddress: '192.168.1.10',
  hostPort: 65535,
  networkInterface: 'Ethernet',
};
const metadata = { title: 'Campaign', description: null, art: null };
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
const art = (
  bytes: Buffer,
  mediaType: 'image/png' | 'image/jpeg' = 'image/png',
): CampaignArtValue => ({ kind: 'local-file', mediaType, bytesBase64: bytes.toString('base64') });
function fieldError(body: () => unknown) {
  try {
    body();
    throw new Error('expected rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(CampaignDraftValidationError);
    return (error as CampaignDraftValidationError).fieldError;
  }
}

describe('campaign draft public validation', () => {
  it('preserves exact Unicode and multiline description and accepts incomplete nulls', () => {
    const values = { title: '  e\u0301 📕  ', description: 'Line\r\nSecond\tcolumn', art: null };
    expect(validateCampaignMetadata(values)).toEqual(values);
    expect(validateCampaignMetadata({ title: null, description: null, art: null })).toEqual({
      title: null,
      description: null,
      art: null,
    });
    expect(validateCampaignMode({ defaultFutureRollMode: null })).toEqual({
      defaultFutureRollMode: null,
    });
    expect(
      validateCampaignHost(
        { activePlayerCapacity: null, hostAddress: null, hostPort: null, networkInterface: null },
        interfaces,
      ),
    ).toEqual({
      activePlayerCapacity: null,
      hostAddress: null,
      hostPort: null,
      networkInterface: null,
    });
  });
  it.each(['', ' ', '\n', 'bad\u0000text', 'bad\u0085text', 'bad\ud800text', 'bad\udc00text'])(
    'rejects invalid title %j',
    (title) => {
      expect(fieldError(() => validateCampaignMetadata({ ...metadata, title })).field).toBe(
        'title',
      );
    },
  );
  it.each(['', '\t \r\n', 'bad\u0000text', 'bad\u0085text', 'bad\ud800text'])(
    'rejects invalid description %j',
    (description) => {
      expect(fieldError(() => validateCampaignMetadata({ ...metadata, description })).field).toBe(
        'description',
      );
    },
  );
  it('rejects unknown keys, wrong types and accessors without evaluating user code', () => {
    expect(
      fieldError(() => validateCampaignMetadata({ ...metadata, secret: 'never leak' })),
    ).toEqual({ field: 'title', reason: 'INVALID_VALUE' });
    expect(fieldError(() => validateCampaignMetadata({ ...metadata, title: 4 }))).toEqual({
      field: 'title',
      reason: 'INVALID_TYPE',
    });
    const value = Object.defineProperty({ ...metadata }, 'title', {
      enumerable: true,
      get: () => {
        throw new Error('sensitive getter');
      },
    });
    expect(fieldError(() => validateCampaignMetadata(value))).toEqual({
      field: 'title',
      reason: 'INVALID_TYPE',
    });
  });
  it('validates PNG/JPEG canonical bytes and computes the checksum over decoded bytes', () => {
    for (const value of [art(png), art(jpeg, 'image/jpeg')]) {
      expect(validateCampaignMetadata({ ...metadata, art: value }).art).toEqual(value);
      expect(campaignArtChecksum(value)).toBe(
        createHash('sha256').update(Buffer.from(value.bytesBase64, 'base64')).digest('hex'),
      );
    }
    expect(campaignArtChecksum(null)).toBeNull();
  });
  it.each([
    { ...art(png), bytesBase64: art(png).bytesBase64 + '\n' },
    { ...art(png), bytesBase64: art(png).bytesBase64.replace(/=+$/u, '') },
    art(jpeg),
    art(png, 'image/jpeg'),
    art(Buffer.from('not an image')),
    { ...art(png), kind: 'remote-url' },
  ])('rejects noncanonical bytes, mismatched signatures and unknown art kinds', (value) => {
    expect(fieldError(() => validateCampaignMetadata({ ...metadata, art: value })).field).toBe(
      'art',
    );
  });
  it('accepts exactly the technical byte limit and rejects one extra decoded byte', () => {
    const bytes = Buffer.alloc(CAMPAIGN_ART_MAX_BYTES);
    png.copy(bytes);
    expect(campaignArtChecksum(art(bytes))).toMatch(/^[0-9a-f]{64}$/u);
    const over = Buffer.alloc(CAMPAIGN_ART_MAX_BYTES + 1);
    png.copy(over);
    expect(fieldError(() => validateCampaignMetadata({ ...metadata, art: art(over) }))).toEqual({
      field: 'art',
      reason: 'INVALID_LENGTH',
    });
  });
  it.each([1, 5])(
    'allows normative capacity %i and exact interface/address pairs',
    (activePlayerCapacity) => {
      expect(
        validateCampaignHost({ ...host, activePlayerCapacity, hostPort: 1 }, interfaces),
      ).toEqual({ ...host, activePlayerCapacity, hostPort: 1 });
    },
  );
  it.each([0, 6, 1.5, Number.NaN, '2'])('rejects invalid capacity %j', (activePlayerCapacity) => {
    expect(
      fieldError(() => validateCampaignHost({ ...host, activePlayerCapacity }, interfaces)).field,
    ).toBe('activePlayerCapacity');
  });
  it.each([0, 65536, 1.5, '3000'])('rejects invalid port %j', (hostPort) => {
    expect(fieldError(() => validateCampaignHost({ ...host, hostPort }, interfaces)).field).toBe(
      'hostPort',
    );
  });
  it.each(['localhost', '192.168.1.999', ' 192.168.1.10', 'http://192.168.1.10'])(
    'rejects non-IP host %j',
    (hostAddress) => {
      expect(fieldError(() => validateCampaignHost({ ...host, hostAddress }, interfaces))).toEqual({
        field: 'hostAddress',
        reason: 'INVALID_VALUE',
      });
    },
  );
  it('requires an exact available interface even on partial autosave and supports IPv6', () => {
    expect(
      fieldError(() => validateCampaignHost({ ...host, hostAddress: '127.0.0.1' }, interfaces)),
    ).toEqual({ field: 'hostAddress', reason: 'UNSUPPORTED_INTERFACE' });
    expect(
      fieldError(() =>
        validateCampaignHost(
          { ...host, hostAddress: null, networkInterface: 'invented' },
          interfaces,
        ),
      ),
    ).toEqual({ field: 'networkInterface', reason: 'UNSUPPORTED_INTERFACE' });
    expect(
      fieldError(() =>
        validateCampaignHost(
          { ...host, hostAddress: '10.0.0.1', networkInterface: null },
          interfaces,
        ),
      ),
    ).toEqual({ field: 'hostAddress', reason: 'UNSUPPORTED_INTERFACE' });
    expect(
      validateCampaignHost({ ...host, hostAddress: '::1', networkInterface: 'IPv6' }, interfaces)
        .hostAddress,
    ).toBe('::1');
  });
  it.each(['AUTO', 'MANUAL'] as const)(
    'accepts %s without changing future requests',
    (defaultFutureRollMode) => {
      expect(validateCampaignMode({ defaultFutureRollMode })).toEqual({ defaultFutureRollMode });
    },
  );
  it.each(['auto', 'RANDOM', {}, 1, undefined])(
    'rejects unknown mode %j',
    (defaultFutureRollMode) => {
      expect(fieldError(() => validateCampaignMode({ defaultFutureRollMode })).field).toBe(
        'defaultFutureRollMode',
      );
    },
  );
  it('requires only the completed prefix of the current form and reports missing source-backed fields', () => {
    const values: CampaignPublicDraftValues = {
      metadata,
      host: {
        activePlayerCapacity: null,
        hostAddress: null,
        hostPort: null,
        networkInterface: null,
      },
      defaultFutureRollMode: null,
    };
    expect(campaignDraftReadiness(values, false, 'CMP-001', interfaces)).toEqual({
      ready: true,
      errors: [],
    });
    expect(
      campaignDraftReadiness(values, false, 'CMP-002', interfaces).errors.map((item) => item.field),
    ).toEqual(['activePlayerCapacity', 'hostAddress', 'hostPort', 'networkInterface']);
    const hostReady = { ...values, host };
    expect(campaignDraftReadiness(hostReady, false, 'CMP-002', interfaces).ready).toBe(true);
    expect(campaignDraftReadiness(hostReady, false, 'CMP-003', interfaces)).toEqual({
      ready: false,
      errors: [{ field: 'masterTransferPassword', reason: 'REQUIRED' }],
    });
    expect(campaignDraftReadiness(hostReady, true, 'CMP-004', interfaces)).toEqual({
      ready: false,
      errors: [{ field: 'defaultFutureRollMode', reason: 'REQUIRED' }],
    });
    expect(
      campaignDraftReadiness(
        { ...hostReady, defaultFutureRollMode: 'AUTO' },
        true,
        'CMP-005',
        interfaces,
      ),
    ).toEqual({ ready: true, errors: [] });
    expect(
      campaignDraftReadiness({ ...hostReady, defaultFutureRollMode: 'AUTO' }, true, 'CMP-005', [])
        .ready,
    ).toBe(false);
  });
  it('never includes supplied values in validation messages', () => {
    const secret = 'sensitive user data\u0000';
    try {
      validateCampaignMetadata({ ...metadata, title: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
