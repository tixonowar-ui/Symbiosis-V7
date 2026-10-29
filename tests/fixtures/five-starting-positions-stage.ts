import { createHash } from 'node:crypto';

import { writeLocalCharacterSymbiontPresentation } from '../../src/persistence/index.js';
import {
  loadCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
} from '../../src/host/creation-set-decide.js';
import { commitWeaponProfile } from '../../src/host/creation-weapon-profile.js';
import { commitStartingMoney } from '../../src/host/creation-starting-money.js';
import { loadStartingMoneyCatalog } from '../../src/host/starting-money-catalog.js';
import { loadFiveStartingPositionsCatalog } from '../../src/host/five-starting-positions-catalog.js';
import {
  fiveStartingPositionsStageForCheckpoint,
  fiveStartingPositionReceiptRefs,
  type FiveStartingPositionSelection,
  type FiveStartingPositionsRollRequest,
  type FiveStartingPositionsCheckpointRequest,
} from '../../src/host/creation-five-starting-positions-contract.js';
import {
  createStartingMoneyProfileSetup,
  startingMoneyCommand,
  startingMoneyProfileRequest,
} from './starting-money-stage.js';

export function fiveStartingPositionSelections(
  checkpoint: DurableCreationWizardCheckpoint,
): readonly FiveStartingPositionSelection[] {
  const stage = fiveStartingPositionsStageForCheckpoint(checkpoint)!;
  const rows = [
    { itemTypeIdOrStoryType: 'RES-AMM-001', quantity: 20, storyDescriptionOrNull: null },
    { itemTypeIdOrStoryType: 'RES-AMM-001', quantity: 3, storyDescriptionOrNull: null },
    { itemTypeIdOrStoryType: 'ITM-PHA-001', quantity: 2, storyDescriptionOrNull: null },
    { itemTypeIdOrStoryType: 'RES-CON-001', quantity: 1, storyDescriptionOrNull: null },
    {
      itemTypeIdOrStoryType: 'GEN-010',
      quantity: 2,
      storyDescriptionOrNull: 'Камень с вырезанным знаком',
    },
  ];
  return stage.slots.map((slot, index) => ({ positionId: slot.positionId, ...rows[index]! }));
}

export function fiveStartingPositionRollRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  commandId: string,
  selectedIndex: number,
  positions = fiveStartingPositionSelections(checkpoint),
  face: number | null = fiveStartingPositionsStageForCheckpoint(checkpoint)!
    .diceInputModeSnapshot === 'AUTO'
    ? null
    : 1,
): FiveStartingPositionsRollRequest {
  const stage = fiveStartingPositionsStageForCheckpoint(checkpoint)!;
  const selected = stage.slots[selectedIndex]!;
  return startingMoneyCommand(
    checkpoint,
    commandId,
    {
      sourceFormId: 'CHR-037',
      variant: 'FIVE_STARTING_POSITIONS_ROLL',
      moneyCheckpointReceiptId: stage.moneyCheckpointReceiptId,
      positions,
      positionId: selected.positionId,
      qualityRollRequestId: selected.qualityRollRequestId,
      manualFaceOrNull: face,
    },
    true,
  ) as FiveStartingPositionsRollRequest;
}

export function fiveStartingPositionsCheckpointRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  commandId: string,
): FiveStartingPositionsCheckpointRequest {
  const stage = fiveStartingPositionsStageForCheckpoint(checkpoint)!;
  return startingMoneyCommand(checkpoint, commandId, {
    sourceFormId: 'CHR-037',
    variant: 'FIVE_STARTING_POSITIONS_CHECKPOINT',
    moneyCheckpointReceiptId: stage.moneyCheckpointReceiptId,
    positionReceipts: fiveStartingPositionReceiptRefs(stage),
  }) as FiveStartingPositionsCheckpointRequest;
}

/** Encode the exact pre-154 shape; all predecessor requests and receipts remain untouched. */
function encodeLegacyCheckpoint(
  setup: Awaited<ReturnType<typeof createStartingMoneyProfileSetup>>['setup'],
  current: DurableCreationWizardCheckpoint,
): void {
  const payload = JSON.parse(current.localCharacter.payloadJson) as Record<string, unknown>;
  delete payload['fiveStartingPositionsStage'];
  const payloadJson = JSON.stringify(payload);
  const snapshot = JSON.parse(current.checkpoint.snapshotJson) as {
    localCharacter: { payloadJson: string };
  };
  snapshot.localCharacter.payloadJson = payloadJson;
  const snapshotJson = JSON.stringify(snapshot);
  setup.database.transaction(() => {
    setup.database
      .prepare('UPDATE local_character SET payload_json = ? WHERE local_character_id = ?')
      .run(payloadJson, setup.characterDraftId);
    setup.database
      .prepare(
        'UPDATE local_character_checkpoint SET snapshot_json = ?, snapshot_sha256 = ? WHERE checkpoint_id = ?',
      )
      .run(
        snapshotJson,
        createHash('sha256').update(snapshotJson).digest('hex'),
        setup.wizardCheckpointId,
      );
    writeLocalCharacterSymbiontPresentation(setup.database, {
      formId: 'CHR-038',
      compositionDraftRevision:
        current.manualCompositionStage?.compositionDraftRevision ??
        current.receipt.result.draftRevision,
      projectionRevision: current.receipt.revisions.projectionRevision,
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: setup.characterDraftId }],
      routeTemplate: '/player/characters/:localCharacterId/create/chr-038',
    });
  })();
}

export async function createFiveStartingPositionsSetup(
  options: Parameters<typeof createStartingMoneyProfileSetup>[0] & { readonly legacy?: boolean },
) {
  const prepared = await createStartingMoneyProfileSetup(options);
  const { setup } = prepared;
  try {
    const [moneyCatalog, positionsCatalog] = await Promise.all([
      loadStartingMoneyCatalog(process.cwd()),
      loadFiveStartingPositionsCatalog(process.cwd()),
    ]);
    let witness = 0;
    let current = commitWeaponProfile(
      setup.database,
      startingMoneyProfileRequest(prepared.current, `${options.prefix}-profile-submit`),
      `${options.prefix}-profile-receipt`,
      {
        catalog: setup.catalog,
        profileCatalog: prepared.profileCatalog,
        allocateRequestId: () => {
          throw new Error('fixture must preserve profile request');
        },
        allocateWitnessReceiptId: () => `${options.prefix}-witness-${String(++witness)}`,
        allocateMoneyRollRequestId: () => `${options.prefix}-money-request`,
      },
    );
    const money = current.startingMoneyStage!;
    const moneyDependencies = { catalog: setup.catalog, moneyCatalog, sampleD20: () => 19 };
    current = commitStartingMoney(
      setup.database,
      startingMoneyCommand(
        current,
        `${options.prefix}-money-roll`,
        {
          sourceFormId: 'CHR-038',
          variant: 'STARTING_MONEY_ROLL',
          moneyRollRequestId: money.moneyRollRequestId,
          manualFaceOrNull: money.diceInputModeSnapshot === 'AUTO' ? null : 19,
        },
        true,
      ),
      `${options.prefix}-money-roll-receipt`,
      moneyDependencies,
    );
    current = commitStartingMoney(
      setup.database,
      startingMoneyCommand(current, `${options.prefix}-money-checkpoint`, {
        sourceFormId: 'CHR-038',
        variant: 'STARTING_MONEY_CHECKPOINT',
        moneyRollRequestId: money.moneyRollRequestId,
        moneyRollReceiptId: current.startingMoneyStage!.rollRecordOrNull!.receipt.receiptId,
      }),
      `${options.prefix}-money-checkpoint-receipt`,
      moneyDependencies,
    );
    if (options.legacy) {
      encodeLegacyCheckpoint(setup, current);
      current = loadCreationWizardCheckpoint(
        setup.database,
        setup.characterDraftId,
        setup.catalog.skillStage,
        setup.catalog,
      );
    }
    return { setup, current, positionsCatalog };
  } catch (error) {
    setup.database.close();
    throw error;
  }
}
