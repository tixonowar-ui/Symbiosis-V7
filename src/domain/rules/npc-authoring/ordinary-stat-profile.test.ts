import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import {
  createNpcOrdinaryStatCatalog,
  deriveNpcOrdinaryStatContext,
  deriveNpcOrdinaryDraftStatContext,
  deriveNpcOrdinaryEquippedStats,
  applyNpcEffectiveStatLimits,
  type NpcOrdinaryStatCatalog,
} from './ordinary-stat-profile.js';
import type {
  NpcCompositionConsequenceProof,
  NpcCompositionResolution,
} from './composition-consequence-types.js';
import type { NpcOrdinaryCompositionFact } from './ordinary-composition-types.js';
import type { NpcSymbiontInput } from './types.js';
import type { StatBlock } from '../skill-stage/stats.js';
import {
  assertNpcOrdinarySkillContexts,
  evaluateNpcOrdinaryHumanoidProof,
  evaluateNpcOrdinaryAuthoringProof,
} from './ordinary-humanoid-proof.js';
import { evaluateNpcCompositionConsequences } from './composition-consequences.js';
import { npcKensiRequest } from '../../../../tests/fixtures/npc-published-inventory.js';
import type { NpcInventoryRequestEntry } from './inventory.js';
import { previewNpcOrdinarySkills } from './npc-ordinary-humanoid-sheet.js';

let source: NpcAuthoringSourceCatalog;
let catalog: NpcOrdinaryStatCatalog;
beforeAll(async () => {
  source = await loadNpcAuthoringSourceCatalog(
    fileURLToPath(new URL('../../../../', import.meta.url)),
  );
  const rules: unknown = JSON.parse(
    await readFile(new URL('../../../../generated/spec/rules/rules.json', import.meta.url), 'utf8'),
  );
  catalog = createNpcOrdinaryStatCatalog(
    {
      baseStats: source.baseStats,
      symbionts: source.symbionts,
      compositionConsequences: source.compositionConsequences,
      initialMonsters: source.initialMonsters,
      equipment: { inventory: source.inventory, publication: source.inventoryPublication },
    },
    rules,
  );
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base: StatBlock = { S: 20, D: 20, M: 20, Z: 20, I: 15, W: 15, C: 15 };
const schema = {
  raceCode: 'UNITED' as const,
  pureClassOrNull: null,
  anatomyProfileId: 'STANDARD_HUMANOID',
  sex: 'MALE' as const,
  massKg: 75,
};
function specimen(speciesKey: string, identity: number, targetLevel = 1): NpcSymbiontInput {
  const species = source.symbionts.species.find((s) => s.speciesKey === speciesKey);
  if (species === undefined) throw new Error('Missing source species');
  const kind = species.bindingPolicy;
  return {
    symbiontInstanceId: id(identity),
    speciesKey: species.speciesKey,
    targetLevel,
    learnedNodeRefs: source.development.nodes
      .filter((n) => n.speciesKey === speciesKey && n.level <= targetLevel)
      .map((n) => n.nodeRef),
    binding: kind === 'OWL_EYE' || kind === 'EEL_ARM' ? { kind, side: 'LEFT' } : { kind },
    currentOE: 0,
  };
}
function fact(
  ordinal: number,
  changes: Partial<NpcOrdinaryCompositionFact>,
): NpcOrdinaryCompositionFact {
  return {
    kind: 'APPLY_COMPOSITION_EDIT',
    factId: id(100 + ordinal),
    journalId: id(2),
    ordinal,
    raceCode: 'UNITED',
    additions: [],
    removals: [],
    buildChanges: [],
    currentOeChanges: [],
    ...changes,
  };
}
function proof(
  facts: readonly NpcOrdinaryCompositionFact[],
  resolutions: readonly NpcCompositionResolution[] = [],
): NpcCompositionConsequenceProof {
  return {
    identityKey: id(1),
    binding: { journalId: id(2), raceCode: 'UNITED' },
    confirmations: facts.map((input) => ({
      input,
      confirmationCommandId: id(200 + input.ordinal),
      diceModeSnapshot: 'MANUAL',
    })),
    resolutions,
  };
}
const profile = (compositionProof: NpcCompositionConsequenceProof, baseStats = base) =>
  deriveNpcOrdinaryStatContext(catalog, { schema, baseStats, compositionProof });
const nate = (): NpcInventoryRequestEntry => ({
  ...npcKensiRequest(id(900)),
  itemTypeId: 'ITM-ARM-005',
  currentAmmo: null,
  bodyZone: null,
  profile: { kind: 'CATALOG' },
  equipped: true,
  equippedSlots: ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'],
  sealed: true,
});
function close(
  ordinal: number,
  compositionOrdinal: number,
  instance: number,
  beforeRemovalOrNull: Extract<
    NpcCompositionResolution,
    { kind: 'TROGR_PERMANENT_STAT_CLOSURE' }
  >['beforeRemovalOrNull'] = null,
): NpcCompositionResolution {
  return {
    kind: 'TROGR_PERMANENT_STAT_CLOSURE',
    factId: id(300 + ordinal),
    ordinal,
    compositionOrdinal,
    causedByFactId: id(100 + compositionOrdinal),
    symbiontInstanceId: id(instance),
    beforeRemovalOrNull,
  };
}

describe('source-backed ordinary permanent stat composition', () => {
  it('applies new Teacher/Dolphin caps after retained signed Trogr legacy, preserving its original snapshot', () => {
    const first = fact(1, { additions: [specimen('TROGR', 10)] });
    const firstClosure = close(1, 1, 10);
    const original = profile(proof([first], [firstClosure]));
    const removed = fact(2, { removals: [id(10)] });
    const closure = close(2, 2, 10, {
      statContextFactId: id(500),
      nonTrogrBasis: original.nonTrogrBasis,
      permanentStats: original.stats.permanentStats,
    });
    const retained = profile(proof([first, removed], [firstClosure, closure]));
    const bytes = JSON.stringify(retained.composition.lifetimeFacts);
    for (const [key, level, stat, expected] of [
      ['TEACHER', 5, 'W', 20],
      ['DOLPHIN', 6, 'I', 30],
    ] as const) {
      const next = fact(3, { additions: [specimen(key, 11, level)] });
      const result = profile(proof([first, removed, next], [firstClosure, closure]));
      // SYM-076 contributes −6; Teacher W=min(15+20−6,20), Dolphin I=min(15+30−6,30).
      expect(result.stats.permanentStats[stat]).toBe(expected);
      expect(result.composition.lifetimeFacts).toEqual(retained.composition.lifetimeFacts);
      expect(JSON.stringify(retained.composition.lifetimeFacts)).toBe(bytes);
      const raw = { ...result.stats.permanentStats, [stat]: expected + 5 };
      expect(applyNpcEffectiveStatLimits(result.effectiveLimits, raw)[stat]).toBe(expected);
      expect(() =>
        applyNpcEffectiveStatLimits(structuredClone(result.effectiveLimits), raw),
      ).toThrow('issued');
    }
  });
  it('keeps each initial monster passive distinct from the UNITED manual race basis', () => {
    // CORE-001 manual UNITED: S−7, M−10, Z−10. MON-002/025/040 add only their own profiles.
    const expected = {
      CHIMERA: { S: 18, D: 20, M: 20, Z: 10, I: 15, W: 15, C: 15 },
      PUPPETEER: { S: 13, D: 20, M: 10, Z: 10, I: 15, W: 15, C: 25 },
      PLAGUE_DOCTOR: { S: 8, D: 15, M: 5, Z: 10, I: 25, W: 15, C: 15 },
    };
    for (const [key, stats] of Object.entries(expected)) {
      const input = specimen(key, 80);
      const derived = profile(proof([fact(1, { additions: [input] })]));
      expect(derived.stats.permanentStats).toEqual(stats);
      expect(derived.stats.effectiveStats).toEqual(stats);
      expect(derived.symbionts[0]).toMatchObject({ ...input, computedMaxOE: 400, slotCost: 4 });
      expect(derived.composition.composition.kind).toBe(
        'INITIAL_MONSTER_STRUCTURAL_COMPOSITION_ONLY',
      );
      expect(derived.composition.lifetimeFacts).not.toHaveProperty('trogrStrengthAndLegacyOrNull');
    }
  });
  it('retains actual Trogr legacy through an ordinary to monster to ordinary history', () => {
    const first = fact(1, { additions: [specimen('TROGR', 10)] });
    const firstClosure = close(1, 1, 10);
    const original = profile(proof([first], [firstClosure]));
    const replaced = fact(2, { removals: [id(10)], additions: [specimen('CHIMERA', 11)] });
    const removedClosure = close(2, 2, 10, {
      statContextFactId: id(500),
      nonTrogrBasis: original.nonTrogrBasis,
      permanentStats: original.stats.permanentStats,
    });
    const monster = profile(proof([first, replaced], [firstClosure, removedClosure]));
    // SYM-076 / AQ2-022: actual capped contribution S+6,D+5,M+6,Z+6,I−6,W−6,C−6.
    // The new MON-002 profile adds S5,M10; Trogr's live caps no longer apply.
    expect(monster.stats.permanentStats).toEqual({
      S: 24,
      D: 25,
      M: 26,
      Z: 16,
      I: 9,
      W: 9,
      C: 9,
    });
    const restored = fact(3, { removals: [id(11)], additions: [specimen('ARMADILLO', 12)] });
    const ordinary = profile(proof([first, replaced, restored], [firstClosure, removedClosure]));
    expect(ordinary.composition.lifetimeFacts).toEqual(monster.composition.lifetimeFacts);
    expect(ordinary.stats.permanentStats).toEqual({
      S: 19,
      D: 25,
      M: 16,
      Z: 16,
      I: 9,
      W: 9,
      C: 9,
    });
    expect(
      ordinary.composition.composition.instances.map((i) => [i.symbiontInstanceId, i.status]),
    ).toEqual([
      [id(10), 'REMOVED'],
      [id(11), 'REMOVED'],
      [id(12), 'ACTIVE'],
    ]);
  });
  it('uses each actual ordinary L1 profile, without XP or synthetic learned-node grants', () => {
    for (const species of source.symbionts.species.filter((s) => s.kind === 'ORDINARY')) {
      const input = specimen(species.speciesKey, 10);
      const result = profile(proof([fact(1, { additions: [input] })]));
      expect(result.symbionts[0]).toMatchObject(input);
      expect(result.stats.baseStats).toEqual(base);
      expect(result.symbionts[0]?.computedMaxOE).toBe(species.initialCurrentOe);
    }
  });
  it('derives the published UNITED DOLPHIN L6 example and preserves the independent W basis', () => {
    const result = profile(proof([fact(1, { additions: [specimen('DOLPHIN', 10, 6)] })]), {
      S: 20,
      D: 20,
      M: 20,
      Z: 20,
      I: 20,
      W: 20,
      C: 20,
    });
    expect(result.stats.skillStageStats).toEqual({
      S: 13,
      D: 20,
      M: 10,
      Z: 10,
      I: 20,
      W: 20,
      C: 20,
    });
    expect(result.stats.permanentStats).toEqual({
      S: 13,
      D: 20,
      M: 10,
      Z: 10,
      I: 30,
      W: 20,
      C: 20,
    });
    expect(result.symbionts[0]?.learnedNodeRefs).toContain('SYM-166');
  });
  it('ADR0082 snapshots the actual capped contribution and applies only newly reached raw strength', () => {
    const first = fact(1, { additions: [specimen('TROGR', 10)] });
    const firstClosure = close(1, 1, 10);
    const original = profile(proof([first], [firstClosure]));
    expect(original.nonTrogrBasis.D).toBe(20);
    expect(original.stats.permanentStats.D).toBe(25);
    const removal = fact(2, { removals: [id(10)] });
    const removedClosure = close(2, 2, 10, {
      statContextFactId: id(500),
      nonTrogrBasis: original.nonTrogrBasis,
      permanentStats: original.stats.permanentStats,
    });
    const changedBasis = { ...base, D: 10 };
    const removed = profile(proof([first, removal], [firstClosure, removedClosure]), changedBasis);
    expect(removed.stats.permanentStats.D).toBe(15);
    expect(
      removed.composition.lifetimeFacts.trogrStrengthAndLegacyOrNull?.legacyOrNull?.signedSnapshot
        .D,
    ).toBe(5);
    const reacquire = fact(3, { additions: [specimen('TROGR', 11)] });
    const reacquireClosure = close(3, 3, 11);
    expect(
      profile(
        proof([first, removal, reacquire], [firstClosure, removedClosure, reacquireClosure]),
        changedBasis,
      ).stats.permanentStats.D,
    ).toBe(15);
    const nextBuild = specimen('TROGR', 11, 2);
    const grow = fact(4, {
      buildChanges: [
        {
          symbiontInstanceId: id(11),
          targetLevel: 2,
          learnedNodeRefs: nextBuild.learnedNodeRefs,
          binding: nextBuild.binding,
        },
      ],
    });
    const growClosure = close(4, 4, 11);
    const increased = profile(
      proof(
        [first, removal, reacquire, grow],
        [firstClosure, removedClosure, reacquireClosure, growClosure],
      ),
      changedBasis,
    );
    expect(increased.stats.permanentStats.D).toBe(21);
    const lowered = specimen('TROGR', 11, 1);
    const lower = fact(5, {
      buildChanges: [
        {
          symbiontInstanceId: id(11),
          targetLevel: 1,
          learnedNodeRefs: lowered.learnedNodeRefs,
          binding: lowered.binding,
        },
      ],
    });
    const result = profile(
      proof(
        [first, removal, reacquire, grow, lower],
        [firstClosure, removedClosure, reacquireClosure, growClosure, close(5, 5, 11)],
      ),
      changedBasis,
    );
    expect(result.stats.permanentStats.D).toBe(21);
    expect(result.symbionts[0]?.targetLevel).toBe(1);
    expect(result.composition.lifetimeFacts.trogrStrengthAndLegacyOrNull).toMatchObject({
      reachedLevel: 2,
      includedLevel: 1,
    });
  });
  it('a later absorbed Teacher replaces the actual negative snapshot rather than keeping abs/max', () => {
    const first = fact(1, { additions: [specimen('TROGR', 10, 3)] });
    const c1 = close(1, 1, 10);
    const original = profile(proof([first], [c1]));
    expect(original.stats.permanentStats.I).toBe(1);
    const removed = fact(2, { removals: [id(10)] });
    const c2 = close(2, 2, 10, {
      statContextFactId: id(500),
      nonTrogrBasis: original.nonTrogrBasis,
      permanentStats: original.stats.permanentStats,
    });
    const next = fact(3, { additions: [specimen('TROGR', 11, 3), specimen('TEACHER', 12)] });
    const c3 = close(3, 3, 11);
    const absorbed = profile(proof([first, removed, next], [c1, c2, c3]));
    expect(absorbed.stats.permanentStats.I).toBe(4);
    expect(
      absorbed.composition.composition.instances.find((i) => i.symbiontInstanceId === id(12))
        ?.status,
    ).toBe('ABSORBED');
    const removeAgain = fact(4, { removals: [id(11)] });
    const c4 = close(4, 4, 11, {
      statContextFactId: id(501),
      nonTrogrBasis: absorbed.nonTrogrBasis,
      permanentStats: absorbed.stats.permanentStats,
    });
    const result = profile(proof([first, removed, next, removeAgain], [c1, c2, c3, c4]));
    expect(
      result.composition.lifetimeFacts.trogrStrengthAndLegacyOrNull?.legacyOrNull?.signedSnapshot.I,
    ).toBe(-11);
    expect(result.stats.permanentStats.I).toBe(4);
  });
  it('does not treat a current Teacher as absorbed or forge a legacy before actual removal', () => {
    const teacher = profile(proof([fact(1, { additions: [specimen('TEACHER', 10)] })]));
    expect(teacher.composition.lifetimeFacts.trogrStrengthAndLegacyOrNull).toBeUndefined();
    const first = fact(1, { additions: [specimen('TROGR', 10)] });
    expect(() =>
      profile(
        proof(
          [first],
          [
            close(1, 1, 10, {
              statContextFactId: id(500),
              nonTrogrBasis: base,
              permanentStats: base,
            }),
          ],
        ),
      ),
    ).toThrow('cannot invent removal');
    expect(() =>
      deriveNpcOrdinaryStatContext(
        { kind: 'SOURCE_BOUND_NPC_ORDINARY_STATS' },
        { schema, baseStats: base, compositionProof: proof([]) },
      ),
    ).toThrow('issued source catalog');
  });
});

it('recomputes the actual conditional Skunk modifier before Trogr minima for equipped Nate', () => {
  const compositionProof = proof(
    [fact(1, { additions: [specimen('TROGR', 10), specimen('SKUNK', 11)] })],
    [close(1, 1, 10)],
  );
  const baseStats = { ...base, C: 10 };
  expect(profile(compositionProof, baseStats).stats.permanentStats.C).toBe(1);
  expect(
    deriveNpcOrdinaryEquippedStats(
      catalog,
      { schema, baseStats, compositionProof },
      { equippedHermeticNate: true },
    ).C,
  ).toBe(4);
  expect(
    deriveNpcOrdinaryEquippedStats(
      catalog,
      { schema, baseStats, compositionProof },
      { equippedHermeticNate: false },
    ).C,
  ).toBe(1);
  const lone = proof([fact(1, { additions: [specimen('SKUNK', 12)] })]);
  expect(() => profile(lone, { ...base, C: 8 })).toThrow('CORE-164');
  expect(
    deriveNpcOrdinaryEquippedStats(
      catalog,
      { schema, baseStats: { ...base, C: 8 }, compositionProof: lone },
      { equippedHermeticNate: true },
    ).C,
  ).toBe(8);
  expect(() =>
    deriveNpcOrdinaryEquippedStats(catalog, { schema, baseStats, compositionProof }, {
      equippedHermeticNate: true,
      unknown: true,
    } as { equippedHermeticNate: boolean }),
  ).toThrow();
});

describe('source-bound historical Nate condition and incomplete NPC drafts', () => {
  function input(baseC: number) {
    const compositionProof = proof([fact(1, { additions: [specimen('SKUNK', 12)] })]);
    const row = {
      contextFactId: id(901),
      schema,
      baseStats: { ...base, C: baseC },
      compositionOrdinal: 1,
      resolutionOrdinal: 0,
    };
    return { compositionProof, row };
  }
  it('retains an invalid draft without flooring it, while the existing strict entry points refuse it', () => {
    const { compositionProof, row } = input(8);
    const request = { schema, baseStats: row.baseStats, compositionProof };
    const draft = deriveNpcOrdinaryDraftStatContext(catalog, request);
    expect(draft.stats.permanentStats.C).toBe(-2);
    expect(draft.invalidPermanentStats).toEqual(['C']);
    expect(() => deriveNpcOrdinaryStatContext(catalog, request)).toThrow('CORE-164 permanent C');
    const evidence = {
      npcUuid: id(1),
      compositionProof,
      ordinaryProof: { currentStatContextFactId: row.contextFactId, statContexts: [row] },
    };
    expect(
      evaluateNpcOrdinaryAuthoringProof(catalog, evidence).current.invalidPermanentStats,
    ).toEqual(['C']);
    expect(() => evaluateNpcOrdinaryHumanoidProof(catalog, evidence)).toThrow(
      'CORE-164 permanent C',
    );
  });
  it('requires actual source-validated sealed equipped Nate to make the conditional permanent value valid', () => {
    const { compositionProof, row } = input(8);
    const request = {
      schema,
      baseStats: row.baseStats,
      compositionProof,
      equippedInventory: [nate()],
    };
    const result = deriveNpcOrdinaryStatContext(catalog, request);
    expect(result.stats.permanentStats.C).toBe(8);
    expect(result.invalidPermanentStats).toEqual([]);
    for (const item of [
      { ...nate(), sealed: false },
      { ...nate(), equipped: false, equippedSlots: [] },
    ])
      expect(() =>
        deriveNpcOrdinaryStatContext(catalog, { ...request, equippedInventory: [item] }),
      ).toThrow('CORE-164 permanent C');
    expect(() =>
      deriveNpcOrdinaryStatContext(catalog, {
        ...request,
        equippedInventory: [{ ...nate(), itemTypeId: 'unknown' }],
      }),
    ).toThrow();
    expect(() =>
      deriveNpcOrdinaryStatContext(catalog, { ...request, equippedHermeticNate: true }),
    ).toThrow();
  });
  it('keeps every historical loadout and does not apply current Nate to earlier skill or stat facts', () => {
    const { compositionProof, row } = input(15);
    const old = {
      npcUuid: id(1),
      compositionProof,
      ordinaryProof: { currentStatContextFactId: row.contextFactId, statContexts: [row] },
    };
    const next = { ...row, contextFactId: id(902), equippedInventory: [nate()] };
    const result = evaluateNpcOrdinaryHumanoidProof(
      catalog,
      {
        ...old,
        ordinaryProof: { currentStatContextFactId: next.contextFactId, statContexts: [row, next] },
      },
      old,
    );
    expect(result.contexts.map((c) => c.profile.stats.permanentStats.C)).toEqual([5, 15]);
    expect(Object.hasOwn(result.ordinaryProof.statContexts[0]!, 'equippedInventory')).toBe(false);
    expect(result.ordinaryProof.statContexts[1]?.equippedInventory).toEqual([nate()]);
    expect(() =>
      evaluateNpcOrdinaryHumanoidProof(
        catalog,
        {
          ...old,
          ordinaryProof: {
            currentStatContextFactId: next.contextFactId,
            statContexts: [{ ...row, equippedInventory: [nate()] }, next],
          },
        },
        old,
      ),
    ).toThrow();
    expect(
      evaluateNpcOrdinaryHumanoidProof(
        catalog,
        JSON.parse(JSON.stringify({ ...old, ordinaryProof: result.ordinaryProof })),
      ),
    ).toEqual(result);
  });
  it('keeps actual historical armor mobility in the effective skill layer exactly once', () => {
    const { compositionProof, row } = input(15);
    const pieces = ['TORSO', 'HEAD', 'ARM_L'].map((zone, index): NpcInventoryRequestEntry => ({
      ...nate(),
      itemInstanceId: id(910 + index),
      itemTypeId: 'ITM-ARM-002',
      bodyZone: zone as NpcInventoryRequestEntry['bodyZone'],
      equippedSlots: [zone],
      sealed: null,
    }));
    const next = { ...row, contextFactId: id(902), equippedInventory: pieces };
    const result = evaluateNpcOrdinaryHumanoidProof(catalog, {
      npcUuid: id(1),
      compositionProof,
      ordinaryProof: { currentStatContextFactId: next.contextFactId, statContexts: [row, next] },
    });
    // CORE-001 manual UNITED: base M20 −10; CORE-050 applies M−3 above two brigantine pieces.
    expect(result.contexts.map((c) => c.profile.stats.permanentStats.M)).toEqual([10, 10]);
    expect(result.contexts.map((c) => c.profile.stats.effectiveStats.M)).toEqual([10, 7]);
    const skill = {
      contextFactId: next.contextFactId,
      ordinal: 1,
      stage: 'START_SELECTION' as const,
      raceCode: 'UNITED' as const,
      classCode: null,
      skillStageStats: result.current.stats.skillStageStats,
      permanentStats: result.current.stats.permanentStats,
      effectiveStats: result.current.stats.effectiveStats,
      grossGrantSourceOrNull: null,
      facts: [],
    };
    expect(() =>
      assertNpcOrdinarySkillContexts(result, { identityKey: id(1), contexts: [skill] }),
    ).not.toThrow();
    expect(() =>
      assertNpcOrdinarySkillContexts(result, {
        identityKey: id(1),
        contexts: [{ ...skill, effectiveStats: skill.permanentStats }],
      }),
    ).toThrow();
  });
  it('retains raw temporary armor below one and uses CORE-078 computational M without changing permanent M', () => {
    const { compositionProof, row } = input(15);
    const pieces = ['TORSO', 'HEAD', 'ARM_L'].map((zone, index): NpcInventoryRequestEntry => ({
      ...nate(),
      itemInstanceId: id(920 + index),
      itemTypeId: 'ITM-ARM-002',
      bodyZone: zone as NpcInventoryRequestEntry['bodyZone'],
      equippedSlots: [zone],
      sealed: null,
    }));
    const result = deriveNpcOrdinaryStatContext(catalog, {
      schema,
      baseStats: { ...row.baseStats, M: 11 }, // CORE-001: requested permanent M1.
      compositionProof,
      equippedInventory: pieces,
    });
    expect(result.stats.permanentStats.M).toBe(1);
    expect(result.rawEquippedStats.M).toBe(-2);
    expect(result.stats.effectiveStats.M).toBe(1);
    expect(result.invalidPermanentStats).toEqual([]);
  });
  it('allows a later valid inventory context without turning the earlier invalid draft into skill evidence', () => {
    const { compositionProof, row } = input(8),
      next = { ...row, contextFactId: id(902), equippedInventory: [nate()] };
    const result = evaluateNpcOrdinaryHumanoidProof(catalog, {
      npcUuid: id(1),
      compositionProof,
      ordinaryProof: { currentStatContextFactId: next.contextFactId, statContexts: [row, next] },
    });
    expect(result.contexts.map((c) => c.profile.stats.permanentStats.C)).toEqual([-2, 8]);
    expect(() =>
      assertNpcOrdinarySkillContexts(result, {
        identityKey: id(1),
        contexts: [
          {
            contextFactId: row.contextFactId,
            ordinal: 1,
            stage: 'START_SELECTION',
            raceCode: 'UNITED',
            classCode: null,
            skillStageStats: result.contexts[0]!.profile.stats.skillStageStats,
            permanentStats: result.contexts[0]!.profile.stats.permanentStats,
            effectiveStats: result.contexts[0]!.profile.stats.effectiveStats,
            grossGrantSourceOrNull: null,
            facts: [],
          },
        ],
      }),
    ).toThrow('CORE-164 permanent C');
  });
  it('previews actual skills only after a valid current gear context and leaves the invalid draft unused', () => {
    const { compositionProof, row: original } = input(8);
    const row = { ...original, baseStats: { ...original.baseStats, W: 2 } };
    const next = { ...row, contextFactId: id(902), equippedInventory: [nate()] };
    const request = {
      npcUuid: id(1),
      compositionProof,
      ordinaryProof: { currentStatContextFactId: next.contextFactId, statContexts: [row, next] },
      selections: [{ skillKey: 'STEALTH', targetBonus: 1, pool: 'START' }],
      previousSkillProofOrNull: null,
    };
    expect(previewNpcOrdinarySkills(source.ordinaryHumanoid, request)).toMatchObject({
      kind: 'UNCOMMITTED',
      used: 1,
      permanentLosses: [],
      disabledSkillKeys: [],
      pendingCharges: [
        { skillKey: 'STEALTH', pool: 'START', bonusBefore: 0, bonusAfter: 1, slotCost: 1 },
      ],
    });
    expect(() =>
      previewNpcOrdinarySkills(source.ordinaryHumanoid, {
        ...request,
        ordinaryProof: { currentStatContextFactId: row.contextFactId, statContexts: [row] },
      }),
    ).toThrow('CORE-164 permanent C');
  });
});

describe('owner decision #234: newly acquired Trogr destroyed in the same confirmation', () => {
  const keeper = (identity: number) => ({ ...specimen('KEEPER', identity), currentOE: 10 });
  function gross(
    ordinal: number,
    compositionOrdinal: number,
    instance: number,
  ): Extract<NpcCompositionResolution, { kind: 'GROSS_SKILL_GRANT' }> {
    return {
      kind: 'GROSS_SKILL_GRANT',
      factId: id(300 + ordinal),
      ordinal,
      compositionOrdinal,
      causedByFactId: id(100 + compositionOrdinal),
      symbiontInstanceId: id(instance),
      initialGrant: {
        kind: 'TROGR_GROSS_GRANT',
        sourceRuleId: 'SYM-079',
        factId: id(700 + ordinal),
        ordinal: 1,
        contextFactId: id(600 + ordinal),
        symbiontAcquisitionFactId: id(100 + compositionOrdinal),
        bonusBefore: 0,
        bonusAfter: 3,
      },
    };
  }
  it('creates no stat ledger or fake pre-death context without a prior active specimen', () => {
    const input = proof(
      [fact(1, { additions: [specimen('TROGR', 10), keeper(11)] })],
      [close(1, 1, 10)],
    );
    const result = profile(input);
    expect(Object.hasOwn(result.composition.lifetimeFacts, 'trogrStrengthAndLegacyOrNull')).toBe(
      false,
    );
    expect(result.stats.permanentStats).toEqual(result.stats.skillStageStats);
    expect(result.composition.obligationStatus).toBe('RESOLVED');
    expect(result.symbionts.map((i) => i.symbiontInstanceId)).toEqual([id(11)]);
    expect(result.composition.compositionReceipts[0]?.consequences).toContainEqual({
      kind: 'CURRENT_OE_DUEL',
      trogrInstanceId: id(10),
      keeperInstanceId: id(11),
      trogrCurrentOeBefore: 0,
      keeperCurrentOeBefore: 10,
      outcome: 'TROGR_DESTROYED',
      winnerCurrentOeAfterOrNull: 10,
    });
    const restored: unknown = JSON.parse(JSON.stringify(input));
    expect(
      deriveNpcOrdinaryStatContext(catalog, {
        schema,
        baseStats: base,
        compositionProof: restored,
      }),
    ).toEqual(result);
  });
  it('retains absorption, forced level and the independent one-time GROSS grant without advancing stat strength', () => {
    const grant = gross(2, 1, 10);
    const input = proof(
      [fact(1, { additions: [specimen('TROGR', 10), specimen('DOLPHIN', 11), keeper(12)] })],
      [close(1, 1, 10), grant],
    );
    const result = profile(input);
    expect(
      result.composition.composition.instances.find((i) => i.symbiontInstanceId === id(10)),
    ).toMatchObject({
      status: 'DESTROYED',
      targetLevel: 5,
      learnedNodeRefs: expect.arrayContaining(['SYM-079']) as unknown,
    });
    expect(
      result.composition.composition.instances.find((i) => i.symbiontInstanceId === id(11)),
    ).toMatchObject({ status: 'ABSORBED' });
    expect(result.composition.lifetimeFacts.absorptionFacts).toHaveLength(1);
    expect(Object.hasOwn(result.composition.lifetimeFacts, 'trogrStrengthAndLegacyOrNull')).toBe(
      false,
    );
    expect(result.composition.lifetimeFacts.grossGrant).toMatchObject({
      kind: 'ISSUED',
      bonusBefore: 0,
      bonusAfter: 3,
      acquisitionFactId: id(702),
    });
    expect(result.composition.obligationStatus).toBe('RESOLVED');
    expect(
      evaluateNpcCompositionConsequences(source.compositionConsequences, input, input),
    ).toEqual(result.composition);
    expect(() =>
      profile({ ...input, resolutions: [...input.resolutions, gross(3, 1, 10)] }),
    ).toThrow();
  });
  it('preserves a prior signed ledger when a new Trogr dies without a Dolphin', () => {
    const first = fact(1, { additions: [specimen('TROGR', 10)] });
    const c1 = close(1, 1, 10);
    const original = profile(proof([first], [c1]));
    const removal = fact(2, { removals: [id(10)] });
    const c2 = close(2, 2, 10, {
      statContextFactId: id(500),
      nonTrogrBasis: original.nonTrogrBasis,
      permanentStats: original.stats.permanentStats,
    });
    const prior = proof([first, removal], [c1, c2]);
    const retained = profile(prior);
    const priorBytes = JSON.stringify(prior);
    const current = proof(
      [first, removal, fact(3, { additions: [specimen('TROGR', 11), keeper(12)] })],
      [c1, c2, close(3, 3, 11)],
    );
    const result = profile(current);
    expect(retained.composition.lifetimeFacts.trogrStrengthAndLegacyOrNull).toMatchObject({
      reachedLevel: 1,
      legacyOrNull: { signedSnapshot: { D: 5 } },
    });
    expect(result.composition.lifetimeFacts.trogrStrengthAndLegacyOrNull).toEqual(
      retained.composition.lifetimeFacts.trogrStrengthAndLegacyOrNull,
    );
    expect(result.stats.permanentStats).toEqual(retained.stats.permanentStats);
    expect(
      result.composition.composition.instances.find((i) => i.symbiontInstanceId === id(11)),
    ).toMatchObject({ status: 'DESTROYED', targetLevel: 1 });
    expect(result.composition.lifetimeFacts.absorptionFacts).toHaveLength(0);
    expect(
      evaluateNpcCompositionConsequences(source.compositionConsequences, current, prior),
    ).toEqual(result.composition);
    const restored: unknown = JSON.parse(JSON.stringify(current));
    expect(
      deriveNpcOrdinaryStatContext(catalog, {
        schema,
        baseStats: base,
        compositionProof: restored,
      }),
    ).toEqual(result);
    expect(JSON.stringify(prior)).toBe(priorBytes);
  });
  it('preserves a prior signed ledger exactly and a later surviving L2 does not inherit the transient L5', () => {
    const first = fact(1, { additions: [specimen('TROGR', 10)] }),
      c1 = close(1, 1, 10);
    const original = profile(proof([first], [c1]));
    const removal = fact(2, { removals: [id(10)] });
    const c2 = close(2, 2, 10, {
      statContextFactId: id(500),
      nonTrogrBasis: original.nonTrogrBasis,
      permanentStats: original.stats.permanentStats,
    });
    const prior = proof([first, removal], [c1, c2]);
    const basis = { ...base, D: 10 };
    const old = profile(prior, basis).composition.lifetimeFacts.trogrStrengthAndLegacyOrNull;
    const death = fact(3, {
      additions: [specimen('TROGR', 11), specimen('DOLPHIN', 12), keeper(13)],
    });
    const current = proof([first, removal, death], [c1, c2, close(3, 3, 11), gross(4, 3, 11)]);
    const result = profile(current, basis);
    expect(result.composition.lifetimeFacts.trogrStrengthAndLegacyOrNull).toEqual(old);
    expect(result.stats.permanentStats.D).toBe(15);
    expect(
      evaluateNpcCompositionConsequences(source.compositionConsequences, current, prior),
    ).toEqual(result.composition);
    const next = fact(4, { removals: [id(13)], additions: [specimen('TROGR', 14, 2)] });
    const surviving = profile(
      proof(
        [...current.confirmations.map((c) => c.input), next],
        [...current.resolutions, close(5, 4, 14)],
      ),
      basis,
    );
    expect(surviving.composition.lifetimeFacts.trogrStrengthAndLegacyOrNull?.reachedLevel).toBe(2);
    expect(surviving.stats.permanentStats.D).toBe(21);
  });
  it('binds GROSS to the actual destroyed acquisition without fabricating an active context', () => {
    const grant = gross(2, 1, 10);
    if (!('initialGrant' in grant)) throw Error('initial grant fixture required');
    const compositionProof = proof(
      [fact(1, { additions: [specimen('TROGR', 10, 5), keeper(11)] })],
      [close(1, 1, 10), grant],
    );
    const ordinaryProof = {
      currentStatContextFactId: grant.initialGrant.contextFactId,
      statContexts: [
        {
          contextFactId: grant.initialGrant.contextFactId,
          schema,
          baseStats: base,
          compositionOrdinal: 1,
          resolutionOrdinal: 2,
        },
      ],
    };
    const result = evaluateNpcOrdinaryHumanoidProof(catalog, {
      npcUuid: id(1),
      compositionProof,
      ordinaryProof,
    });
    const context = {
      contextFactId: grant.initialGrant.contextFactId,
      ordinal: 1,
      stage: 'COMPOSITION_BEFORE_START' as const,
      raceCode: 'UNITED' as const,
      classCode: null,
      skillStageStats: result.current.stats.skillStageStats,
      permanentStats: result.current.stats.permanentStats,
      effectiveStats: result.current.stats.effectiveStats,
      grossGrantSourceOrNull: {
        sourceRuleId: 'SYM-079' as const,
        symbiontInstanceId: id(10),
        sourceAcquisitionFactId: id(101),
      },
      facts: [grant.initialGrant],
    };
    expect(() =>
      assertNpcOrdinarySkillContexts(result, { identityKey: id(1), contexts: [context] }),
    ).not.toThrow();
    expect(() =>
      assertNpcOrdinarySkillContexts(result, {
        identityKey: id(1),
        contexts: [
          {
            ...context,
            grossGrantSourceOrNull: {
              ...context.grossGrantSourceOrNull,
              sourceAcquisitionFactId: id(999),
            },
          },
        ],
      }),
    ).toThrow('GROSS source');
    const first = fact(1, { additions: [specimen('TROGR', 10, 5)] });
    const before = profile(proof([first], [close(1, 1, 10), grant]));
    const later = fact(2, { additions: [keeper(11)] });
    const older = evaluateNpcOrdinaryHumanoidProof(catalog, {
      npcUuid: id(1),
      compositionProof: proof(
        [first, later],
        [
          close(1, 1, 10),
          grant,
          close(3, 2, 10, {
            statContextFactId: grant.initialGrant.contextFactId,
            nonTrogrBasis: before.nonTrogrBasis,
            permanentStats: before.stats.permanentStats,
          }),
        ],
      ),
      ordinaryProof: {
        currentStatContextFactId: id(999),
        statContexts: [
          ...ordinaryProof.statContexts,
          {
            ...ordinaryProof.statContexts[0],
            contextFactId: id(999),
            compositionOrdinal: 2,
            resolutionOrdinal: 3,
          },
        ],
      },
    });
    expect(() =>
      assertNpcOrdinarySkillContexts(older, {
        identityKey: id(1),
        contexts: [
          {
            ...context,
            contextFactId: id(999),
            skillStageStats: older.current.stats.skillStageStats,
            permanentStats: older.current.stats.permanentStats,
            effectiveStats: older.current.stats.effectiveStats,
          },
        ],
      }),
    ).toThrow('GROSS source');
  });
  it('refuses invented pre-death snapshots and still requires the real snapshot for an older active specimen', () => {
    const death = fact(1, { additions: [specimen('TROGR', 10), keeper(11)] });
    const invented = close(1, 1, 10, {
      statContextFactId: id(500),
      nonTrogrBasis: base,
      permanentStats: base,
    });
    expect(() => profile(proof([death], [invented]))).toThrow('cannot invent a pre-death');
    const first = fact(1, { additions: [specimen('TROGR', 10)] });
    const later = fact(2, { additions: [keeper(11)] });
    expect(() => profile(proof([first, later], [close(1, 1, 10), close(2, 2, 10)]))).toThrow();
  });
});
