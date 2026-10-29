import type { ActionKey } from '@generated/types/atlas.js';
import type { PresentedBaseForm, PresentedLayerForm } from '@shared/wire-v2-protocol.js';
import type { JsonObject } from '@shared/wire-protocol.js';

import {
  canonicalFixedWeaponProfile,
  findWeaponProfile,
  weaponProfilePlayerFacts,
  type WeaponProfileCatalog,
  type WeaponProfileInputs,
  type WeaponEffectiveProfile,
} from '../../domain/rules/item-stage/weapon-profile.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';

export const CHR_023_FORM_ID = 'CHR-023' as const;
export const CHR_024_FORM_ID = 'CHR-024' as const;
export const CHR_031_FORM_ID = 'CHR-031' as const;
export const CHR_023_ROUTE = '/player/characters/:localCharacterId/create/chr-023' as const;
export const CHR_024_ROUTE = '/player/characters/:localCharacterId/create/chr-024' as const;
export const CHR_031_ROUTE = '@dialog/chr-031' as const;
export const CHR_023_SUBMIT_ACTION_KEY = 'CHR-023::CTA::001' as const satisfies ActionKey;
export const CHR_023_RETURN_ACTION_KEY = 'CHR-023::CTA::002' as const satisfies ActionKey;
export const CHR_024_ACKNOWLEDGE_ACTION_KEY = 'CHR-024::CTA::001' as const satisfies ActionKey;
export const CHR_024_RETURN_ACTION_KEY = 'CHR-024::CTA::002' as const satisfies ActionKey;
export const CHR_031_RETURN_ACTION_KEY = 'CHR-031::CTA::001' as const satisfies ActionKey;
export const CHR_023_REQUIRED_FIELDS = [
  'characterDraftId',
  'requestId',
  'weaponTypeId',
  'weaponVariantId',
  'commonWitness=(L,Lw,Ls)',
  'allowedFormulaVariables',
  'playerInputs',
  'independentManufacturingDiceReceipts[]',
  'formulaOutputs',
  'reachabilityProof',
  'proposedWeaponProfile',
  'requestStatus=DRAFT|VALIDATED|SUBMITTED',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_024_REQUIRED_FIELDS = [
  'characterDraftId',
  'raceChoice=PURE',
  'weaponTypeId',
  'canonicalProfileVersion',
  'fixedProfile(read-only)',
  'requirementPenaltyPreview',
  'ownershipState=OWNED_NOT_EQUIPPED',
  'wizardCheckpointId',
  'draftRevision',
  'commandId',
] as const;
export const CHR_031_REQUIRED_FIELDS = [
  'characterDraftId',
  'weaponTypeId',
  'invalidFieldSet',
  'formulaReachabilityFailures[]',
  'humanExplanations[]',
  'returnFormId(server-signed)=CHR-023',
  'draftRevision',
] as const;

function context(checkpoint: DurableCreationWizardCheckpoint, catalog: WeaponProfileCatalog) {
  const stage = checkpoint.weaponProfileStage;
  const weapon = checkpoint.startingWeaponStage;
  const roll = weapon?.qualityRollRecordOrNull;
  const committed = weapon?.checkpointRecordOrNull;
  if (
    stage === null ||
    stage === undefined ||
    weapon === null ||
    weapon === undefined ||
    roll === null ||
    roll === undefined ||
    committed === null ||
    committed === undefined
  )
    throw new Error(
      'weapon profile projection requires a committed weapon and addressed profile stage',
    );
  const entry = findWeaponProfile(catalog, {
    weaponTypeId: roll.weaponTypeId,
    weaponVariant: roll.weaponVariant,
  });
  const last = stage.records.at(-1);
  const common: JsonObject = {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    requestId: stage.requestId,
    weaponTypeId: roll.weaponTypeId,
    weaponVariantId: roll.weaponVariant,
    weaponName: entry.name,
    variantLabel: entry.variantLabel,
    weaponQualityRollRequestId: weapon.weaponQualityRollRequestId,
    weaponQualityRollReceiptId: roll.receipt.receiptId,
    weaponCheckpointReceiptId: committed.receipt.receiptId,
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
    draftRevision: checkpoint.receipt.result.draftRevision,
    commandId: (last?.request ?? stage.entryRequest).commandId,
    ownershipState: 'OWNED_NOT_EQUIPPED',
  };
  return { stage, entry, last, common };
}

/** Invalid requests remain durable for replay; only recognized numeric input fields may be shown. */
function playerInputs(
  value: unknown,
  formula: NonNullable<ReturnType<typeof findWeaponProfile>['formula']>,
): WeaponProfileInputs | null {
  const object = (candidate: unknown): candidate is Record<string, unknown> =>
    typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
  if (!object(value)) return null;
  const group = (
    name: string,
    fields: readonly { readonly key: string }[],
  ): Record<string, number> | null => {
    const raw = value[name];
    if (!object(raw)) return null;
    const result: Record<string, number> = {};
    for (const field of fields) {
      const item = raw[field.key];
      if (typeof item !== 'number' || !Number.isFinite(item)) return null;
      result[field.key] = item;
    }
    return result;
  };
  const commonWitness = group('commonWitness', formula.variables);
  const independentDice = group('independentDice', formula.independentDice);
  const formulaOutputs = group('formulaOutputs', formula.outputs);
  if (commonWitness === null || independentDice === null || formulaOutputs === null) return null;
  return {
    commonWitness: { L: commonWitness['L']!, Lw: commonWitness['Lw']!, Ls: commonWitness['Ls']! },
    independentDice,
    formulaOutputs,
  };
}

export function projectChr023(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: WeaponProfileCatalog,
  submitCapable: boolean,
): PresentedBaseForm {
  const { stage, entry, last, common } = context(checkpoint, catalog);
  if (
    stage.kind !== 'FORMULA' ||
    entry.formula === null ||
    checkpoint.raceAndMethodStage?.race?.value === 'PURE'
  )
    throw new Error('CHR-023 requires the formula profile path');
  const result = last?.receipt.result;
  const submitted = result?.outcome === 'SUBMITTED';
  const inputs =
    last?.request.payload.variant === 'WEAPON_PROFILE_SUBMIT'
      ? playerInputs(last.request.payload['inputs'], entry.formula)
      : null;
  const payload: JsonObject = {
    ...common,
    commonWitness: inputs === null ? null : { ...inputs.commonWitness },
    allowedFormulaVariables: entry.formula.variables.map((field) => ({
      key: field.key,
      label: field.label,
      min: field.min,
      max: null,
      step: field.step,
    })),
    independentDiceDefinitions: entry.formula.independentDice.map((field) => ({
      key: field.key,
      label: field.label,
      min: 1,
      max: field.dieSides,
      step: 1,
    })),
    formulaOutputDefinitions: entry.formula.outputs.map((field) => ({ ...field })),
    playerInputs:
      inputs === null
        ? null
        : {
            commonWitness: { ...inputs.commonWitness },
            independentDice: { ...inputs.independentDice },
            formulaOutputs: { ...inputs.formulaOutputs },
          },
    independentManufacturingDiceReceipts: submitted
      ? result.independentManufacturingDiceReceipts.map((receipt) => ({
          receiptId: receipt.receiptId,
          requestId: receipt.requestId,
          submitCommandId: receipt.submitCommandId,
          variable: receipt.variable,
          dieSides: receipt.dieSides,
          value: receipt.value,
          provenance: receipt.provenance,
        }))
      : [],
    formulaOutputs: inputs === null ? null : { ...inputs.formulaOutputs },
    reachabilityProof: submitted ? { validated: true } : null,
    proposedWeaponProfile:
      submitted && last?.profileOrNull !== null && last?.profileOrNull !== undefined
        ? weaponProfilePlayerFacts(last.profileOrNull as unknown as WeaponEffectiveProfile).map(
            (fact) => ({ ...fact }),
          )
        : null,
    requestStatus: submitted ? 'SUBMITTED' : 'DRAFT',
    profileReceiptIdOrNull: submitted ? last!.receipt.receiptId : null,
    nextFormId: submitted ? 'CHR-038' : 'CHR-023',
  };
  return {
    availableActionKeys: submitted
      ? []
      : [...(submitCapable ? [CHR_023_SUBMIT_ACTION_KEY] : []), CHR_023_RETURN_ACTION_KEY],
    formId: CHR_023_FORM_ID,
    formType: 'screen',
    roleFilteredPayload: payload,
    routeBindings: checkpoint.nextStageEnvelope.routeBindings,
    routeTemplate: CHR_023_ROUTE,
  };
}

export function projectChr024(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: WeaponProfileCatalog,
  checkpointCapable: boolean,
): PresentedBaseForm {
  const { stage, entry, last, common } = context(checkpoint, catalog);
  if (
    stage.kind !== 'FIXED' ||
    entry.profileKind !== 'FIXED' ||
    checkpoint.raceAndMethodStage?.race?.value !== 'PURE'
  )
    throw new Error('CHR-024 requires the fixed PURE profile path');
  const acknowledged = last?.receipt.result.outcome === 'ACKNOWLEDGED';
  const profile = canonicalFixedWeaponProfile(catalog, {
    weaponTypeId: entry.weaponTypeId,
    weaponVariant: entry.weaponVariant,
  });
  return {
    availableActionKeys: acknowledged
      ? []
      : [...(checkpointCapable ? [CHR_024_ACKNOWLEDGE_ACTION_KEY] : []), CHR_024_RETURN_ACTION_KEY],
    formId: CHR_024_FORM_ID,
    formType: 'screen',
    roleFilteredPayload: {
      ...common,
      raceChoice: 'PURE',
      canonicalProfileVersion: entry.canonicalProfileVersion,
      fixedProfile: weaponProfilePlayerFacts(profile).map((fact) => ({ ...fact })),
      requirementPenaltyPreview: { ...entry.requirementPreview },
      acknowledgedReceiptIdOrNull: acknowledged ? last.receipt.receiptId : null,
      nextFormId: acknowledged ? 'CHR-038' : 'CHR-024',
    },
    routeBindings: checkpoint.nextStageEnvelope.routeBindings,
    routeTemplate: CHR_024_ROUTE,
  };
}

export function projectChr031(checkpoint: DurableCreationWizardCheckpoint): PresentedLayerForm {
  const stage = checkpoint.weaponProfileStage;
  const record = stage?.records.at(-1);
  if (
    stage === null ||
    stage === undefined ||
    stage.kind !== 'FORMULA' ||
    record?.receipt.result.outcome !== 'INVALID'
  )
    throw new Error('CHR-031 requires an invalid formula attempt');
  const result = record.receipt.result;
  return {
    availableActionKeys: [CHR_031_RETURN_ACTION_KEY],
    formId: CHR_031_FORM_ID,
    formType: 'dialog',
    routeBindings: [],
    routeTemplate: CHR_031_ROUTE,
    roleFilteredPayload: {
      characterDraftId: checkpoint.localCharacter.localCharacterId,
      requestId: stage.requestId,
      weaponTypeId: result.weaponTypeId,
      invalidFieldSet: [...result.invalidFieldSet],
      formulaReachabilityFailures: result.invalidFieldSet.map((field, index) => ({
        field,
        explanation: result.humanExplanations[index]!,
      })),
      humanExplanations: [...result.humanExplanations],
      returnFormId: 'CHR-023',
      draftRevision: checkpoint.receipt.result.draftRevision,
    },
  };
}

export function assertWeaponProfileScreenContracts(
  forms: Readonly<Record<string, unknown>>,
  assert: (
    forms: Readonly<Record<string, unknown>>,
    formId: string,
    fields: readonly string[],
    route: string,
    type?: 'screen' | 'dialog',
  ) => void,
): void {
  assert(forms, CHR_023_FORM_ID, CHR_023_REQUIRED_FIELDS, CHR_023_ROUTE);
  assert(forms, CHR_024_FORM_ID, CHR_024_REQUIRED_FIELDS, CHR_024_ROUTE);
  assert(forms, CHR_031_FORM_ID, CHR_031_REQUIRED_FIELDS, CHR_031_ROUTE, 'dialog');
  for (const [id, title] of [
    [CHR_023_FORM_ID, 'Параметры оружия игрока'],
    [CHR_024_FORM_ID, 'Фиксированный профиль оружия Чистых'],
    [CHR_031_FORM_ID, 'Невалидный профиль оружия'],
  ] as const) {
    if ((forms[id] as { readonly title?: unknown } | undefined)?.title !== title)
      throw new Error(`${id} title differs from the weapon profile contract`);
  }
}
