import { describe, expect, it, vi } from 'vitest';
import { prepareNpcLifeRollFact, verifyNpcLifeRollOutcome } from './npc-life-roll.js';
import {
  npcLifeStateRollFactValue,
  verifyNpcLifeRollFactBinding,
} from '../persistence/npc-life-facts.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function allocate() {
  let next = 2;
  return () => id(next++);
}

describe('actual formal life roll outcome', () => {
  it('samples AUTO once and preserves the exact receipt and mechanical face on historical read', () => {
    const sample = vi.fn(() => 4),
      fact = prepareNpcLifeRollFact(id(1), 'AUTO', null, allocate(), sample),
      original = JSON.stringify(fact);
    expect(sample).toHaveBeenCalledExactlyOnceWith(6);
    expect(fact.fact).toEqual({
      factId: id(2),
      sourceRuleId: 'CORE-153',
      roll: { dieSides: 6, rawFace: 4 },
    });
    expect(fact.receiptId).toBe(id(3));
    expect(fact.source).toEqual({
      dieSides: 6,
      modeSnapshot: 'AUTO',
      originatingCommandId: id(1),
      rollRequestId: id(4),
    });
    verifyNpcLifeRollOutcome(fact, 'AUTO', null);
    verifyNpcLifeRollOutcome(
      npcLifeStateRollFactValue(JSON.parse(original) as unknown),
      'AUTO',
      null,
    );
    expect(sample).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fact)).toBe(original);
    expect(() => verifyNpcLifeRollOutcome(fact, 'AUTO', 4)).toThrow();
    expect(() => verifyNpcLifeRollOutcome(fact, 'MANUAL', 4)).toThrow();
    expect(() => prepareNpcLifeRollFact(id(1), 'AUTO', 4, allocate(), sample)).toThrow();
    expect(sample).toHaveBeenCalledTimes(1);
  });

  it('keeps MANUAL as the actual submitted face and rejects a changed request without randomness', () => {
    const sample = vi.fn(() => 6),
      fact = prepareNpcLifeRollFact(id(1), 'MANUAL', 2, allocate(), sample);
    verifyNpcLifeRollOutcome(fact, 'MANUAL', 2);
    expect(fact.fact.roll).toEqual({ dieSides: 6, rawFace: 2 });
    expect(() => verifyNpcLifeRollOutcome(fact, 'MANUAL', 3)).toThrow();
    for (const face of [null, 0, 7, 1.5, Number.NaN])
      expect(() => prepareNpcLifeRollFact(id(1), 'MANUAL', face, allocate(), sample)).toThrow();
    expect(sample).not.toHaveBeenCalled();
  });

  it('requires the exact closed D6 record and binds its original preparation and receipt', () => {
    const fact = prepareNpcLifeRollFact(id(1), 'AUTO', null, allocate(), () => 1),
      operation = {
        operationId: id(1),
        receiptId: id(3),
        kind: 'REPLACE' as const,
        request: {
          messageType: 'network.npc-preparation.request',
          sourceFormId: 'NPC-016',
          preparation: { kind: 'LIFE_STATE_ROLL' },
        },
      },
      attempt = { stage: 'NPC-016' as const, status: 'OPEN' as const };
    verifyNpcLifeRollFactBinding(fact, operation, attempt);
    for (const changed of [
      { ...fact, extra: true },
      { ...fact, receiptId: fact.fact.factId },
      { ...fact, fact: { ...fact.fact, sourceRuleId: 'CORE-154' } },
      { ...fact, fact: { ...fact.fact, roll: { dieSides: 20, rawFace: 1 } } },
      { ...fact, source: { ...fact.source, extra: true } },
    ])
      expect(() => npcLifeStateRollFactValue(changed)).toThrow();
    expect(() => verifyNpcLifeRollFactBinding(null, operation, attempt)).toThrow();
    expect(() =>
      verifyNpcLifeRollFactBinding(fact, { ...operation, operationId: id(99) }, attempt),
    ).toThrow();
    expect(() =>
      verifyNpcLifeRollFactBinding(fact, { ...operation, receiptId: id(99) }, attempt),
    ).toThrow();
    expect(() =>
      verifyNpcLifeRollFactBinding(fact, operation, { ...attempt, status: 'COMMITTED' }),
    ).toThrow();
    expect(() =>
      verifyNpcLifeRollFactBinding(
        fact,
        {
          ...operation,
          request: { ...operation.request, preparation: { kind: 'LIFE_STATE_SET' } },
        },
        attempt,
      ),
    ).toThrow();
  });
});
