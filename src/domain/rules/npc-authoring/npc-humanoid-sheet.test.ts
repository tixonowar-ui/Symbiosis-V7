import { createNpcUntimedDiseaseEffect } from './untimed-disease-effects.js';
import { createNpcPneumoniaEffect } from './periodic-disease-effects.js';
import type { NpcHumanoidInitialStateContext } from './npc-humanoid-sheet.js';
import { readFile } from 'node:fs/promises';
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
  type NpcInventoryPublicationCatalog,
  type NpcInventoryPublicationProof,
} from './inventory-publication.js';
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
describe('complete NPC_HUMANOID_V1 supported inventory branch', () => {
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
