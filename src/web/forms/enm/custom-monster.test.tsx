import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import { wireCodecPrimitives as w } from '@shared/wire-codec.js';
import { enemyCompositionReaders as r } from '@shared/enemy-composition-codec.js';
import {
  ENEMY_AUTHORING_WORKFLOWS,
  enemyAuthoringActions,
  enemyAuthoringProjectionValue,
} from '@shared/enemy-authoring.js';
import type { CustomMonsterProjection } from '@shared/custom-monster-presentation.js';
import {
  connectProjection,
  type ProjectionConnection,
  type WebClientState,
} from '../../ws-client.js';
import { GM_CONTEXT_STORAGE_KEY } from '../cmp/campaign-create.js';
import { EnemyAuthoringContent } from './enemy-authoring-content.js';
import { createCustomMonsterClientFixture } from '../../../../tests/fixtures/custom-monster-client.js';

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
  constructor(_url: string | URL) {
    Socket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
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
}
const roots: { root: Root; container: HTMLDivElement }[] = [],
  connections: ProjectionConnection[] = [];
afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  connections.splice(0).forEach((connection) => connection.disconnect());
  Socket.instances = [];
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});
function mount(p: CustomMonsterProjection) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div'),
    root = createRoot(container);
  const onValue = vi.fn((_value: JsonObject | null) => undefined),
    onPrepare = vi.fn((_value: JsonObject) => ({ ok: true }));
  document.body.append(container);
  roots.push({ root, container });
  act(() =>
    root.render(
      createElement(EnemyAuthoringContent, {
        projection: p as unknown as JsonObject,
        onValue,
        onPrepare,
      }),
    ),
  );
  return { container, onValue, onPrepare };
}
function frame(p: CustomMonsterProjection, reason: string, correlationId: string) {
  return {
    messageType: 'projection.snapshot',
    protocolVersion: 2,
    projectionRole: 'gm',
    revisions: {
      stateRevision: p.stateRevision,
      projectionRevision: p.projectionRevision,
      actorVisibilityRevision: p.actorVisibilityRevision,
    },
    presentation: {
      assignment: { reason, correlationId },
      base: {
        formId: p.formId,
        formType: 'screen',
        routeTemplate: `/master/campaigns/:campaignId/enemy-catalog/${p.formId.toLowerCase()}`,
        routeBindings: [{ parameterIndex: 0, source: 'inherited', value: p.campaignId }],
        availableActionKeys: enemyAuthoringActions(p),
        roleFilteredPayload: p,
      },
      layers: [],
    },
  };
}
async function connect(p: CustomMonsterProjection, ownerDeviceId: string) {
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint32Array) => {
      values.set([1, 2, 3, 4]);
      return values;
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ deviceId: ownerDeviceId }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
  vi.stubGlobal('WebSocket', Socket);
  window.sessionStorage.setItem(GM_CONTEXT_STORAGE_KEY, p.contextId);
  const states: WebClientState[] = [],
    connection = connectProjection((state) => states.push(state));
  connections.push(connection);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const socket = Socket.instances.at(-1);
  if (socket === undefined) throw Error('Expected browser socket');
  socket.open();
  const request = JSON.parse(socket.sent[0]!) as { reconnectRequestId: string };
  socket.message({
    messageType: 'session.reconnect.capabilities',
    protocolVersion: 2,
    reconnectRequestId: request.reconnectRequestId,
    executableWorkflowCommandIds: ENEMY_AUTHORING_WORKFLOWS,
    revisions: {
      stateRevision: p.stateRevision,
      projectionRevision: p.projectionRevision,
      actorVisibilityRevision: p.actorVisibilityRevision,
    },
  });
  socket.message(frame(p, 'RECONNECT', request.reconnectRequestId));
  expect(states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: p.formId } });
  return { socket, states };
}
it('uses actual source monster controls, explicit empty consent, and rejects malformed/foreign-kind packets before replacing the real complete sheet', async () => {
  // This individual integration body includes the real host/source/SQLite preparation measured at 7.1s.
  // Shared hooks/defaults retain their original budgets; mocked Socket below is not a network claim.
  const source = await createCustomMonsterClientFixture();
  for (const p of [
    source.identity,
    source.stats,
    source.physics,
    source.attack,
    source.symbiont,
    source.full,
  ]) {
    expect(() => enemyAuthoringProjectionValue(p)).not.toThrow();
    const rendered = mount(p).container;
    expect(rendered.textContent).not.toMatch(
      /sourceBaselineVersion|itemInstanceId|skillPlanState|"schemaVersion"/,
    );
    expect(rendered.querySelector('[aria-label="Пол"]')).toBeNull();
  }
  const full = mount(source.full).container;
  expect(full.textContent).toContain('7/7 HP');
  expect(full.textContent).toContain('Симбионта нет');
  const identity = mount(source.identity),
    name = identity.container.querySelector<HTMLInputElement>('[aria-label="Имя монстра"]'),
    description = identity.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Описание монстра"]',
    ),
    nameDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'),
    descriptionDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (
    name === null ||
    description === null ||
    nameDescriptor?.set === undefined ||
    descriptionDescriptor?.set === undefined
  )
    throw Error('Expected real identity inputs');
  act(() => {
    nameDescriptor.set?.call(name, 'Ночной страж');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (const count of [2000, 2001, 2000]) {
    const value = '🦉'.repeat(count);
    act(() => {
      descriptionDescriptor.set?.call(description, value);
      description.dispatchEvent(new Event('input', { bubbles: true }));
    });
    if (count === 2001) expect(identity.onValue.mock.calls.at(-1)?.[0]).toBeNull();
    else expect(identity.onValue.mock.calls.at(-1)?.[0]?.['description']).toBe(value);
  }
  const empty = mount(source.acquired);
  expect(empty.onValue.mock.calls.at(-1)?.[0]).toBeNull();
  const consent = [
    ...empty.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ].find((input) => input.parentElement?.textContent?.includes('Подтверждаю итоговый состав'));
  if (consent === undefined) throw Error('Expected explicit empty consent');
  act(() => consent.click());
  expect(empty.onValue.mock.calls.at(-1)?.[0]).toEqual({
    operation: 'FINISH',
    previewCommandId: source.acquired.context.attemptOrNull?.compositionOrNull?.previewCommandId,
    advisorSkills: [],
  });
  act(() => consent.click());
  expect(empty.onValue.mock.calls.at(-1)?.[0]).toBeNull();

  const controls = mount(source.symbiont);
  const ordinary = [
    ...controls.container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ].find((input) => input.parentElement?.textContent?.includes('Один обыкновенный'));
  if (ordinary === undefined) throw Error('Expected ordinary option');
  act(() => ordinary.click());
  const select = (label: string, value: string) => {
    const control = controls.container.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`,
    );
    if (control === null) throw Error('Missing ' + label);
    act(() => {
      control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  select('Вид симбионта монстра', 'OWL');
  select('Целевой уровень: Сова', '2');
  select('Сторона привязки: Сова', 'LEFT');
  const catalogue = w.jsonObject(
    source.symbiont.catalog['compositionCatalog'],
    '$.compositionCatalog',
  );
  const nodes = r.list(catalogue['nodes'], '$.nodes').map((node) => w.jsonObject(node, '$.node'));
  const owl = nodes.filter(
    (node) =>
      node['speciesKey'] === 'OWL' && typeof node['level'] === 'number' && node['level'] <= 2,
  );
  for (const node of owl) {
    if (typeof node['label'] !== 'string' || typeof node['level'] !== 'number')
      throw Error('Expected source label/level');
    const label = `${node['label']} · уровень ${node['level']}`;
    const checkbox = [
      ...controls.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((input) => input.getAttribute('aria-label') === label);
    if (checkbox === undefined) throw Error('Missing real source node ' + label);
    act(() => checkbox.click());
    expect(checkbox.checked).toBe(true);
  }
  const preview = [...controls.container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Проверить выбранный состав',
  );
  if (preview === undefined) throw Error('Expected host preview control');
  act(() => preview.click());
  expect(controls.onPrepare.mock.calls.at(-1)?.[0]).toEqual({
    operation: 'PREVIEW',
    selection: {
      mode: 'ORDINARY',
      symbiont: {
        speciesKey: 'OWL',
        targetLevel: 2,
        learnedNodeRefs: owl.map((node) => node['nodeRef']),
        binding: { kind: 'OWL_EYE', side: 'LEFT' },
      },
    },
  });

  const faults: Readonly<Record<string, (p: CustomMonsterProjection) => void>> = {
    foreignSentientForm: (p) => Reflect.set(p, 'formId', 'ENM-005'),
    unknownSheetField: (p) => Object.assign(p.sheetOrNull!, { inventory: [] }),
    malformedArmor: (p) =>
      Object.assign(p.sheetOrNull!.physics, {
        naturalArmorDefinition: {
          mode: 'PER_RESOLUTION_ROLL',
          dieSides: 20,
          multiplier: 2,
          bonus: 0,
        },
      }),
    wrongAttack: (p) => Object.assign(p.sheetOrNull!.attack, { category: 'RANGED' }),
    aliveMismatch: (p) => Reflect.set(p.sheetOrNull!, 'alive', false),
    missingCatalog: (p) => Reflect.deleteProperty(p.catalog, 'compositionCatalog'),
    invalidCatalogNode: (p) =>
      Object.assign(p.catalog, {
        compositionCatalog: { species: [], races: [], levels: [], nodes: [42] },
      }),
    wrongArt: (p) => Reflect.set(p.art, 'sha256', '0'.repeat(64)),
  };
  for (const [label, damage] of Object.entries(faults)) {
    const { socket, states } = await connect(source.full, source.ownerDeviceId);
    const before = states.at(-1),
      bad = structuredClone(source.full);
    Reflect.set(bad, 'projectionRevision', bad.projectionRevision + 1);
    damage(bad);
    expect(() => enemyAuthoringProjectionValue(bad), label).toThrow();
    socket.message(frame(bad, 'HOST_SYSTEM_EVENT', 'network-gm-view:' + 'a'.repeat(64)));
    expect(states.at(-1), label).toMatchObject({
      kind: 'protocol-error',
      snapshot: { formId: 'ENM-016' },
    });
    expect(states.filter((state) => state.kind === 'ready').at(-1), label).toEqual(before);
  }
}, 30_000);

it('renders actual saved V1 absence without accepting a configuration object or a summary on another form', async () => {
  const source = await createCustomMonsterClientFixture(false, { captureSavedV1: true });
  const saved = source.savedOrNull;
  if (saved === null) throw Error('Actual saved V1 projection absent');
  expect(saved.versionConfigurationSummaryOrNull).toBeNull();
  expect(mount(saved).container.textContent).toContain(
    'нет отдельного подтверждения конфигурации N+1',
  );
  for (const value of [{}, [], 'confirmation', 1]) {
    const { socket, states } = await connect(saved, source.ownerDeviceId);
    const before = states.at(-1),
      malformed = structuredClone(saved);
    Reflect.set(malformed, 'projectionRevision', malformed.projectionRevision + 1);
    Reflect.set(malformed, 'versionConfigurationSummaryOrNull', value);
    expect(() => enemyAuthoringProjectionValue(malformed)).toThrow();
    socket.message(frame(malformed, 'HOST_SYSTEM_EVENT', 'network-gm-view:' + 'a'.repeat(64)));
    expect(states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      snapshot: { formId: 'ENM-020' },
    });
    expect(states.filter((state) => state.kind === 'ready').at(-1)).toEqual(before);
  }
  for (const projection of [
    source.identity,
    source.stats,
    source.physics,
    source.attack,
    source.full,
  ]) {
    const malformed = { ...projection, versionConfigurationSummaryOrNull: null };
    expect(() => enemyAuthoringProjectionValue(malformed)).toThrow();
  }
  const legacy = structuredClone(saved);
  Reflect.deleteProperty(legacy, 'versionConfigurationSummaryOrNull');
  expect(
    Object.hasOwn(enemyAuthoringProjectionValue(legacy), 'versionConfigurationSummaryOrNull'),
  ).toBe(false);
});
it('shows actual Adviser requirements, bonus limits and paid capacity, and requires fresh consent after edits', async () => {
  const source = await createCustomMonsterClientFixture(true);
  const controls = mount(source.acquired);
  expect(controls.container.textContent).toContain('I: 15; W: 20');
  const add = [...controls.container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Добавить навык Советника',
  );
  if (add === undefined) throw Error('Expected separate personality control');
  const editSkill = (index: number, key: string, bonus: string) => {
    const select = controls.container.querySelector<HTMLSelectElement>(
      `select[aria-label="Навык Советника ${index}"]`,
    );
    const input = controls.container.querySelector<HTMLInputElement>(
      `input[aria-label="Бонус навыка Советника ${index}"]`,
    );
    if (select === null || input === null) throw Error('Expected own skill controls');
    act(() => {
      select.value = key;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor?.set === undefined) throw Error('Expected native input setter');
    act(() => {
      descriptor.set?.call(input, bonus);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  act(() => add.click());
  editSkill(1, 'LEARNING', '7');
  act(() => add.click());
  editSkill(2, 'ACROBATICS', '1');
  expect(controls.container.textContent).toContain('Стоимость: 9');
  expect(controls.container.textContent).toContain('Стоимость: 1');
  expect(controls.container.textContent).toContain('Занято 10 из 10 слотов');
  expect(controls.container.textContent).toContain('I ≥ 12; сейчас 15');
  expect(controls.container.textContent).toContain('Предел бонуса:');
  const consent = [
    ...controls.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ].find((input) => input.parentElement?.textContent?.includes('Подтверждаю итоговый состав'));
  if (consent === undefined) throw Error('Expected own-card consent');
  act(() => consent.click());
  expect(controls.onValue.mock.calls.at(-1)?.[0]).toMatchObject({
    operation: 'FINISH',
    advisorSkills: [
      { skillKey: 'LEARNING', targetBonus: 7 },
      { skillKey: 'ACROBATICS', targetBonus: 1 },
    ],
  });
  editSkill(1, 'LEARNING', '10');
  expect(controls.container.textContent).toContain('Занято 16 из 10 слотов');
  expect(consent.checked).toBe(false);
  expect(controls.onValue.mock.calls.at(-1)?.[0]).toBeNull();
  editSkill(1, 'LEARNING', '7');
  expect(consent.checked).toBe(false);
  expect(controls.onValue.mock.calls.at(-1)?.[0]).toBeNull();
  act(() => consent.click());
  expect(controls.onValue.mock.calls.at(-1)?.[0]).toMatchObject({
    advisorSkills: [
      { skillKey: 'LEARNING', targetBonus: 7 },
      { skillKey: 'ACROBATICS', targetBonus: 1 },
    ],
  });
  const faults: Readonly<Record<string, (p: CustomMonsterProjection) => void>> = {
    wrongPersonalityDie: (p) =>
      Object.assign(p.context.attemptOrNull!.advisorCards[0]!.iwRolls[0].mechanical, {
        dieSides: 6,
      }),
    unknownPersonalitySkill: (p) => {
      const skills = [{ skillKey: 'FOREIGN', targetBonus: 1 }];
      Object.assign(p.context.attemptOrNull!.advisorCards[0]!, {
        initialSkillsOrNull: skills,
        knownSkills: skills,
      });
      Reflect.set(p.advisorPreparationOrNull!, 'initialFilled', true);
    },
    missingRequiredStats: (p) => Reflect.deleteProperty(p.advisorPreparationOrNull!.stats, 'I'),
  };
  for (const [label, damage] of Object.entries(faults)) {
    const { socket, states } = await connect(source.acquired, source.ownerDeviceId);
    const before = states.at(-1),
      bad = structuredClone(source.acquired);
    Reflect.set(bad, 'projectionRevision', bad.projectionRevision + 1);
    damage(bad);
    expect(() => enemyAuthoringProjectionValue(bad), label).toThrow();
    socket.message(frame(bad, 'HOST_SYSTEM_EVENT', 'network-gm-view:' + 'a'.repeat(64)));
    expect(states.at(-1), label).toMatchObject({
      kind: 'protocol-error',
      snapshot: { formId: 'ENM-015' },
    });
    expect(states.filter((state) => state.kind === 'ready').at(-1), label).toEqual(before);
  }
}, 30_000);
