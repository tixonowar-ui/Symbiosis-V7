import { Buffer } from 'node:buffer';
import type { FinalAdmissionCandidateDescriptor } from './device-admission-candidate.js';
import { CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES } from './campaign-peer-handshake.js';
import { canonicalPostSaveJson } from './local-character-export.js';

export interface DeviceAdmissionPeerCommandLimits {
  readonly maxSubmitBodyBytes: number;
  readonly maxWitnessBytes: number;
  readonly maxChunkBytes: number;
}
export interface DeviceAdmissionCandidateManifest {
  readonly descriptor: FinalAdmissionCandidateDescriptor;
  readonly witnessSha256: string;
  readonly witnessByteLength: number;
}
export type DeviceAdmissionPeerCommand = { readonly schemaVersion: 1 } & (
  | {
      readonly operation: 'CONNECTION_OPEN';
      readonly commandId: string;
      readonly attemptId: string;
      readonly campaignCheckpointSha256: string;
    }
  | {
      readonly operation: 'CONNECTION_RECOVER';
      readonly commandId: string;
      readonly attemptId: string;
      readonly semanticBodySha256: string;
    }
  | {
      readonly operation: 'DEVICE_REQUEST_CANCEL';
      readonly commandId: string;
      readonly requestId: string;
      readonly technicalSessionId: string;
      readonly requestRevision: number;
      readonly reason: string;
    }
  | {
      readonly operation: 'DEVICE_REQUEST_RECOVER';
      readonly requestId: string;
      readonly technicalSessionId: string;
      readonly submitCommandId: string;
    }
  | {
      readonly operation: 'DEVICE_REQUEST_BIND_LANE';
      readonly commandId: string;
      readonly requestId: string;
      readonly technicalSessionId: string;
      readonly submitCommandId: string;
      readonly batchSha256: string;
      readonly localControllerSeatId: string;
    }
  | {
      readonly operation: 'DEVICE_REQUEST_BEGIN';
      readonly commandId: string;
      readonly requestId: string;
      readonly technicalSessionId: string;
      readonly connectionRevision: number;
      readonly campaignCheckpointSha256: string;
      readonly candidates: readonly DeviceAdmissionCandidateManifest[];
      readonly submitBodySha256: string;
      readonly submitBodyByteLength: number;
    }
  | {
      readonly operation: 'DEVICE_REQUEST_CHUNK';
      readonly transferId: string;
      readonly chunkIndex: number;
      readonly bytesBase64: string;
    }
  | {
      readonly operation: 'DEVICE_REQUEST_COMMIT';
      readonly transferId: string;
    }
);
export type DeviceAdmissionPeerCommandErrorCode =
  'INVALID_COMMAND' | 'INVALID_LIMITS' | 'COMMAND_TOO_LARGE';
export type DeviceAdmissionPeerCommandField =
  | 'command'
  | 'limits'
  | 'schemaVersion'
  | 'operation'
  | 'commandId'
  | 'attemptId'
  | 'campaignCheckpointSha256'
  | 'semanticBodySha256'
  | 'requestId'
  | 'technicalSessionId'
  | 'requestRevision'
  | 'reason'
  | 'submitCommandId'
  | 'batchSha256'
  | 'localControllerSeatId'
  | 'connectionRevision'
  | 'candidates'
  | 'manifest'
  | 'descriptor'
  | 'sourceUuid'
  | 'sourceSnapshotId'
  | 'finalSnapshotVersion'
  | 'metadataRevision'
  | 'sourceChecksum'
  | 'exportChecksum'
  | 'exportBytesSha256'
  | 'baselineVersion'
  | 'witnessSha256'
  | 'witnessByteLength'
  | 'submitBodySha256'
  | 'submitBodyByteLength'
  | 'transferId'
  | 'chunkIndex'
  | 'bytesBase64';
export class DeviceAdmissionPeerCommandError extends Error {
  constructor(
    readonly code: DeviceAdmissionPeerCommandErrorCode,
    readonly field: DeviceAdmissionPeerCommandField,
  ) {
    super(`device admission peer command: ${code}:${field}`);
  }
}
const failures = new WeakMap<
  object,
  {
    readonly code: DeviceAdmissionPeerCommandErrorCode;
    readonly field: DeviceAdmissionPeerCommandField;
  }
>();
const fail = (
  field: DeviceAdmissionPeerCommandField,
  code: DeviceAdmissionPeerCommandErrorCode = 'INVALID_COMMAND',
): never => {
  const error = new DeviceAdmissionPeerCommandError(code, field);
  failures.set(error, { code, field });
  throw error;
};
function checked<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    // Preserve only failures made here; an arbitrary thrown error can forge this public class.
    const failure = typeof error === 'object' && error !== null ? failures.get(error) : undefined;
    if (failure !== undefined)
      throw new DeviceAdmissionPeerCommandError(failure.code, failure.field);
    return fail('command');
  }
}
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const BASELINE = /^sha256:[0-9a-f]{64}$/u;
function record(
  value: unknown,
  keys: readonly string[],
  field: DeviceAdmissionPeerCommandField,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(field);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(field);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some(
      (key) =>
        descriptors[key] === undefined ||
        !descriptors[key].enumerable ||
        !Object.hasOwn(descriptors[key], 'value'),
    )
  )
    return fail(field);
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value as unknown]));
}
function limitsAt(value: DeviceAdmissionPeerCommandLimits): DeviceAdmissionPeerCommandLimits {
  try {
    const row = record(value, ['maxSubmitBodyBytes', 'maxWitnessBytes', 'maxChunkBytes'], 'limits');
    if (Object.values(row).some((n) => typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0))
      return fail('limits', 'INVALID_LIMITS');
    return Object.freeze({ ...row }) as unknown as DeviceAdmissionPeerCommandLimits;
  } catch {
    return fail('limits', 'INVALID_LIMITS');
  }
}
function identifier(value: unknown, field: DeviceAdmissionPeerCommandField): string {
  return typeof value === 'string' && value.length > 0 ? value : fail(field);
}
function uuid(value: unknown, field: DeviceAdmissionPeerCommandField): string {
  const id = identifier(value, field);
  return UUID_V4.test(id) ? id : fail(field);
}
function digest(value: unknown, field: DeviceAdmissionPeerCommandField): string {
  const hash = identifier(value, field);
  return SHA256.test(hash) ? hash : fail(field);
}
function revision(value: unknown, field: DeviceAdmissionPeerCommandField): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail(field);
}
function length(value: unknown, maximum: number, field: DeviceAdmissionPeerCommandField): number {
  const bytes = revision(value, field);
  return bytes > 0 && bytes <= maximum ? bytes : fail(field);
}
function reason(value: unknown): string {
  const text = identifier(value, 'reason');
  if (text.trim().length === 0) return fail('reason');
  for (const character of text)
    if (/[\p{Cc}\ud800-\udfff]/u.test(character) && !['\n', '\r', '\t'].includes(character))
      return fail('reason');
  return text;
}
function descriptor(value: unknown): FinalAdmissionCandidateDescriptor {
  const d = record(
    value,
    [
      'sourceUuid',
      'sourceSnapshotId',
      'finalSnapshotVersion',
      'metadataRevision',
      'sourceChecksum',
      'exportChecksum',
      'exportBytesSha256',
      'baselineVersion',
    ],
    'descriptor',
  );
  const baselineVersion = identifier(d['baselineVersion'], 'baselineVersion');
  if (!BASELINE.test(baselineVersion)) return fail('baselineVersion');
  return Object.freeze({
    sourceUuid: identifier(d['sourceUuid'], 'sourceUuid'),
    sourceSnapshotId: identifier(d['sourceSnapshotId'], 'sourceSnapshotId'),
    finalSnapshotVersion: revision(d['finalSnapshotVersion'], 'finalSnapshotVersion'),
    metadataRevision: revision(d['metadataRevision'], 'metadataRevision'),
    sourceChecksum: digest(d['sourceChecksum'], 'sourceChecksum'),
    exportChecksum: digest(d['exportChecksum'], 'exportChecksum'),
    exportBytesSha256: digest(d['exportBytesSha256'], 'exportBytesSha256'),
    baselineVersion,
  });
}
function manifest(
  value: unknown,
  limits: DeviceAdmissionPeerCommandLimits,
): readonly DeviceAdmissionCandidateManifest[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 ||
    value.length > 3
  )
    return fail('candidates');
  const keys = Array.from({ length: value.length }, (_, index) => String(index));
  if (
    Reflect.ownKeys(value).length !== value.length + 1 ||
    keys.some((key) => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return d === undefined || !d.enumerable || !Object.hasOwn(d, 'value');
    })
  )
    return fail('candidates');
  const result = value.map((entry: unknown) => {
    const row = record(entry, ['descriptor', 'witnessSha256', 'witnessByteLength'], 'manifest');
    return Object.freeze({
      descriptor: descriptor(row['descriptor']),
      witnessSha256: digest(row['witnessSha256'], 'witnessSha256'),
      witnessByteLength: length(
        row['witnessByteLength'],
        limits.maxWitnessBytes,
        'witnessByteLength',
      ),
    });
  });
  if (new Set(result.map((entry) => entry.descriptor.sourceUuid)).size !== result.length)
    return fail('candidates');
  return Object.freeze(result);
}
function chunk(value: unknown, maximum: number): string {
  const text = identifier(value, 'bytesBase64');
  // Bound allocation even when a configured chunk limit exceeds one control frame.
  if (text.length > CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES) return fail('bytesBase64');
  const decoded = Buffer.from(text, 'base64');
  if (decoded.length < 1 || decoded.length > maximum || decoded.toString('base64') !== text)
    return fail('bytesBase64');
  return text;
}
const BASE_KEYS = ['schemaVersion', 'operation'];
function command(
  value: unknown,
  limits: DeviceAdmissionPeerCommandLimits,
): DeviceAdmissionPeerCommand {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('command');
  const header = Object.getOwnPropertyDescriptors(value);
  if (
    header['schemaVersion'] === undefined ||
    !Object.hasOwn(header['schemaVersion'], 'value') ||
    header['schemaVersion'].value !== 1
  )
    return fail('schemaVersion');
  if (header['operation'] === undefined || !Object.hasOwn(header['operation'], 'value'))
    return fail('operation');
  const operation: unknown = header['operation'].value;
  const closed = (...keys: string[]) => record(value, [...BASE_KEYS, ...keys], 'command');
  const base = { schemaVersion: 1 as const };
  switch (operation) {
    case 'CONNECTION_OPEN': {
      const r = closed('commandId', 'attemptId', 'campaignCheckpointSha256');
      return Object.freeze({
        ...base,
        operation,
        commandId: identifier(r['commandId'], 'commandId'),
        attemptId: identifier(r['attemptId'], 'attemptId'),
        campaignCheckpointSha256: digest(r['campaignCheckpointSha256'], 'campaignCheckpointSha256'),
      });
    }
    case 'CONNECTION_RECOVER': {
      const r = closed('commandId', 'attemptId', 'semanticBodySha256');
      return Object.freeze({
        ...base,
        operation,
        commandId: identifier(r['commandId'], 'commandId'),
        attemptId: identifier(r['attemptId'], 'attemptId'),
        semanticBodySha256: digest(r['semanticBodySha256'], 'semanticBodySha256'),
      });
    }
    case 'DEVICE_REQUEST_CANCEL': {
      const r = closed('commandId', 'requestId', 'technicalSessionId', 'requestRevision', 'reason');
      return Object.freeze({
        ...base,
        operation,
        commandId: identifier(r['commandId'], 'commandId'),
        requestId: uuid(r['requestId'], 'requestId'),
        technicalSessionId: uuid(r['technicalSessionId'], 'technicalSessionId'),
        requestRevision: revision(r['requestRevision'], 'requestRevision'),
        reason: reason(r['reason']),
      });
    }
    case 'DEVICE_REQUEST_RECOVER': {
      const r = closed('requestId', 'technicalSessionId', 'submitCommandId');
      return Object.freeze({
        ...base,
        operation,
        requestId: uuid(r['requestId'], 'requestId'),
        technicalSessionId: uuid(r['technicalSessionId'], 'technicalSessionId'),
        submitCommandId: identifier(r['submitCommandId'], 'submitCommandId'),
      });
    }
    case 'DEVICE_REQUEST_BIND_LANE': {
      const r = closed(
        'commandId',
        'requestId',
        'technicalSessionId',
        'submitCommandId',
        'batchSha256',
        'localControllerSeatId',
      );
      const result = {
        ...base,
        operation,
        commandId: identifier(r['commandId'], 'commandId'),
        requestId: uuid(r['requestId'], 'requestId'),
        technicalSessionId: uuid(r['technicalSessionId'], 'technicalSessionId'),
        submitCommandId: identifier(r['submitCommandId'], 'submitCommandId'),
        batchSha256: digest(r['batchSha256'], 'batchSha256'),
        localControllerSeatId: uuid(r['localControllerSeatId'], 'localControllerSeatId'),
      };
      if (
        new Set([
          result.commandId,
          result.requestId,
          result.technicalSessionId,
          result.submitCommandId,
          result.localControllerSeatId,
        ]).size !== 5
      )
        return fail('command');
      return Object.freeze(result);
    }
    case 'DEVICE_REQUEST_BEGIN': {
      const r = closed(
        'commandId',
        'requestId',
        'technicalSessionId',
        'connectionRevision',
        'campaignCheckpointSha256',
        'candidates',
        'submitBodySha256',
        'submitBodyByteLength',
      );
      return Object.freeze({
        ...base,
        operation,
        commandId: identifier(r['commandId'], 'commandId'),
        requestId: uuid(r['requestId'], 'requestId'),
        technicalSessionId: uuid(r['technicalSessionId'], 'technicalSessionId'),
        connectionRevision: revision(r['connectionRevision'], 'connectionRevision'),
        campaignCheckpointSha256: digest(r['campaignCheckpointSha256'], 'campaignCheckpointSha256'),
        candidates: manifest(r['candidates'], limits),
        submitBodySha256: digest(r['submitBodySha256'], 'submitBodySha256'),
        submitBodyByteLength: length(
          r['submitBodyByteLength'],
          limits.maxSubmitBodyBytes,
          'submitBodyByteLength',
        ),
      });
    }
    case 'DEVICE_REQUEST_CHUNK': {
      const r = closed('transferId', 'chunkIndex', 'bytesBase64');
      return Object.freeze({
        ...base,
        operation,
        transferId: uuid(r['transferId'], 'transferId'),
        chunkIndex: revision(r['chunkIndex'], 'chunkIndex'),
        bytesBase64: chunk(r['bytesBase64'], limits.maxChunkBytes),
      });
    }
    case 'DEVICE_REQUEST_COMMIT': {
      const r = closed('transferId');
      return Object.freeze({ ...base, operation, transferId: uuid(r['transferId'], 'transferId') });
    }
    default:
      return fail('operation');
  }
}

/** Private syntax only: authenticated channel binding, transfer state and candidate replay remain mandatory. */
export function encodeDeviceAdmissionPeerCommand(
  value: DeviceAdmissionPeerCommand,
  limits: DeviceAdmissionPeerCommandLimits,
): string {
  return checked(() => {
    const parsed = command(value, limitsAt(limits));
    const text = canonicalPostSaveJson(parsed);
    if (Buffer.byteLength(text, 'utf8') > CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES)
      return fail('command', 'COMMAND_TOO_LARGE');
    return text;
  });
}
export function decodeDeviceAdmissionPeerCommand(
  source: unknown,
  limits: DeviceAdmissionPeerCommandLimits,
): DeviceAdmissionPeerCommand {
  return checked(() => {
    const checkedLimits = limitsAt(limits);
    if (typeof source !== 'string') return fail('command');
    if (Buffer.byteLength(source, 'utf8') > CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES)
      return fail('command', 'COMMAND_TOO_LARGE');
    const value: unknown = JSON.parse(source);
    const parsed = command(value, checkedLimits);
    if (canonicalPostSaveJson(parsed) !== source) return fail('command');
    return parsed;
  });
}
