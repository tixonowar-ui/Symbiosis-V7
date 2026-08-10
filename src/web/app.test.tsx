import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeClientMessage, encodeHostMessage, WIRE_PROTOCOL_VERSION } from '@shared/index.js';
import type { HostToClientMessage, ProjectionSnapshotMessage } from '@shared/index.js';

import { App } from './app.js';
import { WEB_PROTOCOL_VOCABULARY } from './ws-client.js';
import type { App001Projection } from './ws-client.js';

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const REQUEST_ID = 'projection-00000001000000020000000300000004';
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

function mountClient(): MountedClient {
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint32Array) => {
      values.set([1, 2, 3, 4]);
      return values;
    },
  });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) throw new Error('test setup: App did not create a WebSocket');
  const mounted = { container, root, socket };
  mountedClients.push(mounted);
  return mounted;
}

function checkedHostText(message: HostToClientMessage): string {
  const encoded = encodeHostMessage(message, WEB_PROTOCOL_VOCABULARY);
  if (!encoded.ok) {
    throw new Error(`test setup: invalid host fixture ${JSON.stringify(encoded.refusal)}`);
  }
  return encoded.text;
}

function snapshot(overrides: Partial<ProjectionSnapshotMessage> = {}): ProjectionSnapshotMessage {
  return {
    executableWorkflowCommandIds: [],
    messageType: 'projection.snapshot',
    projection: HOST_PROJECTION,
    projectionRole: 'player',
    protocolVersion: WIRE_PROTOCOL_VERSION,
    requestId: REQUEST_ID,
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

function requiredElement<T extends Element>(value: T | null, label: string): T {
  if (value === null) throw new Error(`test setup: ${label} not found`);
  return value;
}

function decodedClientMessage(socket: FakeWebSocket, index: number) {
  const text = socket.sent[index];
  if (text === undefined) throw new Error(`test setup: client frame ${String(index)} not sent`);
  const decoded = decodeClientMessage(text, WEB_PROTOCOL_VOCABULARY);
  if (!decoded.ok) {
    throw new Error(`test setup: invalid client frame ${JSON.stringify(decoded.refusal)}`);
  }
  return decoded.value;
}

describe('APP-001 web entry', () => {
  it('mounts an explicit waiting state and sends a checked player reconnect', () => {
    const { container, socket } = mountClient();

    expect(container.querySelector('[data-client-state="connecting"]')).not.toBeNull();
    expect(container.querySelector('[data-app-001-data="missing"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();

    open(socket);

    expect(container.querySelector('[data-client-state="awaiting-snapshot"]')).not.toBeNull();
    expect(socket.sent).toHaveLength(1);
    const reconnect = decodedClientMessage(socket, 0);
    expect(reconnect).toEqual({
      knownRevisions: {
        actorVisibilityRevision: 0,
        projectionRevision: 0,
        stateRevision: 0,
      },
      messageType: 'projection.reconnect',
      projectionRole: 'player',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: REQUEST_ID,
      supportedWorkflowCommandIds: [],
      unacknowledgedCommandIds: [],
    });
    const url = new URL(socket.url);
    expect(url.protocol).toBe(window.location.protocol === 'https:' ? 'wss:' : 'ws:');
    expect(url.host).toBe(window.location.host);
    expect(url.pathname).toBe('/state');
  });

  it('renders APP-001 with all four exact host fields and sends no CTA command', () => {
    const { container, socket } = mountClient();
    open(socket);
    deliver(socket, checkedHostText(snapshot()));

    expect(container.querySelector('[data-client-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).not.toBeNull();
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

  it('rejects missing or malformed host fields without rendering a fallback', () => {
    const { bootState: _bootState, ...missingBootState } = HOST_PROJECTION;
    const scenarios = [
      { projection: missingBootState, refusalPath: '$.projection.bootState' },
      {
        projection: { ...HOST_PROJECTION, baselineCompatibility: {} },
        refusalPath: '$.projection.baselineCompatibility.builtAgainstTuple',
      },
      {
        projection: { ...HOST_PROJECTION, integrityStatus: {} },
        refusalPath: '$.projection.integrityStatus.changed',
      },
    ] as const;

    for (const scenario of scenarios) {
      const { container, socket } = mountClient();
      open(socket);
      deliver(socket, checkedHostText(snapshot({ projection: scenario.projection })));

      expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
      expect(container.querySelector('[data-host-field="bootState"]')).toBeNull();
      expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();
      expect(decodedClientMessage(socket, 1)).toMatchObject({
        messageType: 'protocol.refusal',
        refusal: {
          code: 'INVALID_SHAPE',
          path: scenario.refusalPath,
        },
      });
    }
  });

  it('shows a checked host refusal as a state distinct from disconnect', () => {
    const { container, socket } = mountClient();
    open(socket);
    const refusal = {
      messageType: 'protocol.refusal',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      refusal: { code: 'UNRECOGNIZED', path: '$.projectionRole', value: 'gm' },
      relatedCommandId: null,
    } as const satisfies HostToClientMessage;

    deliver(socket, checkedHostText(refusal));

    expect(container.querySelector('[data-client-state="host-refusal"]')).not.toBeNull();
    expect(container.querySelector('[data-client-state="disconnected"]')).toBeNull();
    expect(container.textContent).toContain('UNRECOGNIZED');
    expect(socket.sent).toHaveLength(1);
    expect(socket.closeCalls).toContainEqual({ code: 1002, reason: 'wire v1 frame refused' });
  });

  it('keeps the confirmed snapshot read-only after a connection loss', () => {
    const { container, socket } = mountClient();
    open(socket);
    deliver(socket, checkedHostText(snapshot()));

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

  it('refuses malformed text and preserves a prior snapshot read-only', () => {
    const { container, socket } = mountClient();
    open(socket);
    deliver(socket, checkedHostText(snapshot()));

    deliver(socket, '{');

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(container.querySelector('[data-host-field="buildVersion"]')?.textContent).toBe(
      'host-build-36',
    );
    expect(container.querySelector('fieldset')?.hasAttribute('disabled')).toBe(true);
    expect(decodedClientMessage(socket, 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { code: 'MALFORMED_JSON', path: '$' },
    });
  });

  it('refuses a binary frame instead of coercing it to text', () => {
    const { container, socket } = mountClient();
    open(socket);

    deliver(socket, new Uint8Array([1, 2, 3]));

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(decodedClientMessage(socket, 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: {
        code: 'INVALID_SHAPE',
        expected: 'text application frame',
        path: '$',
      },
    });
  });

  it.each([
    ['request correlation', { requestId: 'another-request' }, '$.requestId'],
    ['server-issued role', { projectionRole: 'gm' as const }, '$.projectionRole'],
  ])('rejects a snapshot with the wrong %s', (_label, overrides, expectedPath) => {
    const { container, socket } = mountClient();
    open(socket);

    deliver(socket, checkedHostText(snapshot(overrides)));

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(container.querySelector('[data-atlas-form-id="APP-001"]')).toBeNull();
    expect(decodedClientMessage(socket, 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { code: 'UNRECOGNIZED', path: expectedPath },
    });
  });

  it('refuses a decoded host message that the entry point did not request', () => {
    const { container, socket } = mountClient();
    open(socket);
    const unexpected = {
      messageType: 'read.result',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      requestId: 'unexpected-read',
      result: {},
      revisions: REVISIONS,
    } as const satisfies HostToClientMessage;

    deliver(socket, checkedHostText(unexpected));

    expect(container.querySelector('[data-client-state="protocol-error"]')).not.toBeNull();
    expect(decodedClientMessage(socket, 1)).toMatchObject({
      messageType: 'protocol.refusal',
      refusal: { code: 'UNRECOGNIZED', path: '$.messageType', value: 'read.result' },
    });
  });
});
