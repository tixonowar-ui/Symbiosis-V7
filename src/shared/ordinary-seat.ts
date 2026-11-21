import { admissionCodecReaders } from './campaign-admission-codec.js';
import { wireCodecPrimitives } from './wire-codec.js';
import type { JsonObject } from './wire-protocol.js';

export const ORDINARY_SEAT_ACK = 'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK' as const;

interface SeatEntry extends JsonObject {
  readonly seatId: string;
  readonly ordinal: number;
}
interface SeatViewBase extends JsonObject {
  readonly revision: number;
}
export type OrdinarySeatView = SeatViewBase &
  (
    | { readonly ordinarySeatView: 'WAITING' }
    | { readonly ordinarySeatView: 'SETUP'; readonly selectedCount: number }
    | {
        readonly ordinarySeatView: 'LIBRARY';
        readonly libraryContext: string;
        readonly candidates: readonly { readonly sourceUuid: string; readonly name: string }[];
        readonly selectedSourceUuids: readonly string[];
      }
    | {
        readonly ordinarySeatView: 'ROSTER';
        readonly roster: readonly SeatEntry[];
        readonly activeSeatIdOrNull: string | null;
        readonly eligibleTargetSeatIds?: readonly string[];
      }
    | {
        readonly ordinarySeatView: 'CURTAIN';
        readonly handoffId: string;
        readonly targetSeatId: string;
        readonly targetOrdinal: number;
        readonly sourceSeatIdOrNull: string | null;
        readonly signedReturnContext: string;
        readonly pendingCommandOwner: string | null;
      }
    | {
        readonly ordinarySeatView: 'ACTIVE';
        readonly seatId: string;
        readonly ordinal: number;
        readonly receiptId: string;
      }
  );

export type OrdinarySeatControlV3Message = {
  readonly protocolVersion: 3;
  readonly messageType: 'ordinary.seat.control';
  readonly requestId: string;
} & (
  | {
      readonly operation: 'SELECT';
      readonly expectedProjectionRevision: number;
      readonly targetSeatId: string;
    }
  | { readonly operation: 'RESUME'; readonly deliveryKeyOrNull: string | null }
  | {
      readonly operation: 'RESUME_EMPTY';
      readonly expectedProjectionRevision: number;
      readonly exitNavigationId: string;
    }
  | {
      readonly operation: 'RETURN_LIBRARY';
      readonly expectedProjectionRevision: number;
      readonly libraryContext: string;
      readonly selectedSourceUuids: readonly string[];
    }
);

export interface OrdinarySeatAckPayload extends JsonObject {
  readonly handoffId: string;
  readonly targetSeatId: string;
  readonly signedReturnContext: string;
  readonly decision: 'ACTIVATE_TARGET';
  readonly deliveryKey: string;
}

const { exact, integer, invalid, list, nullable, oneOf, text, unique, uuid, validated } =
  admissionCodecReaders;

function count(value: unknown, path: string, minimum: number): number {
  const n = integer(value, path, minimum);
  return n <= 3 ? n : invalid(path, 'at most three local seats', null);
}
function deliveryKey(value: unknown, path: string): string {
  const key = text(value, path);
  return /^[0-9a-f]{64}$/u.test(key) ? key : invalid(path, '32 byte delivery key', null);
}
function selectedFinals(value: unknown, path: string, minimum: number) {
  const ids = list(value, path).map((v) => uuid(v, path + '[]'));
  count(ids.length, path + '.length', minimum);
  unique(ids, path);
  return ids;
}

export function ordinarySeatControlValue(value: unknown): OrdinarySeatControlV3Message {
  const path = '$.ordinarySeatControl';
  const operation = oneOf(
    wireCodecPrimitives.record(value, path)['operation'],
    ['SELECT', 'RESUME', 'RESUME_EMPTY', 'RETURN_LIBRARY'] as const,
    path + '.operation',
  );
  const fields = {
    SELECT: 'expectedProjectionRevision targetSeatId',
    RESUME: 'deliveryKeyOrNull',
    RESUME_EMPTY: 'expectedProjectionRevision exitNavigationId',
    RETURN_LIBRARY: 'expectedProjectionRevision libraryContext selectedSourceUuids',
  };
  const row = exact(
    value,
    'protocolVersion messageType requestId operation ' + fields[operation],
    path,
  );
  if (row['protocolVersion'] !== 3 || row['messageType'] !== 'ordinary.seat.control')
    invalid(path, 'ordinary.seat.control version 3', null);
  text(row['requestId'], path + '.requestId');
  if (operation === 'RESUME_EMPTY') {
    integer(row['expectedProjectionRevision'], path + '.expectedProjectionRevision', 0);
    text(row['exitNavigationId'], path + '.exitNavigationId');
  } else if (operation === 'SELECT') {
    integer(row['expectedProjectionRevision'], path + '.expectedProjectionRevision', 0);
    uuid(row['targetSeatId'], path + '.targetSeatId');
  } else if (operation === 'RETURN_LIBRARY') {
    integer(row['expectedProjectionRevision'], path + '.expectedProjectionRevision', 0);
    deliveryKey(row['libraryContext'], path + '.libraryContext');
    selectedFinals(row['selectedSourceUuids'], path + '.selectedSourceUuids', 1);
  } else nullable(row['deliveryKeyOrNull'], path + '.deliveryKeyOrNull', deliveryKey);
  return validated(row);
}

export function ordinarySeatAckPayloadValue(value: unknown): OrdinarySeatAckPayload {
  const path = '$.ordinarySeatAck';
  const row = exact(value, 'handoffId targetSeatId signedReturnContext decision deliveryKey', path);
  uuid(row['handoffId'], path + '.handoffId');
  uuid(row['targetSeatId'], path + '.targetSeatId');
  text(row['signedReturnContext'], path + '.signedReturnContext');
  oneOf(row['decision'], ['ACTIVATE_TARGET'] as const, path + '.decision');
  deliveryKey(row['deliveryKey'], path + '.deliveryKey');
  return validated(row);
}

export function ordinarySeatViewValue(value: unknown): OrdinarySeatView {
  const path = '$.ordinarySeatView';
  const fields = {
    WAITING: '',
    SETUP: ' selectedCount',
    LIBRARY: ' libraryContext candidates selectedSourceUuids',
    ROSTER: ' roster activeSeatIdOrNull',
    CURTAIN:
      ' handoffId targetSeatId targetOrdinal sourceSeatIdOrNull signedReturnContext pendingCommandOwner',
    ACTIVE: ' seatId ordinal receiptId',
  };
  const kind = oneOf(
    wireCodecPrimitives.record(value, path)['ordinarySeatView'],
    ['WAITING', 'SETUP', 'LIBRARY', 'ROSTER', 'CURTAIN', 'ACTIVE'] as const,
    path,
  );
  const hasEligibleTargets =
    kind === 'ROSTER' &&
    Object.hasOwn(wireCodecPrimitives.record(value, path), 'eligibleTargetSeatIds');
  const row = exact(
    value,
    'ordinarySeatView revision' +
      fields[kind] +
      (hasEligibleTargets ? ' eligibleTargetSeatIds' : ''),
    path,
  );
  integer(row['revision'], path + '.revision', 0);
  if (kind === 'SETUP') count(row['selectedCount'], path + '.selectedCount', 0);
  if (kind === 'LIBRARY') {
    deliveryKey(row['libraryContext'], path + '.libraryContext');
    const ids = list(row['candidates'], path + '.candidates').map((v) => {
      const item = exact(v, 'sourceUuid name', path + '.candidates[]');
      text(item['name'], path + '.candidates[].name');
      return uuid(item['sourceUuid'], path + '.candidates[].sourceUuid');
    });
    unique(ids, path + '.candidates');
    if (
      selectedFinals(row['selectedSourceUuids'], path + '.selectedSourceUuids', 0).some(
        (id) => !ids.includes(id),
      )
    )
      invalid(path, 'current owned library selection', null);
  }
  if (kind === 'ROSTER') {
    const entries = list(row['roster'], path + '.roster');
    count(entries.length, path + '.roster.length', 0);
    const ids = entries.map((item, index) => {
      const e = exact(item, 'seatId ordinal', path + '.roster[]');
      if (e['ordinal'] !== index + 1) invalid(path + '.ordinal', 'ordered seat ordinal', null);
      return uuid(e['seatId'], path + '.seatId');
    });
    unique(ids, path + '.roster');
    const active = nullable(row['activeSeatIdOrNull'], path + '.activeSeatIdOrNull', uuid);
    if (active !== null && !ids.includes(active)) invalid(path, 'admitted active seat', null);
    if (
      hasEligibleTargets &&
      selectedFinals(row['eligibleTargetSeatIds'], path + '.eligibleTargetSeatIds', 0).some(
        (id) => active === null || id === active || !ids.includes(id),
      )
    )
      invalid(path, 'distinct eligible admitted target seats', null);
  }
  if (kind === 'CURTAIN') {
    uuid(row['handoffId'], path + '.handoffId');
    uuid(row['targetSeatId'], path + '.targetSeatId');
    count(row['targetOrdinal'], path + '.targetOrdinal', 1);
    nullable(row['sourceSeatIdOrNull'], path + '.sourceSeatIdOrNull', uuid);
    if (row['sourceSeatIdOrNull'] === row['targetSeatId']) invalid(path, 'distinct target', null);
    text(row['signedReturnContext'], path + '.signedReturnContext');
    nullable(row['pendingCommandOwner'], path + '.pendingCommandOwner', text);
  }
  if (kind === 'ACTIVE') {
    uuid(row['seatId'], path + '.seatId');
    count(row['ordinal'], path + '.ordinal', 1);
    uuid(row['receiptId'], path + '.receiptId');
  }
  return validated(row);
}
