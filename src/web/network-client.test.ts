import { afterEach, describe, expect, it, vi } from 'vitest';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ActionKey } from '@generated/types/atlas.js';
import type {
  JsonObject,
  JsonValue,
  ProjectionSnapshotV2Message,
  RevisionVector,
  WorkflowCommandId,
} from '@shared/index.js';
import type { NetworkApplicationFormId } from '@shared/network-application.js';
import { NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS } from '@shared/device-admission.js';
import {
  connectProjection,
  gmDecisionDestination,
  LOCAL_ROLE_CHOICE_DETAIL,
  type ProjectionConnection,
  type NetworkGmRequestDraftClientState,
  type WebClientState,
} from './ws-client.js';
import { NETWORK_CONTEXT_STORAGE_KEY } from './forms/net/network-application.js';
import {
  admissionBrowserReceipt,
  type AdmissionBrowserRequest,
} from './forms/net/admission-client.js';
import type { ConfirmedProjectionSnapshot } from './ws-client.js';
import { GM_CONTEXT_STORAGE_KEY } from './forms/cmp/campaign-create.js';
import { presentedFormDefinition } from './forms/index.js';
import { App } from './app.js';
import type { NetworkDraftClientState } from './forms/net/network-fields.js';

const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCOPE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTEXT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CAMPAIGN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SESSION = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const NEXT_CONTEXT = '33333333-3333-4333-8333-333333333333';
const ZERO = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const CAPS = [
  'UI-CMD-CONNECTION-OPEN',
  'UI-CMD-DEVICE-REQUEST-SUBMIT',
  'UI-CMD-DEVICE-REQUEST-CANCEL',
] as const;
const ADDRESS = `http://192.168.1.20:3000/?campaignId=${CAMPAIGN}`;
const REF = {
  sourceUuid: 'historical-source-v8',
  finalSnapshotVersion: 7,
  metadataRevision: 2,
  candidateSnapshotChecksum: '1'.repeat(64),
  requestedControllerSeat: SEAT,
};
const SUMMARY = { ...REF, name: 'Алиса', sourceSnapshotId: 'historical-final-snapshot' };
const common = (v = ZERO, draftRevision = 0) => ({
  ...v,
  networkScopeId: SCOPE,
  contextId: CONTEXT,
  deviceId: DEVICE,
  controllerSeat: SEAT,
  draftRevision,
  campaignIdOrNull: null,
  connectionState: 'NO_TECHNICAL_SESSION',
  pendingCommandIdOrNull: null,
});
const discovery = (): JsonObject => ({
  ...common(),
  activeRole: 'PLAYER',
  discoveryState: 'COMPLETE',
  discoveredHosts: [],
  discoveryTruncated: false,
  lastAddressOrNull: null,
  returnContext: 'PLAYER_MENU',
  connectionAttemptIdOrNull: null,
});
const bound = (v = ZERO, draftRevision = 0) => ({
  ...common(v, draftRevision),
  campaignIdOrNull: CAMPAIGN,
  connectionState: 'CONNECTED_TECHNICAL',
});
const selection = (v = ZERO, draftRevision = 0, selected = true): JsonObject => ({
  ...bound(v, draftRevision),
  campaignId: CAMPAIGN,
  campaignStatus: 'PAUSED',
  sessionId: SESSION,
  connectionRevision: 0,
  eligibleFinalCandidates: [SUMMARY],
  selectedCandidates: selected ? [REF] : [],
  ownRequestIdOrNull: null,
  capacityForecast: {
    campaignRevision: 0,
    activePlayerCapacity: 5,
    activePcCount: 1,
    occupiedCampaignPlaceCount: 1,
    selectedCandidateCount: selected ? 1 : 0,
    fitsCurrentCapacity: true,
  },
});
const address = (v = ZERO, draftRevision = 0, valid = true): JsonObject => ({
  ...common(v, draftRevision),
  addressOrQrPayload: valid ? ADDRESS : '',
  parsedHost: valid ? '192.168.1.20' : null,
  parsedPort: valid ? 3000 : null,
  protocolVersion: 3,
  campaignHintOrNull: valid ? CAMPAIGN : null,
  parseStatus: valid ? 'VALID' : 'EMPTY',
  parseDiagnostic: null,
  attemptId: ATTEMPT,
  commandId: null,
});
const batch = (v = ZERO): JsonObject => ({
  ...bound(v),
  sessionId: SESSION,
  requestId: REQUEST,
  selectedLocalCharacterUuids: [REF.sourceUuid],
  snapshotChecksums: [
    {
      localCharacterUuid: REF.sourceUuid,
      candidateSnapshotChecksum: REF.candidateSnapshotChecksum,
    },
  ],
  campaignId: CAMPAIGN,
  connectionRevision: 0,
  commandId: null,
  batchCharacterSummaries: [SUMMARY],
  capacityForecast: {
    campaignRevision: 0,
    activePlayerCapacity: 5,
    activePcCount: 1,
    occupiedCampaignPlaceCount: 1,
    selectedCandidateCount: 1,
    fitsCurrentCapacity: true,
  },
});
const waiting = (v: RevisionVector, draftRevision = 0, cancelReason = ''): JsonObject => ({
  ...bound(v, draftRevision),
  sessionId: SESSION,
  requestId: REQUEST,
  requestOwnerDeviceId: DEVICE,
  batchCharacterSummaries: [SUMMARY],
  requestStatus: 'PENDING',
  gmMessage: null,
  requestRevision: 0,
  cancelReason,
  commandId: null,
});
const unavailable = (
  v: RevisionVector,
  pendingCommandIdOrNull: string | null = null,
): JsonObject => ({
  ...common(v),
  campaignIdOrNull: pendingCommandIdOrNull === null ? null : CAMPAIGN,
  connectionState: 'UNAVAILABLE',
  pendingCommandIdOrNull,
  attemptId: ATTEMPT,
  activeRole: 'PLAYER',
  activeSeatOrGm: SEAT,
  lastAddressOrQrPayload: ADDRESS,
  retryAttemptIdOrNull:
    pendingCommandIdOrNull === null ? '44444444-4444-4444-8444-444444444444' : null,
  lastParsedHostPort: { hostAddress: '192.168.1.20', hostPort: 3000, campaignHintOrNull: CAMPAIGN },
  errorCode: pendingCommandIdOrNull === null ? 'PEER_UNAVAILABLE' : 'UNCONFIRMED_OUTCOME',
  humanDiagnostic: 'Ответ кампании не подтверждён.',
  retryCount: 1,
  lastConfirmedStateRevision: 0,
  lastConfirmedProjectionRevision: 0,
  resumeContextOrNull: null,
  localDataUntouched: true,
  commandId: null,
});
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
  onerror: WebSocket['onerror'] = null;
  onclose: WebSocket['onclose'] = null;
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
  drop() {
    this.readyState = Socket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close', { code: 1006 }));
  }
}
const connections: ProjectionConnection[] = [];
const roots: { root: Root; container: HTMLDivElement }[] = [];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
afterEach(() => {
  roots.splice(0).forEach(({ root, container }) => {
    act(() => root.unmount());
    container.remove();
  });
  connections.splice(0).forEach((connection) => connection.disconnect());
  Socket.instances = [];
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
type AnyForm = NetworkApplicationFormId | 'APP-002' | 'APP-004';
const actions: Partial<Record<AnyForm, readonly ActionKey[]>> = {
  'NET-001': ['NET-001::CTA::001', 'NET-001::CTA::003'],
  'NET-002': ['NET-002::CTA::001', 'NET-002::CTA::003', 'NET-002::CTA::004', 'NET-002::CTA::005'],
  'NET-003': ['NET-003::CTA::001', 'NET-003::CTA::002'],
  'NET-004': ['NET-004::CTA::001', 'NET-004::CTA::002', 'NET-004::CTA::003'],
  'NET-005': [],
  'NET-011': ['NET-011::CTA::003', 'NET-011::CTA::004', 'NET-011::CTA::005'],
  'APP-002': ['APP-002::CTA::003'],
};
function snapshot(
  formId: AnyForm,
  p: JsonObject,
  v: RevisionVector,
  correlationId: string,
  reason: 'RECONNECT' | 'FORM_ACTION' | 'COMMAND_DESTINATION' = 'RECONNECT',
  keys = actions[formId] ?? [],
): ProjectionSnapshotV2Message {
  const definition = presentedFormDefinition(formId)!;
  return {
    messageType: 'projection.snapshot',
    protocolVersion: 2,
    projectionRole: 'player',
    revisions: v,
    presentation: {
      assignment: { correlationId, reason },
      layers: [],
      base: {
        formId,
        formType: 'screen',
        routeTemplate: definition.route,
        routeBindings:
          formId === 'APP-002' || formId === 'APP-004'
            ? []
            : [
                {
                  parameterIndex: 0,
                  source: 'inherited',
                  value:
                    formId === 'CHR-027'
                      ? (p['localCharacterUuid'] as string)
                      : ((p['campaignIdOrNull'] as string | null) ?? `unbound:${SCOPE}`),
                },
              ],
        roleFilteredPayload: p,
        availableActionKeys: keys,
      },
    },
  };
}
function sent(socket: Socket): Record<string, unknown> {
  return JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>;
}
function ready(
  socket: Socket,
  form: AnyForm,
  p: JsonObject,
  v = ZERO,
  keys?: readonly ActionKey[],
  capabilities: readonly WorkflowCommandId[] = CAPS,
) {
  const request = sent(socket);
  const id = request['reconnectRequestId'] as string;
  socket.message({
    messageType: 'session.reconnect.capabilities',
    protocolVersion: 2,
    reconnectRequestId: id,
    revisions: v,
    executableWorkflowCommandIds: capabilities,
  });
  socket.message(snapshot(form, p, v, id, 'RECONNECT', keys));
}
async function start(
  form: AnyForm,
  p: JsonObject,
  options: {
    ticket?: boolean;
    keys?: readonly ActionKey[];
    capabilities?: readonly WorkflowCommandId[];
    revisions?: RevisionVector;
  } = {},
) {
  if (options.ticket !== false) window.sessionStorage.setItem(NETWORK_CONTEXT_STORAGE_KEY, SCOPE);
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ deviceId: DEVICE }), { status: 200 })),
    ),
  );
  const states: WebClientState[] = [],
    drafts: (NetworkDraftClientState | null)[] = [];
  const connection = connectProjection(
    (value) => states.push(value),
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
    undefined,
    (value) => drafts.push(value),
  );
  connections.push(connection);
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
  const socket = Socket.instances[0]!;
  socket.open();
  ready(socket, form, p, options.revisions ?? ZERO, options.keys, options.capabilities);
  expect(states.at(-1)?.kind).toBe('ready');
  return { connection, socket, states, drafts };
}
function receipt(
  command: Record<string, unknown>,
  operation: 'OPEN' | 'SUBMIT' | 'CANCEL',
  v: RevisionVector,
) {
  const payload = command['payload'] as Record<string, unknown>;
  return {
    commandId: command['commandId'],
    receiptId: `local-${operation}`,
    revisions: v,
    result: {
      operation,
      networkScopeId: SCOPE,
      remoteReceiptId: `remote-${operation}`,
      technicalSessionId: SESSION,
      attemptIdOrNull: operation === 'OPEN' ? payload['attemptId'] : null,
      requestIdOrNull: operation === 'OPEN' ? null : REQUEST,
      requestRevisionOrNull: operation === 'OPEN' ? null : operation === 'SUBMIT' ? 0 : 1,
      outcome:
        operation === 'OPEN'
          ? 'CONNECTED_TECHNICAL'
          : operation === 'SUBMIT'
            ? 'PENDING'
            : 'CANCELLED',
    },
  };
}

describe('NET application client command and recovery boundaries', () => {
  it('uses only an opaque stored scope on cold resume and never re-enters or submits', async () => {
    const flow = await start('NET-004', batch());
    expect(sent(flow.socket)).toMatchObject({
      messageType: 'network.local-context.resume',
      networkScopeId: SCOPE,
      supportedWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
      unacknowledgedCommandIds: [],
    });
    expect(flow.socket.sent).toHaveLength(1);
    expect(window.sessionStorage.getItem(NETWORK_CONTEXT_STORAGE_KEY)).toBe(SCOPE);
    expect(window.sessionStorage.getItem(GM_CONTEXT_STORAGE_KEY)).toBeNull();
    expect(Object.keys(window.sessionStorage)).toEqual([NETWORK_CONTEXT_STORAGE_KEY]);
  });
  it('enters a new NET scope from APP-002, confirms the draft, and commits explicit OPEN into NET-003', async () => {
    const shell = { contextId: CONTEXT, deviceId: DEVICE, stateRevision: 0, projectionRevision: 0 };
    const flow = await start('APP-002', shell, { ticket: false });
    expect(flow.connection.requestFormAction('APP-002::CTA::003')).toEqual({ ok: true });
    const entry = sent(flow.socket);
    const found: JsonObject = {
      ...common(),
      activeRole: 'PLAYER',
      discoveryState: 'COMPLETE',
      discoveredHosts: [],
      discoveryTruncated: false,
      lastAddressOrNull: null,
      returnContext: 'PLAYER_MENU',
      connectionAttemptIdOrNull: null,
    };
    flow.socket.message(
      snapshot('NET-001', found, ZERO, entry['navigationRequestId'] as string, 'FORM_ACTION'),
    );
    expect(Socket.instances).toHaveLength(1);
    expect(flow.connection.requestFormAction('NET-001::CTA::001')).toEqual({ ok: true });
    const navigate = sent(flow.socket),
      next = { ...ZERO, projectionRevision: 1 };
    flow.socket.message(
      snapshot(
        'NET-002',
        address(next, 0, false),
        next,
        navigate['navigationRequestId'] as string,
        'FORM_ACTION',
        ['NET-002::CTA::001', 'NET-002::CTA::004', 'NET-002::CTA::005'],
      ),
    );
    vi.useFakeTimers();
    expect(
      flow.connection.replaceNetworkDraft({
        variant: 'ADDRESS',
        values: { addressOrQrPayload: ADDRESS },
      }),
    ).toEqual({ ok: true });
    vi.advanceTimersByTime(250);
    const edit = sent(flow.socket),
      scope = edit['scope'];
    expect(edit).toMatchObject({
      messageType: 'network.draft.replace',
      variant: 'ADDRESS',
      expectedDraftRevision: 0,
      scope: { networkScopeId: SCOPE, contextId: CONTEXT, sourceFormId: 'NET-002' },
    });
    const applied = { stateRevision: 1, projectionRevision: 2, actorVisibilityRevision: 0 };
    const draftView = snapshot(
      'NET-002',
      address(applied, 1),
      applied,
      edit['draftUpdateId'] as string,
    );
    flow.socket.message({
      messageType: 'network.draft.result',
      protocolVersion: 3,
      draftUpdateId: edit['draftUpdateId'],
      scope,
      changed: true,
      appliedDraftRevision: 1,
      appliedRevisions: applied,
      draftRevision: 1,
      revisions: applied,
      projectionRole: 'player',
      presentation: { base: draftView.presentation.base, layers: [] },
    });
    expect(flow.connection.requestFormAction('NET-002::CTA::003')).toEqual({ ok: true });
    const command = sent(flow.socket);
    expect(command['commandId']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(command).toMatchObject({
      messageType: 'command.request',
      workflowCommandId: 'UI-CMD-CONNECTION-OPEN',
      role: 'player',
      expectedRevisions: applied,
      payload: {
        networkScopeId: SCOPE,
        contextId: CONTEXT,
        attemptId: ATTEMPT,
        addressOrQrPayload: ADDRESS,
      },
    });
    const committed = { stateRevision: 3, projectionRevision: 4, actorVisibilityRevision: 0 };
    flow.socket.message({
      messageType: 'command.result',
      protocolVersion: 1,
      lifecycleState: 'COMMITTED',
      receipt: receipt(command, 'OPEN', committed),
    });
    flow.socket.message(
      snapshot(
        'NET-003',
        selection(committed, 1, false),
        committed,
        command['commandId'] as string,
        'COMMAND_DESTINATION',
        [],
      ),
    );
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { formId: 'NET-003', projection: { sessionId: SESSION } },
    });
    expect(
      flow.socket.sent
        .map((text) => JSON.parse(text) as Record<string, unknown>)
        .filter(
          (message) =>
            message['messageType'] === 'command.request' &&
            message['workflowCommandId'] === 'UI-CMD-DEVICE-REQUEST-SUBMIT',
        ),
    ).toHaveLength(0);
  });
  it('reconciles lost SUBMIT acknowledgement by the same ID and confirms CANCEL_REASON before CANCEL', async () => {
    const flow = await start('NET-004', batch());
    expect(flow.connection.requestFormAction('NET-004::CTA::002')).toEqual({ ok: true });
    const submit = sent(flow.socket);
    flow.socket.drop();
    expect(flow.connection.reconnect()).toEqual({ ok: true });
    const second = Socket.instances[1]!;
    second.open();
    expect(sent(second)).toMatchObject({
      messageType: 'network.local-context.resume',
      networkScopeId: SCOPE,
      unacknowledgedCommandIds: [submit['commandId']],
    });
    expect(second.sent).toHaveLength(1);
    const submitted = { stateRevision: 2, projectionRevision: 3, actorVisibilityRevision: 0 };
    second.message({
      messageType: 'command.replay',
      protocolVersion: 1,
      lifecycleState: 'IDEMPOTENT_REPLAY',
      receipt: receipt(submit, 'SUBMIT', submitted),
    });
    ready(second, 'NET-005', { ...waiting(submitted), contextId: NEXT_CONTEXT }, submitted, []);
    vi.useFakeTimers();
    expect(
      flow.connection.replaceNetworkDraft({
        variant: 'CANCEL_REASON',
        values: { cancelReason: 'Передумал' },
      }),
    ).toEqual({ ok: true });
    expect(flow.connection.requestFormAction('NET-005::CTA::001').ok).toBe(false);
    vi.advanceTimersByTime(250);
    const edit = sent(second),
      edited = { stateRevision: 3, projectionRevision: 4, actorVisibilityRevision: 0 };
    const p = { ...waiting(edited, 1, 'Передумал'), contextId: NEXT_CONTEXT };
    const view = snapshot('NET-005', p, edited, edit['draftUpdateId'] as string, 'FORM_ACTION', [
      'NET-005::CTA::001',
    ]);
    second.message({
      messageType: 'network.draft.result',
      protocolVersion: 3,
      draftUpdateId: edit['draftUpdateId'],
      scope: edit['scope'],
      changed: true,
      appliedDraftRevision: 1,
      appliedRevisions: edited,
      draftRevision: 1,
      revisions: edited,
      projectionRole: 'player',
      presentation: { base: view.presentation.base, layers: [] },
    });
    expect(flow.connection.requestFormAction('NET-005::CTA::001')).toEqual({ ok: true });
    const cancel = sent(second);
    expect(cancel).toMatchObject({
      workflowCommandId: 'UI-CMD-DEVICE-REQUEST-CANCEL',
      payload: {
        reason: 'Передумал',
        technicalSessionId: SESSION,
        requestId: REQUEST,
        requestRevision: 0,
      },
    });
    const cancelled = { stateRevision: 5, projectionRevision: 6, actorVisibilityRevision: 0 };
    second.message({
      messageType: 'command.result',
      protocolVersion: 1,
      lifecycleState: 'COMMITTED',
      receipt: receipt(cancel, 'CANCEL', cancelled),
    });
    second.message(
      snapshot(
        'NET-003',
        { ...selection(cancelled, 1), contextId: NEXT_CONTEXT },
        cancelled,
        cancel['commandId'] as string,
        'COMMAND_DESTINATION',
      ),
    );
    expect(flow.states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'NET-003' } });
    expect(
      second.sent
        .map((text) => JSON.parse(text) as Record<string, unknown>)
        .filter((message) => message['workflowCommandId'] === 'UI-CMD-DEVICE-REQUEST-SUBMIT'),
    ).toEqual([]);
  });
  it('keeps an unknown remote outcome unresolved and never turns it into a retry or fresh submit', async () => {
    const flow = await start('NET-004', batch());
    expect(flow.connection.requestFormAction('NET-004::CTA::002').ok).toBe(true);
    const command = sent(flow.socket),
      v = { stateRevision: 1, projectionRevision: 2, actorVisibilityRevision: 0 };
    flow.socket.message(
      snapshot(
        'NET-011',
        unavailable(v, command['commandId'] as string),
        v,
        command['commandId'] as string,
        'COMMAND_DESTINATION',
        [],
      ),
    );
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { formId: 'NET-011', availableActionKeys: [] },
    });
    expect(flow.connection.requestFormAction('NET-011::CTA::003').ok).toBe(false);
    expect(flow.connection.requestFormAction('NET-011::CTA::005').ok).toBe(false);
    flow.socket.drop();
    flow.connection.reconnect();
    const second = Socket.instances[1]!;
    second.open();
    expect(sent(second)['unacknowledgedCommandIds']).toEqual([command['commandId']]);
    expect(second.sent).toHaveLength(1);
  });
  it('keeps unresolved CANCEL on its exact NET-005 request and reconciles the original receipt with a later current view', async () => {
    const source = { stateRevision: 4, projectionRevision: 6, actorVisibilityRevision: 0 };
    const flow = await start('NET-005', waiting(source, 2, 'Передумал'), {
      revisions: source,
      keys: ['NET-005::CTA::001'],
    });
    expect(flow.connection.requestFormAction('NET-005::CTA::001')).toEqual({ ok: true });
    const command = sent(flow.socket),
      intent = { ...source, stateRevision: 5, projectionRevision: 8 };
    const pending: JsonObject = {
      ...waiting(intent, 2, 'Передумал'),
      connectionState: 'CONNECTING',
      commandId: command['commandId'] as string,
      pendingCommandIdOrNull: command['commandId'] as string,
    };
    flow.socket.message(
      snapshot(
        'NET-005',
        pending,
        intent,
        command['commandId'] as string,
        'COMMAND_DESTINATION',
        [],
      ),
    );
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'NET-005',
        availableActionKeys: [],
        projection: { pendingCommandIdOrNull: command['commandId'] },
      },
    });
    expect(flow.connection.requestFormAction('NET-005::CTA::001').ok).toBe(false);
    expect(
      flow.connection.replaceNetworkDraft({
        variant: 'CANCEL_REASON',
        values: { cancelReason: 'Повтор' },
      }).ok,
    ).toBe(false);
    flow.socket.drop();
    flow.connection.reconnect();
    const second = Socket.instances[1]!;
    second.open();
    expect(sent(second)['unacknowledgedCommandIds']).toEqual([command['commandId']]);
    ready(second, 'NET-005', { ...pending, contextId: NEXT_CONTEXT }, intent, []);
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { formId: 'NET-005', availableActionKeys: [] },
    });
    expect(second.sent).toHaveLength(1);
    second.drop();
    flow.connection.reconnect();
    const third = Socket.instances[2]!;
    third.open();
    expect(sent(third)['unacknowledgedCommandIds']).toEqual([command['commandId']]);
    const ack = { ...source, stateRevision: 6, projectionRevision: 9 },
      later = { ...source, stateRevision: 8, projectionRevision: 12 };
    third.message({
      messageType: 'command.replay',
      protocolVersion: 1,
      lifecycleState: 'IDEMPOTENT_REPLAY',
      receipt: receipt(command, 'CANCEL', ack),
    });
    ready(third, 'NET-003', { ...selection(later, 3), contextId: NEXT_CONTEXT }, later);
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { formId: 'NET-003', revisions: later },
    });
    expect(third.sent).toHaveLength(1);
    expect(
      Socket.instances
        .flatMap((socket) => socket.sent)
        .map((text) => JSON.parse(text) as Record<string, unknown>)
        .filter((frame) => frame['messageType'] === 'command.request'),
    ).toEqual([command]);
    third.drop();
    flow.connection.reconnect();
    const fourth = Socket.instances[3]!;
    fourth.open();
    expect(sent(fourth)['unacknowledgedCommandIds']).toEqual([]);
  });
  it.each([
    'session',
    'request',
    'request revision',
    'batch checksum',
    'batch metadata',
    'context',
    'lane',
    'scope',
    'device',
    'state unchanged',
    'state ACK',
    'visibility',
    'pending ID',
    'command ID',
    'correlation',
    'connection state',
    'reason',
    'actions',
  ] as const)('refuses an unresolved CANCEL view with mismatched %s', async (invalid) => {
    const source = { stateRevision: 4, projectionRevision: 6, actorVisibilityRevision: 0 };
    const flow = await start('NET-005', waiting(source, 2, 'Передумал'), {
      revisions: source,
      keys: ['NET-005::CTA::001'],
    });
    flow.connection.requestFormAction('NET-005::CTA::001');
    const command = sent(flow.socket);
    let v = { ...source, stateRevision: 5, projectionRevision: 8 };
    if (invalid === 'state unchanged') v = { ...v, stateRevision: 4 };
    if (invalid === 'state ACK') v = { ...v, stateRevision: 6 };
    if (invalid === 'visibility') v = { ...v, actorVisibilityRevision: 1 };
    const p: Record<string, JsonValue> = {
      ...waiting(v, 2, 'Передумал'),
      connectionState: 'CONNECTING',
      commandId: command['commandId'] as string,
      pendingCommandIdOrNull: command['commandId'] as string,
    };
    const fields = {
      session: 'sessionId',
      request: 'requestId',
      context: 'contextId',
      lane: 'controllerSeat',
      scope: 'networkScopeId',
      device: 'deviceId',
      'pending ID': 'pendingCommandIdOrNull',
      'command ID': 'commandId',
    } as const;
    if (invalid in fields) p[fields[invalid as keyof typeof fields]] = NEXT_CONTEXT;
    if (invalid === 'request revision') p['requestRevision'] = 1;
    if (invalid === 'batch checksum')
      p['batchCharacterSummaries'] = [{ ...SUMMARY, candidateSnapshotChecksum: '0'.repeat(64) }];
    if (invalid === 'batch metadata')
      p['batchCharacterSummaries'] = [{ ...SUMMARY, metadataRevision: 3 }];
    if (invalid === 'lane')
      p['batchCharacterSummaries'] = [{ ...SUMMARY, requestedControllerSeat: NEXT_CONTEXT }];
    if (invalid === 'device') p['requestOwnerDeviceId'] = NEXT_CONTEXT;
    if (invalid === 'connection state') p['connectionState'] = 'CONNECTED_TECHNICAL';
    if (invalid === 'reason') p['cancelReason'] = 'Другая причина';
    flow.socket.message(
      snapshot(
        'NET-005',
        p,
        v,
        invalid === 'correlation' ? NEXT_CONTEXT : (command['commandId'] as string),
        'COMMAND_DESTINATION',
        invalid === 'actions' ? ['NET-005::CTA::001'] : [],
      ),
    );
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      refusal: { value: invalid === 'actions' ? ['NET-005::CTA::001'] : null },
    });
  });
  it('requires the exact zero initial vector for player-menu entry into NET-001', async () => {
    const flow = await start(
      'APP-002',
      { contextId: CONTEXT, deviceId: DEVICE, stateRevision: 0, projectionRevision: 0 },
      { ticket: false },
    );
    flow.connection.requestFormAction('APP-002::CTA::003');
    const v = { ...ZERO, projectionRevision: 1 };
    flow.socket.message(
      snapshot(
        'NET-001',
        { ...discovery(), ...v },
        v,
        sent(flow.socket)['navigationRequestId'] as string,
        'FORM_ACTION',
      ),
    );
    expect(flow.states.at(-1)).toMatchObject({ kind: 'protocol-error', refusal: { value: null } });
  });
  it.each(['current owner', 'foreign context', 'foreign lane'] as const)(
    'matches replayed draft current view against the latest confirmed %s after resume',
    async (owner) => {
      const flow = await start('NET-002', address(ZERO, 0, false), {
        keys: ['NET-002::CTA::001', 'NET-002::CTA::004', 'NET-002::CTA::005'],
      });
      vi.useFakeTimers();
      flow.connection.replaceNetworkDraft({
        variant: 'ADDRESS',
        values: { addressOrQrPayload: ADDRESS },
      });
      vi.advanceTimersByTime(250);
      const edit = sent(flow.socket);
      flow.socket.drop();
      flow.connection.reconnect();
      const second = Socket.instances[1]!;
      second.open();
      const applied = { stateRevision: 1, projectionRevision: 1, actorVisibilityRevision: 0 },
        current = { ...applied, projectionRevision: 2 };
      ready(second, 'NET-002', { ...address(current, 1), contextId: NEXT_CONTEXT }, current);
      expect(second.sent).toHaveLength(2);
      expect(sent(second)).toEqual(edit);
      const p = {
        ...address(current, 1),
        contextId: owner === 'foreign context' ? CONTEXT : NEXT_CONTEXT,
        controllerSeat: owner === 'foreign lane' ? DEVICE : SEAT,
      };
      const view = snapshot('NET-002', p, current, edit['draftUpdateId'] as string);
      second.message({
        messageType: 'network.draft.result',
        protocolVersion: 3,
        draftUpdateId: edit['draftUpdateId'],
        scope: edit['scope'],
        changed: true,
        appliedDraftRevision: 1,
        appliedRevisions: applied,
        draftRevision: 1,
        revisions: current,
        projectionRole: 'player',
        presentation: { base: view.presentation.base, layers: [] },
      });
      if (owner === 'current owner') {
        expect(flow.states.at(-1)).toMatchObject({
          kind: 'ready',
          snapshot: { projection: { contextId: NEXT_CONTEXT, controllerSeat: SEAT } },
        });
        expect(flow.drafts.at(-1)).toMatchObject({ pending: false, dirty: false });
      } else
        expect(flow.states.at(-1)).toMatchObject({
          kind: 'protocol-error',
          refusal: { value: null },
        });
      expect(
        second.sent.filter(
          (text) =>
            (JSON.parse(text) as Record<string, unknown>)['messageType'] ===
            'network.draft.replace',
        ),
      ).toHaveLength(1);
    },
  );
  it('retains a refused OPEN correlation until the owned NET-011 current view arrives', async () => {
    const flow = await start('NET-002', address());
    flow.connection.requestFormAction('NET-002::CTA::003');
    const command = sent(flow.socket);
    const v = { stateRevision: 2, projectionRevision: 2, actorVisibilityRevision: 0 };
    flow.socket.message({
      messageType: 'command.refusal',
      protocolVersion: 1,
      commandId: command['commandId'],
      lastLifecycleState: null,
      refusal: { code: 'GUARD_REJECTED' },
      revisions: v,
    });
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'command-refusal',
      snapshot: { availableActionKeys: [] },
    });
    flow.socket.message(
      snapshot('NET-011', unavailable(v), v, command['commandId'] as string, 'COMMAND_DESTINATION'),
    );
    expect(flow.states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'NET-011' } });
  });
  it('allows editing a known lost session without advertising or sending a fresh OPEN', async () => {
    const known = { ...unavailable(ZERO), campaignIdOrNull: CAMPAIGN, retryAttemptIdOrNull: null };
    const flow = await start('NET-011', known, {
      keys: ['NET-011::CTA::004', 'NET-011::CTA::005'],
    });
    expect(flow.connection.requestFormAction('NET-011::CTA::003').ok).toBe(false);
    expect(flow.socket.sent).toHaveLength(1);
    expect(flow.connection.requestFormAction('NET-011::CTA::004')).toEqual({ ok: true });
    const v = { ...ZERO, projectionRevision: 1 };
    flow.socket.message(
      snapshot(
        'NET-002',
        { ...address(v), campaignIdOrNull: CAMPAIGN, connectionState: 'LOST' },
        v,
        sent(flow.socket)['navigationRequestId'] as string,
        'FORM_ACTION',
        ['NET-002::CTA::001'],
      ),
    );
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { formId: 'NET-002', availableActionKeys: ['NET-002::CTA::001'] },
    });
    expect(
      flow.socket.sent
        .map((text) => JSON.parse(text) as Record<string, unknown>)
        .filter((frame) => frame['messageType'] === 'command.request'),
    ).toEqual([]);
  });
  it('continues a confirmed existing NET-002 session through its source CTA without another OPEN', async () => {
    const flow = await start(
      'NET-002',
      { ...address(), campaignIdOrNull: CAMPAIGN, connectionState: 'CONNECTED_TECHNICAL' },
      {
        keys: ['NET-002::CTA::001', 'NET-002::CTA::002'],
      },
    );
    expect(flow.connection.requestFormAction('NET-002::CTA::002')).toEqual({ ok: true });
    const v = { ...ZERO, projectionRevision: 1 };
    flow.socket.message(
      snapshot(
        'NET-003',
        selection(v, 0, false),
        v,
        sent(flow.socket)['navigationRequestId'] as string,
        'FORM_ACTION',
        [],
      ),
    );
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { formId: 'NET-003', projection: { sessionId: SESSION } },
    });
    expect(flow.socket.sent).toHaveLength(2);
    expect(sent(flow.socket)['messageType']).toBe('navigation.form-action');
  });
  it('refuses a foreign scope or private projection field without displaying its value', async () => {
    const flow = await start('NET-004', batch());
    flow.socket.drop();
    flow.connection.reconnect();
    const second = Socket.instances[1]!;
    second.open();
    ready(second, 'NET-004', { ...batch(), networkScopeId: NEXT_CONTEXT });
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      refusal: { code: 'UNRECOGNIZED', value: null },
    });
  });
  it('requires an explicit role choice for conflicting opaque browser tickets', async () => {
    window.sessionStorage.setItem(NETWORK_CONTEXT_STORAGE_KEY, SCOPE);
    window.sessionStorage.setItem(GM_CONTEXT_STORAGE_KEY, CONTEXT);
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ deviceId: DEVICE }), { status: 200 })),
      ),
    );
    const states: WebClientState[] = [];
    const connection = connectProjection((state) => states.push(state));
    connections.push(connection);
    await vi.waitFor(() =>
      expect(states.at(-1)).toEqual({ kind: 'client-error', detail: LOCAL_ROLE_CHOICE_DETAIL }),
    );
    expect(Socket.instances).toHaveLength(0);
    expect(connection.chooseLocalRole('system' as never)).toEqual({
      ok: false,
      detail: 'local role choice is unavailable',
    });
    expect(connection.chooseLocalRole('player')).toEqual({ ok: true });
    expect(Socket.instances).toHaveLength(1);
    Socket.instances[0]!.open();
    expect(sent(Socket.instances[0]!)).toMatchObject({
      messageType: 'network.local-context.resume',
      networkScopeId: SCOPE,
    });
    expect(window.sessionStorage.getItem(GM_CONTEXT_STORAGE_KEY)).toBeNull();
  });
  it('refuses network commands when CSPRNG fails instead of minting fallback IDs or sending', async () => {
    const flow = await start('NET-004', batch());
    const rng = vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('entropy unavailable');
    });
    expect(flow.connection.requestFormAction('NET-004::CTA::002')).toEqual({
      ok: false,
      detail: 'network command ID is unavailable',
    });
    expect(flow.socket.sent).toHaveLength(1);
    rng.mockRestore();
  });
  it('returns explicitly to APP-002 on the same transport and clears only its opaque NET cursor', async () => {
    const found: JsonObject = {
      ...common(),
      activeRole: 'PLAYER',
      discoveryState: 'COMPLETE',
      discoveredHosts: [],
      discoveryTruncated: false,
      lastAddressOrNull: null,
      returnContext: 'PLAYER_MENU',
      connectionAttemptIdOrNull: null,
    };
    const flow = await start('NET-001', found);
    expect(flow.connection.requestFormAction('NET-001::CTA::003')).toEqual({ ok: true });
    const request = sent(flow.socket),
      v = { stateRevision: 7, projectionRevision: 12, actorVisibilityRevision: 0 };
    flow.socket.message(
      snapshot(
        'APP-002',
        { contextId: NEXT_CONTEXT, deviceId: DEVICE, stateRevision: 7, projectionRevision: 12 },
        v,
        request['navigationRequestId'] as string,
        'FORM_ACTION',
      ),
    );
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { formId: 'APP-002', revisions: v },
    });
    expect(Socket.instances).toHaveLength(1);
    expect(window.sessionStorage.getItem(NETWORK_CONTEXT_STORAGE_KEY)).toBeNull();
    flow.socket.drop();
    flow.connection.reconnect();
    const second = Socket.instances[1]!;
    second.open();
    expect(sent(second)).toMatchObject({
      messageType: 'session.reconnect',
      unacknowledgedCommandIds: [],
    });
  });
  it.each(['cold', 'lost navigation'] as const)(
    'recovers an audited closed NET exit through %s resume without reopening or minting an entry',
    async (mode) => {
      const v = { stateRevision: 7, projectionRevision: 12, actorVisibilityRevision: 0 },
        shell = {
          contextId: NEXT_CONTEXT,
          deviceId: DEVICE,
          stateRevision: 7,
          projectionRevision: 12,
        };
      const flow = await start(
        mode === 'cold' ? 'APP-002' : 'NET-001',
        mode === 'cold' ? shell : discovery(),
        {
          capabilities: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
          revisions: mode === 'cold' ? v : ZERO,
        },
      );
      let active = flow.socket;
      if (mode === 'lost navigation') {
        expect(flow.connection.requestFormAction('NET-001::CTA::003')).toEqual({ ok: true });
        active.drop();
        flow.connection.reconnect();
        active = Socket.instances[1]!;
        active.open();
        ready(active, 'APP-002', shell, v, undefined, NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS);
      }
      expect(sent(active)).toMatchObject({
        messageType: 'network.local-context.resume',
        networkScopeId: SCOPE,
        supportedWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
        unacknowledgedCommandIds: [],
      });
      expect(active.sent).toHaveLength(1);
      expect(flow.states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: { formId: 'APP-002', projection: { contextId: NEXT_CONTEXT } },
      });
      expect(window.sessionStorage.getItem(NETWORK_CONTEXT_STORAGE_KEY)).toBeNull();
      const transportCount = Socket.instances.length;
      expect(flow.connection.requestFormAction('APP-002::CTA::003')).toEqual({ ok: true });
      expect(Socket.instances).toHaveLength(transportCount);
      expect(sent(active)).toMatchObject({
        messageType: 'navigation.form-action',
        expectedProjectionRevision: v.projectionRevision,
        sourceFormId: 'APP-002',
        actionKey: 'APP-002::CTA::003',
      });
      active.drop();
      flow.connection.reconnect();
      const ordinary = Socket.instances.at(-1)!;
      ordinary.open();
      expect(sent(ordinary)).toMatchObject({
        messageType: 'session.reconnect',
        unacknowledgedCommandIds: [],
      });
    },
  );
  it.each(['foreign device', 'other shell'] as const)(
    'refuses closed NET recovery to %s and retains the last confirmed opaque cursor',
    async (invalid) => {
      const flow = await start('NET-001', discovery());
      flow.socket.drop();
      flow.connection.reconnect();
      const active = Socket.instances[1]!;
      active.open();
      const p: JsonObject =
        invalid === 'foreign device'
          ? { contextId: NEXT_CONTEXT, deviceId: SEAT, stateRevision: 0, projectionRevision: 0 }
          : {
              campaignAuthority: false,
              libraryEntries: [],
              draftCharacterIds: [],
              finalCharacterIds: [],
              handoffIdOrNull: null,
              handoffReceiptIdOrNull: null,
              launchContext: 'PLAYER_MENU',
              localCharacterLibraryRevision: 0,
              localOwnerIdOrNull: null,
              projectionRevision: 0,
              returnContext: 'PLAYER_MENU',
              stateRevision: 0,
            };
      ready(
        active,
        invalid === 'foreign device' ? 'APP-002' : 'APP-004',
        p,
        ZERO,
        undefined,
        NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
      );
      expect(flow.states.at(-1)).toMatchObject({
        kind: 'protocol-error',
        refusal: { value: null },
      });
      expect(window.sessionStorage.getItem(NETWORK_CONTEXT_STORAGE_KEY)).toBe(SCOPE);
      expect(active.sent).toHaveLength(2);
      expect(sent(active)).toMatchObject({
        messageType: 'protocol.refusal',
        relatedCommandId: null,
        refusal: { value: null },
      });
    },
  );
  it('binds CHR-027 to its exact source character rather than a scope or campaign locator', async () => {
    const p: JsonObject = {
      ...common(),
      localCharacterUuid: REF.sourceUuid,
      finalSnapshotVersion: 7,
      candidateSnapshotChecksum: REF.candidateSnapshotChecksum,
      eligibleCampaignIds: [],
      selectedCampaignId: null,
      requestedControllerSeat: null,
      sourceUuidAndProvenance: {
        registryVersion: 'registry',
        catalogVersion: 'catalog',
        builtAgainstTuple: 'tuple',
        sourceUuid: REF.sourceUuid,
        sourceSnapshotId: SUMMARY.sourceSnapshotId,
        metadataRevision: 2,
        sourceChecksum: REF.candidateSnapshotChecksum,
        finalSaveReceiptId: 'original-final-receipt',
        finalSnapshotVersion: 7,
      },
      submissionStatus: 'DRAFT',
      commandId: null,
    };
    const flow = await start('CHR-027', p, { keys: ['CHR-027::CTA::002'] });
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { path: `/player/characters/${REF.sourceUuid}/create/chr-027` },
    });
    flow.socket.drop();
    flow.connection.reconnect();
    const second = Socket.instances[1]!;
    second.open();
    const id = sent(second)['reconnectRequestId'] as string;
    second.message({
      messageType: 'session.reconnect.capabilities',
      protocolVersion: 2,
      reconnectRequestId: id,
      revisions: ZERO,
      executableWorkflowCommandIds: CAPS,
    });
    const bad = snapshot('CHR-027', p, ZERO, id, 'RECONNECT', ['CHR-027::CTA::002']);
    second.message({
      ...bad,
      presentation: {
        ...bad.presentation,
        base: {
          ...bad.presentation.base,
          routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CAMPAIGN }],
        },
      },
    });
    expect(flow.states.at(-1)).toMatchObject({ kind: 'protocol-error', refusal: { value: null } });
  });
  it('routes the real NET-002 QR action locally in App and suppresses raw projection details', async () => {
    window.sessionStorage.setItem(NETWORK_CONTEXT_STORAGE_KEY, SCOPE);
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ deviceId: DEVICE }), { status: 200 })),
      ),
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });
    await act(async () => {
      root.render(createElement(App));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    const socket = Socket.instances[0]!;
    act(() => {
      socket.open();
      ready(socket, 'NET-002', address(ZERO, 0, false), ZERO, [
        'NET-002::CTA::001',
        'NET-002::CTA::004',
        'NET-002::CTA::005',
      ]);
    });
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click');
    const button = [...container.querySelectorAll('button')].find(
      (element) => element.textContent === 'Сканировать или выбрать QR',
    );
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(pick).toHaveBeenCalledOnce();
    expect(socket.sent).toHaveLength(1);
    expect(container.textContent).not.toContain(SCOPE);
    expect(container.textContent).not.toMatch(
      /networkScopeId|canonicalWitnessText|privateKey|gmQueue/u,
    );
    pick.mockRestore();
  });
  it('coalesces newer address input behind one in-flight update without retaining an orphan timer', async () => {
    const flow = await start('NET-002', address(ZERO, 0, false), {
      keys: ['NET-002::CTA::001', 'NET-002::CTA::004', 'NET-002::CTA::005'],
    });
    vi.useFakeTimers();
    flow.connection.replaceNetworkDraft({
      variant: 'ADDRESS',
      values: { addressOrQrPayload: ADDRESS },
    });
    vi.advanceTimersByTime(250);
    const first = sent(flow.socket),
      changedAddress = ADDRESS.replace(':3000/', ':3001/');
    flow.connection.replaceNetworkDraft({
      variant: 'ADDRESS',
      values: { addressOrQrPayload: changedAddress },
    });
    expect(vi.getTimerCount()).toBe(1);
    const v1 = { stateRevision: 1, projectionRevision: 1, actorVisibilityRevision: 0 };
    const view1 = snapshot('NET-002', address(v1, 1), v1, first['draftUpdateId'] as string);
    flow.socket.message({
      messageType: 'network.draft.result',
      protocolVersion: 3,
      draftUpdateId: first['draftUpdateId'],
      scope: first['scope'],
      changed: true,
      appliedDraftRevision: 1,
      appliedRevisions: v1,
      draftRevision: 1,
      revisions: v1,
      projectionRole: 'player',
      presentation: { base: view1.presentation.base, layers: [] },
    });
    const second = sent(flow.socket);
    expect(second).toMatchObject({
      messageType: 'network.draft.replace',
      expectedDraftRevision: 1,
      expectedRevisions: v1,
      values: { addressOrQrPayload: changedAddress },
    });
    expect(second['draftUpdateId']).not.toBe(first['draftUpdateId']);
    expect(vi.getTimerCount()).toBe(0);
    const v2 = { stateRevision: 2, projectionRevision: 2, actorVisibilityRevision: 0 };
    const p = { ...address(v2, 2), addressOrQrPayload: changedAddress, parsedPort: 3001 };
    const view2 = snapshot('NET-002', p, v2, second['draftUpdateId'] as string);
    flow.socket.message({
      messageType: 'network.draft.result',
      protocolVersion: 3,
      draftUpdateId: second['draftUpdateId'],
      scope: second['scope'],
      changed: true,
      appliedDraftRevision: 2,
      appliedRevisions: v2,
      draftRevision: 2,
      revisions: v2,
      projectionRole: 'player',
      presentation: { base: view2.presentation.base, layers: [] },
    });
    expect(flow.drafts.at(-1)).toMatchObject({ values: null, dirty: false, pending: false });
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { projection: { addressOrQrPayload: changedAddress } },
    });
  });
});

const GM_CAPS = [
  'UI-CMD-CAMPAIGN-CREATE',
  'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
  'UI-CMD-DEVICE-REQUEST-REJECT',
  'UI-CMD-ADMISSION-REVIEW-OPEN',
  'UI-CMD-ADMISSION-GM-ACCEPT',
  'UI-CMD-ADMISSION-GM-REJECT',
  'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
] as const;
const GM_ROW = {
  requestId: REQUEST,
  requestOwnerDeviceId: NEXT_CONTEXT,
  requestStatus: 'PENDING',
  requestRevision: 0,
  connectionState: 'CONNECTED_TECHNICAL',
  batchCharacterSummaries: [
    {
      sourceUuid: 'gm-source-character',
      snapshotChecksum: '5'.repeat(64),
      name: 'Игрок',
      sourceSnapshotId: 'gm-final-source',
      localControllerSeatId: SEAT,
    },
  ],
  requestedCandidateCount: 1,
  gmMessageOrNull: null,
  decisionReceiptIdOrNull: null,
} as const;
const gmQueue = (v: RevisionVector = ZERO, overrides: JsonObject = {}): JsonObject => ({
  contextId: CONTEXT,
  campaignId: CAMPAIGN,
  stateRevision: v.stateRevision,
  projectionRevision: v.projectionRevision,
  requestQueueRevision: 1,
  requests: [GM_ROW],
  selectedRequestIdOrNull: REQUEST,
  decisionReason: '',
  activePlayerCapacity: 3,
  selectedAdmissionOrNull: null,
  occupiedActivePcCount: 0,
  commandId: null,
  returnContext: {
    originFormId: 'CMP-006',
    campaignId: CAMPAIGN,
    creationReceiptId: 'original-create-receipt',
  },
  ...overrides,
});
const gmBirth = (): JsonObject => ({
  gmLocalContextId: CONTEXT,
  hostDeviceId: DEVICE,
  masterAuthorityRevision: 0,
  routeIdentityKind: 'CAMPAIGN',
  campaignId: CAMPAIGN,
  sourceCampaignDraftId: SCOPE,
  status: 'PAUSED',
  createdAt: '2026-10-30T00:00:00.000Z',
  hostAddress: '192.168.1.20',
  hostPort: 3000,
  networkInterface: 'actual-fixture-interface',
  qrPayload: ADDRESS,
  activePlayerCapacity: 3,
  creationReceiptId: 'original-create-receipt',
  creationCommandId: 'original-create-command',
  hostBindRecovery: { status: 'RESERVED', reasonCode: null },
});

describe('historical GM receipts after projection-only navigation', () => {
  const applied = { stateRevision: 4, projectionRevision: 6, actorVisibilityRevision: 0 };
  const before = { ...applied, stateRevision: 3, projectionRevision: 5 };
  // The closed decoder precedes this correlation check; these isolate its scope/vector contract.
  const snapshot = (formId: string, revisions: RevisionVector, projection: JsonObject) =>
    ({ formId, revisions, projection, layers: [] }) as unknown as ConfirmedProjectionSnapshot;
  const scope = { contextId: CONTEXT, campaignId: CAMPAIGN };
  it.each(['ACCEPT', 'REJECT'] as const)(
    'recovers GM %s after RETURN with unchanged S and higher P',
    (decision) => {
      const receipt = {
        commandId: 'lost-gm-command',
        receiptId: 'original-gm-receipt',
        revisions: applied,
        result: {
          workflowCommandId: `UI-CMD-ADMISSION-GM-${decision}`,
          admissionBatchId: SCOPE,
          proposalChecksumOrNull: '1'.repeat(64),
          campaignCharacterIds: [REF.sourceUuid],
          reasonOrNull: 'Причина',
        },
      };
      const source = snapshot('NET-021', before, scope);
      const returned = snapshot('NET-017', { ...applied, projectionRevision: 7 }, gmQueue(applied));
      expect(gmDecisionDestination(returned, source, receipt, true)).toBe(true);
      expect(
        gmDecisionDestination({ ...returned, revisions: applied }, source, receipt, true),
      ).toBe(false);
      for (const changed of [
        { ...returned, revisions: { ...applied, stateRevision: 2, projectionRevision: 7 } },
        { ...returned, projection: { ...returned.projection, contextId: NEXT_CONTEXT } },
        { ...returned, projection: { ...returned.projection, campaignId: NEXT_CONTEXT } },
      ])
        expect(
          gmDecisionDestination(
            changed as unknown as ConfirmedProjectionSnapshot,
            source,
            receipt,
            true,
          ),
        ).toBe(false);
      const original = snapshot(decision === 'ACCEPT' ? 'NET-021' : 'NET-022', applied, {
        ...scope,
        admissionBatchId: SCOPE,
        published: true,
        editable: false,
        proposalChecksum: '1'.repeat(64),
        proposedCampaignCopies: [{ campaignCharacterIdOrNull: REF.sourceUuid }],
        reason: 'Причина',
      });
      expect(gmDecisionDestination(original, source, receipt, true)).toBe(true);
      expect(
        gmDecisionDestination(
          {
            ...original,
            projection: { ...original.projection, editable: true },
          } as unknown as ConfirmedProjectionSnapshot,
          source,
          receipt,
          true,
        ),
      ).toBe(false);
    },
  );
  it('recovers preliminary ACCEPT after OPEN while still checking the exact applied vector', () => {
    const receipt = {
      commandId: 'lost-preliminary',
      receiptId: 'original-preliminary',
      revisions: applied,
      result: { afterRequestStatus: 'IN_REVIEW' },
    };
    const source = snapshot('NET-017', before, gmQueue(before));
    const opened = snapshot('NET-018', { ...applied, projectionRevision: 7 }, scope);
    expect(gmDecisionDestination(opened, source, receipt, true)).toBe(true);
    expect(gmDecisionDestination({ ...opened, revisions: applied }, source, receipt, true)).toBe(
      false,
    );
    expect(
      gmDecisionDestination(
        opened,
        source,
        { ...receipt, result: { afterRequestStatus: 'REJECTED' } },
        true,
      ),
    ).toBe(false);
  });
});
function gmSnapshot(
  formId: 'NET-017' | 'CMP-006',
  p: JsonObject,
  v: RevisionVector,
  id: string,
  reason: 'RECONNECT' | 'FORM_ACTION' | 'COMMAND_DESTINATION' | 'HOST_SYSTEM_EVENT' = 'RECONNECT',
): ProjectionSnapshotV2Message {
  const keys: ActionKey[] =
    formId === 'CMP-006'
      ? ['CMP-006::CTA::002']
      : p['commandId'] !== null
        ? []
        : [
            ...(p['selectedRequestIdOrNull'] !== null &&
            (p['requests'] as readonly JsonObject[]).some(
              (r) =>
                r['requestId'] === p['selectedRequestIdOrNull'] && r['requestStatus'] === 'PENDING',
            )
              ? ['NET-017::CTA::007' as const]
              : []),
            ...(p['selectedRequestIdOrNull'] !== null &&
            typeof p['decisionReason'] === 'string' &&
            p['decisionReason'].trim() !== '' &&
            (p['requests'] as readonly JsonObject[]).some(
              (r) =>
                r['requestId'] === p['selectedRequestIdOrNull'] &&
                ['PENDING', 'IN_REVIEW'].includes(r['requestStatus'] as string),
            )
              ? ['NET-017::CTA::008' as const]
              : []),
            'NET-017::CTA::009',
          ];
  const definition = presentedFormDefinition(formId)!;
  if (definition.type !== 'screen') throw new Error('GM queue fixture requires a source screen');
  return {
    protocolVersion: 2,
    messageType: 'projection.snapshot',
    projectionRole: 'gm',
    revisions: v,
    presentation: {
      assignment: { reason, correlationId: id },
      base: {
        formId,
        formType: definition.type,
        routeTemplate: definition.route,
        routeBindings: [{ parameterIndex: 0, source: 'inherited', value: CAMPAIGN }],
        roleFilteredPayload: p,
        availableActionKeys: keys,
      },
      layers: [],
    },
  };
}
function gmReady(
  socket: Socket,
  p: JsonObject,
  v: RevisionVector = ZERO,
  form: 'NET-017' | 'CMP-006' = 'NET-017',
) {
  const id = sent(socket)['reconnectRequestId'] as string;
  socket.message({
    protocolVersion: 2,
    messageType: 'session.reconnect.capabilities',
    reconnectRequestId: id,
    revisions: v,
    executableWorkflowCommandIds: GM_CAPS,
  });
  socket.message(gmSnapshot(form, p, v, id));
}
async function gmStart(p: JsonObject = gmQueue(), v: RevisionVector = ZERO) {
  window.sessionStorage.setItem(GM_CONTEXT_STORAGE_KEY, CONTEXT);
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ deviceId: DEVICE }), { status: 200 })),
    ),
  );
  const states: WebClientState[] = [],
    drafts: (NetworkGmRequestDraftClientState | null)[] = [];
  const connection = connectProjection(
    (state) => states.push(state),
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
    undefined,
    undefined,
    (state) => drafts.push(state),
  );
  connections.push(connection);
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
  const socket = Socket.instances[0]!;
  socket.open();
  gmReady(socket, p, v);
  expect(states.at(-1)?.kind).toBe('ready');
  return { connection, socket, states, drafts };
}
function gmDecision(command: Record<string, unknown>) {
  const expected = command['expectedRevisions'] as RevisionVector,
    payload = command['payload'] as Record<string, unknown>,
    reject = command['workflowCommandId'] === 'UI-CMD-DEVICE-REQUEST-REJECT';
  return {
    commandId: command['commandId'],
    receiptId: 'gm-decision-receipt',
    revisions: {
      ...expected,
      stateRevision: expected.stateRevision + 1,
      projectionRevision: expected.projectionRevision + 1,
    },
    result: {
      receiptId: 'gm-decision-receipt',
      commandId: command['commandId'],
      workflowCommandId: command['workflowCommandId'],
      campaignId: CAMPAIGN,
      requestId: REQUEST,
      requestOwnerDeviceId: NEXT_CONTEXT,
      beforeRequestStatus: 'PENDING',
      afterRequestStatus: reject ? 'REJECTED' : 'IN_REVIEW',
      beforeRequestRevision: 0,
      requestRevision: 1,
      decisionReasonOrNull: reject ? payload['reason'] : null,
      candidateSnapshotChecksums: ['5'.repeat(64)],
      authoritativeGmActorId: 'source-gm-profile',
      timestamp: '2026-10-30T01:00:00.000Z',
    },
  };
}
describe('NET-017 actual GM client transport family', () => {
  it('checks admission OPEN as a presentation advance and rejects a fabricated state advance', () => {
    const v = { stateRevision: 2, projectionRevision: 4, actorVisibilityRevision: 0 };
    const source = { projection: gmQueue(v), layers: [] } as unknown as ConfirmedProjectionSnapshot;
    const request: AdmissionBrowserRequest = {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: 'open',
      workflowCommandId: 'UI-CMD-ADMISSION-REVIEW-OPEN',
      expectedRevisions: v,
      payload: { campaignId: CAMPAIGN, requestId: REQUEST, requestRevision: 1 },
    };
    const receipt = {
      commandId: 'open',
      receiptId: ATTEMPT,
      revisions: { ...v, projectionRevision: 5 },
      result: {
        workflowCommandId: request.workflowCommandId,
        contextId: CONTEXT,
        campaignId: CAMPAIGN,
        admissionBatchId: SESSION,
        timestamp: '2026-11-01T00:00:00.000Z',
        originalOpenReceipt: {
          receiptId: ATTEMPT,
          commandId: 'open',
          workflowCommandId: request.workflowCommandId,
          campaignId: CAMPAIGN,
          requestId: REQUEST,
          requestOwnerDeviceId: NEXT_CONTEXT,
          admissionBatchId: SESSION,
          reviewCopies: [
            {
              reviewCopyId: SCOPE,
              sourceUuid: GM_ROW.batchCharacterSummaries[0].sourceUuid,
              sourceSnapshotId: GM_ROW.batchCharacterSummaries[0].sourceSnapshotId,
              snapshotChecksum: 'a'.repeat(64),
            },
          ],
          reviewRevision: 0,
          authoritativeGmActorId: 'gm',
          timestamp: '2026-11-01T00:00:00.000Z',
        },
      },
    };
    expect(admissionBrowserReceipt(receipt, request, source)).toEqual(receipt);
    expect(() =>
      admissionBrowserReceipt(
        { ...receipt, revisions: { ...receipt.revisions, stateRevision: 3 } },
        request,
        source,
      ),
    ).toThrow();
    expect(() =>
      admissionBrowserReceipt(
        { ...receipt, result: { ...receipt.result, contextId: NEXT_CONTEXT } },
        request,
        source,
      ),
    ).toThrow();
  });
  it('resumes the own GM ticket with creation, preliminary review and final admission capabilities, without player fields', async () => {
    const f = await gmStart();
    expect(sent(f.socket)).toMatchObject({
      messageType: 'campaign.local-context.resume',
      gmLocalContextId: CONTEXT,
      supportedWorkflowCommandIds: GM_CAPS,
    });
    expect(window.sessionStorage.getItem(GM_CONTEXT_STORAGE_KEY)).toBe(CONTEXT);
    expect(window.sessionStorage.getItem(NETWORK_CONTEXT_STORAGE_KEY)).toBeNull();
    expect(f.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'NET-017',
        availableActionKeys: ['NET-017::CTA::007', 'NET-017::CTA::009'],
      },
    });
    expect(JSON.stringify(f.states.at(-1))).not.toContain('networkScopeId');
    expect(JSON.stringify(f.states.at(-1))).not.toContain('controllerSeat"');
  });
  it('pins applied draft facts while a newer live current view preserves the exact pending update', async () => {
    const f = await gmStart();
    vi.useFakeTimers();
    expect(
      f.connection.replaceNetworkGmRequestDraft({
        selectedRequestIdOrNull: REQUEST,
        decisionReason: '  Exact reason e\u0301  ',
      }),
    ).toEqual({ ok: true });
    expect(f.connection.requestFormAction('NET-017::CTA::007').ok).toBe(false);
    vi.advanceTimersByTime(250);
    const draft = sent(f.socket);
    expect(draft).toMatchObject({
      messageType: 'network.gm-request-draft.replace',
      scope: { gmLocalContextId: CONTEXT, campaignId: CAMPAIGN, sourceFormId: 'NET-017' },
      expectedRequestQueueRevision: 1,
      values: { selectedRequestIdOrNull: REQUEST, decisionReason: '  Exact reason e\u0301  ' },
    });
    const applied = { stateRevision: 1, projectionRevision: 1, actorVisibilityRevision: 0 },
      current = { ...applied, projectionRevision: 2 },
      p = gmQueue(current, {
        decisionReason: '  Exact reason e\u0301  ',
        requests: [{ ...GM_ROW, connectionState: 'DISCONNECTED' }],
      });
    f.socket.message(
      gmSnapshot('NET-017', p, current, 'network-gm-view:' + 'a'.repeat(64), 'HOST_SYSTEM_EVENT'),
    );
    expect(f.drafts.at(-1)).toMatchObject({ dirty: true, pending: true });
    expect(sent(f.socket)).toEqual(draft);
    const view = gmSnapshot('NET-017', p, current, 'unused');
    f.socket.message({
      protocolVersion: 3,
      messageType: 'network.gm-request-draft.result',
      draftUpdateId: draft['draftUpdateId'],
      scope: draft['scope'],
      changed: true,
      appliedRevisions: applied,
      appliedRequestQueueRevision: 1,
      revisions: current,
      requestQueueRevision: 1,
      projectionRole: 'gm',
      presentation: { base: view.presentation.base, layers: [] },
    });
    expect(f.drafts.at(-1)).toMatchObject({ dirty: false, pending: false });
    expect(f.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        revisions: current,
        availableActionKeys: ['NET-017::CTA::007', 'NET-017::CTA::008', 'NET-017::CTA::009'],
      },
    });
  });
  it('replays the exact pending draft after reconnect and clears a reason when selection changes', async () => {
    const f = await gmStart(gmQueue(ZERO, { decisionReason: 'Old request reason' }));
    vi.useFakeTimers();
    f.connection.replaceNetworkGmRequestDraft({
      selectedRequestIdOrNull: null,
      decisionReason: 'Must not migrate',
    });
    vi.advanceTimersByTime(250);
    const draft = sent(f.socket);
    expect(draft['values']).toEqual({ selectedRequestIdOrNull: null, decisionReason: '' });
    f.socket.drop();
    expect(f.connection.reconnect()).toEqual({ ok: true });
    const second = Socket.instances[1]!;
    second.open();
    gmReady(second, gmQueue(ZERO, { decisionReason: 'Old request reason' }));
    expect(sent(second)).toEqual(draft);
  });
  it('retries an unchanged unacknowledged GM command then verifies all immutable receipt and destination facts', async () => {
    const f = await gmStart();
    expect(f.connection.requestFormAction('NET-017::CTA::007')).toEqual({ ok: true });
    const command = sent(f.socket);
    f.socket.drop();
    f.connection.reconnect();
    const second = Socket.instances[1]!;
    second.open();
    expect(sent(second)['unacknowledgedCommandIds']).toEqual([command['commandId']]);
    second.message({
      messageType: 'command.refusal',
      protocolVersion: 1,
      commandId: command['commandId'],
      lastLifecycleState: null,
      revisions: ZERO,
      refusal: { code: 'GUARD_REJECTED' },
    });
    gmReady(second, gmQueue());
    expect(sent(second)).toEqual(command);
    const receipt = gmDecision(command),
      v = receipt.revisions,
      p = gmQueue(v, {
        requestQueueRevision: 2,
        requests: [
          {
            ...GM_ROW,
            requestStatus: 'IN_REVIEW',
            requestRevision: 1,
            decisionReceiptIdOrNull: receipt.receiptId,
          },
        ],
      });
    second.message({
      protocolVersion: 1,
      messageType: 'command.result',
      lifecycleState: 'COMMITTED',
      receipt,
    });
    expect(f.drafts.at(-1)).toMatchObject({ pending: true });
    second.message(
      gmSnapshot('NET-017', p, v, command['commandId'] as string, 'COMMAND_DESTINATION'),
    );
    expect(f.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { projection: { requests: [{ requestStatus: 'IN_REVIEW' }] } },
    });
    expect(f.drafts.at(-1)).toMatchObject({ pending: false });
  });
  it.each(['owner', 'checksum', 'reason', 'revision', 'receiptId'])(
    'refuses changed %s receipt facts',
    async (fault) => {
      const f = await gmStart(gmQueue(ZERO, { decisionReason: 'Original rejection reason' }));
      f.connection.requestFormAction('NET-017::CTA::008');
      const receipt = gmDecision(sent(f.socket));
      if (fault === 'owner') receipt.result.requestOwnerDeviceId = DEVICE;
      if (fault === 'checksum') receipt.result.candidateSnapshotChecksums = ['4'.repeat(64)];
      if (fault === 'reason') receipt.result.decisionReasonOrNull = 'Another reason';
      if (fault === 'revision') receipt.result.requestRevision = 2;
      if (fault === 'receiptId') receipt.result.receiptId = 'different';
      f.socket.message({
        protocolVersion: 1,
        messageType: 'command.result',
        lifecycleState: 'COMMITTED',
        receipt,
      });
      expect(f.states.at(-1)?.kind).toBe('protocol-error');
    },
  );
  it('accepts original accept receipt paired with a newer current rejection without replaying its old status', async () => {
    const f = await gmStart();
    f.connection.requestFormAction('NET-017::CTA::007');
    const command = sent(f.socket),
      receipt = gmDecision(command),
      v = { stateRevision: 2, projectionRevision: 2, actorVisibilityRevision: 0 },
      p = gmQueue(v, {
        requestQueueRevision: 3,
        requests: [
          {
            ...GM_ROW,
            requestStatus: 'REJECTED',
            requestRevision: 2,
            decisionReceiptIdOrNull: 'later-rejection',
            gmMessageOrNull: 'Later exact reason',
          },
        ],
      });
    f.socket.message(
      gmSnapshot('NET-017', p, v, 'network-gm-view:' + 'b'.repeat(64), 'HOST_SYSTEM_EVENT'),
    );
    f.socket.message({
      protocolVersion: 1,
      messageType: 'command.result',
      lifecycleState: 'COMMITTED',
      receipt,
    });
    f.socket.message(
      gmSnapshot('NET-017', p, v, command['commandId'] as string, 'COMMAND_DESTINATION'),
    );
    expect(f.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: { projection: { requests: [{ requestStatus: 'REJECTED', requestRevision: 2 }] } },
    });
  });
  it.each([0, 1, 2])(
    'keeps CMP-006 birth bytes and a monotonic technical vector through explicit back and ingress at visibility %s',
    async (actorVisibilityRevision) => {
      const initial = { stateRevision: 4, projectionRevision: 7, actorVisibilityRevision },
        f = await gmStart(gmQueue(initial), initial);
      f.connection.requestFormAction('NET-017::CTA::009');
      const back = sent(f.socket),
        v = { ...initial, projectionRevision: 8 };
      f.socket.message(
        gmSnapshot('CMP-006', gmBirth(), v, back['navigationRequestId'] as string, 'FORM_ACTION'),
      );
      expect(f.states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: { formId: 'CMP-006', revisions: v },
      });
      expect(f.connection.requestFormAction('CMP-006::CTA::002')).toEqual({ ok: true });
      const enter = sent(f.socket),
        next = { ...v, projectionRevision: 9 };
      f.socket.message(
        gmSnapshot(
          'NET-017',
          gmQueue(next),
          next,
          enter['navigationRequestId'] as string,
          'FORM_ACTION',
        ),
      );
      expect(f.states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: { formId: 'NET-017', revisions: next },
      });
    },
  );
  it.each(['scope', 'form', 'prefix', 'regression'])(
    'refuses unsolicited %s refresh',
    async (fault) => {
      const f = await gmStart(),
        v = { stateRevision: 0, projectionRevision: 1, actorVisibilityRevision: 0 };
      let frame = gmSnapshot(
        'NET-017',
        gmQueue(v),
        v,
        'network-gm-view:' + 'c'.repeat(64),
        'HOST_SYSTEM_EVENT',
      );
      if (fault === 'scope')
        frame = gmSnapshot(
          'NET-017',
          gmQueue(v, { contextId: NEXT_CONTEXT }),
          v,
          frame.presentation.assignment.correlationId,
          'HOST_SYSTEM_EVENT',
        );
      if (fault === 'form')
        frame = gmSnapshot(
          'CMP-006',
          gmBirth(),
          v,
          frame.presentation.assignment.correlationId,
          'HOST_SYSTEM_EVENT',
        );
      if (fault === 'prefix')
        frame = {
          ...frame,
          presentation: {
            ...frame.presentation,
            assignment: { reason: 'HOST_SYSTEM_EVENT', correlationId: 'untrusted-notification' },
          },
        };
      if (fault === 'regression')
        frame = gmSnapshot(
          'NET-017',
          gmQueue(v, { requestQueueRevision: 0 }),
          v,
          frame.presentation.assignment.correlationId,
          'HOST_SYSTEM_EVENT',
        );
      f.socket.message(frame);
      expect(f.states.at(-1)?.kind).toBe('protocol-error');
    },
  );
  it('renders the connected GM-specific fields through App without raw player or private payload panels', async () => {
    window.sessionStorage.setItem(GM_CONTEXT_STORAGE_KEY, CONTEXT);
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ deviceId: DEVICE }), { status: 200 })),
      ),
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });
    act(() => root.render(createElement(App)));
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    const socket = Socket.instances[0]!;
    act(() => {
      socket.open();
      gmReady(socket, gmQueue());
    });
    expect(container.querySelector('[aria-label="Входящие заявки устройств"]')).not.toBeNull();
    expect(container.textContent).toContain('Игрок');
    expect(container.textContent).not.toContain('networkScopeId');
    expect(container.textContent).not.toContain('privateKey');
  });
  it('accepts only the own NET-005 decision push and keeps the player capability vocabulary separate', async () => {
    const f = await start('NET-005', waiting(ZERO));
    const v = { stateRevision: 1, projectionRevision: 1, actorVisibilityRevision: 0 },
      p = { ...waiting(v), requestStatus: 'IN_REVIEW', requestRevision: 1 };
    const frame = snapshot('NET-005', p, v, 'network-owner-view:' + 'd'.repeat(64));
    f.socket.message({
      ...frame,
      presentation: {
        ...frame.presentation,
        assignment: {
          reason: 'HOST_SYSTEM_EVENT',
          correlationId: 'network-owner-view:' + 'd'.repeat(64),
        },
      },
    });
    expect(f.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'NET-005',
        projection: { requestStatus: 'IN_REVIEW' },
        availableActionKeys: [],
      },
    });
    expect(sent(f.socket)['supportedWorkflowCommandIds'] as readonly string[]).not.toContain(
      'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
    );
    const foreign = snapshot(
      'NET-005',
      { ...p, contextId: NEXT_CONTEXT },
      { ...v, projectionRevision: 2 },
      'unused',
    );
    f.socket.message({
      ...foreign,
      presentation: {
        ...foreign.presentation,
        assignment: {
          reason: 'HOST_SYSTEM_EVENT',
          correlationId: 'network-owner-view:' + 'e'.repeat(64),
        },
      },
    });
    expect(f.states.at(-1)?.kind).toBe('protocol-error');
  });
  it('retains an unseen player command through the real resume absence sequence and retries its exact envelope', async () => {
    const f = await start('NET-002', address());
    expect(f.connection.requestFormAction('NET-002::CTA::003')).toEqual({ ok: true });
    const command = sent(f.socket);
    f.socket.drop();
    f.connection.reconnect();
    const second = Socket.instances[1]!;
    second.open();
    expect(sent(second)['unacknowledgedCommandIds']).toEqual([command['commandId']]);
    second.message({
      protocolVersion: 1,
      messageType: 'command.refusal',
      commandId: command['commandId'],
      lastLifecycleState: null,
      revisions: ZERO,
      refusal: { code: 'GUARD_REJECTED' },
    });
    ready(second, 'NET-002', { ...address(), contextId: NEXT_CONTEXT });
    expect(sent(second)).toEqual(command);
    expect(f.states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { availableActionKeys: [] } });
  });
  it.each(['same-vector replacement', 'different applied values'] as const)(
    'rejects a player draft result with %s',
    async (invalid) => {
      const f = await start('NET-005', waiting(ZERO));
      vi.useFakeTimers();
      f.connection.replaceNetworkDraft({
        variant: 'CANCEL_REASON',
        values: { cancelReason: 'Requested reason' },
      });
      vi.advanceTimersByTime(250);
      const edit = sent(f.socket);
      const v = { stateRevision: 1, projectionRevision: 1, actorVisibilityRevision: 0 };
      if (invalid === 'same-vector replacement') {
        const push = snapshot(
          'NET-005',
          { ...waiting(v), requestStatus: 'IN_REVIEW', requestRevision: 1 },
          v,
          'unused',
        );
        f.socket.message({
          ...push,
          presentation: {
            ...push.presentation,
            assignment: {
              reason: 'HOST_SYSTEM_EVENT',
              correlationId: 'network-owner-view:' + 'e'.repeat(64),
            },
          },
        });
        expect(f.states.at(-1)?.kind).toBe('ready');
      }
      const p = {
        ...waiting(
          v,
          1,
          invalid === 'same-vector replacement' ? 'Requested reason' : 'Changed reason',
        ),
        ...(invalid === 'same-vector replacement'
          ? { requestStatus: 'IN_REVIEW', requestRevision: 1 }
          : {}),
      };
      const view = snapshot(
        'NET-005',
        p,
        v,
        edit['draftUpdateId'] as string,
        'RECONNECT',
        invalid === 'same-vector replacement' ? [] : ['NET-005::CTA::001'],
      );
      f.socket.message({
        protocolVersion: 3,
        messageType: 'network.draft.result',
        draftUpdateId: edit['draftUpdateId'],
        scope: edit['scope'],
        changed: true,
        appliedDraftRevision: 1,
        appliedRevisions: v,
        draftRevision: 1,
        revisions: v,
        projectionRole: 'player',
        presentation: { base: view.presentation.base, layers: [] },
      });
      expect(f.states.at(-1)).toMatchObject({ kind: 'protocol-error', refusal: { value: null } });
    },
  );
  it('renders the live owner rejection and decodes its safe return to editable NET-003', async () => {
    window.sessionStorage.setItem(NETWORK_CONTEXT_STORAGE_KEY, SCOPE);
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ deviceId: DEVICE }), { status: 200 })),
      ),
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });
    act(() => root.render(createElement(App)));
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    const socket = Socket.instances[0]!;
    act(() => {
      socket.open();
      ready(socket, 'NET-005', waiting(ZERO));
    });
    const v = { stateRevision: 1, projectionRevision: 1, actorVisibilityRevision: 0 };
    const p = {
      ...waiting(v),
      requestStatus: 'REJECTED',
      requestRevision: 1,
      gmMessage: 'Уточните заявку',
    };
    const push = snapshot('NET-005', p, v, 'unused', 'RECONNECT', ['NET-005::CTA::003']);
    act(() =>
      socket.message({
        ...push,
        presentation: {
          ...push.presentation,
          assignment: {
            reason: 'HOST_SYSTEM_EVENT',
            correlationId: 'network-owner-view:' + 'f'.repeat(64),
          },
        },
      }),
    );
    expect(container.textContent).toContain('Уточните заявку');
    const back = container.querySelector<HTMLButtonElement>(
      '[data-atlas-action-key="NET-005::CTA::003"]',
    );
    expect(back).not.toBeNull();
    act(() => back!.click());
    const navigation = sent(socket),
      next = { ...v, projectionRevision: 2 };
    expect(navigation['actionKey']).toBe('NET-005::CTA::003');
    act(() =>
      socket.message(
        snapshot(
          'NET-003',
          selection(next),
          next,
          navigation['navigationRequestId'] as string,
          'FORM_ACTION',
        ),
      ),
    );
    expect(container.querySelector('[data-atlas-form-id="NET-003"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-action-key="NET-003::CTA::001"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-action-key="NET-003::CTA::003"]')).toBeNull();
  });

  it('rebases an unsaved GM reason once after an exact P-only stale refusal and verified reconnect, without a workflow command', async () => {
    const f = await gmStart();
    vi.useFakeTimers();
    f.connection.replaceNetworkGmRequestDraft({
      selectedRequestIdOrNull: REQUEST,
      decisionReason: 'Keep this reason',
    });
    vi.advanceTimersByTime(250);
    const original = sent(f.socket);
    const v = { ...ZERO, projectionRevision: 1 };
    f.socket.message({
      protocolVersion: 3,
      messageType: 'network.gm-request-draft.refusal',
      draftUpdateId: original['draftUpdateId'],
      scope: original['scope'],
      revisions: v,
      presentationUnchanged: true,
      refusal: { code: 'STALE_REVISION', expected: ZERO, actual: v },
    });
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(2));
    const second = Socket.instances[1]!;
    second.open();
    gmReady(second, gmQueue(v), v);
    const retry = sent(second);
    expect(retry).toMatchObject({
      messageType: 'network.gm-request-draft.replace',
      values: original['values'],
      expectedRevisions: v,
    });
    expect(retry['draftUpdateId']).not.toBe(original['draftUpdateId']);
    const next = { ...v, projectionRevision: 2 };
    second.message({
      protocolVersion: 3,
      messageType: 'network.gm-request-draft.refusal',
      draftUpdateId: retry['draftUpdateId'],
      scope: retry['scope'],
      revisions: next,
      presentationUnchanged: true,
      refusal: { code: 'STALE_REVISION', expected: v, actual: next },
    });
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(3));
    const third = Socket.instances[2]!;
    third.open();
    gmReady(third, gmQueue(next), next);
    expect(third.sent).toHaveLength(1);
    expect(
      Socket.instances
        .flatMap((socket) => socket.sent)
        .map((text) => JSON.parse(text) as Record<string, unknown>)
        .filter((m) => m['messageType'] === 'command.request'),
    ).toEqual([]);
  });

  it('sends a coalesced new selection before its newly typed reason and preserves both exact drafts', async () => {
    const f = await gmStart(gmQueue(ZERO, { selectedRequestIdOrNull: null }));
    vi.useFakeTimers();
    f.connection.replaceNetworkGmRequestDraft({
      selectedRequestIdOrNull: REQUEST,
      decisionReason: '',
    });
    f.connection.replaceNetworkGmRequestDraft({
      selectedRequestIdOrNull: REQUEST,
      decisionReason: 'Typed for the new selection',
    });
    vi.advanceTimersByTime(250);
    const first = sent(f.socket);
    expect(first['values']).toEqual({ selectedRequestIdOrNull: REQUEST, decisionReason: '' });
    const v = { stateRevision: 1, projectionRevision: 1, actorVisibilityRevision: 0 },
      p = gmQueue(v);
    const view = gmSnapshot('NET-017', p, v, first['draftUpdateId'] as string);
    f.socket.message({
      protocolVersion: 3,
      messageType: 'network.gm-request-draft.result',
      draftUpdateId: first['draftUpdateId'],
      scope: first['scope'],
      changed: true,
      appliedRevisions: v,
      appliedRequestQueueRevision: 1,
      revisions: v,
      requestQueueRevision: 1,
      projectionRole: 'gm',
      presentation: { base: view.presentation.base, layers: [] },
    });
    expect(f.states.at(-1)?.kind).toBe('ready');
    const second = sent(f.socket);
    expect(second).toMatchObject({
      messageType: 'network.gm-request-draft.replace',
      expectedRevisions: v,
      values: { selectedRequestIdOrNull: REQUEST, decisionReason: 'Typed for the new selection' },
    });
    expect(second['draftUpdateId']).not.toBe(first['draftUpdateId']);
  });
});
