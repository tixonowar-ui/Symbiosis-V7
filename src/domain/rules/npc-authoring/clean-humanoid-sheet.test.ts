import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadNpcAuthoringSourceCatalog } from '../../../host/npc-catalog.js';
import {
  npcCleanHumanoidFixture,
  npcPureInitialSkillFixture,
} from '../../../../tests/fixtures/npc-clean-humanoid.js';
import {
  buildNpcCleanHumanoidSnapshot,
  previewNpcCleanHumanoid,
  createNpcCleanHumanoidCatalog,
  readNpcCleanHumanoidSnapshot,
  readNpcCleanHumanoidLifetimeFacts,
  NpcCleanHumanoidError,
  deriveNpcPureInitialSkills,
  readNpcInitialSkillFactReference,
  type NpcCleanHumanoidCatalog,
  type NpcCleanHumanoidComponents,
} from './clean-humanoid-sheet.js';

let catalog: NpcCleanHumanoidCatalog;
let components: NpcCleanHumanoidComponents;
let source: Parameters<typeof createNpcCleanHumanoidCatalog>[1];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = {
  npcUuid: id(1),
  owningControllerId: id(2),
  contextFactId: id(3),
  compositionJournalId: id(4),
};
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const loaded = await loadNpcAuthoringSourceCatalog(root);
  components = {
    baseStats: loaded.baseStats,
    skills: loaded.skills,
    compositionConsequences: loaded.compositionConsequences,
    passiveHealth: loaded.passiveHealth,
  };
  const read = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(`${root}/generated/spec/${file}`, 'utf8')) as unknown;
  const [capabilityProfiles, effectRuntimeFields, rules, characterRuntime] = await Promise.all([
    read('effects/capability-profiles.json'),
    read('effects/runtime-contracts.json'),
    read('rules/rules.json'),
    read('character/runtime-contracts.json'),
  ]);
  source = { capabilityProfiles, effectRuntimeFields, rules, characterRuntime };
  catalog = createNpcCleanHumanoidCatalog(components, source);
});
const fixture = () => npcCleanHumanoidFixture(components, binding);
const saved = () => buildNpcCleanHumanoidSnapshot(catalog, fixture());
describe('source-backed complete clean humanoid NPC branch', () => {
  it('has a closed standalone empty lifetime reader, not an identity JSON callback', () => {
    const value = fixture().input.lifetimeFacts;
    expect(readNpcCleanHumanoidLifetimeFacts(value)).toEqual(value);
    expect(() => readNpcCleanHumanoidLifetimeFacts({ ...value, hidden: true })).toThrow();
    expect(() => readNpcCleanHumanoidLifetimeFacts({ ...value, advisorCards: [{}] })).toThrow();
    expect(() =>
      readNpcCleanHumanoidLifetimeFacts({ ...value, freeExtraSlot: { kind: 'UNLOCKED' } }),
    ).toThrow();
  });
  it('derives a complete living sheet from explicit state and actual mandatory class skill', () => {
    const result = saved();
    expect(result.sheet.stats).toEqual({
      baseStats: { S: 10, D: 10, M: 10, C: 10, I: 10, Z: 10, W: 2 },
      skillStageStats: { S: 12, D: 12, M: 10, C: 10, I: 17, Z: 15, W: 2 },
      permanentStats: { S: 12, D: 12, M: 10, C: 10, I: 17, Z: 15, W: 2 },
      effectiveStats: { S: 12, D: 12, M: 10, C: 10, I: 17, Z: 15, W: 2 },
    });
    expect(result.sheet.maxHP).toBe(100);
    expect(result.sheet.input.initialState.currentHP).toBe(70);
    expect(result.sheet.input.skills).toMatchObject({
      startBasis: { confirmationFactId: binding.contextFactId },
      training: { maxPermanentWisdom: 2, everIssued: 1, basisFactId: binding.contextFactId },
      learnedSkills: [],
      fixedSkills: [
        {
          source: 'CLASS_MANDATORY',
          skillKey: 'PURE_SEEKER',
          slotCost: 1,
          sourceRuleIds: ['CORE-008', 'CORE-009'],
        },
      ],
    });
    expect(result.sheet.capabilities).toEqual({
      canPhysicalAct: true,
      canMentalAct: true,
      canReact: true,
      canActiveDefend: true,
      effectiveControllerId: binding.owningControllerId,
      regionPenaltyById: {},
    });
    expect(result.sheet).toMatchObject({
      symbionts: [],
      interactions: [],
      itemProfiles: [],
      requiresCampaignTime: false,
      combatContext: { kind: 'ABSENT' },
    });
    expect(Object.keys(result.sheet.input).sort()).toEqual([
      'baseStats',
      'identity',
      'initialState',
      'inventory',
      'lifetimeFacts',
      'skills',
      'symbionts',
    ]);
  });
  it('revalidates serialized bytes without changing them or inventing scene/time', () => {
    const original = saved(),
      encoded = JSON.stringify(original);
    expect(readNpcCleanHumanoidSnapshot(catalog, JSON.parse(encoded))).toEqual(original);
    expect(JSON.stringify(original)).toBe(encoded);
    expect(Object.isFrozen(original.sheet.input.initialState)).toBe(true);
    expect(encoded).not.toMatch(/campaignTimestamp|combatId|combatActor|turnId|Date/);
  });
  it('preserves explicit HP within the source currentMax without PC full-heal defaults', () => {
    const value = fixture();
    for (const currentHP of [1, 70, 100]) {
      const result = buildNpcCleanHumanoidSnapshot(catalog, {
        ...value,
        input: { ...value.input, initialState: { ...value.input.initialState, currentHP } },
      });
      expect(result.sheet.input.initialState.currentHP).toBe(currentHP);
      expect(result.sheet.maxHP).toBe(100);
    }
  });
  it('CORE-077 refuses excessive author input and stored HP without silently clamping', () => {
    const value = fixture(),
      original = JSON.stringify(value);
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog, {
        ...value,
        input: {
          ...value.input,
          initialState: { ...value.input.initialState, currentHP: 101 },
        },
      }),
    ).toThrow('CORE-077');
    expect(JSON.stringify(value)).toBe(original);
    const snapshot = saved();
    expect(() =>
      readNpcCleanHumanoidSnapshot(catalog, {
        ...snapshot,
        sheet: {
          ...snapshot.sheet,
          input: {
            ...snapshot.sheet.input,
            initialState: {
              ...snapshot.sheet.input.initialState,
              currentHP: 101,
            },
          },
        },
      }),
    ).toThrow('CORE-077');
    const changed = (source.rules as readonly Record<string, unknown>[]).map((row) =>
      row['Rule ID'] === 'CORE-077' ? { ...row, Предусловия: 'only healing' } : row,
    );
    expect(() => createNpcCleanHumanoidCatalog(components, { ...source, rules: changed })).toThrow(
      'CORE-077',
    );
  });
  it.each([0, -1, 1.5, Number.NaN, Infinity])(
    'refuses unsupported/noninteger HP %s',
    (currentHP) => {
      const value = fixture();
      expect(() =>
        buildNpcCleanHumanoidSnapshot(catalog, {
          ...value,
          input: { ...value.input, initialState: { ...value.input.initialState, currentHP } },
        }),
      ).toThrow(NpcCleanHumanoidError);
    },
  );
  it.each(['currentTraumas', 'currentWounds', 'effectInstances', 'sourceSpecificStates'] as const)(
    'never treats unknown %s as clean',
    (field) => {
      const value = fixture();
      expect(() =>
        buildNpcCleanHumanoidSnapshot(catalog, {
          ...value,
          input: { ...value.input, initialState: { ...value.input.initialState, [field]: [{}] } },
        }),
      ).toThrow('NOT_YET_SUPPORTED');
    },
  );
  it.each([{ dead: true }, { deathTimerRollFactOrNull: { factId: id(9) } }])(
    'refuses death/consequence branch',
    (patch) => {
      const value = fixture();
      expect(() =>
        buildNpcCleanHumanoidSnapshot(catalog, {
          ...value,
          input: { ...value.input, initialState: { ...value.input.initialState, ...patch } },
        }),
      ).toThrow('NOT_YET_SUPPORTED');
    },
  );
  it.each(['symbionts', 'inventory'] as const)('does not erase nonempty %s', (field) => {
    const value = fixture();
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog, {
        ...value,
        input: { ...value.input, [field]: [{}] },
      }),
    ).toThrow();
  });
  it('marks other race branches as not yet supported, not prohibited gameplay', () => {
    const value = fixture();
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog, {
        ...value,
        input: {
          ...value.input,
          identity: { ...value.input.identity, raceCode: 'FREE', pureClassOrNull: null },
        },
      }),
    ).toThrow('NOT_YET_SUPPORTED');
  });
  it.each(['maxHP', 'stats', 'capabilities', 'requiresCampaignTime', 'combatContext'] as const)(
    'rejects forged derived %s',
    (field) => {
      const value = saved();
      expect(() =>
        readNpcCleanHumanoidSnapshot(catalog, {
          ...value,
          sheet: {
            ...value.sheet,
            [field]: field === 'maxHP' ? 101 : field === 'requiresCampaignTime' ? true : {},
          },
        }),
      ).toThrow();
    },
  );
  it('rejects forged class ledger and lifetime facts', () => {
    const value = fixture();
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog, {
        ...value,
        input: { ...value.input, skills: { ...value.input.skills, fixedSkills: [] } },
      }),
    ).toThrow();
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog, {
        ...value,
        input: {
          ...value.input,
          lifetimeFacts: { ...value.input.lifetimeFacts, grossGrant: { kind: 'ISSUED' } },
        },
      }),
    ).toThrow();
  });
  it('binds proofs to identity, class and derived stats; host still proves their real origins', () => {
    const value = fixture(),
      first = value.skillProof.contexts[0]!;
    for (const skillProof of [
      { ...value.skillProof, identityKey: id(8) },
      {
        ...value.skillProof,
        contexts: [{ ...first, permanentStats: { ...first.permanentStats, I: 18 } }],
      },
    ])
      expect(() => buildNpcCleanHumanoidSnapshot(catalog, { ...value, skillProof })).toThrow();
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog, {
        ...value,
        compositionProof: {
          ...value.compositionProof,
          identityKey: id(8),
        },
      }),
    ).toThrow();
  });
  it('does not accept additional historical contexts as a fresh empty lifetime', () => {
    const value = fixture(),
      first = value.skillProof.contexts[0]!;
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog, {
        ...value,
        skillProof: {
          ...value.skillProof,
          contexts: [first, { ...first, contextFactId: id(8), ordinal: 2, stage: 'CONFIRMED' }],
        },
      }),
    ).toThrow('NOT_YET_SUPPORTED');
  });
  it('rejects extra fields/getters without invoking or reflecting them', () => {
    const value = saved();
    let invoked = false;
    const malformed = {
      ...value,
      get PRIVATE() {
        invoked = true;
        return 'secret';
      },
    };
    let error: unknown;
    try {
      readNpcCleanHumanoidSnapshot(catalog, malformed);
    } catch (caught) {
      error = caught;
    }
    expect(invoked).toBe(false);
    expect(String(error)).not.toContain('PRIVATE');
    expect(error).toBeInstanceOf(NpcCleanHumanoidError);
    expect(() =>
      readNpcCleanHumanoidSnapshot(catalog, {
        ...value,
        sheet: {
          ...value.sheet,
          capabilities: {
            ...value.sheet.capabilities,
            get canPhysicalAct() {
              invoked = true;
              return true;
            },
          },
        },
      }),
    ).toThrow();
    expect(invoked).toBe(false);
  });
  it('validates Q-CHAR-001 and required schema without defaulting blank input', () => {
    const value = fixture();
    for (const patch of [
      { name: '\u200b' },
      { name: 'x'.repeat(65) },
      { name: '\ud800' },
      { description: 'x'.repeat(2001) },
      { massKg: 59.9 },
      { sex: 'UNKNOWN' },
      { anatomyProfileId: 'UNKNOWN' },
    ])
      expect(() =>
        buildNpcCleanHumanoidSnapshot(catalog, {
          ...value,
          input: {
            ...value.input,
            identity: { ...value.input.identity, ...patch },
          },
        }),
      ).toThrow();
  });
  it('fails closed on altered clean capabilities or HP source representation', () => {
    const changed = (source.capabilityProfiles as readonly Record<string, unknown>[]).map((row) =>
      row.ProfileID === 'PRF-CLEAN' ? { ...row, Реакции: 'NO' } : row,
    );
    expect(() =>
      createNpcCleanHumanoidCatalog(components, { ...source, capabilityProfiles: changed }),
    ).toThrow();
    const runtime = (source.characterRuntime as readonly Record<string, unknown>[]).map((row) =>
      row.ContractKey === 'currentHP' ? { ...row, RuleRef: 'number' } : row,
    );
    expect(() =>
      createNpcCleanHumanoidCatalog(components, { ...source, characterRuntime: runtime }),
    ).toThrow();
  });
});

const commitOperationId = id(500);
const initialInput = (
  pureClassOrNull: 'SEEKER' | 'STALKER' | 'SOLDIER' = 'SEEKER',
  W = 4,
  selections: readonly { skillKey: string; targetBonus: number; pool: 'START' }[] = [
    { skillKey: 'UNARMED', targetBonus: 1, pool: 'START' },
  ],
) => ({
  npcUuid: binding.npcUuid,
  commitOperationId,
  contextFactId: binding.contextFactId,
  schema: {
    raceCode: 'PURE' as const,
    pureClassOrNull,
    anatomyProfileId: 'STANDARD_HUMANOID' as const,
    sex: 'MALE' as const,
    massKg: 75,
  },
  baseStats: { S: 10, D: 10, M: 10, C: 10, I: 10, Z: 10, W },
  selections,
});
const deriveInitial = (value: unknown) =>
  deriveNpcPureInitialSkills({ baseStats: components.baseStats, skills: components.skills }, value);
function paidFixture(
  pureClassOrNull: 'SEEKER' | 'STALKER' | 'SOLDIER' = 'SEEKER',
  W = 4,
  targetBonus = 1,
) {
  return npcPureInitialSkillFixture(
    components,
    { ...binding, commitOperationId },
    {
      pureClassOrNull,
      baseStats: { S: 10, D: 10, M: 10, C: 10, I: 10, Z: 10, W },
      selections: [{ skillKey: 'UNARMED', targetBonus, pool: 'START' }],
    },
  );
}
describe('full PURE sheet initial paid START acquisition', () => {
  it.each([
    ['SEEKER', { S: 12, D: 12, M: 10, C: 10, I: 17, Z: 15, W: 4 }, 'CORE-009'],
    ['STALKER', { S: 12, D: 15, M: 15, C: 10, I: 10, Z: 15, W: 4 }, 'CORE-010'],
    ['SOLDIER', { S: 15, D: 12, M: 15, C: 10, I: 10, Z: 15, W: 4 }, 'CORE-013'],
  ] as const)(
    'derives complete %s class sheet with its actual modifiers and paid skill',
    (cl, stats, rule) => {
      const result = buildNpcCleanHumanoidSnapshot(catalog, paidFixture(cl));
      expect(result.sheet.stats.permanentStats).toEqual(stats);
      expect(result.sheet.stats.effectiveStats).toEqual(stats);
      expect(result.sheet.input.skills.fixedSkills).toMatchObject([
        { skillKey: `PURE_${cl}`, slotCost: 1, sourceRuleIds: ['CORE-008', rule] },
      ]);
      expect(result.sheet.input.skills.learnedSkills).toEqual([
        {
          skillKey: 'UNARMED',
          bonus: 1,
          charges: [
            {
              pool: 'START',
              paidBonus: 1,
              chargedSlotCost: 1,
              acquisitionFactId: `NPC_INITIAL_SKILL/${commitOperationId}/1`,
            },
          ],
        },
      ]);
      expect(result.sheet.input.initialState.currentHP).toBe(70);
      expect(result.sheet.maxHP).toBe(100);
      expect(readNpcCleanHumanoidSnapshot(catalog, JSON.parse(JSON.stringify(result)))).toEqual(
        result,
      );
    },
  );
  it.each([
    [1, 0, 1],
    [2, 0, 1],
    [3, 1, 2],
    [4, 1, 2],
    [11, 5, 6],
    [12, 5, 6],
    [15, 6, 8],
    [16, 6, 8],
    [19, 7, 10],
    [20, 7, 10],
  ])('preserves source ceiling/cost for W%s bonus%s startSlots%s', (W, bonus, slots) => {
    const result = deriveInitial(
      initialInput(
        'SEEKER',
        W,
        bonus === 0 ? [] : [{ skillKey: 'UNARMED', targetBonus: bonus, pool: 'START' }],
      ),
    );
    expect(result.pools.START).toEqual({ capacity: slots, used: slots, available: 0, overfill: 0 });
    expect(result.pools.TRAINING).toEqual({
      capacity: Math.floor(W / 2),
      used: 0,
      available: Math.floor(W / 2),
      overfill: 0,
    });
    const context = result.proof.contexts[0]!;
    expect(context.facts).toHaveLength(bonus === 0 ? 0 : 1);
    if (bonus !== 0)
      expect(context.facts[0]).toMatchObject({
        bonusBefore: 0,
        bonusAfter: bonus,
        chargedSlotCost: slots - 1,
      });
  });
  it('keeps explicit ordered selection leaves and never allocates hidden IDs', () => {
    const input = initialInput('SEEKER', 6, [
      { skillKey: 'GRAPPLING', targetBonus: 1, pool: 'START' },
      { skillKey: 'UNARMED', targetBonus: 1, pool: 'START' },
    ]);
    const before = JSON.stringify(input),
      result = deriveInitial(input);
    expect(result.proof.contexts[0]?.facts.map((f) => f.factId)).toEqual([
      `NPC_INITIAL_SKILL/${commitOperationId}/1`,
      `NPC_INITIAL_SKILL/${commitOperationId}/2`,
    ]);
    expect(result.ledger.learnedSkills.map((skill) => skill.skillKey)).toEqual([
      'GRAPPLING',
      'UNARMED',
    ]);
    expect(JSON.stringify(input)).toBe(before);
    expect(deriveInitial(input)).toEqual(result);
  });
  it('does not replace insufficient/missing initial selections with training slots', () => {
    expect(() => deriveInitial(initialInput('SEEKER', 4, []))).toThrow('underfilled');
    expect(() => deriveInitial(initialInput('SEEKER', 2))).toThrow('exceeded');
    expect(() =>
      deriveInitial({
        ...initialInput(),
        selections: [{ skillKey: 'UNARMED', targetBonus: 1, pool: 'TRAINING' }],
      }),
    ).toThrow('START only');
  });
  it('checks actual requirements and rejects duplicate initial keys', () => {
    const input = initialInput();
    expect(() => deriveInitial({ ...input, baseStats: { ...input.baseStats, D: 1 } })).toThrow(
      'RequirementID',
    );
    expect(() =>
      deriveInitial(
        initialInput('SEEKER', 6, [
          { skillKey: 'UNARMED', targetBonus: 1, pool: 'START' },
          { skillKey: 'UNARMED', targetBonus: 1, pool: 'START' },
        ]),
      ),
    ).toThrow('selected more than once');
  });
  it.each([
    `NPC_INITIAL_SKILL/${commitOperationId}/0`,
    `NPC_INITIAL_SKILL/${commitOperationId}/01`,
    `NPC_INITIAL_SKILL/${commitOperationId}/1.0`,
    `NPC_INITIAL_SKILL/${commitOperationId}/1e0`,
    `NPC_INITIAL_SKILL/${commitOperationId}/+1`,
    `NPC_INITIAL_SKILL/${commitOperationId}/9007199254740992`,
    `NPC_INITIAL_SKILL/${commitOperationId}/1/extra`,
    `NPC_INITIAL_SKILL/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA/1`,
    `OTHER/${commitOperationId}/1`,
  ])('refuses noncanonical/aliased initial reference %s', (reference) => {
    expect(() => readNpcInitialSkillFactReference(reference)).toThrow(NpcCleanHumanoidError);
  });
  it('reads one precise operation-scoped leaf, not a second UUID identity', () => {
    expect(readNpcInitialSkillFactReference(`NPC_INITIAL_SKILL/${commitOperationId}/2`)).toEqual({
      commitOperationId,
      ordinal: 2,
    });
  });
  it('rejects forged cost and wrong leaf ordinal before accepting a stored full sheet', () => {
    const input = paidFixture(),
      context = input.skillProof.contexts[0]!,
      first = context.facts[0]!;
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog, {
        ...input,
        skillProof: {
          ...input.skillProof,
          contexts: [{ ...context, facts: [{ ...first, chargedSlotCost: 2 }] }],
        },
      }),
    ).toThrow('CORE-165');
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog, {
        ...input,
        skillProof: {
          ...input.skillProof,
          contexts: [
            {
              ...context,
              facts: [{ ...first, factId: `NPC_INITIAL_SKILL/${commitOperationId}/2` }],
            },
          ],
        },
      }),
    ).toThrow('ordered original COMMIT');
  });
  it('does not reinterpret sequential upgrades or mixed commits as initial choices', () => {
    const input = paidFixture(),
      context = input.skillProof.contexts[0]!,
      first = context.facts[0]!;
    const baseStats = { ...input.input.baseStats, W: 6 },
      stats = { ...context.skillStageStats, W: 6 };
    const proof = {
      ...input.skillProof,
      contexts: [
        {
          ...context,
          skillStageStats: stats,
          permanentStats: stats,
          effectiveStats: stats,
          facts: [
            first,
            {
              ...first,
              factId: `NPC_INITIAL_SKILL/${commitOperationId}/2`,
              ordinal: 2,
              bonusBefore: 1,
              bonusAfter: 2,
            },
          ],
        },
      ],
    };
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog, {
        ...input,
        input: { ...input.input, baseStats },
        skillProof: proof,
      }),
    ).toThrow('one acquisition from absence');
    const other = {
      ...first,
      factId: `NPC_INITIAL_SKILL/${id(501)}/2`,
      ordinal: 2,
      skillKey: 'GRAPPLING',
    };
    expect(() =>
      buildNpcCleanHumanoidSnapshot(catalog, {
        ...input,
        input: { ...input.input, baseStats },
        skillProof: { ...proof, contexts: [{ ...proof.contexts[0], facts: [first, other] }] },
      }),
    ).toThrow('ordered original COMMIT');
  });
  it('requires explicit references without reading getters or adding state', () => {
    let calls = 0;
    const input = initialInput();
    expect(() =>
      deriveInitial({
        ...input,
        get commitOperationId() {
          calls++;
          return commitOperationId;
        },
      }),
    ).toThrow();
    expect(calls).toBe(0);
    expect(() => deriveInitial({ ...input, commitOperationId: undefined })).toThrow();
    expect(() =>
      deriveInitial({ ...input, selections: [{ ...input.selections[0], paidCost: 1 }] }),
    ).toThrow();
  });
});

describe('NPC-017 read-only initial selection preview', () => {
  const previewInput = (cl: 'SEEKER' | 'STALKER' | 'SOLDIER' = 'SEEKER') => {
    const value = paidFixture(cl);
    return {
      npcUuid: value.npcUuid,
      owningControllerId: value.owningControllerId,
      compositionProof: value.compositionProof,
      input: {
        ...value.input,
        skills: [{ skillKey: 'UNARMED', targetBonus: 1, pool: 'START' }],
      },
    };
  };
  // Character Skills SKL-043/044/045 retain their distinct fixed class bonuses.
  it.each([
    ['SEEKER', 5],
    ['STALKER', 4],
    ['SOLDIER', 3],
  ] as const)(
    'calculates the same %s mechanics without prospective COMMIT or acquisition facts',
    (cl, classBonus) => {
      const value = previewInput(cl),
        before = JSON.stringify(value);
      const preview = previewNpcCleanHumanoid(catalog, value);
      const committed = buildNpcCleanHumanoidSnapshot(catalog, paidFixture(cl));
      expect(preview.kind).toBe('UNCOMMITTED');
      expect(preview.sheet).toMatchObject({
        stats: committed.sheet.stats,
        maxHP: 100,
        capabilities: committed.sheet.capabilities,
        requiresCampaignTime: false,
        combatContext: { kind: 'ABSENT' },
      });
      for (const key of [
        'identity',
        'baseStats',
        'symbionts',
        'lifetimeFacts',
        'inventory',
        'initialState',
      ] as const)
        expect(preview.sheet.input[key]).toEqual(committed.sheet.input[key]);
      expect(preview.sheet.input.skills).toEqual({
        capacity: 2,
        used: 2,
        remaining: 0,
        learnedSkills: [
          { source: 'CLASS_MANDATORY', skillKey: `PURE_${cl}`, bonus: classBonus, slotCost: 1 },
          { source: 'SELECTED', skillKey: 'UNARMED', bonus: 1, slotCost: 1 },
        ],
      });
      expect(JSON.stringify(preview)).not.toMatch(
        /NPC_INITIAL_SKILL|acquisitionFactId|confirmationFactId|commitOperationId|committedAt/,
      );
      expect(JSON.stringify(value)).toBe(before);
      expect(previewNpcCleanHumanoid(catalog, value)).toEqual(preview);
      expect(Object.isFrozen(preview.sheet.input.skills.learnedSkills)).toBe(true);
      expect(() => readNpcCleanHumanoidSnapshot(catalog, preview)).toThrow();
    },
  );
  it('does not validate a preview with a supplied ledger, unused slots, excessive HP or extra command identity', () => {
    const value = previewInput();
    for (const input of [
      { ...value.input, skills: paidFixture().input.skills },
      { ...value.input, skills: [] },
      { ...value.input, initialState: { ...value.input.initialState, currentHP: 101 } },
      { ...value.input, skills: [{ skillKey: 'UNARMED', targetBonus: 1, pool: 'TRAINING' }] },
    ])
      expect(() => previewNpcCleanHumanoid(catalog, { ...value, input })).toThrow();
    expect(() => previewNpcCleanHumanoid(catalog, { ...value, commitOperationId })).toThrow();
    expect(() =>
      previewNpcCleanHumanoid(catalog, { ...value, skillProof: paidFixture().skillProof }),
    ).toThrow();
  });
});
