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
  deriveNpcInitialTaipanModeStates,
  npcHumanoidPoisonProofForTarget,
  type NpcHumanoidPoisonContext,
} from './taipan-mode-state.js';
import {
  createNpcPoisonSourceCatalog,
  npcTaipanInitialModeChoices,
  npcTaipanPoisonProfileLabel,
  deriveNpcTaipanModeContribution,
  deriveNpcPoisonSourceContribution,
  readNpcTaipanModeContribution,
  readNpcPoisonSourceContribution,
  assertNpcPoisonSourceTarget,
  assertNpcTaipanModeTarget,
  type NpcPoisonSourceCatalog,
  type NpcPoisonSourceObservation,
  type NpcTaipanModeHistoryAnchor,
} from './formal-poison-source.js';

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
function read(observations: readonly NpcPoisonSourceObservation[]) {
  return readNpcPoisonSourceContribution(
    catalog,
    deriveNpcPoisonSourceContribution(catalog, mode(), {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: observations.at(-1)!.campaignTimestamp,
      origin: { kind: 'PREPARED', preparationOperationId: id(8) },
      targetCommitOperationIdOrNull: null,
      observations,
    }),
  );
}
describe('ADR0087 actual Taipan mode and CQA-002 source lineage', () => {
  it.each([
    ['POI-TAIPAN-DEADLY', 'Смертельный яд Тайпана'],
    ['POI-TAIPAN-WEAKENING', 'Ослабляющий яд Тайпана'],
    ['POI-TAIPAN-PARALYTIC', 'Парализующий яд Тайпана'],
  ])(
    'uses the supplied poison name for %s rather than a technical identifier',
    (profile, label) => {
      expect(npcTaipanPoisonProfileLabel(catalog, profile)).toBe(label);
      expect(() => npcTaipanPoisonProfileLabel(catalog, 'UNKNOWN')).toThrow('profile label');
      expect(() => npcTaipanPoisonProfileLabel(structuredClone(catalog), profile)).toThrow(
        'issued',
      );
    },
  );
  it('reprojects a retained dose at a current read without rewriting historical observation times', () => {
    const observations = [observation(), observation(composition(), 31, 'COMMIT')];
    const oldBytes = JSON.stringify(observations);
    const currentLife = observation(composition(), 90, 'COMMIT', 40).life;
    if (currentLife.kind !== 'CONFIRMED') throw new Error('Actual current life required');
    const currentTarget = {
      owningOperationId: id(90),
      compositionProof: composition(),
      life: currentLife,
    };
    const scope = {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 40,
      origin: { kind: 'COMMITTED' as const, originCommitOperationId: id(31) },
      targetCommitOperationIdOrNull: null,
      observations,
    };
    const token = deriveNpcPoisonSourceContribution(catalog, mode(), {
      ...scope,
      currentTarget,
    });
    expect(readNpcPoisonSourceContribution(catalog, token)).toMatchObject({
      campaignTimestamp: 40,
      originalCampaignTimestamp: 37,
      effectiveSourceSnapshot: { targetLevel: 1 },
      resolution: { kind: 'CURRENT', observationOperationId: id(31) },
    });
    expect(() =>
      assertNpcPoisonSourceTarget(catalog, token, {
        compositionProof: composition(),
        lifeStateOrNull: currentLife.state,
      }),
    ).not.toThrow();
    expect(JSON.stringify(observations)).toBe(oldBytes);
    expect(() => deriveNpcPoisonSourceContribution(catalog, mode(), scope)).toThrow(
      'target observation',
    );
    expect(() =>
      deriveNpcPoisonSourceContribution(catalog, mode(), {
        ...scope,
        currentTarget,
        targetCommitOperationIdOrNull: id(31),
      }),
    ).toThrow('current read');
    expect(() =>
      deriveNpcPoisonSourceContribution(catalog, mode(), {
        ...scope,
        currentTarget: {
          ...currentTarget,
          life: {
            kind: 'CONFIRMED',
            state: structuredClone(currentLife.state),
          },
        },
      }),
    ).toThrow('issued');
    expect(() =>
      deriveNpcPoisonSourceContribution(catalog, mode(), {
        ...scope,
        currentTarget: {
          ...currentTarget,
          life: { kind: 'NOT_CONFIRMED_DRAFT' },
        },
      }),
    ).toThrow('discard');
    const changed = next(composition(), 20, {
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
      deriveNpcPoisonSourceContribution(catalog, mode(), {
        ...scope,
        currentTarget: { ...currentTarget, compositionProof: changed },
      }),
    ).toThrow();
    const changedAnchor = createNpcFormalLifeState(
      source.formalLife,
      { ...currentLife.state.anchor, initialStateConfirmationId: id(99) },
      {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestampOrNull: 40,
        currentHP: 7,
      },
      null,
    );
    expect(() =>
      deriveNpcPoisonSourceContribution(catalog, mode(), {
        ...scope,
        currentTarget: {
          ...currentTarget,
          life: { kind: 'CONFIRMED', state: changedAnchor },
        },
      }),
    ).toThrow();
  });
  it('encodes an explicit untimed mode beside life and retains original COMMIT references', () => {
    const current = composition(),
      token = mode(current, null);
    const context: NpcHumanoidPoisonContext = {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestampOrNull: null,
      targetCommitOperationIdOrNull: null,
      previousVersionCompositionProofOrNull: null,
      modes: [token],
      coatingContext: null,
    };
    const states = deriveNpcInitialTaipanModeStates(catalog, current, context);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      kind: 'GM_FORMAL_INITIAL_TAIPAN_MODE_STATE',
      effectTypeId: 'EFF-SYMBIONT-POISON_MODE',
      effectInstanceId: id(7),
      activePoisonType: 'POI-TAIPAN-DEADLY',
      pendingSwitchOrNull: null,
      origin: { kind: 'PREPARED', preparationOperationId: id(6) },
    });
    expect(states[0]).not.toHaveProperty('startsAt');
    expect(states[0]).not.toHaveProperty('expiresAt');
    expect(() =>
      deriveNpcInitialTaipanModeStates(catalog, current, {
        ...context,
        modes: [],
      }),
    ).toThrow('every new Taipan');
    expect(() =>
      deriveNpcInitialTaipanModeStates(catalog, current, {
        ...context,
        previousVersionCompositionProofOrNull: current,
        modes: [],
      }),
    ).toThrow('independently proven retained mode');
    expect(() =>
      deriveNpcInitialTaipanModeStates(catalog, current, {
        ...context,
        modes: [token, token],
      }),
    ).toThrow('duplicate');
    expect(() => npcHumanoidPoisonProofForTarget(states, id(90))).toThrow('committed');
    const retained = deriveNpcTaipanModeContribution(catalog, anchor(), {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestampOrNull: null,
      origin: { kind: 'COMMITTED', originCommitOperationId: id(90) },
      originalCompositionProof: current,
      previousVersionCompositionProofOrNull: null,
      currentCompositionProof: current,
    });
    const retainedStates = deriveNpcInitialTaipanModeStates(catalog, current, {
      ...context,
      targetCommitOperationIdOrNull: id(91),
      previousVersionCompositionProofOrNull: current,
      modes: [retained],
    });
    expect(npcHumanoidPoisonProofForTarget(retainedStates, id(91))).toEqual({
      commitOperationId: id(91),
      modeAssignments: [{ modeOperationId: id(6), originCommitOperationId: id(90) }],
    });
    expect(retainedStates[0]?.anchor).toEqual(anchor());
    expect(() =>
      deriveNpcInitialTaipanModeStates(catalog, current, {
        ...context,
        targetCommitOperationIdOrNull: id(91),
      }),
    ).toThrow('PREPARED');
  });
  it('binds an issued target to the whole same-NPC composition and actual life context', () => {
    const before = composition(),
      modeProof = mode(),
      row = observation(before);
    if (row.life.kind !== 'CONFIRMED') throw Error('fixture life');
    const confirmedLife = row.life.state;
    const issued = deriveNpcPoisonSourceContribution(catalog, modeProof, {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 37,
      origin: { kind: 'PREPARED', preparationOperationId: id(8) },
      targetCommitOperationIdOrNull: null,
      observations: [row],
    });
    const target = {
      compositionProof: before,
      lifeStateOrNull: row.life.state,
    };
    expect(() => assertNpcPoisonSourceTarget(catalog, issued, target)).not.toThrow();
    const after = next(before, 20, {
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
      assertNpcPoisonSourceTarget(catalog, issued, {
        ...target,
        compositionProof: after,
      }),
    ).toThrow();
    expect(() =>
      assertNpcPoisonSourceTarget(catalog, issued, {
        ...target,
        lifeStateOrNull: null,
      }),
    ).toThrow();
    const otherHp = createNpcFormalLifeState(
      source.formalLife,
      row.life.state.anchor,
      {
        campaignId: id(10),
        npcUuid: id(1),
        currentHP: 8,
        campaignTimestampOrNull: 37,
      },
      null,
    );
    expect(() =>
      assertNpcPoisonSourceTarget(catalog, issued, {
        ...target,
        lifeStateOrNull: otherHp,
      }),
    ).toThrow();
    expect(() =>
      assertNpcPoisonSourceTarget(catalog, issued, {
        ...target,
        lifeStateOrNull: structuredClone(confirmedLife),
      }),
    ).toThrow('issued life');
    const modeTarget = {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestampOrNull: 37,
      compositionProof: before,
    };
    expect(() => assertNpcTaipanModeTarget(catalog, modeProof, modeTarget)).not.toThrow();
    expect(() =>
      assertNpcTaipanModeTarget(catalog, modeProof, {
        ...modeTarget,
        compositionProof: after,
      }),
    ).toThrow();
  });
  it('binds the separate target COMMIT and refuses an origin-only prefix ending in current carry', () => {
    const before = composition(),
      after = next(before, 20, {
        buildChanges: [
          {
            symbiontInstanceId: id(5),
            targetLevel: 4,
            learnedNodeRefs: nodes(4),
            binding: { kind: 'NONE' },
          },
        ],
      });
    const observations = [
      observation(before),
      observation(before, 31, 'COMMIT', 37),
      {
        ...observation(after, 20, 'COMPOSITION_CONFIRMATION', 38),
        life: { kind: 'CARRY_PREVIOUS' } as const,
      },
    ];
    const context = {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 38,
      origin: { kind: 'COMMITTED', originCommitOperationId: id(31) } as const,
      targetCommitOperationIdOrNull: id(32),
      observations,
    };
    expect(() => deriveNpcPoisonSourceContribution(catalog, mode(), context)).toThrow();
    const good = deriveNpcPoisonSourceContribution(catalog, mode(), {
      ...context,
      observations: [...observations, observation(after, 32, 'COMMIT', 38)],
    });
    expect(readNpcPoisonSourceContribution(catalog, good)).toMatchObject({
      targetCommitOperationIdOrNull: id(32),
      origin: { originCommitOperationId: id(31) },
      effectiveSourceSnapshot: { targetLevel: 4 },
    });
    expect(() =>
      deriveNpcPoisonSourceContribution(catalog, mode(), {
        ...context,
        targetCommitOperationIdOrNull: id(33),
        observations: [...observations, observation(after, 32, 'COMMIT', 38)],
      }),
    ).toThrow();
  });
  it('uses current values after an independently confirmed draft correction, not a forged resurrection', () => {
    const before = composition(),
      after = next(before, 20, {
        buildChanges: [
          {
            symbiontInstanceId: id(5),
            targetLevel: 4,
            learnedNodeRefs: nodes(4),
            binding: { kind: 'NONE' },
          },
        ],
      });
    const observations = [
      observation(before),
      observation(before, 30, 'LIFE_STATE_SET', 38, true),
      {
        ...observation(after, 20, 'COMPOSITION_CONFIRMATION', 39),
        life: { kind: 'CARRY_PREVIOUS' } as const,
      },
    ];
    expect(read(observations)).toMatchObject({
      effectiveSourceSnapshot: { targetLevel: 1 },
      resolution: { kind: 'FROZEN' },
    });
    const actual = observation(after, 31, 'LIFE_STATE_SET', 40);
    expect(read([...observations, actual])).toMatchObject({
      originalSourceSnapshot: { targetLevel: 1 },
      effectiveSourceSnapshot: { targetLevel: 4 },
      resolution: { kind: 'CURRENT', unavailableOperationIdOrNull: null },
    });
    expect(() =>
      read([...observations, { ...actual, life: structuredClone(actual.life) }]),
    ).toThrow('issued life');
    const replaced = next(after, 21, {
      additions: [
        {
          ...after.confirmations[0]!.input.additions[0]!,
          targetLevel: 4,
          learnedNodeRefs: nodes(4),
        },
      ],
    });
    expect(() => read([...observations, { ...actual, compositionProof: replaced }])).toThrow();
  });
  it('keeps unconfirmed draft life explicit, carries an actual SET, and requires final COMMIT life', () => {
    const before = composition(),
      initial = {
        ...observation(before),
        life: { kind: 'NOT_CONFIRMED_DRAFT' } as const,
      };
    expect(read([initial]).lifeEvidence).toBe('NOT_CONFIRMED_DRAFT');
    const set = { ...observation(before, 11, 'LIFE_STATE_SET', 37) };
    const later = next(before, 20, {
      buildChanges: [
        {
          symbiontInstanceId: id(5),
          targetLevel: 4,
          learnedNodeRefs: nodes(4),
          binding: { kind: 'NONE' },
        },
      ],
    });
    const carry = {
      ...observation(later, 20, 'COMPOSITION_CONFIRMATION', 38),
      life: { kind: 'CARRY_PREVIOUS' } as const,
    };
    expect(read([initial, set, carry])).toMatchObject({
      lifeEvidence: 'CONFIRMED',
      effectiveSourceSnapshot: { targetLevel: 4 },
    });
    expect(() =>
      read([
        initial,
        {
          ...carry,
          compositionProof: before,
          kind: 'COMMIT',
          life: { kind: 'NOT_CONFIRMED_DRAFT' },
        },
      ]),
    ).toThrow('actual life evidence');
    expect(() => read([initial, { ...carry, compositionProof: before }])).toThrow('life evidence');
    expect(() => read([initial, set, { ...carry, life: { kind: 'NOT_CONFIRMED_DRAFT' } }])).toThrow(
      'life evidence',
    );
  });
  it('requires the delivered source and an explicit learned choice for a genuinely new instance', () => {
    expect(
      npcTaipanInitialModeChoices(catalog, {
        npcUuid: id(1),
        compositionProof: composition(),
        previousVersionCompositionProofOrNull: null,
      }),
    ).toEqual([
      {
        sourceInstanceId: id(5),
        acquisitionFactId: id(4),
        profiles: [{ poisonProfileId: 'POI-TAIPAN-DEADLY', sourceAbilityId: 'SYM-039' }],
      },
    ]);
    expect(readNpcTaipanModeContribution(catalog, mode())).toMatchObject({
      activePoisonProfileId: 'POI-TAIPAN-DEADLY',
      pendingSwitchOrNull: null,
      effectInstanceId: id(7),
    });
    expect(
      npcTaipanInitialModeChoices(catalog, {
        npcUuid: id(1),
        compositionProof: composition(),
        previousVersionCompositionProofOrNull: composition(),
      }),
    ).toEqual([]);
    for (const changed of [
      { activePoisonProfileId: null },
      { activePoisonProfileId: 'POI-TAIPAN-PARALYTIC' },
      { pendingSwitchOrNull: { target: 'POI-TAIPAN-WEAKENING' } },
    ])
      expect(() =>
        deriveNpcTaipanModeContribution(catalog, { ...anchor(), ...changed } as never, {
          campaignId: id(10),
          npcUuid: id(1),
          campaignTimestampOrNull: null,
          origin: { kind: 'PREPARED', preparationOperationId: id(6) },
          originalCompositionProof: composition(),
          previousVersionCompositionProofOrNull: null,
          currentCompositionProof: composition(),
        }),
      ).toThrow();
    const form = structuredClone(inputs.npcInitialStateForm) as {
      acceptanceCriteria: string[];
    };
    form.acceptanceCriteria = form.acceptanceCriteria.filter(
      (c) => !c.startsWith('ADR0087 Taipan mode:'),
    );
    expect(() => createNpcPoisonSourceCatalog({ ...inputs, npcInitialStateForm: form })).toThrow(
      'ADR0087',
    );
  });
  it('retains original mode and snapshot while a later level supplies the current uncomputed L', () => {
    const before = composition(),
      after = next(before, 20, {
        buildChanges: [
          {
            symbiontInstanceId: id(5),
            targetLevel: 4,
            learnedNodeRefs: nodes(4),
            binding: { kind: 'NONE' },
          },
        ],
      });
    const result = read([
      observation(before),
      observation(after, 20, 'COMPOSITION_CONFIRMATION', 38),
    ]);
    expect(result.originalSourceSnapshot.targetLevel).toBe(1);
    expect(result.effectiveSourceSnapshot.targetLevel).toBe(4);
    expect(result.activePoisonProfileId).toBe('POI-TAIPAN-DEADLY');
    expect(result.resolution).toEqual({
      kind: 'CURRENT',
      observationOperationId: id(20),
      unavailableOperationIdOrNull: null,
      unavailableReasonOrNull: null,
    });
  });
  it('freezes the last proven available level at actual removal, never at initial preparation', () => {
    const before = composition(),
      level = next(before, 20, {
        buildChanges: [
          {
            symbiontInstanceId: id(5),
            targetLevel: 4,
            learnedNodeRefs: nodes(4),
            binding: { kind: 'NONE' },
          },
        ],
      }),
      removed = next(level, 21, { removals: [id(5)] });
    const result = read([
      observation(before),
      observation(level, 20, 'COMPOSITION_CONFIRMATION', 38),
      observation(removed, 21, 'COMPOSITION_CONFIRMATION', 39),
    ]);
    expect(result.originalSourceSnapshot.targetLevel).toBe(1);
    expect(result.effectiveSourceSnapshot.targetLevel).toBe(4);
    expect(result.currentPreparationAllowed).toBe(false);
    expect(result.resolution).toEqual({
      kind: 'FROZEN',
      observationOperationId: id(20),
      unavailableOperationIdOrNull: id(21),
      unavailableReasonOrNull: 'SOURCE_REMOVED',
    });
    expect(() =>
      read([observation(before), observation(removed, 21, 'COMPOSITION_CONFIRMATION', 39)]),
    ).toThrow('missing or combined');
  });
  it('keeps a suppressed but readable source current and refuses a new preparation', () => {
    const before = composition(),
      suppressed = next(before, 20, {
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
      }),
      level = next(suppressed, 21, {
        buildChanges: [
          {
            symbiontInstanceId: id(5),
            targetLevel: 4,
            learnedNodeRefs: nodes(4),
            binding: { kind: 'NONE' },
          },
        ],
      });
    const result = read([
      observation(before),
      observation(suppressed, 20, 'COMPOSITION_CONFIRMATION', 38),
      observation(level, 21, 'COMPOSITION_CONFIRMATION', 39),
    ]);
    expect(result.effectiveSourceSnapshot.targetLevel).toBe(4);
    expect(result.resolution.kind).toBe('CURRENT');
    expect(result.currentPreparationAllowed).toBe(false);
    expect(() =>
      deriveNpcPoisonSourceContribution(catalog, mode(level), {
        campaignId: id(10),
        npcUuid: id(1),
        campaignTimestamp: 39,
        origin: { kind: 'PREPARED', preparationOperationId: id(8) },
        targetCommitOperationIdOrNull: null,
        observations: [observation(level, 8, 'PREPARATION', 39)],
      }),
    ).toThrow('actual active learned');
  });
  it('binds real owner death and refuses cloned life evidence or an unobserved life transition', () => {
    const before = composition(),
      result = read([observation(before), observation(before, 30, 'LIFE_STATE_SET', 38, true)]);
    expect(result.resolution).toEqual({
      kind: 'FROZEN',
      observationOperationId: id(8),
      unavailableOperationIdOrNull: id(30),
      unavailableReasonOrNull: 'OWNER_DEAD',
    });
    expect(() => read([observation(before), observation(before, 30, 'COMMIT', 38, true)])).toThrow(
      'unobserved life',
    );
    expect(() =>
      read([
        {
          ...observation(before),
          life: structuredClone(observation(before).life),
        },
      ]),
    ).toThrow('issued life');
  });
  it('refuses cloned tokens, foreign scope, changed prefix and absent actual COMMIT', () => {
    const token = mode();
    expect(() => readNpcTaipanModeContribution(catalog, structuredClone(token))).toThrow(
      'issued mode',
    );
    const base = {
      campaignId: id(10),
      npcUuid: id(1),
      campaignTimestamp: 37,
      origin: { kind: 'PREPARED', preparationOperationId: id(8) } as const,
      targetCommitOperationIdOrNull: null,
      observations: [observation()],
    };
    const issued = deriveNpcPoisonSourceContribution(catalog, token, base);
    expect(() => readNpcPoisonSourceContribution(catalog, structuredClone(issued))).toThrow(
      'issued poison',
    );
    expect(() =>
      deriveNpcPoisonSourceContribution(catalog, token, {
        ...base,
        campaignId: id(99),
      }),
    ).toThrow();
    expect(() =>
      deriveNpcPoisonSourceContribution(catalog, token, {
        ...base,
        origin: { kind: 'COMMITTED', originCommitOperationId: id(90) },
      }),
    ).toThrow('actual original COMMIT');
    expect(() =>
      deriveNpcPoisonSourceContribution(catalog, token, {
        ...base,
        observations: [
          {
            ...observation(),
            compositionProof: { ...composition(), confirmations: [] },
          },
        ],
      }),
    ).toThrow();
  });
});
