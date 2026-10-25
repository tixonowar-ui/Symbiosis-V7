import { describe, expect, it } from 'vitest';

import type { RollMode } from '../../entities/roll-request/roll-model.js';
import type { RandomSymbiontRaceCode } from './catalog.js';
import {
  appendRandomSymbiontPhysicalRoll,
  commitRandomSymbiontBindings,
  createRandomSymbiontSequence,
  resolveRandomSymbiontSequence,
  type ResolvedRandomSymbiontSequence,
} from './random-sequence.js';
import {
  advisorRoll,
  CATALOG,
  confirmation,
  origin,
  suppressionRoll,
} from '../../../../tests/fixtures/symbiont-stage.js';

function start(
  raceCode: RandomSymbiontRaceCode = 'UNITED',
  diceInputModeSnapshot: RollMode = 'AUTO',
): ResolvedRandomSymbiontSequence {
  return createRandomSymbiontSequence(CATALOG, {
    randomSequenceId: 'sequence-1',
    raceCode,
    diceInputModeSnapshot,
  });
}

function append(
  current: ResolvedRandomSymbiontSequence,
  roll: Parameters<typeof appendRandomSymbiontPhysicalRoll>[2],
): ResolvedRandomSymbiontSequence {
  return appendRandomSymbiontPhysicalRoll(CATALOG, current.sequence, roll);
}

function ordinary(
  faces: readonly number[],
  raceCode: RandomSymbiontRaceCode = 'UNITED',
  diceInputModeSnapshot: RollMode = 'AUTO',
): ResolvedRandomSymbiontSequence {
  let result = start(raceCode, diceInputModeSnapshot);
  for (const [index, face] of faces.entries()) {
    if (face === 1 || face === 20)
      throw new Error('ordinary helper accepts only noncritical faces');
    result = append(result, origin(face, `roll-${String(index)}`));
  }
  return result;
}

function sourceNeutral(result: ResolvedRandomSymbiontSequence) {
  return {
    randomStatus: result.randomStatus,
    nextRequest: result.nextRequest,
    accepted: result.accepted,
    acceptedOrdinaryCount: result.acceptedOrdinaryCount,
    duplicateRerollReceipts: result.duplicateRerollReceipts,
    composition: result.composition,
    advisorOrNull: result.advisorOrNull,
    drawnSpeciesAndBindings: result.drawnSpeciesAndBindings,
  };
}

describe('CHR-020 durable random symbiont sequence', () => {
  it('stops FREE after one accepted ordinary and revalidates the persisted result', () => {
    const initial = start('FREE');
    expect(initial).toMatchObject({
      randomStatus: 'NOT_STARTED',
      nextRequest: { kind: 'SPECIES_ORIGIN' },
      acceptedOrdinaryCount: 0,
    });
    const rolled = append(initial, origin(2, 'free-origin'));
    expect(rolled).toMatchObject({
      randomStatus: 'BINDING',
      nextRequest: { kind: 'BINDING' },
      acceptedOrdinaryCount: 1,
    });
    expect(rolled.accepted.map((entry) => entry.speciesKey)).toEqual(['TAIPAN']);
    expect(rolled.composition.slotUsage).toBe(1);
    expect(() => append(rolled, origin(3, 'forbidden-extra'))).toThrow(
      'physical rolls are complete',
    );

    const committed = commitRandomSymbiontBindings(CATALOG, rolled.sequence);
    expect(committed.randomStatus).toBe('COMMITTED');
    expect(committed.sequence.physicalRolls).toHaveLength(1);
    expect(resolveRandomSymbiontSequence(CATALOG, structuredClone(committed.sequence))).toEqual(
      committed,
    );
  });

  it('accepts four UNITED ordinary results and no fifth result', () => {
    const result = ordinary([2, 3, 4, 5]);
    expect(result.accepted.map((entry) => entry.speciesKey)).toEqual([
      'TAIPAN',
      'OWL',
      'TEACHER',
      'ARMADILLO',
    ]);
    expect(result.acceptedOrdinaryCount).toBe(4);
    expect(result.nextRequest).toEqual({ kind: 'BINDING' });
    expect(result.composition.slotUsage).toBe(4);
    expect(() => append(result, origin(6, 'fifth'))).toThrow('physical rolls are complete');
  });

  it('records each duplicate as a separate addressed physical receipt without accepted count', () => {
    let result = ordinary([2, 2, 3]);
    expect(result.accepted.map((entry) => entry.speciesKey)).toEqual(['TAIPAN', 'OWL']);
    expect(result.acceptedOrdinaryCount).toBe(2);
    expect(result.duplicateRerollReceipts).toEqual([
      {
        rollRequestId: 'roll-1-request',
        rollReceiptId: 'roll-1-receipt',
        speciesKey: 'TAIPAN',
        duplicateOfAcceptedIndex: 0,
      },
    ]);
    expect(result.sequence.physicalRolls).toHaveLength(3);
    expect(result.nextRequest).toEqual({ kind: 'SPECIES_ORIGIN' });

    const previous = result.sequence.physicalRolls;
    result = append(result, origin(4, 'roll-3'));
    expect(result.sequence.physicalRolls.slice(0, previous.length)).toEqual(previous);
    expect(previous).toHaveLength(3);
    expect(Object.isFrozen(result.sequence.physicalRolls)).toBe(true);
  });

  it.each([
    { originFace: 20, confirmationFace: 15, tableSpeciesKey: 'SKUNK' },
    { originFace: 1, confirmationFace: 5, tableSpeciesKey: 'WEAVER' },
  ])(
    'replaces the first confirmed $originFace critical with a chosen four-slot monster',
    ({ originFace, confirmationFace, tableSpeciesKey }) => {
      let result = start();
      result = append(result, origin(originFace, 'critical-origin'));
      expect(result.nextRequest).toEqual({
        kind: 'CRITICAL_CONFIRMATION',
        originRollRequestId: 'critical-origin-request',
        monsterEligible: true,
      });
      result = append(
        result,
        confirmation('critical-origin-request', confirmationFace, 'critical-confirm-success'),
      );
      result = append(
        result,
        confirmation(
          'critical-origin-request',
          originFace === 20 ? 14 : 6,
          'critical-confirm-miss',
          'CHIMERA',
        ),
      );
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0]).toMatchObject({
        speciesKey: 'CHIMERA',
        tableSpeciesKey,
        kind: 'SYMBIOTIC_MONSTER',
        critical: { criticalGrade: 1, terminal: true },
      });
      expect(result.acceptedOrdinaryCount).toBe(0);
      expect(result.composition).toMatchObject({ slotUsage: 4, slotCapacity: 4 });
      expect(result.nextRequest).toEqual({ kind: 'BINDING' });
      expect(() => append(result, origin(2, 'after-monster'))).toThrow(
        'physical rolls are complete',
      );
    },
  );

  it('persists monster selection on the fifth successful confirmation at grade cap', () => {
    let result = start();
    result = append(result, origin(20, 'cap-origin'));
    for (const [index, face] of [15, 16, 17, 18].entries()) {
      result = append(
        result,
        confirmation('cap-origin-request', face, `cap-confirm-${String(index + 1)}`),
      );
      expect(result.nextRequest).toMatchObject({ kind: 'CRITICAL_CONFIRMATION' });
      expect(result.accepted).toHaveLength(0);
    }
    result = append(
      result,
      confirmation('cap-origin-request', 19, 'cap-confirm-5', 'PLAGUE_DOCTOR'),
    );

    expect(result.accepted[0]).toMatchObject({
      speciesKey: 'PLAGUE_DOCTOR',
      kind: 'SYMBIOTIC_MONSTER',
      critical: { criticalGrade: 5, criticalPolarity: 'SUCCESS', terminal: true },
    });
    expect(result.sequence.physicalRolls).toHaveLength(6);
    expect(
      resolveRandomSymbiontSequence(CATALOG, structuredClone(result.sequence)).accepted,
    ).toEqual(result.accepted);
  });

  it('keeps a confirmed first critical after a later confirmation miss', () => {
    let result = start();
    result = append(result, origin(20, 'origin'));
    result = append(result, confirmation('origin-request', 18, 'confirm-1'));
    expect(result.nextRequest).toMatchObject({ kind: 'CRITICAL_CONFIRMATION' });
    expect(result.accepted).toHaveLength(0);
    result = append(result, confirmation('origin-request', 14, 'confirm-2', 'PUPPETEER'));
    expect(result.accepted[0]).toMatchObject({
      speciesKey: 'PUPPETEER',
      critical: { criticalGrade: 1, criticalPolarity: 'SUCCESS' },
    });
    expect(result.sequence.physicalRolls).toHaveLength(3);
  });

  it('uses the ordinary table for an unconfirmed first critical', () => {
    let result = start('FREE');
    result = append(result, origin(20, 'origin'));
    result = append(result, confirmation('origin-request', 14, 'confirm'));
    expect(result.accepted[0]).toMatchObject({
      speciesKey: 'SKUNK',
      kind: 'ORDINARY',
      critical: { criticalGrade: 0, criticalPolarity: 'NONE' },
    });
    expect(result.nextRequest).toEqual({ kind: 'BINDING' });
  });

  it('keeps the first critical in a sequence ordinary after earlier duplicate rolls', () => {
    let result = ordinary([2, 2]);
    result = append(result, origin(20, 'first-critical-origin'));
    expect(result.nextRequest).toMatchObject({
      kind: 'CRITICAL_CONFIRMATION',
      monsterEligible: false,
    });
    result = append(
      result,
      confirmation('first-critical-origin-request', 15, 'first-critical-success'),
    );
    result = append(
      result,
      confirmation('first-critical-origin-request', 14, 'first-critical-miss'),
    );

    expect(result.accepted.map((entry) => entry.speciesKey)).toEqual(['TAIPAN', 'SKUNK']);
    expect(result.accepted[1]?.critical).toMatchObject({ criticalGrade: 1, terminal: true });
    expect(result.duplicateRerollReceipts).toHaveLength(1);
    expect(result.composition.instances.every((entry) => entry.kind === 'ORDINARY')).toBe(true);
  });

  it('uses the ordinary table for a later confirmed crit and forbids a monster snapshot', () => {
    let result = ordinary([2]);
    result = append(result, origin(20, 'late-origin'));
    expect(result.nextRequest).toMatchObject({
      kind: 'CRITICAL_CONFIRMATION',
      monsterEligible: false,
    });
    result = append(result, confirmation('late-origin-request', 15, 'late-confirm-success'));
    result = append(result, confirmation('late-origin-request', 14, 'late-confirm-miss'));
    expect(result.accepted.map((entry) => entry.speciesKey)).toEqual(['TAIPAN', 'SKUNK']);
    expect(result.accepted[1]?.critical).toMatchObject({ criticalGrade: 1 });
    expect(result.composition.instances.every((entry) => entry.kind === 'ORDINARY')).toBe(true);

    let forbidden = ordinary([2]);
    forbidden = append(forbidden, origin(20, 'late-origin'));
    expect(() =>
      append(forbidden, confirmation('late-origin-request', 15, 'late-confirm', 'CHIMERA')),
    ).toThrow('forbidden monster selection');
  });

  it('never unlocks a monster for FREE even on a confirmed first critical', () => {
    let result = start('FREE');
    result = append(result, origin(20, 'origin'));
    expect(result.nextRequest).toMatchObject({ monsterEligible: false });
    expect(() => append(result, confirmation('origin-request', 15, 'confirm', 'CHIMERA'))).toThrow(
      'forbidden monster selection',
    );
    result = append(result, confirmation('origin-request', 15, 'confirm-success'));
    result = append(result, confirmation('origin-request', 14, 'confirm-miss'));
    expect(result.accepted[0]).toMatchObject({ speciesKey: 'SKUNK', kind: 'ORDINARY' });
  });

  it('commits an exact side snapshot without another physical roll', () => {
    const rolled = ordinary([3], 'FREE');
    expect(rolled.randomStatus).toBe('BINDING');
    expect(rolled.drawnSpeciesAndBindings[0]?.binding).toEqual({
      kind: 'OWL_EYE',
      side: 'RIGHT',
    });
    const committed = commitRandomSymbiontBindings(CATALOG, rolled.sequence, [
      { speciesKey: 'OWL', side: 'LEFT' },
    ]);
    expect(committed.randomStatus).toBe('COMMITTED');
    expect(committed.nextRequest).toEqual({ kind: 'COMMITTED' });
    expect(committed.sequence.physicalRolls).toHaveLength(1);
    expect(committed.drawnSpeciesAndBindings[0]?.binding).toEqual({
      kind: 'OWL_EYE',
      side: 'LEFT',
    });
    expect(() =>
      commitRandomSymbiontBindings(CATALOG, committed.sequence, [
        { speciesKey: 'OWL', side: 'RIGHT' },
      ]),
    ).toThrow('requires BINDING');
  });

  it('produces the same pure result for AUTO and MANUAL mechanical records', () => {
    const build = (mode: RollMode) => {
      let result = ordinary([2, 2, 3, 4], 'UNITED', mode);
      result = append(result, origin(20, 'late-origin'));
      result = append(result, confirmation('late-origin-request', 15, 'late-confirm-success'));
      return append(result, confirmation('late-origin-request', 14, 'late-confirm-miss'));
    };
    const automatic = build('AUTO');
    const manual = build('MANUAL');
    expect(sourceNeutral(automatic)).toEqual(sourceNeutral(manual));
    expect(automatic.acceptedOrdinaryCount).toBe(4);
    expect(automatic.duplicateRerollReceipts).toHaveLength(1);
    expect(automatic.sequence.diceInputModeSnapshot).toBe('AUTO');
    expect(manual.sequence.diceInputModeSnapshot).toBe('MANUAL');
  });

  it('revalidates identical serialized records without seed or sampler state', () => {
    const committed = commitRandomSymbiontBindings(CATALOG, ordinary([2, 2, 3, 4, 5]).sequence);
    const serialized = JSON.stringify(committed.sequence);
    for (const path of ['first JSON round-trip', 'second JSON round-trip']) {
      const restored = resolveRandomSymbiontSequence(
        CATALOG,
        JSON.parse(serialized) as typeof committed.sequence,
      );
      expect(restored, path).toEqual(committed);
    }
    expect(serialized).not.toContain('seed');
    expect(serialized).not.toContain('sampler');
    expect(serialized).not.toContain('rngState');
  });

  it('creates random Advisor I/W in order and carries both receipts into binding', () => {
    let result = ordinary([9], 'FREE');
    expect(result.nextRequest).toEqual({ kind: 'ADVISOR_I', advisorAcceptedIndex: 0 });
    expect(result.randomStatus).toBe('PENDING');
    result = append(result, advisorRoll('ADVISOR_I', 0, 1, 'advisor-i'));
    expect(result.nextRequest).toEqual({ kind: 'ADVISOR_W', advisorAcceptedIndex: 0 });
    expect(result.advisorOrNull).toMatchObject({
      advisorIPlus8OrNull: 9,
      advisorWPlus8OrNull: null,
      iwRollRequestIds: ['advisor-i-request', null],
    });
    result = append(result, advisorRoll('ADVISOR_W', 0, 20, 'advisor-w'));
    expect(result.nextRequest).toEqual({ kind: 'BINDING' });
    expect(result.advisorOrNull).toMatchObject({
      advisorIPlus8OrNull: 9,
      advisorWPlus8OrNull: 28,
      iwRollRequestIds: ['advisor-i-request', 'advisor-w-request'],
      iwRollReceiptIds: ['advisor-i-receipt', 'advisor-w-receipt'],
      effectsActive: true,
      suppressionOrNull: null,
      advisorIwOrNull: { I: { rawFace: 1, value: 9 }, W: { rawFace: 20, value: 28 } },
    });
    expect(result.advisorOrNull?.advisorIwOrNull).not.toHaveProperty('criticalGrade');
    const committed = commitRandomSymbiontBindings(CATALOG, result.sequence);
    expect(committed.sequence.physicalRolls).toHaveLength(3);
    expect(committed.advisorOrNull).toEqual(result.advisorOrNull);
  });

  it('requires a separate B roll under Trogr and preserves inactive Advisor I/W', () => {
    let result = ordinary([7, 9]);
    result = append(result, advisorRoll('ADVISOR_I', 1, 8, 'advisor-i'));
    result = append(result, advisorRoll('ADVISOR_W', 1, 8, 'advisor-w'));
    expect(result.nextRequest).toEqual({ kind: 'TROGR_SUPPRESSION_B', advisorAcceptedIndex: 1 });
    expect(result.advisorOrNull).toMatchObject({
      effectsActive: false,
      advisorIPlus8OrNull: 16,
      advisorWPlus8OrNull: 16,
      suppressionOrNull: { suppressionBOrNull: null, minimumIOrNull: null },
    });
    result = append(result, suppressionRoll(1, 2, 'suppression'));
    expect(result.advisorOrNull).toMatchObject({
      effectsActive: false,
      advisorIPlus8OrNull: 16,
      advisorWPlus8OrNull: 16,
      suppressionOrNull: {
        rollRequestIdOrNull: 'suppression-request',
        rollReceiptIdOrNull: 'suppression-receipt',
        suppressionBOrNull: 1,
        minimumIOrNull: 2,
      },
    });
    result = append(result, origin(2, 'taipan'));
    result = append(result, origin(16, 'toad'));
    expect(result.acceptedOrdinaryCount).toBe(4);
    expect(result.nextRequest).toEqual({ kind: 'BINDING' });
    expect(result.advisorOrNull?.advisorIwOrNull).toEqual({
      I: { rawFace: 8, value: 16 },
      W: { rawFace: 8, value: 16 },
    });
  });

  it('uses 4+B after absorbed Teacher and reuses B when records are revalidated', () => {
    let result = ordinary([4, 7, 9]);
    result = append(result, advisorRoll('ADVISOR_I', 2, 8, 'advisor-i'));
    result = append(result, advisorRoll('ADVISOR_W', 2, 8, 'advisor-w'));
    result = append(result, suppressionRoll(2, 10, 'suppression'));
    expect(result.advisorOrNull?.suppressionOrNull).toMatchObject({
      suppressionBOrNull: 3,
      minimumIOrNull: 7,
    });
    const restored = resolveRandomSymbiontSequence(CATALOG, structuredClone(result.sequence));
    expect(restored.sequence.physicalRolls).toHaveLength(6);
    expect(restored.advisorOrNull).toEqual(result.advisorOrNull);
  });

  it('does not refill accepted results destroyed by interactions', () => {
    const result = ordinary([8, 7, 12, 11]);
    expect(result.acceptedOrdinaryCount).toBe(4);
    expect(result.composition.slotUsage).toBe(3);
    expect(
      result.composition.instances.find((entry) => entry.speciesKey === 'KEEPER')?.status,
    ).toBe('DESTROYED');
    expect(result.nextRequest).toEqual({ kind: 'BINDING' });
    expect(() => append(result, origin(5, 'refill'))).toThrow('physical rolls are complete');
  });

  it('treats even a destroyed species as consumed for later duplicate checks', () => {
    const result = ordinary([8, 7, 8, 12, 11]);
    expect(result.acceptedOrdinaryCount).toBe(4);
    expect(result.duplicateRerollReceipts).toEqual([
      {
        rollRequestId: 'roll-2-request',
        rollReceiptId: 'roll-2-receipt',
        speciesKey: 'KEEPER',
        duplicateOfAcceptedIndex: 0,
      },
    ]);
    expect(result.composition.slotUsage).toBe(3);
    expect(result.nextRequest).toEqual({ kind: 'BINDING' });
  });

  it('rejects wrong requests, identities, critical payloads, and premature bindings', () => {
    const initial = start();
    expect(() => append(initial, advisorRoll('ADVISOR_I', 0, 8, 'wrong-kind'))).toThrow(
      'does not match required SPECIES_ORIGIN',
    );
    expect(() => append(initial, origin(21, 'bad-face'))).toThrow('1..20');

    const duplicateId = ordinary([2]);
    expect(() => append(duplicateId, origin(3, 'roll-0'))).toThrow(
      'duplicate roll/sequence identity',
    );

    let missingMonster = start();
    missingMonster = append(missingMonster, origin(20, 'origin'));
    missingMonster = append(missingMonster, confirmation('origin-request', 15, 'confirm-success'));
    expect(() =>
      append(missingMonster, confirmation('origin-request', 14, 'confirm-miss')),
    ).toThrow('requires a monster selection');
    expect(() =>
      append(missingMonster, confirmation('wrong-origin-request', 15, 'confirm', 'CHIMERA')),
    ).toThrow('wrong origin roll');
    expect(() => commitRandomSymbiontBindings(CATALOG, missingMonster.sequence)).toThrow(
      'requires BINDING',
    );

    let pendingSelection = start();
    pendingSelection = append(pendingSelection, origin(20, 'origin'));
    pendingSelection = append(pendingSelection, confirmation('origin-request', 18, 'confirm-1'));
    expect(() =>
      append(pendingSelection, confirmation('origin-request', 19, 'confirm-2', 'CHIMERA')),
    ).toThrow('forbidden monster selection');

    const malformed = structuredClone(missingMonster.sequence) as unknown as Record<
      string,
      unknown
    >;
    malformed.extra = true;
    expect(() =>
      resolveRandomSymbiontSequence(
        CATALOG,
        malformed as unknown as typeof missingMonster.sequence,
      ),
    ).toThrow('keys must be exact');
  });
});
