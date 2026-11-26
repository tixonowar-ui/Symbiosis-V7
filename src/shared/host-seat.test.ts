import { describe, expect, it } from 'vitest';
import { hostSeatAckPayloadValue, hostSeatControlValue, hostSeatViewValue } from './host-seat.js';
const owner = '4e0835c0-f5a4-440d-8f8b-9d1b478556a2';
const seat = 'ca4e56a1-16a6-43fb-9a28-da56b991d976';
const profile = { targetLocalOwnerId: owner, targetProfileLabel: 'Same name' };
const seats = [{ ...profile, localControllerSeatId: seat, ordinal: 1 }];
const key = 'e'.repeat(64);
describe('host-local seat wire boundaries', () => {
  it('keeps the neutral curtain free of authority and private data', () => {
    const v = {
      hostSeatView: 'CURTAIN',
      revision: 4,
      target: { kind: 'CANDIDATE', ...profile },
      handoffId: seat,
      signedReturnContext: 'signed',
      decision: 'ACTIVATE_TARGET',
    };
    expect(hostSeatViewValue(v)).toEqual(v);
    for (const forbidden of [
      'deliveryKey',
      'sheet',
      'receiptId',
      'gmContextId',
      'networkScopeId',
      'requestId',
      'seats',
    ])
      expect(() => hostSeatViewValue({ ...v, [forbidden]: owner })).toThrow();
    for (const forbidden of ['networkScopeId', 'localControllerSeatId', 'characterId', 'sheet'])
      expect(() =>
        hostSeatViewValue({ ...v, target: { ...v.target, [forbidden]: seat } }),
      ).toThrow();
  });
  it('binds recipient choices to an ordered roster and rejects a GM chooser on a player badge', () => {
    const r = { hostSeatView: 'ROSTER', revision: 3, seats, activeSeatIdOrNull: seat };
    expect(hostSeatViewValue(r)).toEqual(r);
    expect(() => hostSeatViewValue({ ...r, activeSeatIdOrNull: owner })).toThrow();
    expect(() =>
      hostSeatViewValue({ ...r, seats: [...seats, { ...seats[0], ordinal: 2 }] }),
    ).toThrow();
    const v = {
      hostSeatView: 'ACTIVE',
      revision: 7,
      target: { kind: 'GM' },
      contextId: owner,
      receiptId: seat,
      networkScopeIdOrNull: null,
      seats,
    };
    expect(hostSeatViewValue(v)).toEqual(v);
    expect(() => hostSeatViewValue({ ...v, target: { kind: 'CANDIDATE', ...profile } })).toThrow();
  });
  it('limits the historical result badge to a confirmed candidate and its network scope', () => {
    const result = {
      hostSeatView: 'ACTIVE',
      revision: 4,
      target: { kind: 'CANDIDATE', ...profile },
      contextId: owner,
      receiptId: seat,
      networkScopeIdOrNull: seat,
      terminalResultReadOnly: true,
    };
    expect(hostSeatViewValue(result)).toEqual(result);
    for (const change of [
      { target: { kind: 'GM' } },
      { networkScopeIdOrNull: null },
      { terminalResultReadOnly: false },
      { selectedSourceUuids: [] },
      { applicants: [] },
      { seats: [] },
      { hostSeatView: 'WAITING' },
    ])
      expect(() => hostSeatViewValue({ ...result, ...change })).toThrow();
  });
  it('accepts only the exact resume, addressed ACK and owner-scoped selection shapes', () => {
    const m = {
      protocolVersion: 3,
      messageType: 'host.seat.control',
      operation: 'RESUME',
      requestId: 'resume',
      deliveryKeyOrNull: null,
      supportedWorkflowCommandIds: ['UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK'],
      unacknowledgedCommandIds: [],
    };
    expect(hostSeatControlValue(m)).toEqual(m);
    expect(() => hostSeatControlValue({ ...m, gmContextId: owner })).toThrow();
    expect(() => hostSeatControlValue({ ...m, deliveryKeyOrNull: 123 })).toThrow();
    const ack = {
      handoffId: seat,
      signedReturnContext: 'signed',
      decision: 'RETURN_INITIATOR',
      deliveryKey: key,
    };
    expect(hostSeatAckPayloadValue(ack)).toEqual(ack);
    expect(() => hostSeatAckPayloadValue({ ...ack, targetLocalOwnerId: owner })).toThrow();
    expect(() => hostSeatAckPayloadValue({ ...ack, deliveryKey: key.toUpperCase() })).toThrow();
    const select = {
      protocolVersion: 3,
      messageType: 'host.seat.control',
      operation: 'SELECT_FINALS',
      requestId: 'select',
      expectedProjectionRevision: 2,
      selectedSourceUuids: [owner],
    };
    expect(hostSeatControlValue(select)).toEqual(select);
    expect(() =>
      hostSeatControlValue({ ...select, selectedSourceUuids: [owner, owner] }),
    ).toThrow();
  });
  it('exposes only the identities of confirmed returning profiles on the GM selector', () => {
    const manage = {
      hostSeatView: 'MANAGE',
      revision: 5,
      campaignId: seat,
      gmContextId: owner,
      seats: [],
      returnedProfiles: [profile],
    };
    expect(hostSeatViewValue(manage)).toEqual(manage);
    for (const returnedProfiles of [[], [profile, profile], [{ ...profile, sourceUuid: seat }]])
      expect(() => hostSeatViewValue({ ...manage, returnedProfiles })).toThrow();
    const control = {
      protocolVersion: 3,
      messageType: 'host.seat.control',
      operation: 'RESUME_PROFILE',
      requestId: 'pick',
      expectedProjectionRevision: 5,
      targetLocalOwnerId: owner,
    };
    expect(hostSeatControlValue(control)).toEqual(control);
    expect(() =>
      hostSeatControlValue({ ...control, targetProfileLabel: profile.targetProfileLabel }),
    ).toThrow();
    expect(() => hostSeatControlValue({ ...control, targetLocalOwnerId: 'unknown' })).toThrow();
  });
});
