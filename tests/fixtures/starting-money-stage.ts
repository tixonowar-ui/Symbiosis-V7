import type { JsonObject } from '@shared/wire-protocol.js';

import { loadArmorBundleCatalog } from '../../src/host/armor-bundle-catalog.js';
import {
  commitArmorBundleCheckpoint,
  commitArmorBundleEntry,
  commitArmorBundleQualityRoll,
} from '../../src/host/creation-armor-bundle.js';
import { advancePureCompositionPresentation } from '../../src/host/creation-pure-composition.js';
import {
  currentCreationWizardRevisions,
  type DurableCreationWizardCheckpoint,
} from '../../src/host/creation-set-decide.js';
import {
  commitStartingWeaponCheckpoint,
  commitStartingWeaponQualityRoll,
} from '../../src/host/creation-starting-weapon.js';
import type {
  WeaponProfileAcknowledgeRequest,
  WeaponProfileSubmitRequest,
} from '../../src/host/creation-weapon-profile-contract.js';
import { commitCreationWizardCheckpoint } from '../../src/host/creation-wizard-checkpoint.js';
import { loadStartingWeaponCatalog } from '../../src/host/starting-weapon-catalog.js';
import { loadWeaponProfileCatalog } from '../../src/host/weapon-profile-catalog.js';
import { createManualWizardSetup, manualCompositionRequest } from './manual-symbiont-stage.js';

export const MONEY_PROFILE_INPUTS: JsonObject = {
  commonWitness: { L: 1, Lw: 10, Ls: 4 },
  independentDice: { R12_DMG: 2, R12_RANGE: 2, R20_RS: 2 },
  formulaOutputs: { Dm: 3, Rn: 6, Rs: 1, Rd: 2 },
};

export function startingMoneyCommand(
  checkpoint: DurableCreationWizardCheckpoint,
  id: string,
  payload: JsonObject,
  roll = false,
) {
  return {
    commandId: id,
    commandKind: 'workflow-command' as const,
    expectedRevisions: currentCreationWizardRevisions(checkpoint),
    messageType: 'command.request' as const,
    protocolVersion: 1 as const,
    role: 'player' as const,
    workflowCommandId: roll
      ? ('UI-CMD-CHAR-CREATION-ROLL-COMMIT' as const)
      : ('UI-CMD-CHAR-WIZARD-CHECKPOINT' as const),
    payload: {
      characterDraftId: checkpoint.localCharacter.localCharacterId,
      wizardCheckpointId: checkpoint.checkpoint.checkpointId,
      draftRevision: checkpoint.receipt.result.draftRevision,
      stage: 'SYMBIONTS' as const,
      ...payload,
    },
  };
}

export function startingMoneyProfileRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  id: string,
  inputs: JsonObject = MONEY_PROFILE_INPUTS,
): WeaponProfileSubmitRequest | WeaponProfileAcknowledgeRequest {
  const stage = checkpoint.weaponProfileStage!;
  if (stage.kind === 'FIXED')
    return startingMoneyCommand(checkpoint, id, {
      sourceFormId: 'CHR-024',
      variant: 'WEAPON_PROFILE_ACKNOWLEDGE',
      requestId: stage.requestId,
      canonicalProfileVersion: 'ITEM_REGISTRY_V1.2',
    }) as WeaponProfileAcknowledgeRequest;
  return {
    ...startingMoneyCommand(checkpoint, id, {
      sourceFormId: 'CHR-023',
      variant: 'WEAPON_PROFILE_SUBMIT',
      requestId: stage.requestId,
      weaponTypeId: 'ITM-WPN-001',
      weaponVariant: 'DEFAULT',
      inputs,
    }),
    workflowCommandId: 'UI-CMD-PLAYER-WEAPON-REQUEST-SUBMIT',
  } as WeaponProfileSubmitRequest;
}

/** Build real predecessor receipts so money tests exercise the complete loader history. */
export async function createStartingMoneyProfileSetup(options: {
  readonly prefix: string;
  readonly diceInputMode?: 'AUTO' | 'MANUAL';
  readonly raceChoice?: 'FREE' | 'UNITED' | 'PURE';
  readonly prepareManualComposition?: (
    setup: ReturnType<typeof createManualWizardSetup>,
  ) => DurableCreationWizardCheckpoint;
  readonly databasePath?: string;
  readonly characterDraftId?: string;
  readonly massKg?: number;
}) {
  const { prefix } = options;
  const race = options.raceChoice ?? 'FREE';
  const mode = options.diceInputMode ?? 'MANUAL';
  const [armorCatalog, weaponCatalog, profileCatalog] = await Promise.all([
    loadArmorBundleCatalog(process.cwd()),
    loadStartingWeaponCatalog(process.cwd()),
    loadWeaponProfileCatalog(process.cwd()),
  ]);
  const setup = createManualWizardSetup(
    prefix,
    race,
    mode,
    options.databasePath ?? ':memory:',
    options.characterDraftId,
    options.massKg,
  );
  try {
    let current: DurableCreationWizardCheckpoint;
    if (race === 'PURE') {
      current = advancePureCompositionPresentation(
        setup.database,
        {
          characterDraftId: setup.characterDraftId,
          wizardCheckpointId: setup.wizardCheckpointId,
          formId: 'CHR-015',
        },
        setup.catalog,
      );
      commitCreationWizardCheckpoint(
        setup.database,
        {
          ...setup.selectionRequest,
          commandId: `${prefix}-pure-reconfirm`,
          expectedRevisions: currentCreationWizardRevisions(current),
          payload: {
            ...setup.selectionRequest.payload,
            draftRevision: current.receipt.result.draftRevision,
          },
        },
        `${prefix}-pure-reconfirm-receipt`,
        setup.catalog,
        undefined,
        undefined,
        {
          allocateArmorBundleId: () => `${prefix}-armor`,
          allocateQualityRollRequestId: () => `${prefix}-armor-request`,
        },
      );
      current = advancePureCompositionPresentation(
        setup.database,
        {
          characterDraftId: setup.characterDraftId,
          wizardCheckpointId: setup.wizardCheckpointId,
          formId: 'CHR-021',
        },
        setup.catalog,
      );
    } else {
      current =
        options.prepareManualComposition?.(setup) ??
        commitCreationWizardCheckpoint(
          setup.database,
          manualCompositionRequest(setup, setup.checkpoint, `${prefix}-composition`, ['EEL']),
          `${prefix}-composition-receipt`,
          setup.catalog,
          () => {
            throw new Error('manual composition must not allocate a sequence');
          },
          {
            allocateRollRequestId: () => {
              throw new Error('EEL composition has no Advisor requests');
            },
            sampleD20: () => {
              throw new Error('EEL composition has no Advisor rolls');
            },
          },
        );
      current = commitArmorBundleEntry(
        setup.database,
        startingMoneyCommand(current, `${prefix}-armor-entry`, {
          sourceFormId: 'CHR-019',
          variant: 'ARMOR_BUNDLE_ENTRY',
        }),
        `${prefix}-armor-entry-receipt`,
        {
          catalog: setup.catalog,
          allocateArmorBundleId: () => `${prefix}-armor`,
          allocateQualityRollRequestId: () => `${prefix}-armor-request`,
        },
      );
    }
    current = commitArmorBundleQualityRoll(
      setup.database,
      startingMoneyCommand(
        current,
        `${prefix}-armor-roll`,
        {
          sourceFormId: 'CHR-021',
          variant: 'ARMOR_BUNDLE_QUALITY',
          armorBundleId: current.armorBundleStage!.armorBundleId,
          qualityRollRequestId: current.armorBundleStage!.qualityRollRequestId,
          armorPieces: [{ itemId: 'ITM-ARM-005', bodyZoneOrNull: null }],
          manualFaceOrNull: mode === 'MANUAL' ? 19 : null,
        },
        true,
      ),
      `${prefix}-armor-roll-receipt`,
      { catalog: setup.catalog, armorCatalog, sampleD20: () => 19 },
    );
    current = commitArmorBundleCheckpoint(
      setup.database,
      startingMoneyCommand(current, `${prefix}-armor-checkpoint`, {
        sourceFormId: 'CHR-021',
        variant: 'ARMOR_BUNDLE_CHECKPOINT',
        armorBundleId: current.armorBundleStage!.armorBundleId,
        qualityRollReceiptId: current.armorBundleStage!.qualityRollRecordOrNull!.receipt.receiptId,
      }),
      `${prefix}-armor-checkpoint-receipt`,
      {
        catalog: setup.catalog,
        allocateWeaponQualityRollRequestId: () => `${prefix}-weapon-request`,
      },
    );
    current = commitStartingWeaponQualityRoll(
      setup.database,
      startingMoneyCommand(
        current,
        `${prefix}-weapon-roll`,
        {
          sourceFormId: 'CHR-022',
          variant: 'STARTING_WEAPON_QUALITY',
          weaponQualityRollRequestId: current.startingWeaponStage!.weaponQualityRollRequestId,
          weaponTypeId: race === 'PURE' ? 'ITM-WPN-003' : 'ITM-WPN-001',
          weaponVariant: 'DEFAULT',
          manualFaceOrNull: mode === 'MANUAL' ? 1 : null,
        },
        true,
      ),
      `${prefix}-weapon-roll-receipt`,
      { catalog: setup.catalog, weaponCatalog, sampleD20: () => 1 },
    );
    current = commitStartingWeaponCheckpoint(
      setup.database,
      startingMoneyCommand(current, `${prefix}-weapon-checkpoint`, {
        sourceFormId: 'CHR-022',
        variant: 'STARTING_WEAPON_CHECKPOINT',
        weaponQualityRollRequestId: current.startingWeaponStage!.weaponQualityRollRequestId,
        weaponQualityRollReceiptId:
          current.startingWeaponStage!.qualityRollRecordOrNull!.receipt.receiptId,
      }),
      `${prefix}-weapon-checkpoint-receipt`,
      {
        catalog: setup.catalog,
        weaponCatalog,
        allocateProfileRequestId: () => `${prefix}-profile-request`,
      },
    );
    return { setup, current, profileCatalog };
  } catch (error) {
    setup.database.close();
    throw error;
  }
}
