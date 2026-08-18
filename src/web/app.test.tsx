import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decodeClientMessage,
  decodeClientMessageV2,
  encodeHostMessage,
  encodeHostMessageV2,
  WIRE_PROTOCOL_VERSION,
  WIRE_PROTOCOL_V2_VERSION,
} from '@shared/index.js';
import type {
  HostToClientMessage,
  HostToClientV2Message,
  ProjectionSnapshotV2Message,
  SessionReconnectCapabilitiesV2Message,
} from '@shared/index.js';

import { App } from './app.js';
import { WEB_PROTOCOL_VOCABULARY } from './ws-client.js';
import type { App001Projection } from './ws-client.js';

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const DEVICE_ID = '123e4567-e89b-42d3-a456-426614174000';
const REQUEST_ID = 'reconnect-00000001000000020000000300000004';
const PLAYER_NAVIGATION_REQUEST_ID = 'navigation-00000005000000060000000700000008';
const CHARACTER_NAVIGATION_REQUEST_ID = 'navigation-000000090000000a0000000b0000000c';
const LIBRARY_NAVIGATION_REQUEST_ID = 'navigation-00000015000000160000001700000018';
const MENU_NAVIGATION_REQUEST_ID = 'navigation-000000190000001a0000001b0000001c';
const APP_001_ACTION_KEYS = [
  'APP-001::CTA::001',
  'APP-001::CTA::002',
  'APP-001::CTA::003',
  'APP-001::CTA::004',
] as const;
const CHARACTER_DRAFT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTEXT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WIZARD_CHECKPOINT_ID = 'opaque-wizard-checkpoint';
const REVISIONS = {
  actorVisibilityRevision: 3,
  projectionRevision: 8,
  stateRevision: 5,
} as const;
const HOST_PROJECTION = {
  baselineCompatibility: {
    builtAgainstTuple: { status: 'PASS', value: 'host-tuple-36' },
    catalogVersion: { status: 'PASS', value: 'host-catalog-36' },
    registryVersion: { status: 'PASS', value: 'host-registry-36' },
  },
  bootState: 'READY',
  buildVersion: 'host-build-36',
  formId: 'APP-001',
  integrityStatus: {
    changed: [],
    missing: [],
    ok: true,
    tracked: 36,
    untracked: [],
  },
} as const satisfies App001Projection;
const APP_002_PROJECTION = {
  contextId: CONTEXT_ID,
  deviceId: DEVICE_ID,
  projectionRevision: 9,
  stateRevision: 5,
} as const;
const CHR_001_PROJECTION = {
  age: null,
  anatomyProfile: 'STANDARD_HUMANOID',
  artAssetKeyOrLocalFile: null,
  characterDraftId: CHARACTER_DRAFT_ID,
  commandId: null,
  description: null,
  draftRevision: 0,
  massApprovalStatus: 'PENDING_GM',
  massKg: null,
  name: null,
  wizardCheckpointId: WIZARD_CHECKPOINT_ID,
} as const;
const APP_004_PROJECTION = {
  campaignAuthority: false,
  draftCharacterIds: [],
  finalCharacterIds: [],
  handoffIdOrNull: null,
  handoffReceiptIdOrNull: null,
  launchContext: 'PLAYER_MENU',
  localCharacterLibraryRevision: 0,
  localOwnerIdOrNull: null,
  projectionRevision: 11,
  returnContext: 'PLAYER_MENU',
  stateRevision: 5,
} as const;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readonly closeCalls: {
    readonly code: number | undefined;
    readonly reason: string | undefined;
  }[] = [];
  readonly sent: string[] = [];
  readonly url: string;
  onclose: WebSocket['onclose'] = null;
  onerror: WebSocket['onerror'] = null;
  onmessage: WebSocket['onmessage'] = null;
  onopen: WebSocket['onopen'] = null;
  readyState = FakeWebSocket.CONNECTING;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('fake socket is not open');
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }

  message(data: unknown): void {
    this.onmessage?.call(this as unknown as WebSocket, new MessageEvent('message', { data }));
  }

  serverClose(code: number, reason: string): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close', { code, reason }));
  }
}

interface MountedClient {
  readonly container: HTMLDivElement;
  readonly root: Root;
}

interface ConnectedClient extends MountedClient {
  readonly socket: FakeWebSocket;
}

const mountedClients: MountedClient[] = [];

afterEach(() => {
  for (const mounted of mountedClients.splice(0)) {
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  FakeWebSocket.instances.splice(0);
  vi.unstubAllGlobals();
});

function identityResponse(value: unknown = { deviceId: DEVICE_ID }, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function mountClient(
  response: Promise<Response> = Promise.resolve(identityResponse()),
): MountedClient {
  let entropyCall = 0;
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint32Array) => {
      const offset = entropyCall++ * 4;
      values.set([offset + 1, offset + 2, offset + 3, offset + 4]);
      return values;
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response),
  );
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  const mounted = { container, root };
  mountedClients.push(mounted);
  return mounted;
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function connectClient(
  response: Promise<Response> = Promise.resolve(identityResponse()),
): Promise<ConnectedClient> {
  const mounted = mountClient(response);
  await flushAsyncWork();
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) throw new Error('test setup: App did not create a WebSocket');
  return { ...mounted, socket };
}

function checkedHostTextV1(message: HostToClientMessage): string {
  const encoded = encodeHostMessage(message, WEB_PROTOCOL_VOCABULARY);
  if (!encoded.ok) {
    throw new Error(`test setup: invalid host fixture ${JSON.stringify(encoded.refusal)}`);
  }
  return encoded.text;
}

function checkedHostTextV2(message: HostToClientV2Message): string {
  const encoded = encodeHostMessageV2(message, WEB_PROTOCOL_VOCABULARY);
  if (!encoded.ok) {
    throw new Error(`test setup: invalid host fixture ${JSON.stringify(encoded.refusal)}`);
  }
  return encoded.text;
}

function capabilities(
  overrides: Partial<SessionReconnectCapabilitiesV2Message> = {},
): SessionReconnectCapabilitiesV2Message {
  return {
    executableWorkflowCommandIds: [],
    messageType: 'session.reconnect.capabilities',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    reconnectRequestId: REQUEST_ID,
    revisions: REVISIONS,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<ProjectionSnapshotV2Message> = {},
): ProjectionSnapshotV2Message {
  return {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: { correlationId: REQUEST_ID, reason: 'RECONNECT' },
      base: {
        availableActionKeys: APP_001_ACTION_KEYS,
        formId: 'APP-001',
        formType: 'screen',
        roleFilteredPayload: HOST_PROJECTION,
        routeBindings: [],
        routeTemplate: '/',
      },
      layers: [],
    },
    projectionRole: null,
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions: REVISIONS,
    ...overrides,
  };
}

function navigationSnapshot(
  base: ProjectionSnapshotV2Message['presentation']['base'],
  projectionRevision: number,
  correlationId: string,
  reason: 'FORM_ACTION' | 'RECONNECT' = 'FORM_ACTION',
): ProjectionSnapshotV2Message {
  return {
    messageType: 'projection.snapshot',
    presentation: {
      assignment: { correlationId, reason },
      base,
      layers: [],
    },
    projectionRole: 'player',
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
    revisions: { ...REVISIONS, projectionRevision },
  };
}

const chr001Base = (
  projection: ProjectionSnapshotV2Message['presentation']['base']['roleFilteredPayload'] = CHR_001_PROJECTION,
): ProjectionSnapshotV2Message['presentation']['base'] => ({
  availableActionKeys: ['CHR-001::CTA::002'],
  formId: 'CHR-001',
  formType: 'screen',
  roleFilteredPayload: projection,
  routeBindings: [{ parameterIndex: 0, source: 'executor-allocated', value: CHARACTER_DRAFT_ID }],
  routeTemplate: '/player/characters/:localCharacterId/create/chr-001',
});

function open(socket: FakeWebSocket): void {
  act(() => {
    socket.open();
  });
}

function deliver(socket: FakeWebSocket, data: unknown): void {
  act(() => {
    socket.message(data);
  });
}

function deliverPair(
  socket: FakeWebSocket,
  capabilityMessage: SessionReconnectCapabilitiesV2Message = capabilities(),
  snapshotMessage: ProjectionSnapshotV2Message = snapshot(),
): void {
  deliver(socket, checkedHostTextV2(capabilityMessage));
  deliver(socket, checkedHostTextV2(snapshotMessage));
}

function requiredElement<T extends Element>(value: T | null, label: string): T {
  if (value === null) throw new Error(`test setup: ${label} not found`);
  return value;
}

function enter(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor?.set === undefined) throw new Error('test setup: input value setter not found');
  act(() => {
    descriptor.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function decodedClientMessageV2(socket: FakeWebSocket, index: number) {
  const text = socket.sent[index];
  if (text === undefined) throw new Error(`test setup: client frame ${String(index)} not sent`);
  const decoded = decodeClientMessageV2(text, WEB_PROTOCOL_VOCABULARY);
  if (!decoded.ok) {
    throw new Error(`test setup: invalid client frame ${JSON.stringify(decoded.refusal)}`);
  }
  return decoded.value;
}

function decodedClientMessageV1(socket: FakeWebSocket, index: number) {
  const text = socket.sent[index];
  if (text === undefined) throw new Error(`test setup: client frame ${String(index)} not sent`);
  const decoded = decodeClientMessage(text, WEB_PROTOCOL_VOCABULARY);
  if (!decoded.ok) {
    throw new Error(`test setup: invalid client frame ${JSON.stringify(decoded.refusal)}`);
  }
  return decoded.value;
}

describe('APP-001 web entry', () => {
  it('loads the host identity before opening ws and sends only a checked v2 reconnect', async () => {
    let resolveIdentity: ((response: Response) => void) | undefined;
    const pendingIdentity = new Promise<Response>((resolve) => {
      resolveIdentity = resolve;
    });
    const { container } = mountClient(pendingIdentity);

    expect(container.querySelector('[data-client-state="connecting"]')).not.toBeNull();
    expect(container.querySelector('[data-app-001-data="missing"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(0);

    resolveIdentity?.(identityResponse());
    await flushAsyncWork();
    const socket = FakeWebSocket.instances.at(-1);
    if (socket === undefined) throw new Error('test setup: WebSocket was not created');

    open(socket);

    expect(container.querySelector('[data-client-state="awaiting-snapshot"]')).not.toBeNull();
    expect(socket.sent).toHaveLength(1);
    const reconnect = decodedClientMessageV2(socket, 0);
    expect(reconnect).toEqual({
      deviceId: DEVICE_ID,
      knownRevisions: {
        actorVisibilityRevision: 0,
        projectionRevision: 0,
        stateRevision: 0,
      },
      messageType: 'session.reconnect',
      protocolVersion: WIRE_PROTOCOL_V2_VERSION,
      reconnectRequestId: REQUEST_ID,
      supportedWorkflowCommandIds: [],
      unacknowledgedCommandIds: [],
    });
    expect(decodeClientMessage(socket.sent[0] ?? '', WEB_PROTOCOL_VOCABULARY)).toMatchObject({
      ok: false,
      refusal: { path: '$.protocolVersion', value: WIRE_PROTOCOL_V2_VERSION },
    });
    expect(socket.sent[0]).not.toContain('projection.reconnect');
    expect(fetch).toHaveBeenCalledWith(new URL('/device-identity', window.location.href).href, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    const url = new URL(socket.url);
    expect(url.protocol).toBe(window.location.protocol === 'https:' ? 'wss:' : 'ws:');
    expect(url.host).toBe(window.location.host);
    expect(url.pathname).toBe('/state');
  });

  it('renders the full confirmed APP-001 to APP-002 to CHR-001 to APP-004 to APP-002 path', async () => {
    const connection = await connectClient();
    const { container } = connection;
    let { socket } = connection;
    open(socket);
    deliver(socket, checkedHostTextV2(capabilities()));

    expect(container.querySelector('[data-client-state="awaiting-snapshot"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();

    deliver(socket, checkedHostTextV2(snapshot()));

    expect(container.querySelector('[data-client-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-atlas-action]')).toHaveLength(4);
    expect(container.querySelector('[data-host-field="buildVersion"]')?.textContent).toBe(
      'host-build-36',
    );
    expect(container.querySelector('[data-host-field="bootState"]')?.textContent).toBe('READY');
    expect(
      container.querySelector('[data-host-field="baselineCompatibility"]')?.textContent,
    ).toContain('host-tuple-36');
    expect(container.querySelector('[data-host-field="integrityStatus"]')?.textContent).toContain(
      '"tracked": 36',
    );

    expect(socket.sent).toHaveLength(1);
    const initialUrl = window.location.href;

    const player = requiredElement(
      container.querySelector<HTMLButtonElement>('[data-atlas-action="Игрок"]'),
      'APP-001 player action',
    );
    act(() => {
      player.click();
    });

    expect(container.querySelector('[data-client-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).toBeNull();
    expect(window.location.href).toBe(initialUrl);
    expect(decodedClientMessageV2(socket, 1)).toMatchObject({
      actionKey: 'APP-001::CTA::001',
      expectedProjectionRevision: 8,
      navigationRequestId: PLAYER_NAVIGATION_REQUEST_ID,
      sourceFormId: 'APP-001',
    });

    deliver(
      socket,
      checkedHostTextV2(
        navigationSnapshot(
          {
            availableActionKeys: ['APP-002::CTA::002', 'APP-002::CTA::007'],
            formId: 'APP-002',
            formType: 'screen',
            roleFilteredPayload: APP_002_PROJECTION,
            routeBindings: [],
            routeTemplate: '/player',
          },
          9,
          PLAYER_NAVIGATION_REQUEST_ID,
        ),
      ),
    );

    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-host-field]')).toHaveLength(4);
    expect(window.location.pathname).toBe('/player');

    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Создать персонажа"]'),
        'APP-002 create-character action',
      ).click();
    });

    expect(container.querySelector('[data-client-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-001"]')).toBeNull();
    expect(window.location.pathname).toBe('/player');
    expect(decodedClientMessageV2(socket, 2)).toMatchObject({
      actionKey: 'APP-002::CTA::007',
      expectedProjectionRevision: 9,
      navigationRequestId: CHARACTER_NAVIGATION_REQUEST_ID,
      sourceFormId: 'APP-002',
    });

    deliver(
      socket,
      checkedHostTextV2(navigationSnapshot(chr001Base(), 10, CHARACTER_NAVIGATION_REQUEST_ID)),
    );

    expect(container.querySelector('[data-atlas-form-id="CHR-001"]')).not.toBeNull();
    expect(window.location.pathname).toBe(
      `/player/characters/${CHARACTER_DRAFT_ID}/create/chr-001`,
    );
    expect(container.querySelectorAll('[data-host-field]')).toHaveLength(11);
    expect(container.querySelector('[data-host-field="massKg"]')?.textContent).toContain('null');
    expect(
      container.querySelector('[data-host-field="wizardCheckpointId"]')?.textContent,
    ).toContain(WIZARD_CHECKPOINT_ID);
    expect(container.querySelectorAll('[data-atlas-action]')).toHaveLength(1);
    expect(
      container.querySelector('[data-atlas-action="Сохранить идентичность и продолжить"]'),
    ).toBeNull();

    enter(
      requiredElement(
        container.querySelector<HTMLInputElement>('[data-identity-field="name"]'),
        'CHR-001 name input',
      ),
      ' Alice ',
    );
    const identity = decodedClientMessageV2(socket, 3);
    expect(identity).toMatchObject({
      expectedDraftRevision: 0,
      expectedRevisions: { ...REVISIONS, projectionRevision: 10 },
      messageType: 'character.identity-draft.replace',
      scope: {
        characterDraftId: CHARACTER_DRAFT_ID,
        contextId: CONTEXT_ID,
        sourceFormId: 'CHR-001',
        wizardCheckpointId: WIZARD_CHECKPOINT_ID,
      },
      values: {
        age: null,
        artAssetKeyOrLocalFile: null,
        description: null,
        massKg: null,
        name: ' Alice ',
      },
    });
    if (identity.messageType !== 'character.identity-draft.replace') {
      throw new Error('test setup: identity replacement not sent');
    }
    const identityText = socket.sent[3];
    act(() => socket.serverClose(1006, 'identity result lost'));
    act(() => requiredElement(container.querySelector('button'), 'reconnect action').click());
    socket = FakeWebSocket.instances.at(-1)!;
    open(socket);
    const resumed = decodedClientMessageV2(socket, 0);
    if (resumed.messageType !== 'session.reconnect') throw new Error('missing reconnect request');
    deliverPair(
      socket,
      capabilities({
        reconnectRequestId: resumed.reconnectRequestId,
        revisions: { ...REVISIONS, projectionRevision: 10 },
      }),
      navigationSnapshot(chr001Base(), 10, resumed.reconnectRequestId, 'RECONNECT'),
    );
    expect(socket.sent[1]).toBe(identityText);
    deliver(
      socket,
      checkedHostTextV2({
        draftRevision: 1,
        draftUpdateId: identity.draftUpdateId,
        messageType: 'character.identity-draft.result',
        presentation: {
          base: chr001Base({ ...CHR_001_PROJECTION, draftRevision: 1, name: 'Alice' }),
          layers: [],
        },
        projectionRole: 'player',
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        revisions: { ...REVISIONS, projectionRevision: 11 },
        scope: identity.scope,
      }),
    );
    expect(container.querySelector<HTMLInputElement>('[data-identity-field="name"]')?.value).toBe(
      'Alice',
    );
    expect(container.querySelector('[data-identity-dirty="false"]')).not.toBeNull();

    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Отменить новый черновик"]'),
        'CHR-001 cancel action',
      ).click();
    });

    expect(container.querySelector('[data-atlas-form-id="CHR-001"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-004"]')).toBeNull();
    expect(decodedClientMessageV2(socket, 2)).toMatchObject({
      actionKey: 'CHR-001::CTA::002',
      expectedProjectionRevision: 11,
      navigationRequestId: LIBRARY_NAVIGATION_REQUEST_ID,
      sourceFormId: 'CHR-001',
    });

    deliver(
      socket,
      checkedHostTextV2(
        navigationSnapshot(
          {
            availableActionKeys: ['APP-004::CTA::001', 'APP-004::CTA::007'],
            formId: 'APP-004',
            formType: 'screen',
            roleFilteredPayload: { ...APP_004_PROJECTION, projectionRevision: 12 },
            routeBindings: [],
            routeTemplate: '/player/characters',
          },
          12,
          LIBRARY_NAVIGATION_REQUEST_ID,
        ),
      ),
    );

    expect(container.querySelector('[data-atlas-form-id="APP-004"]')).not.toBeNull();
    expect(window.location.pathname).toBe('/player/characters');
    expect(container.querySelectorAll('[data-host-field]')).toHaveLength(11);
    expect(container.querySelectorAll('[data-atlas-action]')).toHaveLength(2);
    for (const actionKey of [
      'APP-004::CTA::002',
      'APP-004::CTA::003',
      'APP-004::CTA::004',
      'APP-004::CTA::005',
      'APP-004::CTA::006',
      'APP-004::CTA::008',
    ]) {
      expect(container.querySelector(`[data-atlas-action-key="${actionKey}"]`)).toBeNull();
    }

    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>(
          '[data-atlas-action="Вернуться в главное меню игрока"]',
        ),
        'APP-004 return action',
      ).click();
    });

    expect(container.querySelector('[data-atlas-form-id="APP-004"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).toBeNull();
    expect(decodedClientMessageV2(socket, 3)).toMatchObject({
      actionKey: 'APP-004::CTA::007',
      expectedProjectionRevision: 12,
      navigationRequestId: MENU_NAVIGATION_REQUEST_ID,
      sourceFormId: 'APP-004',
    });

    deliver(
      socket,
      checkedHostTextV2(
        navigationSnapshot(
          {
            availableActionKeys: ['APP-002::CTA::002', 'APP-002::CTA::007'],
            formId: 'APP-002',
            formType: 'screen',
            roleFilteredPayload: { ...APP_002_PROJECTION, projectionRevision: 13 },
            routeBindings: [],
            routeTemplate: '/player',
          },
          13,
          MENU_NAVIGATION_REQUEST_ID,
        ),
      ),
    );

    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).not.toBeNull();
    expect(window.location.pathname).toBe('/player');
  });

  it('rejects a whitespace-only wizard checkpoint identity before caching CHR-001', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliverPair(socket);
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Игрок"]'),
        'APP-001 player action',
      ).click();
    });
    deliver(
      socket,
      checkedHostTextV2(
        navigationSnapshot(
          {
            availableActionKeys: ['APP-002::CTA::007'],
            formId: 'APP-002',
            formType: 'screen',
            roleFilteredPayload: APP_002_PROJECTION,
            routeBindings: [],
            routeTemplate: '/player',
          },
          9,
          PLAYER_NAVIGATION_REQUEST_ID,
        ),
      ),
    );
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Создать персонажа"]'),
        'APP-002 create-character action',
      ).click();
    });
    deliver(
      socket,
      checkedHostTextV2(
        navigationSnapshot(
          {
            availableActionKeys: [],
            formId: 'CHR-001',
            formType: 'screen',
            roleFilteredPayload: { ...CHR_001_PROJECTION, wizardCheckpointId: '   ' },
            routeBindings: [
              { parameterIndex: 0, source: 'executor-allocated', value: CHARACTER_DRAFT_ID },
            ],
            routeTemplate: '/player/characters/:localCharacterId/create/chr-001',
          },
          10,
          CHARACTER_NAVIGATION_REQUEST_ID,
        ),
      ),
    );

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="CHR-001"]')).toBeNull();
    expect(decodedClientMessageV1(socket, 3)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: {
        code: 'UNRECOGNIZED',
        path: '$.presentation.base.roleFilteredPayload.wizardCheckpointId',
        value: '   ',
      },
    });
  });

  it('keeps the prior presentation after a matching navigation refusal', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliverPair(socket);
    const confirmedUrl = window.location.href;
    act(() => {
      requiredElement(
        container.querySelector<HTMLButtonElement>('[data-atlas-action="Игрок"]'),
        'APP-001 player action',
      ).click();
    });

    deliver(
      socket,
      checkedHostTextV2({
        messageType: 'navigation.form-action.refusal',
        navigationRequestId: PLAYER_NAVIGATION_REQUEST_ID,
        presentationUnchanged: true,
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        revisions: REVISIONS,
      }),
    );

    expect(container.querySelector('[data-client-state="navigation-refusal"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-002"]')).toBeNull();
    expect(window.location.href).toBe(confirmedUrl);
    expect(container.textContent).toContain('NAVIGATION_UNAVAILABLE');
  });

  it('rejects missing or malformed host fields without rendering a fallback', async () => {
    const { bootState: _bootState, ...missingBootState } = HOST_PROJECTION;
    const scenarios = [
      {
        projection: missingBootState,
        refusalPath: '$.presentation.base.roleFilteredPayload.bootState',
      },
      {
        projection: { ...HOST_PROJECTION, baselineCompatibility: {} },
        refusalPath:
          '$.presentation.base.roleFilteredPayload.baselineCompatibility.builtAgainstTuple',
      },
      {
        projection: { ...HOST_PROJECTION, integrityStatus: {} },
        refusalPath: '$.presentation.base.roleFilteredPayload.integrityStatus.changed',
      },
    ] as const;

    for (const scenario of scenarios) {
      const { container, socket } = await connectClient();
      open(socket);
      deliver(socket, checkedHostTextV2(capabilities()));
      deliver(
        socket,
        checkedHostTextV2(
          snapshot({
            presentation: {
              ...snapshot().presentation,
              base: {
                ...snapshot().presentation.base,
                roleFilteredPayload: scenario.projection,
              },
            },
          }),
        ),
      );

      expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
      expect(container.querySelector('[data-host-field="bootState"]')).toBeNull();
      expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();
      expect(decodedClientMessageV1(socket, 1)).toMatchObject({
        messageType: 'protocol.refusal',
        refusal: {
          code: 'INVALID_SHAPE',
          path: scenario.refusalPath,
        },
      });
    }
  });

  it('shows a checked v1 host refusal as a state distinct from disconnect', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    const refusal = {
      messageType: 'protocol.refusal',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      refusal: { code: 'UNRECOGNIZED', path: '$.projectionRole', value: 'gm' },
      relatedCommandId: null,
    } as const satisfies HostToClientMessage;

    deliver(socket, checkedHostTextV1(refusal));

    expect(container.querySelector('[data-client-state="host-refusal"]')).not.toBeNull();
    expect(container.querySelector('[data-client-state="disconnected"]')).toBeNull();
    expect(container.textContent).toContain('UNRECOGNIZED');
    expect(socket.sent).toHaveLength(1);
    expect(socket.closeCalls).toContainEqual({ code: 1002, reason: 'wire frame refused' });
  });

  it('keeps the confirmed snapshot read-only after a connection loss', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliverPair(socket);

    act(() => {
      socket.serverClose(1006, 'LAN link lost');
    });

    expect(container.querySelector('[data-client-state="disconnected"]')).not.toBeNull();
    expect(container.textContent).toContain('Последняя подтверждённая проекция');
    expect(container.querySelector('[data-host-field="buildVersion"]')?.textContent).toBe(
      'host-build-36',
    );
    const fieldset = requiredElement(container.querySelector('fieldset'), 'read-only fieldset');
    expect(fieldset.hasAttribute('disabled')).toBe(true);
    const buttons = [...fieldset.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.matches(':disabled'))).toBe(true);
  });

  it('refuses malformed text and preserves a prior snapshot read-only', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliverPair(socket);

    deliver(socket, '{');

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(container.querySelector('[data-host-field="buildVersion"]')?.textContent).toBe(
      'host-build-36',
    );
    expect(container.querySelector('fieldset')?.hasAttribute('disabled')).toBe(true);
    expect(decodedClientMessageV1(socket, 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { code: 'MALFORMED_JSON', path: '$' },
    });
  });

  it('refuses a binary frame instead of coercing it to text', async () => {
    const { container, socket } = await connectClient();
    open(socket);

    deliver(socket, new Uint8Array([1, 2, 3]));

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(decodedClientMessageV1(socket, 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: {
        code: 'INVALID_SHAPE',
        expected: 'text application frame',
        path: '$',
      },
    });
  });

  it.each([
    {
      expectedPath: '$.messageType',
      label: 'extra capability frame',
      send: (socket: FakeWebSocket) => {
        deliver(socket, checkedHostTextV2(capabilities()));
        deliver(socket, checkedHostTextV2(capabilities()));
      },
    },
    {
      expectedPath: '$.messageType',
      label: 'intervening v1 frame',
      send: (socket: FakeWebSocket) => {
        deliver(socket, checkedHostTextV2(capabilities()));
        deliver(
          socket,
          checkedHostTextV1({
            messageType: 'protocol.refusal',
            protocolVersion: WIRE_PROTOCOL_VERSION,
            refusal: { code: 'UNRECOGNIZED', path: '$.deviceId', value: 'stale' },
            relatedCommandId: null,
          }),
        );
      },
    },
    {
      expectedPath: '$.messageType',
      label: 'v2 frame before capabilities',
      send: (socket: FakeWebSocket) => {
        deliver(
          socket,
          checkedHostTextV2({
            messageType: 'navigation.form-action.refusal',
            navigationRequestId: 'intervening-navigation',
            presentationUnchanged: true,
            protocolVersion: WIRE_PROTOCOL_V2_VERSION,
            refusal: { code: 'NAVIGATION_UNAVAILABLE' },
            revisions: REVISIONS,
          }),
        );
      },
    },
    {
      expectedPath: '$.presentation.assignment.correlationId',
      label: 'correlation mismatch',
      send: (socket: FakeWebSocket) => {
        const value = snapshot();
        deliverPair(socket, capabilities(), {
          ...value,
          presentation: {
            ...value.presentation,
            assignment: { correlationId: 'another-request', reason: 'RECONNECT' },
          },
        });
      },
    },
    {
      expectedPath: '$.presentation.assignment.reason',
      label: 'foreign assignment reason',
      send: (socket: FakeWebSocket) => {
        const value = snapshot();
        deliverPair(socket, capabilities(), {
          ...value,
          presentation: {
            ...value.presentation,
            assignment: { correlationId: REQUEST_ID, reason: 'FORM_ACTION' },
          },
        });
      },
    },
    {
      expectedPath: '$.revisions',
      label: 'revision mismatch',
      send: (socket: FakeWebSocket) => {
        deliverPair(socket, capabilities(), {
          ...snapshot(),
          revisions: { ...REVISIONS, projectionRevision: REVISIONS.projectionRevision + 1 },
        });
      },
    },
    {
      expectedPath: '$.messageType',
      label: 'missing capability frame',
      send: (socket: FakeWebSocket) => deliver(socket, checkedHostTextV2(snapshot())),
    },
    {
      expectedPath: '$.projectionRole',
      label: 'non-null bootstrap role',
      send: (socket: FakeWebSocket) =>
        deliverPair(socket, capabilities(), { ...snapshot(), projectionRole: 'gm' }),
    },
    {
      expectedPath: null,
      label: 'read-only CHR-001 without a retained player context',
      send: (socket: FakeWebSocket) => {
        const value = snapshot();
        deliverPair(socket, capabilities(), {
          ...value,
          presentation: {
            ...value.presentation,
            base: chr001Base(),
          },
          projectionRole: 'player',
        });
      },
    },
    {
      expectedPath: null,
      label: 'partial action set',
      send: (socket: FakeWebSocket) => {
        const value = snapshot();
        deliverPair(socket, capabilities(), {
          ...value,
          presentation: {
            ...value.presentation,
            base: { ...value.presentation.base, availableActionKeys: APP_001_ACTION_KEYS.slice(1) },
          },
        });
      },
    },
  ])('handles $label fail closed or as negative space', async ({ expectedPath, label, send }) => {
    const { container, socket } = await connectClient();
    open(socket);

    send(socket);

    if (expectedPath === null) {
      expect(container.querySelector('[data-client-state="ready"]')).not.toBeNull();
      expect(container.querySelectorAll('[data-atlas-action]')).toHaveLength(
        label.startsWith('read-only') ? 1 : 3,
      );
      return;
    }
    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();
    expect(decodedClientMessageV1(socket, 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { code: 'UNRECOGNIZED', path: expectedPath },
    });
  });

  it.each([
    ['missing deviceId', Promise.resolve(identityResponse({}))],
    [
      'uppercase deviceId',
      Promise.resolve(identityResponse({ deviceId: DEVICE_ID.toUpperCase() })),
    ],
    ['malformed deviceId', Promise.resolve(identityResponse({ deviceId: 'not-a-uuid' }))],
    [
      'non-success HTTP response',
      Promise.resolve(
        identityResponse({ error: 'device identity unavailable: not initialized' }, 503),
      ),
    ],
    ['malformed JSON response', Promise.resolve(new Response('{', { status: 200 }))],
  ])('blocks the session on %s without generating a substitute', async (_label, response) => {
    const { container } = mountClient(response);
    await flushAsyncWork();

    expect(container.querySelector('[data-client-state="client-error"]')).not.toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(container.textContent).toMatch(/device identity|JSON/u);
    if (_label === 'non-success HTTP response') {
      expect(container.textContent).toContain('device identity unavailable: not initialized');
    }
  });

  it('discards staged capabilities when the socket closes before the snapshot', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliver(socket, checkedHostTextV2(capabilities()));

    act(() => socket.serverClose(1006, 'pair interrupted'));

    expect(container.querySelector('[data-client-state="disconnected"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();
  });

  it('keeps a committed snapshot read-only when an extra capability arrives', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    deliverPair(socket);
    deliver(socket, checkedHostTextV2(capabilities()));

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(container.querySelector('[data-host-field="buildVersion"]')?.textContent).toBe(
      'host-build-36',
    );
    expect(container.querySelector('fieldset')?.hasAttribute('disabled')).toBe(true);
  });

  it('refuses a decoded v1 host message that the reconnect did not request', async () => {
    const { container, socket } = await connectClient();
    open(socket);
    const unexpected = {
      messageType: 'read.result',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: 'unexpected-read',
      result: {},
      revisions: REVISIONS,
    } as const satisfies HostToClientMessage;

    deliver(socket, checkedHostTextV1(unexpected));

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(decodedClientMessageV1(socket, 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { code: 'UNRECOGNIZED', path: '$.messageType', value: 'read.result' },
    });
  });
});
