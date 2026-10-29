import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type {
  CampaignArtValue,
  CampaignDraftFormId,
  CampaignFieldError,
  CampaignFutureRollMode,
  CampaignHostValues,
  CampaignMetadataValues,
  CampaignNetworkInterface,
  CampaignPublicDraftValues,
} from '../shared/campaign-creation.js';

/** ADR 0064 bounds local artwork transport; it does not constrain campaign fiction. */
export const CAMPAIGN_ART_MAX_BYTES = 12 * 1024 * 1024;
export class CampaignDraftValidationError extends Error {
  constructor(readonly fieldError: CampaignFieldError) {
    super(`Invalid campaign field: ${fieldError.field}:${fieldError.reason}`);
  }
}
const invalid = (
  field: CampaignFieldError['field'],
  reason: CampaignFieldError['reason'],
): never => {
  throw new CampaignDraftValidationError({ field, reason });
};
function record(
  value: unknown,
  keys: readonly string[],
  field: CampaignFieldError['field'],
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return invalid(field, 'INVALID_TYPE');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(descriptors, key))
  )
    return invalid(field, 'INVALID_VALUE');
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      return invalid(field, 'INVALID_TYPE');
    result[key] = descriptor.value as unknown;
  }
  return result;
}
function optionalText(value: unknown, field: 'title' | 'description'): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return invalid(field, 'INVALID_TYPE');
  for (const character of value) {
    const point = character.codePointAt(0);
    if (
      point === undefined ||
      (point >= 0xd800 && point <= 0xdfff) ||
      (/\p{Cc}/u.test(character) &&
        !(field === 'description' && ['\n', '\r', '\t'].includes(character)))
    )
      return invalid(field, 'DISALLOWED_CHARACTERS');
  }
  if (value.trim().length === 0) return invalid(field, 'INVALID_VALUE');
  return value;
}
function artBytes(value: unknown): { art: CampaignArtValue; bytes: Buffer } {
  const row = record(value, ['kind', 'mediaType', 'bytesBase64'], 'art');
  if (
    row['kind'] !== 'local-file' ||
    (row['mediaType'] !== 'image/png' && row['mediaType'] !== 'image/jpeg')
  )
    return invalid('art', 'INVALID_IMAGE');
  const encoded = row['bytesBase64'];
  if (typeof encoded !== 'string') return invalid('art', 'INVALID_TYPE');
  if (encoded.length === 0 || encoded.length > 4 * Math.ceil(CAMPAIGN_ART_MAX_BYTES / 3))
    return invalid('art', 'INVALID_LENGTH');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > CAMPAIGN_ART_MAX_BYTES || bytes.toString('base64') !== encoded)
    return invalid('art', 'INVALID_IMAGE');
  const signature =
    row['mediaType'] === 'image/png'
      ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : Buffer.from([0xff, 0xd8, 0xff]);
  if (bytes.length < signature.length || !bytes.subarray(0, signature.length).equals(signature))
    return invalid('art', 'INVALID_IMAGE');
  return { art: { kind: 'local-file', mediaType: row['mediaType'], bytesBase64: encoded }, bytes };
}
export function campaignArtChecksum(art: CampaignArtValue | null): string | null {
  return art === null ? null : createHash('sha256').update(artBytes(art).bytes).digest('hex');
}
export function validateCampaignMetadata(value: unknown): CampaignMetadataValues {
  const row = record(value, ['title', 'description', 'art'], 'title');
  return {
    title: optionalText(row['title'], 'title'),
    description: optionalText(row['description'], 'description'),
    art: row['art'] === null ? null : artBytes(row['art']).art,
  };
}
function optionalInteger(
  value: unknown,
  field: 'activePlayerCapacity' | 'hostPort',
  min: number,
  max: number,
): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    return invalid(field, 'INVALID_TYPE');
  if (value < min || value > max) return invalid(field, 'INVALID_VALUE');
  return value;
}
function optionalHostText(
  value: unknown,
  field: 'hostAddress' | 'networkInterface',
): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return invalid(field, 'INVALID_TYPE');
  if (value.length === 0) return invalid(field, 'INVALID_VALUE');
  return value;
}
export function validateCampaignHost(
  value: unknown,
  availableInterfaces: readonly CampaignNetworkInterface[],
): CampaignHostValues {
  const row = record(
    value,
    ['activePlayerCapacity', 'hostAddress', 'hostPort', 'networkInterface'],
    'hostAddress',
  );
  // CMP-002 specifies one through five active players; ports follow the TCP range.
  const activePlayerCapacity = optionalInteger(
    row['activePlayerCapacity'],
    'activePlayerCapacity',
    1,
    5,
  );
  const hostPort = optionalInteger(row['hostPort'], 'hostPort', 1, 65535);
  const hostAddress = optionalHostText(row['hostAddress'], 'hostAddress');
  const networkInterface = optionalHostText(row['networkInterface'], 'networkInterface');
  if (hostAddress !== null && isIP(hostAddress) === 0)
    return invalid('hostAddress', 'INVALID_VALUE');
  if (
    networkInterface !== null &&
    !availableInterfaces.some((item) => item.networkInterface === networkInterface)
  )
    return invalid('networkInterface', 'UNSUPPORTED_INTERFACE');
  if (
    hostAddress !== null &&
    !availableInterfaces.some(
      (item) =>
        item.hostAddress === hostAddress &&
        (networkInterface === null || item.networkInterface === networkInterface),
    )
  )
    return invalid('hostAddress', 'UNSUPPORTED_INTERFACE');
  return { activePlayerCapacity, hostAddress, hostPort, networkInterface };
}
export function validateCampaignMode(value: unknown): {
  defaultFutureRollMode: CampaignFutureRollMode | null;
} {
  const row = record(value, ['defaultFutureRollMode'], 'defaultFutureRollMode');
  const mode = row['defaultFutureRollMode'];
  if (mode !== null && mode !== 'MANUAL' && mode !== 'AUTO')
    return invalid('defaultFutureRollMode', 'INVALID_VALUE');
  return { defaultFutureRollMode: mode };
}
export interface CampaignDraftReadiness {
  readonly ready: boolean;
  readonly errors: readonly CampaignFieldError[];
}
export function campaignDraftReadiness(
  values: CampaignPublicDraftValues,
  secretConfigured: boolean,
  formId: CampaignDraftFormId,
  availableInterfaces: readonly CampaignNetworkInterface[],
): CampaignDraftReadiness {
  const step = ['CMP-001', 'CMP-002', 'CMP-003', 'CMP-004', 'CMP-005'].indexOf(formId);
  if (step < 0) throw new TypeError('Unknown campaign draft form');
  const errors: CampaignFieldError[] = [];
  const check = (body: () => unknown) => {
    try {
      body();
    } catch (error) {
      if (!(error instanceof CampaignDraftValidationError)) throw error;
      errors.push(error.fieldError);
    }
  };
  check(() => validateCampaignMetadata(values.metadata));
  if (values.metadata.title === null) errors.push({ field: 'title', reason: 'REQUIRED' });
  if (step >= 1) {
    check(() => validateCampaignHost(values.host, availableInterfaces));
    for (const field of [
      'activePlayerCapacity',
      'hostAddress',
      'hostPort',
      'networkInterface',
    ] as const)
      if (values.host[field] === null) errors.push({ field, reason: 'REQUIRED' });
  }
  if (step >= 2 && !secretConfigured)
    errors.push({ field: 'masterTransferPassword', reason: 'REQUIRED' });
  if (step >= 3) {
    check(() => validateCampaignMode({ defaultFutureRollMode: values.defaultFutureRollMode }));
    if (values.defaultFutureRollMode === null)
      errors.push({ field: 'defaultFutureRollMode', reason: 'REQUIRED' });
  }
  return { ready: errors.length === 0, errors };
}
