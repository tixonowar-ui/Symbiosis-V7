import { CampaignPeerConnection } from './forms/net/campaign-peer-connection.js';
import {
  campaignPeerStateValue,
  type CampaignPeerStateV3Message,
} from '@shared/campaign-lifecycle.js';
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
import { ORDINARY_SEAT_ACK } from '@shared/ordinary-seat.js';
import { HOST_OWNER_PROFILE_CREATE, HOST_SEAT_ACK } from '@shared/host-seat.js';
import lobbyFixture from '../../tests/fixtures/campaign-lobby-owner.json';
import { reconnectFingerprint } from '@shared/reconnect-fingerprint.js';
import { writeHostDelivery } from './forms/ply/host-seat-client.js';
import { readEmptySeatReturn } from './forms/ply/ordinary-seat-client.js';
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
const hostCandidate = {
  hostSeatView: 'ACTIVE',
  revision: 4,
  target: { kind: 'CANDIDATE', targetLocalOwnerId: NEXT_CONTEXT, targetProfileLabel: 'Кандидат' },
  receiptId: REQUEST,
  contextId: CONTEXT,
  networkScopeIdOrNull: SCOPE,
} as const;
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
  campaignStatus: 'PAUSED',
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
  withHostCandidate = false,
) {
  const request = sent(socket);
  const id = (withHostCandidate ? request['requestId'] : request['reconnectRequestId']) as string;
  socket.message({
    messageType: 'session.reconnect.capabilities',
    protocolVersion: 2,
    reconnectRequestId: id,
    revisions: v,
    executableWorkflowCommandIds: capabilities,
  });
  const view = snapshot(form, p, v, id, 'RECONNECT', keys);
  socket.message(
    withHostCandidate
      ? {
          ...view,
          presentation: {
            ...view.presentation,
            layers: [
              {
                formId: 'PLY-029',
                formType: 'component',
                routeTemplate: '@component/ply-029',
                routeBindings: [],
                roleFilteredPayload: hostCandidate,
                availableActionKeys: [],
              },
            ],
          },
        }
      : view,
  );
}
async function start(
  form: AnyForm,
  p: JsonObject,
  options: {
    ticket?: boolean;
    peer?: boolean;
    keys?: readonly ActionKey[];
    capabilities?: readonly WorkflowCommandId[];
    revisions?: RevisionVector;
    withHostCandidate?: boolean;
  } = {},
) {
  if (options.withHostCandidate)
    writeHostDelivery({
      kind: 'ACTIVE',
      key: 'a'.repeat(64),
      revision: hostCandidate.revision,
      receiptId: hostCandidate.receiptId,
      targetFingerprint: reconnectFingerprint(hostCandidate.target),
    });
  if (options.ticket !== false) window.sessionStorage.setItem(NETWORK_CONTEXT_STORAGE_KEY, SCOPE);
  const flow = await openNetworkTransport(DEVICE, options.peer);
  ready(
    flow.socket,
    form,
    p,
    options.revisions ?? ZERO,
    options.keys,
    options.capabilities,
    options.withHostCandidate,
  );
  expect(flow.states.at(-1)?.kind).toBe('ready');
  return flow;
}

async function openNetworkTransport(deviceId: string, watchPeer = false) {
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ deviceId }), { status: 200 }))),
  );
  const peers: (CampaignPeerStateV3Message | null)[] = [];
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
    undefined,
    watchPeer ? (value) => peers.push(value) : undefined,
  );
  connections.push(connection);
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
  const socket = Socket.instances[0]!;
  socket.open();
  return { connection, socket, states, drafts, peers };
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

describe('host-local admitted player Ready delivery', () => {
  const p = lobbyFixture.lobbySource;
  const v = {
    stateRevision: p.stateRevision,
    projectionRevision: p.projectionRevision,
    actorVisibilityRevision: p.actorVisibilityRevision,
  };
  const player = {
    hostSeatView: 'ACTIVE',
    revision: 4,
    contextId: p.contextId,
    networkScopeIdOrNull: p.networkScopeId,
    receiptId: REQUEST,
    target: {
      kind: 'PLAYER',
      targetProfileLabel: 'Игрок',
      targetLocalOwnerId: p.contextId,
      localControllerSeatId: p.controllerSeat,
    },
  } as const;
  const readyCommand = 'UI-CMD-CAMPAIGN-READY-SET';
  const eventId =
    'network-owner-view:' +
    reconnectFingerprint({
      scope: { ownerDeviceId: p.deviceId, networkScopeId: p.networkScopeId },
      contextId: p.contextId,
      revisions: v,
    });
  function frame(
    reason: 'RECONNECT' | 'HOST_SYSTEM_EVENT' | 'COMMAND_DESTINATION',
    correlationId: string,
    body = p,
    grant: JsonObject = player,
    withReturn = true,
  ): ProjectionSnapshotV2Message {
    return {
      messageType: 'projection.snapshot',
      protocolVersion: 2,
      projectionRole: 'player',
      revisions: {
        stateRevision: body.stateRevision,
        projectionRevision: body.projectionRevision,
        actorVisibilityRevision: body.actorVisibilityRevision,
      },
      presentation: {
        assignment: { reason, correlationId },
        base: {
          formId: 'NET-006',
          formType: 'screen',
          routeTemplate: presentedFormDefinition('NET-006')!.route,
          routeBindings: [{ parameterIndex: 0, source: 'inherited', value: p.campaignId }],
          availableActionKeys: [
            'NET-006::CTA::001',
            body.lobby.ready ? 'NET-006::CTA::004' : 'NET-006::CTA::003',
            ...(withReturn ? ['NET-006::CTA::005' as const] : []),
          ],
          roleFilteredPayload: body,
        },
        layers: [
          {
            formId: 'PLY-029',
            formType: 'component',
            routeTemplate: '@component/ply-029',
            routeBindings: [],
            availableActionKeys: [],
            roleFilteredPayload: grant,
          },
        ],
      },
    };
  }
  it.each([
    'identical',
    'foreign grant',
    'changed actions',
    'changed observation',
    'foreign observation',
    'foreign receipt',
  ] as const)(
    'keeps Ready pending through the exact source observation before the terminal result (%s)',
    async (scenario) => {
      writeHostDelivery({
        kind: 'ACTIVE',
        key: 'a'.repeat(64),
        receiptId: player.receiptId,
        revision: player.revision,
        targetFingerprint: reconnectFingerprint(player.target),
      });
      const { connection, states, socket } = await openNetworkTransport(p.deviceId);
      const resumeId = sent(socket)['requestId'] as string;
      socket.message({
        messageType: 'session.reconnect.capabilities',
        protocolVersion: 2,
        reconnectRequestId: resumeId,
        revisions: v,
        executableWorkflowCommandIds: [HOST_SEAT_ACK, readyCommand],
      });
      socket.message(frame('RECONNECT', resumeId));
      expect(states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: { formId: 'NET-006', hostSeat: player },
      });
      expect(connection.requestFormAction('NET-006::CTA::003')).toEqual({ ok: true });
      const command = sent(socket);
      expect(command).toMatchObject({
        messageType: 'command.request',
        workflowCommandId: readyCommand,
        expectedRevisions: v,
        payload: { ready: true, expectedLobbySnapshotRevision: p.lobby.lobbySnapshotRevision },
      });
      const commandId = command['commandId'] as string;
      const pending = states.at(-1);
      socket.message(
        frame(
          'HOST_SYSTEM_EVENT',
          scenario === 'foreign observation' ? 'network-owner-view:' + '0'.repeat(64) : eventId,
          scenario === 'changed observation'
            ? { ...p, lobby: { ...p.lobby, lobbyEventRevision: p.lobby.lobbyEventRevision + 1 } }
            : p,
          scenario === 'foreign grant' ? { ...player, revision: player.revision + 1 } : player,
          scenario !== 'changed actions',
        ),
      );
      if (scenario !== 'identical' && scenario !== 'foreign receipt') {
        expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
        return;
      }
      expect(states.at(-1)).toEqual(pending);
      expect(connection.requestFormAction('NET-006::CTA::003').ok).toBe(false);
      expect(sent(socket)).toEqual(command);
      const committed = {
        ...v,
        stateRevision: v.stateRevision + 2,
        projectionRevision: v.projectionRevision + 2,
      };
      const readinessRevision = p.lobby.readinessRevision + 1;
      socket.message({
        messageType: 'command.result',
        protocolVersion: 1,
        lifecycleState: 'COMMITTED',
        receipt: {
          commandId,
          receiptId: ATTEMPT,
          revisions: committed,
          result: {
            operation: 'CAMPAIGN_READY_SET',
            networkScopeId: p.networkScopeId,
            remoteReceipt: {
              receiptId: ATTEMPT,
              commandId,
              campaignId: p.campaignId,
              lobbySnapshotRevision: p.lobby.lobbySnapshotRevision,
              readinessRevision,
              committedAt: '2026-11-02T00:00:00.000Z',
              workflowCommandId: readyCommand,
              ownerDeviceId: p.deviceId,
              includedCampaignCharacterIds:
                scenario === 'foreign receipt' ? [SESSION] : p.lobby.includedCampaignCharacterIds,
              ready: true,
            },
          },
        },
      });
      if (scenario === 'foreign receipt') {
        expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
        return;
      }
      expect(connection.requestFormAction('NET-006::CTA::003').ok).toBe(false);
      socket.message(
        frame('COMMAND_DESTINATION', commandId, {
          ...p,
          ...committed,
          readyStatus: 'READY',
          lobby: {
            ...p.lobby,
            lobbyEventRevision: p.lobby.lobbyEventRevision + 1,
            readinessRevision,
            ready: true,
          },
        }),
      );
      expect(states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: {
          formId: 'NET-006',
          availableActionKeys: ['NET-006::CTA::001', 'NET-006::CTA::004', 'NET-006::CTA::005'],
          projection: { readyStatus: 'READY' },
          hostSeat: player,
        },
      });
    },
  );
});

describe('historical host-local candidate admission result', () => {
  const source = lobbyFixture.admissionSource;
  const active = {
    ...hostCandidate,
    contextId: hostCandidate.target.targetLocalOwnerId,
    networkScopeIdOrNull: source.networkScopeId,
    terminalResultReadOnly: true,
  } as const;
  // Keep the recorded proposal, copy identities and mechanical sheets. A DECLINE
  // relinquishes every proposed place without assigning a group or controller.
  const accepted = lobbyFixture.admissionReceipt.receipt.result.remoteReceipt;
  const declined = {
    ...accepted,
    decision: 'DECLINE',
    capacityProofOrNull: null,
    controllerProofOrNull: null,
    copies: accepted.copies.map(({ campaignCharacterId }) => ({
      campaignCharacterId,
      lifecycleState: 'DECLINED',
      occupiesCampaignPlace: false,
      groupIdOrNull: null,
      locationAssignmentOrNull: null,
      controllerBindingOrNull: null,
    })),
  };
  const projection = {
    ...source,
    contextId: active.contextId,
    receiptOrNull: declined,
    decision: declined.decision,
    decisionReceiptId: declined.receiptId,
    result: 'PLAYER_DECLINED',
    ownCampaignCopies: declined.copies,
    controllerBindings: [],
    controllerDeviceRecheck: false,
    campaignRevisionOrNull: null,
    capacityRecheck: null,
    technicalSessionAvailable: false,
    pendingCommandIdOrNull: null,
  };
  const revisions: RevisionVector = {
    stateRevision: projection.stateRevision,
    projectionRevision: projection.projectionRevision,
    actorVisibilityRevision: projection.actorVisibilityRevision,
  };
  const allowed = {
    'NET-007': ['NET-007::CTA::001', 'NET-007::CTA::005'],
    'NET-027': ['NET-027::CTA::002'],
  } as const;
  function frame(
    formId: keyof typeof allowed,
    reason: 'RECONNECT' | 'FORM_ACTION' | 'HOST_SYSTEM_EVENT',
    correlationId: string,
    payload: JsonObject = projection,
    actions: readonly ActionKey[] = allowed[formId],
  ): ProjectionSnapshotV2Message {
    return {
      protocolVersion: 2,
      messageType: 'projection.snapshot',
      projectionRole: 'player',
      revisions,
      presentation: {
        assignment: { reason, correlationId },
        base: {
          formId,
          formType: 'screen',
          routeTemplate: presentedFormDefinition(formId)!.route,
          routeBindings: [{ parameterIndex: 0, source: 'inherited', value: source.campaignId }],
          availableActionKeys: actions,
          roleFilteredPayload: payload,
        },
        layers: [
          {
            formId: 'PLY-029',
            formType: 'component',
            routeTemplate: '@component/ply-029',
            routeBindings: [],
            availableActionKeys: [],
            roleFilteredPayload: active,
          },
        ],
      },
    };
  }
  async function beginResume() {
    const key = 'a'.repeat(64);
    writeHostDelivery({
      kind: 'ACTIVE',
      key,
      receiptId: active.receiptId,
      revision: active.revision,
      targetFingerprint: reconnectFingerprint(active.target),
    });
    const flow = await openNetworkTransport(source.deviceId, true);
    const request = sent(flow.socket);
    expect(request).toMatchObject({
      messageType: 'host.seat.control',
      operation: 'RESUME',
      deliveryKeyOrNull: key,
    });
    return flow;
  }
  function offer(socket: Socket, capabilities: readonly WorkflowCommandId[] = [HOST_SEAT_ACK]) {
    const id = sent(socket)['requestId'] as string;
    socket.message({
      protocolVersion: 2,
      messageType: 'session.reconnect.capabilities',
      reconnectRequestId: id,
      executableWorkflowCommandIds: capabilities,
      revisions,
    });
    return id;
  }
  async function resume(
    capabilities: readonly WorkflowCommandId[] = [HOST_SEAT_ACK],
    initial = (id: string) => frame('NET-007', 'RECONNECT', id),
  ) {
    const flow = await beginResume();
    flow.socket.message(initial(offer(flow.socket, capabilities)));
    return flow;
  }
  function refuseResume(socket: Socket, requestId: string, revision: number = active.revision) {
    socket.message({
      messageType: 'navigation.form-action.refusal',
      protocolVersion: 2,
      navigationRequestId: requestId,
      presentationUnchanged: true,
      revisions: {
        stateRevision: revision,
        projectionRevision: revision,
        actorVisibilityRevision: revision,
      },
      refusal: { code: 'NAVIGATION_UNAVAILABLE' },
    });
  }
  it.each(['same holder', 'different holder'] as const)(
    'keeps a refused RESUME private until the manual retry confirms its recipient (%s)',
    async (holder) => {
      const { connection, socket, states } = await beginResume();
      const request = sent(socket);
      vi.useFakeTimers();
      refuseResume(socket, request['requestId'] as string);
      expect(states.at(-1)).toMatchObject({ kind: 'disconnected', snapshot: null });
      expect(socket.readyState).toBe(Socket.CLOSED);
      expect(socket.sent).toHaveLength(1);
      vi.advanceTimersByTime(2_000);
      expect(Socket.instances).toHaveLength(1);
      const count = states.length;
      socket.message(frame('NET-007', 'RECONNECT', request['requestId'] as string));
      expect(states).toHaveLength(count);
      expect(connection.reconnect()).toEqual({ ok: true });
      const retry = Socket.instances.at(-1)!;
      retry.open();
      expect(sent(retry)).toMatchObject({
        operation: 'RESUME',
        deliveryKeyOrNull: request['deliveryKeyOrNull'],
        unacknowledgedCommandIds: request['unacknowledgedCommandIds'],
      });
      const id = offer(retry);
      expect(id).not.toBe(request['requestId']);
      expect(states.some((s) => s.kind === 'ready')).toBe(false);
      const next = frame(
        'NET-007',
        'RECONNECT',
        id,
        holder === 'same holder' ? projection : { ...projection, contextId: SESSION },
      );
      retry.message(
        holder === 'same holder'
          ? next
          : {
              ...next,
              presentation: {
                ...next.presentation,
                layers: [
                  {
                    ...next.presentation.layers[0],
                    roleFilteredPayload: {
                      ...active,
                      receiptId: ATTEMPT,
                      contextId: SESSION,
                      target: { ...active.target, targetLocalOwnerId: SESSION },
                    },
                  },
                ],
              },
            },
      );
      if (holder === 'same holder')
        expect(states.at(-1)).toMatchObject({
          kind: 'ready',
          snapshot: { formId: 'NET-007', hostSeat: active },
        });
      else {
        expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
        expect(states.some((s) => s.kind === 'ready')).toBe(false);
      }
    },
  );
  it.each([
    'foreign refusal',
    'stale refusal',
    'refusal after capabilities',
    'system push after capabilities',
  ] as const)('rejects an invalid managed resume sequence (%s)', async (scenario) => {
    const { socket, states } = await beginResume();
    const id = sent(socket)['requestId'] as string;
    if (scenario === 'refusal after capabilities' || scenario === 'system push after capabilities')
      offer(socket);
    if (scenario === 'system push after capabilities')
      socket.message(frame('NET-007', 'HOST_SYSTEM_EVENT', 'network-owner-view:' + 'a'.repeat(64)));
    else
      refuseResume(
        socket,
        scenario === 'foreign refusal' ? 'other-resume' : id,
        scenario === 'stale refusal' ? active.revision - 1 : active.revision,
      );
    expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
    expect(states.some((s) => s.kind === 'ready')).toBe(false);
  });
  it('opens and closes the same signed DECLINE without changing any revision or watching the peer', async () => {
    const { connection, socket, states, peers } = await resume();
    const readyAt = (formId: keyof typeof allowed) =>
      expect(states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: {
          formId,
          revisions,
          projection,
          availableActionKeys: allowed[formId],
          executableWorkflowCommandIds: [HOST_SEAT_ACK],
          hostSeat: active,
        },
      });
    readyAt('NET-007');
    expect(socket.sent).toHaveLength(1);
    for (const [from, to] of [
      ['NET-007', 'NET-027'],
      ['NET-027', 'NET-007'],
    ] as const) {
      expect(connection.requestFormAction(allowed[from][0])).toEqual({ ok: true });
      const request = sent(socket);
      expect(request).toMatchObject({
        messageType: 'navigation.form-action',
        actionKey: allowed[from][0],
        sourceFormId: from,
        expectedProjectionRevision: revisions.projectionRevision,
      });
      socket.message(frame(to, 'FORM_ACTION', request['navigationRequestId'] as string));
      readyAt(to);
    }
    expect(
      socket.sent.map((text) => (JSON.parse(text) as { messageType: string }).messageType),
    ).toEqual(['host.seat.control', 'navigation.form-action', 'navigation.form-action']);
    expect(peers.every((value) => value === null)).toBe(true);
  });
  it('rejects an active decision capability on historical resume', async () => {
    const { states } = await resume([HOST_SEAT_ACK, 'UI-CMD-ADMISSION-PLAYER-DECIDE']);
    expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
  });
  it.each([
    'unlocked',
    'old correlation',
    'foreign grant',
    'changed history',
    'extra action',
  ] as const)(
    'refreshes the archived GM rejection only to unlock return on the current receipt (%s)',
    async (delivery) => {
      const gmReason = 'Заявка отклонена мастером.';
      const body = {
        schemaVersion: 1,
        groupLabels: [],
        proposalOrNull: null,
        gmDecision: {
          ...source.publication.gmDecision,
          decision: 'REJECT',
          reasonOrNull: gmReason,
          workflowCommandId: 'UI-CMD-ADMISSION-GM-REJECT',
          campaignCharacterIds: [],
          proposalRevisionOrNull: null,
          proposalChecksumOrNull: null,
        },
      };
      const rejected = {
        ...projection,
        publication: { ...body, publicationChecksum: reconnectFingerprint(body) },
        result: 'GM_REJECTED',
        gmReasonOrNull: gmReason,
        decision: null,
        receiptOrNull: null,
        decisionReceiptId: body.gmDecision.receiptId,
        proposalRevision: null,
        proposalChecksum: null,
        fullCampaignCopyDiffs: [],
        blockers: [],
        ownCampaignCopies: [],
      };
      const returned = 'NET-007::CTA::005';
      const { socket, states } = await resume([HOST_SEAT_ACK], (id) =>
        frame('NET-007', 'RECONNECT', id, rejected, []),
      );
      expect(states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: { formId: 'NET-007', availableActionKeys: [], hostSeat: active },
      });
      const eventId =
        'network-owner-view:' +
        reconnectFingerprint([
          delivery === 'old correlation' ? ATTEMPT : active.receiptId,
          revisions.projectionRevision,
          returned,
        ]);
      const update = frame(
        'NET-007',
        'HOST_SYSTEM_EVENT',
        eventId,
        delivery === 'changed history' ? { ...rejected, campaignRevisionOrNull: 1 } : rejected,
        delivery === 'extra action' ? [returned, 'NET-007::CTA::002'] : [returned],
      );
      socket.message(
        delivery === 'foreign grant'
          ? {
              ...update,
              presentation: {
                ...update.presentation,
                layers: [
                  {
                    ...update.presentation.layers[0],
                    roleFilteredPayload: { ...active, receiptId: ATTEMPT },
                  },
                ],
              },
            }
          : update,
      );
      if (delivery === 'unlocked') {
        expect(states.at(-1)).toMatchObject({
          kind: 'ready',
          snapshot: {
            formId: 'NET-007',
            projection: rejected,
            revisions,
            hostSeat: active,
            availableActionKeys: [returned],
            executableWorkflowCommandIds: [HOST_SEAT_ACK],
          },
        });
        expect(socket.sent).toHaveLength(1);
      } else expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
    },
  );
  it.each([
    'decision receipt',
    'content',
    'correlation',
    'native revision',
    'scope',
    'grant receipt',
    'owner',
    'marker',
    'active action',
  ] as const)('rejects a changed %s while opening the recorded proposal', async (change) => {
    const { connection, socket, states } = await resume();
    expect(connection.requestFormAction('NET-007::CTA::001')).toEqual({ ok: true });
    const id = sent(socket)['navigationRequestId'] as string;
    const response = frame('NET-027', 'FORM_ACTION', id);
    const native = structuredClone(projection);
    const badge: Record<string, JsonValue> = { ...active };
    const nextRevisions = { ...revisions };
    let correlationId = id;
    let actions: readonly ActionKey[] = allowed['NET-027'];
    switch (change) {
      case 'correlation':
        correlationId = 'foreign-navigation';
        break;
      case 'active action':
        actions = ['NET-027::CTA::004'];
        break;
      case 'decision receipt':
        native.decisionReceiptId = ATTEMPT;
        native.receiptOrNull.receiptId = ATTEMPT;
        break;
      case 'content':
        native.itemLabels[0]!.name += ' (изменено)';
        break;
      case 'native revision':
        native.projectionRevision++;
        nextRevisions.projectionRevision++;
        break;
      case 'scope':
        native.networkScopeId = SCOPE;
        badge['networkScopeIdOrNull'] = SCOPE;
        break;
      case 'grant receipt':
        badge['receiptId'] = ATTEMPT;
        break;
      case 'owner':
        badge['target'] = { ...active.target, targetLocalOwnerId: ATTEMPT };
        break;
      case 'marker':
        delete badge['terminalResultReadOnly'];
        break;
    }
    const { base, layers } = response.presentation;
    socket.message({
      ...response,
      revisions: nextRevisions,
      presentation: {
        ...response.presentation,
        assignment: { reason: 'FORM_ACTION', correlationId },
        base: { ...base, roleFilteredPayload: native, availableActionKeys: actions },
        layers: [{ ...layers[0], roleFilteredPayload: badge }],
      },
    });
    expect(states.at(-1)).toMatchObject({ kind: 'protocol-error', snapshot: null });
  });
});

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
  it.each([
    ['PAUSED', null, true],
    ['HOSTING', null, false],
    ['PAUSED', 'pending-network-command', false],
  ] as const)(
    'validates host-advertised NET-003 seat setup with campaign %s and pending command %s',
    async (campaignStatus, pendingCommandIdOrNull, allowed) => {
      const p = { ...selection(ZERO, 0, false), campaignStatus, pendingCommandIdOrNull };
      const capabilities = [...CAPS, ORDINARY_SEAT_ACK];
      const action = 'NET-003::CTA::004';
      const flow = await start('NET-003', p, { keys: [], capabilities });
      expect(flow.connection.requestFormAction(action).ok).toBe(false);
      flow.socket.drop();
      expect(flow.connection.reconnect()).toEqual({ ok: true });
      const resumed = Socket.instances[1]!;
      resumed.open();
      ready(resumed, 'NET-003', p, ZERO, [action], capabilities);
      if (allowed) {
        expect(flow.states.at(-1)).toMatchObject({
          kind: 'ready',
          snapshot: { availableActionKeys: [action] },
        });
        expect(flow.connection.requestFormAction(action)).toEqual({ ok: true });
        expect(sent(resumed)).toMatchObject({
          messageType: 'navigation.form-action',
          actionKey: action,
        });
      } else {
        expect(flow.states.at(-1)?.kind).toBe('protocol-error');
        expect(flow.connection.requestFormAction(action).ok).toBe(false);
      }
    },
  );
  it.each(['confirmed', 'wrong scope', 'wrong vector'] as const)(
    'restores only the confirmed empty seat return after a menu reload (%s)',
    async (change) => {
      const v = { stateRevision: 5, projectionRevision: 7, actorVisibilityRevision: 0 };
      const caps = [...CAPS, ORDINARY_SEAT_ACK];
      const flow = await start('NET-003', selection(v, 4, false), {
        capabilities: caps,
        revisions: v,
        keys: ['NET-003::CTA::004'],
      });
      const neutral = (kind: 'SETUP' | 'ROSTER') => {
        const actions: ActionKey[] =
          kind === 'SETUP' ? ['APP-003::CTA::004'] : ['PLY-027::CTA::005', 'PLY-027::CTA::006'];
        const message: ProjectionSnapshotV2Message = {
          protocolVersion: 2,
          messageType: 'projection.snapshot',
          projectionRole: 'player',
          revisions: ZERO,
          presentation: {
            assignment: {
              reason: 'FORM_ACTION',
              correlationId: sent(flow.socket)['navigationRequestId'] as string,
            },
            base: {
              formId: 'APP-003',
              formType: 'screen',
              routeTemplate: '/local/app-003',
              routeBindings: [],
              availableActionKeys: kind === 'SETUP' ? actions : [],
              roleFilteredPayload:
                kind === 'SETUP'
                  ? { ordinarySeatView: 'SETUP', revision: 0, selectedCount: 0 }
                  : { ordinarySeatView: 'WAITING', revision: 0 },
            },
            layers:
              kind === 'SETUP'
                ? []
                : [
                    {
                      formId: 'PLY-027',
                      formType: 'component',
                      routeTemplate: '@component/ply-027',
                      routeBindings: [],
                      availableActionKeys: actions,
                      roleFilteredPayload: {
                        ordinarySeatView: 'ROSTER',
                        revision: 0,
                        roster: [],
                        activeSeatIdOrNull: null,
                      },
                    },
                  ],
          },
        };
        flow.socket.message(message);
      };
      expect(flow.connection.requestFormAction('NET-003::CTA::004')).toEqual({ ok: true });
      neutral('SETUP');
      expect(flow.connection.requestFormAction('APP-003::CTA::004')).toEqual({ ok: true });
      neutral('ROSTER');
      expect(flow.connection.requestFormAction('PLY-027::CTA::006')).toEqual({ ok: true });
      const exit = sent(flow.socket)['navigationRequestId'] as string;
      const shell = {
        contextId: CONTEXT,
        deviceId: DEVICE,
        stateRevision: 0,
        projectionRevision: 0,
      };
      flow.socket.message(snapshot('APP-002', shell, ZERO, exit, 'FORM_ACTION'));
      expect(readEmptySeatReturn()).toMatchObject({
        exitNavigationId: exit,
        networkScopeId: SCOPE,
        request: null,
      });
      expect(JSON.stringify(window.sessionStorage)).not.toContain(SUMMARY.name);
      flow.connection.disconnect();
      Socket.instances = [];
      const menu = await start('APP-002', shell, { ticket: false, capabilities: caps });
      expect(menu.connection.requestFormAction('APP-002::CTA::003')).toEqual({ ok: true });
      const resume = sent(menu.socket);
      expect(resume).toMatchObject({
        operation: 'RESUME_EMPTY',
        exitNavigationId: exit,
        expectedProjectionRevision: 0,
      });
      menu.connection.disconnect();
      Socket.instances = [];
      const retry = await start('APP-002', shell, { ticket: false, capabilities: caps });
      expect(retry.connection.requestFormAction('APP-002::CTA::003')).toEqual({ ok: true });
      expect(sent(retry.socket)).toEqual(resume);
      const received = { ...v, projectionRevision: change === 'wrong vector' ? 9 : 8 };
      retry.socket.message(
        snapshot(
          'NET-001',
          {
            ...discovery(),
            ...bound(received, 4),
            contextId: NEXT_CONTEXT,
            networkScopeId: change === 'wrong scope' ? NEXT_CONTEXT : SCOPE,
          },
          received,
          resume['requestId'] as string,
          'FORM_ACTION',
          ['NET-001::CTA::001', 'NET-001::CTA::002'],
        ),
      );
      expect(retry.states.at(-1)?.kind).toBe(change === 'confirmed' ? 'ready' : 'protocol-error');
      if (change === 'confirmed') expect(readEmptySeatReturn()).toBeNull();
    },
  );
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
  it.each([false, true])(
    'binds CHR-027 to its exact source character rather than a scope or campaign locator (handoff %s)',
    async (handoff) => {
      const capabilities = handoff ? [...CAPS, ORDINARY_SEAT_ACK] : CAPS;
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
      const flow = await start('CHR-027', p, { keys: ['CHR-027::CTA::002'], capabilities });
      expect(flow.states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: { path: `/player/characters/${REF.sourceUuid}/create/chr-027` },
      });
      flow.socket.drop();
      if (handoff)
        expect(flow.states.at(-1)).toMatchObject({ kind: 'disconnected', snapshot: null });
      flow.connection.reconnect();
      const second = Socket.instances[1]!;
      second.open();
      const id = sent(second)['reconnectRequestId'] as string;
      second.message({
        messageType: 'session.reconnect.capabilities',
        protocolVersion: 2,
        reconnectRequestId: id,
        revisions: ZERO,
        executableWorkflowCommandIds: capabilities,
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
      expect(flow.states.at(-1)).toMatchObject({
        kind: 'protocol-error',
        refusal: { value: null },
      });
    },
  );
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
  'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
  'UI-CMD-CAMPAIGN-START',
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
      ? ['CMP-006::CTA::001', 'CMP-006::CTA::002']
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
  withHostHandoff = false,
) {
  const id = sent(socket)['reconnectRequestId'] as string;
  socket.message({
    protocolVersion: 2,
    messageType: 'session.reconnect.capabilities',
    reconnectRequestId: id,
    revisions: v,
    executableWorkflowCommandIds: withHostHandoff
      ? [...GM_CAPS, HOST_OWNER_PROFILE_CREATE, HOST_SEAT_ACK]
      : GM_CAPS,
  });
  socket.message(gmSnapshot(form, p, v, id));
}
async function gmStart(
  p: JsonObject = gmQueue(),
  v: RevisionVector = ZERO,
  withHostHandoff = false,
) {
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
  gmReady(socket, p, v, 'NET-017', withHostHandoff);
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
      supportedWorkflowCommandIds: [
        'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK',
        'UI-CMD-LOCAL-OWNER-PROFILE-CREATE',
        ...GM_CAPS.slice(0, 1),
        'UI-CMD-ENEMY-DRAFT-PATCH',
        'UI-CMD-ENEMY-COMMIT-V1',
        'UI-CMD-ENEMY-NEW-VERSION',
        'UI-CMD-MONSTER-STATS-ROLL-ONCE',
        'UI-CMD-NPC-COMMIT-V1',
        'UI-CMD-NPC-NEW-VERSION',
        ...GM_CAPS.slice(1, 7),
        'UI-CMD-CAMPAIGN-SETTINGS-SET',
        'UI-CMD-CAMPAIGN-CAPACITY-SET',
        'UI-CMD-MASTER-PASSWORD-CHANGE',
        'UI-CMD-CAMPAIGN-PAUSE-SET',
        'UI-CMD-CLIENT-DISCONNECT',
        ...GM_CAPS.slice(7),
      ],
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
  it.each(['same candidate', 'revoked candidate'] as const)(
    'recovers an in-flight NET-003 selection only for the confirmed host recipient (%s)',
    async (recipient) => {
      const capabilities = [...CAPS, HOST_SEAT_ACK];
      const keys = [...actions['NET-003']!, 'NET-003::CTA::004' as const];
      const p = selection();
      const flow = await start('NET-003', p, {
        capabilities,
        keys,
        ticket: false,
        withHostCandidate: true,
      });
      vi.useFakeTimers();
      expect(
        flow.connection.replaceNetworkDraft({
          variant: 'SELECTION',
          values: { selectedCandidates: [] },
        }),
      ).toEqual({ ok: true });
      vi.advanceTimersByTime(250);
      const originalFrame = flow.socket.sent.at(-1)!;
      expect(sent(flow.socket)).toMatchObject({
        messageType: 'network.draft.replace',
        variant: 'SELECTION',
        scope: { networkScopeId: SCOPE, contextId: CONTEXT, sourceFormId: 'NET-003' },
      });
      flow.socket.drop();
      expect(flow.states.at(-1)).toMatchObject({ kind: 'disconnected', snapshot: null });
      expect(flow.connection.reconnect()).toEqual({ ok: true });
      const resumed = Socket.instances.at(-1)!;
      resumed.open();
      const request = sent(resumed);
      expect(request).toMatchObject({ operation: 'RESUME', deliveryKeyOrNull: 'a'.repeat(64) });
      if (recipient === 'same candidate') {
        ready(resumed, 'NET-003', p, ZERO, keys, capabilities, true);
        expect(resumed.sent.slice(1)).toEqual([originalFrame]);
      } else {
        const revision = hostCandidate.revision + 1;
        const revisions = {
          stateRevision: revision,
          projectionRevision: revision,
          actorVisibilityRevision: revision,
        };
        resumed.message({
          messageType: 'session.reconnect.capabilities',
          protocolVersion: 2,
          reconnectRequestId: request['requestId'],
          executableWorkflowCommandIds: [HOST_SEAT_ACK],
          revisions,
        });
        resumed.message({
          messageType: 'projection.snapshot',
          protocolVersion: 2,
          projectionRole: 'player',
          revisions,
          presentation: {
            assignment: { reason: 'RECONNECT', correlationId: request['requestId'] },
            layers: [],
            base: {
              formId: 'APP-003',
              formType: 'screen',
              routeTemplate: '/local/app-003',
              routeBindings: [],
              availableActionKeys: [],
              roleFilteredPayload: { hostSeatView: 'WAITING', revision },
            },
          },
        });
        expect(flow.states.at(-1)).toMatchObject({
          kind: 'ready',
          snapshot: { hostSeat: { hostSeatView: 'WAITING' } },
        });
        expect(flow.drafts.at(-1)).toBeNull();
        expect(resumed.sent).toHaveLength(1);
      }
    },
  );
  it.each([false, true])(
    'replays the exact pending draft after reconnect and clears a reason when selection changes (host handoff %s)',
    async (withHostHandoff) => {
      const f = await gmStart(
        gmQueue(ZERO, { decisionReason: 'Old request reason' }),
        ZERO,
        withHostHandoff,
      );
      vi.useFakeTimers();
      f.connection.replaceNetworkGmRequestDraft({
        selectedRequestIdOrNull: null,
        decisionReason: 'Must not migrate',
      });
      vi.advanceTimersByTime(250);
      const draft = sent(f.socket);
      const originalFrame = f.socket.sent.at(-1);
      expect(draft['values']).toEqual({ selectedRequestIdOrNull: null, decisionReason: '' });
      f.socket.drop();
      expect(f.connection.reconnect()).toEqual({ ok: true });
      const second = Socket.instances[1]!;
      second.open();
      gmReady(
        second,
        gmQueue(ZERO, { decisionReason: 'Old request reason' }),
        ZERO,
        'NET-017',
        withHostHandoff,
      );
      expect(second.sent.at(-1)).toBe(originalFrame);
      expect(sent(second)).toEqual(draft);
    },
  );
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
  it.each([false, true])(
    'retains an unseen player command through the real resume absence sequence and retries its exact envelope (handoff %s)',
    async (handoff) => {
      const capabilities = handoff ? [...CAPS, ORDINARY_SEAT_ACK] : CAPS;
      const f = await start('NET-002', address(), { capabilities });
      expect(f.connection.requestFormAction('NET-002::CTA::003')).toEqual({ ok: true });
      const command = sent(f.socket);
      f.socket.drop();
      if (handoff) expect(f.states.at(-1)).toMatchObject({ kind: 'disconnected', snapshot: null });
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
      ready(
        second,
        'NET-002',
        { ...address(), contextId: NEXT_CONTEXT },
        ZERO,
        undefined,
        capabilities,
      );
      expect(sent(second)).toEqual(command);
      expect(f.states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: { availableActionKeys: [] },
      });
    },
  );
  it.each(['NET-003', 'NET-005'] as const)(
    'withdraws the %s private batch while waiting for its authenticated reconnect',
    async (form) => {
      const capabilities = [...CAPS, ORDINARY_SEAT_ACK];
      const p = form === 'NET-003' ? selection() : waiting(ZERO);
      const f = await start(form, p, { capabilities });
      expect(JSON.stringify(f.states.at(-1))).toContain(SUMMARY.name);
      f.socket.drop();
      expect(f.states.at(-1)).toMatchObject({ kind: 'disconnected', snapshot: null });
      expect(f.drafts.at(-1)).toBeNull();
      f.connection.reconnect();
      const second = Socket.instances[1]!;
      second.open();
      expect(sent(second)).toMatchObject({
        messageType: 'network.local-context.resume',
        networkScopeId: SCOPE,
        unacknowledgedCommandIds: [],
      });
      expect(JSON.stringify(second.sent)).not.toContain(SUMMARY.name);
      expect(JSON.stringify(f.states.at(-1))).not.toContain(REF.sourceUuid);
      ready(second, form, { ...p, contextId: NEXT_CONTEXT }, ZERO, undefined, capabilities);
      expect(f.states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: form } });
      expect(JSON.stringify(f.states.at(-1))).toContain(SUMMARY.name);
    },
  );
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
    const watch = sent(socket);
    expect(watch['operation']).toBe('WATCH');
    act(() => socket.message(connectedPeer(watch, v)));
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
    // The frame was queued for the retired NET005 watch before the navigation.
    act(() => socket.message(connectedPeer(watch, v, 2)));
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

describe('#174 opt-in browser peer continuation', () => {
  it('keeps NET004 submission usable before there is any peer subscription', async () => {
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
      ready(socket, 'NET-004', batch());
    });
    expect(socket.sent.some((raw) => raw.includes('network.peer-control'))).toBe(false);
    const submit = container.querySelector<HTMLButtonElement>(
      '[data-atlas-action-key="NET-004::CTA::002"]',
    );
    expect(submit).not.toBeNull();
    expect(submit!.closest('fieldset')!.disabled).toBe(false);
    act(() => submit!.click());
    expect(sent(socket)).toMatchObject({
      messageType: 'command.request',
      workflowCommandId: 'UI-CMD-DEVICE-REQUEST-SUBMIT',
    });
  });
  function status(watch: Record<string, unknown>, sequence = 1): CampaignPeerStateV3Message {
    return campaignPeerStateValue({
      messageType: 'network.peer-state',
      protocolVersion: 3,
      subscriptionId: watch['requestId'],
      requestId: watch['requestId'],
      contextId: CONTEXT,
      networkScopeId: SCOPE,
      campaignId: CAMPAIGN,
      deviceId: DEVICE,
      controllerSeat: SEAT,
      sequence,
      revisions: ZERO,
      connectionRevision: 1,
      connectionState: 'CONNECTED',
      statusOrNull: {
        campaignId: CAMPAIGN,
        deviceId: DEVICE,
        campaignRevision: 0,
        campaignStatus: 'PAUSED',
        firstStartCompleted: false,
        pauseReasonOrNull: null,
        disconnectOrNull: null,
      },
      formOrNull: null,
      retryOutcome: 'NONE',
      diagnosticOrNull: null,
    });
  }
  function lost(watch: Record<string, unknown>): CampaignPeerStateV3Message {
    return campaignPeerStateValue({
      ...status(watch),
      connectionState: 'LOST',
      diagnosticOrNull: 'PEER_UNAVAILABLE',
      formOrNull: {
        formId: 'NET-009',
        availableActionKeys: ['NET-009::CTA::001'],
        fields: {
          deviceId: DEVICE,
          sessionId: SESSION,
          activeRole: 'PLAYER',
          requestedSeatOrGm: SEAT,
          reconnectAttemptId: ATTEMPT,
          commandId: ATTEMPT,
          deviceBindingProof: {
            campaignId: CAMPAIGN,
            deviceId: DEVICE,
            requestId: REQUEST,
            submitCommandId: NEXT_CONTEXT,
            technicalSessionId: SESSION,
            controllerSeat: SEAT,
          },
          lastConfirmedStateRevision: 0,
          lastConfirmedProjectionRevision: 0,
          resumeContextHint: 'NET-005',
          pendingCommandIdOrNull: null,
          pendingRequestIdOrNull: REQUEST,
          pinnedCampaignPeerReconnectOrNull: {
            reconnectHostAddress: '127.0.0.1',
            reconnectHostPort: 31770,
            previouslyPinnedHostIdentity: {
              ownerDeviceId: NEXT_CONTEXT,
              keyFingerprintSha256: 'a'.repeat(64),
            },
            lastAuthenticatedEndpoint: 'http://127.0.0.1:31770',
          },
        },
      },
    });
  }

  it('initializes the visible NET009 endpoint after a live disconnect and sends edited controls once', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });
    const onAction = vi.fn(() => ({ ok: true as const }));
    const watch = { requestId: ATTEMPT };
    const render = (state: CampaignPeerStateV3Message) =>
      act(() =>
        root.render(createElement(CampaignPeerConnection, { state, enabled: true, onAction })),
      );
    render(status(watch));
    expect(container.querySelector('input')).toBeNull();
    render(lost(watch));
    const address = container.querySelector<HTMLInputElement>('[name="reconnectHostAddress"]')!;
    const port = container.querySelector<HTMLInputElement>('[name="reconnectHostPort"]')!;
    expect([address.value, port.value]).toEqual(['127.0.0.1', '31770']);
    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    act(() => {
      valueDescriptor.set!.call(address, '127.0.0.2');
      address.dispatchEvent(new Event('input', { bubbles: true }));
      valueDescriptor.set!.call(port, '31771');
      port.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const button = container.querySelector<HTMLButtonElement>('button')!;
    act(() => button.click());
    expect(onAction).toHaveBeenCalledExactlyOnceWith('NET-009::CTA::001', {
      hostAddress: '127.0.0.2',
      hostPort: 31771,
    });
    act(() => button.click());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(container.querySelector('fieldset')!.disabled).toBe(true);
    render({ ...lost(watch), sequence: 2 });
    expect(container.querySelector('fieldset')!.disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('[name="reconnectHostAddress"]')!.value).toBe(
      '127.0.0.2',
    );
    expect(container.querySelector<HTMLInputElement>('[name="reconnectHostPort"]')!.value).toBe(
      '31771',
    );
    expect(container.textContent).toContain('http://127.0.0.1:31770');
  });
  it('opts in after the paired snapshot and sends the actual NET009 endpoint control', async () => {
    const flow = await start('NET-005', waiting(ZERO), { peer: true });
    const watch = sent(flow.socket);
    expect(watch).toMatchObject({
      messageType: 'network.peer-control',
      operation: 'WATCH',
      expectedRevisions: ZERO,
    });
    flow.socket.message(lost(watch));
    expect(flow.peers.at(-1)?.formOrNull?.formId).toBe('NET-009');
    expect(
      flow.connection.requestCampaignPeerAction('NET-009::CTA::001', {
        hostAddress: '127.0.0.2',
        hostPort: 31771,
      }),
    ).toEqual({ ok: true });
    const retry = sent(flow.socket);
    expect(retry).toMatchObject({
      operation: 'RETRY',
      expectedConnectionRevision: 1,
      commandIdOrNull: ATTEMPT,
      endpointOrNull: { hostAddress: '127.0.0.2', hostPort: 31771 },
    });
    flow.socket.message({
      ...status(watch, 2),
      requestId: retry['requestId'],
      connectionState: 'RECONNECTING',
      retryOutcome: 'CONFIRMED',
    });
    expect(Socket.instances).toHaveLength(2);
    const next = Socket.instances[1]!;
    next.open();
    expect(sent(next)['messageType']).toBe('network.local-context.resume');
    ready(next, 'NET-005', waiting(ZERO));
    expect(sent(next)).toMatchObject({
      messageType: 'network.peer-control',
      operation: 'WATCH',
      commandIdOrNull: ATTEMPT,
    });
  });
  it.each([
    'foreign-vector',
    'foreign-request',
    'foreign-seat',
    'foreign-session',
    'unsolicited-confirmation',
  ] as const)('rejects %s before applying peer state', async (change) => {
    const flow = await start('NET-005', waiting(ZERO), { peer: true });
    const message = structuredClone(lost(sent(flow.socket))) as unknown as Record<string, unknown>;
    const form = message['formOrNull'] as { fields: Record<string, unknown> };
    if (change === 'foreign-vector') message['revisions'] = { ...ZERO, projectionRevision: 1 };
    if (change === 'foreign-request') {
      form.fields['pendingRequestIdOrNull'] = NEXT_CONTEXT;
      (form.fields['deviceBindingProof'] as Record<string, unknown>)['requestId'] = NEXT_CONTEXT;
    }
    if (change === 'foreign-seat') message['controllerSeat'] = NEXT_CONTEXT;
    if (change === 'foreign-session') {
      form.fields['sessionId'] = NEXT_CONTEXT;
      (form.fields['deviceBindingProof'] as Record<string, unknown>)['technicalSessionId'] =
        NEXT_CONTEXT;
    }
    if (change === 'unsolicited-confirmation') message['retryOutcome'] = 'CONFIRMED';
    flow.socket.message(message);
    expect(flow.peers.filter((p) => p !== null)).toEqual([]);
    expect(flow.states.at(-1)?.kind).toBe('protocol-error');
  });
});

function connectedPeer(
  watch: Record<string, unknown>,
  revisions: RevisionVector,
  sequence = 1,
): CampaignPeerStateV3Message {
  return campaignPeerStateValue({
    messageType: 'network.peer-state',
    protocolVersion: 3,
    subscriptionId: watch['requestId'],
    requestId: watch['requestId'],
    contextId: CONTEXT,
    networkScopeId: SCOPE,
    campaignId: CAMPAIGN,
    deviceId: DEVICE,
    controllerSeat: SEAT,
    sequence,
    revisions,
    connectionRevision: 1,
    connectionState: 'CONNECTED',
    statusOrNull: {
      campaignId: CAMPAIGN,
      deviceId: DEVICE,
      campaignRevision: 0,
      campaignStatus: 'PAUSED',
      firstStartCompleted: false,
      pauseReasonOrNull: null,
      disconnectOrNull: null,
    },
    formOrNull: null,
    retryOutcome: 'NONE',
    diagnosticOrNull: null,
  });
}

describe('NPC acknowledgement isolation at existing browser connections', () => {
  it.each([
    ['GM', 'network.npc-editor.result'],
    ['GM', 'network.npc-selection.result'],
    ['GM', 'network.npc-editor.refusal'],
    ['GM', 'network.npc-selection.refusal'],
    ['PLAYER', 'network.npc-editor.result'],
    ['PLAYER', 'network.npc-selection.result'],
    ['PLAYER', 'network.npc-editor.refusal'],
    ['PLAYER', 'network.npc-selection.refusal'],
  ] as const)('refuses unsolicited %s %s without adopting a view', async (role, messageType) => {
    const f = role === 'GM' ? await gmStart() : await start('NET-001', discovery());
    const readyCount = f.states.filter((state) => state.kind === 'ready').length;
    const sentCount = f.socket.sent.length;
    const editor = messageType.startsWith('network.npc-editor.');
    const result = messageType.endsWith('.result');
    f.socket.message({
      protocolVersion: 3,
      messageType,
      operationId: REQUEST,
      campaignId: CAMPAIGN,
      projectionRole: 'gm',
      sourceFormId: editor ? 'NPC-002' : 'NPC-001',
      ...(editor ? { npcDraftId: ATTEMPT } : {}),
      ...(result
        ? {
            appliedRevisions: ZERO,
            ...(editor ? { appliedAttemptRevision: 1 } : { npcUuidOrNull: null }),
          }
        : { presentationUnchanged: true, refusal: { code: 'UNAVAILABLE' } }),
    });
    expect(f.states.at(-1)).toMatchObject({ kind: 'protocol-error', refusal: { value: null } });
    expect(f.states.filter((state) => state.kind === 'ready')).toHaveLength(readyCount);
    expect(f.socket.sent).toHaveLength(sentCount + 1);
    expect(JSON.parse(f.socket.sent[sentCount]!) as unknown).toEqual({
      messageType: 'protocol.refusal',
      protocolVersion: 1,
      refusal: { code: 'UNRECOGNIZED', path: '$.messageType', value: null },
      relatedCommandId: null,
    });
    expect(f.socket.readyState).toBe(Socket.CLOSED);
  });
});
