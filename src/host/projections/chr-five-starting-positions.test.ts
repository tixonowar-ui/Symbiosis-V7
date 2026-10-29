import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';
import type { FiveStartingPositionsStage } from '../creation-five-starting-positions-contract.js';
import {
  recommendPositionQuality,
  type FiveStartingPositionsCatalog,
} from '../../domain/rules/item-stage/five-starting-positions.js';
import { assertScreenContract } from './app.js';
import {
  assertFiveStartingPositionsScreenContracts,
  projectChr037,
} from './chr-five-starting-positions.js';
import { loadFiveStartingPositionsCatalog } from '../five-starting-positions-catalog.js';

function fixture(
  catalog: FiveStartingPositionsCatalog,
  committed = 0,
  done = false,
): DurableCreationWizardCheckpoint {
  const slots = Array.from({ length: 5 }, (_, index) => ({
    positionId: `position-${String(index)}`,
    qualityRollRequestId: `quality-${String(index)}`,
  }));
  const entries = [
    catalog.entries[0]!,
    catalog.entries[0]!,
    catalog.entries[0]!,
    catalog.entries[0]!,
    catalog.entries.find((entry) => entry.kind === 'STORY')!,
  ];
  const draftSelections = slots.map((slot, i) => ({
    positionId: slot.positionId,
    ...entries[i]!,
    quantity: i === 4 ? 3 : 20,
    storyDescriptionOrNull: i === 4 ? 'Памятный браслет' : null,
  }));
  const stage = {
    moneyCheckpointReceiptId: 'money-checkpoint',
    moneyRollRequestId: 'money-request',
    moneyRollReceiptId: 'money-roll',
    diceInputModeSnapshot: 'MANUAL',
    slots,
    draftSelections: committed === 0 ? [] : draftSelections,
    entryRequest: { commandId: 'entry-command' },
    rollRecords: slots.slice(0, committed).map((slot, i) => ({
      request: { commandId: `roll-command-${String(i)}` },
      position: {
        ...slot,
        ...draftSelections[i]!,
        qualityRollReceiptId: `roll-receipt-${String(i)}`,
        qualityRollFaceOrNull: 1,
        qualityRecommendation: { ...recommendPositionQuality(1) },
      },
    })),
    checkpointRecordOrNull: done
      ? {
          receipt: { receiptId: 'positions-checkpoint' },
          request: { commandId: 'checkpoint-command' },
        }
      : null,
  } as unknown as FiveStartingPositionsStage;
  return {
    localCharacter: { localCharacterId: 'character' },
    checkpoint: { checkpointId: 'wizard' },
    receipt: { result: { draftRevision: 10 } },
    nextStageEnvelope: {
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: 'character' }],
    },
    fiveStartingPositionsStage: stage,
  } as unknown as DurableCreationWizardCheckpoint;
}
describe('CHR-037 five starting positions projection', () => {
  it('asserts the supplied screen title, route, fields and type', () => {
    const forms = JSON.parse(
      readFileSync('generated/spec/atlas/forms-by-id.json', 'utf8'),
    ) as Record<string, unknown>;
    expect(() =>
      assertFiveStartingPositionsScreenContracts(forms, assertScreenContract),
    ).not.toThrow();
    for (const patch of [
      { title: 'changed' },
      { route: '/wrong' },
      { requiredFields: [] },
      { type: 'dialog' },
    ])
      expect(() =>
        assertFiveStartingPositionsScreenContracts(
          { ...forms, 'CHR-037': { ...(forms['CHR-037'] as object), ...patch } },
          assertScreenContract,
        ),
      ).toThrow();
  });
  it('projects all source entries and pending/partial/final states', async () => {
    const catalog = await loadFiveStartingPositionsCatalog(process.cwd());
    for (const [count, done] of [
      [0, false],
      [1, false],
      [5, false],
      [5, true],
    ] as const) {
      const view = projectChr037(fixture(catalog, count, done), catalog, true, true);
      const payload = view.roleFilteredPayload;
      expect(view.availableActionKeys).toEqual(
        done
          ? []
          : count < 5
            ? ['CHR-037::CTA::003', 'CHR-037::CTA::004', 'CHR-037::CTA::002']
            : ['CHR-037::CTA::001', 'CHR-037::CTA::002'],
      );
      expect(payload['eligibleItemTypes']).toHaveLength(63);
      expect(
        catalog.entries.some((entry) => entry.itemTypeIdOrStoryType.startsWith('RES-MAG-')),
      ).toBe(false);
      expect(payload['nextFormId']).toBe(done ? 'CHR-032' : 'CHR-037');
      expect(view.formId).toBe('CHR-037');
      expect(JSON.stringify(view)).not.toMatch(
        /CORE-|AQ2-|Источник|availabilityTrace|masterPredicate|gmFinalization|xpDelta|criticalChain/,
      );
    }
  });
  it('omits unavailable workflow actions while retaining safe return and local editing', async () => {
    const catalog = await loadFiveStartingPositionsCatalog(process.cwd());
    expect(projectChr037(fixture(catalog), catalog, false, false).availableActionKeys).toEqual([
      'CHR-037::CTA::003',
      'CHR-037::CTA::002',
    ]);
    expect(projectChr037(fixture(catalog, 5), catalog, false, false).availableActionKeys).toEqual([
      'CHR-037::CTA::002',
    ]);
    expect(
      projectChr037(fixture(catalog, 5, true), catalog, true, true).availableActionKeys,
    ).toEqual([]);
  });
  it('uses an explicit player allowlist for catalogue, position and recommendation rows', async () => {
    const catalog = await loadFiveStartingPositionsCatalog(process.cwd());
    const checkpoint = fixture(catalog, 1);
    const raw = checkpoint as unknown as {
      fiveStartingPositionsStage: { rollRecords: { position: Record<string, unknown> }[] };
    };
    raw.fiveStartingPositionsStage.rollRecords[0]!.position['source'] = 'CORE-173';
    (
      raw.fiveStartingPositionsStage.rollRecords[0]!.position['qualityRecommendation'] as Record<
        string,
        unknown
      >
    )['availabilityTrace'] = 'AQ2-003';
    const extended = {
      entries: catalog.entries.map((entry) => ({ ...entry, source: 'CORE-173' })),
    };
    expect(
      JSON.stringify(projectChr037(checkpoint, extended, true, true).roleFilteredPayload),
    ).not.toMatch(/CORE-|AQ2-|availabilityTrace|source/);
  });
});
