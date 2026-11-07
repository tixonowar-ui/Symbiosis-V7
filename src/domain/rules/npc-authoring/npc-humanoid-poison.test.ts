import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import { npcCleanHumanoidFixture } from '../../../../tests/fixtures/npc-clean-humanoid.js';
import { npcKensiRequest } from '../../../../tests/fixtures/npc-published-inventory.js';
import { deriveNpcOrdinaryStatProfile } from './npc-ordinary-humanoid-sheet.js';
import { evaluateNpcSkills, type NpcSkillProof } from './skill-evaluation.js';
import {
  buildNpcHumanoidSnapshot,
  previewNpcHumanoid,
  readNpcHumanoidSnapshot,
  type NpcHumanoidBuildInput,
} from './npc-humanoid-sheet.js';
import { createNpcFormalLifeState, type NpcFormalLifeHistoryAnchor } from './formal-life-state.js';
import type { NpcHumanoidLifeContext, NpcHumanoidLifePreview } from './humanoid-life-boundary.js';
import type { NpcCompositionConsequenceProof } from './composition-consequence-types.js';
import {
  buildNpcInventoryPhysicalBasis,
  buildNpcInventoryPublication,
  type NpcInventoryPublicationProof,
  type NpcInventoryPublicationContext,
} from './inventory-publication.js';
import {
  deriveNpcTaipanModeContribution,
  deriveNpcPoisonSourceContribution,
  type NpcTaipanModeHistoryAnchor,
  type NpcPoisonSourceObservation,
} from './formal-poison-source.js';
import {
  deriveNpcPreparedPoisonCoating,
  deriveNpcPoisonPreparationEvidence,
  readNpcPoisonCoatingContribution,
  type NpcInventoryCoatingContext,
  type NpcPoisonCoatingPreparation,
} from './formal-poison-coating.js';
import {
  deriveNpcInitialTaipanModeStates,
  npcHumanoidPoisonProofForTarget,
  type NpcHumanoidPoisonContext,
} from './taipan-mode-state.js';

let source: NpcAuthoringSourceCatalog;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
beforeAll(async () => {
  source = await loadNpcAuthoringSourceCatalog(
    fileURLToPath(new URL('../../../../', import.meta.url)),
  );
  if (source.poisonSource === null || source.poisonCoatings === null)
    throw new Error('Delivered ADR0087 sources required for whole-sheet scenario');
});
function sourceCatalog() {
  if (source.poisonSource === null) throw new Error('Delivered poison source required');
  return source.poisonSource;
}
function carrierCatalog() {
  if (source.poisonCoatings === null) throw new Error('Delivered coating source required');
  return source.poisonCoatings;
}
function initial(): NpcHumanoidBuildInput {
  const clean = npcCleanHumanoidFixture(source, {
    npcUuid: id(1),
    owningControllerId: id(2),
    contextFactId: id(74),
    compositionJournalId: id(6),
  });
  const schema = {
    raceCode: 'UNITED',
    pureClassOrNull: null,
    anatomyProfileId: 'STANDARD_HUMANOID',
    sex: 'MALE',
    massKg: 75,
  } as const;
  const member = {
    symbiontInstanceId: id(70),
    speciesKey: 'TAIPAN' as const,
    targetLevel: 1,
    currentOE: 0,
    binding: { kind: 'NONE' as const },
    learnedNodeRefs: source.development.nodes
      .filter((n) => n.speciesKey === 'TAIPAN' && n.level <= 1)
      .map((n) => n.nodeRef),
  };
  const compositionProof: NpcCompositionConsequenceProof = {
    identityKey: id(1),
    binding: { journalId: id(6), raceCode: 'UNITED' },
    resolutions: [],
    confirmations: [
      {
        confirmationCommandId: id(71),
        diceModeSnapshot: 'MANUAL',
        input: {
          kind: 'APPLY_COMPOSITION_EDIT',
          factId: id(72),
          journalId: id(6),
          ordinal: 1,
          raceCode: 'UNITED',
          additions: [member],
          removals: [],
          buildChanges: [],
          currentOeChanges: [],
        },
      },
    ],
  };
  const baseStats = { S: 20, D: 20, M: 20, Z: 20, I: 5, W: 2, C: 20 };
  const ordinaryProof = {
    currentStatContextFactId: id(74),
    statContexts: [73, 74].map((n) => ({
      contextFactId: id(n),
      schema,
      baseStats,
      compositionOrdinal: 1,
      resolutionOrdinal: 0,
    })),
  };
  const profile = deriveNpcOrdinaryStatProfile(source.ordinaryHumanoid, {
    npcUuid: id(1),
    compositionProof,
    ordinaryProof,
  });
  const stealth = source.skills.skills.find((s) => s.skillKey === 'STEALTH');
  if (stealth === undefined) throw new Error('Actual source STEALTH required');
  const skillProof: NpcSkillProof = {
    identityKey: id(1),
    contexts: [73, 74].map((n, index) => ({
      contextFactId: id(n),
      ordinal: index + 1,
      stage: index === 0 ? 'START_SELECTION' : 'CONFIRMED',
      raceCode: 'UNITED',
      classCode: null,
      skillStageStats: profile.current.stats.skillStageStats,
      permanentStats: profile.current.stats.permanentStats,
      effectiveStats: profile.current.stats.effectiveStats,
      grossGrantSourceOrNull: null,
      sym166SourceOrNull: null,
      facts:
        index === 0
          ? [
              {
                kind: 'PAID_ACQUISITION',
                factId: `NPC_INITIAL_SKILL/${id(3)}/1`,
                ordinal: 1,
                contextFactId: id(73),
                skillKey: stealth.skillKey,
                bonusBefore: 0,
                bonusAfter: 1,
                chargedSlotCost: 1,
                pool: 'START',
              },
            ]
          : [],
    })),
  };
  const skills = evaluateNpcSkills(source.skills, {
    identityKey: id(1),
    mode: 'CREATE_V1',
    previousConfirmedProofOrNull: null,
    proof: skillProof,
  });
  const inventoryProof: NpcInventoryPublicationProof = {
    npcUuid: id(1),
    commitOperationId: id(3),
    sourceOperationId: 'actual-npc015-confirm',
    actorId: id(2),
    committedAt: '2026-11-07T10:00:00.000Z',
    entries: [
      {
        request: {
          ...npcKensiRequest(id(84)),
          itemTypeId: 'RES-AMM-001',
          currentAmmo: null,
        },
        weaponProfileVersionId: null,
      },
    ],
  };
  const inventory = buildNpcInventoryPublication(source.inventoryPublication, inventoryProof);
  return {
    ...clean,
    compositionProof,
    ordinaryProof,
    skillProof,
    inventoryProof,
    input: {
      ...clean.input,
      identity: { ...clean.input.identity, ...schema },
      baseStats,
      symbionts: [member],
      skills: skills.ledger,
      lifetimeFacts: profile.current.composition.lifetimeFacts,
      inventory: inventory.input,
      initialState: { ...clean.input.initialState, currentHP: 7 },
    },
  };
}
function life(
  value: NpcHumanoidBuildInput,
  timestamp: number | null,
  target = 3,
): NpcHumanoidLifeContext {
  const history: NpcFormalLifeHistoryAnchor = {
    kind: 'GM_FORMAL_INITIAL_LIFE',
    campaignId: id(10),
    npcUuid: id(1),
    lifeKind: 'ALIVE',
    initialStateConfirmationId: id(86),
    reason: 'Подтверждённое исходное состояние',
    createdAt: '2026-11-07T10:00:00.000Z',
    severeWoundOrNull: null,
  };
  const state = createNpcFormalLifeState(
    source.formalLife,
    history,
    {
      campaignId: id(10),
      npcUuid: id(1),
      currentHP: value.input.initialState.currentHP,
      campaignTimestampOrNull: timestamp,
    },
    null,
  );
  return {
    campaignId: id(10),
    npcUuid: id(1),
    commitOperationId: id(target),
    originCommitOperationId: id(3),
    campaignTimestampOrNull: timestamp,
    history,
    state,
    entryDuplicateProofOrNull: null,
    previousLifeKindOrNull: target === 3 ? null : 'ALIVE',
  };
}
function mode(value: NpcHumanoidBuildInput, timestamp: number | null, prepared = false) {
  const history: NpcTaipanModeHistoryAnchor = {
    kind: 'GM_FORMAL_INITIAL_TAIPAN_MODE',
    campaignId: id(10),
    npcUuid: id(1),
    sourceInstanceId: id(70),
    acquisitionFactId: id(72),
    modeOperationId: id(81),
    effectInstanceId: id(82),
    activePoisonProfileId: 'POI-TAIPAN-DEADLY',
    pendingSwitchOrNull: null,
    reason: 'Явный исходный режим',
    createdAt: '2026-11-07T10:00:00.000Z',
  };
  return deriveNpcTaipanModeContribution(sourceCatalog(), history, {
    campaignId: id(10),
    npcUuid: id(1),
    campaignTimestampOrNull: timestamp,
    origin: prepared
      ? { kind: 'PREPARED', preparationOperationId: id(81) }
      : { kind: 'COMMITTED', originCommitOperationId: id(3) },
    originalCompositionProof: value.compositionProof,
    previousVersionCompositionProofOrNull: null,
    currentCompositionProof: value.compositionProof,
  });
}
function poison(
  value: NpcHumanoidBuildInput,
  lifeContext: NpcHumanoidLifeContext,
  coating: boolean,
  target = 3,
  prepared = false,
  inventoryHistory: NpcInventoryPublicationContext | null = null,
): NpcHumanoidPoisonContext {
  const chosen = mode(value, lifeContext.campaignTimestampOrNull, prepared);
  let coatingContext: NpcInventoryCoatingContext | null = null;
  if (coating) {
    if (lifeContext.campaignTimestampOrNull !== 37)
      throw new Error('Explicit source clock required');
    const preparation: NpcPoisonCoatingPreparation = {
      kind: 'GM_FORMAL_INITIAL_POISON_COATING',
      campaignId: id(10),
      npcUuid: id(1),
      coatingInstanceId: id(85),
      preparationOperationId: id(80),
      sourceInstanceId: id(70),
      targetItemInstanceId: id(84),
      surfaceConfirmed: true,
      replacesCoatingIdOrNull: null,
      replaceConfirmed: false,
      reason: 'Одна исходная доза на отдельной стреле',
      calendarAnchor: {
        kind: 'PRE_START_INITIAL',
        campaignTimestamp: 37,
        lobbySnapshotRevision: 'a'.repeat(64),
      },
      createdAt: '2026-11-07T10:00:00.000Z',
      revision: 1,
    };
    const observation = (
      operationId: number,
      kind: NpcPoisonSourceObservation['kind'],
    ): NpcPoisonSourceObservation => ({
      operationId: id(operationId),
      kind,
      campaignTimestamp: 37,
      compositionProof: value.compositionProof,
      life: { kind: 'CONFIRMED', state: lifeContext.state },
    });
    const origin = prepared
      ? { kind: 'PREPARED' as const, preparationOperationId: id(80) }
      : { kind: 'COMMITTED' as const, originCommitOperationId: id(3) };
    const sourceContribution = deriveNpcPoisonSourceContribution(sourceCatalog(), chosen, {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 37,
      origin,
      targetCommitOperationIdOrNull: prepared ? null : id(target),
      observations: [
        observation(80, 'PREPARATION'),
        ...(prepared ? [] : [observation(3, 'COMMIT')]),
        ...(target === 3 ? [] : [observation(target, 'COMMIT')]),
      ],
    });
    const rows = value.inventoryProof.entries.map((e) => e.request);
    const contribution = deriveNpcPreparedPoisonCoating(carrierCatalog(), preparation, {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 37,
      origin,
      mode: chosen,
      source: sourceContribution,
      originalInventory: buildNpcInventoryPhysicalBasis(
        source.inventoryPublication,
        rows.map((r) => ({ ...r, coatingInstanceIds: [] })),
      ),
      currentInventory: buildNpcInventoryPhysicalBasis(
        source.inventoryPublication,
        rows.map((r) => ({ ...r, coatingInstanceIds: [id(85)] })),
        inventoryHistory,
      ),
      replaces: null,
    });
    coatingContext = {
      catalog: carrierCatalog(),
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 37,
      targetCommitOperationIdOrNull: prepared ? null : id(target),
      contributions: [contribution],
      removals: [],
    };
  }
  return {
    campaignId: id(10),
    npcUuid: id(1),
    campaignTimestampOrNull: lifeContext.campaignTimestampOrNull,
    targetCommitOperationIdOrNull: prepared ? null : id(target),
    previousVersionCompositionProofOrNull: target === 3 ? null : value.compositionProof,
    modes: [chosen],
    coatingContext,
  };
}
function savedInput(
  value: NpcHumanoidBuildInput,
  lifeContext: NpcHumanoidLifeContext,
  poisonContext: NpcHumanoidPoisonContext,
  history: NpcInventoryPublicationContext | null = null,
): NpcHumanoidBuildInput {
  const states = deriveNpcInitialTaipanModeStates(
    sourceCatalog(),
    value.compositionProof,
    poisonContext,
  );
  const inventoryProof: NpcInventoryPublicationProof = {
    ...value.inventoryProof,
    commitOperationId: lifeContext.commitOperationId,
    ...(history === null
      ? {}
      : {
          previous: {
            npcUuid: history.history[0]!.npcUuid,
            version: history.history[0]!.version,
            sha256: history.history[0]!.sha256,
            commitOperationId: history.history[0]!.commitOperationId,
          },
        }),
    ...(poisonContext.coatingContext === null
      ? {}
      : {
          coatingOrigins: [{ coatingInstanceId: id(85), originCommitOperationId: id(3) }],
          entries: value.inventoryProof.entries.map((e) => ({
            ...e,
            request: { ...e.request, coatingInstanceIds: [id(85)] },
          })),
        }),
  };
  const inventory = buildNpcInventoryPublication(
    source.inventoryPublication,
    inventoryProof,
    history,
    poisonContext.coatingContext,
  );
  return {
    ...value,
    inventoryProof,
    initialLifeProof: {
      commitOperationId: lifeContext.commitOperationId,
      originCommitOperationId: lifeContext.originCommitOperationId,
    },
    initialPoisonProof: npcHumanoidPoisonProofForTarget(states, lifeContext.commitOperationId),
    input: {
      ...value.input,
      inventory: inventory.input,
      initialState: {
        ...value.input.initialState,
        sourceSpecificStates: [lifeContext.state, ...states],
      },
    },
  };
}
const build = (
  value: NpcHumanoidBuildInput,
  lifeContext: NpcHumanoidLifeContext,
  poisonContext: NpcHumanoidPoisonContext,
  history: NpcInventoryPublicationContext | null = null,
) =>
  buildNpcHumanoidSnapshot(
    source.humanoid,
    value,
    null,
    null,
    null,
    null,
    null,
    history,
    lifeContext,
    poisonContext,
  );

describe('ADR0087 whole NPC mode and coating boundary', () => {
  it('saves explicit mode beside ALIVE without inventing a campaign clock or timer and reads exactly', () => {
    const base = initial(),
      alive = life(base, null),
      selected = poison(base, alive, false);
    const value = savedInput(base, alive, selected);
    const bytes = JSON.stringify(value);
    const saved = build(value, alive, selected);
    expect(saved.sheet.input.initialState.sourceSpecificStates).toHaveLength(2);
    expect(saved.sheet.input.initialState.sourceSpecificStates[1]).toMatchObject({
      activePoisonType: 'POI-TAIPAN-DEADLY',
      effectInstanceId: id(82),
      pendingSwitchOrNull: null,
    });
    expect(saved.sheet.input.initialState.sourceSpecificStates[1]).not.toHaveProperty('startsAt');
    expect(saved.sheet.input.initialState.effectInstances).toEqual([]);
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        structuredClone(saved),
        null,
        null,
        null,
        null,
        null,
        null,
        alive,
        selected,
      ),
    ).toEqual(saved);
    expect(JSON.stringify(value)).toBe(bytes);
    expect(() => build(value, alive, { ...selected, modes: [] })).toThrow();
    const altered = structuredClone(saved);
    const state = altered.sheet.input.initialState.sourceSpecificStates[1];
    if (
      state === undefined ||
      !('kind' in state) ||
      state.kind !== 'GM_FORMAL_INITIAL_TAIPAN_MODE_STATE'
    )
      throw new Error('Mode state required');
    expect(() =>
      readNpcHumanoidSnapshot(
        source.humanoid,
        {
          ...altered,
          sheet: {
            ...altered.sheet,
            input: {
              ...altered.sheet.input,
              initialState: {
                ...altered.sheet.input.initialState,
                sourceSpecificStates: [
                  alive.state,
                  { ...state, activePoisonType: 'POI-TAIPAN-PARALYTIC' },
                ],
              },
            },
          },
        },
        null,
        null,
        null,
        null,
        null,
        null,
        alive,
        selected,
      ),
    ).toThrow();
  });
  it('closes an actual coated projectile in the full sheet and retains the original dose in N+1', () => {
    const base = initial(),
      alive = life(base, 37),
      selected = poison(base, alive, true);
    const value = savedInput(base, alive, selected),
      saved = build(value, alive, selected);
    const originalBytes = JSON.stringify(saved);
    expect(saved.sheet.input.inventory[0]?.coatings).toHaveLength(1);
    expect(saved.sheet.input.inventory[0]?.coatings[0]).toMatchObject({
      coatingInstanceId: id(85),
      payload: { futureDeliveryRule: 'HALF_PERIODIC_DAMAGE' },
      appliedAt: { campaignTimestamp: 37 },
      expiry: null,
    });
    expect(saved.sheet.input.initialState.currentHP).toBe(7);
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        structuredClone(saved),
        null,
        null,
        null,
        null,
        null,
        null,
        alive,
        selected,
      ),
    ).toEqual(saved);
    const firstPublication = buildNpcInventoryPublication(
      source.inventoryPublication,
      value.inventoryProof,
      null,
      selected.coatingContext,
    );
    const history = {
      history: [
        {
          npcUuid: id(1),
          version: 1,
          sha256: 'a'.repeat(64),
          commitOperationId: id(3),
          publication: firstPublication,
        },
      ],
    };
    const nextLife = life(base, 37, 103),
      nextPoison = poison(base, nextLife, true, 103, false, history);
    const nextValue = savedInput(base, nextLife, nextPoison, history),
      next = build(nextValue, nextLife, nextPoison, history);
    const originalDose = saved.sheet.input.inventory[0]?.coatings[0],
      retainedDose = next.sheet.input.inventory[0]?.coatings[0];
    if (originalDose === undefined || retainedDose === undefined)
      throw new Error('Both original and retained dose required');
    const immutableDose = (dose: object) =>
      Object.fromEntries(Object.entries(dose).filter(([key]) => key !== 'currentSourceContext'));
    expect(immutableDose(retainedDose)).toEqual(immutableDose(originalDose));
    expect(retainedDose).toMatchObject({
      currentSourceContext: {
        effectiveSourceSnapshot: { targetLevel: 1 },
        resolution: {
          kind: 'CURRENT',
          observationOperationId: id(103),
          unavailableOperationIdOrNull: null,
          unavailableReasonOrNull: null,
        },
      },
    });
    expect(next.derivation.initialPoisonProof).toMatchObject({
      commitOperationId: id(103),
      modeAssignments: [{ modeOperationId: id(81), originCommitOperationId: id(3) }],
    });
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        structuredClone(next),
        null,
        null,
        null,
        null,
        null,
        history,
        nextLife,
        nextPoison,
      ),
    ).toEqual(next);
    expect(JSON.stringify(saved)).toBe(originalBytes);
    expect(() => build(nextValue, nextLife, selected, history)).toThrow();
    expect(() => build(nextValue, nextLife, { ...nextPoison, modes: [] }, history)).toThrow();
  });
  it('previews actual PREPARED mode and coating with no saved COMMIT and rejects reused source-life evidence', () => {
    const base = initial(),
      alive = life(base, 37),
      selected = poison(base, alive, true, 3, true);
    const previewLife: NpcHumanoidLifePreview = {
      kind: 'PREPARED',
      sourceOperationId: id(86),
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestampOrNull: 37,
      history: alive.history,
      entryDuplicateProofOrNull: null,
      previousLifeKindOrNull: null,
    };
    const raw = {
      npcUuid: base.npcUuid,
      owningControllerId: base.owningControllerId,
      compositionProof: base.compositionProof,
      ordinaryProof: base.ordinaryProof,
      input: {
        ...base.input,
        skills: [{ skillKey: 'STEALTH', targetBonus: 1, pool: 'START' }],
        inventory: base.inventoryProof.entries.map((e) => ({
          ...e.request,
          coatingInstanceIds: [id(85)],
        })),
      },
    };
    const preview = previewNpcHumanoid(
      source.humanoid,
      raw,
      null,
      null,
      null,
      null,
      null,
      null,
      previewLife,
      selected,
    );
    expect(preview.kind).toBe('UNCOMMITTED');
    expect(preview).not.toHaveProperty('derivation');
    expect(preview.sheet.input.initialState.sourceSpecificStates).toHaveLength(2);
    expect(preview.sheet.itemProfiles[0]?.activeCoatings).toMatchObject([
      {
        coatingInstanceId: id(85),
        sourceInstanceId: id(70),
        payload: { futureDeliveryRule: 'HALF_PERIODIC_DAMAGE' },
        appliedAt: { campaignTimestamp: 37 },
        originalSourceSnapshot: { targetLevel: 1 },
        currentSourceContext: {
          effectiveSourceSnapshot: { targetLevel: 1 },
          resolution: { kind: 'CURRENT' },
        },
        origin: { kind: 'PREPARED', preparationOperationId: id(80) },
      },
    ]);
    expect(JSON.stringify(preview)).not.toContain('originCommitOperationId');
    expect(() =>
      previewNpcHumanoid(
        source.humanoid,
        {
          ...raw,
          input: {
            ...raw.input,
            initialState: { ...raw.input.initialState, currentHP: 8 },
          },
        },
        null,
        null,
        null,
        null,
        null,
        null,
        previewLife,
        selected,
      ),
    ).toThrow();
    expect(() =>
      previewNpcHumanoid(source.humanoid, raw, null, null, null, null, null, null, null, selected),
    ).toThrow();
  });

  it('keeps omitted preparation refs without an active dose or a new campaign-time lock', () => {
    const base = initial(),
      originalLife = life(base, 37);
    const prepared = poison(base, originalLife, true, 3, true);
    const token = prepared.coatingContext?.contributions[0];
    if (token === undefined) throw new Error('Actual original prepared dose required');
    const original = readNpcPoisonCoatingContribution(carrierCatalog(), token);
    const evidence = deriveNpcPoisonPreparationEvidence(carrierCatalog(), original.preparation, {
      mode: original.context.mode,
      source: original.context.source,
      originalInventory: original.context.originalInventory,
      replaces: null,
    });
    const laterLife = life(base, 38),
      selected = poison(base, laterLife, false);
    const archive: NpcInventoryCoatingContext = {
      catalog: carrierCatalog(),
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 38,
      targetCommitOperationIdOrNull: id(3),
      contributions: [],
      removals: [],
      preparationHistory: [{ kind: 'PREPARE', preparation: evidence }],
    };
    const context: NpcHumanoidPoisonContext = {
      ...selected,
      coatingContext: archive,
    };
    const uncoated = savedInput(base, laterLife, selected);
    const value: NpcHumanoidBuildInput = {
      ...uncoated,
      inventoryProof: {
        ...uncoated.inventoryProof,
        entries: [],
        coatingOrigins: [],
        archivedCoatingPreparations: [
          { coatingInstanceId: id(85), preparationOperationId: id(80) },
        ],
      },
      input: { ...uncoated.input, inventory: [] },
    };
    const originalBytes = JSON.stringify(original.coating),
      valueBytes = JSON.stringify(value);
    const saved = build(value, laterLife, context);
    expect(saved.sheet.requiresCampaignTime).toBe(false);
    expect(saved.sheet.input.inventory).toEqual([]);
    expect(saved.sheet.itemProfiles).toEqual([]);
    expect(saved.sheet.input.initialState.effectInstances).toEqual([]);
    expect(saved.derivation.inventoryProof.archivedCoatingPreparations).toEqual([
      { coatingInstanceId: id(85), preparationOperationId: id(80) },
    ]);
    expect(saved.derivation.inventoryProof.coatingOrigins).toEqual([]);
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        structuredClone(saved),
        null,
        null,
        null,
        null,
        null,
        null,
        laterLife,
        context,
      ),
    ).toEqual(saved);
    const previewLife: NpcHumanoidLifePreview = {
      kind: 'PREPARED',
      sourceOperationId: id(86),
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestampOrNull: 38,
      history: laterLife.history,
      entryDuplicateProofOrNull: null,
      previousLifeKindOrNull: null,
    };
    const previewContext: NpcHumanoidPoisonContext = {
      ...poison(base, laterLife, false, 3, true),
      coatingContext: { ...archive, targetCommitOperationIdOrNull: null },
    };
    const preview = previewNpcHumanoid(
      source.humanoid,
      {
        npcUuid: base.npcUuid,
        owningControllerId: base.owningControllerId,
        compositionProof: base.compositionProof,
        ordinaryProof: base.ordinaryProof,
        input: {
          ...base.input,
          skills: [{ skillKey: 'STEALTH', targetBonus: 1, pool: 'START' }],
          inventory: [],
        },
      },
      null,
      null,
      null,
      null,
      null,
      null,
      previewLife,
      previewContext,
    );
    expect(preview.sheet.requiresCampaignTime).toBe(false);
    expect(preview.sheet.itemProfiles).toEqual([]);
    expect(preview).not.toHaveProperty('derivation');
    expect(JSON.stringify(preview)).not.toContain('originCommitOperationId');
    expect(JSON.stringify(original.coating)).toBe(originalBytes);
    expect(original.coating.appliedAt.campaignTimestamp).toBe(37);
    expect(original.coating.origin).toEqual({
      kind: 'PREPARED',
      preparationOperationId: id(80),
    });
    expect(JSON.stringify(value)).toBe(valueBytes);
    expect(() =>
      build(
        {
          ...value,
          inventoryProof: {
            ...value.inventoryProof,
            archivedCoatingPreparations: [],
          },
        },
        laterLife,
        context,
      ),
    ).toThrow();
  });
});
