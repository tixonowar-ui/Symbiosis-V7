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
import {
  connectProjection,
  type ProjectionConnection,
  type WebClientState,
} from '../../ws-client.js';
import { GM_CONTEXT_STORAGE_KEY } from '../cmp/campaign-create.js';
import { EnemyAuthoringContent } from './enemy-authoring-content.js';
import { presentedFormDefinition } from '../index.js';

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
function frame(p: EnemyAuthoringProjection, reason: string, correlationId: string) {
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
async function connect(p = fixture(), ownerDeviceId = id(4)) {
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
