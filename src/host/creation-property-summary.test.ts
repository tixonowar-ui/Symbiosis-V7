import { afterEach, describe, expect, it } from 'vitest';
import {
  createFiveStartingPositionsSetup,
  fiveStartingPositionRollRequest,
  fiveStartingPositionsCheckpointRequest,
} from '../../tests/fixtures/five-starting-positions-stage.js';
import { commitFiveStartingPositions } from './creation-five-starting-positions.js';
import {
  collectStartingPropertyReceiptRefs,
  validateStartingPropertyReceiptRefs,
  deriveStartingPropertySummary,
} from './creation-property-summary.js';

const setups: Awaited<ReturnType<typeof createFiveStartingPositionsSetup>>['setup'][] = [];
afterEach(() => {
  for (const setup of setups.splice(0)) if (setup.database.open) setup.database.close();
});
async function complete(mode: 'AUTO' | 'MANUAL', raceChoice: 'FREE' | 'PURE' = 'FREE') {
  const prepared = await createFiveStartingPositionsSetup({
    prefix: `summary-${mode}-${raceChoice}`,
    diceInputMode: mode,
    raceChoice,
  });
  setups.push(prepared.setup);
  const dependencies = {
    catalog: prepared.setup.catalog,
    positionsCatalog: prepared.positionsCatalog,
    sampleD20: () => 1,
  };
  let current = prepared.current;
  // The physical order is deliberately different from the canonical property-summary order.
  for (const index of [4, 1, 3, 0, 2])
    current = commitFiveStartingPositions(
      prepared.setup.database,
      fiveStartingPositionRollRequest(current, `summary-roll-${String(index)}`, index),
      `summary-receipt-${String(index)}`,
      dependencies,
    );
  current = commitFiveStartingPositions(
    prepared.setup.database,
    fiveStartingPositionsCheckpointRequest(current, 'summary-five-checkpoint'),
    'summary-five-checkpoint-receipt',
    dependencies,
  );
  return current;
}

describe('CHR-032 eight physical starting-property operations (AQ2-003)', () => {
  it('serializes only public summary fields even when input objects carry extra internal keys', async () => {
    const current = structuredClone(await complete('MANUAL'));
    Object.assign(current.armorBundleStage!.qualityRollRecordOrNull!.qualityRecommendation, {
      source: 'CORE-172',
    });
    Object.assign(current.startingWeaponStage!.qualityRollRecordOrNull!.qualityRecommendation, {
      availabilityTrace: 'CORE-173',
    });
    Object.assign(current.startingMoneyStage!.rollRecordOrNull!.wealthRecommendation, {
      gmFinalizationData: 'CORE-172',
    });
    for (const record of current.fiveStartingPositionsStage!.rollRecords) {
      Object.assign(record.position, { source: 'AQ2-003' });
      Object.assign(record.position.qualityRecommendation!, { source: 'CORE-173' });
    }
    expect(JSON.stringify(deriveStartingPropertySummary(current))).not.toMatch(
      /CORE-\d|AQ2-\d|source|availabilityTrace|gmFinalizationData/,
    );
  });
  it.each(['AUTO', 'MANUAL'] as const)(
    'counts only eight physical receipts in %s, preserving source quantities for natural one',
    async (mode) => {
      const current = await complete(mode);
      const refs = collectStartingPropertyReceiptRefs(current);
      expect(refs.map((ref) => ref.block)).toEqual([
        'ARMOR_BUNDLE',
        'WEAPON',
        'MONEY',
        'POSITION',
        'POSITION',
        'POSITION',
        'POSITION',
        'POSITION',
      ]);
      expect(refs.slice(3).map((ref) => ref.positionIdOrNull)).toEqual(
        current.fiveStartingPositionsStage!.slots.map((slot) => slot.positionId),
      );
      expect(new Set(refs.map((ref) => ref.rollReceiptId)).size).toBe(8);
      const manufacturing =
        current.weaponProfileStage!.records.at(-1)!.receipt.result
          .independentManufacturingDiceReceipts;
      expect(manufacturing.length).toBeGreaterThan(0);
      for (const witness of manufacturing)
        expect(refs.map((ref) => ref.rollReceiptId)).not.toContain(witness.receiptId);
      const summary = deriveStartingPropertySummary(current);
      expect(summary['exactOperationCount']).toBe(8);
      expect(summary['ownershipStateAll']).toBe('OWNED_NOT_EQUIPPED');
      expect(
        (
          summary['fivePositions'] as {
            quantity: number;
            qualityRecommendation: { rawFace: number };
          }[]
        ).map((p) => [p.quantity, p.qualityRecommendation.rawFace]),
      ).toEqual([
        [20, 1],
        [3, 1],
        [2, 1],
        [1, 1],
        [2, 1],
      ]);
      expect(JSON.stringify(summary)).not.toMatch(
        /CORE-\d|AQ2-\d|F-WPN-|Источник|availabilityTrace|formulaVersion|masterApproval|finalAmount/,
      );
    },
  );

  it('accepts the fixed PURE weapon without manufacturing witnesses', async () => {
    const current = await complete('MANUAL', 'PURE');
    expect(
      current.weaponProfileStage!.records.at(-1)!.receipt.result
        .independentManufacturingDiceReceipts,
    ).toEqual([]);
    expect(collectStartingPropertyReceiptRefs(current)).toHaveLength(8);
    expect(deriveStartingPropertySummary(current)['weapon']).toMatchObject({
      profileStatus: 'ACKNOWLEDGED',
      ownershipState: 'OWNED_NOT_EQUIPPED',
    });
  });

  it('rejects missing, extra, duplicate, foreign, wrong-block and changed-face references', async () => {
    const current = await complete('MANUAL');
    const refs = collectStartingPropertyReceiptRefs(current);
    expect(validateStartingPropertyReceiptRefs(current, structuredClone(refs))).toEqual(refs);
    const invalid = [
      [],
      refs.slice(0, 7),
      [...refs, refs[0]],
      refs.map((ref, i) => (i === 7 ? refs[3] : ref)),
      refs.map((ref, i) => (i === 0 ? { ...ref, rollReceiptId: 'foreign-receipt' } : ref)),
      refs.map((ref, i) => (i === 0 ? { ...ref, block: 'WEAPON' } : ref)),
      refs.map((ref, i) =>
        i === 7 ? { ...ref, positionIdOrNull: refs[3]!.positionIdOrNull } : ref,
      ),
      refs.map((ref, i) => (i === 2 ? { ...ref, rawFace: 20 } : ref)),
    ];
    for (const value of invalid)
      expect(() => validateStartingPropertyReceiptRefs(current, value)).toThrow();
  });

  it('rejects incomplete, foreign-owned and structurally swapped physical records', async () => {
    const current = await complete('MANUAL');
    const cases = [
      { ...current, armorBundleStage: null },
      {
        ...current,
        fiveStartingPositionsStage: {
          ...current.fiveStartingPositionsStage!,
          rollRecords: current.fiveStartingPositionsStage!.rollRecords.slice(0, 4),
        },
      },
      {
        ...current,
        startingMoneyStage: {
          ...current.startingMoneyStage!,
          rollRecordOrNull: {
            ...current.startingMoneyStage!.rollRecordOrNull!,
            request: {
              ...current.startingMoneyStage!.rollRecordOrNull!.request,
              payload: {
                ...current.startingMoneyStage!.rollRecordOrNull!.request.payload,
                characterDraftId: 'foreign-owner',
              },
            },
          },
        },
      },
      {
        ...current,
        startingWeaponStage: {
          ...current.startingWeaponStage!,
          qualityRollRecordOrNull: {
            ...current.startingWeaponStage!.qualityRollRecordOrNull!,
            physicalRoll: {
              ...current.startingWeaponStage!.qualityRollRecordOrNull!.physicalRoll,
              kind: 'STARTING_MONEY',
            },
          },
        },
      },
    ];
    for (const value of cases)
      expect(() => collectStartingPropertyReceiptRefs(value as typeof current)).toThrow();
  });
});
