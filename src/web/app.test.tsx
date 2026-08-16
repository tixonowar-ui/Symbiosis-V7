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
const APP_001_ACTION_KEYS = [
  'APP-001::CTA::001',
  'APP-001::CTA::002',
  'APP-001::CTA::003',
  'APP-001::CTA::004',
] as const;
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
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint32Array) => {
      values.set([1, 2, 3, 4]);
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

  it('stages capabilities invisibly and atomically renders the matching APP-001 snapshot', async () => {
    const { container, socket } = await connectClient();
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

    const player = requiredElement(
      container.querySelector<HTMLButtonElement>('[data-atlas-action="Игрок"]'),
      'APP-001 player action',
    );
    act(() => {
      player.click();
    });
    expect(container.textContent).toContain('маршрутизация и CTA не входят в issue #36');

    const master = requiredElement(
      container.querySelector<HTMLButtonElement>('[data-atlas-action="Мастер"]'),
      'APP-001 gm action',
    );
    act(() => {
      master.click();
    });
    expect(container.textContent).toContain('Переход «Мастер» не отправлен');
    expect(socket.sent).toHaveLength(1);
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
      expectedPath: '$.presentation.base.availableActionKeys',
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
  ])('rejects $label without committing APP-001', async ({ expectedPath, send }) => {
    const { container, socket } = await connectClient();
    open(socket);

    send(socket);

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
