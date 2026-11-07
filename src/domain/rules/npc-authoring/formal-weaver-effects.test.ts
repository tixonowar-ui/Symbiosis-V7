import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import type { NpcCompositionConsequenceProof } from './composition-consequence-types.js';
import {
  createNpcFormalWeaverCatalog,
  deriveNpcFormalWeaverEffectContribution,
  readNpcFormalWeaverEffectContribution,
  validateNpcFormalWeaverEffectContribution,
  assertNpcFormalWeaverContributionSet,
  readNpcFormalWeaverRemaining,
  npcFormalWeaverMaximumRemainingMinutes,
  npcFormalWeaverSourceChoices,
  NpcFormalWeaverError,
  NpcFormalWeaverCurrentUnavailableError,
  type NpcFormalWeaverCatalog,
  type NpcFormalWeaverBranch,
  type NpcFormalWeaverHistoryAnchor,
} from './formal-weaver-effects.js';
import {
  deriveNpcFunctionalDuplicateProof,
  readNpcFunctionalDuplicateProof,
  readNpcFunctionalDuplicateRequiredDeathDeadline,
} from './functional-duplicate-composition.js';
import {
  createNpcFormalLifeState,
  previewNpcFormalLifeTimerBasis,
  readNpcFormalLifeBoundary,
  deriveNpcRetainedFormalLifeState,
  type NpcFormalLifeHistoryAnchor,
} from './formal-life-state.js';
import {
  previewNpcHumanoidLifeBoundary,
  readNpcHumanoidLifeBoundary,
  type NpcHumanoidLifePreview,
} from './humanoid-life-boundary.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let source: NpcAuthoringSourceCatalog, catalog: NpcFormalWeaverCatalog;
let sourceInput: Parameters<typeof createNpcFormalWeaverCatalog>[0];
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const read = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(`${root}/generated/spec/${file}.json`, 'utf8')) as unknown;
  source = await loadNpcAuthoringSourceCatalog(root);
  const forms = (await read('atlas/forms-by-id')) as Record<string, unknown>;
  sourceInput = {
    compositionConsequences: source.compositionConsequences,
    rules: await read('rules/rules'),
    developmentNodes: await read('character/development-nodes'),
    abilityContexts: await read('character/ability-contexts'),
    effectTypes: await read('effects/effect-types'),
    npcInitialStateForm: forms['NPC-016'],
  };
  catalog = createNpcFormalWeaverCatalog(sourceInput);
});
function composition(level = 3): NpcCompositionConsequenceProof {
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
              speciesKey: 'WEAVER',
              targetLevel: level,
              currentOE: 0,
              binding: { kind: 'NONE' },
              learnedNodeRefs: source.development.nodes
                .filter(
                  (n) =>
                    n.speciesKey === 'WEAVER' &&
                    n.level <= level &&
                    n.branchCodeOrNull !== 'EXTERNAL_REGENERATION',
                )
                .map((n) => n.nodeRef),
            },
          ],
        },
      },
    ],
  };
}
function anchor(
  branch: NpcFormalWeaverBranch = 'REPLACEMENT_TEMPORARY',
  remainingMinutes = '2.5',
  effect = 10,
): NpcFormalWeaverHistoryAnchor {
  return {
    kind: 'GM_FORMAL_INITIAL_WEAVER',
    campaignId: id(20),
    npcUuid: id(1),
    effectInstanceId: id(effect),
    sourceInstanceId: id(5),
    sourceOperationId: id(effect + 100),
    branch,
    reason: 'Подтверждённое исходное состояние Ткача',
    createdAt: '2026-11-06T12:00:00.000Z',
    calendarAnchor: {
      kind: 'PRE_START_INITIAL',
      campaignTimestamp: 37,
      lobbySnapshotRevision: 'a'.repeat(64),
    },
    remainingMinutes,
    revision: 1,
  };
}
function context(now = 37, original = composition(), current = original) {
  return {
    campaignId: id(20),
    npcUuid: id(1),
    campaignTimestamp: now,
    origin: { kind: 'COMMITTED', originCommitOperationId: id(30) } as const,
    originalCompositionProof: original,
    currentCompositionProof: current,
  };
}
function contribution(history = anchor(), now = 37) {
  return deriveNpcFormalWeaverEffectContribution(catalog, history, context(now));
}
function duplicate(proof = contribution(), now = 37, campaign = id(20)) {
  return deriveNpcFunctionalDuplicateProof(source.functionalDuplicate, {
    npcUuid: id(1),
    campaignId: campaign,
    campaignTimestamp: now,
    compositionProof: composition(),
    temporaryEffects: [proof],
  });
}
function life(
  entry: ReturnType<typeof duplicate>,
  remainingMinutes: string,
): NpcFormalLifeHistoryAnchor {
  return {
    kind: 'GM_FORMAL_INITIAL_LIFE',
    campaignId: id(20),
    npcUuid: id(1),
    lifeKind: 'SEVERELY_WOUNDED',
    initialStateConfirmationId: id(40),
    reason: 'Текущее ранение',
    createdAt: '2026-11-06T12:00:00.000Z',
    severeWoundOrNull: {
      effectInstanceId: id(41),
      calendarAnchor: anchor().calendarAnchor,
      rollFact: {
        factId: id(42),
        sourceRuleId: 'CORE-153',
        roll: { dieSides: 6, rawFace: 3 },
      },
      remainingMinutes,
      duplicateAtEntry: readNpcFunctionalDuplicateProof(entry),
    },
  };
}
const lifeContext = (now = 37) => ({
  campaignId: id(20),
  npcUuid: id(1),
  currentHP: 0,
  campaignTimestampOrNull: now,
});
describe('accepted ADR0086 formal Weaver source/time contribution and final life closure', () => {
  it('offers only actual learned source branches before any effect, roll or clock identity is allocated', () => {
    const proof = composition(3),
      before = JSON.stringify(proof);
    expect(
      npcFormalWeaverSourceChoices(catalog, {
        npcUuid: id(1),
        compositionProof: { ...proof, confirmations: [] },
      }),
    ).toEqual([]);
    expect(
      npcFormalWeaverSourceChoices(catalog, {
        npcUuid: id(1),
        compositionProof: composition(1),
      }),
    ).toEqual([]);
    expect(
      npcFormalWeaverSourceChoices(catalog, {
        npcUuid: id(1),
        compositionProof: composition(2),
      }),
    ).toEqual([
      {
        sourceInstanceId: id(5),
        branches: [
          { branch: 'REPLACEMENT_TEMPORARY', maximumRemainingMinutes: '5' },
          { branch: 'REPLACEMENT_RECOVERY', maximumRemainingMinutes: '7' },
        ],
      },
    ]);
    const choices = npcFormalWeaverSourceChoices(catalog, {
      npcUuid: id(1),
      compositionProof: proof,
    });
    expect(choices).toEqual([
      {
        sourceInstanceId: id(5),
        branches: [
          { branch: 'REPLACEMENT_TEMPORARY', maximumRemainingMinutes: '5' },
          { branch: 'REPLACEMENT_RECOVERY', maximumRemainingMinutes: '7' },
          {
            branch: 'DUPLICATED_ORGANS_PROTECTION',
            maximumRemainingMinutes: '10',
          },
        ],
      },
    ]);
    expect(Object.isFrozen(choices)).toBe(true);
    expect(JSON.stringify(proof)).toBe(before);
    expect(() =>
      npcFormalWeaverSourceChoices(catalog, {
        npcUuid: id(99),
        compositionProof: proof,
      }),
    ).toThrow();
    expect(() =>
      npcFormalWeaverSourceChoices(catalog, {
        npcUuid: id(1),
        compositionProof: proof,
        currentOE: 100,
      } as never),
    ).toThrow();
    expect(() => readNpcFormalWeaverRemaining(catalog, '0', 'REPLACEMENT_TEMPORARY')).toThrow(
      NpcFormalWeaverError,
    );
  });
  it('requires the real delivered source and preserves the ordinary SYM030 peaceful activation prohibition', () => {
    const form = sourceInput.npcInitialStateForm as Record<string, unknown>;
    expect(() =>
      createNpcFormalWeaverCatalog({
        ...sourceInput,
        npcInitialStateForm: { ...form, requiredFields: [] },
      }),
    ).toThrow('source delivery');
    expect(() =>
      createNpcFormalWeaverCatalog({
        ...sourceInput,
        npcInitialStateForm: { ...form, acceptanceCriteria: [] },
      }),
    ).toThrow('source clause');
    const contexts = sourceInput.abilityContexts as Record<string, unknown>[];
    expect(() =>
      createNpcFormalWeaverCatalog({
        ...sourceInput,
        abilityContexts: contexts.map((r) =>
          r.AbilityContextID === 'CTX-SYM-030-PEACE' ? { ...r, Allowed: true } : r,
        ),
      }),
    ).toThrow();
  });
  it.each([
    ['REPLACEMENT_TEMPORARY', '5'],
    ['REPLACEMENT_RECOVERY', '7'],
    ['DUPLICATED_ORGANS_PROTECTION', '10'],
  ] as const)(
    'binds %s to its explicit accepted maximum %s, without duration defaults',
    (branch, maximum) => {
      expect(npcFormalWeaverMaximumRemainingMinutes(catalog, branch)).toBe(maximum);
      expect(readNpcFormalWeaverRemaining(catalog, maximum, branch)).toBe(maximum);
      for (const invalid of [
        undefined,
        '0',
        '0.0',
        '01',
        '1.0',
        '1e0',
        '5\n',
        String(Number(maximum) + 1),
      ])
        expect(() => readNpcFormalWeaverRemaining(catalog, invalid, branch)).toThrow();
    },
  );
  it('issues exact fractional current time with immutable original anchors and no activation/R20/OE writes', () => {
    const history = anchor(),
      original = context(),
      before = JSON.stringify({ history, original });
    const first = deriveNpcFormalWeaverEffectContribution(catalog, history, original);
    const initial = readNpcFormalWeaverEffectContribution(first);
    expect(initial.effect).toMatchObject({
      remainingExact: '2.5',
      expiresAt: { campaignTimestampExact: '39.5' },
      sourceSnapshot: { currentOE: 0 },
      payload: { originalR20: null, assignedByGM: true },
    });
    const later = readNpcFormalWeaverEffectContribution(contribution(history, 38));
    expect(later.effect.remainingExact).toBe('1.5');
    expect(later.history).toEqual(history);
    expect(later.effect.expiresAt).toEqual(initial.effect.expiresAt);
    expect(
      readNpcFormalWeaverEffectContribution(
        validateNpcFormalWeaverEffectContribution(catalog, initial.effect, history, original),
      ).effect,
    ).toEqual(initial.effect);
    expect(() =>
      validateNpcFormalWeaverEffectContribution(catalog, initial.effect, history, context(38)),
    ).toThrow();
    expect(JSON.stringify({ history, original })).toBe(before);
    expect(() => readNpcFormalWeaverEffectContribution(structuredClone(first))).toThrow(
      'independently issued',
    );
    expect(() => readNpcFormalWeaverEffectContribution(initial)).toThrow('independently issued');
    expect(() =>
      deriveNpcFormalWeaverEffectContribution(
        catalog,
        { ...history, originalR20: 20 } as never,
        original,
      ),
    ).toThrow();
  });
  it('rejects exact expiry, missing current source and stale preparation without resolving or reactivating effects', () => {
    expect(() => contribution(anchor('REPLACEMENT_TEMPORARY', '5'), 42)).toThrow(
      'expired unresolved',
    );
    expect(() =>
      deriveNpcFormalWeaverEffectContribution(
        catalog,
        anchor(),
        context(37, composition(), composition(1)),
      ),
    ).toThrow('active learned');
    const h = anchor();
    expect(() =>
      deriveNpcFormalWeaverEffectContribution(catalog, h, {
        ...context(38),
        origin: {
          kind: 'PREPARED',
          preparationOperationId: h.sourceOperationId,
        },
      }),
    ).toThrow();
  });
  it('distinguishes current unavailability from corrupt original source, scope, token and backwards clock', () => {
    const h = anchor();
    const unavailable = [
      () => contribution(anchor('REPLACEMENT_TEMPORARY', '5'), 42),
      () =>
        deriveNpcFormalWeaverEffectContribution(
          catalog,
          h,
          context(37, composition(), composition(1)),
        ),
    ];
    for (const call of unavailable) expect(call).toThrow(NpcFormalWeaverCurrentUnavailableError);
    const hardErrors = [
      () =>
        deriveNpcFormalWeaverEffectContribution(
          catalog,
          h,
          context(37, composition(1), composition()),
        ),
      () =>
        deriveNpcFormalWeaverEffectContribution(
          catalog,
          h,
          context(36, composition(), composition(1)),
        ),
      () =>
        deriveNpcFormalWeaverEffectContribution(catalog, h, {
          ...context(),
          campaignId: id(99),
        }),
      () => deriveNpcFormalWeaverEffectContribution({} as NpcFormalWeaverCatalog, h, context()),
      () =>
        deriveNpcFormalWeaverEffectContribution(
          catalog,
          { ...h, remainingMinutes: '0' },
          context(),
        ),
    ];
    for (const call of hardErrors) {
      expect(call).toThrow();
      expect(call).not.toThrow(NpcFormalWeaverCurrentUnavailableError);
    }
  });
  it('never downgrades saved candidate integrity to a current-state blocker when its source is lost or time expired', () => {
    const h = anchor();
    const original = readNpcFormalWeaverEffectContribution(contribution(h)).effect;
    const candidates = [
      original,
      { ...original, payload: { ...original.payload, assignedByGM: false } },
      {
        ...original,
        sourceSnapshot: { ...original.sourceSnapshot, currentOE: 100 },
      },
    ];
    for (const candidate of candidates) {
      for (const unavailableContext of [context(37, composition(), composition(1)), context(40)]) {
        const call = () =>
          validateNpcFormalWeaverEffectContribution(catalog, candidate, h, unavailableContext);
        expect(call).toThrow('saved candidate requires a fully valid');
        expect(call).not.toThrow(NpcFormalWeaverCurrentUnavailableError);
      }
    }
    expect(
      readNpcFormalWeaverEffectContribution(
        validateNpcFormalWeaverEffectContribution(catalog, original, h, context()),
      ).effect,
    ).toEqual(original);
    expect(() =>
      validateNpcFormalWeaverEffectContribution(catalog, candidates[1], h, context()),
    ).toThrow();
  });
  it('keeps separate protection/replacement identities, enforces cardinality and binds actual campaign/time/whole composition', () => {
    const a = contribution(),
      b = contribution(anchor('DUPLICATED_ORGANS_PROTECTION', '7', 11));
    expect(() => assertNpcFormalWeaverContributionSet([a, b])).not.toThrow();
    expect(() => assertNpcFormalWeaverContributionSet([a, a])).toThrow('duplicate');
    expect(() =>
      assertNpcFormalWeaverContributionSet([
        a,
        contribution(anchor('REPLACEMENT_RECOVERY', '3', 12)),
      ]),
    ).toThrow('conflicting');
    expect(() => duplicate(a, 38)).toThrow();
    expect(() => duplicate(a, 37, id(99))).toThrow();
    const d = duplicate(a);
    expect(readNpcFunctionalDuplicateProof(d).sources[0]).toMatchObject({
      sourceRuleId: 'SYM-028',
      effectOriginOrNull: {
        campaignId: id(20),
        kind: 'COMMITTED',
        originCommitOperationId: id(30),
        deadlineExact: '39.5',
      },
    });
    expect(readNpcFunctionalDuplicateRequiredDeathDeadline(d)).toBeNull();
  });
  it('accepts equal exact recovery/death deadlines and rejects a fractional shorter timer without extension', () => {
    const entry = duplicate(contribution(anchor('REPLACEMENT_RECOVERY', '3.25')));
    expect(readNpcFunctionalDuplicateRequiredDeathDeadline(entry)).toBe('40.25');
    const proof = life(entry, '3.25'),
      before = JSON.stringify(proof);
    const state = createNpcFormalLifeState(source.formalLife, proof, lifeContext(), entry);
    expect(state.deathTimerOrNull?.expiresAt.campaignTimestampExact).toBe('40.25');
    expect(state.deathTimerOrNull?.payload.duplicateMultiplierAtEntry).toBe(4);
    expect(
      previewNpcFormalLifeTimerBasis(source.formalLife, proof, lifeContext(), entry, entry),
    ).toMatchObject({
      kind: 'PROVISIONAL_FORMAL_LIFE_TIMER',
      deadlineExact: '40.25',
      requiredRecoveryDeadlineOrNull: '40.25',
      recoveryFits: true,
    });
    const provisional = previewNpcFormalLifeTimerBasis(
      source.formalLife,
      life(entry, '3.249'),
      lifeContext(),
      entry,
      entry,
    );
    expect(provisional).toMatchObject({
      deadlineExact: '40.249',
      requiredRecoveryDeadlineOrNull: '40.25',
      recoveryFits: false,
    });
    expect(() => readNpcFormalLifeBoundary(provisional)).toThrow();
    expect(() =>
      createNpcFormalLifeState(source.formalLife, life(entry, '3.249'), lifeContext(), entry),
    ).toThrow();
    const next = {
      ...anchor('REPLACEMENT_RECOVERY', '4', 12),
      calendarAnchor: { ...anchor().calendarAnchor, campaignTimestamp: 38 },
    };
    const current = duplicate(
      deriveNpcFormalWeaverEffectContribution(catalog, next, {
        ...context(38),
        origin: { kind: 'COMMITTED', originCommitOperationId: id(31) },
      }),
      38,
    );
    expect(
      previewNpcFormalLifeTimerBasis(source.formalLife, proof, lifeContext(38), entry, current),
    ).toMatchObject({
      deadlineExact: '40.25',
      remainingExact: '2.25',
      requiredRecoveryDeadlineOrNull: '42',
      recoveryFits: false,
    });
    expect(() =>
      deriveNpcRetainedFormalLifeState(source.formalLife, proof, lifeContext(38), entry, current),
    ).toThrow();
    expect(JSON.stringify(proof)).toBe(before);
    expect(() =>
      createNpcFormalLifeState(
        source.formalLife,
        { ...proof, campaignId: id(99) },
        { ...lifeContext(), campaignId: id(99) },
        entry,
      ),
    ).toThrow();
    const foreignHistory = {
      ...anchor('REPLACEMENT_RECOVERY', '3.25'),
      campaignId: id(99),
    };
    const foreignEffect = deriveNpcFormalWeaverEffectContribution(catalog, foreignHistory, {
      ...context(),
      campaignId: id(99),
    });
    const foreignEntry = duplicate(foreignEffect, 37, id(99));
    const currentEmpty = deriveNpcFunctionalDuplicateProof(source.functionalDuplicate, {
      npcUuid: id(1),
      campaignTimestamp: 38,
      compositionProof: composition(),
      temporaryEffects: [],
    });
    expect(() =>
      deriveNpcRetainedFormalLifeState(
        source.formalLife,
        life(foreignEntry, '3.25'),
        lifeContext(38),
        foreignEntry,
        currentEmpty,
      ),
    ).toThrow();
  });
  it('never promotes a source/time contribution to an ALIVE replacement and allows explicit unused protection', () => {
    const make = (branch: NpcFormalWeaverBranch): NpcHumanoidLifePreview => {
      const h = anchor(branch);
      return {
        kind: 'PREPARED',
        sourceOperationId: id(40),
        campaignId: id(20),
        npcUuid: id(1),
        campaignTimestampOrNull: 37,
        history: {
          kind: 'GM_FORMAL_INITIAL_LIFE',
          campaignId: id(20),
          npcUuid: id(1),
          lifeKind: 'ALIVE',
          initialStateConfirmationId: id(40),
          reason: 'Жив',
          createdAt: h.createdAt,
          severeWoundOrNull: null,
        },
        entryDuplicateProofOrNull: null,
        previousLifeKindOrNull: null,
        temporaryWeaverEffects: [
          {
            history: h,
            originalCompositionProof: composition(),
            origin: {
              kind: 'PREPARED',
              preparationOperationId: h.sourceOperationId,
            },
          },
        ],
      };
    };
    const catalogs = {
      formalLife: source.formalLife,
      functionalDuplicate: source.functionalDuplicate,
      formalWeaver: catalog,
    };
    const input = {
      npcUuid: id(1),
      compositionProof: composition(),
      currentHP: 70,
    };
    expect(() =>
      previewNpcHumanoidLifeBoundary(catalogs, {
        ...input,
        context: make('REPLACEMENT_TEMPORARY'),
      }),
    ).toThrow('replacement requires');
    const result = readNpcHumanoidLifeBoundary(
      previewNpcHumanoidLifeBoundary(catalogs, {
        ...input,
        context: make('DUPLICATED_ORGANS_PROTECTION'),
      }),
    );
    expect(result.state.lifeKind).toBe('ALIVE');
    expect(result.temporaryWeaverEffects[0]?.payload.protection).toBe('UNCONSUMED_CORE_182');
    expect(result.temporaryWeaverEffects[0]?.payload.originalR20).toBeNull();
  });
});
