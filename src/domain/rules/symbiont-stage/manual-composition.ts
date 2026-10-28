import {
  createSymbiontBindingSnapshot,
  type RandomSymbiontRaceCode,
  type SymbiontAcceptedSpecies,
  type SymbiontBindingSelection,
  type SymbiontCatalog,
  type SymbiontSpeciesBinding,
  type SymbiontSpeciesKey,
  type SymbiontStatModifierEffect,
} from './catalog.js';
import {
  createSymbiontInteractionProjection,
  deriveSymbiontModifierBreakdown,
  resolveSymbiontComposition,
  type SymbiontComposition,
  type SymbiontInstanceStatus,
  type SymbiontInteraction,
  type SymbiontInteractionProjection,
} from './composition.js';

export interface ManualCompositionInput {
  readonly raceCode: RandomSymbiontRaceCode;
  readonly acceptedSpecies: readonly SymbiontAcceptedSpecies[];
  readonly selectedBindings?: readonly SymbiontBindingSelection[];
}

export interface ValidatedManualComposition {
  readonly composition: SymbiontComposition;
  readonly bindings: readonly SymbiontSpeciesBinding[];
}

export interface ManualCompositionPreviewInput {
  readonly before: ManualCompositionInput;
  readonly after: ManualCompositionInput;
}

export interface ManualInstanceDiff {
  readonly slotCost: number;
  readonly currentOe: number;
  readonly status: SymbiontInstanceStatus;
}

export interface ManualSlotStatOeDiff {
  readonly slotUsageBefore: number;
  readonly slotUsageAfter: number;
  readonly entries: readonly Readonly<{
    speciesKey: SymbiontSpeciesKey;
    before: ManualInstanceDiff | null;
    after: ManualInstanceDiff | null;
  }>[];
  readonly modifierBreakdownBefore: SymbiontStatModifierEffect;
  readonly modifierBreakdownAfter: SymbiontStatModifierEffect;
}

export interface ManualInteractionPreview {
  readonly compositionBefore: ValidatedManualComposition;
  readonly compositionAfter: ValidatedManualComposition;
  readonly interactionGraph: SymbiontInteractionProjection['interactionGraph'];
  readonly suppressionDestructionAbsorption: SymbiontInteractionProjection['suppressionDestructionAbsorptionPreview'];
  readonly slotStatOeDiff: ManualSlotStatOeDiff;
  readonly irreversibleOperationIds: readonly SymbiontInteraction['kind'][];
}

export function validateManualSymbiontComposition(
  catalog: SymbiontCatalog,
  input: ManualCompositionInput,
): ValidatedManualComposition {
  const composition = resolveSymbiontComposition(catalog, {
    raceCode: input.raceCode,
    acceptedSpecies: input.acceptedSpecies,
  });
  const hasMonster = composition.acceptedSpecies.some(
    (accepted) =>
      accepted.speciesKey === 'CHIMERA' ||
      accepted.speciesKey === 'PUPPETEER' ||
      accepted.speciesKey === 'PLAGUE_DOCTOR',
  );
  if (composition.raceCode === 'FREE' && (hasMonster || composition.acceptedSpecies.length !== 1)) {
    throw new Error('FREE requires exactly one ordinary species');
  }
  if (
    composition.raceCode === 'UNITED' &&
    !hasMonster &&
    composition.acceptedSpecies.length !== 4
  ) {
    throw new Error('UNITED requires four different ordinary species or one monster');
  }
  const bindings = createSymbiontBindingSnapshot(
    catalog,
    composition.acceptedSpecies,
    input.selectedBindings ?? [],
  );
  return Object.freeze({ composition, bindings });
}

function instanceDiff(
  instance: SymbiontComposition['instances'][number] | undefined,
): ManualInstanceDiff | null {
  if (instance === undefined) return null;
  return Object.freeze({
    slotCost: instance.slotCost,
    currentOe: instance.currentOe,
    status: instance.status,
  });
}

function sameInstance(left: ManualInstanceDiff | null, right: ManualInstanceDiff | null): boolean {
  return (
    left?.slotCost === right?.slotCost &&
    left?.currentOe === right?.currentOe &&
    left?.status === right?.status
  );
}

function validatedPreviewBefore(
  catalog: SymbiontCatalog,
  input: ManualCompositionPreviewInput['before'],
): ValidatedManualComposition {
  if (input.acceptedSpecies.length === 0) {
    return Object.freeze({
      composition: resolveSymbiontComposition(catalog, input),
      bindings: createSymbiontBindingSnapshot(catalog, [], input.selectedBindings ?? []),
    });
  }
  return validateManualSymbiontComposition(catalog, input);
}

export function deriveManualInteractionPreview(
  catalog: SymbiontCatalog,
  input: ManualCompositionPreviewInput,
): ManualInteractionPreview {
  const before = validatedPreviewBefore(catalog, input.before);
  const after = validateManualSymbiontComposition(catalog, input.after);
  const beforeBySpecies = new Map(
    before.composition.instances.map((instance) => [instance.speciesKey, instance]),
  );
  const afterBySpecies = new Map(
    after.composition.instances.map((instance) => [instance.speciesKey, instance]),
  );
  const entries = [
    ...after.composition.acceptedSpecies.map((accepted) => accepted.speciesKey),
    ...before.composition.acceptedSpecies.flatMap((accepted) =>
      afterBySpecies.has(accepted.speciesKey) ? [] : [accepted.speciesKey],
    ),
  ].flatMap((speciesKey) => {
    const previous = instanceDiff(beforeBySpecies.get(speciesKey));
    const current = instanceDiff(afterBySpecies.get(speciesKey));
    return sameInstance(previous, current)
      ? []
      : [Object.freeze({ speciesKey, before: previous, after: current })];
  });
  const projection = createSymbiontInteractionProjection(after.composition);
  return Object.freeze({
    compositionBefore: before,
    compositionAfter: after,
    interactionGraph: projection.interactionGraph,
    suppressionDestructionAbsorption: projection.suppressionDestructionAbsorptionPreview,
    slotStatOeDiff: Object.freeze({
      slotUsageBefore: before.composition.slotUsage,
      slotUsageAfter: after.composition.slotUsage,
      entries: Object.freeze(entries),
      modifierBreakdownBefore: deriveSymbiontModifierBreakdown(catalog, before.composition, {
        equippedHermeticNate: false,
      }).total,
      modifierBreakdownAfter: deriveSymbiontModifierBreakdown(catalog, after.composition, {
        equippedHermeticNate: false,
      }).total,
    }),
    irreversibleOperationIds: Object.freeze([
      ...new Set(after.composition.interactions.map((interaction) => interaction.kind)),
    ]),
  });
}
