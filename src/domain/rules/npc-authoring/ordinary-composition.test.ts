import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import {
  applyNpcOrdinaryCompositionFact as apply,
  createNpcOrdinaryComposition,
  readNpcOrdinaryComposition as read,
  restoreNpcOrdinaryComposition,
  previewNpcOrdinaryCompositionEdit,
  readNpcOrdinaryCompositionFact,
} from './ordinary-composition.js';
import type { NpcOrdinaryCompositionFact } from './ordinary-composition-types.js';
import type { NpcSymbiontInput } from './types.js';

let catalog: NpcAuthoringSourceCatalog;
beforeAll(async () => {
  catalog = await loadNpcAuthoringSourceCatalog(
    fileURLToPath(new URL('../../../../', import.meta.url)),
  );
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = { journalId: id(999), raceCode: 'UNITED' as const };
const start = () => createNpcOrdinaryComposition(catalog.ordinaryComposition, binding);
function specimen(
  speciesKey: string,
  identity: number,
  currentOE: number,
  targetLevel = 1,
): NpcSymbiontInput {
  const source = catalog.symbionts.species.find((row) => row.speciesKey === speciesKey);
  if (source === undefined) throw new Error(`Unknown source species ${speciesKey}`);
  const kind = source.bindingPolicy;
  return {
    symbiontInstanceId: id(identity),
    speciesKey: source.speciesKey,
    currentOE,
    targetLevel,
    learnedNodeRefs: catalog.development.nodes
      .filter((row) => row.speciesKey === speciesKey && row.level <= targetLevel)
      .map((row) => row.nodeRef),
    binding: kind === 'OWL_EYE' || kind === 'EEL_ARM' ? { kind, side: 'LEFT' } : { kind },
  };
}
function fact(
  ordinal: number,
  changes: Partial<
    Pick<
      NpcOrdinaryCompositionFact,
      'raceCode' | 'additions' | 'removals' | 'buildChanges' | 'currentOeChanges'
    >
  >,
): NpcOrdinaryCompositionFact {
  return {
    kind: 'APPLY_COMPOSITION_EDIT',
    factId: id(100 + ordinal),
    journalId: binding.journalId,
    ordinal,
    raceCode: 'UNITED',
    additions: [],
    removals: [],
    buildChanges: [],
    currentOeChanges: [],
    ...changes,
  };
}

describe('NPC-013 source-backed ordinary composition', () => {
  it('confirms each closed initial monster with explicit zero OE and exact restart/replay', () => {
    for (const key of ['CHIMERA', 'PUPPETEER', 'PLAGUE_DOCTOR']) {
      const input = fact(1, { additions: [specimen(key, 80, 0)] });
      const first = apply(start(), input);
      const view = read(first.state);
      expect(view.kind).toBe('INITIAL_MONSTER_STRUCTURAL_COMPOSITION_ONLY');
      expect(view.occupiedSlots).toBe(4);
      expect(view.confirmedSlotCapacity).toBe(4);
      expect(view.pendingRequirements).toEqual([]);
      expect(view.instances[0]).toMatchObject({
        currentOE: 0,
        nativeMaxOE: 400,
        effectsEnabled: true,
      });
      expect(apply(first.state, input)).toEqual({ state: first.state, receipt: first.receipt });
      const restored = restoreNpcOrdinaryComposition(catalog.ordinaryComposition, binding, [input]);
      expect(read(restored)).toEqual(view);
      expect(() => apply(first.state, { ...input, raceCode: 'FREE' })).toThrow('changed fact');
    }
  });
  it('rejects inferred extra slots, multiple monsters and foreign race without writing a receipt', () => {
    const state = start();
    const initial = read(state);
    for (const key of ['CHIMERA', 'PUPPETEER', 'PLAGUE_DOCTOR']) {
      expect(() =>
        apply(
          state,
          fact(1, {
            additions: [specimen(key, 80, 0), specimen('ARMADILLO', 81, 0)],
          }),
        ),
      ).toThrow('no confirmed additional slots');
      expect(() =>
        apply(
          state,
          fact(1, {
            raceCode: 'FREE',
            additions: [specimen(key, 80, 0)],
          }),
        ),
      ).toThrow('UNITED');
      expect(() =>
        apply(
          state,
          fact(1, {
            additions: [specimen(key, 80, 401)],
          }),
        ),
      ).toThrow();
    }
    expect(() =>
      apply(
        state,
        fact(1, {
          additions: [specimen('CHIMERA', 80, 0), specimen('PUPPETEER', 81, 0)],
        }),
      ),
    ).toThrow('one symbiotic monster');
    expect(read(state)).toBe(initial);
  });
  it('previews actual absorption/level consequences without minting a fact, receipt or state', () => {
    const state = start(),
      before = read(state);
    const input = fact(1, {
      additions: [specimen('TROGR', 1, 0), specimen('DOLPHIN', 2, 0), specimen('TEACHER', 3, 0)],
    });
    const { factId: _id, ordinal: _ordinal, journalId: _journal, kind: _kind, ...edit } = input;
    const preview = previewNpcOrdinaryCompositionEdit(state, edit);
    expect(Object.keys(preview).sort()).toEqual([
      'consequences',
      'instances',
      'kind',
      'occupiedSlots',
      'requiredSourceContinuations',
      'sourceSlotCapacity',
    ]);
    expect(preview.kind).toBe('UNCOMMITTED');
    expect(read(state)).toBe(before);
    expect(preview.instances.every((i) => !Object.hasOwn(i, 'acquisitionFactId'))).toBe(true);
    expect(
      preview.requiredSourceContinuations.every((r) => !Object.hasOwn(r, 'causedByFactId')),
    ).toBe(true);
    const committed = apply(state, input);
    expect(preview.consequences).toEqual(committed.receipt.consequences);
    expect(preview.instances).toEqual(
      read(committed.state).instances.map(({ acquisitionFactId: _fact, ...row }) => row),
    );
    expect(previewNpcOrdinaryCompositionEdit(state, edit)).toEqual(preview);
    expect(apply(committed.state, input).state).toBe(committed.state);
    expect(() => previewNpcOrdinaryCompositionEdit(state, input)).toThrow('fields');
  });
  it('closed structural reader is not a catalog validator and preview keeps original no-op state', () => {
    const input = fact(1, { additions: [specimen('OWL', 1, 0)] });
    const hostile = {
      ...input,
      additions: [{ ...input.additions[0], speciesKey: 'NOT_A_SOURCE_SPECIES' }],
    };
    expect(readNpcOrdinaryCompositionFact(hostile).additions[0]?.speciesKey).toBe(
      'NOT_A_SOURCE_SPECIES',
    );
    expect(() => apply(start(), hostile)).toThrow();
    let reads = 0;
    expect(() =>
      readNpcOrdinaryCompositionFact({
        ...input,
        additions: [
          {
            ...input.additions[0],
            binding: {
              kind: 'OWL_EYE',
              get side() {
                reads++;
                return 'LEFT';
              },
            },
          },
        ],
      }),
    ).toThrow('binding');
    expect(reads).toBe(0);
    const state = start(),
      before = read(state);
    expect(
      previewNpcOrdinaryCompositionEdit(state, {
        raceCode: 'UNITED',
        removals: [],
        additions: [],
        buildChanges: [],
        currentOeChanges: [],
      }),
    ).toMatchObject({
      kind: 'UNCOMMITTED',
      instances: [],
      consequences: [],
      requiredSourceContinuations: [],
    });
    expect(read(state)).toBe(before);
    expect(() => apply(state, fact(1, {}))).toThrow('empty edit');
  });
  it('keeps empty slots and every ordinary source species without importing PC starting-count rules', () => {
    expect(read(start()).instances).toEqual([]);
    const ordinary = catalog.symbionts.species.filter((row) => row.kind === 'ORDINARY');
    expect(ordinary).toHaveLength(20);
    for (const source of ordinary) {
      const input = specimen(source.speciesKey, 1, 0);
      const { state } = apply(start(), fact(1, { additions: [input] }));
      expect(read(state).instances[0]).toMatchObject({
        speciesKey: source.speciesKey,
        currentOE: 0,
        nativeMaxOE: source.initialCurrentOe,
      });
    }
  });
  it('AQ2-017 resolves a real duel before rejecting a candidate at full capacity', () => {
    const first = apply(
      start(),
      fact(1, {
        additions: [
          specimen('TROGR', 1, 7),
          specimen('WEAVER', 2, 7),
          specimen('OWL', 3, 7),
          specimen('RAT', 4, 7),
        ],
      }),
    ).state;
    const next = apply(first, fact(2, { additions: [specimen('KEEPER', 5, 10)] }));
    expect(read(next.state).occupiedSlots).toBe(4);
    expect(
      read(next.state).instances.find((row) => row.symbiontInstanceId === id(1)),
    ).toMatchObject({ status: 'DESTROYED', slotCost: 0 });
    expect(
      read(next.state).instances.find((row) => row.symbiontInstanceId === id(5)),
    ).toMatchObject({ status: 'ACTIVE', currentOE: 3 });
    expect(next.receipt.consequences).toContainEqual({
      kind: 'CURRENT_OE_DUEL',
      trogrInstanceId: id(1),
      keeperInstanceId: id(5),
      trogrCurrentOeBefore: 7,
      keeperCurrentOeBefore: 10,
      outcome: 'TROGR_DESTROYED',
      winnerCurrentOeAfterOrNull: 3,
    });
    expect(read(first).instances.find((row) => row.symbiontInstanceId === id(1))?.status).toBe(
      'ACTIVE',
    );
  });
  it('SYM-075 preserves a tie and resolves a later confirmed OE change without refill', () => {
    const first = apply(
      start(),
      fact(1, { additions: [specimen('TROGR', 1, 7), specimen('KEEPER', 2, 7)] }),
    ).state;
    expect(read(first).occupiedSlots).toBe(2);
    const second = apply(
      first,
      fact(2, { currentOeChanges: [{ symbiontInstanceId: id(1), currentOE: 6 }] }),
    ).state;
    expect(read(second).instances.find((row) => row.symbiontInstanceId === id(2))).toMatchObject({
      status: 'ACTIVE',
      currentOE: 1,
    });
  });
  it('SYM-076/185 grants Dolphin nodes once and retains absorbed tombstones after Trogr removal', () => {
    const initial = fact(1, {
      additions: [specimen('TROGR', 1, 7), specimen('TEACHER', 2, 7), specimen('DOLPHIN', 3, 7)],
    });
    const first = apply(start(), initial);
    expect(read(first.state).occupiedSlots).toBe(3);
    const trogr = read(first.state).instances.find((row) => row.symbiontInstanceId === id(1));
    expect(trogr).toMatchObject({
      targetLevel: 5,
      currentOE: 7,
      slotCost: 3,
      absorbedSpeciesKeys: ['TEACHER', 'DOLPHIN'],
    });
    for (const node of catalog.development.nodes.filter(
      (row) => row.speciesKey === 'TROGR' && row.level >= 2 && row.level <= 5,
    ))
      expect(trogr?.learnedNodeRefs).toContain(node.nodeRef);
    const second = apply(first.state, fact(2, { removals: [id(1)] })).state;
    expect(read(second).occupiedSlots).toBe(0);
    expect(
      read(second)
        .instances.filter((row) => row.status === 'ABSORBED')
        .map((row) => row.symbiontInstanceId),
    ).toEqual([id(2), id(3)]);
    expect(read(second).pendingRequirements.some((row) => row.kind === 'GROSS_SKILL_GRANT')).toBe(
      true,
    );
    const replay = apply(second, initial);
    expect(replay.state).toBe(second);
    expect(replay.receipt).toBe(first.receipt);
  });
  it('suppresses learned Double Focus only and releases the same instance after Owl removal', () => {
    const chameleon = specimen('CHAMELEON', 1, 7, 3);
    const first = apply(start(), fact(1, { additions: [chameleon, specimen('OWL', 2, 7)] })).state;
    expect(read(first).instances[0]).toMatchObject({
      symbiontInstanceId: id(1),
      status: 'ACTIVE',
      effectsEnabled: true,
      suppressedAbilities: ['DOUBLE_FOCUS'],
    });
    const second = apply(first, fact(2, { removals: [id(2)] })).state;
    expect(read(second).instances[0]).toMatchObject({
      symbiontInstanceId: id(1),
      learnedNodeRefs: chameleon.learnedNodeRefs,
      suppressedAbilities: [],
    });
    const levelTwo = apply(
      start(),
      fact(1, { additions: [specimen('CHAMELEON', 1, 7, 2), specimen('OWL', 2, 7)] }),
    ).state;
    expect(read(levelTwo).instances[0]?.suppressedAbilities).toEqual([]);
  });
  it('keeps a FREE extra-slot obligation after removal instead of inventing an R6 result', () => {
    const free = createNpcOrdinaryComposition(catalog.ordinaryComposition, {
      ...binding,
      raceCode: 'FREE',
    });
    const first = apply(
      free,
      fact(1, { raceCode: 'FREE', additions: [specimen('OWL', 1, 7), specimen('RAT', 2, 7)] }),
    ).state;
    expect(read(first)).toMatchObject({
      confirmedSlotCapacity: 1,
      occupiedSlots: 2,
      completion: 'PENDING_REQUIRED_FACTS',
    });
    const requirement = read(first).pendingRequirements.find(
      (row) => row.kind === 'FREE_EXTRA_SLOT_ROLL_AND_STAT_CONSEQUENCE',
    );
    expect(requirement).toEqual({
      kind: 'FREE_EXTRA_SLOT_ROLL_AND_STAT_CONSEQUENCE',
      causedByFactId: id(101),
      sourceRuleIds: ['AQ2-015'],
    });
    const second = apply(first, fact(2, { raceCode: 'FREE', removals: [id(2)] })).state;
    expect(read(second).pendingRequirements).toContainEqual(requirement);
  });
  it('rejects changed/foreign/stale requests and accessor input without mutating the saved state', () => {
    const initial = fact(1, { additions: [specimen('OWL', 1, 7)] });
    const current = apply(start(), initial).state;
    const before = JSON.stringify(read(current));
    expect(() => apply(current, { ...initial, additions: [specimen('OWL', 1, 6)] })).toThrow(
      'changed fact',
    );
    expect(() => apply(current, { ...initial, journalId: id(998) })).toThrow('foreign');
    expect(() => apply(current, fact(3, { removals: [id(1)] }))).toThrow('ordinal');
    let getterCalls = 0;
    const malformed = { ...fact(2, { removals: [id(1)] }) };
    Object.defineProperty(malformed, 'removals', {
      enumerable: true,
      get: () => {
        getterCalls++;
        return [id(1)];
      },
    });
    expect(() => apply(current, malformed)).toThrow('accessor');
    expect(getterCalls).toBe(0);
    expect(JSON.stringify(read(current))).toBe(before);
  });
  it('restores the full ordered prefix and rejects duplicate replay rows as saved corruption', () => {
    const facts = [
      fact(1, { additions: [specimen('OWL', 1, 7)] }),
      fact(2, { currentOeChanges: [{ symbiontInstanceId: id(1), currentOE: 0 }] }),
    ] as const;
    const confirmed = apply(apply(start(), facts[0]).state, facts[1]).state;
    expect(
      read(restoreNpcOrdinaryComposition(catalog.ordinaryComposition, binding, facts)),
    ).toEqual(read(confirmed));
    expect(() =>
      restoreNpcOrdinaryComposition(catalog.ordinaryComposition, binding, [facts[0], facts[0]]),
    ).toThrow('prefix');
  });
});
