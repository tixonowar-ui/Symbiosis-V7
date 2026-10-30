import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import { campaignQrMatrix } from '../cmp/campaign-qr.js';
import {
  NetworkFields,
  type NetworkFieldsProps,
  NetworkGmRequestFields,
  type NetworkGmRequestFieldsProps,
} from './network-fields.js';
import {
  decodeNetworkQrPixels,
  NetworkQrError,
  readNetworkQrFile,
  NETWORK_QR_MAX_FILE_BYTES,
} from './network-qr.js';
import type { NetworkEdit } from './network-application.js';
import type { Net017Projection } from '@shared/network-application.js';

const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCOPE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTEXT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CAMPAIGN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SESSION = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const common = {
  networkScopeId: SCOPE,
  contextId: CONTEXT,
  deviceId: DEVICE,
  controllerSeat: SEAT,
  stateRevision: 0,
  projectionRevision: 0,
  actorVisibilityRevision: 0,
  draftRevision: 0,
  campaignIdOrNull: null,
  connectionState: 'NO_TECHNICAL_SESSION',
  pendingCommandIdOrNull: null,
};
const address = `http://192.168.1.20:3000/?campaignId=${CAMPAIGN}`;
const addressProjection: JsonObject = {
  ...common,
  addressOrQrPayload: '',
  parsedHost: null,
  parsedPort: null,
  protocolVersion: 3,
  campaignHintOrNull: null,
  parseStatus: 'EMPTY',
  parseDiagnostic: null,
  attemptId: ATTEMPT,
  commandId: null,
};
const summary = (index: number) => ({
  sourceUuid: `source-v8-${index}`,
  finalSnapshotVersion: 7,
  metadataRevision: 2,
  candidateSnapshotChecksum: '1'.repeat(64),
  requestedControllerSeat: SEAT,
  name: `Персонаж ${index}`,
  sourceSnapshotId: `snapshot-v8-${index}`,
});
const ref = (index: number) => {
  const { name: _name, sourceSnapshotId: _snapshot, ...candidate } = summary(index);
  return candidate;
};
const bound = { ...common, campaignIdOrNull: CAMPAIGN, connectionState: 'CONNECTED_TECHNICAL' };
const roots: { root: Root; container: HTMLDivElement }[] = [];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
afterEach(() => {
  for (const entry of roots.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(props: Partial<NetworkFieldsProps> = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  const full: NetworkFieldsProps = {
    formId: 'NET-002',
    projection: addressProjection,
    state: null,
    onChange: vi.fn(),
    cancelReason: '',
    onCancelReasonChange: vi.fn(),
    onBusy: vi.fn(),
    ...props,
  };
  act(() => root.render(<NetworkFields {...full} />));
  return {
    root,
    container,
    props: full,
    rerender: (next: Partial<NetworkFieldsProps>) =>
      act(() => root.render(<NetworkFields {...full} {...next} />)),
  };
}
function pixels(value: string) {
  const matrix = campaignQrMatrix(value),
    scale = 4,
    side = (matrix.length + 8) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy += 1)
        for (let dx = 0; dx < scale; dx += 1) {
          const offset = 4 * (((y + 4) * scale + dy) * side + (x + 4) * scale + dx);
          data[offset] = data[offset + 1] = data[offset + 2] = 0;
        }
    }),
  );
  return { data, side };
}

describe('NET form inputs supplement the Atlas actions', () => {
  it('explains recovery of a known session without creating another connection action', () => {
    const known: JsonObject = {
      ...common,
      campaignIdOrNull: CAMPAIGN,
      connectionState: 'UNAVAILABLE',
      attemptId: ATTEMPT,
      retryAttemptIdOrNull: null,
      activeRole: 'PLAYER',
      activeSeatOrGm: SEAT,
      lastAddressOrQrPayload: address,
      lastParsedHostPort: {
        hostAddress: '192.168.1.20',
        hostPort: 3000,
        campaignHintOrNull: CAMPAIGN,
      },
      errorCode: 'PEER_UNAVAILABLE',
      humanDiagnostic: 'Не удалось связаться с сервером.',
      retryCount: 1,
      lastConfirmedStateRevision: 0,
      lastConfirmedProjectionRevision: 0,
      resumeContextOrNull: null,
      localDataUntouched: true,
      commandId: null,
    };
    const shown = mount({ formId: 'NET-011', projection: known });
    expect(shown.container.textContent).toContain('Обновите страницу, чтобы восстановить его.');
    expect(shown.container.querySelector('button,a,form,iframe')).toBeNull();
    expect(shown.props.onChange).not.toHaveBeenCalled();
    shown.rerender({
      projection: { ...known, pendingCommandIdOrNull: REQUEST, errorCode: 'UNCONFIRMED_OUTCOME' },
    });
    expect(shown.container.textContent).not.toContain('Обновите страницу');
  });
  it('keeps NET-002 controlled address input separate from OPEN and never creates an external link', () => {
    const originalOrigin = window.location.origin;
    const shown = mount();
    const input = shown.container.querySelector<HTMLInputElement>(
      'input[aria-label="Адрес или содержимое QR"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        address,
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(shown.props.onChange).toHaveBeenLastCalledWith({
      variant: 'ADDRESS',
      values: { addressOrQrPayload: address },
    });
    expect(shown.container.querySelector('a,iframe,form,button')).toBeNull();
    expect(window.location.origin).toBe(originalOrigin);
  });
  it('permits three candidates on the same real lane and disables a fourth without deleting selected refs', () => {
    const projection: JsonObject = {
      ...bound,
      campaignId: CAMPAIGN,
      campaignStatus: 'PAUSED',
      sessionId: SESSION,
      connectionRevision: 0,
      eligibleFinalCandidates: [1, 2, 3, 4].map(summary),
      selectedCandidates: [ref(1), ref(2)],
      ownRequestIdOrNull: null,
      capacityForecast: {
        campaignRevision: 0,
        activePlayerCapacity: 5,
        activePcCount: 1,
        selectedCandidateCount: 2,
        fitsCurrentCapacity: true,
      },
    };
    const shown = mount({ formId: 'NET-003', projection });
    const boxes = [...shown.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    act(() => boxes[2]!.click());
    const edit: NetworkEdit = {
      variant: 'SELECTION',
      values: { selectedCandidates: [ref(1), ref(2), ref(3)] },
    };
    expect(shown.props.onChange).toHaveBeenLastCalledWith(edit);
    shown.rerender({ state: { values: edit, dirty: true, pending: false, lastRefusal: null } });
    expect(boxes[3]!.disabled).toBe(true);
    const calls = vi.mocked(shown.props.onChange).mock.calls.length;
    act(() => boxes[3]!.click());
    expect(vi.mocked(shown.props.onChange).mock.calls).toHaveLength(calls);
    act(() => boxes[0]!.click());
    expect(shown.props.onChange).toHaveBeenLastCalledWith({
      variant: 'SELECTION',
      values: { selectedCandidates: [ref(2), ref(3)] },
    });
    expect(shown.container.textContent).toContain('Заявка не резервирует место');
  });
  it('edits NET-005 cancellation reason without submitting a cancellation', () => {
    const projection: JsonObject = {
      ...bound,
      sessionId: SESSION,
      requestId: REQUEST,
      requestOwnerDeviceId: DEVICE,
      batchCharacterSummaries: [summary(1)],
      requestStatus: 'PENDING',
      gmMessage: null,
      requestRevision: 0,
      cancelReason: '',
      commandId: null,
    };
    const shown = mount({ formId: 'NET-005', projection });
    const input = shown.container.querySelector<HTMLTextAreaElement>('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        'Передумал',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(shown.props.onCancelReasonChange).toHaveBeenCalledWith('Передумал');
    expect(shown.props.onChange).not.toHaveBeenCalled();
    expect(shown.container.querySelector('button')).toBeNull();
    expect(shown.container.textContent).toContain('сохраняет исходные локальные листы');
    expect(shown.container.innerHTML).not.toMatch(
      /canonicalWitnessText|privateKey|gmQueue|CORE-\d/u,
    );
  });
  it('does not open a QR picker on mount and opens it only after the source action sequence changes', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    const shown = mount({ qrScanSequence: 3 });
    expect(click).not.toHaveBeenCalled();
    shown.rerender({ qrScanSequence: 4 });
    expect(click).toHaveBeenCalledTimes(1);
    expect(shown.props.onChange).not.toHaveBeenCalled();
  });
  it('decodes actual QR pixels through the image picker and only replaces the address draft', async () => {
    const image = pixels(address),
      close = vi.fn(),
      fetch = vi.fn();
    const bitmap = { width: image.side, height: image.side, close };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(bitmap)),
    );
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          drawImage: vi.fn(),
          getImageData: () => ({ data: image.data }),
        }) as unknown as CanvasRenderingContext2D,
    );
    let delivered!: () => void;
    const decoded = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    const change = vi.fn(() => delivered());
    const shown = mount({ onChange: change });
    const input = shown.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      'private-local-name.png',
      { type: 'image/png' },
    );
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await decoded;
    });
    expect(change).toHaveBeenCalledExactlyOnceWith({
      variant: 'ADDRESS',
      values: { addressOrQrPayload: address },
    });
    expect(shown.props.onBusy).toHaveBeenNthCalledWith(1, true);
    expect(shown.props.onBusy).toHaveBeenLastCalledWith(false);
    expect(close).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(input.value).toBe('');
    expect(shown.container.innerHTML).not.toContain('private-local-name');
  });
  it('releases its busy state on unmount and discards a late decoded QR', async () => {
    const image = pixels(address),
      close = vi.fn();
    let bitmapReady!: (value: { width: number; height: number; close: () => void }) => void;
    let started!: () => void;
    const decoding = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => {
        started();
        return new Promise((resolve) => {
          bitmapReady = resolve;
        });
      }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          drawImage: vi.fn(),
          getImageData: () => ({ data: image.data }),
        }) as unknown as CanvasRenderingContext2D,
    );
    const shown = mount();
    const input = shown.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([0xff, 0xd8, 0xff])], 'qr.jpg', { type: 'image/jpeg' })],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await decoding;
    });
    act(() => shown.root.unmount());
    roots.splice(
      roots.findIndex((item) => item.root === shown.root),
      1,
    );
    await act(async () => {
      bitmapReady({ width: image.side, height: image.side, close });
      await Promise.resolve();
    });
    expect(shown.props.onChange).not.toHaveBeenCalled();
    expect(shown.props.onBusy).toHaveBeenNthCalledWith(1, true);
    expect(shown.props.onBusy).toHaveBeenNthCalledWith(2, false);
    expect(shown.props.onBusy).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
    shown.container.remove();
  });
});

describe('NET-002 offline QR decoder', () => {
  it('decodes the real CMP-006 public QR while refusing blank or dimension-mismatched pixels', () => {
    const image = pixels(address);
    expect(decodeNetworkQrPixels(image.data, image.side, image.side)).toBe(address);
    expect(() => decodeNetworkQrPixels(new Uint8ClampedArray(16).fill(255), 2, 2)).toThrow(
      new NetworkQrError('QR_NOT_FOUND'),
    );
    expect(() => decodeNetworkQrPixels(image.data, 0, image.side)).toThrow(
      new NetworkQrError('INVALID_IMAGE'),
    );
    expect(() => decodeNetworkQrPixels(image.data, image.side + 1, image.side)).toThrow(
      new NetworkQrError('INVALID_IMAGE'),
    );
  });
  it('rejects oversized, unsupported and forged image inputs before browser decode', async () => {
    const bitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', bitmap);
    const oversized = new File(['x'], 'large.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: NETWORK_QR_MAX_FILE_BYTES + 1 });
    await expect(readNetworkQrFile(oversized)).rejects.toEqual(
      new NetworkQrError('IMAGE_TOO_LARGE'),
    );
    await expect(
      readNetworkQrFile(new File(['<svg/>'], 'private-name.svg', { type: 'image/svg+xml' })),
    ).rejects.toEqual(new NetworkQrError('INVALID_IMAGE'));
    await expect(
      readNetworkQrFile(new File(['not-png'], 'private-name.png', { type: 'image/png' })),
    ).rejects.toEqual(new NetworkQrError('INVALID_IMAGE'));
    expect(bitmap).not.toHaveBeenCalled();
  });
  it('closes a decoded oversized bitmap and hides browser error details', async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'private-name.jpg', {
      type: 'image/jpeg',
    });
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 4097, height: 1, close })),
    );
    await expect(readNetworkQrFile(file)).rejects.toEqual(new NetworkQrError('IMAGE_TOO_LARGE'));
    expect(close).toHaveBeenCalledOnce();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('PRIVATE_FILENAME_AND_STACK'))),
    );
    await expect(readNetworkQrFile(file)).rejects.toEqual(new NetworkQrError('IMAGE_UNAVAILABLE'));
  });
});

describe('NET-017 separate GM request fields', () => {
  const queue = (): Net017Projection => ({
    contextId: CONTEXT,
    campaignId: CAMPAIGN,
    stateRevision: 8,
    projectionRevision: 10,
    requestQueueRevision: 3,
    selectedRequestIdOrNull: REQUEST,
    activePlayerCapacity: 1,
    occupiedActivePcCount: 1,
    decisionReason: '',
    commandId: null,
    returnContext: {
      originFormId: 'CMP-006',
      campaignId: CAMPAIGN,
      creationReceiptId: 'create-receipt',
    },
    requests: [
      {
        requestId: REQUEST,
        requestOwnerDeviceId: DEVICE,
        requestStatus: 'PENDING',
        requestRevision: 4,
        connectionState: 'CONNECTED_TECHNICAL',
        requestedCandidateCount: 2,
        gmMessageOrNull: null,
        decisionReceiptIdOrNull: null,
        batchCharacterSummaries: [1, 2].map((index) => ({
          sourceUuid: 'source-' + String(index),
          snapshotChecksum: String(index).repeat(64),
          name: 'Тёзка',
          sourceSnapshotId: 'snapshot-' + String(index),
          localControllerSeatId: SEAT,
        })),
      },
    ],
  });
  function mountQueue(props: Partial<NetworkGmRequestFieldsProps> = {}) {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });
    const full: NetworkGmRequestFieldsProps = {
      projection: queue(),
      state: null,
      onChange: vi.fn(),
      ...props,
    };
    act(() => root.render(<NetworkGmRequestFields {...full} />));
    return {
      container,
      props: full,
      rerender: (next: Partial<NetworkGmRequestFieldsProps>) =>
        act(() => root.render(<NetworkGmRequestFields {...full} {...next} />)),
    };
  }
  it('shows duplicate names with immutable source references and a capacity forecast without dispatching actions', () => {
    const shown = mountQueue();
    expect(shown.container.querySelectorAll('li')).toHaveLength(2);
    expect(shown.container.textContent).toContain('source-1');
    expect(shown.container.textContent).toContain('source-2');
    expect(shown.container.textContent).toContain('snapshot-1');
    expect(shown.container.textContent).toContain('3 из 1');
    expect(shown.container.textContent).toContain('не ограничивает предварительное рассмотрение');
    expect(shown.container.querySelector('button,a,form,iframe')).toBeNull();
    expect(shown.props.onChange).not.toHaveBeenCalled();
  });
  it('reports only editable values for a selected request and reason, with no client authority or command IDs', async () => {
    const p = queue();
    const second = {
      ...p.requests[0]!,
      requestId: 'second-request',
      requestOwnerDeviceId: SESSION,
    };
    const change = vi.fn();
    const shown = mountQueue({
      projection: {
        ...p,
        requests: [...p.requests, second],
        decisionReason: 'Причина прежней заявки',
      },
      onChange: change,
    });
    const radio = shown.container.querySelector<HTMLInputElement>(
      'input[aria-label="Выбрать заявку second-request"]',
    )!;
    await act(() => radio.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(shown.props.onChange).toHaveBeenLastCalledWith({
      selectedRequestIdOrNull: 'second-request',
      decisionReason: '',
    });
    shown.rerender({ projection: { ...p, decisionReason: 'Первая причина' } });
    const input = shown.container.querySelector<HTMLTextAreaElement>('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        '  Причина с пробелами  ',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(shown.props.onChange).toHaveBeenLastCalledWith({
      selectedRequestIdOrNull: REQUEST,
      decisionReason: '  Причина с пробелами  ',
    });
    expect(JSON.stringify(change.mock.calls)).not.toMatch(
      /commandId|controllerSeat|networkScopeId|authoritativeGmActorId/u,
    );
  });
  it('keeps terminal request reasons and receipt refs read-only and blocks local or host in-flight editing', () => {
    const p = queue();
    const shown = mountQueue({
      projection: {
        ...p,
        requests: [
          {
            ...p.requests[0]!,
            requestStatus: 'REJECTED',
            gmMessageOrNull: 'Подтверждённая причина',
            decisionReceiptIdOrNull: 'decision-receipt',
          },
        ],
      },
    });
    expect(shown.container.textContent).toContain('Подтверждённая причина');
    expect(shown.container.textContent).toContain('decision-receipt');
    expect(shown.container.querySelector('textarea')!.disabled).toBe(true);
    shown.rerender({ projection: { ...p, commandId: 'pending' } });
    expect(shown.container.querySelector('fieldset')!.disabled).toBe(true);
    shown.rerender({
      state: {
        values: { selectedRequestIdOrNull: REQUEST, decisionReason: '' },
        dirty: false,
        pending: true,
      },
    });
    expect(shown.container.querySelector('fieldset')!.disabled).toBe(true);
    expect(shown.container.textContent).toContain('Сохранение выбора');
  });
  it('shows an authoritative empty queue without restoring a removed selection or calling the server', () => {
    const p = queue();
    const shown = mountQueue({
      projection: { ...p, requests: [], selectedRequestIdOrNull: null },
      state: {
        values: { selectedRequestIdOrNull: REQUEST, decisionReason: 'Старый ввод' },
        dirty: true,
        pending: false,
      },
    });
    expect(shown.container.textContent).toContain('Входящих заявок пока нет');
    expect(shown.container.textContent).toContain('Выбранной заявки больше нет');
    expect(shown.container.querySelector('input[type="radio"]')).toBeNull();
    expect(shown.container.querySelector('textarea')!.disabled).toBe(true);
    expect(shown.props.onChange).not.toHaveBeenCalled();
  });
  it('does not render a GM queue through the existing player NetworkFields entry point', () => {
    const shown = mount({ formId: 'NET-017', projection: queue() });
    expect(shown.container.textContent).toBe('');
    expect(shown.props.onChange).not.toHaveBeenCalled();
  });
  it('labels the owner-only IN_REVIEW result accurately without an available cancellation input', () => {
    const shown = mount({
      formId: 'NET-005',
      projection: {
        ...bound,
        sessionId: SESSION,
        requestId: REQUEST,
        requestOwnerDeviceId: DEVICE,
        batchCharacterSummaries: [summary(1)],
        requestStatus: 'IN_REVIEW',
        gmMessage: null,
        requestRevision: 1,
        cancelReason: '',
        commandId: null,
      },
    });
    expect(shown.container.textContent).toContain('Мастер принял заявку к рассмотрению');
    expect(shown.container.textContent).not.toContain('Получено предложение по допуску');
    expect(shown.container.querySelector('textarea')).toBeNull();
    expect(shown.container.innerHTML).not.toMatch(
      /decisionReceiptIdOrNull|requestQueueRevision|gmQueue|privateKey/u,
    );
  });
});
