import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionKey } from '@generated/types/atlas.js';
import type {
  CommandReceipt,
  JsonObject,
  PresentedBaseForm,
  RevisionVector,
} from '@shared/index.js';
import type {
  CampaignCreationFormId,
  CampaignCreateRequest,
  CampaignCreateResult,
  CampaignDraftReplaceV3Message,
  CampaignDraftResultV3Message,
} from '@shared/campaign-creation.js';
import { App } from '../../app.js';
import {
  connectProjection,
  WEB_PROTOCOL_VOCABULARY,
  type ProjectionConnection,
  type WebClientState,
} from '../../ws-client.js';
import { presentedFormDefinition } from '../index.js';
import { CampaignCreationFields, type CampaignDraftClientState } from './campaign-create-fields.js';
import {
  CAMPAIGN_CREATION_FORMS,
  GM_CONTEXT_STORAGE_KEY,
  campaignCreateDestinationMatches,
  campaignDraftResultMatches,
  campaignEditFromProjection,
  campaignEditIsSendable,
  decodeCampaignCreateReceipt,
  decodeCampaignProjection,
  expectedCampaignActions,
  validCampaignSecret,
} from './campaign-create.js';

const DEVICE = '123e4567-e89b-42d3-a456-426614174000';
const CONTEXT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DRAFT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAMPAIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROFILE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ZERO = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const CAPABILITIES = ['UI-CMD-CAMPAIGN-CREATE'] as const;
const common = { gmLocalContextId: CONTEXT, hostDeviceId: DEVICE, masterAuthorityRevision: 0 };
const draft = {
  ...common,
  routeIdentityKind: 'CAMPAIGN_DRAFT',
  campaignDraftId: DRAFT,
  draftRevision: 0,
};
const host = {
  activePlayerCapacity: 3,
  hostAddress: '127.0.0.1',
  hostPort: 41337,
  networkInterface: 'Loopback',
};
const metadata = { title: 'Новая кампания', description: 'Описание', art: null };
const menu = {
  ...common,
  campaignLibraryState: { status: 'NO_CAMPAIGNS', draftCount: 0, pausedCampaignCount: 0 },
  masterAuthorityState: { status: 'CONFIRMED_LOCAL', masterProfileId: PROFILE, revision: 0 },
};
const projections: Record<CampaignCreationFormId, JsonObject> = {
  'APP-011': menu,
  'CMP-001': {
    ...draft,
    title: metadata.title,
    description: metadata.description,
    artFilePickerState: { status: 'EMPTY', value: null },
    artAssetChecksumOrNull: null,
  },
  'CMP-002': {
    ...draft,
    ...host,
    availableNetworkInterfaces: [
      { networkInterface: 'Loopback', hostAddress: '127.0.0.1', family: 'IPv4' },
    ],
  },
  'CMP-003': {
    ...draft,
    masterSecretConfigured: false,
    passwordStrengthLocal: {
      minimumCodePoints: 12,
      maximumCodePoints: 128,
      status: 'NOT_CONFIGURED',
    },
    secretPersistencePolicy: 'VERIFIER_ONLY_CLEAR_AFTER_SAVE',
  },
  'CMP-004': { ...draft, defaultFutureRollMode: 'MANUAL', openRollRequestsUnaffected: true },
  'CMP-005': {
    ...draft,
    fullDraftSummary: {
      metadata,
      host,
      defaultFutureRollMode: 'MANUAL',
      masterSecretConfigured: true,
      artAssetChecksumOrNull: null,
    },
    baselineVersion: 'baseline-test',
    catalogCompatibility: {
      status: 'PASS',
      registryVersion: 'registry-test',
      catalogVersion: 'catalog-test',
      builtAgainstTuple: 'tuple-test',
      reasonCode: null,
    },
    hostBindPreflight: { status: 'PASS', leaseIdOrNull: 'lease-test', reasonCode: null },
    activePlayerCount: 0,
    validationStatus: 'READY_TO_CREATE',
    commandId: null,
  },
  'CMP-006': {
    ...common,
    routeIdentityKind: 'CAMPAIGN',
    campaignId: CAMPAIGN,
    sourceCampaignDraftId: DRAFT,
    status: 'PAUSED',
    createdAt: '2026-10-30T12:00:00.000Z',
    ...host,
    qrPayload: `http://127.0.0.1:41337/?campaignId=${CAMPAIGN}`,
    creationReceiptId: 'receipt-create',
    creationCommandId: 'command-create',
    hostBindRecovery: { status: 'RESERVED', reasonCode: null },
  },
};
const shell: JsonObject = {
  baselineCompatibility: {
    builtAgainstTuple: { status: 'PASS', value: 'tuple-test' },
    catalogVersion: { status: 'PASS', value: 'catalog-test' },
    registryVersion: { status: 'PASS', value: 'registry-test' },
  },
  bootState: 'READY',
  buildVersion: 'build-test',
  formId: 'APP-001',
  integrityStatus: { changed: [], missing: [], ok: true, tracked: 22, untracked: [] },
};
const shellKeys = [
  'APP-001::CTA::001',
  'APP-001::CTA::002',
  'APP-001::CTA::003',
  'APP-001::CTA::004',
] as const;

function base(
  formId: CampaignCreationFormId | 'APP-001',
  p = formId === 'APP-001' ? shell : projections[formId],
  actions?: readonly ActionKey[],
): PresentedBaseForm {
  const definition = presentedFormDefinition(formId)!;
  return {
    formId,
    formType: 'screen',
    routeTemplate: definition.route,
    routeBindings: formId.startsWith('CMP-')
      ? [
          {
            parameterIndex: 0,
            source: 'inherited',
            value:
              formId === 'CMP-006'
                ? (p['campaignId'] as string)
                : `draft:${p['campaignDraftId'] as string}`,
          },
        ]
      : [],
    roleFilteredPayload: p,
    availableActionKeys:
      actions ??
      (formId === 'APP-001' ? shellKeys : expectedCampaignActions(formId, p, CAPABILITIES)),
  };
}
function snapshot(
  formId: CampaignCreationFormId | 'APP-001',
  p: JsonObject,
  revisions: RevisionVector,
  correlationId: string,
  reason = 'RECONNECT',
) {
  return {
    messageType: 'projection.snapshot',
    protocolVersion: 2,
    projectionRole: formId === 'APP-001' ? null : 'gm',
    revisions,
    presentation: { assignment: { reason, correlationId }, base: base(formId, p), layers: [] },
  };
}
function draftResult(
  request: CampaignDraftReplaceV3Message,
  p: JsonObject,
  formId = request.scope.sourceFormId,
  changed = true,
): CampaignDraftResultV3Message {
  const increment = changed ? 1 : 0;
  const revisions = {
    ...request.expectedRevisions,
    stateRevision: request.expectedRevisions.stateRevision + increment,
    projectionRevision: request.expectedRevisions.projectionRevision + increment,
  };
  return {
    messageType: 'campaign.draft.result',
    protocolVersion: 3,
    scope: request.scope,
    draftUpdateId: request.draftUpdateId,
    changed,
    appliedDraftRevision: request.expectedDraftRevision + increment,
    appliedRevisions: revisions,
    draftRevision: p['draftRevision'] as number,
    revisions,
    projectionRole: 'gm',
    presentation: { base: base(formId, p), layers: [] },
  };
}

class Socket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
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
const connections: ProjectionConnection[] = [],
  roots: { root: Root; container: HTMLDivElement }[] = [];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
afterEach(() => {
  for (const c of connections.splice(0)) c.disconnect();
  for (const r of roots.splice(0)) {
    act(() => r.root.unmount());
    r.container.remove();
  }
  Socket.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});
function stubTransport(ticket = true) {
  if (ticket) window.sessionStorage.setItem(GM_CONTEXT_STORAGE_KEY, CONTEXT);
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
const lastFrame = <T,>(socket: Socket): T => JSON.parse(socket.sent.at(-1)!) as T;
function reconnect(
  socket: Socket,
  formId: CampaignCreationFormId | 'APP-001',
  p: JsonObject,
  revisions = ZERO,
) {
  socket.open();
  const request = lastFrame<{ reconnectRequestId: string }>(socket);
  socket.message({
    messageType: 'session.reconnect.capabilities',
    protocolVersion: 2,
    executableWorkflowCommandIds: formId === 'APP-001' ? [] : CAPABILITIES,
    revisions,
    reconnectRequestId: request.reconnectRequestId,
  });
  socket.message(snapshot(formId, p, revisions, request.reconnectRequestId));
}
async function harness(
  formId: CampaignCreationFormId | 'APP-001',
  p = formId === 'APP-001' ? shell : projections[formId],
  revisions = ZERO,
  configureStorage?: () => void,
) {
  stubTransport(formId !== 'APP-001');
  configureStorage?.();
  const states: WebClientState[] = [],
    drafts: (CampaignDraftClientState | null)[] = [];
  const connection = connectProjection(
    (v) => states.push(v),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    (v) => drafts.push(v),
  );
  connections.push(connection);
  await new Promise((r) => setTimeout(r, 0));
  const socket = Socket.instances.at(-1)!;
  reconnect(socket, formId, p, revisions);
  return { connection, socket, states, drafts };
}

describe('campaign projection contract', () => {
  it.each(CAMPAIGN_CREATION_FORMS)(
    'accepts the exact %s DTO and rejects extra/private values',
    (id) => {
      expect(decodeCampaignProjection(projections[id], '$', id).ok).toBe(true);
      expect(
        decodeCampaignProjection(
          { ...projections[id], masterTransferPassword: 'must never be reflected' },
          '$',
          id,
        ),
      ).toEqual({ ok: false, refusal: { code: 'UNRECOGNIZED', path: '$', value: null } });
    },
  );
  it('closes all nested records and binds source guards to their actual values', () => {
    const invalid = [
      ['CMP-001', { ...projections['CMP-001'], artAssetChecksumOrNull: 'a'.repeat(64) }],
      ['CMP-002', { ...projections['CMP-002'], activePlayerCapacity: 6 }],
      ['CMP-003', { ...projections['CMP-003'], masterSecretConfigured: true }],
      ['CMP-004', { ...projections['CMP-004'], openRollRequestsUnaffected: false }],
      [
        'CMP-005',
        {
          ...projections['CMP-005'],
          hostBindPreflight: { status: 'PASS', leaseIdOrNull: null, reasonCode: null },
        },
      ],
      [
        'CMP-005',
        {
          ...projections['CMP-005'],
          catalogCompatibility: {
            ...(projections['CMP-005']['catalogCompatibility'] as JsonObject),
            rawSource: 'private',
          },
        },
      ],
      ['CMP-006', { ...projections['CMP-006'], status: 'ACTIVE' }],
    ] as const;
    for (const [id, value] of invalid)
      expect(decodeCampaignProjection(value, '$', id).ok).toBe(false);
    expect(expectedCampaignActions('CMP-005', projections['CMP-005'], [])).toEqual([
      'CMP-005::CTA::002',
    ]);
    expect(expectedCampaignActions('CMP-006', projections['CMP-006'], CAPABILITIES)).toEqual([
      'CMP-006::CTA::002',
    ]);
    expect(
      expectedCampaignActions(
        'CMP-002',
        { ...projections['CMP-002'], networkInterface: 'forged' },
        CAPABILITIES,
      ),
    ).toEqual(['CMP-002::CTA::001']);
  });
  it('validates secret Unicode without trimming or canonicalizing and never reconstructs it', () => {
    for (const value of ['123456789012', '😀'.repeat(12), ' 1234567890 '])
      expect(validCampaignSecret(value, value)).toBe(true);
    for (const value of ['12345678901', 'a'.repeat(129), '123456789012\n', '123456789012\ud800'])
      expect(validCampaignSecret(value, value)).toBe(false);
    expect(validCampaignSecret('123456789012', '123456789013')).toBe(false);
    expect(campaignEditFromProjection('CMP-003', projections['CMP-003'])).toBeNull();
    expect(campaignEditIsSendable({ variant: 'HOST', values: { ...host, hostPort: 0 } })).toBe(
      false,
    );
  });
  it('binds immutable applied event facts while accepting a later view on exact replay', () => {
    const request: CampaignDraftReplaceV3Message = {
      messageType: 'campaign.draft.replace',
      protocolVersion: 3,
      draftUpdateId: 'draft-update',
      scope: { gmLocalContextId: CONTEXT, campaignDraftId: DRAFT, sourceFormId: 'CMP-001' },
      variant: 'METADATA',
      values: metadata,
      expectedDraftRevision: 0,
      expectedRevisions: ZERO,
    };
    const p = { ...projections['CMP-001'], draftRevision: 1 },
      result = draftResult(request, p);
    expect(campaignDraftResultMatches(result, request, p)).toBe(true);
    const later = { ...p, draftRevision: 5 };
    expect(
      campaignDraftResultMatches(
        {
          ...result,
          draftRevision: 5,
          revisions: { ...ZERO, stateRevision: 5, projectionRevision: 9 },
        },
        request,
        later,
      ),
    ).toBe(true);
    expect(campaignDraftResultMatches({ ...result, appliedDraftRevision: 5 }, request, later)).toBe(
      false,
    );
    expect(
      campaignDraftResultMatches(
        draftResult(request, projections['CMP-001'], 'CMP-001', false),
        request,
        projections['CMP-001'],
      ),
    ).toBe(true);
    expect(campaignDraftResultMatches({ ...result, changed: false }, request, p)).toBe(false);
  });
});

describe('campaign draft transport', () => {
  it.each(['missing', 'getter', 'read', 'write', 'remove'] as const)(
    'keeps player transport and GM memory context usable with unavailable storage: %s',
    async (failure) => {
      const storage = {
        getItem: vi.fn(() => {
          if (failure === 'read') throw new DOMException('Storage blocked', 'SecurityError');
          return null;
        }),
        setItem: vi.fn((_key: string, _value: string) => {
          if (failure === 'write') throw new DOMException('Storage full', 'QuotaExceededError');
        }),
        removeItem: vi.fn((_key: string) => {
          if (failure === 'remove') throw new DOMException('Storage blocked', 'SecurityError');
        }),
      };
      const h = await harness('APP-001', shell, ZERO, () => {
        const localWindow = { location: window.location };
        if (failure !== 'missing')
          Object.defineProperty(localWindow, 'sessionStorage', {
            get() {
              if (failure === 'getter') throw new DOMException('Storage blocked', 'SecurityError');
              return storage;
            },
          });
        vi.stubGlobal('window', localWindow);
      });
      expect(h.states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'APP-001' } });
      expect(lastFrame(h.socket)).toMatchObject({ messageType: 'session.reconnect' });
      expect(h.connection.requestFormAction('APP-001::CTA::002')).toEqual({ ok: true });
      let nav = lastFrame<{ navigationRequestId: string }>(h.socket);
      h.socket.message(snapshot('APP-011', menu, ZERO, nav.navigationRequestId, 'FORM_ACTION'));
      let active = Socket.instances.at(-1)!;
      reconnect(active, 'CMP-003', projections['CMP-003']);
      expect(lastFrame(active)).toMatchObject({
        messageType: 'campaign.local-context.resume',
        gmLocalContextId: CONTEXT,
      });
      expect(h.states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'CMP-003' } });
      vi.useFakeTimers();
      const secret = 'never-store-this-master-secret';
      h.connection.replaceCampaignDraft({
        variant: 'SECRET',
        values: { masterTransferPassword: secret, masterTransferPasswordConfirmation: secret },
      });
      await vi.advanceTimersByTimeAsync(250);
      const request = lastFrame<CampaignDraftReplaceV3Message>(active);
      const confirmed = {
        ...projections['CMP-003'],
        draftRevision: 1,
        masterSecretConfigured: true,
        passwordStrengthLocal: {
          minimumCodePoints: 12,
          maximumCodePoints: 128,
          status: 'CONFIGURED',
        },
      };
      const ack = draftResult(request, confirmed);
      active.message(ack);
      expect(h.states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'CMP-003' } });
      expect(h.drafts.at(-1)).toMatchObject({ values: null, dirty: false, pending: false });
      active.serverClose();
      expect(h.connection.reconnect()).toEqual({ ok: true });
      active = Socket.instances.at(-1)!;
      reconnect(active, 'CMP-003', confirmed, ack.revisions);
      expect(lastFrame(active)).toMatchObject({
        messageType: 'campaign.local-context.resume',
        gmLocalContextId: CONTEXT,
      });
      expect(active.sent.join('')).not.toContain(secret);
      let revisions = ack.revisions;
      for (const [actionKey, target] of [
        ['CMP-003::CTA::001', 'CMP-002'],
        ['CMP-002::CTA::001', 'CMP-001'],
      ] as const) {
        expect(h.connection.requestFormAction(actionKey)).toEqual({ ok: true });
        nav = lastFrame(active);
        revisions = { ...revisions, projectionRevision: revisions.projectionRevision + 1 };
        active.message(
          snapshot(
            target,
            { ...projections[target], draftRevision: 1 },
            revisions,
            nav.navigationRequestId,
            'FORM_ACTION',
          ),
        );
      }
      expect(h.connection.requestFormAction('CMP-001::CTA::002')).toEqual({ ok: true });
      nav = lastFrame(active);
      active.message(
        snapshot(
          'APP-011',
          menu,
          { ...ZERO, projectionRevision: 2 },
          nav.navigationRequestId,
          'FORM_ACTION',
        ),
      );
      expect(h.connection.requestFormAction('APP-011::CTA::001')).toEqual({ ok: true });
      nav = lastFrame(active);
      active.message(
        snapshot(
          'APP-001',
          shell,
          { ...ZERO, projectionRevision: 3 },
          nav.navigationRequestId,
          'FORM_ACTION',
        ),
      );
      active = Socket.instances.at(-1)!;
      reconnect(active, 'APP-001', shell, { ...ZERO, projectionRevision: 3 });
      expect(lastFrame(active)).toMatchObject({ messageType: 'session.reconnect' });
      expect(h.states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'APP-001' } });
      for (const args of storage.setItem.mock.calls)
        expect(args).toEqual([GM_CONTEXT_STORAGE_KEY, CONTEXT]);
      for (const args of storage.removeItem.mock.calls)
        expect(args).toEqual([GM_CONTEXT_STORAGE_KEY]);
      expect(
        JSON.stringify([storage.setItem.mock.calls, storage.removeItem.mock.calls]),
      ).not.toContain(secret);
    },
  );
  it('coalesces nonsecret edits, binds ACK revisions and preserves newer edits during an in-flight request', async () => {
    const h = await harness('CMP-001');
    expect(h.states.at(-1)?.kind).toBe('ready');
    expect(lastFrame<{ messageType: string }>(h.socket).messageType).toBe(
      'campaign.local-context.resume',
    );
    vi.useFakeTimers();
    h.connection.replaceCampaignDraft({
      variant: 'METADATA',
      values: { ...metadata, title: 'Первый' },
    });
    h.connection.replaceCampaignDraft({
      variant: 'METADATA',
      values: { ...metadata, title: 'Второй' },
    });
    expect(h.connection.requestFormAction('CMP-001::CTA::001').ok).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    const first = lastFrame<CampaignDraftReplaceV3Message>(h.socket);
    expect(first).toMatchObject({
      variant: 'METADATA',
      expectedDraftRevision: 0,
      values: { title: 'Второй' },
    });
    h.connection.replaceCampaignDraft({
      variant: 'METADATA',
      values: { ...metadata, title: 'Третий' },
    });
    h.socket.message(
      draftResult(first, { ...projections['CMP-001'], title: 'Второй', draftRevision: 1 }),
    );
    const second = lastFrame<CampaignDraftReplaceV3Message>(h.socket);
    expect(second).toMatchObject({
      expectedDraftRevision: 1,
      expectedRevisions: { stateRevision: 1, projectionRevision: 1 },
      values: { title: 'Третий' },
    });
    expect(second.draftUpdateId).not.toBe(first.draftUpdateId);
    h.socket.message(
      draftResult(second, { ...projections['CMP-001'], title: 'Третий', draftRevision: 2 }),
    );
    expect(h.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        projection: { title: 'Третий', draftRevision: 2 },
        availableActionKeys: ['CMP-001::CTA::001', 'CMP-001::CTA::002'],
      },
    });
  });
  it('keeps secret inputs out of callbacks, clears ACK state and clears invalid pending values before back', async () => {
    const h = await harness('CMP-003');
    vi.useFakeTimers();
    const secret = 'never-retain-this-secret';
    h.connection.replaceCampaignDraft({
      variant: 'SECRET',
      values: { masterTransferPassword: secret, masterTransferPasswordConfirmation: 'mismatch' },
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(h.socket.sent).toHaveLength(1);
    h.connection.replaceCampaignDraft({
      variant: 'SECRET',
      values: { masterTransferPassword: secret, masterTransferPasswordConfirmation: secret },
    });
    await vi.advanceTimersByTimeAsync(250);
    const request = lastFrame<CampaignDraftReplaceV3Message>(h.socket);
    expect(request.variant).toBe('SECRET');
    expect(JSON.stringify(h.drafts)).not.toContain(secret);
    const p = {
      ...projections['CMP-003'],
      draftRevision: 1,
      masterSecretConfigured: true,
      passwordStrengthLocal: {
        minimumCodePoints: 12,
        maximumCodePoints: 128,
        status: 'CONFIGURED',
      },
    };
    h.socket.message(draftResult(request, p));
    expect(h.drafts.at(-1)).toMatchObject({ values: null, dirty: false, pending: false });
    expect(h.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { availableActionKeys: ['CMP-003::CTA::001', 'CMP-003::CTA::002'] },
    });
    h.connection.replaceCampaignDraft({
      variant: 'SECRET',
      values: { masterTransferPassword: 'invalid', masterTransferPasswordConfirmation: '' },
    });
    expect(h.connection.requestFormAction('CMP-003::CTA::001')).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(lastFrame<{ messageType: string }>(h.socket).messageType).toBe('navigation.form-action');
    expect(h.drafts.at(-1)?.dirty).toBe(false);
  });
  it('replays an unacknowledged nonsecret update exactly after fresh GM resume without lowering its current view', async () => {
    const h = await harness('CMP-001');
    vi.useFakeTimers();
    h.connection.replaceCampaignDraft({
      variant: 'METADATA',
      values: { ...metadata, title: 'Новый заголовок' },
    });
    await vi.advanceTimersByTimeAsync(250);
    const original = h.socket.sent.at(-1)!;
    h.socket.serverClose();
    expect(h.connection.reconnect()).toEqual({ ok: true });
    const resumed = Socket.instances.at(-1)!;
    reconnect(
      resumed,
      'CMP-001',
      { ...projections['CMP-001'], title: 'Поздний заголовок', draftRevision: 4 },
      { ...ZERO, stateRevision: 4, projectionRevision: 6 },
    );
    expect(resumed.sent.at(-1)).toBe(original);
    const request = JSON.parse(original) as CampaignDraftReplaceV3Message;
    const p = { ...projections['CMP-001'], title: 'Поздний заголовок', draftRevision: 4 };
    resumed.message({
      ...draftResult(request, p),
      draftRevision: 4,
      revisions: { ...ZERO, stateRevision: 4, projectionRevision: 6 },
    });
    expect(h.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { projection: { title: 'Поздний заголовок' } },
    });
  });
  it('checks exact owner, draft namespace, role and actions on resumed projections', async () => {
    for (const mutation of [
      (s: ReturnType<typeof snapshot>) => {
        s.projectionRole = 'player';
      },
      (s: ReturnType<typeof snapshot>) => {
        s.presentation.base = {
          ...s.presentation.base,
          routeBindings: [{ parameterIndex: 0, source: 'inherited', value: DRAFT }],
        };
      },
      (s: ReturnType<typeof snapshot>) => {
        s.presentation.base = {
          ...s.presentation.base,
          roleFilteredPayload: {
            ...s.presentation.base.roleFilteredPayload,
            hostDeviceId: PROFILE,
          },
        };
      },
      (s: ReturnType<typeof snapshot>) => {
        s.presentation.base = { ...s.presentation.base, availableActionKeys: [] };
      },
    ]) {
      const h = await harness('CMP-001');
      h.socket.serverClose();
      h.connection.reconnect();
      const s = Socket.instances.at(-1)!;
      s.open();
      const req = lastFrame<{ reconnectRequestId: string }>(s);
      s.message({
        messageType: 'session.reconnect.capabilities',
        protocolVersion: 2,
        executableWorkflowCommandIds: CAPABILITIES,
        revisions: ZERO,
        reconnectRequestId: req.reconnectRequestId,
      });
      const value = snapshot('CMP-001', projections['CMP-001'], ZERO, req.reconnectRequestId);
      mutation(value);
      s.message(value);
      expect(h.states.at(-1)?.kind).toBe('protocol-error');
    }
  });
  it.each([
    ['APP-011', { ...ZERO, stateRevision: 1 }],
    ['APP-011', { ...ZERO, actorVisibilityRevision: 1 }],
    ['CMP-006', { ...ZERO, stateRevision: 1 }],
    ['CMP-006', { ...ZERO, stateRevision: 2, projectionRevision: 1 }],
    ['CMP-006', { ...ZERO, actorVisibilityRevision: 1 }],
  ] as const)('rejects an invalid resumed %s revision vector %j', async (formId, revisions) => {
    const h = await harness(formId, projections[formId], revisions);
    expect(h.states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      refusal: { code: 'UNRECOGNIZED', path: '$.revisions', value: null },
    });
  });
  it.each([
    ['APP-011', { ...ZERO, projectionRevision: 7 }],
    ['CMP-006', ZERO],
    ['CMP-006', { ...ZERO, projectionRevision: 1 }],
    ['CMP-006', { ...ZERO, stateRevision: 2, projectionRevision: 4 }],
  ] as const)('accepts the persisted resumed %s revision vector %j', async (formId, revisions) => {
    const h = await harness(formId, projections[formId], revisions);
    expect(h.states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId, revisions } });
  });
  it('never projects pending metadata onto a different resumed step', async () => {
    const h = await harness('CMP-001');
    vi.useFakeTimers();
    h.connection.replaceCampaignDraft({
      variant: 'METADATA',
      values: { ...metadata, title: 'Не смешивать формы' },
    });
    await vi.advanceTimersByTimeAsync(250);
    const request = lastFrame<CampaignDraftReplaceV3Message>(h.socket);
    h.socket.serverClose();
    h.connection.reconnect();
    const resumed = Socket.instances.at(-1)!;
    const p = { ...projections['CMP-002'], draftRevision: 4 };
    reconnect(resumed, 'CMP-002', p, { ...ZERO, stateRevision: 4, projectionRevision: 6 });
    expect(h.drafts.at(-1)?.values).toBeNull();
    resumed.message({
      ...draftResult(request, p, 'CMP-002'),
      draftRevision: 4,
      revisions: { ...ZERO, stateRevision: 4, projectionRevision: 6 },
    });
    expect(h.states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'CMP-002' } });
    expect(h.drafts.at(-1)).toMatchObject({ values: null, dirty: false, pending: false });
  });
  it('drops secret buffers on a transport error and does not replay the plaintext after reconnect', async () => {
    const h = await harness('CMP-003');
    vi.useFakeTimers();
    const secret = 'discard-after-network-error';
    h.connection.replaceCampaignDraft({
      variant: 'SECRET',
      values: { masterTransferPassword: secret, masterTransferPasswordConfirmation: secret },
    });
    await vi.advanceTimersByTimeAsync(250);
    const before = h.drafts.at(-1)!.secretClearSequence;
    h.socket.onerror?.call(h.socket as unknown as WebSocket, new Event('error'));
    expect(h.drafts.at(-1)).toMatchObject({ dirty: false, pending: false, values: null });
    expect(h.drafts.at(-1)!.secretClearSequence).toBeGreaterThan(before);
    h.connection.reconnect();
    const resumed = Socket.instances.at(-1)!;
    reconnect(resumed, 'CMP-003', projections['CMP-003']);
    expect(resumed.sent).toHaveLength(1);
    expect(resumed.sent.join('')).not.toContain(secret);
  });
  it.each([0, 5])(
    'negotiates GM capabilities from persisted menu P=%i and keeps menu/shell vectors independent',
    async (menuProjectionRevision) => {
      const h = await harness('APP-001', shell, {
        ...ZERO,
        stateRevision: 8,
        projectionRevision: 10,
      });
      expect(h.connection.requestFormAction('APP-001::CTA::002')).toEqual({ ok: true });
      let nav = lastFrame<{ navigationRequestId: string }>(h.socket);
      const menuRevisions = { ...ZERO, projectionRevision: menuProjectionRevision };
      h.socket.message(
        snapshot('APP-011', menu, menuRevisions, nav.navigationRequestId, 'FORM_ACTION'),
      );
      let s = Socket.instances.at(-1)!;
      expect(s).not.toBe(h.socket);
      reconnect(s, 'APP-011', menu, menuRevisions);
      expect(lastFrame<{ messageType: string }>(s).messageType).toBe(
        'campaign.local-context.resume',
      );
      expect(window.sessionStorage.getItem(GM_CONTEXT_STORAGE_KEY)).toBe(CONTEXT);
      h.connection.requestFormAction('APP-011::CTA::006');
      nav = lastFrame(s);
      s.message(
        snapshot('CMP-001', projections['CMP-001'], ZERO, nav.navigationRequestId, 'FORM_ACTION'),
      );
      h.connection.requestFormAction('CMP-001::CTA::002');
      nav = lastFrame(s);
      s.message(
        snapshot(
          'APP-011',
          menu,
          { ...ZERO, projectionRevision: menuProjectionRevision + 2 },
          nav.navigationRequestId,
          'FORM_ACTION',
        ),
      );
      expect(h.states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'APP-011' } });
      h.connection.requestFormAction('APP-011::CTA::001');
      nav = lastFrame(s);
      s.message(
        snapshot(
          'APP-001',
          shell,
          { ...ZERO, stateRevision: 8, projectionRevision: 15 },
          nav.navigationRequestId,
          'FORM_ACTION',
        ),
      );
      expect(window.sessionStorage.getItem(GM_CONTEXT_STORAGE_KEY)).toBeNull();
      s = Socket.instances.at(-1)!;
      s.open();
      expect(lastFrame<{ messageType: string }>(s).messageType).toBe('session.reconnect');
    },
  );
});

describe('campaign creation receipt and UI', () => {
  it('clears a lost uncommitted CREATE only after its correlated refusal and restores CMP-005 without automatic creation', async () => {
    const source = { ...projections['CMP-005'], draftRevision: 4 },
      revisions = { ...ZERO, stateRevision: 4, projectionRevision: 8 };
    const h = await harness('CMP-005', source, revisions);
    expect(h.connection.requestFormAction('CMP-005::CTA::001')).toEqual({ ok: true });
    const lost = lastFrame<CampaignCreateRequest>(h.socket);
    h.socket.serverClose();
    h.connection.reconnect();
    const resumed = Socket.instances.at(-1)!;
    resumed.open();
    const request = lastFrame<{ reconnectRequestId: string; unacknowledgedCommandIds: string[] }>(
      resumed,
    );
    expect(request.unacknowledgedCommandIds).toEqual([lost.commandId]);
    resumed.message({
      messageType: 'command.refusal',
      protocolVersion: 1,
      commandId: lost.commandId,
      lastLifecycleState: null,
      refusal: { code: 'GUARD_REJECTED' },
      revisions,
    });
    resumed.message({
      messageType: 'session.reconnect.capabilities',
      protocolVersion: 2,
      reconnectRequestId: request.reconnectRequestId,
      revisions,
      executableWorkflowCommandIds: CAPABILITIES,
    });
    resumed.message(snapshot('CMP-005', source, revisions, request.reconnectRequestId));
    expect(h.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'CMP-005',
        availableActionKeys: ['CMP-005::CTA::001', 'CMP-005::CTA::002'],
      },
    });
    expect(resumed.sent).toHaveLength(1);
    expect(h.connection.requestFormAction('CMP-005::CTA::001')).toEqual({ ok: true });
    expect(lastFrame<CampaignCreateRequest>(resumed).commandId).not.toBe(lost.commandId);
  });
  it('accepts a zero-version new campaign only for the exact pending CREATE receipt and projection', async () => {
    const source = { ...projections['CMP-005'], draftRevision: 4 };
    const h = await harness('CMP-005', source, {
      ...ZERO,
      stateRevision: 4,
      projectionRevision: 8,
    });
    expect(h.connection.requestFormAction('CMP-005::CTA::001')).toEqual({ ok: true });
    const request = lastFrame<CampaignCreateRequest>(h.socket);
    expect(request).toMatchObject({
      role: 'gm',
      workflowCommandId: 'UI-CMD-CAMPAIGN-CREATE',
      payload: { preflightLeaseId: 'lease-test', draftRevision: 4 },
    });
    const result: CampaignCreateResult = {
      stage: 'CAMPAIGN_CREATE',
      gmLocalContextId: CONTEXT,
      campaignDraftId: DRAFT,
      campaignId: CAMPAIGN,
      status: 'PAUSED',
      createdAt: '2026-10-30T12:00:00.000Z',
      creationReceiptId: 'receipt-create',
      sourceDraftRevision: 4,
      sourceRevisions: { ...request.expectedRevisions },
      targetRevisions: { ...ZERO },
      ...host,
      defaultFutureRollMode: 'MANUAL',
      qrPayload: projections['CMP-006']['qrPayload'] as string,
      baselineVersion: 'baseline-test',
    };
    const receipt: CommandReceipt<CampaignCreateResult> = {
      commandId: request.commandId,
      receiptId: 'receipt-create',
      revisions: ZERO,
      result,
    };
    expect(decodeCampaignCreateReceipt(receipt, request, source).ok).toBe(true);
    expect(
      decodeCampaignCreateReceipt(
        { ...receipt, result: { ...result, hostPort: 1234 } },
        request,
        source,
      ).ok,
    ).toBe(false);
    expect(campaignCreateDestinationMatches('CMP-006', projections['CMP-006'], ZERO, receipt)).toBe(
      false,
    );
    h.socket.message({
      messageType: 'command.result',
      protocolVersion: 1,
      lifecycleState: 'COMMITTED',
      receipt,
    });
    h.socket.message(
      snapshot(
        'CMP-006',
        { ...projections['CMP-006'], creationCommandId: request.commandId },
        ZERO,
        request.commandId,
        'COMMAND_DESTINATION',
      ),
    );
    expect(h.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { formId: 'CMP-006', revisions: ZERO, availableActionKeys: ['CMP-006::CTA::002'] },
    });
    expect(h.connection.requestFormAction('CMP-006::CTA::001').ok).toBe(false);
  });
  it('renders local password controls and clears the DOM on acknowledged sequence change', () => {
    const container = document.createElement('div'),
      root = createRoot(container);
    document.body.append(container);
    roots.push({ root, container });
    const onChange = vi.fn();
    const render = (sequence: number, pending = false) =>
      act(() =>
        root.render(
          <CampaignCreationFields
            formId="CMP-003"
            projection={projections['CMP-003']}
            state={{
              values: null,
              dirty: false,
              pending,
              lastRefusal: null,
              secretClearSequence: sequence,
            }}
            onChange={onChange}
            onBusy={() => {}}
          />,
        ),
      );
    render(0);
    const password = container.querySelector<HTMLInputElement>(
      'input[aria-label="Секрет передачи мастера"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        password,
        'temporary-secret',
      );
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({
      variant: 'SECRET',
      values: {
        masterTransferPassword: 'temporary-secret',
        masterTransferPasswordConfirmation: '',
      },
    });
    render(0, true);
    expect(password.closest('fieldset')?.disabled).toBe(true);
    render(1);
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('');
    expect(container.textContent).not.toContain('temporary-secret');
  });
  it('uses the actual app renderer without raw Atlas metadata or GM context IDs', async () => {
    stubTransport();
    const container = document.createElement('div'),
      root = createRoot(container);
    document.body.append(container);
    roots.push({ root, container });
    await act(async () => {
      root.render(<App />);
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => reconnect(Socket.instances.at(-1)!, 'CMP-001', projections['CMP-001']));
    expect(container.querySelector('input[aria-label="Название кампании"]')).not.toBeNull();
    expect(container.querySelector('[data-required-field]')).toBeNull();
    expect(container.textContent).not.toContain('gmLocalContextId');
    expect(container.textContent).not.toContain(CONTEXT);
    expect(
      WEB_PROTOCOL_VOCABULARY.isPresentedForm(
        'CMP-001',
        'screen',
        presentedFormDefinition('CMP-001')!.route,
        [{ parameterIndex: 0, source: 'inherited', value: DRAFT }],
      ),
    ).toBe(false);
  });
});
