import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it } from 'vitest';
import type { RaceCode } from '@generated/types/character.js';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import * as api from './ordinary-composition.js';
import type { NpcOrdinaryCompositionFact } from './ordinary-composition-types.js';
import { evaluateNpcCompositionConsequences } from './composition-consequences.js';
import type { NpcSymbiontInput } from './types.js';

let catalog: NpcAuthoringSourceCatalog;
let cat: api.NpcOrdinaryCompositionCatalog;
let lifetime: NpcAuthoringSourceCatalog['compositionConsequences'];
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  catalog = await loadNpcAuthoringSourceCatalog(root);
  cat = catalog.ordinaryComposition;
  lifetime = catalog.compositionConsequences;
});
function required<T>(item: T | undefined): T {
  assert.notEqual(item, undefined);
  if (item === undefined) throw new Error('Expected fixture item');
  return item;
}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = { journalId: id(999), raceCode: 'UNITED' as RaceCode };
const start = (raceCode: RaceCode = 'UNITED') =>
  api.createNpcOrdinaryComposition(cat, { ...binding, raceCode });
const view = api.readNpcOrdinaryComposition;
const apply = api.applyNpcOrdinaryCompositionFact;
function specimen(
  speciesKey: string,
  n: number,
  currentOE = 7,
  targetLevel = 1,
  learned?: readonly string[],
): NpcSymbiontInput {
  const source = required(catalog.symbionts.species.find((row) => row.speciesKey === speciesKey));
  const kind = source.bindingPolicy;
  return {
    symbiontInstanceId: id(n),
    speciesKey: source.speciesKey,
    targetLevel,
    currentOE,
    learnedNodeRefs:
      learned ??
      catalog.development.nodes
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
      'raceCode' | 'removals' | 'additions' | 'buildChanges' | 'currentOeChanges'
    >
  > = {},
): NpcOrdinaryCompositionFact {
  return {
    kind: 'APPLY_COMPOSITION_EDIT',
    factId: id(100 + ordinal),
    journalId: binding.journalId,
    ordinal,
    raceCode: 'UNITED',
    removals: [],
    additions: [],
    buildChanges: [],
    currentOeChanges: [],
    ...changes,
  };
}
function refused(state: api.NpcOrdinaryCompositionState, input: unknown, pattern: RegExp): void {
  const before = JSON.stringify(view(state));
  assert.throws(() => apply(state, input), pattern);
  assert.equal(JSON.stringify(view(state)), before);
}
const run = (proof: unknown, previous: unknown = null) =>
  evaluateNpcCompositionConsequences(lifetime, proof, previous);
const confirmation = (input: NpcOrdinaryCompositionFact) => ({
  input,
  confirmationCommandId: id(800 + input.ordinal),
  diceModeSnapshot: 'AUTO' as const,
});
const proof = (
  race: RaceCode = 'UNITED',
  confirmations: ReturnType<typeof confirmation>[] = [],
  resolutions: Record<string, unknown>[] = [],
) => ({
  identityKey: 'actual-npc-identity',
  binding: { ...binding, raceCode: race },
  confirmations,
  resolutions,
});
const roll = (n: number, sides: 6 | 20, face: number, commandOrdinal = 1) => ({
  factId: `roll-fact-${n}`,
  rollRequestId: `request-${n}`,
  rollReceiptId: `receipt-${n}`,
  originatingCommandId: id(800 + commandOrdinal),
  modeSnapshot: 'AUTO' as const,
  mechanical: { dieSides: sides, rawFace: face },
});
const resolution = (
  n: number,
  kind: string,
  fields: Record<string, unknown> = {},
  compositionOrdinal = 1,
) => ({
  factId: `resolution-${n}`,
  ordinal: n,
  compositionOrdinal,
  causedByFactId: id(100 + compositionOrdinal),
  kind,
  ...fields,
});
const stats = (patch: Partial<Record<'S' | 'D' | 'M' | 'Z' | 'I' | 'W' | 'C', number>> = {}) => ({
  S: 20,
  D: 20,
  M: 20,
  Z: 20,
  I: 20,
  W: 8,
  C: 20,
  ...patch,
});
const freeProof = () =>
  proof(
    'FREE',
    [
      confirmation(
        fact(1, { raceCode: 'FREE', additions: [specimen('RAT', 1), specimen('OWL', 2)] }),
      ),
    ],
    [
      resolution(1, 'FREE_SLOT_ROLL', {
        statContextFactId: 'actual-stat-context',
        permanentStatsBefore: stats({ S: 3, M: 10, Z: 1 }),
        roll: roll(1, 6, 6),
      }),
    ],
  );
const adviserProof = () =>
  proof(
    'UNITED',
    [confirmation(fact(1, { additions: [specimen('ADVISER', 1)] }))],
    [
      resolution(1, 'ADVISER_IW_ROLLS', {
        symbiontInstanceId: id(1),
        cardId: 'card-1',
        rolls: [roll(1, 20, 1), roll(2, 20, 1)],
      }),
      resolution(2, 'ADVISER_SKILLS', {
        symbiontInstanceId: id(1),
        bodyContextFactId: 'body-context-1',
        bodyStats: { S: 20, D: 20, M: 20, Z: 20, C: 20 },
        selectedSkills: [{ skillKey: 'GROSS', targetBonus: 5 }],
      }),
    ],
  );

describe('NPC N+1 race context and immutable composition history', () => {
  it('race-only UNITED to FREE to PURE to UNITED uses current source capacities', () => {
    let state = start();
    const receipts = [];
    for (const [index, raceCode] of (['FREE', 'PURE', 'UNITED'] as const).entries()) {
      const next = apply(state, fact(index + 1, { raceCode }));
      state = next.state;
      receipts.push(next.receipt);
      assert.equal(view(state).raceCode, raceCode);
      assert.equal(view(state).confirmedSlotCapacity, { FREE: 1, PURE: 0, UNITED: 4 }[raceCode]);
    }
    assert.deepEqual(
      receipts.map((r) => r.view.raceCode),
      ['FREE', 'PURE', 'UNITED'],
    );
    const restored = api.restoreNpcOrdinaryComposition(
      cat,
      binding,
      receipts.map((r) => r.input),
    );
    assert.deepEqual(view(restored), view(state));
  });
  it('race-only exact replay returns original receipt beside latest current state', () => {
    const firstInput = fact(1, { raceCode: 'FREE' }),
      first = apply(start(), firstInput);
    assert.equal(apply(first.state, firstInput).receipt, first.receipt);
    const last = apply(first.state, fact(2, { raceCode: 'PURE' }));
    const replay = apply(last.state, firstInput);
    assert.equal(replay.state, last.state);
    assert.equal(replay.receipt, first.receipt);
    assert.equal(replay.receipt.view.raceCode, 'FREE');
    assert.equal(view(replay.state).raceCode, 'PURE');
    refused(last.state, { ...firstInput, raceCode: 'UNITED' }, /changed fact/u);
  });
  it('unchanged race with empty arrays is still refused after old replay handling', () => {
    refused(start(), fact(1), /empty edit/u);
    const a = apply(start(), fact(1, { raceCode: 'FREE' }));
    refused(a.state, fact(2, { raceCode: 'FREE' }), /empty edit/u);
    assert.equal(apply(a.state, a.receipt.input).receipt, a.receipt);
  });
  it('race change rechecks retained species eligibility and cannot orphan state on refusal', () => {
    const a = apply(start(), fact(1, { additions: [specimen('RAT', 1)] }));
    const bytes = JSON.stringify(a.receipt);
    refused(a.state, fact(2, { raceCode: 'PURE' }), /eligible/u);
    assert.equal(JSON.stringify(a.receipt), bytes);
    const b = apply(a.state, fact(2, { raceCode: 'PURE', removals: [id(1)] }));
    assert.equal(view(b.state).occupiedSlots, 0);
    assert.equal(required(view(b.state).instances[0]).status, 'REMOVED');
    assert.equal(view(b.state).raceCode, 'PURE');
  });
  it('UNITED to FREE overcapacity refuses whole edit; atomic removals permit final two slots', () => {
    const a = apply(
      start(),
      fact(1, { additions: ['RAT', 'OWL', 'WEAVER'].map((s, i) => specimen(s, i + 1)) }),
    );
    refused(a.state, fact(2, { raceCode: 'FREE' }), /capacity/u);
    const b = apply(a.state, fact(2, { raceCode: 'FREE', removals: [id(3)] }));
    assert.equal(view(b.state).occupiedSlots, 2);
    assert.equal(view(b.state).confirmedSlotCapacity, 1);
    assert.equal(required(view(b.state).pendingRequirements[0]).causedByFactId, id(102));
  });
  it('PURE to UNITED atomic addition uses selected race rather than initial journal race', () => {
    const a = apply(
      start('PURE'),
      fact(1, { raceCode: 'UNITED', additions: [specimen('OWL', 1)] }),
    );
    assert.equal(view(a.state).occupiedSlots, 1);
    assert.equal(view(a.state).raceCode, 'UNITED');
    assert.deepEqual(
      view(
        api.restoreNpcOrdinaryComposition(cat, { ...binding, raceCode: 'PURE' }, [a.receipt.input]),
      ),
      view(a.state),
    );
  });
  it('PURE selected race cannot smuggle an addition under previous UNITED eligibility', () => {
    refused(start(), fact(1, { raceCode: 'PURE', additions: [specimen('OWL', 1)] }), /eligible/u);
  });
  it('lifetime XOR choices survive race transitions and temporary node loss', () => {
    let s = apply(
      start(),
      fact(1, { additions: [specimen('WEAVER', 1, 7, 2, ['SYM-027', 'SYM-028'])] }),
    ).state;
    s = apply(s, fact(2, { raceCode: 'FREE' })).state;
    s = apply(
      s,
      fact(3, {
        raceCode: 'UNITED',
        buildChanges: [
          {
            symbiontInstanceId: id(1),
            targetLevel: 1,
            learnedNodeRefs: ['SYM-027'],
            binding: { kind: 'NONE' },
          },
        ],
      }),
    ).state;
    refused(
      s,
      fact(4, {
        raceCode: 'FREE',
        buildChanges: [
          {
            symbiontInstanceId: id(1),
            targetLevel: 2,
            learnedNodeRefs: ['SYM-027', 'SYM-029'],
            binding: { kind: 'NONE' },
          },
        ],
      }),
      /XOR/u,
    );
  });
  it('race cannot reuse removed instance identity or erase historical nodes', () => {
    const a = apply(start(), fact(1, { additions: [specimen('RAT', 1)] }));
    const b = apply(a.state, fact(2, { raceCode: 'PURE', removals: [id(1)] }));
    refused(
      b.state,
      fact(3, { raceCode: 'UNITED', additions: [specimen('RAT', 1)] }),
      /identity reuse/u,
    );
    assert.deepEqual(
      required(view(b.state).instances[0]).learnedNodeRefs,
      required(view(a.state).instances[0]).learnedNodeRefs,
    );
  });
  it('unknown/missing/accessor race cannot be coerced into current binding', () => {
    refused(start(), { ...fact(1), raceCode: 'ALIEN' }, /unknown selected race/u);
    const missing: Record<string, unknown> = { ...fact(1, { additions: [specimen('RAT', 1)] }) };
    delete missing.raceCode;
    refused(start(), missing, /fields/u);
    let calls = 0;
    const getter = fact(1);
    Object.defineProperty(getter, 'raceCode', {
      enumerable: true,
      get() {
        calls++;
        return 'FREE';
      },
    });
    refused(start(), getter, /accessor/u);
    assert.equal(calls, 0);
  });
  const newlyFreeProof = () =>
    proof(
      'UNITED',
      [
        confirmation(fact(1, { additions: [specimen('RAT', 1), specimen('OWL', 2)] })),
        confirmation(fact(2, { raceCode: 'FREE' })),
      ],
      [
        resolution(
          1,
          'FREE_SLOT_ROLL',
          {
            statContextFactId: 'selected-FREE-context',
            permanentStatsBefore: stats(),
            roll: roll(91, 6, 3, 2),
          },
          2,
        ),
      ],
    );
  it('new FREE unlock binds current race and current cause, retaining initial UNITED proof', () => {
    const p = newlyFreeProof(),
      out = run(p);
    assert.equal(out.proof.binding.raceCode, 'UNITED');
    assert.equal(out.composition.raceCode, 'FREE');
    assert.equal(out.confirmedSlotCapacity, 2);
    assert.equal(out.obligationStatus, 'RESOLVED');
    assert.ok(out.lifetimeFacts.freeExtraSlot.kind === 'UNLOCKED');
    assert.equal(out.lifetimeFacts.freeExtraSlot.permanentStatConsequence.S, -3);
    assert.equal(required(out.proof.resolutions[0]).causedByFactId, id(102));
  });
  it('FREE unlock persists through PURE and UNITED without replacing their capacities or old receipts', () => {
    const p = freeProof(),
      old = run(p),
      oldBytes = JSON.stringify(old);
    p.confirmations.push(confirmation(fact(2, { raceCode: 'PURE', removals: [id(1), id(2)] })));
    const pure = run(p, old.proof);
    assert.equal(pure.confirmedSlotCapacity, 0);
    assert.equal(pure.composition.raceCode, 'PURE');
    assert.deepEqual(pure.lifetimeFacts.freeExtraSlot, old.lifetimeFacts.freeExtraSlot);
    p.confirmations.push(
      confirmation(
        fact(3, {
          raceCode: 'UNITED',
          additions: ['RAT', 'OWL', 'WEAVER'].map((s, i) => specimen(s, i + 3)),
        }),
      ),
    );
    const united = run(p, pure.proof);
    assert.equal(united.confirmedSlotCapacity, 4);
    assert.equal(united.composition.occupiedSlots, 3);
    p.confirmations.push(confirmation(fact(4, { raceCode: 'FREE', removals: [id(5)] })));
    const back = run(p, united.proof);
    assert.equal(back.confirmedSlotCapacity, 2);
    assert.equal(back.obligationStatus, 'RESOLVED');
    assert.equal(back.proof.resolutions.length, 1);
    assert.deepEqual(back.lifetimeFacts.freeExtraSlot, old.lifetimeFacts.freeExtraSlot);
    assert.deepEqual(
      back.compositionReceipts.slice(0, old.compositionReceipts.length),
      old.compositionReceipts,
    );
    assert.equal(JSON.stringify(old), oldBytes);
    assert.deepEqual(run(old.proof, old.proof), old);
  });
  it('existing FREE lifetime unlock resolves returning FREE requirement without new roll', () => {
    const p = newlyFreeProof(),
      old = run(p);
    p.confirmations.push(
      confirmation(fact(3, { raceCode: 'UNITED' })),
      confirmation(fact(4, { raceCode: 'FREE' })),
    );
    const out = run(p, old.proof);
    assert.equal(out.obligationStatus, 'RESOLVED');
    assert.equal(out.proof.resolutions.length, 1);
    assert.deepEqual(out.lifetimeFacts.freeExtraSlot, old.lifetimeFacts.freeExtraSlot);
  });
  it('new FREE cannot leave unresolved mandatory continuation by changing race again', () => {
    const p = newlyFreeProof();
    p.resolutions = [];
    p.confirmations.push(confirmation(fact(3, { raceCode: 'UNITED' })));
    assert.throws(() => run(p), /abandon required/u);
  });
  it('returning FREE cannot obtain a second lifetime roll under a fresh command', () => {
    const p = newlyFreeProof();
    p.confirmations.push(
      confirmation(fact(3, { raceCode: 'UNITED' })),
      confirmation(fact(4, { raceCode: 'FREE' })),
    );
    p.resolutions.push(
      resolution(
        2,
        'FREE_SLOT_ROLL',
        { statContextFactId: 'second', permanentStatsBefore: stats(), roll: roll(92, 6, 2, 4) },
        4,
      ),
    );
    assert.throws(() => run(p), /obligation|already/u);
  });
  it('initial race binding cannot be relabelled as latest race on N+1', () => {
    const p = newlyFreeProof(),
      old = run(p);
    p.binding.raceCode = 'FREE';
    assert.throws(() => run(p, old.proof), /binding|abandon/u);
  });
  it('forged race inside old confirmed prefix is refused even when each candidate fold is valid', () => {
    const p = proof('UNITED', [confirmation(fact(1, { additions: [specimen('RAT', 1)] }))]),
      old = run(p);
    const oldFirst = required(p.confirmations[0]);
    p.confirmations[0] = { ...oldFirst, input: { ...oldFirst.input, raceCode: 'FREE' } };
    p.confirmations.push(confirmation(fact(2, { raceCode: 'UNITED' })));
    assert.throws(() => run(p, old.proof), /prefix/u);
  });
  it('append race context keeps exact earlier receipts including one-time Advisor card', () => {
    const p = adviserProof(),
      old = run(p);
    p.confirmations.push(confirmation(fact(2, { raceCode: 'FREE' })));
    const out = run(p, old.proof);
    assert.deepEqual(out.lifetimeFacts.advisorCards, old.lifetimeFacts.advisorCards);
    assert.deepEqual(out.compositionReceipts[0], old.compositionReceipts[0]);
    assert.deepEqual(out.proof.resolutions, old.proof.resolutions);
  });
});
