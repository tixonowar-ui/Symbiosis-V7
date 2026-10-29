export const CHR_032_FORM_ID = 'CHR-032' as const;
export const CHR_032_ROUTE = '/player/characters/:localCharacterId/create/chr-032' as const;
export const CHR_032_REQUIRED_FIELDS = [
  'characterDraftId',
  'armorBundle',
  'weapon',
  'moneyRecommendation',
  'fivePositions',
  'propertyRollReceipts[8]',
  'exactOperationCount=8',
  'ownershipStateAll=OWNED_NOT_EQUIPPED',
  'massAndMandatoryRowsStatus',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

export const CHR_025_FORM_ID = 'CHR-025' as const;
export const CHR_025_ROUTE = '/player/characters/:localCharacterId/create/chr-025' as const;
export const CHR_025_REQUIRED_FIELDS = [
  'characterDraftId',
  'identityAndMassStatus(sex=MALE|FEMALE frozen after IDENTITY checkpoint; inclusive creation massKg bounds by race/sex: PURE/MALE=60..400kg, PURE/FEMALE=40..350kg, UNITED/MALE=30..150kg, UNITED/FEMALE=25..120kg, FREE/MALE=40..200kg, FREE/FEMALE=30..160kg; massApprovalStatus=PENDING_GM after range validation)',
  'sevenStatsMinOne',
  'skillsAndSlotsStatus',
  'symbiontCompositionStatus',
  'startingPropertyEightReceiptsStatus',
  'cleanRuntimeState',
  'branchCacheIntegrity',
  'validationBlockers[]',
  'finalSaveStatus=NOT_COMMITTED|COMMITTED',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;

export function assertCreationValidationScreenContracts(
  forms: Readonly<Record<string, unknown>>,
  assert: (
    forms: Readonly<Record<string, unknown>>,
    formId: string,
    fields: readonly string[],
    route: string,
    type?: 'screen' | 'dialog',
  ) => void,
): void {
  assert(forms, CHR_032_FORM_ID, CHR_032_REQUIRED_FIELDS, CHR_032_ROUTE, 'screen');
  assert(forms, CHR_025_FORM_ID, CHR_025_REQUIRED_FIELDS, CHR_025_ROUTE, 'screen');
  for (const [formId, title] of [
    [CHR_032_FORM_ID, 'Итог восьми имущественных операций'],
    [CHR_025_FORM_ID, 'Итог создания и валидация'],
  ] as const) {
    if ((forms[formId] as { readonly title?: unknown } | undefined)?.title !== title)
      throw new Error(`${formId} title differs from the creation validation contract`);
  }
}
import type { ActionKey } from '@generated/types/atlas.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';
import type { CreationFinalizationView } from '../creation-finalization-contract.js';
import { deriveStartingPropertySummary } from '../creation-property-summary.js';
const statFacts = (stats: Readonly<Record<'S' | 'D' | 'M' | 'Z' | 'I' | 'W' | 'C', number>>) => ({
  S: stats.S,
  D: stats.D,
  M: stats.M,
  Z: stats.Z,
  I: stats.I,
  W: stats.W,
  C: stats.C,
});

function common(
  checkpoint: DurableCreationWizardCheckpoint,
  view: CreationFinalizationView,
): JsonObject {
  const record =
    checkpoint.finalizationStage?.records.at(-1) ??
    checkpoint.fiveStartingPositionsStage?.checkpointRecordOrNull;
  if (record == null) throw new Error('creation validation requires the five positions checkpoint');
  return {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
    draftRevision: checkpoint.receipt.result.draftRevision,
    commandId: record.request.commandId,
    summaryReceiptIdOrNull: view.summaryReceiptIdOrNull,
    correctionHeadHash: view.correctionHeadHash,
    branchCacheDigest: view.branchCacheDigest,
    finalSaveStatus: view.finalSaveStatus,
  };
}

export function projectChr032(
  checkpoint: DurableCreationWizardCheckpoint,
  view: CreationFinalizationView,
  checkpointCapable: boolean,
): PresentedBaseForm {
  const final = view.finalSaveStatus === 'COMMITTED';
  return {
    formId: CHR_032_FORM_ID,
    formType: 'screen',
    routeTemplate: CHR_032_ROUTE,
    routeBindings: checkpoint.nextStageEnvelope.routeBindings,
    availableActionKeys: final
      ? []
      : [
          ...(checkpointCapable || view.summaryReceiptIdOrNull !== null
            ? ['CHR-032::CTA::001' as const]
            : []),
          'CHR-032::CTA::002',
          'CHR-032::CTA::003',
          'CHR-032::CTA::004',
          'CHR-032::CTA::005',
        ],
    roleFilteredPayload: {
      ...common(checkpoint, view),
      ...deriveStartingPropertySummary(checkpoint),
      propertyCheckpointReceiptId:
        checkpoint.fiveStartingPositionsStage!.checkpointRecordOrNull!.receipt.receiptId,
      massAndMandatoryRowsStatus: {
        valid: view.identityAndMassStatus.valid,
        massApprovalStatus: 'PENDING_GM',
      },
      summaryEntryMode: view.summaryReceiptIdOrNull === null ? 'INITIAL' : 'RESUME',
      nextFormId:
        view.nextCorrectionFormId === 'CHR-041' && view.pendingRollRequestIds.length === 0
          ? 'CHR-041'
          : 'CHR-025',
    },
  };
}

const BLOCKER_ACTIONS = {
  IDENTITY_OR_MASS: 'CHR-025::CTA::001',
  RACE_OR_RACE_DEPENDENCIES: 'CHR-025::CTA::002',
  STATS: 'CHR-025::CTA::003',
  SKILLS: 'CHR-025::CTA::004',
  SYMBIONT_COMPOSITION: 'CHR-025::CTA::005',
  STARTING_PROPERTY: 'CHR-025::CTA::006',
} as const satisfies Record<
  CreationFinalizationView['validationBlockers'][number]['kind'],
  ActionKey
>;

export function projectChr025(
  checkpoint: DurableCreationWizardCheckpoint,
  view: CreationFinalizationView,
  finalSaveCapable: boolean,
): PresentedBaseForm {
  if (view.summaryReceiptIdOrNull === null)
    throw new Error('final validation requires the property summary checkpoint');
  const actions: ActionKey[] = [];
  if (view.finalSaveStatus !== 'COMMITTED') {
    for (const [kind, action] of Object.entries(BLOCKER_ACTIONS)) {
      if (
        kind === 'IDENTITY_OR_MASS' ||
        kind === 'RACE_OR_RACE_DEPENDENCIES' ||
        view.validationBlockers.some((blocker) => blocker.kind === kind)
      )
        actions.push(action);
    }
    if (finalSaveCapable && view.validationBlockers.length === 0) actions.push('CHR-025::CTA::007');
    if (finalSaveCapable && view.validationBlockers.length === 0) actions.push('CHR-025::CTA::008');
    actions.push('CHR-025::CTA::009');
  }
  const mechanics = view.mechanics;
  return {
    formId: CHR_025_FORM_ID,
    formType: 'screen',
    routeTemplate: CHR_025_ROUTE,
    routeBindings: checkpoint.nextStageEnvelope.routeBindings,
    availableActionKeys: actions,
    roleFilteredPayload: {
      ...common(checkpoint, view),
      identity: {
        name: view.state.identity.name,
        age: view.state.identity.age,
        sex: view.state.identity.sex,
        massKg: view.state.identity.massKg,
      },
      raceChoice: view.activeBranch.raceCode,
      pureClassOrNull: view.activeBranch.classCode,
      identityAndMassStatus: {
        valid: view.identityAndMassStatus.valid,
        massApprovalStatus: view.identityAndMassStatus.massApprovalStatus,
        minimumKg: view.identityAndMassStatus.minimumKg,
        maximumKg: view.identityAndMassStatus.maximumKg,
      },
      sevenStatsMinOne: view.sevenStatsMinOne,
      skillsAndSlotsStatus: {
        valid: view.skillsAndSlotsStatus.valid,
        required: view.skillsAndSlotsStatus.required,
        used: view.skillsAndSlotsStatus.used,
      },
      symbiontCompositionStatus: { valid: view.symbiontCompositionStatus.valid },
      startingPropertyEightReceiptsStatus: {
        valid: view.startingPropertyEightReceiptsStatus.valid,
        count: view.startingPropertyEightReceiptsStatus.count,
      },
      cleanRuntimeState: view.cleanRuntimeState,
      branchCacheIntegrity: view.branchCacheIntegrity,
      validationBlockers: view.validationBlockers.map((blocker) => ({
        kind: blocker.kind,
        code: blocker.code,
        message: blocker.message,
        returnFormId: blocker.returnFormId,
      })),
      skillStageStatsOrNull: mechanics === null ? null : statFacts(mechanics.skillStageStats),
      effectiveStatsOrNull: mechanics === null ? null : statFacts(mechanics.effectiveStats),
      statProof:
        mechanics?.statProof.map((proof) => ({
          statCode: proof.statCode,
          skillStageValue: proof.skillStageValue,
          positiveSymbiontDelta: proof.positiveSymbiontDelta,
          negativeSymbiontDelta: proof.negativeSymbiontDelta,
          appliedNegativeDelta: proof.appliedNegativeDelta,
          beforeLimits: proof.beforeLimits,
          minimumOrNull: proof.minimumOrNull,
          maximumOrNull: proof.maximumOrNull,
          effectiveValue: proof.effectiveValue,
        })) ?? [],
      mechanicsSnapshotHashOrNull:
        checkpoint.finalizationStage?.records.at(-1)?.receipt.result.mechanicsSnapshotHashOrNull ??
        null,
      nextFormId: view.finalSaveStatus === 'COMMITTED' ? 'CHR-040' : 'CHR-025',
    },
  };
}

export { projectCreationCorrection } from './chr-creation-correction.js';
