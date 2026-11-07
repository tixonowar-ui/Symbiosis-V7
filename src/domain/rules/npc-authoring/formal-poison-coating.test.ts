import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import type { NpcCompositionConsequenceProof } from './composition-consequence-types.js';
import type { NpcOrdinaryCompositionFact } from './ordinary-composition-types.js';
import { createNpcFormalLifeState } from './formal-life-state.js';
import {
  createNpcPoisonSourceCatalog,
  deriveNpcTaipanModeContribution,
  deriveNpcPoisonSourceContribution,
  readNpcPoisonSourceContribution,
  type NpcPoisonSourceCatalog,
  type NpcPoisonSourceObservation,
  type NpcTaipanModeHistoryAnchor,
} from './formal-poison-source.js';

import {
  createNpcFormalPoisonCatalog,
  deriveNpcPreparedPoisonCoating,
  readNpcInventoryCoatingSelection,
  readNpcPoisonPreparationEvidence,
  deriveNpcPoisonPreparationEvidence,
  validateNpcPreparedPoisonCoating,
  readNpcPoisonCoatingContribution,
  npcPoisonCarrierChoices,
  assertNpcInventoryCoatingTarget,
  type NpcFormalPoisonCatalog,
  type NpcPoisonCoatingPreparation,
  type NpcInventoryCoatingContext,
  type NpcPoisonCoatingDerivationContext,
  type NpcPoisonPreparationEvidence,
  type NpcPoisonPreparationHistoryEvent,
} from './formal-poison-coating.js';
import {
  buildNpcInventoryPhysicalBasis,
  buildNpcInventoryPreview,
  buildNpcInventoryPublication,
  readNpcInventoryPublication,
  selectNpcInventoryRestoreRequests,
  readNpcInventoryPublicationRemovals,
  readNpcInventoryPublicationPendingRestoreRequests,
  listNpcInventoryRestoreChoices,
  planNpcInventoryWeaponVersions,
  readNpcInventoryPreview,
  type NpcInventoryPublicationContext,
  type NpcInventoryPublicationProof,
} from './inventory-publication.js';
import { npcKensiRequest } from '../../../../tests/fixtures/npc-published-inventory.js';
import type { NpcInventoryRequestEntry } from './inventory.js';
let coatings: NpcFormalPoisonCatalog;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let source: NpcAuthoringSourceCatalog, catalog: NpcPoisonSourceCatalog;
let inputs: Parameters<typeof createNpcPoisonSourceCatalog>[0];
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const json = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(`${root}/generated/spec/${file}.json`, 'utf8')) as unknown;
  source = await loadNpcAuthoringSourceCatalog(root);
  const forms = (await json('atlas/forms-by-id')) as Record<string, unknown>;
  inputs = {
    compositionConsequences: source.compositionConsequences,
    rules: await json('rules/rules'),
    developmentNodes: await json('character/development-nodes'),
    poisonProfiles: await json('effects/poisons'),
    effectTypes: await json('effects/effect-types'),
    npcInitialStateForm: forms['NPC-016'],
  };
  catalog = createNpcPoisonSourceCatalog(inputs);
  coatings = createNpcFormalPoisonCatalog(
    { source: catalog, publication: source.inventoryPublication },
    {
      poisons: inputs.poisonProfiles,
      operations: await json('items/operations'),
    },
  );
});
const nodes = (level: number, species = 'TAIPAN') =>
  source.development.nodes
    .filter((n) => n.speciesKey === species && n.level <= level)
    .map((n) => n.nodeRef);
function composition(): NpcCompositionConsequenceProof {
  return {
    identityKey: id(1),
    binding: { journalId: id(2), raceCode: 'UNITED' },
    resolutions: [],
    confirmations: [
      {
        confirmationCommandId: id(3),
        diceModeSnapshot: 'MANUAL',
        input: {
          kind: 'APPLY_COMPOSITION_EDIT',
          factId: id(4),
          journalId: id(2),
          ordinal: 1,
          raceCode: 'UNITED',
          removals: [],
          buildChanges: [],
          currentOeChanges: [],
          additions: [
            {
              symbiontInstanceId: id(5),
              speciesKey: 'TAIPAN',
              targetLevel: 1,
              currentOE: 0,
              binding: { kind: 'NONE' },
              learnedNodeRefs: nodes(1),
            },
          ],
        },
      },
    ],
  };
}
function next(
  proof: NpcCompositionConsequenceProof,
  op: number,
  delta: Partial<Pick<NpcOrdinaryCompositionFact, 'buildChanges' | 'removals' | 'additions'>>,
): NpcCompositionConsequenceProof {
  return {
    ...proof,
    confirmations: [
      ...proof.confirmations,
      {
        confirmationCommandId: id(op + 100),
        diceModeSnapshot: 'MANUAL',
        input: {
          kind: 'APPLY_COMPOSITION_EDIT',
          factId: id(op),
          journalId: id(2),
          ordinal: proof.confirmations.length + 1,
          raceCode: 'UNITED',
          removals: [],
          additions: [],
          buildChanges: [],
          currentOeChanges: [],
          ...delta,
        },
      },
    ],
  };
}
function anchor(): NpcTaipanModeHistoryAnchor {
  return {
    kind: 'GM_FORMAL_INITIAL_TAIPAN_MODE',
    campaignId: id(10),
    npcUuid: id(1),
    sourceInstanceId: id(5),
    acquisitionFactId: id(4),
    modeOperationId: id(6),
    effectInstanceId: id(7),
    activePoisonProfileId: 'POI-TAIPAN-DEADLY',
    pendingSwitchOrNull: null,
    reason: 'Подтверждён исходный режим',
    createdAt: '2026-11-07T10:00:00.000Z',
  };
}
function mode(current = composition(), campaignTimestampOrNull: number | null = 37) {
  return deriveNpcTaipanModeContribution(catalog, anchor(), {
    campaignId: id(10),
    npcUuid: id(1),
    campaignTimestampOrNull,
    origin: { kind: 'PREPARED', preparationOperationId: id(6) },
    originalCompositionProof: composition(),
    previousVersionCompositionProofOrNull: null,
    currentCompositionProof: current,
  });
}
function observation(
  proof = composition(),
  operationId = 8,
  kind: NpcPoisonSourceObservation['kind'] = 'PREPARATION',
  at = 37,
  dead = false,
): NpcPoisonSourceObservation {
  return {
    operationId: id(operationId),
    kind,
    campaignTimestamp: at,
    compositionProof: proof,
    life: {
      kind: 'CONFIRMED',
      state: createNpcFormalLifeState(
        source.formalLife,
        {
          kind: 'GM_FORMAL_INITIAL_LIFE',
          campaignId: id(10),
          npcUuid: id(1),
          lifeKind: dead ? 'DEAD' : 'ALIVE',
          initialStateConfirmationId: id(kind === 'LIFE_STATE_SET' ? operationId : 11),
          reason: 'Подтверждено исходное состояние',
          createdAt: '2026-11-07T10:00:00.000Z',
          severeWoundOrNull: null,
        },
        {
          campaignId: id(10),
          npcUuid: id(1),
          currentHP: dead ? 0 : 7,
          campaignTimestampOrNull: at,
        },
        null,
      ),
    },
  };
}
function weapon(itemInstanceId = id(40)): NpcInventoryRequestEntry {
  return {
    ...npcKensiRequest(itemInstanceId),
    itemTypeId: 'ITM-WPN-011',
    currentAmmo: null,
    profile: {
      kind: 'MASTER_WEAPON',
      reason: 'Явные требования мастерского меча',
      inputs: [
        {
          weaponVariantId: 'DEFAULT',
          damageDefinition: { kind: 'RETAIN' },
          penetrationDefinition: { kind: 'RETAIN' },
          statRequirements: { S: 20, D: 20 },
          instanceDamageOrNull: null,
          rangeMetersOrNull: null,
          accuracyBonusOrNull: null,
        },
      ],
    },
  };
}
function prep(): NpcPoisonCoatingPreparation {
  return {
    kind: 'GM_FORMAL_INITIAL_POISON_COATING',
    campaignId: id(10),
    npcUuid: id(1),
    coatingInstanceId: id(60),
    preparationOperationId: id(8),
    sourceInstanceId: id(5),
    targetItemInstanceId: id(40),
    surfaceConfirmed: true,
    replacesCoatingIdOrNull: null,
    replaceConfirmed: false,
    reason: 'Подготовленная исходная доза',
    calendarAnchor: {
      kind: 'PRE_START_INITIAL',
      campaignTimestamp: 37,
      lobbySnapshotRevision: 'a'.repeat(64),
    },
    createdAt: '2026-11-07T10:00:00.000Z',
    revision: 1,
  };
}
const selected = () => [{ ...weapon(), coatingInstanceIds: [id(60)] }];
function preparedContext(
  current = selected(),
  target = 31,
  history: NpcInventoryPublicationContext | null = null,
  observations: readonly NpcPoisonSourceObservation[] = [
    observation(),
    observation(composition(), 31, 'COMMIT'),
  ],
): NpcPoisonCoatingDerivationContext {
  const chosen = mode();
  return {
    campaignId: id(10),
    npcUuid: id(1),
    campaignTimestamp: observations.at(-1)!.campaignTimestamp,
    origin: { kind: 'COMMITTED', originCommitOperationId: id(31) },
    mode: chosen,
    source: deriveNpcPoisonSourceContribution(catalog, chosen, {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: observations.at(-1)!.campaignTimestamp,
      origin: { kind: 'COMMITTED', originCommitOperationId: id(31) },
      targetCommitOperationIdOrNull: id(target),
      observations,
    }),
    originalInventory: buildNpcInventoryPhysicalBasis(source.inventoryPublication, [weapon()]),
    currentInventory: buildNpcInventoryPhysicalBasis(source.inventoryPublication, current, history),
    replaces: null,
  };
}
function context(
  contribution: ReturnType<typeof deriveNpcPreparedPoisonCoating>,
  target = 31,
  timestamp = 37,
): NpcInventoryCoatingContext {
  return {
    catalog: coatings,
    campaignId: id(10),
    npcUuid: id(1),
    campaignTimestamp: timestamp,
    targetCommitOperationIdOrNull: id(target),
    contributions: [contribution],
    removals: [],
  };
}
function proof(): NpcInventoryPublicationProof {
  return {
    npcUuid: id(1),
    commitOperationId: id(31),
    sourceOperationId: 'actual-npc015-confirm',
    actorId: id(12),
    committedAt: '2026-11-07T10:01:00.000Z',
    coatingOrigins: [{ coatingInstanceId: id(60), originCommitOperationId: id(31) }],
    entries: [{ request: selected()[0]!, weaponProfileVersionId: id(41) }],
  };
}
describe('ADR0087 exact physical poison carriers and immutable prepared doses', () => {
  it.each([
    ['POI-TAIPAN-DEADLY', 'SYM-039', 'HALF_PERIODIC_DAMAGE'],
    ['POI-TAIPAN-WEAKENING', 'SYM-042', 'HALF_STAT_DEBUFF_K'],
    ['POI-TAIPAN-PARALYTIC', 'SYM-045', 'HALF_DURATION'],
  ] as const)(
    'retains the learned %s source payload and its precise future delivery reduction',
    (profileId, abilityId, reduction) => {
      const initial = composition();
      const advanced = {
        ...initial,
        confirmations: initial.confirmations.map((confirmation) => ({
          ...confirmation,
          input: {
            ...confirmation.input,
            additions: confirmation.input.additions.map((addition) => ({
              ...addition,
              targetLevel: 7,
              learnedNodeRefs: nodes(7),
            })),
          },
        })),
      };
      const chosen = deriveNpcTaipanModeContribution(
        catalog,
        { ...anchor(), activePoisonProfileId: profileId },
        {
          campaignId: id(10),
          npcUuid: id(1),
          campaignTimestampOrNull: 37,
          origin: { kind: 'PREPARED', preparationOperationId: id(6) },
          originalCompositionProof: advanced,
          previousVersionCompositionProofOrNull: null,
          currentCompositionProof: advanced,
        },
      );
      const sourceContribution = deriveNpcPoisonSourceContribution(catalog, chosen, {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: 37,
        origin: { kind: 'COMMITTED', originCommitOperationId: id(31) },
        targetCommitOperationIdOrNull: id(31),
        observations: [observation(advanced), observation(advanced, 31, 'COMMIT')],
      });
      const token = deriveNpcPreparedPoisonCoating(coatings, prep(), {
        ...preparedContext(),
        mode: chosen,
        source: sourceContribution,
      });
      expect(readNpcPoisonCoatingContribution(coatings, token).coating).toMatchObject({
        sourceAbilityId: abilityId,
        payload: { poisonProfileId: profileId, futureDeliveryRule: reduction },
        originalSourceSnapshot: { targetLevel: 7 },
      });
    },
  );
  it('binds the whole-sheet target composition and actual issued life, not just their NPC and minute', () => {
    const token = deriveNpcPreparedPoisonCoating(coatings, prep(), preparedContext());
    const observed = observation(composition(), 31, 'COMMIT');
    if (observed.life.kind !== 'CONFIRMED')
      throw new Error('expected actual confirmed life fixture');
    const confirmedLife = observed.life.state;
    const target = {
      npcUuid: id(1),
      compositionProof: composition(),
      lifeStateOrNull: confirmedLife,
    };
    expect(() => assertNpcInventoryCoatingTarget(context(token), target)).not.toThrow();
    expect(() =>
      assertNpcInventoryCoatingTarget(context(token), { ...target, lifeStateOrNull: null }),
    ).toThrow();
    expect(() =>
      assertNpcInventoryCoatingTarget(context(token), {
        ...target,
        lifeStateOrNull: structuredClone(confirmedLife),
      }),
    ).toThrow('issued');
    const changedLife = createNpcFormalLifeState(
      source.formalLife,
      confirmedLife.anchor,
      { campaignId: id(10), npcUuid: id(1), currentHP: 8, campaignTimestampOrNull: 37 },
      null,
    );
    expect(() =>
      assertNpcInventoryCoatingTarget(context(token), { ...target, lifeStateOrNull: changedLife }),
    ).toThrow();
    const changedComposition = next(composition(), 20, {
      buildChanges: [
        {
          symbiontInstanceId: id(5),
          targetLevel: 4,
          learnedNodeRefs: nodes(4),
          binding: { kind: 'NONE' },
        },
      ],
    });
    expect(() =>
      assertNpcInventoryCoatingTarget(context(token), {
        ...target,
        compositionProof: changedComposition,
      }),
    ).toThrow();
  });
  it('offers only actual individual melee components/projectiles and never a ranged magazine', () => {
    const ammo = { ...npcKensiRequest(id(42)), itemTypeId: 'RES-AMM-001', currentAmmo: null };
    const rows = [weapon(), ammo, npcKensiRequest(id(43))];
    const basis = buildNpcInventoryPhysicalBasis(source.inventoryPublication, rows);
    expect(
      npcPoisonCarrierChoices(coatings, basis).map((choice) => [
        choice.itemInstanceId,
        choice.kind,
      ]),
    ).toEqual([
      [id(40), 'MELEE_COMPONENT'],
      [id(42), 'PROJECTILE'],
    ]);
    expect(
      npcPoisonCarrierChoices(
        coatings,
        buildNpcInventoryPhysicalBasis(source.inventoryPublication, [{ ...ammo, quantity: 2 }]),
      ),
    ).toEqual([]);
    expect(() => npcPoisonCarrierChoices(coatings, structuredClone(basis))).toThrow('unissued');
  });
  it('distinguishes each real composite attack component without inventing a shield attack or extra surface', () => {
    const pair = ['SWORD', 'SHIELD'].map((componentRole, index) => ({
      ...npcKensiRequest(id(70 + index)),
      itemTypeId: 'ITM-WPN-026',
      currentAmmo: null,
      linkedSetInstanceId: id(72),
      componentRole,
      shieldCurrentHP: index === 1 ? 350 : null,
    }));
    const choices = npcPoisonCarrierChoices(
      coatings,
      buildNpcInventoryPhysicalBasis(source.inventoryPublication, pair),
    );
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      itemInstanceId: id(70),
      componentRole: 'SWORD',
      linkedSetInstanceIdOrNull: id(72),
    });
    expect(() => buildNpcInventoryPhysicalBasis(source.inventoryPublication, [pair[0]])).toThrow();
  });
  it('keeps a confirmed individual custom food profile distinct and stores its full poison payload', () => {
    const food: NpcInventoryRequestEntry = {
      ...npcKensiRequest(id(40)),
      itemTypeId: null,
      currentAmmo: null,
      itemTypeReference: {
        kind: 'CAMPAIGN_CUSTOM_PROFILE',
        profileId: id(80),
        profileVersionId: id(81),
        version: 1,
        reservationOperationId: id(82),
      },
      profile: {
        kind: 'STRUCTURED_CUSTOM',
        name: 'Порция пищи',
        description: 'Одна подтверждённая порция',
        customBonusOrNull: null,
        massKg: null,
        heldSizeClass: 'UNKNOWN',
        armorWeightClass: 'UNKNOWN',
        flammability: 'UNKNOWN',
        isIgnitionSource: false,
        isFood: true,
        canReceivePoison: true,
        canReceiveFlammableCoating: false,
      },
      bonusContainerBinding: { kind: 'NOT_APPLICABLE' },
      customProfileReason: 'Создана GM',
    };
    const target = { ...food, coatingInstanceIds: [id(60)] };
    const derivation = {
      ...preparedContext(),
      originalInventory: buildNpcInventoryPhysicalBasis(source.inventoryPublication, [food]),
      currentInventory: buildNpcInventoryPhysicalBasis(source.inventoryPublication, [target]),
    };
    const contribution = deriveNpcPreparedPoisonCoating(coatings, prep(), derivation);
    expect(readNpcPoisonCoatingContribution(coatings, contribution).coating).toMatchObject({
      carrier: { kind: 'FOOD', itemTypeId: null },
      consumeCondition: 'INGESTION',
      payload: { futureDeliveryRule: 'FULL_PROFILE' },
    });
    const saved = buildNpcInventoryPublication(
      source.inventoryPublication,
      { ...proof(), entries: [{ request: target, weaponProfileVersionId: null }] },
      null,
      context(contribution),
    );
    expect(saved.items[0]?.profileVersions).toEqual([]);
    expect(saved.items[0]?.item.itemTypeId).toBeNull();
    for (const flags of [{ isFood: false }, { canReceivePoison: false }]) {
      const basis = buildNpcInventoryPhysicalBasis(source.inventoryPublication, [
        { ...food, profile: { ...food.profile, ...flags } },
      ]);
      expect(npcPoisonCarrierChoices(coatings, basis)).toEqual([]);
    }
  });
  it('publishes and reads the original unresolved formula/time/identity without activation or target rolls', () => {
    const derivation = preparedContext();
    const contribution = deriveNpcPreparedPoisonCoating(coatings, prep(), derivation);
    const dose = readNpcPoisonCoatingContribution(coatings, contribution).coating;
    expect(dose).toMatchObject({
      coatingInstanceId: id(60),
      hostItemInstanceId: id(40),
      consumptionState: 'ACTIVE',
      effectFamily: 'POISON',
      expiry: null,
      appliedAt: { campaignTimestamp: 37 },
      consumeCondition: 'FIRST_SUCCESSFUL_HIT',
      payload: {
        sourceFormula: 'R20/5+L per turn; duration R20/2',
        futureDeliveryRule: 'HALF_PERIODIC_DAMAGE',
      },
      originalSourceSnapshot: { targetLevel: 1 },
    });
    expect(dose).not.toHaveProperty('r20');
    expect(dose).not.toHaveProperty('targetZ');
    const saved = buildNpcInventoryPublication(
      source.inventoryPublication,
      proof(),
      null,
      context(contribution),
    );
    expect(saved.items[0]?.item.activeCoatings).toEqual([dose]);
    expect(saved.input[0]?.coatings).toEqual([dose]);
    expect(
      readNpcInventoryPublication(
        source.inventoryPublication,
        structuredClone(saved),
        null,
        context(contribution),
      ),
    ).toEqual(saved);
    expect(() => readNpcInventoryPublication(source.inventoryPublication, saved)).toThrow();
    expect(() =>
      validateNpcPreparedPoisonCoating(
        coatings,
        { ...dose, appliedAt: { campaignTimestamp: 38 } },
        prep(),
        derivation,
      ),
    ).toThrow();
    expect(() =>
      buildNpcInventoryPublication(
        source.inventoryPublication,
        {
          ...proof(),
          coatingOrigins: [{ coatingInstanceId: id(60), originCommitOperationId: id(99) }],
        },
        null,
        context(contribution),
      ),
    ).toThrow();
  });
  it('refuses foreign scope, unproved surfaces, changed quantities and overlapping identity domains', () => {
    const derivation = preparedContext();
    for (const patch of [
      { surfaceConfirmed: false },
      { npcUuid: id(99) },
      { sourceInstanceId: id(99) },
      { coatingInstanceId: id(40) },
      { targetItemInstanceId: id(99) },
      { replacesCoatingIdOrNull: id(98), replaceConfirmed: true },
    ])
      expect(() =>
        deriveNpcPreparedPoisonCoating(coatings, { ...prep(), ...patch }, derivation),
      ).toThrow();
    const contribution = deriveNpcPreparedPoisonCoating(coatings, prep(), derivation);
    expect(() =>
      buildNpcInventoryPreview(
        source.inventoryPublication,
        [{ ...selected()[0], quantity: 2 }],
        null,
        context(contribution),
      ),
    ).toThrow();
    expect(() =>
      buildNpcInventoryPreview(
        source.inventoryPublication,
        [{ ...selected()[0], broken: true }],
        null,
        context(contribution),
      ),
    ).toThrow();
    expect(() => readNpcPoisonCoatingContribution(coatings, structuredClone(contribution))).toThrow(
      'unissued',
    );
  });
  it('binds the separate target COMMIT even at the same minute and refuses PREPARED as saved provenance', () => {
    const contribution = deriveNpcPreparedPoisonCoating(coatings, prep(), preparedContext());
    expect(() =>
      buildNpcInventoryPublication(
        source.inventoryPublication,
        { ...proof(), commitOperationId: id(32) },
        null,
        context(contribution, 32),
      ),
    ).toThrow();
    const chosen = mode();
    const draft: NpcPoisonCoatingDerivationContext = {
      ...preparedContext(),
      origin: { kind: 'PREPARED', preparationOperationId: id(8) },
      source: deriveNpcPoisonSourceContribution(catalog, chosen, {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: 37,
        origin: { kind: 'PREPARED', preparationOperationId: id(8) },
        targetCommitOperationIdOrNull: null,
        observations: [observation()],
      }),
    };
    const prepared = deriveNpcPreparedPoisonCoating(coatings, prep(), draft);
    expect(() =>
      buildNpcInventoryPublication(source.inventoryPublication, proof(), null, {
        ...context(prepared),
        targetCommitOperationIdOrNull: null,
      }),
    ).toThrow();
    expect(() =>
      deriveNpcPreparedPoisonCoating(coatings, prep(), { ...draft, campaignTimestamp: 38 }),
    ).toThrow();
  });
  it('recomputes CURRENT L and freezes the last available L while preserving original dose and prior publication bytes', () => {
    const firstToken = deriveNpcPreparedPoisonCoating(coatings, prep(), preparedContext());
    const first = buildNpcInventoryPublication(
      source.inventoryPublication,
      proof(),
      null,
      context(firstToken),
    );
    const frozen = JSON.stringify(first);
    const previous = {
      npcUuid: id(1),
      version: 1,
      sha256: 'a'.repeat(64),
      commitOperationId: id(31),
    };
    const history = { history: [{ ...previous, publication: first }] };
    const stronger = next(composition(), 20, {
      buildChanges: [
        {
          symbiontInstanceId: id(5),
          targetLevel: 4,
          learnedNodeRefs: nodes(4),
          binding: { kind: 'NONE' },
        },
      ],
    });
    const removed = next(stronger, 21, { removals: [id(5)] });
    const original = [observation(), observation(composition(), 31, 'COMMIT')];
    const rows = [
      ...original,
      observation(stronger, 20, 'COMPOSITION_CONFIRMATION', 38),
      observation(removed, 21, 'COMPOSITION_CONFIRMATION', 39),
      observation(removed, 32, 'COMMIT', 40),
    ];
    const nextToken = deriveNpcPreparedPoisonCoating(
      coatings,
      prep(),
      preparedContext(selected(), 32, history, rows),
    );
    const nextDose = readNpcPoisonCoatingContribution(coatings, nextToken).coating;
    expect(nextDose).toMatchObject({
      originalSourceSnapshot: { targetLevel: 1 },
      currentSourceContext: {
        effectiveSourceSnapshot: { targetLevel: 4 },
        resolution: { kind: 'FROZEN', observationOperationId: id(20) },
      },
      appliedAt: { campaignTimestamp: 37 },
      origin: { originCommitOperationId: id(31) },
    });
    const second = buildNpcInventoryPublication(
      source.inventoryPublication,
      { ...proof(), previous, commitOperationId: id(32), committedAt: '2026-11-07T10:02:00.000Z' },
      history,
      context(nextToken, 32, 40),
    );
    expect(second.items[0]?.item.createdAt).toEqual(first.items[0]?.item.createdAt);
    expect(second.items[0]?.item.activeCoatings).toEqual([nextDose]);
    expect(JSON.stringify(first)).toBe(frozen);
    expect(
      readNpcInventoryPublication(
        source.inventoryPublication,
        structuredClone(second),
        history,
        context(nextToken, 32, 40),
      ),
    ).toEqual(second);
  });
  it('requires an actual removal on a retained item, while removal of the whole item preserves earlier history', () => {
    const token = deriveNpcPreparedPoisonCoating(coatings, prep(), preparedContext());
    const first = buildNpcInventoryPublication(
      source.inventoryPublication,
      proof(),
      null,
      context(token),
    );
    const previous = {
      npcUuid: id(1),
      version: 1,
      sha256: 'a'.repeat(64),
      commitOperationId: id(31),
    };
    const history = { history: [{ ...previous, publication: first }] };
    const empty = {
      ...proof(),
      previous,
      commitOperationId: id(32),
      coatingOrigins: [],
      entries: [{ request: weapon(), weaponProfileVersionId: id(41) }],
    };
    const cleared = { ...context(token, 32), contributions: [] };
    expect(() =>
      buildNpcInventoryPublication(source.inventoryPublication, empty, history, cleared),
    ).toThrow('silently lose');
    const removed = buildNpcInventoryPublication(source.inventoryPublication, empty, history, {
      ...cleared,
      removals: [
        {
          kind: 'GM_FORMAL_INITIAL_POISON_COATING_REMOVAL',
          campaignId: id(10),
          npcUuid: id(1),
          coatingInstanceId: id(60),
          targetItemInstanceId: id(40),
          sourceOperationId: id(61),
          reason: 'Явно очищена поверхность',
          createdAt: '2026-11-07T10:02:00.000Z',
        },
      ],
    });
    expect(removed.items[0]?.item.activeCoatings).toEqual([]);
    expect(
      buildNpcInventoryPublication(
        source.inventoryPublication,
        { ...empty, entries: [] },
        history,
        cleared,
      ).items,
    ).toEqual([]);
    expect(first.items[0]?.item.activeCoatings[0]?.consumptionState).toBe('ACTIVE');
  });
  it('replaces one actual prior dose only with separate confirmation and a new immutable identity', () => {
    const oldToken = deriveNpcPreparedPoisonCoating(coatings, prep(), preparedContext());
    const first = buildNpcInventoryPublication(
      source.inventoryPublication,
      proof(),
      null,
      context(oldToken),
    );
    const oldBytes = JSON.stringify(first);
    const previous = {
      npcUuid: id(1),
      version: 1,
      sha256: 'a'.repeat(64),
      commitOperationId: id(31),
    };
    const history = { history: [{ ...previous, publication: first }] };
    const replacement = {
      ...prep(),
      coatingInstanceId: id(61),
      preparationOperationId: id(18),
      replacesCoatingIdOrNull: id(60),
      replaceConfirmed: true,
      calendarAnchor: { ...prep().calendarAnchor, campaignTimestamp: 38 },
    };
    const current = [{ ...weapon(), coatingInstanceIds: [id(61)] }];
    const chosen = mode();
    const derivation: NpcPoisonCoatingDerivationContext = {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 38,
      origin: { kind: 'COMMITTED', originCommitOperationId: id(32) },
      mode: chosen,
      source: deriveNpcPoisonSourceContribution(catalog, chosen, {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: 38,
        origin: { kind: 'COMMITTED', originCommitOperationId: id(32) },
        targetCommitOperationIdOrNull: id(32),
        observations: [
          observation(composition(), 18, 'PREPARATION', 38),
          observation(composition(), 32, 'COMMIT', 38),
        ],
      }),
      originalInventory: buildNpcInventoryPhysicalBasis(
        source.inventoryPublication,
        selected(),
        history,
      ),
      currentInventory: buildNpcInventoryPhysicalBasis(
        source.inventoryPublication,
        current,
        history,
      ),
      replaces: oldToken,
    };
    const token = deriveNpcPreparedPoisonCoating(coatings, replacement, derivation);
    const second = buildNpcInventoryPublication(
      source.inventoryPublication,
      {
        ...proof(),
        previous,
        commitOperationId: id(32),
        coatingOrigins: [{ coatingInstanceId: id(61), originCommitOperationId: id(32) }],
        entries: [{ request: current[0]!, weaponProfileVersionId: id(41) }],
      },
      history,
      context(token, 32, 38),
    );
    expect(second.items[0]?.item.activeCoatings).toHaveLength(1);
    expect(second.items[0]?.item.activeCoatings[0]).toMatchObject({
      coatingInstanceId: id(61),
      replacesCoatingId: id(60),
      consumptionState: 'ACTIVE',
    });
    expect(JSON.stringify(first)).toBe(oldBytes);
    expect(() =>
      deriveNpcPreparedPoisonCoating(
        coatings,
        { ...replacement, replaceConfirmed: false },
        derivation,
      ),
    ).toThrow();
    expect(() =>
      deriveNpcPreparedPoisonCoating(coatings, replacement, { ...derivation, replaces: null }),
    ).toThrow();
    expect(() =>
      deriveNpcPreparedPoisonCoating(coatings, replacement, {
        ...derivation,
        originalInventory: buildNpcInventoryPhysicalBasis(
          source.inventoryPublication,
          [weapon()],
          history,
        ),
      }),
    ).toThrow();
  });
});

describe('durable prepared coatings before the first NPC COMMIT', () => {
  it.each(['REMOVED', 'DEAD', 'SUPPRESSED'] as const)(
    'retains the real earlier dose after %s while refusing a new preparation',
    (change) => {
      const original = composition();
      const stronger = next(original, 19, {
        buildChanges: [
          {
            symbiontInstanceId: id(5),
            targetLevel: 4,
            learnedNodeRefs: nodes(4),
            binding: { kind: 'NONE' },
          },
        ],
      });
      const current =
        change === 'REMOVED'
          ? next(stronger, 20, { removals: [id(5)] })
          : change === 'SUPPRESSED'
            ? next(stronger, 20, {
                additions: [
                  {
                    symbiontInstanceId: id(25),
                    speciesKey: 'TOAD',
                    targetLevel: 1,
                    currentOE: 0,
                    binding: { kind: 'NONE' },
                    learnedNodeRefs: nodes(1, 'TOAD'),
                  },
                ],
              })
            : stronger;
      const last = observation(
        current,
        20,
        change === 'DEAD' ? 'LIFE_STATE_SET' : 'COMPOSITION_CONFIRMATION',
        37,
        change === 'DEAD',
      );
      const rows = [observation(), observation(stronger, 19, 'COMPOSITION_CONFIRMATION'), last];
      const chosen = mode();
      const pendingSource = deriveNpcPoisonSourceContribution(catalog, chosen, {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: 37,
        origin: { kind: 'PREPARED', preparationOperationId: id(8) },
        targetCommitOperationIdOrNull: null,
        observations: rows,
      });
      expect(readNpcPoisonSourceContribution(catalog, pendingSource)).toMatchObject({
        initialPreparationAllowed: true,
        currentPreparationAllowed: false,
        originalSourceSnapshot: { targetLevel: 1 },
        effectiveSourceSnapshot: { targetLevel: 4 },
        resolution: {
          kind: change === 'SUPPRESSED' ? 'CURRENT' : 'FROZEN',
          observationOperationId: id(change === 'SUPPRESSED' ? 20 : 19),
        },
      });
      const pending = deriveNpcPreparedPoisonCoating(coatings, prep(), {
        ...preparedContext(),
        origin: { kind: 'PREPARED', preparationOperationId: id(8) },
        source: pendingSource,
      });
      const pendingContext: NpcInventoryCoatingContext = {
        ...context(pending),
        targetCommitOperationIdOrNull: null,
      };
      const preview = buildNpcInventoryPreview(
        source.inventoryPublication,
        selected(),
        null,
        pendingContext,
      );
      const actual = readNpcPoisonCoatingContribution(coatings, pending).coating;
      expect(preview.items[0]?.activeCoatings).toEqual([actual]);
      expect(
        readNpcInventoryPreview(
          source.inventoryPublication,
          structuredClone(preview),
          null,
          pendingContext,
        ),
      ).toEqual(preview);
      const bytes = JSON.stringify(preview);
      const item = preview.items[0];
      if (item === undefined) throw new Error('Actual prepared item required');
      expect(() =>
        readNpcInventoryPreview(
          source.inventoryPublication,
          {
            items: [
              {
                ...item,
                activeCoatings: [
                  {
                    ...actual,
                    originalSourceSnapshot: { ...actual.originalSourceSnapshot, targetLevel: 99 },
                  },
                ],
              },
            ],
          },
          null,
          pendingContext,
        ),
      ).toThrow();
      expect(JSON.stringify(preview)).toBe(bytes);
      const committedRows = [...rows, { ...observation(current, 31, 'COMMIT'), life: last.life }];
      const committed = deriveNpcPreparedPoisonCoating(
        coatings,
        prep(),
        preparedContext(selected(), 31, null, committedRows),
      );
      const publication = buildNpcInventoryPublication(
        source.inventoryPublication,
        proof(),
        null,
        context(committed),
      );
      expect(publication.input[0]?.coatings[0]).toMatchObject({
        coatingInstanceId: id(60),
        preparationOperationId: id(8),
        appliedAt: { campaignTimestamp: 37 },
        originalSourceSnapshot: { targetLevel: 1 },
        currentSourceContext: {
          effectiveSourceSnapshot: { targetLevel: 4 },
          resolution: { kind: change === 'SUPPRESSED' ? 'CURRENT' : 'FROZEN' },
        },
      });
      expect(
        readNpcInventoryPublication(
          source.inventoryPublication,
          structuredClone(publication),
          null,
          context(committed),
        ),
      ).toEqual(publication);
      expect(() =>
        deriveNpcPoisonSourceContribution(catalog, mode(current), {
          campaignId: id(10),
          npcUuid: id(1),
          campaignTimestamp: 37,
          origin: { kind: 'PREPARED', preparationOperationId: id(99) },
          targetCommitOperationIdOrNull: null,
          observations: [{ ...last, operationId: id(99), kind: 'PREPARATION' }],
        }),
      ).toThrow();
      if (last.life.kind !== 'CONFIRMED') throw new Error('Actual confirmed life history required');
      const sameLifeAtLaterTime = createNpcFormalLifeState(
        source.formalLife,
        last.life.state.anchor,
        {
          campaignId: id(10),
          npcUuid: id(1),
          currentHP: change === 'DEAD' ? 0 : 7,
          campaignTimestampOrNull: 38,
        },
        null,
      );
      expect(sameLifeAtLaterTime.anchor).toEqual(last.life.state.anchor);
      const changedTimeRows = [
        ...rows,
        {
          ...observation(current, 31, 'COMMIT', 38),
          life: { kind: 'CONFIRMED' as const, state: sameLifeAtLaterTime },
        },
      ];
      const stale = deriveNpcPreparedPoisonCoating(
        coatings,
        prep(),
        preparedContext(selected(), 31, null, changedTimeRows),
      );
      expect(() =>
        buildNpcInventoryPublication(
          source.inventoryPublication,
          proof(),
          null,
          context(stale, 31, 38),
        ),
      ).toThrow(/clock changed/);
    },
  );
  it('keeps the exact historical preview shape when no coating is selected', () => {
    const preview = buildNpcInventoryPreview(source.inventoryPublication, [weapon()]);
    expect(preview.items[0]).not.toHaveProperty('activeCoatings');
    expect(readNpcInventoryPreview(source.inventoryPublication, structuredClone(preview))).toEqual(
      preview,
    );
  });
});

describe('actual removal while the physical item is omitted across committed versions', () => {
  it('restores V3 without a dose actually removed in omitted V2, preserving V1 and omission-only history', () => {
    const token = deriveNpcPreparedPoisonCoating(coatings, prep(), preparedContext());
    const first = buildNpcInventoryPublication(
      source.inventoryPublication,
      proof(),
      null,
      context(token),
    );
    const firstBytes = JSON.stringify(first);
    const firstRef = {
      npcUuid: id(1),
      version: 1,
      sha256: 'a'.repeat(64),
      commitOperationId: id(31),
    };
    const firstHistory = { history: [{ ...firstRef, publication: first }] };
    const secondRef = {
      ...firstRef,
      version: 2,
      sha256: 'b'.repeat(64),
      commitOperationId: id(32),
    };
    const removedContext: NpcInventoryCoatingContext = {
      ...context(token, 32),
      contributions: [],
      removals: [
        {
          kind: 'GM_FORMAL_INITIAL_POISON_COATING_REMOVAL',
          campaignId: id(10),
          npcUuid: id(1),
          coatingInstanceId: id(60),
          targetItemInstanceId: id(40),
          sourceOperationId: id(61),
          reason: 'Явно снята доза до исключения предмета из версии',
          createdAt: '2026-11-07T10:02:00.000Z',
        },
      ],
    };
    const secondProof = {
      ...proof(),
      previous: firstRef,
      commitOperationId: id(32),
      coatingOrigins: [],
      entries: [],
    };
    const second = buildNpcInventoryPublication(
      source.inventoryPublication,
      secondProof,
      firstHistory,
      removedContext,
    );
    expect(second.items).toEqual([]);
    expect(second.input).toEqual([]);
    expect(Object.keys(second)).toEqual(Object.keys(first));
    expect(readNpcInventoryPublicationRemovals(source.inventoryPublication, second)).toEqual(
      removedContext.removals,
    );
    expect(() =>
      readNpcInventoryPublicationRemovals(source.inventoryPublication, structuredClone(second)),
    ).toThrow('issued publication');
    expect(() =>
      readNpcInventoryPublicationRemovals({ ...source.inventoryPublication }, second),
    ).toThrow('issued publication');
    const secondBytes = JSON.stringify(second);
    const reconstructedSecond = readNpcInventoryPublication(
      source.inventoryPublication,
      structuredClone(second),
      firstHistory,
      removedContext,
    );
    const history = {
      history: [...firstHistory.history, { ...secondRef, publication: reconstructedSecond }],
    };
    const scope = { npcUuid: id(1), selectedItemInstanceIds: [] };
    const restored = selectNpcInventoryRestoreRequests(
      source.inventoryPublication,
      history,
      scope,
      id(40),
    );
    expect(restored).toEqual([weapon()]);
    const thirdProof = {
      ...proof(),
      previous: secondRef,
      commitOperationId: id(33),
      coatingOrigins: [],
      entries: [{ request: restored[0]!, weaponProfileVersionId: id(41) }],
    };
    const thirdContext = { ...context(token, 33), contributions: [], removals: [] };
    const third = buildNpcInventoryPublication(
      source.inventoryPublication,
      thirdProof,
      history,
      thirdContext,
    );
    expect(third.items[0]?.item.activeCoatings).toEqual([]);
    expect(third.input[0]?.coatings).toEqual([]);
    expect(third.items[0]?.item.provenance).toEqual(first.items[0]?.item.provenance);
    expect(third.items[0]?.item.createdAt).toBe(first.items[0]?.item.createdAt);
    expect(
      readNpcInventoryPublication(
        source.inventoryPublication,
        structuredClone(third),
        history,
        thirdContext,
      ),
    ).toEqual(third);
    const omittedOnly = buildNpcInventoryPublication(
      source.inventoryPublication,
      secondProof,
      firstHistory,
      { ...removedContext, removals: [] },
    );
    expect(readNpcInventoryPublicationRemovals(source.inventoryPublication, omittedOnly)).toEqual(
      [],
    );
    expect(
      selectNpcInventoryRestoreRequests(
        source.inventoryPublication,
        { history: [...firstHistory.history, { ...secondRef, publication: omittedOnly }] },
        scope,
        id(40),
      ),
    ).toEqual(selected());
    expect(JSON.stringify(first)).toBe(firstBytes);
    expect(JSON.stringify(second)).toBe(secondBytes);
    expect(first.items[0]?.item.activeCoatings[0]?.coatingInstanceId).toBe(id(60));
  });
});

describe('original preparation archive without a fabricated current carrier or publication', () => {
  it('keeps pending custom profile reservations owned without pretending they were published', () => {
    const food: NpcInventoryRequestEntry = {
      ...npcKensiRequest(id(40)),
      itemTypeId: null,
      currentAmmo: null,
      itemTypeReference: {
        kind: 'CAMPAIGN_CUSTOM_PROFILE',
        profileId: id(80),
        profileVersionId: id(81),
        version: 1,
        reservationOperationId: id(82),
      },
      profile: {
        kind: 'STRUCTURED_CUSTOM',
        name: 'Подготовленная порция',
        description: 'Фактическая отдельная порция',
        customBonusOrNull: null,
        massKg: null,
        heldSizeClass: 'UNKNOWN',
        armorWeightClass: 'UNKNOWN',
        flammability: 'UNKNOWN',
        isIgnitionSource: false,
        isFood: true,
        canReceivePoison: true,
        canReceiveFlammableCoating: false,
      },
      bonusContainerBinding: { kind: 'NOT_APPLICABLE' },
      customProfileReason: 'Явная подготовка GM',
    };
    const chosen = mode(),
      originalInventory = buildNpcInventoryPhysicalBasis(source.inventoryPublication, [food]);
    const evidence = deriveNpcPoisonPreparationEvidence(coatings, prep(), {
      mode: chosen,
      source: deriveNpcPoisonSourceContribution(catalog, chosen, {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: 37,
        origin: { kind: 'PREPARED', preparationOperationId: id(8) },
        targetCommitOperationIdOrNull: null,
        observations: [observation()],
      }),
      originalInventory,
      replaces: null,
    });
    const timeline: readonly NpcPoisonPreparationHistoryEvent[] = [
      { kind: 'PREPARE', preparation: evidence },
    ];
    const archiveContext: NpcInventoryCoatingContext = {
      catalog: coatings,
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 37,
      targetCommitOperationIdOrNull: id(31),
      contributions: [],
      removals: [],
      preparationHistory: timeline,
    };
    const firstProof = {
      ...proof(),
      entries: [],
      coatingOrigins: [],
      archivedCoatingPreparations: [{ coatingInstanceId: id(60), preparationOperationId: id(8) }],
    };
    const first = buildNpcInventoryPublication(
      source.inventoryPublication,
      firstProof,
      null,
      archiveContext,
    );
    expect(first.items).toEqual([]);
    const bytes = JSON.stringify(first);
    const checked = readNpcInventoryPublication(
      source.inventoryPublication,
      structuredClone(first),
      null,
      archiveContext,
    );
    const reference = {
      npcUuid: id(1),
      version: 1,
      sha256: 'a'.repeat(64),
      commitOperationId: id(31),
    };
    const history = { history: [{ ...reference, publication: checked }] };
    const restored = selectNpcInventoryRestoreRequests(
      source.inventoryPublication,
      history,
      { npcUuid: id(1), selectedItemInstanceIds: [] },
      id(40),
    );
    expect(restored).toEqual([{ ...food, coatingInstanceIds: [id(60)] }]);
    const contribution = deriveNpcPreparedPoisonCoating(coatings, prep(), {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 37,
      origin: { kind: 'COMMITTED', originCommitOperationId: id(32) },
      mode: chosen,
      source: deriveNpcPoisonSourceContribution(catalog, chosen, {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: 37,
        origin: { kind: 'COMMITTED', originCommitOperationId: id(32) },
        targetCommitOperationIdOrNull: id(32),
        observations: [
          observation(),
          observation(composition(), 31, 'COMMIT'),
          observation(composition(), 32, 'COMMIT'),
        ],
      }),
      originalInventory,
      currentInventory: buildNpcInventoryPhysicalBasis(
        source.inventoryPublication,
        restored,
        history,
      ),
      replaces: null,
    });
    const secondProof = {
      ...proof(),
      commitOperationId: id(32),
      previous: reference,
      committedAt: '2026-11-07T10:02:00.000Z',
      coatingOrigins: [{ coatingInstanceId: id(60), originCommitOperationId: id(32) }],
      entries: [{ request: restored[0]!, weaponProfileVersionId: null }],
    };
    const secondContext = { ...context(contribution, 32), preparationHistory: timeline };
    const second = buildNpcInventoryPublication(
      source.inventoryPublication,
      secondProof,
      history,
      secondContext,
    );
    expect(second.items[0]?.profileVersions).toEqual([]);
    expect(second.items[0]?.customProfileVersions).toMatchObject([
      {
        profileId: id(80),
        profileVersionId: id(81),
        itemInstanceId: id(40),
        previousVersionId: null,
        reservationOperationId: id(82),
        createdAt: secondProof.committedAt,
        beforeProfile: null,
        afterProfile: food.profile,
      },
    ]);
    expect(
      readNpcInventoryPublication(
        source.inventoryPublication,
        structuredClone(second),
        history,
        secondContext,
      ),
    ).toEqual(second);
    const archivedAtSecond = { ...archiveContext, targetCommitOperationIdOrNull: id(32) };
    for (const reserved of [id(80), id(81)]) {
      expect(() =>
        buildNpcInventoryPublication(
          source.inventoryPublication,
          {
            ...firstProof,
            previous: reference,
            commitOperationId: id(32),
            entries: [{ request: weapon(reserved), weaponProfileVersionId: id(50) }],
          },
          history,
          archivedAtSecond,
        ),
      ).toThrow('historical profile identity');
      expect(() =>
        buildNpcInventoryPublication(
          source.inventoryPublication,
          {
            ...firstProof,
            previous: reference,
            commitOperationId: id(32),
            entries: [{ request: weapon(id(90)), weaponProfileVersionId: reserved }],
          },
          history,
          archivedAtSecond,
        ),
      ).toThrow('historical');
    }
    expect(() =>
      buildNpcInventoryPublication(
        source.inventoryPublication,
        {
          ...firstProof,
          previous: reference,
          commitOperationId: id(32),
          entries: [{ request: { ...food, itemInstanceId: id(90) }, weaponProfileVersionId: null }],
        },
        history,
        archivedAtSecond,
      ),
    ).toThrow('pending custom profile belongs to another physical identity');
    expect(JSON.stringify(first)).toBe(bytes);
  });
  it.each(['WEAPON', 'COMPOSITE'] as const)(
    'restores a never-published %s from original preparation evidence and first publishes real profiles afterward',
    (kind) => {
      const rows: readonly NpcInventoryRequestEntry[] =
        kind === 'WEAPON'
          ? [weapon()]
          : (['SWORD', 'SHIELD'] as const).map((componentRole, index) => ({
              ...npcKensiRequest(id(40 + index)),
              itemTypeId: 'ITM-WPN-026',
              currentAmmo: null,
              linkedSetInstanceId: id(42),
              componentRole,
              shieldCurrentHP: index === 1 ? 350 : null,
            }));
      const chosen = mode();
      const originalSource = deriveNpcPoisonSourceContribution(catalog, chosen, {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: 37,
        origin: { kind: 'PREPARED', preparationOperationId: id(8) },
        targetCommitOperationIdOrNull: null,
        observations: [observation()],
      });
      // An unrelated reservation at the same preparation is not a restore grant.
      const unrelated = npcKensiRequest(id(90));
      const originalInventory = buildNpcInventoryPhysicalBasis(source.inventoryPublication, [
        ...rows,
        unrelated,
      ]);
      const evidence = deriveNpcPoisonPreparationEvidence(coatings, prep(), {
        mode: chosen,
        source: originalSource,
        originalInventory,
        replaces: null,
      });
      const timeline: readonly NpcPoisonPreparationHistoryEvent[] = [
        { kind: 'PREPARE', preparation: evidence },
      ];
      const archived = [{ coatingInstanceId: id(60), preparationOperationId: id(8) }];
      const archiveContext: NpcInventoryCoatingContext = {
        catalog: coatings,
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: 37,
        targetCommitOperationIdOrNull: id(31),
        contributions: [],
        removals: [],
        preparationHistory: timeline,
      };
      const firstProof = {
        ...proof(),
        entries: [],
        coatingOrigins: [],
        archivedCoatingPreparations: archived,
      };
      const first = buildNpcInventoryPublication(
        source.inventoryPublication,
        firstProof,
        null,
        archiveContext,
      );
      expect(first.items).toEqual([]);
      expect(first.input).toEqual([]);
      expect(first.proof.coatingOrigins).toEqual([]);
      const firstBytes = JSON.stringify(first);
      const checked = readNpcInventoryPublication(
        source.inventoryPublication,
        structuredClone(first),
        null,
        archiveContext,
      );
      const reference = {
        npcUuid: id(1),
        version: 1,
        sha256: 'a'.repeat(64),
        commitOperationId: id(31),
      };
      const history = { history: [{ ...reference, publication: checked }] };
      const expected = rows.map((row) => ({
        ...row,
        coatingInstanceIds: row.itemInstanceId === id(40) ? [id(60)] : [],
      }));
      const scope = { npcUuid: id(1), selectedItemInstanceIds: [] };
      expect(
        readNpcInventoryPublicationPendingRestoreRequests(source.inventoryPublication, checked),
      ).toEqual(expected);
      expect(listNpcInventoryRestoreChoices(source.inventoryPublication, history, scope)).toEqual([
        {
          itemInstanceId: id(40),
          itemInstanceIds: rows.map((row) => row.itemInstanceId),
          linkedSetInstanceIdOrNull: kind === 'COMPOSITE' ? id(42) : null,
          originKind: 'PENDING_PREPARATION',
        },
      ]);
      const restored = selectNpcInventoryRestoreRequests(
        source.inventoryPublication,
        history,
        scope,
        id(40),
      );
      expect(restored).toEqual(expected);
      expect(
        listNpcInventoryRestoreChoices(source.inventoryPublication, history, {
          ...scope,
          selectedItemInstanceIds: [rows.at(-1)!.itemInstanceId],
        }),
      ).toEqual([]);
      expect(() =>
        selectNpcInventoryRestoreRequests(source.inventoryPublication, history, scope, id(90)),
      ).toThrow();
      expect(() =>
        selectNpcInventoryRestoreRequests(
          source.inventoryPublication,
          history,
          { ...scope, npcUuid: id(99) },
          id(40),
        ),
      ).toThrow();
      expect(() =>
        readNpcInventoryPublicationPendingRestoreRequests(
          source.inventoryPublication,
          structuredClone(checked),
        ),
      ).toThrow('issued');
      const contribution = deriveNpcPreparedPoisonCoating(coatings, prep(), {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: 37,
        origin: { kind: 'COMMITTED', originCommitOperationId: id(32) },
        mode: chosen,
        source: deriveNpcPoisonSourceContribution(catalog, chosen, {
          campaignId: id(10),
          npcUuid: id(1),
          campaignTimestamp: 37,
          origin: { kind: 'COMMITTED', originCommitOperationId: id(32) },
          targetCommitOperationIdOrNull: id(32),
          observations: [
            observation(),
            observation(composition(), 31, 'COMMIT'),
            observation(composition(), 32, 'COMMIT'),
          ],
        }),
        originalInventory,
        currentInventory: buildNpcInventoryPhysicalBasis(
          source.inventoryPublication,
          restored,
          history,
        ),
        replaces: null,
      });
      const currentContext = { ...context(contribution, 32), preparationHistory: timeline };
      const plan = planNpcInventoryWeaponVersions(
        source.inventoryPublication,
        restored,
        history,
        currentContext,
      );
      expect(plan).toEqual(
        rows.map((row, index) =>
          index === 0
            ? {
                itemInstanceId: row.itemInstanceId,
                kind: 'ALLOCATE',
                previousVersionIdOrNull: null,
              }
            : { itemInstanceId: row.itemInstanceId, kind: 'ABSENT' },
        ),
      );
      const secondProof = {
        ...proof(),
        previous: reference,
        commitOperationId: id(32),
        committedAt: '2026-11-07T10:02:00.000Z',
        coatingOrigins: [{ coatingInstanceId: id(60), originCommitOperationId: id(32) }],
        entries: restored.map((request, index) => ({
          request,
          weaponProfileVersionId: index === 0 ? id(50) : null,
        })),
      };
      const second = buildNpcInventoryPublication(
        source.inventoryPublication,
        secondProof,
        history,
        currentContext,
      );
      expect(second.items).toHaveLength(rows.length);
      expect(second.items[0]?.item.createdAt).toBe(secondProof.committedAt);
      expect(second.items[0]?.profileVersions[0]?.previousVersionId).toBeNull();
      expect(second.items[0]?.profileVersions[0]?.createdAt).toBe(secondProof.committedAt);
      expect(second.items[0]?.item.activeCoatings[0]?.origin).toEqual({
        kind: 'COMMITTED',
        originCommitOperationId: id(32),
      });
      expect(
        readNpcInventoryPublication(
          source.inventoryPublication,
          structuredClone(second),
          history,
          currentContext,
        ),
      ).toEqual(second);
      expect(() =>
        buildNpcInventoryPublication(
          source.inventoryPublication,
          {
            ...secondProof,
            entries: secondProof.entries.map((entry, index) =>
              index === 0
                ? {
                    ...entry,
                    request: { ...entry.request, issueReason: 'Подменённое происхождение' },
                  }
                : entry,
            ),
          },
          history,
          currentContext,
        ),
      ).toThrow();
      const removal = {
        kind: 'GM_FORMAL_INITIAL_POISON_COATING_REMOVAL' as const,
        campaignId: id(10),
        npcUuid: id(1),
        coatingInstanceId: id(60),
        targetItemInstanceId: id(40),
        sourceOperationId: id(66),
        reason: 'Явно снята устаревшая подготовка',
        createdAt: '2026-11-07T10:03:00.000Z',
      };
      const removed = buildNpcInventoryPublication(
        source.inventoryPublication,
        {
          ...firstProof,
          archivedCoatingPreparations: [],
        },
        null,
        {
          ...archiveContext,
          removals: [removal],
          preparationHistory: [...timeline, { kind: 'REMOVE', removal }],
        },
      );
      expect(
        selectNpcInventoryRestoreRequests(
          source.inventoryPublication,
          { history: [{ ...reference, publication: removed }] },
          scope,
          id(40),
        ),
      ).toEqual(rows);
      expect(JSON.stringify(first)).toBe(firstBytes);
    },
  );
  it('retains an omitted replacement across V2 and first publishes it in V3 only at its original minute', () => {
    const evidence = (
      preparation: NpcPoisonCoatingPreparation,
      op: number,
      requests: readonly NpcInventoryRequestEntry[],
      replaces: NpcPoisonPreparationEvidence | null,
      at = 37,
    ) => {
      const chosen = mode(composition(), at);
      const originalSource = deriveNpcPoisonSourceContribution(catalog, chosen, {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: at,
        origin: { kind: 'PREPARED', preparationOperationId: id(op) },
        targetCommitOperationIdOrNull: null,
        observations: [observation(composition(), op, 'PREPARATION', at)],
      });
      return deriveNpcPoisonPreparationEvidence(coatings, preparation, {
        mode: chosen,
        source: originalSource,
        originalInventory: buildNpcInventoryPhysicalBasis(source.inventoryPublication, requests),
        replaces,
      });
    };
    const oldEvidence = evidence(prep(), 8, [weapon()], null);
    const firstToken = deriveNpcPreparedPoisonCoating(coatings, prep(), preparedContext());
    const firstTimeline: readonly NpcPoisonPreparationHistoryEvent[] = [
      { kind: 'PREPARE', preparation: oldEvidence },
    ];
    const first = buildNpcInventoryPublication(source.inventoryPublication, proof(), null, {
      ...context(firstToken),
      preparationHistory: firstTimeline,
    });
    const firstBytes = JSON.stringify(first);
    const firstRef = {
      npcUuid: id(1),
      version: 1,
      sha256: 'a'.repeat(64),
      commitOperationId: id(31),
    };
    const firstHistory = { history: [{ ...firstRef, publication: first }] };
    const replacement = {
      ...prep(),
      coatingInstanceId: id(61),
      preparationOperationId: id(62),
      replacesCoatingIdOrNull: id(60),
      replaceConfirmed: true,
    };
    const newEvidence = evidence(replacement, 62, selected(), oldEvidence);
    const timeline: readonly NpcPoisonPreparationHistoryEvent[] = [
      ...firstTimeline,
      { kind: 'PREPARE', preparation: newEvidence },
    ];
    const archived = [{ coatingInstanceId: id(61), preparationOperationId: id(62) }];
    const secondRef = {
      ...firstRef,
      version: 2,
      sha256: 'b'.repeat(64),
      commitOperationId: id(32),
    };
    const secondProof = {
      ...proof(),
      previous: firstRef,
      commitOperationId: id(32),
      coatingOrigins: [],
      archivedCoatingPreparations: archived,
      entries: [],
    };
    const archivedContext = {
      ...context(firstToken, 32),
      contributions: [],
      preparationHistory: timeline,
    };
    const second = buildNpcInventoryPublication(
      source.inventoryPublication,
      secondProof,
      firstHistory,
      archivedContext,
    );
    expect(second.items).toEqual([]);
    expect(second.input).toEqual([]);
    expect(second.proof.coatingOrigins).toEqual([]);
    expect(second.proof.archivedCoatingPreparations).toEqual(archived);
    const secondBytes = JSON.stringify(second);
    const reconstructed = readNpcInventoryPublication(
      source.inventoryPublication,
      structuredClone(second),
      firstHistory,
      archivedContext,
    );
    const history = {
      history: [...firstHistory.history, { ...secondRef, publication: reconstructed }],
    };
    const restored = selectNpcInventoryRestoreRequests(
      source.inventoryPublication,
      history,
      { npcUuid: id(1), selectedItemInstanceIds: [] },
      id(40),
    );
    expect(restored).toEqual([{ ...weapon(), coatingInstanceIds: [id(61)] }]);
    const chosen = mode();
    const prepareSource = (at: number, saved: boolean) =>
      deriveNpcPoisonSourceContribution(catalog, chosen, {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: at,
        origin: saved
          ? { kind: 'COMMITTED', originCommitOperationId: id(33) }
          : { kind: 'PREPARED', preparationOperationId: id(62) },
        targetCommitOperationIdOrNull: saved ? id(33) : null,
        observations: [
          observation(composition(), 62, 'PREPARATION'),
          observation(composition(), 32, 'COMMIT'),
          ...(saved || at !== 37 ? [observation(composition(), 33, 'COMMIT', at)] : []),
        ],
      });
    const visible = (at: number, saved: boolean) =>
      deriveNpcPreparedPoisonCoating(coatings, replacement, {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: at,
        origin: saved
          ? { kind: 'COMMITTED', originCommitOperationId: id(33) }
          : { kind: 'PREPARED', preparationOperationId: id(62) },
        mode: chosen,
        source: prepareSource(at, saved),
        originalInventory: buildNpcInventoryPhysicalBasis(
          source.inventoryPublication,
          selected(),
          firstHistory,
        ),
        currentInventory: buildNpcInventoryPhysicalBasis(
          source.inventoryPublication,
          restored,
          history,
        ),
        replaces: firstToken,
      });
    const preparedVisible = visible(37, false);
    expect(readNpcPoisonCoatingContribution(coatings, preparedVisible).coating.origin).toEqual({
      kind: 'PREPARED',
      preparationOperationId: id(62),
    });
    const preview = buildNpcInventoryPreview(source.inventoryPublication, restored, history, {
      ...context(preparedVisible),
      targetCommitOperationIdOrNull: null,
      preparationHistory: timeline,
    });
    expect(preview.items[0]?.activeCoatings?.[0]?.coatingInstanceId).toBe(id(61));
    const thirdToken = visible(37, true);
    const thirdProof = {
      ...proof(),
      previous: secondRef,
      commitOperationId: id(33),
      coatingOrigins: [{ coatingInstanceId: id(61), originCommitOperationId: id(33) }],
      entries: [{ request: restored[0]!, weaponProfileVersionId: id(41) }],
    };
    const thirdContext = { ...context(thirdToken, 33), preparationHistory: timeline };
    const third = buildNpcInventoryPublication(
      source.inventoryPublication,
      thirdProof,
      history,
      thirdContext,
    );
    expect(third.items[0]?.item.activeCoatings[0]).toMatchObject({
      coatingInstanceId: id(61),
      replacesCoatingId: id(60),
      preparationOperationId: id(62),
      origin: { kind: 'COMMITTED', originCommitOperationId: id(33) },
      appliedAt: { campaignTimestamp: 37 },
    });
    expect(third.proof).not.toHaveProperty('archivedCoatingPreparations');
    expect(
      readNpcInventoryPublication(
        source.inventoryPublication,
        structuredClone(third),
        history,
        thirdContext,
      ),
    ).toEqual(third);
    expect(() => visible(38, false)).toThrow('initial clock');
    expect(() =>
      buildNpcInventoryPublication(source.inventoryPublication, thirdProof, history, {
        ...context(visible(38, true), 33, 38),
        preparationHistory: timeline,
      }),
    ).toThrow('clock changed');
    // The archive is only an actual preparation reference, so a later clock may
    // make restoration stale without turning an omitted dose into an active fact.
    expect(
      buildNpcInventoryPublication(source.inventoryPublication, secondProof, firstHistory, {
        ...archivedContext,
        campaignTimestamp: 38,
      }).items,
    ).toEqual([]);
    const removal = {
      kind: 'GM_FORMAL_INITIAL_POISON_COATING_REMOVAL' as const,
      campaignId: id(10),
      npcUuid: id(1),
      coatingInstanceId: id(61),
      targetItemInstanceId: id(40),
      sourceOperationId: id(66),
      reason: 'Явно снять устаревшую подготовку',
      createdAt: '2026-11-07T10:03:00.000Z',
    };
    const removedContext = {
      ...context(firstToken, 33, 38),
      contributions: [],
      removals: [removal],
      preparationHistory: [...timeline, { kind: 'REMOVE' as const, removal }],
    };
    const removedProof = {
      ...thirdProof,
      coatingOrigins: [],
      entries: [{ request: weapon(), weaponProfileVersionId: id(41) }],
    };
    const cleared = buildNpcInventoryPublication(
      source.inventoryPublication,
      removedProof,
      history,
      removedContext,
    );
    expect(cleared.items[0]?.item.activeCoatings).toEqual([]);
    expect(cleared.proof).not.toHaveProperty('archivedCoatingPreparations');
    const nextPreparation = {
      ...replacement,
      coatingInstanceId: id(71),
      preparationOperationId: id(72),
      replacesCoatingIdOrNull: id(61),
      calendarAnchor: { ...prep().calendarAnchor, campaignTimestamp: 38 },
    };
    const nextEvidence = evidence(nextPreparation, 72, restored, newEvidence, 38);
    const nextTimeline: readonly NpcPoisonPreparationHistoryEvent[] = [
      ...timeline,
      { kind: 'PREPARE', preparation: nextEvidence },
    ];
    const nextArchive = readNpcInventoryCoatingSelection(
      source.inventoryPublication,
      { ...archivedContext, campaignTimestamp: 38, preparationHistory: nextTimeline },
      [],
    );
    expect(nextArchive.archivedPreparations).toEqual([
      { coatingInstanceId: id(71), preparationOperationId: id(72) },
    ]);
    for (const changed of [
      { ...archivedContext, preparationHistory: [...firstTimeline, ...firstTimeline] },
      { ...archivedContext, preparationHistory: [timeline[1]!] },
      {
        ...archivedContext,
        preparationHistory: [
          ...timeline,
          { kind: 'REMOVE' as const, removal: { ...removal, coatingInstanceId: id(60) } },
        ],
        removals: [{ ...removal, coatingInstanceId: id(60) }],
      },
    ])
      expect(() =>
        buildNpcInventoryPublication(
          source.inventoryPublication,
          secondProof,
          firstHistory,
          changed,
        ),
      ).toThrow();
    expect(() => readNpcPoisonPreparationEvidence(coatings, structuredClone(newEvidence))).toThrow(
      'unissued',
    );
    expect(() =>
      buildNpcInventoryPublication(
        source.inventoryPublication,
        {
          ...secondProof,
          archivedCoatingPreparations: [{ ...archived[0]!, preparationOperationId: id(99) }],
        },
        firstHistory,
        archivedContext,
      ),
    ).toThrow();
    expect(() =>
      buildNpcInventoryPreview(source.inventoryPublication, selected(), history, {
        ...context(firstToken),
        preparationHistory: timeline,
      }),
    ).toThrow();
    expect(JSON.stringify(first)).toBe(firstBytes);
    expect(JSON.stringify(second)).toBe(secondBytes);
  });
});
