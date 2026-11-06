import {
  buildNpcCleanHumanoidSnapshot,
  readNpcCleanHumanoidSnapshot,
} from '../domain/rules/npc-authoring/clean-humanoid-sheet.js';
import { npcCleanHumanoidFixture } from '../../tests/fixtures/npc-clean-humanoid.js';
import {
  npcKensiRequest,
  npcPublishedInventoryFixture,
} from '../../tests/fixtures/npc-published-inventory.js';
import {
  buildNpcHumanoidSnapshot,
  readNpcHumanoidSnapshot,
} from '../domain/rules/npc-authoring/npc-humanoid-sheet.js';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  deriveNpcBaseStatLayers,
  validateNpcSchema,
} from '../domain/rules/npc-authoring/base-stats.js';
import { prepareNewNpcAlcoholParameters } from '../domain/rules/npc-authoring/initial-effects.js';
import {
  deriveNpcSymbiontNativeProfile,
  validateNpcNativeCurrentOe,
} from '../domain/rules/npc-authoring/symbiont-native-profile.js';
import {
  createNpcUntimedDiseaseEffect,
  validateNpcUntimedDiseaseEffect,
  validateNpcUntimedDiseaseEffects,
} from '../domain/rules/npc-authoring/untimed-disease-effects.js';
import { evaluateNpcDiseaseUnconsciousness } from '../domain/rules/npc-authoring/disease-unconsciousness.js';
import { createNpcPneumoniaEffect } from '../domain/rules/npc-authoring/periodic-disease-effects.js';
import {
  prepareNpcBasePeaceDeathTimer,
  validateNpcSavedBasePeaceDeathTimer,
} from '../domain/rules/npc-authoring/life-state.js';
import { loadNpcAuthoringSourceCatalog, type NpcAuthoringSourceCatalog } from './npc-catalog.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const actorId = '00000000-0000-4000-8000-000000000001';
const effectId = '00000000-0000-4000-8000-000000000002';
const createdAt = '2026-11-05T22:00:00.000Z';
let catalog: NpcAuthoringSourceCatalog;
beforeAll(async () => {
  catalog = await loadNpcAuthoringSourceCatalog(ROOT);
});

describe('NPC-011–016 actual source components', () => {
  it('loads an actual full supported sheet evaluator with the same issued source components', () => {
    const input = npcCleanHumanoidFixture(
      {
        baseStats: catalog.baseStats,
        skills: catalog.skills,
        compositionConsequences: catalog.compositionConsequences,
        passiveHealth: catalog.passiveHealth,
      },
      {
        npcUuid: actorId,
        owningControllerId: effectId,
        contextFactId: '00000000-0000-4000-8000-000000000003',
        compositionJournalId: '00000000-0000-4000-8000-000000000004',
      },
    );
    const snapshot = buildNpcCleanHumanoidSnapshot(catalog.cleanHumanoid, input);
    expect(snapshot.sheet).toMatchObject({
      maxHP: 100,
      input: { initialState: { currentHP: 70 } },
      capabilities: { effectiveControllerId: effectId },
      requiresCampaignTime: false,
    });
    expect(
      readNpcCleanHumanoidSnapshot(catalog.cleanHumanoid, JSON.parse(JSON.stringify(snapshot))),
    ).toEqual(snapshot);
    const fullInput = npcPublishedInventoryFixture(catalog.inventoryPublication, input, {
      npcUuid: actorId,
      commitOperationId: '00000000-0000-4000-8000-000000000005',
      sourceOperationId: '00000000-0000-4000-8000-000000000006',
      actorId: effectId,
      committedAt: createdAt,
      entries: [
        {
          request: npcKensiRequest('00000000-0000-4000-8000-000000000007'),
          weaponProfileVersionId: '00000000-0000-4000-8000-000000000008',
        },
      ],
    });
    const full = buildNpcHumanoidSnapshot(catalog.humanoid, fullInput);
    expect(full.sheet.itemProfiles[0]?.item).toMatchObject({
      itemTypeId: 'ITM-WPN-003',
      ownerId: actorId,
      currentAmmo: 0,
      createdAt,
      activeWeaponProfileVersionIdByVariant: {
        DEFAULT: '00000000-0000-4000-8000-000000000008',
      },
    });
    expect(full.sheet.stats.equippedStats).toEqual(snapshot.sheet.stats.effectiveStats);
    expect(full.sheet.maxHP).toBe(snapshot.sheet.maxHP);
    expect(readNpcHumanoidSnapshot(catalog.humanoid, JSON.parse(JSON.stringify(full)))).toEqual(
      full,
    );
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog.cleanHumanoid, {
        ...input,
        input: { ...input.input, initialState: { ...input.input.initialState, currentHP: 101 } },
      }),
    ).toThrow('CORE-077');
  });
  it('loads all development and inventory profiles without PC roots/starting-five restrictions', () => {
    expect(catalog.symbionts.species).toHaveLength(23);
    expect(catalog.development.nodes).toHaveLength(182);
    expect(catalog.development.levels).toHaveLength(144);
    expect(catalog.inventory.definitions).toHaveLength(64);
    expect(catalog.nonperiodicDiseases.diseaseIds).toHaveLength(8);
  });
  it('allows seven manual base 20 values and applies the source race layer separately', () => {
    const result = deriveNpcBaseStatLayers(catalog.baseStats, {
      schema: {
        raceCode: 'FREE',
        pureClassOrNull: null,
        anatomyProfileId: 'STANDARD_HUMANOID',
        sex: 'MALE',
        massKg: 80,
      },
      baseStats: { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 },
    });
    expect(Object.values(result.baseStats).reduce((sum, value) => sum + value, 0)).toBe(140);
    expect(result.baseStats).toEqual({ S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 });
    expect(() =>
      deriveNpcBaseStatLayers(catalog.baseStats, {
        schema: result.schema,
        baseStats: { ...result.baseStats, S: 21 },
      }),
    ).toThrow('CORE-078');
  });
  it('requires explicit race/sex mass bounds and the supported anatomy instead of PC defaults', () => {
    const schema = {
      raceCode: 'FREE',
      pureClassOrNull: null,
      anatomyProfileId: 'STANDARD_HUMANOID',
      sex: 'MALE',
      massKg: 80,
    };
    expect(validateNpcSchema(catalog.baseStats, schema).massKg).toBe(80);
    expect(() => validateNpcSchema(catalog.baseStats, { ...schema, massKg: 80.01 })).toThrow();
    expect(() =>
      validateNpcSchema(catalog.baseStats, { ...schema, anatomyProfileId: 'INVENTED' }),
    ).toThrow();
    expect(() => validateNpcSchema(catalog.baseStats, { ...schema, sex: 'UNKNOWN' })).toThrow();
  });
  it('derives every actual L1 native profile without refilling current OE and keeps sided choices explicit', () => {
    for (const species of catalog.symbionts.species) {
      const learnedNodeRefs = catalog.development.nodes
        .filter((node) => node.speciesKey === species.speciesKey && node.level === 1)
        .map((node) => node.nodeRef);
      const sided = species.bindingPolicy === 'OWL_EYE' || species.bindingPolicy === 'EEL_ARM';
      const binding = sided
        ? { kind: species.bindingPolicy, side: 'LEFT' }
        : { kind: species.bindingPolicy };
      const profile = deriveNpcSymbiontNativeProfile(catalog.nativeSymbionts, {
        symbiontInstanceId: actorId,
        speciesKey: species.speciesKey,
        targetLevel: 1,
        learnedNodeRefs,
        binding,
      });
      expect(profile.nativeMaxOE).toBe(species.initialCurrentOe);
      expect(validateNpcNativeCurrentOe(profile, 0)).toBe(0);
      expect(validateNpcNativeCurrentOe(profile, profile.nativeMaxOE)).toBe(profile.nativeMaxOE);
      expect(() => validateNpcNativeCurrentOe(profile, profile.nativeMaxOE + 1)).toThrow('maximum');
      if (sided)
        expect(() =>
          deriveNpcSymbiontNativeProfile(catalog.nativeSymbionts, {
            symbiontInstanceId: actorId,
            speciesKey: species.speciesKey,
            targetLevel: 1,
            learnedNodeRefs,
            binding: { kind: species.bindingPolicy },
          }),
        ).toThrow();
    }
  });
  it('keeps indefinite disease calendar anchors and metadata exact across later reads', () => {
    const scope = { targetActorId: actorId, campaignTimestampOrNull: 2707, dead: false };
    const disease = createNpcUntimedDiseaseEffect(
      catalog.nonperiodicDiseases,
      { effectInstanceId: effectId, diseaseId: 'DIS-POISONING', createdAt },
      scope,
    );
    expect(disease.familyCode).toBe('FAM-DISEASE');
    expect(disease.tags).toEqual(['DISEASE']);
    // Effects/03 DIS-POISONING and MON-076: S-2 and M-2, still a disease rather than poison.
    expect(disease.payload.modifierComponents).toEqual([
      { targetKind: 'STAT', targetCode: 'M', value: -2 },
      { targetKind: 'STAT', targetCode: 'S', value: -2 },
    ]);
    expect(disease.startsAt).toEqual({ campaignTimestamp: 2707 });
    expect(disease.tickSchedule).toBeNull();
    expect(
      validateNpcUntimedDiseaseEffect(catalog.nonperiodicDiseases, disease, {
        ...scope,
        campaignTimestampOrNull: 3000,
      }),
    ).toEqual(disease);
    expect(() =>
      validateNpcUntimedDiseaseEffect(
        catalog.nonperiodicDiseases,
        { ...disease, familyCode: 'FAM-POISON' },
        scope,
      ),
    ).toThrow();
    expect(() =>
      validateNpcUntimedDiseaseEffect(catalog.nonperiodicDiseases, disease, {
        ...scope,
        targetActorId: effectId,
      }),
    ).toThrow();
    expect(() =>
      validateNpcUntimedDiseaseEffects(
        catalog.nonperiodicDiseases,
        [disease, { ...disease, effectInstanceId: actorId }],
        scope,
      ),
    ).toThrow('duplicate active disease');
    expect(() =>
      validateNpcUntimedDiseaseEffects(catalog.nonperiodicDiseases, [disease], {
        ...scope,
        dead: true,
      }),
    ).toThrow('corpse');
  });
  it('binds disease consciousness to the same real host-issued disease catalog', () => {
    const scope = { targetActorId: actorId, campaignTimestampOrNull: 2707, dead: false };
    const disease = createNpcUntimedDiseaseEffect(
      catalog.nonperiodicDiseases,
      { effectInstanceId: effectId, diseaseId: 'DIS-RHINITIS', createdAt },
      scope,
    );
    const candidate = {
      effects: [disease],
      effectiveStats: { S: 10, D: 10, M: -2, Z: 2, I: 10, W: 10, C: 10 },
      scope,
      histories: [],
    };
    expect(
      evaluateNpcDiseaseUnconsciousness(catalog.diseaseUnconsciousness, candidate).triggers,
    ).toEqual([
      {
        effectInstanceId: effectId,
        diseaseId: 'DIS-RHINITIS',
        stat: 'M',
        effectiveStat: -2,
        effectiveZ: 2,
        sum: 0,
      },
    ]);
    expect(
      evaluateNpcDiseaseUnconsciousness(catalog.diseaseUnconsciousness, {
        ...candidate,
        effectiveStats: { ...candidate.effectiveStats, M: -1 },
      }).triggers,
    ).toEqual([]);
    expect(() =>
      evaluateNpcDiseaseUnconsciousness(catalog.diseaseUnconsciousness, {
        ...candidate,
        effects: [{ ...disease, targetActorId: effectId }],
      }),
    ).toThrow();
  });
  it('loads the base life component without turning it into an active runtime effect', () => {
    const anchor = {
      kind: 'GM_FORMAL_INITIAL_SEVERE_WOUND',
      campaignId: '00000000-0000-4000-8000-000000000003',
      targetActorId: actorId,
      preparationFactId: effectId,
      reason: 'Подтверждённое исходное тяжёлое ранение',
      startsAt: { campaignTimestamp: 2707 },
      rollFact: {
        factId: '00000000-0000-4000-8000-000000000004',
        sourceRuleId: 'CORE-153',
        roll: { dieSides: 6, rawFace: 3 },
      },
    };
    const saved = prepareNpcBasePeaceDeathTimer(catalog.baseLifeState, anchor);
    expect(saved).toMatchObject({
      kind: 'BASE_PEACE_DEATH_TIMER_CONTRIBUTION_ONLY',
      baseDurationMinutes: 15,
      baseExpiresAt: { campaignTimestamp: 2722 },
    });
    expect(Object.hasOwn(saved, 'effectInstanceId')).toBe(false);
    expect(validateNpcSavedBasePeaceDeathTimer(catalog.baseLifeState, saved, anchor)).toEqual(
      saved,
    );
    expect(() =>
      validateNpcSavedBasePeaceDeathTimer(catalog.baseLifeState, saved, {
        ...anchor,
        startsAt: { campaignTimestamp: 2800 },
      }),
    ).toThrow('immutable timer anchor');
  });
  it('does not fabricate initial time, immediate ticks or an alcohol first-tick decision', () => {
    const emptyScope = { targetActorId: actorId, campaignTimestampOrNull: null, dead: false };
    expect(validateNpcUntimedDiseaseEffects(catalog.nonperiodicDiseases, [], emptyScope)).toEqual(
      [],
    );
    expect(() =>
      createNpcUntimedDiseaseEffect(
        catalog.nonperiodicDiseases,
        { effectInstanceId: effectId, diseaseId: 'DIS-RHINITIS', createdAt },
        emptyScope,
      ),
    ).toThrow('confirmed campaign time');
    const pneumonia = createNpcPneumoniaEffect(
      catalog.diseaseEffects,
      { effectInstanceId: effectId, createdAt },
      { ...emptyScope, campaignTimestampOrNull: 2707 },
    );
    expect(pneumonia.payload.dailyTick?.nextTickAt).toEqual({ campaignTimestamp: 4147 });
    expect(
      prepareNewNpcAlcoholParameters(catalog.initialEffects, {
        kind: 'ALCOHOL',
        effectiveZ: 30,
        assignment: { kind: 'NEW_FORMAL_ASSIGNMENT' },
      }),
    ).toMatchObject({ kind: 'NO_EFFECT' });
    expect(
      prepareNewNpcAlcoholParameters(catalog.initialEffects, {
        kind: 'ALCOHOL',
        effectiveZ: 20,
        assignment: { kind: 'NEW_FORMAL_ASSIGNMENT', campaignTimestamp: 2707 },
      }),
    ).toMatchObject({
      kind: 'PARAMETERS_REQUIRE_SCHEDULE',
      blocker: 'FIRST_TICK_ANCHOR_NOT_YET_PROVEN',
    });
  });
});
