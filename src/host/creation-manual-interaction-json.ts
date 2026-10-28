import type { JsonObject } from '@shared/wire-protocol.js';

import type {
  ManualInteractionPreview,
  SymbiontCatalog,
  SymbiontComposition,
  SymbiontStatModifierEffect,
  ValidatedManualComposition,
} from '../domain/index.js';
import { symbiontBindingsJson } from './creation-symbiont-contract.js';

function compositionJson(
  catalog: SymbiontCatalog,
  composition: SymbiontComposition,
  bindings: ValidatedManualComposition['bindings'],
): JsonObject {
  return {
    symbiontInstancesDraft: composition.instances.map((instance) => {
      const species = catalog.species.find(
        (candidate) => candidate.speciesKey === instance.speciesKey,
      );
      if (species === undefined) throw new Error('composition references an unknown species');
      return {
        acceptedIndex: instance.acceptedIndex,
        speciesKey: instance.speciesKey,
        speciesLabel: species.speciesLabel,
        status: instance.status,
        slotCost: instance.slotCost,
        currentOe: instance.currentOe,
        absorbedSpeciesKeys: instance.absorbedSpeciesKeys,
      };
    }),
    speciesKeys: composition.acceptedSpecies.map((accepted) => accepted.speciesKey),
    bindings: symbiontBindingsJson(bindings),
    slotUsageAndCapacity: { used: composition.slotUsage, capacity: composition.slotCapacity },
  };
}

function modifierEffectJson(
  effect: SymbiontStatModifierEffect | Readonly<{ kind: 'INACTIVE' }>,
): JsonObject {
  if (effect.kind !== 'ADDITIVE_STAT_MODIFIERS') return { kind: effect.kind };
  return {
    kind: effect.kind,
    entries: effect.entries.map((entry) => ({
      statCode: entry.statCode,
      statLabel: entry.statLabel,
      delta: entry.delta,
    })),
  };
}

export function manualInteractionDiffJson(
  catalog: SymbiontCatalog,
  preview: ManualInteractionPreview,
): JsonObject {
  return {
    compositionBefore: compositionJson(
      catalog,
      preview.compositionBefore.composition,
      preview.compositionBefore.bindings,
    ),
    compositionAfter: compositionJson(
      catalog,
      preview.compositionAfter.composition,
      preview.compositionAfter.bindings,
    ),
    interactionGraph: preview.interactionGraph,
    suppressionDestructionAbsorption: preview.suppressionDestructionAbsorption,
    slotStatOeDiff: {
      slotUsageBefore: preview.slotStatOeDiff.slotUsageBefore,
      slotUsageAfter: preview.slotStatOeDiff.slotUsageAfter,
      entries: preview.slotStatOeDiff.entries.map((entry) => ({
        speciesKey: entry.speciesKey,
        before:
          entry.before === null
            ? null
            : {
                slotCost: entry.before.slotCost,
                currentOe: entry.before.currentOe,
                status: entry.before.status,
              },
        after:
          entry.after === null
            ? null
            : {
                slotCost: entry.after.slotCost,
                currentOe: entry.after.currentOe,
                status: entry.after.status,
              },
      })),
      modifierBreakdownBefore: modifierEffectJson(preview.slotStatOeDiff.modifierBreakdownBefore),
      modifierBreakdownAfter: modifierEffectJson(preview.slotStatOeDiff.modifierBreakdownAfter),
    },
    irreversibleOperationIds: preview.irreversibleOperationIds,
  };
}
