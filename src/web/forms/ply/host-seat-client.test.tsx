import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_SEAT_ACK, HOST_OWNER_PROFILE_CREATE } from '@shared/host-seat.js';
import type { HostSeatView } from '@shared/host-seat.js';
import { CampaignLobbyFields } from '../net/admission-fields.js';
import lobby from '../../../../tests/fixtures/campaign-lobby-owner.json';
import {
  checkedHostView,
  HOST_DELIVERY_STORAGE,
  hostAckDelivery,
  hostAckReceipt,
  matchesHostRecipient,
  readHostDelivery,
  writeHostDelivery,
} from './host-seat-client.js';
import { HostSeatPanel } from './host-seat-panel.js';

const id = (n: number) => '00000000-0000-4000-8000-' + n.toString().padStart(12, '0');
const vector = (n: number) => ({
  projectionRevision: n,
  actorVisibilityRevision: n,
  stateRevision: n,
});
const profile = { targetLocalOwnerId: id(1), targetProfileLabel: 'Получатель' };
const curtain = {
  hostSeatView: 'CURTAIN',
  handoffId: id(2),
  signedReturnContext: 'signed-binding',
  target: { kind: 'CANDIDATE', ...profile },
  decision: 'ACTIVATE_TARGET',
  revision: 3,
} as const satisfies HostSeatView;
const active = {
  hostSeatView: 'ACTIVE',
  revision: 4,
  target: curtain.target,
  receiptId: id(4),
  contextId: id(5),
  networkScopeIdOrNull: null,
} as const satisfies HostSeatView;
afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('single-computer GM handoffs', () => {
  it('fetches protected GM art only with the current grant and revokes its blob on handoff', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const projection = { ...lobby.gmBeforeStart, campaignArtChecksumOrNull: '0'.repeat(64) };
    const key = 'a'.repeat(64),
      receiptId = id(10),
      revoke = vi.fn();
    writeHostDelivery({
      kind: 'ACTIVE',
      key,
      receiptId,
      targetFingerprint: 'e'.repeat(64),
      revision: 4,
    });
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    class ObjectUrls extends URL {
      static override createObjectURL() {
        return 'blob:private-campaign-art';
      }
      static override revokeObjectURL(value: string) {
        revoke(value);
      }
    }
    vi.stubGlobal('URL', ObjectUrls);
    const container = document.createElement('div'),
      root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <CampaignLobbyFields
            formId="NET-016"
            projection={projection}
            managedReceiptId={receiptId}
            onTimeChange={() => undefined}
          />,
        );
        await Promise.resolve();
      });
      expect(fetch).toHaveBeenCalledWith(
        new URL(
          '/campaign-art/' + projection.contextId + '/' + projection.campaignArtChecksumOrNull,
          window.location.href,
        ),
        expect.objectContaining({
          cache: 'no-store',
          redirect: 'error',
          headers: { Authorization: 'Bearer ' + key },
        }),
      );
      expect(container.querySelector('img[alt="Арт кампании"]')?.getAttribute('src')).toBe(
        'blob:private-campaign-art',
      );
      expect(container.innerHTML).not.toContain(key);
      act(() =>
        root.render(
          <HostSeatPanel
            formId="PLY-030"
            actions={[]}
            enabled={true}
            view={curtain}
            getConnection={() => null}
          />,
        ),
      );
      expect(revoke).toHaveBeenCalledWith('blob:private-campaign-art');
      expect(container.querySelector('img')).toBeNull();
    } finally {
      act(() => root.unmount());
    }
  });
  it('keeps only a browser-bound exact ACK until its matching terminal, including response loss', () => {
    const pending = hostAckDelivery(curtain, vector(3), id(3));
    const other = hostAckDelivery(curtain, vector(3), id(3));
    expect(other.key).not.toBe(pending.key);
    expect(pending.request.role).toBe('player');
    expect(
      hostAckDelivery({ ...curtain, target: { kind: 'GM' } }, vector(3), id(3)).request.role,
    ).toBe('gm');
    writeHostDelivery(pending);
    const raw = sessionStorage.getItem(HOST_DELIVERY_STORAGE);
    expect(raw).not.toContain(profile.targetProfileLabel);
    expect(raw).not.toContain(profile.targetLocalOwnerId);
    expect(readHostDelivery()).toEqual(pending);
    expect(matchesHostRecipient(readHostDelivery(), active)).toBe(true);
    expect(matchesHostRecipient(pending, { ...active, revision: 3 })).toBe(false);
    expect(
      matchesHostRecipient(pending, {
        ...active,
        target: { ...curtain.target, targetLocalOwnerId: id(12) },
      }),
    ).toBe(false);
    const receipt = {
      commandId: id(3),
      receiptId: id(4),
      result: { receiptId: id(4), handoffId: id(2), decision: 'ACTIVATE_TARGET' },
      revisions: vector(4),
    };
    for (const changed of [
      { ...receipt, commandId: id(12) },
      { ...receipt, receiptId: id(12) },
      { ...receipt, revisions: vector(5) },
      { ...receipt, result: { ...receipt.result, decision: 'RETURN_INITIATOR' } },
      { ...receipt, result: { ...receipt.result, unexpected: true } },
    ])
      expect(() => hostAckReceipt(pending, changed)).toThrow();
    const committed = hostAckReceipt(pending, receipt);
    writeHostDelivery(committed);
    expect(readHostDelivery()).toEqual(committed);
    expect(matchesHostRecipient(committed, active)).toBe(true);
    expect(matchesHostRecipient(committed, { ...active, receiptId: id(12) })).toBe(false);
    expect(sessionStorage.getItem(HOST_DELIVERY_STORAGE)).not.toContain(
      curtain.signedReturnContext,
    );
    writeHostDelivery({ kind: 'NEUTRAL' });
    expect(matchesHostRecipient(readHostDelivery(), active)).toBe(false);
  });
  it('requires source-owned actions, confirmed selected profiles and admitted seats', () => {
    const manage = {
      hostSeatView: 'MANAGE',
      revision: 2,
      seats: [],
      campaignId: id(11),
      gmContextId: id(12),
    };
    const returned = { ...manage, returnedProfiles: [profile] };
    expect(checkedHostView(returned, 'CMP-009', ['CMP-009::CTA::004'], [HOST_SEAT_ACK])).toEqual(
      returned,
    );
    expect(() =>
      checkedHostView(manage, 'CMP-009', ['CMP-009::CTA::004'], [HOST_SEAT_ACK]),
    ).toThrow();
    expect(() => checkedHostView(returned, 'CMP-009', [], [HOST_SEAT_ACK])).toThrow();
    const fullAdmission = {
      hostSeatView: 'ADMISSION',
      revision: 2,
      profile,
      selectedSourceUuids: [id(31), id(32), id(33)],
    };
    expect(() =>
      checkedHostView(fullAdmission, 'APP-003', ['APP-003::CTA::001'], [HOST_SEAT_ACK]),
    ).toThrow();
    const switcher = { hostSeatView: 'SWITCH', revision: 7 };
    expect(checkedHostView(switcher, 'PLY-027', ['PLY-027::CTA::004'], [HOST_SEAT_ACK])).toEqual(
      switcher,
    );
    expect(() =>
      checkedHostView(switcher, 'PLY-027', ['PLY-027::CTA::003'], [HOST_SEAT_ACK]),
    ).toThrow();
    const setup = {
      hostSeatView: 'SETUP',
      revision: 1,
      profiles: [profile],
      selectedProfileOrNull: null,
    };
    expect(() =>
      checkedHostView(setup, 'APP-003', ['APP-003::CTA::013'], [HOST_SEAT_ACK]),
    ).toThrow();
    expect(() =>
      checkedHostView(setup, 'APP-003', ['APP-003::CTA::011'], [HOST_SEAT_ACK]),
    ).toThrow();
    expect(
      checkedHostView(
        setup,
        'APP-003',
        ['APP-003::CTA::011', 'APP-003::CTA::012'],
        [HOST_SEAT_ACK, HOST_OWNER_PROFILE_CREATE],
      ),
    ).toEqual(setup);
    expect(() =>
      checkedHostView(
        { ...setup, selectedProfileOrNull: { ...profile, targetLocalOwnerId: id(20) } },
        'APP-003',
        [],
        [HOST_SEAT_ACK],
      ),
    ).toThrow();
    expect(() =>
      checkedHostView(
        { hostSeatView: 'ROSTER', revision: 2, seats: [], activeSeatIdOrNull: null },
        'PLY-028',
        ['PLY-028::CTA::003'],
        [HOST_SEAT_ACK],
      ),
    ).toThrow();
    expect(() =>
      checkedHostView(
        { ...curtain, privateSheet: 'other sheet' },
        'PLY-030',
        ['PLY-030::CTA::001'],
        [HOST_SEAT_ACK],
      ),
    ).toThrow();
    const admission = { hostSeatView: 'ADMISSION', revision: 2, profile, selectedSourceUuids: [] };
    expect(() =>
      checkedHostView(admission, 'APP-003', ['APP-003::CTA::009'], [HOST_SEAT_ACK]),
    ).toThrow();
    expect(checkedHostView(admission, 'APP-003', ['APP-003::CTA::014'], [HOST_SEAT_ACK])).toEqual(
      admission,
    );
  });
  it('unmounts both private player names when displaying the neutral GM curtain', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div'),
      root = createRoot(container);
    try {
      const render = (formId: string, v: HostSeatView) =>
        act(() => {
          root.render(
            <HostSeatPanel
              formId={formId}
              actions={[]}
              view={v}
              enabled={true}
              getConnection={() => null}
            />,
          );
        });
      render('PLY-028', {
        hostSeatView: 'ROSTER',
        revision: 1,
        activeSeatIdOrNull: null,
        seats: [
          { ...profile, localControllerSeatId: id(7), ordinal: 1 },
          {
            targetLocalOwnerId: id(8),
            targetProfileLabel: 'Прежний профиль',
            localControllerSeatId: id(9),
            ordinal: 2,
          },
        ],
      });
      expect(container.textContent).toContain('Прежний профиль');
      render('PLY-030', { ...curtain, target: { kind: 'GM' } });
      expect(container.textContent).toContain('Получатель устройства: Мастер');
      expect(container.innerHTML).not.toMatch(/Прежний профиль|Получатель \(|00000000-/u);
      expect(container.querySelectorAll('input,select,button')).toHaveLength(0);
      render('PLY-030', curtain);
      expect(container.textContent).toContain(
        profile.targetProfileLabel + ' (' + profile.targetLocalOwnerId + ')',
      );
    } finally {
      act(() => root.unmount());
    }
  });
});
