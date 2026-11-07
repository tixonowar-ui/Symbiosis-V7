import {
  prepareNpcInitialTraumaFact,
  type NpcInitialTraumaEvidence,
  type NpcInitialTraumaChoice,
} from './initial-trauma.js';
import type { NpcHumanoidTraumaContext } from './npc-humanoid-sheet.js';
import { createNpcUntimedDiseaseEffect } from './untimed-disease-effects.js';
import { createNpcPneumoniaEffect } from './periodic-disease-effects.js';
import type { NpcHumanoidInitialStateContext } from './npc-humanoid-sheet.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import { npcPureInitialSkillFixture } from '../../../../tests/fixtures/npc-clean-humanoid.js';
import {
  npcKensiRequest,
  npcPublishedInventoryFixture,
} from '../../../../tests/fixtures/npc-published-inventory.js';
import {
  createNpcInventoryPublicationCatalog,
  buildNpcInventoryPublication,
  buildNpcInventoryPreview,
  type NpcInventoryPublicationCatalog,
  type NpcInventoryPublicationProof,
  type NpcInventoryPublicationContext,
} from './inventory-publication.js';
import type { NpcInventoryRequestEntry } from './inventory.js';
import type { NpcHumanoidEquipmentContext } from './npc-humanoid-sheet.js';
import type { NpcHumanoidWoundContext } from './npc-humanoid-sheet.js';
import { prepareNpcGmWound } from './wound-instances.js';
import {
  createNpcHumanoidCatalog,
  buildNpcHumanoidSnapshot,
  previewNpcHumanoid,
  readNpcHumanoidSnapshot,
  type NpcHumanoidCatalog,
} from './npc-humanoid-sheet.js';
import {
  readNpcCleanHumanoidSnapshot,
  buildNpcCleanHumanoidSnapshot,
} from './clean-humanoid-sheet.js';
import { createNpcAlcoholEffect, type NpcAlcoholHistoryAnchor } from './alcohol-effects.js';
import { deriveNpcAlcoholPoisonResponse } from './alcohol-response.js';
import {
  createNpcInitialHpModeEffect,
  readNpcCombinedHpModeBoundary,
  deriveNpcCombinedHpModes,
  deriveNpcHpModeStatProfile,
  readNpcHpModeStatProfile,
  type NpcHpModeHistoryAnchor,
  type NpcHpModeSourceEvidence,
} from './combined-hp-modes.js';
import {
  deriveNpcOrdinaryStatProfile,
  buildNpcOrdinaryHumanoidSnapshot,
  deriveNpcOrdinaryRuntimeBasis,
  readNpcOrdinaryRuntimeBasis,
  deriveNpcOrdinaryHpModeSource,
} from './npc-ordinary-humanoid-sheet.js';
import { evaluateNpcSkills, type NpcSkillProof } from './skill-evaluation.js';
import type {
  NpcHumanoidBuildInput,
  NpcHumanoidRuntimeEffectContext,
  NpcHumanoidRuntimeEffectPreview,
} from './npc-humanoid-sheet.js';
import type { NpcSymbiontInput } from './types.js';
import type { NpcCompositionConsequenceProof } from './composition-consequence-types.js';
import { npcOrdinaryInventoryIsStatNeutral } from './ordinary-humanoid-proof.js';
import {
  deriveNpcInitialEffectPreparation,
  readNpcInitialEffectPreparation,
  type NpcInitialEffectPreparationInput,
} from './initial-effect-preparation.js';
import { deriveNpcHumanoidRuntimeState } from './runtime-effect-state.js';
import { previewNpcDiseaseStatContribution } from './disease-unconsciousness.js';
import {
  createNpcFormalControlEffect,
  type NpcFormalControlKind,
  type NpcFormalControlHistoryAnchor,
} from './formal-control-effects.js';
import {
  deriveNpcFormalControlComposition,
  readNpcFormalControlComposition,
} from './formal-control-composition.js';
import {
  createNpcFormalLifeState,
  type NpcFormalLifeHistoryAnchor,
  type NpcFormalLifeKind,
} from './formal-life-state.js';
import {
  deriveNpcFunctionalDuplicateProof,
  readNpcFunctionalDuplicateProof,
} from './functional-duplicate-composition.js';
import {
  deriveNpcHumanoidLifeBoundary,
  previewNpcHumanoidLifeBoundary,
  type NpcHumanoidLifeContext,
  type NpcHumanoidLifePreview,
} from './humanoid-life-boundary.js';

let source: NpcAuthoringSourceCatalog,
  publication: NpcInventoryPublicationCatalog,
  catalog: NpcHumanoidCatalog;
let dictionaries: unknown, characterRuntime: unknown;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  source = await loadNpcAuthoringSourceCatalog(root);
  const read = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(`${root}/generated/spec/${file}.json`, 'utf8')) as unknown;
  const [instanceModel, weaponFields, d, r] = await Promise.all([
    read('items/instance-model'),
    read('items/weapon-fields'),
    read('character/dictionaries'),
    read('character/runtime-contracts'),
  ]);
  dictionaries = d;
  characterRuntime = r;
  publication = createNpcInventoryPublicationCatalog(source.inventory, {
    instanceModel,
    weaponFields,
  });
  catalog = createNpcHumanoidCatalog(
    {
      cleanHumanoid: source.cleanHumanoid,
      inventoryPublication: publication,
      diseaseEffects: source.diseaseEffects,
      diseaseUnconsciousness: source.diseaseUnconsciousness,
      skills: source.skills,
    },
    { characterDictionaries: dictionaries, characterRuntime },
  );
});
function fixture(
  baseStats = { S: 10, D: 10, M: 10, C: 10, I: 10, Z: 10, W: 4 },
  selections: Parameters<typeof npcPureInitialSkillFixture>[2]['selections'] = [
    { skillKey: 'UNARMED', targetBonus: 1, pool: 'START' },
  ],
) {
  const clean = npcPureInitialSkillFixture(
    source,
    {
      npcUuid: id(1),
      owningControllerId: id(2),
      contextFactId: 'actual-npc014-confirm',
      compositionJournalId: id(6),
      commitOperationId: id(3),
    },
    {
      pureClassOrNull: 'SOLDIER',
      baseStats,
      selections,
    },
  );
  const proof: NpcInventoryPublicationProof = {
    npcUuid: id(1),
    commitOperationId: id(3),
    sourceOperationId: 'actual-npc015-confirm',
    actorId: id(2),
    committedAt: '2026-11-06T04:00:00.000Z',
    entries: [{ request: npcKensiRequest(id(4)), weaponProfileVersionId: id(5) }],
  };
  return npcPublishedInventoryFixture(publication, clean, proof);
}

function runtimeOrdinary(
  speciesKey: 'WEAVER' | 'TOAD' | 'CHIMERA' | 'PUPPETEER' | 'PLAGUE_DOCTOR' | 'ADVISER' | 'DOLPHIN',
  targetLevel = 5,
): NpcHumanoidBuildInput {
  const initial = fixture();
  const stealth = source.skills.skills.find((skill) => skill.skillKey === 'STEALTH');
  if (stealth === undefined) throw new Error('source STEALTH skill required');
  const member: NpcSymbiontInput = {
    symbiontInstanceId: id(70),
    speciesKey,
    targetLevel,
    learnedNodeRefs: source.development.nodes
      .filter(
        (n) =>
          n.speciesKey === speciesKey &&
          n.level <= targetLevel &&
          (speciesKey !== 'WEAVER' || n.branchCodeOrNull !== 'EXTERNAL_REGENERATION'),
      )
      .map((n) => n.nodeRef),
    binding: { kind: 'NONE' },
    currentOE: 0,
  };
  const adviserRoll = (n: number) => ({
    factId: id(n),
    rollRequestId: id(n + 20),
    rollReceiptId: id(n + 30),
    originatingCommandId: id(71),
    modeSnapshot: 'MANUAL' as const,
    mechanical: { dieSides: 20 as const, rawFace: 1 },
  });
  const compositionProof: NpcCompositionConsequenceProof = {
    identityKey: id(1),
    binding: { journalId: id(6), raceCode: 'UNITED' },
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
    resolutions:
      speciesKey !== 'ADVISER'
        ? []
        : [
            {
              kind: 'ADVISER_IW_ROLLS',
              factId: id(510),
              ordinal: 1,
              compositionOrdinal: 1,
              causedByFactId: id(72),
              symbiontInstanceId: id(70),
              cardId: id(79),
              rolls: [adviserRoll(500), adviserRoll(501)],
            },
            {
              kind: 'ADVISER_SKILLS',
              factId: id(511),
              ordinal: 2,
              compositionOrdinal: 1,
              causedByFactId: id(72),
              symbiontInstanceId: id(70),
              bodyContextFactId: id(69),
              // CORE-001 UNITED manual body; actual Advisor W=1+8 gives five START slots.
              bodyStats: { S: 13, D: 20, M: 10, Z: 10, C: 20 },
              selectedSkills: [{ skillKey: stealth.skillKey, targetBonus: 5 }],
            },
          ],
  };
  const schema = {
    raceCode: 'UNITED',
    pureClassOrNull: null,
    anatomyProfileId: 'STANDARD_HUMANOID',
    sex: 'MALE',
    massKg: 75,
  } as const;
  const baseStats = { S: 20, D: 20, M: 20, Z: 20, I: 5, W: 2, C: 20 }; // REQ-STEALTH-I: I≥5.
  const ordinaryProof = {
    currentStatContextFactId: id(74),
    statContexts: (speciesKey === 'ADVISER' ? [69, 73, 74] : [73, 74]).map((n) => ({
      contextFactId: id(n),
      schema,
      baseStats,
      compositionOrdinal: 1,
      resolutionOrdinal: speciesKey === 'ADVISER' ? (n === 69 ? 1 : 2) : 0,
    })),
  };
  const profile = deriveNpcOrdinaryStatProfile(source.ordinaryHumanoid, {
    npcUuid: id(1),
    compositionProof,
    ordinaryProof,
  });
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
      sym166SourceOrNull:
        speciesKey === 'DOLPHIN' && targetLevel >= 6
          ? { symbiontInstanceId: id(70), nodeRef: 'SYM-166' }
          : null,
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
  return {
    ...initial,
    compositionProof,
    ordinaryProof,
    skillProof,
    input: {
      ...initial.input,
      identity: { ...initial.input.identity, ...schema },
      baseStats,
      symbionts: [member],
      skills: skills.ledger,
      lifetimeFacts: profile.current.composition.lifetimeFacts,
    },
  };
}

describe('complete NPC independent alcohol and HP mode origins', () => {
  it('preserves an explicit empty historical inventory when NPC015 adds only a carried weapon', () => {
    const initial = runtimeOrdinary('DOLPHIN', 6);
    const value: NpcHumanoidBuildInput = {
      ...initial,
      ordinaryProof: {
        ...initial.ordinaryProof!,
        statContexts: initial.ordinaryProof!.statContexts.map((fact) => ({
          ...fact,
          equippedInventory: [],
        })),
      },
    };
    const before = JSON.stringify(value);
    expect(value.inventoryProof.entries[0]?.request.equipped).toBe(false);
    expect(
      npcOrdinaryInventoryIsStatNeutral(
        source.inventoryPublication,
        value.inventoryProof.entries.map((entry) => entry.request),
      ),
    ).toBe(true);
    const saved = buildNpcHumanoidSnapshot(source.humanoid, value);
    expect(saved.derivation.ordinaryProof).toEqual(value.ordinaryProof);
    expect(saved.derivation.skillProof).toEqual(value.skillProof);
    expect(saved.sheet.input.inventory).toEqual(value.input.inventory);
    expect(saved.sheet.stats.effectiveStats).toEqual(saved.sheet.stats.permanentStats);
    expect(readNpcHumanoidSnapshot(source.humanoid, JSON.parse(JSON.stringify(saved)))).toEqual(
      saved,
    );
    expect(JSON.stringify(value)).toBe(before);

    const nate: NpcInventoryRequestEntry = {
      ...npcKensiRequest(id(799)),
      itemTypeId: 'ITM-ARM-005',
      currentAmmo: null,
      equipped: true,
      equippedSlots: ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'],
      sealed: true,
    };
    // The SYM-174 exception uses actual sealed equipment, even without additive bonuses.
    expect(npcOrdinaryInventoryIsStatNeutral(source.inventoryPublication, [nate])).toBe(false);
    expect(
      npcOrdinaryInventoryIsStatNeutral(source.inventoryPublication, [
        { ...nate, equipped: false, equippedSlots: [] },
      ]),
    ).toBe(true);
  });
  it('combines one actual carried custom item and disease before the Dolphin cap without rewriting permanent or paid history', () => {
    const initial = runtimeOrdinary('DOLPHIN', 6);
    const backpack = {
      ...npcKensiRequest(id(720)),
      itemTypeId: 'RES-CON-001',
      profile: { kind: 'CATALOG' as const },
      currentAmmo: null,
    };
    const custom: NpcInventoryRequestEntry = {
      ...backpack,
      itemInstanceId: id(721),
      itemTypeId: null,
      itemTypeReference: {
        kind: 'CAMPAIGN_CUSTOM_PROFILE',
        profileId: id(722),
        profileVersionId: id(723),
        version: 1,
        reservationOperationId: id(724),
      },
      profile: {
        kind: 'STRUCTURED_CUSTOM',
        name: 'Памятная вещь',
        description: 'Явное свойство',
        customBonusOrNull: {
          customBonusStat: 'I',
          customBonusValue: 5,
          activeOnlyInBackpack: true,
        },
        massKg: null,
        heldSizeClass: 'UNKNOWN',
        armorWeightClass: 'UNKNOWN',
        flammability: 'UNKNOWN',
        isIgnitionSource: false,
        isFood: false,
        canReceivePoison: false,
        canReceiveFlammableCoating: false,
      },
      bonusContainerBinding: { kind: 'BACKPACK', backpackItemInstanceId: backpack.itemInstanceId },
      customProfileReason: 'Подтверждённое исходное свойство',
    };
    const inventoryProof = {
      ...initial.inventoryProof,
      sourceOperationId: id(725),
      entries: [
        ...initial.inventoryProof.entries,
        { request: backpack, weaponProfileVersionId: null },
        { request: custom, weaponProfileVersionId: null },
      ],
    };
    const inventory = buildNpcInventoryPublication(source.inventoryPublication, inventoryProof);
    const currentFact = {
      ...initial.ordinaryProof!.statContexts.at(-1)!,
      contextFactId: 'NPC_CURRENT_INVENTORY/' + id(725),
      inventoryConfirmationOperationId: id(725),
      equippedInventory: inventoryProof.entries.map((entry) => entry.request),
    };
    const effect = createNpcUntimedDiseaseEffect(
      source.nonperiodicDiseases,
      {
        effectInstanceId: id(730),
        diseaseId: 'DIS-MIGRAINE',
        createdAt: inventoryProof.committedAt,
      },
      { targetActorId: initial.npcUuid, campaignTimestampOrNull: 2707, dead: false },
    );
    const context: NpcHumanoidInitialStateContext = {
      npcUuid: initial.npcUuid,
      commitOperationId: id(3),
      campaignTimestampOrNull: 2707,
      origins: [
        {
          effectInstanceId: id(730),
          diseaseId: 'DIS-MIGRAINE',
          originOperationId: id(3),
          targetActorId: initial.npcUuid,
          committedAt: inventoryProof.committedAt,
          campaignTimestamp: 2707,
        },
      ],
    };
    const value: NpcHumanoidBuildInput = {
      ...initial,
      inventoryProof,
      ordinaryProof: {
        currentStatContextFactId: currentFact.contextFactId,
        statContexts: [...initial.ordinaryProof!.statContexts, currentFact],
      },
      initialStateProof: {
        commitOperationId: id(3),
        assignments: [{ effectInstanceId: id(730), originOperationId: id(3) }],
      },
      input: {
        ...initial.input,
        inventory: inventory.input,
        initialState: { ...initial.input.initialState, effectInstances: [effect] },
      },
    };
    const before = JSON.stringify(value),
      saved = buildNpcHumanoidSnapshot(source.humanoid, value, context);
    // SYM-162/AQ2-005: permanent min(5+30,30)=30; item +5 then MON-081 I−6 gives 29 before final cap.
    expect(saved.sheet.stats.permanentStats.I).toBe(30);
    expect(saved.sheet.stats.effectiveStats.I).toBe(29);
    expect(saved.derivation.skillProof).toEqual(initial.skillProof);
    expect(saved.derivation.skillProof.contexts.at(-1)?.effectiveStats.I).toBe(30);
    expect(saved.sheet.input.skills).toEqual(initial.input.skills);
    expect(saved.sheet.input.lifetimeFacts).toEqual(initial.input.lifetimeFacts);
    expect(
      readNpcHumanoidSnapshot(source.humanoid, JSON.parse(JSON.stringify(saved)), context),
    ).toEqual(saved);
    expect(JSON.stringify(value)).toBe(before);
  });
  function formalLife(
    initial: NpcHumanoidBuildInput,
    lifeKind: NpcFormalLifeKind,
    remainingMinutes = '12.5',
  ) {
    const severe = lifeKind === 'SEVERELY_WOUNDED';
    const entry = severe
      ? deriveNpcFunctionalDuplicateProof(source.functionalDuplicate, {
          npcUuid: initial.npcUuid,
          campaignTimestamp: 2707,
          compositionProof: initial.compositionProof,
          temporaryEffects: [],
        })
      : null;
    const history: NpcFormalLifeHistoryAnchor = {
      kind: 'GM_FORMAL_INITIAL_LIFE',
      campaignId: id(680),
      npcUuid: initial.npcUuid,
      lifeKind,
      initialStateConfirmationId: id(681),
      reason: 'Фактическое исходное состояние',
      createdAt: '2026-11-06T04:00:00.000Z',
      severeWoundOrNull:
        entry === null
          ? null
          : {
              effectInstanceId: id(682),
              calendarAnchor: {
                kind: 'PRE_START_INITIAL',
                campaignTimestamp: 2707,
                lobbySnapshotRevision: 'a'.repeat(64),
              },
              rollFact: {
                factId: id(683),
                sourceRuleId: 'CORE-153',
                roll: { dieSides: 6, rawFace: 3 },
              },
              remainingMinutes,
              duplicateAtEntry: readNpcFunctionalDuplicateProof(entry),
            },
    };
    const currentHP = lifeKind === 'ALIVE' ? initial.input.initialState.currentHP : 0;
    const state = createNpcFormalLifeState(
      source.formalLife,
      history,
      {
        campaignId: history.campaignId,
        npcUuid: initial.npcUuid,
        currentHP,
        campaignTimestampOrNull: severe ? 2707 : null,
      },
      entry,
    );
    const context: NpcHumanoidLifeContext = {
      campaignId: history.campaignId,
      npcUuid: initial.npcUuid,
      commitOperationId: id(3),
      originCommitOperationId: id(3),
      campaignTimestampOrNull: severe ? 2707 : null,
      history,
      state,
      entryDuplicateProofOrNull: entry,
      previousLifeKindOrNull: null,
    };
    const value: NpcHumanoidBuildInput = {
      ...initial,
      initialLifeProof: { commitOperationId: id(3), originCommitOperationId: id(3) },
      input: {
        ...initial.input,
        initialState: {
          ...initial.input.initialState,
          currentHP,
          dead: state.dead,
          sourceSpecificStates: [state],
          deathTimerRollFactOrNull: history.severeWoundOrNull?.rollFact ?? null,
          effectInstances: [
            ...initial.input.initialState.effectInstances,
            ...(state.deathTimerOrNull === null ? [] : [state.deathTimerOrNull]),
          ],
        },
      },
    };
    return { value, context, state };
  }
  function buildLife(
    f: ReturnType<typeof formalLife>,
    runtime: NpcHumanoidRuntimeEffectContext | null = null,
  ) {
    return buildNpcHumanoidSnapshot(
      source.humanoid,
      f.value,
      null,
      null,
      null,
      null,
      runtime,
      null,
      f.context,
    );
  }
  it('distinguishes absent Weaver evidence from explicit undefined at both life boundaries', () => {
    const f = formalLife(fixture(), 'ALIVE');
    const available = source.formalWeaver;
    if (available === null) throw Error('Actual delivered Weaver source required');
    const input = {
      npcUuid: f.value.npcUuid,
      compositionProof: f.value.compositionProof,
      currentHP: f.value.input.initialState.currentHP,
    };
    const proof = f.value.initialLifeProof!;
    const preview: NpcHumanoidLifePreview = {
      kind: 'PREPARED',
      sourceOperationId: f.context.history.initialStateConfirmationId,
      campaignId: f.context.campaignId,
      npcUuid: f.context.npcUuid,
      campaignTimestampOrNull: f.context.campaignTimestampOrNull,
      history: f.context.history,
      entryDuplicateProofOrNull: f.context.entryDuplicateProofOrNull,
      previousLifeKindOrNull: f.context.previousLifeKindOrNull,
    };
    for (const formalWeaver of [null, available]) {
      const catalogs = {
        formalLife: source.formalLife,
        functionalDuplicate: source.functionalDuplicate,
        formalWeaver,
      };
      expect(() =>
        deriveNpcHumanoidLifeBoundary(catalogs, { ...input, proof, context: f.context }),
      ).not.toThrow();
      expect(() =>
        previewNpcHumanoidLifeBoundary(catalogs, { ...input, context: preview }),
      ).not.toThrow();
      for (const value of [undefined, null]) {
        const savedContext = { ...f.context };
        const previewContext = { ...preview };
        Object.defineProperty(savedContext, 'temporaryWeaverEffects', { value, enumerable: true });
        Object.defineProperty(previewContext, 'temporaryWeaverEffects', {
          value,
          enumerable: true,
        });
        expect(() =>
          deriveNpcHumanoidLifeBoundary(catalogs, {
            ...input,
            proof: { ...proof, temporaryWeaverAssignments: [] },
            context: savedContext,
          }),
        ).toThrow();
        expect(() =>
          previewNpcHumanoidLifeBoundary(catalogs, { ...input, context: previewContext }),
        ).toThrow();
      }
      const savedEmpty = () =>
        deriveNpcHumanoidLifeBoundary(catalogs, {
          ...input,
          proof: { ...proof, temporaryWeaverAssignments: [] },
          context: { ...f.context, temporaryWeaverEffects: [] },
        });
      const previewEmpty = () =>
        previewNpcHumanoidLifeBoundary(catalogs, {
          ...input,
          context: { ...preview, temporaryWeaverEffects: [] },
        });
      if (formalWeaver === null) {
        expect(savedEmpty).toThrow('source delivery required');
        expect(previewEmpty).toThrow('source delivery required');
      } else {
        expect(savedEmpty).not.toThrow();
        expect(previewEmpty).not.toThrow();
      }
    }
  });
  it('publishes actual zero HP with its preserved D6 and explicit remaining time, without damage or fake HP', () => {
    const f = formalLife(fixture(), 'SEVERELY_WOUNDED');
    const result = buildLife(f);
    expect(result.sheet.input.initialState.currentHP).toBe(0);
    // CORE-152 ordinary base maxHP=100; the fixture's currentHP=70 is a separate resource.
    expect(result.sheet.maxHP).toBe(100);
    expect(result.sheet.input.initialState.sourceSpecificStates).toEqual([f.state]);
    expect(result.sheet.input.initialState.effectInstances).toEqual([f.state.deathTimerOrNull]);
    expect(f.state.deathTimerOrNull).toMatchObject({
      remainingExact: '12.5',
      expiresAt: { campaignTimestampExact: '2719.5' },
    });
    expect(result.sheet.capabilities).toMatchObject({
      canPhysicalAct: false,
      canMentalAct: false,
      canReact: false,
      canActiveDefend: false,
      effectiveControllerId: id(2),
    });
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        JSON.parse(JSON.stringify(result)),
        null,
        null,
        null,
        null,
        null,
        null,
        f.context,
      ),
    ).toEqual(result);
    const before = JSON.stringify(f.value);
    expect(() => buildNpcHumanoidSnapshot(source.humanoid, f.value)).toThrow('independent life');
    expect(() =>
      buildLife({ ...f, context: { ...f.context, campaignTimestampOrNull: 2708 } }),
    ).toThrow();
    expect(JSON.stringify(f.value)).toBe(before);
  });
  it('uses actual CHIMERA MON-008/009 passive once and never turns learned Weaver into a duplicate', () => {
    const chimera = formalLife(runtimeOrdinary('CHIMERA', 2), 'SEVERELY_WOUNDED', '40');
    const result = buildLife(chimera);
    expect(result.sheet.capabilities.canPhysicalAct).toBe(true);
    expect(result.sheet.input.initialState.currentHP).toBe(0);
    expect(result.sheet.symbionts[0]?.currentOE).toBe(0);
    expect(chimera.state.deathTimerOrNull?.payload.duplicateMultiplierAtEntry).toBe(4);
    expect(() => formalLife(runtimeOrdinary('WEAVER', 3), 'SEVERELY_WOUNDED', '40')).toThrow(
      'remaining',
    );
  });
  it('publishes explicit DEAD without a timer, invented past injury, or effective controller', () => {
    const f = formalLife(fixture(), 'DEAD'),
      result = buildLife(f);
    expect(result.sheet.input.initialState).toMatchObject({
      currentHP: 0,
      dead: true,
      effectInstances: [],
      deathTimerRollFactOrNull: null,
    });
    expect(result.sheet.input.initialState.sourceSpecificStates[0]).not.toHaveProperty(
      'abstractVitalSystemDamaged',
    );
    expect(result.sheet.requiresCampaignTime).toBe(false);
    expect(result.sheet.capabilities).toMatchObject({
      canPhysicalAct: false,
      canMentalAct: false,
      canReact: false,
      canActiveDefend: false,
      effectiveControllerId: null,
    });
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        result,
        null,
        null,
        null,
        null,
        null,
        null,
        f.context,
      ),
    ).toEqual(result);
    const alive = formalLife(fixture(), 'ALIVE');
    expect(() =>
      buildLife({ ...alive, context: { ...alive.context, previousLifeKindOrNull: 'DEAD' } }),
    ).toThrow('revive');
  });
  it('previews a real LIFE_STATE_SET origin and refuses a borrowed life boundary for another composition', () => {
    const f = formalLife(fixture(), 'SEVERELY_WOUNDED');
    const preview: NpcHumanoidLifePreview = {
      kind: 'PREPARED',
      sourceOperationId: f.context.history.initialStateConfirmationId,
      campaignId: f.context.campaignId,
      npcUuid: f.context.npcUuid,
      campaignTimestampOrNull: 2707,
      history: f.context.history,
      entryDuplicateProofOrNull: f.context.entryDuplicateProofOrNull,
      previousLifeKindOrNull: null,
    };
    const raw = runtimePreviewInput(f.value);
    raw.input.initialState = {
      ...raw.input.initialState,
      sourceSpecificStates: [],
      effectInstances: [],
      deathTimerRollFactOrNull: null,
    };
    const result = previewNpcHumanoid(
      source.humanoid,
      raw,
      null,
      null,
      null,
      null,
      null,
      null,
      preview,
    );
    expect(result.sheet.input.initialState.currentHP).toBe(0);
    expect(result.sheet.input.initialState.sourceSpecificStates).toEqual([f.state]);
    expect(result).not.toHaveProperty('derivation');
    const boundary = deriveNpcHumanoidLifeBoundary(
      { formalLife: source.formalLife, functionalDuplicate: source.functionalDuplicate },
      {
        npcUuid: f.value.npcUuid,
        compositionProof: f.value.compositionProof,
        currentHP: 0,
        proof: f.value.initialLifeProof!,
        context: f.context,
      },
    );
    const simple = fixture();
    const low = {
      npcUuid: simple.npcUuid,
      owningControllerId: simple.owningControllerId,
      compositionProof: {
        ...simple.compositionProof,
        binding: { ...simple.compositionProof.binding, journalId: id(999) },
      },
      skillProof: simple.skillProof,
      input: {
        ...simple.input,
        inventory: [],
        initialState: { ...simple.input.initialState, currentHP: 0 },
      },
    };
    expect(() => buildNpcCleanHumanoidSnapshot(source.cleanHumanoid, low, boundary)).toThrow();
    expect(() =>
      buildNpcCleanHumanoidSnapshot(source.cleanHumanoid, low, structuredClone(boundary)),
    ).toThrow('issued');
  });
  it('keeps severe-wound incapacity stronger than an actual automatic Advisor under sleep', () => {
    const control = formalControls(['SLEEP'], runtimeOrdinary('ADVISER'));
    const f = formalLife(control.value, 'SEVERELY_WOUNDED');
    const result = buildLife(f, control.context);
    expect(result.sheet.capabilities).toMatchObject({
      canPhysicalAct: false,
      canMentalAct: false,
      effectiveControllerId: id(2),
    });
    expect(result.sheet.sourceControlState?.automaticAdviserOrNull).toBeNull();
    expect(result.sheet.input.skills).toEqual(control.value.input.skills);
  });
  function formalControls(kinds: readonly NpcFormalControlKind[], initial = fixture()) {
    const controls = kinds.map((controlKind, index) => {
      const history: NpcFormalControlHistoryAnchor = {
        kind: 'GM_FORMAL_INITIAL_CONTROL',
        effectInstanceId: id(600 + index),
        npcUuid: initial.npcUuid,
        controlKind,
        initialStateConfirmationId: id(610 + index),
        reason: 'Исходное состояние',
        createdAt: '2026-11-06T04:00:00.000Z',
        calendarAnchor: {
          kind: 'PRE_START_INITIAL',
          campaignTimestamp: 2707,
          lobbySnapshotRevision: 'a'.repeat(64),
        },
        remainingMinutes: index === 0 ? '30' : '15',
        revision: 1,
      };
      return {
        history,
        originCommitOperationId: id(3),
        effect: createNpcFormalControlEffect(source.formalControls, history, {
          npcUuid: initial.npcUuid,
          campaignTimestamp: 2707,
          dead: false,
        }),
      };
    });
    const context: NpcHumanoidRuntimeEffectContext = {
      npcUuid: initial.npcUuid,
      commitOperationId: id(3),
      campaignTimestampOrNull: 2707,
      alcohol: [],
      hpModes: [],
      hpModeSourceOrNull: null,
      provenHealingTimers: [],
      formalControls: controls,
    };
    return {
      context,
      value: {
        ...initial,
        initialRuntimeProof: {
          commitOperationId: id(3),
          assignments: controls.map((c) => ({
            effectInstanceId: c.effect.effectInstanceId,
            originCommitOperationId: c.originCommitOperationId,
          })),
        },
        input: {
          ...initial.input,
          initialState: {
            ...initial.input.initialState,
            effectInstances: controls.map((c) => c.effect),
          },
        },
      },
    };
  }
  it.each(['SLEEP', 'PARALYSIS'] as const)(
    'derives exact %s restrictions without intake, a new roll or changing HP',
    (controlKind) => {
      const f = formalControls([controlKind]);
      const result = buildNpcHumanoidSnapshot(
        source.humanoid,
        f.value,
        null,
        null,
        null,
        null,
        f.context,
      );
      expect(result.sheet.capabilities).toMatchObject({
        canPhysicalAct: false,
        canMentalAct: controlKind === 'SLEEP' ? false : 'CONDITIONAL_NO_SPEECH_MOVEMENT_BODY',
        canReact: false,
        canActiveDefend: false,
        effectiveControllerId: id(2),
      });
      expect(result.sheet.input.initialState.currentHP).toBe(70);
      expect(result.sheet.sourceControlState?.formalControls[0]?.restriction).toMatchObject({
        movement: 'NO',
        armor: 'YES',
      });
      expect(result.sheet.sourceControlState?.automaticAdviserOrNull).toBeNull();
      expect(result.sheet.input.initialState.effectInstances).toEqual(
        f.value.input.initialState.effectInstances,
      );
      expect(
        readNpcHumanoidSnapshot(
          source.humanoid,
          JSON.parse(JSON.stringify(result)),
          null,
          null,
          null,
          null,
          f.context,
        ),
      ).toEqual(result);
    },
  );
  it('keeps sleep and paralysis timers separate and only removes the selected restriction', () => {
    const f = formalControls(['SLEEP', 'PARALYSIS']);
    const result = buildNpcHumanoidSnapshot(
      source.humanoid,
      f.value,
      null,
      null,
      null,
      null,
      f.context,
    );
    expect(result.sheet.capabilities.canMentalAct).toBe(false);
    expect(result.sheet.input.initialState.effectInstances.map((e) => e.remainingExact)).toEqual([
      '30',
      '15',
    ]);
    const value = {
      ...f.value,
      initialRuntimeProof: {
        ...f.value.initialRuntimeProof,
        assignments: f.value.initialRuntimeProof.assignments.slice(1),
      },
      input: {
        ...f.value.input,
        initialState: {
          ...f.value.input.initialState,
          effectInstances: f.value.input.initialState.effectInstances.slice(1),
        },
      },
    };
    const context = { ...f.context, formalControls: f.context.formalControls!.slice(1) };
    const next = buildNpcHumanoidSnapshot(source.humanoid, value, null, null, null, null, context);
    expect(next.sheet.capabilities.canMentalAct).toBe('CONDITIONAL_NO_SPEECH_MOVEMENT_BODY');
    expect(next.sheet.input.initialState.effectInstances).toEqual(
      result.sheet.input.initialState.effectInstances.slice(1),
    );
  });
  it('refuses a selected decoction control only for actual enabled learned Toad immunity', () => {
    const f = formalControls(['SLEEP'], runtimeOrdinary('TOAD'));
    const composition = deriveNpcFormalControlComposition(
      source.formalControlComposition,
      f.value.compositionProof,
    );
    expect(composition.poisonControlResponse).toBe('IMMUNE');
    expect(() => readNpcFormalControlComposition(structuredClone(composition))).toThrow('issued');
    expect(() =>
      buildNpcHumanoidSnapshot(source.humanoid, f.value, null, null, null, null, f.context),
    ).toThrow('immune');
    const ordinary = formalControls(['SLEEP'], runtimeOrdinary('WEAVER'));
    expect(
      buildNpcHumanoidSnapshot(
        source.humanoid,
        ordinary.value,
        null,
        null,
        null,
        null,
        ordinary.context,
      ).sheet.capabilities.canMentalAct,
    ).toBe(false);
  });
  it('uses the actual free Advisor automatic controller and its separate skills, while paralysis takes precedence', () => {
    const f = formalControls(['SLEEP'], runtimeOrdinary('ADVISER'));
    const result = buildNpcHumanoidSnapshot(
      source.humanoid,
      f.value,
      null,
      null,
      null,
      null,
      f.context,
    );
    expect(result.owningControllerId).toBe(id(2));
    expect(result.sheet.capabilities).toMatchObject({
      canPhysicalAct: true,
      canMentalAct: true,
      canReact: true,
      canActiveDefend: true,
      effectiveControllerId: id(79),
    });
    expect(result.sheet.sourceControlState?.automaticAdviserOrNull).toMatchObject({
      cardId: id(79),
      symbiontInstanceId: id(70),
      sourceRuleId: 'SYM-100',
      skills: [{ skillKey: 'STEALTH', bonus: 5, slotCost: 5 }],
    });
    expect(result.sheet.input.skills).toEqual(f.value.input.skills);
    expect(result.sheet.symbionts[0]?.currentOE).toBe(0);
    const both = formalControls(['SLEEP', 'PARALYSIS'], runtimeOrdinary('ADVISER'));
    const blocked = buildNpcHumanoidSnapshot(
      source.humanoid,
      both.value,
      null,
      null,
      null,
      null,
      both.context,
    );
    expect(blocked.sheet.capabilities).toMatchObject({
      canPhysicalAct: false,
      canMentalAct: false,
      effectiveControllerId: id(2),
    });
    expect(blocked.sheet.sourceControlState?.automaticAdviserOrNull).toBeNull();
  });
  it('previews a real pending control without inventing a future COMMIT and rejects forged saved origins', () => {
    const f = formalControls(['PARALYSIS']);
    const history = f.context.formalControls![0]!.history;
    const runtime: NpcHumanoidRuntimeEffectPreview = {
      npcUuid: f.value.npcUuid,
      campaignTimestampOrNull: 2707,
      calendarAnchorOrNull: history.calendarAnchor,
      preparationBasis: deriveNpcInitialEffectPreparation(source, basisInput(f.value)),
      alcohol: [],
      hpModes: [],
      hpModeSourceOrNull: null,
      provenHealingTimers: [],
      formalControls: [
        {
          kind: 'PREPARED',
          sourceOperationId: history.initialStateConfirmationId,
          preparedAt: history.createdAt,
          effectInstanceId: history.effectInstanceId,
          controlKind: history.controlKind,
          remainingMinutes: history.remainingMinutes,
          reason: history.reason,
        },
      ],
    };
    const result = previewNpcHumanoid(
      source.humanoid,
      runtimePreviewInput(f.value),
      null,
      null,
      null,
      null,
      runtime,
    );
    expect(result.sheet.capabilities.canMentalAct).toBe('CONDITIONAL_NO_SPEECH_MOVEMENT_BODY');
    expect(Object.hasOwn(result, 'derivation')).toBe(false);
    expect(result.sheet.preparedRuntimeState?.effects[0]).toEqual(
      f.value.input.initialState.effectInstances[0],
    );
    expect(() =>
      buildNpcHumanoidSnapshot(source.humanoid, f.value, null, null, null, null, {
        ...f.context,
        formalControls: [
          { ...f.context.formalControls![0]!, history: { ...history, remainingMinutes: '29' } },
        ],
      }),
    ).toThrow();
    expect(() =>
      buildNpcHumanoidSnapshot(source.humanoid, f.value, null, null, null, null, {
        ...f.context,
        formalControls: [],
      }),
    ).toThrow('origin');
  });
  it('applies actual Hunger after disease additions and before the raw threshold, without HP activation', () => {
    const f = runtimeOrdinary('CHIMERA', 6);
    const ordinary = deriveNpcOrdinaryRuntimeBasis(source.ordinaryHumanoid, {
      npcUuid: f.npcUuid,
      compositionProof: f.compositionProof,
      ordinaryProof: f.ordinaryProof,
    });
    const hpSource = deriveNpcOrdinaryHpModeSource(ordinary.proof);
    const history: NpcHpModeHistoryAnchor = {
      effectInstanceId: id(82),
      npcUuid: id(1),
      sourceInstanceId: id(70),
      mode: 'HUNGER',
      initialStateConfirmationId: id(83),
      reason: 'Explicit current Hunger',
      createdAt: '2026-11-06T04:00:00.000Z',
      calendarAnchor: {
        kind: 'PRE_START_INITIAL',
        campaignTimestamp: 2707,
        lobbySnapshotRevision: 'a'.repeat(64),
      },
      remainingMinutes: '5',
      revision: 1,
    };
    const effect = createNpcInitialHpModeEffect(source.hpModes, history, hpSource);
    const modeStats = deriveNpcHpModeStatProfile(source.hpModes, {
      source: hpSource,
      campaignTimestamp: 2707,
      modes: [effect],
      histories: [history],
    });
    expect(readNpcHpModeStatProfile(modeStats)).toBe(modeStats);
    expect(() => readNpcHpModeStatProfile(structuredClone(modeStats))).toThrow('issued');
    const value: NpcHumanoidBuildInput = {
      ...f,
      input: {
        ...f.input,
        initialState: { ...f.input.initialState, currentHP: 7, effectInstances: [effect] },
      },
      initialRuntimeProof: {
        commitOperationId: id(3),
        assignments: [{ effectInstanceId: id(82), originCommitOperationId: id(3) }],
      },
    };
    const context: NpcHumanoidRuntimeEffectContext = {
      npcUuid: id(1),
      commitOperationId: id(3),
      campaignTimestampOrNull: 2707,
      alcohol: [],
      hpModes: [{ effect, history, originCommitOperationId: id(3) }],
      hpModeSourceOrNull: hpSource,
      provenHealingTimers: [],
    };
    const saved = buildNpcHumanoidSnapshot(source.humanoid, value, null, null, null, null, context);
    expect(saved.sheet.input.initialState.currentHP).toBe(7);
    expect(saved.sheet.maxHP).toBe(2 * (source.passiveHealth.ordinaryBaseHP + 100)); // CORE-152, MON-012, MON-023.
    expect(saved.sheet.stats.permanentStats).toEqual({
      S: 18,
      D: 20,
      M: 20,
      Z: 10,
      I: 5,
      W: 2,
      C: 20,
    });
    expect(saved.sheet.stats.effectiveStats).toEqual({
      S: 36,
      D: 40,
      M: 40,
      Z: 20,
      I: 5,
      W: 2,
      C: 20,
    });
    expect(saved.sheet.stats.equippedStats).toEqual(saved.sheet.stats.permanentStats);
    expect(saved.sheet).not.toHaveProperty('diseaseState');
    expect(
      readNpcHumanoidSnapshot(source.humanoid, saved, null, null, null, null, context),
    ).toEqual(saved);
    const preparation = deriveNpcInitialEffectPreparation(source, basisInput(value), modeStats);
    expect(preparation.effectiveStats.Z).toBe(20);
    expect(() => readNpcInitialEffectPreparation(preparation, basisInput(value))).toThrow();
    expect(() =>
      deriveNpcInitialEffectPreparation(source, basisInput(value), structuredClone(modeStats)),
    ).toThrow('issued');
    expect(() =>
      deriveNpcInitialEffectPreparation(source, basisInput(runtimeOrdinary('WEAVER')), modeStats),
    ).toThrow();
    // A valid UNITED+Chimera basis with entered M11/Z12 has permanent M11/Z2.
    // Pneumonia MON-080 subtracts M14/S12/D12, then MON-023 doubles S,D,M,Z.
    const disease = previewNpcDiseaseStatContribution(
      source.diseaseUnconsciousness,
      {
        assignments: [{ effectInstanceId: id(90), diseaseId: 'DIS-PNEUMONIA' }],
        permanentStats: { ...saved.sheet.stats.permanentStats, M: 11, Z: 2 },
      },
      modeStats,
    ).contribution;
    expect(disease.rawFinalStats).toEqual({ S: 12, D: 16, M: -6, Z: 4, I: 5, W: 2, C: 20 });
    expect(disease.effectiveStats.M).toBe(1);
    expect(disease.unconsciousness.triggers.length).toBeGreaterThan(0);
  });
  it('round-trips all three initial monsters in the existing complete humanoid format', () => {
    for (const species of ['CHIMERA', 'PUPPETEER', 'PLAGUE_DOCTOR'] as const) {
      const input = runtimeOrdinary(species, 1);
      const saved = buildNpcHumanoidSnapshot(source.humanoid, input);
      expect(saved.format).toBe('NPC_HUMANOID_V1');
      expect(saved.sheet.symbionts[0]).toMatchObject({
        speciesKey: species,
        currentOE: 0,
        computedMaxOE: 400,
      });
      expect(saved.sheet.input.initialState.currentHP).toBe(input.input.initialState.currentHP);
      expect(readNpcHumanoidSnapshot(source.humanoid, JSON.parse(JSON.stringify(saved)))).toEqual(
        saved,
      );
      const basis = deriveNpcOrdinaryRuntimeBasis(source.ordinaryHumanoid, {
        npcUuid: input.npcUuid,
        compositionProof: input.compositionProof,
        ordinaryProof: input.ordinaryProof,
      });
      const hpSource = deriveNpcOrdinaryHpModeSource(basis.proof);
      expect(hpSource.monsterOrNull).toEqual(input.input.symbionts[0]);
      expect(hpSource.ordinarySymbionts).toEqual([]);
      expect(hpSource.chimeraSlotProofOrNull).toBeNull();
      expect(hpSource.previousChimeraSlotProofOrNull).toBeNull();
      expect(saved.derivation).not.toHaveProperty('initialRuntimeProof');
    }
  });
  function alcohol() {
    const f = fixture();
    const result = createNpcAlcoholEffect(
      source.alcoholEffects,
      {
        effectInstanceIdOrNull: id(80),
        createdAtOrNull: '2026-11-06T04:00:00.000Z',
        effectiveZ: 15,
        reason: 'Explicit initial state',
      },
      {
        kind: 'NEW_FORMAL_ASSIGNMENT',
        targetActorId: id(1),
        campaignTimestampOrNull: 2707,
        dead: false,
        poisonResponse: deriveNpcAlcoholPoisonResponse(
          source.alcoholPoisonResponse,
          f.compositionProof,
        ),
      },
    );
    if (result.kind !== 'ACTIVE') throw Error('actual positive duration required');
    const history: NpcAlcoholHistoryAnchor = {
      effectInstanceId: id(80),
      targetActorId: id(1),
      createdAt: '2026-11-06T04:00:00.000Z',
      effectiveZAtAssignment: 15,
      startsAt: { campaignTimestamp: 2707 },
      expiresAt: { campaignTimestamp: 3607 },
      nextTickAt: { campaignTimestamp: 2767 },
      lastTickAt: null,
      remainingExact: '15',
      revision: 1,
    };
    const context: NpcHumanoidRuntimeEffectContext = {
      npcUuid: id(1),
      commitOperationId: id(3),
      campaignTimestampOrNull: 2707,
      alcohol: [{ effect: result.effect, history, originCommitOperationId: id(3) }],
      hpModes: [],
      hpModeSourceOrNull: null,
      provenHealingTimers: [],
    };
    return {
      context,
      value: {
        ...f,
        input: {
          ...f.input,
          initialState: { ...f.input.initialState, effectInstances: [result.effect] },
        },
        initialRuntimeProof: {
          commitOperationId: id(3),
          assignments: [{ effectInstanceId: id(80), originCommitOperationId: id(3) }],
        },
      },
    };
  }
  it('retains the original alcohol timer through serialization and later N+1 without damage or reanchoring', () => {
    const f = alcohol();
    const saved = buildNpcHumanoidSnapshot(
      source.humanoid,
      f.value,
      null,
      null,
      null,
      null,
      f.context,
    );
    expect(saved.sheet.input.initialState.currentHP).toBe(70);
    expect(saved.sheet.requiresCampaignTime).toBe(true);
    expect(saved.sheet.input.initialState.effectInstances[0]).toEqual(f.context.alcohol[0]?.effect);
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        JSON.parse(JSON.stringify(saved)),
        null,
        null,
        null,
        null,
        { ...f.context, campaignTimestampOrNull: 2710 },
      ),
    ).toEqual(saved);
    const next = buildNpcHumanoidSnapshot(
      source.humanoid,
      {
        ...f.value,
        input: { ...f.value.input, identity: { ...f.value.input.identity, name: 'Later name' } },
      },
      null,
      null,
      null,
      null,
      { ...f.context, campaignTimestampOrNull: 2710 },
    );
    expect(next.sheet.input.initialState.effectInstances).toEqual(
      saved.sheet.input.initialState.effectInstances,
    );
    expect(next.sheet.input.initialState.currentHP).toBe(70);
  });
  it('refuses missing/foreign/changed/orphan runtime history and a candidate self-certifying its timer', () => {
    const f = alcohol();
    const build = (value: unknown, context: NpcHumanoidRuntimeEffectContext | null) =>
      buildNpcHumanoidSnapshot(source.humanoid, value, null, null, null, null, context);
    expect(() => build(f.value, null)).toThrow();
    expect(() => build(f.value, { ...f.context, npcUuid: id(99) })).toThrow();
    expect(() => build(f.value, { ...f.context, alcohol: [] })).toThrow();
    expect(() =>
      build(f.value, {
        ...f.context,
        alcohol: f.context.alcohol.map((e) => ({ ...e, originCommitOperationId: id(99) })),
      }),
    ).toThrow();
    const changed = structuredClone(f.value);
    Object.assign(changed.input.initialState.effectInstances[0]!.startsAt, {
      campaignTimestamp: 2708,
    });
    expect(() => build(changed, f.context)).toThrow();
    expect(() =>
      build(f.value, {
        ...f.context,
        alcohol: f.context.alcohol.map((e) => ({
          ...e,
          history: { ...e.history, effectiveZAtAssignment: 14 },
        })),
      }),
    ).toThrow();
  });
  it('derives alcohol response only from an enabled learned Toad source in the complete composition', () => {
    const toad = runtimeOrdinary('TOAD');
    expect(
      deriveNpcAlcoholPoisonResponse(source.alcoholPoisonResponse, toad.compositionProof),
    ).toBe('IMMUNE');
    expect(
      deriveNpcAlcoholPoisonResponse(
        source.alcoholPoisonResponse,
        runtimeOrdinary('WEAVER').compositionProof,
      ),
    ).toBe('APPLICABLE');
    const removed = structuredClone(toad.compositionProof);
    Object.assign(removed, {
      confirmations: [
        ...removed.confirmations,
        {
          confirmationCommandId: id(78),
          diceModeSnapshot: 'MANUAL',
          input: {
            kind: 'APPLY_COMPOSITION_EDIT',
            factId: id(79),
            journalId: id(6),
            ordinal: 2,
            raceCode: 'UNITED',
            removals: [id(70)],
            additions: [],
            buildChanges: [],
            currentOeChanges: [],
          },
        },
      ],
    });
    expect(deriveNpcAlcoholPoisonResponse(source.alcoholPoisonResponse, removed)).toBe(
      'APPLICABLE',
    );
    expect(() =>
      deriveNpcAlcoholPoisonResponse(
        { kind: 'SOURCE_BOUND_NPC_ALCOHOL_RESPONSE' },
        toad.compositionProof,
      ),
    ).toThrow();
  });
  function regeneration() {
    const f = runtimeOrdinary('WEAVER');
    const hpSource: NpcHpModeSourceEvidence = {
      npcUuid: id(1),
      compositionFactId: id(72),
      raceCode: 'UNITED',
      monsterOrNull: null,
      ordinarySymbionts: f.input.symbionts,
      unavailableSourceInstanceIds: [],
      chimeraSlotProofOrNull: null,
      previousChimeraSlotProofOrNull: null,
    };
    const history: NpcHpModeHistoryAnchor = {
      effectInstanceId: id(81),
      npcUuid: id(1),
      sourceInstanceId: id(70),
      mode: 'REGENERATION',
      initialStateConfirmationId: 'actual-regeneration-confirmation',
      reason: 'Explicit retained mode',
      createdAt: '2026-11-06T04:00:00.000Z',
      calendarAnchor: {
        kind: 'PRE_START_INITIAL',
        campaignTimestamp: 2707,
        lobbySnapshotRevision: 'a'.repeat(64),
      },
      remainingMinutes: '5',
      revision: 1,
    };
    const effect = createNpcInitialHpModeEffect(source.hpModes, history, hpSource);
    const context: NpcHumanoidRuntimeEffectContext = {
      npcUuid: id(1),
      commitOperationId: id(3),
      campaignTimestampOrNull: 2707,
      alcohol: [],
      hpModes: [{ effect, history, originCommitOperationId: id(3) }],
      hpModeSourceOrNull: hpSource,
      provenHealingTimers: [],
    };
    const value: NpcHumanoidBuildInput = {
      ...f,
      input: {
        ...f.input,
        initialState: { ...f.input.initialState, currentHP: 1000, effectInstances: [effect] },
      },
      initialRuntimeProof: {
        commitOperationId: id(3),
        assignments: [{ effectInstanceId: id(81), originCommitOperationId: id(3) }],
      },
    };
    return { value, context };
  }
  it('accepts source-bound Regeneration HP 1000 without invoking activation, healing, or base-HP clamps', () => {
    const f = regeneration();
    const saved = buildNpcHumanoidSnapshot(
      source.humanoid,
      f.value,
      null,
      null,
      null,
      null,
      f.context,
    );
    expect(saved.sheet.maxHP).toBe(1000);
    expect(saved.sheet.input.initialState.currentHP).toBe(1000);
    expect(saved.sheet.runtimeState?.hpModesOrNull).toMatchObject({
      regeneration: true,
      hunger: false,
      healingTimers: [],
      currentHP: 1000,
    });
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        JSON.parse(JSON.stringify(saved)),
        null,
        null,
        null,
        null,
        f.context,
      ),
    ).toEqual(saved);
    const explicitLower = buildNpcHumanoidSnapshot(
      source.humanoid,
      {
        ...f.value,
        input: { ...f.value.input, initialState: { ...f.value.input.initialState, currentHP: 7 } },
      },
      null,
      null,
      null,
      null,
      f.context,
    );
    expect(explicitLower.sheet.input.initialState.currentHP).toBe(7);
    expect(explicitLower.sheet.runtimeState?.hpModesOrNull?.healingTimers).toEqual([]);
    expect(() =>
      readNpcCombinedHpModeBoundary(structuredClone(saved.sheet.runtimeState?.hpModesOrNull)),
    ).toThrow('issued');
  });
  it('rejects unbound current source membership and HP outside actual mode bounds', () => {
    const f = regeneration();
    const build = (value: unknown, context: NpcHumanoidRuntimeEffectContext) =>
      buildNpcHumanoidSnapshot(source.humanoid, value, null, null, null, null, context);
    expect(() =>
      build(f.value, {
        ...f.context,
        hpModeSourceOrNull: { ...f.context.hpModeSourceOrNull!, ordinarySymbionts: [] },
      }),
    ).toThrow();
    expect(() =>
      build(f.value, {
        ...f.context,
        hpModeSourceOrNull: { ...f.context.hpModeSourceOrNull!, compositionFactId: 'unrelated' },
      }),
    ).toThrow();
    for (const currentHP of [0, 1001])
      expect(() =>
        build(
          {
            ...f.value,
            input: { ...f.value.input, initialState: { ...f.value.input.initialState, currentHP } },
          },
          f.context,
        ),
      ).toThrow();
    const without = { ...f.value, initialRuntimeProof: undefined };
    expect(() => build(without, f.context)).toThrow();
  });
  it('rejects reuse of an issued HP component for a different composition of the same NPC and base HP', () => {
    const f = regeneration();
    const saved = buildNpcHumanoidSnapshot(
      source.humanoid,
      f.value,
      null,
      null,
      null,
      null,
      f.context,
    );
    const component = saved.sheet.runtimeState?.hpModesOrNull;
    if (component === undefined || component === null)
      throw Error('issued Regeneration component required');
    const ordinary = {
      npcUuid: f.value.npcUuid,
      owningControllerId: f.value.owningControllerId,
      compositionProof: f.value.compositionProof,
      ordinaryProof: f.value.ordinaryProof,
      skillProof: f.value.skillProof,
      input: {
        ...f.value.input,
        inventory: [],
        initialState: { ...f.value.input.initialState, effectInstances: [] },
      },
    };
    expect(
      buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, ordinary, null, component).sheet
        .maxHP,
    ).toBe(1000);
    const alternateSource = { ...f.context.hpModeSourceOrNull!, compositionFactId: id(999) };
    const histories = f.context.hpModes.map((e) => e.history);
    const alternate = deriveNpcCombinedHpModes(source.hpModes, {
      baseMaxHP: component.baseMaxHP,
      currentHP: component.currentHP,
      source: alternateSource,
      histories,
      modes: histories.map((h) => createNpcInitialHpModeEffect(source.hpModes, h, alternateSource)),
      campaignTimestamp: 2707,
      healingTimers: [],
      provenHealingTimers: [],
    });
    expect(readNpcCombinedHpModeBoundary(alternate)).toMatchObject({
      npcUuid: id(1),
      baseMaxHP: component.baseMaxHP,
      currentHP: 1000,
      source: alternateSource,
    });
    expect(() =>
      buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, ordinary, null, alternate),
    ).toThrow();
    expect(() =>
      buildNpcOrdinaryHumanoidSnapshot(
        source.ordinaryHumanoid,
        ordinary,
        null,
        structuredClone(component),
      ),
    ).toThrow('issued');
  });
  it('requires an issued ordinary runtime basis in the standalone mode adapter', () => {
    const f = regeneration();
    const basis = deriveNpcOrdinaryRuntimeBasis(source.ordinaryHumanoid, {
      npcUuid: id(1),
      compositionProof: f.value.compositionProof,
      ordinaryProof: f.value.ordinaryProof,
    });
    expect(readNpcOrdinaryRuntimeBasis(basis)).toBe(basis);
    const request = {
      npcUuid: id(1),
      currentHP: 1000,
      effects: f.value.input.initialState.effectInstances,
      proof: f.value.initialRuntimeProof!,
      context: f.context,
      ordinaryBasisOrNull: basis,
    };
    expect(
      deriveNpcHumanoidRuntimeState(
        { alcohol: source.alcoholEffects, hpModes: source.hpModes },
        request,
      ).hpModesOrNull?.maxHP,
    ).toBe(1000);
    expect(() =>
      deriveNpcHumanoidRuntimeState(
        { alcohol: source.alcoholEffects, hpModes: source.hpModes },
        { ...request, ordinaryBasisOrNull: structuredClone(basis) },
      ),
    ).toThrow('issued');
    expect(() => readNpcOrdinaryRuntimeBasis({ ...basis, baseMaxHP: 999 })).toThrow('issued');
  });
  it('binds the version calendar to its own COMMIT while retaining the original effect COMMIT', () => {
    const f = alcohol();
    const later = {
      ...f.value,
      initialRuntimeProof: { ...f.value.initialRuntimeProof, commitOperationId: id(95) },
    };
    const context = { ...f.context, commitOperationId: id(95), campaignTimestampOrNull: 2710 };
    const saved = buildNpcHumanoidSnapshot(source.humanoid, later, null, null, null, null, context);
    expect(saved.derivation.initialRuntimeProof).toEqual({
      commitOperationId: id(95),
      assignments: [{ effectInstanceId: id(80), originCommitOperationId: id(3) }],
    });
    expect(saved.sheet.input.initialState.effectInstances).toEqual(
      f.value.input.initialState.effectInstances,
    );
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        JSON.parse(JSON.stringify(saved)),
        null,
        null,
        null,
        null,
        context,
      ),
    ).toEqual(saved);
    expect(() =>
      readNpcHumanoidSnapshot(source.humanoid, saved, null, null, null, null, f.context),
    ).toThrow();
    expect(() =>
      buildNpcHumanoidSnapshot(source.humanoid, later, null, null, null, null, {
        ...context,
        commitOperationId: id(96),
      }),
    ).toThrow();
  });
  function basisInput(
    value: NpcHumanoidBuildInput,
    diseaseAssignments: readonly { effectInstanceId: string; diseaseId: 'DIS-PNEUMONIA' }[] = [],
  ): NpcInitialEffectPreparationInput {
    const person = value.input.identity;
    return {
      npcUuid: value.npcUuid,
      schema: {
        raceCode: person.raceCode,
        pureClassOrNull: person.pureClassOrNull,
        sex: person.sex,
        massKg: person.massKg,
        anatomyProfileId: person.anatomyProfileId,
      },
      baseStats: value.input.baseStats,
      compositionProof: value.compositionProof,
      ordinaryProofOrNull: value.ordinaryProof ?? null,
      inventoryRequests: value.inventoryProof.entries.map((e) => e.request),
      diseaseAssignments,
      equipmentProofOrNull: null,
      equipmentContextOrNull: null,
    };
  }
  function runtimePreviewInput(value: NpcHumanoidBuildInput) {
    return {
      npcUuid: value.npcUuid,
      owningControllerId: value.owningControllerId,
      compositionProof: value.compositionProof,
      ...(value.ordinaryProof === undefined ? {} : { ordinaryProof: value.ordinaryProof }),
      input: {
        ...value.input,
        inventory: value.inventoryProof.entries.map((e) => e.request),
        skills: [
          {
            skillKey: value.ordinaryProof === undefined ? 'UNARMED' : 'STEALTH',
            targetBonus: 1,
            pool: 'START',
          },
        ],
        initialState: { ...value.input.initialState, effectInstances: [] },
      },
    };
  }
  it('derives the alcohol basis without HP input and binds exact disease/equipment/composition selections', () => {
    const f = regeneration();
    const input = basisInput(f.value, [{ effectInstanceId: id(90), diseaseId: 'DIS-PNEUMONIA' }]);
    const basis = deriveNpcInitialEffectPreparation(source, input);
    expect(basis.effectiveStats.Z).toBe(10); // CORE-001: 20−10; MON-080 has no Z modifier.
    expect(basis.poisonResponse).toBe('APPLICABLE');
    expect(input).not.toHaveProperty('currentHP');
    expect(readNpcInitialEffectPreparation(basis, input)).toBe(basis);
    expect(() => readNpcInitialEffectPreparation(structuredClone(basis), input)).toThrow('issued');
    expect(() =>
      readNpcInitialEffectPreparation(basis, { ...input, diseaseAssignments: [] }),
    ).toThrow();
    expect(() =>
      readNpcInitialEffectPreparation(basis, { ...input, inventoryRequests: [] }),
    ).toThrow();
    expect(() => readNpcInitialEffectPreparation(basis, { ...input, npcUuid: id(999) })).toThrow();
  });
  it('prepares physical stats with exact pending coating references while full inventory still requires proof', () => {
    const original = basisInput(fixture());
    const requests = original.inventoryRequests as readonly NpcInventoryRequestEntry[];
    const input = {
      ...original,
      inventoryRequests: requests.map((item, index) =>
        index === 0 ? { ...item, coatingInstanceIds: [id(890)] } : item,
      ),
    };
    const expected = deriveNpcInitialEffectPreparation(source, original);
    const basis = deriveNpcInitialEffectPreparation(source, input);
    expect(basis).toEqual(expected);
    expect(readNpcInitialEffectPreparation(basis, input)).toBe(basis);
    expect(() => readNpcInitialEffectPreparation(basis, original)).toThrow();
    expect(() =>
      buildNpcInventoryPreview(source.inventoryPublication, input.inventoryRequests),
    ).toThrow();
  });
  it('previews fresh Regeneration from the actual preparation without a future COMMIT or activation', () => {
    const f = regeneration();
    const input = basisInput(f.value);
    const history: NpcHpModeHistoryAnchor = {
      ...f.context.hpModes[0]!.history,
      initialStateConfirmationId: id(91),
      reason: 'Current mode',
    };
    const hpSource = f.context.hpModeSourceOrNull!;
    const modeStats = deriveNpcHpModeStatProfile(source.hpModes, {
      source: hpSource,
      campaignTimestamp: 2707,
      histories: [history],
      modes: [createNpcInitialHpModeEffect(source.hpModes, history, hpSource)],
    });
    const preparationBasis = deriveNpcInitialEffectPreparation(source, input, modeStats);
    const context: NpcHumanoidRuntimeEffectPreview = {
      npcUuid: id(1),
      campaignTimestampOrNull: 2707,
      calendarAnchorOrNull: {
        kind: 'PRE_START_INITIAL',
        campaignTimestamp: 2707,
        lobbySnapshotRevision: 'a'.repeat(64),
      },
      preparationBasis,
      alcohol: [],
      hpModes: [
        {
          kind: 'PREPARED',
          sourceOperationId: id(91),
          preparedAt: '2026-11-06T04:00:00.000Z',
          effectInstanceId: id(81),
          mode: 'REGENERATION',
          sourceInstanceId: id(70),
          reason: 'Current mode',
          remainingMinutes: '5',
        },
      ],
      hpModeSourceOrNull: f.context.hpModeSourceOrNull,
      provenHealingTimers: [],
    };
    const request = runtimePreviewInput(f.value);
    const result = previewNpcHumanoid(source.humanoid, request, null, null, null, null, context);
    expect(result.kind).toBe('UNCOMMITTED');
    expect(result.sheet.maxHP).toBe(1000);
    expect(result.sheet.input.initialState.currentHP).toBe(1000);
    expect(result.sheet.input.initialState.effectInstances).toEqual([]);
    expect(result.sheet.preparedRuntimeState).toMatchObject({
      kind: 'UNCOMMITTED_RUNTIME_SELECTION',
      hpModesOrNull: { regeneration: true, healingTimers: [] },
    });
    expect(result).not.toHaveProperty('derivation');
    expect(JSON.stringify(result)).not.toContain('originCommitOperationId');
    expect(() =>
      previewNpcHumanoid(source.humanoid, request, null, null, null, null, {
        ...context,
        preparationBasis: structuredClone(preparationBasis),
      }),
    ).toThrow('issued');
    expect(() =>
      previewNpcHumanoid(source.humanoid, request, null, null, null, null, {
        ...context,
        calendarAnchorOrNull: { ...context.calendarAnchorOrNull!, campaignTimestamp: 2708 },
      }),
    ).toThrow();
    const lower = previewNpcHumanoid(
      source.humanoid,
      {
        ...request,
        input: { ...request.input, initialState: { ...request.input.initialState, currentHP: 7 } },
      },
      null,
      null,
      null,
      null,
      context,
    );
    expect(lower.sheet.input.initialState.currentHP).toBe(7);
  });
  it('previews retained alcohol with its original timer and blocks a newly immune prepared alcohol selection', () => {
    const f = alcohol();
    const preparationBasis = deriveNpcInitialEffectPreparation(source, basisInput(f.value));
    const context: NpcHumanoidRuntimeEffectPreview = {
      npcUuid: id(1),
      campaignTimestampOrNull: 2710,
      calendarAnchorOrNull: null,
      preparationBasis,
      alcohol: f.context.alcohol.map((entry) => ({ kind: 'RETAINED', ...entry })),
      hpModes: [],
      hpModeSourceOrNull: null,
      provenHealingTimers: [],
    };
    const preview = previewNpcHumanoid(
      source.humanoid,
      runtimePreviewInput(f.value),
      null,
      null,
      null,
      null,
      context,
    );
    expect(preview.sheet.preparedRuntimeState?.effects).toEqual(
      f.value.input.initialState.effectInstances,
    );
    expect(preview.sheet.input.initialState.currentHP).toBe(70);
    const toad = runtimeOrdinary('TOAD');
    const immune: NpcHumanoidRuntimeEffectPreview = {
      ...context,
      preparationBasis: deriveNpcInitialEffectPreparation(source, basisInput(toad)),
      alcohol: [
        {
          kind: 'PREPARED',
          sourceOperationId: id(93),
          preparedAt: '2026-11-06T04:00:00.000Z',
          effectInstanceId: id(80),
          reason: 'Existing selected preparation',
        },
      ],
    };
    expect(() =>
      previewNpcHumanoid(
        source.humanoid,
        runtimePreviewInput(toad),
        null,
        null,
        null,
        null,
        immune,
      ),
    ).toThrow();
  });
});
describe('complete NPC_HUMANOID_V1 supported inventory branch', () => {
  it('uses the independently issued inventory prefix for N+1 while retaining original paid skill leaves', () => {
    const input = fixture();
    const first = buildNpcHumanoidSnapshot(catalog, input);
    const previous = {
      npcUuid: input.npcUuid,
      version: 1,
      sha256: createHash('sha256').update(JSON.stringify(first)).digest('hex'),
      commitOperationId: input.inventoryProof.commitOperationId,
    };
    const history: NpcInventoryPublicationContext = {
      history: [
        {
          ...previous,
          publication: buildNpcInventoryPublication(publication, input.inventoryProof),
        },
      ],
    };
    const inventory = buildNpcInventoryPublication(
      publication,
      {
        ...input.inventoryProof,
        commitOperationId: id(80),
        sourceOperationId: 'actual-npc015-next-confirm',
        committedAt: '2026-11-06T05:00:00.000Z',
        previous,
      },
      history,
    );
    const value = {
      ...input,
      inventoryProof: inventory.proof,
      input: { ...input.input, inventory: inventory.input },
    };
    const result = buildNpcHumanoidSnapshot(catalog, value, null, null, null, null, null, history);
    expect(result.derivation.skillProof).toEqual(first.derivation.skillProof);
    expect(result.sheet.itemProfiles[0]?.profileVersions).toEqual(
      first.sheet.itemProfiles[0]?.profileVersions,
    );
    expect(
      readNpcHumanoidSnapshot(
        catalog,
        JSON.parse(JSON.stringify(result)),
        null,
        null,
        null,
        null,
        null,
        history,
      ),
    ).toEqual(result);
    expect(() => buildNpcHumanoidSnapshot(catalog, value)).toThrow(
      'independently read prior history',
    );
    expect(() =>
      readNpcHumanoidSnapshot(catalog, result, null, null, null, null, null, {
        history: [{ ...history.history[0]!, npcUuid: id(90) }],
      }),
    ).toThrow();
  });
  it('combines actual paid skill mechanics and published item graph in every required sheet section', () => {
    const input = fixture(),
      result = buildNpcHumanoidSnapshot(catalog, input);
    expect(Object.keys(result.sheet.input)).toEqual([
      'identity',
      'baseStats',
      'symbionts',
      'skills',
      'lifetimeFacts',
      'inventory',
      'initialState',
    ]);
    expect(result.sheet.input.inventory).toHaveLength(1);
    expect(result.sheet.itemProfiles[0]?.item.ownerId).toBe(id(1));
    expect(result.sheet.stats.equippedStats).toEqual({
      S: 15,
      D: 12,
      M: 15,
      C: 10,
      I: 10,
      Z: 15,
      W: 4,
    });
    expect(result.sheet.stats.equippedStats).toEqual(result.sheet.stats.effectiveStats);
    expect(result.sheet.maxHP).toBe(100);
    expect(result.sheet.input.initialState.currentHP).toBe(70);
    expect(result.sheet.capabilities).toEqual({
      canPhysicalAct: true,
      canMentalAct: true,
      canReact: true,
      canActiveDefend: true,
      effectiveControllerId: id(2),
      regionPenaltyById: {},
    });
    expect(result.sheet.requiresCampaignTime).toBe(false);
    expect(result.sheet.combatContext).toEqual({ kind: 'ABSENT' });
    expect(result.derivation.skillProof.contexts[0]?.facts[0]?.factId).toBe(
      `NPC_INITIAL_SKILL/${id(3)}/1`,
    );
    expect(readNpcHumanoidSnapshot(catalog, JSON.parse(JSON.stringify(result)))).toEqual(result);
  });
  it('preserves every original item/profile/audit and paid proof in a metadata/HP candidate for N+1', () => {
    const input = fixture(),
      first = buildNpcHumanoidSnapshot(catalog, input);
    const next = buildNpcHumanoidSnapshot(catalog, {
      ...input,
      input: {
        ...input.input,
        identity: { ...input.input.identity, name: 'Новое имя' },
        initialState: { ...input.input.initialState, currentHP: 65 },
      },
    });
    expect(next.sheet.itemProfiles).toEqual(first.sheet.itemProfiles);
    expect(JSON.stringify(next.derivation)).toBe(JSON.stringify(first.derivation));
    expect(next.sheet.input.initialState.currentHP).toBe(65);
    expect(first.sheet.input.initialState.currentHP).toBe(70);
    expect(readNpcHumanoidSnapshot(catalog, JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it('does not change the historical exact clean snapshot codec', () => {
    const input = fixture(),
      clean = buildNpcCleanHumanoidSnapshot(source.cleanHumanoid, {
        npcUuid: input.npcUuid,
        owningControllerId: input.owningControllerId,
        input: { ...input.input, inventory: [] },
        skillProof: input.skillProof,
        compositionProof: input.compositionProof,
      });
    expect(clean.format).toBe('NPC_CLEAN_HUMANOID_V1');
    expect(Object.hasOwn(clean.derivation, 'inventoryProof')).toBe(false);
    expect(Object.hasOwn(clean.sheet.stats, 'equippedStats')).toBe(false);
    expect(
      readNpcCleanHumanoidSnapshot(source.cleanHumanoid, JSON.parse(JSON.stringify(clean))),
    ).toEqual(clean);
    expect(() =>
      readNpcCleanHumanoidSnapshot(source.cleanHumanoid, buildNpcHumanoidSnapshot(catalog, input)),
    ).toThrow();
  });
  it('refuses mismatched original COMMIT and owner bindings even with otherwise complete mechanics', () => {
    const input = fixture();
    expect(() =>
      buildNpcHumanoidSnapshot(catalog, {
        ...input,
        inventoryProof: { ...input.inventoryProof, commitOperationId: id(70) },
      }),
    ).toThrow();
    expect(() =>
      buildNpcHumanoidSnapshot(catalog, {
        ...input,
        inventoryProof: { ...input.inventoryProof, npcUuid: id(71) },
      }),
    ).toThrow();
  });
  it('refuses edited inventory input instead of silently replacing it with the proof', () => {
    const input = fixture();
    expect(() =>
      buildNpcHumanoidSnapshot(catalog, { ...input, input: { ...input.input, inventory: [] } }),
    ).toThrow();
    expect(() =>
      buildNpcHumanoidSnapshot(catalog, {
        ...input,
        input: { ...input.input, inventory: [{ ...input.input.inventory[0], currentAmmo: 1 }] },
      }),
    ).toThrow();
  });
  it('refuses forged derived equipment/current stats and retained graph', () => {
    const saved = buildNpcHumanoidSnapshot(catalog, fixture());
    expect(() =>
      readNpcHumanoidSnapshot(catalog, {
        ...saved,
        sheet: {
          ...saved.sheet,
          stats: {
            ...saved.sheet.stats,
            equippedStats: { ...saved.sheet.stats.equippedStats, M: 99 },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      readNpcHumanoidSnapshot(catalog, { ...saved, sheet: { ...saved.sheet, itemProfiles: [] } }),
    ).toThrow();
    expect(() =>
      readNpcHumanoidSnapshot(catalog, {
        ...saved,
        derivation: { ...saved.derivation, unknownProof: [] },
      }),
    ).toThrow();
  });
  it('continues to reject effects/death/symbiont branches whose complete evaluator is not integrated', () => {
    const input = fixture();
    expect(() =>
      buildNpcHumanoidSnapshot(catalog, {
        ...input,
        input: { ...input.input, initialState: { ...input.input.initialState, dead: true } },
      }),
    ).toThrow();
    expect(() =>
      buildNpcHumanoidSnapshot(catalog, {
        ...input,
        input: {
          ...input.input,
          initialState: { ...input.input.initialState, effectInstances: [{}] },
        },
      }),
    ).toThrow();
  });
  it('does not run derived/input getters while rejecting untrusted saved snapshots', () => {
    let calls = 0;
    const input = fixture();
    expect(() =>
      buildNpcHumanoidSnapshot(catalog, {
        ...input,
        get input() {
          calls++;
          return input.input;
        },
      }),
    ).toThrow();
    const saved = buildNpcHumanoidSnapshot(catalog, input);
    expect(() =>
      readNpcHumanoidSnapshot(catalog, {
        ...saved,
        sheet: {
          ...saved.sheet,
          get stats() {
            calls++;
            return saved.sheet.stats;
          },
        },
      }),
    ).toThrow();
    expect(calls).toBe(0);
  });
  it('accepts the explicit optional Weaver catalog but refuses unknown life component keys', () => {
    const components = {
      cleanHumanoid: source.cleanHumanoid,
      inventoryPublication: publication,
      diseaseEffects: source.diseaseEffects,
      diseaseUnconsciousness: source.diseaseUnconsciousness,
      skills: source.skills,
      life: {
        formalLife: source.formalLife,
        functionalDuplicate: source.functionalDuplicate,
        formalWeaver: null,
      },
    };
    const sources = { characterDictionaries: dictionaries, characterRuntime };
    expect(() => createNpcHumanoidCatalog(components, sources)).not.toThrow();
    expect(() =>
      createNpcHumanoidCatalog(
        { ...components, life: { ...components.life, unknownLifeSource: null } } as never,
        sources,
      ),
    ).toThrow('unexpected record fields');
  });
  it('requires the delivered equippedStats layer contract without merging it into permanent stats', () => {
    const changed = (dictionaries as readonly Record<string, unknown>[]).map((row) =>
      row.Code === 'equippedStats' ? { ...row, Meaning: 'Invented permanent layer' } : row,
    );
    expect(() =>
      createNpcHumanoidCatalog(
        {
          cleanHumanoid: source.cleanHumanoid,
          inventoryPublication: publication,
          diseaseEffects: source.diseaseEffects,
          diseaseUnconsciousness: source.diseaseUnconsciousness,
          skills: source.skills,
        },
        { characterDictionaries: changed, characterRuntime },
      ),
    ).toThrow();
  });
});

describe('uncommitted humanoid inventory preview', () => {
  function previewInput() {
    const f = fixture();
    return {
      npcUuid: f.npcUuid,
      owningControllerId: f.owningControllerId,
      compositionProof: f.compositionProof,
      input: {
        ...f.input,
        skills: [{ skillKey: 'UNARMED', targetBonus: 1, pool: 'START' }],
        inventory: f.inventoryProof.entries.map((e) => e.request),
      },
    };
  }
  it('shows actual staged inventory and all sheet sections using the same source mechanics as COMMIT', () => {
    const input = previewInput(),
      before = JSON.stringify(input),
      result = previewNpcHumanoid(catalog, input);
    const saved = buildNpcHumanoidSnapshot(catalog, fixture());
    expect(result.kind).toBe('UNCOMMITTED');
    expect(Object.keys(result.sheet.input)).toEqual(Object.keys(saved.sheet.input));
    expect(result.sheet.input.inventory).toEqual(input.input.inventory);
    expect(result.sheet.itemProfiles[0]?.request.itemInstanceId).toBe(id(4));
    expect(result.sheet.stats).toEqual(saved.sheet.stats);
    expect(result.sheet.maxHP).toBe(saved.sheet.maxHP);
    expect(result.sheet.capabilities).toEqual(saved.sheet.capabilities);
    expect(result.sheet.requiresCampaignTime).toBe(false);
    expect(result.sheet.combatContext).toEqual({ kind: 'ABSENT' });
    expect(Object.hasOwn(result, 'derivation')).toBe(false);
    expect(Object.hasOwn(result, 'format')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('NPC_INITIAL_SKILL/');
    expect(JSON.stringify(result)).not.toContain('weaponProfileVersionId');
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(result.sheet.itemProfiles[0]?.request)).toBe(true);
  });
  it('does not silently discard unsupported equipped inventory or over-max HP', () => {
    const input = previewInput();
    expect(() =>
      previewNpcHumanoid(catalog, {
        ...input,
        input: { ...input.input, inventory: [{ ...input.input.inventory[0], equipped: true }] },
      }),
    ).toThrow();
    expect(() =>
      previewNpcHumanoid(catalog, {
        ...input,
        input: { ...input.input, initialState: { ...input.input.initialState, currentHP: 101 } },
      }),
    ).toThrow();
    expect(() =>
      previewNpcHumanoid(catalog, { ...input, inventoryProof: fixture().inventoryProof }),
    ).toThrow();
  });
});

describe('complete source-backed humanoid disease state and immutable origins', () => {
  const committedAt = '2026-11-06T05:00:00.000Z',
    minute = 2707;
  function assigned(
    kind: 'DIS-POISONING' | 'DIS-PNEUMONIA' | 'DIS-FLATULENCE' = 'DIS-POISONING',
    baseStats: Parameters<typeof fixture>[0] = { S: 4, D: 10, M: 10, C: 10, I: 10, Z: 10, W: 4 },
    selections?: Parameters<typeof fixture>[1],
  ) {
    const f = fixture(baseStats, selections),
      scope = { targetActorId: f.npcUuid, campaignTimestampOrNull: minute, dead: false };
    const effect =
      kind === 'DIS-PNEUMONIA'
        ? createNpcPneumoniaEffect(
            source.diseaseEffects,
            { effectInstanceId: id(20), createdAt: committedAt },
            scope,
          )
        : createNpcUntimedDiseaseEffect(
            source.nonperiodicDiseases,
            { effectInstanceId: id(20), diseaseId: kind, createdAt: committedAt },
            scope,
          );
    const context: NpcHumanoidInitialStateContext = {
      npcUuid: f.npcUuid,
      commitOperationId: id(3),
      campaignTimestampOrNull: minute,
      origins: [
        {
          effectInstanceId: id(20),
          diseaseId: kind,
          originOperationId: id(3),
          targetActorId: f.npcUuid,
          committedAt,
          campaignTimestamp: minute,
        },
      ],
    };
    const value = {
      ...f,
      input: { ...f.input, initialState: { ...f.input.initialState, effectInstances: [effect] } },
      initialStateProof: {
        commitOperationId: id(3),
        assignments: [{ effectInstanceId: id(20), originOperationId: id(3) }],
      },
    };
    return { value, context, effect };
  }
  it('retains original paid skills, inventory and HP while deriving current disease penalties and skill availability', () => {
    const f = assigned(),
      old = buildNpcHumanoidSnapshot(catalog, fixture(f.value.input.baseStats)),
      bytes = JSON.stringify(f),
      result = buildNpcHumanoidSnapshot(catalog, f.value, f.context);
    expect(result.format).toBe('NPC_HUMANOID_V1');
    expect(result.sheet.input.skills).toEqual(old.sheet.input.skills);
    expect(result.derivation.skillProof).toEqual(old.derivation.skillProof);
    expect(result.sheet.input.inventory).toEqual(old.sheet.input.inventory);
    expect(result.sheet.itemProfiles).toEqual(old.sheet.itemProfiles);
    expect(result.sheet.stats.permanentStats).toEqual(old.sheet.stats.permanentStats);
    expect(result.sheet.stats.effectiveStats.S).toBe(old.sheet.stats.permanentStats.S - 2);
    expect(result.sheet.stats.effectiveStats.M).toBe(old.sheet.stats.permanentStats.M - 2);
    expect(result.sheet.stats.equippedStats).toEqual(result.sheet.stats.effectiveStats);
    expect(result.sheet.diseaseState?.currentSkills.disabledSkillKeys).toContain('UNARMED');
    expect(result.sheet.input.initialState.currentHP).toBe(old.sheet.input.initialState.currentHP);
    expect(result.sheet.maxHP).toBe(old.sheet.maxHP);
    expect(result.sheet.requiresCampaignTime).toBe(true);
    expect(result.sheet.combatContext).toEqual({ kind: 'ABSENT' });
    expect(result.sheet.capabilities.effectiveControllerId).toBe(old.owningControllerId);
    expect(JSON.stringify(f)).toBe(bytes);
    expect(readNpcHumanoidSnapshot(catalog, JSON.parse(JSON.stringify(result)), f.context)).toEqual(
      result,
    );
  });
  it('applies MON-075 before the CORE-078 floor while preserving the owning controller and HP', () => {
    // CORE-013 adds M+5/Z+5; MON-080 then subtracts M14 before CORE-078 floors it.
    const f = assigned('DIS-PNEUMONIA', { S: 10, D: 10, M: 1, C: 10, I: 10, Z: 1, W: 2 }, []),
      value = {
        ...f.value,
        input: { ...f.value.input, initialState: { ...f.value.input.initialState, currentHP: 1 } },
      },
      result = buildNpcHumanoidSnapshot(catalog, value, f.context);
    expect(result.sheet.diseaseState?.contribution.unconsciousness.triggers).toContainEqual({
      effectInstanceId: id(20),
      diseaseId: 'DIS-PNEUMONIA',
      stat: 'M',
      effectiveStat: -8,
      effectiveZ: 6,
      sum: -2,
    });
    expect(result.sheet.stats.effectiveStats.M).toBe(1);
    expect(result.sheet.stats.effectiveStats.Z).toBe(6);
    expect(result.sheet.capabilities).toMatchObject({
      canPhysicalAct: false,
      canMentalAct: false,
      canReact: false,
      canActiveDefend: false,
      effectiveControllerId: f.value.owningControllerId,
    });
    expect(result.sheet.input.initialState.currentHP).toBe(1);
    expect(result.sheet.input.initialState.effectInstances).toEqual([f.effect]);
    expect(readNpcHumanoidSnapshot(catalog, result, f.context)).toEqual(result);
  });

  it('shows the actual selected disease consequences before COMMIT without inventing acquisition or effect records', () => {
    const f = assigned(),
      saved = buildNpcHumanoidSnapshot(catalog, f.value, f.context);
    const input = {
      npcUuid: f.value.npcUuid,
      owningControllerId: f.value.owningControllerId,
      compositionProof: f.value.compositionProof,
      input: {
        ...f.value.input,
        skills: [{ skillKey: 'UNARMED', targetBonus: 1, pool: 'START' }],
        inventory: f.value.inventoryProof.entries.map((e) => e.request),
        initialState: { ...f.value.input.initialState, effectInstances: [] },
      },
    };
    const selection = {
      assignments: [
        { effectInstanceId: f.effect.effectInstanceId, diseaseId: f.effect.payload.diseaseId },
      ],
    };
    const before = JSON.stringify({ input, selection });
    const preview = previewNpcHumanoid(catalog, input, selection);
    expect(preview.kind).toBe('UNCOMMITTED');
    expect(preview.sheet.stats).toEqual(saved.sheet.stats);
    expect(preview.sheet.capabilities).toEqual(saved.sheet.capabilities);
    expect(preview.sheet.maxHP).toBe(saved.sheet.maxHP);
    expect(preview.sheet.requiresCampaignTime).toBe(true);
    expect(preview.sheet.preparedDiseaseState?.contribution).toEqual(
      saved.sheet.diseaseState?.contribution,
    );
    expect(preview.sheet.preparedDiseaseState?.currentSkills).toEqual(
      saved.sheet.diseaseState?.currentSkills,
    );
    expect(preview.sheet.preparedDiseaseState?.assignments).toEqual(selection.assignments);
    expect(preview.sheet.input.initialState.effectInstances).toEqual([]);
    expect(preview.sheet.input.initialState.currentHP).toBe(
      saved.sheet.input.initialState.currentHP,
    );
    expect(JSON.stringify({ input, selection })).toBe(before);
    for (const key of ['createdAt', 'startsAt', 'operationId', 'NPC_INITIAL_SKILL/', 'derivation'])
      expect(JSON.stringify(preview)).not.toContain(key);
    const cleared = previewNpcHumanoid(catalog, input, { assignments: [] });
    expect(cleared.sheet.requiresCampaignTime).toBe(false);
    expect(cleared.sheet.preparedDiseaseState?.currentSkills.disabledSkillKeys).toEqual([]);
    expect(cleared.sheet.stats.effectiveStats).toEqual(saved.sheet.stats.permanentStats);
    expect(() =>
      previewNpcHumanoid(catalog, input, { ...selection, createdAt: 'future' } as never),
    ).toThrow();
  });
  it('keeps absolute pneumonia origin and tick bytes through a later version without a creation tick', () => {
    const f = assigned('DIS-PNEUMONIA'),
      first = buildNpcHumanoidSnapshot(catalog, f.value, f.context);
    const later = {
      ...f.value,
      initialStateProof: { ...f.value.initialStateProof, commitOperationId: id(30) },
    };
    const context = {
      ...f.context,
      commitOperationId: id(30),
      campaignTimestampOrNull: minute + 10,
    };
    const next = buildNpcHumanoidSnapshot(catalog, later, context);
    expect(next.sheet.input.initialState.effectInstances).toEqual([f.effect]);
    expect(next.sheet.input.initialState.currentHP).toBe(first.sheet.input.initialState.currentHP);
    expect(next.sheet.input.initialState.effectInstances[0]?.startsAt).toEqual({
      campaignTimestamp: minute,
    });
    expect(next.sheet.input.initialState.effectInstances[0]?.tickSchedule?.nextTickAt).toEqual({
      campaignTimestamp: 4147,
    });
    expect(next.derivation.initialStateProof?.assignments).toEqual(
      first.derivation.initialStateProof?.assignments,
    );
    expect(readNpcHumanoidSnapshot(catalog, JSON.parse(JSON.stringify(next)), context)).toEqual(
      next,
    );
    expect(() => readNpcHumanoidSnapshot(catalog, next, f.context)).toThrow();
  });
  it('restores availability after removal without rewriting the original ledger or claiming to unlock campaign time', () => {
    const f = assigned(),
      first = buildNpcHumanoidSnapshot(catalog, f.value, f.context);
    const cleared = {
      ...f.value,
      input: {
        ...f.value.input,
        initialState: { ...f.value.input.initialState, effectInstances: [] },
      },
      initialStateProof: { commitOperationId: id(30), assignments: [] },
    };
    const context = { ...f.context, commitOperationId: id(30), origins: [] };
    const next = buildNpcHumanoidSnapshot(catalog, cleared, context);
    expect(next.sheet.stats.effectiveStats).toEqual(first.sheet.stats.permanentStats);
    expect(next.sheet.diseaseState?.currentSkills.disabledSkillKeys).toEqual([]);
    expect(next.sheet.input.skills).toEqual(first.sheet.input.skills);
    expect(next.sheet.requiresCampaignTime).toBe(false);
    expect(Object.hasOwn(next.sheet, 'initialTimeLockOrNull')).toBe(false);
    expect(next.sheet.capabilities).toEqual(
      buildNpcHumanoidSnapshot(catalog, fixture()).sheet.capabilities,
    );
  });
  it('retains the separate STEALTH check consequence in the complete sheet', () => {
    const f = assigned('DIS-FLATULENCE'),
      result = buildNpcHumanoidSnapshot(catalog, f.value, f.context);
    expect(result.sheet.diseaseState?.contribution.checkModifiers).toEqual([
      { effectInstanceId: id(20), diseaseId: 'DIS-FLATULENCE', targetCode: 'STEALTH', value: -5 },
    ]);
    expect(result.sheet.stats.effectiveStats.C).toBe(result.sheet.stats.permanentStats.C - 5);
  });
  it('refuses missing, foreign and candidate-forged time or identity evidence', () => {
    const f = assigned(),
      result = buildNpcHumanoidSnapshot(catalog, f.value, f.context);
    expect(() => buildNpcHumanoidSnapshot(catalog, f.value)).toThrow('context');
    expect(() => readNpcHumanoidSnapshot(catalog, result)).toThrow('context');
    for (const change of [
      { npcUuid: id(99) },
      { commitOperationId: id(99) },
      { campaignTimestampOrNull: null },
      { campaignTimestampOrNull: minute - 1 },
      { origins: [] },
    ])
      expect(() =>
        buildNpcHumanoidSnapshot(catalog, f.value, { ...f.context, ...change }),
      ).toThrow();
    for (const change of [
      { committedAt: '2026-11-06T05:01:00.000Z' },
      { campaignTimestamp: minute - 1 },
      { diseaseId: 'DIS-RHINITIS' },
      { originOperationId: id(99) },
      { effectInstanceId: id(99) },
      { targetActorId: id(99) },
    ] as const)
      expect(() =>
        buildNpcHumanoidSnapshot(catalog, f.value, {
          ...f.context,
          origins: [{ ...f.context.origins[0]!, ...change }],
        }),
      ).toThrow();
    expect(() =>
      readNpcHumanoidSnapshot(
        catalog,
        {
          ...result,
          sheet: {
            ...result.sheet,
            capabilities: { ...result.sheet.capabilities, effectiveControllerId: null },
          },
        },
        f.context,
      ),
    ).toThrow();
    expect(() =>
      readNpcHumanoidSnapshot(
        catalog,
        {
          ...result,
          sheet: {
            ...result.sheet,
            diseaseState: { ...result.sheet.diseaseState, unverified: true },
          },
        },
        f.context,
      ),
    ).toThrow();
  });
  it('preserves the old closed no-effect representation and refuses smuggled state without its explicit proof', () => {
    const old = buildNpcHumanoidSnapshot(catalog, fixture()),
      bytes = JSON.stringify(old);
    expect(readNpcHumanoidSnapshot(catalog, JSON.parse(bytes))).toEqual(old);
    expect(JSON.stringify(readNpcHumanoidSnapshot(catalog, JSON.parse(bytes)))).toBe(bytes);
    expect(Object.hasOwn(old.derivation, 'initialStateProof')).toBe(false);
    expect(Object.hasOwn(old.sheet, 'diseaseState')).toBe(false);
    const f = assigned();
    const { initialStateProof: _proof, ...missing } = f.value;
    expect(() => buildNpcHumanoidSnapshot(catalog, missing, f.context)).toThrow();
    expect(() =>
      readNpcHumanoidSnapshot(catalog, { ...old, sheet: { ...old.sheet, diseaseState: {} } }),
    ).toThrow();
  });
});

describe('humanoid initial trauma composition with external original evidence', () => {
  const scope = { campaignId: id(81), gmLocalContextId: id(2), ownerDeviceId: id(82) };
  const at = '2026-11-06T10:00:00.000Z';
  function assignedTrauma(
    regionId: 'TORSO' | 'HEAD' | 'ARM_L' = 'HEAD',
    penalty: 'PENDING' | 'CONSUMED' = 'PENDING',
    remaining: string | null = '0.5',
    n = 83,
  ) {
    const trauma = { traumaInstanceId: id(n), regionId, traumaValue: regionId === 'TORSO' ? 3 : 7 };
    const choice: NpcInitialTraumaChoice = {
      traumaInstanceId: trauma.traumaInstanceId,
      reason: 'Имеющееся исходное состояние',
      consequence:
        regionId === 'HEAD'
          ? {
              kind: 'HEAD',
              penalty,
              stun:
                remaining === null
                  ? { status: 'ABSENT' }
                  : { status: 'ACTIVE', remainingMinutes: remaining },
            }
          : regionId === 'TORSO'
            ? { kind: 'TORSO', hpInterpretation: 'CURRENT_HP_ALREADY_FINAL' }
            : { kind: 'LIMB' },
    };
    const evidence: NpcInitialTraumaEvidence = {
      phase: 'PENDING_COMMIT',
      scope,
      npcUuid: id(1),
      origin: {
        commitOperationId: id(3),
        sourceOperationId: 'actual-NPC016-confirmation',
        version: 1,
        committedAt: at,
      },
      trauma,
      choice,
      calendarAnchorOrNull:
        regionId === 'HEAD' && remaining !== null
          ? {
              kind: 'PRE_START_INITIAL',
              campaignTimestamp: 100,
              lobbySnapshotRevision: 'b'.repeat(64),
            }
          : null,
    };
    const fact = prepareNpcInitialTraumaFact(source.initialTrauma, evidence),
      base = fixture();
    const context: NpcHumanoidTraumaContext = {
      scope,
      npcUuid: id(1),
      commitOperationId: id(3),
      campaignTimestampOrNull: 100,
      evidence: [evidence],
      boundary: { kind: 'PENDING_COMMIT', commitOperationId: id(3), version: 1, committedAt: at },
    };
    const value = {
      ...base,
      input: {
        ...base.input,
        initialState: { ...base.input.initialState, currentHP: 7, currentTraumas: [trauma] },
      },
      initialTraumaProof: { commitOperationId: id(3), facts: [fact] },
    };
    return { value, context, evidence, fact };
  }
  it('keeps torso current HP final and composes limb penalties without an attack or EffectInstance', () => {
    const f = assignedTrauma('TORSO'),
      saved = buildNpcHumanoidSnapshot(source.humanoid, f.value, null, f.context);
    expect(saved.sheet.input.initialState.currentHP).toBe(7);
    expect(saved.sheet.traumaState?.hpDelta).toBe(0);
    expect(saved.sheet.input.initialState.effectInstances).toEqual([]);
    expect(saved.sheet.capabilities.canPhysicalAct).toBe(true);
    expect(saved.sheet.requiresCampaignTime).toBe(false);
    const limb = assignedTrauma('ARM_L'),
      result = buildNpcHumanoidSnapshot(source.humanoid, limb.value, null, limb.context);
    expect(result.sheet.traumaState?.globalCheckPenalty).toBe(-5);
    expect(result.sheet.traumaState?.limbs.find((l) => l.regionId === 'ARM_L')).toMatchObject({
      disabled: true,
      traumaTotal: 7,
    });
    expect(result.sheet.stats).toEqual(saved.sheet.stats);
  });
  it.each(['PENDING', 'CONSUMED'] as const)(
    'disables all four actions during actual HEAD ACTIVE independently of %s penalty and preserves expiry',
    (penalty) => {
      const f = assignedTrauma('HEAD', penalty),
        active = buildNpcHumanoidSnapshot(source.humanoid, f.value, null, f.context);
      for (const key of ['canPhysicalAct', 'canMentalAct', 'canReact', 'canActiveDefend'] as const)
        expect(active.sheet.capabilities[key]).toBe(false);
      expect(active.sheet.capabilities.effectiveControllerId).toBe(id(2));
      expect(active.sheet.traumaState?.headStuns[0]).toMatchObject({
        deadlineMinutes: '100.5',
        remainingMinutes: '0.5',
        activeNow: true,
      });
      expect(active.sheet.traumaState?.pendingHeadPenalties).toHaveLength(
        penalty === 'PENDING' ? 1 : 0,
      );
      const historical: NpcHumanoidTraumaContext = {
        ...f.context,
        boundary: { kind: 'HISTORICAL' },
        evidence: [{ ...f.evidence, phase: 'COMMITTED' }],
      };
      expect(
        readNpcHumanoidSnapshot(
          source.humanoid,
          JSON.parse(JSON.stringify(active)),
          null,
          historical,
        ),
      ).toEqual(active);
      expect(() => readNpcHumanoidSnapshot(source.humanoid, active, null)).toThrow();
      const expired = buildNpcHumanoidSnapshot(source.humanoid, f.value, null, {
        ...historical,
        campaignTimestampOrNull: 101,
      });
      expect(expired.sheet.capabilities.canPhysicalAct).toBe(true);
      expect(expired.sheet.traumaState?.headStuns[0]).toMatchObject({
        activeNow: false,
        remainingMinutes: '0',
        deadlineMinutes: '100.5',
      });
      expect(expired.derivation.initialTraumaProof?.facts).toEqual(
        active.derivation.initialTraumaProof?.facts,
      );
    },
  );
  it('keeps retained original HEAD evidence beside a fresh limb in N+1 and refuses another pending boundary', () => {
    const old = assignedTrauma('HEAD', 'CONSUMED'),
      next = assignedTrauma('ARM_L', 'PENDING', null, 84);
    const pending: NpcInitialTraumaEvidence = {
      ...next.evidence,
      origin: {
        ...next.evidence.origin,
        version: 2,
        commitOperationId: id(85),
        committedAt: '2026-11-06T11:00:00.000Z',
      },
    };
    const fact = prepareNpcInitialTraumaFact(source.initialTrauma, pending);
    const context: NpcHumanoidTraumaContext = {
      ...old.context,
      commitOperationId: id(85),
      campaignTimestampOrNull: 101,
      evidence: [{ ...old.evidence, phase: 'COMMITTED' }, pending],
      boundary: {
        kind: 'PENDING_COMMIT',
        commitOperationId: id(85),
        version: 2,
        committedAt: pending.origin.committedAt,
      },
    };
    const value = {
      ...old.value,
      initialTraumaProof: { commitOperationId: id(85), facts: [old.fact, fact] },
      input: {
        ...old.value.input,
        initialState: {
          ...old.value.input.initialState,
          currentTraumas: [old.fact.trauma, fact.trauma],
        },
      },
    };
    const saved = buildNpcHumanoidSnapshot(source.humanoid, value, null, context);
    expect(saved.derivation.initialTraumaProof?.facts[0]).toEqual(old.fact);
    expect(saved.sheet.traumaState?.headStuns[0]?.deadlineMinutes).toBe('100.5');
    expect(() =>
      buildNpcHumanoidSnapshot(source.humanoid, value, null, {
        ...context,
        boundary: { kind: 'HISTORICAL' },
      }),
    ).toThrow();
    expect(() =>
      buildNpcHumanoidSnapshot(source.humanoid, value, null, {
        ...context,
        boundary: {
          kind: 'PENDING_COMMIT',
          commitOperationId: id(86),
          version: 2,
          committedAt: pending.origin.committedAt,
        },
      }),
    ).toThrow();
  });
  it('does not restore an independent disease restriction after a HEAD timer expires or is absent', () => {
    const base = fixture({ S: 10, D: 10, M: 1, C: 10, I: 10, Z: 1, W: 2 }, []),
      f = assignedTrauma('HEAD', 'CONSUMED');
    const previewInput = {
      npcUuid: base.npcUuid,
      owningControllerId: base.owningControllerId,
      compositionProof: base.compositionProof,
      input: {
        ...base.input,
        skills: [],
        inventory: base.inventoryProof.entries.map((e) => e.request),
        initialState: { ...base.input.initialState, currentTraumas: [f.fact.trauma] },
      },
    };
    const retainedContext: NpcHumanoidTraumaContext = {
      ...f.context,
      campaignTimestampOrNull: 101,
      boundary: { kind: 'HISTORICAL' },
      evidence: [{ ...f.evidence, phase: 'COMMITTED' }],
    };
    const result = previewNpcHumanoid(
      source.humanoid,
      previewInput,
      { assignments: [{ effectInstanceId: id(88), diseaseId: 'DIS-PNEUMONIA' }] },
      {
        currentTraumas: [f.fact.trauma],
        choices: [f.evidence.choice],
        calendarAnchorOrNull: null,
        retained: { context: retainedContext, facts: [f.fact] },
      },
    );
    expect(result.sheet.traumaState?.headStuns[0]?.activeNow).toBe(false);
    for (const key of ['canPhysicalAct', 'canMentalAct', 'canReact', 'canActiveDefend'] as const)
      expect(result.sheet.capabilities[key]).toBe(false);
    expect(JSON.stringify(result)).not.toContain('createdAt');
  });
});

describe('complete NPC equipped layer and original physical compatibility', () => {
  const piece = (
    n: number,
    itemTypeId = 'ITM-ARM-002',
    bodyZone: NpcInventoryRequestEntry['bodyZone'] = 'TORSO',
  ): NpcInventoryRequestEntry => ({
    ...npcKensiRequest(id(n)),
    itemTypeId,
    profile: { kind: 'CATALOG' },
    currentAmmo: null,
    equipped: true,
    equippedSlots:
      bodyZone === null ? ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'] : [bodyZone],
    bodyZone,
    sealed: itemTypeId === 'ITM-ARM-005' ? true : null,
  });
  function gear(
    items: readonly NpcInventoryRequestEntry[],
    base: Parameters<typeof fixture>[0] = { S: 20, D: 20, M: 10, C: 10, I: 10, Z: 10, W: 4 },
  ) {
    const f = fixture(base);
    const inventory = buildNpcInventoryPublication(source.inventoryPublication, {
      ...f.inventoryProof,
      entries: items.map((request) => {
        if (request.itemTypeId === null) throw Error('catalogue gear fixture required');
        return {
          request,
          weaponProfileVersionId: request.itemTypeId.startsWith('ITM-ARM-') ? null : id(80),
        };
      }),
    });
    return {
      ...f,
      input: { ...f.input, inventory: inventory.input },
      inventoryProof: inventory.proof,
    };
  }
  function previewOf(f: ReturnType<typeof gear>) {
    return {
      npcUuid: f.npcUuid,
      owningControllerId: f.owningControllerId,
      compositionProof: f.compositionProof,
      input: {
        ...f.input,
        inventory: f.inventoryProof.entries.map((entry) => entry.request),
        skills: [{ skillKey: 'UNARMED', targetBonus: 1, pool: 'START' }],
      },
    };
  }
  it('keeps permanent, equipped and current disease layers distinct and reads exact gear back', () => {
    const f = gear(
      [piece(40), piece(41, 'ITM-ARM-002', 'HEAD'), piece(42, 'ITM-ARM-002', 'ARM_L')],
      { S: 20, D: 20, M: 20, C: 10, I: 10, Z: 10, W: 4 },
    );
    const result = buildNpcHumanoidSnapshot(source.humanoid, f);
    expect(result.sheet.stats.permanentStats.M).toBe(25);
    expect(result.sheet.stats.equippedStats.M).toBe(22);
    expect(result.sheet.stats.effectiveStats.M).toBe(22);
    expect(result.sheet.equipmentState?.armor.requiredStrength).toBe(9);
    expect(result.sheet.currentSkills?.pools.START.used).toBe(
      f.input.skills.fixedSkills.reduce((sum, skill) => sum + skill.slotCost, 0) +
        f.input.skills.learnedSkills
          .flatMap((skill) => skill.charges)
          .filter((charge) => charge.pool === 'START')
          .reduce((sum, charge) => sum + charge.chargedSlotCost, 0),
    );
    expect(readNpcHumanoidSnapshot(source.humanoid, JSON.parse(JSON.stringify(result)))).toEqual(
      result,
    );
    const preview = previewNpcHumanoid(source.humanoid, previewOf(f), {
      assignments: [{ effectInstanceId: id(88), diseaseId: 'DIS-PNEUMONIA' }],
    });
    expect(preview.sheet.stats).toMatchObject({
      permanentStats: { M: 25 },
      equippedStats: { M: 22 },
      effectiveStats: { M: 8 }, // MON-080: M-14 after the actual equipped layer.
    });
    expect(preview.sheet.currentSkills).toEqual(preview.sheet.preparedDiseaseState?.currentSkills);
    expect(() => buildNpcHumanoidSnapshot(catalog, f)).toThrow('equipment source catalog');
  });
  it('requires the same original NPC-specific physical approval at build, readback and preview', () => {
    const f = gear([piece(40, 'ITM-ARM-006', null), piece(41, 'ITM-ARM-001', 'HEAD')]);
    expect(() => buildNpcHumanoidSnapshot(source.humanoid, f)).toThrow(
      'physical armor compatibility',
    );
    const proof = {
      compatibilityProofOrNull: {
        confirmationId: 'actual-physical-approval',
        npcUuid: id(1),
        itemInstanceIds: [id(40), id(41)],
        reason: 'Проверены реальные слои',
      },
    };
    const context: NpcHumanoidEquipmentContext = {
      npcUuid: id(1),
      confirmations: [proof.compatibilityProofOrNull],
    };
    expect(() =>
      buildNpcHumanoidSnapshot(source.humanoid, { ...f, equipmentProof: proof }),
    ).toThrow('original equipment confirmation');
    const result = buildNpcHumanoidSnapshot(
      source.humanoid,
      { ...f, equipmentProof: proof },
      null,
      null,
      context,
    );
    expect(result.derivation.equipmentProof).toEqual(proof);
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        JSON.parse(JSON.stringify(result)),
        null,
        null,
        context,
      ),
    ).toEqual(result);
    expect(() =>
      readNpcHumanoidSnapshot(source.humanoid, result, null, null, { ...context, npcUuid: id(9) }),
    ).toThrow();
    expect(() =>
      readNpcHumanoidSnapshot(source.humanoid, result, null, null, {
        ...context,
        confirmations: [{ ...proof.compatibilityProofOrNull, reason: 'changed' }],
      }),
    ).toThrow();
    expect(() => previewNpcHumanoid(source.humanoid, previewOf(f))).toThrow(
      'physical armor compatibility',
    );
    const preview = previewNpcHumanoid(source.humanoid, previewOf(f), null, null, {
      proof,
      context,
    });
    expect(preview.sheet.equipmentState?.compatibilityRequired).toBe(false);
  });
  it('keeps raw equipment penalties through disease thresholds before the computational floor', () => {
    const f = gear([piece(40, 'ITM-ARM-008', null), piece(41, 'ITM-ARM-008', null)], {
      S: 20,
      D: 20,
      M: 1,
      C: 10,
      I: 10,
      Z: 10,
      W: 4,
    });
    const proof = {
      compatibilityProofOrNull: {
        confirmationId: 'actual-double-suit-approval',
        npcUuid: id(1),
        itemInstanceIds: [id(40), id(41)],
        reason: 'Проверенные два слоя',
      },
    };
    const context: NpcHumanoidEquipmentContext = {
      npcUuid: id(1),
      confirmations: [proof.compatibilityProofOrNull],
    };
    const saved = buildNpcHumanoidSnapshot(
      source.humanoid,
      { ...f, equipmentProof: proof },
      null,
      null,
      context,
    );
    expect(saved.sheet.stats.permanentStats.M).toBe(6);
    expect(saved.sheet.equipmentState?.rawEquippedStats.M).toBe(-4);
    expect(saved.sheet.stats.equippedStats.M).toBe(1);
    expect(saved.sheet.stats.effectiveStats.M).toBe(1);
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        JSON.parse(JSON.stringify(saved)),
        null,
        null,
        context,
      ),
    ).toEqual(saved);
    const preview = previewNpcHumanoid(
      source.humanoid,
      previewOf(f),
      { assignments: [{ effectInstanceId: id(88), diseaseId: 'DIS-PNEUMONIA' }] },
      null,
      { proof, context },
    );
    expect(preview.sheet.preparedDiseaseState?.contribution.permanentStats.M).toBe(6);
    expect(preview.sheet.preparedDiseaseState?.contribution.rawFinalStats.M).toBe(-18);
    expect(preview.sheet.stats.effectiveStats.M).toBe(1);
    expect(
      preview.sheet.preparedDiseaseState?.contribution.unconsciousness.triggers,
    ).not.toHaveLength(0);
  });
  it('keeps CORE-016 deficiency penalties contextual and recalculates them after disease reductions', () => {
    const f = gear([piece(40, 'ITM-ARM-008', null)], {
      S: 20,
      D: 20,
      M: 10,
      C: 10,
      I: 10,
      Z: 10,
      W: 4,
    });
    expect(buildNpcHumanoidSnapshot(source.humanoid, f).sheet.stats.effectiveStats.S).toBe(25);
    const sick = previewNpcHumanoid(source.humanoid, previewOf(f), {
      assignments: [{ effectInstanceId: id(88), diseaseId: 'DIS-PNEUMONIA' }],
    });
    expect(sick.sheet.stats.equippedStats.S).toBe(25);
    expect(sick.sheet.stats.effectiveStats.S).toBe(13); // CORE-013 +5, MON-080 −12.
    expect(sick.sheet.equipmentRequirements?.armor).toMatchObject({
      requiredStrength: 24,
      deficit: 11,
      penalty: 22,
    });
    const weapon = gear(
      [{ ...npcKensiRequest(id(40)), equipped: true, equippedSlots: ['HAND_L'] }],
      { S: 10, D: 10, M: 10, C: 10, I: 10, Z: 10, W: 4 },
    );
    const saved = buildNpcHumanoidSnapshot(source.humanoid, weapon),
      preview = previewNpcHumanoid(source.humanoid, previewOf(weapon));
    expect(saved.sheet.equipmentRequirements?.weapons).toEqual([
      {
        itemInstanceId: id(40),
        statRequirements: { S: 8, D: 19 },
        deficits: { S: 0, D: 7 },
        deficitTotal: 7,
        penalty: 14,
      },
    ]);
    expect(preview.sheet.equipmentRequirements).toEqual(saved.sheet.equipmentRequirements);
    expect(saved.sheet.stats.equippedStats.D).toBe(12);
    expect(saved.sheet.stats.effectiveStats.D).toBe(12);
    expect(readNpcHumanoidSnapshot(source.humanoid, JSON.parse(JSON.stringify(saved)))).toEqual(
      saved,
    );
  });
  it('leaves historical unequipped snapshots byte-identical under the newly capable catalog', () => {
    const f = fixture();
    expect(buildNpcHumanoidSnapshot(source.humanoid, f)).toEqual(
      buildNpcHumanoidSnapshot(catalog, f),
    );
    expect(
      Object.hasOwn(buildNpcHumanoidSnapshot(source.humanoid, f).sheet, 'equipmentState'),
    ).toBe(false);
  });
});

describe('complete NPC original explicit wound assignments', () => {
  function wounded() {
    const f = fixture();
    const wounds = [
      prepareNpcGmWound(
        { anatomyProfileId: 'STANDARD_HUMANOID' },
        { woundInstanceId: id(90), woundType: 'GENERIC', regionId: 'HEAD' },
      ),
      prepareNpcGmWound(
        { anatomyProfileId: 'STANDARD_HUMANOID' },
        { woundInstanceId: id(91), woundType: 'BLEEDING', regionId: 'ARM_L', damagePerTick: 4 },
      ),
    ];
    const context: NpcHumanoidWoundContext = {
      npcUuid: id(1),
      facts: wounds.map((wound, i) => ({
        kind: 'GM_WOUND_ASSIGNMENT',
        npcUuid: id(1),
        sourceOperationId: id(92 + i),
        wound,
      })),
    };
    const value = {
      ...f,
      input: { ...f.input, initialState: { ...f.input.initialState, currentWounds: wounds } },
      initialWoundProof: {
        assignments: context.facts.map((fact) => ({
          woundInstanceId: fact.wound.woundInstanceId,
          originOperationId: fact.sourceOperationId,
        })),
      },
    };
    const preview = {
      npcUuid: f.npcUuid,
      owningControllerId: f.owningControllerId,
      compositionProof: f.compositionProof,
      input: {
        ...value.input,
        inventory: f.inventoryProof.entries.map((e) => e.request),
        skills: [{ skillKey: 'UNARMED', targetBonus: 1, pool: 'START' }],
      },
    };
    return { value, context, preview, wounds };
  }
  it('preserves both wounds, current HP and origin refs through build/readback/N+1 without clock or damage', () => {
    const f = wounded(),
      saved = buildNpcHumanoidSnapshot(source.humanoid, f.value, null, null, null, f.context);
    expect(saved.sheet.input.initialState.currentWounds).toEqual(f.wounds);
    expect(saved.sheet.input.initialState.currentHP).toBe(70);
    expect(saved.sheet.requiresCampaignTime).toBe(false);
    expect(saved.sheet.combatContext).toEqual({ kind: 'ABSENT' });
    expect(saved.derivation.initialWoundProof).toEqual(f.value.initialWoundProof);
    expect(
      readNpcHumanoidSnapshot(
        source.humanoid,
        JSON.parse(JSON.stringify(saved)),
        null,
        null,
        null,
        f.context,
      ),
    ).toEqual(saved);
    const next = buildNpcHumanoidSnapshot(
      source.humanoid,
      {
        ...f.value,
        input: { ...f.value.input, identity: { ...f.value.input.identity, name: 'Новое имя' } },
      },
      null,
      null,
      null,
      f.context,
    );
    expect(next.sheet.input.initialState).toEqual(saved.sheet.input.initialState);
    expect(next.derivation.initialWoundProof).toEqual(saved.derivation.initialWoundProof);
  });
  it('requires independent matching owner, assignment IDs, order and exact saved wound payload', () => {
    const f = wounded();
    expect(() => buildNpcHumanoidSnapshot(source.humanoid, f.value)).toThrow(
      'independent wound origin',
    );
    const { initialWoundProof: _proof, ...unproved } = f.value;
    expect(() =>
      buildNpcHumanoidSnapshot(source.humanoid, unproved, null, null, null, f.context),
    ).toThrow('original wound proof');
    for (const context of [
      { ...f.context, npcUuid: id(9) },
      { ...f.context, facts: f.context.facts.map((fact) => ({ ...fact, npcUuid: id(9) })) },
      { ...f.context, facts: [...f.context.facts].reverse() },
      {
        ...f.context,
        facts: f.context.facts.map((fact) => ({ ...fact, sourceOperationId: id(99) })),
      },
      {
        ...f.context,
        facts: f.context.facts.map((fact) => ({
          ...fact,
          wound: { ...fact.wound, regionId: 'TORSO' as const },
        })),
      },
    ])
      expect(() =>
        buildNpcHumanoidSnapshot(source.humanoid, f.value, null, null, null, context),
      ).toThrow();
    const saved = buildNpcHumanoidSnapshot(source.humanoid, f.value, null, null, null, f.context);
    expect(() => readNpcHumanoidSnapshot(source.humanoid, saved)).toThrow(
      'independent wound origin',
    );
    const { initialWoundProof: _omitted, ...derivation } = saved.derivation;
    expect(() =>
      readNpcHumanoidSnapshot(
        source.humanoid,
        {
          ...saved,
          derivation,
          sheet: {
            ...saved.sheet,
            input: {
              ...saved.sheet.input,
              initialState: { ...saved.sheet.input.initialState, currentWounds: [] },
            },
          },
        },
        null,
        null,
        null,
        f.context,
      ),
    ).toThrow('selected wound origin cannot be omitted');
    expect(() =>
      readNpcHumanoidSnapshot(
        source.humanoid,
        {
          ...saved,
          sheet: {
            ...saved.sheet,
            input: {
              ...saved.sheet.input,
              initialState: { ...saved.sheet.input.initialState, currentWounds: [] },
            },
          },
        },
        null,
        null,
        null,
        f.context,
      ),
    ).toThrow();
  });
  it('composes wound preview with a separately selected disease without reapplying either wound', () => {
    const f = wounded();
    expect(() => previewNpcHumanoid(source.humanoid, f.preview)).toThrow('original wound proof');
    const preview = previewNpcHumanoid(
      source.humanoid,
      f.preview,
      { assignments: [{ effectInstanceId: id(88), diseaseId: 'DIS-PNEUMONIA' }] },
      null,
      null,
      f.context,
    );
    expect(preview.sheet.input.initialState.currentWounds).toEqual(f.wounds);
    expect(preview.sheet.input.initialState.currentHP).toBe(70);
    expect(preview.sheet.preparedDiseaseState?.assignments).toHaveLength(1);
    expect(preview.sheet.requiresCampaignTime).toBe(true);
    expect(JSON.stringify(preview)).not.toContain('originOperationId');
  });
});
