import {
  decodeAdmissionPeerResponse,
  type AdmissionPeerLimits,
  type AdmissionPeerResponse,
} from './campaign-admission-peer-codec.js';
import { Buffer } from 'node:buffer';
import {
  campaignConnectionStatusValue,
  campaignReconnectReceiptValue,
  type CampaignConnectionStatus,
  type CampaignReconnectReceipt,
} from '@shared/campaign-lifecycle.js';
import { admissionCodecReaders as r } from '@shared/campaign-admission-codec.js';
import { canonicalPostSaveJson } from './local-character-export.js';
import {
  assertCampaignPeerRpcBodyFits,
  CAMPAIGN_PEER_CHANNEL_MAX_BYTES,
} from './campaign-peer-channel.js';

export type CampaignConnectionPeerCommand = { readonly schemaVersion: 1 } & (
  | { readonly operation: 'CAMPAIGN_CONNECTION_READ' }
  | {
      readonly operation: 'CAMPAIGN_CONNECTION_RETRY';
      readonly commandId: string;
      readonly disconnectCommandId: string;
    }
);
export type CampaignConnectionPeerResponse = {
  readonly schemaVersion: 1;
  readonly operation: CampaignConnectionPeerCommand['operation'];
} & (
  | { readonly outcome: 'STATUS'; readonly status: CampaignConnectionStatus }
  | {
      readonly outcome: 'RETRIED';
      readonly status: CampaignConnectionStatus;
      readonly receipt: CampaignReconnectReceipt;
    }
  | {
      readonly outcome: 'REFUSED';
      readonly code: 'UNAVAILABLE' | 'IDEMPOTENCY_CONFLICT' | 'STALE_REVISION';
    }
);
const operations = ['CAMPAIGN_CONNECTION_READ', 'CAMPAIGN_CONNECTION_RETRY'] as const;
function command(value: unknown): CampaignConnectionPeerCommand {
  const probe = r.exact(
    value,
    Object.hasOwn(value as object, 'commandId')
      ? 'schemaVersion operation commandId disconnectCommandId'
      : 'schemaVersion operation',
    '$.connectionCommand',
  );
  if (probe['schemaVersion'] !== 1) throw Error('Invalid campaign connection version');
  const operation = r.oneOf(probe['operation'], operations, '$.operation');
  r.exact(
    probe,
    operation === 'CAMPAIGN_CONNECTION_READ'
      ? 'schemaVersion operation'
      : 'schemaVersion operation commandId disconnectCommandId',
    '$.connectionCommand',
  );
  if (operation === 'CAMPAIGN_CONNECTION_READ') return { schemaVersion: 1, operation };
  return {
    schemaVersion: 1,
    operation,
    commandId: r.uuid(probe['commandId'], '$.commandId'),
    disconnectCommandId: r.uuid(probe['disconnectCommandId'], '$.disconnectCommandId'),
  };
}
function response(value: unknown): CampaignConnectionPeerResponse {
  const row = r.exact(
    value,
    typeof value === 'object' && value !== null && 'receipt' in value
      ? 'schemaVersion operation outcome status receipt'
      : typeof value === 'object' && value !== null && 'status' in value
        ? 'schemaVersion operation outcome status'
        : 'schemaVersion operation outcome code',
    '$.connectionResponse',
  );
  if (row['schemaVersion'] !== 1) throw Error('Invalid campaign connection version');
  const operation = r.oneOf(row['operation'], operations, '$.operation');
  if (row['outcome'] === 'REFUSED') {
    r.exact(row, 'schemaVersion operation outcome code', '$.connectionResponse');
    return {
      schemaVersion: 1,
      operation,
      outcome: 'REFUSED',
      code: r.oneOf(
        row['code'],
        ['UNAVAILABLE', 'IDEMPOTENCY_CONFLICT', 'STALE_REVISION'] as const,
        '$.code',
      ),
    };
  }
  const status = campaignConnectionStatusValue(row['status']);
  if (operation === 'CAMPAIGN_CONNECTION_READ') {
    r.exact(row, 'schemaVersion operation outcome status', '$.connectionResponse');
    if (row['outcome'] !== 'STATUS') throw Error('Invalid campaign connection outcome');
    return { schemaVersion: 1, operation, outcome: 'STATUS', status };
  }
  r.exact(row, 'schemaVersion operation outcome status receipt', '$.connectionResponse');
  if (row['outcome'] !== 'RETRIED') throw Error('Invalid campaign connection outcome');
  const receipt = campaignReconnectReceiptValue(row['receipt']);
  if (receipt.campaignId !== status.campaignId || receipt.deviceId !== status.deviceId)
    throw Error('Foreign reconnect receipt');
  return { schemaVersion: 1, operation, outcome: 'RETRIED', status, receipt };
}
function parsed(text: string): unknown {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > CAMPAIGN_PEER_CHANNEL_MAX_BYTES)
    throw Error('Invalid campaign connection body');
  const value: unknown = JSON.parse(text);
  if (canonicalPostSaveJson(value) !== text) throw Error('Noncanonical campaign connection body');
  return value;
}
function encoded(value: unknown): string {
  const text = canonicalPostSaveJson(value);
  assertCampaignPeerRpcBodyFits(text);
  return text;
}
export function decodeCampaignConnectionPeerCommand(
  text: string,
): CampaignConnectionPeerCommand | null {
  const value = parsed(text);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('operation' in value) ||
    !operations.some((op) => op === value.operation)
  )
    return null;
  return command(value);
}
export const encodeCampaignConnectionPeerCommand = (value: CampaignConnectionPeerCommand): string =>
  encoded(command(parsed(encoded(value))));
export const decodeCampaignConnectionPeerResponse = (
  text: string,
): CampaignConnectionPeerResponse => response(parsed(text));
export const encodeCampaignConnectionPeerResponse = (
  value: CampaignConnectionPeerResponse,
): string => encoded(response(parsed(encoded(value))));

/** A fresh host fold compares a complete owner observation, including Ready journal revisions. */
export interface CampaignLobbyCheckCommand {
  readonly schemaVersion: 1;
  readonly operation: 'CAMPAIGN_LOBBY_CHECK';
  readonly requestId: string;
  readonly technicalSessionId: string;
  readonly submitCommandId: string;
  readonly admittedTabId: string;
  readonly knownObservationSha256: string;
}
export type CampaignLobbyCheckResponse = CampaignLobbyCheckCommand &
  (
    | { readonly outcome: 'UNCHANGED'; readonly observationSha256: string }
    | {
        readonly outcome: 'CHANGED';
        readonly observationSha256: string;
        readonly manifest: Extract<AdmissionPeerResponse, { outcome: 'MANIFEST' }>;
      }
    | { readonly outcome: 'REFUSED'; readonly code: 'UNAVAILABLE' }
  );
const checkKeys =
  'schemaVersion operation requestId technicalSessionId submitCommandId admittedTabId knownObservationSha256';
function checkHash(value: unknown): string {
  const text = r.text(value, '$.observationSha256');
  if (!/^[0-9a-f]{64}$/u.test(text)) throw Error('Invalid observation digest');
  return text;
}
function lobbyCheckRecord(value: unknown): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    throw Error('Invalid lobby check record');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== 'string' ||
      !Object.hasOwn(descriptors[key]!, 'value') ||
      !descriptors[key]!.enumerable
    )
      throw Error('Invalid lobby check field');
  }
  return value as Record<string, unknown>;
}
function lobbyCheckCommand(value: unknown): CampaignLobbyCheckCommand {
  const row = r.exact(lobbyCheckRecord(value), checkKeys, '$.lobbyCheck');
  if (row['schemaVersion'] !== 1 || row['operation'] !== 'CAMPAIGN_LOBBY_CHECK')
    throw Error('Invalid lobby check');
  return {
    schemaVersion: 1,
    operation: 'CAMPAIGN_LOBBY_CHECK',
    requestId: r.uuid(row['requestId'], '$.requestId'),
    technicalSessionId: r.uuid(row['technicalSessionId'], '$.technicalSessionId'),
    submitCommandId: r.uuid(row['submitCommandId'], '$.submitCommandId'),
    admittedTabId: r.uuid(row['admittedTabId'], '$.admittedTabId'),
    knownObservationSha256: checkHash(row['knownObservationSha256']),
  };
}
function lobbyCheckResponse(
  value: unknown,
  limits: AdmissionPeerLimits,
): CampaignLobbyCheckResponse {
  const checked = lobbyCheckRecord(value);
  const refused = Object.hasOwn(checked, 'code');
  const row = r.exact(
    checked,
    checkKeys +
      (refused
        ? ' outcome code'
        : checked['outcome'] === 'CHANGED'
          ? ' outcome observationSha256 manifest'
          : ' outcome observationSha256'),
    '$.lobbyCheckResponse',
  );
  const header = lobbyCheckCommand(
    Object.fromEntries(checkKeys.split(' ').map((key) => [key, row[key]])),
  );
  if (row['outcome'] === 'REFUSED') {
    if (row['code'] !== 'UNAVAILABLE') throw Error('Invalid lobby check refusal');
    return { ...header, outcome: 'REFUSED', code: 'UNAVAILABLE' };
  }
  const outcome = r.oneOf(row['outcome'], ['UNCHANGED', 'CHANGED'] as const, '$.outcome');
  const observationSha256 = checkHash(row['observationSha256']);
  if ((outcome === 'UNCHANGED') !== (observationSha256 === header.knownObservationSha256))
    throw Error('Inconsistent lobby check');
  if (outcome === 'UNCHANGED') return { ...header, outcome, observationSha256 };
  // Manifest fields are flat. Reject accessors before canonicalization can evaluate them.
  const manifest = decodeAdmissionPeerResponse(
    canonicalPostSaveJson(lobbyCheckRecord(row['manifest'])),
    limits,
  );
  if (
    manifest.outcome !== 'MANIFEST' ||
    manifest.operation !== 'ADMISSION_LOBBY_BEGIN' ||
    manifest.requestId !== header.requestId ||
    manifest.technicalSessionId !== header.technicalSessionId ||
    manifest.submitCommandId !== header.submitCommandId ||
    manifest.publicationChecksum !== observationSha256 ||
    manifest.bodySha256 !== observationSha256
  )
    throw Error('Foreign lobby check manifest');
  return { ...header, outcome, observationSha256, manifest };
}
export function encodeCampaignLobbyCheckCommand(value: CampaignLobbyCheckCommand): string {
  const text = canonicalPostSaveJson(lobbyCheckCommand(value));
  assertCampaignPeerRpcBodyFits(text);
  return text;
}
export function decodeCampaignLobbyCheckCommand(text: string): CampaignLobbyCheckCommand | null {
  const value = parsed(text);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('operation' in value) ||
    value.operation !== 'CAMPAIGN_LOBBY_CHECK'
  )
    return null;
  return lobbyCheckCommand(value);
}
export function encodeCampaignLobbyCheckResponse(
  value: CampaignLobbyCheckResponse,
  limits: AdmissionPeerLimits,
): string {
  const text = canonicalPostSaveJson(lobbyCheckResponse(value, limits));
  assertCampaignPeerRpcBodyFits(text);
  return text;
}
export function decodeCampaignLobbyCheckResponse(
  text: string,
  limits: AdmissionPeerLimits,
): CampaignLobbyCheckResponse {
  return lobbyCheckResponse(parsed(text), limits);
}
