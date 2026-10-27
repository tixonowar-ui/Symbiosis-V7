import { describe, expect, it } from 'vitest';

import type {
  RandomSymbiontRaceCode,
  SymbiontBindingSelection,
  SymbiontSpeciesKey,
} from './catalog.js';
import {
  deriveManualInteractionPreview,
  validateManualSymbiontComposition,
} from './manual-composition.js';
import { CATALOG } from '../../../../tests/fixtures/symbiont-stage.js';

function compositionInput(
  raceCode: RandomSymbiontRaceCode,
  speciesKeys: readonly SymbiontSpeciesKey[],
  selectedBindings: readonly SymbiontBindingSelection[] = [],
) {
  return {
    raceCode,
    acceptedSpecies: speciesKeys.map((speciesKey, acceptedIndex) => ({
      acceptedIndex,
      speciesKey,
    })),
    selectedBindings,
  };
}

describe('CHR-018 manual composition validation and CHR-042 preview', () => {
  it('accepts exact FREE and UNITED compositions with complete binding snapshots', () => {
    const free = validateManualSymbiontComposition(CATALOG, compositionInput('FREE', ['EEL']));
    expect(free.composition).toMatchObject({
      raceCode: 'FREE',
      acceptedOrdinaryCount: 1,
      slotCapacity: 1,
      slotUsage: 1,
    });
    expect(free.bindings).toEqual([
      { acceptedIndex: 0, speciesKey: 'EEL', binding: { kind: 'EEL_ARM', side: 'RIGHT' } },
    ]);

    const united = validateManualSymbiontComposition(
      CATALOG,
      compositionInput(
        'UNITED',
        ['OWL', 'TICK', 'SPIDER', 'MANTIS'],
        [{ speciesKey: 'OWL', side: 'LEFT' }],
      ),
    );
    expect(united.composition).toMatchObject({
      acceptedOrdinaryCount: 4,
      slotCapacity: 4,
      slotUsage: 4,
      interactions: [],
    });
    expect(united.bindings).toEqual([
      { acceptedIndex: 0, speciesKey: 'OWL', binding: { kind: 'OWL_EYE', side: 'LEFT' } },
      { acceptedIndex: 1, speciesKey: 'TICK', binding: { kind: 'TICK_RIGHT_HAND' } },
      { acceptedIndex: 2, speciesKey: 'SPIDER', binding: { kind: 'SPIDER_BOTH_WRISTS' } },
      { acceptedIndex: 3, speciesKey: 'MANTIS', binding: { kind: 'MANTIS_BOTH_FOREARMS' } },
    ]);
  });

  it('accepts a sole UNITED monster and rejects duplicate, overcap and invalid removal', () => {
    const monster = validateManualSymbiontComposition(
      CATALOG,
      compositionInput('UNITED', ['CHIMERA']),
    );
    expect(monster.composition).toMatchObject({
      acceptedOrdinaryCount: 0,
      slotCapacity: 4,
      slotUsage: 4,
    });

    expect(() =>
      validateManualSymbiontComposition(
        CATALOG,
        compositionInput('UNITED', ['WEAVER', 'WEAVER', 'OWL', 'TROGR']),
      ),
    ).toThrow('duplicate species');
    expect(() =>
      validateManualSymbiontComposition(
        CATALOG,
        compositionInput('UNITED', ['WEAVER', 'TAIPAN', 'OWL', 'TEACHER', 'ARMADILLO']),
      ),
    ).toThrow('up to four');
    expect(() =>
      validateManualSymbiontComposition(CATALOG, compositionInput('UNITED', ['CHIMERA', 'WEAVER'])),
    ).toThrow('sole accepted result');
    expect(() => validateManualSymbiontComposition(CATALOG, compositionInput('FREE', []))).toThrow(
      'FREE requires exactly one ordinary species',
    );
    expect(() =>
      validateManualSymbiontComposition(CATALOG, compositionInput('UNITED', ['WEAVER', 'OWL'])),
    ).toThrow('UNITED requires four different ordinary species or one monster');
    expect(() =>
      validateManualSymbiontComposition(CATALOG, compositionInput('FREE', ['CHIMERA'])),
    ).toThrow('sole accepted result for UNITED');
  });

  it('replaces the full draft without refilling or losing binding provenance', () => {
    const before = validateManualSymbiontComposition(
      CATALOG,
      compositionInput(
        'UNITED',
        ['OWL', 'TICK', 'SPIDER', 'MANTIS'],
        [{ speciesKey: 'OWL', side: 'LEFT' }],
      ),
    );
    const after = validateManualSymbiontComposition(
      CATALOG,
      compositionInput(
        'UNITED',
        ['EEL', 'OWL', 'TROGR', 'WEAVER'],
        [{ speciesKey: 'OWL', side: 'LEFT' }],
      ),
    );

    expect(before.composition.acceptedSpecies).toHaveLength(4);
    expect(after.composition).toMatchObject({
      acceptedOrdinaryCount: 4,
      slotCapacity: 4,
      slotUsage: 4,
      interactions: [],
    });
    expect(after.composition.acceptedSpecies).toEqual([
      { acceptedIndex: 0, speciesKey: 'EEL' },
      { acceptedIndex: 1, speciesKey: 'OWL' },
      { acceptedIndex: 2, speciesKey: 'TROGR' },
      { acceptedIndex: 3, speciesKey: 'WEAVER' },
    ]);
    expect(after.bindings).toEqual([
      { acceptedIndex: 0, speciesKey: 'EEL', binding: { kind: 'EEL_ARM', side: 'RIGHT' } },
      { acceptedIndex: 1, speciesKey: 'OWL', binding: { kind: 'OWL_EYE', side: 'LEFT' } },
      { acceptedIndex: 2, speciesKey: 'TROGR', binding: { kind: 'NONE' } },
      { acceptedIndex: 3, speciesKey: 'WEAVER', binding: { kind: 'NONE' } },
    ]);
    expect(before.bindings).not.toEqual(after.bindings);
  });

  it('derives exact interaction, slot, OE and modifier diffs without executing a runtime commit', () => {
    const beforeInput = compositionInput('UNITED', ['KEEPER', 'WEAVER', 'CRICKET', 'TAIPAN']);
    const afterInput = compositionInput('UNITED', ['TROGR', 'KEEPER', 'OWL', 'ADVISER']);
    const preview = deriveManualInteractionPreview(CATALOG, {
      before: beforeInput,
      after: afterInput,
    });

    expect(preview.compositionBefore.composition.slotUsage).toBe(4);
    expect(preview.compositionAfter.composition.slotUsage).toBe(3);
    expect(preview.compositionBefore.bindings).toHaveLength(4);
    expect(preview.compositionAfter.bindings).toHaveLength(4);
    expect(preview.interactionGraph).toEqual({
      kind: 'INTERACTIONS',
      entries: [
        {
          kind: 'CURRENT_OE_DUEL',
          trogrAcceptedIndex: 0,
          keeperAcceptedIndex: 1,
          trogrCurrentOeBefore: 1000,
          keeperCurrentOeBefore: 100,
          outcome: 'KEEPER_DESTROYED',
          winnerCurrentOeAfterOrNull: 900,
        },
        {
          kind: 'SPECIES_SUPPRESSION',
          suppressorAcceptedIndex: 0,
          suppressedAcceptedIndex: 3,
          suppressorSpeciesKey: 'TROGR',
          suppressedSpeciesKey: 'ADVISER',
        },
      ],
    });
    expect(preview.interactionGraph.kind).toBe('INTERACTIONS');
    if (preview.interactionGraph.kind !== 'INTERACTIONS') {
      throw new Error('expected interaction preview');
    }
    expect(preview.suppressionDestructionAbsorption).toEqual({
      kind: 'CONSEQUENCES',
      entries: preview.interactionGraph.entries,
    });
    expect(preview.irreversibleOperationIds).toEqual(['CURRENT_OE_DUEL', 'SPECIES_SUPPRESSION']);
    expect(preview.slotStatOeDiff).toEqual({
      slotUsageBefore: 4,
      slotUsageAfter: 3,
      entries: [
        {
          speciesKey: 'TROGR',
          before: null,
          after: { slotCost: 1, currentOe: 900, status: 'ACTIVE' },
        },
        {
          speciesKey: 'KEEPER',
          before: { slotCost: 1, currentOe: 100, status: 'ACTIVE' },
          after: { slotCost: 0, currentOe: 100, status: 'DESTROYED' },
        },
        {
          speciesKey: 'OWL',
          before: null,
          after: { slotCost: 1, currentOe: 10, status: 'ACTIVE' },
        },
        {
          speciesKey: 'ADVISER',
          before: null,
          after: { slotCost: 1, currentOe: 20, status: 'SUPPRESSED' },
        },
        {
          speciesKey: 'WEAVER',
          before: { slotCost: 1, currentOe: 50, status: 'ACTIVE' },
          after: null,
        },
        {
          speciesKey: 'CRICKET',
          before: { slotCost: 1, currentOe: 50, status: 'ACTIVE' },
          after: null,
        },
        {
          speciesKey: 'TAIPAN',
          before: { slotCost: 1, currentOe: 50, status: 'ACTIVE' },
          after: null,
        },
      ],
      modifierBreakdownBefore: {
        kind: 'ADDITIVE_STAT_MODIFIERS',
        entries: [{ statCode: 'Z', statLabel: 'Здоровье', delta: -5 }],
      },
      modifierBreakdownAfter: {
        kind: 'ADDITIVE_STAT_MODIFIERS',
        entries: [{ statCode: 'W', statLabel: 'Мудрость', delta: 5 }],
      },
    });
    expect(beforeInput).toEqual(
      compositionInput('UNITED', ['KEEPER', 'WEAVER', 'CRICKET', 'TAIPAN']),
    );
    expect(afterInput).toEqual(compositionInput('UNITED', ['TROGR', 'KEEPER', 'OWL', 'ADVISER']));
  });

  it('uses positive empty variants and does not expose internal rule or conflict IDs', () => {
    const preview = deriveManualInteractionPreview(CATALOG, {
      before: compositionInput('FREE', ['WEAVER']),
      after: compositionInput('FREE', ['WEAVER']),
    });
    expect(preview.interactionGraph).toEqual({ kind: 'NO_INTERACTIONS' });
    expect(preview.suppressionDestructionAbsorption).toEqual({ kind: 'NONE' });
    expect(preview.irreversibleOperationIds).toEqual([]);
    expect(preview.slotStatOeDiff.entries).toEqual([]);
    const serialized = JSON.stringify(preview);
    for (const forbidden of [
      'ConflictID',
      'ProfileRuleID',
      'ModifierID',
      'Rule IDs',
      'Источник',
      'Source Question IDs',
      'Resolution',
      'seed',
      'availabilityTrace',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
