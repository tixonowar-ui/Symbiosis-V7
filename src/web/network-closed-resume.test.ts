// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  JsonObject,
  JsonValue,
  ProjectionSnapshotV2Message,
  RevisionVector,
} from '@shared/index.js';
import { NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS } from '@shared/device-admission.js';
import {
  createCreationFinalizationSetup,
  creationFinalSaveRequest,
  creationPropertySummaryRequest,
} from '../../tests/fixtures/creation-finalization-stage.js';
import { commitCreationFinalization } from '../host/creation-finalization.js';
import {
  deriveLocalFinalExport,
  loadLocalCharacterExportBaseline,
} from '../host/local-character-export.js';
import { connectProjection, type ProjectionConnection, type WebClientState } from './ws-client.js';
import { NETWORK_CONTEXT_STORAGE_KEY } from './forms/net/network-application.js';
import { presentedFormDefinition } from './forms/index.js';

const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCOPE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTEXT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NEW_SCOPE = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ZERO = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const ENTRY = { stateRevision: 1, projectionRevision: 1, actorVisibilityRevision: 0 };
const SHELL = { stateRevision: 40, projectionRevision: 52, actorVisibilityRevision: 0 };
let final: JsonObject;
beforeAll(async () => {
  const prepared = await createCreationFinalizationSetup({
    prefix: 'network-closed-final',
    raceChoice: 'FREE',
    diceInputMode: 'MANUAL',
    characterDraftId: '44444444-4444-4444-8444-444444444444',
  });
  try {
    let current = commitCreationFinalization(
      prepared.setup.database,
      creationPropertySummaryRequest(prepared.current, 'net-summary'),
      'net-summary-receipt',
      prepared.dependencies,
    );
    current = commitCreationFinalization(
      prepared.setup.database,
      creationFinalSaveRequest(current, 'net-save'),
      'net-save-receipt',
      prepared.dependencies,
    );
    const metadata = {
        name: 'Новое имя после выхода',
        description: null,
        artAssetKeyOrLocalFile: null,
      },
      owner = {
        ownerContext: 'PLAYER_LOCAL',
        sourceKind: 'LOCAL_FINAL',
        originFormId: 'CHR-040',
        returnFormId: 'CHR-040',
        activeLocalOwnerIdOrNull: DEVICE,
        masterAuthorityRevisionOrNull: null,
      } as const,
      baseline = await loadLocalCharacterExportBaseline(process.cwd()),
      exported = deriveLocalFinalExport(current, metadata, 3, owner, baseline);
    final = {
      postSaveScopeId: 'own-final-scope',
      sourceBindingHash: 'a'.repeat(64),
      sourceEntityId: current.localCharacter.localCharacterId,
      ...metadata,
      localCharacterUuid: current.localCharacter.localCharacterId,
      finalSnapshotVersion: exported.finalSnapshotVersion,
      finalSaveReceiptId: exported.finalSaveReceiptId,
      mechanicsSnapshot: exported.mechanicsSnapshot,
      creationRandomReceipts: exported.creationRandomReceipts,
      localMetadataRevision: 3,
      candidateSnapshotIds: [],
      campaignCopyIds: [],
      checksum: exported.checksum,
      provenance: exported.provenance,
      commandId: current.receipt.commandId,
    };
  } finally {
    prepared.setup.database.close();
  }
});

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
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
    this.onopen?.call(this as unknown as WebSocket, {} as Event);
  }
  message(value: unknown) {
    this.onmessage?.call(
      this as unknown as WebSocket,
      { data: JSON.stringify(value) } as MessageEvent,
    );
  }
  drop() {
    this.readyState = Socket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, { code: 1006, reason: '' } as CloseEvent);
  }
}
const connections: ProjectionConnection[] = [];
afterEach(() => {
  connections.splice(0).forEach((connection) => connection.disconnect());
  Socket.instances = [];
  vi.unstubAllGlobals();
});
function sent(socket: Socket): Record<string, unknown> {
  return JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>;
}
function snapshot(
  formId: 'CHR-040' | 'CHR-027',
  p: JsonObject,
  v: RevisionVector,
  correlationId: string,
  reason: 'RECONNECT' | 'FORM_ACTION' = 'RECONNECT',
): ProjectionSnapshotV2Message {
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
        routeTemplate: presentedFormDefinition(formId)!.route,
        routeBindings: [
          { parameterIndex: 0, source: 'inherited', value: p['localCharacterUuid'] as string },
        ],
        roleFilteredPayload: p,
        availableActionKeys:
          formId === 'CHR-040'
            ? ['CHR-040::CTA::001', 'CHR-040::CTA::002', 'CHR-040::CTA::003', 'CHR-040::CTA::004']
            : ['CHR-027::CTA::002'],
      },
    },
  };
}
function ready(socket: Socket, form: 'CHR-040' | 'CHR-027', p: JsonObject, v: RevisionVector) {
  const id = sent(socket)['reconnectRequestId'] as string;
  socket.message({
    messageType: 'session.reconnect.capabilities',
    protocolVersion: 2,
    reconnectRequestId: id,
    revisions: v,
    executableWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
  });
  socket.message(snapshot(form, p, v, id));
}
function proposal(v: RevisionVector): JsonObject {
  const provenance = final['provenance'] as JsonObject;
  return {
    ...v,
    networkScopeId: NEW_SCOPE,
    contextId: CONTEXT,
    deviceId: DEVICE,
    controllerSeat: SEAT,
    draftRevision: 0,
    campaignIdOrNull: null,
    connectionState: 'NO_TECHNICAL_SESSION',
    pendingCommandIdOrNull: null,
    localCharacterUuid: final['localCharacterUuid']!,
    finalSnapshotVersion: final['finalSnapshotVersion']!,
    candidateSnapshotChecksum: provenance['sourceChecksum']!,
    eligibleCampaignIds: [],
    selectedCampaignId: null,
    requestedControllerSeat: null,
    sourceUuidAndProvenance: { ...provenance, metadataRevision: 3 },
    submissionStatus: 'DRAFT',
    commandId: null,
  };
}
async function connectToFinal() {
  vi.stubGlobal('window', {
    sessionStorage: new MemoryStorage(),
    location: { href: 'http://localhost:3000/' },
  });
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ deviceId: DEVICE }), { status: 200 })),
    ),
  );
  const states: WebClientState[] = [],
    connection = connectProjection((value) => states.push(value));
  connections.push(connection);
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
  const socket = Socket.instances[0]!;
  socket.open();
  ready(socket, 'CHR-040', final, SHELL);
  expect(states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'CHR-040' } });
  return { connection, socket, states };
}

describe('NET closure recovery to the actual local FINAL', () => {
  it.each(['cold', 'lost navigation', 'live navigation'] as const)(
    'recovers the own final through %s using original source checksum and fresh shell vector',
    async (mode) => {
      const storage = new MemoryStorage();
      storage.setItem(NETWORK_CONTEXT_STORAGE_KEY, SCOPE);
      vi.stubGlobal('window', {
        sessionStorage: storage,
        location: { href: 'http://localhost:3000/' },
      });
      vi.stubGlobal('WebSocket', Socket);
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(new Response(JSON.stringify({ deviceId: DEVICE }), { status: 200 })),
        ),
      );
      const initialVector =
        mode === 'live navigation'
          ? { stateRevision: 4, projectionRevision: 7, actorVisibilityRevision: 0 }
          : ENTRY;
      const provenance = final['provenance'] as JsonObject,
        source: JsonObject = {
          ...initialVector,
          networkScopeId: SCOPE,
          contextId: CONTEXT,
          deviceId: DEVICE,
          controllerSeat: SEAT,
          draftRevision: mode === 'live navigation' ? 2 : 0,
          campaignIdOrNull: mode === 'live navigation' ? CAMPAIGN : null,
          connectionState:
            mode === 'live navigation' ? 'CONNECTED_TECHNICAL' : 'NO_TECHNICAL_SESSION',
          pendingCommandIdOrNull: null,
          localCharacterUuid: final['localCharacterUuid']!,
          finalSnapshotVersion: final['finalSnapshotVersion']!,
          candidateSnapshotChecksum: provenance['sourceChecksum']!,
          eligibleCampaignIds: mode === 'live navigation' ? [CAMPAIGN] : [],
          selectedCampaignId: null,
          requestedControllerSeat: null,
          sourceUuidAndProvenance: { ...provenance, metadataRevision: 2 },
          submissionStatus: 'DRAFT',
          commandId: null,
        },
        states: WebClientState[] = [],
        connection = connectProjection((value) => states.push(value));
      connections.push(connection);
      await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
      let active = Socket.instances[0]!;
      active.open();
      ready(
        active,
        mode === 'cold' ? 'CHR-040' : 'CHR-027',
        mode === 'cold' ? final : source,
        mode === 'cold' ? SHELL : initialVector,
      );
      expect(states.at(-1)).toMatchObject({ kind: 'ready' });
      if (mode !== 'cold') {
        expect(connection.requestFormAction('CHR-027::CTA::002')).toEqual({ ok: true });
        if (mode === 'lost navigation') {
          active.drop();
          connection.reconnect();
          active = Socket.instances[1]!;
          active.open();
          ready(active, 'CHR-040', final, SHELL);
        } else {
          active.message(
            snapshot(
              'CHR-040',
              final,
              SHELL,
              sent(active)['navigationRequestId'] as string,
              'FORM_ACTION',
            ),
          );
        }
      }
      expect(final['checksum']).not.toBe(provenance['sourceChecksum']);
      expect(states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: {
          formId: 'CHR-040',
          revisions: SHELL,
          projection: {
            localCharacterUuid: final['localCharacterUuid'],
            name: 'Новое имя после выхода',
            localMetadataRevision: 3,
            provenance: { sourceChecksum: provenance['sourceChecksum'] },
          },
        },
      });
      expect(JSON.parse(active.sent[0]!) as unknown).toMatchObject({
        messageType: 'network.local-context.resume',
        networkScopeId: SCOPE,
        unacknowledgedCommandIds: [],
      });
      expect(active.sent).toHaveLength(mode === 'live navigation' ? 2 : 1);
      expect(storage.getItem(NETWORK_CONTEXT_STORAGE_KEY)).toBeNull();
      const transportCount = Socket.instances.length;
      expect(connection.requestFormAction('CHR-040::CTA::002')).toEqual({ ok: true });
      expect(Socket.instances).toHaveLength(transportCount);
      const entryVector =
        mode === 'live navigation'
          ? { stateRevision: 6, projectionRevision: 9, actorVisibilityRevision: 0 }
          : ENTRY;
      active.message(
        snapshot(
          'CHR-027',
          {
            ...source,
            ...entryVector,
            networkScopeId: mode === 'live navigation' ? SCOPE : NEW_SCOPE,
            draftRevision: mode === 'live navigation' ? 2 : 0,
            sourceUuidAndProvenance: { ...provenance, metadataRevision: 3 },
          },
          entryVector,
          sent(active)['navigationRequestId'] as string,
          'FORM_ACTION',
        ),
      );
      expect(states.at(-1)).toMatchObject({
        kind: 'ready',
        snapshot: { formId: 'CHR-027', revisions: entryVector },
      });
      expect(storage.getItem(NETWORK_CONTEXT_STORAGE_KEY)).toBe(
        mode === 'live navigation' ? SCOPE : NEW_SCOPE,
      );
    },
  );
  it('accepts the retained original scope while its known connection is LOST', async () => {
    const flow = await connectToFinal();
    expect(flow.connection.requestFormAction('CHR-040::CTA::002')).toEqual({ ok: true });
    const v = { stateRevision: 6, projectionRevision: 9, actorVisibilityRevision: 0 };
    const p = {
      ...proposal(v),
      networkScopeId: SCOPE,
      campaignIdOrNull: CAMPAIGN,
      connectionState: 'LOST',
      draftRevision: 2,
    };
    flow.socket.message(
      snapshot('CHR-027', p, v, sent(flow.socket)['navigationRequestId'] as string, 'FORM_ACTION'),
    );
    expect(flow.states.at(-1)).toMatchObject({
      kind: 'ready',
      snapshot: {
        formId: 'CHR-027',
        revisions: v,
        projection: { networkScopeId: SCOPE, connectionState: 'LOST' },
      },
    });
    expect(window.sessionStorage.getItem(NETWORK_CONTEXT_STORAGE_KEY)).toBe(SCOPE);
  });
  it.each([
    'zero',
    'new presentation only',
    'new nonzero draft',
    'retained equal state and projection',
    'retained without state history',
    'retained unavailable state',
    'foreign source',
    'wrong version',
    'wrong checksum',
    'foreign device',
  ] as const)(
    'refuses a final proposal entry with %s while keeping its source binding',
    async (invalid) => {
      const flow = await connectToFinal();
      expect(flow.connection.requestFormAction('CHR-040::CTA::002')).toEqual({ ok: true });
      const v =
        invalid === 'zero'
          ? ZERO
          : invalid === 'retained equal state and projection'
            ? { stateRevision: 3, projectionRevision: 3, actorVisibilityRevision: 0 }
            : invalid === 'new presentation only' || invalid === 'retained without state history'
              ? { ...ZERO, projectionRevision: 1 }
              : invalid === 'retained unavailable state'
                ? { stateRevision: 3, projectionRevision: 5, actorVisibilityRevision: 0 }
                : ENTRY;
      const p: Record<string, JsonValue> = { ...proposal(v) },
        provenance = p['sourceUuidAndProvenance'] as JsonObject;
      if (invalid.startsWith('retained')) {
        p['campaignIdOrNull'] = CAMPAIGN;
        p['connectionState'] = 'CONNECTED_TECHNICAL';
        p['networkScopeId'] = SCOPE;
      }
      if (invalid === 'new nonzero draft') p['draftRevision'] = 1;
      if (invalid === 'retained unavailable state') p['connectionState'] = 'UNAVAILABLE';
      if (invalid === 'foreign source') {
        p['localCharacterUuid'] = SCOPE;
        p['sourceUuidAndProvenance'] = { ...provenance, sourceUuid: SCOPE };
      } else if (invalid === 'wrong version') {
        const nextVersion = (p['finalSnapshotVersion'] as number) + 1;
        p['finalSnapshotVersion'] = nextVersion;
        p['sourceUuidAndProvenance'] = { ...provenance, finalSnapshotVersion: nextVersion };
      } else if (invalid === 'wrong checksum') {
        p['candidateSnapshotChecksum'] = '0'.repeat(64);
        p['sourceUuidAndProvenance'] = { ...provenance, sourceChecksum: '0'.repeat(64) };
      } else if (invalid === 'foreign device') p['deviceId'] = SEAT;
      flow.socket.message(
        snapshot(
          'CHR-027',
          p,
          v,
          sent(flow.socket)['navigationRequestId'] as string,
          'FORM_ACTION',
        ),
      );
      expect(flow.states.at(-1)).toMatchObject({
        kind: 'protocol-error',
        refusal: { value: null },
      });
    },
  );
});
