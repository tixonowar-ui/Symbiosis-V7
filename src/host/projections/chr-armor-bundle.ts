import type { ActionKey } from '@generated/types/atlas.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import type { JsonObject } from '@shared/wire-protocol.js';

import type { ArmorBundleCatalog } from '../../domain/index.js';
import type { ArmorBundleStage } from '../creation-armor-bundle-contract.js';
import { latestArmorBundleRecord } from '../creation-armor-bundle.js';
import { manualAdvisorWorkPending } from '../creation-manual-composition-navigation.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';

export const CHR_021_FORM_ID = 'CHR-021' as const;
export const CHR_021_ROUTE = '/player/characters/:localCharacterId/create/chr-021' as const;
export const CHR_021_ROLL_ACTION_KEY = 'CHR-021::CTA::003' as const satisfies ActionKey;
export const CHR_021_CONFIRM_ACTION_KEY = 'CHR-021::CTA::001' as const satisfies ActionKey;
export const CHR_021_RETURN_ACTION_KEY = 'CHR-021::CTA::002' as const satisfies ActionKey;

export const CHR_021_REQUIRED_FIELDS = [
  'characterDraftId',
  'anatomyProfile',
  'armorPieces[1..6]',
  'distinctBodyZones',
  'armorBundleId',
  'qualityRollRequestId',
  'qualityRollReceiptIdOrNull',
  'qualityRecommendation',
  'ownershipState=OWNED_NOT_EQUIPPED',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

function armorStage(checkpoint: DurableCreationWizardCheckpoint): ArmorBundleStage {
  const stage = checkpoint.armorBundleStage;
  if (stage === null || stage === undefined) {
    throw new Error('armor bundle stage is missing');
  }
  return stage;
}

function catalogJson(catalog: ArmorBundleCatalog): JsonObject {
  return {
    entries: catalog.entries.map((entry) => ({
      itemId: entry.itemId,
      name: entry.name,
      coverageModel: entry.coverageModel,
    })),
  };
}

export function projectChr021(
  checkpoint: DurableCreationWizardCheckpoint,
  armorCatalog: ArmorBundleCatalog,
  rollCommitCapable: boolean,
  checkpointCapable: boolean,
): PresentedBaseForm {
  const stage = armorStage(checkpoint);
  const rollRecord = stage.qualityRollRecordOrNull;
  const checkpointRecord = stage.checkpointRecordOrNull;
  const actions: ActionKey[] = [];
  if (checkpointRecord === null) {
    if (rollRecord === null) {
      if (rollCommitCapable) actions.push(CHR_021_ROLL_ACTION_KEY);
    } else {
      if (checkpointCapable) actions.push(CHR_021_CONFIRM_ACTION_KEY);
      actions.push(CHR_021_RETURN_ACTION_KEY);
    }
  }
  const pieces = rollRecord?.armorPieces ?? [];
  return {
    availableActionKeys: actions,
    formId: CHR_021_FORM_ID,
    formType: 'screen',
    roleFilteredPayload: {
      characterDraftId: checkpoint.localCharacter.localCharacterId,
      anatomyProfile: 'STANDARD_HUMANOID',
      armorCatalog: catalogJson(armorCatalog),
      armorBundleId: stage.armorBundleId,
      qualityRollRequestId: stage.qualityRollRequestId,
      qualityRollReceiptIdOrNull: rollRecord?.receipt.receiptId ?? null,
      bundleCheckpointReceiptIdOrNull: checkpointRecord?.receipt.receiptId ?? null,
      nextFormId: checkpoint.nextStageEnvelope.formId,
      armorPieces: pieces.map((piece) => ({
        itemId: piece.itemId,
        name: piece.name,
        coverageModel: piece.coverageModel,
        bodyZone: piece.bodyZone,
      })),
      distinctBodyZones: rollRecord?.distinctBodyZones ?? [],
      qualityRecommendation: rollRecord?.qualityRecommendation ?? null,
      ownershipState: 'OWNED_NOT_EQUIPPED',
      diceInputModeSnapshot: stage.diceInputModeSnapshot,
      wizardCheckpointId: checkpoint.checkpoint.checkpointId,
      draftRevision: checkpoint.receipt.result.draftRevision,
      commandId: latestArmorBundleRecord(stage).request.commandId,
    },
    routeBindings:
      checkpoint.symbiontPresentationStage?.routeBindings ??
      checkpoint.nextStageEnvelope.routeBindings,
    routeTemplate: CHR_021_ROUTE,
  };
}

export function assertArmorBundleScreenContracts(
  forms: Readonly<Record<string, unknown>>,
  assert: (
    forms: Readonly<Record<string, unknown>>,
    formId: string,
    requiredFields: readonly string[],
    route: string,
    formType?: 'dialog' | 'screen',
  ) => void,
): void {
  assert(forms, CHR_021_FORM_ID, CHR_021_REQUIRED_FIELDS, CHR_021_ROUTE);
}

export const CHR_019_ARMOR_ENTRY_ACTION_KEY = 'CHR-019::CTA::001' as const satisfies ActionKey;

export function armorBundleEntryEligible(checkpoint: DurableCreationWizardCheckpoint): boolean {
  const raceAndMethod = checkpoint.raceAndMethodStage;
  if (
    raceAndMethod === null ||
    raceAndMethod.race?.value === undefined ||
    raceAndMethod.race.value === 'PURE' ||
    raceAndMethod.diceInput?.value === undefined ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-019' ||
    (checkpoint.armorBundleStage !== null && checkpoint.armorBundleStage !== undefined)
  ) {
    return false;
  }
  const manualStage = checkpoint.manualCompositionStage;
  if (manualStage !== null && manualStage !== undefined) {
    return !manualAdvisorWorkPending(manualStage);
  }
  const randomStage = checkpoint.randomSymbiontStage;
  if (randomStage !== null && randomStage !== undefined) {
    return (
      randomStage.bindingRecordOrNull !== null &&
      (randomStage.advisorInstanceDraftIdOrNull === null ||
        randomStage.advisorSkillRecordOrNull !== null)
    );
  }
  return false;
}
