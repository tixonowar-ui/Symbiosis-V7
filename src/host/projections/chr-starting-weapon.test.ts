import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { recommendStartingWeaponQuality } from '../../domain/rules/item-stage/starting-weapon.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';
import {
  loadStartingWeaponCatalog,
  type StartingWeaponItemCatalog,
} from '../starting-weapon-catalog.js';
import { assertScreenContract } from './app.js';
import {
  assertStartingWeaponScreenContracts,
  CHR_022_REQUIRED_FIELDS,
  CHR_022_ROUTE,
  projectChr022,
} from './chr-starting-weapon.js';

const root = resolve(import.meta.dirname, '..', '..', '..');
let catalog: StartingWeaponItemCatalog;
beforeAll(async () => {
  catalog = await loadStartingWeaponCatalog(root);
});

// Projection unit tests supply only already-validated host fields; persistence validation is tested at the command boundary.
function checkpoint(state: 'ENTRY' | 'ROLLED' | 'CHECKPOINTED'): DurableCreationWizardCheckpoint {
  const rolled = state !== 'ENTRY';
  return {
    localCharacter: { localCharacterId: 'character' },
    checkpoint: { checkpointId: 'checkpoint' },
    raceAndMethodStage: { race: { value: 'FREE' } },
    receipt: { result: { draftRevision: 10 } },
    nextStageEnvelope: {
      formId: state === 'CHECKPOINTED' ? 'CHR-023' : 'CHR-022',
      routeBindings: [{ parameterIndex: 0, source: 'server', value: 'character' }],
    },
    startingWeaponStage: {
      weaponQualityRollRequestId: 'weapon-request',
      diceInputModeSnapshot: 'MANUAL',
      entryRequest: { commandId: 'entry' },
      entryReceipt: { receiptId: 'entry-receipt' },
      qualityRollRecordOrNull: rolled
        ? {
            weaponTypeId: 'ITM-WPN-012',
            weaponVariant: 'TWO_HAND',
            qualityRecommendation: recommendStartingWeaponQuality(1),
            request: { commandId: 'quality' },
            receipt: { receiptId: 'quality-receipt' },
          }
        : null,
      checkpointRecordOrNull:
        state === 'CHECKPOINTED'
          ? {
              request: { commandId: 'final' },
              receipt: { receiptId: 'final-receipt' },
              nextStageEnvelope: { formId: 'CHR-023' },
            }
          : null,
    },
  } as unknown as DurableCreationWizardCheckpoint;
}

describe('CHR-022 host projection', () => {
  it('checks exact supplied title, route, type and all required fields', () => {
    const forms = JSON.parse(
      readFileSync(resolve(root, 'generated/spec/atlas/forms-by-id.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(() => assertStartingWeaponScreenContracts(forms, assertScreenContract)).not.toThrow();
    const form = forms['CHR-022'] as Record<string, unknown>;
    expect(form['requiredFields']).toEqual(CHR_022_REQUIRED_FIELDS);
    for (const update of [
      { title: 'Other' },
      { route: '/other' },
      { type: 'dialog' },
      { requiredFields: [] },
    ]) {
      expect(() =>
        assertStartingWeaponScreenContracts(
          { ...forms, 'CHR-022': { ...form, ...update } },
          assertScreenContract,
        ),
      ).toThrow();
    }
  });

  it('publishes only formula choices for non-PURE and excludes internal provenance', () => {
    const projection = projectChr022(checkpoint('ENTRY'), catalog, true, true);
    expect(projection).toMatchObject({
      formId: 'CHR-022',
      formType: 'screen',
      routeTemplate: CHR_022_ROUTE,
      availableActionKeys: ['CHR-022::CTA::004', 'CHR-022::CTA::003'],
    });
    const payload = projection.roleFilteredPayload;
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(
      /CORE-\d|F-WPN-\d|Источник|availabilityTrace|profileKind|qualityTier/,
    );
    expect(serialized).not.toContain('ITM-WPN-003');
    expect(serialized).toContain('Полуторный меч, фиксированный хват двумя руками.');
    expect(payload).toMatchObject({
      weaponTypeId: null,
      weaponVariant: null,
      requirementPreview: null,
      qualityRecommendation: null,
      ownershipState: 'OWNED_NOT_EQUIPPED',
    });
  });

  it('keeps poor quality ownership intact and publishes an actionless signed next stage after checkpoint', () => {
    const rolled = projectChr022(checkpoint('ROLLED'), catalog, true, true);
    expect(rolled.availableActionKeys).toEqual(['CHR-022::CTA::001', 'CHR-022::CTA::003']);
    expect(rolled.roleFilteredPayload).toMatchObject({
      weaponTypeId: 'ITM-WPN-012',
      weaponVariant: 'TWO_HAND',
      ownershipState: 'OWNED_NOT_EQUIPPED',
      qualityRecommendation: { rawFace: 1, kind: 'MISSING_OR_UNFIT' },
    });
    const selected = catalog.entries.find(
      (entry) => entry.weaponTypeId === 'ITM-WPN-012' && entry.weaponVariant === 'TWO_HAND',
    )!;
    expect(rolled.roleFilteredPayload['requirementPreview']).toEqual(selected.requirementPreview);
    const done = projectChr022(checkpoint('CHECKPOINTED'), catalog, true, true);
    expect(done.formId).toBe('CHR-022');
    expect(done.availableActionKeys).toEqual([]);
    expect(done.roleFilteredPayload).toMatchObject({
      nextFormId: 'CHR-023',
      weaponCheckpointReceiptIdOrNull: 'final-receipt',
    });
  });
});
