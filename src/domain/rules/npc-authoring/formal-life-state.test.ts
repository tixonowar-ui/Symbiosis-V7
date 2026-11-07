import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import type { NpcCompositionConsequenceProof } from './composition-consequence-types.js';
import {
  createNpcFunctionalDuplicateCatalog,
  deriveNpcFunctionalDuplicateProof,
  readNpcFunctionalDuplicateProof,
  type NpcFunctionalDuplicateCatalog,
} from './functional-duplicate-composition.js';
import {
  createNpcFormalLifeCatalog,
  createNpcFormalLifeState,
  validateNpcFormalLifeState,
  deriveNpcRetainedFormalLifeState,
  readNpcFormalLifeBoundary,
  assertNpcFormalLifeTransition,
  npcFormalLifeMaximumRemainingMinutes,
  previewNpcFormalLifeTimerBasis,
  NpcFormalLifeTimerDisplayUnavailableError,
  type NpcFormalLifeCatalog,
  type NpcFormalLifeHistoryAnchor,
} from './formal-life-state.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let sources: NpcAuthoringSourceCatalog,
  catalog: NpcFormalLifeCatalog,
  duplicates: NpcFunctionalDuplicateCatalog;
let sourceInput: Parameters<typeof createNpcFormalLifeCatalog>[0];
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const json = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(`${root}/generated/spec/${file}.json`, 'utf8')) as unknown;
  sources = await loadNpcAuthoringSourceCatalog(root);
  const rules = await json('rules/rules');
  sourceInput = {
    rules,
    effectTypes: await json('effects/effect-types'),
    timerPolicies: await json('effects/timer-policies'),
    capabilityProfiles: await json('effects/capability-profiles'),
    gaps: await json('effects/gaps'),
    runtimeContracts: await json('effects/runtime-contracts'),
  };
  catalog = createNpcFormalLifeCatalog(sourceInput);
  duplicates = createNpcFunctionalDuplicateCatalog({
    compositionConsequences: sources.compositionConsequences,
    rules,
    developmentNodes: await json('character/development-nodes'),
  });
});
function composition(chimera: boolean): NpcCompositionConsequenceProof {
  if (!chimera)
    return {
      identityKey: id(2),
      binding: { journalId: id(3), raceCode: 'UNITED' },
      resolutions: [],
      confirmations: [],
    };
  return {
    identityKey: id(2),
    binding: { journalId: id(3), raceCode: 'UNITED' },
    resolutions: [],
    confirmations: [
      {
        confirmationCommandId: id(4),
        diceModeSnapshot: 'MANUAL',
        input: {
          kind: 'APPLY_COMPOSITION_EDIT',
          factId: id(5),
          journalId: id(3),
          ordinal: 1,
          raceCode: 'UNITED',
          removals: [],
          buildChanges: [],
          currentOeChanges: [],
          additions: chimera
            ? [
                {
                  symbiontInstanceId: id(6),
                  speciesKey: 'CHIMERA',
                  targetLevel: 2,
                  currentOE: 0,
                  binding: { kind: 'NONE' },
                  learnedNodeRefs: sources.development.nodes
                    .filter((n) => n.speciesKey === 'CHIMERA' && n.level <= 2)
                    .map((n) => n.nodeRef),
                },
              ]
            : [],
        },
      },
    ],
  };
}
function duplicate(chimera = false, minute = 37, removed = false) {
  const proof = composition(chimera);
  const actual: NpcCompositionConsequenceProof = removed
    ? {
        ...proof,
        confirmations: [
          ...proof.confirmations,
          {
            confirmationCommandId: id(7),
            diceModeSnapshot: 'MANUAL',
            input: {
              kind: 'APPLY_COMPOSITION_EDIT',
              factId: id(8),
              journalId: id(3),
              ordinal: 2,
              raceCode: 'UNITED',
              removals: [id(6)],
              additions: [],
              buildChanges: [],
              currentOeChanges: [],
            },
          },
        ],
      }
    : proof;
  return deriveNpcFunctionalDuplicateProof(duplicates, {
    npcUuid: id(2),
    campaignTimestamp: minute,
    compositionProof: actual,
    temporaryEffects: [],
  });
}
function anchor(chimera = false, remaining = '6.125') {
  const entry = duplicate(chimera);
  const proof: NpcFormalLifeHistoryAnchor = {
    kind: 'GM_FORMAL_INITIAL_LIFE',
    campaignId: id(1),
    npcUuid: id(2),
    lifeKind: 'SEVERELY_WOUNDED',
    initialStateConfirmationId: id(9),
    reason: 'Текущее тяжёлое ранение',
    createdAt: '2026-11-06T12:00:00.000Z',
    severeWoundOrNull: {
      effectInstanceId: id(10),
      calendarAnchor: {
        kind: 'PRE_START_INITIAL',
        campaignTimestamp: 37,
        lobbySnapshotRevision: 'a'.repeat(64),
      },
      rollFact: { factId: id(11), sourceRuleId: 'CORE-153', roll: { dieSides: 6, rawFace: 3 } },
      remainingMinutes: remaining,
      duplicateAtEntry: readNpcFunctionalDuplicateProof(entry),
    },
  };
  return { entry, proof };
}
const context = (hp = 0, minute: number | null = 37) => ({
  campaignId: id(1),
  npcUuid: id(2),
  currentHP: hp,
  campaignTimestampOrNull: minute,
});
describe('NPC016 accepted formal life state and original death timer', () => {
  it('shows an exact provisional timer from actual history without issuing a life boundary', () => {
    const { entry, proof } = anchor();
    const before = JSON.stringify(proof);
    const display = previewNpcFormalLifeTimerBasis(
      catalog,
      proof,
      context(0, 38),
      entry,
      duplicate(false, 38),
    );
    expect(display).toEqual({
      kind: 'PROVISIONAL_FORMAL_LIFE_TIMER',
      startsAtExact: '37',
      deadlineExact: '43.125',
      remainingExact: '5.125',
      requiredRecoveryDeadlineOrNull: null,
      recoveryFits: true,
    });
    expect(() => readNpcFormalLifeBoundary(display)).toThrow('issued life boundary');
    expect(() => readNpcFormalLifeBoundary(structuredClone(display))).toThrow();
    expect(JSON.stringify(proof)).toBe(before);
  });
  it('keeps provisional display subject to actual source, original roll, scope and positive time', () => {
    const { entry, proof } = anchor();
    for (const invalidContext of [
      context(1),
      context(0, null),
      context(0, 36),
      context(0, 44),
      { ...context(), campaignId: id(90) },
      { ...context(), npcUuid: id(90) },
    ])
      expect(() =>
        previewNpcFormalLifeTimerBasis(catalog, proof, invalidContext, entry, entry),
      ).toThrow();
    expect(() =>
      previewNpcFormalLifeTimerBasis(catalog, proof, context(), structuredClone(entry), entry),
    ).toThrow();
    expect(() =>
      previewNpcFormalLifeTimerBasis(catalog, proof, context(), entry, structuredClone(entry)),
    ).toThrow();
    expect(() =>
      previewNpcFormalLifeTimerBasis(catalog, proof, context(0, 36), entry, duplicate(false, 36)),
    ).toThrow('outside the independently preserved positive timer');
    expect(() =>
      previewNpcFormalLifeTimerBasis(
        catalog,
        {
          ...proof,
          severeWoundOrNull: {
            ...proof.severeWoundOrNull!,
            rollFact: {
              ...proof.severeWoundOrNull!.rollFact,
              roll: { dieSides: 6, rawFace: 7 },
            },
          },
        },
        context(),
        entry,
        entry,
      ),
    ).toThrow();
  });
  it('exposes only proven current display expiry as unavailable while preserving hard integrity errors', () => {
    const { entry, proof } = anchor(false, '6'),
      current = duplicate(false, 43);
    expect(() =>
      previewNpcFormalLifeTimerBasis(catalog, proof, context(0, 43), entry, current),
    ).toThrow(NpcFormalLifeTimerDisplayUnavailableError);
    const errors = [
      () =>
        previewNpcFormalLifeTimerBasis(
          catalog,
          proof,
          { ...context(0, 43), campaignId: id(90) },
          entry,
          current,
        ),
      () =>
        previewNpcFormalLifeTimerBasis(
          catalog,
          proof,
          context(0, 43),
          structuredClone(entry),
          current,
        ),
      () =>
        previewNpcFormalLifeTimerBasis(
          catalog,
          proof,
          context(0, 43),
          entry,
          structuredClone(current),
        ),
      () =>
        previewNpcFormalLifeTimerBasis(
          catalog,
          { ...proof, reason: '' },
          context(0, 43),
          entry,
          current,
        ),
      () =>
        previewNpcFormalLifeTimerBasis(
          catalog,
          {
            ...proof,
            severeWoundOrNull: {
              ...proof.severeWoundOrNull!,
              rollFact: { ...proof.severeWoundOrNull!.rollFact, sourceRuleId: 'SYM-028' },
            },
          },
          context(0, 43),
          entry,
          current,
        ),
      () => deriveNpcRetainedFormalLifeState(catalog, proof, context(0, 43), entry, current),
    ];
    for (const run of errors) {
      let caught: unknown;
      try {
        run();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(NpcFormalLifeTimerDisplayUnavailableError);
    }
  });
  it('preflights the exact permitted maximum from actual D6 and issued duplicate without a future identity', () => {
    const { entry, proof } = anchor();
    const fact = proof.severeWoundOrNull!.rollFact;
    expect(npcFormalLifeMaximumRemainingMinutes(catalog, fact, entry)).toBe('15');
    expect(npcFormalLifeMaximumRemainingMinutes(catalog, fact, duplicate(true))).toBe('60');
    expect(() =>
      npcFormalLifeMaximumRemainingMinutes(catalog, fact, structuredClone(entry)),
    ).toThrow();
    expect(() =>
      npcFormalLifeMaximumRemainingMinutes(catalog, { ...fact, sourceRuleId: 'SYM-028' }, entry),
    ).toThrow();
    expect(() =>
      npcFormalLifeMaximumRemainingMinutes(
        catalog,
        { ...fact, roll: { dieSides: 6, rawFace: 7 } },
        entry,
      ),
    ).toThrow();
  });
  it('preserves a real D6 and exact chosen remainder without damage, protection use, organ or a creation tick', () => {
    const { entry, proof } = anchor(),
      saved = createNpcFormalLifeState(catalog, proof, context(), entry);
    expect(saved.lifeKind).toBe('SEVERELY_WOUNDED');
    if (saved.lifeKind !== 'SEVERELY_WOUNDED') throw Error('Expected severe');
    expect(saved.abstractVitalSystemDamaged).toBe(true);
    expect(saved.deathTimerOrNull).toMatchObject({
      effectInstanceId: id(10),
      sourceEntityId: null,
      sourceInstanceId: null,
      sourceSnapshot: null,
      payload: {
        assignedByGM: true,
        rollFact: proof.severeWoundOrNull!.rollFact,
        duplicateMultiplierAtEntry: 1,
      },
      startsAt: { campaignTimestampExact: '37' },
      expiresAt: { campaignTimestampExact: '43.125' },
      remainingExact: '6.125',
      lastTickAt: null,
      tickSchedule: null,
    });
    expect(saved.restrictionOrNull).toMatchObject({
      profileId: 'PRF-SEVERE-PC',
      physicalActions: 'NO_BY_DEFAULT',
      reactions: 'NO',
    });
    for (const key of ['organId', 'damage', 'spentOE', 'protectionConsumed', 'combatId', 'turnId'])
      expect(Object.hasOwn(saved, key)).toBe(false);
    const restored: unknown = JSON.parse(JSON.stringify(saved));
    expect(validateNpcFormalLifeState(catalog, restored, proof, context(), entry, entry)).toEqual(
      saved,
    );
    expect(readNpcFormalLifeBoundary(saved).state).toBe(saved);
    expect(() => readNpcFormalLifeBoundary(restored)).toThrow('issued');
  });
  it.each([
    ['0', false],
    ['0.00000000000000001', true],
    ['15', true],
    ['15.00000000000000001', false],
    ['01', false],
    ['1.0', false],
    ['1e1', false],
    ['5\n', false],
    ['', false],
  ] as const)('checks exact remainder %s against the actual D6 boundary', (remaining, valid) => {
    const { entry, proof } = anchor(false, remaining);
    const run = () => createNpcFormalLifeState(catalog, proof, context(), entry);
    if (valid) expect(run).not.toThrow();
    else expect(run).toThrow();
    expect(proof.severeWoundOrNull!.rollFact.roll.rawFace).toBe(3);
  });
  it('keeps original x4 and deadline after actual removal, but loses its current permission to act', () => {
    const { entry, proof } = anchor(true, '60'),
      original = createNpcFormalLifeState(catalog, proof, context(), entry),
      bytes = JSON.stringify(original);
    const next = deriveNpcRetainedFormalLifeState(
      catalog,
      proof,
      context(0, 40),
      entry,
      duplicate(true, 40, true),
    );
    expect(next.deathTimerOrNull).toMatchObject({
      expiresAt: { campaignTimestampExact: '97' },
      remainingExact: '57',
      payload: { duplicateMultiplierAtEntry: 4 },
    });
    expect(next.restrictionOrNull?.profileId).toBe('PRF-SEVERE-PC');
    expect(original.restrictionOrNull?.profileId).toBe('PRF-SEVERE-DUPLICATE');
    expect(JSON.stringify(original)).toBe(bytes);
    expect(next.anchor).toEqual(original.anchor);
    expect(readNpcFormalLifeBoundary(next).currentDuplicateSnapshotOrNull?.sources).toEqual([]);
  });
  it('does not grant a past multiplier from a new current duplicate or rebase a retained deadline', () => {
    const { entry, proof } = anchor(false, '15');
    const next = deriveNpcRetainedFormalLifeState(
      catalog,
      proof,
      context(0, 38),
      entry,
      duplicate(true, 38),
    );
    expect(next.deathTimerOrNull).toMatchObject({
      expiresAt: { campaignTimestampExact: '52' },
      remainingExact: '14',
      payload: { duplicateMultiplierAtEntry: 1 },
    });
    expect(() => createNpcFormalLifeState(catalog, proof, context(0, 38), entry)).toThrow();
    expect(() =>
      createNpcFormalLifeState(
        catalog,
        {
          ...proof,
          severeWoundOrNull: {
            ...proof.severeWoundOrNull!,
            duplicateAtEntry: readNpcFunctionalDuplicateProof(duplicate(true)),
          },
        },
        context(),
        entry,
      ),
    ).toThrow();
  });
  it.each([52, 53])(
    'refuses an already expired severe timer at minute %i without synthesizing death',
    (minute) => {
      const { entry, proof } = anchor(false, '15');
      expect(() =>
        deriveNpcRetainedFormalLifeState(
          catalog,
          proof,
          context(0, minute),
          entry,
          duplicate(false, minute),
        ),
      ).toThrow('positive timer');
      expect(proof.lifeKind).toBe('SEVERELY_WOUNDED');
    },
  );
  it('has explicit untimed ALIVE/DEAD states without new roll or clock', () => {
    const { proof } = anchor();
    for (const lifeKind of ['ALIVE', 'DEAD'] as const) {
      const input = { ...proof, lifeKind, severeWoundOrNull: null };
      const saved = createNpcFormalLifeState(
        catalog,
        input,
        context(lifeKind === 'ALIVE' ? 7 : 0, null),
        null,
      );
      expect(saved.deathTimerOrNull).toBeNull();
      expect(saved.dead).toBe(lifeKind === 'DEAD');
      if (lifeKind === 'DEAD') {
        expect(saved.restrictionOrNull).toMatchObject({
          physicalActions: 'NO',
          mentalActions: 'NO',
          controller: 'NONE',
        });
        expect(Object.hasOwn(saved, 'abstractVitalSystemDamaged')).toBe(false);
      }
      expect(() =>
        createNpcFormalLifeState(catalog, input, context(lifeKind === 'ALIVE' ? 0 : 1, null), null),
      ).toThrow();
    }
  });
  it.each([
    ['DEAD', 'ALIVE'],
    ['DEAD', 'SEVERELY_WOUNDED'],
    ['SEVERELY_WOUNDED', 'ALIVE'],
  ] as const)('refuses ordinary %s -> %s', (before, after) => {
    expect(() => assertNpcFormalLifeTransition(catalog, before, after)).toThrow('cannot revive');
  });
  it('rejects foreign context, cloned duplicate proof, changed independent origin and invented extra fields', () => {
    const { entry, proof } = anchor(),
      saved = createNpcFormalLifeState(catalog, proof, context(), entry);
    expect(() =>
      createNpcFormalLifeState(catalog, proof, { ...context(), npcUuid: id(98) }, entry),
    ).toThrow();
    expect(() =>
      createNpcFormalLifeState(catalog, proof, { ...context(), campaignId: id(98) }, entry),
    ).toThrow();
    expect(() =>
      createNpcFormalLifeState(catalog, proof, context(), structuredClone(entry)),
    ).toThrow('issued');
    expect(() =>
      validateNpcFormalLifeState(
        catalog,
        saved,
        { ...proof, initialStateConfirmationId: id(99) },
        context(),
        entry,
        entry,
      ),
    ).toThrow();
    expect(() =>
      createNpcFormalLifeState(
        catalog,
        { ...proof, previousDuplicate: true } as never,
        context(),
        entry,
      ),
    ).toThrow();
    expect(() =>
      createNpcFormalLifeState({} as NpcFormalLifeCatalog, proof, context(), entry),
    ).toThrow('issued');
  });
  it('rejects changed source restrictions and missing source precision rules', () => {
    const changed = structuredClone(sourceInput),
      profiles = changed.capabilityProfiles as Record<string, unknown>[];
    profiles.find((p) => p.ProfileID === 'PRF-DEAD')!['Физические действия'] = 'YES';
    expect(() => createNpcFormalLifeCatalog(changed)).toThrow();
    const missing = structuredClone(sourceInput);
    const timerPolicies = (missing.timerPolicies as Record<string, unknown>[]).filter(
      (p) => p.PolicyID !== 'TIME-008',
    );
    expect(() => createNpcFormalLifeCatalog({ ...missing, timerPolicies })).toThrow();
  });
});
