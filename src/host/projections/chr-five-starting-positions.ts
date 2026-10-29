import type { ActionKey } from '@generated/types/atlas.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import type { FiveStartingPositionsCatalog } from '../../domain/rules/item-stage/five-starting-positions.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';
import {
  fiveStartingPositionSnapshots,
  fiveStartingPositionsStageForCheckpoint,
} from '../creation-five-starting-positions-contract.js';

export const CHR_037_FORM_ID = 'CHR-037' as const;
export const CHR_037_ROUTE = '/player/characters/:localCharacterId/create/chr-037' as const;
export const CHR_037_REQUIRED_FIELDS = [
  'characterDraftId',
  'positions[5]=(positionId,itemTypeIdOrStoryType,quantity>0,qualityRollRequestId,qualityRollReceiptId,qualityRecommendation)',
  'distinctPositionCount=5',
  'storyItemCountsAsOnePosition=true',
  'ownershipState=OWNED_NOT_EQUIPPED',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

export function projectChr037(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: FiveStartingPositionsCatalog,
  rollCommitCapable: boolean,
  checkpointCapable: boolean,
): PresentedBaseForm {
  const stage = fiveStartingPositionsStageForCheckpoint(checkpoint);
  if (stage === null) throw new Error('five positions projection requires a money checkpoint');
  const done = stage.checkpointRecordOrNull;
  const snapshots = fiveStartingPositionSnapshots(stage);
  const missing = snapshots.some((position) => position.qualityRollReceiptId === null);
  const actions: ActionKey[] =
    done !== null
      ? []
      : [
          ...(missing
            ? [
                'CHR-037::CTA::003' as const,
                ...(rollCommitCapable ? ['CHR-037::CTA::004' as const] : []),
              ]
            : checkpointCapable
              ? ['CHR-037::CTA::001' as const]
              : []),
          'CHR-037::CTA::002',
        ];
  return {
    availableActionKeys: actions,
    formId: CHR_037_FORM_ID,
    formType: 'screen',
    routeTemplate: CHR_037_ROUTE,
    routeBindings: checkpoint.nextStageEnvelope.routeBindings,
    roleFilteredPayload: {
      characterDraftId: checkpoint.localCharacter.localCharacterId,
      moneyCheckpointReceiptId: stage.moneyCheckpointReceiptId,
      moneyRollRequestId: stage.moneyRollRequestId,
      moneyRollReceiptId: stage.moneyRollReceiptId,
      diceInputModeSnapshot: stage.diceInputModeSnapshot,
      eligibleItemTypes: catalog.entries.map((entry) => ({
        itemTypeIdOrStoryType: entry.itemTypeIdOrStoryType,
        kind: entry.kind,
        name: entry.name,
      })),
      positions: snapshots.map((position) => ({
        positionId: position.positionId,
        qualityRollRequestId: position.qualityRollRequestId,
        itemTypeIdOrStoryType: position.itemTypeIdOrStoryType,
        quantity: position.quantity,
        storyDescriptionOrNull: position.storyDescriptionOrNull,
        name: position.name,
        kind: position.kind,
        qualityRollReceiptId: position.qualityRollReceiptId,
        qualityRollFaceOrNull: position.qualityRollFaceOrNull,
        qualityRecommendation:
          position.qualityRecommendation === null
            ? null
            : {
                kind: position.qualityRecommendation.kind,
                label: position.qualityRecommendation.label,
                range: position.qualityRecommendation.range,
                rawFace: position.qualityRecommendation.rawFace,
              },
      })),
      distinctPositionCount: 5,
      storyItemCountsAsOnePosition: true,
      ownershipState: 'OWNED_NOT_EQUIPPED',
      positionsCheckpointReceiptIdOrNull: done?.receipt.receiptId ?? null,
      wizardCheckpointId: checkpoint.checkpoint.checkpointId,
      draftRevision: checkpoint.receipt.result.draftRevision,
      commandId: (done?.request ?? stage.rollRecords.at(-1)?.request ?? stage.entryRequest)
        .commandId,
      nextFormId: done === null ? 'CHR-037' : 'CHR-032',
    },
  };
}

export function assertFiveStartingPositionsScreenContracts(
  forms: Readonly<Record<string, unknown>>,
  assert: (
    forms: Readonly<Record<string, unknown>>,
    formId: string,
    fields: readonly string[],
    route: string,
    type?: 'screen' | 'dialog',
  ) => void,
): void {
  assert(forms, CHR_037_FORM_ID, CHR_037_REQUIRED_FIELDS, CHR_037_ROUTE, 'screen');
  if (
    (forms[CHR_037_FORM_ID] as { readonly title?: unknown } | undefined)?.title !==
    'Пять произвольных позиций'
  )
    throw new Error('CHR-037 title differs from the five starting positions contract');
}
