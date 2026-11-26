import { admissionCodecReaders } from './campaign-admission-codec.js';
import { wireCodecPrimitives } from './wire-codec.js';
import type { JsonObject, WorkflowCommandCapabilityId } from './wire-protocol.js';

export const HOST_OWNER_PROFILE_CREATE = 'UI-CMD-LOCAL-OWNER-PROFILE-CREATE' as const;
export const HOST_SEAT_ACK = 'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK' as const;

export interface HostSeatProfile extends JsonObject {
  readonly targetLocalOwnerId: string;
  readonly targetProfileLabel: string;
}
export interface HostSeatEntry extends HostSeatProfile {
  readonly localControllerSeatId: string;
  readonly ordinal: number;
}
export interface HostSeatApplicant extends HostSeatProfile {
  readonly requestId: string;
}
export type HostSeatRecipient =
  | { readonly kind: 'GM' }
  | ({ readonly kind: 'CANDIDATE' } & HostSeatProfile)
  | ({ readonly kind: 'PLAYER'; readonly localControllerSeatId: string } & HostSeatProfile);
export type HostSeatView = JsonObject & { readonly revision: number } & (
    | { readonly hostSeatView: 'WAITING' }
    | { readonly hostSeatView: 'GM_ONLY' }
    | { readonly hostSeatView: 'SWITCH' }
    | {
        readonly hostSeatView: 'MANAGE';
        readonly campaignId: string;
        readonly gmContextId: string;
        readonly seats: readonly HostSeatEntry[];
        readonly returnedProfiles?: readonly HostSeatProfile[];
      }
    | {
        readonly hostSeatView: 'SETUP';
        readonly profiles: readonly HostSeatProfile[];
        readonly selectedProfileOrNull: HostSeatProfile | null;
      }
    | {
        readonly hostSeatView: 'ADMISSION';
        readonly profile: HostSeatProfile;
        readonly selectedSourceUuids: readonly string[];
      }
    | {
        readonly hostSeatView: 'ROSTER';
        readonly seats: readonly HostSeatEntry[];
        readonly activeSeatIdOrNull: string | null;
      }
    | {
        readonly hostSeatView: 'CURTAIN';
        readonly handoffId: string;
        readonly signedReturnContext: string;
        readonly target: HostSeatRecipient;
        readonly decision: HostSeatDecision;
      }
    | {
        readonly hostSeatView: 'ACTIVE';
        readonly target: HostSeatRecipient;
        readonly receiptId: string;
        readonly contextId: string;
        readonly networkScopeIdOrNull: string | null;
        readonly seats?: readonly HostSeatEntry[];
        readonly applicants?: readonly HostSeatApplicant[];
        readonly selectedSourceUuids?: readonly string[];
        readonly terminalResultReadOnly?: true;
      }
  );
export type HostSeatDecision = 'ACTIVATE_TARGET' | 'RETURN_INITIATOR';
export type HostSeatControlV3Message = {
  readonly messageType: 'host.seat.control';
  readonly protocolVersion: 3;
  readonly requestId: string;
} & (
  | {
      readonly operation: 'RESUME';
      readonly deliveryKeyOrNull: string | null;
      readonly supportedWorkflowCommandIds: readonly WorkflowCommandCapabilityId[];
      readonly unacknowledgedCommandIds: readonly string[];
    }
  | ({ readonly expectedProjectionRevision: number } & (
      | { readonly operation: 'ENTER_SETUP'; readonly deliveryKey: string }
      | { readonly operation: 'SELECT_PROFILE'; readonly targetLocalOwnerId: string }
      | { readonly operation: 'RESUME_PROFILE'; readonly targetLocalOwnerId: string }
      | { readonly operation: 'SELECT_SEAT'; readonly targetSeatId: string }
      | { readonly operation: 'SELECT_FINALS'; readonly selectedSourceUuids: readonly string[] }
      | { readonly operation: 'SELECT_APPLICANT'; readonly selectedRequestId: string }
    ))
);
export interface HostSeatAckPayload extends JsonObject {
  readonly handoffId: string;
  readonly signedReturnContext: string;
  readonly decision: HostSeatDecision;
  readonly deliveryKey: string;
}
const { exact, integer, invalid, list, nullable, oneOf, text, unique, uuid, validated } =
  admissionCodecReaders;

function digest(value: unknown, path: string) {
  const key = text(value, path);
  return /^[0-9a-f]{64}$/u.test(key) ? key : invalid(path, '32-byte delivery key', null);
}
function profile(row: Record<string, unknown>, path: string) {
  uuid(row['targetLocalOwnerId'], path + '.targetLocalOwnerId');
  const label = text(row['targetProfileLabel'], path + '.targetProfileLabel');
  if (!label.trim()) invalid(path + '.targetProfileLabel', 'nonempty profile label', null);
}
function readProfile(v: unknown, path: string): HostSeatProfile {
  const r = exact(v, 'targetLocalOwnerId targetProfileLabel', path);
  profile(r, path);
  return validated(r);
}
function uuidSelection(v: unknown, path: string) {
  const ids = list(v, path).map((item) => uuid(item, path + '[]'));
  if (ids.length > 3) invalid(path, 'zero to three owned FINALs', null);
  unique(ids, path);
}
function recipient(v: unknown, path: string) {
  const kind = oneOf(
    wireCodecPrimitives.record(v, path)['kind'],
    ['GM', 'CANDIDATE', 'PLAYER'] as const,
    path + '.kind',
  );
  const row = exact(
    v,
    kind === 'GM'
      ? 'kind'
      : kind === 'CANDIDATE'
        ? 'kind targetLocalOwnerId targetProfileLabel'
        : 'kind targetLocalOwnerId targetProfileLabel localControllerSeatId',
    path,
  );
  if (kind !== 'GM') profile(row, path);
  if (kind === 'PLAYER') uuid(row['localControllerSeatId'], path + '.localControllerSeatId');
  return kind;
}
function decision(value: unknown, path: string) {
  return oneOf(value, ['ACTIVATE_TARGET', 'RETURN_INITIATOR'] as const, path);
}
export function hostSeatControlValue(value: unknown): HostSeatControlV3Message {
  const p = '$.hostSeatControl';
  const operation = oneOf(
    wireCodecPrimitives.record(value, p)['operation'],
    [
      'RESUME',
      'ENTER_SETUP',
      'SELECT_PROFILE',
      'RESUME_PROFILE',
      'SELECT_SEAT',
      'SELECT_FINALS',
      'SELECT_APPLICANT',
    ] as const,
    p + '.operation',
  );
  const fields = {
    RESUME: 'deliveryKeyOrNull supportedWorkflowCommandIds unacknowledgedCommandIds',
    ENTER_SETUP: 'deliveryKey',
    SELECT_PROFILE: 'targetLocalOwnerId',
    RESUME_PROFILE: 'targetLocalOwnerId',
    SELECT_SEAT: 'targetSeatId',
    SELECT_FINALS: 'selectedSourceUuids',
    SELECT_APPLICANT: 'selectedRequestId',
  };
  const r = exact(
    value,
    'protocolVersion messageType requestId operation ' +
      (operation === 'RESUME' ? '' : 'expectedProjectionRevision ') +
      fields[operation],
    p,
  );
  if (r['protocolVersion'] !== 3 || r['messageType'] !== 'host.seat.control')
    invalid(p, 'host.seat.control version 3', null);
  text(r['requestId'], p + '.requestId');
  if (operation !== 'RESUME')
    integer(r['expectedProjectionRevision'], p + '.expectedProjectionRevision', 0);
  if (operation === 'RESUME') {
    nullable(r['deliveryKeyOrNull'], p + '.deliveryKeyOrNull', digest);
    for (const field of ['supportedWorkflowCommandIds', 'unacknowledgedCommandIds']) {
      const ids = list(r[field], p + '.' + field).map((id) => text(id, p + '.' + field + '[]'));
      if (
        field === 'supportedWorkflowCommandIds' &&
        ids.some((id) => !/^UI-CMD-[A-Z0-9-]+$/u.test(id))
      )
        invalid(p + '.' + field, 'workflow command IDs', null);
      unique(ids, p + '.' + field);
    }
  } else if (operation === 'ENTER_SETUP') digest(r['deliveryKey'], p + '.deliveryKey');
  else if (operation === 'SELECT_FINALS')
    uuidSelection(r['selectedSourceUuids'], p + '.selectedSourceUuids');
  else uuid(r[fields[operation]], p + '.' + fields[operation]);
  return validated(r);
}
export function hostSeatAckPayloadValue(value: unknown): HostSeatAckPayload {
  const p = '$.hostSeatAck',
    r = exact(value, 'handoffId signedReturnContext decision deliveryKey', p);
  uuid(r['handoffId'], p + '.handoffId');
  text(r['signedReturnContext'], p + '.signedReturnContext');
  decision(r['decision'], p + '.decision');
  digest(r['deliveryKey'], p + '.deliveryKey');
  return validated(r);
}
export function hostSeatViewValue(value: unknown): HostSeatView {
  const p = '$.hostSeatView';
  const kind = oneOf(
    wireCodecPrimitives.record(value, p)['hostSeatView'],
    [
      'WAITING',
      'GM_ONLY',
      'SWITCH',
      'MANAGE',
      'SETUP',
      'ADMISSION',
      'ROSTER',
      'CURTAIN',
      'ACTIVE',
    ] as const,
    p + '.hostSeatView',
  );
  const fields = {
    WAITING: '',
    GM_ONLY: '',
    SWITCH: '',
    MANAGE: ' campaignId gmContextId seats',
    SETUP: ' profiles selectedProfileOrNull',
    ADMISSION: ' profile selectedSourceUuids',
    ROSTER: ' seats activeSeatIdOrNull',
    CURTAIN: ' handoffId signedReturnContext target decision',
    ACTIVE: ' target receiptId contextId networkScopeIdOrNull',
  };
  const hasSeats =
    kind === 'ACTIVE' && Object.hasOwn(wireCodecPrimitives.record(value, p), 'seats');
  const hasSelection =
    kind === 'ACTIVE' && Object.hasOwn(wireCodecPrimitives.record(value, p), 'selectedSourceUuids');
  const hasApplicants =
    kind === 'ACTIVE' && Object.hasOwn(wireCodecPrimitives.record(value, p), 'applicants');
  const hasTerminal =
    kind === 'ACTIVE' &&
    Object.hasOwn(wireCodecPrimitives.record(value, p), 'terminalResultReadOnly');
  const hasReturnedProfiles =
    kind === 'MANAGE' && Object.hasOwn(wireCodecPrimitives.record(value, p), 'returnedProfiles');
  const r = exact(
    value,
    'hostSeatView revision' +
      fields[kind] +
      (hasSeats ? ' seats' : '') +
      (hasSelection ? ' selectedSourceUuids' : '') +
      (hasReturnedProfiles ? ' returnedProfiles' : '') +
      (hasTerminal ? ' terminalResultReadOnly' : '') +
      (hasApplicants ? ' applicants' : ''),
    p,
  );
  integer(r['revision'], p + '.revision', 0);
  if (kind === 'MANAGE' || kind === 'ROSTER' || hasSeats) {
    const seats = list(r['seats'], p + '.seats');
    if (seats.length > 3) invalid(p + '.seats', 'at most three admitted seats', null);
    const ids = seats.map((seat, i) => {
      const s = exact(
        seat,
        'targetLocalOwnerId targetProfileLabel localControllerSeatId ordinal',
        p + '.seats[]',
      );
      profile(s, p + '.seats[]');
      if (s['ordinal'] !== i + 1) invalid(p + '.seats[].ordinal', 'ordered seat ordinal', null);
      return uuid(s['localControllerSeatId'], p + '.seats[].localControllerSeatId');
    });
    unique(ids, p + '.seats');
    if (kind === 'MANAGE') {
      uuid(r['campaignId'], p + '.campaignId');
      uuid(r['gmContextId'], p + '.gmContextId');
      if (hasReturnedProfiles) {
        const profiles = list(r['returnedProfiles'], p + '.returnedProfiles').map((x) =>
          readProfile(x, p + '.returnedProfiles[]'),
        );
        if (!profiles.length)
          invalid(p + '.returnedProfiles', 'previous provisional recipients', null);
        unique(
          profiles.map((x) => x.targetLocalOwnerId),
          p + '.returnedProfiles',
        );
      }
    } else if (kind === 'ROSTER') {
      const id = nullable(r['activeSeatIdOrNull'], p + '.activeSeatIdOrNull', uuid);
      if (id !== null && !ids.includes(id)) invalid(p, 'an admitted active seat', null);
    }
  }
  if (kind === 'SETUP') {
    const profiles = list(r['profiles'], p + '.profiles').map((x) =>
      readProfile(x, p + '.profiles[]'),
    );
    unique(
      profiles.map((x) => x.targetLocalOwnerId),
      p + '.profiles',
    );
    const selected = nullable(
      r['selectedProfileOrNull'],
      p + '.selectedProfileOrNull',
      readProfile,
    );
    if (
      selected !== null &&
      !profiles.some(
        (x) =>
          x.targetLocalOwnerId === selected.targetLocalOwnerId &&
          x.targetProfileLabel === selected.targetProfileLabel,
      )
    )
      invalid(p, 'an existing exact profile', null);
  } else if (kind === 'ADMISSION') {
    readProfile(r['profile'], p + '.profile');
    uuidSelection(r['selectedSourceUuids'], p + '.selectedSourceUuids');
  } else if (kind === 'CURTAIN') {
    uuid(r['handoffId'], p + '.handoffId');
    text(r['signedReturnContext'], p + '.signedReturnContext');
    recipient(r['target'], p + '.target');
    decision(r['decision'], p + '.decision');
  } else if (kind === 'ACTIVE') {
    const role = recipient(r['target'], p + '.target');
    if (hasSeats && role !== 'GM') invalid(p + '.seats', 'GM-only seat selection', null);
    if (
      hasTerminal &&
      (role !== 'CANDIDATE' ||
        r['networkScopeIdOrNull'] === null ||
        r['terminalResultReadOnly'] !== true ||
        hasSelection ||
        hasSeats ||
        hasApplicants)
    )
      invalid(p, 'addressed terminal candidate result', null);
    if (hasApplicants) {
      if (role !== 'GM' || hasSeats) invalid(p, 'GM-only request selection', null);
      const ids = list(r['applicants'], p + '.applicants').map((x) => {
        const a = exact(x, 'targetLocalOwnerId targetProfileLabel requestId', p + '.applicants[]');
        profile(a, p + '.applicants[]');
        return uuid(a['requestId'], p + '.applicants[].requestId');
      });
      unique(ids, p + '.applicants');
    }
    if (hasSelection) {
      if (role !== 'CANDIDATE' || r['networkScopeIdOrNull'] !== null)
        invalid(p, 'own candidate library selection', null);
      uuidSelection(r['selectedSourceUuids'], p + '.selectedSourceUuids');
    }
    uuid(r['receiptId'], p + '.receiptId');
    uuid(r['contextId'], p + '.contextId');
    const scope = nullable(r['networkScopeIdOrNull'], p + '.networkScopeIdOrNull', uuid);
    if ((role === 'GM' && scope !== null) || (role === 'PLAYER' && scope === null))
      invalid(p, 'matching active scope', null);
  }
  return validated(r);
}
