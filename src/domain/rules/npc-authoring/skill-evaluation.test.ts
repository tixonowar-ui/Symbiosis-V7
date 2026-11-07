import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import {
  assertNpcSkillSnapshot,
  evaluateNpcSkills,
  evaluateNpcCurrentSkillAvailability,
  previewNpcSkills,
  type NpcSkillContext,
  type NpcSkillProof,
} from './skill-evaluation.js';
import type { NpcSkillAccountingFact } from './skill-accounting.js';
import { npcPureInitialSkillFixture } from '../../../../tests/fixtures/npc-clean-humanoid.js';

let catalog: NpcAuthoringSourceCatalog;
beforeAll(async () => {
  catalog = await loadNpcAuthoringSourceCatalog(
    fileURLToPath(new URL('../../../../', import.meta.url)),
  );
});
function grossKey() {
  const key = catalog.skills.skills.find((row) => row.skillKey === 'GROSS')?.skillKey;
  if (key === undefined) throw new Error('Required source skill GROSS missing');
  return key;
}
const stats = { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 8, C: 20 };
function paid(
  context: number,
  ordinal: number,
  before: number,
  after: number,
  cost: number,
  pool: 'START' | 'TRAINING' = 'START',
): Extract<NpcSkillAccountingFact, { kind: 'PAID_ACQUISITION' }> {
  return {
    kind: 'PAID_ACQUISITION',
    factId: `fact-${ordinal}`,
    ordinal,
    contextFactId: `context-${context}`,
    skillKey: grossKey(),
    bonusBefore: before,
    bonusAfter: after,
    chargedSlotCost: cost,
    pool,
  };
}
function context(ordinal: number, changes: Partial<NpcSkillContext> = {}): NpcSkillContext {
  return {
    contextFactId: `context-${ordinal}`,
    ordinal,
    stage: ordinal === 1 ? 'START_SELECTION' : 'CONFIRMED',
    raceCode: 'FREE',
    classCode: null,
    skillStageStats: { ...stats },
    permanentStats: { ...stats },
    effectiveStats: { ...stats },
    grossGrantSourceOrNull: null,
    facts: [],
    ...changes,
  };
}
const first = () => context(1, { facts: [paid(1, 1, 0, 4, 4)] });
const proof = (...contexts: NpcSkillContext[]): NpcSkillProof => ({
  identityKey: 'npc-identity',
  contexts,
});
const evaluate = (value: NpcSkillProof, previous: NpcSkillProof | null = null) =>
  evaluateNpcSkills(catalog.skills, {
    mode: previous === null ? 'CREATE_V1' : 'APPEND_N_PLUS_ONE',
    identityKey: 'npc-identity',
    previousConfirmedProofOrNull: previous,
    proof: value,
  });

describe('ADR0082 one lifetime SYM-166 pool', () => {
  const source = { symbiontInstanceId: 'dolphin-original', nodeRef: 'SYM-166' as const };
  const selectedKey = (value: 'STEALTH' | 'ACROBATICS') => {
    const selected = catalog.skills.skills.find((s) => s.skillKey === value);
    if (selected === undefined) throw new Error('Missing actual source skill');
    return selected.skillKey;
  };
  const charge = (
    ordinal: number,
    skillKey: 'STEALTH' | 'ACROBATICS',
    bonus: number,
    contextOrdinal = 1,
    instance = source.symbiontInstanceId,
  ): Extract<NpcSkillAccountingFact, { kind: 'PAID_ACQUISITION'; pool: 'SYM-166' }> => ({
    kind: 'PAID_ACQUISITION',
    factId: `fact-${ordinal}`,
    ordinal,
    contextFactId: `context-${contextOrdinal}`,
    skillKey: selectedKey(skillKey),
    bonusBefore: 0,
    bonusAfter: bonus,
    pool: 'SYM-166',
    chargedSlotCost: bonus,
    symbiontInstanceId: instance,
    nodeRef: 'SYM-166',
  });
  const acquired = () =>
    context(1, {
      sym166SourceOrNull: source,
      facts: [paid(1, 1, 0, 4, 4), charge(2, 'STEALTH', 2), charge(3, 'ACROBATICS', 3)],
    });
  it('keeps W/START/TRAINING independent and records exact source and endpoints per paid step', () => {
    const result = evaluate(proof(acquired()));
    expect(result.pools).toEqual({
      START: { capacity: 4, used: 4, available: 0, overfill: 0 },
      TRAINING: { capacity: 4, used: 0, available: 4, overfill: 0 },
      'SYM-166': { capacity: 5, used: 5, available: 0, overfill: 0 },
    });
    expect(result.ledger.training).toEqual({
      maxPermanentWisdom: 8,
      everIssued: 4,
      basisFactId: 'context-1',
    });
    expect(result.ledger.sym166Pool?.charges).toEqual([
      {
        skillKey: 'STEALTH',
        bonusBefore: 0,
        bonusAfter: 2,
        chargedSlotCost: 2,
        acquisitionFactId: 'fact-2',
        ...source,
      },
      {
        skillKey: 'ACROBATICS',
        bonusBefore: 0,
        bonusAfter: 3,
        chargedSlotCost: 3,
        acquisitionFactId: 'fact-3',
        ...source,
      },
    ]);
  });
  it('removal keeps charges and skills; another Dolphin restores the same exhausted pool', () => {
    const original = proof(acquired());
    const removed = context(2, { sym166SourceOrNull: null });
    const result = evaluate(proof(acquired(), removed), original);
    expect(result.pools['SYM-166']).toEqual({ capacity: 0, used: 5, available: 0, overfill: 5 });
    expect(result.disabledSkillKeys).toEqual([]);
    expect(result.ledger.learnedSkills).toEqual(evaluate(original).ledger.learnedSkills);
    const regained = context(3, {
      sym166SourceOrNull: { ...source, symbiontInstanceId: 'new-dolphin' },
    });
    const next = evaluate(proof(acquired(), removed, regained), original);
    expect(next.pools['SYM-166']).toEqual({ capacity: 5, used: 5, available: 0, overfill: 0 });
    expect(next.ledger.sym166Pool?.charges).toEqual(result.ledger.sym166Pool?.charges);
    expect(() =>
      evaluate(
        proof(acquired(), removed, {
          ...regained,
          facts: [
            { ...charge(4, 'STEALTH', 3, 3, 'new-dolphin'), bonusBefore: 2, chargedSlotCost: 1 },
          ],
        }),
      ),
    ).toThrow('insufficient current capacity');
  });
  it('temporary requirement loss disables without release; permanent loss frees only actual original charges', () => {
    const original = proof(acquired());
    const temporary = evaluateNpcCurrentSkillAvailability(catalog.skills, {
      identityKey: original.identityKey,
      proof: original,
      effectiveStats: { ...stats, I: 4 },
      sym166SourceOrNull: null,
    });
    expect(temporary.disabledSkillKeys).toEqual(['STEALTH']);
    expect(temporary.pools['SYM-166']).toEqual({ capacity: 0, used: 5, available: 0, overfill: 5 });
    const loss: NpcSkillAccountingFact = {
      kind: 'PERMANENT_REQUIREMENT_LOSS',
      sourceRuleId: 'CORE-166',
      factId: 'fact-4',
      ordinal: 4,
      contextFactId: 'context-2',
      skillKey: selectedKey('STEALTH'),
    };
    const low = context(2, {
      sym166SourceOrNull: null,
      permanentStats: { ...stats, I: 4 },
      effectiveStats: { ...stats, I: 4 },
      facts: [loss],
    });
    const restored = context(3, { sym166SourceOrNull: source });
    const result = evaluate(proof(acquired(), low, restored), original);
    expect(result.pools['SYM-166']).toEqual({ capacity: 5, used: 3, available: 2, overfill: 0 });
    expect(result.pools.START.used).toBe(4);
    expect(result.ledger.sym166Pool?.charges.map((c) => c.acquisitionFactId)).toEqual(['fact-3']);
    const reused = evaluate(
      proof(acquired(), low, { ...restored, facts: [charge(5, 'STEALTH', 2, 3)] }),
      original,
    );
    expect(reused.pools['SYM-166']?.available).toBe(0);
    expect(reused.ledger.sym166Pool?.charges.map((c) => c.acquisitionFactId)).toEqual([
      'fact-3',
      'fact-5',
    ]);
  });
  it('allows unused SYM-166 capacity but cannot replace mandatory START or invent source/basis', () => {
    const result = evaluate(proof({ ...first(), sym166SourceOrNull: source }));
    expect(result.pools['SYM-166']).toEqual({ capacity: 5, used: 0, available: 5, overfill: 0 });
    expect(() =>
      evaluate(proof(context(1, { sym166SourceOrNull: source, facts: [charge(1, 'STEALTH', 2)] }))),
    ).toThrow('fill every initial START');
    expect(() => evaluate(proof({ ...acquired(), sym166SourceOrNull: null }))).toThrow(
      'exact active learned source',
    );
    expect(() =>
      evaluate(
        proof({ ...acquired(), sym166SourceOrNull: { ...source, symbiontInstanceId: 'foreign' } }),
      ),
    ).toThrow('exact active learned source');
    expect(() => evaluate(proof(acquired(), context(2)))).toThrow('explicit current source');
    expect(() =>
      evaluateNpcCurrentSkillAvailability(catalog.skills, {
        identityKey: 'npc-identity',
        proof: proof(first()),
        effectiveStats: stats,
        sym166SourceOrNull: source,
      }),
    ).toThrow('cannot invent');
  });
});

describe('NPC-014 confirmed skill consequences', () => {
  it('binds an actual pre-START GROSS grant without manufacturing paid selections or W issuance', () => {
    const grant: NpcSkillAccountingFact = {
      kind: 'TROGR_GROSS_GRANT',
      sourceRuleId: 'SYM-079',
      factId: 'fact-1',
      ordinal: 1,
      contextFactId: 'context-1',
      symbiontAcquisitionFactId: 'actual-composition-confirmation',
      bonusBefore: 0,
      bonusAfter: 3,
    };
    const pre = context(1, {
      stage: 'COMPOSITION_BEFORE_START',
      permanentStats: { ...stats, W: 20 },
      effectiveStats: { ...stats, W: 20 },
      grossGrantSourceOrNull: {
        sourceRuleId: 'SYM-079',
        symbiontInstanceId: 'trogr-original',
        sourceAcquisitionFactId: 'actual-composition-confirmation',
      },
      facts: [grant],
    });
    const stealth = catalog.skills.skills.find((s) => s.skillKey === 'STEALTH');
    if (stealth === undefined) throw new Error('Missing source STEALTH');
    const paidStealth: NpcSkillAccountingFact = {
      ...paid(2, 3, 0, 2, 2),
      skillKey: stealth.skillKey,
    };
    const selected = context(2, {
      stage: 'START_SELECTION',
      facts: [paid(2, 2, 3, 5, 2), paidStealth],
    });
    const result = evaluate(proof(pre, selected));
    expect(result.grossGrant).toEqual({
      kind: 'ISSUED',
      sourceRuleId: 'SYM-079',
      bonusBefore: 0,
      bonusAfter: 3,
      acquisitionFactId: 'fact-1',
    });
    expect(result.ledger.startBasis.confirmationFactId).toBe('context-2');
    expect(result.ledger.training).toEqual({
      maxPermanentWisdom: 8,
      everIssued: 4,
      basisFactId: 'context-2',
    });
    expect(result.pools.START).toEqual({ capacity: 4, used: 4, available: 0, overfill: 0 });
    expect(() => evaluate(proof(pre))).toThrow('start basis');
    expect(() => evaluate(proof(pre, { ...selected, facts: [] }))).toThrow(
      'fill every initial START',
    );
    expect(() =>
      evaluate(proof({ ...pre, facts: [grant, paid(1, 2, 3, 5, 2)] }, selected)),
    ).toThrow('no paid acquisition');
  });
  it('CORE-081 requires initial START fill and derives a separate training pool', () => {
    const result = evaluate(proof(first()));
    expect(result.pools).toEqual({
      START: { capacity: 4, used: 4, available: 0, overfill: 0 },
      TRAINING: { capacity: 4, used: 0, available: 4, overfill: 0 },
    });
    expect(result.ledger.training).toEqual({
      maxPermanentWisdom: 8,
      everIssued: 4,
      basisFactId: 'context-1',
    });
    expect(() => evaluate(proof(context(1)))).toThrow('fill every initial START');
    expect(() => evaluate(proof(context(1, { facts: [paid(1, 1, 0, 4, 4, 'TRAINING')] })))).toThrow(
      'capacity',
    );
  });
  it('CORE-167 requires both actual GROSS prerequisites', () => {
    for (const patch of [{ S: 13 }, { D: 5 }]) {
      expect(() =>
        evaluate(
          proof(
            context(1, { effectiveStats: { ...stats, ...patch }, facts: [paid(1, 1, 0, 4, 4)] }),
          ),
        ),
      ).toThrow('RequirementID');
    }
  });
  it('CORE-081/166 keeps overfill and derives issuance only from permanent confirmed peaks', () => {
    const previous = proof(first());
    const low = context(2, {
      permanentStats: { ...stats, W: 6 },
      effectiveStats: { ...stats, W: 6 },
    });
    const overfilled = evaluate(proof(first(), low), previous);
    expect(overfilled.pools.START).toEqual({ capacity: 3, used: 4, available: 0, overfill: 1 });
    expect(overfilled.disabledSkillKeys).toEqual([]);
    expect(overfilled.ledger.training.everIssued).toBe(4);
    const temporaryPeak = evaluate(
      proof(first(), context(2, { effectiveStats: { ...stats, W: 20 } })),
    );
    expect(temporaryPeak.ledger.training.everIssued).toBe(4);
    const permanentPeak = evaluate(
      proof(
        first(),
        low,
        context(3, { permanentStats: { ...stats, W: 10 }, effectiveStats: { ...stats, W: 10 } }),
        context(4),
      ),
    );
    expect(permanentPeak.ledger.training).toEqual({
      maxPermanentWisdom: 10,
      everIssued: 5,
      basisFactId: 'context-3',
    });
    expect(permanentPeak.pools.TRAINING.capacity).toBe(4);
  });
  it('CORE-166 distinguishes temporary disabling from proven permanent forgetting', () => {
    const initial = proof(first());
    const temporary = evaluate(
      proof(first(), context(2, { effectiveStats: { ...stats, S: 13 } })),
      initial,
    );
    expect(temporary.disabledSkillKeys).toEqual(['GROSS']);
    expect(temporary.ledger.learnedSkills[0]?.bonus).toBe(4);
    const loss: NpcSkillAccountingFact = {
      kind: 'PERMANENT_REQUIREMENT_LOSS',
      sourceRuleId: 'CORE-166',
      factId: 'fact-2',
      ordinal: 2,
      contextFactId: 'context-2',
      skillKey: grossKey(),
    };
    const dropped = context(2, {
      permanentStats: { ...stats, S: 13 },
      effectiveStats: { ...stats, S: 13 },
    });
    expect(() => evaluate(proof(first(), dropped), initial)).toThrow('missing permanent');
    const result = evaluate(proof(first(), { ...dropped, facts: [loss] }, context(3)), initial);
    expect(result.ledger.learnedSkills).toEqual([]);
    expect(result.pools.START.used).toBe(0);
    expect(initial.contexts[0]?.facts).toEqual([paid(1, 1, 0, 4, 4)]);
  });
  it('SYM-079 preserves original charges and rejects a repeated lifetime grant', () => {
    const source = {
      sourceRuleId: 'SYM-079' as const,
      symbiontInstanceId: 'trogr-instance',
      sourceAcquisitionFactId: 'learned-node-leaf',
    };
    const grant: NpcSkillAccountingFact = {
      kind: 'TROGR_GROSS_GRANT',
      sourceRuleId: 'SYM-079',
      factId: 'fact-2',
      ordinal: 2,
      contextFactId: 'context-2',
      symbiontAcquisitionFactId: source.sourceAcquisitionFactId,
      bonusBefore: 4,
      bonusAfter: 5,
    };
    const granted = context(2, { grossGrantSourceOrNull: source, facts: [grant] });
    const result = evaluate(
      proof(first(), granted, context(3, { facts: [paid(3, 3, 5, 6, 2, 'TRAINING')] })),
    );
    expect(result.ledger.learnedSkills[0]).toMatchObject({
      skillKey: 'GROSS',
      bonus: 6,
      charges: [
        { pool: 'START', chargedSlotCost: 4 },
        { pool: 'TRAINING', chargedSlotCost: 2 },
      ],
    });
    expect(() => evaluate(proof(first(), { ...granted, grossGrantSourceOrNull: null }))).toThrow(
      'matching confirmed',
    );
    expect(() =>
      evaluate(
        proof(
          first(),
          granted,
          context(3, {
            grossGrantSourceOrNull: source,
            facts: [
              {
                ...grant,
                factId: 'fact-3',
                ordinal: 3,
                contextFactId: 'context-3',
                bonusBefore: 5,
              },
            ],
          }),
        ),
      ),
    ).toThrow();
  });
  it('rejects N+1 prefix rewrites and forged derived snapshot fields', () => {
    const previous = proof(first());
    const changed = proof({ ...first(), effectiveStats: { ...stats, I: 19 } });
    expect(() => evaluate(changed, previous)).toThrow('immutable confirmed prefix');
    const result = evaluate(previous);
    expect(() =>
      assertNpcSkillSnapshot(
        result,
        { ...result.ledger, training: { ...result.ledger.training, everIssued: 100 } },
        result.grossGrant,
      ),
    ).toThrow();
    expect(() =>
      assertNpcSkillSnapshot(result, { ...result.ledger, authorized: true }, result.grossGrant),
    ).toThrow('unexpected');
    expect(() => assertNpcSkillSnapshot(result, result.ledger, result.grossGrant)).not.toThrow();
  });
});

describe('NPC current skill availability without invented confirmation facts', () => {
  const initial = () => {
    const key = catalog.skills.skills.find((s) => s.skillKey === 'UNARMED')?.skillKey;
    if (key === undefined) throw new Error('Required source skill UNARMED missing');
    return npcPureInitialSkillFixture(
      catalog,
      {
        npcUuid: '00000000-0000-4000-8000-000000000011',
        owningControllerId: '00000000-0000-4000-8000-000000000012',
        contextFactId: '00000000-0000-4000-8000-000000000013',
        compositionJournalId: '00000000-0000-4000-8000-000000000014',
        commitOperationId: '00000000-0000-4000-8000-000000000015',
      },
      {
        pureClassOrNull: 'SOLDIER',
        baseStats: { S: 10, D: 10, M: 10, Z: 10, I: 10, W: 4, C: 10 },
        selections: [{ skillKey: key, targetBonus: 1, pool: 'START' }],
      },
    ).skillProof;
  };
  const checked = (value: NpcSkillProof) =>
    evaluateNpcSkills(catalog.skills, {
      mode: 'CREATE_V1',
      identityKey: value.identityKey,
      previousConfirmedProofOrNull: null,
      proof: value,
    });
  const view = (value: NpcSkillProof, patch: Partial<typeof stats> = {}) => {
    const firstContext = value.contexts[0];
    if (firstContext === undefined) throw new Error('Missing source fixture start context');
    return evaluateNpcCurrentSkillAvailability(catalog.skills, {
      identityKey: value.identityKey,
      proof: value,
      effectiveStats: { ...firstContext.effectiveStats, ...patch },
    });
  };
  it('disables an unmet actual UNARMED requirement and restores it without changing paid or fixed history', () => {
    const value = initial();
    const before = JSON.stringify(value);
    const original = checked(value);
    expect(original.ledger.learnedSkills).toMatchObject([
      { skillKey: 'UNARMED', bonus: 1, charges: [{ pool: 'START', chargedSlotCost: 1 }] },
    ]);
    expect(original.ledger.fixedSkills).toMatchObject([
      { source: 'CLASS_MANDATORY', skillKey: 'PURE_SOLDIER', slotCost: 1 },
    ]);
    const sick = view(value, { S: 8 });
    expect(sick.disabledSkillKeys).toEqual(['UNARMED']);
    expect(sick.pools).toEqual(original.pools);
    expect(view(value).disabledSkillKeys).toEqual([]);
    expect(checked(value)).toEqual(original);
    expect(JSON.stringify(value)).toBe(before);
    expect(value.contexts).toHaveLength(1);
    expect(value.contexts[0]?.stage).toBe('START_SELECTION');
  });
  it('retains original START and TRAINING charges during current overfill without disabling an otherwise eligible skill', () => {
    const value = proof(first(), context(2, { facts: [paid(2, 2, 4, 5, 1, 'TRAINING')] }));
    const original = checked(value);
    const before = JSON.stringify(value);
    const low = view(value, { W: 1 });
    expect(low).toEqual({
      disabledSkillKeys: [],
      pools: {
        START: { capacity: 1, used: 4, available: 0, overfill: 3 },
        TRAINING: { capacity: 0, used: 1, available: 0, overfill: 1 },
      },
    });
    expect(view(value, { W: 20 }).pools).toEqual(original.pools);
    expect(checked(value)).toEqual(original);
    expect(JSON.stringify(value)).toBe(before);
  });
  it('includes the immutable class reservation in reduced current START capacity', () => {
    const value = initial();
    expect(view(value, { W: 1 })).toEqual({
      disabledSkillKeys: [],
      pools: {
        START: { capacity: 1, used: 2, available: 0, overfill: 1 },
        TRAINING: { capacity: 0, used: 0, available: 0, overfill: 0 },
      },
    });
  });
  it('revalidates accounting and permanent loss history before returning current availability', () => {
    expect(() => view(proof(context(1)))).toThrow('fill every initial START');
    expect(() => view(proof(first(), context(2, { permanentStats: { ...stats, S: 13 } })))).toThrow(
      'missing permanent',
    );
    expect(() => view(proof(context(1, { facts: [paid(1, 1, 0, 4, 1)] })))).toThrow();
  });
  it('refuses foreign identity, unknown fields and unclamped or nonintegral effective stats', () => {
    const value = initial();
    const firstContext = value.contexts[0];
    if (firstContext === undefined) throw new Error('Missing start context');
    const input = {
      identityKey: value.identityKey,
      proof: value,
      effectiveStats: firstContext.effectiveStats,
    };
    expect(() =>
      evaluateNpcCurrentSkillAvailability(catalog.skills, { ...input, identityKey: 'foreign' }),
    ).toThrow('another identity');
    expect(() =>
      evaluateNpcCurrentSkillAvailability(
        catalog.skills,
        Object.assign({}, input, { confirmed: true }),
      ),
    ).toThrow('unexpected');
    for (const S of [0, -1, 1.5, NaN, Infinity]) {
      expect(() =>
        evaluateNpcCurrentSkillAvailability(catalog.skills, {
          ...input,
          effectiveStats: { ...input.effectiveStats, S },
        }),
      ).toThrow('invalid safe integer');
    }
    expect(() =>
      evaluateNpcCurrentSkillAvailability(catalog.skills, {
        ...input,
        effectiveStats: { ...input.effectiveStats, hidden: 1 },
      }),
    ).toThrow('unexpected');
  });
});

describe('ordinary skill preview without prospective history', () => {
  const source = { symbiontInstanceId: 'dolphin-source', nodeRef: 'SYM-166' as const };
  const profile = (contextFactId: string, changes: Record<string, unknown> = {}) => ({
    contextFactId,
    raceCode: 'FREE',
    classCode: null,
    skillStageStats: stats,
    permanentStats: stats,
    effectiveStats: stats,
    grossGrant: { kind: 'NOT_ISSUED' },
    sym166SourceOrNull: source,
    ...changes,
  });
  const preview = (
    contexts: unknown[],
    selections: unknown[],
    previousConfirmedProofOrNull: unknown = null,
  ) =>
    previewNpcSkills(catalog.skills, {
      identityKey: 'npc-identity',
      contexts,
      selections,
      previousConfirmedProofOrNull,
    });
  it('uses START before TRAINING/SYM-166, with independent pools and no invented fact IDs', () => {
    const result = preview(
      [profile('actual-stage')],
      [
        { skillKey: 'GROSS', targetBonus: 4, pool: 'START' },
        { skillKey: 'STEALTH', targetBonus: 2, pool: 'SYM-166' },
        { skillKey: 'ACROBATICS', targetBonus: 3, pool: 'SYM-166' },
        { skillKey: 'GROSS', targetBonus: 6, pool: 'TRAINING' },
      ],
    );
    expect(result.pools).toEqual({
      START: { capacity: 4, used: 4, available: 0, overfill: 0 },
      TRAINING: { capacity: 4, used: 3, available: 1, overfill: 0 },
      'SYM-166': { capacity: 5, used: 5, available: 0, overfill: 0 },
    });
    expect(result.pendingCharges.map((c) => c.slotCost)).toEqual([4, 2, 3, 3]);
    expect(JSON.stringify(result)).not.toMatch(
      /"(?:factId|acquisitionFactId|confirmationFactId|commitOperationId)":/,
    );
    expect(Object.isFrozen(result.pendingCharges[0])).toBe(true);
    expect(() =>
      preview(
        [profile('actual-stage')],
        [{ skillKey: 'STEALTH', targetBonus: 2, pool: 'SYM-166' }],
      ),
    ).toThrow('fill every START');
  });
  it('uses actual resolved initial GROSS endpoints, not a fabricated paid grant', () => {
    const grossGrant = {
      kind: 'ISSUED',
      sourceRuleId: 'SYM-079',
      bonusBefore: 0,
      bonusAfter: 3,
      acquisitionFactId: 'real-gross-leaf',
    };
    const result = preview(
      [profile('actual-grant', { grossGrant })],
      [
        { skillKey: 'GROSS', targetBonus: 5, pool: 'START' },
        { skillKey: 'STEALTH', targetBonus: 2, pool: 'START' },
      ],
    );
    expect(
      result.pendingCharges.map((c) => [c.skillKey, c.bonusBefore, c.bonusAfter, c.slotCost]),
    ).toEqual([
      ['GROSS', 3, 5, 2],
      ['STEALTH', 0, 2, 2],
    ]);
    expect(() =>
      preview([profile('actual-grant', { grossGrant: { ...grossGrant, bonusAfter: 4 } })], []),
    ).toThrow('actual endpoints');
  });
  it('preserves original spent costs and permanent loss through lowering then restoring a stat', () => {
    const stealth = catalog.skills.skills.find((s) => s.skillKey === 'STEALTH')?.skillKey;
    if (stealth === undefined) throw Error('source');
    const acquisition: NpcSkillAccountingFact = {
      kind: 'PAID_ACQUISITION',
      factId: 'fact-2',
      ordinal: 2,
      contextFactId: 'context-1',
      skillKey: stealth,
      bonusBefore: 0,
      bonusAfter: 2,
      chargedSlotCost: 2,
      pool: 'SYM-166',
      ...source,
    };
    const old = proof(
      context(1, { sym166SourceOrNull: source, facts: [paid(1, 1, 0, 4, 4), acquisition] }),
    );
    const bytes = JSON.stringify(old);
    const result = preview(
      [
        profile('actual-loss', {
          permanentStats: { ...stats, I: 4 },
          effectiveStats: { ...stats, I: 4 },
          sym166SourceOrNull: null,
        }),
        profile('actual-restored'),
      ],
      [],
      old,
    );
    expect(result.permanentLosses).toEqual([{ contextFactId: 'actual-loss', skillKey: 'STEALTH' }]);
    expect(result.learnedSkills.map((s) => s.skillKey)).not.toContain('STEALTH');
    expect(result.pools['SYM-166']).toEqual({ capacity: 5, used: 0, available: 5, overfill: 0 });
    expect(result.pools.START.used).toBe(4);
    const temp = preview(
      [profile('temporary', { effectiveStats: { ...stats, I: 4 }, sym166SourceOrNull: null })],
      [],
      old,
    );
    expect(temp.permanentLosses).toEqual([]);
    expect(temp.disabledSkillKeys).toEqual(['STEALTH']);
    expect(temp.pools['SYM-166']).toEqual({ capacity: 0, used: 2, available: 0, overfill: 2 });
    expect(JSON.stringify(old)).toBe(bytes);
  });
  it('NPC requirements use actual permanent/effective stats while START keeps its earlier W basis', () => {
    const low = { ...stats, I: 4 };
    const result = preview(
      [profile('after-dolphin', { skillStageStats: low })],
      [{ skillKey: 'STEALTH', targetBonus: 4, pool: 'START' }],
    );
    expect(result.pools.START.used).toBe(4);
    expect(() =>
      preview(
        [profile('temporary-block', { skillStageStats: low, effectiveStats: low })],
        [{ skillKey: 'STEALTH', targetBonus: 4, pool: 'START' }],
      ),
    ).toThrow('REQ-');
    const key = catalog.skills.skills.find((s) => s.skillKey === 'STEALTH')?.skillKey;
    if (key === undefined) throw Error('source');
    const f = { ...paid(1, 1, 0, 4, 4), skillKey: key };
    expect(
      evaluate(proof(context(1, { skillStageStats: low, facts: [f] }))).ledger.learnedSkills[0]
        ?.skillKey,
    ).toBe('STEALTH');
    expect(() =>
      evaluate(proof(context(1, { skillStageStats: low, effectiveStats: low, facts: [f] }))),
    ).toThrow('REQ-');
  });
});
