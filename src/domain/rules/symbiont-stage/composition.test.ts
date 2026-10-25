import { describe, expect, it } from 'vitest';

import type { SymbiontSpeciesKey } from './catalog.js';
import {
  createSymbiontInteractionProjection,
  deriveSymbiontModifierBreakdown,
  resolveSymbiontComposition,
  resolveSymbiontCurrentOeDuel,
} from './composition.js';
import { CATALOG } from '../../../../tests/fixtures/symbiont-stage.js';

function compose(speciesKeys: readonly SymbiontSpeciesKey[]) {
  return resolveSymbiontComposition(CATALOG, {
    raceCode: 'UNITED',
    acceptedSpecies: speciesKeys.map((speciesKey, acceptedIndex) => ({
      acceptedIndex,
      speciesKey,
    })),
  });
}

function instance(composition: ReturnType<typeof compose>, speciesKey: SymbiontSpeciesKey) {
  const found = composition.instances.find((entry) => entry.speciesKey === speciesKey);
  if (found === undefined) throw new Error(`missing ${speciesKey}`);
  return found;
}

describe('CHR-019 random composition and interactions', () => {
  it('absorbs Teacher and Dolphin in either order without freeing accepted results', () => {
    for (const speciesKeys of [
      ['TEACHER', 'DOLPHIN', 'TROGR', 'WEAVER'],
      ['TROGR', 'TEACHER', 'DOLPHIN', 'WEAVER'],
    ] as const) {
      const result = compose(speciesKeys);
      expect(result.acceptedOrdinaryCount).toBe(4);
      expect(result.slotUsage).toBe(4);
      expect(instance(result, 'TEACHER').status).toBe('ABSORBED');
      expect(instance(result, 'DOLPHIN').status).toBe('ABSORBED');
      expect(instance(result, 'TROGR')).toMatchObject({
        status: 'ACTIVE',
        slotCost: 3,
        currentOe: 1000,
        absorbedSpeciesKeys: ['TEACHER', 'DOLPHIN'],
      });
      expect(result.interactions.filter((entry) => entry.kind === 'ABSORPTION')).toHaveLength(2);
      expect(result.instances.filter((entry) => entry.status === 'ACTIVE')).toHaveLength(2);
    }
  });

  it('resolves fresh L1 Trogr/Keeper duel at 1000 versus 100 and consumes both accepted draws', () => {
    for (const speciesKeys of [
      ['KEEPER', 'TROGR', 'WEAVER', 'CRICKET'],
      ['TROGR', 'KEEPER', 'WEAVER', 'CRICKET'],
    ] as const) {
      const result = compose(speciesKeys);
      expect(result.acceptedOrdinaryCount).toBe(4);
      expect(result.slotUsage).toBe(3);
      expect(instance(result, 'KEEPER').status).toBe('DESTROYED');
      expect(instance(result, 'TROGR')).toMatchObject({ status: 'ACTIVE', currentOe: 900 });
      expect(result.interactions).toContainEqual({
        kind: 'CURRENT_OE_DUEL',
        trogrAcceptedIndex: speciesKeys.indexOf('TROGR'),
        keeperAcceptedIndex: speciesKeys.indexOf('KEEPER'),
        trogrCurrentOeBefore: 1000,
        keeperCurrentOeBefore: 100,
        outcome: 'KEEPER_DESTROYED',
        winnerCurrentOeAfterOrNull: 900,
      });
    }
  });

  it('covers both duel winners and equality from the source formula', () => {
    expect(resolveSymbiontCurrentOeDuel({ trogrCurrentOe: 1000, keeperCurrentOe: 100 })).toEqual({
      outcome: 'KEEPER_DESTROYED',
      trogrCurrentOeAfter: 900,
      keeperCurrentOeAfter: 100,
      winnerCurrentOeAfterOrNull: 900,
    });
    expect(resolveSymbiontCurrentOeDuel({ trogrCurrentOe: 100, keeperCurrentOe: 1000 })).toEqual({
      outcome: 'TROGR_DESTROYED',
      trogrCurrentOeAfter: 100,
      keeperCurrentOeAfter: 900,
      winnerCurrentOeAfterOrNull: 900,
    });
    expect(resolveSymbiontCurrentOeDuel({ trogrCurrentOe: 100, keeperCurrentOe: 100 })).toEqual({
      outcome: 'TIE',
      trogrCurrentOeAfter: 100,
      keeperCurrentOeAfter: 100,
      winnerCurrentOeAfterOrNull: null,
    });
  });

  it('does not refill Trogr OE after Dolphin absorption or a later duel', () => {
    const result = compose(['DOLPHIN', 'TROGR', 'KEEPER', 'WEAVER']);
    expect(instance(result, 'DOLPHIN').status).toBe('ABSORBED');
    expect(instance(result, 'KEEPER').status).toBe('DESTROYED');
    expect(instance(result, 'TROGR')).toMatchObject({
      slotCost: 2,
      currentOe: 900,
      absorbedSpeciesKeys: ['DOLPHIN'],
    });
    expect(result.acceptedOrdinaryCount).toBe(4);
    expect(result.slotUsage).toBe(3);
  });

  it('keeps suppressed Advisor and Penguin in slots while disabling their effects', () => {
    const result = compose(['ADVISER', 'TROGR', 'PENGUIN', 'WEAVER']);
    expect(instance(result, 'ADVISER').status).toBe('SUPPRESSED');
    expect(instance(result, 'PENGUIN').status).toBe('SUPPRESSED');
    expect(result.slotUsage).toBe(4);
    expect(
      result.interactions.filter((entry) => entry.kind === 'SPECIES_SUPPRESSION'),
    ).toHaveLength(2);
    const breakdown = deriveSymbiontModifierBreakdown(CATALOG, result, {
      equippedHermeticNate: false,
    });
    expect(breakdown.bySpecies.find((entry) => entry.speciesKey === 'ADVISER')?.effect).toEqual({
      kind: 'INACTIVE',
    });
    expect(breakdown.bySpecies.find((entry) => entry.speciesKey === 'PENGUIN')?.effect).toEqual({
      kind: 'INACTIVE',
    });
    expect(breakdown.total).toEqual({ kind: 'NO_STAT_MODIFIERS' });
  });

  it('suppresses Taipan in either order and excludes its Z-5 but not Toad Z+5', () => {
    const taipanOnly = deriveSymbiontModifierBreakdown(CATALOG, compose(['TAIPAN']), {
      equippedHermeticNate: false,
    });
    expect(taipanOnly.total).toEqual({
      kind: 'ADDITIVE_STAT_MODIFIERS',
      entries: [{ statCode: 'Z', statLabel: 'Здоровье', delta: -5 }],
    });

    for (const speciesKeys of [
      ['TAIPAN', 'TOAD'],
      ['TOAD', 'TAIPAN'],
    ] as const) {
      const result = compose(speciesKeys);
      expect(instance(result, 'TAIPAN').status).toBe('SUPPRESSED');
      expect(instance(result, 'TOAD').status).toBe('ACTIVE');
      const breakdown = deriveSymbiontModifierBreakdown(CATALOG, result, {
        equippedHermeticNate: false,
      });
      expect(breakdown.bySpecies.find((entry) => entry.speciesKey === 'TAIPAN')?.effect).toEqual({
        kind: 'INACTIVE',
      });
      expect(breakdown.total).toEqual({
        kind: 'ADDITIVE_STAT_MODIFIERS',
        entries: [{ statCode: 'Z', statLabel: 'Здоровье', delta: 5 }],
      });
    }
  });

  it('suppresses only Chameleon Double Focus and preserves Owl W+5', () => {
    const result = compose(['OWL', 'CHAMELEON']);
    expect(result.interactions).toEqual([
      {
        kind: 'ABILITY_SUPPRESSION',
        suppressorAcceptedIndex: 0,
        targetAcceptedIndex: 1,
        ability: 'DOUBLE_FOCUS',
      },
    ]);
    expect(instance(result, 'OWL').status).toBe('ACTIVE');
    expect(instance(result, 'CHAMELEON').status).toBe('ACTIVE');
    const breakdown = deriveSymbiontModifierBreakdown(CATALOG, result, {
      equippedHermeticNate: false,
    });
    expect(breakdown.total).toEqual({
      kind: 'ADDITIVE_STAT_MODIFIERS',
      entries: [{ statCode: 'W', statLabel: 'Мудрость', delta: 5 }],
    });
    expect(breakdown.bySpecies.find((entry) => entry.speciesKey === 'CHAMELEON')?.effect).toEqual({
      kind: 'NO_STAT_MODIFIERS',
    });
  });

  it('handles the closed Skunk equipment predicate without an effective-stat layer', () => {
    const result = compose(['SKUNK']);
    expect(
      deriveSymbiontModifierBreakdown(CATALOG, result, { equippedHermeticNate: false }).total,
    ).toEqual({
      kind: 'ADDITIVE_STAT_MODIFIERS',
      entries: [{ statCode: 'C', statLabel: 'Харизма', delta: -10 }],
    });
    expect(
      deriveSymbiontModifierBreakdown(CATALOG, result, { equippedHermeticNate: true }).total,
    ).toEqual({ kind: 'NO_STAT_MODIFIERS' });
  });

  it('uses four slots and source modifiers for a sole UNITED monster', () => {
    const result = compose(['CHIMERA']);
    expect(result).toMatchObject({ acceptedOrdinaryCount: 0, slotCapacity: 4, slotUsage: 4 });
    expect(
      deriveSymbiontModifierBreakdown(CATALOG, result, { equippedHermeticNate: false }).total,
    ).toEqual({
      kind: 'ADDITIVE_STAT_MODIFIERS',
      entries: [
        { statCode: 'S', statLabel: 'Сила', delta: 5 },
        { statCode: 'M', statLabel: 'Метаболизм', delta: 10 },
      ],
    });
    expect(() => compose(['CHIMERA', 'WEAVER'])).toThrow('sole accepted result');
  });

  it('projects positive empty interaction facts and actual consequences without internal IDs', () => {
    const empty = createSymbiontInteractionProjection(compose(['WEAVER']));
    expect(empty).toEqual({
      interactionGraph: { kind: 'NO_INTERACTIONS' },
      suppressionDestructionAbsorptionPreview: { kind: 'NONE' },
    });
    const actual = createSymbiontInteractionProjection(compose(['TOAD', 'TAIPAN']));
    expect(actual.interactionGraph.kind).toBe('INTERACTIONS');
    expect(actual.suppressionDestructionAbsorptionPreview.kind).toBe('CONSEQUENCES');
    const serialized = JSON.stringify(actual);
    for (const forbidden of ['ConflictID', 'Rule IDs', 'Source Question IDs', 'Resolution']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('rejects duplicates, over-capacity accepted history, and invalid duel values', () => {
    expect(() => compose(['WEAVER', 'WEAVER'])).toThrow('duplicate species');
    expect(() => compose(['WEAVER', 'TAIPAN', 'OWL', 'TEACHER', 'ARMADILLO'])).toThrow(
      'up to four',
    );
    expect(() =>
      resolveSymbiontCurrentOeDuel({ trogrCurrentOe: -1, keeperCurrentOe: 100 }),
    ).toThrow('non-negative safe integer');
  });
});
