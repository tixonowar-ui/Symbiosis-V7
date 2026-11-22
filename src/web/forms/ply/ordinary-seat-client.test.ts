import { afterEach, describe, expect, it } from 'vitest';
import type { CommandReceipt } from '@shared/wire-protocol.js';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import sheet from '../../../../tests/fixtures/campaign-lobby-owner.json';
import {
  sameActiveSeatRefresh,
  checkedSeatReceipt,
  checkedSeatView,
  eligibleSeatTargets,
  readSeatDelivery,
  seatAckRequest,
  writeSeatDelivery,
} from './ordinary-seat-client.js';

const seat = '00000000-0000-4000-8000-000000000001';
const handoff = '00000000-0000-4000-8000-000000000002';
const command = '00000000-0000-4000-8000-000000000003';
const receiptId = '00000000-0000-4000-8000-000000000004';
const curtain = {
  ordinarySeatView: 'CURTAIN',
  targetOrdinal: 2,
  targetSeatId: seat,
  handoffId: handoff,
  revision: 4,
  sourceSeatIdOrNull: null,
  signedReturnContext: 'signed-original',
  pendingCommandOwner: null,
} as const;
const vector = (n: number) => ({
  actorVisibilityRevision: n,
  projectionRevision: n,
  stateRevision: n,
});

afterEach(() => writeSeatDelivery(null));

describe('ordinary seat browser delivery', () => {
  it('keeps the exact acknowledged request across reinitialization and issues an independent proof for the next human ACK', () => {
    const request = seatAckRequest(curtain, vector(4), command);
    writeSeatDelivery({ request, completed: false, receiptIdOrNull: null });
    const after = readSeatDelivery();
    if (!after || after.completed) throw new Error('Expected the pending ACK');
    expect(JSON.stringify(after.request)).toBe(JSON.stringify(request));
    expect(seatAckRequest(curtain, vector(4), command).payload.deliveryKey).not.toBe(
      request.payload.deliveryKey,
    );
  });

  it('requires the original command, handoff, target, receipt and next journal revision', () => {
    const request = seatAckRequest(curtain, vector(4), command);
    const pending = { request, completed: false, receiptIdOrNull: null } as const;
    const receipt: CommandReceipt = {
      commandId: command,
      receiptId,
      revisions: vector(5),
      result: {
        receiptId,
        handoffId: handoff,
        targetSeatId: seat,
        decision: 'ACTIVATE_TARGET',
      },
    };
    const received = checkedSeatReceipt(pending, receipt);
    expect(checkedSeatReceipt(received, receipt)).toEqual(received);
    for (const changed of [
      { ...receipt, commandId: handoff },
      { ...receipt, revisions: vector(4) },
      { ...receipt, revisions: { ...vector(5), projectionRevision: 6 } },
      { ...receipt, result: { ...receipt.result, targetSeatId: handoff } },
      { ...receipt, result: { ...receipt.result, handoffId: seat } },
      { ...receipt, receiptId: command, result: { ...receipt.result, receiptId: command } },
    ])
      expect(() => checkedSeatReceipt(received, changed)).toThrow();
  });

  it('accepts current owner refreshes only from the same published active sheet with a monotonic vector', () => {
    const active: ConfirmedProjectionSnapshot = {
      formId: 'PLY-001',
      path: '/active-peace',
      revisions: vector(9),
      projection: sheet.peace,
      executableWorkflowCommandIds: [],
      availableActionKeys: [],
      layers: [
        {
          formId: 'PLY-029',
          path: '@component/ply-029',
          availableActionKeys: [],
          projection: {
            ordinarySeatView: 'ACTIVE',
            revision: 5,
            ordinal: 2,
            receiptId,
            seatId: sheet.peace.controllerSeat,
          },
        },
      ],
    };
    const changed = {
      ...active,
      revisions: vector(10),
      projection: { ...active.projection, location: { location: 'Updated' } },
    };
    expect(sameActiveSeatRefresh(active, active)).toBe(true);
    expect(sameActiveSeatRefresh(active, changed)).toBe(true);
    for (const key of [
      'sceneId',
      'contextId',
      'campaignCharacterId',
      'controllerSeat',
      'networkScopeId',
    ])
      expect(
        sameActiveSeatRefresh(active, {
          ...changed,
          projection: { ...changed.projection, [key]: command },
        }),
      ).toBe(false);
    expect(sameActiveSeatRefresh(active, { ...changed, revisions: vector(9) })).toBe(false);
    expect(
      sameActiveSeatRefresh(active, {
        ...changed,
        revisions: { ...vector(10), projectionRevision: 8 },
      }),
    ).toBe(false);
    expect(sameActiveSeatRefresh(active, { ...changed, layers: [] })).toBe(false);
    expect(sameActiveSeatRefresh({ ...active, layers: [] }, changed)).toBe(false);
    expect(
      sameActiveSeatRefresh(active, {
        ...changed,
        layers: [
          {
            ...active.layers[0]!,
            formId: 'PLY-029',
            projection: { ...active.layers[0]!.projection, receiptId: command },
          },
        ],
      }),
    ).toBe(false);
  });

  it('rejects a private payload on any neutral surface and refuses GM or impossible seat choices', () => {
    expect(() =>
      checkedSeatView({ ...curtain, otherSheet: { name: 'Private' } }, 'PLY-030', []),
    ).toThrow();
    expect(() =>
      checkedSeatView(
        { ordinarySeatView: 'ROSTER', revision: 0, roster: [], activeSeatIdOrNull: null },
        'PLY-027',
        ['PLY-027::CTA::003'],
      ),
    ).toThrow();
    expect(() => checkedSeatView(curtain, 'PLY-030', ['PLY-030::CTA::006'])).toThrow();
    expect(() =>
      checkedSeatView({ ordinarySeatView: 'SETUP', selectedCount: 0, revision: 2 }, 'APP-003', [
        'APP-003::CTA::002',
      ]),
    ).toThrow();
  });
  it('requires a confirmed eligible target before the chooser can offer a switch', () => {
    const roster = {
      ordinarySeatView: 'ROSTER',
      revision: 4,
      activeSeatIdOrNull: seat,
      roster: [
        { seatId: seat, ordinal: 1 },
        { seatId: handoff, ordinal: 2 },
        { seatId: command, ordinal: 3 },
      ],
    };
    for (const payload of [roster, { ...roster, eligibleTargetSeatIds: [] }]) {
      expect(() => checkedSeatView(payload, 'PLY-027', ['PLY-027::CTA::003'])).toThrow();
    }
    expect(checkedSeatView({ ...roster, eligibleTargetSeatIds: [] }, 'PLY-027', [])).toMatchObject({
      roster: roster.roster,
      eligibleTargetSeatIds: [],
    });
    const permitted = checkedSeatView({ ...roster, eligibleTargetSeatIds: [handoff] }, 'PLY-027', [
      'PLY-027::CTA::003',
    ]);
    if (permitted.ordinarySeatView !== 'ROSTER') throw new Error('Expected roster');
    expect(permitted.roster).toEqual(roster.roster);
    expect(eligibleSeatTargets(permitted)).toEqual([{ seatId: handoff, ordinal: 2 }]);
  });
});
