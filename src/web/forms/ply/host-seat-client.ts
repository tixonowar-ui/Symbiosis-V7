import type { ActionKey } from '@generated/types/atlas.js';
import {
  HOST_OWNER_PROFILE_CREATE,
  HOST_SEAT_ACK,
  hostSeatAckPayloadValue,
  hostSeatViewValue,
} from '@shared/host-seat.js';
import type { HostSeatAckPayload, HostSeatView } from '@shared/host-seat.js';
import { reconnectFingerprint } from '@shared/reconnect-fingerprint.js';
import type {
  CommandReceipt,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';

export type ActiveHostSeat = Extract<HostSeatView, { hostSeatView: 'ACTIVE' }>;
export type HostSeatInput =
  | { readonly kind: 'CREATE_PROFILE'; readonly label: string }
  | { readonly kind: 'SELECT_PROFILE'; readonly id: string }
  | { readonly kind: 'RESUME_PROFILE'; readonly id: string }
  | { readonly kind: 'SELECT_SEAT'; readonly id: string }
  | { readonly kind: 'SELECT_APPLICANT'; readonly id: string }
  | { readonly kind: 'SELECT_FINALS'; readonly ids: readonly string[] };

export const HOST_DELIVERY_STORAGE = 'symbiosis.host-seat.delivery.v1';
type HostAck = WorkflowCommandRequestMessage<typeof HOST_SEAT_ACK, HostSeatAckPayload>;
type ActiveGrant = {
  readonly kind: 'ACTIVE';
  readonly key: string;
  readonly receiptId: string;
  readonly targetFingerprint: string;
  readonly revision: number;
};
type SetupGrant = {
  readonly kind: 'SETUP';
  readonly key: string;
  readonly gmFingerprint: string;
  readonly returnReceiptId?: string;
  readonly revision?: number;
};
export type SetupSource =
  ActiveGrant | SetupGrant | { readonly kind: 'BOOTSTRAP'; readonly gmContextId: string };
export type HostDelivery =
  | (SetupGrant & { readonly previous?: SetupSource; readonly sourceRevision?: number })
  | { readonly kind: 'NEUTRAL' }
  | {
      readonly kind: 'ACK';
      readonly key: string;
      readonly request: HostAck;
      readonly targetFingerprint: string;
    }
  | ActiveGrant;

export function newHostDeliveryKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export function hostAckDelivery(
  view: Extract<HostSeatView, { hostSeatView: 'CURTAIN' }>,
  revisions: RevisionVector,
  commandId: string,
): Extract<HostDelivery, { kind: 'ACK' }> {
  const key = newHostDeliveryKey();
  return {
    kind: 'ACK',
    key,
    targetFingerprint: reconnectFingerprint(view.target),
    request: {
      commandId,
      commandKind: 'workflow-command',
      messageType: 'command.request',
      protocolVersion: 1,
      role: view.target.kind === 'GM' ? 'gm' : 'player',
      workflowCommandId: HOST_SEAT_ACK,
      expectedRevisions: { ...revisions },
      payload: {
        handoffId: view.handoffId,
        signedReturnContext: view.signedReturnContext,
        decision: view.decision,
        deliveryKey: key,
      },
    },
  };
}

export function readHostDelivery(): HostDelivery | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(HOST_DELIVERY_STORAGE);
  if (raw === null) return null;
  return parseHostDelivery(JSON.parse(raw), true);
}

function parseHostDelivery(value: unknown, allowSetupSource: boolean): HostDelivery {
  if (typeof value !== 'object' || value === null || !('kind' in value))
    throw new Error('Invalid host handoff witness');
  if (value.kind === 'NEUTRAL' && Object.keys(value).length === 1) return { kind: 'NEUTRAL' };
  if (!('key' in value) || typeof value.key !== 'string' || !/^[0-9a-f]{64}$/u.test(value.key))
    throw new Error('Invalid host handoff key');
  if (
    value.kind === 'SETUP' &&
    'gmFingerprint' in value &&
    typeof value.gmFingerprint === 'string' &&
    /^[0-9a-f]{64}$/u.test(value.gmFingerprint) &&
    Object.keys(value).every((k) =>
      [
        'kind',
        'key',
        'gmFingerprint',
        'returnReceiptId',
        'revision',
        'previous',
        'sourceRevision',
      ].includes(k),
    )
  ) {
    const revision = 'revision' in value ? value.revision : undefined;
    const sourceRevision = 'sourceRevision' in value ? value.sourceRevision : undefined;
    const returnReceiptId = 'returnReceiptId' in value ? value.returnReceiptId : undefined;
    if (
      revision !== undefined &&
      (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
    )
      throw new Error('Invalid setup revision');
    if (
      sourceRevision !== undefined &&
      (!('previous' in value) ||
        revision === undefined ||
        typeof sourceRevision !== 'number' ||
        !Number.isSafeInteger(sourceRevision) ||
        sourceRevision < 0 ||
        sourceRevision > revision)
    )
      throw new Error('Invalid setup source revision');
    if (
      returnReceiptId !== undefined &&
      (typeof returnReceiptId !== 'string' || returnReceiptId.length === 0)
    )
      throw new Error('Invalid setup return receipt');
    let previous: SetupSource | undefined;
    if ('previous' in value) {
      if (!allowSetupSource || !value.previous || typeof value.previous !== 'object')
        throw new Error('Invalid prior GM proof');
      const p = value.previous;
      if (
        'kind' in p &&
        p.kind === 'BOOTSTRAP' &&
        Object.keys(p).length === 2 &&
        'gmContextId' in p &&
        typeof p.gmContextId === 'string' &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(p.gmContextId)
      )
        previous = { kind: 'BOOTSTRAP', gmContextId: p.gmContextId };
      else {
        const grant = parseHostDelivery(p, false);
        if (
          !(
            (grant.kind === 'ACTIVE' &&
              grant.targetFingerprint === reconnectFingerprint({ kind: 'GM' })) ||
            (grant.kind === 'SETUP' && grant.gmFingerprint === value.gmFingerprint)
          ) ||
          grant.key === value.key
        )
          throw new Error('Invalid prior GM grant');
        previous = grant;
      }
    }
    return {
      kind: 'SETUP',
      key: value.key,
      gmFingerprint: value.gmFingerprint,
      ...(returnReceiptId !== undefined ? { returnReceiptId } : {}),
      ...(revision !== undefined ? { revision } : {}),
      ...(sourceRevision !== undefined ? { sourceRevision } : {}),
      ...(previous ? { previous } : {}),
    };
  }
  if (
    !('targetFingerprint' in value) ||
    typeof value.targetFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.targetFingerprint)
  )
    throw new Error('Invalid host recipient witness');
  if (
    value.kind === 'ACTIVE' &&
    Object.keys(value).length === 5 &&
    'receiptId' in value &&
    typeof value.receiptId === 'string' &&
    'revision' in value &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0
  )
    return {
      kind: 'ACTIVE',
      key: value.key,
      targetFingerprint: value.targetFingerprint,
      receiptId: value.receiptId,
      revision: value.revision,
    };
  if (value.kind === 'ACK' && 'request' in value && Object.keys(value).length === 4) {
    const r = value.request as Partial<HostAck> | null;
    if (
      r &&
      Object.keys(r).length === 8 &&
      r.commandKind === 'workflow-command' &&
      r.messageType === 'command.request' &&
      r.protocolVersion === 1 &&
      r.workflowCommandId === HOST_SEAT_ACK &&
      (r.role === 'gm' || r.role === 'player') &&
      typeof r.commandId === 'string' &&
      r.commandId.length > 0 &&
      r.expectedRevisions &&
      Object.keys(r.expectedRevisions).length === 3 &&
      [
        r.expectedRevisions.stateRevision,
        r.expectedRevisions.projectionRevision,
        r.expectedRevisions.actorVisibilityRevision,
      ].every(
        (n) => Number.isSafeInteger(n) && n === r.expectedRevisions!.projectionRevision && n >= 0,
      ) &&
      hostSeatAckPayloadValue(r.payload).deliveryKey === value.key
    )
      return {
        kind: 'ACK',
        key: value.key,
        targetFingerprint: value.targetFingerprint,
        request: r as HostAck,
      };
  }
  throw new Error('Invalid saved host handoff');
}

export function writeHostDelivery(delivery: HostDelivery | null): void {
  if (delivery === null) sessionStorage.removeItem(HOST_DELIVERY_STORAGE);
  else sessionStorage.setItem(HOST_DELIVERY_STORAGE, JSON.stringify(delivery));
}

export function hostAckReceipt(
  delivery: Extract<HostDelivery, { kind: 'ACK' }>,
  receipt: CommandReceipt,
): Extract<HostDelivery, { kind: 'ACTIVE' }> {
  const r = receipt.result,
    p = delivery.request.payload;
  if (
    receipt.commandId !== delivery.request.commandId ||
    r['receiptId'] !== receipt.receiptId ||
    r['handoffId'] !== p.handoffId ||
    r['decision'] !== p.decision ||
    Object.keys(r).length !== 3 ||
    Object.values(receipt.revisions).some(
      (v) => v !== delivery.request.expectedRevisions.projectionRevision + 1,
    )
  )
    throw new Error('Invalid host acknowledgement');
  return {
    kind: 'ACTIVE',
    key: delivery.key,
    receiptId: receipt.receiptId,
    targetFingerprint: delivery.targetFingerprint,
    revision: receipt.revisions.projectionRevision,
  };
}

export function matchesHostRecipient(
  delivery: HostDelivery | null,
  active: ActiveHostSeat,
): boolean {
  return (
    !!delivery &&
    (delivery.kind === 'ACTIVE' || delivery.kind === 'ACK') &&
    (delivery.kind === 'ACTIVE'
      ? delivery.receiptId === active.receiptId && active.revision >= delivery.revision
      : active.revision === delivery.request.expectedRevisions.projectionRevision + 1) &&
    reconnectFingerprint(active.target) === delivery.targetFingerprint
  );
}

export function checkedHostView(
  payload: unknown,
  formId: string,
  actions: readonly ActionKey[],
  capabilities: readonly string[],
): HostSeatView {
  const view = hostSeatViewValue(payload);
  if (
    !capabilities.includes(HOST_SEAT_ACK) &&
    !(capabilities.length === 0 && view.hostSeatView === 'WAITING')
  )
    throw new Error('Host handoff is unavailable');
  let allowed: string[];
  switch (view.hostSeatView) {
    case 'WAITING':
      allowed = [];
      if (formId !== 'APP-003') throw new Error('Invalid waiting screen');
      break;
    case 'MANAGE':
      allowed = ['CMP-009::CTA::001'];
      if (view.seats.length < 3) allowed.push('CMP-009::CTA::002');
      if (view.returnedProfiles?.length) {
        if (view.seats.length >= 3 || !actions.includes('CMP-009::CTA::004'))
          throw new Error('Unexpected returned profiles');
        allowed.push('CMP-009::CTA::004');
      }
      if (formId !== 'CMP-009') throw new Error('Invalid host management screen');
      break;
    case 'GM_ONLY':
      allowed = ['PLY-027::CTA::001'];
      if (formId !== 'PLY-027') throw new Error('Invalid GM-only screen');
      break;
    case 'SETUP':
      if (formId !== 'APP-003') throw new Error('Invalid profile setup screen');
      allowed = ['APP-003::CTA::004', 'APP-003::CTA::005', 'APP-003::CTA::010'];
      if (capabilities.includes(HOST_OWNER_PROFILE_CREATE)) allowed.push('APP-003::CTA::011');
      if (view.profiles.length) allowed.push('APP-003::CTA::012');
      if (view.selectedProfileOrNull !== null) allowed.push('APP-003::CTA::013');
      break;
    case 'ADMISSION':
      if (formId !== 'APP-003') throw new Error('Invalid profile admission screen');
      allowed = ['APP-003::CTA::014'];
      if (view.selectedSourceUuids.length < 3) allowed.push('APP-003::CTA::001');
      if (view.selectedSourceUuids.length) allowed.push('APP-003::CTA::009');
      break;
    case 'ROSTER':
      if (formId !== 'PLY-028') throw new Error('Invalid host roster');
      allowed = ['PLY-028::CTA::001'];
      if (view.activeSeatIdOrNull !== null) allowed.push('PLY-028::CTA::002');
      if (view.seats.some((s) => s.localControllerSeatId !== view.activeSeatIdOrNull))
        allowed.push('PLY-028::CTA::003');
      break;
    case 'SWITCH':
      if (formId !== 'PLY-027') throw new Error('Invalid host context selector');
      allowed = ['PLY-027::CTA::004'];
      break;
    case 'CURTAIN':
      if (formId !== 'PLY-030') throw new Error('Invalid host curtain');
      allowed =
        view.decision === 'RETURN_INITIATOR' && view.target.kind === 'GM'
          ? ['PLY-030::CTA::006']
          : view.decision === 'ACTIVATE_TARGET'
            ? view.target.kind === 'CANDIDATE'
              ? ['PLY-030::CTA::001', 'PLY-030::CTA::004']
              : ['PLY-030::CTA::001']
            : [];
      if (actions.includes('PLY-030::CTA::004') && view.target.kind === 'CANDIDATE')
        allowed.push('PLY-030::CTA::008');
      if (actions.filter((k) => k !== 'PLY-030::CTA::008').length > 1)
        throw new Error('Ambiguous host handoff action');
      break;
    case 'ACTIVE':
      if (formId !== 'PLY-029') throw new Error('Invalid active host indicator');
      allowed = [];
      break;
  }
  if (actions.some((k) => !allowed.includes(k))) throw new Error('Unexpected host handoff action');
  return view;
}
