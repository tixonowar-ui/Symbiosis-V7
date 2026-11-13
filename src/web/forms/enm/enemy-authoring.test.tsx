import { enemyLibraryActions, type EnemyLibraryProjection } from '@shared/enemy-library.js';
import { enemyVersionEditorValue } from '@shared/enemy-version-editor.js';
import { loadEnemyVersionClientSnapshots } from '../../../../tests/fixtures/enemy-version-client.js';
import { enemyAuthoringProjectionValue as anyEnemyProjection } from '@shared/enemy-authoring.js';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEnemyCompositionClientFixture } from '../../../../tests/fixtures/enemy-composition-client.js';
import {
  ENEMY_AUTHORING_WORKFLOWS,
  ENEMY_PLACEHOLDER_SHA256,
  enemyAuthoringActions,
  enemyAuthoringProjectionValue,
  type SentientEnemyAuthoringProjection as EnemyAuthoringProjection,
  type EnemyItemInput,
} from '@shared/enemy-authoring.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import { wireCodecPrimitives as w } from '@shared/wire-codec.js';
import {
  connectProjection,
  type ProjectionConnection,
  type WebClientState,
} from '../../ws-client.js';
import { GM_CONTEXT_STORAGE_KEY } from '../cmp/campaign-create.js';
import { EnemyAuthoringContent, VersionChanges } from './enemy-authoring-content.js';
import { diffEnemyVersionValues } from '../../../domain/entities/enemy-template/version-configuration.js';
import { presentedFormDefinition } from '../index.js';
import { App } from '../../app.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(): EnemyAuthoringProjection {
  return {
    kind: 'SENTIENT_ENEMY_AUTHORING',
    formId: 'ENM-007',
    contextId: id(1),
    campaignId: id(2),
    campaignStatus: 'PAUSED',
    stateRevision: 2,
    projectionRevision: 7,
    actorVisibilityRevision: 0,
    context: {
      attemptOrNull: {
        attemptId: id(3),
        campaignId: id(2),
        kind: 'SENTIENT',
        revision: 2,
        identityOrNull: {
          name: 'Страж',
          description: null,
          origin: 'Дозор',
          affiliation: 'Город',
          massKg: 80.1,
          anatomyProfileId: 'ORDINARY_SENTIENT',
        },
        baseStatsOrNull: { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 },
        buildOrNull: null,
        compositionOrNull: null,
        inventoryOrNull: null,
        itemTemplateKeys: [],
      },
      selectedVersionOrNull: null,
    },
    sheetOrNull: null,
    validationErrors: [],
    catalog: {
      inventoryMetadata: {
        qualityTiers: [],
        clothingRegions: [],
        clothingHermetic: [],
        clothingFlammability: [],
      },
      buildOptions: [],
      races: [{ raceCode: 'PURE', name: 'Чистый', classPolicy: 'REQUIRED_PURE_CLASS' }],
      classes: [{ classCode: 'SOLDIER', name: 'Солдат' }],
      skills: [],
      items: [],
    },
    art: { mediaType: 'image/png', sha256: ENEMY_PLACEHOLDER_SHA256, bytesBase64: 'cG5n' },
  };
}
/** Closed wire/render fixture; game arithmetic is proved by the source-backed host suite. */
function clothingPreview(): EnemyAuthoringProjection {
  const p = fixture(),
    a = p.context.attemptOrNull!;
  const item: EnemyItemInput = {
    itemTypeId: 'RES-EQP-001',
    quantity: 1,
    profile: { kind: 'CATALOG' },
    equipped: true,
    equippedSlots: ['TORSO'],
    bodyZone: null,
    gripMode: null,
    currentAmmo: null,
    shieldCurrentHP: null,
    broken: false,
    sealed: null,
    linkedSetInstanceId: null,
    componentRole: null,
    qualityRoll: null,
    coatingInstanceIds: [],
    issueReason: 'Одежда',
    qualityTier: 'GOOD',
    clothingProperties: {
      coveredRegionIds: ['TORSO'],
      hermetic: false,
      flammability: 'COMBUSTIBLE',
    },
  };
  const build = { raceCode: 'PURE', pureClassOrNull: 'SOLDIER', skillSelections: [] },
    composition = {
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
    },
    inventory = { inventoryItems: [item], armorCompatibilityReasonOrNull: null };
  Object.assign(a, {
    buildOrNull: build,
    compositionOrNull: composition,
    inventoryOrNull: inventory,
    itemTemplateKeys: [id(5)],
  });
  Object.assign(p.catalog, {
    inventoryMetadata: {
      qualityTiers: [{ value: 'GOOD', label: 'Хорошее' }],
      clothingRegions: ['TORSO'],
      clothingHermetic: [false],
      clothingFlammability: ['COMBUSTIBLE'],
    },
    items: [
      {
        itemTypeId: 'RES-EQP-001',
        name: 'Одежда',
        category: 'Экипировка',
        equippable: true,
        composite: false,
        components: [],
        armorOrNull: null,
        catalogueSource: {},
        profileSource: null,
        weaponProfiles: [],
      },
    ],
  });
  Object.assign(p, {
    formId: 'ENM-010',
    sheetOrNull: {
      identity: a.identityOrNull,
      baseStats: a.baseStatsOrNull,
      skillStageStats: a.baseStatsOrNull,
      permanentStats: a.baseStatsOrNull,
      effectiveStats: a.baseStatsOrNull,
      build,
      skills: [],
      skillSlots: { capacity: 0, used: 0, remaining: 0 },
      composition,
      inventory,
      items: [
        {
          itemTemplateKey: id(5),
          name: 'Одежда',
          profile: {
            itemTypeId: 'RES-EQP-001',
            name: 'Одежда',
            category: 'Экипировка',
            completeness: 'PARTIAL',
            catalogueSource: {},
            mechanicsSourceOrNull: null,
          },
          quantity: 1,
          equipped: true,
          equippedSlots: ['TORSO'],
        },
      ],
      armor: {
        pieces: [],
        layersByZone: {},
        requiredStrength: 0,
        mobilityModifier: 0,
        runningModifier: 0,
        acrobaticsModifier: 0,
        dodgeModifier: 0,
        compatibilityRequiredItemIds: [],
      },
      requirementPenalties: {
        sourceRuleId: 'CORE-016',
        armor: { requiredStrength: 0, deficit: 0, penalty: 0, appliesTo: [] },
        weapons: [],
      },
      classMovementModifier: 0,
      maxHP: 100,
      progressionPolicy: 'NO_XP_PROGRESSION',
      artAssetKey: 'symbiosis_placeholder_sentient_enemy',
    },
  });
  return p;
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
const connections: ProjectionConnection[] = [];
afterEach(() => {
  connections.splice(0).forEach((connection) => connection.disconnect());
  Socket.instances = [];
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});
function frame(
  p: EnemyAuthoringProjection | EnemyLibraryProjection,
  reason: string,
  correlationId: string,
) {
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
        availableActionKeys:
          p.kind === 'SYSTEM_LIBRARY' ? enemyLibraryActions(p) : enemyAuthoringActions(p),
        roleFilteredPayload: p,
      },
      layers: [],
    },
  };
}
async function connect(
  p: EnemyAuthoringProjection | EnemyLibraryProjection = fixture(),
  ownerDeviceId = id(4),
) {
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
  const socket = Socket.instances.at(-1)!;
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
  return { states, socket, connection };
}
it('ENM-020 renders an explicitly absent N+1 confirmation without adding a plan or accepting a summary object', () => {
  // Structural renderer fixture; actual host/SQL/replay absence is tested at the owning boundary.
  const preview = clothingPreview();
  const saved: EnemyAuthoringProjection = {
    ...preview,
    formId: 'ENM-020',
    context: {
      attemptOrNull: null,
      selectedVersionOrNull: {
        campaignId: preview.campaignId,
        templateId: id(90),
        versionId: id(91),
        version: 1,
        kind: 'SENTIENT',
        artAssetKey: 'symbiosis_placeholder_sentient_enemy',
        artSha256: ENEMY_PLACEHOLDER_SHA256,
      },
    },
    versionConfigurationSummaryOrNull: null,
  };
  const decoded = enemyAuthoringProjectionValue(saved);
  const html = renderToStaticMarkup(
    createElement(EnemyAuthoringContent, {
      projection: decoded as unknown as JsonObject,
      onValue() {},
      onPrepare: () => ({ ok: true }),
    }),
  );
  expect(html).toContain('нет отдельного подтверждения конфигурации N+1');
  for (const value of [{}, [], 'confirmation', 1]) {
    const malformed = structuredClone(saved);
    Reflect.set(malformed, 'versionConfigurationSummaryOrNull', value);
    expect(() => enemyAuthoringProjectionValue(malformed)).toThrow();
  }
  const otherForm = { ...fixture(), versionConfigurationSummaryOrNull: null };
  expect(() => enemyAuthoringProjectionValue(otherForm)).toThrow();
  const legacy = structuredClone(saved);
  Reflect.deleteProperty(legacy, 'versionConfigurationSummaryOrNull');
  expect(
    Object.hasOwn(enemyAuthoringProjectionValue(legacy), 'versionConfigurationSummaryOrNull'),
  ).toBe(false);
});
/** Renderer/Socket contract data, not a claimed owning V2 producer; host tests prove the actual append. */
function historyFixture(): EnemyAuthoringProjection {
  const source = clothingPreview();
  if (source.sheetOrNull === null) throw new Error('Missing structural full sheet');
  const first = {
    campaignId: source.campaignId,
    templateId: id(90),
    versionId: id(91),
    version: 1,
    kind: 'SENTIENT' as const,
    artAssetKey: 'symbiosis_placeholder_sentient_enemy' as const,
    artSha256: ENEMY_PLACEHOLDER_SHA256,
  };
  const current = { ...first, versionId: id(92), version: 2 };
  return {
    ...source,
    formId: 'ENM-020',
    context: { attemptOrNull: null, selectedVersionOrNull: current },
    versionConfigurationSummaryOrNull: null,
    sheetOrNull: {
      ...source.sheetOrNull,
      identity: { ...source.sheetOrNull.identity, name: 'Новый страж' },
    },
    versionHistory: {
      current,
      selected: current,
      activeCombatPins: [],
      entries: [
        {
          identity: first,
          timestamp: '2026-11-13T00:00:00.000Z',
          reason: null,
          changeSet: [],
          configurationSummaryOrNull: null,
        },
        {
          identity: current,
          timestamp: '2026-11-13T01:00:00.000Z',
          reason: 'Уточнение имени',
          changeSet: [
            {
              path: '/identityOrNull/name',
              before: { present: true, value: source.sheetOrNull.identity.name },
              after: { present: true, value: 'Новый страж' },
            },
          ],
          configurationSummaryOrNull: null,
        },
      ],
    },
  };
}
it('shows the actual selected/current history and sends only the clicked immutable version intent', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const source = historyFixture(),
    onSelectVersion = vi.fn(),
    onPrepare = vi.fn(() => ({ ok: true }));
  const container = document.createElement('div'),
    root = createRoot(container);
  document.body.append(container);
  try {
    act(() =>
      root.render(
        createElement(EnemyAuthoringContent, {
          projection: structuredClone(w.jsonObject(source, '$.history')),
          onValue() {},
          onPrepare,
          onSelectVersion,
        }),
      ),
    );
    expect(container.textContent).toContain('Текущая версия: 2. Просматривается: 2.');
    expect(container.textContent).toContain('Уточнение имени');
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Просмотреть версию 1',
    );
    if (button === undefined) throw new Error('Missing real history selection control');
    act(() => button.click());
    expect(onSelectVersion).toHaveBeenCalledExactlyOnceWith(
      source.versionHistory?.entries[0]?.identity,
    );
    expect(onPrepare).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Текущая версия: 2. Просматривается: 2.'); // Await a confirmed host projection.
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
it('confirms a correlated history selection without promoting the viewed V1 to current', async () => {
  const source = historyFixture(),
    { connection, socket, states } = await connect(source);
  const first = source.versionHistory?.entries[0]?.identity;
  if (
    first === undefined ||
    first.kind !== 'SENTIENT' ||
    source.versionHistory === undefined ||
    source.sheetOrNull === null
  )
    throw new Error('Missing history fixture');
  expect(connection.selectEnemyLibrary('SENTIENT_ENEMIES', null, first)).toEqual({ ok: true });
  const request = w.jsonObject(JSON.parse(socket.sent.at(-1) ?? ''), '$.request');
  expect(request).toMatchObject({
    messageType: 'network.enemy-selection.replace',
    sourceFormId: 'ENM-020',
    userSelectionOrNull: first,
  });
  socket.message({
    messageType: 'network.enemy-selection.result',
    protocolVersion: 3,
    operationId: request['operationId'],
  });
  expect(states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'ENM-020' } });
  const selected: EnemyAuthoringProjection = {
    ...source,
    stateRevision: source.stateRevision + 1,
    projectionRevision: source.projectionRevision + 1,
    context: { attemptOrNull: null, selectedVersionOrNull: first },
    versionHistory: { ...source.versionHistory, selected: first },
  };
  socket.message(frame(selected, 'FORM_ACTION', w.string(request['operationId'], '$.operationId')));
  const confirmed = states.at(-1);
  expect(confirmed).toMatchObject({
    kind: 'ready',
    snapshot: {
      formId: 'ENM-020',
      projection: { versionHistory: { current: { version: 2 }, selected: { version: 1 } } },
    },
  });
});
it('refuses malformed nested history before publishing and retains the last confirmed full view', async () => {
  const source = historyFixture(),
    { states, socket } = await connect(source),
    before = states.at(-1);
  const malformed = structuredClone(source);
  Reflect.set(malformed, 'projectionRevision', source.projectionRevision + 1);
  const entries = malformed.versionHistory?.entries;
  if (entries === undefined) throw new Error('Missing history fixture');
  Reflect.set(entries[1]!.identity, 'versionId', entries[0]!.identity.versionId);
  expect(() => enemyAuthoringProjectionValue(malformed)).toThrow('INVALID_SHAPE');
  socket.message(frame(malformed, 'HOST_SYSTEM_EVENT', 'network-gm-view:' + 'a'.repeat(64)));
  expect(states.at(-1)).toMatchObject({ kind: 'protocol-error' });
  expect(states.filter((state) => state.kind === 'ready').at(-1)).toEqual(before);
});
it('registers the exact seven source-defined ENM-005/006/007/008/009/010/020 screens and renders explicit identity/build facts', () => {
  for (const form of [
    'ENM-005',
    'ENM-006',
    'ENM-007',
    'ENM-008',
    'ENM-009',
    'ENM-010',
    'ENM-020',
  ] as const)
    expect(presentedFormDefinition(form)?.route).toBe(
      `/master/campaigns/:campaignId/enemy-catalog/${form.toLowerCase()}`,
    );
  const html = renderToStaticMarkup(
    createElement(EnemyAuthoringContent, {
      projection: fixture() as unknown as JsonObject,
      onValue() {},
      onPrepare: () => ({ ok: true }),
    }),
  );
  expect(html).toContain('Раса, класс и навыки');
  expect(html).toContain('Чистый');
  expect(html).not.toMatch(/sex|STANDARD_HUMANOID|deepCloneOnInstantiation|sourceBaselineVersion/);
  const preview = clothingPreview();
  expect(() => enemyAuthoringProjectionValue(preview)).not.toThrow();
  expect(
    renderToStaticMarkup(
      createElement(EnemyAuthoringContent, {
        projection: preview as unknown as JsonObject,
        onValue() {},
        onPrepare: () => ({ ok: true }),
      }),
    ),
  ).toContain('Качество: Хорошее');
});
const faults = {
  skillSelections: (p: EnemyAuthoringProjection) =>
    Object.assign(p.context.attemptOrNull!, {
      buildOrNull: { raceCode: 'PURE', pureClassOrNull: 'SOLDIER', skillSelections: 42 },
    }),
  identityExtra: (p: EnemyAuthoringProjection) =>
    Object.assign(p.context.attemptOrNull!.identityOrNull!, { sex: 'MALE' }),
  missingStat: (p: EnemyAuthoringProjection) =>
    Reflect.deleteProperty(p.context.attemptOrNull!.baseStatsOrNull!, 'W'),
  inventoryList: (p: EnemyAuthoringProjection) =>
    Object.assign(p.context.attemptOrNull!, {
      inventoryOrNull: { inventoryItems: {}, armorCompatibilityReasonOrNull: null },
    }),
  itemProfile: (p: EnemyAuthoringProjection) =>
    Object.assign(p.context.attemptOrNull!, {
      inventoryOrNull: {
        inventoryItems: [{ profile: { kind: 'MASTER_WEAPON', inputs: 42 } }],
        armorCompatibilityReasonOrNull: null,
      },
    }),
  composition: (p: EnemyAuthoringProjection) =>
    Object.assign(p.context.attemptOrNull!, {
      compositionOrNull: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [{}],
        symbioticMonsterProfileIdOrNull: null,
      },
    }),
  catalogArray: (p: EnemyAuthoringProjection) => Object.assign(p.catalog, { races: 42 }),
  catalogLeaf: (p: EnemyAuthoringProjection) =>
    Object.assign(p.catalog, { classes: [{ classCode: 'SOLDIER', name: {} }] }),
  metadataLabel: (p: EnemyAuthoringProjection) =>
    Object.assign(p.catalog, {
      inventoryMetadata: {
        qualityTiers: [{ value: 'GOOD', label: {} }],
        clothingRegions: [],
        clothingHermetic: [],
        clothingFlammability: [],
      },
    }),
  metadataRegions: (p: EnemyAuthoringProjection) =>
    Object.assign(p.catalog, {
      inventoryMetadata: {
        qualityTiers: [],
        clothingRegions: 'TORSO',
        clothingHermetic: [],
        clothingFlammability: [],
      },
    }),
  missingSelectedQuality: (p: EnemyAuthoringProjection) => {
    const preview = clothingPreview();
    Object.assign(p, { ...preview, projectionRevision: p.projectionRevision });
    Object.assign(p.catalog, {
      inventoryMetadata: { ...(p.catalog['inventoryMetadata'] as JsonObject), qualityTiers: [] },
    });
  },
  artHash: (p: EnemyAuthoringProjection) => Object.assign(p.art, { sha256: '0'.repeat(64) }),
  missingAttempt: (p: EnemyAuthoringProjection) =>
    Object.assign(p.context, { attemptOrNull: null }),
  foreignAttempt: (p: EnemyAuthoringProjection) =>
    Object.assign(p.context.attemptOrNull!, { campaignId: id(99) }),
};
it.each(Object.entries(faults))(
  'refuses malformed rendered %s before confirmation; retains the old GM view and does not render a bad packet',
  async (_name, damage) => {
    const { states, socket } = await connect(),
      before = states.at(-1);
    const p = fixture();
    Reflect.set(p, 'projectionRevision', p.projectionRevision + 1);
    damage(p);
    expect(() => enemyAuthoringProjectionValue(p)).toThrow();
    socket.message(frame(p, 'HOST_SYSTEM_EVENT', 'network-gm-view:' + 'a'.repeat(64)));
    expect(states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      snapshot: expect.objectContaining({
        formId: 'ENM-007',
        revisions: { stateRevision: 2, projectionRevision: 7, actorVisibilityRevision: 0 },
      }) as unknown,
    });
    expect(states.filter((state) => state.kind === 'ready').at(-1)).toEqual(before);
  },
);

describe('source-backed composition controls and confirmed wire boundary', () => {
  let source: Awaited<ReturnType<typeof createEnemyCompositionClientFixture>>;
  const mounted: { root: Root; container: HTMLDivElement }[] = [];
  beforeAll(async () => {
    source = await createEnemyCompositionClientFixture();
  }, 30_000);
  afterEach(() => {
    for (const value of mounted.splice(0)) {
      act(() => value.root.unmount());
      value.container.remove();
    }
  });
  function mount(
    p: EnemyAuthoringProjection,
    onValue = vi.fn(),
    onPrepare = vi.fn((_value: JsonObject) => ({ ok: true })),
  ) {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement('div'),
      root = createRoot(container);
    document.body.append(container);
    mounted.push({ container, root });
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
  it('renders real source nodes and keeps locally edited selection separate from the confirmed PREVIEW', () => {
    const { container, onValue, onPrepare } = mount(source.preview);
    const confirm = () =>
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Подтвердить взаимодействия и приобретения',
      );
    expect(confirm()).toBeDefined();
    expect(confirm()!.disabled).toBe(true);
    const node = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (input) =>
        input.getAttribute('aria-label')?.startsWith('Изучить:') &&
        !input.disabled &&
        input.checked,
    );
    expect(node).toBeDefined();
    const composition = source.preview.context.attemptOrNull!.compositionOrNull!;
    if (!('schemaVersion' in composition)) throw Error('Composed fixture required');
    const catalog = source.preview.catalog['compositionCatalog'] as JsonObject;
    const selectedNode = (catalog['nodes'] as JsonObject[]).find(
      (entry) =>
        typeof entry['label'] === 'string' &&
        'Изучить: ' + entry['label'] === node!.getAttribute('aria-label'),
    )!;
    const member = composition.ordinarySymbiontInstances.find(
      (entry) => entry.speciesKey === selectedNode['speciesKey'],
    )!;
    expect(member.learnedNodeRefs).toContain(selectedNode['nodeRef']);
    act(() => node!.click());
    expect(confirm()).toBeUndefined();
    expect(onValue).toHaveBeenLastCalledWith(null);
    const button = [...container.querySelectorAll('button')].find(
      (value) => value.textContent === 'Рассчитать взаимодействия',
    )!;
    act(() => button.click());
    expect(onPrepare).toHaveBeenCalledOnce();
    const request = onPrepare.mock.calls[0]![0];
    expect(request['operation']).toBe('PREVIEW');
    // This tests exact local intent; the production case separately proves a valid graph on the host.
    expect(request['selection']).toEqual({
      symbiontCompositionMode: composition.symbiontCompositionMode,
      ordinarySymbiontInstances: composition.ordinarySymbiontInstances.map((entry) =>
        entry === member
          ? {
              ...entry,
              learnedNodeRefs: entry.learnedNodeRefs.filter(
                (ref) => ref !== selectedNode['nodeRef'],
              ),
            }
          : entry,
      ),
      symbioticMonsterProfileIdOrNull: composition.symbioticMonsterProfileIdOrNull,
      monsterOrNull: composition.monsterOrNull,
    });
    expect(source.preview.context.attemptOrNull!.compositionOrNull).toMatchObject({
      phase: 'PREVIEW',
    });
    expect(container.textContent).not.toMatch(
      /"schemaVersion"|rollReceiptId|sourceBaselineVersion|bytesBase64/,
    );
  });
  it('does not publish FINISH for an unchecked empty composition after acquisitions', () => {
    const { container, onValue } = mount(source.emptyAcquired);
    const mode = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Режим состава симбионтов"]',
    )!;
    act(() => {
      mode.value = 'EMPTY';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onValue).toHaveBeenLastCalledWith(null);
    const checkbox = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((input) => input.parentElement?.textContent?.includes('Подтверждаю явно пустой'))!;
    act(() => checkbox.click());
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'FINISH' }));
    act(() => checkbox.click());
    expect(onValue).toHaveBeenLastCalledWith(null);
  });
  it('binds explicit rebuild confirmation to the actual host candidate and displayed payments, and clears it after a local edit', () => {
    const { container, onValue, onPrepare } = mount(source.buildPreview);
    const preview =
      source.buildPreview.context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!;
    const fencing = [...container.querySelectorAll<HTMLInputElement>('input')].find(
      (input) => input.getAttribute('aria-label') === 'Бонус: Фехтование',
    )!;
    expect(fencing.value).toBe('3');
    expect(container.textContent).toContain('Прежний расчёт навыков станет неактивным');
    expect(container.textContent).toContain('START 9, Мирный воин 0');
    expect(container.textContent).toContain(
      'Собственные навыки Советника, которые станут неактивными',
    );
    expect(container.textContent).toContain('собственные слоты 9');
    expect(container.textContent).toContain('исходный R20 для I — 12, для W — 12');
    expect(onValue).toHaveBeenLastCalledWith(null);
    const checkbox = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((input) =>
      input.parentElement?.textContent?.includes('Подтверждаю показанную пересборку'),
    )!;
    act(() => checkbox.click());
    expect(onValue).toHaveBeenLastCalledWith({
      operation: 'CONFIRM_REBUILD',
      initialInput: preview.initialInput,
      expectedPlanRevision: 1,
      previewCommandId: preview.previewCommandId,
      displayedConsequences: preview.consequences,
    });
    act(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      const setter = descriptor?.set?.bind(fencing);
      if (setter === undefined) throw Error('Native controlled-input setter unavailable');
      setter('4');
      fencing.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(container.textContent).not.toContain('Подтверждаю показанную пересборку');
    const calculate = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Рассчитать явную пересборку начального плана',
    )!;
    act(() => calculate.click());
    expect(onPrepare).toHaveBeenLastCalledWith({
      operation: 'PREVIEW_REBUILD',
      expectedPlanRevision: 1,
      initialInput: {
        ...preview.initialInput,
        build: {
          ...preview.initialInput.build,
          skillSelections: [
            ...preview.initialInput.build.skillSelections.filter(
              (row) => row.skillKey !== 'FENCING',
            ),
            { skillKey: 'FENCING', targetBonus: 4 },
          ],
        },
      },
    });
    // Re-enter every original row in its displayed order, restoring the exact full input.
    for (const skill of preview.initialInput.build.skillSelections) {
      const name = (source.buildPreview.catalog['skills'] as JsonObject[]).find(
        (row) => row['skillKey'] === skill.skillKey,
      )?.['name'];
      if (typeof name !== 'string') throw Error('Source skill name unavailable');
      // A same-value native assignment does not dispatch a React change. Make both edits real.
      for (const bonus of [skill.targetBonus + 1, skill.targetBonus]) {
        act(() => {
          const input = [...container.querySelectorAll<HTMLInputElement>('input')].find(
            (element) => element.getAttribute('aria-label') === `Бонус: ${name}`,
          )!;
          const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          const setter = descriptor?.set?.bind(input);
          if (setter === undefined) throw Error('Native controlled-input setter unavailable');
          setter(String(bonus));
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }
    }
    const returnedConsent = [...container.querySelectorAll<HTMLInputElement>('input')].find(
      (input) => input.parentElement?.textContent?.includes('Подтверждаю показанную пересборку'),
    )!;
    expect(returnedConsent.checked).toBe(false);
    expect(onValue).toHaveBeenLastCalledWith(null);
    act(() => returnedConsent.click());
    expect(onValue).toHaveBeenLastCalledWith({
      operation: 'CONFIRM_REBUILD',
      initialInput: preview.initialInput,
      expectedPlanRevision: 1,
      previewCommandId: preview.previewCommandId,
      displayedConsequences: preview.consequences,
    });
  });
  it('discards a displayed rebuild through the existing PATCH without changing local current-plan knowledge', () => {
    const original = structuredClone(source.buildPreview.context.attemptOrNull!.skillPlanState);
    const { container, onPrepare } = mount(source.buildPreview);
    const discard = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Отказаться от расчёта пересборки',
    )!;
    act(() => discard.click());
    expect(onPrepare).toHaveBeenLastCalledWith({
      operation: 'DISCARD_REBUILD',
      previewCommandId:
        source.buildPreview.context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!
          .previewCommandId,
    });
    expect(source.buildPreview.context.attemptOrNull!.skillPlanState).toEqual(original);
  });
  const nestedFaults: Readonly<Record<string, (p: EnemyAuthoringProjection) => void>> = {
    missingCompositionCatalog: (p) => Reflect.deleteProperty(p.catalog, 'compositionCatalog'),
    nodeSourceQuestions: (p) => {
      const catalog = p.catalog['compositionCatalog'] as JsonObject;
      Object.assign((catalog['nodes'] as JsonObject[])[0]!, { sourceQuestionIds: 42 });
    },
    ownAdvisorR6: (p) => {
      const a = p.context.attemptOrNull!.compositionOrNull!;
      if (!('schemaVersion' in a)) throw Error('Fixture must contain composed input');
      Object.assign(a.acquisitions.advisorCards[0]!.iwRolls[0].mechanical, { dieSides: 6 });
    },
    foreignActiveCard: (p) => {
      const a = p.context.attemptOrNull!.compositionOrNull!;
      if (!('schemaVersion' in a)) throw Error('Fixture must contain composed input');
      Object.assign(a.acquisitions, { activeAdvisorCardIdOrNull: id(998) });
    },
    invalidPreparedSpecimens: (p) => {
      const facts = p.compositionPreparation!.factsOrNull!;
      Object.assign(facts, { specimens: [42] });
    },
    unknownPreparedField: (p) => Object.assign(p.compositionPreparation!, { rawHistory: [] }),
  };
  it.each(Object.entries(nestedFaults))(
    'rejects malformed nested %s before publishing and retains the real confirmed composition',
    async (_name, damage) => {
      const { socket, states } = await connect(source.acquired, source.ownerDeviceId);
      const old = states.at(-1),
        p = structuredClone(source.acquired);
      Object.assign(p, { projectionRevision: p.projectionRevision + 1 });
      const packet = frame(p, 'HOST_SYSTEM_EVENT', 'network-gm-view:' + 'a'.repeat(64));
      damage(p);
      expect(() => enemyAuthoringProjectionValue(p)).toThrow();
      socket.message(packet);
      expect(states.at(-1)).toMatchObject({
        kind: 'protocol-error',
        snapshot: { formId: 'ENM-008' },
      });
      expect(states.filter((state) => state.kind === 'ready').at(-1)).toEqual(old);
      expect(() => mount(source.acquired)).not.toThrow();
    },
  );
  it('renders confirmed own-card resources and refuses a foreign-kind form before replacing the complete sheet', async () => {
    expect(() => enemyAuthoringProjectionValue(source.full)).not.toThrow();
    const { container } = mount(source.full);
    expect(container.textContent).toContain('Собственная карта Советника');
    expect(container.textContent).toContain('Начальные истории пожирания, спутников и стаи пусты');
    expect(container.textContent).not.toMatch(
      /rollReceiptId|symbiontInstanceId|"schemaVersion"|initialRuntimeState/,
    );
    const { socket, states } = await connect(source.full, source.ownerDeviceId);
    const before = states.at(-1),
      foreign = structuredClone(source.full);
    Reflect.set(foreign, 'formId', 'ENM-011');
    Reflect.set(foreign, 'projectionRevision', foreign.projectionRevision + 1);
    expect(() => enemyAuthoringProjectionValue(foreign)).toThrow();
    socket.message(frame(foreign, 'HOST_SYSTEM_EVENT', 'network-gm-view:' + 'a'.repeat(64)));
    expect(states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      snapshot: { formId: 'ENM-010' },
    });
    expect(states.filter((state) => state.kind === 'ready').at(-1)).toEqual(before);
  });
  const planFaults: Readonly<Record<string, (p: EnemyAuthoringProjection) => void>> = {
    unknownPlanVersion: (p) =>
      Object.assign(p.context.attemptOrNull!.skillPlanState!, { schemaVersion: 99 }),
    missingModernPlan: (p) => Reflect.deleteProperty(p.context.attemptOrNull!, 'skillPlanState'),
    foreignPreviewAttempt: (p) =>
      Object.assign(p.context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!, {
        attemptId: id(999),
      }),
    stalePreviewAttemptRevision: (p) =>
      Object.assign(p.context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!, {
        sourceAttemptRevision: 0,
      }),
    foreignRenderedPaidSkill: (p) =>
      Object.assign(
        p.context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!.consequences
          .abandonedSkills[0]!,
        { skillKey: 'FOREIGN_SKILL' },
      ),
    malformedConsequence: (p) =>
      Object.assign(p.context.attemptOrNull!.skillPlanState!.rebuildPreviewOrNull!.consequences, {
        abandonedSkills: [42],
      }),
    extraRawHistory: (p) =>
      Object.assign(p.context.attemptOrNull!.skillPlanState!, { journal: [] }),
  };
  it.each(Object.entries(planFaults))(
    'rejects malformed plan %s before publish and retains the previous confirmed build',
    async (_name, damage) => {
      const { socket, states } = await connect(source.buildPreview, source.ownerDeviceId),
        old = states.at(-1);
      const bad = structuredClone(source.buildPreview);
      Object.assign(bad, { projectionRevision: bad.projectionRevision + 1 });
      const packet = frame(bad, 'HOST_SYSTEM_EVENT', 'network-gm-view:' + 'a'.repeat(64));
      damage(bad);
      expect(() => enemyAuthoringProjectionValue(bad)).toThrow();
      socket.message(packet);
      expect(states.at(-1)).toMatchObject({
        kind: 'protocol-error',
        snapshot: { formId: 'ENM-007' },
      });
      expect(states.filter((state) => state.kind === 'ready').at(-1)).toEqual(old);
      expect(() => mount(source.buildPreview)).not.toThrow();
    },
  );
});

// These scenarios own their setup inside the body; the pre-existing 18-case hook is unchanged.
it.each(['SENTIENT', 'CUSTOM_MONSTER'] as const)(
  'ENM-017 restores the actual %s preview after remount and invalidates consent on edits and reason discard',
  async (kind) => {
    const source = await loadEnemyVersionClientSnapshots(kind);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container),
      onValue = vi.fn(),
      onStage = vi.fn(() => ({ ok: true }));
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const render = (p: typeof source.preview, key: string | number = p.projectionRevision) =>
      act(() =>
        root.render(
          createElement(EnemyAuthoringContent, {
            key,
            projection: structuredClone(w.jsonObject(p, '$.actualProjection')),
            onPrepare: () => ({ ok: true }),
            onValue,
            onStage,
          }),
        ),
      );
    const button = (label: string) => {
      const b = [...container.querySelectorAll('button')].find(
        (v) => v.textContent?.trim() === label,
      );
      if (b === undefined) throw new Error('Missing button ' + label);
      return b;
    };
    const field = (label: string) => {
      const value = container.querySelector<HTMLInputElement>('input[aria-label="' + label + '"]');
      if (value === null) throw new Error('Missing input ' + label);
      return value;
    };
    const edit = (element: HTMLInputElement | HTMLTextAreaElement, value: string) =>
      act(() => {
        const prototype =
          element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.bind(element);
        if (setter === undefined) throw new Error('Missing native controlled setter');
        setter(value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      });
    try {
      // Both snapshots are actual host-issued projections from the same owning NAV and PREVIEW.
      render(source.initial);
      render(source.preview);
      const preview = source.preview.context.versionAttempt?.replacementPreviewOrNull;
      if (preview == null) throw new Error('Missing actual preview');
      expect(preview.input).toEqual(source.input);
      expect(source.preview.versionEditor?.replacementSummaryOrNull).toEqual(preview.inputSummary);
      expect(field('Подтверждаю точную замену конфигурации').checked).toBe(false);
      const draftField =
        kind === 'SENTIENT'
          ? field('Новая базовая S')
          : [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].find(
              (value) => value.value === '7',
            );
      if (draftField === undefined) throw new Error('Missing actual new input');
      const original = draftField.value;
      if (kind === 'SENTIENT' && source.input.kind === 'SENTIENT')
        expect(original).toBe(String(source.input.initialInput.baseStats.S));
      act(() => field('Подтверждаю точную замену конфигурации').click());
      expect(button('Подтвердить замену конфигурации').disabled).toBe(false);
      edit(draftField, String(Number(original) + 1));
      edit(draftField, original);
      expect(field('Подтверждаю точную замену конфигурации').checked).toBe(false);
      expect(onValue).toHaveBeenLastCalledWith(null);
      act(() => field('Подтверждаю точную замену конфигурации').click());
      act(() => button('Подтвердить замену конфигурации').click());
      expect(onStage).toHaveBeenLastCalledWith('VERSION_CONFIGURATION', {
        operation: 'CONFIRM_REPLACEMENT',
        previewCommandId: preview.previewCommandId,
        input: source.input,
        displayedPreview: preview,
        consent: true,
      });
      // CONFIRM above is a UI intent only. Start the separate discard scenario from a fresh unconfirmed host preview.
      render(source.preview, 'unconfirmed-reason-scenario');
      const reasonDraft =
        kind === 'SENTIENT'
          ? field('Новая базовая S')
          : [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].find(
              (value) => value.value === '7',
            );
      if (reasonDraft === undefined) throw new Error('Missing restored reason-scenario draft');
      const reason = container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Причина новой версии"]',
      );
      if (reason === null) throw new Error('Missing reason');
      edit(reason, source.reasonData.reason);
      expect(button('Сохранить причину и отбросить новый выбор').disabled).toBe(true);
      const calls = onStage.mock.calls.length;
      act(() => button('Сохранить причину и отбросить новый выбор').click());
      expect(onStage.mock.calls.length).toBe(calls);
      act(() => button('Вернуть сохранённую причину и сохранить новый выбор').click());
      expect(reasonDraft.value).toBe(original);
      expect(field('Подтверждаю точную замену конфигурации').checked).toBe(false);
      edit(reason, source.reasonData.reason);
      act(() => field('Подтверждаю отбрасывание нового выбора при сохранении причины').click());
      act(() => button('Сохранить причину и отбросить новый выбор').click());
      expect(onStage).toHaveBeenLastCalledWith('VERSION_CONFIGURATION', source.reasonData);
      render(source.reasonApplied);
      expect(
        container.querySelector('input[aria-label="Подтверждаю точную замену конфигурации"]'),
      ).toBeNull();
      expect(
        container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Причина новой версии"]')
          ?.value,
      ).toBe(source.reasonData.reason);
      expect(container.textContent?.includes('Однократная генерация характеристик')).toBe(
        kind === 'CUSTOM_MONSTER',
      );
      if (kind === 'SENTIENT') {
        const attempt = source.initial.context.attemptOrNull;
        if (attempt?.kind !== 'SENTIENT' || attempt.compositionOrNull === null)
          throw new Error('Missing actual composed source');
        if (!('schemaVersion' in attempt.compositionOrNull))
          throw new Error('Expected actual modern composed source');
        const composition = {
          ordinarySymbiontInstances: attempt.compositionOrNull.ordinarySymbiontInstances,
        };
        const summary = preview.inputSummary;
        if (summary.kind !== 'SENTIENT') throw new Error('Missing actual skill summary');
        const catalog = source.preview.catalog;
        const items = catalog['items'];
        if (!Array.isArray(items) || items[0] == null)
          throw new Error('Missing actual item catalogue');
        const item = w.jsonObject(items[0], '$.catalogItem');
        if (typeof item['itemTypeId'] !== 'string' || typeof item['name'] !== 'string')
          throw new Error('Missing actual item name');
        // Renderer-only aggregate values come from actual host/catalogue data, not a forged candidate proof.
        const changes = diffEnemyVersionValues(
          { composition: null, skills: [], items: [] },
          structuredClone(
            w.jsonObject(
              {
                composition,
                skills: summary.initialSkills,
                items: [{ itemTypeId: item['itemTypeId'], quantity: 1 }],
              },
              '$.aggregate',
            ),
          ),
        );
        const html = renderToStaticMarkup(createElement(VersionChanges, { changes, catalog }));
        expect(html).toContain('Обыкновенные симбионты');
        expect(html).toContain('Навыки'); // Exact Russian aggregate heading.
        expect(html).toContain(item['name']);
        const compositionCatalog = w.jsonObject(
          catalog['compositionCatalog'],
          '$.compositionCatalog',
        );
        const nodes = compositionCatalog['nodes'];
        if (!Array.isArray(nodes)) throw new Error('Missing actual node catalogue');
        const firstNode = nodes
          .map((value) => w.jsonObject(value, '$.node'))
          .find((node) => typeof node['nodeRef'] === 'string' && html.includes(node['nodeRef']));
        if (firstNode === undefined || typeof firstNode['label'] !== 'string')
          throw new Error('Missing displayed real learned node');
        expect(html).toContain(firstNode['label']);
        for (const skill of summary.initialSkills) expect(html).toContain(skill.name);
        act(() => button('Идентичность').click());
        const description = [...container.querySelectorAll('label')]
          .find((label) => label.textContent?.trim().startsWith('Описание врага'))
          ?.querySelector('input');
        if (description == null) throw new Error('Missing real description control');
        expect(description.maxLength).toBe(4000); // HTML counts UTF-16; the actual game limit is 2000 code points.
        const astral = '😀'.repeat(2000);
        edit(description, astral);
        expect(button('Применить поле к текущей копии').disabled).toBe(false);
        act(() => button('Применить поле к текущей копии').click());
        expect(onStage).toHaveBeenLastCalledWith(
          'SENTIENT_IDENTITY',
          expect.objectContaining({ description: astral }),
        );
        const stagedCalls = onStage.mock.calls.length;
        edit(description, astral + '😀');
        expect(button('Применить поле к текущей копии').disabled).toBe(true);
        expect(onValue).toHaveBeenLastCalledWith(null);
        act(() => button('Применить поле к текущей копии').click());
        expect(onStage.mock.calls.length).toBe(stagedCalls);
        edit(description, astral);
        expect(button('Применить поле к текущей копии').disabled).toBe(false);
      }
      expect(source.immutableEnemyRowsUnchanged).toBe(true);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  },
  60_000,
);

it('ENM-017 renders legacy bonuses without invented payments and rejects a contradictory display summary', async () => {
  const source = await loadEnemyVersionClientSnapshots('SENTIENT', true);
  const markup = renderToStaticMarkup(
    createElement(EnemyAuthoringContent, {
      projection: structuredClone(w.jsonObject(source.preview, '$.actual')),
      onPrepare: () => ({ ok: true }),
      onValue: () => undefined,
      onStage: () => ({ ok: true }),
    }),
  );
  expect(markup).toContain('бонус 7');
  expect(markup).toContain('Историческое распределение оплаты этих навыков отсутствует');
  expect(markup).not.toContain('Однократная генерация характеристик');
  const p = structuredClone(source.preview),
    summary = p.versionEditor?.replacementSummaryOrNull;
  if (summary?.kind !== 'SENTIENT') throw new Error('Missing summary');
  Object.assign(summary, { startCapacity: 999 });
  expect(() => enemyVersionEditorValue(p.versionEditor, p.context)).toThrow('INVALID_SHAPE');
  expect(() => anyEnemyProjection(p)).toThrow('INVALID_SHAPE');
  if (source.preview.kind !== 'SENTIENT_ENEMY_AUTHORING') throw new Error('Wrong actual kind');
  for (const damage of ['missingEditor', 'contradictoryAlias', 'missingDurableSummary'] as const) {
    const { socket, states } = await connect(source.preview, source.ownerDeviceId);
    const priorReady = states.filter((state) => state.kind === 'ready').at(-1);
    expect(priorReady).toMatchObject({ kind: 'ready', snapshot: { formId: 'ENM-017' } });
    const bad = structuredClone(source.preview);
    Object.assign(bad, { projectionRevision: bad.projectionRevision + 1 });
    if (damage === 'missingEditor') Reflect.deleteProperty(bad, 'versionEditor');
    else if (damage === 'contradictoryAlias') {
      const alias = bad.versionEditor?.replacementSummaryOrNull;
      if (alias?.kind !== 'SENTIENT') throw new Error('Missing exact summary alias');
      Object.assign(alias, { startCapacity: 999 });
    } else {
      const preview = bad.context.versionAttempt?.replacementPreviewOrNull;
      if (preview == null) throw new Error('Missing actual durable preview');
      Reflect.deleteProperty(preview, 'inputSummary');
    }
    expect(() => anyEnemyProjection(bad)).toThrow('INVALID_SHAPE');
    socket.message(frame(bad, 'HOST_SYSTEM_EVENT', 'network-gm-view:' + 'a'.repeat(64)));
    expect(states.at(-1)).toMatchObject({
      kind: 'protocol-error',
      snapshot: { formId: 'ENM-017' },
    });
    expect(states.filter((state) => state.kind === 'ready').at(-1)).toEqual(priorReady);
  }
}, 60_000);

it('binds actual catalog-to-ENM017 navigation to a UUID and accepts its correlated owning editor', async () => {
  const source = await loadEnemyVersionClientSnapshots('SENTIENT');
  if (source.initial.kind !== 'SENTIENT_ENEMY_AUTHORING')
    throw new Error('Expected actual SENTIENT editor');
  const { connection, socket, states } = await connect(
    source.librarySnapshot,
    source.ownerDeviceId,
  );
  const origin = source.initial.context.versionAttempt?.origin;
  if (origin === undefined) throw new Error('Missing actual owning NAV origin');
  const bytes = Uint8Array.from(
    origin.navigationRequestId.replaceAll('-', '').match(/../g) ?? [],
    (value) => Number.parseInt(value, 16),
  );
  expect(bytes).toHaveLength(16);
  vi.stubGlobal('crypto', {
    getRandomValues: (value: Uint8Array) => {
      value.set(bytes);
      return value;
    },
  });
  expect(connection.requestFormAction('ENM-001::CTA::008')).toEqual({ ok: true });
  const request = w.jsonObject(JSON.parse(socket.sent.at(-1) ?? ''), '$.actualVersionNav');
  expect(request).toMatchObject({
    messageType: 'navigation.form-action',
    actionKey: 'ENM-001::CTA::008',
    sourceFormId: 'ENM-001',
    navigationRequestId: origin.navigationRequestId,
    expectedProjectionRevision: source.librarySnapshot.projectionRevision,
  });
  expect(request['navigationRequestId']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  socket.message(frame(source.initial, 'FORM_ACTION', origin.navigationRequestId));
  expect(states.at(-1)).toMatchObject({
    kind: 'ready',
    snapshot: { formId: 'ENM-017', projection: { context: { versionAttempt: { origin } } } },
  });
}, 60_000);

it('routes the actual App final version control to NEW with the bound reason only after local input is ready', async () => {
  const source = await loadEnemyVersionClientSnapshots('SENTIENT');
  const p = source.reasonApplied;
  if (p.kind !== 'SENTIENT_ENEMY_AUTHORING' || p.context.attemptOrNull === null)
    throw new Error('Expected actual full SENTIENT version candidate');
  const version = p.context.versionAttempt;
  if (version === undefined) throw new Error('Missing actual version reason');
  expect(p.validationErrors).toEqual([]);
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint8Array | Uint32Array) => {
      for (let index = 0; index < values.length; index++) values[index] = index + 1;
      return values;
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ deviceId: source.ownerDeviceId }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
  vi.stubGlobal('WebSocket', Socket);
  window.sessionStorage.setItem(GM_CONTEXT_STORAGE_KEY, p.contextId);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div'),
    root = createRoot(container);
  document.body.append(container);
  try {
    act(() => root.render(createElement(App)));
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const socket = Socket.instances.at(-1);
    if (socket === undefined) throw new Error('App did not open the real client transport');
    act(() => socket.open());
    const reconnect = w.jsonObject(JSON.parse(socket.sent[0] ?? ''), '$.reconnect');
    act(() => {
      socket.message({
        messageType: 'session.reconnect.capabilities',
        protocolVersion: 2,
        reconnectRequestId: reconnect['reconnectRequestId'],
        executableWorkflowCommandIds: ENEMY_AUTHORING_WORKFLOWS,
        revisions: {
          stateRevision: p.stateRevision,
          projectionRevision: p.projectionRevision,
          actorVisibilityRevision: p.actorVisibilityRevision,
        },
      });
      socket.message(frame(p, 'RECONNECT', w.string(reconnect['reconnectRequestId'], '$.id')));
    });
    const finalControl = () => {
      const value = container.querySelector<HTMLButtonElement>(
        '[data-atlas-action-key="ENM-017::CTA::004"]',
      );
      if (value === null) throw new Error('Actual App final version control absent');
      return value;
    };
    const workflows = () =>
      socket.sent
        .map((value) => w.jsonObject(JSON.parse(value), '$.sent'))
        .filter((value) => value['messageType'] === 'command.request');
    expect(finalControl().disabled).toBe(false);
    const reason = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Причина новой версии"]',
    );
    if (reason === null) throw new Error('Actual App reason control absent');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (descriptor?.set === undefined) throw new Error('Native textarea setter absent');
    act(() => {
      descriptor.set?.call(reason, version.reason + ' локальное изменение');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const before = workflows();
    act(() => finalControl().click());
    expect(container.textContent).toContain(
      'Сохраните изменения или вернитесь к подтверждённому вводу новой версии.',
    );
    expect(workflows()).toEqual(before);
    const revert = [...container.querySelectorAll('button')].find(
      (value) => value.textContent === 'Вернуть сохранённую причину и сохранить новый выбор',
    );
    if (revert === undefined) throw new Error('Actual App reason revert control absent');
    act(() => revert.click());
    act(() => finalControl().click());
    const sent = workflows();
    expect(sent).toHaveLength(before.length + 1);
    expect(sent.at(-1)).toMatchObject({
      workflowCommandId: 'UI-CMD-ENEMY-NEW-VERSION',
      expectedRevisions: {
        stateRevision: p.stateRevision,
        projectionRevision: p.projectionRevision,
        actorVisibilityRevision: p.actorVisibilityRevision,
      },
    });
    expect(sent.at(-1)?.['payload']).toEqual({
      campaignId: p.campaignId,
      creationAttemptId: p.context.attemptOrNull.attemptId,
      expectedAttemptRevision: p.context.attemptOrNull.revision,
      reason: version.reason,
    });
  } finally {
    act(() => root.unmount());
    container.remove();
  }
}, 60_000);
