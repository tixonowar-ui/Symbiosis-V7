import { describe, expect, it } from 'vitest';

import {
  advisorRoll,
  CATALOG,
  confirmation,
  origin,
  suppressionRoll,
} from '../../../../tests/fixtures/symbiont-stage.js';
import { createSymbiontBindingSnapshot } from '../symbiont-stage/catalog.js';
import {
  appendRandomSymbiontPhysicalRoll,
  commitRandomSymbiontBindings,
  createRandomSymbiontSequence,
  resolveCreationCorrectionRandomSequence,
  type CreationCorrectionRandomSequence,
  type RandomSymbiontPhysicalRoll,
  type RandomSymbiontSequence,
} from '../symbiont-stage/random-sequence.js';

function source(
  raceCode: 'UNITED' | 'FREE',
  rolls: readonly RandomSymbiontPhysicalRoll[],
): RandomSymbiontSequence {
  let result = createRandomSymbiontSequence(CATALOG, {
    randomSequenceId: 'original',
    raceCode,
    diceInputModeSnapshot: 'AUTO',
  });
  for (const roll of rolls)
    result = appendRandomSymbiontPhysicalRoll(CATALOG, result.sequence, roll);
  return commitRandomSymbiontBindings(CATALOG, result.sequence).sequence;
}
function target(
  sourceSequenceOrNull: RandomSymbiontSequence | null,
  raceCode: 'UNITED' | 'FREE',
): CreationCorrectionRandomSequence {
  return {
    sourceSequenceOrNull,
    sequence: {
      randomSequenceId: 'correction',
      raceCode,
      diceInputModeSnapshot: 'AUTO',
      physicalRolls: [],
      bindingSnapshotOrNull: null,
    },
  };
}
function append(
  current: CreationCorrectionRandomSequence,
  roll: RandomSymbiontPhysicalRoll,
): CreationCorrectionRandomSequence {
  const next = {
    ...current,
    sequence: { ...current.sequence, physicalRolls: [...current.sequence.physicalRolls, roll] },
  };
  resolveCreationCorrectionRandomSequence(CATALOG, next);
  return next;
}
function bind(current: CreationCorrectionRandomSequence): CreationCorrectionRandomSequence {
  const resolved = resolveCreationCorrectionRandomSequence(CATALOG, current);
  return {
    ...current,
    sequence: { ...resolved.sequence, bindingSnapshotOrNull: resolved.drawnSpeciesAndBindings },
  };
}

describe('AQA-004 correction sequences retain resolved source results', () => {
  it('does not reinterpret a confirmed FREE critical as a UNITED monster', () => {
    const original = source('FREE', [
      origin(20, 'o'),
      confirmation('o-request', 15, 'c1'),
      confirmation('o-request', 14, 'c2'),
    ]);
    let correction = target(original, 'UNITED');
    let result = resolveCreationCorrectionRandomSequence(CATALOG, correction);
    expect(result.accepted[0]).toMatchObject({
      speciesKey: 'SKUNK',
      kind: 'ORDINARY',
      critical: { criticalGrade: 1 },
    });
    expect(result.nextRequest).toEqual({ kind: 'SPECIES_ORIGIN' });
    for (const [index, face] of [2, 3, 4].entries())
      correction = append(correction, origin(face, `new${String(index)}`));
    correction = bind(correction);
    result = resolveCreationCorrectionRandomSequence(CATALOG, correction);
    expect(result.nextRequest).toEqual({ kind: 'COMMITTED' });
    expect(result.accepted.map((entry) => entry.speciesKey)).toEqual([
      'SKUNK',
      'TAIPAN',
      'OWL',
      'TEACHER',
    ]);
    expect(result.sequence.physicalRolls).toHaveLength(3);
    expect(correction.sourceSequenceOrNull).toEqual(original);
    expect(resolveCreationCorrectionRandomSequence(CATALOG, structuredClone(correction))).toEqual(
      result,
    );
  });
  it('does not count duplicates of the retained first result toward the additional three', () => {
    const original = source('FREE', [origin(2, 'old')]);
    const correction = append(target(original, 'UNITED'), origin(2, 'duplicate'));
    const result = resolveCreationCorrectionRandomSequence(CATALOG, correction);
    expect(result.acceptedOrdinaryCount).toBe(1);
    expect(result.duplicateRerollReceipts[0]).toMatchObject({ duplicateOfAcceptedIndex: 0 });
  });
  it('reuses a retained Adviser card and requests only the newly needed suppression roll', () => {
    const original = source('FREE', [
      origin(9, 'old'),
      advisorRoll('ADVISOR_I', 0, 10, 'i'),
      advisorRoll('ADVISOR_W', 0, 12, 'w'),
    ]);
    let correction = target(original, 'UNITED');
    expect(resolveCreationCorrectionRandomSequence(CATALOG, correction).nextRequest).toEqual({
      kind: 'SPECIES_ORIGIN',
    });
    correction = append(correction, origin(7, 'trogr'));
    const result = resolveCreationCorrectionRandomSequence(CATALOG, correction);
    expect(result.nextRequest).toEqual({ kind: 'TROGR_SUPPRESSION_B', advisorAcceptedIndex: 0 });
    expect(result.advisorOrNull).toMatchObject({
      advisorIPlus8OrNull: 18,
      advisorWPlus8OrNull: 20,
      iwRollRequestIds: ['i-request', 'w-request'],
    });
  });
  it('selects the first ordinary UNITED result for FREE and retains inactive B provenance only in its source', () => {
    const original = source('UNITED', [
      origin(9, 'old'),
      advisorRoll('ADVISOR_I', 0, 10, 'i'),
      advisorRoll('ADVISOR_W', 0, 12, 'w'),
      origin(7, 'trogr'),
      suppressionRoll(0, 16, 'b'),
      origin(2, 'two'),
      origin(3, 'three'),
    ]);
    const result = resolveCreationCorrectionRandomSequence(CATALOG, bind(target(original, 'FREE')));
    expect(result.nextRequest).toEqual({ kind: 'COMMITTED' });
    expect(result.accepted.map((entry) => entry.speciesKey)).toEqual(['ADVISER']);
    expect(result.advisorOrNull).toMatchObject({ effectsActive: true, suppressionOrNull: null });
    expect(result.sequence.physicalRolls).toEqual([]);
  });
  it('starts a separate FREE ordinary branch for an original UNITED monster', () => {
    const original = source('UNITED', [
      origin(20, 'o'),
      confirmation('o-request', 15, 'c1'),
      confirmation('o-request', 14, 'c2', 'CHIMERA'),
    ]);
    let correction = target(original, 'FREE');
    expect(resolveCreationCorrectionRandomSequence(CATALOG, correction).accepted).toEqual([]);
    correction = bind(append(correction, origin(5, 'free')));
    expect(
      resolveCreationCorrectionRandomSequence(CATALOG, correction).accepted[0]?.speciesKey,
    ).toBe('ARMADILLO');
    expect(() =>
      resolveCreationCorrectionRandomSequence(CATALOG, target(original, 'UNITED')),
    ).toThrow(/monster source/);
  });
  it('keeps the first ordinary anatomical side and refuses its replacement', () => {
    const original0 = source('FREE', [origin(3, 'owl')]);
    const original = {
      ...original0,
      bindingSnapshotOrNull: createSymbiontBindingSnapshot(
        CATALOG,
        [{ acceptedIndex: 0, speciesKey: 'OWL' }],
        [{ speciesKey: 'OWL', side: 'LEFT' }],
      ),
    };
    const correction = target(original, 'FREE');
    expect(
      resolveCreationCorrectionRandomSequence(CATALOG, correction).drawnSpeciesAndBindings[0]
        ?.binding,
    ).toEqual({ kind: 'OWL_EYE', side: 'LEFT' });
    expect(() =>
      resolveCreationCorrectionRandomSequence(CATALOG, {
        ...correction,
        sequence: {
          ...correction.sequence,
          bindingSnapshotOrNull: original0.bindingSnapshotOrNull,
        },
      }),
    ).toThrow(/retained anatomical binding/);
  });
  it('refuses source/target collisions, noncommitted sources and mode changes', () => {
    const original = source('FREE', [origin(2, 'old')]);
    const correction = target(original, 'UNITED');
    expect(() => append(correction, origin(3, 'old'))).toThrow(/duplicate/);
    expect(() =>
      resolveCreationCorrectionRandomSequence(CATALOG, {
        ...correction,
        sourceSequenceOrNull: { ...original, bindingSnapshotOrNull: null },
      }),
    ).toThrow(/must be committed/);
    expect(() =>
      resolveCreationCorrectionRandomSequence(CATALOG, {
        ...correction,
        sequence: { ...correction.sequence, diceInputModeSnapshot: 'MANUAL' },
      }),
    ).toThrow(/locked dice/);
  });
});
