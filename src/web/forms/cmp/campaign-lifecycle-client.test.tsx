import { gmDecisionDestination, type ConfirmedProjectionSnapshot } from '../../ws-client.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject, CommandReceipt } from '@shared/wire-protocol.js';
import {
  CAMPAIGN_LIFECYCLE_WORKFLOW_IDS as caps,
  campaignLifecycleGmActions,
  campaignLifecycleGmReceipt,
  campaignLifecycleGmRequest,
  campaignLifecyclePendingRequest,
  type CampaignLifecycleForm,
  type CampaignLifecycleGmProjection,
} from '@shared/campaign-lifecycle.js';
import { App } from '../../app.js';
import {
  connectProjection,
  type ProjectionConnection,
  type WebClientState,
} from '../../ws-client.js';
import { GM_CONTEXT_STORAGE_KEY } from './campaign-create.js';
import {
  CampaignLifecycleFields,
  type CampaignLifecycleEditor,
} from './campaign-lifecycle-fields.js';

const DEVICE = '123e4567-e89b-42d3-a456-426614174000';
const CONTEXT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPAIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COMMAND = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const p: CampaignLifecycleGmProjection = {
  contextId: CONTEXT,
  campaignId: CAMPAIGN,
  stateRevision: 4,
  projectionRevision: 9,
  actorVisibilityRevision: 3,
  campaignRevision: 2,
  settingsRevision: 0,
  campaignStatus: 'PAUSED',
  pauseReasonOrNull: null,
  firstStartCompleted: false,
  title: 'Кампания',
  descriptionOrNull: null,
  defaultFutureRollMode: 'MANUAL',
  networkForNextLaunch: { hostAddress: '127.0.0.1', hostPort: 31770, networkInterface: 'loopback' },
  activeListenerEndpointOrNull: {
    hostAddress: '127.0.0.1',
    hostPort: 31771,
    networkInterface: 'loopback',
  },
  availableNetworkInterfaces: [
    { hostAddress: '127.0.0.1', networkInterface: 'loopback', family: 'IPv4' },
  ],
  campaignArtChecksumOrNull: null,
  currentCapacity: 3,
  activePlayerCount: 0,
  safeBoundary: true,
  pendingOperationCount: 0,
  clockMode: null,
  checkpointPreview: { campaignRevision: 2, checkpointSha256: 'a'.repeat(64) },
  devices: [],
  commandId: null,
};
const json = (value: unknown) => value as JsonObject;
class Socket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: Socket[] = [];
  sent: string[] = [];
  readyState = Socket.CONNECTING;
  onopen: WebSocket['onopen'] = null;
  onmessage: WebSocket['onmessage'] = null;
  onclose: WebSocket['onclose'] = null;
  onerror: WebSocket['onerror'] = null;
  constructor() {
    Socket.instances.push(this);
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.readyState = Socket.CLOSED;
  }
  open() {
    this.readyState = Socket.OPEN;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }
  message(value: unknown) {
    this.onmessage?.call(
      this as unknown as WebSocket,
      new MessageEvent('message', { data: JSON.stringify(value) }),
    );
  }
  serverClose() {
    this.readyState = Socket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close', { code: 1006 }));
  }
}
const roots: Root[] = [],
  connections: ProjectionConnection[] = [];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
afterEach(() => {
  for (const c of connections.splice(0)) c.disconnect();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  Socket.instances = [];
  window.sessionStorage.clear();
});
function stub() {
  window.sessionStorage.setItem(GM_CONTEXT_STORAGE_KEY, CONTEXT);
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ deviceId: DEVICE }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
  vi.stubGlobal('WebSocket', Socket);
  let entropy = 0;
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint32Array) => {
      values.set([++entropy, 2, 3, 4]);
      return values;
    },
  });
}
const last = (s: Socket) => JSON.parse(s.sent.at(-1)!) as Record<string, unknown>;
function anchorOf(value: CampaignLifecycleGmProjection) {
  const {
    contextId,
    campaignId,
    stateRevision,
    projectionRevision,
    actorVisibilityRevision,
    campaignRevision,
    settingsRevision,
    campaignStatus,
    pauseReasonOrNull,
    firstStartCompleted,
  } = value;
  return {
    contextId,
    campaignId,
    stateRevision,
    projectionRevision,
    actorVisibilityRevision,
    campaignRevision,
    settingsRevision,
    campaignStatus,
    pauseReasonOrNull,
    firstStartCompleted,
  };
}
function frame(form: CampaignLifecycleForm, value = p, id = COMMAND, reason = 'RECONNECT') {
  const dialog = form === 'CMP-014' || form === 'CMP-015' || form === 'NET-023';
  const baseId = dialog ? 'CMP-008' : form;
  return {
    messageType: 'projection.snapshot',
    protocolVersion: 2,
    projectionRole: 'gm',
    revisions: {
      stateRevision: value.stateRevision,
      projectionRevision: value.projectionRevision,
      actorVisibilityRevision: value.actorVisibilityRevision,
    },
    presentation: {
      assignment: { reason, correlationId: id },
      base: {
        formId: baseId,
        formType: 'screen',
        routeTemplate: '/master/campaigns/:campaignId/campaign/' + baseId.toLowerCase(),
        routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CAMPAIGN }],
        availableActionKeys: dialog ? [] : campaignLifecycleGmActions(form, value, caps),
        roleFilteredPayload: { ...value, currentCampaignLifecycle: anchorOf(value) },
      },
      layers: dialog
        ? [
            {
              formId: form,
              formType: 'dialog',
              routeTemplate: '@dialog/' + form.toLowerCase(),
              routeBindings: [],
              availableActionKeys: campaignLifecycleGmActions(form, value, caps),
              roleFilteredPayload: value,
            },
          ]
        : [],
    },
  };
}
function resume(
  socket: Socket,
  form: CampaignLifecycleForm,
  value = p,
  beforeSnapshot?: () => void,
) {
  socket.open();
  const id = last(socket)['reconnectRequestId'] as string;
  beforeSnapshot?.();
  const snapshot = frame(form, value, id);
  socket.message({
    messageType: 'session.reconnect.capabilities',
    protocolVersion: 2,
    executableWorkflowCommandIds: caps,
    revisions: snapshot.revisions,
    reconnectRequestId: id,
  });
  socket.message(snapshot);
}
async function harness(form: CampaignLifecycleForm, value = p) {
  stub();
  const states: WebClientState[] = [];
  const connection = connectProjection((value) => states.push(value));
  connections.push(connection);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = Socket.instances.at(-1)!;
  resume(socket, form, value);
  expect(states.at(-1)).toMatchObject({ kind: 'ready' });
  return { connection, socket, states };
}

describe('campaign lifecycle browser delivery', () => {
  it.each(['CMP-008', 'CMP-014', 'CMP-015', 'NET-023'] as const)(
    'restores %s in the same GM authority',
    async (form) => {
      const h = await harness(form);
      expect(last(h.socket)).toMatchObject({
        messageType: 'campaign.local-context.resume',
        gmLocalContextId: CONTEXT,
      });
      expect(h.states.at(-1)).toMatchObject({
        snapshot: { projection: { contextId: CONTEXT, campaignId: CAMPAIGN } },
      });
    },
  );
  it('keeps a password out of reconnect and requires re-entry after proven absence', async () => {
    const h = await harness('CMP-015');
    const secret = 'secret-only-in-the-first-send';
    expect(
      h.connection.requestFormAction('CMP-015::CTA::003', undefined, null, {
        currentMasterPassword: secret,
        newMasterPassword: secret + '-new',
        newMasterPasswordConfirmation: secret + '-new',
      }),
    ).toEqual({ ok: true });
    const command = last(h.socket)['commandId'];
    h.socket.serverClose();
    expect(h.connection.reconnect()).toEqual({ ok: true });
    const next = Socket.instances.at(-1)!;
    resume(next, 'CMP-015', p, () =>
      next.message({
        messageType: 'command.refusal',
        protocolVersion: 1,
        commandId: command,
        lastLifecycleState: null,
        refusal: { code: 'GUARD_REJECTED' },
        revisions: {
          stateRevision: p.stateRevision,
          projectionRevision: p.projectionRevision,
          actorVisibilityRevision: p.actorVisibilityRevision,
        },
      }),
    );
    expect(next.sent.join('')).not.toContain(secret);
    expect(next.sent).toHaveLength(1);
    expect(next.sent[0]).toContain(String(command));
    expect(JSON.stringify(h.states)).not.toContain(secret);
    expect(h.states.at(-1)?.kind).not.toBe('protocol-error');
    expect(
      h.connection.requestFormAction('CMP-015::CTA::003', undefined, null, {
        currentMasterPassword: secret,
        newMasterPassword: secret + '-new',
        newMasterPasswordConfirmation: secret + '-new',
      }),
    ).toEqual({ ok: true });
    expect(last(next)['commandId']).not.toBe(command);
  });
  it('refreshes a live refusal without retrying the rejected password or requiring a manual reconnect', async () => {
    const h = await harness('CMP-015');
    const inputs = {
      currentMasterPassword: 'wrong-current-secret',
      newMasterPassword: 'new-valid-secret',
      newMasterPasswordConfirmation: 'new-valid-secret',
    };
    expect(h.connection.requestFormAction('CMP-015::CTA::003', undefined, null, inputs)).toEqual({
      ok: true,
    });
    const commandId = last(h.socket)['commandId'];
    h.socket.message({
      messageType: 'command.refusal',
      protocolVersion: 1,
      commandId,
      lastLifecycleState: null,
      revisions: {
        stateRevision: p.stateRevision,
        projectionRevision: p.projectionRevision,
        actorVisibilityRevision: p.actorVisibilityRevision,
      },
      refusal: { code: 'GUARD_REJECTED' },
    });
    const fresh = Socket.instances.at(-1)!;
    expect(fresh).not.toBe(h.socket);
    resume(fresh, 'CMP-015');
    expect(last(fresh)['unacknowledgedCommandIds']).toEqual([]);
    expect(fresh.sent.join('')).not.toContain(inputs.currentMasterPassword);
    expect(h.states.at(-1)).toMatchObject({ kind: 'ready' });
    expect(
      h.connection.requestFormAction('CMP-015::CTA::003', undefined, null, {
        ...inputs,
        currentMasterPassword: 'correct-current-secret',
      }),
    ).toEqual({ ok: true });
    expect(last(fresh)['commandId']).not.toBe(commandId);
  });
  it('accepts a genuine P-only system refresh with unchanged lifecycle state', async () => {
    const h = await harness('CMP-008');
    h.socket.message(
      frame(
        'CMP-008',
        { ...p, projectionRevision: p.projectionRevision + 1 },
        'network-gm-view:' + 'b'.repeat(64),
        'HOST_SYSTEM_EVENT',
      ),
    );
    expect(h.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { revisions: { projectionRevision: p.projectionRevision + 1 } },
    });
  });
  it.each(['campaign revision', 'settings revision', 'first Start'] as const)(
    'rejects a HOST_SYSTEM_EVENT with a newer P but regressed %s',
    async (regression) => {
      const original = {
        ...p,
        settingsRevision: 1,
        firstStartCompleted: true,
        campaignStatus: 'HOSTING' as const,
        clockMode: 'STOPPED' as const,
      };
      const h = await harness('CMP-008', original);
      const next: CampaignLifecycleGmProjection = {
        ...original,
        projectionRevision: original.projectionRevision + 1,
        ...(regression === 'campaign revision'
          ? {
              campaignRevision: 1,
              checkpointPreview: { ...p.checkpointPreview, campaignRevision: 1 },
            }
          : regression === 'settings revision'
            ? { settingsRevision: 0 }
            : { firstStartCompleted: false, campaignStatus: 'PAUSED', clockMode: null }),
      };
      h.socket.message(
        frame('CMP-008', next, 'network-gm-view:' + 'a'.repeat(64), 'HOST_SYSTEM_EVENT'),
      );
      expect(h.states.at(-1)).toMatchObject({ kind: 'protocol-error' });
    },
  );
  it.each(['missing', 'foreign', 'layer copy', 'unknown key'] as const)(
    'rejects %s lifecycle anchor rather than ignoring it',
    async (mutation) => {
      const h = await harness('CMP-015');
      const incoming = frame(
        'CMP-015',
        { ...p, projectionRevision: p.projectionRevision + 1 },
        'network-gm-view:' + 'c'.repeat(64),
        'HOST_SYSTEM_EVENT',
      );
      const payload = incoming.presentation.base.roleFilteredPayload;
      if (mutation === 'missing') Reflect.deleteProperty(payload, 'currentCampaignLifecycle');
      else if (mutation === 'foreign') payload.currentCampaignLifecycle.contextId = DEVICE;
      else if (mutation === 'layer copy')
        Object.assign(incoming.presentation.layers[0]!.roleFilteredPayload, {
          currentCampaignLifecycle: payload.currentCampaignLifecycle,
        });
      else Object.assign(payload.currentCampaignLifecycle, { privateVerifier: 'never accepted' });
      h.socket.message(incoming);
      expect(h.states.at(-1)).toMatchObject({ kind: 'protocol-error' });
    },
  );
  it('requires receipt semantic revisions even when a later destination has a newer projection revision', () => {
    const snapshot = (value: CampaignLifecycleGmProjection): ConfirmedProjectionSnapshot => ({
      formId: 'CMP-008',
      path: '/',
      projection: json(value),
      layers: [],
      revisions: {
        stateRevision: value.stateRevision,
        projectionRevision: value.projectionRevision,
        actorVisibilityRevision: value.actorVisibilityRevision,
      },
      currentCampaignLifecycle: anchorOf(value),
      availableActionKeys: [],
      executableWorkflowCommandIds: caps,
    });
    const receipt: CommandReceipt = {
      commandId: COMMAND,
      receiptId: DEVICE,
      revisions: { stateRevision: 5, projectionRevision: 10, actorVisibilityRevision: 4 },
      result: {
        workflowCommandId: 'UI-CMD-CAMPAIGN-SETTINGS-SET',
        contextId: CONTEXT,
        campaignId: CAMPAIGN,
        campaignRevision: 3,
        settingsRevision: 1,
        campaignStatus: 'PAUSED',
        pauseReasonOrNull: null,
      },
    };
    const next = { ...p, stateRevision: 5, projectionRevision: 11, actorVisibilityRevision: 4 };
    expect(gmDecisionDestination(snapshot(next), snapshot(p), receipt, true)).toBe(false);
    expect(
      gmDecisionDestination(
        snapshot({
          ...next,
          campaignRevision: 3,
          settingsRevision: 1,
          checkpointPreview: { ...p.checkpointPreview, campaignRevision: 3 },
        }),
        snapshot(p),
        receipt,
        true,
      ),
    ).toBe(true);
  });
  it('checks receipt identity, revisions and pause reason against the original intent', () => {
    const started = {
      ...p,
      firstStartCompleted: true,
      campaignStatus: 'HOSTING' as const,
      clockMode: 'STOPPED' as const,
    };
    const request = campaignLifecycleGmRequest(started, 'CMP-016::CTA::002', COMMAND, {
      reason: 'Перерыв',
    });
    const receipt: CommandReceipt = {
      commandId: COMMAND,
      receiptId: DEVICE,
      revisions: { stateRevision: 5, projectionRevision: 10, actorVisibilityRevision: 4 },
      result: {
        contextId: CONTEXT,
        receiptId: DEVICE,
        commandId: COMMAND,
        campaignId: CAMPAIGN,
        workflowCommandId: request.workflowCommandId,
        campaignRevision: 3,
        settingsRevision: 0,
        campaignStatus: 'PAUSED',
        pauseReasonOrNull: 'Перерыв',
        checkpointId: COMMAND,
        committedAt: '2026-11-02T00:00:00.000Z',
      },
    };
    expect(campaignLifecycleGmReceipt(receipt, request, started)).toEqual(receipt);
    for (const patch of [
      { contextId: DEVICE },
      { campaignRevision: 4 },
      { settingsRevision: 1 },
      { pauseReasonOrNull: 'Чужая причина' },
      { currentMasterPassword: 'leak' },
    ])
      expect(() =>
        campaignLifecycleGmReceipt(
          { ...receipt, result: { ...receipt.result, ...patch } },
          request,
          started,
        ),
      ).toThrow();
    const password = campaignLifecycleGmRequest(p, 'CMP-015::CTA::003', COMMAND, {
      currentMasterPassword: 'old',
      newMasterPassword: 'new',
      newMasterPasswordConfirmation: 'new',
    });
    expect(campaignLifecyclePendingRequest(password).payload).toEqual({
      campaignId: CAMPAIGN,
      expectedCampaignRevision: 2,
    });
  });
});

describe('visible lifecycle controls', () => {
  it('shows both endpoints, accepts new settings and has no art picker', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    let editor: CampaignLifecycleEditor | null = null;
    act(() =>
      root.render(
        <CampaignLifecycleFields
          formId="CMP-008"
          projection={json(p)}
          onEditor={(value) => {
            editor = value;
          }}
        />,
      ),
    );
    expect(container.textContent).toContain('127.0.0.1:31771');
    expect(container.textContent).toContain('127.0.0.1:31770');
    container.querySelector<HTMLInputElement>('[name="title"]')!.value = 'Новое название';
    expect((editor as CampaignLifecycleEditor | null)?.readInputs()).toMatchObject({
      title: 'Новое название',
      network: p.networkForNextLaunch,
    });
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
  it('clears password DOM synchronously when the real Atlas CTA sends its command', async () => {
    stub();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const socket = Socket.instances.at(-1)!;
    act(() => resume(socket, 'CMP-015'));
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    expect(inputs).toHaveLength(3);
    for (const input of inputs) input.value = 'first-send-secret';
    // A real P-only host frame decodes a fresh but equal network object.
    act(() =>
      socket.message(
        frame(
          'CMP-015',
          { ...p, projectionRevision: p.projectionRevision + 1 },
          'network-gm-view:' + 'c'.repeat(64),
          'HOST_SYSTEM_EVENT',
        ),
      ),
    );
    expect(inputs.every((input) => input.value === 'first-send-secret')).toBe(true);
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.getAttribute('data-atlas-action-key') === 'CMP-015::CTA::003',
    );
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(last(socket)).toMatchObject({ workflowCommandId: 'UI-CMD-MASTER-PASSWORD-CHANGE' });
    expect(inputs.every((input) => input.value === '')).toBe(true);
  });
});
