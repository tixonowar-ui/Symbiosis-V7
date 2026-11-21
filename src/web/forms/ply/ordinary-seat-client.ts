import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';
import {
  ORDINARY_SEAT_ACK,
  ordinarySeatAckPayloadValue,
  ordinarySeatViewValue,
} from '@shared/ordinary-seat.js';
import type { OrdinarySeatAckPayload, OrdinarySeatView } from '@shared/ordinary-seat.js';
import type {
  CommandReceipt,
  JsonObject,
  RevisionVector,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';
import type { ActionKey } from '@generated/types/atlas.js';

const EMPTY_SEAT_RETURN_STORAGE = 'symbiosis.ordinary-seat.empty-return.v1';

export type EmptySeatScope = {
  readonly deviceId: string;
  readonly networkScopeId: string;
  readonly controllerSeat: string;
  readonly campaignId: string;
  readonly draftRevision: number;
  readonly revisions: RevisionVector;
};
export type EmptySeatReturn = EmptySeatScope & {
  readonly exitNavigationId: string;
  readonly request: {
    readonly requestId: string;
    readonly expectedProjectionRevision: number;
  } | null;
};

export function emptySeatScope(source: ConfirmedProjectionSnapshot): EmptySeatScope | null {
  const p = source.projection;
  if (
    source.formId !== 'NET-003' ||
    !Array.isArray(p['selectedCandidates']) ||
    p['selectedCandidates'].length !== 0 ||
    p['pendingCommandIdOrNull'] !== null ||
    p['ownRequestIdOrNull'] !== null ||
    typeof p['campaignIdOrNull'] !== 'string' ||
    typeof p['controllerSeat'] !== 'string' ||
    typeof p['deviceId'] !== 'string' ||
    typeof p['networkScopeId'] !== 'string' ||
    typeof p['draftRevision'] !== 'number'
  )
    return null;
  // Only the exit changes the #171 presentation. Re-entering the same NET-001 leaves its journal head intact.
  return {
    deviceId: p['deviceId'],
    networkScopeId: p['networkScopeId'],
    controllerSeat: p['controllerSeat'],
    campaignId: p['campaignIdOrNull'],
    draftRevision: p['draftRevision'],
    revisions: { ...source.revisions, projectionRevision: source.revisions.projectionRevision + 1 },
  };
}

export function matchesEmptySeatReturn(
  receipt: EmptySeatReturn,
  target: ConfirmedProjectionSnapshot,
): boolean {
  const p = target.projection;
  return (
    target.formId === 'NET-001' &&
    p['deviceId'] === receipt.deviceId &&
    p['networkScopeId'] === receipt.networkScopeId &&
    p['controllerSeat'] === receipt.controllerSeat &&
    p['campaignIdOrNull'] === receipt.campaignId &&
    p['draftRevision'] === receipt.draftRevision &&
    p['pendingCommandIdOrNull'] === null &&
    (p['connectionState'] === 'CONNECTED_TECHNICAL' || p['connectionState'] === 'LOST') &&
    admissionJsonEqual(target.revisions, receipt.revisions)
  );
}

export function readEmptySeatReturn(): EmptySeatReturn | null {
  try {
    const raw = sessionStorage.getItem(EMPTY_SEAT_RETURN_STORAGE);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<EmptySeatReturn> | null;
    if (
      !value ||
      typeof value.deviceId !== 'string' ||
      typeof value.networkScopeId !== 'string' ||
      typeof value.controllerSeat !== 'string' ||
      typeof value.campaignId !== 'string' ||
      !validRevision(value.draftRevision) ||
      !validRevision(value.revisions?.stateRevision) ||
      !validRevision(value.revisions?.projectionRevision) ||
      !validRevision(value.revisions?.actorVisibilityRevision) ||
      typeof value.exitNavigationId !== 'string' ||
      !/^navigation-[0-9a-f]{32}$/u.test(value.exitNavigationId) ||
      !(
        value.request === null ||
        (typeof value.request?.requestId === 'string' &&
          /^navigation-[0-9a-f]{32}$/u.test(value.request.requestId) &&
          validRevision(value.request.expectedProjectionRevision))
      )
    )
      return null;
    return value as EmptySeatReturn;
  } catch {
    return null;
  }
}

export function writeEmptySeatReturn(receipt: EmptySeatReturn | null): void {
  try {
    if (receipt === null) sessionStorage.removeItem(EMPTY_SEAT_RETURN_STORAGE);
    else sessionStorage.setItem(EMPTY_SEAT_RETURN_STORAGE, JSON.stringify(receipt));
  } catch (error) {
    if (!(
      error instanceof DOMException &&
      (error.name === 'SecurityError' || error.name === 'QuotaExceededError')
    ))
      throw error;
  }
}

export const SEAT_DELIVERY_STORAGE = 'symbiosis.ordinary-seat.delivery.v1';
export type SeatAck = WorkflowCommandRequestMessage<
  typeof ORDINARY_SEAT_ACK,
  OrdinarySeatAckPayload
>;

export interface PendingSeatDelivery {
  readonly request: SeatAck;
  readonly receiptIdOrNull: string | null;
  readonly completed: false;
}

export type SeatDelivery =
  | PendingSeatDelivery
  | {
      readonly completed: true;
      readonly revision: number;
      readonly receiptIdOrNull: string;
      readonly targetSeatId: string;
      readonly handoffId: string;
      readonly deliveryKey: string;
    };

export function seatBinding(delivery: SeatDelivery) {
  return delivery.completed ? delivery : delivery.request.payload;
}

function validRevision(v: unknown): boolean {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

export function readSeatDelivery(): SeatDelivery | null {
  try {
    const raw = sessionStorage.getItem(SEAT_DELIVERY_STORAGE);
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    if ('completed' in v && v.completed === true) {
      const entry = v as Partial<Extract<SeatDelivery, { completed: true }>>;
      if (
        typeof entry.revision !== 'number' ||
        !validRevision(entry.revision) ||
        typeof entry.receiptIdOrNull !== 'string' ||
        typeof entry.handoffId !== 'string' ||
        typeof entry.targetSeatId !== 'string' ||
        typeof entry.deliveryKey !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(entry.deliveryKey)
      )
        return null;
      return {
        completed: true,
        revision: entry.revision,
        receiptIdOrNull: entry.receiptIdOrNull,
        handoffId: entry.handoffId,
        targetSeatId: entry.targetSeatId,
        deliveryKey: entry.deliveryKey,
      };
    }
    const d = v as Partial<PendingSeatDelivery>,
      r = d.request;
    if (
      r === undefined ||
      r.messageType !== 'command.request' ||
      r.protocolVersion !== 1 ||
      r.role !== 'player' ||
      r.commandKind !== 'workflow-command' ||
      r.workflowCommandId !== ORDINARY_SEAT_ACK ||
      typeof r.commandId !== 'string' ||
      r.commandId.length === 0 ||
      d.completed !== false ||
      !(d.receiptIdOrNull === null || typeof d.receiptIdOrNull === 'string') ||
      !validRevision(r.expectedRevisions.stateRevision) ||
      !validRevision(r.expectedRevisions.projectionRevision) ||
      !validRevision(r.expectedRevisions.actorVisibilityRevision)
    )
      return null;
    ordinarySeatAckPayloadValue(r.payload);
    if (Object.keys(r).length !== 8 || Object.keys(r.expectedRevisions).length !== 3) return null;
    // Preserve the checked request's field order for byte-identical retransmission after a reload.
    return { request: r, receiptIdOrNull: d.receiptIdOrNull, completed: false };
  } catch {
    return null;
  }
}

export function writeSeatDelivery(value: SeatDelivery | null): void {
  if (value === null) {
    try {
      sessionStorage.removeItem(SEAT_DELIVERY_STORAGE);
    } catch {
      /* No usable session storage. */
    }
  } else sessionStorage.setItem(SEAT_DELIVERY_STORAGE, JSON.stringify(value));
}

export function seatAckRequest(
  view: OrdinarySeatView,
  revisions: RevisionVector,
  commandId: string,
): SeatAck {
  if (view.ordinarySeatView !== 'CURTAIN') throw new Error('Curtain required');
  const deliveryKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  return {
    protocolVersion: 1,
    messageType: 'command.request',
    commandKind: 'workflow-command',
    role: 'player',
    commandId,
    workflowCommandId: ORDINARY_SEAT_ACK,
    expectedRevisions: { ...revisions },
    payload: {
      handoffId: view.handoffId,
      targetSeatId: view.targetSeatId,
      signedReturnContext: view.signedReturnContext,
      decision: 'ACTIVATE_TARGET',
      deliveryKey,
    },
  };
}

export function checkedSeatReceipt(
  delivery: PendingSeatDelivery,
  receipt: CommandReceipt,
): PendingSeatDelivery {
  const result = receipt.result,
    { request } = delivery;
  const revision = request.expectedRevisions.stateRevision + 1;
  if (
    receipt.revisions.stateRevision !== revision ||
    receipt.revisions.projectionRevision !== revision ||
    receipt.revisions.actorVisibilityRevision !== revision ||
    receipt.commandId !== request.commandId ||
    receipt.receiptId !== result['receiptId'] ||
    result['decision'] !== 'ACTIVATE_TARGET' ||
    result['targetSeatId'] !== request.payload.targetSeatId ||
    result['handoffId'] !== request.payload.handoffId ||
    Object.keys(result).length !== 4 ||
    (delivery.receiptIdOrNull !== null && delivery.receiptIdOrNull !== receipt.receiptId)
  )
    throw new Error('Seat handoff receipt differs from the pending decision');
  return { ...delivery, receiptIdOrNull: receipt.receiptId };
}

export function eligibleSeatTargets(
  view: Extract<OrdinarySeatView, { ordinarySeatView: 'ROSTER' }>,
) {
  return view.roster.filter((seat) => view.eligibleTargetSeatIds?.includes(seat.seatId));
}

export function checkedSeatView(
  payload: JsonObject,
  formId: string,
  actions: readonly ActionKey[],
): OrdinarySeatView {
  const view = ordinarySeatViewValue(payload);
  let allowed: readonly ActionKey[] = [];
  let expectedForm: string;
  switch (view.ordinarySeatView) {
    case 'WAITING':
      expectedForm = 'APP-003';
      break;
    case 'SETUP':
      expectedForm = 'APP-003';
      allowed = [
        ...(view.selectedCount < 3 ? ['APP-003::CTA::001' as const] : []),
        view.selectedCount === 0 ? 'APP-003::CTA::004' : 'APP-003::CTA::002',
      ];
      break;
    case 'LIBRARY':
      expectedForm = 'APP-004';
      allowed = ['APP-004::CTA::002'];
      break;
    case 'ROSTER':
      expectedForm = 'PLY-027';
      allowed =
        view.roster.length === 0
          ? ['PLY-027::CTA::005', 'PLY-027::CTA::006']
          : view.roster.length >= 2 &&
              view.activeSeatIdOrNull !== null &&
              eligibleSeatTargets(view).length > 0
            ? ['PLY-027::CTA::003']
            : [];
      break;
    case 'CURTAIN':
      expectedForm = 'PLY-030';
      allowed = ['PLY-030::CTA::001'];
      break;
    case 'ACTIVE':
      expectedForm = 'PLY-029';
      break;
  }
  if (formId !== expectedForm || actions.some((a) => !allowed.includes(a)))
    throw new Error('Unexpected seat form or action');
  return view;
}

export function sameActiveSeatRefresh(
  previous: ConfirmedProjectionSnapshot | null,
  next: ConfirmedProjectionSnapshot,
): boolean {
  const old = previous?.layers[0],
    active = next.layers[0];
  if (
    previous?.formId !== 'PLY-001' ||
    next.formId !== 'PLY-001' ||
    old?.formId !== 'PLY-029' ||
    active?.formId !== 'PLY-029' ||
    previous.path !== next.path ||
    !admissionJsonEqual(old.projection, active.projection)
  )
    return false;
  const axes = ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const;
  if (axes.some((axis) => next.revisions[axis] < previous.revisions[axis])) return false;
  const keys = [
    'deviceId',
    'contextId',
    'networkScopeId',
    'sceneId',
    'campaignId',
    'campaignCharacterId',
    'controllerSeat',
    'admissionBatchId',
    'requestIdOrNull',
  ] as const;
  if (
    keys.some((key) => previous.projection[key] !== next.projection[key]) ||
    !admissionJsonEqual(
      previous.projection['effectiveController'],
      next.projection['effectiveController'],
    )
  )
    return false;
  return (
    !axes.every((axis) => previous.revisions[axis] === next.revisions[axis]) ||
    admissionJsonEqual(previous.projection, next.projection)
  );
}
