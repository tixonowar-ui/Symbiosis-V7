import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_SEAT_ACK } from '@shared/host-seat.js';
import {
  decodeClientMessageV2,
  decodeClientMessageV3,
  encodeHostMessageV2,
} from '@shared/index.js';
import type {
  HostToClientV2Message,
  ProjectionSnapshotV2Message,
  WorkflowCommandId,
} from '@shared/index.js';
import { reconnectFingerprint } from '@shared/reconnect-fingerprint.js';
import {
  hostSeatLayer,
  hostSeatSnapshot,
  hostSeatVector,
} from '../host/host-local-seat-presentation.js';
import { GM_CONTEXT_STORAGE_KEY } from './forms/cmp/campaign-create.js';
import { presentedFormDefinition } from './forms/index.js';
import { HOST_DELIVERY_STORAGE, writeHostDelivery } from './forms/ply/host-seat-client.js';
import { connectProjection, WEB_PROTOCOL_VOCABULARY } from './ws-client.js';
import type { ProjectionConnection, WebClientState } from './ws-client.js';

const gmContextId = '00000000-0000-4000-8000-000000000001';
const campaignId = '00000000-0000-4000-8000-000000000002';
const receiptId = '00000000-0000-4000-8000-000000000003';
const deviceId = '00000000-0000-4000-8000-000000000004';
const previous = {
  kind: 'ACTIVE',
  key: 'a'.repeat(64),
  targetFingerprint: reconnectFingerprint({ kind: 'GM' }),
  receiptId,
  revision: 4,
} as const;

class Socket {
  static readonly OPEN = 1;
  static latest: Socket;
  readonly sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor() {
    Socket.latest = this;
  }
  open() {
    this.readyState = Socket.OPEN;
    this.onopen?.();
    return this.request(0);
  }
  close() {
    this.readyState = 3;
  }
  send(text: string) {
    this.sent.push(text);
  }
  request(index: number) {
    const request = decodeClientMessageV3(this.sent[index]!, WEB_PROTOCOL_VOCABULARY);
    if (!request.ok) throw new Error(JSON.stringify(request.refusal));
    return request.value;
  }
  publish(message: HostToClientV2Message) {
    const encoded = encodeHostMessageV2(message, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok) throw new Error(JSON.stringify(encoded.refusal));
    this.onmessage?.({ data: encoded.text });
  }
  reconnect(
    snapshot: ProjectionSnapshotV2Message,
    capabilities: readonly WorkflowCommandId[] = [HOST_SEAT_ACK],
  ) {
    this.publish({
      messageType: 'session.reconnect.capabilities',
      protocolVersion: 2,
      reconnectRequestId: snapshot.presentation.assignment.correlationId,
      revisions: snapshot.revisions,
      executableWorkflowCommandIds: capabilities,
    });
    this.publish(snapshot);
  }
  refuse(id: string, revision: number) {
    this.publish({
      protocolVersion: 2,
      messageType: 'navigation.form-action.refusal',
      navigationRequestId: id,
      refusal: { code: 'NAVIGATION_UNAVAILABLE' },
      presentationUnchanged: true,
      revisions: hostSeatVector(revision),
    });
  }
}

const clients: ProjectionConnection[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function start(states: WebClientState[]) {
  const client = connectProjection((state) => states.push(state));
  clients.push(client);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return client;
}

function manage(
  id: string,
  active: boolean,
  revision = 4,
  reason: 'RECONNECT' | 'FORM_ACTION' = 'RECONNECT',
  gmReceipt = receiptId,
  scopeCampaignId = campaignId,
) {
  const snapshot = hostSeatSnapshot(
    { hostSeatView: 'MANAGE', revision, gmContextId, campaignId: scopeCampaignId, seats: [] },
    id,
    reason,
    ['CMP-009::CTA::002'],
  );
  const layers = active
    ? [
        hostSeatLayer(
          'PLY-029',
          {
            hostSeatView: 'ACTIVE',
            revision,
            target: { kind: 'GM' },
            receiptId: gmReceipt,
            contextId: gmContextId,
            networkScopeIdOrNull: null,
          },
          [],
        ),
      ]
    : [];
  return { ...snapshot, presentation: { ...snapshot.presentation, layers } };
}

const setupGrant = {
  kind: 'SETUP',
  key: 'b'.repeat(64),
  gmFingerprint: reconnectFingerprint([campaignId, gmContextId]),
  revision: 10,
} as const;

function resumeId(socket: Socket) {
  const resume = socket.open();
  if (resume.messageType === 'host.seat.control' && resume.operation === 'RESUME')
    return resume.requestId;
  if (resume.messageType === 'campaign.local-context.resume') return resume.reconnectRequestId;
  throw new Error('Expected an owned GM reconnect');
}

function qr(
  id: string,
  field: 'correct' | 'context' | 'device',
  badge: boolean,
): ProjectionSnapshotV2Message {
  const definition = presentedFormDefinition('CMP-006')!;
  if (definition.type !== 'screen') throw new Error('Expected campaign QR screen');
  return {
    protocolVersion: 2,
    messageType: 'projection.snapshot',
    projectionRole: 'gm',
    revisions: hostSeatVector(0),
    presentation: {
      assignment: { reason: 'RECONNECT', correlationId: id },
      base: {
        formId: 'CMP-006',
        formType: 'screen',
        routeTemplate: definition.route,
        routeBindings: [{ parameterIndex: 0, source: 'inherited', value: campaignId }],
        availableActionKeys: ['CMP-006::CTA::001', 'CMP-006::CTA::002'],
        roleFilteredPayload: {
          gmLocalContextId: field === 'context' ? receiptId : gmContextId,
          hostDeviceId: field === 'device' ? receiptId : deviceId,
          masterAuthorityRevision: 0,
          routeIdentityKind: 'CAMPAIGN',
          campaignId,
          sourceCampaignDraftId: receiptId,
          status: 'PAUSED',
          createdAt: '2026-10-30T00:00:00.000Z',
          hostAddress: '192.168.1.20',
          hostPort: 3000,
          networkInterface: 'actual-fixture-interface',
          qrPayload: `http://192.168.1.20:3000/?campaignId=${campaignId}`,
          activePlayerCapacity: 3,
          creationReceiptId: 'original-create-receipt',
          creationCommandId: 'original-create-command',
          hostBindRecovery: { status: 'RESERVED', reasonCode: null },
        },
      },
      layers: badge
        ? [
            hostSeatLayer(
              'PLY-029',
              {
                hostSeatView: 'ACTIVE',
                revision: 11,
                target: { kind: 'GM' },
                contextId: gmContextId,
                receiptId,
                networkScopeIdOrNull: null,
              },
              [],
            ),
          ]
        : [],
    },
  };
}

it.each(['waiting', 'action', 'layer', 'setup', 'management', 'extra capability'] as const)(
  'accepts only an actionless waiting screen after an empty handoff negotiation (%s)',
  async (variant) => {
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ deviceId }))));
    writeHostDelivery({ kind: 'NEUTRAL' });
    const states: WebClientState[] = [];
    await start(states);
    const socket = Socket.latest;
    const id = resumeId(socket);
    const revision = 4;
    const waiting = hostSeatSnapshot({ hostSeatView: 'WAITING', revision }, id, 'RECONNECT');
    const snapshot =
      variant === 'management'
        ? manage(id, true, revision)
        : variant === 'setup'
          ? hostSeatSnapshot(
              { hostSeatView: 'SETUP', profiles: [], selectedProfileOrNull: null, revision },
              id,
              'RECONNECT',
            )
          : variant === 'layer'
            ? hostSeatSnapshot({ hostSeatView: 'GM_ONLY', revision }, id, 'RECONNECT', [
                'PLY-027::CTA::001',
              ])
            : variant === 'action'
              ? hostSeatSnapshot({ hostSeatView: 'WAITING', revision }, id, 'RECONNECT', [
                  'APP-003::CTA::005',
                ])
              : waiting;
    socket.reconnect(
      snapshot,
      variant === 'extra capability' ? ['UI-CMD-CAMPAIGN-SETTINGS-SET'] : [],
    );
    if (variant === 'waiting') {
      expect(states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: {
          formId: 'APP-003',
          hostSeat: { hostSeatView: 'WAITING', revision },
          availableActionKeys: [],
          executableWorkflowCommandIds: [],
          layers: [],
        },
      });
      expect(socket.sent).toHaveLength(1);
    } else {
      expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
      expect(states.some((s) => s.kind === 'ready')).toBe(false);
    }
  },
);

it.each(['managed setup', 'ordinary GM'] as const)(
  'checks an untagged campaign QR against the actual reconnect negotiation (%s)',
  async (entry) => {
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ deviceId }))));
    if (entry === 'managed setup') writeHostDelivery(setupGrant);
    else sessionStorage.setItem(GM_CONTEXT_STORAGE_KEY, gmContextId);
    const states: WebClientState[] = [];
    await start(states);
    const socket = Socket.latest;
    const request = socket.open();
    if (entry === 'managed setup') {
      expect(request).toMatchObject({
        messageType: 'host.seat.control',
        deliveryKeyOrNull: setupGrant.key,
      });
      if (request.messageType !== 'host.seat.control' || request.operation !== 'RESUME')
        throw new Error('Expected a managed resume');
      socket.reconnect(qr(request.requestId, 'correct', false), []);
      expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
      expect(states.some((state) => state.kind === 'ready')).toBe(false);
    } else {
      if (request.messageType !== 'campaign.local-context.resume')
        throw new Error('Expected a native GM resume');
      socket.reconnect(qr(request.reconnectRequestId, 'correct', false), []);
      expect(states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'CMP-006' } });
    }
  },
);

describe('setup grant review', () => {
  const states: WebClientState[] = [];
  const open = async () => {
    states.length = 0;
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ deviceId }))));
    return start(states);
  };
  it.each([
    'waiting',
    'refused',
    'stale after reload',
    'current',
    'stale GM-only',
    'committed after reload',
  ] as const)(
    'checks the seat revision observed before probing the prior GM (%s)',
    async (scenario) => {
      writeHostDelivery({ ...setupGrant, previous });
      const client = await open();
      const probe = Socket.latest;
      const id = resumeId(probe);
      if (scenario === 'refused' || scenario === 'committed after reload') probe.refuse(id, 11);
      else
        probe.reconnect(
          hostSeatSnapshot(
            { hostSeatView: 'WAITING', revision: scenario === 'stale after reload' ? 12 : 11 },
            id,
            'RECONNECT',
          ),
        );
      const fallback = Socket.latest;
      expect(fallback).not.toBe(probe);
      if (scenario === 'stale after reload' || scenario === 'committed after reload') {
        client.disconnect();
        await start(states);
        const again = Socket.latest;
        const probeId = resumeId(again);
        const committed = scenario === 'committed after reload';
        again.reconnect(
          hostSeatSnapshot(
            { hostSeatView: 'SETUP', profiles: [], selectedProfileOrNull: null, revision: 11 },
            probeId,
            'RECONNECT',
          ),
        );
        expect(states.at(-1)?.kind).toBe(committed ? 'ready' : 'protocol-error');
        return;
      }
      const fallbackId = resumeId(fallback);
      if (scenario === 'stale GM-only') {
        fallback.reconnect(
          hostSeatSnapshot({ hostSeatView: 'GM_ONLY', revision: 10 }, fallbackId, 'RECONNECT'),
        );
      } else fallback.reconnect(manage(fallbackId, true, scenario === 'current' ? 11 : 4));
      expect(states.at(-1)?.kind).toBe(scenario === 'current' ? 'ready' : 'protocol-error');
      if (scenario !== 'current') expect(states.some((s) => s.kind === 'ready')).toBe(false);
      if (scenario === 'current') {
        client.disconnect();
        states.length = 0;
        await start(states);
        const returned = Socket.latest;
        returned.reconnect(manage(resumeId(returned), true, 10));
        expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
      }
    },
  );
  it.each(['correct', 'context', 'device'] as const)(
    'binds acknowledged GM campaign QR to the installation and context (%s)',
    async (field) => {
      writeHostDelivery(previous);
      await open();
      const socket = Socket.latest;
      socket.reconnect(qr(resumeId(socket), field, true));
      expect(states.at(-1)?.kind).toBe(field === 'correct' ? 'ready' : 'protocol-error');
      if (field !== 'correct') expect(states.some((s) => s.kind === 'ready')).toBe(false);
    },
  );
  it('retains the revision from the original ENTER_SETUP refusal across reload', async () => {
    writeHostDelivery(previous);
    const client = await open();
    const active = Socket.latest;
    active.reconnect(manage(resumeId(active), true, 10));
    expect(client.requestFormAction('CMP-009::CTA::002')).toEqual({ ok: true });
    const enter = active.request(1);
    if (enter.messageType !== 'host.seat.control' || enter.operation !== 'ENTER_SETUP')
      throw new Error('Missing setup control');
    active.refuse(enter.requestId, 12);
    client.disconnect();
    await start(states);
    const probe = Socket.latest;
    probe.reconnect(
      hostSeatSnapshot({ hostSeatView: 'WAITING', revision: 11 }, resumeId(probe), 'RECONNECT'),
    );
    expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
  });
  it.each(['BOOTSTRAP', 'SETUP'] as const)(
    'recovers the original %s QR with its own business revision',
    async (kind) => {
      writeHostDelivery({
        ...setupGrant,
        previous:
          kind === 'BOOTSTRAP' ? { kind, gmContextId } : { ...setupGrant, key: 'c'.repeat(64) },
      });
      await open();
      const probe = Socket.latest;
      probe.refuse(resumeId(probe), 11);
      const fallback = Socket.latest;
      expect(fallback).not.toBe(probe);
      fallback.reconnect(qr(resumeId(fallback), 'correct', false));
      expect(states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'CMP-006' } });
    },
  );
});

describe.each(['bootstrap', 'acknowledged GM'] as const)(
  'ENTER_SETUP delivery from %s',
  (source) => {
    it.each([
      'refused',
      'lost before commit',
      'committed reply lost',
      'foreign recovery scope',
      'inconclusive recovery',
    ] as const)(
      'restores only the host-confirmed holder after the request was %s',
      async (scenario) => {
        vi.stubGlobal('WebSocket', Socket);
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ deviceId }))));
        const active = source === 'acknowledged GM';
        if (active) writeHostDelivery(previous);
        else sessionStorage.setItem(GM_CONTEXT_STORAGE_KEY, gmContextId);
        const states: WebClientState[] = [];
        const client = await start(states);
        const socket = Socket.latest;
        const sourceResume = socket.open();
        const id =
          sourceResume.messageType === 'campaign.local-context.resume'
            ? sourceResume.reconnectRequestId
            : sourceResume.messageType === 'host.seat.control' &&
                sourceResume.operation === 'RESUME'
              ? sourceResume.requestId
              : null;
        if (id === null) throw new Error('Unexpected GM resume');
        socket.reconnect(manage(id, active));
        expect(states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'CMP-009' } });
        expect(client.requestFormAction('CMP-009::CTA::002')).toEqual({ ok: true });
        const enter = socket.request(1);
        if (enter.messageType !== 'host.seat.control' || enter.operation !== 'ENTER_SETUP')
          throw new Error('Missing setup request');
        expect(states.at(-1)).toMatchObject({ kind: 'awaiting-snapshot' });
        states.length = 0;
        if (scenario === 'refused') socket.refuse(enter.requestId, 4);
        else {
          client.disconnect();
          await start(states);
        }
        const probe = Socket.latest;
        expect(probe).not.toBe(socket);
        const candidate = probe.open();
        if (candidate.messageType !== 'host.seat.control' || candidate.operation !== 'RESUME')
          throw new Error('Missing setup recovery probe');
        expect(candidate.deliveryKeyOrNull).toBe(enter.deliveryKey);
        if (scenario === 'committed reply lost') {
          probe.reconnect(
            hostSeatSnapshot(
              { hostSeatView: 'SETUP', revision: 5, profiles: [], selectedProfileOrNull: null },
              candidate.requestId,
              'RECONNECT',
            ),
          );
          expect(states.at(-1)).toMatchObject({
            kind: 'ready',
            snapshot: { hostSeat: { hostSeatView: 'SETUP' } },
          });
          expect(sessionStorage.getItem(HOST_DELIVERY_STORAGE)).not.toContain(
            active ? previous.key : gmContextId,
          );
          return;
        }
        if (active && scenario !== 'inconclusive recovery')
          probe.reconnect(
            hostSeatSnapshot(
              { hostSeatView: 'WAITING', revision: 4 },
              candidate.requestId,
              'RECONNECT',
            ),
          );
        else probe.refuse(candidate.requestId, 4);
        const recovery = Socket.latest;
        expect(recovery).not.toBe(probe);
        const restored = recovery.open();
        const expected = active
          ? {
              messageType: 'host.seat.control',
              operation: 'RESUME',
              deliveryKeyOrNull: previous.key,
            }
          : { messageType: 'campaign.local-context.resume', gmLocalContextId: gmContextId };
        expect(restored).toMatchObject(expected);
        expect(states.some((state) => state.kind === 'ready')).toBe(false);
        const recoveryId =
          restored.messageType === 'campaign.local-context.resume'
            ? restored.reconnectRequestId
            : restored.messageType === 'host.seat.control' && restored.operation === 'RESUME'
              ? restored.requestId
              : null;
        if (!recoveryId) throw new Error('Missing GM proof');
        if (scenario === 'inconclusive recovery') {
          recovery.reconnect(
            hostSeatSnapshot({ hostSeatView: 'WAITING', revision: 4 }, recoveryId, 'RECONNECT'),
          );
          expect(states.at(-1)).toMatchObject({ kind: 'disconnected', snapshot: null });
          expect(sessionStorage.getItem(HOST_DELIVERY_STORAGE)).toContain(enter.deliveryKey);
          return;
        }
        if (scenario === 'foreign recovery scope') {
          recovery.reconnect(manage(recoveryId, active, 4, 'RECONNECT', receiptId, deviceId));
          expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
          expect(states.some((state) => state.kind === 'ready')).toBe(false);
          return;
        }
        recovery.reconnect(manage(recoveryId, active));
        expect(states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'CMP-009' } });
        expect(sessionStorage.getItem(HOST_DELIVERY_STORAGE) ?? '').not.toContain(
          enter.deliveryKey,
        );
      },
    );
  },
);

describe('ENTER_SETUP delivery after a prior GM acknowledgement', () => {
  it.each(['cancel setup', 'zero players', 'changed receipt'] as const)(
    'checks the original GM receipt with the new key after reload (%s)',
    async (scenario) => {
      vi.stubGlobal('WebSocket', Socket);
      vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ deviceId }))));
      writeHostDelivery(previous);
      const states: WebClientState[] = [];
      const client = await start(states);
      const socket = Socket.latest;
      const first = socket.open();
      if (first.messageType !== 'host.seat.control' || first.operation !== 'RESUME')
        throw new Error('Missing original grant');
      socket.reconnect(manage(first.requestId, true));
      expect(client.requestFormAction('CMP-009::CTA::002')).toEqual({ ok: true });
      const enter = socket.request(1);
      if (enter.messageType !== 'host.seat.control' || enter.operation !== 'ENTER_SETUP')
        throw new Error('Missing setup request');
      const setup = {
        hostSeatView: 'SETUP',
        revision: 5,
        profiles: [],
        selectedProfileOrNull: null,
      } as const;
      const actions = ['APP-003::CTA::004', 'APP-003::CTA::005'] as const;
      socket.publish(hostSeatSnapshot(setup, enter.requestId, 'FORM_ACTION', actions));
      client.disconnect();
      const reloaded = await start(states);
      let fresh = Socket.latest;
      const probe = fresh.open();
      if (probe.messageType !== 'host.seat.control' || probe.operation !== 'RESUME')
        throw new Error('Missing setup grant');
      expect(probe.deliveryKeyOrNull).toBe(enter.deliveryKey);
      fresh.reconnect(hostSeatSnapshot(setup, probe.requestId, 'RECONNECT', actions));
      expect(sessionStorage.getItem(HOST_DELIVERY_STORAGE)).not.toContain(previous.key);
      const nativeCaps = [HOST_SEAT_ACK, 'UI-CMD-CAMPAIGN-SETTINGS-SET'] as const;
      const reconnectGm = (snapshot: (id: string) => ProjectionSnapshotV2Message) => {
        expect(Socket.latest).not.toBe(fresh);
        fresh = Socket.latest;
        const resume = fresh.open();
        if (resume.messageType !== 'host.seat.control' || resume.operation !== 'RESUME')
          throw new Error('Expected a fresh GM capability negotiation');
        expect(resume.deliveryKeyOrNull).toBe(enter.deliveryKey);
        fresh.reconnect(snapshot(resume.requestId), nativeCaps);
      };
      const navigation = (action: Parameters<ProjectionConnection['requestFormAction']>[0]) => {
        expect(reloaded.requestFormAction(action)).toEqual({ ok: true });
        const decoded = decodeClientMessageV2(fresh.sent.at(-1)!, WEB_PROTOCOL_VOCABULARY);
        if (!decoded.ok || decoded.value.messageType !== 'navigation.form-action')
          throw new Error('Missing navigation');
        return decoded.value.navigationRequestId;
      };
      let id = navigation(scenario === 'zero players' ? 'APP-003::CTA::004' : 'APP-003::CTA::005');
      if (scenario === 'zero players') {
        fresh.publish(
          hostSeatSnapshot({ hostSeatView: 'GM_ONLY', revision: 6 }, id, 'FORM_ACTION', [
            'PLY-027::CTA::001',
          ]),
        );
        reconnectGm((requestId) =>
          hostSeatSnapshot({ hostSeatView: 'GM_ONLY', revision: 6 }, requestId, 'RECONNECT', [
            'PLY-027::CTA::001',
          ]),
        );
        id = navigation('PLY-027::CTA::001');
      }
      fresh.publish(
        manage(id, true, 6, 'FORM_ACTION', scenario === 'changed receipt' ? deviceId : receiptId),
      );
      if (scenario === 'changed receipt') {
        expect(states.at(-1)?.kind).toBe('protocol-error');
        return;
      }
      if (scenario === 'cancel setup') reconnectGm((requestId) => manage(requestId, true, 6));
      expect(states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: {
          formId: 'CMP-009',
          hostActive: { receiptId },
          executableWorkflowCommandIds: nativeCaps,
        },
      });
      reloaded.disconnect();
      const returnedClient = await start(states);
      const returned = Socket.latest;
      const resumed = returned.open();
      if (resumed.messageType !== 'host.seat.control' || resumed.operation !== 'RESUME')
        throw new Error('Missing returned GM proof');
      expect(resumed.deliveryKeyOrNull).toBe(enter.deliveryKey);
      if (scenario === 'zero players') {
        returned.reconnect(
          hostSeatSnapshot(
            { hostSeatView: 'GM_ONLY', revision: 6 },
            resumed.requestId,
            'RECONNECT',
            ['PLY-027::CTA::001'],
          ),
        );
        expect(returnedClient.requestFormAction('PLY-027::CTA::001')).toEqual({ ok: true });
        const decoded = decodeClientMessageV2(returned.sent.at(-1)!, WEB_PROTOCOL_VOCABULARY);
        if (!decoded.ok || decoded.value.messageType !== 'navigation.form-action')
          throw new Error('Missing GM return');
        returned.publish(manage(decoded.value.navigationRequestId, true, 6, 'FORM_ACTION'));
      } else returned.reconnect(manage(resumed.requestId, true, 6));
      expect(states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'CMP-009' } });
    },
  );
});
