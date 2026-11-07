import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import {
  buildNpcOrdinaryHumanoidSnapshot,
  readNpcOrdinaryHumanoidSnapshot,
  deriveNpcOrdinaryStatProfile,
  npcOrdinaryResultEffectiveLimits,
  previewNpcOrdinarySkills,
  previewNpcOrdinaryHumanoid,
  NpcOrdinarySkillReconfirmationRequiredError,
  type NpcOrdinaryHumanoidBuildInput,
} from './npc-ordinary-humanoid-sheet.js';
import { evaluateNpcSkills, type NpcSkillContext, type NpcSkillProof } from './skill-evaluation.js';
import { readNpcOrdinaryLifetimeFacts } from './composition-consequences.js';
import type { NpcCompositionConsequenceProof } from './composition-consequence-types.js';
import type { NpcOrdinaryHumanoidProof } from './ordinary-humanoid-proof.js';
import type { NpcSkillAccountingFact } from './skill-accounting.js';
import type { NpcSymbiontInput } from './types.js';
import { applyNpcEffectiveStatLimits } from './ordinary-stat-profile.js';
import { npcKensiRequest } from '../../../../tests/fixtures/npc-published-inventory.js';
import type { NpcInventoryRequestEntry } from './inventory.js';
let source: NpcAuthoringSourceCatalog;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const schema = {
  raceCode: 'UNITED' as const,
  pureClassOrNull: null,
  anatomyProfileId: 'STANDARD_HUMANOID',
  sex: 'MALE' as const,
  massKg: 75,
};
const base = { S: 20, D: 20, M: 20, Z: 20, I: 4, W: 2, C: 20 };
beforeAll(async () => {
  source = await loadNpcAuthoringSourceCatalog(
    fileURLToPath(new URL('../../../../', import.meta.url)),
  );
});
function fixture(): NpcOrdinaryHumanoidBuildInput {
  const species = source.symbionts.species.find((s) => s.speciesKey === 'DOLPHIN');
  if (species === undefined) throw Error('source Dolphin');
  const dolphin: NpcSymbiontInput = {
    symbiontInstanceId: id(10),
    speciesKey: species.speciesKey,
    targetLevel: 6,
    learnedNodeRefs: source.development.nodes
      .filter((n) => n.speciesKey === 'DOLPHIN' && n.level <= 6)
      .map((n) => n.nodeRef),
    binding: { kind: 'NONE' },
    currentOE: 0,
  };
  const compositionProof: NpcCompositionConsequenceProof = {
    identityKey: id(1),
    binding: { journalId: id(2), raceCode: 'UNITED' },
    confirmations: [
      {
        confirmationCommandId: id(21),
        diceModeSnapshot: 'MANUAL',
        input: {
          kind: 'APPLY_COMPOSITION_EDIT',
          factId: id(20),
          journalId: id(2),
          ordinal: 1,
          raceCode: 'UNITED',
          additions: [dolphin],
          removals: [],
          buildChanges: [],
          currentOeChanges: [],
        },
      },
    ],
    resolutions: [],
  };
  const ordinaryProof: NpcOrdinaryHumanoidProof = {
    currentStatContextFactId: id(31),
    statContexts: [30, 31].map((n) => ({
      contextFactId: id(n),
      schema,
      baseStats: base,
      compositionOrdinal: 1,
      resolutionOrdinal: 0,
    })),
  };
  const computed = deriveNpcOrdinaryStatProfile(source.ordinaryHumanoid, {
    npcUuid: id(1),
    compositionProof,
    ordinaryProof,
  });
  const key = (name: string) => {
    const key = source.skills.skills.find((s) => s.skillKey === name)?.skillKey;
    if (key === undefined) throw Error('source skill');
    return key;
  };
  const paid = (
    ordinal: number,
    context: number,
    name: string,
    before: number,
    after: number,
    pool: 'START' | 'SYM-166',
  ): NpcSkillAccountingFact => ({
    kind: 'PAID_ACQUISITION',
    factId: `NPC_INITIAL_SKILL/${id(40)}/${ordinal}`,
    ordinal,
    contextFactId: id(context),
    skillKey: key(name),
    bonusBefore: before,
    bonusAfter: after,
    chargedSlotCost: after - before,
    ...(pool === 'START' ? { pool } : { pool, symbiontInstanceId: id(10), nodeRef: 'SYM-166' }),
  });
  const context = (
    n: number,
    stage: 'START_SELECTION' | 'CONFIRMED',
    facts: readonly NpcSkillAccountingFact[],
  ): NpcSkillContext => ({
    contextFactId: id(n),
    ordinal: n - 29,
    stage,
    raceCode: 'UNITED',
    classCode: null,
    skillStageStats: computed.current.stats.skillStageStats,
    permanentStats: computed.current.stats.permanentStats,
    effectiveStats: computed.current.stats.effectiveStats,
    grossGrantSourceOrNull: null,
    sym166SourceOrNull: { symbiontInstanceId: id(10), nodeRef: 'SYM-166' },
    facts,
  });
  const skillProof: NpcSkillProof = {
    identityKey: id(1),
    contexts: [
      context(30, 'START_SELECTION', [paid(1, 30, 'STEALTH', 0, 1, 'START')]),
      context(31, 'CONFIRMED', [
        paid(2, 31, 'ACROBATICS', 0, 3, 'SYM-166'),
        paid(3, 31, 'STEALTH', 1, 3, 'SYM-166'),
      ]),
    ],
  };
  const skills = evaluateNpcSkills(source.skills, {
    identityKey: id(1),
    mode: 'CREATE_V1',
    previousConfirmedProofOrNull: null,
    proof: skillProof,
  });
  return {
    npcUuid: id(1),
    owningControllerId: id(3),
    compositionProof,
    ordinaryProof,
    skillProof,
    input: {
      identity: {
        ...schema,
        name: 'Обычный НПС',
        description: null,
        affiliation: 'Группа',
        campaignRole: 'Союзник',
        artAssetKeyOrNull: null,
      },
      baseStats: base,
      symbionts: [dolphin],
      skills: skills.ledger,
      lifetimeFacts: computed.current.composition.lifetimeFacts,
      inventory: [],
      initialState: {
        currentHP: 1,
        dead: false,
        currentTraumas: [],
        currentWounds: [],
        effectInstances: [],
        sourceSpecificStates: [],
        deathTimerRollFactOrNull: null,
      },
    },
  };
}

describe('ordinary full humanoid base with real source proofs', () => {
  function inventoryTail(input = fixture()) {
    const equippedInventory: NpcInventoryRequestEntry[] = (['TORSO', 'HEAD', 'ARM_L'] as const).map(
      (zone, index) => ({
        ...npcKensiRequest(id(70 + index)),
        itemTypeId: 'ITM-ARM-002',
        profile: { kind: 'CATALOG' },
        currentAmmo: null,
        bodyZone: zone,
        equipped: true,
        equippedSlots: [zone],
        sealed: null,
      }),
    );
    const fact = {
      ...input.ordinaryProof.statContexts.at(-1)!,
      contextFactId: 'NPC_CURRENT_INVENTORY/' + id(80),
      inventoryConfirmationOperationId: id(80),
      equippedInventory,
    };
    return {
      ...input,
      ordinaryProof: {
        currentStatContextFactId: fact.contextFactId,
        statContexts: [...input.ordinaryProof.statContexts, fact],
      },
    };
  }
  it('derives current NPC015 armor without rewriting paid NPC014 requirements, charges, or a later inventory-only history', () => {
    const input = fixture(),
      before = JSON.stringify(input),
      current = inventoryTail(input);
    const saved = buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, current);
    // CORE-001 UNITED M20−10; CORE-050 three brigantine pieces subtract 3 only in equipment.
    expect(saved.sheet.stats.permanentStats.M).toBe(10);
    expect(saved.sheet.stats.effectiveStats.M).toBe(7);
    expect(saved.derivation.skillProof).toEqual(input.skillProof);
    expect(saved.sheet.input.skills).toEqual(input.input.skills);
    expect(saved.derivation.skillProof.contexts.at(-1)?.effectiveStats.M).toBe(10);
    expect(
      readNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, JSON.parse(JSON.stringify(saved))),
    ).toEqual(saved);
    const nextFact = {
      ...current.ordinaryProof.statContexts.at(-1)!,
      contextFactId: 'NPC_CURRENT_INVENTORY/' + id(81),
      inventoryConfirmationOperationId: id(81),
      equippedInventory: [],
    };
    const next = buildNpcOrdinaryHumanoidSnapshot(
      source.ordinaryHumanoid,
      {
        ...current,
        ordinaryProof: {
          currentStatContextFactId: nextFact.contextFactId,
          statContexts: [...current.ordinaryProof.statContexts, nextFact],
        },
      },
      saved,
    );
    expect(next.sheet.stats.effectiveStats.M).toBe(10);
    expect(next.derivation.skillProof).toEqual(input.skillProof);
    expect(next.derivation.ordinaryProof.statContexts.slice(0, -1)).toEqual(
      saved.derivation.ordinaryProof.statContexts,
    );
    expect(JSON.stringify(input)).toBe(before);
  });
  it('rejects using the current inventory branch to change permanent inputs, rename its operation, or confirm/acquire a skill', () => {
    const current = inventoryTail(),
      fact = current.ordinaryProof.statContexts.at(-1)!;
    for (const changed of [
      { ...fact, baseStats: { ...base, W: 3 } },
      { ...fact, inventoryConfirmationOperationId: id(99) },
      { ...fact, equippedInventory: undefined },
    ])
      expect(() =>
        deriveNpcOrdinaryStatProfile(source.ordinaryHumanoid, {
          npcUuid: current.npcUuid,
          compositionProof: current.compositionProof,
          ordinaryProof: {
            ...current.ordinaryProof,
            statContexts: [...current.ordinaryProof.statContexts.slice(0, -1), changed],
          },
        }),
      ).toThrow();
    const saved = buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, current);
    const skillProof: NpcSkillProof = {
      ...current.skillProof,
      contexts: [
        ...current.skillProof.contexts,
        {
          ...current.skillProof.contexts.at(-1)!,
          contextFactId: fact.contextFactId,
          ordinal: 3,
          effectiveStats: saved.sheet.stats.effectiveStats,
          facts: [],
        },
      ],
    };
    expect(() =>
      evaluateNpcSkills(source.skills, {
        mode: 'CREATE_V1',
        identityKey: current.npcUuid,
        previousConfirmedProofOrNull: null,
        proof: skillProof,
      }),
    ).not.toThrow();
    expect(() =>
      buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, { ...current, skillProof }),
    ).toThrow('not a skill acquisition');
    const { inventoryConfirmationOperationId: marker, ...unmarked } = fact;
    expect(marker).toBe(id(80));
    expect(() =>
      buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, {
        ...current,
        ordinaryProof: {
          ...current.ordinaryProof,
          statContexts: [...current.ordinaryProof.statContexts.slice(0, -1), unmarked],
        },
      }),
    ).toThrow('current stat confirmation');
  });
  it('previews inventory-only current stats without issuing a paid skill confirmation at NPC015', () => {
    const current = inventoryTail();
    const preview = previewNpcOrdinaryHumanoid(source.ordinaryHumanoid, {
      npcUuid: current.npcUuid,
      owningControllerId: current.owningControllerId,
      compositionProof: current.compositionProof,
      ordinaryProof: current.ordinaryProof,
      previousSkillProofOrNull: current.skillProof,
      input: {
        ...current.input,
        skills: current.input.skills.learnedSkills.map((s) => ({
          skillKey: s.skillKey,
          targetBonus: s.bonus,
          pool: 'START',
        })),
      },
    });
    expect(preview.sheet.stats.effectiveStats.M).toBe(7);
    expect(preview.sheet.input.skills.pendingCharges).toEqual([]);
    expect(preview.sheet.input.skills.permanentLosses).toEqual([]);
    expect(preview.sheet.input.skills.pools['SYM-166'].used).toBe(5);
    const draft = previewNpcOrdinarySkills(source.ordinaryHumanoid, {
      npcUuid: current.npcUuid,
      compositionProof: current.compositionProof,
      ordinaryProof: current.ordinaryProof,
      previousSkillProofOrNull: current.skillProof,
      selections: current.input.skills.learnedSkills.map((s) => ({
        skillKey: s.skillKey,
        targetBonus: s.bonus,
        pool: 'START',
      })),
      currentInventory: {
        sourceOperationId: id(82),
        requests: current.ordinaryProof.statContexts.at(-1)!.equippedInventory,
      },
    });
    expect(draft.permanentLosses).toEqual([]);
    expect(draft.pendingCharges).toEqual([]);
    expect(draft.pools['SYM-166'].used).toBe(5);
  });
  it('requires a real skill reconfirmation after removing Nate restores the permanent Skunk penalty', () => {
    const original = fixture();
    const skunk: NpcSymbiontInput = {
      ...original.input.symbionts[0]!,
      speciesKey: 'SKUNK',
      targetLevel: 1,
      learnedNodeRefs: source.development.nodes
        .filter((n) => n.speciesKey === 'SKUNK' && n.level === 1)
        .map((n) => n.nodeRef),
    };
    const nate: NpcInventoryRequestEntry = {
      ...npcKensiRequest(id(70)),
      itemTypeId: 'ITM-ARM-005',
      profile: { kind: 'CATALOG' },
      currentAmmo: null,
      equipped: true,
      equippedSlots: ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'],
      bodyZone: null,
      sealed: true,
    };
    const baseStats = { ...base, I: 15 };
    const compositionProof: NpcCompositionConsequenceProof = {
      ...original.compositionProof,
      confirmations: original.compositionProof.confirmations.map((c) => ({
        ...c,
        input: { ...c.input, additions: [skunk] },
      })),
    };
    const first = {
      ...original.ordinaryProof.statContexts[0]!,
      baseStats,
      equippedInventory: [nate],
    };
    const ordinaryProof = { currentStatContextFactId: first.contextFactId, statContexts: [first] };
    const before = deriveNpcOrdinaryStatProfile(source.ordinaryHumanoid, {
      npcUuid: original.npcUuid,
      compositionProof,
      ordinaryProof,
    });
    const insight = source.skills.skills.find((s) => s.skillKey === 'INSIGHT')?.skillKey;
    if (insight === undefined) throw Error('source INSIGHT required');
    const skillProof: NpcSkillProof = {
      identityKey: original.npcUuid,
      contexts: [
        {
          ...original.skillProof.contexts[0]!,
          skillStageStats: before.current.stats.skillStageStats,
          permanentStats: before.current.stats.permanentStats,
          effectiveStats: before.current.stats.effectiveStats,
          contextFactId: first.contextFactId,
          sym166SourceOrNull: null,
          facts: [
            {
              kind: 'PAID_ACQUISITION',
              factId: 'NPC_INITIAL_SKILL/' + id(40) + '/1',
              ordinal: 1,
              contextFactId: first.contextFactId,
              skillKey: insight,
              bonusBefore: 0,
              bonusAfter: 1,
              pool: 'START',
              chargedSlotCost: 1,
            },
          ],
        },
      ],
    };
    const skills = evaluateNpcSkills(source.skills, {
      mode: 'CREATE_V1',
      identityKey: original.npcUuid,
      previousConfirmedProofOrNull: null,
      proof: skillProof,
    });
    const input: NpcOrdinaryHumanoidBuildInput = {
      ...original,
      compositionProof,
      ordinaryProof,
      skillProof,
      input: {
        ...original.input,
        baseStats,
        symbionts: [skunk],
        skills: skills.ledger,
        lifetimeFacts: before.current.composition.lifetimeFacts,
      },
    };
    const saved = buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, input);
    expect(saved.sheet.stats.permanentStats.C).toBe(20);
    expect(saved.sheet.input.skills.learnedSkills).toContainEqual(
      expect.objectContaining({ skillKey: insight }),
    );
    const bytes = JSON.stringify(saved);
    const tail = {
      ...first,
      contextFactId: 'NPC_CURRENT_INVENTORY/' + id(80),
      inventoryConfirmationOperationId: id(80),
      equippedInventory: [],
    };
    const current = {
      ...input,
      ordinaryProof: { currentStatContextFactId: tail.contextFactId, statContexts: [first, tail] },
    };
    const after = deriveNpcOrdinaryStatProfile(source.ordinaryHumanoid, {
      npcUuid: current.npcUuid,
      compositionProof,
      ordinaryProof: current.ordinaryProof,
    });
    expect(after.current.stats.permanentStats.C).toBe(10);
    expect(() => buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, current)).toThrow(
      NpcOrdinarySkillReconfirmationRequiredError,
    );
    expect(() =>
      previewNpcOrdinaryHumanoid(source.ordinaryHumanoid, {
        npcUuid: current.npcUuid,
        owningControllerId: current.owningControllerId,
        compositionProof,
        ordinaryProof: current.ordinaryProof,
        previousSkillProofOrNull: skillProof,
        input: { ...current.input, skills: [{ skillKey: insight, targetBonus: 1, pool: 'START' }] },
      }),
    ).toThrow('Вернитесь на шаг навыков (NPC-014)');
    const draftRequest = {
      npcUuid: input.npcUuid,
      compositionProof,
      ordinaryProof: current.ordinaryProof,
      selections: [],
      previousSkillProofOrNull: skillProof,
      currentInventory: { sourceOperationId: id(80), requests: [] },
    };
    const provisional = previewNpcOrdinarySkills(source.ordinaryHumanoid, draftRequest);
    expect(provisional.kind).toBe('UNCOMMITTED');
    expect(provisional.permanentLosses).toEqual([{ contextFactId: id(80), skillKey: insight }]);
    expect(provisional.pools.START).toMatchObject({ used: 0, available: 1 });
    expect(() =>
      previewNpcOrdinarySkills(source.ordinaryHumanoid, {
        ...draftRequest,
        selections: [{ skillKey: insight, targetBonus: 1, pool: 'START' }],
      }),
    ).toThrow();
    for (const currentInventory of [
      undefined,
      { ...draftRequest.currentInventory, invented: true },
      { ...draftRequest.currentInventory, sourceOperationId: first.contextFactId },
    ])
      expect(() =>
        previewNpcOrdinarySkills(source.ordinaryHumanoid, { ...draftRequest, currentInventory }),
      ).toThrow();
    expect(JSON.stringify(saved)).toBe(bytes);
    const reconfirmation = { ...first, contextFactId: id(32), equippedInventory: [] };
    const confirmedProof = {
      currentStatContextFactId: reconfirmation.contextFactId,
      statContexts: [first, tail, reconfirmation],
    };
    const preview = previewNpcOrdinarySkills(source.ordinaryHumanoid, {
      npcUuid: input.npcUuid,
      compositionProof,
      ordinaryProof: confirmedProof,
      selections: [],
      previousSkillProofOrNull: skillProof,
    });
    expect(preview.permanentLosses).toEqual([{ contextFactId: id(32), skillKey: insight }]);
    expect(preview.pools.START).toMatchObject({ used: 0, available: 1 });
    const nextSkills: NpcSkillProof = {
      ...skillProof,
      contexts: [
        ...skillProof.contexts,
        {
          ...skillProof.contexts[0]!,
          contextFactId: id(32),
          ordinal: 2,
          stage: 'CONFIRMED',
          permanentStats: after.current.stats.permanentStats,
          effectiveStats: after.current.stats.effectiveStats,
          facts: [
            {
              kind: 'PERMANENT_REQUIREMENT_LOSS',
              sourceRuleId: 'CORE-166',
              factId: 'NPC_INITIAL_SKILL/' + id(41) + '/1',
              ordinal: 2,
              contextFactId: id(32),
              skillKey: insight,
            },
          ],
        },
      ],
    };
    const confirmed = evaluateNpcSkills(source.skills, {
      mode: 'APPEND_N_PLUS_ONE',
      identityKey: input.npcUuid,
      previousConfirmedProofOrNull: skillProof,
      proof: nextSkills,
    });
    const next = buildNpcOrdinaryHumanoidSnapshot(
      source.ordinaryHumanoid,
      {
        ...current,
        ordinaryProof: confirmedProof,
        skillProof: nextSkills,
        input: { ...current.input, skills: confirmed.ledger },
      },
      saved,
    );
    expect(next.sheet.input.skills.learnedSkills.some((s) => s.skillKey === insight)).toBe(false);
    expect(confirmed.pools.START).toMatchObject({ used: 0, available: 1 });
    expect(next.derivation.skillProof.contexts[0]).toEqual(saved.derivation.skillProof.contexts[0]);
    expect(readNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, next, saved)).toEqual(next);
    expect(JSON.stringify(saved)).toBe(bytes);
  });
  it('issues actual final stat limits without accepting serialized or caller-created results', () => {
    const result = buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, fixture());
    const limits = npcOrdinaryResultEffectiveLimits(result);
    expect(
      applyNpcEffectiveStatLimits(limits, { ...result.sheet.stats.permanentStats, I: 35 }).I,
    ).toBe(30);
    expect(() => npcOrdinaryResultEffectiveLimits(structuredClone(result))).toThrow(
      'issued ordinary result',
    );
    expect(() => npcOrdinaryResultEffectiveLimits({})).toThrow('issued ordinary result');
  });
  it('retains spent Dolphin slots through a monster version and a new Dolphin specimen', () => {
    let request = fixture();
    let saved = buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, request);
    const originalBytes = JSON.stringify(saved);
    const original = saved;
    for (const [ordinal, speciesKey, instanceNumber] of [
      [2, 'CHIMERA', 11],
      [3, 'DOLPHIN', 12],
    ] as const) {
      const targetLevel = speciesKey === 'CHIMERA' ? 1 : 6;
      const nextMember: NpcSymbiontInput = {
        symbiontInstanceId: id(instanceNumber),
        speciesKey,
        targetLevel,
        learnedNodeRefs: source.development.nodes
          .filter((n) => n.speciesKey === speciesKey && n.level <= targetLevel)
          .map((n) => n.nodeRef),
        binding: { kind: 'NONE' },
        currentOE: 0,
      };
      const compositionProof: NpcCompositionConsequenceProof = {
        ...request.compositionProof,
        confirmations: [
          ...request.compositionProof.confirmations,
          {
            confirmationCommandId: id(50 + ordinal),
            diceModeSnapshot: 'MANUAL',
            input: {
              kind: 'APPLY_COMPOSITION_EDIT',
              factId: id(60 + ordinal),
              journalId: id(2),
              ordinal,
              raceCode: 'UNITED',
              additions: [nextMember],
              removals: [id(instanceNumber - 1)],
              buildChanges: [],
              currentOeChanges: [],
            },
          },
        ],
      };
      // Explicit new base I5 keeps the existing STEALTH requirement valid without Dolphin's bonus.
      const baseStats = { ...base, I: 5 };
      const ordinaryProof: NpcOrdinaryHumanoidProof = {
        currentStatContextFactId: id(30 + ordinal),
        statContexts: [
          ...request.ordinaryProof.statContexts,
          {
            contextFactId: id(30 + ordinal),
            schema,
            baseStats,
            compositionOrdinal: ordinal,
            resolutionOrdinal: 0,
          },
        ],
      };
      const profile = deriveNpcOrdinaryStatProfile(source.ordinaryHumanoid, {
        npcUuid: id(1),
        compositionProof,
        ordinaryProof,
      });
      const previousContext = request.skillProof.contexts.at(-1)!;
      const skillProof: NpcSkillProof = {
        identityKey: id(1),
        contexts: [
          ...request.skillProof.contexts,
          {
            ...previousContext,
            contextFactId: id(30 + ordinal),
            ordinal: ordinal + 1,
            skillStageStats: profile.current.stats.skillStageStats,
            permanentStats: profile.current.stats.permanentStats,
            effectiveStats: profile.current.stats.effectiveStats,
            sym166SourceOrNull:
              speciesKey === 'DOLPHIN'
                ? { symbiontInstanceId: nextMember.symbiontInstanceId, nodeRef: 'SYM-166' }
                : null,
            facts: [],
          },
        ],
      };
      const evaluated = evaluateNpcSkills(source.skills, {
        identityKey: id(1),
        mode: 'APPEND_N_PLUS_ONE',
        previousConfirmedProofOrNull: request.skillProof,
        proof: skillProof,
      });
      const next: NpcOrdinaryHumanoidBuildInput = {
        ...request,
        compositionProof,
        ordinaryProof,
        skillProof,
        input: {
          ...request.input,
          baseStats,
          symbionts: [nextMember],
          skills: evaluated.ledger,
          lifetimeFacts: profile.current.composition.lifetimeFacts,
        },
      };
      const built = buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, next, saved);
      expect(built.sheet.input.skills.learnedSkills).toEqual(
        original.sheet.input.skills.learnedSkills,
      );
      expect(evaluated.pools['SYM-166']).toMatchObject({
        capacity: speciesKey === 'CHIMERA' ? 0 : 5,
        used: 5,
        available: 0,
      });
      expect(
        readNpcOrdinaryHumanoidSnapshot(
          source.ordinaryHumanoid,
          JSON.parse(JSON.stringify(built)),
          saved,
        ),
      ).toEqual(built);
      request = next;
      saved = built;
    }
    expect(JSON.stringify(original)).toBe(originalBytes);
    expect(saved.derivation.compositionProof.confirmations).toHaveLength(3);
  });
  it('builds all seven sections for Dolphin skills, and strictly recomputes readback', () => {
    const input = fixture(),
      result = buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, input);
    expect(result.sheet.stats.skillStageStats.I).toBe(4);
    expect(result.sheet.stats.permanentStats.I).toBe(30);
    expect(result.sheet.input.skills.sym166Pool).toMatchObject({
      capacity: 5,
      used: 5,
      available: 0,
      overfill: 0,
    });
    expect(
      result.sheet.input.skills.learnedSkills.map((s) => [
        s.skillKey,
        s.bonus,
        s.charges.map((c) => c.pool),
      ]),
    ).toEqual([
      ['STEALTH', 3, ['START', 'SYM-166']],
      ['ACROBATICS', 3, ['SYM-166']],
    ]);
    expect(Object.keys(result.sheet.input).sort()).toEqual([
      'baseStats',
      'identity',
      'initialState',
      'inventory',
      'lifetimeFacts',
      'skills',
      'symbionts',
    ]);
    expect(result.sheet.combatContext).toEqual({ kind: 'ABSENT' });
    expect(result.sheet.requiresCampaignTime).toBe(false);
    expect(
      readNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, JSON.parse(JSON.stringify(result))),
    ).toEqual(result);
    const forged = structuredClone(result);
    Object.assign(forged.sheet.stats.permanentStats, { I: 29 });
    expect(() => readNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, forged)).toThrow();
    expect(() =>
      buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, {
        ...input,
        input: {
          ...input.input,
          initialState: { ...input.input.initialState, currentHP: result.sheet.maxHP + 1 },
        },
      }),
    ).toThrow('CORE-077');
  });
  it('previews current pool costs without commit leaves and agrees with the real complete build', () => {
    const input = fixture(),
      selections = [
        { skillKey: 'STEALTH', targetBonus: 1, pool: 'START' },
        { skillKey: 'ACROBATICS', targetBonus: 3, pool: 'SYM-166' },
        { skillKey: 'STEALTH', targetBonus: 3, pool: 'SYM-166' },
      ];
    const preview = previewNpcOrdinarySkills(source.ordinaryHumanoid, {
      npcUuid: input.npcUuid,
      compositionProof: input.compositionProof,
      ordinaryProof: input.ordinaryProof,
      selections,
      previousSkillProofOrNull: null,
    });
    const built = buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, input);
    expect(preview.pools['SYM-166']).toEqual({ capacity: 5, used: 5, available: 0, overfill: 0 });
    expect(
      preview.learnedSkills
        .filter((s) => s.source === 'SELECTED')
        .map((s) => [s.skillKey, s.bonus]),
    ).toEqual(built.sheet.input.skills.learnedSkills.map((s) => [s.skillKey, s.bonus]));
    expect(JSON.stringify(preview.pendingCharges)).not.toMatch(
      /factId|operationId|acquisitionFactId/,
    );
    const full = previewNpcOrdinaryHumanoid(source.ordinaryHumanoid, {
      npcUuid: input.npcUuid,
      owningControllerId: input.owningControllerId,
      compositionProof: input.compositionProof,
      ordinaryProof: input.ordinaryProof,
      input: { ...input.input, skills: selections },
    });
    expect(full.sheet.stats).toEqual(built.sheet.stats);
    expect(full.sheet.input.skills).toEqual(preview);
  });
  it('replays N+1 actual stat history without resetting original charges and rejects a rewritten prefix', () => {
    const initial = fixture(),
      old = buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, initial),
      oldBytes = JSON.stringify(old);
    const baseStats = { ...base, W: 4 },
      ordinaryProof = {
        currentStatContextFactId: id(32),
        statContexts: [
          ...initial.ordinaryProof.statContexts,
          { contextFactId: id(32), schema, baseStats, compositionOrdinal: 1, resolutionOrdinal: 0 },
        ],
      };
    const profile = deriveNpcOrdinaryStatProfile(source.ordinaryHumanoid, {
      npcUuid: id(1),
      compositionProof: initial.compositionProof,
      ordinaryProof,
    });
    const prior = initial.skillProof.contexts.at(-1);
    if (prior === undefined) throw Error('fixture');
    const skillProof = {
      identityKey: id(1),
      contexts: [
        ...initial.skillProof.contexts,
        {
          ...prior,
          contextFactId: id(32),
          ordinal: 3,
          skillStageStats: profile.current.stats.skillStageStats,
          permanentStats: profile.current.stats.permanentStats,
          effectiveStats: profile.current.stats.effectiveStats,
          facts: [],
        },
      ],
    };
    const skills = evaluateNpcSkills(source.skills, {
      identityKey: id(1),
      mode: 'APPEND_N_PLUS_ONE',
      previousConfirmedProofOrNull: initial.skillProof,
      proof: skillProof,
    });
    const next = buildNpcOrdinaryHumanoidSnapshot(
      source.ordinaryHumanoid,
      {
        ...initial,
        ordinaryProof,
        skillProof,
        input: { ...initial.input, baseStats, skills: skills.ledger },
      },
      old,
    );
    expect(next.sheet.input.skills.startBasis).toEqual(old.sheet.input.skills.startBasis);
    expect(next.sheet.input.skills.learnedSkills).toEqual(old.sheet.input.skills.learnedSkills);
    expect(next.sheet.input.skills.training.everIssued).toBe(2);
    expect(
      readNpcOrdinaryHumanoidSnapshot(
        source.ordinaryHumanoid,
        JSON.parse(JSON.stringify(next)),
        old,
      ),
    ).toEqual(next);
    expect(JSON.stringify(old)).toBe(oldBytes);
    const forged = structuredClone(next);
    Object.assign(forged.derivation.ordinaryProof.statContexts[0]?.baseStats ?? {}, { I: 5 });
    expect(() => readNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, forged, old)).toThrow();
  });
  it('structural lifetime parsing is closed and does not manufacture missing history', () => {
    const input = fixture(),
      life = input.input.lifetimeFacts;
    expect(readNpcOrdinaryLifetimeFacts(life)).toEqual(life);
    expect(Object.hasOwn(readNpcOrdinaryLifetimeFacts(life), 'trogrStrengthAndLegacyOrNull')).toBe(
      false,
    );
    expect(() => readNpcOrdinaryLifetimeFacts({ ...life, unknown: true })).toThrow();
    let reads = 0;
    const malformed = {
      ...life,
      grossGrant: {
        kind: 'ISSUED',
        sourceRuleId: 'SYM-079',
        bonusBefore: 0,
        bonusAfter: 3,
        get acquisitionFactId() {
          reads++;
          return 'secret';
        },
      },
    };
    expect(() => readNpcOrdinaryLifetimeFacts(malformed)).toThrow('accessor');
    expect(reads).toBe(0);
    expect(() =>
      buildNpcOrdinaryHumanoidSnapshot(source.ordinaryHumanoid, {
        ...input,
        input: {
          ...input.input,
          lifetimeFacts: {
            ...life,
            grossGrant: {
              kind: 'ISSUED',
              sourceRuleId: 'SYM-079',
              bonusBefore: 0,
              bonusAfter: 3,
              acquisitionFactId: 'made-up',
            },
          },
        },
      }),
    ).toThrow();
  });
});
