import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ENEMY_AUTHORING_WORKFLOWS,
  ENEMY_PLACEHOLDER_SHA256,
  enemyAuthoringActions,
  enemyAuthoringProjectionValue,
  type EnemyAuthoringProjection,
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
async function connect() {
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
        new Response(JSON.stringify({ deviceId: id(4) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
  vi.stubGlobal('WebSocket', Socket);
  window.sessionStorage.setItem(GM_CONTEXT_STORAGE_KEY, id(1));
  const states: WebClientState[] = [],
    connection = connectProjection((state) => states.push(state));
  connections.push(connection);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const socket = Socket.instances.at(-1)!;
  socket.open();
  const request = JSON.parse(socket.sent[0]!) as { reconnectRequestId: string };
  const p = fixture();
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
  expect(states.at(-1)).toMatchObject({ kind: 'ready', snapshot: { formId: 'ENM-007' } });
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
