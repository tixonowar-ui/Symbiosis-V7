import type { ActionKey } from '@generated/types/atlas.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import type { JsonObject } from '@shared/wire-protocol.js';

import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';
import type { StartingWeaponItemCatalog } from '../starting-weapon-catalog.js';

export const CHR_022_FORM_ID = 'CHR-022' as const;
export const CHR_022_ROUTE = '/player/characters/:localCharacterId/create/chr-022' as const;
export const CHR_022_ROLL_ACTION_KEY = 'CHR-022::CTA::004' as const satisfies ActionKey;
export const CHR_022_CONFIRM_ACTION_KEY = 'CHR-022::CTA::001' as const satisfies ActionKey;
export const CHR_022_PURE_CONFIRM_ACTION_KEY = 'CHR-022::CTA::002' as const satisfies ActionKey;
export const CHR_022_RETURN_ACTION_KEY = 'CHR-022::CTA::003' as const satisfies ActionKey;
export const CHR_022_REQUIRED_FIELDS = [
  'characterDraftId',
  'weaponTypeId',
  'weaponVariant',
  'raceChoice',
  'weaponQualityRollRequestId',
  'weaponQualityRollReceiptIdOrNull',
  'qualityRecommendation',
  'requirementPreview',
  'ownershipState=OWNED_NOT_EQUIPPED',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

export function projectChr022(
  checkpoint: DurableCreationWizardCheckpoint,
  weaponCatalog: Pick<StartingWeaponItemCatalog, 'entries'>,
  rollCommitCapable: boolean,
  checkpointCapable: boolean,
): PresentedBaseForm {
  const stage = checkpoint.startingWeaponStage;
  const raceChoice = checkpoint.raceAndMethodStage?.race?.value;
  if (stage === null || stage === undefined || raceChoice === undefined)
    throw new Error('starting weapon projection requires a committed stage and race');
  // Atlas signs distinct formula/fixed continuations; incompatible choices must not trap a committed roll.
  const entries = weaponCatalog.entries.filter(
    (entry) => entry.profileKind === (raceChoice === 'PURE' ? 'FIXED' : 'FORMULA'),
  );
  if (entries.length === 0)
    throw new Error(`starting weapon catalog has no entries for ${raceChoice}`);
  const roll = stage.qualityRollRecordOrNull;
  const committed = stage.checkpointRecordOrNull;
  const selected =
    roll === null
      ? null
      : entries.find(
          (entry) =>
            entry.weaponTypeId === roll.weaponTypeId && entry.weaponVariant === roll.weaponVariant,
        );
  if (selected === undefined)
    throw new Error('committed starting weapon is absent from its race catalog');
  const actions: ActionKey[] = [];
  if (committed === null) {
    if (roll === null) {
      if (rollCommitCapable) actions.push(CHR_022_ROLL_ACTION_KEY);
    } else if (checkpointCapable) {
      actions.push(
        raceChoice === 'PURE' ? CHR_022_PURE_CONFIRM_ACTION_KEY : CHR_022_CONFIRM_ACTION_KEY,
      );
    }
    actions.push(CHR_022_RETURN_ACTION_KEY);
  }
  const payload: JsonObject = {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    weaponCatalog: {
      entries: entries.map((entry) => ({
        weaponTypeId: entry.weaponTypeId,
        weaponVariant: entry.weaponVariant,
        name: entry.name,
        variantLabel: entry.variantLabel,
        requirementPreview: { ...entry.requirementPreview },
      })),
    },
    weaponTypeId: roll?.weaponTypeId ?? null,
    weaponVariant: roll?.weaponVariant ?? null,
    raceChoice,
    weaponQualityRollRequestId: stage.weaponQualityRollRequestId,
    weaponQualityRollReceiptIdOrNull: roll?.receipt.receiptId ?? null,
    weaponCheckpointReceiptIdOrNull: committed?.receipt.receiptId ?? null,
    qualityRecommendation: roll === null ? null : { ...roll.qualityRecommendation },
    requirementPreview: selected === null ? null : { ...selected.requirementPreview },
    ownershipState: 'OWNED_NOT_EQUIPPED',
    diceInputModeSnapshot: stage.diceInputModeSnapshot,
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
    draftRevision: checkpoint.receipt.result.draftRevision,
    commandId: (committed?.request ?? roll?.request ?? stage.entryRequest).commandId,
    nextFormId: committed?.nextStageEnvelope.formId ?? 'CHR-022',
  };
  return {
    availableActionKeys: actions,
    formId: CHR_022_FORM_ID,
    formType: 'screen',
    roleFilteredPayload: payload,
    routeBindings:
      checkpoint.symbiontPresentationStage?.routeBindings ??
      checkpoint.nextStageEnvelope.routeBindings,
    routeTemplate: CHR_022_ROUTE,
  };
}

export function assertStartingWeaponScreenContracts(
  forms: Readonly<Record<string, unknown>>,
  assert: (
    forms: Readonly<Record<string, unknown>>,
    formId: string,
    requiredFields: readonly string[],
    route: string,
    formType?: 'dialog' | 'screen',
  ) => void,
): void {
  assert(forms, CHR_022_FORM_ID, CHR_022_REQUIRED_FIELDS, CHR_022_ROUTE);
  const form = forms[CHR_022_FORM_ID] as { readonly title?: unknown } | undefined;
  if (form?.title !== 'Стартовое оружие')
    throw new Error('CHR-022 title differs from the starting weapon contract');
}
