import type { ActionKey } from '@generated/types/atlas.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';

import { startingMoneyStageForCheckpoint } from '../creation-starting-money-contract.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';

export const CHR_038_FORM_ID = 'CHR-038' as const;
export const CHR_038_ROUTE = '/player/characters/:localCharacterId/create/chr-038' as const;
export const CHR_038_ROLL_ACTION_KEY = 'CHR-038::CTA::003' as const satisfies ActionKey;
export const CHR_038_CONFIRM_ACTION_KEY = 'CHR-038::CTA::001' as const satisfies ActionKey;
export const CHR_038_RETURN_ACTION_KEY = 'CHR-038::CTA::002' as const satisfies ActionKey;
export const CHR_038_REQUIRED_FIELDS = [
  'characterDraftId',
  'moneyRollRequestId',
  'diceInputModeSnapshot',
  'moneyRollFaceOrNull',
  'moneyRollReceiptIdOrNull',
  'wealthRecommendation',
  'gmFinalizationRequired=true',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

export function projectChr038(
  checkpoint: DurableCreationWizardCheckpoint,
  rollCommitCapable: boolean,
  checkpointCapable: boolean,
): PresentedBaseForm {
  const stage = startingMoneyStageForCheckpoint(checkpoint);
  const weapon = checkpoint.startingWeaponStage;
  const profile = checkpoint.weaponProfileStage;
  if (stage == null || weapon?.checkpointRecordOrNull == null || profile == null)
    throw new Error('starting money projection requires confirmed weapon and profile receipts');
  const roll = stage.rollRecordOrNull;
  const done = stage.checkpointRecordOrNull;
  const recommendation = roll?.wealthRecommendation ?? null;
  const actions: ActionKey[] = [];
  if (done === null) {
    if (roll === null) {
      if (rollCommitCapable) actions.push(CHR_038_ROLL_ACTION_KEY);
    } else if (checkpointCapable) actions.push(CHR_038_CONFIRM_ACTION_KEY);
    actions.push(CHR_038_RETURN_ACTION_KEY);
  }
  return {
    availableActionKeys: actions,
    formId: CHR_038_FORM_ID,
    formType: 'screen',
    routeTemplate: CHR_038_ROUTE,
    routeBindings:
      checkpoint.symbiontPresentationStage?.routeBindings ??
      checkpoint.nextStageEnvelope.routeBindings,
    roleFilteredPayload: {
      characterDraftId: checkpoint.localCharacter.localCharacterId,
      moneyRollRequestId: stage.moneyRollRequestId,
      diceInputModeSnapshot: stage.diceInputModeSnapshot,
      moneyRollFaceOrNull: roll?.physicalRoll.mechanical.rawFace ?? null,
      moneyRollReceiptIdOrNull: roll?.receipt.receiptId ?? null,
      wealthRecommendation:
        recommendation === null
          ? null
          : {
              kind: recommendation.kind,
              label: recommendation.label,
              range: recommendation.range,
              rawFace: recommendation.rawFace,
            },
      gmFinalizationRequired: true,
      profileReceiptId: stage.profileReceiptId,
      weaponCheckpointReceiptId: weapon.checkpointRecordOrNull.receipt.receiptId,
      weaponProfileFormId: profile.kind === 'FORMULA' ? 'CHR-023' : 'CHR-024',
      moneyCheckpointReceiptIdOrNull: done?.receipt.receiptId ?? null,
      wizardCheckpointId: checkpoint.checkpoint.checkpointId,
      draftRevision: checkpoint.receipt.result.draftRevision,
      commandId: (done?.request ?? roll?.request ?? stage.entryRequest).commandId,
      nextFormId: done === null ? 'CHR-038' : 'CHR-037',
    },
  };
}

export function assertStartingMoneyScreenContracts(
  forms: Readonly<Record<string, unknown>>,
  assert: (
    forms: Readonly<Record<string, unknown>>,
    formId: string,
    fields: readonly string[],
    route: string,
    type?: 'screen' | 'dialog',
  ) => void,
): void {
  assert(forms, CHR_038_FORM_ID, CHR_038_REQUIRED_FIELDS, CHR_038_ROUTE, 'screen');
  if (
    (forms[CHR_038_FORM_ID] as { readonly title?: unknown } | undefined)?.title !==
    'Стартовые деньги'
  )
    throw new Error('CHR-038 title differs from the starting money contract');
}
