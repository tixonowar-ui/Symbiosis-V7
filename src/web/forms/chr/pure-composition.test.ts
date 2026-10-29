import { describe, expect, it } from 'vitest';

import type { JsonObject } from '@shared/index.js';

import {
  decodeChr017Projection,
  decodeChr019Projection,
  expectedChr017ActionKeys,
} from './random-symbionts.js';

const catalog: JsonObject = {
  characterDraftId: 'pure-character',
  draftRevision: 8,
  eligibleSymbiontSpecies: [],
  manualCompositionDraft: [],
  pureNoSymbiontRoute: true,
  pureCompositionCheckpointed: true,
  raceChoice: 'PURE',
  selectedSpeciesOrNull: null,
  slotCapacity: 0,
  symbiontAcquisitionModeOrNull: null,
  wizardCheckpointId: 'pure-checkpoint',
};
const composition: JsonObject = {
  characterDraftId: 'pure-character',
  draftRevision: 8,
  wizardCheckpointId: 'pure-checkpoint',
  raceChoice: 'PURE',
  commandId: 'pure-confirmation',
  bindings: [],
  speciesKeys: [],
  symbiontInstancesDraft: [],
  slotUsageAndCapacity: { used: 0, capacity: 0 },
  interactionGraph: { kind: 'NO_INTERACTIONS' },
  duplicatePolicy: { kind: 'NOT_APPLICABLE' },
  suppressionDestructionAbsorptionPreview: { kind: 'NONE' },
  compositionValidation: 'VALID',
  randomReceiptIds: [],
  irreversibleBoundaryStatus: 'NOT_CROSSED',
  symbiontModifierBreakdown: { bySpecies: [], total: { kind: 'NO_STAT_MODIFIERS' } },
};

describe('PURE empty composition projections', () => {
  it('distinguishes a bound empty checkpoint from historical initialization', () => {
    const bound = decodeChr017Projection(catalog, '$');
    expect(bound.ok).toBe(true);
    if (!bound.ok) throw new Error('bound PURE catalog was rejected');
    expect(expectedChr017ActionKeys(bound.value)).toEqual(['CHR-017::CTA::004']);
    const historical = decodeChr017Projection(
      { ...catalog, pureCompositionCheckpointed: false },
      '$',
    );
    expect(historical.ok).toBe(true);
    if (!historical.ok) throw new Error('historical PURE catalog was rejected');
    expect(expectedChr017ActionKeys(historical.value)).toEqual(['CHR-017::CTA::006']);
    expect(decodeChr017Projection({ ...catalog, slotCapacity: 1 }, '$').ok).toBe(false);
  });

  it('accepts only an empty read-only PURE composition without random or manual evidence', () => {
    expect(decodeChr019Projection(composition, '$').ok).toBe(true);
    expect(decodeChr019Projection(composition, '$', 'MANUAL').ok).toBe(false);
    for (const patch of [
      { randomReceiptIds: ['foreign-roll'] },
      { speciesKeys: ['EEL'] },
      { slotUsageAndCapacity: { used: 0, capacity: 1 } },
      { duplicatePolicy: { kind: 'REROLL_WITH_SEPARATE_RECEIPTS', receipts: [] } },
      { irreversibleBoundaryStatus: 'CROSSED' },
      { armorBundleEntryMode: 'INITIAL' },
      { sourceRule: 'private-source' },
    ])
      expect(decodeChr019Projection({ ...composition, ...patch }, '$').ok).toBe(false);
  });
});
