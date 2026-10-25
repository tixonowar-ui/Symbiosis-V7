import type { StatCode } from '@generated/types/character.js';

import type { StatModifierDefinition } from '../skill-stage/catalog.js';
import {
  createSymbiontModifierEffect,
  requireRandomSymbiontRace,
  requireSymbiontSpecies,
  type RandomSymbiontRaceCode,
  type SymbiontAcceptedSpecies,
  type SymbiontCatalog,
  type SymbiontKind,
  type SymbiontSpeciesKey,
  type SymbiontStatModifierEffect,
} from './catalog.js';

export type SymbiontInstanceStatus = 'ACTIVE' | 'SUPPRESSED' | 'ABSORBED' | 'DESTROYED';

export interface SymbiontCompositionInstance extends SymbiontAcceptedSpecies {
  readonly kind: SymbiontKind;
  readonly status: SymbiontInstanceStatus;
  readonly slotCost: number;
  readonly currentOe: number;
  readonly absorbedSpeciesKeys: readonly SymbiontSpeciesKey[];
}

export type SymbiontInteraction =
  | Readonly<{
      kind: 'ABSORPTION';
      absorberAcceptedIndex: number;
      absorbedAcceptedIndex: number;
      absorbedSpeciesKey: 'TEACHER' | 'DOLPHIN';
    }>
  | Readonly<{
      kind: 'CURRENT_OE_DUEL';
      trogrAcceptedIndex: number;
      keeperAcceptedIndex: number;
      trogrCurrentOeBefore: number;
      keeperCurrentOeBefore: number;
      outcome: 'TROGR_DESTROYED' | 'KEEPER_DESTROYED' | 'TIE';
      winnerCurrentOeAfterOrNull: number | null;
    }>
  | Readonly<{
      kind: 'SPECIES_SUPPRESSION';
      suppressorAcceptedIndex: number;
      suppressedAcceptedIndex: number;
      suppressorSpeciesKey: 'TROGR' | 'TOAD';
      suppressedSpeciesKey: 'ADVISER' | 'PENGUIN' | 'TAIPAN';
    }>
  | Readonly<{
      kind: 'ABILITY_SUPPRESSION';
      suppressorAcceptedIndex: number;
      targetAcceptedIndex: number;
      ability: 'DOUBLE_FOCUS';
    }>;

export interface SymbiontComposition {
  readonly raceCode: RandomSymbiontRaceCode;
  readonly acceptedSpecies: readonly SymbiontAcceptedSpecies[];
  readonly acceptedOrdinaryCount: number;
  readonly instances: readonly SymbiontCompositionInstance[];
  readonly interactions: readonly SymbiontInteraction[];
  readonly slotCapacity: number;
  readonly slotUsage: number;
}

export interface SymbiontCompositionInput {
  readonly raceCode: RandomSymbiontRaceCode;
  readonly acceptedSpecies: readonly SymbiontAcceptedSpecies[];
}

export interface SymbiontDuelInput {
  readonly trogrCurrentOe: number;
  readonly keeperCurrentOe: number;
}

export interface SymbiontDuelResult {
  readonly outcome: 'TROGR_DESTROYED' | 'KEEPER_DESTROYED' | 'TIE';
  readonly trogrCurrentOeAfter: number;
  readonly keeperCurrentOeAfter: number;
  readonly winnerCurrentOeAfterOrNull: number | null;
}

export type SymbiontSpeciesModifierBreakdown = Readonly<{
  acceptedIndex: number;
  speciesKey: SymbiontSpeciesKey;
  speciesLabel: string;
  status: SymbiontInstanceStatus;
  effect: SymbiontStatModifierEffect | Readonly<{ kind: 'INACTIVE' }>;
}>;

export interface SymbiontModifierBreakdown {
  readonly bySpecies: readonly SymbiontSpeciesModifierBreakdown[];
  readonly total: SymbiontStatModifierEffect;
}

export interface SymbiontModifierContext {
  readonly equippedHermeticNate: boolean;
}

export class SymbiontCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

interface MutableInstance {
  acceptedIndex: number;
  speciesKey: SymbiontSpeciesKey;
  kind: SymbiontKind;
  status: SymbiontInstanceStatus;
  slotCost: number;
  currentOe: number;
  absorbedSpeciesKeys: SymbiontSpeciesKey[];
}

function fail(detail: string): never {
  throw new SymbiontCompositionError(detail);
}

function requireNonnegativeOe(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${path} must be a non-negative safe integer`);
  }
  return value;
}

function present(instance: MutableInstance): boolean {
  return instance.status === 'ACTIVE' || instance.status === 'SUPPRESSED';
}

function active(instance: MutableInstance): boolean {
  return instance.status === 'ACTIVE';
}

function requireInteraction(catalog: SymbiontCatalog, conflictId: string): void {
  if (!catalog.interactions.some((interaction) => interaction.conflictId === conflictId)) {
    fail(`incompatibilities is missing ${conflictId}`);
  }
}

/** SYM-075: strictly greater current OE wins; equality destroys neither side. */
export function resolveSymbiontCurrentOeDuel(input: SymbiontDuelInput): SymbiontDuelResult {
  const trogr = requireNonnegativeOe(input.trogrCurrentOe, 'trogrCurrentOe');
  const keeper = requireNonnegativeOe(input.keeperCurrentOe, 'keeperCurrentOe');
  if (trogr === keeper) {
    return Object.freeze({
      outcome: 'TIE',
      trogrCurrentOeAfter: trogr,
      keeperCurrentOeAfter: keeper,
      winnerCurrentOeAfterOrNull: null,
    });
  }
  if (trogr > keeper) {
    return Object.freeze({
      outcome: 'KEEPER_DESTROYED',
      trogrCurrentOeAfter: trogr - keeper,
      keeperCurrentOeAfter: keeper,
      winnerCurrentOeAfterOrNull: trogr - keeper,
    });
  }
  return Object.freeze({
    outcome: 'TROGR_DESTROYED',
    trogrCurrentOeAfter: trogr,
    keeperCurrentOeAfter: keeper - trogr,
    winnerCurrentOeAfterOrNull: keeper - trogr,
  });
}

function freezeInstance(instance: MutableInstance): SymbiontCompositionInstance {
  return Object.freeze({
    ...instance,
    absorbedSpeciesKeys: Object.freeze([...instance.absorbedSpeciesKeys]),
  });
}

function freezeComposition(
  raceCode: RandomSymbiontRaceCode,
  slotCapacity: number,
  acceptedSpecies: readonly SymbiontAcceptedSpecies[],
  instances: readonly MutableInstance[],
  interactions: readonly SymbiontInteraction[],
): SymbiontComposition {
  const slotUsage = instances
    .filter(present)
    .reduce((total, instance) => total + instance.slotCost, 0);
  if (slotUsage > slotCapacity) {
    fail(`slot usage ${String(slotUsage)} exceeds capacity ${String(slotCapacity)}`);
  }
  return Object.freeze({
    raceCode,
    acceptedSpecies: Object.freeze(
      acceptedSpecies.map((accepted) => Object.freeze({ ...accepted })),
    ),
    acceptedOrdinaryCount: acceptedSpecies.filter(
      (accepted) =>
        accepted.speciesKey !== 'CHIMERA' &&
        accepted.speciesKey !== 'PUPPETEER' &&
        accepted.speciesKey !== 'PLAGUE_DOCTOR',
    ).length,
    instances: Object.freeze(instances.map(freezeInstance)),
    interactions: Object.freeze([...interactions]),
    slotCapacity,
    slotUsage,
  });
}

export function resolveSymbiontComposition(
  catalog: SymbiontCatalog,
  input: SymbiontCompositionInput,
): SymbiontComposition {
  const raceCode = requireRandomSymbiontRace(input.raceCode);
  const race = catalog.races.find((candidate) => candidate.raceCode === raceCode);
  if (race === undefined) fail(`race ${raceCode} is missing from the catalog`);
  const acceptedInput: unknown = input.acceptedSpecies;
  if (!Array.isArray(acceptedInput)) fail('acceptedSpecies must be an array');

  const acceptedSpecies = (acceptedInput as readonly SymbiontAcceptedSpecies[]).map(
    (accepted, index) => {
      if (accepted.acceptedIndex !== index) {
        fail(`acceptedSpecies[${String(index)}].acceptedIndex must be ${String(index)}`);
      }
      return Object.freeze({
        acceptedIndex: index,
        speciesKey: requireSymbiontSpecies(catalog, accepted.speciesKey).speciesKey,
      });
    },
  );
  if (
    new Set(acceptedSpecies.map((accepted) => accepted.speciesKey)).size !== acceptedSpecies.length
  ) {
    fail('acceptedSpecies contains a duplicate species');
  }
  const monsters = acceptedSpecies.filter((accepted) => {
    const species = requireSymbiontSpecies(catalog, accepted.speciesKey);
    return species.kind === 'SYMBIOTIC_MONSTER';
  });
  if (monsters.length > 0) {
    if (acceptedSpecies.length !== 1 || raceCode !== 'UNITED' || !race.symbioticMonsterAllowed) {
      fail('a symbiotic monster must be the sole accepted result for UNITED');
    }
    const accepted = acceptedSpecies[0];
    if (accepted === undefined) fail('monster accepted result is missing');
    const species = requireSymbiontSpecies(catalog, accepted.speciesKey);
    const instance: MutableInstance = {
      ...accepted,
      kind: species.kind,
      status: 'ACTIVE',
      slotCost: species.slotCost,
      currentOe: species.initialCurrentOe,
      absorbedSpeciesKeys: [],
    };
    requireInteraction(catalog, 'SYMBIOTIC-MONSTER-BASE-SLOTS');
    return freezeComposition(raceCode, race.baseSymbiontSlots, acceptedSpecies, [instance], []);
  }
  if (acceptedSpecies.length > (raceCode === 'FREE' ? 1 : 4)) {
    fail(`${raceCode} accepts ${raceCode === 'FREE' ? 'one' : 'up to four'} ordinary results`);
  }

  const instances: MutableInstance[] = [];
  const interactions: SymbiontInteraction[] = [];
  const findInstance = (speciesKey: SymbiontSpeciesKey): MutableInstance | undefined =>
    instances.find((instance) => instance.speciesKey === speciesKey && present(instance));

  const absorb = (trogr: MutableInstance, victim: MutableInstance): void => {
    if (victim.speciesKey !== 'TEACHER' && victim.speciesKey !== 'DOLPHIN') {
      fail(`TROGR cannot absorb ${victim.speciesKey}`);
    }
    requireInteraction(catalog, 'TROGR-CONSUMES-TEACHER-DOLPHIN');
    victim.status = 'ABSORBED';
    victim.slotCost = 0;
    trogr.absorbedSpeciesKeys.push(victim.speciesKey);
    trogr.slotCost = 1 + trogr.absorbedSpeciesKeys.length;
    interactions.push(
      Object.freeze({
        kind: 'ABSORPTION',
        absorberAcceptedIndex: trogr.acceptedIndex,
        absorbedAcceptedIndex: victim.acceptedIndex,
        absorbedSpeciesKey: victim.speciesKey,
      }),
    );
  };

  const duel = (trogr: MutableInstance, keeper: MutableInstance): void => {
    requireInteraction(catalog, 'TROGR-VS-KEEPER');
    const trogrCurrentOeBefore = trogr.currentOe;
    const keeperCurrentOeBefore = keeper.currentOe;
    const result = resolveSymbiontCurrentOeDuel({
      trogrCurrentOe: trogrCurrentOeBefore,
      keeperCurrentOe: keeperCurrentOeBefore,
    });
    trogr.currentOe = result.trogrCurrentOeAfter;
    keeper.currentOe = result.keeperCurrentOeAfter;
    if (result.outcome === 'TROGR_DESTROYED') {
      trogr.status = 'DESTROYED';
      trogr.slotCost = 0;
    } else if (result.outcome === 'KEEPER_DESTROYED') {
      keeper.status = 'DESTROYED';
      keeper.slotCost = 0;
    }
    interactions.push(
      Object.freeze({
        kind: 'CURRENT_OE_DUEL',
        trogrAcceptedIndex: trogr.acceptedIndex,
        keeperAcceptedIndex: keeper.acceptedIndex,
        trogrCurrentOeBefore,
        keeperCurrentOeBefore,
        outcome: result.outcome,
        winnerCurrentOeAfterOrNull: result.winnerCurrentOeAfterOrNull,
      }),
    );
  };

  const suppress = (suppressor: MutableInstance, target: MutableInstance): void => {
    if (!active(suppressor) || !active(target)) return;
    if (suppressor.speciesKey === 'TROGR') {
      if (target.speciesKey !== 'ADVISER' && target.speciesKey !== 'PENGUIN') return;
      requireInteraction(catalog, `TROGR-SUPPRESSES-${target.speciesKey}`);
    } else if (suppressor.speciesKey === 'TOAD' && target.speciesKey === 'TAIPAN') {
      requireInteraction(catalog, 'TOAD-SUPPRESSES-TAIPAN');
    } else {
      return;
    }
    target.status = 'SUPPRESSED';
    interactions.push(
      Object.freeze({
        kind: 'SPECIES_SUPPRESSION',
        suppressorAcceptedIndex: suppressor.acceptedIndex,
        suppressedAcceptedIndex: target.acceptedIndex,
        suppressorSpeciesKey: suppressor.speciesKey,
        suppressedSpeciesKey: target.speciesKey,
      }),
    );
  };

  const suppressDoubleFocus = (): void => {
    const owl = findInstance('OWL');
    const chameleon = findInstance('CHAMELEON');
    if (owl === undefined || chameleon === undefined || !active(owl)) return;
    if (
      interactions.some(
        (interaction) =>
          interaction.kind === 'ABILITY_SUPPRESSION' &&
          interaction.suppressorAcceptedIndex === owl.acceptedIndex &&
          interaction.targetAcceptedIndex === chameleon.acceptedIndex,
      )
    ) {
      return;
    }
    requireInteraction(catalog, 'OWL-SUPPRESSES-DOUBLE-FOCUS');
    interactions.push(
      Object.freeze({
        kind: 'ABILITY_SUPPRESSION',
        suppressorAcceptedIndex: owl.acceptedIndex,
        targetAcceptedIndex: chameleon.acceptedIndex,
        ability: 'DOUBLE_FOCUS',
      }),
    );
  };

  for (const accepted of acceptedSpecies) {
    const species = requireSymbiontSpecies(catalog, accepted.speciesKey);
    if (!species.allowedRaceCodes.includes(raceCode)) {
      fail(`${species.speciesKey} is not eligible for ${raceCode}`);
    }
    requireInteraction(catalog, 'SYM-UNIQUE-SPECIES');
    requireInteraction(catalog, 'SYM-SLOT-CAPACITY');
    const instance: MutableInstance = {
      ...accepted,
      kind: species.kind,
      status: 'ACTIVE',
      slotCost: species.slotCost,
      currentOe: species.initialCurrentOe,
      absorbedSpeciesKeys: [],
    };
    instances.push(instance);

    const trogr = instance.speciesKey === 'TROGR' ? instance : findInstance('TROGR');
    if (trogr !== undefined && active(trogr)) {
      if (instance.speciesKey === 'TEACHER' || instance.speciesKey === 'DOLPHIN') {
        absorb(trogr, instance);
      } else if (instance.speciesKey === 'TROGR') {
        for (const victim of instances.filter(
          (candidate) =>
            candidate.acceptedIndex !== instance.acceptedIndex &&
            active(candidate) &&
            (candidate.speciesKey === 'TEACHER' || candidate.speciesKey === 'DOLPHIN'),
        )) {
          absorb(trogr, victim);
        }
      }
      if (instance.speciesKey === 'KEEPER' || instance.speciesKey === 'TROGR') {
        const keeper = findInstance('KEEPER');
        if (keeper !== undefined && active(keeper)) duel(trogr, keeper);
      }
      if (active(trogr)) {
        for (const target of instances.filter(
          (candidate) =>
            active(candidate) &&
            (candidate.speciesKey === 'ADVISER' || candidate.speciesKey === 'PENGUIN'),
        )) {
          suppress(trogr, target);
        }
      }
    }

    const toad = instance.speciesKey === 'TOAD' ? instance : findInstance('TOAD');
    const taipan = findInstance('TAIPAN');
    if (toad !== undefined && taipan !== undefined) suppress(toad, taipan);
    suppressDoubleFocus();
    freezeComposition(
      raceCode,
      race.baseSymbiontSlots,
      acceptedSpecies.slice(0, instance.acceptedIndex + 1),
      instances,
      interactions,
    );
  }

  return freezeComposition(
    raceCode,
    race.baseSymbiontSlots,
    acceptedSpecies,
    instances,
    interactions,
  );
}

function applicableModifiers(
  instance: SymbiontCompositionInstance,
  modifiers: readonly StatModifierDefinition[],
  context: SymbiontModifierContext,
): readonly StatModifierDefinition[] {
  return modifiers.filter((modifier) => {
    switch (modifier.contextPredicate) {
      case 'symbiontActive=true':
        return instance.status === 'ACTIVE';
      case 'symbiontActive=true AND NOT equippedHermeticNate':
        return instance.status === 'ACTIVE' && !context.equippedHermeticNate;
      default:
        return fail(`unsupported modifier predicate ${JSON.stringify(modifier.contextPredicate)}`);
    }
  });
}

export function deriveSymbiontModifierBreakdown(
  catalog: SymbiontCatalog,
  composition: SymbiontComposition,
  context: SymbiontModifierContext,
): SymbiontModifierBreakdown {
  if (typeof context.equippedHermeticNate !== 'boolean') {
    fail('equippedHermeticNate must be an explicit boolean');
  }
  const presentInstances = composition.instances.filter(
    (instance) => instance.status === 'ACTIVE' || instance.status === 'SUPPRESSED',
  );
  const bySpecies = presentInstances.map((instance): SymbiontSpeciesModifierBreakdown => {
    const species = requireSymbiontSpecies(catalog, instance.speciesKey);
    const applicable = applicableModifiers(instance, species.modifiers, context);
    return Object.freeze({
      acceptedIndex: instance.acceptedIndex,
      speciesKey: instance.speciesKey,
      speciesLabel: species.speciesLabel,
      status: instance.status,
      effect:
        instance.status === 'SUPPRESSED'
          ? Object.freeze({ kind: 'INACTIVE' })
          : createSymbiontModifierEffect(catalog, applicable),
    });
  });
  const totalByStat = new Map<StatCode, number>();
  for (const instance of presentInstances) {
    if (instance.status !== 'ACTIVE') continue;
    const species = requireSymbiontSpecies(catalog, instance.speciesKey);
    for (const modifier of applicableModifiers(instance, species.modifiers, context)) {
      totalByStat.set(
        modifier.targetCode,
        (totalByStat.get(modifier.targetCode) ?? 0) + modifier.value,
      );
    }
  }
  if (totalByStat.size === 0) {
    return Object.freeze({
      bySpecies: Object.freeze(bySpecies),
      total: Object.freeze({ kind: 'NO_STAT_MODIFIERS' }),
    });
  }
  const entries = catalog.stats.flatMap((stat) => {
    const delta = totalByStat.get(stat.statCode);
    return delta === undefined
      ? []
      : [Object.freeze({ statCode: stat.statCode, statLabel: stat.statLabel, delta })];
  });
  return Object.freeze({
    bySpecies: Object.freeze(bySpecies),
    total: Object.freeze({ kind: 'ADDITIVE_STAT_MODIFIERS', entries: Object.freeze(entries) }),
  });
}

export interface SymbiontInteractionProjection {
  readonly interactionGraph:
    | Readonly<{ kind: 'NO_INTERACTIONS' }>
    | Readonly<{ kind: 'INTERACTIONS'; entries: readonly SymbiontInteraction[] }>;
  readonly suppressionDestructionAbsorptionPreview:
    | Readonly<{ kind: 'NONE' }>
    | Readonly<{ kind: 'CONSEQUENCES'; entries: readonly SymbiontInteraction[] }>;
}

/** CHR-019 random projection: positive empty variants, with no raw conflict or Rule IDs. */
export function createSymbiontInteractionProjection(
  composition: SymbiontComposition,
): SymbiontInteractionProjection {
  const consequences = composition.interactions.filter(
    (interaction) =>
      interaction.kind === 'ABSORPTION' ||
      interaction.kind === 'SPECIES_SUPPRESSION' ||
      interaction.kind === 'ABILITY_SUPPRESSION' ||
      (interaction.kind === 'CURRENT_OE_DUEL' && interaction.outcome !== 'TIE'),
  );
  return Object.freeze({
    interactionGraph:
      composition.interactions.length === 0
        ? Object.freeze({ kind: 'NO_INTERACTIONS' })
        : Object.freeze({
            kind: 'INTERACTIONS',
            entries: Object.freeze([...composition.interactions]),
          }),
    suppressionDestructionAbsorptionPreview:
      consequences.length === 0
        ? Object.freeze({ kind: 'NONE' })
        : Object.freeze({ kind: 'CONSEQUENCES', entries: Object.freeze(consequences) }),
  });
}
